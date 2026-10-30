//! Folder artwork selection. Candidate order is breadth first, independent of
//! directory enumeration order; only successfully decoded artwork wins.
//!
//! Sibling (same-directory) discovery is memoised per canonical directory, so a
//! list that scrolls over one album does not re-enumerate that directory once per
//! track. See [`SiblingDiscoveries`] for the invalidation contract.
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex as StdMutex, OnceLock},
    time::{Duration, Instant},
};

#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering};

use super::{
    cover_pixels::{
        decode_playlist_and_pack, load_folder_track_thumbnail_blocking, ordinary_directory,
        ordinary_file, playlist_pixels_from_bytes, read_bounded_file, CoverPixelsError,
        CoverPixelsErrorCode,
    },
    playlist::has_supported_audio_extension,
};

fn invalid_path(message: impl Into<String>) -> CoverPixelsError {
    CoverPixelsError::recoverable(CoverPixelsErrorCode::InvalidPath, message)
}

fn canonical_directory(path: &Path) -> Result<PathBuf, CoverPixelsError> {
    if !path.is_absolute() {
        return Err(invalid_path(
            "folder artwork requires absolute directory paths",
        ));
    }
    // Reject link/reparse components, including a junction supplied directly as
    // directoryPath. Canonical containment alone would silently follow these.
    for component_path in path.ancestors() {
        let metadata = fs::symlink_metadata(component_path).map_err(|error| {
            invalid_path(format!("folder artwork directory is unavailable: {error}"))
        })?;
        if !ordinary_directory(&metadata) {
            return Err(invalid_path(
                "folder artwork path must contain only ordinary directories",
            ));
        }
    }
    fs::canonicalize(path)
        .map_err(|error| invalid_path(format!("cannot resolve folder artwork directory: {error}")))
}

fn image_candidate(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            ["png", "jpg", "jpeg", "gif", "bmp", "webp"]
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

/// Sorts paths by their case-folded text, then by the raw path.
///
/// The case-folded key is materialised once per path. Lowercasing inside the
/// comparator instead cost two `String` allocations per comparison, i.e.
/// `O(n log n)` allocations for `O(n)` paths, and this ran for every directory
/// of every folder walk. The resulting order is unchanged: the same Unicode
/// lowercase text is the primary key and the raw path stays the tie-break.
fn sort_paths(paths: &mut Vec<PathBuf>) {
    let mut keyed: Vec<(String, PathBuf)> = paths
        .drain(..)
        .map(|path| (folded_path_key(&path), path))
        .collect();
    keyed.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    paths.extend(keyed.into_iter().map(|(_, path)| path));
}

fn folded_path_key(path: &Path) -> String {
    path.as_os_str().to_string_lossy().to_lowercase()
}

fn current(check: impl FnOnce() -> bool) -> Result<(), CoverPixelsError> {
    if check() {
        Ok(())
    } else {
        Err(CoverPixelsError::stale())
    }
}

fn unusable_candidate(error: &CoverPixelsError) -> bool {
    matches!(
        error.code,
        CoverPixelsErrorCode::InvalidPath
            | CoverPixelsErrorCode::FileTooLarge
            | CoverPixelsErrorCode::InvalidImage
            | CoverPixelsErrorCode::ImageTooLarge
    )
}

fn picture_pixels(
    app_cache_dir: &Path,
    path: &Path,
    max_edge: u32,
    is_current: impl FnOnce() -> bool + Copy,
) -> Result<Vec<u8>, CoverPixelsError> {
    picture_pixels_with(app_cache_dir, max_edge, is_current, || picture_bytes(path))
}

/// Same as [`picture_pixels`], but for a candidate that a sibling discovery
/// already resolved inside `directory`.
///
/// Reusing the directory the enumeration canonicalised removes a redundant walk
/// of the parent's ancestor chain per candidate; every file-level check is kept.
fn picture_pixels_in(
    app_cache_dir: &Path,
    directory: &Path,
    path: &Path,
    max_edge: u32,
    is_current: impl FnOnce() -> bool + Copy,
) -> Result<Vec<u8>, CoverPixelsError> {
    picture_pixels_with(app_cache_dir, max_edge, is_current, || {
        picture_bytes_in(directory, path)
    })
}

fn picture_pixels_with(
    app_cache_dir: &Path,
    max_edge: u32,
    is_current: impl FnOnce() -> bool + Copy,
    read: impl FnOnce() -> Result<Vec<u8>, CoverPixelsError>,
) -> Result<Vec<u8>, CoverPixelsError> {
    let bytes = read()?;
    current(is_current)?;
    playlist_pixels_from_bytes(
        app_cache_dir,
        &bytes,
        blake3::hash(&bytes),
        max_edge,
        is_current,
        || {},
    )
}

/// Reads a candidate whose containing directory is resolved here.
fn picture_bytes(path: &Path) -> Result<Vec<u8>, CoverPixelsError> {
    let directory = canonical_directory(
        path.parent()
            .ok_or_else(|| invalid_path("image has no directory"))?,
    )?;
    picture_bytes_in(&directory, path)
}

/// Reads a candidate that `enumerate_sibling_pictures` already resolved inside
/// the canonical `directory`.
///
/// The caller proves containment; the checks below still reject a candidate that
/// was replaced by a link, a non-file, or something outside `directory` since the
/// enumeration ran, and the directory handles stay retained through the read.
fn picture_bytes_in(directory: &Path, path: &Path) -> Result<Vec<u8>, CoverPixelsError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| invalid_path(format!("image is unavailable: {error}")))?;
    if !ordinary_file(&metadata)
        || fs::canonicalize(path)
            .ok()
            .as_deref()
            .and_then(Path::parent)
            != Some(directory)
    {
        return Err(invalid_path(
            "image must be an ordinary file in its directory",
        ));
    }
    // Retain non-delete-sharing directory handles through open/read so checked
    // Windows namespaces cannot be replaced by a junction between validation
    // and reading the candidate.
    let _guards = directory
        .ancestors()
        .map(|ancestor| {
            super::cover_cache::guard_directory(ancestor)
                .ok_or_else(|| invalid_path("image directory cannot be held safely"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    read_bounded_file(path)
}

// ---------------------------------------------------------------------------
// Sibling discovery cache
// ---------------------------------------------------------------------------
//
// The synchronous sibling path is reached for every track whose tags carry no
// embedded picture, and it used to re-probe the whole directory per track:
// `read_dir`, a `symlink_metadata` plus a `canonicalize` per entry, a lowercased
// sort key per comparison, and a second walk of the parent's ancestor chain to
// re-derive the directory the candidates came from.
//
// The cache below retains only the discovered *paths*, never decoded pixels, and
// is keyed by the canonical directory. Invalidation is the correctness red line:
// a user who adds, replaces, or deletes a cover must see the change, so a hit is
// only served when it still matches the filesystem.
//
// * The directory's own mtime covers entries appearing, disappearing, or being
//   renamed. It is captured *before* enumeration, so a change racing the read
//   leaves the stored timestamp older than the observed tree and the next lookup
//   misses instead of serving a half-updated list.
// * Every cached candidate is additionally pinned by its own length and
//   modification time. This is required, not redundant: rewriting an existing
//   file's contents does not modify its parent directory on Windows, so a
//   same-length cover swap would otherwise serve the stale discovery forever.
//   This mirrors `ProbeSignature` in `playlist_cover.rs`, for the same reason
//   noted there: sidecar images change while the audio fingerprint does not.
// * [`SIBLING_DISCOVERY_TTL`] bounds staleness for filesystems with coarse
//   timestamps, where a rewrite may report an unchanged modification time.
//
// Only successful enumerations are cached. Errors (unreadable directory, rejected
// link, I/O failure) are returned immediately and never pinned as "no artwork",
// because an unreadable candidate cannot prove artwork is absent.

/// Upper bound on cached directory discoveries. Each entry retains only paths, so
/// a large library cannot grow this cache without limit.
const SIBLING_DISCOVERY_ENTRIES: usize = 256;
/// Backstop on how long a cached discovery may serve without re-enumeration.
const SIBLING_DISCOVERY_TTL: Duration = Duration::from_secs(5);

/// One directory's resolved candidate images.
struct SiblingPictures {
    /// Canonical directory every picture below was resolved inside.
    directory: PathBuf,
    pictures: Vec<PathBuf>,
}

/// Cheap identity of one discovered image, used to invalidate a cached discovery.
#[derive(Clone, Copy, PartialEq, Eq)]
struct SiblingFileSignature {
    len: u64,
    modified_ns: u128,
}

struct CachedSiblingPictures {
    directory_modified_ns: u128,
    files: Vec<(PathBuf, SiblingFileSignature)>,
    discovered_at: Instant,
}

/// A completed enumeration, ready to be cached by [`SiblingDiscoveries`].
struct DiscoveredSiblingPictures {
    directory_modified_ns: u128,
    files: Vec<(PathBuf, SiblingFileSignature)>,
}

#[derive(Default)]
struct SiblingDiscoveryState {
    entries: HashMap<PathBuf, CachedSiblingPictures>,
    recency: VecDeque<PathBuf>,
}

struct SiblingDiscoveries {
    state: StdMutex<SiblingDiscoveryState>,
    /// Real directory enumerations performed through this cache.
    #[cfg(test)]
    enumerations: AtomicU64,
}

static SIBLING_DISCOVERIES: OnceLock<SiblingDiscoveries> = OnceLock::new();

fn sibling_discoveries() -> &'static SiblingDiscoveries {
    SIBLING_DISCOVERIES.get_or_init(SiblingDiscoveries::new)
}

impl SiblingDiscoveries {
    fn new() -> Self {
        Self {
            state: StdMutex::new(SiblingDiscoveryState::default()),
            #[cfg(test)]
            enumerations: AtomicU64::new(0),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, SiblingDiscoveryState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[cfg(test)]
    fn enumerations(&self) -> u64 {
        self.enumerations.load(Ordering::Acquire)
    }

    /// Serve a discovery that still matches the filesystem, or `None`.
    ///
    /// The entry is copied out under the lock and revalidated afterwards, so no
    /// syscall runs while the mutex is held. A hit costs one `symlink_metadata`
    /// for the directory plus one per cached candidate; a miss falls back to a
    /// full enumeration.
    fn lookup(&self, directory: &Path) -> Option<Vec<PathBuf>> {
        let (directory_modified_ns, files) = {
            let state = self.lock();
            let cached = state.entries.get(directory)?;
            if cached.discovered_at.elapsed() > SIBLING_DISCOVERY_TTL {
                return None;
            }
            (cached.directory_modified_ns, cached.files.clone())
        };
        let metadata = fs::symlink_metadata(directory).ok()?;
        if !ordinary_directory(&metadata) || modified_ns(&metadata) != directory_modified_ns {
            return None;
        }
        let mut pictures = Vec::with_capacity(files.len());
        for (path, signature) in files {
            let metadata = fs::symlink_metadata(&path).ok()?;
            if !ordinary_file(&metadata) || file_signature(&metadata) != signature {
                return None;
            }
            pictures.push(path);
        }
        Some(pictures)
    }

    fn store(&self, directory: &Path, discovered: DiscoveredSiblingPictures) {
        let DiscoveredSiblingPictures {
            directory_modified_ns,
            files,
        } = discovered;
        let mut state = self.lock();
        state.entries.insert(
            directory.to_path_buf(),
            CachedSiblingPictures {
                directory_modified_ns,
                files,
                discovered_at: Instant::now(),
            },
        );
        state.recency.retain(|candidate| candidate != directory);
        state.recency.push_back(directory.to_path_buf());
        while state.recency.len() > SIBLING_DISCOVERY_ENTRIES {
            if let Some(expired) = state.recency.pop_front() {
                state.entries.remove(&expired);
            }
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.lock().entries.len()
    }
}

fn modified_ns(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0)
}

fn file_signature(metadata: &fs::Metadata) -> SiblingFileSignature {
    SiblingFileSignature {
        len: metadata.len(),
        modified_ns: modified_ns(metadata),
    }
}

/// Direct image files of the audio source's directory, in candidate order.
///
/// Only direct image files are returned: no audio probing or directory recursion
/// happens here, because folder breadth-first selection owns those policies.
fn sibling_pictures(source_path: &str) -> Result<SiblingPictures, CoverPixelsError> {
    let source = Path::new(source_path);
    let parent = source
        .parent()
        .ok_or_else(|| invalid_path("audio source has no directory"))?;
    // The ancestor chain is revalidated per request: caching it would let a
    // directory be swapped for a junction after the fact, and this walk is one
    // `symlink_metadata` per ancestor rather than per directory entry.
    let directory = canonical_directory(parent)?;
    let pictures = cached_sibling_pictures(&directory)?;
    Ok(SiblingPictures {
        directory,
        pictures,
    })
}

fn cached_sibling_pictures(directory: &Path) -> Result<Vec<PathBuf>, CoverPixelsError> {
    cached_sibling_pictures_with(sibling_discoveries(), directory)
}

fn cached_sibling_pictures_with(
    cache: &SiblingDiscoveries,
    directory: &Path,
) -> Result<Vec<PathBuf>, CoverPixelsError> {
    if let Some(pictures) = cache.lookup(directory) {
        return Ok(pictures);
    }
    // Enumerate outside the lock: this is filesystem I/O and must not serialise
    // unrelated directories behind one mutex.
    #[cfg(test)]
    cache.enumerations.fetch_add(1, Ordering::Relaxed);
    let discovered = enumerate_sibling_pictures(directory)?;
    let pictures = discovered
        .files
        .iter()
        .map(|(path, _)| path.clone())
        .collect();
    cache.store(directory, discovered);
    Ok(pictures)
}

fn enumerate_sibling_pictures(
    directory: &Path,
) -> Result<DiscoveredSiblingPictures, CoverPixelsError> {
    // Capture the directory identity before reading it, so a change racing this
    // enumeration leaves the recorded timestamp older than the observed tree.
    let directory_metadata = fs::symlink_metadata(directory)
        .map_err(|error| invalid_path(format!("cannot inspect artwork directory: {error}")))?;
    if !ordinary_directory(&directory_metadata) {
        return Err(invalid_path(
            "folder artwork directory must be an ordinary directory",
        ));
    }
    let mut candidates: Vec<(String, PathBuf, SiblingFileSignature)> = Vec::new();
    for entry in fs::read_dir(directory)
        .map_err(|error| invalid_path(format!("cannot read artwork directory: {error}")))?
    {
        let path = entry
            .map_err(|error| invalid_path(format!("cannot read artwork entry: {error}")))?
            .path();
        if !image_candidate(&path) {
            continue;
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| invalid_path(format!("artwork entry is unavailable: {error}")))?;
        if !ordinary_file(&metadata) {
            continue;
        }
        let canonical = fs::canonicalize(&path)
            .map_err(|error| invalid_path(format!("cannot resolve artwork entry: {error}")))?;
        if canonical.parent() == Some(directory) {
            let key = folded_path_key(&canonical);
            candidates.push((key, canonical, file_signature(&metadata)));
        }
    }
    candidates.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    Ok(DiscoveredSiblingPictures {
        directory_modified_ns: modified_ns(&directory_metadata),
        files: candidates
            .into_iter()
            .map(|(_, path, signature)| (path, signature))
            .collect(),
    })
}

pub(super) fn load_sibling_thumbnail(
    app_cache_dir: &Path,
    source_path: &str,
    max_edge: u32,
    is_current: impl FnOnce() -> bool + Copy,
) -> Result<Vec<u8>, CoverPixelsError> {
    current(is_current)?;
    let SiblingPictures {
        directory,
        pictures,
    } = sibling_pictures(source_path)?;
    let mut incomplete = None;
    for path in pictures {
        current(is_current)?;
        match picture_pixels_in(app_cache_dir, &directory, &path, max_edge, is_current) {
            Ok(pixels) => {
                current(is_current)?;
                return Ok(pixels);
            }
            Err(error) if unusable_candidate(&error) => {
                if matches!(error.code, CoverPixelsErrorCode::InvalidPath) {
                    incomplete = Some(error);
                }
            }
            Err(error) => return Err(error),
        }
    }
    current(is_current)?;
    if let Some(error) = incomplete {
        Err(error)
    } else {
        Ok(Vec::new())
    }
}

/// This outer helper is used only by synchronous source/metadata workers. It
/// shares the thumbnail decode slots, and never runs inside an owned slot.
pub(super) fn sibling_cover_art(
    source_path: &str,
    audio_cache_dir: Option<&Path>,
) -> Result<Option<super::types::AudioCoverArt>, CoverPixelsError> {
    let SiblingPictures {
        directory,
        pictures,
    } = sibling_pictures(source_path)?;
    if pictures.is_empty() {
        return Ok(None);
    }
    super::cover_pixels::with_directory_decode_slot(|| {
        let mut incomplete = None;
        for path in pictures {
            let result = picture_bytes_in(&directory, &path).and_then(|bytes| {
                // Full guarded decode, rather than trusting an extension/header.
                decode_playlist_and_pack(&bytes, 128)?;
                let mime = image::guess_format(&bytes)
                    .map_err(|_| {
                        CoverPixelsError::recoverable(
                            CoverPixelsErrorCode::InvalidImage,
                            "directory artwork format is invalid",
                        )
                    })?
                    .to_mime_type();
                Ok(super::cover_cache::directory_cover_from_bytes(
                    &bytes,
                    mime,
                    audio_cache_dir,
                ))
            });
            match result {
                Ok(Some(cover)) => return Ok(Some(cover)),
                Ok(None) => {}
                Err(error) if unusable_candidate(&error) => {
                    if matches!(error.code, CoverPixelsErrorCode::InvalidPath) {
                        incomplete = Some(error);
                    }
                }
                Err(error) => return Err(error),
            }
        }
        if let Some(error) = incomplete {
            Err(error)
        } else {
            Ok(None)
        }
    })
}

pub(super) fn load_folder_thumbnail_blocking(
    app_cache_dir: &Path,
    root_path: &str,
    directory_path: &str,
    max_edge: u32,
    is_current: impl Fn() -> bool + Copy,
) -> Result<Vec<u8>, CoverPixelsError> {
    current(is_current)?;
    if !matches!(max_edge, 128 | 256) {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidMaxEdge,
            "folder thumbnail maxEdge must be 128 or 256",
        ));
    }
    let root = canonical_directory(Path::new(root_path))?;
    let target = canonical_directory(Path::new(directory_path))?;
    if !target.starts_with(&root) {
        return Err(invalid_path(
            "folder artwork directory is outside its selected root",
        ));
    }
    let mut level = vec![target.clone()];
    let mut visited = HashSet::new();
    let mut incomplete = None;
    while !level.is_empty() {
        let mut next = Vec::new();
        let mut pictures = Vec::new();
        let mut tracks = Vec::new();
        for directory in level {
            current(is_current)?;
            if !visited.insert(directory.clone()) {
                continue;
            }
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(error) => {
                    incomplete = Some(invalid_path(format!(
                        "cannot read artwork directory: {error}"
                    )));
                    continue;
                }
            };
            for entry in entries {
                current(is_current)?;
                let path = match entry {
                    Ok(entry) => entry.path(),
                    Err(error) => {
                        incomplete =
                            Some(invalid_path(format!("cannot read artwork entry: {error}")));
                        continue;
                    }
                };
                let metadata = match fs::symlink_metadata(&path) {
                    Ok(metadata) => metadata,
                    Err(error) => {
                        incomplete = Some(invalid_path(format!(
                            "artwork entry is unavailable: {error}"
                        )));
                        continue;
                    }
                };
                if !ordinary_directory(&metadata) && !ordinary_file(&metadata) {
                    continue;
                }
                let path = match fs::canonicalize(&path) {
                    Ok(path) if path.starts_with(&root) && path.starts_with(&target) => path,
                    Ok(_) => continue,
                    Err(error) => {
                        incomplete = Some(invalid_path(format!(
                            "cannot resolve artwork entry: {error}"
                        )));
                        continue;
                    }
                };
                if ordinary_directory(&metadata) {
                    next.push(path);
                } else if image_candidate(&path) {
                    pictures.push(path);
                } else if has_supported_audio_extension(&path) {
                    tracks.push(path);
                }
            }
        }
        sort_paths(&mut pictures);
        sort_paths(&mut tracks);
        sort_paths(&mut next);
        // Complete the whole depth's image lane before attempting any song.
        for (paths, image) in [(pictures, true), (tracks, false)] {
            for path in paths {
                current(is_current)?;
                // Revalidate immediately before opening; a candidate may have
                // been replaced since its directory was enumerated.
                let metadata = match fs::symlink_metadata(&path) {
                    Ok(metadata) => metadata,
                    Err(error) => {
                        incomplete = Some(invalid_path(format!(
                            "artwork candidate is unavailable: {error}"
                        )));
                        continue;
                    }
                };
                if !ordinary_file(&metadata) {
                    continue;
                }
                match fs::canonicalize(&path) {
                    Ok(resolved)
                        if resolved.starts_with(&root) && resolved.starts_with(&target) => {}
                    Ok(_) => continue,
                    Err(error) => {
                        incomplete = Some(invalid_path(format!(
                            "cannot resolve artwork candidate: {error}"
                        )));
                        continue;
                    }
                }
                if let Err(error) = fs::File::open(&path) {
                    incomplete = Some(invalid_path(format!(
                        "cannot open artwork candidate: {error}"
                    )));
                    continue;
                }
                let result = if image {
                    picture_pixels(app_cache_dir, &path, max_edge, is_current)
                } else {
                    load_folder_track_thumbnail_blocking(
                        app_cache_dir,
                        &path.to_string_lossy(),
                        max_edge,
                        is_current,
                    )
                };
                current(is_current)?;
                match result {
                    Ok(bytes) if !bytes.is_empty() => return Ok(bytes),
                    Ok(_) => {}
                    Err(error) if unusable_candidate(&error) => {
                        tracing::debug!(path = %path.display(), code = ?error.code, "skipping unusable folder artwork candidate");
                        // Both lanes distinguish invalid content from I/O;
                        // an unreadable candidate cannot prove artwork absent.
                        if matches!(error.code, CoverPixelsErrorCode::InvalidPath) {
                            incomplete = Some(error);
                        }
                    }
                    Err(error) => return Err(error),
                }
            }
        }
        level = next;
    }
    current(is_current)?;
    if let Some(error) = incomplete {
        Err(error)
    } else {
        Ok(Vec::new())
    }
}

#[cfg(test)]
#[path = "folder_cover_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "sibling_cover_tests.rs"]
mod sibling_tests;

#[cfg(test)]
mod discovery_cache_tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        base: PathBuf,
        directory: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let base = std::env::temp_dir().join(format!(
                "spmusic-sibling-discovery-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let directory = base.join("album");
            fs::create_dir_all(&directory).unwrap();
            Self { base, directory }
        }

        /// The form `sibling_pictures` passes to the cache.
        fn canonical(&self) -> PathBuf {
            fs::canonicalize(&self.directory).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    fn file_names(paths: &[PathBuf]) -> Vec<String> {
        paths
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect()
    }

    fn set_directory_modified(path: &Path, modified: std::time::SystemTime) {
        #[cfg(windows)]
        let directory = {
            use std::os::windows::fs::OpenOptionsExt;
            fs::OpenOptions::new()
                .access_mode(0x100) // FILE_WRITE_ATTRIBUTES
                .custom_flags(0x02000000) // FILE_FLAG_BACKUP_SEMANTICS
                .open(path)
                .unwrap()
        };
        #[cfg(not(windows))]
        let directory = fs::File::open(path).unwrap();
        directory.set_modified(modified).unwrap();
    }

    #[test]
    fn repeated_requests_reuse_the_validated_discovery() {
        let fixture = Fixture::new();
        let cache = SiblingDiscoveries::new();
        let directory = fixture.canonical();
        fs::write(fixture.directory.join("cover.png"), b"first").unwrap();
        let first = cached_sibling_pictures_with(&cache, &directory).unwrap();
        assert_eq!(file_names(&first), ["cover.png"]);
        assert!(cache.lookup(&directory).is_some());
        let second = cached_sibling_pictures_with(&cache, &directory).unwrap();
        assert_eq!(
            cache.enumerations(),
            1,
            "a validated discovery must not re-enumerate"
        );
        assert_eq!(second, first);
    }

    #[test]
    fn added_replaced_and_removed_covers_invalidate_the_discovery() {
        let fixture = Fixture::new();
        let cache = SiblingDiscoveries::new();
        let directory = fixture.canonical();
        assert!(cached_sibling_pictures_with(&cache, &directory)
            .unwrap()
            .is_empty());
        // A newly written sidecar must be discovered even though "no artwork" was
        // already cached.
        let sidecar = directory.join("cover.png");
        let before_directory = fs::metadata(&directory).unwrap().modified().unwrap();
        fs::write(&sidecar, b"first").unwrap();
        set_directory_modified(&directory, before_directory + Duration::from_secs(2));
        assert_ne!(
            fs::metadata(&directory).unwrap().modified().unwrap(),
            before_directory
        );
        assert!(cache.lookup(&directory).is_none());
        assert_eq!(
            cached_sibling_pictures_with(&cache, &directory).unwrap(),
            [sidecar.clone()]
        );
        assert_eq!(cache.enumerations(), 2);
        // Replacing the contents at an identical length must be discovered. This
        // rewrite does not touch the directory, so only the candidate's own
        // signature can detect it.
        let before_file = fs::metadata(&sidecar).unwrap().modified().unwrap();
        fs::write(&sidecar, b"other").unwrap();
        fs::File::options()
            .write(true)
            .open(&sidecar)
            .unwrap()
            .set_modified(before_file + Duration::from_secs(2))
            .unwrap();
        assert_eq!(fs::metadata(&sidecar).unwrap().len(), 5);
        assert_ne!(
            fs::metadata(&sidecar).unwrap().modified().unwrap(),
            before_file
        );
        assert!(cache.lookup(&directory).is_none());
        assert_eq!(
            cached_sibling_pictures_with(&cache, &directory).unwrap(),
            [sidecar.clone()]
        );
        assert_eq!(cache.enumerations(), 3);
        // Deleting it must be discovered.
        fs::remove_file(&sidecar).unwrap();
        assert!(cached_sibling_pictures_with(&cache, &directory)
            .unwrap()
            .is_empty());
        assert_eq!(cache.enumerations(), 4);
    }

    #[test]
    fn discovery_cache_stays_bounded() {
        let cache = SiblingDiscoveries::new();
        for index in 0..(SIBLING_DISCOVERY_ENTRIES + 32) {
            cache.store(
                Path::new(&format!("bounded-discovery-{index}")),
                DiscoveredSiblingPictures {
                    directory_modified_ns: 1,
                    files: Vec::new(),
                },
            );
        }
        assert!(cache.len() <= SIBLING_DISCOVERY_ENTRIES);
    }

    #[test]
    fn expired_discovery_is_enumerated_again_without_waiting() {
        let fixture = Fixture::new();
        let cache = SiblingDiscoveries::new();
        let directory = fixture.canonical();
        assert!(cached_sibling_pictures_with(&cache, &directory)
            .unwrap()
            .is_empty());
        cache.lock().entries.get_mut(&directory).unwrap().discovered_at =
            Instant::now() - SIBLING_DISCOVERY_TTL - Duration::from_secs(1);
        assert!(cache.lookup(&directory).is_none());
        assert!(cached_sibling_pictures_with(&cache, &directory)
            .unwrap()
            .is_empty());
        assert_eq!(cache.enumerations(), 2);
    }

    #[test]
    fn case_folded_candidate_order_is_preserved() {
        let mut paths = vec![
            PathBuf::from("album/z.png"),
            PathBuf::from("album/A.PNG"),
            PathBuf::from("album/b.png"),
        ];
        sort_paths(&mut paths);
        assert_eq!(file_names(&paths), ["A.PNG", "b.png", "z.png"]);
    }
}
