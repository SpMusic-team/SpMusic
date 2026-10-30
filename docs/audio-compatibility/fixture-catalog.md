---
doc_id: "AUDIO-COMPATIBILITY-FIXTURE-CATALOG"
title: "音频兼容性合成语料目录"
doc_type: "test-catalog"
status: "active"
owner_agent: "Audio Compatibility Agent"
version_scope: "existing-format-hardening"
created: "2026-07-26"
updated: "2026-07-26"
source_documents:
  - "test-fixtures/audio/manifest.json"
  - "tools/audio-compatibility/generate-fixtures.mjs"
---
# 音频兼容性合成语料目录

所有语料均由仓库生成器创建，不包含歌曲、录音或第三方媒体，许可为 `CC0-1.0`。
机器可读清单位于 `test-fixtures/audio/manifest.json`。

## 命令

```text
node tools/audio-compatibility/generate-fixtures.mjs generate --skip-ffmpeg
node tools/audio-compatibility/generate-fixtures.mjs generate --require-ffmpeg --ffmpeg <absolute-path>
node tools/audio-compatibility/generate-fixtures.mjs verify
node tools/audio-compatibility/generate-fixtures.mjs self-check
```

生成器不下载、不安装、不捆绑 FFmpeg。FFmpeg 只生成测试输入，不进入播放器运行时。

## v3 覆盖

内置 Node.js WAV/error 基线为 13 项，并通过两次独立目录生成的 SHA-256 确定性检查：

- 44.1/48 kHz 常规 PCM/float；
- 88.2/96/176.4/192 kHz；
- 24-bit integer、32-bit float；
- 12.345 kHz 非常规但有效采样率；
- 空、未知、伪装扩展名和截断 WAV。

FFmpeg 派生覆盖：

- MP3 CBR/VBR、FLAC 16/24、AAC ADTS、M4A AAC/ALAC；
- Ogg Vorbis/Opus、WebM Vorbis/Opus、MKA FLAC；
- AIFF、CAF；
- `.opus/.oga/.weba/.mp4/.m4b` 等价后缀；
- 192 kHz 24-bit FLAC、5.1 WAV；
- 30 分钟 Ogg/Opus；
- 带两个 Nero `chpl` 章节的 M4B；
- MP3/FLAC/AAC/M4A/Ogg Vorbis/Ogg Opus 六类截断流。

当前 Windows x64 使用 BtbN LGPL FFmpeg 8.1.2 生成并校验：

```text
42 generated
0 blocked
42 manifest entries verified
```

FFmpeg 派生文件的字节级结果可能随 FFmpeg build 改变，因此哈希记录实际生成环境，
不冒充跨版本固定输出。
