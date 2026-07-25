---
doc_id: "TASK-SP-011"
title: "验证清单与测试报告"
doc_type: "task"
status: "blocked"
owner_agent: "Test Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-24"
source_documents:
  - "docs/sprint-plan.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
---
# 任务：验证清单与测试报告

## 背景

v0.1 已纳入真实本地播放，旧 UI-only 验证清单不再足够。最终验证应以 SP-018 的真实播放报告为准。

## 目标

维护 v0.1 总体验证入口，汇总前端、后端和人工真实播放结果。

## 非目标

- 不实现功能修复。
- 不验证媒体库、数据库、播放列表、网络存储或插件系统。

## 负责 Agent

Test Agent

## 涉及文件 / 模块

- `docs/test/v0-1-real-audio-verification.md`
- `package.json`
- `src-tauri/Cargo.toml`
- `src/**/*`
- `src-tauri/**/*`

## 验收标准

- 报告引用 SP-018 的真实播放验证结果。
- 报告记录 `cargo check`、`npm.cmd run lint`、`npm.cmd run build` 和桌面启动验证。
- 报告确认播放、暂停、停止和进度状态可验证。
- 报告确认 v0.1 未实现媒体库、数据库、真实播放列表、网络存储或插件系统。
- 失败项包含命令、错误摘要和建议退回的负责 Agent。

## 备注

本任务依赖 SP-018。
