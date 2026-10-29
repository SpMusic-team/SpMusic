---
doc_id: "ARCH-CONTRIBUTOR-LIBRARY"
title: "专辑艺术家与作曲家分类的数据及页面复用契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-10-29"
updated: "2026-10-29"
source_documents:
  - "user request: 完成媒体库专辑艺术家与作曲家分类，样式动效和已有艺术家页面一致，仅查看属性不同"
  - "docs/architecture/artist-library.md"
  - "docs/architecture/album-library.md"
  - "docs/architecture/poweramp-entity-views.md"
  - "docs/decisions/2026-07-09-document-metadata-standard.md"
  - "src/features/player/model/artistLibrary.ts"
  - "src/features/player/components/AlbumLibraryPanel.tsx"
  - "src/features/player/components/PlayerShell.tsx"
  - "src-tauri/src/audio/types.rs"
  - "src-tauri/src/audio/metadata.rs"
  - "src-tauri/src/audio/playlist_summary.rs"
---

# 专辑艺术家与作曲家分类的数据及页面复用契约

## 摘要与范围

在当前艺术家分类的实现上增加专辑艺术家、作曲家两个入口。三个分类复用同一实体模型算法、页面组件、布局、动效和集合操作，仅原始标签来源、分类身份、文案和分类图标不同。用户本次授权覆盖既有艺术家文档中“不扩大为专辑艺术家分类”的旧范围限制。

本次不引入数据库、扫描设置、标签写入、在线服务、依赖或权限；不将外部 Poweramp 尚未取证的专辑艺术家 SQL 推断为产品要求。

## 1. 模块边界和数据方向

`Lofty 原始标签 → 现有 Rust 摘要命令 → audioCommands parser → playlistTrackSummary 原始字段 → PlayerShell allSongs → 分类成员派生 → 共享专辑派生和页面`。

Rust 负责读取标签和序列化；前端负责成员分组、导航与呈现。已有 `AudioTrackMetadata` hydration 通道同时增加作曲家标签以保持元数据契约一致，但分类归属仍由摘要通道负责，不由播放 hydration 覆盖。

曲库范围继续只取用户选中的文件夹曲库，按规范化源路径去重。自定义播放列表和 M3U8 额外曲目不混入分类。播放、选择、加入列表和删除沿用原始 `{ scope, trackId }`，不以分类实体 key 冒充 scope。

## 2. 原始标签契约

| 分类 id | 原始音频属性 | 前端分类字段 | 缺失时显示 |
| --- | --- | --- | --- |
| `artist` | ARTIST | `libraryArtistName` | 未知艺术家 |
| `album-artist` | ALBUMARTIST | 现有 `albumArtist` | 未知专辑艺术家 |
| `composer` | COMPOSER | 新增 `libraryComposerName` | 未知作曲家 |

三个分类不得互相回退。展示用 `track.artist` 已包含 ARTIST → ALBUMARTIST → 默认值的回退，只用于歌曲行文案，不作为任何分类身份来源。专辑艺术家缺失而 ARTIST 存在时仍归未知专辑艺术家；作曲家同理。

前端原始字段保持 `undefined | null | string` 三态：`undefined` 表示摘要尚未完成、不产生实体成员；`null` 表示已完成但缺失、空白或沿用既有失败降级；非空字符串为 trim 后标签。真实名为“未知作曲家”等字符串必须与 null 实体区分。

后端 `AudioTrackMetadata` 与 `AudioPlaylistTrackTagSummary` 均新增 `composer: Option<String>`，camelCase JSON 为 `composer: string | null`，通过 `tag_text(tag, ItemKey::Composer)` 读取。标签选择沿用当前 `primary_tag().or_else(first_tag())`，无标签保持 None。既有 `album_artist` 不变，不新增重复字段。不改变批次上限、路径回显、错误语义或独立时长通道。

TypeScript `AudioTrackMetadata`、`PlaylistTrackTagSummary` 可以将新增 composer 定义为可选 nullable，以兼容既有 typed fixtures；摘要 parser 将旧响应的缺省值规范为 null，并按现有文本字段规则拒绝非字符串值。`playlistTrackRowFromSummary` 生成 `libraryComposerName`，行相等比较、`PlaylistTrackItemViewModel`、Shell 摘要覆盖均透传。无需给播放器视觉 Track 模型增加分类状态。

摘要缓存目前为按 scope 管理的内存快照，无旧持久化摘要需要迁移。保持 descriptor fingerprint、library epoch、runId 和 rescan 失效规则，不新增缓存或通过清空全局缓存掩盖串类问题。

## 3. 分组和专辑作用域

三个分类统一使用现有 `splitArtists`：仅 `/` 拆分，trim、去空、单曲内去重，保护完整 `AC/DC` 和 `+/-` 片段及合作串中的这些名称。不增加逗号、`&`、`feat.` 等隐式拆分规则。这是项目复用基线，不声称为 Poweramp 默认行为。

实体 key 使用 `JSON.stringify([categoryId, nameOrNull])`；保留标签大小写。不同分类中相同姓名拥有不同 key，缺失与字面未知名拥有不同 key。实体成员按原始歌曲 key 去重，名称及歌曲标题按既有 quick index 和稳定 key 排序；多个实体批量展开歌曲时再次去重共享成员。

进入实体后默认展示该实体的专辑，以及独立“所有歌曲”入口，层级行为与艺术家一致。专辑由 `albumEntries(currentEntity.songs)` 派生：先筛当前实体成员，再聚合专辑。当前实体的计数、时长、封面候选、专辑详情、播放和随机只覆盖这些成员。

专辑身份继续依据既有专辑名和有效 ALBUMARTIST/ARTIST 署名集合；作曲家仅决定成员过滤，不能替代专辑署名。复用既有同名同署名跨目录合并、未知专辑目录隔离、个人/合作分组及最早有效年份算法，不再按分类复制一份专辑算法。

## 4. 导航、状态和资源身份

可复用现有 `ArtistLocation` 的 `{ artistKey, view: 'albums' | 'songs' | 'album', albumKey? }` 形状，通过分类位置映射或三个独立字段保存，不要求为同一结构重复声明三个类型。保留现有 artist API 作为兼容入口亦可。

每个分类独立保存位置。进入分类菜单重置该分类到根页；播放器返回恢复当前分类及内层位置。返回顺序为歌曲/专辑详情 → 当前实体专辑 → 当前分类根 → 概览。不得复用另一个分类的实体位置。

route、搜索、选择、滚动、layout storage、封面候选、hero/projection 身份必须包含当前 categoryId；内层详情还包含实体 key 和 albumKey。共享页面和 CSS 不意味着共享分类实例状态。菜单置顶回调、根图标、辅助技术文案和“所有…歌曲”标题均依据当前分类，避免新分类仍显示或置顶“艺术家”。布局规则及动效本身不变。

`PlayerShell` 的摘要 ensure、优先时长 scopes、allSongs 聚合补全、播放器返回分类白名单和 `PlayerSurface` 渲染入口均纳入两个新分类。加载、恢复、重扫、导入期间沿用艺术家 loading 策略，不允许基于未完成成员执行操作或清除位置。稳定后实体不存在才回根，实体仍在而专辑消失回实体专辑；只有当前 present 场景可清理，离场场景保持 inert。

继续复用 `collectionCover` 候选、现有 cover store/lease 和窗口能力。不因每张封面到达重新分组全库；不增加网络封面或新缓存。

## 5. 备选方案与质量属性

| 方案 | 取舍 |
| --- | --- |
| 对现有艺术家路径增加有限分类配置 | 采用；同一数据形状和交互规则直接复用，避免三份动效、焦点与生命周期逻辑漂移 |
| 为两个分类各复制完整页面 | 拒绝；现有页面覆盖大量集合生命周期，复制容易漏掉后续修复 |
| 新增后端实体表/命令 | 拒绝；现有摘要足以派生，增加持久化与迁移成本而无本次需求收益 |
| 使用展示 artist 或跨字段后备 | 拒绝；违反用户按不同音频属性查看的目标 |

性能与内存：复用稳定 allSongs 与 useMemo，每次只按当前分类派生，封面流不触发全库重算。启动仅多读同一标签中的 composer，无新文件扫描、时长解码或侧文件读取。跨平台使用现有 Lofty 映射和路径规范。纯模型及 parser 易于测试；共享视图减少视觉偏差。后续如用户授权配置分隔符，只更换统一拆分策略，不改变歌曲原始身份或命令。权限保持现状。

## 6. 文件所有权和验收

Rust/Tauri Agent 独占 `src-tauri/src/audio/types.rs`、`metadata.rs`、`playlist_summary.rs`；其他 Rust literal 若编译需要修改，应先向主代理申请精确路径。Frontend Agent 独占 `src/**` 生产实现及已分配既有测试，包括 services DTO/parser、摘要行/VM/Shell、artistLibrary 模型、AlbumLibraryPanel 和 PlayerSurface。Test Agent 独占新建 `contributor*.test.*` 与其测试文档。Architecture Agent 仅写本文件。共享文件变更由单一前端 owner 顺序处理，保留当前工作区已有修改。

验收标准：

- 同一歌曲的 ARTIST、ALBUMARTIST、COMPOSER 不同时，三个分类分别归入正确实体；缺失标签不跨字段借用。
- 多人拆分、例外名、空白、去重、同名不同分类、真实未知名和 null 均有纯模型覆盖。
- 两个新入口实际渲染根页、实体专辑、所有歌曲与专辑详情，样式动效共用既有艺术家路径；当前成员计数、封面和播放候选一致。
- 搜索、选择、返回、播放器往返、布局偏好和菜单置顶在分类间不串用；loading 与 rescan 位置清理规则有效。
- 原始 composer 从合成音频经真实 Rust 读取、JSON/TS 契约、parser 和摘要行到实体有证据；旧缺省响应仍兼容，非法文本值不被伪装成功。
- 既有艺术家/全局专辑回归通过，尤其个人合作分组、跨目录合并和最早年份不变；运行前端 lint/build、聚焦模型/浏览器验证、Rust 相关测试及 cargo check。

风险是复用代码中硬编码 artist 的身份与文案遗漏、只从 hydration 获取 composer 导致未播放歌曲无法归类，以及过滤之后意外回到全库专辑成员。Test Agent 应独立检查这三条因果链。实际音频输出仍沿用已有播放能力，本次新增标签归类不声称扩展音频格式支持。
