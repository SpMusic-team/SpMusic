---
doc_id: "TASK-FOOBAR-HANDOFF-GUI-OPERATOR"
title: "foobar2000 界面类实验：移交具备完整桌面的操作者"
doc_type: "task"
status: "ready"
owner_agent: "lead"
version_scope: "research"
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "docs/corpus/foobar2000-foobaka-ds-phase-2-plan.md"
  - "docs/corpus/foobar2000-foobaka-ds-phase-3-plan.md"
  - "docs/corpus/foobar2000-foobaka-phase-4-findings.md"
---

# foobar2000 界面类实验：移交具备完整桌面的操作者

> **为什么需要这张卡**：本项目已用 10 轮做了能做的静态与半自动实验。
> 剩下三项**必须有人真正操作 foobar2000 界面**，自动化在两次尝试中均失败。
> 本卡给出前提、步骤与接受标准，任何有完整桌面环境的人都能直接执行。

## 零、三项受阻任务的共同前提

| 项 | 要求 |
| --- | --- |
| 桌面 | 交互式 session，非远程无头 |
| 样本 | `D:\SpMusic\.rea-analysis\foobar2000-Aprime-2.24.6-x86\` |
| 运行副本 | 复制到独立目录，保留 `profile` 可回滚 |
| 夹具 | `.rea-analysis\phase3\fixtures\q1test\`（20 条，标签已规划好） |
| 前置 | 删除 `profile\running`，补 `profile\nobadshutdown` |

**已排除的“假障碍”**（不要再浪费时间在这上面）：

| 曾误判的障碍 | 实际情况 |
| --- | --- |
| 需要管理员权限 | 不需要。10 轮实验全部在非管理员下完成 |
| `PrintWindow` 抓不到内容 | 必须用 `flags=2`（`PW_RENDERFULLCONTENT`），`flags=0` 才会拿到陈旧位图 |
| 需要环回音频设备 | 不需要。WASAPI 环回不依赖端点设备，已自建录制器 |

## 一、任务 A：同任务找歌路径（P2 §1.1 / P3 L59）

### 已排除的路径（不要再试）

| 尝试 | 结果 |
| --- | --- |
| 播放列表条目右键找 `Create Autoplaylist` | **不存在**，它在 Album List 分支右键 |
| `Library → Search` 后点击菜单项 | 菜单能读出（`Search` 为 id=4），但对话框始终不出现 |
| 键盘导航菜单 | 键被吃掉，触发播放而非菜单 |
| Album List 的 Filter 输入 | 能写入，但树内容为空（`Nothing to show - configure Media Library first`） |

**根因**：Album List 需要**先配置好 Media Library** 才有内容。
`profile\library-v2.0\folders` 虽存在（30 B，相对路径 `..\..\fixtures\q1test\`），
但面板仍报未配置。**这一步必须人工完成。**

### 操作步骤

1. 启动运行副本，确认主窗口不是空白。
2. `Library → Configure` → `Media Library` → `Add...` → 选择 `fixtures\q1test` → `OK`。
3. 确认 Album List 面板显示 20 条（不是 `Nothing to show`）。
4. 在 Album List 的 `Filter` 框输入 `SpmQ3`，记录：
   - 树里出现几个分支、用时多少
   - 双击 / 右键 `Send to Current Playlist` 的行为差异
5. 找到编号曲目，记录「设为下一首」的实际入口（`Add to playback queue`？还是别的）。
6. 让当前曲自然播完，确认是否按队列切换。

### 接受标准

- 操作次数、总用时、实际队列状态各一份记录；
- 自然切换是否发生要有明确结论（发生 / 未发生 / 部分发生）；
- 附一段录屏（可用 `ffmpeg -f gdigrab`，参数见下）。

## 二、任务 B：`IS` 语义的最后一个特例

### 要解决的问题

`ARTIST IS spmq3` 实测 **12** 条，而 `ARTIST IS SpmQ3` 实测 **11** 条。
反汇编重建的算法能复现 7/8 条探针，**唯独差这一条**。

### 操作步骤

1. 先把 Media Library 指到 `q1test`（同任务 A 的步骤 2）。
2. `Library → Search` 打开 `Playlist Search`。
3. 依次输入并记录窗口标题里的 `(N results)`：

   | 查询 | 已知实测值 |
   | --- | ---: |
   | `ARTIST IS SpmQ3` | 11 |
   | `ARTIST IS spmq3` | 12 |
   | `ARTIST IST SpmQ3` | 未知 |
   | `ARTIST IST spmq3` | 未知 |
   | `ARTIST IS SpmQ3*` | 未知 |
   | `ARTIST IS *spmq3*` | 未知 |

4. **关键**：对每一条，记录返回的具体曲目名（不只是数量）。
   `ARTIST IS spmq3` 比预期多出来的那 1 条是哪首，是解开特例的关键。

### 接受标准

- 上表 6 条查询的实际结果数；
- `IS spmq3` 结果集的完整曲目清单（与 `IS SpmQ3` 对比，指出差异项）。

## 三、任务 C：组织与恢复的批量迁移实测（P2 §2.3）

### 现状

只读体检已实现（`org_healthcheck.py`），但**真正的改名/迁移未做**。

### 操作步骤

1. 复制 `q1test` 到新的可丢弃目录 `q1test_migrate`。
2. 在 foobar 里对其中一首执行 `Tagging` 之外的 `File Operations → Rename to...`，
   模板用 `%artist% - %title%`。
3. **先看预览窗口**（`File Operation Preview`），记录它给出的三列内容。
4. 确认执行，然后检查：
   - `metadb` 里该曲的 `name` 是原地更新？还是删旧建新？
   - 已保存的播放列表（`.fplite`）里的路径是否跟着变？
5. 再制造一次冲突：目标文件名已存在，记录部分失败的表现与是否回滚。

### 接受标准

- 预览窗口的实际内容；
- 迁移后 `metadb.name` 的变化（旧行是否还在）；
- `.fplite` 是否同步更新（**这是关键问题**）；
- 冲突时是整体失败还是部分成功。

## 四、录屏与截图的最小可用配置

```powershell
# 抓单帧（窗口在 338,338，尺寸 1920x1059）
ffmpeg -y -f gdigrab -offset_x 338 -offset_y 338 -video_size 1920x1059 \
       -i desktop -frames:v 1 out.png

# 录 12 秒
ffmpeg -y -f gdigrab -framerate 15 -offset_x 338 -offset_y 338 \
       -video_size 1920x1059 -i desktop -t 12 out.mp4
```

> **踩坑记录**：ffmpeg 进程必须在整个录制期间存活，**父进程不能先退出**。
> 用 `Start-Job` / `Start-Process` 都会得到 48 字节的坏文件。
> 可靠做法是用 .NET `ProcessStartInfo` + `RedirectStandardError`，
> 父进程 `WaitForExit()` 到录制结束。

## 五、证据要放在哪

```
.rea-analysis/phase5/run-<date>/
  captures/     截图的 PNG，按任务编号命名
  raw/          每项任务一个 JSON，记录查询/结果/时间
  manifest.json 环境、样本 SHA、完成项
```

## 六、本文与前序轮次的关系

| 轮次 | 已完成的 | 本卡承接的 |
| --- | --- | --- |
| 第 3 轮 | Q1/L1/U1 主体、A1 受阻 | — |
| 第 4 轮 | A1 闭合、B 数据层、分派表勘误 | 任务 B 的 `IS` 特例 |
| 第 5–6 轮 | 运算符全扫描、`.fcl` 结构 | — |
| 第 7–9 轮 | SpMusic 侧核查与设计 | — |
| **本轮** | 剩余条款复核 | **任务 A / B / C** |
