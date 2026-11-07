---
doc_id: "TEST-BLANK-CONTENT-ZOOM"
title: "列表内容留白缩放与流控制器验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - "user request: 列表项之外空白区域不能缩放，修复它"
  - "user request: 播放控制器移除流标记，流进度仅显示底轨"
  - "src/features/player/hooks/useCollectionLayout.ts"
  - "src/features/player/components/blankContentZoom.browser.test.mjs"
  - "src/features/player/components/playlistPinch.browser.test.mjs"
---

# 测试报告：列表内容留白缩放与流控制器

## 摘要

独立复现了三种歌曲视图尾部留白的双指缩放失败，并在修后验证布局缩放成功且不再触发浏览器原生页面缩放。真实 Ctrl-wheel 与无物理 Ctrl 键的 trackpad ctrlWheel 在修前已经正常，修后保持正常。流控制器的标记移除、底轨保留、填充与圆点隐藏以及本地歌曲切换验证通过。

## 范围

生产 PlayerShell、PlayerSurface、歌曲卡片、控制器与 CSS；只替换原生音频/媒体库边界。Edge 158.0.4370.1 无头浏览器，真实 CDP touch/mouse 输入。隔离 Vite 端口 5177、缓存位于 TEMP，未修改用户的 5173 服务。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent。
- 修改范围：歌曲视图使用现有 panel 手势范围，保护 grid 外真实控件；控制器使用当前歌曲的 stream 身份决定进度标记可见性。
- 复现基线：完整。修前分别命中 streams、全部歌曲、播放列表的真实 panel 留白 `(320,765)`，不是向 grid 人工 dispatch。
- 主张的因果链：touch 范围默认 grid → 留白双指事件被拒绝 → 原生页面 pinch → 列表档位不变。修后复验与预测一致。
- 证据缺口：没有物理触屏/触控板或打包 Tauri WebView 实机操作记录。

## 命令

环境变量（PowerShell）：

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_ORIGIN='http://127.0.0.1:5177'
```

- `$env:SPMUSIC_ZOOM_BASELINE='1'; node src/features/player/components/blankContentZoom.browser.test.mjs`：修前证据收集完成；6 项 wheel 正常、3 项双指失败，收集模式不把这些失败判为通过。
- 清除 baseline 变量后 `node src/features/player/components/blankContentZoom.browser.test.mjs`：修后 9 项输入矩阵及静态标题留白、按钮、输入、空搜索结果、列间空白、dock 检查通过。
- `node src/features/player/components/playlistPinch.browser.test.mjs`：14/14 通过。
- `$env:SPMUSIC_TEST_DOCK_ONLY='1'; node src/features/player/components/blankContentZoom.browser.test.mjs`：流 → 本地 → 流 → 未知时长本地专项通过，9.05 秒完成。
- 清除 dockOnly 变量后 `$env:SPMUSIC_TEST_ZOOM_DETAILS_ONLY='1'; node src/features/player/components/blankContentZoom.browser.test.mjs`：静态标题留白、真实按钮/input、空结果、列间空白、sidebar、quick-index、dock 保护及控制器专项通过，无 pageerror；1280px 视口底轨 `1182×6px`。
- 最后一次组合重跑曾在 `page.reload` 达到原有 30000ms 导航超时，未见 pageerror；该进程已退出。未扩大超时或改业务以绕过，随后单独执行 dock 专项通过。
- `npm run lint`、`npm run build`：由主 Agent 最终集成执行；本报告不把转述计为独立执行。
- `cargo check`、`npm run tauri dev`：未运行，本次无 Rust/command/event 改动。

## 人工检查

没有物理设备人工检查；浏览器验收使用坐标命中和 trusted CDP 输入，非合成 grid 事件替代留白路径。

## 根因与因果链反证

修前三个 panel 的 Ctrl-wheel、trackpad 都使档位 `8→9`，反证了“所有缩放输入都因 panel 尺寸失效”的假设。双指 spread 修前档位仍为 8，`visualViewport.scale=1.6`；修后同坐标同输入为 `8→7`，页面 scale 为 1。无需扩大 touch-action 或改变共享默认值即可消除首个范围拒绝状态，属于根因修复。

## 跨层契约

TypeScript/Rust 类型序列化、command/event、权限不适用：修复没有修改这些边界。原生 mock 只用于提供确定数据，不能作为网络流真实播放验收。

## 回归覆盖

- streams、全部歌曲、播放列表：panel 尾部留白分别执行真实 Ctrl-wheel、无物理 Ctrl 的 trackpad、双指 spread。
- 静态标题区域留白、列间 grid 空隙允许缩放；真实 header 按钮、search input、sidebar、quick-index 和底播放栏保护；空搜索结果留白允许缩放。
- 普通 wheel 滚动、单指 pan、十档上下边界、动画/焦点/节点保留、持久化、一手势只变一档、长 burst/反向、cancel、第三指、换指、离开 panel、reduced motion、卸载清理均由旧 pinch 套件覆盖。
- 卡片仍能普通点击选择歌曲；流卡片音符与“流”文字保留，计算样式符合 inverse-primary。
- 控制器无音符加“流”标记，URL 保留。stream range/thumb 为 hidden，底轨始终 visible；本地 60 秒与未知时长本地 0 秒的 range/thumb 均 visible，证明没有把未知时长等同于 stream。

## 性能 / 时序

复用既有 150ms 步进锁与 350ms trackpad idle 判据，没有扩大等待或测试超时。旧套件验证一个长手势只产生一次档位变化，卸载后 wheel/touchstart/touchmove/touchend/touchcancel 五类监听全部移除，动画归零。

控制器专项在 640px 视口实测：底轨始终 `542×6px`，圆点始终保留 `19×19px` 布局几何，仅按当前 stream 身份改变绘制可见性；流与本地切换不改变底轨宽高。

## 发现

未发现修复后产品缺陷。旧 pinch 的“静态标题留白不得缩放”断言与新需求相反，已换为实际 header 按钮负例，其余行为断言保留。依赖解析增加 TEMP Vite `/@fs/.../deps/` 路径兼容。

## 风险

未单独验证完全零注册数据、虚拟窗极大占位高度、弹窗内双指与物理设备。已覆盖没有可见卡片的空搜索结果；这些未覆盖项不应被报告成已验收。

## 临时缓解

不是临时缓解；没有隐藏错误、放宽手势阈值或禁用原有交互。

## 验证结论

已执行的原始复现、相邻交互与控制器专项通过；可交主 Agent 集成验收。物理输入设备与打包 WebView 仍需按上述路径人工抽查，不能据此宣称完成真实网络流播放验证。

## 建议

主 Agent 保留既有大范围未提交工作，仅整合本次限定修复与测试。
