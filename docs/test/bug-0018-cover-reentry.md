---
doc_id: "TEST-BUG-0018-COVER-REENTRY"
title: "BUG-0018 封面转场重入独立验证"
doc_type: "test-report"
status: "第二轮机制及有限原生样本通过 / 完整体验验收待定"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-11"
updated: "2026-10-11"
source_documents:
  - "docs/changes/bugs/BUG-0018.md"
  - "docs/changes/bugs/BUG-0017.md"
  - "src/features/player/components/PlayerSurface.tsx (20722d6 与工作树修复)"
  - "src/features/player/components/coverTransition.browser.test.mjs"
  - "src/features/player/hooks/useArtworkVisualResource.ts"
  - "src/features/player/hooks/useAudioPlayer.ts"
  - "user request: 先比对版本，定位 Surface 拖动切歌封面重入，记录后尝试修复"
  - "user feedback: 第一轮修复后仍重入，快速拖动更易，新封面到位后从侧面再入场"
  - ".codex/bug0018-native-live.json (2026-10-11 原生诊断，783 帧)"
  - ".codex/bug0018-native-after.json (2026-10-11 修复后原生诊断，1777 帧)"
---

# 测试报告：BUG-0018 封面转场重入独立验证

## 摘要

用户实测第一轮修复后仍重入，第一轮通过结果只覆盖当时建立的定向竞态，不足以解释或验收实际问题。第二轮原生轨迹确认了不同的首个错误：同一选择、同一资源身份的 incoming 被新 layer 替换，令拖动会话丢失并重播。新受控回归及 Surface 原生 12 次快速单次手势未再发现该错误；无间隔连续压力与正常桌机仍待验。以下第一轮结果保留为历史，当前结论见末尾第二轮记录。

独立浏览器测试重建了两条失败路径：已完成拖动在资源晋升前遇到依赖刷新，以及相同窗口超过 800 ms watchdog；旧实现均出现进度从 1 归零并完整重播，修复后相同输入不再重播。此结论适用于已验证的 React / Motion / 资源层生命周期，Surface 原生 WebView2 的自然异常频率及另一台正常设备尚待体验复测。

## 范围

- 基线：Git `20722d6` 的 `PlayerSurface.tsx`；修复：同一工作树中 Frontend Agent 的单文件修改。
- 主机：当前 Surface；用户报告 Surface Pro 10 商业版、Ultra 7、16 GB、Windows 缩放 200%。硬件与版本比对以 BUG-0018 的主协调记录为准。
- 实际自动化：现有 Playwright 启动已安装 Edge Chromium `156.0.4314.8`，headless，`1400 × 900` CSS px，分别 `deviceScaleFactor=1/2`；这是 DPR 对照，不等同切换系统缩放，也不是原生 Tauri WebView2。
- 真实 `PlayerSurface`、`CoverPanel`、`ArtworkCanvas`、`useArtworkVisualResource` 与 Motion 路径，使用六张本地生成的 SVG data URL，真实 Image 解码及 Canvas 绘制。selection / commit 边界由本地夹具提供，不启动真实音频或 Rust。
- 在浏览器路由提供的内存模块中，只延迟 incoming 的双 rAF 绘制屏障，记录 progress、session、slots、commit、ready 与退出调用。Motion 正常 tick；不改磁盘生产代码、不模拟资源层 phase。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent。
- 修改范围：`PlayerSurface.tsx` 的已接受 preview 会话所有权、配对检查、方向校验和 watchdog。
- 复现基线：完整等价竞态基线；原生用户异常画面及自然复现统计未取得。
- 已知证据：progress 接近 `0.96` 时 settle 约 45 ms 即可完成；资源晋升依赖绘制屏障。资源 hook 的退出函数只处理 `exiting`，对仍 `active` 的旧卡退出尝试无效。
- 实现者主张：拖动提交 → settle 先完成且释放动画 owner → 依赖刷新或 watchdog 误清待晋升 pair → progress 归零 → 迟到晋升创建 automatic 转场 → 同封面再次入场。
- 证据缺口：未直接采集原生 WebView2 帧轨迹，未做真实音频/磁盘资源/桌机联调、CPU 节流或异常频率统计。

## 命令

独立执行：

```powershell
npm run dev -- --host 127.0.0.1
$env:SPMUSIC_PLAYWRIGHT='C:\Users\winkeses\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
node src/features/player/components/coverTransition.browser.test.mjs
node --check src/features/player/components/coverTransition.browser.test.mjs
git diff --check -- src/features/player/components/coverTransition.browser.test.mjs
```

- Vite：启动成功，`127.0.0.1:5173`，未安装依赖。
- 浏览器脚本：最终默认完整 before / after 及相邻回归运行退出 0，输出 `COVER_TRANSITION_PASS`。可通过 `SPMUSIC_COVER_BASELINE_ONLY=1`、`SPMUSIC_COVER_AFTER_ONLY=1` 单独运行两侧；`SPMUSIC_COVER_TRACE=1` 输出原始时间线。
- `node --check` 与指定文件 `git diff --check`：退出 0。
- 最终 `git diff --check`：退出 0。
- `npm run lint`：主协调独立执行，报告退出 0；本 Agent 未重复全仓检查。
- `npm run build`：主协调独立执行，报告退出 0；本 Agent 未重复全仓检查。
- `cargo check` / `npm run tauri dev`：本 Agent 未运行；本次未修改 Rust / Tauri 边界。

搭建夹具时曾因“automatic 发布等于重播”的过强判断、单位变换的字符串形式及 CRLF 匹配触发测试失败，已根据原始时间线改为判定真实二次进度推进、DOMMatrix 单位矩阵及规范化内存换行。首次 selection 取消用例在新状态尚未提交时释放指针，后改为等待实际新 track 的 slots 再释放，以验证已生效选择的取消契约；未改产品断言或放宽缺陷失败条件。

## 人工检查

- Surface 原生程序在 200% 缩放自然拖动切歌：未验证。
- i7-12700KF + 4060 Ti 正常设备：未验证。
- 真实鼠标事件由 Playwright 发送；不把自动化鼠标检查记为人工体验验收。

## 根因与因果链反证

修复前具体时间线（DPR 1，一次定向运行，毫秒为页面 `performance.now()`）：

| 事件 | 时间 |
| --- | ---: |
| preview 提交 | 3506.2 |
| progress 达到 1 | 3555.5 |
| 对仍 active 的旧卡尝试退出 | 3555.7 |
| session 清空 / progress 归零 | 3630.9 / 3631.0 |
| 延迟绘制屏障 ready | 3745.9 |
| 旧卡 exiting / 新卡 active | 3777.7 |
| 发布 automatic `selection:1` | 3777.9 |
| 新一轮 progress 从 0.0067 推进至 1 | 3806.7–4117.8 |

- 独立等价基线：旧实现使用相同真实资源层，DPR 1 / 2 均能触发。
- 反证“仅慢帧必然重播”：180 ms 延迟但无中间刷新时，两种 DPR 均不重播；automatic session 此时仅改名并立即退出，不能以 session 名称变化当作重播信号。
- 中间事件：提交后 90 / 135 ms 复制同值 selection intent，改变 effect 依赖、保留请求值；旧实现待晋升 pair 因误判清空，新实现保留完成姿态。
- 替代假设：相同失败在 DPR 1 / 2 都出现，且使用稳定 track ID、单一图片 URL、相同 layer ID，无音频后端和网络请求。因此高 DPR、资源身份反复变化或音频回退不是这条失败链的必要条件；不能据此排除原生场景的其他异常。
- 根因修复：精确记录已接受 token 与 pair，并在 selection / 方向 / request / layer 匹配期间保留所有权；没有取消动画、增加产品固定等待时间或吞掉失败。800 ms 兜底只晋升同一张已在 preview 阶段绘制的资源，不适用于任意未就绪 incoming。

## 跨层契约

- TypeScript / Rust 类型与序列化：未修改；本次动态测试不覆盖 Rust 序列化。
- command / event 名称、方向和输入输出：未修改；夹具只提供既有 `onPrepareTrackPreview` / `onCommitTrackPreview` 边界。
- 生命周期：独立验证 accepted pair 随新选择失效、拒绝提交走回滚、Escape 取消、卸载清理。只读核对真实 `useAudioPlayer.commitTrackCardPreview` 仍检查 token / origin / playlist scope / target availability，再同步接受。

## 回归覆盖

- 原始路径：高进度拖动，专用 180 ms 屏障 + 中间刷新；DPR 1 / 2 旧实现失败，新实现无归零重播。
- 对照：相同屏障无刷新，旧新均不重播。
- watchdog：1000 ms 屏障无主动刷新，旧实现重播；最终完整运行新实现在 DPR 1 / 2 分别于提交后 `882.6 / 890.6 ms` 退出 pair（旧实现 `1448.7 / 1458.1 ms`），迟到屏障回调被清理，唯一正确 active 保持单位变换，无 incoming / exiting。
- 相邻路径：同向、反向、重复已完成拖动；拒绝 commit；低进度回滚；Escape；新选择取消 live gesture；卸载；待晋升 accepted pair 被新选择取代并隔离旧 watchdog；系统 reduced motion。
- 每项同时检查无浏览器 pageerror、最终唯一正确歌曲、没有残留 incoming / exiting，且 active 变换为单位矩阵。新选择分支检查旧手势没有提交。
- 未覆盖：连续手势在未完成 settle 时高速重叠、触屏/触笔、丢 pointerup / capture、真实菜单/歌单开关、真实文件解码失败与音频错误、长期资源池总量；本次串行多次手势不能替代 BUG-0017 全部压力回归。

## 性能 / 时序

相同浏览器、夹具、输入、DPR、采样实现对比旧模块与修复模块，定向观察事件顺序，不声称测得整机性能改善。

| 屏障 / 中间刷新 | DPR | 旧实现 pending 归零 / 二次动画 | 修复后 pending 归零 / 二次动画 |
| --- | --- | --- | --- |
| 180 ms / 无 | 1、2 | 0 / 0 | 0 / 0 |
| 180 ms / 有 | 1、2 | 1 / 1 | 0 / 0 |
| 1000 ms / 无 | 1、2 | 1 / 1 | 0 / 0 |

每项每种 DPR 一次最终对照，不是异常率估计。progress 日志携带当时资源 slots：只把完成后仍存在 active + incoming / preview 的归零判为失败；角色移除后的正常归零合法。watchdog 同步晋升和退出可能不产生单独 exiting 渲染，因此另外检查实际退休时间、迟到 ready 没有运行、无二次推进和最终 DOM，避免以“未观察到晋升”空判通过。

## 发现

- 代码竞态确实存在，足以解释“完成一次拖动后同封面再次入场”。
- 高 DPR / 性能差可能扩大窗口；本次没有证据量化它们在用户自然场景中的贡献。

## 风险

- headless Edge Chromium 的版本、合成和输入路径与原生 WebView2 不同；不能据此宣布两台设备用户体验验收完成。
- 使用真实 UI / 资源 hook 但模拟 selection / commit 边界；不替代真实播放器状态和音频契约端到端证据。
- 屏障延迟为定向故障注入，不是当前主机自然卡顿的测量。

## 临时缓解

- 是否为临时缓解：否；修复作用于会话所有权和退休次序。
- 适用边界：精确匹配并已接受的已绘制 preview；其他资源错误和迟到回调仍走原流程。
- 跟踪与后续 Owner：BUG-0018 保持原生设备待验；Frontend Agent 跟进新证据，Test Agent 验证。

## 验证结论

机制回归通过：独立旧实现失败信号已建立，修复后相同输入不重播，相邻生命周期回归通过。原生 Surface 自然异常是否完全消失及正常桌机是否无回归仍证据不足，不能把 BUG-0018 设备体验验收标为完成。

## 建议

交由主协调整合；使用新构建在 Surface 原有素材与 200% 缩放下复测同向、反向及连续拖动，记录尝试次数 / 异常次数，再在正常设备复测。若仍重入，继续采集真实 WebView2 会话 / 图层 / progress 时间线，区分本条已修机制与其他呈现问题。

## 第二轮：真实播放链反证与 incoming 换层

### 第一轮结论修正

第一轮没有运行真实 `useAudioPlayer`，夹具一次提交稳定 track / artwork / intent，未覆盖真实加载过程中 `detailsPending`、hydrate metadata 及 prefetch candidate 更新。用户反馈仍有重入，因此 BUG-0018 整体未通过验收；不将第一轮测试成功当作本轮修复证据。

### 独立复核原生失败证据

主协调在 Surface 实际 `2880 × 1920`、系统缩放 `200%`、WebView 内 `1440 × 960` / DPR `2` 的原生程序中，通过真实 m3u8 和音频链采集 `.codex/bug0018-native-live.json`（SHA-256 `04DC523D6815BCB4BDC1BD71B16C99248227AA65F71EA5423E780914DCB522B0`）。Test Agent 独立解析其中 `783` 帧、`52` 条事件、`17` 次 capture pointerdown；输入与原生采样由主协调执行（部分手势由用户亲自操作），本 Agent 只读分析保存结果，没有操作原生 UI。

| 原生时刻 ms | 请求 / 进度 | 资源与会话 |
| --- | --- | --- |
| 275571.9 | request 17，p=0.7103，pending=true | drag:31，29→30，incoming 30 的 identity=e194ddda、token=31 |
| 275588.6 | 同 request，p=0.7636，pending=false | 同一 pair、同一 identity，incoming 30 仍在 |
| 275605.2 | 同 request，p=0，session=null | incoming 30 被 incoming 33 替换；同 track 6fc03860、同 identity e194ddda、同 request 17，但 token 不再存在 |
| 275638.5 | 同 request，p=0 | automatic selection:17，29→33 |
| 275671.9–275921.9 | p=0.05→0.9233 | 相同选择重新完整推进，证实重播 |

反证：该窗口各帧 `coverTransform=none`，因此不存在以共享投影 transform 独自重播解释这一次失败的必要性；track / request / identity 未变，排除了真正切回旧歌曲或资源内容变化是这一次换层的必要原因。并非每次 progress 归零都是异常：轨迹还有正常退休后的归零，只有资源换层后同选择完整重播的链条构成此处失败信号。

源码核对：`detailsPending` / effective track / artwork / prefetch 依赖刷新会重新执行前景 effect。原实现复用 preview 和 active，但缺少精确匹配 incoming 的复用；`registryGet(identity)` 命中后 `createLayer` + `enqueueOrInstall` 移除旧 incoming，生成无 preview token 的新层。第一轮 surface 所有权严格绑定旧 layer，因而无法阻止该更早的资源层契约破坏。

### 新回归模型与基线隔离

新模式 `SPMUSIC_COVER_NATIVE_ONLY=1` 两侧都使用第一轮已修复的 `PlayerSurface`；只在浏览器路由中替换旧 / 新资源 hook。修改 hook 前已执行 `git diff -- src/features/player/hooks/useArtworkVisualResource.ts`，零输出，确认第一轮后的旧 hook 与 `20722d6` 一致；因此复用该提交的 hook 是本轮正确 before，而不是把未修复的旧 surface 混入本轮比较。

真实资源 hook 与原始双 rAF 屏障不加延迟（`barrierDelay=0`，第二 rAF 同步报告 ready），DPR 2。夹具模拟真实边界的阶段：commit 后 `detailsPending=true`，matching prefetch current candidate 允许 preview 晋升，观察到 incoming layout commit 后在 Promise 微任务刷新 details 与同 identity metadata 对象，精确控制刷新落在晋升之前。最终修复前 incoming `2→3`、同选择重播，修复后保留 `2` 和 token、无重播。另一对照把刷新放在 `120 ms` 后，旧新均不换层、不重播，验证问题依赖 incoming 尚未晋升的窗口。这是受控阶段测试，不是自然复现率实验。

探索时 `15 ms` 和 `setTimeout(0)` 的详情完成可能赶在晋升后；另最初 barrierDelay=0 的测试包装仍使用一次 `setTimeout(0)`，并不严格等价原始屏障，已删除该额外任务。最终重跑使用同步第二 rAF + 微任务详情控制，保留修复前换层和重播断言，没有把“旧实现未失败”的探索运行放宽为通过。

该自动化仍模拟 selection / commit，真实 `useAudioPlayer` 失败传播由上述原生轨迹直接支持；两类证据互补，不把 headless 夹具称为真实音频端到端验收。

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:\Users\winkeses\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:SPMUSIC_TEST_ORIGIN='http://localhost:5173'
$env:SPMUSIC_COVER_NATIVE_ONLY='1'
node src/features/player/components/coverTransition.browser.test.mjs
node --check src/features/player/components/coverTransition.browser.test.mjs
git diff --check
```

初次命令因 `127.0.0.1:5173` 未监听而 `ECONNREFUSED`；改用主协调已启动的 `localhost:5173` 专用 Vite。另原始 hook 的内存转译缺 Vite `import.meta.env.DEV` 常量替换曾导致夹具 pageerror，补齐后 before / after 均使用相同转译，不改产品源码。最终收紧后的完整 native 模式运行退出 `0`、输出 `COVER_TRANSITION_PASS`；四项 A/B 与三项边界扩展均通过，`node --check` / `git diff --check` 退出 `0`。主协调另报告 `npm run build`、`npm run lint` 与 release Cargo 构建退出 `0`，本 Agent 未重复这些构建。

### 本轮边界与剩余验证

- 已通过：只有 intent 改变的 same identity request `101` 被消费、建立不同 incoming layer 与 selection session，没有被去重吞掉。
- 已通过：不同资源 identity 创建不同 layer，没有错误复用旧 incoming。
- 已通过：不同 identity 的非法 PNG 解码进入既有空封面 fallback，最终正确 active、`data-has-image=false`、无残留 incoming / exiting 或 pageerror。未把图片失败当作正常图片成功。
- 原生修复后结果见下一节；正常桌机、触笔/触屏、无间隔手势重叠与长时间资源统计仍缺证据。

### 第二轮原生修复后独立复核

主协调确认当前原生构建为 `app-Dkcrczm3.js`、Surface 全屏 `2880 × 1920` / 系统缩放 `200%` / DPR `2`，通过 Computer Use `sky` 执行 12 次快速单次拖动，视觉未见重入，并保存 `.codex/bug0018-native-after.json`（SHA-256 `328CD1B9152320D1FA0D5B1D046B43CF9E9A9DFA63EB270975C04B1F53249A09`）。本 Agent 独立解析全部 `1777` 帧、`24` 条 pointer 事件；没有调用原生输入、连接 CDP 发输入或以实现者主观结论替代轨迹判断。

按实际 pointerdown / pointerup 坐标差分类，而非按口述估计：

| 手势 | CSS 水平位移 | 次数 |
| --- | ---: | ---: |
| 前向长拖 | −415 px | 7 |
| 前向短拖 | −180 px | 2 |
| 反向长拖 | +415 px | 1 |
| 反向短拖 | +180 px | 2 |

单次 down→up 用时 `50.2–93.3 ms`；相邻 pointerdown 的最小间隔 `5500.2 ms`。因此这批是快速单次手势，不能称为无间隔连续拖动或重叠压力。

独立沿用失败机制判据：逐次关联 drag session 的 incoming layer ID / identity，在该手势到释放后 `1600 ms` 且下一手势之前的窗口检查同 identity 是否换 ID、会话清空后是否再次出现 automatic 低进度推进，以及最终 active / transform。结果如下：

- 12 次 incoming 的同 identity ID 集合均只有原 ID，换层 `0/12`。
- 会话清空后同手势再次 automatic 推进 `0/12`，没有失败基线那样的归零后重播。
- 每次窗口末尾均为同一个 incoming 转成唯一 active，变换为 `none` 或单位矩阵；各窗口 coverTransform 均 `none`。
- before / after sampler 字段不完全一致，after 不含完整 request/sequence context；因此跨样本比较以 session、layer、identity、progress 与事件窗口为准，不从缺失的 pending/context 推断详情时序。

该结果支持新修复在真实 `useAudioPlayer`、音频/详情及资源链的这 12 次 Surface 样本中覆盖已定位失败。样本少、手势间隔长，不能估计总体异常率或排除重叠手势下的其他故障。

### 当前验证结论

第二轮已定位失败机制的受控 A/B、去重边界及 12 次真实 Surface 快速单次手势均符合预测：同一 incoming 保持 layer / token，不再因元数据刷新重建和重播。第一轮未解决用户问题的事实保留，当前证据支持本轮改动，但完整用户体验验收仍证据不足：无间隔连续压力、用户使用新构建后的反馈和正常桌机未覆盖。建议交付本轮修复与明确验证范围，持续由 BUG-0018 跟踪剩余体验反馈。
