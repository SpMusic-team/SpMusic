# owner 并发实验：并发 2 vs 3 vs 4（基线 3847bcc）

> **结论：并发提高没有带来改善，实验撤回。** 未合入 develop，产品改动已还原。
> 本文件交付：架构审查结论、单变量实验、探索数据、以及为什么撤回。

## 0. 结论先行

| 项 | 结果 |
| --- | --- |
| 并发 2（基线） | 补齐 688 / 710 / 730 ms |
| 并发 4（实验） | 补齐 730 / 733 / 748 ms |
| **差异** | **无改善**（实验臂平均还略慢 28 ms，在噪声内） |
| 实测 peak in-flight | **两者都恒为 2**，即使上限已提到 4 |
| 判定 | **撤回**，不实施 |

**关键发现**：把上限从 2 提到 4 后，**实际 peak in-flight 仍然是 2**——说明这个常量不是实际起作用的约束。

## 1. 架构审查：先解决了"改哪个文件"

审查指出一个会决定实验成败的陷阱：测试用 `.m3u8`，`.playlist-panel` 的 workset 由 `isBrowsingActive` 在**两个 owner** 之间切换：

| 入口 | owner | 并发常量 |
| --- | --- | --- |
| `isBrowsingActive` 真 | `useAudioPlayer` | 硬编码 `< 2`（`useAudioPlayer.ts:2179`） |
| `isBrowsingActive` 假 | `useLibraryArtwork` | `CONCURRENCY = 2`（`:94`） |

**实测判定归属**（用 clientId 前缀区分：`library-artwork-*` / `all-songs-*` / 裸 UUID）：

| owner | 实测请求数 |
| --- | --- |
| `useAudioPlayer`（裸 UUID） | **41** |
| `useLibraryArtwork` | **0** |
| `useAllSongsWindow` | **0** |

**因此本次实验改的是 `useAudioPlayer`**。如果按最初设想改 `useLibraryArtwork`，会得到一个"干净但没有意义"的假阴性。

审查同时确认的四条正确性链路（并发 3/4 下均成立）：

| 检查项 | 结论 |
| --- | --- |
| 取消（`AbortSignal` + 每次 await 后 `isCurrent` 复查） | 正确；唯一退化是 abort 后"已在路上"的残留作业从 ≤2 变 ≤3/4，只影响请求计数口径 |
| 旧结果隔离（`windowGeneration` / `artworkRevision` / `desired.has`） | 守卫齐全，并发不改变其充分性 |
| 恢复次数（`claim` 同步 + `begin` 唯一消费点） | 不被破坏；并发越高反而更快排空 recovery 队列 |
| 资源释放（`active` / `queued` / object URL 全在同一 `finally` 配平） | 与并发无关，每 job 独立计数器 |

## 2. 单变量实现

只改一处，用构建期常量替换硬编码字面量：

```ts
// src/features/player/hooks/useAudioPlayer.ts
const PLAYLIST_VISUAL_HYDRATION_CONCURRENCY = (() => {
  const raw = import.meta.env?.VITE_OWNER_CONCURRENCY
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 2
})()
// pump 里：playlistVisualHydrationActiveRef.current < PLAYLIST_VISUAL_HYDRATION_CONCURRENCY
```

未改动：全局调度器 `MAX_CONCURRENT = 4`、后端许可、预取范围、渐入动画、缓存策略、`MAX_RESIDENT`/`MAX_DETAIL`。

三个构建产物：

| 版本 | SHA-256 |
| --- | --- |
| 并发 2 | `6668185C67AB1F9B9117C2934FBC5C61572CDD1339B7AA24628C8236FFDE4F0B` |
| 并发 3 | `A86DC58539B2AFEC25940A37F351D031E4079358ACC8F1A2B37D21F24C2854FD` |
| 并发 4 | `921B79A383FBA77F7C390BA4798F12C63587F9CD2DD3017F8356796AEB73E732` |

**已验证常量确实内联进产物**（`VITE_OWNER_CONCURRENCY` 在构建后被消除，产物中出现 `Bn=4` 且 pump 循环使用 `Ta.current<Bn`）。

## 3. 探索数据（同一全屏小卡片场景）

条件：2560×1440、level 2（四列 110px 封面）、落点 `scrollTop=1047`、冻结 78 个目标、连续两帧判定。

| 运行 | 并发 | 补齐全部 | 补齐 90% | peak in-flight | 中位请求间隔 | 中位请求耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| r1 | 2 | **688 ms** | 526 ms | 2 | 9 ms | 2 ms |
| r1 | 4 | **730 ms** | 557 ms | 2 | 6 ms | 6 ms |
| r1b | 2 | **710 ms** | 538 ms | 2 | 6 ms | 2 ms |
| r1b | 4 | **733 ms** | 570 ms | 2 | 8 ms | 2 ms |
| r2 | 2 | **730 ms** | 561 ms | 2 | 9 ms | 3 ms |
| r2 | 4 | **748 ms** | 579 ms | 2 | 7 ms | 3 ms |

- 三对重复，**并发 4 每次都略慢**（+28 ms 量级），在噪声内；
- **松手时空白比例三次运行完全一致（0.282）**，说明场景复现良好；
- **peak in-flight 恒为 2**。

## 4. 为什么没效果（实测依据，非推断）

判定规则预先写在探针里：把「相邻请求的起始间隔」与「请求自身耗时」相比。

| 观察 | 数值 | 含义 |
| --- | --- | --- |
| 中位请求间隔 | 6–9 ms | |
| 中位请求耗时 | 2–6 ms | |
| 关系 | **间隔 ≥ 耗时** | 泵在等**新的作业出现**，不是在等槽位空出 |

也就是说：**队列里同时可用的作业从来没有超过 2 个**，所以把上限提到 3 或 4 不会被触发。真正的约束在**作业的产生速率**（需求集什么时候把这些行标记为 urgent），而不在在途上限。

这也解释了为什么 peak 恒为 2——不是上限在卡，而是**没有第 3 个作业可发**。

## 5. 撤回决定

按你设定的规则（无改善就撤回）：

- **不实施**，产品改动已还原；
- **不合入 develop**；
- 探索数据不并入任何正式结果（本来也没有正式 20 对，因为探索阶段就没出现有利趋势）。

### 未进行的两项（因探索已判定无趋势而跳过）

- 并发 3 的完整对照（2 vs 4 已无差异，3 介于两者之间，不改变结论）；
- 独立 Test Agent 验证与 20 对正式比较（仅在出现有利趋势时才需要，本次未出现）。

## 6. 这次实验真正得到了什么

1. **归属结论（确定）**：`.m3u8` 列表场景下，封面请求由 `useAudioPlayer` 发出，`useLibraryArtwork` 为 0 次。这纠正了我此前"改 useLibraryArtwork"的错误设想，也说明**以后所有针对列表封面的调度实验都必须改 `useAudioPlayer`**。
2. **否定结论（确定）**：在途上限 2→4 不是首次到达的约束。peak 恒为 2 且间隔 ≥ 耗时，两条独立证据一致。
3. **仍未知**：作业产生速率由什么决定（需求集何时把这些行标记为 urgent）、以及 200 ms 渐入之外的可见延迟构成。这两项需要新的埋点，超出本次授权。

## 7. 证据

根目录：`%LOCALAPPDATA%\spmusic-coverlane\ds-20261108-194254`

| 文件 | 内容 |
| --- | --- |
| `own1/ownership.json` | 归属实测（clientId 前缀分类 + peak in-flight） |
| `owc2/`、`owc4/` | 两个版本的归属复核 |
| `tm2/`、`tm4/`、`tr2-1/`、`tr4-1/`、`tr2-2/`、`tr4-2/` | 六次时序测量（补齐分位、peak、间隔、耗时） |
| `D:\opt0018-ab\probe-ownership.mjs` | 归属探针 |
| `D:\opt0018-ab\probe-timing.mjs` | 时序探针（含槽位/供应判定规则） |
| `D:\opt0018-ab\conc2\app.exe`、`conc3\`、`conc4\` | 三个构建产物（保留，便于复现） |
