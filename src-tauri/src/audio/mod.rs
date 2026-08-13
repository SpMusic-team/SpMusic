mod chapters;
mod controller;
mod cover_cache;
mod cue;
mod device;
mod duration;
mod error;
mod lyrics_cache;
mod metadata;
mod playlist;
mod runtime;
mod source;
mod symphonia_source;
// Tag mutation is intentionally opt-in. Write capability is reachable only
// through the explicit `audio_embed_lyrics` command (controller.rs) and
// tests; no read/load path imports this module.
mod tag_writer;
mod types;

#[cfg(test)]
mod source_tests;

pub use controller::AudioController;
pub use error::AudioCommandError;
pub use types::{
    AudioEmbedLyricsInput, AudioFolderPlaylist, AudioFolderPlaylistInput, AudioLoadAndPlayInput,
    AudioLoadAndPlayResult, AudioLoadFileInput, AudioOpenFileInput, AudioOpenSourceResult,
    AudioPlayInput, AudioPlaybackState, AudioSeekInput, AudioSetVolumeInput, AudioTrackRef,
};

pub const AUDIO_STATE_CHANGED_EVENT: &str = "audio_state_changed";
pub const AUDIO_TRACK_DETAILS_CHANGED_EVENT: &str = "audio_track_details_changed";
