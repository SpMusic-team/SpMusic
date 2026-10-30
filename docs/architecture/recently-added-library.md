---
doc_id: "ARCH-RECENTLY-ADDED-LIBRARY"
title: "最近添加分类与文件创建时间契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-10-30"
updated: "2026-10-30"
source_documents:
  - "user request: 最近添加仅内容不同，复用现有样式实现"
  - "docs/architecture/poweramp-recents-views.md"
  - "docs/architecture/recently-played-library.md"
  - "src-tauri/src/audio/playlist.rs"
---

# 最近添加分类与文件创建时间契约

## 范围与审查

Architecture Agent 审查确定扫描描述符方案后遇到运行用量限制，由主 Agent 按其契约完成实现与验证。最近添加沿用现有 `recent-added` 分类，不增加时间窗口、条数设置、依赖、权限、数据库或 command。

复用所有歌曲与最近播放的歌曲列表、虚拟化、封面加载、布局、选择、播放控制器和动效；不显示字母索引，不允许拖动改变时间顺序。搜索操作沿用当前项目的共享入口。

## 数据来源

`AudioFolderTrackRef.file_created_at_ms: Option<u64>` 序列化为 `fileCreatedAtMs: number | null`。TypeScript 字段可省略以兼容旧会话。递归扫描复用现有 `symlink_metadata`，不增加全库标签或解码操作。导入/恢复描述符同样读取创建时间。

时间仅来自文件系统 `Metadata.created()`，转换为 Unix 毫秒并限制在 JavaScript 安全整数范围。读取失败、不支持或早于 Unix epoch 时返回 null；不得回退为修改时间、首次扫描时间或当前时间。

前端在当前所有歌曲去重集合上派生最近添加列表，按有效创建时间倒序，同时间按规范化路径稳定排序。未知时间排末尾，不丢弃歌曲。不修改所有歌曲原数组或手动排序。重新扫描可刷新创建时间，重启后按文件系统重新构建。

## 播放来源

`PlaybackQueueOrigin.kind` 增加 `recent-added`，与 `recent-played`、`all-songs` 一样不携带 sourceScope/sourcePlaylist。点击或随机播放建立本次有序歌曲快照，标题为“最近添加”。列表变化不能自动修改正在运行的队列。

会话校验、启动恢复和从播放器返回媒体库保留该来源身份；已有旧来源保持兼容。当前库外歌曲、未选中文件夹和外部歌单不会加入该派生集合。

## 验证边界

Rust 验证真实扫描创建时间、序列化、恢复以及缺失文件。前端验证时间排序、未知值、共享列表/控制器、无索引、播放快照、随机范围和刷新恢复。浏览器 native transport 使用替身，真实音频设备端到端不在本轮已验证范围。
