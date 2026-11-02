---
doc_id: "PERF-BASELINE-001"
title: "媒体库列表加载速度基线（2026-11-02，当前版本）"
doc_type: "performance-baseline"
status: "已记录，复现入口可用"
owner_agent: "Test Agent"
module: "媒体库列表加载与封面前瞻预取"
version_scope: "project"
created: "2026-11-02"
updated: "2026-11-02"
source_documents:
  - "用户反馈：从搜索页加入后歌曲列表加载变慢；随后澄清媒体库下各个视图的列表都慢，且 10-25 版本已有「所有歌曲」可作基线"
  - "docs/test/playlist-add-load-path-analysis.md（静态链路分析；§8 歌单场景实测；§9 媒体库各视图实测）"
  - "tools/perf-regression/（测量工具）"
  - "tools/perf-regression/results/current/（原始 JSON）"
---

# 媒体库列表加载速度基线（2026-11-02）

> **这份文档记录的是当前版本的实测速度数值，用于后续对照，不是性能承诺。**
> 所有数据来自受控浏览器 + 打桩原生 IPC（见 §5 证据边界），绝对数值不代表真实设备；跨版本用同一模型测量，相对结论可用。

## 0. 一句话结论

- **「所有歌曲」列表首行出现时间与曲库规模近似线性：约每 300 首 +190 ms。** 1800 首曲库下为 **1452 ms**。
- 该耗时几乎全部来自**全库标签摘要探测**（1800 首单次打开：8 批 / 646 ms），因为它阻塞了首行渲染。
- 与 10-25 版本（`8f45750`）相比**没有变慢**：同为 1800 首时 10-25 为 1497 ms，当前版本 1452 ms。
- 歌单场景：热态重开 **0 次原生请求**；追加 6 首后重开变为 **20 次**，t90 265.9 ms → 453.7 ms。

---

## 1. 测量环境

| 项 | 值 |
|---|---|
| 被测提交 | `ce65f67`（工作树，含 2026-11-02 本地未提交改动） |
| 前端服务 | Vite 8.1.3 dev server（`tools/perf-regression/vite.perf.config.mts`，root 取当前 worktree） |
| 浏览器 | msedge 157.0.4341.30（Playwright，headless） |
| 视口 | 1600 × 1000 CSS px，`prefers-reduced-motion: reduce` |
| Node | v24.19.0 |
| 曲库 | 由 fixture 合成：`/perf/library/N.flac`，真实 `SPXR` 封面线格式，合成标签（专辑=`Album N%3`，艺术家=`Artist N%5`） |
| 起始页 | `spmusic.player.startup-page.v1 = media-library`，清空 `spmusic.player.session.v1` |
| 布局级别 | `playlist.layout-level` / `all-songs.layout-level` = 1 |

**打桩边界**：只有原生 IPC 是假的（`audioCommands.ts` 被替换为 `window.backendInvoke`）。React 组件、列表窗口、封面调度器、`SPXR` 解码与 BMP/objectURL 管线均为生产代码。

**固定延迟模型**（写入每个结果文件的 `engine.mockedLatencyModel`）：

| 命令 | 延迟 |
|---|---|
| `audio_load_track_thumbnail` | 18 ms / 次 |
| `audio_load_playlist_cover_pixels` | 22 ms / 次 |
| `audio_probe_playlist_cover` | 4 ms / 次 |
| `audio_hydrate_track` | 6 ms / 次 |
| `audio_probe_playlist_track_summaries` | 2 ms + 0.35 ms/首（每批 256 首） |
| `audio_probe_playlist_durations` | 2 ms + 0.35 ms/首（每批 256 首） |
| `library_scan_folder` | 12 ms / 次 |

封面调度并发上限 4（`playlistCoverScheduler.ts` 的生产值），因此 N 张可见封面约需 `ceil(N/4) × 18 ms`。

---

## 2. 媒体库「所有歌曲」：当前版本

指标定义：
- **`firstRowAtMs`**：切换到该视图 → **第一行卡片真正渲染**的时间。该视图在标签/时长未就绪时渲染骨架屏，所以这就是用户看到的"列表加载完成"。
- **`t90FirstVisibleMs`**：随后初始可见行（12 行）的封面到齐时间（90 分位）。

### 2.1 按曲库规模（表中数值均为**单次打开**的均值；90/300/900 为单次运行，1800 为 2 次中位/均值）

| 曲库曲目数 | `firstRowAtMs` | `t90FirstVisibleMs` | 原生请求 | 摘要探测 | 封面请求 |
|---:|---:|---:|---:|---:|---:|
| 90 | 383.5 ms | 552.4 ms | 22 | 1 批 / 33.5 ms | 19 / 342 ms |
| 300 | 530.9 ms | 644.6 ms | 19 | 2 批 / 109 ms | 15 / 270 ms |
| 900 | 812.6 ms | 880.6 ms | 25 | 4 批 / 323 ms | 19 / 342 ms |
| 1800 | 1451.9 ms | 1566.8 ms | 27 | 8 批 / 646 ms | 17 / 306 ms |

线性回归（`firstRowAtMs` vs 曲目数）：约 **+190 ms / 300 首**，截距约 300 ms。

### 2.2 重复测量（稳定性）

| 配置 | 次数 | `firstRowAtMs`（中位） | `t90`（中位） | 原生请求 |
|---|---:|---:|---:|---:|
| 900 首 | 3 | 812.2 ms | 886.2 ms | 25 |
| 1800 首 | 2 | 1451.9 ms | 1566.8 ms | 27 |

三次 900 首的 `nativeModelledMs` 完全一致（667/667/667），两次 1800 首同样一致（954/954），说明该受控环境的测量可重复性良好。

---

## 3. 歌单详情页：热态重开 vs 追加后重开

300 首歌单，`--playlist-size 300 --selection 6 --repeat 3`。

| 场景 | `t90FirstVisibleMs` | 原生请求 | 建模成本 | 加入动作耗时 |
|---|---:|---:|---:|---:|
| **热态重开**（打开过再打开，无加入） | **265.9 ms** | **0** | 0 ms | — |
| **追加 6 首后打开** | **453.7 ms** | **20** | 350 ms | 275.1 ms |

命令构成：`audio_load_track_thumbnail` ×18（324 ms）、`audio_probe_playlist_cover` ×1、`audio_load_playlist_cover_pixels` ×1。

`18 = 12 个已缓存的可见行 + 6 首新歌` —— 追加动作让**本来已缓存好的 12 个可见封面被重新请求了一遍**，不只是加载新增的 6 首。

另外：加入动作自身耗时 **275.1 ms**（其中含整表摘要/时长探测，在 `addToPlaylist` 内部就起跑，不计入"随后打开"）。

### 3.1 搜索页新建歌单（小规模对照，`--selection 6`）

| 场景 | `t90FirstVisibleMs` | 说明 |
|---|---:|---|
| 搜索页选 6 首新建歌单 → 立即打开 | 345.7 ms | k=6 |
| 同上，离开 2.5 s 后再打开 | 337.3 ms | k=6 |
| 冷开同等内容的现有歌单 | 352.0 ms | k=6 |

三者差异在噪声内，`sourcePath` 集合哈希一致（`a1e71fb0`）。**新建列表只有 k 首，没有 N 倍放大。**

---

## 4. 跨版本对照

同一 fixture、同视口、同延迟模型；两侧 `sourcePath` 集合哈希一致。

### 4.1 「所有歌曲」1800 首（`--repeat 2`；"封面请求/每次打开"列为单次均值）

| 版本 | 提交 | `firstRowAtMs` | `t90` | 原生请求 | 摘要探测（每次） | 封面请求（每次） |
|---|---|---:|---:|---:|---:|---:|
| **10-25** | `8f45750` | **1497.5 ms** | 1621.9 ms | 24 | 8 批 / 646 ms | 14 / 252 ms |
| **当前** | `ce65f67` | **1451.9 ms** | 1566.8 ms | 27 | 8 批 / 646 ms | 17 / 306 ms |

**当前版本比 10-25 快约 46 ms（3%）。** 摘要探测批次数与耗时**完全相同**；差异只在封面预取（每次打开多约 3 条，+54 ms 建模成本）。

### 4.2 「所有歌曲」900 首（`--repeat 3`；"封面请求/每次打开"列为单次均值）

| 版本 | `firstRowAtMs` | `t90` | 原生请求 | 摘要探测（每次） | 封面请求（每次） |
|---|---:|---:|---:|---:|---:|
| `8f45750`（10-25） | 699.7 ms | 781.6 ms | 22 | 4 批 / 323 ms | 15.7 / 282 ms |
| `ce65f67`（当前） | 812.2 ms | 886.2 ms | 25 | 4 批 / 323 ms | 19 / 342 ms |

900 首时当前版本慢约 112 ms（+16%），1800 首时反而快 46 ms。**两端差异不构成一致的退化趋势**，且摘要探测始终相同；差异全部落在封面预取条数上（每次多 2～3 条）。

### 4.3 歌单热态重开（300 首，无加入）

| 版本 | `t90` | 原生请求 |
|---|---:|---:|
| `8f45750`（10-25） | 234.2 ms | 0 |
| `6a7da1b`（10-28） | 394.9 ms | 0 |
| `9e8d41c`（10-30） | 248.1 ms | 0 |
| `ce65f67`（10-30） | 276.2 ms | 0 |
| 当前工作树 | 265.9 ms | 0 |

**热态重开在所有版本都是 0 次原生请求**，即"打开已加载过的歌单"一直很快。

### 4.4 追加 6 首后打开（300 首歌单）

| 版本 | `t90` | 原生请求 | 加入动作耗时 |
|---|---:|---:|---:|
| `9e8d41c`（10-30） | 426.5 ms | 20 | 292.4 ms |
| `ce65f67`（10-30） | 420.8 ms | 20 | 285.0 ms |
| 当前工作树 | 453.7 ms | 20 | 275.1 ms |

三个版本一致。

### 4.5 版本能力约束（影响可比性）

| 版本 | 搜索页 | 「加入已有歌单」 | 可测场景 |
|---|---|---|---|
| `8f45750` 10-25 | 无 | **无** | 仅 `SA` / `SW` / `S2` |
| `6a7da1b` 10-28 | 无 | 有，但对话框 UI 与现行选择器不兼容 | 仅 `SA` / `SW` |
| `9e8d41c` 10-30 起 | 有 | 有 | 全部 |

「所有歌曲」在 `8f45750` 与当前都存在，是唯一可贯穿全部版本对比的列表视图。

---

## 5. 证据边界

1. **未模拟磁盘缓存命中**：`audio_load_track_thumbnail` 恒 18 ms。真实设备上这些多为已持久化缩略图（本机 `thumbnail-index-v1` 有 2356 条），封面部分实际更快。
2. **摘要探测被低估**：mock 为 2 ms + 0.35 ms/首；真实 Rust 侧要真读标签，成本只会更高。因此"列表加载 ∝ 曲库规模"在真实环境只会更明显，不是被打桩夸大。
3. 浏览器 + 打桩 IPC 的**绝对数值**不等于真实设备；但两端用同一模型测量，**相对结论**（无版本退化、成本 ∝ N）不受模型选择影响。
4. 未覆盖：真实 1791 首曲库、真实磁盘、Windows Defender 实时扫描、多 folder 根并存、高 DPI。
5. 集合视图（专辑/艺术家/文件夹）的 fixture 专辑仅 3 个（`Album N%3`），不足以代表真实专辑规模。

---

## 6. 复现

```powershell
$env:SPMUSIC_PLAYWRIGHT = 'C:\Users\winkeses\.dsh\tools\node_repl\node_modules\playwright'

# 当前版本，「所有歌曲」1800 首，2 次
node tools/perf-regression/run.mjs --worktree D:\SpMusic --version-id V5 `
  --scenarios SA --library-size 1800 --repeat 2 `
  --out tools/perf-regression/results/current/final-V5-1800.json

# 历史版本（先准备 worktree；默认放在仓库外的 ..\SpMusic-perf-versions）
node tools/perf-regression/versions/prepare-versions.mjs
node tools/perf-regression/run.mjs --worktree D:\SpMusic-perf-versions\V1 --version-id V1 `
  --scenarios SA --library-size 1800 --repeat 2 `
  --out tools/perf-regression/results/current/final-V1-1800.json

# 歌单：热重开 vs 追加后打开
node tools/perf-regression/run.mjs --worktree D:\SpMusic --version-id V5 `
  --scenarios SW,S3 --playlist-size 300 --selection 6 --repeat 3 `
  --out tools/perf-regression/results/current/final-V5.json

# 集合视图（专辑）
node tools/perf-regression/run.mjs --worktree D:\SpMusic --version-id V5 `
  --scenarios SC --category album --library-size 900 `
  --out tools/perf-regression/results/current/sc-album.json
```

原始数据：`tools/perf-regression/results/current/`
- `final-V5-SA.json`、`final-V5-1800.json`（当前版本）
- `final-V1-SA.json`、`final-V1-1800.json`（10-25 基线）
- `final-V5.json`（歌单 SW/S3）

harness 会校验目标 dev server 返回的 `PlayerShell.tsx` 确实来自指定 worktree（结果里的 `engine.originVerified`），避免测到错误版本。

---

## 7. 与其它文档的关系

- [playlist-add-load-path-analysis.md](playlist-add-load-path-analysis.md)：静态链路分析（含 file:line 与"哪一版引入"）与同批实测的详细推导。本文只保留**速度数值**，便于后续对照。
- `docs/architecture/playlist-track-summaries.md`：摘要通道的验收条款（AC-16 / R2），改动摘要门控前必须先看该文档。
- `docs/changes/optimizations/OPT-0016.md`：缩略图持久化与列表封面加载的既有优化记录。
- `docs/changes/bugs/BUG-0019.md`：播放列表封面加载的历史修复记录。

## 8. 已知的慢因定位（供后续优化排序）

实测已排除"版本回归"与"渲染层退化"。当前成本结构：

1. **标签摘要整库探测阻塞首行**（∝ 曲库曲目数）—— 主要项，1800 首单次约 646 ms（900 首约 323 ms）。
2. **封面请求**（∝ 可见卡片数 + 预取条数）—— 次要项，约 300～600 ms 建模成本。
3. 追加动作会重置已缓存封面需求，使可见行重新请求（0 → 18 条）。
4. 追加动作自身耗时约 275～292 ms（含整表摘要/时长 pass）。

优化方向（**均未实施**）见 [playlist-add-load-path-analysis.md](playlist-add-load-path-analysis.md) §9.7。
