//! Native shortcut ownership stays in Rust; playback remains owned by the frontend.
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use serde::{Deserialize, Deserializer, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const SETTINGS_FILE: &str = "global-shortcuts.json";
const ACTION_EVENT: &str = "spmusic://global-shortcut-action";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutAction {
    Previous,
    Next,
    VolumeUp,
    VolumeDown,
    TogglePlayback,
}

// deserialize_with makes null legal while still requiring all five fields.
fn binding<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShortcutBindings {
    #[serde(deserialize_with = "binding")]
    previous: Option<String>,
    #[serde(deserialize_with = "binding")]
    next: Option<String>,
    #[serde(deserialize_with = "binding")]
    volume_up: Option<String>,
    #[serde(deserialize_with = "binding")]
    volume_down: Option<String>,
    #[serde(deserialize_with = "binding")]
    toggle_playback: Option<String>,
}

impl Default for ShortcutBindings {
    fn default() -> Self {
        Self {
            previous: Some("Ctrl+Alt+ArrowLeft".into()),
            next: Some("Ctrl+Alt+ArrowRight".into()),
            volume_up: Some("Ctrl+Alt+ArrowUp".into()),
            volume_down: Some("Ctrl+Alt+ArrowDown".into()),
            toggle_playback: Some("Ctrl+KeyP".into()),
        }
    }
}

impl ShortcutBindings {
    fn entries(&self) -> [(ShortcutAction, &Option<String>); 5] {
        use ShortcutAction::*;
        [
            (Previous, &self.previous),
            (Next, &self.next),
            (VolumeUp, &self.volume_up),
            (VolumeDown, &self.volume_down),
            (TogglePlayback, &self.toggle_playback),
        ]
    }
    fn set(&mut self, action: ShortcutAction, value: Option<String>) {
        *match action {
            ShortcutAction::Previous => &mut self.previous,
            ShortcutAction::Next => &mut self.next,
            ShortcutAction::VolumeUp => &mut self.volume_up,
            ShortcutAction::VolumeDown => &mut self.volume_down,
            ShortcutAction::TogglePlayback => &mut self.toggle_playback,
        } = value;
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ShortcutIssue {
    action: Option<ShortcutAction>,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShortcutSettings {
    bindings: ShortcutBindings,
    issues: Vec<ShortcutIssue>,
    suspended: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShortcutError {
    code: &'static str,
    message: String,
    action: Option<ShortcutAction>,
}

impl ShortcutError {
    fn new(code: &'static str, message: impl Into<String>, action: Option<ShortcutAction>) -> Self {
        Self {
            code,
            message: message.into(),
            action,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateShortcutsInput {
    bindings: ShortcutBindings,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredSettings {
    bindings: ShortcutBindings,
}

#[derive(Debug, Clone, Copy)]
struct ActiveShortcut {
    action: ShortcutAction,
    shortcut: Shortcut,
}

fn validate(
    bindings: &ShortcutBindings,
) -> Result<(ShortcutBindings, Vec<ActiveShortcut>), ShortcutError> {
    let mut canonical = bindings.clone();
    let mut active = Vec::new();
    let mut used = HashSet::new();
    for (action, value) in bindings.entries() {
        let Some(value) = value else { continue };
        let invalid =
            |message: String| ShortcutError::new("INVALID_SHORTCUT", message, Some(action));
        // Plugin aliases normalize to physical codes; duplicate modifiers are rejected explicitly.
        let tokens: Vec<_> = value.split('+').map(str::trim).collect();
        let mut modifiers = HashSet::new();
        for token in tokens.iter().take(tokens.len().saturating_sub(1)) {
            let modifier = match token.to_ascii_lowercase().as_str() {
                "ctrl" | "control" => "Ctrl",
                "alt" | "option" => "Alt",
                "shift" => "Shift",
                "super" | "cmd" | "command" => "Super",
                _ => return Err(invalid("组合必须由修饰键加一个按键组成".into())),
            };
            if !modifiers.insert(modifier) {
                return Err(invalid("组合中不能重复修饰键".into()));
            }
        }
        let shortcut: Shortcut = value
            .parse()
            .map_err(|error| invalid(format!("无效快捷键：{error}")))?;
        if !shortcut
            .mods
            .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
        {
            return Err(invalid("请至少包含 Ctrl、Alt 或 Super 修饰键".into()));
        }
        if !used.insert(shortcut.id()) {
            return Err(ShortcutError::new(
                "DUPLICATE_SHORTCUT",
                "多个操作不能使用相同快捷键",
                Some(action),
            ));
        }
        let mut parts = Vec::new();
        for (modifier, name) in [
            (Modifiers::CONTROL, "Ctrl"),
            (Modifiers::ALT, "Alt"),
            (Modifiers::SHIFT, "Shift"),
            (Modifiers::SUPER, "Super"),
        ] {
            if shortcut.mods.contains(modifier) {
                parts.push(name.to_string());
            }
        }
        parts.push(shortcut.key.to_string());
        canonical.set(action, Some(parts.join("+")));
        active.push(ActiveShortcut { action, shortcut });
    }
    Ok((canonical, active))
}

trait Registrar {
    fn register(&mut self, shortcut: Shortcut) -> Result<(), String>;
    fn unregister(&mut self, shortcut: Shortcut) -> Result<(), String>;
}

struct NativeRegistrar<'a>(&'a AppHandle);
impl Registrar for NativeRegistrar<'_> {
    fn register(&mut self, shortcut: Shortcut) -> Result<(), String> {
        self.0
            .global_shortcut()
            .register(shortcut)
            .map_err(|error| error.to_string())
    }
    fn unregister(&mut self, shortcut: Shortcut) -> Result<(), String> {
        self.0
            .global_shortcut()
            .unregister(shortcut)
            .map_err(|error| error.to_string())
    }
}

#[derive(Clone)]
struct ShortcutEngine {
    settings: ShortcutSettings,
    active: Vec<ActiveShortcut>,
    path: PathBuf,
}

impl ShortcutEngine {
    fn action_for_shortcut(&self, shortcut: &Shortcut) -> Option<ShortcutAction> {
        if self.settings.suspended {
            return None;
        }
        // Native cleanup can fail: only dispatch bindings that remain committed.
        self.settings
            .bindings
            .entries()
            .into_iter()
            .find_map(|(action, value)| {
                value
                    .as_ref()
                    .and_then(|value| value.parse::<Shortcut>().ok())
                    .filter(|committed| committed.id() == shortcut.id())
                    .and_then(|_| {
                        self.active
                            .iter()
                            .find(|item| {
                                item.action == action && item.shortcut.id() == shortcut.id()
                            })
                            .map(|_| action)
                    })
            })
    }

    fn load(path: PathBuf) -> Self {
        let mut issues = Vec::new();
        let bindings = match fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<StoredSettings>(&bytes)
                .map_err(|error| error.to_string())
                .and_then(|stored| {
                    validate(&stored.bindings)
                        .map(|v| v.0)
                        .map_err(|error| error.message)
                }) {
                Ok(bindings) => bindings,
                Err(error) => {
                    issues.push(ShortcutIssue {
                        action: None,
                        message: format!("快捷键配置无法读取，已使用默认设置：{error}"),
                    });
                    ShortcutBindings::default()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                ShortcutBindings::default()
            }
            Err(error) => {
                issues.push(ShortcutIssue {
                    action: None,
                    message: format!("快捷键配置无法读取，已使用默认设置：{error}"),
                });
                ShortcutBindings::default()
            }
        };
        Self {
            settings: ShortcutSettings {
                bindings,
                issues,
                suspended: false,
            },
            active: Vec::new(),
            path,
        }
    }

    fn register_available(&mut self, registrar: &mut impl Registrar) {
        let (_, desired) =
            validate(&self.settings.bindings).expect("committed bindings are validated");
        for item in desired {
            match registrar.register(item.shortcut) {
                Ok(()) => self.active.push(item),
                Err(error) => self.settings.issues.push(ShortcutIssue {
                    action: Some(item.action),
                    message: format!("无法注册快捷键：{error}"),
                }),
            }
        }
    }

    // Per-item unregister preserves the native plugin's ownership map on a failure.
    // Its unregister_all takes that map before the OS operation, which hides failed removals.
    fn clear(&mut self, registrar: &mut impl Registrar) -> Vec<ShortcutIssue> {
        let mut retained = Vec::new();
        let mut issues = Vec::new();
        for item in self.active.drain(..) {
            if let Err(error) = registrar.unregister(item.shortcut) {
                issues.push(ShortcutIssue {
                    action: Some(item.action),
                    message: format!("无法释放快捷键：{error}"),
                });
                retained.push(item);
            }
        }
        self.active = retained;
        issues
    }

    fn rollback(
        &mut self,
        old: &Self,
        registrar: &mut impl Registrar,
        cause: ShortcutError,
    ) -> ShortcutError {
        let cleanup_issues = self.clear(registrar);
        let mut issues: Vec<_> = cleanup_issues
            .into_iter()
            .filter(|issue| {
                self.active.iter().any(|retained| {
                    Some(retained.action) == issue.action
                        && !old
                            .active
                            .iter()
                            .any(|previous| previous.shortcut.id() == retained.shortcut.id())
                })
            })
            .collect();
        self.settings = old.settings.clone();
        for item in &old.active {
            if let Some(retained) = self
                .active
                .iter_mut()
                .find(|v| v.shortcut.id() == item.shortcut.id())
            {
                *retained = *item;
                continue;
            }
            match registrar.register(item.shortcut) {
                Ok(()) => self.active.push(*item),
                Err(error) => issues.push(ShortcutIssue {
                    action: Some(item.action),
                    message: format!("恢复原快捷键失败：{error}"),
                }),
            }
        }
        if issues.is_empty() {
            return cause;
        }
        let details = issues
            .iter()
            .map(|issue| issue.message.as_str())
            .collect::<Vec<_>>()
            .join("；");
        self.settings.issues.extend(issues);
        ShortcutError::new(
            "ROLLBACK_FAILED",
            format!("{}；{details}", cause.message),
            cause.action,
        )
    }

    fn update(
        &mut self,
        bindings: ShortcutBindings,
        registrar: &mut impl Registrar,
        persist: impl FnOnce(&Path, &ShortcutBindings) -> Result<(), String>,
    ) -> Result<ShortcutSettings, ShortcutError> {
        if self.settings.suspended {
            return Err(ShortcutError::new(
                "CAPTURE_ACTIVE",
                "请先结束快捷键录制再保存",
                None,
            ));
        }
        let (bindings, desired) = validate(&bindings)?;
        let old = self.clone();
        let removal_issues = self.clear(registrar);
        if let Some(issue) = removal_issues.first() {
            let error =
                ShortcutError::new("REGISTRATION_FAILED", issue.message.clone(), issue.action);
            return Err(self.rollback(&old, registrar, error));
        }
        // Remove old bindings first to allow swaps between two actions in the same app.
        for item in desired {
            if let Err(error) = registrar.register(item.shortcut) {
                let error = ShortcutError::new(
                    "REGISTRATION_FAILED",
                    format!("无法注册快捷键：{error}"),
                    Some(item.action),
                );
                return Err(self.rollback(&old, registrar, error));
            }
            self.active.push(item);
        }
        if let Err(error) = persist(&self.path, &bindings) {
            let error = ShortcutError::new(
                "PERSISTENCE_FAILED",
                format!("无法保存快捷键设置：{error}"),
                None,
            );
            return Err(self.rollback(&old, registrar, error));
        }
        self.settings = ShortcutSettings {
            bindings,
            issues: Vec::new(),
            suspended: false,
        };
        Ok(self.settings.clone())
    }

    fn suspend(
        &mut self,
        suspended: bool,
        registrar: &mut impl Registrar,
    ) -> Result<ShortcutSettings, ShortcutError> {
        if suspended == self.settings.suspended {
            return Ok(self.settings.clone());
        }
        if suspended {
            let old = self.clone();
            let issues = self.clear(registrar);
            if let Some(issue) = issues.first() {
                return Err(self.rollback(
                    &old,
                    registrar,
                    ShortcutError::new("REGISTRATION_FAILED", issue.message.clone(), issue.action),
                ));
            }
            self.settings.suspended = true;
        } else {
            // Keep configuration-read errors until a successful save repairs the file.
            self.settings.issues.retain(|issue| issue.action.is_none());
            self.register_available(registrar);
            self.settings.suspended = false;
        }
        Ok(self.settings.clone())
    }
}

fn persist(path: &Path, bindings: &ShortcutBindings) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&StoredSettings {
        bindings: bindings.clone(),
    })
    .map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        replace_file(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(destination.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(std::io::Error::other)
}

#[cfg(not(target_os = "windows"))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

pub struct GlobalShortcuts {
    engine: Mutex<ShortcutEngine>,
    transitioning: AtomicBool,
}

impl GlobalShortcuts {
    pub fn initialize(app: &AppHandle, config_dir: &Path) {
        let state = Self {
            engine: Mutex::new(ShortcutEngine::load(config_dir.join(SETTINGS_FILE))),
            transitioning: AtomicBool::new(false),
        };
        app.manage(state);
        // Initialization and all subsequent mutations execute as one main-thread operation.
        mutate(app, |engine, registrar| {
            engine.register_available(registrar);
            Ok(engine.settings.clone())
        })
        .expect("shortcut state was just installed");
    }
}

// Only snapshot access is locked. No application mutex crosses native/main-thread dispatch.
fn mutate(
    app: &AppHandle,
    operation: impl FnOnce(
        &mut ShortcutEngine,
        &mut NativeRegistrar<'_>,
    ) -> Result<ShortcutSettings, ShortcutError>,
) -> Result<ShortcutSettings, ShortcutError> {
    let state = app.state::<GlobalShortcuts>();
    state.transitioning.store(true, Ordering::SeqCst);
    let mut engine = state
        .engine
        .lock()
        .map_err(|_| ShortcutError::new("ROLLBACK_FAILED", "快捷键状态锁不可用", None))?
        .clone();
    let result = operation(&mut engine, &mut NativeRegistrar(app));
    *state
        .engine
        .lock()
        .map_err(|_| ShortcutError::new("ROLLBACK_FAILED", "快捷键状态锁不可用", None))? = engine;
    state.transitioning.store(false, Ordering::SeqCst);
    result
}

async fn on_main(
    app: AppHandle,
    operation: impl FnOnce(&AppHandle) -> Result<ShortcutSettings, ShortcutError> + Send + 'static,
) -> Result<ShortcutSettings, ShortcutError> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(operation(&handle));
    })
    .map_err(|error| ShortcutError::new("REGISTRATION_FAILED", error.to_string(), None))?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| ShortcutError::new("REGISTRATION_FAILED", error.to_string(), None))?
        .map_err(|error| ShortcutError::new("REGISTRATION_FAILED", error.to_string(), None))?
}

#[tauri::command]
pub async fn global_shortcuts_get_settings(
    app: AppHandle,
) -> Result<ShortcutSettings, ShortcutError> {
    on_main(app, |app| {
        Ok(app
            .state::<GlobalShortcuts>()
            .engine
            .lock()
            .map_err(|_| ShortcutError::new("ROLLBACK_FAILED", "快捷键状态锁不可用", None))?
            .settings
            .clone())
    })
    .await
}

#[tauri::command]
pub async fn global_shortcuts_update_settings(
    app: AppHandle,
    input: UpdateShortcutsInput,
) -> Result<ShortcutSettings, ShortcutError> {
    on_main(app, move |app| {
        mutate(app, |engine, registrar| {
            engine.update(input.bindings, registrar, persist)
        })
    })
    .await
}

#[tauri::command]
pub async fn global_shortcuts_set_suspended(
    app: AppHandle,
    suspended: bool,
) -> Result<ShortcutSettings, ShortcutError> {
    on_main(app, move |app| {
        if suspended
            && !app
                .get_webview_window("main")
                .and_then(|window| window.is_focused().ok())
                .unwrap_or(false)
        {
            return Err(ShortcutError::new(
                "CAPTURE_ACTIVE",
                "请在播放器窗口中录制快捷键",
                None,
            ));
        }
        mutate(app, |engine, registrar| {
            engine.suspend(suspended, registrar)
        })
    })
    .await
}

pub fn handle_event(
    app: &AppHandle,
    shortcut: &Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    // global-hotkey 0.8 uses MOD_NOREPEAT on Windows: each physical press emits once.
    if event.state != ShortcutState::Pressed {
        return;
    }
    let Some(state) = app.try_state::<GlobalShortcuts>() else {
        return;
    };
    if state.transitioning.load(Ordering::SeqCst) {
        return;
    }
    let action = {
        let Ok(engine) = state.engine.lock() else {
            return;
        };
        engine.action_for_shortcut(shortcut)
    };
    if let Some(action) = action {
        #[derive(Clone, Serialize)]
        struct ActionEvent {
            action: ShortcutAction,
        }
        if let Err(error) = app.emit_to("main", ACTION_EVENT, ActionEvent { action }) {
            tracing::warn!(%error, "could not deliver global shortcut action");
        }
    }
}

pub fn restore_after_focus_loss(app: &AppHandle) {
    if app.try_state::<GlobalShortcuts>().is_none() {
        return;
    }
    if let Err(error) = mutate(app, |engine, registrar| engine.suspend(false, registrar)) {
        tracing::warn!(message = %error.message, "could not resume global shortcuts after focus loss");
    }
}

pub fn shutdown(app: &AppHandle) {
    if app.try_state::<GlobalShortcuts>().is_none() {
        return;
    }
    let _ = mutate(app, |engine, registrar| {
        engine.settings.suspended = true;
        for issue in engine.clear(registrar) {
            tracing::warn!(message = %issue.message, "global shortcut cleanup failed");
        }
        Ok(engine.settings.clone())
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, sync::atomic::AtomicU64};

    #[derive(Default)]
    struct FakeRegistrar {
        registered: HashSet<u32>,
        failures: HashMap<u32, usize>,
        removal_failures: HashSet<u32>,
        calls: usize,
    }
    impl Registrar for FakeRegistrar {
        fn register(&mut self, shortcut: Shortcut) -> Result<(), String> {
            self.calls += 1;
            if let Some(remaining) = self.failures.get_mut(&shortcut.id()) {
                if *remaining > 0 {
                    *remaining -= 1;
                    return Err("occupied".into());
                }
            }
            if !self.registered.insert(shortcut.id()) {
                return Err("duplicate native registration".into());
            }
            Ok(())
        }
        fn unregister(&mut self, shortcut: Shortcut) -> Result<(), String> {
            self.calls += 1;
            if self.removal_failures.contains(&shortcut.id()) {
                return Err("native removal failed".into());
            }
            self.registered.remove(&shortcut.id());
            Ok(())
        }
    }
    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "spmusic-shortcuts-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn file(&self) -> PathBuf {
            self.0.join(SETTINGS_FILE)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn prepared(path: PathBuf) -> (ShortcutEngine, FakeRegistrar) {
        let mut engine = ShortcutEngine::load(path);
        let mut registrar = FakeRegistrar::default();
        engine.register_available(&mut registrar);
        (engine, registrar)
    }
    fn replacement() -> ShortcutBindings {
        ShortcutBindings {
            previous: Some("Ctrl+Shift+KeyK".into()),
            ..ShortcutBindings::default()
        }
    }
    fn ids(engine: &ShortcutEngine) -> HashSet<u32> {
        engine
            .active
            .iter()
            .map(|item| item.shortcut.id())
            .collect()
    }

    #[test]
    fn canonical_aliases_and_duplicate_validation_match_native_ids() {
        let mut bindings = ShortcutBindings::default();
        bindings.previous = Some(" SHIFT + control + alt + p ".into());
        let (canonical, _) = validate(&bindings).unwrap();
        assert_eq!(canonical.previous.as_deref(), Some("Ctrl+Alt+Shift+KeyP"));
        bindings.next = Some("Alt+Ctrl+Shift+KeyP".into());
        assert_eq!(validate(&bindings).unwrap_err().code, "DUPLICATE_SHORTCUT");
        for invalid in [
            "KeyK",
            "Shift+KeyK",
            "Ctrl+Ctrl+KeyK",
            "Ctrl+KeyK+Alt",
            "Ctrl+NotAKey",
            "",
        ] {
            bindings.previous = Some(invalid.into());
            assert_eq!(
                validate(&bindings).unwrap_err().code,
                "INVALID_SHORTCUT",
                "{invalid}"
            );
        }
    }

    #[test]
    fn all_five_nullable_fields_are_required() {
        assert!(serde_json::from_str::<ShortcutBindings>(
            r#"{"previous":null,"next":null,"volumeUp":null,"volumeDown":null}"#
        )
        .is_err());
        let disabled: ShortcutBindings = serde_json::from_str(r#"{"previous":null,"next":null,"volumeUp":null,"volumeDown":null,"togglePlayback":null}"#).unwrap();
        assert!(validate(&disabled).unwrap().1.is_empty());
        let value = serde_json::to_value(ShortcutSettings {
            bindings: ShortcutBindings::default(),
            issues: vec![],
            suspended: false,
        })
        .unwrap();
        assert_eq!(value["bindings"]["previous"], "Ctrl+Alt+ArrowLeft");
        assert_eq!(value["bindings"]["next"], "Ctrl+Alt+ArrowRight");
        assert_eq!(value["bindings"]["volumeUp"], "Ctrl+Alt+ArrowUp");
        assert_eq!(value["bindings"]["togglePlayback"], "Ctrl+KeyP");
        assert_eq!(value["suspended"], false);
    }

    #[test]
    fn duplicate_input_does_not_touch_native_registration_or_disk() {
        let temp = TempDir::new();
        let (mut engine, mut registrar) = prepared(temp.file());
        let calls = registrar.calls;
        let mut bindings = ShortcutBindings::default();
        bindings.next = bindings.previous.clone();
        let error = engine
            .update(bindings, &mut registrar, |_, _| {
                panic!("invalid settings must never persist")
            })
            .unwrap_err();
        assert_eq!(error.code, "DUPLICATE_SHORTCUT");
        assert_eq!(registrar.calls, calls);
        assert_eq!(registrar.registered, ids(&engine));
        assert!(!temp.file().exists());
    }

    #[test]
    fn startup_conflict_is_action_specific_and_other_bindings_still_work() {
        let temp = TempDir::new();
        let mut engine = ShortcutEngine::load(temp.file());
        let mut registrar = FakeRegistrar::default();
        let previous: Shortcut = "Ctrl+Alt+ArrowLeft".parse().unwrap();
        registrar.failures.insert(previous.id(), 1);
        engine.register_available(&mut registrar);
        assert_eq!(engine.active.len(), 4);
        assert_eq!(engine.settings.issues.len(), 1);
        assert_eq!(
            engine.settings.issues[0].action,
            Some(ShortcutAction::Previous)
        );
    }

    #[test]
    fn registration_failure_restores_old_bindings_and_does_not_write() {
        let temp = TempDir::new();
        let (mut engine, mut registrar) = prepared(temp.file());
        let old_ids = ids(&engine);
        let desired: Shortcut = "Ctrl+Shift+KeyK".parse().unwrap();
        registrar.failures.insert(desired.id(), 1);
        let error = engine
            .update(replacement(), &mut registrar, |_, _| {
                panic!("conflict must not persist")
            })
            .unwrap_err();
        assert_eq!(error.code, "REGISTRATION_FAILED");
        assert_eq!(error.action, Some(ShortcutAction::Previous));
        assert_eq!(engine.settings.bindings, ShortcutBindings::default());
        assert_eq!(registrar.registered, old_ids);
        assert_eq!(ids(&engine), old_ids);
    }

    #[test]
    fn persistence_failure_restores_registration_and_keeps_existing_file() {
        let temp = TempDir::new();
        persist(&temp.file(), &ShortcutBindings::default()).unwrap();
        let original = fs::read(temp.file()).unwrap();
        let (mut engine, mut registrar) = prepared(temp.file());
        let old_ids = ids(&engine);
        let error = engine
            .update(
                replacement(),
                &mut registrar,
                |_, _| Err("disk full".into()),
            )
            .unwrap_err();
        assert_eq!(error.code, "PERSISTENCE_FAILED");
        assert_eq!(engine.settings.bindings, ShortcutBindings::default());
        assert_eq!(registrar.registered, old_ids);
        assert_eq!(fs::read(temp.file()).unwrap(), original);
    }

    #[test]
    fn partial_registration_failure_removes_new_keys_before_restoring_old_keys() {
        let temp = TempDir::new();
        let (mut engine, mut registrar) = prepared(temp.file());
        let original = ids(&engine);
        let late_failure: Shortcut = "Ctrl+Alt+ArrowUp".parse().unwrap();
        registrar.failures.insert(late_failure.id(), 1);
        assert_eq!(
            engine
                .update(replacement(), &mut registrar, |_, _| panic!())
                .unwrap_err()
                .code,
            "REGISTRATION_FAILED"
        );
        assert_eq!(registrar.registered, original);
        assert_eq!(ids(&engine), original);
        assert!(engine.settings.issues.is_empty());
    }

    #[test]
    fn rollback_cleanup_failure_reports_and_suppresses_uncommitted_action() {
        let temp = TempDir::new();
        let (mut engine, mut registrar) = prepared(temp.file());
        let candidate: Shortcut = "Ctrl+Shift+KeyK".parse().unwrap();
        let late_failure: Shortcut = "Ctrl+Alt+ArrowUp".parse().unwrap();
        registrar.failures.insert(late_failure.id(), 1);
        registrar.removal_failures.insert(candidate.id());
        assert_eq!(
            engine
                .update(replacement(), &mut registrar, |_, _| panic!())
                .unwrap_err()
                .code,
            "ROLLBACK_FAILED"
        );
        assert_eq!(engine.active.len(), 6);
        assert_eq!(registrar.registered, ids(&engine));
        assert_eq!(engine.action_for_shortcut(&candidate), None);
        let previous: Shortcut = "Ctrl+Alt+ArrowLeft".parse().unwrap();
        assert_eq!(
            engine.action_for_shortcut(&previous),
            Some(ShortcutAction::Previous)
        );
        assert!(engine.settings.issues[0].message.contains("无法释放"));
    }

    #[test]
    fn failed_rollback_is_reported_with_actual_remaining_registrations() {
        let temp = TempDir::new();
        let (mut engine, mut registrar) = prepared(temp.file());
        let desired: Shortcut = "Ctrl+Shift+KeyK".parse().unwrap();
        let old: Shortcut = "Ctrl+Alt+ArrowLeft".parse().unwrap();
        registrar.failures.insert(desired.id(), 1);
        registrar.failures.insert(old.id(), 1);
        let error = engine
            .update(replacement(), &mut registrar, |_, _| panic!())
            .unwrap_err();
        assert_eq!(error.code, "ROLLBACK_FAILED");
        assert_eq!(engine.settings.bindings, ShortcutBindings::default());
        assert_eq!(engine.active.len(), 4);
        assert_eq!(registrar.registered, ids(&engine));
        assert_eq!(
            engine.settings.issues[0].action,
            Some(ShortcutAction::Previous)
        );
        assert!(!temp.file().exists());
    }

    #[test]
    fn swaps_disable_and_reload_preserve_committed_configuration() {
        let temp = TempDir::new();
        let (mut engine, mut registrar) = prepared(temp.file());
        let mut bindings = ShortcutBindings::default();
        std::mem::swap(&mut bindings.previous, &mut bindings.next);
        bindings.volume_down = None;
        engine
            .update(bindings.clone(), &mut registrar, persist)
            .unwrap();
        assert_eq!(registrar.registered, ids(&engine));
        assert_eq!(engine.active.len(), 4);
        assert_eq!(
            ShortcutEngine::load(temp.file()).settings.bindings,
            bindings
        );
        engine
            .update(ShortcutBindings::default(), &mut registrar, persist)
            .unwrap();
        assert_eq!(
            ShortcutEngine::load(temp.file()).settings.bindings,
            ShortcutBindings::default()
        );
        assert_eq!(engine.active.len(), 5);
    }

    #[test]
    fn recording_unregisters_blocks_save_and_reports_resume_conflict() {
        let temp = TempDir::new();
        let (mut engine, mut registrar) = prepared(temp.file());
        assert!(engine.suspend(true, &mut registrar).unwrap().suspended);
        assert!(registrar.registered.is_empty());
        assert_eq!(
            engine
                .update(replacement(), &mut registrar, |_, _| panic!())
                .unwrap_err()
                .code,
            "CAPTURE_ACTIVE"
        );
        let previous: Shortcut = "Ctrl+Alt+ArrowLeft".parse().unwrap();
        registrar.failures.insert(previous.id(), 1);
        let settings = engine.suspend(false, &mut registrar).unwrap();
        assert!(!settings.suspended);
        assert_eq!(settings.issues.len(), 1);
        assert_eq!(engine.active.len(), 4);
        let calls = registrar.calls;
        engine.suspend(false, &mut registrar).unwrap();
        assert_eq!(registrar.calls, calls, "focus-loss restore is idempotent");
    }

    #[test]
    fn failed_suspend_retains_old_native_ownership_and_does_not_claim_suspended() {
        let temp = TempDir::new();
        let (mut engine, mut registrar) = prepared(temp.file());
        let previous: Shortcut = "Ctrl+Alt+ArrowLeft".parse().unwrap();
        registrar.removal_failures.insert(previous.id());
        assert_eq!(
            engine.suspend(true, &mut registrar).unwrap_err().code,
            "REGISTRATION_FAILED"
        );
        assert!(!engine.settings.suspended);
        assert_eq!(engine.active.len(), 5);
        assert_eq!(registrar.registered, ids(&engine));
    }

    #[test]
    fn corrupt_configuration_uses_defaults_and_reports_issue_without_overwrite() {
        let temp = TempDir::new();
        fs::write(temp.file(), b"not json").unwrap();
        let engine = ShortcutEngine::load(temp.file());
        assert_eq!(engine.settings.bindings, ShortcutBindings::default());
        assert_eq!(engine.settings.issues[0].action, None);
        assert_eq!(fs::read(temp.file()).unwrap(), b"not json");
    }
}
