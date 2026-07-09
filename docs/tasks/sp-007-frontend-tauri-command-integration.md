---
doc_id: "TASK-SP-007"
title: "前端 Tauri command 集成"
doc_type: "task"
status: "deferred"
owner_agent: "Frontend Agent"
version_scope: "deferred"
created: "2026-07-09"
updated: "2026-07-09"
source_documents:
  - "docs/sprint-plan.md"
---
# 任务：README 当前能力与限制更新

## 背景

v0.1 范围调整为播放界面后，README 需要准确说明当前能力和限制，避免用户误解为已经支持虚构播放列表管理、真实播放或本地文件读取。

## 目标

更新 README 中的当前能力、运行方式和 v0.1 限制说明。

## 非目标

- 不编写前端业务实现。
- 不引入真实播放。
- 不访问用户文件。

## 负责 Agent

Documentation Agent

## 涉及文件 / 模块

- `README.md`

## 验收标准

- README 描述 v0.1 当前只包含播放界面。
- README 明确 v0.1 使用假数据，不读取本地文件，不播放真实音频。
- README 说明 v0.2 计划进入虚构播放列表管理 UI，v0.3 计划进入本地播放技术验证。

## 备注

该任务替代原前端 Tauri command 集成任务。
