---
doc_id: "TEST-RATED-PLAYBACK-CANCELLATION"
title: "评级来源播放中取消评级独立验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "user request: 最高／最低评级播放中取消当前评级后自动换曲，空列表回到默认文件夹歌曲，不翻入新封面"
  - "docs/architecture/rated-playback-cancellation.md"
  - "src/features/player/components/ratedPlaybackCancellationAcceptance.browser.test.mjs"
---

# 测试报告：评级来源取消当前评级

## 摘要与范围

新增独立浏览器验收 10 个场景通过，最高／最低评级和持久化既有完整回归通过。仅对实际最高／最低来源正在播放的当前歌曲显式从非零改为 0 触发自动选择；普通来源、非当前歌曲和非零分值变化继续保留原行为。

## 实现交付与证据完整性

实现 Owner：Frontend Agent；架构约定见来源文档。主 Agent 核对用户视频，本测试不把其他 Agent 的视频判断作为独立实机证据。独立测试实际点击真实播放器喜欢／不喜欢按钮或五星键盘 Delete；仅原生传输为夹具。

实现链：中央评级回调识别显式取消与实际播放来源 → 保存 0 → 依据取消前有序页面取后续／回绕，或默认文件夹回退 → 重建队列并选择，保留播放状态 → 不创建翻入视觉意图，清理旧预览。旧异步选择通过序列和请求守卫防止覆盖新选择。

## 命令

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
node src/features/player/components/ratedPlaybackCancellationAcceptance.browser.test.mjs
node src/features/player/components/highestRatedAcceptance.browser.test.mjs
node src/features/player/components/ratingPersistenceAcceptance.browser.test.mjs
```

三条最终均退出码 0，无 pageerror。主 Agent 另执行 build／lint／diff 检查；本报告不将其记作独立重复执行。未运行 cargo check／tauri dev，本轮无 Rust 修改。

## 回归覆盖

1. 最高评级中间歌曲取消喜欢，进入取消前页面顺序中的下一首；保持 playing，队列排除已取消歌曲。
2. 最高评级最后歌曲取消，回绕第一首剩余歌曲。
3. 最高评级最后一首取消，回退选中音乐文件夹的默认第一首 a；保持 playing，队列切为文件夹歌曲集合。
4. 最低评级暂停时取消不喜欢，进入剩余下一首并保持非播放状态。
5. 最低评级清空后回退默认第一首 a，继续保持暂停。
6. 普通所有歌曲来源取消当前喜欢，当前曲目不自动切换。
7. 评级来源取消非当前歌曲，当前曲目不自动切换。
8. 五星模式在真实控件按 Delete 清为 0，按评分页面顺序进入下一首。
9. 当前评分从 5 改为 1，即使退出最高评级成员，也不触发仅属于显式 0 的自动切换。
10. 暂扣取消后下一首的原生选择响应，再从所有歌曲手动选择 other，释放旧响应后仍为 other，队列仍为后来的手动来源。

既有最高评级测试仅更新“显式取消最低当前曲目且页面清空”预期，模式切换和非零评级变化保留快照断言。持久化测试补充从最高当前取消喜欢后的默认来源回退断言；评分取消本身仍经重载验证为 0。没有通过删除原有非相关断言掩盖回归。

## 无翻入动画的独立证据

使用 no-preference（非 reduced-motion）执行。对首次中间取消在 requestAnimationFrame 中记录 600ms 的卡片 phase、computed transform、内容 opacity，同时记录真实 Surface 的选择视觉意图。结果：

- 新目标没有 selectionVisualIntent。
- 所有采样卡片 transform 均为 none，无旋转／位移翻入。
- 可短暂存在 incoming 资源准备层，但其内容 opacity 始终为 0；待资源完成后直接变为 active。
- 最终不存在 incoming／outgoing 临时层。

JSON 证据：`C:/Users/winkeses/AppData/Local/Temp/spmusic-rated-cancellation-evidence/cancellation-visual-trace.json`。最初用“任何 incoming phase 都失败”的断言误把既有隐藏资源缓冲当作动画；核对 useArtworkVisualResource 的两帧准备与 Surface 动画 role 后，改为验证实际变换、可见性、视觉意图和清理，未关闭动效或放宽可见翻转要求。

## 根因与因果链反证

只改徽标或派生列表不会自动换曲，本测试断言实际播放器 track 和队列。无条件自动换曲会破坏普通来源、非当前变化和非零变化，三个反例均保持当前曲目。仅取消视觉意图但仍触发默认翻入，会被逐帧 transform／opacity 捕获；本轮未出现。未守卫的晚到请求会覆写后来的手动 other，延迟响应场景排除此故障。

## 跨层与时序

无新增原生命令或权限；复用既有加载／播放路径。playing 与 paused 两种状态实际验证；异步旧响应释放后观察 600ms 确认新选择仍拥有队列。预期原生响应由夹具控制，不将其推广为硬件音频时序保证。

## 风险与验证结论

未验证真实桌面硬件、多个默认文件夹名称排序的实机结果、所有文件均不可播放时的回退结果；同一选中根及可用歌曲的默认首曲已实际验证。未声明性能改进，无性能基准。非临时缓解，本轮前端合同验收通过，无剩余阻塞问题。
