use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use lofty::{
    config::WriteOptions,
    file::{AudioFile, TaggedFileExt},
    tag::{ItemKey, Tag, TagType},
};

use super::{metadata::read_tagged_file, symphonia_source::SymphoniaAudioSource};

/// Explicitly writes lyrics into the audio file's primary tag.
pub(crate) fn embed_lyrics(path: &Path, lyrics: &str) -> Result<(), String> {
    safe_update_tag(path, |tag, tag_type| {
        let lyrics_key = if tag_type == TagType::Id3v2 {
            ItemKey::UnsyncLyrics
        } else {
            ItemKey::Lyrics
        };
        tag.insert_text(lyrics_key, lyrics.to_owned());
    })?;

    tracing::info!(
        operation = "audio.source.lyrics.embed",
        path = %path.display(),
        lyric_byte_len = lyrics.len(),
        "sidecar lyrics embedded into audio file",
    );
    Ok(())
}

pub(super) fn safe_update_tag(
    path: &Path,
    update: impl FnOnce(&mut Tag, TagType),
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "audio path has no parent directory".to_string())?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "audio path has no extension".to_string())?;
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("audio");
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = parent.join(format!(
        ".{stem}.spmusic-tag-{}-{unique}.{extension}",
        std::process::id()
    ));
    let backup = parent.join(format!(
        ".{stem}.spmusic-backup-{}-{unique}.{extension}",
        std::process::id()
    ));

    let result = (|| {
        fs::copy(path, &temporary)
            .map_err(|error| format!("failed to create tag update copy: {error}"))?;
        let mut tagged_file = read_tagged_file(&temporary)
            .map_err(|error| format!("failed to read tag update copy: {error}"))?;
        let tag_type = tagged_file.primary_tag_type();
        if tagged_file.primary_tag().is_none() {
            tagged_file.insert_tag(Tag::new(tag_type));
        }
        let tag = tagged_file
            .primary_tag_mut()
            .ok_or_else(|| "failed to create primary tag".to_string())?;
        update(tag, tag_type);
        tagged_file
            .save_to_path(&temporary, WriteOptions::default())
            .map_err(|error| format!("failed to write tag update copy: {error}"))?;

        // Re-probe the complete rewritten container before replacing the
        // original. Full decode integrity is covered by the compatibility
        // corpus tests without making ordinary tag edits scan long files.
        SymphoniaAudioSource::open_path(&temporary)
            .map_err(|error| format!("rewritten audio failed validation: {error}"))?;

        fs::rename(path, &backup)
            .map_err(|error| format!("failed to stage original audio file: {error}"))?;
        if let Err(error) = fs::rename(&temporary, path) {
            let rollback = fs::rename(&backup, path);
            return Err(format!(
                "failed to install rewritten audio: {error}; rollback={rollback:?}"
            ));
        }
        fs::remove_file(&backup)
            .map_err(|error| format!("tag update succeeded but backup cleanup failed: {error}"))?;
        Ok(())
    })();

    if temporary.exists() {
        let _ = fs::remove_file(&temporary);
    }
    if result.is_err() && backup.exists() && !path.exists() {
        let _ = fs::rename(&backup, path);
    }
    result
}
