---
doc_id: "IMPL-TRACK-RATING-PERSISTENCE"
title: "歌曲评级与赞踩持久化实现"
doc_type: "implementation"
status: "active"
owner_agent: "Frontend Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "docs/architecture/track-rating-persistence.md"
  - "user request: 完成评级包括赞踩的持久化"
---

# 歌曲评级与赞踩持久化实现

播放器评分表通过 trackRatingStorage 写入 localStorage 的 spmusic.track-ratings.v1，版本化结构为 version:1 与 entries 数组，每项包含 trackId、rating。1～5 分保存，0 分删除已有项并立即保存，因此取消评分、取消喜欢或不喜欢后重启仍保持未评分。喜欢为 5、不喜欢为 1，2～4 分仍保留其星级但不显示拇指标记，均使用同一份数据。

沿用 Rust 基于规范化本地路径或流 URL 生成的稳定 ID；同源文件在分类、播放列表与队列中共享评级，重扫不清除数据，暂时不可用或不在曲库的 ID 保留。重命名或移动产生新身份，不按标题猜测迁移。

Hook 通过 React 状态惰性初始化同步读取存储，之后没有异步加载评分或标签覆盖路径。中央评分修改入口立即更新权威 ref、React 状态及存储；赞踩调用同一入口，连续操作始终读取最新 ref，不在 React updater 或卸载清理中执行写入。

读取遇到不可访问存储、非法 JSON、未知版本或错误顶层结构时回退空评分表；条目逐项校验，空 ID、非整数和超出 1～5 的值忽略，重复 ID 最后一个有效值生效，特殊属性名通过安全自有属性记录。只有用户明确修改时写入，不因启动或重扫自动覆盖存储。

写入失败保留会话内最新值，并通过现有 toast 提示评分保存失败、仅本次会话保留；同一提示 ID 避免连续评分堆叠。后续显式修改再次尝试保存完整最新表。未新增 Rust 命令、依赖、权限、标签写回或评级导出功能。

Frontend 自检 build 通过，存储异常与跨重启交互由 Test Agent 独立验证。
