---
doc_id: "PERF-SCROLL-001"
title: "拖动/滚动媒体库歌曲列表的分段耗时实测（2026-11-02）"
doc_type: "performance-baseline"
status: "已实测"
owner_agent: "Test Agent"
module: "媒体库列表拖动/滚动与封面加载"
version_scope: "project"
created: "2026-11-02"
updated: "2026-11-02"
source_documents:
  - "用户反馈：媒体库各分类的歌曲列表在拖动时加载仍不够快"
  - "docs/test/list-load-performance-baseline-2026-11-02.md（首屏基线；本文补齐拖动期）"
  - "tools/perf-regression/scroll-probe.mjs（新增探针，未改 run.mjs / lib/* / src/）"
  - "tools/perf-regression/results/current/scroll-900-1800-l4-l1-playlist.json（原始数据，11.5 MB）"
---

# 拖动/滚动媒体库歌曲列表的分段耗时实测（2026-11-02）

> 本文补的是「拖动期」成本；「切到列表那一下」的成本见 [list-load-performance-baseline-2026-11-02.md](list-load-performance-baseline-2026-11-02.md)。
> 两者是不同阶段、不同瓶颈、不同优化手段。

工具: `tools/perf-regression/scroll-probe.mjs`（新增，未改 `run.mjs` / `lib/*` / `src/`）
原始数据: `tools/perf-regression/results/current/scroll-900-1800-l4-l1-playlist.json`（11.5 MB，12 次页面测量）

---

## 0. 一句话结论

拖动期间的成本**不在标签/时长探测**（那是首屏慢的成因），而**只有一件事：逐张封面缩略图**。
瓶颈是**封面流水线吞吐 ~56–67 张/秒 &lt; 拖动产生的行速 75–243 张/秒**，导致 88–93% 的行「进视口后还没等到封面就滑走了」；
其中 **窗口化布局（默认 level 4）额外把 Scroll 的每帧脚本成本抬到 3.0–3.2 ms（tile 全量布局 1.34 ms）**，
原因是 `viewport` 状态落在 629 行的 `PlaylistLibraryPanel` 内部，每个滚动帧 `setViewport` 都会重跑整个面板函数体，
并伴随边缘卡片挂载/卸载带来的 1 次 ~46–63 元素样式重算。
反向滚回与正向成本完全对称（缓存没有帮上忙）。

> 归因更正（Lead 复核）：初版把每帧重渲染归因于 `index={window.first + index}` 打穿 `memo`，这是错的。
> 该 `index` 是**绝对索引**：同一张卡在窗口滑动前后的取值不变（滚动前位于位置 k 时是 `first+k`，滚动后位于 k−1 时是 `(first+1)+(k−1)`），
> 因此 `AllSongsCard` 的 `memo` 是生效的。反证：若 11–12 张卡全部重渲染，`UpdateLayoutTree.elementCount` 应在数百量级，
> 实测 p95 = 46 / max = 63，**只有一张卡子树的量级**。真实来源是「面板函数体每帧重跑 + 边缘卡片挂载/卸载」。

---

## 1. 口径（先说清）

- **「拖动」= 滚动位置变化**。媒体库「所有歌曲 / 播放列表 / 文件夹」分类列表**没有鼠标按住拖动滚动**
  （`usePlaylistOverscroll` 只挂在 Album / Folder / Playlist 面板上），所以用真实滚轮 `page.mouse.wheel`
  （deltaY = 面板视口 1/3，16 ms 间隔）驱动，等价于拖滚动条。
- 每轮测量：`idle`（静置 800ms 校准帧预算）→ `forward-1..6`（分段滚到底，第 3 段后插 1s 停顿 = 中段停 1s 对照）
  → `settle-bottom` → `backward`（反向滚回顶部）→ `settle-top`。
- 「封面就绪」= `img.complete && img.naturalWidth > 0`（像素可用）。context 用 `reducedMotion=reduce`，
  cover reveal 动画被禁用，因此与 baseline 的 `opacity>=0.99` 口径等价（结果里 `transparentReady` 计数为证）。
- 打桩边界：**只有原生 IPC（Rust 进程 + 文件系统）是假的**，`audioCommands.ts` 被替换为 `window.backendInvoke`，
  固定延迟模型见下。React 组件、列表渲染窗口、封面调度器、SPXR 解码、BMP/objectURL 管线全是生产代码。
  前端 Vite dev 构建（未压缩），绝对数值不代表真机，只用于同环境内比较。

| 命令 | 建模延迟 |
|---|---|
| `audio_load_track_thumbnail` | 18 ms / 次 |
| `audio_probe_playlist_track_summaries` | 2 ms + 0.35 ms/首（每批 256 首） |
| `audio_probe_playlist_durations` | 2 ms + 0.35 ms/首 |
| `library_warm_cover_thumbnails` | 2 ms + 0.2 ms/首 |
| `audio_begin_playlist_cover_window` | 1 ms（每次挂载窗口 1 次，不在拖动期） |

---

## 2. 四组对照表（中位数，n=3 / n=3 / n=2 / n=2）

| 指标 | l4-900 | l4-1800 | l1-900 | l1-1800 |
|---|---|---|---|---|
| 布局（all-songs.level） | 4 单列中封面 | 4 | 1 三列 tile | 1 |
| 渲染窗口 | 窗口化 | 窗口化 | **全量挂载** | **全量挂载** |
| **已挂载 `[data-playlist-track-id]`** | **7–12（p50 12）** | **7–12（12）** | **900** | **1800** |
| 首屏 `firstRowAtMs` | 721 ms | 1034 ms | 1054 ms | 1693 ms |
| 首屏 `t90FirstVisibleMs` | 721 ms | 1034 ms | 1171 ms | 1914 ms |
| 首屏原生命令 | 26 次 / 1268 ms | 43 / 2478 ms | 36 / 1583 ms | 55 / 2894 ms |
| 滚动距离 | 131 047 px | 262 447 px | 40 577 px | 81 527 px |
| wheel 事件数 | 410 | 820 | 127 | 255 |
| **ms / wheel 事件** | **29.1** | **27.8** | **29.1** | **31.0** |
| 拖动墙钟 | 11 929 ms | 22 803 ms | 3 700 ms | 7 895 ms |
| 帧间隔 p50 / p95 / max | 3.1 / 15.6 / 140.7 | 3.1 / 12.6 / 147.0 | 3.1 / 9.4 / 359.5 | 3.1 / 14.1 / 401.6 |
| >33 ms 帧数 | 6 | 5 | 1 | 1 |
| >50 ms 帧数 | 1 | 1 | 1 | 1 |
| long task 数 / 总时长 | 1 / 139 ms | 1 / 146 ms | 1 / 357 ms | 1 / 397 ms |
| 主线程 Task 合计（占墙钟） | 11 234 ms（0.94） | 21 432（0.94） | 2 933（0.79） | 6 876（0.87） |
| Script 合计 | 7 729 ms | 14 319 ms | 1 155 ms | 2 188 ms |
| **Task / 帧** | **4.69 ms** | **4.50 ms** | **3.42 ms** | **4.21 ms** |
| → 折算 60 fps 预算占比 | 28.1 % | 26.9 % | 20.5 % | 25.2 % |
| **Script / 帧** | **3.22 ms** | **3.01 ms** | **1.35 ms** | **1.34 ms** |
| LayoutDuration | 234 ms | 446 ms | 120 ms | 362 ms |
| RecalcStyleDuration | 369 ms | 730 ms | 22 ms | 43 ms |
| LayoutCount | 555 | 1 110 | 112 | 185 |
| UpdateLayoutTree 事件数 | 2 001 | trace 超限 | 281 | 435 |
| **elementCount p50 / p90 / p95 / max** | **2 / 34 / 46 / 63** | — | **3 / 3 / 3.5 / 63** | **3 / 3 / 6 / 63** |
| **elementCount ≥20 的重算次数** | **819**（≈每 wheel 事件 1 次） | — | **4** | **4** |
| 原生命令（拖动期） | 677 次 / 12 186 ms | 1 372 / 24 696 | 249 / 4 482 | 453 / 8 154 |
| 封面吞吐 | 56.4 张/s | 60.2 张/s | 67.3 张/s | 57.4 张/s |
| 卡片进视口速率 | 75.5 /s | 78.9 /s | 243.3 /s（=81 行/s） | 228.2 /s（=76 行/s） |
| 进视口时封面**已**就绪 | 12（1.3 %） | 12（0.7 %） | 31（3.4 %） | 30（1.7 %） |
| 进视口后才到达 | 74 | 106 | 74 | 104 |
| **可见期内封面始终没到** | **814（90.4 %）** | **1 680（93.3 %）** | **795（88.3 %）** | **1 667（92.6 %）** |
| 延迟（仅「进视口后才到」的）p50 / p90 / max | 91.6 / 122.3 / 147.1 ms | 85.4 / 119.8 / 156.7 | 119.9 / 266.1 / 319.1 | 136.4 / 345.3 / 469.8 |
| 延迟（全部进入行）p50 / p90 | 82.9 / 120.9 ms | 79.3 / 119.5 | 87.4 / 255.4 | 116.3 / 323.1 |
| `mountToEnterMs` p50 | 4.7 ms | 4.5 ms | 3 370 ms | 5 589 ms |
| 中段停 1s：Task / 新增封面 / 有像素卡 | 159 ms / 6 / 3→10 | 153 / 5 / 3→10 | 552 / 30 / 61→61 | 835 / 33 / 61→61 |
| 反向滚回：墙钟 / Task / native | 11 680 / 10 947 / 677 | 24 093 / 22 809 / 1 332 | 3 662 / 2 819 / 241 | 8 051 / 6 913 / 431 |

（补测一行：`playlist` 播放列表详情页 900 首、布局 0 两列大封面、全量挂载 → 见 §3.6。）

---

## 3. 逐条确认/修正

### 3.1 滚动推进速度：确认，四组一致（29.1 / 27.8 / 29.1 / 31.0 ms 每 wheel 事件）
窗口化 vs tile 全量**不改变**滚动推进的每事件成本；差异只在总距离（单列 131k/262k px vs 三列 40k/81k px）。
「tile 快 3.2×」是距离差异造成的错觉，确认是误解。

### 3.2 每帧脚本成本 2.3×：确认，来源是每帧 `setViewport` → 面板函数体重跑 + 边缘卡片换页
证据链：
- 每次滚动事件恰好产生 **1 次 elementCount ≥20 的样式重算**（l4-900：819 次 ≈ 820 个 wheel 事件/轮），
  elementCount p95 = 46、max = 63 ≈ **一张卡片的子树**；tile 全量布局同口径只有 **4 次**（全程）。
- 机制：`useAllSongsRenderWindow` 的 `scheduleMeasure` 每帧 `setViewport`（`viewport.top` 随滚动逐帧变化，
  `:43-44` 的相等短路只在增量 <1px 时命中）→ `PlaylistLibraryPanel`（629 行、约 40 个 hook、大量 `useMemo`/`useCallback`
  命中检查）整个函数体在每个滚动帧重跑 → 窗口跨行时再挂载/卸载边缘卡片（每次 elementCount 46–63 的样式重算）。
- **`memo` 本身是生效的**：`index={songsWindow.first + index}`（`PlaylistLibraryPanel.tsx:571`）是绝对索引，
  同一卡片在窗口滑动前后取值不变，故 `AllSongsCard` / `PlaylistCard` 不重渲染；elementCount 只有单卡量级即是反证。
  代价不在卡片重渲染，而在**面板函数体每帧重跑**及其 JSX 重建。
- tile 布局 `enabled = count > 100 && flow !== 'tile'` 为 false → `first=0,end=count` → **滚动不触发任何重渲染**，
  所以 Script/帧只有 1.34–1.35 ms。
- 结果：l4 的 Script/帧 = 3.22/3.01 ms，是 l1 的 2.4×；LayoutCount 555/1110 vs 112/185；RecalcStyle 369/730 vs 22/43 ms。

### 3.3 封面吞吐 ~56–67 张/s < 行速 75–243：确认，但「每张实际占用」不是 23 ms 而是 ~35 ms
按「2 并发 ÷ 实测吞吐」反推服务时间：l4-900 = 2 ÷ 56.4 = **35.5 ms/张**（其中 18 ms 是建模 IPC，
⇒ 前端占 ~17.5 ms）；l1-900 = 2 ÷ 67.3 = 29.7 ms/张；playlist 详情页 = 2 ÷ 24.6 = **81 ms/张**（主线程被抢空）。
即：**封面服务时间不是常数，它随主线程繁忙度上升**（IPC 18 ms 固定，BMP 编码 + `img.decode()` + store 通知 +
React 提交在主线程上排队）。l4 主线程 0.94 占用 → 服务时间 35 ms；playlist 主线程 1.00 占用 → 81 ms。
所以「mock 18 ms × 2 并发 = 111 张/s」是上界，实际只能到一半左右，且会随页内 JS 挤压进一步下降。

### 3.4 `preloadedRatio` 与 `mountToEnterMs` 的口径
- `preloadedRatio` = 该行**第一次进入面板视口的那一帧**，`<img>` 已经 `complete && naturalWidth>0` 的行占比。
  实测 0.7 %–3.4 %，确认「进入前就已备好」几乎不存在。
- `mountToEnterMs` = 卡片节点第一次出现在 DOM → 该行第一次进入视口的间隔。
  **l4 中位 4.5 ms 的含义是「卡片几乎在进入视口的同一帧才挂载」**（渲染窗口只多挂 2 行 overscan，
  而封面 IO 的 `rootMargin` 只有 150 px ≈ 1 行，所以预挂载行**不会**提前取封面）→ 这就是 preload≈0 的结构原因。
  **l1 中位 3 370/5 589 ms 不代表预取提前量**，它只是「列表整体挂载后过了多久这一行才被滚到」，
  因为 tile 布局 1800 张卡在首帧就全部挂载了。这两组数不能互相比较。

### 3.5 l1（tile 全量）延迟更差：确认，原因是「可见卡多 → 排队深」，不是挂载量大
- 可见卡数：l4 约 7 张（1 列），l1 约 15 张（3 列）→ 同样 2 并发下补满一个窗口需 15/2×35 ≈ 260 ms vs 7/2×35 ≈ 120 ms。
  实测 p90：l1-900 266 ms、l1-1800 345 ms vs l4 120 ms，比例与推算一致。
- tile 的 `desired` 集合更大（IO 观察 900/1800 个节点、可见 + 150 px overscan），每轮滚动一次提交的封面需求更多。
- 但 tile 的 p50 与 l4 同量级（87–136 ms），差的是尾部。

### 3.6 补测：播放列表详情页（900 首，布局 0，全量挂载，n=2）
| 指标 | 值 |
|---|---|
| 已挂载卡片 | 900 |
| ms / wheel 事件 | **50.7**（库列表 29 ms 的 1.7×） |
| 帧 p50 / p95 / max | 3.2 / **31.3** / 231.2 ms |
| >33 ms 帧 / >50 ms 帧 | **61.5 / 52**（中位每次测量 52 次掉帧） |
| long task | **50.5 次 / 3 408 ms**（最长 223 ms） |
| Task 合计（占墙钟） | **12 794 ms（1.00，主线程已饱和）** |
| Task / 帧 → 60 fps 占比 | **9.96 ms → 59.6 %** |
| Script / 帧 | **6.51 ms** |
| 封面吞吐 | **24.6 张/s**（服务时间 81 ms/张） |
| 封面延迟 p50 / p90 | 183.1 / 299.6 ms |
| 反向滚回 Task | 11 439 ms |

结论：**「播放列表详情页」比媒体库列表更差**——它是全量挂载且每次滚动都回调
`onVisibleTrackIdsChange`（`PlaylistPanel.tsx:615-747`），把可见 id 集合推给上层 → 主线程饱和 →
封面服务时间涨到 81 ms，形成「越卡越慢」的正反馈。

### 3.7 `mainThreadBusyRatio` 0.94 的换算（口径提醒，避免误读）
headless 无 vsync，rAF 约 3.1 ms/帧（约 320 fps），所以「Task 合计 / 墙钟 = 0.94」**不能**当作真机 60 fps 的占用率。
按「每帧 Task」换算才有意义：
- l4-900 4.69 ms/帧 → **28.1 %** of 16.7 ms（l4-1800 26.9 %）
- l1-900 3.42 ms/帧 → **20.5 %**（l1-1800 25.2 %）
- playlist-900 9.96 ms/帧 → **59.6 %**
真机 60 fps 下，l4 的单帧脚本+样式已吃掉约 1/4 预算，再加上解码/合成，掉帧风险显著；tile 约 1/5。

---

## 4. 成本随位置如何变化：**常数**（首段略重，不是前重后轻，也不是线性）

正向 6 等分段的 Task（ms）：

| 段（滚动位置） | l4-900 | l4-1800 | l1-900 | l1-1800 |
|---|---|---|---|---|
| forward-1（0 px） | 2 145 | 4 303 | 815 | 1 541 |
| forward-2 | 1 970 | 3 692 | 449 | 1 064 |
| forward-3 | 1 785 | 3 708 | 440 | 1 185 |
| forward-4 | 1 741 | 3 631 | 410 | 1 140 |
| forward-5 | 1 804 | 3 517 | 401 | 1 104 |
| forward-6 | 1 788 | 3 814 | 440 | 1 149 |
| 中段停 1s | 159 | 153 | 552 | 835 |
| 反向滚回（等距离） | 10 947 | 22 809 | 2 819 | 6 913 |

- 首段比其余段贵 18–23 %（l4）/ 2×（l1-900 首段，因为包含首次 IO 观察与首批封面），之后**完全持平**。
- 页内「进视口 → 封面到达」延迟按滚动深度 10 等分：l4-900 p50 在 74–125 ms 之间波动，**无深度趋势**；
  l1-900 在 38–187 ms 波动，同样无趋势。→ **不是后段变慢，是全程同一个瓶颈。**
- 反向滚回 ≈ 正向同距离成本（10 947 vs 11 234 ms），**封面缓存没有带来收益**（`CACHE_LIMIT=60` 远小于 900/1800，
  且滚动后缓存已被新行挤掉）。

---

## 5. 已挂载卡片数增长曲线（验证「只增不减」）

| 配置 | distinct 取值（每次测量） | 结论 |
|---|---|---|
| l4-900 | `[7,9,10,11,12]` / `[7,8,9,10,11,12]` / `[7,8,9,10,11,12]` | **滑动窗口，恒定 7–12 张** |
| l4-1800 | `[7,9,10,11,12]`（3 次一致） | 同上，与曲库规模无关 |
| l1-900 | `[900]` | 首帧全量挂载，**不随滚动变化** |
| l1-1800 | `[1800]` | 同上 |
| playlist-900 | `[900]` | 全量挂载 |

→ **没有「窗口只增不减」**：窗口化布局是真正的滑动窗口（约 7–12 张卡，远小于 16–20 行），
tile/playlist 则是从首帧就全量挂载、之后完全不变。真正的问题不是窗口泄漏，而是
①窗口每滑动一步就整窗重渲染；②窗口 overscan 行没有提前取封面（preload 0.7–3.4 %）。

---

## 6. 滚动期间的原生命令构成

**拖动期只有一个命令**：`audio_load_track_thumbnail`（占 100 %，0 个 `audio_probe_*`）：
- l4-900 677 次 / 12 186 ms；l4-1800 1 372 / 24 696；l1-900 249 / 4 482；l1-1800 453 / 8 154；playlist-900 314 / 5 652。
- 每轮 6 段 forward 各 106–237 次，**均匀分布**（与位置无关，佐证 §4 的「常数」）。

**首屏（切到视图那一刻）才是探测集中区**：

| 配置 | probe_track_summaries | probe_durations | load_track_thumbnail | warm_cover |
|---|---|---|---|---|
| l4-900 | 6 批 / 463 ms | 6 / 506 ms | 9 / 162 ms | 3 / 135 ms |
| l4-1800 | 14 / 1 109 ms | 10 / 829 ms | 9 / 162 ms | 8 / 376 ms |
| l1-1800 | 14 / 1 109 ms | 12 / 1 012 ms | 17 / 306 ms | 9 / 429 ms |

→ 「切到列表时慢」= 全库标签摘要 + 时长探测（阻塞首行，与 baseline 的 1452 ms 一致）；
「拖动时慢」= 逐张封面。**两者是不同阶段的不同成本，优化手段也不同。**

---

## 7. 异常现象（尖峰 / 空窗 / 重复）

1. **每轮都有 1 次 140–400 ms 的启动尖峰**（帧 max 140.7/147.0/359.5/401.6 ms，long task 139/146/357/397 ms）：
   出现在 `forward-1` 的第一次滚动（trace 里可见 `MajorGC` 与首个大 `UpdateLayoutTree`）——首次从骨架切到列表 + 首屏封面批量提交。
2. **空窗期最刺眼**：拖动结束时**已挂载但「有像素」的卡数常常是 0–7 张**（例：l4 forward-3 结束时 `cardsWithPixels=0`，
   即屏幕上 11 张卡一张封面都没有）；中段停 1s 后也才从 3 涨到 10。这就是用户说的「拖的时候一片空白」。
3. **没有重复请求**：每轮 410/820 个 wheel 事件对应 677/1 372 次缩略图请求，比例 ~1.65；
   `uniqueKeys` 与 `count` 一致（每个 `command|key` 只请求一次），**未发现同一首重复拉封面**。
4. **播放列表详情页有 50 次 long task / 3.4 s 抖动**（帧 p95 31.3 ms、52 帧 >50 ms），且反向滚回同样严重；
   媒体库列表则只在启动尖峰处抖。
5. **`audio_begin_playlist_cover_window` 不在拖动期**（每个挂载窗口仅 1 次），所以它不是拖动成本。
6. 页面 `pageErrors` 只有 4 条噪声：Vite HMR WebSocket 被本地网络策略拦截 ×2 + 1 条 vite 提示 +
   `useAudioPlayer.ts:2249` 的 listener 释放日志，均非本次测量引入。

---

## 8. 哪些数字不能外推到真机

| 数字 | 为什么不能外推 |
|---|---|
| 所有绝对 ms（56 张/s、35 ms/张、Task/帧） | 原生 IPC 是建模的 18 ms 常数；真机是磁盘/缓存命中，量级可能差一个数量级 |
| 帧 p50 = 3.1 ms、`mainThreadBusyRatio` 0.94 | headless 无 vsync，rAF 约 320 fps；只能看「Task/帧」的 60 fps 换算（28.1 %） |
| 帧 p95 / max、long task | 绝对值受 dev 构建（未压缩、带 HMR 运行时）影响 |
| 封面延迟 p50/p90 | 上界假设（每次都要真读盘 + 解码）；真机缓存命中会明显更快，但**请求条数与「可见期内未到达」的比例是真的** |
| 首屏 firstRowAtMs | 与 baseline 同口径（721/1034/1054/1693 ms），只用于同环境对照 |
| `elementCount`、`LayoutCount`、`Script/帧` 的比例关系 | 这是 DOM/React 层的事实，与 IPC 真假无关，**可以外推**（l4 vs tile 的 2.4× 差异是真的） |

---

## 9. 复现

```powershell
$env:SPMUSIC_PLAYWRIGHT = 'C:\Users\winkeses\.dsh\tools\node_repl\node_modules\playwright'

# 四组主测量（l4 窗口化 / l1 tile 全量 × 900/1800）+ playlist 详情页对照
node tools/perf-regression/scroll-probe.mjs --worktree D:\SpMusic `
  --sizes 900,1800 --views library-l4,library-l1,playlist `
  --repeat 3 --repeat-secondary 2 --segments 6 --interval 16 `
  --out tools/perf-regression/results/current/scroll-900-1800-l4-l1-playlist.json

# 结果折叠（打印本文表格里的所有数字）
node tools/perf-regression/analyze-scroll-result.cjs `
  tools/perf-regression/results/current/scroll-900-1800-l4-l1-playlist.json
```

关键参数：`--step-ratio 1/3`（每步=面板视口 1/3）、`--pause 1000`（中段停顿）、`--cpu-rates 1`
（`Emulation.setCPUThrottlingRate`，可加 `4` 模拟低端机）。

测量实现（全部在 page.evaluate / CDP 侧，未改 `src/`、`lib/`）：
真实滚轮输入 · rAF 间隔采样 · `PerformanceObserver('longtask')` ·
CDP `Performance.getMetrics` 每相位增量 · CDP `Tracing`（`devtools.timeline`…）→
`UpdateLayoutTree/Layout/PrePaint/Paint/FunctionCall` 的 count 与 cpuMs、`UpdateLayoutTree.elementCount` ·
`IntersectionObserver(root=panel)` 逐行「进视口」时刻 · 每 6 帧采样已挂载卡片数。

> 注：l4-1800 三轮的 trace 因单条 trace 文本超过 Node 字符串上限（"Invalid string length"）未能解析，
> 该组的 `elementCount` 用 l4-900 的 819 次/410 事件（≈1 次/事件）作为等效证据，其余指标不受影响。
