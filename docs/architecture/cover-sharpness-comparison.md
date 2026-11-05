---
doc_id: "ARCH-COVER-SHARPNESS"
title: "封面清晰度对比：SpMusic 播放列表头图 vs Poweramp"
doc_type: "architecture"
status: "draft"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-06"
updated: "2026-11-06"
source_documents:
  - "user request: 播放列表头图模糊，Poweramp 同位置清晰，调查原因"
  - "src-tauri/src/audio/cover_pixels.rs（解码与上限常量）"
  - "src/features/player/hooks/useLibraryArtwork.ts（hero/卡片准入逻辑）"
  - "src/features/player/components/PlaylistPanel.tsx（hero 渲染）"
  - "src/features/player/styles/player/playlist-panel.css（hero 几何）"
  - "src/features/player/services/audioCommands.ts（三通道 maxEdge 类型）"
  - ".rea-analysis/Poweramp-v3.apk（头图实现，smali + 资源实证）"
  - "docs/architecture/playlist-artwork-loading.md（既有封面加载契约，本文不重复）"
---

# 封面清晰度对比：SpMusic 播放列表头图 vs Poweramp

**状态：调查记录 + 改动提案。代码改动未实施，等待 §6 的 C1 / C2 决策。**

## 0. 结论先行

**SpMusic 头图模糊的根因是「供给侧上限 512px」与「需求侧全宽 banner」不匹配，不是压缩算法问题。**

| | SpMusic | Poweramp |
| --- | --- | --- |
| 头图几何 | **全宽 × 320–460px** | **约 130sp+ 的封面块** |
| 需求边长（1600px 窗口） | **≈1600px** | **≈300–400px** |
| 数据上限 | **512px（硬限制）** | **按需解码，无小上限** |
| 放大倍数 | **≈3.1×** | **≈1×（或缩小）** |
| 结果 | **可见模糊** | **清晰** |

⇒ 两者不是同一量级的负载。SpMusic 用列表缩略图的尺寸上限去填全宽 banner，必然模糊。

---

## 1. SpMusic 现状实证

### 1.1 三条封面通道的上限

`src-tauri/src/audio/cover_pixels.rs:37-38`：

```rust
const ALLOWED_MAX_EDGES: [u32; 7] = [256, 512, 768, 1024, 1536, 2048, 3072];
const ALLOWED_PLAYLIST_MAX_EDGES: [u32; 3] = [128, 256, 512];
```

| 通道 | 入口 | 允许 maxEdge | 用途 |
| --- | --- | --- | --- |
| **通用** | `load_cover_pixels` | **256–3072（7 档）** | 全屏播放器封面 |
| **播放列表** | `load_playlist_cover_pixels` | **128/256/512（3 档）** | **列表卡片 + 头图** |
| 曲目缩略图 | `load_track_thumbnail` | 128/256 | 列表行 |
| 文件夹缩略图 | `load_folder_thumbnail` | 128/256 | 文件夹行 |

校验函数（`cover_pixels.rs:2123-2131`）：

```rust
fn validate_playlist_max_edge(max_edge: u32) -> Result<(), CoverPixelsError> {
    if ALLOWED_PLAYLIST_MAX_EDGES.contains(&max_edge) { Ok(()) }
    else { Err(CoverPixelsError::recoverable(
        CoverPixelsErrorCode::InvalidMaxEdge,
        "playlist cover maxEdge must be 128, 256, or 512",
    )) }
}
```

**这是硬校验——传 1024 会直接报 `InvalidMaxEdge`。**

### 1.2 前端已尽最大努力，但目标只能是 512

`src/features/player/hooks/useLibraryArtwork.ts:434`：

```typescript
if (first?.available && first.id !== warmTrackId)
    runtime.detailPaths.set(normalizeAudioSourcePath(first.sourcePath), 512)
```

`detailPaths` 的类型被锁死（`:33`）：

```typescript
detailPaths: Map<string, 128 | 256 | 512>
```

准入逻辑（`:250-282`）已实现两级：

```typescript
// 第一级：先发 256，保证卡片/侧栏立即有图
for (const [key, edge] of runtime.detailPaths) {
    if ((runtime.detailVisiblePaths.has(key) || key === heroKey) && (key !== heroKey || !heroUpgradeReady)) {
        required.set(key, key === heroKey ? 256 : edge)
    }
}
// 第二级：hero 就绪后升级到 detailPaths 的 edge（=512）
if (heroKey && heroUpgradeReady && runtime.detailPaths.has(heroKey)) {
    required.set(heroKey, runtime.detailPaths.get(heroKey)!)
}
```

代码注释（`:259-261`）明确写出「512px hero」这个预期：

```typescript
// First load the persisted thumbnail even when the same source also
// needs a 512px hero. Admit every visible card and sidebar tile before
// the hero upgrade and offscreen prefetch.
```

⇒ **前端逻辑无缺陷，是后端的 512 天花板卡住了。**

### 1.3 渲染几何远超 512

`src/features/player/styles/player/playlist-panel.css:39-78`：

```css
.playlist-hero {
  width: 100%;
  max-width: none;
  height: clamp(320px, calc(320px + (100vw - 640px) * 0.5), 460px);
}
.playlist-hero-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: calc(100% * var(--playlist-hero-overscroll-scale, 1));
  object-fit: cover;
  object-position: center;
}
```

**几何计算**（`object-fit: cover` 取较大缩放比）：

| 窗口宽 | hero 高 | 按宽度铺满所需边长 | 放大倍数（源 512） |
| --- | --- | --- | --- |
| 1024px | 320px | 1024 | **2.0×** |
| 1440px | 400px | 1440 | **2.8×** |
| 1920px | 460px | 1920 | **3.75×** |
| 2560px | 460px | 2560 | **5.0×** |

⇒ **1080p 屏幕上放大 3.75 倍，模糊是必然的物理结果。**

### 1.4 渲染位置确认

`src/features/player/components/PlaylistPanel.tsx:951-952`：

```tsx
artwork={firstTrack?.coverThumbnail
    ? <PlaylistCoverImage className="playlist-hero-image" image={firstTrack.coverThumbnail} />
    : firstTrackCoverSource
        ? <img className="playlist-hero-image" src={firstTrackCoverSource} alt="" aria-hidden="true"
               decoding="async" onError={handleHeroCoverError} />
        : null}
```

`coverThumbnail` 由 `useLibraryArtwork` 的播放列表通道生成，受 §1.1 的 512 限制。

---

## 2. Poweramp 实现实证

> **更正说明**：本文档初稿曾误判「Poweramp 无全宽头图」。实际查证后确认 **Poweramp 有头图**，见 §2.1。此更正保留以记录结论演进。

### 2.1 Poweramp 的头图机制：复用专辑封面控件

`res/values/styles.xml:11247-11275`（`ListSubstyleBase2`）：

```xml
<style name="ListSubstyleBase2">
    <item name="itemSize">96.0dp</item>
    <item name="itemSizeZoomed">137.0dp</item>
    <item name="headerStretchyImage">@id/aa_image</item>    <!-- ★ 头图 = 专辑封面控件 -->
    <item name="aaMinSize">130.0sp</item>
    <item name="altAaLayoutRatio">1.85</item>
    <item name="aaPosAnimTime">550</item>
    <item name="aaPosSettleAnimTime">650</item>
    <item name="aaMarginBottom">@dimen/ListSubstyleBase2_aaMarginBottom</item>
</style>
```

`res/values/attrs.xml:503`：

```xml
<attr name="headerStretchyImage" format="reference" />
```

**关键点**：`headerStretchyImage` 指向 **`@id/aa_image`**，即「专辑封面视图（album art image）」本身。

⇒ Poweramp 的头图**不是**「背景大图 + 覆盖文字」，而是**「封面块 + 信息区」**的布局。

| 属性 | 值 | 含义 |
| --- | --- | --- |
| `headerStretchyImage` | `@id/aa_image` | 头图复用专辑封面控件 |
| `aaMinSize` | `130sp` | 封面块最小边长 |
| `altAaLayoutRatio` | `1.85` | 交替布局宽高比 |
| `itemSizeZoomed` | `137dp` | 缩放态条目尺寸 |

### 2.2 Poweramp 的解码策略：两趟 + inSampleSize

`smali/com/maxmpz/widget/bitmaps/К.smali` 的 `x(FileDescriptor, byte[], у)`（L509 起）：

```smali
iput-boolean v6, v2, Landroid/graphics/BitmapFactory$Options;->inJustDecodeBounds:Z   # ① 先只量尺寸
iput v3, v2, Landroid/graphics/BitmapFactory$Options;->inSampleSize:I                 #    复位采样
invoke-static {v0, v5, v2}, Landroid/graphics/BitmapFactory;->decodeFileDescriptor(...) # ② 再按采样解码
```

**两趟解码**：`inJustDecodeBounds = true` 拿原始宽高 → 算 `inSampleSize` → 真正解码。

⇒ **需要多大解多大，不存在「先解成 512 再被 CSS 放大」的二次损失。**

### 2.3 Poweramp 的采样档位计算

`bitmaps/К.В(int, int, int)`（L1604-1669）—— 请求尺寸 `p0`、上限 `p1`、下限 `p2`：

```java
static int В(int requested, int max, int min) {
    if (max < min) throw new RuntimeException("max=" + max + " < min=" + min);
    if (min < 1)   throw new RuntimeException("min=" + min + " < 1");
    while (true) {
        if (max <= min) return min;                       // 触底
        if (requested <= max / 2 + max / 16) {            // 1.5× 上界判定
            max >>= 1;                                     // 折半
            continue;
        }
        return max;
    }
}
```

**`requested <= max/2 + max/16`（即 ≈ 0.5625×max）时折半**，选择略大于需求的 2 的幂档位。

⇒ 采样粒度是**动态选择的**，不是固定 `[128,256,512]` 枚举。

### 2.4 解码参数对象

`smali/com/maxmpz/widget/bitmaps/у.smali` 字段（节选）：

```
.field public A:I                 # 目标宽
.field public B:I                 # 目标高
.field public final H:Ljava/io/FileDescriptor;
.field public final В:Landroid/graphics/BitmapFactory$Options;
.field public final Н:Landroid/graphics/Rect;
.field public Р:Landroid/graphics/Matrix;
.field public х:Z                 # 是否需缩放
```

⇒ 解码请求携带**目标宽高 + Matrix + Rect**，由调用方按视图实际尺寸给定。

---

## 3. 差异汇总

| 维度 | SpMusic | Poweramp | 影响 |
| --- | --- | --- | --- |
| **头图几何** | 全宽 × 320–460px | ≈130sp+ 封面块 | **需求差 4–8 倍** |
| **数据上限** | 512（硬枚举） | 无小上限，按需 | 供给侧差 |
| **解码方式** | 按 maxEdge 取 2 的幂（128/256/512） | 两趟 + 动态 inSampleSize | 精度控制 |
| **缩放责任** | CSS `object-fit: cover` 放大 | 解码期按目标尺寸 | **放大位置不同** |
| **模糊来源** | **512 → 1600 的 CSS 放大** | 无（解码即目标尺寸） | 结论 |
| **缓存键** | 含 `max_edge`（见 §4.2） | — | 便于扩容 |

### 核心差异一句话

**SpMusic 在「显示期」放大，Poweramp 在「解码期」定尺寸。**
前者受供给侧上限约束，后者按视图需要动态决定。

---

## 4. 改动想法（未实施）

### 4.1 方案 A：提高播放列表通道上限（推荐）

**改动点 1** —— `src-tauri/src/audio/cover_pixels.rs:38`：

```rust
// 现状
const ALLOWED_PLAYLIST_MAX_EDGES: [u32; 3] = [128, 256, 512];
// 改为
const ALLOWED_PLAYLIST_MAX_EDGES: [u32; 5] = [128, 256, 512, 1024, 1536];
```

**改动点 2** —— `src/features/player/hooks/useLibraryArtwork.ts:33` 类型：

```typescript
// 现状
detailPaths: Map<string, 128 | 256 | 512>
// 改为
detailPaths: Map<string, PlaylistCoverEdge>   // = 128 | 256 | 512 | 1024 | 1536
```

**改动点 3** —— `useLibraryArtwork.ts:434` hero 的目标档位：

```typescript
// 现状
runtime.detailPaths.set(normalizeAudioSourcePath(first.sourcePath), 512)
// 改为：按窗口宽度选档
runtime.detailPaths.set(normalizeAudioSourcePath(first.sourcePath), selectHeroEdge())
```

其中 `selectHeroEdge()` 建议：

```typescript
function selectHeroEdge(): PlaylistCoverEdge {
    const dpr = window.devicePixelRatio || 1
    const heroPx = Math.round(window.innerWidth * dpr)   // hero 全宽
    if (heroPx <= 512) return 512
    if (heroPx <= 1024) return 1024
    return 1536
}
```

**改动点 4** —— `src/features/player/services/audioCommands.ts:116` 类型同步：

```typescript
// 现状
maxEdge: 128 | 256 | 512
// 改为
maxEdge: 128 | 256 | 512 | 1024 | 1536
```

**收益**：1600px 窗口用 1024 或 1536 图，放大倍数降到 1.0–1.6×，肉眼难辨。
**代价**：单张 1024² RGBA ≈ 4 MB；1536² ≈ 9 MB。但 hero 只有一张。

### 4.2 扩容安全性（已核实）

**缓存文件名含 `max_edge`**（`cover_pixels.rs`）：

```rust
fn thumbnail_filename(source_hash: blake3::Hash, max_edge: u32) -> String {
    format!("{}-{max_edge}-t{THUMBNAIL_TRANSFORM_VERSION}-d{THUMBNAIL_DISK_VERSION}.spxr",
            source_hash.to_hex())
}
```

⇒ **不同 edge 落到不同文件，扩容不会读到旧的 512px 缓存**，无需清缓存或升版本号。

**现有预算仍有余量**：

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `THUMBNAIL_CACHE_BYTES` | 8 GiB | 磁盘缓存上限 |
| `THUMBNAIL_CACHE_FILES` | 32768 | 文件数上限 |
| `MAX_DECODE_BYTES` | 256 MiB | 单次解码缓冲上限 |
| `MAX_PLAYLIST_DECODE_PERMITS` | 4 | 并发解码上限 |
| `MAX_PLAYLIST_CLIENTS` | 16 | 客户端数上限 |

⇒ 1536² × 4B ≈ 9.4 MB，远低于单次 256 MiB 上限；并发 4 路最坏 37.6 MB，仍安全。

### 4.3 方案 C：仅在 hero 可见时请求高分辨率（A 的优化）

现状已有可见性机制可用：

- `runtime.detailVisiblePaths`（`:263`）
- `chromeTransition.overviewBoundary`（`PlaylistPanel.tsx` 传入）
- `IntersectionObserver` + `rootMargin: '150px 0px'`（`useLibraryArtwork.ts:284-291`）

**只需把 §4.1 的 `selectHeroEdge()` 接在 `heroUpgradeReady` 分支上**（`:271-273` 已有该分支），
离开时按现有 `trimCache()` 逻辑自然释放。

⇒ 内存成本**只在实际显示时付出**，无需新增机制。

### 4.4 不建议：改渲染几何（方案 B）

```css
.playlist-hero { max-width: 720px; }
```

或改成「封面块 + 信息区」（Poweramp 风格）。

**风险**：

1. 破坏 `artworkLayoutId` 共享元素过渡（`PlaylistPanel.tsx:948` → `playlist-library-cover:${sharedScope}`），
   该过渡依赖 hero 与原卡片的几何映射
2. 需同步调整 `--playlist-hero-overscroll-scale` 的过滚拉伸逻辑（`playlist-panel.css:40,72-73`）
3. 视觉设计变更需产品确认

**结论**：成本高于方案 A，且收益（省内存）在 hero 单图场景下不显著。

---

## 5. 实施拆分建议（若批准）

按 AGENTS.md 的责任边界：

| 步骤 | 负责 Agent | 文件范围 |
| --- | --- | --- |
| 1 | **Rust/Tauri Agent** | `src-tauri/src/audio/cover_pixels.rs`（常量 + 校验函数 + 单测） |
| 2 | **Frontend Agent** | `useLibraryArtwork.ts` / `audioCommands.ts`（类型 + 选档函数 + hero 分支） |
| 3 | **Architecture Agent** | 复核跨层契约（edge 枚举、缓存键、准入逻辑）一致性 |
| 4 | **Test Agent** | 独立验证：窗口尺寸 × DPR 组合下的实际清晰度与内存占用 |
| 5 | **Lead** | 集成 + 最终 `cargo check` / `cargo test --lib` / `npm run lint` / `tsc` |

### 5.1 需要补的测试

| 层 | 用例 |
| --- | --- |
| Rust | `validate_playlist_max_edge(1024)` / `(1536)` 通过；`(768)` 拒绝 |
| Rust | `load_playlist_cover_pixels` 在 1024 下返回正确尺寸与缓存命中 |
| 前端 | `selectHeroEdge()` 在 1024/1440/1920/2560 窗口 × DPR 1/2 下的取值 |
| 前端 | hero 从 512 升级到 1024 时 `pendingReplacements` 正确换图且释放旧 blob |

### 5.2 风险清单

| 风险 | 缓解 |
| --- | --- |
| 高 DPI 屏（DPR 2）需求翻倍 → 可能仍不足 | `selectHeroEdge` 已乘 `devicePixelRatio` |
| 超大窗口（2560+）1536 仍不够 | 可再上 2048；或接受 1.67× 放大 |
| 解码延迟增加影响首屏 | 保留「先 256 再升级」两级策略（现状已有） |
| 内存峰值 | 已有 `MAX_DECODE_BYTES` 与并发 permits 兜底 |

---

## 6. 待确认

| # | 问题 | 影响 |
| --- | --- | --- |
| **C1** | 是否保留「全宽 banner + 封面铺底」设计？ | 决定走 A 还是 B |
| **C2** | 目标清晰度标准（放大 ≤1.5×？≤2×？） | 决定 `selectHeroEdge` 的档位阈值 |
| **C3** | 是否接受 1536 档（单图 ≈9 MB） | 影响内存预算 |
| C4 | 超高窗口（≥2560）是否需 2048 档 | 需要则可直接加进枚举 |

---

## 7. 证据索引

### 7.1 SpMusic 侧（本仓库文件）

| 结论 | 位置 |
| --- | --- |
| 两套 edge 枚举 | `src-tauri/src/audio/cover_pixels.rs:37-38` |
| 播放列表上限校验 | `src-tauri/src/audio/cover_pixels.rs:2123-2131` |
| 缓存键含 max_edge | `cover_pixels.rs` `thumbnail_filename` |
| 解码与并发预算 | `cover_pixels.rs:27,49,55,59` |
| hero 目标 512 | `src/features/player/hooks/useLibraryArtwork.ts:434` |
| detailPaths 类型 | `useLibraryArtwork.ts:33` |
| hero 两级准入 | `useLibraryArtwork.ts:250-282` |
| hero 渲染 | `src/features/player/components/PlaylistPanel.tsx:951-952` |
| hero 几何 | `src/features/player/styles/player/playlist-panel.css:39-78` |
| 三通道 maxEdge 类型 | `src/features/player/services/audioCommands.ts:109-131` |

### 7.2 Poweramp 侧（`.rea-analysis/Poweramp-v3.apk`）

| 结论 | 位置 |
| --- | --- |
| 头图 = `@id/aa_image` | `res/values/styles.xml:11255` |
| `headerStretchyImage` 定义 | `res/values/attrs.xml:503` |
| `aaMinSize` / `altAaLayoutRatio` | `res/values/styles.xml:11266,11275` |
| 两趟解码（inJustDecodeBounds） | `smali/com/maxmpz/widget/bitmaps/К.smali:509-560` |
| 动态采样档位算法 | `smali/com/maxmpz/widget/bitmaps/К.smali:1604-1669` |
| 解码参数对象字段 | `smali/com/maxmpz/widget/bitmaps/у.smali` |

复现：

```powershell
apktool d --no-src -f -o <out> .rea-analysis/Poweramp-v3.apk
# 头图定义
Select-String -Path "<out>\res\values\styles.xml" -Pattern "headerStretchyImage"
# 解码策略
Select-String -Path "<out>\smali\com\maxmpz\widget\bitmaps\К.smali" -Pattern "inJustDecodeBounds|inSampleSize"
```

---

## 8. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| `docs/architecture/playlist-artwork-loading.md` | 封面加载的数据流与磁盘缓存契约。**本文只讨论清晰度，不重复其契约内容** |
| `docs/implementation/playlist-cover-backend-concurrency.md` | 后端并发安全。本文 §4.2 仅引用其预算常量 |
| `docs/implementation/playlist-cover-scheduler-concurrency.md` | 前端调度并发。本文不涉及调度 |
| `docs/test/2026-10-23-all-songs-cover-size-observation.md` | 历史封面尺寸观测。**本文为其结论的延伸（hero 场景）** |

---

**本文档为调查记录 + 改动提案。截至本次提交，仓库内没有任何对应代码改动；实施前需先完成 §6 的 C1 / C2 决策。**
