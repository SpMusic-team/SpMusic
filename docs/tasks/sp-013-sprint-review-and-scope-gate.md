---
doc_id: "TASK-SP-013"
title: "Sprint 复盘与范围闸门"
doc_type: "task"
status: "blocked"
owner_agent: "PM Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-27"
source_documents:
  - "docs/sprint-plan.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
  - "docs/tasks/sp-019-v0-1-artifact-and-version-gate.md"
  - "docs/tasks/sp-020-v0-1-requirements-reconciliation.md"
---
# 任务：Sprint 复盘与范围闸门

## 背景

v0.1 已从 UI-only 播放界面调整为真实本地播放，并收口了临时队列、歌词 / 封面和兼容性能力。PM 必须在综合验证、需求重整、README、版本、Tauri build 和实际制品 smoke 全部完成后再判断 v0.1 是否可关闭。

## 目标

创建 Sprint 复盘，记录完成项、失败检查、范围偏差、风险，以及是否允许进入下一组已批准工作。

## 非目标

- 不在复盘中实现缺失功能。
- 不在复盘中直接批准媒体库、数据库、真实播放列表、网络存储或插件系统。
- 不以“基本通过”覆盖单项 release Gate 失败。

## 负责 Agent

PM Agent

## 涉及文件 / 模块

- `docs/retrospectives/sprint-001.md`
- `docs/sprint-plan.md`
- `docs/release-plan.md`
- `docs/test/v0-1-real-audio-verification.md`

## 输入

- Sprint 中所有任务卡的最终状态与证据。
- SP-018 综合验证报告。
- SP-019 版本、bundle 和制品 smoke 证据。
- SP-010 更新后的 README。
- SP-020 重整后的需求基线。
- `git diff --check`、文档元数据和链接一致性检查结果。

## 输出

- `docs/retrospectives/sprint-001.md`。
- v0.1 `release / hold / rollback scope` 的单一结论。
- 未完成项、Owner、优先级、重测 / 撤除条件和下一 Sprint 是否可启动的决定。

## 验收标准

- 复盘记录每个 Sprint 任务为已完成、未完成或阻塞，并引用证据。
- 复盘包含 SP-018 的自动、开发运行、真实声卡和错误路径结果。
- 复盘包含 SP-019 的版本一致性、`npm run tauri build`、制品 SHA-256 和制品 smoke。
- 复盘列出范围偏差并确认 SP-009 / SP-014 未计入 v0.1，SP-011 / SP-012 仅保留追溯。
- 复盘逐项核对 release plan 四个 Gate。
- 复盘说明 v0.1 是否可以发布、继续 Hold 或需要回退范围。
- 若 Hold，记录阻塞任务、Owner、最小修复范围、禁止的症状掩盖方式和重测条件。
- 只有 `release` 结论才能把 Sprint / release plan 状态转为完成类状态。

## 风险

- 只看自动测试会遗漏声卡和制品问题。
- 只看已实现能力会忽略需求、README 和版本号不一致。
- 为赶版本把临时队列包装成媒体库 / 播放列表会制造错误承诺。

## 备注

本任务依赖 SP-010、SP-018、SP-019、SP-020。任一未完成时保持 `blocked`。
