---
doc_id: "ARCH-TRACK-RATING-PERSISTENCE"
title: "曲目评分与赞踩持久化契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "user request: 持久化完整评分系统，包括赞踩"
  - "src/features/player/model/trackRating.ts"
  - "src/features/player/hooks/useAudioPlayer.ts"
  - "src-tauri/src/audio/source.rs"
  - "src-tauri/src/audio/network.rs"
---

# 曲目评分与赞踩持久化契约

## 决策与边界

沿用前端 localStorage，持久化现有统一的 0～5 整数评分。喜欢为 5、不喜欢为 1、取消为 0；五星与赞踩消费同一份状态，切换模式不改写评分。`trackRating.ts` 承担存储校验和读写，`useAudioPlayer` 持有唯一评分状态并处理修改，组件和评级集合只读取现有 `ratingsByTrackId`。无需 Rust、Tauri 命令、权限、文件标签写入或新增依赖。

## 身份与数据契约

使用现有 `trackId`，无需另建路径到评分的可变映射。`audio/source.rs::track_id` 已按 canonicalize 后的小写本地路径计算 BLAKE3 身份；网络流按 `network.rs::canonical_url` 规范化 URL，再由 `stream_id` 计算身份。相同来源跨播放列表、扫描、正常重启和重新导入沿用该身份。

存储键为 `spmusic.track-ratings.v1`，格式为：

```ts
type StoredTrackRatings = {
  version: 1
  entries: Array<{ trackId: string; rating: 1 | 2 | 3 | 4 | 5 }>
}
```

评分为 0 时删除该条目，缺失条目读取为 0。读取拒绝错误版本、非对象根值、非数组 entries；坏整体回退空集合。逐条校验非空白字符串身份及整数 1～5，跳过坏项；重复身份最后一个有效条目生效。安全构造自有属性映射，避免特殊对象键影响原型。评分 getter/setter 不对外扩展身份算法，也不以标题或专辑名称关联。

暂时缺失歌曲、空库、重新扫描、移除来源及删除文件均不清理孤立评分。原来源恢复并使用相同身份后评分自然恢复。重命名、移动、URL 改变按新身份处理，不猜测迁移。canonicalize 无法解析的失效路径以及符号链接目标变化可能导致身份不同，当前不承诺跨该类身份变化迁移。测试应验证真实身份生成契约，不制造与现有后端不符的任意 ID 更换场景。

## 启动、更新与失败

以同步 lazy initializer 在 `useAudioPlayer` 创建状态时读取一次，早于任何用户操作和异步扫描；不在扫描完成后重放旧评分，避免覆盖新操作。旧版本只有内存评分，无既有持久化键需要迁移。

所有 `setTrackRating` 和 `toggleTrackFeedback` 路径提交同一更新函数。计算下一状态后立即更新权威内存及同步持久化，避免等待卸载、页面关闭或防抖计时器。若使用 ref 处理同一帧的连续操作，ref 与 state 必须同一次提交保持一致。React state updater 和初始化函数不得承担写入、toast 等副作用，避免 StrictMode 重放造成重复效果。

localStorage 读取不可用时回退空集合，正常播放及评分继续可用。写入失败保留当次内存评分，通过现有 `sonner` 错误提示说明评分未保存、当前会话仍生效；不显示成功保存文案，不阻断音频。后续有效操作可再次尝试保存完整当前状态；无需后台重试服务。读写适配函数应有明确的失败返回值或抛错约定，以便 hook 统一处理反馈。

## 集合与播放

最高评级在五星模式收录 2～5，赞踩模式仅收录 5；最低评级始终仅收录 1。列表、控制器播放、随机、选择和搜索共享模式筛选后的集合。持久化恢复后这些集合与封面、更多菜单、当前歌曲的评级同时恢复。修改评分或模式只刷新派生展示，不重建已运行的队列快照。

## 取舍与质量属性

直接持久化现有稳定身份可避免依赖异步标签或来源加载，不增加启动扫描、文件权限和跨层契约。读写成本随已评分曲目线性增长；仅评分提交写入，不随播放轮询或封面刷新写入。localStorage 与项目现有最近播放、最常播放和书签方案一致，仍受 WebView 存储配额及用户清理应用数据影响。

备选为另建规范化路径评分表并将其投影到 trackId，但当前后端已提供路径派生身份，额外映射会引入扫描暂空、标签晚到和双状态覆盖风险。Rust 文件或数据库可支持更大数据与多进程协调，但需新增命令、同步和迁移，当前无必要。未来后端身份算法变更必须单独设计存储迁移，不把此次版本作为跨算法兼容承诺。

## 验收与所有权

Frontend Agent 独占评分模型、hook、实现说明；Test Agent 独立验证并拥有其明确分配的测试文件。Architecture Agent 仅维护本文，不修改实现或其他 Agent 的文件。

- 1～5 全值域跨重载恢复；0 删除后重载保持未评分；赞踩切换和取消正确。
- 两种模式切换保留中间分值，评级页面与播放器显示一致；已建队列不被改写。
- 同来源跨列表、扫描和重导入保持评分；缺失来源期间保留记录，恢复可重现。
- 坏 JSON、错误版本、坏项、重复键及特殊对象键安全处理。
- 启动扫描延迟期间的新评分不会被旧状态覆盖；同一帧连续修改保留最后操作。
- 读写抛错不使播放器崩溃，写失败有明确反馈且内存评分继续可用；恢复存储后的新提交保存当前完整状态。
