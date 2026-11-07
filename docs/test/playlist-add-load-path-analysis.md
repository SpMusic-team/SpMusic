# 搜索页添加歌曲后「播放列表歌曲列表变慢」— 静态加载链路分析

状态：只读分析（未修改任何产品代码）
角色：Test Agent / reviewer
分析对象：工作区（HEAD = `ce65f67` 2026-10-30 + 未提交 WIP，20 modified / 多新增文件）
参考版本：`8f45750`（2026-10-25 feat(player): add audio visualization modes）

> 说明：下文 **VERIFIED** = 读代码可确认（给出 `file:line`）；**HYPOTHESIS** = 需要实测才能确认或否证。
> 「现在」一律指工作区文件（含 WIP）；与 `8f45750` 的差异用 `git show` / `git blame` 逐行核对。

---

## 0. 结论先行

1. **按版本对比这条路本身不成立**：`8f45750`（10-25）**完全没有「添加到播放列表」功能**。
   - `git show 8f45750:src/features/player/hooks/useAudioPlayer.ts` 中不存在 `addToPlaylist` / `addLibraryPlaylistTracks` / `onAddToPlaylist`（`-S"addToPlaylist" -- src` 只命中 `6a7da1b`）。
   - 同版本 `MoreActionsMenu.tsx` 的「播放列表」是 `<UnavailableAction icon={CirclePlusIcon} label={appCopy.moreMenu.playlist} />`；`PlaylistPanel.tsx` / `PlaylistLibraryPanel.tsx` 无 `onAddToPlaylist`。
   - **搜索页** `SearchPanel.tsx` 由 `9e8d41c`（10-30）新增，`8f45750` 不存在。
   - 因此「10-25 版本 vs 现在」只能得出：**该操作路径在 10-25 不存在**。路径最早存在于 `6a7da1b`（10-28，多选 + 添加到播放列表），「从搜索页添加」最早存在于 `9e8d41c`（10-30）。跨版本基线应取 `6a7da1b`（甚至 `336f14b`），**不能取 `8f45750`**。

2. **「追加到已存在列表」会把「整个列表的元数据缓存」一次性作废**，而不只是新增的那 k 行。这是「加完之后再打开就慢」的**首要机制**（VERIFIED，见 §1.2 / §1.5 / §2.1）。
   - 打开一个**未变更**的列表：`ensurePlaylistSummaries` 在 `useAudioPlayer.ts:1257` 早退，第一帧直接是 `ready`。
   - 添加之后再打开：descriptor 指纹变化 → `useAudioPlayer.ts:1266-1271` 丢掉该 scope 的全部行 → `:1272` 置 `loading` → `PlaylistPanel` 走骨架屏（`PlaylistPanel.tsx:984-985`）→ 对 **N 首全部重新读标签**（`runPlaylistSummaryPass`，`:1200` 分批，Rust 侧无任何缓存）。
   - ⚠️ **必须先确认复现形态**：搜索页今天**没有** `onAddToPlaylist`（`SearchPanel.tsx:166-172`、`PlaylistPlaybackDock.tsx:174` 判空后按钮 disabled），搜索页只能**新建**列表。新建走 `createPlaylistFromTracks`，N=k，**没有** N 倍放大。见 §1.4。

3. **时长通道同样整体作废**：`durationSourceKey`（`usePlaylistDuration.ts:19-21`）是「整表路径集合」的字符串，增加 k 首 → 整表 cache miss，`settledByScope` 转 false（`:130`），而 `playlistRowsReady` 要求**两个通道都 ready**（`PlayerShell.tsx:413-416`）。两个整表任务叠加，才是用户感知的「明显变慢」。（同样只对「追加到已存在列表」成立。）

   额外发现：**搜索页也被同一对状态门控**（`PlayerShell.tsx:454` `searchRowsReady`，`:513` `metadataStatus`；`SearchPanel.tsx:189-190` 加载期 `nonempty = []`）。即「任何一条会话列表处于 loading」→ 搜索页整片空白。见 §2.6。

4. **任务描述里怀疑的「窗口重置 / 封面 store 清空 / metadata ref 重置 / 预热重跑」在添加路径上全部被否证**（REFUTED）：
   - `usePlaylistContentWindow` 自 `02e6f59`（10-23，早于 10-25）起**已不再被 `PlaylistPanel` 使用**，`PlaylistPanel.tsx:996` 是 `data-content-window="full"`、`:829` `contentVisible` 硬编码 `true`。所以「窗口重置」这条候选在现网代码里**不存在**。
   - `activatePlaylistScope` 里那段破坏性 reset（`useAudioPlayer.ts:1619-1679`）在「添加到当前活动列表」时**被 `:1610-1616` 早退跳过**，`playlistTrackMetadataRef` / `playlistTrackVisualsRef` / `hydratedAudioTrackCacheRef` 都**不会**被清空。
   - 添加**不**调用 `enqueueCoverWarmup`（`:914-942` 的调用点只有 `:1100/:1311/:1349/:1432/:1493`，均为库恢复 / 扫描 / 导入）。

5. **Rust 侧每次添加都会重扫整个媒体库**：`library_playlist_addition.rs:65-66` 调用 `selected_folder_track_paths` → 对**每个已选根目录**做一次完整递归扫描（`library_folders.rs:39-55` → `audio/playlist.rs:93-130` / `132+`）。该行由 **`336f14b`（10-28）** 引入。加上注册表读两次（`library_playlists.rs:48`、`:188`）+ 整表 pretty JSON 落盘 fsync（`:378-397`）。

---

## 1. 添加路径（端到端，含 file:line）

### 1.1 搜索页 → 添加

`SearchPanel.tsx` 的 dock 选择绑定只暴露「新建播放列表」，**没有** `onAddToPlaylist` / `onPreparePlaylistAdd`：

- `SearchPanel.tsx:166-172` — `useLibraryDockBinding('search', { …, selection: { … canCreatePlaylist, onSelectAll, onClear, onExit, onPlay, onCreatePlaylist } })`
  - 无 `onAddToPlaylist`；`PlaylistPlaybackDock.tsx:174` 对「播放列表」按钮做 `!selection.onAddToPlaylist` 判空 → 搜索页该按钮恒为 disabled。
- `SearchPanel.tsx:157` `selectedSongs`（把集合类条目展开成歌曲）、`:158` `folderSongKeys`、`:159` `canCreatePlaylist`（要求全部 key 都在媒体库文件夹投影内）、`:171` `onCreatePlaylist: () => library?.onCreatePlaylist?.('搜索结果', selectedSongs.map(song => song.key))`。

> **重要歧义**：搜索页的 dock 选择里**没有** `onPreparePlaylistAdd` / `onAddToPlaylist`，也没有 `canAddToPlaylist`：
> - `SearchPanel.tsx:166-172` 的 `selection` 对象只给了 `canCreatePlaylist` / `onPlay` / `onCreatePlaylist` 等，**没有** `canAddToPlaylist`；
> - `useLibraryDockBinding.ts:98` `canAddToPlaylist = binding.selection?.canAddToPlaylist ?? false` → **false**；
> - `PlaylistPlaybackDock.tsx:174` 对「播放列表」按钮判 `!selection.onAddToPlaylist || !selection.canAddToPlaylist` → **disabled**；
> - 即使被程序化调用，`useLibraryDockBinding.ts:67-72` `addSongs` 里 `current?.onAddToPlaylist` 为 `undefined`，会直接返回 `{ errorMessage: '当前列表已关闭，请重新选择歌曲。' }`。
>
> 所以搜索页今天唯一可用的入口是 **新建播放列表**（`onCreatePlaylist`）。
> 「添加到一个**已存在**的播放列表」只能从播放列表管理页 / 歌曲列表页的多选进入：
> `PlaylistLibraryPanel.tsx:473,476` 或 `PlaylistPanel.tsx:503,506` → `PlaylistAddDialog`（`PlaylistSongDialogs.tsx:110-142`）→ `onAddToPlaylist`。
>
> 这两条形态的成本曲线**完全不同**，必须分开讨论（见 §1.4）：
> - **新建**（`createPlaylistFromTracks`）：新列表只有 k 首，整表 = k，**没有 N 倍放大**；
> - **追加到已存在列表**（`addToPlaylist` → `commitPlaylistRelationship`）：目标列表 N 首，**整表失效 = N 倍放大**。
> 用户描述的「添加之后列表加载明显变慢」，若发生在**旧列表**上，对应后者；若只是新建列表慢，则是别的机制（§2.3 全内容挂载 + §2.5 全库重建）。

### 1.2 `useAudioPlayer` 的写入与失效

`addToPlaylist` — `useAudioPlayer.ts:4439-4499`：

- `:4442` 规模上限 8192；`:4443-4444` 与 delete/import/create **共用同一把 mutation 锁**（`deletePendingRef`）。
- `:4459-4460` 进入 `deletePending = true`（这是「添加期间其它列表操作被拒」的来源）。
- `:4461` `descriptorMutationGenerationRef.current += 1`（只作 stale 守卫，`:1290` / `:1482`，不触发重跑）。
- `:4463` `localOnly = target.sourceKind === 'custom' || !registeredM3uScopesRef.current.has(targetScope)`：
  - **custom 列表 → 纯前端**（`:4477-4478` 本地拼 `tracks`，无 IPC）；
  - **m3u8 列表 → IPC**（`:4479` `addLibraryPlaylistTracks`）。
- `:4481` `commitPlaylistRelationship(target, result.playlist)`。
- `:4494-4497` finally 解锁。

`createPlaylistFromTracks` — `useAudioPlayer.ts:1504-1519`：

- `:1515` `sessionPlaylistDescriptorsRef.current.set(scope, playlist)`
- `:1516` `setSessionPlaylists([...previous, playlist])` → **`PlayerShell.tsx:111` 的 `librarySources` 变成新数组**
- `:1517` `ensurePlaylistSummaries(scope, playlist)` → **新列表的全表标签读取立即开始**

`commitPlaylistRelationship` — `useAudioPlayer.ts:4411-4437`：

- `:4416-4419` 更新 `libraryPlaylistObjectsRef` / `sessionPlaylistDescriptorsRef` / `setSessionPlaylists`（`map` → 新数组，**旧行的对象引用被替换**）
- `:4420-4425` 若目标是**当前活动 scope**：`activatePlaylistScope(next)` → 因 `playlistScopeRef.current === nextScope`（`:1610`）**早退**，随后 `:4423` `refreshPlaylistVisualDemandRef.current()`、`:4425` `persistCurrentSession()`
- `:4426-4435` 若活动的是播放队列快照：只替换 `playbackQueue.sourcePlaylist`
- `:4436` **`ensurePlaylistSummaries(targetScope, next)`** ← 关键失效点

### 1.4 「新建」与「追加」的成本曲线必须分开

| 形态 | 入口 | 目标列表规模 | 整表失效规模 | 是否 N 倍放大 |
|---|---|---|---|---|
| 新建播放列表 | `SearchPanel.tsx:171` `onCreatePlaylist` → `useAudioPlayer.ts:1535-1541` `createPlaylist` → `:1504-1519` `createPlaylistFromTracks` | 新 scope，**k 首** | k | **否** |
| 追加到已存在列表（custom） | `PlaylistSongDialogs.tsx:123` → `useAudioPlayer.ts:4439` `addToPlaylist`，`localOnly=true`（`:4463`） | 已有 **N 首** | **N** | **是** |
| 追加到已存在列表（m3u8） | 同上，但 `:4479` IPC → Rust 全库重扫（§2.4） | 已有 **N 首** | **N** + 全库扫描 | **是，且另加 Rust 成本** |

> 因此：**用户报告如果在「已存在的旧列表」上复现，落点是追加路径（候选 #1/#2/#4）；如果只在「新建的列表」上复现，落点是候选 #3/#5。** 这是本次分析最关键的分叉，必须在测量前先确认。

### 1.5 添加动作究竟作废了什么

（下表对「追加到已存在列表」成立；「新建」只影响新 scope，N=k）

| 缓存 / 状态 | 添加后 | 证据 |
|---|---|---|
| `playlistSummaryRowsRef[scope]` 全部行 | **清空** | `useAudioPlayer.ts:1266-1271` |
| `playlistSummaryStatusRef[scope]` | `'loading'` | `useAudioPlayer.ts:1272` |
| `playlistSummaryRunRef[scope]` | 新 `runId` + 新指纹 | `useAudioPlayer.ts:1263-1265` |
| `playlistTrackMetadataRef`（bump 元数据） | **不清空**（仅当 scope 变化才清） | `:1644-1645`，由 `:1610` 早退保护 |
| `playlistTrackVisualsRef`（窗口缩略图） | **不清空** | `:1647-1653`，同上 |
| `hydratedAudioTrackCacheRef` | **不清空** | `:1657-1658`，同上 |
| `playlistArtworkStore` | 只 `notifyAll()` | `:567` / `:583` / `:450` |
| `useLibraryArtwork` 整库 descriptor 表 | **整表重建**（O(全部曲目)） | `useLibraryArtwork.ts:399-439`，依赖 `[sources, …]` |
| `usePlaylistLibraryDurations` 该 scope 的结果 | **整表作废**（`sourceKey` 变） | `usePlaylistDuration.ts:19-21, 80-81` |
| `playlistDurationTracks` → `durationSources` | 新数组 | `useAudioPlayer.ts:4793`（`:4793` = `folderPlaylist?.tracks ?? pendingDurationPlaylist?.tracks`）；`PlayerShell.tsx:216-217` |
| Rust 封面预热 `library_warm_cover_thumbnails` | **不重跑** | 调用点 `useAudioPlayer.ts:1100/1311/1349/1432/1493` 均与 add 无关 |
| `getLibraryPlaylists`（整注册表重读） | **不重读** | 仅 `:1288-1324`（挂载一次）、`:4629`（重排冲突） |

---

## 2. 播放列表「列表加载」路径与放大点

### 2.1 【候选 #1，最高】整表标签摘要缓存被指纹作废 → N 首全部重读标签

**VERIFIED 机制**

1. 打开列表：`PlayerShell.tsx:147-156` `browsePlaylist(scope)` → `:151` `ensurePlaylistSummaries(scope)` → `setLibraryRoute({view:'tracks'})`。
2. `ensurePlaylistSummaries` — `useAudioPlayer.ts:1239-1274`：
   - `:1251` `fingerprint = playlistDescriptorFingerprint(playlist.tracks)`
   - `:1257` / `:1258` **幂等早退**：指纹一致且同一 library epoch（或已 `ready`）→ 直接 return
   - `:1266-1271` 指纹不同 → **删掉该 scope 的全部已就绪行**
   - `:1272` `commitPlaylistSummaryStatus(scope, 'loading')`
   - `:1273` `runPlaylistSummaryPass(...)`
3. 指纹本身对「加一首」是**全表敏感**：`playlistTrackSummary.ts:164-173` = `${length}\u0002` + 排序后的 `id\u0001path` 列表。加 k 首 → 长度与前缀全变。（排序意味着**重排不失效**，`6a7da1b` 改进，见 §3。）
4. 整表重读：`runPlaylistSummaryPass` — `:1172-1237`
   - `:1185` `playlistSummaryProbePaths(descriptors)`（`playlistTrackSummary.ts:179-195`）只跳过 `available === false`，**按全表路径**生成
   - `:1200` 每批 `AUDIO_PLAYLIST_TRACK_SUMMARY_BATCH_LIMIT = 256`（`services/audioCommands.ts:197`）
   - `:1195` 每行 `playlistTrackRowFromSummary(...)`；`:1186-1187` 注释明确「一次整表 pass 只 publish 一次」
5. Rust 侧**无任何缓存**：`src-tauri/src/audio/playlist_summary.rs:60-80` 只有一把 `TRACK_SUMMARY_GATE`（`:53`），`read_track_tag_summary`（`:258-316`）对每个路径做 `Probe::open` + `read`；`ParseOptions::new().read_cover_art(false)`（`:263`）只省封面解析，**不省文件打开与容器解析**。批上限 `MAX_BATCH_PATHS = 256`（`:45`），批内 4 线程（`:48`）。
6. 首帧直接被这个状态门控：
   - `PlayerShell.tsx:413-416` `playlistRowsReady = !displayScope || (playlistSummaryStatusByScope[displayScope] === 'ready' && durationData.settledByScope.get(displayScope) === true)`
   - `PlayerShell.tsx:718` `metadataStatus: playlistRowsReady ? 'ready' : 'loading'`
   - `PlaylistPanel.tsx:984-985` `metadataStatus === 'loading' ? <PlaylistMetadataLoading …/> : <grid>`
   - `PlaylistPanel.tsx:309-315` `reportEntrySettled` 也要求 `metadataStatus !== 'loading'`（入场动效同样被拖住）

**放大倍数**：成本 ∝ **N（全表）**，而用户心理预期 ∝ **k（新增）**。
对 N=1791（代码注释 `useAudioPlayer.ts:1186-1187` 与 `docs/architecture/playlist-track-summaries.md` 均以 1791 首为规模样例）、k=1 的场景，是「1 首的添加换来 1791 次 lofty 打开」。

**关键时序细节（VERIFIED）**：这个整表 pass **不是惰性到「打开列表」时才起跑**，而是在**添加动作内部**就立即起跑：
- `useAudioPlayer.ts:4436` `ensurePlaylistSummaries(targetScope, next)` 在 `addToPlaylist` 的 `try` 块内同步调用（`:4481` 之后）；
- 若目标是当前活动列表，`commitPlaylistRelationship` `:4422` 会先走 `activatePlaylistScope(next)`，其中 `:1585` `ensurePlaylistSummaries(nextScope)` 是**第一次**调用（先写入新指纹并启动 pass）；随后 `:4436` 的调用因 `playlistSummaryRunRef` 指纹已一致而在 `:1257` 早退；
- 若目标是**非活动**列表（从管理页添加），只有 `:4436` 一次调用，同样立即起跑；
- 因此「添加 → 关弹窗 → 打开该列表」时，pass 往往**仍在飞行中**，用户看到的是剩余部分（表现为骨架屏持续时间 ≈ 全量 pass 时间 − 中间操作的几十毫秒）。
- 推论：**如果用户在添加后等足够久再打开，会看到「不慢」**。反过来，「添加后立刻打开」才慢 —— 这一点是区分本候选与「纯渲染变慢」（候选 #3）的判别特征。

**版本归属**
- 机制骨架（指纹 + 早退 + loading 门控）：`7736028` 2026-10-19（`git log -S"playlistDescriptorFingerprint"`；`git blame useAudioPlayer.ts:1251-1274` → 7736028/336f14b）→ **在 `8f45750` 已存在**。
- 「添加会触发它」：`6a7da1b` 2026-10-28（`-S"addToPlaylist"` 唯一命中；`commitPlaylistRelationship` 4436 行 blame = `6a7da1b`）→ **`8f45750` 不存在**。

**如何证伪**
- 在 `addToPlaylist` 前后统计 `audio_probe_playlist_track_summaries` 的调用次数与 `path_count` 总量。若「添加后首次打开」与「未变更列表首次打开」两者总 path 数**相同**，则本候选被证伪（说明问题不在整表重读）。
- 反向验证：把 `ensurePlaylistSummaries(targetScope, next)` 改成「只对新 id 增量读取」的等价补丁后，若「添加→打开」耗时下降到接近「未变更→打开」，则本候选成立。
- 观察 `playlistSummaryStatusByScope[scope]` 的时间序列：应看到 `ready → loading → ready` 的完整回退。

### 2.2 【候选 #2，高】整表时长缓存被路径集合作废 → 第二个整表任务叠加

**VERIFIED**

- `usePlaylistDuration.ts:19-21` `durationSourceKey` = `JSON.stringify(全部 [path, available].sort())` —— 加一首即整表 key 变。
- `:61` `tasks` 携带 `sourceKey`；`:80-81` `if (cached?.sourceKey === task.sourceKey && cached.sources === task.sources) continue`
  - `sources === task.sources` 是**引用比较**，`setSessionPlaylists` 的 `map` 让目标列表 `tracks` 变新数组（`useAudioPlayer.ts:4416-4419`）→ 必然进入重扫。
- `:84` `scanDuration(...)`；`:121-134` 输出里 `settledByScope.set(scope, sources.length === 0 || Boolean(result))` —— 重扫期间为 **false**，于是 `playlistRowsReady` 仍 false（`PlayerShell.tsx:415`）。
- 扫描器 `model/playlistDuration.ts:103-141`：`:114` 只把 `entries` 里**已知**的时长跳过探针，**不复用上一次 `completed.result.durationsByPath`**（那份结果整表被丢弃）。批次上限 `:9` `AUDIO_PLAYLIST_DURATION_BATCH_LIMIT = 256`。
- 缓解：Rust `DurationCache`（`audio/duration_cache.rs:192-201, 233-259`）按「路径 + 文件长度 + mtime」命中，**未变更文件不会重新解码**；但每条路径仍要一次 IPC + 两次 `fs::metadata`（`SourceIdentity::read`，`:83-89`）。所以量级是「N 次 stat + N/256 次 IPC」，不是「N 次解码」。

**为什么仍算高影响**：它与候选 #1 是**串行/叠加**关系（两者都是整表、都要等），而首帧要求两者同时 `ready`（`PlayerShell.tsx:413-416`）。用户看到的是「骨架屏持续时间」而非「某一步耗时」。

**版本归属**
- `usePlaylistLibraryDurations` + `durationSourceKey`：`8f45750` 已存在（`git show 8f45750:.../usePlaylistDuration.ts` 可见 `sourceKey`、`cached.sources === task.sources`），但当时**未排序**（`JSON.stringify(sources.map(...))`，无 `.sort()`）。
- 排序化（重排不再重扫）：`6a7da1b` 2026-10-28（`git blame :19-21` = 6a7da1b；`-S"durationSourceKey"` 命中 6a7da1b）。**这是改进，不是退化。**
- 「添加让 `tracks` 换新数组」：`6a7da1b`。

**如何证伪**
- 在 `audio_probe_playlist_durations` 上统计：添加后一次打开的 `path_count` 是否 ≈ N；并读 Rust tracing 里的 `cache_hits` / `cache_misses`（`duration_cache.rs:155-159` 就是为此设计的）。若 `cache_hits ≈ N` 且该阶段耗时 < ~50ms，则本候选对用户感知贡献很小，应从排名中下调。
- 用 `settledByScope` 的时间线直接观测它转 true 的时刻是否晚于 tag 摘要 ready。

### 2.3 【候选 #3，中高】列表页整表全内容挂载（无内容窗口），随重开线性放大

**VERIFIED**

- `usePlaylistContentWindow.ts:19` 仍在仓库里，但**没有任何组件 import 它**：`git grep -n usePlaylistContentWindow -- src` 只命中测试桩与定义文件本身。
- 移除时刻：`02e6f59` 2026-10-23（`git log -S"usePlaylistContentWindow({" -- src/features/player/components/PlaylistPanel.tsx` → 02e6f59 与 9e2d384；`git show 02e6f59:.../PlaylistPanel.tsx` 中调用为 0，`9e2d384` 为 1）。**早于 10-25 基准**。
- 现状：`PlaylistPanel.tsx:996` `data-content-window="full"`、`:829` `contentVisible`（硬编码 true）、`:813-845` `cards = useMemo(displayedTracks.map(...))` → **N 张卡全部挂载完整子树**。
- `artworkVisible` 仍按窗口：`PlaylistPanel.tsx:335-337`（初始取已有 `coverThumbnail` 的行）、`:612-786`（滚动/尺寸变化发布窗口）、`:704-716`（`windowKey` 含 `coverCssPixels`/dpr/visible/ordered）。
- 入场定位与 rebase 也是整表 O(N) 查询：`:556-580`（`grid.querySelectorAll('[data-playlist-track-id]')` 找当前行）、`:600-602`（`rebaseController` 依赖 `filteredTrackIdsKey`）。

**影响**：不是「添加」引起的，但**「添加→关闭→重开」**会让 N+k 张卡重挂载；N 越大越明显。它把候选 #1/#2 的等待时间与「骨架屏之后的重排成本」串在同一个用户操作里。

**版本归属**：`data-content-window="full"` 与 `contentVisible` 在 `8f45750` 已存在（`git show 8f45750:.../PlaylistPanel.tsx` 命中）。**10-25 也有**，不构成跨版本差异。

**如何证伪**
- Performance trace 中 `PlaylistPanel` 提交阶段（React commit + layout）的时长。若「添加后重开」与「未添加重开」的 commit 时长接近，则本项不是差异来源（只解释绝对耗时，不解释差异）。

### 2.4 【候选 #4，中】Rust 添加时重扫整个媒体库根目录 + 注册表两次读 + 整表 fsync 写

**VERIFIED**

- `src-tauri/src/lib.rs:246-259` `library_add_playlist_tracks` → `spawn_blocking` → `library_playlist_addition::add_playlist_tracks`。
- `library_playlist_addition.rs`：
  - `:48` `registry.get()` → `library_playlists.rs:85-96` 读 + `serde_json` 解析**整个注册表**
  - `:55-59` `audio.known_track_paths()` 全量克隆（`audio/controller.rs:625-632`）
  - `:60-64` 遍历**所有**播放列表的**所有** tracks 建 known 表
  - `:65-66` **`for path in selected_folder_track_paths(&folders.get()?)`** →
    `library_folders.rs:39-55` 对每个 selected root 调 `crate::audio::load_library_folder(...)` →
    `audio/playlist.rs:93-130` → `load_recursive_library_playlist`（`:132+`）**完整递归目录遍历 + 每文件 metadata**
  - `:77-78` `registry.add_tracks` → `library_playlists.rs:178-242`：`:188` **再一次** `self.read()`，`:227-235` `merge_tracks`，`:236` `playlist.validate()`，`:238` `self.write(&stored)`
  - `library_playlists.rs:378-397` `write`：`to_vec_pretty` + `write_all` + **`sync_all()`** + `replace_file`（原子替换）
- 注意：这是 **m3u8 目标**才走的分支（`useAudioPlayer.ts:4463` `localOnly` 对 custom 列表为 true，不走 IPC）。所以「添加到自定义列表」不受此项影响。

**为什么算用户可感知**：`sync_all()` 的磁盘同步 + 全库递归扫描都在 `deletePending` 锁内完成（`useAudioPlayer.ts:4459`），期间 UI 的列表操作被拒；且它与随后打开的整表标签读取**争同一块磁盘**（候选 #1 的 N 次打开）。

**版本归属**
- 整条 `add_playlist_tracks` / `library_add_playlist_tracks` / `add_tracks`：`6a7da1b`（`git log -S` 三个符号均只命中 6a7da1b；`git blame library_playlist_addition.rs:44-70` 全为 6a7da1b）→ **`8f45750` 不存在**。
- `selected_folder_track_paths` 那一行：**`336f14b` 2026-10-28**（`git blame :65-66`；`-S"selected_folder_track_paths" -- src-tauri` 命中 336f14b）→ 注意它**晚于** `6a7da1b`，即「添加」功能诞生时还没有这次全库重扫，是 336f14b 后来加进去的**退化**。

**如何证伪**
- 在 `add_playlist_tracks` 两端打时间戳（或读 tracing span），并单独计时 `selected_folder_track_paths`。若它 < ~5ms（小库），则本项只在大库下成立。
- 用 Process Monitor / ETW 观察注册表 json 的 write+fsync 时长。

### 2.5 【候选 #5，低中】`useLibraryArtwork` 在一次添加上做整库（非目标列表）重建与裁剪

**VERIFIED**

- `PlayerShell.tsx:111` `librarySources = [...libraryFolderPlaylists, ...sessionPlaylists]`（`aafaa4f` 2026-10-21，**早于 10-25**）。
- `PlayerShell.tsx:124-126` `useLibraryArtwork(librarySources, detail, visible, warmTrackId)`。
- `useLibraryArtwork.ts:399-439` 的 effect 依赖 `[sources, detail, warmTrackId, artworkStore]` → 任何 `librarySources` 新数组都会：
  - `:403-407` **重建全库 `descriptors` Map（O(全部曲目)）**
  - `:408-423` 遍历整个 `runtime.cache` 做裁剪 / revoke
  - `:429-431` 重建 detail 路径集
  - `:435-438` `runtime.refresh()` + `setRows(runtime.rows)`（**新的 Map + 通知全部订阅者**）
- 上限常量：`:45-47` `MAX_RESIDENT = 80`、`MAX_DETAIL = 40`、`CONCURRENCY = 2`；`:277-279` `admitLibraryArtwork` 只在 `runtime.visible` 时计算 desired。
- 且 `PlayerShell.tsx:246-248` `libraryDurationSources` 也随之换新 → 每次添加都要为**每个 scope** 重算 `durationSourceKey`（`usePlaylistDuration.ts:61`），即 O(全库曲目) 的字符串化 + 排序。

**性质**：纯 CPU / 字符串，无 I/O。对 N 万级曲目库会到几十毫秒，属「加剧」而非「主因」。

**版本归属**：`d712666` 2026-10-24（`git blame PlayerShell.tsx:124` = d712666）→ **10-25 已存在**。

**如何证伪**：在 `useLibraryArtwork` 的 sources effect 首尾埋时间；若 < 16ms（一帧），可忽略。

### 2.6 搜索页自身的「全 source 摘要兜底」在 10-30 被拓宽（`9e8d41c`）

`PlayerShell.tsx:162-165`：

```ts
useEffect(() => {
  if (!pendingArtistSongs && !isSearchOpen && (libraryRoute.view !== 'category' || !['songs', 'recent-played', …, 'composer'].includes(libraryRoute.categoryId))) return
  for (const source of librarySources) ensurePlaylistSummaries(playlistScope(source))
}, [pendingArtistSongs, isSearchOpen, libraryRoute, librarySources, ensurePlaylistSummaries])
```

**VERIFIED 差异**（`git show` 逐版对照）：

| 版本 | 触发条件 | 遍历范围 |
|---|---|---|
| `8f45750`(10-25) / `6a7da1b`(10-28) | `libraryRoute.view !== 'category' \|\| categoryId !== 'songs'` → return | `player.libraryFolderPlaylists` |
| `9e8d41c`(10-30) 起（含现在） | `!isSearchOpen && (… || !['songs','recent-played','recent-added','folders','folder','album','artist','album-artist','composer'].includes(categoryId))` → return | **`librarySources`（= 文件夹 + 会话列表）** |

即：**搜索页一打开，就会对「每一条会话播放列表」调一次 `ensurePlaylistSummaries`**。

- 好处：这是幂等的（`useAudioPlayer.ts:1257-1261` 指纹一致即早退），所以刚创建 / 刚添加过的列表**不会**被重复读取（`:1517` / `:4436` 已经起过 run）。
- 风险（HYPOTHESIS）：如果某条会话列表的 run 因 `libraryEpoch` 变化（`:1252` `libraryEpoch = playlist.sourceKind === 'folder' ? … : null`）而对不上，早退失效 → 搜索页每次进入都可能触发该列表的整表标签读取。**需要实测确认 `ensurePlaylistSummaries` 在搜索页打开时的实际命中率。**

**并且搜索页自身有「全 source 就绪」的硬门控**（这一点很容易被误读成「播放列表慢」）：

- `PlayerShell.tsx:454` `searchRowsReady = !libraryRestorePending && !playlistRestorePending && librarySources.every(source => playlistSummaryStatusByScope[scope] === 'ready' && durationData.settledByScope.get(scope) === true)`
- `PlayerShell.tsx:513` `search.metadataStatus = searchRowsReady ? 'ready' : 'loading'`
- `SearchPanel.tsx:189-190` `loading = library?.allSongsMetadataStatus === 'loading'` → `nonempty = loading ? [] : …` → **加载期间搜索结果整片为空**

推论（VERIFIED 的机制 + 待测的权重）：
> **只要有一条会话列表处于 `loading`，搜索页就整片空白。**
> 而「追加到已存在列表」正好会把那条列表置为 `loading`（`useAudioPlayer.ts:1272`）。
> 所以用户在搜索页刚做完「新建/添加」后，搜索页本身会短暂失去结果；
> 而**再打开那条列表**时，用户看到的是同一次 `loading` 的剩余部分。
> 这与用户描述「加完之后播放列表加载变慢」在时间上高度吻合，值得优先验证（测量 `searchRowsReady` 的 false 时长与 `playlistRowsReady` 的 false 时长是否重叠/同源）。

### 2.7 其它已核对的链路（结论：无放大 / 不相关）

| 机制 | 结论 | 证据 |
|---|---|---|
| `useAllSongsWindow` 参与播放列表歌曲列表 | **不参与**。只用于「全部歌曲 / 搜索页 / 专辑 / 文件夹 / 管理页」 | `PlaylistPanel.tsx` 无该调用；`SearchPanel.tsx:83`、`PlaylistLibraryPanel.tsx:267`、`AlbumLibraryPanel.tsx:87,257`、`FolderHierarchyPanel.tsx:218`、`PlayerSurface.tsx:686` |
| `playlistCoverScheduler` 并发与去重 | 有界 4 并发（`playlistCoverScheduler.ts:53`），按 `[kind, clientId, windowGeneration, source, maxEdge]` 去重（`:145`） | 添加只影响新增的 k 个 key |
| `useCollectionLayout` | 只在用户手势/落定后做 FLIP 快照（`useCollectionLayout.ts:38-54`），添加本身不触发 | — |
| `usePlaylistDuration`（单表版） | 播放列表页实际使用的是**库版** `usePlaylistLibraryDurations`（`PlayerShell.tsx:267`）；单表版仅测试与预加载用例使用 | `playlistCoverPreload.browser.test.mjs` 等 |
| `library_get_playlists` 在添加后被重读 | **否** | `useAudioPlayer.ts:1288-1324`（挂载）、`:4629`（重排冲突回退） |
| 封面预热重跑 | **否** | 见 §1.3 表 |

---

## 3. 归属总表：每个放大点「哪一版引入 / 10-25 是否存在」

`8f45750` 之后的相关提交（时间序）：`333b37d`(10-25 早) → **`8f45750`(10-25)** → `6a7da1b`(10-28) → `336f14b`(10-28) → `ef32a82` → `e0572a5` → `d0a967e` → `30e5016` → `04f78c7` → `9e8d41c`(10-30) → `ce65f67`(10-30)。

| 放大点 | 位置 | 引入提交 | 日期 | 10-25(`8f45750`) 是否存在 |
|---|---|---|---|---|
| 「添加到播放列表」功能本身 | `useAudioPlayer.ts:4439` | `6a7da1b` | 10-28 | ❌ 不存在 |
| 添加后 `ensurePlaylistSummaries(target)` 整表失效 | `useAudioPlayer.ts:4436` | `6a7da1b` | 10-28 | ❌（函数存在，但无添加可触发） |
| 指纹变化即清空该 scope 全部行 | `useAudioPlayer.ts:1266-1271` | `7736028` | 10-19 | ✅ 存在 |
| 指纹定义（长度 + 排序 id/path） | `playlistTrackSummary.ts:164-173` | `7736028` | 10-19 | ✅ 存在 |
| 摘要 `ready` 前不渲染 grid（骨架屏门控） | `PlaylistPanel.tsx:984`、`PlayerShell.tsx:413-416,718` | `7736028` | 10-19 | ✅ 存在 |
| Rust 标签摘要无缓存 | `audio/playlist_summary.rs:54,258-316` | 随摘要通道 | ≤10-19 | ✅ 存在 |
| `durationSourceKey` 整表失效 | `usePlaylistDuration.ts:19-21,80-81` | `d77af76`（未排序版） | 10-16 | ✅ 存在（无 sort） |
| `durationSourceKey` 排序（重排不再重扫，**改进**） | `usePlaylistDuration.ts:20` | `6a7da1b` | 10-28 | — 是修复 |
| `PlaylistPanel` 全内容挂载（内容窗口已移除） | `PlaylistPanel.tsx:996,829` | `02e6f59` 移除了调用 | 10-23 | ✅ 已是全量 |
| `useLibraryArtwork` 全库 descriptor 重建 | `useLibraryArtwork.ts:399-439` | `d712666` | 10-24 | ✅ 存在 |
| `librarySources` 并入 session playlists | `PlayerShell.tsx:111` | `aafaa4f` | 10-21 | ✅ 存在 |
| Rust 添加命令 + `add_tracks` + 整表写 | `library_playlist_addition.rs:39-85`、`library_playlists.rs:178-242,378-397` | `6a7da1b` | 10-28 | ❌ 不存在 |
| Rust 添加时**全库重扫** `selected_folder_track_paths` | `library_playlist_addition.rs:65-66` | **`336f14b`** | 10-28 | ❌ 不存在 |
| 搜索页 `SearchPanel` | `SearchPanel.tsx`（整文件） | `9e8d41c` | 10-30 | ❌ 不存在 |
| 摘要状态门控扩展到搜索页（每次 `librarySources` 变化对全部 source 调 `ensurePlaylistSummaries`） | `PlayerShell.tsx:162-165` | `9e8d41c`（`git blame :164`） | 10-30 | ❌ 不存在 |

**净结论**：只有两项放大点是「10-25 之后新增」的 ——
1) 添加动作把整表摘要置为 `loading`（`6a7da1b`）；
2) 添加动作在 Rust 里触发**全库递归重扫**（`336f14b`）。
其余让「整表重算」昂贵的机制（骨架屏门控、全内容挂载、全库 artwork 重建、整表 duration key）在 10-25 就已存在，属于**放大器**而非**触发器**。

---

## 4. 候选排序（按预期用户可见影响）

| 排名 | 候选 | 类型 | 预期影响 | 证伪用测量 |
|---|---|---|---|---|
| 1 | **追加**到已存在列表 → 整表摘要指纹失效 → N 首全量重读标签 → `loading` 骨架屏 | VERIFIED 机制 / HYPOTHESIS 权重 | **高**（决定首帧是否出现骨架屏，成本 ∝ N 而非 k） | `audio_probe_playlist_track_summaries` 调用次数与 `path_count` 总和；`playlistSummaryStatusByScope` 时序 `ready→loading→ready` |
| 2 | **追加**到已存在列表 → `durationSourceKey` 整表失效 → 全表重扫 + `settledByScope=false`（与 #1 叠加） | VERIFIED | **高** | `audio_probe_playlist_durations` 的 `path_count` 与 Rust `cache_hits/cache_misses`；`settledByScope` 转 true 的时刻 |
| 3 | 列表页 N 张卡全内容挂载（`data-content-window="full"`），重开线性重挂 | VERIFIED | 中高（解释绝对耗时，不解释差异） | React commit / layout 时长；`[data-playlist-track-id]` 节点数 |
| 3b | **搜索页与列表页共享同一对就绪门控** → 一条会话列表 loading 就让搜索页整片空白（`PlayerShell.tsx:454,513`；`SearchPanel.tsx:189-190`） | VERIFIED 机制 | 中高（解释「加完之后整页都慢」的观感） | `searchRowsReady` 为 false 的时长是否与 `playlistRowsReady` false 时长重叠/同源 |
| 4 | m3u8 目标：Rust 添加时全库递归重扫 + 注册表两次读 + fsync 写 | VERIFIED | 中（大库/慢盘显著；与 #1 争磁盘） | `add_playlist_tracks` 内部分段计时；ProcMon 看 json write/fsync |
| 5 | 每次添加 `useLibraryArtwork` 全库 descriptor 重建 + 全库 `durationSourceKey` 重算 | VERIFIED | 低中（纯 CPU，随曲目数线性） | sources effect 首尾计时；`librarySources` 长度与曲目总数 |
| — | 「窗口重置 / 内容窗口重测」 | **REFUTED** | 无 | 无（该 hook 未被使用，`02e6f59` 起） |
| — | 「封面 store 清空 / metadata ref 重置 / hydrated cache 清空」 | **REFUTED**（添加到活动列表时被 `:1610` 早退跳过） | 无 | 无 |
| — | 「封面预热 / thumbnail-index 重跑」 | **REFUTED** | 无 | 无 |

### 需要实测才能定的 HYPOTHESIS
- **H1**：添加后首帧耗时 ≈ tag 摘要整表 pass 与 duration 整表 pass 的**较大者**，而非二者之和（取决于 `ensurePlaylistSummaries` 与 `usePlaylistLibraryDurations` 是否并行）。二者都是 `spawn_blocking`，但 Rust 侧有两把**独立** gate（`playlist_summary.rs:53` `TRACK_SUMMARY_GATE` 与 `playlist_duration.rs:55` `DURATION_GATE`），理论上可并行——需要 trace 确认。
- **H2**：磁盘争用 —— `library_playlists.rs:378-397` 的 `sync_all()` 与随后 N 次 `Probe::open` 落在同一块物理盘上，会额外抬高峰值延迟。需要 ETW/ProcMon 才能量化。
- **H3**：Windows Defender 对 `library-playlists.v1.json.tmp` 与 N 个音频文件的实时扫描会乘性放大 #1/#4。需要排除法（临时关闭实时保护前后对比）验证。
- **H4**：N 越大越慢是否呈线性。若实测是**超线性**，则说明还有 #5 之外的 O(N²) 环节（例如 `playlistSummaryProbePaths` 每批都重建 `descriptorsByPath`，或 `PlaylistPanel` 的 `filteredTrackIdsKey` / `contentShapes` 每次渲染重建），需要进一步定位。

---

## 5. 建议的测量方案（供后续 perf 任务使用，本文件不执行）

1. **前端计数打点**（不改变行为）：包装 `probeAudioPlaylistTrackSummaries` / `probeAudioPlaylistDurations` 记录 `{scope, pathCount, batches, t0, t1}`。
2. **状态时序**：订阅 `player.playlistSummaryStatusByScope` 与 `durationData.settledByScope`，记录 `ready → loading → ready` 时间线；**同时**记录 `searchRowsReady`（`PlayerShell.tsx:454`）与 `playlistRowsReady`（`:413`）的 false 区间，确认二者是否同源。
3. **对照实验（关键）**：
   - **先定性**：复现到底发生在「新建的列表」还是「已存在的列表」上（§1.4）。这是分叉点。
   - A 组：打开一个**从未变更**的列表（预期首帧即 `ready`，无骨架屏）；
   - B 组：向同一列表**追加** k=1，再打开；
   - C 组：在搜索页**新建**一个 k 首列表，再打开；
   - 对比 A/B/C 的 `path_count` 总和、首帧时间、React commit 时长。
   - 若 A/B 的 `path_count` 相同 → 候选 #1/#2 被证伪。
   - 若 A/B 不同但 B ≈ C → 说明成本跟随「列表规模」而非「添加次数」，且新建列表本身也慢（指向 #3/#5）。
4. **时序判据**：「添加后**立刻**打开」vs「添加后**等 5s** 再打开」。
   - 前者慢、后者不慢 → 候选 #1/#2 成立（pass 在飞行中）。
   - 两者都慢 → 指向 #3（渲染 / 挂载）或 #5（全库重建）。
5. **Rust 分段计时**：在 `add_playlist_tracks` 内对 `registry.get()` / `known_track_paths()` / `selected_folder_track_paths` / `add_tracks`（含 `read` 与 `write`）分别计时。
6. **跨版本**：基线取 `6a7da1b` 与 `336f14b`（**不要用 `8f45750`**，该版本无此功能）。若必须在 10-25 上对比，则只能对比「不含添加动作」的打开基线，不能对比「添加后打开」。

---

## 6. 附：本次核对用到的命令

```
git log --oneline -S"addToPlaylist" -- src                      # → 6a7da1b 唯一
git log --oneline -S"playlistDescriptorFingerprint" -- src      # → 6a7da1b, 7736028
git log --oneline -S"durationSourceKey" -- .../usePlaylistDuration.ts   # → 6a7da1b
git log --oneline -S"usePlaylistContentWindow({" -- .../PlaylistPanel.tsx  # → 02e6f59(移除), 9e2d384(引入)
git log --oneline -S"add_playlist_tracks" -- src-tauri          # → 6a7da1b
git log --oneline -S"selected_folder_track_paths" -- src-tauri  # → 336f14b
git blame -L 4439,4499 -- src/features/player/hooks/useAudioPlayer.ts    # 全为 6a7da1b
git blame -L 65,66    -- src-tauri/src/library_playlist_addition.rs      # 336f14b
git blame -L 123,127  -- src/features/player/components/PlayerShell.tsx  # d712666 / baa1d48
git show 8f45750:src/features/player/hooks/useAudioPlayer.ts | Select-String addToPlaylist  # 无命中
git show 8f45750:src/features/player/components/MoreActionsMenu.tsx | Select-String playlist # UnavailableAction
```

---

## 7. 【追加·决定性】三个 `every()` 就绪门控：新建/追加歌单是否让「搜索页 + 全部歌曲页」一起变慢

回应 lead 的 a–d 四问。本节只写代码读证，不推测。

### 7.0 先说清三个门控的形状差异（这是全节的关键）

三处**形状相同**，但**遍历的集合不同**，因此影响面不同：

| 门控 | 位置 | 遍历集合 | 被它门控的界面 |
|---|---|---|---|
| `playlistRowsReady` | `PlayerShell.tsx:413-416` | **单个** `displayScope`（不 every） | 播放列表详情页 `metadataStatus`（`:718`） |
| `allSongsRowsReady` | `PlayerShell.tsx:432-436` | **`player.libraryFolderPlaylists`**（仅媒体库文件夹来源） | `allSongsMetadataStatus`（`:664`）→ 全部歌曲 / 专辑 / 艺术家 / 文件夹 / 播放列表管理页 |
| `searchRowsReady` | `PlayerShell.tsx:454` | **`librarySources`**（= `libraryFolderPlaylists` **+** `sessionPlaylists`，`:111`） | 搜索页 `metadataStatus`（`:513`） |

> **决定性观察**：`allSongsRowsReady` 遍历的是 `libraryFolderPlaylists`，`searchRowsReady` 遍历的是 `librarySources`（后者是前者的**超集**，多了 session 会话歌单）。
> 所以「一条**会话歌单**（custom）变 loading」→ **只**打穿 `searchRowsReady`，**不**打穿 `allSongsRowsReady`。
> 这个不对称是 (c) 的答案。

### 7.1 (a) 新建的 custom 歌单会不会进入 `librarySources`？——**会**

链路与证据：

1. `SearchPanel.tsx:171` `onCreatePlaylist: () => library?.onCreatePlaylist?.('搜索结果', selectedSongs.map(song => song.key))`
2. `PlayerShell.tsx:690` `onCreatePlaylist: player.createPlaylist`（library viewModel）
3. `useAudioPlayer.ts:1535-1541` `createPlaylist` → 按 path key 解析描述符 → `createPlaylistFromTracks`
4. `useAudioPlayer.ts:1510-1513` 被构造为 `sourceKind: 'custom'`、`sourcePath: 'custom:<uuid>'`
5. `useAudioPlayer.ts:1515-1516` `sessionPlaylistDescriptorsRef.current.set(scope, playlist)` + **`setSessionPlaylists((previous) => [...previous, playlist])`**
6. `useAudioPlayer.ts:4771` `visibleSessionPlaylists = sessionPlaylists.filter(source => source.sourceKind !== 'folder')`
   → `'custom' !== 'folder'` ✅ **通过过滤**
7. `useAudioPlayer.ts:4794` `sessionPlaylists: visibleSessionPlaylists`（暴露给 view model）
8. `PlayerShell.tsx:111` `librarySources = [...player.libraryFolderPlaylists, ...player.sessionPlaylists]`
   → **新 custom 歌单进入 `librarySources`** ✅

**反证（确保它不会同时污染 `libraryFolderPlaylists`）**：
- `setLibraryFolderPlaylists` 的全部调用点（`:1001`、`:1051`、`:1403`、`:4550`、`:4717`）都在 folder 语境下；
- `rememberLibraryPlaylist`（会写 `setLibraryFolderPlaylists` 上溯的来源）在 `:958` 有硬守卫 `if (… || playlist.sourceKind !== 'folder') return`
- `createPlaylistFromTracks` 只碰 `setSessionPlaylists`（`:1516`），**不碰** `setLibraryFolderPlaylists`。
→ 所以 custom 歌单**只**出现在 `sessionPlaylists` 分支，即 `librarySources` 里，**不在** `libraryFolderPlaylists` 里。

### 7.2 (a) 之后：`searchRowsReady` 会不会从 true 翻成 false？——**会**

- `PlayerShell.tsx:454` 要求 `librarySources.every(... playlistSummaryStatusByScope[scope] === 'ready' && settledByScope.get(scope) === true)`
- 新 scope 加入 `librarySources` 后，`every()` 必须为它求值。而该 scope 此刻：

**(b) 新 scope 的初始值：`undefined`，不是 `'loading'`**

- `useAudioPlayer.ts:500-502` `useState<Readonly<Record<string, PlaylistSummaryStatus>>>({})` → 空对象
- `useAudioPlayer.ts:1517` `ensurePlaylistSummaries(scope, playlist)` 同步执行到 `:1272` `commitPlaylistSummaryStatus(scope, 'loading')`
- `useAudioPlayer.ts:894-898` `commitPlaylistSummaryStatus` 写入 `{...prev, [scope]: status}` → 该 scope 变 `'loading'`

时序上有一个**极短暂的 `undefined` 窗口**（同一函数体内 `:1516` setSessionPlaylists → `:1517` ensurePlaylistSummaries；React 批处理会把两者合并，因此**渲染时几乎总是看到 `'loading'`**，而不是 `undefined`）。

**两种取值都让 `every()` 失败**：
- `undefined === 'ready'` → `false`
- `'loading' === 'ready'` → `false`

**`durationData.settledByScope` 同样失败**：
- `usePlaylistDuration.ts:130` `settledByScope.set(task.scope, task.sources.length === 0 || Boolean(result))`
- 新 scope 首次进入 `tasks`（`:54`）时 `completed` 无该 scope 记录 → `result === undefined` → `Boolean(undefined) = false`
- 且 `task.sources.length` = k > 0，所以 `sources.length === 0` 也为 false
→ `settledByScope.get(newScope) === true` 为 **false** ✅（两个条件同时失败）

**结论 (a)+(b)**：
> 新建一个 k 首的 custom 歌单后，`searchRowsReady` **立即从 `true` 翻成 `false`**，并持续到该新 scope 的 **tag 摘要 pass 与 duration pass 双双 ready**。
> 由于 k 通常很小（搜索页选择几十首），这个窗口较短；但**它确实存在，且必然发生**。

### 7.3 (c) 用户观感的确定答案：**只有 (i) 的一半 + (ii) 的搜索页部分，不包含全部歌曲页**

拆开看：

| 界面 | 是否被新建/追加歌单打穿 | 依据 |
|---|---|---|
| **目标歌单详情页** | ✅ 会 | `playlistRowsReady`（`:413-416`）看 `displayScope`；追加会把它置 `loading`（`useAudioPlayer.ts:1272`） |
| **搜索页** | ✅ 会 | `searchRowsReady`（`:454`）遍历 `librarySources`，含 session 歌单；新 scope `loading` → false |
| **全部歌曲 / 专辑 / 艺术家 / 文件夹 / 播放列表管理页** | ❌ **不会** | `allSongsRowsReady`（`:432-436`）只遍历 `libraryFolderPlaylists`；custom 歌单不在其中（§7.1 反证） |

**所以正确答案是 (ii) 的一个特例**：
> **「目标歌单」+「搜索页」一起变慢；(「全部歌曲」及其他媒体库分类页不变。**
> 而不是「整页都慢」，也不是「只有目标歌单慢」。

**这个结论对用户报告的解读价值**：用户说「加入后**歌曲列表**加载变慢」——如果用户是在搜索页加完歌后**回到搜索页**，他会觉得「整个界面都慢」（因为搜索结果全没了，只剩 `:212` 的「正在读取音乐标签…」状态行）；如果他是去打**目标歌单**，也会慢。这两次慢是**同一个 `loading` 的同一段时间**，因此会被体验为「一次很长的卡顿」，而不是两处独立变慢。

**注意（必须写进结论的限定）**：
1. **只在 custom（会话）歌单上成立**。若用户从管理页向 **m3u8** 歌单追加，则该歌单同样进入 `sessionPlaylists` 分支（`:4418` 走 `setSessionPlaylists`），结论不变；但 m3u8 追加还叠加 §2.4 的 Rust 全库重扫，总时长更长。
2. **搜索页的「空白」不是全界面消失**：`SearchPanel.tsx:211-215` 在 `loading` 时仍渲染容器与 `:212` 状态行，只是 `:190` `nonempty = []` 让**所有结果卡片消失**。
3. **`startupRowsReady` 也可能被牵连**：`PlayerShell.tsx:417` `startupRowsCurrentReady = !hadSavedSession || (!queueOpen && !isPlaylistOpen) || playlistRowsReady`；若歌单正在打开（`isPlaylistOpen`）且 `playlistRowsReady` 为 false，则启动就绪被推迟，`:768` `startupReady` 可能走 `:427-431` 的 15s 看门狗。这是**已有**的兜底（`startupRowsTimedOut`），说明该门控此前已出现过长时间不 ready 的场景。

### 7.4 (d) 若 (ii) 成立，最小改动方向（只描述方向，不写代码、不改文件）

按「副作用由小到大」排序，三个方向：

**方向 A（最小、最对症）：把 `searchRowsReady` 的 every() 收紧为「仅当前可见 scope」**
- 涉及文件：`src/features/player/components/PlayerShell.tsx`（仅 `:454` 一行 + 可能的依赖数组）
- 思路：搜索页只需要「用户要看的那些 source 的行」就绪即可逐区渲染；不必等全部 source。可退化为「不含 session 歌单」或「仅含当前展开/可见的 source」。
- 副作用：
  - 搜索页可能**先出现部分结果**再补齐（从「全有/全无」变成增量）。这是行为变化，可能影响 `searchPageAcceptance.browser.test.mjs` 里等待 `metadataStatus==='ready'` 的断言。
  - 若收紧为「排除 session 歌单」，则搜索页会**用 `pendingPlaylistTrackRow` 渲染新歌单的行**（`PlayerShell.tsx:447` `summariesByScope[scope]?.[id] ?? pendingPlaylistTrackRow(descriptor)`）——即显示**文件名**而非标签标题。这是「更快的错误答案」，需要产品决策。
- **风险等级：低**，但需要产品确认「先出文件名再替换」是否可接受。

**方向 B（最根治，但改动面大）：让新 scope 初始状态为 `'ready'`（空行）再补**
- 涉及文件：`src/features/player/hooks/useAudioPlayer.ts`（`:1504-1519` `createPlaylistFromTracks`、`:1239-1274` `ensurePlaylistSummaries`、`:894-898` `commitPlaylistSummaryStatus`）
- 思路：`createPlaylistFromTracks` 在 `:1517` 之前先把 `playlistSummaryRowsRef[scope]` 写成「k 行全为 `pendingPlaylistTrackRow` 派生的空标签行」并 `commitPlaylistSummaryStatus(scope, 'ready')`，让 `ensurePlaylistSummaries` 以「已有行但需刷新」的形态跑，而不是「无行 + loading」。
- 副作用：
  - **语义风险高**：`'ready'` 在 `docs/architecture/playlist-track-summaries.md` 里是有明确验收条款的承诺 ——
    - AC-16（该文档 :419）：「一轮 pass 只产生一次摘要 state 更新；**ready 之后不再因摘要触发 `shapeKey` 变化或整表几何重测**」
    - 同文档 :353（风险 R2）：「摘要落地必须早于行挂载（加载态 → ready 才渲染行）」
    伪造 `'ready'` 会让 `PlaylistPanel` 立刻以文件名行挂载 N 张卡，随后真实 tag 落地时再改行 → **直接违反 AC-16/R2**，并重新引入 1791 卡整表几何重测的风险。
  - 还会绕过 `:1257` 的幂等早退语义，可能让后续真实 pass 被误判为「已完成」。
  - 影响所有 `ensurePlaylistSummaries` 调用者，不只是新建。
- **风险等级：高**。不建议作为首选项。

**方向 C（折中，推荐）：给搜索页单独的门控，不与列表页共用同一份状态**
- 涉及文件：`src/features/player/components/PlayerShell.tsx`（`:454` 新增独立派生值 + `:513` 用它）、可选 `src/features/player/model/playerUiViewModel.ts`（若需要把「部分就绪」表达为第三种状态）
- 思路：搜索页的语义是「跨 source 的聚合检索」，它对「某条会话歌单尚未落定」的容忍度远高于播放列表详情页。可引入 **`searchRowsReady` 与 `libraryRowsReady` 分离**：搜索页只在**没有任何行可渲染**时才显示 loading，一旦有部分行就渲染。
- 副作用：
  - 需要新增一个「至少一条 source ready」的判据，`SearchPanel.tsx:189` 的 `loading` 语义随之改变（从「全部就绪」变为「无内容可显示」）。
  - 与方向 A 部分重叠；方向 C 是 A 的语义化版本（A 是改集合，C 是改判据）。
  - 需要同步更新 `searchPageAcceptance.browser.test.mjs` 与 `PlaylistLibraryPanel` 侧对 `allSongsMetadataStatus` 的假设（后者**不受影响**，见 §7.0）。
- **风险等级：低–中**。推荐。

**共同注意**：`allSongsRowsReady`（`:432-436`）**不要**跟着改。它遍历 `libraryFolderPlaylists`，custom 歌单本来就不在其中，改成「仅当前可见 scope」反而会让「全部歌曲」页在文件夹扫描期间提前放行，属于**扩大**风险面而非收窄。

### 7.5 这一节留下的可证伪判据

| 判据 | 若成立 | 若被否定 |
|---|---|---|
| 新建 k 首 custom 歌单后，`searchRowsReady` 应从 `true`→`false`→`true` | 本节的 (a)(b) 成立 | 说明 `librarySources` 未包含新 scope，§7.1 链路有误 |
| 同一时刻 `allSongsRowsReady` **应保持** `true` | §7.0 的集合不对称成立 | 说明 custom 歌单意外进入了 `libraryFolderPlaylists` |
| 搜索页在 `loading` 期间 `nonempty` 为空但 `:212` 状态行可见 | (c) 的表现形态成立 | 说明还有别的加载分支 |
| 把 `searchRowsReady` 收窄后，搜索页不再因新建/追加歌单变慢 | 方向 A/C 有效 | 说明慢的主因是候选 #1 的 tag pass 本身（与门控无关），应回落到 §2.1 |

> **与 §6 时序判据的关系**：§6 第 4 条的「添加后立刻打开 vs 等 5s 打开」仍然是**区分 #1/#2 与 #3/#5** 的判据，保留不动。本节 §7.5 是**叠加在上面**的：先按 §6 判定「是否为整表 pass 在飞行中」，再按 §7.5 判定「这个 pass 是否同时打穿了搜索页门控」。

---

## 8. 实测结果（Lead 执行，2026-11-02）

> **范围说明**：§8 测的是"歌单详情页在加入前后"的对比。用户随后澄清真正的问题是**媒体库下各个视图的列表都慢**，且 10-25 版本已有「所有歌曲」可作基线 —— 那部分在 **§9**，且结论与 §8 不同，请以 §9 为最终口径。

本节由 Lead 在 §1–§7 的静态分析之上补充**实测数据**，并据此修正了两处静态判断。测量工具为 `tools/perf-regression/`（主工作树），跨版本工作树由 `tools/perf-regression/versions/` 管理。

### 8.1 方法与可比性

- 真实 Vite dev server + 真实 msedge（Playwright），视口 1600×1000，`reducedMotion: reduce`。
- **只有原生 IPC 边界是假的**：`audioCommands.ts` 被打桩为 `window.backendInvoke`，其余全部是生产代码（真实 PlayerShell、真实 PlaylistPanel、真实封面解码与 BMP/objectURL 管线）。
- 固定延迟模型（写入 `results.json.engine.mockedLatencyModel`）：`audio_load_track_thumbnail` 18ms、`audio_load_playlist_cover_pixels` 22ms、`audio_hydrate_track` 6ms、摘要/时长探针 2ms + 0.35ms/首。调度器并发上限 4（生产值）。
- 场景（`--playlist-size 300 --selection 6`）：
  - **SW**：300 首歌单，打开一次让其摘要/时长/封面全部落定，关闭后**重新打开**并测量。这是用户实际对比的基线——"我平时打开这个歌单是瞬间的"。
  - **S3**：同一 300 首歌单，从媒体库 songs 页追加 6 首后**立即打开**并测量。
  - S1/S2：搜索页选 6 首**新建**歌单后打开 / 冷开同等内容的 6 首歌单（小规模对照）。

### 8.2 跨版本结果

| 版本 | commit | 场景 | t90 首屏封面 | 原生请求数 | 建模成本 | 追加动作耗时 |
|---|---|---|---:|---:|---:|---:|
| V1 | `8f45750` 10-25 | SW 热重开 | 234.2 ms | **0** | 0 ms | — |
| V2 | `6a7da1b` 10-28 | SW 热重开 | 394.9 ms | **0** | 0 ms | — |
| V3 | `9e8d41c` 10-30 | SW 热重开 | 248.1 ms | **0** | 0 ms | — |
| V3 | `9e8d41c` | S3 追加后打开 | 426.5 ms | 20 | 350 ms | 292.4 ms |
| V4 | `ce65f67` 10-30 | SW 热重开 | 276.2 ms | **0** | 0 ms | — |
| V4 | `ce65f67` | S3 追加后打开 | 420.8 ms | 20 | 350 ms | 285.0 ms |
| V5 | 工作树(WIP) | SW 热重开 | 265.9 ms（3/3） | **0** | 0 ms | — |
| V5 | 工作树(WIP) | S3 追加后打开 | 453.7 ms（3/3） | 20 | 350 ms | 275.1 ms |

V5 为 `--repeat 3`，三次 SW 全部 0 原生请求（257 / 265.9 / 290.3 ms），三次 S3 全部 20 条（485.1 / 453.7 / 414.0 ms），差异稳定不重叠。

### 8.3 结论一：歌单列表加载本身**没有**跨版本退化

V1（10-25）与 V4/V5 的**热态重开**都是 **0 次原生请求**、t90 同一量级（234 ms vs 266–276 ms，差异在单次运行的噪声范围内）。即"打开一个已加载过的歌单"这一行为在 10-25 与现在**同样快**。

**因此"10-25 版本更快"不能作为性能回归的证据**：`8f45750` 既没有 `SearchPanel`，也没有任何 `onAddToPlaylist` / `canAddToPlaylist` / `library_add_playlist_tracks`（见 §0.1、§3）。10-25 之所以"没有这个问题"，是因为**这条操作路径当时不存在**，而不是当时的列表加载更快。

### 8.4 结论二：真正的差异在"追加之后"，且三个近期版本表现一致

同一份 300 首歌单：

| 状态 | t90 | 原生请求 | 增量 |
|---|---:|---:|---|
| 热态重开（无追加） | 265.9 ms | **0** | 基线 |
| 追加 6 首后打开 | 453.7 ms | **20** | **+188 ms（+71%），0→20 条** |

命令构成（S3 单次）：`audio_load_track_thumbnail` ×18（324 ms）、`audio_probe_playlist_cover` ×1、`audio_load_playlist_cover_pixels` ×1。

可见行固定为 12 行。**18 = 12 个原本已缓存的可见封面 + 6 首新歌**。也就是说：追加动作让**本来已经缓存好的 12 个可见封面被重新请求了一遍**，而不只是加载新增的 6 首。

这精确复现了用户描述的体感——"加完歌之后，这个歌单的列表要重新刷一遍"。

V3 / V4 / V5 三个版本在同一条路径上的数字（20 条 / 350 ms / t90 420–454 ms）**完全一致**，说明这不是 `9e8d41c` 或 `ce65f67` 之间的回归，而是随"添加到播放列表"功能本身（`6a7da1b`，10-28）一起存在的既有行为。

### 8.5 对静态分析的修正

**修正 1（重要）：整表摘要重读发生在"追加动作"内，不在"打开歌单"时。**
§4 的候选 #1 预测打开时会出现"整表摘要 pass + 骨架屏"。实测在**打开窗口内** `audio_probe_playlist_track_summaries` 计数为 **0**；而 `addActionMs` 稳定在 258–302 ms——整表摘要与时长 pass 被 `ensurePlaylistSummaries`（`useAudioPlayer.ts:4436`）在 `addToPlaylist` 内部就起跑了，成本计入**动作本身**。

因此候选 #1/#2 应改写为：**"追加动作耗时 ∝ 整表规模，而非 k"**（用户点"添加"后要等 ~270–290 ms），而不是"打开歌单时变慢"。

**修正 2：打开变慢的直接原因是可见封面需求被重置，而非摘要门控。**
§6 第 4 条的时序判据（"添加后立刻打开 vs 等 5s 打开"）得到回答：S1b（创建后离开页面、等 2.5 s 再打开）与 S1 几乎一致（337.3 vs 345.7 ms），说明打开窗口里没有"在飞行中的整表 pass"在抢资源。打开变慢来自 20 条封面请求本身。

### 8.6 结论三：搜索页"新建歌单"不会变慢

| 场景 | t90 | 说明 |
|---|---:|---|
| S1 搜索页选 6 首新建歌单 → 立即打开 | 345.7 ms | k=6 |
| S1b 同上，但离开页面 2.5 s 后再打开 | 337.3 ms | k=6 |
| S2 冷开同等内容的现有歌单 | 352.0 ms | k=6 |

三者差异在噪声内，且三者的 sourcePath 集合哈希相同（`a1e71fb0`），证明输入一致。**新建列表只有 k 首，没有 N 倍放大**，与 §1.4 的推断一致。

### 8.7 证据边界（必须与结论一起读）

1. **mock 未模拟磁盘缓存命中**：`audio_load_track_thumbnail` 恒为 18 ms/次。真实环境里这 18 条请求中 12 条是**已持久化的缩略图**（用户机器上 `thumbnail-index-v1` 有 2356 条），实际磁盘读取通常只需数毫秒。所以 **+188 ms 是"固定 18 ms 模型"下的上界，不能当作真实设备上的感知增量**。真实感知增量应当接近"12 次本地缓存读 + IPC 往返"。
2. **请求数 0→20 是结构性事实**，与缓存快慢无关：它证明追加后已缓存的可见封面被重新取了一遍。
3. 摘要/时长 pass 的真实耗时同样受 mock 影响（2 ms + 0.35 ms/首 × 306 首 ≈ 109 ms）。真实 Rust 侧 `audio_probe_playlist_track_summaries` 要真读标签，成本高于模型。
4. V1/V2 无法做"追加"对照：V1 无该功能；V2 的加歌对话框 UI 与现行选择器不兼容（`.playlist-selection-action` / `PlaylistSongDialogs` 形态不同），S3 在该版本超时失败——**这是"无法测量"，不是"测得没有差异"**。
5. 以上均为受控浏览器 + 打桩 IPC 的结果，不等于用户真实设备、真实曲库、真实缓存状态下的绝对耗时。

### 8.8 给结论定性的最简判据（若需进一步确认）

在真实设备上，只需测量两次打开同一歌单的**磁盘读取次数**：
- 追加前打开：`audio_load_track_thumbnail` 调用数应为 0（或仅窗口外预取）。
- 追加后打开：若该数字跳升到"可见行数量级"，则 §8.4 在真实环境成立，且成本 = 该次数 × 本地缓存读取耗时。

若真实增量远小于浏览器模型的 +188 ms，则说明用户感知的"变慢很多"另有来源（例如同时发生的 `addActionMs` 270 ms 被体感算进了"加入之后"），需按 §8.5 修正 1 的口径重新定位。

---

## 9. 用户澄清后的主口径：媒体库各视图的列表加载（跨版本）

### 9.1 用户澄清带来的口径修正

用户随后说明两件事，改变了问题的定义：

1. **10-25 版本已经实现了「所有歌曲」**，可以直接用它做基线。
2. **加载缓慢是媒体库下各个视图的列表都存在的**，不只是歌单。

这使 §8 的"搜索页加入 → 歌单变慢"从主口径降为**一个子场景**。§8 的结论（不是版本回归、成本 ∝ 整表规模）在方向上仍然成立，但**必须用「所有歌曲」这一跨版本可比的视图重新验证**。

### 9.2 测量口径

- 视图：媒体库 → **所有歌曲**（`onSelectCategory('songs')`）。该视图在 `8f45750` 与当前版本都存在，是唯一可跨全部版本对比的列表视图。
- 关键指标 **`firstRowAtMs`**：从切换视图到**第一行卡片真正渲染**的时间。这个视图在标签/时长未就绪时渲染的是骨架屏（`PlaylistMetadataLoading`），所以"首行出现"就是用户看到的"列表加载完成"。
- `t90FirstVisibleMs`：随后初始可见行封面到齐的时间。
- 曲库由 fixture 扫描产生（`--library-size`），封面/标签/时长的延迟模型与 §8 相同。

### 9.3 跨版本结果：10-25 与现在**同样慢**

1800 首曲库（接近用户真实曲库 1791 首），`--repeat 2`，两侧曲目集合哈希一致（`0a794675`）：

| 版本 | `firstRowAtMs` | t90 | 原生请求 | 其中摘要探测 | 其中封面 |
|---|---:|---:|---:|---:|---:|
| **V1 `8f45750`（10-25）** | **1497.5 ms** | 1621.9 ms | 24 | 16 批 / 1292 ms | 28 / 504 ms |
| **V5 当前工作树** | **1451.9 ms** | 1566.8 ms | 27 | 16 批 / 1292 ms | 34 / 612 ms |

**当前版本比 10-25 还快约 46 ms（3%）。**

900 首曲库（`--repeat 3`）：

| 版本 | `firstRowAtMs` | t90 | 原生请求 | 摘要探测 | 封面 |
|---|---:|---:|---:|---:|---:|
| V1 `8f45750` | 699.7 ms | 781.6 ms | 22 | 12 批 / 969 ms | 47 / 846 ms |
| V5 当前 | 812.2 ms | 886.2 ms | 25 | 12 批 / 969 ms | 57 / 1026 ms |

### 9.4 结论

**结论 1：这不是版本回归。** 「所有歌曲」列表的首行时间在 10-25 与当前版本基本持平（1800 首：1498 vs 1452 ms）。用户描述的"加载缓慢"在 10-25 版本上**同样存在**，因此不能用"10-25 更快"来定位回归。

**结论 2：慢是结构性的，成本与曲库规模成正比。**
同一版本（V5）扫描不同曲库规模：

| 曲库曲目数 | `firstRowAtMs` | 摘要批次数 | 摘要探测耗时 |
|---:|---:|---:|---:|
| 90 | 383.5 ms | 1 | 33.5 ms |
| 300 | 530.9 ms | 2 | 109 ms |
| 900 | 812.6 ms | 4 | 323 ms |
| 1800 | 1451.9 ms | 8 | 646 ms |

近似线性：约**每 300 首 +190 ms**。原因是 `allSongsRowsReady`（`PlayerShell.tsx:432-436`）要求**每一个** folder source 的标签摘要与时长都 `ready` 才渲染行，而摘要通道没有缓存，必须整库探一遍（`audio_probe_playlist_track_summaries`，每批 256 首）。

**结论 3：跨版本唯一可测的差异是封面前瞻预取数量，不是列表主路径。**
两个版本的摘要探测命令数**完全相同**（900 首：12 批 / 969 ms；1800 首：16 批 / 1292 ms）。差异只在 `audio_load_track_thumbnail`：当前版本每次打开多取约 3 条（900 首：15.7 → 19 条/次；1800 首：14 → 17 条/次），对应约 +50～110 ms。这是窗口外预取的取舍，不是主路径退化。

### 9.5 各视图的普遍性

- 「所有歌曲」已量化（§9.4）。
- 专辑/艺术家/文件夹等集合视图在 `8f45750` 不存在（分别由 `e0572a5` / `d0a967e` / `336f14b` 引入），**无法与 10-25 对比**，只能在其各自的引入版本之后对比。
- 已实测专辑视图（900 首曲库，V5）：`firstRowAtMs` 641.7 ms、t90 689.3 ms、10 条原生命令。它**不经过标签摘要门控**（卡片不显示歌曲标签），主要成本是封面像素加载。因此"各视图都慢"在机制上是**两个不同的成本**：歌曲列表慢在标签探测（∝ 曲库），集合视图慢在封面加载（∝ 可见卡片数）。
- fixture 的专辑只有 3 个（`album = 'Album ' + index % 3`），不足以代表真实专辑规模，这一条只是方向性证据。

### 9.6 证据边界

1. **mock 未模拟磁盘缓存命中**：所有 `audio_load_track_thumbnail` 恒 18 ms。真实设备上这些多为已缓存缩略图，封面部分实际更快；而**摘要探测要真读标签，真实成本只会比模型更高**。因此 §9.4 的"列表加载 ∝ 曲库规模"在真实环境只会更明显，不是被 mock 夸大出来的。
2. 浏览器 + 打桩 IPC 的绝对数值不等于真实设备；但**两端（V1 / V5）用同一模型测量**，其相对结论（无版本退化、成本 ∝ N）不受模型选择影响。
3. 未覆盖：真实 1791 首曲库、真实磁盘、Windows Defender 实时扫描、多个 folder 根目录并存等场景。

### 9.7 若要真正降低这个耗时，方向在摘要通道而非渲染

实测已经排除了渲染与门控形状是版本回归的可能。若要缩短"列表首行"的等待，可按成本排序考虑（**均未实施，仅方向**）：

1. **让摘要探测不阻塞首行**：允许以文件名行先挂载、标签落地后就地更新。但这与 `docs/architecture/playlist-track-summaries.md` 的 AC-16 / R2 冲突（§7.4 方向 B 已记录），需要先改验收条款。
2. **只探测可见窗口**：当前是整库探测后才渲染；若改为"先探测可见窗口的 N 行即可渲染"，首行时间可从 ∝ 全库降为常数。风险是滚动时后续行仍会经历一次标签补齐。
3. **Rust 侧给标签摘要加持久化缓存**（类似 `thumbnail-index-v1`）：二次启动后不再整库重读标签。这是收益最大且不改前端语义的路径，但需要新增缓存结构与失效策略。
4. 缩略图预取条数可回收约 50～110 ms（当前版本比 10-25 多取 3 条/次），优先级最低。
