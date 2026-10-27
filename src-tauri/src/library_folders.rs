use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

const REGISTRY_FILE: &str = "library-folders.v1.json";
const REGISTRY_VERSION: u8 = 2;
const MAX_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectorySelectionRule {
    pub relative_path: String,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RootSelection {
    pub path: String,
    pub selected: bool,
    pub directory_rules: Vec<DirectorySelectionRule>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolderSettings {
    pub revision: u64,
    pub roots: Vec<RootSelection>,
}

// Folder scans contain the whole tree. Only expose tracks whose parent
// directory is selected by the same longest-rule match used in the UI.
pub(crate) fn selected_folder_track_paths(settings: &LibraryFolderSettings) -> Vec<String> {
    let mut paths = Vec::new();
    for root in &settings.roots {
        if !root.selected && !root.directory_rules.iter().any(|rule| rule.selected) {
            continue;
        }
        if let Ok(playlist) = crate::audio::load_library_folder(Path::new(&root.path)) {
            let scan_root = Path::new(&playlist.source_path);
            for track in playlist.tracks {
                if track_is_selected(root, scan_root, Path::new(&track.source_path)) {
                    paths.push(track.source_path);
                }
            }
        }
    }
    paths
}

fn track_is_selected(root: &RootSelection, scan_root: &Path, track: &Path) -> bool {
    let Some(directory) = track.parent() else {
        return false;
    };
    let Ok(relative) = directory.strip_prefix(scan_root) else {
        return false;
    };
    let path = relative.to_string_lossy().replace('\\', "/").to_lowercase();
    let mut selected = root.selected;
    let mut longest = 0;
    for rule in &root.directory_rules {
        let candidate = rule.relative_path.replace('\\', "/").to_lowercase();
        if candidate.len() > longest
            && (path == candidate
                || path
                    .strip_prefix(&candidate)
                    .is_some_and(|rest| rest.starts_with('/')))
        {
            selected = rule.selected;
            longest = candidate.len();
        }
    }
    selected
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaceFoldersInput {
    pub expected_revision: u64,
    pub roots: Vec<RootSelection>,
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

    pub(crate) fn directory(message: impl Into<String>) -> Self {
        Self {
            code: "DIRECTORY_READ_ERROR",
            message: message.into(),
            recoverable: true,
        }
    }

    fn conflict() -> Self {
        Self {
            code: "LIBRARY_SETTINGS_CONFLICT",
            message: "Library folders changed; reload the current settings before saving".into(),
            recoverable: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyStoredFolders {
    version: u8,
    folders: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredFolders {
    version: u8,
    revision: u64,
    roots: Vec<RootSelection>,
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

    pub fn get(&self) -> Result<LibraryFolderSettings, LibraryError> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        self.read()
    }

    pub fn add(&self, path: &str) -> Result<LibraryFolderSettings, LibraryError> {
        let normalized = normalize_folder_path(path)?;
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut current = self.read()?;
        if !current
            .roots
            .iter()
            .any(|existing| folder_key(&existing.path) == folder_key(&normalized))
        {
            current.roots.push(RootSelection {
                path: normalized,
                selected: true,
                directory_rules: vec![],
            });
            current.revision = next_revision(current.revision)?;
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
        let current = self.read()?;
        self.write(&LibraryFolderSettings {
            // Clear is a barrier even when the current root list is empty.
            revision: next_revision(current.revision)?,
            roots: vec![],
        })
    }

    pub fn replace(
        &self,
        input: ReplaceFoldersInput,
    ) -> Result<LibraryFolderSettings, LibraryError> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let current = self.read()?;
        if input.expected_revision != current.revision {
            return Err(LibraryError::conflict());
        }
        let mut roots = Vec::with_capacity(input.roots.len());
        let mut keys = HashSet::new();
        for mut root in input.roots {
            let lexical = lexical_folder_path(&root.path)?;
            // Stored paths remain editable when a drive is disconnected or a
            // directory can no longer be accessed. New roots must be usable.
            root.path = if let Some(existing) = current
                .roots
                .iter()
                .find(|saved| folder_key(&saved.path) == folder_key(&lexical))
            {
                existing.path.clone()
            } else {
                crate::library_folder_directories::validate_directory_path(Path::new(&lexical))?;
                Path::new(&lexical)
                    .canonicalize()
                    .map_err(|error| {
                        LibraryError::invalid(format!("Cannot access library folder: {error}"))
                    })?
                    .to_string_lossy()
                    .into_owned()
            };
            normalize_rules(&mut root.directory_rules)?;
            if keys.insert(folder_key(&root.path)) {
                roots.push(root);
            }
        }
        if roots == current.roots {
            return Ok(current);
        }
        let replacement = LibraryFolderSettings {
            revision: next_revision(current.revision)?,
            roots,
        };
        self.write(&replacement)?;
        Ok(replacement)
    }

    fn read(&self) -> Result<LibraryFolderSettings, LibraryError> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(LibraryFolderSettings::default());
            }
            Err(error) => {
                return Err(LibraryError::storage(format!(
                    "Cannot read saved library folders: {error}"
                )));
            }
        };
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|error| {
            LibraryError::storage(format!("Saved library folders are invalid: {error}"))
        })?;
        let settings = match value.get("version").and_then(serde_json::Value::as_u64) {
            Some(1) => {
                let stored: LegacyStoredFolders = serde_json::from_value(value)
                    .map_err(|error| LibraryError::storage(error.to_string()))?;
                LibraryFolderSettings {
                    revision: 0,
                    roots: stored
                        .folders
                        .into_iter()
                        .map(|path| RootSelection {
                            path,
                            selected: true,
                            directory_rules: vec![],
                        })
                        .collect(),
                }
            }
            Some(2) => {
                let stored: StoredFolders = serde_json::from_value(value)
                    .map_err(|error| LibraryError::storage(error.to_string()))?;
                if stored.revision > MAX_REVISION {
                    return Err(LibraryError::storage(
                        "Saved library revision exceeds the supported range",
                    ));
                }
                LibraryFolderSettings {
                    revision: stored.revision,
                    roots: stored.roots,
                }
            }
            _ => {
                return Err(LibraryError::storage(
                    "Unsupported library folder registry version",
                ))
            }
        };
        for root in &settings.roots {
            lexical_folder_path(&root.path)
                .map_err(|error| LibraryError::storage(error.message))?;
            let mut rules = root.directory_rules.clone();
            normalize_rules(&mut rules).map_err(|error| LibraryError::storage(error.message))?;
        }
        // Retain unavailable folders so a temporary drive disconnect does not
        // silently erase the user's selection.
        Ok(settings)
    }

    fn write(&self, folders: &LibraryFolderSettings) -> Result<(), LibraryError> {
        let bytes = serde_json::to_vec_pretty(&StoredFolders {
            version: REGISTRY_VERSION,
            revision: folders.revision,
            roots: folders.roots.clone(),
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
    let input = lexical_folder_path(input)?;
    let path = Path::new(&input);
    if path.exists() && !path.is_dir() {
        return Err(LibraryError::invalid(
            "Library folder path is not a directory",
        ));
    }
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Ok(path.to_string_lossy().into_owned())
}

fn lexical_folder_path(input: &str) -> Result<String, LibraryError> {
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
    Ok(path
        .components()
        .collect::<PathBuf>()
        .to_string_lossy()
        .into_owned())
}

fn normalize_rules(rules: &mut [DirectorySelectionRule]) -> Result<(), LibraryError> {
    let mut keys = HashSet::new();
    for rule in rules.iter_mut() {
        let relative = rule.relative_path.replace('\\', "/");
        if relative.is_empty()
            || relative.contains(':')
            || relative.contains('\0')
            || relative
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return Err(LibraryError::invalid(
                "Directory selection rules must use non-empty relative descendant paths",
            ));
        }
        if !keys.insert(folder_key(&relative)) {
            return Err(LibraryError::invalid("Duplicate directory selection rule"));
        }
        rule.relative_path = relative;
    }
    rules.sort_by_key(|rule| folder_key(&rule.relative_path));
    Ok(())
}

fn next_revision(revision: u64) -> Result<u64, LibraryError> {
    revision
        .checked_add(1)
        .filter(|value| *value <= MAX_REVISION)
        .ok_or_else(|| LibraryError::storage("Library revision limit reached"))
}

pub(crate) fn folder_key(path: &str) -> String {
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

    #[test]
    fn folder_scan_authorization_applies_longest_selection_rule() {
        let root = test_dir();
        for directory in ["excluded", "excluded/allowed", "excluded-sibling", "chosen"] {
            fs::create_dir_all(root.join(directory)).unwrap();
        }
        for file in [
            "root.mp3",
            "excluded/no.mp3",
            "excluded/allowed/yes.mp3",
            "excluded-sibling/yes.mp3",
            "chosen/yes.mp3",
        ] {
            fs::write(root.join(file), b"fixture").unwrap();
        }
        let mut settings = LibraryFolderSettings {
            revision: 0,
            roots: vec![RootSelection {
                path: root.to_string_lossy().into_owned(),
                selected: true,
                directory_rules: vec![
                    DirectorySelectionRule {
                        relative_path: "excluded".into(),
                        selected: false,
                    },
                    DirectorySelectionRule {
                        relative_path: "excluded/allowed".into(),
                        selected: true,
                    },
                ],
            }],
        };
        let scanned = selected_folder_track_paths(&settings);
        let contains = |relative: &str| {
            let wanted = root
                .join(relative)
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .into_owned();
            scanned.iter().any(|path| path == &wanted)
        };
        assert!(contains("root.mp3"));
        assert!(!contains("excluded/no.mp3"));
        assert!(contains("excluded/allowed/yes.mp3"));
        assert!(contains("excluded-sibling/yes.mp3"));
        settings.roots[0].selected = false;
        settings.roots[0].directory_rules.push(DirectorySelectionRule {
            relative_path: "chosen".into(),
            selected: true,
        });
        let scanned = selected_folder_track_paths(&settings);
        assert_eq!(scanned.len(), 2);
        assert!(scanned
            .iter()
            .any(|path| path.ends_with("yes.mp3") && path.contains("allowed")));
        assert!(scanned
            .iter()
            .any(|path| path.ends_with("yes.mp3") && path.contains("chosen")));
        assert!(!track_is_selected(
            &settings.roots[0],
            &root,
            &root.with_file_name("outside.mp3")
        ));
        fs::remove_dir_all(root).unwrap();
    }

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
        assert_eq!(registry.add(&folder_str).unwrap().roots.len(), 1);
        assert_eq!(registry.add(&folder_str).unwrap().revision, 1);
        let reopened = LibraryFolderRegistry::new(&root);
        assert_eq!(reopened.get().unwrap().roots.len(), 1);
        reopened.clear().unwrap();
        assert!(registry.get().unwrap().roots.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_folder_remains_selected_and_corruption_is_not_overwritten() {
        let root = test_dir();
        let folder = root.join("missing");
        let registry = LibraryFolderRegistry::new(&root);
        registry.add(&folder.to_string_lossy()).unwrap();
        assert_eq!(registry.get().unwrap().roots.len(), 1);
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
        assert_eq!(registry.get().unwrap().roots.len(), 8);
        assert_eq!(registry.get().unwrap().revision, 8);
        fs::remove_dir_all(root).unwrap();
    }

    fn replacement(settings: &LibraryFolderSettings) -> ReplaceFoldersInput {
        ReplaceFoldersInput {
            expected_revision: settings.revision,
            roots: settings.roots.clone(),
        }
    }

    #[test]
    fn migrates_v1_offline_roots_and_writes_v2_without_changing_storage_path() {
        let root = test_dir();
        let registry = LibraryFolderRegistry::new(&root);
        let missing = root.join("offline").to_string_lossy().into_owned();
        fs::write(
            &registry.path,
            serde_json::to_vec(&LegacyStoredFolders {
                version: 1,
                folders: vec![missing.clone()],
            })
            .unwrap(),
        )
        .unwrap();
        let settings = registry.get().unwrap();
        assert_eq!(settings.revision, 0);
        assert_eq!(settings.roots[0].path, missing);
        assert!(settings.roots[0].selected);
        assert!(settings.roots[0].directory_rules.is_empty());
        let mut input = replacement(&settings);
        input.roots[0].selected = false;
        assert_eq!(registry.replace(input).unwrap().revision, 1);
        let stored: serde_json::Value =
            serde_json::from_slice(&fs::read(&registry.path).unwrap()).unwrap();
        assert_eq!(stored["version"], 2);
        assert_eq!(stored["roots"][0]["selected"], false);
        assert!(stored.get("folders").is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preserves_unordered_descendant_overrides_and_disabled_roots_on_reopen() {
        let root = test_dir();
        let registry = LibraryFolderRegistry::new(&root);
        let saved = registry.add(&root.to_string_lossy()).unwrap();
        let mut input = replacement(&saved);
        input.roots[0].selected = false;
        input.roots[0].directory_rules = vec![
            DirectorySelectionRule {
                relative_path: "parent/child".into(),
                selected: true,
            },
            DirectorySelectionRule {
                relative_path: "parent".into(),
                selected: false,
            },
        ];
        let saved = registry.replace(input).unwrap();
        assert_eq!(saved.revision, 2);
        assert_eq!(saved.roots[0].directory_rules[0].relative_path, "parent");
        assert!(saved.roots[0].directory_rules[1].selected);
        assert!(!saved.roots[0].selected);
        assert_eq!(LibraryFolderRegistry::new(&root).get().unwrap(), saved);
        assert_eq!(registry.replace(replacement(&saved)).unwrap().revision, 2);
        let json = serde_json::to_value(saved).unwrap();
        assert!(json["roots"][0].get("directoryRules").is_some());
        assert_eq!(
            json["roots"][0]["directoryRules"][1]["relativePath"],
            "parent/child"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_rules_or_any_invalid_new_root_leave_entire_snapshot_unchanged() {
        let root = test_dir();
        let registry = LibraryFolderRegistry::new(&root);
        let saved = registry.add(&root.to_string_lossy()).unwrap();
        let before = fs::read(&registry.path).unwrap();
        for path in [
            "",
            "..",
            "../escape",
            "a/../b",
            "/absolute",
            "C:\\absolute",
            "a//b",
            "a/./b",
        ] {
            let mut input = replacement(&saved);
            input.roots[0].directory_rules = vec![DirectorySelectionRule {
                relative_path: path.into(),
                selected: false,
            }];
            assert_eq!(
                registry.replace(input).unwrap_err().code,
                "INVALID_PATH",
                "{path}"
            );
            assert_eq!(fs::read(&registry.path).unwrap(), before);
        }
        let mut input = replacement(&saved);
        input.roots[0].selected = false;
        input.roots.push(RootSelection {
            path: root.join("nonexistent").to_string_lossy().into_owned(),
            selected: true,
            directory_rules: vec![],
        });
        assert!(registry.replace(input).is_err());
        assert_eq!(registry.get().unwrap(), saved);
        assert_eq!(fs::read(&registry.path).unwrap(), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replaces_new_roots_normalizes_rules_dedupes_and_preserves_disabled_selection() {
        let root = test_dir();
        let registry = LibraryFolderRegistry::new(&root);
        let path = root.to_string_lossy().into_owned();
        let saved = registry
            .replace(ReplaceFoldersInput {
                expected_revision: 0,
                roots: vec![
                    RootSelection {
                        path: path.clone(),
                        selected: false,
                        directory_rules: vec![DirectorySelectionRule {
                            relative_path: "parent\\child".into(),
                            selected: true,
                        }],
                    },
                    RootSelection {
                        path,
                        selected: true,
                        directory_rules: vec![],
                    },
                ],
            })
            .unwrap();
        assert_eq!(saved.roots.len(), 1);
        assert_eq!(saved.revision, 1);
        assert_eq!(
            saved.roots[0].path,
            root.canonicalize().unwrap().to_string_lossy()
        );
        assert!(!saved.roots[0].selected);
        assert_eq!(
            saved.roots[0].directory_rules[0].relative_path,
            "parent/child"
        );
        let mut duplicate_rules = replacement(&saved);
        duplicate_rules.roots[0]
            .directory_rules
            .push(DirectorySelectionRule {
                relative_path: "parent/child".into(),
                selected: false,
            });
        assert_eq!(
            registry.replace(duplicate_rules).unwrap_err().code,
            "INVALID_PATH"
        );
        assert_eq!(registry.get().unwrap(), saved);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_add_invalidates_old_editor_revision() {
        let root = test_dir();
        let registry = LibraryFolderRegistry::new(&root);
        let draft = registry.get().unwrap();
        registry.add(&root.to_string_lossy()).unwrap();
        assert_eq!(
            registry.replace(replacement(&draft)).unwrap_err().code,
            "LIBRARY_SETTINGS_CONFLICT"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn offline_root_can_be_disabled_and_removed_then_readded_with_new_defaults() {
        let root = test_dir();
        let music = root.join("music");
        fs::create_dir(&music).unwrap();
        let registry = LibraryFolderRegistry::new(&root);
        let saved = registry.add(&music.to_string_lossy()).unwrap();
        fs::remove_dir(&music).unwrap();
        let mut input = replacement(&saved);
        input.roots[0].selected = false;
        input.roots[0].directory_rules = vec![DirectorySelectionRule {
            relative_path: "child".into(),
            selected: true,
        }];
        let disabled = registry.replace(input).unwrap();
        assert_eq!(registry.get().unwrap(), disabled);
        let removed = registry
            .replace(ReplaceFoldersInput {
                expected_revision: disabled.revision,
                roots: vec![],
            })
            .unwrap();
        assert!(removed.roots.is_empty());
        fs::create_dir(&music).unwrap();
        let added = registry.add(&music.to_string_lossy()).unwrap();
        assert!(added.roots[0].selected);
        assert!(added.roots[0].directory_rules.is_empty());
        assert_eq!(added.revision, 4);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clear_is_a_revision_barrier_and_stale_draft_cannot_restore_removed_roots() {
        let root = test_dir();
        let registry = LibraryFolderRegistry::new(&root);
        let saved = registry.add(&root.to_string_lossy()).unwrap();
        registry.clear().unwrap();
        assert_eq!(
            registry.replace(replacement(&saved)).unwrap_err().code,
            "LIBRARY_SETTINGS_CONFLICT"
        );
        assert!(registry.get().unwrap().roots.is_empty());
        assert_eq!(registry.get().unwrap().revision, 2);
        registry.clear().unwrap();
        assert_eq!(registry.get().unwrap().revision, 3);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn simultaneous_replacements_have_exactly_one_cas_winner() {
        let root = test_dir();
        let registry = Arc::new(LibraryFolderRegistry::new(&root));
        let saved = registry.add(&root.to_string_lossy()).unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let workers = (0..2)
            .map(|index| {
                let registry = Arc::clone(&registry);
                let barrier = Arc::clone(&barrier);
                let mut input = replacement(&saved);
                input.roots[0].directory_rules.push(DirectorySelectionRule {
                    relative_path: format!("child-{index}"),
                    selected: false,
                });
                std::thread::spawn(move || {
                    barrier.wait();
                    registry.replace(input)
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let results = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|value| value.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(
                    |value| matches!(value, Err(error) if error.code == "LIBRARY_SETTINGS_CONFLICT")
                )
                .count(),
            1
        );
        assert_eq!(registry.get().unwrap().revision, 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn failed_atomic_replace_preserves_bytes_and_revision_and_cleans_temporary_file() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = test_dir();
        let registry = LibraryFolderRegistry::new(&root);
        let saved = registry.add(&root.to_string_lossy()).unwrap();
        let before = fs::read(&registry.path).unwrap();
        let guard = OpenOptions::new()
            .read(true)
            .share_mode(0x1 | 0x2)
            .open(&registry.path)
            .unwrap();
        let mut input = replacement(&saved);
        input.roots[0].selected = false;
        assert_eq!(
            registry.replace(input).unwrap_err().code,
            "LIBRARY_STORAGE_ERROR"
        );
        assert_eq!(fs::read(&registry.path).unwrap(), before);
        assert_eq!(registry.get().unwrap(), saved);
        assert!(!registry.path.with_extension("json.tmp").exists());
        drop(guard);
        fs::remove_dir_all(root).unwrap();
    }
}
