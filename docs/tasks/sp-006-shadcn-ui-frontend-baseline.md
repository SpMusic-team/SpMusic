---
doc_id: "TASK-SP-006"
title: "shadcn/ui 基础接入与前端样式基线"
doc_type: "task"
status: "done"
owner_agent: "Frontend Agent"
version_scope: "v0.1"
created: "2026-07-10"
updated: "2026-07-10"
source_documents:
  - "docs/tasks/sp-005-frontend-foundation-skeleton.md"
  - "docs/decisions/2026-07-10-shadcn-ui-installation-boundary.md"
  - "agent-prompt/PM_Agent.md"
  - ".agents/skills/shadcn/SKILL.md"
---
# 任务：shadcn/ui 基础接入与前端样式基线

## 背景

项目 Agent 提示词将 `shadcn/ui` 列为前端技术栈，但当前仓库尚未安装对应依赖，也没有 `components.json`、Tailwind 配置或 `src/components/ui`。原最小播放界面实现任务执行中发现该前端基底缺失，因此需要先补齐基底，再继续播放界面实现。

## 目标

- 接入 shadcn/ui 所需的最小前端基础配置。
- 安装 shadcn skill，使后续 Frontend Agent 能读取项目 shadcn/ui 上下文和组件规则。
- 建立 `components.json`、Tailwind 相关配置、路径 alias 和 `src/components/ui` 基础目录。
- 引入后续最小播放界面会用到的最少量基础组件。
- 保留或映射 SP-005 已建立的前端 CSS token、文案集中管理和状态枚举约束。
- 确保接入后 `npm run lint` 和 `npm run build` 通过。

## 非目标

- 不实现最小播放界面业务。
- 不重写播放器状态结构。
- 不实现播放 / 暂停 / 上一首 / 下一首交互。
- 不引入真实音频播放、本地文件读取、媒体库、Tauri command 或插件能力。
- 不引入完整主题系统、主题编辑器、语言切换或正式 i18n 框架。
- 不一次性迁移大量未使用组件。

## 负责 Agent

Frontend Agent

## 涉及文件 / 模块

- `package.json`
- `package-lock.json`
- `vite.config.ts`
- `tsconfig*.json`
- `components.json`
- Tailwind 相关配置文件
- `src/index.css`
- `src/components/ui/`
- `.agents/skills/shadcn/`
- SP-005 已建立的前端类型、fixture、文案和样式 token

## 验收标准

- 仓库存在 shadcn/ui 所需的 `components.json` 或等价配置。
- 仓库存在 `.agents/skills/shadcn/SKILL.md`。
- 仓库存在 `src/components/ui` 或等价组件目录。
- Tailwind 与 shadcn/ui 所需依赖已记录在 `package.json` 和锁文件中。
- TypeScript / Vite 路径 alias 能支持 shadcn/ui 推荐的组件导入方式。
- 至少存在最小播放界面后续会使用的基础 UI 组件。
- SP-005 的 `Track` / `PlayerState` 类型、假歌曲 fixture、演示频谱数据、用户可见文案集中管理和播放状态枚举仍保留。
- 接入后未实现最小播放界面业务交互。
- 未引入真实音频播放、本地文件读取、媒体库、Tauri command 或插件能力。
- `npm run lint` 通过。
- `npm run build` 通过。

## 备注

该任务是原最小播放界面实现的前置基底任务。完成后，`SP-007` 再基于 shadcn/ui 与 SP-005 前端骨架实现最小播放界面。
