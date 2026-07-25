---
doc_id: "TASK-SP-009"
title: "v0.2 播放列表 UI 预研边界"
doc_type: "task"
status: "ready"
owner_agent: "PM Agent"
version_scope: "v0.2"
created: "2026-07-09"
updated: "2026-07-24"
source_documents:
  - "docs/requirements/v0-2-playlist-ui-prototype.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/roadmap.md"
---
# 任务：v0.2 播放列表 UI 预研边界

## 背景

v0.1 已调整为真实本地播放最小闭环。播放列表 UI 仍不进入 v0.1，应在真实播放稳定后作为 v0.2 候选范围继续预研。

## 目标

- 明确 v0.2 播放列表 UI 候选范围。
- 说明播放列表 UI 如何消费 v0.1 真实播放状态。
- 保持媒体库、数据库、真实播放列表持久化和 `m3u8` 在更后续版本。

## 非目标

- 不进入 v0.1。
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
- 文档不再把真实播放描述为 v0.3 前置目标。
- 文档列出 v0.2 需要 Requirements、Architecture、Frontend 和 Test Agent 继续拆分的点。
