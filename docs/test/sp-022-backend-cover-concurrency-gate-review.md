---
doc_id: "TEST-SP-022-BACKEND-COVER-CONCURRENCY-GATE"
title: "测试报告：后端有界并发测试计划闸门复核与 A0 复跑"
doc_type: "test-report"
status: "in-review"
owner_agent: "Test Agent"
version_scope: "future-unscheduled"
created: "2026-10-20"
updated: "2026-10-20"
source_documents:
  - "user request: 我让codex针对播放列表封面加载速度慢的攥写了新的测试计划，你先看看，然后动手测试"
  - "docs/test/sp-022-backend-cover-concurrency-test-plan.md"
  - "docs/tasks/sp-022-backend-cover-concurrency-experiment-plan.md"
  - "docs/test/sp-022-playlist-performance-baseline.md"
  - "src-tauri/src/audio/cover_pixels.rs"
  - "src-tauri/src/audio/playlist_duration.rs"
  - "src/features/player/hooks/useAudioPlayer.ts"
  - "user request: 复核 DeepSeek 结果后推进安全补齐与独立验证"
---

# 测试报告：后端有界并发测试计划闸门复核与 A0 复跑

## 摘要

用户要求开始执行 [后端有界并发测试计划](sp-022-backend-cover-concurrency-test-plan.md) 后，本轮先做执行前闸门复核，再复跑计划 §9 中当前仓库**确实可执行**的命令。

结论分三层：

1. **计划不是可直接执行的测试计划**：它是"先实现 A0/A/B 三臂，再配对测量"的实验设计。其 §4/§8 P0 需要的核心设施在 HEAD `07658d6` 全部缺失——没有有界准入 N、没有解码级同键单飞、没有在途内存预算、没有活动账本、没有 N 开关/诊断入口、没有 `AppPaths`/WebView profile 隔离入口。因此 P1～P4 与 C01～C14 **一项都不能进入**；本轮没有 A/B 数据，也不存在"收益/退化"裁决。
2. **可执行子集全部通过**：`npm run lint`、`npm run build`、`cargo check --release --lib`、`audio::cover_pixels::tests`（23 passed / 0 failed / 1 ignored）、`playlist_generation_`（2 passed）、83 张手动代理；样本 digest 与历史完全一致（`5b1fb04c…64ecd8`）。
3. **A0 后端仍以解码为绝对主导**：83 张冷路径 `decode` 合计占 **98.1%**，热命中 83/83，缓存 83 文件 / 21,750,588 字节，均与历史记录一致。旧路径与冷路径 5 对为 4 正 1 负、均值 +0.95%，只能说明"未观察到稳定同号退化"，不构成改善或退化结论。

另做了一次**决策用预探测**（非计划闸门证据）：两个独立进程同时跑同一冷基准，聚合缩放比 1.76～1.88（2 为线性上限），说明这台机器的解码工作确有并行余量，支持继续做**有界** N=2 实验；但它不是 coordinator 内 N=2 的收益证据，不能替代实现后的真实 A/B。

## 1. 身份、环境与边界

| 项 | 值 |
| --- | --- |
| 仓库 HEAD | `07658d6a625579f52c4c5331927db845ba157d4b`（`07658d6`） |
| 工作树 | 只有既有文档改动（2 个 `M docs/**`、2 个未跟踪 `docs/**`）；Rust/TS 源码与 HEAD 一致；本轮跑前跑后 `git status --short` 相同 |
| Release 二进制 | `src-tauri/target/release/app.exe`，19,372,032 B，SHA-256 `2ABA681536F71B35117E8BBE1038839E8435ADB652C867A57478548BEAA7E0FA`（与 0N/0P/0Q 记录一致；未本轮重建） |
| 工具链 | cargo/rustc 1.98.1、node v24.19.0、npm 11.17.0 |
| 机器 | Windows 11 Pro Insider Preview 10.0.29683；Intel i7-12700KF（12C/20T）；31.84 GiB RAM；NVIDIA RTX 4060 Ti，同时存在多个虚拟显示适配器 |
| 样本库 | `E:\Music` 只读；83 张嵌入封面按媒体路径哈希排序抽样，digest `5b1fb04c10bb06040f3f52446d3549e0e78e6835ad3b0d80cce076966264ecd8` |

边界：未启动应用，未做 CDP/WebView2/Playwright，未修改源码或文档，不写用户 media/AppPaths/缩略图缓存；所有沙箱写入均在 `%TEMP%\spmusic-cover-pixels-<pid>-<seq>` 并自动删除。原始日志在 `%TEMP%\sp022-backend-concurrency-exec-20261020-145425\`（11 个文件）与 `%TEMP%\sp022-decode-parallelism-20261020-145858\`（24 个文件）。

## 2. 已执行命令（§9 可执行子集）

| # | cwd | 命令 | 退出码 | 结果 |
| ---: | --- | --- | ---: | --- |
| 1 | `D:\SpMusic` | `npm run lint` | 0 | `eslint .`，41.9 s，无告警/错误（历史上的 `node_modules_old` 干扰源已不存在） |
| 2 | `D:\SpMusic` | `npm run build` | 0 | `tsc -b && vite build`，14.1 s，dist 26 文件 |
| 3 | `D:\SpMusic\src-tauri` | `cargo check --release --lib` | 0 | 23.27 s，无 warning |
| 4 | `D:\SpMusic\src-tauri` | `cargo test --release --lib audio::cover_pixels::tests -- --nocapture` | 0 | 23 passed / 0 failed / 1 ignored |
| 5 | `D:\SpMusic\src-tauri` | `cargo test --release --lib playlist_generation_ -- --nocapture` | 0 | 2 passed / 0 failed |
| 6 | `D:\SpMusic\src-tauri` | `$env:SPMUSIC_BENCH_LIBRARY='E:\Music'` 后 `cargo test --release --lib benchmark_real_playlist_covers -- --ignored --nocapture` | 0 | 53.94 s；见第 3 节 |

偏差：未设专用 `CARGO_TARGET_DIR`（沿用仓库既有 release target，避免全量重编改变计时口径）；`npm run build` 必然重写被 gitignore 的 `dist/`。未执行 `npm run tauri -- build --no-bundle`，未重建任何二进制。

前端侧只读确认（不是本轮新增测量）：视觉补水与元数据补水各自上限为 2（`useAudioPlayer.ts:1154-1196` 两个 `pump`），每个视觉 job 依次 hydrate→pixel→`decodePlaylistCover`，与计划"前端视觉槽固定为 2"一致。

## 3. A0 83 张固定样本复测

`sample_count=83`、`sample_digest=5b1fb04c…64ecd8`，与历史 digest **完全一致**，83 断言成立。

| 对 | old_ms | cold_ms | 配对差 ms | read | hash | lookup | decode | write | 命中/未命中 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 4,389.759 | 4,434.995 | +45.236 | 47.412 | 10.220 | 20.343 | 4,349.978 | 3.605 | 0/83 |
| 2 | 4,295.918 | 4,487.099 | +191.181 | 54.785 | 10.095 | 22.181 | 4,394.420 | 1.925 | 0/83 |
| 3 | 4,340.971 | 4,692.048 | +351.077 | 55.739 | 10.769 | 21.174 | 4,600.889 | 1.893 | 0/83 |
| 4 | 5,707.366 | 5,287.523 | −419.843 | 55.223 | 11.326 | 21.987 | 5,194.871 | 1.700 | 0/83 |
| 5 | 5,319.472 | 5,380.488 | +61.016 | 51.547 | 12.146 | 21.241 | 5,292.521 | 1.665 | 0/83 |

- 旧路径均值 4,810.697 ms，冷路径均值 4,856.431 ms，差均值 **+45.733 ms（+0.95%）**，中位数 +61.016 ms，4 正 1 负。
- `decode` 合计 23,832.679 ms，占冷路径 **98.1%**（历史 0R 为约 96%）；`read+hash+lookup` 均值 85.238 ms（约 1.75%），write 均值 2.16 ms。
- 热轮（5 轮）97.918 / 78.638 / 64.512 / 64.066 / 54.411 ms，均 83 命中 / 0 未命中；`response_bytes=21,746,936`，缓存 83 文件 / 21,750,588 字节。
- 第 1–3 对与第 4–5 对分别落在 4.29–4.44 s 与 5.32–5.71 s 两个水平，产生一次 −419.8 ms 反号；这与宿主负载漂移一致，**不能**据此宣称零退化，也不能宣称改善。

**该基准的覆盖边界（源码确证）**：只调用 `load_cover_pixels_blocking` / `load_playlist_cover_pixels_blocking`（`cover_pixels.rs:1596,1635`），不经过 coordinator、不含 IPC、不含前端队列，也不受 N 影响。因此本轮不是计划 §8 P2 的代理，也不能作为并发收益证据。

## 4. 闸门矩阵（计划要求 → HEAD 现状）

| # | 计划要求 | 状态 | 证据 |
| ---: | --- | --- | --- |
| G1 | 有界准入 N，限制真实阻塞管线数 | **缺失** | `cover_pixels.rs:470,483` 只有 `decode_gate: Mutex<()>`；全仓无 `Semaphore`/`acquire_owned` |
| G2 | 门覆盖整段 `work()`（含 `spawn_blocking` 管线） | 满足（正常路径） | `:540-543` 取锁后 `work().await`；`:601-624` → `:636-704` |
| G3 | permit 随真实闭包存活，调用方取消不提前释放 | **缺失** | `:540` 的 `_guard` 是函数局部量，跨 await；对照正确写法 `playlist_duration.rs:115-121` |
| G4 | 解码级同键单飞 | **缺失** | `:666-673` 只查 writer 待写表/磁盘；`:144-151` 的 `pending` 只合并**写入** |
| G5 | 显式在途内存预算 `M_inflight` | **缺失** | 只有单请求上限 `:24-28` 与 writer 待写 128 项/32 MiB `:45-46`；无全局记账 |
| G6 | 准入等待队列上限与超限错误语义 | **缺失** | `Mutex` 等待队列无界；错误枚举 `:356-369` 无"过载/拒绝"码 |
| G7 | 可配置 N（编译期常量/feature/诊断开关） | **缺失** | `src-tauri/src` 无 `cfg(feature…)`；`Cargo.toml` 无 `[features]` |
| G8 | §6.1 真实工作账本（准入等待/真实活动/预算/单飞等待） | **缺失** | `THUMBNAIL_BENCH_*` 全为 `#[cfg(test)]` 累计值 `:53-68`，无并发度、无 span；生产只有命令入口/出口 tracing |
| G9 | 请求/flight 匿名编号供跨层关联 | 部分 | 列表输入只有 `client_id/file_path/max_edge/window_generation` `:342-348`，无请求身份 |
| G10 | "三次 `ensure_current`" | **计划/基线表述需更正** | HEAD 有 **4 处**：`:539`（入队前）、`:541`（取门后）、`:543`（`work()` 返回后）、`:690-694`（解码后、入队前） |
| G11 | generation 语义与 `STALE_REQUEST` 恢复链 | 满足 | `:487-524`；测试 `:2138-2203` |
| G12 | 播放器大图门保持独立 | 满足 | 两个独立 static `:330-331`；`:563-585` 与 `:596-625` 分离 |
| G13 | writer 双限、磁盘上限、pending 命中 | 满足 | `:41-46`、`:132-142`、`:666-673` |
| G14 | 路径/输入/输出上限、SPXR v1、缓存键、错误码不变 | 满足 | `:24-38`、`:661-664`、`:1352-1419`、`:356-369` |
| G15 | P2 的 coordinator 并发入口 | 部分 | `load_playlist_cover_pixels` `:587` 可并发调用，但 `lib.rs:2` 为私有模块，`src-tauri/tests/` 不可达；现有基线绕过 coordinator |
| G16 | §5.1 AppPaths/WebView profile 隔离 + fail-closed | **缺失** | `app_paths.rs:33-39` 固定 Known Folders，无覆盖入口 |
| G17 | C04/C05/C06 取消/排队注入（列表路径） | **缺失** | 列表 coordinator 无取消测试；可借鉴 `playlist_duration.rs:1094-1116` |
| G18 | C12 暂停 writer / 逼近容量 | 部分 | 模块内 `_with_limits` 可注入 `:809,922`；系统级磁盘满无入口 |
| G19 | C13 关闭与恢复 | 部分 | `shutdown_playlist_cover_cache` `:324-328` 只关 writer |
| G20 | C14 前端相邻路径与 §6.2 UI 口径 | **缺失** | 仓库内无采集探针（历史脚本只在 `%TEMP%`） |
| G21 | §9 命令与 A0/A/B 启动入口 | 部分 | 命令存在；A0/A/B 入口、60 首采集器、隔离运行根不在仓库 |

**闸门结论**：P0 的核心前提不成立，P1 及之后不具备可比条件。按计划第 11 节"任一必要闸门未通过，不进入下一阶段"，本轮应停在静态/基线层。

## 5. 对基线 0R 的复核更正

1. **"三次 `ensure_current`"不准确**：实际 4 处（见 G10）。计划 §4.1 的冻结清单若照抄"三次"会漏掉解码后的会话复检。
2. **"N=1 与现状逐位等价"应撤回**：机械换锁的串行效应可以等价，但 A 臂一旦包含计划自己要求的取消/单飞/预算修正，就不再与 A0 逐位等价；这与实验计划 §2 和任务卡阶段 2 的表述一致，0R 该句自相矛盾。
3. **取消提前释放 guard 的结构性缺陷成立**：`_guard` 在调用方 future 被丢弃时立即释放，而 `spawn_blocking` 不可中止，因此"全局 ≤1"只在 future 存活期成立。但**生产可达性未证**：当前唯一调用方是 Tauri 命令且直接 await，仓库内没有 `select!`/`timeout`/`abort` 包裹该路径；本轮没有构造出真实取消样本。它是必须随放宽一起修的**不变量缺口**，不是已观测的线上症状。
4. **`decode` 桶不是纯解码器**：该桶是 `decode_and_pack`（方向校正 + Lanczos3 + 打包，`:1228-1286`），本轮占 98.1%。"缩短临界区若不含解码几乎无收益"仍成立，但桶名不应写成纯 decode CPU。
5. 实测补充：`read+hash+lookup+write` 合计约 1.9%，与 0R"非解码段约 1.7%"同量级，不改变"放宽瓶颈在解码"的判断。

## 6. 决策用预探测：双进程并行缩放（非闸门证据）

目的：在实现 N=2 前，先判断"解码工作本身能否并行"，避免把 CPU/IO 串行误当成准入串行。

方法：直接运行已编译测试二进制（不经 cargo，避免 target 锁），同一 83 张冷基准，按 S1（单进程）→ P（两进程同时启动）→ S2（单进程）执行，另补一对静音窗口 P′/S3。

| 段 | 墙钟 ms | `finished in` | cold_ms 均值 | decode 合计 ms |
| --- | ---: | ---: | ---: | ---: |
| S1 | 62,374 | 62.35 s | 5,704.1 | 28,053.9 |
| P1 | 67,934 | 67.90 s | 6,109.8 | 30,033.6 |
| P2 | 67,725 | 67.69 s | 6,104.1 | 30,011.3 |
| P 共同 | **67,935** | — | — | — |
| S2 | 65,593 | 65.57 s | 5,975.2 | 29,382.9 |
| P′1 | 54,923 | 54.87 s | 4,858.6 | 23,855.1 |
| P′2 | 55,012 | 54.98 s | 4,857.0 | 23,844.1 |
| P′ 共同 | **55,014** | — | — | — |
| S3 | 48,302 | 48.28 s | 4,295.7 | 21,096.6 |

- 冻结协议缩放比：2×63,983.5 / 67,935 = **1.884**（94% 线性）；补充静音窗口：2×48,302 / 55,014 = **1.756**（88% 线性）。
- 并发时单进程仅慢 6%–14%；7 段全部 `sample_count=83`、digest 一致、cold 均 0 命中 / 83 未命中、热轮 83/0、缓存 83 文件 / 21,750,588 字节。
- 宿主漂移明显：单进程冷均值在 4,296–5,975 ms 间移动（±39%），期间存在 `MuMuVMMHeadless`（3 个，累计 CPU 4,447 s）、Figma、WebView2 等负载；慢窗口与静音窗口不可混算，S3/P′ 更接近历史 A0 水平（4.05–4.5 s / 57–69 ms）。

**能说明**：这台机器的 CPU/IO 对 2 路独立解码有真实余量，A0 管线没有外部进程级串行瓶颈，值得做**有界** N=2 实验。
**不能说明**：单进程内 2 路并发（共享分配器、blocking 池、writer 队列、在途内存预算）的表现；不是 N=2 的收益预测；不是 §8/§10 的判据；无 >2 路、无内存峰值、无 UI 端到端。

## 7. 结论与下一步

1. **本轮没有完成、也无法完成计划验收**：计划缺 A0/A/B 构建、缺 §4 契约冻结、缺隔离设施与入口。任何"加并发有效/无效"的结论都必须等实现后按 P2/P3 配对测量。
2. **当前健康度**：静态检查、单元回归、前端构建/lint 全绿；83 张样本与缓存/热命中可复现；A0 后端成本仍由解码主导（98.1%）。
3. **进入 P2 所需的最小授权与实现范围**（均未批准、未实施）：在 `src-tauri/src/audio/cover_pixels.rs` 内把 `Mutex<()>` 换成编译期常量 N 的有界准入，permit 移入 `spawn_blocking` 闭包（`playlist_duration.rs:115-121` 范式）；补同键单飞、在途预算、有界等待与超限语义；A/B 两臂共享全部安全修正，仅 N 常量不同；同时需要 Architecture 裁决"串行单门"契约、在途预算数值、过载错误码与是否允许诊断账本，以及 PM 确认 §10.2 数值门槛。
4. **未执行**：C01～C14、P0 正式签署、P1 A0↔A 安全对照、P2 60 首完整管线与 83 张配对、P3 Release WebView2/UI、P4 长跑资源、故障注入、npm tauri build、任何 A/B/N=2 对照。

**后续（2026-10-20，用户授权）**：用户批准"推进 A/B 实现并跑 P2，完成后回退代码"。已按 Architecture 绑定式最小契约实现编译期 N=1/N=2 两臂（仅 `cover_pixels.rs` + `Cargo.toml`），两臂 C01/C02/C06 通过，P2 代理（60 张、c=2、5 对交错）得到 **A/B** 批次墙钟比中位 **1.953**（B/A 约 0.512）、5/5 同向；代码已回退。结果、偏差与缺口见 [A/B 代理测量报告](sp-022-backend-cover-concurrency-p2-ab-report.md)。该实验仍不改变本复核的闸门判断，也不构成 UI 收益或 SP-022 验收。

**独立复核更正（2026-10-20）**：根据旧实验主数据 JSONL 与既有复算结果，将上段原稿误写的 B/A 方向更正为 A/B；主数据两臂墙钟中位为 A 3,392.306 ms、B 1,761.675 ms。该 60 张纯像素代理在计时前已预解码素材，属于派生缓存冷，未覆盖计划的历史 60 首 hydrate→256px、C/W 各 5 对、83 张并发桥接及 A0↔A 开销。详细证据与更正历史见关联报告 §12；本次没有重跑原实验。

## 8. 证据位置

| 内容 | 位置 | 说明 |
| --- | --- | --- |
| §9 命令与 A0 基准原始日志 | `%TEMP%\sp022-backend-concurrency-exec-20261020-145425\` | 11 个文件：identity、env、5 条命令日志、benchmark 全量输出、post-check、log scan |
| 双进程并行预探测 | `%TEMP%\sp022-decode-parallelism-20261020-145858\` | 24 个文件：各段 stdout/summary、聚合、退出码探针、qc |

两份目录均为本机临时证据，不含曲名、媒体路径、trackId 或 Object URL；尚未长期归档。`%TEMP%` 另有 4 个 10-19/10-20 早期运行遗留的 `spmusic-cover-pixels-*` 沙箱，非本轮产物，未删除。
