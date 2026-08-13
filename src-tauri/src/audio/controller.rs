use std::{
    path::PathBuf,
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        Arc, Mutex,
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
    lyrics_cache::LyricsCache,
    playlist::{default_filters, load_folder_playlist, source_filters},
    runtime::{
        start_track_parser, AudioRuntime, AudioRuntimeRequest, TrackParsePurpose, TrackParseRequest,
    },
    source::{hydrate_track_ref, input_path, validate_existing_file},
    tag_writer,
    types::{
        AudioEmbedLyricsInput, AudioFolderPlaylist, AudioFolderPlaylistInput,
        AudioLoadAndPlayInput, AudioLoadAndPlayResult, AudioLoadFileInput, AudioOpenFileInput,
        AudioOpenSourceResult, AudioPlayInput, AudioPlaybackState, AudioSeekInput,
        AudioSetVolumeInput, AudioTrackDetailsChanged, AudioTrackRef,
    },
    AUDIO_STATE_CHANGED_EVENT, AUDIO_TRACK_DETAILS_CHANGED_EVENT,
};

const OUTPUT_DEVICE_EVENT_DEBOUNCE: Duration = Duration::from_millis(350);
const OUTPUT_DEVICE_EVENT_MAX_COALESCE: Duration = Duration::from_millis(1_500);

struct PendingLoad {
    generation: u64,
    path: PathBuf,
    reply: Sender<Result<AudioTrackRef, AudioCommandError>>,
}

pub struct AudioController {
    tx: Mutex<Sender<AudioRuntimeRequest>>,
    // Held for the process lifetime so the parser worker keeps receiving
    // requests; the worker itself owns the receiving side.
    _parser_tx: Mutex<Sender<TrackParseRequest>>,
    cover_cache_dir: PathBuf,
    // Shared sidecar-lyrics cache: cloned into the parser worker thread and
    // invalidated after a successful `audio_embed_lyrics`.
    lyrics_cache: Arc<LyricsCache>,
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
        let lyrics_cache = Arc::new(LyricsCache::new(LyricsCache::MAX_LYRICS_CACHE_ENTRIES));
        let parser_lyrics_cache = Arc::clone(&lyrics_cache);
        let (parser_tx, parser_rx) = mpsc::channel::<TrackParseRequest>();
        let parser_runtime_tx = tx.clone();
        let parser_cover_cache_dir = runtime_cover_cache_dir.clone();
        // start_track_parser spawns the worker thread itself; dropping the
        // returned join handle detaches it for the process lifetime.
        let _parser_handle = start_track_parser(
            parser_rx,
            parser_runtime_tx,
            parser_cover_cache_dir,
            parser_lyrics_cache,
        );

        let runtime_parser_tx = parser_tx.clone();

        thread::spawn(move || {
            tracing::info!(
                operation = "audio.controller.runtime_thread",
                "started audio runtime thread",
            );
            let mut runtime = AudioRuntime::default();
            let mut pending_load: Option<PendingLoad> = None;

            while let Ok(request) = rx.recv() {
                match request {
                    AudioRuntimeRequest::LoadFile { path, reply } => {
                        tracing::info!(
                            operation = "audio.load_file",
                            path = %path.display(),
                            "runtime load request received",
                        );
                        if let Some(previous) = pending_load.take() {
                            tracing::info!(
                                operation = "audio.load_file.superseded",
                                previous_path = %previous.path.display(),
                                "superseding previous in-flight load",
                            );
                            let superseded_error = audio_error(
                                AudioErrorCode::InternalError,
                                format!(
                                    "Audio load superseded by a newer request: {}",
                                    previous.path.display()
                                ),
                                true,
                            );
                            let _ = previous.reply.send(Err(superseded_error));
                        }
                        let generation = runtime.start_load(&path);
                        pending_load = Some(PendingLoad {
                            generation,
                            path: path.clone(),
                            reply,
                        });
                        emit_state_changed(&app_handle, runtime.get_state());
                        if let Err(error) = runtime_parser_tx.send(TrackParseRequest {
                            generation,
                            path,
                            purpose: TrackParsePurpose::LegacyLoad,
                        }) {
                            tracing::error!(
                                operation = "audio.load_file",
                                error = %error,
                                "track parser channel is unavailable",
                            );
                            if let Some(pending) = pending_load.take() {
                                let parser_error = audio_error(
                                    AudioErrorCode::InternalError,
                                    "Audio parser is unavailable",
                                    true,
                                );
                                runtime.complete_load(
                                    pending.generation,
                                    pending.path.clone(),
                                    &Err(parser_error.clone()),
                                );
                                let _ = pending.reply.send(Err(parser_error));
                            }
                            emit_state_changed(&app_handle, runtime.get_state());
                        }
                    }
                    AudioRuntimeRequest::LoadAndPlay {
                        path,
                        request_id,
                        reply,
                    } => {
                        if let Some(previous) = pending_load.take() {
                            let superseded_error = audio_error(
                                AudioErrorCode::InternalError,
                                format!(
                                    "Audio load superseded by a newer request: {}",
                                    previous.path.display()
                                ),
                                true,
                            );
                            let _ = previous.reply.send(Err(superseded_error));
                        }
                        let result = runtime.load_and_play(path.clone(), request_id);
                        let state = match &result {
                            Ok(result) => result.state.clone(),
                            Err(_) => runtime.get_state(),
                        };
                        emit_state_changed(&app_handle, state);

                        if let Ok(result) = &result {
                            let generation = result.generation;
                            let track_id = result.track_id.clone();
                            let details_request = TrackParseRequest {
                                generation,
                                path: path.clone(),
                                purpose: TrackParsePurpose::Details {
                                    request_id,
                                    track_id: track_id.clone(),
                                },
                            };
                            tracing::info!(
                                operation = "audio.track_details.begin",
                                request_id,
                                generation,
                                track_id = %track_id,
                                path = %path.display(),
                                "audio track details hydration started",
                            );
                            if runtime_parser_tx.send(details_request).is_err() {
                                let error = audio_error(
                                    AudioErrorCode::InternalError,
                                    "Audio parser is unavailable",
                                    true,
                                );
                                if runtime.apply_track_details(
                                    generation,
                                    &track_id,
                                    &Err(error.clone()),
                                ) {
                                    emit_track_details_changed(
                                        &app_handle,
                                        AudioTrackDetailsChanged::Error {
                                            request_id,
                                            generation,
                                            track_id,
                                            error,
                                        },
                                    );
                                }
                            }
                        }
                        let _ = reply.send(result);
                    }
                    AudioRuntimeRequest::TrackParsed {
                        generation,
                        path,
                        result,
                    } => {
                        let started_at = Instant::now();
                        let result = *result;
                        let is_current = pending_load
                            .as_ref()
                            .is_some_and(|pending| pending.generation == generation);
                        if is_current {
                            let applied = runtime.complete_load(generation, path, &result);
                            if !applied {
                                tracing::warn!(
                                    operation = "audio.track_parsed",
                                    generation,
                                    "runtime rejected parse result despite matching pending load",
                                );
                            }
                            let state = runtime.get_state();
                            log_track_result("audio.load_file", started_at, &result);
                            if let Some(pending) = pending_load.take() {
                                let _ = pending.reply.send(result);
                            }
                            emit_state_changed(&app_handle, state);
                        } else {
                            tracing::debug!(
                                operation = "audio.track_parsed",
                                generation,
                                "ignored stale track parse result",
                            );
                        }
                    }
                    AudioRuntimeRequest::TrackDetailsHydrated {
                        request_id,
                        generation,
                        track_id,
                        result,
                    } => {
                        let result = *result;
                        if runtime.apply_track_details(generation, &track_id, &result) {
                            let event = match result {
                                Ok(track) => AudioTrackDetailsChanged::Ready {
                                    request_id,
                                    generation,
                                    track,
                                },
                                Err(error) => AudioTrackDetailsChanged::Error {
                                    request_id,
                                    generation,
                                    track_id,
                                    error,
                                },
                            };
                            emit_track_details_changed(&app_handle, event);
                        } else {
                            tracing::info!(
                                operation = "audio.track_details.end",
                                request_id,
                                generation,
                                track_id = %track_id,
                                status = "stale_suppressed",
                                "audio track details hydration completed without emission",
                            );
                        }
                    }
                    AudioRuntimeRequest::Play { input, reply } => {
                        tracing::info!(
                            operation = "audio.play",
                            restart = input.as_ref().and_then(|value| value.restart),
                            "runtime play request received",
                        );
                        dispatch_state_request(
                            &app_handle,
                            &mut runtime,
                            "audio.play",
                            reply,
                            |runtime| runtime.play(input),
                        );
                    }
                    AudioRuntimeRequest::Pause { reply } => {
                        tracing::info!(operation = "audio.pause", "runtime pause request received");
                        dispatch_state_request(
                            &app_handle,
                            &mut runtime,
                            "audio.pause",
                            reply,
                            AudioRuntime::pause,
                        );
                    }
                    AudioRuntimeRequest::Stop { reply } => {
                        tracing::info!(operation = "audio.stop", "runtime stop request received");
                        dispatch_state_request(
                            &app_handle,
                            &mut runtime,
                            "audio.stop",
                            reply,
                            AudioRuntime::stop,
                        );
                    }
                    AudioRuntimeRequest::Seek { input, reply } => {
                        tracing::info!(
                            operation = "audio.seek",
                            requested_ms = input.position_ms,
                            "runtime seek request received",
                        );
                        dispatch_state_request(
                            &app_handle,
                            &mut runtime,
                            "audio.seek",
                            reply,
                            |runtime| runtime.seek(input),
                        );
                    }
                    AudioRuntimeRequest::SetVolume { input, reply } => {
                        tracing::info!(
                            operation = "audio.set_volume",
                            requested_volume = input.volume,
                            "runtime volume request received",
                        );
                        dispatch_state_request(
                            &app_handle,
                            &mut runtime,
                            "audio.set_volume",
                            reply,
                            |runtime| runtime.set_volume(input),
                        );
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
            _parser_tx: Mutex::new(parser_tx),
            cover_cache_dir,
            lyrics_cache,
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
            .map(|track| AudioOpenSourceResult::Track {
                track: Box::new(track),
            })
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
        hydrate_track_ref(
            &input_path(&input.path)?,
            Some(&self.cover_cache_dir),
            Some(&self.lyrics_cache),
        )
    }

    pub fn load_and_play(
        &self,
        input: AudioLoadAndPlayInput,
    ) -> Result<AudioLoadAndPlayResult, AudioCommandError> {
        let path = input_path(&input.path)?;
        let (reply, rx) = mpsc::channel();
        self.send(AudioRuntimeRequest::LoadAndPlay {
            path,
            request_id: input.request_id,
            reply,
        })?;
        rx.recv().map_err(|_| {
            audio_error(
                AudioErrorCode::InternalError,
                "Audio runtime did not return load-and-play result",
                true,
            )
        })?
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

    /// Explicitly embeds `lyrics` into the audio file's primary tag — the
    /// single production write entry point (via `tag_writer::embed_lyrics`).
    /// Runs synchronously on the command thread and never enters the runtime
    /// state machine. On success the lyrics cache is invalidated and the
    /// track is re-hydrated so the returned `AudioTrackRef` carries the new
    /// embedded lyrics.
    pub fn embed_lyrics(
        &self,
        input: AudioEmbedLyricsInput,
    ) -> Result<AudioTrackRef, AudioCommandError> {
        let path = input_path(&input.path)?;
        validate_existing_file(&path)?;
        // Mirror `safe_update_tag`'s own path requirements up front so they
        // surface as a stable INVALID_PATH instead of an unmapped message.
        if path.parent().is_none() || path.extension().is_none() {
            tracing::warn!(
                operation = "audio.lyrics.embed",
                path = %path.display(),
                "audio path has no parent directory or extension",
            );
            return Err(audio_error(
                AudioErrorCode::InvalidPath,
                "Audio path has no parent directory or extension",
                true,
            ));
        }

        let started_at = Instant::now();
        let result = tag_writer::embed_lyrics(&path, &input.lyrics)
            .map_err(|message| map_embed_lyrics_error(&message));

        match &result {
            Ok(()) => {
                tracing::info!(
                    operation = "audio.lyrics.embed",
                    path = %path.display(),
                    lyric_byte_len = input.lyrics.len(),
                    elapsed_ms = started_at.elapsed().as_millis() as u64,
                    "lyrics embedded into audio file",
                );
                // Only invalidate after a successful, transactional write.
                self.lyrics_cache.invalidate(&path);
            }
            Err(error) => {
                tracing::warn!(
                    operation = "audio.lyrics.embed",
                    path = %path.display(),
                    error_code = ?error.code,
                    recoverable = error.recoverable,
                    error = %error.message,
                    elapsed_ms = started_at.elapsed().as_millis() as u64,
                    "lyrics embedding failed",
                );
            }
        }

        result?;
        hydrate_track_ref(&path, Some(&self.cover_cache_dir), Some(&self.lyrics_cache))
    }

    pub fn play(
        &self,
        input: Option<AudioPlayInput>,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        self.request_state("audio.controller.play_round_trip", |reply| {
            AudioRuntimeRequest::Play { input, reply }
        })
    }

    pub fn pause(&self) -> Result<AudioPlaybackState, AudioCommandError> {
        self.request_state("audio.controller.pause_round_trip", |reply| {
            AudioRuntimeRequest::Pause { reply }
        })
    }

    pub fn stop(&self) -> Result<AudioPlaybackState, AudioCommandError> {
        self.request_state("audio.controller.stop_round_trip", |reply| {
            AudioRuntimeRequest::Stop { reply }
        })
    }

    pub fn seek(&self, input: AudioSeekInput) -> Result<AudioPlaybackState, AudioCommandError> {
        self.request_state("audio.controller.seek_round_trip", |reply| {
            AudioRuntimeRequest::Seek { input, reply }
        })
    }

    pub fn set_volume(
        &self,
        input: AudioSetVolumeInput,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        self.request_state("audio.controller.set_volume_round_trip", |reply| {
            AudioRuntimeRequest::SetVolume { input, reply }
        })
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

    fn request_state(
        &self,
        operation: &'static str,
        build_request: impl FnOnce(
            Sender<Result<AudioPlaybackState, AudioCommandError>>,
        ) -> AudioRuntimeRequest,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        let started_at = Instant::now();
        let (reply, rx) = mpsc::channel();
        let result = self
            .send(build_request(reply))
            .and_then(|()| self.recv_state(rx));
        log_state_result(operation, started_at, &result);
        result
    }
}

fn dispatch_state_request(
    app_handle: &AppHandle,
    runtime: &mut AudioRuntime,
    operation: &'static str,
    reply: Sender<Result<AudioPlaybackState, AudioCommandError>>,
    execute: impl FnOnce(&mut AudioRuntime) -> Result<AudioPlaybackState, AudioCommandError>,
) {
    let started_at = Instant::now();
    let result = execute(runtime);
    log_state_result(operation, started_at, &result);
    let state = state_for_audio_result(runtime, &result);
    let _ = reply.send(result);
    emit_state_changed(app_handle, state);
}

fn emit_state_changed(app_handle: &AppHandle, state: AudioPlaybackState) {
    let started_at = Instant::now();
    tracing::debug!(
        operation = "audio.controller.emit_state",
        event = AUDIO_STATE_CHANGED_EVENT,
        phase = ?state.phase,
        generation = state.generation,
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

fn emit_track_details_changed(app_handle: &AppHandle, event: AudioTrackDetailsChanged) {
    let (request_id, generation, track_id, status) = match &event {
        AudioTrackDetailsChanged::Ready {
            request_id,
            generation,
            track,
        } => (*request_id, *generation, track.id.clone(), "ready"),
        AudioTrackDetailsChanged::Error {
            request_id,
            generation,
            track_id,
            ..
        } => (*request_id, *generation, track_id.clone(), "error"),
    };
    tracing::info!(
        operation = "audio.track_details.end",
        event = AUDIO_TRACK_DETAILS_CHANGED_EVENT,
        request_id,
        generation,
        track_id = %track_id,
        status,
        "audio track details hydration completed",
    );
    if let Err(error) = app_handle.emit(AUDIO_TRACK_DETAILS_CHANGED_EVENT, event) {
        tracing::warn!(
            operation = "audio.controller.emit_track_details",
            event = AUDIO_TRACK_DETAILS_CHANGED_EVENT,
            request_id,
            generation,
            track_id = %track_id,
            error = %error,
            "failed to emit audio track details",
        );
    }
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
            generation = state.generation,
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

/// Maps a `tag_writer` error message to the stable `AudioErrorCode` contract
/// from the OPT-0002 architecture (see
/// `docs/architecture/lyrics-cache-and-embed-boundary.md`, command error
/// table). `tag_writer` returns a `String`, so classification is
/// message-content based; the mapping must stay stable:
///
/// | scenario | code | recoverable |
/// | --- | --- | --- |
/// | no parent dir / no extension | INVALID_PATH | true |
/// | copy / write / staging / cleanup I/O failure | UNREADABLE_FILE | true |
/// | tag parse (lofty) / rewrite validation failure | UNSUPPORTED_FORMAT | true |
/// | install failed and rollback failed (atomicity broken) | INTERNAL_ERROR | false |
fn map_embed_lyrics_error(message: &str) -> AudioCommandError {
    let lower = message.to_ascii_lowercase();
    let (code, recoverable) = if lower.contains("failed to install rewritten audio") {
        if message.contains("rollback=Err") {
            // The original file could not be restored: atomicity is broken.
            (AudioErrorCode::InternalError, false)
        } else {
            (AudioErrorCode::UnreadableFile, true)
        }
    } else if lower.contains("no parent directory") || lower.contains("no extension") {
        (AudioErrorCode::InvalidPath, true)
    } else if lower.contains("failed to create tag update copy")
        || lower.contains("failed to write tag update copy")
        || lower.contains("failed to stage original audio file")
        || lower.contains("backup cleanup failed")
    {
        (AudioErrorCode::UnreadableFile, true)
    } else if lower.contains("failed to read tag update copy")
        || lower.contains("rewritten audio failed validation")
    {
        (AudioErrorCode::UnsupportedFormat, true)
    } else {
        // Unknown writer failure: surface as a recoverable format error
        // rather than claiming broken atomicity.
        (AudioErrorCode::UnsupportedFormat, true)
    };
    audio_error(
        code,
        format!("Failed to embed lyrics: {message}"),
        recoverable,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embed_error_mapping_covers_copy_write_staging_and_cleanup_io_failures() {
        for message in [
            "failed to create tag update copy: permission denied",
            "failed to write tag update copy: disk full",
            "failed to stage original audio file: access denied",
            "tag update succeeded but backup cleanup failed: file locked",
        ] {
            let error = map_embed_lyrics_error(message);
            assert_eq!(error.code, AudioErrorCode::UnreadableFile, "{message}");
            assert!(error.recoverable, "{message}");
        }
    }

    #[test]
    fn embed_error_mapping_covers_tag_parse_and_rewrite_validation_failures() {
        for message in [
            "failed to read tag update copy: the file format could not be determined",
            "rewritten audio failed validation: unsupported codec",
        ] {
            let error = map_embed_lyrics_error(message);
            assert_eq!(error.code, AudioErrorCode::UnsupportedFormat, "{message}");
            assert!(error.recoverable, "{message}");
        }
    }

    #[test]
    fn embed_error_mapping_marks_broken_atomicity_as_non_recoverable_internal_error() {
        let broken = map_embed_lyrics_error(
            "failed to install rewritten audio: disk full; rollback=Err(Os { code: 5, kind: PermissionDenied, message: \"Access is denied.\" })",
        );
        assert_eq!(broken.code, AudioErrorCode::InternalError);
        assert!(!broken.recoverable);

        let restored = map_embed_lyrics_error(
            "failed to install rewritten audio: interrupted; rollback=Ok(())",
        );
        assert_eq!(restored.code, AudioErrorCode::UnreadableFile);
        assert!(restored.recoverable);
    }

    #[test]
    fn embed_error_mapping_keeps_path_validation_codes() {
        for message in [
            "audio path has no parent directory",
            "audio path has no extension",
        ] {
            let error = map_embed_lyrics_error(message);
            assert_eq!(error.code, AudioErrorCode::InvalidPath, "{message}");
            assert!(error.recoverable, "{message}");
        }
    }

    #[test]
    fn embed_error_mapping_falls_back_to_recoverable_format_error_for_unknown_messages() {
        let error = map_embed_lyrics_error("unexpected writer failure");
        assert_eq!(error.code, AudioErrorCode::UnsupportedFormat);
        assert!(error.recoverable);
        assert!(error.message.contains("unexpected writer failure"));
    }
}
