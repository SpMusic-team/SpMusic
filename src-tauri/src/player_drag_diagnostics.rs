use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use tauri::Manager;

const MAX_PAYLOAD_BYTES: usize = 5_000_000;
static EXPORT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerDragDiagnosticsExportInput {
    pub payload: String,
}

/// Export only on an explicit user action; the drag hot path never writes files.
#[tauri::command]
pub async fn player_drag_diagnostics_export(
    app: tauri::AppHandle,
    input: PlayerDragDiagnosticsExportInput,
) -> Result<String, String> {
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|_| "无法获取诊断日志目录。".to_string())?
        .join("drag-diagnostics");
    tauri::async_runtime::spawn_blocking(move || export_payload(&directory, &input.payload))
        .await
        .map_err(|_| "诊断日志导出任务失败，请重试。".to_string())?
        .map(|path| path.to_string_lossy().into_owned())
}

fn validate_payload(payload: &str) -> Result<(), String> {
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err("诊断日志超过 5,000,000 字节，请减少记录后重试。".to_string());
    }
    let report: serde_json::Value =
        serde_json::from_str(payload).map_err(|_| "诊断日志不是有效的 JSON。".to_string())?;
    let Some(report) = report.as_object() else {
        return Err("诊断日志必须是 JSON 对象。".to_string());
    };
    if report
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        return Err("诊断日志版本不受支持。".to_string());
    }
    Ok(())
}

fn export_payload(directory: &Path, payload: &str) -> Result<PathBuf, String> {
    validate_payload(payload)?;
    fs::create_dir_all(directory).map_err(|_| "无法创建诊断日志目录。".to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "无法获取诊断日志时间。".to_string())?
        .as_millis();

    for _ in 0..16 {
        let sequence = EXPORT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!(
            "player-drag-{timestamp}-{}-{sequence}.json",
            std::process::id()
        ));
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("无法创建诊断日志文件。".to_string()),
        };
        if file
            .write_all(payload.as_bytes())
            .and_then(|_| file.sync_all())
            .is_err()
        {
            drop(file);
            // Only remove the partial file exclusively created by this call.
            let _ = fs::remove_file(&path);
            return Err("诊断日志写入失败，请重试。".to_string());
        }
        return Ok(path);
    }
    Err("无法分配唯一的诊断日志文件名，请重试。".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let sequence = EXPORT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "spmusic-drag-export-test-{}-{}-{sequence}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            // Test fixtures are flat and exclusively owned; never recurse.
            for entry in fs::read_dir(&self.0).unwrap() {
                fs::remove_file(entry.unwrap().path()).unwrap();
            }
            fs::remove_dir(&self.0).unwrap();
        }
    }

    #[test]
    fn rejects_invalid_shape_version_and_utf8_byte_overflow_before_creating_directory() {
        let fixture = TestDirectory::new();
        let destination = fixture.0.join("should-not-exist");
        for payload in ["invalid", "[]", "{}", "{\"schemaVersion\":2}"] {
            assert!(export_payload(&destination, payload).is_err());
            assert!(!destination.exists());
        }
        let payload = format!(
            "{{\"schemaVersion\":1,\"data\":\"{}\"}}",
            "中".repeat(1_666_667)
        );
        assert!(payload.chars().count() < MAX_PAYLOAD_BYTES);
        assert!(validate_payload(&payload).is_err());
    }

    #[test]
    fn concurrent_exports_keep_each_report_and_never_overwrite() {
        let fixture = TestDirectory::new();
        let results = std::thread::scope(|scope| {
            let tasks: Vec<_> = (0..8)
                .map(|index| {
                    let directory = &fixture.0;
                    scope.spawn(move || {
                        let payload = format!("{{\"schemaVersion\":1,\"sample\":{index}}}");
                        let path = export_payload(directory, &payload).unwrap();
                        assert_eq!(fs::read_to_string(&path).unwrap(), payload);
                        path
                    })
                })
                .collect();
            tasks
                .into_iter()
                .map(|task| task.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_eq!(
            results
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            8
        );
        assert!(results
            .iter()
            .all(|path| path.parent() == Some(fixture.0.as_path())));
    }

    #[test]
    fn reports_io_failure_instead_of_returning_success() {
        let fixture = TestDirectory::new();
        let blocked_directory = fixture.0.join("file-instead-of-directory");
        fs::write(&blocked_directory, "keep").unwrap();
        assert!(export_payload(&blocked_directory, "{\"schemaVersion\":1}").is_err());
        assert_eq!(fs::read_to_string(blocked_directory).unwrap(), "keep");
    }
}
