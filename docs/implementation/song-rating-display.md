---
doc_id: "IMPL-SONG-RATING-DISPLAY"
title: "全局歌曲项目评级展示"
doc_type: "implementation"
status: "active"
owner_agent: "Frontend Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "docs/architecture/song-rating-display.md"
  - "docs/implementation/track-rating-persistence.md"
  - "user request: 所有歌曲项目显示评级，最常播放保留次数，集合项目不显示评级"
---

# 全局歌曲项目评级展示

PlayerSurface 将当前评分模式与已恢复的评分表通过只读 SongRatingContext 提供给歌曲项目。PlaylistCard 按真实曲目 ID 读取评级，覆盖普通文件及自建播放列表、全部歌曲、最近播放、最近添加、长、最高和最低评级、流、文件夹内歌曲、专辑及艺术家/专辑艺术家/作曲家/年份/流派的歌曲视图、搜索歌曲及能够映射到当前曲库歌曲的书签。QueuePanel 的独立歌曲行也使用相同的 SongRatingBadge 组件。集合卡使用原有独立组件，不读取该上下文，因此文件夹、专辑、艺术家等集合项目不产生评级徽标。

非零评级在五星模式显示对应数量实心星，在赞踩模式只有 5 分显示喜欢、1 分显示不喜欢。0 分及赞踩模式的 2～4 分在生成布局属性、辅助说明和徽标节点之前归一化为空，不挂载空徽标、不声明有额外信息、不改变原有项目布局。最常播放显式 hideRating，不受评分或次数缺失影响，继续保留累计次数；显式播放次数也优先于评级。

复用此前确定的三档星形与拇指尺寸及主题颜色；列表、封面和紧凑视图分别复用现有额外信息位置。流歌曲保留 URL 与来源标签，评级放在来源行的右侧，封面/紧凑模式使用原有封面或标题附加信息槽位。队列只对具有可见评级的行扩展一列，无评级行沿用原有结构与样式。

上下文值按评分表与模式记忆化；评级修改或模式切换更新已挂载歌曲项目，其他播放器状态更新不更换该上下文。没有增加评分写入入口、存储、依赖、导航或播放队列行为。

构建与基础检查由 Frontend 执行，全局共享渲染器、集合例外及无评分布局由 Test Agent 独立验证。
