mod polling;

#[cfg(windows)]
mod windows;

use std::{sync::mpsc::Sender, thread::JoinHandle};

use rodio::cpal::{
    self,
    traits::{DeviceTrait, HostTrait},
};

pub(crate) enum AudioDeviceEvent {
    OutputDeviceChanged,
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
            Ok(handle) => return handle,
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "failed to start Windows audio device watcher, falling back to polling"
                );
            }
        }
    }

    polling::start_audio_device_watcher(tx)
}

pub(crate) fn current_output_device_signature() -> Option<String> {
    let host = cpal::default_host();
    let default_output = host
        .default_output_device()
        .map(|device| {
            let name = device.name().unwrap_or_else(|_| "unknown".to_string());
            let config = device
                .default_output_config()
                .map(|config| format!("{config:?}"))
                .unwrap_or_else(|_| "unknown-config".to_string());

            format!("{name}|{config}")
        })
        .unwrap_or_else(|| "none".to_string());
    let mut output_devices = host
        .output_devices()
        .ok()
        .map(|devices| {
            devices
                .filter_map(|device| device.name().ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    output_devices.sort();

    Some(format!(
        "default={default_output};outputs={}",
        output_devices.join("|")
    ))
}
