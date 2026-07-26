---
doc_id: "TASK-AC-001"
title: "音频兼容性首阶段：合成测试语料与格式能力矩阵"
doc_type: "task"
status: "ready"
owner_agent: "Audio Compatibility Agent"
version_scope: "audio-compatibility-phase-1"
created: "2026-07-26"
updated: "2026-07-26"
source_documents:
  - "docs/requirements/总需求分析.md"
  - ".agents/prompt/Audio_Compatibility_Agent.md"
  - "src-tauri/Cargo.toml"
  - "user request: 建设几乎所有常见音频格式的测试集并推动广泛格式解析能力"
---
# 任务：音频兼容性首阶段——合成测试语料与格式能力矩阵

## 背景

SpMusic 的最终产品需求要求优先支持 `flac`、`wav`、`aac`、`mp3`，并尽量覆盖其他常见格式。当前 Cargo feature 已启用部分 Symphonia codec 和容器能力，但“依赖已编译”“文件选择器允许”“真实解码验证通过”是三种不同状态，不能互相替代。

用户已明确批准创建专门 Agent 推进此能力。为了避免一次性引入大体积 fallback、许可证和跨平台风险，首阶段只建立可重复的兼容性证据基础。

## 优先级与批准结论

- 优先级：P1。
- 状态：Ready，可由 Audio Compatibility Agent 立即执行。
- 范围结论：属于最终产品核心音频能力，但不加入当前 v0.1 Sprint 完成定义。
- 技术边界：Symphonia 为当前主路径；本任务不得引入 FFmpeg。是否增加 FFmpeg fallback 必须在本任务证据完成后另立决策和实现任务。

## 目标

1. 建立区分扩展名、容器、codec 和关键采样参数的格式能力矩阵。
2. 建立短小、确定性、无版权风险、可重复生成的合成音频测试集。
3. 建立现有解析链路的基线验证，明确 `verified`、`unsupported`、`blocked` 和 `not-tested`。
4. 产出可供后续 CI 接入的稳定命令和机器可读清单。
5. 给出下一阶段 Symphonia 扩展候选和 FFmpeg 决策门所需的证据缺口，但不实施 fallback。

## 首阶段范围

### 格式 / codec 矩阵

至少覆盖以下组合；覆盖不代表必须在本阶段全部解码成功：

- MP3：CBR、VBR。
- FLAC：16-bit、24-bit。
- WAV：PCM 16-bit、PCM 24-bit、IEEE float。
- AAC：ADTS/AAC。
- M4A：MP4/AAC、MP4/ALAC。
- OGG：Ogg/Vorbis、Ogg/Opus。
- WebM：WebM/Opus。
- AIFF：AIFF/PCM。

矩阵必须逐项记录：

- 文件扩展名。
- 容器。
- codec。
- 位深或采样格式。
- 采样率。
- 声道数。
- 时长。
- 探测、完整解码、duration、seek、标签读取和标签写入状态。
- 当前实现证据与限制。

### 合成语料

- 使用可辨识的确定性信号：左右声道不同频率、静音段、开头与结尾脉冲。
- 单个正常样本建议不超过 5 秒。
- 同时提供错误样本：空文件、截断文件、扩展名伪装、已知未支持 codec 或容器。
- 每个样本必须在机器可读清单中记录稳定 ID、生成参数、预期结果、文件大小、哈希和许可说明。
- 不得使用或提交版权来源不明的歌曲。

### 基线验证

- 验证实际探测结果，不按扩展名推断 codec。
- 对当前支持组合验证完整解码、声道、采样率、时长和 seek。
- 对不支持或损坏输入验证稳定错误，不 panic、不死循环。
- 记录本机操作系统、架构、Rust 工具链和生成工具版本。
- 提供一个可在 CI 中非交互运行的入口命令；本阶段不创建或修改 `.github/workflows/`。

## 非目标

- 不承诺“所有音频格式”均支持。
- 不修改 `src-tauri/src/audio/**/*`、`src-tauri/Cargo.toml` 或 `src-tauri/Cargo.lock`。
- 不引入 FFmpeg、外部 codec 二进制、新 Rust 解码依赖或运行时下载。
- 不修改文件选择器、前端 UI、播放状态、歌词、标签写回实现或媒体库。
- 不覆盖 DRM、加密媒体、MIDI、Tracker Module、DSD、TAK 等高级或私有格式。
- 不执行跨平台发布认证；只记录当前环境基线和未来平台缺口。

## 首阶段文件所有权

Audio Compatibility Agent 在本任务中只拥有以下新路径：

- `docs/audio-compatibility/format-capability-matrix.md`
- `docs/audio-compatibility/fixture-catalog.md`
- `docs/audio-compatibility/decoder-baseline.md`
- `tools/audio-compatibility/**/*`
- `test-fixtures/audio/**/*`
- `src-tauri/tests/audio_compatibility.rs`
- `src-tauri/tests/audio_compatibility/**/*`

以下路径仅可读取，不能修改：

- `src-tauri/src/audio/**/*`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src/**/*`
- `.github/**/*`

仓库中其他 Agent 的未提交改动必须保留，不得撤销、覆盖或混入本任务。

## 输入

- `.agents/prompt/Audio_Compatibility_Agent.md`
- `.agents/prompt/agents.json`
- `docs/requirements/总需求分析.md`
- `src-tauri/Cargo.toml`
- `src-tauri/src/audio/**/*`
- 现有 `src-tauri/tests/**/*`

## 输出

- 格式 / 容器 / codec 能力矩阵。
- 合成语料生成器。
- 测试语料清单、哈希和许可说明。
- 现有解码链路基线测试与报告。
- 下一阶段候选列表，分别标明 Symphonia 可扩展项和需要 fallback 决策的项。

## 验收标准

- 矩阵至少包含本任务列出的 14 个正常组合，且每项明确区分扩展名、容器和 codec。
- 语料包含左右声道可辨识信号、静音段、首尾脉冲，以及至少 4 个错误输入。
- 所有提交语料均可由仓库内生成器重复生成；清单包含生成参数、SHA-256、文件大小和许可说明。
- 自动化验证不依据扩展名判断 codec，并检查探测、完整解码、声道、采样率、时长和适用格式的 seek。
- 不支持和损坏样本产生可分类的稳定失败，不 panic、不死循环。
- 基线报告为每个组合记录 `verified`、`unsupported`、`blocked` 或 `not-tested`，不得把 Cargo feature 直接写成验证通过。
- 存在一个非交互入口命令，可重新生成或校验语料并运行基线检查；命令和当前环境结果写入报告。
- 报告明确列出下一阶段可通过 Symphonia 推进的组合，以及 FFmpeg 决策门需要评估的覆盖、体积、分发、许可证、安全、跨平台和 CI 成本。
- `git diff -- src-tauri/src/audio src-tauri/Cargo.toml src-tauri/Cargo.lock src .github` 相对任务开始状态无本任务新增改动。

## 风险

- 本机生成工具可用不代表 CI 或其他平台可用，必须记录版本并提供缺失工具时的明确失败。
- 有损编码的采样数、编码延迟和 seek 误差不能使用与 PCM 完全相同的断言。
- 容器和 codec 的组合数量会快速膨胀，首阶段必须维持批准矩阵，不追加长尾格式。
- FFmpeg 的能力、体积和许可证选择相互关联，不能仅根据“能解码更多格式”决定引入。

## 后续闸门

本任务验收后，由 PM Agent 根据基线证据拆分下一任务：

1. 优先启用或补齐 Symphonia 已成熟覆盖的格式。
2. 对 Symphonia 缺口单独评估 FFmpeg fallback。
3. 只有在 fallback 决策获批后，才允许修改生产解码路径、Cargo 依赖、打包配置和 CI workflow。
