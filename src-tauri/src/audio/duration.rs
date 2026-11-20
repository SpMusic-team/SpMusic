use std::{fs::File, path::Path, time::Duration};

use lofty::file::AudioFile;
use symphonia::core::{
    codecs::CODEC_TYPE_NULL,
    errors::Error as SymphoniaError,
    formats::{FormatOptions, Packet},
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
    units::TimeBase,
};

use super::{
    error::{audio_error, AudioCommandError, AudioErrorCode},
    metadata::read_tagged_file,
    source::open_source,
};

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
            return Ok(Some(duration));
        }
        Ok(None) => {
            tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                "lofty duration probe returned no duration, falling back to playback source",
            );
        }
        Err(error) => {
            tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                error = %error,
                "lofty duration probe failed, falling back to playback source",
            );
        }
    }

    if let Some(duration) = open_source(path)?
        .total_duration()
        .filter(|duration| !duration.is_zero())
    {
        return Ok(Some(duration));
    }

    // Some MP4 files have a zero mdhd duration even though their sample table
    // contains a complete audio stream. Only after every cheap source has
    // failed to supply a positive duration, read packet timestamps (no decode).
    symphonia_scanned_duration(path).map_err(|error| {
        audio_error(
            AudioErrorCode::UnsupportedFormat,
            format!("Failed to scan audio duration: {error}"),
            true,
        )
    })
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
    scan_packet_duration(track_id, time_base, || format.next_packet())
}

fn scan_packet_duration(
    track_id: u32,
    time_base: TimeBase,
    mut next_packet: impl FnMut() -> Result<Packet, SymphoniaError>,
) -> Result<Option<Duration>, SymphoniaError> {
    if time_base.numer == 0 || time_base.denom == 0 {
        return Ok(None);
    }
    let mut final_ts = 0_u64;

    loop {
        match next_packet() {
            Ok(packet) if packet.track_id() == track_id && packet.dur() > 0 => {
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
    let Some(frame_count) = track.codec_params.n_frames.filter(|frames| *frames > 0) else {
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
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::*;

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

    struct Fixture(PathBuf);

    impl Fixture {
        fn new(bytes: &[u8]) -> Self {
            let path = std::env::temp_dir().join(format!(
                "spmusic-duration-regression-{}-{}.m4a",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed),
            ));
            fs::write(&path, bytes).unwrap();
            Self(path)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_file(&self.0).unwrap();
        }
    }

    // A self-contained, silent 8 kHz PCM MP4. The media header duration is
    // independent of the sample table, reproducing incomplete mdhd metadata
    // without copying any user audio or requiring an external encoder.
    fn one_second_mp4(declared_duration: u32) -> Vec<u8> {
        fn atom(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
            let mut bytes = ((body.len() + 8) as u32).to_be_bytes().to_vec();
            bytes.extend_from_slice(kind);
            bytes.extend_from_slice(body);
            bytes
        }
        fn words(values: &[u32]) -> Vec<u8> {
            values
                .iter()
                .flat_map(|value| value.to_be_bytes())
                .collect()
        }

        let ftyp = atom(b"ftyp", b"M4A \0\0\0\0M4A isom");
        let mdat = atom(b"mdat", &vec![0; 16_000]);
        let mut mvhd = vec![0; 100];
        mvhd[12..16].copy_from_slice(&8_000_u32.to_be_bytes());
        let mut tkhd = vec![0; 84];
        tkhd[3] = 3;
        tkhd[12..16].copy_from_slice(&1_u32.to_be_bytes());
        let mut mdhd = words(&[0, 0, 0, 8_000, declared_duration]);
        mdhd.extend_from_slice(&[0; 4]);
        let mut hdlr = vec![0; 24];
        hdlr[8..12].copy_from_slice(b"soun");
        let mut sample = vec![0; 28];
        sample[6..8].copy_from_slice(&1_u16.to_be_bytes());
        sample[16..18].copy_from_slice(&1_u16.to_be_bytes());
        sample[18..20].copy_from_slice(&16_u16.to_be_bytes());
        sample[24..28].copy_from_slice(&(8_000_u32 << 16).to_be_bytes());
        let stsd = atom(b"stsd", &[words(&[0, 1]), atom(b"sowt", &sample)].concat());
        let stts = atom(b"stts", &words(&[0, 1, 8_000, 1]));
        let stsc = atom(b"stsc", &words(&[0, 1, 1, 8_000, 1]));
        let stsz = atom(b"stsz", &words(&[0, 2, 8_000]));
        let stco = atom(b"stco", &words(&[0, 1, ftyp.len() as u32 + 8]));
        let stbl = atom(b"stbl", &[stsd, stts, stsc, stsz, stco].concat());
        let minf = atom(b"minf", &stbl);
        let mdia = atom(
            b"mdia",
            &[atom(b"mdhd", &mdhd), atom(b"hdlr", &hdlr), minf].concat(),
        );
        let trak = atom(b"trak", &[atom(b"tkhd", &tkhd), mdia].concat());
        let moov = atom(b"moov", &[atom(b"mvhd", &mvhd), trak].concat());
        [ftyp, mdat, moov].concat()
    }

    #[test]
    fn zero_mp4_header_duration_falls_back_to_complete_packet_timeline() {
        let fixture = Fixture::new(&one_second_mp4(0));
        assert_eq!(symphonia_duration(&fixture.0).unwrap(), None);
        assert_eq!(
            decode_duration(&fixture.0).unwrap(),
            Some(Duration::from_secs(1))
        );
    }

    #[test]
    fn positive_header_duration_keeps_fast_path_without_reading_packets() {
        let mut bytes = one_second_mp4(8_000);
        let stco = bytes
            .windows(4)
            .position(|window| window == b"stco")
            .unwrap();
        // An inaccessible sample chunk provides no packet duration. A positive
        // header must still follow the existing metadata-only fast path.
        bytes[stco + 12..stco + 16].copy_from_slice(&u32::MAX.to_be_bytes());
        let fixture = Fixture::new(&bytes);
        assert_eq!(
            decode_duration(&fixture.0).unwrap(),
            Some(Duration::from_secs(1))
        );
        assert_eq!(symphonia_scanned_duration(&fixture.0).unwrap(), None);
    }

    #[test]
    fn packet_scan_propagates_errors_instead_of_publishing_partial_duration() {
        for error in [
            SymphoniaError::DecodeError("damaged packet"),
            SymphoniaError::ResetRequired,
        ] {
            let mut packets =
                [Ok(Packet::new_from_slice(7, 0, 8_000, &[])), Err(error)].into_iter();
            assert!(
                scan_packet_duration(7, TimeBase::new(1, 8_000), || packets.next().unwrap())
                    .is_err()
            );
        }
    }

    #[test]
    fn packet_scan_ignores_other_tracks_and_packets_without_duration() {
        let mut packets = [
            Ok(Packet::new_from_slice(99, 0, 80_000, &[])),
            Ok(Packet::new_from_slice(7, 80_000, 0, &[])),
            symphonia::core::errors::end_of_stream_error(),
        ]
        .into_iter();
        assert_eq!(
            scan_packet_duration(7, TimeBase::new(1, 8_000), || packets.next().unwrap()).unwrap(),
            None
        );
    }

    #[test]
    fn packet_scan_requires_a_valid_time_base() {
        for time_base in [
            TimeBase { numer: 0, denom: 1 },
            TimeBase { numer: 1, denom: 0 },
        ] {
            assert_eq!(
                scan_packet_duration(7, time_base, || panic!("invalid time base must not scan"))
                    .unwrap(),
                None
            );
        }
    }

    #[test]
    fn malformed_container_is_not_replaced_with_a_duration() {
        let fixture = Fixture::new(b"not an audio container");
        assert!(decode_duration(&fixture.0).is_err());
    }
}
