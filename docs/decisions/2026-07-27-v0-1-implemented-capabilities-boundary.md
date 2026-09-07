---
doc_id: "DEC-2026-07-27-V0-1-IMPLEMENTED-CAPABILITIES"
title: "v0.1 已实现能力收口与验收边界"
doc_type: "decision"
status: "accepted"
owner_agent: "PM Agent"
version_scope: "v0.1"
created: "2026-07-27"
updated: "2026-07-27"
source_documents:
  - "user request: 根据评审调整并修复 v0.1 任务"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "src-tauri/src/audio/source.rs"
  - "src-tauri/src/audio/types.rs"
  - "src/features/player/services/audioCommands.ts"
  - "src/features/player/components/PlayerShell.tsx"
  - "docs/audio-compatibility/format-capability-matrix.md"
  - "docs/audio-compatibility/existing-format-hardening.md"
---
# 决策：v0.1 已实现能力收口与验收边界

## 状态

已接受。

## 背景

2026-07-24 的范围决策只批准了单个本地音频资源的真实播放最小闭环。此后仓库已经出现同目录音频浅层枚举、会话内临时队列、嵌入式歌词与封面读取展示，以及较完整的合成语料和格式兼容性证据。继续把这些能力写成“不存在”会使计划与实现脱节；直接把它们解释为媒体库、真实播放列表或跨平台格式承诺，又会造成范围失控。

本决策只收口已经存在的能力和相应验收边界，不批准新的业务扩张，也不把自动化或代码存在等同于人工播放验收通过。

## 决策

### 纳入 v0.1 的已实现候选能力

以下能力进入 v0.1 验收范围，但在 SP-018 取得可复现证据前统一视为“实现候选 / 待验收”：

1. 单文件打开、加载、播放、暂停、继续、停止、seek、状态查询和播放状态事件。
2. 用户显式选择一个音频文件后，对该文件所在目录执行一次非递归、只读的受支持扩展名枚举；结果按文件名稳定排序，并形成当前会话内的临时文件夹队列。
3. 临时文件夹队列中的上一首、下一首、直接选择和自然结束后切换。该队列不持久化、不编辑、不导入导出，也不等同于产品级播放列表或媒体库。
4. 从当前音频文件读取基础标签；存在嵌入式歌词或封面时在现有播放器界面展示，不存在时使用明确后备状态。
5. 使用仓库内确定性合成语料和能力矩阵验证当前 Symphonia / libopus 主路径。产品文档只能声明矩阵中有本次执行证据的容器 / codec 组合，不能外推为“支持所有常见格式”。

### 不进入 v0.1 的能力

- 递归文件夹扫描、增量扫描、文件监控、媒体库索引、数据库和持久化。
- 可创建、编辑、排序、保存、导入或导出的产品级播放列表，以及 `m3u8`。
- 跨目录队列管理、播放历史、收藏持久化和进度持久化。
- 网络或 sidecar 歌词获取、逐字歌词、歌词编辑、封面搜索、封面编辑和标签编辑 UI。
- CUE 分轨、M4B 章节的公共 Tauri / 前端能力。
- FFmpeg 运行时 fallback、长尾格式产品承诺和“几乎所有格式”承诺。
- macOS、Linux、ARM64 或其他尚无构建与声卡实机证据的平台认证。
- 跨曲目 gapless、真实频谱、高级 DSP、独占输出和插件系统。

### 兼容性声明口径

- `verified` 只表示指定语料、指定检查维度和记录环境下通过，不代表所有同扩展名文件均兼容。
- 文件选择器列出的扩展名、Cargo feature 已启用、probe 成功、完整解码成功、seek 成功和声卡实际播放成功是不同证据维度，发布说明必须分别表述。
- 自动化完整解码证据不能替代当前发布制品的可听播放 smoke。
- 当前矩阵的 Windows x64 证据可作为 v0.1 Windows 候选发布输入；其他平台继续标记为未验证。

## 对需求文档的处理

`docs/requirements/v0-1-foundation.md` 由 Requirements Agent 维护，其中 UI-only、无本地文件读取等已批准正文与当前范围决策冲突。PM Agent 不直接改写该需求正文；SP-020 负责由 Requirements Agent 按 2026-07-24 和本决策重新建立 v0.1 需求基线。在 SP-020 完成前，以本决策、`docs/requirements.md` 的状态索引和 `docs/sprint-plan.md` 作为执行边界。

## 对任务状态的影响

- SP-016：已有后端实现和自动检查记录，但缺少被 SP-018 接受的人工播放证据，状态改为 `in-review`。
- SP-017：仓库已有前端 command、真实进度、临时队列、歌词和封面接入，状态改为 `in-review`，不得继续标为 `ready`。
- SP-018：实现依赖已经具备，状态改为 `ready`，并成为唯一的 v0.1 综合验证任务。
- SP-021：新增 Architecture Agent 契约对齐任务，在 SP-018 最终验收前记录临时队列 command / DTO、元数据和状态事件边界。
- SP-011：与 SP-018 重叠，改为 `superseded`。
- SP-012：与 SP-010 重叠且包含过时声明，改为 `superseded`；README 收口统一由 SP-010 执行。
- SP-009、SP-014：移出 v0.1 活跃 Sprint，分别保留为 v0.2 / future 的 `deferred` 任务。

## 验收与发布约束

只有 SP-018 提交可复现的命令、输入、环境、预期 / 实际结果和人工操作证据后，SP-016、SP-017 才能进入完成判断；v0.1 的可发布判断还必须等待 SP-019 完成 Tauri 制品构建、制品 smoke 和版本一致性检查。
