---
doc_id: "TASK-SP-005"
title: "播放界面原型实现"
doc_type: "task"
status: "ready"
owner_agent: "Frontend Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-09"
source_documents:
  - "docs/tasks/sp-003-player-shell-ui-spec.md"
  - "docs/tasks/sp-004-overall-architecture-and-player-state.md"
---
# 任务：播放界面原型实现

## 背景

前端当前仍是模板 starter 页面。

## 目标

用假歌曲数据和 UI-only 播放状态，将模板页面替换为 SpMusic 播放界面原型。

## 非目标

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
- `npm run lint` 通过。
- `npm run build` 通过。

## 备注

实现应遵循 UI 规格和架构契约。
