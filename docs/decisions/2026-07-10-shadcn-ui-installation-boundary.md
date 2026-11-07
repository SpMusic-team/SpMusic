---
doc_id: "DEC-2026-07-10-SHADCN-UI-BOUNDARY"
title: "shadcn/ui 前端基底接入边界"
doc_type: "decision"
status: "accepted"
owner_agent: "PM Agent"
version_scope: "v0.1"
created: "2026-07-10"
updated: "2026-07-10"
source_documents:
  - "agent-prompt/PM_Agent.md"
  - "docs/tasks/sp-007-minimal-player-shell-implementation.md"
  - "package.json"
---
# 决策：shadcn/ui 作为前端基底单独接入

## 背景

Agent 提示词中的项目背景列出了 `shadcn/ui`，但当前仓库没有安装 `shadcn/ui` 相关配套依赖，也没有 `components.json`、Tailwind 配置或 `src/components/ui` 目录。

原 `SP-006` 执行中发现该前端基底尚未落地。如果继续实现最小播放界面，会让播放器界面建立在错误的样式和组件基线上，后续再迁移会扩大返工。

## 决策

`shadcn/ui` 是 SpMusic 前端基底，应在最小播放界面实现前单独接入。

当前 Sprint 新增 `SP-006 shadcn/ui 基础接入与前端样式基线`，原“最小播放界面实现”顺延为 `SP-007`，并依赖新的 `SP-006`。

该接入任务必须明确：

- 允许修改 `package.json`、锁文件、Tailwind 配置、`components.json`、`src/components/ui` 和必要的路径 alias 配置。
- 只接入最小 shadcn/ui 基底和任务六后续需要的基础组件。
- 保留或映射现有前端 CSS token、用户可见文案集中管理和稳定状态枚举。
- 不在该任务中实现最小播放界面业务。
- 通过 `npm run lint` 和 `npm run build` 验收。

## 影响

- 原最小播放界面任务暂停并顺延，等待 shadcn/ui 基底完成后继续。
- Frontend Agent 不应在播放界面实现任务中临时安装 UI 框架；应先完成专门的基底接入任务。
- PM Agent 后续分配任务时，必须区分“前端基底接入任务”和“业务界面实现任务”。
- 文档或提示词提到 `shadcn/ui` 时，必须检查仓库是否已经落地；未落地时先补基底任务。

## 验收口径

- `SP-006` 验收后，仓库存在 shadcn/ui 所需的基础配置和最小组件目录。
- `SP-007` 才开始使用该基底实现最小播放界面。
- 不允许把 shadcn/ui 接入和最小播放界面业务实现混在同一个任务里验收。
