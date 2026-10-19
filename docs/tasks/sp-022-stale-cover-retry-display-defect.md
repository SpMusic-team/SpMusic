---
doc_id: "TASK-SP-022-G2"
title: "任务：播放列表封面重试后仍停在加载态"
doc_type: "task"
status: "active"
owner_agent: "PM Agent"
version_scope: "future-unscheduled"
created: "2026-10-04"
updated: "2026-10-05"
source_documents:
  - "docs/tasks/sp-022-stage0g-isolated-failure-diagnostic.md"
  - "docs/test/sp-022-playlist-performance-baseline.md"
  - "Frontend Agent: G1 B3 终态脱图只读分析（2026-10-04）"
  - "Architecture Agent: G1 B3 可见窗口所有权只读复审（2026-10-04）"
---

# 任务：播放列表封面重试后仍停在加载态

## 背景、优先级与状态

**P1，产品正确性缺陷；本次无故障复现的前端根因已由匿名时序证实，owner-token 产品修复已实施，C1 有限通过、C2 未测，诊断撤除的有限清理闸门已通过；本卡未完成。** 播放列表卡片在真实 Rust `STALE_REQUEST` 经一次成功重试、图片原生 `load` 后，仍可停留在 `loading` 且无 `<img>`。这影响本地嵌入封面的最终展示，属于已实现播放列表的可见正确性问题；不阻断音频播放，故不定为 P0。B2 无故障注入时也出现终点 1/2 图，提示问题可能不限于 `STALE_REQUEST`，但该轮缺逐卡终点证据，不能据此量化真实用户发生率。当前仅在两首合成 FLAC 的隔离诊断版复现；正式 Release 和用户曲库中的频率尚未测定。此卡从 SP-022 的 P2 性能探索中独立拆出，不把性能方案、并发或缓存调整当作修复。

## 复现证据与失败信号

- 环境与输入：Stage B3 专用诊断 exe SHA-256 `14631B15AF7C9EE3C7F12F74EA91DD8519C8B34DC98F9169F52AAAB06C4E1AC1`，新空 TEMP 应用根、独立 WebView profile、两首不同封面的合成 FLAC；现用曲库与普通 PID 未参与。证据详见 `docs/test/sp-022-playlist-performance-baseline.md` 的 B3 段及其匿名原始记录。
- 触发：列表页显示后，经一次无 picker 合成列表打开，只对一笔 `edge=256/windowGeneration=0` 像素请求触发真实 Rust `STALE_REQUEST`。前端 `pixel-error`、`visual-job-error`、`visual-retry-queued` 各一次；随后 `edge=256/windowGeneration=2` 重试成功，目标卡有一次 `visual-commit` 和原生 `<img load>`。另一卡 512 档成功。
- 预期：重试提交并加载有效图片后，两张可见且有本地封面的卡都最终显示有效图，目标卡变为 `ready`；所有 job、视觉槽、排队和重试计时器收敛。
- 实际：15 秒终点及后续约 1 秒四次只读快照中，目标卡仍可见、`hasLocalArtwork=true`、`data-cover-state=loading`、无 `<img>`；另一卡 `ready` 且 `<img complete=true/naturalWidth=512>`。activeJobs、visualSlots、queuedJobs、retryTimers 四计数持续为 0。诊断 PID 已停止，现用 Roaming/Local 目录即时前后元数据相同。**G1 的最终显示验收失败**；这不是 Rust 重试未成功或视觉槽仍占用的证据。
- 相邻证据：B2 未注入故障，曾两卡原生 `load`、pixel HTTP 200，但终点只有聚合 ready 1/2，缺逐卡快照；它支持进一步调查可见窗口时序，不能直接作为同根因证明。

## 已知事实、已确认根因与跨层边界

- B3 原始事件只能证明目标图片曾原生 load、终点无图；G2-A 的唯一无故障对照补齐删除链：新 p2 面板先发布两卡窗口且第二图 256 档 load，旧 p1 随后 exit/cleanup；hook 在同毫秒接收空窗口，按 demand 原因 prune 已存在的第二封面，约 3 ms 后 DOM 移除已加载的 `<img>`，15 秒终点目标卡仍 loading/无图且四项资源计数为 0。此链在**不注入 STALE_REQUEST** 时发生，确认本次复现的前端可见窗口所有权根因；B3 中真实 Rust 拒绝与成功重试仍属有效观测，但最终脱图不能归因于该拒绝本身。Test Agent 已停止诊断 PID 18364，真实 Roaming/Local 目录 before/pre-run/after 摘要相同。未直接捕获 URL revoke 调用或严格同 DOM 节点 ID，不能把这两项写成动态实测。
- Frontend 与 Architecture Agent 的源码候选现获 G2-A 动态证据支持：`PlayerSurface` 的 key 切换与 `AnimatePresence` 使旧空 `PlaylistPanel` 延迟退场；旧实例 cleanup 无所有权校验地上报空可见窗口，hook 随之删掉非 persistent 的第二首视觉资源，而新面板本地 `artworkWindowIds` 未变化，不再重发需求。Architecture Agent 将该顺序判为**此无故障复现的已确认前端根因**，修复边界是面板实例所有权；不能由此推断所有其他脱图场景同因。
- 系统边界：`PlayerSurface` key 与 `AnimatePresence` → 旧/新 `PlaylistPanel` mount、publish、cleanup → hook 可见窗口所有权和 `desiredIds` → visual map 的 prune/revoke → `PlaylistCoverImage` 的 DOM `load`/`error` 与 `data-cover-state`。核对 Tauri `audio_load_playlist_cover_pixels` 的 `STALE_REQUEST`、成功重试与 generation 契约，但现有证据不支持修改 Rust 命令或错误语义。

## 目标与非目标

- 目标：用有界、匿名的面板 mount/unmount/publish、旧面板 cleanup、hook 空窗口接收、目标 `desired/visible`、prune reason、URL 所有权和 DOM image 状态时序，确认首个错误状态及完整传播链；随后由 Frontend Agent 在经 Architecture 审查的最小前端范围内修复，使**旧退场面板不得撤销新面板的可见封面需求**，或按证据修复其他已确认源头。
- 非目标：不增加重试次数、任意延时、强制刷新、吞错或保留诊断入口掩盖终态；不修改并发槽数、缓存预算、缩略图格式、Rust 命令、SPXR 协议、用户曲库或真实应用目录。不把 B3 的合成故障频率外推为实际用户发生率。

## Owner、输入与实施闸门

| 工作 | Owner | 允许范围 |
| --- | --- | --- |
| 根因只读核对、修复边界 | Frontend Agent 与 Architecture Agent | 先检查现有 `src/features/player/components/PlayerSurface.tsx`、`PlaylistPanel.tsx`、`PlaylistCoverImage.tsx`、`src/features/player/hooks/useAudioPlayer.ts` 的事件顺序、所有权和状态；只读结论交 PM，不改产品代码。 |
| 阶段 G2-A：临时匿名时序观测 | Frontend Agent，现已批准，须与 G1 B4 串行 | 仅 `PlaylistPanel.tsx`、`useAudioPlayer.ts` 中必要的诊断构建事件；先向 Architecture Agent 提交字段/触发点只读核对，Test Agent 以 CDP 只读记录第二卡图片移除。默认关闭、匿名、最终撤除，不改产品行为或 Rust。 |
| 阶段 G2-B：产品根因修复 | Frontend Agent，满足下述证据闸门后条件放行 | 若旧面板 cleanup→新窗口需求被删的时序证实且 Architecture Agent 确认所有权契约，优先只改 `PlayerSurface.tsx`；额外业务文件、跨层契约或错误语义变化须回 PM/Architecture 重审。条件未满足前不得修改产品行为。 |
| 修复前后独立验证 | Test Agent | 先保留 B3 失败基线，再在隔离合成样本与正常 Release 路径核对同一失败链、无故障导入、取消/离屏/重挂及资源所有权。 |
| 范围、优先级和完成判定 | PM Agent | 仅维护本任务卡及 SP-022/G1 状态，不把故障诊断自动转成并发或缓存改动。 |

输入为 G1 B2/B3 报告、匿名原始记录、前端可见窗口与 `STALE_REQUEST` 现有契约。诊断版的故障缝隙须按 G1 收口要求撤除；修复后的两轮受控端到端验证按下述 G2-C 有界授权重新建立隔离构建；原 G1/G2-A 临时钩子已撤除，不直接复用残留钩子。

**下一阶段 PM 裁决（2026-10-04）。** G1 B4 独立坏 BMP 诊断结束并停止其进程前，不编辑与其共用的前端文件。随后 Frontend Agent 可实施 G2-A 的匿名临时探针；只记录面板实例匿名 owner、mount/exit、可见窗口 publish/cleanup、hook 接收者、目标 desired/visible、prune reason 与时间，不导出曲目 ID、路径、Object URL、封面字节或歌词。Test Agent 已在一个新的隔离根完成**唯一一轮无故障导入对照**，未武装 G1 的 STALE/BMP 故障；旧空面板退场、hook prune 与第二卡移除的相对顺序已记录于 `docs/test/sp-022-playlist-performance-baseline.md` 的 G2-A 段。G2-A 的唯一无故障动态采集已确认旧面板 cleanup→空窗口→demand prune→DOM 第二图移除的顺序，Architecture Agent 已确认以下所有权合同。G1/G2-A 临时入口与隔离覆盖已撤除；Test Agent 独立核对 `src`/`dist`/新普通 Release 二进制的诊断标识零残留、默认 feature/config、前端构建/ESLint、Rust release lib 与普通 exe 构建通过，现有普通 PID 的 WebView profile 仍指默认 Local 目录。新普通 exe 未在同用户现用目录下启动、其 JS 全局入口没有直接运行时查询；**该缺口不写成已通过**。PM 正式将这组证据判为本次 G2-B 的**有限清理闸门通过**，条件放行 Frontend Agent 的最小前端修复：`PlayerSurface` 为每个打开中的 `PlaylistPanel` 实例分配 opaque owner token，传入绑定该 token 且普通 rerender 中身份稳定的可见窗口回调；仅当前 owner 的 publish/cleanup 可转发给 hook。旧 `AnimatePresence` 退场实例不得清除新面板需求；真正关闭且没有后继时，允许刚关闭 owner 的卸载 cleanup 上报一次空窗口完成资源清理；快速重开后旧 cleanup 失效。不得以 `tracks.length=0` 特判代替所有权。若需改变 `PlaylistPanel`/hook 对外契约、扩展写入文件或证据转向其他根因，本条件授权失效，须回 Architecture/PM 重新定界。

阶段 G2-A 与 G2-B 由同一 Frontend Agent 串行拥有各自文件，二者之间的**有限清理闸门**已通过；未进行的新普通 exe 直接运行时 absence/路径测试保留为缺口。Frontend Agent 已在无临时缝隙的普通源码上仅修改 `PlayerSurface.tsx` 实施 owner-token 修复，目标 ESLint、前端 build 与 diff check 通过。G2-C 的 C1 无故障动态反证已由 Test Agent 有限验收通过；C2 在启动前被自动命令审查拦截，真实 `STALE_REQUEST` 修复后终态尚未验证，**本 P1 缺陷保持部分验证、未完成**。临时入口须按下述收口规则撤除并独立重建/核对普通 Release，任何最终诊断残留均不验收。

## G2-C：修复后两轮隔离反证的有界授权

**PM 裁决（2026-10-04）。** 仓库没有现成的 React 组件测试框架；现用普通 app 进程和真实 SpMusic 目录不参与交互验证。为把 P1 修复验收到可交付，Architecture Agent 先只读复核下述与 G1 相同的编译期 feature/config 配对、Tauri build 前 fail-closed、显式临时 AppPaths、绝对 WebView profile、空静态 asset scope 与仅临时 cache 的动态授权，以及三个 picker/歌词防误触命令。Rust/Tauri Agent 独占原 G1 的 `app_paths.rs`、`lib.rs`、`Cargo.toml` 与专用 config；Frontend Agent 独占 `audioCommands.ts` 的一次性无 picker 合成打开入口及确有必要时 `useAudioPlayer.ts` 的**仅一笔**真实 `STALE_REQUEST` seam。`PlayerSurface.tsx` 的产品修复在两轮间保持相同内容和可核构建身份；诊断 seam 不改修复逻辑、Tauri command、错误码、并发槽、缓存或 URL 所有权。Test Agent 仅以两首自主合成 FLAC、TEMP 根和匿名记录独立验证；不碰 `E:\Music` 或正在运行的普通进程。

**两轮不得共用一个测试根或应用进程。** C1 和 C2 使用同一可核 SHA 的诊断 exe 与同一 `PlayerSurface.tsx` 产品修复内容，各自预建全新空根并启动独立诊断进程；同一根下的第二会话会继承磁盘缓存、窗口/动画历史及 WebView profile，不能等同 B3 的旧空面板前置条件。每轮均先静态核对诊断二进制/fixture SHA、feature/config、空根与真实目录不交叉，启动后核对实际四目录、WebView 后代/profile、临时 asset 200 与真实缓存负例 403、三个防误触命令拒绝及合成 FLAC 哈希；记录真实 Roaming/Local/default profile 即时 before/after 摘要。任何身份、路径、权限或 guard 异常即停止，不执行用户库请求。

1. **C1：无故障旧空面板路径，仅一轮。** 在空列表页先打开列表 UI，确认旧空 `PlaylistPanel` 已挂载，再只武装一次合成 open，点击现有 `.playlist-hero-more-button` 一次；不武装 `STALE_REQUEST` 或坏 BMP。通过 CDP DOM 观察旧空面板退出、第二卡 `<img load>` 与其后的可见终态；`useAudioPlayer.ts` 临时匿名事件只记窗口接收/空窗口、四项 visualState 与 job 状态，不重新加入 G2-A 的 Panel 探针，不能声称直接读取旧/新 owner 身份。两卡须持续 `ready`、`complete && naturalWidth>0`，在 15 秒及随后至少 1 秒的稳态检查仍为 2/2，四资源计数归零。在已记录 2/2 稳态后，先快速关闭并重开一次；旧面板退出后新窗口两卡仍 2/2、未出现空窗口导致的第二图 prune。随后正常关闭且不再打开，匿名记录中当前关闭对应的有效空窗口接收恰一次，非 persistent 第二图和窗口需求退出，活动 job/槽/队列/计时器归零；若事件不能区分有效接收与重复报告，标记观测缺口，并以 `PlayerSurface.tsx` 所有权契约只读复核及 DOM/资源终态判断，不能宣称直接证明“恰一次”。现有清理语义允许 persistent 首曲封面继续保留，**不要求所有 Object URL 归零**。若旧 owner 晚到 prune 新窗口，判失败；中途脱图或资源不收敛亦判失败，不用增加延时掩盖。
2. **C2：真实单笔 `STALE_REQUEST`，仅一轮。** 在另一新空根重复 B3 的“先打开空列表页、再合成打开”顺序，按实测并预核对的 256 档只武装一次 `windowGeneration=0` 请求。须有恰好一笔真实 Rust `STALE_REQUEST`、恰好一次前端错误/重试、随后有效 generation 的 256 档成功与目标 visual commit；另一卡仍有效。两卡在 15 秒及随后至少 1 秒均 `ready` 且图片可解码，四资源计数为 0，不得有旧结果越会话提交。若未命中目标档、故障命中多次或隔离异常，立即停并记为未形成有效反证，不在同根重试。

**两轮间隔与最终清理。** 每轮 one-shot 武装在触发时自动消费或到时失效，结束即停止并核对诊断 PID/WebView 后代及真实目录 after；下一轮只在前一轮没有隔离/额外命中异常、进程树已退出时以**另一全新空根**启动同一已核 SHA 构建。两轮间不重用进程、根或运行时武装状态，也不反复增删源码。C2 结束或任一轮出现隔离/额外命中异常而提前停止后，Frontend/Rust-Tauri Agent 立即按各自文件归属统一撤除临时 seam、feature/config 与路径/profile/asset 覆盖；Test Agent 独立执行前端 lint/build、Rust release lib/普通 exe 构建、诊断标记零残留和生产默认配置检查。新普通 exe 在本机同用户真实目录下的直接运行时 absence 若仍不能安全取得，必须标为缺口；源码、dist、普通二进制零标记及诊断进程的实际隔离证据可支持**有边界的 P1 修复交付判断**，不得宣称已直接观察新普通进程的全局入口或路径。任一临时入口残留，G2 不验收。

**坏 BMP 暂缓。** B4 因短命 CDP 连接丢失 DPR override，坏 URL 从未创建，旧 URL 回退仍未覆盖。该分支属于 G1 原始 URL 所有权风险，不能由 C1/C2 的 2/2 稳态替代；本次 G2-C 不再武装 bad BMP，也不因此扩大 P1 的单文件 owner-token 修复。若 owner-token 修复触及图片错误/URL 生命周期，须 Architecture/PM 先重审并补对应动态回归；否则把坏 BMP 留在 G1 未覆盖项与后续独立任务，不把 G1 记为通过。

**G2-C 执行判定（2026-10-04）。** Test Agent 的 C1 报告记录：独立空根的无故障合成导入中，旧空面板退场后两卡在 15 秒及后续稳态保持 2/2 `ready` 与可解码图片，四项 visualState 为 0；快关重开后仍为 2/2，正常关闭只收到一次有效空窗口，第二张非 persistent URL 已撤销，诊断 PID 停止且真实 Roaming/Local 元数据摘要前后相同。**仅 C1 有限通过**；这不覆盖全部生命周期或长期 URL 总数。C2 的另一专用新空根静态预检通过，但启动诊断 exe 的 `exec_command` 在 CreateProcess 阶段被 Codex 自动命令策略 `Rejected(...blocked by policy)` 拒绝，PowerShell 未启动，未建立 C2 诊断进程，未武装或注入 `STALE_REQUEST`，也没有修复后 C2 终态。该拒绝属于执行审查边界，不能记作产品失败或测试通过；不改换命令形状绕过本次拒绝，不在同根重试。按提前停止规则，Frontend/Rust-Tauri Agent 立即各自撤除诊断 seam、feature/config、临时路径/profile/asset 覆盖，再由 Test Agent 独立核对源码、dist、普通 Release 构建和零残留。清理完成前不得宣称环境已恢复；清理完成也不补足 C2 验收。本 P1 产品修复保留在工作树供后续安全复验，任务状态为**部分验证、未完成**。

**恢复执行裁决（2026-10-05）。** Test Agent 已独立核对临时前端入口、Rust feature/config、路径/profile/asset 覆盖从已识别源码和新 dist 撤除，普通 Release 的 lint/build、Rust lib/二进制构建及明文标记检查通过；这是**有限清理通过**，新普通 exe 的直接运行时入口和真实用户路径仍未测。现有普通 app 不因本卡重启或导入测试媒体。下一项可立即执行的工作是由 Architecture Agent、Frontend Agent 与 Test Agent**先只读**确定无需启动诊断 exe 的确定性测试边界：优先复用仓库现有 Node 模型测试能力，明确怎样直接执行产品所有权判断、真实 `STALE_REQUEST` 成功重试后的视觉状态保持，以及坏新图错误后的旧 URL 所有权逻辑；测试不得复制一份生产实现后仅验证副本。仓库当前没有 React 组件测试框架，若需新增测试依赖、抽取业务函数、改变公共接口或在普通构建暴露测试入口，先由 Architecture Agent 复核最小合同与文件 Owner，再由 PM 定界；在此之前不授权为测试重构产品逻辑。Frontend Agent 仅按获批合同实施测试所需的最小代码，Test Agent 独立复核失败信号、正常/错误/取消分支与构建；离线测试结果只补逻辑证据，**不能代替**隔离 WebView 中的 C2 真实命令拒绝、重试、图片显示与资源终态。C2 仍须等待明确受支持的启动途径；不得将上次被拒命令改形、借 UI 间接启动或复用 C2 根绕过自动审查。若没有可信的直接产品逻辑测试边界，记录不可测原因并保持本卡未完成，不制造镜像实现测试。

## 验收标准与回归

1. **根因证据（本次无故障复现已通过）**：匿名时序明确 p2 发布两卡、第二图 load、p1 退场 cleanup、hook 收空窗口并因 demand prune、约 3 ms 后 DOM 移除，形成终点 `loading`/无图。URL revoke 调用及严格同 DOM 节点 ID 未直接记录；修复与回归仍须核对 URL 所有权，不把该缺项写成已测。
2. **原始路径反证**：在同一两封面场景下，修复前能复现目标卡脱图；修复后真实单笔 `STALE_REQUEST` 仍被拒绝一次、成功重试一次，两卡最终 `ready`、各有 `<img complete && naturalWidth>0`，且 15 秒与后续稳态快照仍保持；四资源计数最终为 0，旧结果不串入新会话。保留前后同口径事件和构建身份。
3. **无故障与相邻路径**：C1 无注入导入在旧空面板退场与新面板入场后两卡持续 2/2 有效，快速关闭重开时旧 owner 不清除新窗口，最终正常关闭时当前 owner 清理且不无界保留非 persistent 资源。离屏回屏、快速取消/会话切换及正常 DPR 升级由 Test Agent 按所有权影响抽查并逐项记录；坏 BMP 错误回退属于 G1 尚未触发的独立缺口，本卡不宣称其通过，也不以一次 `load` 代替稳态终点。
4. **资源与契约**：任何正在被当前卡使用的 Object URL 不被旧面板 cleanup 撤销；失效 URL 及时回收；没有无界 job、槽、队列、timer 或 URL 增长。前后端 command 名称、输入/输出、generation 与错误码不变；若必须改动，另经 Architecture 审查。
5. **独立复核与收口**：Test Agent 独立验证目标 lint/build、修复前后同口径的隔离合成列表，并在统一撤除后核对源码、dist、普通 Release 二进制无诊断标记及默认配置。新普通 exe 在本机同用户真实目录下的直接运行时入口与路径未安全核验时，必须保留该缺口，不写“运行时已消失”或“普通 Release 实机列表已通过”。只有根因修复、C1/C2、资源收敛与有限清理闸门通过且残余缺口明确，PM 才可对本 P1 缺陷作有边界的完成判定；G1 与 SP-022 性能任务各自仍按自身闸门判断。

## 风险与文档更新

- 单次合成故障证明存在可见错误终态，但尚无真实曲库自然触发频率。测试缝隙、动画时序与 Release 环境可能影响重现；应在正常构建的无故障导入中验证旧面板卸载链，不以诊断版结果直接宣布真实用户普遍受影响。
- 如果匿名时序显示根因在 Rust 或共享命令契约，Frontend Agent 停止前端修复并回 Architecture/PM 重定 Owner；不得以额外重试隐藏跨层错误。
- PM 更新本任务卡及 SP-022/G1 状态；Test Agent 更新 `docs/test/sp-022-playlist-performance-baseline.md`；如实施后需要用户可见行为说明，再由 Documentation Agent 按实际变更更新对应文档。本卡不改路线图、Sprint 或发布状态。
