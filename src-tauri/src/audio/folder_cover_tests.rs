use super::*;
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use lofty::{
    config::WriteOptions,
    picture::{MimeType, Picture, PictureType},
    tag::{Tag, TagExt, TagType},
};
use std::{
    io::Cursor,
    sync::atomic::{AtomicU64, AtomicUsize, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    base: PathBuf,
    root: PathBuf,
    cache: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let base = std::env::temp_dir().join(format!(
            "spmusic-folder-cover-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let root = base.join("root");
        fs::create_dir_all(&root).unwrap();
        Self {
            cache: base.join("cache"),
            base,
            root,
        }
    }
    fn cover(&self) -> Result<Vec<u8>, CoverPixelsError> {
        load_folder_thumbnail_blocking(
            &self.cache,
            self.root.to_str().unwrap(),
            self.root.to_str().unwrap(),
            128,
            || true,
        )
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
fn image(path: &Path, color: u8) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, png(color)).unwrap();
}
fn wav(path: &Path, cover: Option<Vec<u8>>) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
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
    fs::write(path, bytes).unwrap();
    if let Some(cover) = cover {
        let mut tag = Tag::new(TagType::Id3v2);
        tag.push_picture(
            Picture::unchecked(cover)
                .pic_type(PictureType::CoverFront)
                .mime_type(MimeType::Png)
                .build(),
        );
        tag.save_to_path(path, WriteOptions::default()).unwrap();
    }
}
fn color(bytes: &[u8]) -> u8 {
    assert_eq!(&bytes[..4], b"SPXR");
    bytes[40]
}

#[test]
fn local_image_wins_over_local_and_descendant_song() {
    let f = Fixture::new();
    image(&f.root.join("art.PNG"), 30);
    wav(&f.root.join("song.wav"), Some(png(70)));
    image(&f.root.join("child/deep.png"), 100);
    assert_eq!(color(&f.cover().unwrap()), 30);
}

#[test]
fn shallow_song_wins_over_deep_image_and_skips_uncovered_song() {
    let f = Fixture::new();
    wav(&f.root.join("a.wav"), None);
    wav(&f.root.join("b.wav"), Some(png(70)));
    image(&f.root.join("child/image.png"), 100);
    assert_eq!(color(&f.cover().unwrap()), 70);
}

#[test]
fn whole_depth_images_win_over_earlier_sibling_songs() {
    let f = Fixture::new();
    wav(&f.root.join("a/song.wav"), Some(png(70)));
    image(&f.root.join("z/image.png"), 100);
    assert_eq!(color(&f.cover().unwrap()), 100);
}

#[test]
fn breadth_first_song_wins_over_earlier_branch_deeper_image() {
    let f = Fixture::new();
    image(&f.root.join("a/deep/image.png"), 30);
    wav(&f.root.join("z/song.wav"), Some(png(70)));
    assert_eq!(color(&f.cover().unwrap()), 70);
}

#[test]
fn bad_images_and_embedded_covers_continue_to_a_decodable_candidate() {
    let f = Fixture::new();
    fs::write(f.root.join("art.png"), b"broken").unwrap();
    wav(&f.root.join("a.wav"), Some(b"broken image".to_vec()));
    wav(&f.root.join("b.wav"), Some(png(70)));
    assert_eq!(color(&f.cover().unwrap()), 70);
}

#[test]
fn stable_sort_and_repeated_requests_choose_same_picture() {
    let f = Fixture::new();
    image(&f.root.join("z.png"), 30);
    image(&f.root.join("A.png"), 70);
    for _ in 0..3 {
        assert_eq!(color(&f.cover().unwrap()), 70);
    }
}

#[test]
fn no_artwork_in_entire_tree_returns_empty_payload() {
    let f = Fixture::new();
    wav(&f.root.join("a.wav"), None);
    wav(&f.root.join("child/b.wav"), None);
    assert!(f.cover().unwrap().is_empty());
}

#[test]
fn malformed_audio_is_unusable_content_not_a_directory_failure() {
    let f = Fixture::new();
    fs::write(f.root.join("broken.wav"), b"not audio").unwrap();
    assert!(f.cover().unwrap().is_empty());
}

#[test]
fn candidate_io_failure_is_not_negative_cached_but_can_fall_back() {
    for fallback in [false, true] {
        let f = Fixture::new();
        let disappearing = f.root.join("image.png");
        image(&disappearing, 30);
        if fallback {
            image(&f.root.join("child/image.png"), 70);
        }
        let calls = AtomicUsize::new(0);
        let result = load_folder_thumbnail_blocking(
            &f.cache,
            f.root.to_str().unwrap(),
            f.root.to_str().unwrap(),
            128,
            || {
                if calls.fetch_add(1, Ordering::Relaxed) == if fallback { 4 } else { 3 } {
                    fs::remove_file(&disappearing).unwrap();
                }
                true
            },
        );
        if fallback {
            assert_eq!(color(&result.unwrap()), 70);
        } else {
            assert!(matches!(
                result.unwrap_err().code,
                CoverPixelsErrorCode::InvalidPath
            ));
        }
    }
}

#[test]
fn invalid_paths_escape_and_max_edge_are_errors() {
    let f = Fixture::new();
    assert!(
        load_folder_thumbnail_blocking(&f.cache, "relative", "relative", 128, || true).is_err()
    );
    assert!(load_folder_thumbnail_blocking(
        &f.cache,
        f.root.to_str().unwrap(),
        f.base.to_str().unwrap(),
        128,
        || true
    )
    .is_err());
    assert!(load_folder_thumbnail_blocking(
        &f.cache,
        f.root.to_str().unwrap(),
        f.root.to_str().unwrap(),
        512,
        || true
    )
    .is_err());
    let missing = f.root.join("missing");
    assert!(load_folder_thumbnail_blocking(
        &f.cache,
        f.root.to_str().unwrap(),
        missing.to_str().unwrap(),
        128,
        || true
    )
    .is_err());
}

#[test]
fn current_generation_is_checked_while_walking() {
    let f = Fixture::new();
    image(&f.root.join("child/image.png"), 30);
    let calls = AtomicUsize::new(0);
    let error = load_folder_thumbnail_blocking(
        &f.cache,
        f.root.to_str().unwrap(),
        f.root.to_str().unwrap(),
        128,
        || calls.fetch_add(1, Ordering::Relaxed) < 2,
    )
    .unwrap_err();
    assert!(matches!(error.code, CoverPixelsErrorCode::StaleRequest));
}

#[test]
fn folder_command_uses_existing_window_generation_and_spxr_contract() {
    let f = Fixture::new();
    image(&f.root.join("image.png"), 30);
    let client_id = format!("folder-test-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let generation = super::super::cover_pixels::begin_playlist_cover_window(&client_id).unwrap();
    let input = super::super::cover_pixels::AudioLoadFolderThumbnailInput {
        client_id: client_id.clone(),
        root_path: f.root.to_string_lossy().into_owned(),
        directory_path: f.root.to_string_lossy().into_owned(),
        max_edge: 128,
        window_generation: generation,
    };
    tauri::async_runtime::block_on(async {
        assert_eq!(
            color(
                &super::super::cover_pixels::load_folder_thumbnail(f.cache.clone(), input.clone())
                    .await
                    .unwrap()
            ),
            30
        );
        super::super::cover_pixels::begin_playlist_cover_window(&client_id).unwrap();
        let error = super::super::cover_pixels::load_folder_thumbnail(f.cache.clone(), input)
            .await
            .unwrap_err();
        assert!(matches!(error.code, CoverPixelsErrorCode::StaleRequest));
    });
}

#[test]
fn links_and_junctions_are_not_followed() {
    let f = Fixture::new();
    let outside = f.base.join("outside");
    image(&outside.join("art.png"), 30);
    let alias = f.root.join("alias");
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_dir(&outside, &alias);
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(&outside, &alias);
    if linked.is_err() {
        #[cfg(windows)]
        {
            let status = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&alias)
                .arg(&outside)
                .output()
                .unwrap();
            assert!(status.status.success(), "junction fixture: {:?}", status);
        }
        #[cfg(not(windows))]
        panic!("cannot create link fixture: {linked:?}");
    }
    assert!(f.cover().unwrap().is_empty());
    assert!(load_folder_thumbnail_blocking(
        &f.cache,
        f.root.to_str().unwrap(),
        alias.to_str().unwrap(),
        128,
        || true
    )
    .is_err());
}

#[test]
fn canonical_scan_paths_are_accepted() {
    let f = Fixture::new();
    image(&f.root.join("child/image.png"), 30);
    let root = fs::canonicalize(&f.root).unwrap();
    let child = fs::canonicalize(f.root.join("child")).unwrap();
    assert_eq!(
        color(
            &load_folder_thumbnail_blocking(
                &f.cache,
                root.to_str().unwrap(),
                child.to_str().unwrap(),
                128,
                || true
            )
            .unwrap()
        ),
        30
    );
}
