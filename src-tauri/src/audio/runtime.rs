use std::{
    path::{Path, PathBuf},
    sync::{
        mpsc::{Receiver, Sender},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use rodio::{
    cpal::{self, traits::HostTrait},
    OutputStream, OutputStreamHandle, Sink,
};

use super::{
    device::current_output_device_signature,
    duration::duration_ms,
    error::{audio_error, AudioCommandError, AudioErrorCode},
    lyrics_cache::LyricsCache,
    source::{
        hydrate_track_ref, open_source, open_source_fast, playback_track_ref,
        validate_existing_file, AudioSource,
    },
    types::{
        AudioLoadAndPlayResult, AudioPlayInput, AudioPlaybackPhase, AudioPlaybackState,
        AudioSeekInput, AudioSetVolumeInput, AudioTrackRef, AudioTransitionPlaybackInput,
        AudioTransportTarget, AudioTransportTransition,
    },
};

const MAX_TRANSPORT_TRANSITION_MS: u64 = 5_000;
pub(crate) const TRANSPORT_TRANSITION_TICK: Duration = Duration::from_millis(12);

trait RebuiltSink {
    fn pause_for_preparation(&self);
    fn append_source(&self, source: AudioSource);
    fn seek_to(&self, position: Duration) -> Result<(), rodio::source::SeekError>;
    fn start_playback(&self);
}

trait StoppableSink {
    fn stop_sink(&self);
}

trait VolumeSink {
    fn set_sink_volume(&self, volume: f32);
}

impl StoppableSink for Sink {
    fn stop_sink(&self) {
        self.stop();
    }
}

impl VolumeSink for Sink {
    fn set_sink_volume(&self, volume: f32) {
        self.set_volume(volume);
    }
}

fn stop_and_take_sink<S: StoppableSink>(slot: &mut Option<S>) {
    if let Some(sink) = slot.take() {
        sink.stop_sink();
    }
}

fn apply_volume_to_sink<S: VolumeSink>(sink: Option<&S>, volume: f32) {
    if let Some(sink) = sink {
        sink.set_sink_volume(volume);
    }
}

impl RebuiltSink for Sink {
    fn pause_for_preparation(&self) {
        self.pause();
    }

    fn append_source(&self, source: AudioSource) {
        self.append(source);
    }

    fn seek_to(&self, position: Duration) -> Result<(), rodio::source::SeekError> {
        self.try_seek(position)
    }

    fn start_playback(&self) {
        self.play();
    }
}

pub(crate) enum AudioRuntimeRequest {
    LoadFile {
        path: PathBuf,
        reply: Sender<Result<AudioTrackRef, AudioCommandError>>,
    },
    LoadAndPlay {
        path: PathBuf,
        request_id: u64,
        reply: Sender<Result<AudioLoadAndPlayResult, AudioCommandError>>,
    },
    TrackParsed {
        generation: u64,
        path: PathBuf,
        result: Box<Result<AudioTrackRef, AudioCommandError>>,
    },
    TrackDetailsHydrated {
        request_id: u64,
        generation: u64,
        track_id: String,
        result: Box<Result<AudioTrackRef, AudioCommandError>>,
    },
    Play {
        input: Option<AudioPlayInput>,
        reply: Sender<Result<AudioPlaybackState, AudioCommandError>>,
    },
    Pause {
        reply: Sender<Result<AudioPlaybackState, AudioCommandError>>,
    },
    TransitionPlayback {
        input: AudioTransitionPlaybackInput,
        reply: Sender<Result<AudioPlaybackState, AudioCommandError>>,
    },
    Stop {
        reply: Sender<Result<AudioPlaybackState, AudioCommandError>>,
    },
    Seek {
        input: AudioSeekInput,
        reply: Sender<Result<AudioPlaybackState, AudioCommandError>>,
    },
    SetVolume {
        input: AudioSetVolumeInput,
        reply: Sender<Result<AudioPlaybackState, AudioCommandError>>,
    },
    GetState {
        reply: Sender<AudioPlaybackState>,
    },
    GetCurrentTrack {
        reply: Sender<Option<AudioTrackRef>>,
    },
    OutputDeviceInterrupted,
    OutputDeviceChanged {
        signature: Option<String>,
    },
}

pub(crate) struct TrackParseRequest {
    pub generation: u64,
    pub path: PathBuf,
    pub purpose: TrackParsePurpose,
}

pub(crate) enum TrackParsePurpose {
    LegacyLoad,
    Details { request_id: u64, track_id: String },
}

pub(crate) fn start_track_parser(
    rx: Receiver<TrackParseRequest>,
    runtime_tx: Sender<AudioRuntimeRequest>,
    cover_cache_dir: PathBuf,
    lyrics_cache: Arc<LyricsCache>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        tracing::info!(
            operation = "audio.parser.thread",
            "started track parser worker",
        );
        while let Ok(request) = rx.recv() {
            let started_at = Instant::now();
            tracing::info!(
                operation = "audio.parser.parse",
                path = %request.path.display(),
                generation = request.generation,
                "parsing audio track on worker",
            );
            let result =
                hydrate_track_ref(&request.path, Some(&cover_cache_dir), Some(&lyrics_cache));
            let elapsed_ms = started_at.elapsed().as_millis() as u64;
            match &result {
                Ok(track) => tracing::info!(
                    operation = "audio.parser.parse",
                    elapsed_ms,
                    path = %request.path.display(),
                    generation = request.generation,
                    track_id = %track.id,
                    duration_ms = track.duration_ms,
                    "audio track parsed",
                ),
                Err(error) => tracing::warn!(
                    operation = "audio.parser.parse",
                    elapsed_ms,
                    path = %request.path.display(),
                    generation = request.generation,
                    error_code = ?error.code,
                    error = %error.message,
                    "audio track parse failed",
                ),
            }
            let message = match request.purpose {
                TrackParsePurpose::LegacyLoad => AudioRuntimeRequest::TrackParsed {
                    generation: request.generation,
                    path: request.path,
                    result: Box::new(result),
                },
                TrackParsePurpose::Details {
                    request_id,
                    track_id,
                } => AudioRuntimeRequest::TrackDetailsHydrated {
                    request_id,
                    generation: request.generation,
                    track_id,
                    result: Box::new(result),
                },
            };
            if runtime_tx.send(message).is_err() {
                tracing::warn!(
                    operation = "audio.parser.thread",
                    "audio runtime channel closed while returning parse result",
                );
                break;
            }
        }
        tracing::info!(
            operation = "audio.parser.thread",
            "track parser worker stopped",
        );
    })
}

pub(crate) struct AudioRuntime {
    stream: Option<OutputStream>,
    stream_handle: Option<OutputStreamHandle>,
    sink: Option<Sink>,
    current_track: Option<AudioTrackRef>,
    current_path: Option<PathBuf>,
    phase: AudioPlaybackPhase,
    accumulated: Duration,
    started_at: Option<Instant>,
    volume: f32,
    transport_gain: f32,
    transport_envelope: Option<TransportEnvelope>,
    latest_transport_request_id: Option<u64>,
    transport_settled_request_id: Option<u64>,
    error: Option<AudioCommandError>,
    output_device_signature: Option<String>,
    output_device_change_pending: bool,
    pending_load_generation: Option<u64>,
    load_generation: u64,
    current_generation: Option<u64>,
}

impl Default for AudioRuntime {
    fn default() -> Self {
        Self {
            stream: None,
            stream_handle: None,
            sink: None,
            current_track: None,
            current_path: None,
            phase: AudioPlaybackPhase::Idle,
            accumulated: Duration::ZERO,
            started_at: None,
            volume: 1.0,
            transport_gain: 1.0,
            transport_envelope: None,
            latest_transport_request_id: None,
            transport_settled_request_id: None,
            error: None,
            output_device_signature: current_output_device_signature(),
            output_device_change_pending: false,
            pending_load_generation: None,
            load_generation: 0,
            current_generation: None,
        }
    }
}

#[derive(Debug, Clone)]
struct TransportEnvelope {
    transition: AudioTransportTransition,
    from_gain: f32,
    to_gain: f32,
    started_at: Instant,
    duration: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct TransportEnvelopeSample {
    gain: f32,
    completed_target: Option<AudioTransportTarget>,
}

impl TransportEnvelope {
    fn sample_at(&self, now: Instant) -> TransportEnvelopeSample {
        let elapsed = now.saturating_duration_since(self.started_at);
        let progress = if self.duration.is_zero() {
            1.0
        } else {
            (elapsed.as_secs_f64() / self.duration.as_secs_f64()).clamp(0.0, 1.0) as f32
        };
        let gain = self.from_gain + (self.to_gain - self.from_gain) * progress;
        TransportEnvelopeSample {
            gain: gain.clamp(0.0, 1.0),
            completed_target: (progress >= 1.0).then_some(self.transition.target),
        }
    }
}

fn play_transition_start_gain(
    was_already_playing: bool,
    needs_rebuild: bool,
    current_gain: f32,
) -> f32 {
    if needs_rebuild || !was_already_playing {
        0.0
    } else {
        current_gain.clamp(0.0, 1.0)
    }
}

fn scaled_transport_duration_ms(base_duration_ms: u64, from_gain: f32, to_gain: f32) -> u64 {
    ((base_duration_ms as f64) * f64::from((to_gain - from_gain).abs().clamp(0.0, 1.0))).round()
        as u64
}

impl AudioRuntime {
    pub(crate) fn start_load(&mut self, path: &Path) -> u64 {
        let started_at = Instant::now();
        let generation = self.load_generation;
        self.load_generation = self.load_generation.saturating_add(1);
        tracing::info!(
            operation = "audio.runtime.start_load",
            path = %path.display(),
            generation,
            previous_phase = ?self.phase,
            "starting asynchronous audio load",
        );
        self.clear_error();
        // Selecting a new path is a replacement operation, not a speculative
        // probe. Invalidate the previous source before any fallible parsing so
        // a rejected file can never resume the old sink on a later Play call.
        self.invalidate_loaded_audio();
        self.phase = AudioPlaybackPhase::Loading;
        self.pending_load_generation = Some(generation);
        self.current_generation = Some(generation);
        tracing::info!(
            operation = "audio.runtime.start_load",
            path = %path.display(),
            generation,
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            "asynchronous audio load started",
        );
        generation
    }

    pub(crate) fn load_and_play(
        &mut self,
        path: PathBuf,
        request_id: u64,
    ) -> Result<AudioLoadAndPlayResult, AudioCommandError> {
        let started_at = Instant::now();
        let generation = self.load_generation;
        self.load_generation = self.load_generation.saturating_add(1);
        tracing::info!(
            operation = "audio.transaction.load_and_play.start",
            path = %path.display(),
            request_id,
            generation,
            previous_phase = ?self.phase,
            "audio load-and-play transaction started",
        );

        self.clear_error();
        self.pending_load_generation = None;
        self.current_generation = Some(generation);
        self.invalidate_loaded_audio();
        self.phase = AudioPlaybackPhase::Loading;

        let preparation = (|| {
            validate_existing_file(&path)?;
            let normalized_path = path.canonicalize().map_err(|error| {
                audio_error(
                    AudioErrorCode::UnreadableFile,
                    format!("Failed to normalize audio path: {error}"),
                    true,
                )
            })?;
            let source = open_source_fast(&normalized_path)?;
            let source_duration = source.total_duration();
            let track = playback_track_ref(&normalized_path, source_duration);
            tracing::info!(
                operation = "audio.transaction.load_and_play.source_ready",
                path = %normalized_path.display(),
                request_id,
                generation,
                track_id = %track.id,
                duration_ms = track.duration_ms,
                elapsed_ms = started_at.elapsed().as_millis() as u64,
                "audio source ready for playback",
            );

            let handle = self.ensure_output()?;
            let sink = Sink::try_new(handle).map_err(|error| {
                audio_error(
                    AudioErrorCode::PlaybackInitFailed,
                    format!("Failed to create audio sink: {error}"),
                    true,
                )
            })?;
            apply_volume_to_sink(Some(&sink), self.volume * self.transport_gain);
            configure_rebuilt_sink(&sink, source, Duration::ZERO, true).map_err(|error| {
                audio_error(
                    AudioErrorCode::PlaybackFailed,
                    format!("Failed to start audio source: {error}"),
                    true,
                )
            })?;
            Ok::<_, AudioCommandError>((normalized_path, track, sink))
        })();

        let (normalized_path, track, sink) = match preparation {
            Ok(prepared) => prepared,
            Err(error) => {
                self.phase = AudioPlaybackPhase::Error;
                self.error = Some(error.clone());
                tracing::warn!(
                    operation = "audio.transaction.load_and_play.end",
                    path = %path.display(),
                    request_id,
                    generation,
                    error_code = ?error.code,
                    error = %error.message,
                    elapsed_ms = started_at.elapsed().as_millis() as u64,
                    "audio load-and-play transaction failed",
                );
                return Err(error);
            }
        };

        let track_id = track.id.clone();
        let file_name = track.file_name.clone();
        self.current_path = Some(normalized_path);
        self.current_track = Some(track);
        self.sink = Some(sink);
        self.accumulated = Duration::ZERO;
        self.started_at = Some(Instant::now());
        self.phase = AudioPlaybackPhase::Playing;
        let state = self.state();
        tracing::info!(
            operation = "audio.transaction.load_and_play.playing",
            request_id,
            generation,
            track_id = %track_id,
            phase = ?state.phase,
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            "audio load-and-play transaction entered playing",
        );

        Ok(AudioLoadAndPlayResult {
            request_id,
            generation,
            track_id,
            file_name,
            state,
        })
    }

    pub(crate) fn apply_track_details(
        &mut self,
        generation: u64,
        track_id: &str,
        result: &Result<AudioTrackRef, AudioCommandError>,
    ) -> bool {
        if self.current_generation != Some(generation)
            || self
                .current_track
                .as_ref()
                .is_none_or(|track| track.id != track_id)
        {
            tracing::debug!(
                operation = "audio.runtime.apply_track_details",
                generation,
                current_generation = self.current_generation,
                track_id,
                current_track_id = self.current_track.as_ref().map(|track| track.id.as_str()),
                "suppressed stale audio track details",
            );
            return false;
        }

        if let Ok(track) = result {
            self.current_track = Some(track.clone());
        }
        true
    }

    pub(crate) fn complete_load(
        &mut self,
        generation: u64,
        path: PathBuf,
        result: &Result<AudioTrackRef, AudioCommandError>,
    ) -> bool {
        if self.pending_load_generation != Some(generation) {
            tracing::debug!(
                operation = "audio.runtime.complete_load",
                generation,
                pending_generation = self.pending_load_generation,
                "ignored stale audio parse result",
            );
            return false;
        }
        self.pending_load_generation = None;
        let started_at = Instant::now();
        match result {
            Ok(track) => {
                tracing::info!(
                    operation = "audio.runtime.complete_load",
                    path = %path.display(),
                    generation,
                    track_id = %track.id,
                    file_name = %track.file_name,
                    duration_ms = track.duration_ms,
                    "audio parse completed",
                );
                self.current_path = Some(path);
                self.current_track = Some(track.clone());
                self.phase = AudioPlaybackPhase::Ready;
                self.accumulated = Duration::ZERO;
                self.started_at = None;
            }
            Err(error) => {
                tracing::warn!(
                    operation = "audio.runtime.complete_load",
                    path = %path.display(),
                    generation,
                    error_code = ?error.code,
                    error = %error.message,
                    elapsed_ms = started_at.elapsed().as_millis() as u64,
                    "audio parse failed",
                );
                self.phase = AudioPlaybackPhase::Error;
                self.error = Some(error.clone());
            }
        }
        true
    }

    pub(crate) fn play(
        &mut self,
        input: Option<AudioPlayInput>,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        let started_at = Instant::now();
        self.cancel_transport_transition(true);
        self.clear_error();
        let restart = input.and_then(|value| value.restart).unwrap_or(false);
        tracing::info!(
            operation = "audio.runtime.play",
            restart,
            phase = ?self.phase,
            position_ms = duration_ms(self.position()),
            track_id = self.current_track.as_ref().map(|track| track.id.as_str()),
            "play requested",
        );

        if self.current_path.is_none() {
            return self.fail(
                AudioErrorCode::NoTrackLoaded,
                "No audio track is loaded",
                true,
            );
        }

        if restart {
            self.accumulated = Duration::ZERO;
            self.rebuild_sink(self.accumulated, true)?;
        } else if self.sink.is_none()
            || matches!(
                self.phase,
                AudioPlaybackPhase::Stopped | AudioPlaybackPhase::Ended
            )
        {
            if matches!(
                self.phase,
                AudioPlaybackPhase::Stopped | AudioPlaybackPhase::Ended
            ) {
                self.accumulated = Duration::ZERO;
            }
            self.rebuild_sink(self.accumulated, true)?;
        } else if let Some(sink) = &self.sink {
            sink.play();
        }

        self.phase = AudioPlaybackPhase::Playing;
        self.started_at = Some(Instant::now());
        let state = self.state();
        tracing::info!(
            operation = "audio.runtime.play",
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            phase = ?state.phase,
            position_ms = state.position_ms,
            duration_ms = state.duration_ms,
            "play completed",
        );
        Ok(state)
    }

    pub(crate) fn pause(&mut self) -> Result<AudioPlaybackState, AudioCommandError> {
        let started_at = Instant::now();
        self.cancel_transport_transition(true);
        self.clear_error();
        tracing::info!(
            operation = "audio.runtime.pause",
            phase = ?self.phase,
            position_ms = duration_ms(self.position()),
            track_id = self.current_track.as_ref().map(|track| track.id.as_str()),
            "pause requested",
        );
        if matches!(self.phase, AudioPlaybackPhase::Loading) {
            tracing::debug!(
                operation = "audio.runtime.pause",
                "pause is a no-op while loading",
            );
            return Ok(self.state());
        }
        if self.current_path.is_none() {
            return self.fail(
                AudioErrorCode::NoTrackLoaded,
                "No audio track is loaded",
                true,
            );
        }
        self.accumulated = self.position();
        if let Some(sink) = &self.sink {
            sink.pause();
        }
        self.started_at = None;
        self.phase = AudioPlaybackPhase::Paused;
        let state = self.state();
        tracing::info!(
            operation = "audio.runtime.pause",
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            phase = ?state.phase,
            position_ms = state.position_ms,
            "pause completed",
        );
        Ok(state)
    }

    pub(crate) fn transition_playback(
        &mut self,
        input: AudioTransitionPlaybackInput,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        if input.duration_ms > MAX_TRANSPORT_TRANSITION_MS {
            return Err(audio_error(
                AudioErrorCode::UnsupportedOperation,
                format!(
                    "Playback transition duration must be between 0 and {MAX_TRANSPORT_TRANSITION_MS} ms"
                ),
                true,
            ));
        }
        let current_track_id = self
            .current_track
            .as_ref()
            .map(|track| track.id.as_str())
            .ok_or_else(|| {
                audio_error(
                    AudioErrorCode::NoTrackLoaded,
                    "No audio track is loaded",
                    true,
                )
            })?;
        if current_track_id != input.expected_track_id {
            return Err(audio_error(
                AudioErrorCode::UnsupportedOperation,
                format!(
                    "Playback transition targets stale track '{}' while '{}' is current",
                    input.expected_track_id, current_track_id
                ),
                true,
            ));
        }

        // Request ids are a per-track monotonic fence. An out-of-order reply
        // from the frontend must never rewind a newer audible envelope.
        if self
            .latest_transport_request_id
            .is_some_and(|latest_request_id| input.request_id <= latest_request_id)
        {
            return Ok(self.state());
        }
        self.latest_transport_request_id = Some(input.request_id);

        self.clear_error();
        // Sample the old envelope before replacing it so opposite-direction
        // requests continue from the audible gain without a discontinuity.
        self.advance_transport_transition(Instant::now());
        self.transport_envelope = None;

        match input.target {
            AudioTransportTarget::Playing => self.start_play_transition(input),
            AudioTransportTarget::Paused => self.start_pause_transition(input),
        }
    }

    fn start_play_transition(
        &mut self,
        input: AudioTransitionPlaybackInput,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        if matches!(self.phase, AudioPlaybackPhase::Playing)
            && (self.transport_gain - 1.0).abs() <= f32::EPSILON
        {
            self.settle_transport_request(input.request_id);
            return Ok(self.state());
        }

        let was_already_playing = matches!(self.phase, AudioPlaybackPhase::Playing);
        let previous_gain = self.transport_gain;
        let needs_rebuild = self.sink.is_none()
            || matches!(
                self.phase,
                AudioPlaybackPhase::Stopped | AudioPlaybackPhase::Ended
            );
        if needs_rebuild {
            if matches!(
                self.phase,
                AudioPlaybackPhase::Stopped | AudioPlaybackPhase::Ended
            ) {
                self.accumulated = Duration::ZERO;
            }
            self.transport_gain = 0.0;
            if let Err(error) = self.rebuild_sink(self.accumulated, false) {
                self.transport_gain = 1.0;
                self.apply_effective_volume();
                return Err(error);
            }
        }

        // A stable paused/stopped source always begins a fade-in from silence.
        // Only an opposite-direction replacement while audio is already
        // running inherits the current gain.
        let from_gain =
            play_transition_start_gain(was_already_playing, needs_rebuild, previous_gain);
        self.transport_gain = from_gain;
        self.apply_effective_volume();
        if let Some(sink) = &self.sink {
            // The effective gain is applied before resuming, preventing a
            // full-volume first buffer on a fade-in.
            sink.play();
        } else {
            self.transport_gain = 1.0;
            return Err(audio_error(
                AudioErrorCode::PlaybackInitFailed,
                "Audio sink is unavailable after playback preparation",
                true,
            ));
        }
        self.phase = AudioPlaybackPhase::Playing;
        self.started_at = Some(Instant::now());
        self.install_transport_envelope(input, from_gain, 1.0);
        Ok(self.state())
    }

    fn start_pause_transition(
        &mut self,
        input: AudioTransitionPlaybackInput,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        if matches!(self.phase, AudioPlaybackPhase::Paused) {
            self.transport_gain = 0.0;
            self.apply_effective_volume();
            self.settle_transport_request(input.request_id);
            return Ok(self.state());
        }
        if !matches!(self.phase, AudioPlaybackPhase::Playing) {
            // Match legacy pause behavior for ready/stopped sources without
            // inventing an audible ramp when no source is advancing.
            if let Some(sink) = &self.sink {
                sink.pause();
            }
            self.started_at = None;
            self.phase = AudioPlaybackPhase::Paused;
            self.transport_gain = 0.0;
            self.apply_effective_volume();
            self.settle_transport_request(input.request_id);
            return Ok(self.state());
        }

        let from_gain = self.transport_gain;
        self.install_transport_envelope(input, from_gain, 0.0);
        Ok(self.state())
    }

    fn install_transport_envelope(
        &mut self,
        input: AudioTransitionPlaybackInput,
        from_gain: f32,
        to_gain: f32,
    ) {
        let actual_duration_ms =
            scaled_transport_duration_ms(input.duration_ms, from_gain, to_gain);
        let transition = AudioTransportTransition {
            request_id: input.request_id,
            target: input.target,
            duration_ms: actual_duration_ms,
        };
        if actual_duration_ms == 0 {
            self.transport_gain = to_gain;
            self.apply_effective_volume();
            self.complete_transport_target(input.target, input.request_id);
            return;
        }
        self.transport_envelope = Some(TransportEnvelope {
            transition,
            from_gain,
            to_gain,
            started_at: Instant::now(),
            duration: Duration::from_millis(actual_duration_ms),
        });
    }

    pub(crate) fn has_transport_transition(&self) -> bool {
        self.transport_envelope.is_some()
    }

    /// Advances the envelope on the runtime owner thread. Returns true only
    /// when a transition completed and callers should emit the final state.
    pub(crate) fn advance_transport_transition(&mut self, now: Instant) -> bool {
        let Some(envelope) = self.transport_envelope.as_ref() else {
            return false;
        };
        if self.latest_transport_request_id != Some(envelope.transition.request_id) {
            self.transport_envelope = None;
            return false;
        }
        let sample = envelope.sample_at(now);
        self.transport_gain = sample.gain;
        self.apply_effective_volume();
        let Some(target) = sample.completed_target else {
            return false;
        };
        let request_id = envelope.transition.request_id;
        self.transport_envelope = None;
        self.complete_transport_target(target, request_id);
        true
    }

    fn complete_transport_target(&mut self, target: AudioTransportTarget, request_id: u64) {
        if self.latest_transport_request_id != Some(request_id) {
            return;
        }
        match target {
            AudioTransportTarget::Playing => {
                self.transport_gain = 1.0;
                self.apply_effective_volume();
                self.phase = AudioPlaybackPhase::Playing;
            }
            AudioTransportTarget::Paused => {
                self.accumulated = self.position();
                if let Some(sink) = &self.sink {
                    sink.pause();
                }
                self.started_at = None;
                self.phase = AudioPlaybackPhase::Paused;
                self.transport_gain = 0.0;
                self.apply_effective_volume();
            }
        }
        self.settle_transport_request(request_id);
    }

    fn settle_transport_request(&mut self, request_id: u64) {
        if self.latest_transport_request_id == Some(request_id) {
            self.transport_settled_request_id = Some(request_id);
        }
    }

    pub(crate) fn stop(&mut self) -> Result<AudioPlaybackState, AudioCommandError> {
        let started_at = Instant::now();
        self.cancel_transport_transition(true);
        self.clear_error();
        tracing::info!(
            operation = "audio.runtime.stop",
            phase = ?self.phase,
            position_ms = duration_ms(self.position()),
            track_id = self.current_track.as_ref().map(|track| track.id.as_str()),
            "stop requested",
        );
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.accumulated = Duration::ZERO;
        self.started_at = None;
        self.phase = if self.current_track.is_some() {
            AudioPlaybackPhase::Stopped
        } else {
            AudioPlaybackPhase::Idle
        };
        let state = self.state();
        tracing::info!(
            operation = "audio.runtime.stop",
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            phase = ?state.phase,
            "stop completed",
        );
        Ok(state)
    }

    pub(crate) fn seek(
        &mut self,
        input: AudioSeekInput,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        let started_at = Instant::now();
        self.cancel_transport_transition(true);
        self.clear_error();
        if matches!(self.phase, AudioPlaybackPhase::Loading) {
            tracing::debug!(
                operation = "audio.runtime.seek",
                "seek is a no-op while loading",
            );
            return Ok(self.state());
        }
        if self.current_path.is_none() {
            return self.fail(
                AudioErrorCode::NoTrackLoaded,
                "No audio track is loaded",
                true,
            );
        }

        let target = clamp_position_ms(
            input.position_ms,
            self.current_track
                .as_ref()
                .and_then(|track| track.duration_ms),
        );
        let should_play = matches!(self.phase, AudioPlaybackPhase::Playing);
        tracing::info!(
            operation = "audio.runtime.seek",
            requested_ms = input.position_ms,
            target_ms = duration_ms(target),
            current_ms = duration_ms(self.position()),
            duration_ms = self.current_track.as_ref().and_then(|track| track.duration_ms),
            track_id = self.current_track.as_ref().map(|track| track.id.as_str()),
            phase = ?self.phase,
            should_play,
            "seek requested",
        );

        if should_play {
            if let Some(sink) = &self.sink {
                match sink.try_seek(target) {
                    Ok(()) => {
                        tracing::debug!(
                            operation = "audio.runtime.seek",
                            requested_ms = input.position_ms,
                            target_ms = duration_ms(target),
                            "sink seek succeeded",
                        );
                        sink.play();
                    }
                    Err(error) => {
                        tracing::debug!(
                            operation = "audio.runtime.seek",
                            requested_ms = input.position_ms,
                            target_ms = duration_ms(target),
                            error = %error,
                            "sink seek failed, rebuilding audio source at target position",
                        );
                        self.rebuild_sink(target, true)?;
                    }
                }
            } else {
                self.rebuild_sink(target, true)?;
            }
        } else {
            self.rebuild_sink(target, false)?;
        }

        self.accumulated = target;
        self.started_at = should_play.then(Instant::now);
        self.phase = if should_play {
            AudioPlaybackPhase::Playing
        } else {
            AudioPlaybackPhase::Paused
        };
        let state = self.state();
        tracing::info!(
            operation = "audio.runtime.seek",
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            requested_ms = input.position_ms,
            target_ms = duration_ms(target),
            result_ms = state.position_ms,
            duration_ms = state.duration_ms,
            phase = ?state.phase,
            "seek completed",
        );
        Ok(state)
    }

    pub(crate) fn set_volume(
        &mut self,
        input: AudioSetVolumeInput,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        let volume = input.volume;
        tracing::info!(
            operation = "audio.runtime.set_volume",
            requested_volume = volume,
            previous_volume = self.volume,
            has_sink = self.sink.is_some(),
            "volume change requested",
        );

        if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
            let error = audio_error(
                AudioErrorCode::InvalidVolume,
                "Volume must be a finite number between 0.0 and 1.0 inclusive",
                true,
            );
            tracing::warn!(
                operation = "audio.runtime.set_volume",
                requested_volume = volume,
                error_code = ?error.code,
                error = %error.message,
                "volume change rejected",
            );
            return Err(error);
        }

        self.volume = volume;
        self.apply_effective_volume();
        let state = self.state();
        tracing::info!(
            operation = "audio.runtime.set_volume",
            volume = state.volume,
            phase = ?state.phase,
            "volume change completed",
        );
        Ok(state)
    }

    pub(crate) fn get_state(&mut self) -> AudioPlaybackState {
        self.state()
    }

    pub(crate) fn get_current_track(&self) -> Option<AudioTrackRef> {
        self.current_track.clone()
    }

    fn invalidate_loaded_audio(&mut self) {
        self.cancel_transport_transition(false);
        self.transport_gain = 1.0;
        self.latest_transport_request_id = None;
        self.transport_settled_request_id = None;
        stop_and_take_sink(&mut self.sink);
        self.current_path = None;
        self.current_track = None;
        self.accumulated = Duration::ZERO;
        self.started_at = None;
    }

    fn apply_effective_volume(&self) {
        apply_volume_to_sink(
            self.sink.as_ref(),
            (self.volume * self.transport_gain).clamp(0.0, 1.0),
        );
    }

    fn cancel_transport_transition(&mut self, restore_gain: bool) {
        self.transport_envelope = None;
        if restore_gain {
            self.transport_gain = 1.0;
            self.apply_effective_volume();
        }
    }

    pub(crate) fn handle_output_device_interruption(&mut self) -> AudioPlaybackState {
        let started_at = Instant::now();
        self.cancel_transport_transition(true);
        let had_output =
            self.sink.is_some() || self.stream_handle.is_some() || self.stream.is_some();
        let was_playing = matches!(self.phase, AudioPlaybackPhase::Playing);
        self.output_device_change_pending = true;
        tracing::info!(
            operation = "audio.runtime.output_device_interrupted",
            phase = ?self.phase,
            position_ms = duration_ms(self.position()),
            had_output,
            "handling immediate output device interruption",
        );

        if had_output || was_playing {
            self.release_output_for_device_change();
        }

        let state = self.state();
        tracing::info!(
            operation = "audio.runtime.output_device_interrupted",
            phase = ?state.phase,
            position_ms = state.position_ms,
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            "handled immediate output device interruption",
        );
        state
    }

    pub(crate) fn handle_output_device_change(
        &mut self,
        current_signature: Option<String>,
    ) -> AudioPlaybackState {
        let started_at = Instant::now();
        self.cancel_transport_transition(true);
        let previous_signature = self.output_device_signature.clone();
        let interruption_already_handled = std::mem::take(&mut self.output_device_change_pending);
        tracing::info!(
            operation = "audio.runtime.output_device_change",
            previous_signature = previous_signature.as_deref(),
            interruption_already_handled,
            phase = ?self.phase,
            position_ms = duration_ms(self.position()),
            "handling output device change",
        );

        if current_signature == previous_signature {
            let state = self.state();
            tracing::info!(
                operation = "audio.runtime.output_device_change",
                previous_signature = previous_signature.as_deref(),
                current_signature = current_signature.as_deref(),
                interruption_already_handled,
                phase = ?state.phase,
                position_ms = state.position_ms,
                elapsed_ms = started_at.elapsed().as_millis() as u64,
                "ignored unchanged output device signature",
            );
            return state;
        }

        self.output_device_signature = current_signature;
        if !interruption_already_handled
            && (self.sink.is_some() || self.stream_handle.is_some() || self.stream.is_some())
        {
            self.release_output_for_device_change();
        }
        let state = self.state();
        tracing::info!(
            operation = "audio.runtime.output_device_change",
            previous_signature = previous_signature.as_deref(),
            current_signature = self.output_device_signature.as_deref(),
            interruption_already_handled,
            phase = ?state.phase,
            position_ms = state.position_ms,
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            "handled output device change",
        );
        state
    }

    fn release_output_for_device_change(&mut self) {
        let started_at = Instant::now();
        let was_playing = matches!(self.phase, AudioPlaybackPhase::Playing);
        if was_playing {
            self.accumulated = self.position();
            self.started_at = None;
            self.phase = AudioPlaybackPhase::Paused;
        }

        let sink_release_started_at = Instant::now();
        let had_sink = self.sink.is_some();
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        let sink_release_elapsed_ms = sink_release_started_at.elapsed().as_millis() as u64;

        let stream_release_started_at = Instant::now();
        let had_stream = self.stream.is_some();
        self.stream_handle = None;
        self.stream = None;
        let stream_release_elapsed_ms = stream_release_started_at.elapsed().as_millis() as u64;
        tracing::info!(
            operation = "audio.runtime.release_output_for_device_change",
            was_playing,
            had_sink,
            had_stream,
            phase = ?self.phase,
            position_ms = duration_ms(self.accumulated),
            sink_release_elapsed_ms,
            stream_release_elapsed_ms,
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            "released audio output for device change",
        );
    }

    fn ensure_output(&mut self) -> Result<&OutputStreamHandle, AudioCommandError> {
        if self.stream_handle.is_none() {
            let started_at = Instant::now();
            tracing::info!(
                operation = "audio.runtime.ensure_output",
                "initializing default output stream",
            );
            let device_lookup_started_at = Instant::now();
            let device = cpal::default_host()
                .default_output_device()
                .ok_or_else(|| {
                    tracing::warn!(
                        operation = "audio.runtime.ensure_output",
                        elapsed_ms = started_at.elapsed().as_millis() as u64,
                        device_lookup_elapsed_ms =
                            device_lookup_started_at.elapsed().as_millis() as u64,
                        "default output device is unavailable",
                    );
                    audio_error(
                        AudioErrorCode::PlaybackInitFailed,
                        "No default audio output device is available",
                        true,
                    )
                })?;
            let device_lookup_elapsed_ms = device_lookup_started_at.elapsed().as_millis() as u64;
            let stream_init_started_at = Instant::now();
            let (stream, stream_handle) =
                OutputStream::try_from_device(&device).map_err(|error| {
                    tracing::warn!(
                        operation = "audio.runtime.ensure_output",
                        elapsed_ms = started_at.elapsed().as_millis() as u64,
                        device_lookup_elapsed_ms,
                        stream_init_elapsed_ms =
                            stream_init_started_at.elapsed().as_millis() as u64,
                        error = %error,
                        "failed to initialize default output stream",
                    );
                    audio_error(
                        AudioErrorCode::PlaybackInitFailed,
                        format!("Failed to initialize audio output: {error}"),
                        true,
                    )
                })?;
            let stream_init_elapsed_ms = stream_init_started_at.elapsed().as_millis() as u64;
            self.stream = Some(stream);
            self.stream_handle = Some(stream_handle);
            tracing::info!(
                operation = "audio.runtime.ensure_output",
                output_device_signature = self.output_device_signature.as_deref(),
                device_lookup_elapsed_ms,
                stream_init_elapsed_ms,
                elapsed_ms = started_at.elapsed().as_millis() as u64,
                "initialized default output stream",
            );
        }
        self.stream_handle.as_ref().ok_or_else(|| {
            tracing::error!(
                operation = "audio.runtime.ensure_output",
                "audio output handle is unavailable after initialization",
            );
            audio_error(
                AudioErrorCode::InternalError,
                "Audio output handle is unavailable",
                true,
            )
        })
    }

    fn rebuild_sink(&mut self, position: Duration, play: bool) -> Result<(), AudioCommandError> {
        let started_at = Instant::now();
        let path = self.current_path.clone().ok_or_else(|| {
            audio_error(
                AudioErrorCode::NoTrackLoaded,
                "No audio track is loaded",
                true,
            )
        })?;
        tracing::info!(
            operation = "audio.runtime.rebuild_sink",
            path = %path.display(),
            position_ms = duration_ms(position),
            play,
            "rebuilding audio sink",
        );
        let handle = self.ensure_output()?;
        let sink = Sink::try_new(handle).map_err(|error| {
            tracing::warn!(
                operation = "audio.runtime.rebuild_sink",
                path = %path.display(),
                error = %error,
                "failed to create audio sink",
            );
            audio_error(
                AudioErrorCode::PlaybackInitFailed,
                format!("Failed to create audio sink: {error}"),
                true,
            )
        })?;
        let source = open_source(&path)?;

        if let Some(previous) = self.sink.take() {
            previous.stop();
        }
        apply_volume_to_sink(Some(&sink), self.volume * self.transport_gain);
        configure_rebuilt_sink(&sink, source, position, play).map_err(|error| {
            tracing::warn!(
                operation = "audio.runtime.rebuild_sink",
                path = %path.display(),
                position_ms = duration_ms(position),
                error = %error,
                "failed to seek rebuilt audio sink",
            );
            audio_error(
                AudioErrorCode::UnsupportedOperation,
                format!("Audio source does not support seeking: {error}"),
                true,
            )
        })?;
        self.sink = Some(sink);
        tracing::info!(
            operation = "audio.runtime.rebuild_sink",
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            position_ms = duration_ms(position),
            play,
            "rebuilt audio sink",
        );
        Ok(())
    }

    fn state(&mut self) -> AudioPlaybackState {
        if matches!(self.phase, AudioPlaybackPhase::Playing) {
            if let Some(sink) = &self.sink {
                if sink.empty() {
                    self.transport_envelope = None;
                    self.transport_gain = 1.0;
                    self.phase = AudioPlaybackPhase::Ended;
                    self.started_at = None;
                    if let Some(duration_ms) = self
                        .current_track
                        .as_ref()
                        .and_then(|track| track.duration_ms)
                    {
                        self.accumulated = Duration::from_millis(duration_ms);
                    }
                }
            }
        }
        let position = self.position();

        AudioPlaybackState {
            phase: self.phase,
            generation: self.current_generation,
            current_track_id: self.current_track.as_ref().map(|track| track.id.clone()),
            position_ms: duration_ms(position),
            duration_ms: self
                .current_track
                .as_ref()
                .and_then(|track| track.duration_ms),
            volume: self.volume,
            transport_transition: self
                .transport_envelope
                .as_ref()
                .map(|envelope| envelope.transition.clone()),
            transport_settled_request_id: self.transport_settled_request_id,
            error: self.error.clone(),
        }
    }

    fn position(&self) -> Duration {
        let base = self.accumulated;
        let playing_delta = if matches!(self.phase, AudioPlaybackPhase::Playing) {
            self.started_at
                .map(|started_at| started_at.elapsed())
                .unwrap_or_default()
        } else {
            Duration::ZERO
        };
        let position = base.saturating_add(playing_delta);
        if let Some(duration_ms) = self
            .current_track
            .as_ref()
            .and_then(|track| track.duration_ms)
        {
            position.min(Duration::from_millis(duration_ms))
        } else {
            position
        }
    }

    fn fail<T>(
        &mut self,
        code: AudioErrorCode,
        message: impl Into<String>,
        recoverable: bool,
    ) -> Result<T, AudioCommandError> {
        let error = audio_error(code, message, recoverable);
        tracing::warn!(
            operation = "audio.runtime.fail",
            error_code = ?error.code,
            recoverable = error.recoverable,
            error = %error.message,
            "audio runtime entered error state",
        );
        self.phase = AudioPlaybackPhase::Error;
        self.error = Some(error.clone());
        Err(error)
    }

    fn clear_error(&mut self) {
        self.error = None;
    }
}

fn configure_rebuilt_sink(
    sink: &impl RebuiltSink,
    source: AudioSource,
    position: Duration,
    play: bool,
) -> Result<(), rodio::source::SeekError> {
    // `rodio::Sink::try_new` starts in the playing state. Pause before
    // appending the source so a paused seek cannot leak samples while the
    // decoder is being positioned. Playing seeks resume only after the seek
    // has completed.
    sink.pause_for_preparation();
    sink.append_source(source);
    if !position.is_zero() {
        sink.seek_to(position)?;
    }
    if play {
        sink.start_playback();
    }
    Ok(())
}

fn clamp_position_ms(position_ms: u64, duration_ms: Option<u64>) -> Duration {
    let target_ms = duration_ms
        .map(|duration_ms| position_ms.min(duration_ms))
        .unwrap_or(position_ms);
    Duration::from_millis(target_ms)
}

#[cfg(test)]
mod tests {
    use std::{
        cell::{Cell, RefCell},
        rc::Rc,
        sync::mpsc,
        time::{SystemTime, UNIX_EPOCH},
    };

    use rodio::source::Zero;

    use super::*;

    #[derive(Debug, PartialEq, Eq)]
    enum SinkAction {
        Pause,
        Append,
        Seek(Duration),
        Play,
    }

    #[derive(Default)]
    struct RecordingSink {
        actions: RefCell<Vec<SinkAction>>,
    }

    impl RebuiltSink for RecordingSink {
        fn pause_for_preparation(&self) {
            self.actions.borrow_mut().push(SinkAction::Pause);
        }

        fn append_source(&self, source: AudioSource) {
            drop(source);
            self.actions.borrow_mut().push(SinkAction::Append);
        }

        fn seek_to(&self, position: Duration) -> Result<(), rodio::source::SeekError> {
            self.actions.borrow_mut().push(SinkAction::Seek(position));
            Ok(())
        }

        fn start_playback(&self) {
            self.actions.borrow_mut().push(SinkAction::Play);
        }
    }

    fn silent_test_source() -> AudioSource {
        Box::new(Zero::<i16>::new_samples(2, 44_100, 2))
    }

    struct RecordingStopSink(Rc<Cell<bool>>);

    impl StoppableSink for RecordingStopSink {
        fn stop_sink(&self) {
            self.0.set(true);
        }
    }

    #[derive(Default)]
    struct RecordingVolumeSink {
        volume: Cell<Option<f32>>,
    }

    #[test]
    fn runtime_request_does_not_inline_parsed_track_metadata() {
        assert!(
            std::mem::size_of::<AudioRuntimeRequest>() < std::mem::size_of::<AudioTrackRef>(),
            "parsed track results should stay behind indirection in runtime messages"
        );
    }

    impl VolumeSink for RecordingVolumeSink {
        fn set_sink_volume(&self, volume: f32) {
            self.volume.set(Some(volume));
        }
    }

    fn loaded_test_track() -> AudioTrackRef {
        AudioTrackRef {
            id: "old-track".to_string(),
            source_path: "old.flac".to_string(),
            file_name: "old.flac".to_string(),
            duration_ms: Some(60_000),
            metadata: crate::audio::types::AudioTrackMetadata::default(),
        }
    }

    #[test]
    fn paused_seek_prepares_sink_without_starting_audio_output() {
        let sink = RecordingSink::default();
        let position = Duration::from_secs(12);

        configure_rebuilt_sink(&sink, silent_test_source(), position, false)
            .expect("paused seek sink should be configured");

        assert_eq!(
            *sink.actions.borrow(),
            vec![
                SinkAction::Pause,
                SinkAction::Append,
                SinkAction::Seek(position),
            ]
        );
    }

    #[test]
    fn playing_seek_starts_only_after_source_is_positioned() {
        let sink = RecordingSink::default();
        let position = Duration::from_secs(12);

        configure_rebuilt_sink(&sink, silent_test_source(), position, true)
            .expect("playing seek sink should be configured");

        assert_eq!(
            *sink.actions.borrow(),
            vec![
                SinkAction::Pause,
                SinkAction::Append,
                SinkAction::Seek(position),
                SinkAction::Play,
            ]
        );
    }

    #[test]
    fn stop_and_take_sink_stops_before_discarding_the_slot() {
        let stopped = Rc::new(Cell::new(false));
        let mut slot = Some(RecordingStopSink(Rc::clone(&stopped)));

        stop_and_take_sink(&mut slot);

        assert!(stopped.get());
        assert!(slot.is_none());
    }

    #[test]
    fn volume_change_is_applied_to_an_existing_sink_immediately() {
        let sink = RecordingVolumeSink::default();

        apply_volume_to_sink(Some(&sink), 0.35);

        assert_eq!(sink.volume.get(), Some(0.35));
    }

    #[test]
    fn set_volume_without_sink_updates_runtime_and_returned_state() {
        let mut runtime = AudioRuntime::default();

        let state = runtime
            .set_volume(AudioSetVolumeInput { volume: 0.4 })
            .expect("valid normalized volume should be accepted");

        assert_eq!(runtime.volume, 0.4);
        assert_eq!(state.volume, 0.4);
        assert_eq!(state.phase, AudioPlaybackPhase::Idle);
    }

    #[test]
    fn stored_volume_is_used_for_a_later_sink_rebuild() {
        let mut runtime = AudioRuntime::default();
        runtime
            .set_volume(AudioSetVolumeInput { volume: 0.25 })
            .expect("valid normalized volume should be accepted");
        let rebuilt_sink = RecordingVolumeSink::default();

        apply_volume_to_sink(Some(&rebuilt_sink), runtime.volume);

        assert_eq!(rebuilt_sink.volume.get(), Some(0.25));
    }

    #[test]
    fn set_volume_accepts_normalized_range_boundaries() {
        let mut runtime = AudioRuntime::default();

        let muted = runtime
            .set_volume(AudioSetVolumeInput { volume: 0.0 })
            .expect("zero volume should be accepted");
        let full = runtime
            .set_volume(AudioSetVolumeInput { volume: 1.0 })
            .expect("full volume should be accepted");

        assert_eq!(muted.volume, 0.0);
        assert_eq!(full.volume, 1.0);
    }

    #[test]
    fn set_volume_rejects_invalid_values_without_mutating_runtime_state() {
        for invalid_volume in [-0.01, 1.01, f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut runtime = AudioRuntime {
                phase: AudioPlaybackPhase::Paused,
                volume: 0.6,
                ..AudioRuntime::default()
            };

            let error = runtime
                .set_volume(AudioSetVolumeInput {
                    volume: invalid_volume,
                })
                .expect_err("invalid volume should be rejected");

            assert_eq!(error.code, AudioErrorCode::InvalidVolume);
            assert!(error.recoverable);
            assert_eq!(runtime.volume, 0.6);
            assert_eq!(runtime.phase, AudioPlaybackPhase::Paused);
            assert!(runtime.error.is_none());
        }
    }

    fn transition_input(
        request_id: u64,
        target: AudioTransportTarget,
        duration_ms: u64,
    ) -> AudioTransitionPlaybackInput {
        AudioTransitionPlaybackInput {
            request_id,
            expected_track_id: "old-track".to_owned(),
            target,
            duration_ms,
        }
    }

    #[test]
    fn pause_transition_keeps_playing_until_ramp_deadline() {
        let mut runtime = AudioRuntime {
            current_track: Some(loaded_test_track()),
            phase: AudioPlaybackPhase::Playing,
            started_at: Some(Instant::now()),
            ..AudioRuntime::default()
        };
        let accepted = runtime
            .transition_playback(transition_input(1, AudioTransportTarget::Paused, 500))
            .expect("pause transition should be accepted");
        let started_at = runtime.transport_envelope.as_ref().unwrap().started_at;

        assert_eq!(accepted.phase, AudioPlaybackPhase::Playing);
        assert!(accepted.transport_transition.is_some());
        assert!(!runtime.advance_transport_transition(started_at + Duration::from_millis(499)));
        assert_eq!(runtime.phase, AudioPlaybackPhase::Playing);
        assert!(runtime.advance_transport_transition(started_at + Duration::from_millis(500)));
        assert_eq!(runtime.phase, AudioPlaybackPhase::Paused);
        assert_eq!(runtime.transport_gain, 0.0);
        assert!(runtime.get_state().transport_transition.is_none());
    }

    #[test]
    fn play_envelope_has_no_full_volume_first_frame() {
        let started_at = Instant::now();
        let envelope = TransportEnvelope {
            transition: AudioTransportTransition {
                request_id: 2,
                target: AudioTransportTarget::Playing,
                duration_ms: 500,
            },
            from_gain: 0.0,
            to_gain: 1.0,
            started_at,
            duration: Duration::from_millis(500),
        };

        assert_eq!(envelope.sample_at(started_at).gain, 0.0);
        assert_eq!(play_transition_start_gain(false, false, 1.0), 0.0);
        assert_eq!(play_transition_start_gain(false, true, 1.0), 0.0);
        assert_eq!(play_transition_start_gain(true, false, 0.4), 0.4);
        assert_eq!(
            envelope
                .sample_at(started_at + Duration::from_millis(250))
                .gain,
            0.5
        );
        assert_eq!(
            envelope
                .sample_at(started_at + Duration::from_millis(500))
                .completed_target,
            Some(AudioTransportTarget::Playing)
        );
    }

    #[test]
    fn user_volume_is_not_polluted_by_transport_gain() {
        let mut runtime = AudioRuntime {
            transport_gain: 0.25,
            ..AudioRuntime::default()
        };

        let state = runtime
            .set_volume(AudioSetVolumeInput { volume: 0.6 })
            .expect("volume should remain independently writable during fade");

        assert_eq!(runtime.transport_gain, 0.25);
        assert_eq!(runtime.volume, 0.6);
        assert_eq!(state.volume, 0.6);
    }

    #[test]
    fn zero_duration_pause_is_immediate_and_has_no_transition_state() {
        let mut runtime = AudioRuntime {
            current_track: Some(loaded_test_track()),
            phase: AudioPlaybackPhase::Playing,
            started_at: Some(Instant::now()),
            ..AudioRuntime::default()
        };

        let state = runtime
            .transition_playback(transition_input(3, AudioTransportTarget::Paused, 0))
            .expect("zero duration transition should be accepted");

        assert_eq!(state.phase, AudioPlaybackPhase::Paused);
        assert!(state.transport_transition.is_none());
        assert_eq!(state.transport_settled_request_id, Some(3));
        assert_eq!(runtime.transport_gain, 0.0);
    }

    #[test]
    fn interrupted_envelopes_reverse_continuously_with_remaining_distance_duration() {
        let mut runtime = AudioRuntime {
            current_track: Some(loaded_test_track()),
            phase: AudioPlaybackPhase::Playing,
            started_at: Some(Instant::now()),
            volume: 0.63,
            ..AudioRuntime::default()
        };

        runtime.latest_transport_request_id = Some(10);
        runtime.install_transport_envelope(
            transition_input(10, AudioTransportTarget::Paused, 500),
            1.0,
            0.0,
        );
        let pause_started_at = runtime.transport_envelope.as_ref().unwrap().started_at;
        assert!(
            !runtime.advance_transport_transition(pause_started_at + Duration::from_millis(250))
        );
        assert!((runtime.transport_gain - 0.5).abs() < 0.001);

        runtime.latest_transport_request_id = Some(11);
        runtime.install_transport_envelope(
            transition_input(11, AudioTransportTarget::Playing, 500),
            runtime.transport_gain,
            1.0,
        );
        let play_envelope = runtime.transport_envelope.as_ref().unwrap();
        assert!((play_envelope.from_gain - 0.5).abs() < 0.001);
        assert_eq!(play_envelope.transition.duration_ms, 250);
        assert_eq!(play_envelope.duration, Duration::from_millis(250));
        let play_started_at = play_envelope.started_at;
        assert!(!runtime.advance_transport_transition(play_started_at + Duration::from_millis(125)));
        assert!((runtime.transport_gain - 0.75).abs() < 0.001);

        runtime.latest_transport_request_id = Some(12);
        runtime.install_transport_envelope(
            transition_input(12, AudioTransportTarget::Paused, 500),
            runtime.transport_gain,
            0.0,
        );
        let second_pause = runtime.transport_envelope.as_ref().unwrap();
        assert!((second_pause.from_gain - 0.75).abs() < 0.001);
        assert_eq!(second_pause.transition.duration_ms, 375);
        assert_eq!(runtime.volume, 0.63);
    }

    #[test]
    fn out_of_order_or_duplicate_request_cannot_replace_latest_envelope() {
        let mut runtime = AudioRuntime {
            current_track: Some(loaded_test_track()),
            phase: AudioPlaybackPhase::Playing,
            started_at: Some(Instant::now()),
            ..AudioRuntime::default()
        };
        runtime
            .transition_playback(transition_input(22, AudioTransportTarget::Paused, 500))
            .expect("latest transition should be accepted");
        let started_at = runtime.transport_envelope.as_ref().unwrap().started_at;
        runtime.advance_transport_transition(started_at + Duration::from_millis(100));
        let gain_before_stale_request = runtime.transport_gain;
        let envelope_before_stale_request = runtime.transport_envelope.clone().unwrap();

        for stale_request_id in [21, 22] {
            let state = runtime
                .transition_playback(transition_input(
                    stale_request_id,
                    AudioTransportTarget::Playing,
                    500,
                ))
                .expect("stale transition should be suppressed as a no-op");
            let envelope = runtime.transport_envelope.as_ref().unwrap();
            assert_eq!(envelope.transition.request_id, 22);
            assert_eq!(
                envelope.started_at,
                envelope_before_stale_request.started_at
            );
            assert!((runtime.transport_gain - gain_before_stale_request).abs() < f32::EPSILON);
            assert_eq!(state.transport_transition.unwrap().request_id, 22);
        }
    }

    #[test]
    fn only_latest_completion_updates_settled_request_id() {
        let mut runtime = AudioRuntime {
            current_track: Some(loaded_test_track()),
            phase: AudioPlaybackPhase::Playing,
            started_at: Some(Instant::now()),
            ..AudioRuntime::default()
        };
        runtime.latest_transport_request_id = Some(31);
        runtime.install_transport_envelope(
            transition_input(31, AudioTransportTarget::Paused, 500),
            1.0,
            0.0,
        );
        let started_at = runtime.transport_envelope.as_ref().unwrap().started_at;

        runtime.latest_transport_request_id = Some(32);
        let phase_before_stale_completion = runtime.phase;
        let gain_before_stale_completion = runtime.transport_gain;
        runtime.complete_transport_target(AudioTransportTarget::Paused, 31);
        assert_eq!(runtime.transport_settled_request_id, None);
        assert_eq!(runtime.phase, phase_before_stale_completion);
        assert_eq!(runtime.transport_gain, gain_before_stale_completion);

        runtime.phase = AudioPlaybackPhase::Playing;
        runtime.started_at = Some(Instant::now());
        runtime.transport_gain = 1.0;
        runtime.latest_transport_request_id = Some(31);
        runtime.transport_envelope = Some(TransportEnvelope {
            transition: AudioTransportTransition {
                request_id: 31,
                target: AudioTransportTarget::Paused,
                duration_ms: 500,
            },
            from_gain: 1.0,
            to_gain: 0.0,
            started_at,
            duration: Duration::from_millis(500),
        });
        assert!(runtime.advance_transport_transition(started_at + Duration::from_millis(500)));
        assert_eq!(runtime.transport_settled_request_id, Some(31));
        assert_eq!(runtime.get_state().transport_settled_request_id, Some(31));
    }

    #[test]
    fn cancellation_preserves_request_fence_until_track_is_replaced() {
        let mut runtime = AudioRuntime {
            current_track: Some(loaded_test_track()),
            phase: AudioPlaybackPhase::Playing,
            started_at: Some(Instant::now()),
            ..AudioRuntime::default()
        };
        runtime
            .transition_playback(transition_input(40, AudioTransportTarget::Paused, 500))
            .expect("transition should start");
        runtime.stop().expect("stop should cancel transition");
        let phase_after_stop = runtime.phase;

        runtime
            .transition_playback(transition_input(40, AudioTransportTarget::Playing, 500))
            .expect("duplicate request after cancellation should be ignored");
        assert_eq!(runtime.phase, phase_after_stop);
        assert!(runtime.transport_envelope.is_none());
        assert_eq!(runtime.latest_transport_request_id, Some(40));

        runtime.invalidate_loaded_audio();
        assert_eq!(runtime.latest_transport_request_id, None);
        assert_eq!(runtime.transport_settled_request_id, None);
    }

    #[test]
    fn duration_scales_to_remaining_normalized_gain_distance() {
        assert_eq!(scaled_transport_duration_ms(500, 0.5, 1.0), 250);
        assert_eq!(scaled_transport_duration_ms(500, 0.25, 0.0), 125);
        assert_eq!(scaled_transport_duration_ms(500, 0.333, 1.0), 333);
        assert_eq!(scaled_transport_duration_ms(0, 0.0, 1.0), 0);
        assert_eq!(scaled_transport_duration_ms(500, 0.4, 0.4), 0);
    }

    #[test]
    fn legacy_cancel_restores_transport_gain() {
        let mut runtime = AudioRuntime {
            current_track: Some(loaded_test_track()),
            phase: AudioPlaybackPhase::Playing,
            started_at: Some(Instant::now()),
            ..AudioRuntime::default()
        };
        runtime
            .transition_playback(transition_input(4, AudioTransportTarget::Paused, 500))
            .expect("pause transition should be accepted");
        let started_at = runtime.transport_envelope.as_ref().unwrap().started_at;
        runtime.advance_transport_transition(started_at + Duration::from_millis(250));
        assert!((runtime.transport_gain - 0.5).abs() < 0.001);

        runtime.stop().expect("legacy stop should cancel fade");

        assert_eq!(runtime.transport_gain, 1.0);
        assert!(runtime.transport_envelope.is_none());
    }

    #[test]
    fn latest_same_target_restarts_continuously_from_current_gain() {
        let mut runtime = AudioRuntime {
            current_track: Some(loaded_test_track()),
            phase: AudioPlaybackPhase::Playing,
            started_at: Some(Instant::now()),
            ..AudioRuntime::default()
        };
        runtime
            .transition_playback(transition_input(5, AudioTransportTarget::Paused, 500))
            .expect("first pause transition should be accepted");
        runtime.transport_envelope.as_mut().unwrap().started_at =
            Instant::now() - Duration::from_millis(200);
        runtime.advance_transport_transition(Instant::now());
        let continuous_gain = runtime.transport_gain;

        let state = runtime
            .transition_playback(transition_input(6, AudioTransportTarget::Paused, 500))
            .expect("latest transition should replace the prior request");

        let envelope = runtime.transport_envelope.as_ref().unwrap();
        assert_eq!(envelope.transition.request_id, 6);
        assert!((envelope.from_gain - continuous_gain).abs() < 0.01);
        assert_eq!(state.transport_transition.unwrap().request_id, 6);
    }

    #[test]
    fn stale_track_transition_is_rejected_without_mutating_runtime() {
        let mut runtime = AudioRuntime {
            current_track: Some(loaded_test_track()),
            phase: AudioPlaybackPhase::Playing,
            transport_gain: 0.7,
            ..AudioRuntime::default()
        };
        let before_phase = runtime.phase;
        let before_gain = runtime.transport_gain;
        let mut input = transition_input(7, AudioTransportTarget::Paused, 500);
        input.expected_track_id = "stale-track".to_owned();

        let error = runtime
            .transition_playback(input)
            .expect_err("stale track transition should be rejected");

        assert_eq!(error.code, AudioErrorCode::UnsupportedOperation);
        assert_eq!(runtime.phase, before_phase);
        assert_eq!(runtime.transport_gain, before_gain);
        assert!(runtime.transport_envelope.is_none());
        assert!(runtime.error.is_none());
    }

    #[test]
    fn failed_replacement_invalidates_playing_and_paused_tracks() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "spmusic-failed-load-state-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("test directory should be created");

        for phase in [AudioPlaybackPhase::Playing, AudioPlaybackPhase::Paused] {
            let path = root.join(format!("unsupported-{phase:?}.mp3"));
            std::fs::write(&path, b"not an audio stream")
                .expect("unsupported fixture should be written");
            let mut runtime = AudioRuntime {
                current_path: Some(PathBuf::from("old.flac")),
                current_track: Some(loaded_test_track()),
                phase,
                accumulated: Duration::from_secs(12),
                started_at: matches!(phase, AudioPlaybackPhase::Playing).then(Instant::now),
                ..AudioRuntime::default()
            };

            let generation = runtime.start_load(&path);
            let unsupported_error = audio_error(
                AudioErrorCode::UnsupportedFormat,
                "unsupported replacement",
                true,
            );
            let applied = runtime.complete_load(generation, path, &Err(unsupported_error));
            assert!(applied, "matching generation should be applied");
            assert_eq!(runtime.phase, AudioPlaybackPhase::Error);
            assert!(runtime.sink.is_none());
            assert!(runtime.current_path.is_none());
            assert!(runtime.current_track.is_none());
            assert_eq!(runtime.accumulated, Duration::ZERO);
            assert!(runtime.started_at.is_none());
            assert_eq!(
                runtime.error.as_ref().map(|error| error.code),
                Some(AudioErrorCode::UnsupportedFormat)
            );
            assert_eq!(runtime.pending_load_generation, None);

            let play_error = runtime
                .play(None)
                .expect_err("failed replacement must leave no playable track");
            assert_eq!(play_error.code, AudioErrorCode::NoTrackLoaded);
            assert!(runtime.sink.is_none());
            assert!(runtime.current_path.is_none());
            assert!(runtime.current_track.is_none());
        }

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn start_load_enters_loading_and_invalidates_previous_track() {
        let mut runtime = AudioRuntime {
            current_path: Some(PathBuf::from("old.flac")),
            current_track: Some(loaded_test_track()),
            phase: AudioPlaybackPhase::Paused,
            accumulated: Duration::from_secs(12),
            ..AudioRuntime::default()
        };

        let generation = runtime.start_load(Path::new("new.flac"));

        assert_eq!(generation, 0);
        assert_eq!(runtime.phase, AudioPlaybackPhase::Loading);
        assert!(runtime.current_path.is_none());
        assert!(runtime.current_track.is_none());
        assert_eq!(runtime.accumulated, Duration::ZERO);
        assert_eq!(runtime.pending_load_generation, Some(0));
        assert_eq!(runtime.load_generation, 1);
    }

    #[test]
    fn complete_load_applies_ready_track_for_matching_generation() {
        let mut runtime = AudioRuntime::default();
        let generation = runtime.start_load(Path::new("song.flac"));
        let track = loaded_test_track();

        let applied =
            runtime.complete_load(generation, PathBuf::from("song.flac"), &Ok(track.clone()));

        assert!(applied);
        assert_eq!(runtime.phase, AudioPlaybackPhase::Ready);
        assert_eq!(runtime.current_path, Some(PathBuf::from("song.flac")));
        let stored = runtime
            .current_track
            .as_ref()
            .expect("current track should be set after a successful load");
        assert_eq!(stored.id, track.id);
        assert_eq!(stored.source_path, track.source_path);
        assert_eq!(stored.duration_ms, track.duration_ms);
        assert_eq!(runtime.accumulated, Duration::ZERO);
        assert_eq!(runtime.pending_load_generation, None);
    }

    #[test]
    fn stale_generation_parse_result_is_ignored() {
        let mut runtime = AudioRuntime::default();
        let generation = runtime.start_load(Path::new("song.flac"));

        let applied = runtime.complete_load(
            generation.wrapping_add(1),
            PathBuf::from("song.flac"),
            &Ok(loaded_test_track()),
        );

        assert!(!applied);
        assert_eq!(runtime.phase, AudioPlaybackPhase::Loading);
        assert!(runtime.current_track.is_none());
        assert!(runtime.current_path.is_none());
        assert_eq!(runtime.pending_load_generation, Some(generation));
    }

    #[test]
    fn stale_track_details_are_suppressed_without_changing_playback() {
        let mut runtime = AudioRuntime {
            current_track: Some(loaded_test_track()),
            current_generation: Some(9),
            phase: AudioPlaybackPhase::Playing,
            started_at: Some(Instant::now()),
            ..AudioRuntime::default()
        };
        let mut stale_track = loaded_test_track();
        stale_track.metadata.title = Some("stale title".to_owned());

        let applied = runtime.apply_track_details(8, "old-track", &Ok(stale_track));

        assert!(!applied);
        assert_eq!(runtime.phase, AudioPlaybackPhase::Playing);
        assert_eq!(runtime.current_track.as_ref().unwrap().metadata.title, None);
    }

    #[test]
    fn current_track_details_failure_does_not_interrupt_playback() {
        let mut runtime = AudioRuntime {
            current_track: Some(loaded_test_track()),
            current_generation: Some(9),
            phase: AudioPlaybackPhase::Playing,
            started_at: Some(Instant::now()),
            ..AudioRuntime::default()
        };
        let details_error =
            audio_error(AudioErrorCode::UnreadableFile, "details unavailable", true);

        let applied = runtime.apply_track_details(9, "old-track", &Err(details_error));

        assert!(applied);
        assert_eq!(runtime.phase, AudioPlaybackPhase::Playing);
        assert!(runtime.error.is_none());
        assert!(runtime.current_track.is_some());
    }

    #[test]
    fn pause_during_loading_is_a_noop() {
        let mut runtime = AudioRuntime {
            phase: AudioPlaybackPhase::Loading,
            pending_load_generation: Some(7),
            ..AudioRuntime::default()
        };

        let state = runtime
            .pause()
            .expect("pause during loading should be a no-op");

        assert_eq!(state.phase, AudioPlaybackPhase::Loading);
        assert_eq!(runtime.phase, AudioPlaybackPhase::Loading);
        assert!(runtime.error.is_none());
        assert_eq!(runtime.pending_load_generation, Some(7));
    }

    #[test]
    fn seek_during_loading_is_a_noop() {
        let mut runtime = AudioRuntime {
            phase: AudioPlaybackPhase::Loading,
            pending_load_generation: Some(7),
            ..AudioRuntime::default()
        };

        let state = runtime
            .seek(AudioSeekInput { position_ms: 5_000 })
            .expect("seek during loading should be a no-op");

        assert_eq!(state.phase, AudioPlaybackPhase::Loading);
        assert_eq!(runtime.phase, AudioPlaybackPhase::Loading);
        assert!(runtime.error.is_none());
        assert_eq!(runtime.pending_load_generation, Some(7));
    }

    #[test]
    fn track_parser_worker_forwards_results_to_the_runtime_channel() {
        let (runtime_tx, runtime_rx) = mpsc::channel::<AudioRuntimeRequest>();
        let (parser_tx, parser_rx) = mpsc::channel::<TrackParseRequest>();
        let _parser_handle = start_track_parser(
            parser_rx,
            runtime_tx,
            std::env::temp_dir(),
            std::sync::Arc::new(LyricsCache::new(LyricsCache::MAX_LYRICS_CACHE_ENTRIES)),
        );

        let missing = std::env::temp_dir().join(format!(
            "spmusic-parser-missing-{}-{}.mp3",
            std::process::id(),
            line!()
        ));
        parser_tx
            .send(TrackParseRequest {
                generation: 11,
                path: missing.clone(),
                purpose: TrackParsePurpose::LegacyLoad,
            })
            .expect("parser request should send");

        match runtime_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(AudioRuntimeRequest::TrackParsed {
                generation,
                path,
                result,
            }) => {
                assert_eq!(generation, 11);
                assert_eq!(path, missing);
                assert!(matches!(
                    *result,
                    Err(error) if error.code == AudioErrorCode::FileNotFound
                ));
            }
            _ => panic!("expected TrackParsed from parser worker"),
        }
    }

    #[test]
    fn clamp_position_ms_limits_seek_to_track_duration() {
        assert_eq!(
            clamp_position_ms(12_000, Some(5_000)),
            Duration::from_millis(5_000)
        );
    }

    #[test]
    fn clamp_position_ms_keeps_open_ended_track_position() {
        assert_eq!(
            clamp_position_ms(12_000, None),
            Duration::from_millis(12_000)
        );
    }

    #[test]
    fn unchanged_output_device_signature_does_not_pause_playback() {
        let mut runtime = AudioRuntime {
            phase: AudioPlaybackPhase::Playing,
            started_at: Some(Instant::now()),
            output_device_signature: current_output_device_signature(),
            ..AudioRuntime::default()
        };

        let signature = current_output_device_signature();
        let state = runtime.handle_output_device_change(signature);

        assert_eq!(state.phase, AudioPlaybackPhase::Playing);
        assert!(runtime.started_at.is_some());
    }

    #[test]
    fn output_device_interruption_pauses_playback_immediately() {
        let mut runtime = AudioRuntime {
            phase: AudioPlaybackPhase::Playing,
            accumulated: Duration::from_secs(12),
            started_at: Some(Instant::now()),
            ..AudioRuntime::default()
        };

        let state = runtime.handle_output_device_interruption();

        assert_eq!(state.phase, AudioPlaybackPhase::Paused);
        assert!(runtime.started_at.is_none());
        assert!(runtime.output_device_change_pending);
    }

    #[test]
    fn delayed_device_change_settlement_does_not_pause_resumed_playback_again() {
        let mut runtime = AudioRuntime {
            output_device_signature: Some("old-device".to_string()),
            phase: AudioPlaybackPhase::Playing,
            started_at: Some(Instant::now()),
            ..AudioRuntime::default()
        };

        runtime.handle_output_device_interruption();

        // The user may resume while the bridge is still coalescing Windows
        // notifications and probing the new default device.
        runtime.phase = AudioPlaybackPhase::Playing;
        runtime.started_at = Some(Instant::now());
        let state = runtime.handle_output_device_change(Some("new-device".to_string()));

        assert_eq!(state.phase, AudioPlaybackPhase::Playing);
        assert!(runtime.started_at.is_some());
        assert!(!runtime.output_device_change_pending);
    }
}
