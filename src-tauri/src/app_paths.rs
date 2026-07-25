use std::{
    fs,
    path::{Path, PathBuf},
};

use directories::ProjectDirs;
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
}

#[derive(Debug, Error)]
pub enum AppPathsError {
    #[error("platform app directories are unavailable")]
    Unavailable,
    #[error("failed to create app directory `{path}`: {source}")]
    CreateDir {
        path: PathBuf,
        source: std::io::Error,
    },
}

impl AppPaths {
    pub fn prepare() -> Result<Self, AppPathsError> {
        let project_dirs =
            ProjectDirs::from("app", "SpMusic", "SpMusic").ok_or(AppPathsError::Unavailable)?;
        let paths = Self {
            config_dir: project_dirs.config_dir().to_path_buf(),
            data_dir: project_dirs.data_dir().to_path_buf(),
            cache_dir: project_dirs.cache_dir().to_path_buf(),
        };

        paths.ensure_created()?;
        Ok(paths)
    }

    fn ensure_created(&self) -> Result<(), AppPathsError> {
        ensure_dir(&self.config_dir)?;
        ensure_dir(&self.data_dir)?;
        ensure_dir(&self.cache_dir)?;
        Ok(())
    }
}

fn ensure_dir(path: &Path) -> Result<(), AppPathsError> {
    fs::create_dir_all(path).map_err(|source| AppPathsError::CreateDir {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_paths_error_display_includes_path() {
        let error = AppPathsError::CreateDir {
            path: PathBuf::from("D:/SpMusic/config"),
            source: std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied"),
        };

        assert!(error.to_string().contains("D:/SpMusic/config"));
    }
}
