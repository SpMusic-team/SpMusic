---
doc_id: "SPRINT-V0-1"
title: "v0.1 Sprint 计划"
doc_type: "sprint-plan"
status: "active"
owner_agent: "PM Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-24"
source_documents:
  - "docs/requirements/v0-1-foundation.md"
  - "docs/requirements.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
---
# Sprint 计划

## Sprint 目标

完成 SpMusic v0.1“真实本地播放最小闭环”：在已完成播放器界面和主题基础上，把真实音乐播放提前纳入 v0.1，让桌面端具备可验证的本地音频播放、暂停、停止、进度同步和最小前后端通信能力。

## 范围

- 保留已完成的 SpMusic 播放器界面、主题基础和窗口壳层能力。
- 由 Architecture Agent 更新真实播放架构契约，明确 Tauri command、Rust 音频模块、前端播放状态和错误码边界。
- 由 Rust/Tauri Agent 实现最小真实本地音频播放后端。
- 由 Frontend Agent 接入已批准的 Tauri command，使播放 / 暂停 / 停止 / 进度展示来自真实后端状态。
- 由 Test Agent 建立真实播放验证清单，覆盖构建、后端检查和人工播放闭环。
- v0.1 只要求“选定或加载一个本地音频资源并播放”的最小闭环，不要求媒体库、扫描、数据库或真实播放列表。

## 不在范围内

- 本地音乐库、文件夹扫描、增量索引、数据库、元数据批量解析。
- 播放列表真实创建、编辑、删除、导入导出与 `m3u8` 支持。
- 网络存储播放、在线音乐服务、账号系统、云同步。
- 真实频谱分析、高级 DSP、独占输出、插件系统。
- 完整跨平台音频策略；v0.1 只验证当前桌面开发环境的最小播放链路。

## 任务

| 任务 ID | 标题 | 优先级 | 负责 Agent | 状态 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| SP-001 | v0.1 版本需求分析与验收边界 | P0 | Requirements Agent | Done | `docs/requirements/总需求分析.md` |
| SP-002 | 需求索引、路线图与发布边界 | P0 | PM Agent | Done | SP-001 |
| SP-003 | 播放界面 UI 规格 | P1 | UI/UX Agent | Done | SP-001 |
| SP-004 | 总体架构蓝图与播放器状态结构 | P1 | Architecture Agent | Done | SP-001 |
| SP-005 | 前端基础骨架与实现约束 | P1 | Frontend Agent | Done | SP-004 |
| SP-006 | shadcn/ui 基础接入与前端样式基线 | P1 | Frontend Agent | Done | SP-005 |
| SP-007 | 最小播放界面实现 | P1 | Frontend Agent | Done | SP-005, SP-006 |
| SP-008 | 播放界面视觉与交互修正 | P1 | Frontend Agent | Done | SP-003, SP-007 |
| SP-009 | v0.2 虚构播放列表管理 UI 预研边界 | P2 | PM Agent | Ready | SP-001 |
| SP-010 | README 当前能力与限制更新 | P1 | Documentation Agent | Blocked | SP-016, SP-017 |
| SP-011 | 验证清单与测试报告 | P1 | Test Agent | Blocked | SP-018 |
| SP-012 | README 与开发文档 | P1 | Documentation Agent | Ready | SP-001, SP-002 |
| SP-013 | Sprint 复盘与范围闸门 | P0 | PM Agent | Blocked | SP-018 |
| SP-014 | 视觉自定义与动效扩展预研边界 | P2 | PM Agent | Ready | SP-001 |
| SP-015 | v0.1 真实播放架构契约 | P0 | Architecture Agent | Done | `docs/decisions/2026-07-24-v0-1-real-audio-scope.md` |
| SP-016 | Rust/Tauri 最小真实音频播放后端 | P0 | Rust/Tauri Agent | Done | SP-015 |
| SP-017 | 前端接入真实播放 command | P0 | Frontend Agent | Ready | SP-015, SP-016 |
| SP-018 | v0.1 真实播放验证报告 | P0 | Test Agent | Blocked | SP-016, SP-017 |

## 风险

- 真实播放提前进入 v0.1 会增加依赖、权限、平台差异和错误状态处理风险。
- 如果架构契约不先完成，前端和后端容易在 command 命名、状态同步和错误码上反复返工。
- v0.1 只做最小播放闭环；媒体库和真实播放列表必须继续挡在范围外，否则版本会失控。
- 当前文档中仍存在旧 UI-only 架构说明；SP-015 必须先更新这些架构边界，再让后端实现。

## 完成定义

- 新的 v0.1 范围变更决策存在，并明确覆盖旧的 UI-only 范围决策。
- `docs/architecture/` 中存在真实播放 command 契约和模块边界说明。
- Rust/Tauri 后端提供已批准的最小播放 command，并通过 `cargo check`。
- 前端播放 / 暂停 / 停止 / 进度展示使用真实后端状态，并通过 `npm.cmd run lint`、`npm.cmd run build`。
- 手动验证能播放一个本地音频资源，且暂停、停止和错误状态可检查。
- v0.1 未实现媒体库、文件夹扫描、数据库、真实播放列表、网络存储或插件系统。
