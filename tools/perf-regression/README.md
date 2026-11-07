# perf-regression — 搜索页加入后歌单列表加载的跨版本测量

用于回答一个具体问题：**从搜索页把歌加到歌单之后，歌单歌曲列表的加载是否变慢，变慢是否与版本有关。**

## 快速开始

```powershell
$env:SPMUSIC_PLAYWRIGHT = 'C:\Users\winkeses\.dsh\tools\node_repl\node_modules\playwright'

# 媒体库「所有歌曲」：跨版本基线（曲库 1800 首）
node tools/perf-regression/run.mjs --worktree D:\SpMusic --version-id V5 `
  --scenarios SA --library-size 1800 --repeat 2 `
  --out tools/perf-regression/results/current/final-V5-1800.json

# 歌单：热重开基线 vs 追加后打开（300 首歌单）
node tools/perf-regression/run.mjs --worktree D:\SpMusic --version-id V5 `
  --scenarios SW,S3 --playlist-size 300 --selection 6 --repeat 3 `
  --out tools/perf-regression/results/current/final-V5.json

# 历史版本（先准备 worktree）
node tools/perf-regression/versions/prepare-versions.mjs
node tools/perf-regression/run.mjs --worktree D:\SpMusic-perf-versions\V1 --version-id V1 `
  --scenarios SA --library-size 1800 --repeat 2 `
  --out tools/perf-regression/results/current/final-V1-1800.json
```

`--worktree` 可以是任意 git 检出；harness 不 import `src/`，只通过 HTTP 从目标 dev server 取真实模块，并校验返回的 `PlayerShell.tsx` 确实来自该 worktree（`originVerified`）。

## 场景

| ID | 含义 |
|---|---|
| `SA` | **媒体库「所有歌曲」列表**（跨版本可比的基线视图；关键指标 `firstRowAtMs`） |
| `SC` | 媒体库其它分类（`--category album / artist / folder / playlists ...`） |
| `SW` | **歌单基线**：打开一个已加载过的歌单，关闭后重新打开并测量 |
| `S3` | 同一歌单，从媒体库 songs 页**追加** 6 首后立即打开 |
| `S1` | 搜索页选 6 首 → **新建**歌单 → 立即打开 |
| `S1b` | 同上，但离开页面 2.5 s 后再打开（隔离"创建余热"） |
| `S2` | 冷开同等内容的现有歌单（无任何加入动作） |
| `S4` | 歌单已挂载时追加（测重绘，不测重开） |

`--library-size` 控制扫描出的曲库规模（SA/SC 用），`--playlist-size` 控制既有歌单规模（SW/S3 用）。**只有 `--playlist-size` 等于 `--selection` 时 S1 与 S2 的曲目集合才相同**，脚本会在记录数字前断言两侧 `sourcePath` 集合哈希一致。

## 测量口径

每个场景分开报两个量，不合并：

- `addActionMs` / `addActionNativeMs`：**加入/创建动作自身**的耗时与其发出的原生命令数
- `listLoad.open.t90FirstVisibleMs` 等：**随后打开歌单**时，初始可见行的封面真正可见的时间（T90），以及该窗口内发出的原生命令数与原生命令建模成本

## 打桩边界（重要）

**只有原生 IPC 是假的**：`audioCommands.ts` 被替换为调用 `window.backendInvoke`。React 组件、列表窗口、封面调度器、`SPXR` 封面解码与 BMP/objectURL 管线全部是生产代码。

固定延迟模型写在 `lib/fixture.mjs` 的 `MODEL`，并随结果落盘到 `engine.mockedLatencyModel`。**该模型不模拟磁盘缓存命中**，因此"每次缩略图请求 18ms"是上界假设，不能当成真实设备上的感知增量；结果里"请求条数"才是与缓存速度无关的结构性证据。

## 结果文件

`results/current/*.json`：`schemaVersion`、`engine`（git commit、worktree、浏览器、视口、延迟模型、打桩清单）、`scenarios`（每场景的中位数/极值、命令构成、sourcePath 哈希）。

## 已知版本约束

| 版本 | 有无搜索页 | 有无"加入既有歌单" |
|---|---|---|
| V1 `8f45750` (10-25) | 无 | **无**（只能测 SW/S2） |
| V2 `6a7da1b` (10-28) | 无 | 有，但对话框 UI 与现行选择器不兼容（S3 会超时失败） |
| V3 `9e8d41c` / V4 `ce65f67` / V5 | 有 | 有 |

**搜索页本身没有"加入既有歌单"入口**：`SearchPanel.tsx` 的 dock selection 只提供 `onCreatePlaylist`，`canAddToPlaylist` 恒为 false。搜索页只能新建列表；追加既有列表要走媒体库 songs 页。

## 注意

版本 worktree 必须放在**仓库外**（默认 `../<repo>-perf-versions`）。放在仓库内会让 `npm run lint` 因多份 `tsconfig.json` 报 `multiple candidate TSConfigRootDirs`。
