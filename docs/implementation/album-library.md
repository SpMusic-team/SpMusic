---
doc_id: "IMPL-ALBUM-LIBRARY"
title: "媒体库专辑分类实现"
doc_type: "implementation"
status: "active"
owner_agent: "Frontend Agent"
version_scope: "project"
created: "2026-10-28"
updated: "2026-11-03"
source_documents:
  - "user request: 完成媒体库专辑分类，根页面复用所有歌曲侧边索引"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=8007-15164"
  - "docs/architecture/album-library.md"
  - "user request: 缺少ALBUMARTIST时，同目录同名专辑按合辑合并并继承已知年份"
---

# 媒体库专辑分类实现

## 数据与身份

专辑消费与所有歌曲相同的已选择存储投影和按路径去重的歌曲集合，不并入外部 M3U8 或自定义播放列表。`playlistTrackRowFromSummary` 保留原始 `libraryAlbumName` 与 `albumArtist`；缺失标签记录为 `null`，尚未读取记录为 `undefined`。播放器水合元数据仍负责展示和时长，但不能覆盖分组身份字段。

`albumLibrary.ts` 集中生成稳定专辑身份：有专辑名及专辑艺术家时按两者归组，允许跨目录多碟合并；缺失专辑艺术家时，按专辑名和直接父目录归组，保留不同曲目艺术家组成的合辑；未知专辑无论是否有专辑艺术家标签均按目录隔离。不能直接使用展示回退值“本地音频”作为专辑名，也不以曲目艺术家拆分同目录合辑。

2026-11-03 用户确认上述同目录合辑规则，替代之前缺少 ALBUMARTIST 时按完整 ARTIST 署名分组的策略。有显式 ALBUMARTIST 使用类型化 `album-artist` 身份分支，缺少或空白 ALBUMARTIST 使用 `directory` 分支；二者不会因 ARTIST 与另一组 ALBUMARTIST 同名而合并。没有专辑艺术家标签的跨目录多碟专辑不会自动合并，防止不同目录的合辑经重合 ARTIST 被间接串联。大小写与路径规范化遵循现有曲库规则。无真实专辑名的未知专辑继续按目录隔离，整组均无显式 ALBUMARTIST 时再按完整 ARTIST 署名细分。

## 页面与交互

`AlbumLibraryPanel` 采用独立专辑实体数据，不将专辑身份冒充文件夹路径。根页复用 `CollectionManagementHeader`、原有 CD 分类资产、管理控制器和主题样式；封面来自本地曲目，设计稿里的示意图片不作为静态专辑数据。卡片展示专辑名和作者；作者优先专辑艺术家，否则先将每条曲目的原始艺术家按“/”拆分，逐段去除首尾空白、过滤空值，再去重并稳定排序，用“/”连接；没有艺术家标签时显示“未知艺术家”。不扩展逗号、`&` 或 `feat` 等拆分规则，不写回任何标签。

用户的 `Hypersynthetic` 专辑提供了实际标签证据：两首曲目的 `ARTIST` 为 `Akira Complex`，另一首为 `Akira Complex/kors k`，均无专辑艺术家标签。原先对整串艺术家去重，再连接会产生 `Akira Complex/Akira Complex/kors k`；逐段去重后的专辑作者为 `Akira Complex/kors k`。此处理仅派生页面作者文案，不写回音乐文件标签。

根页与详情页分别保留布局档位。详情复用 `CollectionHero`、`PlaylistCard`、窗口化歌曲渲染、封面窗口与租约、侧栏和播放控制器。搜索根据当前层级过滤专辑名/作者或歌曲；根页多选展开为所选专辑歌曲，详情多选限定当前专辑歌曲。播放与随机播放通过既有 `onPlaySong` / `onShufflePlay` 执行，保留真实 `scope/trackId` 和既有 `all-songs` 队列来源。

`PlayerShell` 保存 `albumLocation`；从分类入口进入时重置，从播放器返回时保留。只有当前可见场景在摘要、扫描与恢复完成后，才清理已不存在的专辑位置。

## 侧边索引复用

`CollectionQuickIndex` 现为所有歌曲、播放列表、文件夹和专辑共用组件。公共部分统一负责索引键、首项查找、拖动捕获、键盘激活、预览浮层和取消清理。普通卡片通过选择器滚动；所有歌曲通过回调保留原有虚拟窗口偏移计算和待执行自动定位取消行为。索引名称数组使用稳定 memo，避免滚动窗口变化重复扫描全库。

## 边界

本次未增加 Rust command、数据库、扫描机制、依赖或权限。更多菜单复用分类既有入口，列表选项等尚未接入的动作仍明确提示现有边界。
