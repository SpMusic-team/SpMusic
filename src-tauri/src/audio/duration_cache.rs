//! In-memory, file-identity-validated cache for playlist duration probes.
//!
//! The playlist duration channel (`audio_probe_playlist_durations`) is not a
//! cheap header read: an ADTS stream is scanned packet by packet and the other
//! containers may open a decoder. Without a cache the very same file is probed
//! again on every playlist reload, every equivalent refresh and every restart.
//! This module remembers the *final* duration of a file, keyed by its stable
//! path and validated by the file's own identity (`len` + mtime), so a hit costs
//! one `fs::metadata` call and never opens a decoder.
//!
//! Contract (see `docs/architecture/playlist-duration-cache.md`, D1):
//!
//! - the mutex guards only `fs::metadata` results and hash-map operations; the
//!   real probe always runs outside the lock and the refill is double-checked;
//! - an entry is only valid while `(len, modified_nanos)` still match, so a
//!   rewritten file is re-probed instead of serving a stale duration;
//! - only `Known` / `Unknown` are stored: `Unavailable` (probe error, unreadable
//!   identity, empty file) is never cached, so a fixed file becomes readable
//!   again without restarting the app;
//! - entries are bounded by count *and* by total key bytes, with LRU eviction;
//! - a poisoned lock degrades to a direct probe with a warning; it never panics
//!   and never fails the command.
//!
//! Dependency direction: this module uses the standard library only. It must
//! never reference `metadata`, `cover_cache`, `lyrics_cache`, `tag_writer`,
//! `controller` or `runtime`, and `duration.rs` must never reference this
//! module. `playlist_duration.rs` is the only writer *and* reader, which keeps
//! playlist duration single-sourced (risk R1).
//!
//! Nothing here writes to disk: the cross-process cache (D2) is explicitly
//! out of scope for this change (risk R2).

use std::{
    collections::HashMap,
    fmt, fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

/// One file's identity at one instant.
///
/// Every component is mandatory: if the length or the modification time cannot
/// be read (or is out of range) the file cannot be validated, and an
/// unvalidatable file is never cached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SourceIdentity {
    pub len: u64,
    /// `SystemTime` relative to `UNIX_EPOCH`, in nanoseconds. `i128` keeps the
    /// comparison exact well past the 2038 / 2106 timestamp cliff.
    pub modified_nanos: i128,
}

/// Why a file identity could not be established.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IdentityIssue {
    /// `fs::metadata` failed: missing file, lost permission, unreachable share…
    StatFailed,
    /// A zero-byte file is never a valid audio file. Caching it would freeze the
    /// state of a file that is still being copied (risk R3).
    EmptyFile,
    ModifiedUnavailable,
    BeforeEpoch,
    OutOfRange,
}

impl fmt::Display for IdentityIssue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::StatFailed => "stat_failed",
            Self::EmptyFile => "empty_file",
            Self::ModifiedUnavailable => "modified_unavailable",
            Self::BeforeEpoch => "before_epoch",
            Self::OutOfRange => "out_of_range",
        };
        formatter.write_str(value)
    }
}

impl SourceIdentity {
    /// Reads the current identity of `path`. `Err` means "cannot be validated":
    /// the caller must not read or write a cache entry for this file.
    fn read(path: &Path) -> Result<Self, IdentityIssue> {
        let metadata = fs::metadata(path).map_err(|_| IdentityIssue::StatFailed)?;
        let modified = metadata
            .modified()
            .map_err(|_| IdentityIssue::ModifiedUnavailable)?;
        Self::from_parts(metadata.len(), modified)
    }

    /// Pure part of [`Self::read`], separated so the length and timestamp edge
    /// cases are testable without a filesystem.
    fn from_parts(len: u64, modified: SystemTime) -> Result<Self, IdentityIssue> {
        if len == 0 {
            return Err(IdentityIssue::EmptyFile);
        }
        let elapsed = modified
            .duration_since(UNIX_EPOCH)
            .map_err(|_| IdentityIssue::BeforeEpoch)?;
        let modified_nanos =
            i128::try_from(elapsed.as_nanos()).map_err(|_| IdentityIssue::OutOfRange)?;
        Ok(Self {
            len,
            modified_nanos,
        })
    }
}

/// The result of one duration probe.
///
/// Three states, deliberately: a known duration, a successful probe that found
/// no usable duration, and "could not decide". Only the first two are cacheable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DurationOutcome {
    /// `duration_ms`, always at least 1: a `0` duration is reported as
    /// [`Self::Unknown`] so `durationMs === 0` can never reach the frontend.
    Known(u64),
    /// The probe succeeded but the container exposes no usable duration. This is
    /// a real answer (`durationMs: null, error: null`) and is worth caching.
    Unknown,
    /// The identity could not be validated, or the probe failed. Never cached and
    /// never read from the cache (risks R3 / R4).
    Unavailable,
}

/// What is actually stored: `Unavailable` has no representation on purpose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CachedDuration {
    Known(u64),
    Unknown,
}

impl From<CachedDuration> for DurationOutcome {
    fn from(value: CachedDuration) -> Self {
        match value {
            // `Known` is contractually `>= 1`; a stored `0` (only reachable if a
            // probe lied) is reported as an unknown duration, never as `0`.
            CachedDuration::Known(0) | CachedDuration::Unknown => Self::Unknown,
            CachedDuration::Known(duration_ms) => Self::Known(duration_ms),
        }
    }
}

impl DurationOutcome {
    fn cacheable(self) -> Option<CachedDuration> {
        match self {
            Self::Known(0) => Some(CachedDuration::Unknown),
            Self::Known(duration_ms) => Some(CachedDuration::Known(duration_ms)),
            Self::Unknown => Some(CachedDuration::Unknown),
            Self::Unavailable => None,
        }
    }
}

/// Observable hit / miss counters. `playlist_duration.rs` diffs them around one
/// batch to publish `cache_hits` / `cache_misses` in its tracing span, which is
/// how the "second probe no longer opens the file" claim is proven.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct DurationCacheStats {
    pub hits: u64,
    pub misses: u64,
}

struct Entry {
    /// The path actually used when the entry was written, kept for diagnostics
    /// and eviction tracing.
    path: PathBuf,
    identity: SourceIdentity,
    duration: CachedDuration,
    /// Least-recently-used ordering by key: `prev` is used less recently.
    prev: Option<String>,
    next: Option<String>,
}

struct Inner {
    entries: HashMap<String, Entry>,
    /// Head of the LRU list: the next entry to evict.
    head: Option<String>,
    /// Tail of the LRU list: the most recently used entry.
    tail: Option<String>,
    path_bytes: usize,
    max_entries: usize,
    max_path_bytes: usize,
    stats: DurationCacheStats,
}

/// Bounded, process-local, identity-validated duration cache.
///
/// The instance is owned by `AudioController` (`Arc<DurationCache>`), so its
/// lifetime is the controller's lifetime: dropping the controller drops every
/// entry. There is deliberately no TTL — identity *is* the invalidation rule.
pub(crate) struct DurationCache {
    inner: Mutex<Inner>,
}

impl DurationCache {
    /// Maximum number of cached files (see the memory budget in the contract).
    pub(crate) const MAX_ENTRIES: usize = 20_000;
    /// Maximum sum of cache-key bytes (8 MiB).
    pub(crate) const MAX_PATH_BYTES: usize = 8 * 1024 * 1024;

    /// Production cache with the contract limits.
    pub(crate) fn new() -> Self {
        Self::with_limits(Self::MAX_ENTRIES, Self::MAX_PATH_BYTES)
    }

    /// Explicit limits. Production always goes through [`Self::new`]; tests use
    /// tiny limits to prove eviction without building 20 000 entries.
    fn with_limits(max_entries: usize, max_path_bytes: usize) -> Self {
        Self {
            inner: Mutex::new(Inner {
                entries: HashMap::new(),
                head: None,
                tail: None,
                path_bytes: 0,
                max_entries,
                max_path_bytes,
                stats: DurationCacheStats::default(),
            }),
        }
    }

    /// Returns the duration of `path`, computing it with `probe` only when no
    /// entry with a matching identity exists.
    ///
    /// `key` must be [`duration_cache_key`] of the same path, so that every
    /// spelling of one file shares one entry.
    ///
    /// Locking: the lock is only held for a hash-map lookup plus the double-check
    /// and the refill, never during `probe`. The identity is read with
    /// `fs::metadata` *before* taking the lock and again after the probe, so two
    /// workers never serialize on file I/O (risk R10).
    pub(crate) fn get_or_probe<F>(&self, key: &str, path: &Path, probe: F) -> DurationOutcome
    where
        F: FnOnce(&Path) -> DurationOutcome,
    {
        // No identity means no validation: neither the cache nor the entry may
        // participate. The probe still runs, so per-item errors (missing file,
        // corrupt stream, empty file) keep reaching the caller unchanged.
        let before = match SourceIdentity::read(path) {
            Ok(identity) => identity,
            Err(issue) => {
                tracing::debug!(
                    operation = "audio.duration.cache",
                    path = %path.display(),
                    issue = %issue,
                    "duration cache skipped an unverifiable file identity",
                );
                return probe(path);
            }
        };

        match self.lookup(key, &before) {
            Ok(Some(outcome)) => return outcome,
            Ok(None) => {}
            // Poisoned lock: degrade to a direct probe instead of failing.
            Err(()) => return probe(path),
        }

        let outcome = probe(path);
        let Some(record) = outcome.cacheable() else {
            // `Unavailable` is never written: errors must not become sticky.
            return outcome;
        };

        // Double-checked refill: the file may have been rewritten while the probe
        // was running, and caching that observation would freeze a half-written
        // file.
        let after = match SourceIdentity::read(path) {
            Ok(identity) => identity,
            Err(_) => return outcome,
        };
        if after != before {
            tracing::debug!(
                operation = "audio.duration.cache",
                path = %path.display(),
                "file identity changed during the probe; result not cached",
            );
            return outcome;
        }

        match self.refill(key, path, after, record, outcome) {
            Ok(value) => value,
            Err(()) => outcome,
        }
    }

    /// Drops the entry for `key`, if any. Exists for the future song-add /
    /// remove / rewrite flows; the current command never needs it.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn invalidate(&self, key: &str) {
        let Ok(mut inner) = self.lock_inner() else {
            return;
        };
        if inner.entries.contains_key(key) {
            inner.remove(key);
            tracing::debug!(
                operation = "audio.duration.cache.invalidate",
                "duration cache entry invalidated",
            );
        }
    }

    /// Number of cached files (tracing and tests).
    pub(crate) fn len(&self) -> usize {
        let Ok(inner) = self.lock_inner() else {
            return 0;
        };
        inner.entries.len()
    }

    /// Cumulative hit / miss counters.
    pub(crate) fn stats(&self) -> DurationCacheStats {
        let Ok(inner) = self.lock_inner() else {
            return DurationCacheStats::default();
        };
        inner.stats
    }

    fn lookup(&self, key: &str, identity: &SourceIdentity) -> Result<Option<DurationOutcome>, ()> {
        let mut inner = self.lock_inner()?;
        let same_version = inner
            .entries
            .get(key)
            .is_some_and(|entry| entry.identity == *identity);
        if same_version {
            let value = inner
                .entries
                .get(key)
                .expect("the entry was just observed")
                .duration;
            inner.stats.hits += 1;
            inner.touch(key);
            return Ok(Some(value.into()));
        }
        // Either there is no entry, or it describes a different version of the
        // file: drop the stale entry and re-probe.
        if inner.entries.contains_key(key) {
            inner.remove(key);
        }
        inner.stats.misses += 1;
        Ok(None)
    }

    fn refill(
        &self,
        key: &str,
        path: &Path,
        identity: SourceIdentity,
        record: CachedDuration,
        probed: DurationOutcome,
    ) -> Result<DurationOutcome, ()> {
        let mut inner = self.lock_inner()?;
        if let Some(existing) = inner.entries.get(key) {
            if existing.identity == identity {
                // Another worker filled the same state first; the cache is
                // authoritative and both values must agree anyway.
                let value = existing.duration.into();
                inner.touch(key);
                return Ok(value);
            }
            // A newer state appeared while we were probing. Do not overwrite it
            // with our stale observation.
            return Ok(probed);
        }
        inner.insert(key, path, identity, record);
        Ok(probed)
    }

    fn lock_inner(&self) -> Result<std::sync::MutexGuard<'_, Inner>, ()> {
        match self.inner.lock() {
            Ok(guard) => Ok(guard),
            Err(_) => {
                tracing::warn!(
                    operation = "audio.duration.cache",
                    "duration cache mutex is poisoned; degrading to direct duration probes",
                );
                Err(())
            }
        }
    }
}

impl Default for DurationCache {
    fn default() -> Self {
        Self::new()
    }
}

impl Inner {
    fn insert(
        &mut self,
        key: &str,
        path: &Path,
        identity: SourceIdentity,
        duration: CachedDuration,
    ) {
        // Re-inserting an existing key must not double count its bytes.
        self.remove(key);
        self.path_bytes = self.path_bytes.saturating_add(key.len());
        self.entries.insert(
            key.to_owned(),
            Entry {
                path: path.to_path_buf(),
                identity,
                duration,
                prev: None,
                next: None,
            },
        );
        self.push_back(key);
        self.enforce_limits();
    }

    /// Evicts from the least recently used end until both the entry count and the
    /// key-byte budget fit again.
    fn enforce_limits(&mut self) {
        while self.entries.len() > self.max_entries || self.path_bytes > self.max_path_bytes {
            let Some(victim) = self.head.clone() else {
                break;
            };
            tracing::debug!(
                operation = "audio.duration.cache.evict",
                path = %self
                    .entries
                    .get(&victim)
                    .map(|entry| entry.path.display().to_string())
                    .unwrap_or_default(),
                entries = self.entries.len(),
                path_bytes = self.path_bytes,
                "evicted a duration cache entry",
            );
            self.remove(&victim);
        }
    }

    fn remove(&mut self, key: &str) {
        self.unlink(key);
        if self.entries.remove(key).is_some() {
            self.path_bytes = self.path_bytes.saturating_sub(key.len());
        }
    }

    fn touch(&mut self, key: &str) {
        self.unlink(key);
        self.push_back(key);
    }

    /// Detaches `key` from the LRU list. Safe for keys that are absent.
    fn unlink(&mut self, key: &str) {
        let Some((prev, next)) = self
            .entries
            .get(key)
            .map(|entry| (entry.prev.clone(), entry.next.clone()))
        else {
            return;
        };
        match &prev {
            Some(prev_key) => {
                if let Some(entry) = self.entries.get_mut(prev_key) {
                    entry.next = next.clone();
                }
            }
            None => self.head = next.clone(),
        }
        match &next {
            Some(next_key) => {
                if let Some(entry) = self.entries.get_mut(next_key) {
                    entry.prev = prev.clone();
                }
            }
            None => self.tail = prev.clone(),
        }
    }

    /// Appends `key` as the most recently used entry.
    fn push_back(&mut self, key: &str) {
        let previous_tail = self.tail.clone();
        if let Some(entry) = self.entries.get_mut(key) {
            entry.prev = previous_tail.clone();
            entry.next = None;
        }
        match previous_tail {
            Some(tail_key) => {
                if let Some(entry) = self.entries.get_mut(&tail_key) {
                    entry.next = Some(key.to_owned());
                }
            }
            None => self.head = Some(key.to_owned()),
        }
        self.tail = Some(key.to_owned());
    }
}

/// Stable cache key for `path`: canonicalized when possible, lower-cased, with
/// no `local-` prefix.
///
/// This mirrors the stabilization used by `source::track_id` (which prefixes the
/// hash with `local-` for the frontend) without reusing that identifier: the
/// frontend id is presentation, the cache key is file identity.
pub(crate) fn duration_cache_key(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{
            atomic::{AtomicU64, AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };

    use super::*;

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "spmusic-duration-cache-{}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.root.join(name);
            fs::write(&path, bytes).unwrap();
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    /// Counts how often the real probe ran, so "a hit does not open the file" is
    /// proven by the probe never being called again.
    #[derive(Clone, Default)]
    struct ProbeCounter(Arc<AtomicUsize>);

    impl ProbeCounter {
        fn calls(&self) -> usize {
            self.0.load(Ordering::Relaxed)
        }

        fn bump(&self) {
            self.0.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[test]
    fn second_call_with_the_same_identity_hits_without_probing_again() {
        let fixture = Fixture::new();
        let path = fixture.file("song.flac", b"first version payload");
        let key = duration_cache_key(&path);
        let cache = DurationCache::new();
        let counter = ProbeCounter::default();

        let counted = counter.clone();
        let first = cache.get_or_probe(&key, &path, |_| {
            counted.bump();
            DurationOutcome::Known(1_234)
        });
        assert_eq!(first, DurationOutcome::Known(1_234));
        assert_eq!(counter.calls(), 1);

        let counted = counter.clone();
        let second = cache.get_or_probe(&key, &path, |_| {
            counted.bump();
            DurationOutcome::Known(9_999)
        });
        assert_eq!(second, DurationOutcome::Known(1_234));
        assert_eq!(
            counter.calls(),
            1,
            "a valid identity must be served from memory"
        );
        assert_eq!(
            cache.stats(),
            DurationCacheStats { hits: 1, misses: 1 },
            "the second call must be counted as a hit"
        );
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn changed_length_invalidates_the_entry_and_reprobes() {
        let fixture = Fixture::new();
        let path = fixture.file("song.flac", b"v1");
        let key = duration_cache_key(&path);
        let cache = DurationCache::new();
        let counter = ProbeCounter::default();

        let counted = counter.clone();
        assert_eq!(
            cache.get_or_probe(&key, &path, |_| {
                counted.bump();
                DurationOutcome::Known(1_000)
            }),
            DurationOutcome::Known(1_000)
        );

        // Same path, different length: the old entry must not be served.
        fs::write(&path, b"a longer second version of the same file").unwrap();
        let counted = counter.clone();
        assert_eq!(
            cache.get_or_probe(&key, &path, |_| {
                counted.bump();
                DurationOutcome::Known(2_000)
            }),
            DurationOutcome::Known(2_000)
        );
        assert_eq!(counter.calls(), 2);
        assert_eq!(
            cache.stats(),
            DurationCacheStats { hits: 0, misses: 2 },
            "a stale entry is a miss, not a hit"
        );
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn zero_byte_file_is_probed_every_time_and_never_cached() {
        let fixture = Fixture::new();
        let path = fixture.file("empty.wav", b"");
        let key = duration_cache_key(&path);
        let cache = DurationCache::new();
        let counter = ProbeCounter::default();

        for _ in 0..2 {
            let counted = counter.clone();
            let outcome = cache.get_or_probe(&key, &path, |_| {
                counted.bump();
                DurationOutcome::Unknown
            });
            assert_eq!(
                outcome,
                DurationOutcome::Unknown,
                "the cache must not invent a known duration for an empty file"
            );
            assert_eq!(cache.len(), 0, "a zero-byte file is never cached");
        }
        assert_eq!(counter.calls(), 2);
    }

    #[test]
    fn unverifiable_identity_is_never_cached_and_never_read() {
        let fixture = Fixture::new();
        // The file does not exist: `fs::metadata` fails, so the identity is
        // unusable and the cache must stay out of the way entirely.
        let missing = fixture.root.join("gone.flac");
        let key = duration_cache_key(&missing);
        let cache = DurationCache::new();
        let counter = ProbeCounter::default();

        for _ in 0..2 {
            let counted = counter.clone();
            assert_eq!(
                cache.get_or_probe(&key, &missing, |_| {
                    counted.bump();
                    DurationOutcome::Unavailable
                }),
                DurationOutcome::Unavailable
            );
        }
        assert_eq!(counter.calls(), 2);
        assert_eq!(cache.len(), 0);
        assert_eq!(cache.stats(), DurationCacheStats::default());
    }

    #[test]
    fn unavailable_outcome_is_never_written_even_for_a_valid_file() {
        let fixture = Fixture::new();
        let path = fixture.file("broken.wav", b"not really audio");
        let key = duration_cache_key(&path);
        let cache = DurationCache::new();
        let counter = ProbeCounter::default();

        for _ in 0..2 {
            let counted = counter.clone();
            assert_eq!(
                cache.get_or_probe(&key, &path, |_| {
                    counted.bump();
                    DurationOutcome::Unavailable
                }),
                DurationOutcome::Unavailable
            );
        }
        assert_eq!(
            counter.calls(),
            2,
            "a probe error must never become a negative cache hit (risk R4)"
        );
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn unknown_outcome_is_cached_without_becoming_zero() {
        let fixture = Fixture::new();
        let path = fixture.file("no-duration.flac", b"container without duration");
        let key = duration_cache_key(&path);
        let cache = DurationCache::new();
        let counter = ProbeCounter::default();

        let counted = counter.clone();
        assert_eq!(
            cache.get_or_probe(&key, &path, |_| {
                counted.bump();
                DurationOutcome::Unknown
            }),
            DurationOutcome::Unknown
        );
        assert_eq!(cache.len(), 1);

        let counted = counter.clone();
        assert_eq!(
            cache.get_or_probe(&key, &path, |_| {
                counted.bump();
                DurationOutcome::Known(0)
            }),
            DurationOutcome::Unknown,
            "a cached Unknown must never turn into Known(0)"
        );
        assert_eq!(counter.calls(), 1);
    }

    #[test]
    fn a_zero_known_outcome_is_stored_as_unknown_never_as_zero() {
        let fixture = Fixture::new();
        let path = fixture.file("zero.flac", b"payload");
        let key = duration_cache_key(&path);
        let cache = DurationCache::new();

        // `durationMs === 0` must never reach the frontend (contract invariant),
        // even if a caller hands the cache a `Known(0)`.
        assert_eq!(
            cache.get_or_probe(&key, &path, |_| DurationOutcome::Known(0)),
            DurationOutcome::Known(0),
            "the caller still sees what its own probe returned"
        );
        assert_eq!(
            cache.get_or_probe(&key, &path, |_| DurationOutcome::Known(5)),
            DurationOutcome::Unknown,
            "the stored entry normalizes zero to Unknown"
        );
    }

    #[test]
    fn identity_change_during_the_probe_is_not_cached() {
        let fixture = Fixture::new();
        let path = fixture.file("growing.flac", b"partial write");
        let key = duration_cache_key(&path);
        let cache = DurationCache::new();

        let outcome = cache.get_or_probe(&key, &path, |probe_path| {
            // Simulate a file that grows while it is being probed: the length
            // read after the probe no longer matches the one read before it.
            fs::write(
                probe_path,
                b"a much longer payload that is still being written",
            )
            .unwrap();
            DurationOutcome::Known(3_000)
        });

        // The probe result is returned to the caller, but it is not frozen.
        assert_eq!(outcome, DurationOutcome::Known(3_000));
        assert_eq!(
            cache.len(),
            0,
            "a result observed across an identity change must not be stored"
        );

        // The next call probes again and can cache the settled state.
        assert_eq!(
            cache.get_or_probe(&key, &path, |_| DurationOutcome::Known(4_000)),
            DurationOutcome::Known(4_000)
        );
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn least_recently_used_entry_is_evicted_at_the_entry_limit() {
        let fixture = Fixture::new();
        let first = fixture.file("first.flac", b"first");
        let second = fixture.file("second.flac", b"second");
        let third = fixture.file("third.flac", b"third");
        let cache = DurationCache::with_limits(2, DurationCache::MAX_PATH_BYTES);

        let keys = [&first, &second, &third].map(|path| duration_cache_key(path));
        assert_eq!(
            cache.get_or_probe(&keys[0], &first, |_| DurationOutcome::Known(1)),
            DurationOutcome::Known(1)
        );
        assert_eq!(
            cache.get_or_probe(&keys[1], &second, |_| DurationOutcome::Known(2)),
            DurationOutcome::Known(2)
        );
        // Touch `first`, so `second` becomes the least recently used entry.
        assert_eq!(
            cache.get_or_probe(&keys[0], &first, |_| DurationOutcome::Known(99)),
            DurationOutcome::Known(1)
        );
        // Inserting `third` must evict `second`, not `first`.
        assert_eq!(
            cache.get_or_probe(&keys[2], &third, |_| DurationOutcome::Known(3)),
            DurationOutcome::Known(3)
        );
        assert_eq!(cache.len(), 2);

        let counter = ProbeCounter::default();
        // `first` and `third` survived: both are served without a probe.
        for (key, path, expected) in [(&keys[0], &first, 1_u64), (&keys[2], &third, 3_u64)] {
            let counted = counter.clone();
            assert_eq!(
                cache.get_or_probe(key, path, |_| {
                    counted.bump();
                    DurationOutcome::Known(0)
                }),
                DurationOutcome::Known(expected),
                "the surviving entries must still be cached"
            );
        }
        assert_eq!(counter.calls(), 0);

        // `second` was evicted, so it has to be probed again. Inserting it back
        // evicts the least recently used survivor (`first`), because the two
        // hits above made `third` the most recently used entry.
        let counted = counter.clone();
        assert_eq!(
            cache.get_or_probe(&keys[1], &second, |_| {
                counted.bump();
                DurationOutcome::Known(2)
            }),
            DurationOutcome::Known(2)
        );
        assert_eq!(
            counter.calls(),
            1,
            "the evicted entry had to be probed again"
        );
        assert_eq!(cache.len(), 2);

        let counted = counter.clone();
        assert_eq!(
            cache.get_or_probe(&keys[2], &third, |_| {
                counted.bump();
                DurationOutcome::Known(99)
            }),
            DurationOutcome::Known(3),
            "the most recently used entry must still be cached"
        );
        assert_eq!(counter.calls(), 1);

        let counted = counter.clone();
        assert_eq!(
            cache.get_or_probe(&keys[0], &first, |_| {
                counted.bump();
                DurationOutcome::Known(1)
            }),
            DurationOutcome::Known(1)
        );
        assert_eq!(counter.calls(), 2, "`first` became the LRU victim");
    }

    #[test]
    fn path_byte_budget_evicts_entries_as_well() {
        let fixture = Fixture::new();
        let first = fixture.file("0123456789abcdef.flac", b"first");
        let second = fixture.file("fedcba9876543210.flac", b"second");
        let first_key = duration_cache_key(&first);
        let second_key = duration_cache_key(&second);
        // Room for exactly one of the two keys, measured in key bytes.
        let cache = DurationCache::with_limits(1_000, first_key.len());

        assert_eq!(
            cache.get_or_probe(&first_key, &first, |_| DurationOutcome::Known(1)),
            DurationOutcome::Known(1)
        );
        assert_eq!(cache.len(), 1);

        assert_eq!(
            cache.get_or_probe(&second_key, &second, |_| DurationOutcome::Known(2)),
            DurationOutcome::Known(2)
        );
        assert_eq!(
            cache.len(),
            1,
            "the key-byte budget, not only the entry count, must evict"
        );

        let counter = ProbeCounter::default();
        let counted = counter.clone();
        assert_eq!(
            cache.get_or_probe(&first_key, &first, |_| {
                counted.bump();
                DurationOutcome::Known(1)
            }),
            DurationOutcome::Known(1)
        );
        assert_eq!(counter.calls(), 1, "the oldest entry was evicted");
    }

    #[test]
    fn invalidate_drops_only_the_requested_entry() {
        let fixture = Fixture::new();
        let kept = fixture.file("kept.flac", b"kept");
        let dropped = fixture.file("dropped.flac", b"dropped");
        let kept_key = duration_cache_key(&kept);
        let dropped_key = duration_cache_key(&dropped);
        let cache = DurationCache::new();

        assert_eq!(
            cache.get_or_probe(&kept_key, &kept, |_| DurationOutcome::Known(1)),
            DurationOutcome::Known(1)
        );
        assert_eq!(
            cache.get_or_probe(&dropped_key, &dropped, |_| DurationOutcome::Known(2)),
            DurationOutcome::Known(2)
        );
        cache.invalidate(&dropped_key);
        assert_eq!(cache.len(), 1);

        let counter = ProbeCounter::default();
        let counted = counter.clone();
        assert_eq!(
            cache.get_or_probe(&dropped_key, &dropped, |_| {
                counted.bump();
                DurationOutcome::Known(3)
            }),
            DurationOutcome::Known(3)
        );
        assert_eq!(counter.calls(), 1);

        let counted = counter.clone();
        assert_eq!(
            cache.get_or_probe(&kept_key, &kept, |_| {
                counted.bump();
                DurationOutcome::Known(4)
            }),
            DurationOutcome::Known(1)
        );
        assert_eq!(
            counter.calls(),
            1,
            "invalidate must not clear other entries"
        );
    }

    #[test]
    fn poisoned_lock_degrades_to_a_direct_probe_without_panicking() {
        let fixture = Fixture::new();
        let path = fixture.file("song.flac", b"payload");
        let key = duration_cache_key(&path);
        let cache = DurationCache::new();

        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = cache.inner.lock().expect("cache mutex should lock");
            panic!("intentional poison for the duration cache test");
        }));
        assert!(poisoned.is_err());

        let counter = ProbeCounter::default();
        let counted = counter.clone();
        let outcome = cache.get_or_probe(&key, &path, |_| {
            counted.bump();
            DurationOutcome::Known(7)
        });
        assert_eq!(outcome, DurationOutcome::Known(7));
        assert_eq!(counter.calls(), 1);
        // Degraded mode never touches the cache: no stats, no entries, no panic.
        assert_eq!(cache.stats(), DurationCacheStats::default());
        assert_eq!(cache.len(), 0);
        cache.invalidate(&key);
    }

    #[test]
    fn identity_rejects_empty_files_and_unusable_timestamps() {
        assert_eq!(
            SourceIdentity::from_parts(0, UNIX_EPOCH),
            Err(IdentityIssue::EmptyFile),
            "a zero-byte file is never a valid audio file (risk R3)"
        );
        assert_eq!(
            SourceIdentity::from_parts(10, UNIX_EPOCH - Duration::from_secs(1)),
            Err(IdentityIssue::BeforeEpoch)
        );
        assert_eq!(
            SourceIdentity::from_parts(10, UNIX_EPOCH + Duration::from_millis(1_500)),
            Ok(SourceIdentity {
                len: 10,
                modified_nanos: 1_500_000_000
            })
        );

        let fixture = Fixture::new();
        let empty = fixture.file("empty.bin", b"");
        assert_eq!(SourceIdentity::read(&empty), Err(IdentityIssue::EmptyFile));
        assert_eq!(
            SourceIdentity::read(&fixture.root.join("missing.bin")),
            Err(IdentityIssue::StatFailed)
        );
        let present = fixture.file("present.bin", b"bytes");
        let identity = SourceIdentity::read(&present).expect("identity should be readable");
        assert_eq!(identity.len, 5);
        assert!(identity.modified_nanos > 0);
    }

    #[test]
    fn cache_key_normalizes_case_and_redundant_segments() {
        let fixture = Fixture::new();
        let path = fixture.file("Song.FLAC", b"payload");
        let direct = duration_cache_key(&path);
        let dotted = duration_cache_key(&fixture.root.join(".").join("Song.FLAC"));
        assert_eq!(direct, dotted);
        assert!(!direct.starts_with("local-"));
        assert_eq!(direct, direct.to_lowercase());
    }
}
