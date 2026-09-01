#![allow(dead_code)]

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

const MAX_CHAPTER_BOX_BYTES: usize = 1_048_576;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AudioChapter {
    pub title: String,
    pub start_ms: u64,
}

pub(crate) fn read_m4b_chapters(path: &Path) -> Result<Vec<AudioChapter>, String> {
    let mut file = File::open(path).map_err(|error| format!("failed to open M4B: {error}"))?;
    let file_len = file
        .metadata()
        .map_err(|error| format!("failed to inspect M4B: {error}"))?
        .len();
    let mut window = [0_u8; 4];
    if file.read_exact(&mut window).is_err() {
        return Ok(Vec::new());
    }
    let mut offset = 4_u64;
    loop {
        if &window == b"chpl" && offset >= 8 {
            file.seek(SeekFrom::Start(offset - 8))
                .map_err(|error| format!("failed to seek chapter box: {error}"))?;
            let mut header = [0_u8; 8];
            file.read_exact(&mut header)
                .map_err(|error| format!("truncated chapter box header: {error}"))?;
            let box_len = u32::from_be_bytes(header[..4].try_into().expect("four bytes")) as usize;
            if !(17..=MAX_CHAPTER_BOX_BYTES).contains(&box_len) {
                return Err(format!("invalid chpl box size: {box_len}"));
            }
            if offset - 8 + box_len as u64 > file_len {
                return Err("chpl box extends past end of file".to_string());
            }
            let mut payload = vec![0_u8; box_len - 8];
            file.read_exact(&mut payload)
                .map_err(|error| format!("truncated chapter box: {error}"))?;
            return parse_chpl_payload(&payload);
        }
        let mut next = [0_u8; 1];
        if file.read_exact(&mut next).is_err() {
            return Ok(Vec::new());
        }
        window.rotate_left(1);
        window[3] = next[0];
        offset += 1;
    }
}

fn parse_chpl_payload(payload: &[u8]) -> Result<Vec<AudioChapter>, String> {
    if payload.len() < 9 {
        return Err("chpl payload is too short".to_string());
    }
    let count = payload[8] as usize;
    let mut cursor = 9_usize;
    let mut chapters = Vec::with_capacity(count);
    for _ in 0..count {
        let timestamp_end = cursor
            .checked_add(8)
            .filter(|end| *end <= payload.len())
            .ok_or_else(|| "truncated chpl timestamp".to_string())?;
        let timestamp_100ns = u64::from_be_bytes(
            payload[cursor..timestamp_end]
                .try_into()
                .expect("eight bytes"),
        );
        cursor = timestamp_end;
        let title_len = *payload
            .get(cursor)
            .ok_or_else(|| "truncated chpl title length".to_string())?
            as usize;
        cursor += 1;
        let title_end = cursor
            .checked_add(title_len)
            .filter(|end| *end <= payload.len())
            .ok_or_else(|| "truncated chpl title".to_string())?;
        let title = String::from_utf8_lossy(&payload[cursor..title_end]).into_owned();
        cursor = title_end;
        chapters.push(AudioChapter {
            title,
            start_ms: timestamp_100ns / 10_000,
        });
    }
    Ok(chapters)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_generated_m4b_nero_chapter_box() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repository root")
            .join("test-fixtures/audio/generated/m4b-aac-chapters.m4b");
        if !fixture.exists() {
            return;
        }
        let chapters = read_m4b_chapters(&fixture).expect("generated chapters should parse");
        assert_eq!(
            chapters,
            vec![
                AudioChapter {
                    title: "Opening".to_string(),
                    start_ms: 0,
                },
                AudioChapter {
                    title: "Finale".to_string(),
                    start_ms: 1_500,
                },
            ]
        );
    }

    #[test]
    fn rejects_truncated_chapter_payload() {
        assert!(parse_chpl_payload(&[1, 0, 0, 0, 0, 0, 0, 0, 1]).is_err());
    }
}
