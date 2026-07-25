use std::{
    sync::mpsc::{self, RecvTimeoutError, Sender},
    thread,
    time::Duration,
};

use super::{current_output_device_signature, AudioDeviceEvent, AudioDeviceWatcherHandle};

const AUDIO_DEVICE_POLL_INTERVAL: Duration = Duration::from_millis(500);

pub(super) fn start_audio_device_watcher(tx: Sender<AudioDeviceEvent>) -> AudioDeviceWatcherHandle {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let join_handle = thread::spawn(move || {
        let mut last_signature = current_output_device_signature();
        tracing::info!(
            operation = "audio.device.watcher.run",
            backend = "polling",
            interval_ms = AUDIO_DEVICE_POLL_INTERVAL.as_millis() as u64,
            initial_signature = last_signature.as_deref(),
            "polling audio device watcher started",
        );

        loop {
            match stop_rx.recv_timeout(AUDIO_DEVICE_POLL_INTERVAL) {
                Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
                Err(RecvTimeoutError::Timeout) => {
                    let current_signature = current_output_device_signature();
                    if current_signature != last_signature {
                        tracing::info!(
                            operation = "audio.device.changed",
                            backend = "polling",
                            previous_signature = last_signature.as_deref(),
                            current_signature = current_signature.as_deref(),
                            "detected output device signature change",
                        );
                        let event = if current_signature.is_some() {
                            AudioDeviceEvent::DefaultOutputChanged
                        } else {
                            AudioDeviceEvent::DefaultOutputUnavailable
                        };
                        last_signature = current_signature;
                        if tx.send(event).is_err() {
                            tracing::warn!(
                                operation = "audio.device.changed",
                                backend = "polling",
                                "audio device event receiver closed",
                            );
                            break;
                        }
                    }
                }
            }
        }
        tracing::info!(
            operation = "audio.device.watcher.run",
            backend = "polling",
            "polling audio device watcher stopped",
        );
    });

    AudioDeviceWatcherHandle::new(stop_tx, join_handle)
}
