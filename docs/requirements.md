---
doc_id: "REQ-INDEX"
title: "SpMusic 需求索引"
doc_type: "requirements-index"
status: "active"
owner_agent: "PM Agent"
version_scope: "project"
created: "2026-07-09"
updated: "2026-07-24"
source_documents:
  - "docs/requirements/v0-1-foundation.md"
  - "docs/requirements/v0-2-playlist-ui-prototype.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
---
# SpMusic 需求索引

## 摘要

本文件是 SpMusic 的需求总览与版本范围索引。2026-07-24 起，v0.1 范围从 UI-only 播放界面调整为真实本地播放最小闭环；旧需求分析文档中的 UI-only 限制由新范围决策覆盖，但仍保留作为历史来源。

SpMusic 的长期定位是：美观、高性能、有扩展能力的本地优先桌面音乐播放器。产品不做在线音乐平台、在线曲库搜索、内容推荐或版权音乐服务；核心价值是管理和播放用户自有的本地与网络存储音频内容。

## 来源文档

| 文档 | 状态 | 用途 |
| --- | --- | --- |
| `docs/requirements/v0-1-foundation.md` | 历史 v0.1 基础需求 | UI-only 播放界面的原始范围，已被 2026-07-24 范围变更部分覆盖 |
| `docs/decisions/2026-07-24-v0-1-real-audio-scope.md` | Accepted | v0.1 真实播放范围变更的当前依据 |
| `docs/requirements/v0-2-playlist-ui-prototype.md` | Approved for v0.2 candidate | 播放列表 UI 候选范围 |

## 当前目标版本：v0.1 真实本地播放最小闭环

v0.1 当前目标是：在已完成播放器界面基础上，加入最小真实本地音频播放能力，让后端、Tauri command 和前端控制形成可验证闭环。

### v0.1 范围

- 播放器界面和基础播放控制。
- 最小 Tauri command 契约。
- Rust/Tauri 真实音频播放后端。
- 单个本地音频资源播放、暂停、停止和进度状态。
- 前端接入真实播放 command。
- 后端不可用、无效路径、不可播放文件等最小错误状态。
- 构建、后端检查和人工播放验证报告。

### v0.1 不做

- 媒体库、文件夹扫描、数据库和持久化索引。
- 真实播放列表、播放历史、收藏和 `m3u8`。
- 网络存储播放。
- 真实频谱分析、高级 DSP、独占输出。
- 插件系统、在线服务或账号系统。

## 需求状态

| ID | 需求 | 优先级 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| REQ-FOUNDATION-001 | 去模板化与文档地基 | P0 | Done | `docs/requirements/v0-1-foundation.md` |
| REQ-FOUNDATION-002 | 播放界面 | P1 | Done | `docs/requirements/v0-1-foundation.md` |
| REQ-FOUNDATION-003 | UI-only 播放状态模型 | P1 | Superseded by real playback | `docs/decisions/2026-07-24-v0-1-real-audio-scope.md` |
| REQ-FOUNDATION-004 | 基础工程验收 | P1 | Approved | `docs/requirements/v0-1-foundation.md` |
| REQ-FOUNDATION-005 | UI-only 进度条与演示频谱 | P1 | Superseded for playback progress | `docs/decisions/2026-07-24-v0-1-real-audio-scope.md` |
| REQ-AUDIO-001 | 真实本地音频播放 | P0 | Approved for v0.1 | `docs/decisions/2026-07-24-v0-1-real-audio-scope.md` |
| REQ-PLAYLIST-UI-001 | 虚构播放列表管理 UI | P2 | Candidate for v0.2 | `docs/requirements/v0-2-playlist-ui-prototype.md` |
| REQ-LIBRARY-001 | 本地音乐库与文件夹扫描 | P1 | Deferred | long-term requirements |
| REQ-QUEUE-001 | 内置播放队列与下一首播放 | P1 | Deferred after v0.1 | long-term requirements |
| REQ-PLAYLIST-001 | 播放列表与 `m3u8` 支持 | P1 | Deferred | long-term requirements |
| REQ-NETWORK-001 | FTP / SMB / WebDAV 网络存储播放 | P2 | Deferred | long-term requirements |
| REQ-PLUGIN-001 | 插件增强体系 | P3 | Deferred | long-term requirements |
| REQ-UI-CUSTOMIZATION-001 | 用户视觉自定义与动效配置 | P2 | In progress in frontend theme system | user-approved theme work |

## 待路由问题

- v0.1 command 契约、错误码和状态同步由 Architecture Agent 在 SP-015 先定义。
- Rust/Tauri 音频库选择和权限调整由 Rust/Tauri Agent 在 SP-016 基于 SP-015 执行。
- 前端真实播放状态接入由 Frontend Agent 在 SP-017 执行。
- 真实播放验证由 Test Agent 在 SP-018 执行。
