---
doc_id: "SPRINT-V0-1"
title: "v0.1 Sprint 计划"
doc_type: "sprint-plan"
status: "active"
owner_agent: "PM Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-27"
source_documents:
  - "docs/requirements/v0-1-foundation.md"
  - "docs/requirements.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
  - "docs/decisions/2026-07-27-v0-1-local-m3u8-temporary-queue.md"
  - "user request: 根据评审调整并修复 v0.1 任务"
  - "user request: 临时支持 .m3u8"
  - "user request: 砍掉选择文件夹功能；直接选择 .m3u8 文件时允许本地绝对路径指向别的目录"
---
# Sprint 计划

## Sprint 目标

完成 SpMusic v0.1“真实本地播放可发布闭环”：对仓库中已经存在的单文件真实播放、同目录临时队列、嵌入式歌词 / 封面展示和格式兼容性实现进行范围收口、综合验证、制品构建、制品 smoke 与文档校准。代码存在或自动检查通过不等于版本完成。

## 范围

- 保留已完成的 SpMusic 播放器界面、主题基础和窗口壳层能力。
- 验证单文件打开 / 加载、播放、暂停、继续、停止、seek、进度同步和错误状态。
- 验证用户选中音频后，同目录非递归、只读枚举形成的会话内临时队列，以及上一首 / 下一首 / 直接选择 / 自然结束切换。
- 验证用户直接选择 `.m3u8` 文件后的本地临时队列；本地绝对路径可指向其他目录，缺失条目仍显示并在播放时提示后跳过，不声明 HLS 支持。
- 验证嵌入式基础标签、歌词和封面的展示及缺失后备状态。
- 以仓库确定性语料复跑格式探测、完整解码、duration、seek 和稳定失败检查；格式声明不得超出当次证据。
- 生成 Tauri v0.1 制品，对实际制品执行启动和真实音频 smoke。
- 校准 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和发布标签的版本一致性。
- 由 Documentation Agent 在综合验证结论后更新 README，不提前声明未验收能力。

## 不在范围内

- 递归文件夹扫描、增量索引、文件监控、数据库、媒体库和元数据批量入库。
- 播放列表真实创建、编辑、删除、导入导出、网络 HLS 与完整 `m3u8` 支持。
- 临时队列持久化、跨目录队列管理、播放历史、收藏和进度持久化。
- 网络 / sidecar 歌词、逐字歌词、歌词或封面编辑、标签编辑 UI。
- 网络存储播放、在线音乐服务、账号系统、云同步。
- CUE / M4B 公共交互、FFmpeg 运行时 fallback、跨曲目 gapless。
- 真实频谱分析、高级 DSP、独占输出、插件系统。
- 无实机证据的平台发布认证。

## 已完成基线

| 任务 ID | 标题 | 优先级 | 负责 Agent | 状态 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| SP-001 | v0.1 版本需求分析与验收边界 | P0 | Requirements Agent | Done | `docs/requirements/总需求分析.md` |
| SP-002 | 需求索引、路线图与发布边界 | P0 | PM Agent | Done | SP-001 |
| SP-003 | 播放界面 UI 规格 | P1 | UI/UX Agent | Done | SP-001 |
| SP-004 | 总体架构蓝图与播放器状态结构 | P1 | Architecture Agent | Done | SP-001 |
| SP-005 | 前端基础骨架与实现约束 | P1 | Frontend Agent | Done | SP-004 |
| SP-006 | shadcn/ui 基础接入与前端样式基线 | P1 | Frontend Agent | Done | SP-005 |
| SP-007 | 最小播放界面实现 | P1 | Frontend Agent | Done | SP-005, SP-006 |
| SP-008 | 播放界面视觉与交互修正 | P1 | Frontend Agent | Done | SP-003, SP-007 |
| SP-015 | v0.1 真实播放架构契约 | P0 | Architecture Agent | Done | `docs/decisions/2026-07-24-v0-1-real-audio-scope.md` |

## 活跃发布收口任务

| 任务 ID | 标题 | 优先级 | 负责 Agent | 状态 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| SP-016 | Rust/Tauri 最小真实音频播放后端 | P0 | Rust/Tauri Agent | In review | SP-015；由 SP-018 验收 |
| SP-017 | 前端接入真实播放 command | P0 | Frontend Agent | In review | SP-015, SP-016 实现候选；由 SP-018 验收 |
| SP-021 | v0.1 真实播放架构契约对齐 | P0 | Architecture Agent | Ready | 2026-07-27 范围决策、当前实现候选 |
| SP-018 | v0.1 综合真实播放与能力边界验证 | P0 | Test Agent | Ready | SP-016、SP-017 实现候选；SP-021 最终契约 |
| SP-019 | v0.1 制品、版本一致性与制品 smoke | P0 | PM Agent（协调） | Ready | SP-018 |
| SP-020 | v0.1 需求基线重整 | P1 | Requirements Agent | Ready | 两项 v0.1 范围决策 |
| SP-010 | README 当前能力与限制收口 | P1 | Documentation Agent | Ready | 可先起草；最终结论依赖 SP-018、SP-019、SP-020 |
| SP-013 | Sprint 复盘与发布范围闸门 | P0 | PM Agent | Blocked | SP-010, SP-018, SP-019, SP-020 |

## 已移出或被替代任务

- SP-009：`deferred`，保留为 v0.2 产品级播放列表 / 队列需求入口，不计入 v0.1。
- SP-014：`deferred`，保留为 future 外观自定义预研入口，不计入 v0.1。
- SP-011：`superseded`，验证职责和报告统一并入 SP-018。
- SP-012：`superseded`，README 与开发说明统一并入 SP-010。
- AC-001：属于独立音频兼容性工作流，当前为 `in-review`；其证据可被 SP-018 引用，但任务本身不计入 v0.1 Sprint 完成率。

## 风险

- SP-016、SP-017 已有实现记录但尚无被 Test Agent 接受的完整人工播放证据，误标 Done 会掩盖声卡、设备切换、格式和 UI 状态风险。
- 当前 `package.json` 为 `0.0.0`，而 Tauri 配置和 Cargo package 为 `0.1.0`；版本不一致会阻塞发布。
- 自动解码测试不初始化真实声卡，不能替代开发运行和发布制品的可听播放 smoke。
- 文件扩展名、probe、解码、seek、元数据和实际播放的支持维度不同，文档若混写会过度承诺。
- 同目录浅层枚举容易被误解为媒体库或产品级播放列表；任何递归、持久化、编辑或跨目录扩展都必须另立需求。
- 嵌入式歌词 / 封面可能缺失、损坏或体积异常；验收必须覆盖后备状态和不崩溃，不要求网络补全。
- 当前兼容性和性能证据以 Windows x64 为主，不能据此外推其他平台。
- SP-015 架构契约尚未记录同目录临时队列 command / DTO 和当前事件 / 元数据细节，SP-021 必须先消除文档与实现偏差。
- `npm run tauri build` 可能暴露只在 release profile、bundle 或安装制品中出现的问题。

## 完成定义

- 范围：两项 v0.1 范围决策均为 `accepted`，Requirements Agent 已通过 SP-020 重整需求基线。
- 架构：SP-021 已记录临时队列 command / DTO、元数据低频传输、状态事件、格式声明和范围护栏。
- 前端：`npm run lint`、`npm run build` 在记录的 commit 上退出码为 0。
- 后端：`cargo fmt -- --check`、`cargo check`、`cargo test` 在记录的 commit 上退出码为 0。
- 兼容性：语料自检、清单校验和本轮批准矩阵复跑通过；报告逐项区分 probe、decode、duration、seek、metadata 与实际播放。
- 开发运行：`npm run tauri dev` 能启动；人工验证播放、暂停、继续、seek、停止、错误状态、同目录临时队列切换、歌词 / 封面存在与缺失后备。
- 制品：`npm run tauri build` 成功，报告记录制品路径、文件名、SHA-256、大小和构建环境。
- 制品 smoke：从生成的 v0.1 制品启动应用并完成至少一次 MP3、FLAC、WAV、AAC / M4A 代表样本的打开与可听播放；记录预期、实际和失败信号。
- 版本：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、制品版本和拟发布 tag 一致为 `0.1.0`。
- 文档：SP-010 依据 SP-018 / SP-019 结论更新 README；未验证能力不得写成已支持。
- 证据：所有命令、人工步骤和制品 smoke 都记录 commit SHA、工作区状态、OS / 架构、工具版本、输入 fixture ID / SHA-256、时间、退出码或截图 / 日志位置。
- 边界：未引入递归扫描、媒体库、数据库、持久队列、产品级播放列表、网络 HLS、网络存储、FFmpeg 运行时或插件系统；本地 `.m3u8` 仅作为当前会话临时队列输入。
- 只有以上门槛全部通过，PM Agent 才能在 SP-013 中把 v0.1 判为可发布。
