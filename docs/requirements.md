---
doc_id: "REQ-INDEX"
title: "SpMusic 需求索引"
doc_type: "requirements-index"
status: "active"
owner_agent: "PM Agent"
version_scope: "project"
created: "2026-07-09"
updated: "2026-07-27"
source_documents:
  - "docs/requirements/v0-1-foundation.md"
  - "docs/requirements/v0-2-playlist-ui-prototype.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
  - "docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md"
  - "user request: CC 图标是桌面字幕开关，不是翻译功能"
---
# SpMusic 需求索引

## 摘要

本文件是 SpMusic 的需求总览与版本范围索引。2026-07-24 起，v0.1 从 UI-only 播放界面调整为真实本地播放；2026-07-27 又对仓库中已存在的同目录临时队列、嵌入式歌词 / 封面和格式兼容性证据做了范围收口。旧需求正文仍由 Requirements Agent 维护，SP-020 负责重整；在完成前，PM 范围决策只作为执行和验收边界，不冒充 Requirements Agent 对需求正文的批准。

SpMusic 的长期定位是：美观、高性能、有扩展能力的本地优先桌面音乐播放器。产品不做在线音乐平台、在线曲库搜索、内容推荐或版权音乐服务；核心价值是管理和播放用户自有的本地与网络存储音频内容。

## 来源文档

| 文档 | 状态 | 用途 |
| --- | --- | --- |
| `docs/requirements/v0-1-foundation.md` | 历史 v0.1 基础需求 | UI-only 播放界面的原始范围，已被 2026-07-24 范围变更部分覆盖 |
| `docs/decisions/2026-07-24-v0-1-real-audio-scope.md` | Accepted | v0.1 真实播放范围变更的当前依据 |
| `docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md` | Accepted | 已实现临时队列、歌词 / 封面、兼容性能力的收口与验收边界 |
| `docs/requirements/v0-2-playlist-ui-prototype.md` | Approved for v0.2 candidate | 播放列表 UI 候选范围 |

## 当前目标版本：v0.1 真实本地播放可发布闭环

v0.1 当前目标是：把已经存在的真实播放实现收敛为有边界、有综合验证、有 Tauri 制品和可追溯证据的发布候选。

### v0.1 范围

- 播放器界面和基础播放控制。
- 最小 Tauri command 契约。
- Rust/Tauri 真实音频播放后端。
- 本地音频资源播放、暂停、继续、停止、seek 和进度状态。
- 前端接入真实播放 command。
- 用户选中文件后，对同目录受支持音频进行非递归、只读枚举，并形成不持久化的临时队列。
- 临时队列的上一首、下一首、直接选择和自然结束切换。
- 基础标签及嵌入式歌词 / 封面的读取展示与缺失后备。
- 有确定性语料证据的格式兼容性基线。
- 后端不可用、无效路径、不可播放文件等最小错误状态。
- 自动检查、人工播放、Tauri 构建、制品 smoke 和版本一致性报告。

### v0.1 不做

- 递归扫描、媒体库、文件监控、数据库和持久化索引。
- 产品级播放列表、临时队列持久化、跨目录队列、播放历史、收藏和 `m3u8`。
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
| REQ-METADATA-001 | 基础标签与嵌入式歌词 / 封面展示 | P1 | PM scope accepted; Requirements reconciliation pending SP-020 | `docs/decisions/2026-07-27-v0-1-implemented-capabilities-boundary.md` |
| REQ-CAPTIONS-001 | 电脑系统级桌面字幕显示开关 | P3 | Deferred; v0.1 only allows visual control boundary | user correction on `CC` control semantics |
| REQ-COMPAT-001 | 当前解码格式兼容性基线 | P1 | Evidence present; v0.1 verification pending | `docs/audio-compatibility/format-capability-matrix.md` |
| REQ-PLAYLIST-UI-001 | 虚构播放列表管理 UI | P2 | Candidate for v0.2 | `docs/requirements/v0-2-playlist-ui-prototype.md` |
| REQ-LIBRARY-001 | 本地音乐库与文件夹扫描 | P1 | Deferred | long-term requirements |
| REQ-QUEUE-001 | 可管理 / 持久化播放队列 | P1 | Deferred after v0.1; excludes v0.1 read-only folder queue | long-term requirements |
| REQ-PLAYLIST-001 | 播放列表与 `m3u8` 支持 | P1 | Deferred | long-term requirements |
| REQ-NETWORK-001 | FTP / SMB / WebDAV 网络存储播放 | P2 | Deferred | long-term requirements |
| REQ-PLUGIN-001 | 插件增强体系 | P3 | Deferred | long-term requirements |
| REQ-UI-CUSTOMIZATION-001 | 用户视觉自定义与动效配置 | P2 | In progress in frontend theme system | user-approved theme work |

## 待路由问题

- Requirements Agent 在 SP-020 中重整 v0.1 需求正文，解决旧 UI-only 要求与当前两项范围决策的冲突。
- Architecture Agent 在 SP-021 中对齐 `audio_list_folder_tracks`、元数据 DTO、状态事件和架构文档；Test Agent 不在验证中静默改写契约。
- SP-016、SP-017 处于 `in-review`；只有 SP-018 综合证据通过后才能判 Done。
- SP-018 是唯一综合验证入口；SP-011 已被替代。
- SP-019 负责版本、Tauri 构建和实际制品 smoke；当前 `package.json` 与 Tauri / Cargo 版本不一致。
