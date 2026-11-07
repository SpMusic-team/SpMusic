mod polling;

#[cfg(windows)]
mod windows;

use std::{sync::mpsc::Sender, thread::JoinHandle};

use rodio::cpal::{
    self,
    traits::{DeviceTrait, HostTrait},
    SampleFormat,
};

use super::types::AudioOutputInfo;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AudioDeviceEvent {
    DefaultOutputChanged,
    DefaultOutputUnavailable,
}

pub(crate) struct AudioDeviceWatcherHandle {
    stop_tx: Option<Sender<()>>,
    join_handle: Option<JoinHandle<()>>,
}

impl AudioDeviceWatcherHandle {
    pub(super) fn new(stop_tx: Sender<()>, join_handle: JoinHandle<()>) -> Self {
        Self {
            stop_tx: Some(stop_tx),
            join_handle: Some(join_handle),
        }
    }
}

impl Drop for AudioDeviceWatcherHandle {
    fn drop(&mut self) {
        if let Some(stop_tx) = self.stop_tx.take() {
            let _ = stop_tx.send(());
        }

        if let Some(join_handle) = self.join_handle.take() {
            let _ = join_handle.join();
        }
    }
}

pub(crate) fn start_audio_device_watcher(tx: Sender<AudioDeviceEvent>) -> AudioDeviceWatcherHandle {
    #[cfg(windows)]
    {
        match windows::start_audio_device_watcher(tx.clone()) {
            Ok(handle) => {
                tracing::info!(
                    operation = "audio.device.watcher.start",
                    backend = "windows",
                    "started Windows audio device watcher",
                );
                return handle;
            }
            Err(error) => {
                tracing::warn!(
                    operation = "audio.device.watcher.start",
                    backend = "windows",
                    error = %error,
                    "failed to start Windows audio device watcher, falling back to polling"
                );
            }
        }
    }

    tracing::info!(
        operation = "audio.device.watcher.start",
        backend = "polling",
        "starting polling audio device watcher",
    );
    polling::start_audio_device_watcher(tx)
}

pub(crate) fn current_output_device_signature() -> Option<String> {
    let host = cpal::default_host();
    let device = host.default_output_device()?;
    let name = device.name().unwrap_or_else(|_| "unknown".to_string());
    let config = device
        .default_output_config()
        .map(|config| format!("{config:?}"))
        .unwrap_or_else(|_| "unknown-config".to_string());

    Some(format!("default={name}|{config}"))
}

pub(crate) fn current_output_info() -> Option<AudioOutputInfo> {
    let host = cpal::default_host();
    let device = host.default_output_device()?;
    let config = device.default_output_config().ok()?;
    let bit_depth = match config.sample_format() {
        SampleFormat::I8 | SampleFormat::U8 => 8,
        SampleFormat::I16 | SampleFormat::U16 => 16,
        SampleFormat::I32 | SampleFormat::U32 | SampleFormat::F32 => 32,
        SampleFormat::I64 | SampleFormat::U64 | SampleFormat::F64 => 64,
        _ => 0,
    };

    Some(AudioOutputInfo {
        method: format!("{} OUTPUT", host.id().name().to_ascii_uppercase()),
        device_name: device.name().unwrap_or_else(|_| "unknown".to_string()),
        bit_depth,
        sample_rate_hz: config.sample_rate().0,
    })
}
