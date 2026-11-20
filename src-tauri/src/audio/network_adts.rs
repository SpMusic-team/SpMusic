//! Network-only ADTS framing. The upstream reader recognizes only MPEG-4
//! unprotected headers (FF F1); radio streams also use MPEG-2 and CRC headers.
//! AAC payload bytes are passed unchanged to the existing AAC decoder.
use std::io;
use symphonia::core::{
    audio::Channels,
    codecs::{CodecParameters, CODEC_TYPE_AAC},
    errors::{decode_error, unsupported_error, Result},
    formats::{Cue, FormatOptions, FormatReader, Packet, SeekMode, SeekTo, SeekedTo, Track},
    io::{MediaSourceStream, ReadBytes, SeekBuffered},
    meta::{Metadata, MetadataLog},
    units::TimeBase,
};

const SAMPLE_RATES: [u32; 13] = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

pub(super) fn matches(source: &mut MediaSourceStream) -> Result<bool> {
    let before = source.pos();
    let first = source.read_u8();
    let second = if first.is_ok() {
        source.read_u8().ok()
    } else {
        None
    };
    source.seek_buffered_rev((source.pos() - before) as usize);
    Ok(matches!((first, second), (Ok(0xff), Some(second)) if second & 0xf6 == 0xf0))
}

#[derive(Clone, Copy)]
struct Header {
    profile: u8,
    frequency: u8,
    channels: u8,
    frame_len: usize,
    crc: bool,
}
impl Header {
    fn read(source: &mut MediaSourceStream) -> Result<Self> {
        let mut bytes = [0u8; 7];
        // EOF before a new header is a frame boundary; EOF inside is damage.
        bytes[0] = source.read_u8()?;
        source
            .read_buf_exact(&mut bytes[1..])
            .map_err(|error| truncated(error, "truncated ADTS header"))?;
        if bytes[0] != 0xff || bytes[1] & 0xf6 != 0xf0 {
            return decode_error("invalid ADTS frame sync/layer");
        }
        let frequency = (bytes[2] >> 2) & 15;
        if bytes[2] >> 6 != 1 {
            return unsupported_error("network ADTS supports AAC-LC only");
        }
        if frequency as usize >= SAMPLE_RATES.len() {
            return decode_error("invalid ADTS sample rate");
        }
        let channels = ((bytes[2] & 1) << 2) | (bytes[3] >> 6);
        if channels == 0 || channels > 2 {
            return unsupported_error("ADTS channel configuration unsupported by AAC decoder");
        }
        if bytes[6] & 3 != 0 {
            return unsupported_error("multiple raw AAC blocks per ADTS frame are unsupported");
        }
        let crc = bytes[1] & 1 == 0;
        let frame_len = (((bytes[3] & 3) as usize) << 11)
            | ((bytes[4] as usize) << 3)
            | ((bytes[5] as usize) >> 5);
        if frame_len <= if crc { 9 } else { 7 } {
            return decode_error("invalid ADTS frame length");
        }
        Ok(Self {
            profile: bytes[2] >> 6,
            frequency,
            channels,
            frame_len,
            crc,
        })
    }
    fn same_config(self, other: Self) -> bool {
        self.profile == other.profile
            && self.frequency == other.frequency
            && self.channels == other.channels
    }
}

fn truncated(error: io::Error, message: &'static str) -> io::Error {
    if error.kind() == io::ErrorKind::UnexpectedEof {
        io::Error::new(io::ErrorKind::InvalidData, message)
    } else {
        error
    }
}

pub(super) struct NetworkAdtsReader {
    source: MediaSourceStream,
    tracks: Vec<Track>,
    metadata: MetadataLog,
    initial: Header,
    pending: Option<Header>,
    next_ts: u64,
}
impl FormatReader for NetworkAdtsReader {
    fn try_new(mut source: MediaSourceStream, _: &FormatOptions) -> Result<Self> {
        let header = Header::read(&mut source)?;
        let mut params = CodecParameters::new();
        let object_type = header.profile + 1;
        let asc = vec![
            (object_type << 3) | (header.frequency >> 1),
            ((header.frequency & 1) << 7) | (header.channels << 3),
        ];
        params
            .for_codec(CODEC_TYPE_AAC)
            .with_sample_rate(SAMPLE_RATES[header.frequency as usize])
            .with_time_base(TimeBase::new(1, SAMPLE_RATES[header.frequency as usize]))
            .with_channels(if header.channels == 1 {
                Channels::FRONT_CENTRE
            } else {
                Channels::FRONT_LEFT | Channels::FRONT_RIGHT
            })
            .with_extra_data(asc.into_boxed_slice());
        Ok(Self {
            source,
            tracks: vec![Track::new(0, params)],
            metadata: MetadataLog::default(),
            initial: header,
            pending: Some(header),
            next_ts: 0,
        })
    }
    fn next_packet(&mut self) -> Result<Packet> {
        let header = match self.pending.take() {
            Some(header) => header,
            None => Header::read(&mut self.source)?,
        };
        if !header.same_config(self.initial) {
            return decode_error("ADTS configuration changed during playback");
        }
        if header.crc {
            let mut crc = [0u8; 2];
            self.source
                .read_buf_exact(&mut crc)
                .map_err(|error| truncated(error, "truncated ADTS CRC"))?;
        }
        let payload = self
            .source
            .read_boxed_slice_exact(header.frame_len - if header.crc { 9 } else { 7 })
            .map_err(|error| truncated(error, "truncated ADTS payload"))?;
        let ts = self.next_ts;
        self.next_ts += 1024;
        Ok(Packet::new_from_boxed_slice(0, ts, 1024, payload))
    }
    fn tracks(&self) -> &[Track] {
        &self.tracks
    }
    fn cues(&self) -> &[Cue] {
        &[]
    }
    fn metadata(&mut self) -> Metadata<'_> {
        self.metadata.metadata()
    }
    fn seek(&mut self, _: SeekMode, _: SeekTo) -> Result<SeekedTo> {
        unsupported_error("network ADTS is not seekable")
    }
    fn into_inner(self: Box<Self>) -> MediaSourceStream {
        self.source
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read, Seek, SeekFrom};
    use symphonia::core::io::MediaSource;

    struct Chunked {
        bytes: Cursor<Vec<u8>>,
        chunk: usize,
    }
    impl Read for Chunked {
        fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
            let len = bytes.len().min(self.chunk);
            self.bytes.read(&mut bytes[..len])
        }
    }
    impl Seek for Chunked {
        fn seek(&mut self, _: SeekFrom) -> io::Result<u64> {
            Err(io::Error::new(io::ErrorKind::Unsupported, "nonseekable"))
        }
    }
    impl MediaSource for Chunked {
        fn is_seekable(&self) -> bool {
            false
        }
        fn byte_len(&self) -> Option<u64> {
            None
        }
    }
    fn source(bytes: Vec<u8>, chunk: usize) -> MediaSourceStream {
        MediaSourceStream::new(
            Box::new(Chunked {
                bytes: Cursor::new(bytes),
                chunk,
            }),
            Default::default(),
        )
    }
    fn frame(payload: &[u8], mpeg2: bool, crc: bool) -> Vec<u8> {
        let len = payload.len() + if crc { 9 } else { 7 };
        let mut bytes = vec![
            0xff,
            (if mpeg2 { 0xf9 } else { 0xf1 }) & if crc { 0xfe } else { 0xff },
            0x50,
            0x80 | ((len >> 11) as u8),
            (len >> 3) as u8,
            ((len as u8 & 7) << 5) | 0x1f,
            0xfc,
        ];
        if crc {
            bytes.extend([0xff, 0xf1]);
        }
        bytes.extend(payload);
        bytes
    }
    #[test]
    fn mpeg2_mpeg4_and_crc_preserve_payload_across_single_byte_reads() {
        let payload = [1, 0xff, 0xf9, 3, 0xff, 0xf1, 5, 0xff, 0xf0];
        for mpeg2 in [false, true] {
            for crc in [false, true] {
                let mut bytes = frame(&payload, mpeg2, crc);
                bytes.extend(frame(&payload, !mpeg2, !crc));
                let mut source = source(bytes, 1);
                assert!(matches(&mut source).unwrap());
                let mut reader =
                    NetworkAdtsReader::try_new(source, &FormatOptions::default()).unwrap();
                assert_eq!(reader.tracks()[0].codec_params.sample_rate, Some(44100));
                assert_eq!(
                    reader.tracks()[0].codec_params.extra_data.as_deref(),
                    Some([0x12, 0x10].as_slice())
                );
                for ts in [0, 1024] {
                    let packet = reader.next_packet().unwrap();
                    assert_eq!(packet.data.as_ref(), payload);
                    assert_eq!(packet.ts, ts);
                }
                assert!(
                    matches!(reader.next_packet(), Err(symphonia::core::errors::Error::IoError(error)) if error.kind() == io::ErrorKind::UnexpectedEof)
                );
            }
        }
    }
    #[test]
    fn non_adts_prefix_is_not_consumed() {
        let mut source = source(b"RIFFabcdefgh".to_vec(), 2);
        assert!(!matches(&mut source).unwrap());
        assert_eq!(source.read_u8().unwrap(), b'R');
    }
    #[test]
    fn rejects_invalid_headers_and_unsupported_raw_blocks() {
        for (offset, value) in [(1, 0xfb), (2, 0x10), (2, 0x7c), (3, 0), (6, 0xfd)] {
            let mut bytes = frame(&[1, 2, 3], true, false);
            bytes[offset] = value;
            assert!(
                NetworkAdtsReader::try_new(source(bytes, 3), &FormatOptions::default()).is_err()
            );
        }
    }
    #[test]
    fn frame_interior_eof_is_damage_not_normal_end() {
        for crc in [false, true] {
            let mut bytes = frame(&[1, 2, 3], true, crc);
            bytes.pop();
            let mut reader =
                NetworkAdtsReader::try_new(source(bytes, 2), &FormatOptions::default()).unwrap();
            assert!(
                matches!(reader.next_packet(), Err(symphonia::core::errors::Error::IoError(error)) if error.kind() == io::ErrorKind::InvalidData)
            );
        }
        assert!(
            matches!(NetworkAdtsReader::try_new(source(vec![0xff, 0xf9, 0x50], 1), &FormatOptions::default()), Err(symphonia::core::errors::Error::IoError(error)) if error.kind() == io::ErrorKind::InvalidData)
        );
    }
}
