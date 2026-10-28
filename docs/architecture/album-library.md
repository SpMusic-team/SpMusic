---
doc_id: "ARCH-ALBUM-LIBRARY"
title: "专辑分类的数据、导航与复用契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-10-28"
updated: "2026-10-28"
source_documents:
  - "user request: 完成媒体库专辑分类；无头图根页复用所有歌曲侧边索引"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=8007-15164"
  - "docs/architecture/poweramp-entity-views.md"
  - "docs/architecture/media-library-page-relationships.md"
  - "docs/decisions/2026-07-09-document-metadata-standard.md"
  - "src/features/player/components/PlayerShell.tsx"
  - "src/features/player/components/FolderHierarchyPanel.tsx"
  - "src/features/player/components/CollectionQuickIndex.tsx"
  - "src/features/player/components/PlaylistLibraryPanel.tsx"
  - "src/features/player/hooks/useAllSongsWindow.ts"
  - "src/features/player/model/playlistTrackSummary.ts"
  - "src/features/player/model/playbackQueue.ts"
  - "src/features/player/services/audioCommands.ts"
---

# 专辑分类的数据、导航与复用契约

## 摘要

专辑分类从现有选中存储曲库派生，根页按设计显示专辑封面、名称、作者，并复用所有歌曲侧边索引；详情页复用现有集合头图、歌曲列表和播放通道。本次无需增加 Rust command、权限、数据库、标签写入或新的队列来源类型。

本文记录实施前审查通过的契约及其验收标准，不代表实现与运行验证已经完成。旧版本计划中的媒体库排除范围不覆盖本次用户明确授权；本次不改变其他长期功能的排期。

## 1. 数据来源与边界

数据链路为 `libraryFolderPlaylists → 按 sourcePath 去重的 allSongs → 摘要与时长补全 → 专辑分组 → 根页/详情页`。沿用现有目录选择投影，不混入 M3U8、自定义播放列表的额外歌曲。每首歌保留原始 `scope`、`trackId`、`sourcePath` 和规范化路径 `key`；专辑身份不能替代歌曲身份或产生伪造的播放列表 scope。

后端 `PlaylistTrackTagSummary` 已提供 `album`、`albumArtist`，时长继续来自现有解码时长通道。当前前端摘要 mapper 会丢弃 `albumArtist`，并将空 `album` 显示成“本地音频”；实体分组不能从这些展示后备值反推原标签。

前端摘要行保留以下原始语义字段，并在行相等比较、稳定行复用和聚合时透传：

| 字段 | 语义 |
| --- | --- |
| `libraryAlbumName?: string \| null` | trim 后的原专辑标签；`undefined` 表示尚未读到摘要，`null` 表示该轮已完成但没有有效标签 |
| `albumArtist?: string \| null` | trim 后的原专辑艺术家标签，缺失状态同上 |

完整 hydration、正在播放曲目和视觉通道仍可补充展示元数据，但不能用它们的默认 `album` 文案抹掉原始分组字段。摘要失败沿用现有降级完成语义，不能无界重试或伪称成功读取标签。

`PlayerShell` 中摘要 ensure、优先时长 scope、聚合歌曲补全的分类判断都必须包含 `album`。只有增加路由和卡片而未打开这三个数据通道，会导致专辑页一直消费待加载描述符。

## 2. 专辑身份与成员

对 trim 后的原始标签使用如下稳定分组身份，数组使用 `JSON.stringify` 编码，避免名称中包含分隔符时发生碰撞：

```ts
[
  libraryAlbumName ?? null,
  libraryAlbumName && albumArtist
    ? ['artist', albumArtist]
    : ['directory', normalizeAudioSourcePath(parentFolder(sourcePath))],
]
```

名称与作者仅 trim，不强制大小写折叠；路径沿用现有保留大小写和 UNC 身份的规范化规则。成员按歌曲 `key` 去重，不能按标题去重。

有专辑名称和专辑艺术家标签时，同名同作者跨目录合并，允许多碟目录归属同一专辑；不同专辑艺术家的同名专辑分开。缺失专辑艺术家时按直接父目录隔离，避免不同作者同名专辑误并，并避免合辑因为曲目艺术家不同而被拆成多个专辑。缺失专辑名称时，无论是否存在专辑艺术家，都按目录形成“未知专辑”，不会把所有未标注曲目并成一个全库实体。

作者副标题优先使用专辑艺术家；没有该标签时先按“/”拆分各曲目的艺术家标签，逐段 trim 并排除空值及展示后备值，再对艺术家名称去重，按首次出现顺序用“/”连接，均缺失时显示“未知艺术家”。仅用于作者展示，不改写原始标签或分组身份。

已知取舍：缺失专辑艺术家标签的多碟目录不会自动合并；标签本身无法区分的同名同作者不同发行版可能合并。本次不新增目录猜测、年份读取或外部匹配机制。专辑根名称排序复用 `compareByQuickIndex`，名称相同时再以稳定专辑身份决定顺序；详情沿用当前可用的歌曲排序，不宣称已支持曲号、碟号和年份排序。

## 3. 加载、重扫与导航生命周期

专辑根页与详情页都在 `category:album` 下，使用显式专辑位置（如 `albumLocation: string | null`）区分。分类入口进入根页，点击卡片进入对应专辑，详情返回根页，根页返回媒体库概览。从播放器返回媒体库时应保留本会话专辑位置，与两个文件夹分类已有行为一致。

根页可以显示加载态，但不能在原始标签尚未完成时把 pending 歌曲永久归入“未知专辑”并开放基于该临时分组的播放操作。进入专辑时记录稳定实体身份，不能只记录当前数组下标。

重扫、恢复或导入未完成时保留当前专辑位置，不根据暂时空数组跳回根页；数据已稳定且实体确实不存在时才返回根页。只有当前 present 的场景可以触发位置失效清理；退出动画保留的旧场景不得清空新场景的位置。新增摘要批次仍服从已有描述符指纹与 scope 校验，过时结果不得覆盖新曲库。

根页、详情页使用不同的滚动、搜索和选择身份；返回根页保留当前会话根页滚动位置。专辑内部场景转换沿用集合页面的动效和 reduced-motion 规则。

## 4. 共享界面与索引

根页以用户提供 Figma 的高保真上下文为视觉依据：没有头图，显示专辑分类标题、媒体库返回入口、播放/随机/搜索/选择/更多操作，以及封面、专辑名和作者卡片。详情采用已有集合详情语义，不自行假设另一个未提供的 Figma 页面。

可复用 `FolderHierarchyPanel` 内集合 chrome、`CollectionHero`、控制器、侧栏、搜索、选择、歌曲窗口、集合布局与动效，但专辑不能伪装成物理目录。共享实现必须通过显式模式或判别联合表达专辑与文件夹；专辑成员筛选使用组成员集合，不能调用 `insideFolder` 或用专辑 key 冒充 `directoryPath`。原有平铺和层次目录的成员、返回、统计、封面语义继续由其分支负责。

实施前，`CollectionQuickIndex` 是文件夹版共享组件，仍硬编码 `[data-folder-path]` 和文件夹文案；所有歌曲的索引逻辑实际位于 `PlaylistLibraryPanel` 内。因此仅在专辑根插入原文件夹组件还不足以满足“复用所有歌曲”。本次应泛化同一个索引组件，并让所有歌曲和专辑根共同消费：

- 字母、数字、其他字符和返回顶部的指针拖动、键盘激活、浮层预览、关闭计时共用。
- 目标跳转允许由调用方回调负责，或配置通用条目 selector 与标签，不能绑定文件夹领域。
- 所有歌曲保留虚拟窗口的逻辑行定位：未挂载的歌曲也能跳转，不能退化为只查 DOM。
- 专辑以搜索后当前呈现顺序生成索引目标；同名实体仍有独立卡片身份。
- 专辑根显示索引，带头图详情页不显示根页索引；辅助技术文案与分类一致。

## 5. 播放、选择与封面

根页播放候选来自当前展示的专辑成员；选择模式下先筛选所选专辑再展开歌曲。详情播放候选只来自当前专辑的当前搜索/选择结果。候选按歌曲 key 去重，排除不可用项，转换成原始 `{ scope, trackId }` 顺序后交给 `library.onPlaySong` 或 `library.onShufflePlay`。点击歌曲不得把其他专辑追加进当前队列；选择全部、加入播放列表、删除等集合操作也不得越过当前候选边界。

继续使用 `kind: 'all-songs'` 的聚合队列来源，该名称表达队列的原始库来源，不代表每次必须把全库所有歌加入队列。禁止为专辑增加伪造存储目录或用户播放列表。

专辑封面以组内稳定选定的第一首可用曲目作为代表，复用 `useAllSongsWindow`、`useCollectionCoverUrl` 和共享封面 store，使用 track 封面通道，不调用 folder thumbnail API。缺少封面时使用已安装的专辑占位资产。根卡片、进入动画及 hero 对同一代表曲目使用一致封面身份；hero 和离场参与者复用 cover lease，防止缓存淘汰提前撤销仍在显示的对象 URL。封面完成仅更新订阅该封面的视图，不应重新分组全库。

## 6. 备选方案与质量属性

| 方案 | 取舍 |
| --- | --- |
| 现有曲库与摘要在前端派生专辑 | 本次采用；无需数据库、权限和后端 API 变更，直接复用曲目身份与加载通道 |
| 新建 Rust 专辑实体/数据库/索引 | 当前未证明必要，扩大权限、迁移和双来源同步负担，推迟 |
| 只按展示 `album` 分组 | 拒绝；默认值与真实标签混淆，同名专辑误并 |
| 缺失 albumArtist 时按曲目 artist 分组 | 拒绝；合辑会按每首歌的演唱者拆开 |

分组在歌曲及摘要变更时以 memo 线性派生，封面推送不触发分组；现有歌曲窗口与有界封面并发继续约束详情成本。根页卡片数量随实体数增长，若后续有规模证据再考虑实体窗口化。本次新增前端模块仍依赖现有服务契约，不反向让 Rust 依赖 UI 状态；无新增运行时依赖和权限。未来若增加曲号、碟号或发行身份，应单独审查摘要 DTO、序列化和迁移，不用显示文本承担稳定身份。

## 7. 验收标准

1. 真实带标签曲库可展示专辑根卡片、进入详情并返回；根页无头图且与设计稿布局一致。
2. 同名不同专辑艺术家分开；同名同作者跨目录可合并；无专辑艺术家合辑不按曲目作者拆分；无标签与读取失败有明确后备。
3. 重叠注册根不产生重复歌曲或重复计数；专辑播放、随机、选择展开只包含正确成员和原始 scope/trackId。
4. 摘要加载、重扫、移除存储、快速进入退出不出现临时未知组可播放、失效详情残留或离场场景清空新位置。
5. 所有歌曲和专辑根真实共用索引组件；字母、数字、其他字符、返回顶部、指针拖动和键盘均可用，所有歌曲虚拟窗口跳转保持正常。
6. 封面在根/详情/播放器来回切换及缓存淘汰期间不错误串图；无封面占位有效，退出时清理监听与请求。
7. 平铺文件夹、文件夹层次结构、所有歌曲、播放列表现有成员和导航规则无回归。
8. Frontend Agent 自测后由 Test Agent 独立核对分组、异步状态和候选边界；主代理完成 repository lint/build。实际播放与视觉检查若环境不具备，测试报告应明确列出证据缺口。
