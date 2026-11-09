---
doc_id: "ARCH-HERO-COVER-SHARPNESS-PLAN"
title: "列表头图（hero）清晰度实施计划：解除 512 上限与跨通道档位统一"
doc_type: "architecture"
status: "proposed"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-10"
updated: "2026-11-10"
source_documents:
  - "user request: 列表头图模糊；优先保留全宽填充，不接受破坏布局的大改版；多端适配为长期目标（1920×1080 / 2560×1440 / 2880×1920@200% / 最小 640×1440）"
  - "user request: 把 hero 模糊的解决方案写成可审阅的正式架构方案文档"
  - "docs/architecture/cover-sharpness-comparison.md（2026-11-06 调查记录，status: draft；本文为其后续实施计划，行号已漂移，不沿用）"
  - "src-tauri/src/audio/cover_pixels.rs（边缘白名单、校验、缓存键、预算常量、路径通道）"
  - "src-tauri/src/audio/folder_cover.rs（文件夹封面像素/路径通道的独立边缘限制）"
  - "src/features/player/hooks/useLibraryArtwork.ts（播放列表/库封面 hero 两级准入）"
  - "src/features/player/hooks/useAllSongsWindow.ts（分类页共享封面窗口，全文硬编码 256）"
  - "src/features/player/hooks/useAudioPlayer.ts（播放态 hero 档位与 48 MiB / 4 MiB 预算）"
  - "src/features/player/services/audioCommands.ts（跨端 maxEdge 联合类型与路径响应校验）"
  - "src/features/player/services/playlistCoverPathLane.ts / playlistCoverScheduler.ts（path lane 与并发宽度）"
  - "src/features/player/components/AlbumLibraryPanel.tsx / FolderHierarchyPanel.tsx / CollectionHero.tsx（hero 渲染与 cover key）"
  - "src/features/player/styles/player/playlist-panel.css / album-library.css / playlist-management.css（hero 几何）"
  - "src/features/player/model/playlistCoverPixels.ts（BMP 对象 URL 账本）"
  - "docs/changes/optimizations/OPT-0018-v2-result.md（跨端常量单点耦合的既有失效模式）"
  - ".rea-analysis/tools/jpeg_size_probe.py（q82 / 4:4:4 JPEG 落盘体积实测，2026-11-10）"
  - ".rea-analysis/（Poweramp v3 头图与解码实现：styles.xml / item_track.xml / bitmaps/*.smali）"
---

# 列表头图（hero）清晰度实施计划

**状态：方案（proposed）。本文只定义边界、档位、预算与改动清单，不含实现；实施前需完成 §12 的 D1–D3 决策。**

## §0 结论先行

**一句话结论：hero 模糊的原因是「供给侧被锁在 512px（播放列表通道）或 256px（分类页通道）」，而需求侧是 1550–2190 物理像素的全宽 banner；解法是把 hero 的目标档位提升到 1536 并解锁 2048 档，而不是改渲染几何。**
但**单纯放宽白名单会立即击穿两处预算**（`useAudioPlayer` 的 warm/prefetch 预算变负、分类页 store 无任何字节预算），因此本方案的核心不是"加档位"，而是**加档位 + 给 hero 一个独立的、可被降档回收的身份**。

### §0.1 现状 vs 目标倍率

「需求边长」= `ceil(hero CSS 宽 × DPR)`，因 `object-fit: cover` 且 hero 宽恒大于高，取宽为准。几何推导见 §1.3。

| 场景 | CSS 视口 | DPR | hero CSS 宽 | 需求边长 | 现状倍率 @512（播放列表页） | 现状倍率 @256（分类页） | **目标倍率 @1536** | 目标倍率 @2048（储备档） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | 1920 | 1 | 1550 | 1550 | 3.03× | **6.05×** | **1.01×** | 0.76×（缩小） |
| 2560×1440 | 2560 | 1 | 2190 | 2190 | 4.28× | **8.55×** | **1.43×** | **1.07×** |
| 2880×1920 @200% | 1440 | 2 | 1070 | 2140 | 4.18× | **8.36×** | **1.39×** | **1.05×** |
| 640×1440（最小宽度，DPR2） | 640 | 2 | 608 | 1216 | 2.38× | **4.75×** | 0.79×（缩小） | 0.59× |
| 640×1440（DPR3 手机） | 640 | 3 | 608 | 1824 | 3.56× | **7.13×** | **1.19×** | 0.89× |
| 1024 断点 | 1024 | 1 | 992 | 992 | 1.94× | **3.88×** | 0.65× | 0.48× |

**最大残余放大倍数：** @1536 为 **1.43×**（2560×1440@1x），@2048 为 **1.07×**。**结论：2048 足以覆盖全部四种既有配置，不需要 3072。** 3072 只在 ≥3200px 物理宽度（例如 4K@1x：hero 3470px）才有意义，属超出当前配置清单的储备，见 §11。

### §0.2 三个必须同时处理的预算冲突（本文最重要结论）

| # | 冲突 | 现状证据 | 若不处理的后果 | 本文结论 |
| --- | --- | --- | --- | --- |
| **P-1** | hero 档位若同时放大 `PLAYLIST_ARTWORK_INFLIGHT_BUDGET` | `useAudioPlayer.ts:230` `= MAX_CONCURRENT*512*512*4`，`MAX_CONCURRENT=4`（`playlistCoverScheduler.ts:83`） | 1536 时 warm 预算 **−3.8 MiB**、2048 时 **−44 MiB** ⇒ 所有 optional prefetch 被拒，滚动预热消失，抵消 OPT-0018 收益 | **不改 `INFLIGHT_BUDGET`**（继续按列表卡 pixel 回落 512 定宽），另设单槽 hero 预留；`RESIDENT_BUDGET` 48 → **64 MiB** |
| **P-2** | 分类页 store 完全无字节预算 | `useAllSongsWindow.ts:147` 只有 `CACHE_LIMIT = 60`；`trimCache`（`:360-371`）按张数与 `desired`/`leases` 保护，**全文无 BUDGET/BYTES 常量** | B2 引入的高清 hero 成为被租约保护、永不按字节淘汰的条目；pixel 回落时 2048² BMP **12.58 MiB** 单点常驻 | **靠"hero key 唯一 + 离场降档"把高 edge 条目锁死在 1 张**（§7.4），不引入字节预算（理由见 §7.5） |
| **P-3** | 跨端常量 `THUMBNAIL_PATH_MAX_EDGE = 512` 是硬编码 | `audioCommands.ts:576`，校验在 `:603-604`，错误在 `:607` | 扩档后每个响应被判 `metadata is inconsistent` → `notePathLaneFailure` → 8 次熔断（`PATH_LANE_FAILURE_THRESHOLD = 8`，`playlistCoverPathLane.ts:53`）→ 整条 path lane 会话级失效。这是 `OPT-0018-v2-result.md:446,469` 已记录的失败模式 | 必须与 Rust 白名单**同批**修改，并加跨端一致性测试 |

### §0.3 关于「1 MiB 单文件上限」的实测修正（推翻初稿推断）

初稿（含用户原始假设）认为「2048² q82 4:4:4 会击穿 `THUMBNAIL_PATH_MAX_BYTES`」。**实测不成立**：真实封面内容在 2048 档约 **297 KB**，距 1 MiB 有 3.5× 余量。只有逐像素噪声（5995 K）与部分病态棋盘（1024 档 56 K、2048 档 168 K，非单调）越界。详见 §7.6。**因此不为扩档放宽该上限，但建议改为随档位派生的防御性公式**（理由：跨端语义自洽 + 挡住噪点封面的熔断链）。

---

## §1 现状复核

> 本节所有 `path:line` 均为本次直接阅读所得。与 `cover-sharpness-comparison.md` 不一致处以本文为准。

### §1.1 两条封面通道与 hero 档位

| 面板 | hero 渲染位置 | 通道（hook） | 通道内 hero 档位 | 证据 |
| --- | --- | --- | --- | --- |
| 播放列表详情 | `PlaylistPanel.tsx:965` | `useLibraryArtwork` | **512** | `useLibraryArtwork.ts:727`、`:741`、`:761` |
| 专辑 / 艺术家 / 流派 / 年份 | `AlbumLibraryPanel.tsx:453-456` | `useAllSongsWindow` | **256** | 全文 9 处 `maxEdge: 256` 字面量 |
| 文件夹 / 平铺 | `FolderHierarchyPanel.tsx:369-372` | `useAllSongsWindow` | **256** | 同上 |

`useAllSongsWindow.ts` 的 9 处硬编码 `256`：`:522`、`:533`、`:534`、`:717`、`:741`、`:764`、`:768`、`:784`、`:785`。**没有任何 hero 特例**，也没有把 edge 参数化的入口（`AllSongsCoverItem` 是 `pick` 类型，`useAllSongsWindow.ts:34-37`，不含 edge 字段）。

⇒ **分类页模糊比播放列表页严重一倍（同场景 8.55× vs 4.28×），且两条通道修复方式不同。**

### §1.2 后端边缘白名单与派生关系

`src-tauri/src/audio/cover_pixels.rs`：

| 常量 | 行 | 值 | 用途 |
| --- | --- | --- | --- |
| `ALLOWED_MAX_EDGES` | `:37` | `[256, 512, 768, 1024, 1536, 2048, 3072]` | 播放器大图通道（**已含 1536/2048**） |
| `ALLOWED_PLAYLIST_MAX_EDGES` | `:38` | `[128, 256, 512]` | 列表通道（**hero 走这条**） |

校验与派生：

| 结论 | 证据 | 是否随白名单自动放宽 |
| --- | --- | --- |
| `validate_max_edge` 用 `ALLOWED_MAX_EDGES` | `:2922-2938` | 是 |
| `validate_playlist_max_edge` 错误文案硬编码 `"playlist cover maxEdge must be 128, 256, or 512"` | `:2940-2949`，文案在 `:2946` | **否，必须手改** |
| `validate_decode_max_edge` = 播放列表集 ∪ 播放器集 | `:2951-2957` | 是 |
| `parse_playlist_jpeg` 的尺寸 ceiling 由 `ALLOWED_PLAYLIST_MAX_EDGES.iter().max()` **派生** | `:2564-2568` | **是，自动放宽** |
| `load_track_thumbnail` 像素通道硬编码 `matches!(max_edge, 128 \| 256)` | `:1092-1097` | **否** |
| `try_warm_track_thumbnail` 硬编码 `128 \| 256` | `:2092-2097` | **否** |
| `load_folder_thumbnail_blocking` 硬编码 `matches!(max_edge, 128 \| 256)` | `folder_cover.rs:550-555` | **否** |
| `load_folder_thumbnail_path_blocking` 走 `validate_playlist_max_edge` | `folder_cover.rs:822-825` | 是（path lane 自动放宽） |
| `load_track_thumbnail_path_blocking` 不校验（由 coordinator 校验） | `:1838-1845`，coordinator 在 `:1224` | 是 |

⇒ **`audioCommands.ts:576` 的 `THUMBNAIL_PATH_MAX_EDGE` 是唯一"硬编码且必须手改"的前端常量；Rust 侧真正必须手改的只有 `:2946` 的错误文案，白名单本身是单一真源。**

### §1.3 hero 几何（计算推导）

播放列表页 `playlist-panel.css`：`:25` `padding: 0 16px 48px`；`:43` `width: 100%`；`:943` `@media (width > 1024px) { .playlist-panel { left: 320px; padding-inline: 25px } }`；`:944` `height: 320px`；`:45` `height: clamp(320px, calc(320px + (100vw - 640px) * 0.5), 460px)`；`:66-78`（`.playlist-hero-image`）`width: 100%; object-fit: cover`。

分类页 `album-library.css`：`:21/:55/:61/:68/:125` 均为 `width: calc(100% - 50px); height: 320px; padding: 10px; margin-inline: 25px`；容器 `playlist-management.css:6` `inset: 0 0 0 320px`，`@media (width <= 1024px)` 时 `:59` `left: 0`。全局 `index.css:190-192` `* { box-sizing: border-box }`。

| 条件 | 播放列表页 hero border-box 宽 | 分类页 hero border-box 宽 |
| --- | --- | --- |
| 视口 > 1024 | `视口 − 320 − 50` | `视口 − 320 − 50`（相同） |
| 视口 ≤ 1024 | `视口 − 32` | `视口 − 50` |

**断点骤降（关键）：** 视口 1024 → hero `1024 − 32 = 992` CSS px；视口 1025 → hero `1025 − 320 − 50 = 655` CSS px。**跨过 1024 断点，hero CSS 宽度从 992 骤降到 655（−34%）**。选档函数若只看 `innerWidth` 而不按同一断点分段，跨断点时会算错一档。§6.3 给出处理方式。

分类页 hero 在所有断点都比播放列表页窄 0–18 px，且高度固定 320（不参与 `clamp`），故**需求边长略小于播放列表页**，可共用同一套档位桶而不必分离。

### §1.4 预算常量

`cover_pixels.rs`：

| 常量 | 行 | 值 | 是否需随本方案修改 |
| --- | --- | --- | --- |
| `MAX_DECODE_BYTES` | `:27` | 256 MiB | 否（单张解码上界，2048² RGBA=16.8 MiB 远低） |
| `MAX_OUTPUT_BYTES` | `:28` | `3072*3072*4` ≈ 36 MiB | 否 |
| `MAX_PLAYLIST_DECODE_PERMITS` | `:59` | 4 | 否（并发宽度，非档位） |
| `THUMBNAIL_CACHE_BYTES` | `:91` | 8 GiB | 否（见 §7.7 磁盘评估） |
| `THUMBNAIL_CACHE_FILES` | `:92` | 32768 | 否（见 §7.7） |
| `THUMBNAIL_CACHE_SCAN_LIMIT` | `:93` | 65536 | 否 |
| `THUMBNAIL_PENDING_BYTES` | `:101` | 32 MiB | 否（是"待写队列"字节，与单文件大小无关；2048 真实封面 297 KB） |
| `THUMBNAIL_DISK_VERSION` | `:103` | 1 | **否** |
| `THUMBNAIL_TRANSFORM_VERSION` | `:104` | 2 | **否** |
| `THUMBNAIL_IMAGE_VERSION` | `:112` | 1 | **否** |
| `THUMBNAIL_PATH_MAX_BYTES` | `:119` | 1024*1024（1 MiB） | **建议改（§7.6）**，非必须 |
| `THUMBNAIL_JPEG_QUALITY` | `:120` | 82 | 否 |
| `THUMBNAIL_PATH_PUBLISH_TIMEOUT` | `:126` | 2 s | 否 |

### §1.5 缓存键自动分裂（无需清缓存、无需升版本）

| 结论 | 证据 |
| --- | --- |
| `.spxr` 文件名 `{blake3}-{max_edge}-t2-d1.spxr` | `:2221-2226` |
| `.jpg` 文件名 `{blake3}-{max_edge}-t2-j1.jpg` | `:2235-2240` |
| 两条 lane 共用一套预算与临时文件协议，扩展名/版本标记不同 | `:2246-2262`；`MANAGED_THUMBNAIL_EXTENSIONS` `:133` |

⇒ **新增 1536/2048 档位会落到全新文件名，旧 256/512 缓存继续命中，不需要清缓存，也不需要 bump 任何版本常量。** 这是本方案成本最低的一环，也是"扩档位不安全"直觉不成立的直接证据。

### §1.6 前端预算常量

| 常量 | 位置 | 值 | 现状用途 |
| --- | --- | --- | --- |
| `PLAYLIST_ARTWORK_RESIDENT_BUDGET` | `useAudioPlayer.ts:223` | 48 MiB | 列表整表驻留（BMP URL + 在飞 RGBA） |
| `PLAYLIST_ARTWORK_INFLIGHT_BUDGET` | `useAudioPlayer.ts:230` | `MAX_CONCURRENT*512*512*4` = 4 MiB | 在飞 RGBA 预留，注释明确按"最大 playlist edge=512"推导 |
| `playlistArtworkBytes(edge)` | `useAudioPlayer.ts:236-238` | `edge*edge*7 + 54` | 按 edge 估算单张驻留 |
| `playlistImageBytes(image)` | `useAudioPlayer.ts:232-234` | `encodedBytes + w*h*4` | 按已发布图像估算 |
| `MAX_CONCURRENT` | `playlistCoverScheduler.ts:83` | 4 | 共享调度器并发宽度 |
| `MAX_RESIDENT` | `useLibraryArtwork.ts:92` | 80 张 | **只有张数，无字节预算** |
| `MAX_DETAIL` | `useLibraryArtwork.ts:93` | 40 | 详情预取上限 |
| `CACHE_LIMIT` | `useAllSongsWindow.ts:147` | 60 张 | **只有张数，无字节预算** |
| `RECOVERY_RECORD_LIMIT` | `useAllSongsWindow.ts:149` | 128 | 恢复账本条目上限（非像素） |
| `WINDOW_CONCURRENCY` | `useAllSongsWindow.ts:146` | 2 | 分类页封面并发 |
| `PATH_LANE_FAILURE_THRESHOLD` | `playlistCoverPathLane.ts:53` | 8 | 连续真实失败后熔断 |

---

## §2 为什么必须动数据上限（因果链）

### §2.1 「解码期定尺寸」vs「CSS 显示期放大」

```
现状：原图 → Rust 解码并按 maxEdge 缩到 512 → JPEG/BMP → <img> → CSS object-fit:cover 放大到 1550–2190
                                                        ↑
                                          不可逆的信息丢失发生在这一步之前
目标：原图 → Rust 解码并按 maxEdge 缩到 1536 → JPEG/BMP → <img> → CSS 放大到 1.01–1.43 倍
```

**关键点：Rust 侧 `scaled_dimensions` 从不放大（`cover_pixels.rs:2546-2550` 注释明确），所以一旦落盘为 512，任何渲染期优化都只是"把 3–4 倍放大做得更平滑"。** 前端目前已经做到了极限——`useLibraryArtwork.ts` 的两级准入（`:459-487`，先 256 占位、`heroUpgradeReady` 后升级）就是 Poweramp 式的"低档占位→高档升级"，机制完全正确，**只是第二级的目标值被锁在 512**。

⇒ **本方案不改准入机制，只换第二级的目标值。** 这是把风险限制在"档位常量"范围内的核心论据。

### §2.2 Poweramp 的实证对照

见 §3。一句话：Poweramp 清晰的首要原因**不是**解码更聪明，而是**它根本不要求头图填满屏幕宽度**。

### §2.3 反证：不改上限时，任何解码优化都无效

| 假想优化 | 现状收益 | 原因 |
| --- | --- | --- |
| 提高 JPEG 质量 82 → 92 | 无（只增大体积） | 瓶颈是像素数不是压缩 |
| 换 WebP/AVIF | 无 | 同上 |
| 两级升级 → 三级 | 无 | 第二级已是 512 天花板 |
| Lanczos3 → 更锐的核 | 无 | 重采样在 512 目标上已经发生 |
| **提高 maxEdge 512 → 1536** | **放大倍数 4.28× → 1.43×** | 唯一的有效杠杆 |

---

## §3 Poweramp 参照（实证，非推断）

> 全部来自本次直接阅读 `.rea-analysis/` 解码产物。

### §3.1 头图不是全宽 banner

| 结论 | 证据 |
| --- | --- |
| `headerStretchyImage` 指向 `@id/aa_image` | `res/values/styles.xml:11255` |
| `aa_image` 是列表项里的封面控件，不是横幅 | `res/layout-sw2dp/item_track.xml:37`：`<com.maxmpz.widget.player.list.AAImageView android:id="@id/aa_image" style="?ItemTrackAAImage" />` |
| `aaMinSize` = 130.0sp | `styles.xml:11266` |
| `aaMarginBottom` = 200.0dp（文字区另留） | `styles.xml:11265` → `res/values/dimens.xml:277` |
| `altAaLayoutRatio` = 1.85，`maxAvailSizeForAltAaLayout` = 290.0dp | `styles.xml:11275`、`:11277` |
| 默认 `aaItemRatio` = 100.0%（=1.0） | `styles.xml:7438` |

⇒ **头图 = 正方形封面块，边长约 500–900px（1080 宽设备），居中，下方 200dp 给文字。`altAaLayoutRatio` / `maxAvailSizeForAltAaLayout` 不决定封面大小，只决定"是否切成左右并排布局"。**

### §3.2 解码：固定档位 + 两趟采样 + 解码后精缩

| 结论 | 证据 |
| --- | --- |
| 固定档位常量：`0x600`=1536、`0x200`=512、`0x100`=256、`0x80`=128 | `smali/com/maxmpz/widget/bitmaps/А.smali:192-243`（`:218` 取 1536、`:240` 取 512、`:243` 取 256） |
| 两趟解码：先 `inJustDecodeBounds` 后 `inSampleSize` | `smali/com/maxmpz/widget/bitmaps/К.smali:537`、`:547`、`:617`、`:649` |
| 多个 `inSampleSize` 读取点（解码后再比较/精缩） | `К.smali:673`、`:744`、`:785`、`:1030`、`:1052` |

⇒ **Poweramp 也是"固定档位枚举"，不是无限按需尺寸。这与本方案新增 2048 档的做法同构，不是"动态任意尺寸"那套。**

### §3.3 能借鉴什么 / 不能借鉴什么

| # | Poweramp 做法 | SpMusic 能否借鉴 | 理由 |
| --- | --- | --- | --- |
| 1 | **头图不填满宽度**（正方形封面块，按可用高约束） | **不能** | 用户明确要求保留全宽填充；改回封面块属视觉设计变更（§4 方案 C） |
| 2 | 固定档位请求高档（头图态取 1536） | **能** | 本方案 §5 直接对应；这是最直接的收益 |
| 3 | 解码期按目标尺寸定尺寸（两趟 + `inSampleSize`） | **部分能** | Rust 侧已按 `maxEdge` 定尺寸（`decode_playlist_image` 路径），无需移植 Android 位图 API 的机制，只需提高目标值 |
| 4 | 低档占位 → 高档升级 | **已具备** | `useLibraryArtwork.ts:459-487` 两级准入；只需换第二级目标值 |
| 5 | 内存 URI→entry + 按档位分桶 LRU | **部分能** | `useAllSongsWindow` 的 `store.cache` 与 `useLibraryArtwork` 的 `runtime.cache` 已是按 key 的 LRU 变体；**但两者都缺按档位/字节的桶**，见 §7.4–7.5 |

**结论：SpMusic 若坚持全宽 banner，能借鉴第 2/3/4 条，借鉴不了第 1 条（最省力的那条）。因此必须拆掉 512/256 上限；否则任何解码优化都只是"把 3–8× 放大做得更平滑"。**

---

## §4 方案取舍

### §4.1 方案 A：只解播放列表通道

| 项 | 内容 |
| --- | --- |
| 改动文件 | `cover_pixels.rs`（白名单 + 文案）、`audioCommands.ts`（联合类型 + `THUMBNAIL_PATH_MAX_EDGE`）、`useLibraryArtwork.ts`（档位）、`useAudioPlayer.ts`（`targetEdgeFor` + 预算）、`PlaylistPanel.tsx`（无改动，选档靠 CSS 测量） |
| 收益 | 播放列表详情页 4.28× → 1.43×（2560@1x） |
| 代价 | 小：不动 `useAllSongsWindow` 的 9 处硬编码，不动分类页面板 |
| **回归风险** | 中：仍需处理 P-1（播放态 hero 也走这条）+ P-3（跨端常量） |
| **致命缺陷** | **分类页 8.55× 完全不变**，而分类页恰恰是模糊更严重的一侧（§1.1 表）。用户感知会变成"有的页面清楚有的不清楚"，比统一模糊更难接受 |

**结论：不推荐。** 它把"两处不一致"变成"三处不一致"（播放列表页/分类页/播放态）。

### §4.2 方案 B：两条通道都解

共同改动：A 的全部 + `useAllSongsWindow`（edge 参数化）+ 各分类面板（hero item 携带 edge）。

两条子路线：

#### B1：`desired` 改成 `Map<string, edge>`，cache 行按 edge 分裂

| 项 | 内容 |
| --- | --- |
| 改动点 | `useAllSongsWindow.ts:339` `desired: Set<string>` → `Map<string, edge>`；`:1068`、`:1097-1098`、`:1116`、`:1151`、`:1010-1011` 五处 `Set` 操作全部改写；`coverIdentity`（`:69-74`）加入 edge；`pump`（`:657-663`）与 `publish`（`:390-417`）按 (key, edge) 记账；`trimCache`（`:360-371`）按 edge 分裂后重算张数 |
| 收益 | 同一 key 可同时存在 hero 高档与卡片低档；语义最"正确" |
| 代价 | **大**：直接触碰 OPT-0018 刚稳定的缓存/租约/恢复/token 报告机制。`publishSequences`、`recovery`（`createCoverRecoveryLedger`）、`lastPresented`、`transientFailures` 全部以 `key` 为索引，分裂后会变成以 `(key, edge)` 为索引——这是 8 个 Map/Set 的语义变更 |
| 回归风险 | **高**。`allSongsCoverCache.browser.test.mjs:145`、`useAllSongsWindow.test.mjs:163,435` 都断言 256；恢复账本的"一次 epoch 一次恢复"语义在 edge 维度上会产生歧义（哪个 edge 的 epoch？） |

#### B2（推荐）：给 hero 一个独立的 cover key

| 项 | 内容 |
| --- | --- |
| 核心 | hero 的 `collectionCover()` / `flatFolderCover()` 生成的 key 追加 `\|hero` 维度（或独立 identity），使其成为 store 里的**独立条目** |
| 收益 | ① 天然复用既有的窗口化/租约/恢复/token 报告机制，**不改 `desired` 的结构**；② 卡片缓存完全不动 ⇒ `useAllSongsWindow.test.mjs:163,435`、`allSongsCoverCache.browser.test.mjs:145` 的 256 断言**继续成立**（这是 B2 最强的可行性证据）；③ "一个 key 只对应一个 edge"这条不变式由构造保证，不需要在 `coverIdentity` 里引入 edge |
| 代价 | 中：需同步 `data-cover-key`（`CollectionHero.tsx:27`、`AlbumLibraryPanel.tsx:473`）、`useAllSongsCoverLease` 调用（`AlbumLibraryPanel.tsx:337`、`FolderHierarchyPanel.tsx:218`）、`coverPriority`（`useAllSongsWindow.ts:422-423`，让 hero 优先）；且 hero 需要能表达"我要哪个 edge"，即 `AllSongsCoverItem` 加可选 `edge` 字段 |
| 回归风险 | 中低：`uniqueCovers`（`AlbumLibraryPanel.tsx:84-86`）按 key 去重，hero 独立 key 后不会与卡片互相覆盖；`collectionArtworkOverlay` / 共享元素过渡依赖 `heroCoverItem.key`，需同步核对 |

**推荐 B2。理由不是"回归面小"，而是它保住了一条关键不变式：`store.cache` 中一个 key 永远只对应一个 edge。** 该不变式是 `publish`（`:390-417`）"一次 commit 一个 URL"、`recovery`"一次 epoch 一次恢复"、`trimCache`"张数上限"三套机制共同依赖的前提。B1 会同时推翻三者；B2 则把新增的多样性挡在一个新 key 后面。

> ⚠️ **对用户前提的一处必要更正（详见 §12.4）：** 用户原述「分类页 hero 与首张卡片共享同一 key」。本次逐行核对后**不成立**：`album = ...`（`AlbumLibraryPanel.tsx:286`）与 `heroPrefix`（`:253`）在 overview 模式下取的是**集合自身** key（流派/年份/艺术家），而 `entryCovers` 用的是**专辑** key（`identityPrefix`，`:252`），两者必然不同；在 detail 模式下 hero 与卡片同 prefix，但此时卡片渲染的是 `visibleSongs`（歌曲项）而非专辑项（`:340`）。`FolderHierarchyPanel` 同理：hero 是当前目录（`:214-217`），卡片是子目录（`:210-213`）。**因此"提档会污染首张卡片"的直接因果不成立。** 但 B2 仍然必要——理由改为上述不变式，以及下列新发现的命令族约束（§4.3）。

### §4.3 B2 的新增约束：分类页 hero 在高档位没有 pixel 回落通道（重要）

这条是本次核对才发现的，直接决定 B2 的实现形态：

| 通道 | 命令 | 允许 edge | 证据 |
| --- | --- | --- | --- |
| track 路径 | `audio_load_track_thumbnail_path` | 播放列表集（自动放宽） | `cover_pixels.rs:1224` |
| track 像素 | `audio_load_track_thumbnail` | **硬编码 128/256** | `cover_pixels.rs:1092-1097` |
| folder 路径 | `audio_load_folder_thumbnail_path` | 播放列表集（自动放宽） | `folder_cover.rs:822-825` |
| folder 像素 | `audio_load_folder_thumbnail` | **硬编码 128/256** | `folder_cover.rs:550-555` |
| playlist-cover 像素 | `audio_load_playlist_cover_pixels` | 播放列表集 | `cover_pixels.rs:1042` |

`useAllSongsWindow` 对 `track-candidates` 与 `folder` 项都是"path lane 优先 + 回落 `scheduleTrackThumbnail` / `scheduleFolderThumbnail`"（`:716-770`、`:783-785`），**回落通道的像素命令只接受 128/256**。

⇒ **若让分类页 hero 直接以 1536 请求并沿用现有回落路径，回落时会收到 `InvalidMaxEdge` → 计一次真实失败 → 8 次后熔断整条 path lane。** 这比模糊严重得多。

**处理方式（写入 §5 契约）：**

1. hero 的高档位请求**只允许走 path lane**；
2. path lane 失败时回落**必须显式降回 256**（`maxEdge: 256`），不得沿用 hero edge；
3. 该降级由 `useAllSongsWindow` 的 hero 分支判定，不由调用方各写一遍；
4. 可选强化（第二批）：把 `track`/`folder` 像素通道的白名单也接入 `ALLOWED_PLAYLIST_MAX_EDGES`，从而允许高档像素回落——但这会放大 JS 堆峰值（§7.3），**不建议与本方案同批**。

### §4.4 方案 C：改回 Poweramp 式封面块布局

| 项 | 内容 |
| --- | --- |
| 改动 | `playlist-panel.css:39-51`（`.playlist-hero` 全宽）、`:943-944`；`album-library.css:21/55/61/68/125`；`CollectionHero.tsx` 结构 |
| 收益 | **根治**：需求边长降到 ~300–400，256 档就够，内存与磁盘双降 |
| 代价 | 视觉设计变更，需产品确认；破坏 `artworkLayoutId` 共享元素过渡（`PlaylistPanel.tsx:962`、`AlbumLibraryPanel.tsx:454` 依赖 hero 与原卡片的几何映射）；需重调 `--playlist-hero-overscroll-scale` 过滚拉伸（`playlist-panel.css:40`、`:72-73`） |
| 回归风险 | 高，且跨 UI/UX + Frontend 两个 Agent 边界 |
| 判定 | **用户已明确否决**（"优先保留全宽填充"、"不接受破坏现布局的大改版"）。列为长期备选，不在本方案范围 |

### §4.5 方案对比总表

| 维度 | A（只解播放列表） | **B1**（改共享缓存） | **B2（推荐）**（hero 独立 key） | C（改布局） |
| --- | --- | --- | --- | --- |
| 播放列表页 2560@1x | 4.28× → 1.43× | → 1.43× | → 1.43× | → ≈1× |
| 分类页 2560@1x | **8.55×（不变）** | → 1.43× | → 1.43× | → ≈1× |
| 改动文件数 | 4 | 8 | **7** | 6+ 设计变更 |
| 是否动 `desired` 结构 | 否 | **是** | 否 | 否 |
| 既有 256 断言 | 保持 | **失效** | **保持** | 失效 |
| 触碰 OPT-0018 恢复/租约语义 | 否 | **是（8 个 Map）** | 否 | 否 |
| 新增命令族约束 | 无 | 有（§4.3） | 有（§4.3，需显式降档） | 无 |
| 回归风险 | 中 | **高** | **中** | 高 + 需设计批准 |
| 判定 | 否 | 备选 | **推荐** | 长期备选 |

---

## §5 详细改动清单

> 分两层标注：**[必须]** = 分批实施的第一批；**[建议]** = 防御性/可延后。所有行号为本方案基线。

### §5.1 Rust 常量与校验

| # | 位置 | 改法 | 影响 |
| --- | --- | --- | --- |
| R1 **[必须]** | `cover_pixels.rs:38` | `ALLOWED_PLAYLIST_MAX_EDGES: [u32; 3] = [128, 256, 512]` → 加入 `1536`（第一批）；若批准 D2 再含 `2048` | hero 请求不再被拒；`parse_playlist_jpeg` 的 ceiling 自动放宽（`:2564-2568`） |
| R2 **[必须]** | `cover_pixels.rs:2940-2949`，文案 `:2946` | 错误文案改为由白名单派生（仿 `validate_max_edge` `:2928-2935` 的 `join(", ")` 写法），消除硬编码 | 避免"白名单改了、文案没改、测试读文案"的二次耦合 |
| R3 **[建议]** | `cover_pixels.rs:119` | `THUMBNAIL_PATH_MAX_BYTES` 由固定 1 MiB 改为随档位派生（公式见 §7.6） | 跨端语义自洽；挡住噪点封面触发熔断链 |
| R4 **[建议]** | `cover_pixels.rs:1092-1097`、`:2092-2097`、`folder_cover.rs:550-555` | **本批不改**，但加注释说明"track/folder 像素通道刻意停在 128/256，是为了限制 JS 堆峰值；高档位只走 path lane" | 把 §4.3 的约束写进代码，防止后人误放宽 |
| R5 **[必须]** | `cover_pixels.rs:5954`、`:5955`、`:5956-5961`、`:5620` | 改既有断言（详见 §8.1） | 测试与新白名单一致 |
| R6 **[必须]** | `cover_pixels.rs:5623-5629` | 保持 `player_lane_still_accepts_512_as_pixels` 不变，并新增"playlist path lane 与 player lane 在 1536/2048 上重叠但仍由命令族分层"的用例 | 锁定 `2026-11-07-album-cover-asset-pipeline.md:57-74` 的"分层由命令族决定，不由数值决定"决策 |

### §5.2 Rust 预算

| # | 位置 | 改法 | 影响 |
| --- | --- | --- | --- |
| R7 **[必须]** | `cover_pixels.rs:91-101` | **不改任何数值**。仅在 `THUMBNAIL_PATH_MAX_BYTES` 注释（`:114-118`）中补一句"上限按档位派生，见 §7.6" | 8 GiB / 32768 / 32 MiB 对 1536–2048 档仍充分（§7.7） |
| R8 **[建议]** | `cover_pixels.rs:114-118` | 注释里"512 px 4:2:2 JPEG ... stays far below this value"需更正：实测编码器是 **4:4:4 无色度子采样**，且 2048 真实封面约 297 KB | 注释与实现对齐（当前注释的 4:2:2 描述与 §7.6 实测不符） |

### §5.3 TS 类型

| # | 位置 | 改法 | 影响 |
| --- | --- | --- | --- |
| T1 **[必须]** | `audioCommands.ts:118` | `AudioLoadPlaylistCoverPixelsInput.maxEdge: 128 \| 256 \| 512` → 加 `1536`（+`2048`） | 像素回落通道类型对齐 |
| T2 **[必须]** | `audioCommands.ts:170` | `AudioLoadPlaylistCoverThumbnailPathInput.maxEdge` 同上 | hero 主通道 |
| T3 **[必须]** | `audioCommands.ts:155`、`:163` | `AudioLoadTrackThumbnailPathInput` / `AudioLoadFolderThumbnailPathInput` 同上 | 分类页 hero 走 track/folder path lane |
| T4 **[必须]** | `audioCommands.ts:125`、`:133` | `AudioLoadTrackThumbnailInput` / `AudioLoadFolderThumbnailInput` **不改**（仍 128\|256，对应 R4） | 保证 §4.3 的降档回落类型上不可能传错 |
| T5 **[必须]** | `audioCommands.ts:576` | `const THUMBNAIL_PATH_MAX_EDGE = 512` → 与 Rust 白名单最大值同步。**建议改为从共享常量模块导出，并在 Rust 侧加同名派生**（见 §8.1 跨端一致性用例） | 解 P-3 熔断陷阱 |
| T6 **[必须]** | `audioCommands.ts:580` | 若批准 R3，则 `THUMBNAIL_PATH_MAX_BYTES` 同步为派生函数 `max(1 MiB, edge*edge/2)` | 跨端字节上限一致 |
| T7 **[必须]** | `useLibraryArtwork.ts:45`、`:50`、`:74` | `desired` / `detailPaths` / `recoveryEdge` 的 `128 \| 256 \| 512` → 引入具名类型 `PlaylistCoverEdge` | 消除三处重复字面量联合 |
| T8 **[建议]** | `useAllSongsWindow.ts:34-37` | `AllSongsCoverItem` 三型各加可选 `edge?: number`（见 T9 的用法） | hero 表达目标档位的唯一入口 |

### §5.4 `useLibraryArtwork`

| # | 位置 | 改法 | 影响 |
| --- | --- | --- | --- |
| L1 **[必须]** | `:727` | `runtime.detailPaths.set(..., 512)` → `selectHeroEdge()` | 详情首曲 hero 目标档位改为测量值 |
| L2 **[必须]** | `:741` | 同上（warmTrackId 分支的首曲） | 同上 |
| L3 **[必须]** | `:761` | `paths.set(key, 512)` → `selectHeroEdge()` | 同上（`keepPersistentArtwork` 分支） |
| L4 **[必须]** | `:627` | `const failedEdge = entry.edge <= 256 ? 256 : 512` → `entry.edge <= 256 ? 256 : entry.edge` | **修复既有契约违背**：`:70-73` 注释明确"必须在失败的档重读"，当前 512 之后的档位会被错误降级到 512 |
| L5 **[必须]** | `:296`、`:416`、`:445` | `readEdge: 128\|256\|512` 与 `Math.max(readEdge, 256)`、失败占位的 `edge: 512` 改为具名类型；`:445` 的占位 edge 应改为"当前 demand 的 edge"以便重试不回退 | 占位行不再把 edge 写死成 512 |
| L6 **[必须]** | `:465-481` | 两级准入**结构不变**，仅第二级目标值随 `detailPaths` 自然变成 `selectHeroEdge()` 结果 | 保留 Poweramp 式升级，零机制改动 |
| L7 **[建议]** | `:92` `MAX_RESIDENT = 80` | 保持 80；新增注释说明"hero 单张 1536 占 1/80 张，但字节占比远高于列表项；字节安全由 §7 的档位上限保证" | 明确不做字节预算的理由（§7.2） |

### §5.5 `useAudioPlayer`

| # | 位置 | 改法 | 影响 |
| --- | --- | --- | --- |
| P1 **[必须]** | `:2610-2618` `targetEdgeFor` | `firstTrackId` 分支返回 `512` → 返回 `selectHeroEdge()`；`return firstVisual?.coverThumbnail && ... ? 512 : 256` 同步 | **播放态 hero 与浏览态一致**（`PlayerShell.tsx:842` 二选一 owner 的两种进入方式清晰度必须相同，否则是最难发现的回归） |
| P2 **[必须]** | `:230` `PLAYLIST_ARTWORK_INFLIGHT_BUDGET` | **保持 `MAX_CONCURRENT * 512 * 512 * 4` 不变**；注释改写为"列表卡 pixel 回落宽度为 512；hero 的 pixel 回落由 `activeBytes`（`:2636-2637`，已按 `job.maxEdge²*4` 逐作业计费）覆盖" | 阻止"按 hero 档位放大预留"导致的预算变负（P-1） |
| P3 **[必须]** | `:223` `PLAYLIST_ARTWORK_RESIDENT_BUDGET` | `48 * 1024 * 1024` → `64 * 1024 * 1024`，注释给出推导（§7.2） | 保证 hero 1536 时 warm 预算仍为正且预取不塌缩 |
| P4 **[建议]** | 新增 `PLAYLIST_ARTWORK_HERO_MAX_EDGE` | 单一常量，供 `selectHeroEdge()` 与 P3 注释共同引用 | 消除"档位上限散落在多处"的隐患 |
| P5 **[必须]** | `:236-238` `playlistArtworkBytes` | **公式不改**；加注释说明它是"pixel lane（RGBA+BMP）最坏上界"，对 path lane 是高估（§7.3） | 保持保守记账，不改 OPT-0018 刚稳定的预算逻辑 |

### §5.6 `useAllSongsWindow`

| # | 位置 | 改法 | 影响 |
| --- | --- | --- | --- |
| W1 **[必须]** | `:522`、`:533`、`:534`、`:717`、`:741`、`:764`、`:768`、`:784`、`:785` | 9 处 `maxEdge: 256` 字面量 → 从 item 取 `heroEdge(item) ?? 256`；**像素回落处（`:741`、`:784-785`）固定传 256** | 实现 §4.3 契约：高档只走 path lane，回落必降 256 |
| W2 **[必须]** | 新增 `heroEdge(item)` 辅助 | `item.kind === 'track-candidates' \|\| item.kind === 'folder'` 且 item 标记为 hero 时返回 `selectHeroEdge()`，否则 256 | edge 语义集中一处 |
| W3 **[必须]** | `:660` `coverIdentity(cached) !== coverIdentity(candidate)` | **不改**。因 B2 保证"一 key 一 edge"，不需在 identity 里加 edge | 避免 B1 的破坏面 |
| W4 **[必须]** | `:422-423` `coverPriority` | hero 项返回 `0`（与 `runtime.visible` 同级或更高），使其排在卡片前 | hero 首屏优先，避免高清图跟在几十张卡片后面排队 |
| W5 **[建议]** | `:360-371` `trimCache` | **不引入字节预算**；仅加注释说明"高 edge 条目由 §7.4 的单例 key 约束保证最多 1 张" | 见 §7.5 论证 |
| W6 **[建议]** | `:500-506` 处注释 | 更新"256 track/folder pixels"的表述，说明 hero 例外 | 注释与实现一致 |

### §5.7 各面板组件

| # | 位置 | 改法 | 影响 |
| --- | --- | --- | --- |
| C1 **[必须]** | `AlbumLibraryPanel.tsx:78-82` `collectionCover` | 增加可选参数 `heroEdge`，key 后缀加 `\|hero` 维度（例：`['collection-cover', prefix, entry.key, 'hero']`） | hero 独立条目（B2 核心） |
| C2 **[必须]** | `AlbumLibraryPanel.tsx:334` `heroCoverItem` | 调用时传 hero 档位，生成 hero key + edge | hero 独立请求 |
| C3 **[必须]** | `AlbumLibraryPanel.tsx:336` `entryCovers` | **不改**（继续 256） | 卡片缓存不动 |
| C4 **[必须]** | `AlbumLibraryPanel.tsx:337` | `useAllSongsCoverLease(store, heroCoverItem?.key)` 自动跟随新 key | 租约保护新条目 |
| C5 **[必须]** | `AlbumLibraryPanel.tsx:339-342` `uniqueCovers` | hero key 已独立，去重不会吞掉卡片；确认 `coverItems` / `renderedCovers` 两者都含 hero | 无行为变化 |
| C6 **[必须]** | `AlbumLibraryPanel.tsx:456` `coverKey={heroCoverItem?.key}` | 自动跟随；同时 `CollectionHero.tsx:27` 的 `data-cover-key` 自动正确 | DOM 标记一致 |
| C7 **[必须]** | `AlbumLibraryPanel.tsx:471-475` | 「所有流派/年份/艺术家歌曲」按钮复用 `heroCoverItem`，提档后这些小封面也会用高清图。**建议此处传一个非 hero 的轻量 item**（或复用 `collectionCover` 非 hero 形态） | 避免 60×60 小图标请求 1536 图导致浪费与错配感知 |
| C8 **[必须]** | `FolderHierarchyPanel.tsx:47-51` `flatFolderCover` | 同 C1：加可选 hero 维度 + edge | 平铺模式 hero 独立 |
| C9 **[必须]** | `FolderHierarchyPanel.tsx:214-217` `heroCover` | 同上（注意非 flat 分支是 `kind: 'folder'`，走 `coverKey` `:209`） | 层级模式 hero 独立 |
| C10 **[必须]** | `FolderHierarchyPanel.tsx:209` `coverKey` | 若 hero 复用该函数，需增加 hero 变体；否则在 `:214-217` 内联拼后缀 | 避免 hero/子目录 key 冲突 |
| C11 **[必须]** | `FolderHierarchyPanel.tsx:218` | 租约自动跟随 | — |
| C12 **[必须]** | `GenreLibrary` / `YearLibrary`（同为 `AlbumLibraryPanel.tsx`，由 `categoryId` 分支，`:218-236`） | **无独立改动**：它们的 hero 走 `heroPrefix`（`:253`）与 `heroIdentity`（`:254`）的同一分支，C1–C7 已覆盖。需在评审时确认三条分支（`genreOverview` / `yearOverview` / `artistOverview`）都经过 `collectionCover` hero 变体 | 避免漏改分类 |
| C13 **[必须]** | `PlayerShell.tsx:842` | **不改逻辑**，但需在评审时确认：`isBrowsingActive` 二选一 owner 后，两条 owner 的 hero 档位都取 `selectHeroEdge()`（`useLibraryArtwork` 经 L1-L3，`useAudioPlayer` 经 P1） | 同一详情页两种进入方式清晰度一致 |

### §5.8 选档函数

| # | 位置 | 改法 | 影响 |
| --- | --- | --- | --- |
| S1 **[必须]** | 新增 `src/features/player/services/heroCoverEdge.ts`（或 `model/`） | 实现 `selectHeroEdge()`，口径见 §6 | 单一真源，供 L1-L3 与 P1 与 W2 共用 |
| S2 **[必须]** | 该模块内集中导出 `HERO_EDGE_BUCKETS`、`HERO_LAYOUT_BREAKPOINT = 1024`、`HERO_MAX_EDGE` | 断点与桶与上限三者同处一地 | 消除"只看 innerWidth"的漂移（§6.3） |
| S3 **[必须]** | 复用 `PlaylistPanel.tsx:752-763` 的 `ResizeObserver` + `matchMedia('(resolution: Xdppx)')` 写法 | 作为选档失效监听；**不要**复用 `.cover-frame` 测量目标（见 §6.1） | DPR 变化时重算 |

---

## §6 选档函数设计

### §6.1 测什么元素（口径可复用，测量目标不可复用）

`useArtworkVisualResource.ts:552-561` `selectCoverMaxEdge()` 的口径是"量元素 `clientWidth × DPR` 再取桶"，**这个口径正确、可复用**。但它量的是 `.cover-frame`（`:553`），而 `.cover-frame` 全仓只出现在播放器舞台（`CoverPanel.tsx:79`、`EmptyPlayerState.tsx:35`、`PlayerSurface.tsx` 若干处），**hero 没有 `.cover-frame`**。

hero 的真实容器是 `.playlist-hero-artwork`（`CollectionHero.tsx:29`，样式在 `playlist-panel.css:54-64`，`position: absolute; inset: 0`）。它的 `clientWidth` 就是 hero 的可用宽度，恰好是需求边长的主导量。

⇒ **本方案测量的目标是 `.playlist-hero-artwork`（经 `artworkRef`），不是 `.cover-frame`。** 该 ref 在三个面板都已存在：`PlaylistPanel.tsx:341`、`AlbumLibraryPanel.tsx:273`、`FolderHierarchyPanel.tsx:163`，且都已传给 `CollectionHero`。

### §6.2 算法（示意）

```ts
// 示意，非实现。
export const HERO_LAYOUT_BREAKPOINT = 1024
export const HERO_EDGE_BUCKETS = [1024, 1536, 2048] as const   // 若 D2 只批 1536，则去掉 2048
export const HERO_MAX_EDGE = HERO_EDGE_BUCKETS[HERO_EDGE_BUCKETS.length - 1]

/** 由视口宽推算 hero 的 CSS 宽（不测量时的保守回退）。 */
function heroCssWidthFallback(viewportCssWidth: number): number {
  return viewportCssWidth > HERO_LAYOUT_BREAKPOINT
    ? viewportCssWidth - 320 - 50      // playlist-panel.css:943
    : viewportCssWidth - 32            // playlist-panel.css:25；分类页更窄，按此上界偏保守
}

function bucketCeil(physical: number): number {
  for (const edge of HERO_EDGE_BUCKETS) if (edge >= physical) return edge
  return HERO_MAX_EDGE
}

export function selectHeroEdge(artwork: HTMLElement | null): number {
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  // 优先实测：.playlist-hero-artwork 的 clientWidth 就是 hero 可用宽。
  const measured = artwork?.clientWidth ?? 0
  const cssWidth = measured > 0 ? measured : heroCssWidthFallback(window.innerWidth)
  const physical = Math.ceil(cssWidth * dpr)
  return bucketCeil(physical)
}
```

### §6.3 必须处理：1024 断点骤降

由 §1.3：视口 1024 时 hero 992 CSS px，视口 1025 时骤降到 655 CSS px。若只用 `window.innerWidth × DPR` 且不分段，则在 1025–1100 区间会把需求高估约 50%，可能多跳一档。

**处理方式：**

1. **以实测 `clientWidth` 为主路径**，它天然包含断点效应，不需要复制断点常量；
2. 仅在测量不可用（`clientWidth === 0`，例如首次渲染、元素未布局）时用 `heroCssWidthFallback`，且该回退**必须复用同一个 `HERO_LAYOUT_BREAKPOINT = 1024`**，并与 CSS 的 `@media (width > 1024px)`（`playlist-panel.css:942`）保持字面一致；
3. 加一条单元测试：`1024` 与 `1025` 两个视口的取值必须落在**同一档或相邻档**，且不得出现 1025 档位高于 1024 的情况（当前实现天然满足，测试是防回归）。

### §6.4 何时失效重算

| 触发 | 手段 | 证据/参照 |
| --- | --- | --- |
| 面板尺寸变化 | `ResizeObserver` on `.playlist-panel` | `PlaylistPanel.tsx:752-754` |
| 窗口 resize | `window.addEventListener('resize')` | `PlaylistPanel.tsx:755` |
| **DPR 变化（跨屏拖动、系统缩放切换）** | `matchMedia('(resolution: ${dpr}dppx)')` + 变更后重建 | `PlaylistPanel.tsx:756-763`（既有写法，直接参照） |
| 共享元素过渡期间几何畸变 | 见 §6.5 | — |
| 面板切换/路由变化 | `visibilityKey` / `routeKey` | `useCollectionHeroMotion.ts:44-77` 已提供 |

### §6.5 避免共享元素过渡期测到畸变尺寸（关键）

`CollectionHero.tsx:28-30` 的 `.playlist-hero-artwork` 是 `motion.div` + `layoutId`，在 `PlaylistPanel.tsx:962` / `AlbumLibraryPanel.tsx:454` 传入 `artworkLayoutId` 时会参与 FLIP 共享元素过渡；过渡期间该元素的 `getBoundingClientRect()` / `clientWidth` 是**插值中的中间尺寸**，不是稳定布局尺寸。

若不处理，"进入详情页的 300 ms 内测一次"会得到一个偏小的值（从卡片尺寸插值到全宽），选中偏低档位并把它写进 `detailPaths`，之后即使尺寸稳定也不会重算 ⇒ hero 永久模糊。

**设计（三层防护）：**

1. **不读几何变换后的 rect。** 用 `clientWidth`（布局尺寸）而非 `getBoundingClientRect().width`（含 `scale`）。`playlist-panel.css:40` 的 `scale: 1 var(--playlist-hero-overscroll-scale, 1)` 与 `:73` 的 `scale: 1 calc(1 / ...)` 只影响视觉，`clientWidth` 不受影响 ⇒ **只要坚持用 `clientWidth`，就已经规避了过滚拉伸与 FLIP 缩放两个来源**。FLIP 若通过 `transform: scale` 实现，同样不影响 `clientWidth`；若通过 `width` 实现，则会受影响，需下一层。
2. **过渡期冻结。** 复用既有的"过渡进行中"信号：`localProjection`（`CollectionHero.tsx:14`，由 `heroOffscreen || !sharedProjection` 计算，`AlbumLibraryPanel.tsx:453`）/ `heroOffscreen`（`useCollectionHeroMotion.ts:54-56` 计算并回调）。**在 `sharedProjection && !heroOffscreen`（即正在做共享元素过渡）期间，选档结果保持上一次的稳定值，不重新取样。**
3. **稳定后再确认一次。** 过渡结束（`layoutId` 元素 `transitionend` 或 `heroOffscreen` 首次变为 `true`/`localProjection` 首次为真）后，用 `requestAnimationFrame` 延迟一帧取一次值，若与已发布档位不同则触发一次升级（复用 `useLibraryArtwork.ts:459-487` 的既有升级路径与 `useAllSongsWindow` 的 identity 变更重取路径）。**这与已有的"低档占位 → 高档升级"机制同构，不需要新机制。**

> 与既有代码的边界：`useArtworkVisualResource.ts:552-561` 不处理这个问题（播放器舞台的 `.cover-frame` 不经 FLIP 投影到卡片）；本方案新增的是**hero 专属**的稳定性规则，不修改播放器的选档函数。

---

## §7 预算核算

### §7.1 单张各档成本

| 档位 | RGBA (`edge²×4`) | BMP 对象 URL（`54 + w*h*3`，`playlistCoverPixels.ts:15-16`） | `playlistArtworkBytes`（`edge²×7+54`，`useAudioPlayer.ts:236-238`） |
| --- | --- | --- | --- |
| 256 | 0.25 MiB | 0.19 MiB | 0.44 MiB |
| 512 | 1.00 MiB | 0.75 MiB | 1.75 MiB |
| 1024 | 4.00 MiB | 3.00 MiB | 7.00 MiB |
| **1536** | **9.00 MiB** | **6.75 MiB** | **15.75 MiB** |
| **2048** | **16.00 MiB** | **12.00 MiB** | **28.00 MiB** |

### §7.2 `useAudioPlayer` 的两个预算怎么改（结论）

**先明确 lane 语义，否则两个预算都会算错：**

| lane | JS 侧持有 | 真实位图位置 |
| --- | --- | --- |
| **path lane**（主路径） | 一个 `asset:` URL 字符串（约 100 B）+ `{width,height,byteLength}` 元数据 | WebView/GPU 侧，由 `<img>` 持有，卸载即释放（`useAllSongsWindow.ts:674-677` 注释明确"不得引用计数"） |
| **pixel lane**（回落） | BMP 对象 URL，含完整像素（`encodedBytes = 54 + w*h*3`），**只在 JS 堆** | 同一份数据以 Blob 形式在 JS 堆 |

`playlistArtworkBytes(edge) = edge²×7 + 54` = RGBA(4 B/px) + BMP(3 B/px)，**这是 pixel lane 的最坏上界**，对 path lane 高估约 **7 倍**（见 §7.3 逐档对比）。

**P-1 的定量复算（采纳路径 lane 建模后）：**

| hero 档位 | `playlistArtworkBytes`（committed） | `INFLIGHT` 若按 hero 放大 | warm 可用（现状公式） | 结论 |
| --- | --- | --- | --- | --- |
| 512（现状） | 1.75 MiB | 4.0 MiB | 42.25 MiB | 正常 |
| 1024 | 7.00 MiB | 16.0 MiB | 25.00 MiB | 可接受 |
| **1536** | **15.75 MiB** | **36.0 MiB** | **−3.75 MiB** | ✗ **预算变负 ⇒ 所有 optional prefetch 被拒** |
| **2048** | **28.00 MiB** | **64.0 MiB** | **−44.00 MiB** | ✗ **完全失效** |

**本文结论（对应 §12 的 D1）：**

| 常量 | 现状 | **建议值** | 公式/推导 |
| --- | --- | --- | --- |
| `PLAYLIST_ARTWORK_INFLIGHT_BUDGET` | `MAX_CONCURRENT*512*512*4` = 4 MiB | **保持不变（4 MiB）** | 该预留的目的是"覆盖本 hook 未启动、但共享调度器可能持有的在飞 RGBA"。本 hook 自己启动的作业已由 `activeBytes`（`:2636-2637`）按 `job.maxEdge²*4` **逐作业**计费，天然 edge-aware。共享调度器的其他消费者里，`useAllSongsWindow` 恒为 256，`useLibraryArtwork` 的高档 hero 走 path lane、失败时按 §4.3 **降回 256**。故 512 仍是"可能真实分配 RGBA 的最大宽度" |
| 新增 `playlistArtworkBytes` 的补充项 | — | **不改公式** | 见 §7.3 |
| `PLAYLIST_ARTWORK_RESIDENT_BUDGET` | 48 MiB | **64 MiB** | `48 + (15.75 − 1.75) = 62` 向上取整到 64。推导：hero 从 512 提到 1536 使 committed 增加 14 MiB，若不扩容则 warm 从 42.25 降到 28.25 MiB，可预取 256 卡片从 96 张降到 64 张（−33%）。提到 64 MiB 后 warm = 64 − 15.75 − 4 = **44.25 MiB ≈ 100 张**，略优于现状，即**净预取能力不退化** |

**若 D2 批准 2048：** `64 − 28 − 4 = 32 MiB ≈ 73 张`（仍为正，未瘫痪），无需再提预算。若坚持维持现状 96 张预取，则需 76 MiB；**本文不建议**——2048 下 hero 需求仅 2190px，用 1536（1.43×）已进入"肉眼难辨"区间，不值得再付 12 MiB。

### §7.3 `playlistArtworkBytes` 公式对不对

**结论：公式对 pixel lane 是正确上界，对 path lane 是约 7 倍高估；但仍是正确的"准入记账"，不应改。**

| 档位 | 真实 path lane JS 驻留 | 公式记账 | 高估倍数 |
| --- | --- | --- | --- |
| 256 | ~100 B | 0.44 MiB | ≈4400× |
| 512 | ~100 B | 1.75 MiB | ≈18000× |
| 2048 | ~100 B | 28.00 MiB | ≈290000× |

看起来荒谬，但**这里的记账目的不是"估算真实内存"，而是"准入上限"**：它必须同时覆盖最坏通道（pixel lane 回落），否则一旦回落就会瞬间超出预算。改成 lane-aware 会带来两个代价：

1. 需要在 `playlistTrackVisuals` 上新增/传递 lane 信息（当前只有 `playlistVisualEdgeRef` 与 `visuals`，`useAudioPlayer.ts:2625`、`:2740-2768`）——即触碰 OPT-0018 刚稳定的视觉账本；
2. 需要在 `publish` 与 `preload` 两条路径同步，任一遗漏就会低估并导致 heap 尖峰。

**故保留公式，改为注释其含义**（P5）。这与 `2026-11-07-album-cover-asset-pipeline.md:321` 已记录的结论一致："7 B/px 假设 BMP+RGBA … 保守方向，可以留到有实测数据再收敛"。**本方案不收敛它，因为扩档位不是收敛的时机。**

### §7.4 分类页 store 的字节预算缺失与 B2 的控制设计

**事实（已逐行核实）：**

| 结论 | 证据 |
| --- | --- |
| 只有张数上限 `CACHE_LIMIT = 60` | `useAllSongsWindow.ts:147` |
| 裁剪上限 = `max(60, desired.size)`，即张数或当前需求数取大 | `:364` |
| 淘汰时跳过"仍被需求"的 key | `:367` `if (runtime.desired.has(key) \|\| store.leases.has(key)) continue` |
| 淘汰时跳过"有租约"的 key | 同上 |
| 全文无 `BUDGET` / `BYTES` / `MiB` 类常量 | 对 `useAllSongsWindow.ts` 全文件检索 `maxEdge`/`bytes` 后确认：无字节常量（`MAX_RESIDENT`/`CACHE_LIMIT`/`RECOVERY_RECORD_LIMIT` 全是计数） |
| 租约 = 引用计数，效果是"永不淘汰"，不是"数量上限" | `:190-199` `retain()`；`:1159-1164` `useAllSongsCoverLease` |

⇒ **用户的判断成立：该 store 没有字节预算。同时"租约天然只让 1 张高清 hero 存活"的期望不成立——租约只保证不被淘汰，不保证只有 1 张。**

**B2 的控制设计（推荐 (a) + (c)，不接受 (b)）：**

**(a) 单例化 key —— 由构造保证任意时刻只有一个高 edge key 处于 desired/leased**

- hero key 追加 `|hero` 维度（C1/C8）；由于 `collectionCover` 的 key 已含 `entry.key`，hero key 天然随详情实体变化 ⇒ 旧详情页的 hero key 在路由切换后**不再出现在任何 `items` 数组里**，而 `useAllSongsWindow` 在 `:1150-1151` 会对不在 `renderedItems` 中的 key 执行 `runtime.desired.delete(key)` ⇒ 旧 hero key 立刻离开 desired，随后被 `trimCache` 淘汰。
- **必须核对的共存窗口：** `AlbumLibraryPanel.tsx:338` 的离场租约 `useAllSongsCoverLease(store, present ? undefined : departureCover)` 会额外保护一个 key。核对结果：`departureCover` 由 `AlbumCard` 的 `parentOnActivate` 设为 `entryCovers.get(item.key)?.key`（`:491`）——这是**卡片 key（256）**，不是 hero key。⇒ **离场租约不会保护高 edge 条目，高 edge 条目恒 ≤ 1 张。** 这是 (a) 成立的关键实证。
- 过渡期（`sharedProjection` 期间新旧两个场景同时挂载）可能出现两个 `coverItems` 数组并存：此时若两个详情页 hero 都为高 edge，则短暂 2 张。缓解：由 (c) 覆盖。

**(c) 限制高 edge 只在 hero 可见时持有，离场降档回 256**

- 复用 `useCollectionHeroVisibility`（`useCollectionHeroMotion.ts:44-77`）已产出的 `heroOffscreen` 状态（`:54-56` `onHeroOffscreen` 回调，`:55` 同时驱动 `publishDetailVisibility`）。
- `heroOffscreen === true` 时，hero item 的 `edge` 字段降为 256（W2 读取该字段）；由于 `coverIdentity` 不变，缓存行不会重建，但需要一次显式重取——**这正是 B2 需要新增的机制**：`useAllSongsWindow` 目前**不比较 edge**（`:660` 只有 identity 比较），因此降档后不会自动重取。处理方式：把 `edge` 纳入 hero 项的 identity（**仅 hero 项**，即 `coverIdentity` 对 hero key 追加 edge），使降档/升档成为一次 identity 变化，从而复用已有的"identity 变化即重取"路径（`:660`、`:989-994`）。
  - ⚠️ 该改动使 W3 从"不改"变为"**仅对 hero key 追加 edge**"，这是 B2 中唯一需要触碰 identity 的地方，必须在评审中单独确认。

**为什么不采纳 (b) 给 store 补字节预算：**

1. `trimCache`（`:360-371`）被 7 个面板共用（`BookmarksPanel.tsx:74`、`AlbumLibraryPanel.tsx:139`/`:343`、`FolderHierarchyPanel.tsx:221`、`PlaylistLibraryPanel.tsx:286`、`PlayerSurface.tsx:711`、`SearchPanel.tsx:88`），改它会同时改变全部 7 处的淘汰行为；
2. 现有淘汰顺序依赖插入序（`runtime.cache` 是 `Map`，`:365` 迭代），引入字节维度需要重新定义"先淘汰谁"，这属于新的架构决策，不应夹带在清晰度方案里；
3. (a)+(c) 已把并发的**高 edge 条目数量**锁死为 1–2，字节上界因此可解析地算出（§7.4 末），足以自保。

**最坏单点数值链（必须写入评审记录）：**

```
2048 档、分类页 hero、path lane 失败回落 pixel lane
  → playlistCoverImageFromPixels (playlistCoverPixels.ts:10-45)
  → BMP 对象 URL = 54 + 2048×2048×3 = 12,583,026 B ≈ 12.00 MiB
  → 该 URL 被 hero 租约保护（useAllSongsCoverLease）
  → trimCache 跳过（desired 命中 + leases 命中，:367 两条件都成立）
  → 无字节预算 ⇒ 不会被任何机制按字节淘汰
  → 叠加过渡期第二个脱手 hero ⇒ 上界 2 × 12.00 = 24.00 MiB
```

1536 档对应 `54 + 1536×1536×3 = 7,077,942 B ≈ 6.75 MiB`，两场景合计 **13.5 MiB**。

⇒ **(a)+(c) 把它限制在 1 张（过渡期 2 张）**；1536 档下上界 13.5 MiB，相对 8 GiB 无关紧要，相对"无上界"也已可解析。**这就是 D2 建议先只批 1536 的量化理由：2048 把该上界从 13.5 MiB 抬到 24 MiB，而收益只是 1.43× → 1.07×。**

### §7.5 分类页 hero 的内存账本汇总（结论表）

| 项 | 1536 档 | 2048 档 |
| --- | --- | --- |
| path lane JS 驻留（成功路径） | ~100 B + 元数据 | 同 |
| pixel lane 回落单张 BMP | 6.75 MiB | 12.00 MiB |
| 并发高 edge 条目数（(a)+(c)） | 1（过渡期 2） | 1（过渡期 2） |
| 最坏 JS 堆增量 | 6.75–13.5 MiB | 12.0–24.0 MiB |
| 是否需要给 store 加字节预算 | **否** | **否**（但需 Release 实测确认） |
| WebView 侧解码位图（未计入，见 §11） | 9.00 MiB/张 | 16.00 MiB/张 |

### §7.6 `THUMBNAIL_PATH_MAX_BYTES` 新公式

**实测前提（`jpeg_size_probe.py`，q82 / 4:4:4）：**

| 内容类别 | 512 | 1024 | 1536 | 2048 | 越 1 MiB |
| --- | --- | --- | --- | --- | --- |
| 平滑渐变 | 17 K | 45 K | 86 K | 147 K | 否 |
| 模糊照片 | 17 K | 45 K | 87 K | 147 K | 否 |
| 密集文字/图形 | 33 K | 100 K | 180 K | 271 K | 否 |
| **真实封面模拟** | — | **108 K** | **190 K** | **297 K** | 否 |
| 棋盘格（病态高频） | 117 K | 56 K | 406 K | 168 K | 否（非单调） |
| 逐像素噪声（理论上界） | 375 K | **1499 K ✗** | **3372 K ✗** | **5995 K ✗** | **是** |

⇒ **真实封面在 2048 档仅 297 KB，余量 3.5×。初稿"1 MiB 会被击穿"的推断在真实内容上不成立。**

**但仍建议改为派生（防御性），公式：**

```
THUMBNAIL_PATH_MAX_BYTES(max_edge) = max(1 MiB, max_edge × max_edge / 2)
```

| 档位 | 派生值 | 对实测噪声值 | 是否拦住 |
| --- | --- | --- | --- |
| 512 | 1 MiB（max 生效） | 375 K | 不需拦 |
| 1024 | 1 MiB（max 生效，1 MiB vs 0.5 MiB） | 1499 K | **拦（符合预期）** |
| 1536 | 1.125 MiB | 3372 K | **拦** |
| 2048 | 2 MiB | 5995 K | **拦** |
| 3072 | 4.5 MiB | — | — |

**为什么不是"无上限"（必须能继续拒绝损坏/被替换的文件）：**

1. **它是派生值，不是常量 `u64::MAX`。** 上界仍是 `max_edge²/2`，即"每像素 0.5 字节"。q82 4:4:4 的实际熵上限远低于此（噪声实测 2048 为 5995 K ÷ 4194304 px = **1.43 B/px**，已在 0.5 B/px 的 2.9 倍之外 ⇒ 噪声仍被拒）；真实封面为 297 K ÷ 4194304 = **0.07 B/px**，有 7 倍余量。
2. **原有的三条结构校验全部保留**（`:2551-2557`）：`SOI` 前两字节、`EOI` 末两字节、`ImageReader` 能解出真实宽高；且 `:2568` 的尺寸 ceiling 由白名单派生、`w>0 && h>0 && max(w,h) <= ceiling` 仍然成立。**字节上限只是四道闸中的一道**，放宽它不等于放弃"拒绝被替换文件"——替换者仍要伪造出结构合法、尺寸不超白名单最大档、且字节数落在派生上限内的 JPEG。
3. **文件大小与"是否为本通道产出"没有一一对应关系。** 1 MiB 这个值的原始用途（`:114-118` 注释）是"reject a corrupt or substituted file, not to constrain encoder output"，而实测表明它对 1024+ 档会**误伤合法产出**（噪声类）。派生化正是让这道闸重新回到"拒绝异常"而非"约束编码器"的原始意图。

**建议同时保留一个绝对硬上限**（例如 `16 MiB`，与 `MAX_INPUT_BYTES = 16 MiB`（`:24`）对齐），防止未来档位继续上升时派生值无限膨胀：

```
THUMBNAIL_PATH_MAX_BYTES(max_edge) = min(16 MiB, max(1 MiB, max_edge × max_edge / 2))
```

**跨端同步（P-3 的第二半）：** `audioCommands.ts:580` 必须同步为同一函数；`:606` 的校验改为调用它。**这是"忘记同步一处 = 整条通道失效"的第二个实例**（`OPT-0018-v2-result.md:469` 已就 `THUMBNAIL_PATH_MAX_EDGE` 记过一次），故 §8.1 的跨端一致性用例必须同时覆盖这两个常量。

> **证据强度声明：** 上表来自 **Pillow**（`quality=82, subsampling=0`），与 `image` 0.25.10 编码器的参数对齐（`cover_pixels.rs:120` 的 q82；4:4:4 已由用户核实 `image-0.25.10/src/codecs/jpeg/encoder.rs:402-425`），但**两个编码器的量化表实现可能有差异**。这是"高置信但非端到端实证"，见 §11-U3。

### §7.7 磁盘影响

| 项 | 现状 | 新增 1536（+2048）后 |
| --- | --- | --- |
| 每档每源一个文件 | `{hash}-{edge}-t2-{d\|j}{ver}.{spxr\|jpg}`（`:2221-2226`、`:2235-2240`） | 档位数 ×2（×3） |
| 真实封面单文件 1536 | — | **190 K**（实测）；2048 为 297 K |
| `THUMBNAIL_CACHE_FILES` = 32768（`:92`） | 覆盖 256/512 两档的整库 | **每个被提档的 hero 源额外产生 1（2）个文件**。hero 是"当前详情页首曲/当前集合"⇒ **并发新增文件数的量级是"用户访问过的详情页数量"，不是"库规模"** |
| `THUMBNAIL_CACHE_BYTES` = 8 GiB（`:91`） | 单张上限由 256 KiB（裸 RGBA `.spxr`）主导 | 新增的是 **KB 级 JPEG**；`.spxr` 1536 档仍可能由 pixel 回落生成（`decode_playlist_and_pack`），单张 9 MiB |
| 是否有界 | 是（字节 + 文件数双上限 + mtime 淘汰） | **仍是有界**：两个新档位自动进入 `MANAGED_THUMBNAIL_EXTENSIONS`（`:133`）与 `scan_thumbnail_usage`/`make_thumbnail_room_with_limits_checked` 的管理范围 |

⇒ **磁盘无风险，无需调整任何常量。** 唯一需注意：pixel 回落会为 hero 生成 1536 档 `.spxr`（9 MiB/张），这与既有 512 档 `.spxr`（1 MiB）行为同构，只是单张更大；8 GiB 预算下可容纳约 900 张这样的文件，而回落本身是罕见路径（path lane 熔断时才发生）。

### §7.8 预算核算总结论

| 问题 | 结论 |
| --- | --- |
| `INFLIGHT_BUDGET` 怎么改 | **不改**（保持 4 MiB）。本 hook 自有作业已由 `activeBytes` 逐作业计费；共享调度器的其他消费者在 1536+ 只走 path lane 且回落降 256（§4.3） |
| `RESIDENT_BUDGET` 要不要提高 | **要，48 → 64 MiB**。否则 1536 档下 warm 从 42.25 降到 28.25 MiB，预取从 96 张降到 64 张（−33%），直接抵消 OPT-0018 收益 |
| `playlistArtworkBytes` 公式对不对 | **对**（作为 pixel lane 最坏上界）；对 path lane 高估约 7 倍，但改它会触碰 OPT-0018 账本，**本方案不改，只加注释** |
| 分类页 store 要不要补字节预算 | **不要**。用 (a) 单例 key + (c) 离场降档把高 edge 条目锁在 1（过渡期 2），最坏 1536 档 13.5 MiB / 2048 档 24 MiB |
| `THUMBNAIL_PATH_MAX_BYTES` | 改派生 `min(16 MiB, max(1 MiB, edge²/2))`；不是无上限；同时同步前端镜像常量 |
| 磁盘 | 无需改任何常量；新档位自动进入既有双上限淘汰 |

---

## §8 测试与验证计划

### §8.1 Rust

| # | 用例 | 位置/新增 |
| --- | --- | --- |
| RS1 | `validate_playlist_max_edge(1536).is_ok()` | 新增，紧邻 `:5613-5621` |
| RS2 | `validate_playlist_max_edge(768).is_err()` 仍成立 | **复用既有 `:5619`，应继续通过** |
| RS3 | 白名单全等断言更新 | **失效，必须改**：`:5955` `assert_eq!(ALLOWED_PLAYLIST_MAX_EDGES, [128, 256, 512])` |
| RS4 | "path lane 拒绝 player-only edge" 循环断言更新 | **失效，必须改**：`:5956-5961` 对 `[1024, 1536, 2048, 3072]` 断言 `validate_playlist_max_edge(edge).is_err()`。扩档后 1536/2048 变为合法 ⇒ 循环需改为 `[768, 3072]`（768 是保留给播放器且不得路由到列表的档） |
| RS5 | `validate_playlist_max_edge(1024).is_err()` | **失效，必须改**：`:5620`。1024 是否纳入白名单由 D2 决定；若只批 1536，则 1024 仍应 `is_err()`，**保持通过** |
| RS6 | `max_edge_is_discrete_and_bounded` | `:5342-5345`：128/256/512 ok + 768 err ⇒ **继续通过（不需改）** |
| RS7 | `parse_playlist_jpeg` ceiling 自动放宽 | 新增：构造 1536² JPEG，断言 `parse_playlist_jpeg` 返回 `Some((1536,1536))`。参照 `:5843-5845` 的 `patterned_png(600,8)` + `decode_playlist_image(...,1024)` 写法 |
| RS8 | `THUMBNAIL_PATH_MAX_BYTES` 派生 | 新增：`(512)=1 MiB`、`(1024)=1 MiB`、`(1536)=1.125 MiB`、`(2048)=2 MiB`、`(>8192)=16 MiB`（硬顶） |
| RS9 | 超限仍被拒 | **复用 `:5804-5848`** `hit_validation_rejects_and_removes_oversized_or_marked_corrupt_jpegs`，但 `:5809-5817` 的 `oversized` 构造依赖 `THUMBNAIL_PATH_MAX_BYTES` 常量，改为函数后需传 edge |
| RS10 | 端到端字节实测（建议） | 构造 2048² 棋盘 PNG 走 `prepare_thumbnail_path`，记录返回的 `byteLength`，与 §7.6 的 Pillow 值对照。**注意会写缓存文件**，须用 `TestDirectory`（`:5640`）隔离 |
| RS11 | player lane 不回归 | **复用 `:5623-5629`** `player_lane_still_accepts_512_as_pixels`，应继续通过 |

### §8.2 前端单元

| # | 用例 | 状态 |
| --- | --- | --- |
| FE1 | `selectHeroEdge` 在 §0.1 六个场景的取值 | 新增 |
| FE2 | 1024 / 1025 断点不产生档位倒挂（§6.3） | 新增 |
| FE3 | `sharedProjection` 期间选档冻结、结束后补一次升级（§6.5） | 新增 |
| FE4 | **hero 必须用 512** | **失效，必须改**：`libraryArtworkRecovery.test.mjs:545` `assert.equal(coverPathRequests[0].input.maxEdge, 512)`、`:557-558`（`coverPixelRequests[0].input.maxEdge === 512`）。改法：改为与 `selectHeroEdge()` 或固定注入的测试档位比较，并保留"恢复必须使用失败档"的语义断言（这正是修 L4 后要加强的点） |
| FE5 | `failedEdge` 契约（L4） | 新增：在 1536 档失败后，`recoveryEdge` 必须是 1536（旧实现会给出 512） |
| FE6 | 分类页 256 断言**不应**失效 | **应继续通过（B2 优势证据）**：`useAllSongsWindow.test.mjs:163` `h.pixelCalls.every(({input}) => input.maxEdge === 256)`、`:435` `assert.equal(call.maxEdge, 256)`、`allSongsCoverCache.browser.test.mjs:145` `window.events.pixels.every(input=>input.maxEdge===256)` |
| FE7 | 跨端常量一致性 | 新增：断言 `audioCommands.ts` 的 `THUMBNAIL_PATH_MAX_EDGE` 与 `THUMBNAIL_PATH_MAX_BYTES` 镜像与 Rust 侧同源（可由共享 JSON/常量文件生成，或由测试读 Rust 源文本比对） |
| FE8 | 高档回落必须降 256（§4.3） | 新增：hero 在 1536 且 path lane 失败时，回落调用必须是 `maxEdge: 256`，且**不得**产生 `InvalidMaxEdge` |

### §8.3 浏览器交互

| # | 用例 | 状态 |
| --- | --- | --- |
| BR1 | `playlistContentWindowLoading.browser.test.mjs:78` `heroCalls.some(call => call.input.maxEdge === 512)` | **失效，必须改**。注意该文件 `:33` 视口为 `1600×1000 @ deviceScaleFactor 2` ⇒ 物理需求 1550×2=3100 ⇒ 按 §6 会选到 2048（若批准）或 1536+。**改法是断言"等于 `selectHeroEdge()` 在该视口的返回值"，不要写死新字面量**，否则下次调档又失效 |
| BR2 | `playlistCoverPreload.browser.test.mjs:313-315` 按 `4*512*512*4` 复算 inflight 预算 | **本方案不改 `INFLIGHT_BUDGET`（P2）⇒ 应继续通过。** 若日后采纳"随 hero 放大"，该断言必失效——这是 P2 决策的直接可验证后果 |
| BR3 | `playlistCoverPreload.browser.test.mjs:233` 传 `coverCssPixels:512, dpr:2` | **需核对**：该 fixture 直接注入 demand，若测试断言基于此值推导档位则需同步；`:244` 的"mismatched 512px hero identity"场景需确认新档位下语义不变 |
| BR4 | 分类页 hero 高清 + 卡片 256 同时存在（B2 核心验收） | 新增：进入专辑详情，断言 hero `<img>` 的自然宽 ≥1536 而列表卡片请求仍为 256 |
| BR5 | hero 离场降档（§7.4 (c)） | 新增：滚动使 hero 完全离屏（`heroOffscreen`），断言 hero 项 edge 降为 256 且仅发生一次重取，不抖动 |
| BR6 | 共享元素过渡期不抖动（§6.5） | 新增：从卡片点进详情，记录过渡期间发出的全部档位请求，断言**档位单调不降**且最终值 = 稳定后测量值 |

### §8.4 真实 WebView（Release）

| # | 项 | 说明 |
| --- | --- | --- |
| WV1 | §0.1 六场景实机清晰度对照 | 截图比对（至少 2560@1x 与 2880@200% 两个最能暴露差异的配置） |
| WV2 | 内存高水位 | Renderer/GPU 进程 RSS：对比 512/1536/2048 三档，确认 §7.5 的"WebView 位图未计入"没有变成常数级劣化 |
| WV3 | 首屏 hero 到位时间 | 1536 解码相对 512 的增量（§11-U2） |
| WV4 | DPR 实际上报 | WebView2 下 `devicePixelRatio` 在 200% 缩放下是否真为 2（§11-U1） |
| WV5 | path lane 熔断不触发 | 连续浏览 ≥10 个详情页，断言 `pathLaneStats().directFailures` 不增长到 8（P-3 回归） |
| WV6 | 磁盘增长 | 浏览 20 个详情页后 `audio/thumbnails` 的文件数与字节增量 |

---

## §9 需同步的既有文档

| # | 文档与位置 | 现状 | 应改为 |
| --- | --- | --- | --- |
| D-1 | `docs/architecture/playlist-artwork-loading.md:97` | **明文契约**："`maxEdge` 仍只取 128/256/512" | 改为"列表通道 `maxEdge` 取 `ALLOWED_PLAYLIST_MAX_EDGES`（现含 1536；hero 专用高档位）；列表卡仍只取 128/256/512"。这是本方案唯一**直接冲突**的活跃契约，必须与代码同批改 |
| D-2 | `docs/architecture/playlist-artwork-loading.md:67` | "根据封面 CSS 尺寸和 DPR 选择 128/256/512px" | 补充 hero 分支 |
| D-3 | `docs/architecture/playlist-artwork-loading.md:68` | "Rust 仅允许列表档位 128/256/512px" | 同上 |
| D-4 | `docs/decisions/2026-11-07-album-cover-asset-pipeline.md:61-74` | 表格与结论"新增路径命令独占 128/256/512" | 扩档后需重述：**分层规则仍由命令族决定（不变），但路径族的档位集扩大**。`:68-71` 关于"数值交叠但语义不同"的论证依然有效，应保留并注明 1536/2048 现在同时出现在两个集合里 |
| D-5 | `docs/decisions/2026-11-07-album-cover-asset-pipeline.md:321` | 明确写 `INFLIGHT_BUDGET` 与 `RESIDENT_BUDGET` 本次均不改 | 需更新为：`INFLIGHT` 仍不改（P2），`RESIDENT` 48→64 MiB（P3）。`:321` 里"7 B/px 对 JPEG 通道是高估"的结论**保留**（§7.3） |
| D-6 | `docs/decisions/2026-11-07-album-cover-asset-pipeline.md:518` | "`audio_load_track_thumbnail_path` 接受 128/256/512，拒绝 768/1024" | 扩档后语义变化，需改 |
| D-7 | `docs/changes/optimizations/OPT-0018.md:159` | "`ALLOWED_PLAYLIST_MAX_EDGES = [128, 256, 512]`（列表用）" | 更新数值并注明 hero 例外 |
| D-8 | `docs/changes/optimizations/OPT-0018.md:74` | "列表 maxEdge 固定 256" | 补"hero 例外" |
| D-9 | `docs/architecture/sp-022-backend-cover-concurrency-safety.md:76` | "max_edge 128、256 或 512，档位间不合并" | 更新档位集；"档位间不合并"的前提（缓存键含 edge）不变 |
| D-10 | `docs/architecture/sp-022-backend-cover-concurrency-safety.md:119` | "列表 512 最大输出档" | 改为新最大档 |
| D-11 | `docs/architecture/sp-022-backend-cover-concurrency-safety.md:128` | "SPXR 列表响应每份 ≤40+512×512×4" | 改为新档位的字节上界（1536² ×4 ≈ 9 MiB） |
| D-12 | `docs/implementation/playlist-cover-scheduler-concurrency.md:78` | "只放大暂存在飞像素缓冲（上界 4 × 512 × 512 × 4 B = 4 MiB）" | 保持数值（P2 不改），但补一句"hero 高档走 path lane，其 pixel 回落由 `activeBytes` 逐作业计费" |
| D-13 | `docs/implementation/playlist-cover-scheduler-concurrency.md:85` | 记录了 `INFLIGHT_BUDGET` 从 `2*512*512*4` 改为 `MAX_CONCURRENT*512*512*4` 的历史 | 追加一行说明本次**明确不改**及其理由（防止后人再次误放宽） |
| D-14 | `docs/architecture/cover-sharpness-comparison.md`（全文） | `status: draft`，2026-11-06 调查记录，行号已大面积漂移，且 §4.1 建议的 `selectHeroEdge()` 未实施 | **改为"已被本文取代"**：`status` 改为 `superseded`（或在正文顶部加替代说明），`updated` 改为 `2026-11-10`，`source_documents` 追加本文路径。**不要删除**——它保留了"结论演进"记录（尤其是 §2.1 关于"曾误判 Poweramp 无全宽头图"的更正说明） |
| D-15 | `docs/test/2026-10-23-all-songs-cover-size-observation.md:26` | 记录当时 `useAllSongsWindow.ts` 的 `maxEdge: 128`（历史观测） | 无需改（历史记录）；若在 D-14 的替代说明中被引用，注明"其后已变为 256，本方案将 hero 提到 1536" |

---

## §10 实施顺序与责任分工

> 依据 `AGENTS.md`：Rust/Tauri Agent 独占 `src-tauri/src/**`；Frontend Agent 独占 `src/**`；Test Agent 独占 `docs/test/**` 与 `src/**/*.test.*`。Architecture Agent 只读。**每个文件同一阶段只有一个写 owner。**

### §10.1 阶段划分（可分批评审/合并）

| 阶段 | 内容 | Owner | 写范围 | 前置 | 验证命令 |
| --- | --- | --- | --- | --- | --- |
| **S0** | 决策 D1–D3 拍板（§12） | PM Agent + 用户 | 无 | — | — |
| **S1** | Rust 白名单 + 校验文案 + 派生字节上限 + Rust 单测 | **Rust/Tauri Agent** | `src-tauri/src/audio/cover_pixels.rs`、`src-tauri/src/audio/folder_cover.rs`（仅注释，R4） | S0 | `cargo check --lib --locked`；`cargo test --lib --locked audio::cover_pixels` |
| **S2** | 跨端常量与 TS 联合类型（T1–T7）+ 选档模块（S1–S3） | **Frontend Agent** | `src/features/player/services/audioCommands.ts`、`src/features/player/services/heroCoverEdge.ts`、`src/features/player/hooks/useLibraryArtwork.ts`（仅类型段） | S1（需 Rust 白名单已定稿，否则类型可能与后端不一致） | `npx tsc --noEmit`；`npm run lint` |
| **S3** | `useLibraryArtwork` 档位与 L4 契约修复 | **Frontend Agent** | `src/features/player/hooks/useLibraryArtwork.ts` | S2 | `node --test src/features/player/hooks/libraryArtworkRecovery.test.mjs`（需先由 Test Agent 在 S5 改断言）→ 见 §10.2 顺序说明 |
| **S4** | `useAudioPlayer` 档位 + 预算（P1–P5） | **Frontend Agent** | `src/features/player/hooks/useAudioPlayer.ts` | S2 | `node src/features/player/components/playlistCoverPreload.browser.test.mjs` |
| **S5** | 分类页三条链路（W1–W6、C1–C13） | **Frontend Agent** | `src/features/player/hooks/useAllSongsWindow.ts`、`AlbumLibraryPanel.tsx`、`FolderHierarchyPanel.tsx` | S2 | `node --test src/features/player/hooks/useAllSongsWindow.test.mjs`；`node src/features/player/components/allSongsCoverCache.browser.test.mjs` |
| **S6** | 既有断言更新 + 新增用例（§8.1–8.3） | **Test Agent** | `src-tauri/src/audio/cover_pixels.rs` 的 `mod tests`、`src/**/*.test.*`、`docs/test/**` | S1/S3/S4/S5 各自完成后**逐项**介入，不得在前面阶段改生产文件 | 见各条 |
| **S7** | 文档同步（§9 全部） | **Documentation Agent** | `docs/architecture/**`（除本文）、`docs/decisions/**`、`docs/changes/**`、`docs/implementation/**`、`docs/architecture/cover-sharpness-comparison.md` | S1–S6 | `npm run docs:test`；人工核对 frontmatter |
| **S8** | 独立验证 + 真实 WebView（§8.4） | **Test Agent**（独立） | `docs/test/2026-11-10-hero-cover-sharpness-verification.md` | S1–S7 | 见 §8.4 |
| **S9** | 最终仓库级检查 | **Lead** | 无（只读） | 全部 | 见 §10.3 |

### §10.2 顺序上的两个硬约束

1. **S6 的断言更新必须在 S1/S3/S4/S5 之后合并，但要在它们之前"预告"。** 因为 `cover_pixels.rs:5954-5955`、`libraryArtworkRecovery.test.mjs:545` 等断言会在 S1/S3 一落地就变红。建议：**S1 与 S6-RS 同一提交**（Rust 白名单 + 其单测属同一 owner 同一文件），**S3 与 S6-FE4 同一提交**（都是 `useLibraryArtwork` 相关，但 FE4 在 `.test.mjs`，owner 不同 ⇒ 需 Test Agent 与 Frontend Agent **串行**在同一分支上连续提交，由 Lead 协调顺序）。
2. **S2 的 T5（`THUMBNAIL_PATH_MAX_EDGE`）必须与 S1 的 R1 同批上线。** 中间态（Rust 已放宽、前端仍 512）会让 path lane 在 hero 首次请求时立刻计 8 次真实失败并熔断，且熔断状态是**会话级**的（`playlistCoverPathLane.ts:65-66` `disabled` 模块级变量）⇒ 用户在该会话内所有封面退化到无磁盘缓存的像素通道。**这是本方案唯一能造成"比现状更差"的中间态，禁止分两次发布。**

### §10.3 验证命令（以仓库实际为准）

| 层 | 命令 | 依据 |
| --- | --- | --- |
| Rust 编译 | `cargo check --lib --locked`（在 `src-tauri/`） | `docs/changes/optimizations/OPT-0018-develop-integration.md:45` |
| Rust 单测 | `cargo test --lib --locked` | 同上 |
| Rust 聚焦 | `cargo test --lib --locked audio::cover_pixels` | 参照 `docs/test/cover-cache-test-isolation.md:49-50` 的 `--test-threads` 用法 |
| TS 类型 | `npx tsc --noEmit` | `package.json:8` 的 `build` 用 `tsc -b`；单独检查用 `--noEmit` |
| Lint | `npm run lint` | `package.json:13`（`eslint .`） |
| 构建 | `npm run build` | `package.json:8` |
| 前端单测 | `node --test <文件>` | `docs/test/2026-10-28-album-library.md:48` |
| 浏览器测试 | `$env:SPMUSIC_PLAYWRIGHT='<path>'; node <脚本>` | `docs/test/artist-library.md:54`、`docs/test/queue-library-verification.md:36` |
| 文档 | `npm run docs:test` | `package.json:12` |

---

## §11 残余不确定性

| # | 项 | 为什么无法静态确认 | 影响 | 建议的取证方式 |
| --- | --- | --- | --- | --- |
| **U1** | WebView2 下 `devicePixelRatio` 的实际上报 | Windows 系统缩放 200% 时，`window.devicePixelRatio` 是否真为 2.0、是否随窗口跨屏拖动而动态变化，取决于 WebView2 运行时与宿主 DPI 感知设置，仓库内无实证 | 若实际上报为 1，`selectHeroEdge` 会系统性低估一档（§0.1 的 2880@200% 场景会选 1536 而非 2048） | Release 下打印 `devicePixelRatio` + `matchMedia('(resolution: 2dppx)')` 结果；三种缩放各测一次（WV4） |
| **U2** | 2048/1536 解码耗时增量 | Rust 侧 `decode_playlist_image` 的 Lanczos3 缩小成本随目标像素数增长；未做基准（`sp-022-backend-cover-concurrency-safety.md:127` 只给了中间图内存公式，无时间数据） | 若 1536 解码显著慢于 512，首屏 hero 到位时间增加，可能被用户感知为"更慢但更清楚" | Release 代理基准，参照 `docs/test/sp-022-thumbnail-optimization-comparison.md:72` 的 `freeze_corpus` 式做法；或 `THUMBNAIL_BENCH_*` 计数器（`cover_pixels.rs:138-140` 附近） |
| **U3** | JPEG 字节数来自 Pillow 而非 `image` crate | `image` 0.25.10 的量化表可能与 Pillow 的 `quality=82` 实现略有差异；参数对齐（q82、4:4:4）但非端到端 | §7.6 的"真实封面 297 KB / 余量 3.5×"结论**高置信但非实证**；噪点类越界判定同理 | 构造 2048² 棋盘 PNG 走 `prepare_thumbnail_path`，读返回 `byteLength`（RS10）。**会写缓存文件，须用 `TestDirectory` 隔离** |
| **U4** | WebView 解码后位图是否常驻内存 | `<img>` 解码位图的生命周期由 WebView2 管理；既有多处注释明确"归 WebView，卸载 `<img>` 时释放"（`useAllSongsWindow.ts:674-677`、`:168-171`），但**没有任何测量**，且 Chromium 的 image cache 可能保留解码结果 | §7.5 的"WebView 位图未计入"若实际常驻，1536 档单张 +9 MiB、2048 档 +16 MiB，且可能有多张（滚动经过的详情页） | Release 观察 Renderer/GPU RSS：连续浏览 10 个详情页，看是否单调上升（WV2） |
| **U5** | 共享元素过渡期测量稳定性 | §6.5 的设计依赖"FLIP 用 transform 而非 width 实现"。本次只核实了 `CollectionHero.tsx:28-30` 用 `motion.div` + `layoutId`，未核实 motion 的 FLIP 具体实现路径 | 若 motion 通过 `width` 过渡，`clientWidth` 会在过渡期间变化，第 1 层防护失效 | 在过渡期间 `console.log` 连续采样 `clientWidth`；或直接依赖第 2、3 层防护（冻结 + 稳定后补升级），并加 BR6 断言 |
| **U6** | 分类页 hero 两场景并存的最大数量 | §7.4 (a) 的"高 edge 条目 ≤1（过渡期 ≤2）"依赖"同一时刻只有一个 `AlbumScene` 持有高 edge hero"。`PlayerSurface.tsx:3236-3238` 按 `categoryId` 分别渲染不同 key 的 `AlbumLibraryPanel`，但**过渡期（`sharedProjection`）新旧场景同时挂载**的具体数量未实测 | 若实际存在 3 个以上，§7.4 的 24 MiB 上界失效 | 加临时计数器（hero key 且 edge > 512 的 desired 数量）打点，在 ARTIST→ALBUM→FOLDER 快速切换时观察（BR5 的扩展） |
| **U7** | 3072 档的必要性 | 本次配置清单最大为 2560×1440@1x（需 2190）；3072 仅在 ≥3200px 物理宽（4K@1x）有意义 | 不批 3072 无风险；但若未来加 4K 支持需重新提案 | 无需现在取证；在 §0.1 表格末尾保留"4K@1x 需 3072"的注记 |
| **U8** | 噪点/扫描件封面会越界 | §7.6 实测：逐像素噪声 2048 档 5995 K，超 1 MiB 与派生后 2048 档的 2 MiB | 用户若导入噪声类"封面"（例如某些频谱图、扫描件），path lane 会 `WorkerFailed` → 计真实失败 → 8 次后熔断 | 若采纳派生公式，1536 档上界 1.125 MiB 仍拦不住 3372 K 的噪声 ⇒ **需在 §7.6 的派生值之外，确认是否愿意为这类内容再放宽到 `edge²×1.5`**。这是 D3 的一部分 |

**明确不构成不确定性的（已实证）：**

| 项 | 结论 |
| --- | --- |
| 缓存键是否需迁移 | **否**（`cover_pixels.rs:2221-2226`、`:2235-2240` 含 edge） |
| 是否需 bump 版本常量 | **否**（`:103`、`:104`、`:112` 全部不变） |
| 8 GiB / 32768 是否需调整 | **否**（§7.7） |
| `MAX_DECODE_BYTES` 是否够 | **够**（2048² RGBA 16.8 MiB ≪ 256 MiB） |
| 既有 256 断言是否会失效（走 B2） | **不会**（FE6） |

---

## §12 决策点（实施前必须拍板）

### D1 — `PLAYLIST_ARTWORK_RESIDENT_BUDGET`：48 MiB 还是 64 MiB？

| 选项 | 后果 |
| --- | --- |
| **保持 48 MiB** | 1536 档下 warm 预算 28.25 MiB ⇒ 预取约 64 张（现状 96 张，−33%）。可见卡片（`requiredIds`）永不被拒，只影响滚动预热 |
| **提到 64 MiB（推荐）** | warm 44.25 MiB ⇒ 约 100 张，**净预取能力略优于现状**；代价是应用侧受管预算上界 +16 MiB |

**推荐 64 MiB。** 需要 PM 确认的是"用 16 MiB 上界换不损失 OPT-0018 的滚动收益"是否可接受。

### D2 — hero 上限：1536 还是 2048？

| 选项 | 最大残余放大 | 分类页最坏 JS 堆增量 | 备注 |
| --- | --- | --- | --- |
| **只开 1536（推荐先行）** | **1.43×**（2560@1x） | 6.75–13.5 MiB | 六场景中 5 个达到"缩小或 ≤1.2×"，仅 2560@1x 为 1.43× |
| **同时开 2048** | **1.07×** | 12.0–24.0 MiB | 需 WV2 实测确认 WebView 位图不常驻；`RESIDENT` 无需再提高（§7.2） |
| 开 3072 | ≤1×（4K@1x 也够） | 27–54 MiB | **不建议**，超出当前配置清单（U7） |

**推荐：第一批只批 1536，把 2048 加入白名单但不作为默认桶**（`HERO_EDGE_BUCKETS = [1024, 1536]`，2048 留作 Release 实测后再启用）。需要 PM 确认"接受 2560@1x 下 1.43× 残余放大"。

### D3 — `THUMBNAIL_PATH_MAX_BYTES` 是否改派生？

| 选项 | 后果 |
| --- | --- |
| **保持 1 MiB** | 真实封面 0–3.5× 余量；噪点/扫描件封面在 ≥1024 档会被判 `WorkerFailed` → 熔断链（U8） |
| **改派生 `min(16 MiB, max(1 MiB, edge²/2))`（推荐）** | 保留"拒绝损坏/被替换文件"的四道闸；1024 档仍拦 1499 K 噪声；1536/2048 档可容纳真实内容与多数扫描件。代价：需同步前端镜像常量（D-3 的第二实例） |
| **改派生且放宽到 `edge²×1.5`** | 连 1536 档的噪声（3372 K）也容纳；但"拒绝异常"能力进一步减弱 |

**推荐第二项。** 需要 PM 确认"是否接受为此多改一个跨端常量"。

---

## §13 证据索引

### §13.1 SpMusic（本仓库）

| 结论 | 位置 |
| --- | --- |
| 两套 edge 白名单 | `src-tauri/src/audio/cover_pixels.rs:37-38` |
| 播放列表校验与硬编码文案 | `cover_pixels.rs:2940-2949`（文案 `:2946`） |
| `parse_playlist_jpeg` ceiling 派生 | `cover_pixels.rs:2564-2568` |
| track 像素通道 128/256 硬限制 | `cover_pixels.rs:1092-1097` |
| track path 通道用播放列表白名单 | `cover_pixels.rs:1224` |
| folder 像素通道 128/256 硬限制 | `src-tauri/src/audio/folder_cover.rs:550-555` |
| folder path 通道用播放列表白名单 | `folder_cover.rs:822-825` |
| `.spxr` / `.jpg` 文件名含 edge | `cover_pixels.rs:2221-2226`、`:2235-2240` |
| 版本常量 | `cover_pixels.rs:103`、`:104`、`:112` |
| 预算常量 | `cover_pixels.rs:27`、`:28`、`:59`、`:91`、`:92`、`:101`、`:119`、`:120`、`:126` |
| hero 512 目标（3 处） | `src/features/player/hooks/useLibraryArtwork.ts:727`、`:741`、`:761` |
| 两级准入（保留） | `useLibraryArtwork.ts:459-487` |
| `failedEdge` 契约违背 | `useLibraryArtwork.ts:627`（契约注释 `:70-73`） |
| `MAX_RESIDENT` = 80 | `useLibraryArtwork.ts:92` |
| 分类页 9 处 `maxEdge: 256` | `src/features/player/hooks/useAllSongsWindow.ts:522`、`:533`、`:534`、`:717`、`:741`、`:764`、`:768`、`:784`、`:785` |
| `desired` 为 `Set<string>` | `useAllSongsWindow.ts:339`、`:1068` |
| `CACHE_LIMIT` = 60，无字节预算 | `useAllSongsWindow.ts:147`、`:360-371` |
| 租约实现 | `useAllSongsWindow.ts:190-199`、`:1159-1164` |
| `coverIdentity` 不含 edge | `useAllSongsWindow.ts:69-74` |
| 高 edge 的 pixel 回落限制 | `useAllSongsWindow.ts:716-770`、`:783-785` |
| hero 档位与 48/4 MiB 预算 | `src/features/player/hooks/useAudioPlayer.ts:223`、`:230`、`:232-238` |
| `targetEdgeFor` 返回 512 | `useAudioPlayer.ts:2610-2618` |
| 在飞作业按 maxEdge 逐作业计费 | `useAudioPlayer.ts:2636-2637` |
| warm 预算公式 | `useAudioPlayer.ts:2658-2673` |
| `MAX_CONCURRENT` = 4 | `src/features/player/services/playlistCoverScheduler.ts:83` |
| 熔断阈值 8 与模块级 `disabled` | `src/features/player/services/playlistCoverPathLane.ts:53`、`:65-66` |
| 真实失败计入熔断 | `playlistCoverPathLane.ts:318-326` |
| 跨端 `THUMBNAIL_PATH_MAX_EDGE` = 512 | `src/features/player/services/audioCommands.ts:576`，校验 `:603-604`，报错 `:607` |
| 跨端 `THUMBNAIL_PATH_MAX_BYTES` 镜像 | `audioCommands.ts:580`，校验 `:606` |
| `maxEdge` 联合类型 | `audioCommands.ts:111`、`:118`、`:125`、`:133`、`:155`、`:163`、`:170` |
| hero 容器 `.playlist-hero-artwork` | `src/features/player/components/CollectionHero.tsx:29`；样式 `playlist-panel.css:54-64` |
| hero 几何与断点 | `playlist-panel.css:25`、`:43-45`、`:942-944`；`album-library.css:21`、`:55`、`:61`、`:68`、`:125`；`playlist-management.css:6`、`:59`；`index.css:190-192` |
| `artworkRef` 三处 | `PlaylistPanel.tsx:341`、`AlbumLibraryPanel.tsx:273`、`FolderHierarchyPanel.tsx:163` |
| `ResizeObserver` + DPR 监听写法 | `PlaylistPanel.tsx:752-763` |
| 播放器选档口径（不可复用测量目标） | `src/features/player/hooks/useArtworkVisualResource.ts:552-561`，桶 `:519-520` |
| `collectionCover` / hero key | `AlbumLibraryPanel.tsx:78-82`、`:253`、`:286`、`:333-343`、`:453-456`、`:471-475` |
| 离场租约用的是卡片 key | `AlbumLibraryPanel.tsx:337-338`、`:491` |
| 文件夹 hero/卡片 key | `FolderHierarchyPanel.tsx:47-51`、`:209-220` |
| 两种 owner 二选一 | `src/features/player/components/PlayerShell.tsx:842` |
| BMP 对象 URL 账本 | `src/features/player/model/playlistCoverPixels.ts:15-17`、`:43-44` |
| 既有失效模式记录 | `docs/changes/optimizations/OPT-0018-v2-result.md:446`、`:469` |
| `INFLIGHT`/`RESIDENT` 本次不改的决策 | `docs/decisions/2026-11-07-album-cover-asset-pipeline.md:321` |
| 7 B/px 是高估的既有结论 | 同上 |

### §13.2 Poweramp（`.rea-analysis/`）

| 结论 | 位置 |
| --- | --- |
| 头图 = `@id/aa_image` | `decoded/res/values/styles.xml:11255` |
| `aa_image` 是列表项封面控件 | `decoded/res/layout-sw2dp/item_track.xml:37` |
| `aaMinSize` = 130.0sp | `styles.xml:11266` |
| `aaMarginBottom` → 200.0dp | `styles.xml:11265` → `decoded/res/values/dimens.xml:277` |
| `altAaLayoutRatio` = 1.85 / `maxAvailSizeForAltAaLayout` = 290.0dp | `styles.xml:11275`、`:11277` |
| 默认 `aaItemRatio` = 100.0% | `styles.xml:7438` |
| 固定档位 1536/512/256/128 | `smali/smali/com/maxmpz/widget/bitmaps/А.smali:192-243` |
| 两趟解码 `inJustDecodeBounds` / `inSampleSize` | `smali/smali/com/maxmpz/widget/bitmaps/К.smali:537`、`:547`、`:617`、`:649` |

复现命令：

```powershell
# 头图定义
Select-String -Path ".rea-analysis\decoded\res\values\styles.xml" -Pattern "headerStretchyImage|aaMinSize|altAaLayoutRatio"
# 解码策略
Select-String -Path ".rea-analysis\smali\smali\com\maxmpz\widget\bitmaps\К.smali" -Pattern "inJustDecodeBounds|inSampleSize"
# JPEG 体积实测
python .rea-analysis\tools\jpeg_size_probe.py
```

### §13.3 证据强度声明

| 类别 | 本文记号 | 包含内容 |
| --- | --- | --- |
| **静态实证** | 直接引 `path:line` | §1、§3 全部；§5 改动点的现状描述；§7.4 的 store 事实 |
| **计算推导** | 标注"计算推导" | §0.1 倍率表、§7.1 字节表、§7.2 预算表、§7.7 磁盘估算、§1.3 几何 |
| **推断** | 标注"推断/高置信但非实证" | §11-U1–U8；§7.6 的 Pillow 与 `image` 差异（U3）；§6.5 的 FLIP 实现假设（U5） |

**本文不含实现代码。§6.2 的代码块是示意，不是可直接合并的实现。**

---

**本文为方案（proposed）。截至本次提交，仓库内没有任何对应代码改动；实施前需完成 §12 的 D1–D3 决策。`docs/architecture/cover-sharpness-comparison.md` 自本文起应视为已被取代（见 §9 D-14）。**
