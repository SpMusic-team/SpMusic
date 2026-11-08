---
doc_id: "ARCH-OPT-0018-REIMPLEMENTATION"
title: "OPT-0018 列表封面路径通道重做实现方案"
doc_type: "architecture"
status: "proposed"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "用户请求：为 ds 撰写可交接的实现方案"
  - "docs/changes/optimizations/OPT-0018.md"
  - "docs/changes/optimizations/OPT-0018-verify.md"
  - "docs/decisions/2026-11-07-album-cover-asset-pipeline.md"
  - "docs/architecture/playlist-artwork-loading.md"
  - "git commits: 09cc450, 28312ab, 71adeed"
  - "src/features/player/hooks/useAllSongsWindow.ts"
  - "src/features/player/model/playlistCoverReadiness.ts"
  - "src/features/player/services/playlistCoverScheduler.ts"
---

# OPT-0018 列表封面路径通道重做实现方案

## 1. 交接结论与当前状态

继续验证“列表 JPEG + asset URL，播放器大图保留像素”方向。先打通一张真实封面的完整发布过程，再扩展消费者；不要整批恢复旧提交后以构建通过作为完成标准。本次文档不代表功能已实现，也不承诺性能收益。

编写基线为 `71adeed`：路径通道实现已回退，工作树仍走 SPXR → BMP。`09cc450` 是旧实现，`28312ab` 是 Windows 路径修正，均仅供差异参考。开始实施时重新记录 HEAD 与工作树状态，保留无关修改，在隔离开发分支按阶段提交，不自动切换、清理用户当前工作树。

旧 [优化记录](../changes/optimizations/OPT-0018.md) 的“已实施”和 [实测指引](../changes/optimizations/OPT-0018-verify.md) 的“待实测”已不能表示当前代码状态；其历史测试数量也不是本轮证据。[原架构决策](../decisions/2026-11-07-album-cover-asset-pipeline.md) 的后端缓存与命令边界仍可复用，前端成功判定需按本文补充。

回退说明记录了“命令约 3 ms 返回、JPEG 和 URL 正确，卡片仍 loading”。这只能说明部分环节完成，不能证明图片已解码、store 已发布或 DOM 已显示。本轮须复现并记录具体停止位置。

## 2. 已找到的旧实现缺陷与证据边界

| 静态检查结果 | 旧代码位置 | 重做要求 |
| --- | --- | --- |
| 取消谓词反向传入 | `09cc450` 的 `playlistCoverPathLane.ts::runPathLaneCall` 第二参数叫 `isAborted`，正常返回后 `if (isAborted())` 丢弃；`useAllSongsWindow` 却传 `itemIsCurrent`，`useLibraryArtwork` 传 `current` | 全链路只使用命名字段 `isCurrent`，`false` 才丢弃；逐一检查所有调用方。`useAudioPlayer` 旧代码传的是 `jobIsStale`，不能机械替换所有谓词 |
| 首候选无图会终止整组 | 旧 `useAllSongsWindow` 的 `track-candidates` 遇 `missing` 执行 `break` | 当前候选无图应 `continue`，全组穷尽才确认无图；失败候选先尝试自己的像素回落，再进入下一候选 |
| “路径成功”记得过早 | 旧 `runPathLaneCall` 在 URL 转换后立即记成功；图片解码在各 hook 外层 | URL 转换、asset 读取和预解码应属于一次尝试；解码失败、超时同样触发回落 |
| 异常外层吞掉后无像素补救 | 旧 hook 的路径 `decodePlaylistCover` 抛错进入普通终止异常分支 | 在路径尝试内部分类错误；路径失败后仅回落一次，不直接落成永久缺图 |

第一项可直接解释“当前请求被正常返回后丢弃”的代码行为，与失败现象相容；但缺少当时端到端跟踪，不能宣称它是唯一实测根因。上述缺陷均需有行为测试，不能只核对函数文本。

## 3. 范围、边界与保持条件

本轮覆盖列表封面的 track、folder 与 playlist-cover 来源，按 256 主干、其他消费者、512 hero 顺序接入。专辑候选项共用 `useAllSongsWindow`，因此先验证它；不要为专辑页新建独立调度器。

保持播放器 `audio_load_cover_pixels`、1024/1536 大图、canvas、背景和拖拽投影契约。分流依据是**命令族**，不是全局 `maxEdge <= 512`：播放器命令的合法 256/512 仍返回像素。旧像素 track 命令只接受自身现有档位；512 回落走原有 playlist-cover 像素命令。

不新增依赖、数据库、持久化设置、权限或全库预生成流程。`assetProtocol.scope` 保持 `$CACHE/**`；后端许可仍为 `available_parallelism()/4` 限制在 1..4，前端全局 `MAX_CONCURRENT=4`、窗口并发 2 保持不变。路径命中也不另开免许可通道。

质量约束：热路径应减少 IPC 字节与 JS BMP 工作；冷路径增加 JPEG 编码与落盘等待，必须实测。WebView 图片缓存与 GPU 驻留不能从编码字节预算推算；卸载节点也不保证立即释放其内部缓存。保留现有驻留预算与租约，分别观察主进程和 renderer 的增长趋势。

## 4. 目标数据流与模块落点

```text
可见/预取需求 → 原有优先级调度器(path) → Rust协调器 → JPEG文件已发布
  → {path,width,height,byteLength} → convertFileSrc → Image预解码
  → 检查isCurrent → 原有store提交与通知 → React订阅 → DOM图片实际加载
路径真实失败 → 原有优先级调度器(pixels) → 原BMP转换/预解码 → 同一发布出口
过期/取消 → 丢弃并释放本次资源；确认无图 → 当前候选结束或占位
```

| 落点 | 实现内容 / 责任边界 |
| --- | --- |
| `src-tauri/src/audio/cover_pixels.rs` | JPEG读取/编码、统一预算、原子发布、路径返回、现有协调器与许可；抽出共用方向/缩放接缝 |
| `src-tauri/src/audio/folder_cover.rs` | 复用既有目录封面选择，提供路径出口，保留目录/根包含校验 |
| `src-tauri/src/audio/mod.rs`、`src-tauri/src/lib.rs` | 导出、注册新命令；原二进制响应逐字节契约不变 |
| `src-tauri/src/library_cover_warmup.rs` | 路径通道全面启用时，同批把默认列表预热产物切到 JPEG |
| `src/features/player/services/audioCommands.ts` | 新命令类型与返回值校验；路径只交给 `convertFileSrc` |
| `src/features/player/services/playlistCoverScheduler.ts` | 同队列增加 `lane` 去重维度；类型区分路径/像素，禁止错误载荷跨通道复用 |
| 新建 `src/features/player/services/playlistCoverPathLane.ts` | 会话开关、尝试结果分类、图片预解码及超时协调；不持有业务store、不导入hook或组件 |
| `src/features/player/hooks/useAllSongsWindow.ts` | `pump`、候选遍历、身份复核、`publish`、`notify`、`finally`资源/计数收敛 |
| `src/features/player/hooks/useLibraryArtwork.ts`、`useAudioPlayer.ts` | 主干通过后串行接入，沿用各自作业身份、驻留账本与发布出口 |
| `src/features/player/model/playlistCoverReadiness.ts` | 保留 decoded/presented 分离；如扩展超时/取消能力，参数可选并保持已有调用语义 |
| `src/features/player/components/AlbumLibraryPanel.tsx`、`PlaylistCoverImage.tsx` 及实际共享封面消费者 | 真实DOM成功/失败反馈；必要时接入最小失效接口，不以CSS或提前标ready掩盖未发布 |

每个阶段每个文件只有一个写 owner。Rust/Tauri Agent 持有后端文件；Frontend Agent 持有前端文件；Test Agent 独立验证。共享入口、类型和配置的修改串行完成。以上为技术拆分建议，不调整 Sprint 与产品范围。

## 5. 命令与缓存契约

新增 `audio_load_track_thumbnail_path`、`audio_load_folder_thumbnail_path`，主干完成后增加 `audio_load_playlist_cover_thumbnail_path`。复用既有输入的 clientId、来源路径、windowGeneration，路径命令允许 128/256/512。

```ts
type AudioThumbnailPath = {
  path: string        // 普通绝对路径，不是Windows verbatim路径
  width: number      // JPEG真实宽高，正整数，不回显maxEdge
  height: number
  byteLength: number // 文件编码字节，不代表解码内存
}
// Promise<AudioThumbnailPath | null>；null仅表示后端已确认无封面。
```

沿用 `CoverPixelsError` 和 `STALE_REQUEST`。空、负尺寸、非有限字节数或不合法返回结构按路径失败分类。不得把“文件尚未发布”“缓存损坏”“超时”包装成无图。

后端实施顺序：

1. 从 `decode_playlist_and_pack` 抽出共享方向校正、预降采样和缩放结果；像素侧仍 pack 原 SPXR，JPEG 侧转 RGB 编码。默认 quality 82，不带 EXIF，透明度处理与旧 BMP 的 RGB 行为对齐。
2. JPEG 命名 `{hash}-{edge}-t{transform}-j{imageVersion}.jpg`，与 `.spxr` 并列；transform=2、disk=1 不变，新 JPEG imageVersion=1。调质量/采样只升 JPEG 版本；不得让大图缓存整体失效。
3. 同一 `audio/thumbnails`、同一 writer、同一 8 GiB/32768文件预算；`scan_thumbnail_usage` 和 `make_thumbnail_room_with_limits_checked` 两处都识别 `.spxr` 与 `.jpg`，包含临界空间、替换与失败记账测试。
4. 使用同目录临时文件和原子 rename。返回路径前等待 writer 对该目标结束，再校验正式文件；发布等待建议初值2秒，失败/跳过/超时返回错误。不能先返回目标名再异步写盘。
5. 命中需普通文件、大小上限、合法JPEG标记与可读真实尺寸、规范化路径包含于缓存目录；损坏删除/隔离后回源。仅首尾JPEG标记不足以保证可解码，前端仍必须预解码。文件上限初值1 MiB，需边界测试。
6. **安全校验使用 canonicalize，返回值使用受信任 cache_dir.join(filename) 的普通绝对路径**，落实 `28312ab` 修正。不可通过无条件字符串删前缀绕过包含性校验；测试空格、中文、`#`、`%`、非ASCII与Windows路径，URL只用 `convertFileSrc` 转换。
7. 复用来源索引/内容hash及无图失效逻辑，避免命中仍读取整张原图；路径和像素索引必须指向各自格式，不能让旧索引把 `.spxr` 当 JPEG。
8. 全面启用前把 `try_warm_track_thumbnail` 默认预热对齐JPEG，前台优先与背景限流保持；实验仅接入一处时先控制预热，避免制造两套全量产物。回落时按需生成SPXR，旧缓存保留。

具体 helper 名可复用原决策；实现时必须核对 writer 对 `.jpg` 直接写字节，不能误套 SPTC 外头。文件被淘汰后同一路径读取失败必须可回落，不能依赖 stat 后文件永久存在。

## 6. 前端尝试、回落与发布契约

### 6.1 一个明确的当前性谓词

新增 helper 使用命名选项，避免正负语义相反的裸回调：

```ts
type AttemptOptions = {
  priority: 0 | 1 | 2
  signal?: AbortSignal
  isCurrent: () => boolean
}
type PreparedPathOutcome =
  | { status: 'ready'; image: PlaylistCoverImage }
  | { status: 'missing' }
  | { status: 'dropped' }
  | { status: 'fallback'; reason: string }
```

`ready` 表示 URL 已转换、图片预解码成功且请求仍当前，尚未表示 store 已提交或 DOM 已呈现。helper 返回同一个 image 对象，不能解码对象A后重建对象B发布：decoded 状态是 WeakSet 按对象身份记录。

调度前、命令返回后（**先检查当前性再解释 null**）、解码后、发布前均检查 `signal.aborted || !isCurrent()`。现有 scheduler 在取消时也可能 resolve(null)，必须先排除取消，才能把 null 当无图。`STALE_REQUEST`、取消、身份变化不回落、不计失败，不写负缓存。

### 6.2 一次路径尝试的完整范围

调用路径命令 → 校验载荷 → `convertFileSrc` → 构造 image → 有界图片加载/解码 → 当前性复核，全部纳入一次 try/catch 分类。图片预解码建议独立超时初值3秒，可用命名常量；与后端发布2秒分开记录，不将它们宣传成性能保证。

超时/取消后移除监听、清理计时器、清空临时Image的src；晚到的 decode 完成不得标记新资源、发布或清零熔断。仅 `Promise.race` 后任由原 Promise 继续修改 readiness 不满足要求。可在 path helper 内实现独立预解码，或以兼容可选参数扩展 `decodePlaylistCover`，不要改所有像素调用的默认时限。

路径命令错误、无效载荷、URL转换异常、asset读取/解码失败或超时：记录一次真实路径失败，当前作业立即走原像素命令一次；像素回落失败后按现有 transientFailure 终止，保留原可用封面，下一次访问可重试。不得形成 path↔pixels 循环或无限 pump。

路径尝试成功只在图片预解码且仍当前时清零连续失败；不是“IPC成功”或“生成URL”时。确认无图不增不减计数；取消/过期不增不减。连续8次真实失败后本会话禁用路径，以完成顺序定义连续性；已禁用后晚到成功不得重新开启。共享同一次原生命令的错误应在调度尝试边界去重，不因多个订阅者重复计数。

开关应区分“显式禁用”和熔断禁用，仅保留内存状态；禁用后直接走像素，不额外排一次路径作业。不新增用户设置。故障回落会多一次请求和等待，不能声称最坏时延等于改造前。

### 6.3 候选项与最终发布

按 `track-candidates` 原有顺序处理：无效/流来源跳过；当前候选 path missing → 下一候选；path失败 → 同候选像素回落；得到已解码图片即停止。全候选均确认无图才缓存无图；存在真实失败且最终无图则沿用 transientFailure，保留下次访问重试。取消整项立即结束，不继续下一候选。

`useAllSongsWindow` 保留 `itemIsCurrent` 的 key、完整 `coverIdentity`（含 artworkRevision）、mounted、desired 校验。交给同一个 `publish` 写缓存、trim、notify；`useCoverUrl` 的 snapshot 必须与 descriptor 身份一致。每个成功发布将局部URL所有权交给store，未发布的blob才由finally回收；路径URL不能靠revoke释放WebView位图。

每个活跃作业恰好一次结算：`coverQueued.delete`、`coverActive--`、`pump` 放在 finally。所有退出原因可观察，不能因为 path dropped 忘记结算；合法的过期丢弃也不应把当前项标无图。不要移除 metadataLoading、visible、rendered 或租约门控来“修好”loading。

### 6.4 DOM失败与共享URL

预解码不保证后续DOM加载必然成功，例如发布后文件淘汰或损坏。现有 `AlbumCover` 是原生 img，不能只依赖 `PlaylistCoverImage` 的自定义事件覆盖全部消费者；接入时明确各组件的 onError 路由。

采用最小的 store/作业所有者失效入口，参数包含 key、descriptor identity、失败URL与发布代次。只有仍匹配当前发布的资源才能触发一次像素回落；过期DOM事件忽略。该入口由hook维护重试状态并重启原pump，组件只报告失败，不发IPC。每次发布最多一次补救，不按同URL的每个img重复扣熔断计数。可在 `useAllSongsWindow` 导出报告函数供 AlbumCover/歌曲卡调用；其他两hook由其现有图片错误链对齐同一规则。

若DOM错误与先前预解码成功对应同一尝试，升级该尝试为失败一次；不能反复 success/failure 抖动。已有成功blob作为升级前回退图时保留到新图实际可用，不提前撤销。

共享同一asset URL的多张卡各自受其descriptor/代次保护；不要给URL追加随机时间戳破坏共享缓存。相同内容路径被淘汰重建时内容应相同；内容/编码参数变更通过内容hash/版本更换URL。decoded是对象级、presented历史是URL级有界集合，解码成功不能提前消费 presented 标记。缓存图在React挂载前已经complete的场景需检查 `complete && naturalWidth>0`，不能只等一次onLoad事件。

## 7. 分阶段实施与出口条件

| 阶段 | 实施内容 | 出口证据 |
| --- | --- | --- |
| A：基线与复现 | 在回退基线记录单图/首屏表现；读取旧实现差异，补取消谓词、候选顺序、解码失败回落行为测试 | 测试确实能击中旧错误；记录基线commit、命令、缓存状态和失败阶段 |
| B：单图纵向验证 | 最小track路径命令 + 同预算JPEG + 前端path helper；只在一处真实 `useAllSongsWindow` 消费路径，其他保持像素 | 真WebView2下单张从请求到DOM显示；命令成功但decode失败可回落；当前/取消均正确。不得只做独立img演示就认为hook接通 |
| C：集合列表 | 接入候选遍历、folder、正常批量可见项；保留原发布/通知/租约与优先级 | 首候选无图第二候选有图、滚动离开返回、快速切页/重扫/共享图均正确；计数与队列回到0 |
| D：其他消费者 | 接入 useLibraryArtwork、useAudioPlayer 的列表256，再接512 hero；前台/后台预热同批对齐 | 各消费者正反谓词分别验证；512回落用正确旧命令；播放器大图与canvas链不变 |
| E：验证与交付 | 独立Test Agent完成自动化及真实WebView2 release对照；回填旧文档状态和本轮证据 | 正确性全通过且收益可量化后才默认启用；否则保留像素默认、报告阻碍 |

阶段B出现loading时，先找最后一个有证据的阶段及下一步缺失原因；不先加并发、删取消检查、手工markDecoded或全局提前标ready。独立Image能加载但store无URL，检查当前性/候选/发布；store有URL但snapshot无值，检查identity/订阅；DOM有URL但不显示，再检查实际图片及显示状态。

## 8. 观测、验证与对照方法

开发诊断按单作业记录 requestId、clientId、generation、key/identity摘要、sourceKind、lane、edge、priority、isCurrent、desired/visible、cacheHit、result、dropReason、fallbackReason、breaker状态。路径内容使用摘要，避免日志长期输出本机音乐路径；诊断日志有界且可关闭。

记录时间点：入队、dispatch、后端完成、JPEG发布、收到响应、decode开始/结束、store提交、notify、DOM complete/onLoad/onError及下一帧检查。前后端使用各自单调时钟计算分段，不能直接相减跨进程绝对时间。旧观测的3ms仅是一个分段，不是封面可见耗时。DOM ready状态也不是像素已显示的单独证据，至少联合 naturalWidth、complete、data-loaded（若存在）与截图。

必须覆盖的自动行为用例：

1. `isCurrent=true` 可发布；false、signal abort、STALE在命令/解码/发布各阶段均丢弃且不回落。测试真实hook调用方，不能只测helper的正确参数。
2. path成功但图片损坏、404或decode不结算→恰好一次像素回落；双失败终止且队列释放；超时晚到不得发布。
3. 首候选无图第二有图；首候选路径失败但像素成功；全候选无图；部分失败时下次访问重试。
4. lane键隔离、并发/优先级、共享消费者取消不误伤他人；8次失败熔断，成功重置，missing/取消不改计数。
5. 同asset URL多卡、已缓存挂载、资源对象替换、重扫revision、离屏回归、卸载中解码完成；DOM失败按发布代次去重。
6. `.jpg`预算统计/淘汰、并发同键原子发布、发布超时/写盘失败、索引失效/无图失效、Windows普通路径和包含性、旧SPXR字节契约不变。

真实WebView2必须验证：专辑/全部歌曲/文件夹/歌单/搜索；256与512；无图与坏图；快速滚动、反向滚动和切页；播放器大图/背景/转场；10分钟循环后主进程、renderer内存与队列是否持续增长。浏览器打桩测试只能验证前端生命周期，不能证明Tauri asset协议可用。

基础命令以实际脚本为准：

```powershell
npm run build
npm run lint
cargo check --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run tauri build
```

前端测试按仓库现有 `.test.mjs`/browser harness 的执行方法运行目标集，新增用例必须给出可复跑命令；不要虚构 `npm test`。既有失败先在本轮基线复现并记录，不能照抄旧“386/25通过”或据旧记录直接豁免。

性能对照使用同机器、同WebView2、同release配置、同音乐语料/顺序、同窗口/DPR/布局、同滚动脚本，记录预热状态；不以不同音乐目录的数据作为对照。按实际AppPaths解析缓存根，离线准备两套隔离缓存或受控快照，不批量删除用户真实缓存。

分别测试：无缩略图冷生成、已有各自缩略图但新进程、同会话热重开；背景预热两组同时关闭或同时完成。各场景至少5次，交替版本顺序，报告首张与首屏全部封面可见p50/p95、滚动停止后补齐耗时、主线程长任务、路径/回落次数、IPC字节和进程内存。OS页缓存、WebView缓存不能受控时明确限制，不把同会话热状态叫完全冷启动。

正确性硬门槛：无永久loading、无错误封面/随机缺图、失败可回落且有界、播放器无回退。收益门槛先登记基线噪声范围：热场景改善应超过重复测量波动；冷场景或内存若明显变差需解释并暂停默认启用。2600倍只是估计载荷比，不是速度目标；冷路径仍有Rust解码和WebView解码，JS转BMP也不能算一次图片解码。

## 9. 备选、回滚与实施交付

采用方案：保留像素通道，新增路径命令，先接通一条真实消费者链，再逐步推广。直接返回现有 `.spxr` 无法让WebView解码；整体恢复旧提交会带回上述静态缺陷；全替换播放器图片通道超出范围；先增并发不能解决发布断链，均不采用。若最小路径仍无法稳定发布，保留像素默认并提交可复现证据，不扩散到全部hook。

回滚分两层：运行开关关闭路径后，新作业直接走像素，进行中作业按当前性结算；构建回滚使用保存的基线产物/commit或按阶段revert，不要求在有未提交内容时checkout develop。先停用路径再恢复SPXR预热，保存诊断记录。

保留统一预算逻辑时遗留JPEG正常计入并可淘汰；连预算逻辑一起回退时，JPEG成为漏记账存量，旧代码不会继续生成它们。确需清理时，关闭应用并核实实际缓存根，只清受管缩略图JPEG，不碰原封面 `audio/covers`、音乐源或其他用户数据。

交付给下一位实现者的结果应包含：

- 当前与基线commit、分阶段改动及文件owner；不要只给一个大补丁。
- 上述静态缺陷的回归用例、实际停止阶段与修复因果证据；未证实项明确列为假设。
- 各阶段自动化命令/结果，真实WebView2截图或录屏及结构化耗时；区分已跑、待跑和打桩边界。
- 同条件性能对照、缓存状态、回落/熔断观测、内存趋势、已知限制。
- 由相应owner更新旧OPT记录、决策补充和实测指引的状态与新证据；本方案不代替这些历史文档的状态修正。
- 可执行的路径关闭方法和构建回滚点；未满足真机门槛时明确“未完成验证”，不宣称优化完成。
