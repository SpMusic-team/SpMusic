use std::{
    path::{Path, PathBuf},
    sync::mpsc::{Receiver, Sender},
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
    source::{hydrate_track_ref, open_source, AudioSource},
    types::{
        AudioPlayInput, AudioPlaybackPhase, AudioPlaybackState, AudioSeekInput,
        AudioSetVolumeInput, AudioTrackRef,
    },
};

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
    TrackParsed {
        generation: u64,
        path: PathBuf,
        result: Box<Result<AudioTrackRef, AudioCommandError>>,
    },
    Play {
        input: Option<AudioPlayInput>,
        reply: Sender<Result<AudioPlaybackState, AudioCommandError>>,
    },
    Pause {
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
}

pub(crate) fn start_track_parser(
    rx: Receiver<TrackParseRequest>,
    runtime_tx: Sender<AudioRuntimeRequest>,
    cover_cache_dir: PathBuf,
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
            let result = hydrate_track_ref(&request.path, Some(&cover_cache_dir));
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
            if runtime_tx
                .send(AudioRuntimeRequest::TrackParsed {
                    generation: request.generation,
                    path: request.path,
                    result: Box::new(result),
                })
                .is_err()
            {
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
    error: Option<AudioCommandError>,
    output_device_signature: Option<String>,
    output_device_change_pending: bool,
    pending_load_generation: Option<u64>,
    load_generation: u64,
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
            error: None,
            output_device_signature: current_output_device_signature(),
            output_device_change_pending: false,
            pending_load_generation: None,
            load_generation: 0,
        }
    }
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
        tracing::info!(
            operation = "audio.runtime.start_load",
            path = %path.display(),
            generation,
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            "asynchronous audio load started",
        );
        generation
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

    pub(crate) fn stop(&mut self) -> Result<AudioPlaybackState, AudioCommandError> {
        let started_at = Instant::now();
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

        apply_volume_to_sink(self.sink.as_ref(), volume);
        self.volume = volume;
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
        stop_and_take_sink(&mut self.sink);
        self.current_path = None;
        self.current_track = None;
        self.accumulated = Duration::ZERO;
        self.started_at = None;
    }

    pub(crate) fn handle_output_device_interruption(&mut self) -> AudioPlaybackState {
        let started_at = Instant::now();
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
        apply_volume_to_sink(Some(&sink), self.volume);
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
            current_track_id: self.current_track.as_ref().map(|track| track.id.clone()),
            position_ms: duration_ms(position),
            duration_ms: self
                .current_track
                .as_ref()
                .and_then(|track| track.duration_ms),
            volume: self.volume,
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
        let _parser_handle = start_track_parser(parser_rx, runtime_tx, std::env::temp_dir());

        let missing = std::env::temp_dir().join(format!(
            "spmusic-parser-missing-{}-{}.mp3",
            std::process::id(),
            line!()
        ));
        parser_tx
            .send(TrackParseRequest {
                generation: 11,
                path: missing.clone(),
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
