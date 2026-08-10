mod chapters;
mod controller;
mod cover_cache;
mod cue;
mod device;
mod duration;
mod error;
mod metadata;
mod playlist;
mod runtime;
mod source;
mod symphonia_source;
// Tag mutation is intentionally opt-in. No read/load path imports this module.
#[allow(dead_code)]
mod tag_writer;
mod types;

#[cfg(test)]
mod source_tests;

pub use controller::AudioController;
pub use error::AudioCommandError;
pub use types::{
    AudioFolderPlaylist, AudioFolderPlaylistInput, AudioLoadFileInput, AudioOpenFileInput,
    AudioOpenSourceResult, AudioPlayInput, AudioPlaybackState, AudioSeekInput, AudioSetVolumeInput,
    AudioTrackRef,
};

pub const AUDIO_STATE_CHANGED_EVENT: &str = "audio_state_changed";
