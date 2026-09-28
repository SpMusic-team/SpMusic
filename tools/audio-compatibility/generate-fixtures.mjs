#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_OUTPUT = join(REPO_ROOT, "test-fixtures/audio/generated");
const DEFAULT_MANIFEST = join(REPO_ROOT, "test-fixtures/audio/manifest.json");
const LICENSE = "CC0-1.0";
const GENERATOR_VERSION = 3;

const BASE_FIXTURES = [
  {
    id: "wav-pcm16-stereo-ident",
    fileName: "wav-pcm16-stereo-ident.wav",
    container: "WAV",
    codec: "PCM signed integer little-endian",
    sampleFormat: "s16",
    bitsPerSample: 16,
    sampleRateHz: 44_100,
    channels: 2,
    durationMs: 3_000,
    signal: "250-750 ms silence; 440 Hz left / 880 Hz right; first and final sample impulses",
  },
  {
    id: "wav-pcm24-stereo-ident",
    fileName: "wav-pcm24-stereo-ident.wav",
    container: "WAV",
    codec: "PCM signed integer little-endian",
    sampleFormat: "s24",
    bitsPerSample: 24,
    sampleRateHz: 48_000,
    channels: 2,
    durationMs: 3_000,
    signal: "250-750 ms silence; 440 Hz left / 880 Hz right; first and final sample impulses",
  },
  {
    id: "wav-f32-mono-pulse",
    fileName: "wav-f32-mono-pulse.wav",
    container: "WAV",
    codec: "IEEE float",
    sampleFormat: "f32",
    bitsPerSample: 32,
    sampleRateHz: 48_000,
    channels: 1,
    durationMs: 2_000,
    signal: "500-1000 ms silence; 660 Hz mono tone; first and final sample impulses",
  },
  {
    id: "wav-pcm16-mono-silence",
    fileName: "wav-pcm16-mono-silence.wav",
    container: "WAV",
    codec: "PCM signed integer little-endian",
    sampleFormat: "s16",
    bitsPerSample: 16,
    sampleRateHz: 8_000,
    channels: 1,
    durationMs: 1_000,
    signal: "digital silence",
    silenceOnly: true,
  },
  {
    id: "wav-pcm24-88200",
    fileName: "wav-pcm24-88200.wav",
    container: "WAV",
    codec: "PCM signed integer little-endian",
    sampleFormat: "s24",
    bitsPerSample: 24,
    sampleRateHz: 88_200,
    channels: 2,
    durationMs: 1_000,
    signal: "440 Hz left / 880 Hz right with boundary impulses",
  },
  {
    id: "wav-f32-96000",
    fileName: "wav-f32-96000.wav",
    container: "WAV",
    codec: "IEEE float",
    sampleFormat: "f32",
    bitsPerSample: 32,
    sampleRateHz: 96_000,
    channels: 2,
    durationMs: 1_000,
    signal: "440 Hz left / 880 Hz right with boundary impulses",
  },
  {
    id: "wav-pcm24-176400",
    fileName: "wav-pcm24-176400.wav",
    container: "WAV",
    codec: "PCM signed integer little-endian",
    sampleFormat: "s24",
    bitsPerSample: 24,
    sampleRateHz: 176_400,
    channels: 2,
    durationMs: 1_000,
    signal: "440 Hz left / 880 Hz right with boundary impulses",
  },
  {
    id: "wav-f32-192000",
    fileName: "wav-f32-192000.wav",
    container: "WAV",
    codec: "IEEE float",
    sampleFormat: "f32",
    bitsPerSample: 32,
    sampleRateHz: 192_000,
    channels: 2,
    durationMs: 1_000,
    signal: "440 Hz left / 880 Hz right with boundary impulses",
  },
  {
    id: "wav-pcm16-12345",
    fileName: "wav-pcm16-12345.wav",
    container: "WAV",
    codec: "PCM signed integer little-endian",
    sampleFormat: "s16",
    bitsPerSample: 16,
    sampleRateHz: 12_345,
    channels: 1,
    durationMs: 1_000,
    signal: "660 Hz mono tone at an unusual but valid sample rate",
  },
];

const DERIVED_FIXTURES = [
  {
    id: "mp3-cbr",
    fileName: "mp3-cbr.mp3",
    sourceId: "wav-pcm16-stereo-ident",
    container: "MPEG audio",
    codec: "MP3",
    sampleFormat: "lossy",
    args: ["-codec:a", "libmp3lame", "-b:a", "128k", "-write_xing", "0"],
  },
  {
    id: "mp3-vbr",
    fileName: "mp3-vbr.mp3",
    sourceId: "wav-pcm16-stereo-ident",
    container: "MPEG audio",
    codec: "MP3",
    sampleFormat: "lossy",
    args: ["-codec:a", "libmp3lame", "-q:a", "4"],
  },
  {
    id: "flac-16",
    fileName: "flac-16.flac",
    sourceId: "wav-pcm16-stereo-ident",
    container: "FLAC",
    codec: "FLAC",
    sampleFormat: "s16",
    bitsPerSample: 16,
    args: ["-codec:a", "flac", "-sample_fmt", "s16"],
  },
  {
    id: "flac-24",
    fileName: "flac-24.flac",
    sourceId: "wav-pcm24-stereo-ident",
    container: "FLAC",
    codec: "FLAC",
    sampleFormat: "s32 (24 valid bits)",
    bitsPerSample: 24,
    args: ["-codec:a", "flac", "-sample_fmt", "s32"],
  },
  {
    id: "aac-adts",
    fileName: "aac-adts.aac",
    sourceId: "wav-pcm16-stereo-ident",
    container: "ADTS",
    codec: "AAC-LC",
    sampleFormat: "lossy",
    args: ["-codec:a", "aac", "-profile:a", "aac_low", "-b:a", "128k", "-f", "adts"],
  },
  {
    id: "m4a-aac",
    fileName: "m4a-aac.m4a",
    sourceId: "wav-pcm16-stereo-ident",
    container: "ISO BMFF / MP4",
    codec: "AAC-LC",
    sampleFormat: "lossy",
    args: ["-codec:a", "aac", "-profile:a", "aac_low", "-b:a", "128k", "-movflags", "+faststart"],
  },
  {
    id: "m4a-alac",
    fileName: "m4a-alac.m4a",
    sourceId: "wav-pcm24-stereo-ident",
    container: "ISO BMFF / MP4",
    codec: "ALAC",
    sampleFormat: "s32 (24 valid bits)",
    bitsPerSample: 24,
    args: ["-codec:a", "alac", "-sample_fmt", "s32p"],
  },
  {
    id: "ogg-vorbis",
    fileName: "ogg-vorbis.ogg",
    sourceId: "wav-pcm16-stereo-ident",
    container: "Ogg",
    codec: "Vorbis",
    sampleFormat: "lossy",
    args: ["-codec:a", "libvorbis", "-q:a", "4"],
  },
  {
    id: "ogg-opus",
    fileName: "ogg-opus.ogg",
    sourceId: "wav-pcm16-stereo-ident",
    container: "Ogg",
    codec: "Opus",
    sampleFormat: "lossy",
    args: ["-codec:a", "libopus", "-b:a", "96k", "-f", "ogg"],
  },
  {
    id: "opus-extension",
    fileName: "opus-extension.opus",
    sourceId: "wav-pcm16-stereo-ident",
    container: "Ogg",
    codec: "Opus",
    sampleFormat: "lossy",
    args: ["-codec:a", "libopus", "-b:a", "96k", "-f", "ogg"],
  },
  {
    id: "oga-vorbis",
    fileName: "oga-vorbis.oga",
    sourceId: "wav-pcm16-stereo-ident",
    container: "Ogg",
    codec: "Vorbis",
    sampleFormat: "lossy",
    args: ["-codec:a", "libvorbis", "-q:a", "4", "-f", "ogg"],
  },
  {
    id: "webm-opus",
    fileName: "webm-opus.webm",
    sourceId: "wav-pcm16-stereo-ident",
    container: "WebM",
    codec: "Opus",
    sampleFormat: "lossy",
    args: ["-codec:a", "libopus", "-b:a", "96k", "-f", "webm"],
  },
  {
    id: "weba-opus",
    fileName: "weba-opus.weba",
    sourceId: "wav-pcm16-stereo-ident",
    container: "WebM",
    codec: "Opus",
    sampleFormat: "lossy",
    args: ["-codec:a", "libopus", "-b:a", "96k", "-f", "webm"],
  },
  {
    id: "mp4-aac",
    fileName: "mp4-aac.mp4",
    sourceId: "wav-pcm16-stereo-ident",
    container: "ISO BMFF / MP4",
    codec: "AAC-LC",
    sampleFormat: "lossy",
    args: ["-codec:a", "aac", "-profile:a", "aac_low", "-b:a", "128k", "-f", "mp4"],
  },
  {
    id: "m4b-aac",
    fileName: "m4b-aac.m4b",
    sourceId: "wav-pcm16-stereo-ident",
    container: "ISO BMFF / MP4",
    codec: "AAC-LC",
    sampleFormat: "lossy",
    args: ["-codec:a", "aac", "-profile:a", "aac_low", "-b:a", "128k", "-f", "mp4"],
  },
  {
    id: "m4b-aac-chapters",
    fileName: "m4b-aac-chapters.m4b",
    sourceId: "wav-pcm16-stereo-ident",
    container: "ISO BMFF / MP4",
    codec: "AAC-LC",
    sampleFormat: "lossy",
    ffmetadata: `;FFMETADATA1
[CHAPTER]
TIMEBASE=1/1000
START=0
END=1500
title=Opening
[CHAPTER]
TIMEBASE=1/1000
START=1500
END=3000
title=Finale
`,
    args: ["-codec:a", "aac", "-profile:a", "aac_low", "-b:a", "128k", "-f", "mp4"],
  },
  {
    id: "aiff-pcm16",
    fileName: "aiff-pcm16.aiff",
    sourceId: "wav-pcm16-stereo-ident",
    container: "AIFF",
    codec: "PCM signed integer big-endian",
    sampleFormat: "s16",
    bitsPerSample: 16,
    args: ["-codec:a", "pcm_s16be", "-f", "aiff"],
  },
  {
    id: "caf-pcm16",
    fileName: "caf-pcm16.caf",
    sourceId: "wav-pcm16-stereo-ident",
    container: "CAF",
    codec: "PCM signed integer little-endian",
    sampleFormat: "s16",
    bitsPerSample: 16,
    args: ["-codec:a", "pcm_s16le", "-f", "caf"],
  },
  {
    id: "mka-flac",
    fileName: "mka-flac.mka",
    sourceId: "wav-pcm16-stereo-ident",
    container: "Matroska",
    codec: "FLAC",
    sampleFormat: "s16",
    bitsPerSample: 16,
    args: ["-codec:a", "flac", "-sample_fmt", "s16", "-f", "matroska"],
  },
  {
    id: "webm-vorbis",
    fileName: "webm-vorbis.webm",
    sourceId: "wav-pcm16-stereo-ident",
    container: "WebM",
    codec: "Vorbis",
    sampleFormat: "lossy",
    args: ["-codec:a", "libvorbis", "-q:a", "4", "-f", "webm"],
  },
  {
    id: "flac-24-192000",
    fileName: "flac-24-192000.flac",
    sourceId: "wav-f32-192000",
    container: "FLAC",
    codec: "FLAC",
    sampleFormat: "s32 (24 valid bits)",
    bitsPerSample: 24,
    args: ["-codec:a", "flac", "-sample_fmt", "s32"],
  },
  {
    id: "wav-pcm16-5.1",
    fileName: "wav-pcm16-5.1.wav",
    sourceId: "wav-pcm16-stereo-ident",
    container: "WAV",
    codec: "PCM signed integer little-endian",
    sampleFormat: "s16",
    bitsPerSample: 16,
    channels: 6,
    args: [
      "-filter:a",
      "pan=5.1|FL=FL|FR=FR|FC=0.5*FL+0.5*FR|LFE=0*FL|BL=FL|BR=FR",
      "-codec:a",
      "pcm_s16le",
    ],
  },
  {
    id: "ogg-opus-long-audiobook",
    fileName: "ogg-opus-long-audiobook.opus",
    sourceId: "wav-pcm16-stereo-ident",
    container: "Ogg",
    codec: "Opus",
    sampleFormat: "lossy",
    sampleRateHz: 48_000,
    durationMs: 1_800_000,
    signal: "30 minute repeated deterministic stereo identification signal",
    inputArgs: ["-stream_loop", "599"],
    args: ["-t", "1800", "-codec:a", "libopus", "-b:a", "32k", "-f", "ogg"],
  },
];

function parseArguments(argv) {
  const command = argv[2] ?? "generate";
  const options = {
    command,
    output: DEFAULT_OUTPUT,
    manifest: DEFAULT_MANIFEST,
    ffmpegExecutable: process.env.SPMUSIC_FFMPEG_PATH || "ffmpeg",
    skipFfmpeg: false,
    requireFfmpeg: false,
  };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") {
      options.output = resolve(argv[++index]);
    } else if (argument === "--manifest") {
      options.manifest = resolve(argv[++index]);
    } else if (argument === "--ffmpeg") {
      options.ffmpegExecutable = resolve(argv[++index]);
    } else if (argument === "--skip-ffmpeg") {
      options.skipFfmpeg = true;
    } else if (argument === "--require-ffmpeg") {
      options.requireFfmpeg = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function signalSample(frame, channel, fixture) {
  if (fixture.silenceOnly) return 0;
  const totalFrames = Math.round((fixture.sampleRateHz * fixture.durationMs) / 1000);
  if (frame === 0) return channel === 0 ? 0.9 : -0.9;
  if (frame === totalFrames - 1) return channel === 0 ? -0.9 : 0.9;
  const time = frame / fixture.sampleRateHz;
  const silenceStart = fixture.durationMs === 2_000 ? 0.5 : 0.25;
  const silenceEnd = fixture.durationMs === 2_000 ? 1.0 : 0.75;
  if (time >= silenceStart && time < silenceEnd) return 0;
  const frequency = fixture.channels === 1 ? 660 : channel === 0 ? 440 : 880;
  return 0.35 * Math.sin(2 * Math.PI * frequency * time);
}

function encodeSample(buffer, offset, value, sampleFormat) {
  const clamped = Math.max(-1, Math.min(1, value));
  if (sampleFormat === "s16") {
    const sample = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    buffer.writeInt16LE(sample, offset);
    return;
  }
  if (sampleFormat === "s24") {
    let sample =
      clamped < 0 ? Math.round(clamped * 8_388_608) : Math.round(clamped * 8_388_607);
    if (sample < 0) sample += 0x1000000;
    buffer[offset] = sample & 0xff;
    buffer[offset + 1] = (sample >>> 8) & 0xff;
    buffer[offset + 2] = (sample >>> 16) & 0xff;
    return;
  }
  if (sampleFormat === "f32") {
    buffer.writeFloatLE(clamped, offset);
    return;
  }
  throw new Error(`Unsupported baseline sample format: ${sampleFormat}`);
}

function wavBytes(fixture) {
  const bytesPerSample = fixture.bitsPerSample / 8;
  const frameCount = Math.round((fixture.sampleRateHz * fixture.durationMs) / 1000);
  const dataSize = frameCount * fixture.channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(fixture.sampleFormat === "f32" ? 3 : 1, 20);
  buffer.writeUInt16LE(fixture.channels, 22);
  buffer.writeUInt32LE(fixture.sampleRateHz, 24);
  buffer.writeUInt32LE(
    fixture.sampleRateHz * fixture.channels * bytesPerSample,
    28,
  );
  buffer.writeUInt16LE(fixture.channels * bytesPerSample, 32);
  buffer.writeUInt16LE(fixture.bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < fixture.channels; channel += 1) {
      encodeSample(buffer, offset, signalSample(frame, channel, fixture), fixture.sampleFormat);
      offset += bytesPerSample;
    }
  }
  return buffer;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileRecord(filePath) {
  const bytes = readFileSync(filePath);
  return { sizeBytes: bytes.length, sha256: sha256(bytes) };
}

function commonManifestEntry(definition, filePath, generation) {
  return {
    id: definition.id,
    path: `generated/${definition.fileName}`,
    extension: definition.fileName.split(".").pop(),
    container: definition.container,
    codec: definition.codec,
    sampleFormat: definition.sampleFormat,
    bitsPerSample: definition.bitsPerSample ?? null,
    sampleRateHz: definition.sampleRateHz,
    channels: definition.channels,
    durationMs: definition.durationMs,
    signal: definition.signal,
    expected: {
      validAudio: true,
      probe: "success-by-content",
      fullDecode: "success",
      duration: "within-format-tolerance",
      seek: "success-when-decoder-supports",
      metadataRead: "empty-or-readable",
      metadataWrite: "not-tested",
    },
    generation,
    license: LICENSE,
    status: "generated",
    ...fileRecord(filePath),
  };
}

function ffmpegInfo(executable) {
  const result = spawnSync(executable, ["-version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error?.code === "ENOENT") {
    return { available: false, version: null, reason: `ffmpeg was not found: ${executable}` };
  }
  if (result.status !== 0) {
    return {
      available: false,
      version: null,
      reason: `ffmpeg -version exited with status ${result.status}`,
    };
  }
  return {
    available: true,
    version: result.stdout.split(/\r?\n/, 1)[0],
    reason: null,
  };
}

function runFfmpeg(executable, sourcePath, outputPath, profile) {
  const metadataPath = profile.ffmetadata ? `${outputPath}.ffmetadata` : null;
  if (metadataPath) writeFileSync(metadataPath, profile.ffmetadata);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...(profile.inputArgs ?? []),
    "-i",
    sourcePath,
    ...(metadataPath ? ["-f", "ffmetadata", "-i", metadataPath, "-map_metadata", "1", "-map_chapters", "1"] : ["-map_metadata", "-1"]),
    "-fflags",
    "+bitexact",
    "-flags:a",
    "+bitexact",
    ...profile.args,
    outputPath,
  ];
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (metadataPath) rmSync(metadataPath, { force: true });
  return { args, result };
}

function writeErrorFixtures(output, baseEntries) {
  const source = join(output, "wav-pcm16-stereo-ident.wav");
  const sourceBytes = readFileSync(source);
  const definitions = [
    {
      id: "error-empty",
      fileName: "error-empty.bin",
      bytes: Buffer.alloc(0),
      expectedFailure: "empty-input",
    },
    {
      id: "error-truncated-wav",
      fileName: "error-truncated.wav",
      bytes: sourceBytes.subarray(0, 54),
      expectedFailure: "truncated-payload",
    },
    {
      id: "error-disguised-wav-as-mp3",
      fileName: "error-disguised-wav-as-mp3.mp3",
      bytes: sourceBytes,
      expectedFailure: null,
      expectedContainer: "WAV",
    },
    {
      id: "error-unsupported-container",
      fileName: "error-unsupported.audio",
      bytes: Buffer.from("SPMUSIC_UNSUPPORTED_AUDIO_FIXTURE_V1\n", "ascii"),
      expectedFailure: "unsupported-container",
    },
  ];

  return definitions.map((definition) => {
    const filePath = join(output, definition.fileName);
    writeFileSync(filePath, definition.bytes);
    const disguised = definition.id === "error-disguised-wav-as-mp3";
    return {
      id: definition.id,
      path: `generated/${definition.fileName}`,
      extension: definition.fileName.split(".").pop(),
      container: disguised ? "WAV (extension disguised as MP3)" : "invalid/unknown",
      codec: disguised ? "PCM signed integer little-endian" : "none",
      sampleFormat: disguised ? "s16" : null,
      bitsPerSample: disguised ? 16 : null,
      sampleRateHz: disguised ? 44_100 : null,
      channels: disguised ? 2 : null,
      durationMs: disguised ? 3_000 : null,
      signal: disguised ? baseEntries[0].signal : null,
      expected: {
        validAudio: disguised,
        probe: disguised ? "success-as-WAV-by-content" : "stable-classified-failure",
        fullDecode: disguised ? "success" : "failure",
        duration: disguised ? "within-format-tolerance" : "failure",
        seek: disguised ? "success-when-decoder-supports" : "not-applicable",
        metadataRead: "not-tested",
        metadataWrite: "not-tested",
        failureClass: definition.expectedFailure,
      },
      generation: { kind: "built-in-error-fixture", sourceId: disguised ? baseEntries[0].id : null },
      license: LICENSE,
      status: "generated",
      ...fileRecord(filePath),
    };
  });
}

function writeCompressedErrorFixtures(output, entries) {
  const definitions = [
    ["error-truncated-mp3", "mp3-vbr.mp3"],
    ["error-truncated-flac", "flac-24.flac"],
    ["error-truncated-aac", "aac-adts.aac"],
    ["error-truncated-m4a", "m4a-aac.m4a"],
    ["error-truncated-ogg-vorbis", "ogg-vorbis.ogg"],
    ["error-truncated-ogg-opus", "ogg-opus.ogg"],
  ];

  for (const [id, sourceName] of definitions) {
    const sourcePath = join(output, sourceName);
    if (!existsSync(sourcePath)) continue;
    const sourceBytes = readFileSync(sourcePath);
    const extension = sourceName.split(".").pop();
    const fileName = `${id}.${extension}`;
    const filePath = join(output, fileName);
    const retainedBytes = Math.max(32, Math.floor(sourceBytes.length / 3));
    writeFileSync(filePath, sourceBytes.subarray(0, retainedBytes));
    entries.push({
      id,
      path: `generated/${fileName}`,
      extension,
      container: "truncated compressed stream",
      codec: "source codec, intentionally truncated",
      sampleFormat: null,
      bitsPerSample: null,
      sampleRateHz: null,
      channels: null,
      durationMs: null,
      signal: null,
      expected: {
        validAudio: false,
        probe: "success-or-stable-classified-failure",
        fullDecode: "failure-or-incomplete",
        duration: "unknown-or-incomplete",
        seek: "failure-without-panic",
        metadataRead: "failure-or-empty",
        metadataWrite: "not-applicable",
        failureClass: "truncated-payload",
      },
      generation: {
        kind: "deterministic-truncation",
        sourcePath: `generated/${sourceName}`,
        retainedBytes,
      },
      license: LICENSE,
      status: "generated",
      ...fileRecord(filePath),
    });
  }
}

function generate(options) {
  mkdirSync(options.output, { recursive: true });
  mkdirSync(dirname(options.manifest), { recursive: true });

  const entries = [];
  const definitionById = new Map(BASE_FIXTURES.map((fixture) => [fixture.id, fixture]));
  for (const definition of BASE_FIXTURES) {
    const filePath = join(options.output, definition.fileName);
    writeFileSync(filePath, wavBytes(definition));
    entries.push(
      commonManifestEntry(definition, filePath, {
        kind: "built-in-wav-writer",
        generatorVersion: GENERATOR_VERSION,
      }),
    );
  }
  entries.push(...writeErrorFixtures(options.output, entries));

  const ffmpeg = options.skipFfmpeg
    ? { available: false, version: null, reason: "disabled by --skip-ffmpeg" }
    : ffmpegInfo(options.ffmpegExecutable);

  if (!ffmpeg.available) {
    console.warn(`FFmpeg unavailable: ${ffmpeg.reason}. Derived fixtures were not generated.`);
  } else {
    console.log(`FFmpeg detected: ${ffmpeg.version}`);
  }

  for (const profile of DERIVED_FIXTURES) {
    const source = definitionById.get(profile.sourceId);
    const inherited = {
      sampleRateHz: profile.sampleRateHz ?? source.sampleRateHz,
      channels: profile.channels ?? source.channels,
      durationMs: profile.durationMs ?? source.durationMs,
      signal: profile.signal ?? source.signal,
    };
    if (!ffmpeg.available) {
      entries.push({
        ...profile,
        ...inherited,
        path: `generated/${profile.fileName}`,
        extension: profile.fileName.split(".").pop(),
        bitsPerSample: profile.bitsPerSample ?? null,
        expected: {
          validAudio: true,
          probe: "not-tested",
          fullDecode: "not-tested",
          duration: "not-tested",
          seek: "not-tested",
          metadataRead: "not-tested",
          metadataWrite: "not-tested",
        },
        generation: {
          kind: "ffmpeg-derived",
          sourceId: profile.sourceId,
          ffmpegArgs: [...(profile.inputArgs ?? []), ...profile.args],
        },
        license: LICENSE,
        status: "blocked",
        blockedReason: ffmpeg.reason,
        sizeBytes: null,
        sha256: null,
        args: undefined,
        inputArgs: undefined,
        ffmetadata: undefined,
        sourceId: undefined,
        fileName: undefined,
      });
      continue;
    }

    const sourcePath = join(outputPath(options.output, profile.sourceId, BASE_FIXTURES));
    const destination = join(options.output, profile.fileName);
    const { args, result } = runFfmpeg(
      options.ffmpegExecutable,
      sourcePath,
      destination,
      profile,
    );
    if (result.status !== 0) {
      entries.push({
        ...profile,
        ...inherited,
        path: `generated/${profile.fileName}`,
        extension: profile.fileName.split(".").pop(),
        bitsPerSample: profile.bitsPerSample ?? null,
        expected: {
          validAudio: true,
          probe: "not-tested",
          fullDecode: "not-tested",
          duration: "not-tested",
          seek: "not-tested",
          metadataRead: "not-tested",
          metadataWrite: "not-tested",
        },
        generation: { kind: "ffmpeg-derived", sourceId: profile.sourceId, ffmpegArgs: args },
        license: LICENSE,
        status: "blocked",
        blockedReason: result.stderr.trim() || `ffmpeg exited with status ${result.status}`,
        sizeBytes: null,
        sha256: null,
        args: undefined,
        inputArgs: undefined,
        ffmetadata: undefined,
        sourceId: undefined,
        fileName: undefined,
      });
      console.warn(`FFmpeg profile ${profile.id} blocked: ${result.stderr.trim()}`);
      continue;
    }

    entries.push(
      commonManifestEntry(
        { ...profile, ...inherited },
        destination,
        { kind: "ffmpeg-derived", sourceId: profile.sourceId, ffmpegArgs: args },
      ),
    );
  }
  writeCompressedErrorFixtures(options.output, entries);

  const manifest = {
    schemaVersion: 1,
    generator: {
      path: "tools/audio-compatibility/generate-fixtures.mjs",
      version: GENERATOR_VERSION,
      runtime: "Node.js standard library only for WAV and error baselines",
      ffmpeg: {
        requiredForBaseline: false,
        executable: basename(options.ffmpegExecutable),
        available: ffmpeg.available,
        version: ffmpeg.version,
        status: ffmpeg.available ? "detected" : "unavailable",
        reason: ffmpeg.reason,
        downloadAttempted: false,
      },
    },
    fixtureLicense: LICENSE,
    fixtures: entries,
  };
  writeFileSync(options.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Generated ${entries.filter((entry) => entry.status === "generated").length} fixtures; ` +
      `${entries.filter((entry) => entry.status === "blocked").length} blocked. ` +
      `Manifest: ${relative(REPO_ROOT, options.manifest) || options.manifest}`,
  );

  if (options.requireFfmpeg && !ffmpeg.available) process.exitCode = 2;
  return manifest;
}

function outputPath(output, sourceId, fixtures) {
  const source = fixtures.find((fixture) => fixture.id === sourceId);
  if (!source) throw new Error(`Unknown source fixture: ${sourceId}`);
  return join(output, source.fileName);
}

function verify(options) {
  const manifest = JSON.parse(readFileSync(options.manifest, "utf8"));
  const failures = [];
  for (const fixture of manifest.fixtures) {
    const filePath = join(options.output, fixture.path.replace(/^generated\//, ""));
    if (fixture.status === "blocked") {
      if (existsSync(filePath)) {
        failures.push(`${fixture.id}: blocked fixture unexpectedly exists`);
      }
      continue;
    }
    if (!existsSync(filePath)) {
      failures.push(`${fixture.id}: file is missing`);
      continue;
    }
    const actual = fileRecord(filePath);
    if (actual.sizeBytes !== fixture.sizeBytes) {
      failures.push(`${fixture.id}: size ${actual.sizeBytes} != ${fixture.sizeBytes}`);
    }
    if (actual.sha256 !== fixture.sha256) {
      failures.push(`${fixture.id}: sha256 ${actual.sha256} != ${fixture.sha256}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Fixture verification failed:\n- ${failures.join("\n- ")}`);
  }
  console.log(`Verified ${manifest.fixtures.length} manifest entries.`);
}

function selfCheck() {
  const first = mkdtempSync(join(tmpdir(), "spmusic-audio-fixtures-a-"));
  const second = mkdtempSync(join(tmpdir(), "spmusic-audio-fixtures-b-"));
  try {
    const firstOptions = {
      output: join(first, "generated"),
      manifest: join(first, "manifest.json"),
      ffmpegExecutable: "ffmpeg",
      skipFfmpeg: true,
      requireFfmpeg: false,
    };
    const secondOptions = {
      ...firstOptions,
      output: join(second, "generated"),
      manifest: join(second, "manifest.json"),
    };
    const firstManifest = generate(firstOptions);
    const secondManifest = generate(secondOptions);
    verify(firstOptions);
    verify(secondOptions);
    const firstStable = firstManifest.fixtures
      .filter((entry) => entry.status === "generated")
      .map(({ id, sizeBytes, sha256 }) => ({ id, sizeBytes, sha256 }));
    const secondStable = secondManifest.fixtures
      .filter((entry) => entry.status === "generated")
      .map(({ id, sizeBytes, sha256 }) => ({ id, sizeBytes, sha256 }));
    if (JSON.stringify(firstStable) !== JSON.stringify(secondStable)) {
      throw new Error("Built-in fixture generation is not deterministic");
    }
    console.log(`Self-check passed for ${firstStable.length} deterministic built-in fixtures.`);
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
}

try {
  const options = parseArguments(process.argv);
  if (options.command === "generate") generate(options);
  else if (options.command === "verify") verify(options);
  else if (options.command === "self-check") selfCheck();
  else if (options.command === "ffmpeg-status") {
    const status = ffmpegInfo(options.ffmpegExecutable);
    console.log(JSON.stringify({ ...status, downloadAttempted: false }, null, 2));
    if (!status.available) process.exitCode = 2;
  } else {
    throw new Error(`Unknown command: ${options.command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
