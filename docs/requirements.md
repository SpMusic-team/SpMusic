---
doc_id: "REQ-INDEX"
title: "SpMusic 需求索引"
doc_type: "requirements-index"
status: "active"
owner_agent: "PM Agent"
version_scope: "project"
created: "2026-07-09"
updated: "2026-10-01"
source_documents:
  - "docs/requirements/v0-1-foundation.md"
  - "docs/requirements/v0-2-playlist-ui-prototype.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
  - "docs/decisions/2026-07-27-v0-1-local-m3u8-temporary-queue.md"
  - "user request: CC 图标是桌面字幕开关，不是翻译功能"
  - "docs/requirements/all-business-plugin-system.md"
  - "docs/decisions/2026-09-30-all-business-plugin-system-goal.md"
  - "docs/architecture/plugin-host-design.md"
  - "docs/decisions/2026-09-30-plugin-host-architecture.md"
  - "docs/test/plugin-host-design-review.md"
---
# SpMusic 需求索引

## 摘要

本文件是 SpMusic 的需求总览与版本范围索引。2026-07-24 起，v0.1 从 UI-only 播放界面调整为真实本地播放；2026-07-27 又对仓库中已存在的同目录临时队列、嵌入式歌词 / 封面和格式兼容性证据做了范围收口。旧需求正文仍由 Requirements Agent 维护，SP-020 负责重整；在完成前，PM 范围决策只作为执行和验收边界，不冒充 Requirements Agent 对需求正文的批准。

SpMusic 的长期定位是：美观、高性能、有扩展能力的本地优先桌面音乐播放器。产品不做在线音乐平台、在线曲库搜索、内容推荐或版权音乐服务；核心价值是管理和播放用户自有的本地与网络存储音频内容。

2026-09-30 确认全业务插件化长期目标：参考 dsh/Cordis 建立较完善的宿主框架，全部业务遵守统一插件规则，官方基础插件随产品交付并由默认组合保障基础体验。此目标覆盖旧“插件只能增强”的长期限制；当前代码尚不是该插件系统，v0.1 的插件排除范围继续有效，实施版本和日期未定。

2026-10-01 架构设计基线形成，产品实现与运行验证未完成。技术路线为 Rust 全局治理、选择性 Cordis 核心适配与多执行环境；G1～G5 尚未取得运行验证证据，精确依赖与执行引擎、平台限制及量化预算仍按闸门验证，不改变完整需求的最终验收范围。

## 来源文档

| 文档 | 状态 | 用途 |
| --- | --- | --- |
| `docs/requirements/v0-1-foundation.md` | 历史 v0.1 基础需求 | UI-only 播放界面的原始范围，已被 2026-07-24 范围变更部分覆盖 |
| `docs/decisions/2026-07-24-v0-1-real-audio-scope.md` | Accepted | v0.1 真实播放范围变更的当前依据 |
| `docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md` | Accepted | 已实现临时队列、歌词 / 封面、兼容性能力的收口与验收边界 |
| `docs/decisions/2026-07-27-v0-1-local-m3u8-temporary-queue.md` | Accepted | 本地 `.m3u8` 临时队列例外；不等于 HLS 或产品级播放列表 |
| `docs/requirements/v0-2-playlist-ui-prototype.md` | Approved for v0.2 candidate | 播放列表 UI 候选范围 |
| [全业务插件化需求](requirements/all-business-plugin-system.md) | 长期目标已确认；实施未排期 | 全部业务插件化、完整宿主能力和最终验收范围 |
| [全业务插件化目标决策](decisions/2026-09-30-all-business-plugin-system-goal.md) | Accepted，long-term | 替代旧长期增强限制；保留版本边界，明确阶段目标和下一步设计闸门 |
| [插件宿主与跨端契约设计](architecture/plugin-host-design.md) | 架构设计基线；运行待验证 | 服务权威、依赖与生命周期、权限、跨端协议、PH-01～PH-11 和全量业务迁移映射 |
| [插件宿主技术路线决策](decisions/2026-09-30-plugin-host-architecture.md) | Accepted，long-term-design | Rust 全局治理、选择性 Cordis 适配、多执行环境及 G1～G5 失败处理；不批准实施排期 |
| [插件宿主设计独立审查](test/plugin-host-design-review.md) | 设计阶段无阻塞；产品运行证据不足 | 设计覆盖与契约反例复核，记录 PH/AC 后续验证证据；不等于产品验收通过 |

## 当前目标版本：v0.1 真实本地播放可发布闭环

v0.1 当前目标是：把已经存在的真实播放实现收敛为有边界、有综合验证、有 Tauri 制品和可追溯证据的发布候选。

### v0.1 范围

- 播放器界面和基础播放控制。
- 最小 Tauri command 契约。
- Rust/Tauri 真实音频播放后端。
- 本地音频资源播放、暂停、继续、停止、seek 和进度状态。
- 前端接入真实播放 command。
- 用户选中文件后，对同目录受支持音频进行非递归、只读枚举，并形成不持久化的临时队列。
- 用户选择 `.m3u8` 文件时，可将其中受支持的本地音频转换为当前会话临时队列；本地绝对路径允许指向 `.m3u8` 所在目录之外。缺失的受支持本地音频仍显示在队列中，按顺序播放遇到缺失项时提示“歌曲未找到”并跳到下一首。
- 临时队列的上一首、下一首、直接选择和自然结束切换。
- 基础标签及嵌入式歌词 / 封面的读取展示与缺失后备。
- 有确定性语料证据的格式兼容性基线。
- 后端不可用、无效路径、不可播放文件等最小错误状态。
- 自动检查、人工播放、Tauri 构建、制品 smoke 和版本一致性报告。

### v0.1 不做

- 递归扫描、媒体库、文件监控、数据库和持久化索引。
- 产品级播放列表、临时队列持久化、跨目录队列、播放历史、收藏、网络 HLS 和完整 `m3u8` 导入导出。
- 网络 / sidecar / 逐字歌词、歌词 / 封面 / 标签编辑。
- 电脑系统级桌面字幕浮层、置顶字幕窗口、焦点穿透、跨显示器字幕显示和对应系统 API。
- CUE / M4B 公共交互、FFmpeg 运行时 fallback 和跨曲目 gapless。
- 网络存储播放。
- 真实频谱分析、高级 DSP、独占输出。
- 插件系统、在线服务或账号系统。

## 需求状态

| ID | 需求 | 优先级 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| REQ-FOUNDATION-001 | 去模板化与文档地基 | P0 | Done | `docs/requirements/v0-1-foundation.md` |
| REQ-FOUNDATION-002 | 播放界面 | P1 | Done | `docs/requirements/v0-1-foundation.md` |
| REQ-FOUNDATION-003 | UI-only 播放状态模型 | P1 | Superseded by real playback | `docs/decisions/2026-07-24-v0-1-real-audio-scope.md` |
| REQ-FOUNDATION-004 | 基础工程验收 | P1 | Approved; release gates expanded by PM decision | `docs/requirements/v0-1-foundation.md` |
| REQ-FOUNDATION-005 | UI-only 进度条与演示频谱 | P1 | Superseded for playback progress | `docs/decisions/2026-07-24-v0-1-real-audio-scope.md` |
| REQ-AUDIO-001 | 真实本地音频播放 | P0 | Implemented candidate; verification pending | `docs/decisions/2026-07-24-v0-1-real-audio-scope.md` |
| REQ-AUDIO-002 | 同目录只读临时队列 | P0 | PM scope accepted; Requirements reconciliation pending SP-020 | `docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md` |
| REQ-M3U8-TEMP-001 | 本地 `.m3u8` 临时队列导入 | P0 | Accepted as v0.1 temporary exception; not HLS | `docs/decisions/2026-07-27-v0-1-local-m3u8-temporary-queue.md` |
| REQ-METADATA-001 | 基础标签与嵌入式歌词 / 封面展示 | P1 | PM scope accepted; Requirements reconciliation pending SP-020 | `docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md` |
| REQ-CAPTIONS-001 | 电脑系统级桌面字幕显示开关 | P3 | Deferred; v0.1 only allows visual control boundary | user correction on `CC` control semantics |
| REQ-COMPAT-001 | 当前解码格式兼容性基线 | P1 | Evidence present; v0.1 verification pending | `docs/audio-compatibility/format-capability-matrix.md` |
| REQ-PLAYLIST-UI-001 | 虚构播放列表管理 UI | P2 | Candidate for v0.2 | `docs/requirements/v0-2-playlist-ui-prototype.md` |
| REQ-LIBRARY-001 | 本地音乐库与文件夹扫描 | P1 | Deferred | long-term requirements |
| REQ-QUEUE-001 | 可管理 / 持久化播放队列 | P1 | Deferred after v0.1; excludes v0.1 read-only folder queue | long-term requirements |
| REQ-PLAYLIST-001 | 播放列表与 `m3u8` 支持 | P1 | Deferred | long-term requirements |
| REQ-NETWORK-001 | FTP / SMB / WebDAV 网络存储播放 | P2 | Deferred | long-term requirements |
| REQ-PLUGIN-001 | 全业务插件体系与较完善宿主框架 | P3（相对当前 v0.1） | 长期目标已确认；架构设计基线形成；产品实现与运行验证未完成，实施未排期 | [单项需求](requirements/all-business-plugin-system.md)、[目标决策](decisions/2026-09-30-all-business-plugin-system-goal.md)、[宿主设计](architecture/plugin-host-design.md)、[设计审查](test/plugin-host-design-review.md) |
| REQ-UI-CUSTOMIZATION-001 | 用户视觉自定义与动效配置 | P2 | In progress in frontend theme system | user-approved theme work |

## 全业务插件化范围决策摘要

- `REQ-PLUGIN-001` 的 P3 表示未进入当前 v0.1 版本计划，不表示最终只做可选增强；长期目标的确认和实施的排期分别记录。
- 全部现有业务最终迁移为官方插件；媒体库、网络等后续业务在单独批准后遵守同一规则，本次不顺带批准新业务功能。
- 官方基础插件随产品交付，用户无需额外安装；可选插件停用不破坏默认基础能力，必要插件的停用与替换按已审查规则处理。
- 十一类宿主能力及三个阶段的完整覆盖以 Requirements Agent 的单项需求和 PM 目标决策为依据；本次不创建实施任务卡，不调整 Sprint 或历史版本候选路线。
- 架构设计基线已形成：Rust 是全局治理权威，Cordis 仅作为可替换的可信 TS 适配，第三方采用受限 runner；设计独立审查已消除设计阻塞。设计覆盖不作为 PH-01～PH-11 或 AC-01～AC-16 的实现与运行完成证据。
- 下一步为 G1～G5 选型验证原型与实现任务拆分：G1 Cordis 制品/浏览器/生命周期，G2 第三方执行与权限，G3 装配及安装迁移事务，G4 音频基线/数据面/资源与替换，G5 默认全业务装配/兼容与回归。全部闸门尚未运行验证，具体依赖、平台限制、签名方案和量化预算在对应闸门冻结；本次不生成任务卡或承诺实施排期。

## 待路由问题

- Requirements Agent 在 SP-020 中重整 v0.1 需求正文，解决旧 UI-only 要求与当前两项范围决策的冲突。
- Architecture Agent 在 SP-021 中对齐 `audio_list_folder_tracks`、元数据 DTO、状态事件和架构文档；Test Agent 不在验证中静默改写契约。
- SP-016、SP-017 处于 `in-review`；只有 SP-018 综合证据通过后才能判 Done。
- SP-018 是唯一综合验证入口；SP-011 已被替代。
- SP-019 负责版本、Tauri 构建和实际制品 smoke；当前 `package.json` 与 Tauri / Cargo 版本不一致。
