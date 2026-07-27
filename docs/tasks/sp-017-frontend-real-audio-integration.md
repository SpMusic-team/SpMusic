---
doc_id: "TASK-SP-017"
title: "前端接入真实播放 command"
doc_type: "task"
status: "in-review"
owner_agent: "Frontend Agent"
version_scope: "v0.1"
created: "2026-07-24"
updated: "2026-07-27"
source_documents:
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/tasks/sp-015-real-audio-architecture-contract.md"
  - "docs/tasks/sp-016-rust-tauri-real-audio-backend.md"
  - "docs/sprint-plan.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
  - "src/features/player/services/audioCommands.ts"
  - "src/features/player/components/PlayerShell.tsx"
---
# 任务：前端接入真实播放 command

## 背景

仓库当前已经存在 command adapter、轮询 / event 同步、真实 seek、同目录临时队列、基础元数据、歌词和封面接入。任务已不是 `ready`，而是实现候选等待综合验证。

## 目标

- 接入播放、暂停、停止、seek、状态查询和错误返回。
- UI 展示后端真实播放状态和进度。
- 展示同目录临时队列并支持直接选择、上一首 / 下一首和自然结束切换。
- 展示基础标签、嵌入式歌词 / 封面及缺失后备。
- 后端不可用或播放失败时，界面不崩溃并显示可理解状态。

## 非目标

- 不修改 Rust 后端实现。
- 不实现递归扫描、媒体库、数据库、持久化 / 可编辑播放列表或网络存储。
- 不把 demo 歌曲数据描述为真实媒体库。
- 不实现网络歌词、逐字歌词、封面 / 标签编辑或 FFmpeg fallback。

## 负责 Agent

Frontend Agent

## 涉及文件 / 模块

- `src/features/player/**/*`
- `src/features/player/services/*`
- `docs/implementation/frontend-architecture.md`

## 输入

- SP-015 command、DTO 和错误码契约。
- SP-016 当前实现候选。
- 两项 v0.1 范围决策。
- UI 规格、当前 player copy 和 Empty / error 状态。

## 输出

- Tauri audio command adapter 和错误类型收窄。
- 使用后端状态的播放控制、进度与 seek。
- 同目录临时队列 UI 与切换行为。
- 基础标签、嵌入式歌词 / 封面展示与后备状态。
- 前端实现说明和交给 SP-018 的人工验证路径。

## 验收标准

- 播放 / 暂停 / 停止按钮调用真实 command。
- 播放状态和进度来自后端返回或事件，而不是纯 UI-only 计时。
- 用户选择真实音频后，队列明确显示为同目录临时队列；直接选择、上一首 / 下一首和自然结束切换使用后端加载 / 播放链路。
- 嵌入式歌词 / 封面存在时显示真实元数据；缺失时不残留上一首内容并显示后备状态。
- 后端不可用、文件不可播放和播放失败状态可见且不崩溃。
- 快速重复播放 / 暂停、seek 和切歌不会让较旧异步响应覆盖最新意图；失败不得通过吞错、无界重试或任意延时掩盖。
- `npm run lint` 和 `npm run build` 在同一 commit 上退出码为 0。
- SP-018 记录开发运行人工验证；通过后本任务才可 Done。SP-019 的实际制品 smoke 继续作为版本发布 Gate。

## 可复现验证与证据格式

1. 记录 commit SHA、工作区状态、Node / npm / Tauri CLI 版本和 OS / 架构。
2. 执行 `npm run lint`、`npm run build`，记录命令、退出码、关键输出和日志位置。
3. 在 `npm run tauri dev` 中按 SP-018 的 fixture 顺序验证打开、播放、暂停、继续、seek、停止、切歌、自然结束和错误输入。
4. 对歌词 / 封面各使用“存在”和“缺失”样本，记录切歌前后可见内容。
5. 对快速操作记录操作顺序、时间点、预期最终状态、实际状态和相关前后端日志。

## 风险

- 前端轮询、事件和 command response 可能发生乱序，必须证明最新用户意图不会被旧响应覆盖。
- demo track 与真实 track 共存容易让 UI-only 状态冒充真实状态。
- 目录候选加载失败时不能把损坏项无限自动跳转或静默吞掉。
- base64 封面和歌词详情不得被带入 500ms 高频轮询。

## 文档更新

- Frontend Agent 更新 `docs/implementation/frontend-architecture.md`。
- Test Agent 在 SP-018 记录验证结果；Documentation Agent 在 SP-010 更新 README。

## 当前状态

实现候选已存在，状态为 `in-review`；不得因代码存在或前端构建通过提前标记 Done。
