use std::{
    fs::File,
    io::{self, ErrorKind},
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{Duration, Instant},
};

use matroska_demuxer::{Frame as MatroskaFrame, MatroskaFile, TrackType};
use rodio::Source;
use symphonia::{
    core::{
        audio::{AudioBufferRef, SampleBuffer, SignalSpec},
        codecs::{
            CodecParameters, CodecRegistry, CodecType, Decoder, DecoderOptions, CODEC_TYPE_AAC,
            CODEC_TYPE_FLAC, CODEC_TYPE_MP3, CODEC_TYPE_NULL, CODEC_TYPE_OPUS, CODEC_TYPE_VORBIS,
        },
        errors::Error as SymphoniaError,
        formats::{FormatOptions, FormatReader, Packet, SeekedTo},
        io::MediaSourceStream,
        meta::MetadataOptions,
        probe::Hint,
        units::{self, Time, TimeBase},
    },
    default::{get_probe, register_enabled_codecs},
};
use symphonia_adapter_libopus::OpusDecoder;

const MAX_DECODE_RETRIES: usize = 3;
const OPUS_SEEK_PRE_ROLL: Duration = Duration::from_millis(80);
const MP3_SEEK_PRE_ROLL: Duration = Duration::from_millis(100);
const AAC_SEEK_PRE_ROLL: Duration = Duration::from_millis(100);
const VORBIS_SEEK_PRE_ROLL: Duration = Duration::from_millis(100);
const MATROSKA_SEEK_LOOK_BEHIND: Duration = Duration::from_millis(100);

pub(crate) struct SymphoniaAudioSource {
    codec: CodecType,
    codec_params: CodecParameters,
    decoder: Box<dyn Decoder>,
    current_frame_offset: usize,
    format: Box<dyn FormatReader>,
    indexed_matroska: Option<IndexedMatroska>,
    path: PathBuf,
    track_id: u32,
    total_duration: Option<Time>,
    reported_duration: Option<Duration>,
    buffer: SampleBuffer<i16>,
    spec: SignalSpec,
    time_base: Option<TimeBase>,
}

struct IndexedMatroska {
    reader: MatroskaFile<File>,
    track_number: u64,
}

impl SymphoniaAudioSource {
    pub(crate) fn open_path(path: &Path) -> Result<Self, SymphoniaError> {
        let started_at = Instant::now();
        tracing::info!(
            operation = "audio.symphonia.open",
            path = %path.display(),
            decoder = "symphonia",
            "opening Symphonia audio source",
        );
        let reported_duration = adts_scanned_duration(path)?;
        let file = File::open(path)?;
        let media_source = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();

        if let Some(extension) = path.extension().and_then(|extension| extension.to_str()) {
            hint.with_extension(extension);
        }

        let format_options = FormatOptions {
            enable_gapless: true,
            ..Default::default()
        };
        let metadata_options = MetadataOptions::default();
        let mut probed =
            get_probe().format(&hint, media_source, &format_options, &metadata_options)?;

        let track_id = probed
            .format
            .default_track()
            .or_else(|| {
                probed
                    .format
                    .tracks()
                    .iter()
                    .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
            })
            .ok_or(SymphoniaError::Unsupported("no decodable audio track"))?
            .id;

        let track = probed
            .format
            .tracks()
            .iter()
            .find(|track| track.id == track_id)
            .ok_or(SymphoniaError::Unsupported(
                "selected audio track disappeared",
            ))?;
        let mut decoder = codec_registry().make(&track.codec_params, &DecoderOptions::default())?;
        let total_duration = track
            .codec_params
            .time_base
            .zip(track.codec_params.n_frames)
            .map(|(base, frames)| base.calc_time(frames));
        let time_base = track.codec_params.time_base;
        let codec = track.codec_params.codec;
        let codec_params = track.codec_params.clone();
        let (buffer, spec) =
            decode_next_sample_buffer(&mut *probed.format, &mut *decoder, track_id)?;

        tracing::info!(
            operation = "audio.symphonia.open",
            path = %path.display(),
            decoder = "symphonia",
            track_id,
            codec = ?codec,
            channels = spec.channels.count(),
            sample_rate = spec.rate,
            total_duration_ms = total_duration.map(time_to_duration).map(|duration| duration.as_millis()),
            elapsed_ms = started_at.elapsed().as_millis(),
            "opened Symphonia audio source",
        );

        Ok(Self {
            codec,
            codec_params,
            decoder,
            current_frame_offset: 0,
            format: probed.format,
            indexed_matroska: None,
            path: path.to_path_buf(),
            track_id,
            total_duration,
            reported_duration,
            buffer,
            spec,
            time_base,
        })
    }

    fn refine_position(&mut self, seeked_to: SeekedTo) -> Result<(), rodio::source::SeekError> {
        let started_at = Instant::now();
        tracing::debug!(
            operation = "audio.symphonia.refine_seek",
            track_id = self.track_id,
            requested_ts = seeked_to.required_ts,
            actual_ts = seeked_to.actual_ts,
            "refining Symphonia seek position",
        );
        let mut timestamp_units_to_pass = seeked_to.required_ts.saturating_sub(seeked_to.actual_ts);
        let packet = loop {
            let candidate = self
                .format
                .next_packet()
                .map_err(|error| seek_error(format!("failed to get packet after seek: {error}")))?;

            if candidate.track_id() != self.track_id {
                continue;
            }

            if candidate.dur() > timestamp_units_to_pass {
                break candidate;
            }

            timestamp_units_to_pass = timestamp_units_to_pass.saturating_sub(candidate.dur());
        };

        let (buffer, spec) =
            decode_packet_with_retry(&mut *self.format, &mut *self.decoder, packet).map_err(
                |error| seek_error(format!("failed to decode packet after seek: {error}")),
            )?;
        self.spec = spec;
        self.buffer = buffer;
        let samples_to_pass = self
            .time_base
            .map(|time_base| {
                let time = time_base.calc_time(timestamp_units_to_pass);
                (time.seconds as f64 + time.frac) * f64::from(self.spec.rate)
            })
            .unwrap_or(timestamp_units_to_pass as f64)
            .round() as usize;
        self.current_frame_offset = samples_to_pass * self.channels() as usize;
        tracing::debug!(
            operation = "audio.symphonia.refine_seek",
            track_id = self.track_id,
            samples_to_pass,
            frame_offset = self.current_frame_offset,
            elapsed_ms = started_at.elapsed().as_millis(),
            "refined Symphonia seek position",
        );
        Ok(())
    }

    pub(super) fn linear_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        let started_at = Instant::now();
        let mut reopened = Self::open_path(&self.path)
            .map_err(|error| seek_error(format!("failed to reopen source for seek: {error}")))?;
        let target = reopened
            .total_duration()
            .map(|duration| {
                let one_frame = Duration::from_secs_f64(1.0 / f64::from(reopened.sample_rate()));
                pos.min(duration.saturating_sub(one_frame))
            })
            .unwrap_or(pos);
        let frames_to_skip =
            (target.as_secs_f64() * f64::from(reopened.sample_rate())).round() as usize;
        let samples_to_skip = frames_to_skip.saturating_mul(reopened.channels() as usize);
        let skipped = reopened.by_ref().take(samples_to_skip).count();
        if skipped != samples_to_skip {
            return Err(seek_error(format!(
                "linear seek reached end of stream after {skipped} of {samples_to_skip} samples"
            )));
        }

        tracing::info!(
            operation = "audio.symphonia.seek",
            track_id = reopened.track_id,
            requested_ms = pos.as_millis(),
            strategy = "reopen-linear-decode",
            skipped_samples = skipped,
            elapsed_ms = started_at.elapsed().as_millis(),
            "sought Symphonia audio source with linear fallback",
        );
        *self = reopened;
        Ok(())
    }

    fn native_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        use symphonia::core::formats::{SeekMode, SeekTo};

        let time = match self.total_duration {
            Some(total_duration)
                if time_to_duration(total_duration)
                    .saturating_sub(pos)
                    .as_millis()
                    < 1 =>
            {
                skip_back_a_tiny_bit(total_duration)
            }
            _ => pos.as_secs_f64().into(),
        };

        tracing::debug!(
            operation = "audio.symphonia.seek",
            track_id = self.track_id,
            requested_ms = pos.as_millis(),
            requested_time_seconds = time.seconds,
            requested_time_fraction = time.frac,
            "seeking Symphonia audio source with native container index",
        );
        self.format
            .seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    time,
                    track_id: Some(self.track_id),
                },
            )
            .map_err(|error| seek_error(format!("format seek failed: {error}")))
            .and_then(|seeked_to| self.refine_position(seeked_to))
    }

    fn reopen_indexed_seek(
        &mut self,
        pos: Duration,
        pre_roll: Duration,
    ) -> Result<(), rodio::source::SeekError> {
        let started_at = Instant::now();
        let mut reopened = Self::open_path(&self.path)
            .map_err(|error| seek_error(format!("failed to reopen indexed source: {error}")))?;
        let indexed_target = pos.saturating_sub(pre_roll);
        // `open_path` consumes the first packet to establish the signal spec. Reset only the
        // codec prediction state before jumping; the adapter has already consumed OpusHead
        // pre-skip once, so it will not incorrectly trim the first post-seek packet again.
        reopened.decoder.reset();
        reopened.native_seek(indexed_target)?;

        let mut frames_to_skip = (pos.saturating_sub(indexed_target).as_secs_f64()
            * f64::from(reopened.sample_rate()))
        .round() as usize;
        if matches!(reopened.codec, CODEC_TYPE_MP3 | CODEC_TYPE_AAC) {
            // Xing/LAME expresses the encoder delay in decoded PCM frames.
            // Gapless trimming applies it at stream start, but an indexed
            // discontinuity must account for it explicitly.
            frames_to_skip = frames_to_skip
                .saturating_add(reopened.codec_params.delay.unwrap_or_default() as usize);
        }
        let samples_to_skip = frames_to_skip.saturating_mul(reopened.channels() as usize);
        let skipped = reopened.by_ref().take(samples_to_skip).count();
        if skipped != samples_to_skip {
            return Err(seek_error(format!(
                "indexed seek pre-roll reached end of stream after {skipped} of {samples_to_skip} samples"
            )));
        }

        tracing::info!(
            operation = "audio.symphonia.seek",
            track_id = reopened.track_id,
            requested_ms = pos.as_millis(),
            indexed_target_ms = indexed_target.as_millis(),
            pre_roll_ms = pre_roll.as_millis(),
            strategy = "reopen-native-index-preroll",
            skipped_samples = skipped,
            elapsed_ms = started_at.elapsed().as_millis(),
            "sought Symphonia audio source with a fresh decoder and container index",
        );
        *self = reopened;
        Ok(())
    }

    fn matroska_indexed_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        let started_at = Instant::now();
        let file = File::open(&self.path)
            .map_err(|error| seek_error(format!("failed to open Matroska source: {error}")))?;
        let mut reader = MatroskaFile::open(file)
            .map_err(|error| seek_error(format!("failed to parse Matroska index: {error}")))?;
        let track = reader
            .tracks()
            .iter()
            .find(|track| track.track_type() == TrackType::Audio)
            .ok_or_else(|| seek_error("Matroska source has no audio track".to_string()))?;
        let track_number = track.track_number().get();
        let timestamp_scale_ns = reader.info().timestamp_scale().get();
        let pre_roll_ns = track
            .seek_pre_roll()
            .unwrap_or_default()
            .max(MATROSKA_SEEK_LOOK_BEHIND.as_nanos() as u64);
        let target_ns = pos.as_nanos().min(u128::from(u64::MAX)) as u64;
        let indexed_target_ns = target_ns.saturating_sub(pre_roll_ns);
        reader
            .seek(indexed_target_ns / timestamp_scale_ns)
            .map_err(|error| seek_error(format!("Matroska cue seek failed: {error}")))?;

        let mut seek_params = self.codec_params.clone();
        if self.codec == CODEC_TYPE_OPUS {
            if let Some(extra_data) = seek_params.extra_data.as_mut() {
                if extra_data.starts_with(b"OpusHead") && extra_data.len() >= 12 {
                    extra_data[10] = 0;
                    extra_data[11] = 0;
                }
            }
        }
        let mut decoder = codec_registry()
            .make(&seek_params, &DecoderOptions::default())
            .map_err(|error| seek_error(format!("failed to reset Matroska decoder: {error}")))?;
        let mut frame = MatroskaFrame::default();
        let mut decoded_frame_cursor = None;
        let (buffer, spec, frame_offset) = loop {
            if !reader
                .next_frame(&mut frame)
                .map_err(|error| seek_error(format!("failed to read indexed frame: {error}")))?
            {
                return Err(seek_error(
                    "Matroska indexed seek reached end of stream".to_string(),
                ));
            }
            if frame.track != track_number {
                continue;
            }
            let packet = Packet::new_from_slice(
                self.track_id,
                frame.timestamp,
                frame.duration.unwrap_or_default(),
                &frame.data,
            );
            let decoded = decoder
                .decode(&packet)
                .map_err(|error| seek_error(format!("failed to decode indexed frame: {error}")))?;
            let spec = *decoded.spec();
            let packet_frames = decoded.frames() as u64;
            let frame_start = *decoded_frame_cursor.get_or_insert_with(|| {
                let approximate = frame
                    .timestamp
                    .saturating_mul(timestamp_scale_ns)
                    .saturating_mul(u64::from(spec.rate))
                    .saturating_add(500_000_000)
                    / 1_000_000_000;
                if self.codec == CODEC_TYPE_FLAC && packet_frames > 0 {
                    approximate
                        .saturating_add(packet_frames / 2)
                        .checked_div(packet_frames)
                        .unwrap_or_default()
                        .saturating_mul(packet_frames)
                } else {
                    approximate
                }
            });
            let target_frame = target_ns
                .saturating_mul(u64::from(spec.rate))
                .saturating_add(500_000_000)
                / 1_000_000_000;
            let frames_from_start = target_frame.saturating_sub(frame_start);
            if frames_from_start >= packet_frames {
                decoded_frame_cursor = Some(frame_start.saturating_add(packet_frames));
                continue;
            }
            break (
                sample_buffer(decoded, &spec),
                spec,
                frames_from_start as usize * spec.channels.count(),
            );
        };

        self.decoder = decoder;
        self.buffer = buffer;
        self.spec = spec;
        self.current_frame_offset = frame_offset;
        self.indexed_matroska = Some(IndexedMatroska {
            reader,
            track_number,
        });
        tracing::info!(
            operation = "audio.symphonia.seek",
            track_id = self.track_id,
            requested_ms = pos.as_millis(),
            strategy = "matroska-cues-preroll",
            elapsed_ms = started_at.elapsed().as_millis(),
            "sought Matroska source using cues",
        );
        Ok(())
    }
}

impl Iterator for SymphoniaAudioSource {
    type Item = i16;

    fn next(&mut self) -> Option<Self::Item> {
        if self.current_frame_offset >= self.buffer.len() {
            let (buffer, spec) = match self.indexed_matroska.as_mut() {
                Some(indexed) => {
                    decode_next_matroska_sample_buffer(indexed, &mut *self.decoder, self.track_id)
                        .ok()?
                }
                None => {
                    decode_next_sample_buffer(&mut *self.format, &mut *self.decoder, self.track_id)
                        .ok()?
                }
            };
            self.spec = spec;
            self.buffer = buffer;
            self.current_frame_offset = 0;
        }

        let sample = *self.buffer.samples().get(self.current_frame_offset)?;
        self.current_frame_offset += 1;
        Some(sample)
    }
}

impl Source for SymphoniaAudioSource {
    fn current_frame_len(&self) -> Option<usize> {
        Some(self.buffer.len().saturating_sub(self.current_frame_offset))
    }

    fn channels(&self) -> u16 {
        self.spec.channels.count() as u16
    }

    fn sample_rate(&self) -> u32 {
        self.spec.rate
    }

    fn total_duration(&self) -> Option<Duration> {
        self.reported_duration
            .or_else(|| self.total_duration.map(time_to_duration))
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        let started_at = Instant::now();
        if is_matroska_path(&self.path) {
            if self.matroska_indexed_seek(pos).is_ok() {
                return Ok(());
            }
            tracing::debug!(
                operation = "audio.symphonia.seek",
                requested_ms = pos.as_millis(),
                "Matroska indexed seek failed; using linear fallback",
            );
            return self.linear_seek(pos);
        }
        if self.codec == CODEC_TYPE_OPUS {
            // A fresh decoder plus Ogg's native page index avoids carrying stale Opus state
            // across the discontinuity. Decode the recommended pre-roll before exposing the
            // requested frame. Symphonia 0.5.5 Matroska seek is not reliable, so WebM keeps
            // the sample-accurate linear fallback.
            if is_ogg_path(&self.path) && self.reopen_indexed_seek(pos, OPUS_SEEK_PRE_ROLL).is_ok()
            {
                return Ok(());
            }
            tracing::debug!(
                operation = "audio.symphonia.seek",
                track_id = self.track_id,
                requested_ms = pos.as_millis(),
                "indexed Opus seek failed; using linear fallback",
            );
            return self.linear_seek(pos);
        }
        if self.codec == CODEC_TYPE_MP3 {
            // Reopen so the bit reservoir and synthesis filter do not retain
            // state from before the discontinuity. A short pre-roll also
            // handles CBR streams without a Xing/VBRI table.
            if self.reopen_indexed_seek(pos, MP3_SEEK_PRE_ROLL).is_ok() {
                return Ok(());
            }
            return self.linear_seek(pos);
        }
        if self.codec == CODEC_TYPE_AAC {
            if self.reopen_indexed_seek(pos, AAC_SEEK_PRE_ROLL).is_ok() {
                return Ok(());
            }
            return self.linear_seek(pos);
        }
        if self.codec == CODEC_TYPE_VORBIS && is_ogg_path(&self.path) {
            if self.reopen_indexed_seek(pos, VORBIS_SEEK_PRE_ROLL).is_ok() {
                return Ok(());
            }
            return self.linear_seek(pos);
        }
        let native_seek = self.native_seek(pos);

        if native_seek.is_err() {
            tracing::debug!(
                operation = "audio.symphonia.seek",
                track_id = self.track_id,
                requested_ms = pos.as_millis(),
                "native container seek failed; using linear fallback",
            );
            return self.linear_seek(pos);
        }
        tracing::info!(
            operation = "audio.symphonia.seek",
            track_id = self.track_id,
            requested_ms = pos.as_millis(),
            elapsed_ms = started_at.elapsed().as_millis(),
            "sought Symphonia audio source",
        );
        Ok(())
    }
}

fn is_ogg_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            ["ogg", "oga", "opus"]
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
}

fn adts_scanned_duration(path: &Path) -> Result<Option<Duration>, SymphoniaError> {
    use std::io::Read;

    let mut header = [0_u8; 2];
    let is_adts = File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .is_ok()
        && header[0] == 0xff
        && header[1] & 0xf6 == 0xf0;
    if !is_adts {
        return Ok(None);
    }

    let media_source = MediaSourceStream::new(Box::new(File::open(path)?), Default::default());
    let mut format = get_probe()
        .format(
            &Hint::new(),
            media_source,
            &FormatOptions {
                enable_gapless: true,
                ..Default::default()
            },
            &MetadataOptions::default(),
        )?
        .format;
    let track = format
        .default_track()
        .or_else(|| {
            format
                .tracks()
                .iter()
                .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        })
        .ok_or(SymphoniaError::Unsupported(
            "ADTS source has no audio track",
        ))?;
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
            Err(SymphoniaError::IoError(error)) if error.kind() == ErrorKind::UnexpectedEof => {
                break;
            }
            Err(error) => return Err(error),
        }
    }
    Ok((final_ts > 0).then(|| time_to_duration(time_base.calc_time(final_ts))))
}

fn is_matroska_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            ["mka", "mkv", "webm", "weba"]
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
}

fn decode_next_matroska_sample_buffer(
    indexed: &mut IndexedMatroska,
    decoder: &mut dyn Decoder,
    track_id: u32,
) -> Result<(SampleBuffer<i16>, SignalSpec), SymphoniaError> {
    let mut frame = MatroskaFrame::default();
    loop {
        let has_frame = indexed.reader.next_frame(&mut frame).map_err(|error| {
            SymphoniaError::IoError(io::Error::new(ErrorKind::InvalidData, error.to_string()))
        })?;
        if !has_frame {
            return Err(SymphoniaError::IoError(io::Error::new(
                ErrorKind::UnexpectedEof,
                "end of Matroska stream",
            )));
        }
        if frame.track != indexed.track_number {
            continue;
        }
        let packet = Packet::new_from_slice(
            track_id,
            frame.timestamp,
            frame.duration.unwrap_or_default(),
            &frame.data,
        );
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                return Ok((sample_buffer(decoded, &spec), spec));
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(error) => return Err(error),
        }
    }
}

fn codec_registry() -> &'static CodecRegistry {
    static REGISTRY: OnceLock<CodecRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let mut registry = CodecRegistry::new();
        register_enabled_codecs(&mut registry);
        registry.register_all::<OpusDecoder>();
        registry
    })
}

fn decode_next_sample_buffer(
    format: &mut dyn FormatReader,
    decoder: &mut dyn Decoder,
    track_id: u32,
) -> Result<(SampleBuffer<i16>, SignalSpec), SymphoniaError> {
    let mut decode_errors = 0;

    loop {
        let packet = format.next_packet()?;
        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                return Ok((sample_buffer(decoded, &spec), spec));
            }
            Err(SymphoniaError::DecodeError(_)) if decode_errors < MAX_DECODE_RETRIES => {
                decode_errors += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

fn decode_packet_with_retry(
    format: &mut dyn FormatReader,
    decoder: &mut dyn Decoder,
    packet: symphonia::core::formats::Packet,
) -> Result<(SampleBuffer<i16>, SignalSpec), SymphoniaError> {
    match decoder.decode(&packet) {
        Ok(decoded) => {
            let spec = *decoded.spec();
            return Ok((sample_buffer(decoded, &spec), spec));
        }
        Err(error) if !matches!(error, SymphoniaError::DecodeError(_)) => return Err(error),
        Err(_) => {}
    }

    for _ in 0..MAX_DECODE_RETRIES {
        match decoder.decode(&format.next_packet()?) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                return Ok((sample_buffer(decoded, &spec), spec));
            }
            Err(error) if !matches!(error, SymphoniaError::DecodeError(_)) => return Err(error),
            Err(_) => {}
        }
    }

    Err(SymphoniaError::DecodeError(
        "decoding failed after seek retry limit",
    ))
}

fn sample_buffer(decoded: AudioBufferRef<'_>, spec: &SignalSpec) -> SampleBuffer<i16> {
    let duration = units::Duration::from(decoded.capacity() as u64);
    let mut buffer = SampleBuffer::<i16>::new(duration, *spec);
    buffer.copy_interleaved_ref(decoded);
    buffer
}

fn time_to_duration(time: Time) -> Duration {
    let nanos = (time.frac * 1_000_000_000.0)
        .round()
        .clamp(0.0, 999_999_999.0) as u32;

    Duration::new(time.seconds, nanos)
}

fn skip_back_a_tiny_bit(mut time: Time) -> Time {
    time.frac -= 0.0001;
    if time.frac < 0.0 {
        time.seconds = time.seconds.saturating_sub(1);
        time.frac += 1.0;
    }

    time
}

fn seek_error(error: String) -> rodio::source::SeekError {
    tracing::debug!(
        operation = "audio.symphonia.seek",
        error,
        "symphonia source seek failed",
    );

    rodio::source::SeekError::NotSupported {
        underlying_source: "SymphoniaAudioSource",
    }
}
