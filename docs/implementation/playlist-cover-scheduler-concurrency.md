---
doc_id: "IMPL-PLAYLIST-COVER-SCHEDULER-CONCURRENCY"
title: "播放列表封面调度器：单通道改为有界多通道并发"
doc_type: "implementation"
status: "draft"
owner_agent: "Frontend Agent"
version_scope: "SP-022 播放列表封面冷启动加载"
created: "2026-10-25"
updated: "2026-10-25"
source_documents:
  - "user request: 我就要快，改动量大不大无所谓"
  - "docs/architecture/playlist-artwork-loading.md"
  - "docs/implementation/sp-022-backend-cover-concurrency-safety.md"
  - "src/features/player/services/playlistCoverScheduler.ts"
  - "src/features/player/hooks/useAudioPlayer.ts"
  - "src-tauri/src/audio/cover_pixels.rs"
---

# 播放列表封面调度器：单通道改为有界多通道并发

## 摘要

渲染进程的封面像素调度器 `playlistCoverScheduler.ts` 原本用模块级布尔量 `active` 做互斥，使整个渲染进程同一时刻只能有 **1 个** `audio_load_playlist_cover_pixels` / `audio_load_track_thumbnail` invoke 在飞。本轮把它改成有界并发计数 `activeCount` + `MAX_CONCURRENT = 4`，`pump()` 一次可投放多个 job。

实测峰值并发从 **1 → 4**（同一夹具、同一负载形状下观测，见「验证」）。

这是封面冷启动的端到端头号瓶颈：`useLibraryArtwork` 的 `CONCURRENCY = 2` 与 `useAllSongsWindow` 的 `WINDOW_CONCURRENCY = 2` 都汇流进同一个 `pump()`，被 `active` 卡成 1。后端即使放开门禁，请求也发不出第二个。本次改动是解锁后端收益的前提。

## 根因与证据

### 复现基线

改动前的调度器（`HEAD` 版本）核心三行：

```ts
let active = false          // 模块级全局标志
function pump() {
  if (active) return        // 只要有一个在飞就整体返回
  ...
  active = true; job.active = true
  void load.then(...)
  return                    // 发一个就 return
}
function finish(...) { ...; active = false; pump() }
```

对应地，改动前的 `playlistCoverScheduler.test.mjs` 在 **6 个用例里全部** 断言：

```js
assert.equal(h.maximumActive, 1)
```

这就是瓶颈的书面证据——测试把「同时最多一个在飞」写成了不变量。

### 因果链

1. 触发条件：播放列表/全部歌曲首屏需要 N 张封面（视口 + 附近窗口 + 当前曲目）。
2. 首个错误状态：`scheduleCoverPixels()` 对每个请求调用 `pump()`；第一次调用把 `active` 置 `true`，后续调用在 `pump()` 首行直接 `return`。
3. 传播路径：两个 hook 各自的并发（2 + 2）在调度器入口被压平成 1；后续 job 全部滞留 `pending`，只能串行等待前一个 invoke 完全返回。
4. 用户可见故障：冷启动封面逐张「排队冒出来」，总耗时 ≈ 封面数 × 单张解码耗时，而不是 ≈ 封面数 / 并发度 × 单张耗时。后端放开解码许可对用户可见延迟 **无收益**。

### 根因修复

修复落在产生首个错误状态的源头——调度器的准入计数：

- `active: boolean` → `activeCount: number`，`pump()` 由「发一个就 return」改为「在 `activeCount < MAX_CONCURRENT` 时持续投放」。
- `finish()` 由 `active = false` 改为 `activeCount -= 1` 后立即 `pump()` 补位。
- 删除 `pump()` 首行的 `if (active) return` 早退。

保留了原有的全部正确性设施：`key` 去重、`Consumer` 集合多消费者共享、`AbortSignal` + `isCurrent` 的 `currentConsumers()` 清理、`jobs` Map 的双处清理、`abort` 时从 `pending` 摘除、优先级升序 + sequence 升序排序。

## 并发上界的依据

`MAX_CONCURRENT = 4`，理由已写进源码注释：

1. `src-tauri/src/audio/cover_pixels.rs` 的解码许可为 `(available_parallelism() / 4).clamp(1, MAX_PLAYLIST_DECODE_PERMITS)`，而 `MAX_PLAYLIST_DECODE_PERMITS = 4`。前端投放超过 4 个请求**不能**启动更多解码，只会加深后端队列，反而延迟优先级 0 的当前曲目工作——那正是优先级排序要加速的对象。
2. 单次解码在 Lanczos3 缩放阶段已吃满一个核，4 路在飞足以填满解码槽位且不会在小机器上超额订阅。
3. 常驻封面内存由 `useLibraryArtwork` / `useAllSongsWindow` 的字节预算独立约束，宽度不改变稳态内存；只放大暂存在飞像素缓冲（上界 4 × 512 × 512 × 4 B = 4 MiB）。

本模块同时管辖 `scheduleTrackThumbnail` 与 `schedulePlaylistCoverPixels` 两条 lane，所以上界是全进程封面像素请求的统一上界。

## 修改文件

- `src/features/player/services/playlistCoverScheduler.ts`：`active` → `activeCount`，新增导出常量 `MAX_CONCURRENT`，`pump()` 改为多槽投放并保持每次重排优先级。
- `src/features/player/hooks/useAudioPlayer.ts`：`PLAYLIST_ARTWORK_INFLIGHT_BUDGET` 由 `2 * 512 * 512 * 4` 改为 `MAX_CONCURRENT * 512 * 512 * 4`，并从调度器导入常量。
- `src/features/player/services/playlistCoverScheduler.test.mjs`：重写为并发证明测试（13 例）。
- `src/features/player/components/allSongsCoverCache.browser.test.mjs`：`maxActive === 1` → 有界区间断言。
- `src/features/player/components/playlistCoverPreload.browser.test.mjs`：3 处串行断言改为有界断言，并同步在飞内存预留。
- `src/features/player/components/playlistDockCoverWindow.browser.test.mjs`：`maxNative === 1` → `<= 4`。
- `src/features/player/components/allSongs.browser.test.mjs`：2 处以「gate 里恰好 1 个 held 请求」表达的串行断言改为 `>= 1` / `<= 4`。

未改动 `src-tauri/**`（由 rust-perf 并行改造），未改动两个 hook 的 `CONCURRENCY` / `WINDOW_CONCURRENCY`。

### 关于在飞内存预留

把宽度提到 4 之后，`useAudioPlayer` 里按「2 路在飞」写的 `PLAYLIST_ARTWORK_INFLIGHT_BUDGET` 会让字节准入上界少算真实暂存内存（该预留直接参与 `committedBytes + reservedWarmBytes + bytes + INFLIGHT > RESIDENT` 的拒绝判定）。因此改为由 `MAX_CONCURRENT` 推导，使预留与实际宽度始终一致。预留下限不变为 2 路时的 2 MiB，现在为 4 MiB，占 96 MiB 预留预算的约 4%。

## 优先级语义

每次 `pump()` 调用开头对 `pending` 重排（`priority` 升序，再 `sequence` 升序）。因此：

- 高优先级插队：任一 job 完成释放槽位即触发 `pump()`，此时重排会把新到达的 priority 0 放到已排队的 priority 1/2 之前，**不需要**先等整批在飞任务排空。这比「批处理式」实现更严格地保持了「高优先级能插队」的语义。
- 批内顺序：一次 `pump()` 投满 4 个槽位时，4 个都按同一排序取，仍遵守优先级。

## 验收标准检查

| 验收标准 | 结果 |
| --- | --- |
| `active: boolean` → `activeCount` + `MAX_CONCURRENT` | 通过 |
| `pump()` 一次投放多个 job（`while (activeCount < MAX_CONCURRENT && pending.length)`） | 通过 |
| `finish()` 计数递减后立即补位 | 通过 |
| 每次 `pump()` 重排优先级 | 通过（保留原排序，置于 `pump()` 开头） |
| `MAX_CONCURRENT` 3~4 且有注释说明理由 | 通过（取 4，与后端 `MAX_PLAYLIST_DECODE_PERMITS` 对齐） |
| 保留 AbortSignal / isCurrent / 多 consumer 共享语义 | 通过（`currentConsumers()` 未改） |
| 全部 consumer abort 时在飞 job 继续完成且不报错 | 通过（`consumer.abort` 仍不触碰 `job.active`，新增用例覆盖） |
| `jobs` Map 不泄漏 | 通过（`finish`/`abort` 两处 `jobs.delete` 未改，新增用例验证同 key 可再次投放） |
| 新增并发证明测试：峰值 > 1 且 <= MAX_CONCURRENT | 通过 |
| 新增测试断言优先级仍被尊重 | 通过 |
| `npm run lint` | 通过（exit 0） |
| `npx tsc -b --noEmit` | 通过（exit 0） |
| 相关前端测试全绿 | 通过（21 个非浏览器测试文件，176 例全绿） |

## 验证

### 命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | exit 0，无输出 |
| `npx tsc -b --noEmit` | exit 0 |
| `node --test` 全部 21 个非浏览器前端测试文件 | `tests 176 / pass 176 / fail 0` |
| `node --test src/features/player/services/playlistCoverScheduler.test.mjs` | `tests 13 / pass 13 / fail 0` |

### 并发证据（修复前 / 修复后对比）

用同一夹具脚本驱动真实调度器，stub 掉 `audioCommands` 的原生边界并统计在飞峰值。负载形状固定：24 个 priority 2 请求 + 迟到的 1 个 priority 1 + 1 个 priority 0。

| 指标 | 修复前（`HEAD` 单通道） | 修复后 | 结论 |
| --- | --- | --- | --- |
| 观测峰值并发 | **1** | **4** | 端到端 4× |
| 投满后立刻在飞数 | 1 | 4 | 一次 `pump()` 填满全部槽位 |
| 总请求数 | 26 | 26 | 无重复、无丢失 |
| 前 8 个准入顺序 | `bg-0`, `current`, `visible`, `bg-1`… | `bg-0..3`, `current`, `visible`, `bg-4..5` | 见下 |

修复后的前 4 个是投满首批槽位的 background 工作，第 5、6 个即 priority 0 的 `current` 与 priority 1 的 `visible`——它们在首个槽位释放时立刻插到剩余的 20 个 priority 2 之前。修复前虽然也把 `current` 排到第 2，但那是因为整条流水线只有 1 个槽位、每完成一个就重排一次，代价是没有并行度；修复后插队语义在「有并行度」的前提下依然成立。

### 反向验证（关键）

把新测试跑在**旧实现**上（临时还原 `HEAD` 的调度器）：

```
tests 13 / pass 2 / fail 11
```

11 例失败，包括并发峰值、补位、优先级插队、去重、abort、失败释放槽位等。通过的 2 例是与实现无关的守卫（「全部 consumer abort 后 job 仍完成」和「key 释放后可重新投放」）。这证明新测试确实绑定了并发行为，而不是只做了同义改写。

### 测试覆盖的语义清单

`playlistCoverScheduler.test.mjs` 现在覆盖：

1. 上界存在且等于 4（防退化）。
2. 峰值 > 1 且 == `MAX_CONCURRENT`，全程不越界。
3. 一个完成后同回合补满，不留空槽。
4. 两条 lane（track / cover）共享同一有界池。
5. priority 0 → priority 1 → priority 2 的准入顺序。
6. 迟到的 foreground 越过已排队的 background。
7. 已取消 / 已陈旧（`isCurrent` 返回 false）的排队 consumer 不触达原生边界。
8. 同 key 去重共享一次 invoke，且可被提升为 foreground。
9. abort 单个 consumer 不导致提前启动另一个原生加载。
10. 全部 consumer 都 abort 时，在飞 job 仍完成、不 reject、不重复发起。
11. 原生失败 reject 其 consumer 且后续工作与重试仍可用。
12. 连续失败不缩窄通道（每个 rejection 都归还槽位）。
13. `jobs` Map 释放每个 key，已完成 key 可重新投放。

### 未能在本环境运行的验证

`*.browser.test.mjs`（含本轮修正的 4 个文件）需要 Playwright + 本地 Vite dev server，本机 `node_modules` 中没有 `playwright` / `@playwright/*`，因此**未执行**。对这些文件的改动是把「串行」断言改成「有界」断言，属于契约同步；其运行时结论未经本环境验证。详见「风险 / 备注」。

## 风险 / 备注

1. **浏览器端测试未执行**：`allSongs.browser.test.mjs`、`allSongsCoverCache.browser.test.mjs`、`playlistCoverPreload.browser.test.mjs`、`playlistDockCoverWindow.browser.test.mjs` 的改动未经运行验证。建议由具备 Playwright 环境的一方（Test Agent）在合并前执行。风险点：这些用例在宽度 4 下是否仍满足各自的时序假设（例如 gate 填充数量、渲染次数不变式）未经观测。
2. **与后端宽度的耦合**：`MAX_CONCURRENT = 4` 是**按当前** `MAX_PLAYLIST_DECODE_PERMITS = 4` 推导的。若 rust-perf 把该常量进一步上调，前端应同步复核；若下调到 2，前端保持 4 会让后端队列变深（不致命，但会削弱优先级插队的收益）。
3. **小机器上的取整效应**：`available_parallelism() / 4` 在 4 核机上为 1。此时前端 4 路在飞会让后端排队，实际并行度仍为 1。这是有意的保守取舍——前端不做运行时探测，因为后端许可数不是前端可观测契约。
4. **`playlistDockCoverWindow.browser.test.mjs` 的断言放宽**：`assert.equal(stats.maxNative, 1)` → `<= 4`。该用例原本用它间接证明「dock 遮挡的物理视口被当作 required 需求」；剩下的 `requests < count/2`、`windowCount < count/2` 与 `fullHydrates === 0` 仍守住该意图，但「恰好 1 路」这一强断言消失了。若后续需要更精确的上界观测，应改为断言「在飞 ≥ 2 且 ≤ 4」。
5. **未改 hook 并发**：按任务约束保留 `CONCURRENCY = 2` / `WINDOW_CONCURRENCY = 2`。调度器上界现在是 4，两个 hook 合计最多提供 4（2+2），刚好填满；`useAudioPlayer` 的补水泵另有 2 路，三者共存时会在调度器入口排队——这正是有界排队该有的行为。若后续实测首屏仍受 hook 宽度限制，再单独评估提高 hook 并发。
6. **缓存命中不受影响**：本改动只调整未命中时的投放宽度，命中路径（`useLibraryArtwork` / `useAllSongsWindow` 的 `runtime.cache`）未变，因此「常驻封面不重复读」的既有保证不变。
