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
    OutputDeviceChanged,
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
        }
    }
}

impl AudioRuntime {
    pub(crate) fn load_path(&mut self, path: PathBuf) -> Result<AudioTrackRef, AudioCommandError> {
        self.clear_error();
        self.phase = AudioPlaybackPhase::Loading;

        let track = match load_track_ref(&path) {
            Ok(track) => track,
            Err(error) => {
                self.phase = AudioPlaybackPhase::Error;
                self.error = Some(error.clone());
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
        Ok(track)
    }

    pub(crate) fn play(
        &mut self,
        input: Option<AudioPlayInput>,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        self.clear_error();
        let restart = input.and_then(|value| value.restart).unwrap_or(false);

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
        Ok(self.state())
    }

    pub(crate) fn pause(&mut self) -> Result<AudioPlaybackState, AudioCommandError> {
        self.clear_error();
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
        Ok(self.state())
    }

    pub(crate) fn stop(&mut self) -> Result<AudioPlaybackState, AudioCommandError> {
        self.clear_error();
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
        Ok(self.state())
    }

    pub(crate) fn seek(
        &mut self,
        input: AudioSeekInput,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
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

        if let Some(sink) = &self.sink {
            sink.try_seek(target).map_err(|error| {
                audio_error(
                    AudioErrorCode::UnsupportedOperation,
                    format!("Audio source does not support seeking: {error}"),
                    true,
                )
            })?;
            if should_play {
                sink.play();
            } else {
                sink.pause();
            }
        } else {
            self.rebuild_sink(target, should_play)?;
        }

        self.accumulated = target;
        self.started_at = should_play.then(Instant::now);
        self.phase = if should_play {
            AudioPlaybackPhase::Playing
        } else {
            AudioPlaybackPhase::Paused
        };
        Ok(self.state())
    }

    pub(crate) fn get_state(&mut self) -> AudioPlaybackState {
        self.state()
    }

    pub(crate) fn handle_output_device_change(&mut self) -> AudioPlaybackState {
        let current_signature = current_output_device_signature();
        self.output_device_signature = current_signature;
        self.release_output_for_device_change();
        self.state()
    }

    fn release_output_for_device_change(&mut self) {
        let was_playing = matches!(self.phase, AudioPlaybackPhase::Playing);
        if was_playing {
            self.accumulated = self.position();
            self.started_at = None;
            self.phase = AudioPlaybackPhase::Paused;
        }

        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.stream_handle = None;
        self.stream = None;
    }

    fn ensure_output(&mut self) -> Result<&OutputStreamHandle, AudioCommandError> {
        if self.stream_handle.is_none() {
            let device = cpal::default_host()
                .default_output_device()
                .ok_or_else(|| {
                    audio_error(
                        AudioErrorCode::PlaybackInitFailed,
                        "No default audio output device is available",
                        true,
                    )
                })?;
            let (stream, stream_handle) =
                OutputStream::try_from_device(&device).map_err(|error| {
                    audio_error(
                        AudioErrorCode::PlaybackInitFailed,
                        format!("Failed to initialize audio output: {error}"),
                        true,
                    )
                })?;
            self.stream = Some(stream);
            self.stream_handle = Some(stream_handle);
            self.output_device_signature = current_output_device_signature();
        }
        self.stream_handle.as_ref().ok_or_else(|| {
            audio_error(
                AudioErrorCode::InternalError,
                "Audio output handle is unavailable",
                true,
            )
        })
    }

    fn rebuild_sink(&mut self, position: Duration, play: bool) -> Result<(), AudioCommandError> {
        let path = self.current_path.clone().ok_or_else(|| {
            audio_error(
                AudioErrorCode::NoTrackLoaded,
                "No audio track is loaded",
                true,
            )
        })?;
        let handle = self.ensure_output()?;
        let sink = Sink::try_new(handle).map_err(|error| {
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
            current_track: self.current_track.clone(),
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
}
