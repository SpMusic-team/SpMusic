---
doc_id: "DEC-2026-11-07-ALBUM-COVER-ASSET-PIPELINE"
title: "架构决策：专辑库列表封面改为 JPEG + asset 协议路径下发"
doc_type: "decision"
status: "accepted"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - "docs/changes/optimizations/OPT-0018.md"
  - "docs/architecture/playlist-artwork-loading.md"
  - "docs/architecture/sp-022-thumbnail-optimization-baseline.md"
  - "src-tauri/src/audio/cover_pixels.rs"
  - "src-tauri/src/audio/folder_cover.rs"
  - "src-tauri/src/lib.rs"
  - "src-tauri/src/app_paths.rs"
  - "src-tauri/src/library_cover_warmup.rs"
  - "src-tauri/tauri.conf.json"
  - "src-tauri/Cargo.toml"
  - "src/features/player/hooks/useAllSongsWindow.ts"
  - "src/features/player/hooks/useAudioPlayer.ts"
  - "src/features/player/hooks/useLibraryArtwork.ts"
  - "src/features/player/hooks/useArtworkVisualResource.ts"
  - "src/features/player/services/playlistCoverScheduler.ts"
  - "src/features/player/services/audioCommands.ts"
  - "src/features/player/model/playlistCoverPixels.ts"
  - "docs/decisions/2026-07-09-document-metadata-standard.md"
---

# 架构决策：专辑库列表封面改为 JPEG + asset 协议路径下发

## 状态

已接受。

本决策只定义契约与边界，不含实现。2026-11-07 的工作树经核查**尚无**任何路径通道代码：对 `src-tauri/`、`src/` 搜索 `audio_load_*_thumbnail_path`、`thumbnail_path`、`JpegEncoder` 均零命中。下文所有函数名、常量名、文件路径即为实现者应当新建的标识。

## 背景

列表封面慢的根因已由 [OPT-0018](../changes/optimizations/OPT-0018.md) 查明，本决策不重复调查，只固化结论：

1. 每张 256 KiB 未压缩 RGBA 经二进制 IPC 进入 JS（`audio_load_track_thumbnail` → `Response`），再由 `src/features/player/model/playlistCoverPixels.ts:10-45` 在主线程逐像素转成 24-bit BMP。
2. 磁盘缩略图是自定义 `.spxr`：44 B SPTC 头 + 40 B SPXR 头 + 裸 RGBA（`cover_pixels.rs:94-97`、`:1647-1652`），WebView 无法解码，因此不能直接把现有缩略图路径交给 `convertFileSrc`。
3. 参照实现只回传约 100 B 路径字符串，由 WebView 自己解码十几 KB 的 JPEG。

### 本轮补充核查（针对三条外部约束逐条复核）

| 编号 | 外部主张 | 本决策核查结果 | 证据 |
| --- | --- | --- | --- |
| C1 | 磁盘预算只统计 `.spxr`，新增 `.jpg` 会不计预算、无限增长 | **成立**。`scan_thumbnail_usage` 与 `make_thumbnail_room_with_limits_checked` 都用 `extension == "spxr"` 过滤 | `cover_pixels.rs:1962-1966`、`cover_pixels.rs:2057` |
| C2 | `sweep()` 只对 `retired` 集合调 `URL.revokeObjectURL`，对 asset URL 是无害 no-op，租约另有保护 | **成立**，且不需要任何改动 | `useAllSongsWindow.ts:60-71`（`leases.has(key)` 在第 63 行提前 `continue`）；`URL.revokeObjectURL` 对非 `blob:` URL 按规范直接返回 |
| C3 | 缩略图根目录 = `{cache_dir}/audio/thumbnails`，落在 `["$CACHE/**"]` 内，无需放宽 scope | **成立**，另有更强的经验证据（见决策 5） | `cover_pixels.rs:22-23`、`:82`；`tauri.conf.json:28-31` |

C1 是唯一必须在实现中修掉的缺陷，否则本次优化会引入磁盘无界增长。

## 决策 1：分层规则绑定「命令族」而非 `maxEdge` 数值

**规则**：

| 命令族 | `maxEdge` | 载荷形式 |
| --- | --- | --- |
| 列表/侧边栏/歌单卡缩略图（track / folder / playlist-cover 三条 source 通道） | 128 / 256 / 512 | **新增 JPEG + asset 路径** |
| 播放器大图（`audio_load_cover_pixels`） | 1024 / 1536（及 2048 / 3072） | **保持 SPXR 裸像素 + 二进制 IPC** |

**为什么不能写成 `maxEdge <= 512` 这个全局谓词**——数值确实存在交叠，核查如下：

1. `ALLOWED_MAX_EDGES = [256, 512, 768, 1024, 1536, 2048, 3072]`（`cover_pixels.rs:37`）是播放器通道 `audio_load_cover_pixels` 的白名单，**本身就包含 256 与 512**。
2. `ALLOWED_PLAYLIST_MAX_EDGES = [128, 256, 512]`（`cover_pixels.rs:38`）是列表通道白名单，同时被 `validate_decode_max_edge`（`:2134-2140`）并集采纳。
3. 因此同名 `maxEdge` 在两条命令族里语义不同：`audio_load_cover_pixels` 收到 512 是合法请求，若按数值分层就会被错误改道。
4. 前端侧实际取值是分离的：`COVER_EDGE_BUCKETS = [1024, 1536]`、`MAX_ARTWORK_BACKING_EDGE = 1536`、`selectCoverMaxEdge()` 只会返回 1024 或 1536（`useArtworkVisualResource.ts:519-520`、`:552-561`）；`AudioLoadCoverPixelsInput['maxEdge']` 的 TS 联合类型也只列 `1024 | 1536 | 2048 | 3072`（`audioCommands.ts:111`）。所以**运行期**不交叠，交叠只存在于 Rust 白名单层面。
5. 768 档位在 `src/` 内零调用（全仓搜索 `\b768\b` 在 `src/` 无命中），属于保留但未使用的档位，不得因本次变更被删除或改道。

**结论**：分层由「调用哪条命令」决定，不由 `maxEdge` 数值决定。新增路径命令独占 128/256/512；播放器命令无论收到什么数值都留在像素通道。

## 决策 2：新增独立命令，不给现有命令加参数

### 2.1 为什么不加参数

`audio_load_track_thumbnail` / `audio_load_folder_thumbnail` 返回 `Response`（裸二进制，`lib.rs:754-770`）。改成「有时返回字节、有时返回 JSON 路径」会破坏 `parseCoverPixels` 的二进制契约（`audioCommands.ts:516-526`）以及全部以 `new Uint8Array()` 作为桩的既有测试夹具。新增命令可以让像素通道**逐字节不变**，这是「最坏情况不劣于改造前」的结构基础。

### 2.2 命令清单

| 阶段 | 命令名 | 入参结构（复用，不新建） | 返回 |
| --- | --- | --- | --- |
| P1 | `audio_load_track_thumbnail_path` | `AudioLoadTrackThumbnailInput`（`cover_pixels.rs:417-424`） | `Result<Option<PlaylistThumbnailPath>, CoverPixelsError>` |
| P1 | `audio_load_folder_thumbnail_path` | `AudioLoadFolderThumbnailInput`（`:426-434`） | 同上 |
| P2 | `audio_load_playlist_cover_thumbnail_path` | `AudioLoadPlaylistCoverPixelsInput`（`:408-415`） | 同上 |

`P1` 覆盖列表卡的 256 主干（`useAllSongsWindow.ts:278/287/288`、`useAudioPlayer.ts:2149-2153`、`useLibraryArtwork.ts:181-182`）；`P2` 覆盖首曲 hero 的 512 通道（`useAudioPlayer.ts:2177-2184`、`useLibraryArtwork.ts:198-205`）。`P2` 未落地时 512 停留在像素通道，功能不残缺。

入参结构**直接复用**现有 struct，只把 `max_edge` 的校验集合换成 `ALLOWED_PLAYLIST_MAX_EDGES`（走 `validate_playlist_max_edge`，`:2122-2132`）。不给 `AudioLoadPlaylistCoverPixelsInput` 改名——名字里的 `Pixels` 是历史包袱，重命名会波及既有命令与测试，收益为零。

### 2.3 返回结构

```rust
/// 列表封面路径通道的返回值。`Option::None` 表示「已确认无封面」，
/// 与现有像素命令返回零长 `Response` 的语义一一对应。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistThumbnailPath {
    /// 绝对路径。前端只允许交给 convertFileSrc()，不得拼接或截断。
    pub path: String,
    /// JPEG 实际像素尺寸（可能小于 maxEdge，例如原图本来就小）。
    pub width: u32,
    pub height: u32,
    /// JPEG 文件字节数，供前端资源预算记账。
    #[serde(rename = "byteLength")]
    pub byte_len: u64,
}
```

`width/height` 必须回传真实值而不是回显 `maxEdge`：`scaled_dimensions`（`:2423-2463`）在原图较小时不放大，回显 `maxEdge` 会让 `<img width/height>` 失真并引起布局跳动。

### 2.4 错误语义（与现有像素命令严格对齐）

| 情况 | 后端返回 | 前端行为 |
| --- | --- | --- |
| 命中 / 成功生成 | `Ok(Some(..))` | 使用 asset URL |
| 已确认无封面（标签无图、目录无图） | `Ok(None)` | 无封面占位，**不回落** |
| 路径/IO/解码/尺寸等真实失败 | `Err(CoverPixelsError)` | 回落像素通道 |
| 会话代次过期 | `Err(StaleRequest)` | 丢弃，不回落（与 `playlistCoverScheduler` 现有中止语义一致） |
| JPEG 落盘跳过或超时 | `Err`（见决策 3.4） | 回落像素通道 |

`StaleRequest` 不回落是刻意的：回落会为一个已知过期请求再付一次完整解码，正是 OPT-0018 P4 想消除的浪费。

## 决策 3：磁盘缓存格式、命名与预算

### 3.1 位置与命名（复用同一目录）

- 目录不变：`{AppPaths::cache_dir}/audio/thumbnails`（`cover_pixels.rs:22-23`、`:82`）。
- 文件名：

```rust
const THUMBNAIL_IMAGE_VERSION: u16 = 1; // JPEG 编码参数版本（quality / 采样）

fn playlist_thumbnail_path_filename(source_hash: blake3::Hash, max_edge: u32) -> String {
    format!(
        "{}-{max_edge}-t{THUMBNAIL_TRANSFORM_VERSION}-j{THUMBNAIL_IMAGE_VERSION}.jpg",
        source_hash.to_hex()
    )
}
```

与 `thumbnail_filename`（`:1647-1652`）产出 `{hash}-{edge}-t2-d1.spxr` 并列，扩展名与版本标记不同，**互不覆盖、互不误读**。键语义保持一致：封面内容 BLAKE3 + maxEdge + 变换版本（+ JPEG 编码版本）。

### 3.2 必须同时修掉 C1（预算统计）

同一目录意味着必须让预算统计认识 `.jpg`，否则 `make_thumbnail_room` 永远不会为 JPEG 腾空间，就是无界增长。改动点有两处，缺一不可：

```rust
/// 受管缩略图扩展名。新增编码格式必须在这里登记，否则既不进预算也不被淘汰。
const MANAGED_THUMBNAIL_EXTENSIONS: [&str; 2] = ["spxr", "jpg"];

fn managed_thumbnail_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| MANAGED_THUMBNAIL_EXTENSIONS.contains(&extension))
}
```

- `scan_thumbnail_usage`（`:1962-1966`）的 `extension == "spxr"` 改为 `managed_thumbnail_file(entry.path())`。
- `make_thumbnail_room_with_limits_checked`（`:2057`）的 `path.extension().is_none_or(|ext| ext != "spxr")` 改为 `!managed_thumbnail_file(&path)`。

**不引入第二套预算**：`THUMBNAIL_CACHE_BYTES = 8 GiB`（`:83`）、`THUMBNAIL_CACHE_FILES = 32768`（`:84`）继续共用一个上限、一个 mtime 淘汰序、一个 `THUMBNAIL_USAGE` 记账表（`:100`）、一个 `THUMBNAIL_WRITER`（`:99`）。独立子目录 + 独立扫描函数是重复实现同一套逻辑，多一份可能彼此不一致的上限语义，本轮不采用。

**预算余量说明（无需改常量）**：`8 GiB ÷ 262,228 ≈ 32,758` 的原始配比是按 256 KiB 裸 RGBA 算的。引入约 15 KiB 的 JPEG 后，字节上限会更早由 1024/1536 的 `.spxr`（4 MiB / 9 MiB 一张）占满，文件数上限反而更难触发。这是既有行为（两条通道本来就共享预算），不因本次变更恶化；是否要给两类文件加权淘汰，见「待实现时确认」。

### 3.3 读写与校验

- 读：新增 `read_playlist_thumbnail_path_cache(cache_dir, filename) -> Option<PlaylistThumbnailPath>`，与 `read_thumbnail_cache`（`:1708-1739`）保持同一套防护——`ordinary_file`、大小上下界、`canonicalize` 必须在 `cache_dir` 内、失败即删除并回源。`.jpg` 不做 SPTC/SPXR 头校验（没有），改为：首两字节 `FF D8`、末两字节 `FF D9`、`1 <= len <= THUMBNAIL_PATH_MAX_BYTES`（建议 1 MiB，常量名为 `THUMBNAIL_PATH_MAX_BYTES`）。
- 命中后刷新 mtime（对齐 `:1734`），保证 mtime 淘汰序仍代表最近使用。
- 写：复用 `write_thumbnail_cache_with_limits`（`:1803-1949`）的预算检查 + 同目录 `create_new` 临时文件 + `rename` 原子发布骨架，按扩展名选择容器：`.spxr` 走现有 SPTC 封装（`:1832-1838`），`.jpg` 直接写原始 JPEG 字节（外围临时文件与 rename 协议不变）。`ThumbnailWriteOutcome`/`scan`/记账逻辑不需要分叉。

### 3.4 发布时序（避免 asset URL 404）

像素通道用内存 `pending` 映射兜住了「已解码但未落盘」的窗口（`:185-195`）。路径通道没有等价兜底——前端拿到路径就会去请求文件，文件不存在就是一次失败的图片加载。因此：

1. miss 分支解码 → 缩放 → 编码 JPEG（**与 SPXR 共用同一份缩放结果**，见决策 3.5）；
2. `THUMBNAIL_WRITER::try_enqueue(cache_dir, filename, &jpeg_bytes)`；
3. `THUMBNAIL_WRITER::wait_path_idle(&target, THUMBNAIL_PATH_PUBLISH_TIMEOUT)`（该方法已存在，`:280-291`，`try_warm_*` 已在用同样手法，见 `:1490-1499`）；
4. 重新 stat 目标文件：合法 → 返回 `Ok(Some(..))`；否则（入队被跳过、超时、写失败）→ 返回 `Err`，前端回落像素通道。

`THUMBNAIL_PATH_PUBLISH_TIMEOUT` 初值建议 2 秒（低于 warmup 的 5 秒，路径通道是前台请求）。

### 3.5 必须抽出的共用缩放接缝

JPEG 与 SPXR 必须来自**同一份**方向校正与缩放结果，否则回落前后画面会变。现状 `decode_and_pack_with_strategy`（`:2328-2400`）把解码、方向（`:2363-2366`）、预降采样、Lanczos3、RGBA 打包串在一起。要求抽出：

```rust
/// 解码 + 方向校正 + 列表预降采样 + Lanczos3。两个编码器共用，保证像素一致。
fn decode_playlist_image(
    bytes: &[u8],
    max_edge: u32,
) -> Result<(image::DynamicImage, u32, u32, u32, u32, bool, bool), CoverPixelsError>;
// (image, width, height, source_width, source_height, orientation_applied, resized)
```

`decode_playlist_and_pack`（`:2315-2317`）改为调用它再 `pack_rgba`；JPEG 通道改为调用它再 `image::DynamicImage::ImageRgba8(..).to_rgb8()` + `JpegEncoder`。

`image` 依赖已启用 `jpeg` feature（`Cargo.toml:66-72`），**不需要新增依赖**，`Cargo.toml` 保持不动。

### 3.6 JPEG 编码参数

- quality 初值 **82**（`JpegEncoder::new_with_quality`）。
- alpha 丢弃：现有列表 BMP 通道同样丢弃 alpha（`playlistCoverPixels.ts:38-40` 只取 RGB），JPEG 转 `to_rgb8()` 与之一致，不是新的语义变更。
- EXIF 不写入：方向已在解码阶段应用（`:2366`），重编码后无 EXIF，WebView 不会二次旋转。
- 色彩空间不做 ICC 转换——与现有 SPXR 通道的既有声明一致（`:2387-2389`）。

## 决策 4：版本与失效

| 常量 | 当前值 | 本次是否变更 | 理由 |
| --- | --- | --- | --- |
| `THUMBNAIL_TRANSFORM_VERSION` | 2（`:96`） | **不变** | 本次不改变像素结果（同一 `decode_playlist_image` 输出），`.spxr` 无需重建。改它会让全量 1024/1536 缓存失效，代价大收益零。 |
| `THUMBNAIL_DISK_VERSION` | 1（`:95`） | **不变** | SPTC 容器结构未变。旧 `.spxr` 继续有效，播放器通道完全不受影响。 |
| `THUMBNAIL_IMAGE_VERSION` | 新增，1 | 新增 | 只约束 JPEG 编码参数。将来调 quality/采样或换编码器时 +1，独立失效，不牵连 `.spxr`。 |

**旧 `.spxr` 一律保留。** 播放器 1024/1536 通道持续使用它们；列表 256 通道在路径通道可用时不再读取（仅回落时读）。不做迁移、不做清理脚本：路径回滚后它们立刻恢复全部价值。

若将来某次改动确实改变了列表像素（例如再次调整预降采样策略），按 [SP-022 基线](../architecture/sp-022-thumbnail-optimization-baseline.md) 的既有规则升 `THUMBNAIL_TRANSFORM_VERSION`，`.spxr` 与 `.jpg` 因文件名共用该标记而一起失效，这是正确行为。

## 决策 5：assetProtocol scope 无需放宽

`tauri.conf.json:28-31` 为 `{"enable": true, "scope": ["$CACHE/**"]}`，`csp` 为 `null`（第 27 行，无 `img-src` 限制）；`protocol-asset` feature 已在 `Cargo.toml:29` 启用。不需要任何配置改动。

路径适配性证明：

1. Rust 侧 `AppPaths::cache_dir` = `ProjectDirs::from("app","SpMusic","SpMusic").cache_dir()`（`app_paths.rs:33-38`）。Windows 上为 `%LOCALAPPDATA%\\SpMusic\\SpMusic\\cache`，macOS 为 `~/Library/Caches/<project_path>`，Linux 为 `$XDG_CACHE_HOME/<project_path>`。
2. Tauri 的 `$CACHE` 解析为 `PathResolver::cache_dir()` = `dirs::cache_dir()`（tauri 2.11.5 `src/path/desktop.rs:53-54`），即 `%LOCALAPPDATA%` / `~/Library/Caches` / `$XDG_CACHE_HOME`——都是 `AppPaths::cache_dir` 的**上级**目录。
3. `$CACHE/**` 的 `**` 跨目录分隔符匹配任意深度；`$CACHE/**` → `<cache>/**` 的 glob 能匹配 `<cache>/.../audio/thumbnails/x.jpg`。
4. 更强的是经验证据：**同一棵树下的 `audio/covers/*.jpg` 现在就已经通过 `convertFileSrc` 正常渲染**（`audioCommands.ts:538-542` 的 `audioCoverArtUrl` → `audioTrackModel.ts:147` 的 `coverImage` → `PlaylistCard.tsx:189/215-216`）。新文件层级与 `covers` 完全同级同深，scope 判定不可能更严。

**硬约束**：`scope` 不得改成 `"**"`，也不得新增 `$APPCACHE/**` 之类的冗余条目。诊断/测试版本若需要临时根，按 [sp-022-stage0g](../tasks/sp-022-stage0g-isolated-failure-diagnostic.md) 的既有结论走动态 `allow_directory`，不得动生产静态 scope。

## 决策 6：前端回落契约

### 6.1 判定条件（唯一权威）

```
调用路径命令:
  Ok(Some(ref))            → 使用 convertFileSrc(ref.path)，不回退
  Ok(None)                 → 无封面占位，不回退，不计失败
  Err(StaleRequest)        → 直接丢弃（受控中止），不回退，不计失败
  Err(其他任意 CoverPixelsError) → 立即在同一 pump 内回落像素通道，计一次失败
  convertFileSrc 抛错      → 同上（防御性，理论上不会发生）
```

**与 OPT-0018 措辞的偏差说明**：OPT-0018 §6 写的是「若返回空或报错，自动回落」。本决策把 `Ok(None)` 从回落条件中排除，因为「已确认无封面」在像素通道会得到一个空结果，回落只会把一个确定结论再解码一遍——正是本次要消除的浪费，还会污染熔断计数。

### 6.2 熔断（运行级开关的实质）

新增模块 `src/features/player/services/playlistCoverPathLane.ts`：

```ts
export const PATH_LANE_FAILURE_THRESHOLD = 8
export function pathLaneAvailable(): boolean
export function notePathLaneSuccess(): void
export function notePathLaneFailure(): void   // 连续失败达阈值后永久关闭本次会话
```

语义：

- 连续 8 次路径命令非 `StaleRequest` 失败 → 本次会话内 `pathLaneAvailable()` 恒为 `false`，所有列表封面直接走像素通道。
- 任一次成功即清零连续计数（不是累计计数，避免长期运行慢慢攒满）。
- `StaleRequest`、`Ok(None)`、`AbortSignal` 中止均不计数。
- 该模块不读 `localStorage`、不加用户设置项、不参与持久化。会话级即可，因为回滚条件是「构建级切分支」或「重启后重试」。

### 6.3 回落必须落在原有代码路径上

回落分支**原样调用**现有的 `scheduleTrackThumbnail` / `scheduleFolderThumbnail` / `schedulePlaylistCoverPixels`，后续 `playlistCoverImageFromPixels` → `decodePlaylistCover` → `publish` 流程一字不改。不得复制第二份 BMP 编码或对象 URL 逻辑。

### 6.4 调度器去重键必须加通道维度

`playlistCoverScheduler.ts:145` 现有键为：

```ts
JSON.stringify([kind, input.clientId, input.windowGeneration, ...source, input.maxEdge])
```

改为：

```ts
JSON.stringify([lane, kind, input.clientId, input.windowGeneration, ...source, input.maxEdge])
// lane: 'pixels' | 'path'
```

否则同一 `sourcePath + maxEdge` 的路径任务与像素任务（回落时产生）会互相吞并，导致后到者拿到错误类型的载荷。

新增调度入口（与现有三个并列，签名风格一致）：

```ts
export function scheduleTrackThumbnailPath(input: AudioLoadTrackThumbnailPathInput, options: { priority: PlaylistCoverPriority; signal?: AbortSignal; isCurrent?: () => boolean }): Promise<AudioThumbnailPath | null>
export function scheduleFolderThumbnailPath(input: AudioLoadFolderThumbnailPathInput, options: ...): Promise<AudioThumbnailPath | null>
```

复用同一个 `pump()` / `MAX_CONCURRENT` / 优先级队列，不新建队列。

### 6.5 三个前端改动的落点

| 文件 | 落点 | 改法 |
| --- | --- | --- |
| `useAllSongsWindow.ts` | `pump()` 第 269-300 行 | 先试路径通道；`Ok(None)` → 与 `pixels === null` 同分支；`Err` → 走现有 `pixels` 分支。第 291-297 行的 BMP + `decodePlaylistCover` 仅保留在回落分支；成功分支用 `{ src, width, height, encodedBytes }` 构 `PlaylistCoverImage` 后**仍调用 `decodePlaylistCover`**，保持「发布前已解码」不变量。 |
| `useAudioPlayer.ts` | 第 2143-2161 行的 `edge <= 256` 分支；第 2162-2188 行的 `probe` 之后 512 分支（P2） | 同构替换，`coverThumbnail` 类型不变。`targetEdgeFor`（`:2396-2404`）与预算记账不改。 |
| `useLibraryArtwork.ts` | 第 180-209 行 | 同构替换；`entry.edge` 记账不改。 |

`PlaylistCoverImage.src` 的类型仍是 `string`，asset URL 与 blob URL 在此层面无差别；`playlistCoverReadiness.ts` 用 `WeakSet` + 有界 `presentedUrls`（上限 512，第 10 行），两者通用。

## 决策 7：并发与限流保持不变

**结论：`playlist_decode_permits()`（`cover_pixels.rs:61-70`）、`MAX_PLAYLIST_DECODE_PERMITS = 4`（`:59`）、前端 `MAX_CONCURRENT = 4`（`playlistCoverScheduler.ts:53`）全部不改。**

理由：

1. asset 方式确实绕开了「IPC 传输」和「JS 转码」，但**没有绕开最主要的 CPU 工作**。路径通道的 miss 分支仍要在 Rust 里读取原图、解码、Lanczos3 缩放、编码 JPEG——与像素通道同量级。把许可放宽会让这条最贵的路径失去保护，是净风险。
2. 许可的持有窗口不变（仍是 `spawn_blocking` 内的解码过程），因此瞬时内存上界不变。
3. 命中分支在现有 `load_track`（`:939-974`）结构里同样要占许可，代价是读取一个 `.idx` 索引文件 + 一次 stat，微秒级，不构成吞吐瓶颈。**不要为命中分支做「免许可快速通道」**——那会引入第二套 admission 语义，与 `MAX_PLAYLIST_REQUESTS = 32`（`:72`）的排队上界耦合不清。若实测命中排队成为瓶颈，再单独立项评估，见「待实现时确认」。
4. 解码对象从 `Response`（262 KiB 字节）变成路径字符串，省的是 **IPC 带宽与 JS 主线程**，不是后端 CPU；`playlist_decode_permits` 的注释（`:41-58`）明确它是为 CPU 与瞬时解码预算设的，前提未变。

**前端 `MAX_CONCURRENT = 4` 也不改**：它是对「后端真正能并行执行多少」的建模，后端宽度没变，前端就不该先变，否则只是把队列顶到后端。

**需要记录的行为变化**：解码方从 Rust 变成 WebView（asset 协议），前端不再持有 262 KiB 的 RGBA 中转缓冲。`useAudioPlayer.ts:214` 的 `PLAYLIST_ARTWORK_INFLIGHT_BUDGET = MAX_CONCURRENT * 512 * 512 * 4`（4 MiB）与 `:207` 的 48 MiB 驻留预算本次**均不改**——前者仍在像素回落通道下为真，后者按 `playlistArtworkBytes(edge) = edge*edge*7 + 54`（`:220-222`）估算，对 JPEG 通道是**高估**（7 B/px 假设 BMP+RGBA，实际 asset 通道只有 WebView 侧 4 B/px 解码位图），保守方向，可以留到有实测数据再收敛。

## 决策 8：`sweep()` 与 URL 生命周期——不需要改动

流程如下（`useAllSongsWindow.ts:60-71`）：

```ts
const used = new Set([...document.querySelectorAll('img')].map(i => i.src))
for (const [key, urls] of retired) {
  if (leases.has(key)) continue            // 第 63 行，租约保护
  for (const url of urls) {
    if (used.has(url)) continue            // 仍被 <img> 使用
    URL.revokeObjectURL(url)               // asset URL 下是 no-op
    urls.delete(url)                       // 集合照样收敛，不会泄漏
  }
  if (!urls.size) retired.delete(key)
}
```

结论与要求：

1. `URL.revokeObjectURL` 对非 `blob:` URL 按规范直接返回，asset URL 安全。
2. `retired` 集合仍然会因为 `urls.delete(url)` 而清空，**不产生内存泄漏**，不需要给 asset URL 加引用计数或白名单。
3. `retain`/`retire`/`leases` 的租约语义完全保留——它保护的是「播放器转场期间仍在使用旧 URL」，与 URL 方案无关。
4. `disposeAllSongsCoverStore`（第 95-102 行）与 `trimCache`（第 204-216 行）同样无需改动。
5. `useAudioPlayer.ts` / `useLibraryArtwork.ts` 里大量 `URL.revokeObjectURL(coverThumbnail.src)` 调用点同样无需改动（对 asset URL 都是 no-op）。

**唯一需要新增的契约约束**：任何新代码不得假设「列表封面的 `coverUrl` 可以通过 revoke 释放内存」。asset URL 的解码位图由 WebView 管理，生命周期跟随 `<img>` 节点；释放手段是卸载节点（`contentVisible` 门控与虚拟化已具备），不是 revoke。这条要写进实现注释，否则后续会有人基于错误假设加内存回收逻辑。

## 决策 9：预热通道对齐

`library_cover_warmup.rs` 目前以 `DEFAULT_MAX_EDGE = 256`（第 14 行）调用 `try_warm_track_thumbnail`（`:98`），生产出的是 `.spxr`。路径通道上线后，列表 256 读取的是 `.jpg`，预热产物将无人读，属于纯浪费且占用同一个 8 GiB 预算。

**要求**：新增 `try_warm_track_thumbnail_path(app_cache_dir, source_path, max_edge) -> Result<Option<TrackWarmupOutcome>, CoverPixelsError>`，`library_cover_warmup` 的默认预热目标由 `.spxr` 切到 `.jpg`。像素 `.spxr` 的 256 档降级为「仅回落时按需生成」。

不计入本决策的 P1 主干，但必须与路径通道同批落地，否则本次优化会在磁盘上多存一份没人读的 256 `.spxr`。

## 数据契约汇总

### Rust

```rust
// src-tauri/src/audio/cover_pixels.rs
const THUMBNAIL_IMAGE_VERSION: u16 = 1;
const THUMBNAIL_PATH_MAX_BYTES: u64 = 1024 * 1024;
const THUMBNAIL_PATH_PUBLISH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
const MANAGED_THUMBNAIL_EXTENSIONS: [&str; 2] = ["spxr", "jpg"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistThumbnailPath {
    pub path: String,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "byteLength")]
    pub byte_len: u64,
}

fn playlist_thumbnail_path_filename(source_hash: blake3::Hash, max_edge: u32) -> String;
fn managed_thumbnail_file(path: &Path) -> bool;
fn decode_playlist_image(bytes: &[u8], max_edge: u32)
    -> Result<(image::DynamicImage, u32, u32, u32, u32, bool, bool), CoverPixelsError>;
fn encode_playlist_jpeg(image: &image::DynamicImage) -> Result<Vec<u8>, CoverPixelsError>;
fn read_playlist_thumbnail_path_cache(cache_dir: &Path, filename: &str)
    -> Option<PlaylistThumbnailPath>;

// src-tauri/src/audio/cover_pixels.rs (impl PlaylistCoverRequestCoordinator)
async fn load_track_path(self: &Arc<Self>, app_cache_dir: PathBuf, input: AudioLoadTrackThumbnailInput)
    -> Result<Option<PlaylistThumbnailPath>, CoverPixelsError>;
async fn load_folder_path(self: &Arc<Self>, app_cache_dir: PathBuf, input: AudioLoadFolderThumbnailInput)
    -> Result<Option<PlaylistThumbnailPath>, CoverPixelsError>;

// 复用现有 blocking 入口，新增“路径”版本以免复制标签探测/兄弟图查找逻辑
fn load_track_thumbnail_path_blocking(app_cache_dir: &Path, source_path: &str, max_edge: u32)
    -> Result<Option<PlaylistThumbnailPath>, CoverPixelsError>;
// folder_cover.rs 同步新增
pub(super) fn load_folder_thumbnail_path_blocking(app_cache_dir: &Path, root_path: &str, directory_path: &str, max_edge: u32)
    -> Result<Option<PlaylistThumbnailPath>, CoverPixelsError>;
```

```rust
// src-tauri/src/lib.rs —— 注册到 invoke_handler（现有列表见 :833-879）
#[tauri::command]
async fn audio_load_track_thumbnail_path(state: State<'_, AppPaths>, input: AudioLoadTrackThumbnailInput)
    -> Result<Option<PlaylistThumbnailPath>, CoverPixelsError>;

#[tauri::command]
async fn audio_load_folder_thumbnail_path(state: State<'_, AppPaths>, input: AudioLoadFolderThumbnailInput)
    -> Result<Option<PlaylistThumbnailPath>, CoverPixelsError>;
```

### TypeScript

```ts
// src/features/player/services/audioCommands.ts
export type AudioThumbnailPath = {
  path: string
  width: number
  height: number
  byteLength: number
}

export type AudioLoadTrackThumbnailPathInput = {
  clientId: string
  sourcePath: string
  maxEdge: 128 | 256 | 512
  windowGeneration: number
}

export type AudioLoadFolderThumbnailPathInput = {
  clientId: string
  rootPath: string
  directoryPath: string
  maxEdge: 128 | 256 | 512
  windowGeneration: number
}

export async function loadAudioTrackThumbnailPath(input: AudioLoadTrackThumbnailPathInput): Promise<AudioThumbnailPath | null>
export async function loadAudioFolderThumbnailPath(input: AudioLoadFolderThumbnailPathInput): Promise<AudioThumbnailPath | null>
```

`path` 字段只允许交给 `convertFileSrc`（`audioCommands.ts:1` 已从 `@tauri-apps/api/core` 导入），不得字符串拼接、不得传给 `fetch` 后用 `blob:` 中转（那会把 asset 通道重新变成一次 JS 侧拷贝）。

## 数据流

```mermaid
flowchart TB
  subgraph Front["WebView (React)"]
    List["AlbumLibraryPanel / FolderHierarchy / SearchPanel<br/>useAllSongsWindow.pump()"]
    PList["PlaylistPanel<br/>useAudioPlayer / useLibraryArtwork"]
    Sched["playlistCoverScheduler<br/>lane='path' | lane='pixels'"]
    Lane["playlistCoverPathLane.ts<br/>熔断器 (阈值 8)"]
    Img["PlaylistCoverImage &lt;img src&gt;"]
  end
  subgraph Back["Tauri / Rust"]
    Cmd["audio_load_*_thumbnail_path"]
    Coord["PlaylistCoverRequestCoordinator<br/>slots = available_parallelism()/4, 1..=4"]
    Dec["decode_playlist_image<br/>方向 + 预降采样 + Lanczos3"]
    Enc["encode_playlist_jpeg<br/>quality 82"]
    Writer["THUMBNAIL_WRITER 单写者<br/>预算 8 GiB / 32768 文件"]
  end
  subgraph Cache["{cache_dir}/audio/thumbnails"]
    Jpg["{hash}-{edge}-t2-j1.jpg"]
    Spxr["{hash}-{edge}-t2-d1.spxr"]
  end

  List --> Lane
  PList --> Lane
  Lane -->|path 可用| Sched
  Sched -->|lane=path, ≤512| Cmd
  Cmd --> Coord
  Coord --> Dec --> Enc --> Writer --> Jpg
  Cmd -.命中, 只 stat+读 .idx.-> Jpg
  Jpg -->|绝对路径 ~100 B| Cmd
  Cmd -->|"{path,width,height,byteLength}"| Sched
  Sched -->|convertFileSrc| Img
  Lane -->|path 熔断 / 回落| Sched
  Sched -->|lane=pixels, 原 SPXR 二进制| Coord
  Coord --> Spxr
  Spxr -->|262,184 B RGBA| Sched
  Sched -->|playlistCoverPixels.ts BMP| Img
```

## 备选方案与取舍

| 方案 | 内容 | 判定 |
| --- | --- | --- |
| A（采用） | 新增路径命令族 + 同目录 `.jpg` + 登记受管扩展名 | 像素通道逐字节不变，回落成本最低，预算逻辑只有一处改动 |
| B | 给现有命令加 `format` 参数，返回类型改为 tagged union | 破坏 `parseCoverPixels` 二进制契约与全部测试夹具；Tauri 侧返回 `Response` 与 JSON 无法共存 |
| C | 独立子目录 `audio/thumbnails-jpeg` + 独立 scan/预算 | 需要第二套 `scan_thumbnail_usage`/`make_thumbnail_room`/记账表，两套上限语义容易漂移；收益仅是隔离，本轮不需要 |
| D | 全部换成 WebView 可解码格式（含 1024/1536） | 播放器 `writePixelsToCanvas`（`useArtworkVisualResource.ts:588-599`）必须 `putImageData` 裸像素；且会给 BUG-0016/0017 的转场内存高水位引入新变量 |
| E | 提高 `THUMBNAIL_TRANSFORM_VERSION` 强制重建 | 与本次目标无关，会让 1024/1536 全部失效，代价大 |
| F | 回传 `data:` base64 而不是磁盘路径 | 恢复成 JS 侧大字符串拷贝，与优化目标相悖 |

## 影响

**正向**

- 单张列表封面 IPC 从 262,184 B 降到约 100 B 路径 + WebView 侧约 15 KB 文件读取。
- 移除 JS 主线程 65,536 次/张的 BMP 逐像素转码（`playlistCoverPixels.ts:32-42`）。
- 解码次数从 3 次（Rust + JS + WebView）降到 1 次（WebView）。
- 同一封面内容哈希在多首曲目间共享同一份 JPEG 与同一次 WebView 解码，命中率天然提升。
- 磁盘单张从 256 KiB 降到约 15 KiB。

**负向 / 需要观测**

- 首次生成多一次 JPEG 编码（约 1–2 ms），且路径通道要在返回前等落盘（决策 3.4），冷路径可能比像素通道略慢；热路径显著更快。冷路径绝对值必须实测。
- 解码责任转移到 WebView renderer，内存占用从「JS 堆 + BMP URL」变为「WebView 图像缓存」，两侧要分别观测。
- 每次请求多一次 IPC 往返（路径命令）；熔断前若路径通道系统性故障，会短暂出现 2 次 IPC/张。
- 多了一个前端模块（熔断器）与两个调度入口，`playlistCoverScheduler.ts` 的键结构变更。
- 磁盘上同时存在 `.jpg` 与 `.spxr` 两类文件，同一预算下互相挤占（既有行为，但比例会变化）。

## 验收标准

架构层可验证项（Test Agent 据此转成用例）：

1. 分层：`audio_load_cover_pixels` 收到 `maxEdge=512` 时**仍返回 SPXR 裸像素**，不得改道 JPEG。
2. 命令族：`audio_load_track_thumbnail_path` 接受 128/256/512，拒绝 768/1024；`audio_load_track_thumbnail`（像素）仍拒绝 512。
3. 语义对齐：同一曲目在路径通道 `Ok(None)` 与像素通道零长 `Response` 两个场景下，前端 `hasLocalArtwork` 结论一致。
4. 预算：写入一批 `.jpg` 后，`scan_thumbnail_usage` 的 `bytes`/`files` 必须包含它们；构造超限场景时 `.jpg` 会被 mtime 淘汰，且 `audio/covers` 原图不受影响。
5. 原子性：并发同键请求最多产生一份有效文件，不出现半成品被当作命中；`wait_path_idle` 超时后返回 `Err` 而非不存在的路径。
6. 兼容：`THUMBNAIL_TRANSFORM_VERSION` 仍为 2、`THUMBNAIL_DISK_VERSION` 仍为 1；既有 `.spxr` 缓存命中行为不变（现有断言 `:3559`、`:4138-4156` 必须继续通过）。
7. 回落：人为让路径命令返回任意非 `StaleRequest` 错误，列表封面必须仍能显示（走像素通道），且连续 8 次后不再发起路径命令。
8. `StaleRequest` 与中止：过期请求不触发回落、不计数。
9. scope：`convertFileSrc` 生成的 asset URL 在真实 WebView2 中能渲染 `{cache_dir}/audio/thumbnails/*.jpg`；`tauri.conf.json` 的 `assetProtocol.scope` 仍为 `["$CACHE/**"]`。
10. 服务契约无回退：播放器 1024/1536 大封面、背景氛围、拖拽投影全部与改造前一致（`writePixelsToCanvas` 路径未变）。

## 风险

1. **磁盘无界增长（最高危）**——只改写入不改 `scan_thumbnail_usage` 与 `make_thumbnail_room_with_limits_checked` 的扩展名过滤。决策 3.2 是硬要求，验收标准 4 专门封堵。
2. **asset URL 404**——不按决策 3.4 等落盘就返回路径。表现为随机空封面，且会被熔断器误判为系统性故障。
3. **两套像素不一致**——JPEG 不复用 `decode_playlist_image` 而另写一份缩放/方向逻辑，回落前后画面会跳变。
4. **预算被 1024/1536 挤占**——8 GiB 主要被 4–9 MiB 的 `.spxr` 占用，JPEG 可能长期处于被淘汰边缘，导致重复编码。需要实测命中率。
5. **WebView renderer 内存上移**——解码位图不再由我们 revoke 释放，renderer 内存须单独观测，不得用「改造前 app.exe 内存更低」简单对比。
6. **熔断阈值误判**——阈值过低会让偶发失败关掉整条通道；过高则故障期多付 IPC。8 是初值，需实测调整。
7. **`P2`（512 hero）遗漏**：若只做 `P1`，512 通道仍是 1 MiB 裸像素 + BMP，是最贵的单张，收益不完整。

## 待实现时确认

以下项目前证据不足，不作硬性规定，实现时必须实测后回填本文或对应任务记录：

1. `image` 0.25.10 的 `JpegEncoder` 默认色度采样（4:2:0 / 4:4:4）与 quality 82 的体积/主观质量最优点。
2. `THUMBNAIL_PATH_PUBLISH_TIMEOUT` 实际取值：2 秒是否足够覆盖磁盘拥塞下的前台请求。
3. `THUMBNAIL_PATH_MAX_BYTES` 取 1 MiB 是否足够（极端高频噪声封面体积上限）。
4. 命中分支是否需要「免许可快速通道」——只有在实测命中排队成为可观测瓶颈时才立项，且必须同时厘清与 `MAX_PLAYLIST_REQUESTS = 32` 的关系。
5. 引入 JPEG 后 8 GiB 预算的实际分布，以及是否需要给两类文件做加权淘汰。
6. Windows WebView2 上 asset URL 的 HTTP 缓存行为与 revoke 无关的长期驻留表现（OPT-0018 §8.2 已列为未验证项）。
7. `P2`（`audio_load_playlist_cover_thumbnail_path`）是否与 `P1` 同批交付；若拆批，512 通道的收益要单列。

## 回滚条件

分三层，三层互相独立：

1. **构建级**：本改动置于 `feature/album-cover-asset-pipeline` 分支，不触碰 `develop`。切回 `develop` 重新打包即可完全回退（OPT-0018 §6 已确认 `main`/`develop` 未被修改）。
2. **运行级**：前端熔断器（决策 6.2）在连续 8 次失败后自动退回像素通道；最坏情况等于改造前，只是多了一次失败的 IPC。也可将 `pathLaneAvailable()` 的实现临时改为恒 `false` 作为硬开关。
3. **缓存级**：`.jpg` 使用独立扩展名与独立版本标记，旧 `.spxr` 全程未经改动。回滚后遗留的 `.jpg` 仍被 `MANAGED_THUMBNAIL_EXTENSIONS` 计入预算并会按 mtime 自然淘汰，**不需要手工清理**；若回滚同时撤掉决策 3.2 的改动，则需要一次性清理 `audio/thumbnails/*.jpg`（这是唯一需要人工介入的回滚组合，必须在回滚说明里写明）。

出现以下任一情况应整体回滚并保留证据：真实 WebView2 下无体感改善；出现封面永久不完成或随机空封面；`.jpg` 出现未计入预算的增长；回落通道不可用导致缺图；播放器大封面/背景/拖拽投影出现任何回退；renderer 内存不可回落。

## 关联文档

- [OPT-0018](../changes/optimizations/OPT-0018.md)：本次改动对应的优化需求与调查证据。
- [playlist-artwork-loading.md](../architecture/playlist-artwork-loading.md)：列表封面加载的既有边界契约。本文的「候选三：图片传输优化契约」正是本决策的上位约束。
- [sp-022-thumbnail-optimization-baseline.md](../architecture/sp-022-thumbnail-optimization-baseline.md)：`THUMBNAIL_TRANSFORM_VERSION` 演进规则、SPXR v1 不变式、写入者边界的来源。
- [2026-08-05-OPT-0001-async-track-parsing.md](./2026-08-05-OPT-0001-async-track-parsing.md)：本文档格式参照。
- [2026-07-09-document-metadata-standard.md](./2026-07-09-document-metadata-standard.md)：元数据规范。
- [BUG-0016](../changes/bugs/BUG-0016.md)、[BUG-0017](../changes/bugs/BUG-0017.md)：无界图像工作与转场 URL 生命周期的历史回归要求，本决策不得违反。
- 建议下一负责 Agent：Rust/Tauri Agent（决策 2/3/4/7/9 的后端实现与 `cover_pixels.rs` 抽取接缝）、Frontend Agent（决策 6 与调度器键结构）、Test Agent（验收标准 1-10 独立验证）。
