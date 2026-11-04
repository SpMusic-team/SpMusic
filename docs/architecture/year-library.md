---
doc_id: "ARCH-YEAR-LIBRARY"
title: "年份分类双路径与导航契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-03"
updated: "2026-11-03"
source_documents:
  - "user request: 按 Poweramp 年份页面逻辑及 Figma 设计实现年份分类"
  - "user request: 年份根菜单仅保留选择文件夹、重新扫描、列表选项；同专辑已完成但缺失年份的歌曲继承已知年份"
  - "user request: 缺少 ALBUMARTIST 时，同一文件夹内专辑名相同、ARTIST 不同的歌曲合为同一专辑，缺年歌曲继承专辑年份"
  - "user request: 年份分类不再显示无法按当前规则取得有效年份的歌曲和未知年份入口"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=9190-8873"
  - "docs/architecture/poweramp-category-views.md"
  - "docs/architecture/album-library.md"
  - "src/features/player/model/albumLibrary.ts"
  - "src/features/player/model/artistLibrary.ts"
  - "src/features/player/components/PlayerShell.tsx"
  - "src/features/player/components/AlbumLibraryPanel.tsx"
---

# 年份分类双路径与导航契约

## 1. 结论与范围

复用已有 `year` 分类，在前端从已选择音乐文件夹的 `library.allSongs` 派生年份列表，并提供“年份 → 全部歌曲”和“年份 → 专辑 → 专辑歌曲”两条路径。歌曲路径优先使用原始曲目年份，已完成但缺失/无效时继承完整专辑的聚合年份；专辑路径使用全库专辑的聚合年份。继承只属于年份分类的派生视图，不写回标签、摘要或其他分类。无需新增 Rust 字段、command、数据库、依赖或权限。

用户后续明确要求年份分类隐藏仍无法取得有效年份的歌曲，不再提供“未知年份”入口。此为年份分类的可见性筛选，不删除歌曲、不更改有效年份映射的空值语义，也不改变专辑、所有歌曲或文件夹等其他分类的成员。

本契约解决数据、导航、播放及生命周期边界。页面视觉由 Figma `9190:8873` 的高保真设计上下文决定；未读取成功的设计内容不得用本契约推测。流派分类及播放引擎不在本次范围内。

## 2. 数据来源与两条路径

现有链路为 Rust `AudioPlaylistTrackTagSummary.year: Option<u32>` → 前端摘要 `year: number | null` → `AllSongsItem.track.libraryYear?: number | null`。`undefined` 表示摘要尚未完成，`null` 表示已读取但没有有效年份。有效年份继续使用现有规则：正的 safe integer 且不超过 u32 上限；不得从文件名、目录、文件时间或当前播放曲推断年份。

`albumEntries(allSongs)` 已统一专辑身份及成员，`AlbumEntry.year` 为该专辑完整成员有效 `libraryYear` 的最小值。这是 **SpMusic 已存在的专辑年份派生规则**；Poweramp 的 `albums.album_year` 生成规则尚未取证，不能声称二者算法相同。本次保留其“专辑年份筛选”的页面语义，使用 SpMusic 的既有值。

用户反馈的《明日方舟》游戏原声 OST 已有只读标签证据：`E:/Music/塞壬唱片-MSR - 「如我所见」夜幕.mp3` 的 ALBUM 与 `E:/Music/Mentalmeisters - 「吾导先路」殉道者（第五个）.flac` 相同，两者均无 ALBUMARTIST，前者未标年份，后者为 2022，ARTIST 分别为塞壬唱片-MSR 与 Mentalmeisters。旧的缺失 ALBUMARTIST 回退完整 ARTIST 身份把两者拆成不同专辑，阻止了既有年份继承。用户确认按同名同目录合并后，应修复共享 `albumEntries` 的身份源头，不能只在年份分类中按名称借用年份。具体互斥身份分支以 `album-library.md` 第 2 节为准；未知专辑规则不变。

年份分类新增统一的“有效年份”派生规则：先按真实歌曲 key 去重，对同一份完整曲库调用 `albumEntries`，用每个最终专辑的 `songs` 成员构建 `song.key → AlbumEntry.year` 映射。不得只按专辑名或单独调用 `albumKey(song)` 推断继承关系；未知专辑的最终分组还包含目录与署名细分规则。每首歌的有效原始年份保持不变；原始 `libraryYear` 为 `undefined` 时仍是 pending，不继承；已完成且缺失/无效时采用所属完整专辑的最早有效年，专辑也没有有效年或尚无可用专辑分组时仍为未知。继承不改变原始曲目对象、`libraryYear`、专辑身份、专辑聚合年份或 `{ scope, trackId }`。

| 视图 | 成员规则 |
| --- | --- |
| 年份列表 | 仅对有效年份为 number 的歌曲分组，按真实歌曲 key 去重，默认年份从新到旧并保留现有 root 排序偏好读取；有效年份为 null 或 undefined 的歌曲均不生成入口，不显示“未知年份” |
| 该年份全部歌曲 | `allSongs` 中有效年份等于有效数字 `selectedYear` 的唯一曲目；无法继承年份或尚在 pending 的曲目不显示 |
| 该年份专辑 | 先执行全库 `albumEntries(allSongs)`，再筛选 `album.year === selectedYear`；`yearAlbums(albums, null)` 返回空数组，不提供未知年份专辑分支 |
| 该年份内某专辑歌曲 | 上一行选中的完整 `AlbumEntry.songs`，保留原始成员，不追加曲目年份条件 |

禁止先按曲目年份筛选再调用 `albumEntries`，否则混合年份专辑会在多个年份重复出现并被截断。示例：同专辑两首歌的年份分别为 2018、2019，则 2018 的全部歌曲包含第一首，2019 的全部歌曲包含第二首；该专辑只在 2018 的专辑列表出现，进入专辑后包含两首。专辑 key 不含年份，标签年份变化只改变其所属年份，不改变专辑身份。

若该专辑另有一首已完成但缺失年份的歌，则其在年份分类中归入 2018；已标 2019 的歌仍归入 2019。全部成员都没有有效年份的专辑及无法继承年份的歌曲不在年份分类展示，其他分类继续保留。后续标签更新时重新从原始年份派生，不把上次继承结果当成新的标签来源。

年份列表的歌曲数及全年歌曲播放动作使用曲目年份成员；专辑数量及专辑视图播放动作使用专辑年份成员。这两组成员可能不同，不能用一个数组同时充当两条路径的统计及播放来源。年份封面若设计要求曲目封面，只能从该视图的真实成员中选取；缺图沿用设计指定的本地静态资产。

## 3. 前端契约与模块边界

纯模型 `src/features/player/model/yearLibrary.ts` 负责年份归一化、有效年份映射、去重分组、全库专辑年份筛选和导航 key。`yearEntries`、年份歌曲按年份排序及位置存在性判断必须使用同一份完整曲库派生的有效年份；排序不能只根据搜索后/当前视图的局部成员重新计算继承。本次允许按 `album-library.md` 第 2 节修复共享 `albumKey`、`albumEntries` 的命名专辑身份及作者聚合，替代此前禁止修改它们的边界；年份模型仍不得另行维护相似分组算法。后端标签读取、所有歌曲、搜索或其他分类的原始年份语义保持不变。

建议导航采用判别联合：

```ts
type YearLocation = null
  | { year: number | null; view: 'albums' | 'songs' }
  | { year: number | null; view: 'album'; albumKey: string }
```

顶层 `null` 表示年份根；位置对象中的 `year: null` 保留为旧会话未知年份位置的兼容表达，新界面不再生成此入口。两者不得混淆，不因隐藏入口收窄共享 `YearLocation` 类型。路由 key 需编码分类、年份、视图和专辑身份，例如 `category:year` / `year:${JSON.stringify(location)}`，避免不同年份复用同一个详情或滚动位置。

`PlayerShell` 持有 `yearLocation`，通过 `PlaylistLibraryViewModel.yearLocation` / `onYearLocationChange` 传入面板。顶层 `MediaLibraryRoute` 不需改变：仍是 `{ view: 'category', categoryId: 'year' }`。从分类入口主动选择年份时回到年份根；从播放器返回应保留会话内原来的年份/视图/专辑位置，不用播放来源覆盖浏览位置。

Frontend Agent 可选择在现有集合面板中增加显式年份模式，或用独立 `YearLibraryPanel` 组合现有组件；均需继续复用 `CollectionManagementHeader`、`CollectionHero`、`PlaylistCard`、`PlaylistActionButtons`、侧栏、更多菜单、虚拟窗口、布局与封面 store。若复用 `AlbumLibraryPanel`，应显式区分年份分支，不能让其进入艺术家 `splitArtists` 或 `artistAlbums` 的“先筛成员后分专辑”路径。

必须将 `year` 加入 `PlayerShell` 三个现有分类门控：摘要 `ensurePlaylistSummaries`、`preferredDurationScopes` 和 `isSongsCategoryOpen`。遗漏任一项可能让冷启动页面没有年份或时长，或播放切换后丢失标签/封面。沿用现有 tag lane 原始字段优先级，不让 hydration 覆盖 `libraryYear`。

## 4. 导航与生命周期

返回顺序为：专辑歌曲 → 当前年份专辑；全年歌曲 → 当前年份专辑；当前年份专辑 → 年份根；年份根 → 媒体库总览。全年歌曲是与专辑列表并列的浏览入口，不能实现为假专辑或持久化播放列表。

在摘要加载、文件夹恢复、重扫或导入期间显示既有 loading 状态，暂停基于临时空数组的失效导航清理。数据稳定后，年份消失返回年份根；所选专辑消失或年份变更导致其离开当前年份时返回当前年份专辑列表；离场场景不可清理新场景位置。由于年份列表不再产生 null 年份组，旧会话中的 `year: null` 位置应由既有 `currentYear` 缺失检查回退到年份根，即使曲库仍含无法继承的歌曲也不保留旧未知入口。此回退继续遵守加载期间暂停清理与当前场景 present 的限制，不新增路由或迁移协议。

滚动位置按完整 route 缓存；搜索和选择作用于当前视图并在切换时按既有集合行为复位。四种视图的布局偏好保持独立。用户后续调整替代此前“四视图均在更多菜单暴露排序”的要求：**年份根弹窗只显示“选择文件夹”“重新扫描”“列表选项”三项，移除根排序和置顶入口**，其他分类和年份内详情菜单不随之改变。本轮仅移除入口，保留现有 root 排序偏好的读取及默认年份降序行为，不清理或忽略已有 root 排序缓存，也不清理其他全局置顶数据。

全年歌曲、年份内专辑、年份内专辑歌曲仍分别持久化排序字段和方向；切换视图、年份或重新进入页面不得互相覆盖。歌曲按年份排序时必须使用同一份完整曲库有效年份映射：继承年与显式同年按相同数值比较，无法继承的未知值在任意方向下最后；相同主排序值使用稳定标题及歌曲 key 次级键。专辑按年份排序仍直接使用 `AlbumEntry.year`。不照抄 Poweramp 位掩码或方向不一致的实现，不另建通用配置系统。

## 5. 播放、封面与持久化

点击歌曲与播放/随机动作仅展开当前视图、搜索和选择后的正确成员，按真实歌曲 key 去重并排除不可用项；继续传原始 `{ scope, trackId }` 给 `library.onPlaySong` / `onShufflePlay`。使用现有 `all-songs` 来源类型，不新增年份队列来源，不改变活动播放列表。年份专辑视图的动作展开其可见专辑成员，全年歌曲动作使用曲目年份成员。

封面消费现有 `useAllSongsWindow`、`useCollectionCoverUrl`、有界调度与 cover lease。集合封面 key 应含年份/分支/专辑上下文，防止混合年份下误复用候选集合。封面加载完成不得使全库年份或专辑重新聚合；缺封面和不可用曲目沿用已有状态。

沿用当前前端 localStorage 对布局和其余已有偏好的读写方式，年份根菜单不再提供分类置顶；浏览位置保持当前会话状态，不新增跨重启恢复协议。有效年份仅为内存派生值，不持久化或写回原始标签。无新增本地文件读写能力、网络权限或 Tauri command。

## 6. 方案比较与质量属性

| 方案 | 结论 |
| --- | --- |
| 前端派生年份 + 复用全库专辑聚合 | 采用；已有摘要提供全部必要数据，成员及播放身份可直接复用 |
| 新建 Rust 年份实体/独立 album_year/数据库 | 当前无必要；扩大跨层契约及同步成本，且不能据此复现尚未取证的 Poweramp 专辑年份生成逻辑 |
| 按曲目年份过滤后聚合专辑 | 拒绝；破坏双路径差异并截断完整专辑 |

派生计算只在歌曲/标签集合变化时 memo 执行；专辑聚合复用已有算法，列表沿用窗口化及有界封面加载，不增加启动期全量音频解码。保持 React → 既有摘要/播放服务的依赖方向，Rust 不依赖 UI 分类。若未来出现明确规模瓶颈或专辑级元数据来源，再单独审查索引或 DTO 扩展。

## 7. 验收与分工

Frontend Agent 独占业务实现：年份模型/面板、共享 `albumLibrary.ts` 及相关回归测试、`playerUiViewModel.ts`、`PlayerShell.tsx`、`PlayerSurface.tsx` 及必要主题/样式和资产调用；共享文件顺序修改。Rust/Tauri Agent 本轮无需实现。Test Agent 独立验证，主代理整合并执行 repository lint/build。

至少验证：

1. 真实 summary 年份进入根列表；冷进入、pending、已知无年份及无效值不混淆，不显示示例数据。有效年份仍为 null 或 undefined 的歌曲不进入年份列表，`yearAlbums(albums, null)` 返回空数组，全部歌曲均无法取得有效年时显示既有空状态。有效年份映射继续保留原来的 null/undefined 区别。年份根菜单恰有指定三项，现有 root 排序偏好读取和无偏好时的年份降序保持，其他菜单不回归。
2. 同一专辑混合 2018/2019/缺失年份时两条路径成员严格符合第 2 节示例，缺失继承 2018、显式 2019 不变、专辑详情保留完整成员。无 ALBUMARTIST 的同名同目录不同 ARTIST 按用户截图场景合并，缺年歌曲继承 2022，专辑仅出现在 2022 分支；不同目录的同名无 ALBUMARTIST、不同显式 ALBUMARTIST、显式/缺失分支及未知专辑目录边界不能污染继承结果，跨目录共同 ARTIST 不得形成传递桥接。pending 不继承，全专辑无年不在年份分类显示，重复注册根只计一次，输入对象及原始 `libraryYear` 不被修改。
3. 每条路径的播放、随机、选择/搜索后队列只含预期真实 scope/trackId，跨源播放后页面标签和封面保持。
4. 四种视图的返回、播放器来回、滚动和偏好作用域独立；重扫期间不错误跳回，稳定移除年份及旧 `year: null` 位置均正确回退到年份根。全年歌曲与专辑歌曲按年份排序使用全库有效年，搜索后的局部集合不改变继承结果。
5. 缺图、不可用曲目、加载与空状态可见；窄/宽窗口、静态资产位置及尺寸匹配已读取的设计稿。
6. 全局专辑与年份专辑使用修正后的同一身份；艺术家/专辑艺术家/作曲家内专辑保留其过滤后的成员范围、真实播放身份和返回路径，不把合辑中其他贡献者成员带入当前视图。所有歌曲和文件夹的成员及导航不回归。因专辑身份策略改变失效的旧会话位置沿用现有稳定数据后的回退，不新增持久化迁移。

视觉验收依赖成功读取目标节点；现有架构结论不替代设计核对，也不构成页面完成证明。
