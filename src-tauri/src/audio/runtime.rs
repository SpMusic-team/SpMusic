use std::{
    path::PathBuf,
    sync::mpsc::Sender,
    time::{Duration, Instant},
};

use rodio::{
    cpal::{self, traits::HostTrait},
    OutputStream, OutputStreamHandle, Sink,
};

use super::{
    device::current_output_device_signature,
    error::{audio_error, AudioCommandError, AudioErrorCode},
    source::{duration_ms, load_track_ref, open_source},
    types::{
        AudioPlayInput, AudioPlaybackPhase, AudioPlaybackState, AudioSeekInput, AudioTrackRef,
    },
};

pub(crate) enum AudioRuntimeRequest {
    LoadFile {
        path: PathBuf,
        reply: Sender<Result<AudioTrackRef, AudioCommandError>>,
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
        }
    }
}

impl AudioRuntime {
    pub(crate) fn load_path(&mut self, path: PathBuf) -> Result<AudioTrackRef, AudioCommandError> {
        let started_at = Instant::now();
        tracing::info!(
            operation = "audio.runtime.load_path",
            path = %path.display(),
            previous_phase = ?self.phase,
            "loading audio path",
        );
        self.clear_error();
        self.phase = AudioPlaybackPhase::Loading;

        let track = match load_track_ref(&path) {
            Ok(track) => track,
            Err(error) => {
                self.phase = AudioPlaybackPhase::Error;
                self.error = Some(error.clone());
                tracing::warn!(
                    operation = "audio.runtime.load_path",
                    elapsed_ms = started_at.elapsed().as_millis() as u64,
                    error_code = ?error.code,
                    error = %error.message,
                    "failed to load audio path",
                );
                return Err(error);
            }
        };

        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.current_path = Some(path);
        self.current_track = Some(track.clone());
        self.phase = AudioPlaybackPhase::Ready;
        self.accumulated = Duration::ZERO;
        self.started_at = None;
        tracing::info!(
            operation = "audio.runtime.load_path",
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            track_id = %track.id,
            file_name = %track.file_name,
            duration_ms = track.duration_ms,
            "loaded audio path",
        );
        Ok(track)
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

    pub(crate) fn get_state(&mut self) -> AudioPlaybackState {
        self.state()
    }

    pub(crate) fn get_current_track(&self) -> Option<AudioTrackRef> {
        self.current_track.clone()
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
        sink.set_volume(self.volume);
        sink.append(source);
        if !position.is_zero() {
            sink.try_seek(position).map_err(|error| {
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
        }
        if !play {
            sink.pause();
        }
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

fn clamp_position_ms(position_ms: u64, duration_ms: Option<u64>) -> Duration {
    let target_ms = duration_ms
        .map(|duration_ms| position_ms.min(duration_ms))
        .unwrap_or(position_ms);
    Duration::from_millis(target_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

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
