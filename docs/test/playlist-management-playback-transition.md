---
doc_id: "TEST-PLAYLIST-MANAGEMENT-PLAYBACK-TRANSITION"
title: "列表管理进入播放列表的头图转场验证"
doc_type: "test-report"
status: "in-review"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-17"
updated: "2026-10-19"
source_documents:
  - "user request: 列表管理界面切换到播放列表界面存在卡顿问题，其中在头图上特别明显"
  - ".agents/prompt/Test_Agent.md"
  - "src/features/player/components/PlaylistLibraryPanel.tsx"
  - "src/features/player/components/PlaylistPanel.tsx"
  - "src/features/player/components/playlistManagementMotion.browser.test.mjs"
  - "src/features/player/components/playlistManagementTransitionPerformance.browser.test.mjs"
  - "src/features/player/components/PlaylistCard.tsx"
  - "src/features/player/hooks/usePlaylistContentWindow.ts"
  - "src/features/player/styles/player/playlist-panel.css"
  - "src/features/player/model/playlistCoverReadiness.test.ts"
  - "src/features/player/components/playlistViewTransition.browser.test.mjs"
  - "user follow-up: 仍然卡顿，需要继续实质优化；主要在列表出现及头图展开时掉帧"
---

# 测试报告：列表管理进入播放列表的头图转场

## 摘要

第二轮独立生产 React 对照确认：保留全部歌曲按钮、只挂载可视及预取内容后，500/1000 首中位首帧等待分别约减少 48%/48%，暖态展开期间长间隔也明显减少。独立调查发现并修正了代表卡片移交时反复测量高度的问题，避免把首挂开销转移到展开阶段。原生 WebView、真实媒体解码与缓存仍未完成端到端性能验收；小列表新浏览器冷首次仍有单个长 rAF 间隔，不能宣称所有环境均无掉帧。

下方原有各节保留 2026-10-17 第一轮证据；2026-10-18 的最终实现、性能和回归结论见文末“第二轮：内容窗口与稳定形状缓存”。第一轮“未明显缩短首挂”不代表第二轮最终结果。

## 范围

使用真实 `PlayerShell`、`PlayerSurface`、`useAudioPlayer`、AppearanceProvider、command 响应解析器及项目 CSS；仅替换原生 command/event 传输为确定性合成输入。性能场景实际渲染 3、100、500 张歌曲卡，脚本逐次断言实际卡数，不能将这些合成歌曲视为真实曲库样本。

主要测量视口 1280 × 900、Edge headless 156.0.4314.23、Node 24.19.0；完整既有行为 harness 另含 480 × 800。封面为固定 SVG 和 80 × 50 RGBA 合成响应，源尺寸声明 800 × 500；空图场景将 metadata.coverArt 置空。生产 React 对照仍由 Vite serve 提供模块，使用独立缓存、生产 React/ReactDOM/JSX，不是 Tauri Release bundle。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent；基线 HEAD `96ae40a`，分支 `fix/playlist-management-transition`。
- 生产修改：两端共享封面添加 `layoutCrossfade={false}`；管理页退出时停止重复测量 heading，保留最后活动几何。未修改后端或共享数据契约。
- 实现者主张的因果链：管理页进入详情 → 页面淡化与共享封面 crossfade 同时作用 → 头图额外减淡；退出 heading 测量会同步刷新进入页布局。前一主张已被独立验证；后一项可以改善生命周期边界，但性能收益未得到稳定证实。
- 独立性能脚本由 Test Agent 新建；已有 motion harness 由 Frontend Agent 拥有。前者记录性能、头图几何/opacity 与连续性断言，后者验证真实导航、dock、动画中间帧及播放状态。
- 证据缺口：用户实际列表规模、原生 WebView 性能轨迹、真实音频与封面解码、真实缓存冷热及自定义 CSS 未覆盖。

## 命令

共同设置：`$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'`。Vite 服务由 Frontend Agent 管理，Test Agent 复用 5173；生产 React 服务为 5174。

- `node --check src/features/player/components/playlistManagementTransitionPerformance.browser.test.mjs`：通过。
- `npx eslint src/features/player/components/playlistManagementTransitionPerformance.browser.test.mjs`：通过。
- `node src/features/player/components/playlistManagementTransitionPerformance.browser.test.mjs`：多次独立执行，最终有效参数及结果见下表。每轮以不同 `SPMUSIC_SCREENSHOT_DIR` 写入 TEMP，避免覆盖。
- `node src/features/player/components/playlistManagementMotion.browser.test.mjs`：Frontend Agent 修正 setup 观察预算后，Test Agent 完整独立重跑退出 0；前两次均在既有 scale3 观察预算耗尽处退出 1，见下文诊断。最终日志为 `%TEMP%/spmusic-management-transition-motion-final-corrected.log`。
- `npm run build` / `npm run lint`：协调 Agent 在最终源码上独立执行并报告通过，Test Agent 未重复执行全仓库检查。
- `cargo check` / `npm run tauri dev`：未运行，本次没有 Rust、权限或 command/event 修改。
- 测试结束后核验命令行，停止本任务的 Vite PID 41732 与 npm PID 11328；复查两进程及 5173 监听均不存在。5174 由启动它的 Frontend Agent 清理。未操作用户原生播放器。

| 性能脚本参数（未列出者不设置） | 结果 |
| --- | --- |
| `SPMUSIC_PERF_CAPTURE=1`，初始 100/500，Tracing 开启 | 保存旧模块及诊断轨迹；初始部分轮次与实现者浏览器/构建并发，不用于最终 A/B |
| `SPMUSIC_PERF_BASELINE=1; SPMUSIC_PERF_TRACE=0`，默认 3/100/500 | 最终开发 React 基线，退出 0 |
| `SPMUSIC_PERF_TRACE=0; SPMUSIC_PERF_ASSERT_CONTINUITY=1`，默认 3/100/500 | 修复后开发 React，退出 0 |
| `SPMUSIC_PERF_BASELINE=1; SPMUSIC_PERF_TRACE=0; SPMUSIC_PERF_COUNTS=500; SPMUSIC_PERF_GEOMETRY_ONLY=1; SPMUSIC_PERF_ITERATIONS=1; SPMUSIC_PERF_ASSERT_CONTINUITY=1` | 负向回归退出 1：旧版最低总 opacity 0.670021401951，违反 ≥0.98 断言 |
| `SPMUSIC_TEST_ORIGIN=http://127.0.0.1:5174; SPMUSIC_PERF_REVERSE_FIX=1; SPMUSIC_PERF_COUNTS=100,500; SPMUSIC_PERF_TRACE=0` | 生产 React 等价基线，退出 0 |
| 同一 5174、100/500、TRACE=0，移除 REVERSE_FIX，添加 `SPMUSIC_PERF_ASSERT_CONTINUITY=1` | 生产 React 修复后，退出 0 |
| 同一 5174，`SPMUSIC_PERF_COUNTS=500; SPMUSIC_PERF_TRACE=0; SPMUSIC_PERF_PROFILE=1; SPMUSIC_PERF_ITERATIONS=1` | 无 Timeline Tracing 的 CPU profile，退出 0 |
| 同一 5174，`SPMUSIC_PERF_COUNTS=500; SPMUSIC_PERF_TRACE=0; SPMUSIC_PERF_READTOP_SCROLL_ONLY=1` | 仅通过 route 更换 readTop 读取的反证实验，退出 0；无稳定收益，未落地 |
| 同一 5174，`SPMUSIC_PERF_COUNTS=100; SPMUSIC_PERF_TRACE=0; SPMUSIC_PERF_NO_ARTWORK=1; SPMUSIC_PERF_GEOMETRY_ONLY=1; SPMUSIC_PERF_ITERATIONS=1; SPMUSIC_PERF_ASSERT_CONTINUITY=1` | 无封面 grow/shrink 连续性通过，退出 0 |
| 5173，`SPMUSIC_PERF_SCALE_DIAGNOSTIC=1`，分别当前源码与 `SPMUSIC_PERF_BASELINE=1` | scale3 旧/新几何时序诊断均退出 0；只采集诊断，不代替行为验收 |

上述参数通过 PowerShell `$env:参数名='值'` 设置，各命令使用独立进程，未依赖之前 shell 的隐式环境。原始证据主要保存在 `%TEMP%/spmusic-management-transition-*`；报告保存有效汇总，TEMP 文件不是长期归档。

## 人工检查

- 查看实际 `management-to-detail-middle.png`：封面与 dock 均绘制，页面淡化仍保留；不将 DOM opacity 代理值等同屏幕像素 alpha。
- 原生应用用户曲库复现与人工流畅性确认：未验证。

## 根因与因果链反证

- 单独禁用封面 crossfade、保留页面淡化：重复进入的两端 opacity 之和从最低 0.551/0.613 恢复到约 1，支持额外淡化来自共享投影 crossfade。
- 最终正确范围采样：开发 React 旧版 grow 总 opacity 最低分别为 3 首 0.849、100 首 0.751、500 首 0.592；修复后九轮均约 1。生产 React 旧版 500 首最低 0.750，新版三轮均约 1；所有这些旧/新轮次均没有完全不可见的封面帧。
- 连续性指标是每端元素及其祖先 opacity 的乘积，再求两端之和。它用于检测额外 crossfade，不代表合成像素完全不变暗，也不代表帧率达到 60fps。
- 替代假设“首次索引构建主导卡顿”：跳过初始索引后无稳定收益，候选撤回。
- 替代假设“退出 heading 重测主导卡顿”：单因素无稳定收益；guard 保留活动/退出生命周期边界，但不据此宣称显著提速。
- 替代假设“readTop 读取 scrollHeight/clientHeight 是可单独消除的首挂税”：只读 scrollTop 的 route 实验未降低整体首帧或 LayoutDuration，未落地。
- 原始采样首次 grow 使用 `currentScope=null` 过滤源封面，曾误报源图缺失；已改用被点击管理卡的 scope。最终复测确认旧/新源图均在，该错误结论全部撤回。
- presence 日志确认首次退出管理页已看到 `isPresent=false, atomicOverview=false, handoff=true`，反证“旧 atomicOverview context 未传播”。

## 跨层契约

- TypeScript / Rust 类型、序列化、command/event 名称、权限：生产差异不涉及这些契约。
- 浏览器运行真实前端解析器和状态逻辑；原生传输被固定输入替代，不能证明实际 IPC、音频或文件访问。
- 无封面数据路径已通过连续性测试；真实图片错误、缓存失效和解码失败未在本次重新验证。

## 回归覆盖

- 既有 motion harness 最终完整独立通过桌面/窄窗 grow/shrink、每方向至少三帧几何插值、固定且唯一可交互 dock、四次快速反向、导航不发播放命令、播放状态/队列保持、返回播放器及中途切播放器清理。
- 默认桌面 shrink/grow 实测完成 306.5/313.2ms，窄窗 306.5/309.3ms，全部保留 450ms 验收上限；每方向可见中间帧 62–69。dock 屏幕像素采样和总 opacity 验证通过。
- scale3 shrink/grow 完成 710.2/708.9ms，保留 725ms 验收上限；可见中间帧 180/185。setup 观察预算改为已有 10 秒页面超时的毫秒口径，没有改变真实动画验收阈值。
- reduced-motion：480 × 800、空管理列表、导入后双向切换通过；两帧完成 39.4ms，目标 cover 无变换，旧页立即清理，无页面异常。
- 空图、暖图重复进入：性能 harness 已通过；暖图为合成浏览器响应及前端保留，不代表原生持久缓存。
- 所有性能轮次无 `pageerror`，卡片实际数量断言通过；浏览器生命周期在 `finally` 关闭。

## 性能 / 时序

最终 A/B 顺序执行，没有并发构建或其他 Agent 浏览器。每种规模分别三轮 grow/shrink，并分为逐帧读取几何与只记录 rAF 的对照组，窗口 900ms。首帧为 click 到第一次 rAF 回调的时间；最大间隔另算后续 rAF 间隔，不漏报首挂阻塞。目标几何稳定只看目标封面，旧页移除独立统计。headless rAF 频率不等于物理显示器刷新率。

开发基线回放通过 Playwright route 替换保存的旧变换模块，未 checkout 工作区。生产 React 使用当前同依赖模块精确移除两端 cover 的 `layoutCrossfade:false` 与 heading guard，marker 缺失即失败，保留已有分类图标的 crossfade 配置。独立读取实际依赖 URL，确认 React、ReactDOM、JSX 均为 `.production`，无 `.development` / jsxDEV；serve 编译残留的 Refresh 签名通过测试页面无操作 globals 处理，因此仍不能称完整生产打包环境。

| 生产 React，仅 rAF，三轮 grow | 原版 | 修复后 |
| --- | --- | --- |
| 100 首，首帧 ms | 38 / 40 / 31 | 40 / 30 / 36 |
| 100 首，后续最大帧间隔 ms | 12 / 12 / 11 | 12 / 10 / 11 |
| 500 首，首帧 ms | 75 / 93 / 87 | 75 / 83 / 106 |
| 500 首，后续最大帧间隔 ms | 24 / 24 / 26 | 19 / 24 / 105 |
| 500 首，旧页移除 ms | 339 / 357 / 348 | 339 / 344 / 367 |
| 500 首，累计 ScriptDuration ms | 63 / 76 / 69 | 61 / 67 / 58 |
| 500 首，累计 LayoutDuration ms | 12 / 12 / 11 | 12 / 15 / 13 |

这些数值不支持“整体首挂卡顿已解决”。开发 React 的 500 首首帧约 224–273ms，明显高于生产 React；不能将开发数据直接外推原生 Release。

诊断 Timeline Tracing 显示封面几何插值没有每帧都产生 Layout，500 首仅 rAF 组约 9–16 次 Layout/900ms；因此不能把每帧几何变化当作每帧布局的证据。关闭 Tracing 后不输出 Paint 计数，不能将未测值解释为零。

CPU profile 的累计 measureScroll、readTop、DOM 提交与封面 Blob/URL 工作覆盖整个观测窗，并包含 profiler 自身开销；不能直接当作真实首挂阶段的精确耗时。只读 scrollTop 的反证结果：500 首首帧 84/81/102ms、LayoutDuration 13/11/13ms，没有稳定优于修复后数据。

scale3 既有 harness 失败诊断：当前第 180 帧为 949.4ms、管理封面真正稳定 1006.5ms；原模块第 180 帧为 956ms、稳定 1026.5ms，最终几何同为 `[360,403,240,165]`。固定帧数观察窗提前耗尽，不能认定为本次生产回归。真正 grow/shrink 的 450/725ms 验收 deadline 不应因此放宽。

## 发现

- 额外 crossfade 的根因修复有独立正向、负向与单因素证据。
- 大列表首挂仍存在可测阻塞，当前两处修改的整体性能收益不足以稳定成立。
- 初期并发负载、错误 source scope 和不正确的全部 cover 稳定口径均已识别并排除，最终表格只采用修正后且负载受控的数据。

## 风险

未覆盖原生 WebView / GPU / 用户曲库输入、真实解码与缓存、自定义 CSS、全部图片错误分支；大列表初挂主线程成本仍存在。连续性代理断言不能替代像素级全帧合成或原生性能轨迹。

## 临时缓解

双 crossfade 修改直接去除额外淡化来源，不是延时、吞错或禁用交互。它仅修复已证实的头图子问题，不承担其余挂载成本的解决声明；不将未证实的索引/读取候选保留为性能方案。

## 验证结论

头图额外 crossfade 子问题及受影响导航行为回归：通过。整体列表管理进入播放列表的卡顿：尚未完全解决，完整性能验收证据不足。

## 建议

保留已证实的头图修复；将大量歌曲首挂与原生环境确认作为残余项交协调者明确披露，不把开发浏览器通过等同原生端到端性能验收。

## 第二轮：内容窗口与稳定形状缓存

### 范围与最终实现

本轮基线为含第一轮 crossfade/退出测量修复的工作区；并非撤回已有修复。Frontend Agent 修改 `PlaylistPanel.tsx`、`PlaylistCard.tsx`、`playlist-panel.css`，新增内部 `usePlaylistContentWindow.ts`。所有按钮、ID、ARIA、顺序和交互仍在；仅视口及前后各一个视口、代表内容、焦点、当前歌曲定位与 FLIP 持有项挂载完整子树。≤64 首保持完整内容，有效 customCss/layoutCss 保守回退完整内容。未增加依赖或改变 Tauri/公开 ViewModel。

Test Agent 独立拥有性能/结构 harness、当前报告，并按协调者新增授权更新 `playlistCoverReadiness.test.ts` 的真实 Card fixture 与内容隐藏/恢复回归。生产 React 服务 5174 使用独立缓存及 `hmr:false`，实际 React/ReactDOM/JSX 依赖均已核验为 production，无 jsxDEV。性能窗口明确通知双方独占，未与构建或其他浏览器并发。

### 本轮命令与证据

共同设置仍为 `SPMUSIC_PLAYWRIGHT` 指向现有 Playwright，`SPMUSIC_TEST_ORIGIN=http://127.0.0.1:5174`；所有参数通过独立 PowerShell 进程的 `$env:名称='值'` 设置。

- `node src/features/player/components/playlistManagementTransitionPerformance.browser.test.mjs`：`SPMUSIC_PERF_CAPTURE=1`、新 `SPMUSIC_PERF_SNAPSHOT=%TEMP%/spmusic-content-window-round2-before-modules` 保存八个变换 JS 和独立旧 CSS；3 首一次控制后，500/1000 各三轮。采样设置 `SPMUSIC_PERF_COUNTS=500,1000; SPMUSIC_PERF_TRACE=0; SPMUSIC_PERF_GEOMETRY_OFF=1; SPMUSIC_PERF_GROW_ONLY=1`。
- 同命令同采样参数：最终形状缓存修复后 500/1000 各三轮；终态产物 `%TEMP%/spmusic-content-window-round2-shape-cache-final-large`。3 首另测三轮，未将其当作大列表根因的证明。
- 同命令 `SPMUSIC_PERF_WINDOW_PROBE=1; SPMUSIC_PERF_COUNTS=500; SPMUSIC_PERF_ITERATIONS=1`，其他采样参数相同：对保存的九模块窗口初版与修复后版本做单因素测量。初版包含新 hook，旧整体基线没有该导入。所有 baseline route 根据各自 manifest 加载；新增 CSS 仅匹配旧基线不存在的 data-content 属性。
- 持久回归 `SPMUSIC_PERF_ASSERT_WINDOW_METRICS=1; SPMUSIC_PERF_WINDOW_PROBE=1`：稳定形状集合的高度测量必须 1–10 次，且实际处于有界内容路径。回放初版 500 首退出 1，明确失败次数 55；最终 500/1000 各一轮均退出 0、各测量 1 次。该正向计数检查允许与静态检查并行，其时间数值未用于性能结论。
- 同命令 `SPMUSIC_PERF_WINDOW_REGRESSION=1`：最终结构/生命周期回归；准确范围见下文。
- 同命令 `SPMUSIC_PERF_SCROLL_DIAGNOSTIC=1`：1000 首连续滚动一秒，与保存旧整体模块对照；同一组每帧增加 100px，采样包含可见内容检查。
- `node --test src/features/player/model/playlistCoverReadiness.test.ts`：6/6 通过，原 artworkVisible 三轮 ready/source 断言全部保留，新增 contentVisible true→false→true 输出及 owned decoded resource 保留断言。此项使用 SSR，实际 DOM 内容卸载/恢复另外由浏览器回归覆盖。
- 最终 `npm run build`、`npm run lint`、两个 browser 脚本 `node --check`、`git diff --check`：协调者独立执行通过；静态检查结束后再执行带 450/725ms 期限的完整 motion 回归。

### 根因与反证

首挂成本不只来自头图：首次渲染全部歌曲的图像、图标及文字子树带来随列表增长的 DOM/React 成本。窗口优化把 500/1000 个完整子树降低到约 12–14 个，保留全部按钮；独立检查了可见内容、键盘焦点和滚动高度，没有用禁用交互替代修复。

初版虽然缩短首帧，但 900ms 累计 Layout 明显增加。独立 route probe 证实不是猜测的 ResizeObserver 循环：500 首初版高度重测 56 次、refresh 58 次、RO 仅 1 次；代表从 `perf-136:7` 逐个移交到后面的同形状卡，形状集合始终为 `{7,15}`。第一次 450ms 内约 23 次重测，后半窗约 34 次。按代表 ID 缓存高度把无几何变化的移交误作失效，重复写高度并全量读 rect。

最终仅按形状集合及真实 grid/尺寸/viewport/theme/layout/font 变化失效，代表换 ID 本身不重测。单因素初版→修复后：高度重测 56→1、LayoutCount 262→126、LayoutDuration 152→87ms；同期 hydrate 与 pixels 工作各 85→127 次，说明工作量增加仍减少了布局，不能用“处理更少工作”解释。此前 header 稳定 layoutDependency 的诊断仅使 Layout 267→259、150→148ms，无明显收益，没有混入生产代码；已否定的 index/readTop 方向未重新实施。

### 最终性能

固定 1280 × 900、生产 React、无 Timeline Tracing。每轮直接进入管理页后点击详情，采样 900ms；500/1000 各三轮，同一规模在一个页面重复。首帧为 click→首次 rAF，展开窗口另外切为 0–450ms；随后间隔不包含首帧，避免掩盖首挂。Longtask 来自浏览器 PerformanceObserver，不把大 rAF 间隔自动等同 JavaScript 长任务。

| 指标（三轮） | 本轮优化前 | 最终版本 |
| --- | --- | --- |
| 500 首首帧 ms | 68 / 60 / 68 | 55 / 34 / 36 |
| 1000 首首帧 ms | 92 / 90 / 100 | 67 / 48 / 48 |
| 500 首展开窗最大间隔，含首帧 ms | 77 / 60 / 68 | 70 / 34 / 36 |
| 1000 首展开窗最大间隔，含首帧 ms | 92 / 90 / 100 | 67 / 48 / 48 |
| 500 首展开窗后续最大间隔 ms | 77 / 25 / 24 | 70 / 15 / 10 |
| 1000 首展开窗后续最大间隔 ms | 25 / 36 / 31 | 21 / 19 / 18 |
| 500 首后续 >16.7ms 间隔数 | 2 / 2 / 8 | 2 / 0 / 0 |
| 1000 首后续 >16.7ms 间隔数 | 4 / 13 / 12 | 1 / 1 / 1 |
| 500 首 longtask 时长 ms | 64 / 55 / 61 | 52 / 无 / 无 |
| 1000 首 longtask 时长 ms | 84 / 80 / 91 | 63 / 无 / 无 |
| 500 首 900ms LayoutDuration ms | 80.6 / 74.1 / 31.4 | 87.3 / 80.8 / 5.0 |
| 1000 首 900ms LayoutDuration ms | 104.2 / 112.3 / 99.7 | 107.7 / 108.3 / 112.4 |

中位首帧等待约减少 48%/48%。最终 900ms 布局成本回到原基线量级，不再是初版约两倍；累计时间也受完成的 metadata/cover 工作数量影响，不能等同单帧时间。headless rAF 不等于物理刷新率，不能据此宣称 60fps。

小列表对照：优化前新浏览器一次首帧 36ms、后续单次 gap 67ms；优化后三轮首帧 32/18/18ms，后续最大 82/7/6ms。异常仅冷首次出现，封面已 ready、无 longtask；暖态反复未重现。该残余未归因于歌曲数量，也没有为此未经证据删除 blur 或更改动画。真实用户 WebView 是否存在同一冷首次因素仍未确认。

连续滚动诊断：原整体基线一秒 65 次 rAF/6500px、最大 30.9ms；窗口初版 54 次/5400px、最大 33ms，两者均无可见空内容帧、无 longtask，完整子树 1000→最多 29。脚本每 rAF 加 100px，实际步数不同，这仅支持未发现明显空窗或长任务，不支持“滚动已提速”的结论。

### 最终回归与限制

结构回归已独立验证：1000 个按钮 ID/顺序/ARIA/tab 属性保留；窗口外 `focus({preventScroll:true})` 补入内容且不滚动；十档布局顶/尾可见卡无空 copy、滚动高度差 ≤2px，尾部内容约 12–70 个，尾部封面成功加载；480 窄窗、选择跨内容移出/返回、搜索唯一结果及空结果→1000 恢复、descriptor.available=false 的禁用语义保持。

管理选择显式 entry top，即使当前曲目是第 1000 首仍回到头图；没有显式 entry 时第 1000 首能够准确定位且有内容。相同代表 ID 的 metadata 形状 1→15 时高度 318→338px，缓存正确重测。1318→980 跨断点检查高度缓存与实测一致，避免仅使用 grid 宽缓存。advanced.customCss 与 experimental.layoutCss 实际生效，完整子树均回退到 1000。

真实浏览器错误分支：封面 A/B 两源失败后，内容移出/回入保持 error、不重试旧源；换为 C/D 后 C 失败而 D 成功，图片重新可见。失败记录按资源对保留，未以内容卸载重置重试预算。SSR readiness 原断言全部保留，6/6 通过。

最终完整 motion harness 退出 0：桌面 shrink/grow 311.3/311.9ms，窄窗 304.5/309.4ms，scale3 707.8/707.7ms，原 450/725ms 验收期限保持。快速往返、唯一 dock、播放器返回、中断清理、播放队列和状态保持、导航不发播放命令以及 reduced-motion 全部通过。

另外在真实 **1000 首、窗口开启、正常动态效果** 场景中，独立重复四次管理↔详情快速反转：先派发滚动、立即离开，在动画未结束时再进入。最终仅一个详情页和一个 dock、显式 top 定位为 0、可见卡无空内容、无 pageerror，确认未被旧滚动调度覆盖新入口。此项不依赖前述 ≤64 首关闭窗口的小列表 motion 测试。

原 250 首 FLIP 回归首次被测试 locator 歧义阻断：选择按钮同时存在于头图与 compact 控件，未进入原选择断言。Frontend Agent 仅将两处选择与一处搜索入口限定到 `.playlist-hero`，未删改原断言或放宽时限。2026-10-19 Test Agent 设置 `SPMUSIC_SKIP_BENCH=1` 后执行 `node src/features/player/components/playlistViewTransition.browser.test.mjs`，退出 0、`REGRESSION_PASS`。十档往返、根节点身份/顺序保持、FLIP 清理、选择跨布局、切歌/播放、搜索及空过滤恢复、metadata/disabled 更新、尾部 demand、resize/卸载、reduced-motion 全部通过。日志为 `%TEMP%/spmusic-content-window-round2-flip-final-corrected.log`。Vite HMR WebSocket 被本地网络检查阻止的 console 消息不影响该独立静态模块回归；没有 pageerror。

原生音频/真实媒体解码/IPC、用户实际曲库、持续长时间滚动、全部自定义布局组合仍未覆盖。本轮证据支持大列表首挂及暖展开的实质改善，冷首次单个长间隔和原生端到端流畅性仍是明确边界。

### 本轮验证结论

已验证的浏览器范围内：内容窗口的首挂/暖展开性能改善、稳定形状缓存、1000 首结构与生命周期、完整导航动效及 250 首十档 FLIP 回归通过，未留下待执行的本轮回归项。原生环境下的完整流畅性仍证据不足；不将合成浏览器结果外推为所有曲库、设备和冷首次均无卡顿。

2026-10-19 仅为最后 FLIP 回归启动的单一 Vite PID 37676，完成后已核验 `D:\SpMusic\node_modules\…\vite\bin\vite.js --host 127.0.0.1` 并停止；再次检查该进程及 5173/5174 监听均不存在。临时证据文件保留，未操作用户原生播放器。
