---
doc_id: "TEST-2026-10-29-COVER-CACHE-ISOLATION"
title: "封面缓存测试隔离验证"
doc_type: "test-report"
status: "completed"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-29"
updated: "2026-10-29"
source_documents:
  - "user request: 排查并修复封面缓存测试不稳定"
  - "docs/test/2026-10-29-contributor-library.md"
  - "src-tauri/src/audio/cover_pixels.rs"
  - "src-tauri/src/audio/folder_cover.rs"
---

# 测试报告：封面缓存测试隔离

## 摘要

独立复现修复前三项并行失败。修复后默认并行、16 线程和 32 线程连续三轮音频套件全部通过，原有严格计数断言保留。通过本次测试隔离修复验收；不据此宣称真实桌面封面显示或所有文件系统行为已经验收。

## 实现交付与证据完整性

- 实现 Owner：Rust/Tauri Agent；两个 Rust 文件。
- 复现基线：Test Agent 在修改前运行 `cargo test --lib audio::`，256 通过、3 失败、4 忽略，19.84 秒。
- 首个失败：`track_thumbnail_index_survives_disk_hit_and_repairs_missing_thumbnail` 全局 probe 计数实际 12、预期 1。
- 传播失败：上述断言持有测试串行锁时 panic，`track_thumbnail_negative_index_invalidates_on_source_change` 随后得到 `PoisonError`。
- 独立失败：`repeated_requests_reuse_the_validated_discovery` 全局枚举计数实际 2、预期 1。
- 已有报告另记目录新增失效用例间歇失败；本次对修改前可执行文件 exact 连跑该用例 30 次，30/30 通过。该项没有新的动态失败基线，时间戳敏感性来自代码前提分析，不能表述为本次已复现。

## 根因与因果链反证

两个索引测试之间的串行锁无法约束其他调用实际 thumbnail loader 的测试。无关夹具共享进程计数 → 严格增量断言失败 → 串行锁中毒 → 下一用例失败。目录枚举测试同样共享计数和有界缓存，另一个容量测试可以逐出其条目。修改将计数按独立 cache 根归属，在 worker 线程仍记录实际 probe；目录缓存用例使用独立 `SiblingDiscoveries`，避免容量、计数互相污染。

替代假设为实际缓存命中或修复分支失效。逐项核对 loader 中计数仍位于实际 probe 之前；磁盘命中、源封面移除后命中、缩略图删除及损坏重建、索引损坏重建、负索引和源变化仍保留精确次数断言。新增两个 worker 同时读不同夹具且各自第二次命中的测试。上述路径通过，支持测试观测污染而非实际缓存普遍失效的结论。

目录新增测试明确修改并断言目录时间戳变化；同长度替换明确修改文件时间戳，并新增 cache miss 和枚举次数断言。原测试只比较相同路径，无法证明同长度内容变化已引发重新枚举。新增 TTL 用例直接设置旧发现时间，验证到期重新枚举，无任意等待或超时扩大。

## 命令与结果

命令均在 `D:\SpMusic\src-tauri` 执行，除特别注明外由 Test Agent 独立执行。

| 命令 | 结果 |
| --- | --- |
| 修改前 `cargo test --lib audio::` | 256 通过，3 失败，4 忽略，19.84 秒 |
| 修改前 `target/debug/deps/app_lib-8cbf7f691e69861b.exe audio::folder_cover::discovery_cache_tests::added_replaced_and_removed_covers_invalidate_the_discovery --exact`，30 次 | 全部通过 |
| 修改后 `cargo test --lib audio::` | 261 通过，0 失败，4 忽略，13.88 秒 |
| 修改后 `cargo test --lib audio:: -- --test-threads=16` | 261 通过，0 失败，4 忽略，13.34 秒 |
| 修改后 `cargo test --lib audio:: -- --test-threads=32`，连续 3 次 | 每次 261 通过，0 失败，4 忽略；12.39、12.93、13.05 秒 |
| `git diff --check` | 通过 |
| `cargo check` | 实现 Agent 报告通过，非本 Agent 独立执行 |

`npm run lint`、`npm run build`、`npm run tauri dev` 未由本 Agent 运行；本次没有前端变更。主 Agent 最终执行 `cargo test --lib`：333 通过、0 失败、4 忽略，13.41 秒，退出码 0；该结果非本 Agent 独立执行。

## 跨层契约与人工检查

未改 TypeScript/Rust 业务结构、command/event、序列化、空值、错误、权限或运行时生命周期。生产目录缓存入口只是转发到接受缓存实例的私有函数；测试观测逻辑受 `cfg(test)` 约束。未启动真实 Tauri/WebView2，未操作用户曲库或用户缓存。

## 回归、时序与风险

重复并行运行覆盖实际后台 worker、缓存修复、负索引、目录缓存容量和 TTL。没有串行化整个测试套件、放宽断言或调整运行时缓存策略。耗时只用于记录采样环境，不是性能提升证据。

保留原有 4 个 ignored 测试，未运行真实曲库 benchmark。真实文件系统可能出现目录时间戳不变的变化，生产缓存仍由既有 5 秒 TTL 兜底；本次不改变该契约。新增/替换测试通过明确时间戳变化验证签名失效，不能用它宣称所有粗时间戳场景均立即刷新。

## 结论

本次已复现的全局观测污染和锁中毒传播得到根因修复，独立回归通过。时间戳项得到确定前提与更强断言，已知 TTL 边界保持原状。桌面视觉及真实文件系统即时刷新不在本次通过结论内。

