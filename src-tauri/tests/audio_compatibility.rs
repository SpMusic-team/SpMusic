use std::{
    fs::File,
    io::ErrorKind,
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use lofty::file::AudioFile;
use symphonia::{
    core::{
        codecs::{
            CodecRegistry, CodecType, DecoderOptions, CODEC_TYPE_ALAC, CODEC_TYPE_FLAC,
            CODEC_TYPE_OPUS, CODEC_TYPE_PCM_F32LE, CODEC_TYPE_PCM_S16BE, CODEC_TYPE_PCM_S16LE,
            CODEC_TYPE_PCM_S24LE, CODEC_TYPE_VORBIS,
        },
        errors::Error as SymphoniaError,
        formats::{FormatOptions, FormatReader, SeekMode, SeekTo},
        io::MediaSourceStream,
        meta::MetadataOptions,
        probe::Hint,
    },
    default::{get_probe, register_enabled_codecs},
};
use symphonia_adapter_libopus::OpusDecoder;

struct GeneratedCorpus {
    root: PathBuf,
}

impl GeneratedCorpus {
    fn create() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "spmusic-audio-compatibility-{}-{unique}",
            std::process::id()
        ));
        let output = root.join("generated");
        let manifest = root.join("manifest.json");
        std::fs::create_dir_all(&root).expect("temporary corpus directory should be created");

        let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri should have a repository parent");
        let generator = repository.join("tools/audio-compatibility/generate-fixtures.mjs");
        let mut command = Command::new("node");
        command.arg(generator).arg("generate");
        if let Some(ffmpeg_path) = std::env::var_os("SPMUSIC_FFMPEG_PATH") {
            command
                .arg("--require-ffmpeg")
                .arg("--ffmpeg")
                .arg(ffmpeg_path);
        } else {
            command.arg("--skip-ffmpeg");
        }
        let result = command
            .arg("--output")
            .arg(&output)
            .arg("--manifest")
            .arg(&manifest)
            .output()
            .expect("Node.js must be available to generate the compatibility corpus");
        assert!(
            result.status.success(),
            "fixture generator failed:\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );

        Self { root }
    }

    fn fixture(&self, name: &str) -> PathBuf {
        self.root.join("generated").join(name)
    }
}

impl Drop for GeneratedCorpus {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

struct DecodeEvidence {
    codec: CodecType,
    sample_rate: u32,
    channels: usize,
    decoded_frames: u64,
    declared_frames: Option<u64>,
}

fn open_format(path: &Path) -> Result<Box<dyn FormatReader>, SymphoniaError> {
    let source = MediaSourceStream::new(Box::new(File::open(path)?), Default::default());
    get_probe()
        .format(
            &Hint::new(),
            source,
            &FormatOptions {
                enable_gapless: true,
                ..Default::default()
            },
            &MetadataOptions::default(),
        )
        .map(|probed| probed.format)
}

fn decode_fully(path: &Path) -> Result<DecodeEvidence, SymphoniaError> {
    let mut format = open_format(path)?;
    let track = format
        .default_track()
        .or_else(|| format.tracks().first())
        .ok_or(SymphoniaError::Unsupported("fixture has no audio track"))?;
    let track_id = track.id;
    let codec = track.codec_params.codec;
    let mut sample_rate = track.codec_params.sample_rate.unwrap_or_default();
    let mut channels = track
        .codec_params
        .channels
        .map(|channels| channels.count())
        .unwrap_or_default();
    let declared_frames = track.codec_params.n_frames;
    let mut decoder = codec_registry().make(&track.codec_params, &DecoderOptions::default())?;
    let mut decoded_frames = 0_u64;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error)) if error.kind() == ErrorKind::UnexpectedEof => {
                break
            }
            Err(error) => return Err(error),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = decoder.decode(&packet)?;
        sample_rate = decoded.spec().rate;
        channels = decoded.spec().channels.count();
        decoded_frames += decoded.frames() as u64;
    }

    Ok(DecodeEvidence {
        codec,
        sample_rate,
        channels,
        decoded_frames,
        declared_frames,
    })
}

fn codec_registry() -> &'static CodecRegistry {
    static REGISTRY: OnceLock<CodecRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let mut registry = CodecRegistry::new();
        register_enabled_codecs(&mut registry);
        registry.register_all::<OpusDecoder>();
        registry
    })
}

fn assert_seekable(path: &Path, seconds: f64) {
    let mut format = open_format(path).expect("valid fixture should be probed before seek");
    let track_id = format
        .default_track()
        .expect("fixture should have a track")
        .id;
    let result = format.seek(
        SeekMode::Accurate,
        SeekTo::Time {
            time: seconds.into(),
            track_id: Some(track_id),
        },
    );
    assert!(result.is_ok(), "seek to {seconds}s failed: {result:?}");
}

fn assert_wav(
    corpus: &GeneratedCorpus,
    file_name: &str,
    codec: CodecType,
    sample_rate: u32,
    channels: usize,
    duration_ms: u64,
) {
    let path = corpus.fixture(file_name);
    let evidence = decode_fully(&path).expect("generated WAV should fully decode");
    assert_eq!(evidence.codec, codec, "codec must be detected from content");
    assert_eq!(evidence.sample_rate, sample_rate);
    assert_eq!(evidence.channels, channels);
    let expected_frames = sample_rate as u64 * duration_ms / 1_000;
    assert_eq!(evidence.decoded_frames, expected_frames);
    assert_eq!(evidence.declared_frames, Some(expected_frames));

    let tagged = lofty::read_from_path(&path).expect("generated WAV metadata should be readable");
    assert_eq!(
        tagged.properties().duration().as_millis() as u64,
        duration_ms
    );
    assert_seekable(&path, 0.0);
    assert_seekable(&path, duration_ms as f64 / 2_000.0);
    assert_seekable(&path, duration_ms as f64 / 1_000.0 - 0.001);
}

#[test]
fn generated_wav_baseline_probes_decodes_and_seeks_by_content() {
    let corpus = GeneratedCorpus::create();
    assert_wav(
        &corpus,
        "wav-pcm16-stereo-ident.wav",
        CODEC_TYPE_PCM_S16LE,
        44_100,
        2,
        3_000,
    );
    assert_wav(
        &corpus,
        "wav-pcm24-stereo-ident.wav",
        CODEC_TYPE_PCM_S24LE,
        48_000,
        2,
        3_000,
    );
    assert_wav(
        &corpus,
        "wav-f32-mono-pulse.wav",
        CODEC_TYPE_PCM_F32LE,
        48_000,
        1,
        2_000,
    );
    assert_wav(
        &corpus,
        "wav-pcm16-mono-silence.wav",
        CODEC_TYPE_PCM_S16LE,
        8_000,
        1,
        1_000,
    );
}

#[test]
fn invalid_and_disguised_inputs_have_stable_content_based_results() {
    let corpus = GeneratedCorpus::create();

    for file_name in ["error-empty.bin", "error-unsupported.audio"] {
        let path = corpus.fixture(file_name);
        let result = std::panic::catch_unwind(|| open_format(&path));
        assert!(result.is_ok(), "{file_name} must not panic");
        assert!(
            result.expect("probe should return normally").is_err(),
            "{file_name} must not probe successfully"
        );
    }

    let truncated = corpus.fixture("error-truncated.wav");
    let result = std::panic::catch_unwind(|| decode_fully(&truncated));
    assert!(result.is_ok(), "truncated WAV must not panic");
    match result.expect("decode should return normally") {
        Ok(evidence) => assert!(
            evidence.decoded_frames < 44_100,
            "truncated WAV must not report a complete decode"
        ),
        Err(_) => {}
    }

    let disguised = corpus.fixture("error-disguised-wav-as-mp3.mp3");
    let evidence = decode_fully(&disguised).expect("disguised valid WAV should decode by content");
    assert_eq!(evidence.codec, CODEC_TYPE_PCM_S16LE);
    assert_eq!(evidence.decoded_frames, 132_300);
}

#[test]
fn ffmpeg_derived_formats_match_the_current_symphonia_capability_boundary() {
    if std::env::var_os("SPMUSIC_FFMPEG_PATH").is_none() {
        return;
    }

    let corpus = GeneratedCorpus::create();
    for (file_name, expected_codec, sample_rate, channels) in [
        ("mp3-cbr.mp3", None, 44_100, 2),
        ("mp3-vbr.mp3", None, 44_100, 2),
        ("flac-16.flac", Some(CODEC_TYPE_FLAC), 44_100, 2),
        ("flac-24.flac", Some(CODEC_TYPE_FLAC), 48_000, 2),
        ("aac-adts.aac", None, 44_100, 2),
        ("m4a-aac.m4a", None, 44_100, 2),
        ("m4a-alac.m4a", Some(CODEC_TYPE_ALAC), 48_000, 2),
        ("ogg-vorbis.ogg", Some(CODEC_TYPE_VORBIS), 44_100, 2),
        ("oga-vorbis.oga", Some(CODEC_TYPE_VORBIS), 44_100, 2),
        ("aiff-pcm16.aiff", Some(CODEC_TYPE_PCM_S16BE), 44_100, 2),
        ("caf-pcm16.caf", Some(CODEC_TYPE_PCM_S16LE), 44_100, 2),
        ("mka-flac.mka", Some(CODEC_TYPE_FLAC), 44_100, 2),
        ("webm-vorbis.webm", Some(CODEC_TYPE_VORBIS), 44_100, 2),
        ("ogg-opus.ogg", Some(CODEC_TYPE_OPUS), 48_000, 2),
        ("opus-extension.opus", Some(CODEC_TYPE_OPUS), 48_000, 2),
        ("webm-opus.webm", Some(CODEC_TYPE_OPUS), 48_000, 2),
        ("weba-opus.weba", Some(CODEC_TYPE_OPUS), 48_000, 2),
        ("mp4-aac.mp4", None, 44_100, 2),
        ("m4b-aac.m4b", None, 44_100, 2),
        ("wav-pcm24-88200.wav", Some(CODEC_TYPE_PCM_S24LE), 88_200, 2),
        ("wav-f32-96000.wav", Some(CODEC_TYPE_PCM_F32LE), 96_000, 2),
        (
            "wav-pcm24-176400.wav",
            Some(CODEC_TYPE_PCM_S24LE),
            176_400,
            2,
        ),
        ("wav-f32-192000.wav", Some(CODEC_TYPE_PCM_F32LE), 192_000, 2),
        ("wav-pcm16-12345.wav", Some(CODEC_TYPE_PCM_S16LE), 12_345, 1),
        ("flac-24-192000.flac", Some(CODEC_TYPE_FLAC), 192_000, 2),
        ("wav-pcm16-5.1.wav", Some(CODEC_TYPE_PCM_S16LE), 44_100, 6),
    ] {
        let evidence =
            decode_fully(&corpus.fixture(file_name)).expect("enabled format should fully decode");
        assert!(evidence.decoded_frames > 0, "{file_name} decoded no audio");
        if let Some(expected_codec) = expected_codec {
            assert_eq!(evidence.codec, expected_codec, "{file_name} codec mismatch");
        }
        assert_eq!(evidence.sample_rate, sample_rate, "{file_name} sample rate");
        assert_eq!(evidence.channels, channels, "{file_name} channel count");
    }

    for file_name in [
        "mp3-cbr.mp3",
        "mp3-vbr.mp3",
        "flac-16.flac",
        "flac-24.flac",
        "aac-adts.aac",
        "ogg-vorbis.ogg",
        "m4a-alac.m4a",
        "aiff-pcm16.aiff",
        "caf-pcm16.caf",
    ] {
        assert_seekable(&corpus.fixture(file_name), 1.5);
    }
}

#[test]
fn truncated_compressed_inputs_never_panic_or_report_a_complete_decode() {
    if std::env::var_os("SPMUSIC_FFMPEG_PATH").is_none() {
        return;
    }

    let corpus = GeneratedCorpus::create();
    for file_name in [
        "error-truncated-mp3.mp3",
        "error-truncated-flac.flac",
        "error-truncated-aac.aac",
        "error-truncated-m4a.m4a",
        "error-truncated-ogg-vorbis.ogg",
        "error-truncated-ogg-opus.ogg",
    ] {
        let path = corpus.fixture(file_name);
        let result = std::panic::catch_unwind(|| decode_fully(&path));
        assert!(result.is_ok(), "{file_name} must not panic");
        if let Ok(evidence) = result.expect("decode must return normally") {
            assert!(
                evidence.decoded_frames < evidence.sample_rate as u64 * 3,
                "{file_name} unexpectedly decoded the complete three-second source"
            );
        }
    }
}

#[test]
fn committed_manifest_has_required_contract_and_stable_hashes() {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri should have a repository parent");
    let manifest_path = repository.join("test-fixtures/audio/manifest.json");
    let manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read(manifest_path).expect("committed fixture manifest should be readable"),
    )
    .expect("fixture manifest should be valid JSON");
    assert_eq!(manifest["schemaVersion"], 1);
    assert_eq!(manifest["fixtureLicense"], "CC0-1.0");

    let fixtures = manifest["fixtures"]
        .as_array()
        .expect("manifest fixtures should be an array");
    assert!(
        fixtures.len() >= 18,
        "approved normal and error matrix is required"
    );
    for fixture in fixtures {
        let status = fixture["status"]
            .as_str()
            .expect("every fixture should have a status");
        assert!(
            matches!(status, "generated" | "blocked"),
            "unexpected fixture status: {status}"
        );
        if status == "generated" {
            let hash = fixture["sha256"]
                .as_str()
                .expect("generated fixture should have SHA-256");
            assert_eq!(hash.len(), 64);
            assert!(hash.bytes().all(|byte| byte.is_ascii_hexdigit()));
            assert!(fixture["sizeBytes"].is_u64());
        } else {
            assert!(fixture["blockedReason"].is_string());
        }
        assert_eq!(fixture["license"], "CC0-1.0");
        assert!(fixture["container"].is_string());
        assert!(fixture["codec"].is_string());
        assert!(fixture["expected"]["probe"].is_string());
    }
}
