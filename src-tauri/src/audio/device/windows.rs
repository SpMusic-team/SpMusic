use std::{
    sync::{
        mpsc::{self, Sender},
        Mutex,
    },
    thread,
};

use ::windows::{
    core::{implement, PCWSTR},
    Win32::{
        Media::Audio::{
            eRender, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient,
            IMMNotificationClient_Impl, MMDeviceEnumerator, DEVICE_STATE, DEVICE_STATE_ACTIVE,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
            COINIT_MULTITHREADED,
        },
        UI::Shell::PropertiesSystem::PROPERTYKEY,
    },
};

use super::{AudioDeviceEvent, AudioDeviceWatcherHandle};

#[implement(IMMNotificationClient)]
struct WindowsAudioDeviceNotificationClient {
    tx: Sender<AudioDeviceEvent>,
    default_output_device_id: Mutex<Option<String>>,
}

impl WindowsAudioDeviceNotificationClient {
    fn notify(&self, event: AudioDeviceEvent, event_type: &'static str) {
        tracing::info!(
            operation = "audio.device.changed",
            backend = "windows",
            event_type,
            "received Windows audio device event",
        );
        if self.tx.send(event).is_err() {
            tracing::warn!(
                operation = "audio.device.changed",
                backend = "windows",
                event_type,
                "audio device event receiver closed",
            );
        }
    }

    fn update_default_output_device(&self, device_id: Option<String>) -> bool {
        let mut current = self
            .default_output_device_id
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *current == device_id {
            return false;
        }

        *current = device_id;
        true
    }

    fn mark_default_output_unavailable(&self, device_id: &str) -> bool {
        let mut current = self
            .default_output_device_id
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if current.as_deref() != Some(device_id) {
            return false;
        }

        *current = None;
        true
    }
}

#[allow(non_snake_case)]
impl IMMNotificationClient_Impl for WindowsAudioDeviceNotificationClient {
    fn OnDeviceStateChanged(
        &self,
        pwstrdeviceid: &PCWSTR,
        dwnewstate: DEVICE_STATE,
    ) -> windows::core::Result<()> {
        if dwnewstate == DEVICE_STATE_ACTIVE {
            tracing::trace!(
                operation = "audio.device.changed",
                backend = "windows",
                event_type = "state_changed",
                "ignored active audio endpoint state",
            );
            return Ok(());
        }

        if let Some(device_id) = borrowed_device_id(pwstrdeviceid) {
            if self.mark_default_output_unavailable(&device_id) {
                self.notify(
                    AudioDeviceEvent::DefaultOutputUnavailable,
                    "default_output_unavailable",
                );
            } else {
                tracing::trace!(
                    operation = "audio.device.changed",
                    backend = "windows",
                    event_type = "state_changed",
                    "ignored state change for a non-default audio endpoint",
                );
            }
        }
        Ok(())
    }

    fn OnDeviceAdded(&self, _pwstrdeviceid: &PCWSTR) -> windows::core::Result<()> {
        // A newly enumerated endpoint does not affect the stream unless Windows also
        // promotes it to the default eRender/eConsole endpoint. That promotion has
        // its own OnDefaultDeviceChanged callback.
        tracing::trace!(
            operation = "audio.device.changed",
            backend = "windows",
            event_type = "added",
            "ignored audio endpoint addition",
        );
        Ok(())
    }

    fn OnDeviceRemoved(&self, pwstrdeviceid: &PCWSTR) -> windows::core::Result<()> {
        if let Some(device_id) = borrowed_device_id(pwstrdeviceid) {
            if self.mark_default_output_unavailable(&device_id) {
                self.notify(
                    AudioDeviceEvent::DefaultOutputUnavailable,
                    "default_output_removed",
                );
            } else {
                tracing::trace!(
                    operation = "audio.device.changed",
                    backend = "windows",
                    event_type = "removed",
                    "ignored removal of a non-default audio endpoint",
                );
            }
        }
        Ok(())
    }

    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        role: ERole,
        pwstrdefaultdeviceid: &PCWSTR,
    ) -> windows::core::Result<()> {
        // CPAL's WASAPI backend opens the eRender/eConsole endpoint. Windows emits
        // one callback per ERole, so accepting every render role would process one
        // physical switch multiple times and communications-only changes would
        // unnecessarily interrupt music playback.
        if flow == eRender && role == ::windows::Win32::Media::Audio::eConsole {
            let device_id = borrowed_device_id(pwstrdefaultdeviceid);
            if self.update_default_output_device(device_id) {
                self.notify(
                    AudioDeviceEvent::DefaultOutputChanged,
                    "default_output_changed",
                );
            } else {
                tracing::trace!(
                    operation = "audio.device.changed",
                    backend = "windows",
                    event_type = "default_output_changed",
                    "ignored duplicate default output callback",
                );
            }
        } else {
            tracing::trace!(
                operation = "audio.device.changed",
                backend = "windows",
                event_type = "default_device_changed",
                "ignored default device callback outside eRender/eConsole",
            );
        }
        Ok(())
    }

    fn OnPropertyValueChanged(
        &self,
        _pwstrdeviceid: &PCWSTR,
        _key: &PROPERTYKEY,
    ) -> windows::core::Result<()> {
        // Endpoint properties and system/device volume can change while the
        // underlying output stream remains valid. Treating these notifications as
        // device interruptions causes visible, incorrect playback pauses.
        tracing::trace!(
            operation = "audio.device.changed",
            backend = "windows",
            event_type = "property_changed",
            "ignored audio endpoint property change",
        );
        Ok(())
    }
}

fn borrowed_device_id(device_id: &PCWSTR) -> Option<String> {
    if device_id.is_null() {
        return None;
    }

    // SAFETY: IMMNotificationClient guarantees that the callback's device ID is
    // a valid null-terminated string for the duration of the callback.
    unsafe { device_id.to_string().ok() }
}

unsafe fn current_default_output_device_id(enumerator: &IMMDeviceEnumerator) -> Option<String> {
    let device = enumerator
        .GetDefaultAudioEndpoint(eRender, ::windows::Win32::Media::Audio::eConsole)
        .ok()?;
    let device_id = device.GetId().ok()?;
    let result = device_id.to_string().ok();
    CoTaskMemFree(Some(device_id.as_ptr().cast()));
    result
}

pub(super) fn start_audio_device_watcher(
    tx: Sender<AudioDeviceEvent>,
) -> Result<AudioDeviceWatcherHandle, String> {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let join_handle = thread::spawn(move || {
        tracing::info!(
            operation = "audio.device.watcher.run",
            backend = "windows",
            "Windows audio device watcher thread starting",
        );
        let init_result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() }
            .map_err(|error| format!("CoInitializeEx failed: {error}"));

        if let Err(error) = init_result {
            tracing::warn!(
                operation = "audio.device.watcher.run",
                backend = "windows",
                error = %error,
                "Windows audio device watcher COM init failed",
            );
            let _ = ready_tx.send(Err(error));
            return;
        }

        let run_result = (|| unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|error| {
                    format!("CoCreateInstance(MMDeviceEnumerator) failed: {error}")
                })?;
            let default_output_device_id = current_default_output_device_id(&enumerator);
            let callback: IMMNotificationClient = WindowsAudioDeviceNotificationClient {
                tx,
                default_output_device_id: Mutex::new(default_output_device_id),
            }
            .into();

            enumerator
                .RegisterEndpointNotificationCallback(&callback)
                .map_err(|error| format!("RegisterEndpointNotificationCallback failed: {error}"))?;
            tracing::info!(
                operation = "audio.device.watcher.run",
                backend = "windows",
                "Windows audio device watcher registered",
            );
            let _ = ready_tx.send(Ok(()));

            let _ = stop_rx.recv();

            if let Err(error) = enumerator.UnregisterEndpointNotificationCallback(&callback) {
                tracing::warn!(
                    operation = "audio.device.watcher.run",
                    backend = "windows",
                    error = %error,
                    "failed to unregister Windows audio device watcher",
                );
            }

            Ok::<(), String>(())
        })();

        if let Err(error) = run_result {
            tracing::warn!(
                operation = "audio.device.watcher.run",
                backend = "windows",
                error = %error,
                "Windows audio device watcher failed",
            );
            let _ = ready_tx.send(Err(error));
        }

        unsafe {
            CoUninitialize();
        }
        tracing::info!(
            operation = "audio.device.watcher.run",
            backend = "windows",
            "Windows audio device watcher thread stopped",
        );
    });

    match ready_rx.recv() {
        Ok(Ok(())) => Ok(AudioDeviceWatcherHandle::new(stop_tx, join_handle)),
        Ok(Err(error)) => {
            let _ = stop_tx.send(());
            let _ = join_handle.join();
            Err(error)
        }
        Err(error) => {
            let _ = stop_tx.send(());
            let _ = join_handle.join();
            Err(format!(
                "Windows audio device watcher failed to initialize: {error}"
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notification_client(
        initial_device_id: Option<&str>,
    ) -> WindowsAudioDeviceNotificationClient {
        let (tx, _rx) = mpsc::channel();
        WindowsAudioDeviceNotificationClient {
            tx,
            default_output_device_id: Mutex::new(initial_device_id.map(str::to_owned)),
        }
    }

    #[test]
    fn default_output_tracker_suppresses_duplicate_role_notifications() {
        let client = notification_client(Some("device-a"));

        assert!(!client.update_default_output_device(Some("device-a".to_string())));
        assert!(client.update_default_output_device(Some("device-b".to_string())));
        assert!(!client.update_default_output_device(Some("device-b".to_string())));
    }

    #[test]
    fn endpoint_unavailability_only_matches_the_current_default_output() {
        let client = notification_client(Some("default-output"));

        assert!(!client.mark_default_output_unavailable("microphone"));
        assert!(!client.mark_default_output_unavailable("other-output"));
        assert!(client.mark_default_output_unavailable("default-output"));
        assert!(!client.mark_default_output_unavailable("default-output"));
    }
}
