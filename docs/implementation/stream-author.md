---
doc_id: "IMPL-STREAM-AUTHOR"
title: "流播放作者元数据实现"
doc_type: "implementation"
status: "active"
owner_agent: "Rust/Tauri Agent"
version_scope: "project"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - "user request: 若播放流成功时能看到作者，则把第二行展示的网址改成作者"
  - "src-tauri/src/audio/network_icy.rs"
  - "src-tauri/src/audio/network.rs"
  - "src-tauri/src/audio/runtime.rs"
  - "src-tauri/src/audio/controller.rs"
---

# 流播放作者元数据实现

播放请求启用 `Icy-MetaData: 1`，只有响应包含有效正整数 `icy-metaint` 时才进行 ICY 解复用。已有 HTTP reader 继续负责取消、5 秒无数据超时及 10 秒／256 KiB 准备预算，解复用器只在其上剥离元数据，原始音频交给既有解码器。单个元数据块最多 4080 字节，不缓存完整响应、不新增 HTTP 请求或依赖。

作者只来自有效 UTF-8 元数据中的 `Artist`、`StreamArtist`，或约定格式 `StreamTitle='Artist - Title';` 的非空左侧。明确作者字段优先；不将电台名、类型或只有歌曲标题的文本猜成作者。作者限制为非空、无控制字符且最多 512 字符。零长度元数据块表示无更新；出现新的、无法取得作者的 `StreamTitle` 时清空旧作者，前端回退网址。元数据截断记录播放错误，避免被解码器的 EOF 处理误当正常结束。

`StreamStatus` 的内部快照区分“尚未提供作者”与“明确清空作者”。runtime 仅处理当前播放或暂停会话的快照，以既有 `metadata.artist` 更新曲目；通过前端已有的 500 毫秒 `GetState` 轮询和 `GetCurrentTrack` 请求，在作者实际变化时发出既有 `audio_track_details_changed` 的 `ready` 事件。事件沿用当前成功播放的 requestId 和 generation，不由后来的选曲意图过滤；前端使用当前会话和 pending selection 保护，失败恢复时同步权威曲目。

迟到的静态详情会合并当前作者快照，controller 发送合并后的曲目。新连接从无作者开始，重启连接会通过同一变更通道清理旧作者；已停止会话的 worker 更新不产生作者事件。作者属于当前节目，不写入流注册表或电台名称缓存，不新增公共字段、命令或事件。

验证覆盖真实本地 HTTP 的 AAC 音频与交错元数据、解复用前后 PCM 逐样本一致、作者更新／零块保持／清空、截断元数据错误，以及 runtime 的迟到详情、重复值抑制、generation 与会话隔离。验证入口为 `cargo test --manifest-path src-tauri/Cargo.toml --lib network::tests -- --test-threads=1`、`cargo test --manifest-path src-tauri/Cargo.toml --lib network_icy` 和 `cargo test --manifest-path src-tauri/Cargo.toml --lib stream_artist`。本地 fixture 验证不等同于打包 WebView 与外部电台的端到端验收。
