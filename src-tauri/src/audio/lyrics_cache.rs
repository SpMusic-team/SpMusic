//! In-memory, bounded LRU cache for sidecar `.lrc` lyrics parse results.
//!
//! Only the *parse result of sidecar lyrics* is cached (`Option<String>`,
//! where `None` is a negative entry confirming that no sidecar exists).
//! Embedded lyrics are always read live from the audio tag by
//! `metadata::read_metadata` and never pass through this cache.
//!
//! Read-through contract: `metadata::read_metadata` is the only hit/refill
//! entry point; `controller.rs` owns the instance and calls `invalidate`
//! after a successful `audio_embed_lyrics`.
//!
//! Dependency direction: this module depends only on
//! `metadata::read_sidecar_lyrics_with_source` (sidecar parsing) and
//! `source::track_id` (cache key). It must never reference `tag_writer`.

use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime},
};

use super::{metadata::read_sidecar_lyrics_with_source, source::track_id};

/// Negative-cache TTL: how long a confirmed "no sidecar lyrics" result is
/// trusted before the directory is scanned again. Bounds the staleness of
/// newly created `.lrc` files (including case variants).
const NEGATIVE_LYRICS_TTL: Duration = Duration::from_secs(30);

/// Observable cache statistics (hits / misses) for tracing and tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct LyricsCacheStats {
    pub hits: u64,
    pub misses: u64,
}

/// Fingerprint of the `.lrc` file that was actually read, used to detect
/// sidecar changes with a single stat instead of re-reading the file.
struct SidecarFingerprint {
    /// Actual `.lrc` path read (a case-variant directory scan reports the
    /// real path, which is what gets fingerprinted).
    path: PathBuf,
    modified: SystemTime,
    len: u64,
}

struct LyricsCacheEntry {
    /// Cached sidecar lyrics; `None` is a negative entry (no sidecar).
    lyrics: Option<String>,
    /// `Some` = the `.lrc` path + fingerprint read at refill time;
    /// `None` = no sidecar existed at refill time (negative entry).
    sidecar_fingerprint: Option<SidecarFingerprint>,
    /// TTL baseline for negative entries.
    recorded_at: Instant,
}

struct Inner {
    entries: HashMap<String, LyricsCacheEntry>,
    /// Access-ordered LRU queue; the back is the most recently used key.
    lru: VecDeque<String>,
    capacity: usize,
    stats: LyricsCacheStats,
}

/// Bounded in-memory LRU cache for sidecar lyrics parse results.
///
/// Thread-safe: the internal `Mutex` guards only stat and hash-map
/// operations; disk reads run outside the lock. A poisoned lock is warned
/// about and degrades to a direct sidecar read — it never panics and never
/// makes `read_metadata` fail.
pub(crate) struct LyricsCache {
    inner: Mutex<Inner>,
}

impl LyricsCache {
    /// Default maximum number of cached entries (bounded LRU).
    pub(crate) const MAX_LYRICS_CACHE_ENTRIES: usize = 512;

    /// Creates an empty cache with the given entry capacity.
    pub(crate) fn new(capacity: usize) -> Self {
        Self {
            inner: Mutex::new(Inner {
                entries: HashMap::new(),
                lru: VecDeque::new(),
                capacity,
                stats: LyricsCacheStats::default(),
            }),
        }
    }

    /// Returns the cached sidecar lyrics for `path` (or `None` while a
    /// negative entry is still valid), reading and refilling the cache on a
    /// miss. The disk read happens outside the lock; the refill is
    /// double-checked so a concurrent fill is never clobbered.
    pub(crate) fn get_or_load(&self, path: &Path) -> Option<String> {
        let key = track_id(path);

        let mut inner = match self.lock_inner() {
            Ok(guard) => guard,
            Err(()) => {
                // Poisoned lock: degrade to a direct sidecar read.
                return super::metadata::read_sidecar_lyrics(path);
            }
        };
        if let Some(value) = inner.hit(&key, path, true) {
            return value;
        }
        drop(inner);

        // Miss: perform the sidecar read (and directory scan) outside the lock.
        let loaded = read_sidecar_lyrics_with_source(path);
        let value = loaded.as_ref().map(|(lyrics, _)| lyrics.clone());

        let mut inner = match self.lock_inner() {
            Ok(guard) => guard,
            Err(()) => return value,
        };
        // Double-checked refill: another thread may have filled a valid entry
        // while we were reading; the cache is authoritative in that case.
        if let Some(cached) = inner.hit(&key, path, false) {
            return cached;
        }
        inner.insert(&key, path, loaded);
        value
    }

    /// Explicitly invalidates the entry for `path` (called by
    /// `audio_embed_lyrics` after a successful embed).
    pub(crate) fn invalidate(&self, path: &Path) {
        let key = track_id(path);
        let Ok(mut inner) = self.lock_inner() else {
            return;
        };
        if inner.entries.remove(&key).is_some() {
            if let Some(position) = inner.lru.iter().position(|candidate| candidate == &key) {
                inner.lru.remove(position);
            }
            tracing::debug!(
                operation = "audio.lyrics.cache.invalidate",
                path = %path.display(),
                "lyrics cache entry invalidated",
            );
        }
    }

    /// Returns the current hit/miss counters. Observable for tracing and
    /// tests; only tests currently consume it, so non-test builds allow it.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn stats(&self) -> LyricsCacheStats {
        let Ok(inner) = self.lock_inner() else {
            return LyricsCacheStats::default();
        };
        inner.stats
    }

    fn lock_inner(&self) -> Result<std::sync::MutexGuard<'_, Inner>, ()> {
        match self.inner.lock() {
            Ok(guard) => Ok(guard),
            Err(_) => {
                tracing::warn!(
                    operation = "audio.lyrics.cache",
                    "lyrics cache mutex is poisoned; degrading to direct sidecar reads",
                );
                Err(())
            }
        }
    }
}

impl Inner {
    /// Looks up `key` and validates the cached entry with stat-only checks.
    ///
    /// Returns:
    /// - `Some(Some(lyrics))` — positive hit;
    /// - `Some(None)` — valid negative hit (no sidecar within TTL);
    /// - `None` — no entry, or the entry is stale (a miss).
    ///
    /// Hits move the key to the LRU tail; stale entries are removed. Stats
    /// and tracing are only touched when `count_stats` is set so the
    /// double-checked refill does not double-count.
    fn hit(&mut self, key: &str, path: &Path, count_stats: bool) -> Option<Option<String>> {
        let entry = self.entries.get(key);
        let valid = match entry {
            None => false,
            Some(entry) => match &entry.sidecar_fingerprint {
                Some(fingerprint) => match fs::metadata(&fingerprint.path) {
                    Ok(meta) => {
                        meta.modified().ok() == Some(fingerprint.modified)
                            && meta.len() == fingerprint.len
                    }
                    Err(_) => false,
                },
                None => {
                    entry.recorded_at.elapsed() < NEGATIVE_LYRICS_TTL
                        && !path.with_extension("lrc").exists()
                }
            },
        };

        if !valid {
            if count_stats {
                self.stats.misses += 1;
                tracing::debug!(
                    operation = "audio.lyrics.cache",
                    path = %path.display(),
                    cache_miss = true,
                    "lyrics cache miss",
                );
            }
            if entry.is_some() {
                self.remove_key(key);
            }
            return None;
        }

        if count_stats {
            self.stats.hits += 1;
            tracing::debug!(
                operation = "audio.lyrics.cache",
                path = %path.display(),
                cache_hit = true,
                positive = entry.is_some_and(|entry| entry.lyrics.is_some()),
                "lyrics cache hit",
            );
        }
        self.touch(key);
        Some(self.entries.get(key).and_then(|entry| entry.lyrics.clone()))
    }

    fn insert(&mut self, key: &str, path: &Path, loaded: Option<(String, PathBuf)>) {
        let entry = match loaded {
            Some((lyrics, sidecar_path)) => {
                let Some(fingerprint) = self.fingerprint(&sidecar_path) else {
                    // The `.lrc` vanished between the read and the stat; do
                    // not cache a positive entry we cannot verify — the next
                    // call rescans the directory.
                    return;
                };
                LyricsCacheEntry {
                    lyrics: Some(lyrics),
                    sidecar_fingerprint: Some(fingerprint),
                    recorded_at: Instant::now(),
                }
            }
            None => LyricsCacheEntry {
                lyrics: None,
                sidecar_fingerprint: None,
                recorded_at: Instant::now(),
            },
        };

        tracing::debug!(
            operation = "audio.lyrics.cache.refill",
            path = %path.display(),
            positive = entry.lyrics.is_some(),
            "lyrics cache refilled",
        );

        self.entries.insert(key.to_string(), entry);
        self.touch(key);
        while self.entries.len() > self.capacity {
            let Some(evicted) = self.lru.pop_front() else {
                break;
            };
            self.entries.remove(&evicted);
        }
    }

    fn touch(&mut self, key: &str) {
        if let Some(position) = self.lru.iter().position(|candidate| candidate == key) {
            self.lru.remove(position);
        }
        self.lru.push_back(key.to_string());
    }

    fn remove_key(&mut self, key: &str) {
        self.entries.remove(key);
        if let Some(position) = self.lru.iter().position(|candidate| candidate == key) {
            self.lru.remove(position);
        }
    }

    fn fingerprint(&self, sidecar_path: &Path) -> Option<SidecarFingerprint> {
        let meta = fs::metadata(sidecar_path).ok()?;
        Some(SidecarFingerprint {
            path: sidecar_path.to_path_buf(),
            modified: meta.modified().ok()?,
            len: meta.len(),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    use super::*;

    fn unique_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "spmusic-lyrics-cache-{name}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("test directory should be created");
        root
    }

    fn fixture(root: &Path, name: &str, lyrics: &str) -> (PathBuf, PathBuf) {
        let audio_path = root.join(format!("{name}.mp3"));
        let lyrics_path = root.join(format!("{name}.lrc"));
        std::fs::write(&audio_path, b"fixture").expect("test audio should be written");
        std::fs::write(&lyrics_path, lyrics).expect("test lyrics should be written");
        (audio_path, lyrics_path)
    }

    #[test]
    fn first_get_or_load_misses_then_second_hits() {
        let root = unique_dir("hit");
        let (audio_path, _) = fixture(&root, "song", "[00:01.00]hello");
        let cache = LyricsCache::new(8);

        let first = cache.get_or_load(&audio_path);
        assert_eq!(first.as_deref(), Some("[00:01.00]hello"));
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 0, misses: 1 });

        let second = cache.get_or_load(&audio_path);
        assert_eq!(second.as_deref(), Some("[00:01.00]hello"));
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 1, misses: 1 });

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn modified_sidecar_is_reparsed_on_the_next_call() {
        let root = unique_dir("reparse");
        let (audio_path, lyrics_path) = fixture(&root, "song", "[00:01.00]v1");
        let cache = LyricsCache::new(8);

        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]v1")
        );
        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]v1")
        );
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 1, misses: 1 });

        std::fs::write(&lyrics_path, "[00:01.00]v2-longer-content")
            .expect("modified lyrics should be written");
        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]v2-longer-content")
        );
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 1, misses: 2 });
        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]v2-longer-content")
        );
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 2, misses: 2 });

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn deleted_sidecar_becomes_negative_entry_that_expires_and_rescans() {
        let root = unique_dir("negative");
        let (audio_path, lyrics_path) = fixture(&root, "song", "[00:01.00]v1");
        let cache = LyricsCache::new(8);

        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]v1")
        );
        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]v1")
        );

        std::fs::remove_file(&lyrics_path).expect("lyrics file should be removed");
        // The positive entry fails its stat check -> miss -> negative refill.
        assert_eq!(cache.get_or_load(&audio_path), None);
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 1, misses: 2 });
        // Negative entry is still within TTL -> negative hit, no rescan.
        assert_eq!(cache.get_or_load(&audio_path), None);
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 2, misses: 2 });

        // Force the negative TTL to expire, then the directory is rescanned.
        {
            let mut inner = cache.inner.lock().expect("cache mutex should lock");
            let key = track_id(&audio_path);
            let entry = inner
                .entries
                .get_mut(&key)
                .expect("negative entry should be cached");
            entry.recorded_at = Instant::now() - Duration::from_secs(31);
        }
        assert_eq!(cache.get_or_load(&audio_path), None);
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 2, misses: 3 });
        assert_eq!(cache.get_or_load(&audio_path), None);
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 3, misses: 3 });

        // A reappearing `.lrc` is picked up even while the negative TTL
        // would still be running, because the direct path now exists.
        std::fs::write(&lyrics_path, "[00:01.00]reborn").expect("lyrics should reappear");
        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]reborn")
        );

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn small_capacity_evicts_the_least_recently_used_entry() {
        let root = unique_dir("lru");
        let (first_audio, _) = fixture(&root, "first", "[00:01.00]first");
        let (second_audio, _) = fixture(&root, "second", "[00:01.00]second");
        let (third_audio, _) = fixture(&root, "third", "[00:01.00]third");
        let cache = LyricsCache::new(2);

        assert_eq!(
            cache.get_or_load(&first_audio).as_deref(),
            Some("[00:01.00]first")
        );
        assert_eq!(
            cache.get_or_load(&second_audio).as_deref(),
            Some("[00:01.00]second")
        );
        // Touching `first` moves it to the LRU tail: [second, first].
        assert_eq!(
            cache.get_or_load(&first_audio).as_deref(),
            Some("[00:01.00]first")
        );
        // Inserting `third` evicts `second` (least recently used).
        assert_eq!(
            cache.get_or_load(&third_audio).as_deref(),
            Some("[00:01.00]third")
        );
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 1, misses: 3 });

        // `second` was evicted and must be re-read (a fresh miss).
        assert_eq!(
            cache.get_or_load(&second_audio).as_deref(),
            Some("[00:01.00]second")
        );
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 1, misses: 4 });

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn invalidate_removes_the_cached_entry() {
        let root = unique_dir("invalidate");
        let (audio_path, _) = fixture(&root, "song", "[00:01.00]hello");
        let cache = LyricsCache::new(8);

        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]hello")
        );
        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]hello")
        );
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 1, misses: 1 });

        cache.invalidate(&audio_path);
        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]hello")
        );
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 1, misses: 2 });

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn missing_audio_and_sidecar_do_not_panic() {
        let root = unique_dir("missing");
        let cache = LyricsCache::new(8);
        let missing = root.join("does-not-exist.mp3");

        let result = std::panic::catch_unwind(|| cache.get_or_load(&missing));
        assert!(result.is_ok(), "missing sidecar lookup must not panic");
        assert_eq!(result.expect("lookup should return normally"), None);
        // The negative entry suppresses repeat directory scans within TTL.
        assert_eq!(cache.get_or_load(&missing), None);
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 1, misses: 1 });

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn sidecar_case_variant_is_fingerprinted_by_its_real_path() {
        let root = unique_dir("case-variant");
        let audio_path = root.join("song.mp3");
        let lyrics_path = root.join("SONG.LRC");
        std::fs::write(&audio_path, b"fixture").expect("test audio should be written");
        std::fs::write(&lyrics_path, "[00:01.00]v1")
            .expect("case variant lyrics should be written");
        let cache = LyricsCache::new(8);

        let (lyrics, source) = read_sidecar_lyrics_with_source(&audio_path)
            .expect("case variant sidecar should be found");
        assert_eq!(lyrics, "[00:01.00]v1");
        assert!(
            source
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("SONG.LRC")),
            "the reported sidecar path must resolve to the case-variant file (on case-insensitive filesystems the direct check may report the lower-case spelling, which still stats the real file)"
        );

        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]v1")
        );
        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]v1")
        );
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 1, misses: 1 });

        // Editing the on-disk SONG.LRC is detected by the fingerprint no
        // matter which spelling the sidecar lookup reported.
        std::fs::write(&lyrics_path, "[00:01.00]v2-longer-content")
            .expect("case variant lyrics should be rewritten");
        assert_eq!(
            cache.get_or_load(&audio_path).as_deref(),
            Some("[00:01.00]v2-longer-content")
        );
        assert_eq!(cache.stats(), LyricsCacheStats { hits: 1, misses: 2 });

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn poisoned_lock_degrades_to_direct_read_without_panicking() {
        let root = unique_dir("poisoned");
        let (audio_path, _) = fixture(&root, "song", "[00:01.00]hello");
        let cache = LyricsCache::new(8);

        let _ = std::panic::catch_unwind(|| {
            let _guard = cache.inner.lock().expect("cache mutex should lock");
            panic!("intentional poison for lyrics cache test");
        });

        let value = cache.get_or_load(&audio_path);
        assert_eq!(value.as_deref(), Some("[00:01.00]hello"));
        // Degraded mode bypasses the cache entirely: stats stay default and
        // invalidate is a no-op, but nothing panics and the read succeeds.
        assert_eq!(cache.stats(), LyricsCacheStats::default());
        cache.invalidate(&audio_path);

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }
}
