---
doc_id: "ARCH-OPT-0018-V2-CORRECTION-EXECUTION"
title: "OPT-0018 v2 增量纠正执行方案"
doc_type: "architecture"
status: "proposed"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "用户请求：为 ds 撰写复核后修订执行方案"
  - "docs/architecture/opt-0018-v2-closeout-and-optimization.md"
  - "docs/test/opt-0018-v2-closeout-and-performance-plan.md"
  - "docs/changes/optimizations/OPT-0018-v2-result.md"
  - "git baseline: f72d2e0958316393262584a79b79c1f13c70677a"
  - "src/features/player/hooks/useAllSongsWindow.ts"
  - "src/features/player/hooks/useAudioPlayer.ts"
  - "src/features/player/hooks/useLibraryArtwork.ts"
---

# OPT-0018 v2 增量纠正执行方案

## 1. 给 ds 的执行顺序

本文补充[原收尾技术方案](./opt-0018-v2-closeout-and-optimization.md)与[原测试方案](../test/opt-0018-v2-closeout-and-performance-plan.md)，不重做 JPEG 路径迁移。本轮先修三处正确性差异，再纠正测量证据；默认不开展 E1—E4 新性能实验。

1. 固定基线 `f72d2e0` 的完整 hash，保存工作树状态与隔离构建方式，保留用户无关修改。
2. 先增加会在当前基线失败的回归：已 loaded 后再 failed、另外两个真实 owner 的强制 pixels、256/512 双档位与双失败停止。
3. 将三个 owner 对齐第 3 节契约，分别给出红→绿证据；不能只复制辅助函数测试。
4. 按第 6 节绑定真实测量产物，重算同资源同档位数据，补直接事件计数；旧表保留并标明不能支持的主张。
5. 完成真实 WebView2 代表性错误注入，填写第 8 节验收表；未执行项目明确列为证据不足。

本文件是待实施方案，不表示修复已完成。并发、许可、后端 SPXR/JPEG 契约、缓存预算与 `$CACHE/**` 权限继续保持，不新增依赖、数据库或设置项。

## 2. 本轮必须纠正的三项事实

| 编号 | 基线证据 | 必须改变的行为 |
| --- | --- | --- |
| C1 | `useAllSongsWindow.ts` 的 report 只接受 `presentationState === 'pending'` 错误；loaded 已将它变成 presented | 当前图片先成功、随后在复挂载等场景失败，仍能触发一次恢复；不能把 presented 当永久无故障 |
| C2 | `useAudioPlayer.ts::onImageError` 仍按 URL 匹配，清 visual 后普通重新准入；正常作业仍优先 path | 必须校验完整 token，并创建显式强制 pixels 作业，不以重复 path 请求冒充补救 |
| C3 | `useLibraryArtwork.ts` 仅 256 分支使用 forcePixels，512 仍走 path；标志准入后即删除，后续错误可重新设置 | 256/512 均跳过 path，保留已消费的恢复 epoch，双失败不会再次自动入队 |

C1 已用现有真实 hook harness 在内存追加反例独立复现：`demand → report loaded → report failed → 期待 pixels=1`，实际为 0；原有 16 项通过。当前新增 contract 测试只加载 `useAllSongsWindow`，不能为其他 owner 作证明。

本轮不要仅把 C1 的条件删掉：若没有恢复 epoch 与去重，重复 DOM 错误会变成无界重试。三个 owner 必须完整落实同一组不变量。

## 3. 三个 owner 共用的展示与恢复契约

沿用现有 `CoverPresentationToken` 和不可变展示快照，不引入另一套 URL-only 协议：

```ts
type RecoveryIdentity = {
  ownerSession: number // 现有 sessionGeneration，跨卸载不复用
  key: string
  identity: string     // 完整来源描述，包括 artworkRevision
  epoch: number       // 重试机会；不是每次 publish 的编号
}
type RecoveryState = {
  attempted: boolean
  phase: 'idle' | 'queued' | 'running' | 'awaiting-dom' | 'settled'
  failedPublishGeneration: number
  failedUrl: string
}
```

以上为内部状态示意，可复用现有类型，不改原生命令序列化。每次发布更换 `publishGeneration`；组件的 src 与 token 必须来自同一个快照。错误受理同时核对 owner session、mounted、key、完整 identity/revision、当前 publishGeneration、发布 URL 和浏览器解析后的 actualUrl。

当前 path 发布处于 pending 或 presented 时都允许报告失败。复挂载使用同一缓存发布，不意味着资源一直可读。旧 session、旧代次、同 URL 但其他 owner/key、已改变 src 的事件必须忽略；不驱逐当前新图，不计失败，不调 IPC。

同一恢复 epoch 仅允许一次自动 pixels 补救。首次合格 path 错误以同步状态转换占用 queued 标记，多个 img 随后同时报错只被吸收一次；实际准入时设置 attempted。新发布 pixels 图片不能清除该标记，load 成功也不能删除已消费记录以重新获得机会。

恢复机会只在以下事件打开：完整 identity/revision 改变；owner 的新生命周期；需求确实离开后再次进入；产品已有的明确重试操作。不得由每次 render、pump、DOM load 或单纯新 publishGeneration 自动重置。

需求离开期间的在途作业必须按原取消/身份语义结算。重入发生于旧作业尚未结束时，旧 epoch 不能回填新 epoch；先使旧 token/epoch 失效，再按新需求准入。共享原生请求的一个消费者取消不得取消其他有效消费者。

路径尝试先预加载成功、随后 DOM 失败应对 attemptId 升级计失败一次；同一尝试被多个 key/组件使用不能重复扣熔断。已熔断会话不因晚到成功重新开启。取消、过期和确认无图继续不计真实失败。

## 4. 强制 pixels、失败结算与资源释放

恢复需求使用显式 `forcePixels`/lane=pixels，进入原 scheduler、优先级和活跃账本；绕过“相同 identity 已缓存”和 path helper。清掉 visual 再调用普通需求函数不满足此契约。

| 来源与档位 | 强制恢复使用的既有入口 |
| --- | --- |
| track/candidate 256 | `scheduleTrackThumbnail`，保留当前候选来源 |
| folder 256 | `scheduleFolderThumbnail`，保留 rootPath/directoryPath |
| playlist-cover/hero 512 | 原 `schedulePlaylistCoverPixels`，保留已校验封面文件身份 |

512 准备封面文件身份仍可复用既有 probe，但不能再调用 thumbnail_path。恢复候选遍历保持原选择顺序，不竞速选图；整个恢复作业有界，禁止 path↔pixels 循环。

恢复过程：当前 path failed → queued → running → pixels 预解码 → 新发布 awaiting-dom → loaded/settled。pixels 命令、预解码或其 DOM 再失败时，一律终止本 epoch，写 transientFailure 并显示可用旧图或正常占位，不能保留破图元素或永久 loading。

全失败不等于确认无封面；不能写永久 negative 缓存。下一次符合第 3 节的重试触发可重新尝试，但仍在视口时不能因 transientFailure 自动循环。缓存淘汰不能在仍需求相同时隐式丢掉 spent 记录并重获机会。

旧图只可来自 DOM 确认成功的快照，排除这次 failedUrl；替换真实就绪前保留原租约。新结果发布时转交资源所有权，未发布 blob 结算释放一次，转场仍使用的旧 blob 按租约退役；asset URL 不 revoke。

恢复专用解码有界并清理监听、timer、abort 与临时 Image；晚到完成不能标就绪或发布。三个 owner 都要做到 active/queued 只结算一次，卸载后恢复队列与 attempt 引用收敛，不为每个 owner 各写一套不一致规则。

## 5. 具体文件与回归覆盖

| owner/落点 | 修改要求 |
| --- | --- |
| Frontend：`hooks/useAllSongsWindow.ts` | 受理 presented 后的当前失败；把已消费恢复记录与“DOM load 成功”解耦，补复挂载及新 epoch 保护 |
| Frontend：`hooks/useAudioPlayer.ts` | 发布 token/快照、校验事件、独立强制 pixels 准入；替换现有按 URL 普通重试计数方案 |
| Frontend：`hooks/useLibraryArtwork.ts` | 完整 token 与恢复 epoch；256/512 共用 force 选择，保留 spent；升级还原与首次补救按同一身份检查 |
| Frontend：`model/playlistCoverReadiness.ts`、`services/playlistCoverPathLane.ts` | 复用展示接口与 attempt 计数；只补所需状态，不改变像素/路径外部返回契约 |
| Frontend：实际 img 消费者 | `PlaylistCoverImage`、AlbumCover 及调用方传当前快照；过渡期 URL-only 事件不得触发新恢复状态 |
| Test：三个真实 hook harness 与组件测试 | 各 owner 独立运行，参数化其支持的 256/512 来源；辅助 helper 测试作为补充 |
| Test/指定测量工具 owner：`tools/thumbnail-benchmark/` | 补第 6 节证据绑定与事件计数，测量代码独立提交 |

必测矩阵：

1. **红→绿反例**：path 发布后先 loaded，再同 token failed；预期恰好一次 pixels，path 次数不增加。加入离屏复挂载但缓存 identity 不变的真实消费者场景。
2. pending 首次失败、presented 后失败、同一发布多 img 同时报错，均至多一次；同 URL 不同 owner/key 不误伤。
3. 新 publication 已提交后旧 token 再失败、同 URL 新代次、旧 owner 卸载再挂载，都零额外恢复。
4. pixels 预解码成功但 DOM 再失败、命令失败、超时、取消/晚到：停止本 epoch，不破图、不循环；留在视口多次 pump 没有额外请求。
5. 真正离开/回访、revision 改变、新 owner：获得新机会；旧在途请求不能回填。分别覆盖 256、512 正确入口，不只断言“某个 IPC 被调用”。
6. 每个支持视图的实际组件完成 complete/naturalWidth 补判；占位无图不伪装 loaded，不调用 pixels 再证实一次无图。

测试必须使用三个真实 hook 的生产决策，只替换 React/DOM 边界和原生执行。禁止只改 import 条数、放宽断言或让 mock 自己决定 forcePixels，以制造通过。

## 6. 必须纠正的测量证据与计数缺陷

每个数据目录绑定实际运行产物：完整源码 commit、工作树差异摘要（含未跟踪源文件）、完整隔离补丁及 digest、锁文件 hash、构建命令/配置、dist 摘要、二进制 SHA-256、脚本 hash、语料 manifest、cache/profile 状态。启动前重新计算实际启动绝对路径的产物 hash，预期 manifest/hash/补丁任一不匹配立即停止，不计样本；mtime 仅辅助记录。并列记录进程路径及运行时 CDP URL/custom-protocol 事实。

构建后不得继续修改源码而只更新报告中的 commit；旧 manifest 不明的产物标历史证据，不能用于新修复验收。旧 final2 仅可作工具 smoke，不能验收新的 DOM 修复。优先比较同一父提交的收尾前后快照；两臂评分合并、补丁等非目标差异必须明确。

IPC 比值必须比较同资源、同 maxEdge、同缓存态和阶段的匹配请求。786,552 B 与 518 B 若来自不同请求数量/档位，不能称“单张约1500倍”；分别列每命令请求数、完成数、在途、匹配覆盖率、未匹配原因/字节、逐请求长度与集合总量。CDP decodedBytes 只称观测响应载荷，encodedDataLength、请求体与 asset JPEG 读取另列；未经协议证明不能称完整 wire 开销，不排除失败/缺图项制造高比值。

这是本轮第 4 项必须修复的事实错误：现有计数函数的动态反例已显示，folder path→pixels 被计 0，不同 client 独立两 lane 被误计 1。不能只修改报告措辞。不要用“同 key 同时出现 path/pixels”作为唯一回落真值；由实际尝试与恢复出口直接记录 pathStart/Ready/Missing/Failed、fallbackStarted/Completed/Failed、DOMFailure、stale/abort、breaker，网络命令仅交叉核查。

事件至少带 ownerSession、clientId、generation、attemptId、发布代次（若有）、来源类型与规范化来源摘要、edge、lane、恢复 epoch、原因和终态；恢复作业有独立 recoveryAttemptId 并指向 parentAttemptId，共享原生请求另有 requestId。无需为旧 Rust 命令增加 traceId，可在前端调度边界关联。folder 键含 rootPath/directoryPath；track 用 sourcePath，playlist-cover 用 filePath，各含有效 revision/epoch；沿用现有来源规范化，不自创小写语义。

在待新增 `tools/thumbnail-benchmark/coverlane-counting.test.mjs` 验证：folder 同根目录回落=1；不同 client 独立两 lane=0；同目录不同 root 分离；512 playlist-cover；共享 native 多 subscriber；pathReady 后 DOM 补救=1；stale/abort=0；补救失败/超时有终态；同 key 重试新 attempt 不合并；测量窗口结束仍在途不能丢失或算成功。原生命令次数与消费者次数分列，事件重复不多计。

新数据继续动作前起钟、固定目标 cohort、滚动空白暴露及合法无图占位分开；一个 A/B pair 只检验脚本能否工作，不构成统计性能结论。本轮不以新比值或小样本重新宣称速度改善。

## 7. 提交顺序与验证命令

建议四个阶段小提交：A 三项失败用例与真实 owner harness；B 三 owner 契约和恢复修复；C 测量绑定/计数与对应校验；D 新证据与报告状态修订。每个文件同阶段只有一位写 owner；共享类型与事件协议由同一 Frontend owner 顺序修改。

FrontEnd/Rust 专项变更由相应实现 Agent 完成，Test Agent 独立复跑红→绿与关键真机子集。未发现必要后端改动时，不顺手重构 writer/decoder；不改 Agent 提示词、Sprint 或发布状态。

```powershell
node --test src/features/player/hooks/coverPresentationContract.test.mjs src/features/player/components/playlistCoverElement.test.mjs src/features/player/services/playlistCoverPathLane.test.mjs src/features/player/services/playlistCoverScheduler.test.mjs
npm run build
npm run lint
cargo check --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run tauri build
```

新增 AudioPlayer/LibraryArtwork harness 必须在交付中给出真实执行命令；上面的现存 contract 文件不能代替它们。基线既有失败需独立复现，新失败不得归入既有债。回滚采用保存产物或按提交 revert，不强制删除分支，不清用户音乐和缓存。

## 8. 交付包与验收表

交付一份入口报告：每 owner/档位的测试ID与实际命令、红→绿日志、失败注入轨迹、源码/补丁/产物清单、直接事件计数、原始数据与重算脚本、回滚点、未执行项目。历史表中仍冲突的“已补齐/未实现”“CPU确定收益”“无性能回归”等表述按证据修订，不能只在末尾追加免责声明。

| 项 | 允许结论 | 必备证据 |
| --- | --- | --- |
| 三 owner 恢复契约 | 通过/不通过/证据不足 | C1—C3红绿、256/512、旧事件、多img、双失败、回访 |
| 真实 WebView2 恢复 | 同上 | 隔离受管 JPEG 真删除/损坏，当前src/事件轨迹与恢复截图 |
| 产物与计数可信度 | 同上 | 产物SHA/源码与补丁绑定、直接尝试事件、同口径字节明细 |
| 功能/缓存/权限回归 | 同上 | 无图/坏图、各视图、大图与转场、取消和队列收敛 |
| CPU与10分钟内存 | 通过/不通过/证据不足 | 进程CPU时间与长时曲线；仅实现开关不算完成 |
| 速度改善 | 改善/退化/未证明 | 达到原测试方案成对样本与预登记门槛后才判定 |

未做的真实删图/损坏/慢盘注入、无图坏图 fixture、≥1000独立封面、高DPI、后端分段、CPU与10分钟内存继续列为证据缺口。不得将“计划补齐”写成完成；本轮先完成正确性与证据纠正，再决定是否执行原 E1—E4。
