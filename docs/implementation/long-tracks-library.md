---
doc_id: "IMPL-LONG-TRACKS-LIBRARY"
title: "长分类实现说明"
doc_type: "implementation"
status: "active"
owner_agent: "Frontend Agent"
version_scope: "project"
created: "2026-10-30"
updated: "2026-10-30"
source_documents:
  - "user request: 实现媒体库下长分类，完整复用所有歌曲界面，默认15分钟及以上"
  - "docs/architecture/poweramp-recents-views.md"
  - "src/features/player/model/longTracks.ts"
---

# 长分类实现说明

媒体库“长”复用 `PlaylistLibraryPanel` 的歌曲分支，保留所有歌曲的卡片、布局级别、字母索引、动效、选择、播放控制器及控制器上方的按钮。默认按标题顺序，已有手动顺序生效时沿用手动顺序。子集重排将可见成员合并回全库顺序，保留其他歌曲的位置。

成员由已选择文件夹的 `allSongs` 和既有 `durationData.durationsByScope` 派生；时长必须有限且非负，并满足 `durationMs >= minDurationMs`。未知和非法时长不入选；不使用占位行的零秒判断。长分类激活全库标签与时长补齐，复用所有歌曲的等待状态，直到各文件夹的标签 ready、时长任务 settled 才展示结果或空状态。时长任务失败按既有 settled 语义结束，未知项仍不入选。

默认阈值 **15 分钟（900000 毫秒）** 来自本次用户选择，不代表 Poweramp 默认值。通过“更多列表操作 → 列表选项”修改整数分钟。偏好键为 `spmusic.long-tracks.min-duration-ms.v1`，以 JSON 数字记录毫秒；读取接受 0 到 2147483647 的整数，坏值回退默认值，写失败保留当前会话设置。

歌曲行、整页播放、随机播放与选中项播放沿用现有快照队列，来源 `long-tracks`；修改阈值只改变浏览成员，不修改当前播放队列。播放器返回、首次来源恢复及隐藏预加载识别该来源。没有新增 Rust 命令、依赖或权限。

独立验收入口为 `src/features/player/components/longTracksAcceptance.browser.test.mjs` 与 `src/features/player/model/longTracksIndependent.test.mjs`。实现阶段 `npx tsc -b --pretty false` 通过；仓库级 lint/build 由主 Agent 最终检查，实际音频及原生输出设备不由浏览器 transport 测试证明。
