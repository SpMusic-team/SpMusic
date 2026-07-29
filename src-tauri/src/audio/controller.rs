use std::{
    path::PathBuf,
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter};

use super::{
    device::{
        current_output_device_signature, start_audio_device_watcher, AudioDeviceEvent,
        AudioDeviceWatcherHandle,
    },
    error::{audio_error, unavailable_state, AudioCommandError, AudioErrorCode},
    runtime::{AudioRuntime, AudioRuntimeRequest},
    source::{
        default_filters, hydrate_track_ref, input_path, load_folder_playlist, source_filters,
    },
    types::{
        AudioFolderPlaylist, AudioFolderPlaylistInput, AudioLoadFileInput, AudioOpenFileInput,
        AudioOpenSourceResult, AudioPlayInput, AudioPlaybackState, AudioSeekInput,
        AudioSetVolumeInput, AudioTrackRef,
    },
    AUDIO_STATE_CHANGED_EVENT,
};

const OUTPUT_DEVICE_EVENT_DEBOUNCE: Duration = Duration::from_millis(350);
const OUTPUT_DEVICE_EVENT_MAX_COALESCE: Duration = Duration::from_millis(1_500);

pub struct AudioController {
    tx: Mutex<Sender<AudioRuntimeRequest>>,
    cover_cache_dir: PathBuf,
    _device_watcher: AudioDeviceWatcherHandle,
}

impl AudioController {
    pub fn new(app_handle: AppHandle, cache_dir: PathBuf) -> Self {
        tracing::info!(
            operation = "audio.controller.start",
            "starting audio controller",
        );
        let (tx, rx) = mpsc::channel::<AudioRuntimeRequest>();
        let (device_tx, device_rx) = mpsc::channel::<AudioDeviceEvent>();
        let device_watcher = start_audio_device_watcher(device_tx);
        let runtime_tx = tx.clone();

        thread::spawn(move || {
            run_audio_device_bridge(device_rx, runtime_tx);
        });

        let cover_cache_dir = cache_dir.join("audio");
        let runtime_cover_cache_dir = cover_cache_dir.clone();

        thread::spawn(move || {
            tracing::info!(
                operation = "audio.controller.runtime_thread",
                "started audio runtime thread",
            );
            let mut runtime = AudioRuntime::with_cover_cache_dir(runtime_cover_cache_dir);

            while let Ok(request) = rx.recv() {
                match request {
                    AudioRuntimeRequest::LoadFile { path, reply } => {
                        let started_at = Instant::now();
                        tracing::info!(
                            operation = "audio.load_file",
                            path = %path.display(),
                            "runtime load request received",
                        );
                        let result = runtime.load_path(path);
                        log_track_result("audio.load_file", started_at, &result);
                        let state = runtime.get_state();
                        let _ = reply.send(result);
                        emit_state_changed(&app_handle, state);
                    }
                    AudioRuntimeRequest::Play { input, reply } => {
                        let started_at = Instant::now();
                        tracing::info!(
                            operation = "audio.play",
                            restart = input.as_ref().and_then(|value| value.restart),
                            "runtime play request received",
                        );
                        let result = runtime.play(input);
                        log_state_result("audio.play", started_at, &result);
                        let state = state_for_audio_result(&mut runtime, &result);
                        let _ = reply.send(result);
                        emit_state_changed(&app_handle, state);
                    }
                    AudioRuntimeRequest::Pause { reply } => {
                        let started_at = Instant::now();
                        tracing::info!(operation = "audio.pause", "runtime pause request received");
                        let result = runtime.pause();
                        log_state_result("audio.pause", started_at, &result);
                        let state = state_for_audio_result(&mut runtime, &result);
                        let _ = reply.send(result);
                        emit_state_changed(&app_handle, state);
                    }
                    AudioRuntimeRequest::Stop { reply } => {
                        let started_at = Instant::now();
                        tracing::info!(operation = "audio.stop", "runtime stop request received");
                        let result = runtime.stop();
                        log_state_result("audio.stop", started_at, &result);
                        let state = state_for_audio_result(&mut runtime, &result);
                        let _ = reply.send(result);
                        emit_state_changed(&app_handle, state);
                    }
                    AudioRuntimeRequest::Seek { input, reply } => {
                        let started_at = Instant::now();
                        tracing::info!(
                            operation = "audio.seek",
                            requested_ms = input.position_ms,
                            "runtime seek request received",
                        );
                        let result = runtime.seek(input);
                        log_state_result("audio.seek", started_at, &result);
                        let state = state_for_audio_result(&mut runtime, &result);
                        let _ = reply.send(result);
                        emit_state_changed(&app_handle, state);
                    }
                    AudioRuntimeRequest::SetVolume { input, reply } => {
                        let started_at = Instant::now();
                        tracing::info!(
                            operation = "audio.set_volume",
                            requested_volume = input.volume,
                            "runtime volume request received",
                        );
                        let result = runtime.set_volume(input);
                        log_state_result("audio.set_volume", started_at, &result);
                        let state = state_for_audio_result(&mut runtime, &result);
                        let _ = reply.send(result);
                        emit_state_changed(&app_handle, state);
                    }
                    AudioRuntimeRequest::GetState { reply } => {
                        tracing::debug!(operation = "audio.get_state", "runtime state requested");
                        let _ = reply.send(runtime.get_state());
                    }
                    AudioRuntimeRequest::GetCurrentTrack { reply } => {
                        tracing::debug!(
                            operation = "audio.get_current_track",
                            "runtime current track requested",
                        );
                        let _ = reply.send(runtime.get_current_track());
                    }
                    AudioRuntimeRequest::OutputDeviceInterrupted => {
                        let started_at = Instant::now();
                        let state = runtime.handle_output_device_interruption();
                        tracing::info!(
                            operation = "audio.device.output_interrupted",
                            elapsed_ms = started_at.elapsed().as_millis() as u64,
                            phase = ?state.phase,
                            position_ms = state.position_ms,
                            "handled output device interruption",
                        );
                        emit_state_changed(&app_handle, state);
                    }
                    AudioRuntimeRequest::OutputDeviceChanged { signature } => {
                        let started_at = Instant::now();
                        let state = runtime.handle_output_device_change(signature);
                        tracing::info!(
                            operation = "audio.device.output_changed",
                            elapsed_ms = started_at.elapsed().as_millis() as u64,
                            phase = ?state.phase,
                            position_ms = state.position_ms,
                            "handled output device change",
                        );
                        emit_state_changed(&app_handle, state);
                    }
                }
            }
            tracing::info!(
                operation = "audio.controller.runtime_thread",
                "audio runtime thread stopped",
            );
        });

        Self {
            tx: Mutex::new(tx),
            cover_cache_dir,
            _device_watcher: device_watcher,
        }
    }

    pub fn open_file(
        &self,
        input: Option<AudioOpenFileInput>,
    ) -> Result<AudioTrackRef, AudioCommandError> {
        tracing::info!(
            operation = "audio.open_file_dialog",
            has_custom_filters = input.is_some(),
            "opening audio file dialog",
        );
        let mut dialog = rfd::FileDialog::new();

        if let Some(input) = input {
            for filter in input.filters.unwrap_or_else(default_filters) {
                let extensions = filter
                    .extensions
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                if !extensions.is_empty() {
                    dialog = dialog.add_filter(&filter.name, &extensions);
                }
            }
        } else {
            for filter in default_filters() {
                let extensions = filter
                    .extensions
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                dialog = dialog.add_filter(&filter.name, &extensions);
            }
        }

        let Some(path) = dialog.pick_file() else {
            tracing::info!(
                operation = "audio.open_file_dialog",
                "audio file dialog cancelled",
            );
            return Err(audio_error(
                AudioErrorCode::UserCancelled,
                "User cancelled audio file selection",
                true,
            ));
        };

        tracing::info!(
            operation = "audio.open_file_dialog",
            path = %path.display(),
            "audio file selected",
        );
        self.load_file_path(path)
    }

    pub fn open_source(&self) -> Result<AudioOpenSourceResult, AudioCommandError> {
        tracing::info!(
            operation = "audio.open_source_dialog",
            "opening audio source dialog",
        );
        let mut dialog = rfd::FileDialog::new();

        for filter in source_filters() {
            let extensions = filter
                .extensions
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            if !extensions.is_empty() {
                dialog = dialog.add_filter(&filter.name, &extensions);
            }
        }

        let Some(path) = dialog.pick_file() else {
            tracing::info!(
                operation = "audio.open_source_dialog",
                "audio source dialog cancelled",
            );
            return Err(audio_error(
                AudioErrorCode::UserCancelled,
                "User cancelled audio source selection",
                true,
            ));
        };

        tracing::info!(
            operation = "audio.open_source_dialog",
            path = %path.display(),
            "audio source selected",
        );

        if path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("m3u8"))
        {
            return load_folder_playlist(&path)
                .map(|playlist| AudioOpenSourceResult::Playlist { playlist });
        }

        self.load_file_path(path)
            .map(|track| AudioOpenSourceResult::Track { track })
    }

    pub fn load_file(&self, input: AudioLoadFileInput) -> Result<AudioTrackRef, AudioCommandError> {
        tracing::info!(
            operation = "audio.load_file_command",
            path = %input.path,
            "load file command received",
        );
        self.load_file_path(input_path(&input.path)?)
    }

    pub fn hydrate_track(
        &self,
        input: AudioLoadFileInput,
    ) -> Result<AudioTrackRef, AudioCommandError> {
        tracing::info!(
            operation = "audio.hydrate_track_command",
            path = %input.path,
            "hydrate track command received",
        );
        hydrate_track_ref(&input_path(&input.path)?, Some(&self.cover_cache_dir))
    }

    pub fn list_folder_tracks(
        &self,
        input: AudioFolderPlaylistInput,
    ) -> Result<AudioFolderPlaylist, AudioCommandError> {
        tracing::info!(
            operation = "audio.list_folder_tracks_command",
            selected_path = %input.selected_path,
            "folder playlist command received",
        );
        load_folder_playlist(&input_path(&input.selected_path)?)
    }

    pub fn play(
        &self,
        input: Option<AudioPlayInput>,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        let started_at = Instant::now();
        let (reply, rx) = mpsc::channel();
        self.send(AudioRuntimeRequest::Play { input, reply })?;
        let result = self.recv_state(rx);
        log_state_result("audio.controller.play_round_trip", started_at, &result);
        result
    }

    pub fn pause(&self) -> Result<AudioPlaybackState, AudioCommandError> {
        let started_at = Instant::now();
        let (reply, rx) = mpsc::channel();
        self.send(AudioRuntimeRequest::Pause { reply })?;
        let result = self.recv_state(rx);
        log_state_result("audio.controller.pause_round_trip", started_at, &result);
        result
    }

    pub fn stop(&self) -> Result<AudioPlaybackState, AudioCommandError> {
        let (reply, rx) = mpsc::channel();
        self.send(AudioRuntimeRequest::Stop { reply })?;
        self.recv_state(rx)
    }

    pub fn seek(&self, input: AudioSeekInput) -> Result<AudioPlaybackState, AudioCommandError> {
        let (reply, rx) = mpsc::channel();
        self.send(AudioRuntimeRequest::Seek { input, reply })?;
        self.recv_state(rx)
    }

    pub fn set_volume(
        &self,
        input: AudioSetVolumeInput,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        let (reply, rx) = mpsc::channel();
        self.send(AudioRuntimeRequest::SetVolume { input, reply })?;
        self.recv_state(rx)
    }

    pub fn get_state(&self) -> AudioPlaybackState {
        let (reply, rx) = mpsc::channel();
        if self.send(AudioRuntimeRequest::GetState { reply }).is_err() {
            return unavailable_state("Audio runtime is unavailable");
        }
        rx.recv()
            .unwrap_or_else(|_| unavailable_state("Audio runtime did not return state"))
    }

    pub fn get_current_track(&self) -> Result<Option<AudioTrackRef>, AudioCommandError> {
        let (reply, rx) = mpsc::channel();
        self.send(AudioRuntimeRequest::GetCurrentTrack { reply })?;
        rx.recv().map_err(|_| {
            tracing::warn!(
                operation = "audio.controller.get_current_track",
                "audio runtime did not return current track",
            );
            audio_error(
                AudioErrorCode::InternalError,
                "Audio runtime did not return current track",
                true,
            )
        })
    }

    fn load_file_path(&self, path: PathBuf) -> Result<AudioTrackRef, AudioCommandError> {
        let (reply, rx) = mpsc::channel();
        self.send(AudioRuntimeRequest::LoadFile { path, reply })?;
        self.recv_track(rx)
    }

    fn send(&self, request: AudioRuntimeRequest) -> Result<(), AudioCommandError> {
        let tx = self.tx.lock().map_err(|_| {
            tracing::warn!(
                operation = "audio.controller.send",
                "audio controller mutex is poisoned",
            );
            audio_error(
                AudioErrorCode::InternalError,
                "Audio controller mutex is poisoned",
                true,
            )
        })?;
        tx.send(request).map_err(|_| {
            tracing::warn!(
                operation = "audio.controller.send",
                "audio runtime channel is unavailable",
            );
            audio_error(
                AudioErrorCode::InternalError,
                "Audio runtime is unavailable",
                true,
            )
        })
    }

    fn recv_track(
        &self,
        rx: mpsc::Receiver<Result<AudioTrackRef, AudioCommandError>>,
    ) -> Result<AudioTrackRef, AudioCommandError> {
        rx.recv().map_err(|_| {
            tracing::warn!(
                operation = "audio.controller.recv_track",
                "audio runtime did not return track",
            );
            audio_error(
                AudioErrorCode::InternalError,
                "Audio runtime did not return track",
                true,
            )
        })?
    }

    fn recv_state(
        &self,
        rx: mpsc::Receiver<Result<AudioPlaybackState, AudioCommandError>>,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        rx.recv().map_err(|_| {
            tracing::warn!(
                operation = "audio.controller.recv_state",
                "audio runtime did not return state",
            );
            audio_error(
                AudioErrorCode::InternalError,
                "Audio runtime did not return state",
                true,
            )
        })?
    }
}

fn emit_state_changed(app_handle: &AppHandle, state: AudioPlaybackState) {
    let started_at = Instant::now();
    tracing::debug!(
        operation = "audio.controller.emit_state",
        event = AUDIO_STATE_CHANGED_EVENT,
        phase = ?state.phase,
        position_ms = state.position_ms,
        duration_ms = state.duration_ms,
        volume = state.volume,
        track_id = state.current_track_id.as_deref(),
        "emitting audio state changed",
    );
    if let Err(error) = app_handle.emit(AUDIO_STATE_CHANGED_EVENT, state) {
        tracing::warn!(
            operation = "audio.controller.emit_state",
            event = AUDIO_STATE_CHANGED_EVENT,
            error = %error,
            "failed to emit audio state",
        );
    }
    tracing::debug!(
        operation = "audio.controller.emit_state",
        event = AUDIO_STATE_CHANGED_EVENT,
        elapsed_ms = started_at.elapsed().as_millis() as u64,
        "audio state event emission completed",
    );
}

fn run_audio_device_bridge(
    device_rx: Receiver<AudioDeviceEvent>,
    runtime_tx: Sender<AudioRuntimeRequest>,
) {
    tracing::info!(
        operation = "audio.controller.device_bridge",
        debounce_ms = OUTPUT_DEVICE_EVENT_DEBOUNCE.as_millis() as u64,
        max_coalesce_ms = OUTPUT_DEVICE_EVENT_MAX_COALESCE.as_millis() as u64,
        "started audio device watcher bridge thread",
    );

    let mut last_forwarded_signature: Option<Option<String>> = None;

    while let Ok(event) = device_rx.recv() {
        let batch_started_at = Instant::now();
        let mut event_count = 1_u64;
        log_raw_device_event(event_count, &event);
        if runtime_tx
            .send(AudioRuntimeRequest::OutputDeviceInterrupted)
            .is_err()
        {
            tracing::warn!(
                operation = "audio.controller.device_bridge",
                "audio runtime channel closed while forwarding immediate device interruption",
            );
            break;
        }

        loop {
            let elapsed = batch_started_at.elapsed();
            if elapsed >= OUTPUT_DEVICE_EVENT_MAX_COALESCE {
                break;
            }

            let max_remaining = OUTPUT_DEVICE_EVENT_MAX_COALESCE.saturating_sub(elapsed);
            let timeout = max_remaining.min(OUTPUT_DEVICE_EVENT_DEBOUNCE);
            if timeout.is_zero() {
                break;
            }

            match device_rx.recv_timeout(timeout) {
                Ok(event) => {
                    event_count += 1;
                    log_raw_device_event(event_count, &event);
                }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    tracing::info!(
                        operation = "audio.controller.device_bridge",
                        "audio device watcher bridge thread stopped",
                    );
                    return;
                }
            }
        }

        let probe_started_at = Instant::now();
        let signature = current_output_device_signature();
        let signature_probe_elapsed_ms = probe_started_at.elapsed().as_millis() as u64;
        let coalesce_elapsed_ms = batch_started_at.elapsed().as_millis() as u64;
        let should_forward = match &last_forwarded_signature {
            Some(last_signature) => last_signature != &signature,
            None => true,
        };

        if !should_forward {
            tracing::debug!(
                operation = "audio.controller.device_bridge",
                event_count,
                signature = signature.as_deref(),
                signature_probe_elapsed_ms,
                coalesce_elapsed_ms,
                "suppressed unchanged output device signature",
            );
            continue;
        }

        tracing::info!(
            operation = "audio.controller.device_bridge",
            event_count,
            signature = signature.as_deref(),
            signature_probe_elapsed_ms,
            coalesce_elapsed_ms,
            "coalesced output device events",
        );
        last_forwarded_signature = Some(signature.clone());

        if runtime_tx
            .send(AudioRuntimeRequest::OutputDeviceChanged { signature })
            .is_err()
        {
            tracing::warn!(
                operation = "audio.controller.device_bridge",
                "audio runtime channel closed while forwarding device event",
            );
            break;
        }
    }

    tracing::info!(
        operation = "audio.controller.device_bridge",
        "audio device watcher bridge thread stopped",
    );
}

fn log_raw_device_event(event_count: u64, event: &AudioDeviceEvent) {
    match event {
        AudioDeviceEvent::DefaultOutputChanged => tracing::debug!(
            operation = "audio.controller.device_bridge",
            event = "default_output_changed",
            event_count,
            "received default output changed event",
        ),
        AudioDeviceEvent::DefaultOutputUnavailable => tracing::debug!(
            operation = "audio.controller.device_bridge",
            event = "default_output_unavailable",
            event_count,
            "received default output unavailable event",
        ),
    }
}

fn state_for_audio_result(
    runtime: &mut AudioRuntime,
    result: &Result<AudioPlaybackState, AudioCommandError>,
) -> AudioPlaybackState {
    result
        .as_ref()
        .cloned()
        .unwrap_or_else(|_| runtime.get_state())
}

fn log_track_result(
    operation: &'static str,
    started_at: Instant,
    result: &Result<AudioTrackRef, AudioCommandError>,
) {
    let elapsed_ms = started_at.elapsed().as_millis() as u64;

    match result {
        Ok(track) => tracing::info!(
            operation,
            elapsed_ms,
            track_id = %track.id,
            file_name = %track.file_name,
            duration_ms = track.duration_ms,
            metadata_title = track.metadata.title.as_deref(),
            has_cover = track.metadata.cover_art.is_some(),
            has_lyrics = track.metadata.lyrics.is_some(),
            "audio track request completed",
        ),
        Err(error) => tracing::warn!(
            operation,
            elapsed_ms,
            error_code = ?error.code,
            recoverable = error.recoverable,
            error = %error.message,
            "audio track request failed",
        ),
    }
}

fn log_state_result(
    operation: &'static str,
    started_at: Instant,
    result: &Result<AudioPlaybackState, AudioCommandError>,
) {
    let elapsed_ms = started_at.elapsed().as_millis() as u64;

    match result {
        Ok(state) => tracing::info!(
            operation,
            elapsed_ms,
            phase = ?state.phase,
            position_ms = state.position_ms,
            duration_ms = state.duration_ms,
            volume = state.volume,
            track_id = state.current_track_id.as_deref(),
            "audio state request completed",
        ),
        Err(error) => tracing::warn!(
            operation,
            elapsed_ms,
            error_code = ?error.code,
            recoverable = error.recoverable,
            error = %error.message,
            "audio state request failed",
        ),
    }
}
