---
doc_id: "DEC-2026-07-10-VISUAL-CUSTOMIZATION-BOUNDARY"
title: "视觉自定义与动效扩展边界"
doc_type: "decision"
status: "accepted"
owner_agent: "PM Agent"
version_scope: "project"
created: "2026-07-10"
updated: "2026-07-10"
source_documents:
  - "docs/sprint-plan.md"
  - "docs/decisions/2026-07-10-shadcn-ui-installation-boundary.md"
  - "docs/requirements/总需求分析.md"
  - "user request: @pm 干活"
---
# 决策：视觉自定义与动效扩展边界

## 背景

`shadcn/ui` 已被确认为 SpMusic 前端基底。用户进一步提出：是否可以只用基础 UI 做骨架，并通过导入 Tailwind class 和 CSS token 来定制复杂样式与动画。

该方向符合 SpMusic 长期“美观、流畅、可扩展外观能力”的产品定位，但它会引入主题导入、样式校验、运行时安全、持久化、性能档位和 reduced-motion 等边界问题，不能直接并入 v0.1 播放界面任务。

## 决策

v0.1 只使用 `shadcn/ui` 作为基础组件骨架，并使用 Tailwind class、CSS token 和动效 token 作为前端内部实现手段。

v0.1 可以建立内部样式基线，包括：

- 颜色、圆角、间距、层级、状态色和表面材质 token。
- 动效时长、缓动曲线、过渡强度和 reduced-motion 兜底 token。
- 播放器状态、进度条、频谱或等价音频视觉化区域所需的内部样式参数。

v0.1 不开放以下能力：

- 用户导入 Tailwind class。
- 用户导入外部 CSS token、主题文件或动画配置文件。
- 主题编辑器、主题导入导出、主题持久化。
- 运行时加载外部 CSS、任意 class 或任意动画定义。
- 面向用户的自定义动效系统。

## 理由

Tailwind class 通常依赖构建期扫描。若允许用户在运行时导入任意 class，需要 safelist、编译流程或受限映射，否则样式可能不可预测。

CSS token 更适合作为后续视觉自定义能力的基础，但必须先定义白名单、类型、默认值、校验、回退、持久化、安全边界和性能降级规则。

当前 Sprint 已明确排除可导入主题、主题编辑器和主题持久化。把用户可导入样式并入 v0.1 会扩大范围，并让播放界面实现承担过多架构风险。

## 后续路由

后续若推进视觉自定义与动效扩展，应拆分为独立工作：

- Requirements Agent 定义用户价值、最小能力、非目标和验收标准。
- Architecture Agent 设计 token 白名单、校验、回退、持久化、安全边界和 reduced-motion 规则。
- Frontend Agent 基于 `shadcn/ui`、Tailwind 和 CSS token 实现受控的样式预览或预设切换，不直接执行任意用户 class。
- Test Agent 覆盖对比度、低性能档位、reduced-motion、非法 token 回退和主题切换回归。

## 影响

- `SP-006` 与 `SP-007` 可以使用内部 Tailwind class、CSS token 和动效 token，但不能把它们解释为用户可导入样式能力。
- 文档提到 Tailwind class 或 CSS token 时，必须区分“内部实现基线”和“用户自定义能力”。
- 用户视觉自定义与动效扩展进入未来版本预研，不进入 v0.1 播放界面交付范围。
