---
doc_id: "TASK-SP-018"
title: "v0.1 综合真实播放与能力边界验证"
doc_type: "task"
status: "ready"
owner_agent: "Test Agent"
version_scope: "v0.1"
created: "2026-07-24"
updated: "2026-07-27"
source_documents:
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/tasks/sp-016-rust-tauri-real-audio-backend.md"
  - "docs/tasks/sp-017-frontend-real-audio-integration.md"
  - "docs/sprint-plan.md"
  - "docs/tasks/sp-011-verification-checklist-and-test-report.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
  - "docs/audio-compatibility/format-capability-matrix.md"
  - "docs/tasks/sp-021-real-audio-contract-reconciliation.md"
---
# 任务：v0.1 综合真实播放与能力边界验证

## 背景

SP-016、SP-017 都有实现记录，但未取得被 Test Agent 接受的综合人工证据，不能标 Done。SP-011 与本任务重叠，现由本任务作为唯一综合验证入口。

## 目标

- 建立并执行 v0.1 自动检查、开发运行、真实声卡播放、临时队列、歌词 / 封面、兼容性和错误路径清单。
- 区分代码 / 自动化证据与 `tauri dev` 人工证据，并给 SP-019 提供已通过的制品 smoke 输入。
- 标明失败项应退回的负责 Agent和重测条件。

## 非目标

- 不实现功能修复。
- 不引入大型测试框架，除非后续任务明确批准。
- 不把无声卡自动解码结果外推为可听播放。
- 不认证无实机证据的平台或格式。

## 负责 Agent

Test Agent

## 涉及文件 / 模块

- `docs/test/v0-1-real-audio-verification.md`
- `src-tauri/**/*`（只读 / 执行测试）
- `src/**/*`（只读 / 执行测试）

## 输入

- 两项 v0.1 范围决策。
- SP-021 对齐后的 command、DTO、元数据和事件契约。
- SP-016、SP-017 的实现候选与实现说明。
- `test-fixtures/audio/manifest.json`、生成器和格式能力矩阵。
- 当前播放器 UI、command adapter、Rust command / DTO 和错误码。

## 输出

- `docs/test/v0-1-real-audio-verification.md`，作为 v0.1 唯一综合验证报告。
- 逐 Gate 通过 / 失败 / 阻塞结论。
- SP-016、SP-017 是否可转 Done 的明确建议。
- 失败项的复现步骤、证据、归属 Agent、严重级别和重测条件。

## 固定测试环境与输入

执行报告必须先记录：

- commit SHA、分支、`git status --short`。
- OS、版本、架构、音频输出设备和是否发生设备切换。
- Node、npm、Rust、Cargo、Tauri CLI、CMake 和 FFmpeg 版本；未使用的工具标 `N/A`。
- fixture ID、相对路径、容器、codec、时长、SHA-256、是否含歌词 / 封面和预期结果。

人工同目录场景至少准备：

- 同一目录内 3 个可播放文件，覆盖 MP3、FLAC、WAV。
- 1 个 AAC 或 M4A 文件。
- 1 个有嵌入式歌词和封面的文件。
- 1 个不含歌词和封面的文件。
- 1 个损坏或伪装为受支持扩展名的文件。
- 1 个包含音频文件的子目录，用于证明枚举非递归。

## 可复现验证步骤

### A. 自动检查

1. 在仓库根目录执行 `npm run lint`、`npm run build`。
2. 执行 `node tools/audio-compatibility/generate-fixtures.mjs self-check` 和 `verify`；需要重新生成时，记录 `--ffmpeg` 的绝对路径与版本。
3. 在 `src-tauri` 执行 `cargo fmt -- --check`、`cargo check`、`cargo test`。
4. 每条命令记录工作目录、开始 / 结束时间、退出码、关键输出和完整日志位置。

### B. 开发运行与真实声卡

1. 执行 `npm run tauri dev`，记录应用成功启动和第一屏。
2. 选择 MP3 样本，验证播放、暂停、继续、seek、停止；记录 UI phase、position、可听结果和后端日志。
3. 对 FLAC、WAV、AAC / M4A 重复打开和可听播放 smoke。
4. 快速连续执行播放 / 暂停、两次 seek、上一首 / 下一首；最终状态必须与最后一次用户意图一致，旧 response / event 不得反向覆盖。
5. 播放到自然结束，验证 phase、进度和临时队列的下一首行为。

### C. 同目录临时队列

1. 从固定目录选择中间项，记录队列项数、顺序、当前项和目录名。
2. 验证结果只包含当前目录受支持扩展名，不包含子目录内容。
3. 验证上一首、下一首、直接选择和自然结束切换。
4. 对损坏候选执行加载，记录稳定错误；应用不得崩溃、卡死、无限跳过或把失败冒充成功。
5. 关闭并重启应用，确认临时队列不被宣称为持久播放列表。

### D. 歌词、封面与后备

1. 打开含嵌入式歌词 / 封面的样本，记录标题、艺术家、专辑、歌词和封面实际值 / 截图。
2. 切换到无歌词 / 封面样本，确认上一首资源被清除，展示明确后备状态。
3. 进度变化时检查歌词高亮；如实现仅按行或估算时间工作，报告必须如实写明，不得称为逐字同步。

### E. 错误和恢复

1. 覆盖用户取消、空路径、文件不存在、不可读、损坏 / 不支持内容、无轨播放和后端初始化失败中可稳定构造的分支。
2. 记录 `code`、`recoverable`、用户可见状态和恢复步骤。
3. 失败后再加载一个正常样本，证明应用可恢复。

## 验收标准

- A-E 每个步骤都有 Pass / Fail / Blocked、预期、实际和证据位置。
- 自动检查、开发运行和真实声卡证据分栏记录；发布制品证据由后续 SP-019 单独记录。
- MP3、FLAC、WAV、AAC / M4A 至少完成一次发布目标平台的可听 smoke；其余格式只按自动矩阵逐项声明。
- 临时队列的非递归、只读、会话内边界得到验证。
- 歌词 / 封面存在和缺失后备得到验证，不残留上一首资源。
- 原始失败路径、相邻正常路径和恢复路径都被覆盖；不接受隐藏错误、无界重试或延时掩盖。
- 报告确认未实现递归扫描、媒体库、数据库、持久队列、产品级播放列表、网络存储、FFmpeg 运行时或插件系统。
- SP-016、SP-017 分别得到“可 Done”或“退回并附重测条件”的结论。
- 报告说明 v0.1 是否可以进入 SP-013 PM 复盘。

## 证据记录格式

每个检查项使用以下字段：

| 字段 | 要求 |
| --- | --- |
| Case ID | 稳定编号，例如 `V01-AUDIO-PLAY-001` |
| Commit / Environment | commit SHA、工作区、OS / 架构、工具与设备 |
| Input | fixture ID、路径、容器 / codec、SHA-256 |
| Steps | 可由另一执行者重复的编号步骤 |
| Expected / Actual | 具体状态、错误码、时间或可听结果 |
| Result | Pass / Fail / Blocked |
| Evidence | 日志、截图、视频或命令输出的仓库内 / CI 路径 |
| Owner / Retest | 失败归属 Agent、修复任务和重测条件 |
| Residual risk | 未覆盖平台、设备、格式或时序风险 |

## 风险

- 声卡和设备切换证据受本机硬件限制；无法复现时必须标 Blocked / residual risk。
- 有损格式 seek 不应使用 PCM bit-exact 作为唯一标准，应引用兼容性报告规定的误差口径。
- 兼容性生成依赖 FFmpeg / CMake；缺失工具不能被静默跳过。
- 人工“听到了声音”不足以证明状态、队列、错误恢复和制品版本正确。

## 备注

SP-016、SP-017 已有实现候选，本任务已解除代码依赖阻塞并处于 `ready`；最终执行应以 SP-021 对齐后的契约为准。本任务替代 SP-011，不得再创建第二份同类总报告。
