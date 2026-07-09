---
doc_id: "TASK-SP-008"
title: "验证清单与测试报告"
doc_type: "task"
status: "ready"
owner_agent: "Test Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-09"
source_documents:
  - "docs/sprint-plan.md"
---
# 任务：验证清单与测试报告

## 背景

v0.1 必须能被客观验证，PM 才能关闭 Sprint。

## 目标

为 v0.1 播放界面范围创建并执行验证清单。

## 非目标

- 不在未批准的情况下引入大型测试框架。
- 不验证延期能力。

## 负责 Agent

Test Agent

## 涉及文件 / 模块

- `docs/test/v0-1-verification.md`
- `package.json`
- `src-tauri/Cargo.toml`

## 验收标准

- 测试报告记录 `npm run lint`、`npm run build` 和 `npm run tauri dev` 的结果。
- 人工检查覆盖播放界面、假歌曲列表、播放 / 暂停、上一首 / 下一首和空状态。
- 失败项包含命令、错误摘要和建议退回的负责 Agent。
- 报告说明 v0.1 是否可以进入 PM 评审。

## 备注

该任务应在 SP-005B 后执行。v0.1 不验证 SP-006 和 SP-007 中延期的 Tauri command 相关能力。
