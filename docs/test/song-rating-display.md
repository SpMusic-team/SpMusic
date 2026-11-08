---
doc_id: "TEST-SONG-RATING-DISPLAY"
title: "全局歌曲评级徽标独立验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "user request: 所有歌曲项目显示当前模式的评级，最常播放保留次数，集合不显示"
  - "src/features/player/components/songRatingDisplayAcceptance.browser.test.mjs"
  - "src/features/player/components/songRatingDisplayStreams.browser.test.mjs"
  - "src/features/player/hooks/useSongRating.ts"
  - "src/features/player/components/SongRating.tsx"
---

# 测试报告：全局歌曲评级徽标

## 摘要

独立全局代表路径、流列表专项、最高／最低评级回归及评级持久化回归浏览器测试均通过。静态调用点检查确认六处歌曲卡片调用和独立队列行接入同一实时评级 Context；最常播放仅显示次数，未评分及拇指模式中间分不创建徽标布局标记。

## 范围与调用点覆盖

| 渲染器 | 页面范围 | 覆盖方式 |
| --- | --- | --- |
| PlaylistPanel → PlaylistCard | 普通播放列表歌曲 | 真实 Shell 创建并打开会话播放列表验证 |
| PlaylistLibraryPanel → AllSongsCard → PlaylistCard | 所有歌曲、流、最高／最低、最近播放／添加、长、最常播放 | 所有歌曲、流、最高／最低、最常播放实际运行；其余同一调用点静态核对 |
| AlbumLibraryPanel → AlbumSong → PlaylistCard | 专辑歌曲详情；艺术家、专辑艺术家、作曲家、年份、流派的歌曲视图／详情 | 专辑详情和艺术家所有歌曲实际运行，其余静态共用调用点核对 |
| FolderHierarchyPanel → PlaylistCard | 平铺文件夹／层次目录中的歌曲 | 两种文件夹歌曲实际运行 |
| BookmarksPanel → PlaylistCard | 书签歌曲（使用实际歌曲 track.id） | 实际书签列表运行 |
| SearchPanel → SearchSong → PlaylistCard | 聚合搜索歌曲结果 | 真实搜索 Song a，歌曲显示评级；集合结果不显示 |
| QueuePanel → QueueTrackRow → SongRatingBadge | 当前播放队列行 | 宽屏实际可见队列验证评级 |

PlayerSurface 的 SongRatingContext.Provider 统一提供当前模式及评级表；PlaylistCard 在使用数据布局标记前调用 visibleSongRating，队列同样消费 useSongRating。集合卡片 AlbumCard、FolderHierarchyCard 等独立渲染器没有消费 SongRatingBadge。

专辑根页面当前为专辑集合列表；代码没有独立的“专辑根歌曲模式”入口，本轮没有新增该模式。已检查根集合没有徽标；现存歌曲视图和向下进入的歌曲列表共用 AlbumSong／PlaylistCard。未把专辑详情测试冒充不存在的根歌曲模式测试。

## 实现交付与证据完整性

实现 Owner：Frontend Agent。验证仅新增 songRatingDisplay 两个测试和本报告；未改生产文件。实现主张“统一 Context 在模式／评分变化时更新既有歌曲卡片”，通过真实 Shell 多渲染器和设置切换反证遗漏接线。仅图标隐藏而残留布局的替代假设由未评分／2～4 拇指分数的 DOM 与 data-has-play-count 缺失断言排除。

## 独立执行命令

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
node src/features/player/components/songRatingDisplayAcceptance.browser.test.mjs
node src/features/player/components/songRatingDisplayStreams.browser.test.mjs
node src/features/player/components/highestRatedAcceptance.browser.test.mjs
node src/features/player/components/ratingPersistenceAcceptance.browser.test.mjs
```

四条最终均退出码 0。全局主测试实际覆盖 all-songs、playlist、bookmarks、flat-folder-songs、hierarchy-folder-songs、album-detail、artist-songs、search-song、most-played-count-only、queue。流专项覆盖布局 0、4、5、6、8 和模式切换。build／lint 由主 Agent 最终执行并通过，本报告不记为独立重复执行；未运行 cargo check／tauri dev，本轮无 Rust 修改。

## 断言与结果

- 五星模式：5、1、3 分歌曲分别显示对应分数；未评分行没有评级 DOM 或 data-has-play-count 布局标记。
- 拇指模式：5 显示喜欢，1 显示不喜欢；3 无徽标且无布局标记；模式可从真实设置切换。
- 同一评级在普通播放列表、文件夹、书签、实体歌曲和搜索中显示；文件夹／专辑／艺术家集合行没有评级徽标。
- 最常播放中的已评级歌曲仍只显示累计次数 3，没有评级 DOM。
- 流在 tile、标准行、双行紧凑和纯文本布局只显示一个可见徽标，未评分和中间分不产生布局占位。
- 最高／最低评级完整回归保留原成员条件、播放快照、三档星形／拇指尺寸、实心填充及无裁切。
- 持久化完整回归保留 0～5 恢复、实际播放器显示、喜欢／踩及取消、稳定 ID 重扫、晚到标签隔离和写失败提示。

## 人工检查与证据

证据目录：`C:/Users/winkeses/AppData/Local/Temp/spmusic-song-rating-display-evidence/`。

- `song-rating-queue.png`：独立查看 1920×1080 队列中已评分歌曲显示星级，未评分行没有徽标。
- `song-rating-streams.png`：流布局截图；截取时设置弹窗尚处退出过渡，图像仅作辅助。流徽标位置、唯一可见项和无评分无占位的判定来自各布局 DOM／几何可见性断言。

## 根因、时序与环境说明

首次主测试在 Vite 冷预构建发生页面载入超时；保持原超时重跑进入业务断言。艺术家夹具中长作者和 Singer A 为不同身份，测试按实际 Singer A 分组检查 duet；没有修改产品解析规则。QueuePanel 在原 1280 compact 响应式下按既有规则 display:none，改用产品已支持的 1920 宽屏 profile 验证，没有移除隐藏规则或改生产 CSS。

没有性能优化主张，不做性能基准。Context 接线及实时切换已验证；未验证真实大库重渲染性能。

## 跨层契约

无新增命令、事件、权限和存储格式。原生传输使用夹具，只验证前端接线和交互；实际音频设备不属于本轮结论。

## 发现、风险与结论

未发现剩余阻塞问题。六个歌曲卡片调用点和独立队列入口覆盖完整；少数同渲染器实体／派生分类为静态映射覆盖，未逐个分类进行独立手工点击。非临时缓解。当前前端范围建议验收通过。
