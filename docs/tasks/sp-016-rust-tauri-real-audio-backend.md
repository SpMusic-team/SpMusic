---
doc_id: "TASK-SP-016"
title: "Rust/Tauri 最小真实音频播放后端"
doc_type: "task"
status: "done"
owner_agent: "Rust/Tauri Agent"
version_scope: "v0.1"
created: "2026-07-24"
updated: "2026-07-24"
source_documents:
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/tasks/sp-015-real-audio-architecture-contract.md"
  - "docs/architecture/real-audio-playback.md"
  - "docs/implementation/real-audio-backend.md"
  - "docs/sprint-plan.md"
---
# 任务：Rust/Tauri 最小真实音频播放后端

## 背景

用户已批准真实播放进入 v0.1。Rust/Tauri 后端需要提供最小可验证的本地音频播放能力，让播放器从 UI-only 状态进入真实播放闭环。

## 目标

- 根据 SP-015 的架构契约实现最小 Tauri command。
- 支持加载或选择一个本地音频资源并播放。
- 支持暂停、停止和查询播放状态 / 进度。
- 返回稳定、可序列化的状态和错误码。
- 保持最小权限和最小依赖。

## 非目标

- 不实现媒体库、文件夹扫描、数据库或持久化索引。
- 不实现真实播放列表、播放历史、收藏或 `m3u8`。
- 不实现网络存储播放、在线服务或插件系统。
- 不实现真实频谱分析、高级 DSP 或独占输出。

## 负责 Agent

Rust/Tauri Agent

## 涉及文件 / 模块

- `src-tauri/src/**/*`
- `src-tauri/Cargo.toml`
- `src-tauri/capabilities/*.json`
- `docs/implementation/*.md`

## 验收标准

- 已实现 SP-015 定义的 command。
- `cargo check` 通过。
- 一个本地音频资源可以被播放。
- 播放中可以暂停，暂停后可以继续或停止。
- 前端可查询播放状态和进度。
- 无效路径、不可播放文件和后端播放错误返回稳定错误码。
- 未新增媒体库、数据库、播放列表、网络存储或插件能力。

## 备注

本任务依赖 SP-015。若 command 契约不清，必须先退回 Architecture Agent。

## 实施记录

- 2026-07-24：已新增 `src-tauri/src/audio.rs`，并在 `src-tauri/src/lib.rs` 注册 `audio_open_file`、`audio_load_file`、`audio_play`、`audio_pause`、`audio_stop`、`audio_seek`、`audio_get_state`。
- 2026-07-24：已在 `src-tauri/Cargo.toml` 接入 `rodio` 与 `rfd`，用于最小本地音频播放和原生文件选择。
- 2026-07-24：补齐 Windows MSVC 工具链后，已将音频后端调整为 `AudioController` + 专用音频线程模型，避免 `rodio::OutputStream` 作为 Tauri managed state 跨线程共享。
- 2026-07-24：`cargo check` 通过，无 warning。人工播放闭环交由 SP-018 继续验证。
