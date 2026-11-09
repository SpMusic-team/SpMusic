---
doc_id: "RELEASE-V0-1"
title: "v0.1 发布计划"
doc_type: "release-plan"
status: "active"
owner_agent: "PM Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-27"
source_documents:
  - "docs/sprint-plan.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
  - "docs/tasks/sp-018-real-audio-verification.md"
  - "docs/tasks/sp-019-v0-1-artifact-and-version-gate.md"
---
# 发布计划

## 发布版本

v0.1 真实本地播放可发布闭环

## 目标

发布一个可运行、可验证、可从实际制品启动的 SpMusic 桌面版本：保留已完成播放器界面，提供真实本地音频播放、会话内同目录临时队列、嵌入式歌词 / 封面展示和有证据边界的格式兼容性。

## 发布内容

- SpMusic 项目身份和基础文档。
- shadcn/ui 前端基底和内部样式基线。
- 播放器界面、当前歌曲展示和基础播放控制。
- 最小 Tauri command 契约。
- Rust/Tauri 真实音频播放后端。
- 本地音频资源打开、播放、暂停、继续、停止、seek 和进度状态。
- 前端接入真实播放 command。
- 用户选中文件后，对同目录受支持扩展名执行非递归只读枚举，并形成不持久化的临时队列。
- 同目录临时队列的上一首、下一首、直接选择和自然结束切换。
- 基础标签与嵌入式歌词 / 封面存在时的展示，以及缺失时的后备状态。
- 以确定性合成语料验证的当前格式矩阵；具体支持范围以发布报告逐项结果为准。
- Empty State 与最小错误状态。
- 综合真实播放验证报告、Tauri 构建证据和发布制品 smoke 记录。

## 不包含内容

- 递归文件夹扫描、媒体库、文件监控和索引。
- 数据库或持久化索引。
- 网络存储播放。
- 临时队列持久化、跨目录队列管理，以及播放列表创建、编辑、删除、导入导出。
- 网络 / sidecar 歌词、逐字歌词、歌词 / 封面 / 标签编辑。
- CUE / M4B 公共交互、跨曲目 gapless 和播放进度持久化。
- FFmpeg 运行时 fallback 与长尾格式承诺。
- 真实频谱分析、高级 DSP、独占输出。
- 插件系统。
- 在线服务或账号系统。

## Gate 1：范围、需求与文档

- 两项 v0.1 范围决策为 `accepted`。
- SP-020 已由 Requirements Agent 重整 v0.1 需求基线。
- SP-021 已使架构文档与当前 command、DTO、临时文件夹队列、元数据、状态事件和错误码边界一致。
- README 由 SP-010 根据最终证据更新，不保留 UI-only、模板首页或“无业务 command”等过时描述。

## Gate 2：自动化检查

- `npm run lint` 退出码为 0。
- `npm run build` 退出码为 0。
- 在 `src-tauri` 执行 `cargo fmt -- --check`、`cargo check`、`cargo test`，退出码均为 0。
- 音频语料执行 `node tools/audio-compatibility/generate-fixtures.mjs self-check` 和 `verify`；需要生成语料时记录 FFmpeg 绝对路径与版本。
- 结果必须对应同一 commit SHA；脏工作区需列出差异并解释为什么不污染证据。

## Gate 3：开发运行人工验证

- `npm run tauri dev` 启动成功。
- 对 MP3、FLAC、WAV、AAC / M4A 代表样本完成可听播放、暂停、继续、seek、停止。
- 同一目录至少含 3 个受支持音频文件；验证非递归枚举、稳定顺序、直接选择、上一首 / 下一首和自然结束切换。
- 至少一个样本含嵌入式歌词和封面，至少一个样本不含；分别验证展示和后备状态。
- 无效或损坏输入显示稳定错误，不崩溃、不无限重试、不把失败项加入可播放队列。
- 设备切换能力只在有可复现实机条件时声明；否则作为残余风险记录。

## Gate 4：版本、构建与制品 smoke

- `package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 的版本一致为 `0.1.0`；当前已知 `package.json` 为 `0.0.0`，在对齐前本 Gate 失败。
- 拟发布 tag 为 `v0.1.0`，与应用版本一致。
- `npm run tauri build` 退出码为 0。
- 报告记录实际 bundle 路径、制品文件名、文件大小和 SHA-256。
- 从实际 bundle / 安装制品启动应用，重复至少一个本地音频的打开、播放、暂停、seek、停止和退出重启 smoke。
- 制品 smoke 使用的文件、步骤和结果不得只引用 `tauri dev` 证据。

## 证据格式

每个 Gate 至少记录：

- commit SHA、分支、工作区状态、日期和执行人 / Agent。
- OS、架构、Node、npm、Rust、Cargo、Tauri CLI 版本。
- 命令原文、工作目录、退出码、关键输出摘要和完整日志路径。
- 输入 fixture ID、容器 / codec、SHA-256、预期结果和实际结果。
- 人工步骤编号、可见状态、可听结果、截图或日志位置。
- 失败归属、阻塞任务和残余风险。

## 发布决策

只有四个 Gate 全部通过，SP-016 / SP-017 获得 SP-018 验收，SP-010 完成 README 收口，并且 PM Agent 在 SP-013 完成 Sprint 复盘后，v0.1 才可视为可发布。自动检查通过、`tauri dev` 可启动或代码已合并中的任一项都不能单独构成发布批准。
