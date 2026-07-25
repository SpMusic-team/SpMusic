use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::error::AudioCommandError;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackRef {
    pub id: String,
    pub source_path: String,
    pub file_name: String,
    #[ts(type = "number | null")]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioPlaybackState {
    pub phase: AudioPlaybackPhase,
    pub current_track: Option<AudioTrackRef>,
    #[ts(type = "number")]
    pub position_ms: u64,
    #[ts(type = "number | null")]
    pub duration_ms: Option<u64>,
    pub volume: f32,
    pub error: Option<AudioCommandError>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
pub enum AudioPlaybackPhase {
    Idle,
    Loading,
    Ready,
    Playing,
    Paused,
    Stopped,
    Ended,
    Error,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioOpenFileInput {
    pub filters: Option<Vec<AudioFileFilter>>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioFileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioLoadFileInput {
    pub path: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioPlayInput {
    pub restart: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioSeekInput {
    #[ts(type = "number")]
    pub position_ms: u64,
}

#[cfg(test)]
mod tests {
    use ts_rs::{Config, TS};

    use super::*;

    #[test]
    fn audio_playback_state_can_export_typescript_contract() {
        let exported = AudioPlaybackState::export_to_string(&Config::default())
            .expect("AudioPlaybackState should be exportable to TypeScript");

        assert!(exported.contains("AudioPlaybackState"));
        assert!(exported.contains("positionMs: number"));
        assert!(exported.contains("durationMs: number | null"));
    }
}
