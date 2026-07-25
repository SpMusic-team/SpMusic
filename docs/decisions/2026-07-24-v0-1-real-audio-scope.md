---
doc_id: "DEC-2026-07-24-V0-1-REAL-AUDIO"
title: "v0.1 真实本地播放范围变更"
doc_type: "decision"
status: "accepted"
owner_agent: "PM Agent"
version_scope: "v0.1"
created: "2026-07-24"
updated: "2026-07-24"
source_documents:
  - "user request: ui设计太慢，我准备将真实的音乐播放放入0.1版本，让后端干起来"
  - "docs/decisions/2026-07-09-v0-1-ui-prototype-scope.md"
  - "docs/sprint-plan.md"
---
# 决策：v0.1 纳入真实本地播放最小闭环

## 状态

已接受。

## 背景

旧 v0.1 范围把真实音频播放、Tauri command 和本地文件读取移出当前版本，只交付 UI-only 播放界面。用户在 2026-07-24 明确要求：UI 设计推进太慢，真实音乐播放放入 0.1 版本，让后端开始。

## 决策

v0.1 从“播放界面原型”调整为“真实本地播放最小闭环”。

进入 v0.1 的能力：

- 最小 Tauri command 契约。
- Rust/Tauri 真实音频播放后端。
- 单个本地音频资源的播放、暂停、停止和进度状态。
- 前端接入真实播放状态，替换关键 UI-only 播放控制。
- 后端不可用、文件不可播放、播放失败等最小错误状态。

仍不进入 v0.1 的能力：

- 媒体库、文件夹扫描、数据库和持久化索引。
- 真实播放列表、播放历史、收藏、`m3u8` 导入导出。
- 网络存储播放、在线服务、账号系统、云同步。
- 真实频谱分析、高级 DSP、独占输出和插件系统。

## 影响

- 本决策覆盖 `docs/decisions/2026-07-09-v0-1-ui-prototype-scope.md` 中“v0.1 不做真实音频播放 / 不做 Tauri command”的旧限制。
- `docs/architecture/overall-architecture.md` 和 `docs/architecture/player-state-and-fake-track.md` 需要由 Architecture Agent 更新，避免旧 UI-only 约束继续阻塞后端。
- Rust/Tauri Agent 可以在 SP-015 架构契约完成后开始 SP-016。
- Frontend Agent 在 SP-016 后接入真实 command，不再把核心播放状态伪装为真实能力。

## 验收口径

- v0.1 至少能在当前桌面开发环境中播放一个本地音频资源。
- 播放、暂停、停止和进度状态能被前端观察并展示。
- `cargo check`、`npm.cmd run lint`、`npm.cmd run build` 通过。
- 验证报告明确列出测试音频来源、操作步骤、成功结果和失败场景。
