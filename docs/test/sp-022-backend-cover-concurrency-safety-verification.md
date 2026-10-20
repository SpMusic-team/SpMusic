---
doc_id: "TEST-SP-022-BACKEND-COVER-CONCURRENCY-SAFETY"
title: "测试报告：后端封面并发候选安全合同独立验证"
doc_type: "test-report"
status: "in-review"
owner_agent: "Test Agent"
version_scope: "SP-022 默认 N=1 安全基础及 N=2 合成实验候选"
created: "2026-10-20"
updated: "2026-10-20"
source_documents:
  - "user request: 你来进行下一步吧"
  - ".agents/prompt/Test_Agent.md"
  - "docs/architecture/sp-022-backend-cover-concurrency-safety.md"
  - "docs/implementation/sp-022-backend-cover-concurrency-safety.md"
  - "docs/tasks/sp-022-backend-cover-concurrency-experiment-plan.md"
  - "docs/test/sp-022-backend-cover-concurrency-test-plan.md"
  - "docs/test/sp-022-backend-cover-concurrency-p2-ab-report.md"
  - "src-tauri/src/audio/cover_pixels.rs"
  - "src-tauri/Cargo.toml"
---

# 测试报告：后端封面并发候选安全合同独立验证

## 摘要

本轮限定的后端安全合同通过独立源码复核与两臂合成回归：默认 N=1 为 31 passed / 1 ignored，feature N=2 为 33 passed / 1 ignored；新增安全组每臂至少执行 5 次，全部通过。默认仍为 N=1，未增加前端槽位。

该结论只覆盖本轮所有权、异常清理、内容身份、请求与等待者数量上界及相邻回归。新候选性能、完整 P1/P2、真实 UI、长期资源和 codec RSS 硬预算仍为证据不足，不能宣布 SP-022 完成、N=2 可产品化，或将旧实验约 1.95× 吞吐套用到新结构。

## 范围

独立读取冻结的安全合同、实现说明、当前 Rust diff 和现有前端重试分支；仅执行 Rust Release 静态检查与合成夹具测试。未运行 ignored 曲库 benchmark，未启动应用、WebView2 或用户安装版，未访问真实曲库及用户封面缓存。动态夹具使用既有 `TestDirectory` 在系统临时目录创建独立根并清理。

## 实现交付与证据完整性

- 实现 Owner：Rust/Tauri Agent；Architecture Agent 先冻结合同并终审，无阻塞性实现问题。
- 业务变更：`src-tauri/src/audio/cover_pixels.rs` 和 `src-tauri/Cargo.toml`；未新增依赖。前端、命令层、权限、配置与 `Cargo.lock` 无本轮业务 diff。
- 基线：HEAD `07658d6a625579f52c4c5331927db845ba157d4b`。原 A0 的 async 局部锁在调用方取消后不能约束仍运行的 blocking 工作，历史 patch 的显式 publish 缺异常清理，均为静态可确认的结构缺口；未重跑 A0 的生产取消或对照性能，不能称已复现线上故障。
- 因果链：外层取消/leader unwind → 真实工作或 flight 仍存在 → 旧所有权/终态机制不足 → 活动可越界或等待者悬挂。本轮以受控门、调用方 abort、已注册 leader 的 unwind 与后续同键恢复，检查源头修正是否改变预测信号。
- 独立验证前后 `cover_pixels.rs` SHA-256：`15325D77FA3B60F24178B0A4350B34D9E4373B2577B0C201954BB901B9998A2A`。
- `Cargo.toml` SHA-256：`D06A793D01E239DAFC2F0775EC6EE5B47E5848246E6AD00CF82A824CCAB522CE`；首次所读安全合同 SHA-256：`A77E24FF191343FF770BC919E1EAAA4AA549D628A79255925200FA569B14ECEF`，Architecture 补记终审后为 `CEF3A240139D17AA4E2B185C5B5297E7DA0EB867285D50248A41D3F7B7396878`，新增记录已核对，未改变被测源码。
- 当前两文件 diff 归档在下述证据根的 `verified-implementation.patch`，SHA-256 `E136BD7B437CB48B2223855D73E6F0FB6BE1911C4B2809EA4BCD69DD383F2CCD`（PowerShell UTF-8 文本归档）。它与历史 `sp022-ab/code.patch` 是不同候选，不混用身份。
- 证据根：`%TEMP%\sp022-safety-independent-8d3dd3c08cab455d8f8e6941eafde636\`，14 份命令日志及上述 patch；尚未长期归档。

## 命令

以下由 Test Agent 独立执行，cwd `D:\SpMusic\src-tauri`，均退出 0。每条命令的 stdout/stderr 保存到证据根，未与实现者同时使用 cargo。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `cargo test --release --lib audio::cover_pixels::tests -- --test-threads=1` | 31 passed / 0 failed / 1 ignored，2.16 s | `01-default-cover.log` |
| `cargo test --release --lib --features sp022-playlist-decode-n2 audio::cover_pixels::tests -- --test-threads=1` | 33 passed / 0 failed / 1 ignored，2.15 s | `02-n2-cover.log` |
| `cargo test --release --lib playlist_generation_ -- --test-threads=1` | 2 passed / 0 failed | `03-default-generation.log` |
| `cargo test --release --lib --features sp022-playlist-decode-n2 playlist_generation_ -- --test-threads=1` | 2 passed / 0 failed | `04-n2-generation.log` |
| `cargo check --release --lib` | 通过，无 warning | `05-default-check.log` |
| `cargo check --release --lib --features sp022-playlist-decode-n2` | 通过，无 warning | `06-n2-check.log` |
| `cargo test --release --lib sp022_safety_ -- --test-threads=1`，另执行 4 次 | 每次 8 passed / 0 failed | `repeat-default-2.log` 至 `repeat-default-5.log` |
| `cargo test --release --lib --features sp022-playlist-decode-n2 sp022_safety_ -- --test-threads=1`，另执行 4 次 | 每次 10 passed / 0 failed | `repeat-n2-2.log` 至 `repeat-n2-5.log` |

全 cover 的一次执行加安全 filter 的四次执行，使每臂适用安全组至少有 5 次独立测试进程记录。默认新增 8 组，N=2 新增 10 组；两组真实 Joined 交错由 `#[cfg(feature = "sp022-playlist-decode-n2")]` 限定，不计为 N=1 已执行。generation 两组已包含于 cover 套件，单列重跑不增加独立用例数。真实曲库 benchmark 在两臂均保持 ignored。

主协调 Agent 执行的集成检查（非 Test Agent 自跑）：`npm run lint`、`npm run build` 均退出 0，构建有 >500 kB chunk 提示；最终 `cargo check --release --lib`、`rustfmt --edition 2021 --check src/audio/cover_pixels.rs`、`git diff --check` 均退出 0。主协调另核对 `Cargo.lock`、既有父计划和 baseline 未变。本轮前端无改动，未重复 npm 检查。

只读辅助命令为 `Get-Content`、`rg`、`git diff`、`Get-FileHash`、`Select-String`。首次对 `docs/implementation/sp-022*` 作路径参数的 `rg` 在 Windows 报错误 123，随后改用 `rg -g 'sp-022*' ... docs/implementation`；当时说明尚未落盘，最终已读取成稿。这不影响测试或验收覆盖。日志以大小写敏感的实际失败/告警行匹配复核，14 份均无失败或 warning；未将 `0 failed` 当成失败信号。

## 人工检查

- 原始主数据纠错：只读复算后同步三份测试文档，B 中位改为 1,761.675 ms、比值改为 A/B；保留原稿错误与更正来源，详见旧代理报告 §12。
- 真实列表停下后的最终封面、快滚/反向、面板重开、播放器切歌：未验证。
- 普通 Release 应用运行身份、profile 隔离与持久化冒烟：未验证；本轮只运行 Rust 测试程序。

## 根因与因果链反证

| 关键主张 | 独立核对结果与替代假设 |
| --- | --- |
| 取消外层不提前放行真实工作 | 在 Entered 门驻留 N 个 worker 后 abort 外层，仍持 N 个请求名额、无可取 token；后续请求排队，释放后峰值为 N、请求与 flight 回零。排除“只让外层计数归零，后台仍无界运行”的替代解释。permit 在生产闭包首行绑定，覆盖读图之前到闭包退出。 |
| leader panic 不留悬挂 flight | registry unwind 测试及 N=2 真实 load 注入在有效 waiter 已加入后执行，waiter 获 WORKER_FAILED，entry 移除，后续同键可成功；Drop 关闭通道而不在 unwind 中分配错误字符串。并非只在调用方 JoinError 后做清理。 |
| 去重基于实际内容且不绕过校验 | 相同字节不同路径只完整解码一次；改写同路径内容后返回不同像素；不同档位不合并；根/transform/disk version 在 registry 层独立隔离。生产路径先校验、读取和哈希，再注册，解码使用同一份已读 bytes；非法外部路径仍拒绝。 |
| 请求、waiter 取消不累积无界资源 | 第 33 请求即时 WORKER_FAILED(false)，无 worker 进入；取消 32 个排队任务后归零并可恢复。registry 100 次 join/drop 后 sender 不积累，32 活跃 waiter 满额拒绝额外加入。 |
| 独立消费者不会相互取消/污染 generation | N=2 leader abort、leader stale、leader panic、坏图各有受控交错；有效 waiter 按内容成功或收到共同内容失败。取消一个 waiter、仅推进另一个 waiter generation 后，其余有效消费者仍得到一致像素，stale 消费者自身返回 STALE_REQUEST。 |

未观察到隐藏错误、扩大生产重试、扩大生产超时、放宽失败断言或用延时触发竞态的处理。测试门用通知固定交错，10/15 秒超时只用于发现测试悬挂；它不是生产兜底机制。进程 abort/OOM abort/OS 强制终止不运行 Rust Drop，不在普通 unwind 恢复结论内。

## 跨层契约

- 类型与序列化：既有列表输入字段、SPXR v1 字节输出、错误枚举及 camelCase 序列化保留；内部 `Complete/Joined` 不穿越 Tauri 命令边界。`CoverPixelsError` 新增 Clone 仅支持共享终态。
- 命令/事件/权限：无本轮改动；播放器 `REQUEST_COORDINATOR` 与列表 slots/requests/flights 分开。未通过跨层动态运行证明播放器连续性。
- 新增错误触发：32 请求名额或 32 waiter 满额使用既有 `WORKER_FAILED`、`recoverable=false`，不能描述为错误行为完全不变。源码核对前端 `useAudioPlayer.ts` 仍按 code 最多重试两次，不依赖 recoverable；后端无新增重试。过载下视口最终完成率待 UI 验证。
- 生命周期：permit 移入真实 worker；请求名额随 `Complete/Joined` 结果移交，覆盖返回值尚未消费和最终 Vec clone。waiter 的共享 `Arc<Vec<u8>>` 与自身 generation 分开，stale 不作为共享像素失败传播。

## 回归覆盖

既有 23 组封面回归在两臂均通过，包含协议、方向校正、缩放、档位、路径、缓存命中/原图改变/损坏回源、临时文件清理、writer 双限/失败统计及不可写目录。新增组的主要证据层级如下：

| 合同项 | 覆盖层级 |
| --- | --- |
| 真实活动、取消、请求恢复 | 实际 coordinator load + 合成 PNG + 可控门，两臂 |
| 内容别名、同路径改变、档位、非法路径 | 实际 coordinator load，两臂；N=2 真正 Joined，N=1 后续 pending/磁盘复用 |
| 根/transform/disk version 隔离 | registry 键测试 + 生产键构造静态核对，未伪称全部字段有跨根公共入口动态用例 |
| 普通 panic、关闭 sender、重新注册 | registry 两臂；真实 Joined fan-out 仅 N=2 |
| FIFO 队首/中间取消、幸存者继续 | slots 层手动 poll 建立实际队序，取消 0/2，观察 1/3/4 依次准入并重新取得全部 token |
| 排队 stale、client 独立 | 既有 generation coordinator 测试；未覆盖完整“不同内容 + FIFO + 部分 stale + 部分取消”的单一组合压力场景 |
| 完成结果仍占请求名额 | `Complete` 所有权测试和代码核对，非外部 RSS 测量 |
| writer 接受先于 flight 移除 | 生产顺序静态核对，既有缓存/writer 回归；未新增暂停 writer 并观察交接瞬间的专项用例 |

以上层级满足本轮最小安全合同的适用证据；未把完整原计划 C01～C14 或真实系统故障矩阵标为全通过。真实系统写满、全部大图/codec、全取消消费者的长跑、应用关闭并重启等仍未覆盖。

## 性能 / 时序

本轮没有新性能 A/B，也未运行 A0↔A 成本对照。测试耗时不是封面性能指标；安全结构已改变，不继承旧候选约 1.95× 的测量结论。

时序证据覆盖取消后 token 不归还、无界 waiter churn 的反证、FIFO 幸存次序、ordinary unwind 终态及 generation 独立。输入在 permit 内受限读取，entry 数生产上受 N 限制、请求数受 32 限制；这是所有权和数量证据，不是进程 RSS 的硬限证明。

读取逻辑长度 ≤16 MiB，读取哨兵为 16 MiB+1，Vec capacity/allocator 扩张另计；方向校正双份、Lanczos 最高约 128 MiB/任务、坏缓存暂存、共享响应与每消费者 Vec 拷贝、writer 128 项/32 MiB 均按实现说明单列。没有外部 memory sampler 或边界大图实测，codec scratch 仍是 best effort，撤回“544/1088 MiB 记账即硬预算”的推断。

## 发现

本轮独立验证未发现阻塞该限定后端安全合同的失败。旧代理报告的 B 中位数、比值方向、预解码缓存口径和逐请求 hit 归因问题已更正，并保留修订来源。

## 风险

新容量拒绝可能走前端既有有限重试；真实过载完成率未验证。codec scratch、allocator 高水位、IPC/Renderer/GPU 持有、大图峰值与长期回落没有硬界或动态证据。公开入口跨根隔离、writer 原子交接瞬间和混合 FIFO/stale 压力仍以静态/分层证据为主，后续若扩大并发范围应补专门动态覆盖。

## 临时缓解

本轮对所有权、flight 异常清理与有限排队作源头修正，未将默认 N=1 作为掩盖共享缺陷的临时缓解。N=2 仍只由编译期实验 feature 启用；不得默认产品化。Rust/Tauri Agent 继续负责实现，后续隔离、资源和端到端证据由对应阶段提供，PM 决定后续范围与性能门槛。

## 验证结论

**本轮限定的后端安全合同：通过。** 默认与 feature 两臂实际执行的适用合成组、静态边界及既有回归证据一致，没有观察到取消提前释放、普通 unwind 悬挂、内容键误合并或请求/等待者数量越界。

**完整 SP-022、P1/P2 性能、P3/P4 和 N=2 产品化：证据不足，未验收。** 本轮通过不消除上述阶段的必要闸门，也不构成用户可见提速承诺。

## 建议

可交主协调/PM 审阅本轮默认 N=1 安全基础与受限 N=2 候选。下一阶段先冻结适用隔离和数据协议，再为新结构补 A0↔A 代价、完整 P2 与真实 UI 证据；保持旧候选与新候选身份及测量结论分离。
