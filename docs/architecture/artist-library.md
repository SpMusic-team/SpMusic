---
doc_id: "ARCH-ARTIST-LIBRARY"
title: "艺术家分类的数据、成员与导航契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-10-28"
updated: "2026-10-29"
source_documents:
  - "user request: 实现媒体库艺术家分类；进入艺术家主要查看专辑，专辑前提供所有歌曲入口"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=8018-16827"
  - "docs/architecture/poweramp-entity-views.md"
  - "docs/architecture/album-library.md"
  - "docs/implementation/album-library.md"
  - "docs/decisions/2026-07-09-document-metadata-standard.md"
  - "src/features/player/model/playlistTrackSummary.ts"
  - "src/features/player/model/albumLibrary.ts"
  - "src/features/player/model/playerUiViewModel.ts"
  - "src/features/player/components/PlayerShell.tsx"
  - "src/features/player/components/AlbumLibraryPanel.tsx"
  - "src/features/player/components/PlaylistHeroMoreMenu.tsx"
  - "src/features/player/components/LibraryRootMenu.tsx"
  - "user request: 艺术家内层复用头图更多菜单，专辑卡字体与全局专辑保持一致"
  - "user request: 艺术家界面个人与多人同名专辑应分别展示对应曲目"
  - "user request: 艺术家页同名同署名专辑应跨目录合并，年份与音频格式不拆分专辑"
  - "user request: 专辑歌曲年份不同时显示最早年份，不能省略"
  - "user request: 将艺术家页已修改的专辑逻辑同步到媒体库专辑分类"
  - ".rea-analysis/decoded/res/xml/library_scanner.xml"
---

# 艺术家分类的数据、成员与导航契约

## 摘要与范围

本次由现有选中存储曲库及标签摘要派生艺术家实体，复用已有专辑身份、集合组件、封面缓存和播放入口。用户明确授权的新功能覆盖旧计划中媒体库排除范围，但不扩大为专辑艺术家分类、扫描设置页、数据库或标签编辑。本文是实施前架构契约，运行验证由 Frontend Agent、Test Agent 和主代理分别完成。

艺术家根页进入某艺术家后默认显示其专辑；专辑之前始终提供“所有歌曲”入口，进入独立的该艺术家歌曲列表。三个层级和艺术家内专辑详情均属于 `category:artist`，保留该艺术家的成员边界。

## 1. 数据方向与原始标签

数据方向为 `libraryFolderPlaylists → 按规范化 sourcePath 去重的 allSongs → 标签摘要 → artistEntries → 当前艺术家 songs → artistAlbums → 页面`。不混入 M3U8 和自定义播放列表额外曲目，不产生新的后端命令、事件、权限、依赖或队列来源。

当前 `PlaylistTrackRow.artist` 已执行 `artist → albumArtist → 本地音频` 展示回退，不能作为 ARTIST 归属依据。新增可选字段 `libraryArtistName?: string | null`，语义与 `libraryAlbumName` 保持一致：

| 值 | 含义 |
| --- | --- |
| `undefined` | 摘要尚未完成，没有原始标签结论 |
| `null` | 本轮摘要已完成但 ARTIST 缺失、空白，或沿用现有摘要失败降级 |
| 非空字符串 | trim 后的原始 ARTIST，保留大小写和显示拼写 |

`playlistTrackRowFromSummary` 从 `summary.artist` 生成该字段；行相等比较、`PlaylistTrackItemViewModel` 和 `PlayerShell` 的摘要覆盖通道必须透传。hydration 与正在播放歌曲的视觉元数据可以补展示字段，但不能覆盖原始归属。ARTIST 缺失而 ALBUMARTIST 存在时，艺术家分类仍归入“未知艺术家”，不冒充专辑艺术家分类。

`PlayerShell` 中摘要 ensure、优先时长 scopes、聚合元数据补全及播放器返回媒体库的分类判断必须纳入 `artist`。未读摘要的曲目不能直接形成永久未知实体。加载、恢复、重扫期间保持 loading，不开放基于不完整成员的播放和集合写操作。

## 2. 拆分与身份

艺术家归属采用多对多关系：同一曲目的有效 ARTIST 片段分别产生独立艺术家成员；片段 trim、去空、单曲内去重，同一艺术家的曲目再按歌曲 `key` 去重。保留每首曲目的真实 `scope`、`trackId`、`sourcePath`、`available`。

本次采用与已有专辑作者处理一致的 `/` 拆分基线。Poweramp 文档证明有“拆分符”和“不拆分艺术家”机制，但尚未证明其默认拆分符；不能把文档中的 `A feat. B` 示例当作默认字符串解析规则。资源 `library_scanner.xml` 明确给出不拆分默认例外 `AC/DC | +/-`，本次解析须保留 `AC/DC` 和 `+/-` 整体，包括它们出现在合作作者串中的情形。逗号、`&`、`feat.` 等没有本项目已批准规则，不额外猜测。拆分集中在纯模型函数中，未来添加用户配置时只替换该策略，不改变歌曲身份。

建议艺术家 key 使用 `JSON.stringify(['artist', name])`；缺失标签用 `JSON.stringify(['artist', null])`，显示名为“未知艺术家”。这样真实名为“未知艺术家”的标签与缺失实体仍可区分。不强制大小写折叠，保持现有专辑标签身份策略。名称排序复用 `compareByQuickIndex`，再以稳定 key 打破比较相等。歌曲排序复用现有歌曲标题排序及稳定 key。

艺术家纯模型可提供 `ArtistEntry = { key, name, songs, albums, coverSong }` 或等价结构，属于派生数据，不持久化，不写回音乐标签。不要为了复制 Poweramp 表结构而在前端同时存一份可变实体和关联表。

## 3. 艺术家内专辑与所有歌曲

先确定艺术家成员集合，再由 `artistAlbums` 调用共享的 `albumEntries` 派生该艺术家的专辑。这保留 Poweramp `u.X0()` 中 `multi_artists.artist_id = ?` 在专辑聚合前过滤的已实证顺序。2026-10-29 用户进一步要求个人与多人同名专辑分别展示对应曲目、同名同署名专辑跨目录合并，并将这些规则同步到媒体库“专辑”分类。两个入口统一使用 `albumEntries`，不再分别维护分组与年份算法；完整共享契约见 `docs/architecture/album-library.md` 第 2、9 节。

| 场景 | 规则 |
| --- | --- |
| 合辑中 A 一首、B 一首 | A 页面列出该专辑，但专辑详情、计数和播放候选只含 A 的曲目；B 同理 |
| A/B 合作曲 | A、B 均能看到和播放此曲；在各自列表中只出现一次 |
| 真实同专辑名、同有效署名、跨目录 | 合并为一个专辑；年份和音频格式不参与身份，艺术家内成员仍仅限当前艺术家 |
| 有真实专辑名、缺失专辑艺术家 | 以完整 ARTIST 署名集合为有效署名；A 的独唱与 A/B 合作曲分别属于个人和合作卡片 |
| 有真实专辑名、显式 ALBUMARTIST 与缺失标签混合 | 有效署名相同即合并，不因署名来自不同标签而生成视觉重复卡片；显式 ALBUMARTIST 仍优先于曲目 ARTIST |
| 无专辑名 | 保留目录隔离的“未知专辑”；组内所有成员均缺失 ALBUMARTIST 时按署名集合细分，任一成员具有显式 ALBUMARTIST 时保留原组，所有歌曲入口始终可访问这些曲目 |
| 重叠存储根 | 一首源文件只计数一次 |

真实专辑名使用 trim 后非空的原始 `libraryAlbumName`。其有效署名优先取 trim 后非空的 ALBUMARTIST，否则取完整原始 ARTIST。二者均复用共享 `splitArtists` 的拆分、trim、去空和去重规则，保留 AC/DC、+/- 例外；身份中的名字集合稳定排序，A/B、B/A、A/B/A 不产生不同卡片。两个入口的命名专辑 key 统一为 `JSON.stringify(['album', albumName, effectiveCreditNamesOrNull])`，不包含目录、署名标签来源、年份或音频格式。缺失署名使用 null 哨兵，与字面名为“未知艺术家”的标签区分；不折叠大小写，不从展示后备值构造署名。显式 ALBUMARTIST 的优先级保留，例如 Ensemble 的同名专辑可跨曲目 ARTIST 合并。拆分函数使用共享模块或向专辑模型下沉后重导出，保持依赖单向。

没有真实专辑名时复用共享 `albumEntries` 的目录隔离及组级细分规则，不跨目录合并未知专辑。当前调用方传入的成员范围内，只有整个目录基础组的 ALBUMARTIST 均为空白或缺失时才按完整 ARTIST 署名集合细分；任一成员具有显式 ALBUMARTIST 就保留目录原组，不以排序后首曲决定行为。艺术家页先过滤成员，全局专辑使用全局成员，因此未知目录组的显式标签检测可能因输入范围不同而产生不同结果；相同输入必须得到相同分组。

每张卡片的名称、作者副标题、成员、年份、封面候选、数量和时长均以同一个最终分组为准，不能继承细分前混合组的统计，也不能只取跨目录合并前某一个目录组的成员。从最终成员的有效 libraryYear 取最早年份，全部无效或缺失时才省略；不能按年份或格式重新拆组。详情通过该卡片的完整 key 查找同一分组，播放、随机和选择也使用这组成员；不在详情层单独追加另一套筛选。歌曲 key、scope、trackId 和 sourcePath 保持原值，不按标题去重不同源文件。不跳转全局专辑分类后丢失艺术家上下文。“所有歌曲”列出当前艺术家的全部曲目，包含无专辑曲目及合作曲，与专辑卡片集合彼此不重复叠加。

根页或专辑视图选择多个实体并展开歌曲时，要按 song.key 去重；这对多个艺术家共享合作曲尤其必要。播放、随机、加入列表、删除等操作都由当前搜索结果和选择状态产生快照，不得越过当前艺术家或选中实体的范围。沿用 `kind: 'all-songs'`，通过原始 `{ scope, trackId }` 提交队列，不使用艺术家 key 伪造 scope。

## 4. 导航与生命周期

使用显式判别联合表达位置，例如：

```ts
type ArtistLocation =
  | null
  | { artistKey: string; view: 'albums' }
  | { artistKey: string; view: 'songs' }
  | { artistKey: string; view: 'album'; albumKey: string }
```

该位置由 `PlayerShell` 所有，传入 library view model；进入艺术家分类菜单时重置为根页，从播放器返回时保留会话位置。返回路径为：专辑详情或所有歌曲 → 该艺术家专辑视图 → 艺术家根页 → 媒体库概览。

根页、各艺术家专辑视图、各艺术家歌曲视图、各艺术家内专辑详情必须使用不同的 navigation/search/selection/scroll 身份。`albumKey` 不能单独作为艺术家内详情身份；至少结合 artistKey，否则同专辑跨艺术家易复用旧搜索、选择和滚动。无须新增顶层 MediaLibraryRoute 分支。

摘要、存储恢复或重扫尚未完成时不能因临时空数组弹回根页。稳定后艺术家确实消失才回到艺术家根页；艺术家仍在而专辑消失则回到该艺术家专辑视图。只有当前 present 场景能触发失效清理，离场动画保留的场景须 inert，不能清理新位置或提交操作。复用已有请求指纹和 scope 校验，不接受已过期摘要。

## 5. 组件与资源边界

Frontend Agent 以主代理取得的 Figma 高保真上下文为视觉依据。复用 `CollectionManagementHeader`、`CollectionHero`、`CollectionQuickIndex`、集合布局控制器、侧栏、`PlaylistCard`、歌曲窗口与实体窗口能力。艺术家页面拥有自身领域状态，不把 artistKey 塞进物理文件夹路径，不反向调用文件夹成员筛选。

允许在显式配置下复用专辑卡片或歌曲列表子组件；避免为三个层级复制整套约数百行集合控制逻辑，也避免为未来所有分类建立通用框架。根页艺术家和艺术家内专辑具有独立布局偏好。根页需要快速索引时，共用已有索引组件和虚拟窗口跳转。

艺术家图像来源仅用本地曲目封面或现有分类占位图；设计稿中的艺人照片若属于数据示意，不作为固定艺人资料，不引入联网图片服务。封面代表曲目稳定选择，复用 `useCollectionCoverUrl`、`useAllSongsWindow` 及 cover lease。封面流更新不重新全库分组，不串图，不在仍参与离场动画时撤销 URL。

## 6. 备选方案与质量属性

| 方案 | 取舍 |
| --- | --- |
| 基于摘要在前端派生艺术家与关联 | 采用；已有数据足够，便于纯函数测试，无新运行时边界 |
| 使用展示 artist 串直接分组 | 拒绝；会把专辑艺术家后备值和“本地音频”当原始艺术家 |
| 先全库建专辑再展示完整专辑 | 拒绝；从 A 进入合辑会播放 B 的独唱，违背艺术家作用域与 Poweramp 过滤顺序 |
| 缺失 ALBUMARTIST 时仅在详情追加个人／合作筛选 | 拒绝；卡片的作者、数量、时长和播放候选仍可能来自混合组，应在 artistAlbums 形成统一成员分组 |
| 真实专辑名继续使用目录作为身份 | 拒绝；同名同署名的跨目录、不同年份或格式曲目会出现视觉重复卡片。两个入口仅对未知专辑保留目录边界 |
| 增加 Rust 实体接口、数据库、多套索引 | 当前无必要；扩大迁移及双来源一致性成本 |

模型在摘要或歌曲集合改变时 memo 派生，艺术家索引用一次曲目遍历和映射建立，避免每个根卡片重新扫描全库；封面和滚动不触发全库重建。歌曲及实体窗口、封面并发预算沿用现有机制。内存只维护成员引用，避免复制完整音频元数据或封面字节。原始标签字段只在前端透传，后端 DTO 不变，跨平台路径身份继续由现有规范化函数负责。未来需要拆分设置、排序标签或独立艺人图片能力时另行审查配置和来源契约。

## 7. 验收标准与交接

1. 按 Figma 展示艺术家根页和详情；进入艺术家默认看专辑，第一行“所有歌曲”进入歌曲列表，逐层返回正确。
2. ARTIST=`A/B/A` 产生 A、B 两实体，各含同一合作曲一次；AC/DC、+/- 例外不被误拆；逗号、&、feat. 不凭猜测拆分。
3. ARTIST 缺失、ALBUMARTIST=A 的曲目归未知艺术家；真实名为未知艺术家的标签与缺失实体不碰撞；pending 不产生可播放未知实体。
4. 合辑 A/B 的各自专辑详情只含匹配成员；多艺术家选择展开、播放和随机均去重且保留原始 scope/trackId；无专辑曲目可从所有歌曲进入。
5. 两个专辑入口使用共享分组：有真实专辑名时，相同有效署名跨目录合并，显式与缺失 ALBUMARTIST 来源不拆组，年份和格式不参与身份；个人与合作同名专辑分别展示对应曲目，署名顺序与重复不改变身份，显式 ALBUMARTIST 保留作者优先级。卡片、详情、统计和操作候选一致；未知专辑目录隔离和重叠根去重保留，艺术家页先过滤成员的边界不回归。
6. 加载、重扫、移除根、快速切换、播放器往返期间不出现旧场景清理新位置、失效成员可操作、未知组闪现或封面串图。
7. 搜索、选择、布局、滚动、索引和操作快照作用域正确；键盘可打开所有歌曲及专辑并返回，离场场景不可交互。
8. Frontend Agent 自测模型及浏览器路径；Test Agent 独立验证归属、合辑过滤、原始标签、候选边界和异步导航；主代理执行 lint/build。缺少实机音频或视觉验证时明确记录证据限制。

建议由 Frontend Agent 所有 `src/` 中模型、透传、路由接线、样式和页面实现，独占 `PlayerShell.tsx` 等共享入口写权限；Test Agent 在实现完成后所有独立测试文件和 `docs/test/` 报告。当前架构允许直接实施，不需要新增依赖或后端能力。

## 8. 艺术家封面缺失的修复审查

本节对应用户反馈“部分艺术家封面不加载”；用户提供的 4incola 示例只有一首曲目，播放器能显示该曲封面，而艺术家及专辑界面缺图。以下前两项是能够使有封面单曲不进入读取通道的前端调度缺陷；第三项是多曲实体中独立存在的候选缺口，不能单独解释该单曲示例。确切用户文件的原生读取结果仍须由运行证据确认，不能仅凭播放器图片断言缩略图命令已成功。

### 8.1 已确认的代码因果链

| 缺陷 | 因果链 | 可复现输入与信号 |
| --- | --- | --- |
| 虚拟窗口新增节点未注册 | `AlbumLibraryPanel` 传入 `panelRef` 作为封面 listRef，而卡片位于嵌套 albumListRef；`observeRendered` 要求直接子节点数等于 renderedItems 数，通常不成立而直接返回。虚拟窗口变化不改变完整 itemOrderKey，原 IntersectionObserver 只持有初始窗口节点 | 创建超出首个窗口的艺术家，滚动或索引到后来挂载的卡片；确认可见卡片存在，但该 sourcePath 没有 `audio_load_track_thumbnail` 请求 |
| 同资源多个节点被单节点 Map 覆盖 | hero、“所有歌曲”入口、首专辑卡可使用同一首曲目的 data-song-key；合作曲也可让多个艺术家卡共用此 key。节点 Map 每 key 只保留最后一个元素；该元素离视口时会撤销整个 key 的需求，忽略仍可见的先前节点 | 冷缓存、摘要 ready、一个有图单曲的艺术家，hero 可见而最后同 key 专辑卡在 panel.bottom + 150px 外；不滚动时不产生封面请求。合作艺术家卡一前一后可构造同样失败 |
| 实体只探测一首可用曲目 | `artistEntries` / `albumEntries` 的 coverSong 仅代表第一首 available，页面也只提交这首；native 空响应会成为该曲已完成的无图缓存，没有其他成员候选 | 同实体首曲无封面、第二曲有封面；只请求第一首、一直占位，而播放第二首可以正常显示封面。此项不能解释所有单曲案例 |

`useAllSongsWindow` 已有 `track-candidates` 分支，按有界顺序经过全局 scheduler 探测，首个有像素结果后停止；其 identity 已包括候选 trackId、sourcePath、available、artworkRevision。无需新建原生接口或用重试、延迟、全量预读掩盖需求遗漏。

原生 `load_track_thumbnail_blocking_with_mode` 对无嵌入图曲目会尝试同目录有效封面；播放 hydration 的 `metadata.rs` 也有同目录后备。前端先确定是否确实发出命令，再判断 empty/error/像素响应；不因两通道都能读目录图就假定每个特定文件结果必然相同。

### 8.2 修复契约

1. **资源身份与观察节点分离。** 封面缓存使用稳定的实体 key：艺术家 key 包含 artistKey，艺术家内专辑 key 包含 artistKey 与 albumKey，全局专辑 key 使用独立前缀。不得使用首曲 key 冒充实体 key，不把变化的候选列表编码进实体 key。候选变化、可用性或扫描 revision 通过 descriptor identity 失效，不污染原始歌曲身份。
2. **实体封面候选。** 艺术家和专辑构造 `TrackCandidatesCoverItem`，候选仅来自本实体 songs，按稳定顺序去重；available 决定是否可请求。根卡、同一实体 hero 及所有歌曲入口共享该资源 key 和已解码 URL。艺术家内专辑不能探测不属于该艺术家的其他合辑曲目。保留已有 coverSong 字段用于其他代表曲目职责时，实际封面读取不再被它限制为单候选。
3. **虚拟窗口注册。** `useAllSongsWindow` 的节点发现及 rendered-window reconcile 必须能处理嵌套卡片。允许在窗口变化时对当前 listRef 内显式 `[data-cover-key]` 或 `[data-song-key]` 做一次受当前 DOM 窗口约束的扫描，按 renderedItems key 注册、移除节点；同节点优先 cover key，保留 song key 的键盘和选择职责。不能依赖 panel 直接子节点数，也不因每次滚动重扫全库或完全重建 observer。
4. **一个资源多个可见参与者。** 每个资源 key 可对应多个 DOM 元素；按任一仍相交节点存在计算 desired，按任一在真实视口内的节点计算 priority-0。单个离屏或卸载节点不能撤销另一个仍可见节点的需求。渲染窗口卸载后清除旧节点，观察数据与缓存订阅分别拥有生命周期。hero、入口、卡片共享图片不得为了规避节点覆盖而重复解码多个副本。
5. **取消与缓存。** 保留 WINDOW_CONCURRENCY、scheduler 全局上限、AbortSignal、isCurrent、descriptor identity 检查。候选变化或 revision 更新后旧完成不得覆盖新 descriptor；空结果只说明已尝试的完整候选均无图，暂时失败继续使用既有 transientFailure 语义，不能写成永久无图。封面加载不反向触发全库艺术家分组。
6. **租约与回场景。** 根卡进入 hero 的离场租约应保留实体 key，hero 与入口订阅同一资源；场景卸载和不再展示后再释放 URL。保留既有缓存预算，不能清空全局缓存修复缺图。歌曲列表继续用原始歌曲 key 和原生单曲 descriptor，两种资源不会覆盖彼此缓存。

### 8.3 修复验证与实施边界

Test Agent 在修复前捕获上述三种失败证据，修复后验证：晚挂载卡出现 native 请求及真实 img；单曲冷缓存 hero/入口/专辑均能加载；多个共享资源节点中一处离屏不影响另一处；首曲无图第二曲有图只探测到首个成功候选并共享 root/hero URL。补充全候选无图、读取异常、候选撤换、rescan revision、切出期间旧完成及缓存淘汰租约回归。

Frontend Agent 独占组件、候选 descriptor 和 hook 修复；Test Agent 独立核对实际 Shell 浏览器路径及请求/图片证据。索引条覆盖布局由前端另行检查，本节不重复 CSS 调查。主代理完成 repository 级 lint/build，具体用户音频若不可访问，报告保留文件级原生结果证据限制。

## 9. 艺术家内层头图更多菜单复用

2026-10-29 用户要求艺术家内层使用播放列表头图的更多按钮及带封面信息的弹层；艺术家根页继续使用分类根菜单。复用 `PlaylistHeroMoreMenu` 的触发器、Dialog、封面信息区、动作列表、滚动条及未接入动作说明，不将 `LibraryRootMenu` 的根页触发器放进 hero。

允许为 `PlaylistHeroMoreMenu` 增加可选 `contextLabel` 和 `actions`。`contextLabel` 默认“播放列表”，仅控制辅助技术标题、动作分组与滚动条文案。`actions` 为只读动作数组，可含 `label`、`icon`、`description?`、`flip?`、`disabled?`、`pressed?`、`onSelect?: () => void`；`pressed` 仅用于置顶动作的 `aria-pressed`。未传入 actions 时保留原有七项播放列表动作及各自 notice，不改变已有调用方行为。

艺术家内层由调用方提供以下五项，不让共享菜单组件依赖 library view model 或直接调用原生接口：

| 动作 | 执行与状态 |
| --- | --- |
| 选择文件夹 | 调用 `library.onSelectFolders`；导入或扫描忙碌、缺少回调时禁用 |
| 重新扫描 | 调用 `library.onRescanFolders`；沿用现有 busy 与回调禁用条件 |
| 封面 | 使用现有尚未接入说明，不增设写图、图片下载或持久化 |
| 在侧栏置顶 / 取消侧栏置顶 | 按 `pinnedCategoryIds` 表示艺术家分类状态，调用 `onToggleCategoryPin('artist')`；不新建单个艺术家的固定项 |
| 列表选项 | 使用现有尚未接入说明，不新增设置来源 |

有 onSelect 的动作先关闭菜单，再交接回调；没有 onSelect 的动作进入现有 notice。选择文件夹将打开另一个 Dialog，必须复用分类根菜单已用的 `transferring` 内容抑制及焦点交接策略，避免两个 focus trap 重叠或旧弹层关闭时抢回焦点。不能仅把 React 批处理中 `setOpen(false)` 的调用顺序视作旧弹层已卸载。禁用动作不执行回调。

菜单展示当前内层实体的名称、成员数、时长和已有候选封面，沿用实体封面订阅及 hero 租约；菜单不会建立另一份封面缓存或原生请求来源。关闭菜单、进入说明、返回动作列表和键盘 Escape 后焦点按现有可访问性行为恢复。

本轮同时移除艺术家内专辑卡的专属字体覆盖，同布局档位使用全局专辑卡的尺寸和文字规则。该项属于局部样式收口，不改变实体模型和成员边界。

验收应分别覆盖：播放列表旧菜单七项保持；艺术家根/内层触发器和弹层正确；五项动作回调、busy、pin 状态、notice 与焦点交接正确；封面和计数来自当前实体；艺术家内与全局专辑相同档位的文字尺寸一致。前端独占 src 实现，测试独立核对，当前接口方案可直接实施。

## 10. 头图时长格式与菜单高度收口

头图总时长采用已有 `playlistDuration.ts` 的纯函数 `formatDurationClock`：不足一小时显示 `M:SS`，一小时及以上显示 `H:MM:SS`。本次仅导出该既有函数供 `AlbumLibraryPanel.clock`、`FolderHierarchyPanel.totalClock` 调用；播放列表头图及更多菜单已经通过 `formatPlaylistDurationLabel` 使用该格式，不另行格式化其字符串。艺术家、艺术家所有歌曲、艺术家内专辑、全局专辑、平铺文件夹、层级文件夹及播放列表头图保持相同钟表格式。

格式化只发生在展示边界，不能修改真实总秒数、可用性筛选、求和、解码时长或持久化内容。有效总秒数向下取整；`0` 为 `0:00`，`3599` 为 `59:59`，`3600` 为 `1:00:00`，超过一天继续显示总小时。null、undefined、非有限值或负值返回 null。集合现有“可用曲目存在未完成时长则返回 null”判断不变，不能用 `0:00` 冒充读取完成；播放列表的“统计中…”、“统计失败”、“时长未知”继续由现有状态 formatter 控制。

艺术家更多菜单使用同实体头图 helper 的结果。文件夹卡片若自然消费同一 `totalClock`，允许同步受益以避免同实体卡片与头图分叉；单曲行、播放器时间轴及 `trackUtils` 的既有约定不在本轮修改范围内。

更多菜单正常视口下按内容自然高度完整显示动作，以视口安全边距约束最大高度。极小视口允许仅在必要时启用原生 `overflow: auto` 后备，保留键盘到达所有动作的能力；不能用隐藏溢出裁剪动作，也不设强制最小高度把弹层撑出视口。可移除只服务于固定高度的菜单自定义滚动条实现，避免双滚动条；无需改变共享菜单公共 props。

验收覆盖零时长、分钟及小时边界、超过一天、null/非有限/负值和 loading/unknown/error 状态；核对各头图与更多菜单实际文案，以及正常与极小视口中全部动作可达。Frontend Agent 独占实现，Test Agent 独立验证，无后端、命令、依赖或数据契约变更。

## 11. 专辑详情设计补充

专辑详情视觉依据补充为用户提供的 Figma 节点 `8134:19952`，头图布局、真实专辑名称、作者和成员统计与全局专辑共用；艺术家内专辑仍以当前艺术家匹配曲目为成员，返回当前艺术家的专辑视图。没有真实专辑级年份来源时省略设计年份，不新增摘要字段或借正在播放曲目的年份补值。

全局专辑详情改用既有头图更多菜单，动作的分类回调为 album；艺术家内专辑继续保留本文件第 9 节规定的艺术家菜单上下文，名称、成员数、时长、候选封面及置顶回调均来自当前艺术家。共享组件通过既有可选 actions/contextLabel 接收差异，不增加公共接口。完整全局专辑收口见 `docs/architecture/album-library.md` 第 8 节；原始歌曲身份、ArtistLocation、成员过滤和队列来源保持不变。

用户随后授权真实专辑年份，覆盖本节先前“不扩摘要”的边界；最新跨层契约以 `docs/architecture/album-library.md` 第 9 节为准。艺术家内专辑从其最终匹配成员的原始 libraryYear 聚合：存在有效年份时显示最早年份，全部无效或缺失时省略年份整项及分隔符，不显示“年份未知”或“年份不一”。有效性沿用正的 safe integer 及 u32 范围校验。年份不参与分组，不从播放 hydration 回填，不改变后端或现有摘要通道；专辑头图显示曲目数、compact 总时长及存在的最早年份，名称继承标准标题字号。艺术家概览及艺术家更多菜单继续使用原有艺术家上下文，不凭空创建一个艺术家的发行年份。
