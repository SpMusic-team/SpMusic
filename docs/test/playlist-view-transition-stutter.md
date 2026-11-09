---
doc_id: "TEST-PLAYLIST-VIEW-TRANSITION-STUTTER"
title: "播放列表视图切换卡顿验证"
doc_type: "test-report"
status: "in-review"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-08"
updated: "2026-10-08"
source_documents:
  - "user request: 当前的播放列表界面在切换视图时明显卡顿，请定位并修复"
  - "C:/Users/winkeses/Downloads/播放列表动画缺陷.mp4"
  - "src/features/player/components/PlaylistPanel.tsx"
  - "src/features/player/components/playlistViewTransition.browser.test.mjs"
  - ".agents/prompt/Test_Agent.md"
---

# 测试报告：播放列表视图切换卡顿

## 摘要

独立浏览器实测证实：FLIP 目标的几何读写交错导致重复布局；批量读取后再启动动画可消除该放大因素。卡片 JSX 复用进一步减少仅切换布局时的 React 协调开销。真实组件及样式的十档切换和相关状态回归通过；本报告不把开发浏览器结果视为原生 WebView 的端到端性能验收。

## 范围

真实 `PlaylistPanel`、`PlaylistCard`、AppearanceProvider 和播放器 CSS；1280 × 900、Edge headless 156.0.4314.8、Node 24.19.0、Vite 8.1.3；稳定合成 500/1000 条曲目，共用已解码的 128px blob 图片。后端请求由记录 demand 的回调替代，播放按钮验证状态与回调，不验证音频输出。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent。
- 修改范围：`PlaylistPanel.tsx` 的 FLIP 批量读取与卡片 JSX 复用。
- 基线：修复前 revision `5768a07da65e1d0ce25755e0534f01561043fadc`；第一阶段等价恢复原始 effect，第二阶段保存完整首版 Vite 模块作单因素对照。永久 harness 默认只运行已验证的当前源码回归；完整指定 revision 回放是显式可选实验，尚未完成成功重跑。
- 因果链：Ctrl + 滚轮 → 布局属性改变 → 每个目标读取几何后立即启动填充动画 → 下一个读取触发再次布局 → 阻塞首帧；卡片子树在相同卡片 props 下仍被重新协调，进一步增加开销。
- 证据缺口：实际用户曲库规模、原生 WebView 性能轨迹、Tauri 封面解码/缓存及真实播放未覆盖。

## 命令

- `npm run dev -- --host 127.0.0.1`：Test Agent 启动 Vite。
- 设置 `SPMUSIC_PLAYWRIGHT=C:\Users\winkeses\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright` 后运行 `node src/features/player/components/playlistViewTransition.browser.test.mjs`：最终默认当前源码回归成功，`REGRESSION_PASS`，退出码 0。
- 设置 `SPMUSIC_BASELINE_MODE=current`、`SPMUSIC_WAIT_AFTER=1` 后运行同一命令：此前版本的脚本在常驻进程保存首版完整模块，输入 `after` 测量 JSX 复用后的结果及回归，退出码 0。最终脚本重跑该模式还需显式 `SPMUSIC_BENCHMARK=1`。
- 设置 `SPMUSIC_SKIP_BENCH=1` 后运行同一命令：最终源码的独立行为回归（包含额外 metadata/unavailable 断言），退出码 0。
- 完整指定 revision A/B 回放：若需运行，另设 `SPMUSIC_BENCHMARK=1`、可选 `SPMUSIC_BASELINE_REF`。脚本搭建中的完整回放被 Vite dependency browserHash 不一致导致的 504 阻断；修正为逐项 URL 映射后未继续额外采样，因此该可选模式尚未成功验证。
- 设置 `SPMUSIC_DIAGNOSTIC_MODE=1`、`SPMUSIC_BASELINE_MODE=current` 后运行同一命令：Profiler、同步滚轮、样式/几何读取阶段诊断，退出码 0。
- 单因素隔离实验分别设置 `SPMUSIC_DIAGNOSTIC_STYLE='.playlist-card { contain: none !important; }'` / `'.playlist-card { contain: layout style !important; }'`：均退出码 0；无足够稳定收益，生产实验已撤回。
- `npm run build`、`npm run lint -- --ignore-pattern node_modules_old/**`、`git diff --check`：协调者在最终源码上独立运行并通过；Test Agent未重复运行。
- 原始 `npm run lint`：实现者报告被现存 `node_modules_old/fast-uri` 的缺失 `neostandard` 配置阻断，此项不作为本修复失败证据。
- `cargo check` / `npm run tauri dev`：未运行，本次未修改 Rust 或桌面接口。
- `node --check src/features/player/components/playlistViewTransition.browser.test.mjs` 与 Test Agent 最终 `git diff --check`：通过。
- 测试结束后按已核实的进程 ID 清理 Test Agent 启动的常驻 Node harness 及 Vite 子进程；最终查询无该测试脚本或 Vite 遗留进程。
- 可选完整基线回放曾失败：依赖优化缓存冲突及 504；已完成证据采用成功运行的第一/二阶段 A/B，不依赖尚未跑通的可选回放。
- 最终 headless 回归出现 Vite HMR WebSocket 被浏览器本地网络检查阻止的控制台消息；页面组件逻辑仍正常，无 `pageerror`，所有行为断言通过。该 harness 不依赖 HMR，浏览器变化由重新打开页面取得。

## 人工检查

- 视频问题对应十档切换：协调者检查录屏，测试侧以真实组件自动化重建等价路径。
- 原生封面中途占位、真实音频和自定义 CSS 主题：未验证。

## 根因与因果链反证

- 第一修复前后的动画数量相同：0→1 为 48 个、1→0 为 80 个；结束后均为 0，因此改善来自消除重复布局，而非移除动画。
- 第二修复前后卡片数量、DOM 身份、目标读取数量和 demand 顺序相同，减少的是无意义子树协调。
- 替代假设：全量 snapshot 扫描造成主要延迟。1000 条同步 wheel snapshot 仅约 1.4–2.6ms，而首动画启动需要 72–82ms，排除了它是首版剩余瓶颈的主导因素，未引入复杂索引。
- 首版阶段诊断：首个 `getComputedStyle(...).display` 样式刷新约 36–44ms，首目标 rect 读取约 13–19ms，首次 React 更新约 11–23ms。说明样式与实际布局仍随全量 DOM 增长。
- `contain: layout style` 控制实验未稳定降低主要样式成本，已撤回；未用隐藏内容、延时、放宽断言或禁用交互替代修复。

## 跨层契约

- TypeScript/Rust 序列化、command/event、权限：生产差异无跨层契约修改。
- Artwork demand 生命周期：浏览器记录了回调输入和动画结束后的释放；未连接真实 Rust 管线，因此不能证明原生封面解码与保留策略。

## 回归覆盖

- 原始 0↔1 双向切换与十档往返：通过。
- 每 175ms 连续切换 0→9→0，在上一动画尚未结束时反向切换：通过；DOM 身份及顺序保持，结束无残留 FLIP。
- 选中状态跨档保留、当前曲目切换、播放按钮状态与回调：通过。
- 搜索过滤、空结果、恢复完整列表：通过。
- 滚动到列表尾部后 demand 包含尾部曲目：通过。
- 缩小窗口、动画进行中卸载：通过；无页面异常，相关动画清理。
- 系统 reduced-motion 下切换布局：通过，无 FLIP 动画。
- 卡片 JSX 缓存后的 metadata/title 更新与 unavailable 状态更新/恢复：通过，最终源码独立运行 `REGRESSION_PASS`、退出码 0，避免缓存遗漏真实依赖。
- 未覆盖：真实文件替换/音频错误、原生端封面失败/解码时序、自定义布局 CSS、全部视觉遮挡与焦点轮廓。

## 性能 / 时序

每种规模进行 8 次 0↔1 切换；每次保持 1 秒，比较 wheel 到第二个 requestAnimationFrame 的延迟、采样期的 CDP 样式/布局累计量与动画数。不把该延迟等同纯 CPU 时间，不把 1 秒内 style duration 等同单次 commit。

| 样本 | 原始 → 第一修复 | 第一修复 → JSX 复用 |
| --- | --- | --- |
| 500 条切换延迟 | 63.8–88.0 → 42.5–45.9ms | 42.6–50.1 → 36.6–47.6ms |
| 1000 条切换延迟 | 121.2–160.9 → 75.3–82.8ms | 75.8–87.0 → 62.9–78.5ms |
| 每次 LayoutCount | 54/86 → 7 | 7 → 7 |
| 500 条 LayoutDuration | 27.7–46.4 → 8.6–12.3ms | 实际布局成本仍在 |
| 1000 条 LayoutDuration | 56.3–89.8 → 15.8–21.7ms | 实际布局成本仍在 |
| 动画数量 0→1 / 1→0 | 48 / 80 → 48 / 80 | 48 / 80 → 48 / 80 |

二期去掉每组前两次预热后，1000 条切换延迟为 62.9–67.9ms；500 条为 36.6–39.4ms。最终开发浏览器仍可能出现超过 16.7ms 的帧，不能宣称 60fps。

## 发现

- 第一修复有效消除了 FLIP 读写交错导致的重复布局。
- JSX 复用在只改布局的情况下进一步减少协调开销，真实 props 更新必须继续通过依赖列表驱动。
- demand 使用受 FLIP transform 影响的封面 rect 宽度，单次切换仍会出现 `240 → 约238.5 → 155` 或相反的中间尺寸报告。前后相同，此次未修改该契约；原生请求成本未测。

## 风险

全量卡片的样式和布局成本尚存，1000 条开发浏览器结果仍非 60fps；实际 WebView、设备、曲库及主题可能不同。blob fixture 没有真实封面加载压力，因此只证明组件级根因与回归。

## 临时缓解

最终实现不是临时缓解：保留全部卡片、布局与动画，改变产生额外工作的位置。无收益 containment 仅用于诊断并已撤回。

## 验证结论

证据支持两处前端性能根因修复与所列浏览器回归。原生桌面端到端性能验收证据不足；不得据此宣称所有规模和主题完全无卡顿。

## 建议

协调者结合最终 lint/build 与此组件证据收尾，并向用户明确性能提升及原生验证边界。
