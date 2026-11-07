---
doc_id: "IMPL-PLAYLIST-COVER-BACKEND-CONCURRENCY"
title: "播放列表封面后端并发改造与探测去重"
doc_type: "implementation"
status: "active"
owner_agent: "Rust/Tauri Agent"
version_scope: "project"
created: "2026-10-25"
updated: "2026-10-25"
source_documents:
  - ".agents/prompt/Rust_Tauri_Agent.md"
  - "user request: 优化播放列表专辑封面冷启动加载速度（并发改造 + 专辑级去重）"
  - "docs/architecture/audio-visual-pipeline.md"
---

# Rust/Tauri 实现：播放列表封面后端并发改造与探测去重

## 摘要

播放列表封面的**后端**链路存在三处串行化，其中两处没有任何正确性理由。本次改动：

1. **标签探测全局单锁 → 有界并发**（`playlist_cover.rs`）。原先 `reserve()` 允许 32 个请求排队，但随后 `Mutex::lock_owned()` 是全局互斥，实际同时只有 **1 个**线程在读标签。改为令牌池后并发宽度为 `min(available_parallelism(), 8)`，本机（20 逻辑核）实测为 **8**。
2. **像素解码许可 1 → 主机推导上界**（`cover_pixels.rs`）。`(available_parallelism() / 4).clamp(1, 4)`，本机实测为 **4**，保留 `sp022-playlist-decode-n2` feature 的既有语义（=2）。
3. **探测阶段合并且复用**（`playlist_cover.rs`）。同一来源的并发探测合并为一次真实标签读取，并保留有界 LRU 结果复用。

同时重新推导了 warmup 让路语义（多许可下 `try_lock` 成功不再等于"前台没在用"），改为保留槽位上限的显式判定。

**重要事实（影响收益归属）**：渲染进程侧 `src/features/player/services/playlistCoverScheduler.ts` 是进程级单通道调度器（模块级 `active` 标志），同一时刻最多只有 1 个封面 pixel invoke 在飞。因此第 2 项（解码并发）的**端到端**收益被前端卡口限制，后端只解除了自身限制；第 1、3 项不受该卡口影响，是真实端到端收益。该前端改造由 Frontend Agent 的独立任务承担，不在本 Agent 写入范围。

## 根因与证据

### 复现基线

改动前在本机（i7-12700KF，12 物理核 / 20 逻辑核，`available_parallelism()` = 20）测得：

| 场景 | 结果 |
| --- | --- |
| `cargo check` | 通过 |
| `cargo test --lib audio::cover_pixels` | 38 passed / 0 failed / 2 ignored |
| `cargo test --lib audio::playlist_cover` | 5 passed / 0 failed |
| 48 个真实带标签文件的探测（串行） | 81.9 ms，单文件 1706 µs |

### 因果链

**瓶颈 A —— 标签探测全局单锁**

```
冷启动播放列表 N 首歌
  → 前端 audio_probe_playlist_cover × N（useLibraryArtwork / useAudioPlayer 直接调用，不走 pixel 调度器）
  → CoverSourceCoordinator::reserve()  成功（允许 32 并发排队）
  → Arc<Mutex<()>>::lock_owned().await ← 全局互斥，仅 1 个通过
  → 其余 N-1 个 future 排队
  → 用户可见：封面逐个出现，总耗时 ≈ N × 单次探测延迟
```

`probe_playlist_cover_blocking` 的主体是 `Probe::open` + `read()`（`read_properties(false)`、`read_cover_art(true)`），**只读、线程安全、无共享可变状态**。串行化不是正确性要求，纯粹是锁的范围过大。

**瓶颈 B —— 解码许可硬编码 1**

`PLAYLIST_DECODE_PERMITS` 在非 feature 构建下恒为 1，且 `load_track_thumbnail` 与 `load_playlist_cover_pixels` 共用同一个 `PlaylistDecodeSlots`。

**瓶颈 C —— 探测无去重**

`useAudioPlayer` 的 `targetEdgeFor`：首曲 256 → 512 升级（同一 sourcePath、同一次视觉需求内），列表卡片恒 256；滚动回视野、重渲染也会对**同一 sourcePath** 重新发出 `audio_probe_playlist_cover`。每次都是一次完整 `Probe::open` + 标签解析。

**注意**：像素解码本身**已有**内容寻址去重（`thumbnail_filename(source_hash, max_edge)`），所以同专辑多曲在第 1 曲之后解码是命中的。C 的真实收益是**省掉重复的 lofty 标签探测**，不是省掉解码。

### 根因修复

- **A**：把 `Mutex<()>` 换成令牌池（`Sender/Receiver<()>` 预置 N 个令牌），N 由主机推导并封顶 8。令牌被 move 进 `spawn_blocking` 闭包，保持"取消的 async 调用方不能释放正在进行的 I/O 槽位"这一既有语义。`MAX_REQUESTS = 32` 的请求准入不变。
- **B**：许可数由 `playlist_decode_permits()` 在运行时推导，`sp022-playlist-decode-n2` feature 仍返回 2。
- **C**：新增 `CoverProbeCache`，按规范化源路径索引，含 in-flight 合并（`ProbeFlight`）+ 有界 LRU（256 项）。

## 上界论证

两条管线的上界**故意不同**，因为负载性质不同：

| 管线 | 负载 | 上界 | 本机取值 | 理由 |
| --- | --- | --- | --- | --- |
| 标签探测 | I/O 密集 | `min(available_parallelism(), 8)` | **8** | 只读少量头部/标签字节；宽度受卷的并发读能力限制。封顶 8：冷启动是一批指向同一 cache/卷的小读，超过后只在同一元数据缓存上争抢，延迟上升而不增吞吐。内存上界是 8 份小型探测堆，每份仅保留标签字节 + 已被 `bounded_playlist_cover_from_tag` 限定的封面块。 |
| 像素解码 | CPU 密集 + 内存敏感 | `(available_parallelism() / 4).clamp(1, 4)` | **4** | 单次解码已能占满一核（大封面的 Lanczos3 降采样）。每 4 逻辑核放 1 个 worker 避免过度订阅；封顶 4 防止宽机器无收益地放大瞬时预算。 |

**内存上界**（未放大任何既有预算）：

- 瞬时最坏情况 = `permits × MAX_DECODE_BYTES` = `4 × 256 MiB = 1 GiB`，**瞬时**，解码返回即释放。
- 持久预算**未改动**：`THUMBNAIL_CACHE_BYTES = 8 GiB`、`THUMBNAIL_PENDING_BYTES = 32 MiB`、`MAX_DECODE_BYTES = 256 MiB`。
- 新增的探测缓存：`PROBE_CACHE_ENTRIES = 256` 项，每项持有一个 `AudioCoverArt`（封面数据实际已按内容哈希落盘到 `audio/covers/`，缓存项只是路径/长度等元数据）；非封面情况只保留 `(len, mtime_ns)` 签名。

## 必须保持不变的正确性（逐条核对）

1. **取消 / 陈旧语义**：`ensure_current(client_id, window_generation)` 仍是 acquire 前、acquire 后、publish 前三次校验（`run_registered` / `load` / `load_track` 均未改动调用点）。`CoverPixelsError::stale()` 照旧传播。
2. **取消的 async 调用方不释放进行中的 I/O 槽位**：`playlist_cover` 的 `CoverSourcePermit` 与 `cover_pixels` 的 `PlaylistDecodePermit` 都被 move 进 `spawn_blocking` 闭包；permit 由 blocking 闭包持有并 drop。
3. **panic 释放准入**：`RequestReservation` / `CoverSourcePermit` / `PlaylistDecodePermit` 均有 `Drop`；`cover_source_panic_releases_admission` 覆盖。
4. **负缓存与指纹校验**：`write_track_index(..., None)` 与 `(size, mtime_ns)` 校验逻辑**未改动**。新增的探测缓存只在**成功解析**后写入，错误永不缓存（`cover_source_probe_cache_does_not_retain_errors` 断言失败两次触发两次真实读取）。
5. **内存预算不放大**：见上表。
6. **warmup 让路**：见下节。

## warmup 让路语义（多许可下的重新推导）

原实现依赖"只有 1 个槽位"，所以 `try_lock` + `try_recv` 成功即等于"前台没在用"。多槽位下这个推理失效：`try_recv` 可能拿到倒数第二个令牌，而用户刚滚到的封面正在排队。

改为 `try_acquire_background()`：

- 在令牌互斥锁内判 `held >= width.saturating_sub(BACKGROUND_RESERVED).max(1)` 即让路；
- `BACKGROUND_RESERVED = 1` 保证 warmup **永远给前台留至少 1 个槽位**；
- 原有的 `requests.load(Ordering::Acquire) != 0` 前置与后置检查**保留不变**，仍然"有前台请求注册就让路"。

`background_warmup_keeps_a_foreground_slot_free` 断言：空闲可拿；前台占满时拿不到；降到 ceiling 时仍拿不到；低于 ceiling 时重新可拿。

## Commands / API

契约**零变更**。三个命令的输入/输出结构、错误码、序列化形态均未改动：

- `audio_probe_playlist_cover(input: { path })` → `AudioPlaylistCoverSource { id, sourcePath, coverArt }`
  - 内部改为走 `probe_playlist_cover_coalesced`；**返回结构不变**（仍为 3 个字段，无 `metadata` / `durationMs`）。
- `audio_load_playlist_cover_pixels(input)` → `SPXR` 二进制，协议不变。
- `audio_load_track_thumbnail(input)` → `SPXR` 二进制或空数组，协议不变。

## 修改文件

- `src-tauri/src/audio/playlist_cover.rs`
  - `CoverSourceCoordinator`：`Mutex<()>` → 令牌池 + `CoverSourcePermit`；新增 `with_slots` / `available` / `probe_worker_limit`。
  - 新增 `CoverProbeCache` / `ProbeFlight` / `ProbeFlightGuard` / `ProbeSignature` / `probe_playlist_cover_coalesced`。
  - 抽出 `probe_cover_art` 供两条路径共用，行为等价。
  - 测试：改写 2 个（`cancelled_cover_source_retains_worker_slot_and_request_until_completion`、`cover_source_panic_releases_admission`），新增 11 个。
- `src-tauri/src/audio/cover_pixels.rs`
  - `PLAYLIST_DECODE_PERMITS` 常量 → `playlist_decode_permits()` + `MAX_PLAYLIST_DECODE_PERMITS`。
  - `PlaylistDecodeSlots`：新增 `width` / `held` / `try_acquire_background`；`PlaylistDecodePermit` 改为持有 `held` 计数。
  - 两处 warmup 让路改用 `try_acquire_background()`。
  - 测试：`coordinator.slots.width` 参数化替换 14 处；新增 2 个。
- `docs/implementation/playlist-cover-backend-concurrency.md`（本文档）

未修改：`src/**`、`AGENTS.md`、`.agents/**`、`Cargo.toml`（`sp022-playlist-decode-n2` feature 保留原样，未新增依赖）。

## 验收标准检查

- 标签探测不再全局串行：**通过**（并发峰值 > 1 且有界）
- 并发度有明确上界且与 `available_parallelism()` 挂钩：**通过**
- 解码许可提高且有内存上界说明：**通过**
- 保留 `sp022-playlist-decode-n2` 既有语义与测试：**通过**
- 取消 / stale / panic 释放 / 负缓存 / 内存预算不被破坏：**通过**（逐条测试覆盖）
- warmup 不挤占前台：**通过**
- `cargo check` 通过：**通过**
- `cargo test --lib` 通过：**通过**
- 提供可测的并发生效证据：**通过**（见下）

## 验证

### `cargo check`

```
cargo check --all-targets → Finished，0 error，0 warning
```

### Rust 回归测试

```
cargo test --lib → 249 passed; 0 failed; 4 ignored
```

相关模块（改动前 43 个用例 → 改动后 55 个）：

```
cargo test --lib audio::playlist_cover  → 16 passed, 0 failed, 2 ignored
cargo test --lib audio::cover_pixels    → 40 passed, 0 failed, 2 ignored
```

Lead 点名的 5 个高危用例全部通过：

- `audio::cover_pixels::tests::stale_queued_request_does_not_enter_decode_work` ✅
- `audio::cover_pixels::tests::playlist_generation_change_discards_a_queued_request` ✅
- `audio::cover_pixels::tests::thumbnail_writer_queue_is_bounded_and_shutdown_rejects_new_work` ✅
- `audio::playlist_cover::tests::cancelled_cover_source_retains_worker_slot_and_request_until_completion` ✅
- `audio::playlist_cover::tests::cover_source_panic_releases_admission` ✅

### 性能 / 时序证据（本机实测）

**1. 并发生效（进程内，确定性）**

```
cargo test --lib audio::playlist_cover::tests::cover_source_concurrency_cuts_probe_wall_clock -- --nocapture
SP-COVER-PROBE width=4 hold_ms=50 serial_ms=201.6 concurrent_ms=50.9 speedup=3.96x
```

4 个探测，每个体内固定 sleep 50 ms：串行 201.6 ms，并发 50.9 ms。断言 `concurrent < HOLD*2`，串行侧断言 `> HOLD*3`，因此修复前（全局单锁）必然失败。

**2. 并发生效（真实文件，非合成延迟）**

```
cargo test --lib audio::playlist_cover -- --ignored --nocapture
SP-COVER-PROBE-REAL files=48 width=8 serial_ms=82.7 concurrent_ms=31.3 speedup=2.64x
                   serial_per_file_us=1723 concurrent_per_file_us=653
```

48 个真实带 ID3 标签的 WAV，经 `probe_worker_limit() = 8` 的协调器：**82.7 ms → 31.3 ms（2.64x）**，单文件 1723 µs → 653 µs。

**3. 探测去重（C 的收益）**

```
SP-COVER-COALESCE files=64 cold_ms=116.5 warm_ms=13.4 uncoalesced_pass_ms=60.8
                  warm_speedup=4.52x warm_per_file_us=210
```

64 个文件的重复需求：无复用 60.8 ms，走缓存 13.4 ms（**4.52x**），单文件 210 µs。冷启动首轮 116.5 ms 为一次真实全探测，符合预期（去重不减少首轮必要工作）。

**4. 并发峰值有界**

`cover_source_probes_run_concurrently_up_to_the_bound` 断言：并发峰值 `> 1`（修复前恒为 1）**且** `<= WIDTH`；同时体内计数与峰值一致，证明观测到的重叠是真实的 worker 重叠而非计数假象。

### 跨层契约检查

- `AudioPlaylistCoverSource` 序列化字段数断言仍在（`cover_only_probes_tags_and_preserves_identity_without_full_metadata` 断言 `as_object().len() == 3`，且无 `metadata` / `durationMs`），前端 `probeAudioPlaylistCover` 的字段校验规则不受影响。
- `SPXR` 协议常量（`HEADER_LEN = 40`、`COVER_PIXELS_RGBA8 = 1`、`FLAG_*`）未改动。
- `audio_load_track_thumbnail` 返回空数组表示"无封面"的约定未改动。

## 风险 / 备注

1. **B 的端到端收益受前端卡口限制（如实记录，不虚报）**。`playlistCoverScheduler.ts` 的模块级 `active` 使渲染进程同时最多 1 个封面 pixel invoke。后端解码并发从 1 提到 4 只解除了**后端**限制；要兑现端到端收益，需要把该调度器改为 N 路（Frontend Agent 的独立任务）。同理，`useLibraryArtwork`（CONCURRENCY=2）与 `useAllSongsWindow`（WINDOW_CONCURRENCY=2）也是前端并行度来源之一。
2. **探测并发的实际上限还会被前端 lane 宽度限制**。`audio_probe_playlist_cover` 在 `useLibraryArtwork` 中跑在 CONCURRENCY=2 的 lane 上、在 `useAudioPlayer` 中跑在 2 路 hydration 上。后端 8 路是为多客户端/多 hook 汇流和 `load_track_thumbnail` 直调路径准备的余量；单看单个 hook，实测有效并行度接近 2。这属于前端调度，非后端缺陷。
3. **`MAX_REQUESTS = 32` 未放宽**。超出仍返回 `InternalError("Playlist cover source queue is full")`，与改动前一致。真实文件测量中 48 个并发请求会被拒绝，测量因此按 `MAX_REQUESTS` 分批——这是**既有**的显式背压，不是新引入的限制。
4. **探测缓存以 `(len, mtime_ns)` 判定失效**。与像素侧的 `source_fingerprint` 判据同构。极端情形（文件被改写但长度与 mtime 纳秒完全不变）会复用旧结果；这与既有 `read_track_index` 的判据一致，未引入新的失效模式。
5. **`PROBE_FLIGHT_WAIT = 30s` 是活性保护，不是超时调优**。仅在 leader 长时间不返回（例如卷挂死）时触发；leader panic 会由 `ProbeFlightGuard` 立即清理 flight 并唤醒 follower，不会让后续请求等满 30s。
6. **`background_warmup_keeps_a_foreground_slot_free` 在 width == 1 时跳过最后一档断言**（`width == 1` 时 `ceiling == width`，不存在"低于 ceiling"的中间态）。这是该配置下的真实语义，不是放宽。
7. **未做"专辑级"启发式去重**。原始设想是按目录/专辑归并，但前端对每首歌都发独立 `audio_probe_playlist_cover` 并校验 `cover.id === descriptor.id` 与 `sourcePath` 一致，按目录返回会破坏"每个 sourcePath 都要挂载一份封面"的既有语义；且同专辑封面字节本就相同，像素侧已内容寻址去重。因此改为**按源路径的精确合并 + 复用**，收益落在真实重复点上（重渲染、滚回视野、256→512 升级）。
