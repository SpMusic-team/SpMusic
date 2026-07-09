---
doc_id: "TASK-SP-004"
title: "总体架构蓝图与播放器状态结构"
doc_type: "task"
status: "ready"
owner_agent: "Architecture Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-09"
source_documents:
  - "docs/requirements/v0-1-foundation.md"
  - "docs/sprint-plan.md"
---
# 任务：总体架构蓝图与播放器状态结构

## 背景

v0.1 只做播放界面，但项目已经有长期总需求。为了避免后续实现各自为政，也避免把播放列表、真实音频播放、媒体库、网络存储或插件系统提前塞进 v0.1，需要 Architecture Agent 先建立一份轻量的总体架构蓝图，并同时定义 v0.1 所需的最小播放器状态结构和假歌曲结构。

## 目标

- 建立 SpMusic 总体架构蓝图，明确核心模块、未来模块和模块边界。
- 明确 v0.1 只实现播放界面前端状态，不实现真实音频、媒体库、播放列表、网络存储和插件系统。
- 定义 v0.1 所需的最小前端播放器状态和演示歌曲结构。
- 为 Frontend Agent 提供可实现的状态契约和边界说明。

## 非目标

- 不实现任何业务代码。
- 不设计真实音频引擎。
- 不设计 Tauri command。
- 不设计虚构播放列表管理 UI 或演示播放列表结构。
- 不设计持久化、媒体扫描、真实播放列表或网络存储。
- 不设计完整插件系统、插件 API 或插件安全模型。

## 负责 Agent

Architecture Agent

## 涉及文件 / 模块

- `docs/architecture/overall-architecture.md`
- `docs/architecture/player-state-and-fake-track.md`
- `src/App.tsx`

## 验收标准

- `docs/architecture/overall-architecture.md` 存在。
- 总体架构文档至少说明前端 UI、前端状态、Tauri 边界、未来音频引擎、未来媒体库、未来播放列表、未来网络存储和未来插件增强之间的职责边界。
- 总体架构文档明确 v0.1 不实现真实音频、Tauri command、媒体库、真实播放列表、网络存储和插件系统。
- 总体架构文档说明 v0.1 前端实现应避免哪些会污染后续架构的过早抽象。
- `docs/architecture/player-state-and-fake-track.md` 存在。
- 契约定义假歌曲渲染所需字段。
- 契约定义播放器状态字段，例如当前歌曲 ID、播放状态和当前歌曲列表。
- 契约定义空歌曲列表的状态表达。
- 契约明确不包含真实播放、音量、进度、媒体库、Tauri command 和持久化字段。

## 备注

该任务阻塞前端 UI 原型实现。它是总体架构边界任务，不是复杂架构实现任务。
