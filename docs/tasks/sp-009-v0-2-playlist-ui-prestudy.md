---
doc_id: "TASK-SP-009"
title: "v0.2 播放列表 UI 预研边界"
doc_type: "task"
status: "deferred"
owner_agent: "PM Agent"
version_scope: "v0.2"
created: "2026-07-09"
updated: "2026-07-27"
source_documents:
  - "docs/requirements/v0-2-playlist-ui-prototype.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/roadmap.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
---
# 任务：v0.2 播放列表 UI 预研边界

## 背景

v0.1 已存在只读、非递归、会话内的同目录临时队列，但它不是产品级播放列表。播放列表 UI 预研仍不进入 v0.1，应在真实播放发布闸门关闭后作为 v0.2 候选范围继续分析。

## 目标

- 明确 v0.2 播放列表 UI 候选范围。
- 说明产品级队列 / 播放列表 UI 如何消费 v0.1 真实播放状态，以及如何与 v0.1 临时文件夹队列区分。
- 保持媒体库、数据库、真实播放列表持久化和 `m3u8` 在更后续版本。

## 非目标

- 不进入 v0.1 活跃 Sprint 或完成定义。
- 不实现真实播放列表持久化。
- 不实现媒体库、数据库、文件夹扫描或 `m3u8`。

## 负责 Agent

PM Agent

## 后续路由建议

- Requirements Agent：确认 v0.2 播放列表 UI 的最小价值和非目标。
- Architecture Agent：定义播放列表 UI 与 v0.1 真实播放状态的边界。
- Frontend Agent：实现候选 UI。
- Test Agent：验证播放列表 UI 和真实播放状态联动。

## 验收标准

- 文档明确播放列表 UI 不进入 v0.1。
- 文档明确 v0.1 同目录临时队列不是可管理、可持久化的播放列表。
- 文档不再把真实播放描述为 v0.3 前置目标。
- 文档列出 v0.2 需要 Requirements、Architecture、Frontend 和 Test Agent 继续拆分的点。

## 当前状态

`Deferred`。从 v0.1 活跃 Sprint 移出；只有 SP-013 关闭 v0.1 范围闸门并由 PM 重新排期后才能转为 `ready`。
