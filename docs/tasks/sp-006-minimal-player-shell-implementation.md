---
doc_id: "TASK-SP-006"
title: "最小播放界面实现"
doc_type: "task"
status: "ready"
owner_agent: "Frontend Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-10"
source_documents:
  - "docs/tasks/sp-005-frontend-foundation-skeleton.md"
  - "docs/tasks/sp-004-overall-architecture-and-player-state.md"
  - "docs/requirements/v0-1-foundation.md"
  - "docs/architecture/overall-architecture.md"
  - "docs/architecture/player-state-and-fake-track.md"
---
# 任务：最小播放界面实现

## 背景

前端基础骨架已经由 SP-005 先行收敛类型、假歌曲数据、用户可见文案、CSS token、UI-only 播放进度、演示频谱和播放状态约束。为了让项目尽快脱离模板状态，v0.1 允许 Frontend Agent 在完整 UI/UX 规格完成前，基于该骨架实现一个简易播放界面，只满足核心验收。

## 目标

使用 SP-005 提供的假歌曲数据、文案、CSS token、UI-only 播放状态、UI-only 播放进度和演示频谱数据，将模板页面替换为 SpMusic 最小播放界面。

## 非目标

- 不等待完整 UI/UX 视觉规格。
- 不实现真实音频播放。
- 不实现真实音频进度同步或真实频谱分析。
- 不使用 `HTMLAudioElement` 播放文件。
- 不读取本地文件。
- 不实现虚构播放列表管理 UI。
- 不添加媒体库、数据库、真实播放列表管理、网络存储或插件系统。
- 不实现可导入主题、主题编辑器、完整国际化框架或语言切换。

## 负责 Agent

Frontend Agent

## 涉及文件 / 模块

- `src/App.tsx`
- `src/App.css`
- `src/index.css`
- SP-005 已建立的前端类型、fixture 或文案模块

## 验收标准

- 页面不再显示 Vite / React starter 文案或链接。
- 页面清晰展示 SpMusic 应用身份。
- 界面使用 SP-005 已建立的至少 5 条假歌曲数据。
- 当前歌曲展示歌曲名、艺术家、专辑、时长中的至少 3 类信息。
- 播放 / 暂停能切换 UI 状态。
- 上一首 / 下一首能切换当前假歌曲。
- 当前歌曲在播放界面中可识别。
- 播放界面存在播放进度条，并展示 UI-only 播放进度状态。
- 播放界面存在频谱或等价音频视觉化区域，且不依赖真实音频分析。
- 代码中存在可渲染的空歌曲列表分支。
- 播放界面的主要颜色、间距、圆角和状态色使用 SP-005 已建立的 CSS token 或等价集中定义。
- 播放界面的用户可见文案使用 SP-005 已建立的 `copy`、`texts`、`messages` 等对象或简单模块。
- 播放状态继续使用 `paused`、`playing` 等稳定枚举，不使用中文展示文案作为业务状态。
- 不引入真实音频播放、真实音频进度同步、真实频谱分析、本地文件读取、媒体库、Tauri command 或插件能力。
- 不引入主题导入、主题持久化、语言包加载或语言切换能力。
- `npm run lint` 通过。
- `npm run build` 通过。

## 备注

该任务依赖 SP-005。UI/UX Agent 的完整视觉和交互规格由 SP-007 后续修正吸收。
