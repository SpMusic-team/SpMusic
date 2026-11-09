---
doc_id: "TEST-RECENTLY-PLAYED-LIBRARY"
title: "最近播放分类独立验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-30"
updated: "2026-10-30"
source_documents:
  - "user request: 仿照 Poweramp 实现最近播放，复用所有歌曲列表、控制器、行为、样式和动效，隐藏字母索引"
  - "docs/architecture/recently-played-library.md"
  - "src/features/player/components/recentlyPlayedAcceptance.browser.test.mjs"
  - "src/features/player/model/recentlyPlayedIndependent.test.mjs"
---

# 测试报告：最近播放分类

## 摘要与范围

独立验证覆盖真实 React PlayerShell / PlayerSurface 页面和最近播放纯模型；浏览器用可控原生 transport 替代 Tauri 调用，不模拟页面组件。最近播放 UI、阈值统计、去重排序、当前队列稳定及刷新持久化均有自动化证据。真实桌面原生音频和输出设备未验证。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent；无新增 Rust command、依赖或权限。
- 修改范围：最近播放纯模型、播放状态采样、最近播放队列来源、媒体库派生列表及复用页面分支。
- 新功能基线：最近播放原为空分类。
- 验证中发现重复轮询漏计，已建立修前失败、修后通过的独立反例，未放宽门槛断言。

## 命令

测试依赖既有 Vite 和工作区 bundled Playwright。PowerShell 初始化：

```powershell
npm run dev -- --host 127.0.0.1
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_SCREENSHOTS="$env:TEMP/spmusic-recents-test"
node src/features/player/components/recentlyPlayedAcceptance.browser.test.mjs
node --test src/features/player/model/recentlyPlayedIndependent.test.mjs src/features/player/model/recentlyPlayed.test.mjs src/features/player/model/playbackSessionStorage.test.ts
node src/features/player/components/libraryRootController.browser.test.mjs
node src/features/player/components/playbackSession.browser.test.mjs
```

- 最近播放模型、自测模型及既有 session storage：15 项通过，其中独立新增 8 项。
- 最近播放真实 React 页面：修复漏计后连续两轮通过。
- 媒体库根页控制器既有回归：32 项通过，含所有歌曲固定/移动控制器、搜索/选择、空/短列表、动效关闭及 19 分类切换仅一个 dock。
- 旧 playbackSession browser：第 104 行等待初始 allSongs 超时，尚未进入点击播放。fixture 返回旧 `{folders:[...]}`，实际 `LibraryFolderSettings` 为 `{revision,roots}`，恢复代码访问 `result.roots`。未改旧 fixture，也未把这次失败作为新功能通过证据。
- `npm run lint`、`npm run build`：由主 Agent 负责最终仓库级检查，非本 Agent 重复执行。
- `cargo check`、`npm run tauri dev`：本轮未执行，无 Rust 修改。

## 页面与行为检查

- 空最近播放显示说明、播放按钮禁用、没有字母索引。
- 所有歌曲仍有字母索引；最近播放使用同一个 AllSongsCard，断言 class 和封面圆角相同。
- 最近播放有一个共享 playback dock；歌曲行播放及随机播放只使用最近播放成员。
- 4 秒歌曲实听不足 2 秒不入选；达到门槛入选，同 generation 继续播放只计一次。
- seek 到 3 秒后短暂播放不能假算听过一半；暂停期间推进测试位置也不计时，恢复保留已实听累计。
- 成功 seek 后超过现有 guard 再继续播放可计入，避免 seek 永久禁用统计。
- B 后播放 A 会更新为 A/B，成员不重复；这次列表更新不改变当前 B/A 队列快照。
- 页面刷新后保留最近顺序，随机播放维持最近播放范围。
- 页面脚本错误与 console error 均为空。
- 截图：`C:/Users/winkeses/AppData/Local/Temp/spmusic-recents-test/recently-played-list.png`，1280×900，多曲列表和控制器。

## 根因与因果链反证

修前：同 generation 连续进度事件之间夹同 position 的 poll → 每次重复 poll 都覆盖时间锚点 → 下一次进度只能累计距 poll 的短间隔 → 实听超过一半仍不入选，浏览器复验偶发失败。

独立模型反例在每 100ms 的真实进度前 10ms 插入重复位置，连续 2000ms 应满足 4000ms 歌曲的 50%；修前返回 false，修后返回 true。修复保留重复位置的原时间锚点，暂停/阻塞仍清空基线，故不是扩大时长容差或延迟断言掩盖问题。

替代假设检查：排除已达到门槛后不能更新同一歌曲、generation 未变及单纯页面排序错误；模型测试独立于 React 和页面排序即可重现，定位到时间采样。

## 跨层契约与回归覆盖

沿用现有 AudioPlaybackState，无新 native 协议。独立模型覆盖自然 ended 的最后区间、同 generation 重播、generation 切换、暂停/seek/长挂起、延迟元数据提交、异常存储恢复、路径分隔符归一与新记录去重、媒体库交集及不修改原集合。旧 session storage 的有效/无效/不可用存储 3 项仍通过。

## 性能与时序

不作性能提升声明。时序证据为重复 poll 的修前失败反例、修后模型通过及浏览器连续复验。统计重排不改变播放队列，避免异步更新影响下一首范围。

## 风险与临时缓解

真实 Tauri 音频设备、实际音频播放时长、原生事件发送频率及桌面关闭后恢复未实测；浏览器刷新验证 localStorage 往返，不能等价声称原生端到端全部通过。旧 session browser fixture 落后于既有文件夹契约，留作独立测试维护项。无临时缓解实现。

## 验证结论

本轮最近播放前端实现的适用自动化验收通过；真实原生音频端到端未验证。最终仓库检查和截图视觉复核交主 Agent 整合，不代表发布验收已批准。
