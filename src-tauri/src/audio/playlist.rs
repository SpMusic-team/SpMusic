use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use super::{
    error::{audio_error, AudioCommandError, AudioErrorCode},
    source::{track_id, validate_existing_file},
    types::{AudioFileFilter, AudioFolderPlaylist, AudioFolderTrackRef, AudioPlaylistSourceKind},
};

const SUPPORTED_AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "flac", "ogg", "oga", "opus", "aac", "m4a", "m4b", "mp4", "aif", "aiff", "caf",
    "mka", "mkv", "webm", "weba",
];
const SUPPORTED_M3U8_EXTENSIONS: &[&str] = &["m3u8"];

pub(crate) fn default_filters() -> Vec<AudioFileFilter> {
    vec![AudioFileFilter {
        name: "Audio".to_string(),
        extensions: SUPPORTED_AUDIO_EXTENSIONS
            .iter()
            .map(|extension| (*extension).to_string())
            .collect(),
    }]
}

pub(crate) fn source_filters() -> Vec<AudioFileFilter> {
    let mut extensions = SUPPORTED_AUDIO_EXTENSIONS
        .iter()
        .copied()
        .chain(SUPPORTED_M3U8_EXTENSIONS.iter().copied())
        .map(str::to_string)
        .collect::<Vec<_>>();
    extensions.sort();

    vec![AudioFileFilter {
        name: "Audio or M3U8 playlist".to_string(),
        extensions,
    }]
}

pub(crate) fn load_folder_playlist(
    selected_path: &Path,
) -> Result<AudioFolderPlaylist, AudioCommandError> {
    validate_existing_file(selected_path)?;
    if has_supported_m3u8_extension(selected_path) {
        return load_m3u8_playlist(selected_path, None, true);
    }

    let directory = selected_path.parent().ok_or_else(|| {
        audio_error(
            AudioErrorCode::InvalidPath,
            "Audio file does not have a parent directory",
            true,
        )
    })?;
    let directory = directory
        .canonicalize()
        .unwrap_or_else(|_| directory.to_path_buf());
    let selected_id = track_id(selected_path);

    if let Some(playlist) =
        load_first_directory_m3u8_playlist(&directory, Some(selected_id.as_str()))?
    {
        return Ok(playlist);
    }

    load_directory_audio_playlist(&directory, Some(selected_id.as_str()))
}

fn load_directory_audio_playlist(
    directory: &Path,
    selected_id: Option<&str>,
) -> Result<AudioFolderPlaylist, AudioCommandError> {
    let entries = fs::read_dir(directory).map_err(|error| {
        tracing::warn!(
            operation = "audio.source.folder_playlist",
            path = %directory.display(),
            error = %error,
            "audio folder could not be read",
        );
        audio_error(
            AudioErrorCode::UnreadableFile,
            "Audio folder could not be read",
            true,
        )
    })?;

    let mut tracks = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && has_supported_audio_extension(path))
        .map(|path| {
            let path = path.canonicalize().unwrap_or(path);
            let file_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("audio")
                .to_string();
            AudioFolderTrackRef {
                id: track_id(&path),
                source_path: path.to_string_lossy().into_owned(),
                file_name,
                available: true,
            }
        })
        .collect::<Vec<_>>();

    tracks.sort_by(|left, right| {
        left.file_name
            .to_lowercase()
            .cmp(&right.file_name.to_lowercase())
            .then_with(|| left.file_name.cmp(&right.file_name))
            .then_with(|| left.source_path.cmp(&right.source_path))
    });

    let selected_index = selected_id
        .map(|selected_id| {
            tracks
                .iter()
                .position(|track| track.id == selected_id)
                .ok_or_else(|| {
                    audio_error(
                        AudioErrorCode::UnsupportedFormat,
                        "Selected audio file is not in the supported folder playlist",
                        true,
                    )
                })
        })
        .transpose()?
        .unwrap_or(0);

    if tracks.is_empty() {
        return Err(audio_error(
            AudioErrorCode::UnsupportedFormat,
            "Folder does not contain supported local audio files",
            true,
        ));
    }

    let directory_name = directory_display_name(directory);

    tracing::info!(
        operation = "audio.source.folder_playlist",
        path = %directory.display(),
        track_count = tracks.len(),
        selected_index,
        "temporary folder playlist loaded",
    );

    Ok(AudioFolderPlaylist {
        directory_path: directory.to_string_lossy().into_owned(),
        directory_name: directory_name.clone(),
        source_kind: AudioPlaylistSourceKind::Folder,
        source_path: directory.to_string_lossy().into_owned(),
        source_name: directory_name,
        selected_index,
        tracks,
    })
}

fn load_first_directory_m3u8_playlist(
    directory: &Path,
    selected_id: Option<&str>,
) -> Result<Option<AudioFolderPlaylist>, AudioCommandError> {
    let entries = fs::read_dir(directory).map_err(|error| {
        tracing::warn!(
            operation = "audio.source.m3u8.discover",
            path = %directory.display(),
            error = %error,
            "failed to read directory for m3u8 discovery",
        );
        audio_error(
            AudioErrorCode::UnreadableFile,
            "Unable to read selected folder",
            true,
        )
    })?;

    let mut playlists = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && has_supported_m3u8_extension(path))
        .collect::<Vec<_>>();

    playlists.sort_by(|left, right| {
        file_name_string(left)
            .to_lowercase()
            .cmp(&file_name_string(right).to_lowercase())
            .then_with(|| file_name_string(left).cmp(&file_name_string(right)))
            .then_with(|| left.to_string_lossy().cmp(&right.to_string_lossy()))
    });

    for playlist_path in playlists {
        match load_m3u8_playlist(&playlist_path, selected_id, false) {
            Ok(playlist) => return Ok(Some(playlist)),
            Err(error)
                if matches!(
                    error.code,
                    AudioErrorCode::UnsupportedFormat | AudioErrorCode::UnreadableFile
                ) =>
            {
                tracing::info!(
                    operation = "audio.source.m3u8.discover",
                    path = %playlist_path.display(),
                    error_code = ?error.code,
                    "skipping unusable m3u8 playlist during folder discovery",
                );
            }
            Err(error) => return Err(error),
        }
    }

    Ok(None)
}

fn load_m3u8_playlist(
    playlist_path: &Path,
    selected_id: Option<&str>,
    allow_external_absolute_paths: bool,
) -> Result<AudioFolderPlaylist, AudioCommandError> {
    validate_existing_file(playlist_path)?;

    let playlist_path = playlist_path
        .canonicalize()
        .unwrap_or_else(|_| playlist_path.to_path_buf());
    let directory = playlist_path.parent().ok_or_else(|| {
        audio_error(
            AudioErrorCode::InvalidPath,
            "M3U8 playlist does not have a parent directory",
            true,
        )
    })?;
    let directory = directory
        .canonicalize()
        .unwrap_or_else(|_| directory.to_path_buf());
    let contents = fs::read_to_string(&playlist_path).map_err(|error| {
        tracing::warn!(
            operation = "audio.source.m3u8.read",
            path = %playlist_path.display(),
            error = %error,
            "failed to read m3u8 playlist",
        );
        audio_error(
            AudioErrorCode::UnreadableFile,
            "Unable to read M3U8 playlist",
            true,
        )
    })?;

    let mut seen = HashSet::new();
    let mut tracks = Vec::new();

    for raw_line in contents.lines() {
        let line = raw_line.trim().trim_start_matches('\u{feff}').trim();
        if line.is_empty() || line.starts_with('#') || is_remote_or_unsupported_uri(line) {
            continue;
        }

        let Some(candidate_path) =
            resolve_m3u8_entry_path(&directory, line, allow_external_absolute_paths)
        else {
            continue;
        };

        if !has_supported_audio_extension(&candidate_path) {
            continue;
        }

        let track = folder_track_ref(&candidate_path, candidate_path.is_file());
        if seen.insert(track.id.clone()) {
            tracks.push(track);
        }
    }

    if tracks.is_empty() {
        return Err(audio_error(
            AudioErrorCode::UnsupportedFormat,
            "M3U8 playlist does not contain supported local audio files",
            true,
        ));
    }

    let selected_index = selected_id
        .and_then(|selected_id| tracks.iter().position(|track| track.id == selected_id))
        .ok_or_else(|| {
            audio_error(
                AudioErrorCode::UnsupportedFormat,
                "Selected audio file is not in the M3U8 playlist",
                true,
            )
        })
        .or_else(|error| {
            if selected_id.is_some() {
                Err(error)
            } else {
                Ok(0)
            }
        })?;
    let directory_name = directory_display_name(&directory);
    let source_name = playlist_path
        .file_stem()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| file_name_string(&playlist_path));

    tracing::info!(
        operation = "audio.source.m3u8.load",
        path = %playlist_path.display(),
        track_count = tracks.len(),
        selected_index,
        "temporary m3u8 playlist loaded",
    );

    Ok(AudioFolderPlaylist {
        directory_path: directory.to_string_lossy().into_owned(),
        directory_name,
        source_kind: AudioPlaylistSourceKind::M3u8,
        source_path: playlist_path.to_string_lossy().into_owned(),
        source_name,
        selected_index,
        tracks,
    })
}

fn resolve_m3u8_entry_path(
    base_dir: &Path,
    entry: &str,
    allow_external_absolute_paths: bool,
) -> Option<PathBuf> {
    let raw_path = local_file_uri_to_path(entry).unwrap_or_else(|| PathBuf::from(entry));
    let is_absolute = raw_path.is_absolute();
    let candidate = if raw_path.is_absolute() {
        raw_path
    } else {
        base_dir.join(raw_path)
    };
    let canonical_base = base_dir.canonicalize().ok()?;
    let canonical_candidate = candidate
        .canonicalize()
        .unwrap_or_else(|_| normalize_path_lexically(&candidate));

    if canonical_candidate.starts_with(&canonical_base)
        || (allow_external_absolute_paths && is_absolute)
    {
        return Some(canonical_candidate);
    }

    None
}

fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }

    normalized
}

fn local_file_uri_to_path(entry: &str) -> Option<PathBuf> {
    let lower = entry.to_lowercase();
    if !lower.starts_with("file://") {
        return None;
    }

    let mut path = entry.get("file://".len()..)?.to_owned();
    if cfg!(windows) && path.starts_with('/') && path.as_bytes().get(2) == Some(&b':') {
        path.remove(0);
    }
    Some(PathBuf::from(path))
}

fn is_remote_or_unsupported_uri(entry: &str) -> bool {
    let lower = entry.to_lowercase();

    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("ftp://")
        || lower.starts_with("rtsp://")
        || lower.starts_with("rtmp://")
        || (lower.contains("://") && !lower.starts_with("file://"))
}

fn folder_track_ref(path: &Path, available: bool) -> AudioFolderTrackRef {
    AudioFolderTrackRef {
        id: track_id(path),
        source_path: path.to_string_lossy().into_owned(),
        file_name: file_name_string(path),
        available,
    }
}

fn file_name_string(path: &Path) -> String {
    path.file_name()
        .and_then(|file_name| file_name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn directory_display_name(directory: &Path) -> String {
    directory
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| directory.to_string_lossy().into_owned())
}

fn has_supported_audio_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUPPORTED_AUDIO_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

fn has_supported_m3u8_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUPPORTED_M3U8_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}
