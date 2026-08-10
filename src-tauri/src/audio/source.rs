use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use rodio::Source;

use super::{
    duration::{decode_duration, duration_ms},
    error::{audio_error, AudioCommandError, AudioErrorCode},
    metadata::{read_metadata, replay_gain_multiplier},
    symphonia_source::SymphoniaAudioSource,
    types::{AudioTrackMetadata, AudioTrackRef},
};

pub(crate) type AudioSource = Box<dyn Source<Item = i16> + Send>;

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

pub(super) fn downmix_frame_to_stereo(frame: &[i16]) -> [i16; 2] {
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
        read_metadata(path, cover_cache_dir)
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

pub(super) fn validate_existing_file(path: &Path) -> Result<(), AudioCommandError> {
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

pub(super) fn track_id(path: &Path) -> String {
    let stable_path = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_lowercase();
    let hash = blake3::hash(stable_path.as_bytes());
    format!("local-{}", &hash.to_hex()[..16])
}
