---
doc_id: "TEST-PLUGIN-HOST-DESIGN-REVIEW"
title: "测试报告：全业务插件宿主设计可验证性审查"
doc_type: "test-report"
status: "design-reviewed"
owner_agent: "Test Agent"
version_scope: "long-term-design"
created: "2026-09-30"
updated: "2026-10-01"
source_documents:
  - ".agents/prompt/Test_Agent.md"
  - "docs/decisions/2026-07-09-document-metadata-standard.md"
  - "docs/requirements/all-business-plugin-system.md"
  - "docs/decisions/2026-09-30-all-business-plugin-system-goal.md"
  - "docs/architecture/all-business-plugin-system.md"
  - "docs/architecture/plugin-host-design.md"
  - "docs/decisions/2026-09-30-plugin-host-architecture.md"
  - "src-tauri/build.rs"
  - "src-tauri/src/lib.rs"
  - "src-tauri/src/audio/controller.rs"
  - "src-tauri/src/audio/runtime.rs"
  - "src-tauri/src/audio/symphonia_source.rs"
  - "src-tauri/capabilities/default.json"
  - "src-tauri/tauri.conf.json"
  - "D:/OpenProject/deepseek-harness/vendor/cordis/src/fiber.ts"
  - "D:/OpenProject/deepseek-harness/vendor/cordis/src/context.ts"
  - "D:/OpenProject/deepseek-harness/vendor/loader/src/internal.ts"
  - "https://v2.tauri.app/security/capabilities/"
  - "https://quickjs-ng.github.io/quickjs/developer-guide/intro/"
  - "user request: 下一步；继续"
---

# 测试报告：全业务插件宿主设计可验证性审查

## 摘要

设计阶段审查通过：Rust 全局治理、选择性 Cordis 适配及多执行环境路线有明确边界，完整业务归属、PH-01 至 PH-11 和 AC-01 至 AC-16 均有设计映射及后续证据要求。已反馈的契约矛盾在终稿中闭合，未发现剩余设计阻塞。

本次只判断设计一致性与可验证性。G1 至 G5 均未运行验证，全部最终产品验收标准仍需实现及实际运行证据；文档不能证明安全、可卸载、实时隔离或性能达标。

## 范围

- 输入：[目标决策](../decisions/2026-09-30-all-business-plugin-system-goal.md)、[需求](../requirements/all-business-plugin-system.md)、[目标架构](../architecture/all-business-plugin-system.md)、[宿主设计](../architecture/plugin-host-design.md)、[技术路线 ADR](../decisions/2026-09-30-plugin-host-architecture.md)。
- 五类设计交付：选型取舍、TS/Rust/Tauri 契约、执行与权限、音频生命周期、全部业务及宿主能力覆盖。
- 只修改本报告；未改生产代码、依赖、需求、任务和架构，不回滚其他已有修改。

## 实现交付与证据完整性

- 设计 Owner：Architecture Agent；不是运行实现或缺陷修复交付。
- 范围：Rust 唯一图/实例/权限/服务权威、官方 TS 与静态 Rust、第三方隔离 JS/WASM、消息、装配/退出/升级、音频与 SDK。
- 独立读取：职责、REQ/目标、三份架构文档；Cordis Fiber/Context 与 Node loader；当前 Tauri 配置、命令和音频 controller/parser/解码路径。
- 已知事实：Cordis 顶层清理并行且异常只记录；Context.isolate 仅改变服务标签。当前 build.rs 未把业务命令加入应用权限声明；音频线程存在进程寿命、丢弃 join handle 与 sender 互持问题，SymphoniaAudioSource.next() 同步读包/解码。
- 外部一手证据：2026-10-01 独立读取 Tauri capability 和 QuickJS-NG C API 文档，核对默认自定义命令访问与不可信字节码风险。
- 待验证假设：Cordis 可受 Rust 激活权威约束；runner/broker 真正阻止越权及耗尽；账本与真实句柄退出一致；数据/装配事务可恢复。
- 证据缺口：没有本次插件宿主 DTO/schema/运行装配、攻击测试、性能或业务回归制品。这阻止产品验收，不能单独作为设计失败依据。

## 命令

以下为实际执行的文档及源码只读检查，源码检索后读取上下文，未以关键词命中当作运行证明。

- `Get-Content -LiteralPath ...`：读取前述职责、需求、目标、三份架构、报告、源码与配置；读取成功。
- `rg -n 'node:|dispose|Promise.all|isolate|epoch|reload' D:/OpenProject/deepseek-harness/vendor/cordis/src/fiber.ts D:/OpenProject/deepseek-harness/vendor/cordis/src/context.ts D:/OpenProject/deepseek-harness/vendor/loader/src/internal.ts`：成功，独立核对框架边界。
- `rg -n 'spawn|join|channel|recv\(|Shutdown|decode|next_packet|fn next' src-tauri/src/audio/runtime.rs src-tauri/src/audio/symphonia_source.rs`：成功，定位后读 controller/parser/next 上下文。
- `rg -n 'invoke_handler|audio_embed_lyrics|audio_' src-tauri/src/lib.rs`：成功，确认旧业务命令仍存在。
- `rg -n '^##|^###|PH-[0-9]{2}|AC-[0-9]{2}|G[1-5]' docs/architecture/plugin-host-design.md docs/architecture/all-business-plugin-system.md docs/requirements/all-business-plugin-system.md`：成功，定位逐项证据。
- `node --version`：成功，v24.19.0，仅使用已有运行时。
- `git status --short`：成功，识别并保留其他既有变更。
- 初次 `rg --files tools scripts | rg 'doc|metadata|check'`：scripts 目录不存在，rg 报错；未认定成功，不构成插件设计缺陷，后续直接用 Node 检查文档。
- PowerShell here-string 文档检查脚本管道到 `node --input-type=module`：通过。实际输出为 `PASS: 6 documents, required metadata, unique IDs, local sources/links, whitespace/fences, PH 11/11, AC 16/16, final review status`。脚本用已有 Node 的 fs/path 和正则检查上述六份输入文档的必填元数据、唯一ID、本地来源/相对链接、空白/代码围栏、覆盖行及报告日期/最终状态；没有执行运行测试。
- `git diff --check -- docs/test/plugin-host-design-review.md`：通过；该文件未跟踪，实际正文空白同时由 Node 检查，不以空 diff 替代。
- `npm run lint`、`npm run build`、`cargo check`、`npm run tauri dev`：均未运行；本次只改文档，现有播放器的检查也不能证明插件宿主已运行。

## 人工检查

| 项目 | 设计检查结果 | 边界 |
| --- | --- | --- |
| 业务归属 | 播放/队列/解码/输出/歌词/标签/封面/外观/UI/设置/桌面/文案/开发工具有归属 | 未实现迁移，后续检查真实依赖图 |
| 全局权威 | Rust 唯一目录/图/服务选择/实例/授权，Cordis只接受授权上下文和proxy | G1仍需证明不能自主重载/越权创建 |
| 装配事务 | 内部ready供同事务依赖调用；外部服务、事件和UI等commit；start禁止不可逆业务副作用 | G3仍需首次启动与失败回收测试 |
| 停止失败 | stopped必须有资源完成证明；failed附cleanupStatus和quarantined字段，保留独占lease | 原生线程不能强杀，真实join/释放未测 |
| UI授权 | action token绑定贡献者身份/epoch/grant/目标/schema；可信用户动作proof不扩大grant | G2仍需重放、目标替换及官方代理越权测试 |
| 旧invoke | 设计要求应用命令权限或受控迁移，现有裸业务入口不能作为隔离证明 | G2/G5真实绕过未测，接入新环境前必须收口 |
| SDK与默认组合 | 公开服务和生命周期、测试宿主及默认/替换装配有交付方向 | 无SDK制品或示例构建运行记录 |

## 根因与因果链反证

不是缺陷修复，独立复现与根因修复判定不适用。已用以下反例审查设计；运行测试全部留待相应闸门。

| 反例 | 终稿规则及独立审查结果 | 后续验证 |
| --- | --- | --- |
| Cordis本地provider变化自行重载跨端消费者 | Rust签发activation后才建fiber，inject只解选定proxy，变化交回Rust，SDK不暴露fork/inject | G1：未授权创建、本地重载绕过 |
| 首装provider等整图running、consumer又等provider | 同事务拓扑ready可调用，外部commit独立，禁止consumer等待全图running | G3：空装配、包内依赖和部分启动失败 |
| disposer吞错/挂起，但 Promise fulfilled 被视为退出 | 核对逐资源状态和join/退出证明；quarantine保留设备占用，不能以路由撤销代替物理释放 | G1/G4：停止异常、超时、双owner拒绝 |
| 第三方action经官方UI借用高权限 | token以贡献者身份分派，禁用/撤权/更新失效；一次性用户动作proof不能扩大grant | G2：代理越权、旧token、伪造点击 |
| 取消/超时被当成无副作用，重试重复写入 | owner串行取消与提交唯一终态；queryOperation与幂等范围/期限为方法发布门槛；unknown禁止盲重试 | G3/G5：提交前后取消、断连、相同key不同输入 |
| 快照到监听间丢事件，cursor套用新provider | 原子登记与同revision快照，cursor绑定流/实例/代际/装配，重复去重，gap使订阅失效并重取快照 | G3/G5：并发快照、重复、溢出、旧cursor |
| 缺少core权限就能阻止自定义invoke | 独立源码和官方资料确认现有入口不能如此推断；设计明确专门收口 | G2/G5：全部旧audio_*和窗口入口攻击 |
| 独立进程允许安全加载任意引擎字节码 | JS源码-only，拒guest字节码/预编译cache；WASM经验证、拒guest原生预编译产物 | G2：恶意、错误版本、伪装格式输入 |
| 把worker读文件禁掉，或把next()称为已预读 | worker可做授权I/O，实时回调只读有界已准备PCM；当前next读包反证已隔离假设 | G4：线程轨迹、回调耗时、欠载与背压 |
| 版本退回等于数据已回滚 | 配置/dataVersion独立、staging/log/备份恢复、不可逆迁移拒绝自动降级 | G3/G5：中断恢复、主题旧格式与失败降级 |
| uint64字符串按字典序或Number比较 | 规范十进制uint64，Rust u64/TS BigInt比较 | G3/G5：9/10、超过安全整数、溢出/前导零拒绝 |
| 消费服务没有part归属，却要求按包内part依赖启动 | consumes.partId 和 provides.partId 明确包内外键，显式 dependsOn 与服务/包级 ready 边统一拓扑；required 与 optional 语义分开 | G3：无效外键、包内环、被必需依赖的可选part |

关于自定义命令缺省权限和不可信字节码的事实分别由[Tauri官方资料](https://v2.tauri.app/security/capabilities/)和[QuickJS-NG官方资料](https://quickjs-ng.github.io/quickjs/developer-guide/intro/)支持；本文不以API存在推断隔离已验证。

## 跨层契约

- Manifest v1、Request/Response/Event/Error v1、CallerContext、Expected、十进制代际/序号、schemaDigest、serviceVersion及owner方向明确。
- caller身份由Rust端点绑定，不采信guest自报；入队与提交时复查instance/assembly/grant/Expected。requestId仅关联，播放顺序由actor分配。
- 副作用查询/取消、断连、原子订阅、缺口、错误码与退出资源归属均有可验证规则。
- 当前没有本次真实TS/Rust DTO/schema/codegen或桥接运行证据，跨层实现结论为未验证。

## 回归覆盖

- 原始缺陷复现：不适用，无运行修复。
- 后续基线：播放/暂停/seek、快速A/B/A、自然结束、队列随机/循环/folder/m3u8、歌词/封面/元数据、标签安全写回、主题/设置迁移、格式和设备中断。
- 两类组合：官方默认离线装配与至少一个合规替换组合，关闭第三方增强后默认基础能力仍可运行。
- 失败分支：首次启动失败、至少10次启停、stop异常、断连、旧任务、eventgap、撤权、更新取消/中断、迁移与回滚故障。
- 缺口：无本次插件宿主自动化/桌面操作证据；未新增测试、框架或安装依赖。

## PH覆盖与后续验证闸门

章节名称对应[宿主设计](../architecture/plugin-host-design.md)，每项已有设计责任模块，右列全部未运行。

| 需求 | 设计证据章节 | 后续证据 |
| --- | --- | --- |
| PH-01 | 插件描述、装配和服务；配置、存储、安装与回滚 | manifest/版本/schema/平台/摘要执行前拒绝 |
| PH-02 | 职责与依赖方向；插件描述、装配和服务 | singleton/provider-set、owner/revision、作用域与替换 |
| PH-03 | 插件描述、装配和服务；生命周期、资源与权限 | 缺失/循环/重复、内部ready/外部commit、用户覆盖 |
| PH-04 | 生命周期、资源与权限；音频业务契约与安全替换 | 逆序/10次启停、吞错/挂起、join与设备占用 |
| PH-05 | 配置、存储、安装与回滚 | 配置/数据版本、namespace、旧主题、迁移恢复 |
| PH-06 | 消息、事件、身份与错误 | 超时/取消/乱序、gap/重复/背压、过期提交 |
| PH-07 | 生命周期、资源与权限；执行隔离与界面贡献 | 身份/grant、最终文件资源/网络范围、UI代理及guest攻击 |
| PH-08 | 配置、存储、安装与回滚 | 安装/更新/卸载每阶段中断、数据选择、重启恢复 |
| PH-09 | 消息、事件、身份与错误；执行隔离与界面贡献 | 真跨端校验、断连/迟到、未知提交与旧入口封闭 |
| PH-10 | PH模块映射；验证闸门与完成判据 | 状态/图/日志/耗时/资源查询、脱敏和重载清理 |
| PH-11 | SDK表面；PH模块映射；验证闸门与完成判据 | 公开SDK示例构建、契约/兼容/故障套件和组合回归 |

## AC覆盖与后续证据

全部AC的产品完成状态均未验证。“设计覆盖”仅说明规则及路径存在。

| 验收标准 | 设计覆盖 | 最终验收证据 |
| --- | --- | --- |
| AC-01 | 全部现有业务迁移归属及未来接入约束 | 实际逐项依赖图，无宿主固定业务或隐藏后备 |
| AC-02 | 默认装配、随应用交付、恢复入口 | 新制品离线安装/启动和基础业务操作 |
| AC-03 | 统一manifest/依赖/生命周期/权限及信任差异 | 官方/第三方注册、启停、授权 |
| AC-04 | PH-01至PH-11全部模块映射 | 十一项实现和测试/操作矩阵齐备 |
| AC-05 | 兼容/schema/拓扑预检 | 缺失、循环、冲突、不兼容故障注入 |
| AC-06 | owner/revision、provider选择、quiesce和独占lease | 正常/非法替换、无双写、失败无双设备owner |
| AC-07 | 事务回收、逆序stop、账本/quarantine | 至少10次启停统计、停止失败与退出证明 |
| AC-08 | epoch/Expected/deadline/取消与提交检查 | 切歌/禁用/卸载旧结果和超时/取消终态 |
| AC-09 | 配置/dataVersion、schema、staging/恢复 | 无效/旧版/隔离/迁移失败测试 |
| AC-10 | broker/grant、真实入口与可信/隔离差异 | 文件/网络/播放越权、IPC/UI代理与平台配额 |
| AC-11 | 独立包/实例/重启状态与事务/数据选择 | 每阶段取消/中断、卸载、重启和恢复 |
| AC-12 | wire/schema/绑定身份/提交状态/流恢复 | 无效/重复/迟到/断连，不假成功、不更新旧会话 |
| AC-13 | diagnostics、资源账本与受控重载 | 图/阶段/原因查询、日志脱敏、旧资源清理 |
| AC-14 | 全业务默认/替换组合与G5 | 独立回归/格式基线，关闭增强后基础可用 |
| AC-15 | 工程限额与G4/G5实测profile/门槛 | 批准数值、同口径实测及build/lint/Rust/契约/回归 |
| AC-16 | 公开SDK/服务schema/testhost | 无内部导入示例构建/退出与依赖/权限/残留检测 |

## 性能 / 时序

没有运行修改或性能测量，修复前后比较不适用。初始JSON/并发/deadline/stop宽限只是工程起点，没有性能认证。G4须固定平台、设备、sampleRate、blockFrames、队列深度/水位，按块周期确定callback/DSP上界与P99、runner吞吐抖动、内存和欠载策略；G5比较启动、稳态资源和业务时延。重复/乱序/并发/取消/退出仅有设计检查，运行结果未验证。

## 发现

初稿契约问题已反馈：Cordis授权/单图、事务ready/commit、UI贡献者权限、停止不完整的设备lease、unknown操作查询与取消终态、cursor绑定、guest字节码输入。终稿已逐项补规则；Manifest消费者part外键、显式part启动依赖、包级依赖满足条件及SDK原子订阅入口也已补齐并独立复核。设计阻塞项清零，运行验证缺口保留在G1至G5。

## 风险

| 闸门 | 运行结果 | 剩余边界 |
| --- | --- | --- |
| G1 Cordis适配 | 未验证 | 精确制品/传递许可、浏览器打包、约束自主重载与资源完成证明；失败换适配 |
| G2第三方执行 | 未验证 | 引擎/绑定/OS配额、导入、CPU/内存耗尽、进程终止、字节码/身份/UI代理及旧IPC攻击 |
| G3治理事务 | 未验证 | 完整schema/兼容、ready/commit、中断日志恢复、签名策略、幂等/操作查询 |
| G4音频与资源 | 未验证 | 预读/有界PCM、shutdown/join、设备释放、格式/seek/替换失败及实测预算 |
| G5默认装配 | 未验证 | 全业务迁移/旧入口退出、离线制品、历史配置、默认/替换组合与性能回归 |

官方同进程插件仍有共享故障风险，闭包/token或服务scope不隔离敌意同realm代码。任意第三方WebView/原生动态库不在默认路径，静态Rust新代码需产品更新/重启。SDK逐业务方法、精确引擎与平台、历史兼容期限、签名制品和量化预算仍须在对应实施闸门冻结，不能据本报告宣称已交付。

## 临时缓解

不适用，无运行缺陷修复。迁移若保留旧入口，须有退出条件、期限和Owner，不能成为永久宿主业务后备或权限旁路。

## 验证结论

设计阶段：通过。已独立读取终稿与ADR，核对完整范围、权威/身份、依赖图、事务/资源、取消/事件、权限、音频及恢复规则；已发现的设计矛盾闭合，可作为下一阶段原型与契约细化基线。

最终产品验收：证据不足。G1至G5未运行验证，AC-01至AC-16全部缺少本次完整实现与运行证据，不宣称插件宿主已经可用、安全、实时隔离或通过性能门槛。

## 建议

建议PM记录“架构设计基线形成，产品实现与运行验证未完成”，按G1至G5安排获批原型、契约冻结、实现与独立验证。进入副作用/安装/音频能力前分别补足具体业务schema、恢复期限/签名制品和实测预算；最终仍按完整业务及十一类能力验收。本报告不批准实施版本、产品任务完成或发布。
