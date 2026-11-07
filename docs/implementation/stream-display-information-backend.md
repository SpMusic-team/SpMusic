---
doc_id: "IMPL-STREAM-DISPLAY-INFORMATION-BACKEND"
title: "流电台名称读取与后台缓存实现"
doc_type: "implementation"
status: "active"
owner_agent: "Rust/Tauri Agent"
version_scope: "project"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - "user request: 按 Downloads.zip 中十张截图补齐流视图信息"
  - "docs/architecture/stream-display-information.md"
  - "src-tauri/src/audio/network.rs"
  - "src-tauri/src/audio/runtime.rs"
  - "src-tauri/src/audio/controller.rs"
  - "src-tauri/src/library_streams.rs"
---

# 流电台名称读取与后台缓存实现

后端从已经建立的播放响应读取静态 `icy-name`，将其作为独立的可选 `stationName` 传给曲目与流描述符。没有新增命令、事件、依赖或网络请求；列出、添加、导入和恢复流仍不为名称连接服务器。地址和稳定曲目 ID 保持原有身份规则。

## 响应到详情的链路

网络 worker 在现有 HTTP 响应上读取 `icy-name`。只有有效 UTF-8、非空、无控制字符且不超过 1024 字节的名称被接收；空白、过长或坏 UTF-8 值忽略。名称是普通显示文本，HTML 形式的字符串也不会作为标记解释。HTTP 协议层拒绝的非法响应头不会为提取名称而放宽校验。

名称先保存在本次 `StreamStatus`，runtime 在首帧准备成功时合并到当前曲目。已接受的详情解析任务携带观察名称快照。现有 FIFO parser worker 在后台调用注册表缓存服务，随后才发送原有 `TrackDetailsHydrated`；最终 `Ready` 仍受原 request/generation 栅栏保护。

JSON 读取、原子替换和 fsync 均不在音频回调、runtime 控制循环或 latest-intent 提交锁内执行。缓存错误通过诊断日志记录，已解码音频与当前响应名称仍然可用；缓存失败不会伪装为播放失败。后续 hydration 的空名称不会清除当前曲目已知的 stationName。

## 名称来源与存储兼容

原 v1 地址注册表增加可省略的 `stationName` 和 `titleOrigin`。旧文件缺少这些字段仍可读；旧非 URL 标题保守视为用户名称。

手动名称高于导入名称，导入名称高于服务器观察名称，最后回退规范 URL。`title` 保留显式名称或 URL 回退，服务器名称独立存储，显示用 `fileName` 可以采用有效名称。导入不能覆盖用户名称，名称发现不改变创建时间。

缓存只能更新仍存在的 URL 成员，不能插入或复活已删除的流。相同、缺失或无效的观察名称不重复写盘，也不清除旧缓存。损坏或未来版本注册表的原内容不会被缓存操作覆盖。前端依据同一契约完成各布局、搜索、队列和播放栏的信息渲染。

## 本轮验证

实现者在最终源码上顺序执行：

| 检查 | 结果 |
| --- | --- |
| `cargo test --locked --lib station_ -- --test-threads=1 --nocapture` | 4/4 通过：有效及无效响应名称、只用一次播放请求、hydration 保留、缓存不可用时保持当前名称、名称优先级 |
| `cargo test --locked --lib library_streams::tests -- --test-threads=1 --nocapture` | 6/6 通过：离线添加、混合导入、长 URL、旧 v1 名称、损坏保护、持久恢复、用户标题优先及删除后不复活 |
| `cargo test --locked --lib stream_details_worker_persists_before_ready -- --test-threads=1 --nocapture` | 1/1 通过：缓存运行于后台线程，详情发出时注册表已可读到名称 |
| `supplied_public_stream_decodes_pcm`，显式公网执行 | 1/1 通过：同一 SomaFM 地址解析到预期名称，持续解码并可取消 |
| `cargo check --locked` | 通过，无 warning |

上述过滤器有交集，不能把各行相加当作不同测试总数。测试构建有 MSVC 本地化“正在创建库/对象”的 stdout 被 rustc 记为 `linker_messages` warning，测试本身均以零退出码通过。

公网复现命令：

```powershell
$env:SPMUSIC_PUBLIC_STREAM_URL='https://ice5.somafm.com/groovesalad-128-aac'
$env:SPMUSIC_EXPECTED_STATION_NAME='Groove Salad [SomaFM]'
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib supplied_public_stream_decodes_pcm -- --ignored --test-threads=1 --nocapture
```

本轮该地址约 1.064 秒准备好首帧，44100 Hz、双声道，`stationName` 与 `Groove Salad [SomaFM]` 精确相等；随后持续十二秒得到非零 PCM，取消后 worker 结束。数值是本轮公网单次观测，不是性能承诺。确定性的响应头测试使用本地 HTTP 音频 fixture，公网电台不可达时仍可独立执行。

## 覆盖边界

本轮读取的是静态电台名称，不解析 ICY 动态曲目元数据，不搜索网络封面。未播放且没有手动或导入名称的地址仍可诚实回退 URL；名称来自首次成功播放响应并保存后，后续列表恢复可以离线显示。缓存确实失败时仅保证本次观察名称可用，重启持久恢复以实际保存结果为准。

原有 AAC 解码、准备预算、取消、五秒无进展超时和有界 PCM 继续复用；本轮没有重新宣称所有格式或所有电台组合均经过验证。前端十级布局与独立验证证据分别由对应实现说明和 `docs/test/stream-display-information.md` 记录。
