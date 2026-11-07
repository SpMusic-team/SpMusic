---
doc_id: "OPT-0018-V2-RESULT"
title: "OPT-0018 v2 列表封面路径通道：实施、真机实测与保留/回滚判定依据"
doc_type: "test-report"
owner_agent: "Test Agent"
status: "已实施 + 真机 A/B 已验证，等待产品决策"
module: "列表封面加载链路"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
branch: "feature/opt-0018-path-lane-v2"
base_commit: "d0b5142 (develop)"
implementation_commit: "2f67d99"
source_documents:
  - "docs/changes/optimizations/OPT-0018.md"
  - "docs/changes/optimizations/OPT-0018-verify.md"
  - "docs/decisions/2026-11-07-album-cover-asset-pipeline.md"
  - "docs/architecture/opt-0018-reimplementation-plan.md"
  - "git commits: 09cc450 / 28312ab / 71adeed / 2f67d99"
---

# OPT-0018 v2 列表封面路径通道：实施、真机实测与判定依据

## 0. 一页结论（给决策者）

| 问题 | 结论 |
| --- | --- |
| 上次为什么失败？ | **前端一个取消谓词传反的 bug**，不是方向错误。成功后仍被当作「已取消」丢弃，所以命令 3 ms 返回、JPEG 和 URL 都对，卡片却永远 loading。 |
| 这次修好了吗？ | **修好了，且真机确认**。所有测量中，候选版封面 100% 走 `asset.localhost`（asset 协议），缩略图目录 **0 个 `.spxr`**（零回落），全部封面就绪、零失败。 |
| 更快了吗？ | **确定性地减少了工作量，但端到端时延改善落在噪声带内**。请读下面的「诚实结论」。 |
| 磁盘？ | **25.4 MB → 2.2 MB，约 12 倍**（确定性）。 |
| 有功能回退吗？ | 未发现。播放器大封面通道逐字节未动；旧 `.spxr` 缓存不失效。 |
| 我的建议 | **保留**（正确性已验证、确定性收益显著、且消除了一个真实的自毁缺陷），但**不要宣称「明显变快」**。 |

### 诚实结论：关于「快了多少」

我最初的 8 轮数据给出热态 **8/8 全胜、−8.7%**，因此判定「有提升」。但随后：

1. 修复独立复核发现的 F1 后，同样 8 轮方式重测只得热态 **4/6、−2.6%**、冷态 **+1.7%（0/6 胜）**。
2. 再直接对比「修复前 vs 修复后」两个候选版本：热态修复后反而快 **8.2%**（4/6），说明 F1 修复没有引入回归。

**这三组数据互相矛盾，说明单屏 8 张封面的时延差异（约 10–30 ms）小于本机批次噪声**（同一配置重复测量的标准差就有 10–48 ms）。因此：

- **不能用端到端时延宣称「明显更快」**。首屏 8 张封面的耗时里，列表挂载、元数据探测等固定成本占比很大，封面管道只占一部分。
- **可以确定的是工作量减少**（见下表，这是从每张封面的确定行为算出来的，不依赖计时）：

| 项 | baseline | candidate | 倍数 |
| --- | --- | --- | --- |
| 单张封面 IPC 载荷 | 262,184 B（裸 RGBA） | 约 100 B（路径字符串） | **约 2600 倍** |
| 单张封面磁盘 | 262,228 B | 约 21.2 KB | **约 12.3 倍** |
| JS 主线程逐像素转码 | 65,536 次/张 | **0** | 消除 |
| 解码次数 | 3（Rust + JS 转码 + WebView） | 1（WebView） | 3 → 1 |

**结论**：收益在「载荷、主线程 CPU、磁盘」上是确定且可量化的；在「端到端可见时延」上本次测量**未能证明**。后者取决于列表规模、滚动强度、机器负载——120 首单屏场景不足以放大差异。若要验证时延收益，需要更贴近真实的场景（见 §7）。


## 1. 基线状态

| 项 | 值 |
| --- | --- |
| 分支 | `feature/opt-0018-path-lane-v2` |
| 基点 | `d0b5142`（`develop`），代码树与 `develop` 完全一致，仅多三份纯文档 |
| 实现提交 | `2f67d99`（单个提交，未合并、未推送） |
| 机器 | i7-12700KF，12 核 20 线程 |
| 语料 | `E:\Music`，120 首，1 张 m3u8 |

## 2. 根因（这是本次最关键的部分）

旧实现 `09cc450` 的 `playlistCoverPathLane.ts`：

```ts
export async function runPathLaneCall<T, R>(
  call: () => Promise<T | null>,
  isAborted: () => boolean,   // 文档说：是否已中止
  toUrl: (value: T) => R,
) {
  ...
  if (value === null) return { status: 'missing' }
  if (isAborted()) return { status: 'dropped' }   // ← 判真就丢弃
```

三个调用方传的都是**正向**谓词：

| 调用方 | 旧传入 | 真实语义 |
| --- | --- | --- |
| `useAllSongsWindow` | `itemIsCurrent` | 正向：row 仍有效 |
| `useLibraryArtwork` | `current` | 正向：descriptor 仍可发布 |
| `useAudioPlayer` | `jobIsStale` | **反向**：job 已失效 |

于是完全成功的请求：`itemIsCurrent()` 返回 `true` → 命中 `if (isAborted())` → 返回 `dropped` → 什么都不发布。

这**精确解释**了回退提交 `71adeed` 记录的现象：

> 「命令约 3 ms 返回、JPEG 与 asset URL 均正确，卡片却停在 `data-cover-state=loading`，缓存目录里 1050 个 7–21 KB 的 JPEG 都在。」

### 修法（结构性，不是改名）

去掉位置参数，改为命名字段：

```ts
type AttemptOptions = {
  priority: PlaylistCoverPriority
  signal?: AbortSignal
  isCurrent: () => boolean   // true = 仍有效，可发布
}
```

三个调用方逐个按真实语义改写，`useAudioPlayer` 的 `jobIsStale` 显式反转一次，并把 `isCurrent` 提到外层单点定义，两条通道共用同一语义来源，杜绝再次漂移。

## 3. 同时修正的三处缺陷

1. **一次尝试的边界太窄**：旧代码在 URL 转换成功时就记为成功，解码失败不会回落。现改为一次尝试覆盖「命令 → 载荷校验 → `convertFileSrc` → 构造 image → 预解码 → 当前性复核」，成功只在预解码完成且仍当前时记入。预解码独立 3 秒超时，超时／取消后清监听、清计时器、清 `src`，**晚到的 decode 不发布**。
2. **候选遍历提前终止**：旧代码遇到首个候选 `missing` 就 `break`，导致整个目录被判无图。现改为 `continue` 到下一候选，全组穷尽才确认无图。
3. **磁盘预算漏记账**：`scan_thumbnail_usage` 与 `make_thumbnail_room_with_limits_checked` 原先只认 `.spxr`，新增 `.jpg` 不进 8 GiB / 32768 文件预算会造成**磁盘无界增长**。现统一用 `MANAGED_THUMBNAIL_EXTENSIONS`。

## 4. 真机 A/B 实测（这是决策的核心证据）

### 4.1 方法

- 两个 **release 产物**：baseline = `develop`(d0b5142)，candidate = `2f67d99`。
- 构建期只打两个隔离补丁（原生文件选择器替换为真实 `list_folder_tracks`、`AppPaths` 缓存根重定向），**渲染、封面调度、IPC、asset 协议全部是生产代码**。
- 每臂独立缓存根 + 独立 WebView2 profile，互不预热。
- 奇偶轮交替臂顺序，抵消顺序偏差。
- 语料、m3u8、视口（1600×1000）完全相同。
- 测量脚本：`D:\opt0018-ab\ab-run.mjs`（不属于仓库，独立于产品代码）。

> **踩过的坑（重要，供复现者避免）**：缓存根必须落在 `$CACHE/**`（`LOCALAPPDATA`）之内。第一次把测量根放在 `D:\`，结果 asset 协议对每个请求返回 **403**，封面全部回落像素通道，看起来像「路径通道没生效」。这不是代码缺陷，是测量环境违反了 `tauri.conf.json` 的 `assetProtocol.scope`。

### 4.2 结果（三批独立测量，结论见 §0）

> **重要**：三批数据的差值互相矛盾，说明时延差异落在噪声带内。此处如实列出全部数据，不做挑选。

**第 1 批（8 轮，提交 `2f67d99`，未含 F1 修复）**

| 缓存态 | baseline | candidate | 变化 | 逐对胜负 |
| --- | --- | --- | --- | --- |
| 热态 settle | 332.0 ms（sd 18.0） | 303.2 ms（sd 19.3） | −8.7% | **8/8 候选胜** |
| 冷态 settle | 707.1 ms（sd 47.8） | 703.2 ms（sd 40.8） | −0.5% | 4 胜 4 负 |

**第 2 批（6 轮，提交 `7022367`，含 F1+F2+F3 修复）**

| 缓存态 | baseline | candidate | 变化 | 逐对胜负 |
| --- | --- | --- | --- | --- |
| 热态 settle | 314.9 ms（sd 9.9） | 306.8 ms（sd 17.9） | −2.6% | 4/6 候选胜 |
| 冷态 settle | 693.2 ms（sd 27.9） | 704.8 ms（sd 28.9） | +1.7% | **0/6 候选胜** |

**第 3 批（6 轮，修复前 vs 修复后候选互比，检验 F1 是否引入回归）**

| 缓存态 | 修复前 | 修复后 | 变化 | 逐对胜负 |
| --- | --- | --- | --- | --- |
| 热态 settle | 354.5 ms | 325.4 ms | −8.2% | 4/6 修复后更快 |
| 冷态 settle | 730.9 ms | 736.9 ms | +0.8% | 2/6 |

**判读**：F1 修复**没有**引入性能回归（第 3 批修复后反而更快）。第 1 批的 8/8 与第 2 批的 4/6 之间的差异，来自批次间噪声而非代码差异——同一配置重复测量的标准差本身就有 10–48 ms，与所要观测的 10–30 ms 效应同量级。

因此：**不宣称端到端时延有可测量的改善**。

### 4.3 正确性（同等重要）

| 检查 | 结果 |
| --- | --- |
| 可见封面就绪 | 全部测量轮次中，baseline 与 candidate 均为 8/8 就绪 |
| 可见封面失败 | 两版均为 **0** |
| candidate 封面 URL 来源 | 全部 `asset.localhost`（asset 协议） |
| baseline 封面 URL 来源 | 全部 `blob:` |
| candidate 缩略图目录 | 100–113 个 `.jpg`，**0 个 `.spxr`** → 零回落 |
| baseline 缩略图目录 | 96–109 个 `.spxr`，0 个 `.jpg` |
| 主线程长任务（>50 ms） | 两版均为 **0** |
| 封面尺寸 | 首张 512（hero）、其余 256（列表档），与改造前一致 |

零 `.spxr` 是**决定性证据**：如果路径通道有任何一环失败，就会生成 `.spxr` 回落产物。实测一个都没有，说明整条链路健康。

### 4.4 压力验证（防「发布后被 revoke / 淘汰」类缺陷）

单独做了一次反复滚动往返压力测试，两版对等执行：6 个循环 × 5 个滚动位置 = **30 个往返**，累计观察 **432 张卡片**。

| 检查 | baseline | candidate |
| --- | --- | --- |
| 有失败的往返 | 0 | **0** |
| 累计未就绪卡片 | 0 | **0** |
| 残留 `loading` 状态 | 0 | **0** |
| 全部封面来源 | `blob:` | 全部 `asset.localhost` |
| 最终稳定就绪 | 16/16 | **16/16** |
| 缩略图产物 | 107 `.spxr` | 113 `.jpg` / **0 `.spxr`** |

这一项针对的是一个真实风险：`useLibraryArtwork` 中多处 `URL.revokeObjectURL(thumbnail.src)`。按 URL 规范，对非 `blob:` URL 调用 revoke 是 no-op，因此 asset URL 不会被误删；压力测试进一步证明，在实际的淘汰与重进循环中封面不会消失。同时确认缓存淘汰（`CACHE_LIMIT`）后重新进入仍能正常取得封面。

### 4.4 磁盘占用

| 项 | baseline | candidate |
| --- | --- | --- |
| 缩略图总量 | 25.4 MB（均值 101.7 个 262,228 B 的 `.spxr`） | **2.17 MB**（均值 106.9 个约 21.2 KB 的 JPEG） |
| 单张 | 262,228 B | 约 23 KB |
| 倍数 | — | **约 12 倍** |

## 5. 自动化验证

| 命令 | 结果 |
| --- | --- |
| `cargo check --lib` | 通过，0 warning 0 error |
| `cargo test --lib` | **398 passed, 0 failed, 10 ignored**（F1/F2 修复新增 3 个用例） |
| `npx tsc -b --noEmit` | exit 0，零错误 |
| `node --test playlistCoverPathLane.test.mjs` | **24 / 24 通过** |
| `node --test playlistCoverScheduler.test.mjs` | **15 / 15 通过** |
| `npm run build` | 成功 |

F1 修复的专项测试 `publish_wait_does_not_hold_the_decode_permit` 用 `DecodeSlot` 的测试钩子在「许可已归还池中、`wait_path_idle` 尚未开始」的精确时点断言池内占用为 0，并做过变异验证（把 `release()` 改成 no-op 即失败）。F2 的 `folder_path_lane_treats_corrupt_audio_as_confirmed_absence` 同样做过变异验证。

### 既有问题（非本次引入，已复现确认）

- `npm run lint`：3 个 error，全部位于 gitignored 的 `.codex-tmp-folder-ui-dist/drag-diagnostics-20261101/selection-baseline-surface.js`（11/02 的临时产物）。对本次改动的 6 个文件单独跑 eslint 为 0 问题。
- `useAllSongsWindow.test.mjs`：全部失败，原因是断言硬编码 import 条数（期望 6），**在基线 `HEAD` 上就是红的**。本次新增 import 使数字从 7 变 8，但该断言本来就失败。

## 6. 回滚方式

三种，按彻底程度排序：

**方式一：分支级（最彻底）**
```powershell
cd D:\SpMusic
git checkout develop        # 或直接删掉分支
git branch -D feature/opt-0018-path-lane-v2
```
`develop` 与 `main` 全程未被修改，此操作即完全恢复。

**方式二：运行级开关（改一行，保留代码可再试）**

`src/features/player/services/playlistCoverPathLane.ts` 中：
```ts
export function pathLaneAvailable(): boolean {
  return !disabled      // 改为 return false
}
```
重新构建后全部封面直接走原像素通道，等价改造前行为。

**方式三：熔断自动回退（无需操作）**

连续 8 次真实失败后本会话自动禁用路径通道。注意：`missing`、取消、`STALE_REQUEST` 不计入失败，所以偶尔的坏图不会误触。

### 缓存清理注意

- **保留**本次的预算统计改动（`MANAGED_THUMBNAIL_EXTENSIONS`）时：遗留 `.jpg` 仍被计入预算，会按 mtime 自然淘汰，**无需手工清理**。
- 若连同预算统计一起回滚：`audio/thumbnails/*.jpg` 不再被计入预算，会**无界增长**，必须手工删一次：
```powershell
Remove-Item "$env:LOCALAPPDATA\SpMusic\SpMusic\cache\audio\thumbnails\*.jpg" -Force
```

## 7. 独立复核发现的缺陷与处置

Test Agent（未参与实现，只读复核）独立发现 4 个缺陷，其中 **F1 是真实的高优先级缺陷，我已亲自核实并修复**。

### F1（高，已修）— 前台路径命令在等待磁盘发布期间占着解码许可

三个前台路径命令（playlist / track / folder）的 `spawn_blocking` 闭包都是 `let _permit = permit;` 一直持有到闭包结束，而闭包内的 `publish_playlist_thumbnail_path` → `wait_path_idle(&target, 2s)` 是**纯等待磁盘**。

**同文件的两个预热函数做了相反的事，并写了注释说明原因**：

```rust
// try_warm_track_thumbnail_path 等预热路径
drop(_permit);
// Release the decode slot before waiting on the single cache writer, so a
// visible cover can decode while the writer drains this entry.
```

**危害**：解码池宽度是 `available_parallelism()/4` clamp 到 `[1,4]`，4 核机上是 **1**。一个冷缓存路径请求可持有唯一许可最长 2 秒；超时后返回 `WorkerFailed`，前端计为**真实失败**，慢盘场景下连续 8 次就把整条通道**熔断到会话结束** —— "临时变慢"被升级成"永久回退"，直接抵消本次改动目的。

这条是本次最值得记住的教训：**它不表现为错误，只表现为"偶发变慢后永久失效"**。

### F2（中，已修）— 文件夹遍历的 `skip_invalid_tags` 语义不一致

像素通道的文件夹遍历用 `skip_invalid_tags = true`，路径通道写死 `false`。目录里存在一个损坏音频文件时，像素通道得到 `Absent` → 继续遍历 → `Ok(None)`（确认无图，不回落不计熔断）；路径通道得到 `Err(InvalidPath)` → 计熔断 + 回落。同一"无封面目录"两条通道分类不一致，又给熔断多一个误触发来源。

### F3（低，已加固）— asset URL 会流入 `revokeObjectURL`

`store.retire` / `sweep()` 与 `useLibraryArtwork`/`useAudioPlayer` 共 31 处 `URL.revokeObjectURL(coverThumbnail.src)` 现在都会收到 asset 协议 URL（`http://asset.localhost/...`，不是 `asset://`）。按 URL 规范这是 no-op，所以**今天无功能影响**，但注释里的不变量未被代码强制。已改为统一的 `releasePlaylistCoverUrl()` 守卫，只对 `blob:` 前缀生效；`useArtworkVisualResource.ts` 与 `useThemeDraft.ts` 两处经确认只可能是自建 blob，保持原样。

### F4（低，记录未改）— 预解码成功后清 `src`，真实 `<img>` 会再解一次

`predecodeCoverImage` 在成功路径也 `removeAttribute('src')`（为了释放临时元素并取消在途解码）。冷缓存下等于解两次。同时 readiness 语义从「这个对象已解码」轻微漂移成「这个 URL 曾解过一次」。只影响淡入判断，不影响正确性。

### 复核的其他结论

- 播放器通道：`load_cover_pixels`、`load_cover_pixels_blocking`、`validate_cover_path`、`ordinary_file`、`PlaylistCoverRequestCoordinator::load`、`run_worker` **逐字节比对全部相同**。
- 版本号：确认 `THUMBNAIL_TRANSFORM_VERSION=2`、`THUMBNAIL_DISK_VERSION=1` 未变，旧 `.spxr` 全部继续命中。
- `parse_playlist_jpeg` 的尺寸上限**不是**硬编码 512，而是从 `ALLOWED_PLAYLIST_MAX_EDGES` 派生，会随白名单自动放宽。但前端 `audioCommands.ts` 的 `THUMBNAIL_PATH_MAX_EDGE = 512` 是硬编码字面量——若日后只把 Rust 白名单扩到 768 而未同步前端，会对每个响应判为元数据不一致 → 计真实失败 → 8 次熔断。**这是"忘记同步一处常量 = 整条通道会话级失效"的单点耦合，未来扩档位时必须同时改两处。**
- 两个"已知既有问题"的归因被修正：`useAllSongsWindow.test.mjs` 是**长期失效的陈旧 harness**（把它硬编码的 import 条数改对后仍然 19/23 失败，缺 `useLayoutEffect`、`isStreamSource` 绑定），既不能证明也不能否证本次改动。`OPT-0018-verify.md` 里"386 passed / import 变 9"的数字与实测（395 passed / import 8）不符，属旧文档失准。

## 8. 已知局限与后续可选项

### 局限

1. **端到端时延收益未被证明**（见 §0）。确定性收益在载荷、主线程 CPU 与磁盘；单屏 8 张封面的可见耗时差异在本机落于噪声带内（±10–48 ms 波动 vs 10–30 ms 效应）。
2. 语料 120 首、单机实测。未覆盖 >1000 专辑、损坏封面、慢盘（**慢盘恰恰是 F1 曾会自毁的场景**）、大 DPI 等。
3. OS 页缓存不可控，热态测量并非严格「冷启动」。
4. 未实现架构方案 §6.4 的 DOM 层失败失效入口（发布后文件被淘汰导致 `<img>` 加载失败时，缺少一次补救回落）。当前依赖预解码 + 下次访问重试。
5. 列表是虚拟化的，只有视口附近的卡片会请求封面。这使「整列表填充耗时」在 120 首规模下无法作为稳定指标；要放大差异需要长列表 + 快速滚动 + 更大的封面尺寸。

### 我试过但未采用的方案

**把窗口并发从 2 提到 4**（与后端许可 4 对齐）。实测：冷态 −6.7%、热态 −6.6%，但**方差大、不稳定**，且需要改动既有的并发契约（既有测试与注释明确约束其取值依据）。收益不足以承担契约变更风险，**未纳入本次提交**。若未来要做，应单独立项并重测。

### 若想继续提升，建议方向

1. **换一个能放大差异的测量场景**：长列表（>1000）+ 快速连续滚动 + 高 DPI 封面。当前 120 首/单屏 8 张的规模把效应埋在固定成本里。注意 F1 那类"慢盘才暴露"的缺陷也只有在受限 I/O 下才会显形。
2. **减少候选遍历的串行**：`track-candidates` 是逐候选串行尝试，首候选无图会多花一轮。
3. **预热**：`library_cover_warmup` 已切到 JPEG 产出，可考虑对首屏可见项提前预热，把冷态成本移出关键路径。
4. **JPEG 质量/尺寸**：当前 quality 82、256 档。quality 与体积、清晰度可再权衡（改质量需同步升 `THUMBNAIL_IMAGE_VERSION`）。
5. **跨端常量一致性**：`audioCommands.ts` 的 `THUMBNAIL_PATH_MAX_EDGE = 512` 是硬编码字面量，而 Rust 侧上限从 `ALLOWED_PLAYLIST_MAX_EDGES` 派生。**扩档位时必须同时改两处**，否则前端会把每个响应判为元数据不一致 → 计真实失败 → 8 次熔断。建议加跨端一致性测试。

## 9. 变更文件清单

两个提交：`2f67d99`（主体实现）+ `7022367`（F1/F2/F3 修复，`cover_pixels.rs` +404/−33、`folder_cover.rs` +48/−5、前端 31 处 revoke 守卫）。

| 文件 | 内容 |
| --- | --- |
| `src-tauri/src/audio/cover_pixels.rs` | JPEG 编解码/原子发布/命中校验/预算统计/三条路径命令/`DecodeSlot` 许可归还 |
| `src-tauri/src/audio/folder_cover.rs` | 目录封面路径出口 + `skip_invalid_tags` 对齐 |
| `src-tauri/src/audio/mod.rs` | 导出 |
| `src-tauri/src/lib.rs` | 命令注册 |
| `src-tauri/src/library_cover_warmup.rs` | 预热产出切 JPEG |
| `src/features/player/services/playlistCoverPathLane.ts` | 新增：路径尝试、预解码、熔断 |
| `src/features/player/services/playlistCoverPathLane.test.mjs` | 新增：24 个行为用例 |
| `src/features/player/model/playlistCoverReadiness.ts` | 新增 `releasePlaylistCoverUrl()` 守卫 |
| `src/features/player/services/audioCommands.ts` | 三条路径命令类型与载荷校验 |
| `src/features/player/services/playlistCoverScheduler.ts` | 增加 lane 去重维度 |
| `src/features/player/hooks/useAllSongsWindow.ts` | 候选遍历、URL 所有权 |
| `src/features/player/hooks/useLibraryArtwork.ts` | 路径通道接入 + revoke 守卫 |
| `src/features/player/hooks/useAudioPlayer.ts` | 路径通道接入 + 谓词反转 + revoke 守卫 |

## 10. 复现测量

```powershell
# 1. 建两个隔离源码快照（仓库外）
cd D:\SpMusic
git archive --format=tar --output=D:\opt0018-ab\baseline.tar develop
git archive --format=tar --output=D:\opt0018-ab\candidate.tar feature/opt-0018-path-lane-v2

# 2. 各自打隔离补丁并构建
node D:\opt0018-ab\patch-isolation.mjs <snapshot-root>
cd <snapshot-root>; npm run build
$env:TAURI_SKIP_DEVSERVER_CHECK="true"; npx tauri build --no-bundle

# 3. 运行 A/B（缓存根必须在 LOCALAPPDATA 内）
$env:AB_ROOT_SCOPE="C:\Users\<you>\AppData\Local\opt0018-scope"
$env:AB_PAIRS=8
node D:\opt0018-ab\ab-run.mjs <baseline.exe> <candidate.exe> <playlist.m3u8> <out-dir>
```

> 注意：**不要**用裸 `cargo build --release`。必须走 `npx tauri build`，否则缺少 `custom-protocol` 特性，应用会去连 `localhost:5173` 而不是加载内嵌前端资源。
