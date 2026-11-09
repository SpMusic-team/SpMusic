---
doc_id: "TEST-LONG-TRACKS-LIBRARY"
title: "长分类独立验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-30"
updated: "2026-10-30"
source_documents:
  - "user request: 实现媒体库长分类，样式动画复用所有歌曲，默认15分钟及以上，保留右侧字母栏与底部控制器和上方按钮"
  - "docs/architecture/poweramp-recents-views.md"
  - "docs/implementation/long-tracks-library.md"
  - "src/features/player/model/longTracksIndependent.test.mjs"
  - "src/features/player/components/longTracksAcceptance.browser.test.mjs"
---

# 测试报告：长分类

## 摘要与范围

独立验证覆盖真实 React PlayerShell / PlayerSurface 与纯模型。浏览器只替换原生 transport，保留页面、时长扫描、导航、列表、控制器及设置组件。默认 15 分钟的包含边界、全库时长完成后发现、共享界面、播放队列快照、设置持久化和子集重排均通过。真实 Tauri 音频设备及原生端到端未验证。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent。无 Rust、依赖和权限修改；沿用既有 duration command 和 localStorage。
- 新功能基线：“长”原为分类占位页。验证以用户确认的 900000ms 默认阈值为准，不将 Poweramp 未取证默认值当作规格。
- 独立测试文件由 Test Agent 编写和执行，不以实现者自测作为通过依据。
- 检查中发现长子集默认字母序与全库原始序不一致会导致重排校验拒绝；已交 Frontend Agent 修正，完成动态复验。修前未保留浏览器失败记录，根因依据为排序次序与 `mergeFilteredSongOrder` 前置条件的静态矛盾。

## 命令与结果

前提：主 Agent 已启动 `npm run dev -- --host 127.0.0.1`，地址为 `http://127.0.0.1:5173`。

```powershell
node --test src/features/player/model/longTracksIndependent.test.mjs
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_SCREENSHOTS="$env:TEMP/spmusic-long-test"
node src/features/player/components/longTracksAcceptance.browser.test.mjs
```

- 纯模型：3 项通过，覆盖多组边界。
- 新增真实 React 浏览器验收：通过。
- `npm run lint`、`npm run build`：主 Agent 执行最终仓库检查，本 Agent 不重复执行。
- `cargo check`、`npm run tauri dev`：本轮未执行，无 Rust 修改。

## 页面与交互检查

- fixture 有 105 首，其中一个未选中的根目录歌曲；已选库实际为 104 首。全库包含 899999 / 900000 / 900001ms、未知时长，以及扫描序末尾的 30 分钟歌曲。
- duration gate 未放行时没有假设曲目已满足阈值。直接进入“长”，不先访问“所有歌曲”；放行后发现四首，末尾歌曲也能出现，证明结果不只来自可见项补水。
- 右侧字母索引、唯一底部播放控制器、播放与随机按钮存在；与所有歌曲的 card class 和封面圆角一致。截图为 1280×900。
- 点击行播放只包含四首长歌曲；改为 30 分钟后页面变为两首，当前队列快照保持不变；再次随机播放只包含新阈值的两首。
- “更多列表操作 → 列表选项”显示“最小时长（分钟）”；输入 -1 无法保存；取消返回更多菜单，可退出。
- 改为 120 分钟后列表为空，播放按钮禁用；恢复 15 分钟后重新出现四首；页面刷新仍恢复保存的阈值。
- 从“长”点击搜索沿用既有聚合搜索，输入 tail 后可以播放该匹配歌曲。聚合搜索的全库范围沿用所有歌曲入口原有行为。
- 返回“长”仍保持分类；选择模式 Alt+ArrowDown 重排成功。保存的全库顺序有全部 104 个不重复路径，非长歌曲保留在默认全库字母序的原位置，长子集显示交换后的顺序。
- 页面脚本错误和 console error 均为空。

截图：

- `C:/Users/winkeses/AppData/Local/Temp/spmusic-long-test/long-tracks-list.png`
- `C:/Users/winkeses/AppData/Local/Temp/spmusic-long-test/long-tracks-empty.png`

## 纯模型与失败分支

默认 900000ms 包含恰好相等项；未知值、NaN、Infinity、负值不入选。阈值 0 仍排除未知值，合法的 0ms 可以入选。不读取占位 row 的伪时长；同一路径在不同 scope 的时长证据不会互相污染。保持输入顺序和对象身份，不改变冻结输入。

偏好测试覆盖缺失、空串、坏 JSON、字符串数字、对象、null、负数、小数及超出 int32 上限；非法值回退到 15 分钟。0、默认值和上限可往返；非法写入不覆盖旧值；存储不可访问时读写不会使页面崩溃。

## 根因与因果链反证

重排问题的因果链为：长页面按字母排序 → draft 以显示序为 expectedKeys → 全库按扫描序筛出长子集时顺序不同 → `mergeFilteredSongOrder` 拒绝提交。替代假设“只是重排按钮未激活”由真实键盘选择与保存结果排除。修正让无手动排序时的完整基线同样按字母排序，之后使用原有子集槽位合并；动态测试确认完整保存、显示交换以及非长位置保留，没有放宽 permutation 校验。

## 跨层契约、时序与回归

沿用 `audio_probe_playlist_durations` 毫秒值以及按 scope/path 的时长 map；未知曲目保持排除。浏览器用 duration gate 检查迟到时长；当前播放使用既有队列快照，不随阈值派生集合变化。模型独立验证 scope 隔离和异常输入。未新增 native command、事件或权限。

本次未作性能提升声明；未测大规模真实库、真实 I/O 失败、WebView2 帧率及原生设备。没有临时缓解实现。共享布局与动画通过组件复用及实际页面验证；所有主题、窗口宽度和动画参数组合未穷举。

## 验证结论

长分类的本轮前端功能验收通过。最终仓库检查由主 Agent 汇总；真实原生音频端到端不在本次已验证证据范围内。
