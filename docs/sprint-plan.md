# Sprint Plan

## Sprint Goal

完成 SpMusic v0.1「项目地基阶段」：将当前 Tauri + React + TypeScript 模板项目收敛为一个可运行、可验证、边界清晰的本地优先桌面音乐播放器雏形。

本轮不追求真实音频播放，不实现媒体库、数据库或插件系统；重点是确认 MVP 范围、建立基础工程验证链路、完成静态播放器主界面、打通最小前后端通信，并形成后续迭代可依赖的文档与验收标准。

## Current State

- 项目已具备 Tauri 2 + React + TypeScript + Vite 基础结构。
- `package.json` 已包含 `dev`、`build`、`lint`、`tauri` 脚本。
- `src/App.tsx` 仍为 Vite/React 默认示例页面。
- `src-tauri/src/lib.rs` 仅包含 Tauri 默认启动逻辑，尚无业务 command。
- `docs/` 目录尚未建立，本文件为首个阶段计划文档。
- `README.md` 仍为模板说明，尚未反映 SpMusic 产品目标。

## Scope

- 建立 v0.1 MVP 边界文档，明确本轮做什么和不做什么。
- 将默认模板界面替换为 SpMusic 静态播放器主界面。
- 定义并使用最小 `PlayerState` 前端状态模型。
- 使用假歌曲数据展示播放队列或歌曲列表。
- 实现播放 / 暂停 / 上一首 / 下一首的 UI 状态切换，不接入真实音频。
- 增加一个最小 Tauri command，用于验证 React 到 Rust 的调用链路。
- 建立基础质量门禁：TypeScript 构建、ESLint、Rust `cargo check`、Tauri dev 启动验证。
- 更新项目 README，使其说明当前阶段目标、运行方式和已知限制。

## Out of Scope

- 真实音频解码、播放、暂停、进度控制和音量控制。
- 文件系统扫描、媒体库导入、元数据解析和封面提取。
- 数据库存储、缓存层、迁移系统。
- 插件系统、插件市场、主题编辑器或扩展运行时。
- 在线音乐搜索、账号系统、云同步、Last.fm 等在线服务。
- 高级音频 DSP、均衡器、可视化效果。
- 复杂应用架构、过度抽象的模块系统。
- shadcn/ui 完整接入；如需 UI 组件，本轮只允许按需、最小化引入。

## Tasks

### SP-001: Define v0.1 MVP Requirements

- **Priority**: P0
- **Owner Agent**: Requirements Agent
- **Description**: 建立 `docs/requirements.md`，明确 v0.1 的功能需求、非功能需求、MVP 范围、暂不实现范围和核心用户场景。
- **Acceptance Criteria**:
  - `docs/requirements.md` 存在。
  - 文档包含功能需求、非功能需求、MVP Scope、Out of Scope、User Scenarios 五个章节。
  - 明确说明 v0.1 不包含真实音频播放、媒体库、数据库、插件系统和在线服务。
  - 至少定义 3 个可验证用户场景：启动应用、查看假歌曲列表、切换播放 UI 状态。
- **Dependencies**: 无。

### SP-002: Establish Roadmap and Release Boundary

- **Priority**: P0
- **Owner Agent**: Documentation Agent
- **Description**: 建立 `docs/roadmap.md` 和 `docs/release-plan.md`，将 v0.1、v0.2、v0.3 的阶段目标粗粒度拆开，避免 v0.1 被未来功能侵入。
- **Acceptance Criteria**:
  - `docs/roadmap.md` 存在，并至少包含 v0.1、v0.2、v0.3 三个阶段。
  - `docs/release-plan.md` 存在，并包含 v0.1 发布内容、发布前检查清单和不发布内容。
  - 真实音频播放、媒体库、插件系统被明确放入后续版本或 Deferred。
- **Dependencies**: SP-001。

### SP-003: Replace Template UI with Static Player Shell

- **Priority**: P1
- **Owner Agent**: UI/UX Agent + Frontend Agent
- **Description**: 将当前 Vite/React 默认页面替换为 SpMusic 静态播放器主界面，包括应用标题、歌曲信息区、播放控制区、假歌曲列表和空状态预留。
- **Acceptance Criteria**:
  - 页面中不再出现 Vite、React 默认模板文案或外链入口。
  - 首屏展示 SpMusic 品牌名称或应用名称。
  - 界面包含当前歌曲标题、艺术家、专辑或时长中的至少 3 类展示信息。
  - 界面包含播放 / 暂停、上一首、下一首三个可点击控制。
  - 歌曲列表至少展示 5 条假数据。
  - `npm run build` 通过。
- **Dependencies**: SP-001。

### SP-004: Define Minimal PlayerState and UI-only Playback Behavior

- **Priority**: P1
- **Owner Agent**: Frontend Agent
- **Description**: 在前端定义最小 `PlayerState`，驱动当前歌曲、高亮歌曲、播放 / 暂停状态和上一首 / 下一首切换。所有行为仅改变 UI 状态，不接入音频。
- **Acceptance Criteria**:
  - 存在类型定义或等价结构，表达 `currentTrackId`、`isPlaying`、`queue`。
  - 点击播放 / 暂停按钮会切换 `isPlaying` 并更新按钮状态或图标。
  - 点击上一首 / 下一首会切换当前歌曲，并在列表中体现当前歌曲状态。
  - 队列为空时存在可渲染的 Empty State 分支。
  - 不引入真实音频 API，不使用 `HTMLAudioElement` 播放文件。
  - `npm run lint` 和 `npm run build` 通过。
- **Dependencies**: SP-003。

### SP-005: Add Minimal Tauri Command for Frontend-Backend Verification

- **Priority**: P1
- **Owner Agent**: Rust/Tauri Agent + Frontend Agent
- **Description**: 增加一个最小 Rust command，例如返回应用状态或固定问候信息，用于验证 React 调用 Tauri command 的链路。
- **Acceptance Criteria**:
  - Rust 侧存在一个可被前端调用的 Tauri command。
  - 前端启动后能调用该 command，并在界面中展示返回结果或连接状态。
  - command 不访问文件系统、不扫描音乐、不播放音频。
  - `cargo check` 在 `src-tauri/` 下通过。
  - `npm run tauri dev` 可启动应用并完成一次 command 调用验证。
- **Dependencies**: SP-003。

### SP-006: Establish Engineering Verification Checklist

- **Priority**: P1
- **Owner Agent**: Test Agent
- **Description**: 建立本阶段的基础验收清单，覆盖前端构建、Lint、Rust 检查、Tauri 启动和核心 UI 行为人工验证。
- **Acceptance Criteria**:
  - `docs/release-plan.md` 或独立检查章节中记录 v0.1 验证命令。
  - 检查清单至少包含 `npm run lint`、`npm run build`、`cargo check`、`npm run tauri dev`。
  - 每项检查说明通过标准。
  - 明确记录 UI 行为验证项：播放 / 暂停、上一首 / 下一首、当前歌曲高亮、后端连接状态。
- **Dependencies**: SP-003、SP-004、SP-005。

### SP-007: Update README for Project Identity and Local Startup

- **Priority**: P1
- **Owner Agent**: Documentation Agent
- **Description**: 将模板 README 更新为 SpMusic 项目说明，包含项目定位、当前阶段、运行方式、质量检查命令和暂不支持事项。
- **Acceptance Criteria**:
  - `README.md` 标题和介绍反映 SpMusic，而非 React + TypeScript + Vite 模板。
  - README 包含本地开发启动命令和 Tauri 启动命令。
  - README 明确当前版本不支持真实音频播放、媒体库和插件系统。
  - README 指向 `docs/sprint-plan.md`、`docs/requirements.md`、`docs/roadmap.md`。
- **Dependencies**: SP-001、SP-002。

### SP-008: Sprint Review and Scope Gate

- **Priority**: P0
- **Owner Agent**: PM Agent
- **Description**: 在 v0.1 地基任务完成后，基于验收结果决定是否进入下一阶段，记录范围偏差、技术债和后续优先级。
- **Acceptance Criteria**:
  - `docs/retrospectives/` 目录存在。
  - 新增一份 v0.1 Sprint Review / Retrospective 文档。
  - 文档记录已完成项、未完成项、验收结果、已知风险、是否允许进入 v0.2。
  - 若存在超出范围的实现，必须标记并给出回退或延期建议。
- **Dependencies**: SP-001 至 SP-007。

## Risks

- **R-001: 模板残留风险**  
  当前 README 与前端页面仍是模板内容，若不优先清理，会影响项目目标表达和验收判断。

- **R-002: 范围膨胀风险**  
  音乐播放器天然容易滑向真实播放、媒体库、封面、歌词、插件等功能；本轮必须把这些能力放入 Out of Scope 或后续版本。

- **R-003: Tauri 调用链路不确定性**  
  当前 Rust 侧尚无 command，前后端通信未验证；SP-005 是本轮核心地基任务。

- **R-004: 质量门禁尚未跑通**  
  虽然脚本已存在，但需要实际验证 `npm run lint`、`npm run build`、`cargo check` 和 `npm run tauri dev`。

- **R-005: UI 过早复杂化**  
  v0.1 只需要静态播放器壳和 UI 状态，不应引入复杂设计系统、动画体系或主题编辑能力。

## Definition of Done

- `docs/requirements.md`、`docs/roadmap.md`、`docs/release-plan.md`、`docs/sprint-plan.md` 均存在并互相一致。
- README 已从模板说明更新为 SpMusic 项目说明。
- 应用启动后首屏为 SpMusic 播放器界面，不再是 Vite/React 默认页面。
- 前端能够展示假歌曲队列，并支持播放 / 暂停 / 上一首 / 下一首的 UI 状态切换。
- 前端能够成功调用至少一个 Tauri command，并展示连接结果。
- `npm run lint` 通过。
- `npm run build` 通过。
- 在 `src-tauri/` 下执行 `cargo check` 通过。
- `npm run tauri dev` 能启动桌面应用。
- 未实现真实音频播放、媒体库、数据库、插件系统或在线服务。
- 完成 v0.1 Sprint Review，并由 PM Agent 明确是否进入 v0.2。
