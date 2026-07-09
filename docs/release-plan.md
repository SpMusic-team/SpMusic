---
doc_id: "RELEASE-V0-1"
title: "v0.1 发布计划"
doc_type: "release-plan"
status: "draft"
owner_agent: "PM Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-09"
source_documents:
  - "docs/sprint-plan.md"
---
# 发布计划

## 发布版本

v0.1 播放界面

## 目标

发布一个可运行、可验证、范围受控的 SpMusic 播放界面版本，用于后续虚构播放列表管理 UI、真实播放、音乐库和真实播放列表能力的迭代起点。

## 发布内容

- SpMusic 项目身份和基础文档。
- 播放界面。
- 假歌曲数据。
- UI-only 播放状态切换。
- 最小播放器状态结构。
- Empty State 分支。
- 基础工程检查清单。

## 不包含内容

- 真实音频播放。
- 本地文件读取。
- 媒体库和文件夹扫描。
- 数据库或持久化索引。
- 网络存储播放。
- 虚构播放列表管理 UI。
- 播放列表真实创建、编辑、删除、导入导出。
- 最小 Tauri command 通信验证。
- 插件系统。
- 在线服务或账号系统。

## 发布前检查清单

- `npm run lint` 通过。
- `npm run build` 通过。
- `npm run tauri dev` 能启动桌面应用。
- 主界面显示 SpMusic，而不是模板 starter 内容。
- 播放界面展示当前假歌曲。
- 系统存在至少 5 条假歌曲数据用于状态验证。
- 播放 / 暂停能切换 UI 状态。
- 上一首 / 下一首能切换当前假歌曲。
- 空歌曲列表分支已实现且可检查。
- README 描述当前能力和限制。

## 发布决策

只有当所有检查项通过，并且 PM Agent 完成 Sprint 复盘后，v0.1 才可视为可发布。
