# SpMusic 开发规范

本文件是本仓库唯一的开发规范。产品定位：本地优先的桌面音乐播放器（React + TypeScript 前端，Tauri 2 + Rust 后端）。输出默认使用简体中文。

## 常用命令

```bash
npm install      # 安装依赖
npm run dev      # 前端开发服务器
npm run build    # 构建（含 TypeScript 检查）
npm run lint     # Lint
npm run tauri    # Tauri CLI
npm run docs     # 文档工作台 http://127.0.0.1:4175
npm run docs:test # 文档工作台单元测试
```

改动完成后至少运行 `npm run lint`；涉及前端构建配置、Tauri 配置或类型定义时再运行 `npm run build`。

## 目录与边界

- `src/` ── React 前端（播放器、外观、UI 组件、文档工作台）
- `src-tauri/` ── Tauri 应用与 Rust 后端，音频能力只能从这里暴露
- `docs/` ── 需求、架构、任务、实现与变更记录等文档
- `tools/` ── 文档工作台与音频语料工具
- `test-fixtures/` ── 确定性合成音频语料

前端不得直接调用系统能力，一律走已注册的 Tauri command / event。新增或改动跨层契约（command 参数、event 载荷、共享类型、错误语义）时先在 `docs/architecture/` 记录，再动代码。

## 行为约束

- 不伪造能力：没有实现的功能不要写成已实现，模拟或占位状态不得描述为真实能力。
- 不吞错、不静默降级：错误要显式暴露并带上下文；禁止用空 `catch` 或默认值把失败伪装成成功。
- 修根因，不修症状：定位到真实原因再改，不用特判、延迟重试或放宽断言掩盖问题。
- 不越权跨层：改前端不顺手改 Rust 后端，反过来也一样；需要跨层时先说明理由。
- 新依赖、新权限、新外部服务先确认必要性再引入，并说明替代方案。
- 不改任务范围外的文件，不顺手重排、重命名或用格式化工具扫全仓。

## 文档

`docs/` 下的 Markdown 与根 `README.md` 带 YAML front matter，字段固定：

```yaml
---
doc_id: TASK-SP-012
title: 标题
doc_type: task        # requirement | architecture | implementation | decision | task | test | change | ui | plan | index
status: active        # active | draft | ready | in-review | done | superseded | blocked
owner_agent: lead
version_scope: v0.1   # project | v0.1 | v0.2 | research | future | corpus
created: "2026-11-20" # 必须加引号，否则会被解析成日期对象
updated: "2026-11-20"
source_documents:
  - "docs/architecture/overall-architecture.md"
---
```

- 九个字段都不能为空：`source_documents` 至少写一项（没有上游就写 `user request: …`）。
- `created` / `updated` 用 `YYYY-MM-DD` 且必须加引号。
- `title` 与正文一级标题一致；括号副标题、`决策：` 这类体裁前缀不算冲突。
- 正文相对链接必须指向真实存在的文件。
- `docs/corpus/` 是 Poweramp / foobar2000 的逆向语料，只做证据存档，同样适用上述字段。
- 用 `npm run docs` 的校验面板检查上述规则。

## 任务卡

`docs/tasks/` 下的任务卡只写五节，够用就好：

```markdown
## 目标

## 非目标

## 验收标准

## 涉及文件

## 备注
```

背景并入「目标」，风险与依赖并入「备注」。不要为单张卡增补额外章节。

## Git

分支模型为单人主干开发，提交信息格式见 [GIT_WORKFLOW.md](GIT_WORKFLOW.md)。提交前确认 `git status` 里没有与本次任务无关的改动。
