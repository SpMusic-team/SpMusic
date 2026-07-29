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
    pub metadata: AudioTrackMetadata,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub comment: Option<String>,
    pub lyrics: Option<String>,
    pub cover_art: Option<AudioCoverArt>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioCoverArt {
    pub mime_type: String,
    #[ts(type = "string | null")]
    pub file_path: Option<String>,
    #[ts(type = "string | null")]
    pub data_url: Option<String>,
    #[ts(type = "number")]
    pub byte_len: usize,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioPlaybackState {
    pub phase: AudioPlaybackPhase,
    pub current_track_id: Option<String>,
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

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum AudioOpenSourceResult {
    Track { track: AudioTrackRef },
    Playlist { playlist: AudioFolderPlaylist },
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioLoadFileInput {
    pub path: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioFolderPlaylistInput {
    pub selected_path: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioFolderPlaylist {
    pub directory_path: String,
    pub directory_name: String,
    pub source_kind: AudioPlaylistSourceKind,
    pub source_path: String,
    pub source_name: String,
    #[ts(type = "number")]
    pub selected_index: usize,
    pub tracks: Vec<AudioFolderTrackRef>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
pub enum AudioPlaylistSourceKind {
    Folder,
    M3u8,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioFolderTrackRef {
    pub id: String,
    pub source_path: String,
    pub file_name: String,
    pub available: bool,
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

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioSetVolumeInput {
    pub volume: f32,
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
        assert!(exported.contains("currentTrackId: string | null"));
        assert!(exported.contains("positionMs: number"));
        assert!(exported.contains("durationMs: number | null"));
        assert!(!exported.contains("currentTrack: AudioTrackRef"));
    }

    #[test]
    fn audio_playback_state_serializes_as_lightweight_realtime_payload() {
        let state = AudioPlaybackState {
            phase: AudioPlaybackPhase::Playing,
            current_track_id: Some("local-track".to_owned()),
            position_ms: 1_250,
            duration_ms: Some(60_000),
            volume: 0.75,
            error: None,
        };

        let serialized =
            serde_json::to_value(state).expect("AudioPlaybackState should serialize to JSON");

        assert_eq!(serialized["currentTrackId"], "local-track");
        assert!(serialized.get("currentTrack").is_none());
        assert!(serialized.get("metadata").is_none());
        assert!(serialized.get("coverArt").is_none());
        assert!(serialized.get("lyrics").is_none());
    }

    #[test]
    fn audio_set_volume_input_exports_normalized_volume_contract() {
        let exported = AudioSetVolumeInput::export_to_string(&Config::default())
            .expect("AudioSetVolumeInput should be exportable to TypeScript");

        assert!(exported.contains("AudioSetVolumeInput"));
        assert!(exported.contains("volume: number"));
    }

    #[test]
    fn audio_track_ref_exports_metadata_contract() {
        let exported = AudioTrackRef::export_to_string(&Config::default())
            .expect("AudioTrackRef should be exportable to TypeScript");

        assert!(exported.contains("metadata: AudioTrackMetadata"));
    }

    #[test]
    fn audio_track_metadata_exports_typescript_contract() {
        let exported = AudioTrackMetadata::export_to_string(&Config::default())
            .expect("AudioTrackMetadata should be exportable to TypeScript");

        assert!(exported.contains("title: string | null"));
        assert!(exported.contains("albumArtist: string | null"));
        assert!(exported.contains("coverArt: AudioCoverArt | null"));
    }

    #[test]
    fn audio_cover_art_exports_file_path_and_nullable_data_url() {
        let exported = AudioCoverArt::export_to_string(&Config::default())
            .expect("AudioCoverArt should be exportable to TypeScript");

        assert!(exported.contains("filePath: string | null"));
        assert!(exported.contains("dataUrl: string | null"));
    }

    #[test]
    fn audio_track_metadata_defaults_to_empty_values() {
        let metadata = AudioTrackMetadata::default();

        assert!(metadata.title.is_none());
        assert!(metadata.artist.is_none());
        assert!(metadata.album.is_none());
        assert!(metadata.album_artist.is_none());
        assert!(metadata.genre.is_none());
        assert!(metadata.year.is_none());
        assert!(metadata.track_number.is_none());
        assert!(metadata.disc_number.is_none());
        assert!(metadata.comment.is_none());
        assert!(metadata.lyrics.is_none());
        assert!(metadata.cover_art.is_none());
    }
}
