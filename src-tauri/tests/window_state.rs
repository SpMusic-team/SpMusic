//! Real Windows window-state persistence with isolated configuration and no app services.
#![cfg(target_os = "windows")]

#[path = "../src/window_state.rs"]
mod window_state;

use std::{
    fs,
    path::PathBuf,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{App, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use window_state::{WindowMode, WindowStateTracker};

struct ConfigDir(PathBuf);
impl ConfigDir {
    fn new() -> Self {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "spmusic-window-test-{}-{suffix}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn saved(&self) -> serde_json::Value {
        serde_json::from_slice(&fs::read(self.0.join("window-state.json")).unwrap()).unwrap()
    }
}
impl Drop for ConfigDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[allow(deprecated)]
fn until(app: &mut App, description: &str, condition: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        app.run_iteration(|_, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
        if condition() {
            return;
        }
        assert!(Instant::now() < deadline, "timed out: {description}");
        thread::sleep(Duration::from_millis(5));
    }
}

fn create(app: &App, label: &str) -> WebviewWindow {
    WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title("SpMusic window-state regression")
    .inner_size(880.0, 760.0)
    .position(40.0, 40.0)
    .decorations(false)
    .visible(false)
    .focused(false)
    .focusable(false)
    .skip_taskbar(true)
    .build()
    .unwrap()
}

fn apply(window: &WebviewWindow, mode: WindowMode) {
    // Match startup ordering: restore normal bounds, initialize tracker, then modes.
    if mode.maximized {
        window.maximize().unwrap();
    }
    if mode.fullscreen {
        window.set_fullscreen(true).unwrap();
    }
}

#[test]
fn native_save_recreate_restore_and_restore_down_keep_normal_bounds() {
    let config = ConfigDir::new();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let mut app = tauri::Builder::default()
        .any_thread()
        .build(context)
        .unwrap();
    let handle = app.handle().clone();
    let window = create(&app, "capture");
    let normal_size = window.inner_size().unwrap();
    let normal_position = window.outer_position().unwrap();
    let tracker = WindowStateTracker::from_window(&window);
    tracker.save(&window, &config.0);
    let normal = config.saved();
    assert_eq!(normal["maximized"], false);
    assert_eq!(normal["fullscreen"], false);

    window.maximize().unwrap();
    until(&mut app, "maximize", || window.is_maximized().unwrap());
    tracker.observe(&window);
    tracker.save(&window, &config.0);
    let expanded = config.saved();
    assert_eq!(expanded["maximized"], true);
    assert_eq!(expanded["fullscreen"], false);
    for key in ["x", "y", "width", "height"] {
        assert_eq!(
            expanded[key], normal[key],
            "maximized geometry replaced {key}"
        );
    }
    window.destroy().unwrap();
    until(&mut app, "destroy capture window", || {
        handle.get_webview_window("capture").is_none()
    });

    let restored = create(&app, "restored");
    assert!(!restored.is_visible().unwrap());
    let mode = window_state::restore(&restored, &config.0);
    assert_eq!(
        mode,
        WindowMode {
            fullscreen: false,
            maximized: true
        }
    );
    let restored_tracker = WindowStateTracker::from_window(&restored);
    apply(&restored, mode);
    until(&mut app, "restore maximized", || {
        restored.is_maximized().unwrap()
    });
    assert!(
        !restored.is_visible().unwrap(),
        "restoration revealed window before frontend readiness"
    );
    restored.show().unwrap();
    until(&mut app, "show restored maximized window", || {
        restored.is_visible().unwrap()
    });
    assert!(
        restored.is_maximized().unwrap(),
        "frontend show lost maximized mode"
    );
    restored_tracker.save(&restored, &config.0);
    assert_eq!(
        config.saved(),
        expanded,
        "reclosing without restore down loses normal bounds"
    );
    restored.unmaximize().unwrap();
    until(&mut app, "restore down", || {
        !restored.is_maximized().unwrap() && restored.inner_size().unwrap() == normal_size
    });
    assert_eq!(restored.outer_position().unwrap(), normal_position);
    restored_tracker.save(&restored, &config.0);
    assert_eq!(config.saved()["maximized"], false);
    assert_eq!(
        window_state::restore(&restored, &config.0),
        WindowMode::default()
    );

    restored.set_fullscreen(true).unwrap();
    until(&mut app, "enter fullscreen", || {
        restored.is_fullscreen().unwrap()
    });
    restored_tracker.save(&restored, &config.0);
    let fullscreen = config.saved();
    assert_eq!(fullscreen["fullscreen"], true);
    for key in ["x", "y", "width", "height"] {
        assert_eq!(fullscreen[key], normal[key]);
    }
    restored.destroy().unwrap();
    until(&mut app, "destroy fullscreen window", || {
        handle.get_webview_window("restored").is_none()
    });
    let fullscreen_restored = create(&app, "fullscreen-restored");
    let mode = window_state::restore(&fullscreen_restored, &config.0);
    assert!(mode.fullscreen);
    let _tracker = WindowStateTracker::from_window(&fullscreen_restored);
    apply(&fullscreen_restored, mode);
    until(&mut app, "restore fullscreen", || {
        fullscreen_restored.is_fullscreen().unwrap()
    });
    assert!(
        !fullscreen_restored.is_visible().unwrap(),
        "fullscreen restoration revealed window early"
    );
    fullscreen_restored.show().unwrap();
    until(&mut app, "show restored fullscreen window", || {
        fullscreen_restored.is_visible().unwrap()
    });
    assert!(fullscreen_restored.is_fullscreen().unwrap());
    fullscreen_restored.set_fullscreen(false).unwrap();
    until(&mut app, "exit fullscreen", || {
        !fullscreen_restored.is_fullscreen().unwrap()
            && fullscreen_restored.inner_size().unwrap() == normal_size
    });
    fullscreen_restored.destroy().unwrap();
}
