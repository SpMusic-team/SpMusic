use std::{
    fs::File,
    io::BufReader,
    path::{Path, PathBuf},
    time::Duration,
};

use lofty::file::AudioFile;
use rodio::{Decoder, Source};
use symphonia::core::{
    codecs::CODEC_TYPE_NULL, errors::Error as SymphoniaError, formats::FormatOptions,
    io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
};

use super::{
    error::{audio_error, AudioCommandError, AudioErrorCode},
    types::{AudioFileFilter, AudioTrackRef},
};

pub(crate) fn default_filters() -> Vec<AudioFileFilter> {
    vec![AudioFileFilter {
        name: "Audio".to_string(),
        extensions: vec![
            "mp3".to_string(),
            "wav".to_string(),
            "flac".to_string(),
            "ogg".to_string(),
        ],
    }]
}

pub(crate) fn input_path(input: &str) -> Result<PathBuf, AudioCommandError> {
    if input.trim().is_empty() {
        return Err(audio_error(
            AudioErrorCode::InvalidPath,
            "Audio path is empty",
            true,
        ));
    }

    Ok(PathBuf::from(input))
}

pub(crate) fn load_track_ref(path: &Path) -> Result<AudioTrackRef, AudioCommandError> {
    validate_existing_file(path)?;
    let duration = decode_duration(path)?;

    Ok(AudioTrackRef {
        id: track_id(path),
        source_path: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("audio")
            .to_string(),
        duration_ms: duration.map(duration_ms),
    })
}

pub(crate) fn open_source(path: &Path) -> Result<Decoder<BufReader<File>>, AudioCommandError> {
    let file = File::open(path).map_err(|error| {
        audio_error(
            AudioErrorCode::UnreadableFile,
            format!("Failed to read audio file: {error}"),
            true,
        )
    })?;

    Decoder::new(BufReader::new(file)).map_err(|error| {
        audio_error(
            AudioErrorCode::UnsupportedFormat,
            format!("Failed to decode audio file: {error}"),
            true,
        )
    })
}

pub(crate) fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

fn validate_existing_file(path: &Path) -> Result<(), AudioCommandError> {
    if !path.exists() {
        return Err(audio_error(
            AudioErrorCode::FileNotFound,
            "Audio file does not exist",
            true,
        ));
    }

    if !path.is_file() {
        return Err(audio_error(
            AudioErrorCode::InvalidPath,
            "Audio path is not a file",
            true,
        ));
    }

    Ok(())
}

fn decode_duration(path: &Path) -> Result<Option<Duration>, AudioCommandError> {
    match lofty_duration(path) {
        Ok(duration) => return Ok(duration),
        Err(error) => {
            tracing::debug!(
                path = %path.display(),
                error = %error,
                "lofty duration probe failed, falling back to symphonia",
            );
        }
    }

    match symphonia_duration(path) {
        Ok(duration) => Ok(duration),
        Err(error) => {
            tracing::debug!(
                path = %path.display(),
                error = %error,
                "symphonia duration probe failed, falling back to rodio",
            );
            Ok(open_source(path)?.total_duration())
        }
    }
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
    let tagged_file = lofty::read_from_path(path)?;
    let duration = tagged_file.properties().duration();

    Ok((!duration.is_zero()).then_some(duration))
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
    use std::time::Duration;

    use super::*;
    use crate::audio::error::AudioErrorCode;

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
