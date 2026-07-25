use std::{
    path::PathBuf,
    sync::{
        mpsc::{self, Sender},
        Mutex,
    },
    thread,
};

use tauri::{AppHandle, Emitter};

use super::{
    device::{start_audio_device_watcher, AudioDeviceEvent, AudioDeviceWatcherHandle},
    error::{audio_error, unavailable_state, AudioCommandError, AudioErrorCode},
    runtime::{AudioRuntime, AudioRuntimeRequest},
    source::{default_filters, input_path},
    types::{
        AudioLoadFileInput, AudioOpenFileInput, AudioPlayInput, AudioPlaybackState, AudioSeekInput,
        AudioTrackRef,
    },
    AUDIO_STATE_CHANGED_EVENT,
};

pub struct AudioController {
    tx: Mutex<Sender<AudioRuntimeRequest>>,
    _device_watcher: AudioDeviceWatcherHandle,
}

impl AudioController {
    pub fn new(app_handle: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<AudioRuntimeRequest>();
        let (device_tx, device_rx) = mpsc::channel::<AudioDeviceEvent>();
        let device_watcher = start_audio_device_watcher(device_tx);
        let runtime_tx = tx.clone();

        thread::spawn(move || {
            while let Ok(event) = device_rx.recv() {
                match event {
                    AudioDeviceEvent::OutputDeviceChanged => {
                        if runtime_tx
                            .send(AudioRuntimeRequest::OutputDeviceChanged)
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        });

        thread::spawn(move || {
            let mut runtime = AudioRuntime::default();

            while let Ok(request) = rx.recv() {
                match request {
                    AudioRuntimeRequest::LoadFile { path, reply } => {
                        let _ = reply.send(runtime.load_path(path));
                    }
                    AudioRuntimeRequest::Play { input, reply } => {
                        let _ = reply.send(runtime.play(input));
                    }
                    AudioRuntimeRequest::Pause { reply } => {
                        let _ = reply.send(runtime.pause());
                    }
                    AudioRuntimeRequest::Stop { reply } => {
                        let _ = reply.send(runtime.stop());
                    }
                    AudioRuntimeRequest::Seek { input, reply } => {
                        let _ = reply.send(runtime.seek(input));
                    }
                    AudioRuntimeRequest::GetState { reply } => {
                        let _ = reply.send(runtime.get_state());
                    }
                    AudioRuntimeRequest::OutputDeviceChanged => {
                        emit_state_changed(&app_handle, runtime.handle_output_device_change());
                    }
                }
            }
        });

        Self {
            tx: Mutex::new(tx),
            _device_watcher: device_watcher,
        }
    }

    pub fn open_file(
        &self,
        input: Option<AudioOpenFileInput>,
    ) -> Result<AudioTrackRef, AudioCommandError> {
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
            return Err(audio_error(
                AudioErrorCode::UserCancelled,
                "User cancelled audio file selection",
                true,
            ));
        };

        self.load_file_path(path)
    }

    pub fn load_file(&self, input: AudioLoadFileInput) -> Result<AudioTrackRef, AudioCommandError> {
        self.load_file_path(input_path(&input.path)?)
    }

    pub fn play(
        &self,
        input: Option<AudioPlayInput>,
    ) -> Result<AudioPlaybackState, AudioCommandError> {
        let (reply, rx) = mpsc::channel();
        self.send(AudioRuntimeRequest::Play { input, reply })?;
        self.recv_state(rx)
    }

    pub fn pause(&self) -> Result<AudioPlaybackState, AudioCommandError> {
        let (reply, rx) = mpsc::channel();
        self.send(AudioRuntimeRequest::Pause { reply })?;
        self.recv_state(rx)
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

    pub fn get_state(&self) -> AudioPlaybackState {
        let (reply, rx) = mpsc::channel();
        if self.send(AudioRuntimeRequest::GetState { reply }).is_err() {
            return unavailable_state("Audio runtime is unavailable");
        }
        rx.recv()
            .unwrap_or_else(|_| unavailable_state("Audio runtime did not return state"))
    }

    fn load_file_path(&self, path: PathBuf) -> Result<AudioTrackRef, AudioCommandError> {
        let (reply, rx) = mpsc::channel();
        self.send(AudioRuntimeRequest::LoadFile { path, reply })?;
        self.recv_track(rx)
    }

    fn send(&self, request: AudioRuntimeRequest) -> Result<(), AudioCommandError> {
        let tx = self.tx.lock().map_err(|_| {
            audio_error(
                AudioErrorCode::InternalError,
                "Audio controller mutex is poisoned",
                true,
            )
        })?;
        tx.send(request).map_err(|_| {
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
            audio_error(
                AudioErrorCode::InternalError,
                "Audio runtime did not return state",
                true,
            )
        })?
    }
}

fn emit_state_changed(app_handle: &AppHandle, state: AudioPlaybackState) {
    if let Err(error) = app_handle.emit(AUDIO_STATE_CHANGED_EVENT, state) {
        tracing::warn!(event = AUDIO_STATE_CHANGED_EVENT, error = %error, "failed to emit audio state");
    }
}
