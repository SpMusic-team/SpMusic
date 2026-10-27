---
doc_id: "TEST-2026-10-26-FOLDER-NAVIGATION-MOTION"
title: "文件夹导航投影与圆角独立验收"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "folder-navigation-motion"
created: "2026-10-26"
updated: "2026-10-26"
source_documents:
  - "user request: 所有 folder card/cover 默认圆角统一 20，目录切换复用 playlist management/detail 动效"
  - "src/features/player/components/folderNavigationMotion.browser.test.mjs"
  - "src/features/player/components/folderCardLayouts.browser.test.mjs"
  - "src/features/player/components/folderManagementParity.browser.test.mjs"
  - "src/features/player/components/folderHierarchy.browser.test.mjs"
  - "src/features/player/components/playlistOffscreenReturn.browser.test.mjs"
---

# 测试报告：文件夹导航投影与圆角

## 摘要

最终冻结稿独立验证通过。14 条导航轨迹无失败；80 个文件夹卡片组合的外框、可见封面圆角均为 20px。根管理页对齐、原目录功能回归、共享歌单屏外返回回归、lint 和构建通过。

## 范围

Windows、headless Microsoft Edge 157.0.4341.16、Vite `http://127.0.0.1:5173`。文件夹导航使用真实 PlayerShell、PlayerSurface、hooks、组件和样式；仅替换原生命令/event 传输，输入为确定性文件夹与音频元数据。未启动 Tauri，未重新验收真实磁盘或 Rust 后端。

最终生产写入是 Frontend Agent 对取消导航后封面租约的 presence session 清理；此后完整 14 条导航轨迹再次执行通过。Test Agent 只修改测试文件和本报告。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent `/root/folder_transition_frontend`；Architecture Agent 提供边界复核。
- 修改范围：FolderHierarchyPanel/Card、共用 CollectionHero、歌单与目录共用 entry projection/detail presence hooks、chrome route 边界、cover store 租约和目录样式。
- 复现基线：复核前任保存在 `C:/Users/winkeses/.codex/tmp/folder-navigation-baseline/report.json` 的旧版四方向数据。旧版封面/名称中间几何帧均为 0、sameCoverUrl=false、只有单页直接替换。此次没有回退工作区重建旧生产源码。
- 已知证据与待验证假设：keyed scene 的 presence 重叠应产生封面与名称连续几何变化；相同目录 key 与 cache key 应保留同 decoded URL。
- 实现者主张的因果链：整个目录内容原位替换、缺少共享投影身份 → 新旧封面没有共同投影生命周期 → 封面直接跳变；将目录变为 keyed scene、接入歌单共用投影与 presence → 两页有限重叠并共享封面/名称。
- 证据缺口：没有真实 Tauri/WebView2 原生运行、真实文件 artwork 或音频输出证据；这些没有被计入通过范围。

## 命令

以下命令均在 `D:/SpMusic` 执行；Vite 5173 接手时已经在运行，未另启实例。

- `node src/features/player/components/folderNavigationMotion.browser.test.mjs`：最终冻结稿 14 traces、0 failures；修复前独立运行确实发现 reduced 旧页残留与 rapid lease 残留。
- `node src/features/player/components/folderCardLayouts.browser.test.mjs`：80 cases、0 design mismatches、0 runtime errors。
- `$env:SPMUSIC_TEST_SCREENSHOTS='C:/Users/winkeses/.codex/tmp/folder-management-latest'; node src/features/player/components/folderManagementParity.browser.test.mjs`：通过。
- `$env:SPMUSIC_TEST_SCREENSHOTS='C:/Users/winkeses/.codex/tmp/folder-hierarchy-latest'; node src/features/player/components/folderHierarchy.browser.test.mjs`：通过。将第一帧检查的 observer 从旧 pane 属性变化改为监听 keyed scene 插入；原先仅监听旧节点的运行因永远收不到其预期事件而中断，未扩大超时。
- `node --test src/features/player/model/folderCardLayouts.model.test.mjs src/features/player/model/folderHierarchyModel.test.mjs src/features/player/model/folderNavigationIdentity.test.mjs`：14 tests、14 pass。
- `$env:SPMUSIC_TEST_SCREENSHOTS='C:/Users/winkeses/.codex/tmp/playlist-offscreen-folder-regression'; node src/features/player/components/playlistOffscreenReturn.browser.test.mjs`：第一轮仅 reduced 时间断言失败，133.5ms，大于原 100ms 阈值；当时与 lint/build 并发。第二次以同一脚本串行执行通过，83.6ms。该脚本实际使用 `SPMUSIC_SCREENSHOT_DIR`，所以输出原本在系统 Temp，已复制至下述独立目录。
- `npm run lint`：通过。
- `npm run build`：通过；输出既有 chunk 超过 500kB 提示。
- `git diff --check`：通过。
- `cargo check`：未运行，本次委托明确无需后端 tests。
- `npm run tauri dev`：未运行。

## 人工检查

- 已查看真实 CDP screencast 导出的 640 root→directory 与 1280 parent→child 中间 PNG：封面在屏幕上实际绘制，sidebar/dock 保持独立，存在预期新旧内容交叠。
- 其他用户交互均由浏览器自动化执行；未将原生桌面人工操作列为已完成。

## 根因与因果链反证

- 独立复现或等价基线：旧 JSON 中四方向无投影中间帧，最终数据中 12 条常规轨迹的封面中间帧为 36–74，名称为 35–74。单纯淡入淡出无法满足宽高同时处于 card/hero 两端之间的硬断言。
- presence 首个错误状态：先前 detail 同时由 `exit` 和手动 controls 管理。交付首稿的 nested detail 修复后，640/1280、三层六方向最终均只剩一个 pane。
- reduced 反证：独立两次观察 `/music` 旧 pane inert=true、aria-hidden=true、animations=[]，12 秒仍未移除。实现将同步 set/remove 改为真实零时长 controls 完成回调；同一路径后续通过，未增加 timeout 或定时强删。
- rapid 反证：进入后立即返回复用原 root scene，原 transition key 曾留下一个 `folder:["/music","/music"]` 租约；修正为离场期间拥有 selected lease、presence 重入清除历史 key 后，两种宽度最终 leases 均为空。
- 替代假设：屏外返回中目标 cover 从 360px 缩到 240px，最初“任何中间几何都失败”的断言误判了整页合法入场。Architecture 确认应复用 playlist `detailReturn.incoming` 的 scale1.5→1、x=-75%→0；测试现在采样 parent matrix、offsetWidth/Height 与 cover local transform，剔除共同父级缩放后禁止额外封面投影。常规方向的中间宽高/名称硬断言保持。
- 根因修复而非症状掩盖：通过。没有删除错误状态检查、放宽动画中间帧条件、扩大等待时长或以任意延时清场。

## 跨层契约

- TypeScript / Rust 类型与序列化：真实前端 TypeScript 构建通过；Rust 原生传输未执行。
- command / event 名称、方向和输入输出：使用现有 browser fixture 验证前端解析与消费，不能代表真实原生端到端验收。
- 空值、错误语义、权限与生命周期：目录为空、扫描失败、缺失目录 metadata、清空后迟到 scan/metadata、React unmount 资源释放均覆盖；原生文件权限未覆盖。

## 回归覆盖

- 640/1280：根管理→music→Album→Disc 与逐级返回，12 条常规 CDP/rAF 轨迹。
- 根和 music 父目录均设置非零 scrollTop，返回后同时检查 scrollTop 与卡片 y 恢复。
- 每种宽度三次快速 enter/back，最终单 root pane、leases=[]；再进入 detail 并切全局 overview，目录外壳退出、租约归零；卸载真实 React root 后 cover cache、leases、listeners 均为 0。
- 屏外 hero 位于 y=-860 时返回；目标 cover 只有合法父级入场缩放，没有额外 local projection。
- reduced-motion 进入、返回、最终单 pane、没有残留非 CSS transition 动画。
- root/mixed、640/1280、10 种卡片档位、稀疏/多项共 80 case：所有外框和可见 cover 默认 radius=20px，其余尺寸、字体、glyph、分组与溢出检查不退步。
- 管理页：按钮 geometry、heading、hover、搜索 focus/Escape、无 root compact controller、dock 绑定不发布 detail motion；Ctrl-wheel header/toolbar/blank/card 有效，sidebar/dock/input/dialog 排除，与歌单一致。
- 原目录回归：empty/error/legacy roots、递归汇总去重、混合/叶级只显示直接 songs、搜索/选择/共享布局、播放与返回、展开视图、180 首有界 DOM、跨窗口 Tab/Shift+Tab、hero 640/1920/2560 宽度、触摸 hold overscroll、屏外 compact focus 交接、text 模式 hero cover、迟到扫描/metadata。
- 共享歌单回归：1280/480 屏外整页入场、每宽度三次 rapid reentry、missing target、屏外→部分可见恢复共享 artwork、返回 player、reduced；cover/name local x/y 最大均为 0。

## 性能 / 时序

- 场景与采样口径：每条导航采样 800ms 的 requestAnimationFrame DOM 几何，另以 CDP screencast 捕获真实 PNG 绘制帧。DOM 中间帧数与 CDP 帧数分别记录，没有混称。
- 修复前基线：旧版四方向 cover/title 中间几何帧为 0，decoded URL 不同。
- 修复后结果：14 条轨迹各有 25–53 个真实 CDP 帧；12 条常规路径 cover36–74/title35–74 个中间几何帧。全部 sameCoverUrl=true、revokedVisible=0，最多 2 pane，结束 1 pane。
- 重复、取消与资源清理：快速取消、相同 key 重入、全局退出、实际 root unmount 均通过。
- 时间阈值风险：歌单 reduced 的原 100ms 绝对时间条件在并发 lint/build 时失败一次，串行 83.6ms 通过。仅能确认存在负载敏感性，不能从单次复跑证明所有高负载环境都满足该绝对时限；未调整阈值或生产逻辑掩盖该信号。

## 发现

- 已退回并复验修复：reduced inert 旧 scene 不移除；快速取消导航保留 selected cover lease。
- 已修正测试模型：合法屏外整页入场不能被判为 cover 拉飞；keyed scene 第一帧需要监听新节点插入而不是等旧 pane 改目录属性。
- 未发现冻结稿违反本轮 folder 验收标准的剩余缺陷。

## 风险

浏览器 fixture 不覆盖真实原生权限、真实磁盘扫描、Tauri WebView2 合成差异或音频输出。没有执行完整全仓 browser suite，也没有添加复杂框架。歌单 reduced 的绝对时间断言具有上述负载敏感性。

## 临时缓解

- 是否为临时缓解：否；本次没有采用定时清场、任意延时或降低正常投影断言。
- 适用边界与未解决风险：本报告仅批准所列浏览器端验收结果，原生运行与高负载绝对时间保证不在已验证范围。
- 撤除条件、跟踪任务和后续 Owner：无新增临时机制需撤除；如要求高负载 100ms SLA，需单独给出受控环境和可重复性能验收输入。

## 验证结论

文件夹默认圆角 20、复用歌单共用动效、三层进退投影与相关前端回归通过。建议主 Agent 以本次冻结稿和列明的原生未覆盖边界完成集成验收。

## 建议

保留以下可复核证据；无需为本次 folder 验收继续修改生产代码。

- 最终动效数据：`C:/Users/winkeses/.codex/tmp/folder-navigation-motion/report.json`。
- 所有轨迹 JSON 与 first/middle/last PNG：`C:/Users/winkeses/.codex/tmp/folder-navigation-motion/`。
- 640 中间帧：`C:/Users/winkeses/.codex/tmp/folder-navigation-motion/640-root-to-directory-middle.png`。
- 1280 中间帧：`C:/Users/winkeses/.codex/tmp/folder-navigation-motion/1280-parent-to-child-middle.png`。
- 旧版基线：`C:/Users/winkeses/.codex/tmp/folder-navigation-baseline/report.json`。
- 圆角与档位证据：`C:/Users/winkeses/.codex/tmp/folder-card-layouts/`。
- 管理页证据：`C:/Users/winkeses/.codex/tmp/folder-management-latest/`。
- 原目录功能/hero 证据：`C:/Users/winkeses/.codex/tmp/folder-hierarchy-latest/`。
- 共享歌单串行回归证据：`C:/Users/winkeses/.codex/tmp/playlist-offscreen-folder-regression-final/`。
