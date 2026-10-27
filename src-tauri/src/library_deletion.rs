use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::{
    audio::{load_library_folder, AudioController, AudioFolderPlaylist, AudioPlaybackState},
    file_deletion::{checked_regular_file, path_key, DeleteFailure},
    library_folders::{LibraryError, LibraryFolderRegistry},
    library_playlists::LibraryPlaylistRegistry,
};

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DeleteMode {
    List,
    Files,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteTracksInput {
    pub mode: DeleteMode,
    pub source_path: Option<String>,
    pub track_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTracksResult {
    pub removed_paths: Vec<String>,
    pub failures: Vec<DeleteFailure>,
    pub playlists: Vec<AudioFolderPlaylist>,
    pub state: Option<AudioPlaybackState>,
    pub storage_error: Option<LibraryError>,
}

pub fn delete_tracks(
    input: DeleteTracksInput,
    audio: &AudioController,
    folders: &LibraryFolderRegistry,
    registry: &LibraryPlaylistRegistry,
) -> Result<DeleteTracksResult, LibraryError> {
    if input.track_paths.is_empty() || input.track_paths.len() > 8192 {
        return Err(LibraryError::invalid("请选择 1 至 8192 个歌曲条目"));
    }
    if input.mode == DeleteMode::List {
        let source = input
            .source_path
            .ok_or_else(|| LibraryError::invalid("缺少播放列表来源"))?;
        let (removed_paths, failures, playlists) =
            registry.remove_tracks(&source, &input.track_paths)?;
        return Ok(DeleteTracksResult {
            removed_paths,
            failures,
            playlists,
            state: None,
            storage_error: None,
        });
    }

    // Authorize descriptors, not arbitrary paths passed from the webview.
    // A scan is the same source of truth as the visible folder collection.
    let before = registry.get()?;
    let mut known: HashMap<String, String> = audio
        .known_track_paths()
        .into_iter()
        .map(|path| (path_key(&path), path))
        .collect();
    for playlist in &before {
        for track in &playlist.tracks {
            known.insert(path_key(&track.source_path), track.source_path.clone());
        }
    }
    for root in folders.get()?.folders {
        if let Ok(playlist) = load_library_folder(Path::new(&root)) {
            for track in playlist.tracks {
                known.insert(path_key(&track.source_path), track.source_path);
            }
        }
    }
    let (paths, mut failures) = prepare_known_files(input.track_paths, &known);
    let (removed_paths, mut file_failures, state) = audio
        .delete_files(paths)
        .map_err(|error| LibraryError::storage(error.message))?;
    failures.append(&mut file_failures);
    // A registry write failure must never erase evidence of completed OS moves.
    let (playlists, storage_error) = match registry.remove_paths_from_all(&removed_paths) {
        Ok(playlists) => (playlists, None),
        Err(error) => (registry.get().unwrap_or(before), Some(error)),
    };
    Ok(DeleteTracksResult {
        removed_paths,
        failures,
        playlists,
        state: Some(state),
        storage_error,
    })
}

fn prepare_known_files(
    requested_paths: Vec<String>,
    known: &HashMap<String, String>,
) -> (Vec<(String, PathBuf)>, Vec<DeleteFailure>) {
    let mut paths = Vec::new();
    let mut failures = Vec::new();
    let mut seen = HashSet::new();
    let mut physical_seen = HashSet::new();
    for requested in requested_paths {
        if !seen.insert(path_key(&requested)) {
            continue;
        }
        let Some(known_path) = known.get(&path_key(&requested)) else {
            failures.push(DeleteFailure::new(
                &requested,
                "UNKNOWN_TRACK",
                "歌曲不属于已加载的本地音乐来源",
            ));
            continue;
        };
        match checked_regular_file(Path::new(known_path)) {
            Ok(path) => {
                if path_key(&path.to_string_lossy()) != path_key(known_path) {
                    failures.push(DeleteFailure::new(
                        &requested,
                        "CHANGED_PATH",
                        "歌曲文件路径已改变，请重新加载来源",
                    ));
                    continue;
                }
                if !physical_seen.insert(path_key(&path.to_string_lossy())) {
                    continue;
                }
                paths.push((requested, path));
            }
            Err(error) => failures.push(DeleteFailure::new(&requested, "INVALID_FILE", error)),
        }
    }
    (paths, failures)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "spmusic-delete-fixture-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn deletion_regular_file_guard_rejects_directories_missing_and_relative_paths() {
        let root = root();
        assert!(checked_regular_file(&root).is_err());
        assert!(checked_regular_file(&root.join("missing.mp3")).is_err());
        assert!(checked_regular_file(Path::new("relative.mp3")).is_err());
        let file = root.join("fixture.mp3");
        fs::write(&file, b"synthetic fixture").unwrap();
        assert!(checked_regular_file(&file).is_ok());
        assert!(checked_regular_file(&root.join("../outside.mp3")).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deletion_contract_serializes_partial_success_without_losing_storage_error() {
        let result = DeleteTracksResult {
            removed_paths: vec!["fixture.mp3".into()],
            failures: vec![DeleteFailure::new("locked.mp3", "TRASH_FAILED", "locked")],
            playlists: vec![],
            state: None,
            storage_error: Some(LibraryError::storage("cannot save")),
        };
        let json = serde_json::to_value(result).unwrap();
        assert_eq!(json["removedPaths"][0], "fixture.mp3");
        assert_eq!(json["failures"][0]["code"], "TRASH_FAILED");
        assert_eq!(json["storageError"]["code"], "LIBRARY_STORAGE_ERROR");
        assert!(json["state"].is_null());
    }

    #[test]
    fn deletion_authorization_rejects_unknown_and_deduplicates_known_files() {
        let root = root();
        let file = root.join("known.mp3");
        let unknown = root.join("unknown.mp3");
        fs::write(&file, b"fixture").unwrap();
        fs::write(&unknown, b"must remain").unwrap();
        let source = file.to_string_lossy().into_owned();
        let known = HashMap::from([(path_key(&source), source.clone())]);
        let (prepared, failures) = prepare_known_files(
            vec![
                source.clone(),
                source.clone(),
                unknown.to_string_lossy().into_owned(),
            ],
            &known,
        );
        assert_eq!(prepared.len(), 1);
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].code, "UNKNOWN_TRACK");
        assert!(unknown.is_file());
        fs::remove_dir_all(root).unwrap();
    }
}
