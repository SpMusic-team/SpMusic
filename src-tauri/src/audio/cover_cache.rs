use std::{fs, path::Path};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use lofty::{
    picture::{Picture, PictureType},
    tag::Tag,
};

use super::types::AudioCoverArt;

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
