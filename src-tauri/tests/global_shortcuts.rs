//! Real Windows/plugin verification without creating a foreground window.
//! The production transaction state is verified by its module unit tests.
#![cfg(target_os = "windows")]

use std::{
    ptr,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[link(name = "user32")]
extern "system" {
    fn RegisterHotKey(window: *mut std::ffi::c_void, id: i32, modifiers: u32, key: u32) -> i32;
    fn UnregisterHotKey(window: *mut std::ffi::c_void, id: i32) -> i32;
    fn keybd_event(key: u8, scan: u8, flags: u32, extra: usize);
}

struct ExternalRegistration(i32);
impl Drop for ExternalRegistration {
    fn drop(&mut self) {
        unsafe {
            UnregisterHotKey(ptr::null_mut(), self.0);
        }
    }
}

fn send_chord() {
    // F24 avoids interfering with the user's normal shortcut combinations.
    unsafe {
        keybd_event(0x11, 0, 0, 0); // Ctrl down
        keybd_event(0x12, 0, 0, 0); // Alt down
        keybd_event(0x87, 0, 0, 0); // F24 down
        keybd_event(0x87, 0, 2, 0);
        keybd_event(0x12, 0, 2, 0);
        keybd_event(0x11, 0, 2, 0);
    }
}

#[test]
#[allow(deprecated)] // run_iteration lets this bounded test drive the actual native event loop.
fn real_plugin_background_event_conflict_and_unregister() {
    let (tx, rx) = mpsc::channel();
    let shortcut: Shortcut = "Ctrl+Alt+F24".parse().unwrap();
    let expected_id = shortcut.id();
    let plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |_app, key, event| {
            if key.id() == expected_id {
                tx.send(event.state()).unwrap();
            }
        })
        .build();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let mut app = tauri::Builder::default()
        .any_thread()
        .plugin(plugin)
        .build(context)
        .unwrap();

    app.global_shortcut()
        .register(shortcut)
        .expect("rare test chord must register");
    assert!(app.global_shortcut().is_registered(shortcut));
    // A separate claimant cannot obtain the chord held by the real plugin.
    assert_eq!(
        unsafe { RegisterHotKey(ptr::null_mut(), 0x6321, 0x4003, 0x87) },
        0
    );

    send_chord();
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut events = Vec::new();
    while Instant::now() < deadline && events.len() < 2 {
        app.run_iteration(|_, _| {});
        events.extend(rx.try_iter());
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(
        events,
        [ShortcutState::Pressed, ShortcutState::Released],
        "one press/release in a windowless app"
    );

    app.global_shortcut().unregister(shortcut).unwrap();
    assert!(!app.global_shortcut().is_registered(shortcut));
    assert_ne!(
        unsafe { RegisterHotKey(ptr::null_mut(), 0x6321, 0x4003, 0x87) },
        0,
        "unregister releases OS ownership"
    );
    let external = ExternalRegistration(0x6321);
    assert!(
        app.global_shortcut().register(shortcut).is_err(),
        "external claimant is surfaced as a registration error"
    );
    assert!(
        !app.global_shortcut().is_registered(shortcut),
        "failed registration must not report success"
    );
    drop(external);
    app.global_shortcut().register(shortcut).unwrap();
    app.global_shortcut().unregister_all().unwrap();
    assert!(!app.global_shortcut().is_registered(shortcut));
    assert_ne!(
        unsafe { RegisterHotKey(ptr::null_mut(), 0x6321, 0x4003, 0x87) },
        0
    );
    let _released = ExternalRegistration(0x6321);
}
