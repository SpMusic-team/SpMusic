use std::{
    sync::mpsc::{self, Sender},
    thread,
};

use ::windows::{
    core::{implement, PCWSTR},
    Win32::{
        Media::Audio::{
            eRender, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient,
            IMMNotificationClient_Impl, MMDeviceEnumerator, DEVICE_STATE,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
        },
        UI::Shell::PropertiesSystem::PROPERTYKEY,
    },
};

use super::{AudioDeviceEvent, AudioDeviceWatcherHandle};

#[implement(IMMNotificationClient)]
struct WindowsAudioDeviceNotificationClient {
    tx: Sender<AudioDeviceEvent>,
}

impl WindowsAudioDeviceNotificationClient {
    fn notify(&self) {
        let _ = self.tx.send(AudioDeviceEvent::OutputDeviceChanged);
    }
}

#[allow(non_snake_case)]
impl IMMNotificationClient_Impl for WindowsAudioDeviceNotificationClient {
    fn OnDeviceStateChanged(
        &self,
        _pwstrdeviceid: &PCWSTR,
        _dwnewstate: DEVICE_STATE,
    ) -> windows::core::Result<()> {
        self.notify();
        Ok(())
    }

    fn OnDeviceAdded(&self, _pwstrdeviceid: &PCWSTR) -> windows::core::Result<()> {
        self.notify();
        Ok(())
    }

    fn OnDeviceRemoved(&self, _pwstrdeviceid: &PCWSTR) -> windows::core::Result<()> {
        self.notify();
        Ok(())
    }

    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        _role: ERole,
        _pwstrdefaultdeviceid: &PCWSTR,
    ) -> windows::core::Result<()> {
        if flow == eRender {
            self.notify();
        }
        Ok(())
    }

    fn OnPropertyValueChanged(
        &self,
        _pwstrdeviceid: &PCWSTR,
        _key: &PROPERTYKEY,
    ) -> windows::core::Result<()> {
        self.notify();
        Ok(())
    }
}

pub(super) fn start_audio_device_watcher(
    tx: Sender<AudioDeviceEvent>,
) -> Result<AudioDeviceWatcherHandle, String> {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let join_handle = thread::spawn(move || {
        let init_result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() }
            .map_err(|error| format!("CoInitializeEx failed: {error}"));

        if let Err(error) = init_result {
            let _ = ready_tx.send(Err(error));
            return;
        }

        let run_result = (|| unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|error| {
                    format!("CoCreateInstance(MMDeviceEnumerator) failed: {error}")
                })?;
            let callback: IMMNotificationClient =
                WindowsAudioDeviceNotificationClient { tx }.into();

            enumerator
                .RegisterEndpointNotificationCallback(&callback)
                .map_err(|error| format!("RegisterEndpointNotificationCallback failed: {error}"))?;
            let _ = ready_tx.send(Ok(()));

            let _ = stop_rx.recv();

            if let Err(error) = enumerator.UnregisterEndpointNotificationCallback(&callback) {
                tracing::warn!(error = %error, "failed to unregister Windows audio device watcher");
            }

            Ok::<(), String>(())
        })();

        if let Err(error) = run_result {
            let _ = ready_tx.send(Err(error));
        }

        unsafe {
            CoUninitialize();
        }
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
