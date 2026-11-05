---
doc_id: "IMPL-MOST-PLAYED-LIBRARY"
title: "最常播放页面实现"
doc_type: "implementation"
status: "active"
owner_agent: "Frontend Agent"
version_scope: "project"
created: "2026-11-05"
updated: "2026-11-05"
source_documents:
  - "docs/architecture/most-played-library.md"
  - "docs/architecture/poweramp-recents-views.md"
  - "Figma V4Gbm9HJrUOsTiwXl2XcXV 9226:10916"
---

# 最常播放页面实现

页面复用现有歌曲列表、虚拟化、封面、搜索、选择、布局切换、播放控制器和页面动效，不显示字母索引和手动排序。每行元数据右侧显示累计播放次数，使用现有主题主色。分类图标复用仓库中设计稿的 c95de.svg，封面及曲目信息来自真实曲库。

最常统计与最近播放共享 RecentlyPlayedTracker 达到累计实听 50% 的提交点，每轮只加一次。独立存储键 spmusic.most-played.v1 保存规范化路径、累计次数和最近达标时间。旧最近记录不补造次数；写失败保留会话数据，且两个记录的写失败互不阻断。

默认全部历史、100 首、次数降序。100 是 SpMusic 首版策略，Poweramp 默认条数尚未取证。先按次数选前 N 首，再按指定方向显示，标题和路径作为稳定次级排序。列表选项允许修改条数、最近达标播放时间下限和次数方向；时间下限严格排除恰好相等的记录，次数仍为累计值。查看全部取消条数和时间限制；清空需确认，只清最常统计。

播放来源支持 most-played，保留现有播放快照、重启恢复、来源返回和封面预热链路。筛选、排序、清空及计数更新不会重建当前播放快照。

验证由 npm run build、npm run lint 与 Test Agent 独立模型及浏览器测试共同完成。真实硬件输出沿用既有音频能力，本轮不修改 Rust、依赖或权限。
