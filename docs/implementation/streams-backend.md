---
doc_id: "IMPL-STREAMS-BACKEND"
title: "流地址、播放列表导入与网络音频后端实现"
doc_type: "implementation"
status: "active"
owner_agent: "Rust/Tauri Agent"
version_scope: "project"
created: "2026-11-06"
updated: "2026-11-06"
source_documents:
  - "user request: 实现流根页面，同时支持添加地址、导入和真实播放"
  - "docs/architecture/streams-library.md"
  - "src-tauri/src/library_streams.rs"
  - "src-tauri/src/audio/network.rs"
  - "src-tauri/src/audio/network_tests.rs"
  - "src-tauri/src/audio/stream_runtime_tests.rs"
---

# 流地址、播放列表导入与网络音频后端实现

流根页使用独立的 JSON 地址注册表；本地 M3U/M3U8 导入可同时保留本地文件和 HTTP(S) 条目。实际播放由 HTTP 工作线程、现有 Symphonia 解码器和 Rodio 输出链路完成，添加、导入、恢复和列表展示均不访问网络。

## 命令和保存位置

| 命令 | 输入 | 成功结果 |
| --- | --- | --- |
| `library_get_streams` | 无 | `AudioFolderPlaylist`，空集合合法 |
| `library_add_stream` | `{ input: { url, title? } }` | 更新后的流集合 |
| `library_remove_streams` | `{ input: { ids } }` | 更新后的流集合 |
| `audio_import_playlist` | 原有文件选择流程 | 本地/网络混合播放列表 |
| `audio_load_and_play` | 原有 `{ input: { path, requestId, initialPositionMs? } }`，`path` 可为 URL | 原有播放结果与状态 |

注册表为应用数据目录中的 `library-streams.v1.json`，包含版本、URL、标题和首次创建时间。规范化协议、主机并移除片段，保留路径和查询参数的大小写语义。地址拒绝非 HTTP(S)、用户凭据、控制字符、反斜杠和超过 8192 字节的规范 URL。无标题时显示完整 URL；重复地址更新有效标题，保留 ID 和首次创建时间。自定义名称上限为 1024 字节，完整 URL 回退名称使用地址的 8192 字节上限；添加、导入和恢复使用同一校验规则，长签名 URL 不会产生下次无法读取的注册表。

保存采用互斥、临时文件、同步落盘和原子替换。损坏或未来版本的注册表返回 `LIBRARY_STORAGE_ERROR`，不能被当作空集合覆盖。删除根页成员仅移除注册表关系，不删除文件或其他播放列表中的 URL 快照。

流聚合源为 `sourceKind='streams'`、`sourcePath='streams:library'`。曲目描述符追加可选 `sourceKind`、`title`、`createdAtMs`，本地曲目的已有序列化保持兼容。URL 的 ID 由规范地址稳定派生，根页、导入列表和播放结果使用相同身份。

## 导入和恢复

导入支持 UTF-8 的 `.m3u` 和 `.m3u8`，读取 `#EXTINF` 逗号后的名称，忽略其声明时长。HTTP(S) 条目无需文件扩展名，也不在导入时探测可达性。本地条目的路径边界和可用性校验沿用现有实现。

播放列表注册表增加可选的条目标题，旧版本文件仍可读取；URL 不再通过 Windows 本地路径大小写折叠。导入列表的快照可在源 M3U 文件改变或删除后恢复。流注册表只聚合网络条目，再次导入可以恢复此前从根页移除的地址。

## 传输、解码和取消

依赖固定为 `reqwest 0.13.4`，关闭默认特性，启用 `blocking` 和 `rustls`。保持正常 TLS 验证，最多跟随五次重定向，并限制重定向目标为不含用户凭据的 HTTP(S)。连接和每次无进展读取超时均为五秒；它不是整个直播连接的五秒总寿命。

HTTP 读取和 Symphonia 解码在专用工作线程执行。PCM 通道固定为八块、每块最多 4096 个 `i16` 样本，队列容量为 64 KiB；生产者和消费者各持有一块，另有 HTTP、探测器和解码器内部缓冲。数据不会随直播持续时间完整积累或落盘。满队列时产生背压，音频消费端使用非阻塞读取；短暂欠载输出静音，错误和超时最终进入 `Error`。

首个 PCM 数据就绪后才返回播放准备成功。停止、换曲和本地文件替换使取消令牌及 epoch 立即失效；准备等待每十毫秒检查取消。即便停止发生在新网络会话登记之前，重建源也会观察到旧 epoch。阻塞读取中的后台线程最多等待当前五秒网络超时，调用方无需等它退出。取消使用不可重试的 IO 结束错误，避免 `Interrupted` 被底层 `read_exact` 反复重试。

运行时持有当前会话状态的强引用，生命周期与当前 generation 一致。因此，Rodio 丢弃耗尽的源之后仍能读取中途传输错误，不会将断流变成正常 `Ended`。同 URL 的并发准备分别保存取消令牌，旧会话不能被新地址映射覆盖。

网络源统一 `durationMs=null`，不支持非零 seek；初始位置及重建位置固定为零，包括从 `Error` 重试。暂停保持当前连接和有界背压；停止后播放重新连接。解码过程中若声道数或采样率变化则明确失败。空音频、HTTP 状态错误、读超时、传输截断均有错误结果；对于声明精确帧数的 PCM 容器，还检查实际解码样本是否完整。合法有限容器可以在音频帧完成后结束，无需为检查 EOF 继续读取尾部元数据或填充。

## Tauri 线程边界

所有等待音频 runtime 回复的 IPC 入口均为异步命令，并通过统一的 `with_audio_controller` / `spawn_blocking` 执行阻塞等待，包括加载、播放、渐变播放、暂停、停止、seek、音量、状态和当前曲目查询。系统打开文件使用现有 rfd 的异步原生对话框，选定路径后的 runtime 调用同样进入工作线程。状态轮询不会占住 Windows webview IPC 主线程，阻止停止和换曲命令进入后端。

Play 和渐变 Play 在异步入口捕获取消 epoch，并传入控制器；旧的排队重建不能借新 epoch 绕过已发生的取消。原有 load-and-play 请求 ID、generation 和提交栅栏继续抑制过时结果。

## 验证证据

实现阶段执行结果：

- `cargo check --manifest-path src-tauri/Cargo.toml --locked`：通过。
- 全量库测试：364 项中 357 通过、0 失败、7 个显式忽略；其中三项新设备测试由下面的独立命令实际执行。
- 本地真实 HTTP 测试：九项，覆盖非零 WAV PCM、持续超过五秒的传输、无进展超时、慢首帧取消、同 URL 多会话取消、HTTP 404、传输截断、完整 HTTP 但 PCM 帧截断、合法尾部填充。
- 注册表及混合导入测试：四项，覆盖离线添加、规范身份、标题/创建时间、跨注册表恢复、关系删除、损坏保护及超过 1024 字节的签名 URL 无名称往返。最后的长 URL 校正只重跑注册表针对测试与编译检查，没有为此重复全量库测试。
- 真实 OS 输出设备与 Rodio 测试：三项显式执行，覆盖网络播放、暂停、停止、重播、本地替换、中途错误持续保留、普通/渐变重试以及慢重播取消。测试音量为零，但实际创建 OS 输出流并消费生产解码源。

复现命令（顺序执行，避免 Cargo 构建锁竞争）：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib audio::network::tests -- --test-threads=1 --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib library_streams::tests -- --test-threads=1 --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib stream_runtime_tests -- --ignored --test-threads=1 --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib -- --test-threads=1
```

设备测试被标记为 opt-in，因为它们要求真实可用的系统音频设备；显式执行时设备缺失会失败，不会伪装通过。网络测试不需要互联网或第三方电台。浏览器的 mock IPC 验收与本地 HTTP/Rodio 证据分别记录于 `docs/test/streams-library.md`。

## 当前边界

首次验收的网络实证使用确定性的 WAV fixture；下节补充用户实际 HTTPS AAC 电台及自有合成 AAC 的缺陷修复验证。解码路径复用既有格式能力，仍未逐一实证每种压缩格式或外部电台。HLS、PLS、远程播放列表展开、ICY 元数据、动态鉴权、自定义请求头/Cookie、网络 Range seek、自动重连和直播续播不在本次实现内。

## SomaFM MPEG-2 ADTS 缺陷修复

用户地址 `https://ice5.somafm.com/groovesalad-128-aac` 返回 `audio/aac`，实际为 44100 Hz、双声道、MPEG-2 ADTS AAC-LC（帧头 `FF F9`）。锁定的 Symphonia 0.5.5 原 ADTS reader 仅探测和同步 `FF F1`。修复前，生产网络路径在 15 秒仍无首帧，只能由测试外部取消；有限捕获则扫到末尾后返回 `UnexpectedEof`。持续到达的输入不会触发五秒无进展超时，因此仅有该超时不足以限制首次准备。

新增私有的 `network_adts.rs` 只用于网络源：按 ADTS 帧长读取原始 AAC packet，接受 MPEG-2/MPEG-4、7 字节普通头和 9 字节带 CRC 头；跳过 CRC 字段，不修改 AAC payload，也不宣称执行 CRC 校验。使用既有 AAC 解码器，明确限制为 AAC-LC、单或双声道、单 raw data block。非法配置、帧内截断或中途参数变化均失败。普通本地文件仍使用原 reader，没有新增依赖或公共 DTO。

首次准备增加十秒总时限和 256 KiB 输入预算，在调用方等待与底层读取两处检查；首块 PCM 就绪后解除这两个准备限制。既有五秒无进展读取超时、有界 PCM、取消及旧 generation 栅栏保持生效。测试还确认取消后的解码 worker 实际退出。

修复后实现者执行结果：

- ADTS 专项四项通过，覆盖 MPEG-2/MPEG-4、CRC 头、单字节分段、payload 中伪同步字、配置及截断边界。
- 网络专项十二项通过、两个公网显式测试默认忽略；新增无后缀 MPEG-2 AAC 实际解码、持续无效输入的字节预算和慢速无效输入的总时限。
- 使用同一用户 HTTPS 地址的生产解码测试首帧约 693 ms，持续十二秒得到非零 PCM，取消后 worker 退出；有限真实捕获从修复前失败转为通过。
- 同一地址经实际系统音频设备和 Rodio 约 499 ms 进入 `Playing`，持续十二秒后完成暂停、恢复、停止及本地 WAV 替换。测试音量为零，实际输出流仍创建并消费音频。
- 原三项真实输出控制回归与 32 项 source 测试通过；依赖外部格式语料的既有条件测试仍受其原有环境条件限制，不据此宣称所有压缩编码已验证。

确定性的可分发 AAC 样本由本项目正弦 PCM 经 Edge WebCodecs 编码生成，来源与参数见 `src-tauri/src/audio/test-fixtures/README.md`。SomaFM 广播捕获仅留在临时目录，没有提交到仓库。

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib network_adts -- --test-threads=1 --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib audio::network::tests -- --test-threads=1 --nocapture
$env:SPMUSIC_PUBLIC_STREAM_URL='https://ice5.somafm.com/groovesalad-128-aac'
$env:SPMUSIC_CAPTURED_STREAM_FILE=Join-Path $env:TEMP 'spmusic-somafm-independent/sample.aac'
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib supplied_ -- --ignored --test-threads=1 --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib stream_runtime_tests -- --ignored --test-threads=1 --nocapture --skip supplied_
```

公网测试需要目标电台当时可达，不能替代可重复的本地合成回归。独立复验和前端加载锁、错误提示修复的证据由 Test Agent 记录于 `docs/test/streams-library.md`。
