mod chapters;
mod controller;
mod cue;
mod device;
mod error;
mod runtime;
mod source;
mod symphonia_source;
mod types;

pub use controller::AudioController;
pub use error::AudioCommandError;
pub use types::{
    AudioFolderPlaylist, AudioFolderPlaylistInput, AudioLoadFileInput, AudioOpenFileInput,
    AudioOpenSourceResult, AudioPlayInput, AudioPlaybackState, AudioSeekInput, AudioSetVolumeInput,
    AudioTrackRef,
};

pub const AUDIO_STATE_CHANGED_EVENT: &str = "audio_state_changed";
