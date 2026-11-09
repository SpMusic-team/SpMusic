---
doc_id: "TEST-QUEUE-LIBRARY"
title: "媒体库队列独立验证"
doc_type: "test"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "user request: 实现队列页面与选择项加入队列"
  - "docs/architecture/queue-library.md"
  - "src/features/player/components/queueLibrary.browser.test.mjs"
  - "src/features/player/model/libraryQueue.model.test.mjs"
---

# 测试报告：媒体库队列

## 摘要

以用户最新确认的“保留队列记录、已播数/总数、手动清空”为验收标准。此前自动消费 ended 条目的断言已撤回并替换；不再把自动移除视为正确行为。测试挂载真实 PlayerShell，仅在既有 audioCommands 原生边界返回可控 fixture。

## 范围

空/非空页面、总数分母、播放与结束保留记录、重复条目导航、手动清空及持久化、集合展开、队列图标范围。viewport 640×1440、1280×1440。

## 实现交付与证据完整性

- Owner：Frontend Agent；生产代码仅 src，无新增 Rust 命令/权限。
- 基线：原代码的 ended 消费和剩余数量口径不符合用户最终要求。本轮更新测试按最终产品规则断言，未为了通过测试修改要求。
- 因果链：选择集合展开歌曲 → hook 校验并持久化独立条目 → 成功 playing 标记已播 → ended 保留 → 页面使用已播数/条目总数；只有手动清空动作提交空数组。
- 边界：浏览器证明真实前端状态与 UI 接线；不证明真实 Tauri 音频设备输出。

## 命令

工作目录 D:/spmusic。SPMUSIC_PLAYWRIGHT 指向 C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright，SPMUSIC_TEST_ORIGIN 默认 http://127.0.0.1:5173，SPMUSIC_TEST_SCREENSHOTS=D:/spmusic-evidence/queue。

- node --test src/features/player/model/libraryQueue.model.test.mjs src/features/player/model/folderSelection.model.test.mjs src/features/player/model/contributorLibrary.model.test.mjs：17/17，通过。
- node src/features/player/components/queueLibrary.browser.test.mjs：640 与 SPMUSIC_TEST_WIDTH=1280 两轮均退出 0，输出 QUEUE_PASS，pageerror 和 consoleErrors 均为空。两轮均包含存储写失败注入、真实菜单清空、集合入队及十档图标断言。
- npx eslint src/features/player/components/queueLibrary.browser.test.mjs src/features/player/model/libraryQueue.model.test.mjs：退出 0。
- npm run build / npm run lint：主 Agent 最终重新运行并确认两项退出 0（2026-11-08）；本 Test Agent 未重复运行仓库级检查。
- cargo check / npm run tauri dev：未运行，无 Rust 变更。

## 人工检查

截图位于 D:/spmusic-evidence/queue：queue-empty、queue-populated、queue-level-0、queue-level-4、queue-all-played、queue-manually-cleared（各带 viewport 宽度后缀）。卡片网格截图无队列标记；队列列表每个未播项只有一枚标记。640 标题计数与更多按钮中心均 x=573，1280 均 x=1213。可访问树中队列页面无搜索按钮；旧 inert 页面搜索 DOM 不属于当前操作界面。

## 根因与因果链反证

早期图标片段使隐藏布局槽泄露，三首出现九个 mark；wrapper 修复后每首一枚。作曲家 selectionEnabled 白名单遗漏造成选中后没有操作面板；补齐后 UI 入队完整成员通过。这两项修复保留。

本轮用户纠正产品规则：ended 自动消费属于错误行为，已撤销；成功标记、结束和重复 ended 都必须保持原条目 ID 与总分母。测试明确比较完整 ID 数组，防止仅显示旧数字掩盖实际删除。

## 跨层契约

entryId 与真实 trackId 分离。加载序列 A→B→C→A→A 保留重复 occurrence，传原真实路径给既有 audio_load_and_play。清空操作不调用文件删除或 audio_stop，当前音频不被重新加载，之后下一首和自然结束不加载旧快照。持久化写入失败必须保留原状态。

## 回归覆盖

- 单次同路径去重，跨操作重复入队，轻量持久化与损坏恢复：模型通过。
- 重复标记幂等且保持所有 ID/总数：新增模型通过；无自动完成删除测试。
- 空显示“空”，3条显示0/3，4条显示0/4；首曲成功后2/4而不是2/2：浏览器断言。
- 暂停与恢复保持2/4；播放中新增同曲后2/5；结束自动播放下一首变3/5，全部ID仍在；旧/重复 ended 不减少记录。
- 连续自然结束后5/5且所有5条保持；重启仍5/5；重新播放已播曲目不额外计数。
- 更多菜单真实“清空队列”：持久化空数组，页面显示空，重启仍空；不删源，不停当前音频，后续导航不加载旧条目。
- 注入队列 localStorage 写失败时手动清空失败：原5/5和持久条目保留，恢复写入后相同菜单动作成功。
- 加载失败保持0/1，重启保持。
- 专辑 Mixed 完整 mixed-a/b/c（含跨目录成员）；作曲家 Composer 完整3成员；文件夹根 /music 完整子层级歌曲：真实 UI 选择入队验证。
- 十档布局：队列根页0～2网格无标记，3～9列表有标记；所有歌曲页无标记。
- 普通来源播放中新加入同曲，结束后仍保留条目。

## 性能 / 时序

无性能提升主张。使用可控旧 generation ended 与重复 ended 验证幂等；未穷举原生命令同时在途乱序完成。现有生命周期守卫由代码审查佐证，本轮不将其作为完整设备验收。

## 发现

本轮未发现阻塞本次前端交付的问题。上一轮作曲家集合验证出现 fixture 不一致：summary 含 composer 而 hydrate 缺失，已核对当前 fixture 两端均返回同一原始 composer，未改生产代码、未放宽集合成员断言。本轮两个视口均完整通过该路径。

2026-11-08 重新启动独立 Vite server（npm run dev -- --host 127.0.0.1 --port 5173），重新执行上述模型、浏览器及测试文件 lint 命令。模型 17/17；640 的计数中心与更多图标中心均为 573，1280 均为 1213。两轮加载路径均为 A→B→C→A→A，结束后完整 ID 数组与 5/5 均保留。已目视核对本轮 queue-all-played-1280.png 与 queue-manually-cleared-640.png，分别显示保留条目和清空后页面。

## 风险

真实 Tauri 音频输出、全部十档完整视觉几何、每个次要入口单独手工操作未覆盖。十档图标范围已有自动断言。本报告不能用于声明全产品发布通过。

## 临时缓解

无。

## 验证结论

通过本次前端验证：队列记录播放后保留、计数为已播数/队列总数、更多菜单手动清空与失败保留、重启恢复、集合展开、列表限定图标及重复条目导航均有独立执行证据。真实 Tauri 音频设备与未穷举的在途原生命令乱序仍按风险节记录，不据此声明全产品发布通过。

## 建议

主 Agent 已确认仓库级 build/lint 通过，可完成最终交付；无待修生产缺陷。
