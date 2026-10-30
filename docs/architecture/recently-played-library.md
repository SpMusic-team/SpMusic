---
doc_id: "ARCH-RECENTLY-PLAYED-LIBRARY"
title: "最近播放分类与有效播放记录契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-10-30"
updated: "2026-10-30"
source_documents:
  - "user request: 仿照 Poweramp 实现媒体库最近播放，复用所有歌曲列表、控制器、行为、样式和动效，去除字母索引"
  - "docs/architecture/poweramp-recents-views.md"
  - "src/features/player/hooks/useAudioPlayer.ts"
  - "src/features/player/model/playbackQueue.ts"
  - "src/features/player/model/playbackSessionStorage.ts"
  - "src/features/player/components/PlayerShell.tsx"
  - "src/features/player/components/PlaylistLibraryPanel.tsx"
  - "src-tauri/src/audio/runtime.rs"
---

# 最近播放分类与有效播放记录契约

## 1. 决策与范围

最近播放是当前媒体库歌曲的派生视图，每首歌曲保留最近一次有效播放时间。页面直接复用所有歌曲的歌曲行、虚拟化、封面调度、布局、动效、搜索、选择及播放控制器；不显示右侧字母索引。分类 ID 复用已有 `recent-played`。

本轮固定采用累计实听达到曲长 50% 的有效播放规则，不增加可调门槛、条数、时间窗口、最近添加、最多播放或逐次播放历史。50% 是 SpMusic 本轮实现基线；Poweramp 的写入 SQL 尚未完整取证，不能据此声称两者逐项一致。

记录与展示均由前端实现，沿用项目现有 localStorage 持久化方式，不新增 Rust command、数据库、依赖或权限。现有媒体库实体没有对应的数据库曲目表，故不把外部参考中的 SQL 结构原样搬入。

## 2. 模块与数据契约

纯模型维护最近记录和有效播放累计；`useAudioPlayer` 在已接受的后端状态入口驱动模型；`PlayerShell` 把记录与当前所有歌曲投影关联；`PlaylistLibraryPanel` 根据页面类别复用同一个歌曲列表。

持久化数据的逻辑形状：

```ts
type RecentPlaybackEntry = { sourcePath: string; lastPlayedAt: number }
type RecentPlaybackStorage = { version: 1; entries: RecentPlaybackEntry[] }
```

使用独立键 `spmusic.recently-played.v1`。`lastPlayedAt` 为通过阈值时的 Unix 毫秒时间；只持久化已达阈值的记录，不持久化未完成累计、歌曲详情、封面、播放次数或另一份播放列表。

歌曲身份使用已有 `normalizeAudioSourcePath`，与媒体库相同规范化规则，不新增独立大小写规则。读入时验证版本、路径、有限正数时间，按规范化路径去重并保留最新时间。损坏数据退化为空；存储不可写时保持内存操作和播放可用，沿用现有会话存储的异常容忍方式。

记录按稳定路径存储，重新扫描、重新注册同路径后可关联。不要在扫描加载期间因为当前列表暂空而清除记录。移动或重命名文件不做身份迁移；当前库中找不到的路径不展示。

## 3. 有效播放累计

输入使用 `applyAudioState` 已通过既有 selection、generation、transport-intent 和过期请求校验后的原始后端状态。不得使用乐观展示曲目、视觉进度时钟、点击播放动作次数或 `positionMs >= durationMs * 0.5` 代替实听累计。

模型至少维护当前 `{trackId, generation}`、上一确认样本位置、单调时间、累计实听、是否已提交。样本之间满足以下条件时才累计：

- 当前曲目和加载 generation 相同，前一状态是确认的 `playing`，后一状态为 `playing`，或自然 `ended` 的最后一个区间。
- 区间没有 seek pending、加载、错误、暂停、停止、未完成的 transport transition 或选曲过程。
- 位置正向推进且与单调时间差相符。累计值不超过位置增量、单调时差和采样空档上限中的最小值；明显跳变直接丢弃区间。500ms 轮询可采用约 1500ms 空档上限与小幅校准容差，避免系统挂起或陈旧样本一次性计入大量时长。

重复位置不累计；回退不累计；轮询次数自身不形成播放量。所有 seek 路径在发出命令前断开采样基线，结果返回且既有短期 seek 保护窗口结束后重新建立基线；保留本轮已实听累计，不把拖动距离计入。保护窗口必须同时匹配曲目及 `expiresAt`，不能因保护对象仍存在而永久阻止后续累计。暂停与恢复同样保留累计但断开区间。

已知有限正数曲长时，累计达到 `durationMs * 0.5` 后更新该路径时间一次。未知时长不提前认定。路径详情晚到时必须匹配当前确认 trackId；达阈值可等待匹配详情后提交，不能写到上一首路径上。

新加载 generation 即新一轮播放，同曲目重复加载也重置累计。后端 `runtime.play` 可在同一 generation 的 `ended` / `stopped` 状态或显式 `restart:true` 时从头重播，因此这些确认的重播起点也重置累计；普通暂停恢复与 seek 回零不重置播放轮次。每轮首次达阈值提交一次，后续相同状态不能持续刷新排序。未达阈值累计不跨应用重启延续。

## 4. 列表集合与排序

从当前所有歌曲投影中按规范化路径与已完成记录求交集；路径重复出现只展示一首，复用所有歌曲已有的可播放来源选择。按 `lastPlayedAt DESC` 排序，同毫秒以规范化路径稳定排序。没有记录时显示最近播放空态；未达阈值的新歌曲不进入列表。

搜索、选择、布局切换使用同一歌曲组件与操作契约。最近播放没有字母索引；按时间排序时无需保留该索引的预留空间。用户未要求自定义排序或拖动改变最近播放顺序，不能把所有歌曲的手动排序存储误写成最近记录。

有效记录更新可以使展示列表重排；此重排不改变正在运行的播放快照。

## 5. 播放源身份与稳定队列

扩展 `PlaybackQueueOrigin.kind` 为 `'all-songs' | 'recent-played' | 'playlist'`。前两种都是跨来源的派生歌曲集合，不带 `sourceScope` 或 `sourcePlaylist`；playlist 维持既有约束。来源校验函数与会话恢复同时支持新 kind 和旧快照。

最近播放点击歌曲、播放全部或随机播放时，将该次操作对应的有序 `{scope, trackId}` entries 传给既有快照建队列流程。快照标题为“最近播放”，保留独立 origin kind；不创建用户歌单，不新增 Tauri 数据合同。

显示当前播放源、从播放器返回来源页面和重启恢复必须保留 `recent-played` 身份；复用 all-songs 的数据装载/封面暖缓存分支时，派生集合判断应覆盖两种 kind。不能仅为省一项来源判断把 recent 队列伪装成 all-songs。

播放列表快照仅由显式播放/队列操作建立。达到阈值、搜索变化、重新扫描或最近列表重排不能自动替换正在运行的快照或改变当前索引，下一首仍按建队列时的序列执行。

## 6. 备选方案与取舍

| 方案 | 结果 |
| --- | --- |
| 沿用 localStorage 保存按路径聚合时间 | 选择；与既有会话持久化一致，写入频率为每轮最多一次，范围最小 |
| Rust 数据库曲目列与 SQL 派生视图 | 当前没有对应持久化模型，会扩大迁移、命令及测试范围，暂不引入 |
| 逐次播放历史表 | 与一曲一条的最近播放集合不同，产生不必要的数据模型 |
| 借用 playlist sourceScope 表示最近播放 | 混淆真实来源歌单与跨库派生集合，返回路径和恢复更难保证 |

localStorage 无法承诺超出既有应用存储环境的耐久性；存储失败不阻止听歌。窗口异常关闭前已成功写入的有效记录可恢复，未完成实听轮次丢弃。

## 7. 实施所有权与验收

本轮 Frontend Agent 独占 `src/**` 修改，包括新纯模型/存储/测试、`useAudioPlayer.ts`、`playbackQueue.ts`、`playerUiViewModel.ts`、`PlayerShell.tsx`、`PlaylistLibraryPanel.tsx` 及必要的现有测试；不得覆盖该 hook 里任务开始前已有的封面相关修改。Architecture Agent 只写本文，Rust 文件无需变更。Test Agent 独立复核，可另行明确分配测试文件，避免与实施者同时写同一路径。主 Agent 最终整合并执行仓库检查。

验收覆盖：

- 49% 不进入、达到 50% 进入、再次有效播放更新时间、一曲一条；暂停、seek、重复轮询、旧 generation、系统长空档不制造实听。
- 同歌新 generation、同 generation 明确重播、自然结束最后区间、未知时长与晚到详情均按第 3 节处理。
- 重启保留记录与 recent 队列来源；坏存储和写入失败不破坏播放。
- 最近页面复用所有歌曲列表和控制器，无字母索引；列表更新不改播放快照顺序，返回来源正确。
- 所有歌曲及原有 playlist 的恢复、随机、选择、搜索与封面行为不回归。

验证纯模型/存储与队列校验单测，再执行相关浏览器交互测试和项目 build/lint。无需更改 Rust 时不以新增 Rust 测试代替前端行为证据。
