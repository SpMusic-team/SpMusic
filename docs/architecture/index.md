---
doc_id: "INDEX-ARCHITECTURE"
title: "架构文档索引"
doc_type: "index"
status: "active"
owner_agent: "lead"
version_scope: "project"
created: "2026-11-20"
updated: "2026-11-20"
source_documents:
  - "docs/README.md"
---

# 架构文档索引

33 篇。这里记录模块边界、数据契约和跨层约定；改 command / event / 共享类型之前先在这里落记录。

## 当前有效（23）

- [专辑分类的数据、导航与复用契约](./album-library.md) · `ARCH-ALBUM-LIBRARY` · active
- [架构目标：所有业务能力插件化与完整宿主](./all-business-plugin-system.md) · `ARCH-ALL-BUSINESS-PLUGIN-SYSTEM` · active
- [艺术家分类的数据、成员与导航契约](./artist-library.md) · `ARCH-ARTIST-LIBRARY` · active
- [专辑艺术家与作曲家分类的数据及页面复用契约](./contributor-library.md) · `ARCH-CONTRIBUTOR-LIBRARY` · active
- [流派分类双路径与页面复用契约](./genre-library.md) · `ARCH-GENRE-LIBRARY` · active
- [架构说明：歌词缓存与显式内嵌歌词边界](./lyrics-cache-and-embed-boundary.md) · `ARCH-LYRICS-CACHE-EMBED-BOUNDARY` · active
- [媒体库三页面（所有歌曲/文件夹/文件夹层次结构）数据关系与并包关系现状](./media-library-page-relationships.md) · `ARCH-MEDIA-LIBRARY-PAGE-RELATIONSHIPS` · active
- [最常播放分类与累计播放次数契约](./most-played-library.md) · `ARCH-MOST-PLAYED-LIBRARY` · active
- [播放列表封面加载现状与性能优化边界](./playlist-artwork-loading.md) · `ARCH-PLAYLIST-ARTWORK-LOADING` · active
- [播放列表曲目标签摘要批量读取契约](./playlist-track-summaries.md) · `ARCH-PLAYLIST-TRACK-SUMMARIES` · active
- [架构设计：插件宿主与跨端契约](./plugin-host-design.md) · `ARCH-PLUGIN-HOST-DESIGN` · active
- [媒体库队列页面与入队契约](./queue-library.md) · `ARCH-QUEUE-LIBRARY` · active
- [评级来源播放中取消当前评分的切歌契约](./rated-playback-cancellation.md) · `ARCH-RATED-PLAYBACK-CANCELLATION` · active
- [架构说明：v0.1 真实本地播放架构契约](./real-audio-playback.md) · `ARCH-REAL-AUDIO-PLAYBACK` · active
- [最近添加分类与文件创建时间契约](./recently-added-library.md) · `ARCH-RECENTLY-ADDED-LIBRARY` · active
- [最近播放分类与有效播放记录契约](./recently-played-library.md) · `ARCH-RECENTLY-PLAYED-LIBRARY` · active
- [全局歌曲列表评级展示契约](./song-rating-display.md) · `ARCH-SONG-RATING-DISPLAY` · active
- [播放列表封面后端并发候选的安全契约](./sp-022-backend-cover-concurrency-safety.md) · `ARCH-SP-022-BACKEND-COVER-CONCURRENCY-SAFETY` · active
- [播放列表缩略图三阶段优化与测量契约](./sp-022-thumbnail-optimization-baseline.md) · `ARCH-SP-022-THUMBNAIL-OPTIMIZATION-BASELINE` · active
- [流视图信息与电台名称契约](./stream-display-information.md) · `ARCH-STREAM-DISPLAY-INFORMATION` · active
- [流根页面与网络播放最小完整链路](./streams-library.md) · `ARCH-STREAMS-LIBRARY` · active
- [曲目评分与赞踩持久化契约](./track-rating-persistence.md) · `ARCH-TRACK-RATING-PERSISTENCE` · active
- [年份分类双路径与导航契约](./year-library.md) · `ARCH-YEAR-LIBRARY` · active

## 草案中（7）

- [动态播放列表的持久化格式设计（SpMusic 自定）](./dynamic-playlist-format.md) · `ARCH-DYNAMIC-PLAYLIST-FORMAT` · draft
- [列表头图（hero）清晰度实施计划：解除 512 上限与跨通道档位统一](./hero-cover-sharpness-plan.md) · `ARCH-HERO-COVER-SHARPNESS-PLAN` · draft
- [OPT-0018 列表封面路径通道重做实现方案](./opt-0018-reimplementation-plan.md) · `ARCH-OPT-0018-REIMPLEMENTATION` · draft
- [OPT-0018 v2 收尾要求与提速实验方案](./opt-0018-v2-closeout-and-optimization.md) · `ARCH-OPT-0018-V2-CLOSEOUT` · draft
- [OPT-0018 v2 增量纠正执行方案](./opt-0018-v2-correction-execution.md) · `ARCH-OPT-0018-V2-CORRECTION-EXECUTION` · draft
- [播放列表总时长缓存与增量重算契约](./playlist-duration-cache.md) · `ARCH-PLAYLIST-DURATION-CACHE` · draft
- [foobar2000 查询语法与 SpMusic 现状的差距分析](./search-grammar-gap-analysis.md) · `ARCH-SEARCH-GRAMMAR-GAP-ANALYSIS` · draft

## 已作废（3）

- [封面清晰度对比：SpMusic 播放列表头图 vs Poweramp](./cover-sharpness-comparison.md) · `ARCH-COVER-SHARPNESS` · superseded
- [架构说明：总体架构蓝图](./overall-architecture.md) · `ARCH-OVERALL` · superseded
- [播放器状态与假歌曲契约](./player-state-and-fake-track.md) · `ARCH-PLAYER-STATE-FAKE-TRACK` · superseded

## 语料

Poweramp 与 foobar2000 的逆向取证已独立到 [../corpus/index.md](../corpus/index.md)。
