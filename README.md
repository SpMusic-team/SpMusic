---
doc_id: "README"
title: "SpMusic 项目说明"
doc_type: "readme"
status: "active"
owner_agent: "Documentation Agent"
version_scope: "project"
created: "2026-07-08"
updated: "2026-07-09"
source_documents:
  - "docs/requirements.md"
  - "docs/roadmap.md"
  - "docs/sprint-plan.md"
  - "docs/release-plan.md"
  - "docs/tasks/sp-009-readme-and-developer-documentation.md"
  - "package.json"
  - "src/App.tsx"
  - "src-tauri/Cargo.toml"
---
# SpMusic

SpMusic 是一个本地优先的桌面音乐播放器项目，目标是逐步构建轻量、稳定、可维护、体验良好的本地音乐播放与管理工具。

当前仓库基于 Tauri + React + TypeScript + Vite。项目已经建立需求索引、路线图、Sprint 计划和发布边界，但前端主界面仍处于模板页面状态，尚未完成 v0.1 播放界面原型。

## 当前状态

- 技术栈：Tauri、Rust、React、TypeScript、Vite。
- 文档状态：已建立 v0.1 范围、路线图、发布计划和任务卡。
- 前端状态：`src/App.tsx` 仍是 React / Vite starter 页面。
- Tauri 状态：`src-tauri` 是基础 Tauri 应用壳，未实现业务 command。
- 当前版本目标：v0.1 播放界面原型。
- 当前限制：尚不支持真实音频播放、媒体库、本地文件扫描、播放列表或网络存储。

## 本地开发

安装依赖：

```bash
npm install
```

启动前端开发服务器：

```bash
npm run dev
```

启动 Tauri 桌面应用：

```bash
npm run tauri dev
```

执行代码检查：

```bash
npm run lint
```

构建前端产物：

```bash
npm run build
```

预览前端构建结果：

```bash
npm run preview
```

## v0.1 范围

v0.1 的目标是把模板项目收敛为可运行、可验证、边界清晰的 SpMusic 播放界面原型。

计划包含：

- SpMusic 项目身份和基础文档。
- 播放界面：当前歌曲信息和基础播放控制。
- 假歌曲数据。
- UI-only 播放状态切换。
- 空歌曲列表 Empty State。
- 基础工程检查清单。

当前尚未完成：

- 将模板首页替换为 SpMusic 播放界面。
- 前端假歌曲数据和最小播放器状态。
- 播放 / 暂停 / 上一首 / 下一首的 UI 状态切换。
- v0.1 验证报告。

## 不支持的能力

以下能力属于后续版本或延期范围，当前仓库不应被理解为已经支持：

- 真实音频播放、音量控制、进度拖动和音频解码。
- 本地文件读取、文件夹选择和文件系统扫描。
- 媒体库索引、数据库、缓存层和迁移系统。
- 播放列表真实创建、编辑、删除、导入导出和 `m3u8` 支持。
- FTP、SMB、WebDAV 网络存储播放。
- 最小 Tauri command 或 React 到 Rust 通信验证。
- 插件系统、插件市场和扩展运行时。
- 在线音乐平台、在线曲库搜索、内容推荐或版权音乐服务。

## 文档入口

- [需求索引](docs/requirements.md)
- [路线图](docs/roadmap.md)
- [Sprint 计划](docs/sprint-plan.md)
- [发布计划](docs/release-plan.md)
- [总体架构](docs/architecture/overall-architecture.md)
- [v0.1 版本需求](docs/requirements/v0-1-foundation.md)
- [v0.2 播放列表 UI 候选需求](docs/requirements/v0-2-playlist-ui-prototype.md)

## 项目结构

```text
.
├── agent-prompt/       # 项目协作 Agent 提示词
├── docs/               # 需求、路线图、计划、任务和架构文档
├── public/             # 前端静态资源
├── src/                # React 前端源码
├── src-tauri/          # Tauri / Rust 桌面应用壳
├── package.json        # npm 脚本和前端依赖
└── README.md           # 项目说明
```
