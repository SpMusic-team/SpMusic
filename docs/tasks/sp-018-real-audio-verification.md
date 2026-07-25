---
doc_id: "TASK-SP-018"
title: "v0.1 真实播放验证报告"
doc_type: "task"
status: "blocked"
owner_agent: "Test Agent"
version_scope: "v0.1"
created: "2026-07-24"
updated: "2026-07-24"
source_documents:
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/tasks/sp-016-rust-tauri-real-audio-backend.md"
  - "docs/tasks/sp-017-frontend-real-audio-integration.md"
  - "docs/sprint-plan.md"
---
# 任务：v0.1 真实播放验证报告

## 背景

真实播放进入 v0.1 后，原 UI-only 验证不再足够。需要验证 Rust/Tauri 后端、前端 command 接入和人工播放闭环。

## 目标

- 建立并执行 v0.1 真实播放验证清单。
- 记录构建、后端检查、前端检查和人工播放操作结果。
- 标明失败项应退回的负责 Agent。

## 非目标

- 不实现功能修复。
- 不引入大型测试框架，除非后续任务明确批准。

## 负责 Agent

Test Agent

## 涉及文件 / 模块

- `docs/test/v0-1-real-audio-verification.md`
- `src-tauri/**/*`
- `src/**/*`

## 验收标准

- 报告记录 `cargo check`、`npm.cmd run lint`、`npm.cmd run build` 结果。
- 报告记录一个本地音频资源的播放、暂停、停止和进度观察结果。
- 报告覆盖无效路径、不可播放文件或后端失败的错误状态。
- 报告确认 v0.1 未实现媒体库、数据库、真实播放列表、网络存储或插件系统。
- 报告说明 v0.1 是否可以进入 PM 复盘。

## 备注

本任务依赖 SP-016 和 SP-017。
