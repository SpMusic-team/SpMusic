---
doc_id: "TEST-OPT-0002-LYRICS-CACHE"
title: "测试报告：OPT-0002 歌词缓存与显式内嵌歌词边界"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "v0.1"
created: "2026-08-13"
updated: "2026-08-13"
source_documents:
  - "docs/changes/optimizations/OPT-0002.md"
  - "docs/architecture/lyrics-cache-and-embed-boundary.md"
  - "docs/decisions/2026-08-13-OPT-0002-lyrics-cache-and-embed-boundary.md"
  - "docs/architecture/real-audio-playback.md"
  - "src-tauri/src/audio/lyrics_cache.rs"
  - "src-tauri/src/audio/metadata.rs"
  - "src-tauri/src/audio/source.rs"
  - "src-tauri/src/audio/runtime.rs"
  - "src-tauri/src/audio/controller.rs"
  - "src-tauri/src/audio/types.rs"
  - "src-tauri/src/audio/mod.rs"
  - "src-tauri/src/audio/source_tests.rs"
  - "src-tauri/src/audio/tag_writer.rs"
  - "src-tauri/src/lib.rs"
  - "src/features/player/services/audioCommands.ts"
---

# 测试报告：OPT-0002 歌词缓存与显式内嵌歌词边界

## 摘要

独立验证 OPT-0002 实现交付：有界 LRU 歌词缓存（`lyrics_cache.rs`）、`read_metadata` 签名扩展、唯一写入口 Tauri command `audio_embed_lyrics`、只读保障与依赖方向约束。全部编译/测试/前端检查由 Test Agent 独立重跑：`cargo check --all-targets` 0 告警 0 错误、`cargo test --lib` 78 通过 0 失败、集成测试 5 通过 0 失败、`npm run lint` 与 `npx tsc -b --noEmit` 均通过；验收标准 1–7 逐条核验，除「controller 成功路径与 Tauri 端到端 invoke 无自动测试」（已记录证据边界）外全部满足。结论：**通过**（附残余风险）。

## 范围

- 缓存模块行为（LRU、指纹、负缓存 TTL、锁中毒降级、并发回填）。
- `read_metadata` / `read_sidecar_lyrics_with_source` / `hydrate_track_ref` / `start_track_parser` 契约扩展。
- `audio_embed_lyrics` 命令契约：输入输出、错误码映射、成功后失效与重新水合。
- 只读保障（读取路径无写回）与依赖方向（只读模块不引用 `tag_writer`）。
- 前端 `audioCommands.ts` 类型与 invoke 封装契约（无 UI）。
- 全量构建与测试。

## 实现交付与证据完整性

- 实现 Owner：Rust/Tauri Agent（后端）、Frontend Agent（前端 `audioCommands.ts`，无 UI）。
- 修改范围：
  - 新增 `src-tauri/src/audio/lyrics_cache.rs`（LRU 512 条、键=track_id、mtime+大小指纹、负缓存 TTL 30s、Mutex + 锁外 I/O + double-checked 回填）。
  - `metadata.rs`：`read_metadata` 增加 `lyrics_cache: Option<&LyricsCache>` 参数；新增 `read_sidecar_lyrics_with_source`；`read_sidecar_lyrics` 改为薄包装。
  - `source.rs` / `runtime.rs`：`hydrate_track_ref`、`start_track_parser` 签名扩展。
  - `controller.rs`：持有 `Arc<LyricsCache>`；新增 `embed_lyrics` 方法与错误映射纯函数 `map_embed_lyrics_error`（含 5 个测试）。
  - `types.rs`：`AudioEmbedLyricsInput`（Deserialize + TS + camelCase）+ ts-rs 导出测试。
  - `lib.rs`：注册 `audio_embed_lyrics`（现 13 个 command，未删改现有命令）。
  - `mod.rs`：`mod lyrics_cache;`、`tag_writer` 注释更新并移除 `#[allow(dead_code)]`。
  - `source_tests.rs`：仅两处 `read_metadata` 调用点补 `None` 参数（git diff 确认无测试删除/弱化）。
  - `src/features/player/services/audioCommands.ts`：新增 `AudioEmbedLyricsInput` 类型与 `embedAudioLyrics` invoke 封装（未修改任何现有封装）。
  - 文档：`real-audio-playback.md` 偏差表更新（「必须修复的偏差」→「已修复偏差（OPT-0002）」）。
- 复现基线：完整。独立复现实现者声明：`cargo test --lib` 78 passed / 0 failed 与声明一致；`cargo check` 0 告警；前端 lint / tsc 通过。
- 已知证据与待验证假设：实现者声明的全部自测结果均为「已独立重跑」项（见下），非直接采信。
- 实现者主张的因果链：读取路径重复执行 `read_metadata` 与 sidecar 读取/目录扫描（重复 I/O）→ 本方案以内存 LRU 缓存 sidecar 解析结果 + 负缓存抑制目录扫描；写回能力从「仅测试引用」改为唯一显式写入口。
- 证据缺口：
  1. Tauri 层端到端 `audio_embed_lyrics` command invoke 无自动测试（无法在 `cargo test` 中 invoke Tauri command），需人工或集成验证。
  2. `AudioController::embed_lyrics` 成功路径（写入→invalidate→重新水合）无自动测试（`LyricsCache::invalidate` 与 `tag_writer` 写入→回读分别有测试，但 controller 装配无）。
  3. `read_metadata` 的 lofty 失败分支（空字段 + sidecar 歌词）无直接单元测试（代码审查确认逻辑正确，`metadata.rs:90-103`）。
  4. 缓存键路径拼写一致性（不同拼写共享条目）无直接自动化测试（`track_id` 机制审查确认正确）。
  5. 空 `lyrics` 清除内嵌歌词语义无自动测试（代码审查：写入空字符串 + `lyrics_from_tag` 过滤空值 → 呈现为清除）。

## 命令

独立执行的真实结果（PowerShell 环境，`cargo` 直接调用；ffmpeg 已存在于 PATH）：

- `cargo check --all-targets`（`src-tauri`）：**通过**。EXIT=0，0 warnings，0 errors（日志：`Finished dev profile ... in 18.63s` / 二次缓存 3.32s）。
- `cargo test --lib`（`src-tauri`）：**通过**。`running 78 tests` → `test result: ok. 78 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.55s`；测试构建 0 warnings。
- `cargo test --test audio_compatibility`（集成测试，无 `SPMUSIC_FFMPEG_PATH`，fixture 由 node 生成、ffmpeg 派生语料自动跳过）：**通过**。`running 5 tests` → `test result: ok. 5 passed; 0 failed`。
- `cargo test --doc`：**通过**。0 tests（本 crate 无 doctest）。
- 附注：设置 `SPMUSIC_FFMPEG_PATH` 启用 ffmpeg 语料后，`cargo test --lib` 出现 5 个既有语料测试失败（`gapless_decode_trims_codec_delay_and_end_padding`、`production_source_decodes_and_seeks_extended_formats`、`multichannel_sources_use_the_documented_stereo_downmix`、`replay_gain_reads_standard_tags_and_clamps_gain_and_peak`、`supported_music_tags_cover_and_lyrics_write_back_without_audio_damage`），失败原因为 `fixture generator failed: FFmpeg unavailable: ffmpeg -version exited with status null`。已独立证实根因是 **DSH 沙箱环境限制**而非实现缺陷：`generate-fixtures.mjs` 用 `spawnSync`（默认管道 stdio）调用 `ffmpeg -version`，沙箱禁止子进程管道输出捕获（`node -e spawnSync('ffmpeg',['-version'])` 复现 `status=null, error=EPERM`）。这 5 个测试均为 OPT-0002 无关的既有 ffmpeg 语料测试；无 env 时它们 `generate_ffmpeg_corpus()` 提前返回（跳过）而全部通过。73 个通过的测试已包含全部 OPT-0002 相关新增测试。
- `npm.cmd run lint`（仓库根）：**通过**。EXIT=0（`eslint .` 无报错）。
- `npx.cmd tsc -b --noEmit`（仓库根）：**通过**。EXIT=0。`tsconfig.app.json` / `tsconfig.node.json` 均 `noEmit: true`，tsbuildinfo 写入 `node_modules/.tmp`（gitignored），`git status` 复核确认工作树无新增产物、无污染。
- `npm run tauri dev`：未运行（GUI 桌面冒烟属人工验证范围，非本验证必需；命令契约层已由编译与单测覆盖）。

## 人工检查

- 端到端 `audio_embed_lyrics` invoke（写后文件含歌词、返回新歌词、再次读取仍为新歌词）：**未验证（自动）**——证据边界，需人工/集成验证步骤（见「回归覆盖」）。
- `AudioController::embed_lyrics` 成功路径（写入→invalidate→重新水合）：**未自动验证**，代码审查通过（`controller.rs:443-495`）。
- 只读路径无写回（加载带 `.lrc` 音频后原文件字节/mtime 不变）：**通过**（`sidecar_lyrics_are_loaded_without_modifying_the_audio_file` 断言字节不变；代码审查确认只读模块零写操作）。

## 根因与因果链反证

- 独立复现或等价基线：实现者声明的「78 passed」独立重跑一致；「cargo check 0 告警」「lint/tsc 通过」均独立复现。
- 因果链逐段核对：
  - 「重复 I/O」主张：`read_metadata` 是唯一命中/回填入口（`metadata.rs:60`），cache 在 hydrate（command 线程，`controller.rs:418-422`）与 parser（worker 线程，`runtime.rs:150`）间经 `Arc` 共享——命中路径成立。
  - 「写回显式化」主张：生产代码 `embed_lyrics` 调用点仅 `controller.rs:465`（tag_writer 直调）与 `lib.rs:95`（command 转发到 controller）；读取路径（source/metadata/runtime）无任何 `embed_lyrics` 引用（grep 全量核对）。
  - 「成功后失效」主张：`controller.rs:478` 仅在 `tag_writer::embed_lyrics` 返回 Ok 后调用 `invalidate`；失败分支不失效（符合「嵌入失败不失效」契约）。
- 替代假设与反证尝试：
  - 假设 A：缓存可能缓存内嵌歌词导致内嵌变更后展示过期 → 反证：`read_metadata` 内嵌歌词始终从 tag 实时读取（`metadata.rs:68-71`），缓存只承载 sidecar 解析结果（`lyrics_cache.rs:2-6` 注释 + `resolve_sidecar_lyrics` 仅内嵌缺失时调用）→ 不成立。
  - 假设 B：负缓存 TTL 内新增 `.lrc` 不被发现 → 反证：负条目有效性含 `!path.with_extension("lrc").exists()`（`lyrics_cache.rs:195-196`），直接路径 `.lrc` 出现即失效重扫；测试 `deleted_sidecar_becomes_negative_entry_that_expires_and_rescans` 在 TTL 有效期内重现文件并断言立即读回新歌词 → 不成立（Windows 大小写不敏感下含大小写变体；大小写敏感 FS 上大小写变体最迟 TTL 可见，属架构已声明限制）。
  - 假设 C：double-checked 回填可能丢失并发填充 → 反证：二次锁内 `hit`（`count_stats=false`）发现有效条目即返回、不覆盖（`lyrics_cache.rs:121-124`），否则才 `insert`（最后一次写入胜出，值同源）→ 不成立；仅并发首次 miss 时 stats 可能多计一次 miss（观测性细节，OPT-0008 范围外，不影响正确性）。
- 根因修复而非症状掩盖：**通过**。缓存未命中时锁外读盘 + 锁内回填真正减少重复 I/O；写入口收敛为唯一命令并成功后失效；锁中毒降级为直读而非吞错。未发现放宽断言、删除失败测试或静默降级（git diff 复核 `source_tests.rs` 仅签名适配）。

## 跨层契约

- TypeScript / Rust 类型与序列化：**通过**。Rust `AudioEmbedLyricsInput { path: String, lyrics: String }`（`Deserialize` + `TS` + camelCase）与前端 `AudioEmbedLyricsInput { path: string; lyrics: string }` 一致；invoke 参数名 `input` 与 Tauri command 形参名一致（`lib.rs:87`）；ts-rs 导出测试 `audio_embed_lyrics_input_exports_typescript_contract` 通过；`AudioTrackRef` 输出契约不变。
- command / event 名称、方向和输入输出：**通过**（代码核对）。`audio_embed_lyrics(state, input) -> Result<AudioTrackRef, AudioCommandError>`，已注册进 `generate_handler!`（13 个命令，未删改现有 12 个）；不进入 runtime 状态机（command 线程同步执行）；输出为重新水合的 `AudioTrackRef`。
- 空值、错误语义、权限与生命周期：**通过**（部分自动化）。错误码映射纯函数 `map_embed_lyrics_error` 5 个测试覆盖：IO（copy/write/staging/cleanup）→`UNREADABLE_FILE`(recoverable=true)、标签解析/重写校验→`UNSUPPORTED_FORMAT`(true)、安装失败且 `rollback=Err`→`INTERNAL_ERROR`(false)、安装失败但回滚成功→`UNREADABLE_FILE`(true)、路径校验→`INVALID_PATH`(true)、未知消息→`UNSUPPORTED_FORMAT`(true) 兜底；`embed_lyrics` 前置 `validate_existing_file` 拦截缺失文件（→`FILE_NOT_FOUND`）。生命周期：`Arc<LyricsCache>` 随 `AudioController` 创建（`controller.rs:70`）、克隆给 parser 线程（`controller.rs:71`），随进程退出释放。

## 回归覆盖

- 原始复现路径：`sidecar_lyrics_are_loaded_without_modifying_the_audio_file`（读取后原文件字节不变）、`embedded_lyrics_take_precedence_over_sidecar_lyrics`（内嵌优先）——均通过。
- 相邻路径：`read_sidecar_lyrics_finds_same_stem_lrc_file`、`load_track_ref_rejects_missing_files_before_decode`、`load_track_ref_rejects_header_only_damaged_audio`、`track_parser_worker_forwards_results_to_the_runtime_channel`（parser 携带缓存参数）、`track_id_*`、`invalidate_removes_the_cached_entry`——均通过（78 全绿）。
- 关键失败分支：缺失文件（负缓存抑制重复扫描）、锁中毒降级直读、容量淘汰、`.lrc` 修改/删除/重现、大小写变体指纹、错误映射全场景——均有测试并通过。
- 自动化缺口与等价人工证据：
  - Tauri 端到端 invoke（成功/清除/各失败码与文件不变）——建议人工步骤：1) 用带 `.lrc` 无内嵌歌词的音频调用 `audio_embed_lyrics {path, lyrics}`，核对返回 `metadata.lyrics` 为新值、再次 `audio_hydrate_track` 仍为新值、文件 tag 含歌词；2) `lyrics: ""` 清除后 `read_metadata` 不再返回该歌词（sidecar 恢复可见）；3) 指向不存在路径 → `FILE_NOT_FOUND`；4) 非音频文件 → `UNSUPPORTED_FORMAT`；5) 构造回滚失败（如写保护目录）→ `INTERNAL_ERROR`(recoverable=false)。
  - controller 成功路径装配（invalidate + 重新水合）——等价证据：`LyricsCache::invalidate` 单测 + `tag_writer` 写入→`read_embedded_metadata` 回读单测（`local_flac_accepts_embedded_lyrics_when_sample_file_exists`、`supported_music_tags_cover_and_lyrics_write_back_without_audio_damage`）分别覆盖，装配层仅代码审查。

## 性能 / 时序

- 场景与采样口径：本变更为缓存行为优化，验收标准以正确性为主；性能收益（命中省 `.lrc` 读与目录扫描）由命中/未命中计数测试（`LyricsCacheStats` 精确断言 hits/misses）作为间接证据，未做计时基准对比。
- 修复前基线：不适用（无同口径修复前计时数据；`OPT-0002` 以重复 I/O 为问题描述，非时间预算验收）。
- 修复后结果：命中路径仅一次 stat（`lyrics_cache.rs:187-192`），负条目命中零磁盘 I/O；未命中时锁外单次读盘 + 锁内回填。
- 重复、乱序、并发、取消与资源清理：并发路径经 double-checked 回填防覆盖（见反证假设 C）；锁中毒降级不 panic；容量有界 512（最坏约 25 MB，架构声明）；无计时断言，残余性能风险为「同文件并发首次解析仍可能重复读盘」（OPT-0008 范围外，架构已声明）。

## 发现

- 无阻塞性缺陷。
- 观察项 1（证据缺口，非缺陷）：controller 成功路径与 Tauri 端到端 invoke 无自动测试（见「证据缺口」1/2）。
- 观察项 2（观测性，非正确性）：并发首次 miss 同一键时，两个线程各计一次 miss（`count_stats=true` 均在首次锁内），stats 可能略偏高；测试为单线程不受影响，OPT-0008 并发去重落地时可顺带修正。
- 观察项 3（环境记录）：DSH 沙箱下 node `spawnSync` 管道捕获被 EPERM 拒绝，5 个既有 ffmpeg 语料测试无法在启用 ffmpeg 时运行（已独立证实根因，见「命令」附注）；无 env 时全部通过。

## 风险

- 端到端命令路径未经自动化验证（证据边界）：`safe_update_tag` 在实机上的行为（临时副本 + 替换 + 回滚）依赖文件系统权限与磁盘状态，回滚失效时返回 `INTERNAL_ERROR`(recoverable=false) 且文件可能处于过渡态——需人工验证兜底。
- `safe_update_tag`「备份清理失败」返回 Err 但文件实际已更新时，缓存不失效（`controller.rs:480-491` 失败分支）：内嵌歌词实时读取，过期 sidecar 条目仅在「无内嵌歌词」时被读到；用户下次成功 embed 即失效；罕见（写成功但删备份失败）且影响轻微，可接受。
- 粗粒度 mtime 文件系统（FAT）可能漏检「同长度快速编辑」的 `.lrc`：负缓存 TTL 30s 兜底「新增」场景，同长度编辑属架构已声明已知限制。
- 大小写敏感文件系统上，负缓存 TTL 内出现大小写变体 `.lrc` 最迟 TTL 后才可见（架构已声明；Windows 主目标不受影响）。
- 前端若在只读流程误调用 `embedAudioLyrics` 会触发写盘：当前 grep 确认无任何只读流程引用，约束依赖后续开发遵守（`real-audio-playback.md` 风险节已更新口径）。
- 512 条 LRU 最坏约 25 MB 内存（架构声明上限）；未来队列规模放大可调常量。

## 临时缓解

- 是否为临时缓解：否。本变更为完整根因修复（缓存 + 唯一写入口 + 只读保障），非临时缓解。
- 适用边界与未解决风险：无（OPT-0008 的并发解析去重与持久化缓存为后续演进，非本变更的缓解承诺）。

## 验证结论

**通过**。验收标准 1–7 逐条核验：1（缓存单元测试，真实临时文件 + 严谨计数断言 + 长度变化规避粗粒度 mtime）通过；2（`read_metadata` 语义：内嵌优先、sidecar 后备、lofty 失败空字段 + sidecar；既有只读/优先测试通过）通过；3（只读保障：代码审查 + 字节不变测试）通过；4（命令契约：错误映射纯函数 5 测试通过；controller 成功路径与 Tauri 端到端 invoke 无自动测试——已按任务要求明确记录为证据边界，非阻塞）通过（附边界）；5（依赖方向 grep 独立验证：只读模块无 `tag_writer`，生产 `embed_lyrics` 调用点仅 controller.rs + lib.rs 转发指向 controller）通过；6（前端契约：类型与 invoke 封装存在、序列化一致、无只读流程调用）通过；7（全量构建与测试独立重跑全部通过）通过。结论强度：高——所有可自动验证项均为独立执行结果，实现者自测主张未被直接采信；唯一残余为上述自动化缺口与已知环境限制。

## 建议

- 建议交给 PM Agent 验收；若发布前要求更高证据强度，建议补：1) 一次人工或集成层的 `audio_embed_lyrics` 端到端冒烟（成功/清除/失败码），2) 可选补充 `read_metadata` lofty 失败分支与路径拼写共享键的单测（低优先）。
- 若后续在非沙箱环境启用 ffmpeg 语料，请重跑完整 `cargo test`（含 ffmpeg 派生格式），以补齐本环境无法执行的 5 个语料测试证据。
- 方向 3 解读（内嵌歌词读取保留、写回显式化）按架构文档标注仍需 PM/Requirements 复核口径；本验证按该解读执行，若口径变更需重新验证。
