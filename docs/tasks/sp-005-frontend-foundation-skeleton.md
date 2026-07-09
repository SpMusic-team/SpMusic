---
doc_id: "TASK-SP-005"
title: "前端基础骨架与实现约束"
doc_type: "task"
status: "blocked"
owner_agent: "Frontend Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-09"
source_documents:
  - "docs/tasks/sp-004-overall-architecture-and-player-state.md"
  - "docs/sprint-plan.md"
  - "docs/architecture/player-state-and-fake-track.md"
---
# 任务：前端基础骨架与实现约束

## 背景

SP-006 将把模板页面替换为 SpMusic 最小播放界面。为了避免界面实现过程中临时散落类型、假数据、文案、样式 token 和播放状态字符串，需要先建立一层很小的前端基础骨架，让后续界面实现只消费这些基础约束。

## 目标

- 清理模板入口实现前的最小准备结构。
- 建立 v0.1 前端所需的最小 `Track` / `PlayerState` 类型位置。
- 建立至少 5 条假歌曲数据 fixture。
- 建立前端用户可见文案对象或简单模块。
- 建立基础 CSS token，包括颜色、间距、圆角和状态色。
- 明确播放状态使用 `paused` / `playing`，不使用中文展示文案作为业务状态。

## 非目标

- 不实现最小播放界面布局。
- 不实现播放 / 暂停 / 上一首 / 下一首交互。
- 不引入路由。
- 不引入全局状态库。
- 不引入 i18n 框架、语言包加载或语言切换。
- 不引入主题系统、主题导入或主题持久化。
- 不实现 Tauri command。
- 不实现真实音频播放或 `HTMLAudioElement` 播放文件。
- 不新增依赖。

## 负责 Agent

Frontend Agent

## 涉及文件 / 模块

- `src/`
- `src/App.tsx`
- `src/App.css`
- `src/index.css`
- 可选前端类型、fixture 或文案模块

## 验收标准

- 模板入口中不再依赖 Vite / React starter 的示例状态、示例资源或示例链接。
- 代码中存在最小 `Track` 类型，字段覆盖假歌曲渲染所需信息。
- 代码中存在最小 `PlayerState` 类型，包含当前歌曲标识、播放状态和歌曲列表。
- 代码中存在至少 5 条假歌曲 fixture。
- 用户可见文案集中在前端 `copy`、`texts`、`messages` 等对象或简单模块中。
- 播放状态类型只允许 `paused` / `playing`，不使用中文展示文案作为业务状态。
- 基础颜色、间距、圆角和状态色存在集中 CSS token 或等价集中定义。
- 未引入路由、全局状态库、i18n 框架、主题系统、Tauri command、真实音频播放或新依赖。
- `npm run lint` 通过。
- `npm run build` 通过。

## 备注

该任务依赖 SP-004 的架构契约。它是半天量级的小地基，不是设计系统，也不是完整前端框架。
