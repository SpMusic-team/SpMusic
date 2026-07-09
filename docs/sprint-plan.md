# Sprint 计划

## Sprint 目标

完成 SpMusic v0.1「项目地基」：把当前 Tauri + React + TypeScript 模板项目收敛为有项目身份、有静态播放器外壳、有最小前后端通信、有基础验收流程的 SpMusic 项目地基。

## 范围

- 由 Requirements Agent 从总需求中切出 v0.1 版本需求和验收边界。
- 由 PM Agent 基于版本需求建立需求索引、路线图、发布计划和首批任务卡。
- 设计静态播放器主界面说明。
- 定义最小播放器状态与 Tauri command 契约。
- 将模板页面替换为 SpMusic 播放器界面。
- 实现播放 / 暂停 / 上一首 / 下一首的 UI 状态切换。
- 实现最小 Tauri command，并在前端展示连接结果。
- 建立验证清单：`npm run lint`、`npm run build`、`cargo check`、`npm run tauri dev`。
- 更新 README。

## 不在范围内

- 真实音频播放、音量、进度拖动、音频解码。
- 文件夹扫描、媒体库、数据库、元数据、封面、歌词。
- 播放列表真实导入导出与 `m3u8` 实现。
- FTP、SMB、WebDAV 网络存储播放。
- 插件系统、插件市场、扩展运行时。
- Last.fm、Pano Scrobbler、云同步、自定义功能区。

## 任务

| 任务 ID | 标题 | 优先级 | 负责 Agent | 依赖 |
| --- | --- | --- | --- | --- |
| SP-001 | v0.1 版本需求分析与验收边界 | P0 | Requirements Agent | `docs/requirements/总需求分析.md` |
| SP-002 | 需求索引、路线图与发布边界 | P0 | PM Agent | SP-001 |
| SP-003 | 播放器外壳 UI 规格 | P1 | UI/UX Agent | SP-001 |
| SP-004 | 播放器状态与命令契约 | P1 | Architecture Agent | SP-001 |
| SP-005 | 静态播放器外壳实现 | P1 | Frontend Agent | SP-003, SP-004 |
| SP-006 | 最小 Tauri 健康检查命令 | P1 | Rust/Tauri Agent | SP-004 |
| SP-007 | 前端 Tauri command 集成 | P1 | Frontend Agent | SP-005, SP-006 |
| SP-008 | 验证清单与测试报告 | P1 | Test Agent | SP-005, SP-006, SP-007 |
| SP-009 | README 与开发文档 | P1 | Documentation Agent | SP-001, SP-002 |
| SP-010 | Sprint 复盘与范围闸门 | P0 | PM Agent | SP-001 至 SP-009 |

## 风险

- 总需求覆盖面很大，若不先做版本需求切分，容易把最终愿景误当作当前开发范围。
- 当前项目仍有模板页面和模板 README，项目身份尚未落地。
- 前后端通信尚未验证，Tauri command 风险需要早暴露。
- 真实播放、媒体库、网络存储和插件系统都很有吸引力，但进入 v0.1 会显著扩大风险。

## 完成定义

- `docs/requirements/v0-1-foundation.md` 存在，并由 Requirements Agent 明确 v0.1 需求、非目标和验收标准。
- `docs/requirements.md`、`docs/roadmap.md`、`docs/sprint-plan.md`、`docs/release-plan.md` 存在并相互一致。
- `docs/tasks/` 中存在首批任务卡，且每张卡包含负责 Agent、目标、非目标和验收标准。
- 应用首屏不再是 Vite / React 模板页面。
- 应用展示 SpMusic 静态播放器主界面和至少 5 条假歌曲。
- 播放 / 暂停 / 上一首 / 下一首能改变 UI 状态。
- 空队列存在可渲染 Empty State 分支。
- 前端能调用最小 Tauri command 并展示结果或连接状态。
- `npm run lint` 通过。
- `npm run build` 通过。
- `cargo check` 在 `src-tauri/` 下通过。
- `npm run tauri dev` 能启动应用。
- v0.1 没有实现真实音频播放、媒体库、数据库、网络存储或插件系统。
