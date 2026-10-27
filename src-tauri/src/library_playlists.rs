use std::{
    collections::hash_map::RandomState,
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    hash::BuildHasher,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

use crate::{
    audio::{restore_playlist_track, AudioFolderPlaylist, AudioPlaylistSourceKind},
    file_deletion::{path_key as deletion_path_key, DeleteFailure},
    library_folders::{replace_file, LibraryError},
};

const REGISTRY_FILE: &str = "library-playlists.v1.json";
const REGISTRY_VERSION: u8 = 1;
pub(crate) const MAX_REORDER_TRACKS: usize = 100_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReorderPlaylistTracksInput {
    pub source_path: String,
    pub expected_track_paths: Vec<String>,
    pub ordered_track_paths: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaylistInsertPosition {
    Start,
    #[default]
    End,
    Random,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredPlaylists {
    version: u8,
    playlists: Vec<StoredPlaylist>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredPlaylist {
    source_kind: StoredSourceKind,
    source_path: String,
    source_name: String,
    directory_path: String,
    directory_name: String,
    tracks: Vec<StoredTrack>,
}

#[derive(Debug, Serialize, Deserialize)]
enum StoredSourceKind {
    #[serde(rename = "m3u8")]
    M3u8,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredTrack {
    source_path: String,
}

// This registry owns only explicit M3U8 imports. It has no dependency on the
// folder registry or playback controller and stores no derived audio data.
pub struct LibraryPlaylistRegistry {
    path: PathBuf,
    lock: Mutex<()>,
}

impl LibraryPlaylistRegistry {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join(REGISTRY_FILE),
            lock: Mutex::new(()),
        }
    }

    pub fn get(&self) -> Result<Vec<AudioFolderPlaylist>, LibraryError> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        Ok(self
            .read()?
            .playlists
            .into_iter()
            .map(StoredPlaylist::restore)
            .collect())
    }

    pub fn upsert(&self, playlist: &AudioFolderPlaylist) -> Result<(), LibraryError> {
        let snapshot = StoredPlaylist::from_playlist(playlist)?;
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        // Read and validate before writing. A corrupt or future-version file
        // must never be replaced with an apparently successful partial import.
        let mut stored = self.read()?;
        let key = path_key(&snapshot.source_path);
        if let Some(existing) = stored
            .playlists
            .iter_mut()
            .find(|item| path_key(&item.source_path) == key)
        {
            *existing = snapshot;
        } else {
            stored.playlists.push(snapshot);
        }
        self.write(&stored)
    }

    pub(crate) fn remove_tracks(
        &self,
        source: &str,
        paths: &[String],
    ) -> Result<(Vec<String>, Vec<DeleteFailure>, Vec<AudioFolderPlaylist>), LibraryError> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut stored = self.read()?;
        let playlist = stored
            .playlists
            .iter_mut()
            .find(|playlist| deletion_path_key(&playlist.source_path) == deletion_path_key(source))
            .ok_or_else(|| LibraryError::invalid("仅支持从已导入的播放列表中移除条目"))?;
        let known: HashSet<_> = playlist
            .tracks
            .iter()
            .map(|track| deletion_path_key(&track.source_path))
            .collect();
        let mut seen = HashSet::new();
        let mut removed = Vec::new();
        let mut failures = Vec::new();
        for path in paths {
            let key = deletion_path_key(path);
            if !seen.insert(key.clone()) {
                continue;
            }
            if known.contains(&key) {
                removed.push(path.clone());
            } else {
                failures.push(DeleteFailure::new(
                    path,
                    "UNKNOWN_TRACK",
                    "歌曲不属于此播放列表",
                ));
            }
        }
        let keys: HashSet<_> = removed.iter().map(|path| deletion_path_key(path)).collect();
        playlist
            .tracks
            .retain(|track| !keys.contains(&deletion_path_key(&track.source_path)));
        if !removed.is_empty() {
            self.write(&stored)?;
        }
        Ok((
            removed,
            failures,
            stored
                .playlists
                .into_iter()
                .map(StoredPlaylist::restore)
                .collect(),
        ))
    }

    /// Append relationships to the registered snapshot, never rewrite the
    /// external M3U8. The lock covers lookup, deduplication and atomic commit.
    pub(crate) fn add_tracks(
        &self,
        source: &str,
        paths: &[String],
        position: PlaylistInsertPosition,
    ) -> Result<(AudioFolderPlaylist, Vec<String>, Vec<String>), LibraryError> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut stored = self.read()?;
        let index = stored
            .playlists
            .iter()
            .position(|playlist| {
                deletion_path_key(&playlist.source_path) == deletion_path_key(source)
            })
            .ok_or_else(|| LibraryError::invalid("只能添加到已导入的播放列表"))?;
        let playlist = &mut stored.playlists[index];
        let mut membership: HashSet<_> = playlist
            .tracks
            .iter()
            .map(|track| deletion_path_key(&track.source_path))
            .collect();
        let mut requested = HashSet::new();
        let mut added = Vec::new();
        let mut already = Vec::new();
        for path in paths {
            if !valid_path(path) {
                return Err(LibraryError::invalid("歌曲路径必须是规范的绝对路径"));
            }
            let key = deletion_path_key(path);
            if !requested.insert(key.clone()) {
                continue;
            }
            if !membership.insert(key) {
                already.push(path.clone());
                continue;
            }
            added.push(path.clone());
        }
        let new_tracks = added
            .iter()
            .map(|path| StoredTrack {
                source_path: path.clone(),
            })
            .collect();
        let random = RandomState::new();
        let mut step = 0usize;
        playlist.tracks = merge_tracks(
            std::mem::take(&mut playlist.tracks),
            new_tracks,
            position,
            |bound| {
                step += 1;
                (random.hash_one((step, bound)) % bound as u64) as usize
            },
        );
        playlist.validate()?;
        if !added.is_empty() {
            self.write(&stored)?;
        }
        let playlist = stored.playlists.remove(index).restore();
        Ok((playlist, added, already))
    }

    pub(crate) fn remove_paths_from_all(
        &self,
        paths: &[String],
    ) -> Result<Vec<AudioFolderPlaylist>, LibraryError> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut stored = self.read()?;
        let keys: HashSet<_> = paths.iter().map(|path| deletion_path_key(path)).collect();
        let mut changed = false;
        for playlist in &mut stored.playlists {
            let before = playlist.tracks.len();
            playlist
                .tracks
                .retain(|track| !keys.contains(&deletion_path_key(&track.source_path)));
            changed |= before != playlist.tracks.len();
        }
        if changed {
            self.write(&stored)?;
        }
        Ok(stored
            .playlists
            .into_iter()
            .map(StoredPlaylist::restore)
            .collect())
    }

    /// Reorder only the accepted relationships. The expected sequence is a
    /// compare-and-swap token: a concurrent add/remove/reorder cannot be lost.
    pub(crate) fn reorder_tracks(
        &self,
        input: ReorderPlaylistTracksInput,
    ) -> Result<AudioFolderPlaylist, LibraryError> {
        if !valid_path(&input.source_path)
            || input.expected_track_paths.len() > MAX_REORDER_TRACKS
            || input.ordered_track_paths.len() > MAX_REORDER_TRACKS
        {
            return Err(LibraryError::invalid(
                "播放列表来源无效或排序条目超过 100000 项",
            ));
        }
        let expected = reorder_keys(&input.expected_track_paths)?;
        let ordered = reorder_keys(&input.ordered_track_paths)?;
        let expected_members: HashSet<_> = expected.iter().collect();
        let ordered_members: HashSet<_> = ordered.iter().collect();
        if expected.len() != ordered.len() || expected_members != ordered_members {
            return Err(LibraryError::invalid(
                "排序必须完整保留原有歌曲，不能新增或移除条目",
            ));
        }

        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut stored = self.read()?;
        let index = stored
            .playlists
            .iter()
            .position(|playlist| {
                deletion_path_key(&playlist.source_path) == deletion_path_key(&input.source_path)
            })
            .ok_or_else(|| LibraryError::invalid("仅支持重排已导入的播放列表"))?;
        let playlist = &mut stored.playlists[index];
        let current: Vec<_> = playlist
            .tracks
            .iter()
            .map(|track| deletion_path_key(&track.source_path))
            .collect();
        if current != expected {
            return Err(LibraryError {
                code: "PLAYLIST_ORDER_CHANGED",
                message: "列表已更改，请重新拖动排序".into(),
                recoverable: true,
            });
        }
        if current != ordered {
            // Preserve the accepted spelling/identity of every path rather
            // than trusting equivalent case/slash aliases from the caller.
            let mut tracks: HashMap<_, _> = std::mem::take(&mut playlist.tracks)
                .into_iter()
                .map(|track| (deletion_path_key(&track.source_path), track))
                .collect();
            playlist.tracks = ordered
                .into_iter()
                .map(|key| {
                    tracks
                        .remove(&key)
                        .ok_or_else(|| LibraryError::invalid("排序包含未知歌曲"))
                })
                .collect::<Result<Vec<_>, _>>()?;
            playlist.validate()?;
            self.write(&stored)?;
        }
        Ok(stored.playlists.remove(index).restore())
    }

    fn read(&self) -> Result<StoredPlaylists, LibraryError> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(StoredPlaylists {
                    version: REGISTRY_VERSION,
                    playlists: Vec::new(),
                });
            }
            Err(error) => {
                return Err(LibraryError::storage(format!(
                    "Cannot read saved playlists: {error}"
                )))
            }
        };
        let stored: StoredPlaylists = serde_json::from_slice(&bytes).map_err(|error| {
            LibraryError::storage(format!("Saved playlists are invalid: {error}"))
        })?;
        if stored.version != REGISTRY_VERSION {
            return Err(LibraryError::storage(format!(
                "Unsupported playlist registry version: {}",
                stored.version
            )));
        }
        let mut keys = HashSet::new();
        for playlist in &stored.playlists {
            playlist.validate()?;
            if !keys.insert(path_key(&playlist.source_path)) {
                return Err(LibraryError::storage(
                    "Saved playlists contain duplicate source paths",
                ));
            }
        }
        Ok(stored)
    }

    fn write(&self, stored: &StoredPlaylists) -> Result<(), LibraryError> {
        let bytes = serde_json::to_vec_pretty(stored)
            .map_err(|error| LibraryError::storage(error.to_string()))?;
        let temporary = self.path.with_extension("json.tmp");
        let result = (|| -> std::io::Result<()> {
            let mut file = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            replace_file(&temporary, &self.path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result.map_err(|error| LibraryError::storage(format!("Cannot save playlists: {error}")))
    }
}

fn reorder_keys(paths: &[String]) -> Result<Vec<String>, LibraryError> {
    let mut seen = HashSet::with_capacity(paths.len());
    paths
        .iter()
        .map(|path| {
            if !valid_path(path) {
                return Err(LibraryError::invalid("歌曲路径必须是规范的绝对路径"));
            }
            let key = deletion_path_key(path);
            if !seen.insert(key.clone()) {
                return Err(LibraryError::invalid("排序不能包含重复的歌曲路径"));
            }
            Ok(key)
        })
        .collect()
}

// Random insertion interleaves two ordered streams. Existing songs and this
// batch's newly added songs each keep their relative order.
fn merge_tracks<T>(
    old: Vec<T>,
    new: Vec<T>,
    position: PlaylistInsertPosition,
    mut draw: impl FnMut(usize) -> usize,
) -> Vec<T> {
    match position {
        PlaylistInsertPosition::Start => new.into_iter().chain(old).collect(),
        PlaylistInsertPosition::End => old.into_iter().chain(new).collect(),
        PlaylistInsertPosition::Random => {
            let mut old = old.into_iter();
            let mut new = new.into_iter();
            let mut merged = Vec::with_capacity(old.len() + new.len());
            while old.len() > 0 && new.len() > 0 {
                if draw(old.len() + new.len()) < new.len() {
                    merged.push(new.next().unwrap());
                } else {
                    merged.push(old.next().unwrap());
                }
            }
            merged.extend(old);
            merged.extend(new);
            merged
        }
    }
}

impl StoredPlaylist {
    fn from_playlist(playlist: &AudioFolderPlaylist) -> Result<Self, LibraryError> {
        if playlist.source_kind != AudioPlaylistSourceKind::M3u8 {
            return Err(LibraryError::invalid(
                "Only imported M3U8 playlists can be saved",
            ));
        }
        let source_path = Path::new(&playlist.source_path)
            .canonicalize()
            .map_err(|error| {
                LibraryError::invalid(format!("Cannot resolve imported playlist: {error}"))
            })?
            .to_string_lossy()
            .into_owned();
        let mut seen = HashSet::new();
        let snapshot = Self {
            source_kind: StoredSourceKind::M3u8,
            source_path,
            source_name: playlist.source_name.clone(),
            directory_path: playlist.directory_path.clone(),
            directory_name: playlist.directory_name.clone(),
            tracks: playlist
                .tracks
                .iter()
                .filter(|track| seen.insert(path_key(&track.source_path)))
                .map(|track| StoredTrack {
                    source_path: track.source_path.clone(),
                })
                .collect(),
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    fn validate(&self) -> Result<(), LibraryError> {
        if !valid_path(&self.source_path)
            || !Path::new(&self.source_path)
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("m3u8"))
            || !valid_path(&self.directory_path)
            || self.source_name.trim().is_empty()
            || self.directory_name.trim().is_empty()
        {
            return Err(LibraryError::storage(
                "Saved playlist descriptor is invalid",
            ));
        }
        let mut seen = HashSet::new();
        for track in &self.tracks {
            if !valid_path(&track.source_path) || !seen.insert(path_key(&track.source_path)) {
                return Err(LibraryError::storage(
                    "Saved playlist track paths are invalid or duplicated",
                ));
            }
        }
        Ok(())
    }

    fn restore(self) -> AudioFolderPlaylist {
        // Keep the accepted snapshot even when the original M3U8 was changed
        // or deleted. Only availability and derived track identity are read.
        AudioFolderPlaylist {
            source_kind: AudioPlaylistSourceKind::M3u8,
            source_path: self.source_path,
            source_name: self.source_name,
            directory_path: self.directory_path,
            directory_name: self.directory_name,
            selected_index: 0,
            tracks: self
                .tracks
                .into_iter()
                .map(|track| restore_playlist_track(&track.source_path))
                .collect(),
        }
    }
}

fn valid_path(value: &str) -> bool {
    let path = Path::new(value);
    !value.contains('\0')
        && path.is_absolute()
        && !path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
}

fn path_key(value: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        value.to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{audio::import_m3u8_playlist, library_folders::LibraryFolderRegistry};
    use std::{
        sync::Arc,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn test_dir() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "spmusic-library-playlists-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn list(root: &Path, name: &str, contents: &str) -> AudioFolderPlaylist {
        let path = root.join(format!("{name}.m3u8"));
        fs::write(&path, contents).unwrap();
        import_m3u8_playlist(&path).unwrap()
    }

    fn reorder_input(
        playlist: &AudioFolderPlaylist,
        indices: &[usize],
    ) -> ReorderPlaylistTracksInput {
        ReorderPlaylistTracksInput {
            source_path: playlist.source_path.clone(),
            expected_track_paths: playlist
                .tracks
                .iter()
                .map(|track| track.source_path.clone())
                .collect(),
            ordered_track_paths: indices
                .iter()
                .map(|index| playlist.tracks[*index].source_path.clone())
                .collect(),
        }
    }

    #[test]
    fn reorder_persists_the_full_permutation_and_keeps_source_files() {
        let root = test_dir();
        let song = root.join("one.mp3");
        fs::write(&song, b"synthetic song fixture").unwrap();
        let playlist = list(&root, "ordered", "one.mp3\ntwo.mp3\nthree.mp3\n");
        let source = Path::new(&playlist.source_path);
        let source_bytes = fs::read(source).unwrap();
        let registry = LibraryPlaylistRegistry::new(&root);
        registry.upsert(&playlist).unwrap();
        let input = reorder_input(&playlist, &[2, 0, 1]);
        let expected = input.ordered_track_paths.clone();
        let updated = registry.reorder_tracks(input).unwrap();
        assert_eq!(
            updated
                .tracks
                .iter()
                .map(|track| &track.source_path)
                .collect::<Vec<_>>(),
            expected.iter().collect::<Vec<_>>()
        );
        assert_eq!(updated.tracks[1].id, playlist.tracks[0].id);
        let restored = LibraryPlaylistRegistry::new(&root).get().unwrap();
        assert_eq!(
            restored[0]
                .tracks
                .iter()
                .map(|track| &track.source_path)
                .collect::<Vec<_>>(),
            expected.iter().collect::<Vec<_>>()
        );
        assert_eq!(fs::read(source).unwrap(), source_bytes);
        assert_eq!(fs::read(song).unwrap(), b"synthetic song fixture");
        // The accepted app snapshot does not require the external M3U to exist.
        fs::remove_file(source).unwrap();
        assert!(registry
            .reorder_tracks(reorder_input(&updated, &[1, 2, 0]))
            .is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reorder_rejects_stale_order_after_addition_and_removal() {
        let root = test_dir();
        let playlist = list(&root, "ordered", "one.mp3\ntwo.mp3\n");
        let registry = LibraryPlaylistRegistry::new(&root);
        registry.upsert(&playlist).unwrap();
        registry
            .add_tracks(
                &playlist.source_path,
                &[root.join("three.mp3").to_string_lossy().into_owned()],
                PlaylistInsertPosition::End,
            )
            .unwrap();
        let before = fs::read(&registry.path).unwrap();
        let stale = registry
            .reorder_tracks(reorder_input(&playlist, &[1, 0]))
            .unwrap_err();
        assert_eq!(stale.code, "PLAYLIST_ORDER_CHANGED");
        assert!(stale.recoverable);
        assert_eq!(fs::read(&registry.path).unwrap(), before);
        let current = registry.get().unwrap().remove(0);
        registry
            .remove_tracks(
                &playlist.source_path,
                &[current.tracks[0].source_path.clone()],
            )
            .unwrap();
        let before = fs::read(&registry.path).unwrap();
        assert_eq!(
            registry
                .reorder_tracks(reorder_input(&current, &[2, 1, 0]))
                .unwrap_err()
                .code,
            "PLAYLIST_ORDER_CHANGED"
        );
        assert_eq!(fs::read(&registry.path).unwrap(), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reorder_rejects_missing_duplicate_foreign_and_relative_members() {
        let root = test_dir();
        let playlist = list(&root, "ordered", "one.mp3\ntwo.mp3\nthree.mp3\n");
        let registry = LibraryPlaylistRegistry::new(&root);
        registry.upsert(&playlist).unwrap();
        let before = fs::read(&registry.path).unwrap();
        let mut variants = vec![
            reorder_input(&playlist, &[1, 0]),
            reorder_input(&playlist, &[1, 1, 0]),
        ];
        let mut foreign = reorder_input(&playlist, &[2, 1, 0]);
        foreign.ordered_track_paths[0] = root.join("unknown.mp3").to_string_lossy().into_owned();
        variants.push(foreign);
        let mut relative = reorder_input(&playlist, &[2, 1, 0]);
        relative.expected_track_paths[0] = "relative.mp3".into();
        variants.push(relative);
        let mut duplicate_expected = reorder_input(&playlist, &[2, 1, 0]);
        duplicate_expected.expected_track_paths[0] =
            duplicate_expected.expected_track_paths[1].clone();
        variants.push(duplicate_expected);
        for input in variants {
            assert_eq!(
                registry.reorder_tracks(input).unwrap_err().code,
                "INVALID_PATH"
            );
            assert_eq!(fs::read(&registry.path).unwrap(), before);
        }
        let mut unknown_target = reorder_input(&playlist, &[2, 1, 0]);
        unknown_target.source_path = root
            .join("not-imported.m3u8")
            .to_string_lossy()
            .into_owned();
        assert_eq!(
            registry.reorder_tracks(unknown_target).unwrap_err().code,
            "INVALID_PATH"
        );
        assert_eq!(fs::read(&registry.path).unwrap(), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reorder_atomic_write_failure_keeps_the_previous_order() {
        let root = test_dir();
        let playlist = list(&root, "ordered", "one.mp3\ntwo.mp3\n");
        let registry = LibraryPlaylistRegistry::new(&root);
        registry.upsert(&playlist).unwrap();
        let before = fs::read(&registry.path).unwrap();
        fs::create_dir(registry.path.with_extension("json.tmp")).unwrap();
        let error = registry
            .reorder_tracks(reorder_input(&playlist, &[1, 0]))
            .unwrap_err();
        assert_eq!(error.code, "LIBRARY_STORAGE_ERROR");
        assert_eq!(fs::read(&registry.path).unwrap(), before);
        assert_eq!(
            registry.get().unwrap()[0].tracks[0].source_path,
            playlist.tracks[0].source_path
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reorder_noop_and_empty_snapshot_skip_storage_writes() {
        let root = test_dir();
        let playlist = list(&root, "ordered", "one.mp3\n");
        let registry = LibraryPlaylistRegistry::new(&root);
        registry.upsert(&playlist).unwrap();
        let temporary = registry.path.with_extension("json.tmp");
        fs::create_dir(&temporary).unwrap();
        assert!(registry
            .reorder_tracks(reorder_input(&playlist, &[0]))
            .is_ok());
        fs::remove_dir(&temporary).unwrap();
        registry
            .remove_tracks(
                &playlist.source_path,
                &[playlist.tracks[0].source_path.clone()],
            )
            .unwrap();
        let empty = registry.get().unwrap().remove(0);
        fs::create_dir(&temporary).unwrap();
        assert!(registry
            .reorder_tracks(reorder_input(&empty, &[]))
            .unwrap()
            .tracks
            .is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reorder_concurrent_moves_have_one_compare_and_swap_winner() {
        use std::sync::Barrier;
        let root = test_dir();
        let playlist = list(&root, "ordered", "one.mp3\ntwo.mp3\nthree.mp3\n");
        let registry = Arc::new(LibraryPlaylistRegistry::new(&root));
        registry.upsert(&playlist).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let workers: Vec<_> = [vec![2, 1, 0], vec![1, 2, 0]]
            .into_iter()
            .map(|indices| {
                let registry = Arc::clone(&registry);
                let barrier = Arc::clone(&barrier);
                let input = reorder_input(&playlist, &indices);
                std::thread::spawn(move || {
                    barrier.wait();
                    registry.reorder_tracks(input)
                })
            })
            .collect();
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .find_map(|result| result.as_ref().err())
                .unwrap()
                .code,
            "PLAYLIST_ORDER_CHANGED"
        );
        let winner = results.into_iter().find_map(Result::ok).unwrap();
        assert_eq!(
            registry.get().unwrap()[0]
                .tracks
                .iter()
                .map(|track| &track.source_path)
                .collect::<Vec<_>>(),
            winner
                .tracks
                .iter()
                .map(|track| &track.source_path)
                .collect::<Vec<_>>()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reorder_contract_uses_camel_case_and_rejects_unbounded_input() {
        let input: ReorderPlaylistTracksInput = serde_json::from_value(serde_json::json!({
            "sourcePath":"test.m3u8", "expectedTrackPaths":[], "orderedTrackPaths":[]
        }))
        .unwrap();
        assert!(input.expected_track_paths.is_empty());
        assert!(serde_json::from_value::<ReorderPlaylistTracksInput>(serde_json::json!({
            "sourcePath":"test.m3u8", "expectedTrackPaths":[], "orderedTrackPaths":[], "extra":true
        })).is_err());
        let root = test_dir();
        let registry = LibraryPlaylistRegistry::new(&root);
        let source_path = root.join("test.m3u8").to_string_lossy().into_owned();
        for (expected, ordered) in [(MAX_REORDER_TRACKS + 1, 0), (0, MAX_REORDER_TRACKS + 1)] {
            assert_eq!(
                registry
                    .reorder_tracks(ReorderPlaylistTracksInput {
                        source_path: source_path.clone(),
                        expected_track_paths: vec![String::new(); expected],
                        ordered_track_paths: vec![String::new(); ordered]
                    })
                    .unwrap_err()
                    .code,
                "INVALID_PATH"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn reorder_normalized_path_aliases_keep_authoritative_stored_spelling() {
        let root = test_dir();
        let playlist = list(&root, "ordered", "one.mp3\ntwo.mp3\n");
        let registry = LibraryPlaylistRegistry::new(&root);
        registry.upsert(&playlist).unwrap();
        let mut input = reorder_input(&playlist, &[1, 0]);
        input.source_path = input.source_path.to_uppercase().replace('\\', "/");
        for path in input
            .expected_track_paths
            .iter_mut()
            .chain(input.ordered_track_paths.iter_mut())
        {
            *path = path.to_uppercase().replace('\\', "/");
        }
        let updated = registry.reorder_tracks(input).unwrap();
        assert_eq!(
            updated.tracks[0].source_path,
            playlist.tracks[1].source_path
        );
        assert_eq!(
            updated.tracks[1].source_path,
            playlist.tracks[0].source_path
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn addition_start_and_end_insert_only_missing_batch_in_selected_order() {
        let root = test_dir();
        let registry = LibraryPlaylistRegistry::new(&root);
        for (name, position, expected) in [
            (
                "start",
                PlaylistInsertPosition::Start,
                vec!["new1.mp3", "new2.mp3", "old1.mp3", "old2.mp3"],
            ),
            (
                "end",
                PlaylistInsertPosition::End,
                vec!["old1.mp3", "old2.mp3", "new1.mp3", "new2.mp3"],
            ),
        ] {
            let original = list(&root, name, "old1.mp3\nold2.mp3\n");
            registry.upsert(&original).unwrap();
            let requested: Vec<_> = ["new1.mp3", "old1.mp3", "new2.mp3", "new1.mp3"]
                .iter()
                .map(|name| root.join(name).to_string_lossy().into_owned())
                .collect();
            let (updated, added, already) = registry
                .add_tracks(&original.source_path, &requested, position)
                .unwrap();
            assert_eq!(
                updated
                    .tracks
                    .iter()
                    .map(|track| track.file_name.as_str())
                    .collect::<Vec<_>>(),
                expected
            );
            assert_eq!(added.len(), 2);
            assert_eq!(already.len(), 1);
            let before = fs::read(&registry.path).unwrap();
            let (_, repeated, _) = registry
                .add_tracks(
                    &original.source_path,
                    &requested,
                    PlaylistInsertPosition::Random,
                )
                .unwrap();
            assert!(repeated.is_empty());
            assert_eq!(fs::read(&registry.path).unwrap(), before);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn addition_random_interleave_keeps_both_subsequences_and_uses_each_item_once() {
        let mut draws = [0, 1, 0].into_iter();
        let merged = merge_tracks(
            vec![1, 2],
            vec![3, 4],
            PlaylistInsertPosition::Random,
            |bound| {
                let draw = draws.next().unwrap();
                assert!(draw < bound);
                draw
            },
        );
        assert_eq!(merged, [3, 1, 4, 2]);
        assert_eq!(
            merged
                .iter()
                .filter(|item| **item <= 2)
                .copied()
                .collect::<Vec<_>>(),
            [1, 2]
        );
        assert_eq!(
            merged
                .iter()
                .filter(|item| **item >= 3)
                .copied()
                .collect::<Vec<_>>(),
            [3, 4]
        );
        assert_eq!(
            merge_tracks(
                vec![1, 2],
                vec![],
                PlaylistInsertPosition::Random,
                |_| panic!("no draw for empty batch")
            ),
            [1, 2]
        );
        assert_eq!(
            merge_tracks(
                vec![],
                vec![3, 4],
                PlaylistInsertPosition::Random,
                |_| panic!("no draw for empty target")
            ),
            [3, 4]
        );
    }

    #[test]
    fn addition_switch_removal_only_removes_relationships_and_preserves_files() {
        let root = test_dir();
        let registry = LibraryPlaylistRegistry::new(&root);
        let original = list(&root, "switch", "old.mp3\n");
        registry.upsert(&original).unwrap();
        let file = root.join("selected.mp3");
        fs::write(&file, b"synthetic fixture").unwrap();
        let source_bytes = fs::read(root.join("switch.m3u8")).unwrap();
        let selected = file.to_string_lossy().into_owned();
        registry
            .add_tracks(
                &original.source_path,
                &[selected.clone()],
                PlaylistInsertPosition::Start,
            )
            .unwrap();
        let (removed, failures, updated) = registry
            .remove_tracks(&original.source_path, &[selected.clone()])
            .unwrap();
        assert_eq!(removed, [selected]);
        assert!(failures.is_empty());
        assert_eq!(updated[0].tracks.len(), 1);
        assert_eq!(updated[0].tracks[0].file_name, "old.mp3");
        assert_eq!(fs::read(&file).unwrap(), b"synthetic fixture");
        assert_eq!(fs::read(root.join("switch.m3u8")).unwrap(), source_bytes);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn addition_appends_missing_members_once_and_preserves_source_file() {
        let root = test_dir();
        let registry = LibraryPlaylistRegistry::new(&root);
        let original = list(&root, "target", "old.mp3\n");
        registry.upsert(&original).unwrap();
        let source_bytes = fs::read(root.join("target.m3u8")).unwrap();
        let old = original.tracks[0].source_path.clone();
        let first = root.join("first.flac").to_string_lossy().into_owned();
        let second = root.join("second.mp3").to_string_lossy().into_owned();
        let (updated, added, already) = registry
            .add_tracks(
                &original.source_path,
                &[old.clone(), first.clone(), first.clone(), second.clone()],
                PlaylistInsertPosition::End,
            )
            .unwrap();
        assert_eq!(added, [first.clone(), second.clone()]);
        assert_eq!(already, [old.clone()]);
        assert_eq!(
            updated
                .tracks
                .iter()
                .map(|track| track.source_path.clone())
                .collect::<Vec<_>>(),
            [old, first.clone(), second.clone()]
        );
        assert!(!updated.tracks[1].available);
        let before = fs::read(&registry.path).unwrap();
        let (_, added, already) = registry
            .add_tracks(
                &original.source_path,
                &[first.clone(), second.clone()],
                PlaylistInsertPosition::End,
            )
            .unwrap();
        assert!(added.is_empty());
        assert_eq!(already, [first, second]);
        assert_eq!(fs::read(&registry.path).unwrap(), before);
        assert_eq!(fs::read(root.join("target.m3u8")).unwrap(), source_bytes);
        assert_eq!(
            LibraryPlaylistRegistry::new(&root).get().unwrap()[0]
                .tracks
                .len(),
            3
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn addition_keeps_registered_target_after_external_source_is_missing() {
        let root = test_dir();
        let registry = LibraryPlaylistRegistry::new(&root);
        let target = list(&root, "target", "old.mp3\n");
        registry.upsert(&target).unwrap();
        fs::remove_file(root.join("target.m3u8")).unwrap();
        let path = root.join("new.flac").to_string_lossy().into_owned();
        let (updated, added, _) = registry
            .add_tracks(
                &target.source_path,
                &[path.clone()],
                PlaylistInsertPosition::End,
            )
            .unwrap();
        assert_eq!(updated.tracks.len(), 2);
        assert_eq!(added, [path]);
        assert!(!root.join("target.m3u8").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn addition_rejects_unknown_target_and_invalid_member_without_mutation() {
        let root = test_dir();
        let registry = LibraryPlaylistRegistry::new(&root);
        let target = list(&root, "target", "old.mp3\n");
        registry.upsert(&target).unwrap();
        let before = fs::read(&registry.path).unwrap();
        assert!(registry
            .add_tracks(
                &root.join("unknown.m3u8").to_string_lossy(),
                &[],
                PlaylistInsertPosition::End
            )
            .is_err());
        assert!(registry
            .add_tracks(
                &target.source_path,
                &["relative.mp3".into()],
                PlaylistInsertPosition::End
            )
            .is_err());
        assert_eq!(fs::read(&registry.path).unwrap(), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn addition_failed_atomic_write_never_reports_or_persists_success() {
        let root = test_dir();
        let registry = LibraryPlaylistRegistry::new(&root);
        let target = list(&root, "target", "old.mp3\n");
        registry.upsert(&target).unwrap();
        let before = fs::read(&registry.path).unwrap();
        fs::create_dir(registry.path.with_extension("json.tmp")).unwrap();
        assert!(registry
            .add_tracks(
                &target.source_path,
                &[root.join("new.mp3").to_string_lossy().into_owned()],
                PlaylistInsertPosition::End,
            )
            .is_err());
        assert_eq!(fs::read(&registry.path).unwrap(), before);
        assert_eq!(registry.get().unwrap()[0].tracks.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn addition_concurrent_appends_preserve_each_relationship_once() {
        let root = test_dir();
        let registry = Arc::new(LibraryPlaylistRegistry::new(&root));
        let target = list(&root, "target", "old.mp3\n");
        registry.upsert(&target).unwrap();
        let handles = (0..4)
            .map(|index| {
                let registry = Arc::clone(&registry);
                let source = target.source_path.clone();
                let path = root
                    .join(format!("new-{index}.mp3"))
                    .to_string_lossy()
                    .into_owned();
                std::thread::spawn(move || {
                    registry
                        .add_tracks(&source, &[path], PlaylistInsertPosition::End)
                        .unwrap()
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().unwrap();
        }
        let restored = registry.get().unwrap();
        assert_eq!(restored[0].tracks.len(), 5);
        assert_eq!(restored[0].tracks[0].file_name, "old.mp3");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn snapshot_roundtrip_survives_source_changes_and_tracks_recover() {
        let root = test_dir();
        let track = root.join("song.flac");
        fs::write(&track, []).unwrap();
        let playlist = list(&root, "chosen", "song.flac\nmissing.mp3\nsong.flac\n");
        let registry = LibraryPlaylistRegistry::new(&root);
        assert!(registry.get().unwrap().is_empty());
        registry.upsert(&playlist).unwrap();
        let persisted = fs::read_to_string(&registry.path).unwrap();
        assert!(!persisted.contains("available"));
        assert!(!persisted.contains("cover"));

        // A fresh registry models process restart. It restores accepted order
        // from the snapshot, even when the original file no longer agrees.
        fs::write(root.join("chosen.m3u8"), b"replacement.wav\n").unwrap();
        let restored = LibraryPlaylistRegistry::new(&root).get().unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].source_path, playlist.source_path);
        assert_eq!(restored[0].source_name, playlist.source_name);
        assert_eq!(restored[0].tracks.len(), 2);
        assert_eq!(restored[0].tracks[0].id, playlist.tracks[0].id);
        assert_eq!(restored[0].tracks[0].file_name, "song.flac");
        assert!(restored[0].tracks[0].available);
        assert!(!restored[0].tracks[1].available);
        fs::remove_file(root.join("chosen.m3u8")).unwrap();
        fs::remove_file(&track).unwrap();
        let unavailable = LibraryPlaylistRegistry::new(&root).get().unwrap();
        assert_eq!(unavailable[0].tracks.len(), 2);
        assert!(!unavailable[0].tracks[0].available);
        fs::write(&track, []).unwrap();
        let recovered = LibraryPlaylistRegistry::new(&root).get().unwrap();
        assert!(recovered[0].tracks[0].available);
        assert_eq!(recovered[0].tracks[0].id, playlist.tracks[0].id);
        assert_eq!(recovered[0].selected_index, 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deletion_list_removal_is_persisted_empty_and_keeps_original_files() {
        let root = test_dir();
        let track = root.join("song.mp3");
        fs::write(&track, b"fixture").unwrap();
        let original = root.join("chosen.m3u8");
        let playlist = list(&root, "chosen", "song.mp3\n");
        let registry = LibraryPlaylistRegistry::new(&root);
        registry.upsert(&playlist).unwrap();
        let source_before = fs::read(&original).unwrap();
        let path = playlist.tracks[0].source_path.clone();
        let (removed, failures, updated) = registry
            .remove_tracks(
                &playlist.source_path,
                &[
                    path.clone(),
                    path,
                    root.join("unknown.mp3").to_string_lossy().into_owned(),
                ],
            )
            .unwrap();
        assert_eq!(removed.len(), 1);
        assert_eq!(failures.len(), 1);
        assert!(updated[0].tracks.is_empty());
        assert!(LibraryPlaylistRegistry::new(&root).get().unwrap()[0]
            .tracks
            .is_empty());
        assert!(track.is_file());
        assert_eq!(fs::read(&original).unwrap(), source_before);
        fs::remove_file(&original).unwrap();
        assert!(registry.remove_tracks(&playlist.source_path, &[]).is_ok()); // Does not re-open external M3U.
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deletion_failed_list_write_keeps_original_snapshot() {
        let root = test_dir();
        let playlist = list(&root, "chosen", "song.mp3\n");
        let registry = LibraryPlaylistRegistry::new(&root);
        registry.upsert(&playlist).unwrap();
        let before = fs::read(&registry.path).unwrap();
        fs::create_dir(registry.path.with_extension("json.tmp")).unwrap();
        assert!(registry
            .remove_tracks(
                &playlist.source_path,
                &[playlist.tracks[0].source_path.clone()]
            )
            .is_err());
        assert_eq!(fs::read(&registry.path).unwrap(), before);
        assert_eq!(registry.get().unwrap()[0].tracks.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deletion_file_success_prunes_all_registered_lists_and_unknown_scope_is_rejected() {
        let root = test_dir();
        let registry = LibraryPlaylistRegistry::new(&root);
        let first = list(&root, "first", "shared.mp3\nretained.mp3\n");
        let second = list(&root, "second", "shared.mp3\n");
        registry.upsert(&first).unwrap();
        registry.upsert(&second).unwrap();
        let source_before = fs::read(root.join("first.m3u8")).unwrap();
        let selected = vec![first.tracks[0].source_path.clone()];
        assert!(registry
            .remove_tracks(
                &root.join("not-registered.m3u8").to_string_lossy(),
                &selected
            )
            .is_err());
        let updated = registry.remove_paths_from_all(&selected).unwrap();
        assert_eq!(updated[0].tracks.len(), 1);
        assert!(updated[1].tracks.is_empty());
        let restored = LibraryPlaylistRegistry::new(&root).get().unwrap();
        assert_eq!(restored[0].tracks.len(), 1);
        assert!(restored[1].tracks.is_empty());
        assert_eq!(fs::read(root.join("first.m3u8")).unwrap(), source_before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reimport_replaces_one_snapshot_without_reordering_other_lists() {
        let root = test_dir();
        let registry = LibraryPlaylistRegistry::new(&root);
        registry
            .upsert(&list(&root, "first", "one.mp3\ntwo.flac\n"))
            .unwrap();
        registry
            .upsert(&list(&root, "second", "other.wav\n"))
            .unwrap();
        registry
            .upsert(&list(&root, "first", "two.flac\nthree.mp3\n"))
            .unwrap();
        let restored = LibraryPlaylistRegistry::new(&root).get().unwrap();
        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].source_name, "first");
        assert_eq!(restored[1].source_name, "second");
        assert_eq!(
            restored[0]
                .tracks
                .iter()
                .map(|track| track.file_name.as_str())
                .collect::<Vec<_>>(),
            ["two.flac", "three.mp3"]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_or_future_storage_is_reported_and_never_overwritten() {
        let root = test_dir();
        let registry = LibraryPlaylistRegistry::new(&root);
        let playlist = list(&root, "first", "one.mp3\n");
        registry.upsert(&playlist).unwrap();
        let valid: serde_json::Value =
            serde_json::from_slice(&fs::read(&registry.path).unwrap()).unwrap();
        let mut future = valid.clone();
        future["version"] = serde_json::json!(2);
        let mut bad_path = valid.clone();
        bad_path["playlists"][0]["tracks"][0]["sourcePath"] = serde_json::json!("relative.mp3");
        let mut duplicate = valid.clone();
        duplicate["playlists"]
            .as_array_mut()
            .unwrap()
            .push(valid["playlists"][0].clone());
        for bytes in [
            b"invalid json".to_vec(),
            serde_json::to_vec(&future).unwrap(),
            serde_json::to_vec(&bad_path).unwrap(),
            serde_json::to_vec(&duplicate).unwrap(),
        ] {
            fs::write(&registry.path, &bytes).unwrap();
            assert_eq!(registry.get().unwrap_err().code, "LIBRARY_STORAGE_ERROR");
            let error = registry.upsert(&playlist).unwrap_err();
            assert_eq!(error.code, "LIBRARY_STORAGE_ERROR");
            assert!(error.recoverable);
            assert_eq!(fs::read(&registry.path).unwrap(), bytes);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_write_keeps_prior_snapshot_and_does_not_publish_new_list() {
        let root = test_dir();
        let registry = LibraryPlaylistRegistry::new(&root);
        registry.upsert(&list(&root, "first", "one.mp3\n")).unwrap();
        let before = fs::read(&registry.path).unwrap();
        let temporary = registry.path.with_extension("json.tmp");
        fs::create_dir(&temporary).unwrap();
        let error = registry
            .upsert(&list(&root, "second", "two.mp3\n"))
            .unwrap_err();
        assert_eq!(error.code, "LIBRARY_STORAGE_ERROR");
        assert_eq!(fs::read(&registry.path).unwrap(), before);
        assert_eq!(registry.get().unwrap().len(), 1);
        fs::remove_dir(&temporary).unwrap();
        registry
            .upsert(&list(&root, "second", "two.mp3\n"))
            .unwrap();
        assert_eq!(registry.get().unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn failed_atomic_replacement_preserves_old_file_and_removes_temporary() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = test_dir();
        let registry = LibraryPlaylistRegistry::new(&root);
        registry.upsert(&list(&root, "first", "one.mp3\n")).unwrap();
        let before = fs::read(&registry.path).unwrap();
        // Permit reads/writes while denying deletion of the destination. The
        // temporary write succeeds and only the atomic replacement fails.
        let guard = OpenOptions::new()
            .read(true)
            .share_mode(0x1 | 0x2)
            .open(&registry.path)
            .unwrap();
        let error = registry
            .upsert(&list(&root, "second", "two.mp3\n"))
            .unwrap_err();
        assert_eq!(error.code, "LIBRARY_STORAGE_ERROR");
        assert_eq!(fs::read(&registry.path).unwrap(), before);
        assert!(!registry.path.with_extension("json.tmp").exists());
        drop(guard);
        assert_eq!(registry.get().unwrap().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clearing_selected_folders_preserves_imported_playlist_snapshots() {
        let root = test_dir();
        let folders = LibraryFolderRegistry::new(&root);
        folders.add(&root.to_string_lossy()).unwrap();
        let playlists = LibraryPlaylistRegistry::new(&root);
        playlists
            .upsert(&list(&root, "chosen", "missing.mp3\n"))
            .unwrap();
        folders.clear().unwrap();
        assert!(folders.get().unwrap().folders.is_empty());
        assert_eq!(LibraryPlaylistRegistry::new(&root).get().unwrap().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_imports_do_not_lose_lists() {
        let root = test_dir();
        let registry = Arc::new(LibraryPlaylistRegistry::new(&root));
        let handles = (0..8)
            .map(|index| {
                let registry = Arc::clone(&registry);
                let playlist = list(&root, &format!("list-{index}"), "missing.mp3\n");
                std::thread::spawn(move || registry.upsert(&playlist).unwrap())
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(LibraryPlaylistRegistry::new(&root).get().unwrap().len(), 8);
        fs::remove_dir_all(root).unwrap();
    }
}
