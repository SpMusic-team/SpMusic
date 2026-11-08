---
doc_id: "ARCH-RATED-PLAYBACK-CANCELLATION"
title: "评级来源播放中取消当前评分的切歌契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "user request: 最高和最低评级播放中取消当前评级后切下一首，全部取消后回退默认文件夹首曲"
  - "docs/architecture/track-rating-persistence.md"
  - "src/features/player/hooks/useAudioPlayer.ts"
  - "src/features/player/components/PlayerShell.tsx"
  - "src/features/player/components/PlayerSurface.tsx"
---

# 评级来源播放中取消当前评分的切歌契约

## 触发与顺序

用户明确把当前曲目的已有评分改为 0，且实际播放快照来源为 `highest-rated` 或 `lowest-rated` 时，持久化取消评分并安排切换。以真实播放来源判断，不以正在浏览的媒体库页面判断。非当前曲目、原本为 0、普通播放来源及修改为其他非零值均不触发。本契约明确替代此前“所有评分修改均不改变运行快照”在这一特定取消行为上的限制。

取取消前按当前模式派生的页面歌曲序列，从当前曲目之后寻找仍符合条件且可播放的歌曲；到尾部则回绕首个剩余曲目。新建评级播放快照仅包含剩余合格成员。没有剩余可播放歌曲时，采用媒体库默认文件夹顺序中首个有可播放歌曲的已选文件夹，按默认歌曲顺序选择首曲，不另加排序设置。无可播放文件夹歌曲时保留取消评分结果并明确处理空库，不制造目标或请求已不存在的曲目。

## 责任边界与竞态

`PlayerSurface` 持有现有评分模式，作为本次评分动作上下文传给 `PlayerShell` 回调；不复制状态或读取另一份偏好。Shell 持有实时评级集合、文件夹数据，负责纯目标计划；`useAudioPlayer` 继续负责评分状态与保存、真实传输状态、来源快照及命令执行。允许扩展现有回调的可选模式参数，避免被动 effect 在启动、扫描或模式切换后误触发切歌。

先以取消前顺序和动作捕获身份计算计划，再提交统一评分更新；保存失败仍沿用已有内存更新及错误提示。执行前核对实际来源、当前曲目、generation 和选择序号，避免旧层事件或新的手动选曲被过时切换覆盖。命令发出后沿用既有 selectionRequestId、generation 和 transport intent 保护，旧响应不得激活新来源。连点不能重复向后跨过多首。若开始时正在播放，新目标继续播放；暂停时加载新目标保持暂停。

普通 `selectPlaybackQueueTrack` 当前硬编码 autoplay 和 queue 视觉来源，需用显式取消评分选项扩展或专用受保护入口；不调用依赖旧快照的普通 next。必须保留源描述验证、不可用歌曲处理、既有请求取消和错误语义。

## 视觉边界

此次切换不使用普通 queue/next 的卡片翻入动效，视觉以用户视频确认结果为准。变化应显式绑定此次选择动作，不能全局关闭曲目切换动效。现有 `loadPlaylistTrackOrSkip` 的视觉来源为可选参数，`beginTrackSelection` 的序号可隔离旧 intent；实现仍需验证 artwork 层就绪及资源清理，不能只隐藏 CSS 动画而遗留过渡会话。其他上一首、下一首、滑动、列表选曲保持原行为。

## 取舍与验收

以动作驱动计划优于监听评级集合的 effect：后者会把启动恢复、模式变化、异步标签完成误认为取消动作。计划在 Shell、执行在 hook，避免把 UI 模式和集合模型塞入音频引擎；通过显式上下文传递而不增建全局状态。仅复用既有命令与本地存储，无依赖、权限或 Rust 边界扩展。

Frontend Agent 拥有实现；Test Agent 独立验证。Architecture Agent 仅写本文，保留其他 Agent 的变更。

- 高/低评级当前曲目取消后从页面消失，按上述顺序切换，尾部可回绕。
- 最高评级分别覆盖五星与赞踩模式；新快照不再包含已取消成员。
- 最后一个合格歌曲取消时回退默认文件夹首个可播放曲目；没有候选时无无效请求。
- 播放和暂停状态分别保持；普通来源、非当前曲目、非零修改及恢复/模式变化无自动切换。
- 快速取消、手动选曲竞态、加载失败或不可用目标无旧请求覆盖；评分保存失败仍有既有反馈。
- 此次切换没有翻入动画，其他导航动效和音频选择保护不回归。
