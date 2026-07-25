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

        loop {
            match stop_rx.recv_timeout(AUDIO_DEVICE_POLL_INTERVAL) {
                Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
                Err(RecvTimeoutError::Timeout) => {
                    let current_signature = current_output_device_signature();
                    if current_signature != last_signature {
                        last_signature = current_signature;
                        if tx.send(AudioDeviceEvent::OutputDeviceChanged).is_err() {
                            break;
                        }
                    }
                }
            }
        }
    });

    AudioDeviceWatcherHandle::new(stop_tx, join_handle)
}
