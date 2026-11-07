---
doc_id: "DEC-2026-09-30-PLUGIN-HOST-ARCHITECTURE"
title: "架构决策：插件宿主技术路线"
doc_type: "decision"
status: "accepted"
owner_agent: "Architecture Agent"
version_scope: "long-term-design"
created: "2026-10-01"
updated: "2026-10-01"
source_documents:
  - ".agents/prompt/Architecture_Agent.md"
  - "docs/decisions/2026-07-09-document-metadata-standard.md"
  - "docs/decisions/2026-09-30-all-business-plugin-system-goal.md"
  - "docs/requirements/all-business-plugin-system.md"
  - "docs/architecture/plugin-host-design.md"
  - "D:/OpenProject/deepseek-harness/vendor/cordis/src/fiber.ts"
  - "D:/OpenProject/deepseek-harness/vendor/loader/src/internal.ts"
  - "user request: 下一步；继续架构选型与契约设计"
---

# 架构决策：插件宿主技术路线

## 状态

Accepted：接受架构设计基线，运行验证尚未通过。本文件沿用 2026-09-30 规划的引用路径，实际创建日期为 2026-10-01。接受本决策不表示 Cordis/runner 已安装、第三方执行已安全、业务已迁移，也不批准实现排期或变更当前 v0.1 范围。

## 背景

长期目标要求所有业务成为插件，且完整覆盖 PH-01～PH-11。SpMusic 同时运行 React/TypeScript、Tauri、Rust 与音频线程，参考项目的 Node/Agent 插件生命周期不能直接承担跨端权威、权限和音频退出治理。当前播放线程还存在解码 I/O、无界通道和缺少完整 Shutdown/join 等迁移约束，不能只包装模块名称便认定可卸载。

参考源码固定为 `D:/OpenProject/deepseek-harness` HEAD `639ed015397290b3745d163aafe02ffee4aa3f84`；vendor 为 MIT 的 `@deepseek-ai/cordis@4.0.4` fork，上游 core 基线 `4.0.0-rc.7`、commit `56b3d4f725681cf4556c1a8695a709cc3b6eed74`。fork 与上游不同，选用另一制品必须重新验证，不能沿用这份源码结论。

## 决策

1. Rust 宿主是插件目录、全局依赖图、装配事务、实例状态、服务可见性、能力授权与资源账本的唯一权威。宿主承载基础设施；播放、队列、音频、歌词、外观及产品界面都由插件实现。
2. 选择性适配 Cordis Context/Service/Fiber，辅助可信官方 TS 插件本地 scope 与 proxy。Rust 授权 activation 后才能创建 fiber；inject 只解析 Rust 已选代理，不建立第二全局图，不让 Cordis 自主重载跨端业务。业务只依赖公开 SDK。
3. 官方 Rust 采用静态编译工厂，仍执行统一 manifest、依赖、权限、生命周期与资源规则。新静态代码随产品升级和重启交付，不宣称可动态安装。
4. 第三方 JS/WASM 采用每实例独立、受限 runner；建议 JS 嵌入 QuickJS-ng 类引擎，WASM 嵌入 Wasmtime 类引擎，封闭环境导入，仅经 broker 使用能力。具体库、crate、制品版本和平台限额由 G2 原型选择。第三方不进入主 WebView，也不加载任意原生动态库。
5. Tauri/runner 使用版本化序列化契约及端点身份；请求、取消、提交状态、操作恢复、快照事件和权限撤销具有统一语义。声明式第三方 UI 的动作保留贡献者身份与授权上限。
6. 复合包按拓扑在事务内启动，内部 ready 服务可供后续 part 使用；全部必需 part ready 后才原子对外 commit。Cordis dispose fulfilled 不作为退出证明，Rust 核对资源清理/join/进程退出；不完整退出保留占用并 quarantine。
7. 音频控制面经服务治理，PCM 数据面使用协商格式、有界缓冲与预读 worker。运行中替换先停止或安全交接，再确认释放；默认不承诺无中断热更新。

详细字段、协议与全部业务归属见[插件宿主设计](../architecture/plugin-host-design.md)。设计基线完整覆盖长期目标，逐业务方法和量化预算在实施前按该基线冻结。

## 备选方案

| 方案 | 取舍 |
| --- | --- |
| 全量搬迁 dsh/Cordis 宿主 | Node loader、HMR、Agent 负载和同进程插件管理不能提供 Rust/实时音频/不可信执行边界；形成双图或权限旁路，未采用 |
| Cordis 为全局权威，Rust 仅提供命令 | 生命周期与资源确认跨 Rust 线程、设备和进程；需要原生侧授权却把装配权威放在 TS，退出与权限竞态难以裁决，未采用 |
| 全自研 Rust 治理与 TS 适配 | 权威一致但重复实现 TS scope/effect/proxy，作为 G1 失败后的受控替代路线；SDK 和 Rust 契约保持一致 |
| 第三方进入主 WebView、Node 或宿主动态库 | 扩大共享故障与系统能力；同 realm/`node:vm`/作用域不是安全隔离，不作为第三方默认执行路径 |

## 取舍理由

Rust 能连接原生资源、任务与 runner 的真实退出状态，由单一治理权威处理跨端装配和授权；Cordis 的本地作用域可减少 TS 适配重复工作，但隔离在可替换内部适配层，避免 SDK 绑定 fork 的私有语义。官方静态工厂保留现有音频实现及默认离线产品，runner 为第三方提供可终止的故障边界。完整业务插件化与多执行方式并不冲突，允许分段验证，最终仍按全部业务和十一类能力验收。

## 影响

- 正向：状态权威、依赖、权限和退出结果统一；默认官方产品与第三方使用同一治理规则；TS 适配可替换而不重写业务 SDK。
- 成本：需要跨端协议/schema 工具、事务与恢复日志、runner 和资源观测；当前无界线程与直接命令必须迁移，不能长期保留两套入口。
- 性能：通用调用增加校验与路由成本，实时音频使用专用有界数据面；预算必须基于测量，不能借架构推断已达标。
- 信任：官方同进程插件仍可导致整个宿主崩溃；第三方 runner 的平台约束、越权防护与终止行为须独立验证。
- 范围：不新增音乐业务、插件市场、账号或云分发；不创建代码任务卡，不安装依赖或修改实现。

## 回滚条件

| 验证闸门 | 触发重新评估或更换的条件 |
| --- | --- |
| G1 Cordis | 浏览器构建依赖 Node polyfill、无法约束 fork/inject/reload、资源异常不能观察或 fork 维护成本不可接受：换自研 TS scope 适配，保持 SDK 与 Rust 权威 |
| G2 runner | 平台引擎/配额不支持、环境能力泄露、身份伪造、耗尽或终止边界测试失败：禁用该第三方执行路径，更换引擎/runner 适配后复验 |
| G3 治理 | staging 泄漏、首次装配死锁、更新中断无法恢复或迁移丢数据：禁止发布治理流程，修复事务/存储设计并重验 |
| G4 音频 | 缓冲/预读不能满足测量预算、停止不释放或替换导致双 owner：不开放深层替换，重新设计数据面/退出规则，恢复已验证组合 |
| G5 默认组合 | 官方默认离线能力、现有业务回归、设置兼容或资源指标未通过：停止相应迁移发布并回退已验证制品；不能缩减完整业务目标 |

G1～G5 目前均无通过证据；文档审查通过只证明设计可评审。实现前冻结 schema、具体引擎绑定与版本、签名制品、平台矩阵和性能 profile；执行由 PM 拆分获批任务，Frontend/Rust-Tauri 实现，Test 独立验收。

## 关联文档

- [长期目标决策](2026-09-30-all-business-plugin-system-goal.md)
- [完整需求与验收](../requirements/all-business-plugin-system.md)
- [架构目标](../architecture/all-business-plugin-system.md)
- [插件宿主设计与闸门](../architecture/plugin-host-design.md)
