use std::{
    collections::HashSet,
    fs::{self, File},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use lofty::{
    config::WriteOptions,
    file::{AudioFile, TaggedFileExt},
    picture::{Picture, PictureType},
    tag::{Accessor, ItemKey, Tag, TagType},
};
use rodio::Source;
use symphonia::core::{
    codecs::CODEC_TYPE_NULL, errors::Error as SymphoniaError, formats::FormatOptions,
    io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
};

use super::{
    error::{audio_error, AudioCommandError, AudioErrorCode},
    symphonia_source::SymphoniaAudioSource,
    types::{
        AudioCoverArt, AudioFileFilter, AudioFolderPlaylist, AudioFolderTrackRef,
        AudioPlaylistSourceKind, AudioTrackMetadata, AudioTrackRef,
    },
};

pub(crate) type AudioSource = Box<dyn Source<Item = i16> + Send>;

const SUPPORTED_AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "flac", "ogg", "oga", "opus", "aac", "m4a", "m4b", "mp4", "aif", "aiff", "caf",
    "mka", "mkv", "webm", "weba",
];
const SUPPORTED_M3U8_EXTENSIONS: &[&str] = &["m3u8"];

struct StereoDownmixSource {
    inner: SymphoniaAudioSource,
    input_channels: usize,
    pending: [i16; 2],
    pending_index: usize,
}

impl StereoDownmixSource {
    fn new(inner: SymphoniaAudioSource) -> Self {
        Self {
            input_channels: inner.channels() as usize,
            inner,
            pending: [0; 2],
            pending_index: 2,
        }
    }
}

impl Iterator for StereoDownmixSource {
    type Item = i16;

    fn next(&mut self) -> Option<Self::Item> {
        if self.pending_index < 2 {
            let sample = self.pending[self.pending_index];
            self.pending_index += 1;
            return Some(sample);
        }
        let mut frame = Vec::with_capacity(self.input_channels);
        for _ in 0..self.input_channels {
            frame.push(self.inner.next()?);
        }
        self.pending = downmix_frame_to_stereo(&frame);
        self.pending_index = 1;
        Some(self.pending[0])
    }
}

impl Source for StereoDownmixSource {
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len().map(|samples| {
            samples / self.input_channels * 2 + 2_usize.saturating_sub(self.pending_index)
        })
    }

    fn channels(&self) -> u16 {
        2
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        self.inner.try_seek(pos)?;
        self.pending_index = 2;
        Ok(())
    }
}

fn downmix_frame_to_stereo(frame: &[i16]) -> [i16; 2] {
    let sample = |index: usize| frame.get(index).copied().unwrap_or_default() as f32;
    let (left, right) = match frame.len() {
        0 => (0.0, 0.0),
        1 => (sample(0), sample(0)),
        2 => (sample(0), sample(1)),
        3 => (
            sample(0) + 0.707_106_77 * sample(2),
            sample(1) + 0.707_106_77 * sample(2),
        ),
        4 => (
            sample(0) + 0.707_106_77 * sample(2),
            sample(1) + 0.707_106_77 * sample(3),
        ),
        5 => (
            sample(0) + 0.707_106_77 * (sample(2) + sample(3)),
            sample(1) + 0.707_106_77 * (sample(2) + sample(4)),
        ),
        6 => (
            sample(0) + 0.707_106_77 * (sample(2) + sample(4)) + 0.316_227_76 * sample(3),
            sample(1) + 0.707_106_77 * (sample(2) + sample(5)) + 0.316_227_76 * sample(3),
        ),
        7 => (
            sample(0)
                + 0.707_106_77 * (sample(2) + sample(4) + sample(5))
                + 0.316_227_76 * sample(3),
            sample(1)
                + 0.707_106_77 * (sample(2) + sample(4) + sample(6))
                + 0.316_227_76 * sample(3),
        ),
        _ => (
            sample(0)
                + 0.707_106_77 * (sample(2) + sample(4) + sample(6))
                + 0.316_227_76 * sample(3),
            sample(1)
                + 0.707_106_77 * (sample(2) + sample(5) + sample(7))
                + 0.316_227_76 * sample(3),
        ),
    };
    // Fixed -6 dB headroom keeps common 5.1/7.1 programme material
    // inside i16 while retaining a deterministic clipping boundary.
    let to_i16 = |value: f32| {
        (value * 0.5)
            .round()
            .clamp(i16::MIN as f32, i16::MAX as f32) as i16
    };
    [to_i16(left), to_i16(right)]
}

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

pub(crate) fn input_path(input: &str) -> Result<PathBuf, AudioCommandError> {
    if input.trim().is_empty() {
        tracing::warn!(
            operation = "audio.source.input_path",
            "audio input path rejected because it is empty",
        );
        return Err(audio_error(
            AudioErrorCode::InvalidPath,
            "Audio path is empty",
            true,
        ));
    }

    Ok(PathBuf::from(input))
}

#[cfg(test)]
pub(crate) fn load_track_ref(path: &Path) -> Result<AudioTrackRef, AudioCommandError> {
    load_track_ref_with_options(path, true, None)
}

pub(crate) fn hydrate_track_ref(
    path: &Path,
    cover_cache_dir: Option<&Path>,
) -> Result<AudioTrackRef, AudioCommandError> {
    load_track_ref_with_options(path, true, cover_cache_dir)
}

fn load_track_ref_with_options(
    path: &Path,
    include_metadata: bool,
    cover_cache_dir: Option<&Path>,
) -> Result<AudioTrackRef, AudioCommandError> {
    let started_at = std::time::Instant::now();
    tracing::info!(
        operation = "audio.source.load_track_ref",
        path = %path.display(),
        include_metadata,
        "loading audio track reference",
    );

    validate_existing_file(path)?;
    // A container header or metadata tag alone is not enough to enter the
    // playlist as playable. Decode the first audio buffer now so unsupported
    // codecs and structurally damaged streams fail during Load rather than
    // leaving a track that only fails after the user presses Play.
    let playback_duration = open_source(path)?.total_duration();
    let duration = decode_duration(path)?.or(playback_duration);
    let metadata = if include_metadata {
        read_metadata_or_default(path, cover_cache_dir)
    } else {
        AudioTrackMetadata::default()
    };
    let track_id = track_id(path);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("audio")
        .to_string();

    tracing::info!(
        operation = "audio.source.load_track_ref",
        path = %path.display(),
        track_id = %track_id,
        file_name = %file_name,
        duration_ms = duration.map(duration_ms),
        include_metadata,
        metadata_title = metadata.title.as_deref(),
        metadata_artist = metadata.artist.as_deref(),
        metadata_album = metadata.album.as_deref(),
        has_lyrics = metadata.lyrics.is_some(),
        has_cover_art = metadata.cover_art.is_some(),
        cover_mime_type = metadata.cover_art.as_ref().map(|cover| cover.mime_type.as_str()),
        cover_byte_len = metadata.cover_art.as_ref().map(|cover| cover.byte_len),
        elapsed_ms = started_at.elapsed().as_millis(),
        "loaded audio track reference",
    );

    Ok(AudioTrackRef {
        id: track_id,
        source_path: path.to_string_lossy().into_owned(),
        file_name,
        duration_ms: duration.map(duration_ms),
        metadata,
    })
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
    let entries = fs::read_dir(&directory).map_err(|error| {
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

pub(crate) fn open_source(path: &Path) -> Result<AudioSource, AudioCommandError> {
    let started_at = std::time::Instant::now();
    tracing::info!(
        operation = "audio.source.open",
        path = %path.display(),
        decoder = "symphonia",
        "opening audio source",
    );
    SymphoniaAudioSource::open_path(path)
        .map(|source| {
            let total_duration = source.total_duration();
            let replay_gain = replay_gain_multiplier(path);
            let input_channels = source.channels();
            let source: AudioSource = if input_channels > 2 {
                Box::new(StereoDownmixSource::new(source))
            } else {
                Box::new(source)
            };
            tracing::info!(
                operation = "audio.source.open",
                path = %path.display(),
                decoder = "symphonia",
                elapsed_ms = started_at.elapsed().as_millis(),
                total_duration_ms = total_duration.map(duration_ms),
                replay_gain_multiplier = replay_gain,
                input_channels,
                output_channels = source.channels(),
                "opened audio source",
            );
            match replay_gain {
                Some(multiplier) => Box::new(source.amplify(multiplier)) as AudioSource,
                None => source,
            }
        })
        .map_err(|error| {
            tracing::warn!(
                operation = "audio.source.open",
                path = %path.display(),
                decoder = "symphonia",
                error = %error,
                elapsed_ms = started_at.elapsed().as_millis(),
                "failed to decode audio source",
            );
            audio_error(
                AudioErrorCode::UnsupportedFormat,
                format!("Failed to decode audio file with Symphonia: {error}"),
                true,
            )
        })
}

const REPLAY_GAIN_MIN_DB: f32 = -24.0;
const REPLAY_GAIN_MAX_DB: f32 = 12.0;

fn replay_gain_multiplier(path: &Path) -> Option<f32> {
    let tagged_file = lofty_read_content(path).ok()?;
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())?;
    let gain_db = [ItemKey::ReplayGainTrackGain, ItemKey::ReplayGainAlbumGain]
        .into_iter()
        .find_map(|key| tag_text(tag, key).and_then(|value| parse_replay_gain_db(&value)))?;
    let peak = [ItemKey::ReplayGainTrackPeak, ItemKey::ReplayGainAlbumPeak]
        .into_iter()
        .find_map(|key| tag_text(tag, key).and_then(|value| value.trim().parse::<f32>().ok()))
        .filter(|peak| peak.is_finite() && *peak > 0.0);

    Some(bounded_replay_gain_multiplier(gain_db, peak))
}

fn bounded_replay_gain_multiplier(gain_db: f32, peak: Option<f32>) -> f32 {
    let mut bounded_db = gain_db.clamp(REPLAY_GAIN_MIN_DB, REPLAY_GAIN_MAX_DB);
    if let Some(peak) = peak {
        let peak_limited_db = -20.0 * peak.log10();
        if peak_limited_db.is_finite() {
            bounded_db = bounded_db.min(peak_limited_db);
        }
    }
    10.0_f32.powf(bounded_db / 20.0)
}

fn parse_replay_gain_db(value: &str) -> Option<f32> {
    let number = value
        .trim()
        .strip_suffix("dB")
        .or_else(|| value.trim().strip_suffix("DB"))
        .or_else(|| value.trim().strip_suffix("db"))
        .unwrap_or(value.trim())
        .trim()
        .parse::<f32>()
        .ok()?;
    number.is_finite().then_some(number)
}

pub(crate) fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

fn validate_existing_file(path: &Path) -> Result<(), AudioCommandError> {
    if !path.exists() {
        tracing::warn!(
            operation = "audio.source.validate_file",
            path = %path.display(),
            "audio file validation failed: file not found",
        );
        return Err(audio_error(
            AudioErrorCode::FileNotFound,
            "Audio file does not exist",
            true,
        ));
    }

    if !path.is_file() {
        tracing::warn!(
            operation = "audio.source.validate_file",
            path = %path.display(),
            "audio file validation failed: path is not a file",
        );
        return Err(audio_error(
            AudioErrorCode::InvalidPath,
            "Audio path is not a file",
            true,
        ));
    }

    Ok(())
}

fn decode_duration(path: &Path) -> Result<Option<Duration>, AudioCommandError> {
    if is_adts_content(path) {
        match symphonia_scanned_duration(path) {
            Ok(Some(duration)) => {
                tracing::debug!(
                    operation = "audio.source.duration",
                    path = %path.display(),
                    duration_ms = duration_ms(duration),
                    provider = "symphonia-packet-scan",
                    "ADTS duration scan succeeded",
                );
                return Ok(Some(duration));
            }
            Ok(None) => {}
            Err(error) => tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                error = %error,
                "ADTS duration scan failed; using regular duration probes",
            ),
        }
    }

    // Use the same content probe and stream time base as playback first. In
    // particular, bitrate-based ADTS estimates can be hundreds of milliseconds
    // short even for a three-second file.
    match symphonia_duration(path) {
        Ok(Some(duration)) => {
            tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                duration_ms = duration_ms(duration),
                provider = "symphonia",
                "audio duration probe succeeded",
            );
            return Ok(Some(duration));
        }
        Ok(None) => {
            tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                "symphonia duration probe returned no duration, falling back to lofty",
            );
        }
        Err(error) => {
            tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                error = %error,
                "symphonia duration probe failed, falling back to lofty",
            );
        }
    }

    match lofty_duration(path) {
        Ok(Some(duration)) => {
            tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                duration_ms = duration_ms(duration),
                provider = "lofty",
                "audio duration probe succeeded",
            );
            Ok(Some(duration))
        }
        Ok(None) => {
            tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                "lofty duration probe returned no duration, falling back to playback source",
            );
            Ok(open_source(path)?.total_duration())
        }
        Err(error) => {
            tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                error = %error,
                "lofty duration probe failed, falling back to playback source",
            );
            Ok(open_source(path)?.total_duration())
        }
    }
}

fn is_adts_content(path: &Path) -> bool {
    use std::io::Read;

    let mut header = [0_u8; 2];
    File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .is_ok()
        && header[0] == 0xff
        && header[1] & 0xf6 == 0xf0
}

fn symphonia_scanned_duration(path: &Path) -> Result<Option<Duration>, SymphoniaError> {
    let file = Box::new(File::open(path)?);
    let media_source = MediaSourceStream::new(file, Default::default());
    let probed = symphonia::default::get_probe().format(
        &Hint::new(),
        media_source,
        &FormatOptions {
            enable_gapless: true,
            ..Default::default()
        },
        &MetadataOptions::default(),
    )?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .or_else(|| {
            format
                .tracks()
                .iter()
                .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        })
        .ok_or(SymphoniaError::Unsupported("no decodable audio track"))?;
    let track_id = track.id;
    let Some(time_base) = track.codec_params.time_base else {
        return Ok(None);
    };
    let mut final_ts = 0_u64;

    loop {
        match format.next_packet() {
            Ok(packet) if packet.track_id() == track_id => {
                final_ts = final_ts.max(packet.ts().saturating_add(packet.dur()));
            }
            Ok(_) => {}
            Err(SymphoniaError::IoError(error))
                if matches!(error.kind(), std::io::ErrorKind::UnexpectedEof) =>
            {
                break;
            }
            Err(error) => return Err(error),
        }
    }

    Ok((final_ts > 0).then(|| time_to_std_duration(time_base.calc_time(final_ts))))
}

fn time_to_std_duration(time: symphonia::core::units::Time) -> Duration {
    let nanos = (time.frac * 1_000_000_000.0)
        .round()
        .clamp(0.0, 999_999_999.0) as u32;
    Duration::new(time.seconds, nanos)
}

fn track_id(path: &Path) -> String {
    let stable_path = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_lowercase();
    let hash = blake3::hash(stable_path.as_bytes());
    format!("local-{}", &hash.to_hex()[..16])
}

fn lofty_duration(path: &Path) -> Result<Option<Duration>, lofty::error::LoftyError> {
    let tagged_file = lofty_read_content(path)?;
    let duration = tagged_file.properties().duration();

    Ok((!duration.is_zero()).then_some(duration))
}

fn read_metadata_or_default(path: &Path, cover_cache_dir: Option<&Path>) -> AudioTrackMetadata {
    let started_at = std::time::Instant::now();
    match lofty_metadata(path, cover_cache_dir) {
        Ok(mut metadata) => {
            let had_embedded_lyrics = metadata.lyrics.is_some();
            if metadata.lyrics.is_none() {
                if let Some(lyrics) = read_sidecar_lyrics(path) {
                    if let Err(error) = embed_lyrics(path, &lyrics) {
                        tracing::warn!(
                            operation = "audio.source.lyrics.embed",
                            path = %path.display(),
                            error = %error,
                            "sidecar lyrics loaded but could not be embedded into audio file",
                        );
                    }
                    metadata.lyrics = Some(lyrics);
                }
            }

            tracing::debug!(
                operation = "audio.source.metadata",
                path = %path.display(),
                title = metadata.title.as_deref(),
                artist = metadata.artist.as_deref(),
                album = metadata.album.as_deref(),
                has_embedded_lyrics = had_embedded_lyrics,
                has_lyrics = metadata.lyrics.is_some(),
                has_cover_art = metadata.cover_art.is_some(),
                cover_mime_type = metadata.cover_art.as_ref().map(|cover| cover.mime_type.as_str()),
                cover_byte_len = metadata.cover_art.as_ref().map(|cover| cover.byte_len),
                elapsed_ms = started_at.elapsed().as_millis(),
                "lofty metadata read succeeded",
            );
            metadata
        }
        Err(error) => {
            tracing::debug!(
                operation = "audio.source.metadata",
                path = %path.display(),
                error = %error,
                elapsed_ms = started_at.elapsed().as_millis(),
                "lofty metadata read failed, returning empty metadata",
            );
            let lyrics = read_sidecar_lyrics(path);
            if let Some(lyrics) = lyrics.as_deref() {
                if let Err(embed_error) = embed_lyrics(path, lyrics) {
                    tracing::warn!(
                        operation = "audio.source.lyrics.embed",
                        path = %path.display(),
                        error = %embed_error,
                        "sidecar lyrics loaded but could not be embedded into audio file",
                    );
                }
            }
            AudioTrackMetadata {
                lyrics,
                ..Default::default()
            }
        }
    }
}

fn lofty_metadata(
    path: &Path,
    cover_cache_dir: Option<&Path>,
) -> Result<AudioTrackMetadata, lofty::error::LoftyError> {
    let tagged_file = lofty_read_content(path)?;
    let Some(tag) = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
    else {
        tracing::debug!(
            operation = "audio.source.metadata",
            path = %path.display(),
            "audio file has no readable metadata tag",
        );
        return Ok(AudioTrackMetadata::default());
    };

    let mut metadata = metadata_from_tag(tag, cover_cache_dir);
    if metadata.lyrics.is_none() {
        metadata.lyrics = tagged_file.tags().iter().find_map(lyrics_from_tag);
    }

    Ok(metadata)
}

fn metadata_from_tag(tag: &Tag, cover_cache_dir: Option<&Path>) -> AudioTrackMetadata {
    AudioTrackMetadata {
        title: tag.title().map(cow_to_string),
        artist: tag.artist().map(cow_to_string),
        album: tag.album().map(cow_to_string),
        album_artist: tag_text(tag, ItemKey::AlbumArtist),
        genre: tag.genre().map(cow_to_string),
        year: tag.date().map(|timestamp| u32::from(timestamp.year)),
        track_number: tag.track(),
        disc_number: tag.disk(),
        comment: tag.comment().map(cow_to_string),
        lyrics: lyrics_from_tag(tag),
        cover_art: select_cover_art(tag)
            .map(|picture| cover_art_from_picture(picture, cover_cache_dir)),
    }
}

fn lyrics_from_tag(tag: &Tag) -> Option<String> {
    [ItemKey::Lyrics, ItemKey::UnsyncLyrics]
        .into_iter()
        .filter_map(|key| tag_text(tag, key))
        .find(|lyrics| !lyrics.trim().is_empty())
}

fn tag_text(tag: &Tag, key: ItemKey) -> Option<String> {
    tag.get_string(key).map(ToOwned::to_owned)
}

fn embed_lyrics(path: &Path, lyrics: &str) -> Result<(), String> {
    safe_update_tag(path, |tag, tag_type| {
        let lyrics_key = if tag_type == TagType::Id3v2 {
            ItemKey::UnsyncLyrics
        } else {
            ItemKey::Lyrics
        };
        tag.insert_text(lyrics_key, lyrics.to_owned());
    })?;

    tracing::info!(
        operation = "audio.source.lyrics.embed",
        path = %path.display(),
        lyric_byte_len = lyrics.len(),
        "sidecar lyrics embedded into audio file",
    );
    Ok(())
}

fn safe_update_tag(path: &Path, update: impl FnOnce(&mut Tag, TagType)) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "audio path has no parent directory".to_string())?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "audio path has no extension".to_string())?;
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("audio");
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = parent.join(format!(
        ".{stem}.spmusic-tag-{}-{unique}.{extension}",
        std::process::id()
    ));
    let backup = parent.join(format!(
        ".{stem}.spmusic-backup-{}-{unique}.{extension}",
        std::process::id()
    ));

    let result = (|| {
        fs::copy(path, &temporary)
            .map_err(|error| format!("failed to create tag update copy: {error}"))?;
        let mut tagged_file = lofty_read_content(&temporary)
            .map_err(|error| format!("failed to read tag update copy: {error}"))?;
        let tag_type = tagged_file.primary_tag_type();
        if tagged_file.primary_tag().is_none() {
            tagged_file.insert_tag(Tag::new(tag_type));
        }
        let tag = tagged_file
            .primary_tag_mut()
            .ok_or_else(|| "failed to create primary tag".to_string())?;
        update(tag, tag_type);
        tagged_file
            .save_to_path(&temporary, WriteOptions::default())
            .map_err(|error| format!("failed to write tag update copy: {error}"))?;

        // Re-probe the complete rewritten container before replacing the
        // original. Full decode integrity is covered by the compatibility
        // corpus tests without making ordinary tag edits scan long files.
        SymphoniaAudioSource::open_path(&temporary)
            .map_err(|error| format!("rewritten audio failed validation: {error}"))?;

        fs::rename(path, &backup)
            .map_err(|error| format!("failed to stage original audio file: {error}"))?;
        if let Err(error) = fs::rename(&temporary, path) {
            let rollback = fs::rename(&backup, path);
            return Err(format!(
                "failed to install rewritten audio: {error}; rollback={rollback:?}"
            ));
        }
        fs::remove_file(&backup)
            .map_err(|error| format!("tag update succeeded but backup cleanup failed: {error}"))?;
        Ok(())
    })();

    if temporary.exists() {
        let _ = fs::remove_file(&temporary);
    }
    if result.is_err() && backup.exists() && !path.exists() {
        let _ = fs::rename(&backup, path);
    }
    result
}

fn lofty_read_content(path: &Path) -> Result<lofty::file::TaggedFile, lofty::error::LoftyError> {
    lofty::probe::Probe::open(path)?.guess_file_type()?.read()
}

fn read_sidecar_lyrics(path: &Path) -> Option<String> {
    let lyrics_path = sidecar_lyrics_path(path)?;
    tracing::debug!(
        operation = "audio.source.lyrics.sidecar",
        path = %path.display(),
        lyrics_path = %lyrics_path.display(),
        "sidecar lyrics candidate found",
    );
    let bytes = match fs::read(&lyrics_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            tracing::debug!(
                operation = "audio.source.lyrics.sidecar",
                path = %lyrics_path.display(),
                error = %error,
                "sidecar lyrics read failed",
            );
            return None;
        }
    };
    let lyrics = String::from_utf8_lossy(&bytes).trim().to_string();
    tracing::debug!(
        operation = "audio.source.lyrics.sidecar",
        path = %lyrics_path.display(),
        byte_len = bytes.len(),
        is_empty = lyrics.is_empty(),
        "sidecar lyrics read succeeded",
    );

    (!lyrics.is_empty()).then_some(lyrics)
}

fn sidecar_lyrics_path(path: &Path) -> Option<PathBuf> {
    let direct_path = path.with_extension("lrc");
    if direct_path.exists() {
        tracing::debug!(
            operation = "audio.source.lyrics.sidecar",
            path = %path.display(),
            lyrics_path = %direct_path.display(),
            "matched direct sidecar lyrics path",
        );
        return Some(direct_path);
    }

    let parent = path.parent()?;
    let file_stem = path.file_stem()?.to_string_lossy();

    fs::read_dir(parent)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|candidate| {
            let candidate_stem = candidate.file_stem().and_then(|value| value.to_str());
            let candidate_extension = candidate.extension().and_then(|value| value.to_str());

            candidate_stem.is_some_and(|value| value.eq_ignore_ascii_case(&file_stem))
                && candidate_extension.is_some_and(|value| value.eq_ignore_ascii_case("lrc"))
        })
}

fn cow_to_string(value: std::borrow::Cow<'_, str>) -> String {
    value.into_owned()
}

fn select_cover_art(tag: &Tag) -> Option<&Picture> {
    tag.get_picture_type(PictureType::CoverFront)
        .or_else(|| tag.pictures().first())
}

fn cover_art_from_picture(picture: &Picture, cover_cache_dir: Option<&Path>) -> AudioCoverArt {
    let mime_type = picture
        .mime_type()
        .map(ToString::to_string)
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let data = picture.data();
    let file_path =
        cover_cache_dir.and_then(|cache_dir| cache_cover_art(cache_dir, &mime_type, data));
    tracing::debug!(
        operation = "audio.source.cover_art",
        mime_type = %mime_type,
        byte_len = data.len(),
        cached = file_path.is_some(),
        "loaded embedded cover art",
    );

    AudioCoverArt {
        mime_type: mime_type.clone(),
        file_path,
        data_url: Some(cover_art_data_url(&mime_type, data)),
        byte_len: data.len(),
    }
}

pub(crate) fn cover_art_data_url(mime_type: &str, data: &[u8]) -> String {
    format!("data:{mime_type};base64,{}", BASE64_STANDARD.encode(data))
}

fn cache_cover_art(cache_dir: &Path, mime_type: &str, data: &[u8]) -> Option<String> {
    let covers_dir = cache_dir.join("covers");
    if let Err(error) = fs::create_dir_all(&covers_dir) {
        tracing::warn!(
            operation = "audio.source.cover_art.cache",
            path = %covers_dir.display(),
            error = %error,
            "failed to create cover cache directory",
        );
        return None;
    }

    let extension = cover_extension(mime_type);
    let hash = blake3::hash(data);
    let cover_path = covers_dir.join(format!("{}.{}", hash.to_hex(), extension));

    if !cover_path.is_file() {
        if let Err(error) = fs::write(&cover_path, data) {
            tracing::warn!(
                operation = "audio.source.cover_art.cache",
                path = %cover_path.display(),
                error = %error,
                "failed to write cover cache file",
            );
            return None;
        }
    }

    Some(cover_path.to_string_lossy().into_owned())
}

fn cover_extension(mime_type: &str) -> &'static str {
    match mime_type.to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "bin",
    }
}

fn symphonia_duration(path: &Path) -> Result<Option<Duration>, SymphoniaError> {
    let file = Box::new(File::open(path)?);
    let media_source = MediaSourceStream::new(file, Default::default());
    let mut hint = Hint::new();

    if let Some(extension) = path.extension().and_then(|extension| extension.to_str()) {
        hint.with_extension(extension);
    }

    let format_options = FormatOptions {
        enable_gapless: true,
        ..Default::default()
    };
    let metadata_options = MetadataOptions::default();
    let probed = symphonia::default::get_probe().format(
        &hint,
        media_source,
        &format_options,
        &metadata_options,
    )?;
    let track = probed
        .format
        .default_track()
        .or_else(|| {
            probed
                .format
                .tracks()
                .iter()
                .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        })
        .ok_or(SymphoniaError::Unsupported("no decodable audio track"))?;

    let Some(time_base) = track.codec_params.time_base else {
        return Ok(None);
    };
    let Some(frame_count) = track.codec_params.n_frames else {
        return Ok(None);
    };

    let time = time_base.calc_time(frame_count);
    let nanos = (time.frac * 1_000_000_000.0)
        .round()
        .clamp(0.0, 999_999_999.0) as u32;

    Ok(Some(Duration::new(time.seconds, nanos)))
}

#[cfg(test)]
mod tests {
    use std::{
        process::Command,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    use super::*;
    use crate::audio::error::AudioErrorCode;

    fn write_silent_wav(path: &Path) {
        let sample_rate = 8_000_u32;
        let channels = 1_u16;
        let bits_per_sample = 16_u16;
        let samples = [0_i16; 8];
        let data_len = (samples.len() * size_of::<i16>()) as u32;
        let byte_rate = sample_rate * u32::from(channels) * u32::from(bits_per_sample) / 8;
        let block_align = channels * bits_per_sample / 8;
        let mut wav = Vec::with_capacity(44 + data_len as usize);

        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data_len).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&byte_rate.to_le_bytes());
        wav.extend_from_slice(&block_align.to_le_bytes());
        wav.extend_from_slice(&bits_per_sample.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_len.to_le_bytes());
        for sample in samples {
            wav.extend_from_slice(&sample.to_le_bytes());
        }

        std::fs::write(path, wav).expect("test WAV should be written");
    }

    fn generate_ffmpeg_corpus() -> Option<PathBuf> {
        let ffmpeg_path = std::env::var_os("SPMUSIC_FFMPEG_PATH")?;
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "spmusic-production-source-{}-{unique}",
            std::process::id()
        ));
        let output = root.join("generated");
        let manifest = root.join("manifest.json");
        std::fs::create_dir_all(&root).expect("temporary corpus directory should be created");

        let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri should have a repository parent");
        let generator = repository.join("tools/audio-compatibility/generate-fixtures.mjs");
        let result = Command::new("node")
            .arg(generator)
            .arg("generate")
            .arg("--require-ffmpeg")
            .arg("--ffmpeg")
            .arg(ffmpeg_path)
            .arg("--output")
            .arg(&output)
            .arg("--manifest")
            .arg(&manifest)
            .output()
            .expect("Node.js must be available to generate the compatibility corpus");
        assert!(
            result.status.success(),
            "fixture generator failed:\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );

        Some(root)
    }

    fn normalized_correlation(left: &[i16], right: &[i16]) -> f64 {
        let dot = left
            .iter()
            .zip(right)
            .map(|(&left, &right)| f64::from(left) * f64::from(right))
            .sum::<f64>();
        let left_energy = left
            .iter()
            .map(|&sample| f64::from(sample).powi(2))
            .sum::<f64>();
        let right_energy = right
            .iter()
            .map(|&sample| f64::from(sample).powi(2))
            .sum::<f64>();
        dot / (left_energy * right_energy).sqrt()
    }

    fn best_stereo_frame_alignment_with_limit(
        left: &[i16],
        right: &[i16],
        max_shift: isize,
    ) -> (isize, f64) {
        (-max_shift..=max_shift)
            .filter_map(|shift| {
                let sample_shift = shift * 2;
                let (left_start, right_start) = if sample_shift >= 0 {
                    (sample_shift as usize, 0)
                } else {
                    (0, (-sample_shift) as usize)
                };
                let len = left
                    .len()
                    .saturating_sub(left_start)
                    .min(right.len().saturating_sub(right_start));
                (len >= 128).then(|| {
                    (
                        shift,
                        normalized_correlation(
                            &left[left_start..left_start + len],
                            &right[right_start..right_start + len],
                        ),
                    )
                })
            })
            .max_by(|left, right| left.1.total_cmp(&right.1))
            .expect("alignment search should have candidates")
    }

    fn best_stereo_frame_alignment(left: &[i16], right: &[i16]) -> (isize, f64) {
        best_stereo_frame_alignment_with_limit(left, right, 128)
    }

    #[test]
    fn duration_ms_saturates_at_u64_max() {
        let duration = Duration::from_millis(u64::MAX).saturating_add(Duration::from_millis(1));

        assert_eq!(duration_ms(duration), u64::MAX);
    }

    #[test]
    fn input_path_rejects_blank_values() {
        let error = input_path("  ").expect_err("blank path should be rejected");

        assert_eq!(error.code, AudioErrorCode::InvalidPath);
        assert!(error.recoverable);
    }

    #[test]
    fn default_filters_include_verified_phase_two_extensions() {
        let filters = default_filters();
        let extensions = &filters[0].extensions;

        for extension in [
            "m4a", "m4b", "mp4", "aif", "aiff", "caf", "mka", "mkv", "ogg", "oga", "opus", "webm",
            "weba",
        ] {
            assert!(
                extensions.iter().any(|candidate| candidate == extension),
                "missing phase-two extension: {extension}"
            );
        }
    }

    #[test]
    fn folder_playlist_lists_supported_sibling_audio_in_stable_order() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-folder-playlist-{}-{}",
            std::process::id(),
            line!()
        ));
        let nested_dir = test_dir.join("nested");
        std::fs::create_dir_all(&nested_dir).expect("test directories should be created");

        let selected_path = test_dir.join("02 Selected.FLAC");
        for path in [
            test_dir.join("10 Outro.opus"),
            test_dir.join("01 Intro.mp3"),
            selected_path.clone(),
            test_dir.join("03 Notes.txt"),
            nested_dir.join("00 Nested.mp3"),
        ] {
            std::fs::write(path, []).expect("test file should be written");
        }

        let playlist =
            load_folder_playlist(&selected_path).expect("folder playlist should be created");
        let file_names = playlist
            .tracks
            .iter()
            .map(|track| track.file_name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            file_names,
            vec!["01 Intro.mp3", "02 Selected.FLAC", "10 Outro.opus"]
        );
        assert_eq!(playlist.selected_index, 1);
        assert_eq!(playlist.tracks[1].id, track_id(&selected_path));
        assert_eq!(
            playlist.directory_name,
            test_dir
                .file_name()
                .and_then(|name| name.to_str())
                .expect("test directory should have a name")
        );

        std::fs::remove_dir_all(test_dir).expect("test directory should be removed");
    }

    #[test]
    fn m3u8_file_selection_builds_playlist_from_file_contents() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-m3u8-file-selection-{}-{}",
            std::process::id(),
            line!()
        ));
        let outside_dir = std::env::temp_dir().join(format!(
            "spmusic-m3u8-file-selection-outside-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");
        std::fs::create_dir_all(&outside_dir).expect("outside directory should be created");

        for path in [test_dir.join("alpha.wav"), test_dir.join("beta.mp3")] {
            std::fs::write(path, []).expect("test audio file should be written");
        }
        let outside_path = outside_dir.join("external.flac");
        std::fs::write(&outside_path, []).expect("external audio should be written");
        let playlist_path = test_dir.join("chosen.m3u8");
        std::fs::write(
            &playlist_path,
            format!(
                "#EXTM3U\n#EXTINF:1,External\n{}\nhttps://example.invalid/live.m3u8\nbeta.mp3\nalpha.wav\n",
                outside_path.display()
            ),
        )
        .expect("m3u8 playlist should be written");

        let playlist = load_folder_playlist(&playlist_path)
            .expect("direct m3u8 file selection should build a playlist");
        let file_names = playlist
            .tracks
            .iter()
            .map(|track| track.file_name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(playlist.source_kind, AudioPlaylistSourceKind::M3u8);
        assert_eq!(
            playlist.source_path,
            playlist_path
                .canonicalize()
                .expect("playlist path should canonicalize")
                .to_string_lossy()
        );
        assert_eq!(playlist.source_name, "chosen");
        assert_eq!(playlist.selected_index, 0);
        assert_eq!(file_names, vec!["external.flac", "beta.mp3", "alpha.wav"]);
        assert!(playlist.tracks.iter().all(|track| track.available));

        std::fs::remove_dir_all(test_dir).expect("test directory should be removed");
        std::fs::remove_dir_all(outside_dir).expect("outside directory should be removed");
    }

    #[test]
    fn m3u8_file_selection_keeps_missing_local_audio_entries() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-m3u8-missing-entries-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");

        std::fs::write(test_dir.join("present.wav"), []).expect("present audio should be written");
        let playlist_path = test_dir.join("chosen.m3u8");
        std::fs::write(&playlist_path, "missing.mp3\npresent.wav\n")
            .expect("m3u8 playlist should be written");

        let playlist = load_folder_playlist(&playlist_path)
            .expect("direct m3u8 file selection should keep missing entries");

        assert_eq!(playlist.tracks.len(), 2);
        assert_eq!(playlist.tracks[0].file_name, "missing.mp3");
        assert!(!playlist.tracks[0].available);
        assert_eq!(playlist.tracks[1].file_name, "present.wav");
        assert!(playlist.tracks[1].available);

        std::fs::remove_dir_all(test_dir).expect("test directory should be removed");
    }

    #[test]
    fn folder_playlist_uses_m3u8_selected_index_when_audio_is_listed() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-folder-m3u8-selected-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");

        let selected_path = test_dir.join("02 Selected.wav");
        for path in [
            test_dir.join("01 Intro.mp3"),
            selected_path.clone(),
            test_dir.join("03 Outro.flac"),
        ] {
            std::fs::write(path, []).expect("test file should be written");
        }
        std::fs::write(
            test_dir.join("playlist.m3u8"),
            "03 Outro.flac\n02 Selected.wav\n01 Intro.mp3\n",
        )
        .expect("m3u8 playlist should be written");

        let playlist = load_folder_playlist(&selected_path)
            .expect("selected audio should resolve against the m3u8 playlist");

        assert_eq!(playlist.source_kind, AudioPlaylistSourceKind::M3u8);
        assert_eq!(playlist.selected_index, 1);
        assert_eq!(playlist.tracks[1].id, track_id(&selected_path));

        std::fs::remove_dir_all(test_dir).expect("test directory should be removed");
    }

    #[test]
    fn folder_playlist_falls_back_when_m3u8_does_not_contain_selected_audio() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-folder-m3u8-fallback-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");

        let selected_path = test_dir.join("02 Selected.wav");
        for path in [
            test_dir.join("01 Listed.mp3"),
            selected_path.clone(),
            test_dir.join("03 Outro.flac"),
        ] {
            std::fs::write(path, []).expect("test file should be written");
        }
        std::fs::write(test_dir.join("playlist.m3u8"), "01 Listed.mp3\n")
            .expect("m3u8 playlist should be written");

        let playlist = load_folder_playlist(&selected_path)
            .expect("selected audio should fall back to folder scan");

        assert_eq!(playlist.source_kind, AudioPlaylistSourceKind::Folder);
        assert_eq!(playlist.selected_index, 1);
        assert_eq!(playlist.tracks[1].id, track_id(&selected_path));

        std::fs::remove_dir_all(test_dir).expect("test directory should be removed");
    }

    #[test]
    fn sibling_m3u8_discovery_rejects_entries_outside_selected_folder() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-folder-m3u8-boundary-{}-{}",
            std::process::id(),
            line!()
        ));
        let outside_dir = std::env::temp_dir().join(format!(
            "spmusic-folder-m3u8-outside-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");
        std::fs::create_dir_all(&outside_dir).expect("outside directory should be created");

        let inside_path = test_dir.join("inside.wav");
        let outside_path = outside_dir.join("outside.wav");
        std::fs::write(&inside_path, []).expect("inside audio should be written");
        std::fs::write(&outside_path, []).expect("outside audio should be written");
        std::fs::write(
            test_dir.join("playlist.m3u8"),
            format!("{}\ninside.wav\n", outside_path.display()),
        )
        .expect("m3u8 playlist should be written");

        let playlist = load_folder_playlist(&inside_path)
            .expect("m3u8 playlist should keep in-folder entries");

        assert_eq!(playlist.tracks.len(), 1);
        assert_eq!(playlist.tracks[0].id, track_id(&inside_path));

        std::fs::remove_dir_all(test_dir).expect("test directory should be removed");
        std::fs::remove_dir_all(outside_dir).expect("outside directory should be removed");
    }

    #[test]
    fn folder_playlist_rejects_selected_file_with_unsupported_extension() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-folder-playlist-unsupported-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");
        let selected_path = test_dir.join("notes.txt");
        std::fs::write(&selected_path, []).expect("test file should be written");

        let error = load_folder_playlist(&selected_path)
            .expect_err("unsupported selected file should not create a playlist");

        assert_eq!(error.code, AudioErrorCode::UnsupportedFormat);
        assert!(error.recoverable);

        std::fs::remove_dir_all(test_dir).expect("test directory should be removed");
    }

    #[test]
    fn production_source_decodes_and_seeks_extended_formats() {
        let Some(corpus_root) = generate_ffmpeg_corpus() else {
            return;
        };
        let generated = corpus_root.join("generated");

        for (file_name, sample_rate, channels) in [
            ("mp3-cbr.mp3", 44_100, 2),
            ("mp3-vbr.mp3", 44_100, 2),
            ("flac-16.flac", 44_100, 2),
            ("flac-24.flac", 48_000, 2),
            ("aac-adts.aac", 44_100, 2),
            ("m4a-aac.m4a", 44_100, 2),
            ("m4a-alac.m4a", 48_000, 2),
            ("mp4-aac.mp4", 44_100, 2),
            ("m4b-aac.m4b", 44_100, 2),
            ("aiff-pcm16.aiff", 44_100, 2),
            ("caf-pcm16.caf", 44_100, 2),
            ("ogg-vorbis.ogg", 44_100, 2),
            ("oga-vorbis.oga", 44_100, 2),
            ("mka-flac.mka", 44_100, 2),
            ("webm-vorbis.webm", 44_100, 2),
            ("ogg-opus.ogg", 48_000, 2),
            ("opus-extension.opus", 48_000, 2),
            ("webm-opus.webm", 48_000, 2),
            ("weba-opus.weba", 48_000, 2),
            ("wav-pcm24-88200.wav", 88_200, 2),
            ("wav-f32-96000.wav", 96_000, 2),
            ("wav-pcm24-176400.wav", 176_400, 2),
            ("wav-f32-192000.wav", 192_000, 2),
            ("wav-pcm16-12345.wav", 12_345, 1),
            ("flac-24-192000.flac", 192_000, 2),
        ] {
            let path = generated.join(file_name);
            let mut source = open_source(&path).expect("phase-two format should open");
            assert_eq!(source.sample_rate(), sample_rate, "{file_name} sample rate");
            assert_eq!(source.channels(), channels, "{file_name} channel count");
            let duration_ms = source
                .total_duration()
                .unwrap_or_else(|| panic!("{file_name} should report duration"))
                .as_millis() as i64;
            assert!(
                duration_ms > 900
                    && (file_name.starts_with("wav-")
                        || file_name == "flac-24-192000.flac"
                        || (duration_ms - 3_000).abs() <= 150),
                "{file_name} duration {duration_ms} ms exceeds tolerance"
            );
            assert!(
                source.by_ref().take(sample_rate as usize).count() > 0,
                "{file_name} should produce decoded samples"
            );
        }

        for file_name in [
            "mp3-cbr.mp3",
            "mp3-vbr.mp3",
            "flac-16.flac",
            "flac-24.flac",
            "aac-adts.aac",
            "m4a-aac.m4a",
            "m4a-alac.m4a",
            "mp4-aac.mp4",
            "m4b-aac.m4b",
            "aiff-pcm16.aiff",
            "caf-pcm16.caf",
            "ogg-vorbis.ogg",
            "oga-vorbis.oga",
            "mka-flac.mka",
            "webm-vorbis.webm",
            "ogg-opus.ogg",
            "opus-extension.opus",
            "webm-opus.webm",
            "weba-opus.weba",
        ] {
            let path = generated.join(file_name);
            let mut reference =
                open_source(&path).expect("phase-two format should open for seek reference");
            let reference_sample_rate = reference.sample_rate();
            let reference_channels = reference.channels();
            let samples_to_target =
                (reference_sample_rate as usize * reference_channels as usize * 3) / 2;
            assert_eq!(
                reference.by_ref().take(samples_to_target).count(),
                samples_to_target,
                "{file_name} should reach the seek reference position"
            );
            let expected_after_seek: Vec<_> = reference.take(8_192).collect();

            let mut seekable = open_source(&path).expect("phase-two format should reopen");
            seekable
                .try_seek(Duration::from_millis(1_500))
                .unwrap_or_else(|error| panic!("{file_name} seek failed: {error}"));
            let actual_after_seek: Vec<_> = seekable.take(8_192).collect();
            if matches!(
                file_name,
                "mp3-cbr.mp3"
                    | "mp3-vbr.mp3"
                    | "aac-adts.aac"
                    | "m4a-aac.m4a"
                    | "mp4-aac.mp4"
                    | "m4b-aac.m4b"
                    | "ogg-vorbis.ogg"
                    | "oga-vorbis.oga"
                    | "webm-vorbis.webm"
                    | "ogg-opus.ogg"
                    | "opus-extension.opus"
                    | "webm-opus.webm"
                    | "weba-opus.weba"
            ) {
                let search_limit = if file_name.starts_with("mp3-") {
                    2_048
                } else {
                    240
                };
                let (frame_shift, correlation) = best_stereo_frame_alignment_with_limit(
                    &actual_after_seek,
                    &expected_after_seek,
                    search_limit,
                );
                let max_shift = if file_name.starts_with("mp3-") {
                    // MPEG Layer III seeks are bounded by one 1152-sample
                    // codec frame when the stream index cannot name an
                    // arbitrary PCM sample.
                    1_152
                } else {
                    240
                };
                assert!(
                    correlation >= 0.95 && frame_shift.abs() <= max_shift,
                    "{file_name} seek output is not aligned with the requested frame: correlation={correlation}, frame_shift={frame_shift}"
                );
            } else {
                assert_eq!(
                    actual_after_seek, expected_after_seek,
                    "{file_name} should continue from the exact requested audio frame"
                );
            }
        }

        for file_name in ["ogg-opus.ogg", "webm-opus.webm"] {
            let bytes =
                std::fs::read(generated.join(file_name)).expect("Opus fixture should be readable");
            let truncated_path = corpus_root.join(format!("truncated-{file_name}"));
            std::fs::write(&truncated_path, &bytes[..bytes.len().min(32)])
                .expect("truncated Opus fixture should be written");
            let result = std::panic::catch_unwind(|| open_source(&truncated_path).map(|_| ()));
            assert!(result.is_ok(), "{file_name} truncated input must not panic");
            let error = result
                .expect("truncated Opus open should return normally")
                .expect_err("truncated Opus input must fail");
            assert!(error.recoverable, "{file_name} error should be recoverable");
        }

        let audiobook_path = generated.join("ogg-opus-long-audiobook.opus");
        let mut audiobook =
            open_source(&audiobook_path).expect("long audiobook fixture should open");
        let audiobook_duration = audiobook
            .total_duration()
            .expect("long audiobook should report duration");
        assert!(
            audiobook_duration.abs_diff(Duration::from_secs(1_800)) <= Duration::from_millis(100),
            "long audiobook duration was {audiobook_duration:?}"
        );
        let seek_started = Instant::now();
        audiobook
            .try_seek(Duration::from_secs(1_620))
            .expect("long audiobook should seek to 90%");
        let seek_elapsed = seek_started.elapsed();
        assert!(
            seek_elapsed < Duration::from_millis(100),
            "long audiobook indexed seek took {seek_elapsed:?}"
        );
        assert_eq!(
            audiobook.take(4_096).count(),
            4_096,
            "long audiobook should decode after a large seek"
        );

        std::fs::remove_dir_all(corpus_root).expect("temporary corpus should be removed");
    }

    #[test]
    fn indexed_seek_avoids_decoding_a_long_opus_file_from_the_start() {
        let Some(ffmpeg_path) = std::env::var_os("SPMUSIC_FFMPEG_PATH") else {
            return;
        };
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "spmusic-long-indexed-seek-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("long seek test directory should be created");
        let path = root.join("long-ogg-opus.ogg");
        let generated = Command::new(ffmpeg_path)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=120",
                "-c:a",
                "libopus",
                "-b:a",
                "64k",
                "-ac",
                "2",
                "-f",
                "ogg",
            ])
            .arg(&path)
            .status()
            .expect("FFmpeg should generate the long seek fixture");
        assert!(generated.success(), "long Opus fixture generation failed");

        let target = Duration::from_secs(108);
        let mut indexed =
            SymphoniaAudioSource::open_path(&path).expect("long Opus fixture should open");
        let indexed_started = Instant::now();
        indexed
            .try_seek(target)
            .expect("long Opus fixture indexed seek should succeed");
        let indexed_elapsed = indexed_started.elapsed();
        let indexed_samples: Vec<_> = indexed.take(2_048).collect();

        let mut linear =
            SymphoniaAudioSource::open_path(&path).expect("long Opus fixture should reopen");
        let linear_started = Instant::now();
        linear
            .linear_seek(target)
            .expect("long Opus fixture linear reference seek should succeed");
        let linear_elapsed = linear_started.elapsed();
        let linear_samples: Vec<_> = linear.take(2_048).collect();
        let (frame_shift, correlation) =
            best_stereo_frame_alignment(&indexed_samples, &linear_samples);

        eprintln!(
            "long Ogg/Opus seek: indexed={}ms, linear={}ms, speedup={:.1}x, correlation={correlation:.6}, frame_shift={frame_shift}",
            indexed_elapsed.as_millis(),
            linear_elapsed.as_millis(),
            linear_elapsed.as_secs_f64() / indexed_elapsed.as_secs_f64(),
        );
        assert!(
            indexed_elapsed * 5 < linear_elapsed,
            "indexed seek should be at least 5x faster than decoding 108 seconds linearly"
        );
        assert!(
            correlation >= 0.95 && frame_shift.abs() <= 120,
            "indexed long seek should remain aligned with the linear reference"
        );

        std::fs::remove_dir_all(root).expect("long seek test directory should be removed");
    }

    #[test]
    fn matroska_cues_seek_long_audio_under_one_hundred_milliseconds() {
        let Some(ffmpeg_path) = std::env::var_os("SPMUSIC_FFMPEG_PATH") else {
            return;
        };
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "spmusic-long-matroska-seek-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("Matroska seek test directory should be created");

        for (file_name, codec_args) in [
            ("long-mka-flac.mka", &["-c:a", "flac", "-f", "matroska"][..]),
            (
                "long-webm-vorbis.webm",
                &["-c:a", "libvorbis", "-q:a", "4", "-f", "webm"][..],
            ),
            (
                "long-webm-opus.webm",
                &["-c:a", "libopus", "-b:a", "64k", "-f", "webm"][..],
            ),
        ] {
            let path = root.join(file_name);
            let generated = Command::new(&ffmpeg_path)
                .args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:sample_rate=48000:duration=120",
                    "-ac",
                    "2",
                ])
                .args(codec_args)
                .arg(&path)
                .status()
                .expect("FFmpeg should generate Matroska seek fixture");
            assert!(generated.success(), "{file_name} generation failed");

            let target = Duration::from_secs(108);
            let mut indexed =
                SymphoniaAudioSource::open_path(&path).expect("Matroska fixture should open");
            let indexed_started = Instant::now();
            indexed
                .try_seek(target)
                .unwrap_or_else(|error| panic!("{file_name} indexed seek failed: {error}"));
            let indexed_elapsed = indexed_started.elapsed();
            let indexed_samples: Vec<_> = indexed.take(2_048).collect();

            let mut linear =
                SymphoniaAudioSource::open_path(&path).expect("Matroska fixture should reopen");
            let linear_started = Instant::now();
            linear
                .linear_seek(target)
                .unwrap_or_else(|error| panic!("{file_name} linear reference failed: {error}"));
            let linear_elapsed = linear_started.elapsed();
            let linear_samples: Vec<_> = linear.take(2_048).collect();
            let (frame_shift, correlation) =
                best_stereo_frame_alignment(&indexed_samples, &linear_samples);
            eprintln!(
                "{file_name}: indexed={}ms, linear={}ms, correlation={correlation:.6}, frame_shift={frame_shift}",
                indexed_elapsed.as_millis(),
                linear_elapsed.as_millis(),
            );

            assert!(
                indexed_elapsed < Duration::from_millis(100),
                "{file_name} indexed seek exceeded 100 ms"
            );
            assert!(
                correlation >= 0.95 && frame_shift.abs() <= 240,
                "{file_name} seek exceeded the 5 ms alignment tolerance"
            );
            if file_name.ends_with(".mka") {
                assert_eq!(
                    indexed_samples, linear_samples,
                    "lossless MKA/FLAC seek must be sample exact"
                );
            }
        }

        let indexed_path = root.join("long-webm-opus.webm");
        let indexed_bytes =
            std::fs::read(&indexed_path).expect("indexed WebM fixture should be readable");
        let cues_id = [0x1c, 0x53, 0xbb, 0x6b];
        let cues_offset = indexed_bytes
            .windows(cues_id.len())
            .rposition(|window| window == cues_id)
            .expect("WebM fixture should contain a Cues element");
        let corrupt_path = root.join("corrupt-cues-webm-opus.webm");
        let mut corrupt_bytes = indexed_bytes.clone();
        let cue_cluster_position = corrupt_bytes[cues_offset..]
            .iter()
            .position(|&byte| byte == 0xf1)
            .map(|offset| cues_offset + offset)
            .expect("Cues should contain CueClusterPosition");
        let encoded_size = corrupt_bytes[cue_cluster_position + 1];
        assert_ne!(
            encoded_size & 0x80,
            0,
            "fixture should use a one-byte EBML size"
        );
        let position_len = usize::from(encoded_size & 0x7f);
        corrupt_bytes[cue_cluster_position + 2..cue_cluster_position + 2 + position_len].fill(0xff);
        std::fs::write(&corrupt_path, corrupt_bytes)
            .expect("corrupt Cues fixture should be written");
        let corrupt_result = std::panic::catch_unwind(|| {
            let mut source = SymphoniaAudioSource::open_path(&corrupt_path)
                .expect("audio before Cues should open");
            source.try_seek(Duration::from_secs(108))
        });
        assert!(corrupt_result.is_ok(), "corrupt Cues must not panic");
        assert!(
            corrupt_result
                .expect("corrupt Cues seek should return normally")
                .is_ok(),
            "corrupt Cues should fall back to linear seek"
        );

        let no_index_path = root.join("no-index-webm-opus.webm");
        let no_index_generated = Command::new(&ffmpeg_path)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=12",
                "-ac",
                "2",
                "-c:a",
                "libopus",
                "-write_index",
                "0",
                "-f",
                "webm",
            ])
            .arg(&no_index_path)
            .status()
            .expect("FFmpeg should generate no-index WebM fixture");
        assert!(
            no_index_generated.success(),
            "no-index WebM generation failed"
        );
        let no_index_result = std::panic::catch_unwind(|| {
            let mut source =
                SymphoniaAudioSource::open_path(&no_index_path).expect("no-index WebM should open");
            source.try_seek(Duration::from_secs(10))
        });
        assert!(no_index_result.is_ok(), "no-index WebM must not panic");
        assert!(
            no_index_result
                .expect("no-index seek should return normally")
                .is_ok(),
            "no-index WebM should fall back to a linear scan"
        );

        std::fs::remove_dir_all(root).expect("Matroska seek test directory should be removed");
    }

    #[test]
    fn load_track_ref_rejects_missing_files_before_decode() {
        let missing = std::env::temp_dir().join(format!(
            "spmusic-missing-audio-{}-{}.mp3",
            std::process::id(),
            line!()
        ));

        let error = load_track_ref(&missing).expect_err("missing file should be rejected");

        assert_eq!(error.code, AudioErrorCode::FileNotFound);
        assert!(error.recoverable);
    }

    #[test]
    fn load_track_ref_rejects_header_only_damaged_audio() {
        let root = std::env::temp_dir().join(format!(
            "spmusic-damaged-load-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&root).expect("test directory should be created");
        let path = root.join("damaged.wav");
        write_silent_wav(&path);
        let bytes = std::fs::read(&path).expect("WAV should be readable");
        std::fs::write(&path, &bytes[..44]).expect("WAV should be truncated to its header");

        let result = std::panic::catch_unwind(|| load_track_ref(&path));
        assert!(result.is_ok(), "damaged audio load must not panic");
        let error = result
            .expect("damaged audio load should return normally")
            .expect_err("header-only audio must not enter the playable state");
        assert_eq!(error.code, AudioErrorCode::UnsupportedFormat);
        assert!(error.recoverable);

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn cover_art_data_url_prefixes_mime_type_and_base64_data() {
        let data_url = cover_art_data_url("image/png", b"cover");

        assert_eq!(data_url, "data:image/png;base64,Y292ZXI=");
    }

    #[test]
    fn read_sidecar_lyrics_finds_same_stem_lrc_file() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-sidecar-lyrics-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");

        let audio_path = test_dir.join("song.mp3");
        let lyrics_path = test_dir.join("song.lrc");
        std::fs::write(&lyrics_path, "[00:01.00]hello").expect("lyrics file should be written");

        assert_eq!(
            read_sidecar_lyrics(&audio_path).as_deref(),
            Some("[00:01.00]hello")
        );

        std::fs::remove_dir_all(&test_dir).expect("test directory should be removed");
    }

    #[test]
    fn sidecar_lyrics_are_loaded_and_embedded_for_future_reads() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-embed-sidecar-lyrics-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");

        let audio_path = test_dir.join("song.wav");
        let lyrics_path = test_dir.join("song.lrc");
        let lyrics = "[00:01.00]hello\u{2009}你好";
        write_silent_wav(&audio_path);
        std::fs::write(&lyrics_path, lyrics).expect("lyrics file should be written");

        let metadata = read_metadata_or_default(&audio_path, None);
        assert_eq!(metadata.lyrics.as_deref(), Some(lyrics));

        std::fs::remove_file(&lyrics_path).expect("sidecar lyrics should be removable");
        let embedded_metadata =
            lofty_metadata(&audio_path, None).expect("embedded metadata should be readable");
        assert_eq!(embedded_metadata.lyrics.as_deref(), Some(lyrics));

        std::fs::remove_dir_all(&test_dir).expect("test directory should be removed");
    }

    #[test]
    fn embedded_lyrics_take_precedence_over_sidecar_lyrics() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-embedded-lyrics-priority-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");

        let audio_path = test_dir.join("song.wav");
        let lyrics_path = test_dir.join("song.lrc");
        write_silent_wav(&audio_path);
        embed_lyrics(&audio_path, "[00:01.00]embedded").expect("embedded lyrics should be written");
        std::fs::write(&lyrics_path, "[00:01.00]sidecar")
            .expect("sidecar lyrics should be written");

        let metadata = read_metadata_or_default(&audio_path, None);
        assert_eq!(metadata.lyrics.as_deref(), Some("[00:01.00]embedded"));

        std::fs::remove_dir_all(&test_dir).expect("test directory should be removed");
    }

    #[test]
    fn supported_music_tags_cover_and_lyrics_write_back_without_audio_damage() {
        use lofty::picture::MimeType;

        let Some(corpus_root) = generate_ffmpeg_corpus() else {
            return;
        };
        let generated = corpus_root.join("generated");
        let cover_bytes = vec![
            0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, b'I', b'H', b'D', b'R',
            0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0,
        ];

        for file_name in [
            "mp3-vbr.mp3",
            "flac-24.flac",
            "m4a-aac.m4a",
            "m4a-alac.m4a",
            "ogg-vorbis.ogg",
            "ogg-opus.ogg",
        ] {
            let path = generated.join(file_name);
            let samples_before = open_source(&path)
                .unwrap_or_else(|error| panic!("{file_name} should decode before write: {error}"))
                .count();
            safe_update_tag(&path, |tag, tag_type| {
                tag.set_title("SpMusic metadata round-trip".to_string());
                tag.set_artist("Synthetic Artist".to_string());
                tag.set_album("Compatibility Corpus".to_string());
                tag.insert_text(
                    if tag_type == TagType::Id3v2 {
                        ItemKey::UnsyncLyrics
                    } else {
                        ItemKey::Lyrics
                    },
                    "[00:01.00]hello\u{2009}你好".to_string(),
                );
                tag.remove_picture_type(PictureType::CoverFront);
                tag.push_picture(
                    Picture::unchecked(cover_bytes.clone())
                        .pic_type(PictureType::CoverFront)
                        .mime_type(MimeType::Png)
                        .build(),
                );
            })
            .unwrap_or_else(|error| panic!("{file_name} metadata write failed: {error}"));

            let metadata = lofty_metadata(&path, None)
                .unwrap_or_else(|error| panic!("{file_name} metadata read failed: {error}"));
            assert_eq!(
                metadata.title.as_deref(),
                Some("SpMusic metadata round-trip"),
                "{file_name} title"
            );
            assert_eq!(
                metadata.artist.as_deref(),
                Some("Synthetic Artist"),
                "{file_name} artist"
            );
            assert_eq!(
                metadata.lyrics.as_deref(),
                Some("[00:01.00]hello\u{2009}你好"),
                "{file_name} lyrics"
            );
            let cover = metadata
                .cover_art
                .unwrap_or_else(|| panic!("{file_name} cover should round-trip"));
            assert_eq!(cover.mime_type, "image/png", "{file_name} cover MIME");
            assert_eq!(
                cover.byte_len,
                cover_bytes.len(),
                "{file_name} cover length"
            );

            let samples_after = open_source(&path)
                .unwrap_or_else(|error| panic!("{file_name} should decode after write: {error}"))
                .count();
            assert_eq!(
                samples_after, samples_before,
                "{file_name} decoded sample count changed after metadata write"
            );
        }

        std::fs::remove_dir_all(corpus_root).expect("temporary corpus should be removed");
    }

    #[test]
    fn replay_gain_reads_standard_tags_and_clamps_gain_and_peak() {
        assert_eq!(parse_replay_gain_db("+6.00 dB"), Some(6.0));
        assert_eq!(parse_replay_gain_db("not-a-number"), None);
        assert!(
            (bounded_replay_gain_multiplier(99.0, None) - 3.981_071_7).abs() < 0.000_1,
            "positive gain must be capped at +12 dB"
        );
        assert!(
            (bounded_replay_gain_multiplier(-99.0, None) - 0.063_095_73).abs() < 0.000_1,
            "negative gain must be capped at -24 dB"
        );
        assert!(
            (bounded_replay_gain_multiplier(6.0, Some(2.0)) - 0.5).abs() < 0.000_1,
            "declared peak must prevent clipping"
        );

        let Some(corpus_root) = generate_ffmpeg_corpus() else {
            return;
        };
        let path = corpus_root.join("generated/flac-16.flac");
        safe_update_tag(&path, |tag, _| {
            tag.insert_text(ItemKey::ReplayGainTrackGain, "+6.00 dB".to_string());
            tag.insert_text(ItemKey::ReplayGainTrackPeak, "2.000000".to_string());
        })
        .expect("ReplayGain tags should be written");
        let multiplier = replay_gain_multiplier(&path).expect("ReplayGain should be read");
        assert!((multiplier - 0.5).abs() < 0.000_1);
        assert_eq!(
            open_source(&path)
                .expect("ReplayGain source should open")
                .count(),
            44_100 * 3 * 2,
            "gain wrapper must preserve decoded sample count"
        );
        std::fs::remove_dir_all(corpus_root).expect("temporary corpus should be removed");
    }

    #[test]
    fn gapless_decode_trims_codec_delay_and_end_padding() {
        let Some(corpus_root) = generate_ffmpeg_corpus() else {
            return;
        };
        let generated = corpus_root.join("generated");
        for (file_name, sample_rate) in [
            ("mp3-vbr.mp3", 44_100_usize),
            ("m4a-aac.m4a", 44_100),
            ("ogg-opus.ogg", 48_000),
        ] {
            let decoded_samples = open_source(&generated.join(file_name))
                .unwrap_or_else(|error| panic!("{file_name} should open: {error}"))
                .count();
            let expected_samples = sample_rate * 3 * 2;
            assert!(
                decoded_samples.abs_diff(expected_samples) <= 4_096,
                "{file_name} leaked excessive codec delay/padding: decoded={decoded_samples}, expected={expected_samples}"
            );
        }
        std::fs::remove_dir_all(corpus_root).expect("temporary corpus should be removed");
    }

    #[test]
    fn multichannel_sources_use_the_documented_stereo_downmix() {
        assert_eq!(
            downmix_frame_to_stereo(&[1_000, 2_000, 3_000, 4_000, 5_000, 6_000]),
            [3_961, 4_814]
        );
        let Some(corpus_root) = generate_ffmpeg_corpus() else {
            return;
        };
        let path = corpus_root.join("generated/wav-pcm16-5.1.wav");
        let source = open_source(&path).expect("5.1 WAV should open through production source");
        assert_eq!(source.channels(), 2);
        assert_eq!(source.sample_rate(), 44_100);
        assert_eq!(source.count(), 44_100 * 3 * 2);
        std::fs::remove_dir_all(corpus_root).expect("temporary corpus should be removed");
    }

    #[test]
    fn local_flac_source_supports_seek_when_sample_file_exists() {
        let Some(flac_path) = std::env::var_os("SPMUSIC_SEEK_SAMPLE_FLAC").map(PathBuf::from)
        else {
            return;
        };

        if !flac_path.exists() {
            return;
        }

        let mut source = open_source(&flac_path).expect("sample FLAC should be decodable");

        source
            .try_seek(Duration::from_secs(300))
            .expect("sample FLAC source should support seek");
    }

    #[test]
    fn local_flac_accepts_embedded_lyrics_when_sample_file_exists() {
        let Some(sample_path) = std::env::var_os("SPMUSIC_LYRICS_SAMPLE_FLAC").map(PathBuf::from)
        else {
            return;
        };
        if !sample_path.exists() {
            return;
        }

        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-flac-lyrics-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");
        let test_path = test_dir.join("lyrics-copy.flac");
        std::fs::copy(&sample_path, &test_path).expect("sample FLAC should be copied");
        let lyrics = "[00:01.00]test lyrics\u{2009}测试歌词";

        embed_lyrics(&test_path, lyrics).expect("lyrics should be embedded into FLAC copy");
        let metadata =
            lofty_metadata(&test_path, None).expect("FLAC metadata should remain readable");
        assert_eq!(metadata.lyrics.as_deref(), Some(lyrics));

        std::fs::remove_dir_all(&test_dir).expect("test directory should be removed");
    }

    #[test]
    fn track_id_is_stable_for_same_path() {
        let path = PathBuf::from("D:/Music/example.mp3");

        assert_eq!(track_id(&path), track_id(&path));
    }

    #[test]
    fn track_id_has_local_prefix_and_blake3_length() {
        let path = PathBuf::from("D:/Music/example.mp3");

        assert_eq!(track_id(&path).len(), "local-".len() + 16);
        assert!(track_id(&path).starts_with("local-"));
    }
}
