---
doc_id: "TASK-SP-006"
title: "最小 Tauri 健康检查命令"
doc_type: "task"
status: "deferred"
owner_agent: "Rust/Tauri Agent"
version_scope: "deferred"
created: "2026-07-09"
updated: "2026-07-09"
source_documents:
  - "docs/sprint-plan.md"
---
# 任务：v0.2 虚构播放列表管理 UI 预研边界

## 背景

v0.1 已收敛为播放界面。虚构播放列表管理 UI 延后到 v0.2，真实音频播放、本地文件读取和音频方案选择顺延到 v0.3，需要提前记录边界，避免 v0.1 实现时误引入播放列表管理或真实播放能力。

## 目标

明确 v0.2 虚构播放列表管理 UI 的候选范围、非目标和需要后续评估的问题。

## 非目标

- 不在 v0.1 实现虚构播放列表管理 UI。
- 不在 v0.1 实现真实音频播放。
- 不在 v0.1 读取本地音乐文件。
- 不在 v0.1 修改依赖或实现后端业务逻辑。

## 负责 Agent

PM Agent

## 涉及文件 / 模块

- `docs/roadmap.md`
- `docs/requirements.md`
- `docs/decisions/`

## 验收标准

- 文档明确 v0.2 目标是虚构播放列表管理 UI。
- 文档明确 v0.2 候选范围包含展示所有虚构播放列表、展示选中播放列表内歌曲、新增、编辑、删除、排序、多选歌曲、加入到其他播放列表、移除歌单内歌曲和 Empty State。
- 文档明确 v0.2 不包含文件读取、真实播放、真实持久化、导入导出、`m3u8` 支持和删除真实歌曲文件。
- 文档明确原本的本地播放技术验证顺延到 v0.3。

## 备注

该任务只维护范围边界，不产出业务代码。
