---
doc_id: "AUDIO-COMPATIBILITY-INDEXED-SEEK-FFMPEG-FALLBACK"
title: "索引 Seek 与 LGPL FFmpeg Fallback 决策记录"
doc_type: "technical-decision-record"
status: "active"
owner_agent: "Audio Compatibility Agent"
version_scope: "audio-compatibility-phase-4"
created: "2026-07-26"
updated: "2026-07-26"
source_documents:
  - "src-tauri/src/audio/symphonia_source.rs"
  - "src-tauri/src/audio/source.rs"
  - "src-tauri/tests/audio_compatibility.rs"
  - "user request: 实现 media-seek + Symphonia/libopus 与后续 LGPL FFmpeg fallback"
---

# 索引 Seek 与 LGPL FFmpeg Fallback 决策记录

## 已交付：Ogg/Opus 快速 Seek

生产路径重新打开 Ogg/Opus 文件，调用 Symphonia 0.5.5 的原生 page seek，重置
bundled libopus decoder，并从目标前 80 ms 开始 pre-roll。索引、文件或解码异常时
自动回到既有 `reopen + linear decode`。

Windows x64 debug 基准使用 FFmpeg 生成的 120 秒双声道 Ogg/Opus，跳到 108 秒：

| 路径 | 耗时 | 相对速度 |
| --- | ---: | ---: |
| Ogg page index + pre-roll | 35 ms | 82.0x |
| reopen + linear decode | 2911 ms | 1.0x |

索引输出与线性参考的归一化相关系数为 `0.999922`，最佳对齐偏差为 94 个
48 kHz PCM frame（约 1.96 ms）。损耗 codec 在 decoder reset 后不能承诺与从头
连续解码逐点 bit-exact；验收使用波形相关性和时间对齐。无损路径仍要求逐样本一致。

## 未引入：media-seek 0.4.0

`media-seek` 未加入 Cargo：

- 许可证为 `GPL-3.0-only`，与当前尚未声明整体许可证的应用分发策略存在决策缺口。
- API 是异步 HTTP Range 时间窗到字节窗规划器，只公开
  `ContainerIndex::find_byte_range`，不公开原始 Cues/Ogg page 索引。
- Symphonia 0.5.5 不支持注入外部索引或按外部 byte offset 恢复
  `FormatReader` 状态。
- Ogg 实现使用有限数量的等距 8 KiB 探测窗口，并非完整 page 二分索引；未覆盖
  chained/multiplexed logical streams 和 Opus pre-skip。

它不满足本地播放器的 decoder state、pre-roll 和样本位置契约。

## 已交付：Matroska Cues 快速 Seek

项目在 `src-tauri/vendor/matroska-demuxer` 固定维护 `matroska-demuxer 0.8.0`，
保留其 `MIT OR Apache-2.0 OR Zlib` 许可证。受控补丁只修复一处：
`CueRelativePosition` 必须相对于目标 `CueClusterPosition`，不能相对于首个 Cluster。

该 demuxer 只负责 MKA/MKV/WebM 的 Cues 定位和 packet 拆分；FLAC、Vorbis 和 Opus
packet 仍由 Symphonia/libopus 解码。索引缺失时依赖内部线性扫描；索引损坏、定位、
decoder 或 refine 失败时，生产入口回到既有 `reopen + linear decode`。

Windows x64 debug、120 秒语料跳到 108 秒的最终独立回归：

| 组合 | 索引 | 线性参考 | 相关性 | 偏差 |
| --- | ---: | ---: | ---: | ---: |
| MKA/FLAC | 27 ms | 4461 ms | 1.000000 | 0 frame，2048 样本逐点一致 |
| WebM/Vorbis | 41 ms | 6551 ms | 0.999874 | 102 frame，约 2.13 ms |
| WebM/Opus | 30 ms | 3003 ms | 0.999825 | 33 frame，约 0.69 ms |

三个组合均低于 100 ms，位置误差低于 5 ms。测试还覆盖无 Cues 和损坏
CueClusterPosition：均不 panic，并自动完成线性兜底。

维护方式：

- 上游版本固定为 0.8.0，Cargo 使用仓库内 path dependency，不读取本机 registry。
- vendor 目录保留原 README 和三份许可证；除目标修复外不做功能扩张。
- 升级前必须重新对比上游，确认该修复是否已发布，并重跑长语料、损坏/无 Cues、
  多音轨和三平台 CI。

## LGPL FFmpeg Fallback 边界

批准的长期边界是：FFmpeg 只处理 Symphonia 返回 `UnsupportedFormat` 的长尾格式；
不替换 Rodio/CPAL、播放状态或控制器。

```text
open_source(path)
  -> Symphonia/libopus
  -> 仅 UnsupportedFormat 时查询 FfmpegBackend
  -> 其他 I/O、损坏文件和 decoder 错误原样返回，不静默换后端
```

FFmpeg 后端至少要提供 `probe/open/decode/seek/close`，统一输出交错 PCM、采样率、
声道数、duration 和可恢复错误，并限制：

- probe/open/seek 超时、取消和最大探测字节；
- packet/frame 队列、解码内存和线程数量；
- decoder flush、时间基、codec delay/pre-roll 和资源清理；
- 损坏文件不 panic、不无限循环、不启动无限子进程；
- 日志不泄漏用户文件内容。

用 libavformat 解决“Symphonia 能解码但 Matroska seek 失败”属于 seek-only fallback，
与“仅 `UnsupportedFormat` 触发”不同，必须单独批准，不能静默启用。

### 长尾格式证据

当前 Symphonia 0.5.5 + libopus 注册表没有下列 decoder；本机受审查的 BtbN LGPL
构建通过 `ffmpeg -decoders` / `-demuxers` 确认具有相应能力：

| 容器/家族 | codec | Symphonia | BtbN LGPL 构建 |
| --- | --- | --- | --- |
| APE | Monkey's Audio | unsupported | decoder + demuxer |
| ASF/WMA | WMA1/2、WMA Lossless | unsupported | decoder + ASF demuxer |
| WV | WavPack | unsupported | decoder + demuxer |
| MPC | Musepack SV7/SV8 | unsupported | decoder + demuxer |
| TTA | True Audio | unsupported | decoder + demuxer |
| AMR | AMR-NB/WB | unsupported | decoder + demuxer |
| AC-3/E-AC-3 | AC-3/E-AC-3 | unsupported | decoder + raw demuxer |
| OMA/ATRAC | ATRAC3/3+/9 | unsupported | decoder + OMA demuxer |
| DSF/DSDIFF | DSD | unsupported | DSD decoder + DSF demuxer |

这说明 FFmpeg fallback 对“几乎所有常见与长尾音频”的目标有实际价值，而不是只为
修复一个容器。但这些组合尚未建立可分发语料、duration/seek/声道/采样格式回归，
所以状态仍是 `unsupported`（Symphonia）与 `candidate`（FFmpeg），不能写成产品支持。

## 当前 BtbN 构建审查

本机包为 `BtbN.FFmpeg.LGPL.8.1`
`n8.1.2-21-gce3c09c101-20260630`。winget 标记 `LGPL-2.1`，安装包 SHA-256：

```text
3b9eceb438016b647e0755a51ce3a388cd4ed5679e2427cb83a01e1ae2cd0eba
```

配置含 `--enable-version3`、`--disable-libfdk-aac`、`--disable-libx264`、
`--disable-libx265`，并启用大量无关的视频、滤镜、设备和网络组件。这是 Windows
x64 静态 CLI，不是三平台最小 libav SDK；不得硬编码 winget 路径或提交该二进制。

生产分发仍阻塞于：

- 明确 SpMusic 许可证，核对 FFmpeg LGPL 版本、链接方式和所有第三方库；本文不是
  法律意见。
- 为 Windows x64/ARM64、macOS x64/arm64、Linux x64/arm64 建立锁版本、可复现、
  LGPL-only 的最小 `libavformat + libavcodec + libavutil + libswresample` 构建。
- 选择动态链接或满足静态链接重新链接义务，提供许可证、对应源码和构建脚本。
- 建立 Rust FFI/ABI 锁定、签名、公证、安装器、更新与 CVE 响应流程。
- 用长尾语料证明 fallback 只在 `UnsupportedFormat` 触发且不改变主路径。

这些阻塞解除前，FFmpeg 继续只作为测试语料生成工具，不进入播放器运行时。
