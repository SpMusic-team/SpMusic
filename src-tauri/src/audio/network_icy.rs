//! Bounded ICY demultiplexing. Only audio bytes reach the decoder.
use std::io::{self, Read, Seek, SeekFrom};
use std::sync::Arc;
use symphonia::core::io::MediaSource;

use super::network::StreamStatus;

pub(super) struct IcyReader<R> {
    inner: R,
    interval: Option<usize>,
    remaining: usize,
    status: Arc<StreamStatus>,
}

impl<R> IcyReader<R> {
    pub(super) fn new(inner: R, interval: Option<usize>, status: Arc<StreamStatus>) -> Self {
        Self {
            inner,
            interval,
            remaining: interval.unwrap_or(0),
            status,
        }
    }
}

impl<R: Read> Read for IcyReader<R> {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        if bytes.is_empty() {
            return Ok(0);
        }
        let Some(interval) = self.interval else {
            return self.inner.read(bytes);
        };
        if self.remaining == 0 {
            let mut length = [0];
            // EOF exactly at a metadata boundary is a normal audio EOF.
            if self.inner.read(&mut length)? == 0 {
                return Ok(0);
            }
            let length = length[0] as usize * 16;
            if length != 0 {
                let mut metadata = [0; 255 * 16];
                self.inner
                    .read_exact(&mut metadata[..length])
                    .map_err(|error| {
                        self.status.fail("流元数据不完整，连接已提前结束");
                        error
                    })?;
                if let Some(artist) = metadata_artist(&metadata[..length]) {
                    self.status.set_artist(artist);
                }
            }
            self.remaining = interval;
        }
        let limit = bytes.len().min(self.remaining);
        let count = self.inner.read(&mut bytes[..limit])?;
        self.remaining -= count;
        Ok(count)
    }
}

impl<R: MediaSource> Seek for IcyReader<R> {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.inner.seek(position)
    }
}

impl<R: MediaSource> MediaSource for IcyReader<R> {
    fn is_seekable(&self) -> bool {
        false
    }
    fn byte_len(&self) -> Option<u64> {
        if self.interval.is_some() {
            None
        } else {
            self.inner.byte_len()
        }
    }
}

pub(super) fn metadata_interval(value: Option<&str>) -> Option<usize> {
    let value = value?.trim();
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse::<usize>().ok().filter(|value| *value > 0)
}

// None: no author-bearing field. Some(None): explicit new title without author.
fn metadata_artist(bytes: &[u8]) -> Option<Option<String>> {
    let text = std::str::from_utf8(bytes).ok()?.trim_end_matches('\0');
    let mut explicit = None;
    let mut title = None;
    let mut remaining = text;
    while let Some((key, value)) = remaining.split_once('=') {
        let value = value.trim_start();
        let Some(value) = value.strip_prefix('\'') else {
            break;
        };
        let Some(end) = value.find("';") else {
            break;
        };
        let field = &value[..end];
        if key.trim().eq_ignore_ascii_case("Artist")
            || key.trim().eq_ignore_ascii_case("StreamArtist")
        {
            explicit = Some(display_artist(field));
        } else if key.trim().eq_ignore_ascii_case("StreamTitle") {
            title = Some(field);
        }
        remaining = &value[end + 2..];
    }
    explicit.or_else(|| {
        title.map(|title| {
            let (artist, song) = title.split_once(" - ")?;
            if song.trim().is_empty() {
                return None;
            }
            display_artist(artist)
        })
    })
}

fn display_artist(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value.chars().count() <= 512 && !value.chars().any(char::is_control))
        .then(|| value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn icy_author_fields_are_conservative_and_clear_stale_values() {
        assert_eq!(
            metadata_artist(b"StreamTitle='Artist - Song';"),
            Some(Some("Artist".into()))
        );
        assert_eq!(
            metadata_artist(b"StreamTitle='Artist - Song';Artist='Actual artist';"),
            Some(Some("Actual artist".into()))
        );
        assert_eq!(metadata_artist(b"StreamTitle='Only a title';"), Some(None));
        assert_eq!(metadata_artist(b"StreamTitle='';"), Some(None));
        assert_eq!(metadata_artist(b"StreamUrl='https://radio.test';"), None);
        assert_eq!(metadata_artist(b"StreamTitle=' - Song';"), Some(None));
        assert_eq!(
            metadata_artist(b"Artist='';StreamTitle='Artist - Song';"),
            Some(None)
        );
        assert_eq!(
            metadata_artist(b"StreamTitle='Miles Davis - What's New';"),
            Some(Some("Miles Davis".into()))
        );
        assert_eq!(metadata_interval(Some("+3")), None);
        assert_eq!(metadata_interval(Some("0")), None);
        assert_eq!(metadata_interval(Some(" 8192 ")), Some(8192));
    }

    #[test]
    fn icy_reader_strips_split_blocks_and_zero_blocks_without_losing_audio() {
        let status = Arc::new(StreamStatus::default());
        let metadata = b"StreamTitle='Artist - Song';";
        let mut wire = b"abcd".to_vec();
        wire.push(2);
        wire.extend(metadata);
        wire.resize(4 + 1 + 32, 0);
        wire.extend(b"efgh\0ijkl");
        let mut reader = IcyReader::new(Cursor::new(wire), Some(4), status.clone());
        let mut audio = Vec::new();
        let mut byte = [0];
        while reader.read(&mut byte).unwrap() != 0 {
            audio.extend(byte);
        }
        assert_eq!(audio, b"abcdefghijkl");
        assert_eq!(status.artist(), Some(Some("Artist".into())));
    }

    #[test]
    fn icy_reader_rejects_truncated_metadata_and_handles_maximum_block() {
        let status = Arc::new(StreamStatus::default());
        let mut reader = IcyReader::new(Cursor::new(b"a\x01short"), Some(1), status.clone());
        let mut audio = Vec::new();
        assert_eq!(
            reader.read_to_end(&mut audio).unwrap_err().kind(),
            io::ErrorKind::UnexpectedEof
        );
        let mut wire = vec![b'a', 255];
        wire.resize(2 + 4080, 0);
        wire.push(b'b');
        let mut reader = IcyReader::new(Cursor::new(wire), Some(1), status);
        audio.clear();
        reader.read_to_end(&mut audio).unwrap();
        assert_eq!(audio, b"ab");
    }
}
