---
doc_id: "TASK-SP-005B"
title: "播放界面视觉与交互修正"
doc_type: "task"
status: "blocked"
owner_agent: "Frontend Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-09"
source_documents:
  - "docs/tasks/sp-003-player-shell-ui-spec.md"
  - "docs/tasks/sp-005a-minimal-player-shell-implementation.md"
---
# 任务：播放界面视觉与交互修正

## 背景

SP-005A 负责先让项目脱离模板状态。UI/UX Agent 完成播放界面规格后，需要 Frontend Agent 根据规格对最小播放界面做视觉、布局、文案和交互状态修正。

## 目标

基于 UI/UX Agent 的播放界面规格，修正最小播放界面，使其在不扩大 v0.1 范围的前提下满足界面结构和交互状态要求。

## 非目标

- 不实现真实音频播放。
- 不实现播放列表管理 UI。
- 不添加媒体库、数据库、网络存储或插件系统。
- 不引入复杂设计系统、主题编辑器、可导入主题或完整国际化框架。

## 负责 Agent

Frontend Agent

## 涉及文件 / 模块

- `src/App.tsx`
- `src/App.css`
- `src/index.css`
- `docs/ui/player-shell.md`

## 验收标准

- 播放界面布局与 `docs/ui/player-shell.md` 的主要区域一致。
- 播放 / 暂停 / 上一首 / 下一首状态与 UI 规格一致。
- 当前歌曲、空歌曲列表、后备状态的文案与 UI 规格一致。
- 文本不溢出主要按钮、列表项或信息区。
- 修正后仍通过集中 CSS 变量或等价 token 管理主要颜色、间距、圆角和状态色。
- 修正后用户可见文案仍集中管理，不把展示文案作为业务状态值。
- 不引入超出 v0.1 范围的功能入口。
- `npm run lint` 通过。
- `npm run build` 通过。

## 备注

该任务依赖 SP-003 和 SP-005A。它是修正任务，不应重新设计状态结构或扩大功能范围。
