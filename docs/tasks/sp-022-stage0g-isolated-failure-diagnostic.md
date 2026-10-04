---
doc_id: "TASK-SP-022-G1"
title: "任务：播放列表封面失败与升级回退的隔离诊断"
doc_type: "task"
status: "active"
owner_agent: "PM Agent"
version_scope: "future-unscheduled"
created: "2026-10-03"
updated: "2026-10-05"
source_documents:
  - "docs/tasks/sp-022-playlist-scroll-performance-plan.md"
  - "docs/test/sp-022-playlist-performance-baseline.md"
  - "Architecture Agent: 阶段 0G 隔离测试缝隙只读预审（2026-10-03）"
  - "Architecture Agent: ProjectDirs Windows Known Folders 与临时环境变量隔离核查（2026-10-03）"
  - "Architecture Agent: 一次性 G1 诊断构建的路径、asset scope 与 WebView 隔离终审（2026-10-03）"
  - "user request: 继续推进 SP-022"
---

# 任务：播放列表封面失败与升级回退的隔离诊断

## 背景与优先级

**P2，阶段 0G 的前置验证；一次性诊断构建按阶段 A/B 有条件批准，不批准产品行为改动。** Stage 0F 在真实列表热态五轮逐卡测得视觉排队占首次可见至自身图片 `load` 的保守比例中位数 84.45%–86.01%，但未覆盖有效的命令错误、图片加载错误及旧图回退。Stage 0G 无探针 Release 的十轮固定视口 1,840/1,840 张封面最终就绪，然而受管 URL/在途资源未测，GPU 进程私有内存未在 12 秒冷却内回到起点。并发 2↔3 A/B 的完整闸门未通过。

现有 `__TAURI_INTERNALS__.invoke` 不可变；此前 CDP Fetch 拦截自定义 IPC 广泛干扰通道，175 个 `job_error` 且目标视口仅 1/40 就绪，该批数据无效，也不能用同法注入单个失败。Architecture Agent 只读预审提出两个独立测试缝隙：在前端 adapter 上一次性改写一笔 pixel 请求的 `windowGeneration` 为 0，让真实 Rust 返回 `STALE_REQUEST`；以及在已有旧封面显示后，对 DPR 升级产生的新图片一次性替换为损坏 BMP Object URL，触发其自身 `<img error>`。二者只可在阶段 A 的隔离预检通过后进入阶段 B，不得在普通构建中运行。

**隔离前提复核（run4 前，2026-10-03）**：Architecture Agent 已证实当前 `AppPaths::prepare()` 通过 `ProjectDirs::from("app", "SpMusic", "SpMusic")` 取得 Windows Known Folders，而不是读取临时设置的 `APPDATA` / `LOCALAPPDATA` 环境变量；`WEBVIEW2_USER_DATA_FOLDER` 即使另设，也不能替代 Rust 的 config/data/cache 隔离。Test Agent 当时已生成两首合成 FLAC，**尚未启动应用或实施注入**。Frontend Agent 在发现隔离问题前已按原卡暂存 `audioCommands.ts` / `useAudioPlayer.ts` 的两个临时缝隙，尚未构建 Tauri 或运行故障注入；原 Frontend Owner 已撤除两处暂存缝隙；Test Agent 独立确认标识搜索零残留、两文件 `git diff` 为空、目标 ESLint、`npm run build` 与 `git diff --check` 通过。此为源码/构建复核，未启动应用，不能声称运行时清理已验证。原卡“另设这三个环境变量即可隔离”的前提错误，因此在阶段 A 的独立预检通过前暂停真实命令拒绝和图片错误端到端步骤。此前任何以这三个环境变量启动的探测进程，均不得因变量不同被称为 Rust 应用目录已隔离；这也不反推其一定改动了缓存，须以实际路径和写入证据判断。

### 一次性端到端诊断的分阶段闸门

**PM 范围裁决：有条件批准一次性隔离诊断构建及后续两项单次故障注入。** 可验收的隔离范围是已识别的应用自管 config/data/cache、asset protocol 读授权与 WebView2 profile；同 Windows 用户的 WebView2/Windows 系统缓存、崩溃诊断或注册表等 OS 级写入不能由本方案保证。测试不调用 `rfd` 文件选择器，合成路径仅经现有直接路径命令输入，以避开该测试造成的文件选择器 MRU；不触发歌词写入 `tag_writer`。若实际目标要求所有用户账户状态严格隔离，改用独立 Windows 身份/VM；本机当前没有可用的独立账户凭据或 Windows Sandbox，故本卡不宣称这一层保证。

**阶段 A：Rust/Tauri 隔离测试版。** Rust/Tauri Agent 独占 `src-tauri/src/app_paths.rs`、`src-tauri/src/lib.rs`、专用诊断 config 与 `src-tauri/Cargo.toml` 中的专用编译 feature；不得改生产 config 的默认目录或放宽正常构建的 asset scope。专用编译 feature 与专用 config 必须成对，缺一个、出现不匹配、额外自动建窗或缺测试根时均 fail-closed，不得回退真实用户目录。诊断配置只有一个 main window 且 `create=false`，因为 Tauri 2.11.5 在 `.setup` 前会自动创建 `create=true` 的主 WebView。诊断 `run()` 必须在 `Builder::build(context)` 之前创建并检查 `Context::config()`：唯一 main 窗、`create=false`、静态 asset scope 为空、feature/构建标记与独立根均符合预期；`TAURI_CONFIG` overlay 漏传、错配或多窗时不进入 Tauri build/setup。先对预建、唯一、绝对、canonical 的测试根及 config/data/cache/webview 子路径验证无 junction、symlink、reparse point，且与真实 SpMusic Known Folder 根不交叉；再创建测试 `AppPaths`。封面 `cache/audio/covers` 与缩略图目录须仅从测试 cache 派生。诊断 config 的静态 `assetProtocol.scope` 必须为空；setup 在验证根后、建窗前仅对测试 cache 动态 `allow_directory(..., true)`；随后用 `WebviewWindowBuilder::from_config(...).data_directory(绝对测试根/webview).build()` 建窗。当前生产静态 `$CACHE/**` 在 setup 前指真实用户 Known Folder，不能留在诊断配置里，也不能只依赖相对路径的 `tauri.conf dataDirectory`。

**阶段 A 防误触命令。** Rust/Tauri Agent 在**诊断 feature 打开时**让 `audio_open_file`、`audio_open_source` 于调用 `rfd` 文件选择器前、`audio_embed_lyrics` 于调用 `tag_writer` 写媒体文件前直接返回现有 `UnsupportedOperation`；不新增 error variant 或对生产构建关闭 feature 后的命令行为做改动。`audio_list_folder_tracks` 等合成曲目只读命令保留可用，阶段 B 的 `openAudioSource()` 仅在一次性武装时于前端返回 playlist，不调用被封闭的后端 picker 命令。Architecture Agent 须复核 feature 门控、既有错误契约与生产路径隔离，复核前不启动诊断进程。此防误触范围限 `src-tauri/src/lib.rs` 中已有命令入口，不扩至通用权限或生产功能。

**阶段 A 进入 B 的独立预检（2026-10-03 修订）。** Test Agent 先核对 feature/config 成对、测试根实际解析路径、目录与真实根无交叉，以及三个防误触命令的 feature 门控；再启动**不武装故障注入**的空白诊断进程。启动后核对三个命令均返回 `UnsupportedOperation` 而未弹 picker 或改写合成 FLAC，main WebView 实际 profile 路径及其进程归属、测试缓存封面可经 asset protocol 加载而真实缓存不可读，并对比真实 SpMusic config/data/cache 与默认 WebView 目录的前后元数据。结合编译期路径约束、Tauri build 前 fail-closed 校验、实际运行落点、asset 正反例和防误触命令，验收范围限于**已识别的应用自管目录、asset 读授权和 WebView profile**。测试进程只接触两首合成 FLAC，不打开文件选择器、不写歌词。任何已观察到的真实目录改动、越界读取授权、路径异常、进程身份不明或自动回退都停止并撤除测试版，不进入阶段 B。逐 PID 文件写入轨迹仍是更强证据，但当前账户下 WPR/logman 均被系统拒绝；本次不把它列为进入 B 的必备条件，也不得把前后元数据摘要写成逐 PID 轨迹或全账户隔离证明。预检原始证据由 Test Agent 独立记录。

**run4 证据、原闸门缺项与修订裁决（2026-10-03）**：Test Agent 对专用二进制 SHA-256 `7EE29253EE7F086F905124D87E36F488E090D96B30B8D78A1A294C4F0B3F8090` 的无注入进程 PID 1608 确认打包页 `tauri.localhost`、config/data/cache/webview 四专用目录及 WebView 后代；两首合成 FLAC 的封面在临时 asset 路径 200 且 512×512 成功，真实用户缓存负例 403/图片错误；三个防误触命令均返回 `UNSUPPORTED_OPERATION`、`recoverable=false`，合成文件哈希不变，有限窗口采样无新可见 picker；现用 Roaming/Local 树前后元数据摘要相同。诊断进程及其 WebView 后代已停止。run4 **没有逐 PID 文件写入轨迹，按原闸门确实未通过**；前后摘要无法发现短暂写后删除、同尺寸同时间戳覆盖，也不能归因写者。Test Agent 随后的最小能力探测证实当前非提升账户启动 WPR FileIO 返回 `0x80070005`，启动 logman Kernel-File 会话也因需管理员而拒绝，未产生会话或 ETL，未启动 SpMusic。Architecture Agent 复审认为上述静态约束、实际路径、asset 正反例、防误触 guard 与真实目录摘要构成**已识别应用自管边界**的有界替代证据。PM 据此正式修订前述预检口径：run4 在**修订后的有限隔离路径闸门**下通过，**仅授权 Frontend Agent 实施阶段 B 的原定三个一次性合成测试动作**；普通 feature-off 预检已独立通过；故障注入运行仍须逐次启动核对；新诊断 WebView 空白页启动后、任何 one-shot 武装前须取得旧前端草案分支零残留与当前授权入口契约证据；不得回写为“原逐 PID 闸门通过”或“所有同用户写入隔离”。

**Stage B 运行前补充闸门与残余风险。** run4 未在 Rust 临时代码后重建普通 Release 二进制，也未实测普通 Release 运行时诊断标记；不能声称原卡此项已通过。Test Agent 已独立核对诊断 feature 不在默认 Cargo features、正式/诊断 config 的 identifier 与 scope 分离、Rust 诊断路径受 `cfg(feature)` 门控；普通 `cargo check --release --lib` 于 14.35 秒退出 0。此项仅为普通库的静态/编译检查；若后续代码或配置改变，运行故障注入前须重做，任何异常即停。此检查只放行诊断版阶段 B 的合成测试，**不能代替普通 Release 二进制与运行时复核**；后者在所有临时 feature/config/前端缝隙撤除后由 Test Agent 独立执行。没有逐 PID 文件 I/O 轨迹，仍无法排除测试窗口内的写后还原、同尺寸同时间戳覆盖、未观测路径别名、WebView2/Windows 系统目录或注册表写入；单个真实 asset 负例和有限窗口采样也不能证明所有别名拒绝、所有瞬态 picker 均不存在。Test Agent 在阶段 B 每次启动前使用新的空测试根，核对诊断二进制、feature/config、静态 asset scope 与两首合成输入；启动后、任何故障武装前核对实际根/profile、动态 asset scope、三个 guard 和诊断入口契约；记录现用 Roaming/Local SpMusic 与默认 profile 的即时前后元数据摘要、进程树及异常。仅通过现有无 picker 一次性入口接入合成列表，不调用户曲库、picker 或歌词写入。任一实际落点不符、真实目录摘要变化、越界 asset 成功、guard 失效、非合成输入、异常别名或测试缝隙失控，立即停止并撤除测试构建，不继续故障注入。此监测不能替代逐 PID 轨迹；若后续需要证明所有账户写入，须另用独立 Windows 身份/VM。任何阶段 B 结果均不授权产品逻辑、并发、缓存或协议改动。

**阶段 B：前端一次性注入及撤除。** Architecture Agent 已确认现有 `openAndMaybePlay` 会消费 `openAudioSource()` 返回的 `{kind: "playlist", playlist}` 并进入现有 hook-local `loadFolderPlaylistSelection`。PM 因而把阶段 B 有条件批准为**同两文件中的三个一次性动作**：诊断版 `audioCommands.ts` 的 `openAudioSource()` 对预核验合成 FLAC 路径先消费武装、调用现有 `listAudioFolderTracks(path)` 并返回 playlist，让测试在列表页只点击一次现有 `.playlist-hero-more-button`（`handleMore → onOpenAudio → player.openAudio`）而不弹 picker；其后分别进行 `windowGeneration=0` 真实 `STALE_REQUEST` 与坏新图 BMP 注入。无需第三个 hook 文件或 Rust 新 command。阶段 A 的修订后有限隔离路径闸门已通过，现可按本卡边界实现；普通 feature-off 预检已通过；运行仍须本卡逐次启动核对；新诊断 WebView 空白页启动后、任何 one-shot 武装前须核对旧草案分支零残留及当前授权入口仅有三项一次性动作；未武装路径保持原产品调用，诊断流程禁止第二次未武装点击。三项动作测试后全部撤除，不记录合成绝对路径。原 Frontend Owner 已撤除隔离发现前暂存的两文件缝隙，Test Agent 的源码/构建零残留复核已通过；旧 G1 草案与本次授权版复用 `__spmusicG1Diagnostic` 名称，该全局入口在新诊断版中应存在，不能以名称 absent 判定旧版已撤除。Test Agent 须在新空根诊断 WebView 启动后、任何 one-shot 武装前，用源码/打包内容、当前 bundle SHA 及 CDP 暴露的接口和事件集合确认旧草案分支零残留、现有入口仅含获批的三项一次性动作；旧 Stage 0F 等独立全局探针须 absent。若旧新分支无法区分、出现额外动作或一次性门控不明，停止注入。当前已运行的普通 Release 无 CDP，不以其缺少直接查询结果阻断本次隔离诊断，也不据此宣称普通 Release 运行时已验证。任何跨 Rust command、错误模型、缓存语义或生产能力的扩大均回 PM 重新审批。完成后 Rust/Tauri Agent 撤除临时 feature/config/路径/profile/asset 覆盖，Test Agent 独立核对普通 Release 二进制和运行时无诊断入口、原默认 AppPaths 与 WebView profile 恢复；其后才能判定 G1 结束。

**阶段 B1 未触发记录与 B2 操作前提（2026-10-03）。** B1 中无 picker `openAudioSource()` 已返回 playlist，但 DOM 卡片 0、pixel 请求 0、故障命中 0；测试按停止规则结束，现用真实目录前后元数据未变。Architecture Agent 只读核对发现 B1 打开的是播放队列（`setQueueOpen(true)`），而列表页由独立的 `PlayerShell.isPlaylistOpen` 控制且默认关闭；脚本没有点击窗口左上列表页按钮。因此 B1 是**列表页未显示造成的无效故障触发样本**，不能把 0 次故障写成产品恢复失败、`STALE_REQUEST` 未起作用或 URL 回退缺陷。B2 的首次操作预检查在未武装、未点击打开音频前发现列表页已打开后原 ControlDock 打开按钮不在 DOM，约 0.6 秒即停止；诊断进程仍在、事件为空，**该预检查不计为故障触发样本**，也不说明恢复逻辑结果。代码只读核实列表页 `.playlist-hero-more-button` 的 `handleMore` 走同一 `onOpenAudio/player.openAudio`。B2 后续可沿用本次已核对的新空测试根与仍运行的诊断进程；武装前重新核对进程身份、实际隔离路径、入口状态及未触发计数，任一异常即停止：确认列表页可见及 `.playlist-hero-more-button` 存在且 enabled，再一次性武装无 picker 列表入口与 `STALE_REQUEST`，只点击该按钮一次；若仍无卡片，先检查 `audio_load_file` / playlist 激活链并停止故障判断，不扩展业务代码或放宽注入范围。

**B2 档位错配与 B3 触发条件（2026-10-03）。** B2 已经通过列表页现有入口一次性打开两张合成卡；故障钩子武装目标为 `edge=128`，实际 pixel 请求为 `edge=256/512`，所以真实 `STALE_REQUEST` 命中 **0 次**。测试按规则停止诊断 PID 32916，现用真实目录前后元数据相同。两张卡均曾发生原生 `<img load>` 且 pixel 请求返回 200；终点聚合就绪为 1/2，但缺少逐卡终点、可见性和图片状态快照，不能把该聚合数归因于故障注入或判为产品封面失败。B2 只证明列表接入路径可触发两卡与像素请求，是**档位错配的无效故障触发样本**。B3 重新使用全新空测试根并执行逐次隔离预检；根据 B2 实测请求把单次 `STALE_REQUEST` 目标设为 `edge=256`，记录目标请求档位与故障命中次数，并为两卡分别记录终点 DOM 存在、可见性、`<img complete/naturalWidth>`、pixel 结果及就绪状态。若目标档位仍未出现或未命中，停止并记为未触发；若终点仍非两卡就绪，先用逐卡证据区分可见性、加载时序与故障传播，再作产品结论。

**B3 真实拒绝后的最终显示失败（2026-10-04 复核）。** Test Agent 在新空根、同一隔离构建下，对两首合成 FLAC 只武装并触发一笔 `edge=256/windowGeneration=0` pixel 请求；真实 Rust 返回 `STALE_REQUEST`。前端记录一次 `pixel-error`、一次 `visual-retry-queued`；随后 `edge=256/windowGeneration=2` 重试成功，目标卡一次 `visual-commit` 和原生 `<img load>` 均发生。另一卡的 512 档正常。15 秒终点及随后约 1 秒的四次只读快照中，目标卡仍可见、`hasLocalArtwork=true`、`data-cover-state=loading`、没有 `<img>`；另一卡保持 512 档有效图片。activeJobs、visualSlots、queuedJobs、retryTimers 四项计数连续为 0。诊断 PID 35160 已停止，现用 Roaming/Local 目录即时前后元数据相同。**本卡 `STALE_REQUEST` 分支的“有界重试后最终显示有效封面”验收失败**；错误拒绝、重试和槽释放的分项成立，但不能据此判整个恢复成功。现有事件尚不能确定图片加载后是何处移除了目标 `<img>`，也不能把它直接归因为后端像素、URL 误撤或某个前端状态引用。独立证据见 `docs/test/sp-022-playlist-performance-baseline.md` 的 Stage B3 段。PM 另立 [TASK-SP-022-G2](sp-022-stale-cover-retry-display-defect.md) 追踪产品根因；诊断任务不顺手修改生产逻辑，不批准并发、缓存或协议改动。

**B4 坏新图回退分支的限次裁决（2026-10-04）。** Architecture Agent 只读认为 B3 的旧空面板晚退场可由操作顺序隔离，但该时序仍是待验证假设。PM 仅允许 Test Agent 在**全新空根、独立诊断进程、独立 playlist 会话**中再执行最多一次原已批准的坏 BMP 分支：先保持列表页关闭，仅武装一次无 picker 合成打开入口并点击此状态下现有的打开音频按钮一次；确认 `audio_load_file` 成功、playlist 两首已激活后，才点击窗口左上列表页按钮。不得在空列表页预先挂载面板、不得同时武装 `STALE_REQUEST`。打开列表页后，先取得两卡持续 2/2 有效、各自 `<img complete && naturalWidth>0`、旧图 URL 可由分离 `Image` 读取及四资源计数收敛的稳态基线，再按本卡第 4 项对**同一卡的新图**一次性武装坏 BMP 并触发 DPR 升级。任一前置不成立、旧图已丢失、出现额外命中或隔离检查异常，立即停止该轮，不以额外点击、延时或扩大注入掩盖。B4 只评估坏新图错误、旧 URL 所有权和回退；无论其结果如何，**B3 的 `STALE_REQUEST` 最终显示失败与 G1 整体验收未通过均保持**。B4 完成或停在前置门槛后先停止诊断进程并冻结 G1 故障注入范围；随后仅按 [TASK-SP-022-G2](sp-022-stale-cover-retry-display-defect.md) 允许 Frontend Agent 串行加入两文件匿名临时探针，Test Agent 在另一全新空根执行**最多一轮无故障对照时序采集**，不得重触发 G1 的 STALE/BMP 故障。该轮完成或因前置条件未通过而停止后，Frontend Agent 与 Rust/Tauri Agent 必须按原文件归属撤除全部 G1/G2 临时入口、探针、feature、config 和路径/profile/asset 覆盖；Test Agent 独立复核普通 Release 的源码、构建、运行时与原默认目录，**完成这一步才可进入 G2 产品修复**。修复后的真实 STALE 端到端回归若需注入，须按 G2 另建短时隔离验证构建并明确次数、Owner 和撤除闸门，不得保留当前 G1 seam。G1 的 B3 最终显示验收仍失败，产品修复与复测结果在 G2 独立记录，不以本次 B4 结果覆盖。

**B4 结果与 G2-A 收口状态（2026-10-04）。** Test Agent 在新空根通过隔离预检，并以先导入后开列表页取得两卡 2/2 稳态、旧 256/512 图有效且分离 `Image` 可读。单次 `bad-upgrade-bmp` 512 档已武装，但测试脚本在短命 CDP WebSocket 中设置 DPR 2；连接关闭后后续会话回到 DPR 1，目标卡没有产生新 512 档请求，`fault-triggered=0`、坏 URL 未创建。按最多一次规则未重试，诊断 PID 29940 已停止，真实 Roaming/Local 目录 before/prearm/after 摘要相同。**坏 BMP 错误与旧 URL 回退仍未覆盖，不能判通过或失败**；B3 的最终显示失败仍成立。随后 G2-A 在另一新空根完成唯一无故障匿名对照，已观察到旧面板 cleanup 导致新面板第二图被 prune 和 DOM 移除，Test Agent 已停 PID 18364、真实目录摘要一致；此证据记入 [TASK-SP-022-G2](sp-022-stale-cover-retry-display-defect.md)。G1 不再运行故障注入或追加观察，下一步是全部临时实现撤除及普通 Release 独立复核；清理之前 G1 不能收口，也不能开始 G2 产品修复。

**2026-10-05 状态与下一闸门。** G2 的 owner-token 产品修复在独立隔离 C1 无故障样本中通过旧空面板退场、两卡 2/2 稳态、快关重开和正常关闭的有限验收；这不倒推 G1 的 B3 真实 `STALE_REQUEST` 终态或坏 BMP 回退已通过。G2-C C2 只有另一全新空根的静态预检，诊断 exe 启动在 CreateProcess 阶段被 Codex 自动命令审查拒绝，未启动进程、未武装故障；Test Agent 随后独立确认 G1/G2 临时前端入口与 Rust 隔离覆盖的源码/dist/普通二进制**有限清理通过**，新普通 exe 直接运行时仍未测。本 G1 卡维持活跃且失败分支未验收。下一步由 Architecture、Frontend、Test 先只读界定可直接验证生产 URL 所有权/图片错误回退逻辑的离线测试边界及 SP-022 资源观测缺口；不再把未命中的 B4 记成有效错误样本，不重新启动诊断注入或变形执行被拒的 C2 启动命令。任何新的动态故障实验须有受支持的启动途径、独立新空根和重新审查的隔离/撤除闸门；离线测试不能取代同卡真实 `<img error>` 后旧 URL 存活的最终验收，也不授权 2↔3 并发 A/B。

## 目标

- 动态验证真实 `STALE_REQUEST` 后的重试、视觉槽释放、最终封面显示与会话隔离。
- 动态验证升级新图加载失败时，仍被使用的旧图 URL 可恢复显示，坏新图 URL 被正确撤销，随后正常升级可继续。
- 记录能够可靠复现的 `cached` hydration 路径；`shared` 若没有可控样本，明确保留缺口。
- 完全撤除测试缝隙，在无缝隙 Release 中复核构建、运行时入口缺失及原始成功路径。

## 非目标

- 不改两槽并发、排队顺序、缓存预算、Rust 解码门、SPXR、Tauri command 契约或生产错误处理逻辑。
- `STALE_REQUEST` 只证明此真实拒绝分支，不代表 `WORKER_FAILED`、`ALLOCATION_FAILED`、系统 I/O 失败或图片损坏全部通过。
- 合成两封面样本只验证失败/所有权路径，不代替 1,816 曲性能或长期资源平台；本卡不批准 2↔3 槽 A/B。
- 不改写或复制用户真实曲库中的媒体文件，不在用户现用数据目录、缓存目录或 WebView profile 中做注入。

## 负责 Agent、文件与输入

| 工作 | 唯一写入 Owner | 范围 |
| --- | --- | --- |
| 隔离边界设计与审查（当前） | Architecture Agent | 只读列出所有真实目录、候选绝对测试根与 WebView profile、失败关闭条件；不改运行时代码。 |
| 阶段 A 临时诊断构建与最终撤除 | Rust/Tauri Agent | 独占 `src-tauri/src/app_paths.rs`、`src-tauri/src/lib.rs`、专用诊断 config 与 `src-tauri/Cargo.toml` 的专用编译 feature；仅本卡测试版，普通构建保持默认路径与 scope。 |
| 阶段 A 预检通过后的阶段 B 三个一次性测试动作与最终撤除 | Frontend Agent | `src/features/player/services/audioCommands.ts` 的 `openAudioSource()` 诊断分支与 pixel adapter，以及确有必要时 `src/features/player/hooks/useAudioPlayer.ts` 的新图 Object URL 创建点；若需要第三个业务文件，先回 PM 缩界。不得顺手修改 `PlaylistPanel.tsx` 的阶段 0B 实验或其他 Agent 的改动。 |
| 合成曲库、当前单测、后续隔离采集与独立复核 | Test Agent | 测试夹具限独立临时目录；报告仅写 `docs/test/sp-022-playlist-performance-baseline.md`，可在自身允许路径增加必要的测试文件。不得改前端生产文件。 |
| 契约与测试缝隙审查 | Architecture Agent | 只读核对一次性触发、真实拒绝、URL 所有权、会话/资源边界；超出本卡须重新审查。 |
| 收口与下一分支判定 | PM Agent | 本任务卡与 SP-022 主卡；不把诊断结果自动转为并发改动授权。 |

阶段 A 的 run4 已完成无注入空白进程预检；按原逐 PID 轨迹闸门未通过，现经 Architecture 复审与 PM 明确修订，以有限的应用自管目录隔离范围通过并授权阶段 B 原定三个一次性动作的前端实施；普通 feature-off 预检已由 Test Agent 完成；运行仍须逐次启动核对，并在新诊断 WebView 空白页上先证明旧草案分支零残留、授权入口仅含三项一次性动作。Frontend Agent 隔离发现前暂存的缝隙已撤除，Test Agent 的源码/构建零残留核对通过；旧草案分支与新授权入口须在诊断 WebView 空白页启动后、武装前区分核对。输入为现有 `loadAudioPlaylistCoverPixels` 的 `windowGeneration` 契约、`useAudioPlayer` 的 `STALE_REQUEST` 重试和 `playlistPendingReplacementRef` 旧图链、`PlaylistCoverImage` 的图片 `load`/`error` 事件、Stage 0F/0G 独立测试报告。阶段 A 严格按本卡路径/asset/profile 条件执行；Test Agent 证明空白诊断进程隔离后，Frontend Agent 才能按 Architecture 已核对且 PM 在本卡批准的无 picker 入口进入阶段 B。

## 执行边界

1. 两首不同封面的合成 FLAC 已在 run4 的无注入诊断进程中使用。阶段 B 的普通 feature-off 预检已完成；每次启动使用经静态和 pre-build context 验证的全新显式绝对测试根与独立 WebView profile，并执行本卡修订后的启动前及退出后核对；记录合成输入哈希、构建哈希、实际 config/data/cache/profile 路径、窗口、DPR 和触发顺序。仅设置 `APPDATA` / `LOCALAPPDATA` / `WEBVIEW2_USER_DATA_FOLDER` 不满足隔离。用户现用 SpMusic 进程与 `E:\Music` 不参与故障注入。
2. 无 picker 列表接入仅在诊断构建中一次性武装：Test Agent 预先核验一首合成 FLAC 的绝对路径，先点击窗口左上列表页按钮并确认列表页可见（对应 `PlayerShell.isPlaylistOpen` 状态）；`setQueueOpen(true)` 只打开播放队列，不能作为列表页已打开的判据。确认列表页 `.playlist-hero-more-button` 存在且 enabled 后，才武装一次性打开入口与目标 `STALE_REQUEST`，`audioCommands.ts` 的 `openAudioSource()` 先消费武装，再调用现有 `listAudioFolderTracks(path)` 真实命令，返回 `{kind: "playlist", playlist}`。Test Agent 仅点击该列表页按钮一次，不尝试已不在 DOM 的 ControlDock 打开按钮；由 `openAndMaybePlay` 走现有 hook-local `loadFolderPlaylistSelection`，核对列表页两张合成卡均进入 DOM，再判断 pixel / fault 是否触发；若仍为 0 卡，先核对 `audio_load_file` 与 playlist 激活链，停止该轮故障结论；未武装调用保持原产品行为，诊断过程中禁止第二次未武装点击，以免弹出文件选择器。无新 Rust command，不记录绝对路径。
3. 像素失败缝隙仅在测试构建中一次性武装：B3 按 B2 实测 pixel 请求将目标设为 `edge=256`，先记录实际目标档位与命中次数；若档位不符或 0 次命中，不作故障恢复结论。复制 `loadAudioPlaylistCoverPixels` 的输入，把**恰好一笔**请求的 `windowGeneration` 改为 0 后调用原有 `audio_load_playlist_cover_pixels`。不伪造响应或 error code，不覆盖全局 invoke；触发后立即自动解除，后续调用使用原输入。用真实 Rust 错误记录该笔 `STALE_REQUEST`、对应 job 的终态、重试次数、视觉槽释放和新会话封面状态。
4. 新图错误缝隙仅在低档旧图已由对应卡片 `<img load>` 且 `complete && naturalWidth>0` 确认、再触发 DPR 升级后的**新图创建点**一次性武装：把这张新图的 BMP blob 内容替换为无效 BMP 并创建新 Object URL。旧 URL 的创建、引用和撤销逻辑不被测试缝隙改动；坏 URL 仅交给现有图片错误/回退流程处理。记录同一卡片的新图 `error`、旧图重新显示、URL 撤销顺序，再用分离的 `Image` 对旧 URL 解码并核对尺寸；此检查不主动撤销任何旧 URL。随后再触发一次正常升级，确认没有永久失败状态。
5. 临时测试根与窗口/asset 隔离由 Rust/Tauri Agent 在阶段 A 独立完成并由 Test Agent 预检，不属于前端故障注入阶段。若故障注入本身还须修改 Rust command、错误类型、共享状态或真实用户数据，停止该分支并回 PM 重新界定。不得使用 CDP Fetch 拦截自定义 IPC，也不得使用难以区分目标请求的全局 monkeypatch。
6. 采集完成后 Frontend Agent 撤除所有缝隙、武装入口和临时诊断字段；Test Agent 独立搜索零残留、运行适用 lint/build 与真实列表成功路径抽查。保留匿名计数与时间，不导出私人路径、曲名、trackId、封面内容或 Object URL 字符串。

## 验收标准

- 隔离先决：Architecture Agent 已给出实际路径与 asset scope 契约，PM 已批准阶段 A/B 顺序；Test Agent 在故障注入前核对本次进程的 config/data/cache/profile 全部为测试专用路径，诊断静态 asset scope 不含 `$CACHE/**`，动态 scope 只允许专用 cache，临时封面可读且真实缓存不可读，用户曲库不在命令输入。任何一点无法证明即停止端到端试验，仅报告单测缺口。
- 防误触命令：Architecture Agent 只读确认三个现有命令仅在诊断 feature 下提前返回既有 `UnsupportedOperation`；Test Agent 在隔离空白进程中验证 `audio_open_file` / `audio_open_source` 均不打开 picker，`audio_embed_lyrics` 不改变合成 FLAC 哈希；普通 Release 对应代码路径与错误语义保持原有状态。任何命令仍可触发 picker 或媒体写入，则停止，不进入故障注入。
- 隔离证明：合成歌曲及应用/WebView/缓存目录与用户数据分开；先使列表页可见，再让无 picker 列表入口仅武装/触发一次且 DOM 出现两张合成卡，未调用 `rfd`；两种故障各仅命中目标一次，原始输入和错误码可由匿名记录关联，未造成另一首封面或后续会话异常。
- `STALE_REQUEST`：真实 Rust 拒绝恰好一笔；前端不把它记为永久失败；目标在有界重试后最终显示有效封面；视觉槽与活动 job 数回到 0，没有过期图提交；新会话仍可加载两张封面。若当前逻辑不能达到，按缺陷记录，不以扩大重试次数掩盖。
- 新图错误：旧图在升级前有效；坏新图由同一卡片触发 `error`；回退后同一卡片 `complete && naturalWidth>0`，分离 `Image` 仍能读取旧 URL；坏 URL 被撤销，旧 URL 在最后一个使用者结束前未撤销；后续正常升级成功。至少记录 URL 创建、错误、回退和撤销的匿名顺序，无法确认 URL 存活则不能声称通过。
- `cached` hydration 以明确的缓存前置条件和命中分类验证；`shared` 若不可控，报告未覆盖。两者不得由“第二次图片更快”推断。
- Test Agent 独立复核隔离构建结果、异常/取消/URL 计数和无缝隙 Release 的源码、构建与运行时；无缝隙 Release 的固定视口有效封面最终显示率仍为 100%。所有临时 AppPaths/profile 覆盖和前端测试缝隙须在最终源码与运行时消失。任何测试缝隙残留、用户数据隔离失败、旧 URL 误撤或视觉槽不收敛，任务不通过并先撤除缝隙。

## 缺陷专项与风险

- **复现信号**：封面升级失败后旧图无法恢复，或真实命令拒绝后视觉槽/重试停滞。已有只读审阅指出升级回退可能撤销仍在使用的旧 URL；本卡用隔离新图错误验证完整因果链，不先把潜在风险写成已复现故障。
- **系统边界**：前端请求 adapter → Rust `STALE_REQUEST` → job catch/retry/finally；以及旧图引用 → 新图 Object URL → DOM `error` → 旧图回退/URL 撤销。记录会话、卡片、visual revision 与 URL 所有权的匿名关联；只统计由本次触发的失败，不把外围 IPC 扰动混入。
- **根因与回归**：若观察到旧 URL 误撤，须另立 Frontend 缺陷修复并覆盖错误、加载、连续升级、切歌/关列表和回收路径；本诊断任务不擅自顺手改生产逻辑。若真实 `STALE_REQUEST` 后卡住，同样按可复现时序及失败分支立缺陷。测试结束必须撤除临时缝隙，不得以吞错、伪造成功、无限重试或保留测试开关缓解症状。
- **性能与资源**：此两封面故障夹具不用于估计 1,816 曲 p95、第三槽预算或 Renderer/GPU 长时收敛。SP-022 仍需补受管 URL/在途资源、真实高 DPR 与失败分支覆盖；本卡通过也不批准 2↔3 A/B。

## 输出与文档更新

- Test Agent 在 `docs/test/sp-022-playlist-performance-baseline.md` 追加隔离输入、构建、逐次匿名事件、通过/失败与未覆盖项。
- PM Agent 根据独立复核在本卡和 SP-022 主卡记录结论；若发现真实缺陷，另立根因修复任务并重评优先级。
- 不改路线图、Sprint、版本状态；不提交或推送，除非用户另行要求。
