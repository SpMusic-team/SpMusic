---
doc_id: "TASK-SP-012"
title: "README 与开发文档（已被替代）"
doc_type: "task"
status: "superseded"
owner_agent: "Documentation Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-27"
source_documents:
  - "docs/sprint-plan.md"
  - "docs/release-plan.md"
  - "docs/tasks/sp-010-readme-current-capabilities-and-limits.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
---
# 任务：README 与开发文档（已被替代）

## 背景

本任务与 SP-010 都要求 Documentation Agent 更新 README。本文还包含“不得声称真实音频播放”的旧验收标准，已经被后续 v0.1 范围决策覆盖。

## 目标

保留任务 ID 和历史来源；README、当前能力、限制、开发 / 构建 / 验证命令统一由 SP-010 收口。

## 替代关系

- 替代任务：SP-010。
- 原负责 Agent：Documentation Agent；不变。
- 本任务不得再单独进入 Sprint 或被标为 Done。
- SP-010 必须保留本任务中项目身份、开发命令和文档入口的有效要求，同时删除过时的 UI-only 限制。

## 追溯验收

- SP-010 的 `source_documents` 引用本任务。
- Sprint 和发布计划只保留 SP-010 作为 README 收口任务。
