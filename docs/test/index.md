---
doc_id: "INDEX-TEST"
title: "测试记录索引"
doc_type: "index"
status: "active"
owner_agent: "lead"
version_scope: "project"
created: "2026-11-20"
updated: "2026-11-20"
source_documents:
  - "docs/README.md"
---

# 测试记录索引

73 篇。验证报告、性能基线与验收记录；结论要能追溯到具体命令与数据。

## 按能力分类（34）

- [媒体库年份双路径独立验证](./year-library.md) · `TEST-YEAR-LIBRARY` · active
- [歌曲评级持久化独立验证](./track-rating-persistence.md) · `TEST-TRACK-RATING-PERSISTENCE` · active
- [流根页面与网络播放独立验证](./streams-library.md) · `TEST-STREAMS-LIBRARY` · active
- [流完整播放界面与封面拖动验收](./stream-player-fixes.md) · `TEST-STREAM-PLAYER-FIXES-2026-11-07` · active
- [流视图信息与电台名称独立验证](./stream-display-information.md) · `TEST-STREAM-DISPLAY-INFORMATION` · active
- [流播放控制器作者信息验收](./stream-author.md) · `TEST-STREAM-AUTHOR-2026-11-07` · active
- [添加流地址弹窗设计验收](./stream-address-dialog.md) · `TEST-STREAM-ADDRESS-DIALOG-2026-11-07` · active
- [全局歌曲评级徽标独立验证](./song-rating-display.md) · `TEST-SONG-RATING-DISPLAY` · active
- [拖动/滚动媒体库歌曲列表的分段耗时实测（2026-11-02）](./scroll-load-performance-2026-11-02.md) · `PERF-SCROLL-001` · done
- [最近播放分类独立验证](./recently-played-library.md) · `TEST-RECENTLY-PLAYED-LIBRARY` · active
- [最近添加分类验证记录](./recently-added-library.md) · `TEST-RECENTLY-ADDED-LIBRARY` · active
- [评级来源播放中取消评级独立验证](./rated-playback-cancellation.md) · `TEST-RATED-PLAYBACK-CANCELLATION` · active
- [媒体库队列独立验证](./queue-library-verification.md) · `TEST-QUEUE-LIBRARY` · active
- [测试报告：全业务插件宿主设计可验证性审查](./plugin-host-design-review.md) · `TEST-PLUGIN-HOST-DESIGN-REVIEW` · done
- [播放列表视图切换卡顿验证](./playlist-view-transition-stutter.md) · `TEST-PLAYLIST-VIEW-TRANSITION-STUTTER` · in-review
- [列表管理进入播放列表的头图转场验证](./playlist-management-playback-transition.md) · `TEST-PLAYLIST-MANAGEMENT-PLAYBACK-TRANSITION` · in-review
- [搜索页添加歌曲后「播放列表歌曲列表变慢」— 静态加载链路分析](./playlist-add-load-path-analysis.md) · `TEST-PLAYLIST-ADD-LOAD-PATH-ANALYSIS` · done
- [播放界面五星评分与视频手势验证](./player-rating.md) · `TEST-PLAYER-RATING` · active
- [快速拖动切歌的封面内存诊断与优化验证方案](./opt-0017-rapid-cover-switch-memory-test-plan.md) · `TEST-OPT-0017-RAPID-COVER-SWITCH-MEMORY-PLAN` · ready
- [测试报告：OPT-0002 歌词缓存与显式内嵌歌词边界](./opt-0002-lyrics-cache-verification.md) · `TEST-OPT-0002-LYRICS-CACHE` · active
- [最常播放分类独立验证](./most-played-library.md) · `TEST-MOST-PLAYED-LIBRARY` · active
- [长分类独立验证](./long-tracks-library.md) · `TEST-LONG-TRACKS-LIBRARY` · active
- [媒体库列表加载速度基线（2026-11-02，当前版本）](./list-load-performance-baseline-2026-11-02.md) · `PERF-BASELINE-001` · done
- [最高评级页面独立验证](./highest-rated-library.md) · `TEST-HIGHEST-RATED-LIBRARY` · active
- [头图清晰度 · DS 工具能力实测记录](./hero-cover-sharpness-ds-capabilities.md) · `TEST-HERO-COVER-SHARPNESS-DS-CAPABILITIES` · draft
- [媒体库流派双路径独立验证](./genre-library.md) · `TEST-GENRE-LIBRARY` · active
- [流派根与专辑概览页留白复核](./genre-collection-insets.md) · `TEST-GENRE-COLLECTION-INSETS` · active
- [文件夹导航投影与圆角独立验收](./folder-navigation-motion-verification.md) · `TEST-2026-10-26-FOLDER-NAVIGATION-MOTION` · active
- [自定义全局快捷键独立验证](./custom-global-shortcuts.md) · `TEST-CUSTOM-GLOBAL-SHORTCUTS` · in-review
- [封面缓存测试隔离验证](./cover-cache-test-isolation.md) · `TEST-2026-10-29-COVER-CACHE-ISOLATION` · done
- [流派与年份歌曲页左右边距回归验证](./category-song-insets.md) · `TEST-CATEGORY-SONG-INSETS` · active
- [BUG-0018 封面转场重入独立验证](./bug-0018-cover-reentry.md) · `TEST-BUG-0018-COVER-REENTRY` · in-review
- [列表内容留白缩放与流控制器验证](./blank-content-zoom.md) · `TEST-BLANK-CONTENT-ZOOM` · active
- [媒体库艺术家分类独立验证](./artist-library.md) · `TEST-ARTIST-LIBRARY` · active

## sp-022 系列（7）

- [测试报告：停滚后的可见封面加载](./sp-022-visible-cover-latency.md) · `TEST-SP-022-VISIBLE-COVER-LATENCY` · in-review
- [测试报告：缩略图基线与三阶段优化对照](./sp-022-thumbnail-optimization-comparison.md) · `TEST-SP-022-THUMBNAIL-OPTIMIZATION-COMPARISON` · in-review
- [测试报告：播放列表性能基线可行性与解码代理测量](./sp-022-playlist-performance-baseline.md) · `TEST-SP-022-BASELINE` · in-review
- [播放列表封面后端有界并发测试计划](./sp-022-backend-cover-concurrency-test-plan.md) · `TEST-SP-022-BACKEND-COVER-CONCURRENCY-PLAN` · draft
- [测试报告：后端封面并发候选安全合同独立验证](./sp-022-backend-cover-concurrency-safety-verification.md) · `TEST-SP-022-BACKEND-COVER-CONCURRENCY-SAFETY` · in-review
- [测试报告：后端有界并发 A/B 代理测量（A=N1 / B=N2）](./sp-022-backend-cover-concurrency-p2-ab-report.md) · `TEST-SP-022-BACKEND-COVER-CONCURRENCY-P2` · in-review
- [测试报告：后端有界并发测试计划闸门复核与 A0 复跑](./sp-022-backend-cover-concurrency-gate-review.md) · `TEST-SP-022-BACKEND-COVER-CONCURRENCY-GATE` · in-review

## opt-0018 系列（25）

- [OPT-0018 v2 收尾验收与封面加载性能实验方案](./opt-0018-v2-closeout-and-performance-plan.md) · `TEST-OPT-0018-V2-CLOSEOUT-PERFORMANCE` · draft
- [OPT-0018 阶段拆分（修订版，候选 3847bcc）](./opt-0018-stage-analysis-2026-11-08.md) · `TEST-OPT-0018-STAGE-ANALYSIS-2026-11-08` · done
- [OPT-0018 自适应封面并发正式对照](./opt-0018-r1-formal-ab-2026-11-10.md) · `TEST-OPT-0018-R1-FORMAL-AB-2026-11-10` · in-review
- [第三轮封面优化 · DS 工具能力实测记录](./opt-0018-post-r1-ds-capabilities.md) · `TEST-OPT-0018-POST-R1-DS-CAPABILITIES` · draft
- [全链路诊断：首次到达的每一段耗时（基线 3847bcc，带埋点构建）](./opt-0018-pipeline-diagnosis-2026-11-09.md) · `TEST-OPT-0018-PIPELINE-DIAGNOSIS-2026-11-09` · done
- [OPT-0018 P1 修复验证报告（候选 3847bcc）](./opt-0018-p1-fix-verification-2026-11-08.md) · `TEST-OPT-0018-P1-FIX-VERIFICATION-2026-11-08` · done
- [多点往返拖动：整段与逐站测量（基线 3847bcc vs 候选）](./opt-0018-multistop-drag-2026-11-09.md) · `TEST-OPT-0018-MULTISTOP-DRAG-2026-11-09` · done
- [作业级全链路诊断（细分版）：缓存命中 / 源图解码 / 缩放 / 编码](./opt-0018-job-diagnosis-v2-2026-11-09.md) · `TEST-OPT-0018-JOB-DIAGNOSIS-V2-2026-11-09` · done
- [作业级全链路诊断：请求发出 / 后端返回 / 预解码（基线 3847bcc）](./opt-0018-job-diagnosis-2026-11-09.md) · `TEST-OPT-0018-JOB-DIAGNOSIS-2026-11-09` · done
- [OPT-0018 列表封面路径通道独立验证报告](./opt-0018-independent-verification-2026-11-08.md) · `TEST-OPT-0018-INDEPENDENT-2026-11-08` · done
- [全屏滚动条拖动测试结果（候选 3847bcc）](./opt-0018-fullscreen-drag-2026-11-09.md) · `TEST-OPT-0018-FULLSCREEN-DRAG-2026-11-09` · done
- [OPT-0018 场景 B「首次打开来源」测试结果（候选 3847bcc）](./opt-0018-first-open-result-2026-11-08.md) · `TEST-OPT-0018-FIRST-OPEN-RESULT-2026-11-08` · done
- [场景 B「首次打开来源」正式测试协议（预登记）](./opt-0018-first-open-protocol-2026-11-08.md) · `TEST-OPT-0018-FIRST-OPEN-PROTOCOL-2026-11-08` · done
- [首次到达诊断（修订版）：全屏小卡片档位，基线 3847bcc](./opt-0018-first-arrival-diagnosis-2026-11-09.md) · `TEST-OPT-0018-FIRST-ARRIVAL-DIAGNOSIS-2026-11-09` · done
- [OPT-0018 给 ds 的分阶段测试验证操作手册](./opt-0018-ds-verification-runbook.md) · `TEST-OPT-0018-DS-VERIFICATION-RUNBOOK` · draft
- [OPT-0018 ds 本轮验证报告](./opt-0018-ds-verification-report-2026-11-08.md) · `TEST-OPT-0018-DS-VERIFICATION-REPORT-2026-11-08` · done
- [真实滚动条拖动测试：3 对试跑验证报告](./opt-0018-drag-pilot-2026-11-08.md) · `TEST-OPT-0018-DRAG-PILOT-2026-11-08` · done
- [OPT-0018 拖动内存第二轮诊断报告](./opt-0018-drag-memory-r2-diag-2026-11-18.md) · `TASK-OPT-0018-DRAG-MEMORY-R2-DIAG` · in-review
- [OPT-0018 拖动内存第一轮执行与测试报告](./opt-0018-drag-memory-r1-2026-11-17.md) · `TEST-OPT-0018-DRAG-MEMORY-R1` · in-review
- [OPT-0018 连续拖动内存对照](./opt-0018-drag-memory-observation-2026-11-15.md) · `TEST-OPT-0018-DRAG-MEMORY-2026-11-15` · in-review
- [OPT-0018 列表封面正式拖动 A/B](./opt-0018-drag-formal-ab-2026-11-15.md) · `TEST-OPT-0018-DRAG-FORMAL-2026-11-15` · done
- [真实滚动条拖动测试结果（候选 3847bcc）](./opt-0018-drag-formal-2026-11-08.md) · `TEST-OPT-0018-DRAG-FORMAL-2026-11-08` · done
- [磁盘缓存跨重启验证：命中、复用与重新生成](./opt-0018-disk-cache-persistence-2026-11-09.md) · `TEST-OPT-0018-DISK-CACHE-PERSISTENCE-2026-11-09` · done
- [owner 并发实验：并发 2 vs 3 vs 4（基线 3847bcc）](./opt-0018-concurrency-experiment-2026-11-09.md) · `TEST-OPT-0018-CONCURRENCY-EXPERIMENT-2026-11-09` · done
- [A/B 正式比较：旧像素版 vs 路径版（多点往返拖动，20 对）](./opt-0018-ab-multistop-formal-2026-11-09.md) · `TEST-OPT-0018-AB-MULTISTOP-FORMAL-2026-11-09` · done

## 2026-11（2）

- [Poweramp 逆向研究资料整体体检报告](./2026-11-17-poweramp-reverse-engineering-corpus-audit.md) · `TEST-POWERAMP-RE-CORPUS-AUDIT` · done
- [播放期内存增长根因诊断与优化建议](./2026-11-10-player-memory-growth-diagnosis.md) · `TEST-2026-11-10-PLAYER-MEMORY` · done

## 2026-10（5）

- [专辑艺术家与作曲家分类独立验证](./2026-10-29-contributor-library.md) · `TEST-2026-10-29-CONTRIBUTOR-LIBRARY` · active
- [平铺文件夹分类与分类根索引验证](./2026-10-28-flat-folders.md) · `TEST-2026-10-28-FLAT-FOLDERS` · active
- [专辑分类与共享快速索引独立验证](./2026-10-28-album-library.md) · `TEST-2026-10-28-ALBUM-LIBRARY` · active
- [测试记录：所有歌曲封面请求尺寸与加载速度](./2026-10-23-all-songs-cover-size-observation.md) · `TEST-2026-10-23-ALL-SONGS-COVER-SIZE-OBSERVATION` · active
- [测试报告：跨播放来源点歌的列表封面白屏闪烁](./2026-10-21-playlist-source-switch-artwork.md) · `TEST-PLAYLIST-SOURCE-SWITCH-ARTWORK` · in-review

