---
doc_id: "TASK-SP-005A"
title: "最小播放界面实现"
doc_type: "task"
status: "blocked"
owner_agent: "Frontend Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-09"
source_documents:
  - "docs/tasks/sp-004-overall-architecture-and-player-state.md"
  - "docs/requirements/v0-1-foundation.md"
---
# 任务：最小播放界面实现

## 背景

前端当前仍是模板 starter 页面。为了让项目尽快脱离模板状态，v0.1 允许 Frontend Agent 在完整 UI/UX 规格完成前，先基于架构契约实现一个简易播放界面，只满足核心验收。

## 目标

用假歌曲数据和 UI-only 播放状态，将模板页面替换为 SpMusic 最小播放界面。

## 非目标

- 不等待完整 UI/UX 视觉规格。
- 不实现真实音频播放。
- 不使用 `HTMLAudioElement` 播放文件。
- 不读取本地文件。
- 不实现虚构播放列表管理 UI。
- 不添加媒体库、数据库、真实播放列表管理、网络存储或插件系统。

## 负责 Agent

Frontend Agent

## 涉及文件 / 模块

- `src/App.tsx`
- `src/App.css`
- `src/index.css`

## 验收标准

- 页面不再显示 Vite / React starter 文案或链接。
- 页面清晰展示 SpMusic 应用身份。
- 系统存在至少 5 条假歌曲数据用于状态验证。
- 当前歌曲展示歌曲名、艺术家、专辑、时长中的至少 3 类信息。
- 播放 / 暂停能切换 UI 状态。
- 上一首 / 下一首能切换当前假歌曲。
- 当前歌曲在播放界面中可识别。
- 代码中存在可渲染的空歌曲列表分支。
- 不引入真实音频播放、本地文件读取、媒体库、Tauri command 或插件能力。
- `npm run lint` 通过。
- `npm run build` 通过。

## 备注

该任务只依赖 SP-004。UI/UX Agent 的完整视觉和交互规格由 SP-005B 后续修正吸收。
