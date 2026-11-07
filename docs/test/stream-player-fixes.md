---
doc_id: "TEST-STREAM-PLAYER-FIXES-2026-11-07"
title: "流完整播放界面与封面拖动验收"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "streams"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - "user request: 流作者加载前显示网址、完整播放界面隐藏进度填充与圆点、封面拖动切歌"
  - "src/features/player/components/PlayerSurface.tsx"
  - "src/features/player/components/TrackMeta.tsx"
  - "src/features/player/components/ControlDock.tsx"
  - "src/features/player/components/streamPlayerFixes.browser.test.mjs"
---

# 测试报告：流完整播放界面与封面拖动

## 摘要

最终独立浏览器验收六组通过。使用真实 PlayerShell、PlayerSurface、封面 pointer handlers、队列 preview/commit 和现有 artwork hook；仅原生传输受控，不把结果等同于打包 WebView 的网络播放验收。

## 范围

验证完整播放界面首次加载无作者时的网址回退、晚到作者及清空，流与本地进度条切换，以及无封面的流通过真实鼠标拖动切歌。保留此前列表和迷你控制器作者测试，本轮不重跑全部历史布局或 Rust 网络回归。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent；业务修改为 TrackMeta、ControlDock、对应样式及 PlayerSurface，未改公开 command/event、hook 数据契约或 Rust。
- 首错基线：完整标题曾直接拼接 artist/album，产生悬挂分隔符；完整控制器未限定流隐藏 range/thumb。源码核对明确。
- 独立真实 pointer 复现另一首错：从媒体库进入完整播放界面后，trusted pointerdown 命中封面并被接受，但随后 `drag.start.rejected` 原因为 `geometry`；deck 已连接、prepare 可用、无 audio/selection/transport busy，geometry 始终 null，未进入 preview。
- 根因链：测量 effect 在媒体库页无 deck 时早退，依赖缺少完整界面挂载条件；切入完整界面时 active layer/播放状态不变，因此没有重建测量 observer。修复据真实 DOM 生命周期重测，未添加假几何或任意等待。
- 几何修复后，明确无来源的流预览还需通过 empty readiness 与 promotion 两个门槛；实现限定 stream、token、target 和无 image/file/fallback 来源，不将加载失败当成正常空封面。

## 命令

- 设置 `SPMUSIC_PLAYWRIGHT` 指向本机已安装包后执行 `node src/features/player/components/streamPlayerFixes.browser.test.mjs`：退出码 0，六组通过、pageerror 为空。
- `npx eslint src/features/player/components/streamPlayerFixes.browser.test.mjs`、`git diff --check`：通过。
- 完整 build/lint：主 Agent 独立执行通过；本 Test 未重复运行。
- `cargo check`、`npm run tauri dev`：本轮未运行，无 Rust 修改。

## 人工检查

测试生成完整流界面截图 `%TEMP%/spmusic-stream-player-evidence/full-stream.png`；本轮主要证据为真实 DOM 几何、computed visibility、trusted 输入轨迹及对应 native selection calls。

## 根因与因果链反证

- 替代假设“松手早于异步 preview”被首轮 trace 反证：previewSequence 为 0、无 token，错误在 geometry，早于 preview 准备。
- 修复后 cover 542×542，geometry 有限有效；真实拖动产生 preview 层/token、`drag.target-ready` 与 `drag.commit accepted=true`，并产生对应 `audio_load_and_play`。没有调用 next callback 代替鼠标拖动。
- 正向 station→fresh，反向 fresh→station 均通过；promotion 后 active 身份与逻辑 track 一致，再接受后续拖动。等待的是实际身份和层生命周期条件，没有扩大超时。

## 跨层契约

原生命令和事件形状沿用既有 fixture 与 TypeScript 服务；本轮业务无 Rust 或跨层字段改变。未使用 mock 结果证明真实网络音频能力。

## 回归覆盖

1. 首次加载无作者时完整作者位显示 URL，无额外分隔符；晚到真实 Ready 作者显示，清空回 URL。
2. 流底轨 940×6 可见，range/thumb 隐藏；thumb 23×23 几何保留。本地歌曲三者恢复可见且作者/专辑原格式保持。
3. 无封面的流真实正向与反向拖动均切换正确源，层可提升和清理。
4. pointercancel 不触发新 native 选择。
5. 模拟 native 新选择失败后，原流可继续接受下一次真实拖动。
6. 最终本地歌曲标题、作者/专辑和进度显示不回归。

## 性能 / 时序

未宣称性能优化。记录 pointer/preview/commit 事件顺序和 active promotion，复现前后使用相同浏览器、1280×900 和受控 transport。自有 5184 Vite 与浏览器在 finally 中关闭，未操作用户 5173 服务。

## 发现

验收发现并交回 FE 修复了初次交付未覆盖的媒体库→完整界面 geometry observer 生命周期缺口。修复后六组通过。

## 风险

首次加载场景覆盖“尚未收到节目作者→Ready 作者→清空”，未另行测试持久会话冷启动恢复。本轮无本地真实封面像素 paint 测试，也不声称验证了物理触摸设备或打包 WebView；代码审查确认本地和有来源图片的 paint gate 保持原样。

## 临时缓解

不是临时缓解：未放宽产品门槛、伪造空封面图像或禁用输入。

## 验证结论

本轮适用验收范围通过，可交主 Agent 集成；上述原生、物理设备及持久冷启动边界保留为未覆盖项。

## 建议

保留全部既有未提交工作，仅整合本轮限定修复和测试。
