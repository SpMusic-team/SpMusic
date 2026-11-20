use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::library_folders::LibraryError;

// A leaf check must not turn expanding one node into an unbounded scan of
// every file in each child. Unknown remains expandable in the frontend.
const CHILD_PROBE_LIMIT: usize = 256;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListFolderDirectoriesInput {
    pub root_path: String,
    pub directory_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryChildren {
    pub root_path: String,
    pub directory_path: String,
    pub children: Vec<DirectoryChild>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryChild {
    pub path: String,
    pub name: String,
    pub has_children: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_error: Option<LibraryError>,
}

/// Reject links/reparse points in every component before canonicalization.
/// This also rejects a link that targets a location inside the selected root.
pub(crate) fn validate_directory_path(path: &Path) -> Result<(), LibraryError> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(LibraryError::invalid(
            "Directory path must be absolute and normalized",
        ));
    }
    let mut current = PathBuf::new();
    for part in path.components() {
        current.push(part.as_os_str());
        // A Windows prefix alone (C:) is not an absolute filesystem entry.
        if matches!(part, Component::Prefix(_)) {
            continue;
        }
        let metadata = fs::symlink_metadata(&current).map_err(|error| {
            LibraryError::directory(format!("Cannot access directory: {error}"))
        })?;
        if is_link(&metadata) {
            return Err(LibraryError::invalid(
                "Linked directories and reparse points cannot be browsed",
            ));
        }
        if !metadata.is_dir() {
            return Err(LibraryError::invalid("Directory path is not a directory"));
        }
    }
    Ok(())
}

fn is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

pub fn list_folder_directories(
    input: ListFolderDirectoriesInput,
) -> Result<DirectoryChildren, LibraryError> {
    let root = Path::new(&input.root_path);
    let directory = Path::new(&input.directory_path);
    validate_directory_path(root)?;
    validate_directory_path(directory)?;
    let root = root.canonicalize().map_err(|error| {
        LibraryError::directory(format!("Cannot access root directory: {error}"))
    })?;
    let directory = directory
        .canonicalize()
        .map_err(|error| LibraryError::directory(format!("Cannot access directory: {error}")))?;
    if !directory.starts_with(&root) {
        return Err(LibraryError::invalid(
            "Directory path is outside the selected root",
        ));
    }
    let entries = fs::read_dir(&directory)
        .map_err(|error| LibraryError::directory(format!("Cannot read directory: {error}")))?;
    let mut children = vec![];
    for entry in entries {
        let entry = entry.map_err(|error| {
            LibraryError::directory(format!("Cannot enumerate directory: {error}"))
        })?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            LibraryError::directory(format!("Cannot inspect directory entry: {error}"))
        })?;
        if !metadata.is_dir() || is_link(&metadata) {
            continue;
        }
        let (has_children, read_error) = match probe_children(&path, &root) {
            Ok(value) => (Some(value), None),
            Err(error) => (None, Some(error)),
        };
        children.push(DirectoryChild {
            path: path.to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            has_children,
            read_error,
        });
    }
    children.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(DirectoryChildren {
        root_path: root.to_string_lossy().into_owned(),
        directory_path: directory.to_string_lossy().into_owned(),
        children,
    })
}

fn probe_children(path: &Path, root: &Path) -> Result<bool, LibraryError> {
    validate_directory_path(path)?;
    let canonical = path.canonicalize().map_err(|error| {
        LibraryError::directory(format!("Cannot inspect child directory: {error}"))
    })?;
    if !canonical.starts_with(root) {
        return Err(LibraryError::invalid(
            "Child directory is outside the selected root",
        ));
    }
    let entries = fs::read_dir(path).map_err(|error| {
        LibraryError::directory(format!("Cannot read child directory: {error}"))
    })?;
    for (index, entry) in entries.enumerate() {
        if index >= CHILD_PROBE_LIMIT {
            return Err(LibraryError {
                code: "DIRECTORY_PROBE_LIMIT",
                message: "Expand this directory to inspect its children".into(),
                recoverable: true,
            });
        }
        let entry = entry.map_err(|error| {
            LibraryError::directory(format!("Cannot enumerate child directory: {error}"))
        })?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| {
            LibraryError::directory(format!("Cannot inspect child entry: {error}"))
        })?;
        if metadata.is_dir() && !is_link(&metadata) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "spmusic-directory-tree-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        root
    }

    fn list(root: &Path, directory: &Path) -> Result<DirectoryChildren, LibraryError> {
        list_folder_directories(ListFolderDirectoriesInput {
            root_path: root.to_string_lossy().into_owned(),
            directory_path: directory.to_string_lossy().into_owned(),
        })
    }

    #[test]
    fn retains_empty_directories_and_probes_only_one_level() {
        let root = fixture();
        fs::create_dir(root.join("empty")).unwrap();
        fs::create_dir_all(root.join("parent/deeper/leaf")).unwrap();
        fs::write(root.join("broken.mp3"), b"not audio").unwrap();
        let result = list(&root, &root).unwrap();
        assert_eq!(result.children.len(), 2);
        assert_eq!(result.children[0].name, "empty");
        assert_eq!(result.children[0].has_children, Some(false));
        assert_eq!(result.children[1].has_children, Some(true));
        assert!(list(&root, &root.join("empty"))
            .unwrap()
            .children
            .is_empty());
        let json = serde_json::to_value(result).unwrap();
        assert!(json["children"][0].get("readError").is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bounded_probe_is_unknown_and_never_a_false_leaf() {
        let root = fixture();
        let child = root.join("many-files");
        fs::create_dir(&child).unwrap();
        for index in 0..=CHILD_PROBE_LIMIT {
            fs::write(child.join(format!("{index}.mp3")), []).unwrap();
        }
        let result = list(&root, &root).unwrap();
        assert_eq!(result.children[0].has_children, None);
        assert_eq!(
            result.children[0].read_error.as_ref().unwrap().code,
            "DIRECTORY_PROBE_LIMIT"
        );
        assert!(list(&root, &child).unwrap().children.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_escape_parent_components_and_missing_root_with_recoverable_errors() {
        let root = fixture();
        let outside = fixture();
        assert_eq!(list(&root, &outside).unwrap_err().code, "INVALID_PATH");
        assert_eq!(
            list(&root, &root.join("..")).unwrap_err().code,
            "INVALID_PATH"
        );
        let error = list(&root.join("missing"), &root).unwrap_err();
        assert_eq!(error.code, "DIRECTORY_READ_ERROR");
        assert!(error.recoverable);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn excludes_junctions_and_rejects_linked_ancestor_paths() {
        let root = fixture();
        let outside = fixture();
        fs::create_dir(outside.join("child")).unwrap();
        // Junction creation needs no symbolic-link privilege on Windows.
        let link = root.join("junction");
        let result = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(list(&root, &root).unwrap().children.is_empty());
        assert_eq!(
            list(&root, &link.join("child")).unwrap_err().code,
            "INVALID_PATH"
        );
        assert_eq!(list(&link, &link).unwrap_err().code, "INVALID_PATH");
        let registry = crate::library_folders::LibraryFolderRegistry::new(&root);
        let error = registry
            .replace(crate::library_folders::ReplaceFoldersInput {
                expected_revision: 0,
                roots: vec![crate::library_folders::RootSelection {
                    path: link.to_string_lossy().into_owned(),
                    selected: true,
                    directory_rules: vec![],
                }],
            })
            .unwrap_err();
        assert_eq!(error.code, "INVALID_PATH");
        fs::remove_dir(&link).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn inaccessible_child_is_unknown_and_root_read_failure_is_recoverable() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = fixture();
        let child = root.join("locked");
        fs::create_dir(&child).unwrap();
        let guard = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .custom_flags(0x02000000)
            .open(&child)
            .unwrap();
        let result = list(&root, &root).unwrap();
        assert_eq!(result.children.len(), 1);
        assert_eq!(result.children[0].has_children, None);
        let error = result.children[0].read_error.as_ref().unwrap();
        assert_eq!(error.code, "DIRECTORY_READ_ERROR");
        assert!(error.recoverable);
        let error = list(&child, &child).unwrap_err();
        assert_eq!(error.code, "DIRECTORY_READ_ERROR");
        assert!(error.recoverable);
        drop(guard);
        assert_eq!(
            list(&root, &root).unwrap().children[0].has_children,
            Some(false)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn excludes_links_and_rejects_linked_ancestor_paths() {
        let root = fixture();
        let outside = fixture();
        fs::create_dir(outside.join("child")).unwrap();
        let link = root.join("link");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert!(list(&root, &root).unwrap().children.is_empty());
        assert_eq!(
            list(&root, &link.join("child")).unwrap_err().code,
            "INVALID_PATH"
        );
        fs::remove_file(&link).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
