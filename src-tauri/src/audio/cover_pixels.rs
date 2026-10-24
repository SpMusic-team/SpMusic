#[cfg(test)]
use std::time::Instant;
use std::{
    collections::{HashMap, VecDeque},
    fs::{self, File, OpenOptions},
    future::Future,
    io::{self, Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Condvar, Mutex as StdMutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use image::{
    imageops::FilterType, metadata::Orientation, DynamicImage, GenericImageView, ImageDecoder,
    ImageError, ImageReader, Limits,
};
use serde::{Deserialize, Serialize};

const COVER_DIRECTORY: &str = "covers";
const AUDIO_CACHE_DIRECTORY: &str = "audio";
const MAX_INPUT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_SOURCE_EDGE: u32 = 16_384;
const MAX_SOURCE_PIXELS: u64 = 64 * 1024 * 1024;
const MAX_DECODE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_OUTPUT_BYTES: u64 = 3072 * 3072 * 4;

const HEADER_MAGIC: [u8; 4] = *b"SPXR";
const HEADER_VERSION: u16 = 1;
const HEADER_LEN: u16 = 40;
const PIXEL_FORMAT_RGBA8_UNPREMULTIPLIED: u32 = 1;
const FLAG_ORIENTATION_APPLIED: u32 = 1 << 0;
const FLAG_RESIZED: u32 = 1 << 1;

const ALLOWED_MAX_EDGES: [u32; 7] = [256, 512, 768, 1024, 1536, 2048, 3072];
const ALLOWED_PLAYLIST_MAX_EDGES: [u32; 3] = [128, 256, 512];
const MAX_PLAYLIST_CLIENTS: usize = 16;
const PLAYLIST_DECODE_PERMITS: usize = if cfg!(feature = "sp022-playlist-decode-n2") {
    2
} else {
    1
};
const MAX_PLAYLIST_REQUESTS: usize = 32;
const MAX_PLAYLIST_FLIGHT_WAITERS: usize = 32;
const THUMBNAIL_DIRECTORY: &str = "thumbnails";
const THUMBNAIL_CACHE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const THUMBNAIL_CACHE_FILES: usize = 32768;
const THUMBNAIL_CACHE_SCAN_LIMIT: usize = 65536;
const THUMBNAIL_USAGE_RESCAN_WRITES: usize = 256;
const THUMBNAIL_INDEX_DIRECTORY: &str = "thumbnail-index-v1";
const THUMBNAIL_INDEX_MAGIC: [u8; 4] = *b"SPTI";
const THUMBNAIL_INDEX_LEN: usize = 93;
static THUMBNAIL_INDEX_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static TRACK_THUMBNAIL_PROBES: AtomicU64 = AtomicU64::new(0);
const THUMBNAIL_TEMP_STALE_AGE: std::time::Duration = std::time::Duration::from_secs(600);
const THUMBNAIL_PENDING_FILES: usize = 128;
const THUMBNAIL_PENDING_BYTES: usize = 32 * 1024 * 1024;
const THUMBNAIL_DISK_MAGIC: [u8; 4] = *b"SPTC";
const THUMBNAIL_DISK_VERSION: u16 = 1;
const THUMBNAIL_TRANSFORM_VERSION: u16 = 2;
const THUMBNAIL_DISK_HEADER_LEN: usize = 44;
static THUMBNAIL_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static THUMBNAIL_WRITER: OnceLock<ThumbnailWriter> = OnceLock::new();
static THUMBNAIL_USAGE: OnceLock<StdMutex<HashMap<PathBuf, ThumbnailUsage>>> = OnceLock::new();
#[cfg(test)]
static THUMBNAIL_BENCH_HITS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static THUMBNAIL_BENCH_MISSES: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static THUMBNAIL_BENCH_READ_NS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static THUMBNAIL_BENCH_HASH_NS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static THUMBNAIL_BENCH_LOOKUP_NS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static THUMBNAIL_BENCH_DECODE_NS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static THUMBNAIL_BENCH_WRITE_NS: AtomicU64 = AtomicU64::new(0);

struct ThumbnailWriteJob {
    cache_dir: PathBuf,
    filename: String,
    payload: Arc<Vec<u8>>,
}

#[derive(Clone, Copy)]
struct ThumbnailUsage {
    bytes: u64,
    files: usize,
    writes_since_scan: usize,
}

enum ThumbnailWriteOutcome {
    Written,
    AlreadyPresent,
    Skipped(&'static str),
    Failed(&'static str, io::Error),
}

struct ThumbnailWriterState {
    pending: HashMap<PathBuf, Arc<Vec<u8>>>,
    queue: VecDeque<ThumbnailWriteJob>,
    bytes: usize,
    peak_bytes: usize,
    enqueued: u64,
    coalesced: u64,
    skipped: u64,
    written: u64,
    already_present: u64,
    failed: u64,
    accepting: bool,
}

struct ThumbnailWriter {
    shared: Arc<(StdMutex<ThumbnailWriterState>, Condvar)>,
}

impl ThumbnailWriter {
    fn new() -> Self {
        let state = ThumbnailWriterState {
            pending: HashMap::new(),
            queue: VecDeque::new(),
            bytes: 0,
            peak_bytes: 0,
            enqueued: 0,
            coalesced: 0,
            skipped: 0,
            written: 0,
            already_present: 0,
            failed: 0,
            accepting: true,
        };
        let shared = Arc::new((StdMutex::new(state), Condvar::new()));
        let worker_shared = Arc::clone(&shared);
        if let Err(error) = std::thread::Builder::new()
            .name("thumbnail-cache-writer".into())
            .spawn(move || thumbnail_writer_loop(worker_shared))
        {
            tracing::warn!(operation = "audio.thumbnail.writer.start", error = %error, "thumbnail cache writer unavailable");
            shared
                .0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .accepting = false;
        }
        Self { shared }
    }

    fn pending(&self, target: &Path) -> Option<Vec<u8>> {
        let state = self
            .shared
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state
            .pending
            .get(target)
            .map(|payload| payload.as_ref().clone())
    }

    fn try_enqueue(&self, cache_dir: PathBuf, filename: String, response: &[u8]) {
        let target = cache_dir.join(&filename);
        let (lock, wake) = &*self.shared;
        let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.pending.contains_key(&target) {
            state.coalesced += 1;
            return;
        }
        let skip_reason = if !state.accepting {
            Some("closed")
        } else if state.pending.len() >= THUMBNAIL_PENDING_FILES {
            Some("queue_files")
        } else if state.bytes.saturating_add(response.len()) > THUMBNAIL_PENDING_BYTES {
            Some("queue_bytes")
        } else {
            None
        };
        if let Some(reason) = skip_reason {
            state.skipped += 1;
            if state.skipped.is_power_of_two() {
                tracing::info!(
                    operation = "audio.thumbnail.writer.skip",
                    reason,
                    skipped = state.skipped,
                    pending = state.pending.len(),
                    bytes = state.bytes,
                    peak_bytes = state.peak_bytes,
                    "thumbnail persistence skipped"
                );
            }
            tracing::debug!(
                operation = "audio.thumbnail.writer.skip",
                reason,
                skipped = state.skipped,
                pending = state.pending.len(),
                bytes = state.bytes,
                "thumbnail persistence skipped"
            );
            return;
        }
        let payload = Arc::new(response.to_vec());
        state.bytes += payload.len();
        state.peak_bytes = state.peak_bytes.max(state.bytes);
        state.enqueued += 1;
        state.pending.insert(target, Arc::clone(&payload));
        state.queue.push_back(ThumbnailWriteJob {
            cache_dir,
            filename,
            payload,
        });
        wake.notify_one();
    }

    fn shutdown(&self) {
        let (lock, wake) = &*self.shared;
        let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.accepting = false;
        let mut dropped = 0_u64;
        while let Some(job) = state.queue.pop_front() {
            state.pending.remove(&job.cache_dir.join(&job.filename));
            state.bytes = state.bytes.saturating_sub(job.payload.len());
            state.skipped += 1;
            dropped += 1;
        }
        if dropped > 0 {
            tracing::info!(
                operation = "audio.thumbnail.writer.shutdown",
                dropped,
                skipped = state.skipped,
                "queued thumbnail persistence canceled"
            );
        }
        wake.notify_all();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while !state.pending.is_empty() {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            state = wake.wait_timeout(state, remaining).unwrap().0;
        }
    }

    fn wait_path_idle(&self, target: &Path, timeout: std::time::Duration) {
        let (lock, wake) = &*self.shared;
        let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let deadline = std::time::Instant::now() + timeout;
        while state.pending.contains_key(target) {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            state = wake.wait_timeout(state, remaining).unwrap().0;
        }
    }

    #[cfg(test)]
    fn wait_idle(&self) {
        let (lock, wake) = &*self.shared;
        let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !state.pending.is_empty() {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            assert!(!remaining.is_zero(), "thumbnail writer did not drain");
            state = wake.wait_timeout(state, remaining).unwrap().0;
        }
    }
}

fn thumbnail_writer_loop(shared: Arc<(StdMutex<ThumbnailWriterState>, Condvar)>) {
    let (lock, wake) = &*shared;
    loop {
        let job = {
            let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            while state.queue.is_empty() && state.accepting {
                state = wake
                    .wait(state)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            if !state.accepting {
                return;
            }
            state.queue.pop_front().unwrap()
        };
        std::thread::yield_now();
        let started = std::time::Instant::now();
        let outcome = write_thumbnail_cache(&job.cache_dir, &job.filename, &job.payload);
        let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
        let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.pending.remove(&job.cache_dir.join(&job.filename));
        state.bytes = state.bytes.saturating_sub(job.payload.len());
        match outcome {
            ThumbnailWriteOutcome::Written => state.written += 1,
            ThumbnailWriteOutcome::AlreadyPresent => state.already_present += 1,
            ThumbnailWriteOutcome::Skipped(reason) => {
                state.skipped += 1;
                if state.skipped.is_power_of_two() {
                    tracing::info!(
                        operation = "audio.thumbnail.writer.skip",
                        reason,
                        skipped = state.skipped,
                        "thumbnail persistence skipped"
                    );
                }
                tracing::debug!(
                    operation = "audio.thumbnail.writer.skip",
                    reason,
                    skipped = state.skipped,
                    "thumbnail persistence skipped"
                );
            }
            ThumbnailWriteOutcome::Failed(stage, error) => {
                state.failed += 1;
                // The error object is not logged because it may include a local path.
                if state.failed.is_power_of_two() {
                    tracing::warn!(operation = "audio.thumbnail.writer.fail", stage, error_kind = ?error.kind(), os_error = ?error.raw_os_error(), failed = state.failed, "thumbnail persistence failed");
                } else {
                    tracing::debug!(operation = "audio.thumbnail.writer.fail", stage, error_kind = ?error.kind(), os_error = ?error.raw_os_error(), failed = state.failed, "thumbnail persistence failed");
                }
            }
        }
        tracing::debug!(
            operation = "audio.thumbnail.writer.result",
            written = state.written,
            already_present = state.already_present,
            skipped = state.skipped,
            failed = state.failed,
            pending = state.pending.len(),
            bytes = state.bytes,
            elapsed_ms,
            "thumbnail writer result"
        );
        let processed = state.written + state.already_present + state.failed;
        if processed > 0 && (processed == 1 || processed % 64 == 0) {
            tracing::info!(
                operation = "audio.thumbnail.writer.progress",
                enqueued = state.enqueued,
                written = state.written,
                already_present = state.already_present,
                coalesced = state.coalesced,
                skipped = state.skipped,
                failed = state.failed,
                pending = state.pending.len(),
                bytes = state.bytes,
                peak_bytes = state.peak_bytes,
                elapsed_ms,
                "thumbnail writer progress"
            );
        }
        wake.notify_all();
    }
}

pub fn shutdown_playlist_cover_cache() {
    if let Some(writer) = THUMBNAIL_WRITER.get() {
        writer.shutdown();
    }
}

static REQUEST_COORDINATOR: OnceLock<CoverRequestCoordinator> = OnceLock::new();
static PLAYLIST_REQUEST_COORDINATOR: OnceLock<Arc<PlaylistCoverRequestCoordinator>> =
    OnceLock::new();

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLoadCoverPixelsInput {
    pub file_path: String,
    pub max_edge: u32,
    pub request_id: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLoadPlaylistCoverPixelsInput {
    pub client_id: String,
    pub file_path: String,
    pub max_edge: u32,
    pub window_generation: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLoadTrackThumbnailInput {
    pub client_id: String,
    pub source_path: String,
    pub max_edge: u32,
    pub window_generation: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioBeginPlaylistCoverWindowInput {
    pub client_id: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CoverPixelsErrorCode {
    InvalidMaxEdge,
    InvalidPath,
    FileTooLarge,
    InvalidImage,
    ImageTooLarge,
    AllocationFailed,
    WorkerFailed,
    InvalidRequestId,
    InvalidClientId,
    StaleRequest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverPixelsError {
    pub code: CoverPixelsErrorCode,
    pub message: String,
    pub recoverable: bool,
}

impl CoverPixelsError {
    fn recoverable(code: CoverPixelsErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            recoverable: true,
        }
    }

    fn internal(code: CoverPixelsErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            recoverable: false,
        }
    }

    fn stale() -> Self {
        Self::recoverable(
            CoverPixelsErrorCode::StaleRequest,
            "a newer cover pixel request superseded this request",
        )
    }
}

struct CoverRequestCoordinator {
    latest_request_id: AtomicU64,
    decode_gate: tauri::async_runtime::Mutex<()>,
}

impl CoverRequestCoordinator {
    fn new() -> Self {
        Self {
            latest_request_id: AtomicU64::new(0),
            decode_gate: tauri::async_runtime::Mutex::new(()),
        }
    }

    fn register(&self, request_id: u64) -> Result<(), CoverPixelsError> {
        if request_id == 0 {
            return Err(CoverPixelsError::recoverable(
                CoverPixelsErrorCode::InvalidRequestId,
                "requestId must be a positive monotonically increasing integer",
            ));
        }

        let mut latest = self.latest_request_id.load(Ordering::Acquire);
        loop {
            if request_id <= latest {
                return Err(CoverPixelsError::stale());
            }
            match self.latest_request_id.compare_exchange_weak(
                latest,
                request_id,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Ok(()),
                Err(observed) => latest = observed,
            }
        }
    }

    async fn run_registered<T, F, Fut>(
        &self,
        request_id: u64,
        work: F,
    ) -> Result<T, CoverPixelsError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, CoverPixelsError>>,
    {
        let _guard = self.decode_gate.lock().await;
        if self.latest_request_id.load(Ordering::Acquire) != request_id {
            return Err(CoverPixelsError::stale());
        }
        work().await
    }

    async fn run_latest<T, F, Fut>(&self, request_id: u64, work: F) -> Result<T, CoverPixelsError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, CoverPixelsError>>,
    {
        self.register(request_id)?;
        self.run_registered(request_id, work).await
    }
}

// A token remains owned by the blocking closure even when its caller is aborted.
// The receiver mutex establishes admission order among futures that keep waiting.
struct PlaylistDecodeSlots {
    release: tauri::async_runtime::Sender<()>,
    tokens: tauri::async_runtime::Mutex<tauri::async_runtime::Receiver<()>>,
}

impl PlaylistDecodeSlots {
    fn new() -> Self {
        let (release, tokens) = tauri::async_runtime::channel(PLAYLIST_DECODE_PERMITS);
        for _ in 0..PLAYLIST_DECODE_PERMITS {
            release.try_send(()).expect("seed playlist decode slots");
        }
        Self {
            release,
            tokens: tauri::async_runtime::Mutex::new(tokens),
        }
    }

    async fn acquire(&self) -> Result<PlaylistDecodePermit, CoverPixelsError> {
        self.tokens
            .lock()
            .await
            .recv()
            .await
            .ok_or_else(playlist_worker_failed)?;
        Ok(PlaylistDecodePermit(self.release.clone()))
    }
}

struct PlaylistDecodePermit(tauri::async_runtime::Sender<()>);

impl Drop for PlaylistDecodePermit {
    fn drop(&mut self) {
        // Exactly one return per acquired token; no await or panicking cleanup.
        let _ = self.0.try_send(());
    }
}

struct PlaylistRequestReservation {
    count: Arc<AtomicUsize>,
    #[cfg(test)]
    hook: Option<PlaylistTestHook>,
}

impl Drop for PlaylistRequestReservation {
    fn drop(&mut self) {
        self.count.fetch_sub(1, Ordering::AcqRel);
        #[cfg(test)]
        if let Some(hook) = &self.hook {
            hook(PlaylistTestStage::RequestReleased);
        }
    }
}

#[derive(Clone, Hash, PartialEq, Eq)]
struct PlaylistDecodeKey {
    covers_root: PathBuf,
    source_hash: blake3::Hash,
    max_edge: u32,
    transform_version: u16,
    disk_version: u16,
}

type PlaylistFlightOutcome = Result<Arc<Vec<u8>>, CoverPixelsError>;
type PlaylistFlightReceiver = tauri::async_runtime::Receiver<PlaylistFlightOutcome>;

#[derive(Default)]
struct PlaylistFlights {
    entries: StdMutex<
        HashMap<PlaylistDecodeKey, Vec<tauri::async_runtime::Sender<PlaylistFlightOutcome>>>,
    >,
}

enum PlaylistFlightAttempt {
    Leader(PlaylistFlightLeader),
    Joined(PlaylistFlightReceiver),
}

impl PlaylistFlights {
    fn register(
        self: &Arc<Self>,
        key: PlaylistDecodeKey,
    ) -> Result<PlaylistFlightAttempt, CoverPixelsError> {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(waiters) = entries.get_mut(&key) {
            waiters.retain(|sender| !sender.is_closed());
            if waiters.len() >= MAX_PLAYLIST_FLIGHT_WAITERS {
                return Err(playlist_worker_failed());
            }
            let (sender, receiver) = tauri::async_runtime::channel(1);
            waiters.push(sender);
            Ok(PlaylistFlightAttempt::Joined(receiver))
        } else {
            entries.insert(key.clone(), Vec::new());
            Ok(PlaylistFlightAttempt::Leader(PlaylistFlightLeader {
                registry: Arc::clone(self),
                key: Some(key),
            }))
        }
    }

    fn publish(&self, key: &PlaylistDecodeKey, outcome: PlaylistFlightOutcome) {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(waiters) = entries.remove(key) {
            for waiter in waiters {
                let _ = waiter.try_send(outcome.clone());
            }
        }
    }
}

struct PlaylistFlightLeader {
    registry: Arc<PlaylistFlights>,
    key: Option<PlaylistDecodeKey>,
}

impl PlaylistFlightLeader {
    fn publish(mut self, outcome: PlaylistFlightOutcome) {
        if let Some(key) = self.key.take() {
            self.registry.publish(&key, outcome);
        }
    }
}

impl Drop for PlaylistFlightLeader {
    fn drop(&mut self) {
        // Unwind (including test-injected panic) cannot leave a flight tombstone.
        // Close channels without allocating while unwinding. Each consumer maps
        // recv(None) to WORKER_FAILED outside this cleanup path.
        if let Some(key) = self.key.take() {
            self.registry
                .entries
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&key);
        }
    }
}

fn playlist_worker_failed() -> CoverPixelsError {
    CoverPixelsError::internal(
        CoverPixelsErrorCode::WorkerFailed,
        "playlist cover pixel decoder worker failed",
    )
}

enum PlaylistWorkerResult {
    Complete(PlaylistFlightOutcome, PlaylistRequestReservation),
    Joined(PlaylistFlightReceiver, PlaylistRequestReservation),
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PlaylistTestStage {
    Queued,
    RequestReleased,
    Entered,
    Left,
    BeforeRead,
    Leader,
    Joined,
    Decoding,
    BeforePublish,
}

#[cfg(test)]
type PlaylistTestHook = Arc<dyn Fn(PlaylistTestStage) + Send + Sync>;

#[cfg(test)]
struct PlaylistTestWorkerExit(Arc<PlaylistCoverRequestCoordinator>);

#[cfg(test)]
impl Drop for PlaylistTestWorkerExit {
    fn drop(&mut self) {
        self.0.test_stage(PlaylistTestStage::Left);
    }
}

struct PlaylistCoverRequestCoordinator {
    clients: StdMutex<PlaylistCoverClients>,
    slots: PlaylistDecodeSlots,
    requests: Arc<AtomicUsize>,
    flights: Arc<PlaylistFlights>,
    #[cfg(test)]
    hook: StdMutex<Option<PlaylistTestHook>>,
}

#[derive(Default)]
struct PlaylistCoverClients {
    generations: HashMap<String, u64>,
    recency: VecDeque<String>,
}

impl PlaylistCoverRequestCoordinator {
    fn new() -> Self {
        Self {
            clients: StdMutex::new(PlaylistCoverClients::default()),
            slots: PlaylistDecodeSlots::new(),
            requests: Arc::new(AtomicUsize::new(0)),
            flights: Arc::new(PlaylistFlights::default()),
            #[cfg(test)]
            hook: StdMutex::new(None),
        }
    }

    fn begin_window(&self, client_id: &str) -> Result<u64, CoverPixelsError> {
        validate_playlist_client_id(client_id)?;
        let mut clients = self
            .clients
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let generation = clients
            .generations
            .get(client_id)
            .copied()
            .unwrap_or(0)
            .saturating_add(1);
        clients.generations.insert(client_id.to_owned(), generation);
        clients.recency.retain(|candidate| candidate != client_id);
        clients.recency.push_back(client_id.to_owned());
        while clients.recency.len() > MAX_PLAYLIST_CLIENTS {
            if let Some(expired) = clients.recency.pop_front() {
                clients.generations.remove(&expired);
            }
        }
        Ok(generation)
    }

    fn ensure_current(
        &self,
        client_id: &str,
        window_generation: u64,
    ) -> Result<(), CoverPixelsError> {
        let clients = self
            .clients
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if clients.generations.get(client_id).copied() == Some(window_generation) {
            Ok(())
        } else {
            Err(CoverPixelsError::stale())
        }
    }

    #[cfg(test)]
    async fn run_registered<T, F, Fut>(
        &self,
        client_id: &str,
        window_generation: u64,
        work: F,
    ) -> Result<T, CoverPixelsError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, CoverPixelsError>>,
    {
        // Reject an already obsolete window before joining the decode queue. A
        // generation can still advance while this request waits, so it is checked
        // again after acquiring the gate and immediately before publishing output.
        self.ensure_current(client_id, window_generation)?;
        let _guard = self.slots.acquire().await?;
        self.ensure_current(client_id, window_generation)?;
        let result = work().await?;
        self.ensure_current(client_id, window_generation)?;
        Ok(result)
    }

    fn reserve_request(&self) -> Result<PlaylistRequestReservation, CoverPixelsError> {
        self.requests
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_PLAYLIST_REQUESTS).then_some(count + 1)
            })
            .map_err(|_| playlist_worker_failed())?;
        Ok(PlaylistRequestReservation {
            count: Arc::clone(&self.requests),
            #[cfg(test)]
            hook: self.hook.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        })
    }

    #[cfg(test)]
    fn test_stage(&self, stage: PlaylistTestStage) {
        let hook = self.hook.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if let Some(hook) = hook {
            hook(stage);
        }
    }

    async fn load(
        self: &Arc<Self>,
        app_cache_dir: PathBuf,
        input: AudioLoadPlaylistCoverPixelsInput,
    ) -> Result<Vec<u8>, CoverPixelsError> {
        validate_playlist_max_edge(input.max_edge)?;
        self.ensure_current(&input.client_id, input.window_generation)?;
        let request = self.reserve_request()?;
        #[cfg(test)]
        self.test_stage(PlaylistTestStage::Queued);
        let permit = self.slots.acquire().await?;
        self.ensure_current(&input.client_id, input.window_generation)?;
        let worker_coordinator = Arc::clone(self);
        let worker_input = input.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            let request = request;
            #[cfg(test)]
            let _exit = PlaylistTestWorkerExit(Arc::clone(&worker_coordinator));
            #[cfg(test)]
            worker_coordinator.test_stage(PlaylistTestStage::Entered);
            worker_coordinator
                .ensure_current(&worker_input.client_id, worker_input.window_generation)?;
            worker_coordinator.run_worker(&app_cache_dir, &worker_input, request)
        })
        .await
        .map_err(|error| {
            tracing::error!(
                operation = "audio.playlist_cover_pixels.join",
                window_generation = input.window_generation,
                error = %error,
                "playlist cover pixel decoder worker failed",
            );
            playlist_worker_failed()
        })??;
        let (outcome, request) = match result {
            PlaylistWorkerResult::Complete(outcome, request) => (outcome, request),
            PlaylistWorkerResult::Joined(mut receiver, request) => {
                self.ensure_current(&input.client_id, input.window_generation)?;
                (
                    receiver.recv().await.ok_or_else(playlist_worker_failed)?,
                    request,
                )
            }
        };
        let _request = request;
        self.ensure_current(&input.client_id, input.window_generation)?;
        outcome.map(|response| response.as_ref().clone())
    }

    async fn load_track(
        self: &Arc<Self>,
        app_cache_dir: PathBuf,
        input: AudioLoadTrackThumbnailInput,
    ) -> Result<Vec<u8>, CoverPixelsError> {
        if !matches!(input.max_edge, 128 | 256) {
            return Err(CoverPixelsError::recoverable(
                CoverPixelsErrorCode::InvalidMaxEdge,
                "track thumbnail maxEdge must be 128 or 256",
            ));
        }
        self.ensure_current(&input.client_id, input.window_generation)?;
        let request = self.reserve_request()?;
        let permit = self.slots.acquire().await?;
        self.ensure_current(&input.client_id, input.window_generation)?;
        let coordinator = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            let _request = request;
            coordinator.ensure_current(&input.client_id, input.window_generation)?;
            let response = load_track_thumbnail_blocking(
                &app_cache_dir,
                &input.source_path,
                input.max_edge,
                || {
                    coordinator
                        .ensure_current(&input.client_id, input.window_generation)
                        .is_ok()
                },
            )?;
            coordinator.ensure_current(&input.client_id, input.window_generation)?;
            Ok(response)
        })
        .await
        .map_err(|_| playlist_worker_failed())?
    }

    fn run_worker(
        &self,
        root: &Path,
        input: &AudioLoadPlaylistCoverPixelsInput,
        request: PlaylistRequestReservation,
    ) -> Result<PlaylistWorkerResult, CoverPixelsError> {
        #[cfg(test)]
        self.test_stage(PlaylistTestStage::BeforeRead);
        // Every consumer validates and hashes its own bytes before it can join.
        let covers_root = root.join(AUDIO_CACHE_DIRECTORY).join(COVER_DIRECTORY);
        let path = validate_cover_path(&covers_root, Path::new(&input.file_path))?;
        let bytes = read_bounded_file(&path)?;
        let source_hash = blake3::hash(&bytes);
        let covers_root = fs::canonicalize(&covers_root).map_err(|_| {
            CoverPixelsError::recoverable(
                CoverPixelsErrorCode::InvalidPath,
                "cover cache root cannot be resolved",
            )
        })?;
        let key = PlaylistDecodeKey {
            covers_root,
            source_hash,
            max_edge: input.max_edge,
            transform_version: THUMBNAIL_TRANSFORM_VERSION,
            disk_version: THUMBNAIL_DISK_VERSION,
        };
        let leader = match self.flights.register(key)? {
            PlaylistFlightAttempt::Joined(receiver) => {
                #[cfg(test)]
                self.test_stage(PlaylistTestStage::Joined);
                return Ok(PlaylistWorkerResult::Joined(receiver, request));
            }
            PlaylistFlightAttempt::Leader(leader) => leader,
        };
        #[cfg(test)]
        self.test_stage(PlaylistTestStage::Leader);
        let result = playlist_pixels_from_bytes(
            root,
            &bytes,
            source_hash,
            input.max_edge,
            || {
                self.ensure_current(&input.client_id, input.window_generation)
                    .is_ok()
            },
            || {
                #[cfg(test)]
                self.test_stage(PlaylistTestStage::Decoding);
            },
        )
        .map(Arc::new);
        #[cfg(test)]
        self.test_stage(PlaylistTestStage::BeforePublish);
        leader.publish(result.clone());
        // Request reservation intentionally lives through read/decode/publish.
        Ok(PlaylistWorkerResult::Complete(result, request))
    }
}

pub fn begin_playlist_cover_window(client_id: &str) -> Result<u64, CoverPixelsError> {
    PLAYLIST_REQUEST_COORDINATOR
        .get_or_init(|| Arc::new(PlaylistCoverRequestCoordinator::new()))
        .begin_window(client_id)
}

pub async fn load_cover_pixels(
    app_cache_dir: PathBuf,
    input: AudioLoadCoverPixelsInput,
) -> Result<Vec<u8>, CoverPixelsError> {
    validate_max_edge(input.max_edge)?;

    // Register before queueing, then re-check after acquiring the gate. Rapid track
    // changes therefore keep at most the current decode plus the newest waiting decode;
    // superseded futures return STALE_REQUEST without entering the blocking pool.
    let coordinator = REQUEST_COORDINATOR.get_or_init(CoverRequestCoordinator::new);
    let request_id = input.request_id;
    coordinator
        .run_latest(request_id, || async move {
            tauri::async_runtime::spawn_blocking(move || {
                load_cover_pixels_blocking(&app_cache_dir, &input.file_path, input.max_edge)
            })
            .await
            .map_err(|error| {
                tracing::error!(
                    operation = "audio.cover_pixels.join",
                    request_id,
                    error = %error,
                    "cover pixel decoder worker failed",
                );
                CoverPixelsError::internal(
                    CoverPixelsErrorCode::WorkerFailed,
                    "cover pixel decoder worker failed",
                )
            })?
        })
        .await
}

pub async fn load_playlist_cover_pixels(
    app_cache_dir: PathBuf,
    input: AudioLoadPlaylistCoverPixelsInput,
) -> Result<Vec<u8>, CoverPixelsError> {
    let coordinator = PLAYLIST_REQUEST_COORDINATOR
        .get_or_init(|| Arc::new(PlaylistCoverRequestCoordinator::new()));
    coordinator.load(app_cache_dir, input).await
}

pub async fn load_track_thumbnail(
    app_cache_dir: PathBuf,
    input: AudioLoadTrackThumbnailInput,
) -> Result<Vec<u8>, CoverPixelsError> {
    let coordinator = PLAYLIST_REQUEST_COORDINATOR
        .get_or_init(|| Arc::new(PlaylistCoverRequestCoordinator::new()));
    coordinator.load_track(app_cache_dir, input).await
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TrackFingerprint {
    size: u64,
    modified_ns: u128,
}

fn ordinary_file(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    metadata.file_type().is_file()
}

fn ordinary_directory(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    metadata.file_type().is_dir()
}

fn safe_create_directory(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        if parent != path && !parent.as_os_str().is_empty() {
            safe_create_directory(parent)?;
        }
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(path)?;
            fs::symlink_metadata(path)?
        }
        Err(error) => return Err(error),
    };
    if ordinary_directory(&metadata) {
        Ok(())
    } else {
        Err(io::ErrorKind::InvalidData.into())
    }
}

fn source_fingerprint(source_path: &str) -> Result<TrackFingerprint, CoverPixelsError> {
    let path = Path::new(source_path);
    if !path.is_absolute() || source_path.trim().is_empty() {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "sourcePath must be an absolute file path",
        ));
    }
    for ancestor in path.ancestors().skip(1) {
        let metadata = fs::symlink_metadata(ancestor).map_err(|_| {
            CoverPixelsError::recoverable(
                CoverPixelsErrorCode::InvalidPath,
                "source parent is unavailable",
            )
        })?;
        if !ordinary_directory(&metadata) {
            return Err(CoverPixelsError::recoverable(
                CoverPixelsErrorCode::InvalidPath,
                "source parent must not be a symbolic link or reparse point",
            ));
        }
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| {
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "source file is unavailable",
        )
    })?;
    if !ordinary_file(&metadata) {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "source must be a regular file",
        ));
    }
    let modified_ns = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|time| time.as_nanos())
        .ok_or_else(|| {
            CoverPixelsError::recoverable(
                CoverPixelsErrorCode::InvalidPath,
                "source modification time is unavailable",
            )
        })?;
    Ok(TrackFingerprint {
        size: metadata.len(),
        modified_ns,
    })
}

fn index_directory(app_cache_dir: &Path) -> Option<PathBuf> {
    let directory = app_cache_dir
        .join(AUDIO_CACHE_DIRECTORY)
        .join(THUMBNAIL_INDEX_DIRECTORY);
    safe_create_directory(&directory).ok()?;
    Some(directory)
}

fn index_path(app_cache_dir: &Path, source_path: &str) -> Option<PathBuf> {
    let directory = index_directory(app_cache_dir)?;
    #[cfg(windows)]
    let key = source_path.to_lowercase();
    #[cfg(not(windows))]
    let key = source_path;
    Some(directory.join(format!("{}.idx", blake3::hash(key.as_bytes()).to_hex())))
}

fn read_track_index(
    app_cache_dir: &Path,
    source_path: &str,
    fingerprint: TrackFingerprint,
) -> Option<Option<blake3::Hash>> {
    let path = index_path(app_cache_dir, source_path)?;
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !ordinary_file(&metadata) || metadata.len() != THUMBNAIL_INDEX_LEN as u64 {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes.len() != THUMBNAIL_INDEX_LEN
        || bytes[0..4] != THUMBNAIL_INDEX_MAGIC
        || blake3::hash(&bytes[..61]).as_bytes() != &bytes[61..93]
        || u64::from_le_bytes(bytes[4..12].try_into().ok()?) != fingerprint.size
        || u128::from_le_bytes(bytes[12..28].try_into().ok()?) != fingerprint.modified_ns
    {
        return None;
    }
    match bytes[28] {
        0 if bytes[29..61].iter().all(|byte| *byte == 0) => Some(None),
        1 => Some(Some(blake3::Hash::from_bytes(
            bytes[29..61].try_into().ok()?,
        ))),
        _ => None,
    }
}

fn write_track_index(
    app_cache_dir: &Path,
    source_path: &str,
    fingerprint: TrackFingerprint,
    cover_hash: Option<blake3::Hash>,
) -> io::Result<()> {
    let target = index_path(app_cache_dir, source_path)
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let parent = target.parent().unwrap();
    let temporary = parent.join(format!(
        ".tmp-{}-{}",
        std::process::id(),
        THUMBNAIL_INDEX_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut bytes = Vec::with_capacity(THUMBNAIL_INDEX_LEN);
    bytes.extend_from_slice(&THUMBNAIL_INDEX_MAGIC);
    bytes.extend_from_slice(&fingerprint.size.to_le_bytes());
    bytes.extend_from_slice(&fingerprint.modified_ns.to_le_bytes());
    bytes.push(u8::from(cover_hash.is_some()));
    if let Some(hash) = cover_hash {
        bytes.extend_from_slice(hash.as_bytes());
    } else {
        bytes.extend_from_slice(&[0; 32]);
    }
    bytes.extend_from_slice(blake3::hash(&bytes).as_bytes());
    let outcome = (|| -> io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        match fs::symlink_metadata(&target) {
            Ok(metadata) if !ordinary_file(&metadata) => {
                return Err(io::ErrorKind::InvalidData.into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        crate::library_folders::replace_file(&temporary, &target)
    })();
    let _ = fs::remove_file(&temporary);
    outcome
}

fn load_track_thumbnail_blocking(
    app_cache_dir: &Path,
    source_path: &str,
    max_edge: u32,
    is_current: impl FnOnce() -> bool + Copy,
) -> Result<Vec<u8>, CoverPixelsError> {
    let fingerprint = source_fingerprint(source_path)?;
    let cache_dir = app_cache_dir
        .join(AUDIO_CACHE_DIRECTORY)
        .join(THUMBNAIL_DIRECTORY);
    if let Some(indexed) = read_track_index(app_cache_dir, source_path, fingerprint) {
        match indexed {
            None => return Ok(Vec::new()),
            Some(hash) => {
                let filename = thumbnail_filename(hash, max_edge);
                let target = cache_dir.join(&filename);
                let cached = THUMBNAIL_WRITER
                    .get()
                    .and_then(|writer| writer.pending(&target))
                    .or_else(|| read_thumbnail_cache(&cache_dir, &filename, max_edge));
                if let Some(bytes) = cached {
                    return Ok(bytes);
                }
            }
        }
    }
    if !is_current() {
        return Err(CoverPixelsError::stale());
    }
    #[cfg(test)]
    TRACK_THUMBNAIL_PROBES.fetch_add(1, Ordering::Relaxed);
    let source = super::playlist_cover::probe_playlist_cover_blocking(app_cache_dir, source_path)
        .map_err(|error| {
        CoverPixelsError::recoverable(CoverPixelsErrorCode::InvalidPath, error.message)
    })?;
    let Some(cover) = source.cover_art else {
        if is_current() && source_fingerprint(source_path).ok() == Some(fingerprint) {
            let _ = write_track_index(app_cache_dir, source_path, fingerprint, None);
        }
        return Ok(Vec::new());
    };
    let bytes = if let Some(file_path) = cover.file_path {
        let covers_root = app_cache_dir
            .join(AUDIO_CACHE_DIRECTORY)
            .join(COVER_DIRECTORY);
        let path = validate_cover_path(&covers_root, Path::new(&file_path))?;
        read_bounded_file(&path)?
    } else if let Some(data_url) = cover.data_url {
        use base64::Engine;
        let encoded = data_url
            .split_once(",")
            .map(|(_, encoded)| encoded)
            .ok_or_else(|| playlist_worker_failed())?;
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| playlist_worker_failed())?
    } else {
        return Err(playlist_worker_failed());
    };
    let hash = blake3::hash(&bytes);
    let response =
        playlist_pixels_from_bytes(app_cache_dir, &bytes, hash, max_edge, is_current, || {})?;
    if is_current() && source_fingerprint(source_path).ok() == Some(fingerprint) {
        let _ = write_track_index(app_cache_dir, source_path, fingerprint, Some(hash));
    }
    Ok(response)
}

// Warm one existing cover source through the ordinary thumbnail cache without
// returning its RGBA payload. Taking only an immediately available slot keeps
// this work out of the foreground decode queue.
#[cfg(test)]
pub(crate) async fn try_warm_playlist_cover_pixels(
    app_cache_dir: PathBuf,
    file_path: String,
    max_edge: u32,
) -> Result<Option<bool>, CoverPixelsError> {
    validate_playlist_max_edge(max_edge)?;
    let coordinator = PLAYLIST_REQUEST_COORDINATOR
        .get_or_init(|| Arc::new(PlaylistCoverRequestCoordinator::new()));
    if coordinator.requests.load(Ordering::Acquire) != 0 {
        return Ok(None);
    }
    let Ok(mut tokens) = coordinator.slots.tokens.try_lock() else {
        return Ok(None);
    };
    if tokens.try_recv().is_err() {
        return Ok(None);
    }
    let permit = PlaylistDecodePermit(coordinator.slots.release.clone());
    drop(tokens);
    if coordinator.requests.load(Ordering::Acquire) != 0 {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let (response, cache_dir, filename) = load_playlist_cover_pixels_blocking_with_cache_path(
            &app_cache_dir,
            &file_path,
            max_edge,
            None,
        )?;
        // Release the decode slot before waiting for disk I/O. Visible covers
        // can decode while the single cache writer drains this entry.
        drop(_permit);
        let target = cache_dir.join(&filename);
        THUMBNAIL_WRITER
            .get_or_init(ThumbnailWriter::new)
            .wait_path_idle(&target, std::time::Duration::from_secs(5));
        let mut persisted = read_thumbnail_cache(&cache_dir, &filename, max_edge).is_some();
        if !persisted {
            // The shared writer may have skipped a full queue or failed. This
            // background-only fallback uses the same bounded, validated writer.
            let _ = write_thumbnail_cache(&cache_dir, &filename, &response);
            persisted = read_thumbnail_cache(&cache_dir, &filename, max_edge).is_some();
        }
        Ok(persisted)
    })
    .await
    .map_err(|_| playlist_worker_failed())?
    .map(Some)
}

pub(crate) struct TrackWarmupOutcome {
    pub has_cover: bool,
    pub persisted: bool,
}

pub(crate) async fn try_warm_track_thumbnail(
    app_cache_dir: PathBuf,
    source_path: String,
    max_edge: u32,
) -> Result<Option<TrackWarmupOutcome>, CoverPixelsError> {
    if !matches!(max_edge, 128 | 256) {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidMaxEdge,
            "track thumbnail maxEdge must be 128 or 256",
        ));
    }
    let coordinator = PLAYLIST_REQUEST_COORDINATOR
        .get_or_init(|| Arc::new(PlaylistCoverRequestCoordinator::new()));
    if coordinator.requests.load(Ordering::Acquire) != 0 {
        return Ok(None);
    }
    let Ok(mut tokens) = coordinator.slots.tokens.try_lock() else {
        return Ok(None);
    };
    if tokens.try_recv().is_err() {
        return Ok(None);
    }
    let permit = PlaylistDecodePermit(coordinator.slots.release.clone());
    drop(tokens);
    if coordinator.requests.load(Ordering::Acquire) != 0 {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let response =
            load_track_thumbnail_blocking(&app_cache_dir, &source_path, max_edge, || true)?;
        drop(_permit);
        let fingerprint = source_fingerprint(&source_path)?;
        let indexed = read_track_index(&app_cache_dir, &source_path, fingerprint);
        let Some(Some(hash)) = indexed else {
            return Ok(TrackWarmupOutcome {
                has_cover: false,
                persisted: indexed == Some(None),
            });
        };
        let cache_dir = app_cache_dir
            .join(AUDIO_CACHE_DIRECTORY)
            .join(THUMBNAIL_DIRECTORY);
        let filename = thumbnail_filename(hash, max_edge);
        THUMBNAIL_WRITER
            .get_or_init(ThumbnailWriter::new)
            .wait_path_idle(
                &cache_dir.join(&filename),
                std::time::Duration::from_secs(5),
            );
        let mut persisted = read_thumbnail_cache(&cache_dir, &filename, max_edge).is_some();
        if !persisted && !response.is_empty() {
            let _ = write_thumbnail_cache(&cache_dir, &filename, &response);
            persisted = read_thumbnail_cache(&cache_dir, &filename, max_edge).is_some();
        }
        Ok(TrackWarmupOutcome {
            has_cover: true,
            persisted,
        })
    })
    .await
    .map_err(|_| playlist_worker_failed())?
    .map(Some)
}

#[cfg(test)]
fn load_playlist_cover_pixels_blocking(
    app_cache_dir: &Path,
    requested_path: &str,
    max_edge: u32,
) -> Result<Vec<u8>, CoverPixelsError> {
    load_playlist_cover_pixels_blocking_with_session(app_cache_dir, requested_path, max_edge, None)
}

#[cfg(test)]
fn load_playlist_cover_pixels_blocking_with_session(
    app_cache_dir: &Path,
    requested_path: &str,
    max_edge: u32,
    session: Option<(&str, u64)>,
) -> Result<Vec<u8>, CoverPixelsError> {
    load_playlist_cover_pixels_blocking_with_cache_path(
        app_cache_dir,
        requested_path,
        max_edge,
        session,
    )
    .map(|(response, _, _)| response)
}

#[cfg(test)]
fn load_playlist_cover_pixels_blocking_with_cache_path(
    app_cache_dir: &Path,
    requested_path: &str,
    max_edge: u32,
    session: Option<(&str, u64)>,
) -> Result<(Vec<u8>, PathBuf, String), CoverPixelsError> {
    #[cfg(test)]
    let stage_started = Instant::now();
    let covers_root = app_cache_dir
        .join(AUDIO_CACHE_DIRECTORY)
        .join(COVER_DIRECTORY);
    let path = validate_cover_path(&covers_root, Path::new(requested_path))?;
    let bytes = read_bounded_file(&path)?;
    #[cfg(test)]
    THUMBNAIL_BENCH_READ_NS.fetch_add(stage_started.elapsed().as_nanos() as u64, Ordering::Relaxed);
    #[cfg(test)]
    let stage_started = Instant::now();
    let source_hash = blake3::hash(&bytes);
    #[cfg(test)]
    THUMBNAIL_BENCH_HASH_NS.fetch_add(stage_started.elapsed().as_nanos() as u64, Ordering::Relaxed);
    let response = playlist_pixels_from_bytes(
        app_cache_dir,
        &bytes,
        source_hash,
        max_edge,
        || {
            session.is_none_or(|(client_id, generation)| {
                PLAYLIST_REQUEST_COORDINATOR
                    .get()
                    .is_none_or(|coordinator| {
                        coordinator.ensure_current(client_id, generation).is_ok()
                    })
            })
        },
        || {},
    )?;
    if let Some((client_id, generation)) = session {
        if let Some(coordinator) = PLAYLIST_REQUEST_COORDINATOR.get() {
            coordinator.ensure_current(client_id, generation)?;
        }
    }
    let cache_dir = app_cache_dir
        .join(AUDIO_CACHE_DIRECTORY)
        .join(THUMBNAIL_DIRECTORY);
    let filename = thumbnail_filename(source_hash, max_edge);
    Ok((response, cache_dir, filename))
}

fn thumbnail_filename(source_hash: blake3::Hash, max_edge: u32) -> String {
    format!(
        "{}-{max_edge}-t{THUMBNAIL_TRANSFORM_VERSION}-d{THUMBNAIL_DISK_VERSION}.spxr",
        source_hash.to_hex()
    )
}

fn playlist_pixels_from_bytes(
    app_cache_dir: &Path,
    bytes: &[u8],
    source_hash: blake3::Hash,
    max_edge: u32,
    is_current: impl FnOnce() -> bool,
    before_decode: impl FnOnce(),
) -> Result<Vec<u8>, CoverPixelsError> {
    #[cfg(test)]
    let stage_started = Instant::now();
    let cache_dir = app_cache_dir
        .join(AUDIO_CACHE_DIRECTORY)
        .join(THUMBNAIL_DIRECTORY);
    let filename = thumbnail_filename(source_hash, max_edge);
    let cache_path = cache_dir.join(&filename);
    let pending = THUMBNAIL_WRITER
        .get_or_init(ThumbnailWriter::new)
        .pending(&cache_path);
    let cached = pending.or_else(|| read_thumbnail_cache(&cache_dir, &filename, max_edge));
    #[cfg(test)]
    THUMBNAIL_BENCH_LOOKUP_NS
        .fetch_add(stage_started.elapsed().as_nanos() as u64, Ordering::Relaxed);
    if let Some(cached) = cached {
        #[cfg(test)]
        THUMBNAIL_BENCH_HITS.fetch_add(1, Ordering::Relaxed);
        return Ok(cached);
    }
    #[cfg(test)]
    THUMBNAIL_BENCH_MISSES.fetch_add(1, Ordering::Relaxed);
    #[cfg(test)]
    let stage_started = Instant::now();
    before_decode();
    let response = decode_playlist_and_pack(bytes, max_edge)?;
    #[cfg(test)]
    THUMBNAIL_BENCH_DECODE_NS
        .fetch_add(stage_started.elapsed().as_nanos() as u64, Ordering::Relaxed);
    if !is_current() {
        return Ok(response);
    }
    #[cfg(test)]
    let stage_started = Instant::now();
    THUMBNAIL_WRITER
        .get_or_init(ThumbnailWriter::new)
        .try_enqueue(cache_dir, filename, &response);
    #[cfg(test)]
    THUMBNAIL_BENCH_WRITE_NS
        .fetch_add(stage_started.elapsed().as_nanos() as u64, Ordering::Relaxed);
    Ok(response)
}

fn thumbnail_cache_root(cache_dir: &Path) -> Option<()> {
    safe_create_directory(cache_dir).ok()
}

fn read_thumbnail_cache(cache_dir: &Path, filename: &str, max_edge: u32) -> Option<Vec<u8>> {
    thumbnail_cache_root(cache_dir)?;
    let path = cache_dir.join(filename);
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !ordinary_file(&metadata)
        || metadata.len() < THUMBNAIL_DISK_HEADER_LEN as u64
        || metadata.len() > MAX_OUTPUT_BYTES + HEADER_LEN as u64 + THUMBNAIL_DISK_HEADER_LEN as u64
    {
        let _ = fs::remove_file(&path);
        return None;
    }
    if !fs::canonicalize(&path)
        .ok()?
        .starts_with(fs::canonicalize(cache_dir).ok()?)
    {
        return None;
    }
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => {
            let _ = fs::remove_file(&path);
            return None;
        }
    };
    let payload = parse_thumbnail_cache(&bytes, max_edge);
    if payload.is_some() {
        let _ = File::open(&path).and_then(|file| file.set_modified(SystemTime::now()));
    } else {
        let _ = fs::remove_file(&path);
    }
    payload
}

fn parse_thumbnail_cache(bytes: &[u8], max_edge: u32) -> Option<Vec<u8>> {
    if bytes.len() < THUMBNAIL_DISK_HEADER_LEN + usize::from(HEADER_LEN)
        || bytes[0..4] != THUMBNAIL_DISK_MAGIC
        || u16::from_le_bytes(bytes[4..6].try_into().ok()?) != THUMBNAIL_DISK_VERSION
        || bytes[6..8] != [0, 0]
    {
        return None;
    }
    let payload_len = u32::from_le_bytes(bytes[8..12].try_into().ok()?) as usize;
    let payload = bytes.get(THUMBNAIL_DISK_HEADER_LEN..)?;
    if payload_len != payload.len()
        || blake3::hash(payload).as_bytes() != &bytes[12..THUMBNAIL_DISK_HEADER_LEN]
        || !valid_cached_spxr(payload, max_edge)
    {
        return None;
    }
    Some(payload.to_vec())
}

fn valid_cached_spxr(bytes: &[u8], max_edge: u32) -> bool {
    if bytes.len() < usize::from(HEADER_LEN)
        || bytes[0..4] != HEADER_MAGIC
        || u16::from_le_bytes([bytes[4], bytes[5]]) != HEADER_VERSION
        || u16::from_le_bytes([bytes[6], bytes[7]]) != HEADER_LEN
    {
        return false;
    }
    let field = |offset| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
    let width = field(8);
    let height = field(12);
    let stride = field(16);
    let format = field(20);
    let pixel_len = field(24);
    let flags = field(28);
    let source_width = field(32);
    let source_height = field(36);
    width > 0
        && height > 0
        && width.max(height) <= max_edge
        && stride == width.saturating_mul(4)
        && format == PIXEL_FORMAT_RGBA8_UNPREMULTIPLIED
        && u64::from(pixel_len) <= MAX_OUTPUT_BYTES
        && u64::from(stride) * u64::from(height) == u64::from(pixel_len)
        && bytes.len() == usize::from(HEADER_LEN) + pixel_len as usize
        && flags & !(FLAG_ORIENTATION_APPLIED | FLAG_RESIZED) == 0
        && validate_source_dimensions(source_width, source_height, 0).is_ok()
}

fn write_thumbnail_cache(
    cache_dir: &Path,
    filename: &str,
    response: &[u8],
) -> ThumbnailWriteOutcome {
    write_thumbnail_cache_with_limits(
        cache_dir,
        filename,
        response,
        THUMBNAIL_CACHE_BYTES,
        THUMBNAIL_CACHE_FILES,
    )
}

fn write_thumbnail_cache_with_limits(
    cache_dir: &Path,
    filename: &str,
    response: &[u8],
    byte_limit: u64,
    file_limit: usize,
) -> ThumbnailWriteOutcome {
    if let Err(error) = safe_create_directory(cache_dir) {
        return ThumbnailWriteOutcome::Failed("cache_directory", error);
    }
    match fs::symlink_metadata(cache_dir) {
        Ok(metadata) if ordinary_directory(&metadata) => {}
        Ok(_) => {
            return ThumbnailWriteOutcome::Failed(
                "cache_directory_type",
                io::ErrorKind::NotADirectory.into(),
            );
        }
        Err(error) => return ThumbnailWriteOutcome::Failed("cache_directory_metadata", error),
    }
    let Some(response_len) = u32::try_from(response.len()).ok() else {
        return ThumbnailWriteOutcome::Skipped("response_too_large");
    };
    let target = cache_dir.join(filename);
    match thumbnail_target_present(&target) {
        Ok(true) => return ThumbnailWriteOutcome::AlreadyPresent,
        Ok(false) => {}
        Err(error) => return ThumbnailWriteOutcome::Failed("target_metadata", error),
    }
    let mut encoded = Vec::with_capacity(THUMBNAIL_DISK_HEADER_LEN + response.len());
    encoded.extend_from_slice(&THUMBNAIL_DISK_MAGIC);
    encoded.extend_from_slice(&THUMBNAIL_DISK_VERSION.to_le_bytes());
    encoded.extend_from_slice(&0_u16.to_le_bytes());
    encoded.extend_from_slice(&response_len.to_le_bytes());
    encoded.extend_from_slice(blake3::hash(response).as_bytes());
    encoded.extend_from_slice(response);
    let tracked = byte_limit == THUMBNAIL_CACHE_BYTES && file_limit == THUMBNAIL_CACHE_FILES;
    let mut usage_guard = tracked.then(|| {
        THUMBNAIL_USAGE
            .get_or_init(|| StdMutex::new(HashMap::new()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    });
    let additional_bytes = encoded.len() as u64;
    let room = if let Some(usage) = usage_guard.as_mut() {
        let needs_scan = usage
            .get(cache_dir)
            .is_none_or(|entry| entry.writes_since_scan >= THUMBNAIL_USAGE_RESCAN_WRITES);
        if needs_scan {
            match scan_thumbnail_usage(cache_dir) {
                Ok(measured) => {
                    usage.insert(cache_dir.to_path_buf(), measured);
                }
                Err(error) => return ThumbnailWriteOutcome::Failed("disk_budget_scan", error),
            }
        }
        let entry = usage.get(cache_dir).unwrap();
        if entry.bytes.saturating_add(additional_bytes) <= byte_limit
            && entry.files.saturating_add(1) <= file_limit
        {
            Ok(true)
        } else {
            let result = make_thumbnail_room_with_limits_checked(
                cache_dir,
                additional_bytes,
                1,
                byte_limit,
                file_limit,
            );
            if matches!(result, Ok(true)) {
                match scan_thumbnail_usage(cache_dir) {
                    Ok(measured) => {
                        usage.insert(cache_dir.to_path_buf(), measured);
                    }
                    Err(error) => return ThumbnailWriteOutcome::Failed("disk_budget_scan", error),
                }
            }
            result
        }
    } else {
        make_thumbnail_room_with_limits_checked(
            cache_dir,
            additional_bytes,
            1,
            byte_limit,
            file_limit,
        )
    };
    match room {
        Ok(true) => {}
        Ok(false) => return ThumbnailWriteOutcome::Skipped("disk_budget"),
        Err(error) => return ThumbnailWriteOutcome::Failed("disk_budget_scan", error),
    }
    // The background writer is single-threaded. create_new also isolates
    // concurrent processes and prevents a crash from exposing partial bytes.
    let temp_path = cache_dir.join(format!(
        ".tmp-{}-{}",
        std::process::id(),
        THUMBNAIL_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
    {
        Ok(file) => file,
        Err(error) => return ThumbnailWriteOutcome::Failed("temp_create", error),
    };
    let outcome = (|| -> Result<ThumbnailWriteOutcome, (&'static str, io::Error)> {
        file.write_all(&encoded).map_err(|error| ("write", error))?;
        file.sync_all().map_err(|error| ("sync", error))?;
        drop(file);
        if thumbnail_target_present(&target).map_err(|error| ("target_metadata", error))? {
            return Ok(ThumbnailWriteOutcome::AlreadyPresent);
        }
        match fs::rename(&temp_path, &target) {
            Ok(()) => Ok(ThumbnailWriteOutcome::Written),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                if thumbnail_target_present(&target).map_err(|error| ("target_metadata", error))? {
                    Ok(ThumbnailWriteOutcome::AlreadyPresent)
                } else {
                    Err(("publish", error))
                }
            }
            Err(error) => Err(("publish", error)),
        }
    })();
    if matches!(outcome, Ok(ThumbnailWriteOutcome::Written)) {
        if let Some(usage) = usage_guard
            .as_mut()
            .and_then(|usage| usage.get_mut(cache_dir))
        {
            usage.bytes = usage.bytes.saturating_add(additional_bytes);
            usage.files = usage.files.saturating_add(1);
            usage.writes_since_scan += 1;
        }
    }
    if let Err(error) = fs::remove_file(&temp_path) {
        if error.kind() != io::ErrorKind::NotFound {
            return ThumbnailWriteOutcome::Failed("temp_cleanup", error);
        }
    }
    match outcome {
        Ok(outcome) => outcome,
        Err((stage, error)) => ThumbnailWriteOutcome::Failed(stage, error),
    }
}

fn scan_thumbnail_usage(cache_dir: &Path) -> io::Result<ThumbnailUsage> {
    let mut usage = ThumbnailUsage {
        bytes: 0,
        files: 0,
        writes_since_scan: 0,
    };
    for (index, entry) in fs::read_dir(cache_dir)?.enumerate() {
        if index >= THUMBNAIL_CACHE_SCAN_LIMIT {
            return Err(io::ErrorKind::InvalidData.into());
        }
        let entry = entry?;
        if entry
            .path()
            .extension()
            .is_some_and(|extension| extension == "spxr")
        {
            let metadata = fs::symlink_metadata(entry.path())?;
            if ordinary_file(&metadata) {
                usage.bytes = usage.bytes.saturating_add(metadata.len());
                usage.files += 1;
            }
        }
    }
    Ok(usage)
}

fn thumbnail_target_present(target: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(target) {
        Ok(metadata) if ordinary_file(&metadata) => Ok(true),
        Ok(_) => Err(io::ErrorKind::InvalidData.into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
fn make_thumbnail_room(cache_dir: &Path, additional_bytes: u64, additional_files: usize) -> bool {
    make_thumbnail_room_with_limits(
        cache_dir,
        additional_bytes,
        additional_files,
        THUMBNAIL_CACHE_BYTES,
        THUMBNAIL_CACHE_FILES,
    )
}

#[cfg(test)]
fn make_thumbnail_room_with_limits(
    cache_dir: &Path,
    additional_bytes: u64,
    additional_files: usize,
    byte_limit: u64,
    file_limit: usize,
) -> bool {
    make_thumbnail_room_with_limits_checked(
        cache_dir,
        additional_bytes,
        additional_files,
        byte_limit,
        file_limit,
    )
    .unwrap_or(false)
}

fn make_thumbnail_room_with_limits_checked(
    cache_dir: &Path,
    additional_bytes: u64,
    additional_files: usize,
    byte_limit: u64,
    file_limit: usize,
) -> io::Result<bool> {
    if additional_bytes > byte_limit || additional_files > file_limit {
        return Ok(false);
    }
    let entries = fs::read_dir(cache_dir)?;
    let mut files = Vec::new();
    let mut count = 0usize;
    let mut bytes = 0u64;
    for entry in entries.take(THUMBNAIL_CACHE_SCAN_LIMIT + 1) {
        let entry = entry?;
        count += 1;
        if count > THUMBNAIL_CACHE_SCAN_LIMIT {
            // Never add more bytes to an externally bloated directory. The
            // normal app path stays at or below the fixed scan bound.
            return Ok(false);
        }
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if path
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with(".tmp-"))
        {
            // Another process may still be publishing this file. Only remove
            // clearly abandoned temporary files.
            if metadata
                .modified()
                .ok()
                .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                .is_some_and(|age| age >= THUMBNAIL_TEMP_STALE_AGE)
            {
                let _ = fs::remove_file(&path);
            }
            continue;
        }
        if !metadata.file_type().is_file() || path.extension().is_none_or(|ext| ext != "spxr") {
            continue;
        }
        bytes = bytes.saturating_add(metadata.len());
        files.push((
            path,
            metadata.len(),
            metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        ));
    }
    files.sort_by_key(|(_, _, modified)| *modified);
    let mut file_count = files.len();
    let mut eviction_error = None;
    for (path, size, _) in files {
        if bytes.saturating_add(additional_bytes) <= byte_limit
            && file_count.saturating_add(additional_files) <= file_limit
        {
            break;
        }
        match fs::remove_file(path) {
            Ok(()) => {
                bytes = bytes.saturating_sub(size);
                file_count -= 1;
            }
            Err(error) => eviction_error = Some(error),
        }
    }
    let has_room = bytes.saturating_add(additional_bytes) <= byte_limit
        && file_count.saturating_add(additional_files) <= file_limit;
    match (has_room, eviction_error) {
        (false, Some(error)) => Err(error),
        _ => Ok(has_room),
    }
}

fn load_cover_pixels_blocking(
    app_cache_dir: &Path,
    requested_path: &str,
    max_edge: u32,
) -> Result<Vec<u8>, CoverPixelsError> {
    let covers_root = app_cache_dir
        .join(AUDIO_CACHE_DIRECTORY)
        .join(COVER_DIRECTORY);
    let path = validate_cover_path(&covers_root, Path::new(requested_path))?;
    let bytes = read_bounded_file(&path)?;
    decode_and_pack(&bytes, max_edge)
}

fn validate_max_edge(max_edge: u32) -> Result<(), CoverPixelsError> {
    if ALLOWED_MAX_EDGES.contains(&max_edge) {
        Ok(())
    } else {
        Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidMaxEdge,
            format!(
                "maxEdge must be one of {}",
                ALLOWED_MAX_EDGES
                    .iter()
                    .map(u32::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        ))
    }
}

fn validate_playlist_max_edge(max_edge: u32) -> Result<(), CoverPixelsError> {
    if ALLOWED_PLAYLIST_MAX_EDGES.contains(&max_edge) {
        Ok(())
    } else {
        Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidMaxEdge,
            "playlist cover maxEdge must be 128, 256, or 512",
        ))
    }
}

fn validate_decode_max_edge(max_edge: u32) -> Result<(), CoverPixelsError> {
    if ALLOWED_PLAYLIST_MAX_EDGES.contains(&max_edge) {
        Ok(())
    } else {
        validate_max_edge(max_edge)
    }
}

fn validate_playlist_client_id(client_id: &str) -> Result<(), CoverPixelsError> {
    if !client_id.is_empty()
        && client_id.len() <= 128
        && client_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Ok(())
    } else {
        Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidClientId,
            "clientId must contain 1-128 ASCII letters, digits, hyphens, or underscores",
        ))
    }
}

fn validate_cover_path(
    covers_root: &Path,
    requested_path: &Path,
) -> Result<PathBuf, CoverPixelsError> {
    if requested_path.as_os_str().is_empty() {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover file path is empty",
        ));
    }

    let canonical_root = fs::canonicalize(covers_root).map_err(|error| {
        tracing::warn!(
            operation = "audio.cover_pixels.validate_root",
            path = %covers_root.display(),
            error = %error,
            "cover cache directory is unavailable",
        );
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache directory is unavailable",
        )
    })?;

    let link_metadata = fs::symlink_metadata(requested_path).map_err(|error| {
        tracing::warn!(
            operation = "audio.cover_pixels.validate_path",
            path = %requested_path.display(),
            error = %error,
            "cover cache file is unavailable",
        );
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache file is unavailable",
        )
    })?;

    if link_metadata.file_type().is_symlink() {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache path must not be a symbolic link",
        ));
    }

    let canonical_path = fs::canonicalize(requested_path).map_err(|error| {
        tracing::warn!(
            operation = "audio.cover_pixels.canonicalize_path",
            path = %requested_path.display(),
            error = %error,
            "cover cache file path cannot be resolved",
        );
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache file path cannot be resolved",
        )
    })?;

    if !canonical_path.starts_with(&canonical_root) || !link_metadata.file_type().is_file() {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover path is not a regular file in the audio cover cache",
        ));
    }

    Ok(canonical_path)
}

fn read_bounded_file(path: &Path) -> Result<Vec<u8>, CoverPixelsError> {
    let file = File::open(path).map_err(|error| {
        tracing::warn!(
            operation = "audio.cover_pixels.open",
            path = %path.display(),
            error = %error,
            "failed to open cover cache file",
        );
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache file cannot be opened",
        )
    })?;

    let metadata = file.metadata().map_err(|error| {
        tracing::warn!(
            operation = "audio.cover_pixels.metadata",
            path = %path.display(),
            error = %error,
            "failed to read cover cache file metadata",
        );
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache file metadata is unavailable",
        )
    })?;

    if !metadata.is_file() {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache path is not a regular file",
        ));
    }
    if metadata.len() == 0 || metadata.len() > MAX_INPUT_BYTES {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::FileTooLarge,
            format!("cover file must contain 1 to {MAX_INPUT_BYTES} bytes"),
        ));
    }

    let initial_capacity = usize::try_from(metadata.len()).map_err(|_| {
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::FileTooLarge,
            "cover file size is not supported on this platform",
        )
    })?;
    let mut bytes = Vec::new();
    bytes.try_reserve_exact(initial_capacity).map_err(|_| {
        CoverPixelsError::internal(
            CoverPixelsErrorCode::AllocationFailed,
            "not enough memory to read cover file",
        )
    })?;

    file.take(MAX_INPUT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            tracing::warn!(
                operation = "audio.cover_pixels.read",
                path = %path.display(),
                error = %error,
                "failed to read cover cache file",
            );
            CoverPixelsError::recoverable(
                CoverPixelsErrorCode::InvalidPath,
                "cover cache file cannot be read",
            )
        })?;

    if bytes.is_empty() || u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_INPUT_BYTES {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::FileTooLarge,
            format!("cover file must contain 1 to {MAX_INPUT_BYTES} bytes"),
        ));
    }

    Ok(bytes)
}

fn decode_and_pack(bytes: &[u8], max_edge: u32) -> Result<Vec<u8>, CoverPixelsError> {
    decode_and_pack_with_strategy(bytes, max_edge, false)
}

fn decode_playlist_and_pack(bytes: &[u8], max_edge: u32) -> Result<Vec<u8>, CoverPixelsError> {
    decode_and_pack_with_strategy(bytes, max_edge, true)
}

/// Both axes must permit at least a 2:1 integer pre-reduction while retaining
/// at least four times the final resolution. The wider final Lanczos pass
/// avoids the visible high-frequency aliasing of a two-times intermediate.
/// Thin images fall back to direct Lanczos.
fn playlist_pre_dimensions(source: (u32, u32), target: (u32, u32)) -> Option<(u32, u32)> {
    let factor = (source.0 / target.0.checked_mul(4)?).min(source.1 / target.1.checked_mul(4)?);
    (factor >= 2).then(|| (source.0.div_ceil(factor), source.1.div_ceil(factor)))
}

fn decode_and_pack_with_strategy(
    bytes: &[u8],
    max_edge: u32,
    playlist: bool,
) -> Result<Vec<u8>, CoverPixelsError> {
    validate_decode_max_edge(max_edge)?;

    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(invalid_image)?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_EDGE);
    limits.max_image_height = Some(MAX_SOURCE_EDGE);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);

    let mut decoder = reader.into_decoder().map_err(invalid_image)?;
    let (encoded_width, encoded_height) = decoder.dimensions();
    let decoded_bytes = decoder.total_bytes();
    validate_source_dimensions(encoded_width, encoded_height, decoded_bytes)?;

    // Account for the decoder's output buffer before granting its internal allocation
    // budget. `max_alloc` is best-effort in image, while the dimension and byte checks
    // above are enforced independently by this command.
    let mut remaining_limits = Limits::default();
    remaining_limits.max_image_width = Some(MAX_SOURCE_EDGE);
    remaining_limits.max_image_height = Some(MAX_SOURCE_EDGE);
    remaining_limits.max_alloc = Some(MAX_DECODE_BYTES);
    remaining_limits
        .reserve(decoded_bytes)
        .map_err(image_too_large)?;
    decoder
        .set_limits(remaining_limits)
        .map_err(image_too_large)?;

    let orientation = decoder.orientation().map_err(invalid_image)?;
    let orientation_applied = orientation != Orientation::NoTransforms;
    let mut image = DynamicImage::from_decoder(decoder).map_err(invalid_image)?;
    image.apply_orientation(orientation);

    let (source_width, source_height) = image.dimensions();
    validate_source_dimensions(source_width, source_height, image.as_bytes().len() as u64)?;
    let (width, height) = scaled_dimensions(source_width, source_height, max_edge)?;
    let resized = (width, height) != (source_width, source_height);

    if resized {
        if playlist {
            if let Some((pre_width, pre_height)) =
                playlist_pre_dimensions((source_width, source_height), (width, height))
            {
                // image's thumbnail_exact averages integer pixel blocks. It
                // operates on the same straight channels as the existing
                // resize, without introducing a color-space/alpha conversion.
                image = image.thumbnail_exact(pre_width, pre_height);
            }
        }
        image = image.resize_exact(width, height, FilterType::Lanczos3);
    }

    // `image` exposes ICC bytes but does not apply arbitrary embedded ICC profiles
    // during DynamicImage decoding. The protocol therefore deliberately describes
    // channel layout only and does not claim the returned values were converted to sRGB.
    let pixels = image.into_rgba8().into_raw();
    pack_rgba(
        pixels,
        width,
        height,
        source_width,
        source_height,
        orientation_applied,
        resized,
    )
}

fn validate_source_dimensions(
    width: u32,
    height: u32,
    decoded_bytes: u64,
) -> Result<(), CoverPixelsError> {
    let pixels = u64::from(width).checked_mul(u64::from(height));
    if width == 0
        || height == 0
        || width > MAX_SOURCE_EDGE
        || height > MAX_SOURCE_EDGE
        || pixels.is_none_or(|pixels| pixels > MAX_SOURCE_PIXELS)
        || decoded_bytes > MAX_DECODE_BYTES
    {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::ImageTooLarge,
            "cover image dimensions or decoded size exceed the safety limit",
        ));
    }
    Ok(())
}

fn scaled_dimensions(
    width: u32,
    height: u32,
    max_edge: u32,
) -> Result<(u32, u32), CoverPixelsError> {
    validate_decode_max_edge(max_edge)?;
    if width == 0 || height == 0 {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidImage,
            "cover image has invalid dimensions",
        ));
    }

    if width.max(height) <= max_edge {
        return Ok((width, height));
    }

    let (scaled_width, scaled_height) = if width >= height {
        let scaled_height =
            (u64::from(height) * u64::from(max_edge) + u64::from(width) / 2) / u64::from(width);
        (u64::from(max_edge), scaled_height.max(1))
    } else {
        let scaled_width =
            (u64::from(width) * u64::from(max_edge) + u64::from(height) / 2) / u64::from(height);
        (scaled_width.max(1), u64::from(max_edge))
    };

    let scaled_width = u32::try_from(scaled_width).map_err(|_| {
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::ImageTooLarge,
            "scaled cover width exceeds the supported range",
        )
    })?;
    let scaled_height = u32::try_from(scaled_height).map_err(|_| {
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::ImageTooLarge,
            "scaled cover height exceeds the supported range",
        )
    })?;
    Ok((scaled_width, scaled_height))
}

#[allow(clippy::too_many_arguments)]
fn pack_rgba(
    pixels: Vec<u8>,
    width: u32,
    height: u32,
    source_width: u32,
    source_height: u32,
    orientation_applied: bool,
    resized: bool,
) -> Result<Vec<u8>, CoverPixelsError> {
    let stride = width.checked_mul(4).ok_or_else(|| {
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::ImageTooLarge,
            "cover pixel stride exceeds the supported range",
        )
    })?;
    let expected_len = u64::from(stride)
        .checked_mul(u64::from(height))
        .ok_or_else(|| {
            CoverPixelsError::recoverable(
                CoverPixelsErrorCode::ImageTooLarge,
                "cover pixel length exceeds the supported range",
            )
        })?;

    if expected_len > MAX_OUTPUT_BYTES || expected_len != pixels.len() as u64 {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::ImageTooLarge,
            "cover pixel buffer length is invalid or exceeds the safety limit",
        ));
    }
    let pixel_len = u32::try_from(expected_len).map_err(|_| {
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::ImageTooLarge,
            "cover pixel buffer length exceeds the protocol range",
        )
    })?;

    let mut output = Vec::new();
    output
        .try_reserve_exact(usize::from(HEADER_LEN) + pixels.len())
        .map_err(|_| {
            CoverPixelsError::internal(
                CoverPixelsErrorCode::AllocationFailed,
                "not enough memory to build cover pixel response",
            )
        })?;

    let mut flags = 0;
    if orientation_applied {
        flags |= FLAG_ORIENTATION_APPLIED;
    }
    if resized {
        flags |= FLAG_RESIZED;
    }

    output.extend_from_slice(&HEADER_MAGIC);
    output.extend_from_slice(&HEADER_VERSION.to_le_bytes());
    output.extend_from_slice(&HEADER_LEN.to_le_bytes());
    output.extend_from_slice(&width.to_le_bytes());
    output.extend_from_slice(&height.to_le_bytes());
    output.extend_from_slice(&stride.to_le_bytes());
    output.extend_from_slice(&PIXEL_FORMAT_RGBA8_UNPREMULTIPLIED.to_le_bytes());
    output.extend_from_slice(&pixel_len.to_le_bytes());
    output.extend_from_slice(&flags.to_le_bytes());
    output.extend_from_slice(&source_width.to_le_bytes());
    output.extend_from_slice(&source_height.to_le_bytes());
    output.extend_from_slice(&pixels);
    Ok(output)
}

fn invalid_image(error: impl std::fmt::Display) -> CoverPixelsError {
    tracing::warn!(
        operation = "audio.cover_pixels.decode",
        error = %error,
        "cover image could not be decoded",
    );
    CoverPixelsError::recoverable(
        CoverPixelsErrorCode::InvalidImage,
        "cover image format or data is invalid",
    )
}

fn image_too_large(error: ImageError) -> CoverPixelsError {
    tracing::warn!(
        operation = "audio.cover_pixels.limit",
        error = %error,
        "cover image exceeded decoder safety limits",
    );
    CoverPixelsError::recoverable(
        CoverPixelsErrorCode::ImageTooLarge,
        "cover image dimensions or decoded size exceed the safety limit",
    )
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Cursor,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicU64, AtomicUsize, Ordering},
            Arc,
        },
        time::Instant,
    };

    use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
    use lofty::file::TaggedFileExt;
    use lofty::{
        config::WriteOptions,
        picture::{MimeType, Picture, PictureType},
        tag::{Tag, TagExt, TagType},
    };

    use super::*;

    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    static TRACK_INDEX_TEST_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "spmusic-cover-pixels-{}-{}",
                std::process::id(),
                sequence
            ));
            fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    // These hooks/counters belong to one coordinator, so independent tests may run
    // in parallel. Blocking gates use notifications, never scheduling sleeps.
    struct SafetyPauseState {
        events: std::sync::mpsc::Sender<PlaylistTestStage>,
        stage: PlaylistTestStage,
        remaining: AtomicUsize,
        released: (StdMutex<bool>, Condvar),
        panic_on_release: bool,
        active: AtomicUsize,
        peak: AtomicUsize,
        decodes: AtomicUsize,
        released_requests: (StdMutex<usize>, Condvar),
    }

    struct SafetyPause {
        state: Arc<SafetyPauseState>,
        events: std::sync::mpsc::Receiver<PlaylistTestStage>,
    }

    impl SafetyPause {
        fn install(
            coordinator: &PlaylistCoverRequestCoordinator,
            stage: PlaylistTestStage,
            count: usize,
            panic_on_release: bool,
        ) -> Self {
            let (sender, events) = std::sync::mpsc::channel();
            let state = Arc::new(SafetyPauseState {
                events: sender,
                stage,
                remaining: AtomicUsize::new(count),
                released: (StdMutex::new(false), Condvar::new()),
                panic_on_release,
                active: AtomicUsize::new(0),
                peak: AtomicUsize::new(0),
                decodes: AtomicUsize::new(0),
                released_requests: (StdMutex::new(0), Condvar::new()),
            });
            let hook_state = Arc::clone(&state);
            *coordinator.hook.lock().unwrap() = Some(Arc::new(move |observed| {
                if observed == PlaylistTestStage::Entered {
                    let active = hook_state.active.fetch_add(1, Ordering::AcqRel) + 1;
                    hook_state.peak.fetch_max(active, Ordering::AcqRel);
                } else if observed == PlaylistTestStage::Left {
                    hook_state.active.fetch_sub(1, Ordering::AcqRel);
                } else if observed == PlaylistTestStage::Decoding {
                    hook_state.decodes.fetch_add(1, Ordering::AcqRel);
                } else if observed == PlaylistTestStage::RequestReleased {
                    *hook_state.released_requests.0.lock().unwrap() += 1;
                    hook_state.released_requests.1.notify_all();
                }
                let _ = hook_state.events.send(observed);
                if observed == hook_state.stage
                    && hook_state
                        .remaining
                        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |left| {
                            left.checked_sub(1)
                        })
                        .is_ok()
                {
                    let (lock, wake) = &hook_state.released;
                    let mut released = lock.lock().unwrap();
                    while !*released {
                        let (next, timeout) = wake
                            .wait_timeout(released, std::time::Duration::from_secs(15))
                            .unwrap();
                        released = next;
                        assert!(!timeout.timed_out(), "safety gate timed out");
                    }
                    drop(released);
                    assert!(!hook_state.panic_on_release, "injected flight leader panic");
                }
            }));
            Self { state, events }
        }

        fn wait(&self, wanted: PlaylistTestStage, count: usize) {
            let mut seen = 0;
            while seen < count {
                let stage = self
                    .events
                    .recv_timeout(std::time::Duration::from_secs(15))
                    .expect("safety event timed out");
                if stage == wanted {
                    seen += 1;
                }
            }
        }

        fn release(&self) {
            *self.state.released.0.lock().unwrap() = true;
            self.state.released.1.notify_all();
        }

        fn wait_released(&self, count: usize) {
            let (lock, wake) = &self.state.released_requests;
            let mut released = lock.lock().unwrap();
            while *released < count {
                let (next, timeout) = wake
                    .wait_timeout(released, std::time::Duration::from_secs(15))
                    .unwrap();
                released = next;
                assert!(!timeout.timed_out(), "request cleanup timed out");
            }
        }
    }

    impl Drop for SafetyPause {
        fn drop(&mut self) {
            self.release();
        }
    }

    fn safety_source(dir: &TestDirectory, name: &str, width: u32) -> PathBuf {
        let covers = dir.path().join("audio").join(COVER_DIRECTORY);
        fs::create_dir_all(&covers).unwrap();
        let path = covers.join(name);
        fs::write(&path, png_bytes(width, 2)).unwrap();
        path
    }

    fn safety_input(
        coordinator: &PlaylistCoverRequestCoordinator,
        path: &Path,
        client: &str,
    ) -> AudioLoadPlaylistCoverPixelsInput {
        AudioLoadPlaylistCoverPixelsInput {
            client_id: client.into(),
            file_path: path.to_str().unwrap().into(),
            max_edge: 128,
            window_generation: coordinator.begin_window(client).unwrap(),
        }
    }

    fn safety_start(
        coordinator: &Arc<PlaylistCoverRequestCoordinator>,
        root: &Path,
        input: AudioLoadPlaylistCoverPixelsInput,
    ) -> tauri::async_runtime::JoinHandle<Result<Vec<u8>, CoverPixelsError>> {
        let coordinator = Arc::clone(coordinator);
        let root = root.to_owned();
        tauri::async_runtime::spawn(async move { coordinator.load(root, input).await })
    }

    fn safety_assert_idle(coordinator: &PlaylistCoverRequestCoordinator) {
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 0);
        assert!(coordinator.flights.entries.lock().unwrap().is_empty());
    }

    #[test]
    fn sp022_safety_panic_drop_wakes_waiters_and_removes_flight() {
        let registry = Arc::new(PlaylistFlights::default());
        let key = PlaylistDecodeKey {
            covers_root: PathBuf::from("synthetic-root"),
            source_hash: blake3::hash(b"a"),
            max_edge: 128,
            transform_version: 1,
            disk_version: 1,
        };
        for _ in 0..5 {
            let leader = match registry.register(key.clone()).unwrap() {
                PlaylistFlightAttempt::Leader(leader) => leader,
                _ => panic!("expected leader"),
            };
            let mut waiters = Vec::new();
            for _ in 0..4 {
                if let PlaylistFlightAttempt::Joined(receiver) =
                    registry.register(key.clone()).unwrap()
                {
                    waiters.push(receiver);
                }
            }
            assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _leader = leader;
                panic!("injected unwind");
            }))
            .is_err());
            tauri::async_runtime::block_on(async {
                for mut waiter in waiters {
                    let error = waiter
                        .recv()
                        .await
                        .unwrap_or_else(|| Err(playlist_worker_failed()))
                        .unwrap_err();
                    assert!(matches!(error.code, CoverPixelsErrorCode::WorkerFailed));
                    assert!(!error.recoverable);
                }
            });
            assert!(registry.entries.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn sp022_safety_flight_waiters_are_bounded_across_cancellation_churn() {
        let registry = Arc::new(PlaylistFlights::default());
        let key = PlaylistDecodeKey {
            covers_root: PathBuf::from("synthetic-root"),
            source_hash: blake3::hash(b"a"),
            max_edge: 128,
            transform_version: 1,
            disk_version: 1,
        };
        let leader = match registry.register(key.clone()).unwrap() {
            PlaylistFlightAttempt::Leader(leader) => leader,
            _ => panic!("expected leader"),
        };
        for _ in 0..100 {
            let receiver = match registry.register(key.clone()).unwrap() {
                PlaylistFlightAttempt::Joined(receiver) => receiver,
                _ => panic!("expected waiter"),
            };
            drop(receiver);
            assert!(registry.entries.lock().unwrap()[&key].len() <= 1);
        }
        let waiters: Vec<_> = (0..MAX_PLAYLIST_FLIGHT_WAITERS)
            .map(|_| match registry.register(key.clone()).unwrap() {
                PlaylistFlightAttempt::Joined(receiver) => receiver,
                _ => panic!("expected waiter"),
            })
            .collect();
        let error = match registry.register(key.clone()) {
            Err(error) => error,
            Ok(_) => panic!("must reject excess waiter"),
        };
        assert!(matches!(error.code, CoverPixelsErrorCode::WorkerFailed));
        assert!(!error.recoverable);
        drop(waiters);
        leader.publish(Ok(Arc::new(vec![1])));
        assert!(registry.entries.lock().unwrap().is_empty());
    }

    #[test]
    fn sp022_safety_keys_isolate_root_edge_transform_and_disk_version() {
        let registry = Arc::new(PlaylistFlights::default());
        let key = PlaylistDecodeKey {
            covers_root: PathBuf::from("root-a"),
            source_hash: blake3::hash(b"same bytes"),
            max_edge: 128,
            transform_version: 1,
            disk_version: 1,
        };
        let mut keys = vec![key.clone()];
        let mut changed = key.clone();
        changed.covers_root = PathBuf::from("root-b");
        keys.push(changed);
        let mut changed = key.clone();
        changed.max_edge = 256;
        keys.push(changed);
        let mut changed = key.clone();
        changed.transform_version += 1;
        keys.push(changed);
        let mut changed = key;
        changed.disk_version += 1;
        keys.push(changed);
        let leaders: Vec<_> = keys
            .into_iter()
            .map(|key| match registry.register(key).unwrap() {
                PlaylistFlightAttempt::Leader(leader) => leader,
                _ => panic!("different complete keys must not join"),
            })
            .collect();
        assert_eq!(registry.entries.lock().unwrap().len(), 5);
        drop(leaders);
        assert!(registry.entries.lock().unwrap().is_empty());
    }

    #[test]
    fn sp022_safety_fifo_survivors_progress_after_head_and_middle_cancellation() {
        use std::{
            pin::Pin,
            task::{Context, Poll, Waker},
        };
        tauri::async_runtime::block_on(async {
            let coordinator = Arc::new(PlaylistCoverRequestCoordinator::new());
            let mut held = Vec::new();
            for _ in 0..PLAYLIST_DECODE_PERMITS {
                held.push(coordinator.slots.acquire().await.unwrap());
            }
            let (sender, receiver) = std::sync::mpsc::channel();
            let mut jobs = Vec::new();
            for index in 0..5 {
                let coordinator = Arc::clone(&coordinator);
                let sender = sender.clone();
                let mut queued = Box::pin(async move {
                    let permit = coordinator.slots.acquire().await.unwrap();
                    sender.send(index).unwrap();
                    permit
                });
                // Poll once while all tokens are held: this establishes actual
                // async Mutex queue order instead of relying on task scheduling.
                assert!(matches!(
                    Pin::new(&mut queued).poll(&mut Context::from_waker(Waker::noop())),
                    Poll::Pending
                ));
                jobs.push(Some(tauri::async_runtime::spawn(queued)));
            }
            for index in [0, 2] {
                let job = jobs[index].take().unwrap();
                job.abort();
                assert!(job.await.is_err());
            }
            // Keep N-1 tokens held; one survivor at a time can acquire the final
            // token, and its returned permit remains in its join result.
            drop(held.pop());
            for expected in [1, 3, 4] {
                assert_eq!(
                    receiver
                        .recv_timeout(std::time::Duration::from_secs(10))
                        .unwrap(),
                    expected
                );
                let permit = jobs[expected].take().unwrap().await.unwrap();
                drop(permit);
            }
            drop(held);
            let mut reacquired = Vec::new();
            for _ in 0..PLAYLIST_DECODE_PERMITS {
                reacquired.push(coordinator.slots.acquire().await.unwrap());
            }
            drop(reacquired);
        });
    }

    #[test]
    fn sp022_safety_completed_response_keeps_request_reservation_until_consumed() {
        let coordinator = PlaylistCoverRequestCoordinator::new();
        let reservation = coordinator.reserve_request().unwrap();
        let result = PlaylistWorkerResult::Complete(
            Ok(Arc::new(vec![0; usize::from(HEADER_LEN) + 512 * 512 * 4])),
            reservation,
        );
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 1);
        drop(result);
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 0);
        assert!(validate_source_dimensions(8192, 8192, MAX_DECODE_BYTES).is_ok());
        assert!(validate_source_dimensions(8192, 8193, MAX_DECODE_BYTES + 1).is_err());
        assert!(validate_source_dimensions(MAX_SOURCE_EDGE + 1, 1, 4).is_err());
    }

    #[test]
    fn sp022_safety_request_cap_and_queued_cancellation_release_every_reservation() {
        tauri::async_runtime::block_on(async {
            let dir = TestDirectory::new();
            let source = safety_source(&dir, "source.png", 4);
            let coordinator = Arc::new(PlaylistCoverRequestCoordinator::new());
            let input = safety_input(&coordinator, &source, "cap-client");
            let pause = SafetyPause::install(&coordinator, PlaylistTestStage::Entered, 0, false);
            let mut held = Vec::new();
            for _ in 0..PLAYLIST_DECODE_PERMITS {
                held.push(coordinator.slots.acquire().await.unwrap());
            }
            let jobs: Vec<_> = (0..MAX_PLAYLIST_REQUESTS)
                .map(|_| safety_start(&coordinator, dir.path(), input.clone()))
                .collect();
            pause.wait(PlaylistTestStage::Queued, MAX_PLAYLIST_REQUESTS);
            assert_eq!(
                coordinator.requests.load(Ordering::Acquire),
                MAX_PLAYLIST_REQUESTS
            );
            let error = coordinator
                .load(dir.path().into(), input.clone())
                .await
                .unwrap_err();
            assert!(matches!(error.code, CoverPixelsErrorCode::WorkerFailed));
            assert!(!error.recoverable);
            for job in &jobs {
                job.abort();
            }
            for job in jobs {
                assert!(job.await.is_err());
            }
            safety_assert_idle(&coordinator);
            assert_eq!(pause.state.active.load(Ordering::Acquire), 0);
            drop(held);
            coordinator.load(dir.path().into(), input).await.unwrap();
            safety_assert_idle(&coordinator);
        });
    }

    #[test]
    fn sp022_safety_cancelled_workers_keep_permits_and_request_reservations() {
        tauri::async_runtime::block_on(async {
            let dir = TestDirectory::new();
            let coordinator = Arc::new(PlaylistCoverRequestCoordinator::new());
            let pause = SafetyPause::install(
                &coordinator,
                PlaylistTestStage::Entered,
                PLAYLIST_DECODE_PERMITS,
                false,
            );
            let mut active = Vec::new();
            for index in 0..PLAYLIST_DECODE_PERMITS {
                let source = safety_source(&dir, &format!("{index}.png"), 4 + index as u32);
                let input = safety_input(&coordinator, &source, &format!("active-{index}"));
                active.push(safety_start(&coordinator, dir.path(), input));
            }
            pause.wait(PlaylistTestStage::Entered, PLAYLIST_DECODE_PERMITS);
            for job in &active {
                job.abort();
            }
            for job in active {
                assert!(job.await.is_err());
            }
            assert_eq!(
                coordinator.requests.load(Ordering::Acquire),
                PLAYLIST_DECODE_PERMITS
            );
            let source = safety_source(&dir, "later.png", 9);
            let input = safety_input(&coordinator, &source, "later");
            let later = safety_start(&coordinator, dir.path(), input);
            pause.wait(PlaylistTestStage::Queued, 1);
            assert_eq!(
                pause.state.active.load(Ordering::Acquire),
                PLAYLIST_DECODE_PERMITS
            );
            if let Ok(mut tokens) = coordinator.slots.tokens.try_lock() {
                assert!(tokens.try_recv().is_err());
            }
            pause.release();
            later.await.unwrap().unwrap();
            pause.wait(PlaylistTestStage::Left, PLAYLIST_DECODE_PERMITS + 1);
            pause.wait_released(PLAYLIST_DECODE_PERMITS + 1);
            assert_eq!(
                pause.state.peak.load(Ordering::Acquire),
                PLAYLIST_DECODE_PERMITS
            );
            safety_assert_idle(&coordinator);
        });
    }

    #[test]
    fn sp022_safety_content_aliases_share_decode_and_path_changes_rehash() {
        tauri::async_runtime::block_on(async {
            let dir = TestDirectory::new();
            let source = safety_source(&dir, "one.png", 4);
            let alias = source.with_file_name("two.png");
            fs::copy(&source, &alias).unwrap();
            let coordinator = Arc::new(PlaylistCoverRequestCoordinator::new());
            let first = safety_input(&coordinator, &source, "first");
            let second = safety_input(&coordinator, &alias, "second");
            let pause = SafetyPause::install(&coordinator, PlaylistTestStage::Leader, 1, false);
            let a = safety_start(&coordinator, dir.path(), first.clone());
            pause.wait(PlaylistTestStage::Leader, 1);
            let b = safety_start(&coordinator, dir.path(), second.clone());
            if PLAYLIST_DECODE_PERMITS == 2 {
                pause.wait(PlaylistTestStage::Joined, 1);
            }
            pause.release();
            let first_bytes = a.await.unwrap().unwrap();
            assert_eq!(first_bytes, b.await.unwrap().unwrap());
            assert_eq!(pause.state.decodes.load(Ordering::Acquire), 1);
            fs::write(&alias, png_bytes(7, 2)).unwrap();
            let changed = coordinator.load(dir.path().into(), second).await.unwrap();
            assert_ne!(first_bytes, changed);
            let mut other_edge = first.clone();
            other_edge.max_edge = 256;
            coordinator
                .load(dir.path().into(), other_edge)
                .await
                .unwrap();
            let outside = dir.path().join("outside.png");
            fs::copy(&source, &outside).unwrap();
            let mut invalid = first;
            invalid.file_path = outside.to_str().unwrap().into();
            assert!(matches!(
                coordinator
                    .load(dir.path().into(), invalid)
                    .await
                    .unwrap_err()
                    .code,
                CoverPixelsErrorCode::InvalidPath
            ));
            assert_eq!(pause.state.decodes.load(Ordering::Acquire), 3);
            safety_assert_idle(&coordinator);
        });
    }

    #[test]
    #[cfg(feature = "sp022-playlist-decode-n2")]
    fn sp022_safety_leader_abort_stale_failure_and_panic_leave_valid_waiter_independent() {
        // With N=1, actual followers cannot read/register until the leader exits;
        // panic fan-out is independently checked by the registry test above.
        for mode in ["abort", "stale", "panic", "invalid"] {
            for _ in 0..5 {
                tauri::async_runtime::block_on(async {
                    let dir = TestDirectory::new();
                    let source = safety_source(&dir, "shared.png", 4);
                    if mode == "invalid" {
                        fs::write(&source, b"invalid image").unwrap();
                    }
                    let coordinator = Arc::new(PlaylistCoverRequestCoordinator::new());
                    let first = safety_input(&coordinator, &source, "leader");
                    let second = safety_input(&coordinator, &source, "waiter");
                    let pause = SafetyPause::install(
                        &coordinator,
                        PlaylistTestStage::Leader,
                        1,
                        mode == "panic",
                    );
                    let leader = safety_start(&coordinator, dir.path(), first.clone());
                    pause.wait(PlaylistTestStage::Leader, 1);
                    let waiter = safety_start(&coordinator, dir.path(), second.clone());
                    pause.wait(PlaylistTestStage::Joined, 1);
                    if mode == "abort" {
                        leader.abort();
                    }
                    if mode == "stale" {
                        coordinator.begin_window("leader").unwrap();
                    }
                    pause.release();
                    let leader_result = leader.await;
                    let waiter_result = waiter.await.unwrap();
                    match mode {
                        "abort" => {
                            assert!(leader_result.is_err());
                            waiter_result.unwrap();
                        }
                        "stale" => {
                            assert!(matches!(
                                leader_result.unwrap().unwrap_err().code,
                                CoverPixelsErrorCode::StaleRequest
                            ));
                            waiter_result.unwrap();
                            let thumbs = dir.path().join("audio").join(THUMBNAIL_DIRECTORY);
                            assert_eq!(fs::read_dir(thumbs).unwrap().count(), 0);
                        }
                        "panic" => {
                            assert!(matches!(
                                leader_result.unwrap().unwrap_err().code,
                                CoverPixelsErrorCode::WorkerFailed
                            ));
                            assert!(matches!(
                                waiter_result.unwrap_err().code,
                                CoverPixelsErrorCode::WorkerFailed
                            ));
                        }
                        "invalid" => {
                            assert!(matches!(
                                leader_result.unwrap().unwrap_err().code,
                                CoverPixelsErrorCode::InvalidImage
                            ));
                            assert!(matches!(
                                waiter_result.unwrap_err().code,
                                CoverPixelsErrorCode::InvalidImage
                            ));
                        }
                        _ => unreachable!(),
                    }
                    safety_assert_idle(&coordinator);
                    // Same content key after a leader failure must never hang.
                    if mode == "panic" {
                        coordinator.load(dir.path().into(), second).await.unwrap();
                    } else if mode == "invalid" {
                        fs::write(&source, png_bytes(4, 2)).unwrap();
                        coordinator.load(dir.path().into(), second).await.unwrap();
                    }
                    safety_assert_idle(&coordinator);
                });
            }
        }
    }

    #[test]
    #[cfg(feature = "sp022-playlist-decode-n2")]
    fn sp022_safety_waiter_cancellation_and_generation_do_not_cancel_leader() {
        tauri::async_runtime::block_on(async {
            let dir = TestDirectory::new();
            let source = safety_source(&dir, "source.png", 5);
            let coordinator = Arc::new(PlaylistCoverRequestCoordinator::new());
            let a = safety_input(&coordinator, &source, "leader");
            let b = safety_input(&coordinator, &source, "cancelled");
            let c = safety_input(&coordinator, &source, "stale");
            let d = safety_input(&coordinator, &source, "valid");
            let pause = SafetyPause::install(&coordinator, PlaylistTestStage::Leader, 1, false);
            let leader = safety_start(&coordinator, dir.path(), a);
            pause.wait(PlaylistTestStage::Leader, 1);
            let cancelled = safety_start(&coordinator, dir.path(), b);
            pause.wait(PlaylistTestStage::Joined, 1);
            cancelled.abort();
            assert!(cancelled.await.is_err());
            let stale = safety_start(&coordinator, dir.path(), c);
            pause.wait(PlaylistTestStage::Joined, 1);
            let valid = safety_start(&coordinator, dir.path(), d);
            pause.wait(PlaylistTestStage::Joined, 1);
            coordinator.begin_window("stale").unwrap();
            pause.release();
            let expected = leader.await.unwrap().unwrap();
            assert_eq!(expected, valid.await.unwrap().unwrap());
            assert!(matches!(
                stale.await.unwrap().unwrap_err().code,
                CoverPixelsErrorCode::StaleRequest
            ));
            assert_eq!(pause.state.decodes.load(Ordering::Acquire), 1);
            safety_assert_idle(&coordinator);
        });
    }

    // Release-only manual probe. It reads the library without changing it, stages
    // anonymous embedded covers in a temporary app cache, and exercises the same
    // blocking function as the playlist command. No media paths are printed.
    #[test]
    #[ignore]
    fn benchmark_real_playlist_covers() {
        let library =
            PathBuf::from(std::env::var_os("SPMUSIC_BENCH_LIBRARY").expect("library env"));
        let mut directories = vec![library];
        let mut candidates = Vec::new();
        while let Some(directory) = directories.pop() {
            for entry in fs::read_dir(directory)
                .expect("read library directory")
                .flatten()
            {
                let path = entry.path();
                if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                    directories.push(path);
                } else if path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("flac"))
                {
                    candidates.push(path);
                }
            }
        }
        candidates.sort_by_key(|path| blake3::hash(path.to_string_lossy().as_bytes()).to_hex());
        let test_dir = TestDirectory::new();
        let covers = test_dir.path().join("audio").join("covers");
        fs::create_dir_all(&covers).unwrap();
        let mut sample = Vec::new();
        for path in candidates {
            let Ok(tagged) = super::super::metadata::read_tagged_file(&path) else {
                continue;
            };
            let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
                continue;
            };
            let Some(picture) = tag.pictures().first() else {
                continue;
            };
            let bytes = picture.data();
            if bytes.is_empty() || bytes.len() as u64 > MAX_INPUT_BYTES {
                continue;
            }
            let cover_path = covers.join(format!("{}.bin", blake3::hash(bytes).to_hex()));
            fs::write(&cover_path, bytes).unwrap();
            if load_cover_pixels_blocking(test_dir.path(), cover_path.to_str().unwrap(), 256)
                .is_ok()
            {
                sample.push(cover_path);
            }
            if sample.len() == 83 {
                break;
            }
        }
        assert_eq!(sample.len(), 83, "expected 83 valid embedded covers");
        let digest = blake3::hash(
            sample
                .iter()
                .flat_map(|p| {
                    p.file_stem()
                        .unwrap()
                        .to_string_lossy()
                        .into_owned()
                        .into_bytes()
                })
                .collect::<Vec<_>>()
                .as_slice(),
        );
        println!(
            "SP022 sample_count={} sample_digest={}",
            sample.len(),
            digest.to_hex()
        );
        let thumbnails = test_dir.path().join("audio").join(THUMBNAIL_DIRECTORY);
        for pair in 1..=5 {
            let baseline = || {
                let started = Instant::now();
                let mut response_bytes = 0usize;
                for path in &sample {
                    response_bytes +=
                        load_cover_pixels_blocking(test_dir.path(), path.to_str().unwrap(), 256)
                            .unwrap()
                            .len();
                }
                (started.elapsed().as_secs_f64() * 1000.0, response_bytes)
            };
            let cold = || {
                THUMBNAIL_WRITER
                    .get_or_init(ThumbnailWriter::new)
                    .wait_idle();
                if thumbnails.exists() {
                    fs::remove_dir_all(&thumbnails).unwrap();
                }
                THUMBNAIL_BENCH_HITS.store(0, Ordering::Relaxed);
                THUMBNAIL_BENCH_MISSES.store(0, Ordering::Relaxed);
                THUMBNAIL_BENCH_READ_NS.store(0, Ordering::Relaxed);
                THUMBNAIL_BENCH_HASH_NS.store(0, Ordering::Relaxed);
                THUMBNAIL_BENCH_LOOKUP_NS.store(0, Ordering::Relaxed);
                THUMBNAIL_BENCH_DECODE_NS.store(0, Ordering::Relaxed);
                THUMBNAIL_BENCH_WRITE_NS.store(0, Ordering::Relaxed);
                let started = Instant::now();
                let mut response_bytes = 0usize;
                for path in &sample {
                    response_bytes += load_playlist_cover_pixels_blocking(
                        test_dir.path(),
                        path.to_str().unwrap(),
                        256,
                    )
                    .unwrap()
                    .len();
                }
                let response_ms = started.elapsed().as_secs_f64() * 1000.0;
                let drain_started = Instant::now();
                THUMBNAIL_WRITER.get().unwrap().wait_idle();
                println!(
                    "SP022 writer_drain_ms={:.3}",
                    drain_started.elapsed().as_secs_f64() * 1000.0
                );
                (response_ms, response_bytes)
            };
            let (old, new) = if pair % 2 == 1 {
                (baseline(), cold())
            } else {
                let new = cold();
                (baseline(), new)
            };
            assert_eq!(old.1, new.1);
            println!("SP022 pair={} old_ms={:.3} cold_ms={:.3} read_ms={:.3} hash_ms={:.3} lookup_ms={:.3} decode_ms={:.3} write_ms={:.3} hits={} misses={}",
                pair, old.0, new.0,
                THUMBNAIL_BENCH_READ_NS.load(Ordering::Relaxed) as f64 / 1_000_000.0,
                THUMBNAIL_BENCH_HASH_NS.load(Ordering::Relaxed) as f64 / 1_000_000.0,
                THUMBNAIL_BENCH_LOOKUP_NS.load(Ordering::Relaxed) as f64 / 1_000_000.0,
                THUMBNAIL_BENCH_DECODE_NS.load(Ordering::Relaxed) as f64 / 1_000_000.0,
                THUMBNAIL_BENCH_WRITE_NS.load(Ordering::Relaxed) as f64 / 1_000_000.0,
                THUMBNAIL_BENCH_HITS.load(Ordering::Relaxed), THUMBNAIL_BENCH_MISSES.load(Ordering::Relaxed));
        }
        for round in 1..=5 {
            THUMBNAIL_BENCH_HITS.store(0, Ordering::Relaxed);
            THUMBNAIL_BENCH_MISSES.store(0, Ordering::Relaxed);
            let started = Instant::now();
            let mut response_bytes = 0usize;
            for path in &sample {
                response_bytes += load_playlist_cover_pixels_blocking(
                    test_dir.path(),
                    path.to_str().unwrap(),
                    256,
                )
                .unwrap()
                .len();
            }
            let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
            let thumbnails = test_dir.path().join("audio").join(THUMBNAIL_DIRECTORY);
            let files = fs::read_dir(thumbnails)
                .unwrap()
                .flatten()
                .collect::<Vec<_>>();
            let disk_bytes = files
                .iter()
                .map(|entry| entry.metadata().unwrap().len())
                .sum::<u64>();
            println!("SP022 hot_round={} elapsed_ms={:.3} response_bytes={} hits={} misses={} cache_files={} cache_bytes={}", round, elapsed_ms, response_bytes, THUMBNAIL_BENCH_HITS.load(Ordering::Relaxed), THUMBNAIL_BENCH_MISSES.load(Ordering::Relaxed), files.len(), disk_bytes);
        }
    }

    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let image = RgbaImage::from_pixel(width, height, Rgba([12, 34, 56, 255]));
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, ImageFormat::Png)
            .expect("encode fixture");
        bytes.into_inner()
    }

    fn jpeg_with_orientation(width: u32, height: u32, exif_orientation: u8) -> Vec<u8> {
        let image = RgbaImage::from_pixel(width, height, Rgba([12, 34, 56, 255]));
        let mut encoded = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut encoded, ImageFormat::Jpeg)
            .expect("encode fixture");
        let encoded = encoded.into_inner();
        assert_eq!(&encoded[0..2], &[0xff, 0xd8]);

        // Minimal little-endian TIFF IFD containing EXIF Orientation (0x0112).
        let mut app1_payload = Vec::from(&b"Exif\0\0"[..]);
        app1_payload.extend_from_slice(b"II");
        app1_payload.extend_from_slice(&42_u16.to_le_bytes());
        app1_payload.extend_from_slice(&8_u32.to_le_bytes());
        app1_payload.extend_from_slice(&1_u16.to_le_bytes());
        app1_payload.extend_from_slice(&0x0112_u16.to_le_bytes());
        app1_payload.extend_from_slice(&3_u16.to_le_bytes());
        app1_payload.extend_from_slice(&1_u32.to_le_bytes());
        app1_payload.extend_from_slice(&[exif_orientation, 0, 0, 0]);
        app1_payload.extend_from_slice(&0_u32.to_le_bytes());

        let segment_len = u16::try_from(app1_payload.len() + 2).expect("APP1 segment length");
        let mut result = Vec::with_capacity(encoded.len() + app1_payload.len() + 4);
        result.extend_from_slice(&encoded[0..2]);
        result.extend_from_slice(&[0xff, 0xe1]);
        result.extend_from_slice(&segment_len.to_be_bytes());
        result.extend_from_slice(&app1_payload);
        result.extend_from_slice(&encoded[2..]);
        result
    }

    fn u16_at(bytes: &[u8], offset: usize) -> u16 {
        u16::from_le_bytes(bytes[offset..offset + 2].try_into().expect("u16 field"))
    }

    fn u32_at(bytes: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("u32 field"))
    }

    fn patterned_png(width: u32, height: u32) -> Vec<u8> {
        let image = RgbaImage::from_fn(width, height, |x, y| {
            Rgba([
                (x * 7 + y * 3) as u8,
                (x / 3 + y * 11) as u8,
                ((x / 11 ^ y / 13) * 43) as u8,
                255,
            ])
        });
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    #[test]
    fn playlist_pre_reduction_keeps_geometry_and_isolates_player_strategy() {
        assert_eq!(THUMBNAIL_TRANSFORM_VERSION, 2);
        assert_eq!(
            playlist_pre_dimensions((2048, 1024), (256, 128)),
            Some((1024, 512))
        );
        assert_eq!(playlist_pre_dimensions((1000, 1000), (256, 256)), None);
        assert_eq!(playlist_pre_dimensions((16384, 1), (128, 1)), None);
        for (source, target) in [((4093, 106), (128, 3)), ((8192, 4096), (512, 256))] {
            let pre = playlist_pre_dimensions(source, target).unwrap();
            assert!(pre.0 >= target.0 * 4 && pre.1 >= target.1 * 4);
            assert!(pre.0 < source.0 && pre.1 < source.1);
        }
        let bytes = patterned_png(2048, 1024);
        for edge in [128, 256, 512] {
            let player = decode_and_pack(&bytes, edge).unwrap();
            let playlist = decode_playlist_and_pack(&bytes, edge).unwrap();
            assert_eq!(&player[..40], &playlist[..40]);
            if playlist_pre_dimensions((2048, 1024), (u32_at(&player, 8), u32_at(&player, 12)))
                .is_some()
            {
                assert_ne!(&player[40..], &playlist[40..]);
            } else {
                assert_eq!(player, playlist);
            }
            assert!(valid_cached_spxr(&playlist, edge));
            assert_eq!(
                player,
                decode_and_pack_with_strategy(&bytes, edge, false).unwrap()
            );
        }
        for bytes in [patterned_png(321, 219), patterned_png(4096, 1)] {
            for edge in [128, 256, 512] {
                assert_eq!(
                    decode_and_pack(&bytes, edge).unwrap(),
                    decode_playlist_and_pack(&bytes, edge).unwrap()
                );
            }
        }
    }

    #[test]
    fn playlist_pre_reduction_preserves_orientation_source_dimensions_and_alpha() {
        let oriented = jpeg_with_orientation(2048, 1024, 6);
        let output = decode_playlist_and_pack(&oriented, 128).unwrap();
        assert_eq!((u32_at(&output, 8), u32_at(&output, 12)), (64, 128));
        assert_eq!((u32_at(&output, 32), u32_at(&output, 36)), (1024, 2048));
        assert_eq!(u32_at(&output, 28), FLAG_RESIZED | FLAG_ORIENTATION_APPLIED);
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(1024, 1024, Rgba([23, 59, 113, 0])))
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        let output = decode_playlist_and_pack(&bytes.into_inner(), 128).unwrap();
        assert!(output[40..]
            .chunks_exact(4)
            .all(|pixel| pixel == [23, 59, 113, 0]));
    }

    /// Explicit manual quality export; no product probe or user-cache mutation.
    /// Columns are direct Lanczos3, playlist strategy, and absolute difference x8.
    #[test]
    #[ignore]
    fn export_playlist_transform_quality() {
        let output =
            PathBuf::from(std::env::var_os("THUMB_QUALITY_OUTPUT").expect("new output directory"));
        assert!(!output.exists(), "quality evidence must not be overwritten");
        fs::create_dir_all(&output).unwrap();
        let mut cases: Vec<(String, Vec<u8>)> = Vec::new();
        for kind in [
            "smooth-face",
            "text-lines",
            "checkerboard",
            "transparent-edge",
        ] {
            let image = RgbaImage::from_fn(2048, 1536, |x, y| {
                let fx = x as f32 / 2048.0;
                let fy = y as f32 / 1536.0;
                match kind {
                    "smooth-face" => {
                        let face = ((fx - 0.5) / 0.27).powi(2) + ((fy - 0.52) / 0.42).powi(2) < 1.0;
                        let eye = ((fx - 0.40).abs() < 0.026 || (fx - 0.60).abs() < 0.026)
                            && (fy - 0.43).abs() < 0.012;
                        let mouth = (fx - 0.5).abs() < 0.10 && (fy - 0.69).abs() < 0.013;
                        if eye || mouth {
                            Rgba([32, 25, 21, 255])
                        } else if face {
                            Rgba([
                                (220.0 - fy * 35.0) as u8,
                                (182.0 - fy * 45.0) as u8,
                                (152.0 - fy * 35.0) as u8,
                                255,
                            ])
                        } else {
                            Rgba([(fx * 190.0) as u8, (fy * 190.0) as u8, 110, 255])
                        }
                    }
                    "text-lines" => {
                        // Repeated E/H-like stems and strokes at several scales.
                        let cell = 24 + (y / 256) * 12;
                        let ink = x % cell < 3
                            || (y % cell < 3 && x % cell < cell * 3 / 4)
                            || (y as i32 - x as i32 / 2).unsigned_abs() % 97 < 3;
                        let v = if ink { 12 } else { 245 };
                        Rgba([v, v, v, 255])
                    }
                    "checkerboard" => {
                        let v = if (x / (1 + y / 192) ^ y / (1 + y / 192)) & 1 == 0 {
                            0
                        } else {
                            255
                        };
                        Rgba([v, v, v, 255])
                    }
                    _ => {
                        let r = ((fx - 0.5).powi(2) + (fy - 0.5).powi(2)).sqrt();
                        let a = ((0.35 - r) * 2048.0).clamp(0.0, 255.0) as u8;
                        if a == 0 {
                            Rgba([255, 0, 255, 0])
                        } else {
                            Rgba([14, 192, 91, a])
                        }
                    }
                }
            });
            let mut bytes = Cursor::new(Vec::new());
            DynamicImage::ImageRgba8(image)
                .write_to(&mut bytes, ImageFormat::Png)
                .unwrap();
            cases.push((kind.into(), bytes.into_inner()));
        }
        cases.push(("extreme-wide".into(), patterned_png(8192, 4)));
        cases.push(("extreme-tall".into(), patterned_png(4, 8192)));
        cases.push(("exif-rotated".into(), jpeg_with_orientation(2048, 1024, 6)));
        if let Some(corpus) = std::env::var_os("THUMB_QUALITY_CORPUS") {
            let corpus = PathBuf::from(corpus);
            let manifest: serde_json::Value =
                serde_json::from_slice(&fs::read(corpus.join("manifest.json")).unwrap()).unwrap();
            for (index, row) in manifest["rows"]
                .as_array()
                .unwrap()
                .iter()
                .take(8)
                .enumerate()
            {
                cases.push((
                    format!("cover-{:02}", index + 1),
                    fs::read(corpus.join(row["file"].as_str().unwrap())).unwrap(),
                ));
            }
        }
        let mut timings = Vec::new();
        for (name, bytes) in cases {
            for edge in [128, 256, 512] {
                let started = Instant::now();
                let direct = decode_and_pack(&bytes, edge).unwrap();
                let direct_ms = started.elapsed().as_secs_f64() * 1000.0;
                let started = Instant::now();
                let candidate = decode_playlist_and_pack(&bytes, edge).unwrap();
                let candidate_ms = started.elapsed().as_secs_f64() * 1000.0;
                assert_eq!(&direct[..40], &candidate[..40]);
                let (width, height) = (u32_at(&direct, 8), u32_at(&direct, 12));
                for background in if name == "transparent-edge" {
                    vec![0u8, 255]
                } else {
                    vec![255u8]
                } {
                    let mut sheet = RgbaImage::from_pixel(
                        width * 3,
                        height,
                        Rgba([background, background, background, 255]),
                    );
                    for (index, (a, b)) in direct[40..]
                        .chunks_exact(4)
                        .zip(candidate[40..].chunks_exact(4))
                        .enumerate()
                    {
                        let (x, y) = (index as u32 % width, index as u32 / width);
                        let composite = |p: &[u8]| {
                            let mut rgba = [0u8; 4];
                            for c in 0..3 {
                                rgba[c] = ((u32::from(p[c]) * u32::from(p[3])
                                    + u32::from(background) * (255 - u32::from(p[3]))
                                    + 127)
                                    / 255) as u8;
                            }
                            rgba[3] = 255;
                            Rgba(rgba)
                        };
                        let left = composite(a);
                        let middle = composite(b);
                        sheet.put_pixel(x, y, left);
                        sheet.put_pixel(x + width, y, middle);
                        sheet.put_pixel(
                            x + width * 2,
                            y,
                            Rgba([
                                left[0].abs_diff(middle[0]).saturating_mul(8),
                                left[1].abs_diff(middle[1]).saturating_mul(8),
                                left[2].abs_diff(middle[2]).saturating_mul(8),
                                255,
                            ]),
                        );
                    }
                    sheet
                        .save(output.join(format!("{name}-{edge}-bg{background}.png")))
                        .unwrap();
                }
                timings.push(serde_json::json!({"case":name,"edge":edge,"direct_ms":direct_ms,"candidate_ms":candidate_ms}));
            }
        }
        fs::write(
            output.join("timings.json"),
            serde_json::to_vec_pretty(&timings).unwrap(),
        )
        .unwrap();
        println!("quality evidence: {}", output.display());
    }

    #[test]
    fn protocol_header_is_fixed_and_self_consistent() {
        let response = decode_and_pack(&png_bytes(2, 3), 256).expect("decode fixture");

        assert_eq!(&response[0..4], b"SPXR");
        assert_eq!(u16_at(&response, 4), 1);
        assert_eq!(u16_at(&response, 6), 40);
        assert_eq!(u32_at(&response, 8), 2);
        assert_eq!(u32_at(&response, 12), 3);
        assert_eq!(u32_at(&response, 16), 8);
        assert_eq!(u32_at(&response, 20), 1);
        assert_eq!(u32_at(&response, 24), 24);
        assert_eq!(u32_at(&response, 28), 0);
        assert_eq!(u32_at(&response, 32), 2);
        assert_eq!(u32_at(&response, 36), 3);
        assert_eq!(response.len(), 40 + 24);
        assert_eq!(&response[40..44], &[12, 34, 56, 255]);
    }

    #[test]
    fn background_warmup_persists_both_thumbnail_edges() {
        let directory = TestDirectory::new();
        let covers = directory
            .path()
            .join(AUDIO_CACHE_DIRECTORY)
            .join(COVER_DIRECTORY);
        fs::create_dir_all(&covers).unwrap();
        let source = covers.join("warmup.png");
        fs::write(&source, png_bytes(400, 400)).unwrap();

        for edge in [128, 256] {
            let mut persisted = None;
            for _ in 0..100 {
                let result = tauri::async_runtime::block_on(try_warm_playlist_cover_pixels(
                    directory.path().to_path_buf(),
                    source.to_string_lossy().into_owned(),
                    edge,
                ))
                .unwrap();
                if result.is_some() {
                    persisted = result;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            assert_eq!(persisted, Some(true), "{edge}px thumbnail reaches disk");
        }

        let thumbnails = directory
            .path()
            .join(AUDIO_CACHE_DIRECTORY)
            .join(THUMBNAIL_DIRECTORY);
        assert_eq!(fs::read_dir(thumbnails).unwrap().count(), 2);
    }

    fn track_thumbnail_fixture(directory: &TestDirectory, cover: bool) -> PathBuf {
        let path = directory.path().join("indexed.wav");
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
        if cover {
            let mut tag = Tag::new(TagType::Id3v2);
            tag.push_picture(
                Picture::unchecked(png_bytes(400, 400))
                    .pic_type(PictureType::CoverFront)
                    .mime_type(MimeType::Png)
                    .build(),
            );
            tag.save_to_path(&path, WriteOptions::default()).unwrap();
        }
        path
    }

    #[test]
    fn track_thumbnail_index_survives_disk_hit_and_repairs_missing_thumbnail() {
        let _serial = TRACK_INDEX_TEST_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap();
        let directory = TestDirectory::new();
        let source = track_thumbnail_fixture(&directory, true);
        let source = source.to_str().unwrap();
        let prior = TRACK_THUMBNAIL_PROBES.load(Ordering::Relaxed);
        // Other parallel cover tests may briefly own the foreground slot.
        let warmed = tauri::async_runtime::block_on(async {
            let mut warmed = None;
            for _ in 0..500 {
                if let Some(outcome) =
                    try_warm_track_thumbnail(directory.path().to_path_buf(), source.to_owned(), 256)
                        .await
                        .unwrap()
                {
                    warmed = Some(outcome);
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            warmed.expect("background warmup never acquired an idle cover slot")
        });
        assert!(warmed.has_cover && warmed.persisted);
        assert_eq!(TRACK_THUMBNAIL_PROBES.load(Ordering::Relaxed), prior + 1);
        let expected =
            load_track_thumbnail_blocking(directory.path(), source, 256, || true).unwrap();
        assert!(valid_cached_spxr(&expected, 256));
        assert_eq!(
            TRACK_THUMBNAIL_PROBES.load(Ordering::Relaxed),
            prior + 1,
            "persistent index and SPXR hit must bypass the audio probe"
        );
        let fingerprint = source_fingerprint(source).unwrap();
        let hash = read_track_index(directory.path(), source, fingerprint)
            .unwrap()
            .unwrap();
        let thumbnail = directory
            .path()
            .join("audio/thumbnails")
            .join(thumbnail_filename(hash, 256));
        let covers = directory.path().join("audio/covers");
        for entry in fs::read_dir(&covers).unwrap() {
            fs::remove_file(entry.unwrap().path()).unwrap();
        }
        assert_eq!(
            load_track_thumbnail_blocking(directory.path(), source, 256, || true).unwrap(),
            expected
        );
        assert_eq!(
            TRACK_THUMBNAIL_PROBES.load(Ordering::Relaxed),
            prior + 1,
            "disk hit works after original cover cache removal"
        );
        fs::remove_file(&thumbnail).unwrap();
        assert_eq!(
            load_track_thumbnail_blocking(directory.path(), source, 256, || true).unwrap(),
            expected
        );
        assert_eq!(
            TRACK_THUMBNAIL_PROBES.load(Ordering::Relaxed),
            prior + 2,
            "evicted SPXR must trigger regeneration"
        );
        THUMBNAIL_WRITER.get().unwrap().wait_idle();
        fs::write(&thumbnail, b"corrupt").unwrap();
        assert_eq!(
            load_track_thumbnail_blocking(directory.path(), source, 256, || true).unwrap(),
            expected
        );
        assert_eq!(
            TRACK_THUMBNAIL_PROBES.load(Ordering::Relaxed),
            prior + 3,
            "corrupt SPXR must trigger regeneration"
        );
        THUMBNAIL_WRITER.get().unwrap().wait_idle();
        let index = index_path(directory.path(), source).unwrap();
        fs::write(&index, b"corrupt").unwrap();
        assert_eq!(
            load_track_thumbnail_blocking(directory.path(), source, 256, || true).unwrap(),
            expected
        );
        assert_eq!(
            TRACK_THUMBNAIL_PROBES.load(Ordering::Relaxed),
            prior + 4,
            "corrupt index must trigger fresh source probe"
        );
    }

    #[test]
    fn track_thumbnail_negative_index_invalidates_on_source_change() {
        let _serial = TRACK_INDEX_TEST_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap();
        let directory = TestDirectory::new();
        let source = track_thumbnail_fixture(&directory, false);
        let source = source.to_str().unwrap();
        let prior = TRACK_THUMBNAIL_PROBES.load(Ordering::Relaxed);
        assert!(
            load_track_thumbnail_blocking(directory.path(), source, 256, || true)
                .unwrap()
                .is_empty()
        );
        assert!(
            index_path(directory.path(), source).unwrap().exists(),
            "negative index must be written"
        );
        assert_eq!(
            read_track_index(
                directory.path(),
                source,
                source_fingerprint(source).unwrap()
            ),
            Some(None)
        );
        assert!(
            load_track_thumbnail_blocking(directory.path(), source, 256, || true)
                .unwrap()
                .is_empty()
        );
        assert_eq!(TRACK_THUMBNAIL_PROBES.load(Ordering::Relaxed), prior + 1);
        let before = source_fingerprint(source).unwrap();
        let mut file = OpenOptions::new().write(true).open(source).unwrap();
        use std::io::Seek;
        file.seek(io::SeekFrom::End(-1)).unwrap();
        file.write_all(&[1]).unwrap();
        file.set_modified(
            UNIX_EPOCH + std::time::Duration::from_nanos(before.modified_ns as u64 + 2_000_000_000),
        )
        .unwrap();
        assert_eq!(source_fingerprint(source).unwrap().size, before.size);
        assert!(
            load_track_thumbnail_blocking(directory.path(), source, 256, || true)
                .unwrap()
                .is_empty()
        );
        assert_eq!(TRACK_THUMBNAIL_PROBES.load(Ordering::Relaxed), prior + 2);
    }

    #[test]
    fn thumbnail_writer_amortizes_directory_scans_below_budget() {
        let directory = TestDirectory::new();
        let cache_dir = directory.path().join("audio/thumbnails");
        let response = decode_playlist_and_pack(&png_bytes(4, 4), 256).unwrap();
        for index in 0..8 {
            let filename = format!("fixture-{index}.spxr");
            assert!(matches!(
                write_thumbnail_cache(&cache_dir, &filename, &response),
                ThumbnailWriteOutcome::Written
            ));
        }
        let usage = THUMBNAIL_USAGE.get().unwrap().lock().unwrap();
        let usage = usage.get(&cache_dir).unwrap();
        assert_eq!(usage.files, 8);
        assert_eq!(
            usage.writes_since_scan, 8,
            "the normal path must not rescan the directory on every write"
        );
    }

    #[test]
    fn queued_track_thumbnail_rejects_superseded_window() {
        tauri::async_runtime::block_on(async {
            let coordinator = Arc::new(PlaylistCoverRequestCoordinator::new());
            let generation = coordinator.begin_window("track-thumbnail-test").unwrap();
            let mut held = Vec::new();
            for _ in 0..PLAYLIST_DECODE_PERMITS {
                held.push(coordinator.slots.acquire().await.unwrap());
            }
            let waiting = Arc::clone(&coordinator);
            let task = tauri::async_runtime::spawn(async move {
                waiting
                    .load_track(
                        PathBuf::from("unused"),
                        AudioLoadTrackThumbnailInput {
                            client_id: "track-thumbnail-test".to_owned(),
                            source_path: "unused".to_owned(),
                            max_edge: 256,
                            window_generation: generation,
                        },
                    )
                    .await
            });
            coordinator.begin_window("track-thumbnail-test").unwrap();
            drop(held);
            let error = task.await.unwrap().unwrap_err();
            assert!(matches!(error.code, CoverPixelsErrorCode::StaleRequest));
        });
    }

    #[test]
    fn scaling_preserves_aspect_ratio_and_never_upsamples() {
        assert_eq!(scaled_dimensions(4000, 2000, 1024).unwrap(), (1024, 512));
        assert_eq!(scaled_dimensions(2000, 4000, 1024).unwrap(), (512, 1024));
        assert_eq!(scaled_dimensions(320, 200, 1024).unwrap(), (320, 200));
        assert_eq!(scaled_dimensions(1, 16_384, 256).unwrap(), (1, 256));
    }

    #[test]
    fn resize_sets_dimensions_and_resized_flag() {
        let response = decode_and_pack(&png_bytes(400, 200), 256).expect("decode fixture");

        assert_eq!(u32_at(&response, 8), 256);
        assert_eq!(u32_at(&response, 12), 128);
        assert_eq!(u32_at(&response, 28), FLAG_RESIZED);
        assert_eq!(u32_at(&response, 32), 400);
        assert_eq!(u32_at(&response, 36), 200);
    }

    #[test]
    fn playlist_thumbnail_128_scales_and_packs_with_existing_protocol() {
        validate_playlist_max_edge(128).expect("128 px playlist thumbnail is allowed");
        let response = decode_and_pack(&png_bytes(400, 200), 128).expect("decode fixture");

        assert_eq!(u32_at(&response, 8), 128);
        assert_eq!(u32_at(&response, 12), 64);
        assert_eq!(u32_at(&response, 16), 512);
        assert_eq!(u32_at(&response, 24), 128 * 64 * 4);
        assert_eq!(u32_at(&response, 28), FLAG_RESIZED);
        assert_eq!(response.len(), 40 + 128 * 64 * 4);
    }

    #[test]
    fn playlist_cache_hit_and_source_change() {
        let dir = TestDirectory::new();
        let covers = dir.path().join("audio").join("covers");
        fs::create_dir_all(&covers).unwrap();
        let source = covers.join("source.png");
        fs::write(&source, png_bytes(400, 200)).unwrap();
        let path = source.to_str().unwrap();
        let first = load_playlist_cover_pixels_blocking(dir.path(), path, 128).unwrap();
        let again = load_playlist_cover_pixels_blocking(dir.path(), path, 128).unwrap();
        assert_eq!(first, again);
        assert_eq!(&again[..4], b"SPXR");
        fs::write(&source, png_bytes(200, 400)).unwrap();
        let changed = load_playlist_cover_pixels_blocking(dir.path(), path, 128).unwrap();
        assert_ne!(first, changed);
        assert_eq!(u32_at(&changed, 8), 64);
        assert_eq!(u32_at(&changed, 12), 128);
    }

    #[test]
    fn playlist_cache_corruption_and_interrupted_temp_rebuild() {
        let dir = TestDirectory::new();
        let covers = dir.path().join("audio").join("covers");
        fs::create_dir_all(&covers).unwrap();
        let source = covers.join("source.png");
        let bytes = png_bytes(400, 200);
        fs::write(&source, &bytes).unwrap();
        let path = source.to_str().unwrap();
        let expected = load_playlist_cover_pixels_blocking(dir.path(), path, 128).unwrap();
        THUMBNAIL_WRITER.get().unwrap().wait_idle();
        let thumbs = dir.path().join("audio").join(THUMBNAIL_DIRECTORY);
        let key = format!(
            "{}-128-t{THUMBNAIL_TRANSFORM_VERSION}-d{THUMBNAIL_DISK_VERSION}.spxr",
            blake3::hash(&bytes).to_hex()
        );
        fs::write(thumbs.join(&key), b"broken").unwrap();
        fs::write(thumbs.join(".tmp-dead"), b"partial").unwrap();
        OpenOptions::new()
            .write(true)
            .open(thumbs.join(".tmp-dead"))
            .unwrap()
            .set_modified(
                SystemTime::now() - THUMBNAIL_TEMP_STALE_AGE - std::time::Duration::from_secs(1),
            )
            .unwrap();
        let recovered = load_playlist_cover_pixels_blocking(dir.path(), path, 128).unwrap();
        THUMBNAIL_WRITER.get().unwrap().wait_idle();
        assert_eq!(expected, recovered);
        assert!(parse_thumbnail_cache(&fs::read(thumbs.join(key)).unwrap(), 128).is_some());
        // Usage scans are amortized; force the maintenance pass that reaps
        // abandoned temporary files instead of expecting it on every write.
        assert!(make_thumbnail_room(&thumbs, 1, 1));
        assert!(!thumbs.join(".tmp-dead").exists());
    }

    #[test]
    fn playlist_cache_budget_limits_files_without_touching_originals() {
        let dir = TestDirectory::new();
        let thumbs = dir.path().join("audio").join(THUMBNAIL_DIRECTORY);
        let covers = dir.path().join("audio").join("covers");
        fs::create_dir_all(&thumbs).unwrap();
        fs::create_dir_all(&covers).unwrap();
        let source = covers.join("original.png");
        fs::write(&source, png_bytes(1, 1)).unwrap();
        for index in 0..(THUMBNAIL_CACHE_FILES + 2) {
            fs::write(thumbs.join(format!("{index:08}.spxr")), b"x").unwrap();
        }
        assert!(make_thumbnail_room(&thumbs, 10, 1));
        let count = fs::read_dir(&thumbs).unwrap().count();
        assert!(count + 1 <= THUMBNAIL_CACHE_FILES);
        assert!(source.exists());
        assert!(!make_thumbnail_room(&thumbs, THUMBNAIL_CACHE_BYTES + 1, 1));
    }

    #[test]
    fn playlist_cache_byte_budget_evicts_oldest() {
        let dir = TestDirectory::new();
        let thumbs = dir.path().join("audio").join(THUMBNAIL_DIRECTORY);
        fs::create_dir_all(&thumbs).unwrap();
        fs::write(thumbs.join("old.spxr"), [1u8; 8]).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(thumbs.join("new.spxr"), [2u8; 8]).unwrap();
        assert!(make_thumbnail_room_with_limits(&thumbs, 8, 1, 16, 3));
        assert!(!thumbs.join("old.spxr").exists());
        assert!(thumbs.join("new.spxr").exists());
    }

    #[test]
    fn thumbnail_write_outcomes_distinguish_budget_presence_and_io_failure() {
        let dir = TestDirectory::new();
        let thumbs = dir.path().join("audio").join(THUMBNAIL_DIRECTORY);
        let response = decode_and_pack(&png_bytes(2, 2), 128).unwrap();
        assert!(matches!(
            write_thumbnail_cache_with_limits(&thumbs, "small.spxr", &response, 1, 1),
            ThumbnailWriteOutcome::Skipped("disk_budget")
        ));
        assert!(fs::read_dir(&thumbs).unwrap().next().is_none());
        assert!(matches!(
            write_thumbnail_cache(&thumbs, "valid.spxr", &response),
            ThumbnailWriteOutcome::Written
        ));
        assert!(matches!(
            write_thumbnail_cache(&thumbs, "valid.spxr", &response),
            ThumbnailWriteOutcome::AlreadyPresent
        ));
        assert!(
            parse_thumbnail_cache(&fs::read(thumbs.join("valid.spxr")).unwrap(), 128).is_some()
        );

        let blocked = dir.path().join("blocked");
        fs::write(&blocked, b"not a directory").unwrap();
        assert!(matches!(
            write_thumbnail_cache(&blocked, "unwritten.spxr", &response),
            ThumbnailWriteOutcome::Failed("cache_directory", _)
        ));
    }

    #[test]
    fn thumbnail_writer_failure_is_not_counted_as_written() {
        let dir = TestDirectory::new();
        let blocked = dir.path().join("blocked");
        fs::write(&blocked, b"not a directory").unwrap();
        let writer = ThumbnailWriter::new();
        writer.try_enqueue(blocked.clone(), "unwritten.spxr".into(), b"response");
        writer.wait_idle();
        let state = writer.shared.0.lock().unwrap();
        assert_eq!(state.failed, 1);
        assert_eq!(state.written, 0);
        assert_eq!(state.already_present, 0);
        assert_eq!(state.skipped, 0);
        assert!(state.pending.is_empty());
        assert_eq!(state.bytes, 0);
        drop(state);
        writer.shutdown();
        assert!(!blocked.join("unwritten.spxr").exists());
    }

    #[test]
    fn playlist_cover_succeeds_when_thumbnail_directory_is_unwritable() {
        let dir = TestDirectory::new();
        let covers = dir.path().join("audio").join(COVER_DIRECTORY);
        fs::create_dir_all(&covers).unwrap();
        let source = covers.join("source.png");
        fs::write(&source, png_bytes(4, 2)).unwrap();
        let blocked = dir.path().join("audio").join(THUMBNAIL_DIRECTORY);
        fs::write(&blocked, b"not a directory").unwrap();

        let first = load_playlist_cover_pixels_blocking(dir.path(), source.to_str().unwrap(), 128)
            .expect("decoding should not depend on thumbnail persistence");
        THUMBNAIL_WRITER.get().unwrap().wait_idle();
        let second = load_playlist_cover_pixels_blocking(dir.path(), source.to_str().unwrap(), 128)
            .expect("subsequent requests should retry from the source");
        THUMBNAIL_WRITER.get().unwrap().wait_idle();
        assert_eq!(first, second);
        assert_eq!(&first[..4], b"SPXR");
        assert_eq!(fs::read(&blocked).unwrap(), b"not a directory");
    }

    #[test]
    fn interrupted_temp_files_are_cleaned_within_bounded_scan() {
        let dir = TestDirectory::new();
        let thumbs = dir.path().join("audio").join(THUMBNAIL_DIRECTORY);
        fs::create_dir_all(&thumbs).unwrap();
        for index in 0..3000 {
            let path = thumbs.join(format!(".tmp-{index}"));
            fs::write(&path, b"partial").unwrap();
            OpenOptions::new()
                .write(true)
                .open(path)
                .unwrap()
                .set_modified(
                    SystemTime::now()
                        - THUMBNAIL_TEMP_STALE_AGE
                        - std::time::Duration::from_secs(1),
                )
                .unwrap();
        }
        fs::write(thumbs.join(".tmp-active"), b"still writing").unwrap();
        assert!(make_thumbnail_room(&thumbs, 10, 1));
        assert_eq!(fs::read_dir(&thumbs).unwrap().count(), 1);
        assert!(thumbs.join(".tmp-active").exists());
    }

    #[test]
    fn concurrent_same_key_returns_identical_complete_responses() {
        let dir = TestDirectory::new();
        let covers = dir.path().join("audio").join("covers");
        fs::create_dir_all(&covers).unwrap();
        let source = covers.join("source.png");
        fs::write(&source, png_bytes(400, 200)).unwrap();
        let root = dir.path().to_owned();
        let workers = (0..4)
            .map(|_| {
                let root = root.clone();
                let source = source.clone();
                std::thread::spawn(move || {
                    load_playlist_cover_pixels_blocking(&root, source.to_str().unwrap(), 128)
                        .unwrap()
                })
            })
            .collect::<Vec<_>>();
        let responses = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();
        assert!(responses.iter().all(|response| response == &responses[0]));
        THUMBNAIL_WRITER.get().unwrap().wait_idle();
        let thumbnails = root.join("audio").join(THUMBNAIL_DIRECTORY);
        let entries = fs::read_dir(&thumbnails).unwrap().collect::<Vec<_>>();
        assert_eq!(entries.len(), 1);
        assert!(parse_thumbnail_cache(
            &fs::read(entries[0].as_ref().unwrap().path()).unwrap(),
            128
        )
        .is_some());
    }

    #[test]
    fn thumbnail_writer_queue_is_bounded_and_shutdown_rejects_new_work() {
        let state = ThumbnailWriterState {
            pending: HashMap::new(),
            queue: VecDeque::new(),
            bytes: 0,
            peak_bytes: 0,
            enqueued: 0,
            coalesced: 0,
            skipped: 0,
            written: 0,
            already_present: 0,
            failed: 0,
            accepting: true,
        };
        // An unstarted writer makes the queue boundary deterministic.
        let writer = ThumbnailWriter {
            shared: Arc::new((StdMutex::new(state), Condvar::new())),
        };
        let cache_dir = PathBuf::from("bounded-thumbnail-test");
        for index in 0..THUMBNAIL_PENDING_FILES {
            writer.try_enqueue(cache_dir.clone(), format!("{index}.spxr"), b"x");
        }
        writer.try_enqueue(cache_dir.clone(), "overflow.spxr".into(), b"x");
        {
            let state = writer.shared.0.lock().unwrap();
            assert_eq!(state.pending.len(), THUMBNAIL_PENDING_FILES);
            assert_eq!(state.bytes, THUMBNAIL_PENDING_FILES);
            assert_eq!(state.skipped, 1);
        }
        assert_eq!(
            writer.pending(&cache_dir.join("0.spxr")),
            Some(b"x".to_vec())
        );
        writer.shutdown();
        writer.try_enqueue(cache_dir, "after-shutdown.spxr".into(), b"x");
        let state = writer.shared.0.lock().unwrap();
        assert!(!state.accepting);
        assert!(state.pending.is_empty());
        assert_eq!(state.bytes, 0);
        assert_eq!(state.skipped, THUMBNAIL_PENDING_FILES as u64 + 2);
    }

    #[test]
    fn stale_playlist_session_does_not_enqueue_thumbnail() {
        let dir = TestDirectory::new();
        let covers = dir.path().join("audio").join("covers");
        fs::create_dir_all(&covers).unwrap();
        let source = covers.join("source.png");
        fs::write(&source, png_bytes(400, 200)).unwrap();
        let client_id = format!(
            "stale-cache-{}",
            THUMBNAIL_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let stale_generation = begin_playlist_cover_window(&client_id).unwrap();
        let _current_generation = begin_playlist_cover_window(&client_id).unwrap();
        let result = load_playlist_cover_pixels_blocking_with_session(
            dir.path(),
            source.to_str().unwrap(),
            128,
            Some((&client_id, stale_generation)),
        );
        assert!(matches!(
            result,
            Err(CoverPixelsError {
                code: CoverPixelsErrorCode::StaleRequest,
                ..
            })
        ));
        let thumbnails = dir.path().join("audio").join(THUMBNAIL_DIRECTORY);
        assert!(fs::read_dir(thumbnails).unwrap().next().is_none());
    }

    #[test]
    fn exif_orientation_is_applied_before_scaling_and_packing() {
        let response =
            decode_and_pack(&jpeg_with_orientation(2, 1, 6), 256).expect("decode oriented fixture");

        assert_eq!(u32_at(&response, 8), 1);
        assert_eq!(u32_at(&response, 12), 2);
        assert_eq!(u32_at(&response, 28), FLAG_ORIENTATION_APPLIED);
        assert_eq!(u32_at(&response, 32), 1);
        assert_eq!(u32_at(&response, 36), 2);
    }

    #[test]
    fn path_validation_accepts_only_regular_files_below_canonical_root() {
        let test_dir = TestDirectory::new();
        let root = test_dir.path().join("audio").join("covers");
        fs::create_dir_all(&root).unwrap();
        let inside = root.join("cover.png");
        let outside = test_dir.path().join("outside.png");
        fs::write(&inside, png_bytes(1, 1)).unwrap();
        fs::write(&outside, png_bytes(1, 1)).unwrap();

        assert_eq!(
            validate_cover_path(&root, &inside).unwrap(),
            fs::canonicalize(&inside).unwrap()
        );
        assert!(validate_cover_path(&root, &outside).is_err());
        assert!(validate_cover_path(&root, &root).is_err());
    }

    #[test]
    fn invalid_image_is_rejected_without_panicking() {
        let error = decode_and_pack(b"not an image", 256).unwrap_err();
        assert!(matches!(error.code, CoverPixelsErrorCode::InvalidImage));
    }

    #[test]
    fn max_edge_is_discrete_and_bounded() {
        assert!(validate_max_edge(128).is_err());
        assert!(validate_max_edge(256).is_ok());
        assert!(validate_max_edge(3072).is_ok());
        assert!(validate_max_edge(255).is_err());
        assert!(validate_max_edge(3000).is_err());
        assert!(validate_max_edge(3073).is_err());
        assert!(validate_playlist_max_edge(128).is_ok());
        assert!(validate_playlist_max_edge(256).is_ok());
        assert!(validate_playlist_max_edge(512).is_ok());
        assert!(validate_playlist_max_edge(768).is_err());
    }

    #[test]
    fn stale_queued_request_does_not_enter_decode_work() {
        tauri::async_runtime::block_on(async {
            let coordinator = Arc::new(CoverRequestCoordinator::new());
            let entered_decode = Arc::new(AtomicUsize::new(0));

            coordinator.register(1).expect("register old request");
            let held_gate = coordinator.decode_gate.lock().await;
            let stale_coordinator = Arc::clone(&coordinator);
            let stale_counter = Arc::clone(&entered_decode);
            let stale_task = tauri::async_runtime::spawn(async move {
                stale_coordinator
                    .run_registered(1, || async move {
                        stale_counter.fetch_add(1, Ordering::AcqRel);
                        Ok::<(), CoverPixelsError>(())
                    })
                    .await
            });

            coordinator.register(2).expect("register latest request");
            drop(held_gate);

            let stale_error = stale_task
                .await
                .expect("join stale request")
                .expect_err("old request must be stale");
            assert!(matches!(
                stale_error.code,
                CoverPixelsErrorCode::StaleRequest
            ));
            assert_eq!(entered_decode.load(Ordering::Acquire), 0);

            let latest_counter = Arc::clone(&entered_decode);
            coordinator
                .run_registered(2, || async move {
                    latest_counter.fetch_add(1, Ordering::AcqRel);
                    Ok::<(), CoverPixelsError>(())
                })
                .await
                .expect("latest request enters decode work");
            assert_eq!(entered_decode.load(Ordering::Acquire), 1);
        });
    }

    #[test]
    fn playlist_generation_allows_a_batch_and_rejects_older_windows() {
        tauri::async_runtime::block_on(async {
            let coordinator = PlaylistCoverRequestCoordinator::new();
            let first_window = coordinator.begin_window("client-a").unwrap();
            assert_eq!(first_window, 1);
            coordinator
                .run_registered("client-a", first_window, || async {
                    Ok::<(), CoverPixelsError>(())
                })
                .await
                .expect("first request in a window enters decode work");
            coordinator
                .run_registered("client-a", first_window, || async {
                    Ok::<(), CoverPixelsError>(())
                })
                .await
                .expect("same window shares the coordinator");
            let next_window = coordinator.begin_window("client-a").unwrap();
            assert_eq!(next_window, 2);

            let stale = coordinator
                .run_registered("client-a", first_window, || async {
                    Ok::<(), CoverPixelsError>(())
                })
                .await
                .expect_err("older window must be stale");
            assert!(matches!(stale.code, CoverPixelsErrorCode::StaleRequest));

            coordinator
                .run_registered("client-a", next_window, || async {
                    Ok::<(), CoverPixelsError>(())
                })
                .await
                .expect("current window enters decode work");
        });
    }

    #[test]
    fn playlist_generation_change_discards_a_queued_request() {
        tauri::async_runtime::block_on(async {
            let coordinator = Arc::new(PlaylistCoverRequestCoordinator::new());
            let old_window = coordinator.begin_window("client-a").unwrap();
            let mut held_gate = Vec::new();
            for _ in 0..PLAYLIST_DECODE_PERMITS {
                held_gate.push(coordinator.slots.acquire().await.unwrap());
            }
            let stale_coordinator = Arc::clone(&coordinator);
            let entered_decode = Arc::new(AtomicUsize::new(0));
            let stale_counter = Arc::clone(&entered_decode);
            let stale_task = tauri::async_runtime::spawn(async move {
                stale_coordinator
                    .run_registered("client-a", old_window, || async move {
                        stale_counter.fetch_add(1, Ordering::AcqRel);
                        Ok::<(), CoverPixelsError>(())
                    })
                    .await
            });

            coordinator.begin_window("client-a").unwrap();
            drop(held_gate);

            let stale = stale_task
                .await
                .expect("join queued request")
                .expect_err("queued old window must be stale");
            assert!(matches!(stale.code, CoverPixelsErrorCode::StaleRequest));
            assert_eq!(entered_decode.load(Ordering::Acquire), 0);
        });
    }

    #[test]
    fn playlist_clients_do_not_supersede_each_other() {
        tauri::async_runtime::block_on(async {
            let coordinator = PlaylistCoverRequestCoordinator::new();
            let old_client_window = coordinator.begin_window("old-client").unwrap();
            let new_client_window = coordinator.begin_window("new-client").unwrap();

            coordinator
                .run_registered("old-client", old_client_window, || async {
                    Ok::<(), CoverPixelsError>(())
                })
                .await
                .expect("old client remains isolated");
            coordinator
                .run_registered("new-client", new_client_window, || async {
                    Ok::<(), CoverPixelsError>(())
                })
                .await
                .expect("new client remains isolated");
        });
    }
}
