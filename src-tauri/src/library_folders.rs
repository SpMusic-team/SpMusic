use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

const REGISTRY_FILE: &str = "library-folders.v1.json";
const REGISTRY_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolders {
    pub folders: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryError {
    pub code: &'static str,
    pub message: String,
    pub recoverable: bool,
}

impl LibraryError {
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "INVALID_PATH",
            message: message.into(),
            recoverable: true,
        }
    }

    pub(crate) fn storage(message: impl Into<String>) -> Self {
        Self {
            code: "LIBRARY_STORAGE_ERROR",
            message: message.into(),
            recoverable: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredFolders {
    version: u8,
    folders: Vec<String>,
}

pub struct LibraryFolderRegistry {
    path: PathBuf,
    // Read-modify-write and clear must be one process-wide transaction.
    lock: Mutex<()>,
}

impl LibraryFolderRegistry {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join(REGISTRY_FILE),
            lock: Mutex::new(()),
        }
    }

    pub fn get(&self) -> Result<LibraryFolders, LibraryError> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        self.read()
    }

    pub fn add(&self, path: &str) -> Result<LibraryFolders, LibraryError> {
        let normalized = normalize_folder_path(path)?;
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut current = self.read()?;
        if !current
            .folders
            .iter()
            .any(|existing| folder_key(existing) == folder_key(&normalized))
        {
            current.folders.push(normalized);
            self.write(&current)?;
        }
        Ok(current)
    }

    pub fn clear(&self) -> Result<(), LibraryError> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        // A successful clear must leave an explicit empty registry. Removing the
        // file could expose an old value after a failed replacement or backup.
        self.write(&LibraryFolders { folders: vec![] })
    }

    fn read(&self) -> Result<LibraryFolders, LibraryError> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(LibraryFolders { folders: vec![] });
            }
            Err(error) => {
                return Err(LibraryError::storage(format!(
                    "Cannot read saved library folders: {error}"
                )));
            }
        };
        let stored: StoredFolders = serde_json::from_slice(&bytes).map_err(|error| {
            LibraryError::storage(format!("Saved library folders are invalid: {error}"))
        })?;
        if stored.version != REGISTRY_VERSION {
            return Err(LibraryError::storage(format!(
                "Unsupported library folder registry version: {}",
                stored.version
            )));
        }
        // Retain unavailable folders so a temporary drive disconnect does not
        // silently erase the user's selection.
        Ok(LibraryFolders {
            folders: stored.folders,
        })
    }

    fn write(&self, folders: &LibraryFolders) -> Result<(), LibraryError> {
        let bytes = serde_json::to_vec_pretty(&StoredFolders {
            version: REGISTRY_VERSION,
            folders: folders.folders.clone(),
        })
        .map_err(|error| LibraryError::storage(error.to_string()))?;
        let temporary = self.path.with_extension("json.tmp");
        let result = (|| -> std::io::Result<()> {
            let mut file = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            replace_file(&temporary, &self.path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
            .map_err(|error| LibraryError::storage(format!("Cannot save library folders: {error}")))
    }
}

pub fn normalize_folder_path(input: &str) -> Result<String, LibraryError> {
    let input = input.trim();
    if input.is_empty() {
        return Err(LibraryError::invalid("Library folder path is empty"));
    }
    let path = Path::new(input);
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(LibraryError::invalid(
            "Library folder path must be absolute and normalized",
        ));
    }
    if path.exists() && !path.is_dir() {
        return Err(LibraryError::invalid(
            "Library folder path is not a directory",
        ));
    }
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Ok(path.to_string_lossy().into_owned())
}

fn folder_key(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        path.to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_string()
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
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
pub(crate) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::Arc,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn test_dir() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "spmusic-library-folders-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn add_persists_dedupes_and_clear_survives_reopen() {
        let root = test_dir();
        let folder = root.join("music");
        fs::create_dir(&folder).unwrap();
        let registry = LibraryFolderRegistry::new(&root);
        let folder_str = folder.to_string_lossy();
        assert_eq!(registry.add(&folder_str).unwrap().folders.len(), 1);
        assert_eq!(registry.add(&folder_str).unwrap().folders.len(), 1);
        let reopened = LibraryFolderRegistry::new(&root);
        assert_eq!(reopened.get().unwrap().folders.len(), 1);
        reopened.clear().unwrap();
        assert!(registry.get().unwrap().folders.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_folder_remains_selected_and_corruption_is_not_overwritten() {
        let root = test_dir();
        let folder = root.join("missing");
        let registry = LibraryFolderRegistry::new(&root);
        registry.add(&folder.to_string_lossy()).unwrap();
        assert_eq!(registry.get().unwrap().folders.len(), 1);
        fs::write(&registry.path, b"invalid json").unwrap();
        assert_eq!(
            registry.add(&folder.to_string_lossy()).unwrap_err().code,
            "LIBRARY_STORAGE_ERROR"
        );
        assert_eq!(fs::read(&registry.path).unwrap(), b"invalid json");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_adds_do_not_lose_folders() {
        let root = test_dir();
        let registry = Arc::new(LibraryFolderRegistry::new(&root));
        let handles = (0..8)
            .map(|index| {
                let registry = Arc::clone(&registry);
                let folder = root.join(format!("music-{index}"));
                std::thread::spawn(move || registry.add(&folder.to_string_lossy()).unwrap())
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(registry.get().unwrap().folders.len(), 8);
        fs::remove_dir_all(root).unwrap();
    }
}
