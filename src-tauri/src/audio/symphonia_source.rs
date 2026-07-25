use std::{
    fs::File,
    path::Path,
    time::{Duration, Instant},
};

use rodio::Source;
use symphonia::{
    core::{
        audio::{AudioBufferRef, SampleBuffer, SignalSpec},
        codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL},
        errors::Error as SymphoniaError,
        formats::{FormatOptions, FormatReader, SeekedTo},
        io::MediaSourceStream,
        meta::MetadataOptions,
        probe::Hint,
        units::{self, Time},
    },
    default::{get_codecs, get_probe},
};

const MAX_DECODE_RETRIES: usize = 3;

pub(crate) struct SymphoniaAudioSource {
    decoder: Box<dyn Decoder>,
    current_frame_offset: usize,
    format: Box<dyn FormatReader>,
    track_id: u32,
    total_duration: Option<Time>,
    buffer: SampleBuffer<i16>,
    spec: SignalSpec,
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
        let mut decoder = get_codecs().make(&track.codec_params, &DecoderOptions::default())?;
        let total_duration = track
            .codec_params
            .time_base
            .zip(track.codec_params.n_frames)
            .map(|(base, frames)| base.calc_time(frames));
        let codec = track.codec_params.codec;
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
            decoder,
            current_frame_offset: 0,
            format: probed.format,
            track_id,
            total_duration,
            buffer,
            spec,
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
        let mut samples_to_pass = seeked_to.required_ts.saturating_sub(seeked_to.actual_ts);
        let packet = loop {
            let candidate = self
                .format
                .next_packet()
                .map_err(|error| seek_error(format!("failed to get packet after seek: {error}")))?;

            if candidate.track_id() != self.track_id {
                continue;
            }

            if candidate.dur() > samples_to_pass {
                break candidate;
            }

            samples_to_pass = samples_to_pass.saturating_sub(candidate.dur());
        };

        let (buffer, spec) =
            decode_packet_with_retry(&mut *self.format, &mut *self.decoder, packet).map_err(
                |error| seek_error(format!("failed to decode packet after seek: {error}")),
            )?;
        self.spec = spec;
        self.buffer = buffer;
        self.current_frame_offset = samples_to_pass as usize * self.channels() as usize;
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
}

impl Iterator for SymphoniaAudioSource {
    type Item = i16;

    fn next(&mut self) -> Option<Self::Item> {
        if self.current_frame_offset >= self.buffer.len() {
            let (buffer, spec) =
                decode_next_sample_buffer(&mut *self.format, &mut *self.decoder, self.track_id)
                    .ok()?;
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
        self.total_duration.map(time_to_duration)
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        use symphonia::core::formats::{SeekMode, SeekTo};

        let started_at = Instant::now();
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
            "seeking Symphonia audio source",
        );
        let seeked_to = self
            .format
            .seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    time,
                    track_id: Some(self.track_id),
                },
            )
            .map_err(|error| seek_error(format!("format seek failed: {error}")))?;

        self.refine_position(seeked_to)?;
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
        time.frac = 1.0 + time.frac;
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
