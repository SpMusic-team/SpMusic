---
doc_id: "TEST-MOST-PLAYED-LIBRARY"
title: "最常播放分类独立验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-05"
updated: "2026-11-05"
source_documents:
  - "user request: 按 Poweramp 文档及 Figma 9226:10916 完成最常播放页面"
  - "docs/architecture/most-played-library.md"
  - "src/features/player/model/mostPlayedIndependent.test.mjs"
  - "src/features/player/components/mostPlayedAcceptance.browser.test.mjs"
---

# 测试报告：最常播放

## 摘要与范围

最常播放前端适用自动化验收通过。独立验证包含纯模型、存储与播放来源快照校验，以及真实 React PlayerShell / PlayerSurface 浏览器交互；浏览器仅替换原生服务，未替换页面组件。真实 Tauri 音频设备端到端未验证。

## 实现交付与证据完整性

实现 Owner 为 Frontend Agent，修改统计模型、已接受音频状态达标提交、页面列表和菜单、播放来源及次数样式。新功能基线为原分类占位；计数复用既有累计实听 50% tracker，不从旧最近播放补造次数。架构明确默认 100 首属于本项目策略。

## 命令

```powershell
npm run dev -- --host 127.0.0.1
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-evidence/most-played'
node src/features/player/components/mostPlayedAcceptance.browser.test.mjs
node --test src/features/player/model/mostPlayedIndependent.test.mjs src/features/player/model/recentlyPlayedIndependent.test.mjs src/features/player/model/recentlyPlayed.test.mjs src/features/player/model/playbackSessionStorage.test.ts
```

- 独立模型及既有相邻回归：21 项通过，新增最常播放 6 项。
- 浏览器：首轮核心统计与交互通过；发现次数显示遗漏后加断言重跑，最终完整一轮通过。
- `npm run build`、`npm run lint`：主 Agent 独立执行均 exit 0，本 Agent 未重复执行。
- `cargo check`、`npm run tauri dev`：未运行，无 Rust 改动。

## 页面与人工检查

空态播放按钮禁用；实听不足 50% 无记录、达到门槛新增一次、同轮继续不加、第二轮再加；seek 跳跃不算实听。列表按次数展示；两首歌的次数 DOM 与右侧可视文本确认。无字母索引，共享歌曲封面圆角、播放控制器、行播放与随机播放。播放统计更新不替换当前快照。

菜单可打开最常播放列表选项，保存条数 2 与升序，并在刷新后保留。清空需要确认，清空后列表为空、当前播放快照与最近播放记录保持；清空时尚未计数的当前轮次仍可达标一次。

截图 `D:/spmusic-evidence/most-played/most-played-list.png` 与 `most-played-empty.png`，1280×900。视觉复核确认紫色频繁播放图标、标题、控制器、歌曲信息及元信息右侧次数；歌曲封面为夹具空封面，真实动态封面未作设计素材替换。与设计的窄窗口尺寸和四首真实封面不同，复用项目现有响应式布局。

## 根因与因果链反证

首轮截图未显示次数，尽管统计模型和队列均正确。Frontend 确认 CRLF 字符串替换遗漏次数 JSX；补入 span 后新增 `.playlist-card-play-count` 文本为 2 的断言通过，截图显示 2/1。这区分了“统计未写入”与“展示未接入”两个假设，没有放宽次数断言。

## 跨层契约与回归覆盖

无新增 Rust 类型、command、event、权限。独立模型确认：Top-N 先降序选定成员再按方向显示；时间边界严格大于，累计次数保持；同次数按标题和路径稳定决胜；路径归一和重复歌曲只展示一次；坏存储忽略、重复统计保留较新记录而非相加、次数安全整数饱和；极大时间窗口与无效条数回退默认；选项写失败不抛错。最常播放来源通过 origin 校验，禁止附带 sourceScope；含该来源的保存会话可往返序列化。

既有 tracker 回归覆盖 ended 尾区间、重播、暂停、seek、generation、长挂起、延迟元数据及重复轮询；既有最近播放存储和会话存储回归通过。浏览器刷新验证计数、条数和方向耐久性。真实进程重启后的来源页面返回仅核对实现分支及会话模型，未做原生桌面重启。

## 性能与时序

不声明性能改善。时序覆盖同轮重复事件、第二轮增加、seek 排除，以及统计重排和清空不改变已启动播放快照。没有增加独立进度计时器或新后端协议。

## 发现、风险与临时缓解

次数显示遗漏已修复并复验。无尚未解决的适用自动化阻塞；未覆盖真实音频输出、系统关闭、跨窗口并发 localStorage 写入。写失败的双统计隔离仅代码核对，未执行浏览器 quota 注入。无临时缓解实现。

## 验证结论与建议

本轮前端自动化验收通过，可交主 Agent 整合；不等同真实 Tauri 音频端到端或发布验收。新增测试未修改既有测试，未编辑生产代码。

## 次数位置与配色补充验证

按后续修正独立重跑同一浏览器命令，完整验收 exit 0。新增检查通过：

- 非 tile 次数的 `getComputedStyle(...).color` 与用 `var(--player-inverse-primary)` 解析的实际颜色相等。
- 通过真实 Ctrl+滚轮分别切换 level 0、1、2 三种 tile；每个封面只有一个右上次数徽标可见，底部元信息没有可见重复次数。
- 三种 tile 进入选择模式后，徽标与左上选择框顶部对齐，左右边距对称（误差小于 1px），两个矩形不相交，徽标位于封面内右半区。
- 切回列表后继续原有播放、选项、清空及刷新断言全部通过。

新增截图 `D:/spmusic-evidence/most-played/most-played-tile-0-selection.png`、`most-played-tile-1-selection.png`、`most-played-tile-2-selection.png`；已视觉查看 level 0、2，右上次数和左上选择框位置正确。list 截图已更新为 inverse-primary 颜色。

首次补充运行因旧 `.playlist-card-play-count` locator 同时命中新增隐藏封面文本与列表文本而严格模式失败；修改测试选择明确列表元信息位置，并以 `:visible` 判断 tile 底部重复。这是测试选择器适配，不是放宽几何或配色要求。

## 小封面与详细文本两行右栏补充验证

按用户后续修正，再次执行同一浏览器命令，完整流程 exit 0。测试夹具为 Song a 增加超长标题与艺术家，确认两者实际 `scrollWidth > clientWidth`，避免短文本假通过。

新增几何断言覆盖 level 5 小封面 row 和 level 6 详细无封面 text，各自普通与选择状态：次数单独位于标题行右侧，时长格式位于艺术家行右侧；上下两项右对齐，中心分别与标题/艺术家行相差小于 2px；长文本盒不侵入对应右栏且使用 ellipsis；底部格式区没有可见重复次数；选择状态的 text 右栏位于复选框左侧。右栏不超出卡片。

本轮同时保留 level 0/1/2 tile 的位置、选择框不重叠和 `badge.width >= 29px` 断言，均通过。level 7–9 维持原单行极简布局，不属于此次两行右栏修改。

截图新增 `D:/spmusic-evidence/most-played/most-played-compact-5-long-text.png`、`most-played-compact-5-selection-long-text.png`、`most-played-compact-6-long-text.png`、`most-played-compact-6-selection-long-text.png`。已视觉查看 level 5 普通及 level 6 选择截图，确认次数上、格式下，以及长文本省略和右侧选择框避让。