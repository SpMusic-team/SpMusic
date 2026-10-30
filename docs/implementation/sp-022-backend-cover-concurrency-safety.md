---
doc_id: "IMPL-SP-022-BACKEND-COVER-CONCURRENCY-SAFETY"
title: "播放列表封面后端并发候选的安全修正"
doc_type: "implementation"
status: "in-review"
owner_agent: "Rust/Tauri Agent"
version_scope: "SP-022 默认 N=1 安全基础及 N=2 实验候选"
created: "2026-10-20"
updated: "2026-10-20"
source_documents:
  - "user request: 你来进行下一步吧"
  - "docs/architecture/sp-022-backend-cover-concurrency-safety.md"
  - "docs/tasks/sp-022-backend-cover-concurrency-experiment-plan.md"
  - "docs/test/sp-022-backend-cover-concurrency-test-plan.md"
  - "docs/test/sp-022-backend-cover-concurrency-p2-ab-report.md"
  - "src-tauri/src/audio/cover_pixels.rs"
  - "src-tauri/Cargo.toml"
  - "本机历史实验 sp022-ab/code.patch 与 implementation-notes.md"
---

# 播放列表封面后端并发候选的安全修正

## 结果与适用范围

本轮按 [安全契约](../architecture/sp-022-backend-cover-concurrency-safety.md) 重做后端候选，保留可审阅源码。默认构建仍为 **N=1**；`sp022-playlist-decode-n2` 只把同一实现的 pipeline 许可数改为 2。前端视觉槽保持 2。

本轮修复调用方取消后的许可所有权、单飞 panic 清理、真实内容身份及请求/等待者数量边界，使用合成夹具验证。没有套用历史实验 patch，没有读取真实曲库、运行手动 benchmark、启动应用或改动用户缓存。本轮结果不证明用户可见封面延迟改善，也不批准 N=2 产品化。

## 根因与修复

| 证据与触发 | 因果链 | 本轮处理 |
| --- | --- | --- |
| 原实现 async `run_registered` 局部持锁并等待 `spawn_blocking` | 外层 future 被取消 → 局部锁释放 → 实际阻塞工作继续 → 真实活动上界可能失守 | 先取许可，再将许可移入阻塞闭包；闭包正常、错误或 unwind 退出才归还 |
| 历史 patch 只有显式 `publish`，无异常完成守卫 | leader 注册后 panic → 不发布、不移除 → 有效 waiter/后续同键可能永远等待 | leader 在闭包持有 RAII 守卫；普通 unwind 移除 entry 并关闭等待通道，消费者映射为 `WORKER_FAILED` |
| 历史单飞键使用原样路径 | 同内容不同路径无法合并；若以路径提前合并，可能绕过各请求校验或复用变化后的旧内容 | 每个请求独立校验并受限读取，以本次完整字节的 BLAKE3 加 canonical 根、档位和版本作键；解码消费同一份字节 |
| 原门的等待队列、历史 waiter Vec 无数量上限 | 排队或反复 join/cancel → 请求/已关闭 sender 可能持续增长 | 请求总名额 32；每 flight sender 上限 32，追加前清除关闭 sender；满额立即拒绝 |

这是结构性缺口与受控交错验证；没有把原路径取消可达性声称为已观测的线上故障。历史 patch 的 panic 风险来自代码与报告，本轮用 leader 已注册、有有效 waiter 后的注入重建异常清理路径。

## 所有权与时序

`PlaylistCoverRequestCoordinator::load` 先验证档位与自身会话，再 try-reserve 请求名额，等待 FIFO pipeline 许可并复检会话。许可与请求名额一起移入 `spawn_blocking`。闭包复检会话后完成路径校验、读取、哈希，再注册内容 flight。

- 新 flight：持有 `PlaylistFlightLeader`，查缓存或解码/缩放/打包。正常 miss 对 writer 执行 `try_enqueue` 后，才发布共享 `Arc<Vec<u8>>` 并移除 flight。writer 接受时，pending 先于 flight 移除可见。
- 已有 flight：阻塞闭包返回内部 `Joined(receiver, request_reservation)`；已读输入与 pipeline 许可随闭包退出释放，等待转到 async。每消费者拥有容量 1 通道，不占阻塞线程等待另一个 worker。
- 完整结果：`Complete(outcome, request_reservation)` 继续持有名额，包含结果在 Tokio 移交途中尚未消费的阶段；最后复检自身 generation 并复制返回像素后才释放名额。
- 已启动 worker 的外层调用取消：闭包继续，许可/名额不会提前归还。只取消 waiter：仅丢弃其 receiver/名额。普通 panic：flight 守卫移除 entry、关闭 sender；有效 waiter 在消费者侧生成同一内部错误，清理 Drop 不分配错误字符串、不 await。

共享结果不含 `STALE_REQUEST`。陈旧 leader 不交 writer，但仍可向有效 waiter 发布像素，自己返回 stale；陈旧 waiter 不能借有效 leader 发布响应。正常命中也在返回前复检自身会话。stale leader、writer 拒绝持久化、淘汰或损坏之后允许新请求再次解码，不建立永久结果表来追求无限期恰好一次。

注册表仅在持有 pipeline 许可的闭包中新增 entry，因此生产 entry 数 ≤N；每 entry 的 sender 数 ≤32。正常发布消费守卫并清空其 key，Drop 不会再删除后来同键的新 entry。注册与发布使用同一短 mutex 临界区，poison 恢复不重新 panic。

## Commands / API 与错误兼容

`audio_load_playlist_cover_pixels` 继续使用既有 `clientId/filePath/maxEdge/windowGeneration` 输入及 SPXR v1 字节输出；命令层、权限、输入档位、缓存文件键、writer 双限和退出策略未改。播放器大图 coordinator 的实现未改，列表名额与它独立。

容量拒绝使用现有 `WORKER_FAILED`、`recoverable=false`，没有新增公共错误码或后端重试。这是**新增拒绝触发**，不能说错误行为完全相同。当前前端按错误 code 最多重试两次，不依赖 recoverable，因此满额可能走既有有限重试；过载下最终视口完成率仍待后续 UI 测试。

未增加依赖。`Cargo.toml` 只声明空默认 feature 与实验 feature，`Cargo.lock` 未改。两个构建使用相同生产实现，唯一 feature 控制的生产差异是 N；两个真实 Joined 交错测试仅在 N=2 测试构建编入。

## 内存边界与未证明的部分

本轮没有沿用“每请求 544 MiB、总量 1088 MiB 即硬内存预算”的自验证。已锁定的 image 0.25.10 `max_alloc` 是 best effort，不能把 codec scratch 取一个经验倍数当作经证明上界。完整进程 RSS 硬限仍是 N=2 产品化门槛。

| 持有点 | 已有或新增约束 | 必须保留的区别 |
| --- | --- | --- |
| 受限原图读取 | 输入逻辑长度 ≤16 MiB；同时处于真实读取/管线的输入份数 ≤N | `read_bounded_file` 的读取哨兵为 16 MiB+1；按 metadata 预留后增长可能产生更大 Vec capacity，逻辑 len 不等于 allocator capacity |
| 解码源像素 | 源边 ≤16,384，像素 ≤64 Mi，报告输出 ≤256 MiB；完整解码前验证 | 不代表所有 codec 内部分配已被严格限制 |
| 方向校正 | 沿用既有算法 | 旧图与旋转副本可能短暂同时存活，需计双份 |
| Lanczos | 固定实现的 f32 中间图为 `source_width × target_height × 16`，保守 ≤128 MiB/任务 | 不能沿用仅按 8192 方图估出的 64 MiB |
| 正常列表 SPXR 响应 | 每份 ≤40+512×512×4=1,048,616 字节 | leader 的 Arc 共享不复制像素；最终每消费者 `Vec` 返回有一次复制，复制时名额仍被持有 |
| 缓存读入/校验 | 沿用已有缓存读限和 SPXR 校验 | 文件读取在列表档位验证前可暂存约 36 MiB+84 字节的坏缓存；解析、pending 复制也不能被最终 1 MiB 响应上界概括 |
| 已完成但未消费、Joined 等待 | 请求名额最多 32，guard 随结果移交，输出引用受请求名额约束 | 后端最终返回后 Tauri/Renderer 的响应持有不再属于此 guard |
| flight 与通道 | entry ≤N、sender/entry ≤32、channel 容量 1 | 取消 churn 清理关闭 sender，不能只用存活请求数推断历史 sender Vec 大小 |
| writer | 既有 128 项/32 MiB | 单列，不把 writer 持有的像素记作 flight 泄漏 |
| IPC/前端/allocator | 未建立本轮硬界 | 需要后续真实 UI、private/working-set 及长期回落证据 |

受控门测试验证真实闭包上限、取消后名额继续持有及归还时序；响应移交测试验证 guard 与结果共同持有。没有运行大图压力或外部内存采样，没有将小图测试资源或固定常量记账当作 RSS 上限证据。

## 实现者验证

以下为自测，不能代替 Test Agent 独立验证。所有动态输入为合成图片，既有 `benchmark_real_playlist_covers` 保持 ignored。

| 命令（cwd `src-tauri`） | 结果 |
| --- | --- |
| `cargo check --release --lib` | 通过，无 warning |
| `cargo check --release --lib --features sp022-playlist-decode-n2` | 通过，无 warning |
| `cargo test --release --lib audio::cover_pixels::tests -- --test-threads=1` | 默认 N=1：31 passed，0 failed，1 ignored；其中既有 23 项、新增 8 项 |
| `cargo test --release --lib --features sp022-playlist-decode-n2 sp022_safety -- --test-threads=1` | N=2：10 passed，0 failed |
| `git diff --check` | 通过 |

新增测试覆盖：panic 关闭通道并移除 flight 后同键重建；100 次 join/cancel churn 与 32 waiter 上限；完整键的根/档位/版本隔离；队首/中间取消后存活 FIFO 顺序；响应结果未消费时名额持有；32 名额占满与全部排队取消后恢复；真实活动取消后仍持许可/名额且峰值=N；同内容别名只完整解码一次、同路径变化重新哈希、非法路径不能合并绕过；N=2 的 leader 外层取消、leader stale、leader panic、坏图各 5 次交错及重试恢复；waiter 取消和 waiter stale 不影响其他有效消费者。

N=1 不能同时进入两个读取后的真实 flight 消费者，相关两个入口交错测试未编入默认构建；默认通过 registry 层验证异常 fan-out，N=2 再经实际 load 入口验证。不能把默认测试项数量当作已执行 N=2 专属路径。

自测期间发现并修正了测试同步误差：闭包的 `Left` 通知早于 Tokio 丢弃无人接收的返回值，不能据此立即断言请求名额归零。现测试等待实际 `PlaylistRequestReservation::Drop` 的通知再核对归零，未以放宽断言或延时掩盖它。该时序正说明 guard 继续覆盖返回值移交。

测试钩子、门与统计仅 `cfg(test)`，按局部 coordinator 隔离，不依赖旧实验的进程级全局计数；等待超时只用于检测测试悬挂，生产无新增超时/重试。已有缓存/路径/writer/协议测试保持通过。

## 后续验收边界

需独立 Test/Architecture 检查本轮安全实现及两臂相邻回归；本说明不宣布 SP-022 验收完成。没有重跑新结构的 A/B 代理、A0↔A 安全机制性能代价、真实 Release UI、P3/P4、长期资源、大图/全部 codec 分配上界、普通应用运行身份或正式性能阈值。不能将历史约 1.95 倍提速直接套在本实现上。

保留默认 N=1；只有补齐后续隔离、资源与端到端收益证据，才讨论默认 N=2。若独立验证发现所有权/清理不成立，应修正共享基础，不能仅切回 N=1 就声称安全完成。
