mod chapters;
mod controller;
mod cover_cache;
mod cover_pixels;
mod cue;
mod device;
mod duration;
// Process-local duration cache for the authoritative playlist duration channel.
// Read and written only by `playlist_duration.rs`; it never persists to disk.
mod duration_cache;
mod error;
mod folder_cover;
mod lyrics_cache;
mod metadata;
mod playlist;
pub(crate) mod playlist_cover;
mod playlist_duration;
mod playlist_summary;
mod runtime;
mod source;
mod symphonia_source;
// Tag mutation is intentionally opt-in. Write capability is reachable only
// through the explicit `audio_embed_lyrics` command (controller.rs) and
// tests; no read/load path imports this module.
mod tag_writer;
mod types;
mod visualization;

#[cfg(test)]
mod source_tests;

pub use controller::AudioController;
pub(crate) use cover_pixels::try_warm_track_thumbnail;
pub use cover_pixels::{
    begin_playlist_cover_window, load_cover_pixels, load_folder_thumbnail, load_playlist_cover_pixels,
    load_track_thumbnail, shutdown_playlist_cover_cache, AudioBeginPlaylistCoverWindowInput,
    AudioLoadCoverPixelsInput, AudioLoadFolderThumbnailInput, AudioLoadPlaylistCoverPixelsInput,
    AudioLoadTrackThumbnailInput, CoverPixelsError,
};
pub(crate) use device::current_output_info;
pub use error::AudioCommandError;
pub(crate) use error::{audio_error, AudioErrorCode};
pub(crate) use playlist::{import_m3u8_playlist, load_library_folder, restore_playlist_track};
pub(crate) use playlist_cover::probe_playlist_cover;
pub use playlist_duration::probe_playlist_durations;
pub use playlist_summary::probe_playlist_track_summaries;
pub(crate) use types::AudioPlaylistSourceKind;
pub use types::{
    AudioEmbedLyricsInput, AudioFolderPlaylist, AudioFolderPlaylistInput, AudioLoadAndPlayInput,
    AudioLoadAndPlayResult, AudioLoadFileInput, AudioOpenFileInput, AudioOpenSourceResult,
    AudioOutputInfo, AudioPlayInput, AudioPlaybackState, AudioPlaylistCoverSource,
    AudioPlaylistDurationItem, AudioPlaylistTrackSummaryItem, AudioProbePlaylistDurationsInput,
    AudioProbePlaylistTrackSummariesInput, AudioSeekInput, AudioSetVolumeInput, AudioTrackRef,
    AudioTransitionPlaybackInput,
};

pub const AUDIO_STATE_CHANGED_EVENT: &str = "audio_state_changed";
pub const AUDIO_TRACK_DETAILS_CHANGED_EVENT: &str = "audio_track_details_changed";
