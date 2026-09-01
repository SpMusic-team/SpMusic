# Audio compatibility fixture generator

This tool creates short deterministic synthetic fixtures without copyrighted source audio.
The WAV and invalid-input baseline uses only the Node.js standard library. If `ffmpeg` is
already on `PATH`, the generator also attempts the approved derived profiles. It never
downloads or bundles `ffmpeg`.

Generator version 2 adds non-Opus Matroska coverage with MKA/FLAC and WebM/Vorbis
fixtures. FFmpeg is still only a fixture-generation dependency, not an application runtime.

From the repository root:

```text
node tools/audio-compatibility/generate-fixtures.mjs generate
node tools/audio-compatibility/generate-fixtures.mjs verify
node tools/audio-compatibility/generate-fixtures.mjs self-check
node tools/audio-compatibility/generate-fixtures.mjs ffmpeg-status
```

Use `--skip-ffmpeg` for a strictly dependency-free baseline. Use `--require-ffmpeg` only
when a job intentionally requires every derived profile; absence then returns exit code 2.
Use `--ffmpeg <absolute-path>` or the task-specific `SPMUSIC_FFMPEG_PATH` environment
variable when FFmpeg is installed but the current shell has not refreshed its `PATH`.
Generated binary files live under `test-fixtures/audio/generated/` and are ignored by Git.
