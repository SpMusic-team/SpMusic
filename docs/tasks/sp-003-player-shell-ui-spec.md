---
doc_id: "TASK-SP-003"
title: "播放界面 UI 规格"
doc_type: "task"
status: "ready"
owner_agent: "UI/UX Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-09"
source_documents:
  - "docs/requirements/v0-1-foundation.md"
  - "docs/sprint-plan.md"
---
# 任务：播放界面 UI 规格

## 背景

当前应用仍显示模板 starter 页面。v0.1 需要先定义清晰的 SpMusic 播放界面，供前端实现。

## 目标

定义 v0.1 播放界面、可见状态、控制区和空歌曲列表状态。

## 非目标

- 不设计真实音频播放交互。
- 不设计虚构播放列表管理 UI。
- 不设计媒体库、真实播放列表管理、歌词、封面获取或插件入口。
- 不设计可导入主题、主题编辑器或完整国际化方案。

## 负责 Agent

UI/UX Agent

## 涉及文件 / 模块

- `docs/ui/player-shell.md`
- `src/App.tsx`
- `src/App.css`

## 验收标准

- UI 规格定义应用身份、当前歌曲、播放控制区和状态展示区域等主要区域。
- UI 规格定义播放、暂停、上一首、下一首、当前歌曲和空歌曲列表状态。
- UI 规格至少包含一个桌面布局方向。
- UI 规格给出基础视觉 token 建议，例如颜色、间距、圆角和状态色的使用方式，但不定义主题导入格式。
- UI 规格明确用户可见文案、空状态文案和状态标签，方便前端集中管理文案。
- UI 规格明确排除虚构播放列表管理 UI、真实播放、媒体库、真实播放列表管理、歌词、封面和插件入口。

## 备注

该任务可与 SP-006 并行；SP-007 基于前端基底实现最小播放界面，SP-008 应吸收本任务产出的视觉、文案和交互修正。
