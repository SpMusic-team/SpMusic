use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

use crate::{
    audio::{restore_playlist_track, AudioFolderPlaylist, AudioPlaylistSourceKind},
    library_folders::{replace_file, LibraryError},
};

const REGISTRY_FILE: &str = "library-playlists.v1.json";
const REGISTRY_VERSION: u8 = 1;

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
            || self.tracks.is_empty()
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
