---
doc_id: "ARCH-OPT-0018-V2-CLOSEOUT"
title: "OPT-0018 v2 收尾要求与提速实验方案"
doc_type: "architecture"
status: "proposed"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "用户请求：为 ds 撰写收尾要求、改进方案与可能更快的优化实验"
  - "docs/changes/optimizations/OPT-0018-v2-result.md"
  - "docs/architecture/opt-0018-reimplementation-plan.md"
  - "git baseline: 317ce85"
  - "src/features/player/hooks/useAllSongsWindow.ts"
  - "src/features/player/services/playlistCoverPathLane.ts"
  - "src-tauri/src/library_cover_warmup.rs"
---

# OPT-0018 v2 收尾要求与提速实验方案

## 1. 给 ds 的执行顺序

1. 记录当前 HEAD、未提交内容、构建配置与实际缓存根；本文基线为 `317ce85`，不恢复旧大补丁，不自动清理用户缓存。
2. 先完成第 3—5 节的 DOM 错误恢复闭环，补真实消费者回归；这属于正确性收尾，不能用新性能实验代替。
3. 按第 6 节修订结论报告，把已实现、已验证和未验证分开；保留全部原始数据与失败记录。
4. 按[配套验证与测量方案](../test/opt-0018-v2-closeout-and-performance-plan.md)重建动作起点和观测口径，先定位耗时占比。
5. 仅在对应瓶颈达到触发条件后，依次选择第 7 节的一个实验；每次一个变量，独立提交、测量和保留判定。
6. 提交正确性结果、性能结果和回滚点。没有速度证据时，可以提出保留资源收益，但不能将“封面明显更快”标为完成。

本文只定义待实施技术方案；不代表已运行测试、已补齐功能或已批准发布。原实现与三处静态缺陷修复继续保留，不顺手改并发、许可或播放器像素通道。

## 2. 已有能力与本轮边界

当前路径 helper 已覆盖命令、URL 构造、有界预加载、当前性复核及像素回落；命名选项 `isCurrent=true` 表示仍可发布。JPEG 与 SPXR 统一预算、Windows 普通绝对路径、落盘后返回及解码许可提前归还均已有实现。

`useAllSongsWindow` 已在 metadata 加载期间维持 `warmCount` 首屏预取；Rust 的 `load_track_thumbnail_path_blocking` 已经使用来源 fingerprint 与 `read_track_index` 命中，不应再次建议“新增来源索引”。`library_cover_warmup` 已生成 JPEG，也已有前台让路和输入去重。

剩余明确缺口是：预加载成功后，真实 DOM 图片仍可能加载失败。`AlbumLibraryPanel::AlbumCover` 没有错误报告；`useAllSongsWindow` 对相同 identity 的缓存行不再请求，回访只清 `transientFailure`，而 DOM 错误没有设置它。因此“下一次访问会重试”不是现有保证。

保持范围：列表 track/folder/playlist-cover 的现有命令族；播放器大图、canvas、背景、投影、SPXR 版本和字节契约不变。不新增依赖、数据库、持久化设置、权限或全库预生成。`MAX_CONCURRENT=4`、窗口并发 2、后端原许可上限和统一缓存预算保持。

## 3. DOM 反馈的最小契约

由资源 owner 发布不可变的图片展示快照，组件使用同一快照的 URL 与 token 报告结果；不得发生“显示旧 URL，却拿当前 store token 报错”。建议新增内部 TS 契约如下，名称可适配现有类型：

```ts
type CoverPresentationToken = {
  key: string
  identity: string       // 完整 descriptor 身份，包含 artworkRevision
  sessionGeneration: number // owner 生命周期标识；不是复用的裸递增数字
  publishGeneration: number // 同 owner 单调递增，每次实际提交均更换
  url: string
}
type CoverPresentation = {
  image?: PlaylistCoverImage
  src: string
  token: CoverPresentationToken
}
type CoverPresentationReport = {
  token: CoverPresentationToken
  actualUrl: string
  outcome: 'loaded' | 'failed'
}
// owner.reportPresentation(report): void；组件不得直接调用 IPC。
```

`sessionGeneration` 可用唯一会话 ID 替代数字；必须防止卸载后新 owner 恰好拥有同 key、URL、publishGeneration 而接收旧事件。新接口是前端内部展示契约，不改变 Rust 序列化或现有像素响应。

受理前同时校验 owner 仍 mounted、完整 identity 与 revision 未变、该 key 的当前发布代次及 URL 匹配；`actualUrl` 对比使用浏览器解析后的绝对 URL，不能用字符串截断匹配。元素已改 src、旧图片晚到事件、卸载、代次过期均忽略，不记熔断失败、不回落、不写无图缓存。

对初次挂载已缓存的图片，用 `complete && naturalWidth > 0` 补成功检查；确有当前源且 `complete && naturalWidth === 0` 时按失败受理，不能仅等可能已错过的事件。解码成功和呈现成功仍分开，禁止用 `markDecoded`、`data-loaded=true` 隐藏错误。

## 4. 一次强制像素补救及资源结算

### 4.1 状态与准入

每个发布记录保存 `pending | presented | recovering | failed`、已补救标志、来源 lane 和可用旧图。当前 `failed` 报告使路径发布进入 `recovering`，只允许一次补救；下一作业显式 `forcePixels=true`，直接使用原 pixels 调度入口，不再尝试 path，也不重新等待路径超时。

不能只调用现有 `pump()`：它会因缓存 identity 相同而跳过。需增加 owner 内部的恢复需求表或独立 recovery 队列，使其进入同一 admission/优先级/并发账本，并以当前发布 token 作为回填条件。普通 cache 命中仍保持原有行为。

像素命令选择保持来源语义：track/folder 用对应 256 原入口，512 hero 用原 playlist-cover pixels 入口。候选来源保留原顺序；可先补救产生当前图片的候选，失败后是否遍历后项沿用完整候选规则，整个展示故障只有一个有界恢复作业，不允许无限候选循环。

### 4.2 去重、取消与双失败

同一 owner/key/identity/publishGeneration 的多张 `<img>` 报错只受理一次；共享 URL 的其他 key 保留各自 token，不能只凭 URL 全局失效。多个发布引用同一 prepared 路径尝试时，共享一个 `attemptId`，由路径 helper 提供“已计失败”标记，避免重复扣熔断。

补救队列可以按同来源/尺寸/有效资源身份共享原生命令，但每个消费者独立检查 token。一个消费者卸载只取消自己的订阅，不能取消仍有效消费者；全消费者失效后晚到结果仅清理，不更新新发布。

路径预加载成功后 DOM 再失败，视为该尝试的一次真实失败；不能对同一次尝试反复 success/failure 计数。可扩展 helper 的内部 attempt 记录或返回不暴露实现细节的失败句柄；失效报告只扣一次。已有会话熔断不得被晚到成功重新开启。

像素补救成功：完成像素图片解码与当前性检查，再提交新代次、通知订阅；其 DOM 成功受同一 token 保护。路径原图不再作为当前缓存命中返回。

补救的命令/解码/DOM 再失败：结算为 `failed + transientFailure`，停止本次自动补救，展示已有可用旧图或正常占位，不能保留破图元素。记录失败阶段，不将失败说成“确认无封面”。

如果原像素预解码没有时限，恢复作业需增加仅用于该作业的有界等待与清理能力，不能扩大所有旧调用的超时，也不能仅 `Promise.race` 后允许晚到 Promise 发布。

下一次 owner 激活或条目从非需求重新进入需求时，失败记录可开启一个新 retry epoch；每 epoch 最多一次恢复。仍在视口时不因 pump/渲染重复触发。identity/revision 变化立即重置旧故障，显式重试可作为另一个新 epoch，不必新增产品设置。

### 4.3 旧图、对象身份与释放

新图片真实呈现前保留旧的已知可用资源及租约；替代失败还原旧图。若旧图本身就是报错 URL，不把它当可用回退图。原生图片的同元素升级仍沿用现有保留上一帧行为，不通过重置所有 loaded 状态制造闪白。

blob 的所有权只在成功提交时移交 owner；未提交、取消或被替代的 blob 恰好释放一次。仍被旧节点/转场使用的资源等待现有租约退役。asset URL 不 revoke，也不宣称卸载必然立即释放 WebView 内部缓存。

任何恢复 token、旧图和 attempt 记录均有 owner 生命周期及有限集合上限；结束后释放监听、计时器、abort 订阅与临时 Image，不能以永久 URL 黑名单代替一次恢复状态。

## 5. 文件落点与正确性出口

| owner / 文件 | 收尾内容 |
| --- | --- |
| Frontend：`hooks/useAllSongsWindow.ts` | 展示快照与 token、失败受理、绕过正常 cache 命中准入的强制 pixels 恢复、重访重试 epoch |
| Frontend：`components/AlbumLibraryPanel.tsx` | AlbumCover 原生 img 的 loaded/failed 与缓存 complete 检查；逐实例捕获展示快照 |
| Frontend：`components/PlaylistCoverImage.tsx` 及真实列表封面消费者 | 将当前自定义事件补足身份、代次和 URL；枚举字符串 src 与资源对象两类路径，防止只覆盖一类 |
| Frontend：`hooks/useLibraryArtwork.ts`、`hooks/useAudioPlayer.ts` | 对齐首次发布失败与升级失败；现有旧图还原不能代替首次发布补救；同一错误仅恢复一次 |
| Frontend：`services/playlistCoverPathLane.ts` | 可追踪 attempt 的一次失败升级、直接路径失败/回落计数；保留现有取消和熔断语义 |
| Frontend：`model/playlistCoverReadiness.ts`、必要共享类型文件 | 最小内部展示契约、readiness 清理；维持 decoded/presented 分离与 blob 守卫 |
| Test：相应行为与真实消费者测试 | 发布后删图/损坏、同 URL 多卡、旧事件、双失败、离开回访与 revision 变更；见配套验证方案 |

先列出现有各视图实际组件与 hook 的覆盖矩阵，再修改；搜索、全部歌曲、文件夹、歌单、专辑都须有明确入口。共享类型和全局事件协议由一位 Frontend owner 顺序修改，不允许不同 agent 各自扩字段。

正确性出口：对真实消费者注入“路径预加载已成功、DOM 随后失败”，能观察一次 pixels 调用和替代图；重复/旧事件为零额外调用；双失败终止为正常占位且队列归零；回访能重试；播放器大图、无图与取消语义无回退。未满足时正确性任务保持未完成，不进入全量默认启用验收。

## 6. 结论报告必须修订的表述

| 当前主张 | 应改为 |
| --- | --- |
| 解码 3 次降为 1 次 | 删除次数比较。冷路径仍有 Rust 解码与 WebView 解码；JS RGBA→BMP 是转码 |
| 主线程 CPU 确定减少多少 | 确认移除了逐像素循环；CPU 时间和占用须采样，不能由循环次数直接换算 |
| 0 SPXR 决定性证明零回落/整链健康 | 文件存量与 URL 来源是旁证；直接统计 pathFailure、fallbackStarted/completed、DOM失败与终态 |
| 端到端时延数据 | 标明原脚本是在动作后等待、DOM出现后计时的观察窗口；新增动作前起钟数据单列，旧数据保留 |
| F1 没有性能回归 | 本次样本未观察到明确回归；不能用同一噪声数据排除小幅或慢盘回归 |
| 清空临时 Image.src 必然再解码 | 尚未测量；WebView 可能复用内部缓存，不作确定断言 |
| 正确性全部验证 | 指定已测视图/语料与未测错误恢复、慢盘、高 DPI、长时内存，补齐后再收尾 |
| 三批/四批、候选提交/产物混用 | 每批固定源码 commit、实际补丁、构建命令、产物摘要；最终压力数据与对应版本一致 |
| 回滚后遗留 JPEG 无界增长 | 是漏记账存量，旧代码不会继续生成；清理需确认实际 AppPaths，不能硬编码用户目录 |

回滚说明使用保存的基线产物或隔离 checkout/按提交 revert，先检查工作树；删除分支不是必要步骤，不以强制删除为标准操作。

## 7. 提速实验：先找瓶颈，再单独修改

以下均为假设，不承诺收益。按 E1—E3 排查瓶颈，但只实施有证据的一项；公共采样、p50/p95、取消和内存门槛见配套验证方案。每项先跑未修改控制组，确认改善超过成对测量波动，冷态尾延迟与正确性不能恶化。

### E1：稳定首屏与全局 metadata 门控解耦

**现状落点**：`useAllSongsWindow` 已有加载期间首 `warmCount` 项预取；`AlbumLibraryPanel.tsx` 的 `loading` 仍令 `visibleAlbums=[]`，并用“正在读取”替代列表。不能把现状误报成封面请求完全等待 metadata。

**触发证据**：动作→首屏可见中，metadata/集合就绪等待占主要部分；首屏图已准备而列表迟迟未挂载。记录 metadata 开始/结束、稳定 descriptor、mount 与 DOM ready，区分“数据尚未存在”和“已有稳定数据但被全局 gate 隐藏”。

**最小改变**：仅当当前 route/epoch 的成员关系、排序、key 与 artworkRevision 已稳定时，用独立 `firstScreenReady` 允许该稳定快照挂载；未完成的非关键字段稍后更新。若归组/排序仍依赖未读标签，则先完善该视图的稳定就绪契约，证据不足不实施，不能用扫描临时顺序抢跑。

**保留约束**：不伪造摘要完成，不显示错误集合，不修改曲目身份/选择/焦点/滚动恢复；扫描切换、rescan、导入和排序变化使快照失效。涉及共享摘要契约时，需先补单独架构差异说明与测试再动实现。

**回滚**：恢复该视图原显示门控，hook 已有首屏预取保持不变；保留测量日志。此实验潜在影响最大，但契约风险也最高，不与其他实验同时上线。

### E2：同一曲库 epoch 的后台预热去重

**现状落点**：`useAudioPlayer::enqueueCoverWarmup` 对单次 playlist 做 Set，再切 256 批；不同调用间队列没有去重。`library_cover_warmup::warm` 的 seen 也只覆盖本次调用。JPEG预热、Rust来源索引和前台让路已经存在。

**触发证据**：同 epoch 多次 restore/summary/选择操作使相同 source/edge 重复入队，后台 attempted 远大于独立 source 数，且与前台关键阶段 IO/排队重叠。单纯发现重复但没有前台竞争，不宣称这是加载主因。

**最小改变**：在前端预热 queue 增加有界 `pending/inflight/completed` 键 `{epoch,sourcePath,edge,artworkRevision或重扫代次}`，跨入队调用合并；只对明确成功/确认无图记录 completed，失败不永久抑制，取消与 epoch 变更清空。保留一批串行执行和 Rust 前台优先。

**保留约束**：不跳过 rescan 后变化来源，不让 negative 缓存跨修订，集合上限随现有会话预算受控；不加后台并发，不改变 writer/解码许可。若只有来源路径而没有修订依据，则只合并 pending/inflight，不能长期缓存 completed。

**回滚**：撤销去重表即可恢复原入队方式；验证未减少必要的新图生成。分别测前台时延与后台请求/磁盘读取，不把后台工作量减少直接当首屏提速。

### E3：有界会话路径引用提示，减少重复 IPC

**现状落点**：各 hook 有自己的展示缓存，scheduler 仅合并含 clientId/generation 的进行中作业；Rust来源索引减少回源读取，却不免除 invoke。预热命令目前只返回计数。先测跨 owner 或前端条目淘汰后的重复 invoke，不能再造已有磁盘索引。

**触发证据**：热场景同资源/revision/edge 的请求多次 IPC，且排队+IPC占可见图关键时段明显比例；若只剩 WebView 图片解码占主导，跳过本实验。

**最小改变**：优先只在前端路径 helper 增加小型会话引用提示表，键为 `{sourceKind,完整规范化来源,libraryEpoch,artworkRevision,edge,JPEG版本}`，值为已校验的 path/真实尺寸/文件字节数；命中仍进行取消检查与受控预加载。仅在本轮强制 pixels/DOM恢复正确后试验；不缓存 DOM成功状态或无限保留 Image。

**保留约束**：没有可靠 revision/epoch 与来源变化依据的来源不复用；原后端每次读取 source fingerprint，缓存提示不能绕开这项新鲜度保证。必须由已有扫描/观察机制提供足以识别外部修改的权威来源修订或 fingerprint；若没有，保留 invoke，本实验暂不实施，不能仅把旧 revision 当文件未变证明。禁止跨 source 复用。变化、元数据/identity更新、预加载失败和 DOM失败立即失效。folder需含根与目录修订；playlist-cover依既有封面文件身份，不与track键混用。提示表有限 LRU、会话结束清理，不写数据库/磁盘，不以 URL 长期可靠为前提。

共享进行中准备时，消费者的取消只退出自身，不取消其他消费者；无需为第一次实验合并跨会话 native 调度。首次优先实现已完成引用的复用，避免同时改变 scheduler admission。复用失败走一次 pixels，不能借机重试path循环。

**回滚**：关闭提示查询与写入，回到原 invoke+Rust索引命中；无需改变磁盘缓存。对比 IPC次数字节、引用失效率、预加载/补救次数、renderer内存与动作起点时延。

### E4（可选）：全组确认无图结果的有限复用

`useAllSongsWindow` 的 track-candidates 已按顺序遍历，missing继续下一项，且整项展示结果已有缓存。只有大量全组无图项、重新访问时原展示缓存已淘汰、重复 missing IPC 确为关键路径时才试验，不能声称现有代码完全没有无图缓存。

可在更小的有限会话表记住 `{完整候选组identity/revision,全部候选来源身份,edge}` 的**全组确认无图**结果，仅在所有有效候选都确认missing时写入；有任何异常/取消不记负缓存，revision/epoch变化立即清除。必须确认现有修订机制可捕获任一候选文件、兄弟图或目录封面的变化；否则不做该缓存。不能竞速选“先完成的候选”、不能新增并发、不能把首个异常当整组无图。

测量每组尝试数、missing往返与首张可见时间；若省掉往返但负缓存失效成本更大则回滚。撤掉该表即可恢复既有串行选择，不能与 E3 同一轮合包比较。

## 8. 提交拆分、Owner 与交付

建议顺序提交：①展示 token/DOM受理及强制pixels闭环；②真实消费者与竞态/回访测试；③报告证据与测量脚本归档；④每个通过触发条件的实验单独提交。测试可与对应实现同提交，但不得把所有实验装入正确性修复。

Frontend Agent 唯一持有前端实现和共享展示类型；Rust/Tauri Agent 仅在实测发现必要后端改动时介入，不能顺手重构 decoder/writer。Test Agent 独立执行验证，保留失败数据。文档 owner 更新各自记录，不修改 Agent 提示词、Sprint 或发布批准状态。

交付包含：基线/产物/commit与补丁摘要、每视图入口矩阵、错误注入触发步骤与请求/发布轨迹、精确命令/结果、未覆盖项、成对原始数据、内存趋势、实验保留或撤回理由及关闭方法。

正确性收尾与性能结果分别判定：前者全部出口满足才可称错误恢复完成；后者没有超过噪声的时延证据就写“资源收益成立、速度收益未证实”。是否基于资源收益保留实现由产品决策，不让架构文档代替发布批准。
