---
doc_id: "TEST-SP-022-BACKEND-COVER-CONCURRENCY-P2"
title: "测试报告：后端有界并发 A/B 代理测量（A=N1 / B=N2）"
doc_type: "test-report"
status: "in-review"
owner_agent: "Test Agent"
version_scope: "future-unscheduled"
created: "2026-10-20"
updated: "2026-10-20"
source_documents:
  - "user request: 是，按计划推进A/B实现并跑P2，跑完写好测试报告再回退更改的代码"
  - "docs/test/sp-022-backend-cover-concurrency-test-plan.md"
  - "docs/test/sp-022-backend-cover-concurrency-gate-review.md"
  - "docs/tasks/sp-022-backend-cover-concurrency-experiment-plan.md"
  - "docs/architecture/playlist-artwork-loading.md"
  - "src-tauri/src/audio/cover_pixels.rs"
  - "src-tauri/src/audio/playlist_duration.rs"
  - "docs/test/sp-022-playlist-performance-baseline.md"
  - "user request: 复核 DeepSeek 结果后推进安全补齐与独立验证"
---

# 测试报告：后端有界并发 A/B 代理测量（A=N1 / B=N2）

## 1. 摘要

用户批准按 [测试计划](sp-022-backend-cover-concurrency-test-plan.md) 推进 A/B 实现并跑 P2，测试完成后回退代码。本轮先在 [闸门复核](sp-022-backend-cover-concurrency-gate-review.md) 中确认计划 §4/§8 P0 的设施在 HEAD `07658d6` 全部缺失，随后按 Architecture 的绑定式最小契约实现了两臂候选（唯一源码差异是编译期准入常量 N），并以独立进程各跑 5 轮冷态 P2 代理：

- **正确性**：C01（活动 ≤ N）、C02（同键单飞只解码一次、waiter 取消隔离）、C06（调用方取消后 permit 仍被阻塞工作持有）在两臂全部通过；既有 23 项封面回归与 2 项 generation 回归无退化。
- **P2 代理（60 张固定封面、c=2、每轮全新测试根）**：主数据集 A（N=1）批次墙钟中位 **3,392.306 ms**，B（N=2）**1,761.675 ms**，5/5 对同向，逐对 A/B 比值 **1.920–1.974**，中位 **1.953**（B 的吞吐约为 A 的 **1.95×**，配对批次耗时降低约 **48.8%**）。本轮只测派生缓存冷的 coordinator 代理，准备阶段已预解码素材。
- **累计账本闭合**：20 次代理运行全部 `ok=60 / errors=0 / hits=0 / misses=60 / decode_calls=60 / unique_keys=60`；writer `enqueued=written=60`；两臂 `response_bytes=3,930,976` 完全相同。该累计一致性与 C02 支持未观察到重复解码，不能仅凭累计等式证明逐键归因；逐请求 `hit` 的限制见 §7。
- **结论强度**：这只是**后端 coordinator 级冷路径代理**，不经 IPC、前端两槽队列、hydrate、BMP/ObjectURL、React 与 GPU，**不能**表述为用户可见收益或 SP-022 验收；它只回答"是否值得进入真实 UI 验证"。§10.2 的 ≥20% 等数值仍未获 PM 确认，本轮只报数与配对方向。

**代码已按用户要求回退**：`src-tauri/src/audio/cover_pixels.rs` 与 `src-tauri/Cargo.toml` 恢复到 HEAD，工作树只保留文档改动；实验 diff 保存在受控本地 `code.patch`（SHA-256 `2471B464…C9D54A7D`），两臂测试二进制保留作证据。

## 2. 授权、范围与实现摘要

用户授权范围：实现最小 A/B 候选、跑 P2、写报告、回退。Architecture 裁决（受控本地 `architecture-decision.md`）先于实现，关键约束：

- 改动只限 `src-tauri/src/audio/cover_pixels.rs` 与 `src-tauri/Cargo.toml`；`Cargo.lock`、前端、命令层、架构文档不变；不新增依赖。
- A/B 用同一份代码，唯一差异是 Cargo feature `sp022-playlist-decode-n2` 决定的编译期常量 `PLAYLIST_DECODE_PERMITS`（1 / 2）；默认关闭 = A。
- 准入用 `tauri::async_runtime` 已再导出的 mpsc 令牌池（`channel` + `Mutex<Receiver>`）实现，`DecodePermit` 在 `Drop` 中归还令牌；permit 在 async 侧取得后移入 `spawn_blocking` 闭包首行，覆盖正常、错误、panic 与调用方取消。
- 同键单飞：键为 `{covers_root, requested_path, max_edge}`；leader 在阻塞闭包内发布结果（幂等），waiter 各自做会话复检；leader 取消不会遗留 waiter；waiter 取消只影响自身。
- 在途预算：每持有 permit 记账 544 MiB，A/B 共用 1088 MiB 预算（`reserved = permits × R`），无独立预算等待队列、不新增错误码。
- leader 保留原有 4 处 `ensure_current`；waiter 为 2 处。等待队列上限本轮不实现（G6 部分满足、C08 未验证）。

实验代码新增的核心函数/类型：`DecodeSlotPool`/`DecodePermit`、`with_permit`（替代 `run_registered`）、`DecodeKey`/`FlightRegistry`/`FlightOutcome`/`FlightFailure`、`run_playlist_cover_pipeline`（把原阻塞管线抽出以便"陈旧 leader 仍共享像素但不落盘"），以及全部 `#[cfg(test)]` 计数器与门（生产二进制不含）。完整 diff 见 `code.patch`（71,053 字节）。

## 3. 身份、构建与环境

| 项 | 值 |
| --- | --- |
| HEAD | `07658d6a625579f52c4c5331927db845ba157d4b`；实验构建标记 `07658d6-dirty` |
| 实验源码 | 工作树 diff 与 `code.patch` 字节级相同（SHA-256 `2471B464CF557622B6BC0B14FF038B30B5BB1938199CD0473A80CD6CC9D54A7D`，71,053 B） |
| A 臂二进制 | `%TEMP%\sp022-ab\armA.exe`，SHA-256 `ED1BB18F3BEEAAD6F85D3CDC78E196FC471510AC75B7B2A6E8434590CFD5F2E8`，自报 `arm=1 permits=1 feature=off` |
| B 臂二进制 | `%TEMP%\sp022-ab\armB.exe`，SHA-256 `605719C8B9C224B4AE6F1C55A6119E169BC549A2E5A77C08DD558EB3E81971DF`，自报 `arm=2 permits=2 feature=on` |
| `app.exe` | SHA-256 `2ABA6815…EAA7E0FA` 未变（本轮未重建、未启动应用） |
| 样本 | 60 张 = 既有 83 张样本的前 60；digest `274e32d65d00523fccda28cc611412ce2b467462a447fc958a9f6252979df80e`，每轮由 `SP022_AB_SAMPLE_DIGEST` 强制断言；`unique_keys=60` |
| 机器 | i7-12700KF（12C/20T）、31.84 GiB RAM、Windows 11 Pro Insider Preview 10.0.29683 |
| 运行方式 | 直接执行 armA/armB 测试二进制（不经 cargo，避免 target 锁）；每轮独立进程、独立 JSONL、独立测试根 |

臂身份不是从文件名推断：每轮首行打印 `arm/permits/feature`，`SP022_AB_EXPECT_PERMITS` 误设会 panic，C01 在两臂分别断言 `peak_reserved = permits × 544 MiB`。

## 4. 正确性结果

命令（cwd `D:\SpMusic`）：`& <arm>.exe "audio::cover_pixels::tests::" --nocapture --test-threads=1 --skip sp022_p2_ab`。

| 臂 | 结果 | 时间 |
| --- | --- | --- |
| A | **26 passed / 0 failed / 1 ignored**（165 filtered） | 3.16 s |
| B | **26 passed / 0 failed / 1 ignored**（165 filtered） | 2.83 s |

两臂均通过 `sp022_c01_admission_stays_below_the_permit_count`、`sp022_c02_same_key_flight_decodes_once`、`sp022_c06_cancelled_caller_keeps_the_admission_slot`，且既有 23 项封面测试与 generation 相邻测试全绿：

- **C01**：4 个不同键在可控 barrier 驻留时，`active_workers`/`peak_active_workers` 恰等于 N（A=1、B=2），`peak_reserved = N×544 MiB`，gate 到达数 = N；释放后 4 个全部完成、活动与 reserved 归零、writer 每键 1 次入队。
- **C02**：同键 4 并发（2 个 clientId，leader 被 barrier 卡住）→ `decode_calls=1`、`flights_leaders=1`、`flights_joined=3`、4 份响应逐字节等于单跑、writer 增量 1；再分别取消 1 个 waiter 与全部 waiter，leader 完成、其余 waiter 正常完成。
- **C06**：请求进入阻塞闭包后 abort 外层 future，`active_workers` 仍为 1、`reserved` 仍为 544 MiB；N=1 下不同键 B 无法进入闭包，N=2 下可达 2；释放后 B 完成、计数归零，新请求仍可完成。

## 5. P2 代理协议与结果

协议：60 张固定封面；客户端并发 c=2（每槽串行、全局最多 2 个在途，对应前端视觉 2 槽）；每个 arm 每轮全新进程与全新测试根（无缩略图、冷派生缓存）；顺序 AB / BA / AB / BA / AB。

这里的“冷”仅指派生缓存起点：harness 在计时前从媒体抽出封面，并逐张调用 `load_cover_pixels_blocking` 验证可解码，再复制至本轮新根。OS 文件缓存和 codec 路径已受准备阶段预热，不能称为严格磁盘冷或进程内首次 codec 初始化。两臂使用同样准备流程；该设计不消除其与真实首次浏览路径的差异。

| 轮 | 对 | 臂 | 批次墙钟 ms | p50 ms | p95 ms | p99 ms | 准入等待 | 峰值活动/许可 | 峰值 WS / Private MiB |
| --: | --: | :--: | --: | --: | --: | --: | --: | :--: | --: |
| 1 | 1 | A | 3,381.210 | 82.3 | 265.8 | 275.9 | 59 | 1/1 | 61.90 / 59.30 |
| 2 | 1 | B | 1,731.299 | 37.4 | 143.4 | 145.8 | 0 | 2/2 | 69.88 / 68.64 |
| 3 | 2 | B | 1,761.675 | 39.3 | 146.7 | 150.5 | 0 | 2/2 | 71.38 / 69.38 |
| 4 | 2 | A | 3,382.992 | 81.9 | 264.2 | 280.3 | 59 | 1/1 | 65.11 / 59.84 |
| 5 | 3 | A | 3,392.306 | 80.6 | 268.6 | 280.8 | 59 | 1/1 | 61.68 / 59.68 |
| 6 | 3 | B | 1,756.269 | 37.6 | 144.3 | 153.0 | 0 | 2/2 | 75.33 / 69.96 |
| 7 | 4 | B | 1,770.428 | 38.7 | 144.9 | 155.6 | 0 | 2/2 | 71.55 / 69.47 |
| 8 | 4 | A | 3,494.469 | 85.7 | 272.7 | 285.1 | 59 | 1/1 | 59.28 / 59.51 |
| 9 | 5 | A | 3,488.402 | 85.6 | 273.7 | 281.3 | 59 | 1/1 | 59.22 / 59.62 |
| 10 | 5 | B | 1,769.949 | 38.1 | 147.8 | 150.4 | 0 | 2/2 | 74.59 / 70.47 |

## 6. 独立复算与配对统计

原执行者以自写脚本复算 JSONL；本次复核另用只读 PowerShell 核对主数据的逐请求时刻、计数、配对与中位数。批次墙钟与活动/解码/writer 计数仍来自 JSONL summary，逐请求时刻另算 span 作交叉检查，不能视为完全独立于被测探针的观测：

| 统计 | A（N=1） | B（N=2） | A/B |
| --- | --: | --: | --: |
| 批次墙钟均值 / 中位 / 范围 | 3,427.876 / 3,392.306 / 3,381.2–3,494.5（样本标准差 58.2） | 1,757.924 / 1,761.675 / 1,731.3–1,770.4（样本标准差 16.0） | **逐对比值均值 1.9499 / 中位 1.953** |
| 逐请求 p50 / p95 / p99（5 轮中位） | 82.3 / 268.6 / 280.8 ms | 38.1 / 144.9 / 150.5 ms | 2.16 / 1.85 / 1.87 |
| 平均请求时长 | 112.3 ms | 58.5 ms | 1.92 |
| Σ时长 / 墙钟 | ≈1.99 | ≈1.99 | — |

逐对 A/B 墙钟比：**1.9530 / 1.9203 / 1.9315 / 1.9738 / 1.9709**，中位 1.9530、均值 1.9499，**5/5 同向**（B 更快）；等工作量吞吐增益为 +95.3% / +92.0% / +93.2% / +97.4% / +97.1%，对应耗时降低 48.80% / 47.93% / 48.23% / 49.34% / 49.26%。用 JSONL 的 `max(end)−min(start)` 另算与 harness 汇总差最大 0.207 ms。这里的配对比值中位数与“两臂中位数相除”是不同统计量。

冷态与账本（20 次 P2 进程全部一致）：

- `ok=60`、`errors=0`、`hits=0`、`misses=60`、`pending_hits=0`、`decode_calls=60`、`unique_keys=60`、`sample_digest` 每轮相等、两臂 `response_bytes=3,930,976` 相同。
- writer：`enqueued=60 / written=60 / already_present=0 / skipped=0 / coalesced=0`，排空 2.4–3.5 ms；`pending=0`。
- `peak_reserved`：A=544 MiB、B=1088 MiB（= permits×544 MiB，≤ 1088 MiB 预算）；`admission_waits`：A=59、B=0；`peak_active_workers`：A=1、B=2；`singleflight_joins=0`（P2 的 60 个键互不相同，同键由 C02 单独覆盖）。

## 7. 内存、控制与解释边界

- **内存**：以外部 `.NET Process` 每 250 ms 采样 `WorkingSet64`/`PrivateMemorySize64`，峰值 A 约 59–65 MiB、B 约 69–75 MiB（测试进程整体）。`peak_reserved` 是**记账值**（544/1088 MiB），不是真实 RSS；外部采样可能漏掉 <250 ms 尖峰。第 4.7 节的 544 MiB 是代码上限推导的保守预留（含 codec scratch 允差），非典型用量。
- **并行归因**：JSONL 的 `start_ms` 在准入 await 之前取，区间重叠只能证明"在途请求=2"；解码真正并行由被测实现内部 `#[cfg(test)]` 计数器与 A/B 墙钟结构（A 平均时长约为 B 的 1.92 倍）支持——这部分证据在仓库内实现里，Repository 外无法独立复算，属证据口径限制。
- **逐请求命中归因限制**：harness 在每个请求前后读取共享 `SP022_DECODE_CALLS`，以计数是否增加生成该请求的 `hit`。并发重叠时，其他请求的解码也可改变该值，因此该字段不是独立的请求级命中证据。累计 `THUMBNAIL_BENCH_HITS/MISSES`、唯一键数、成功数与解码数在本批一致，但不能仅由 `decode_calls == misses` 推出每个键恰好解码一次；同键行为需依赖 C02 与实现核对，未来探针应在实际分支记录请求/flight 归因。
- **宿主漂移**：首轮执行（内存采样脚本失效前）计时仍有效并保留（比值中位 1.9782、均值 1.9772，A 均值 3,464.3 / B 1,752.2，与主数据集差 ≤1.3%）；主数据集是在相同协议下重跑的 10 轮。运行期间无 cargo/npm 构建。
- 首次 10 轮的内存采样因 `System.Diagnostics.Process` 对象缓存进程信息而冻结（用 200 MB 分配子进程校准证实），未删除该批计时数据，改用 `Get-Process` 重新采样后重跑主数据集。

## 8. 偏差、残余风险与缺口

**必须随数字复述的偏差**

1. 这是 coordinator 级代理：**不含** Tauri IPC、前端两槽队列、hydrate、BMP/ObjectURL、React 发布与 GPU；不能外推为用户可见延迟。
2. 单机、单样本集（60 张）、单并发（c=2）、无长跑资源平台、无高 DPR/其他布局/10,000 首。
3. 60 张为 83 张样本前缀，digest 与 83 张不同属预期。
4. P2 未覆盖同键单飞（键互异），同键只由 C02 覆盖；未覆盖 C03–C14、G16/G20。
5. 在途预算无拒绝路径、无新错误码、无等待队列上限（G6 部分满足、C08 未验证）。
6. 本轮不是计划 §8 P2 的完整执行：未用历史固定 60 首清单逐请求 hydrate→256px，未做 C/W 各 5 对与 83 张并发桥接；A0↔A 的 5 对安全机制开销对照亦未完成。60 张纯像素代理的收益不能替代这些缺口。

**残余设计风险（实验代码，已回退、不进入产品）**

- 若阻塞闭包在 `publish` 前 panic，单飞注册表条目会滞留，同键后续请求可能等待不到结果；本轮未构造该场景（C10 缺口）。C10/C11 的系统级条件也未覆盖。
- 等待者复检为 2 处（leader 4 处），与 A0 非逐位等价；"陈旧 leader 仍共享像素但不落盘"是本轮新增行为，C07 未专项验证。
- 编解码器 scratch 的 `+1×decoded` 是允差假设，未用 8192×8192 级夹具实测。

## 9. 决策含义

1. **代理层收益显著且方向稳定**：B 的 60 张冷批次墙钟约为 A 的 1/1.95（配对 5/5 同向，波动远小于差值），远超 §10.2 提议的"配对中位数降低 ≥20%"代理门槛；但这只是进入下一阶段的依据，不是验收。
2. **资源代价可观察**：B 的记账在途额度翻倍到 1088 MiB（仍等于共享预算上限），外部工作集峰值约 +10 MiB；预算/过载路径未触达。真实 UI 还需验证 Renderer/GPU、挂载 URL、帧与完成率。
3. **不能据此宣布 SP-022 完成或完整 P2 通过**：先补齐候选安全合同与适用正确性证据，以及 A0↔A / 完整 P2 的未覆盖项；满足必要闸门后再进入 P3（真实 Release WebView2 的 A↔B，含冻结目标集合、可见至自身 `load`、完成率、帧与资源）。P3 仍受隔离/入口条件与 PM 数值确认约束。
4. 用户要求回退已执行：实验源码不留在工作树；两臂二进制与 patch 只作本地证据；普通 Release 的默认构建（feature 关闭）与运行身份复核仍应在新会话或下一阶段补做。

## 10. 回退与复核

- 回退命令：`git checkout -- src-tauri/src/audio/cover_pixels.rs src-tauri/Cargo.toml`（`Cargo.lock` 从未改动）。
- 回退后 `git status --short` 只保留既有文档改动与原三份未跟踪文档 + 本报告；`git grep -n "sp022\|PLAYLIST_DECODE_PERMITS" -- src-tauri` 无输出（exit 1）。
- 回退后 `cargo check --release --lib`（cwd `D:\SpMusic\src-tauri`）`exit_code=0` 且无 warning；`cargo test --release --lib audio::cover_pixels::tests` 为 **23 passed / 0 failed / 1 ignored**（1.72 s），`cargo test --release --lib playlist_generation_` 为 **2 passed / 0 failed**。即工作树恢复到 HEAD 的普通实现且回归全绿。
- 回退前已保存 `code.patch`（SHA-256 `2471B464…C9D54A7D`）与 `implementation-notes.md`；两臂二进制 SHA-256 已记录，回退后不再引用 `target/` 下的构建产物作身份证据。
- 回退前由两臂运行产生的 2 个 `%TEMP%\spmusic-cover-pixels-*` 沙箱（15:37:58、15:43:11，各含 1 个 `.spxr`）按"未获清理授权"保留，未删除；其余各轮沙箱由 `TestDirectory::Drop` 自动删除。

## 11. 证据位置

| 内容 | 位置 |
| --- | --- |
| 主数据集（10 轮 P2） | `%TEMP%\sp022-ab\run-20261020-154511-memfixed\`（43 文件：manifest、每轮 stdout/stderr/JSONL/内存 CSV、postcheck） |
| 首次执行（计时保留、内存采样失效） | `%TEMP%\sp022-ab\run-20261020-154251\`（44 文件，含两臂正确性日志） |
| 独立复算脚本与结果 | `%TEMP%\sp022-ab\analysis-20261020-154634\`（`recompute.py`、`recompute-result.txt`） |
| 实现 patch / 说明 / 二进制 | `%TEMP%\sp022-ab\code.patch`、`implementation-notes.md`、`armA.exe`、`armB.exe` |
| 前序闸门复核与 A0 基线 | [闸门复核](sp-022-backend-cover-concurrency-gate-review.md)、[性能基线](sp-022-playlist-performance-baseline.md) |

所有临时证据在本机 `%TEMP%`，不含曲名、媒体路径、trackId 或 Object URL；尚未长期归档。

## 12. 2026-10-20 独立复核更正记录

本次只读复核主数据 `run-20261020-154511-memfixed` 的 10 份逐请求 JSONL/summary/stdout、首次执行的 10 个 summary、既有 `analysis-20261020-154634/recompute-result.txt` 与 `code.patch`，未重跑原实验。命令为 `Get-Content`、`Get-ChildItem`、`rg -n`，以及内联 PowerShell `ConvertFrom-Json`/`Measure-Object`/`Sort-Object` 统计；均退出 0，未写原始证据。

- 原稿摘要/§6 的 B 中位数 `1,751.919 ms` 属首次执行数据，被误带入主数据；主数据排序中间值是 `1,761.675 ms`，既有复算结果也记录此值。本次已更正，首次执行原始证据保留。
- 关联闸门报告追加段原写“B/A = 1.953”，实际是 A/B；真实 B/A 配对中位约 0.512。配对 5/5 同向、约 1.95× 吞吐方向不变。
- 补记准备阶段预解码、共享计数器的逐请求命中归因限制与完整 P2 未覆盖项，收紧“累计相等即每键恰好一次”的推断。
- 这是对旧候选与旧数据的复核，旧回退记录仍描述当次执行；后续安全候选的变更和验证须另立报告，不把新代码身份套用到本报告的旧结果。
