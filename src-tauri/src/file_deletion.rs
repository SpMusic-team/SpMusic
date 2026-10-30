use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFailure {
    pub source_path: String,
    pub code: String,
    pub message: String,
}

impl DeleteFailure {
    pub(crate) fn new(path: &str, code: &str, message: impl Into<String>) -> Self {
        Self {
            source_path: path.into(),
            code: code.into(),
            message: message.into(),
        }
    }
}

pub(crate) fn path_key(value: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        let value = value.replace('/', "\\");
        let value = if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") {
            format!("\\\\{unc}")
        } else {
            value.strip_prefix("\\\\?\\").unwrap_or(&value).to_string()
        };
        value.to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        value.to_string()
    }
}

pub(crate) fn validate_path(path: &Path) -> bool {
    path.is_absolute()
        && !path.to_string_lossy().contains('\0')
        && !path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
}

pub(crate) fn checked_regular_file(path: &Path) -> Result<PathBuf, String> {
    if !validate_path(path) {
        return Err("歌曲路径必须是规范的绝对路径".into());
    }
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("无法访问歌曲文件：{error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("只允许删除普通歌曲文件".into());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("不允许删除重解析点".into());
        }
    }
    path.canonicalize()
        .map_err(|error| format!("无法解析歌曲文件：{error}"))
}

pub(crate) fn recycle_file(path: &Path) -> Result<(), String> {
    let checked = checked_regular_file(path)?;
    recycle_checked_file(&checked)
}

#[cfg(not(target_os = "windows"))]
fn recycle_checked_file(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|error| format!("无法移入回收站：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture_root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "spmusic-recycle-fixture-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn deletion_recycles_only_synthetic_temp_file_and_reports_locked_file() {
        use std::{fs::OpenOptions, os::windows::fs::OpenOptionsExt};
        let root = fixture_root();
        let file = root.join("synthetic-recycle.mp3");
        let locked = root.join("synthetic-locked.mp3");
        fs::write(&file, b"SpMusic synthetic recycle test fixture").unwrap();
        fs::write(&locked, b"SpMusic synthetic locked test fixture").unwrap();
        let guard = OpenOptions::new()
            .read(true)
            .share_mode(0x1 | 0x2)
            .open(&locked)
            .unwrap();
        assert!(recycle_file(&locked).is_err());
        assert!(locked.is_file());
        recycle_file(&file).expect("Windows should recycle a local temporary fixture");
        assert!(!file.exists());
        assert!(recycle_file(&file).is_err()); // Missing is a failure, never invented success.
        assert!(recycle_file(&root).is_err());
        drop(guard);
        fs::remove_file(&locked).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn deletion_path_identity_handles_windows_verbatim_and_unc_names() {
        assert_eq!(
            path_key(r"\\?\C:\music\track.mp3"),
            path_key(r"C:\music\track.mp3")
        );
        assert_eq!(
            path_key(r"\\?\UNC\server\share\track.mp3"),
            path_key(r"\\server\share\track.mp3")
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn deletion_recycle_from_mta_runtime_uses_isolated_sta() {
        std::thread::spawn(|| {
            use windows::Win32::System::Com::{
                CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED,
            };
            unsafe {
                CoInitializeEx(None, COINIT_MULTITHREADED).ok().unwrap();
            }
            let root = fixture_root();
            let file = root.join("synthetic-mta-recycle.mp3");
            fs::write(&file, b"SpMusic synthetic MTA caller fixture").unwrap();
            let result = recycle_file(&file);
            unsafe {
                CoUninitialize();
            }
            result.expect("MTA audio caller must not cause RPC_E_CHANGED_MODE");
            assert!(!file.exists());
            fs::remove_dir(root).unwrap();
        })
        .join()
        .unwrap();
    }
}

#[cfg(target_os = "windows")]
fn recycle_checked_file(path: &Path) -> Result<(), String> {
    // The audio runtime may already be initialized as an MTA by CPAL. Shell
    // file operations run in their own STA while the runtime waits, retaining
    // serialization with playback and the file mutation guard.
    let path = path.to_path_buf();
    std::thread::Builder::new()
        .name("spmusic-recycle-sta".into())
        .spawn(move || recycle_on_sta(&path))
        .map_err(|error| format!("无法启动回收站：{error}"))?
        .join()
        .map_err(|_| "回收站操作意外中止".to_string())?
}

#[cfg(target_os = "windows")]
fn recycle_on_sta(path: &Path) -> Result<(), String> {
    use std::{ffi::OsString, os::windows::ffi::OsStrExt, path::Prefix};
    use windows::{
        core::PCWSTR,
        Win32::{
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{
                FileOperation, IFileOperation, IShellItem, SHCreateItemFromParsingName,
                FOFX_EARLYFAILURE, FOFX_RECYCLEONDELETE, FOF_NO_UI, FOF_WANTNUKEWARNING,
            },
        },
    };

    // Shell APIs require an ordinary DOS/UNC name rather than canonicalized
    // verbatim paths. Preserve the OS string rather than round-tripping UTF-8.
    let mut parts = path.components();
    let mut shell_path = match parts.next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::VerbatimDisk(drive) => OsString::from(format!("{}:", drive as char)),
            Prefix::VerbatimUNC(host, share) => {
                let mut value = OsString::from("\\\\");
                value.push(host);
                value.push("\\");
                value.push(share);
                value
            }
            _ => prefix.as_os_str().to_os_string(),
        },
        _ => return Err("回收站只接受绝对文件路径".into()),
    };
    shell_path.push(parts.as_path());
    let wide: Vec<u16> = shell_path.encode_wide().chain(Some(0)).collect();
    struct ComApartment;
    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    let result = unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|error| format!("无法初始化回收站：{error}"))?;
        let _apartment = ComApartment;
        (|| -> windows::core::Result<()> {
            let operation: IFileOperation =
                CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)?;
            // RECYCLEONDELETE fails if recycling is unavailable. No permanent
            // delete fallback is allowed, including for network/removable drives.
            operation.SetOperationFlags(
                FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE | FOF_NO_UI | FOF_WANTNUKEWARNING,
            )?;
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)?;
            operation.DeleteItem(&item, None)?;
            operation.PerformOperations()?;
            if operation.GetAnyOperationsAborted()?.as_bool() {
                return Err(windows::core::Error::from_win32());
            }
            Ok(())
        })()
    };
    result.map_err(|error| format!("无法移入回收站：{error}"))
}
