use std::{
    f32::consts::PI,
    sync::mpsc::{Receiver, SyncSender, TrySendError},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use rodio::Source;
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::source::AudioSource;

pub(crate) const AUDIO_VISUALIZATION_FRAME_EVENT: &str = "audio_visualization_frame";
pub(crate) const VISUALIZATION_BAR_COUNT: usize = 48;
const VISUALIZATION_FPS: u32 = 30;
const FFT_SIZE: usize = 4096;
const MAX_ANALYSIS_RATE: u32 = 48_000;
const MIN_FREQUENCY_HZ: f32 = 50.0;
const MAX_FREQUENCY_HZ: f32 = 16_000.0;
const MIN_EVENT_INTERVAL: Duration = Duration::from_millis(30);

/// Project FFT bins onto the fixed log-frequency bands. The FFT cell just
/// below 50 Hz overlaps the first band's boundary, so keep it in band zero.
/// With a 4096-point window this is bin 4 at both 48 and 44.1 kHz; omitting
/// it would leave the first source band permanently empty at 48 kHz.
fn map_bin_power_to_bands(bin_power: &[f32], sample_rate: u32) -> [f32; VISUALIZATION_BAR_COUNT] {
    let mut magnitudes = [0.0_f32; VISUALIZATION_BAR_COUNT];
    let min_log = MIN_FREQUENCY_HZ.ln();
    let log_span = (MAX_FREQUENCY_HZ / MIN_FREQUENCY_HZ).ln();
    let bin_width = sample_rate as f32 / FFT_SIZE as f32;
    let first_bin = ((MIN_FREQUENCY_HZ / bin_width).floor() as usize).max(1);
    for bin in first_bin..bin_power.len() {
        let frequency = bin as f32 * bin_width;
        if frequency > MAX_FREQUENCY_HZ {
            break;
        }
        let position = (((frequency.ln() - min_log) / log_span)
            * (VISUALIZATION_BAR_COUNT - 1) as f32)
            .clamp(0.0, (VISUALIZATION_BAR_COUNT - 1) as f32);
        let lower = position.floor() as usize;
        let upper = (lower + 1).min(VISUALIZATION_BAR_COUNT - 1);
        let upper_weight = position.fract();
        let amplitude = bin_power[bin].sqrt();
        magnitudes[lower] = magnitudes[lower].max(amplitude * (1.0 - upper_weight));
        magnitudes[upper] = magnitudes[upper].max(amplitude * upper_weight);
    }
    magnitudes
}

/// `bars[0..48]` are stationary log-frequency bands from 50 Hz to 16 kHz,
/// normalized to 0..1 with one shared amplitude curve. They are measured after
/// ReplayGain and before the Sink's user volume.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioVisualizationFrame {
    pub generation: u64,
    pub track_id: String,
    pub bars: Vec<f32>,
}

pub(crate) struct QueuedVisualizationFrame {
    revision: u64,
    generation: u64,
    track_id: String,
    sample_rate: u32,
    channels: usize,
    samples: Vec<i16>,
}

#[derive(Default)]
pub(crate) struct VisualizationSession {
    next_revision: AtomicU64,
    active_revision: AtomicU64,
}

impl VisualizationSession {
    pub(crate) fn next_revision(&self) -> u64 {
        self.next_revision.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub(crate) fn activate(&self, revision: u64) {
        self.active_revision.store(revision, Ordering::Release);
    }

    pub(crate) fn clear(&self) {
        self.active_revision.store(0, Ordering::Release);
    }

    fn is_active(&self, revision: u64) -> bool {
        revision != 0 && revision == self.active_revision.load(Ordering::Acquire)
    }
}

/// The bounded channel keeps FFT, frequency mapping and Tauri emission off
/// the audio callback. A slow UI drops visual chunks, never playback samples.
pub(crate) fn run_visualization_bridge(
    app_handle: AppHandle,
    rx: Receiver<QueuedVisualizationFrame>,
    session: Arc<VisualizationSession>,
) {
    let mut processor = SpectrumProcessor::new();
    let mut last_emit: Option<Instant> = None;
    while let Ok(chunk) = rx.recv() {
        if !session.is_active(chunk.revision) {
            continue;
        }
        if processor.ensure_stream(chunk.revision, chunk.sample_rate, chunk.channels) {
            last_emit = None;
        }
        processor.push_samples(&chunk.samples, chunk.channels);
        let now = Instant::now();
        if !processor.ready()
            || last_emit.is_some_and(|last| now.duration_since(last) < MIN_EVENT_INTERVAL)
        {
            continue;
        }
        let bars = processor.spectrum_bars();
        // A seek or track switch may have happened while the FFT was running.
        if !session.is_active(chunk.revision) {
            continue;
        }
        last_emit = Some(now);
        let frame = AudioVisualizationFrame {
            generation: chunk.generation,
            track_id: chunk.track_id,
            bars: bars.to_vec(),
        };
        if let Err(error) = app_handle.emit(AUDIO_VISUALIZATION_FRAME_EVENT, frame) {
            tracing::warn!(
                operation = "audio.visualization.emit",
                error = %error,
                "failed to emit audio visualization frame",
            );
        }
    }
}

pub(crate) fn tap_source(
    source: AudioSource,
    tx: SyncSender<QueuedVisualizationFrame>,
    generation: u64,
    track_id: String,
    revision: u64,
) -> (AudioSource, Arc<AtomicU64>) {
    let source_revision = Arc::new(AtomicU64::new(revision));
    (
        Box::new(VisualizationTap::new(
            source,
            tx,
            generation,
            track_id,
            Arc::clone(&source_revision),
        )),
        source_revision,
    )
}

struct VisualizationTap {
    inner: AudioSource,
    tx: SyncSender<QueuedVisualizationFrame>,
    generation: u64,
    track_id: String,
    input_channels: usize,
    analysis_channels: usize,
    analysis_stride: usize,
    analysis_rate: u32,
    hop_frames: usize,
    stride_index: usize,
    channel_index: usize,
    captured_frames: usize,
    pending: Vec<i16>,
    source_revision: Arc<AtomicU64>,
}

impl VisualizationTap {
    fn new(
        inner: AudioSource,
        tx: SyncSender<QueuedVisualizationFrame>,
        generation: u64,
        track_id: String,
        source_revision: Arc<AtomicU64>,
    ) -> Self {
        let input_channels = inner.channels().max(1) as usize;
        let analysis_channels = input_channels.min(2);
        let input_rate = inner.sample_rate().max(1);
        let analysis_stride = input_rate.div_ceil(MAX_ANALYSIS_RATE) as usize;
        let analysis_rate = input_rate / analysis_stride as u32;
        let hop_frames = (analysis_rate as usize / VISUALIZATION_FPS as usize).max(1);
        Self {
            inner,
            tx,
            generation,
            track_id,
            input_channels,
            analysis_channels,
            analysis_stride,
            analysis_rate,
            hop_frames,
            stride_index: 0,
            channel_index: 0,
            captured_frames: 0,
            pending: Vec::with_capacity(hop_frames * analysis_channels),
            source_revision,
        }
    }

    fn record(&mut self, sample: i16) {
        let capture = self.stride_index == 0;
        if capture && self.channel_index < self.analysis_channels {
            self.pending.push(sample);
        }
        self.channel_index += 1;
        if self.channel_index < self.input_channels {
            return;
        }
        self.channel_index = 0;
        self.stride_index = (self.stride_index + 1) % self.analysis_stride;
        if !capture {
            return;
        }
        self.captured_frames += 1;
        if self.captured_frames < self.hop_frames {
            return;
        }
        self.captured_frames = 0;
        let samples = std::mem::take(&mut self.pending);
        let chunk = QueuedVisualizationFrame {
            revision: self.source_revision.load(Ordering::Acquire),
            generation: self.generation,
            track_id: self.track_id.clone(),
            sample_rate: self.analysis_rate,
            channels: self.analysis_channels,
            samples,
        };
        match self.tx.try_send(chunk) {
            Ok(()) => {
                self.pending = Vec::with_capacity(self.hop_frames * self.analysis_channels);
            }
            Err(TrySendError::Full(chunk) | TrySendError::Disconnected(chunk)) => {
                self.pending = chunk.samples;
                self.pending.clear();
            }
        }
    }
}

impl Iterator for VisualizationTap {
    type Item = i16;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;
        self.record(sample);
        Some(sample)
    }
}

impl Source for VisualizationTap {
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, position: Duration) -> Result<(), rodio::source::SeekError> {
        self.inner.try_seek(position)?;
        self.stride_index = 0;
        self.channel_index = 0;
        self.captured_frames = 0;
        self.pending.clear();
        Ok(())
    }
}

/// Owns the overlapping PCM window and every expensive spectral operation.
struct SpectrumProcessor {
    fft: Arc<dyn Fft<f32>>,
    hann: Vec<f32>,
    ring: Vec<i16>,
    write_frame: usize,
    filled_frames: usize,
    buffer: Vec<Complex<f32>>,
    bin_power: Vec<f32>,
    smoothed: [f32; VISUALIZATION_BAR_COUNT],
    revision: Option<u64>,
    sample_rate: u32,
    channels: usize,
}

impl SpectrumProcessor {
    fn new() -> Self {
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);
        let hann = (0..FFT_SIZE)
            .map(|index| 0.5 - 0.5 * (2.0 * PI * index as f32 / (FFT_SIZE - 1) as f32).cos())
            .collect();
        Self {
            fft,
            hann,
            ring: vec![0; FFT_SIZE * 2],
            write_frame: 0,
            filled_frames: 0,
            buffer: vec![Complex::new(0.0, 0.0); FFT_SIZE],
            bin_power: vec![0.0; FFT_SIZE / 2 + 1],
            smoothed: [0.0; VISUALIZATION_BAR_COUNT],
            revision: None,
            sample_rate: 0,
            channels: 0,
        }
    }

    /// Returns true when an old track/seek window was discarded.
    fn ensure_stream(&mut self, revision: u64, sample_rate: u32, channels: usize) -> bool {
        if self.revision == Some(revision)
            && self.sample_rate == sample_rate
            && self.channels == channels
        {
            return false;
        }
        self.revision = Some(revision);
        self.sample_rate = sample_rate;
        self.channels = channels;
        self.ring.fill(0);
        self.write_frame = 0;
        self.filled_frames = 0;
        self.smoothed.fill(0.0);
        true
    }

    fn push_samples(&mut self, samples: &[i16], channels: usize) {
        for frame in samples.chunks_exact(channels) {
            self.ring[self.write_frame * 2] = frame[0];
            self.ring[self.write_frame * 2 + 1] = if channels > 1 { frame[1] } else { frame[0] };
            self.write_frame = (self.write_frame + 1) % FFT_SIZE;
            self.filled_frames = (self.filled_frames + 1).min(FFT_SIZE);
        }
    }

    fn ready(&self) -> bool {
        self.filled_frames == FFT_SIZE
    }

    fn spectrum_bars(&mut self) -> [f32; VISUALIZATION_BAR_COUNT] {
        self.bin_power.fill(0.0);
        let mut sample_power = 0.0_f32;
        for channel in 0..2 {
            for index in 0..FFT_SIZE {
                let frame = (self.write_frame + index) % FFT_SIZE;
                let sample = self.ring[frame * 2 + channel] as f32 / 32768.0;
                sample_power += sample * sample;
                self.buffer[index] = Complex::new(sample * self.hann[index], 0.0);
            }
            self.fft.process(&mut self.buffer);
            for bin in 1..=FFT_SIZE / 2 {
                let amplitude = self.buffer[bin].norm() * (4.0 / FFT_SIZE as f32);
                self.bin_power[bin] += amplitude * amplitude * 0.5;
            }
        }

        let magnitudes = map_bin_power_to_bands(&self.bin_power, self.sample_rate);

        if magnitudes.iter().all(|value| *value <= f32::EPSILON) {
            self.smoothed.fill(0.0);
            return self.smoothed;
        }
        // A mastered song spreads its energy across many FFT bins, so its
        // strongest individual band can be much shorter than a single tone
        // at the same overall loudness. Use one bounded gain for the whole
        // frame, derived from both channels' RMS, rather than normalizing
        // each band or forcing every quiet passage to full height.
        let rms = (sample_power / (FFT_SIZE * 2) as f32).sqrt();
        if rms < 0.004 {
            self.smoothed.fill(0.0);
            return self.smoothed;
        }
        let gain = (6.0 * (rms / 0.20).sqrt()).clamp(1.0, 6.0);
        for (smoothed, magnitude) in self.smoothed.iter_mut().zip(magnitudes) {
            // One shared amplitude curve preserves strong/weak differences.
            // The soft noise gate avoids a jump at its threshold. Tanh lets
            // the tallest bands approach full height without a hard flat top.
            // No per-band auto-gain or frame-peak normalization is applied.
            let gated = (magnitude - 0.003).max(0.0);
            let target = (1.2 * gain * gated.powf(0.65)).tanh();
            let response = if target > *smoothed { 0.7 } else { 0.18 };
            *smoothed += (target - *smoothed) * response;
        }
        self.smoothed
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::sync_channel;

    use super::*;

    fn tone_bars_at_rate(
        sample_rate: u32,
        frequency: f32,
        amplitude: f32,
        inverted_right: bool,
    ) -> [f32; VISUALIZATION_BAR_COUNT] {
        let frames = sample_rate / 3;
        let mut samples = Vec::with_capacity(frames as usize * 2);
        for frame in 0..frames {
            let phase = 2.0 * PI * frequency * frame as f32 / sample_rate as f32;
            let left = (phase.sin() * amplitude * i16::MAX as f32) as i16;
            samples.push(left);
            samples.push(if inverted_right { -left } else { left });
        }
        let source: AudioSource =
            Box::new(rodio::buffer::SamplesBuffer::new(2, sample_rate, samples));
        let (tx, rx) = sync_channel(32);
        let (source, _) = tap_source(source, tx, 7, "tone".to_owned(), 1);
        let _: Vec<_> = source.collect();
        let mut processor = SpectrumProcessor::new();
        let mut result = [0.0; VISUALIZATION_BAR_COUNT];
        for chunk in rx.try_iter() {
            processor.ensure_stream(chunk.revision, chunk.sample_rate, chunk.channels);
            processor.push_samples(&chunk.samples, chunk.channels);
            if processor.ready() {
                result = processor.spectrum_bars();
            }
        }
        result
    }

    fn tone_bars(
        frequency: f32,
        amplitude: f32,
        inverted_right: bool,
    ) -> [f32; VISUALIZATION_BAR_COUNT] {
        tone_bars_at_rate(48_000, frequency, amplitude, inverted_right)
    }

    fn pulse_window(sample_rate: u32, amplitude: f32) -> Vec<i16> {
        let mut samples = Vec::with_capacity(FFT_SIZE * 2);
        for frame in 0..FFT_SIZE {
            let phase = 2.0 * PI * 60.0 * frame as f32 / sample_rate as f32;
            let sample = (phase.sin() * amplitude * i16::MAX as f32) as i16;
            samples.extend([sample, sample]);
        }
        samples
    }

    fn expected_band(frequency: f32) -> usize {
        (((frequency / MIN_FREQUENCY_HZ).ln() / (MAX_FREQUENCY_HZ / MIN_FREQUENCY_HZ).ln())
            * (VISUALIZATION_BAR_COUNT - 1) as f32)
            .round() as usize
    }

    fn dense_mix_bars(target_rms: f32) -> [f32; VISUALIZATION_BAR_COUNT] {
        let sample_rate = 48_000.0_f32;
        let mut raw = [0.0_f32; FFT_SIZE];
        for (frame, sample) in raw.iter_mut().enumerate() {
            let time = frame as f32 / sample_rate;
            for tone in 0..24 {
                let frequency = 65.0 * (10_000.0_f32 / 65.0).powf(tone as f32 / 23.0);
                *sample += (2.0 * PI * frequency * time + tone as f32 * 0.73).sin();
            }
        }
        let original_rms =
            (raw.iter().map(|sample| sample * sample).sum::<f32>() / FFT_SIZE as f32).sqrt();
        let mut stereo = Vec::with_capacity(FFT_SIZE * 2);
        for sample in raw {
            let value =
                ((sample * target_rms / original_rms).clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            stereo.extend([value, value]);
        }
        let mut processor = SpectrumProcessor::new();
        processor.ensure_stream(1, sample_rate as u32, 2);
        processor.push_samples(&stereo, 2);
        let mut result = [0.0; VISUALIZATION_BAR_COUNT];
        for _ in 0..4 {
            result = processor.spectrum_bars();
        }
        result
    }

    #[test]
    fn tones_land_in_separate_log_frequency_bands() {
        for sample_rate in [44_100, 48_000] {
            for frequency in [100.0, 1_000.0, 8_000.0] {
                let bars = tone_bars_at_rate(sample_rate, frequency, 0.7, false);
                let strongest = bars
                    .iter()
                    .enumerate()
                    .max_by(|left, right| left.1.total_cmp(right.1))
                    .expect("48 bands")
                    .0;
                assert!(
                    strongest.abs_diff(expected_band(frequency)) <= 2,
                    "{sample_rate} Hz sample rate, {frequency} Hz tone: strongest band {strongest}, expected {}",
                    expected_band(frequency)
                );
                assert!(bars[strongest] > 0.35);
            }
        }
    }

    #[test]
    fn every_band_has_fft_bin_support_at_common_sample_rates() {
        for sample_rate in [44_100, 48_000] {
            let bin_width = sample_rate as f32 / FFT_SIZE as f32;
            let first_bin = (MIN_FREQUENCY_HZ / bin_width).floor() as usize;
            assert_eq!(first_bin, 4);
            assert!(first_bin as f32 * bin_width < MIN_FREQUENCY_HZ);

            let mut only_lower_edge = vec![0.0; FFT_SIZE / 2 + 1];
            only_lower_edge[first_bin] = 1.0;
            let edge_bars = map_bin_power_to_bands(&only_lower_edge, sample_rate);
            assert!(
                edge_bars[0] > 0.0,
                "{sample_rate} Hz sample rate: no first-band edge support"
            );

            let all_bins = vec![1.0; FFT_SIZE / 2 + 1];
            let bars = map_bin_power_to_bands(&all_bins, sample_rate);
            for (band, value) in bars.iter().enumerate() {
                assert!(
                    *value > 0.0,
                    "{sample_rate} Hz sample rate: band {band} has no FFT support"
                );
            }
        }
    }

    #[test]
    fn low_frequency_pulse_moves_first_bands_and_clears_on_silence() {
        for sample_rate in [44_100, 48_000] {
            let mut processor = SpectrumProcessor::new();
            processor.ensure_stream(1, sample_rate, 2);
            processor.push_samples(&pulse_window(sample_rate, 0.7), 2);
            let loud = processor.spectrum_bars();
            processor.push_samples(&vec![0; FFT_SIZE * 2], 2);
            let silent = processor.spectrum_bars();
            processor.push_samples(&pulse_window(sample_rate, 0.3), 2);
            let quiet = processor.spectrum_bars();

            for band in 0..4 {
                assert!(
                    loud[band] > 0.035,
                    "{sample_rate} Hz sample rate: band {band} stays at baseline ({})",
                    loud[band]
                );
                assert_eq!(silent[band], 0.0);
                assert!(quiet[band] > 0.0);
                assert!(loud[band] > quiet[band], "{sample_rate} Hz sample rate: band {band} did not follow pulse level (loud={}, quiet={})", loud[band], quiet[band]);
            }
            // The fourth of 112 fixed display columns interpolates source
            // bands one and two; it must also respond to the low-frequency pulse.
            let source_position = 3.0 * (VISUALIZATION_BAR_COUNT - 1) as f32 / 111.0;
            let mix = source_position.fract();
            let display_fourth =
                |bars: [f32; VISUALIZATION_BAR_COUNT]| bars[1] * (1.0 - mix) + bars[2] * mix;
            assert!(display_fourth(loud) > display_fourth(quiet));
            assert_eq!(display_fourth(silent), 0.0);
        }
    }

    #[test]
    fn silence_is_zero_and_louder_tone_is_taller() {
        let silent = tone_bars(1_000.0, 0.0, false);
        assert!(silent.iter().all(|value| *value == 0.0));
        let weak = tone_bars(1_000.0, 0.04, false);
        let strong = tone_bars(1_000.0, 0.7, false);
        let band = expected_band(1_000.0);
        assert!(
            strong[band] >= weak[band] * 3.0,
            "strong={}, weak={}",
            strong[band],
            weak[band]
        );
    }

    #[test]
    fn dense_music_like_mix_is_large_without_lifting_quiet_audio() {
        let strong = dense_mix_bars(0.16);
        let weak = dense_mix_bars(0.026);
        let strong_peak = strong.into_iter().fold(0.0_f32, f32::max);
        let weak_peak = weak.into_iter().fold(0.0_f32, f32::max);
        assert!(
            (0.65..=0.95).contains(&strong_peak),
            "strong dense-mix peak={strong_peak}"
        );
        assert!(weak_peak <= 0.20, "weak dense-mix peak={weak_peak}");
        assert!(
            strong_peak >= weak_peak * 3.0,
            "strong={strong_peak}, weak={weak_peak}"
        );
    }

    #[test]
    fn opposite_phase_stereo_does_not_cancel() {
        let normal = tone_bars(1_000.0, 0.6, false);
        let inverted = tone_bars(1_000.0, 0.6, true);
        let band = expected_band(1_000.0);
        assert!((normal[band] - inverted[band]).abs() < 0.02);
    }

    #[test]
    fn silence_and_seek_revision_clear_old_spectrum() {
        let mut processor = SpectrumProcessor::new();
        processor.ensure_stream(1, 48_000, 2);
        let mut tone = Vec::with_capacity(FFT_SIZE * 2);
        for frame in 0..FFT_SIZE {
            let sample = ((2.0 * PI * 1_000.0 * frame as f32 / 48_000.0).sin()
                * 0.7
                * i16::MAX as f32) as i16;
            tone.extend([sample, sample]);
        }
        processor.push_samples(&tone, 2);
        assert!(processor.spectrum_bars().iter().any(|value| *value > 0.1));
        processor.push_samples(&vec![0; FFT_SIZE * 2], 2);
        assert!(processor.spectrum_bars().iter().all(|value| *value == 0.0));
        processor.push_samples(&tone, 2);
        assert!(processor.spectrum_bars().iter().any(|value| *value > 0.1));
        assert!(processor.ensure_stream(2, 48_000, 2));
        assert!(!processor.ready());
        assert!(processor.smoothed.iter().all(|value| *value == 0.0));
    }

    #[test]
    fn replaced_or_seeked_source_frames_are_rejected() {
        let session = VisualizationSession::default();
        let first = session.next_revision();
        session.activate(first);
        assert!(session.is_active(first));
        session.clear();
        assert!(!session.is_active(first));
        let second = session.next_revision();
        session.activate(second);
        assert!(!session.is_active(first));
        assert!(session.is_active(second));
    }

    #[test]
    fn event_payload_matches_frontend_contract() {
        let value = serde_json::to_value(AudioVisualizationFrame {
            generation: 12,
            track_id: "local-track".to_owned(),
            bars: vec![0.0, 0.5, 1.0],
        })
        .expect("frame serializes");
        assert_eq!(value["generation"], 12);
        assert_eq!(value["trackId"], "local-track");
        assert_eq!(value["bars"], serde_json::json!([0.0, 0.5, 1.0]));
    }
}
