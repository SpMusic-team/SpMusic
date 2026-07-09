# 决策：产品范围边界

## 状态

已接受

## 背景

`docs/requirements/总需求分析.md` 将 SpMusic 定义为长期本地优先桌面音乐播放器，最终包含真实播放、音乐库管理、播放列表、网络存储播放、高级 UI 和插件增强能力。

该文档故意覆盖完整产品愿景，范围大于单个开发周期。它应指导路线图，但不能被视为一次性实现范围。

## 决策

SpMusic 必须区分最终产品方向和版本执行范围。

- 最终产品方向记录在 `docs/requirements/总需求分析.md`。
- 版本范围和需求索引记录在 `docs/requirements.md`。
- 路线图顺序记录在 `docs/roadmap.md`。
- Sprint 执行范围记录在 `docs/sprint-plan.md` 和 `docs/tasks/*.md`。

v0.1 仅限项目地基工作。真实播放、媒体库、播放列表、网络存储、插件系统、云同步、高级 UI 模块和高级音频能力，必须等后续计划明确批准后才能进入执行。

## 影响

- PM Agent 必须拒绝或延期从最终愿景直接跳到大范围实现的工作。
- Architecture Agent 应在高风险能力实现前先评估架构边界。
- Frontend Agent 和 Rust/Tauri Agent 只能实现具备明确验收标准的任务。
- Documentation Agent 必须清晰区分计划中、已延期和已实现的能力。
