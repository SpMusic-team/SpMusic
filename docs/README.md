---
doc_id: "INDEX-DOCS"
title: "文档总索引"
doc_type: "index"
status: "active"
owner_agent: "lead"
version_scope: "project"
created: "2026-11-20"
updated: "2026-11-20"
source_documents:
  - "user request: 文档架构改革，建立 docs 索引层"
---

# 文档总索引

docs/ 下共 372 篇文档。这个文件是入口，按目录说明「这里放什么、什么时候该读」。

## 从哪里开始

| 你想做什么 | 先读 |
| --- | --- |
| 第一次接触这个项目 | [README.md](../README.md) → [architecture/overall-architecture.md](architecture/overall-architecture.md) |
| 确认某个能力现在有没有 | 代码与 [implementation/](implementation/index.md)；根目录 4 篇规划文档是 2026-07～10 的历史快照，不代表现状 |
| 确认某个能力该不该做 | [requirements/总需求分析.md](requirements/总需求分析.md) → [requirements/v0-1-foundation.md](requirements/v0-1-foundation.md) |
| 改跨层契约（command / event / 共享类型） | [architecture/](architecture/index.md) 对应文档，先记录再动代码 |
| 接手一张任务卡 | [tasks/](tasks/index.md) |
| 查某个行为当初为什么这么定 | [decisions/](decisions/index.md) |
| 看某个优化/缺陷的来龙去脉 | [changes/](changes/index.md) |
| 核对性能或兼容性证据 | [test/](test/index.md) → [audio-compatibility/](audio-compatibility/index.md) |
| 逆向 Poweramp / foobar2000 的依据 | [corpus/](corpus/index.md) |

## 目录

| 目录 | 篇数 | 放什么 |
| --- | --- | --- |
| [requirements/](requirements/index.md) | 4 | 产品需求、v0.1/v0.2 版本切分 |
| [architecture/](architecture/index.md) | 33 | 模块边界、数据契约、Tauri command 边界 |
| [implementation/](implementation/index.md) | 24 | 落地方式、并发与数据流细节 |
| [decisions/](decisions/index.md) | 13 | 已生效的技术与范围决策 |
| [tasks/](tasks/index.md) | 35 | 目标 / 非目标 / 验收标准 / 涉及文件 |
| [test/](test/index.md) | 73 | 验证报告与性能基线 |
| [changes/](changes/index.md) | 41 | 缺陷与优化项 |
| [ui/](ui/index.md) | 2 | 布局策略与页面结构 |
| [audio-compatibility/](audio-compatibility/index.md) | 5 | 格式能力矩阵与解码基线 |
| [corpus/](corpus/index.md) | 138 | Poweramp / foobar2000 取证存档，只作证据 |
| 根目录 4 篇 | 4 | 需求索引、路线图、Sprint 计划、发布计划（均已归档，见下） |

## 根目录的 4 篇规划文档（已归档）

[requirements.md](requirements.md)、[roadmap.md](roadmap.md)、[sprint-plan.md](sprint-plan.md)、[release-plan.md](release-plan.md) 已全部置为 `superseded`，是 2026-07～10 的规划快照。

它们记录的是「v0.1 收口阶段尚未完成」（SP-016/SP-017 待验收、SP-018 验证未做、SP-019 制品未构建、`package.json` 仍是 `0.0.0`），此后代码已越过这个范围：曲库与播放列表、封面与缩略图、全局快捷键等能力都已落地。**判断某个能力现在有没有，看代码和 `implementation/`，不要看这 4 篇。**

## 元数据约定

所有文档带九个字段的 front matter，字段取值与校验规则见 [AGENTS.md](../AGENTS.md) 与 [decisions/2026-07-09-document-metadata-standard.md](decisions/2026-07-09-document-metadata-standard.md)。`npm run docs` 的校验面板会报出缺字段、日期格式和断链。
