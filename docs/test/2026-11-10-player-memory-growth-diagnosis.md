---
doc_id: "TEST-2026-11-10-PLAYER-MEMORY"
title: "播放期内存增长根因诊断与优化建议"
doc_type: "test-report"
status: "调查完成；优化项未实施"
owner_agent: "Test Agent"
version_scope: "project"
module: "播放器内存 / 封面管线 / 音频可视化 / IPC 边界"
created: "2026-11-10"
updated: "2026-11-10"
source_documents:
  - "user request: 调查 SPM 播放界面播放时占用 100MB 以上且持续增长的原因，对比 Poweramp 与 LyciaMusic，给出优化建议"
  - ".rea-analysis/mem-all.csv"
  - ".rea-analysis/mem-focus.csv"
  - ".rea-analysis/mem-sample.csv"
  - "docs/test/opt-0017-rapid-cover-switch-memory-test-plan.md"
  - "docs/changes/optimizations/OPT-0017.md"
  - "docs/changes/optimizations/OPT-0018.md"
  - "src-tauri/src/audio/visualization.rs"
  - "src-tauri/src/audio/runtime.rs"
  - "src-tauri/src/audio/controller.rs"
  - "src-tauri/src/audio/cover_pixels.rs"
  - "src-tauri/src/audio/symphonia_source.rs"
  - "src-tauri/src/webview_memory.rs"
  - "src/features/player/hooks/useArtworkVisualResource.ts"
  - "src/features/player/hooks/useAudioPlayer.ts"
  - "src/features/player/components/PlayerSurface.tsx"
  - "src/features/player/components/AudioVisualization.tsx"
  - "src/features/player/model/playbackSessionStorage.ts"
  - "src/features/player/model/libraryQueue.ts"
  - "src/features/player/services/audioCommands.ts"
  - "Billy636/LyciaMusic v1.3.12（GitHub 源码对照）"
---

# 播放期内存增长根因诊断与优化建议

> **一句话结论**：SpMusic 播放时的高占用**不是一处内存泄漏**，而是三件独立事实的叠加：
> ① **基数偏高约 2 倍**——封面以「1536px 裸 RGBA 经 IPC 进 JS 再写 canvas」的形态驻留，单张 9 MiB、池 8 张；
> ② **播放期存在持续的无效分配**——音频可视化在后端**无开关**，即使 UI 已关闭仍然 30 fps 跑 4096 点 FFT、序列化并广播给 0 个监听者；
> ③ **水位棘轮**——每次封面批量解码把堆推到 ~330 MiB 后，GC 只回收到 ~200 MiB 而非基线 ~160 MiB，形成约 **+37~49 MiB 不可逆抬升**，这才是「会一直增长」的直接观感来源。
>
> 与之对照，Poweramp 与 LyciaMusic 的共同点不是技术栈更省，而是**每一层都有硬上限或闸门**。

---

## 0. 结论速览

| 维度 | 结论 | 证据强度 |
| --- | --- | --- |
| 是否存在单调内存泄漏 | **否**。两段稳态的净变化分别为 +0.56 MiB/234 s 与 +0.28 MiB/60 s，实质为零；纯尾部平台段斜率为 **−1.93 MB/min** | 高（两次独立运行复现） |
| 是否存在不可逆抬升 | **是**。两次运行分别 +36.5 MiB 与 +48.6 MiB，平台稳定在 200–206 MiB | 高 |
| 峰值来源 | **封面批量解码共振**。renderer 332 MiB / rust 107 MiB / gpu 445 MiB 出现在同一 1–2 s 窗口 | 高 |
| 基数高的主因 | **canvas 后备存储 32–72 MiB** + WebView2/React 运行时 | 高（代码 + 算术） |
| 播放期持续浪费 | **可视化管道无开关**，30 fps 空转 | 高（代码确认，无任何关闭路径） |
| Rust 后端是否为增长源 | **否**。稳态 16 MiB Private / 42 MiB WS，占总量 <5%；末段斜率 −0.024 MB/min | 高 |
| IPC 是否 JSON 膨胀 | **否**。封面走二进制 `InvokeResponseBody::Raw`（SPXR 头），无文本膨胀 | 高 |
| canvas 池是否造成双份像素 | **否**。`Uint8ClampedArray` 是零拷贝视图，但 `ImageData` + `putImageData` + backing store 存在三个副本窗口 | 中高 |

---

## 1. 实测数据复核

### 1.1 数据源

| 文件 | 内容 | 采样 |
| --- | --- | --- |
| `.rea-analysis/mem-all.csv` | 7 进程分角色（rust/gpu/renderer/utility/other） | 431 采样 × 7 行，30.3 s – 479.9 s，约 1.04 s/样本 |
| `.rea-analysis/mem-focus.csv` | renderer + 前台窗口 | 416 采样，0.045 s – 419.2 s |
| `.rea-analysis/mem-sample.csv` | renderer/app 双角色 | 470 行 |

两份主数据是**两次独立运行**，可用于交叉验证。

### 1.2 「持续增长」这一前提需要修正

对 `.rea-analysis/mem-all.csv` 的 renderer（pid 37452）分段做四分位均值比较（避开单点抖动）：

| 区段 | 采样数 | 首四分位 | 末四分位 | 净变化 | 折算 |
| --- | --- | --- | --- | --- | --- |
| 30–265 s | 225 | 163.45 | 164.01 | **+0.56 MiB / 234 s** | ≈ +8.6 MiB/h |
| 355–420 s | 62 | 189.92 | 199.26 | +9.34 MiB / 64 s | 高（见下） |
| 420–480 s | 58 | 199.70 | 199.98 | **+0.28 MiB / 60 s** | ≈ +16.9 MiB/h |

**关键判读**：355–420 s 那段上升**不是泄漏**，而是「355 s 一次 GC 回收 20.3 MiB → 随后回补到既有天花板」的过程：

```
355s 205.17 → 356s 184.89  (-20.3 MiB, GC)
356s 184.89 → 395s 204.03  (+19.1 MiB, 回补)
420s 199.70 → 480s 199.98  (+0.28 MiB, 完全走平)
```

未越过此前 204.03 的峰值，说明是**回到同一平台**，不是突破平台上行。

### 1.3 真正的现象：水位棘轮（两次运行复现）

| 运行 | 基线 | 峰值 | 尾部平台 | 棘轮幅度 |
| --- | --- | --- | --- | --- |
| A `mem-all` | 163.8 MiB（30–265 s） | **332.05 MiB** @ 345.8 s | 200.3 MiB（420–480 s） | **+36.5 MiB** |
| B `mem-focus` | 157.4 MiB（0–8 s） | **332.2 MiB** | 206.0 MiB（末 60 s） | **+48.6 MiB** |

两次独立运行表现高度一致：**基线 ~160 → 峰值 ~330 → 平台 ~200**。这不是随机漂移，是**可复现的系统性行为**。

### 1.3.1 关于「+2.11 MB/min」这一读数的澄清

调查过程中曾出现一个读数分歧，需在此明确，以免误判：

对 `mem-focus.csv` 的 renderer Private 做线性回归，**取不同区间会得到符号相反的斜率**：

| 区间 | 斜率 | 含义 |
| --- | --- | --- |
| 全程 0–419 s | **+1.13 MB/min** | 含启动爬升 + 棘轮 + 峰值 |
| t ≥ 60 s | **+2.11 MB/min** | 仍包含棘轮与峰值事件 |
| t ≥ 120 s | +1.59 MB/min | 同上 |
| t ≥ 240 s | **−0.86 MB/min** | 棘轮之后，已开始走平 |
| **t ≥ 360 s（纯尾部平台）** | **−1.93 MB/min** | **反映稳态，无增长** |

**结论**：`+2.11 MB/min` 这个数字是真实的，但它度量的是「启动爬升 + 两次一次性事件」的复合斜率，**不是稳态增长速率**。一旦把区间移到棘轮之后（t ≥ 240 s），斜率立即转负。

这也解释了为什么 `+2.11 MB/min × 7 min ≈ 14.8 MiB` 与实测净增（+37~49 MiB 棘轮）对不上 —— 线性模型本身不适用于「阶梯 + GC 锯齿」形状的数据。**对这类数据，分段四分位或平台期比较比全段回归可靠。**

`mem-focus.csv` 的分段四分位也印证同一形状（平台期各段净变化 −1.45 ~ +9.79 MiB，无单向趋势）：

```
0-60s    +106.01 (启动爬升)
60-120s  +8.45
120-180s +1.37
180-240s -0.48
240-300s +9.79
300-360s -0.20
360-430s -1.45
```

### 1.4 峰值事件的跨进程共振

对 325–350 s 窗口逐进程追踪 Private（MiB）：

| 时刻 | renderer | rust | gpu | other(8836) |
| --- | --- | --- | --- | --- |
| 329 s | 172.2 | 14.8 | 247.2 | 55.4 |
| 330 s | 193.3 | 15.8 | 334.3 | 58.4 |
| 331 s | 226.6 | 17.4 | 373.2 | 60.8 |
| 333 s | 251.8 | 15.0 | 432.0 | 61.6 |
| **335 s** | **323.4** | **107.0** | **445.8** | 61.4 |
| 346 s | 332.1 | 16.5 | 317.2 | 57.2 |
| 347 s | **206.9**（GC −125.2） | 16.5 | 305.0 | 57.0 |

**解读**：rust 出现全程唯一一次 107 MiB 尖峰（WS 110.4，说明是真实常驻而非虚拟预留），且与 renderer/gpu 同步。这是**一次封面批量解码**：Rust 侧持有解码缓冲与 RGBA 输出，`107 MiB ÷ 9.44 MiB ≈ 11 张` 1536 封面在途，随后经 IPC 推入 renderer 与 GPU 上传。事件结束后 renderer 被 GC 收回 125 MiB，但**只回到 206.9 而非 172.2** —— 这就是棘轮的形成瞬间。

---

## 2. 根因分析

### 2.1 根因一：封面以裸 RGBA 形态驻留，基数被抬高 32–72 MiB

**代码事实**（`src/features/player/hooks/useArtworkVisualResource.ts`）：

- `:520` `MAX_ARTWORK_BACKING_EDGE = 1536`
- `:519` `COVER_EDGE_BUCKETS = [1024, 1536]`（仅两档）
- `:258-262` canvas 池固定 **8 个** entry
- `:285-288` `prepareEntry` 只在**变大时** resize，不主动缩小
- `:318-324` 空闲 **2500 ms** 后才 `canvas.width = 0` 释放
- `:595-597` `getContext('2d')` + `putImageData(new ImageData(pixels.pixels, w, h), 0, 0)`

**内存算术**：

| 后备尺寸 | 单张 backing store | 池 8 张 |
| --- | --- | --- |
| 1024×1024 RGBA8 | 4.00 MiB | **32.0 MiB** |
| 1536×1536 RGBA8 | 9.00 MiB | **72.0 MiB** |

播放稳态下，3 个 layer slot + 6 个 prefetch 候选长期租用（`useAudioPlayer.ts:4941` 每次切歌重建候选集），**2500 ms 空闲清零几乎不触发**，故池长期撑满。这直接解释了 renderer 基线 157–164 MiB 中的 32–72 MiB。

**IPC 形态（重要：此处纠正一个常见误判）**

封面并非走 JSON 数组。`src/features/player/services/audioCommands.ts:480-482`：

```ts
if (response instanceof ArrayBuffer) return new Uint8Array(response)
throw new Error('Cover pixel response is not binary data')
```

`:489-509` 校验 `0x53 0x50 0x58 0x52`（"SPXR"）魔数 + 40 字节头。Rust 侧以 `Response::new(bytes)` 返回，走 `InvokeResponseBody::Raw`，Windows 下经 custom protocol fetch → `response.arrayBuffer()`。**无 20–40 MiB 文本膨胀**。

但需精确区分「几个副本」：

| 阶段 | 是否额外占用 |
| --- | --- |
| Rust `Vec<u8>` → `Response::new` | 移交 HTTP 层后释放 |
| renderer `ArrayBuffer` → `Uint8ClampedArray`（`audioCommands.ts:537`） | **零拷贝视图**，不复制 |
| `new ImageData(pixels.pixels, w, h)`（`useArtworkVisualResource.ts:597`） | 构造 ImageData 包装，本身不复制像素 |
| `context.putImageData(...)` | **上传到 canvas backing store —— 这是第二份 9 MiB** |

因此真实开销是「一份 JS 侧像素 + 一份 canvas backing store」同时存在，并且 canvas 那份会**常驻**（2500 ms 空闲才清零）。**9.44 MiB 裸像素一次性跨进程并常驻在 canvas**，这是基数的主要来源。

**对照 LyciaMusic**（同栈，Tauri v2 + WebView2）：缩略图 150 px JPEG、全图封顶 800 px（`covers.rs:13-14`），IPC 只返回约 100 字节的**路径字符串**，由 asset 协议自行解码。**JS 堆里只有 URL 字符串**。单张传输量相差约 2600 倍。

> **注**：SpMusic 其实**已经具备**路径通道（`playlistCoverPathLane.ts:334` `audioThumbnailPathUrl`、`tauri.conf.json` 已启用 `assetProtocol` scope `$CACHE/**`），列表封面（256 px）已走这条路。**播放器主封面仍走裸像素通道**，这是差异的关键所在 —— 优化方向不是「新建机制」，而是「把主封面也搬到已有的路径通道」。

### 2.2 根因二：音频可视化后端无开关，UI 关闭后仍 30 fps 空转

这是本次调查**最确定的「播放期持续浪费」**。

**前端确实是关闭的**：

- `src/features/player/components/PlayerSurface.tsx:1192` — `useState<VisualizationMode>('off')`，**默认关闭**
- `:3325` 与 `:3340` — `fade` 与 `fullscreen` 是 **if/else 互斥分支**，不存在双实例
- `src/features/player/components/AudioVisualization.tsx:46` — `if (!trackId || !isPlaying || !bars) return` 发生在 `listenAudioVisualizationFrame` **注册之前**，故关闭时 listener 根本不会建立

**后端却是常开的**：

| 位置 | 事实 |
| --- | --- |
| `src-tauri/src/audio/controller.rs:200` | `mpsc::sync_channel(2)` 无条件创建 |
| `controller.rs:205` | `run_visualization_bridge(...)` 无条件启动桥接线程 |
| `controller.rs:219` | `runtime.set_visualization(tx, session)` 无条件注入 |
| `runtime.rs:561-568` | 每次加载曲目，只要 `visualization_tx` 为 `Some` 就 `tap_source(...)` |
| `runtime.rs:1597-1608` | 重建 sink 时同样无条件 `tap_source(...)` |

**全仓库检索确认没有任何关闭路径**：

```
grep -r "visualization_enabled|set_audio_visualizer|visualizationEnabled" src/ src-tauri/
→ 无匹配
```

**代价链路**（`visualization.rs`）：

- `:20-21` `VISUALIZATION_FPS = 30`、`FFT_SIZE = 4096`
- `:193` `hop_frames = analysis_rate / 30`
- `:357-372` `spectrum_bars()`：双声道各跑一次 4096 点 FFT → **每秒 60 次 FFT**
- `:63` `bars: Vec<f32>`；`:131` `bars: bars.to_vec()` → **每帧一次堆分配**
- `:128-133` 每帧构造 `AudioVisualizationFrame` 并 `app_handle.emit(...)`

即使 `visualizationMode === 'off'`、零监听者，上述计算、分配、序列化、跨 IPC 广播**全部照常发生**。

`PlayerSurface.tsx:1239-1255` 的 fullscreen 分支还会在进入时 `requestAnimationFrame` 聚焦退出按钮，属独立小项。

### 2.3 根因三：播放期的高频全量 IPC 与全量序列化

| 位置 | 频率 | 内容 | 可回收性 |
| --- | --- | --- | --- |
| `useAudioPlayer.ts:4489-4503` | **500 ms** | `getAudioState()` **全量** IPC 往返 | 可回收（churn） |
| `useAudioPlayer.ts:4487-4505` | 100 ms（另一处） | 本地视觉时钟外推 | 无分配 |
| `useAudioPlayer.ts:960` | **1000 ms** | `persistCurrentSession` | 可回收 |
| `playbackSessionStorage.ts:60` | — | `JSON.stringify(session)` 写 localStorage | 产生常驻字符串 |

其中 `persistCurrentSession` 的载荷值得注意（`useAudioPlayer.ts:937-952`）：当 `sourceKind === 'custom'` 时，session 内含 `customPlaylist: { ...playlist }` —— **即完整 track 对象数组**。队列越长，每秒字符串化的量越大。

`:4534` 已有 `document.hidden` 门控，`:4488` 已有 `phase !== 'playing'` 门控，这部分设计是对的。

### 2.4 被排除的假设

| 假设 | 排除依据 |
| --- | --- |
| 双 `AudioVisualization` 实例造成双 listener | `PlayerSurface.tsx:3325/3340` 是互斥分支；`AudioVisualization.tsx:46` 提前 return |
| Rust 后端缓存无界增长 | `duration_cache.rs:198-200` 20000 条 / 8 MiB 双上限 LRU；`folder_cover.rs:337` 有界；`lyrics_cache.rs:78` 有界；`cover_pixels.rs:136` 的 `THUMBNAIL_USAGE` 实际单键 |
| 歌词滚动 rAF 累积 | `useActiveLyricScroll.ts` 无常驻 rAF 循环，observer 清理完整 |
| `RecentlyPlayedTracker` 累积 | `recentlyPlayed.ts:28-62` 纯标量 O(1) 状态 |
| IPC JSON 膨胀 | 二进制 Raw 通道（`audioCommands.ts:480-482`） |
| WebView2 内存策略失效 | `webview_memory.rs:98-106` 实现正确且生效，但**仅失焦时设 low**（`:130-135`）；`mem-focus.csv` 显示失焦时 WS 从 338 骤降至 73.6（−265 MiB），机制有效，但聚焦播放时无帮助 |
| DOM 节点泄漏 / motion 动画残留 | 未发现证据 |

### 2.5 唯一的真无界容器（量级不足以解释现象）

`src-tauri/src/audio/controller.rs:134`：

```rust
known_track_paths: Mutex<HashSet<String>>,
```

`:793-796` 每次 `load_and_play` 插入 canonicalize 后的路径，**全文无任何移除**。按约 150 B/条估算，10000 首约 1.5 MiB —— 属「应当修」但不解释观测现象。

---

## 3. 与同类产品的差距

### 3.1 为什么 Poweramp 能稳定在 60–80 MB

Poweramp 有**四道互相独立的硬上限**，没有一道依赖「数据量小」：

| # | 机制 | 证据 |
| --- | --- | --- |
| 1 | 队列是活 `Cursor`，且自建 `CursorFactory` 挂 **5 MB / 10 MB 硬上限的 `CursorWindow`** | `ׅ/e50.smali:18-46` `SDK_INT > 31 ? 10 : 5` × `0x100000`；`:52` `new CursorWindow(path, sizeBytes)`；挂载 `RestProvider.smali:566` |
| 2 | Bitmap **按字节预算**池 + **解码前像素数门控**（超预算直接不解码） | `ׅ/i.smali:283-291,609-649` 预算 = `maxMemory × 0.25~1.0`；`:4099` `p1*p2 > ->O` 直接跳过 |
| 3 | 解码缓冲常数化，PCM 从不进 Java 堆（FFT 在 GLSL，PCM 经 ashmem fd 直送 GPU） | `Pipeline2.smali:232,261` 仅 16 B/68 B 命令缓冲；`MilkRenderer.smali:3787` `native_set_audio_source_fd_and_serial` |
| 4 | 视图层订阅生命周期严格对称，**不可见控件不跑定时器** | `Elapsed.smali:517` `onAttachedToWindow` subscribe ↔ `:881` `onDetachedFromWindow` unsubscribe + `removeCallbacks`；`:943` `onVisibilityChanged` 二次门控 |

另有两点微观手法值得注意：进度文本**只在秒数变化时重建**（`Elapsed.smali:182`），且复用静态 `StringBuilder`（`ze1.smali:11`）；`BitmapFactory.Options` 为全局单例（`sb.smali:23`），并有 **11 处 `inBitmap` 复用**。

### 3.2 为什么 LyciaMusic 能稳定在 60–80 MB

**同栈对照**（Tauri v2 + WebView2 + Rust/rodio/symphonia + rustfft），前端 Vue 3 + Pinia 而非 Electron —— **所以差距不是技术栈红利**。三个决定性差异：

| # | Lycia 做法 | SpMusic 现状 |
| --- | --- | --- |
| 1 | 可视化有 `enabled: AtomicBool` 闸门（`player/types.rs:47,84-100`），前端按挂载/可见性/低功耗同步开关 | **全仓库无开关**（本次确认） |
| 2 | 队列只存**路径数组**（`playback/store.ts:22` `shallowRef<string[]>`），持久化 5 s 且事件立即刷写 | `useAudioPlayer.ts:5196-5197` 整表 `entries.map(...)` 物化；`libraryQueue.ts:22` 全表 `JSON.stringify` |
| 3 | 缩略图 150 px JPEG，全图封顶 800 px，IPC 只回传约 100 B 路径，JS 堆仅存 URL | 1536 px 裸 RGBA 单张 9.44 MiB，canvas 池 8 张 |

Lycia 官方文档亦明确承认**未完成 Release 进程组 A/B 采样**，故「60–80 MB」应理解为**主进程 + 渲染进程的稳态有界结果**（不含 GPU 进程），不宜作为精确基准引用。

> **注意**：SpMusic 在 `webview_memory.rs` 上的失焦降级（`SetMemoryUsageTargetLevel`）**优于 Lycia**（后者无此机制），不要改动。

---

## 4. 优化建议

### P0 — 立即实施（低风险、收益确定、单点可验证）

**P0-1 给音频可视化加后端开关**（预计省 30 fps 全部空转开销）

- 在 `VisualizationSession` 增加 `enabled: AtomicBool`；新增 Tauri command（如 `set_audio_visualization_enabled`）
- `runtime.rs:561` 与 `:1597` 的 `tap_source` 条件改为「`tx` 存在 **且** `enabled` 为真」
- `controller.rs:205` 的桥接线程在 `enabled == false` 时阻塞等待，不消费队列
- 前端在 `visualizationMode` 变化时同步下发
- **收益**：消除每秒 60 次 4096 点 FFT + 每帧 `bars.to_vec()` + 序列化 + 广播
- **验证判据**：关闭可视化播放 5 分钟，`mem-focus.html` 复采样，renderer Private 增长斜率应无变化（因为本来就是 churn），但 CPU 时间与 GC 次数应显著下降 —— **这是「减少无效功耗」而非「降低位数」的优化，不要用内存位数去验收它**

**P0-2 canvas 池后备尺寸 1536 → 1024**（预计省 40 MiB 基数）

- `useArtworkVisualResource.ts:520` `MAX_ARTWORK_BACKING_EDGE` 改为 1024，`:519` `COVER_EDGE_BUCKETS` 保持 `[1024]` 或 `[768, 1024]`
- **收益**：8 × 9.00 MiB = 72 MiB → 8 × 4.00 MiB = 32 MiB，**净省约 40 MiB**，且单次 IPC 从 9.44 MiB 降到 4.19 MiB，直接压低 335 s 那类峰值的天花板
- **风险**：高 DPI 大屏上封面可能变软。需在 2× DPR / 大窗口下目视验收
- **验证判据**：`docs/test/cover-sharpness-comparison` 方式做 A/B 目视对比；内存侧看基线从 ~160 降到 ~120

**P0-3 撤掉 500 ms 全量 `getAudioState()` 轮询**

- `useAudioPlayer.ts:4489-4503` 改为由 Rust 侧 `emit` 位置增量事件，或至少降到 2 s
- `visualTimelineClock` 已能在本地外推（`:4511-4526`），500 ms 那次全量拉取是冗余的
- **收益**：每秒 2 次全量 IPC 往返 → 趋零

### P1 — 需改造，收益确定

**P1-1 会话持久化降频 + 瘦身**

- `useAudioPlayer.ts:960` 1 Hz → 5 s（`pagehide`/`beforeunload` 已兜底，不必每秒写）
- `persistCurrentSession` 的 `customPlaylist: { ...playlist }` 改为只存 `sourcePath` + `selectedIndex`，不存完整 `tracks` 数组
- 消除每秒一次「整队 JSON.stringify」的常驻字符串

**P1-2 消除可视化每帧分配**

- `visualization.rs:131` 的 `bars.to_vec()` 改为复用缓冲；`AudioVisualizationFrame.bars` 改 `[f32; 48]`（定长，直接栈上序列化）
- 与 P0-1 叠加后此项收益变小，但属正确的写法

**P1-3 复用解码缓冲**

- `symphonia_source.rs:800-805` 的 `SampleBuffer::<i16>::new()` 每包新建，改为按最大包容量复用的成员缓冲

**P1-4 `known_track_paths` 加 LRU 上限**

- `controller.rs:134` 加容量（如 8192 条）与淘汰逻辑

### P2 — 加固与中长期

**P2-1 `webview_memory.rs` 扩展降级触发条件**

- 当前仅 `WindowEvent::Focused(false)` 设 low（`:130-135`）。建议增加「窗口最小化 / 播放中长时间隐藏」也设 low
- 该机制已被实测证明有效（失焦时 WS −265 MiB），扩大触发面收益明确

**P2-2 `playlist_cover.rs` PROBE_CACHE 加字节上限**

- 当前 256 条 × 16 MiB 理论上限 4 GiB，仅按条目限制。实测未触发，属加固

**P2-3 `lyrics_cache.rs` 加单条目字节上限**

- `metadata.rs:225` 的 `fs::read` 无大小检查，可按 256 KiB 钳制

**P2-4 队列模型去数组化（架构级，长期）**

- `playbackQueue.ts:13-15` / `audioCommands.ts:384` 把整表物化为数组；`useAudioPlayer.ts:5196-5197` 整表 map；`libraryQueue.ts:22` 全表 JSON.stringify
- 对应 Poweramp 的 Cursor 语义：元数据留在 Rust，前端只持 `{scope, anchorIndex, total}` + 窗口切片
- 这是**确定性 O(n)**，但当前观测未显示它在驱动内存曲线（曲库规模不够大），故列为中长期

**P2-5 提前拒绝解码（借鉴 Poweramp）**

- Poweramp 在 `i.smali:4099` 用「像素数超预算就不解码」，比 SpMusic `cover_pixels.rs` 的「解码后校验 `MAX_OUTPUT_BYTES`」更省
- 桌面端同样适用：在 decode 之前按 `source_w × source_h × 4` 与预算比较，超限直接返回降级图

---

## 5. 建议的验收方法

现有三次采样都是**仅播放稳态**，未覆盖拖动切歌场景。要闭环验证 P0 收益，需要补：

1. **固定构建 + 固定曲序**，同一台机器、同一 DPR/窗口尺寸
2. 每次改动单独跑，**AB/BA 交替**，至少 3 次独立启动
3. 指标口径（**不要混用**）：
   - **真实占用 → Working Set**（只有常驻物理页算）
   - **泄漏判据 → Private Bytes**（单调，不受后台 trimming 干扰）
   - **禁止**把两者相加，也**禁止**把 GPU 进程的 Private 当占用（实测 GPU `Private − WS` 平均 201 MiB，是虚拟地址预留）
4. 特别注意 **WS 的后台修剪污染**：`mem-focus.csv` 中 renderer WS 最低掉到 31.33 MiB（同期 Private 恒为 163±2），utility 进程在 341 s 掉到 0 MiB。**WS 只在「前台连续窗口」内可用于趋势判断**，否则会得出 −839 MiB/h 这类荒谬值
5. 每条 P0 的**独立证伪判据**：
   - P0-1：关闭可视化播放 5 分钟，renderer 内存曲线应**不变**（证明它不是位数来源），但 CPU/GC 应下降
   - P0-2：基线应从 ~160 MiB 降到 ~120 MiB，335 s 类峰值天花板从 ~330 降到 ~290
   - P0-3：IPC 次数应下降约 2 次/秒，churn 减少

---

## 6. 结论

1. **「一直增长」的准确描述是「阶梯式棘轮，而非线性泄漏」**。两次独立运行都显示：基线 ~160 MiB → 峰值 ~330 MiB → 平台 ~200 MiB，棘轮 +37~49 MiB 不可逆；但两段稳态的净变化实质为零。
2. **占用 100 MB+ 的第一原因是设计代价，不是缺陷**：封面以「1536 px 裸 RGBA」形态驻留，池 8 张即 32–72 MiB。这与 LyciaMusic「150 px JPEG + 只传路径」的差距是数量级差异。
3. **播放期确实存在持续的无效开销**：可视化管道无开关，UI 关闭后仍 30 fps 跑 FFT 并广播给零监听者。这是全仓库唯一确认的「白干活」路径，且修复成本最低。
4. **Rust 后端不是增长源**（稳态 <5%），**IPC 也没有 JSON 膨胀**（走二进制 Raw）。优化焦点应集中在 renderer。
5. **P0-2（canvas 1536 → 1024）是降基数的最大单点杠杆**；**P0-1（可视化开关）是消除无效功耗的最大单点杠杆**。两者互不重叠，可并行验证。

> 本报告所有数字均来自仓库内已有采样文件与源码常量算术；未运行新的性能测试，未修改任何业务代码。标为「高」的结论均有两次独立运行或代码直接证据支撑。
