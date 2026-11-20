use tauri::WebviewWindow;

#[cfg(target_os = "windows")]
use tauri::WindowEvent;

#[cfg(target_os = "windows")]
mod platform {
    use std::sync::atomic::{AtomicBool, Ordering};

    use tauri::WebviewWindow;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core_061::Interface;

    const E_NOINTERFACE_CODE: i32 = 0x8000_4002_u32 as i32;

    static MEMORY_TARGET_UNSUPPORTED: AtomicBool = AtomicBool::new(false);
    static MEMORY_TARGET_WARNING_RECORDED: AtomicBool = AtomicBool::new(false);

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum MemoryTarget {
        Normal,
        Low,
    }

    impl MemoryTarget {
        fn for_focus(focused: bool) -> Self {
            if focused {
                Self::Normal
            } else {
                Self::Low
            }
        }

        fn native(self) -> COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL {
            match self {
                Self::Normal => COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
                Self::Low => COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            }
        }

        fn as_str(self) -> &'static str {
            match self {
                Self::Normal => "normal",
                Self::Low => "low",
            }
        }
    }

    pub(super) fn request_focus_target(window: &WebviewWindow, label: &str, focused: bool) {
        if MEMORY_TARGET_UNSUPPORTED.load(Ordering::Acquire) {
            return;
        }
        let target = MemoryTarget::for_focus(focused);
        let target_name = target.as_str();
        let label_for_callback = label.to_owned();
        if let Err(error) = window.with_webview(move |platform_webview| {
            match set_memory_target(&platform_webview, target) {
                Ok(()) => tracing::debug!(
                    operation = "webview.memory_target.set",
                    window = %label_for_callback,
                    target = target_name,
                    "updated WebView2 memory usage target",
                ),
                Err(error) if error.code().0 == E_NOINTERFACE_CODE => {
                    MEMORY_TARGET_UNSUPPORTED.store(true, Ordering::Release);
                    if !MEMORY_TARGET_WARNING_RECORDED.swap(true, Ordering::AcqRel) {
                        tracing::warn!(
                            operation = "webview.memory_target.unsupported",
                            window = %label_for_callback,
                            error_code = error.code().0,
                            "WebView2 runtime does not expose ICoreWebView2_19; focus memory policy is disabled",
                        );
                    }
                }
                Err(error) => tracing::warn!(
                    operation = "webview.memory_target.set",
                    window = %label_for_callback,
                    target = target_name,
                    error_code = error.code().0,
                    error = %error,
                    "failed to update WebView2 memory usage target",
                ),
            }
        }) {
            tracing::warn!(
                operation = "webview.memory_target.enqueue",
                window = label,
                target = target_name,
                error = %error,
                "failed to enqueue WebView2 memory usage target update",
            );
        }
    }

    fn set_memory_target(
        platform_webview: &tauri::webview::PlatformWebview,
        target: MemoryTarget,
    ) -> windows_core_061::Result<()> {
        // This closure runs on the WebView event-loop/COM-apartment thread.
        let core_webview = unsafe { platform_webview.controller().CoreWebView2()? };
        let core_webview_19: ICoreWebView2_19 = core_webview.cast()?;
        unsafe { core_webview_19.SetMemoryUsageTargetLevel(target.native()) }
    }

    #[cfg(test)]
    mod tests {
        use super::MemoryTarget;

        #[test]
        fn focused_windows_use_normal_and_unfocused_windows_use_low() {
            assert_eq!(MemoryTarget::for_focus(true), MemoryTarget::Normal);
            assert_eq!(MemoryTarget::for_focus(false), MemoryTarget::Low);
        }
    }
}

#[derive(Clone, Copy, Default)]
pub struct WebviewMemoryCoordinator;

impl WebviewMemoryCoordinator {
    pub fn install(window: &WebviewWindow) -> Self {
        #[cfg(target_os = "windows")]
        {
            let focused = window.is_focused().unwrap_or(true);
            let webview = window.clone();
            let label = window.label().to_owned();
            window.on_window_event(move |event| {
                if let WindowEvent::Focused(focused) = event {
                    platform::request_focus_target(&webview, &label, *focused);
                }
            });
            platform::request_focus_target(window, window.label(), focused);
            tracing::info!(
                operation = "webview.memory_policy.install",
                window = window.label(),
                "installed WebView2 focus memory-target policy",
            );
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = window;
        }

        Self
    }

    pub fn unsupported() -> Self {
        Self
    }
}
