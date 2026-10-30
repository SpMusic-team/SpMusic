---
doc_id: "TEST-SP-022-VISIBLE-COVER-LATENCY"
title: "测试报告：停滚后的可见封面加载"
doc_type: "test-report"
status: "in-review"
owner_agent: "Test Agent"
version_scope: "SP-022 可见封面延迟实验"
created: "2026-10-21"
updated: "2026-10-21"
source_documents:
  - "user request: 直接进行修改，修改后进行测试，若无明显改进再回滚版本"
  - "docs/tasks/sp-022-visible-cover-latency.md"
  - "docs/test/sp-022-thumbnail-optimization-comparison.md"
  - "tools/thumbnail-benchmark/ui-pairs.mjs"
---

# 测试报告：停滚后的可见封面加载

## 摘要

本轮以 `f063f70` 为新基线，保留此前缩略图优化、快速索引和全部歌曲布局。完成 A 缓存快路与 B 可见预览的实际实现、正确性检查，以及真实 1797 首列表的 **1 组筛选三臂 / 6 次运行**。A 的首显改善仅约 2%/8%，AB 虽让空缓存起始的预览提前约 25%，却延迟最终清晰图，未达到预先冻结的保留门槛。主协调已按用户授权在 `5346aea` 回滚本轮四个业务/实验测试文件，恢复为 `f063f70` 的对应内容，保留工具和证据。此结论是筛选淘汰，不是五对稳定收益结论，也不是统计证明候选毫无局部改善。

| 候选 / 场景 | 停滚首显 T90 的运行 p95 | 相对基线 | 最终清晰度结果 | 决定 |
| --- | ---: | ---: | --- | --- |
| A，空派生缓存起始 | 4.040s（基线 4.123s） | 降低 2.01% | 252/252，耗时同首显 | 不足 20% 筛选门槛，回滚 |
| A，磁盘派生缓存重用 | 2.486s（基线 2.715s） | 降低 8.44% | 252/252，耗时同首显 | 不足 20% 筛选门槛，回滚 |
| AB，空派生缓存起始 | 3.110s（基线 4.123s） | 预览降低 24.56% | 6.5s 观察窗末仅 233/252 达同卡基线清晰度，质量 T90 删失 | 不通过清晰度/完整性守门，回滚 |
| AB，磁盘派生缓存重用 | 2.488s（基线 2.715s） | 预览降低 8.38% | 252/252，但质量 T90 p95 为 4.001s，回退 47.34% | 不通过 20% 首显及最多 10% 质量回退守门，回滚 |

原视频的宽屏密集网格与目标视频手机单列工作量不同；目标用于定义停滚后的成屏体验，实际收益在相同 SpMusic 布局下比较，不能从两录像直接算速度倍数。

## 范围

候选 A 将派生缓存的有限预查与冷转换排队分开；候选 B 先为可见项提供 128px 预览，再升级为原有目标尺寸。两者独立冻结、比较，默认冷转换并发、动画、无图语义和媒体文件保持不变。Test Agent 仅拥有本报告，不修改业务代码或主协调拥有的测量工具。

## 实现交付与证据完整性

- 实现 Owner：Rust/Tauri Agent、Frontend Agent；架构在实施前审查。A 为 `b4c1a28`，AB 为 `299a4f7c50b8a5931a5251c5e5a3e46003029d37`。AB 同时收录 A 取消测试的准入反证强化，生产后端逻辑与 A 相同。
- 复现基线：Git 为 `f063f70`；本轮 Release 二进制、dist、工具摘要及实测身份待冻结，不能复用上轮 B0/B3 的绝对时间。
- 已知因果链：前端两个槽位覆盖源取得至浏览器解码的整个任务；原后端获取冷转换许可后才读取原图和查派生缓存，热请求可能被冷转换挡住。封面逐张出现不自动证明 React 或 CSS 淡入为主因。
- 筛选证据：同布局真实列表三臂在 fresh 与 disk-warm 各运行一次；未进入五对正式保留验收。内存驻留命中场景没有获得：本轮所有回访目标在快照时的 alreadyReady 均为 0，不能将其称为内存命中测试。
- 证据缺口：没有五对交错的稳定收益/回归统计、长期资源回落与系统冷缓存证明。候选在筛选阶段已违反质量门槛/不足首显门槛，因此不通过增加样本来放宽保留条件。

## 命令

Test Agent 获得独占 Cargo 窗口后，在工作区实际执行 Release lib 回归。前端命令为 Frontend Agent 的自测，Test Agent 只读复核其完整日志；未冒称自行执行浏览器套件，也未与正式计时并行运行测试。

| 命令 | 状态 |
| --- | --- |
| `npm run lint` | Frontend Agent 执行通过，Test 复核 `lint.log` |
| `npm run build` | Frontend Agent 执行通过，Test 复核 `build.log`；有既有大 chunk 警告 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Rust/Tauri Agent 执行通过；Test 未重复执行 |
| `cargo test --manifest-path src-tauri/Cargo.toml --release --lib` | **Test 独立执行通过，219 passed / 0 failed / 2 ignored**；编译 18.51s，测试 1.64s |
| 回滚后同一 `cargo test --manifest-path src-tauri/Cargo.toml --release --lib` | **Test 再独立执行通过，214 passed / 0 failed / 2 ignored**；编译 17.40s，测试 1.60s。五项候选专属测试随实验实现撤回，不能继续宣称恢复版 219 项 |
| `node tools/thumbnail-benchmark/visible-pairs.mjs <baseline.exe> <AB.exe> <manifest> <新输出根>` | 主协调执行 1 组三臂 / 6 runs 筛选通过运行；`THUMB_UI_STAGE2_EXE=<A.exe>`、`THUMB_UI_PAIRS=1`、`THUMB_UI_PLAYLIST=E:/temp/网易-我喜欢.m3u8`、layout1、默认新进程/6500ms/2560×1439/DPR1 |
| `node tools/thumbnail-benchmark/summarize-visible.mjs <筛选根>` 及 `<筛选根> stage2` | 主协调执行汇总，problems 均为空；Test 用独立 Python 从 raw JSON/CSV 复算一致 |
| 真实 Release UI 五对 | 未运行：筛选已经淘汰，未冒称五对验证通过 |

独立 Rust 日志：`%TEMP%\spmusic-visible-latency-independent-20261021\cargo-release-lib.log`。实际命令以 PowerShell `2>&1 | Tee-Object -FilePath <日志>` 保存完整输出，进程 exit 0。两项 ignored 是显式真实素材 benchmark 与质量导出入口，不是被跳过的普通回归。

恢复版日志为同目录 `cargo-restored-release-lib.log`，exit 0。主协调回滚后再执行 `npm run lint` 与 `npm run build` 均通过并刷新 `dist`，避免源码恢复但仍运行 AB 生成物。Test 只读核对 `dist/index.html` SHA-256 为 `a0d9203fea52ea501108ffca9b97cba6fb308ad8d6f55f6d403759b4f2f59e7e`，与主协调冻结的本轮基线一致；`git diff f063f70 -- src src-tauri` 无输出，`Test-Path src/features/player/components/playlistVisiblePreview.browser.test.mjs` 为 False。最终只保留报告、任务卡与外置测量工具，不保留在基线必失败的候选专属浏览器测试。

主协调另外按相对路径与逐文件内容摘要比对完整 `dist` 的 26 个文件，两目录集合摘要均为 `d78aa72ff3de92cae1f2acdf36ba9191803197431c19a5f63a6fc39af583e5a1`；该全目录比对由主执行，Test 独立核对的是上述 index 摘要及业务源码差异。

## 人工检查

用户视频帧的主协调/UI Agent 分析仅用于复现描述；Test Agent 尚未独立审阅原始视频。不会把不同应用、不同列数、不同封面尺寸的录像时间当作候选性能比值。

## 根因与因果链反证

### 候选 A

1. 暂停一个真实冷转换，随后提交有效派生缓存请求；确认旧版等待该转换、新版可完成，且不是绕过路径或内容校验。
2. 检查缓存损坏、原图替换、大小不变的内容变化、别名路径、不同根/档位/变换版本；不能信任 hash 文件名或 mtime 伪造命中。
3. 预查 miss 不得携带每项最多 16MiB 原图进入最多 32 项等待队列；冷阶段重读重验，取消的 blocking closure 仍持有真实许可和请求配额。
4. 确认预查没有将原先受限的读取变成无界线程池任务，热命中返回前仍检查 client/generation，错误语义不吞掉。
5. 另测纯冷请求，防止预查多读一次造成实际冷成屏退化；不能以“热请求不被挡住”的单例代替用户总体体验。

独立动态结果：五个新增专项均通过，分别验证冷许可全部占用时热命中可完成、miss 等待期间修改源后冷阶段重新哈希、取消 lookup 的实际 blocking worker 退出前仍占 IO 许可/请求、热命中回传前复查 generation、伪造旧内容 hash 文件名及恢复 mtime 仍按新字节取图。取消测试增加了独立准入 channel，等待两项实际准入并断言配额为 2 后才取消第二项，避免未启动就取消的假覆盖。其他既有取消、flight 合并、请求上限、路径、损坏缓存、写入预算与源变化测试随全部 lib 一并通过。

### 候选 B

1. 在可见项最后一个 128px 预览解码前，不能启动抢占其处理预算的可见升档；固定首曲/dock 特例必须另记，不以它们代替视口优先。
2. 验证 128px 首次可见和最终 256/512px 达标两个时刻；只降清晰度而永久不升档不能通过。
3. 快速滚动、旧视口迟到、换列表、同 id 换路径、关闭/卸载、换 DPR/布局后，过期预览不得覆盖新项或高档图。
4. 预览失败、无封面、不可用、仅 dataURL、升级失败保持旧图和有界重试；失败项不能永久阻塞其他图升档，也不能悄悄缩小完成率分母。
5. 检查对象 URL 释放、替换交接、在途数量、受管驻留预算及实际完成档位；额外预览/升档不能造成持续重复生成或明显资源退化。

静态复核确认 wrong source identity 与真正 stale 分开：当前请求身份错误作为视觉终态且不创建图；真正过期 scope/path/epoch 纯丢弃。重试经过同一预览屏障，deferred retry 保留 attempt，按 desired/path/epoch 清理；当前作业持续收到 STALE_REQUEST 时原三次预算耗尽后进入视觉失败终态以释放屏障，未冒充加载成功。该终态由 Architecture Agent 批准，列表 scope 重置时清除，不影响音频可用性。

## 跨层契约

实施后核对真实 Rust/TypeScript command 名称、输入、二进制 SPXR 尺寸与版本、错误/null/路径和 client/generation 规则。候选预期不新增公共 command 或放宽文件权限；不能仅以浏览器 mock 判定真实后端通过。

## 回归覆盖

独立 Rust 覆盖见命令与 A 专项。前端自测原始证据位于 `%TEMP%\spmusic-visible-preview-tests-20261021`，Test 直接读取日志并与测试源码核对：

| 套件 | 已交付结果与边界 |
| --- | --- |
| `playlistVisiblePreview.browser.test.mjs` | 8 场景通过：全部预览优先、无图/dataURL/不可用/源终态、错身份、真正 stale 换 scope、快速换视口/保留高图、延后 retry 三次限制、换 scope/unmount 释放、当前 STALE 三次耗尽释放屏障。实际 Edge `157.0.4341.10`，最大像素命令并发 2 |
| 同一新套件恢复旧 hook | `SPMUSIC_PRELOAD_BASELINE=1` 的内存 route 替换旧 HEAD hook 时，第一个场景实际前七项已经 256、期望 128，在第 66 行失败；未改磁盘源。这是调度顺序的单变量反证，不是产品总体速度基线 |
| 旧 `playlistCoverPreload.browser.test.mjs` | 14 场景通过，包含解耦、有限 retry、旧 URL 回退、迟到释放、1000 项中 844 图准入约 98.6MB、文本/无图/不可用 |
| `playlistContentWindowLoading.browser.test.mjs` | 200 卡、50%/90%/20% 三次滚动通过 |
| summary / statistics | 分别 4 / 11 场景通过 |
| allSongs 与 quick index | 640px / 1440px 聚合去重/独立布局/搜索/选择/索引/播放，摘要 pending→ready、Z/top 及标点/数字/非 ASCII 边界通过 |

较宽 Management/Motion/offscreen 上轮有未通过项，本轮尚未重复，不能称全范围回归全绿。没有通过删断言、放宽计时或修改相关产品行为清除旧失败；若最终保留候选而这些路径属于受影响范围，仍须补本轮基线/候选同 fixture 证据或明确验收缺口。

## 性能 / 时序

### 协议冻结

- 真实媒体只读使用 `E:\Music`、`E:\temp`，隔离 AppPaths、派生缓存与 WebView profile；临时构建禁用系统文件选择器，以已知路径进入真实解析。
- 固定每次停滚后可见目标集合、裁剪 panel/dock、布局、列数、CSS 封面尺寸、DPR、窗口与素材。复刻视频密度至少作为一个场景；基线与候选不可改变几何布局来制造收益。
- 首次可见必须满足实际 `img.complete`、`naturalWidth > 0`、挂载且有效可见 opacity；`state=ready`、已返回数据或已经 decode 不等于显示完成。原生 load 也不等于最终 paint，需如实保留界限。
- 首屏、连续滚动停驻、新位置、反向回访分别记录；派生冷、磁盘热但前端未驻留、内存重访不得混为一个热态。
- 每个 episode 的 T90 是完整 eligible 集合中第 `ceil(N×0.9)` 张首次实际可见的时间；未完成和错误仍保留分母，未达到阈值则删失/超时，不能只对成功者取分位数。已就绪项计入覆盖但另报，首次图和最终目标质量分别记录。
- 先筛选一对；正式至少五对交错次序，无并行构建或浏览器测试。主比较量为每运行四个新停点 T90 的 nearest-rank p95，即 `sorted[ceil(0.95*N)-1]`；N=4 时就是该运行最慢新停点，并明确小样本限制。暂定“明显改进”为该比较量配对耗时降低中位至少 20%，至少 4/5 对方向一致，最终完成率不降，核心回归通过且资源无明显退化。该门槛是主协调依据本次用户要求提出的实施门槛，不冒称用户指定数值。
- 正式计时前主协调接受的资源守门：Rust 采样 private 峰中位增量不超过 `max(16MiB, 15%)`，Renderer/GPU 不超过 15%；frame p95 不增加超过 10%，大于 33.34ms 的帧数不系统性增加；前端两槽、默认冷转换 N=1 和最终目标质量保持。资源指标使用各臂配对结果与绝对量一并判断，不据有限峰值观测推导硬内存上限。
- 清晰度时序守门也在正式计时前冻结：最终目标质量的每运行新停点 T90 p95，相对基线的配对中位回退不得超过 10%，且所有目标最终尺寸与完成率均达标。仅预览快而清晰图显著延后仍淘汰。所有接受判定还须满足测量 `problems=[]`、`censoredPairs=0`、各模式首显/最终质量与回访完成分母完整；汇总 median 过滤非有限值不能成为跳过失败对的理由。
- 记录帧时间与 Rust/Renderer/GPU 采样峰值；500ms 采样会漏短峰，启动时进程子树会漏后起进程，各 PID 最后读数之和不是同一时刻结束值，不据此声称无泄漏。

### 本轮程序与素材身份

筛选目录为 `%TEMP%\spmusic-visible-smoke-triad-20261021`，所有结果均未覆盖历史实验。`identity.json` 的 pairs=1、includeWarm=true、scenario=first-open、dwellMs=6500；实际 raw 为六个 runs，每个七个停点。AppPaths 与 WebView profile 隔离，禁用选择器的 Release 副本仍调用真实 playlist、源读取和像素处理。

| 身份 | 值 |
| --- | --- |
| 基线源码 | `f063f70ba943214421892d768d1eaa098f0a6c00` |
| A 源码 | `b4c1a28` |
| AB 源码 | `299a4f7c50b8a5931a5251c5e5a3e46003029d37` |
| 基线程序 SHA-256 | `65f0b7391252f8a2e868f84b6b5e5e258cc3927f964610d4c841ac44d872b87e` |
| A 程序 SHA-256 | `24d26041a6ed9030baa0f965c152e1ff68998b4cbd9b9628506e45d05a1512e4` |
| AB 程序 SHA-256 | `17cf9d2440643a4f0ab4018bdf6e52993ee3591f6f017b80f5591015c2b5947a` |
| 真实 m3u8 SHA-256 | `af6eb1d97a34a177ff4bdda5bfbc2fae7f399c847e09345d8290d80d35f49405` |
| 真实 UI | 1797 卡、layout1、11 列、155 CSS px 封面、2560×1439、DPR1 |

工具仍传入历史 83 封面 manifest 供默认输入接口使用，但本轮显式 `THUMB_UI_PLAYLIST` 覆盖了它；不能将 manifest 的 83 张摘要冒称整个 1797 首播放列表的媒体内容摘要。播放列表实际身份由 m3u8 哈希和 raw 卡片/目标校验记录。

### 独立复算与结果

Test Agent 用 Python 标准库重新解析 `results.json`，逐停点核对 trackId、index、eligible、列数、封面尺寸、布局与 viewport；独立计算第 `ceil(N×0.9)` 个实际可见时刻、四新停点最大值、最终自然尺寸达标时刻、完成分母与配对比值。没有调用 Node 汇总内部函数。脚本在 `%TEMP%\spmusic-visible-latency-independent-20261021\recompute-smoke.py`，复算输出为筛选根的 `independent-python-recompute.json`。六 runs 的校验 issues 为空，所有首显与质量比值均与主工具相符。

每臂每模式四个新停点共 252 个 eligible，首显全部 252/252，错误为 0；基线和 A 的最终质量均 252/252。AB fresh 仅 233/252 达同卡基线的最终自然尺寸，至少一个停点未达到 90% 清晰图阈值，未完成者保留分母，质量 p95 为 null，而不是从已完成的 233 项中另算一个好看的值。AB disk-warm 的最终质量完成，但 4.001s 比 2.715s 回退 47.34%，超过预先冻结的最多 10%。首显观测没有发现只能靠最后 dwell 扫描补记的项（lateFallbackObservations=0）。

所有模式两次反向回访各合计 121/121 完成且最终质量 121/121，但 alreadyReady 均为 0；这些是可见重访，不能当作驻留内存瞬时命中。基线 fresh 两次回访首显 T90 为 1.352s / 0.481s，A 为 1.396s / 0.505s；AB 为 1.300s / 0.579s，但最终清晰图 T90 为 3.118s / 1.197s。disk-warm 回访同样未呈现可据以通过的成屏变化，原始逐点值保留于复算文件。

### 采样资源

Test 另从每个 run 的 `memory.csv` 独立按角色与 500ms 桶汇总 PrivateBytes 峰值，并重新计算 frame nearest-rank p95。表为本次单 run 观察值，不是五对中位，也不等于 VRAM 或硬内存上限。

| 起始模式 / 臂 | Rust private 峰 MiB | Renderer private 峰 MiB | GPU 进程 private 峰 MiB | frame p95 ms | >33.34ms 帧 |
| --- | ---: | ---: | ---: | ---: | ---: |
| fresh / 基线 | 122.57 | 457.15 | 479.19 | 12.5 | 6 |
| fresh / A | 124.83 | 470.83 | 548.60 | 12.5 | 5 |
| fresh / AB | 94.34 | 440.63 | 516.44 | 12.7 | 5 |
| disk-warm / 基线 | 102.73 | 462.28 | 526.37 | 12.5 | 5 |
| disk-warm / A | 34.18 | 510.79 | 546.87 | 12.5 | 6 |
| disk-warm / AB | 100.63 | 435.01 | 779.42 | 12.6 | 4 |

AB disk-warm 的 GPU 进程 private 采样峰比基线高约 48.1%，也不符合最多 15% 的资源守门。单次峰值不足以归因为长期泄漏；不从 Rust 某次降低推导整体内存改善。资源只是额外淘汰信号，清晰度与首显门槛已足以否决该组合。

## 发现

A 的“热命中不必等待冷转换”由独立专项证明，但该结构性局部改善并未在本轮密集实际列表筛选中变成达到门槛的成屏改善。B 的预览确实让 fresh 的首图更早，却增加升档工作并延迟清晰图，不能只展示 24.56% 的预览比值来宣布成功。上一轮约 10% 的 per-card load 改善也不能代替本轮成屏延迟验收。

## 风险

OS 文件缓存未控制则不得称系统冷态；后台预取可能使新位置的派生缓存已热。128px 预览在大尺寸/DPR 下可能可见模糊，必须审阅质量及最终升档。采样观察器自身开销必须在两臂一致。

## 临时缓解

未保留临时缓解。没有通过删除动画、推迟显示全部图片、隐藏失败、永久低分辨率或放宽质量/性能门槛使候选通过。候选源码、测试与 diff 可从提交历史和筛选目录的 `candidate-source.patch` 恢复审查，业务实现已撤回。

## 验证结论

候选性能验收不通过，支持回滚：A 缺少达到明显改进门槛的证据，AB 明确违反最终清晰度/完成与资源守门。只有一组筛选，不能宣称五对验证或统计证明任何局部收益为零。主协调已执行 `5346aea` 撤回本轮四个业务/测试路径，保留 `f063f70` 及之前用户功能；Test 独立确认全部 `src`/`src-tauri` 与本轮基线无差异、实验 fixture 已移除、恢复版 214 项 Rust 回归通过，主协调刷新 dist 后 lint/build 通过。回滚核验完成，目标视频所示体验仍未实现，不将本次实验描述为已解决加载慢。

## 建议

保留本次反证和工具，向用户明确报告“已修改、测试并回滚，未达到目标效果”。若继续优化，优先从有实测阶段占比支持的源读取/持久缩略图获取方案重新评审，不恢复本轮不达标的预览组合，也不将缺少稳定证据的结构改动留下作为已完成提速。
