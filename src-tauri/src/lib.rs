mod app_paths;
mod audio;
mod global_shortcuts;
mod library_cover_warmup;
mod library_folders;
mod library_playlists;
mod webview_memory;

use std::sync::Once;

use app_paths::AppPaths;
use audio::{
    audio_error, current_output_info, import_m3u8_playlist, load_library_folder, AudioErrorCode,
};
use audio::{
    begin_playlist_cover_window, load_cover_pixels, load_playlist_cover_pixels,
    load_track_thumbnail, probe_playlist_cover, probe_playlist_durations,
    probe_playlist_track_summaries, shutdown_playlist_cover_cache,
    AudioBeginPlaylistCoverWindowInput, AudioCommandError, AudioController, AudioEmbedLyricsInput,
    AudioFolderPlaylist, AudioFolderPlaylistInput, AudioLoadAndPlayInput, AudioLoadAndPlayResult,
    AudioLoadCoverPixelsInput, AudioLoadFileInput, AudioLoadPlaylistCoverPixelsInput,
    AudioLoadTrackThumbnailInput, AudioOpenFileInput, AudioOpenSourceResult, AudioOutputInfo,
    AudioPlayInput, AudioPlaybackState, AudioPlaylistCoverSource, AudioPlaylistDurationItem,
    AudioPlaylistTrackSummaryItem, AudioProbePlaylistDurationsInput,
    AudioProbePlaylistTrackSummariesInput, AudioSeekInput, AudioSetVolumeInput, AudioTrackRef,
    AudioTransitionPlaybackInput, CoverPixelsError,
};
use global_shortcuts::{
    global_shortcuts_get_settings, global_shortcuts_set_suspended, global_shortcuts_update_settings,
};
use library_cover_warmup::{LibraryCoverWarmupInput, LibraryCoverWarmupResult};
use library_folders::{LibraryError, LibraryFolderRegistry, LibraryFolders};
use library_playlists::LibraryPlaylistRegistry;
use tauri::{ipc::Response, Manager, State};
use tracing_subscriber::EnvFilter;
use webview_memory::WebviewMemoryCoordinator;

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
fn audio_import_playlist(
    registry: State<'_, LibraryPlaylistRegistry>,
) -> Result<Option<AudioFolderPlaylist>, AudioCommandError> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("导入 M3U8 播放列表")
        .add_filter("M3U8 播放列表", &["m3u8"])
        .pick_file()
    else {
        return Ok(None);
    };
    let playlist = import_m3u8_playlist(&path)?;
    registry
        .upsert(&playlist)
        .map_err(|error| AudioCommandError {
            code: audio::AudioErrorCode::InternalError,
            message: format!("保存播放列表失败：{}", error.message),
            recoverable: true,
        })?;
    Ok(Some(playlist))
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
fn audio_load_and_play(
    state: State<'_, AudioController>,
    input: AudioLoadAndPlayInput,
) -> Result<AudioLoadAndPlayResult, AudioCommandError> {
    tracing::info!(
        command = "audio_load_and_play",
        path = %input.path,
        request_id = input.request_id,
        "Tauri command invoked",
    );
    let result = state.load_and_play(input);
    match &result {
        Ok(result) => tracing::info!(
            command = "audio_load_and_play",
            request_id = result.request_id,
            generation = result.generation,
            track_id = %result.track_id,
            file_name = %result.file_name,
            phase = ?result.state.phase,
            "Tauri command completed",
        ),
        Err(error) => tracing::warn!(
            command = "audio_load_and_play",
            error_code = ?error.code,
            error = %error.message,
            recoverable = error.recoverable,
            "Tauri command failed",
        ),
    }
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
async fn audio_probe_playlist_cover(
    state: State<'_, AppPaths>,
    input: AudioLoadFileInput,
) -> Result<AudioPlaylistCoverSource, AudioCommandError> {
    probe_playlist_cover(state.cache_dir.clone(), input).await
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
fn library_get_folders(
    state: State<'_, LibraryFolderRegistry>,
) -> Result<LibraryFolders, LibraryError> {
    state.get()
}

#[tauri::command]
fn library_get_playlists(
    state: State<'_, LibraryPlaylistRegistry>,
) -> Result<Vec<AudioFolderPlaylist>, LibraryError> {
    state.get()
}

#[tauri::command]
fn library_select_folders() -> Result<Option<Vec<String>>, LibraryError> {
    let Some(paths) = rfd::FileDialog::new()
        .set_title("选择音乐文件夹")
        .pick_folders()
    else {
        return Ok(None);
    };
    let mut folders = Vec::with_capacity(paths.len());
    for path in paths {
        let path = path
            .canonicalize()
            .map_err(|error| LibraryError::invalid(format!("无法访问所选音乐文件夹：{error}")))?;
        if !path.is_dir() {
            return Err(LibraryError::invalid("所选路径不是文件夹"));
        }
        let normalized = path.to_string_lossy().into_owned();
        if !folders.contains(&normalized) {
            folders.push(normalized);
        }
    }
    Ok(Some(folders))
}

#[tauri::command]
fn library_add_folder(
    state: State<'_, LibraryFolderRegistry>,
    path: String,
) -> Result<LibraryFolders, LibraryError> {
    state.add(&path)
}

#[tauri::command]
fn library_clear_folders(state: State<'_, LibraryFolderRegistry>) -> Result<(), LibraryError> {
    state.clear()?;
    library_cover_warmup::cancel();
    Ok(())
}

#[tauri::command]
async fn library_scan_folder(path: String) -> Result<AudioFolderPlaylist, AudioCommandError> {
    scan_library_folder_in_worker(move || load_library_folder(std::path::Path::new(&path))).await
}

async fn scan_library_folder_in_worker<F>(work: F) -> Result<AudioFolderPlaylist, AudioCommandError>
where
    F: FnOnce() -> Result<AudioFolderPlaylist, AudioCommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| {
            tracing::error!(
                command = "library_scan_folder",
                error = %error,
                "library folder scan worker failed",
            );
            audio_error(
                AudioErrorCode::InternalError,
                "Library folder scan worker failed",
                false,
            )
        })?
}

#[cfg(test)]
mod library_scan_tests {
    use std::{
        fs,
        sync::{mpsc, Arc, Condvar, Mutex},
        time::Duration,
    };

    use super::*;

    #[test]
    fn scan_command_keeps_folder_result_and_file_errors() {
        let root = std::env::temp_dir().join(format!(
            "spmusic-scan-command-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("song.mp3"), b"fixture").unwrap();

        let playlist = tauri::async_runtime::block_on(library_scan_folder(
            root.to_string_lossy().into_owned(),
        ))
        .unwrap();
        assert_eq!(playlist.tracks.len(), 1);
        assert_eq!(playlist.tracks[0].file_name, "song.mp3");

        fs::remove_dir_all(&root).unwrap();
        let error = tauri::async_runtime::block_on(library_scan_folder(
            root.to_string_lossy().into_owned(),
        ))
        .unwrap_err();
        assert_eq!(error.code, AudioErrorCode::FileNotFound);
        assert!(error.recoverable);
    }

    #[test]
    fn two_blocking_scans_leave_the_async_runtime_responsive() {
        let (started_tx, started_rx) = mpsc::channel();
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let mut scans = Vec::new();
        for _ in 0..2 {
            let started_tx = started_tx.clone();
            let release = Arc::clone(&release);
            scans.push(tauri::async_runtime::spawn(scan_library_folder_in_worker(
                move || {
                    started_tx.send(()).unwrap();
                    let (lock, ready) = &*release;
                    let mut released = lock.lock().unwrap();
                    while !*released {
                        released = ready.wait(released).unwrap();
                    }
                    Err(audio_error(
                        AudioErrorCode::FileNotFound,
                        "fixture error",
                        true,
                    ))
                },
            )));
        }
        let both_started = started_rx.recv_timeout(Duration::from_secs(5)).is_ok()
            && started_rx.recv_timeout(Duration::from_secs(5)).is_ok();
        let (ping_tx, ping_rx) = mpsc::channel();
        tauri::async_runtime::spawn(async move { ping_tx.send(()).unwrap() });
        let responsive = ping_rx.recv_timeout(Duration::from_secs(2)).is_ok();

        let (lock, ready) = &*release;
        *lock.lock().unwrap() = true;
        ready.notify_all();
        assert!(both_started, "both scan workers should start concurrently");
        assert!(
            responsive,
            "light async work should run while scans are blocked"
        );
        for scan in scans {
            let error = tauri::async_runtime::block_on(scan).unwrap().unwrap_err();
            assert_eq!(error.code, AudioErrorCode::FileNotFound);
            assert_eq!(error.message, "fixture error");
            assert!(error.recoverable);
        }
    }
}

#[tauri::command]
async fn library_warm_cover_thumbnails(
    state: State<'_, AppPaths>,
    input: LibraryCoverWarmupInput,
) -> Result<LibraryCoverWarmupResult, LibraryError> {
    library_cover_warmup::warm(state.cache_dir.clone(), input).await
}

#[tauri::command]
fn library_cancel_cover_warmup() {
    library_cover_warmup::cancel();
}

#[tauri::command]
async fn audio_probe_playlist_durations(
    state: State<'_, AudioController>,
    input: AudioProbePlaylistDurationsInput,
) -> Result<Vec<AudioPlaylistDurationItem>, AudioCommandError> {
    tracing::debug!(
        command = "audio_probe_playlist_durations",
        path_count = input.paths.len(),
        "Tauri command invoked",
    );
    // The process-local duration cache follows the controller lifetime; cloning
    // the `Arc` here adds no state and no disk access.
    probe_playlist_durations(input, state.duration_cache()).await
}

#[tauri::command]
async fn audio_probe_playlist_track_summaries(
    input: AudioProbePlaylistTrackSummariesInput,
) -> Result<Vec<AudioPlaylistTrackSummaryItem>, AudioCommandError> {
    tracing::info!(
        command = "audio_probe_playlist_track_summaries",
        path_count = input.paths.len(),
        "Tauri command invoked",
    );
    let result = probe_playlist_track_summaries(input).await;
    match &result {
        Ok(items) => tracing::debug!(
            command = "audio_probe_playlist_track_summaries",
            item_count = items.len(),
            error_count = items.iter().filter(|item| item.error.is_some()).count(),
            "Tauri command completed",
        ),
        Err(error) => tracing::warn!(
            command = "audio_probe_playlist_track_summaries",
            error_code = ?error.code,
            error = %error.message,
            recoverable = error.recoverable,
            "Tauri command failed",
        ),
    }
    result
}

#[tauri::command]
fn audio_embed_lyrics(
    state: State<'_, AudioController>,
    input: AudioEmbedLyricsInput,
) -> Result<AudioTrackRef, AudioCommandError> {
    tracing::info!(
        command = "audio_embed_lyrics",
        path = %input.path,
        lyric_byte_len = input.lyrics.len(),
        "Tauri command invoked",
    );
    let result = state.embed_lyrics(input);
    log_track_command_result("audio_embed_lyrics", &result);
    result
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
fn audio_transition_playback(
    state: State<'_, AudioController>,
    input: AudioTransitionPlaybackInput,
) -> Result<AudioPlaybackState, AudioCommandError> {
    tracing::info!(
        command = "audio_transition_playback",
        request_id = input.request_id,
        expected_track_id = %input.expected_track_id,
        target = ?input.target,
        duration_ms = input.duration_ms,
        "Tauri command invoked",
    );
    let result = state.transition_playback(input);
    log_state_command_result("audio_transition_playback", &result);
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
fn audio_set_volume(
    state: State<'_, AudioController>,
    input: AudioSetVolumeInput,
) -> Result<AudioPlaybackState, AudioCommandError> {
    tracing::info!(
        command = "audio_set_volume",
        requested_volume = input.volume,
        "Tauri command invoked",
    );
    let result = state.set_volume(input);
    log_state_command_result("audio_set_volume", &result);
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
        volume = state.volume,
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

#[tauri::command]
fn audio_get_output_info() -> Option<AudioOutputInfo> {
    tracing::debug!(command = "audio_get_output_info", "Tauri command invoked");
    current_output_info()
}

#[tauri::command]
async fn audio_load_cover_pixels(
    state: State<'_, AppPaths>,
    input: AudioLoadCoverPixelsInput,
) -> Result<Response, CoverPixelsError> {
    tracing::debug!(
        command = "audio_load_cover_pixels",
        path = %input.file_path,
        max_edge = input.max_edge,
        request_id = input.request_id,
        "Tauri command invoked",
    );
    let app_cache_dir = state.cache_dir.clone();
    let response = load_cover_pixels(app_cache_dir, input).await?;
    tracing::debug!(
        command = "audio_load_cover_pixels",
        response_byte_len = response.len(),
        "Tauri command completed",
    );
    Ok(Response::new(response))
}

#[tauri::command]
async fn audio_load_playlist_cover_pixels(
    state: State<'_, AppPaths>,
    input: AudioLoadPlaylistCoverPixelsInput,
) -> Result<Response, CoverPixelsError> {
    tracing::debug!(
        command = "audio_load_playlist_cover_pixels",
        client_id = %input.client_id,
        path = %input.file_path,
        max_edge = input.max_edge,
        window_generation = input.window_generation,
        "Tauri command invoked",
    );
    let app_cache_dir = state.cache_dir.clone();
    let client_id = input.client_id.clone();
    let window_generation = input.window_generation;
    let response = load_playlist_cover_pixels(app_cache_dir, input).await?;
    tracing::debug!(
        command = "audio_load_playlist_cover_pixels",
        client_id,
        window_generation,
        response_byte_len = response.len(),
        "Tauri command completed",
    );
    Ok(Response::new(response))
}

#[tauri::command]
async fn audio_load_track_thumbnail(
    state: State<'_, AppPaths>,
    input: AudioLoadTrackThumbnailInput,
) -> Result<Response, CoverPixelsError> {
    let response = load_track_thumbnail(state.cache_dir.clone(), input).await?;
    Ok(Response::new(response))
}

#[tauri::command]
fn audio_begin_playlist_cover_window(
    input: AudioBeginPlaylistCoverWindowInput,
) -> Result<u64, CoverPixelsError> {
    let window_generation = begin_playlist_cover_window(&input.client_id)?;
    tracing::debug!(
        command = "audio_begin_playlist_cover_window",
        client_id = %input.client_id,
        window_generation,
        "playlist cover window generation allocated",
    );
    Ok(window_generation)
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
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(global_shortcuts::handle_event)
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Focused(false)) {
                global_shortcuts::restore_after_focus_loss(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            global_shortcuts_get_settings,
            global_shortcuts_update_settings,
            global_shortcuts_set_suspended,
            audio_open_file,
            audio_open_source,
            audio_import_playlist,
            audio_load_file,
            audio_load_and_play,
            audio_hydrate_track,
            audio_probe_playlist_cover,
            audio_list_folder_tracks,
            library_get_folders,
            library_get_playlists,
            library_select_folders,
            library_add_folder,
            library_clear_folders,
            library_scan_folder,
            library_warm_cover_thumbnails,
            library_cancel_cover_warmup,
            audio_probe_playlist_durations,
            audio_probe_playlist_track_summaries,
            audio_embed_lyrics,
            audio_play,
            audio_pause,
            audio_transition_playback,
            audio_stop,
            audio_seek,
            audio_set_volume,
            audio_get_state,
            audio_get_current_track,
            audio_get_output_info,
            audio_load_cover_pixels,
            audio_begin_playlist_cover_window,
            audio_load_playlist_cover_pixels,
            audio_load_track_thumbnail,
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
            global_shortcuts::GlobalShortcuts::initialize(app.handle(), &app_paths.config_dir);
            app.manage(LibraryFolderRegistry::new(&app_paths.data_dir));
            app.manage(LibraryPlaylistRegistry::new(&app_paths.data_dir));
            app.manage(app_paths);
            app.manage(AudioController::new(app.handle().clone(), audio_cache_dir));

            if let Some(window) = app.get_webview_window("main") {
                app.manage(WebviewMemoryCoordinator::install(&window));
            } else {
                app.manage(WebviewMemoryCoordinator::unsupported());
                tracing::warn!(
                    operation = "webview.memory_policy.install",
                    window = "main",
                    "main WebView window was not available during setup",
                );
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                global_shortcuts::shutdown(app);
                shutdown_playlist_cover_cache();
            }
        });
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
            generation = state.generation,
            position_ms = state.position_ms,
            duration_ms = state.duration_ms,
            volume = state.volume,
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
