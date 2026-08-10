use std::{
    fs,
    path::{Path, PathBuf},
};

use lofty::{
    file::TaggedFileExt,
    tag::{Accessor, ItemKey, Tag},
};

use super::{cover_cache::cover_art_from_tag, types::AudioTrackMetadata};

const REPLAY_GAIN_MIN_DB: f32 = -24.0;
const REPLAY_GAIN_MAX_DB: f32 = 12.0;

pub(super) fn replay_gain_multiplier(path: &Path) -> Option<f32> {
    let tagged_file = read_tagged_file(path).ok()?;
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())?;
    let gain_db = [ItemKey::ReplayGainTrackGain, ItemKey::ReplayGainAlbumGain]
        .into_iter()
        .find_map(|key| tag_text(tag, key).and_then(|value| parse_replay_gain_db(&value)))?;
    let peak = [ItemKey::ReplayGainTrackPeak, ItemKey::ReplayGainAlbumPeak]
        .into_iter()
        .find_map(|key| tag_text(tag, key).and_then(|value| value.trim().parse::<f32>().ok()))
        .filter(|peak| peak.is_finite() && *peak > 0.0);

    Some(bounded_replay_gain_multiplier(gain_db, peak))
}

pub(super) fn bounded_replay_gain_multiplier(gain_db: f32, peak: Option<f32>) -> f32 {
    let mut bounded_db = gain_db.clamp(REPLAY_GAIN_MIN_DB, REPLAY_GAIN_MAX_DB);
    if let Some(peak) = peak {
        let peak_limited_db = -20.0 * peak.log10();
        if peak_limited_db.is_finite() {
            bounded_db = bounded_db.min(peak_limited_db);
        }
    }
    10.0_f32.powf(bounded_db / 20.0)
}

pub(super) fn parse_replay_gain_db(value: &str) -> Option<f32> {
    let number = value
        .trim()
        .strip_suffix("dB")
        .or_else(|| value.trim().strip_suffix("DB"))
        .or_else(|| value.trim().strip_suffix("db"))
        .unwrap_or(value.trim())
        .trim()
        .parse::<f32>()
        .ok()?;
    number.is_finite().then_some(number)
}

/// Reads embedded metadata and an optional sidecar `.lrc` without modifying the audio file.
pub(crate) fn read_metadata(path: &Path, cover_cache_dir: Option<&Path>) -> AudioTrackMetadata {
    let started_at = std::time::Instant::now();
    match read_embedded_metadata(path, cover_cache_dir) {
        Ok(mut metadata) => {
            let had_embedded_lyrics = metadata.lyrics.is_some();
            if metadata.lyrics.is_none() {
                metadata.lyrics = read_sidecar_lyrics(path);
            }

            tracing::debug!(
                operation = "audio.source.metadata",
                path = %path.display(),
                title = metadata.title.as_deref(),
                artist = metadata.artist.as_deref(),
                album = metadata.album.as_deref(),
                has_embedded_lyrics = had_embedded_lyrics,
                has_lyrics = metadata.lyrics.is_some(),
                has_cover_art = metadata.cover_art.is_some(),
                cover_mime_type = metadata.cover_art.as_ref().map(|cover| cover.mime_type.as_str()),
                cover_byte_len = metadata.cover_art.as_ref().map(|cover| cover.byte_len),
                elapsed_ms = started_at.elapsed().as_millis(),
                "audio metadata read succeeded",
            );
            metadata
        }
        Err(error) => {
            tracing::debug!(
                operation = "audio.source.metadata",
                path = %path.display(),
                error = %error,
                elapsed_ms = started_at.elapsed().as_millis(),
                "lofty metadata read failed, returning empty metadata",
            );
            AudioTrackMetadata {
                lyrics: read_sidecar_lyrics(path),
                ..Default::default()
            }
        }
    }
}

pub(super) fn read_embedded_metadata(
    path: &Path,
    cover_cache_dir: Option<&Path>,
) -> Result<AudioTrackMetadata, lofty::error::LoftyError> {
    let tagged_file = read_tagged_file(path)?;
    let Some(tag) = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
    else {
        tracing::debug!(
            operation = "audio.source.metadata",
            path = %path.display(),
            "audio file has no readable metadata tag",
        );
        return Ok(AudioTrackMetadata::default());
    };

    let mut metadata = metadata_from_tag(tag, cover_cache_dir);
    if metadata.lyrics.is_none() {
        metadata.lyrics = tagged_file.tags().iter().find_map(lyrics_from_tag);
    }

    Ok(metadata)
}

fn metadata_from_tag(tag: &Tag, cover_cache_dir: Option<&Path>) -> AudioTrackMetadata {
    AudioTrackMetadata {
        title: tag.title().map(cow_to_string),
        artist: tag.artist().map(cow_to_string),
        album: tag.album().map(cow_to_string),
        album_artist: tag_text(tag, ItemKey::AlbumArtist),
        genre: tag.genre().map(cow_to_string),
        year: tag.date().map(|timestamp| u32::from(timestamp.year)),
        track_number: tag.track(),
        disc_number: tag.disk(),
        comment: tag.comment().map(cow_to_string),
        lyrics: lyrics_from_tag(tag),
        cover_art: cover_art_from_tag(tag, cover_cache_dir),
    }
}

fn lyrics_from_tag(tag: &Tag) -> Option<String> {
    [ItemKey::Lyrics, ItemKey::UnsyncLyrics]
        .into_iter()
        .filter_map(|key| tag_text(tag, key))
        .find(|lyrics| !lyrics.trim().is_empty())
}

pub(super) fn tag_text(tag: &Tag, key: ItemKey) -> Option<String> {
    tag.get_string(key).map(ToOwned::to_owned)
}

pub(super) fn read_tagged_file(
    path: &Path,
) -> Result<lofty::file::TaggedFile, lofty::error::LoftyError> {
    lofty::probe::Probe::open(path)?.guess_file_type()?.read()
}

pub(super) fn read_sidecar_lyrics(path: &Path) -> Option<String> {
    let lyrics_path = sidecar_lyrics_path(path)?;
    tracing::debug!(
        operation = "audio.source.lyrics.sidecar",
        path = %path.display(),
        lyrics_path = %lyrics_path.display(),
        "sidecar lyrics candidate found",
    );
    let bytes = match fs::read(&lyrics_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            tracing::debug!(
                operation = "audio.source.lyrics.sidecar",
                path = %lyrics_path.display(),
                error = %error,
                "sidecar lyrics read failed",
            );
            return None;
        }
    };
    let lyrics = String::from_utf8_lossy(&bytes).trim().to_string();
    tracing::debug!(
        operation = "audio.source.lyrics.sidecar",
        path = %lyrics_path.display(),
        byte_len = bytes.len(),
        is_empty = lyrics.is_empty(),
        "sidecar lyrics read succeeded",
    );

    (!lyrics.is_empty()).then_some(lyrics)
}

fn sidecar_lyrics_path(path: &Path) -> Option<PathBuf> {
    let direct_path = path.with_extension("lrc");
    if direct_path.exists() {
        tracing::debug!(
            operation = "audio.source.lyrics.sidecar",
            path = %path.display(),
            lyrics_path = %direct_path.display(),
            "matched direct sidecar lyrics path",
        );
        return Some(direct_path);
    }

    let parent = path.parent()?;
    let file_stem = path.file_stem()?.to_string_lossy();

    fs::read_dir(parent)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|candidate| {
            let candidate_stem = candidate.file_stem().and_then(|value| value.to_str());
            let candidate_extension = candidate.extension().and_then(|value| value.to_str());

            candidate_stem.is_some_and(|value| value.eq_ignore_ascii_case(&file_stem))
                && candidate_extension.is_some_and(|value| value.eq_ignore_ascii_case("lrc"))
        })
}

fn cow_to_string(value: std::borrow::Cow<'_, str>) -> String {
    value.into_owned()
}
