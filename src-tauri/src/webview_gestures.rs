//! Windows touchpad pinch must be enabled before the first application navigation.
//! Wry otherwise couples it to browser zoom hotkeys, which remain disabled here.

use tauri::{
    utils::config::{Config, FrontendDist, WebviewUrl, WindowConfig},
    Manager, Url, WebviewWindowBuilder,
};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
use windows_core_061::{Interface, HSTRING};

// Collection handlers run on their panels before this bubbling window handler.
// Keep their events intact while preventing page zoom outside collections too.
const PREVENT_PAGE_ZOOM: &str = r#"
window.addEventListener('wheel', event => {
  if (event.ctrlKey) event.preventDefault();
}, { passive: false });
window.addEventListener('touchmove', event => {
  if (event.touches.length > 1) event.preventDefault();
}, { passive: false });
"#;

pub fn defer_main_window(config: &mut Config) -> Option<WindowConfig> {
    let main = config
        .app
        .windows
        .iter_mut()
        .find(|window| window.label == "main" && window.create)?;
    let original = main.clone();
    main.create = false;
    Some(original)
}

pub fn create_main_window(
    app: &tauri::App,
    config: &WindowConfig,
) -> Result<Url, Box<dyn std::error::Error>> {
    let target = application_url(app.config(), config, tauri::is_dev())?;
    let bootstrap = bootstrap_url(&target);
    let mut deferred = config.clone();
    deferred.url = WebviewUrl::External(bootstrap.clone());
    // Preserve the application origin for Tauri's asset/IPC registration.
    // This exact bootstrap URL is never loaded, even if its native navigation
    // event is delivered after we have initialized and navigated to the app.
    WebviewWindowBuilder::from_config(app, &deferred)?
        .on_navigation(move |url| *url != bootstrap)
        .initialization_script(PREVENT_PAGE_ZOOM)
        .build()?;
    Ok(target)
}

pub fn navigate_main_window(app: &tauri::App, target: Url) -> tauri::Result<()> {
    let window = app
        .get_webview_window("main")
        .expect("deferred main WebView was created during setup");
    let handle = app.handle().clone();
    window.with_webview(move |platform| {
        // Both calls run on the WebView's COM apartment. Settings only take
        // effect on the next navigation, so never load the app before this.
        let result = (|| -> windows_core_061::Result<()> {
            let core = unsafe { platform.controller().CoreWebView2()? };
            let settings = unsafe { core.Settings()? };
            let pinch: ICoreWebView2Settings5 = settings.cast()?;
            unsafe {
                pinch.SetIsPinchZoomEnabled(true)?;
                core.Navigate(&HSTRING::from(target.as_str()))?;
            }
            Ok(())
        })();
        match result {
            Ok(()) => tracing::info!(
                operation = "webview.gestures.initialize",
                window = "main",
                "enabled touchpad pinch before application navigation; browser zoom hotkeys remain unchanged",
            ),
            Err(error) => {
                tracing::error!(
                    operation = "webview.gestures.initialize",
                    window = "main",
                    error = %error,
                    "failed to initialize touchpad gestures before application navigation",
                );
                handle.exit(1);
            }
        }
    })
}

fn bootstrap_url(target: &Url) -> Url {
    let mut bootstrap = target.clone();
    bootstrap
        .query_pairs_mut()
        .append_pair("__spmusic_gesture_bootstrap", "1");
    bootstrap
}

// Match Tauri 2.11's get_app_url / WebviewUrl::App resolution. These APIs are
// private in Tauri; keep tests for development and bundled application URLs.
fn application_url(
    config: &Config,
    window: &WindowConfig,
    development: bool,
) -> Result<Url, tauri::Error> {
    match &window.url {
        WebviewUrl::App(path) => {
            let configured = if development {
                config.build.dev_url.as_ref()
            } else {
                match config.build.frontend_dist.as_ref() {
                    Some(FrontendDist::Url(url)) => Some(url),
                    _ => None,
                }
            };
            let base = configured.cloned().unwrap_or_else(|| {
                let scheme = if window.use_https_scheme {
                    "https"
                } else {
                    "http"
                };
                format!("{scheme}://tauri.localhost").parse().unwrap()
            });
            if path.to_str() == Some("index.html") {
                Ok(base)
            } else {
                base.join(&path.to_string_lossy())
                    .map_err(tauri::Error::InvalidUrl)
            }
        }
        WebviewUrl::External(url) | WebviewUrl::CustomProtocol(url) => Ok(url.clone()),
        _ => Err(tauri::Error::InvalidWebviewUrl(
            "unsupported main window URL".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_is_distinct_but_preserves_asset_and_ipc_origin() {
        for raw in [
            "http://localhost:4123/app/?theme=dark#player",
            "http://tauri.localhost/",
            "https://tauri.localhost/",
        ] {
            let target = Url::parse(raw).unwrap();
            let bootstrap = bootstrap_url(&target);
            assert_ne!(bootstrap, target);
            assert_eq!(bootstrap.origin(), target.origin());
            assert_eq!(bootstrap.path(), target.path());
            assert_eq!(bootstrap.fragment(), target.fragment());
            assert_eq!(
                bootstrap.query_pairs().last().unwrap().0,
                "__spmusic_gesture_bootstrap"
            );
        }
    }

    #[test]
    fn deferral_preserves_main_window_configuration() {
        let mut config = Config::default();
        let main = WindowConfig {
            visible: false,
            width: 1120.,
            ..Default::default()
        };
        config.app.windows = vec![main.clone()];
        let deferred = defer_main_window(&mut config).unwrap();
        assert!(!config.app.windows[0].create);
        assert!(deferred.create);
        assert_eq!(deferred.visible, main.visible);
        assert_eq!(deferred.width, main.width);
        assert!(defer_main_window(&mut config).is_none());
    }

    #[test]
    fn development_uses_configured_url_and_preserves_index_rule() {
        let mut config = Config::default();
        config.build.dev_url = Some("http://localhost:4123/base/".parse().unwrap());
        let mut window = WindowConfig::default();
        assert_eq!(
            application_url(&config, &window, true).unwrap().as_str(),
            "http://localhost:4123/base/"
        );
        window.url = WebviewUrl::App("nested/player.html".into());
        assert_eq!(
            application_url(&config, &window, true).unwrap().as_str(),
            "http://localhost:4123/base/nested/player.html"
        );
    }

    #[test]
    fn bundled_assets_use_windows_protocol_and_configured_scheme() {
        let mut config = Config::default();
        config.build.dev_url = Some("http://localhost:4123/".parse().unwrap());
        let mut window = WindowConfig::default();
        assert_eq!(
            application_url(&config, &window, false).unwrap().as_str(),
            "http://tauri.localhost/"
        );
        window.use_https_scheme = true;
        assert_eq!(
            application_url(&config, &window, false).unwrap().as_str(),
            "https://tauri.localhost/"
        );
        config.build.frontend_dist = Some(FrontendDist::Url(
            "https://example.com/app/".parse().unwrap(),
        ));
        assert_eq!(
            application_url(&config, &window, false).unwrap().as_str(),
            "https://example.com/app/"
        );
    }

    #[test]
    fn external_and_custom_urls_are_preserved() {
        let config = Config::default();
        for url in [
            WebviewUrl::External("https://example.com/".parse().unwrap()),
            WebviewUrl::CustomProtocol("custom://player/home".parse().unwrap()),
        ] {
            let window = WindowConfig {
                url: url.clone(),
                ..Default::default()
            };
            assert_eq!(
                application_url(&config, &window, false).unwrap().as_str(),
                match &url {
                    WebviewUrl::External(url) | WebviewUrl::CustomProtocol(url) => url.as_str(),
                    _ => unreachable!(),
                }
            );
        }
    }
}
