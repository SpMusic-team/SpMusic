mod app_paths;
mod audio;

use std::sync::Once;

use app_paths::AppPaths;
use audio::{
    AudioCommandError, AudioController, AudioFolderPlaylist, AudioFolderPlaylistInput,
    AudioLoadFileInput, AudioOpenFileInput, AudioOpenSourceResult, AudioPlayInput,
    AudioPlaybackState, AudioSeekInput, AudioTrackRef,
};
use tauri::{Manager, State};
use tracing_subscriber::EnvFilter;

#[tauri::command]
fn audio_open_file(
    state: State<'_, AudioController>,
    input: Option<AudioOpenFileInput>,
) -> Result<AudioTrackRef, AudioCommandError> {
    tracing::info!(
        command = "audio_open_file",
        filter_count = input
            .as_ref()
            .and_then(|input| input.filters.as_ref())
            .map(Vec::len),
        "Tauri command invoked",
    );
    let result = state.open_file(input);
    log_track_command_result("audio_open_file", &result);
    result
}

#[tauri::command]
fn audio_open_source(
    state: State<'_, AudioController>,
) -> Result<AudioOpenSourceResult, AudioCommandError> {
    tracing::info!(command = "audio_open_source", "Tauri command invoked");
    state.open_source()
}

#[tauri::command]
fn audio_load_file(
    state: State<'_, AudioController>,
    input: AudioLoadFileInput,
) -> Result<AudioTrackRef, AudioCommandError> {
    tracing::info!(
        command = "audio_load_file",
        path = %input.path,
        "Tauri command invoked",
    );
    let result = state.load_file(input);
    log_track_command_result("audio_load_file", &result);
    result
}

#[tauri::command]
fn audio_hydrate_track(
    state: State<'_, AudioController>,
    input: AudioLoadFileInput,
) -> Result<AudioTrackRef, AudioCommandError> {
    tracing::info!(
        command = "audio_hydrate_track",
        path = %input.path,
        "Tauri command invoked",
    );
    let result = state.hydrate_track(input);
    log_track_command_result("audio_hydrate_track", &result);
    result
}

#[tauri::command]
fn audio_list_folder_tracks(
    state: State<'_, AudioController>,
    input: AudioFolderPlaylistInput,
) -> Result<AudioFolderPlaylist, AudioCommandError> {
    tracing::info!(
        command = "audio_list_folder_tracks",
        selected_path = %input.selected_path,
        "Tauri command invoked",
    );
    state.list_folder_tracks(input)
}

#[tauri::command]
fn audio_play(
    state: State<'_, AudioController>,
    input: Option<AudioPlayInput>,
) -> Result<AudioPlaybackState, AudioCommandError> {
    tracing::info!(
        command = "audio_play",
        restart = input.as_ref().and_then(|input| input.restart),
        "Tauri command invoked",
    );
    let result = state.play(input);
    log_state_command_result("audio_play", &result);
    result
}

#[tauri::command]
fn audio_pause(state: State<'_, AudioController>) -> Result<AudioPlaybackState, AudioCommandError> {
    tracing::info!(command = "audio_pause", "Tauri command invoked");
    let result = state.pause();
    log_state_command_result("audio_pause", &result);
    result
}

#[tauri::command]
fn audio_stop(state: State<'_, AudioController>) -> Result<AudioPlaybackState, AudioCommandError> {
    tracing::info!(command = "audio_stop", "Tauri command invoked");
    let result = state.stop();
    log_state_command_result("audio_stop", &result);
    result
}

#[tauri::command]
fn audio_seek(
    state: State<'_, AudioController>,
    input: AudioSeekInput,
) -> Result<AudioPlaybackState, AudioCommandError> {
    tracing::info!(
        command = "audio_seek",
        requested_ms = input.position_ms,
        "Tauri command invoked",
    );
    let result = state.seek(input);
    log_state_command_result("audio_seek", &result);
    result
}

#[tauri::command]
fn audio_get_state(state: State<'_, AudioController>) -> AudioPlaybackState {
    tracing::debug!(command = "audio_get_state", "Tauri command invoked");
    let state = state.get_state();
    tracing::debug!(
        command = "audio_get_state",
        phase = ?state.phase,
        position_ms = state.position_ms,
        duration_ms = state.duration_ms,
        "Tauri command completed",
    );
    state
}

#[tauri::command]
fn audio_get_current_track(
    state: State<'_, AudioController>,
) -> Result<Option<AudioTrackRef>, AudioCommandError> {
    tracing::debug!(command = "audio_get_current_track", "Tauri command invoked");
    let track = state.get_current_track();
    tracing::debug!(
        command = "audio_get_current_track",
        track_id = track
            .as_ref()
            .ok()
            .and_then(|track| track.as_ref())
            .map(|track| track.id.as_str()),
        success = track.is_ok(),
        "Tauri command completed",
    );
    track
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();
    tracing::info!(
        operation = "app.start",
        package_name = env!("CARGO_PKG_NAME"),
        package_version = env!("CARGO_PKG_VERSION"),
        debug_assertions = cfg!(debug_assertions),
        "starting SpMusic Tauri backend",
    );
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            audio_open_file,
            audio_open_source,
            audio_load_file,
            audio_hydrate_track,
            audio_list_folder_tracks,
            audio_play,
            audio_pause,
            audio_stop,
            audio_seek,
            audio_get_state,
            audio_get_current_track,
        ])
        .setup(|app| {
            let app_paths = AppPaths::prepare()?;
            tracing::info!(
                operation = "app.setup",
                config_dir = %app_paths.config_dir.display(),
                data_dir = %app_paths.data_dir.display(),
                cache_dir = %app_paths.cache_dir.display(),
                "prepared app directories",
            );
            let audio_cache_dir = app_paths.cache_dir.clone();
            app.manage(app_paths);
            app.manage(AudioController::new(app.handle().clone(), audio_cache_dir));

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn init_tracing() {
    static INIT: Once = Once::new();

    INIT.call_once(|| {
        let env_filter =
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_target(true)
            .compact()
            .finish();

        if tracing::subscriber::set_global_default(subscriber).is_err() {
            eprintln!("tracing subscriber was already initialized");
        } else {
            tracing::info!(
                operation = "app.tracing.init",
                "initialized tracing subscriber",
            );
        }
    });
}

fn log_track_command_result(
    command: &'static str,
    result: &Result<AudioTrackRef, AudioCommandError>,
) {
    match result {
        Ok(track) => tracing::info!(
            command,
            track_id = %track.id,
            file_name = %track.file_name,
            duration_ms = track.duration_ms,
            "Tauri command completed",
        ),
        Err(error) => tracing::warn!(
            command,
            error_code = ?error.code,
            error = %error.message,
            recoverable = error.recoverable,
            "Tauri command failed",
        ),
    }
}

fn log_state_command_result(
    command: &'static str,
    result: &Result<AudioPlaybackState, AudioCommandError>,
) {
    match result {
        Ok(state) => tracing::info!(
            command,
            phase = ?state.phase,
            position_ms = state.position_ms,
            duration_ms = state.duration_ms,
            track_id = state.current_track_id.as_deref(),
            "Tauri command completed",
        ),
        Err(error) => tracing::warn!(
            command,
            error_code = ?error.code,
            error = %error.message,
            recoverable = error.recoverable,
            "Tauri command failed",
        ),
    }
}
