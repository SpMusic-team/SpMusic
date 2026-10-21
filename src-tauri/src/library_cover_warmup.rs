use std::{
    collections::HashSet,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use serde::{Deserialize, Serialize};

use crate::audio::{try_probe_playlist_cover_for_warmup, try_warm_playlist_cover_pixels};
use crate::library_folders::LibraryError;

const MAX_WARMUP_PATHS: usize = 256;
const DEFAULT_MAX_EDGE: u32 = 256;
const BUSY_WAIT: Duration = Duration::from_millis(40);
static WARMUP_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCoverWarmupInput {
    paths: Vec<String>,
    max_edge: Option<u32>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCoverWarmupResult {
    attempted: usize,
    computed: usize,
    persisted: usize,
    // Compatibility alias for callers that only need an in-process count.
    warmed: usize,
    skipped: usize,
    failed: usize,
    cancelled: bool,
}

pub fn cancel() {
    WARMUP_GENERATION.fetch_add(1, Ordering::AcqRel);
}

fn is_current(generation: u64) -> bool {
    WARMUP_GENERATION.load(Ordering::Acquire) == generation
}

async fn wait_for_foreground() {
    // Only used when a visible request occupies or awaits a slot. This sleep
    // runs on the blocking pool, never on the async executor or UI thread.
    let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(BUSY_WAIT)).await;
}

pub async fn warm(
    cache_dir: PathBuf,
    input: LibraryCoverWarmupInput,
) -> Result<LibraryCoverWarmupResult, LibraryError> {
    if input.paths.len() > MAX_WARMUP_PATHS {
        return Err(LibraryError::invalid(format!(
            "Library cover warmup accepts at most {MAX_WARMUP_PATHS} paths"
        )));
    }
    let max_edge = input.max_edge.unwrap_or(DEFAULT_MAX_EDGE);
    if !matches!(max_edge, 128 | 256) {
        return Err(LibraryError::invalid(
            "Library cover warmup maxEdge must be 128 or 256",
        ));
    }
    let generation = WARMUP_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    let mut result = LibraryCoverWarmupResult::default();
    let mut seen = HashSet::new();

    for path in input.paths {
        if !is_current(generation) {
            result.cancelled = true;
            break;
        }
        let key = {
            #[cfg(target_os = "windows")]
            {
                path.to_lowercase()
            }
            #[cfg(not(target_os = "windows"))]
            {
                path.clone()
            }
        };
        if !seen.insert(key) {
            result.skipped += 1;
            continue;
        }
        result.attempted += 1;
        let cover = loop {
            if !is_current(generation) {
                result.cancelled = true;
                break None;
            }
            match try_probe_playlist_cover_for_warmup(cache_dir.clone(), path.clone()).await {
                Ok(Some(source)) => break Some(source),
                Ok(None) => wait_for_foreground().await,
                Err(error) => {
                    tracing::debug!(operation = "library.cover_warmup.probe", path = %path, error = %error.message, "cover probe failed");
                    result.failed += 1;
                    break None;
                }
            }
        };
        if result.cancelled {
            break;
        }
        let Some(cover) = cover else { continue };
        let Some(file_path) = cover.cover_art.and_then(|art| art.file_path) else {
            result.skipped += 1;
            continue;
        };
        let edges: &[u32] = if max_edge == 256 { &[128, 256] } else { &[128] };
        for &edge in edges {
            loop {
                if !is_current(generation) {
                    result.cancelled = true;
                    break;
                }
                match try_warm_playlist_cover_pixels(cache_dir.clone(), file_path.clone(), edge)
                    .await
                {
                    Ok(Some(persisted)) => {
                        result.computed += 1;
                        result.warmed += 1;
                        if persisted {
                            result.persisted += 1;
                        } else {
                            result.failed += 1;
                        }
                        break;
                    }
                    Ok(None) => wait_for_foreground().await,
                    Err(error) => {
                        tracing::debug!(operation = "library.cover_warmup.decode", path = %path, edge, error = %error.message, "cover decode failed");
                        result.failed += 1;
                        break;
                    }
                }
            }
            if result.cancelled {
                break;
            }
        }
        if result.cancelled {
            break;
        }
    }
    tracing::info!(
        operation = "library.cover_warmup.finish",
        attempted = result.attempted,
        warmed = result.warmed,
        persisted = result.persisted,
        skipped = result.skipped,
        failed = result.failed,
        cancelled = result.cancelled,
        max_edge,
        "library cover warmup finished",
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_advances_generation() {
        let prior = WARMUP_GENERATION.load(Ordering::Acquire);
        cancel();
        assert!(!is_current(prior));
    }
}
