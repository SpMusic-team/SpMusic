#[cfg(test)]
use std::time::Instant;
use std::{
    collections::{HashMap, VecDeque},
    fs::{self, File, OpenOptions},
    future::Future,
    io::{self, Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Condvar, Mutex as StdMutex, OnceLock,
    },
    time::SystemTime,
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
const THUMBNAIL_DIRECTORY: &str = "thumbnails";
const THUMBNAIL_CACHE_BYTES: u64 = 256 * 1024 * 1024;
const THUMBNAIL_CACHE_FILES: usize = 2048;
const THUMBNAIL_CACHE_SCAN_LIMIT: usize = 4096;
const THUMBNAIL_TEMP_STALE_AGE: std::time::Duration = std::time::Duration::from_secs(600);
const THUMBNAIL_PENDING_FILES: usize = 128;
const THUMBNAIL_PENDING_BYTES: usize = 32 * 1024 * 1024;
const THUMBNAIL_DISK_MAGIC: [u8; 4] = *b"SPTC";
const THUMBNAIL_DISK_VERSION: u16 = 1;
const THUMBNAIL_TRANSFORM_VERSION: u16 = 1;
const THUMBNAIL_DISK_HEADER_LEN: usize = 44;
static THUMBNAIL_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static THUMBNAIL_WRITER: OnceLock<ThumbnailWriter> = OnceLock::new();
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
#[cfg(test)]
static THUMBNAIL_BENCH_PENDING_HITS: AtomicU64 = AtomicU64::new(0);

struct ThumbnailWriteJob {
    cache_dir: PathBuf,
    filename: String,
    payload: Arc<Vec<u8>>,
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
static PLAYLIST_REQUEST_COORDINATOR: OnceLock<PlaylistCoverRequestCoordinator> = OnceLock::new();

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

#[derive(Debug, Serialize)]
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

struct PlaylistCoverRequestCoordinator {
    clients: StdMutex<PlaylistCoverClients>,
    decode_gate: tauri::async_runtime::Mutex<()>,
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
            decode_gate: tauri::async_runtime::Mutex::new(()),
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
        let _guard = self.decode_gate.lock().await;
        self.ensure_current(client_id, window_generation)?;
        let result = work().await?;
        self.ensure_current(client_id, window_generation)?;
        Ok(result)
    }
}

pub fn begin_playlist_cover_window(client_id: &str) -> Result<u64, CoverPixelsError> {
    PLAYLIST_REQUEST_COORDINATOR
        .get_or_init(PlaylistCoverRequestCoordinator::new)
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
    validate_playlist_max_edge(input.max_edge)?;

    // Playlist requests share a window generation rather than a per-cover latest-wins
    // id. This coordinator is intentionally independent from foreground artwork so
    // thumbnail hydration cannot supersede the currently playing cover request.
    let coordinator =
        PLAYLIST_REQUEST_COORDINATOR.get_or_init(PlaylistCoverRequestCoordinator::new);
    let client_id = input.client_id.clone();
    let window_generation = input.window_generation;
    coordinator
        .run_registered(&client_id, window_generation, || async move {
            tauri::async_runtime::spawn_blocking(move || {
                load_playlist_cover_pixels_blocking_with_session(
                    &app_cache_dir,
                    &input.file_path,
                    input.max_edge,
                    Some((&input.client_id, input.window_generation)),
                )
            })
            .await
            .map_err(|error| {
                tracing::error!(
                    operation = "audio.playlist_cover_pixels.join",
                    window_generation,
                    error = %error,
                    "playlist cover pixel decoder worker failed",
                );
                CoverPixelsError::internal(
                    CoverPixelsErrorCode::WorkerFailed,
                    "playlist cover pixel decoder worker failed",
                )
            })?
        })
        .await
}

#[cfg(test)]
fn load_playlist_cover_pixels_blocking(
    app_cache_dir: &Path,
    requested_path: &str,
    max_edge: u32,
) -> Result<Vec<u8>, CoverPixelsError> {
    load_playlist_cover_pixels_blocking_with_session(app_cache_dir, requested_path, max_edge, None)
}

fn load_playlist_cover_pixels_blocking_with_session(
    app_cache_dir: &Path,
    requested_path: &str,
    max_edge: u32,
    session: Option<(&str, u64)>,
) -> Result<Vec<u8>, CoverPixelsError> {
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
    #[cfg(test)]
    let stage_started = Instant::now();
    let cache_dir = app_cache_dir
        .join(AUDIO_CACHE_DIRECTORY)
        .join(THUMBNAIL_DIRECTORY);
    let filename = format!(
        "{}-{max_edge}-t{THUMBNAIL_TRANSFORM_VERSION}-d{THUMBNAIL_DISK_VERSION}.spxr",
        source_hash.to_hex()
    );
    let cache_path = cache_dir.join(&filename);
    let pending = THUMBNAIL_WRITER
        .get_or_init(ThumbnailWriter::new)
        .pending(&cache_path);
    #[cfg(test)]
    if pending.is_some() {
        THUMBNAIL_BENCH_PENDING_HITS.fetch_add(1, Ordering::Relaxed);
    }
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
    let response = decode_and_pack(&bytes, max_edge)?;
    #[cfg(test)]
    THUMBNAIL_BENCH_DECODE_NS
        .fetch_add(stage_started.elapsed().as_nanos() as u64, Ordering::Relaxed);
    if let Some((client_id, generation)) = session {
        if let Some(coordinator) = PLAYLIST_REQUEST_COORDINATOR.get() {
            coordinator.ensure_current(client_id, generation)?;
        }
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
    if fs::create_dir_all(cache_dir).is_err() {
        return None;
    }
    let metadata = fs::symlink_metadata(cache_dir).ok()?;
    metadata.file_type().is_dir().then_some(())
}

fn read_thumbnail_cache(cache_dir: &Path, filename: &str, max_edge: u32) -> Option<Vec<u8>> {
    thumbnail_cache_root(cache_dir)?;
    let path = cache_dir.join(filename);
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.file_type().is_file()
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
    if let Err(error) = fs::create_dir_all(cache_dir) {
        return ThumbnailWriteOutcome::Failed("cache_directory", error);
    }
    match fs::symlink_metadata(cache_dir) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
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
    match make_thumbnail_room_with_limits_checked(
        cache_dir,
        encoded.len() as u64,
        1,
        byte_limit,
        file_limit,
    ) {
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

fn thumbnail_target_present(target: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(target) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(true),
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

    use super::*;

    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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
            let held_gate = coordinator.decode_gate.lock().await;
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
