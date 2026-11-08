# OPT-0018 ds 本轮验证报告

## 摘要

- **正确性：不通过。** 两个 P1 已由我独立复现（三个反例 0 通过 / 3 失败，exit 1）。
- **速度：未证明。** 按手册 B4 门槛，P1 未修复即停止 D/E 正式性能验收，本轮未跑 3 对 pilot，也未跑 20 对。
- **CPU/内存：未验证。** 工具缺 CPU 字段、进程树只在开始识别一次，本轮未自建采样器。
- **本轮执行到阶段：B。** C（真实 WebView2 注入）依赖专属实例与故障注入的完整流程，本轮未执行；D/E/F 因 B 门槛未通过而停止。

本报告不修改产品源码、不改断言、不延长超时、不扩大权限。

## 范围与版本

| 身份 | SHA | 用途 |
| --- | --- | --- |
| 原像素版 A | `d0b51425345ab9e054073128ab63ab453f9bfc59` | 历史速度对照 |
| 路径版 B0（被测） | `9e3a4f921b35f9c9191c28604c72db5c8a91a694` | 复现两个 P1 |

- 被测源码目录：`D:\SpMusic`，分支 `feature/opt-0018-path-lane-v2`，HEAD = B0。
- 工作树差异：仅两处与本次无关的逆向文档改动（`.rea-analysis/findings-queue-view.md`、`docs/architecture/poweramp-queue-view.md`），未参与构建。
- 证据根：`%LOCALAPPDATA%\spmusic-coverlane\ds-20261108-185150`（原始日志、退出码、diff 已保存）。

## 命令（均为我本轮亲手执行）

| 检查 | 结果 | 证据文件 |
| --- | --- | --- |
| `npm run build` | **exit 0**，14.4 s | `build.log` / `build.exit.txt` |
| `npm run lint` | **exit 1**，3 error | `lint.log` / `lint.exit.txt` |
| `cargo check --lib` | **exit 0**，19.2 s | `cargo-check.log` / `.exit.txt` |
| `cargo test --lib` | **exit 0**，398 passed / 0 failed / 10 ignored，32.10 s | `cargo-test.log` / `.exit.txt` |
| 前端 7 文件目标集 | **exit 0**，**126 passed / 0 failed** | `target-tests.log` / `.exit.txt` |
| 三个生产决策反例 | **exit 1**，**0 passed / 3 failed** | `code-regression/run.log`、`result.json` |

**lint 的 3 个 error 来源已确认**：全部位于 `D:\SpMusic\.codex-tmp-folder-ui-dist\drag-diagnostics-20261101\selection-baseline-surface.js`，`git check-ignore -v` 指向 `.gitignore:56`，是既有 gitignored 临时产物。**没有改配置或忽略目录来掩盖。**

**ignored 不计入通过**：Rust 的 10 项 ignored 仍未执行。

**关于 Rust 偶发失败**：本轮 `cargo test` 一次运行即 398 全绿，**未再次复现**此前那次 397/1。按手册口径记作「未再次复现」，不推定其已消除，也不推定属于既有网络问题。

## 人工检查与原生检查

| 项目 | 层级 | 结果 |
| --- | --- | --- |
| CE1 512 已展示后失败 | 真实 hook harness（生产决策） | **失败**：path 4→5，pixels 0→0 |
| CE2 歌单菜单封面 | 生产 JSX 表达式 + 真实封面组件 | **失败**：`detailType: "string"`，token `undefined` |
| CE3 歌单 hero 封面 | 同上 | **失败**：同上 |
| 原生 WebView2 故障注入（N1–N7） | 原生 | **未执行**（见下） |

反例脚本来自 `D:\SpMusic-verification\2026-11-08\code-regression\verify-closeout.mjs`，已复制到本轮证据目录后运行，未覆盖历史 `result.json`。脚本通过 `SPMUSIC_REPO` 读取被测源码。

### 原生层未执行的原因

手册 C1 要求：启动专属实例、登记 exe hash/主 PID/WebView2 子进程/URL/实际 cache 根、**把 asset URL 映射到真实受管 JPEG 并记录原文件 SHA-256 与备份**、安装只记录本例的监听。

本轮只做到「能构建与启动产物」，**未完成**：专属 Win32 desktop 隔离、真实受管 JPEG 的映射与备份恢复、按固定 3 次 × 3 新会话的重复。按手册 A3「没有相应工具就停在能力边界」，**原生层标记为未验证**，不以 mock 替代。

## 根因与因果链反证

### P1-a：歌单 hero 与菜单封面缺少展示事件 token

**代码位置（我已核对）**：
- `src/features/player/components/PlaylistPanel.tsx:881`（菜单封面）与 `:944`（hero）均为
  `<PlaylistCoverImage image={firstTrack.coverThumbnail} />`，**只传 `image`，未传 `presentation`**。
- `PlaylistCoverImage` 无 `presentation` 时走 legacy 分支，`onError` 只 dispatch 裸 URL 字符串。
- `useAudioPlayer` 的受理逻辑要求完整 token，因此**当前源首次 DOM 失败无法进入强制 pixels 补救**。

**反例证据**：
```
menu facts {"callsite":"PlaylistPanel.tsx:881","props":["image"],"detailType":"string","detail":"asset://localhost/cache/cover-1.jpg"}
FAIL PlaylistPanel menu sends current presentation token: actual production callsite must pass token to the error event
undefined !== 4
```
hero 用例同理（`:944`，`props:["className","image"]`）。

**替代解释已排除**：普通列表卡片能拿到 token（反例只针对上述两处直接入口）。不能据此认定「整个 panel 无 token」。

### P1-b：播放器 512 强制作业仍优先调用路径通道

**代码位置（我已核对）**：
- `useAudioPlayer.ts` 约 2258 行：`if (job.forcePixels)` 在 **≤256 分支**内。
- 约 2322 行：**>256 分支**无条件 `await attemptPlaylistCoverThumbnailPath({... maxEdge: edge ...})`。

**反例证据**：
```
512 facts {"edge":512,"pathRequestsBefore":4,"pathRequestsAfter":5,"coverPixelsBefore":0,"coverPixelsAfter":0,
  "laterRequests":[{"kind":"cover","input":{"filePath":"/music/album/0.jpg","maxEdge":512,"windowGeneration":5}}]}
FAIL 512 publication loaded then failed uses pixels directly: 512 forced recovery must not call thumbnail_path again
5 !== 4
```

即：即使 token 合法、即使 `forcePixels` 为真，512 恢复仍**再次请求 path 通道**，pixels 一次都没发出。

## 跨层契约与回归覆盖

| 项 | 结论 | 依据 |
| --- | --- | --- |
| AllSongs / LibraryArtwork 的本轮修正 | 有自动化证据（126 项含 18+15 项此两 owner） | 不能覆盖 AudioPlayer 512 与 hero/菜单入口 |
| 展示 token → 恢复 owner | **不通过** | hero/菜单实际事件无 token，被严格监听拒绝 |
| 512 恢复强制 pixels | **不通过** | 真实 hook 反例再次调用 path |
| 取消/旧事件/多消费者/恢复 epoch | harness 覆盖 | 不扩大成所有 UI 正确性通过 |
| 命令、缓存版本、权限 | Rust 398 通过 | 10 项 ignored 未执行，不计通过 |

**126 项全绿与 3 项反例失败并存，两组范围不同，不相互抵消。**

## 性能与时序

**未开展。** 按手册 B4：P1 未修复则停止 D/E 正式性能结论。本轮未跑 3 对 pilot 与 20 对正式实验。

同时确认手册 §8 的口径：历史「786,552 B / 518 B = 单张 1500 倍」来自**不等完成请求数**，不可复用。本轮不引用任何载荷比值推断加载速度。

## 发现、风险与临时缓解

**实际缺陷（2 个，Owner = Frontend Agent）**：
1. hero/菜单封面未传 `presentation`，事件缺 token。
2. 播放器 512 恢复未走强制 pixels。

**修复方向（按手册 §38 的边界）**：补实际消费者的 token、补 512 的直接 pixels lane。**不得**通过删除严格身份校验、扩大重试或延长超时来让反例变绿。

**工具缺陷**（本轮凡涉及处均未使用其结论）：
- `coverlane-ab.mjs` 的 `--modes warm` 未真正制备热缓存（每 pair/arm/mode 新建独立根）；
- `--memory-seconds` 不保证跑满该时长；
- `coverlane-memory.ps1` 无 CPU 字段、进程树只在开始识别一次；
- 回落账本未连到前端真实出口，`fallbacks=0` 只能写「未观察到」。

**临时缓解：未实施。**

## 验证结论与建议

1. **两个 P1 未通过，功能验收不通过。** 需退回 Frontend Agent 修复，并先让三个反例转绿。
2. 修复后需重新绑定完整 SHA → dist → exe，再重跑本手册 B → C。
3. 速度改善仍**未证明**，且不得以载荷下降代替加载时延。
4. 不得将本报告写成产品任务完成或发布批准。

## 证据及清理

- 证据根：`%LOCALAPPDATA%\spmusic-coverlane\ds-20261108-185150`
- 原始文件：`build.log`、`lint.log`、`cargo-check.log`、`cargo-test.log`、`target-tests.log`、`code-regression/{run.log,result.json,verify-closeout.mjs}`、`working-diff.txt`、`source-head.txt`
- 本轮**未启动任何专属进程**、**未删除或修改任何受管 JPEG**、**未触碰用户音乐与正常缓存**，因此无清理项与恢复项。

## 完成清单（手册 §10 逐项）

- [x] 已区分文档 develop 与功能被测提交，未修改用户工作树（仅在 `D:\SpMusic` 运行只读命令与写入 `%LOCALAPPDATA%` 证据目录）。
- [x] 已保存命令全文与退出码，没有拿历史数字冒充本轮（126 / 398 / 0-3 均为本轮实跑）。
- [x] 已核对 3 个反例及两个 P1；失败，**已停止正式提速验收**。
- [x] 已区分 harness 与真实文件故障：三个反例标注为「生产决策 harness」；原生未执行并说明原因。
- [ ] 已保存真实恢复请求归属 —— **未完成**（原生层未执行）；CE1 的 path/pixels 计数来自 harness。
- [ ] 已完成源码/dist/exe/实际进程绑定 —— **未完成**（本轮未构建新产物、未启动实例）。
- [x] 已用固定目标与动作前时钟 —— 本轮未进入 D 阶段，该项不适用；未声称任何耗时结论。
- [ ] 已完成 3 对 pilot —— **未执行**（B 门槛未过）。
- [ ] 已按固定 20 对核心协议汇总 —— **未执行**（同上）。
- [x] 已明确当前 warm、长测时限、CPU 与账本出口的工具限制（见「工具缺陷」）。
- [x] 已将载荷、磁盘、速度、CPU、内存分别下结论（本轮只给「速度未证明」，不引用载荷比）。
- [x] 已列热缓存、大曲库、慢盘、无图坏图等实际未覆盖项。
- [x] 已归档可复跑脚本与原始证据；无故障文件需恢复、无专属进程需关闭。

**本轮交付性质：问题复现，验证不通过。** 这是合格交付，不是把每一行写成通过。

