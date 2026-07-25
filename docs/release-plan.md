---
doc_id: "RELEASE-V0-1"
title: "v0.1 发布计划"
doc_type: "release-plan"
status: "draft"
owner_agent: "PM Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-24"
source_documents:
  - "docs/sprint-plan.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
---
# 发布计划

## 发布版本

v0.1 真实本地播放最小闭环

## 目标

发布一个可运行、可验证的 SpMusic 桌面版本：保留已完成播放器界面，并提供最小真实本地音频播放能力，作为后续播放列表、媒体库和网络存储能力的技术起点。

## 发布内容

- SpMusic 项目身份和基础文档。
- shadcn/ui 前端基底和内部样式基线。
- 播放器界面、当前歌曲展示和基础播放控制。
- 最小 Tauri command 契约。
- Rust/Tauri 真实音频播放后端。
- 单个本地音频资源播放、暂停、停止和进度状态。
- 前端接入真实播放 command。
- Empty State 与最小错误状态。
- 真实播放验证报告。

## 不包含内容

- 媒体库和文件夹扫描。
- 数据库或持久化索引。
- 网络存储播放。
- 真实播放列表创建、编辑、删除、导入导出。
- 真实频谱分析、高级 DSP、独占输出。
- 插件系统。
- 在线服务或账号系统。

## 发布前检查清单

- `cargo check` 通过。
- `npm.cmd run lint` 通过。
- `npm.cmd run build` 通过。
- `npm.cmd run tauri dev` 能启动桌面应用。
- 架构文档已定义 v0.1 command 契约和错误码。
- 一个本地音频资源可以播放。
- 播放、暂停、停止和进度状态可人工验证。
- 后端不可用、无效路径或不可播放文件时界面不崩溃。
- README 描述真实能力和限制。
- 验证报告确认 v0.1 未实现媒体库、数据库、真实播放列表、网络存储或插件系统。

## 发布决策

只有当所有检查项通过，并且 PM Agent 完成 Sprint 复盘后，v0.1 才可视为可发布。
