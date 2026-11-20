---
doc_id: "DEC-2026-07-09-DOC-METADATA"
title: "文档元数据规范"
doc_type: "decision"
status: "done"
owner_agent: "lead"
version_scope: "project"
created: "2026-07-09"
updated: "2026-11-20"
source_documents:
  - "user request"
---

# 决策：文档元数据规范

## 状态

已接受。

## 背景

项目中的需求、计划、任务、决策和 Agent 提示词数量开始增加。如果文档缺少来源、负责人、状态和版本范围，后续很难判断它是否仍有效、由谁维护、基于什么输入生成。

## 决策

所有正式 Markdown 文档必须在文件顶部使用 YAML front matter 记录元数据。

## 必填字段

```yaml
---
doc_id: "唯一文档 ID"
title: "文档标题"
doc_type: "文档类型"
status: "文档状态"
owner_agent: "负责 Agent"
version_scope: "适用版本或范围"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
source_documents:
  - "来源文件或请求"
---
```

## 字段说明

- `doc_id`：稳定唯一 ID，不随标题调整而改变。
- `title`：中文标题，与正文一级标题一致。括号副标题（如「（build-1035）」）与「决策：」「测试报告：」这类体裁前缀不算不一致。
- `doc_type`：取值为 `requirement`、`architecture`、`implementation`、`decision`、`task`、`test`、`change`、`ui`、`plan`、`index` 十种之一。
- `status`：取值为 `active`、`draft`、`ready`、`in-review`、`done`、`superseded`、`blocked` 七种之一。
- `owner_agent`：负责方。历史字段名保留，当前统一取 `lead`，不再对应任何角色体系。
- `version_scope`：取值为 `project`、`v0.1`、`v0.2`、`research`、`future`、`corpus` 六种之一。
- `created`：首次创建日期。
- `updated`：最近更新日期。
- `source_documents`：生成或更新该文档所依据的来源，至少一项。

## 适用范围

元数据规范只约束项目文档：`docs/` 下的 Markdown 与仓库根 `README.md`。

以下路径不属于项目文档体系，不要求 front matter：`.agents/skills/`（外部 skill 原文，带哈希锁）、`.rea-analysis/`（反汇编取证产物）、`tools/*/README.md`（工具自带说明）、`src-tauri/` 下的说明文件。

## 维护规则

- 新增正式 Markdown 文档时必须带元数据；修改正文同步维护 `updated`，状态变化同步 `status`。
- `doc_id` 创建后保持稳定，不随标题调整而改。
- `source_documents` 可追加；删除来源需在提交说明中写明原因。
- 文档由另一篇拆分或派生时，必须把来源写进 `source_documents`；文件名用于路径稳定，`doc_id` 用于追溯稳定身份。
- 校验入口：`npm run docs` 的校验面板，或 `loadAllDocuments` 返回的 `issues`。

## 影响

- `tools/docs-manager/lib.mjs` 按本规范校验；超出适用范围的路径不产生校验问题。
- 新增文档缺字段、日期未加引号、链接目标不存在都会被校验面板报出来。
