---
doc_id: "TASK-SP-010"
title: "README 当前能力与限制更新"
doc_type: "task"
status: "blocked"
owner_agent: "Documentation Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-24"
source_documents:
  - "docs/sprint-plan.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
---
# 任务：README 当前能力与限制更新

## 背景

v0.1 目标已调整为真实本地播放最小闭环。README 需要在后端和前端接入完成后，准确描述真实能力和仍未实现的能力。

## 目标

更新 README，使其反映 v0.1 当前真实状态。

## 非目标

- 不提前声明未完成的真实播放能力。
- 不把媒体库、数据库、播放列表、网络存储或插件系统写成已实现。

## 负责 Agent

Documentation Agent

## 涉及文件 / 模块

- `README.md`
- `docs/release-plan.md`
- `docs/test/v0-1-real-audio-verification.md`

## 验收标准

- README 描述 v0.1 是否已经支持真实本地音频播放。
- README 明确仍不支持媒体库、文件夹扫描、数据库、真实播放列表、网络存储和插件系统。
- README 说明运行、构建和验证命令。
- README 不保留“v0.1 只使用假数据、不播放真实音频”的旧发布描述，除非真实播放任务失败并由 PM 重新调整范围。

## 备注

本任务依赖 SP-016 和 SP-017。
