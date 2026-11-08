---
doc_id: "ARCH-SONG-RATING-DISPLAY"
title: "全局歌曲列表评级展示契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "user request: 所有歌曲列表展示评级，最常播放保留次数，集合行不展示"
  - "docs/architecture/track-rating-persistence.md"
  - "src/features/player/components/PlayerSurface.tsx"
  - "src/features/player/components/PlaylistCard.tsx"
  - "src/features/player/components/QueuePanel.tsx"
---

# 全局歌曲列表评级展示契约

## 边界与数据流

`useAudioPlayer` 仍持有唯一评分状态，`PlayerSurface` 仍持有唯一评分模式。Surface 在歌曲界面共同祖先提供窄 React context，仅包含只读 `ratingsByTrackId` 与 `ratingMode`。共享 `PlaylistCard` 及队列歌曲行消费 context，以现有曲目 ID 取值；缺省 provider 使用空评分，不新建存储读取或独立模式状态。评分持久化沿用既有契约。

显示组件提取统一的只读评级徽标或展示判定，列表和队列共用。五星模式仅 1～5 显示对应实星，赞踩模式仅 5 显示赞、1 显示踩；0 与赞踩模式的 2～4 均不产生徽标节点、空占位或额外布局标记。无障碍文案与实际显示一致。

最常播放通过显式 `hideRating` 或等价属性禁用评级，不依赖次数是否暂时存在。次数优先于评级，保留原次数、布局及交互。其他歌曲共享既有评级位置和尺寸；不新增评级编辑动作，不改变导航、排序、筛选和播放队列行为。

## 已核对的界面映射

| 歌曲界面 | 共享行入口 |
| --- | --- |
| 所有歌曲、最近播放、最近添加、长、评级、流 | `PlaylistLibraryPanel` 的 `AllSongsCard` → `PlaylistCard` |
| 自定义与文件播放列表及曲目详情列表 | `PlaylistPanel` → `PlaylistCard`；Surface 内 `OwnedPlaylistPanel` 透传 |
| 专辑、艺术家、专辑艺术家、作曲家、年份、流派中的歌曲视图，包括根级歌曲模式 | `AlbumLibraryPanel` 的 `AlbumSong` → `PlaylistCard` |
| 文件夹平铺、层次内歌曲 | `FolderHierarchyPanel` 的 `Song` → `PlaylistCard` |
| 书签歌曲 | `BookmarksPanel` 的 `BookmarkCard` → `PlaylistCard`，按歌曲身份而非书签 ID 取评分 |
| 搜索歌曲结果 | `SearchPanel` 的 `SearchSong` → `PlaylistCard` |
| 播放队列 | `QueuePanel` 的 `QueueTrackRow`，单独消费 context 并复用评级徽标 |

专辑、艺术家、文件夹、流派、年份、播放列表等集合行使用单独组件，不消费评分。不得把集合代表歌曲的评分显示在集合卡片上。

## 取舍与质量属性

逐层传递属性也可实现，但需改动六条歌曲视图链路，增加遗漏风险。窄 context 将读取限定在歌曲行，沿用真实状态且不扩大业务依赖。模式或评分更新会通知当前挂载的歌曲消费者，这是本次接受的取舍；保留虚拟化，不进行全库节点物化。播放轮询无需改变 context 值，provider 应 memoize，避免每个进度更新触发评级消费者。

共享展示不新增文件访问、网络、权限、后端命令或依赖。默认上下文支持独立组件和既有测试；未来若需要逐曲订阅优化，应保留显示规则及存储契约，本次不提前引入另一套状态管理。

## 验收与所有权

Frontend Agent 独占所需 `src` 文件及实现文档；Test Agent 独立验证，Architecture Agent 仅维护本文。并行工作不改写其他 Agent 的文件。

- 每条歌曲入口显示同一当前模式与评分，切换后同步更新，重启后沿用已恢复评分。
- 未评分无徽标及空白占位；中间分值在五星模式显示、赞踩模式隐藏。
- 最常播放始终保留次数，任何模式都无评级徽标。
- 专辑、文件夹等集合行无评级；其歌曲视图有评级。
- 书签按曲目身份关联，多书签共享评分；搜索歌曲与队列正确关联真实歌曲 ID。
- 队列保持虚拟化、歌曲点击与不可用状态；其他列表保留既有布局、选择、播放和动效。
