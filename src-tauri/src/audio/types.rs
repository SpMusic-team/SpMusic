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
    #[ts(type = "number | null")]
    pub generation: Option<u64>,
    pub current_track_id: Option<String>,
    #[ts(type = "number")]
    pub position_ms: u64,
    #[ts(type = "number | null")]
    pub duration_ms: Option<u64>,
    pub volume: f32,
    pub transport_transition: Option<AudioTransportTransition>,
    pub error: Option<AudioCommandError>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioTransportTransition {
    #[ts(type = "number")]
    pub request_id: u64,
    pub target: AudioTransportTarget,
    #[ts(type = "number")]
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
pub enum AudioTransportTarget {
    Playing,
    Paused,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioTransitionPlaybackInput {
    #[ts(type = "number")]
    pub request_id: u64,
    pub expected_track_id: String,
    pub target: AudioTransportTarget,
    #[ts(type = "number")]
    pub duration_ms: u64,
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
    Track { track: Box<AudioTrackRef> },
    Playlist { playlist: AudioFolderPlaylist },
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioLoadFileInput {
    pub path: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioLoadAndPlayInput {
    pub path: String,
    #[ts(type = "number")]
    pub request_id: u64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioLoadAndPlayResult {
    #[ts(type = "number")]
    pub request_id: u64,
    #[ts(type = "number")]
    pub generation: u64,
    pub track_id: String,
    pub file_name: String,
    pub state: AudioPlaybackState,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(
    rename_all = "camelCase",
    tag = "kind",
    rename_all_fields = "camelCase"
)]
pub enum AudioTrackDetailsChanged {
    #[serde(rename = "ready")]
    Ready {
        #[ts(type = "number")]
        request_id: u64,
        #[ts(type = "number")]
        generation: u64,
        track: AudioTrackRef,
    },
    #[serde(rename = "error")]
    Error {
        #[ts(type = "number")]
        request_id: u64,
        #[ts(type = "number")]
        generation: u64,
        track_id: String,
        error: AudioCommandError,
    },
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

/// Input for the explicit `audio_embed_lyrics` command (the only production
/// write entry point). An empty `lyrics` clears the embedded lyrics.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioEmbedLyricsInput {
    pub path: String,
    pub lyrics: String,
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
        assert!(exported.contains("generation: number | null"));
        assert!(exported.contains("positionMs: number"));
        assert!(exported.contains("durationMs: number | null"));
        assert!(exported.contains("transportTransition: AudioTransportTransition | null"));
        assert!(!exported.contains("currentTrack: AudioTrackRef"));
    }

    #[test]
    fn audio_playback_state_serializes_as_lightweight_realtime_payload() {
        let state = AudioPlaybackState {
            phase: AudioPlaybackPhase::Playing,
            generation: Some(7),
            current_track_id: Some("local-track".to_owned()),
            position_ms: 1_250,
            duration_ms: Some(60_000),
            volume: 0.75,
            transport_transition: None,
            error: None,
        };

        let serialized =
            serde_json::to_value(state).expect("AudioPlaybackState should serialize to JSON");

        assert_eq!(serialized["currentTrackId"], "local-track");
        assert_eq!(serialized["generation"], 7);
        assert!(serialized.get("currentTrack").is_none());
        assert!(serialized.get("metadata").is_none());
        assert!(serialized.get("coverArt").is_none());
        assert!(serialized.get("lyrics").is_none());
        assert!(serialized["transportTransition"].is_null());
    }

    #[test]
    fn transition_playback_contract_is_camel_case_and_tag_free() {
        let input = AudioTransitionPlaybackInput::export_to_string(&Config::default())
            .expect("AudioTransitionPlaybackInput should export");
        let transition = AudioTransportTransition::export_to_string(&Config::default())
            .expect("AudioTransportTransition should export");

        assert!(input.contains("requestId: number"));
        assert!(input.contains("expectedTrackId: string"));
        assert!(input.contains("target: AudioTransportTarget"));
        assert!(input.contains("durationMs: number"));
        assert!(transition.contains("requestId: number"));

        let value = serde_json::to_value(AudioTransportTransition {
            request_id: 9,
            target: AudioTransportTarget::Paused,
            duration_ms: 500,
        })
        .expect("transition should serialize");
        assert_eq!(value["requestId"], 9);
        assert_eq!(value["target"], "paused");
        assert_eq!(value["durationMs"], 500);
    }

    #[test]
    fn audio_set_volume_input_exports_normalized_volume_contract() {
        let exported = AudioSetVolumeInput::export_to_string(&Config::default())
            .expect("AudioSetVolumeInput should be exportable to TypeScript");

        assert!(exported.contains("AudioSetVolumeInput"));
        assert!(exported.contains("volume: number"));
    }

    #[test]
    fn audio_embed_lyrics_input_exports_typescript_contract() {
        let exported = AudioEmbedLyricsInput::export_to_string(&Config::default())
            .expect("AudioEmbedLyricsInput should be exportable to TypeScript");

        assert!(exported.contains("AudioEmbedLyricsInput"));
        assert!(exported.contains("path: string"));
        assert!(exported.contains("lyrics: string"));
    }

    #[test]
    fn load_and_play_contract_is_lightweight_and_generation_aware() {
        let input = AudioLoadAndPlayInput::export_to_string(&Config::default())
            .expect("AudioLoadAndPlayInput should be exportable to TypeScript");
        let result = AudioLoadAndPlayResult::export_to_string(&Config::default())
            .expect("AudioLoadAndPlayResult should be exportable to TypeScript");

        assert!(input.contains("requestId: number"));
        assert!(result.contains("generation: number"));
        assert!(result.contains("state: AudioPlaybackState"));
        assert!(!result.contains("track: AudioTrackRef"));
    }

    #[test]
    fn track_details_event_serializes_tagged_ready_and_error_variants() {
        let ready = AudioTrackDetailsChanged::Ready {
            request_id: 3,
            generation: 4,
            track: AudioTrackRef {
                id: "local-track".to_owned(),
                source_path: "music.flac".to_owned(),
                file_name: "music.flac".to_owned(),
                duration_ms: Some(1_000),
                metadata: AudioTrackMetadata::default(),
            },
        };
        let error = AudioTrackDetailsChanged::Error {
            request_id: 3,
            generation: 4,
            track_id: "local-track".to_owned(),
            error: crate::audio::error::audio_error(
                crate::audio::error::AudioErrorCode::UnreadableFile,
                "details unavailable",
                true,
            ),
        };

        let ready = serde_json::to_value(ready).expect("ready event should serialize");
        let error = serde_json::to_value(error).expect("error event should serialize");
        assert_eq!(ready["kind"], "ready");
        assert_eq!(ready["requestId"], 3);
        assert_eq!(ready["track"]["id"], "local-track");
        assert_eq!(error["kind"], "error");
        assert_eq!(error["trackId"], "local-track");
        assert!(error.get("track").is_none());
    }

    #[test]
    fn audio_track_ref_exports_metadata_contract() {
        let exported = AudioTrackRef::export_to_string(&Config::default())
            .expect("AudioTrackRef should be exportable to TypeScript");

        assert!(exported.contains("metadata: AudioTrackMetadata"));
    }

    #[test]
    fn boxed_open_source_track_keeps_the_frontend_contract() {
        let exported = AudioOpenSourceResult::export_to_string(&Config::default())
            .expect("AudioOpenSourceResult should be exportable to TypeScript");
        assert!(exported.contains("track: AudioTrackRef"));

        let result = AudioOpenSourceResult::Track {
            track: Box::new(AudioTrackRef {
                id: "local-track".to_owned(),
                source_path: "music.flac".to_owned(),
                file_name: "music.flac".to_owned(),
                duration_ms: Some(1_000),
                metadata: AudioTrackMetadata::default(),
            }),
        };
        let serialized =
            serde_json::to_value(result).expect("AudioOpenSourceResult should serialize to JSON");

        assert_eq!(serialized["kind"], "track");
        assert_eq!(serialized["track"]["id"], "local-track");
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
