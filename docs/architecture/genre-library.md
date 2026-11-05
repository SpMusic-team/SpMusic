---
doc_id: "ARCH-GENRE-LIBRARY"
title: "流派分类双路径与页面复用契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-05"
updated: "2026-11-05"
source_documents:
  - "user request: 参照 Poweramp 流派实现与 Figma 9208:9760 实现流派页面，优先复用现成内容"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=9208-9760"
  - "docs/architecture/poweramp-category-views.md"
  - "docs/architecture/year-library.md"
  - "docs/architecture/album-library.md"
  - "docs/architecture/contributor-library.md"
  - "src/features/player/components/AlbumLibraryPanel.tsx"
  - "src/features/player/components/PlayerShell.tsx"
  - "src/features/player/model/artistLibrary.ts"
  - "src/features/player/model/playlistTrackSummary.ts"
  - "src-tauri/src/audio/playlist_summary.rs"
---

# 流派分类双路径与页面复用契约

## 1. 结论与范围

复用现有 `genre` 分类和集合页面，提供“流派 → 该流派全部歌曲”及“流派 → 专辑 → 该流派在该专辑中的歌曲”两条并列路径。数据直接从现有 `library.allSongs` 的原始 `libraryGenreName` 派生，无需修改 Rust、Tauri command、DTO、音频引擎、数据库、权限或依赖。

本契约批准数据、导航、播放及生命周期边界；视觉以主代理与实现 Agent 成功读取的 Figma `9208:9760` 高保真上下文为准。设计中的 Electronic、J-Pop、封面及数量是动态内容示例，不能硬编码为曲库数据。根页可复用年份列表的响应式结构，但显示流派图标、名称和当前流派的歌曲数/总时长。

现有版本规划文档中的早期媒体库排除范围不取代本轮用户直接授权；本轮也不调整 Sprint、发布状态或其他分类规则。

## 2. 数据来源与多值语义

现有链路为 `Lofty genre → AudioPlaylistTrackTagSummary.genre: Option<String> → PlaylistTrackTagSummary.genre → playlistTrackRowFromSummary.libraryGenreName → PlayerShell allSongs`。Rust 已读取并 trim genre，前端 parser 已验证 nullable 文本，摘要行相等比较及 Shell 原始字段覆盖已包含该属性。页面不应转而依赖当前播放曲 hydration、展示 artist/album 或文件名推断流派。

| 原始值 | 分类语义 |
| --- | --- |
| `undefined` | 摘要尚未完成，不产生流派组或未知流派成员 |
| `null`、空白，或拆分后没有非空片段 | 已读取但没有可用流派，进入“未知流派”组 |
| 非空字符串 | 按以下固定规则产生一个或多个流派成员关系 |

首版固定分隔符为 `;`、全角 `；`、`//` 和 `$`，分片后 trim、去空，同一歌曲内按完整名称精确去重。单个 `/` 不拆分，以保留 `Pop/Rock` 等标签。该规则为本轮协调确认的 **SpMusic 首版策略**；Poweramp 文档仅证明可配置拆分及资源示例，不能把本规则描述成 Poweramp 的默认配置。不新增分隔符设置页，不调用艺术家专用的 `splitArtists`，不拆逗号、`&` 或其他未经指定的符号。

保留流派名称大小写，按 trim 后的精确名称分组；`Rock` 与 `rock` 是不同组，同曲完全相同名称才去重。Poweramp 文档的 `COLLATE NOCASE` 是排序证据，未证明其身份归并规则，本项目不据此合并大小写不同的标签。使用 `JSON.stringify(['genre', nameOrNull])` 作为稳定 key；空标签的 `null` 身份必须与字面标签“未知流派”区分，虽显示名称可能相同。流派标签不继承所属专辑的其他成员标签。拆分结果仅属于派生视图，不写回原始 `libraryGenreName`、元数据、摘要缓存或文件。

曲库范围继续是用户选择的文件夹曲库；现有 `allSongs` 已按规范化源路径生成真实歌曲 key，分类模型仍按 `song.key` 防御性去重。同一歌曲可在多个流派各出现一次；聚合多个流派用于播放、选择操作或加入列表时再次按真实歌曲 key 去重。

## 3. 两条路径与专辑边界

建议纯模型 `src/features/player/model/genreLibrary.ts` 导出拆分、流派分组、流派内专辑派生、稳定 route 及四视图排序能力。流派 entry 可以沿用 `AlbumEntry` 形状：`key`、`name`、空 `artist`、`year: null`、真实 `songs` 与 `coverSong`，复用现有集合卡片。

| 视图 | 成员规则 |
| --- | --- |
| 流派根列表 | 每个流派的唯一歌曲集合，默认按现有 quick index 名称升序及稳定 key 排序 |
| 该流派全部歌曲 | 所选流派 entry 的完整 `songs`，在当前搜索/选择规则下排序与操作 |
| 该流派专辑 | `albumEntries(currentGenre.songs)`，复用现有专辑身份和聚合规则 |
| 该流派内某专辑歌曲 | 上一行选中 `AlbumEntry.songs`，始终保留流派成员过滤 |

流派与年份的专辑路径不同：年份使用全库专辑及专辑年份，流派必须先筛流派成员，再聚合专辑。不得因复用年份 UI 而让流派详情显示完整全库专辑。

例：同一专辑 A 中歌曲 a 的流派为 `Rock; Pop`，歌曲 b 为 `Jazz`。Rock、Pop 的根计数各为 1，全部歌曲均只含 a；二者的专辑列表有 A，进入 A 也仅含 a。Jazz 的 A 仅含 b。对 Rock 与 Pop 同时播放或批量加入列表时，a 只能出现一次。未知流派的专辑详情也只含真实缺少流派的成员。

沿用共享 `albumEntries` 的命名专辑、ALBUMARTIST、目录边界、未知专辑细分和年份聚合。不得修改 `albumKey`、艺术家拆分、年份继承等其他分类规则来适配流派。流派封面、总时长及操作来源均来自当前视图成员。

聚合搜索的 `librarySearch` 仅将 `genre` 集合分支改为复用 `genreEntries(songs)`，映射为原 `SearchCollection` 结构并保留流派 key，统一拆分、未知和成员语义；年份搜索继续原路径。本轮不改歌曲全文搜索匹配原始 genre 文本的行为。搜索输入仍用其既有 `uniqueSearchSongs` 范围，不能改成只取新流派页的文件夹投影，因为搜索可含导入/当前会话独有成员。`SearchPanel` 的流派点击继续 `setExpanded` 在搜索内展开，以稳定 key 重新取得当前成员；不新增导航，也不把会话独有歌曲送入文件夹分类。全选、播放和加入列表继续二次去重共享成员。此依赖为 `librarySearch → genreLibrary → artistLibrary/albumLibrary/quickIndex`；模型到 `playerUiViewModel` 的引用均为类型，禁止反向引入搜索模块形成运行时循环。

## 4. 导航与状态契约

建议采用独立判别联合，避免把流派伪装成艺术家或年份身份：

```ts
type GenreLocation = null
  | { genreKey: string; view: 'albums' | 'songs' }
  | { genreKey: string; view: 'album'; albumKey: string }
```

`PlayerShell` 持有会话内 `genreLocation`，通过 `PlaylistLibraryViewModel.genreLocation` 与 `onGenreLocationChange` 传入页面。顶层路由继续使用 `{ view: 'category', categoryId: 'genre' }`。根 route 为 `category:genre`，内层 route 包含完整位置，例如 `genre:${JSON.stringify(location)}`。

主动从分类入口选择流派时回根；从播放器返回时保留浏览时的流派、分支和专辑位置，不用当前播放来源覆盖浏览位置。返回顺序为专辑歌曲/流派全部歌曲 → 当前流派专辑 → 流派根 → 媒体库概览。

流派根、流派内专辑、流派全部歌曲、流派专辑歌曲的布局和排序各自保存。storage、滚动、hero、projection、封面候选 key 需包含 `genre`；内层资源身份还需包含当前流派和专辑，避免借用年份或贡献者实例状态。搜索和选择在切换完整 route 时按既有集合页面规则复位。

根排序至少提供名称与歌曲数，默认名称升序；四视图排序字段及方向独立，所有比较使用稳定次级 key。现有摘要未提供可靠的流派创建时间，不能伪造 Poweramp 的 `genres.created_at`。根更多菜单可沿用“选择文件夹”“重新扫描”“列表选项”，排序仍需有可达入口，可放在列表选项中；不机械继承年份此前移除根排序的特例。其他视图沿用既有集合可用动作。

复用 `AlbumLibraryPanel` 时必须显式区分 `genre` 模式，不能让其落入 `ContributorCategoryId` 的 ARTIST/COMPOSER 字段分支，也不能落入年份专辑全库成员分支。可使用有限配置与现有集合 chrome、header、hero、card、toolbar、sidebar、菜单、窗口化及主题变量，不为本次重构整个集合框架。

## 5. 加载、播放与资源生命周期

`PlayerShell` 以下三处分类门控必须加入 `genre`：摘要 `ensurePlaylistSummaries`、`preferredDurationScopes`、`isSongsCategoryOpen`。现有 Shell 原始字段覆盖保持摘要 `libraryGenreName` 优先，不让封面或播放 hydration 改变流派归属。`PlayerSurface` 的专用页面分支与占位页面排除列表必须同步覆盖流派，避免双重渲染。

摘要加载、文件夹恢复、重新扫描、导入期间沿用集合 loading 状态，不因临时空成员清理导航或执行基于不完整成员的操作。数据稳定后，当前流派消失回流派根；流派还在而所选专辑消失回当前流派专辑。只有当前 present 场景可执行失效位置清理，退出中的场景不得覆盖后续位置。

播放、随机、批量动作继续使用原始 `{ scope, trackId }` 和既有 `all-songs` 来源。根/流派专辑操作展开可见且被选择的集合成员，歌曲操作用当前可见歌曲；去重并排除不可用项，不新增流派队列来源或切换活动播放列表作为浏览副作用。分类 key 不能作为播放 scope。

封面继续通过 `collectionCover`、`useAllSongsWindow`、cover store、lease 和有界调度加载。候选仅为当前流派/专辑真实成员；封面发布不能导致全库流派重聚合。缺图、总时长读取中和不可用文件复用现有状态，不编造时长。布局与排序继续沿用 localStorage 能力，位置仅会话保存，不新增跨重启恢复机制。

## 6. 备选方案与质量属性

| 方案 | 取舍 |
| --- | --- |
| 前端纯派生流派，复用现有集合页和专辑聚合 | 采用；现有摘要已足够，真实播放身份及所有生命周期设施可复用 |
| 新建 Rust 流派表、关系表、命令及持久化索引 | 当前无需；Poweramp 的数据库布局不构成本项目新增存储的理由 |
| 将流派当成贡献者并沿用 `splitArtists` | 拒绝；标签来源及分隔符不同，单斜杠会错误拆分复合流派 |
| 从全库专辑选取包含当前流派的专辑后展示完整成员 | 拒绝；会在专辑歌曲路径引入其他流派歌曲 |

派生仅随歌曲/标签集合变化进行 memo 计算；列表复用窗口化，封面流独立于聚合数据。保留现有 React → 摘要/播放服务的依赖方向，不增加启动期音频读取或全量解码。纯函数便于覆盖多流派、未知和重复源；共享组件减少视觉及焦点/动效漂移。无新权限、外部服务或敏感数据流；不宣称新增格式兼容性。未来若用户授权分隔符配置或实测发现规模瓶颈，再单独审查配置与索引边界。

## 7. 文件所有权与验收

Architecture Agent 仅独占本文件。Frontend Agent 独占 `src/**` 生产变更，包括 `genreLibrary.ts`、`playerUiViewModel.ts`、`PlayerShell.tsx`、`PlayerSurface.tsx`、`AlbumLibraryPanel.tsx`、必要样式/本地静态资产及对应实现说明；具体模型/浏览器测试文件由主代理在 Frontend 和 Test 之间明确分配，禁止共同写同一文件。Rust/Tauri Agent 本轮无需修改。Test Agent 独占分配的测试及 `docs/test/genre-library.md`；主代理整合并执行最终仓库检查。

验收至少覆盖：

1. 冷进入依赖真实摘要形成流派组；pending 不被伪装为未知，空标签和真实名称“未知流派”有不同身份，不硬编码设计示例。
2. `Rock; Pop；Rock//Jazz$Pop/Rock` 得到 Rock、Pop、Jazz、Pop/Rock；各成员去重，原标签不变。重复注册根与跨流派展开不重复计数/播放。
3. 两条路径及同专辑混合流派遵循第 3 节；未知组不借用专辑流派、艺术家、路径或当前播放曲标签。
4. 四视图布局、排序、搜索、选择、滚动及返回位置不串类；播放器往返保留浏览位置。重扫/恢复期间不清理，稳定移除后正确回退，离场场景不能覆盖新位置。
5. 点击、播放、随机与批量操作使用正确真实 scope/trackId，只含预期成员，排除不可用项；跨源播放后标签和封面仍正确。
6. Figma 根页布局、分类图标、卡片计数/总时长、静态资产及响应式尺寸核对通过；缺图、加载、空状态、错误与基础键盘交互可用。
7. 共享页面改动后年份、专辑及贡献者回归通过；运行聚焦模型/浏览器测试与仓库 lint/build。未改 Rust 时无需以全量音频兼容测试替代分类验证。
8. 聚合搜索复用流派拆分与 key；`Rock;Pop` 不再成为单独合并集合，展开的流派成员、空标签/真实未知名区分及跨流派选择去重正确；原年份搜索与会话独有成员展开范围保持。

最主要的回归风险是复用页面将 genre 误归入贡献者分支、套用年份的完整专辑成员，以及漏掉 Shell 门控导致冷进入数据为空。Test Agent 应独立核查这些调用链与状态边界；本契约不等于功能已经验收。
