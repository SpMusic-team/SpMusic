mod app_paths;
mod audio;

use std::sync::Once;

use app_paths::AppPaths;
use audio::{
    AudioCommandError, AudioController, AudioLoadFileInput, AudioOpenFileInput, AudioPlayInput,
    AudioPlaybackState, AudioSeekInput, AudioTrackRef,
};
use tauri::{Manager, State};
use tracing_subscriber::EnvFilter;

#[tauri::command]
fn audio_open_file(
    state: State<'_, AudioController>,
    input: Option<AudioOpenFileInput>,
) -> Result<AudioTrackRef, AudioCommandError> {
    state.open_file(input)
}

#[tauri::command]
fn audio_load_file(
    state: State<'_, AudioController>,
    input: AudioLoadFileInput,
) -> Result<AudioTrackRef, AudioCommandError> {
    state.load_file(input)
}

#[tauri::command]
fn audio_play(
    state: State<'_, AudioController>,
    input: Option<AudioPlayInput>,
) -> Result<AudioPlaybackState, AudioCommandError> {
    state.play(input)
}

#[tauri::command]
fn audio_pause(state: State<'_, AudioController>) -> Result<AudioPlaybackState, AudioCommandError> {
    state.pause()
}

#[tauri::command]
fn audio_stop(state: State<'_, AudioController>) -> Result<AudioPlaybackState, AudioCommandError> {
    state.stop()
}

#[tauri::command]
fn audio_seek(
    state: State<'_, AudioController>,
    input: AudioSeekInput,
) -> Result<AudioPlaybackState, AudioCommandError> {
    state.seek(input)
}

#[tauri::command]
fn audio_get_state(state: State<'_, AudioController>) -> AudioPlaybackState {
    state.get_state()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            audio_open_file,
            audio_load_file,
            audio_play,
            audio_pause,
            audio_stop,
            audio_seek,
            audio_get_state,
        ])
        .setup(|app| {
            init_tracing();
            let app_paths = AppPaths::prepare()?;
            tracing::info!(
                config_dir = %app_paths.config_dir.display(),
                data_dir = %app_paths.data_dir.display(),
                cache_dir = %app_paths.cache_dir.display(),
                "prepared app directories",
            );
            app.manage(app_paths);
            app.manage(AudioController::new(app.handle().clone()));

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
        }
    });
}
