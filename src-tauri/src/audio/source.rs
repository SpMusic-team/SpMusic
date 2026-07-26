use std::{
    fs::{self, File},
    io::BufReader,
    path::{Path, PathBuf},
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use lofty::{
    config::WriteOptions,
    file::{AudioFile, TaggedFileExt},
    picture::{Picture, PictureType},
    tag::{Accessor, ItemKey, Tag, TagType},
};
use rodio::{Decoder, Source};
use symphonia::core::{
    codecs::CODEC_TYPE_NULL, errors::Error as SymphoniaError, formats::FormatOptions,
    io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
};

use super::{
    error::{audio_error, AudioCommandError, AudioErrorCode},
    symphonia_source::SymphoniaAudioSource,
    types::{AudioCoverArt, AudioFileFilter, AudioTrackMetadata, AudioTrackRef},
};

pub(crate) type AudioSource = Box<dyn Source<Item = i16> + Send>;

pub(crate) fn default_filters() -> Vec<AudioFileFilter> {
    vec![AudioFileFilter {
        name: "Audio".to_string(),
        extensions: vec![
            "mp3".to_string(),
            "wav".to_string(),
            "flac".to_string(),
            "ogg".to_string(),
        ],
    }]
}

pub(crate) fn input_path(input: &str) -> Result<PathBuf, AudioCommandError> {
    if input.trim().is_empty() {
        tracing::warn!(
            operation = "audio.source.input_path",
            "audio input path rejected because it is empty",
        );
        return Err(audio_error(
            AudioErrorCode::InvalidPath,
            "Audio path is empty",
            true,
        ));
    }

    Ok(PathBuf::from(input))
}

pub(crate) fn load_track_ref(path: &Path) -> Result<AudioTrackRef, AudioCommandError> {
    let started_at = std::time::Instant::now();
    tracing::info!(
        operation = "audio.source.load_track_ref",
        path = %path.display(),
        "loading audio track reference",
    );

    validate_existing_file(path)?;
    let duration = decode_duration(path)?;
    let metadata = read_metadata_or_default(path);
    let track_id = track_id(path);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("audio")
        .to_string();

    tracing::info!(
        operation = "audio.source.load_track_ref",
        path = %path.display(),
        track_id = %track_id,
        file_name = %file_name,
        duration_ms = duration.map(duration_ms),
        metadata_title = metadata.title.as_deref(),
        metadata_artist = metadata.artist.as_deref(),
        metadata_album = metadata.album.as_deref(),
        has_lyrics = metadata.lyrics.is_some(),
        has_cover_art = metadata.cover_art.is_some(),
        cover_mime_type = metadata.cover_art.as_ref().map(|cover| cover.mime_type.as_str()),
        cover_byte_len = metadata.cover_art.as_ref().map(|cover| cover.byte_len),
        elapsed_ms = started_at.elapsed().as_millis(),
        "loaded audio track reference",
    );

    Ok(AudioTrackRef {
        id: track_id,
        source_path: path.to_string_lossy().into_owned(),
        file_name,
        duration_ms: duration.map(duration_ms),
        metadata,
    })
}

pub(crate) fn open_source(path: &Path) -> Result<AudioSource, AudioCommandError> {
    let started_at = std::time::Instant::now();
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("flac"))
    {
        tracing::info!(
            operation = "audio.source.open",
            path = %path.display(),
            decoder = "symphonia-flac",
            "opening audio source",
        );
        return SymphoniaAudioSource::open_path(path)
            .map(|source| {
                tracing::info!(
                    operation = "audio.source.open",
                    path = %path.display(),
                    decoder = "symphonia-flac",
                    elapsed_ms = started_at.elapsed().as_millis(),
                    "opened audio source",
                );
                Box::new(source) as AudioSource
            })
            .map_err(|error| {
                tracing::warn!(
                    operation = "audio.source.open",
                    path = %path.display(),
                    decoder = "symphonia-flac",
                    error = %error,
                    elapsed_ms = started_at.elapsed().as_millis(),
                    "failed to open audio source",
                );
                audio_error(
                    AudioErrorCode::UnsupportedFormat,
                    format!("Failed to decode FLAC audio file: {error}"),
                    true,
                )
            });
    }

    tracing::info!(
        operation = "audio.source.open",
        path = %path.display(),
        decoder = "rodio",
        "opening audio source",
    );
    let file = File::open(path).map_err(|error| {
        tracing::warn!(
            operation = "audio.source.open",
            path = %path.display(),
            decoder = "rodio",
            error = %error,
            elapsed_ms = started_at.elapsed().as_millis(),
            "failed to open audio file for decoding",
        );
        audio_error(
            AudioErrorCode::UnreadableFile,
            format!("Failed to read audio file: {error}"),
            true,
        )
    })?;

    Decoder::new(BufReader::new(file))
        .map(|source| {
            tracing::info!(
                operation = "audio.source.open",
                path = %path.display(),
                decoder = "rodio",
                elapsed_ms = started_at.elapsed().as_millis(),
                total_duration_ms = source.total_duration().map(duration_ms),
                "opened audio source",
            );
            Box::new(source) as AudioSource
        })
        .map_err(|error| {
            tracing::warn!(
                operation = "audio.source.open",
                path = %path.display(),
                decoder = "rodio",
                error = %error,
                elapsed_ms = started_at.elapsed().as_millis(),
                "failed to decode audio source",
            );
            audio_error(
                AudioErrorCode::UnsupportedFormat,
                format!("Failed to decode audio file: {error}"),
                true,
            )
        })
}

pub(crate) fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

fn validate_existing_file(path: &Path) -> Result<(), AudioCommandError> {
    if !path.exists() {
        tracing::warn!(
            operation = "audio.source.validate_file",
            path = %path.display(),
            "audio file validation failed: file not found",
        );
        return Err(audio_error(
            AudioErrorCode::FileNotFound,
            "Audio file does not exist",
            true,
        ));
    }

    if !path.is_file() {
        tracing::warn!(
            operation = "audio.source.validate_file",
            path = %path.display(),
            "audio file validation failed: path is not a file",
        );
        return Err(audio_error(
            AudioErrorCode::InvalidPath,
            "Audio path is not a file",
            true,
        ));
    }

    Ok(())
}

fn decode_duration(path: &Path) -> Result<Option<Duration>, AudioCommandError> {
    match lofty_duration(path) {
        Ok(duration) => {
            tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                duration_ms = duration.map(duration_ms),
                provider = "lofty",
                "audio duration probe succeeded",
            );
            return Ok(duration);
        }
        Err(error) => {
            tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                error = %error,
                "lofty duration probe failed, falling back to symphonia",
            );
        }
    }

    match symphonia_duration(path) {
        Ok(duration) => {
            tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                duration_ms = duration.map(duration_ms),
                provider = "symphonia",
                "audio duration probe succeeded",
            );
            Ok(duration)
        }
        Err(error) => {
            tracing::debug!(
                operation = "audio.source.duration",
                path = %path.display(),
                error = %error,
                "symphonia duration probe failed, falling back to rodio",
            );
            Ok(open_source(path)?.total_duration())
        }
    }
}

fn track_id(path: &Path) -> String {
    let stable_path = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_lowercase();
    let hash = blake3::hash(stable_path.as_bytes());
    format!("local-{}", &hash.to_hex()[..16])
}

fn lofty_duration(path: &Path) -> Result<Option<Duration>, lofty::error::LoftyError> {
    let tagged_file = lofty::read_from_path(path)?;
    let duration = tagged_file.properties().duration();

    Ok((!duration.is_zero()).then_some(duration))
}

fn read_metadata_or_default(path: &Path) -> AudioTrackMetadata {
    let started_at = std::time::Instant::now();
    match lofty_metadata(path) {
        Ok(mut metadata) => {
            let had_embedded_lyrics = metadata.lyrics.is_some();
            if metadata.lyrics.is_none() {
                if let Some(lyrics) = read_sidecar_lyrics(path) {
                    if let Err(error) = embed_lyrics(path, &lyrics) {
                        tracing::warn!(
                            operation = "audio.source.lyrics.embed",
                            path = %path.display(),
                            error = %error,
                            "sidecar lyrics loaded but could not be embedded into audio file",
                        );
                    }
                    metadata.lyrics = Some(lyrics);
                }
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
                "lofty metadata read succeeded",
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
            let lyrics = read_sidecar_lyrics(path);
            if let Some(lyrics) = lyrics.as_deref() {
                if let Err(embed_error) = embed_lyrics(path, lyrics) {
                    tracing::warn!(
                        operation = "audio.source.lyrics.embed",
                        path = %path.display(),
                        error = %embed_error,
                        "sidecar lyrics loaded but could not be embedded into audio file",
                    );
                }
            }
            AudioTrackMetadata {
                lyrics,
                ..Default::default()
            }
        }
    }
}

fn lofty_metadata(path: &Path) -> Result<AudioTrackMetadata, lofty::error::LoftyError> {
    let tagged_file = lofty::read_from_path(path)?;
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

    let mut metadata = metadata_from_tag(tag);
    if metadata.lyrics.is_none() {
        metadata.lyrics = tagged_file.tags().iter().find_map(lyrics_from_tag);
    }

    Ok(metadata)
}

fn metadata_from_tag(tag: &Tag) -> AudioTrackMetadata {
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
        cover_art: select_cover_art(tag).map(cover_art_from_picture),
    }
}

fn lyrics_from_tag(tag: &Tag) -> Option<String> {
    [ItemKey::Lyrics, ItemKey::UnsyncLyrics]
        .into_iter()
        .filter_map(|key| tag_text(tag, key))
        .find(|lyrics| !lyrics.trim().is_empty())
}

fn tag_text(tag: &Tag, key: ItemKey) -> Option<String> {
    tag.get_string(key).map(ToOwned::to_owned)
}

fn embed_lyrics(path: &Path, lyrics: &str) -> Result<(), lofty::error::LoftyError> {
    let mut tagged_file = lofty::read_from_path(path)?;
    let tag_type = tagged_file.primary_tag_type();
    if tagged_file.primary_tag().is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }

    let lyrics_key = if tag_type == TagType::Id3v2 {
        ItemKey::UnsyncLyrics
    } else {
        ItemKey::Lyrics
    };
    let tag = tagged_file
        .primary_tag_mut()
        .expect("primary tag was inserted before embedding lyrics");
    tag.insert_text(lyrics_key, lyrics.to_owned());
    tagged_file.save_to_path(path, WriteOptions::default())?;

    tracing::info!(
        operation = "audio.source.lyrics.embed",
        path = %path.display(),
        lyric_byte_len = lyrics.len(),
        "sidecar lyrics embedded into audio file",
    );
    Ok(())
}

fn read_sidecar_lyrics(path: &Path) -> Option<String> {
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

fn select_cover_art(tag: &Tag) -> Option<&Picture> {
    tag.get_picture_type(PictureType::CoverFront)
        .or_else(|| tag.pictures().first())
}

fn cover_art_from_picture(picture: &Picture) -> AudioCoverArt {
    let mime_type = picture
        .mime_type()
        .map(ToString::to_string)
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let data = picture.data();
    tracing::debug!(
        operation = "audio.source.cover_art",
        mime_type = %mime_type,
        byte_len = data.len(),
        "loaded embedded cover art",
    );

    AudioCoverArt {
        mime_type: mime_type.clone(),
        data_url: cover_art_data_url(&mime_type, data),
        byte_len: data.len(),
    }
}

pub(crate) fn cover_art_data_url(mime_type: &str, data: &[u8]) -> String {
    format!("data:{mime_type};base64,{}", BASE64_STANDARD.encode(data))
}

fn symphonia_duration(path: &Path) -> Result<Option<Duration>, SymphoniaError> {
    let file = Box::new(File::open(path)?);
    let media_source = MediaSourceStream::new(file, Default::default());
    let mut hint = Hint::new();

    if let Some(extension) = path.extension().and_then(|extension| extension.to_str()) {
        hint.with_extension(extension);
    }

    let format_options = FormatOptions {
        enable_gapless: true,
        ..Default::default()
    };
    let metadata_options = MetadataOptions::default();
    let probed = symphonia::default::get_probe().format(
        &hint,
        media_source,
        &format_options,
        &metadata_options,
    )?;
    let track = probed
        .format
        .default_track()
        .or_else(|| {
            probed
                .format
                .tracks()
                .iter()
                .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        })
        .ok_or(SymphoniaError::Unsupported("no decodable audio track"))?;

    let Some(time_base) = track.codec_params.time_base else {
        return Ok(None);
    };
    let Some(frame_count) = track.codec_params.n_frames else {
        return Ok(None);
    };

    let time = time_base.calc_time(frame_count);
    let nanos = (time.frac * 1_000_000_000.0)
        .round()
        .clamp(0.0, 999_999_999.0) as u32;

    Ok(Some(Duration::new(time.seconds, nanos)))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::audio::error::AudioErrorCode;

    fn write_silent_wav(path: &Path) {
        let sample_rate = 8_000_u32;
        let channels = 1_u16;
        let bits_per_sample = 16_u16;
        let samples = [0_i16; 8];
        let data_len = (samples.len() * size_of::<i16>()) as u32;
        let byte_rate = sample_rate * u32::from(channels) * u32::from(bits_per_sample) / 8;
        let block_align = channels * bits_per_sample / 8;
        let mut wav = Vec::with_capacity(44 + data_len as usize);

        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data_len).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&byte_rate.to_le_bytes());
        wav.extend_from_slice(&block_align.to_le_bytes());
        wav.extend_from_slice(&bits_per_sample.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_len.to_le_bytes());
        for sample in samples {
            wav.extend_from_slice(&sample.to_le_bytes());
        }

        std::fs::write(path, wav).expect("test WAV should be written");
    }

    #[test]
    fn duration_ms_saturates_at_u64_max() {
        let duration = Duration::from_millis(u64::MAX).saturating_add(Duration::from_millis(1));

        assert_eq!(duration_ms(duration), u64::MAX);
    }

    #[test]
    fn input_path_rejects_blank_values() {
        let error = input_path("  ").expect_err("blank path should be rejected");

        assert_eq!(error.code, AudioErrorCode::InvalidPath);
        assert!(error.recoverable);
    }

    #[test]
    fn load_track_ref_rejects_missing_files_before_decode() {
        let missing = std::env::temp_dir().join(format!(
            "spmusic-missing-audio-{}-{}.mp3",
            std::process::id(),
            line!()
        ));

        let error = load_track_ref(&missing).expect_err("missing file should be rejected");

        assert_eq!(error.code, AudioErrorCode::FileNotFound);
        assert!(error.recoverable);
    }

    #[test]
    fn cover_art_data_url_prefixes_mime_type_and_base64_data() {
        let data_url = cover_art_data_url("image/png", b"cover");

        assert_eq!(data_url, "data:image/png;base64,Y292ZXI=");
    }

    #[test]
    fn read_sidecar_lyrics_finds_same_stem_lrc_file() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-sidecar-lyrics-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");

        let audio_path = test_dir.join("song.mp3");
        let lyrics_path = test_dir.join("song.lrc");
        std::fs::write(&lyrics_path, "[00:01.00]hello").expect("lyrics file should be written");

        assert_eq!(
            read_sidecar_lyrics(&audio_path).as_deref(),
            Some("[00:01.00]hello")
        );

        std::fs::remove_dir_all(&test_dir).expect("test directory should be removed");
    }

    #[test]
    fn sidecar_lyrics_are_loaded_and_embedded_for_future_reads() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-embed-sidecar-lyrics-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");

        let audio_path = test_dir.join("song.wav");
        let lyrics_path = test_dir.join("song.lrc");
        let lyrics = "[00:01.00]hello\u{2009}你好";
        write_silent_wav(&audio_path);
        std::fs::write(&lyrics_path, lyrics).expect("lyrics file should be written");

        let metadata = read_metadata_or_default(&audio_path);
        assert_eq!(metadata.lyrics.as_deref(), Some(lyrics));

        std::fs::remove_file(&lyrics_path).expect("sidecar lyrics should be removable");
        let embedded_metadata =
            lofty_metadata(&audio_path).expect("embedded metadata should be readable");
        assert_eq!(embedded_metadata.lyrics.as_deref(), Some(lyrics));

        std::fs::remove_dir_all(&test_dir).expect("test directory should be removed");
    }

    #[test]
    fn embedded_lyrics_take_precedence_over_sidecar_lyrics() {
        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-embedded-lyrics-priority-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");

        let audio_path = test_dir.join("song.wav");
        let lyrics_path = test_dir.join("song.lrc");
        write_silent_wav(&audio_path);
        embed_lyrics(&audio_path, "[00:01.00]embedded").expect("embedded lyrics should be written");
        std::fs::write(&lyrics_path, "[00:01.00]sidecar")
            .expect("sidecar lyrics should be written");

        let metadata = read_metadata_or_default(&audio_path);
        assert_eq!(metadata.lyrics.as_deref(), Some("[00:01.00]embedded"));

        std::fs::remove_dir_all(&test_dir).expect("test directory should be removed");
    }

    #[test]
    fn local_flac_source_supports_seek_when_sample_file_exists() {
        let Some(flac_path) = std::env::var_os("SPMUSIC_SEEK_SAMPLE_FLAC").map(PathBuf::from)
        else {
            return;
        };

        if !flac_path.exists() {
            return;
        }

        let mut source = open_source(&flac_path).expect("sample FLAC should be decodable");

        source
            .try_seek(Duration::from_secs(300))
            .expect("sample FLAC source should support seek");
    }

    #[test]
    fn local_flac_accepts_embedded_lyrics_when_sample_file_exists() {
        let Some(sample_path) = std::env::var_os("SPMUSIC_LYRICS_SAMPLE_FLAC").map(PathBuf::from)
        else {
            return;
        };
        if !sample_path.exists() {
            return;
        }

        let test_dir = std::env::temp_dir().join(format!(
            "spmusic-flac-lyrics-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&test_dir).expect("test directory should be created");
        let test_path = test_dir.join("lyrics-copy.flac");
        std::fs::copy(&sample_path, &test_path).expect("sample FLAC should be copied");
        let lyrics = "[00:01.00]test lyrics\u{2009}测试歌词";

        embed_lyrics(&test_path, lyrics).expect("lyrics should be embedded into FLAC copy");
        let metadata = lofty_metadata(&test_path).expect("FLAC metadata should remain readable");
        assert_eq!(metadata.lyrics.as_deref(), Some(lyrics));

        std::fs::remove_dir_all(&test_dir).expect("test directory should be removed");
    }

    #[test]
    fn track_id_is_stable_for_same_path() {
        let path = PathBuf::from("D:/Music/example.mp3");

        assert_eq!(track_id(&path), track_id(&path));
    }

    #[test]
    fn track_id_has_local_prefix_and_blake3_length() {
        let path = PathBuf::from("D:/Music/example.mp3");

        assert_eq!(track_id(&path).len(), "local-".len() + 16);
        assert!(track_id(&path).starts_with("local-"));
    }
}
