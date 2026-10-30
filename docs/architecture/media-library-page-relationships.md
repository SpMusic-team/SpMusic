---
doc_id: "ARCH-MEDIA-LIBRARY-PAGE-RELATIONSHIPS"
title: "媒体库三页面（所有歌曲/文件夹/文件夹层次结构）数据关系与并包关系现状"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-10-27"
updated: "2026-10-28"
source_documents:
  - "user request: 记录媒体库「所有歌曲 / 文件夹 / 文件夹层次结构」三页面的数据关系与并包关系，作为后续完善该页面的实现依据"
  - "shared task: task-5 记录媒体库三页面数据关系与并包关系"
  - "docs/decisions/2026-07-09-document-metadata-standard.md"
  - "docs/architecture/playlist-track-summaries.md"
  - "docs/architecture/playlist-duration-cache.md"
  - "src/features/player/components/PlayerShell.tsx"
  - "src/features/player/components/PlayerSurface.tsx"
  - "src/features/player/components/PlaylistLibraryPanel.tsx"
  - "src/features/player/components/FolderHierarchyPanel.tsx"
  - "src/features/player/components/FolderHierarchyCard.tsx"
  - "src/features/player/model/folderHierarchy.ts"
  - "src/features/player/model/mediaLibraryCategories.ts"
  - "src/features/player/model/playbackQueue.ts"
  - "src/features/player/model/playerUiViewModel.ts"
  - "src/features/player/model/playlistTrackSummary.ts"
  - "src/features/player/model/quickIndex.ts"
  - "src/features/player/model/playlistDuration.ts"
  - "src/features/player/hooks/useAudioPlayer.ts"
  - "src/features/player/services/audioCommands.ts"
  - "src-tauri/src/audio/types.rs"
  - "src-tauri/src/audio/playlist.rs"
  - "src-tauri/src/audio/source.rs"
  - "src-tauri/src/library_folders.rs"
  - "user request: 文件夹平铺展示所有存储中直接含歌的目录，进入后只显示直接歌曲，不包含子文件夹"
  - "user request: 所有无 hero 分类根页面增加所有歌曲式快速索引"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=7645-15884"
  - "src/features/player/components/CollectionQuickIndex.tsx"
---

# 媒体库三页面（所有歌曲 / 文件夹 / 文件夹层次结构）数据关系与并包关系现状

## 摘要

三个分类共享同一份按用户存储选择投影、按歌曲路径去重的曲库，但呈现方式和目录作用域不同：

- **所有歌曲**：展示曲库中的歌曲。
- **文件夹**：平铺所有直接含歌的目录，覆盖已添加存储中的任意深度；进入后只展示本层歌曲，不展示子目录或子目录歌曲。
- **文件夹层次结构**：从已选存储根逐层浏览，当前目录同时展示直接子目录和直接歌曲；目录卡片与 hero 的统计仍按子树计算。

因此，文件夹页的各直接歌曲集合构成所有歌曲集合的分组；层次结构中的各递归子树可以相互包含。这两种目录集合不能混用。

本页反映 2026-10-28 的实现契约，依据用户明确的文件夹语义及对应 Figma 设计更新。2026-10-27 的“文件夹页是每个注册根一张递归播放列表卡片”已被本次实现替代，旧结论的追溯见第 10 节。Poweramp 文档是外部参考，其未取证行为不能覆盖这里已确认的 SpMusic 规则。

## 1. 范围与实现边界

本文覆盖三页面的数据来源、目录归属、导航、播放候选范围、封面选择、排序与快速索引。标签、时长、封面的通道内部契约仍由各自架构文档维护。

本次没有新增 Rust command、文件权限、扫描机制、存储格式或播放队列 origin 类型。新增文件夹视图来自现有扫描结果的前端派生；注册存储根不等于创建用户播放列表。

其他分类的根页沿用现有数据接入状态。本次添加快速索引不代表专辑、艺术家等分类已具备数据能力。播放列表详情页仍使用原有详情实现，不属于两个文件夹模式的目录浏览。

## 2. 数据链路与身份

### 2.1 数据链路

| 层 | 当前职责 | 实现定位 |
| --- | --- | --- |
| Rust 扫描 | 递归读取注册根，产出曲目描述符和成功枚举的目录路径 | `src-tauri/src/audio/playlist.rs` 的递归库扫描；`audio/types.rs` 的 `AudioFolderPlaylist` |
| 目录选择 | 保存存储根及子目录选择规则，将扫描结果投影为当前选中的曲目和目录 | `useAudioPlayer.ts` 的 `visibleLibraryFolderPlaylists`；`folderSelection.ts` 的 `projectSelectedFolder` |
| 曲库聚合 | 遍历已投影的 `libraryFolderPlaylists`，按歌曲路径去重；准备摘要、时长与当前播放信息 | `PlayerShell.tsx` 的 `allSongDescriptors`、`allSongsRows`、`allSongs` |
| 平铺目录 | 将聚合歌曲按直接父目录分组，只产生有直接歌曲的目录 | `folderHierarchy.ts` 的 `flatFolderEntries` |
| 层次目录 | 从根、已枚举目录和歌曲路径导出直接子目录；保留根状态与选择约束 | `folderHierarchy.ts` 的 `folderEntries`、`folderRootSongs` |

`librarySources` 和 `library.items` 仍供播放列表及其他已有消费者使用，但其中每个注册根的递归摘要**不是文件夹平铺页的数据源**。即使注册根没有直接歌曲，其后代的含歌目录仍会在平铺页出现；注册根仅有后代歌曲时，它本身不产生平铺卡片。

`library.allSongs` 仅聚合库文件夹来源，不并入 M3U8 或自定义播放列表。同一歌曲加入多个播放列表不会增加文件夹页的目录或曲目。

### 2.2 身份与来源

| 字段 | 含义 |
| --- | --- |
| 歌曲 `key` | `normalizeAudioSourcePath(sourcePath)`；统一分隔符，保留大小写与 UNC 身份 |
| `trackId` | 后端歌曲身份；不能用歌曲标题代替 |
| `scope` | 描述符来源列表身份，由 `playlistScope` 构造；聚合去重保留首次命中的来源 |
| 目录 `path` | `parentFolder(sourcePath)`，以完整规范化路径区分目录；同名目录不合并 |
| `rootPath` | 层次模式中的选中根；平铺模式中仅作为导航、滚动及投影身份的一部分 |

平铺详情按完整目录路径从聚合歌曲中过滤，**不以导航锚点 `rootPath` 限定歌曲来源**。同一物理目录经多个重叠存储根可达时只出现一张卡片；其中每首歌曲仍保留实际可解析的 `scope/trackId`，不为该目录伪造一个新 scope。

路径大小写策略本次没有整体调整。聚合的 `key`、目录工具、目录选择规则与后端 track ID 的身份规则仍需分别遵守现有契约，不能因为平铺分组而假定它们使用相同的大小写折叠方式。

## 3. 集合关系

记：

- `R`：当前处于启用状态的存储根。
- `S(r)`：根 `r` 的递归扫描结果；`P(r)`：按已提交目录选择规则投影后的歌曲。
- `A = dedup_key(⋃ P(r))`：三页面共同消费的聚合歌曲。
- `B(d) = { s ∈ A | parentFolder(s.sourcePath) = d }`：目录 `d` 的直接歌曲。
- `F = { d | B(d) 非空 }`：平铺页的目录集合。
- `H(r,d)`：根 `r` 的选择范围内，位于目录 `d` 子树中的聚合歌曲。

在未施加搜索、多选、可用性过滤时：

| 断言 | 当前结论 |
| --- | --- |
| `⋃ B(d) = A`，其中 `d ∈ F` | 成立；每首歌曲恰有一个直接父目录 |
| `Σ |B(d)| = |A|` | 成立；平铺目录之间的直接歌曲集合互不重叠 |
| 不同目录 `d1 ≠ d2` 的 `B(d1) ∩ B(d2)` | 空集，即使两个目录是父子关系 |
| 平铺卡片歌曲数 = 进入该目录后未搜索的歌曲数 | 成立；二者都取 `B(d)` |
| 父目录卡片包含子目录歌曲 | 平铺模式不成立；层次模式的递归统计可以成立 |
| `Σ |P(r)| = |A|` | 仅各根歌曲集合互不重叠时成立；原始根扫描的重复不再传递为平铺卡片重复 |
| 层次结构当前目录的直接歌曲 ⊆ `A` | 成立；仍受当前根目录选择约束 |
| 平铺目录集合 = 层次结构当前层目录集合 | 通常不成立；前者跨层，后者只展示直接子目录 |

例：`Music/root.flac`、`Music/Album/a.flac`、`Music/Album/Disc/b.flac` 产生三张平铺卡片，各含一首歌。进入 `Music/Album` 只看到 `a.flac`；在层次结构中进入该目录则还能看到 `Disc` 子目录，其子树统计含两首歌。若移除 `root.flac`，`Music` 不再出现在平铺页，但层次结构仍可用它导航到后代。

## 4. 路由、位置与组件

| 页面 | 路由及位置 | 渲染 |
| --- | --- | --- |
| 所有歌曲 | `category:songs` | `PlaylistLibraryPanel` |
| 文件夹根列表 | `category:folder`，`flatFolderLocation = null` | `FolderHierarchyPanel categoryId="folder"` |
| 文件夹直接歌曲详情 | 同一分类，加 `flatFolderLocation` | 共享面板的平铺详情场景 |
| 层次结构根列表 | `category:folders`，`folderLocation = null` | `FolderHierarchyPanel categoryId="folders"` |
| 层次结构目录详情 | 同一分类，加 `folderLocation` | 共享面板的层次详情场景 |
| 播放列表详情 | `view: tracks` | `OwnedPlaylistPanel`，不承担上述目录浏览 |

`PlayerSurface` 将两个文件夹分类互斥挂载到共享面板。复用的是卡片、hero、窗口化歌曲、封面订阅、侧栏、菜单和导航基础设施；平铺与层次的数据范围由显式模式分支决定。

`PlayerShell` 分别持有两个位置状态。通过分类入口进入时重置对应分类位置；从播放器返回媒体库时，已有 `all-songs` 队列允许保留这两个文件夹分类及当前详情，避免无故跳到所有歌曲。此保留属于当前会话导航，不新增跨重启恢复目录位置的承诺。

平铺详情返回按钮始终回平铺根列表，不打开物理父目录；层次详情按目录层级返回。已完成扫描和选择更新后，若平铺当前目录已无直接歌曲，则清空平铺位置。失效清理由当前仍呈现的场景触发，退出动画保留的旧场景不应清空新位置；扫描、恢复或导入进行中不据暂时空集合判断目录失效。

导航、共享投影和滚动身份同时包含分类、根锚点与目录路径；卡片与进入后的 hero 使用同一身份。布局偏好独立保存在 `spmusic.flat-folders.layout-level.v1` 和 `spmusic.folder-hierarchy.layout-level.v1`，避免修改一个分类的视图档位影响另一个分类。

## 5. 播放范围与队列

### 5.1 队列契约

三个页面的歌曲播放统一经 `library.onPlaySong`／`library.onShufflePlay` 进入现有 `selectPlaybackQueueTrack`／`shufflePlaybackQueue`：

- origin 均为 `kind: 'all-songs'`，不带 `sourceScope` 或 `sourcePlaylist`。
- 每个候选 entry 仍携带 `scope` 与 `trackId`，用于解析真实歌曲描述符。
- `all-songs` 表示现有聚合队列 origin 类型，**不表示每次必须播放整个曲库**；具体范围来自传入的 entries。
- 失效来源、已排除目录或无法解析的描述符由现有队列入口拒绝；不把陈旧界面快照默默扩展为其他歌曲。
- 普通播放列表仍使用原有 `kind: 'playlist'` 契约，本次没有改动。

### 5.2 各入口范围

| 模式与入口 | 候选范围 |
| --- | --- |
| 所有歌曲：单曲、播放、随机 | 按现有歌曲搜索及多选规则生成可用歌曲候选 |
| 文件夹根页：播放／随机 | 当前搜索可见目录的直接歌曲之并集；多选态仅取所选目录，按歌曲 key 去重并过滤不可用项 |
| 文件夹详情：单曲／播放／随机 | 当前目录直接歌曲；受搜索、多选及可用性过滤，不并入子目录歌曲 |
| 层次结构根页：播放／随机 | 当前搜索可见根的递归歌曲之并集；多选时限制到所选根 |
| 层次结构详情：播放／随机 | 当前直接歌曲与可见子目录的递归歌曲，按现有搜索和多选规则生成候选 |
| 层次结构详情：点击单曲 | 当前显示的直接歌曲中的可用项 |

共享面板中，单曲激活沿用当前可见歌曲序列；多选态卡片点击为勾选。目录卡片点击仅导航，不直接播放。

层次结构依然存在“列表只列直接歌曲，hero／批量播放按子树”的既有范围差异。本次没有将层次模式改成平铺模式，也没有照搬 Poweramp 设置开关来调整该行为。

## 6. 元数据、统计与封面

### 6.1 摘要与时长

`PlayerShell` 的摘要预备、优先时长 scope 和聚合行呈现均覆盖 `songs`、`folder`、`folders`。平铺页不再依赖注册根递归摘要中的 `trackCount` 或 `totalClock`。

- 平铺卡片、详情 hero 和详情菜单的数量／时长按直接歌曲计算。
- 层次卡片和 hero 按相应递归子树计算，歌曲列表仍是直接歌曲。
- 不可用歌曲可以显示但不进入播放候选；时长求和遵守现有可用性与未知时长处理。
- 标签、时长尚未准备好时沿用现有加载机制；不以全量详情 hydrate 替代摘要通道。
- 手动歌曲顺序影响所有歌曲页的现有顺序规则，平铺分组始终由路径决定，不改变目录归属。

### 6.2 两种封面范围

| 模式 | 代表封面 | 通道 |
| --- | --- | --- |
| 平铺文件夹 | 同一直接歌曲集合中的第一首可用歌曲，若无可用项则保留第一项描述符；card 和 hero 使用相同候选 | 已有 track thumbnail；优先当前歌曲嵌入封面，缺失时可用同目录 sibling 图片 |
| 层次文件夹 | 既有目录封面策略，允许从目录子树择取封面 | 已有 folder thumbnail |

当前 Rust `load_folder_thumbnail_blocking` 会逐层深入子目录，不能直接用来实现平铺封面。平铺模式不调用它，以免当前目录无封面时错误显示子目录歌曲封面。代表歌曲不随详情搜索而改变，也不会为得到封面而把子目录歌曲加入候选。

共用 `useAllSongsWindow` 的调度与缓存、`useCollectionCoverUrl` 的订阅及现有 URL lease／释放机制；未引入第二套请求队列。层次模式的目录重扫版本继续由现有目录封面版本逻辑管理。

## 7. 搜索、排序与快速索引

- 两个文件夹根页按目录 `name + parentName` 搜索，再对已排序目录过滤；平铺详情和层次详情的歌曲按标题、艺术家、专辑搜索。
- 目录展示数组使用 `compareByQuickIndex(name)`，根页快速索引用同一字段的 `quickIndexKey(name)` 定位首个命中目录。搜索后的索引也只定位当前可见条目，不能跳到被隐藏目录。
- 文件夹模式的有 hero 详情不显示根目录索引；歌曲详情排序沿用现有标题 `localeCompare('zh-CN', { numeric: true })`。
- 两个文件夹根页使用 `CollectionQuickIndex`；其他分类根页由 `PlaylistLibraryPanel` 沿用所有歌曲式索引。没有数据的分类可显示索引，但不会由此产生虚构列表。
- 所有歌曲的元数据加载阶段沿用原有索引显示条件；其已有手动排序语义不因本次根页索引扩展而改变。
- 现有歌曲／播放列表索引与目录索引可共享视觉样式，但数据定位仍消费各自实际的展示顺序，不以索引点击重新构造播放来源。

## 8. 可验证边界

以下为实现契约，实际测试结果由 Test Agent 的测试报告记录：

1. 同时有直接歌曲和后代歌曲时，父目录与后代含歌目录各自出现在平铺页，父目录详情不包含后代歌曲。
2. 纯容器目录、确认无歌目录不在平铺页出现；含歌后代可以出现，且层次结构保留导航入口。
3. 多个存储中的同名目录按完整路径区分；重叠根中的同一目录与同一歌曲不重复计入平铺集合。
4. 卡片数量、详情数量、详情播放和随机候选对本层歌曲采用一致范围；不可用歌曲不进入播放候选。
5. 修改目录选择后，被排除歌曲不出现在三个分类中；当前平铺目录失效时返回平铺根列表，扫描中不误判失效。
6. 从平铺或层次详情播放、返回播放器、再次打开媒体库，保留当前会话的文件夹分类与详情位置。
7. 平铺封面只请求直接歌曲的 track thumbnail，不调用允许递归的 folder thumbnail；详情搜索不改变代表封面。
8. 根页索引与排序采用同一分组字段，搜索后仍定位正确；有 hero 的文件夹详情没有根页索引。
9. 卡片与 hero 的共享投影 key 一致，两个分类的搜索、多选、滚动与布局身份互不串用。
10. 既有所有歌曲、播放列表、层次导航、目录选择和封面窗口生命周期保持相应契约。

## 9. 实现定位与后续边界

使用函数和字段名定位，避免维护会随修改漂移的绝对行号：

| 主题 | 文件／符号 |
| --- | --- |
| 分类与路由 | `model/mediaLibraryCategories.ts` |
| 聚合、位置与播放器返回 | `components/PlayerShell.tsx` 的 `allSongDescriptors`、`flatFolderLocation`、`folderLocation`、`handlePlaylistOpenChange` |
| 挂载分流 | `components/PlayerSurface.tsx` 的两个文件夹分类挂载条件 |
| 平铺及层级派生 | `model/folderHierarchy.ts` 的 `flatFolderEntries`、`folderEntries`、`folderRootSongs`、`folderNavigationKey` |
| 目录选择投影 | `model/folderSelection.ts` 的 `projectSelectedFolder` |
| 共享目录与歌曲场景 | `components/FolderHierarchyPanel.tsx` 的显式 `categoryId` 分支 |
| 卡片显示 | `components/FolderHierarchyCard.tsx` 的 `flat` 参数 |
| 根页索引 | `components/CollectionQuickIndex.tsx`、`components/PlaylistLibraryPanel.tsx`、`model/quickIndex.ts` |
| 元数据契约 | `model/playerUiViewModel.ts` 的 `PlaylistLibraryViewModel` |
| 封面调度与订阅 | `hooks/useAllSongsWindow.ts`、`services/playlistCoverScheduler.ts` |
| 队列构造 | `hooks/useAudioPlayer.ts` 的 `selectPlaybackQueueTrack`、`shufflePlaybackQueue`；`model/playbackQueue.ts` |
| 后端封面范围 | `src-tauri/src/audio/folder_cover.rs`、`cover_pixels.rs` |

表内未写前缀的前端路径均相对 `src/features/player/`。

后续如要改变层次模式“直接显示／递归统计与批量播放”、统一全局大小写规则、预计算目录计数、调整未知时长展示或增加目录级播放 origin，需要单独明确契约。本次目录平铺与根页索引不隐含批准这些扩展。

## 10. 历史结论与可追溯性

原始 2026-10-27 快照保留在 Git 历史中；本页更新前所在提交为 `ad3fd6f`。外部 Poweramp 对照文档引用的“702 行、D1–D16”指该历史快照，不是本页最新实现的验收结论。

| 历史项 | 本次更新后的说明 |
| --- | --- |
| 文件夹 = 注册根递归播放列表卡片 | 已被平铺直接含歌目录替代；旧路由、根卡计数和 `kind: playlist` 描述不再适用于文件夹分类 |
| D1 重叠根导致文件夹卡片重复计数 | 平铺目录由去重后的聚合歌曲分组，不再按各注册根的递归曲目数求和；原始扫描仍可能重叠 |
| D2／D3 路径大小写及比较规则 | 本次未整体调整，不把新增平铺视图视为已解决这些身份差异 |
| D4 聚合 scope 取首个来源 | 仍是聚合描述符来源规则；平铺目录身份独立按父路径计算，root 锚点不覆盖歌曲 scope |
| D5 空根／错误根可见性 | 平铺页按直接歌曲存在性产出目录；层次页仍以根状态与导航为依据，二者差异有明确语义 |
| D6／D7 目录导入和勾选措辞 | 保留既有操作语义，不能把“选择存储”理解为点击目录卡片播放 |
| D8 排序不一致 | 根目录改为快速索引分组排序；有 hero 的目录歌曲仍沿用现有标题排序 |
| D9 所有歌曲／全部歌曲标题差异 | 非本次核心范围，不据本页更新宣称已统一 |
| D10 层次 hero 递归统计 | 仍然有效；平铺 hero 采用直接歌曲，不能把两个模式的统计混为一谈 |
| D11 三处时长口径差异 | 平铺不再取注册根摘要；层次与平铺的直接／递归统计有意区分，底层时长机制未整体重构 |
| D12 缺少 directoryPaths 的降级分支 | 层次实现仍保留，非本次新增能力或专项验证结论 |
| D13 两目录页搜索范围不同 | 两个目录模式均按 name + parentName 搜索 |
| D14 文件夹页缺快速索引 | 两个文件夹根页及其他分类根页补充索引，详情保持有 hero 的展示规则 |
| D15 层次位置失效与父级返回 | 本次增加平铺独立位置及失效处理；不将其扩展为所有层次位置问题均已修复 |
| D16 歌曲全集共享 | 仍共享同一聚合 A；具体可见子集、排序和播放范围由各视图契约决定 |

这份更新不改变外部 Poweramp 文档中的证据状态，也不把其推断升级为 SpMusic 已实现能力。
