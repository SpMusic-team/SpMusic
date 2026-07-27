---
doc_id: "TASK-SP-010"
title: "README 当前能力与限制更新"
doc_type: "task"
status: "ready"
owner_agent: "Documentation Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-27"
source_documents:
  - "docs/sprint-plan.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
  - "docs/tasks/sp-012-readme-and-developer-documentation.md"
  - "docs/tasks/sp-018-real-audio-verification.md"
  - "docs/tasks/sp-019-v0-1-artifact-and-version-gate.md"
---
# 任务：README 当前能力与限制更新

## 背景

README 仍描述模板页面、无业务 command、无真实音频和无文件读取，与仓库事实明显冲突。SP-012 与本任务重复且保留了过时限制，现由本任务统一收口。

## 目标

由 Documentation Agent 根据范围决策和最终验证证据更新 README，使项目身份、当前实现候选、已验证能力、未验证能力、开发命令、构建命令、制品位置和范围限制一致。

## 非目标

- 不提前声明未验收的真实播放能力。
- 不把同目录临时队列称为媒体库或产品级播放列表。
- 不把自动解码测试称为声卡实机播放或跨平台认证。
- 不修改业务代码、构建配置、依赖或版本号。

## 负责 Agent

Documentation Agent

## 涉及文件 / 模块

- `README.md`
- 只读输入：`docs/release-plan.md`
- 只读输入：`docs/test/v0-1-real-audio-verification.md`
- 只读输入：SP-019 制品与版本证据

## 输入

- 两项 v0.1 范围决策。
- SP-018 最终报告，包含自动检查和人工播放结论。
- SP-019 的版本、Tauri build、制品 SHA-256 和制品 smoke 结论。
- SP-020 重整后的 v0.1 需求基线。
- `package.json` 中实际可用的 npm scripts。

## 输出

- 更新后的 `README.md`。
- README 中的当前能力、明确限制、开发 / 验证 / 构建命令和文档入口。
- 如验证仍失败，清晰的“实现存在但尚未发布验收”状态，而不是提前宣布支持。

## 执行步骤

1. 先记录 README 中的过时声明清单。
2. 对 SP-018 / SP-019 每项结论建立“README 声明 -> 证据位置”映射。
3. 更新项目状态、v0.1 范围、命令、限制和文档链接。
4. 检查所有相对链接和命令名称；不得凭记忆补充命令。
5. 搜索并移除与事实冲突的“模板页面”“无业务 command”“不支持真实播放 / 文件读取”等旧描述。

## 验收标准

- README 标题、摘要和当前状态与 SpMusic 实际仓库一致，不再描述 starter 页面或空 Tauri 壳。
- README 对“已实现候选”“本轮已验证”“尚未验证 / 不支持”使用可区分措辞。
- 只有 SP-018 通过的播放、临时队列、歌词 / 封面和格式组合才能写成已验证。
- README 把同目录能力描述为“用户选中文件后的非递归、会话内临时队列”，明确不包含媒体库、递归扫描和持久播放列表。
- README 逐项区分格式自动化证据与实际制品可听 smoke，并注明已验证平台。
- README 明确仍不支持数据库、持久播放列表、网络存储、FFmpeg 运行时和插件系统。
- README 列出 `npm install`、`npm run dev`、`npm run tauri dev`、`npm run lint`、`npm run build`、`npm run tauri build` 及实际存在的文档工具命令。
- README 的版本、制品和发布描述与 SP-019 一致。
- README 链接需求索引、路线图、Sprint、发布计划、当前架构和验证报告；相对链接均可解析。
- `rg -n "starter|未实现业务 command|不支持真实音频|不读取用户本地" README.md` 的命中均被逐项审查，不再保留与当前结论冲突的陈述。

## 风险

- 在 SP-018 / SP-019 前完成最终措辞会过度承诺；允许先起草，但最终验收依赖两项报告。
- 兼容性矩阵维度复杂，概括时容易把扩展名或 probe 成功写成完整支持。
- README 由 Documentation Agent 实施；PM Agent 不直接修改 README。

## 备注

本任务吸收 SP-012。可立即起草事实性内容，但只有 SP-018、SP-019、SP-020 完成后才能标记 Done。
