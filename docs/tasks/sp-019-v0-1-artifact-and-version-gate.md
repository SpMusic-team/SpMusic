---
doc_id: "TASK-SP-019"
title: "v0.1 制品、版本一致性与制品 smoke"
doc_type: "task"
status: "ready"
owner_agent: "PM Agent"
version_scope: "v0.1"
created: "2026-07-27"
updated: "2026-07-27"
source_documents:
  - "docs/sprint-plan.md"
  - "docs/release-plan.md"
  - "GIT_WORKFLOW.md"
  - "package.json"
  - "src-tauri/tauri.conf.json"
  - "src-tauri/Cargo.toml"
  - "user request: 增加 tauri build、制品 smoke 和版本一致性发布门"
---
# 任务：v0.1 制品、版本一致性与制品 smoke

## 背景

前端 build、`cargo check` 和 `tauri dev` 都不能证明发布 bundle 可构建、可启动和可播放。当前 `package.json` 版本为 `0.0.0`，而 `src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml` 为 `0.1.0`，已知版本不一致直接阻塞 v0.1 发布。

PM Agent 负责协调与验收本任务，不直接修改构建配置。任何配置变更必须先按 Agent 注册表和 PM prompt 明确 exact path、实施 Owner 与验证方式；不得让 Documentation Agent 或 Test Agent 顺手修改版本。

## 目标

- 对齐前端 package、Tauri 配置、Cargo package、制品元数据和拟发布 tag 为 `0.1.0`。
- 在发布目标环境执行 `npm run tauri build`。
- 对实际 bundle / 安装制品执行启动和真实音频 smoke。
- 产出可复核的版本、制品路径、大小、SHA-256 和 smoke 证据。

## 非目标

- 不修改业务功能。
- 不顺手升级依赖、Tauri minor / major 版本或音频库。
- 不签名、公证、发布 GitHub Release 或推送 tag。
- 不认证未执行 build / smoke 的平台。

## 负责 Agent

- PM Agent：协调 exact-path 实施授权、汇总证据、判定 Gate。
- Rust/Tauri Agent：在其获准路径内执行 Tauri / Cargo 版本与 bundle 检查。
- Frontend Agent：在其获准路径内处理前端 package 版本一致性。
- Test Agent：复核实际制品 smoke。

若 Agent 注册表未授权必需配置路径，PM Agent 必须先记录阻塞并请求仓库 Owner 明确授权，不得越权修改。

## 涉及文件 / 模块

- 只读审计：`package.json`
- 只读审计：`src-tauri/tauri.conf.json`
- 只读审计：`src-tauri/Cargo.toml`
- 构建输出：`src-tauri/target/release/bundle/**/*`（不得提交）
- 证据输出：SP-018 综合验证报告或 PM 复盘引用的制品证据

## 输入

- 目标版本 `0.1.0` 和拟发布 tag `v0.1.0`。
- 已通过的 SP-018 自动检查和开发运行结果。
- 当前三处版本声明、Tauri bundle 配置和 GIT_WORKFLOW。
- 至少一个已在 SP-018 通过的本地音频 fixture。

## 输出

- 三处版本与拟发布 tag 的对照表。
- `npm run tauri build` 的命令、环境、退出码和日志。
- bundle 文件名、相对路径、文件大小、SHA-256。
- 从实际 bundle / 安装制品完成的启动、打开、播放、暂停、seek、停止、退出重启 smoke。
- Gate Pass / Fail / Blocked 结论和残余平台风险。

## 可复现执行步骤

1. 记录 commit SHA、分支、`git status --short`、OS / 架构、Node / npm、Rust / Cargo 和 Tauri CLI 版本。
2. 读取 `package.json.version`、`src-tauri/tauri.conf.json.version`、Cargo `[package].version`，与 `0.1.0` 和 `v0.1.0` 对照。
3. 如不一致，记录 exact path 和目标值，按 Agent 权限拆分实施；全部对齐前不得继续宣称 Gate 通过。
4. 在仓库根目录执行 `npm run tauri build`，保存完整日志。
5. 枚举本次生成的 bundle，记录文件名、相对路径、字节数和 SHA-256；不得复用旧制品。
6. 从实际制品启动应用，使用 SP-018 已通过 fixture 执行打开、播放、暂停、seek、停止。
7. 关闭并重新启动制品，确认可再次打开且不会把 v0.1 临时队列冒充持久播放列表。
8. 记录预期 / 实际、截图或日志路径、失败信号和复测条件。

## 验收标准

- 三处版本均为 `0.1.0`，拟发布 tag 为 `v0.1.0`。
- `npm run tauri build` 在记录 commit 上退出码为 0。
- 至少一个本次生成的 bundle 有路径、大小和 SHA-256。
- 实际制品可启动并完成打开、播放、暂停、seek、停止和退出重启 smoke。
- smoke 证据明确来自实际 bundle / 安装制品，不是 `tauri dev`。
- 失败时记录 exact command、日志、制品、复现步骤、Owner 和重测条件。
- 未执行的平台明确标记为未认证。

## 风险

- release profile、bundle 资源路径或原生依赖可能只在 `tauri build` 暴露失败。
- 工作区旧 bundle 可能污染证据，必须按本次构建时间和 SHA-256 识别。
- 当前 Agent 注册表对 `package.json`、`tauri.conf.json` 的写权限没有明确覆盖，版本修复可能需要仓库 Owner 授权。
- 签名、公证和多平台安装仍是后续发布工程，不得由单平台 smoke 外推。

## 文档更新

- Documentation Agent 在 SP-010 中使用最终版本、构建命令和制品状态更新 README。
- PM Agent 在 SP-013 复盘中引用本任务 Gate 结论。
