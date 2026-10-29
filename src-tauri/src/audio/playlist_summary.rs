//! Cheap, strictly read-only playlist tag summary probe.
//!
//! The playlist view needs real titles/artists/albums for its very first frame,
//! but the only existing metadata channel (`audio_hydrate_track` →
//! `source::hydrate_track_ref`) opens a decoder, scans the stream for a duration
//! and materializes embedded cover art into the cover cache. That path is far
//! too expensive to run over a whole playlist, so it is only hydrated lazily for
//! the visible window.
//!
//! This module adds the missing bulk channel: one batch command that reads tags
//! with `lofty` only. It never opens a decoder, never touches the cover cache,
//! never reads sidecar `.lrc` files and never writes to disk.

use std::{
    any::Any,
    panic::{catch_unwind, AssertUnwindSafe},
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, OnceLock,
    },
    time::Instant,
};

use lofty::{
    config::ParseOptions,
    error::{ErrorKind, LoftyError},
    file::{AudioFile, TaggedFileExt},
    probe::Probe,
    tag::{Accessor, ItemKey},
};
use tauri::async_runtime::Mutex;

use super::{
    error::{audio_error, AudioCommandError, AudioErrorCode},
    metadata::tag_text,
    source::{input_path, validate_existing_file},
    types::{
        AudioPlaylistTrackSummaryItem, AudioPlaylistTrackTagSummary,
        AudioProbePlaylistTrackSummariesInput,
    },
};

const OPERATION: &str = "audio.playlist_track_summaries";
/// Upper bound per batch, mirroring the playlist UI's own batching granularity.
const MAX_BATCH_PATHS: usize = 256;
/// Fixed fan-out. Tag reads are small, so a handful of workers saturates the
/// disk without occupying the async runtime.
const WORKER_THREADS: usize = 4;

/// Serializes tag-summary batches against each other only. It is deliberately
/// independent from `playlist_duration::DURATION_GATE`: a slow decoder-backed
/// duration probe must never starve cheap tag reads, and vice versa.
static TRACK_SUMMARY_GATE: OnceLock<Arc<Mutex<()>>> = OnceLock::new();

/// Reads tag summaries for a batch of local audio paths.
///
/// Output order always matches the input order, duplicates occupy one item
/// each, and `source_path` echoes the requested string verbatim.
pub async fn probe_playlist_track_summaries(
    input: AudioProbePlaylistTrackSummariesInput,
) -> Result<Vec<AudioPlaylistTrackSummaryItem>, AudioCommandError> {
    if input.paths.len() > MAX_BATCH_PATHS {
        return Err(audio_error(
            AudioErrorCode::InvalidPath,
            format!(
                "Playlist track summary probe accepts at most {MAX_BATCH_PATHS} paths per batch"
            ),
            true,
        ));
    }
    if input.paths.is_empty() {
        return Ok(Vec::new());
    }

    let gate = TRACK_SUMMARY_GATE
        .get_or_init(|| Arc::new(Mutex::new(())))
        .clone();
    run_track_summary_worker(gate, input.paths, read_track_tag_summary).await
}

async fn run_track_summary_worker<F>(
    gate: Arc<Mutex<()>>,
    paths: Vec<String>,
    read_summary: F,
) -> Result<Vec<AudioPlaylistTrackSummaryItem>, AudioCommandError>
where
    F: Fn(&Path) -> Result<AudioPlaylistTrackTagSummary, AudioCommandError> + Send + Sync + 'static,
{
    let permit = gate.lock_owned().await;
    tauri::async_runtime::spawn_blocking(move || {
        // The blocking worker owns the permit: dropping or cancelling the caller
        // must not let another batch start while this file I/O is still running.
        let _permit = permit;
        probe_batch(&paths, &read_summary)
    })
    .await
    .map_err(|error| {
        tracing::error!(
            operation = OPERATION,
            stage = "join",
            error = %error,
            "playlist track summary worker failed",
        );
        audio_error(
            AudioErrorCode::InternalError,
            "Playlist track summary worker failed",
            true,
        )
    })
}

/// Probes one batch on a fixed set of scoped worker threads. Every worker claims
/// the next index from a shared atomic counter, so a slow file never blocks the
/// tail of the batch and no worker can be handed the same index twice.
fn probe_batch<F>(paths: &[String], read_summary: &F) -> Vec<AudioPlaylistTrackSummaryItem>
where
    F: Fn(&Path) -> Result<AudioPlaylistTrackTagSummary, AudioCommandError> + Sync,
{
    let started_at = Instant::now();
    let total = paths.len();
    let worker_count = WORKER_THREADS.min(total);
    let next_index = AtomicUsize::new(0);
    // Slots keep the caller's order regardless of which worker finished first.
    let mut slots: Vec<Option<AudioPlaylistTrackSummaryItem>> = (0..total).map(|_| None).collect();
    let mut dropped_workers = 0_usize;

    std::thread::scope(|scope| {
        let handles = (0..worker_count)
            .map(|_| {
                scope.spawn(|| {
                    let mut claimed = Vec::new();
                    loop {
                        let index = next_index.fetch_add(1, Ordering::Relaxed);
                        if index >= total {
                            break;
                        }
                        claimed.push((index, probe_one_item(&paths[index], read_summary)));
                    }
                    claimed
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            match handle.join() {
                Ok(claimed) => {
                    for (index, item) in claimed {
                        slots[index] = Some(item);
                    }
                }
                Err(_) => dropped_workers += 1,
            }
        }
    });

    let mut items = Vec::with_capacity(total);
    for (index, slot) in slots.into_iter().enumerate() {
        items.push(match slot {
            Some(item) => item,
            None => {
                // Defensive: a worker that escaped the per-item `catch_unwind`
                // must still leave a complete, ordered batch behind.
                dropped_workers = dropped_workers.max(1);
                AudioPlaylistTrackSummaryItem {
                    source_path: paths[index].clone(),
                    summary: None,
                    error: Some(audio_error(
                        AudioErrorCode::InternalError,
                        "Playlist track summary worker dropped this item",
                        true,
                    )),
                }
            }
        });
    }

    let error_count = items.iter().filter(|item| item.error.is_some()).count();
    tracing::debug!(
        operation = OPERATION,
        batch_size = total,
        worker_count,
        dropped_workers,
        error_count,
        elapsed_ms = started_at.elapsed().as_millis(),
        "probed playlist track summaries",
    );

    items
}

/// Probes a single path. `catch_unwind` keeps a panicking file (or a panicking
/// probe) from failing the whole batch or leaking the batch permit; the panic is
/// folded into this item's `InternalError`.
fn probe_one_item<F>(source_path: &str, read_summary: &F) -> AudioPlaylistTrackSummaryItem
where
    F: Fn(&Path) -> Result<AudioPlaylistTrackTagSummary, AudioCommandError> + Sync,
{
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        input_path(source_path).and_then(|path| {
            validate_existing_file(&path)?;
            read_summary(&path)
        })
    }));

    match outcome {
        Ok(Ok(summary)) => AudioPlaylistTrackSummaryItem {
            source_path: source_path.to_owned(),
            summary: Some(summary),
            error: None,
        },
        Ok(Err(error)) => AudioPlaylistTrackSummaryItem {
            source_path: source_path.to_owned(),
            summary: None,
            error: Some(error),
        },
        Err(payload) => {
            // Never log titles, artists or albums: only the panic reason, and
            // the path at debug level only.
            tracing::error!(
                operation = OPERATION,
                panic = %panic_message(payload.as_ref()),
                "playlist track summary item panicked",
            );
            tracing::debug!(
                operation = OPERATION,
                path = %source_path,
                "panicked playlist track summary item path",
            );
            AudioPlaylistTrackSummaryItem {
                source_path: source_path.to_owned(),
                summary: None,
                error: Some(audio_error(
                    AudioErrorCode::InternalError,
                    "Playlist track summary probe panicked",
                    true,
                )),
            }
        }
    }
}

fn panic_message(payload: &(dyn Any + Send)) -> &str {
    payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("unknown panic payload")
}

/// The production probe: tags plus container properties, and nothing else.
///
/// Cover art parsing is explicitly disabled because it is the dominant cost of a
/// tag probe and the playlist only needs text. Sidecar `.lrc` files and the
/// cover cache are never consulted here, and no duration is reported: playback
/// duration stays authoritative on `audio_probe_playlist_durations` and the
/// hydration path so a header estimate cannot flip a published total.
fn read_track_tag_summary(path: &Path) -> Result<AudioPlaylistTrackTagSummary, AudioCommandError> {
    let tagged_file = Probe::open(path)
        .and_then(|probe| probe.guess_file_type().map_err(LoftyError::from))
        .and_then(|probe| {
            probe
                .options(ParseOptions::new().read_cover_art(false))
                .read()
        })
        .map_err(|error| {
            tracing::debug!(
                operation = OPERATION,
                path = %path.display(),
                error = %error,
                "playlist track summary tag probe failed",
            );
            tag_read_error(&error)
        })?;

    let properties = tagged_file.properties();
    let mut summary = AudioPlaylistTrackTagSummary {
        title: None,
        artist: None,
        album: None,
        album_artist: None,
        composer: None,
        year: None,
        bit_depth: properties.bit_depth(),
        sample_rate_hz: properties.sample_rate(),
        bitrate_kbps: properties.audio_bitrate(),
        codec: path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_uppercase()),
    };

    // A readable file without tags is a valid outcome, not an error: the summary
    // is returned with every text field left at `None`.
    if let Some(tag) = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
    {
        summary.title = tag.title().map(|value| value.into_owned());
        summary.artist = tag.artist().map(|value| value.into_owned());
        summary.album = tag.album().map(|value| value.into_owned());
        summary.album_artist = tag_text(tag, ItemKey::AlbumArtist);
        summary.composer = tag_text(tag, ItemKey::Composer);
        summary.year = tag
            .date()
            .map(|timestamp| u32::from(timestamp.year))
            .filter(|year| *year > 0);
    }

    Ok(summary)
}

fn tag_read_error(error: &LoftyError) -> AudioCommandError {
    match error.kind() {
        ErrorKind::Io(io) if io.kind() == std::io::ErrorKind::NotFound => audio_error(
            AudioErrorCode::FileNotFound,
            "Audio file does not exist",
            true,
        ),
        ErrorKind::Io(_) => audio_error(
            AudioErrorCode::UnreadableFile,
            format!("Failed to read audio file: {error}"),
            true,
        ),
        ErrorKind::UnknownFormat => audio_error(
            AudioErrorCode::UnsupportedFormat,
            format!("Audio file format is not supported: {error}"),
            true,
        ),
        _ => audio_error(
            AudioErrorCode::UnreadableFile,
            format!("Failed to read audio tags: {error}"),
            true,
        ),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
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
                "spmusic-playlist-summary-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&root).unwrap();
            let wav = root.join("摘要.wav");
            fs::write(&wav, one_second_wav()).unwrap();
            Self { root, wav }
        }

        fn wav_path(&self) -> String {
            self.wav.to_string_lossy().into_owned()
        }

        /// Every file below `root`, with its length: a written or rewritten file
        /// changes either the name set or a length.
        fn listing(&self) -> BTreeMap<String, u64> {
            fn walk(root: &Path, current: &Path, out: &mut BTreeMap<String, u64>) {
                for entry in fs::read_dir(current).unwrap() {
                    let path = entry.unwrap().path();
                    if path.is_dir() {
                        out.insert(
                            format!("{}/", path.strip_prefix(root).unwrap().display()),
                            0,
                        );
                        walk(root, &path, out);
                    } else {
                        out.insert(
                            path.strip_prefix(root).unwrap().display().to_string(),
                            fs::metadata(&path).unwrap().len(),
                        );
                    }
                }
            }

            let mut out = BTreeMap::new();
            walk(&self.root, &self.root, &mut out);
            out
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    /// One second of 8 kHz mono 16-bit PCM, generated without external tools.
    fn one_second_wav() -> Vec<u8> {
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
        bytes
    }

    fn empty_summary() -> AudioPlaylistTrackTagSummary {
        AudioPlaylistTrackTagSummary {
            title: None,
            artist: None,
            album: None,
            album_artist: None,
            composer: None,
            year: None,
            bit_depth: None,
            sample_rate_hz: None,
            bitrate_kbps: None,
            codec: None,
        }
    }

    fn probe(paths: Vec<String>) -> Vec<AudioPlaylistTrackSummaryItem> {
        tauri::async_runtime::block_on(probe_playlist_track_summaries(
            AudioProbePlaylistTrackSummariesInput { paths },
        ))
        .expect("batch should not be rejected")
    }

    fn error_code(item: &AudioPlaylistTrackSummaryItem) -> AudioErrorCode {
        item.error
            .as_ref()
            .expect("item should carry an error")
            .code
    }

    #[test]
    fn batch_probes_real_wav_in_order_with_duplicates_and_exact_path_echo() {
        let fixture = Fixture::new();
        let wav = fixture.wav_path();
        let alternate = fixture
            .root
            .join(".")
            .join("摘要.wav")
            .to_string_lossy()
            .into_owned();
        let missing = fixture
            .root
            .join("missing.wav")
            .to_string_lossy()
            .into_owned();
        let paths = vec![wav.clone(), wav.clone(), alternate, missing];
        let items = probe(paths.clone());

        assert_eq!(items.len(), paths.len());
        for (item, requested) in items.iter().zip(&paths) {
            assert_eq!(&item.source_path, requested);
        }

        for index in [0, 1, 2] {
            let summary = items[index]
                .summary
                .as_ref()
                .expect("readable wav must return a summary");
            assert!(items[index].error.is_none());
            // No tag was written: text fields are null, not an error.
            assert_eq!(summary.title, None);
            assert_eq!(summary.artist, None);
            assert_eq!(summary.album, None);
            assert_eq!(summary.album_artist, None);
            assert_eq!(summary.composer, None);
            assert_eq!(summary.year, None);
            assert_eq!(summary.sample_rate_hz, Some(8_000));
            assert_eq!(summary.bit_depth, Some(16));
            assert_eq!(summary.bitrate_kbps, Some(128));
            assert_eq!(summary.codec.as_deref(), Some("WAV"));
        }

        assert!(items[3].summary.is_none());
        assert_eq!(error_code(&items[3]), AudioErrorCode::FileNotFound);
    }

    #[test]
    fn invalid_paths_and_missing_files_are_per_item_errors() {
        let fixture = Fixture::new();
        let items = probe(vec![
            "  ".into(),
            fixture.root.to_string_lossy().into_owned(),
            fixture
                .root
                .join("missing.flac")
                .to_string_lossy()
                .into_owned(),
            fixture.wav_path(),
        ]);

        assert_eq!(items.len(), 4);
        assert_eq!(error_code(&items[0]), AudioErrorCode::InvalidPath);
        assert_eq!(error_code(&items[1]), AudioErrorCode::InvalidPath);
        assert_eq!(error_code(&items[2]), AudioErrorCode::FileNotFound);
        for item in &items[..3] {
            assert!(item.summary.is_none());
        }
        // The failures never disturb the healthy neighbour in the same batch.
        assert!(items[3].error.is_none());
        assert_eq!(
            items[3].summary.as_ref().unwrap().codec.as_deref(),
            Some("WAV")
        );
    }

    #[test]
    fn empty_batch_is_accepted_and_the_batch_limit_is_enforced() {
        assert!(probe(Vec::new()).is_empty());

        let accepted = probe(vec![String::new(); MAX_BATCH_PATHS]);
        assert_eq!(accepted.len(), MAX_BATCH_PATHS);
        assert!(accepted
            .iter()
            .all(|item| item.summary.is_none() && item.error.is_some()));

        let rejected = tauri::async_runtime::block_on(probe_playlist_track_summaries(
            AudioProbePlaylistTrackSummariesInput {
                paths: vec![String::new(); MAX_BATCH_PATHS + 1],
            },
        ))
        .unwrap_err();
        assert_eq!(
            serde_json::to_value(rejected).unwrap()["code"],
            "INVALID_PATH"
        );
    }

    #[test]
    fn probe_never_writes_any_file_or_cover_cache_directory() {
        let fixture = Fixture::new();
        let before = fixture.listing();
        let wav = fixture.wav_path();
        let items = probe(vec![wav.clone(), wav.clone(), wav]);
        assert_eq!(items.len(), 3);
        assert!(items.iter().all(|item| item.summary.is_some()));
        assert_eq!(fixture.listing(), before);
        // The probe has no cover-cache parameter at all; keep proving that no
        // cache directory appears next to the audio anyway.
        assert!(!fixture.root.join("covers").exists());
        assert!(!fixture.root.join(".spmusic").exists());
        assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 1);
    }

    #[test]
    fn tagged_wav_exposes_title_artist_and_album() {
        use lofty::{
            config::WriteOptions,
            tag::{Tag, TagExt, TagType},
        };

        let fixture = Fixture::new();
        // lofty 0.24 writes RIFF INFO LIST tags into WAV files; its ID3v2 WAV
        // writer is likewise supported, but RIFF INFO is the native WAV tag and
        // keeps this fixture free of extra formats.
        let mut tag = Tag::new(TagType::RiffInfo);
        tag.insert_text(ItemKey::TrackTitle, "摘要标题".to_owned());
        tag.insert_text(ItemKey::TrackArtist, "摘要歌手".to_owned());
        tag.insert_text(ItemKey::AlbumTitle, "摘要专辑".to_owned());
        tag.save_to_path(&fixture.wav, WriteOptions::default())
            .expect("lofty should write a RIFF INFO tag into a WAV file");
        let reread = Probe::open(&fixture.wav)
            .unwrap()
            .read()
            .expect("written tag should be readable");
        assert!(reread.primary_tag().is_some() || reread.first_tag().is_some());

        let items = probe(vec![fixture.wav_path()]);
        let summary = items[0]
            .summary
            .as_ref()
            .expect("tagged wav must return a summary");
        assert!(items[0].error.is_none());
        assert_eq!(summary.title.as_deref(), Some("摘要标题"));
        assert_eq!(summary.artist.as_deref(), Some("摘要歌手"));
        assert_eq!(summary.album.as_deref(), Some("摘要专辑"));
    }

    #[test]
    fn contributor_tags_remain_independent_in_summary_and_hydration_metadata() {
        use lofty::{
            config::WriteOptions,
            tag::{Tag, TagExt, TagType},
        };

        let fixture = Fixture::new();
        // ID3v2 in WAV carries all three contributor fields, unlike RIFF INFO
        // which has no standard album-artist field.
        for composer in [Some("作曲甲/作曲乙"), None] {
            let mut tag = Tag::new(TagType::Id3v2);
            tag.insert_text(ItemKey::TrackArtist, "演唱者".to_owned());
            tag.insert_text(ItemKey::AlbumArtist, "专辑署名".to_owned());
            if let Some(composer) = composer {
                tag.insert_text(ItemKey::Composer, composer.to_owned());
            }
            tag.save_to_path(&fixture.wav, WriteOptions::default())
                .expect("write independent contributor tags");
            let before = fs::read(&fixture.wav).unwrap();
            let items = probe(vec![fixture.wav_path()]);
            let summary = items[0].summary.as_ref().expect("read contributor tags");
            let metadata = super::super::metadata::read_embedded_metadata(&fixture.wav, None)
                .expect("read the same tags through hydration metadata");

            assert_eq!(summary.artist.as_deref(), Some("演唱者"));
            assert_eq!(summary.album_artist.as_deref(), Some("专辑署名"));
            assert_eq!(summary.composer.as_deref(), composer);
            assert_eq!(metadata.artist, summary.artist);
            assert_eq!(metadata.album_artist, summary.album_artist);
            assert_eq!(metadata.composer, summary.composer);
            let serialized = serde_json::to_value(&metadata).unwrap();
            assert_eq!(
                serialized["composer"],
                serde_json::to_value(composer).unwrap()
            );
            assert_eq!(
                fs::read(&fixture.wav).unwrap(),
                before,
                "tag reads never modify audio"
            );
        }
    }

    #[test]
    fn tagged_wav_year_is_read_from_date_and_invalid_or_absent_years_are_null() {
        use lofty::{
            config::WriteOptions,
            tag::{Tag, TagExt, TagType},
        };

        for (date, expected) in [
            (Some("2023-06-15"), Some(2023)),
            (Some("0000"), None),
            (Some("invalid"), None),
            (None, None),
        ] {
            let fixture = Fixture::new();
            if let Some(date) = date {
                let mut tag = Tag::new(TagType::RiffInfo);
                tag.insert_text(ItemKey::RecordingDate, date.to_owned());
                tag.save_to_path(&fixture.wav, WriteOptions::default())
                    .expect("write date fixture");
            }
            let before = fixture.listing();
            let items = probe(vec![fixture.wav_path()]);
            let summary = items[0].summary.as_ref().expect("readable date fixture");
            assert!(items[0].error.is_none());
            assert_eq!(summary.year, expected, "date {date:?}");
            assert_eq!(
                serde_json::to_value(summary).unwrap()["year"],
                serde_json::to_value(expected).unwrap(),
            );
            assert_eq!(fixture.listing(), before, "summary must remain read-only");
        }
    }

    #[test]
    fn panicking_item_is_isolated_and_releases_the_batch_permit() {
        let fixture = Fixture::new();
        let poisoned = fixture.wav_path();
        let clean = fixture.root.join("clean.wav");
        fs::copy(&fixture.wav, &clean).unwrap();
        let clean = clean.to_string_lossy().into_owned();

        let poison = poisoned.clone();
        let reader = move |path: &Path| -> Result<AudioPlaylistTrackTagSummary, AudioCommandError> {
            if path == Path::new(&poison) {
                panic!("synthetic per-item failure");
            }
            read_track_tag_summary(path)
        };
        let gate = Arc::new(Mutex::new(()));
        let items = tauri::async_runtime::block_on(run_track_summary_worker(
            gate.clone(),
            vec![poisoned.clone(), clean],
            reader,
        ))
        .expect("a panicking item must not fail the batch");

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].source_path, poisoned);
        assert!(items[0].summary.is_none());
        assert_eq!(error_code(&items[0]), AudioErrorCode::InternalError);
        assert!(items[1].error.is_none());
        assert_eq!(
            items[1].summary.as_ref().unwrap().codec.as_deref(),
            Some("WAV")
        );

        // The blocking worker released the permit, so the next batch runs.
        assert!(gate.try_lock().is_ok());
        let recovered = tauri::async_runtime::block_on(run_track_summary_worker(
            gate,
            vec![poisoned],
            |_: &Path| Ok(empty_summary()),
        ))
        .expect("the next batch must still be able to take the permit");
        assert_eq!(recovered.len(), 1);
        assert!(recovered[0].error.is_none());
    }

    #[test]
    fn summary_fields_serialize_as_camel_case_nulls_never_omitted() {
        use ts_rs::{Config, TS};

        let item = AudioPlaylistTrackSummaryItem {
            source_path: "music.flac".to_owned(),
            summary: Some(empty_summary()),
            error: None,
        };
        let value = serde_json::to_value(item).unwrap();
        assert_eq!(value["sourcePath"], "music.flac");
        assert!(value["error"].is_null());
        let summary = &value["summary"];
        for field in [
            "album",
            "albumArtist",
            "artist",
            "bitDepth",
            "bitrateKbps",
            "codec",
            "composer",
            "sampleRateHz",
            "title",
            "year",
        ] {
            assert!(summary.get(field).is_some(), "{field} must be present");
            assert!(summary[field].is_null(), "{field} must be null");
        }
        assert!(summary.get("source_path").is_none());
        assert!(summary.get("duration_ms").is_none());
        assert!(summary.get("durationMs").is_none());

        // The frontend consumes the generated TypeScript types, so the exported
        // contract (not only the JSON) has to stay camelCase and BigInt-free.
        let item_ty = AudioPlaylistTrackSummaryItem::export_to_string(&Config::default())
            .expect("item should export to TypeScript");
        assert!(item_ty.contains("sourcePath: string"));
        assert!(item_ty.contains("summary: AudioPlaylistTrackTagSummary | null"));
        assert!(item_ty.contains("error: AudioCommandError | null"));
        let summary_ty = AudioPlaylistTrackTagSummary::export_to_string(&Config::default())
            .expect("summary should export to TypeScript");
        assert!(summary_ty.contains("albumArtist: string | null"));
        assert!(summary_ty.contains("composer: string | null"));
        assert!(summary_ty.contains("year: number | null"));
        assert!(summary_ty.contains("sampleRateHz: number | null"));
        assert!(
            !summary_ty.contains("durationMs"),
            "duration stays off the summary contract (risk R1)"
        );
        assert!(!summary_ty.contains("bigint"));
        let input_ty = AudioProbePlaylistTrackSummariesInput::export_to_string(&Config::default())
            .expect("input should export to TypeScript");
        assert!(input_ty.contains("paths: Array<string>"));
    }
}
