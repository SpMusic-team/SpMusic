# 任务：需求索引、路线图与发布边界

## 背景

Requirements Agent 已从总需求中切出 v0.1 版本需求。PM Agent 需要基于该版本需求建立需求索引、路线图和发布边界。

## 目标

创建或更新需求索引、路线图、Sprint 计划和发布计划，使最终产品方向与 v0.1 执行范围清晰分离。

## 非目标

- 不实现业务代码。
- 不承诺具体发布日期。
- 不把后续能力提前纳入 v0.1。

## 负责 Agent

PM Agent

## 涉及文件 / 模块

- `docs/requirements.md`
- `docs/roadmap.md`
- `docs/sprint-plan.md`
- `docs/release-plan.md`
- `docs/decisions/*.md`

## 验收标准

- `docs/requirements.md` 引用总需求和 v0.1 版本需求。
- `docs/roadmap.md` 至少包含 v0.1、真实播放、音乐库、播放列表、网络存储和高级能力的阶段顺序。
- `docs/sprint-plan.md` 中 SP-001 由 Requirements Agent 负责。
- `docs/release-plan.md` 包含发布内容、不包含内容和发布前检查清单。
- v0.1 中明确延期真实播放、媒体库、播放列表、网络存储和插件系统。

## 备注

该任务由 PM Agent 基于 Requirements Agent 的输出完成。
