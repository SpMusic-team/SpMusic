---
doc_id: "DEC-2026-08-05-OPT-0001-ASYNC-TRACK-PARSING"
title: "架构决策：音频加载解析拆分到独立 worker"
doc_type: "decision"
status: "accepted"
owner_agent: "Architecture Agent"
version_scope: "v0.1"
created: "2026-08-05"
updated: "2026-08-05"
source_documents:
  - "docs/changes/optimizations/OPT-0001.md"
  - "docs/architecture/real-audio-playback.md"
  - "src-tauri/src/audio/controller.rs"
  - "src-tauri/src/audio/runtime.rs"
  - "src-tauri/src/audio/source.rs"
---

# 架构决策：音频加载解析拆分到独立 worker

## 状态

已接受

## 背景

音频 runtime 是单线程 actor（`AudioRuntime`），所有请求经 mpsc 队列串行处理。`LoadFile` 在该线程内同步完成 `hydrate_track_ref`（容器探测、时长解码、元数据与封面读取，均为重 I/O），期间 `Pause`、`Seek`、`SetVolume`、`GetState` 全部排队等待，可能阻塞数百毫秒到数秒。前端播放中每 500ms 轮询一次状态，加载期间表现为 UI 卡顿与状态滞后（见 `docs/changes/optimizations/OPT-0001.md`）。

## 决策

采用「独立解析 worker 线程 + 代际号（generation）防串曲」方案，命令契约与事件契约保持不变：

1. 新增一个解析 worker 线程，只执行 `hydrate_track_ref`，解析完成后通过 runtime 通道回传 `TrackParsed` 消息。
2. runtime 线程收到 `LoadFile` 后不再同步解析：先失效旧轨道、置 `phase=Loading`、立即广播状态，再把解析请求（携带自增 generation）发给 worker；随后继续处理控制类消息。
3. worker 完成解析后回传 `TrackParsed { generation, path, result }`；runtime 线程仅在 generation 与当前待加载代际一致时应用结果（`Ready` / `Error`），否则丢弃，防止并发加载串曲。
4. 命令契约不变：`audio_load_file` / `audio_open_file` / `audio_open_source` 仍返回 `AudioTrackRef`，controller 仍阻塞等待 reply（此时阻塞的是 Tauri command 线程，音频线程保持空闲）。
5. 加载期间（`phase=Loading`）：`Pause`、`Seek` 为 no-op 返回当前 Loading 状态（不再返回 `NO_TRACK_LOADED`）；`SetVolume` 与 `GetState` 正常可用。
6. 并发 `LoadFile` 防护：若新加载到达时仍有未完成的旧加载，旧调用方收到可恢复 `INTERNAL_ERROR`（消息说明被更新请求取代），新加载正常进行；不加新错误码，保持前端契约零改动。
7. 事件契约不变：`LoadFile` 受理后立即广播 `Loading` 状态，`TrackParsed` 应用后广播 `Ready` / `Error` 状态；事件 payload 仍为轻量 `AudioPlaybackState`。

## 消息契约

```rust
pub(crate) enum AudioRuntimeRequest {
    LoadFile {
        path: PathBuf,
        reply: Sender<Result<AudioTrackRef, AudioCommandError>>,
    },
    // 新增：解析 worker 回填
    TrackParsed {
        generation: u64,
        path: PathBuf,
        result: Result<AudioTrackRef, AudioCommandError>,
    },
    // ...其余既有变体不变
}

pub(crate) struct TrackParseRequest {
    pub generation: u64,
    pub path: PathBuf,
}

// AudioRuntime 新增状态
pub(crate) struct AudioRuntime {
    // ...
    pending_load_generation: Option<u64>, // 当前待加载代际
    load_generation: u64,                 // 单调递增代际计数器
}

// 新方法（取代同步 load_path）
impl AudioRuntime {
    pub(crate) fn start_load(&mut self, path: &Path) -> u64;
    pub(crate) fn complete_load(
        &mut self,
        generation: u64,
        path: PathBuf,
        result: &Result<AudioTrackRef, AudioCommandError>,
    ) -> bool; // false 表示代际不匹配（stale），已丢弃
}
```

controller runtime 循环新增局部 `pending_load: Option<PendingLoad>`，记录代际、路径与 reply 通道，作为「当前待完成加载」的权威：

```rust
struct PendingLoad {
    generation: u64,
    path: PathBuf,
    reply: Sender<Result<AudioTrackRef, AudioCommandError>>,
}
```

## 加载期间控制语义

| 命令 | Loading 期间行为 |
| --- | --- |
| `audio_get_state` | 立即返回 `phase=loading` 状态 |
| `audio_pause` | no-op，返回 `phase=loading`，不报错 |
| `audio_seek` | no-op，返回 `phase=loading`，不报错 |
| `audio_set_volume` | 正常更新音量并返回 `phase=loading` 状态 |
| `audio_play` | 返回 `NO_TRACK_LOADED`（当前无可播放轨道） |
| `audio_stop` | 返回 `idle`（当前无轨道），但不取消在途加载 |

## 备选方案

- 方案 A：解析拆到独立 worker（采用）。彻底解除阻塞；加载与控制并行；为后续解析缓存与预加载（OPT-0002、OPT-0008）预留边界。
- 方案 B：阶段式异步加载。保持单线程但把 `LoadFile` 拆成多阶段并在间隙处理控制消息；改动侵入 `load_track_ref_with_options` 调用链，大文件仍长期占用音频线程，收益有限。
- 方案 C：仅前端体验兜底。不改后端线程模型，只在前端展示加载态；控制请求仍排队，属于掩盖问题，不作为最终方案。

## 取舍理由

- 命令契约保持返回 `AudioTrackRef`，前端 `audioCommands.ts` 与 `PlayerShell.tsx` 无需改调用形态，风险最小。
- 代际号放在 runtime 状态机（`start_load` 分配、`complete_load` 校验），controller 只做待加载簿记，职责清晰。
- 单 worker 串行解析满足当前「单资源播放 + 临时队列」范围；线程池属于过早设计，留待 OPT-0008 队列收敛时再评估。
- 不加新错误码：前端已有 `audioBusy` / `audioSelectionInProgress` 防护，重复加载基本不会发生，`INTERNAL_ERROR`（可恢复）足够兜底。

## 影响

- 正向：加载期间暂停/快进/音量/状态查询不再被阻塞；前端可展示真实 `loading` 状态（后端现在会在加载开始即广播）；为解析结果复用（OPT-0002）与后端队列（OPT-0008）铺路。
- 负向：加载命令的 reply 延后到解析完成（与现状相同，仍由 command 线程等待）；解析 worker 新增一个线程；同文件并发解析未做去重（属 OPT-0002 范围）。
- 残留风险：`play()` 的 `rebuild_sink` 中 `open_source` 仍在 runtime 线程执行（属于开始播放的开销，非加载路径）；`audio_hydrate_track` 仍在 command 线程同步解析（不影响音频线程，OPT-0002 范围）；解析 worker 是单线程，极端的连续换曲会产生至多一个过期解析任务被浪费。

## 回滚条件

- 若出现加载完成状态与用户操作时序错乱（如加载完成后误覆盖用户暂停/音量意图），优先回退 `complete_load` 的生成匹配逻辑；仍无法修复则整体回退到同步 `load_path`（保留本决策文档，标注 Superseded）。
- 若解析 worker 引入不稳定（panic、通道关闭处理缺失），可先改为 controller 内联同步解析并保留消息骨架。

## 关联文档

- [OPT-0001](../changes/optimizations/OPT-0001.md)：本决策对应的优化需求。
- [real-audio-playback.md](../architecture/real-audio-playback.md)：架构说明，已同步新增「异步解析 worker」章节。
- [OPT-0002](../changes/optimizations/OPT-0002.md)：解析结果复用与重复解析问题，与本次 worker 边界衔接。
- [OPT-0008](../changes/optimizations/OPT-0008.md)：播放队列收敛后端，worker 线程池/预加载的后续演进。
