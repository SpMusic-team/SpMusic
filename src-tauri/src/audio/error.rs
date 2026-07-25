use serde::Serialize;
use thiserror::Error;
use ts_rs::TS;

use super::types::{AudioPlaybackPhase, AudioPlaybackState};

#[derive(Debug, Clone, Error, Serialize, TS)]
#[error("{message}")]
#[serde(rename_all = "camelCase")]
pub struct AudioCommandError {
    pub code: AudioErrorCode,
    pub message: String,
    pub recoverable: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, TS)]
#[allow(dead_code)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AudioErrorCode {
    UserCancelled,
    NoTrackLoaded,
    InvalidPath,
    FileNotFound,
    UnreadableFile,
    UnsupportedFormat,
    PlaybackInitFailed,
    PlaybackFailed,
    UnsupportedOperation,
    InternalError,
}

pub(crate) fn audio_error(
    code: AudioErrorCode,
    message: impl Into<String>,
    recoverable: bool,
) -> AudioCommandError {
    AudioCommandError {
        code,
        message: message.into(),
        recoverable,
    }
}

pub(crate) fn unavailable_state(message: impl Into<String>) -> AudioPlaybackState {
    AudioPlaybackState {
        phase: AudioPlaybackPhase::Error,
        current_track: None,
        position_ms: 0,
        duration_ms: None,
        volume: 1.0,
        error: Some(audio_error(AudioErrorCode::InternalError, message, true)),
    }
}
