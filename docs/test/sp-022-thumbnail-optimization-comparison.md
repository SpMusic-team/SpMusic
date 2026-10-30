---
doc_id: "TEST-SP-022-THUMBNAIL-OPTIMIZATION-COMPARISON"
title: "测试报告：缩略图基线与三阶段优化对照"
doc_type: "test-report"
status: "in-review"
owner_agent: "Test Agent"
version_scope: "SP-022 顺序优化实验"
created: "2026-10-20"
updated: "2026-10-21"
source_documents:
  - "user request: 清理探针，推送干净基线，然后依次优化 IO、转换与前端获取并比较"
  - "docs/tasks/sp-022-thumbnail-optimization-execution.md"
  - "docs/architecture/sp-022-thumbnail-optimization-baseline.md"
  - "docs/test/sp-022-backend-cover-concurrency-safety-verification.md"
  - "tools/thumbnail-benchmark/prepare.mjs"
  - "tools/thumbnail-benchmark/probe.rs"
  - "tools/thumbnail-benchmark/run-pairs.mjs"
  - "tools/thumbnail-benchmark/prepare-ui.mjs"
  - "tools/thumbnail-benchmark/ui-pairs.mjs"
  - "tools/thumbnail-benchmark/summarize-ui.mjs"
  - "src/features/player/components/playlistContentWindowLoading.browser.test.mjs"
---

# 测试报告：缩略图基线与三阶段优化对照

## 摘要

清理后的 B0 已固定为 `debd2ded0db4c136f47d4776aa24a85b214ca075`，后端 N=1 与前端两槽不变。阶段一冷封面定位改善约 8%，完整代理管线未证明净收益；阶段二 128px 冷转换对 B0 降低 38.61%，256/512px 未证明同等收益。真实 1797 首列表重开后的五组三臂对照中，最终 B3 对 B0 新位置图片 load 的配对 p50/p95 耗时降低中位为 **10.34%/10.77%**，完成率均为 700/700；另一个首开单对验证了原先“状态 ready 但图片未挂载”的缺口被修复。仍有未通过的旧 UI 回归套件，不能称全部回归通过或各档位都提速。

| 环节 | 变化与结果 | 结论边界 |
| --- | --- | --- |
| IO 读取 | 封面专用源命令跳过首帧、时长和歌词；冷定位约 +8%，实际缓存字节核验仍保留 | 独立完整代理管线未证明净收益；首次内容校验较慢，不能泛称所有热访问慢五倍 |
| 原图转缩略图 | 保守 4× 预降采样再 Lanczos3；128px 冷计算对 B0 +38.61%、对 B1b +36.75%，均 5/5 对更快 | 256/512px 未证明同等收益，部分首次热阶段退化；选取质量样本可接受，非逐像素等价 |
| 前端取得与显示 | 消费封面专用命令、元数据独立；补装 loading→ready 后滚动监听；B2→B3 UI p50/p95 +3.73%/+4.72% | 五对 p50 4/5、p95 5/5 更快；B3 包含 3a 与 3b，不能把全部增量严格拆给某一项 |

## 范围

后端代理使用外置工具对指定 Git 提交建立临时源码快照，仅在快照追加测试模块。代理直接调用真实封面 coordinator 和源解析函数，缓存根由测试显式传入新建临时路径，不启动音频设备、不调用 AppPaths。真实 UI 另用 Release WebView2 副本，只将 AppPaths 和选择器入口替换为显式隔离缓存/已知播放列表路径，保留真实后端读取、渲染及音频启动路径；不修改媒体或正式应用缓存。

固定样本是从只读本机曲库按既有媒体路径 BLAKE3 排序选出的 83 张有效 FLAC 内嵌图。匿名集合摘要为 `5b1fb04c10bb06040f3f52446d3549e0e78e6835ad3b0d80cce076966264ecd8`。素材准备曾完整解码，故后续“冷”只表示新的派生缓存，OS 文件缓存未控制。私有路径清单只保留于本机临时目录，不进入 Git。

## 实现交付与证据完整性

- 清理 Owner：Frontend Agent、Rust/Tauri Agent；主协调整合提交与推送。
- B0 包含此前已独立验证的 N=1 安全基础与实验 N=2 feature，不能称只有探针删除。N=2 未作为产品默认启用。
- 测试工具不被产品引用，不在生产源码留下运行时探针。
- 基线与每阶段分别冻结源码、测试模块、可执行文件及原始结果摘要。旧实验数据不作为新候选结果。
- 阶段一、二若只改变代理使用的源取得方法，收益仅说明新命令及算法成本，不提前声称列表 UI 已改善。

| 基线身份 | 值 |
| --- | --- |
| 正式代理二进制 | `%TEMP%\spmusic-thumbnail-B0v3-20261020\baseline-test.exe` |
| exe SHA-256 | `8e09b83e6062fe6e76cd8f222e0ebd6a079b1ec0408ac17883aea95f7709c445` |
| harness SHA-256 | `3db4b33029a96bfe6bc7df0dd3c29c576a81fe34691c14aa2bed2d64beb577c0` |
| 原始 cover_pixels.rs SHA-256 | `d580cf21bd4f61913a2006002e44475817da766780c35604437c59ed1a987d95` |
| Cargo.lock SHA-256 | `24564d8274d1f45a5ec46a00567cc7a3189500a3fe654aee69f7b2e8abcf093a` |
| package-lock.json SHA-256 | `cc1ed8ab30a85cd9adb45b9f053977eca98be2096cc1a9adc1c005058cdff9e0` |
| 机器 | i7-12700KF，12 核/20 线程；系统可见内存 33,390,540 KiB；Windows 11 Pro Insider 10.0.29683 |
| 工具链 | Rust 1.98.1、Cargo 1.98.1、Node v24.19.0；Release 默认 feature，N=1 |

## 命令

独立已执行：

| 命令 | 结果 |
| --- | --- |
| `git diff --check`（清理审核时） | 通过 |
| `node --check tools/thumbnail-benchmark/prepare.mjs` | 通过 |
| `node --check tools/thumbnail-benchmark/run-pairs.mjs` | 通过 |
| `node tools/thumbnail-benchmark/prepare.mjs debd2ded0db4c136f47d4776aa24a85b214ca075 <新临时快照根>` | 通过 |
| 快照内 `cargo test --release --lib --no-run --message-format=json`，`CARGO_TARGET_DIR=D:\SpMusic\src-tauri\target` | 第一版工具编译通过，19.63s；未计入性能数据 |
| 独立测试二进制 `audio::cover_pixels::thumbnail_comparison::freeze_corpus --ignored --exact --nocapture --test-threads=1` | 1 passed，83 张及集合摘要匹配 |
| 相同 B0 Git 快照配统一异步源适配器工具，`cargo test --release --lib --no-run --message-format=json` | 通过，22.43s（含等待构建锁）；正式 B0v3 exe 已独立复制保存 |
| B0v3 exe `audio::cover_pixels::tests --test-threads=1` | 独立 31 passed / 0 failed / 1 ignored，3.07s |
| `node tools/thumbnail-benchmark/prepare.mjs 2b2e636715c698982c2f9749e221bf2aa72da1fe <新B2临时根> cover-only build`，同一 `CARGO_TARGET_DIR` | 独占构建、即时复制和 test list 校验通过，25.23s |
| B2 冻结 exe `--test-threads=1` | 独立 **208 passed / 0 failed / 5 ignored**，4.13s；ignored 为旧实素材基准、质量导出及外置三项工具 |

主协调的仓库检查不列作 Test Agent 自跑：清理后 `npm run lint`、`npm run build`，Release lib 为 195 passed / 0 failed / 1 ignored；提交后工作树为空并推送成功。最终正式工作树 `cargo test --release --lib` 为 208 passed / 0 failed / 2 ignored（没有外加 harness 三项），最终 `npm run lint` 和 `git diff --check` 通过。Frontend Agent 的最终 `npm run build` 通过，只有既有 chunk 大小提示。最终提交/推送及洁净状态由主协调收口，本文不提前声称已完成。

## 人工检查

- 清理 diff：前端删除 DEV 全局对象、纯计数分支和只服务统计的类型/方法；8 canvas 租约、取消、有限重试、资源就绪与发布判断保留。全 `src` 未发现原两类调试对象/Ref 残留。
- Rust `THUMBNAIL_BENCH_PENDING_HITS` 仅 `cfg(test)`，没有读取；删除后保留 pending→disk→decode 分支。
- 真实列表固定位置跳转后停止、两次反向重访、面板重开：正式五组三臂已复核；没有把该脚本称为连续慢滚动或无限快滑压力覆盖。

## 根因与因果链反证

阶段一首版的反证已出现：跳过首帧、时长和歌词并不必然使取得封面更快。B1 新增的既有封面实际字节验证只发生在重复访问分支，原五对中的热定位稳定回归，而冷定位改善；这支持进一步调查新增缓存读取成本，不支持直接断言所有收益都由音频解析决定。`Take<File>::read_to_end(Vec::new())` 的小块读取/扩容是假设，须由单变量修正与复测验证，不能仅凭源码认定根因。

## 跨层契约

已独立只读核对 Rust `AudioPlaylistCoverSource`、`audio_probe_playlist_cover` 注册及输入，与前端真实 `invoke` 名称、`{input:{path}}`、camelCase 身份/封面字段一致。`coverArt:null` 表示确定无封面；非 null 保留可空 `filePath/dataUrl` 和 16 MiB 长度界。新 DTO 不伪装成完整曲目；完整元数据仍由独立通道取得。

阶段三静态核对：视觉结果类型仅含身份、封面色及图像字段，不会把晚到视觉结果的标题/时长覆盖元数据；源、像素错误分阶段分类，源容量错误仅在 recoverable 时有限重试；路径/trackId/epoch/scope/generation 及需求校验继续防止过期发布。生成 URL 后 decode 失败或过期仍撤销，升级失败保留旧图所有权。仅有 data URL 的原图沿用安静占位并标记该次视觉失败，不原图解码、不把占位记作成功升级，有旧图则保留。静态核对无阻断；新六场景动态证据来自 Frontend Agent，真实通信来自下文主协调执行的 Release UI，由 Test Agent 独立核验原始结果，不能把单侧 mock 当真实后端通过。

## 回归覆盖

阶段一、二的冻结 Rust 全回归覆盖封面选择、源替换、无封面、错误输入、链接/不可写回退、过载、取消许可、方向、比例、限额、版本隔离和播放器策略。阶段三静态与已交付浏览器场景覆盖元数据独立完成、陈旧结果、有限重试及 URL 所有权；真实 UI 覆盖实际通信、固定新位置、重访和首开缺口。较宽 UI 套件未全部通过，具体缺口见阶段三证据。

## 性能 / 时序

每个对照运行至少五对交错进程；每个进程使用新缓存根。固定两名持续像素消费者、后端 N=1，分别记录 128px 冷/热、256px 冷/两次热、512px 升级、源定位冷/封面文件已有、完整定位→256px 管线冷/热。逐请求 p50/p95 为各批样本排序后的 `floor((n-1)×p)`；配对改善按 `100×(1−candidate/baseline)` 计算。总工作耗时与批墙钟区分。

每轮后处理实际管线写出的原图文件，核对两臂原图字节的匿名集合摘要一致；每阶段要求完成数恒为 83、响应字节总量一致。该检查不计入命令请求时长，防止以漏图、选择不同图片或缩小输出尺寸制造假提速。

原始结果根：`%TEMP%\spmusic-thumbnail-*20261020*`。第一版工具只完成编译与样本冻结，未生成性能结论；统一异步源适配器后的版本才用于正式五对。

### 阶段一首版 B0 ↔ B1（已完成、未通过性能验收）

版本与输入：B0 `debd2de`，B1 `54214f5`；B1 测试 exe SHA-256 `1b6d6cee690ea812098f8c51ec65e1bcc5576ccc8ac426d6ec36fd97d8ee9ed6`。原始五对位于 `%TEMP%\spmusic-thumbnail-pairs-B0-B1-20261020`，10 个独立进程均成功、每进程 11 行阶段记录，逐阶段 83 项。2026-10-21 只读检查时无残留计时进程；以独立 PowerShell 从 10 份原日志重新解析并计算，结果与 Node 汇总一致。原始测试于 2026-10-20 完成，复算没有重跑或覆盖原始数据。

| 场景（83 张/批） | B0 批次中位 ms | B1 批次中位 ms | 配对耗时降低中位 | B1 更快对数 |
| --- | ---: | ---: | ---: | ---: |
| 128px 派生冷 | 5169.328 | 5141.102 | -0.37% | 2/5 |
| 128px 首次磁盘热 | 636.245 | 630.207 | -0.99% | 2/5 |
| 256px 派生冷 | 4347.753 | 4317.007 | +0.32% | 3/5 |
| 256px 首次磁盘热 | 733.825 | 741.330 | +0.02% | 3/5 |
| 256px 再次热 | 87.755 | 89.761 | -1.10% | 2/5 |
| 512px 首次升级 | 5083.202 | 4901.885 | +2.39% | 3/5 |
| 封面源定位、原图缓存新建 | 175.559 | 159.759 | +8.29% | 5/5 |
| 封面源定位、原图文件已有 | 127.181 | 646.914 | **-437.41%** | **0/5** |
| 两槽定位→256px、派生冷 | 4976.415 | 4838.314 | +1.55% | 3/5 |
| 两槽定位→256px、派生热 | 701.153 | 706.462 | +4.21% | 3/5 |

配对百分比与“两臂中位数相除”不是同一统计量，因此可能与表中两个中位数的方向不同。正值表示耗时降低。未改变的像素管线只显示正常轮次波动；不能将其中 0–2% 的差异归因为阶段一源解析改动。已有封面定位五对全部退化，幅度明显大于波动，首版需修正后重新比较。完整管线只有 3/5 对更快，不证明端到端收益。

独立真实性核对：10 个运行落盘原图文件的 SHA-256 集合摘要均为 `fa1896930ae8710d49c2a3e377e47031ff8a1eb456db1ee17e309e09a731bd48`；两臂完成数及各档响应总字节量一致。该检查支持没有通过漏图、换图或改变几何获得假收益；它不代替逐请求缓存命中/IO 系统调用计数。

命令为 `node tools/thumbnail-benchmark/run-pairs.mjs <B0v3/baseline-test.exe> <B1/candidate-test.exe> <固定corpus> <新五对目录>`。B1 独立 `cover_` 回归为 46 passed / 0 failed / 3 ignored（包括外置 freeze/measure 两项 ignored）；两臂回归和计时不在同一时间并行运行。原图字节集合复算使用 `Get-FileHash`、`SHA256::HashData`；日志复算使用 `ConvertFrom-Json`、逐对公式和排序取中位数。首次内联复算命令的管道语法错误已修正后成功执行，不影响原始数据。

### 阶段一 B1b 定长读取修正（已完成、根因假设未获支持）

B1b `a73a2dd7ced87adddee0c3c5035842ea2980ebb3` 仅修改新缓存命中的实际字节读取：对已校验长度分配定长缓冲，`read_exact` 后再读一字节检查 EOF，Windows 句柄只共享读取；仍核对真实字节，不以文件名或 mtime 代替。增加末尾变化/长短文件和真实 junction 回归。阶段二转换代码没有混入该提交。

独立快照 `%TEMP%\spmusic-thumbnail-B1b-20261021`，测试 exe SHA-256 `19535992edbc59ec8bd4040e1d47d348be4cbdfbee91a5c5284e11fca852c5ff`；harness 与 B1 相同。独立 `cargo test --release --lib --no-run --message-format=json` 通过（24.20s）；保存独立 exe 后运行 `cover_ --test-threads=1` 为 **48 passed / 0 failed / 3 ignored**，2.54s。新五对根为 `%TEMP%\spmusic-thumbnail-pairs-B0-B1b-20261021`，构建/UI 均在计时开始前停止，10 次全部成功。

独立 PowerShell 再从 10 份原始日志解析 110 行，核对成功状态、每阶段 83 项、全部阶段中位数与逐对百分比，和 Node 汇总逐项相符。

| 场景（83 张/批） | B0 批次中位 ms | B1b 批次中位 ms | 配对耗时降低中位 | B1b 更快对数 |
| --- | ---: | ---: | ---: | ---: |
| 封面源定位、原图缓存新建 | 188.520 | 162.908 | +7.86% | 5/5 |
| 封面源定位、原图文件已有 | 118.662 | 672.747 | **-481.45%** | **0/5** |
| 两槽定位→256px、派生冷 | 5008.689 | 4919.261 | +1.80% | 4/5 |
| 两槽定位→256px、派生热 | 737.651 | 743.371 | +1.02% | 3/5 |

已有封面定位逐请求 p50/p95 的五轮中位为 B0 **1.111/3.458 ms**、B1b **8.013/9.620 ms**；完整管线热态对应 **15.923/21.477 ms** 与 **15.856/19.650 ms**。定长读取没有改变约 650–700ms/批的首次缓存定位成本，故“小块读取/Vec 扩容是该回归根因”假设**未获支持**，不能作为修复成功结论。

另一个待验证解释是首次文件内容读取的成本在源定位与后续像素之间移动。B0 本轮 256px `disk_hot` 批次中位 **784.344 ms**，随后 `repeat_hot` 为 **93.270 ms**，与源定位的差量同量级；然而这来自不同阶段的批次，不能仅用分位数相减断言同一 IO 事件。连续多次源定位与像素热访问已在隔离快照补测，见下节；生产代码没有加入该诊断探针。

### 重复热访问诊断（已完成，仅作机制证据）

工具在临时源码快照新增 ignored `diagnose_reads`，对同一新根连续执行源定位 cold/hot1/hot2/hot3、像素 cold/hot1/hot2/hot3、完整管线 cold/hot1/hot2；生产源码无该探针。B0、B1b 各 3 次独立进程，83 张、N=1、两个像素消费者不变。最终 B0 三次在 B1b 三次之后重跑，**不是正式交错配对**，不得拿其跨臂差异代替五对性能结论。

| 场景（83 张/批，中位 ms） | B0 | B1b |
| --- | ---: | ---: |
| 源定位 cold | 186.191 | 173.201 |
| 源定位 hot1 | 129.471 | 676.840 |
| 源定位 hot2 | 129.726 | 110.354 |
| 源定位 hot3 | 119.479 | 113.427 |
| 256px 像素 hot1 | 776.995 | 779.667 |
| 256px 像素 hot2 | 86.578 | 93.088 |
| 256px 像素 hot3 | 86.726 | 86.575 |
| 完整管线 hot1 | 716.099 | 759.736 |
| 完整管线 hot2 | 107.460 | 134.747 |

该诊断反证了“B1b 每次重复定位均需约 650ms/批”的解释：只有新原图文件首次内容校验有此额外成本，此后源定位回到约 110ms/批。未改变的像素路径在两臂也出现 hot1 明显慢于 hot2/hot3。证据支持进一步研究新文件首次内容访问成本，以及源与像素阶段之间的成本移动；未分离系统调用/OS 缓存/防病毒过滤器，**不能断言具体系统原因或已证明成本完全前移**。完整管线仍无净提升证明，单源准入和真实缓存字节核验的成本也未被排除。

原始证据 `%TEMP%\spmusic-thumbnail-repeat-diagnostic-20261021`。首次 B0 诊断拷贝误取到被共享 target 后续构建覆盖的 exe，实际只运行 0 tests，三个 115B 的 `*-B0.log` **全部作废且保留**。B0 重新构建后在同一命令立即复制、核对 test list 为 199 项且包含目标诊断，再以 `*-B0-corrected.log` 完成三次有效运行；B1b 三份日志均实际 1 passed。修正后的 B0 exe SHA-256 `8916cd1599c4d1149c0adc308d2aef500c99922dd5470858526040b5c7cf220e`，B1b 为 `64e1952a1fa8ad09bf0fa26972fed444cdaa97886969c64a932a1507cd556ea2`。工具 `prepare.mjs` 新增可选 `build` 模式，把编译、即时 copy、test-list/模块校验和哈希冻结放入同一进程；后续仍需协调独占构建窗口，不能只依赖 cargo 锁。

### 阶段二质量候选筛选与冻结回归

阶段二固定为 `2b2e636715c698982c2f9749e221bf2aa72da1fe`。列表专用转换先按整数块平均缩小，再做最终 Lanczos3；只在两轴均可至少缩小两倍且中间图仍不小于最终尺寸四倍时触发，播放器大图继续原策略。缓存变换版本从 t1 升为 t2。

先前 2× 中间尺寸的候选没有进入最终提交：Test Agent 独立检查棋盘 128px 的对照时发现可见规则网纹/摩尔差异，不能仅凭计算更快接受。改用 4× 后，2026-10-21 独立通过 `view_image` 查看 `checkerboard-128-bg255.png`、`text-lines-256-bg255.png`、透明边缘 256px 的黑白底、`cover-01-256-bg255.png` 与 `cover-04-128-bg255.png` 六张对照（每张三列为原 Lanczos／候选／差分放大 8 倍）。原尺寸观察未见 2× 版本的明显网纹或透明色污染，真实封面主体及文字基本相近，允许其作为保守候选进入性能测量。

这不是逐像素等价或全部素材质量通过的声明：高频差分仍有结构，部分细线有差异；48 张导出文件不是 48 张全部逐图独立审阅。证据目录为 `%TEMP%\spmusic-thumbnail-quality-4x-20261021`，保留旧 2× 目录作拒绝证据，不将用户封面或媒体路径上传 Git。冻结 B2 二进制已独立运行全部非忽略回归，208 passed / 0 failed，包含方向、比例、播放器策略、版本失效、限额、缓存/并发及源读取回归；不再仅引用实现者的 33 项自测。

| B2 身份 | 值 |
| --- | --- |
| 正式代理二进制 | `%TEMP%\spmusic-thumbnail-B2-20261021\test.exe` |
| exe SHA-256 | `287ce8e11bd776c3887b1915c4a7e28bb2ca7548d9dad80514aba0c2ad71cf74` |
| harness SHA-256 | `30d5b8fde9d9c22f04b4e99751ab84f9cb59e76a0ee8a994e9aa970261d9831a` |
| 原始 cover_pixels.rs SHA-256 | `6358845b157fb7a6b2d779331404a060af301685f3fc5cb2adf197b9c318e60c` |
| test list SHA-256 | `3593e4c6c76069a56e9a3f601f2e9350a772976d49c1200afe46c951e2928fb4` |

### 阶段二 B0 ↔ B2 五对

原始结果 `%TEMP%\spmusic-thumbnail-pairs-B0-B2-20261021`。命令为 `node tools/thumbnail-benchmark/run-pairs.mjs <B0v3/baseline-test.exe> <B2/test.exe> <固定corpus> <新五对目录>`，五对 AB/BA 交错、10 个独立进程全部成功，计时期间没有其他构建或 UI 测试。每阶段 83 张、输出字节总量和落盘原图字节集合一致。

| 场景（83 张/批） | B0 批次中位 ms | B2 批次中位 ms | 配对耗时降低中位 | B2 更快对数 |
| --- | ---: | ---: | ---: | ---: |
| 128px 派生冷 | 5756.393 | 3537.192 | **+38.61%** | **5/5** |
| 128px 首次磁盘热 | 730.968 | 736.754 | -1.88% | 2/5 |
| 256px 派生冷 | 4766.513 | 4787.610 | -0.57% | 2/5 |
| 256px 首次磁盘热 | 845.247 | 894.746 | -5.45% | 0/5 |
| 256px 再次热 | 104.125 | 113.916 | -1.14% | 2/5 |
| 512px 首次升级 | 5379.628 | 5514.535 | -2.51% | 1/5 |
| 封面源定位、原图缓存新建 | 208.641 | 193.550 | +3.34% | 3/5 |
| 封面源定位、原图文件已有 | 134.164 | 741.229 | -453.10% | 0/5 |
| 两槽定位→256px、派生冷 | 5423.864 | 5210.515 | +3.70% | 4/5 |
| 两槽定位→256px、派生热 | 785.775 | 826.878 | -3.87% | 0/5 |

明确收益限于 128px 冷转换。4× 保守阈值令较高档位较少触发预降采样，不能从 128px 收益推导 256/512px 或实际 UI 同等提速。本组 256px 首次磁盘热和完整热管线 0/5 对更快，小幅回归如实保留；源定位首次内容读取的大差距延续阶段一机制，不能归于 B2 缩放算法。t2 会使旧派生缓存重建，存在一次迁移成本。

### 阶段二 B1b ↔ B2 五对（隔离转换增量）

原始结果 `%TEMP%\spmusic-thumbnail-pairs-B1b-B2-20261021`。命令与上组相同，仅将第一臂替换成冻结的 B1b `candidate-test.exe`，新建独立输出根。B0↔B2 结束后顺序运行，本组计时也无其他构建、UI 或浏览器测试。

| 场景（83 张/批） | B1b 批次中位 ms | B2 批次中位 ms | 配对耗时降低中位 | B2 更快对数 |
| --- | ---: | ---: | ---: | ---: |
| 128px 派生冷 | 5407.012 | 3367.927 | **+36.75%** | **5/5** |
| 128px 首次磁盘热 | 694.401 | 723.647 | -4.49% | 1/5 |
| 256px 派生冷 | 4525.110 | 4435.323 | +1.11% | 4/5 |
| 256px 首次磁盘热 | 802.875 | 873.466 | -9.29% | 1/5 |
| 256px 再次热 | 100.961 | 103.867 | +10.61% | 3/5 |
| 512px 首次升级 | 5159.384 | 5280.209 | -4.38% | 1/5 |
| 封面源定位、原图缓存新建 | 180.064 | 186.867 | +3.00% | 3/5 |
| 封面源定位、原图文件已有 | 710.941 | 699.193 | +1.65% | 3/5 |
| 两槽定位→256px、派生冷 | 5037.984 | 5019.468 | +1.57% | 3/5 |
| 两槽定位→256px、派生热 | 764.880 | 792.570 | -3.62% | 1/5 |

两组正式五对均由 Test Agent 另用 PowerShell 从原始 10 份日志重新解析 110 行：确认每次真实目标测试为 1 passed / 0 failed，而非只看进程退出码；每阶段 83 项、响应字节一致，逐阶段两臂中位数、五个配对百分比的中位数和更快对数均与 Node 汇总相符。原图落盘匿名 SHA 集合由 runner 逐运行核验一致。复算存为各结果根下 `independent-powershell-recompute.json`，不覆盖原始日志。

B1b↔B2 的源取得方法完全相同，128px 冷计算持续减少约三分之一，支持收益来自列表转换策略；高档位、热缓存和 256px 完整管线未表现出同等收益。再次热的配对 +10.61% 仅 3/5 对更快，且两臂中位数方向相反，不作为稳定提升。首次热与 512px 的退化信号需保留；本轮没有系统调用级证据去解释其机制。此代理阶段仅支持“128px 冷转换提升”，产品净效果另见下文真实 UI 对照。

### 阶段三版本与回归证据

3a `f3f1cc479e847d4af89876584474d54fb411bda1` 修复 summary loading 时 grid 未挂载、effect 提前返回后没有再绑定内容窗口监听。3b `333bad4e37cfab295be095058b91cb93172a41fd` 接入封面专用通道并收窄视觉结果，最终 UI 称 B3。独立静态核对根因与跨层契约，未发现阻断。

以下浏览器命令由 Frontend Agent 执行，Test Agent 复核测试源码及已交付工具输出/部分 JSON，**不是 Test Agent 独立重跑**。共同环境为 `SPMUSIC_TEST_ORIGIN=http://127.0.0.1:5177`，`SPMUSIC_PLAYWRIGHT=C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`；Vite 命令 `npm run dev -- --host 127.0.0.1 --port 5177 --strictPort`，Edge headless 157.0.4341.10。表中脚本均位于 `src/features/player/components/`，执行 `node <脚本>`。

| 脚本 | 已有结果及独立复核范围 |
| --- | --- |
| `playlistCoverPreload.browser.test.mjs` | 14 场景通过；新增六场景覆盖双通道互不等待、源错误有界重试 14 次、dataURL-only 不解原图/不虚报升级、旧图保留及身份错配无 URL。原场景覆盖迟到解码与释放、像素错误、升档、失败最多 3 次、844 图约 98.6MB 准入及文本/无封面/不可用 |
| `playlistContentWindowLoading.browser.test.mjs` | 200 卡 loading→ready，在 50%/90%/20% 三处实际图片完成；内存恢复旧 `active: isPresent` 单变量时首个滚动断言 8 秒失败，新条件通过。核对没有放宽完成断言 |
| `playlistTrackSummaries.browser.test.mjs` | 4 项通过 |
| `playlistStatisticsPreload.browser.test.mjs` | 11 项通过 |
| `playlistPreviewMetadata.browser.test.mjs` | 5 项通过；StrictMode 测试 listen mock 清理加 callback 身份保护后通过，未改变产品监听行为。Test Agent 只读确认 `%TEMP%/spmusic-preview-metadata/current-*.json` 七份阶段快照及新封面命令存在 |

这些执行没有另存完整 stdout 文件，原始终端证据仅在 Agent 工具输出，不虚构 TEMP 日志。较宽 UI 套件仍未通过，不能称全套绿：

- `playlistOffscreenReturn.browser.test.mjs` 全量及 `SPMUSIC_OFFSCREEN_FOCUSED=1` 在第 255 行管理组入场 1.5×/-75% 首帧断言失败。只在内存 route 恢复旧 `useAudioPlayer.ts`（3a SHA，上述旧 hook）同 fixture 也失败同一断言；这反证失败并非仅由 3b hook 产生，不等于 B0 全项目复现。输出只有 actual false，没有数值可报告。
- `playlistManagement.browser.test.mjs` 第 139 行默认 player 启动下等待媒体库区域超时；`SPMUSIC_SCROLL_ONLY=1` 第 345 行同类入口超时。临时指定 media-library 启动后第 172 行 overview dock 期望 0、实际 1；临时启动修改已撤回。未做旧 hook 反证，归因未定。
- `playlistManagementMotion.browser.test.mjs` scale=3 的稳定时间 757.4ms 超过 725ms；`SPMUSIC_MOTION_FOCUSED=1` 分支报 `reduced is not defined`，源码可见块作用域外引用。没有旧 hook 对照，不能将计时失败直接断言为既有缺陷。未改相关产品动画、放宽断言或延长门槛。

### 真实 UI：列表重开后五组三臂对照

主协调执行真实 Release UI，Test Agent 独立从原始 `results.json` 与 15 份 `memory.csv` 用 PowerShell 复算。证据根 `%TEMP%\spmusic-thumbnail-ui-formal-triads-20261021`；各组三臂顺序为 B0/B2/B3、B3/B2/B0 交替。B0 与 B2 使用完全相同冻结前端 index SHA `6502b990dff74ecb10264882c7cb297ac028ab0427a20493f6d783897137f328`；B3 index SHA `800aca832348324e7b640ef324fa8616109823f0f7207f22133aaed0972d30d9`。

| UI 二进制 | SHA-256 |
| --- | --- |
| B0 `baseline-ui.exe` | `c3286a3b0490e4873c8f3343e5fb544d493683d7b3b3ea9f840b7d6a2e8d4f45` |
| B2 `stage2-ui.exe` | `a306410eb52c63cde8d9cc0e82272de1c87fb8923f9870afd82d33d744d81064` |
| B3 `final-ui.exe` | `f69ac3aafc700a34439d66f99b8e7f17933c6e2685d65201ee68f44e0a47143d` |

三个快照的 `ui-identity.json` 源码 SHA 与已冻结提交一致，隔离 AppPaths 补丁 hash 相同；Test Agent 重新读取 exe 的 SHA。实际输入为用户 `E:\temp` 中的 1797 项列表，播放列表文件 SHA `af6eb1d97a34a177ff4bdda5bfbc2fae7f399c847e09345d8290d80d35f49405`；identity 中 corpusCount=83 只是共用代理 manifest 的身份，**不是实际 UI 只有 83 首**。不提交该列表的私有路径清单。

执行为 `node tools/thumbnail-benchmark/ui-pairs.mjs <B0 exe> <B3 exe> <private manifest> <新结果根>`，环境设 `THUMB_UI_STAGE2_EXE=<B2 exe>`、`THUMB_UI_PLAYLIST=<用户列表>`、`THUMB_UI_REOPEN=1`、`THUMB_UI_PAIRS=5`、`THUMB_UI_DWELL_MS=3500`。每臂新应用缓存与 WebView profile，native picker 在副本禁用，沿真实 `list_folder_tracks` 读取已知路径。viewport 为 2560×1439、DPR=1、level=0；summary ready 后关闭/重开列表，位置为 0/25%/50%/75%/95%/50%/25%，每点等待 3.5 秒。

独立复算确认每个 episode 的目标 index、不可用和无封面排除集合一致，所有 1797 卡和布局一致。四个新位置每 run 140 个目标，**每臂五轮 700/700 eligible、700 个实际新 load、0 错误、0 未完成、0 alreadyReady**。不存在只对完成者算分位数而隐藏超时。两次回访每臂 350/350 已在观察起点就绪，单列为 ready，不编造成 0ms 新 load。初始区每臂 105/105 完成，起点已就绪 B0/B2/B3 分别 48/53/50，未混入新位置分位数。

| 比较 | 两臂每轮 p50 的中位 ms | 两臂每轮 p95 的中位 ms | 配对 p50 降低中位（更快对数） | 配对 p95 降低中位（更快对数） |
| --- | --- | --- | --- | --- |
| B0→B2 | 1372.8→1290.6 | 2581.0→2412.3 | +5.58%（5/5） | +7.34%（5/5） |
| B2→B3 | 1290.6→1258.8 | 2412.3→2278.7 | +3.73%（4/5） | +4.72%（5/5） |
| B0→B3 | 1372.8→1258.8 | 2581.0→2278.7 | **+10.34%（4/5）** | **+10.77%（5/5）** |

B0→B3 第五对 p50 为 -0.44%，B2→B3 为 -6.37%，不是五对所有指标都更快。B2→B3 包含 3a+3b，重开场景让基线监听也有效，但没有 3a-only 正式三臂，不能将增量精确拆给 3b。B0→B2 的 UI 使用旧消费者，因此该组改善支持后端版本的真实产品效果，不能倒推新封面命令在阶段一已被 UI 消费。

各 run rAF 间隔 p50/p95 的五轮中位三臂均约 **3.1/12.4ms**；超过 33.34ms 的样本总数 B0/B2/B3 为 **0/1/2**，总帧数 **31274/31417/31645**，不证明滚动帧性能改善。

| 启动子树角色 | 采样 private 峰值的五轮中位 MiB，B0/B2/B3 | 采样 working set 峰值的五轮中位 MiB，B0/B2/B3 |
| --- | --- | --- |
| Rust | 79.77 / 73.39 / 67.99 | 100.02 / 90.62 / 91.68 |
| Renderer | 341.50 / 358.09 / 352.57 | 411.53 / 422.07 / 418.17 |
| GPU | 804.05 / 829.14 / 805.96 | 217.95 / 212.32 / 218.28 |

不能据 Rust 降低宣称整体内存都下降。采样只包含启动时枚举的进程子树，间隔 500ms，漏掉短峰和后起/替换进程；各 PID 最后读数之和不是同期结束内存，也不是泄漏证明。没有长期资源回落结论。复算文件为结果根下 `independent-powershell-recompute.json` 与 `independent-memory-recompute.json`。

### 真实 UI：首开缺口单对复核

证据 `%TEMP%\spmusic-thumbnail-ui-first-open-final-20261021`，设置 `THUMB_UI_REOPEN=0`、`THUMB_UI_PAIRS=1`，其余布局/列表/等待相同。文件 protocol 文本是共用“五对”模板，本实验实际只有 **1 对/2 runs**，不扩大样本量。Test Agent 独立核对七个位置的目标与 eligible 一致：首屏两臂均 21/21 完成；四个新位置 B0 **0/140**、B3 **140/140**；两次回访 B0 **0/70**、B3 **70/70**。B0 的所有新位置虽然状态 ready，contentVisible 为 false、没有实际图片完成，确认监听/挂载传播缺口；B3 实际内容和图片均完成。这与 200 卡旧条件失败/新条件通过的单变量反证相符。B0 未完成者保留分母，不为其生成速度分位数，也不将“0→100% 完成”说成耗时降低百分比。

## 发现

未发现探针清理影响功能决策。阶段一时期轻量命令尚未接入 UI，其分段差异只作为代理结论；阶段三已接入，真实对照另行支持总体约 10% 的新位置 load 改善。首次内容核验的源读取差距与热阶段小幅退化仍保留，不因最终 UI 改善而删去。首开显示缺口已获得真实 UI 和单变量合成反证支持。

## 风险

代理为 Release `cfg(test)` 快照，不能将绝对耗时当作 WebView 延迟。素材准备预热 OS/codec，没有系统缓存冷态证明；UI 的首次位置也可能被既有预取预热。原生 img load 不等于最终淡入/paint。本轮没有生产阶段探针或命令 trace，IO/哈希/解码/缩放/BMP/IPC 的细分贡献未被同时独立计时；不能从不同样本分位数相减归因。Lofty 内部暂存、codec scratch、短暂进程峰和长期内存平台未获得硬界证明。质量仅审阅六张对照，较宽 UI 套件的未解决失败及归因限制如上，不可抹去。

## 临时缓解

未将改变超时、吞错、增加并发或删掉有效需求作为优化。无此类临时缓解结论。

## 验证结论

本次测量与独立复核任务已完成。探针清理通过，阶段一局部冷源定位改善获支持，完整代理管线未证明净收益。阶段二冻结版本 208 项非忽略回归通过、所选质量样本可接受，128px 冷转换有稳定改善，其他档位/热态不能泛化。最终真实 UI 指定重开场景对 B0 新位置 load p50/p95 配对降低约 10%，完成率未下降；首开缺口的修复有证据支持。**性能目标在已测场景获支持；全范围回归验收仍有证据缺口**，不能声称所有回归通过、所有 IO/缩放档位都更快或长期无泄漏。

## 建议

主协调按已冻结提交和本报告收口 Git；最终向用户同时给出实际改善、未证明项与残余测试失败。较宽 Management/Motion 的归因及 offscreen 入场断言需保留后续跟踪，不以删断言、放宽超时或隐藏失败作为完成依据。
