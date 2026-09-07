---
doc_id: "DEC-2026-08-13-OPT-0002-LYRICS-CACHE-EMBED"
title: "架构决策：歌词缓存与显式内嵌歌词边界"
doc_type: "decision"
status: "accepted"
owner_agent: "Architecture Agent"
version_scope: "v0.1"
created: "2026-08-13"
updated: "2026-08-13"
source_documents:
  - "docs/changes/optimizations/OPT-0002.md"
  - "docs/architecture/lyrics-cache-and-embed-boundary.md"
  - "docs/architecture/real-audio-playback.md"
  - "docs/decisions/2026-08-05-OPT-0001-async-track-parsing.md"
---

# 架构决策：歌词缓存与显式内嵌歌词边界

## 状态

已接受

## 背景

OPT-0002 要求：歌词优先存入应用侧缓存（内存或后续持久化）；sidecar 歌词只读取、不写回音频文件；「内嵌歌词」从默认读取流程中移除、改为显式用户操作。当前代码已移除读取路径的写回（`read_metadata` 不再调用 `embed_lyrics`），但 `tag_writer.rs` 无生产调用点，同一文件在 hydrate（command 线程）与 load（parser 线程）中被反复执行 `read_metadata` 与 sidecar 读取/目录扫描。

## 决策

1. **新增内存歌词缓存模块 `lyrics_cache.rs`**：有界 LRU（默认 512 条），键为 `track_id(path)`，只缓存 **sidecar 歌词解析结果**（`Option<String>`，`None` 为负缓存）；失效采用「实际读取的 `.lrc` 路径的 mtime + 大小指纹」+「负缓存 TTL（默认 30s）」；`Arc<LyricsCache>` 由 `AudioController` 持有并克隆给 parser 线程，内部 `Mutex`，锁内只做 stat、磁盘读取在锁外、double-checked 回填；`read_metadata` 是唯一命中/回填入口；`audio_embed_lyrics` 成功后显式 `invalidate`。不做持久化，但在 `lyrics_cache.rs` 内部为持久化后备预留边界（调用点契约不变）。
2. **内嵌歌词读取保留、写回显式化**（对方向 3 的解读）：`read_metadata` 继续实时读取内嵌歌词（内嵌优先、sidecar 后备，与 `real-audio-playback.md` 既有契约及测试一致）；「从默认读取流程中移除」指移除写回动作。若 PM/Requirements 期望「默认完全不读内嵌歌词」，需另行增加显式读取命令（另一范围）。
3. **新增唯一写入口 Tauri command `audio_embed_lyrics`**：输入 `{ path: string, lyrics: string }`（`lyrics` 空串=清除），输出重新水合的 `AudioTrackRef`；错误码映射 `INVALID_PATH` / `FILE_NOT_FOUND` / `UNREADABLE_FILE` / `UNSUPPORTED_FORMAT` / `INTERNAL_ERROR`；直接复用 `tag_writer::embed_lyrics` / `safe_update_tag`；成功后 `lyrics_cache.invalidate(path)`。command 线程同步执行，不进入 runtime 状态机；后端不加二次确认（独立命令边界 + 前端显式动作与确认对话框 + 审计日志即显式意图保障）。
4. **只读保障约束**：只读模块（`metadata`、`source`、`runtime`、`playlist`、`duration`、`cover_cache`、`symphonia_source`、`cue`、`chapters`、`device`）不得引用 `tag_writer`；`mod.rs` 注释声明依赖方向，Test Agent 以 grep 验证。

## 备选方案

- 缓存键：`track_id(path)`（采用） vs 原始路径字符串（拼写不一致时命中率低）。
- 失效机制：mtime + 大小指纹 + 负缓存 TTL（采用） vs 文件监听（引入 notify 依赖与常驻线程，过度设计） vs 纯 TTL（周期性显示过期歌词） vs 每次重扫（未解决重复 I/O）。
- 缓存内容：只缓存 sidecar 解析结果（采用，避免未命中回填时二次读 tag） vs 缓存最终解析歌词（含内嵌，需额外指纹且收益低）。
- 内嵌歌词默认读取：保留（采用，维持既有契约与测试） vs 默认不读（使显式内嵌功能无法展示，需额外显式读取命令）。
- 写入口执行位置：command 线程同步（采用，与 `hydrate_track` 一致） vs runtime/worker 异步（污染状态机，不值）。
- 二次确认：不加（采用） vs 两阶段 prepare/confirm（本地应用过度设计）。

## 取舍理由

- 只缓存 sidecar 解析结果使缓存命中/回填零额外 tag 读取，性能收益与正确性代价最优。
- mtime + 大小指纹无需新依赖、命中时仅一次 stat；负缓存 TTL 以 30s 有界延迟覆盖「新增 `.lrc`」场景，正确性可接受。
- 有界 LRU 把内存占用控制在明确上限（512 条），符合「轻量」定位，不为未来队列规模提前引入复杂结构。
- 唯一写入口 + 独立命令名 + 前端显式动作构成最小充分的权限边界；后端二次确认对本地桌面应用属过度设计。

## 影响

- 正向：同一文件在 hydrate/load/parser 间的 sidecar 歌词读取与目录扫描被去重；无 sidecar 文件的目录扫描被负缓存抑制；写回能力以显式命令形式保留且只有唯一入口；读取路径无写回得到结构性保障。
- 负向：`read_metadata` / `hydrate_track_ref` / `start_track_parser` 签名增加一个 `lyrics_cache` 参数（测试传 `None`，兼容）；新增一个内存缓存对象与少量计数；方向 3 解读需要 PM/Requirements 复核。
- 残留：同文件并发首次解析仍可能重复（去重属 OPT-0008）；`open_source` 的 `replay_gain_multiplier` 额外 tag 读取不在本范围。

## 回滚条件

- 若缓存导致歌词展示过期或丢失（如指纹漏检），优先收紧 TTL / 增加指纹维度（如文件 ID）；仍无法修复则让 `read_metadata` 传 `None` 跳过缓存（保留模块，标注暂缓启用）。
- 若方向 3 解读被 PM/Requirements 否定（要求默认不读内嵌歌词），则本决策的「读取保留」部分作废，需新增显式读取命令决策，写回显式化部分不受影响。
- 若 `audio_embed_lyrics` 在实机验证中破坏用户文件（`safe_update_tag` 回滚失效），回退为不注册该命令并保留 `tag_writer` 仅测试引用。

## 关联文档

- [OPT-0002](../changes/optimizations/OPT-0002.md)：本决策对应的优化需求。
- [lyrics-cache-and-embed-boundary.md](../architecture/lyrics-cache-and-embed-boundary.md)：完整架构说明（模块边界、数据契约、命令契约、验收标准）。
- [real-audio-playback.md](../architecture/real-audio-playback.md)：既有播放架构契约；sidecar 写回偏差的修复与本方案衔接，偏差表需同步更新。
- [OPT-0001 决策](2026-08-05-OPT-0001-async-track-parsing.md)：解析 worker 边界；本方案在其基础上补充解析结果缓存。
- [OPT-0008](../changes/optimizations/OPT-0008.md)：队列收敛后端，全量 metadata 缓存与并发去重的后续演进。
