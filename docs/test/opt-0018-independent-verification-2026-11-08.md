---
doc_id: "TEST-OPT-0018-INDEPENDENT-2026-11-08"
title: "OPT-0018 列表封面路径通道独立验证报告"
doc_type: "test-report"
status: "验证完成；功能验收不通过"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "用户请求：只保留相关文档到 develop，剩余测试与结论由本次验证完成"
  - "docs/architecture/opt-0018-v2-correction-execution.md"
  - "docs/test/opt-0018-v2-closeout-and-performance-plan.md"
  - "docs/changes/optimizations/OPT-0018-v2-result.md"
  - "被测功能提交 9e3a4f921b35f9c9191c28604c72db5c8a91a694"
  - "本轮独立日志与反例：SpMusic-verification/2026-11-08"
---

# OPT-0018 列表封面路径通道独立验证报告

## 摘要

**功能验收不通过。** 已独立复现两个 P1：歌单 hero/菜单的展示事件缺少 token；播放器 512 档的强制恢复仍请求路径通道。现有自动化全绿不能覆盖这两处实际消费者与恢复分支。

Rust 检查、Rust 单元测试和前端构建通过；速度改善未证明。真实 WebView2 中普通 256 卡片删图/损坏后恢复，512 hero 删图后未恢复，进一步支持“不通过”；长时 CPU/内存观察已完成，有限窗口不能证明有无泄漏。

## 范围

被测代码是 `feature/opt-0018-path-lane-v2` 的 `9e3a4f921b35f9c9191c28604c72db5c8a91a694`，核心改动为 `271793c`。未修改生产源码、并发、权限或测试断言以消除失败。

本文写入独立的 develop 文档工作树：文档归档提交 `8626e33` 保存八份历史方案/报告，基于 `origin/develop` 的 `67a9287`；后续队列及其取证 Markdown 保留提交不属于本次封面验证。**本次仅提交文档，未合入路径通道功能代码**。历史文件中“已实施”等状态指功能分支，不表示 develop 具有该能力；复现应使用上述被测提交。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent / Rust/Tauri Agent；本轮为主 Agent 与独立验证 Agent 执行，区分各自实际命令。
- 已确认改进：AllSongs 受理 pending/presented 的当前错误，共享恢复记录保留 spent；LibraryArtwork 512 档已添加 forcePixels 分支。
- 实现者主张：三个 owner 的 DOM 失败均触发一次直接 pixels 补救。该主张在播放器 512 分支及真实 hero/菜单入口被反例否证。
- 已知事实：126 项既有目标测试通过；附加生产决策反例 0 通过 / 3 失败。两组采用不同测试范围，不相互抵消。
- 证据边界：反例执行真实 hook、生产 JSX 表达式及真实封面组件，React/native/DOM 边界使用既有替身；不是原生文件删除测试或全屏面板挂载。

## 命令

下列代码命令均针对功能分支工作区执行，不是在文档 develop 工作树运行。

| 检查 | 执行者与结果 | 证据/限制 |
| --- | --- | --- |
| `cargo check --manifest-path src-tauri/Cargo.toml --lib` | Rust 验证 Agent 亲跑；exit 0，5.93 秒 | 完整 stdout/stderr、结果 JSON 已保存 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Rust 验证 Agent 亲跑；398 passed / 0 failed / 10 ignored，exit 0 | 测试 32.18 秒，墙钟 33.06 秒；1 条 linker_messages warning |
| 既有前端/账本目标集，命令见下方 | 独立 Test Agent 复跑；126 passed / 0 failed | 包括三 owner harness 与计数模型；不等于原生故障注入 |
| `node D:/SpMusic-verification/2026-11-08/code-regression/verify-closeout.mjs` | 独立反证 Agent 执行；exit 1，0 passed / 3 failed | 保留失败，未放宽断言；它们映射到两个 P1 |
| `npm run build` | 主 Agent 亲跑；exit 0 | Vite chunk 超过 500 KiB 与构建计时提示；原 stdout 在工具记录，未单独归档 |
| `npm run lint` | 主 Agent 亲跑；exit 1 | 三个错误均在既有临时产物，见下方；没有改配置掩盖 |
| 原生 WebView2 故障注入 | 独立 Test Agent 执行；256 删图/损坏恢复，512 hero 删图失败 | 独立不可见桌面与隔离缓存，注入边界见下方 |
| 长时 CPU/内存 | 已完成单候选观察 | 631 秒，范围与结果见原生注入章节；无对照组 |

既有 126 项目标集命令：

```powershell
node --test src/features/player/hooks/coverPresentationContract.test.mjs src/features/player/components/playlistCoverElement.test.mjs src/features/player/services/playlistCoverPathLane.test.mjs src/features/player/services/playlistCoverScheduler.test.mjs src/features/player/hooks/libraryArtworkRecovery.test.mjs src/features/player/hooks/playerArtworkRecovery.test.mjs tools/thumbnail-benchmark/coverlane-counting.test.mjs
```

额外控制组 `playerArtworkRecovery.test.mjs` + `playlistCoverElement.test.mjs` 为 16/16 通过，日志保存在反例目录。该控制组是 126 项中的子集，不重复累加测试数。

Rust 测试 warning 为链接器生成 `.lib/.exp` 信息，不影响 exit 0，但不能报告“零警告”。此前 ds 记录过一次 397 passed / 1 failed 且未捕获用例名；本轮未复现，**不证明偶发性已消除，也不推定其属于既有网络问题**。首轮全绿后未无依据重复全套测试。

lint 三条诊断来自 `.codex-tmp-folder-ui-dist/drag-diagnostics-20261101/selection-baseline-surface.js`：772:3、2255:3 缺 `react-hooks/set-state-in-effect` 规则，2323:3 缺 `react-hooks/refs` 规则。该文件在既有 gitignored 产物目录，不能把全仓 lint 说成通过。

## 人工检查与原生注入

独立 Test Agent 在不可见的 Win32 desktop、独立缓存/profile 和测量进程内执行，未更改用户音乐、正常缓存及正在使用的应用。受管 JPEG 确实删除或写坏，禁用浏览器缓存后，对原元素先清 src、隔一帧还原，强制重新读取。后者是受控 DOM 重读，不是自然虚拟化 remount；事件仍由原组件处理。

| 原生案例 | 已观察事实 | 结论与边界 |
| --- | --- | --- |
| `normal256-delete` | 真删 JPEG 后带 token 的 error → blob load，间隔约 133 ms | 普通卡片可恢复；截图与事件轨迹保存 |
| `normal256-corrupt` | 真损坏 JPEG 后带 token 的 error → blob load，间隔约 145 ms | 普通卡片可恢复；不是慢盘实验 |
| `hero512-delete` | 真 404 后仅裸字符串 error，0 次 pixels IPC；约 3 秒时原元素仍 connected、naturalWidth=0、data-loaded=false | 512 hero 未恢复，实际失败支持 P1 消费端缺口 |

普通两案例各看到 2 次 pixels IPC，但请求体未完整归属到同一尝试，不能据此声称“恰好一次”或断言重复恢复 bug。采样中旧普通 img 已被替换，旧引用的 naturalWidth=0 不应误读为新 blob 也失败；恢复以新 blob 的 load 事件和截图判定。注入后 JPEG 已恢复。

原生候选 SHA-256 为 `0ba33ab61c217fe2e1063fb8e9e915872f023f472d43a869f1432798c7c7ee69`。`binding-manifest.json` 记录关键六个源文件和 lock 与当前逐字节相同，但缺完整 source→dist→exe 绑定；原生结果限定于该二进制，不能称完整可复现 release 验收。

正式采样计划为 600 秒固定滚动与另计 30 秒 idle；在从未切换显示的 Win32 desktop 上禁用后台节流。它延续同一故障注入进程，JPEG 已还原且 hero 同 URL 重读后恢复，普通卡片的 blob 补救可能仍在 owner 缓存。因此分类为**故障恢复后候选的混合缓存压力**（可能含 JPEG+blob），不是 fresh 纯 JPEG 路径内存基线。它只描述该受控进程窗口，不等同可见前台交互性能或生产 SLA；单臂没有等条件 CPU 基线，不能称 CPU 收益或路径通道内存改善。

首轮采样观察到 renderer 增长，同时诊断收集器存在无界数组：审计时 frames 约 192,469、presentation 1,457、domEvents 859、nativeEvidence 2,119。后两组序列化合计约 1.34 MB，未见顶层 DOM-node 引用；这些事实说明观测存在干扰，但**不足以解释全部增长，也不能直接把增长归为产品泄漏**。首轮原始数据保留并标记为“受干扰观察”，不静默删除。

首轮实际约 629.1 秒、每进程 575 个样本；`native-summary.json` 的 private bytes（MiB）与累计进程 CPU 时间如下。末值含 idle 尾段，不等于活动期平台值。

| 首轮进程 | private 初值 / 峰值 / 末值 MiB | CPU 累计秒 |
| --- | --- | --- |
| 主进程 | 19.93 / 41.97 / 9.25 | 1.41 |
| renderer | 94.56 / 286.24 / 99.91 | 280.64 |
| GPU | 176.85 / 194.08 / 173.71 | 380.83 |

renderer 活动末段上升，但 idle 后明显回落；不能只拿峰值判断泄漏，也不能因回落就证明产品无泄漏。这组数据因收集器干扰，不作产品内存通过或泄漏的单独判据。

随后启动全新候选进程，关闭诊断收集器并使用新的隔离缓存；固定预热 30 秒、稳定 15 秒后，执行 600 秒滚动和约 30 秒 idle。两轮缓存状态不同，不作为严格对照。

干净窗口实际 631.367 秒，滚动 399 轮，每进程 576 个样本，CSV 跨度约 629.4 秒。19 次定期检查均无破图或残留 loading，起终 hero 正常，诊断收集器缺席。

| 进程 | private 初值 / 峰值 / 末值 MiB | CPU 累计秒 |
| --- | --- | --- |
| 主进程 | 11.28 / 11.32 / 11.03 | 0.1094 |
| renderer | 123.09 / 363.98 / 117.95 | 276.5313 |
| GPU | 229.47 / 242.00 / 214.25 | 255.75 |

renderer 活动期末五分钟 private 斜率约 +4.37 MiB/分钟，idle 尾段明显回落。有限单机窗口既不能证明泄漏，也不能证明不存在泄漏；没有等条件基线，CPU 数字不能用于宣称改善。真实前台使用、大曲库及长于此窗口的表现仍待验证。

两组测试只关闭记录中的专属进程；14 个记录 PID 无残留，三张隔离测试 JPEG 均按备份 hash 恢复。

## 根因与因果链反证

### P1：歌单 hero 与菜单封面没有完整展示事件

被测提交 `src/features/player/components/PlaylistPanel.tsx` 的约 881、944 行直接给 `PlaylistCoverImage` 传 image，却没有 presentation。组件因而发送裸 URL；`useAudioPlayer.ts` 的约 2865 行拒绝无 token 的恢复事件。当前源第一次 DOM 失败不能进入预期的强制 pixels 补救。

反例从生产文件提取 hero/菜单的真实 JSX 表达式，编译后执行真实封面组件的 `onError`。两项均期望当前 token，实际为 `undefined`，断言失败。不是仅凭 `rg` 未找到字段得出的推测。

替代解释已排除：**普通列表卡片不能据此认定没接 token**。当前 PlayerShell 的 artworkSource 经 PlaylistPanel 传至 PlaylistCard；卡片从 store visual 取得 presentation。缺口限定于上述直接封面入口。

### P1：播放器 512 强制作业仍优先调用路径通道

`useAudioPlayer.ts` 的约 2258 行只在 ≤256 分支判断 `job.forcePixels`；约 2322 行的 >256 分支直接调用 `attemptPlaylistCoverThumbnailPath`。因此即使 token 合法，512 恢复仍再次取路径。

反例通过既有真实 hook harness 建立 512 发布，先报告 loaded，再报告同一发布 failed。期望 path 调用保持 4 且 pixels 直接增加；实际 path 从 **4 增至 5，pixels 为 0**，断言失败。

该反例使用 DOM-query 边界表示该图已真实显示，使生产升级退役逻辑清除旧替代图，避免将“首次补救”误构造成“回滚旧图”。未修改 hook 分支、恢复 map 或 pending-replacement 决策。

## 跨层契约

| 项 | 结论 | 依据 |
| --- | --- | --- |
| AllSongs / LibraryArtwork 的本轮核心修正 | 已有自动化与代码证据 | 不能因此覆盖 AudioPlayer 512 与 hero 实际入口 |
| 展示 token 到恢复 owner | 不通过 | hero/菜单实际事件无 token，被严格监听拒绝 |
| 512 恢复强制 pixels | 不通过 | 真实 hook 反例再次调用 path |
| 取消/旧事件/多消费者与恢复 epoch | 已有 harness 覆盖；原生注入仅三个场景 | 不把局部通过扩大成所有 UI 正确性通过 |
| 命令、缓存版本、权限 | Rust 目标集通过；未做本轮生产变更 | 10 项 ignored 仍为未执行用例，不计为通过 |

## 回归覆盖

已运行既有三 owner/组件/路径调度/计数模型测试，并追加三个反证。组件表达式测试保护生产消费端，512 反例保护真实作业 lane 选择；现有全绿目标集未覆盖这两个错误。

尚未完成的真实无图/坏图、大 DPI、慢盘、≥1000 个独立封面及完整视图矩阵均保留为证据缺口。未通过的正确性门槛不能被正常样本最终全部就绪抵消。

## 性能 / 时序

**速度改善未证明。** 本轮以正确性反证和证据核查为主，不将一对 A/B 当统计改善结论，不据载荷下降换算显示时延。≥1000 语料和 E1–E4 并未完成，本文不作对应优化验收。

原报告将 786,552 B 与 518 B 相除为单张 1500 倍已撤回：前者是 3 个完成请求，后者来自 4 个请求中 2 个完成请求，非等资源/档位/阶段匹配。载荷为字节可比较，但这批采样口径不匹配，不能称精确单张倍数；asset 读取与完整 wire 开销还应分列。

最新 `lead-fix-ab` 候选 fresh/warm 中 `presentation.tokensSeen=33`、`attributable=true`，baseline 才为 0。旧报告用“PlaylistPanel 不显式传 presentation”解释候选 0 token 已过时，应以实际卡片 store 来源与当前原始记录为准。

真实 ledger 仍未连到前端 fallback 出口：当前 buildLedger 主要按 CDP 构造 pathStart/Ready 与 pixelsStart，缺实际 fallbackStarted/Completed/Failed、pixels 终态；候选记录含 `ledgerEvents=[]`、来源未归属和在途。模型合成测试通过不能证明实测零回落。

已换候选 `D:/opt0018-ab/fix/.../app.exe`，并非此前 final2。核查者比对其关键源码与 lock 与当前相同；但 manifest 为 `a55163f` 加未提交状态，没有完整 working diff/dist/构建命令/预期 hash fail-fast，不能据此完整绑定至 `271793c`。本轮原生独立产物的绑定结果另行回填，不沿用旧数据假称已补齐。

## 发现、风险与临时缓解

两个 P1 已实际复现，Owner 为 Frontend Agent；修复目标是补实际消费者的 token 和 512 的直接 pixels lane，不是删除严格身份校验、扩大重试或延长超时。

本轮未实施临时缓解或功能修复，未将失败测试放宽。仅保留文档到 develop，避免将已知正确性不通过的功能分支作为本次集成结果；这不等于替功能分支完成回滚。

## 证据、复跑与验证结论

证据根为 `D:/SpMusic-verification/2026-11-08/`；原始日志和反例脚本不随本次文档提交入库。保留以下相对清单，换机复跑需同时取得证据包及相同被测提交/依赖：

- `rust/environment.json`、`cargo-check.*`、`cargo-test.*`、`logs.sha256.json`：完整输出、exit、时间及日志摘要。
- `code-regression/verify-closeout.mjs`、`result.json`、`run.log`、`README.md`：三个反例、边界及可复跑命令；重复运行会覆盖结果，应先归档。
- `code-regression/existing-tests.log`：16 项控制组结果；`main-execution-facts.json` 为主 Agent 的构建/lint 事实摘要，不是逐字 stdout，原输出保留在工具记录。
- `native/binding-manifest.json`、`inject-native.mjs`、`normal256-delete.json/.png`、`normal256-corrupt.json/.png`、`hero512-delete.json/.png`：原生三场景及产物绑定限制。
- `native/clean/native-summary.json`、`native/clean/cpu-memory.csv`、`native/cleanup-result.json`：干净窗口资源数据与清理记录。

**当前结论：不通过。** 两项 P1 阻碍 DOM 恢复契约完成；原生和性能仍有未验证范围。通过的编译/单元测试证明其各自范围，没有推翻反例。

建议退回 Frontend Agent 修复并先让三个反例转绿，再重跑相邻真实消费者与原生故障注入。只有门槛满足后才重新讨论速度实验；不得将本文写成产品任务完成或发布批准。
