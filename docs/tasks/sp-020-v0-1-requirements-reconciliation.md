---
doc_id: "TASK-SP-020"
title: "v0.1 需求基线重整"
doc_type: "task"
status: "ready"
owner_agent: "Requirements Agent"
version_scope: "v0.1"
created: "2026-07-27"
updated: "2026-07-27"
source_documents:
  - "docs/requirements/v0-1-foundation.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
  - "docs/requirements.md"
  - "user request: 不擅改 Requirements owner 已批准正文并标明后续 owner"
---
# 任务：v0.1 需求基线重整

## 背景

`docs/requirements/v0-1-foundation.md` 仍批准 UI-only、无真实音频、无本地文件读取的旧边界，与两项已接受的 PM 范围决策及当前实现事实冲突。PM Agent 可以维护状态索引和执行边界，但不应替 Requirements Agent 改写已批准需求正文。

## 目标

- 由 Requirements Agent 建立与当前 v0.1 范围决策一致的需求基线。
- 明确真实播放、同目录临时队列、基础标签、嵌入式歌词 / 封面和兼容性声明的用户问题、范围、非目标、边界和客观验收标准。
- 保留旧 UI-only 需求的历史追溯，避免直接抹除来源。

## 非目标

- 不创建 Sprint、任务卡或发布计划。
- 不实现代码或修改架构契约。
- 不批准递归扫描、媒体库、持久播放列表、网络歌词、标签编辑、FFmpeg runtime 或跨平台认证。

## 负责 Agent

Requirements Agent

## 涉及文件 / 模块

- `docs/requirements/v0-1-foundation.md`，可选择转为 historical / superseded 状态。
- 新的或重整后的 `docs/requirements/*.md`。
- `docs/requirements.md` 的状态建议交 PM Agent 最终同步。
- `docs/requirements/open-questions.md`（如存在未决需求问题）。

## 输入

- 两项 v0.1 PM 范围决策。
- 当前实现能力清单和 SP-018 验证矩阵。
- 旧 v0.1 requirements 与长期总需求。

## 输出

- 一个由 Requirements Agent 拥有、状态明确的当前 v0.1 需求正文。
- 旧 UI-only 需求的 superseded / historical 追溯关系。
- 功能 / 非功能需求、输入 / 输出、异常、风险和验收标准。
- 仍需 Architecture / PM 决策的开放问题清单。

## 验收标准

- 当前需求正文不再同时要求“真实播放”与“不得引入真实播放 / 本地文件读取”。
- 同目录临时队列被定义为用户选择文件后的非递归、只读、会话内能力，不等同于媒体库或产品级播放列表。
- 歌词 / 封面只批准嵌入式读取展示与缺失后备，不批准网络获取或编辑。
- 格式兼容性按容器、codec、验证维度和平台证据表述，不承诺“所有常见格式”。
- 验收标准可被 SP-018 的 Case ID 映射。
- 旧需求文档和稳定 `doc_id` 得到保留或明确 superseded 引用。
- front matter 的 `updated`、`status`、`source_documents` 与正文一致。

## 风险

- 直接覆盖旧需求会丢失 UI-only 阶段追溯。
- 按当前代码逐行反推需求可能把实现偶然细节升级为产品承诺。
- 若 SP-018 发现能力不稳定，需求正文应保留可回退边界，不强迫通过验收。

## 文档更新

Requirements Agent 完成正文后，PM Agent 同步 `docs/requirements.md`、Sprint 和 release plan 中的状态引用；Documentation Agent 在 SP-010 更新 README。

