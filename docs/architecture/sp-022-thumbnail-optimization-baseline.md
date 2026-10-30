---
doc_id: "ARCH-SP-022-THUMBNAIL-OPTIMIZATION-BASELINE"
title: "播放列表缩略图三阶段优化与测量契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "SP-022 顺序优化实验"
created: "2026-10-20"
updated: "2026-10-20"
source_documents:
  - "user request: 清理诊断探针，提交并推送基线，然后依次优化 IO、后端转换、前端获取并实测"
  - "docs/architecture/sp-022-backend-cover-concurrency-safety.md"
  - "docs/architecture/playlist-artwork-loading.md"
  - "docs/test/sp-022-playlist-performance-baseline.md"
  - "docs/test/sp-022-backend-cover-concurrency-safety-verification.md"
  - "src-tauri/src/audio/source.rs"
  - "src-tauri/src/audio/metadata.rs"
  - "src-tauri/src/audio/cover_cache.rs"
  - "src-tauri/src/audio/cover_pixels.rs"
  - "src/features/player/hooks/useAudioPlayer.ts"
---

# 播放列表缩略图三阶段优化与测量契约

## 摘要

按 IO、转换、前端获取顺序推进，每阶段冻结独立前后版本并实测。第一阶段新增只读取封面的轻量命令，第三阶段才切换真实列表消费者；第二阶段保持后端 N=1、前端视觉槽 2，比较列表专用转换算法。当前默认 N=1 安全基础继续保留，历史旧候选约 1.95 倍吞吐不能作为新实现收益。

本文件冻结实现边界与验证条件，不代替 Test Agent 的结果，也不改变任务或产品验收状态。架构写入范围仅本文。

## 背景与证据边界

- 2026-10-20 的 83 张固定封面、256px Rust Release 冷派生缓存基准中，整批转换段约 5.66–5.93 秒，占冷响应约 96%；read/hash/lookup 整批约 91–95 毫秒。这是 Rust 代理，不是 UI 延迟；转换段尚未分解到完整解码、方向、缩放、RGBA 与打包，不能把 96% 单独归给 Lanczos3。
- 同次热轮约 100–114 毫秒/83 张。热命中仍读取原图并对实际字节 BLAKE3，不允许仅信任文件名或 mtime 替代内容身份。
- 0N 的真实 UI 未覆盖位置 n=91，可见至自身 load 为 p50 969 / p95 1645 毫秒；应用内首次访问不等于磁盘冷。0F 的历史约 86% 视觉排队仅是 2026-10-03 样本，不能直接视为当前分段。
- 0L 已发现 0J/0K 逐帧几何观察器明显增加任务时间。正式新基线不用每帧全卡几何轮询，不继承旧插桩分段占比。
- 本机 image 0.25.10 的 JPEG decoder 公共实现未暴露缩放参数。原生 JPEG 缩放是备选研究方向，不能假定现有泛型 decoder 已支持，也不得为此顺带新增 codec 依赖。

## 范围、所有权与固定不变量

1. Rust/Tauri Agent 独占阶段一、二的后端写集：`src-tauri/src/lib.rs`、`src-tauri/src/audio/controller.rs`、`mod.rs`、`types.rs`、`metadata.rs`、`cover_cache.rs`、`cover_pixels.rs`，以及必要的新封面源模块。只修改实际需要的文件，不因列入写集扩大任务。Cargo/lockfile 不新增依赖。
2. 阶段三 Frontend Agent 独占 `src/` 的服务、类型映射、视觉与元数据消费；共享自动生成类型须在后端写入结束后顺序交接，不并发覆盖。
3. Architecture、Test 默认只读源码；Test 的报告/测试路径由协调 Agent 明确授权。协调 Agent 负责阶段整合、版本冻结及最终检查。
4. N 固定 1，视觉并发固定 2；播放器大图通道、音频播放、窗口 generation、SPXR v1、128/256/512 档位、输入/解码/输出上限、flight 与请求数量边界、writer 双限、Object URL 所有权保持有效。
5. 不增加网络、任意文件下载、资产协议、目录访问权限或用户配置。不在本次引入列表全量封面解码、持久化索引、全库后台预热或默认 N=2。

## 阶段一：减少取得封面源的 IO

### 数据与命令契约

新增只供列表视觉需求使用的异步命令，建议名 `audio_probe_playlist_cover`：

```ts
type AudioProbePlaylistCoverInput = { path: string }
type AudioPlaylistCoverSource = {
  id: string
  sourcePath: string
  coverArt: AudioCoverArt | null
}
// Promise<AudioPlaylistCoverSource>，失败沿用 AudioCommandError。
```

`id/sourcePath` 使用现有轨道身份规则，供前端逐请求核对；不返回播放可用性、时长、标题或歌词的伪造结果。`AudioCoverArt` 沿用现有 MIME、filePath/dataUrl、byteLen 字段，禁止把局部结果伪装成完整 `AudioTrackRef`。

### 后端行为

- 调用既有音频输入及普通文件校验；用 Lofty 读取当前标签，优先 primary tag，缺失时 first tag，封面选择与现有 CoverFront/首图规则一致。支持的格式与路径范围不超出现有 hydrate。
- 不调用 `open_source`、`decode_duration`、完整 `read_metadata` 或歌词解析；不读旁挂 `.lrc`。可以关闭 Lofty 的不必要 properties 读取，但不能像 summary 通道那样关闭 cover art。
- 首版不缓存音频源解析结果，每次读取当前标签。源文件下一次更改后必须取得新封面；不引入 path+mtime 的热缓存，避免同路径同长度同 mtime 内容变化导致误命中。像素缓存仍以实际读取封面字节哈希为身份。
- 选中封面后先检查既有 16 MiB 输入界，再落入现有 `audio/covers`；超过限制按明确错误返回，不能生成巨大 data URL。标签解析器内部暂存不等于受此输出上限约束，不宣称整个解析 RSS 有硬限。
- 缓存根来自 AppPaths，文件名由内容哈希派生。新命令不得接受封面输出路径；写入不得跟随符号链接/非普通文件或越界根。不可安全落盘时可沿用有界 data URL 回退；列表必须保留与旧实现一致的无 filePath 回退行为。
- 无标签、无封面是成功的 `coverArt:null`；打开/读取失败及无法解析不能伪装成确定无封面。映射既有 `FILE_NOT_FOUND/UNREADABLE_FILE/UNSUPPORTED_FORMAT/INTERNAL_ERROR` 等，具体映射由 Rust 实现说明列明并由 Test 核对。
- 使用独立的一个源解析活动槽，阻塞闭包持有许可直至真实读取完成；调用方取消不得提前归还许可。最多 32 个请求持有名额，满额返回既有错误且不创建工作，禁止无界排队。命令对源解析不额外建立长期常驻调度器。
- 源解析不推进像素窗口 generation；过期结果由前端现有 epoch/scope/normalized path/trackId/generation 检查丢弃。命令内部取消不把已开始的 IO 当成已终止；写成的内容寻址缓存不代表允许过期 UI 发布。

### 阶段隔离与验收

本阶段不改视觉消费者，因此不能宣称 UI 已变快。以相同音频集合对旧 hydrate→取 coverArt 和新 cover-only 代理交错至少五对，记录总响应、标签读取、封面缓存写入/复用与失败数。区分源解析冷启动、OS 温态和封面文件已存在；输出封面字节身份/选择一致，不读取歌词、不启动音频解码，不以日志路径输出私人数据。

测试至少覆盖无标签/无封面、不同格式、首选封面、源内容替换、坏文件、越界/链接目标、不可写缓存回退、超过封面上限、调用方取消后活动槽仍被占用、满额拒绝及释放后恢复。不得改变旧 hydrate 命令的输入、完整响应或行为。

## 阶段二：列表专用转换优化

### 候选与选择

先用合成图片与固定真实封面分解完整解码、方向处理、预降采样、最终缩放、RGBA 与打包。N=1、源取得方式与前端完全冻结，才能判断收益是否来自单张转换。

首选候选是在大幅缩小时做快速整数/面积预降采样至至少目标的 2 倍，再做最后一级 Lanczos3；小图和缩小比例不足的图继续原路径。实现可用已安装 image 库的 thumbnail/相关 API，但必须核对其真实算法、尺寸与极端比例，不以函数名宣称质量等价。预降采样后仍需末级 Lanczos3，保持最终尺寸、纵横比、不放大、方向与 alpha 语义。

这不保证与直接 Lanczos3 逐像素等价。必须对 128/256/512 档的照片、人脸、文字线条、棋盘/高频、透明边缘、长宽极端比例和 EXIF 旋转生成并排/差分证据，由 Test 独立检查明显模糊、锯齿、边缘光晕与透明色污染。若收益不超配对波动或质量不可接受，保留直接 Lanczos3。直接 Triangle/最终快速 thumbnail 不是默认退路，须单独报告质量取舍再决定。

JPEG 原生缩放若现有依赖没有公开能力则本轮不落地；不得绕过解码输入/尺寸上限、方向信息和输出协议以追求速度。

### 兼容与版本

- 只在列表路径选择新的变换策略。共享 `decode_and_pack` 若抽出策略参数，播放器 256–3072px 大图继续原有策略；不能因 maxEdge 恰好 256/512 就误选列表策略。
- 任何影响像素结果的列表算法变化都提升 `THUMBNAIL_TRANSFORM_VERSION`，包括 flight key 与磁盘文件名的一致升级，避免命中旧结果。SPXR v1 字段和磁盘格式版本本身不因此改变。
- `sourceWidth/sourceHeight` 表示方向校正后原始尺寸，不能被中间预降采样尺寸覆盖。保持所有 session 复检、错误类别、损坏缓存回源与 writer 交接位置。
- 旧/新转换五对配对使用隔离派生缓存，分别比较 128/256/512 冷批次、热命中、各子阶段、峰值内存及结果完成率。新缓存版本造成的首次重建须列作迁移成本。
- N=2 仍为受限研究候选。单张算法无收益不自动批准 N=2；需另补当前安全结构性能、大图峰值与长期资源证据。

## 阶段三：前端取得与消费

阶段一、二定稿后再接入新命令。只改变视觉作业的封面源取得方式，保持两槽、档位、优先级、预取范围与传输格式不变，避免同时引入调度调整。

```text
视觉需求 → cover-only 源 → 既有列表像素命令 → BMP/Object URL → Image.decode → 发布
元数据需求 → 既有完整 hydrate / summary / duration 通道 → 各自完整结果提交
```

- 不再要求新视觉作业等待完整 hydrate。metadata 应沿用既有独立有限队列，不因 cover-only 成功而写入“已完整 hydrate”缓存。标题、时长、歌词、格式和不可播放判定仍由原通道负责。
- 先核对文本与卡片 metadata 原本依赖视觉 hydrate 的消费者。移除该依赖时必须为当前需要的元数据安排原有队列，避免封面快了但文本永久占位或不可用曲目失去判定。不能假称“有封面就能播放”。
- 新旧结果以相同 trackId、规范化源路径、playlist epoch/scope、视觉 generation 和后台 windowGeneration 验证；取消后丢弃迟到结果，不回写新列表。source/probe 错误与 pixel 错误分开分类，沿用有限重试，不把纯视觉错误标成音频不可播放。
- 保留无封面 fallback、升级失败时旧图、URL 交接及逐消费者引用所有权；生成 URL 后 stale/error 必须释放，已被其他消费者使用的 URL 不能提前撤销。
- 128→256/512 升级可复用同一有效视觉作业已取得的封面源，但不得新增跨源编辑长期不失效的 path 缓存；现有驻留生命周期结束后重新探测。源编辑与列表刷新规则按原入口执行。
- 阶段三先固定两次命令结构，量化“轻量源替代完整 hydrate”的净收益；合并成一次 source→pixel 复合命令作为另一个单变量备选，不在本阶段同时实施。只有跨层测量证实命令开销仍主要时才评审复合响应和错误边界。

## 测量与基线协议

1. 协调 Agent 先清除全部临时诊断源码与运行态，再记录干净提交、exe/dist 哈希、依赖锁、WebView2、素材 digest、布局、DPR、窗口、进程与缓存定义；当前 N=1 安全基础属于基线本体，不能误删。
2. 每阶段保存不可覆盖的前/后版本，原始记录放任务专用目录并附匿名清单及摘要。应用/profiles/数据目录必须确认实际隔离，不能仅设置未被支持的环境变量就宣称隔离；不得删除用户原图、媒体或正式派生缓存。
3. 至少区分派生缓存冷、磁盘缩略图热但前端未驻留、前端驻留重访。OS 冷若未控制须直接写明。五对交错顺序，固定样本与客户端并发；代理不外推 UI。
4. 正式 UI 采用同布局、慢连续滚动、快滑后停止、反向/面板重开、固定位置首次访问；冻结可见目标集合，按 panel 与 dock 真实裁剪。记录每卡可见到自身原生 load、完成/错误/删失、已经就绪单列；load 与最终淡入/paint 区分。
5. 默认不用逐帧全卡几何轮询。一次可见快照配少量已挂载目标观察与容器原生事件；测量任何新增观察器都要同构建开关对照。必要的阶段计时优先测试程序或默认关闭/有界/匿名的临时入口，测完整体撤除并重建验证。
6. 报告 Rust 队列、读取、哈希、缓存、转换子阶段、写入入队，与前端命令等待、BMP、decode、发布分别计时；不从不同样本分位数相减，不把等待视为 CPU 时间，不把 CDP 自定义 IPC 生命周期当 Rust handler。
7. 同步记录 Rust/Renderer/GPU 内存、受管 URL/像素与在途数量、缓存文件/字节、帧间隔。快返后最终完成率、失败回退与长期回落不能被吞吐平均值替代。

## 取舍、回退与验收

无源缓存的 cover-only 比 mtime 缓存更保守，也更容易独立验证；仍需每次标签 IO，但先消除与封面无关的首帧、时长、歌词工作。前置降采样减少高代价最终滤波，代价是质量变化与首次缓存失效；不以默认放宽并发转移为内存风险。保持 SPXR/BMP 避免协议迁移扩大变量，后续仅按实测选择。

每阶段必须提供可复算配对数据、契约回归、收益与剩余限制。收益未超过波动、出现源变化误命中、错误被吞、可见封面永久不完成、URL 生命周期回归、明显质量下降或资源不能回落时，回退该阶段并保留证据。正式性能门槛由 PM/协调 Agent 依据用户目标与新基线确定，架构不以历史 20% 或旧 1.95 倍预设通过。

下一负责 Agent：Rust/Tauri 实施阶段一、二；Frontend 实施阶段三；Test 各阶段独立验证；协调 Agent 顺序整合、冻结提交与最终验收。
