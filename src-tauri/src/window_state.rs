use std::{fs, path::Path, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

const STATE_FILE: &str = "window-state.json";
const MIN_WIDTH: u32 = 640;
const MIN_HEIGHT: u32 = 720;
const MAX_DIMENSION: u32 = 16_384;

/// Window size is stored in physical pixels along with the capture scale factor.
/// Position and monitor bounds use Tauri's physical desktop coordinate space.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
    monitor_name: Option<String>,
    #[serde(default)]
    fullscreen: bool,
}

#[derive(Default)]
pub struct WindowStateTracker {
    last_normal: Mutex<Option<WindowState>>,
}

impl WindowState {
    fn is_valid(&self) -> bool {
        self.width > 0
            && self.height > 0
            && self.width <= MAX_DIMENSION
            && self.height <= MAX_DIMENSION
            && self.scale_factor.is_finite()
            && (0.1..=16.0).contains(&self.scale_factor)
    }
}

pub fn restore(window: &WebviewWindow, config_dir: &Path) -> bool {
    let path = config_dir.join(STATE_FILE);
    let state = match fs::read(&path) {
        Ok(contents) => match serde_json::from_slice::<WindowState>(&contents) {
            Ok(state) if state.is_valid() => state,
            Ok(_) => {
                tracing::warn!(
                    operation = "window_state.restore",
                    path = %path.display(),
                    "ignoring invalid saved window geometry",
                );
                return false;
            }
            Err(error) => {
                tracing::warn!(
                    operation = "window_state.restore",
                    path = %path.display(),
                    error = %error,
                    "ignoring unreadable saved window geometry",
                );
                return false;
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return false,
        Err(error) => {
            tracing::warn!(
                operation = "window_state.restore",
                path = %path.display(),
                error = %error,
                "failed to read saved window geometry",
            );
            return false;
        }
    };
    let fullscreen = state.fullscreen;

    let monitors = match window.available_monitors() {
        Ok(monitors) => monitors,
        Err(error) => {
            tracing::warn!(
                operation = "window_state.restore",
                error = %error,
                "could not enumerate displays; keeping default window geometry",
            );
            return fullscreen;
        }
    };
    let monitor = state
        .monitor_name
        .as_ref()
        .and_then(|saved_name| {
            monitors
                .iter()
                .find(|monitor| monitor.name().is_some_and(|name| name == saved_name))
                .cloned()
        })
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| monitors.first().cloned());

    let Some(monitor) = monitor else {
        tracing::warn!(
            operation = "window_state.restore",
            "no display is available; keeping default window geometry",
        );
        return fullscreen;
    };

    let scale_factor = monitor.scale_factor();
    if !scale_factor.is_finite() || !(0.1..=16.0).contains(&scale_factor) {
        tracing::warn!(
            operation = "window_state.restore",
            scale_factor,
            "display reported an invalid scale factor; keeping default window geometry",
        );
        return fullscreen;
    }

    let width = restored_dimension(
        state.width,
        state.scale_factor,
        scale_factor,
        MIN_WIDTH,
        monitor.work_area().size.width,
    );
    let height = restored_dimension(
        state.height,
        state.scale_factor,
        scale_factor,
        MIN_HEIGHT,
        monitor.work_area().size.height,
    );
    let position = clamp_position(
        state.x,
        state.y,
        width,
        height,
        &monitor.work_area().position,
        &monitor.work_area().size,
    );

    if let Err(error) = window.set_size(PhysicalSize::new(width, height)) {
        tracing::warn!(
            operation = "window_state.restore",
            error = %error,
            "could not restore window size",
        );
    }
    if let Err(error) = window.set_position(position) {
        tracing::warn!(
            operation = "window_state.restore",
            error = %error,
            "could not restore window position",
        );
    }
    fullscreen
}

impl WindowStateTracker {
    pub fn from_window(window: &WebviewWindow) -> Self {
        let tracker = Self::default();
        tracker.observe(window);
        tracker
    }

    /// Updates the in-memory normal geometry without writing to disk.
    pub fn observe(&self, window: &WebviewWindow) {
        match current_normal_state(window) {
            Ok(Some(state)) => match self.last_normal.lock() {
                Ok(mut last_normal) => *last_normal = Some(state),
                Err(error) => tracing::warn!(
                    operation = "window_state.observe",
                    error = %error,
                    "window geometry tracker lock is poisoned",
                ),
            },
            Ok(None) => {}
            Err(error) => tracing::warn!(
                operation = "window_state.observe",
                error = %error,
                "could not sample normal window geometry",
            ),
        }
    }

    /// Samples the current geometry when normal, then persists the latest normal
    /// snapshot once while closing. Maximized/fullscreen geometry never replaces it.
    pub fn save(&self, window: &WebviewWindow, config_dir: &Path) {
        self.observe(window);
        let fullscreen = match window.is_fullscreen() {
            Ok(fullscreen) => fullscreen,
            Err(error) => {
                tracing::warn!(
                    operation = "window_state.save",
                    error = %error,
                    "could not read fullscreen state; preserving previous geometry file",
                );
                return;
            }
        };
        let state = match self.last_normal.lock() {
            Ok(last_normal) => last_normal.clone(),
            Err(error) => {
                tracing::warn!(
                    operation = "window_state.save",
                    error = %error,
                    "window geometry tracker lock is poisoned; preserving previous file",
                );
                return;
            }
        };
        let Some(mut state) = state else {
            tracing::warn!(
                operation = "window_state.save",
                "no normal window geometry is available to save",
            );
            return;
        };
        state.fullscreen = fullscreen;

        let path = config_dir.join(STATE_FILE);
        let result = serde_json::to_vec_pretty(&state)
            .map_err(std::io::Error::other)
            .and_then(|contents| fs::write(&path, contents));
        if let Err(error) = result {
            tracing::warn!(
                operation = "window_state.save",
                path = %path.display(),
                error = %error,
                "failed to save window geometry; application will still close",
            );
        }
    }
}

fn current_normal_state(window: &WebviewWindow) -> Result<Option<WindowState>, String> {
    let fullscreen = match window.is_fullscreen() {
        Ok(fullscreen) => fullscreen,
        Err(error) => return Err(format!("could not determine fullscreen state: {error}")),
    };
    let maximized = match window.is_maximized() {
        Ok(maximized) => maximized,
        Err(error) => return Err(format!("could not determine maximized state: {error}")),
    };
    if fullscreen || maximized {
        return Ok(None);
    }

    let (position, size, scale_factor, monitor_name) = match (
        window.outer_position(),
        window.inner_size(),
        window.scale_factor(),
        window.current_monitor(),
    ) {
        (Ok(position), Ok(size), Ok(scale_factor), Ok(monitor)) => (
            position,
            size,
            scale_factor,
            monitor.and_then(|monitor| monitor.name().cloned()),
        ),
        (position, size, scale_factor, monitor) => return Err(format!(
            "could not read complete window geometry (position: {}; size: {}; scale: {}; monitor: {})",
            position.err().map(|error| error.to_string()).unwrap_or_else(|| "ok".into()),
            size.err().map(|error| error.to_string()).unwrap_or_else(|| "ok".into()),
            scale_factor.err().map(|error| error.to_string()).unwrap_or_else(|| "ok".into()),
            monitor.err().map(|error| error.to_string()).unwrap_or_else(|| "ok".into()),
        )),
    };

    let state = WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        scale_factor,
        monitor_name,
        fullscreen: false,
    };
    if !state.is_valid() {
        return Err("window reported invalid geometry".into());
    }
    Ok(Some(state))
}

fn restored_dimension(
    saved_physical: u32,
    saved_scale: f64,
    current_scale: f64,
    minimum_logical: u32,
    monitor_physical: u32,
) -> u32 {
    let minimum_physical = (f64::from(minimum_logical) * current_scale).ceil() as u32;
    let scaled = (f64::from(saved_physical) / saved_scale * current_scale).round();
    let scaled = scaled.clamp(0.0, f64::from(MAX_DIMENSION)) as u32;
    // Tauri's configured minimum is logical size. Convert it to physical pixels
    // for the target display, while allowing a too-small display to retain that
    // minimum and anchoring the oversized window at the display origin.
    scaled
        .max(minimum_physical)
        .min(monitor_physical.max(minimum_physical))
}

fn clamp_position(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    monitor_position: &PhysicalPosition<i32>,
    monitor_size: &PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let max_x = monitor_position.x.saturating_add(
        monitor_size
            .width
            .saturating_sub(width)
            .min(i32::MAX as u32) as i32,
    );
    let max_y = monitor_position.y.saturating_add(
        monitor_size
            .height
            .saturating_sub(height)
            .min(i32::MAX as u32) as i32,
    );
    PhysicalPosition::new(
        x.clamp(monitor_position.x, max_x),
        y.clamp(monitor_position.y, max_y),
    )
}
