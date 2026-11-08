---
doc_id: "TEST-OPT-0018-DS-VERIFICATION-RUNBOOK"
title: "OPT-0018 给 ds 的分阶段测试验证操作手册"
doc_type: "test-plan"
status: "proposed"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "用户请求：为 ds 撰写详细测试验证步骤，并考虑 ds 的执行能力"
  - "docs/test/opt-0018-independent-verification-2026-11-08.md"
  - "docs/test/opt-0018-v2-closeout-and-performance-plan.md"
  - "docs/architecture/opt-0018-v2-correction-execution.md"
  - "功能提交 9e3a4f921b35f9c9191c28604c72db5c8a91a694 下的 tools/thumbnail-benchmark/coverlane-*.mjs、coverlane-memory.ps1、coverlane-README.md"
  - "本机历史反例 D:/SpMusic-verification/2026-11-08/code-regression/verify-closeout.mjs"
---

# OPT-0018 给 ds 的分阶段测试验证操作手册

## 1. 先看这一页：目标、最短路径与停止点

目标只有两个：确认封面失败后能正确恢复；用同条件对照回答列表封面是否确实更快。磁盘文件更小、IPC 字节更少、编译通过都不能单独回答第二个问题。

本手册是**待执行步骤，不是新的测试结果**。当前独立结论仍是两个 P1 未通过、加载速度改善未证明，详见[独立验证报告](opt-0018-independent-verification-2026-11-08.md)。不要把已有报告中的测试数填成本轮执行结果。

按顺序做，完成一阶段再开始下一阶段。不要一开始运行全矩阵或 E1–E4 优化实验。

| 阶段 | 先做什么 | 交付什么 | 能否继续 |
| --- | --- | --- | --- |
| A | 确认工具、版本、证据目录 | 环境表、精确 SHA、能力表 | 缺哪个工具只阻塞依赖它的项目 |
| B | 构建检查、7 组目标测试、3 个反例 | 原始日志、退出码、3 个逐项结果 | P1 仍失败：停止正式性能验收，报告缺陷 |
| C | 在真实 Tauri/WebView2 中验证故障恢复 | 原生用例结果、事件、图片、请求归属 | 无原生能力：写未验证，不能用 mock 替代 |
| D | 固定 A/B 产物和语料，先做 3 对试跑 | 采集器验真表 | 只检验测量是否可信，不下提速结论 |
| E | 最小正式实验：打开列表和快速滚动，各 20 对 | 逐对原始数据、汇总、失败率 | 达到固定样本数即汇总，不择优追加 |
| F | 有条件再补热缓存、长时资源与扩展场景 | 资源曲线、扩展表、明确缺口 | 不会做的项目明确交回，不阻塞已完成结果交付 |

本次执行范围是验证、必要的测试辅助器和报告；**不包含修复产品源码、调整并发、扩大 asset 权限、启用 E1–E4 或合入功能代码**。发现 P1 时保留复现，交给实现者修复；收到新的固定提交后，从 B 重跑。不得删断言、吞错误、增加重试或延长超时来让结果变绿。

### 可以直接转交 ds 的指令

> 请按本手册 A → B → C → D → E → F 执行。先报告当前能力和被测提交，再保存每一步原始证据。当前两个 P1 必须先验证；未修复则提交失败报告，停止正式提速验收。不要改产品代码。能够执行命令但不能控制真实 Tauri 时，完成命令层和可复现反例，把原生层标为未验证。采集器先做 3 对试跑，核对时钟、目标集合、真实缓存、失败样本和产物身份；验真通过后，核心场景各固定 20 对。最终分别回答正确性、速度、CPU/内存、证据完整性，不以文件体积代替加载耗时。遇到工具缺口，写清卡在哪个步骤、已尝试什么、需要什么能力，不自行宣布通过。

## 2. 阶段 A：确认能做什么

### A1. 读取和定位

先读 `AGENTS.md`、`.agents/prompt/Test_Agent.md`，以及上面链接的独立验证报告。文档在 develop，功能代码仍在功能分支；**不能在 develop 上运行测试后称已验证路径版**。

在实际功能源码目录执行以下只读命令，逐条保存结果：

```powershell
Get-Location
git status --short
git rev-parse HEAD
git worktree list
node --version
npm --version
rustc --version
cargo --version
node -p "typeof WebSocket"
```

预期：确认源码位置与未提交差异；Node 内置 `WebSocket` 输出 `function` 才能直接使用当前 CDP 工具。任何命令报错保存全文，不能把“已安装”写成“已运行通过”。不要 checkout、reset、clean 或覆盖用户当前工作树来准备测试。

### A2. 建立本轮证据目录

以下示例适用于本机 PowerShell。`$TestRepo` 必须改为 A1 确认的被测源码目录；证据目录每次新建，时间戳冲突就换新名称。

```powershell
$TestRepo = 'D:\SpMusic'
$RunId = Get-Date -Format 'yyyyMMdd-HHmmss'
$EvidenceRoot = Join-Path $env:LOCALAPPDATA "spmusic-coverlane\ds-$RunId"
if (Test-Path -LiteralPath $EvidenceRoot) { throw '本轮证据目录已存在，请换新名称' }
New-Item -ItemType Directory -Path $EvidenceRoot | Out-Null
Set-Location -LiteralPath $TestRepo
git rev-parse HEAD | Out-File (Join-Path $EvidenceRoot 'source-head.txt') -Encoding utf8
git status --short | Out-File (Join-Path $EvidenceRoot 'source-status.txt') -Encoding utf8
git diff --binary | Out-File (Join-Path $EvidenceRoot 'working-diff.txt') -Encoding utf8
git diff --cached --binary | Out-File (Join-Path $EvidenceRoot 'staged-diff.txt') -Encoding utf8
```

这些 diff 用于审计；不是承诺可直接应用的字节级补丁。正式产物优先从干净固定提交构建，测量隔离补丁另外留原文件和 hash。未跟踪源码不会出现在 `git diff` 中，若参与构建须单独登记并归档。

本机历史证据在 `D:/SpMusic-verification/2026-11-08/`，历史 A/B 目录在 `D:/opt0018-ab/`。它们不是仓库文件，换机可能不存在。找不到时填“历史证据包未取得”，不要捏造文件或复制文档数字冒充复跑。

### A3. 填能力表，按能力继续

| 能力 | 实际验证方法 | 不具备时怎么办 |
| --- | --- | --- |
| 命令层 | 可执行 Node、npm、Cargo 并保存退出码 | 继续可运行的层，记录缺失工具 |
| 原生构建 | 可执行 Tauri release 构建并定位 exe | 不能拿 Vite 浏览器页代替原生验收 |
| 原生操作 | 可启动专属隔离实例，连接该实例 CDP 或使用桌面操作工具 | 原生故障与性能标未验证，提供步骤给具备能力者 |
| 真实状态观察 | 可读真实图片状态、捕获 load/error、截图、关联请求 | 只有截图则只能判断画面，不能断言 token、次数或毫秒耗时 |
| 隔离故障注入 | 能确认专属缓存根、定位对应 JPEG、备份和恢复 | 不做删除/写坏，不能操作用户正常缓存 |
| 进程采样 | 能识别专属进程树、读取 CPU/private bytes | 不给 CPU 或内存收益结论 |

不要求 ds 搭建隐藏 Win32 desktop。首选已可用的专属测试窗口与 loopback CDP。正式体验计时保持可见前台，固定窗口和显示缩放；隐藏/最小化或关闭后台节流的实验须另列，不能与前台结果混合。没有相应工具就停在能力边界，不循环猜脚本；同一阻塞最多排查两次或投入 30 分钟，以先到者为停止点，交付失败命令、原因、已尝试修正及所需能力，继续不依赖它的项目。此限制针对排查，不是中止正常运行中的构建或正式实验。

## 3. 阶段 B：先验证当前已知问题

### B1. 固定版本，区分三种身份

| 身份 | 已知参考 | 用途 |
| --- | --- | --- |
| 原像素版 A | `d0b51425345ab9e054073128ab63ab453f9bfc59` | 历史速度对照，仍须核对差异范围 |
| 已知有问题的路径版 B0 | `9e3a4f921b35f9c9191c28604c72db5c8a91a694` | 复现两个 P1、验证反例有效 |
| 待验收路径版 B | 实现者提交的新完整 SHA；未修复则就是 B0 | 正确性通过后才能成为正式性能候选 |

不要用 `develop`、`latest`、目录名 `final` 或 exe 修改时间替代完整 SHA。A 与 B 之间若含其他产品变化，先保存差异清单；不能把所有差异的收益归因于路径通道。无法构造仅相关差异的可比版本时，结论降级为“这两个构建的差异”，不是单项优化因果证明。

### B2. 运行现有检查

在被测源码根目录逐条运行。每条都立即保存 `$LASTEXITCODE`；不要运行下一条命令后再取上一条退出码。示例日志模式：

```powershell
npm run build *> (Join-Path $EvidenceRoot 'build.log')
$CommandExit = $LASTEXITCODE
$CommandExit | Out-File (Join-Path $EvidenceRoot 'build.exit.txt') -Encoding utf8
```

同样保存以下各条命令的独立日志、退出码、开始和结束时间：

```powershell
npm run lint
cargo check --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib
node --test src/features/player/hooks/coverPresentationContract.test.mjs src/features/player/components/playlistCoverElement.test.mjs src/features/player/services/playlistCoverPathLane.test.mjs src/features/player/services/playlistCoverScheduler.test.mjs src/features/player/hooks/libraryArtworkRecovery.test.mjs src/features/player/hooks/playerArtworkRecovery.test.mjs tools/thumbnail-benchmark/coverlane-counting.test.mjs
```

预期：构建与用例按实际结果填写；历史 B0 是目标测试 126 通过、Rust 398 通过/10 ignored，**本轮数量以本轮日志为准**。ignored 不计入通过。项目没有 `npm test` 总入口，不虚构命令。

历史 lint 的三条错误来自 gitignored 临时 JS 文件和缺失规则；若本轮仍失败，保留完整命令结果，说明错误文件。干净工作树通过与原工作树失败可以同时成立，分别报告。不要为此修改 lint 配置或静默忽略目录。若 Rust 再出现偶发失败，保存用例名、panic、完整日志；一次复跑通过只能称“未再次复现”。

### B3. 运行三个真实生产决策反例

先检查历史脚本存在，复制到本轮目录后运行，避免覆盖历史 `result.json`。该脚本已支持 `SPMUSIC_REPO` 环境变量；读取的是该目录源码，不是 exe。

```powershell
$OldCounterexample = 'D:\SpMusic-verification\2026-11-08\code-regression\verify-closeout.mjs'
if (-not (Test-Path -LiteralPath $OldCounterexample)) { throw '反例脚本未取得；记录缺口，不把本项写成通过' }
$CounterexampleDir = Join-Path $EvidenceRoot 'code-regression'
New-Item -ItemType Directory -Path $CounterexampleDir | Out-Null
Copy-Item -LiteralPath $OldCounterexample -Destination (Join-Path $CounterexampleDir 'verify-closeout.mjs')
$PreviousRepoEnv = $env:SPMUSIC_REPO
try {
    $env:SPMUSIC_REPO = $TestRepo
    node (Join-Path $CounterexampleDir 'verify-closeout.mjs') *> (Join-Path $CounterexampleDir 'run.log')
    $CounterexampleExit = $LASTEXITCODE
    $CounterexampleExit | Out-File (Join-Path $CounterexampleDir 'exit.txt') -Encoding utf8
} finally {
    $env:SPMUSIC_REPO = $PreviousRepoEnv
}
```

| 用例 | B0 的历史失败信号 | 修复版通过标准 |
| --- | --- | --- |
| CE1：512 已展示后失败 | path 调用 4→5，pixels 0→0 | 同一当前发布首次失败后直接 pixels；不再增加该恢复作业的 path 请求 |
| CE2：歌单菜单封面 | 实际 `onError` 发出裸 URL | 事件携带当前完整 presentation token，交给正确 owner |
| CE3：歌单 hero 封面 | 同上 | 同上，并且实际恢复链能受理 |

在 B0 上 3 个断言失败、退出码 1 是“复现成功”，**产品仍不通过**。修复版需 3/3 通过，且 B0 上仍能触发原失败。若因源码重构导致 harness 导入或定位失败，那是“测试未运行”，不是缺陷已修复；只允许适配测试定位，保留原行为断言，记录测试脚本差异。

若脚本缺失，需要取得历史证据包，或沿用现有 harness 重建三个等价测试；新测试须执行真实 hook、真实消费者 JSX/封面组件，不能只检查 helper。ds 无法完成时交回具体缺口。**不要直接跳过反例去跑 20 对性能。**

### B4. 阶段门槛

记录两个 P1 各自“已复现 / 修复版通过 / 未运行”。任一仍失败：交付 B 阶段报告，可继续 C 做故障定位证据，但停止 D/E 正式性能结论。产品修复另行交给实现者；收到新提交后重新绑定版本、构建并复测。

若已有可用测量工具且确需定位瓶颈，可另外做少量标注为“已知缺陷版本的诊断 A/B”的实验。它仍须符合产物绑定、固定分母和动作前计时，结果只供定位，不能并入正式 20 对、抵消 P1、宣称合格或支持上线。不为这一例外无限修工具或开展全矩阵。

## 4. 阶段 C：真实 WebView2 故障恢复

### C1. 先证明注入的是正确实例和文件

1. 启动专属 Tauri 测试实例，登记 exe hash、主 PID、WebView2 子进程、URL、实际 cache/profile 根。只连接该实例的 loopback CDP。
2. 缓存根必须是本轮独立子目录，且在现有 `$CACHE`/`LOCALAPPDATA` 权限内。验证实际文件确实落入该目录；仅设置一个环境变量不算隔离成功。
3. 用同一份受控音乐语料打开列表，选择已成功显示的 256 普通卡片、512 hero 和菜单封面。保存稳定条目 ID、owner、完整 token、URL、edge、截图。
4. 将 asset URL 映射到真实受管 JPEG，记录绝对路径、原文件 SHA-256 和备份。无法确认映射则停止注入。
5. 安装只记录本例的 load/error、请求及恢复事件；记录请求体中的来源/档位/客户端/代次。不要只保存命令总数。

现有历史 `native/inject-native.mjs` 依赖当时进程、CDP 端口和具体数据；**本手册不给一条未经适配的重放命令**。读脚本、修改测试配置、验证专属实例后才能复用。没有能力完成该步骤就标为未验证。

### C2. 每个故障用例的固定步骤

1. 先确认目标图完整显示，且当前 token 与 owner 一致；截图作为故障前证据。
2. 对本例对应的隔离 JPEG 做一种操作：删除；或写入明确无效的 JPEG 字节。不要同时注入多个故障，不触碰源音乐文件。
3. 让真实组件重新读取同一资源。优先自然离屏再回访/关闭再打开，使原图生命周期重新读取；记录是否导致了新 generation。
4. 若内存缓存掩盖故障，可在专属实例禁用浏览器缓存、对原元素清空 src 一帧后恢复同 URL，迫使真实 I/O。明确标注“受控 DOM 重读”，不能声称自然复挂载。此时必须保留原组件 handler，不能直接调用恢复函数冒充原生错误。
5. 从真实图片 error 开始观察 3 秒，保留全部事件。这里 3 秒是本轮固定观察截止点，不是已批准的产品 SLA；超时后保留未恢复状态，不临时延长以通过。
6. 检查当前条目的新 DOM 元素，而非已卸载的旧引用：身份正确、`complete && naturalWidth > 0`、有可见尺寸、最终 src 和截图相符。
7. 恢复备份 JPEG 并核对 hash，结束本例监听；下一例用新的干净测试会话，避免上例 blob/补救次数状态污染。

| ID | 必做场景 | 必留证据 | 通过标准 |
| --- | --- | --- | --- |
| N1 | 普通 256 卡片删 JPEG | 文件删除、error、token、请求体、恢复图 | 当前发布触发一次直接 pixels 补救并正确显示 |
| N2 | 普通 256 卡片损坏 JPEG | 解码 error，不能仅以 HTTP 200 当正常 | 同 N1 |
| N3 | 512 hero 删 JPEG | hero 实际 error 与 owner 处理、512 请求 lane | token 有效，首次补救走 pixels，恢复显示 |
| N4 | 菜单封面删 JPEG | 菜单真实消费者事件、最终画面 | 同 N3 的身份/恢复要求，档位以实际请求记录 |
| N5 | 同一发布多个消费者近同时 error | 相同 parent publication、各消费者与原生请求 ID | 每一合法恢复作业只启动一次；共享请求不重复计数 |
| N6 | 新图发布后送达旧图 error | 新旧 generation/revision/URL | 旧事件不能驱逐新图或触发新图补救 |
| N7 | pixels 补救也失败 | 两通道失败、队列终态、占位 | 有界终止，不循环请求、不永久 loading；已有可用图按契约保留 |

N5–N7 如暂时只能使用 harness，应分列“自动化通过，原生未验证”，不要改名成原生用例。每例固定重复 3 次，三个新会话；某次失败保留，不只挑成功的一次。

**次数判定**：必须用 `ownerSession + clientId + generation + publishGeneration + edge + recoveryEpoch` 或实际等价完整身份关联父发布和恢复作业，再以原生 `requestId` 去重。看到 2 个 pixels IPC 既不自动等于重复恢复，也不能自动解释为正常；没有请求归属就写“次数无法验证”。

### C3. 最小相邻回归

在全部歌曲、歌单列表、专辑、文件夹、搜索逐一检查：打开→滚动→离开→返回；播放一首再切歌；检查播放器大封面、背景与转场。正常、无封面、损坏图片样本分别标注，不能把占位算加载成功的封面。

每项保存入口、操作、截图、是否错误图/永久 loading/残影/闪白。只覆盖了歌单就只写歌单通过。普通列表卡片已经有 token 的证据不能覆盖 hero/菜单；hero 通过也不能反推全部 owner 通过。

## 5. 阶段 D：先证明测量工具可信

### D1. 当前工具不能照 README 的结论直接使用

阅读功能提交中的 `tools/thumbnail-benchmark/coverlane-README.md` 与脚本。本手册核对 `9e3a4f9` 时发现：

| 陷阱 | 当前实现/证据 | 执行要求 |
| --- | --- | --- |
| `warm` 名称不等于热缓存 | `coverlane-ab.mjs` 为每个 pair/arm/mode 新建不同根，未见将 fresh 缓存复制到 warm 或预热 warm 的操作 | 当前命令先只用 `--modes fresh`；热盘场景需补正确制备步骤和前后 hash 清单 |
| `--memory-seconds 620` 不保证滚动 620 秒 | stress 循环仍按 cycles 执行，结束即写 sampler-stop | 不能用此参数声称跑满 10 分钟；按实际开始/结束时间验收 |
| 内存采样器不含 CPU | `coverlane-memory.ps1` 当前 CSV 只有 working set/private bytes 等字段，进程树只在开始识别一次 | CPU 需另采；新增/重启子进程须补登记，不能说已完整覆盖 |
| 回落账本没有真实出口 | 现有实测缺恢复开始/结束与部分 pixels 终态 | 数值 0 只能写未观察到，不能写零回落 |
| token 的 README 描述陈旧 | 普通卡片可从 store 取得 token；缺口在 hero/菜单等直接入口 | 以本轮真实事件为准，不能沿用“整个 panel 无 token” |
| 采集器可能污染长测 | 历史 frame/event 数组无界增长 | 短测与资源测分开，资源测禁用该采集器或用有界采集 |

修测试辅助器只允许改变测试逻辑、采样和归档，不得改变产品调度、恢复、超时、权限或渲染来美化数据。若修改需要产品事件出口/公共契约，先交回 Architecture/实现者，不由本轮验证顺手实现。

### D2. 建立完整源码 → dist → exe 绑定

每臂用独立干净工作区，冻结完整提交与锁文件。以下是构建流程模板，所有路径变量都应先填入真实、互不冲突的新路径；不要把模板中的变量当现成产物。

```powershell
# 在已建立的该臂独立源码目录中执行
npm ci
node <已核实工具目录>/coverlane-isolation.patch.mjs apply --root <该臂源码目录> --json <本轮证据目录>/isolation.json
node <已核实工具目录>/coverlane-isolation.patch.mjs verify --root <该臂源码目录>
npm run build
npm run tauri build -- --no-bundle
```

上块含 `<...>` 的两行是**需替换路径的模板**，不是可直接粘贴的 PowerShell。先用工具已定义的参数填好；若隔离补丁定位失败，不猜改生产代码。两臂仅允许登记的 `AppPaths → THUMB_UI_ROOT`、原生文件选择器 → `THUMB_UI_PLAYLIST` 隔离，保留完整补丁和 hash。构建命令失败立即停该臂，不能继续拿旧 exe。

逐臂保存：完整 SHA、构建前后状态、全部生产差异、锁文件 SHA-256、隔离补丁及 hash、构建命令/日志/退出码、最终 `dist` 文件路径与 hash 清单、exe SHA-256、工具文件 hash 清单。Tauri 构建可能再次执行前端构建，以最终被打包的 dist 为准。

启动前将 exe hash 与 manifest 的预期值逐字比较，不同则立即停止；连接后记录实际进程 executable path、实际 WebView URL。必须是 release custom-protocol，不是 `localhost:5173` 的 Vite 页面。不要只用 `cargo build --release` 代替 Tauri 构建。Node 测试通过与 exe 来源一致是两个独立条件。

工具自动写入的 git facts 可能只是**工具所在工作树**的 SHA，不是两个 exe 的源码 SHA；必须分别在 manifest 中填写并核对。只比对六个源码文件不足以绑定完整构建。

### D3. 冻结语料、视口和目标集合

先用已有约 120 首的小语料完成核心试验，避免一开始准备大曲库耗尽时间。登记曲目数、独立封面 hash 数、尺寸/格式分布，不能将 120 首等同 120 个独立图。

使用测试专用的音乐副本或允许读取的固定语料。无图/坏图 fixture 只能在测试副本上准备，不改用户源文件。无图和坏图各自有已知标签；工具自动 probe 标签只是辅助，至少抽查首屏及异常样本，避免两臂共同出错而被标签掩盖。

准备好 `$BaselineExe`、`$CandidateExe`、`$CorpusList`、`$PlaylistFile` 四个真实绝对路径后，执行当前工具支持的命令：

```powershell
$FixtureFile = Join-Path $EvidenceRoot 'fixture120.json'
$FixtureScratch = Join-Path $EvidenceRoot 'fixture-scratch'
node tools/thumbnail-benchmark/coverlane-fixtures.mjs build --exe $CandidateExe --corpus $CorpusList --playlist $PlaylistFile --out $FixtureFile --scratch $FixtureScratch --cohort 8 --viewport 1600x1000 --dpr 1 --opacity 0.99 --required-frames 2
node tools/thumbnail-benchmark/coverlane-fixtures.mjs verify --fixture $FixtureFile
```

命令从含这些工具的已核实源码目录执行。fixture 的 cohort 是固定目标集合，记录真实条目 ID；8 只是本轮小样本首屏取样数，未覆盖全首屏就称“固定 8 张可见目标”，不得说“全部首屏”。检查所有目标在两个版本的相同视口确实可见，固定排序、布局和 DPR。fixture 的 universe 也须覆盖计划滚到的位置；缺条目就停止该场景，不能忽略缺失项。

### D4. 统一缓存术语

| 名称 | 本轮明确含义 | 必需证据 |
| --- | --- | --- |
| fresh：新应用缓存 | 启动前该臂根目录无缩略图，新进程、新 WebView profile | 启动前目录清单，以及动作前已被扫描/预热产生的缓存清单 |
| 热磁盘、新进程 | 先用同版本同语料按固定遍历生成缩略图；结束进程；保留该臂缩略图，使用新 profile/新进程 | 预热动作记录、缓存文件 hash、启动前后清单 |
| 同会话重访 | 同一进程完成固定首访后离开再返回，不清前端/浏览器缓存 | 首访过程、离开与返回动作标记 |

fresh 的准备扫描可能已经生成部分图，**不等于点击时所有图都冷生成**。记录动作前命中状态，必要时仅称“新应用缓存下，扫描完成后打开列表”。OS 页缓存不可控就明说；不使用“完全冷启动”。三个状态分开汇总，不能混成一个平均值。

### D5. 3 对试跑，只验采集器

仅在 B/C 适用正确性门槛通过、D1–D4 就绪后运行：

```powershell
$PilotOut = Join-Path $EvidenceRoot 'pilot-3pairs'
node tools/thumbnail-benchmark/coverlane-ab.mjs --baseline $BaselineExe --candidate $CandidateExe --fixture $FixtureFile --playlist $PlaylistFile --out $PilotOut --pairs 3 --modes fresh --actions open,scroll:fast --budget-ms 20000 --stop-budget-ms 12000
```

这是工具已支持的参数；不意味着当前有问题的产品已满足前提。脚本交替 A/B 顺序。每对两臂用同语料、同前置动作、各自独立等价缓存。打开后再滚动属于同一会话的固定顺序，滚动结果应称“打开后的快速滚动”，不能称独立冷滚动。

逐项检查原始 `arms/`、`results.json`、`manifest.json`，不要只看 `summary.json`：

| 核对项 | 通过信号 | 不通过时 |
| --- | --- | --- |
| 起钟 | 同一个页面单调时钟中，t0 在输入前；输入时间存在 | 不用该批耗时做结论 |
| 等待位置 | 打开后的网格/元数据等待计入总时延；滚动第一次输入前就开始记录 | 不允许先滚到目标停留 900 ms 再计时 |
| 前置加载范围 | 曲库导入/扫描是测量前准备，明确没有测首次导入总耗时 | 修正标题和结论范围 |
| 固定分母 | 每臂目标 ID 和有图数量相同；缺失、离屏、未就绪仍在记录 | 不能由已有 img 倒推目标 |
| 可见终点 | ID 相符、解码有效、可见面积>0、opacity≥0.99，连续 2 帧；关键截图一致 | 仅路径返回或 img load 不能算完整可见 |
| 截止点 | 打开 20 秒、滚动停止后 12 秒；未就绪写 timeout | 不改截止点、不删超时 |
| 空白曝光 | 从开始滚动累计，离屏未就绪写 censored-offscreen | 最终就绪不能抵消途中空白 |
| 缓存 | 实际目录/命中证据符合命名 | warm 名称或目录存在不算证明 |
| 观测成本 | 两臂采样相同，脚本无异常，关键截图均可关联 | 不给一臂开重 trace、另一臂关闭 |
| 归属 | 未采到的恢复出口标 unknown；原生和消费者分开 | 不把账本空数组解释成零回落 |

手动观察/截图适合确认正确性；**手动秒表不能支撑几十毫秒的改善结论**。DOM+rAF+截图是“可见代理”，不是直接测 GPU 上屏。若只能手测，交付体验观察并写“缺自动计时证据”。

## 6. 阶段 E：最小正式 A/B

### E1. 测试前写下规则，之后不改

将规则保存为本轮 `protocol.md`。下列数值是本轮建议的预登记操作门槛，**不是已有产品承诺或发布 SLA**：

- 两个核心场景：固定目标打开列表、打开后的快速滚动。小语料各 20 对；每对是同条件的一次 A 与一次 B。卡片数、帧数、一次运行中的多个请求不是额外独立样本。
- 首要指标：打开场景的固定有图 cohort 全部可见代理就绪耗时；滚动场景的空白面积×时间。首图耗时、停止后补齐时间、最长空白、错误/超时率为辅助指标。
- 建议实用门槛：打开的配对改善中位数同时达到 20 ms 和 10%；滚动空白面积×时间的配对相对改善中位数达到 10%。这些门槛在正式数据出来前固定；若 pilot 显示不适用，可先修改并说明原因，之后再开始独立正式批次。
- 必要约束：无新增错误图、永久 loading 或恢复故障；未就绪/超时比例不增。任一出现先报告功能问题，不用速度均值抵消。
- 失败率和超时单独报告；计时结果缺失不能填 0。含产品超时的成对样本不从成功组中悄悄删除；该场景完整改善结论暂不成立，另报“成功样本描述”，不能称总体收益。
- 顺序使用脚本的交替 A/B；固定机器、电源、WebView2、前台可见状态、窗口、DPR、日志级别。正式运行时不同时构建、升级软件或进行另一组压力测试。
- 固定停止：做满 20 对再汇总；技术故障样本保留并标 invalid，补跑相同条件并关联原 run ID。机器休眠/采集器崩溃可作技术故障；产品慢、破图、超时不是无效样本。
- 发生正确性退化或无界工作立即停下保留现场，标本批未完成。不要为了凑够 20 对继续消耗资源。

### E2. 正式运行

```powershell
$FormalOut = Join-Path $EvidenceRoot 'formal-20pairs'
node tools/thumbnail-benchmark/coverlane-ab.mjs --baseline $BaselineExe --candidate $CandidateExe --fixture $FixtureFile --playlist $PlaylistFile --out $FormalOut --pairs 20 --modes fresh --actions open,scroll:fast --budget-ms 20000 --stop-budget-ms 12000
```

pilot 不并入正式 20 对。若工具在一批中运行多个动作，每个动作单独统计；同一进程下的动作相关，不能合并成 40 个独立重复。正式测试开始后更换产物、fixture、测量代码或阈值，必须开新批次并重新登记，不拼接旧数据。

### E3. 汇总方法，不让 ds 猜统计口径

1. 从每个有效 pair 提取 A、B 的同一指标。时间改善为 `A_ms - B_ms`，相对改善为 `(A_ms - B_ms) / A_ms × 100%`；正数代表 B 更好。A 为 0 时相对值写不可计算，不除以 0。
2. 分别给 A/B 的中位数、均值、最小/最大值，给配对差值/比例的中位数、B 胜/平/负次数。不要用“不等数量请求的总字节”比值代替单资源收益。
3. 用成对重采样计算配对差值中位数的 95% bootstrap 区间：固定种子、10,000 次、每次对 20 个 pair 有放回抽样，保存统计脚本和种子。不会可靠实现则交回统计辅助器缺口；不凭手算给区间，也不声称统计显著。
4. 只有区间支持正向变化、达到预登记实用门槛、失败约束满足，才能写“本机本语料本场景支持改善”。仍需注明这是有限样本估计。结果跨 0、低于门槛或波动很大，写“未证明实用改善”，不自动加样本到有利为止。
5. 20 个样本的 p95 接近极端样本，仅作探索描述，不写“稳定尾延迟改善”。正式尾时延研究需要另定样本计划，不是本轮必要任务。
6. 打开改善而滚动不改善就分别陈述。只完成小语料，结论不能扩展至大曲库、慢盘、全部 UI 或所有机器。

最少交付以下表，不能只交柱状图或百分比：

| 场景/缓存 | 有效对数/失败数 | A 中位数 | B 中位数 | 配对差值中位数/区间 | 胜/平/负 | 门槛与结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 打开/fresh | 待填 | 待填 ms | 待填 ms | 待填 | 待填 | 待填 |
| 打开后快滚/fresh 会话 | 待填 | 待填 px²·ms | 待填 px²·ms | 待填 | 待填 | 待填 |

## 7. 阶段 F：有条件补齐，不挤占核心测试

### F1. 热缓存与重访

先按 D4 真的制备每臂缓存，再执行同口径 20 对核心场景；现有 `--modes warm` 不能代替此步骤，需要补测试辅助器的预热/复用流程及 manifest。每对各自重建等价缓存，不能 A 冷 B 热。

同会话重访需要“离开后再次打开”的**受测动作**。现有 `leave` 动作及随后未计时 `ensureListPanel` 不能直接充当重访打开耗时；需给测试辅助器添加明确重开测量并验证动作前起钟。无法补齐则把热盘/重访列为未验证，不影响已完成 fresh 结果如实交付。

### F2. CPU 与内存：另起干净进程

不要在故障注入后的混合 blob/JPEG 会话中宣称测了纯路径版。两臂各起全新专属实例，保持相同缓存制备、预热与脚本：

1. 固定预热 30 秒，稳定 15 秒；保存开始 DOM 汇总和专属进程树。
2. 运行相同的滚动/切页序列 **600 秒实际墙钟**，随后停止输入、空闲 **30 秒**；分别保存起止时间、循环次数。手动连续滚动不可作为严格同工作量 CPU A/B。
3. 用外部进程每秒追加一行 CSV，保存主进程、renderer、GPU、utility 的 PID、累计 CPU 秒、private bytes 和 working set。发现子进程变化，新增其身份与开始时间；别按名称把用户其他 WebView2 进程加进来。
4. 当前 `coverlane-memory.ps1` 可复用其逐行写盘内存采样部分；它没有 CPU 字段、开始后不更新进程树。需要补外部测试采样器；未补时只报告实际内存覆盖范围。
5. 不安装无界 frame/event 数组；需要 DOM 检查时每 30 秒只保存标量计数与少量截图，读完立即释放引用。采集器自身大小/丢弃计数也要有界可查。
6. 报告每角色起始稳定值、峰值、末段每分钟中位数、活动末五分钟斜率、30 秒 idle 后值；CPU 用相同活动窗口的累计 CPU 时间差，单位 CPU 秒。不要把它未经归一化称 CPU 百分比。
7. 一对资源试跑用于发现大异常，不能声称稳定 CPU 改善；需要 CPU 收益结论时至少 3 对相同协议并保留全部结果。这里与时延 20 对是不同实验。

内存回落不能证明无泄漏；活动期增长也不能直接证明泄漏。持续增长、作业数/监听数不收敛或出现缺图时先保留现场并停止，定位产品与采集器各自贡献。没有预登记资源预算就给趋势与风险，不自行创造“内存通过”的数字。

### F3. 扩展矩阵及延期规则

核心结果交付后才扩展：≥1000 个独立封面、大 DPI、真实无图/坏图、慢存储、更多列表入口。每项写“通过 / 不通过 / 未验证”，附样本数量和注入方式。

- 1000 个独立图需要 hash 清单，复制同一图片 1000 次只代表条目数量，不能代表独立图压力。
- 真实慢存储与测试延迟注入分别报告；在 mock 中 sleep 不代表慢盘。无设备就写未验证，不靠吞吐猜测。
- E1–E4 属于后续优化实验，不是本轮必须实现的测试准备。只有分段证据指出具体瓶颈，才另开单变量实验方案。

## 8. 字节、次数与速度必须分开报告

每个请求至少归属到稳定资源 ID、来源类型、档位、版本/代次、lane、终态。相同资源、相同档位、相同阶段的**完成请求**才能计算每资源载荷；失败、取消、在途各列，不混入分母或丢掉。

分别报告：IPC 请求字节、IPC 响应载荷、asset 读取字节、磁盘文件尺寸。路径字符串长度不是完整 wire 开销；JPEG 小不等于解码后内存小。不同通道的字节单位都可以是 B，关键是工作量和统计边界匹配；工具拒绝某比值时先解释边界，不改统计器强行通过。

历史“786,552 B / 518 B = 单张 1500 倍”来自不等完成请求数，不可复用。即使重测得到合法载荷下降，也只写载荷下降；加载时延改善必须引用 E 阶段结果。

## 9. 原始记录格式与交付目录

工具已有 JSON 原样保留，下面 CSV 是汇总交换格式，不能取代完整事件。暂缺字段填空并在 `missing-fields.md` 说明，不能填 0。

`runs.csv`：

```csv
batch_id,run_id,pair_id,arm,source_sha,exe_sha256,fixture_sha256,scenario,cache_state,order,t0_before_input,target_count,has_cover_count,ready_count,timeout_count,error_count,first_proxy_ms,all_proxy_ms,blank_area_ms,stop_settle_ms,status,invalid_reason,raw_evidence
```

`requests.csv`：

```csv
run_id,owner_session,client_id,generation,publish_generation,recovery_epoch,resource_id,edge,lane,attempt_id,parent_attempt_id,request_id,outcome,request_bytes,response_bytes,asset_bytes,duration_ms,evidence
```

`resources.csv`：

```csv
run_id,elapsed_ms,phase,pid,process_start_time,role,cpu_total_seconds,private_bytes,working_set_bytes,process_state
```

`cases.csv`：

```csv
case_id,repeat_id,source_sha,exe_sha256,layer,expected,actual,status,evidence,limitation
```

建议本轮目录结构：

```text
ds-<时间戳>/
  environment.md, capability.md, protocol.md
  builds/A/, builds/B/        # 源码、补丁、dist/exe hash、构建日志
  commands/                  # 检查日志、退出码、开始/结束时间
  code-regression/           # 新复制的反例脚本和结果
  native/N1-1/...             # 每例独立原始事件、截图、恢复 hash
  pilot-3pairs/               # 不纳入正式统计
  formal-20pairs/             # 两个核心场景分别汇总
  resources/                 # 独立干净会话与 CPU/内存曲线
  runs.csv, requests.csv, cases.csv
  statistics/                # 统计脚本、种子、输出
  report.md, missing-fields.md, cleanup.md, hashes.json
```

证据包包含必要脚本及配置，换机可查；原始音乐和用户音乐路径不随报告公开，稳定匿名 ID 与本地受控映射分开保存。报告提供证据根和关键文件 hash，不只给这台机器临时路径。

清理只关闭记录中的专属 PID，核对 PID 对应路径/开始时间，避免 PID 复用误杀；恢复所有故障文件并比较 hash。保留原始结果，不执行全局进程终止或清空用户缓存。测试目录日后删除前先核对绝对路径属于本轮证据根，使用 PowerShell `-LiteralPath`，不拼接其他 shell 删除命令。

## 10. 最终报告模板与完成清单

报告元数据沿用项目规范，`status` 只代表测试状态，不批准产品发布。至少写下：

```markdown
# OPT-0018 ds 本轮验证报告

## 摘要
正确性：[通过/不通过/证据不足]。
速度：[哪些场景支持改善/退化/未证明]。
CPU/内存：[实际观察及边界]。
本轮亲自执行到阶段：[A/B/C/D/E/F]；不能执行原因：[具体能力或文件缺口]。

## 范围与版本
A/B/B0 完整 SHA、源码差异、隔离补丁、exe hash、语料、机器与窗口条件。

## 实现交付与证据完整性
实现 Owner、已知主张、证据包路径、构建绑定结果、未取得项目。

## 命令
精确命令、工作目录、退出码、用例数、ignored 数、完整日志链接。

## 人工检查与原生检查
逐项 ID/重复次数/层级/预期/实际/证据；mock 与真实 I/O 分开。

## 根因与因果链反证
CE1–CE3 在 B0 与 B 的结果；旧事件、多消费者、pixels 再失败。
是否只恢复表象；至少一个替代解释及核对结果。

## 跨层契约与回归覆盖
token、owner、generation、lane、请求次数与终态；实际覆盖的界面。

## 性能与时序
预登记规则、pilot 验真、20 对结果、逐对差值/区间、失败/超时。
CPU/内存另表；已测与未测缓存状态分开。

## 发现、风险与临时缓解
实际缺陷、工具缺陷、证据缺口；未修复项及 Owner。
本轮是否实施临时缓解：[通常为否；若有须说明授权与撤除条件]。

## 验证结论与建议
是否满足本轮门槛、不能外推到哪些场景、下一步需要谁做什么。
不以局部通过宣布整个功能验收或发布通过。

## 证据及清理
原始文件入口/hash、统计脚本、备份恢复 hash、专属进程关闭记录。
```

结束前逐项勾选；没有完成用“未验证/阻塞原因”，不能留空或默认打勾：

- [ ] 已区分文档 develop 与功能被测提交，未修改用户工作树。
- [ ] 已保存命令全文与退出码，没有拿历史数字冒充本轮。
- [ ] 已核对 3 个反例及两个 P1；失败时停止正式提速验收。
- [ ] 已区分 harness、受控 DOM 重读、自然重挂载与真实文件故障。
- [ ] 已保存真实恢复请求归属，没有用总 IPC 数猜“恰好一次”。
- [ ] 已完成源码/dist/exe/实际进程绑定，没有拿旧 exe 接着测。
- [ ] 已用固定目标与动作前时钟，保留缺图、离屏、超时。
- [ ] 已完成 3 对 pilot；未将其并入正式结果。
- [ ] 已按固定 20 对核心协议汇总，没有择优追加或剔除产品失败。
- [ ] 已明确当前 warm、长测时限、CPU 与账本出口的工具限制。
- [ ] 已将载荷、磁盘、速度、CPU、内存分别下结论。
- [ ] 已列热缓存、大曲库、慢盘、无图坏图等实际未覆盖项。
- [ ] 已归档可复跑脚本与原始证据，并恢复故障文件/关闭专属进程。

**合格交付可以是“问题复现，验证不通过”或“证据不足”。目标是得到可信答案，不是把每一行写成通过。**
