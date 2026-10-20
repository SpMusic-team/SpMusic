//! Cover-only source I/O, isolated from playback decoding, duration and lyrics.
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, OnceLock,
    },
};

use lofty::{
    config::ParseOptions,
    error::{ErrorKind, LoftyError},
    file::TaggedFileExt,
    probe::Probe,
};
use tauri::async_runtime::Mutex;

use super::{
    cover_cache::bounded_playlist_cover_from_tag,
    error::{audio_error, AudioCommandError, AudioErrorCode},
    source::{input_path, track_id, validate_existing_file},
    types::{AudioLoadFileInput, AudioPlaylistCoverSource},
};

const MAX_REQUESTS: usize = 32;
static COORDINATOR: OnceLock<CoverSourceCoordinator> = OnceLock::new();

struct RequestReservation(Arc<AtomicUsize>);
impl Drop for RequestReservation {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

struct CoverSourceCoordinator {
    gate: Arc<Mutex<()>>,
    requests: Arc<AtomicUsize>,
}

impl CoverSourceCoordinator {
    fn new() -> Self {
        Self {
            gate: Arc::new(Mutex::new(())),
            requests: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn reserve(&self) -> Result<RequestReservation, AudioCommandError> {
        self.requests
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < MAX_REQUESTS).then_some(n + 1)
            })
            .map_err(|_| {
                audio_error(
                    AudioErrorCode::InternalError,
                    "Playlist cover source queue is full",
                    true,
                )
            })?;
        Ok(RequestReservation(Arc::clone(&self.requests)))
    }

    async fn run<T, F>(&self, work: F) -> Result<T, AudioCommandError>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, AudioCommandError> + Send + 'static,
    {
        let request = self.reserve()?;
        let permit = Arc::clone(&self.gate).lock_owned().await;
        let (result, _request) = tauri::async_runtime::spawn_blocking(move || {
            // Cancellation of the async caller cannot release an active I/O slot.
            let _permit = permit;
            (work(), request)
        })
        .await
        .map_err(|_| {
            audio_error(
                AudioErrorCode::InternalError,
                "Playlist cover source worker failed",
                true,
            )
        })?;
        result
    }
}

pub(crate) async fn probe_playlist_cover(
    app_cache_dir: PathBuf,
    input: AudioLoadFileInput,
) -> Result<AudioPlaylistCoverSource, AudioCommandError> {
    // Reject empty paths before reserving a worker; all actual file I/O is blocking.
    input_path(&input.path)?;
    COORDINATOR
        .get_or_init(CoverSourceCoordinator::new)
        .run(move || probe_playlist_cover_blocking(&app_cache_dir, &input.path))
        .await
}

pub(crate) fn probe_playlist_cover_blocking(
    app_cache_dir: &Path,
    requested_path: &str,
) -> Result<AudioPlaylistCoverSource, AudioCommandError> {
    let path = input_path(requested_path)?;
    validate_existing_file(&path)?;
    let tagged = Probe::open(&path)
        .and_then(|probe| probe.guess_file_type().map_err(LoftyError::from))
        .and_then(|probe| {
            probe
                .options(
                    ParseOptions::new()
                        .read_properties(false)
                        .read_cover_art(true),
                )
                .read()
        })
        .map_err(tag_error)?;
    let cover_art = tagged
        .primary_tag()
        .or_else(|| tagged.first_tag())
        .map(|tag| bounded_playlist_cover_from_tag(tag, app_cache_dir))
        .transpose()?
        .flatten();
    Ok(AudioPlaylistCoverSource {
        id: track_id(&path),
        source_path: path.to_string_lossy().into_owned(),
        cover_art,
    })
}

fn tag_error(error: LoftyError) -> AudioCommandError {
    let code = match error.kind() {
        ErrorKind::Io(io) if io.kind() == std::io::ErrorKind::NotFound => {
            AudioErrorCode::FileNotFound
        }
        ErrorKind::Io(io)
            if matches!(
                io.kind(),
                std::io::ErrorKind::UnexpectedEof | std::io::ErrorKind::InvalidData
            ) =>
        {
            AudioErrorCode::UnsupportedFormat
        }
        ErrorKind::Io(_) => AudioErrorCode::UnreadableFile,
        ErrorKind::Alloc(_) => AudioErrorCode::InternalError,
        _ => AudioErrorCode::UnsupportedFormat,
    };
    audio_error(
        code,
        "Audio tags could not be read for the playlist cover",
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use lofty::{
        config::WriteOptions,
        picture::{MimeType, Picture, PictureType},
        tag::{Tag, TagExt, TagType},
    };
    use std::{fs, sync::mpsc, time::Duration};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "spmusic-cover-source-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn wav(&self) -> PathBuf {
            let path = self.0.join("source.wav");
            let mut bytes = Vec::new();
            bytes.extend_from_slice(b"RIFF");
            bytes.extend_from_slice(&52u32.to_le_bytes());
            bytes.extend_from_slice(b"WAVEfmt ");
            bytes.extend_from_slice(&16u32.to_le_bytes());
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&8000u32.to_le_bytes());
            bytes.extend_from_slice(&16000u32.to_le_bytes());
            bytes.extend_from_slice(&2u16.to_le_bytes());
            bytes.extend_from_slice(&16u16.to_le_bytes());
            bytes.extend_from_slice(b"data");
            bytes.extend_from_slice(&16u32.to_le_bytes());
            bytes.resize(60, 0);
            fs::write(&path, bytes).unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn tag(path: &Path, value: u8) {
        let mut tag = Tag::new(TagType::Id3v2);
        for (kind, bytes) in [
            (PictureType::Other, vec![0xff, 0xd8, 0xff, 0xd9]),
            (
                PictureType::CoverFront,
                vec![0x89, b'P', b'N', b'G', 13, 10, 26, 10, value],
            ),
        ] {
            tag.push_picture(
                Picture::unchecked(bytes)
                    .pic_type(kind)
                    .mime_type(if kind == PictureType::CoverFront {
                        MimeType::Png
                    } else {
                        MimeType::Jpeg
                    })
                    .build(),
            );
        }
        tag.save_to_path(path, WriteOptions::default()).unwrap();
    }

    #[test]
    fn cover_only_probes_tags_and_preserves_identity_without_full_metadata() {
        let f = Fixture::new();
        let path = f.wav();
        let input = path.to_str().unwrap();
        fs::create_dir(path.with_extension("lrc")).unwrap();
        assert!(probe_playlist_cover_blocking(&f.0, input)
            .unwrap()
            .cover_art
            .is_none());
        tag(&path, 7);
        let before = fs::read(&path).unwrap();
        let original_modified = fs::metadata(&path).unwrap().modified().unwrap();
        let result = probe_playlist_cover_blocking(&f.0, input).unwrap();
        assert_eq!(result.id, track_id(&path));
        assert_eq!(result.source_path, input);
        let cover = result.cover_art.unwrap();
        assert_eq!(cover.mime_type, "image/png");
        assert_eq!(
            fs::read(cover.file_path.unwrap()).unwrap(),
            [0x89, b'P', b'N', b'G', 13, 10, 26, 10, 7]
        );
        assert_eq!(before, fs::read(&path).unwrap());
        let serialized =
            serde_json::to_value(probe_playlist_cover_blocking(&f.0, input).unwrap()).unwrap();
        assert_eq!(serialized.as_object().unwrap().len(), 3);
        assert!(serialized.get("metadata").is_none());
        assert!(serialized.get("durationMs").is_none());
        let first = serialized["coverArt"]["filePath"].clone();
        tag(&path, 8);
        assert_eq!(fs::metadata(&path).unwrap().len(), before.len() as u64);
        std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(original_modified)
            .unwrap();
        let changed = probe_playlist_cover_blocking(&f.0, input).unwrap();
        assert_ne!(
            serde_json::to_value(changed.cover_art.unwrap()).unwrap()["filePath"],
            first
        );
    }

    #[test]
    fn cover_only_reads_flac_picture_without_audio_frames_or_duration() {
        let f = Fixture::new();
        let path = f.0.join("tags-only.flac");
        let mut streaminfo = vec![0u8; 34];
        streaminfo[0..4].copy_from_slice(&[0x10, 0, 0x10, 0]);
        let packed = (8000u64 << 44) | (15u64 << 36);
        streaminfo[10..18].copy_from_slice(&packed.to_be_bytes());
        let mut bytes = b"fLaC".to_vec();
        bytes.extend_from_slice(&[0x80, 0, 0, 34]);
        bytes.extend_from_slice(&streaminfo);
        fs::write(&path, &bytes).unwrap();
        assert!(probe_playlist_cover_blocking(&f.0, path.to_str().unwrap())
            .unwrap()
            .cover_art
            .is_none());
        bytes[4] = 0;
        let png = [0x89, b'P', b'N', b'G', 13, 10, 26, 10, 9];
        let mut picture = Vec::new();
        picture.extend_from_slice(&3u32.to_be_bytes());
        picture.extend_from_slice(&9u32.to_be_bytes());
        picture.extend_from_slice(b"image/png");
        for value in [0u32, 1, 1, 32, 0, png.len() as u32] {
            picture.extend_from_slice(&value.to_be_bytes());
        }
        picture.extend_from_slice(&png);
        bytes.push(0x86);
        bytes.extend_from_slice(&(picture.len() as u32).to_be_bytes()[1..]);
        bytes.extend_from_slice(&picture);
        fs::write(&path, &bytes).unwrap();
        let cover = probe_playlist_cover_blocking(&f.0, path.to_str().unwrap())
            .unwrap()
            .cover_art
            .unwrap();
        assert_eq!(fs::read(cover.file_path.unwrap()).unwrap(), png);
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn cover_only_reports_errors_instead_of_claiming_no_cover() {
        let f = Fixture::new();
        assert_eq!(
            probe_playlist_cover_blocking(&f.0, "  ").unwrap_err().code,
            AudioErrorCode::InvalidPath
        );
        assert_eq!(
            probe_playlist_cover_blocking(&f.0, f.0.join("missing.wav").to_str().unwrap())
                .unwrap_err()
                .code,
            AudioErrorCode::FileNotFound
        );
        assert_eq!(
            probe_playlist_cover_blocking(&f.0, f.0.to_str().unwrap())
                .unwrap_err()
                .code,
            AudioErrorCode::InvalidPath
        );
        let corrupt = f.0.join("unknown.bin");
        fs::write(&corrupt, [b'x'; 128]).unwrap();
        assert_eq!(
            probe_playlist_cover_blocking(&f.0, corrupt.to_str().unwrap())
                .unwrap_err()
                .code,
            AudioErrorCode::UnsupportedFormat
        );
        assert_eq!(
            tag_error(std::io::Error::from(std::io::ErrorKind::PermissionDenied).into()).code,
            AudioErrorCode::UnreadableFile
        );
    }

    #[test]
    fn cancelled_cover_source_retains_worker_slot_and_request_until_completion() {
        let coordinator = Arc::new(CoverSourceCoordinator::new());
        let c = Arc::clone(&coordinator);
        let (started, did_start) = mpsc::channel();
        let (release, wait_release) = mpsc::channel();
        let task = tauri::async_runtime::spawn(async move {
            c.run(move || {
                started.send(()).unwrap();
                wait_release.recv().unwrap();
                Ok(())
            })
            .await
        });
        did_start.recv_timeout(Duration::from_secs(5)).unwrap();
        task.abort();
        assert!(tauri::async_runtime::block_on(task).is_err());
        assert!(coordinator.gate.try_lock().is_err());
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 1);
        release.send(()).unwrap();
        tauri::async_runtime::block_on(coordinator.run(|| Ok(()))).unwrap();
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 0);
        let reservations: Vec<_> = (0..MAX_REQUESTS)
            .map(|_| coordinator.reserve().unwrap())
            .collect();
        let error = tauri::async_runtime::block_on(
            coordinator.run(|| -> Result<(), _> { panic!("full queue must reject work") }),
        )
        .unwrap_err();
        assert_eq!(error.code, AudioErrorCode::InternalError);
        drop(reservations);
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 0);
        tauri::async_runtime::block_on(coordinator.run(|| Ok(()))).unwrap();
    }

    #[test]
    fn cover_source_panic_releases_admission() {
        let coordinator = CoverSourceCoordinator::new();
        let error = tauri::async_runtime::block_on(
            coordinator.run(|| -> Result<(), _> { panic!("injected panic") }),
        )
        .unwrap_err();
        assert_eq!(error.code, AudioErrorCode::InternalError);
        assert_eq!(coordinator.requests.load(Ordering::Acquire), 0);
        assert!(coordinator.gate.try_lock().is_ok());
        tauri::async_runtime::block_on(coordinator.run(|| Ok(()))).unwrap();
    }
}
