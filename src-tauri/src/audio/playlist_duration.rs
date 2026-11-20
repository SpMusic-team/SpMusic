//! Authoritative playlist duration probe.
//!
//! This is the only channel allowed to publish a playlist duration (risk R1 in
//! `docs/architecture/playlist-duration-cache.md`): it validates the path,
//! probes the container once per unique file per batch, and reports one item per
//! requested path in the requested order.
//!
//! Two independent cost controls keep a large playlist affordable without
//! changing the command contract:
//!
//! - a bounded worker pool (`std::thread::scope`, [`WORKER_THREADS`]) inside one
//!   batch, while [`DURATION_GATE`] still serializes whole batches;
//! - a process-local, identity-validated [`DurationCache`] so a file that has
//!   not changed is never opened again.
//!
//! The batch limit [`MAX_DURATION_BATCH_PATHS`] has a same-source twin on the
//! frontend (`AUDIO_PLAYLIST_DURATION_BATCH_LIMIT`); both must change together (risk R7).

use std::{
    cell::RefCell,
    collections::HashMap,
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, OnceLock,
    },
    time::{Duration, Instant},
};

use tauri::async_runtime::Mutex;

use super::{
    duration::{decode_duration, duration_ms},
    duration_cache::{duration_cache_key, DurationCache, DurationOutcome},
    error::{audio_error, AudioCommandError, AudioErrorCode},
    source::{input_path, validate_existing_file},
    types::{AudioPlaylistDurationItem, AudioProbePlaylistDurationsInput},
};

/// Upper bound per batch (IPC payload and tail latency). Kept in sync with the
/// frontend constant `AUDIO_PLAYLIST_DURATION_BATCH_LIMIT`; exceeding it rejects
/// the whole batch with `INVALID_PATH`.
pub const MAX_DURATION_BATCH_PATHS: usize = 256;

/// Fixed fan-out inside a batch. Eight decoder-capable probes saturate a local
/// disk; more would only compete with the playback thread (risk R9).
const WORKER_THREADS: usize = 8;

const OPERATION: &str = "audio.playlist_durations";

/// Serializes duration batches against each other only. It stays independent
/// from `playlist_summary::TRACK_SUMMARY_GATE`: cheap tag reads must never wait
/// behind a decoder-backed duration probe, and vice versa.
static DURATION_GATE: OnceLock<Arc<Mutex<()>>> = OnceLock::new();

/// One file per batch, addressed by its stable cache key.
struct ProbeTarget {
    key: String,
    path: PathBuf,
}

/// One output slot: either settled up front (invalid path) or backed by a
/// shared probe target. Duplicates of one file share a single target, so a batch
/// never opens the same file twice.
enum Slot {
    Settled(AudioPlaylistDurationItem),
    Pending(usize),
}

struct BatchReport {
    items: Vec<AudioPlaylistDurationItem>,
    worker_count: usize,
    unique_paths: usize,
    dropped_workers: usize,
    error_count: usize,
    cache_hits: u64,
    cache_misses: u64,
    cache_entries: usize,
    elapsed_ms: u128,
}

/// Reads the duration of a batch of local audio paths.
///
/// The command name, its input, its output DTO and its error codes are
/// unchanged: output order always matches the input order, duplicates occupy one
/// item each, and `source_path` echoes the requested string verbatim.
pub async fn probe_playlist_durations(
    input: AudioProbePlaylistDurationsInput,
    cache: Arc<DurationCache>,
) -> Result<Vec<AudioPlaylistDurationItem>, AudioCommandError> {
    if input.paths.len() > MAX_DURATION_BATCH_PATHS {
        return Err(audio_error(
            AudioErrorCode::InvalidPath,
            format!(
                "Playlist duration probe accepts at most {MAX_DURATION_BATCH_PATHS} paths per batch"
            ),
            true,
        ));
    }
    if input.paths.is_empty() {
        return Ok(Vec::new());
    }

    let gate = DURATION_GATE
        .get_or_init(|| Arc::new(Mutex::new(())))
        .clone();
    run_duration_worker(gate, move || probe_batch(&input.paths, &cache)).await
}

async fn run_duration_worker(
    gate: Arc<Mutex<()>>,
    probe: impl FnOnce() -> Vec<AudioPlaylistDurationItem> + Send + 'static,
) -> Result<Vec<AudioPlaylistDurationItem>, AudioCommandError> {
    let permit = gate.lock_owned().await;
    tauri::async_runtime::spawn_blocking(move || {
        // The blocking worker owns the permit: dropping or cancelling the caller
        // must not let another batch start while this file I/O is still running.
        let _permit = permit;
        probe()
    })
    .await
    .map_err(|error| {
        tracing::error!(
            operation = "audio.playlist_duration.join",
            error = %error,
            "playlist duration worker failed",
        );
        audio_error(
            AudioErrorCode::InternalError,
            "Playlist duration worker failed",
            true,
        )
    })
}

fn probe_batch(paths: &[String], cache: &DurationCache) -> Vec<AudioPlaylistDurationItem> {
    let report = run_batch(paths, cache, &production_probe);
    tracing::debug!(
        operation = OPERATION,
        batch_size = report.items.len(),
        unique_paths = report.unique_paths,
        worker_count = report.worker_count,
        dropped_workers = report.dropped_workers,
        error_count = report.error_count,
        cache_hits = report.cache_hits,
        cache_misses = report.cache_misses,
        cache_entries = report.cache_entries,
        elapsed_ms = report.elapsed_ms,
        "probed playlist durations",
    );
    report.items
}

/// Probes one batch on a fixed set of scoped worker threads.
///
/// Every worker claims the next *unique file* from a shared atomic counter, so a
/// slow file never blocks the tail of the batch and no worker can be handed the
/// same index twice. Results are written back into ordered slots afterwards.
fn run_batch<F>(paths: &[String], cache: &DurationCache, probe: &F) -> BatchReport
where
    F: Fn(&DurationCache, &ProbeTarget) -> Result<Option<u64>, AudioCommandError> + Sync,
{
    let started_at = Instant::now();
    let stats_before = cache.stats();
    let total = paths.len();

    let mut slots: Vec<Slot> = Vec::with_capacity(total);
    let mut targets: Vec<ProbeTarget> = Vec::new();
    let mut target_index: HashMap<String, usize> = HashMap::new();

    for source_path in paths {
        let path = match input_path(source_path) {
            Ok(path) => path,
            Err(error) => {
                // Pure validation, no file I/O: settle the item immediately and
                // keep it out of the worker pool.
                slots.push(Slot::Settled(AudioPlaylistDurationItem {
                    source_path: source_path.clone(),
                    duration_ms: None,
                    error: Some(error),
                }));
                continue;
            }
        };
        let key = duration_cache_key(&path);
        let index = match target_index.get(&key) {
            Some(index) => *index,
            None => {
                let index = targets.len();
                target_index.insert(key.clone(), index);
                targets.push(ProbeTarget { key, path });
                index
            }
        };
        slots.push(Slot::Pending(index));
    }

    let worker_count = WORKER_THREADS.min(targets.len());
    let next_index = AtomicUsize::new(0);
    let mut results: Vec<Option<Result<Option<u64>, AudioCommandError>>> =
        (0..targets.len()).map(|_| None).collect();
    let mut dropped_workers = 0_usize;

    std::thread::scope(|scope| {
        let handles = (0..worker_count)
            .map(|_| {
                scope.spawn(|| {
                    let mut claimed = Vec::new();
                    loop {
                        let index = next_index.fetch_add(1, Ordering::Relaxed);
                        if index >= targets.len() {
                            break;
                        }
                        claimed.push((index, probe(cache, &targets[index])));
                    }
                    claimed
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            match handle.join() {
                Ok(claimed) => {
                    for (index, outcome) in claimed {
                        results[index] = Some(outcome);
                    }
                }
                Err(_) => dropped_workers += 1,
            }
        }
    });

    let mut items = Vec::with_capacity(total);
    for (source_path, slot) in paths.iter().zip(slots) {
        items.push(match slot {
            Slot::Settled(item) => item,
            // Cloned, not taken: every duplicate of one file shares the same
            // settled result slot.
            Slot::Pending(index) => match results.get(index).cloned().flatten() {
                Some(Ok(duration_ms)) => AudioPlaylistDurationItem {
                    source_path: source_path.clone(),
                    duration_ms,
                    error: None,
                },
                Some(Err(error)) => AudioPlaylistDurationItem {
                    source_path: source_path.clone(),
                    duration_ms: None,
                    error: Some(error),
                },
                None => {
                    // Defensive: a worker that escaped the per-target
                    // `catch_unwind` must still leave a complete, ordered batch.
                    dropped_workers = dropped_workers.max(1);
                    AudioPlaylistDurationItem {
                        source_path: source_path.clone(),
                        duration_ms: None,
                        error: Some(audio_error(
                            AudioErrorCode::InternalError,
                            "Playlist duration worker dropped this item",
                            true,
                        )),
                    }
                }
            },
        });
    }

    let stats_after = cache.stats();
    BatchReport {
        error_count: items.iter().filter(|item| item.error.is_some()).count(),
        items,
        worker_count,
        unique_paths: targets.len(),
        dropped_workers,
        cache_hits: stats_after.hits.saturating_sub(stats_before.hits),
        cache_misses: stats_after.misses.saturating_sub(stats_before.misses),
        cache_entries: cache.len(),
        elapsed_ms: started_at.elapsed().as_millis(),
    }
}

/// The production probe: validate, then decode, then map to a cache outcome.
fn production_probe(
    cache: &DurationCache,
    target: &ProbeTarget,
) -> Result<Option<u64>, AudioCommandError> {
    probe_through_cache(cache, target, |path| {
        validate_existing_file(path).and_then(|()| decode_duration(path))
    })
}

/// Shared probe plumbing for the production probe and the test seam: the panic
/// guard lives here, so a panicking file becomes one `INTERNAL_ERROR` item.
fn probe_through_cache<F>(
    cache: &DurationCache,
    target: &ProbeTarget,
    decode: F,
) -> Result<Option<u64>, AudioCommandError>
where
    F: FnOnce(&Path) -> Result<Option<Duration>, AudioCommandError>,
{
    // The closure runs at most once and on this thread, so a plain `RefCell` is
    // enough to keep the exact probe error while the cache only sees a tri-state
    // outcome (`Unavailable` is never stored).
    let failure = RefCell::new(None);
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        cache.get_or_probe(&target.key, &target.path, |path| match decode(path) {
            Ok(Some(duration)) => {
                let value = duration_ms(duration);
                if value == 0 {
                    // `durationMs === 0` must never reach the frontend; a
                    // zero-length duration is an unknown duration.
                    DurationOutcome::Unknown
                } else {
                    DurationOutcome::Known(value)
                }
            }
            Ok(None) => DurationOutcome::Unknown,
            Err(error) => {
                *failure.borrow_mut() = Some(error);
                DurationOutcome::Unavailable
            }
        })
    }));

    match outcome {
        Ok(DurationOutcome::Known(duration_ms)) => Ok(Some(duration_ms)),
        Ok(DurationOutcome::Unknown) => Ok(None),
        Ok(DurationOutcome::Unavailable) => Err(failure.into_inner().unwrap_or_else(|| {
            audio_error(
                AudioErrorCode::InternalError,
                "Playlist duration probe was unavailable",
                true,
            )
        })),
        Err(payload) => {
            tracing::error!(
                operation = OPERATION,
                path = %target.path.display(),
                panic = %panic_message(payload.as_ref()),
                "playlist duration item panicked",
            );
            Err(audio_error(
                AudioErrorCode::InternalError,
                "Playlist duration probe panicked",
                true,
            ))
        }
    }
}

fn panic_message(payload: &(dyn std::any::Any + Send)) -> &str {
    payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("unknown panic payload")
}

#[cfg(test)]
fn probe_one(source_path: String) -> AudioPlaylistDurationItem {
    let cache = DurationCache::new();
    probe_batch(std::slice::from_ref(&source_path), &cache)
        .pop()
        .expect("a single-path batch always returns one item")
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        fs,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicU64, Ordering},
            mpsc,
        },
        time::Duration,
    };

    use super::*;

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        root: PathBuf,
        wav: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "spmusic-playlist-duration-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&root).unwrap();
            let wav = root.join("时长.wav");
            fs::write(&wav, one_second_wav()).unwrap();
            Self { root, wav }
        }

        fn wav_path(&self) -> String {
            self.wav.to_string_lossy().into_owned()
        }

        /// Every file and directory below `root` with its length: proves that a
        /// probe wrote nothing (risk R2).
        fn listing(&self) -> BTreeMap<String, u64> {
            fn walk(root: &Path, current: &Path, out: &mut BTreeMap<String, u64>) {
                for entry in fs::read_dir(current).unwrap() {
                    let path = entry.unwrap().path();
                    if path.is_dir() {
                        out.insert(
                            format!("{}/", path.strip_prefix(root).unwrap().display()),
                            0,
                        );
                        walk(root, &path, out);
                    } else {
                        out.insert(
                            path.strip_prefix(root).unwrap().display().to_string(),
                            fs::metadata(&path).unwrap().len(),
                        );
                    }
                }
            }

            let mut out = BTreeMap::new();
            walk(&self.root, &self.root, &mut out);
            out
        }

        /// Name set *and* modification time of every entry below `root`: catches
        /// an in-place rewrite that leaves the length unchanged (AC-11).
        fn mtimes(&self) -> BTreeMap<String, Option<std::time::SystemTime>> {
            fn walk(
                root: &Path,
                current: &Path,
                out: &mut BTreeMap<String, Option<std::time::SystemTime>>,
            ) {
                for entry in fs::read_dir(current).unwrap() {
                    let path = entry.unwrap().path();
                    let key = path.strip_prefix(root).unwrap().display().to_string();
                    let modified = fs::metadata(&path)
                        .ok()
                        .and_then(|meta| meta.modified().ok());
                    out.insert(key, modified);
                    if path.is_dir() {
                        walk(root, &path, out);
                    }
                }
            }

            let mut out = BTreeMap::new();
            walk(&self.root, &self.root, &mut out);
            out
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    /// One second of 8 kHz mono 16-bit PCM, generated without external tools.
    fn one_second_wav() -> Vec<u8> {
        let data_len = 16_000_u32;
        let mut bytes = Vec::with_capacity(44 + data_len as usize);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&8_000_u32.to_le_bytes());
        bytes.extend_from_slice(&16_000_u32.to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        bytes.resize(44 + data_len as usize, 0);
        bytes
    }

    /// Runs a batch through the real command surface with a throwaway cache.
    fn batch(paths: Vec<String>) -> Vec<AudioPlaylistDurationItem> {
        batch_with(paths, Arc::new(DurationCache::new()))
    }

    /// Runs a batch against the caller's cache so a second call can hit it.
    fn batch_with(paths: Vec<String>, cache: Arc<DurationCache>) -> Vec<AudioPlaylistDurationItem> {
        tauri::async_runtime::block_on(probe_playlist_durations(
            AudioProbePlaylistDurationsInput { paths },
            cache,
        ))
        .expect("batch should not be rejected")
    }

    #[test]
    fn batch_probes_real_wav_preserves_order_duplicates_and_exact_path_echo() {
        let fixture = Fixture::new();
        let wav = fixture.wav_path();
        let alternate = fixture
            .root
            .join(".")
            .join("时长.wav")
            .to_string_lossy()
            .into_owned();
        let missing = fixture
            .root
            .join("missing.wav")
            .to_string_lossy()
            .into_owned();
        let paths = vec![wav.clone(), missing, alternate, wav];
        let original = fs::read(&fixture.wav).unwrap();
        let result = batch(paths.clone());

        assert_eq!(result.len(), paths.len());
        for (item, requested) in result.iter().zip(&paths) {
            assert_eq!(&item.source_path, requested);
        }
        for index in [0, 2, 3] {
            assert_eq!(result[index].duration_ms, Some(1_000));
            assert!(result[index].error.is_none());
        }
        assert_eq!(result[1].duration_ms, None);
        assert_eq!(
            result[1].error.as_ref().unwrap().code,
            AudioErrorCode::FileNotFound
        );
        assert_eq!(fs::read(&fixture.wav).unwrap(), original);
        assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 1);
    }

    #[test]
    fn equivalent_paths_in_one_batch_probe_the_file_exactly_once() {
        let fixture = Fixture::new();
        let wav = fixture.wav_path();
        let alternate = fixture
            .root
            .join(".")
            .join("时长.wav")
            .to_string_lossy()
            .into_owned();
        let cache = DurationCache::new();
        let paths = vec![wav.clone(), alternate, wav];
        let report = run_batch(&paths, &cache, &production_probe);

        assert_eq!(report.items.len(), 3);
        assert!(report
            .items
            .iter()
            .all(|item| item.duration_ms == Some(1_000)));
        // One file, one probe: duplicates and equivalent spellings share a slot,
        // so the batch never opens the same file twice (AC-02).
        assert_eq!(report.unique_paths, 1);
        assert_eq!(report.worker_count, 1);
        assert_eq!(report.cache_misses, 1);
        assert_eq!(report.cache_entries, 1);
        for (item, requested) in report.items.iter().zip(&paths) {
            assert_eq!(&item.source_path, requested);
        }
    }

    #[test]
    fn second_batch_after_a_first_probe_is_served_without_opening_the_file() {
        let fixture = Fixture::new();
        let wav = fixture.wav_path();
        let cache = Arc::new(DurationCache::new());
        let first = batch_with(vec![wav.clone()], Arc::clone(&cache));
        assert_eq!(first[0].duration_ms, Some(1_000));
        let misses_after_cold = cache.stats().misses;
        assert_eq!(misses_after_cold, 1);

        let before = fs::read(&fixture.wav).unwrap();
        let second = batch_with(vec![wav], Arc::clone(&cache));
        assert_eq!(second[0].duration_ms, Some(1_000));
        // A hit is a hit: no additional probe happened, and the file is untouched.
        assert_eq!(cache.stats().misses, misses_after_cold);
        assert_eq!(cache.stats().hits, 1);
        assert_eq!(fs::read(&fixture.wav).unwrap(), before);
    }

    #[test]
    fn rewritten_file_is_probed_again_and_reports_the_new_duration() {
        let fixture = Fixture::new();
        let wav = fixture.wav_path();
        let cache = Arc::new(DurationCache::new());
        assert_eq!(
            batch_with(vec![wav.clone()], Arc::clone(&cache))[0].duration_ms,
            Some(1_000)
        );

        // A two second WAV replaces the one second file at the same path.
        let mut longer = one_second_wav();
        longer.extend_from_slice(&one_second_wav()[44..]);
        let riff_len = (longer.len() - 8) as u32;
        let data_len = (longer.len() - 44) as u32;
        longer[4..8].copy_from_slice(&riff_len.to_le_bytes());
        longer[40..44].copy_from_slice(&data_len.to_le_bytes());
        fs::write(&fixture.wav, longer).unwrap();

        let result = batch_with(vec![wav], Arc::clone(&cache));
        assert_eq!(result[0].duration_ms, Some(2_000));
        assert!(result[0].error.is_none());
        assert_eq!(
            cache.stats(),
            super::super::duration_cache::DurationCacheStats { hits: 0, misses: 2 }
        );
    }

    #[test]
    fn zero_byte_file_is_never_cached_and_keeps_reporting_an_error() {
        let fixture = Fixture::new();
        let empty = fixture.root.join("empty.wav");
        fs::write(&empty, b"").unwrap();
        let path = empty.to_string_lossy().into_owned();
        let cache = Arc::new(DurationCache::new());

        for _ in 0..2 {
            let report = run_batch(std::slice::from_ref(&path), &cache, &production_probe);
            assert_eq!(report.items[0].duration_ms, None);
            assert!(report.items[0].error.is_some());
            // The identity is unusable, so the cache stays untouched and the
            // next call probes again (AC-06).
            assert_eq!(report.cache_misses, 0);
            assert_eq!(report.cache_entries, 0);
        }
        assert_eq!(cache.stats(), Default::default());
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn corrupted_file_error_is_not_cached_so_a_fixed_file_becomes_readable() {
        let fixture = Fixture::new();
        let path = fixture.root.join("broken.wav");
        fs::write(&path, b"not an audio stream").unwrap();
        let source = path.to_string_lossy().into_owned();
        let cache = Arc::new(DurationCache::new());

        let broken = batch_with(vec![source.clone()], Arc::clone(&cache));
        assert_eq!(
            broken[0].error.as_ref().unwrap().code,
            AudioErrorCode::UnsupportedFormat
        );
        assert_eq!(cache.len(), 0, "probe errors are never cached (risk R4)");

        // Repaired in place: the very next batch must report a duration without
        // restarting the app.
        fs::write(&path, one_second_wav()).unwrap();
        let repaired = batch_with(vec![source], Arc::clone(&cache));
        assert_eq!(repaired[0].duration_ms, Some(1_000));
        assert!(repaired[0].error.is_none());
    }

    #[test]
    fn worker_count_is_bounded_and_order_survives_the_worker_pool() {
        let fixture = Fixture::new();
        // Ten distinct files: enough to fill all eight workers, and enough to
        // show that the slot write-back keeps the requested order.
        let mut paths = Vec::new();
        for index in 0..10 {
            let path = fixture.root.join(format!("track-{index:02}.wav"));
            fs::write(&path, one_second_wav()).unwrap();
            paths.push(path.to_string_lossy().into_owned());
        }
        let cache = DurationCache::new();
        let report = run_batch(&paths, &cache, &production_probe);

        assert_eq!(report.worker_count, WORKER_THREADS.min(paths.len()));
        assert_eq!(report.worker_count, 8);
        assert_eq!(report.unique_paths, 10);
        assert_eq!(report.dropped_workers, 0);
        assert_eq!(report.error_count, 0);
        assert_eq!(report.cache_misses, 10);
        assert_eq!(report.items.len(), paths.len());
        for (item, requested) in report.items.iter().zip(&paths) {
            assert_eq!(&item.source_path, requested);
            assert_eq!(item.duration_ms, Some(1_000));
        }
    }

    #[test]
    fn small_batches_use_one_worker_per_path() {
        let fixture = Fixture::new();
        let cache = DurationCache::new();
        let report = run_batch(
            std::slice::from_ref(&fixture.wav_path()),
            &cache,
            &production_probe,
        );
        assert_eq!(report.worker_count, 1);
        assert_eq!(report.unique_paths, 1);
        assert_eq!(report.items.len(), 1);
    }

    #[test]
    fn folder_and_m3u8_duration_probes_use_the_same_audio_source() {
        let fixture = Fixture::new();
        let folder = super::super::playlist::load_folder_playlist(&fixture.wav).unwrap();
        let playlist_path = fixture.root.join("same-song.m3u8");
        fs::write(
            &playlist_path,
            "#EXTM3U\n#EXTINF:999,Incorrect tag duration\n时长.wav\n",
        )
        .unwrap();
        let m3u8 = super::super::playlist::load_folder_playlist(&playlist_path).unwrap();
        assert_eq!(folder.tracks.len(), 1);
        assert_eq!(m3u8.tracks.len(), 1);
        assert_eq!(folder.tracks[0].source_path, m3u8.tracks[0].source_path);
        assert!(m3u8.tracks[0].available);
        for playlist in [folder, m3u8] {
            let result = batch(
                playlist
                    .tracks
                    .iter()
                    .map(|track| track.source_path.clone())
                    .collect(),
            );
            assert_eq!(result[0].duration_ms, Some(1_000));
            assert!(result[0].error.is_none());
        }
    }

    #[test]
    fn m3u8_keeps_missing_entries_and_probes_remaining_durations() {
        let fixture = Fixture::new();
        let missing = fixture.root.join("missing.mp3");
        let playlist_path = fixture.root.join("missing-entry.m3u8");
        fs::write(
            &playlist_path,
            format!(
                "#EXTM3U\n#EXT-X-RATING:0\n{}\n#EXT-X-RATING:0\n{}\n",
                fixture.wav.to_string_lossy().replace('\\', "/"),
                missing.to_string_lossy().replace('\\', "/"),
            ),
        )
        .unwrap();
        let original = fs::read(&playlist_path).unwrap();
        let playlist = super::super::playlist::load_folder_playlist(&playlist_path).unwrap();
        assert_eq!(playlist.tracks.len(), 2);
        assert!(playlist.tracks[0].available);
        assert!(!playlist.tracks[1].available);
        let items = batch(
            playlist
                .tracks
                .iter()
                .map(|track| track.source_path.clone())
                .collect(),
        );
        assert_eq!(items[0].duration_ms, Some(1_000));
        assert!(items[0].error.is_none());
        assert_eq!(items[1].duration_ms, None);
        assert_eq!(
            items[1].error.as_ref().unwrap().code,
            AudioErrorCode::FileNotFound
        );
        assert_eq!(fs::read(&playlist_path).unwrap(), original);
        assert!(!missing.exists());
    }

    #[test]
    fn m3u8_file_uri_decodes_encoded_unicode_and_spaces_before_duration_probe() {
        let fixture = Fixture::new();
        let spaced = fixture.root.join("时长 空格%23.wav");
        fs::copy(&fixture.wav, &spaced).unwrap();
        let plain = spaced.to_string_lossy().replace('\\', "/");
        let encoded = plain
            .as_bytes()
            .iter()
            .map(|byte| {
                if byte.is_ascii_alphanumeric() || b"/:.-_".contains(byte) {
                    char::from(*byte).to_string()
                } else {
                    format!("%{byte:02X}")
                }
            })
            .collect::<String>();
        let uri = if cfg!(windows) {
            format!("file:///{encoded}")
        } else {
            format!("file://{encoded}")
        };
        let playlist_path = fixture.root.join("uri.m3u8");
        fs::write(&playlist_path, format!("#EXTM3U\n{uri}\n")).unwrap();
        let playlist = super::super::playlist::load_folder_playlist(&playlist_path).unwrap();
        assert_eq!(playlist.tracks.len(), 1);
        assert!(
            playlist.tracks[0].available,
            "existing URI-encoded audio must remain available"
        );
        assert_eq!(
            playlist.tracks[0].source_path,
            spaced.canonicalize().unwrap().to_string_lossy()
        );
        let result = batch(
            playlist
                .tracks
                .iter()
                .map(|track| track.source_path.clone())
                .collect(),
        );
        assert_eq!(result[0].duration_ms, Some(1_000));
        assert!(result[0].error.is_none());
    }

    #[test]
    fn m3u8_bare_paths_keep_literal_percent_sequences() {
        let fixture = Fixture::new();
        let literal = fixture.root.join("literal%20name.wav");
        fs::copy(&fixture.wav, &literal).unwrap();
        let playlist_path = fixture.root.join("literal.m3u8");
        fs::write(&playlist_path, "literal%20name.wav\n").unwrap();
        let playlist = super::super::playlist::load_folder_playlist(&playlist_path).unwrap();
        assert_eq!(playlist.tracks.len(), 1);
        assert!(playlist.tracks[0].available);
        assert_eq!(
            playlist.tracks[0].source_path,
            literal.canonicalize().unwrap().to_string_lossy()
        );
        let result = probe_one(playlist.tracks[0].source_path.clone());
        assert_eq!(result.duration_ms, Some(1_000));
    }

    #[test]
    fn m3u8_rejects_malformed_or_non_utf8_file_uris_without_path_fallback() {
        let fixture = Fixture::new();
        let playlist_path = fixture.root.join("invalid.m3u8");
        let prefix = if cfg!(windows) {
            "file:///C:/"
        } else {
            "file:///"
        };
        fs::write(&playlist_path, format!(
            "{prefix}invalid%GG.wav\n{prefix}invalid%.wav\n{prefix}invalid%2.wav\n{prefix}invalid%FF.wav\n{prefix}invalid%00.wav\n时长.wav\n"
        )).unwrap();
        let playlist = super::super::playlist::load_folder_playlist(&playlist_path).unwrap();
        assert_eq!(playlist.tracks.len(), 1);
        assert!(playlist.tracks[0].available);
        assert_eq!(
            probe_one(playlist.tracks[0].source_path.clone()).duration_ms,
            Some(1_000)
        );
    }

    #[test]
    fn sibling_m3u8_file_uri_applies_directory_boundary_after_decoding() {
        let fixture = Fixture::new();
        let inside = fixture.root.join("inside");
        fs::create_dir(&inside).unwrap();
        let selected = inside.join("selected.wav");
        fs::copy(&fixture.wav, &selected).unwrap();
        let plain = inside.to_string_lossy().replace('\\', "/");
        let uri = if cfg!(windows) {
            format!("file:///{plain}/%2e%2e/时长.wav")
        } else {
            format!("file://{plain}/%2e%2e/时长.wav")
        };
        fs::write(
            inside.join("boundary.m3u8"),
            format!("{uri}\nselected.wav\n"),
        )
        .unwrap();
        let playlist = super::super::playlist::load_folder_playlist(&selected).unwrap();
        assert_eq!(playlist.tracks.len(), 1);
        assert_eq!(
            playlist.tracks[0].source_path,
            selected.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(
            probe_one(playlist.tracks[0].source_path.clone()).duration_ms,
            Some(1_000)
        );
    }

    #[test]
    fn invalid_and_corrupt_files_are_per_item_errors() {
        let fixture = Fixture::new();
        let bad = fixture.root.join("bad.wav");
        fs::write(&bad, b"not an audio stream").unwrap();
        let result = batch(vec![
            "  ".into(),
            fixture.root.to_string_lossy().into_owned(),
            bad.to_string_lossy().into_owned(),
        ]);
        assert_eq!(result.len(), 3);
        for (item, code) in result.iter().zip([
            AudioErrorCode::InvalidPath,
            AudioErrorCode::InvalidPath,
            AudioErrorCode::UnsupportedFormat,
        ]) {
            assert_eq!(item.duration_ms, None);
            assert_eq!(item.error.as_ref().unwrap().code, code);
        }
    }

    #[test]
    fn unknown_duration_is_null_without_an_error_in_frontend_serialization() {
        // Unknown is a valid probe outcome, distinct from a failed file probe.
        let fixture = Fixture::new();
        let item = AudioPlaylistDurationItem {
            source_path: fixture.wav_path(),
            duration_ms: None,
            error: None,
        };
        let value = serde_json::to_value(item).unwrap();
        assert_eq!(value["sourcePath"], fixture.wav_path());
        assert!(value["durationMs"].is_null());
        assert!(value["error"].is_null());
        assert!(value.get("source_path").is_none());
    }

    #[test]
    fn empty_batch_and_batch_limit_are_enforced_before_file_io() {
        let empty = tauri::async_runtime::block_on(probe_playlist_durations(
            serde_json::from_value(serde_json::json!({ "paths": [] })).unwrap(),
            Arc::new(DurationCache::new()),
        ))
        .unwrap();
        assert!(empty.is_empty());
        let accepted = tauri::async_runtime::block_on(probe_playlist_durations(
            AudioProbePlaylistDurationsInput {
                paths: vec!["".into(); MAX_DURATION_BATCH_PATHS],
            },
            Arc::new(DurationCache::new()),
        ))
        .unwrap();
        assert_eq!(accepted.len(), MAX_DURATION_BATCH_PATHS);
        assert_eq!(MAX_DURATION_BATCH_PATHS, 256);
        let rejected = tauri::async_runtime::block_on(probe_playlist_durations(
            AudioProbePlaylistDurationsInput {
                paths: vec!["".into(); MAX_DURATION_BATCH_PATHS + 1],
            },
            Arc::new(DurationCache::new()),
        ))
        .unwrap_err();
        assert_eq!(
            serde_json::to_value(rejected).unwrap()["code"],
            "INVALID_PATH"
        );
    }

    #[test]
    fn empty_batch_does_not_touch_the_filesystem_at_all() {
        let fixture = Fixture::new();
        let before = fixture.listing();
        let cache = Arc::new(DurationCache::new());
        let result = batch_with(Vec::new(), Arc::clone(&cache));
        assert!(result.is_empty());
        assert_eq!(fixture.listing(), before);
        assert_eq!(cache.stats(), Default::default());
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn batch_probe_writes_no_file_and_creates_no_cache_directory() {
        // Risk R2: the cross-process cache is explicitly out of scope, so the
        // probe must remain a pure read. The fixture root doubles as a stand-in
        // for `cache_dir`.
        let fixture = Fixture::new();
        let before = fixture.listing();
        let before_mtimes = fixture.mtimes();
        let wav = fixture.wav_path();
        let items = batch(vec![wav.clone(), wav.clone(), wav]);
        assert_eq!(items.len(), 3);
        assert!(items.iter().all(|item| item.duration_ms == Some(1_000)));
        assert_eq!(fixture.listing(), before, "the probe must write nothing");
        assert_eq!(
            fixture.mtimes(),
            before_mtimes,
            "the probe must not rewrite the audio file in place either"
        );
        for forbidden in [
            "playlist_durations",
            "audio",
            "covers",
            ".spmusic",
            "playlist_durations.json",
        ] {
            assert!(
                !fixture.root.join(forbidden).exists(),
                "{forbidden} must never be created by the duration channel"
            );
        }
        assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 1);
    }

    #[test]
    fn duration_gate_serializes_two_concurrent_batches() {
        // AC-03: the gate is still a whole-batch mutex. Two concurrently
        // submitted batches must not overlap their blocking work.
        let fixture = Fixture::new();
        let wav = fixture.wav_path();
        let cache = Arc::new(DurationCache::new());
        let running = Arc::new(AtomicU64::new(0));
        let max_running = Arc::new(AtomicU64::new(0));

        let mut tasks = Vec::new();
        for _ in 0..2 {
            let cache = Arc::clone(&cache);
            let wav = wav.clone();
            let running = Arc::clone(&running);
            let max_running = Arc::clone(&max_running);
            tasks.push(tauri::async_runtime::spawn(async move {
                let gate = DURATION_GATE
                    .get_or_init(|| Arc::new(Mutex::new(())))
                    .clone();
                run_duration_worker(gate, move || {
                    let active = running.fetch_add(1, Ordering::SeqCst) + 1;
                    max_running.fetch_max(active, Ordering::SeqCst);
                    // A tiny window is enough for a second batch to overlap if
                    // the gate were missing.
                    std::thread::sleep(Duration::from_millis(20));
                    let items = probe_batch(std::slice::from_ref(&wav), &cache);
                    running.fetch_sub(1, Ordering::SeqCst);
                    items
                })
                .await
            }));
        }
        for task in tasks {
            let items = tauri::async_runtime::block_on(task)
                .expect("task should join")
                .expect("batch should be accepted");
            assert_eq!(items.len(), 1);
            assert_eq!(items[0].duration_ms, Some(1_000));
        }
        assert_eq!(
            max_running.load(Ordering::SeqCst),
            1,
            "DURATION_GATE must keep batches from overlapping"
        );
    }

    #[test]
    fn panicking_item_is_isolated_and_releases_the_batch_permit() {
        let fixture = Fixture::new();
        let clean = fixture.root.join("clean.wav");
        fs::copy(&fixture.wav, &clean).unwrap();
        let clean_source = clean.to_string_lossy().into_owned();
        let poisoned_source = fixture.wav_path();
        let poisoned = PathBuf::from(&poisoned_source);
        // The panic is injected inside the decode stage, which is exactly the
        // region the per-item guard wraps, so it must not escape the item.
        let probe = |cache: &DurationCache, target: &ProbeTarget| {
            probe_through_cache(cache, target, |path| {
                if target.path == poisoned {
                    panic!("synthetic per-item failure");
                }
                validate_existing_file(path).and_then(|()| decode_duration(path))
            })
        };

        // The per-item `catch_unwind` folds one panicking file into a single
        // `INTERNAL_ERROR` item; the healthy neighbour and the batch survive.
        let cache = DurationCache::new();
        let report = run_batch(
            &[clean_source.clone(), poisoned_source.clone()],
            &cache,
            &probe,
        );
        assert_eq!(report.items.len(), 2);
        assert_eq!(report.items[0].source_path, clean_source);
        assert_eq!(report.items[0].duration_ms, Some(1_000));
        assert!(report.items[0].error.is_none());
        assert_eq!(report.items[1].source_path, poisoned_source);
        assert_eq!(report.items[1].duration_ms, None);
        assert_eq!(
            report.items[1].error.as_ref().unwrap().code,
            AudioErrorCode::InternalError
        );
        // No worker was lost: the panic was contained, so the batch keeps its
        // workers and the gate is released normally (AC-10).
        assert_eq!(
            report.dropped_workers, 0,
            "the panic must stay inside one item"
        );
        assert_eq!(report.error_count, 1);

        // The blocking worker released the permit, so the next batch runs.
        let gate = Arc::new(Mutex::new(()));
        let items = tauri::async_runtime::block_on(run_duration_worker(gate.clone(), Vec::new))
            .expect("the next batch must still be able to take the permit");
        assert!(items.is_empty());
        assert!(gate.try_lock().is_ok());
    }

    #[test]
    fn cancelled_caller_keeps_gate_until_blocking_worker_finishes() {
        let gate = Arc::new(Mutex::new(()));
        let (started, did_start) = mpsc::channel();
        let (release, wait_release) = mpsc::channel();
        let task = tauri::async_runtime::spawn(run_duration_worker(gate.clone(), move || {
            started.send(()).unwrap();
            wait_release.recv().unwrap();
            Vec::new()
        }));
        did_start.recv_timeout(Duration::from_secs(5)).unwrap();
        task.abort();
        assert!(tauri::async_runtime::block_on(task).is_err());
        let held = gate.try_lock().is_err();
        release.send(()).unwrap();
        assert!(
            held,
            "cancelled caller must not release the running worker's gate"
        );
        let recovered =
            tauri::async_runtime::block_on(run_duration_worker(gate, Vec::new)).unwrap();
        assert!(recovered.is_empty());
    }

    #[test]
    fn worker_failure_is_stable_and_releases_gate_for_the_next_batch() {
        let gate = Arc::new(Mutex::new(()));
        let error = tauri::async_runtime::block_on(run_duration_worker(gate.clone(), || {
            panic!("synthetic worker failure")
        }))
        .unwrap_err();
        assert_eq!(
            serde_json::to_value(error).unwrap()["code"],
            "INTERNAL_ERROR"
        );
        let recovered =
            tauri::async_runtime::block_on(run_duration_worker(gate, Vec::new)).unwrap();
        assert!(recovered.is_empty());
    }
}
