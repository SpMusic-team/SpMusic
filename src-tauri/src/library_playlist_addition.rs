use crate::{
    audio::{load_library_folder, AudioController, AudioFolderPlaylist},
    file_deletion::{path_key, validate_path},
    library_folders::{LibraryError, LibraryFolderRegistry},
    library_playlists::{LibraryPlaylistRegistry, PlaylistInsertPosition},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddPlaylistTracksInput {
    pub source_path: String,
    pub track_paths: Vec<String>,
    #[serde(default)]
    pub position: PlaylistInsertPosition,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPlaylistTrackFailure {
    pub source_path: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPlaylistTracksResult {
    pub playlist: AudioFolderPlaylist,
    pub added_paths: Vec<String>,
    pub already_present_paths: Vec<String>,
    pub failures: Vec<AddPlaylistTrackFailure>,
}

pub fn add_playlist_tracks(
    input: AddPlaylistTracksInput,
    audio: &AudioController,
    folders: &LibraryFolderRegistry,
    registry: &LibraryPlaylistRegistry,
) -> Result<AddPlaylistTracksResult, LibraryError> {
    if input.track_paths.is_empty() || input.track_paths.len() > 8192 {
        return Err(LibraryError::invalid("请选择 1 至 8192 个歌曲条目"));
    }
    let playlists = registry.get()?;
    if !playlists
        .iter()
        .any(|playlist| path_key(&playlist.source_path) == path_key(&input.source_path))
    {
        return Err(LibraryError::invalid("只能添加到已导入的播放列表"));
    }
    let mut known: HashMap<_, _> = audio
        .known_track_paths()
        .into_iter()
        .map(|path| (path_key(&path), path))
        .collect();
    for playlist in &playlists {
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
    add_known_tracks(input, &known, registry)
}

fn add_known_tracks(
    input: AddPlaylistTracksInput,
    known: &HashMap<String, String>,
    registry: &LibraryPlaylistRegistry,
) -> Result<AddPlaylistTracksResult, LibraryError> {
    let (paths, failures) = prepare_known_tracks(input.track_paths, known);
    let (playlist, added_paths, already_present_paths) =
        registry.add_tracks(&input.source_path, &paths, input.position)?;
    Ok(AddPlaylistTracksResult {
        playlist,
        added_paths,
        already_present_paths,
        failures,
    })
}

fn prepare_known_tracks(
    requested: Vec<String>,
    known: &HashMap<String, String>,
) -> (Vec<String>, Vec<AddPlaylistTrackFailure>) {
    let mut seen = HashSet::new();
    let mut accepted = Vec::new();
    let mut failures = Vec::new();
    for source_path in requested {
        let key = path_key(&source_path);
        if !seen.insert(key.clone()) {
            continue;
        }
        if !validate_path(Path::new(&source_path)) {
            failures.push(AddPlaylistTrackFailure {
                source_path,
                code: "INVALID_PATH".into(),
                message: "歌曲路径必须是规范的绝对路径".into(),
            });
        } else if let Some(path) = known.get(&key) {
            // Relationships may refer to a temporarily unavailable known song;
            // availability is derived when restoring, not fabricated here.
            accepted.push(path.clone());
        } else {
            failures.push(AddPlaylistTrackFailure {
                source_path,
                code: "UNKNOWN_TRACK".into(),
                message: "歌曲不属于已加载的本地音乐来源".into(),
            });
        }
    }
    (accepted, failures)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addition_switch_from_only_m3u_source_preserves_accepted_song_authorization() {
        use std::{
            fs,
            time::{SystemTime, UNIX_EPOCH},
        };
        let root = std::env::temp_dir().join(format!(
            "spmusic-add-switch-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let source = root.join("source.m3u8");
        let target = root.join("target.m3u8");
        let song = root.join("selected.mp3");
        fs::write(&source, b"selected.mp3\n").unwrap();
        fs::write(&target, b"retained.mp3\n").unwrap();
        fs::write(&song, b"synthetic fixture").unwrap();
        let source_list = crate::audio::import_m3u8_playlist(&source).unwrap();
        let target_list = crate::audio::import_m3u8_playlist(&target).unwrap();
        let registry = LibraryPlaylistRegistry::new(&root);
        registry.upsert(&source_list).unwrap();
        registry.upsert(&target_list).unwrap();
        // The session remembers the accepted import, even when membership is
        // later removed. This is the trusted set supplied by AudioController.
        let known = source_list
            .tracks
            .iter()
            .map(|track| (path_key(&track.source_path), track.source_path.clone()))
            .collect();
        let selected = source_list.tracks[0].source_path.clone();
        registry
            .remove_tracks(&source_list.source_path, &[selected.clone()])
            .unwrap();
        assert!(registry.get().unwrap()[0].tracks.is_empty());
        let result = add_known_tracks(
            AddPlaylistTracksInput {
                source_path: target_list.source_path,
                track_paths: vec![selected.clone()],
                position: PlaylistInsertPosition::Start,
            },
            &known,
            &registry,
        )
        .unwrap();
        assert_eq!(result.added_paths, [selected]);
        assert!(result.failures.is_empty());
        assert_eq!(result.playlist.tracks[0].file_name, "selected.mp3");
        assert_eq!(fs::read(&song).unwrap(), b"synthetic fixture");
        assert_eq!(fs::read(&source).unwrap(), b"selected.mp3\n");
        assert_eq!(fs::read(&target).unwrap(), b"retained.mp3\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn addition_position_defaults_to_end_and_accepts_only_supported_variants() {
        let base = serde_json::json!({ "sourcePath": "target", "trackPaths": [] });
        assert_eq!(
            serde_json::from_value::<AddPlaylistTracksInput>(base.clone())
                .unwrap()
                .position,
            PlaylistInsertPosition::End
        );
        for (position, expected) in [
            ("start", PlaylistInsertPosition::Start),
            ("end", PlaylistInsertPosition::End),
            ("random", PlaylistInsertPosition::Random),
        ] {
            let mut input = base.clone();
            input["position"] = serde_json::json!(position);
            assert_eq!(
                serde_json::from_value::<AddPlaylistTracksInput>(input)
                    .unwrap()
                    .position,
                expected
            );
        }
        let mut invalid = base;
        invalid["position"] = serde_json::json!("shuffle-existing");
        assert!(serde_json::from_value::<AddPlaylistTracksInput>(invalid).is_err());
    }

    #[test]
    fn addition_authorization_rejects_unknown_and_relative_and_preserves_known_order() {
        let root = std::env::temp_dir();
        let first = root
            .join("spmusic-known-missing-1.mp3")
            .to_string_lossy()
            .into_owned();
        let second = root
            .join("spmusic-known-missing-2.flac")
            .to_string_lossy()
            .into_owned();
        let unknown = root
            .join("spmusic-unknown.mp3")
            .to_string_lossy()
            .into_owned();
        let known = HashMap::from([
            (path_key(&first), first.clone()),
            (path_key(&second), second.clone()),
        ]);
        let (accepted, failures) = prepare_known_tracks(
            vec![
                second.clone(),
                first.clone(),
                second.clone(),
                unknown,
                "relative.mp3".into(),
            ],
            &known,
        );
        assert_eq!(accepted, [second, first]);
        assert_eq!(failures.len(), 2);
        assert_eq!(failures[0].code, "UNKNOWN_TRACK");
        assert_eq!(failures[1].code, "INVALID_PATH");
    }

    #[test]
    fn addition_ipc_serializes_partial_results_and_rejects_extra_input_fields() {
        let root = std::env::temp_dir();
        let path = root
            .join("spmusic-known-missing.mp3")
            .to_string_lossy()
            .into_owned();
        let playlist = AudioFolderPlaylist {
            source_kind: crate::audio::AudioPlaylistSourceKind::M3u8,
            source_path: root
                .join("spmusic-target.m3u8")
                .to_string_lossy()
                .into_owned(),
            source_name: "target".into(),
            directory_path: root.to_string_lossy().into_owned(),
            directory_name: "fixture".into(),
            selected_index: 0,
            tracks: vec![],
        };
        let result = AddPlaylistTracksResult {
            playlist,
            added_paths: vec![path.clone()],
            already_present_paths: vec![],
            failures: vec![AddPlaylistTrackFailure {
                source_path: "unknown".into(),
                code: "UNKNOWN_TRACK".into(),
                message: "unknown".into(),
            }],
        };
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["addedPaths"][0], path);
        assert_eq!(value["failures"][0]["sourcePath"], "unknown");
        assert_eq!(value["alreadyPresentPaths"], serde_json::json!([]));
        assert!(serde_json::from_value::<AddPlaylistTracksInput>(
            serde_json::json!({"sourcePath":"target", "trackPaths":[], "overwrite":true})
        )
        .is_err());
    }
}
