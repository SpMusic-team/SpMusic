---
doc_id: "TEST-PLAYLIST-SOURCE-SWITCH-ARTWORK"
title: "测试报告：跨播放来源点歌的列表封面白屏闪烁"
doc_type: "test-report"
status: "in-review"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-21"
updated: "2026-10-21"
source_documents:
  - "user request: 若当前歌曲是从「所有歌曲」中播放的，则点击「播放列表」界面的歌曲时，播放列表界面会白屏闪烁一下，反之也一样，修复它"
  - "src/features/player/components/playlistSourceSwitchArtwork.browser.test.mjs"
---

# 测试报告：跨播放来源点歌的列表封面白屏闪烁

## 摘要

跨播放来源点歌时，播放列表/文件夹详情页与“所有歌曲”聚合页的封面与 hero 不再出现空白帧。独立回归测试在 HEAD 基线（aafaa4f）上稳定失败（详情页 43–54 帧空白、107–396ms），在最终工作区快照上四个场景全部通过（0 空白帧）；object URL 账本与 HEAD 完全一致（created 13 / revoked 7 / live 6，premature revoke 0），封面身份正确且播放器视觉通道仍会接管并替换回退封面，同来源点歌保持 0 空白。结论为**通过**，残余风险见第 11 节。

## 范围

- 用户原始路径 A：当前歌曲来自“所有歌曲”（文件夹来源）→ 打开非 active 的播放列表详情 → 点击该列表歌曲。
- 反向路径 B1：当前歌曲来自播放列表（文件夹 / 导入 M3U8）→ 从媒体库进入文件夹歌曲页 → 点击歌曲。
- 反向路径 B2：当前歌曲来自播放列表 → “所有歌曲”聚合页 → 点击另一文件夹歌曲。
- 对照：同来源点歌。
- 实现质量：症状遮盖、object URL 泄漏/提前 revoke、封面身份与升级、播放语义、既有测试回归。
- 不包含：Tauri 真实音频文件播放、真实 WebView2 IPC 时序、超大音乐库（>80 个常驻封面）压力。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent。
- 修改范围（最终工作区，已按快照钉住）：
  - `src/features/player/components/PlayerShell.tsx`（把只读媒体库封面作为回退层垫在播放器行之下；汇总页同样处理；上报仍在显示的来源路径用于驻留）
  - `src/features/player/hooks/useLibraryArtwork.ts`（新增 `pinned` 驻留集合、`retainSourcePaths`、有界逐出选择）
  - `src/features/player/hooks/useAllSongsWindow.ts`（已有播放器缩略图的行不再重复 probe，避免整窗重建）
  - `src/features/player/model/playlistArtworkFallback.ts`（新增：回退层、驻留路径、逐出选择）
  - `src/features/player/model/playlistArtworkFallback.test.ts`（新增，实现者自测，仅作参考）
  - 前序未提交改动（与本缺陷无直接关系）：`PlaylistLibraryPanel.tsx`、`PlaylistPanel.tsx`、`playlist-management.css`、`playlist-panel.css`（playback command lock 的禁用态外观），以及未跟踪的 `playbackCommandLock.browser.test.mjs`。
- 复现基线：完整。使用 `git archive HEAD` 的隔离快照（HEAD aafaa4f）与独立端口 Vite 复现，见第 6 节。
- 已知证据与待验证假设：实现者主张“回退层保留已渲染的媒体库缩略图，播放器视觉通道仍为权威，因此不闪、不老化”。Test Agent 不采信该主张，独立用逐帧 DOM、object URL 账本、封面像素身份与 A/B 快照验证。
- 证据缺口：未在真实 Tauri/WebView2 与真实音频文件上运行；未覆盖超过媒体库封面缓存上限（80）的大列表；未覆盖快速连续切换、随机播放/全部播放路径与长时间会话内存。
- 快照钉住：`final-phase2-meta.json` 记录 capturedAt `2026-10-21T22:40:36.4476287+08:00`、HEAD `aafaa4f8c276326e3a8d2f50aa8af87979f10786`、7 个修改文件 + 4 个未跟踪文件的 blob hash 与 mtime；测量结束后复核工作区与快照 0 差异。

## 命令

所有测量均在隔离快照上执行（HEAD 快照 `:5182`，最终工作区快照 `:5183`），不直接使用共享 `:5173`。快照用 Test Agent 的 `snapshot.ps1` 物化（`git archive` 或 `git ls-files --cached --others --exclude-standard`；node_modules 逐包 Junction；快照内 `node_modules/.vite`；Vite `watch: null` 冻结源码）。

- `npm run build`（最终快照）：通过（`tsc -b` + `vite build`，2911 modules，Vite 631ms；仅有既有 chunk >500kB 警告）。
- `npx tsc -b --force`（最终快照）：通过（5.4s，完整类型检查）。
- `npm run lint`（最终快照）：通过（11.7s，退出码 0）；`npx eslint` 针对新增测试与 5 个修复文件：通过。
- 新增独立回归 `node src/features/player/components/playlistSourceSwitchArtwork.browser.test.mjs`：
  - 最终快照：**4/4 场景通过**（exit 0）。
  - HEAD 快照：`cross-source` 失败（43/257 帧空白，107–329ms，min ready 0），`reverse-folder` 失败（54/269 帧空白，171–396ms），`same-source`、`all-songs` 通过。
- 既有相关浏览器回归（同一套 16 个测试）：
  - 最终快照：13 通过 / 3 失败（`playlistOffscreenReturn`、`playlistManagement`、`mediaLibraryNavigation`）。
  - HEAD 快照：12 通过 / 4 失败（多一个 `playlistCoverStability`）。
  - 3 个失败在 HEAD 与最终快照上的断言消息完全一致（pre-existing）；`playlistCoverStability` 由 HEAD 失败变为最终通过（改善，非回归）。
- 单元测试（最终快照）：`node --test playlistArtworkFallback.test.ts playlistArtworkGrace.test.ts playlistCoverReadiness.test.ts` → 21/21 通过。
- 未运行的命令：`cargo check` / `npm run tauri dev`（本缺陷为前端渲染/资源所有权问题，最终 diff 不触及 Rust/Tauri 与命令契约；按范围不纳入）。

独立回归测试运行方式（文件头已注明）：

```powershell
$env:SPMUSIC_PLAYWRIGHT = "$env:TEMP\spmusic-pw\node_modules\playwright-core"
# 默认 http://localhost:5173；快照验证时指向隔离端口
$env:SPMUSIC_TEST_ORIGIN = "http://localhost:5183"
node src/features/player/components/playlistSourceSwitchArtwork.browser.test.mjs
# 可选：SPMUSIC_TEST_SCENARIO=cross-source|reverse-folder|same-source|all-songs 只跑子集
```

## 人工检查

- 修复前独立复现：完成（隔离 HEAD 快照；rAF 逐帧 + CDP screencast）。见第 6 节量化表。
- 修复后 A/B 独立验证：完成（同一脚本、同一 mock 口径、同窗口 1120×720）。
- 视觉证据：HEAD 的 CDP 关键帧显示 hero、3 张卡片封面与底部 dock 同时变为浅色占位（近白像素 78.9%–95.9%）；最终快照在点击后 0ms 的关键帧中 hero 与卡片封面仍为已解码的真实封面，页面只发生既有滚动/布局位移。
- 实现者自测未直接采信；实现者的因果链用独立测量反证（见第 8 节）。

## 根因与因果链反证

- 独立复现或等价基线：HEAD aafaa4f 隔离快照上稳定复现；同一仓库测试在 HEAD 上必失败，在最终快照上通过，判别力已验证。
- 因果链逐段核对（独立证据支持）：
  1. 点击其他来源歌曲 → `activatePlaylistScope` 检测到 scope 变化，清空 `playlistTrackVisuals` 并 revoke active scope 的封面 object URL（观察：点击后约 +44ms 同一栈 `releasePlaylistVisuals`；HEAD 修复前行为）。
  2. 正在浏览的列表此刻由“媒体库只读封面行”切换为“播放器行”，而播放器行封面已被清空 → 卡片 `data-cover-state` 从 `ready` 变为 `empty/idle`，hero 首曲缩略图消失（HEAD 逐帧记录：ready 3→0）。
  3. 播放器视觉通道重新 probe/读取像素（真实 IPC 需要时间）→ 页面空白约 107–396ms（HEAD）。
  4. 修复后：播放器行下层垫入同一 `sourcePath` 的媒体库只读缩略图，且媒体库缓存把仍在显示的回退 URL 标记为驻留，不再在切换时被逐出；因此第 2 步不再出现空窗。
- 替代假设与反证尝试：
  - “只是 CSS 动画/延时遮住白屏”：反证——最终 diff 无任何封面可见性/透明度/延迟改动（CSS 仅改 playback-command-lock 的 disabled opacity，与封面无关）；DOM 逐帧显示封面元素始终 `ready` 且解码，screencast 关键帧可见真实封面。
  - “保留旧封面导致封面老化（显示上一来源/上一列表的封面）”：反证——回退层按行 `sourcePath` 取同一文件的媒体库缩略图，像素身份检测显示 Beta 列表始终为 Beta 封面（orange，非 Alpha 的 blue）；播放器视觉通道恢复后可见封面 `src` 从回退 URL 切换为播放器 URL（最终快照 settled 3 张卡片的 src 与点击前不同），说明并非永久冻结旧图。
  - “靠不 revoke / 泄漏换取不闪”：反证——object URL 账本最终快照与 HEAD 完全一致（before created10/revoked4/live6；settled 13/7/6；离开页面 6.5s 后仍 live 6，与 HEAD 相同），premature revoke 0；驻留集合有界（`MAX_RESIDENT` 与逐出选择仍保留硬上限）。
  - “同来源点歌被误伤”：反证——same-source 对照 0 空白，且无新增 object URL 抖动。
- 根因修复而非症状掩盖：通过。修复改变的是“正在浏览列表的封面来源所有权”，让切换期间继续显示真实封面，而不是隐藏/延迟/伪造占位。

## 跨层契约

- TypeScript 类型与序列化：通过。新增 `ReadOnlyArtworkRow`/`withReadOnlyArtworkFallback` 为纯前端行层叠，未改 `PlaylistTrackItemViewModel` 或命令 DTO。
- command / event 名称、方向和输入输出：不适用/通过。最终 diff 未修改 `useAudioPlayer.ts`、`audioCommands.ts`、Tauri 命令/事件或 Rust；native 探针仍按原协议调用（`audio_probe_playlist_cover`、`audio_load_playlist_cover_pixels`）。
- 空值、错误语义、权限与生命周期：通过。回退只在 `coverThumbnail`/`hasLocalArtwork` 缺失时填充；播放器值始终优先；媒体库缓存对该来源路径仍负责 revoke（逐出/卸载/离开页面后与 HEAD 相同）。

## 回归覆盖

- 原始复现路径：通过（最终 0 空白，HEAD 43–54 帧空白）。
- 相邻路径：
  - 反向文件夹歌曲页（当前来自文件夹 / 导入 M3U8）：通过（0 空白；HEAD 32/42 帧空白）。
  - 所有歌曲聚合页：通过（0 空白、4/6 已绘制封面不下降；HEAD 同样 0，保持不回归）。
  - 同来源点歌：通过（0 空白）。
- 关键失败分支：premature revoke = 0；可见封面像素身份正确；播放语义（目标曲目 id、active scope）在切换后正确；封面升级通道仍生效（既有 `playlistCoverPreload` 通过，且回退 URL 在播放器视觉恢复后被替换）。
- 自动化缺口与等价人工证据：真实 Tauri/WebView2 与真实音频文件未跑；超大列表与快速连续切换未覆盖；以上以 mock 原生传输 + 逐帧/CDP 证据替代，残余风险见下。

## 性能 / 时序

- 场景与采样口径：1120×720（Tauri 默认窗口），真实 `PlayerShell`/`PlayerSurface`/播放器 hook，mock 原生传输；封面像素读取固定 100ms（独立复现）/120ms（仓库回归）延迟，HEAD 与最终快照同口径；逐帧 `requestAnimationFrame` 记录卡片 `data-cover-state=ready` 数与 hero 解码图数量，CDP screencast 记录真实帧亮度。
- 修复前基线（HEAD aafaa4f）：
  - A：详情页 33/空白帧，103.4–289.5ms；hero 10 帧；面板亮度 183.28 → **238.22 @108ms（+54.94）**，近白像素 78.9%。
  - 反向文件夹页：32 帧，131.2–312.7ms；亮度 +60.82（近白 95.9%）。
  - 反向（M3U8 当前来源）：42 帧，197.3–378.5ms；亮度 +60.91（近白 95.6%）。
- 修复后结果（最终快照）：
  - A：0 空白帧，hero 0 空白；亮度 183.47 → 195.8（点击后稳定值，含既有滚动/选中态位移，**无瞬时白屏尖峰**，lightRatio 0.444→0.548 稳定）。
  - 反向文件夹页 / M3U8：0 空白帧，hero 0；亮度变化为稳定的滚动/布局位移，无 HEAD 的瞬时尖峰。
  - 仓库回归测试：四场景 0/254、0/253、0/270、0/259 帧空白。
- 重复、乱序、并发、取消与资源清理：同一页面重复切换（HEAD/最终均测）不增加驻留；离开页面 6.5s 后 object URL 存活数与 HEAD 相同（6 个，属既有媒体库/播放器缓存设计）；premature revoke 0；无控制台错误。

## 发现

- 修复有效且未引入新增空白帧、premature revoke、object URL 泄漏或封面身份错误。
- 既有的 3 个动画/布局类浏览器测试（`playlistOffscreenReturn`、`playlistManagement`、`mediaLibraryNavigation`）在 HEAD 与最终快照上以完全相同的断言失败，属 pre-existing（`playlistManagement` 在 HEAD 默认启动页为 player 的场景下等待媒体库总览；`mediaLibraryNavigation` 为 1280 宽动画 opacity 端点；`playlistOffscreenReturn` 为动画起始几何），不计入本次修复的新增差异。
- `playlistCoverStability` 在 HEAD 失败、最终快照通过（含 missingFrames=0、undecodedFrames=0），为改善；该测试本身对时序敏感，单次运行结果不单独作为强证据。

## 风险

- 媒体库只读封面缓存上限为 80；若同屏/驻留回退封面超过上限（超大列表或极端窗口），逐出选择在“全部驻留”时仍会回收一个在屏封面（有界内存硬约束），可能出现单行短暂刷新；本次未覆盖 >80 场景。
- 驻留集合在 commit 之后的 effect 中更新；理论上存在“先显示、后驻留”的微窗口，本次仪器未观测到 premature revoke（0），但未做形式化证明。
- 回退封面分辨率可能低于播放器 hero 目标分辨率，播放器视觉通道接管前会短暂显示较低分辨率（属渐进升级，非空白）；本次未逐帧量化分辨率差异。
- 验证使用 headless Edge + mock 原生传输；真实 WebView2/真实文件 IPC 时序可能不同（断言基于帧与 DOM 状态，不依赖固定延时，但未在真实应用内复跑）。
- 仍存在 pre-existing 红测（3 个），会使仓库测试信号继续含噪；与本次修复无关。

## 临时缓解

- 是否为临时缓解：否。修复改变了封面来源所有权与缓存驻留策略，不是 CSS 遮盖、延时、占位伪造或禁用动画。
- 适用边界与未解决风险：见第 11 节。
- 撤除条件、跟踪任务和后续 Owner：无临时缓解需要撤除；若后续引入更大列表/更高并发封面，需要 PM/Architecture 评估缓存上限与驻留策略（Owner：Frontend Agent）。

## 验证结论

**通过。** 独立、隔离快照上的 A/B 证据满足：pre-fix HEAD 必失败、最终工作区通过；原始与相邻路径均无空白帧；同来源对照与聚合页无回归；object URL 生命周期、封面身份/升级、播放语义均未发现退化。结论强度受限于未在真实 Tauri/WebView2 与超大列表场景中复跑（见风险）。

## 建议

建议交回 Lead/PM Agent 进行最终验收；合并前请保持新增回归测试与生产改动一并纳入，并知悉 3 个 pre-existing 动画类浏览器测试失败与本修复无关。若后续要提升结论强度，可在真实 Tauri 应用中对同一路径做一次录屏抽检，并补充 >80 常驻封面的大列表场景。
