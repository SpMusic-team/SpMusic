use std::{
    sync::{Arc, OnceLock},
    time::Duration,
};

use tauri::async_runtime::Mutex;

use super::{
    duration::{decode_duration, duration_ms},
    error::{audio_error, AudioCommandError, AudioErrorCode},
    source::{input_path, validate_existing_file},
    types::{AudioPlaylistDurationItem, AudioProbePlaylistDurationsInput},
};

const MAX_BATCH_PATHS: usize = 16;
static DURATION_GATE: OnceLock<Arc<Mutex<()>>> = OnceLock::new();

pub async fn probe_playlist_durations(
    input: AudioProbePlaylistDurationsInput,
) -> Result<Vec<AudioPlaylistDurationItem>, AudioCommandError> {
    if input.paths.len() > MAX_BATCH_PATHS {
        return Err(audio_error(
            AudioErrorCode::InvalidPath,
            "Playlist duration probe accepts at most 16 paths per batch",
            true,
        ));
    }
    if input.paths.is_empty() {
        return Ok(Vec::new());
    }

    let gate = DURATION_GATE
        .get_or_init(|| Arc::new(Mutex::new(())))
        .clone();
    run_duration_worker(gate, move || {
        input.paths.into_iter().map(probe_one).collect()
    })
    .await
}

async fn run_duration_worker(
    gate: Arc<Mutex<()>>,
    probe: impl FnOnce() -> Vec<AudioPlaylistDurationItem> + Send + 'static,
) -> Result<Vec<AudioPlaylistDurationItem>, AudioCommandError> {
    let permit = gate.lock_owned().await;
    tauri::async_runtime::spawn_blocking(move || {
        // The blocking worker owns the permit: dropping or cancelling the caller
        // must not let another batch start while this file I/O is still running.
        let _permit = permit;
        probe()
    })
    .await
    .map_err(|error| {
        tracing::error!(
            operation = "audio.playlist_duration.join",
            error = %error,
            "playlist duration worker failed",
        );
        audio_error(
            AudioErrorCode::InternalError,
            "Playlist duration worker failed",
            true,
        )
    })
}

fn probe_one(source_path: String) -> AudioPlaylistDurationItem {
    let result = input_path(&source_path).and_then(|path| {
        validate_existing_file(&path)?;
        decode_duration(&path)
    });
    duration_item(source_path, result)
}

fn duration_item(
    source_path: String,
    result: Result<Option<Duration>, AudioCommandError>,
) -> AudioPlaylistDurationItem {
    match result {
        Ok(duration) => AudioPlaylistDurationItem {
            source_path,
            duration_ms: duration.map(duration_ms),
            error: None,
        },
        Err(error) => AudioPlaylistDurationItem {
            source_path,
            duration_ms: None,
            error: Some(error),
        },
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::{
            atomic::{AtomicU64, Ordering},
            mpsc,
        },
    };

    use super::*;

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        root: PathBuf,
        wav: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "spmusic-playlist-duration-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&root).unwrap();
            let wav = root.join("时长.wav");
            // One second of 8 kHz mono PCM, generated without external tools.
            let data_len = 16_000_u32;
            let mut bytes = Vec::with_capacity(44 + data_len as usize);
            bytes.extend_from_slice(b"RIFF");
            bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
            bytes.extend_from_slice(b"WAVEfmt ");
            bytes.extend_from_slice(&16_u32.to_le_bytes());
            bytes.extend_from_slice(&1_u16.to_le_bytes());
            bytes.extend_from_slice(&1_u16.to_le_bytes());
            bytes.extend_from_slice(&8_000_u32.to_le_bytes());
            bytes.extend_from_slice(&16_000_u32.to_le_bytes());
            bytes.extend_from_slice(&2_u16.to_le_bytes());
            bytes.extend_from_slice(&16_u16.to_le_bytes());
            bytes.extend_from_slice(b"data");
            bytes.extend_from_slice(&data_len.to_le_bytes());
            bytes.resize(44 + data_len as usize, 0);
            fs::write(&wav, bytes).unwrap();
            Self { root, wav }
        }

        fn wav_path(&self) -> String {
            self.wav.to_string_lossy().into_owned()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn batch_probes_real_wav_preserves_order_duplicates_and_exact_path_echo() {
        let fixture = Fixture::new();
        let wav = fixture.wav_path();
        let alternate = fixture
            .root
            .join(".")
            .join("时长.wav")
            .to_string_lossy()
            .into_owned();
        let missing = fixture
            .root
            .join("missing.wav")
            .to_string_lossy()
            .into_owned();
        let paths = vec![wav.clone(), missing, alternate, wav];
        let original = fs::read(&fixture.wav).unwrap();
        let result = tauri::async_runtime::block_on(probe_playlist_durations(
            AudioProbePlaylistDurationsInput {
                paths: paths.clone(),
            },
        ))
        .unwrap();

        assert_eq!(result.len(), paths.len());
        for (item, requested) in result.iter().zip(&paths) {
            assert_eq!(&item.source_path, requested);
        }
        for index in [0, 2, 3] {
            assert_eq!(result[index].duration_ms, Some(1_000));
            assert!(result[index].error.is_none());
        }
        assert_eq!(result[1].duration_ms, None);
        assert_eq!(
            result[1].error.as_ref().unwrap().code,
            AudioErrorCode::FileNotFound
        );
        assert_eq!(fs::read(&fixture.wav).unwrap(), original);
        assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 1);
    }

    #[test]
    fn folder_and_m3u8_duration_probes_use_the_same_audio_source() {
        let fixture = Fixture::new();
        let folder = super::super::playlist::load_folder_playlist(&fixture.wav).unwrap();
        let playlist_path = fixture.root.join("same-song.m3u8");
        fs::write(
            &playlist_path,
            "#EXTM3U\n#EXTINF:999,Incorrect tag duration\n时长.wav\n",
        )
        .unwrap();
        let m3u8 = super::super::playlist::load_folder_playlist(&playlist_path).unwrap();
        assert_eq!(folder.tracks.len(), 1);
        assert_eq!(m3u8.tracks.len(), 1);
        assert_eq!(folder.tracks[0].source_path, m3u8.tracks[0].source_path);
        assert!(m3u8.tracks[0].available);
        for playlist in [folder, m3u8] {
            let result = tauri::async_runtime::block_on(probe_playlist_durations(
                AudioProbePlaylistDurationsInput {
                    paths: playlist
                        .tracks
                        .iter()
                        .map(|track| track.source_path.clone())
                        .collect(),
                },
            ))
            .unwrap();
            assert_eq!(result[0].duration_ms, Some(1_000));
            assert!(result[0].error.is_none());
        }
    }

    #[test]
    fn m3u8_keeps_missing_entries_and_probes_remaining_durations() {
        let fixture = Fixture::new();
        let missing = fixture.root.join("missing.mp3");
        let playlist_path = fixture.root.join("missing-entry.m3u8");
        fs::write(
            &playlist_path,
            format!(
                "#EXTM3U\n#EXT-X-RATING:0\n{}\n#EXT-X-RATING:0\n{}\n",
                fixture.wav.to_string_lossy().replace('\\', "/"),
                missing.to_string_lossy().replace('\\', "/"),
            ),
        )
        .unwrap();
        let original = fs::read(&playlist_path).unwrap();
        let playlist = super::super::playlist::load_folder_playlist(&playlist_path).unwrap();
        assert_eq!(playlist.tracks.len(), 2);
        assert!(playlist.tracks[0].available);
        assert!(!playlist.tracks[1].available);
        let items = tauri::async_runtime::block_on(probe_playlist_durations(
            AudioProbePlaylistDurationsInput {
                paths: playlist
                    .tracks
                    .iter()
                    .map(|track| track.source_path.clone())
                    .collect(),
            },
        ))
        .unwrap();
        assert_eq!(items[0].duration_ms, Some(1_000));
        assert!(items[0].error.is_none());
        assert_eq!(items[1].duration_ms, None);
        assert_eq!(
            items[1].error.as_ref().unwrap().code,
            AudioErrorCode::FileNotFound
        );
        assert_eq!(fs::read(&playlist_path).unwrap(), original);
        assert!(!missing.exists());
    }

    #[test]
    fn m3u8_file_uri_decodes_encoded_unicode_and_spaces_before_duration_probe() {
        let fixture = Fixture::new();
        let spaced = fixture.root.join("时长 空格%23.wav");
        fs::copy(&fixture.wav, &spaced).unwrap();
        let plain = spaced.to_string_lossy().replace('\\', "/");
        let encoded = plain
            .as_bytes()
            .iter()
            .map(|byte| {
                if byte.is_ascii_alphanumeric() || b"/:.-_".contains(byte) {
                    char::from(*byte).to_string()
                } else {
                    format!("%{byte:02X}")
                }
            })
            .collect::<String>();
        let uri = if cfg!(windows) {
            format!("file:///{encoded}")
        } else {
            format!("file://{encoded}")
        };
        let playlist_path = fixture.root.join("uri.m3u8");
        fs::write(&playlist_path, format!("#EXTM3U\n{uri}\n")).unwrap();
        let playlist = super::super::playlist::load_folder_playlist(&playlist_path).unwrap();
        assert_eq!(playlist.tracks.len(), 1);
        assert!(
            playlist.tracks[0].available,
            "existing URI-encoded audio must remain available"
        );
        assert_eq!(
            playlist.tracks[0].source_path,
            spaced.canonicalize().unwrap().to_string_lossy()
        );
        let result = tauri::async_runtime::block_on(probe_playlist_durations(
            AudioProbePlaylistDurationsInput {
                paths: playlist
                    .tracks
                    .iter()
                    .map(|track| track.source_path.clone())
                    .collect(),
            },
        ))
        .unwrap();
        assert_eq!(result[0].duration_ms, Some(1_000));
        assert!(result[0].error.is_none());
    }

    #[test]
    fn m3u8_bare_paths_keep_literal_percent_sequences() {
        let fixture = Fixture::new();
        let literal = fixture.root.join("literal%20name.wav");
        fs::copy(&fixture.wav, &literal).unwrap();
        let playlist_path = fixture.root.join("literal.m3u8");
        fs::write(&playlist_path, "literal%20name.wav\n").unwrap();
        let playlist = super::super::playlist::load_folder_playlist(&playlist_path).unwrap();
        assert_eq!(playlist.tracks.len(), 1);
        assert!(playlist.tracks[0].available);
        assert_eq!(
            playlist.tracks[0].source_path,
            literal.canonicalize().unwrap().to_string_lossy()
        );
        let result = probe_one(playlist.tracks[0].source_path.clone());
        assert_eq!(result.duration_ms, Some(1_000));
    }

    #[test]
    fn m3u8_rejects_malformed_or_non_utf8_file_uris_without_path_fallback() {
        let fixture = Fixture::new();
        let playlist_path = fixture.root.join("invalid.m3u8");
        let prefix = if cfg!(windows) {
            "file:///C:/"
        } else {
            "file:///"
        };
        fs::write(&playlist_path, format!(
            "{prefix}invalid%GG.wav\n{prefix}invalid%.wav\n{prefix}invalid%2.wav\n{prefix}invalid%FF.wav\n{prefix}invalid%00.wav\n时长.wav\n"
        )).unwrap();
        let playlist = super::super::playlist::load_folder_playlist(&playlist_path).unwrap();
        assert_eq!(playlist.tracks.len(), 1);
        assert!(playlist.tracks[0].available);
        assert_eq!(
            probe_one(playlist.tracks[0].source_path.clone()).duration_ms,
            Some(1_000)
        );
    }

    #[test]
    fn sibling_m3u8_file_uri_applies_directory_boundary_after_decoding() {
        let fixture = Fixture::new();
        let inside = fixture.root.join("inside");
        fs::create_dir(&inside).unwrap();
        let selected = inside.join("selected.wav");
        fs::copy(&fixture.wav, &selected).unwrap();
        let plain = inside.to_string_lossy().replace('\\', "/");
        let uri = if cfg!(windows) {
            format!("file:///{plain}/%2e%2e/时长.wav")
        } else {
            format!("file://{plain}/%2e%2e/时长.wav")
        };
        fs::write(
            inside.join("boundary.m3u8"),
            format!("{uri}\nselected.wav\n"),
        )
        .unwrap();
        let playlist = super::super::playlist::load_folder_playlist(&selected).unwrap();
        assert_eq!(playlist.tracks.len(), 1);
        assert_eq!(
            playlist.tracks[0].source_path,
            selected.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(
            probe_one(playlist.tracks[0].source_path.clone()).duration_ms,
            Some(1_000)
        );
    }

    #[test]
    fn invalid_and_corrupt_files_are_per_item_errors() {
        let fixture = Fixture::new();
        let bad = fixture.root.join("bad.wav");
        fs::write(&bad, b"not an audio stream").unwrap();
        let result = tauri::async_runtime::block_on(probe_playlist_durations(
            AudioProbePlaylistDurationsInput {
                paths: vec![
                    "  ".into(),
                    fixture.root.to_string_lossy().into_owned(),
                    bad.to_string_lossy().into_owned(),
                ],
            },
        ))
        .unwrap();
        assert_eq!(result.len(), 3);
        for (item, code) in result.iter().zip([
            AudioErrorCode::InvalidPath,
            AudioErrorCode::InvalidPath,
            AudioErrorCode::UnsupportedFormat,
        ]) {
            assert_eq!(item.duration_ms, None);
            assert_eq!(item.error.as_ref().unwrap().code, code);
        }
    }

    #[test]
    fn unknown_duration_is_null_without_an_error_in_frontend_serialization() {
        // Unknown is a valid probe outcome, distinct from a failed file probe.
        let fixture = Fixture::new();
        let item = duration_item(fixture.wav_path(), Ok(None));
        let value = serde_json::to_value(item).unwrap();
        assert_eq!(value["sourcePath"], fixture.wav_path());
        assert!(value["durationMs"].is_null());
        assert!(value["error"].is_null());
        assert!(value.get("source_path").is_none());
    }

    #[test]
    fn empty_batch_and_batch_limit_are_enforced_before_file_io() {
        let empty = tauri::async_runtime::block_on(probe_playlist_durations(
            serde_json::from_value(serde_json::json!({ "paths": [] })).unwrap(),
        ))
        .unwrap();
        assert!(empty.is_empty());
        let accepted = tauri::async_runtime::block_on(probe_playlist_durations(
            AudioProbePlaylistDurationsInput {
                paths: vec!["".into(); MAX_BATCH_PATHS],
            },
        ))
        .unwrap();
        assert_eq!(accepted.len(), MAX_BATCH_PATHS);
        let rejected = tauri::async_runtime::block_on(probe_playlist_durations(
            AudioProbePlaylistDurationsInput {
                paths: vec!["".into(); MAX_BATCH_PATHS + 1],
            },
        ))
        .unwrap_err();
        assert_eq!(
            serde_json::to_value(rejected).unwrap()["code"],
            "INVALID_PATH"
        );
    }

    #[test]
    fn cancelled_caller_keeps_gate_until_blocking_worker_finishes() {
        let gate = Arc::new(Mutex::new(()));
        let (started, did_start) = mpsc::channel();
        let (release, wait_release) = mpsc::channel();
        let task = tauri::async_runtime::spawn(run_duration_worker(gate.clone(), move || {
            started.send(()).unwrap();
            wait_release.recv().unwrap();
            Vec::new()
        }));
        did_start.recv_timeout(Duration::from_secs(5)).unwrap();
        task.abort();
        assert!(tauri::async_runtime::block_on(task).is_err());
        let held = gate.try_lock().is_err();
        release.send(()).unwrap();
        assert!(
            held,
            "cancelled caller must not release the running worker's gate"
        );
        let recovered =
            tauri::async_runtime::block_on(run_duration_worker(gate, Vec::new)).unwrap();
        assert!(recovered.is_empty());
    }

    #[test]
    fn worker_failure_is_stable_and_releases_gate_for_the_next_batch() {
        let gate = Arc::new(Mutex::new(()));
        let error = tauri::async_runtime::block_on(run_duration_worker(gate.clone(), || {
            panic!("synthetic worker failure")
        }))
        .unwrap_err();
        assert_eq!(
            serde_json::to_value(error).unwrap()["code"],
            "INTERNAL_ERROR"
        );
        let recovered =
            tauri::async_runtime::block_on(run_duration_worker(gate, Vec::new)).unwrap();
        assert!(recovered.is_empty());
    }

    #[test]
    #[ignore = "requires an explicitly authorized local folder or source through SPMUSIC_DIAGNOSTIC_FOLDER or SPMUSIC_DIAGNOSTIC_SOURCE"]
    fn diagnostic_existing_folder_duration_counts() {
        use std::collections::BTreeMap;
        use std::time::Instant;

        let diagnostic_source = std::env::var_os("SPMUSIC_DIAGNOSTIC_SOURCE").map(PathBuf::from);
        let directory = diagnostic_source
            .as_ref()
            .map(|source| source.parent().unwrap().to_path_buf())
            .unwrap_or_else(|| {
                PathBuf::from(
                    std::env::var_os("SPMUSIC_DIAGNOSTIC_FOLDER")
                        .expect("explicit diagnostic folder required"),
                )
            });
        let extensions = super::super::playlist::default_filters()
            .remove(0)
            .extensions;
        let selected = diagnostic_source.unwrap_or_else(|| {
            fs::read_dir(&directory)
                .unwrap()
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .find(|path| {
                    path.is_file()
                        && path
                            .extension()
                            .and_then(|value| value.to_str())
                            .is_some_and(|value| {
                                extensions
                                    .iter()
                                    .any(|supported| value.eq_ignore_ascii_case(supported))
                            })
                })
                .expect("folder requires a supported audio file")
        });
        let playlist = super::super::playlist::load_folder_playlist(&selected).unwrap();
        println!(
            "DIAGNOSTIC import_kind={:?} tracks={} unavailable={}",
            playlist.source_kind,
            playlist.tracks.len(),
            playlist
                .tracks
                .iter()
                .filter(|track| !track.available)
                .count()
        );
        let started = Instant::now();
        let mut known = 0;
        let mut unknown = 0;
        let mut failed = 0;
        let mut sum_ms = 0_u128;
        let mut classifications = BTreeMap::<String, usize>::new();
        let mut max_batch_ms = 0;
        let mut anonymous_response = Vec::new();
        for (batch_index, tracks) in playlist.tracks.chunks(MAX_BATCH_PATHS).enumerate() {
            let batch_started = Instant::now();
            // Exercise the actual command wrapper and its JSON boundary, using
            // the same argument name as the frontend's invoke call.
            let request = serde_json::json!({
                "input": { "paths": tracks.iter().map(|track| track.source_path.clone()).collect::<Vec<_>>() }
            });
            let input = serde_json::from_value(request["input"].clone()).unwrap();
            let items =
                tauri::async_runtime::block_on(crate::audio_probe_playlist_durations(input))
                    .expect("batch should not be rejected");
            let response = serde_json::to_value(&items).unwrap();
            let response = response.as_array().expect("frontend expects an array");
            assert_eq!(response.len(), tracks.len());
            for (item, track) in response.iter().zip(tracks) {
                assert_eq!(
                    item["sourcePath"].as_str(),
                    Some(track.source_path.as_str())
                );
                assert!(item["durationMs"].is_null() || item["durationMs"].as_u64().is_some());
                assert!(item["error"].is_null() || item["error"].is_object());
                assert!(item.get("source_path").is_none());
                assert!(item.get("duration_ms").is_none());
                let mut anonymous = item.clone();
                anonymous["sourcePath"] =
                    serde_json::json!(format!("track-{}", anonymous_response.len()));
                anonymous_response.push(anonymous);
            }
            for (offset, item) in items.iter().enumerate() {
                let extension = std::path::Path::new(&item.source_path)
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("none")
                    .to_lowercase();
                let class = match (&item.duration_ms, &item.error) {
                    (Some(duration), None) => {
                        known += 1;
                        sum_ms += u128::from(*duration);
                        "known".to_owned()
                    }
                    (_, Some(error)) => {
                        failed += 1;
                        println!(
                            "DIAGNOSTIC failed index={} extension={} code={:?}",
                            batch_index * MAX_BATCH_PATHS + offset,
                            extension,
                            error.code
                        );
                        format!("error:{:?}", error.code)
                    }
                    (None, None) => {
                        unknown += 1;
                        println!(
                            "DIAGNOSTIC null index={} extension={}",
                            batch_index * MAX_BATCH_PATHS + offset,
                            extension
                        );
                        "unknown".to_owned()
                    }
                };
                *classifications
                    .entry(format!("{extension}:{class}"))
                    .or_default() += 1;
            }
            let batch_ms = batch_started.elapsed().as_millis();
            max_batch_ms = max_batch_ms.max(batch_ms);
            println!(
                "DIAGNOSTIC batch={} done={} known={} null={} errors={} batch_ms={} elapsed_ms={}",
                batch_index + 1,
                known + unknown + failed,
                known,
                unknown,
                failed,
                batch_ms,
                started.elapsed().as_millis()
            );
        }
        println!("DIAGNOSTIC COMPLETE tracks={} known={} null={} errors={} sum_ms={} elapsed_ms={} max_batch_ms={} classifications={:?}", playlist.tracks.len(), known, unknown, failed, sum_ms, started.elapsed().as_millis(), max_batch_ms, classifications);
        if let Some(output) = std::env::var_os("SPMUSIC_DIAGNOSTIC_OUTPUT") {
            let output = PathBuf::from(output);
            // The optional evidence export is separate from the media folder.
            assert!(output.is_absolute());
            assert!(!output.starts_with(directory.canonicalize().unwrap()));
            fs::write(output, serde_json::to_vec(&anonymous_response).unwrap()).unwrap();
            println!(
                "DIAGNOSTIC anonymous_response_items={}",
                anonymous_response.len()
            );
        }
    }
}
