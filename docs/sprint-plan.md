---
doc_id: "SPRINT-V0-1"
title: "v0.1 Sprint 计划"
doc_type: "sprint-plan"
status: "active"
owner_agent: "PM Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-10"
source_documents:
  - "docs/requirements/v0-1-foundation.md"
  - "docs/requirements.md"
---
# Sprint 计划

## Sprint 目标

完成 SpMusic v0.1「播放界面」：把当前 Tauri + React + TypeScript 模板项目收敛为有项目身份、有播放界面、有基础验收流程的 SpMusic 播放界面原型。

## 范围

- 由 Requirements Agent 从总需求中切出 v0.1 版本需求和验收边界。
- 由 PM Agent 基于版本需求建立需求索引、路线图、发布计划和首批任务卡。
- 设计播放界面说明。
- 建立总体架构蓝图，定义模块边界、v0.1 架构限制、最小播放器状态与假歌曲结构。
- 在最小播放界面实现前建立前端基础骨架，集中类型、假数据、文案、CSS token 和播放状态约束。
- 将模板页面替换为 SpMusic 最小播放界面。
- 在 UI/UX 规格完成后，对播放界面做视觉与交互修正。
- 实现播放 / 暂停 / 上一首 / 下一首的 UI 状态切换。
- 前端实现保留轻量护栏：集中 CSS token、集中用户可见文案、稳定状态枚举。
- 建立验证清单：`npm run lint`、`npm run build`、`npm run tauri dev`。
- 更新 README。

## 不在范围内

- 真实音频播放、音量、进度拖动、音频解码。
- 本地文件读取、文件夹扫描、媒体库、数据库、元数据、封面、歌词。
- 最小 Tauri command 或 React 到 Rust 通信验证。
- 可导入主题、主题编辑器、主题持久化、完整国际化框架和语言切换。
- 虚构播放列表管理 UI。
- 播放列表真实创建、编辑、删除、导入导出与 `m3u8` 实现。
- FTP、SMB、WebDAV 网络存储播放。
- 插件系统、插件市场、扩展运行时。
- Last.fm、Pano Scrobbler、云同步、自定义功能区。

## 任务

| 任务 ID | 标题 | 优先级 | 负责 Agent | 状态 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| SP-001 | v0.1 版本需求分析与验收边界 | P0 | Requirements Agent | Done | `docs/requirements/总需求分析.md` |
| SP-002 | 需求索引、路线图与发布边界 | P0 | PM Agent | Done | SP-001 |
| SP-003 | 播放界面 UI 规格 | P1 | UI/UX Agent | Ready | SP-001 |
| SP-004 | 总体架构蓝图与播放器状态结构 | P1 | Architecture Agent | Done | SP-001 |
| SP-005 | 前端基础骨架与实现约束 | P1 | Frontend Agent | Ready | SP-004 |
| SP-006 | 最小播放界面实现 | P1 | Frontend Agent | Blocked | SP-005 |
| SP-007 | 播放界面视觉与交互修正 | P1 | Frontend Agent | Blocked | SP-003, SP-006 |
| SP-008 | v0.2 虚构播放列表管理 UI 预研边界 | P2 | PM Agent | Ready | SP-001 |
| SP-009 | README 当前能力与限制更新 | P1 | Documentation Agent | Blocked | SP-001, SP-002, SP-007 |
| SP-010 | 验证清单与测试报告 | P1 | Test Agent | Blocked | SP-007 |
| SP-011 | README 与开发文档 | P1 | Documentation Agent | Ready | SP-001, SP-002 |
| SP-012 | Sprint 复盘与范围闸门 | P0 | PM Agent | Blocked | SP-001 至 SP-011 |

## 风险

- 总需求覆盖面很大，若不先做版本需求切分，容易把最终愿景误当作当前开发范围。
- 当前项目仍有模板页面和模板 README，项目身份尚未落地。
- 虚构播放列表管理 UI 已移出 v0.1，v0.2 需要单独定义列表、详情、新增、编辑、删除、排序、多选歌曲、跨列表加入歌曲和 Empty State。
- 前后端通信验证已移出 v0.1，v0.3 做真实播放技术验证时需要重新纳入。
- 真实播放、媒体库、网络存储和插件系统都很有吸引力，但进入 v0.1 会显著扩大风险。

## 完成定义

- `docs/requirements/v0-1-foundation.md` 存在，并由 Requirements Agent 明确 v0.1 需求、非目标和验收标准。
- `docs/requirements.md`、`docs/roadmap.md`、`docs/sprint-plan.md`、`docs/release-plan.md` 存在并相互一致。
- `docs/tasks/` 中存在首批任务卡，且每张卡包含负责 Agent、目标、非目标和验收标准。
- `docs/architecture/overall-architecture.md` 存在，并明确总体模块边界与 v0.1 不实现的架构能力。
- 前端存在最小 `Track` / `PlayerState` 类型、假歌曲 fixture、集中用户可见文案和基础 CSS token。
- 应用首屏不再是 Vite / React 模板页面。
- 应用展示 SpMusic 播放界面。
- 系统存在至少 5 条假歌曲数据用于状态验证。
- 播放 / 暂停 / 上一首 / 下一首能改变 UI 状态。
- 空歌曲列表存在可渲染 Empty State 分支。
- 主要视觉值使用集中 CSS token 或等价方式管理。
- 用户可见文案集中管理，业务状态不依赖中文展示文案。
- `npm run lint` 通过。
- `npm run build` 通过。
- `npm run tauri dev` 能启动应用。
- v0.1 没有实现虚构播放列表管理 UI、真实音频播放、本地文件读取、媒体库、数据库、真实播放列表、网络存储或插件系统。
