# OPT-0018 P1 修复验证报告（候选 3847bcc）

> 前置报告保留未改动：[独立验证报告](opt-0018-independent-verification-2026-11-08.md)（结论：功能验收不通过，两个 P1）、[上一轮 ds 验证报告](opt-0018-ds-verification-report-2026-11-08.md)（阶段 B，两个 P1 复现）。
> 本文只记录本轮：P1 修复后的产物绑定、真实恢复测试、请求归属、A/B 采集验证。

## 摘要

- **两个 P1 已修复并验证。** 三个反例从 0/3 变为 3/3；真实 WebView2 中 4 个用例 × 3 个新会话 **12/12 恢复成功**。
- **产物已绑定。** 源码 `3847bcc806665d8fd958f6b945dc22ff3577b038`，exe SHA-256 `69F82944657776AC60E462E1FE39A68096B5778A423D6B49764603EFF4B9D400`，每个会话启动时都实测 exe 哈希并与预期比对（`exeMatched=true` 12/12）。
- **请求归属已记录。** 关键结论：**512 hero 的恢复在所有 12 个会话中 `playlist_cover_thumbnail_path` 请求数均为 0**，走的是 `audio_load_playlist_cover_pixels`。
- **A/B 只验采集方法，不宣称提速。**
- **未调整并发、未合入 develop、未开始正式 20 对。**

## 1. 产物绑定

| 项 | 值 |
| --- | --- |
| 源码完整 SHA | `3847bcc806665d8fd958f6b945dc22ff3577b038`（父 `9e3a4f9`） |
| 生产代码差异 | 3 文件，+63/−15：`PlaylistPanel.tsx`(+23/−2)、`useAudioPlayer.ts`(+29/−13)、`playerUiViewModel.ts`(+11/−0) |
| 构建隔离补丁 | `coverlane-isolation.patch.mjs`，diffDigest `18f132bbca3ab39ec436a9b8bcc3005e5ec2b387cdd9f8f9f39d713efeefd83c`；仅 `AppPaths → THUMB_UI_ROOT`、原生选择器 → `THUMB_UI_PLAYLIST` 两处 |
| 锁文件 SHA-256 | `CC1ED8AB30A85CD9ADB45B9F053977ECA98BE2096CC1A9ADC1C005058CDFF9E0` |
| 构建命令 | `npm run build` → `npx tauri build --no-bundle`（均 exit 0） |
| 最终 exe | `D:\spbuild\src-tauri\target\release\app.exe`，SHA-256 `69F82944…B9D400`，26,682,880 B，PE magic `MZ` |
| 最终 dist | 30 个文件，`index.html` SHA-256 `F0EBA662…D3EFD3` |
| 实际启动路径核对 | 每次会话读 `(Get-Process -Id <pid>).Path` 并计算 SHA-256，与预期逐字比对，**12/12 `exeMatchesExpected = true`** |

### 构建过程中遇到并绕过的问题（如实记录）

首次在证据目录 `…\ds-20261108-194254\build`（路径长 74 字符）构建失败：`error MSB6003: CL.exe … DirectoryNotFoundException`。原因是 MSBuild/CL 的 260 字符路径限制。**改在 `D:\spbuild`（10 字符）重建后成功**。两次构建的命令与配置相同，仅根路径不同；该差异已记录在此，不隐瞒。

## 2. 真实恢复测试（12/12）

方法：每个用例 3 次，**每次都是一个全新进程 + 全新 WebView2 profile + 全新缓存根**（`sessions/<case>-r<N>`）；在不可见 Win32 desktop 上运行；安装监听后才打开列表；**真实删除或写坏**受管 JPEG；用同一元素清 src 一帧后还原同 URL 强制真实回读（受控 DOM 重读，非自然 remount，已如实标注）。

| 用例 | 恢复 | 恢复后宽度 | token 事件 | `playlist_cover_thumbnail_path` | 文件按 hash 恢复 |
| --- | --- | --- | --- | --- | --- |
| normal256-delete | **3/3** | 256 / 256 / 256 | 3 / 3 / 3 | **0 / 0 / 0** | 3/3 |
| normal256-corrupt | **3/3** | 256 / 256 / 256 | 3 / 3 / 3 | **0 / 0 / 0** | 3/3 |
| hero512-delete | **3/3** | 512 / 512 / 512 | 9 / 9 / 9 | **0 / 0 / 0** | 3/3 |
| menu-delete | **3/3** | 512 / 512 / 512 | 13 / 13 / 13 | **0 / 0 / 0** | 3/3 |

- 「恢复」判定使用两个独立信号：**当前元素的宽度 > 0** 或 **fault 之后出现 `load` 事件且 `naturalWidth > 0`**。二者分别记录（`recoveredBy`），不把「元素被替换后查不到」当作失败。
- **菜单用例**：先用真实鼠标事件（CDP `Input.dispatchMouseEvent`）点开 hero 的「更多」对话框，确认 `[role="dialog"]` 打开且 `.playlist-hero-more-artwork` 内存在 asset 图，再注入故障。第一轮因合成 `.click()` 无法打开对话框而失败，改为真实指针事件后通过——这是**测量工具问题**，已记录。
- 每例注入的 JPEG 均有备份与 SHA-256，结束后写回并比对（`restoreMatchesBackup = true` 12/12）。

### 本轮修正的两个测量缺陷（不是产品缺陷）

1. **首轮 hero 判为「未恢复」是取样错误**：恢复后元素被替换，我持有的旧引用 `isConnected=false`，取样读到 `w=0`。事件流显示 6495 ms 时已有 `load w=512`。已改为「旧引用 + 当前元素 + 事件流」三路判定。
2. **首轮 normal256-corrupt 2/3 失败是选错目标**：我用 `slice(-1)[0]` 取到最后一张卡片，那是不在可视需求集内的离屏行，恢复不会被请求。改为与 delete 用例相同的选取策略后可稳定复现。

## 3. 请求归属

每个用例记录的归属链：

| 字段 | 来源 | 示例（hero512 r1） |
| --- | --- | --- |
| token | `spmusic:playlist-cover-image-*` 事件的 `detail.token` | `publishGeneration` 2→1→3 |
| 档位 | token `url` 内的 `-{edge}-t{transform}-j{version}` | 512 |
| 父发布 | `publishGeneration` + `sessionGeneration` + `key` | gen 3 / sess 1 / `local-4d6f121e1e996c9e` |
| 请求身份 | CDP `Network` 的 `order`、`command`、`status`、`decodedBytes` | 见下 |

hero512 r1 的完整请求序列：

```
1 /audio_probe_playlist_cover          200      0 B
2 /audio_probe_playlist_cover          200    377 B
3 /audio_load_track_thumbnail_path     200    264 B   ← 列表卡片的正常加载（kind=track）
4 /audio_load_track_thumbnail_path     200      0 B   ← 同上
5 /audio_load_playlist_cover_pixels    200 1,048,616 B ← 512 恢复走 pixels
6 /audio_load_playlist_cover_pixels    200      0 B
```

**关于「观察到两次 pixels IPC」**：本轮**不**用总次数判断「恰好一次」。原因是：两次请求里第二次 `decodedBytes = 0`，属于同一恢复作业的后续/取消残余；真正能证明「每一合法恢复作业只启动一次」需要把每个请求通过 `requestId` 关联到 `recoveryAttemptId`，而当前前端**没有恢复出口的埋点**，harness 也无法从 CDP 侧拿到该关联。因此本报告只陈述**可观测事实**（恢复发生了、走了哪条 lane、path 为 0），**不断言「恰好一次」**。

## 4. 自动化回归

| 检查 | 结果 |
| --- | --- |
| 三个生产决策反例 | 旧提交 `9e3a4f9`：**0/3 失败（exit 1）**；新提交 `3847bcc`：**3/3 通过** |
| 126 项目标集 | 126 passed / 0 failed（断言未改） |
| `npx tsc -b --noEmit` | exit 0 |
| `npm run build` | 成功 |
| `npm run lint` | 3 个既有 error，均在 gitignored 的 `.codex-tmp-folder-ui-dist/` |

反例对照使用独立 worktree 检出 `9e3a4f9` 运行（软链 `node_modules`），确保「旧提交仍能复现」不是靠记忆。

## 5. A/B 试跑：只验采集方法

3 对，fresh 缓存，动作 `open` + `scroll:fast`，视口 1600×1000 DPR 1，语料 120 首（116 个独立封面 hash）。

### 采集方法验证（本轮目的）

| 检查 | 结果 |
| --- | --- |
| 每次运行都在输入前记 t0（同执行上下文） | **通过** |
| `open` 使用 fixture 冻结 cohort 8 张 | **通过** |
| `scroll` 有明确分母（76 张经过的行） | **通过** |
| 两臂产物均绑定 SHA 且运行时为 `custom-protocol (production)` | **通过** |
| 超时 / 未就绪 / 离屏删失分列，未改写为 0 | **通过** |
| 缓存状态实际记录 | **通过** |
| 两臂缓存方案可区分（baseline `blob:` / candidate `asset.localhost`） | **通过** |

两臂运行时事实：`observedTargetUrl = http://tauri.localhost/`、`servingMode = custom-protocol (production)`、`isDevServer = false`、`comparableReleaseArtifact = true`（4 次运行为此值）。
注：manifest 中的 `customProtocolStringPresent / devServerUrlStringPresent` 是**字符串扫描提示**，工具自己注明「runtime CDP target URL 才是权威信号」。以运行时事实为准。

### 整机负载

| 项 | 值 |
| --- | --- |
| 采样窗口 | 12:16:09Z – 12:17:36Z（55 个样本，1 s 间隔） |
| CPU % | min 15 / max 78 |
| 可用物理内存 | 最低 3.62 GB |
| 磁盘活动 | **未取得**（`PercentDiskTime` 对数据卷的 WMI 实例查询未解析成功）。该列**留空，未填 0** |
| 干扰记录 | `interference.csv` 无条目：窗口内未观察到系统更新、备份、下载、并发构建或休眠。**未记录不等于已证明无干扰** |

### 试跑数值（不构成提速结论）

`open` 动作两臂均为 8/8 就绪、0 未就绪、0 删失。`scroll:fast` 两臂均为 76 张经过、37 张就绪、**39 张未就绪即离屏（censored，不计为成功）**。

**因为只有 3 对，本报告不对任何时延差异下结论。** 也未计算百分比改善，避免被误读成性能结论。

实际数值存放于 `ab-pilot-summary.json` 与各 `ab/pairN-*/results.json`。

## 6. 通过 / 失败 / 未覆盖

### 通过

- 两个 P1 的修复：反例 0/3 → 3/3。
- 真实恢复：4 用例 × 3 会话 = 12/12。
- 产物绑定：源码/补丁/锁/exe/dist 全链，启动时逐次核对 exe 哈希。
- 512 恢复不再走 path：12 个会话 `playlist_cover_thumbnail_path` 合计 **0** 次。
- A/B 采集规格 7/7 项通过（见 §5）。

### 失败 / 需要注意

- **无法断言「恰好一次恢复」**：缺前端恢复出口埋点与 `requestId ↔ recoveryAttemptId` 关联。两次 pixels IPC 的含义未定论。

### 未覆盖

1. **自然虚拟化 remount**：本轮用受控 DOM 重读（清 src 一帧后还原）迫使真实回读，不等于用户滚动离开再回来。
2. **慢盘 / 受管缓存 I/O 延迟**：未做。
3. **无图与坏图 fixture**：语料 120 首全部有封面，`labelSplit.withoutCover = 0`。
4. **≥1000 张独立封面、高 DPI**：未做。
5. **CPU 时间与 10 分钟内存曲线**：未做（工具无 CPU 字段）。
6. **`PlaylistLibrarySidebar.tsx:144` 的 `LibraryCover`**：直接渲染 `coverThumbnail` 且未传 presentation，属同一缺陷族，**不在本次 P1 范围**，未修改。建议单独开卡。
7. **菜单用例的 `finalKind = none`**：对话框在实际取样时刻已关闭，元素查不到，恢复由事件流判定。视觉截图已保存。

## 7. 证据与复跑

证据根：`%LOCALAPPDATA%\spmusic-coverlane\ds-20261108-194254`

| 文件 | 内容 |
| --- | --- |
| `binding-manifest.json` | 源码 SHA、差异、隔离补丁、锁 hash、构建命令、exe/dist hash |
| `source-sha.txt`、`production-diff.patch`、`production-diff-stat.txt` | 版本与差异 |
| `build.log`、`tauri-build.log`、`*.exit.txt` | 构建原始日志与退出码 |
| `dist-manifest.json` | 30 个 dist 文件逐个 SHA-256 |
| `exe-sha256.txt`、`isolation.json` | 产物与补丁指纹 |
| `native-records.json` | 12 个会话的原始记录（目标、备份/恢复 hash、采样、事件、网络） |
| `native-summary.json` | 汇总与请求归属链 |
| `sessions/<case>-r<N>/` | 每会话独立缓存根与 profile |
| `screenshots/<case>-r<N>.png` | 每会话截图 |
| `files/<case>-r<N>.backup.jpg` | 注入前备份 |

复跑：`node D:\opt0018-ab\native-round2.mjs <evidenceRoot> <exe> <playlist.m3u8> <portBase>`

**清理**：12 个会话的专属进程均已按 PID 关闭；注入的 JPEG 全部按备份 hash 写回；未触碰用户音乐与正常缓存。
