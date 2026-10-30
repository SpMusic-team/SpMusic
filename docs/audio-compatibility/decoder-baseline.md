---
doc_id: "AUDIO-COMPATIBILITY-DECODER-BASELINE"
title: "音频解析链路第三阶段基线"
doc_type: "test-report"
status: "active"
owner_agent: "Audio Compatibility Agent"
version_scope: "audio-compatibility-phase-3"
created: "2026-07-26"
updated: "2026-07-26"
source_documents:
  - "docs/tasks/ac-001-audio-compatibility-foundation.md"
  - "src-tauri/src/audio/symphonia_source.rs"
  - "src-tauri/tests/audio_compatibility.rs"
  - "user request: 解决 Opus 解码与 Matroska seek 限制"
---
# 音频解析链路第三阶段基线

## 环境与依赖

- Windows x64，Rust `1.96.1`；项目最低 Rust 版本因 Opus adapter 调整为 `1.89`。
- Rodio 0.19、Symphonia 0.5.5、`symphonia-adapter-libopus` 0.2.x、Lofty 0.24。
- bundled libopus 通过 `opusic-sys` 编译进应用；源码构建需要 CMake 与平台 C/C++ 工具链，运行时不需要这些工具。
- FFmpeg `BtbN.FFmpeg.LGPL.8.1` 8.1.2 只生成测试语料，没有进入生产依赖或应用分发。

## 实现结论

生产 `open_source` 使用自有的惰性 `CodecRegistry`，先注册启用的 Symphonia decoder，再注册 `OpusDecoder`。Ogg/Opus 与 WebM/Opus 现在可完整解码，语料验证结果为 48 kHz、双声道、约 3 秒。

seek 采用两级策略：

1. 默认先调用容器的 Accurate seek 并把结果细化到目标帧。
2. Matroska reader 无法在定位后继续出包时，重新打开文件并线性解码到目标帧。
3. Opus 因 adapter 在随机定位后的 decoder state/pre-roll 无法保证样本精度，直接使用线性策略。

测试不仅检查 seek 返回成功，还把目标位置后的 512 个 i16 样本与从头解码到同一位置的参考结果逐点比较。MKA/FLAC、WebM/Vorbis、Ogg/Opus、WebM/Opus 均通过。

## 验证命令

```text
node tools/audio-compatibility/generate-fixtures.mjs self-check
node tools/audio-compatibility/generate-fixtures.mjs generate --require-ffmpeg --ffmpeg <absolute-path>
node tools/audio-compatibility/generate-fixtures.mjs verify
set SPMUSIC_FFMPEG_PATH=<absolute-path>
cd src-tauri
cargo fmt -- --check
cargo check
cargo test
```

完整结果以执行当次命令输出为准。专用语料覆盖 MP3、FLAC、WAV、AAC、M4A/AAC、M4A/ALAC、Ogg/Vorbis、Ogg/Opus、WebM/Opus、AIFF/PCM、CAF/PCM、MKA/FLAC、WebM/Vorbis和异常输入。

## 残余风险

- 线性 seek 的耗时与目标位置近似成正比；超长 Matroska/Opus 文件的大跨度首次跳转可能有可感知延迟，但不会静默跳错位置。
- bundled libopus 增加 native build 时间和应用体积；其许可证为 Opus license，adapter 为 MIT OR Apache-2.0。
- 尚未取得 macOS、Linux、ARM64 的构建和音频输出设备实机证据。
- 本阶段验证解析与 `rodio::Source` seek，不初始化真实声卡；设备后端播放仍属于独立验证维度。
- 标签写回未测试，不应从“可解码”外推为“可安全写标签”。
