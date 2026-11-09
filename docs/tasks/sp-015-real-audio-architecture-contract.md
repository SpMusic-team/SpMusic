---
doc_id: "TASK-SP-015"
title: "v0.1 真实播放架构契约"
doc_type: "task"
status: "done"
owner_agent: "Architecture Agent"
version_scope: "v0.1"
created: "2026-07-24"
updated: "2026-07-24"
source_documents:
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/sprint-plan.md"
  - "docs/architecture/real-audio-playback.md"
---
# 任务：v0.1 真实播放架构契约

## 背景

v0.1 已调整为包含真实本地播放最小闭环。旧架构文档仍把真实播放和 Tauri command 排除在 v0.1 外，后端不能在旧契约下安全开工。

## 目标

- 定义 v0.1 最小 Tauri command 名称、输入、输出和错误码。
- 定义 Rust 音频模块边界、前端状态同步方式和生命周期。
- 更新旧 UI-only 架构说明，明确哪些限制已被 2026-07-24 范围变更覆盖。
- 保持媒体库、数据库、真实播放列表和网络存储在 v0.1 范围外。

## 非目标

- 不实现 Rust 或前端代码。
- 不选择完整长期音频架构。
- 不设计媒体库、播放列表、网络存储或插件系统。

## 负责 Agent

Architecture Agent

## 涉及文件 / 模块

- `docs/architecture/overall-architecture.md`
- `docs/architecture/player-state-and-fake-track.md`
- `docs/architecture/real-audio-playback.md`
- `docs/decisions/`

## 验收标准

- 架构文档明确 v0.1 已允许真实播放最小闭环。
- 文档列出前端可调用的 command 契约和错误码。
- 文档列出 Rust/Tauri Agent 可实现的最小模块边界。
- 文档明确 v0.1 不实现媒体库、数据库、真实播放列表、网络存储和插件系统。
- 文档能作为 SP-016 和 SP-017 的直接输入。

## 备注

这是后端开工前的阻塞任务。

## 验收记录

- 验收日期：2026-07-24
- 验收结论：通过
- 验收依据：`docs/architecture/real-audio-playback.md` 已定义 v0.1 最小真实播放 command、DTO、错误码、状态同步方式和模块边界；旧 UI-only 架构文档已标记为 `superseded`。
