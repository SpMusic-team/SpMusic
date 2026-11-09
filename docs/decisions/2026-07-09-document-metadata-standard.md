---
doc_id: "DEC-2026-07-09-DOC-METADATA"
title: "文档元数据规范"
doc_type: "decision"
status: "accepted"
owner_agent: "PM Agent"
version_scope: "project"
created: "2026-07-09"
updated: "2026-07-09"
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
- `title`：中文标题。
- `doc_type`：例如 `requirements`、`requirements-index`、`roadmap`、`sprint-plan`、`release-plan`、`task`、`decision`、`agent-prompt`、`template`。
- `status`：例如 `draft`、`in-review`、`active`、`approved`、`accepted`、`deferred`。
- `owner_agent`：负责维护该文档的 Agent。
- `version_scope`：适用范围，例如 `project`、`long-term`、`v0.1`、`future`、`deferred`。
- `created`：首次创建日期。
- `updated`：最近更新日期。
- `source_documents`：生成或更新该文档所依据的来源。

## 维护规则

- 新增正式 Markdown 文档时必须带元数据。
- 修改文档正文时应同步更新 `updated`。
- 文档状态变化时必须更新 `status`。
- 如果文档由另一个文档拆分或派生，必须把来源写入 `source_documents`。
- 文件名用于路径稳定，`doc_id` 用于追溯稳定身份。

## 元数据权限

元数据可以由多个 Agent 维护，但必须遵守职责边界。

### 通用权限

所有 Agent 都可以在自己允许产出的文件中：

- 创建完整 YAML front matter。
- 更新 `updated`。
- 补充 `source_documents`。
- 修正明显的标题、路径或来源错误。
- 将 `status` 从缺失状态补为与文档正文一致的初始状态。

所有 Agent 默认不得：

- 修改不属于自己允许产出范围的文件元数据。
- 擅自修改 `doc_id`。
- 擅自把其他 Agent 负责的文档状态改为 `approved`、`accepted`、`done` 或等价完成状态。
- 擅自改变 `owner_agent`，除非 PM Agent 明确重新分配。
- 删除已有 `source_documents`，除非确认其为错误来源并在正文或提交说明中解释。

### 字段权限

| 字段 | 默认可修改者 | 限制 |
| --- | --- | --- |
| `doc_id` | PM Agent | 创建后应保持稳定；其他 Agent 只能在新建自己产物时设置 |
| `title` | 文档 owner_agent、PM Agent、Documentation Agent | 必须与正文标题一致 |
| `doc_type` | 文档 owner_agent、PM Agent | 创建后不应频繁变更 |
| `status` | 文档 owner_agent、PM Agent | 完成、批准、接受类状态只能由对应 owner 或 PM 更新 |
| `owner_agent` | PM Agent | 代表职责归属，其他 Agent 不得擅自改 |
| `version_scope` | PM Agent、文档 owner_agent | 不得扩大到未批准版本范围 |
| `created` | 文档创建者 | 创建后不得修改，除非明显错误 |
| `updated` | 所有修改该文档正文或元数据的 Agent | 修改时必须同步更新 |
| `source_documents` | 所有修改该文档的 Agent | 可追加来源，删除来源需说明原因 |

### Agent 级权限

- PM Agent：可维护规划、任务、决策、发布、复盘、Agent 注册表、Agent 提示词和模板的元数据；可调整 `owner_agent`。
- Requirements Agent：可维护 `docs/requirements.md`、`docs/requirements/*.md` 及需求归档文档的元数据；不得批准路线图、Sprint 或发布计划。
- Architecture Agent：可维护 `docs/architecture/*.md` 和由其创建的架构决策文档元数据；不得修改产品需求状态。
- UI/UX Agent：可维护 `docs/ui/*.md` 和由其创建的 UI 决策文档元数据；不得修改实现任务状态。
- Frontend Agent：可维护 `src/` 相关实现说明文档和由其创建的前端测试说明元数据；不得修改 PM 或需求文档状态。
- Rust/Tauri Agent：可维护 Rust/Tauri 实现说明文档元数据；不得修改产品需求或 UI 规格状态。
- Test Agent：可维护 `docs/test/*.md`、测试报告和测试文件说明元数据；不得把产品任务改为完成，只能报告验证结果。
- Documentation Agent：可检查并修复文档元数据完整性、标题一致性、链接来源和 `updated` 字段；不得擅自改变职责归属或批准状态。

## 影响

- PM Agent 负责维护规划、任务、决策类文档的元数据。
- Requirements Agent 负责维护需求文档的元数据。
- Documentation Agent 负责检查 README 和文档索引中的元数据完整性。
- 其他 Agent 在创建自己的产物时必须遵守本规范。
