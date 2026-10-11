---
doc_id: "TASK-SP-016"
title: "Rust/Tauri 最小真实音频播放后端"
doc_type: "task"
status: "in-review"
owner_agent: "Rust/Tauri Agent"
version_scope: "v0.1"
created: "2026-07-24"
updated: "2026-07-27"
source_documents:
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/tasks/sp-015-real-audio-architecture-contract.md"
  - "docs/architecture/real-audio-playback.md"
  - "docs/implementation/real-audio-backend.md"
  - "docs/sprint-plan.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
  - "src-tauri/src/audio/source.rs"
  - "src-tauri/src/audio/types.rs"
---
# 任务：Rust/Tauri 最小真实音频播放后端

## 背景

用户已批准真实播放进入 v0.1。仓库当前已有播放 command、专用音频线程、状态事件、同目录临时队列、基础元数据、歌词 / 封面和兼容性硬化实现，但历史 `cargo check` 与代码存在不能替代人工声卡和发布制品验收。

## 目标

- 根据 SP-015 的架构契约提供真实播放 command、状态和稳定错误码。
- 支持本地音频的加载、播放、暂停、继续、停止、seek 和状态查询。
- 提供用户选中文件后同目录非递归、只读枚举所需的稳定 DTO。
- 读取基础标签、嵌入式歌词和封面，但不建立媒体库或标签编辑能力。
- 把实现候选交给 SP-018 完成功能综合验收；v0.1 发布另由 SP-019 验证制品。

## 非目标

- 不实现递归扫描、媒体库、数据库或持久化索引。
- 不实现产品级播放列表、临时队列持久化、播放历史、收藏或 `m3u8`。
- 不实现网络存储播放、在线服务或插件系统。
- 不实现网络歌词、歌词 / 封面 / 标签编辑、FFmpeg 运行时或跨曲目 gapless。

## 负责 Agent

Rust/Tauri Agent

## 涉及文件 / 模块

- `src-tauri/src/**/*`
- `src-tauri/Cargo.toml`
- `src-tauri/capabilities/*.json`
- `docs/implementation/*.md`

## 输入

- SP-015 的 command、DTO、错误码和生命周期契约。
- 两项 v0.1 范围决策。
- 当前 `src-tauri/src/audio/**/*` 实现。
- `docs/audio-compatibility/format-capability-matrix.md` 和确定性语料。

## 输出

- 可由前端调用的播放、状态和同目录临时队列 command。
- 基础标签、嵌入式歌词 / 封面 DTO。
- 对无效路径、不可读、不可解码和播放初始化失败的稳定错误。
- 后端实现说明，以及交给 SP-018 的命令和人工验证输入。

## 验收标准

- 已实现并注册 SP-015 定义的 command；新增 command 或 DTO 偏差已在架构文档或显式偏差清单中记录。
- 在同一 commit 上执行 `cargo fmt -- --check`、`cargo check`、`cargo test`，退出码均为 0。
- `audio_list_folder_tracks` 只对选中文件的父目录做一次非递归、只读枚举，结果稳定排序；损坏 / 不可播放文件不得静默宣称可播放。
- `AudioPlaybackState` 保持轻量，不在高频状态或事件中传输封面、歌词和路径详情。
- 基础标签、嵌入式歌词 / 封面存在和缺失均返回稳定 DTO / 后备值。
- 一个本地音频资源可通过实际桌面环境被可听播放；该项必须引用 SP-018 证据，不能只引用 `cargo check`。
- 播放中可以暂停，暂停后可以继续、seek 或停止。
- 无效路径、不可播放文件和后端播放错误返回稳定错误码，正常文件可在失败后重新加载。
- 未新增递归扫描、媒体库、数据库、持久播放列表、网络存储、FFmpeg 运行时或插件能力。

## 可复现验证与证据格式

1. 记录 commit SHA、工作区状态、OS / 架构、Rust / Cargo 版本和音频输出设备。
2. 在 `src-tauri` 执行上述 Rust 命令，记录命令、退出码、关键输出和完整日志位置。
3. 以 SP-018 指定 fixture 执行播放、暂停、继续、seek、停止和错误路径；记录输入 SHA-256、预期 / 实际状态及可听结果。
4. 目录中放置至少 3 个可播放样本、1 个损坏样本和一个嵌套子目录；证明结果非递归、排序稳定，失败项有明确处理。
5. 证据必须区分自动解码、声卡实际播放和发布制品 smoke。

## 风险

- `cargo check` 不初始化声卡，无法发现输出设备或 release bundle 问题。
- 文件扩展名过滤可能把损坏或伪装文件列入候选；最终加载仍必须按内容验证并返回错误。
- 封面 data URL 可能增大低频 DTO；不得进入高频状态事件。
- 当前兼容性证据以 Windows x64 为主，其他平台不得宣称通过。
- 当前实现已经超出 SP-015 的单资源契约，Architecture Agent 仍需记录临时队列 command / DTO 偏差。

## 文档更新

- Rust/Tauri Agent 维护 `docs/implementation/real-audio-backend.md`。
- Architecture Agent 维护 `docs/architecture/real-audio-playback.md` 的新增 command / DTO 边界。
- Test Agent 在 SP-018 维护综合验证报告。

## 实施记录

- 2026-07-24：新增并注册 `audio_open_file`、`audio_load_file`、`audio_play`、`audio_pause`、`audio_stop`、`audio_seek`、`audio_get_state`。
- 2026-07-24：接入 `rodio` 与 `rfd`，并调整为 `AudioController` + 专用音频线程模型。
- 2026-07-24：历史 `cargo check` 通过，无 warning；人工播放闭环未在本任务中完成。
- 2026-07-27：仓库事实还包括 `audio_list_folder_tracks`、基础元数据、嵌入式歌词 / 封面和兼容性硬化。

## 当前状态

实现和历史自动检查记录已经存在，但人工播放、临时队列、歌词 / 封面和错误输入尚未被 SP-018 接受，因此状态为 `in-review`，不得标记 Done。SP-019 的发布制品 smoke 是版本发布 Gate，不与本任务形成循环依赖。
