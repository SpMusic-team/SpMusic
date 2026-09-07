use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{WebviewWindow, WindowEvent};

const ACTIVITY_UNITS_PER_MAINTENANCE: u16 = 8;
const MAX_ACTIVITY_UNITS_PER_NOTIFICATION: u16 = 8;
const DEBOUNCE: Duration = Duration::from_millis(1_500);
const MAX_DEFER: Duration = Duration::from_secs(15);
const COOLDOWN: Duration = Duration::from_secs(30);
const FOCUS_GRACE: Duration = Duration::from_secs(5);
const TRANSIENT_BACKOFF: Duration = Duration::from_secs(5 * 60);
const FAILURE_LIMIT: u8 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum WebviewMemoryMaintenanceStatus {
    Recorded,
    Ignored {
        reason: WebviewMemoryMaintenanceIgnoredReason,
    },
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WebviewMemoryMaintenanceIgnoredReason {
    Unfocused,
}

#[derive(Debug)]
struct ScheduleState {
    focused: bool,
    focus_grace_until: Instant,
    pending_activity_units: u16,
    batch_started_at: Option<Instant>,
    last_activity_at: Option<Instant>,
    last_attempt_at: Option<Instant>,
    backoff_until: Option<Instant>,
    in_flight: bool,
    flight_epoch: Option<u64>,
    lifecycle_epoch: u64,
    consecutive_failures: u8,
    session_disabled: bool,
    circuit_open: bool,
}

impl ScheduleState {
    fn new(now: Instant, focused: bool) -> Self {
        Self {
            focused,
            focus_grace_until: if focused { now + FOCUS_GRACE } else { now },
            pending_activity_units: 0,
            batch_started_at: None,
            last_activity_at: None,
            last_attempt_at: None,
            backoff_until: None,
            in_flight: false,
            flight_epoch: None,
            lifecycle_epoch: 0,
            consecutive_failures: 0,
            session_disabled: false,
            circuit_open: false,
        }
    }

    fn note_activity(
        &mut self,
        now: Instant,
        activity_units: u16,
    ) -> WebviewMemoryMaintenanceStatus {
        if self.session_disabled || self.circuit_open {
            return WebviewMemoryMaintenanceStatus::Unsupported;
        }
        if !self.focused {
            return WebviewMemoryMaintenanceStatus::Ignored {
                reason: WebviewMemoryMaintenanceIgnoredReason::Unfocused,
            };
        }

        let activity_units = activity_units.clamp(1, MAX_ACTIVITY_UNITS_PER_NOTIFICATION);
        self.pending_activity_units = self
            .pending_activity_units
            .saturating_add(activity_units)
            .min(ACTIVITY_UNITS_PER_MAINTENANCE);
        self.last_activity_at = Some(now);
        if self.pending_activity_units == ACTIVITY_UNITS_PER_MAINTENANCE
            && self.batch_started_at.is_none()
        {
            self.batch_started_at = Some(now);
        }
        WebviewMemoryMaintenanceStatus::Recorded
    }

    fn set_focused(&mut self, now: Instant, focused: bool) {
        if self.focused == focused {
            return;
        }
        self.focused = focused;
        self.lifecycle_epoch = self.lifecycle_epoch.wrapping_add(1);
        self.pending_activity_units = 0;
        self.batch_started_at = None;
        self.last_activity_at = None;
        if focused {
            self.focus_grace_until = now + FOCUS_GRACE;
        }
    }

    fn next_deadline(&self) -> Option<Instant> {
        if !self.focused
            || self.pending_activity_units < ACTIVITY_UNITS_PER_MAINTENANCE
            || self.in_flight
            || self.session_disabled
            || self.circuit_open
        {
            return None;
        }

        let mut deadline = (self.last_activity_at? + DEBOUNCE)
            .min(self.batch_started_at? + MAX_DEFER)
            .max(self.focus_grace_until);
        if let Some(last_attempt_at) = self.last_attempt_at {
            deadline = deadline.max(last_attempt_at + COOLDOWN);
        }
        if let Some(backoff_until) = self.backoff_until {
            deadline = deadline.max(backoff_until);
        }
        Some(deadline)
    }

    fn claim_if_due(&mut self, now: Instant) -> Option<u64> {
        if self.next_deadline().is_none_or(|deadline| deadline > now) {
            return None;
        }
        let epoch = self.lifecycle_epoch;
        self.pending_activity_units = 0;
        self.batch_started_at = None;
        self.last_activity_at = None;
        self.last_attempt_at = Some(now);
        self.in_flight = true;
        self.flight_epoch = Some(epoch);
        Some(epoch)
    }

    fn finish_attempt(&mut self, now: Instant, epoch: u64, outcome: AttemptOutcome) -> bool {
        if !self.in_flight || self.flight_epoch != Some(epoch) {
            return false;
        }
        self.in_flight = false;
        self.flight_epoch = None;
        if epoch != self.lifecycle_epoch {
            return false;
        }

        match outcome {
            AttemptOutcome::Succeeded => {
                self.consecutive_failures = 0;
                self.backoff_until = None;
            }
            AttemptOutcome::Unsupported => {
                self.session_disabled = true;
                self.clear_pending();
            }
            AttemptOutcome::TransientFailure => {
                self.consecutive_failures = self.consecutive_failures.saturating_add(1);
                if self.consecutive_failures >= FAILURE_LIMIT {
                    self.circuit_open = true;
                    self.clear_pending();
                } else {
                    self.backoff_until = Some(now + TRANSIENT_BACKOFF);
                }
            }
        }
        true
    }

    fn clear_pending(&mut self) {
        self.pending_activity_units = 0;
        self.batch_started_at = None;
        self.last_activity_at = None;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AttemptOutcome {
    Succeeded,
    Unsupported,
    TransientFailure,
}

#[cfg(target_os = "windows")]
mod platform {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Condvar, Mutex, MutexGuard};
    use std::thread;

    use tauri::WebviewWindow;
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core_061::{Interface, HSTRING};

    use super::{AttemptOutcome, ScheduleState};

    const E_NOINTERFACE_CODE: i32 = 0x8000_4002_u32 as i32;
    const E_NOTIMPL_CODE: i32 = 0x8000_4001_u32 as i32;
    const ERROR_NOT_SUPPORTED_CODE: i32 = 0x8007_0032_u32 as i32;
    const PRESSURE_METHOD: &str = "Memory.simulatePressureNotification";
    const PRESSURE_PARAMETERS: &str = r#"{"level":"critical"}"#;

    static MEMORY_TARGET_UNSUPPORTED: AtomicBool = AtomicBool::new(false);
    static MEMORY_TARGET_WARNING_RECORDED: AtomicBool = AtomicBool::new(false);

    #[derive(Debug, Clone, Copy)]
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

    pub(super) struct Inner {
        window: WebviewWindow,
        label: String,
        state: Mutex<ScheduleState>,
        wake_worker: Condvar,
        unsupported_warning_recorded: AtomicBool,
        circuit_warning_recorded: AtomicBool,
    }

    impl Inner {
        pub(super) fn new(window: &WebviewWindow, focused: bool) -> Arc<Self> {
            Arc::new(Self {
                window: window.clone(),
                label: window.label().to_owned(),
                state: Mutex::new(ScheduleState::new(std::time::Instant::now(), focused)),
                wake_worker: Condvar::new(),
                unsupported_warning_recorded: AtomicBool::new(false),
                circuit_warning_recorded: AtomicBool::new(false),
            })
        }

        pub(super) fn lock_state(&self) -> MutexGuard<'_, ScheduleState> {
            self.state.lock().unwrap_or_else(|poisoned| {
                tracing::warn!(
                    operation = "webview.memory_maintenance.state_recover",
                    window = %self.label,
                    "recovering poisoned WebView memory-maintenance state",
                );
                poisoned.into_inner()
            })
        }

        pub(super) fn wake(&self) {
            self.wake_worker.notify_one();
        }

        pub(super) fn set_focused(&self, focused: bool) {
            self.lock_state()
                .set_focused(std::time::Instant::now(), focused);
            self.wake();
        }

        pub(super) fn start_worker(inner: &Arc<Self>) {
            let worker_inner = Arc::clone(inner);
            if let Err(error) = thread::Builder::new()
                .name("spmusic-webview-memory".to_owned())
                .spawn(move || worker_inner.worker_loop())
            {
                inner.lock_state().session_disabled = true;
                tracing::warn!(
                    operation = "webview.memory_maintenance.worker_start",
                    window = %inner.label,
                    error = %error,
                    "failed to start WebView memory-maintenance worker; session is disabled",
                );
            }
        }

        fn worker_loop(self: Arc<Self>) {
            loop {
                let mut state = self.lock_state();
                let epoch = loop {
                    let now = std::time::Instant::now();
                    if let Some(epoch) = state.claim_if_due(now) {
                        break epoch;
                    }
                    state = match state.next_deadline() {
                        Some(deadline) => {
                            self.wake_worker
                                .wait_timeout(state, deadline.saturating_duration_since(now))
                                .unwrap_or_else(|poisoned| poisoned.into_inner())
                                .0
                        }
                        None => self
                            .wake_worker
                            .wait(state)
                            .unwrap_or_else(|poisoned| poisoned.into_inner()),
                    };
                };
                drop(state);
                self.launch_pressure_notification(epoch);
            }
        }

        fn launch_pressure_notification(self: &Arc<Self>, epoch: u64) {
            let inner_for_webview = Arc::clone(self);
            if let Err(error) = self.window.with_webview(move |platform_webview| {
                let core_webview = match unsafe { platform_webview.controller().CoreWebView2() } {
                    Ok(core_webview) => core_webview,
                    Err(error) => {
                        let code = error.code().0;
                        inner_for_webview.complete_attempt(
                            epoch,
                            classify_hresult(code),
                            format!("CoreWebView2 failed with HRESULT {code:#010x}: {error}"),
                        );
                        return;
                    }
                };

                let inner_for_callback = Arc::clone(&inner_for_webview);
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |call_result, response| {
                        let (outcome, detail) = match call_result {
                            Ok(()) => classify_protocol_response(&response),
                            Err(error) => {
                                let code = error.code().0;
                                (
                                    classify_hresult(code),
                                    format!("DevTools callback HRESULT {code:#010x}: {error}"),
                                )
                            }
                        };
                        inner_for_callback.complete_attempt(epoch, outcome, detail);
                        Ok(())
                    },
                ));

                let method = HSTRING::from(PRESSURE_METHOD);
                let parameters = HSTRING::from(PRESSURE_PARAMETERS);
                if let Err(error) = unsafe {
                    core_webview.CallDevToolsProtocolMethod(&method, &parameters, &handler)
                } {
                    let code = error.code().0;
                    inner_for_webview.complete_attempt(
                        epoch,
                        classify_hresult(code),
                        format!("DevTools enqueue HRESULT {code:#010x}: {error}"),
                    );
                }
            }) {
                self.complete_attempt(
                    epoch,
                    AttemptOutcome::TransientFailure,
                    format!("Tauri with_webview enqueue failed: {error}"),
                );
            }
        }

        fn complete_attempt(&self, epoch: u64, outcome: AttemptOutcome, detail: String) {
            let mut state = self.lock_state();
            let accepted = state.finish_attempt(std::time::Instant::now(), epoch, outcome);
            let consecutive_failures = state.consecutive_failures;
            let circuit_open = state.circuit_open;
            drop(state);

            if !accepted {
                tracing::debug!(
                    operation = "webview.memory_maintenance.stale_completion",
                    window = %self.label,
                    "ignored stale WebView memory-maintenance completion",
                );
                self.wake();
                return;
            }

            match outcome {
                AttemptOutcome::Succeeded => tracing::info!(
                    operation = "webview.memory_maintenance.completed",
                    window = %self.label,
                    "requested critical memory-pressure maintenance after WebView UI activity",
                ),
                AttemptOutcome::Unsupported => {
                    if !self
                        .unsupported_warning_recorded
                        .swap(true, Ordering::AcqRel)
                    {
                        tracing::warn!(
                            operation = "webview.memory_maintenance.unsupported",
                            window = %self.label,
                            detail,
                            "WebView2 runtime does not support memory-pressure notification; session is disabled",
                        );
                    }
                }
                AttemptOutcome::TransientFailure if circuit_open => {
                    if !self.circuit_warning_recorded.swap(true, Ordering::AcqRel) {
                        tracing::warn!(
                            operation = "webview.memory_maintenance.circuit_open",
                            window = %self.label,
                            consecutive_failures,
                            detail,
                            "disabled WebView memory maintenance after repeated transient failures",
                        );
                    }
                }
                AttemptOutcome::TransientFailure => tracing::warn!(
                    operation = "webview.memory_maintenance.transient_failure",
                    window = %self.label,
                    consecutive_failures,
                    detail,
                    backoff_seconds = super::TRANSIENT_BACKOFF.as_secs(),
                    "WebView memory maintenance failed; applying transient backoff",
                ),
            }
            self.wake();
        }
    }

    fn classify_hresult(code: i32) -> AttemptOutcome {
        if matches!(
            code,
            E_NOINTERFACE_CODE | E_NOTIMPL_CODE | ERROR_NOT_SUPPORTED_CODE
        ) {
            AttemptOutcome::Unsupported
        } else {
            AttemptOutcome::TransientFailure
        }
    }

    fn classify_protocol_response(response: &str) -> (AttemptOutcome, String) {
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(response) else {
            return (
                AttemptOutcome::TransientFailure,
                "DevTools returned malformed JSON".to_owned(),
            );
        };
        let error = parsed.get("error").or_else(|| {
            (parsed.get("code").is_some() && parsed.get("message").is_some()).then_some(&parsed)
        });
        let Some(error) = error else {
            return (AttemptOutcome::Succeeded, "ok".to_owned());
        };
        let code = error.get("code").and_then(serde_json::Value::as_i64);
        let message = error
            .get("message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown DevTools error");
        let unsupported = code == Some(-32601)
            || message.contains("wasn't found")
            || message.contains("not found")
            || message.contains("Not supported");
        (
            if unsupported {
                AttemptOutcome::Unsupported
            } else {
                AttemptOutcome::TransientFailure
            },
            format!("DevTools error {code:?}: {message}"),
        )
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
        fn focused_windows_always_use_normal_memory_target() {
            assert!(matches!(
                MemoryTarget::for_focus(true),
                MemoryTarget::Normal
            ));
            assert!(matches!(MemoryTarget::for_focus(false), MemoryTarget::Low));
        }
    }
}

#[derive(Clone)]
pub struct WebviewMemoryCoordinator {
    #[cfg(target_os = "windows")]
    inner: Option<std::sync::Arc<platform::Inner>>,
}

impl WebviewMemoryCoordinator {
    pub fn install(window: &WebviewWindow) -> Self {
        #[cfg(target_os = "windows")]
        {
            let focused = window.is_focused().unwrap_or(true);
            let inner = platform::Inner::new(window, focused);
            platform::Inner::start_worker(&inner);
            let coordinator = Self { inner: Some(inner) };
            let coordinator_for_event = coordinator.clone();
            let webview = window.clone();
            let label = window.label().to_owned();
            window.on_window_event(move |event| {
                if let WindowEvent::Focused(focused) = event {
                    if let Some(inner) = &coordinator_for_event.inner {
                        inner.set_focused(*focused);
                    }
                    platform::request_focus_target(&webview, &label, *focused);
                }
            });
            platform::request_focus_target(window, window.label(), focused);
            tracing::info!(
                operation = "webview.memory_policy.install",
                window = window.label(),
                activity_unit_threshold = ACTIVITY_UNITS_PER_MAINTENANCE,
                debounce_ms = DEBOUNCE.as_millis(),
                max_defer_seconds = MAX_DEFER.as_secs(),
                cooldown_seconds = COOLDOWN.as_secs(),
                "installed WebView2 focus and UI-activity memory-maintenance policy",
            );
            coordinator
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = window;
            Self {}
        }
    }

    pub fn unsupported() -> Self {
        Self {
            #[cfg(target_os = "windows")]
            inner: None,
        }
    }

    pub fn note_ui_burst_settled(&self, activity_units: u16) -> WebviewMemoryMaintenanceStatus {
        #[cfg(target_os = "windows")]
        {
            let Some(inner) = &self.inner else {
                return WebviewMemoryMaintenanceStatus::Unsupported;
            };
            let status = inner
                .lock_state()
                .note_activity(Instant::now(), activity_units);
            inner.wake();
            status
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = activity_units;
            WebviewMemoryMaintenanceStatus::Unsupported
        }
    }

    pub fn note_artwork_transition_settled(&self) -> WebviewMemoryMaintenanceStatus {
        self.note_ui_burst_settled(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedules_only_after_configured_activity_threshold() {
        let start = Instant::now();
        let mut state = ScheduleState::new(start, true);
        for offset in 0..(ACTIVITY_UNITS_PER_MAINTENANCE - 1) {
            assert_eq!(
                state.note_activity(start + Duration::from_millis(u64::from(offset)), 1),
                WebviewMemoryMaintenanceStatus::Recorded
            );
        }
        assert_eq!(state.next_deadline(), None);
        let threshold_at = start + Duration::from_secs(6);
        state.note_activity(threshold_at, 1);
        assert_eq!(state.next_deadline(), Some(threshold_at + DEBOUNCE));
    }

    #[test]
    fn activity_units_are_clamped_to_one_through_eight() {
        let start = Instant::now();
        let mut state = ScheduleState::new(start - FOCUS_GRACE, true);

        state.note_activity(start, 0);
        assert_eq!(state.pending_activity_units, 1);
        assert_eq!(state.next_deadline(), None);

        let threshold_at = start + Duration::from_millis(10);
        state.note_activity(threshold_at, u16::MAX);
        assert_eq!(state.pending_activity_units, ACTIVITY_UNITS_PER_MAINTENANCE);
        assert_eq!(state.next_deadline(), Some(threshold_at + DEBOUNCE));
    }

    #[test]
    fn one_full_ui_burst_schedules_after_debounce() {
        let start = Instant::now();
        let mut state = ScheduleState::new(start - FOCUS_GRACE, true);
        assert_eq!(
            state.note_activity(start, MAX_ACTIVITY_UNITS_PER_NOTIFICATION),
            WebviewMemoryMaintenanceStatus::Recorded
        );
        assert_eq!(state.next_deadline(), Some(start + DEBOUNCE));
    }

    #[test]
    fn continuous_activity_cannot_defer_past_fifteen_seconds() {
        let start = Instant::now();
        let mut state = ScheduleState::new(start - FOCUS_GRACE, true);
        state.note_activity(start, ACTIVITY_UNITS_PER_MAINTENANCE);
        state.note_activity(start + Duration::from_secs(14), 1);
        assert_eq!(state.next_deadline(), Some(start + MAX_DEFER));
    }

    #[test]
    fn blur_resets_pending_work_and_focus_applies_grace() {
        let start = Instant::now();
        let mut state = ScheduleState::new(start - FOCUS_GRACE, true);
        state.note_activity(start, ACTIVITY_UNITS_PER_MAINTENANCE);
        state.set_focused(start + Duration::from_secs(1), false);
        assert_eq!(
            state.note_activity(start + Duration::from_secs(2), 8),
            WebviewMemoryMaintenanceStatus::Ignored {
                reason: WebviewMemoryMaintenanceIgnoredReason::Unfocused
            }
        );
        assert_eq!(state.pending_activity_units, 0);
        assert_eq!(state.next_deadline(), None);

        let refocused_at = start + Duration::from_secs(3);
        state.set_focused(refocused_at, true);
        state.note_activity(refocused_at, ACTIVITY_UNITS_PER_MAINTENANCE);
        assert_eq!(state.next_deadline(), Some(refocused_at + FOCUS_GRACE));
    }

    #[test]
    fn enforces_single_flight_and_cooldown() {
        let start = Instant::now();
        let mut state = ScheduleState::new(start - FOCUS_GRACE, true);
        state.note_activity(start, ACTIVITY_UNITS_PER_MAINTENANCE);
        let first_due = start + DEBOUNCE;
        let epoch = state.claim_if_due(first_due).expect("first batch is due");
        assert_eq!(state.claim_if_due(first_due + Duration::from_secs(1)), None);
        state.note_activity(first_due + Duration::from_secs(1), 8);
        assert_eq!(state.pending_activity_units, 8);
        assert_eq!(state.next_deadline(), None);
        assert!(state.finish_attempt(first_due, epoch, AttemptOutcome::Succeeded));
        assert_eq!(state.next_deadline(), Some(first_due + COOLDOWN));
    }

    #[test]
    fn transient_failures_back_off_then_open_circuit() {
        let start = Instant::now();
        let mut state = ScheduleState::new(start - FOCUS_GRACE, true);
        for attempt in 0..FAILURE_LIMIT {
            state.note_activity(start, ACTIVITY_UNITS_PER_MAINTENANCE);
            let due = state.next_deadline().expect("batch should schedule");
            let epoch = state.claim_if_due(due).expect("batch should be due");
            assert!(state.finish_attempt(due, epoch, AttemptOutcome::TransientFailure));
            if attempt + 1 < FAILURE_LIMIT {
                assert_eq!(state.backoff_until, Some(due + TRANSIENT_BACKOFF));
            }
        }
        assert!(state.circuit_open);
        assert_eq!(
            state.note_activity(start + Duration::from_secs(1), 8),
            WebviewMemoryMaintenanceStatus::Unsupported
        );
    }

    #[test]
    fn unsupported_response_disables_session() {
        let start = Instant::now();
        let mut state = ScheduleState::new(start - FOCUS_GRACE, true);
        state.note_activity(start, ACTIVITY_UNITS_PER_MAINTENANCE);
        let due = state.next_deadline().expect("batch should schedule");
        let epoch = state.claim_if_due(due).expect("batch should be due");
        assert!(state.finish_attempt(due, epoch, AttemptOutcome::Unsupported));
        assert_eq!(
            state.note_activity(due, 8),
            WebviewMemoryMaintenanceStatus::Unsupported
        );
    }

    #[test]
    fn command_status_has_narrow_serialized_contract() {
        assert_eq!(
            serde_json::to_value(WebviewMemoryMaintenanceStatus::Recorded).unwrap(),
            serde_json::json!({ "status": "recorded" })
        );
        assert_eq!(
            serde_json::to_value(WebviewMemoryMaintenanceStatus::Ignored {
                reason: WebviewMemoryMaintenanceIgnoredReason::Unfocused
            })
            .unwrap(),
            serde_json::json!({ "status": "ignored", "reason": "unfocused" })
        );
        assert_eq!(
            serde_json::to_value(WebviewMemoryMaintenanceStatus::Unsupported).unwrap(),
            serde_json::json!({ "status": "unsupported" })
        );
    }
}
