---
doc_id: "TASK-SP-021"
title: "v0.1 真实播放架构契约对齐"
doc_type: "task"
status: "ready"
owner_agent: "Architecture Agent"
version_scope: "v0.1"
created: "2026-07-27"
updated: "2026-07-27"
source_documents:
  - "docs/architecture/real-audio-playback.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
  - "src-tauri/src/lib.rs"
  - "src-tauri/src/audio/types.rs"
  - "src-tauri/src/audio/source.rs"
  - "src/features/player/services/audioCommands.ts"
  - "src/features/player/components/PlayerShell.tsx"
---
# 任务：v0.1 真实播放架构契约对齐

## 背景

SP-015 的架构契约按单资源最小闭环编写。当前实现已经新增 `audio_list_folder_tracks`、临时文件夹队列 DTO、基础元数据 / 嵌入式歌词 / 封面，以及 `audio_state_changed` 事件；实现说明和前端也已消费这些能力。若不由 Architecture Agent 正式对齐，Test Agent 无法判断偏差是批准能力、缺陷还是待删除实现。

## 目标

- 使 v0.1 架构文档与当前已接受范围和实现候选一致。
- 定义同目录临时队列 command / DTO、稳定排序、非递归、只读和会话内边界。
- 定义高频播放状态与低频歌曲详情的传输边界。
- 定义 command response、轮询和 `audio_state_changed` 事件的同步 / 乱序原则。
- 记录格式兼容性声明维度和实现偏差，不把证据矩阵写成无限产品承诺。

## 非目标

- 不实现或修改 Rust / React 代码。
- 不批准递归扫描、媒体库、数据库、持久播放列表、标签编辑或 FFmpeg runtime。
- 不设计长期播放队列、媒体库或跨平台音频引擎。

## 负责 Agent

Architecture Agent

## 涉及文件 / 模块

- `docs/architecture/real-audio-playback.md`
- 必要时新增 `docs/architecture/*.md` 或由 Architecture Agent 拥有的 decision
- 只读：`src-tauri/src/audio/**/*`
- 只读：`src/features/player/**/*`

## 输入

- 两项 v0.1 范围决策。
- 当前 Rust command、DTO、folder enumeration 和 metadata 实现。
- 当前前端 adapter、状态同步、临时队列和元数据展示实现。
- 音频兼容性能力矩阵。

## 输出

- 更新后的 v0.1 真实播放架构契约。
- “契约一致 / 已批准偏差 / 必须修复偏差”对照表。
- SP-018 可直接映射的 command、DTO、事件、状态、错误和边界检查项。

## 验收标准

- 文档包含 `audio_list_folder_tracks` 的输入、输出、错误语义和非递归 / 只读 / 会话内约束。
- 文档区分临时文件夹队列与媒体库、产品级播放列表。
- `AudioPlaybackState` / `audio_state_changed` 保持轻量；路径、歌词、封面和完整标签只通过低频 `AudioTrackRef` 或等价详情契约传输。
- 文档说明 command response、500ms 轮询和事件并存时如何避免旧状态覆盖最新用户意图。
- 文档说明目录候选按扩展名枚举与最终按内容解码验证的差异。
- 文档按 probe、decode、duration、seek、metadata、真实声卡和平台区分格式能力证据。
- 当前实现与契约的所有已知差异都有 Owner、任务和 SP-018 重测条件。
- 文档明确不批准递归扫描、持久队列、媒体库、标签编辑、FFmpeg runtime 或无证据平台认证。

## 风险

- 按实现逐行补文档可能把偶然实现细节升级为长期 API；只记录 v0.1 必需稳定边界。
- 不定义乱序原则会让 command response、event 和轮询产生前端竞态。
- 不区分扩展名枚举与内容解码会导致队列错误承诺。

## 文档更新

Architecture Agent 维护 `docs/architecture/real-audio-playback.md`；如发现范围问题，回报 PM Agent，不直接修改 Sprint 或需求状态。

