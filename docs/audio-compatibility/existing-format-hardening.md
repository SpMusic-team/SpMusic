---
doc_id: "AUDIO-EXISTING-FORMAT-HARDENING"
title: "现有音频格式完善报告"
doc_type: "implementation-evidence"
status: "active"
owner_agent: "Audio Compatibility Agent"
version_scope: "existing-format-hardening"
created: "2026-07-26"
updated: "2026-07-26"
---
# 现有音频格式完善报告

## Phase A

文件选择器新增 `.opus`、`.oga`、`.weba`、`.mp4`、`.m4b`。生产 probe 和
Lofty 元数据读取都改为真实内容探测；例如扩展名为 `.ogg` 的 Opus 不再被
Lofty 误判成 Vorbis。

语料生成器 v3 当前登记 42 项，实际 FFmpeg 生成结果为 42 generated、0 blocked。
新增证据包括：

- MP3 CBR/VBR、FLAC 16/24、AAC ADTS、Ogg/Vorbis 的生产 duration 和 seek；
- 等价后缀 `.opus/.oga/.weba/.mp4/.m4b`；
- 88.2/96/176.4/192 kHz、24/32-bit、12.345 kHz；
- 30 分钟 Ogg/Opus 有声书式长文件；
- 六类截断压缩流和 5.1 WAV；
- 带两个 Nero `chpl` 章节的 M4B。

ADTS 的码率估算曾把 3 秒文件报告为 2670 ms。生产代码现在识别 ADTS 同步字并
扫描 packet 时间戳，显示 duration 与播放源 `total_duration` 使用一致证据。

MP3/AAC seek 使用 fresh decoder、100 ms pre-roll 和容器提供的 encoder delay，
避免 discontinuity 继续携带旧 decoder state。Ogg Vorbis/Opus 和 Matroska
继续保留索引失败后的线性回退。

## Phase B

安全标签写回流程为：

1. 在原文件同目录创建同扩展名临时副本；
2. 对副本写标签；
3. 用 Symphonia 按内容重新 probe；
4. 备份原文件并替换；安装失败时回滚；
5. 自动测试完整解码写回后的文件并比较样本数。

MP3、FLAC、M4A/AAC、M4A/ALAC、Ogg/Vorbis、Ogg/Opus 均已验证标题、艺术家、
专辑、中英歌词和 PNG 封面往返，写回后仍可完整解码。

ReplayGain、CUE、M4B 章节、多声道策略的状态见能力矩阵。多声道矩阵按常见
Symphonia 交错顺序处理：

- 3.0：中心声道以 `-3 dB` 分配至左右；
- Quad/5.0/5.1/7.1：后置和侧置以 `-3 dB` 分配；
- LFE 以 `-10 dB` 分配；
- 最终保留固定 `-6 dB` headroom，并在 i16 边界饱和。

## 未冒充完成的能力

- 跨文件 gapless 需要播放队列预解码/连续 append；现有后端没有播放列表和
  next-track 契约，因此本轮只验证单文件 codec padding，不宣称跨曲目 gapless。
- CUE 分轨和 M4B 章节已有后端解析模型，但将其展示、选择或播放需要新增公共
  Tauri/前端契约，应交由 Architecture + Rust/Tauri + Frontend Agents。
- 播放进度持久化按要求留后续。
