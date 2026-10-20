// Appended only to an isolated source snapshot by prepare.mjs.
// The shipping application contains no dependency on this harness.
#[cfg(test)]
mod thumbnail_comparison {
    use super::*;
    use lofty::file::TaggedFileExt;
    use serde_json::{json, Value};
    use std::time::Instant;

    fn env_path(name: &str) -> PathBuf {
        PathBuf::from(std::env::var_os(name).expect(name))
    }

    #[test]
    #[ignore]
    fn freeze_corpus() {
        let output = env_path("THUMB_BENCH_CORPUS");
        assert!(!output.exists(), "corpus must be a new directory");
        let mut directories = vec![env_path("THUMB_BENCH_LIBRARY")];
        let mut candidates = Vec::new();
        while let Some(directory) = directories.pop() {
            for entry in fs::read_dir(directory).unwrap().flatten() {
                let path = entry.path();
                if entry.file_type().unwrap().is_dir() {
                    directories.push(path);
                } else if path.extension().is_some_and(|v| v.eq_ignore_ascii_case("flac")) {
                    candidates.push(path);
                }
            }
        }
        candidates.sort_by_key(|path| blake3::hash(path.to_string_lossy().as_bytes()).to_hex());
        fs::create_dir_all(&output).unwrap();
        let mut rows = Vec::new();
        let mut digest_input = String::new();
        for path in candidates {
            let Ok(tagged) = super::super::metadata::read_tagged_file(&path) else { continue };
            let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else { continue };
            let Some(picture) = tag.pictures().first() else { continue };
            let bytes = picture.data();
            if bytes.is_empty() || bytes.len() as u64 > MAX_INPUT_BYTES || decode_and_pack(bytes, 256).is_err() { continue }
            let hash = blake3::hash(bytes).to_hex().to_string();
            let name = format!("{hash}.bin");
            fs::write(output.join(&name), bytes).unwrap();
            digest_input.push_str(&hash);
            rows.push(json!({"source": path, "file": name, "hash": hash, "bytes": bytes.len()}));
            if rows.len() == 83 { break }
        }
        assert_eq!(rows.len(), 83);
        let digest = blake3::hash(digest_input.as_bytes()).to_hex().to_string();
        let manifest = json!({"count": rows.len(), "digest": digest, "rows": rows});
        // Private manifest contains input paths. It must remain outside Git.
        fs::write(output.join("manifest.json"), serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
        println!("THUMBJSON {}", json!({"phase":"corpus", "count":83, "digest":digest}));
    }

    fn percentile(samples: &[f64], quantile: f64) -> f64 {
        let mut sorted = samples.to_vec();
        sorted.sort_by(f64::total_cmp);
        sorted[((sorted.len() - 1) as f64 * quantile).floor() as usize]
    }

    fn drain() {
        if let Some(writer) = THUMBNAIL_WRITER.get() { writer.wait_idle(); }
    }

    fn resolve_cover(path: &Path, audio_cache: &Path) -> Option<String> {
        super::super::source::hydrate_track_ref(path, Some(audio_cache), None)
            .expect("hydrate source").metadata.cover_art.and_then(|cover| cover.file_path)
    }

    fn complete_pipeline(root: &Path, rows: &[Value], phase: &str) {
        fs::create_dir_all(root.join("audio")).unwrap();
        let coordinator = Arc::new(PlaylistCoverRequestCoordinator::new());
        let generation = coordinator.begin_window("comparison-pipeline").unwrap();
        let started = Instant::now();
        let mut durations = Vec::new();
        let mut locate_ms = Vec::new();
        let mut pixel_ms = Vec::new();
        let mut response_bytes = 0usize;
        tauri::async_runtime::block_on(async {
            let mut handles = Vec::new();
            for consumer in 0..2 {
                let coordinator = Arc::clone(&coordinator);
                let root = root.to_path_buf();
                let rows = rows.to_vec();
                handles.push(tauri::async_runtime::spawn(async move {
                    let mut samples = Vec::new();
                    for row in rows.iter().skip(consumer).step_by(2) {
                        let source = PathBuf::from(row["source"].as_str().unwrap());
                        let audio = root.join("audio");
                        let started = Instant::now();
                        let path = tauri::async_runtime::spawn_blocking(move || resolve_cover(&source, &audio)).await.unwrap().expect("cover path");
                        let locate = started.elapsed().as_secs_f64()*1000.0;
                        let pixels_started = Instant::now();
                        let bytes = coordinator.load(root.clone(), AudioLoadPlaylistCoverPixelsInput {
                            file_path:path, max_edge:256, client_id:"comparison-pipeline".into(), window_generation:generation,
                        }).await.expect("pipeline pixels");
                        samples.push((started.elapsed().as_secs_f64()*1000.0, locate, pixels_started.elapsed().as_secs_f64()*1000.0, bytes.len()));
                    }
                    samples
                }));
            }
            for handle in handles {
                for (elapsed, locate, pixel, bytes) in handle.await.unwrap() {
                    durations.push(elapsed); locate_ms.push(locate); pixel_ms.push(pixel); response_bytes += bytes;
                }
            }
        });
        let elapsed = started.elapsed().as_secs_f64()*1000.0;
        drain();
        println!("THUMBJSON {}", json!({"phase":phase,"count":rows.len(),"elapsed_ms":elapsed,"request_p50_ms":percentile(&durations,0.5),"request_p95_ms":percentile(&durations,0.95),"locate_p50_ms":percentile(&locate_ms,0.5),"locate_p95_ms":percentile(&locate_ms,0.95),"pixel_p50_ms":percentile(&pixel_ms,0.5),"pixel_p95_ms":percentile(&pixel_ms,0.95),"response_bytes":response_bytes}));
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 0);
    }

    fn pixel_batch(root: &Path, paths: &[PathBuf], phase: &str, edge: u32) {
        let coordinator = Arc::new(PlaylistCoverRequestCoordinator::new());
        let generation = coordinator.begin_window("comparison").unwrap();
        let started = Instant::now();
        let (durations, bytes, responses) = tauri::async_runtime::block_on(async {
            let mut durations = Vec::new();
            let mut bytes = 0usize;
            let mut responses = Vec::new();
            // Two genuine request consumers, matching the production frontend cap.
            // Every chunk starts two futures before either is awaited.
            for chunk in paths.chunks(2) {
                let mut handles = Vec::new();
                for path in chunk {
                    let coordinator = Arc::clone(&coordinator);
                    let root = root.to_path_buf();
                    let path = path.to_string_lossy().into_owned();
                    handles.push(tauri::async_runtime::spawn(async move {
                        let started = Instant::now();
                        let response = coordinator.load(root, AudioLoadPlaylistCoverPixelsInput {
                            file_path: path, max_edge: edge, client_id: "comparison".into(), window_generation: generation,
                        }).await.expect("pixel response");
                        (started.elapsed().as_secs_f64() * 1000.0, response)
                    }));
                }
                for handle in handles {
                    let (elapsed, response) = handle.await.unwrap();
                    durations.push(elapsed);
                    bytes += response.len();
                    responses.push(blake3::hash(&response).to_hex().to_string());
                }
            }
            (durations, bytes, responses)
        });
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        let drain_started = Instant::now();
        drain();
        println!("THUMBJSON {}", json!({"phase":phase, "edge":edge,"count":paths.len(),"elapsed_ms":elapsed,
            "request_p50_ms":percentile(&durations,0.5), "request_p95_ms":percentile(&durations,0.95),
            "response_bytes":bytes,"response_digest":blake3::hash(responses.join("").as_bytes()).to_hex().to_string(),
            "drain_ms":drain_started.elapsed().as_secs_f64()*1000.0}));
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 0);
    }

    #[test]
    #[ignore]
    fn measure_corpus() {
        let corpus = env_path("THUMB_BENCH_CORPUS");
        let manifest: Value = serde_json::from_slice(&fs::read(corpus.join("manifest.json")).unwrap()).unwrap();
        let rows = manifest["rows"].as_array().unwrap();
        let expected = std::env::var("THUMB_BENCH_DIGEST").expect("frozen digest required");
        assert_eq!(manifest["digest"].as_str().unwrap(), expected);
        let root = env_path("THUMB_BENCH_ROOT");
        assert!(!root.exists(), "each process needs a new isolated cache root");
        let covers = root.join("audio").join("covers");
        fs::create_dir_all(&covers).unwrap();
        let mut paths = Vec::new();
        for row in rows {
            let file = row["file"].as_str().unwrap();
            let bytes = fs::read(corpus.join(file)).unwrap();
            assert_eq!(blake3::hash(&bytes).to_hex().as_str(), row["hash"].as_str().unwrap());
            fs::write(covers.join(file), bytes).unwrap();
            paths.push(covers.join(file));
        }
        println!("THUMBJSON {}", json!({"phase":"identity","count":paths.len(),"digest":expected,"permits":PLAYLIST_DECODE_PERMITS,"consumers":2,"os_cache":"uncontrolled; corpus preparation warmed"}));
        pixel_batch(&root, &paths, "pixels_cold", 256);
        pixel_batch(&root, &paths, "pixels_disk_hot", 256);
        pixel_batch(&root, &paths, "pixels_repeat_hot", 256);
        pixel_batch(&root, &paths, "pixels_upgrade", 512);
        let audio_cache = root.join("hydrate").join("audio");
        fs::create_dir_all(&audio_cache).unwrap();
        for phase in ["hydrate_cold", "hydrate_cover_cached"] {
            let started = Instant::now();
            let mut durations = Vec::new();
            let mut found = 0;
            for row in rows {
                let before = Instant::now();
                let track = super::super::source::hydrate_track_ref(Path::new(row["source"].as_str().unwrap()), Some(&audio_cache), None).expect("hydrate source");
                durations.push(before.elapsed().as_secs_f64()*1000.0);
                found += usize::from(track.metadata.cover_art.is_some());
            }
            println!("THUMBJSON {}", json!({"phase":phase,"count":rows.len(),"found":found,"elapsed_ms":started.elapsed().as_secs_f64()*1000.0,"request_p50_ms":percentile(&durations,0.5),"request_p95_ms":percentile(&durations,0.95)}));
        }
        complete_pipeline(&root.join("pipeline"), rows, "pipeline_cold");
        complete_pipeline(&root.join("pipeline"), rows, "pipeline_hot");
        drain();
        // The runner owns this new root. Keep it for anonymous cache inspection;
        // no delete operation can accidentally target the user's cache.
    }
}
