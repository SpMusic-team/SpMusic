use std::{fs::File, path::Path, time::Duration};

use lofty::file::AudioFile;
use symphonia::core::{
    codecs::CODEC_TYPE_NULL, errors::Error as SymphoniaError, formats::FormatOptions,
    io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
};

use super::{error::AudioCommandError, metadata::read_tagged_file, source::open_source};

pub(crate) fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

pub(super) fn decode_duration(path: &Path) -> Result<Option<Duration>, AudioCommandError> {
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

fn lofty_duration(path: &Path) -> Result<Option<Duration>, lofty::error::LoftyError> {
    let tagged_file = read_tagged_file(path)?;
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
