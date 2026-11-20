use super::super::{
    cover_pixels, metadata, playlist_cover,
    types::{AudioCoverArt, AudioLoadFileInput},
};
use super::*;
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use lofty::{
    config::WriteOptions,
    picture::{MimeType, Picture, PictureType},
    tag::{Tag, TagExt, TagType},
};
use std::{
    io::Cursor,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    base: PathBuf,
    root: PathBuf,
    cache: PathBuf,
    audio: PathBuf,
}
impl Fixture {
    fn new(embedded: Option<u8>) -> Self {
        let base = std::env::temp_dir().join(format!(
            "spmusic-sibling-cover-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let root = base.join("root");
        let cache = base.join("cache");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(cache.join("audio")).unwrap();
        let audio = root.join("song.wav");
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
        fs::write(&audio, bytes).unwrap();
        if let Some(color) = embedded {
            let mut tag = Tag::new(TagType::Id3v2);
            tag.push_picture(
                Picture::unchecked(png(color))
                    .pic_type(PictureType::CoverFront)
                    .mime_type(MimeType::Png)
                    .build(),
            );
            tag.save_to_path(&audio, WriteOptions::default()).unwrap();
        }
        Self {
            base,
            root,
            cache,
            audio,
        }
    }
    fn colors(&self) -> [Option<u8>; 3] {
        let pixels = cover_pixels::load_track_thumbnail_blocking(
            &self.cache,
            self.audio.to_str().unwrap(),
            128,
            || true,
        )
        .unwrap();
        let probe = tauri::async_runtime::block_on(playlist_cover::probe_playlist_cover(
            self.cache.clone(),
            AudioLoadFileInput {
                path: self.audio.to_string_lossy().into_owned(),
            },
        ))
        .unwrap();
        let meta = metadata::read_metadata(&self.audio, Some(&self.cache.join("audio")), None);
        [
            (!pixels.is_empty()).then(|| pixels[40]),
            art_color(probe.cover_art),
            art_color(meta.cover_art),
        ]
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}
fn png(color: u8) -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([color, 0, 0, 255])))
        .write_to(&mut bytes, ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}
fn art_color(art: Option<AudioCoverArt>) -> Option<u8> {
    use base64::Engine;
    let art = art?;
    let bytes = match art.file_path {
        Some(path) => fs::read(path).unwrap(),
        None => base64::engine::general_purpose::STANDARD
            .decode(art.data_url.unwrap().split_once(',').unwrap().1)
            .unwrap(),
    };
    Some(
        image::load_from_memory(&bytes)
            .unwrap()
            .to_rgba8()
            .get_pixel(0, 0)[0],
    )
}

#[test]
fn sibling_changes_refresh_all_three_entries_after_negative_embedded_cache() {
    let f = Fixture::new(None);
    assert_eq!(f.colors(), [None; 3]);
    let audio_before = fs::read(&f.audio).unwrap();
    let sidecar = f.root.join("cover.png");
    fs::write(&sidecar, png(30)).unwrap();
    assert_eq!(f.colors(), [Some(30); 3]);
    let changed = png(70);
    assert_eq!(
        changed.len(),
        fs::metadata(&sidecar).unwrap().len() as usize
    );
    fs::write(&sidecar, changed).unwrap();
    assert_eq!(f.colors(), [Some(70); 3]);
    fs::remove_file(sidecar).unwrap();
    assert_eq!(f.colors(), [None; 3]);
    assert_eq!(fs::read(&f.audio).unwrap(), audio_before);
    assert!(
        playlist_cover::probe_playlist_cover_coalesced(&f.cache, f.audio.to_str().unwrap())
            .unwrap()
            .cover_art
            .is_none()
    );
}

#[test]
fn embedded_cover_wins_in_all_three_entries() {
    let f = Fixture::new(Some(100));
    fs::write(f.root.join("cover.png"), png(30)).unwrap();
    assert_eq!(f.colors(), [Some(100); 3]);
}

#[test]
fn only_direct_decodable_images_are_used_in_stable_order() {
    let f = Fixture::new(None);
    fs::create_dir_all(f.root.join("child")).unwrap();
    fs::write(f.root.join("child/cover.png"), png(100)).unwrap();
    assert_eq!(f.colors(), [None; 3]);
    fs::write(f.root.join("00-bad.png"), b"not image").unwrap();
    fs::write(f.root.join("z.png"), png(30)).unwrap();
    fs::write(f.root.join("A.PNG"), png(70)).unwrap();
    assert_eq!(f.colors(), [Some(70); 3]);
    assert!(metadata::read_embedded_metadata(&f.audio, None)
        .unwrap()
        .cover_art
        .is_none());
}

#[test]
fn metadata_without_cache_uses_bounded_data_url_and_preserves_nonthrow_behavior() {
    let f = Fixture::new(None);
    fs::write(f.root.join("cover.png"), png(30)).unwrap();
    let meta = metadata::read_metadata(&f.audio, None, None);
    assert!(meta.cover_art.as_ref().unwrap().file_path.is_none());
    assert_eq!(art_color(meta.cover_art), Some(30));
    fs::write(&f.audio, b"invalid audio tags").unwrap();
    assert_eq!(
        art_color(metadata::read_metadata(&f.audio, None, None).cover_art),
        Some(30)
    );
}

#[test]
fn unsafe_cache_namespace_returns_data_url_without_following_junction() {
    let f = Fixture::new(None);
    fs::write(f.root.join("cover.png"), png(30)).unwrap();
    let outside = f.base.join("outside");
    fs::create_dir_all(&outside).unwrap();
    let alias = f.cache.join("audio").join("covers");
    #[cfg(windows)]
    {
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&alias)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(output.status.success(), "junction fixture: {:?}", output);
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, &alias).unwrap();
    let art = sibling_cover_art(f.audio.to_str().unwrap(), Some(&f.cache.join("audio")))
        .unwrap()
        .unwrap();
    assert!(art.file_path.is_none());
    assert_eq!(art_color(Some(art)), Some(30));
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
}

#[test]
fn directory_decode_slot_is_released_and_thumbnail_does_not_nest() {
    let f = Fixture::new(None);
    fs::write(f.root.join("cover.png"), png(30)).unwrap();
    assert!(
        cover_pixels::with_directory_decode_slot::<()>(|| Err(invalid_path("fixture error")))
            .is_err()
    );
    assert_eq!(
        cover_pixels::with_directory_decode_slot(|| Ok(17)).unwrap(),
        17
    );
    let cache = f.cache.clone();
    let source = f.audio.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    let mut worker = None;
    // Exhausting every global permit is equivalent to a one-slot pool with its
    // only permit already owned by the caller. The inner thumbnail path must
    // still complete rather than trying to acquire another one.
    let result = cover_pixels::with_all_directory_slots_held_for_test(|| {
        worker = Some(std::thread::spawn(move || {
            let result = cover_pixels::load_track_thumbnail_blocking(
                &cache,
                source.to_str().unwrap(),
                128,
                || true,
            );
            let _ = sender.send(result);
        }));
        receiver.recv_timeout(std::time::Duration::from_secs(3))
    });
    worker.unwrap().join().unwrap();
    assert_eq!(
        result
            .expect("thumbnail must not acquire a nested slot")
            .unwrap()[40],
        30
    );
}
