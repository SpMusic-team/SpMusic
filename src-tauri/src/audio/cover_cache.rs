use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use lofty::{
    picture::{Picture, PictureType},
    tag::Tag,
};

use super::error::{audio_error, AudioCommandError, AudioErrorCode};
use super::types::AudioCoverArt;

const MAX_PLAYLIST_COVER_BYTES: usize = 16 * 1024 * 1024;
static PLAYLIST_COVER_TEMP: AtomicU64 = AtomicU64::new(0);

/// The visual path checks bounds before persistence or base64 allocation. The
/// legacy hydrate path below keeps its existing behavior.
pub(super) fn bounded_playlist_cover_from_tag(
    tag: &Tag,
    app_cache_dir: &Path,
) -> Result<Option<AudioCoverArt>, AudioCommandError> {
    let Some(picture) = select_cover_art(tag) else {
        return Ok(None);
    };
    let data = picture.data();
    if data.is_empty() || data.len() > MAX_PLAYLIST_COVER_BYTES {
        return Err(audio_error(
            AudioErrorCode::UnsupportedFormat,
            "Playlist cover must contain 1 to 16777216 bytes",
            true,
        ));
    }
    let mime_type = picture
        .mime_type()
        .map(ToString::to_string)
        .unwrap_or_else(|| "application/octet-stream".to_owned());
    let file_path = cache_playlist_cover(app_cache_dir, &mime_type, data);
    Ok(Some(AudioCoverArt {
        data_url: file_path
            .is_none()
            .then(|| cover_art_data_url(&mime_type, data)),
        file_path,
        mime_type,
        byte_len: data.len(),
    }))
}

fn ordinary(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    !metadata.file_type().is_symlink()
}

struct PlaylistCoverDirectory {
    path: PathBuf,
    // On Windows retain non-delete-sharing handles while using the namespace:
    // a checked directory cannot be replaced by a junction before publication.
    _guards: Vec<File>,
}

fn guard_directory(path: &Path) -> Option<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x02200000).share_mode(3); // BACKUP_SEMANTICS | OPEN_REPARSE_POINT; no DELETE share
    }
    let file = options.open(path).ok()?;
    let metadata = file.metadata().ok()?;
    (ordinary(&metadata) && metadata.is_dir()).then_some(file)
}

fn playlist_cover_directory(app_cache_dir: &Path) -> Option<PlaylistCoverDirectory> {
    let root_metadata = fs::symlink_metadata(app_cache_dir).ok()?;
    if !ordinary(&root_metadata) || !root_metadata.is_dir() {
        return None;
    }
    let mut guards = vec![guard_directory(app_cache_dir)?];
    let root = fs::canonicalize(app_cache_dir).ok()?;
    let mut directory = root.clone();
    for part in ["audio", "covers"] {
        directory.push(part);
        match fs::create_dir(&directory) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return None,
        }
        let metadata = fs::symlink_metadata(&directory).ok()?;
        guards.push(guard_directory(&directory)?);
        if !ordinary(&metadata)
            || !metadata.is_dir()
            || fs::canonicalize(&directory).ok()? != directory
        {
            return None;
        }
    }
    Some(PlaylistCoverDirectory {
        path: directory,
        _guards: guards,
    })
}

fn existing_playlist_cover(path: &Path, expected: &[u8]) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if !ordinary(&metadata) || !metadata.is_file() || metadata.len() != expected.len() as u64 {
        return false;
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let Ok(file) = options.open(path) else {
        return false;
    };
    let Ok(metadata) = file.metadata() else {
        return false;
    };
    if !ordinary(&metadata) || !metadata.is_file() || metadata.len() != expected.len() as u64 {
        return false;
    }
    let mut bytes = Vec::new();
    file.take(MAX_PLAYLIST_COVER_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .is_ok()
        && bytes == expected
}

fn cache_playlist_cover(app_cache_dir: &Path, mime_type: &str, data: &[u8]) -> Option<String> {
    let directory = playlist_cover_directory(app_cache_dir)?;
    let target = directory.path.join(format!(
        "{}.{}",
        blake3::hash(data).to_hex(),
        cover_extension(mime_type)
    ));
    if fs::symlink_metadata(&target).is_ok() {
        return existing_playlist_cover(&target, data)
            .then(|| target.to_string_lossy().into_owned());
    }
    let temporary = directory.path.join(format!(
        ".cover-{}-{}",
        std::process::id(),
        PLAYLIST_COVER_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1); // Keep the temporary name and bytes owned until publication.
    }
    let mut file = options.open(&temporary).ok()?;
    let write_result = file.write_all(data);
    // A hard link publishes complete bytes without replacing another writer's
    // entry or following an existing target link. Unsupported filesystems fall
    // back to the bounded data URL rather than writing through an unsafe path.
    let published = write_result.is_ok() && fs::hard_link(&temporary, &target).is_ok();
    drop(file);
    let _ = fs::remove_file(&temporary);
    (published || existing_playlist_cover(&target, data))
        .then(|| target.to_string_lossy().into_owned())
}

fn select_cover_art(tag: &Tag) -> Option<&Picture> {
    tag.get_picture_type(PictureType::CoverFront)
        .or_else(|| tag.pictures().first())
}

pub(super) fn cover_art_from_tag(
    tag: &Tag,
    cover_cache_dir: Option<&Path>,
) -> Option<AudioCoverArt> {
    select_cover_art(tag).map(|picture| cover_art_from_picture(picture, cover_cache_dir))
}

fn cover_art_from_picture(picture: &Picture, cover_cache_dir: Option<&Path>) -> AudioCoverArt {
    let mime_type = picture
        .mime_type()
        .map(ToString::to_string)
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let data = picture.data();
    let file_path =
        cover_cache_dir.and_then(|cache_dir| cache_cover_art(cache_dir, &mime_type, data));
    tracing::debug!(
        operation = "audio.source.cover_art",
        mime_type = %mime_type,
        byte_len = data.len(),
        cached = file_path.is_some(),
        "loaded embedded cover art",
    );

    AudioCoverArt {
        mime_type: mime_type.clone(),
        data_url: file_path
            .is_none()
            .then(|| cover_art_data_url(&mime_type, data)),
        file_path,
        byte_len: data.len(),
    }
}

pub(crate) fn cover_art_data_url(mime_type: &str, data: &[u8]) -> String {
    format!("data:{mime_type};base64,{}", BASE64_STANDARD.encode(data))
}

fn cache_cover_art(cache_dir: &Path, mime_type: &str, data: &[u8]) -> Option<String> {
    let covers_dir = cache_dir.join("covers");
    if let Err(error) = fs::create_dir_all(&covers_dir) {
        tracing::warn!(
            operation = "audio.source.cover_art.cache",
            path = %covers_dir.display(),
            error = %error,
            "failed to create cover cache directory",
        );
        return None;
    }

    let extension = cover_extension(mime_type);
    let hash = blake3::hash(data);
    let cover_path = covers_dir.join(format!("{}.{}", hash.to_hex(), extension));

    if !cover_path.is_file() {
        if let Err(error) = fs::write(&cover_path, data) {
            tracing::warn!(
                operation = "audio.source.cover_art.cache",
                path = %cover_path.display(),
                error = %error,
                "failed to write cover cache file",
            );
            return None;
        }
    }

    Some(cover_path.to_string_lossy().into_owned())
}

fn cover_extension(mime_type: &str) -> &'static str {
    match mime_type.to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "bin",
    }
}

#[cfg(test)]
mod tests {
    use lofty::picture::{MimeType, Picture};

    use super::*;

    fn playlist_tag(bytes: Vec<u8>) -> Tag {
        let mut tag = Tag::new(lofty::tag::TagType::Id3v2);
        tag.push_picture(
            Picture::unchecked(bytes)
                .pic_type(PictureType::CoverFront)
                .mime_type(MimeType::Png)
                .build(),
        );
        tag
    }

    #[test]
    fn playlist_cover_enforces_limit_before_persist_or_fallback() {
        let tag = playlist_tag(vec![7; MAX_PLAYLIST_COVER_BYTES + 1]);
        let error =
            bounded_playlist_cover_from_tag(&tag, Path::new("unavailable-cache")).unwrap_err();
        assert_eq!(error.code, AudioErrorCode::UnsupportedFormat);
        assert!(
            bounded_playlist_cover_from_tag(&playlist_tag(Vec::new()), Path::new("unused"))
                .is_err()
        );
    }

    #[test]
    fn playlist_cache_rejects_directory_target_and_corrupt_existing_content() {
        let root = std::env::temp_dir().join(format!(
            "spmusic-cover-safety-{}-{}",
            std::process::id(),
            PLAYLIST_COVER_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let bytes = [1, 2, 3, 4];
        let target = root
            .join("audio/covers")
            .join(format!("{}.png", blake3::hash(&bytes).to_hex()));
        fs::create_dir_all(&target).unwrap();
        let tag = playlist_tag(bytes.to_vec());
        let cover = bounded_playlist_cover_from_tag(&tag, &root)
            .unwrap()
            .unwrap();
        assert!(cover.file_path.is_none());
        assert_eq!(
            cover.data_url.unwrap(),
            cover_art_data_url("image/png", &bytes)
        );
        fs::remove_dir(&target).unwrap();
        fs::write(&target, [9, 9, 9, 9]).unwrap();
        let cover = bounded_playlist_cover_from_tag(&tag, &root)
            .unwrap()
            .unwrap();
        assert!(cover.file_path.is_none());
        assert_eq!(fs::read(&target).unwrap(), [9, 9, 9, 9]);
        fs::remove_file(&target).unwrap();
        let cover = bounded_playlist_cover_from_tag(&tag, &root)
            .unwrap()
            .unwrap();
        assert!(cover.file_path.is_some());
        assert!(cover.data_url.is_none());
        assert_eq!(fs::read(&target).unwrap(), bytes);
        assert!(bounded_playlist_cover_from_tag(&tag, &root)
            .unwrap()
            .unwrap()
            .file_path
            .is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn playlist_cache_falls_back_when_cache_root_is_unusable() {
        let root = std::env::temp_dir().join(format!(
            "spmusic-cover-blocked-{}-{}",
            std::process::id(),
            PLAYLIST_COVER_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        fs::write(&root, b"not a directory").unwrap();
        let cover = bounded_playlist_cover_from_tag(&playlist_tag(vec![1]), &root)
            .unwrap()
            .unwrap();
        assert!(cover.file_path.is_none());
        assert!(cover.data_url.is_some());
        assert_eq!(fs::read(&root).unwrap(), b"not a directory");
        fs::remove_file(root).unwrap();
    }

    #[test]
    fn cached_cover_uses_file_path_without_duplicate_data_url() {
        let cache_dir = std::env::temp_dir().join(format!(
            "spmusic-cover-xor-{}-{}",
            std::process::id(),
            line!()
        ));
        let picture = Picture::unchecked(vec![0xff, 0xd8, 0xff, 0xd9])
            .pic_type(PictureType::CoverFront)
            .mime_type(MimeType::Jpeg)
            .build();

        let cover = cover_art_from_picture(&picture, Some(&cache_dir));
        assert!(cover.file_path.is_some());
        assert!(cover.data_url.is_none());

        std::fs::remove_dir_all(cache_dir).expect("cover cache should be removable");
    }

    #[test]
    fn uncached_cover_falls_back_to_data_url_only() {
        let picture = Picture::unchecked(vec![1, 2, 3])
            .pic_type(PictureType::CoverFront)
            .mime_type(MimeType::Png)
            .build();

        let cover = cover_art_from_picture(&picture, None);
        assert!(cover.file_path.is_none());
        assert!(cover.data_url.is_some());
    }
}
