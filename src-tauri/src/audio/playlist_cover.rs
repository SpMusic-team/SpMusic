//! Cover-only source I/O, isolated from playback decoding, duration and lyrics.
use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Condvar, Mutex as StdMutex, OnceLock,
    },
};

use lofty::{
    config::ParseOptions,
    error::{ErrorKind, LoftyError},
    file::TaggedFileExt,
    probe::Probe,
};
use super::{
    cover_cache::bounded_playlist_cover_from_tag,
    error::{audio_error, AudioCommandError, AudioErrorCode},
    source::{input_path, track_id, validate_existing_file},
    types::{AudioCoverArt, AudioLoadFileInput, AudioPlaylistCoverSource},
};

/// Total number of playlist cover *requests* admitted at once, queued or in flight.
const MAX_REQUESTS: usize = 32;
/// Upper bound for *concurrently running* tag probes.
///
/// Tag probing is a short, read-only, thread-safe operation: `Probe::open`
/// followed by reading a small header/tag block. Nothing in
/// [`probe_playlist_cover_blocking`] mutates shared state, so serializing it was
/// never required for correctness; the previous single mutex made a cold
/// playlist start pay roughly `probe_count * probe_latency` instead of
/// `probe_count / workers * probe_latency`.
///
/// The bound is deliberately derived from the host instead of being a fixed
/// constant, and is capped low on purpose:
///
/// * The probe lane is **I/O bound**, so its useful width tracks the number of
///   independent reads the volume can serve, which `available_parallelism()`
///   approximates well enough for a desktop filesystem cache.
/// * 8 is the cap because a playlist cold start issues a burst of small reads
///   against one cache/volume; beyond that the probes contend for the same
///   metadata cache and the per-request latency rises without raising
///   throughput, while every extra worker also duplicates lofty's parse buffers.
/// * Memory stays bounded because each probe only retains tag bytes plus a
///   cover blob that [`bounded_playlist_cover_from_tag`] already caps, so the
///   worst case is `MAX_PROBE_WORKERS` small probe heaps rather than a payload
///   cache that scales with worker count.
const MAX_PROBE_WORKERS: usize = 8;
/// Recently produced probe results retained for reuse.
///
/// This is an LRU over *distinct sources*, so it pays off exactly where the
/// duplicate work is: repeated visual demand for the same track (a re-render, a
/// scroll back into view, the hero upgrading from 256px to 512px on the same
/// source) and simultaneous demand from two consumers. A single playlist pass
/// over distinct tracks does not hit it, which is why the concurrent lane above
/// carries the cold-start win and this only removes the repeated-probe tail.
const PROBE_CACHE_ENTRIES: usize = 256;
/// How long a follower waits for a leader's probe before failing that request.
///
/// Bounded so a wedged leader cannot pin follower threads indefinitely; the
/// value is far above a normal tag read and is a liveness guard, not a timeout
/// tuned to any expected file size.
const PROBE_FLIGHT_WAIT: std::time::Duration = std::time::Duration::from_secs(30);

static COORDINATOR: OnceLock<CoverSourceCoordinator> = OnceLock::new();
static PROBE_CACHE: OnceLock<Arc<CoverProbeCache>> = OnceLock::new();


/// Concurrent tag-probe width for this host, in `1..=MAX_PROBE_WORKERS`.
fn probe_worker_limit() -> usize {
    std::thread::available_parallelism()
        .map(|parallelism| parallelism.get())
        .unwrap_or(1)
        .clamp(1, MAX_PROBE_WORKERS)
}

struct RequestReservation(Arc<AtomicUsize>);
impl Drop for RequestReservation {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

// A probe permit remains owned by the blocking closure even when its caller is
// aborted, so cancelling an async caller can never release an in-flight I/O
// slot. The receiver mutex establishes admission order among waiting futures.
//
// This is a token pool rather than an `RwLock` because the permit has to survive
// crossing into `spawn_blocking`: a guard borrowed from a lock cannot be moved
// into the blocking closure, while an owned token can.
struct CoverSourceCoordinator {
    release: tauri::async_runtime::Sender<()>,
    permits: tauri::async_runtime::Mutex<tauri::async_runtime::Receiver<()>>,
    #[cfg_attr(not(test), allow(dead_code))]
    slots: usize,
    requests: Arc<AtomicUsize>,
    // Observability for admission assertions: permits currently handed out.
    held: Arc<AtomicUsize>,
}

impl CoverSourceCoordinator {
    fn new() -> Self {
        Self::with_slots(probe_worker_limit())
    }

    fn with_slots(slots: usize) -> Self {
        let slots = slots.max(1);
        let (release, permits) = tauri::async_runtime::channel(slots);
        for _ in 0..slots {
            release.try_send(()).expect("seed cover source slots");
        }
        Self {
            release,
            permits: tauri::async_runtime::Mutex::new(permits),
            slots,
            requests: Arc::new(AtomicUsize::new(0)),
            held: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn reserve(&self) -> Result<RequestReservation, AudioCommandError> {
        self.requests
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < MAX_REQUESTS).then_some(n + 1)
            })
            .map_err(|_| {
                audio_error(
                    AudioErrorCode::InternalError,
                    "Playlist cover source queue is full",
                    true,
                )
            })?;
        Ok(RequestReservation(Arc::clone(&self.requests)))
    }

    async fn acquire(&self) -> Result<CoverSourcePermit, AudioCommandError> {
        self.permits
            .lock()
            .await
            .recv()
            .await
            .ok_or_else(cover_source_worker_failed)?;
        Ok(CoverSourcePermit::new(
            self.release.clone(),
            Arc::clone(&self.held),
        ))
    }

    /// Permits available right now. Used by admission assertions.
    #[cfg(test)]
    fn available(&self) -> usize {
        self.slots.saturating_sub(self.held.load(Ordering::Acquire))
    }

    async fn run<T, F>(&self, work: F) -> Result<T, AudioCommandError>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, AudioCommandError> + Send + 'static,
    {
        let request = self.reserve()?;
        let permit = self.acquire().await?;
        let (result, _request) = tauri::async_runtime::spawn_blocking(move || {
            // Cancellation of the async caller cannot release an active I/O slot.
            let _permit = permit;
            (work(), request)
        })
        .await
        .map_err(|_| cover_source_worker_failed())?;
        result
    }
}

struct CoverSourcePermit {
    release: tauri::async_runtime::Sender<()>,
    held: Arc<AtomicUsize>,
}

impl CoverSourcePermit {
    fn new(release: tauri::async_runtime::Sender<()>, held: Arc<AtomicUsize>) -> Self {
        held.fetch_add(1, Ordering::AcqRel);
        Self { release, held }
    }
}

impl Drop for CoverSourcePermit {
    fn drop(&mut self) {
        // Exactly one return per acquired token; no await or panicking cleanup.
        self.held.fetch_sub(1, Ordering::AcqRel);
        let _ = self.release.try_send(());
    }
}

fn cover_source_worker_failed() -> AudioCommandError {
    audio_error(
        AudioErrorCode::InternalError,
        "Playlist cover source worker failed",
        true,
    )
}

pub(crate) async fn probe_playlist_cover(
    app_cache_dir: PathBuf,
    input: AudioLoadFileInput,
) -> Result<AudioPlaylistCoverSource, AudioCommandError> {
    // Reject empty paths before reserving a worker; all actual file I/O is blocking.
    input_path(&input.path)?;
    COORDINATOR
        .get_or_init(CoverSourceCoordinator::new)
        .run(move || {
            let mut source = probe_playlist_cover_coalesced(&app_cache_dir, &input.path)?;
            // The cache above is deliberately embedded-only. Sidecar images
            // can change while the audio fingerprint remains identical.
            if source.cover_art.is_none() {
                source.cover_art = super::folder_cover::sibling_cover_art(&source.source_path, Some(&app_cache_dir.join("audio")))
                    .map_err(|error| audio_error(AudioErrorCode::UnreadableFile, error.message, error.recoverable))?;
            }
            Ok(source)
        })
        .await
}
// Embedded-only primitive for thumbnail indexing and folder BFS. The public
// async command adds effective same-directory artwork outside the tag cache.
pub(crate) fn probe_playlist_cover_blocking(
    app_cache_dir: &Path,
    requested_path: &str,
) -> Result<AudioPlaylistCoverSource, AudioCommandError> {
    let path = input_path(requested_path)?;
    validate_existing_file(&path)?;
    let cover_art = probe_cover_art(app_cache_dir, &path)?;
    Ok(AudioPlaylistCoverSource {
        id: track_id(&path),
        source_path: path.to_string_lossy().into_owned(),
        cover_art,
    })
}

// ---------------------------------------------------------------------------
// Probe-stage coalescing
// ---------------------------------------------------------------------------
//
// Overlapping probe demand for the same source is merged and a bounded set of
// recently produced sources is reused, so repeated or simultaneous visual demand
// pays one `Probe::open` + tag parse instead of one per request.
//
// Two properties keep this from changing observable behaviour:
//
// * The cached value is a *result shape* (`Option<AudioCoverArt>`), never an
//   error. Errors are returned directly and are never stored, and the negative
//   result is the same "no embedded cover" the probe already reports.
// * Every cached entry is only published after its own full validation, and the
//   file identity is re-checked before reuse, so a rewritten file cannot serve a
//   stale cover. See `probe_signature`.

/// Recently produced probe results, keyed by the canonical source path.
///
/// Bounded by [`PROBE_CACHE_ENTRIES`] with LRU eviction. Entries hold one
/// [`AudioCoverArt`] each, so the retained payload is at most
/// `PROBE_CACHE_ENTRIES * MAX_PLAYLIST_COVER_BYTES` in the theoretical worst case
/// and is released on eviction; the non-cover case retains only the file
/// signature.
struct CoverProbeCache {
    entries: StdMutex<ProbeCacheState>,
    /// Real tag reads performed while leading a flight.
    #[cfg(test)]
    tag_reads: AtomicUsize,
}

#[derive(Default)]
struct ProbeCacheState {
    entries: HashMap<PathBuf, CachedProbe>,
    recency: VecDeque<PathBuf>,
    flights: HashMap<PathBuf, Arc<ProbeFlight>>,
}

struct CachedProbe {
    signature: ProbeSignature,
    cover_art: Option<AudioCoverArt>,
}

/// Cheap identity for a source file used to invalidate cached probe results.
struct ProbeSignature {
    len: u64,
    modified_ns: u128,
}

struct ProbeFlight {
    result: StdMutex<Option<Result<Option<AudioCoverArt>, AudioCommandError>>>,
    done: (StdMutex<bool>, Condvar),
}

impl CoverProbeCache {
    fn new() -> Self {
        Self {
            entries: StdMutex::new(ProbeCacheState::default()),
            #[cfg(test)]
            tag_reads: AtomicUsize::new(0),
        }
    }

    #[cfg(test)]
    fn tag_reads(&self) -> usize {
        self.tag_reads.load(Ordering::Acquire)
    }

    /// Count one real tag read. Called only by the flight leader.
    fn record_tag_read(&self) {
        #[cfg(test)]
        self.tag_reads.fetch_add(1, Ordering::Relaxed);
    }

    fn state(&self) -> std::sync::MutexGuard<'_, ProbeCacheState> {
        self.entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Serve `path` from cache, join an in-flight probe, or become the leader.
    ///
    /// The returned [`ProbeRole`] tells the caller whether it must run the probe
    /// and publish it, or consume an already resolved outcome.
    fn claim(self: &Arc<Self>, path: &Path, signature: &ProbeSignature) -> ProbeRole {
        let mut state = self.state();
        if let Some(cached) = state.entries.get(path) {
            if cached.signature.matches(signature) {
                let cover_art = cached.cover_art.clone();
                // LRU touch: move to the back without allocating a new key.
                state.recency.retain(|candidate| candidate != path);
                state.recency.push_back(path.to_owned());
                return ProbeRole::Cached(cover_art);
            }
            // The file changed: drop the stale entry before probing again.
            state.entries.remove(path);
            state.recency.retain(|candidate| candidate != path);
        }
        if let Some(flight) = state.flights.get(path) {
            return ProbeRole::Follower(Arc::clone(flight));
        }
        let flight = Arc::new(ProbeFlight {
            result: StdMutex::new(None),
            done: (StdMutex::new(false), Condvar::new()),
        });
        state.flights.insert(path.to_owned(), Arc::clone(&flight));
        ProbeRole::Leader {
            flight,
            guard: ProbeFlightGuard {
                path: Some(path.to_owned()),
                cache: Arc::clone(self),
            },
        }
    }

    /// Retire a flight whose leader disappeared without publishing.
    ///
    /// This is the unwind path: if the leader's blocking body panics, the flight
    /// must not survive as a tombstone that makes every later request for the
    /// same source wait out [`PROBE_FLIGHT_WAIT`]. Removing it lets the next
    /// request probe again.
    fn abandon(&self, path: &Path) {
        let mut state = self.state();
        if let Some(flight) = state.flights.remove(path) {
            // Wake any follower with an explicit failure instead of a timeout.
            *flight
                .result
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Err(cover_source_worker_failed()));
            let (lock, wake) = &flight.done;
            *lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
            wake.notify_all();
        }
    }

    /// Publish a leader's outcome to every follower and retire the flight.
    fn publish(&self, path: &Path, signature: ProbeSignature, outcome: ProbeOutcome) {
        let mut state = self.state();
        if let Some(flight) = state.flights.remove(path) {
            *flight
                .result
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(outcome.result.clone());
            let (lock, wake) = &flight.done;
            *lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
            wake.notify_all();
        }
        // Only successfully parsed sources enter the cache. A failed read must be
        // retried by the next request instead of being pinned as absent.
        if let Ok(cover_art) = outcome.result {
            state.entries.insert(
                path.to_owned(),
                CachedProbe {
                    signature,
                    cover_art,
                },
            );
            state.recency.retain(|candidate| candidate != path);
            state.recency.push_back(path.to_owned());
            while state.recency.len() > PROBE_CACHE_ENTRIES {
                if let Some(expired) = state.recency.pop_front() {
                    state.entries.remove(&expired);
                }
            }
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.state().entries.len()
    }

    #[cfg(test)]
    fn flights_empty(&self) -> bool {
        self.state().flights.is_empty()
    }

    #[cfg(test)]
    fn flights_present(&self, path: &Path) -> bool {
        self.state().flights.contains_key(path)
    }
}

impl ProbeSignature {
    fn matches(&self, other: &Self) -> bool {
        self.len == other.len && self.modified_ns == other.modified_ns
    }
}

enum ProbeRole {
    Cached(Option<AudioCoverArt>),
    Follower(Arc<ProbeFlight>),
    Leader {
        flight: Arc<ProbeFlight>,
        guard: ProbeFlightGuard,
    },
}

/// Unwind guard for a probing leader.
///
/// `publish` consumes the guard on the normal path; dropping it without
/// publishing means the leader panicked, and the flight must be retired so
/// followers fail fast and later requests retry instead of hanging.
struct ProbeFlightGuard {
    path: Option<PathBuf>,
    cache: Arc<CoverProbeCache>,
}

impl ProbeFlightGuard {
    /// Mark the flight as published so `Drop` does not retire it again.
    fn disarm(mut self) {
        self.path = None;
    }
}

impl Drop for ProbeFlightGuard {
    fn drop(&mut self) {
        // Reaching here with a path means the leader unwound before publishing.
        // Clear the tombstone so the next request probes again rather than
        // waiting out `PROBE_FLIGHT_WAIT`.
        if let Some(path) = self.path.as_ref() {
            self.cache.abandon(path);
        }
    }
}


#[derive(Clone)]
struct ProbeOutcome {
    result: Result<Option<AudioCoverArt>, AudioCommandError>,
}

impl ProbeFlight {
    /// Block until the leader publishes. Returns the shared outcome.
    ///
    /// A panicking leader drops its `ProbeFlight` without publishing; the
    /// leader's own `Drop` guard clears the flight entry so later requests
    /// re-probe instead of waiting forever.
    fn wait(&self) -> Result<Option<AudioCoverArt>, AudioCommandError> {
        let (lock, wake) = &self.done;
        let mut ready = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        while !*ready {
            let (next, timeout) = wake
                .wait_timeout(ready, PROBE_FLIGHT_WAIT)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            ready = next;
            if timeout.timed_out() {
                return Err(cover_source_worker_failed());
            }
        }
        drop(ready);
        self.result
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .unwrap_or_else(|| Err(cover_source_worker_failed()))
    }
}

fn probe_signature(path: &Path) -> Result<ProbeSignature, AudioCommandError> {
    let metadata = fs::metadata(path).map_err(|error| {
        audio_error(
            if error.kind() == std::io::ErrorKind::NotFound {
                AudioErrorCode::FileNotFound
            } else {
                AudioErrorCode::UnreadableFile
            },
            "Audio source could not be inspected for the playlist cover",
            true,
        )
    })?;
    let modified_ns = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    Ok(ProbeSignature {
        len: metadata.len(),
        modified_ns,
    })
}

/// Probe with probe-stage coalescing and a bounded result cache.
// Cache only embedded metadata keyed by the audio file's fingerprint.
pub(crate) fn probe_playlist_cover_coalesced(
    app_cache_dir: &Path,
    requested_path: &str,
) -> Result<AudioPlaylistCoverSource, AudioCommandError> {
    let cache = PROBE_CACHE.get_or_init(|| Arc::new(CoverProbeCache::new()));
    probe_playlist_cover_coalesced_with(cache, app_cache_dir, requested_path)
}

fn probe_playlist_cover_coalesced_with(
    cache: &Arc<CoverProbeCache>,
    app_cache_dir: &Path,
    requested_path: &str,
) -> Result<AudioPlaylistCoverSource, AudioCommandError> {
    let path = input_path(requested_path)?;
    validate_existing_file(&path)?;
    // `input_path` yields an absolute path, so this is a stable cache key.
    let signature = probe_signature(&path)?;
    let cover_art = match cache.claim(&path, &signature) {
        ProbeRole::Cached(cover_art) => cover_art,
        ProbeRole::Follower(flight) => flight.wait()?,
        ProbeRole::Leader { flight, guard } => {
            // Keep `guard` alive across the probe body: if it unwinds here, the
            // guard retires the flight instead of leaking a tombstone.
            cache.record_tag_read();
            let outcome = match probe_cover_art(app_cache_dir, &path) {
                Ok(cover_art) => ProbeOutcome {
                    result: Ok(cover_art),
                },
                Err(error) => ProbeOutcome { result: Err(error) },
            };
            cache.publish(&path, signature, outcome.clone());
            // Published: the guard must not retire an already retired flight.
            guard.disarm();
            drop(flight);
            outcome.result?
        }
    };
    Ok(AudioPlaylistCoverSource {
        id: track_id(&path),
        source_path: path.to_string_lossy().into_owned(),
        cover_art,
    })
}

/// Shared tag-read step used by both the plain and coalesced probe paths.
fn probe_cover_art(
    app_cache_dir: &Path,
    path: &Path,
) -> Result<Option<AudioCoverArt>, AudioCommandError> {

    let tagged = Probe::open(path)        .and_then(|probe| probe.guess_file_type().map_err(LoftyError::from))
        .and_then(|probe| {
            probe
                .options(
                    ParseOptions::new()
                        .read_properties(false)
                        .read_cover_art(true),
                )
                .read()
        })
        .map_err(tag_error)?;
    tagged
        .primary_tag()
        .or_else(|| tagged.first_tag())
        .map(|tag| bounded_playlist_cover_from_tag(tag, app_cache_dir))
        .transpose()
        .map(Option::flatten)
}

fn tag_error(error: LoftyError) -> AudioCommandError {
    let code = match error.kind() {
        ErrorKind::Io(io) if io.kind() == std::io::ErrorKind::NotFound => {
            AudioErrorCode::FileNotFound
        }
        ErrorKind::Io(io)
            if matches!(
                io.kind(),
                std::io::ErrorKind::UnexpectedEof | std::io::ErrorKind::InvalidData
            ) =>
        {
            AudioErrorCode::UnsupportedFormat
        }
        ErrorKind::Io(_) => AudioErrorCode::UnreadableFile,
        ErrorKind::Alloc(_) => AudioErrorCode::InternalError,
        _ => AudioErrorCode::UnsupportedFormat,
    };
    audio_error(
        code,
        "Audio tags could not be read for the playlist cover",
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use lofty::{
        config::WriteOptions,
        picture::{MimeType, Picture, PictureType},
        tag::{Tag, TagExt, TagType},
    };
    use std::{fs, sync::mpsc, time::Duration};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "spmusic-cover-source-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn wav(&self) -> PathBuf {
            let path = self.0.join("source.wav");
            let mut bytes = Vec::new();
            bytes.extend_from_slice(b"RIFF");
            bytes.extend_from_slice(&52u32.to_le_bytes());
            bytes.extend_from_slice(b"WAVEfmt ");
            bytes.extend_from_slice(&16u32.to_le_bytes());
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&8000u32.to_le_bytes());
            bytes.extend_from_slice(&16000u32.to_le_bytes());
            bytes.extend_from_slice(&2u16.to_le_bytes());
            bytes.extend_from_slice(&16u16.to_le_bytes());
            bytes.extend_from_slice(b"data");
            bytes.extend_from_slice(&16u32.to_le_bytes());
            bytes.resize(60, 0);
            fs::write(&path, bytes).unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn tag(path: &Path, value: u8) {
        let mut tag = Tag::new(TagType::Id3v2);
        for (kind, bytes) in [
            (PictureType::Other, vec![0xff, 0xd8, 0xff, 0xd9]),
            (
                PictureType::CoverFront,
                vec![0x89, b'P', b'N', b'G', 13, 10, 26, 10, value],
            ),
        ] {
            tag.push_picture(
                Picture::unchecked(bytes)
                    .pic_type(kind)
                    .mime_type(if kind == PictureType::CoverFront {
                        MimeType::Png
                    } else {
                        MimeType::Jpeg
                    })
                    .build(),
            );
        }
        tag.save_to_path(path, WriteOptions::default()).unwrap();
    }

    #[test]
    fn cover_only_probes_tags_and_preserves_identity_without_full_metadata() {
        let f = Fixture::new();
        let path = f.wav();
        let input = path.to_str().unwrap();
        fs::create_dir(path.with_extension("lrc")).unwrap();
        assert!(probe_playlist_cover_blocking(&f.0, input)
            .unwrap()
            .cover_art
            .is_none());
        tag(&path, 7);
        let before = fs::read(&path).unwrap();
        let original_modified = fs::metadata(&path).unwrap().modified().unwrap();
        let result = probe_playlist_cover_blocking(&f.0, input).unwrap();
        assert_eq!(result.id, track_id(&path));
        assert_eq!(result.source_path, input);
        let cover = result.cover_art.unwrap();
        assert_eq!(cover.mime_type, "image/png");
        assert_eq!(
            fs::read(cover.file_path.unwrap()).unwrap(),
            [0x89, b'P', b'N', b'G', 13, 10, 26, 10, 7]
        );
        assert_eq!(before, fs::read(&path).unwrap());
        let serialized =
            serde_json::to_value(probe_playlist_cover_blocking(&f.0, input).unwrap()).unwrap();
        assert_eq!(serialized.as_object().unwrap().len(), 3);
        assert!(serialized.get("metadata").is_none());
        assert!(serialized.get("durationMs").is_none());
        let first = serialized["coverArt"]["filePath"].clone();
        tag(&path, 8);
        assert_eq!(fs::metadata(&path).unwrap().len(), before.len() as u64);
        std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(original_modified)
            .unwrap();
        let changed = probe_playlist_cover_blocking(&f.0, input).unwrap();
        assert_ne!(
            serde_json::to_value(changed.cover_art.unwrap()).unwrap()["filePath"],
            first
        );
    }

    #[test]
    fn cover_only_reads_flac_picture_without_audio_frames_or_duration() {
        let f = Fixture::new();
        let path = f.0.join("tags-only.flac");
        let mut streaminfo = vec![0u8; 34];
        streaminfo[0..4].copy_from_slice(&[0x10, 0, 0x10, 0]);
        let packed = (8000u64 << 44) | (15u64 << 36);
        streaminfo[10..18].copy_from_slice(&packed.to_be_bytes());
        let mut bytes = b"fLaC".to_vec();
        bytes.extend_from_slice(&[0x80, 0, 0, 34]);
        bytes.extend_from_slice(&streaminfo);
        fs::write(&path, &bytes).unwrap();
        assert!(probe_playlist_cover_blocking(&f.0, path.to_str().unwrap())
            .unwrap()
            .cover_art
            .is_none());
        bytes[4] = 0;
        let png = [0x89, b'P', b'N', b'G', 13, 10, 26, 10, 9];
        let mut picture = Vec::new();
        picture.extend_from_slice(&3u32.to_be_bytes());
        picture.extend_from_slice(&9u32.to_be_bytes());
        picture.extend_from_slice(b"image/png");
        for value in [0u32, 1, 1, 32, 0, png.len() as u32] {
            picture.extend_from_slice(&value.to_be_bytes());
        }
        picture.extend_from_slice(&png);
        bytes.push(0x86);
        bytes.extend_from_slice(&(picture.len() as u32).to_be_bytes()[1..]);
        bytes.extend_from_slice(&picture);
        fs::write(&path, &bytes).unwrap();
        let cover = probe_playlist_cover_blocking(&f.0, path.to_str().unwrap())
            .unwrap()
            .cover_art
            .unwrap();
        assert_eq!(fs::read(cover.file_path.unwrap()).unwrap(), png);
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn cover_only_reports_errors_instead_of_claiming_no_cover() {
        let f = Fixture::new();
        assert_eq!(
            probe_playlist_cover_blocking(&f.0, "  ").unwrap_err().code,
            AudioErrorCode::InvalidPath
        );
        assert_eq!(
            probe_playlist_cover_blocking(&f.0, f.0.join("missing.wav").to_str().unwrap())
                .unwrap_err()
                .code,
            AudioErrorCode::FileNotFound
        );
        assert_eq!(
            probe_playlist_cover_blocking(&f.0, f.0.to_str().unwrap())
                .unwrap_err()
                .code,
            AudioErrorCode::InvalidPath
        );
        let corrupt = f.0.join("unknown.bin");
        fs::write(&corrupt, [b'x'; 128]).unwrap();
        assert_eq!(
            probe_playlist_cover_blocking(&f.0, corrupt.to_str().unwrap())
                .unwrap_err()
                .code,
            AudioErrorCode::UnsupportedFormat
        );
        assert_eq!(
            tag_error(std::io::Error::from(std::io::ErrorKind::PermissionDenied).into()).code,
            AudioErrorCode::UnreadableFile
        );
    }

    #[test]
    fn cancelled_cover_source_retains_worker_slot_and_request_until_completion() {
        let coordinator = Arc::new(CoverSourceCoordinator::with_slots(4));
        let c = Arc::clone(&coordinator);
        let (started, did_start) = mpsc::channel();
        let (release, wait_release) = mpsc::channel();
        let task = tauri::async_runtime::spawn(async move {
            c.run(move || {
                started.send(()).unwrap();
                wait_release.recv().unwrap();
                Ok(())
            })
            .await
        });
        did_start.recv_timeout(Duration::from_secs(5)).unwrap();
        // The cancelled caller must still hold exactly one probe permit.
        assert_eq!(coordinator.available(), 3);
        task.abort();
        assert!(tauri::async_runtime::block_on(task).is_err());
        // Cancellation of the async caller cannot release an active I/O slot.
        assert_eq!(coordinator.available(), 3);
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 1);
        release.send(()).unwrap();
        tauri::async_runtime::block_on(coordinator.run(|| Ok(()))).unwrap();
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 0);
        assert_eq!(coordinator.available(), 4);
        let reservations: Vec<_> = (0..MAX_REQUESTS)
            .map(|_| coordinator.reserve().unwrap())
            .collect();
        let error = tauri::async_runtime::block_on(
            coordinator.run(|| -> Result<(), _> { panic!("full queue must reject work") }),
        )
        .unwrap_err();
        assert_eq!(error.code, AudioErrorCode::InternalError);
        drop(reservations);
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 0);
        tauri::async_runtime::block_on(coordinator.run(|| Ok(()))).unwrap();
    }

    /// Measures the wall-clock effect of overlapping probes.
    ///
    /// The in-work delay dominates real I/O here, so the ratio is deterministic:
    /// serial admission costs `WIDTH * delay`, concurrent admission costs about
    /// `delay`. Numbers are printed for the implementation record.
    #[test]
    fn cover_source_concurrency_cuts_probe_wall_clock() {
        const WIDTH: usize = 4;
        const HOLD: Duration = Duration::from_millis(50);

        let serial_started = std::time::Instant::now();
        for _ in 0..WIDTH {
            std::thread::sleep(HOLD);
        }
        let serial = serial_started.elapsed();

        let coordinator = Arc::new(CoverSourceCoordinator::with_slots(WIDTH));
        let concurrent_started = std::time::Instant::now();
        let mut tasks = Vec::new();
        for _ in 0..WIDTH {
            let coordinator = Arc::clone(&coordinator);
            tasks.push(tauri::async_runtime::spawn(async move {
                coordinator
                    .run(move || {
                        std::thread::sleep(HOLD);
                        Ok(())
                    })
                    .await
            }));
        }
        for task in tasks {
            tauri::async_runtime::block_on(task).unwrap().unwrap();
        }
        let concurrent = concurrent_started.elapsed();

        println!(
            "SP-COVER-PROBE width={WIDTH} hold_ms={} serial_ms={:.1} concurrent_ms={:.1} speedup={:.2}x",
            HOLD.as_millis(),
            serial.as_secs_f64() * 1000.0,
            concurrent.as_secs_f64() * 1000.0,
            serial.as_secs_f64() / concurrent.as_secs_f64(),
        );
        // Serial admission would take at least WIDTH * HOLD; overlapping must
        // finish well inside that budget.
        assert!(
            concurrent < HOLD * 2,
            "concurrent probes took {concurrent:?}, which is serial-like"
        );
        assert!(serial > HOLD * 3);
        assert_eq!(coordinator.available(), WIDTH);
    }

    /// Real-file evidence: probes a batch of tagged files through the public
    /// blocking probe, serially versus through the coordinator, and prints both
    /// wall-clock totals plus the observed overlap.
    ///
    /// Ignored by default because it creates real files and takes a moment; run
    /// with `cargo test --lib audio::playlist_cover -- --ignored --nocapture`.
    #[test]
    #[ignore = "manual measurement over real tagged files"]
    fn cover_source_probe_throughput_over_real_files() {
        const COUNT: usize = 48;
        let f = Fixture::new();
        let mut paths = Vec::new();
        for index in 0..COUNT {
            let path = f.0.join(format!("track-{index}.wav"));
            let mut bytes = Vec::new();
            bytes.extend_from_slice(b"RIFF");
            bytes.extend_from_slice(&52u32.to_le_bytes());
            bytes.extend_from_slice(b"WAVEfmt ");
            bytes.extend_from_slice(&16u32.to_le_bytes());
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&8000u32.to_le_bytes());
            bytes.extend_from_slice(&16000u32.to_le_bytes());
            bytes.extend_from_slice(&2u16.to_le_bytes());
            bytes.extend_from_slice(&16u16.to_le_bytes());
            bytes.extend_from_slice(b"data");
            bytes.extend_from_slice(&16u32.to_le_bytes());
            bytes.resize(60, 0);
            fs::write(&path, bytes).unwrap();
            tag(&path, index as u8);
            paths.push(path);
        }

        // Warm the volume so the comparison is about admission, not first-touch.
        let _ = probe_playlist_cover_blocking(&f.0, paths[0].to_str().unwrap());

        let serial_started = std::time::Instant::now();
        for path in &paths {
            probe_playlist_cover_blocking(&f.0, path.to_str().unwrap()).unwrap();
        }
        let serial = serial_started.elapsed();

        let width = probe_worker_limit();
        let coordinator = Arc::new(CoverSourceCoordinator::new());
        // Requests are admitted in batches that respect MAX_REQUESTS, mirroring a
        // frontend that issues a bounded window of probes rather than all-open.
        let concurrent_started = std::time::Instant::now();
        for batch in paths.chunks(MAX_REQUESTS) {
            let mut tasks = Vec::new();
            for path in batch {
                let coordinator = Arc::clone(&coordinator);
                let cache = f.0.clone();
                let path = path.clone();
                tasks.push(tauri::async_runtime::spawn(async move {
                    coordinator
                        .run(move || probe_playlist_cover_blocking(&cache, path.to_str().unwrap()))
                        .await
                }));
            }
            for task in tasks {
                tauri::async_runtime::block_on(task).unwrap().unwrap();
            }
        }
        let concurrent = concurrent_started.elapsed();

        println!(
            "SP-COVER-PROBE-REAL files={COUNT} width={width} serial_ms={:.1} concurrent_ms={:.1} speedup={:.2}x serial_per_file_us={:.0} concurrent_per_file_us={:.0}",
            serial.as_secs_f64() * 1000.0,
            concurrent.as_secs_f64() * 1000.0,
            serial.as_secs_f64() / concurrent.as_secs_f64(),
            serial.as_secs_f64() * 1_000_000.0 / COUNT as f64,
            concurrent.as_secs_f64() * 1_000_000.0 / COUNT as f64,
        );
        assert_eq!(coordinator.available(), width);
        assert!(concurrent < serial, "concurrent probes must beat serial");
    }

    /// Repeated demand for the same source must reuse one tag read.
    #[test]
    fn cover_source_probe_is_reused_for_repeated_demand() {
        let f = Fixture::new();
        let path = f.wav();
        tag(&path, 7);
        let input = path.to_str().unwrap();
        let cache = Arc::new(CoverProbeCache::new());
        let first = probe_playlist_cover_coalesced_with(&cache, &f.0, input).unwrap();
        let second = probe_playlist_cover_coalesced_with(&cache, &f.0, input).unwrap();
        let third = probe_playlist_cover_coalesced_with(&cache, &f.0, input).unwrap();
        assert_eq!(cache.tag_reads(), 1, "repeated demand must reuse one read");
        assert_eq!(first.id, second.id);
        assert_eq!(first.source_path, third.source_path);
        let cover = second.cover_art.expect("cached cover");
        assert_eq!(cover.mime_type, "image/png");
        assert_eq!(cover.byte_len, 9);
    }

    /// A rewritten file must not serve the previous cover.
    #[test]
    fn cover_source_probe_cache_invalidates_on_file_change() {
        let f = Fixture::new();
        let path = f.wav();
        tag(&path, 7);
        let input = path.to_str().unwrap();
        let cache = Arc::new(CoverProbeCache::new());
        let first = probe_playlist_cover_coalesced_with(&cache, &f.0, input).unwrap();
        let first_file = first.cover_art.unwrap().file_path.unwrap();
        // Grow the file so (size, mtime) cannot match, then check the payload.
        tag(&path, 8);
        let second = probe_playlist_cover_coalesced_with(&cache, &f.0, input).unwrap();
        let second_file = second.cover_art.unwrap().file_path.unwrap();
        assert_ne!(first_file, second_file);
        assert_eq!(cache.tag_reads(), 2, "a changed file must be re-probed");
        assert_eq!(
            fs::read(&second_file).unwrap(),
            [0x89, b'P', b'N', b'G', 13, 10, 26, 10, 8]
        );
    }

    /// A failing probe must never be pinned as a negative result.
    #[test]
    fn cover_source_probe_cache_does_not_retain_errors() {
        let f = Fixture::new();
        let corrupt = f.0.join("corrupt.wav");
        fs::write(&corrupt, [b'x'; 128]).unwrap();
        let input = corrupt.to_str().unwrap();
        let cache = Arc::new(CoverProbeCache::new());
        assert_eq!(
            probe_playlist_cover_coalesced_with(&cache, &f.0, input).unwrap_err().code,
            AudioErrorCode::UnsupportedFormat
        );
        // Retried, not served from a cached error.
        assert_eq!(
            probe_playlist_cover_coalesced_with(&cache, &f.0, input).unwrap_err().code,
            AudioErrorCode::UnsupportedFormat
        );
        assert_eq!(cache.tag_reads(), 2);
        assert_eq!(cache.len(), 0, "errors must not enter the result cache");
    }

    /// The cache is bounded and evicts least-recently-used sources.
    #[test]
    fn cover_source_probe_cache_is_bounded() {
        let cache = Arc::new(CoverProbeCache::new());
        let signature = ProbeSignature {
            len: 1,
            modified_ns: 1,
        };
        for index in 0..(PROBE_CACHE_ENTRIES + 16) {
            let path = PathBuf::from(format!("source-{index}.wav"));
            assert!(matches!(
                cache.claim(&path, &signature),
                ProbeRole::Leader { .. }
            ));
            cache.publish(
                &path,
                ProbeSignature {
                    len: 1,
                    modified_ns: 1,
                },
                ProbeOutcome { result: Ok(None) },
            );
        }
        assert_eq!(cache.len(), PROBE_CACHE_ENTRIES);
        assert!(cache.flights_empty());
        // The oldest entries were evicted, the newest are still reusable.
        assert!(matches!(
            cache.claim(
                &PathBuf::from(format!("source-{PROBE_CACHE_ENTRIES}.wav")),
                &signature
            ),
            ProbeRole::Cached(None)
        ));
        assert!(matches!(
            cache.claim(&PathBuf::from("source-0.wav"), &signature),
            ProbeRole::Leader { .. }
        ));
    }

    /// A leader that stops without publishing must not leave a tombstone that
    /// makes later requests wait out `PROBE_FLIGHT_WAIT`.
    #[test]
    fn cover_source_flight_is_retired_when_leader_unwinds() {
        let cache = Arc::new(CoverProbeCache::new());
        let path = PathBuf::from("panicking.wav");
        let signature = ProbeSignature {
            len: 1,
            modified_ns: 1,
        };
        // Leader claims the flight and then unwinds without publishing.
        let leader = cache.claim(&path, &signature);
        assert!(matches!(leader, ProbeRole::Leader { .. }));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let ProbeRole::Leader { flight, guard } = leader else {
                unreachable!()
            };
            // Dropping both without publishing models a leader unwind.
            drop(guard);
            drop(flight);
            panic!("injected leader panic");
        }));
        assert!(result.is_err());
        assert!(
            !cache.flights_present(&path),
            "a leader that never published must not leave a tombstone"
        );
        // A later request probes again instead of joining a dead flight.
        assert!(matches!(
            cache.claim(&path, &signature),
            ProbeRole::Leader { .. }
        ));
    }

    /// A follower observes the leader's published outcome, including a negative
    /// ("no embedded cover") result, without re-reading tags.
    #[test]
    fn cover_source_flight_followers_share_the_leader_result() {
        let cache = Arc::new(CoverProbeCache::new());
        let path = PathBuf::from("shared.wav");
        let signature = ProbeSignature {
            len: 1,
            modified_ns: 1,
        };
        let ProbeRole::Leader { flight, guard } = cache.claim(&path, &signature) else {
            panic!("expected leader");
        };
        let followers: Vec<_> = (0..3)
            .map(|_| match cache.claim(&path, &signature) {
                ProbeRole::Follower(flight) => flight,
                _ => panic!("expected follower"),
            })
            .collect();
        let published = Some(AudioCoverArt {
            mime_type: "image/png".to_owned(),
            file_path: Some("/covers/x.png".to_owned()),
            data_url: None,
            byte_len: 9,
        });
        cache.publish(
            &path,
            signature,
            ProbeOutcome {
                result: Ok(published.clone()),
            },
        );
        guard.disarm();
        drop(flight);
        for follower in followers {
            let observed = follower.wait().unwrap();
            assert_eq!(observed.as_ref().map(|art| art.byte_len), Some(9));
            assert_eq!(
                observed.and_then(|art| art.file_path),
                Some("/covers/x.png".to_owned())
            );
        }
        // The outcome is now cached, so the next claim does not re-probe.
        assert!(matches!(
            cache.claim(
                &path,
                &ProbeSignature {
                    len: 1,
                    modified_ns: 1
                }
            ),
            ProbeRole::Cached(Some(_))
        ));
    }

    /// Real-file evidence for probe coalescing: repeated demand (the re-render /
    /// scroll-back / 256->512 hero upgrade shape) versus re-probing every time.
    ///
    /// Ignored by default; run with
    /// `cargo test --lib audio::playlist_cover -- --ignored --nocapture`.
    #[test]
    #[ignore = "manual measurement over real tagged files"]
    fn cover_source_repeat_pass_avoids_reprobing() {
        const COUNT: usize = 64;
        let f = Fixture::new();
        let mut paths = Vec::new();
        for index in 0..COUNT {
            let path = f.0.join(format!("repeat-{index}.wav"));
            let mut bytes = Vec::new();
            bytes.extend_from_slice(b"RIFF");
            bytes.extend_from_slice(&52u32.to_le_bytes());
            bytes.extend_from_slice(b"WAVEfmt ");
            bytes.extend_from_slice(&16u32.to_le_bytes());
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&8000u32.to_le_bytes());
            bytes.extend_from_slice(&16000u32.to_le_bytes());
            bytes.extend_from_slice(&2u16.to_le_bytes());
            bytes.extend_from_slice(&16u16.to_le_bytes());
            bytes.extend_from_slice(b"data");
            bytes.extend_from_slice(&16u32.to_le_bytes());
            bytes.resize(60, 0);
            fs::write(&path, bytes).unwrap();
            tag(&path, index as u8);
            paths.push(path);
        }

        // Cold pass: every source is probed once.
        let cold_started = std::time::Instant::now();
        for path in &paths {
            probe_playlist_cover_coalesced(&f.0, path.to_str().unwrap()).unwrap();
        }
        let cold = cold_started.elapsed();

        // Warm pass: identical demand, served from the cache.
        let warm_started = std::time::Instant::now();
        for path in &paths {
            probe_playlist_cover_coalesced(&f.0, path.to_str().unwrap()).unwrap();
        }
        let warm = warm_started.elapsed();

        // Baseline: the same repeated demand with no reuse at all.
        let uncoalesced_started = std::time::Instant::now();
        for path in &paths {
            probe_playlist_cover_blocking(&f.0, path.to_str().unwrap()).unwrap();
        }
        let uncoalesced = uncoalesced_started.elapsed();

        println!(
            "SP-COVER-COALESCE files={COUNT} cold_ms={:.1} warm_ms={:.1} uncoalesced_pass_ms={:.1} warm_speedup={:.2}x warm_per_file_us={:.0}",
            cold.as_secs_f64() * 1000.0,
            warm.as_secs_f64() * 1000.0,
            uncoalesced.as_secs_f64() * 1000.0,
            uncoalesced.as_secs_f64() / warm.as_secs_f64(),
            warm.as_secs_f64() * 1_000_000.0 / COUNT as f64,
        );
        assert!(
            warm < uncoalesced,
            "cached repeat pass ({warm:?}) must beat re-probing ({uncoalesced:?})"
        );
    }

    #[test]
    fn cover_source_panic_releases_admission() {
        let coordinator = CoverSourceCoordinator::with_slots(4);
        let error = tauri::async_runtime::block_on(
            coordinator.run(|| -> Result<(), _> { panic!("injected panic") }),
        )
        .unwrap_err();
        assert_eq!(error.code, AudioErrorCode::InternalError);
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 0);
        assert_eq!(coordinator.available(), 4);
        tauri::async_runtime::block_on(coordinator.run(|| Ok(()))).unwrap();
    }

    /// Proves the probe lane actually runs work concurrently instead of merely
    /// admitting it: several probes are held inside their blocking body at the
    /// same time, and the peak observed concurrency must exceed one.
    ///
    /// Before the change this assert failed with a peak of exactly 1, because a
    /// single `Mutex` guard serialized every probe regardless of `MAX_REQUESTS`.
    #[test]
    fn cover_source_probes_run_concurrently_up_to_the_bound() {
        const WIDTH: usize = 4;
        let coordinator = Arc::new(CoverSourceCoordinator::with_slots(WIDTH));
        let inside = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let (entered, on_entered) = mpsc::channel();
        let barrier = Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));

        let mut tasks = Vec::new();
        for _ in 0..WIDTH {
            let coordinator = Arc::clone(&coordinator);
            let inside = Arc::clone(&inside);
            let peak = Arc::clone(&peak);
            let entered = entered.clone();
            let barrier = Arc::clone(&barrier);
            tasks.push(tauri::async_runtime::spawn(async move {
                coordinator
                    .run(move || {
                        let active = inside.fetch_add(1, Ordering::AcqRel) + 1;
                        peak.fetch_max(active, Ordering::AcqRel);
                        entered.send(()).unwrap();
                        // Hold the probe until every admitted worker is inside.
                        let (lock, wake) = &*barrier;
                        let mut open = lock.lock().unwrap();
                        while !*open {
                            let (next, timeout) =
                                wake.wait_timeout(open, Duration::from_secs(5)).unwrap();
                            open = next;
                            assert!(!timeout.timed_out(), "concurrency barrier timed out");
                        }
                        inside.fetch_sub(1, Ordering::AcqRel);
                        Ok(())
                    })
                    .await
            }));
        }

        for _ in 0..WIDTH {
            on_entered
                .recv_timeout(Duration::from_secs(10))
                .expect("a probe must reach its blocking body");
        }
        let observed = peak.load(Ordering::Acquire);
        assert!(
            observed > 1,
            "probe lane must overlap work, but peak concurrency was {observed}"
        );
        assert!(observed <= WIDTH, "probe width must respect its bound");
        assert_eq!(inside.load(Ordering::Acquire), observed);

        let (lock, wake) = &*barrier;
        *lock.lock().unwrap() = true;
        wake.notify_all();
        for task in tasks {
            tauri::async_runtime::block_on(task).unwrap().unwrap();
        }
        assert_eq!(coordinator.available(), WIDTH);
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 0);
    }

    /// A cancelled probe must not let a queued probe exceed the width bound, and
    /// releasing afterwards must restore the full pool.
    #[test]
    fn cover_source_width_is_bounded_under_admission() {
        let coordinator = CoverSourceCoordinator::with_slots(2);
        tauri::async_runtime::block_on(async {
            let first = coordinator.acquire().await.unwrap();
            let second = coordinator.acquire().await.unwrap();
            assert_eq!(coordinator.available(), 0);
            let queued = {
                let coordinator = &coordinator;
                std::pin::pin!(async { coordinator.acquire().await })
            };
            // Poll once with both permits taken: the third acquire must not
            // resolve, proving the pool is a real bound and not just a counter.
            use std::task::{Context, Poll, Waker};
            let mut queued = queued;
            assert!(matches!(
                std::future::Future::poll(
                    queued.as_mut(),
                    &mut Context::from_waker(Waker::noop())
                ),
                Poll::Pending
            ));
            drop(first);
            assert_eq!(coordinator.available(), 1);
            drop(second);
            assert_eq!(coordinator.available(), 2);
        });
    }

    #[test]
    fn probe_worker_limit_is_bounded_and_nonzero() {
        let limit = probe_worker_limit();
        assert!((1..=MAX_PROBE_WORKERS).contains(&limit));
        assert_eq!(CoverSourceCoordinator::with_slots(0).slots, 1);
        assert_eq!(CoverSourceCoordinator::with_slots(64).slots, 64);
    }
}
