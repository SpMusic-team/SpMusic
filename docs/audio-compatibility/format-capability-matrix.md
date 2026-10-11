---
doc_id: "AUDIO-COMPATIBILITY-MATRIX"
title: "音频格式能力矩阵"
doc_type: "compatibility-evidence"
status: "active"
owner_agent: "Audio Compatibility Agent"
version_scope: "existing-format-hardening"
created: "2026-07-26"
updated: "2026-07-26"
source_documents:
  - "test-fixtures/audio/manifest.json"
  - "src-tauri/src/audio/source.rs"
  - "src-tauri/src/audio/symphonia_source.rs"
  - "src-tauri/tests/audio_compatibility.rs"
---
# 音频格式能力矩阵

`verified` 只表示仓库中的确定性合成语料已通过自动验证。扩展名用于文件选择器和
probe hint；容器与 codec 最终仍由文件内容决定。

| 容器 / codec | 扩展名证据 | 解码 | duration | seek | 标签/封面/歌词读写 |
| --- | --- | --- | --- | --- | --- |
| MPEG Audio / MP3 CBR、VBR | `.mp3` | verified | verified | verified；fresh decoder、pre-roll、encoder delay | verified |
| FLAC 16/24-bit | `.flac` | verified | verified | verified | verified |
| ADTS / AAC-LC | `.aac` | verified | verified；packet scan 修正码率估算偏差 | verified | not-tested |
| ISO BMFF / AAC-LC | `.m4a`、`.mp4`、`.m4b` | verified | verified | verified | verified |
| ISO BMFF / ALAC 24-bit | `.m4a` | verified | verified | verified | verified |
| Ogg / Vorbis | `.ogg`、`.oga` | verified | verified | verified | verified |
| Ogg / Opus | `.ogg`、`.opus` | verified | verified | verified；Ogg page index + pre-roll | verified |
| WebM / Vorbis | `.webm` | verified | verified | verified；Matroska Cues | not-tested |
| WebM / Opus | `.webm`、`.weba` | verified | verified | verified；Matroska Cues | not-tested |
| Matroska / FLAC | `.mka`、`.mkv` | verified | verified | verified；Matroska Cues | not-tested |
| WAV / PCM、float | `.wav` | verified | verified | verified | read verified；通用写回不在本轮矩阵 |
| AIFF / PCM | `.aif`、`.aiff` | verified | verified | verified | not-tested |
| CAF / PCM | `.caf` | verified | verified | verified | not-tested |

## 参数和异常输入

- verified：88.2、96、176.4、192 kHz。
- verified：16/24-bit integer、32-bit float、12.345 kHz 非常规但有效采样率。
- verified：5.1 WAV 经生产 `open_source` 输出为双声道。
- verified：30 分钟 Ogg/Opus 在 90% 位置完成索引 seek，验收上限 100 ms。
- verified：空文件、未知容器、伪装扩展名、截断 WAV/MP3/FLAC/AAC/M4A/
  Ogg Vorbis/Ogg Opus 均不会 panic。

## 能力边界

- ReplayGain：读取 track/album gain 和 peak；track 优先；增益限制为
  `-24..+12 dB`，peak 会进一步限制倍率以避免声明峰值削波。存在标签时生产播放源应用该倍率。
- gapless：单文件 demux 使用 `enable_gapless`，MP3/AAC/Opus 编码延迟与尾部
  padding 的残差验证在两个 codec frame 内。跨曲目无缝队列未实现。
- CUE：整轨 CUE 解析和分轨区间模型已验证；尚未暴露 Tauri/前端契约。
- M4B：Nero `chpl` 章节解析模型已用真实生成的两章节 M4B 验证；尚未暴露公共契约。
- 播放进度持久化：明确 deferred，本轮未修改。
- FFmpeg 只用于生成 CC0 测试语料，不进入播放器运行时。
- 本轮实机证据来自 Windows x64；macOS、Linux 仍需 CI/实机验证。
