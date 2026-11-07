---
doc_id: "ARCH-STREAMS-LIBRARY"
title: "流根页面与网络播放最小完整链路"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-05"
updated: "2026-11-06"
source_documents:
  - "user request: 按 Figma 实现流根页面，并同时实现添加地址、导入和真实播放"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=9244-12914"
  - "docs/architecture/poweramp-streams-view.md"
  - "docs/audio-compatibility/indexed-seek-and-ffmpeg-fallback.md"
  - "src-tauri/src/audio/source.rs"
  - "src-tauri/src/audio/symphonia_source.rs"
  - "src/features/player/components/PlaylistLibraryPanel.tsx"
---

# 流根页面与网络播放最小完整链路

## 范围与结论

本次交付流根页、手动添加 HTTP(S) 地址、本地 M3U/M3U8 文件中本地曲目与 HTTP(S) 条目的混合导入、持久恢复，以及既有音频解码器支持的网络直链真实播放。歌曲列表直接复用现有 `PlaylistCard`，页面继续复用分类标题、选择、搜索、布局和控制栏。

仓库没有生产用 FFmpeg 后端。现有 FFmpeg 只用于生成测试语料，不能将本次实现称为复用了 FFmpeg 播放能力。采用受限 HTTP 传输与现有 Symphonia 解码链路，继续使用 Rodio 输出。允许新增与现有锁文件版本协调的直接 `reqwest` 依赖，关闭默认 feature、启用所需 blocking 与 rustls TLS feature；不添加外部解码器进程。

本次不包括远程播放列表 URL 展开、HLS、PLS、动态鉴权 Provider、自定义 HTTP 头/Cookie、ICY 曲目元数据、网络封面搜索、自动重连、网络源 Range seek 或全量下载缓存。URL 自带的查询参数按原有语义保留。

## 共享数据契约

沿用现有 camelCase Tauri 序列化约定：

```ts
type AudioSourceKind = 'file' | 'stream'

// 在既有 AudioFolderTrackRef 上追加；旧本地描述符可省略新增字段。
type StreamDescriptorFields = {
  sourceKind?: AudioSourceKind
  title?: string
  createdAtMs?: number
}

// 在 AudioTrackRef 上追加 sourceKind?: AudioSourceKind。
// AudioFolderPlaylist.sourceKind 扩展为 'folder' | 'm3u8' | 'streams'；
// 前端原有 'custom' 继续保留。
```

流描述符的 `sourceKind` 必须为 `stream`，`sourcePath` 为后端验证并规范化的 HTTP(S) URL，`id` 由该 URL 稳定派生。URL 规范化可以规范协议与主机，必须保留路径、查询值的大小写与转义语义；禁止进入 Windows 路径归一化或整串大小写折叠。片段不发送给服务器，身份规则必须在添加、导入、恢复和播放间一致。无标题时使用 URL 作为可读回退，不伪造艺术家、专辑或时长。

独立的流聚合源是 `AudioFolderPlaylist`：`sourceKind='streams'`、`sourcePath='streams:library'`、`directoryPath=''`、`directoryName='流'`、`sourceName='流'`、`selectedIndex=0`。空 `tracks` 合法。使用既有 `playlistScope` 派生其 scope，即 `streams\0streams:library`。

流聚合源不加入 `library_get_playlists` 返回的播放列表管理集合。前端将其注册到既有 session playlist descriptor resolver，使现有队列选择能解析 scope/trackId。`PlaybackQueueOrigin.kind` 增加 `streams`，会话恢复与返回来源同步支持。

## 命令与持久化

| 命令 | 输入 | 返回 |
| --- | --- | --- |
| `library_get_streams` | 无 | 流聚合 `AudioFolderPlaylist` |
| `library_add_stream` | `{ input: { url: string, title?: string } }` | 更新后的流聚合源 |
| `library_remove_streams` | `{ input: { ids: string[] } }` | 更新后的流聚合源 |

后端独立 JSON registry 为手动地址和已导入流的管理权威，保存稳定 ID、规范 URL、可读标题、首次创建时间。重复添加或导入按 URL upsert，首次创建时间不变；新提供的非空标题可更新显示名。使用既有应用数据目录、互斥与原子替换模式，校验文件版本；损坏或未来版本不可被当作空集合覆盖。

添加、列出、恢复与列表展示均不得触网。URL 可保存但暂时不可达，`available` 表示本次允许尝试播放，不宣称网络已验证成功。地址输入限制为非空 HTTP(S)，拒绝非网络 scheme；错误不得携带完整带凭据 URL。HTTP 客户端跟随重定向也必须限制为 HTTP(S)，有有限次数与正常 TLS 证书验证。

混合导入沿用现有导入命令和 `AudioFolderPlaylist`，增加 `.m3u` 文件扩展名；解析 `#EXTINF` 标题，URL 无音频扩展名也可入库。文件本地条目继续使用原规则。导入不请求每个 URL。导入与持久化失败须返回错误，不报告未保存内容已经成功导入。

已导入播放列表的条目可以保留规范 URL 作为引用与恢复快照；没有地址编辑操作，因此无需双向同步两个可变 URL。流 registry 是流根页成员权威。删除流根页成员只移除此 registry 项，不删除物理文件，也不隐式删除其他播放列表中的引用。再次显式导入相同来源可重新加入根页。

## 播放、错误与生命周期

前端继续使用既有 load-and-play 命令，将 URL 作为 `path` 传入；后端先将输入解析为内部 `File | Stream` 源，再进入相应分支。URL 不得先转为 `PathBuf` 后丢失语义。加载结果和当前曲目携带 `sourceKind='stream'`，使用同一稳定 ID。流跳过本地路径校验、Lofty、歌词、文件封面、全量时长扫描等管线。

网络与解码由专用 worker 负责。阻塞 HTTP 响应读取和 Symphonia 解码不得发生在 runtime 命令循环或音频回调中。固定容量 PCM 队列限制预读内存；实现必须给出队列块大小与容量，并计入 HTTP/探测缓冲。禁止无界 channel、无限 Vec 或落盘累积整个直播。生产者满队列时等待且持续检查取消；消费者不等待网络数据。

Tauri IPC 层同样不得同步等待 runtime 回复。所有会等待 runtime channel 的命令（包括加载播放、播放/暂停/停止、播放过渡、seek、音量和状态/当前曲目读取）使用异步命令，并将阻塞的 controller 调用放入 `spawn_blocking`。首帧准备期间，状态轮询也不能占住 WebView IPC 主线程，否则后续停止和换曲命令无法进入 controller，工作线程内部的取消机制便无法由界面触发。异步包装保留既有命令名、参数与返回结构。

连接超时 5 秒、读无进展超时 5 秒，超时约束是每次无进展，不是直播累计播放寿命。初始首帧准备需要可取消等待，且在返回播放成功前至少成功解码第一帧。Stop、切换新曲目、替换 generation、销毁会话应从 controller 一侧立即使取消 token 生效，不依赖 runtime 消费 Stop 请求才取消。取消后调用方立即结束等待，阻塞 worker 最迟在网络超时内退出；旧 generation 不能提交状态、播放声音或发布迟到错误。

中途网络或解码失败通过与 generation 绑定的共享错误状态回到 runtime，必须进入 `Error`，不得将错误吞成正常 `Ended`。正常有限响应 EOF 可以 `Ended`；直播断线不自动重试。暂时队列欠载可输出静音，网络错误/超时最终必须停止并报告失败，不能无限静音假装仍可播放。

保持既有 `AudioCommandError` 形状。非法地址使用 `INVALID_PATH`，HTTP/网络/超时使用 `PLAYBACK_FAILED`，解码器不支持使用 `UNSUPPORTED_FORMAT`，seek 使用 `UNSUPPORTED_OPERATION`，换曲失效请求使用 `SUPERSEDED`；错误消息区分超时、HTTP 状态和解码失败，且避免泄漏地址中凭据。

所有网络源在本次统一为 `durationMs=null`、非 seekable，包括内容长度已知的有限文件。初始位置与会话恢复位置固定为 0；前端隐藏或禁用拖动进度和依赖 seek 的操作，后端也拒绝非零 seek，不能只在 UI 禁用。暂停仅暂停消费，固定缓冲会形成背压；恢复继续本连接，超过服务器容忍时长可能失败，用户可重新播放。停止释放会话，重新播放从源头/当前直播位置开始，不承诺自动续播。

## 前端列表与统计

`PlaylistLibraryViewModel.streamSongs?: readonly AllSongsItem[]` 独立于本地 `allSongs`。前端从流聚合描述符构造稳定行，复用 `PlaylistLibraryPanel` 的歌曲分支与 `AllSongsCard → PlaylistCard`，不复制歌曲列表。标题、空态、搜索、列表标签使用“流”。选择使用流 scope；不能误调用 `scope:null` 的本地全库删除或本地文件加入解析器。

专辑、艺术家、专辑艺术家、作曲家、流派、年份、本地文件夹、长曲目和本地最近添加统计的输入不包含流。全局搜索的流分类使用 `streamSongs`，不能一直返回空结果，也不能把流挤入本地歌曲分类。

六种排序的数据来源：

| 排序 | 真实来源与语义 |
| --- | --- |
| 名称 | registry `title`，无标题则 URL；同值以稳定 ID 排序 |
| 评分 | 既有用户反馈状态：喜欢、未标记、不喜欢三档；不能伪称已有五星评分 |
| 播放次数 | 既有前端持久 `mostPlayed` 记录，使用 URL-aware identity |
| 最近播放 | 既有前端持久 `recentlyPlayed` 记录 |
| 随机 | 一次生成后稳定的洗牌序列，不因封面/状态刷新反复跳动 |
| 添加时间 | registry `createdAtMs`，不是文件创建时间或每次恢复时间 |

流没有可用于“一半时长”判定的可靠 duration，播放次数/最近播放采用一次激活内累计实际处于播放状态达到 30 秒后记一次；暂停与加载时间不计入，换曲重置，恢复渲染与状态事件不能重复计数。沿用既有统计持久机制，反馈若当前仅会话保存，应清楚保持其现有语义，避免另建伪造评分数据。

## 所有权与验证

Frontend Agent 唯一写入 `src/**`，负责新命令 TS 映射、UI、URL-aware identity、源恢复/队列、选择/删除、流统计、输入排除与设计还原。Rust/Tauri Agent 唯一写入 `src-tauri/src/**`、必要的 `Cargo.toml/Cargo.lock`，负责 registry、导入、命令注册、类型、HTTP worker、取消、解码与错误语义。Architecture Agent 仅写本文。实现文档分别使用独立文件，禁止覆盖彼此修改。

Test Agent 独立验证：本地 HTTP fixture 真正返回音频且输出可播放；添加/重启恢复/混合导入/重复导入/大小写敏感 URL；纯流列表不被误报无可用本地文件；HTTP 错误、断流、慢首帧、无进展超时、停止和快速换曲无旧流复活；有限源/直播均无伪造 seek；内存与队列有界；本地歌曲和原播放列表回归。UI mock 只能验证页面，不能替代后端网络证据。

最终运行前端 build/lint、后端 cargo check 及与本次改动相关的单元/HTTP fixture/浏览器测试；测试报告记录实际依赖版本、内存队列参数、取消延迟与未覆盖的音频格式。
