#![allow(dead_code)]

use std::path::{Path, PathBuf};

const CUE_FRAMES_PER_SECOND: u64 = 75;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CueTrack {
    pub number: u32,
    pub title: Option<String>,
    pub performer: Option<String>,
    pub source_path: PathBuf,
    pub start_frame: u64,
    pub end_frame: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CueSheet {
    pub title: Option<String>,
    pub performer: Option<String>,
    pub tracks: Vec<CueTrack>,
}

pub(crate) fn parse_cue(source: &str, cue_path: &Path) -> Result<CueSheet, String> {
    #[derive(Default)]
    struct PendingTrack {
        number: u32,
        title: Option<String>,
        performer: Option<String>,
        source_path: Option<PathBuf>,
        start_frame: Option<u64>,
    }

    let mut sheet_title = None;
    let mut sheet_performer = None;
    let mut current_file = None;
    let mut pending = None::<PendingTrack>;
    let mut tracks = Vec::new();

    let finish_track = |pending: PendingTrack, tracks: &mut Vec<CueTrack>| -> Result<(), String> {
        let source_path = pending
            .source_path
            .ok_or_else(|| format!("TRACK {} has no FILE", pending.number))?;
        let start_frame = pending
            .start_frame
            .ok_or_else(|| format!("TRACK {} has no INDEX 01", pending.number))?;
        tracks.push(CueTrack {
            number: pending.number,
            title: pending.title,
            performer: pending.performer,
            source_path,
            start_frame,
            end_frame: None,
        });
        Ok(())
    };

    for raw_line in source.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with("REM ") {
            continue;
        }
        let mut parts = line.splitn(2, char::is_whitespace);
        let command = parts.next().unwrap_or_default().to_ascii_uppercase();
        let value = parts.next().unwrap_or_default().trim();
        match command.as_str() {
            "FILE" => {
                let file_name = quoted_value(value)
                    .ok_or_else(|| format!("invalid FILE declaration: {line}"))?;
                current_file = Some(
                    cue_path
                        .parent()
                        .unwrap_or_else(|| Path::new(""))
                        .join(file_name),
                );
            }
            "TRACK" => {
                if let Some(previous) = pending.take() {
                    finish_track(previous, &mut tracks)?;
                }
                let number = value
                    .split_whitespace()
                    .next()
                    .ok_or_else(|| format!("invalid TRACK declaration: {line}"))?
                    .parse::<u32>()
                    .map_err(|_| format!("invalid TRACK number: {line}"))?;
                pending = Some(PendingTrack {
                    number,
                    source_path: current_file.clone(),
                    ..Default::default()
                });
            }
            "TITLE" => {
                let title = quoted_value(value).unwrap_or(value).to_string();
                if let Some(track) = pending.as_mut() {
                    track.title = Some(title);
                } else {
                    sheet_title = Some(title);
                }
            }
            "PERFORMER" => {
                let performer = quoted_value(value).unwrap_or(value).to_string();
                if let Some(track) = pending.as_mut() {
                    track.performer = Some(performer);
                } else {
                    sheet_performer = Some(performer);
                }
            }
            "INDEX" if value.starts_with("01 ") => {
                let timestamp = value[3..].trim();
                let track = pending
                    .as_mut()
                    .ok_or_else(|| "INDEX 01 appeared before TRACK".to_string())?;
                track.start_frame = Some(parse_timestamp(timestamp)?);
            }
            _ => {}
        }
    }
    if let Some(last) = pending {
        finish_track(last, &mut tracks)?;
    }
    if tracks.is_empty() {
        return Err("CUE sheet contains no audio tracks".to_string());
    }
    for index in 0..tracks.len().saturating_sub(1) {
        if tracks[index].source_path == tracks[index + 1].source_path {
            tracks[index].end_frame = Some(tracks[index + 1].start_frame);
        }
    }

    Ok(CueSheet {
        title: sheet_title,
        performer: sheet_performer,
        tracks,
    })
}

fn quoted_value(value: &str) -> Option<&str> {
    value.strip_prefix('"')?.split('"').next()
}

fn parse_timestamp(value: &str) -> Result<u64, String> {
    let mut fields = value.split(':');
    let minutes = fields
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| format!("invalid CUE timestamp: {value}"))?;
    let seconds = fields
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value < 60)
        .ok_or_else(|| format!("invalid CUE timestamp: {value}"))?;
    let frames = fields
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value < CUE_FRAMES_PER_SECOND)
        .ok_or_else(|| format!("invalid CUE timestamp: {value}"))?;
    if fields.next().is_some() {
        return Err(format!("invalid CUE timestamp: {value}"));
    }
    Ok((minutes * 60 + seconds) * CUE_FRAMES_PER_SECOND + frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_file_album_into_bounded_track_segments() {
        let cue = r#"
PERFORMER "Synthetic Artist"
TITLE "Synthetic Album"
FILE "album.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Opening"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Finale"
    PERFORMER "Guest"
    INDEX 01 03:15:37
"#;
        let parsed = parse_cue(cue, Path::new("D:/Music/album.cue")).expect("valid CUE");
        assert_eq!(parsed.title.as_deref(), Some("Synthetic Album"));
        assert_eq!(parsed.performer.as_deref(), Some("Synthetic Artist"));
        assert_eq!(parsed.tracks.len(), 2);
        assert_eq!(
            parsed.tracks[0].source_path,
            Path::new("D:/Music/album.flac")
        );
        assert_eq!(parsed.tracks[0].start_frame, 0);
        assert_eq!(parsed.tracks[0].end_frame, Some(14_662));
        assert_eq!(parsed.tracks[1].performer.as_deref(), Some("Guest"));
        assert_eq!(parsed.tracks[1].end_frame, None);
    }

    #[test]
    fn rejects_missing_index_and_invalid_timestamp_without_panicking() {
        assert!(parse_cue(
            "FILE \"album.flac\" WAVE\nTRACK 01 AUDIO",
            Path::new("album.cue")
        )
        .is_err());
        assert!(parse_cue(
            "FILE \"album.flac\" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:61:00",
            Path::new("album.cue")
        )
        .is_err());
    }
}
