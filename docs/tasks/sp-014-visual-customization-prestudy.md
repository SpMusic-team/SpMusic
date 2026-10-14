---
doc_id: "TASK-SP-014"
title: "视觉自定义与动效扩展预研边界"
doc_type: "task"
status: "deferred"
owner_agent: "PM Agent"
version_scope: "future"
created: "2026-07-10"
updated: "2026-07-27"
source_documents:
  - "docs/decisions/2026-07-10-visual-customization-boundary.md"
  - "docs/requirements/总需求分析.md"
  - "docs/roadmap.md"
  - "docs/sprint-plan.md"
---
# 任务：视觉自定义与动效扩展预研边界

## 背景

SpMusic 长期需要更完整的外观自定义和动效扩展能力。`shadcn/ui`、Tailwind class 和 CSS token 可以作为内部样式基线，但用户导入任意样式或动画配置会引入校验、运行时安全、持久化和性能风险。

## 目标

为未来版本建立视觉自定义与动效扩展的预研边界，明确哪些能力可以通过受控 CSS token 和预设实现，哪些能力需要延后或禁止。

## 非目标

- 不进入 v0.1 播放界面交付范围。
- 不实现主题编辑器、主题导入导出或主题持久化。
- 不允许运行时加载任意 Tailwind class、外部 CSS 或任意动画定义。
- 不修改前端业务代码。

## 负责 Agent

PM Agent

## 后续路由建议

- Requirements Agent：定义用户视觉自定义的最小价值、使用场景、非目标和验收标准。
- Architecture Agent：定义 token 白名单、校验、回退、持久化、安全边界和 reduced-motion 规则。
- Frontend Agent：评估基于 `shadcn/ui`、Tailwind 和 CSS token 的受控预览或预设切换方案。
- Test Agent：建立对比度、性能档位、非法 token 回退和动效降级测试口径。

## 涉及文件 / 模块

- `docs/requirements.md`
- `docs/roadmap.md`
- `docs/decisions/`
- `docs/tasks/`

## 验收标准

- 文档明确 v0.1 只使用内部 Tailwind class、CSS token 和动效 token。
- 文档明确用户导入 Tailwind class、外部 CSS token、主题文件和运行时样式加载不属于 v0.1。
- 文档明确未来视觉自定义应优先采用受控 token 白名单和预设，而不是任意 class 执行。
- 文档列出 Requirements、Architecture、Frontend 和 Test Agent 的后续分工。

## 备注

该任务是未来版本预研入口，已从 v0.1 活跃 Sprint 移出。只有 SP-013 关闭 v0.1 范围闸门并由 PM 重新排期后才能转为 `ready`。
