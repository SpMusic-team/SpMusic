---
doc_id: "OPT-0018-VERIFY"
title: "OPT-0018 真机实测指引"
doc_type: "test-plan"
owner_agent: "Test Agent"
status: "待实测"
module: "专辑库列表封面加载链路"
version_scope: "project"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - "docs/changes/optimizations/OPT-0018.md"
  - "docs/decisions/2026-11-07-album-cover-asset-pipeline.md"
---

# OPT-0018 真机实测指引

本分支 `feature/album-cover-asset-pipeline` 已实现「列表封面 JPEG + asset 协议路径下发」。
下面是打包、观测、判定与回滚的完整操作清单。

## 1. 打包

```powershell
cd D:\SpMusic
git branch --show-current          # 确认是 feature/album-cover-asset-pipeline
npm run tauri build
```

产物位置：`src-tauri/target/release/bundle/`（msi / nsis）。

> 首次构建 Rust release 较慢，属正常。

### 对照包（可选但推荐）

想量化对比，建议同时准备一个 `develop` 的构建产物：

```powershell
git checkout develop
npm run tauri build
# 产物另存，再切回来
git checkout feature/album-cover-asset-pipeline
```

两个包用不同的音乐目录分别打开，避免缓存互相干扰。

## 2. 自动化检查（已通过，供你复核）

| 检查 | 结果 |
| --- | --- |
| `cargo check --lib` | 通过 |
| `cargo test --lib` | 386 passed / 0 failed |
| `cargo clippy`（改动文件） | 零新增警告 |
| `npx tsc -b --noEmit` | exit 0，零错误 |
| `node --test playlistCoverScheduler/playlistCoverPathLane` | 25 / 25 通过 |
| `npm run build` | 成功 |

**已知且非本次引入**：`src/features/player/hooks/useAllSongsWindow.test.mjs` 在 `HEAD` 上即已失败（其断言要求源码恰好 6 条 import，实际基线为 7）。本次新增一条 import 后变为 9，该断言仍失败，**与功能行为无关**，属既有测试债。

## 3. 观测点

### 3.1 缓存文件是否真的变成 JPEG

打开一个音乐目录、浏览过专辑页后：

```powershell
$dir = "$env:LOCALAPPDATA\SpMusic\SpMusic\cache\audio\thumbnails"
Get-ChildItem $dir | Group-Object Extension | Select-Object Name, Count
Get-ChildItem $dir -Filter *.jpg | Select-Object -First 5 Name, Length
```

**预期**：
- 出现 `*.jpg`，单个约 **10–30 KB**（改造前 `.spxr` 同为 256 档约 **256 KB**）。
- `.spxr` 仍存在（播放器 1024/1536 用），不被删除。

### 3.2 播放器大封面未受影响

播放若干歌曲，确认：
- 主封面正常显示、无模糊或错位。
- 「封面氛围」背景正常（设置 → 主题 → 播放器背景）。
- 拖拽/切歌转场无闪白、无残影。

这一路仍走 `audio_load_cover_pixels` 的裸像素通道，理论上零变化。

### 3.3 内存

任务管理器分别观察：
- `app.exe`（Rust/Tauri 主进程）
- `msedgewebview2.exe` 的 renderer 子进程

**预期**：renderer 侧解码位图改由 WebView 管理，绝对数值可能上移；
判断标准是**滚动浏览时是否持续无上限增长**，而非与改造前比绝对值。

### 3.4 回落是否触发

若怀疑有异常，查看日志关键字段：

```
audio.playlist_thumbnail_path.publish
audio.playlist_cover_pixels
```

正常路径下应主要看到路径通道相关记录；若出现大量像素通道调用，说明回落频繁。

## 4. 判定清单

逐项打勾，任一项为「否」建议回滚：

- [ ] 专辑库首屏封面出现速度**明显快于**改造前（主观对比）
- [ ] 快速滚动专辑列表，封面跟手、无长时间空白
- [ ] 二次进入同一专辑，封面几乎瞬时（命中磁盘缓存）
- [ ] 歌曲列表、歌手页、文件夹页封面均正常
- [ ] 无封面专辑正常显示占位符，不是破图
- [ ] 播放器主封面、背景氛围、拖拽转场**完全正常**
- [ ] 缓存目录中出现 `.jpg` 且体积在 10–30 KB 量级
- [ ] 内存无持续无上限增长
- [ ] 长时间使用（10 分钟以上，多次切换页面）无封面卡死不加载

## 5. 回滚

### 方式一：切分支重打包（最彻底）

```powershell
cd D:\SpMusic
git checkout develop
npm run tauri build
```

`develop` 与 `main` 全程未被修改，此行即完全回退。

### 方式二：运行级硬开关（改一行）

`src/features/player/services/playlistCoverPathLane.ts` 中把

```ts
export function pathLaneAvailable(): boolean {
```

改为恒 `return false`，重新构建后所有封面直接走原像素通道。
等价于改造前行为，无需切分支。

### 方式三：熔断自动回退（无需操作）

连续 8 次路径通道真失败后，本会话自动永久退回像素通道。
偶发失败不计数，`Ok(null)`、`STALE_REQUEST`、主动中止均不计数。

### 缓存清理（注意）

- 只回滚代码、**保留**本次的预算统计改动（`MANAGED_THUMBNAIL_EXTENSIONS`）：
  遗留 `.jpg` 仍被计入预算，会按 mtime 自然淘汰，**无需手工清理**。
- 若连预算统计改动一起回滚：`audio/thumbnails/*.jpg` 将不再被计入预算，
  **必须手工删除一次**，否则会无界增长：

```powershell
Remove-Item "$env:LOCALAPPDATA\SpMusic\SpMusic\cache\audio\thumbnails\*.jpg" -Force
```

## 6. 若有效但想调优

以下参数集中且互不影响，可按实测微调：

| 参数 | 位置 | 当前值 | 调整方向 |
| --- | --- | --- | --- |
| JPEG 质量 | `cover_pixels.rs` `THUMBNAIL_JPEG_QUALITY` | 82 | 体积大就降到 75；有可见瑕疵升到 88 |
| 熔断阈值 | `playlistCoverPathLane.ts` `PATH_LANE_FAILURE_THRESHOLD` | 8 | 偶发失败误伤就调高 |
| 发布超时 | `cover_pixels.rs` `THUMBNAIL_PATH_PUBLISH_TIMEOUT` | 2s | 慢盘上出现回落就调到 3–5s |
| JPEG 文件上限 | `cover_pixels.rs` `THUMBNAIL_PATH_MAX_BYTES` | 1 MiB | 极端封面被丢弃时调高 |

改 JPEG 质量后需同步把 `THUMBNAIL_IMAGE_VERSION` 从 1 加 1，使旧图失效重建。

## 7. 已知未验证项

以下只能在真机确认，自动化测试覆盖不到：

1. WebView2 下 asset URL 能否稳定渲染 `$CACHE` 下的 `.jpg`（架构决策验收标准 9）。
2. Windows 上 asset 协议的 HTTP 缓存行为与驻留表现。
3. JPEG quality 82 在本项目真实封面上的主观质量与体积最优点。
4. 大量专辑（1000+）场景下的表现。
5. 8 GiB 预算在 JPEG 与 `.spxr` 之间的实际分布是否健康。

以上若出现异常，请把现象反馈回本文档，再决定调优还是回滚。
