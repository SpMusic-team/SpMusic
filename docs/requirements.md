# SpMusic 需求索引

## 摘要

本文件是 SpMusic 的需求总览与版本范围索引。最终产品需求来源为 `docs/requirements/总需求分析.md`；具体版本必须从总需求中切出可执行、可验收的子范围。

SpMusic 的长期定位是：美观、高性能、有强大扩展能力的本地优先桌面音乐播放器。产品不做在线音乐平台、在线曲库搜索、内容推荐或版权音乐服务；核心价值是管理和播放用户自有的本地与网络存储音频内容。

## 来源文档

| 文档 | 状态 | 用途 |
| --- | --- | --- |
| `docs/requirements/总需求分析.md` | 已接受为产品方向 | 最终产品定位、能力分层、范围边界和开放问题 |
| `docs/requirements/v0-1-foundation.md` | 已批准为 v0.1 版本需求 | 播放界面阶段的需求、非目标和验收标准 |
| `docs/requirements/v0-2-playlist-ui-prototype.md` | 已批准为 v0.2 版本候选需求 | 虚构播放列表展示、增删改、排序、歌单内歌曲排序、跨列表加入歌曲、删除歌单内条目和详情联动的需求边界 |
| `docs/requirements/playback-queue.md` | 待评审 | 内置播放队列、歌单默认队列和下一首播放规则 |

## 长期产品边界

### 长期范围

- 本地优先桌面音乐播放器。
- 真实本地音频播放。
- 本地音乐库、文件夹扫描、索引和分类浏览。
- 按文件夹范围浏览歌曲、艺术家和专辑。
- 播放队列、播放列表、`m3u8` 导入导出、基础搜索、收藏、播放历史。
- FTP、SMB、WebDAV 等用户自有网络存储播放。
- 现代、美观、流畅、触控友好的 UI。
- 明暗模式、多语言适配、性能档位和可扩展外观能力。
- 后续高级能力：歌词、封面、元数据编辑、独占音频输出、智能播放列表、Scrobbler、云同步适配、自定义功能区、插件增强。

### 长期不做

- 在线音乐平台。
- 在线曲库搜索。
- 内置云曲库。
- 音乐内容推荐平台。
- 音乐版权内容服务。
- 以账号体系为核心前提的产品模式。
- 强制联网才能使用核心播放、音乐库、播放列表或网络存储播放。

## 当前目标版本：v0.1 播放界面

v0.1 的目标不是实现完整播放器，也不验证真实音频链路，而是将当前 Tauri + React + TypeScript 模板项目收敛为可运行、可验证、边界清晰的 SpMusic 播放界面。

### v0.1 范围

- 去除模板项目主内容，启动后直接进入 SpMusic 播放界面。
- 播放界面：展示当前歌曲信息和基础播放控制。
- 播放 / 暂停 / 上一首 / 下一首的前端 UI 状态切换。
- 最小 `PlayerState` 或等价状态结构。
- 最小 `Track` 或等价假歌曲结构。
- 空歌曲列表 Empty State。
- 基础工程验收命令和人工检查清单。
- README、路线图、发布计划、任务卡和复盘入口。

### v0.1 不做

- 真实音频播放、音量控制、进度拖动和音频解码。
- 本地文件读取、文件夹选择和文件系统扫描。
- 文件夹扫描、媒体库索引、元数据解析、封面、歌词。
- 数据库、缓存层、迁移系统和持久化媒体库。
- 最小 Tauri command 或前后端通信验证。
- FTP、SMB、WebDAV 网络存储播放。
- 虚构播放列表管理 UI。
- 播放列表真实创建、编辑、删除、导入导出。
- 插件系统、插件市场、扩展运行时。
- Last.fm、Pano Scrobbler、云同步、自定义功能区。

## 需求状态

| ID | 需求 | 优先级 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| REQ-FOUNDATION-001 | 去模板化与文档地基 | P0 | Approved | `docs/requirements/v0-1-foundation.md` |
| REQ-FOUNDATION-002 | 播放界面 | P1 | Approved | `docs/requirements/v0-1-foundation.md` |
| REQ-FOUNDATION-003 | UI-only 播放状态模型 | P1 | Approved | `docs/requirements/v0-1-foundation.md` |
| REQ-FOUNDATION-004 | 基础工程验收 | P1 | Approved | `docs/requirements/v0-1-foundation.md` |
| REQ-PLAYLIST-UI-001 | 虚构播放列表管理 UI | P1 | Approved for v0.2 | `docs/requirements/v0-2-playlist-ui-prototype.md` |
| REQ-AUDIO-001 | 真实本地音频播放 | P1 | Deferred | `docs/requirements/总需求分析.md` |
| REQ-LIBRARY-001 | 本地音乐库与文件夹扫描 | P1 | Deferred | `docs/requirements/总需求分析.md` |
| REQ-QUEUE-001 | 内置播放队列与下一首播放 | P1 | In Review | `docs/requirements/playback-queue.md` |
| REQ-PLAYLIST-001 | 播放列表与 `m3u8` 支持 | P1 | Deferred | `docs/requirements/总需求分析.md` |
| REQ-NETWORK-001 | FTP / SMB / WebDAV 网络存储播放 | P2 | Deferred | `docs/requirements/总需求分析.md` |
| REQ-PLUGIN-001 | 插件增强体系 | P3 | Deferred | `docs/requirements/总需求分析.md` |

## 待路由问题

- 真实音频播放底层方案应由 Architecture Agent 先评估。
- 内置播放队列、播放历史、真实播放列表和音频引擎之间的状态边界应由 Architecture Agent 评估。
- 网络存储播放是否和本地音乐库共享来源抽象，应由 Architecture Agent 评估。
- `m3u8` 扩展信息保存位置应由 Requirements Agent 与 Architecture Agent 单独分析。
- 同人音声长音频、章节、作品维度和社团维度是否进入早期版本，应由 Requirements Agent 单独分析。
- 自定义功能区、置顶窗口和插件 API 的边界应延期到基础能力稳定后再评估。
