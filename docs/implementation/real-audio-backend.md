---
doc_id: "IMPL-REAL-AUDIO-BACKEND"
title: "真实本地音频播放后端实现说明"
doc_type: "implementation"
status: "active"
owner_agent: "Rust/Tauri Agent"
version_scope: "v0.1"
created: "2026-07-24"
updated: "2026-07-25"
source_documents:
  - "docs/architecture/real-audio-playback.md"
  - "docs/tasks/sp-016-rust-tauri-real-audio-backend.md"
---
# 真实本地音频播放后端实现说明

## 当前实现

v0.1 后端新增一个最小音频播放后端，只管理当前会话中的单个本地音频资源，不建立媒体库、数据库、播放列表、网络存储或插件能力。

Tauri managed state 保存 `AudioController`。`AudioController` 通过 channel 与专用音频线程通信，专用线程独占 `AudioRuntime`、`rodio::OutputStream` 和 `rodio::Sink`。这样可以避开 `rodio` / `cpal` 在 Windows 下音频输出对象不能跨线程 `Send` 的限制，同时让 Tauri command 边界保持可共享、可调用。

实现文件：

- `src-tauri/src/audio.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`

依赖：

- `rodio`：负责解码与系统音频输出。
- `rfd`：负责原生文件选择。
- `windows`：Windows 原生 Core Audio 设备通知回调。

## 已注册 Tauri command

- `audio_open_file(input?: AudioOpenFileInput) -> AudioTrackRef`
- `audio_load_file(input: AudioLoadFileInput) -> AudioTrackRef`
- `audio_play(input?: AudioPlayInput) -> AudioPlaybackState`
- `audio_pause() -> AudioPlaybackState`
- `audio_stop() -> AudioPlaybackState`
- `audio_seek(input: AudioSeekInput) -> AudioPlaybackState`
- `audio_get_state() -> AudioPlaybackState`
- `audio_get_current_track() -> AudioTrackRef | null`

## 状态事件

后端在检测到输出设备变化并释放旧输出流后，会通过 Tauri 全局事件主动推送当前播放状态：

- 事件名：`audio_state_changed`
- payload：`AudioPlaybackState`

前端可以使用 `listen<AudioPlaybackState>("audio_state_changed", ...)` 立即接收后端状态变化。该事件用于减少耳机插入、拔出或默认输出设备切换后的 UI 延迟；`audio_get_state` 仍保留为轮询和兜底同步接口。

## 状态模型

后端返回 `AudioPlaybackState`，字段与 `docs/architecture/real-audio-playback.md` 保持一致：

- `phase`
- `currentTrackId`
- `positionMs`
- `durationMs`
- `volume`
- `error`

`AudioPlaybackState` 是高频实时 DTO，只包含播放阶段、当前歌曲 ID、进度、时长、音量和错误。封面、歌词、标签和本地路径属于低频歌曲详情，不得放入 command 返回的实时状态、`audio_state_changed` 事件或进度轮询响应。

`audio_open_file` / `audio_load_file` 在选歌时返回完整 `AudioTrackRef`。前端重连或丢失歌曲详情时，才调用一次 `audio_get_current_track` 恢复详情。控制 command 在线程内先回复轻量状态，再广播轻量事件，避免事件序列化阻塞 command round trip。

`positionMs` 由已累计播放时间和当前播放起点实时计算；暂停时固定当前位置，继续播放时从当前位置恢复；停止时回到 `0`。

## 输出设备变化处理

输出设备变化由独立 `AudioDeviceWatcher` 层负责，播放 runtime 不直接轮询设备。

当前策略：

- Windows：优先使用原生 Core Audio `IMMNotificationClient`，注册到 `IMMDeviceEnumerator`，响应 `OnDefaultDeviceChanged`、`OnDeviceAdded`、`OnDeviceRemoved`、`OnDeviceStateChanged` 和 `OnPropertyValueChanged`。
- Fallback：非 Windows 平台，或 Windows 原生 watcher 初始化失败时，退回 500ms 输出设备签名轮询。

Watcher 只发送内部 `OutputDeviceChanged` 消息，不直接修改播放状态。所有播放状态变更仍在专用音频线程内完成。

当检测到输出设备变化时：

- 如果正在播放，后端保存当前位置并切换为 `paused`。
- 后端停止并释放旧 `Sink`、`OutputStreamHandle` 和 `OutputStream`。
- 后端立即发送 `audio_state_changed` 事件，payload 为当前 `AudioPlaybackState`。
- 下一次 `audio_play` 会用当前系统默认输出设备重新创建输出流，并从保存的位置继续播放。

这可以避免耳机插拔后继续绑定旧输出设备。残余限制是：部分 3.5mm 模拟耳机可能在 Windows / 声卡驱动层仍表现为同一个 WASAPI endpoint；如果系统没有触发 Core Audio endpoint 事件，也没有暴露任何可检测的设备或配置变化，后端只能在下一次重建输出流时跟随系统路由。

## 错误处理

后端返回稳定错误码，前端业务判断应使用 `code`，不要依赖 `message`：

- `USER_CANCELLED`
- `NO_TRACK_LOADED`
- `INVALID_PATH`
- `FILE_NOT_FOUND`
- `UNREADABLE_FILE`
- `UNSUPPORTED_FORMAT`
- `PLAYBACK_INIT_FAILED`
- `PLAYBACK_FAILED`
- `UNSUPPORTED_OPERATION`
- `INTERNAL_ERROR`

## 验证记录

- 2026-07-24：首次 `cargo check` 因当前 Windows 开发环境缺少 MSVC linker `link.exe` 阻塞。
- 2026-07-24：补齐工具链后复跑，发现 `rodio::OutputStream` 不能作为 Tauri managed state 直接跨线程共享；已改为 `AudioController` + 专用音频线程模型。
- 2026-07-24：`cargo check` 已通过，输出为 `Finished dev profile`，无 warning。
- 2026-07-24：新增默认输出设备变化检测；设备变化时自动暂停并释放旧输出流，继续播放时重建到当前默认输出设备。`cargo check` 通过。
- 2026-07-24：新增 `audio_state_changed` Tauri 全局事件；设备变化释放旧输出流后主动推送当前 `AudioPlaybackState`。`cargo check` 通过。
- 2026-07-24：将设备变化检测抽象为 `AudioDeviceWatcher` 层；Windows 使用原生 Core Audio `IMMNotificationClient`，fallback 才使用 500ms 轮询。`cargo check` 通过。

SP-016 的代码编译验证已完成；一次本地音频人工播放验证由 SP-018 继续覆盖。
