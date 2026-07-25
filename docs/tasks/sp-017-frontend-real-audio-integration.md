---
doc_id: "TASK-SP-017"
title: "前端接入真实播放 command"
doc_type: "task"
status: "ready"
owner_agent: "Frontend Agent"
version_scope: "v0.1"
created: "2026-07-24"
updated: "2026-07-24"
source_documents:
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/tasks/sp-015-real-audio-architecture-contract.md"
  - "docs/tasks/sp-016-rust-tauri-real-audio-backend.md"
  - "docs/sprint-plan.md"
---
# 任务：前端接入真实播放 command

## 背景

当前播放器核心控制来自前端 UI-only 状态。真实播放后端完成后，前端需要接入 Tauri command，把播放、暂停、停止和进度展示切换为真实状态。

## 目标

- 根据 SP-015 和 SP-016 接入 Tauri command。
- 为播放、暂停、停止、状态查询和错误返回建立前端 adapter。
- UI 展示后端真实播放状态和进度。
- 后端不可用或播放失败时，界面不崩溃并显示可理解状态。

## 非目标

- 不修改 Rust 后端实现。
- 不实现媒体库、文件夹扫描、数据库、真实播放列表或网络存储。
- 不把 demo 歌曲数据描述为真实媒体库。

## 负责 Agent

Frontend Agent

## 涉及文件 / 模块

- `src/features/player/**/*`
- `src/features/player/services/*`
- `docs/implementation/frontend-architecture.md`

## 验收标准

- 播放 / 暂停 / 停止按钮调用真实 command。
- 播放状态和进度来自后端返回或事件，而不是纯 UI-only 计时。
- 后端不可用、文件不可播放和播放失败状态可见且不崩溃。
- `npm.cmd run lint` 通过。
- `npm.cmd run build` 通过。

## 备注

本任务依赖 SP-015 和 SP-016。SP-016 已提供通过 `cargo check` 的 Tauri command 后端，前端可以开始接入。
