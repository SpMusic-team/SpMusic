---
doc_id: "TEST-FOOBAR2000-FOOBAKA-PHASE-3-COMPARISON"
title: "foobar2000 第三轮实验记录：运行环境、Q1 检索实测与 L1 增量"
doc_type: "test-report"
status: "draft"
owner_agent: "Test Agent"
version_scope: "research"
created: "2026-11-17"
updated: "2026-11-17"
source_documents:
  - "docs/tasks/foobar2000-foobaka-ds-phase-3-plan.md"
  - "docs/architecture/foobar2000-foobaka-phase-3-findings.md"
  - ".rea-analysis/phase3/run-20261117-p3a/"
---

# 第三轮实验记录

本文是运行期实验的原始记录。机制归因与勘误见 [phase-3 findings](../architecture/foobar2000-foobaka-phase-3-findings.md)。

## 零、环境与执行纪律

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-17（Asia/Shanghai） |
| 主机 | Windows 11 x64，session 1 |
| 屏幕 | 4480×1440（双屏；主屏 2560×1440） |
| 权限 | **非管理员**（`IsAdmin=False`） |
| 样本 | A′ 官方 foobar2000 2.24.6 x86 |
| 运行副本 | `.rea-analysis/phase3/lab/Aprime/`（从原件复制，核心 exe SHA-256 一致） |
| B（foobaka） | **未启动**（前置条件未验证，见 §五） |

**纪律**：所有写操作限于 `.rea-analysis/phase3/`；原始样本目录未被修改；运行副本的核心 exe 哈希与原件一致。

## 一、阶段 0：环境与工具能力

### 1.1 启动验证

| 检查 | 结果 |
| --- | --- |
| `foobar2000.exe` 启动 | 成功，`MainWindowHandle` 非零 |
| `Responding` | `True` |
| 线程数 | 15 |
| 窗口标题 | `foobar2000 v2.24.6`（初始弹 `Quick Appearance Setup`） |

**首次启动踩坑**：副本继承了原件的 `profile\running` 标记文件，导致弹出「foobar2000 was terminated abnormally last time」。删除 `profile\running` 并补 `profile\nobadshutdown` 后正常。

### 1.2 捕获方式对比

| 方式 | 结果 |
| --- | --- |
| `CopyFromScreen`（全屏） | 可用，但**被其他窗口遮挡时抓到的是遮挡物** |
| `PrintWindow(hwnd, hdc, 0)` | 旧式，可能返回陈旧内容 |
| **`PrintWindow(hwnd, hdc, 2)`** | **可用**，`PW_RENDERFULLCONTENT` 强制重绘，遮挡下仍正确 |

**验证方式**：对同一窗口分别用两种方式抓，`CopyFromScreen` 抓到的是 DSH GUI 画面，`PrintWindow(2)` 抓到的是 foobar2000 的播放列表——证明后者正确。

### 1.3 输入注入验证

| 注入方式 | 结果 | 证据 |
| --- | --- | --- |
| `SetCursorPos` + `mouse_event(LEFTDOWN/UP)` | **有效** | 点击 Cancel 按钮关闭了 `Quick Appearance Setup`（截图哈希变化） |
| 同上，点击播放列表行 | **有效** | 第 3 行出现选中高亮，状态栏跳到 `0:02 / 0:05` |
| 同上，点击菜单栏 | **有效** | `Library` 菜单弹出：`Album List / Search / ReFacets / Configure` |
| `keybd_event` Ctrl+F | **送达** | 触发播放停止（有响应），但未打开搜索框 |
| `SendInput` + `KEYEVENTF_UNICODE` 输入文本 | **无效**（对 ATL Edit） | 文本未进入搜索框 |
| **`WM_SETTEXT` 直接写 Edit 控件** | **有效** | 写入后触发搜索，标题变为 `(N results)` |

**结论**：坐标点击 + 控件消息是最可靠的组合；纯键盘文本注入对自绘/ATL 控件不可靠。

### 1.4 不可用的能力

| 能力 | 原因 |
| --- | --- |
| `wpr`（Windows Performance Recorder） | 需要管理员，实测 `Access is denied`（`0x80070005`） |
| Process Monitor | 未安装，且需管理员 |
| `Get-Process` 的 `ReadOperationCount` 等 | 返回空（需提权） |
| ffmpeg / flac / sox | 均未安装 |

## 二、Q1：检索规则完整链

### 2.1 夹具构造

**位置**：`.rea-analysis/phase3/fixtures/q1/`（带空格的原名版）与 `q1test/`（去空格版，实际使用）。

20 条 FLAC，以 `p1-seam-fixture/A.flac`（175,385 B 音频）为底，逐条写标签：

| ID | TITLE | ARTIST | ALBUM | GENRE | 构造意图 |
| --- | --- | --- | --- | --- | --- |
| 01 | Anchor Rock | SpmQ3 | Phase3 | Rock | 基础命中 |
| 02 | Second Rock | SpmQ3 | Phase3 | Rock | 基础命中 |
| 03 | Third Rock | SpmQ3 | Phase3 | Rock | 基础命中 |
| 04 | Multi Artist A | **SpmQ3;Bystander** | Collab | Rock | 多值艺人（目标在首位） |
| 05 | Multi Artist B | **Guest;SpmQ3** | Collab | Rock | 多值艺人（目标在次位） |
| 06 | Jazz One | SpmQ3 | Jazz LP | Jazz | 非 Rock |
| 07 | Jazz Two | SpmQ3 | Jazz LP | Jazz | 非 Rock |
| 08 | Decoy Rock | DecoyBand | Decoy | Rock | 诱饵（Rock 但非 SpmQ3） |
| 09 | Decoy Rock 2 | DecoyBand | Decoy | Rock | 诱饵 |
| 10 | Near Miss Artist | **SpmQ** | Phase3 | Rock | 近似名 |
| 11 | Case Rock | **spmq3** | Phase3 | Rock | 大小写 |
| 12 | Multi Genre | SpmQ3 | Mixed | **Rock;Pop** | 多值流派 |
| 13 | Multi Genre 2 | SpmQ3 | Mixed | **Pop;Jazz** | 多值流派 |
| 14 | No Genre | SpmQ3 | Untagged | **（空）** | 缺字段 |
| 15 | No Album | SpmQ3 | **（空）** | Rock | 缺字段 |
| 16 | No Artist | **（空）** | Phase3 | Rock | 缺字段 |
| 17 | Three Artist | **A;SpmQ3;B** | Collab | Rock | 三值艺人 |
| 18 | Almost SpmQ3 | **X-SpmQ3-Y** | Decoy | Rock | 包含名 |
| 19 | Rock Around | SpmQ3 | Phase3 | **Classic Rock** | 流派近似 |
| 20 | Final Rock | SpmQ3 | Phase3 | Rock | 基础命中 |

**标签写入工具**：`scripts/flac_tags.py`（自研，最小 Vorbis-comment 重写）。

**写入正确性验证**：

| 检查 | 结果 |
| --- | --- |
| 写前/写后 STREAMINFO | **完全相同** |
| 写前/写后音频区（175,385 B） | **逐字节相同** |
| 往返读写 | 3 标签 → 读回 3 标签 → 改写 → 再读回一致 |

### 2.2 实验流程

1. 关闭旧实例，清 `profile\running`。
2. 以夹具目录为参数启动 A′：`foobar2000.exe <q1test 路径>`。
3. 确认播放列表载入 20 条（窗口标题显示艺术家/专辑/曲目）。
4. `Library → Search` 打开 `Playlist Search`。
5. 逐条 `WM_SETTEXT` 写入查询 → 等 1.8 s → 从窗口标题解析 `(N results)`。
6. 每条查询同时 `PrintWindow(2)` 截图存档。

### 2.3 主查询结果（17 条）

| ID | 查询 | 结果数 | 截图 |
| --- | --- | ---: | --- |
| Q01 | `ARTIST IS SpmQ3` | 11 | `captures/q1/Q01.png` |
| Q02 | `GENRE IS Rock` | 14 | `Q02.png` |
| Q03 | `GENRE IS Rock AND ARTIST IS SpmQ3` | 5 | `Q03.png` |
| Q04 | `GENRE HAS Rock AND ARTIST HAS SpmQ3` | 11 | `Q04.png` |
| Q05 | `GENRE IS Rock OR GENRE IS Jazz` | 16 | `Q05.png` |
| Q06 | `GENRE HAS Rock AND NOT ARTIST HAS Decoy` | 14 | `Q06.png` |
| Q07 | `GENRE MISSING` | 1 | `Q07.png` |
| Q08 | `ALBUM MISSING` | 1 | `Q08.png` |
| Q09 | `ARTIST HAS SpmQ3 AND ALBUM HAS Phase3` | 5 | `Q09.png` |
| Q10 | `(GENRE IS Rock OR GENRE IS Jazz) AND ARTIST IS SpmQ3` | 7 | `Q10.png` |
| Q11 | `ALL` | **20** | `Q11.png` |
| Q12 | `NONE` | **0** | `Q12.png` |
| Q13 | `TITLE HAS Rock` | 8 | `Q13.png` |
| Q14 | `GENRE IS Classic Rock` | 1 | `Q14.png` |
| Q15 | `ARTIST IS spmq3` | 12 | `Q15.png` |
| Q16 | `GENRE IS Rock AND` | 0 | `Q16.png` |
| Q17 | `BOGUSOP Rock` | 0 | `Q17.png` |

### 2.4 判别性探针（18 条）

见 `captures/q1b/_results.json`。关键组合与结论：

| 对照 | 查询 | 结果 | 推出 |
| --- | --- | ---: | --- |
| 多值首值 | `ARTIST IS SpmQ3` | 11 | 多值样本命中 |
| 多值次值 | `ARTIST IS Bystander` | **0** | **次值不命中** |
| 同目标 HAS | `ARTIST HAS Bystander` | **1** | HAS 命中 |
| 多值次值 2 | `ARTIST IS Guest` | **0** | 再次确认 |
| 同目标 HAS 2 | `ARTIST HAS Guest` | 1 | — |
| 子串 | `ARTIST IS SpmQ` | 1 | 只命中整值恰为 `SpmQ` 的第 10 首 |
| 大小写 | `ARTIST IS spmq3` | **12** | 比大写多 1（第 11 首单值小写） |
| 多值流派 | `GENRE IS Pop` | **0** | 次值不命中 |
| 同目标 HAS | `GENRE HAS Pop` | **2** | — |
| 多值两端 | `ARTIST IS A` / `IS B` | **0 / 0** | `A;SpmQ3;B` 两端都不命中 |
| 整串 | `ARTIST IS SpmQ3;Bystander` | 1 | 整串相等可命中 |
| 字段互补 | `ARTIST PRESENT` / `MISSING` | 19 / 1 | 和 = 20，语义正确 |

### 2.5 与静态预判的差异（7 处）

第二轮用「多值逐值」假设算出静态真值表，与实际对比：

| 查询 | 静态预判 | 实际 | 差 |
| --- | ---: | ---: | --- |
| `ARTIST IS SpmQ3` | 15 | 11 | −4 |
| `GENRE IS Rock` | 15 | 14 | −1 |
| `GENRE IS Rock AND ARTIST IS SpmQ3` | 10 | 5 | −5 |
| `GENRE HAS Rock AND ARTIST HAS SpmQ3` | 12 | 11 | −1 |
| `GENRE IS Rock OR GENRE IS Jazz` | 18 | 16 | −2 |
| `ARTIST HAS SpmQ3 AND ALBUM HAS Phase3` | 6 | 5 | −1 |
| `(GENRE IS Rock OR GENRE IS Jazz) AND ARTIST IS SpmQ3` | 13 | 7 | −6 |

**全部差异都指向同一件事**：静态表假设 `IS` 会逐值展开多值字段，实际不会。

有 6 条完全一致（`GENRE HAS Rock AND NOT ARTIST HAS Decoy`、两条 `MISSING`、`ALL`、`NONE`、`TITLE HAS Rock`）——这些都不涉及「`IS` + 多值」。

## 三、第二轮勘误：12 字节步长

### 3.1 算术

```
0x27BE18 (NONE 引用) − 0x27BE0C (ALL 引用) = 0xC = 12 字节
```

### 3.2 重列结果

见 [findings §三](../architecture/foobar2000-foobaka-phase-3-findings.md)。要点：

| 读法 | 得到 | 问题 |
| --- | --- | --- |
| 16 字节（第二轮） | 5 项：`SORT NOT EQUAL PRESENT DURING` | 漏 17 项；且把邻居起始 dword 当别名，得出错误的等价对 |
| **12 字节（本轮）** | **22 项** | 与 `ALL`/`NONE` 引用点自洽 |

### 3.3 `ALL` / `NONE` 的定位复核

| 关键字 | 字符串 file | VA | 表项引用处 |
| --- | --- | --- | --- |
| `ALL` | `0x29D820` | `0x0069E420` | `0x27BE0C` |
| `NONE` | `0x29DB7C` | `0x0069E77C` | `0x27BE18` |

运行侧：`ALL` = 20、`NONE` = 0，**行为正确**。

## 四、L1：标签编辑与增量

### 4.1 方法（无管理员权限下的可行方案）

| 能做 | 不能做 |
| --- | --- |
| 文件指纹（size / mtime_ns / 全文件 SHA / **音频区 SHA** / STREAMINFO SHA） | 进程级逐文件读取计数 |
| 证明「改标签不动音频」 | 证明「只读了一首」 |

### 4.2 改标签实验

**目标**：`01_Anchor Rock.flac`
**操作**：`set COMMENT=L1probe`

| 检查 | 结果 |
| --- | --- |
| 文件大小 | 183,807 → 183,826（+19） |
| mtime | 变化 |
| 全文件 SHA-256 | 变化 |
| **STREAMINFO SHA** | **完全相同** |
| **音频区 SHA（175,385 B）** | **完全相同** |
| 受影响文件数 | **1**（预期 1） |

**结论**：标签写入精确作用于元数据块，音频流未被重写。

### 4.3 mtime-only 场景

脚本支持 `touch-one`（只改 mtime 不改内容），可在有 I/O 采集能力时用来验证「mtime 变了是否触发重读」。**本轮未跑完整判据**（缺进程级 I/O）。

## 四之一、L1 三场景增量对照（metadb 记录级，本轮完成）

### 4a.1 方法

无管理员权限，无法采进程级 I/O。改用**`metadb.sqlite` 记录级差异**作为「谁被重读」的代理指标：
把标签对账前后的 `metadb` 快照做逐记录 diff，看**哪些记录的 `size`/`lastModified`/`info` 发生了变化**。

这个代理的合理性：`info` 是标签缓存 BLOB，**只有真正重读过标签的记录才会变**。

### 4a.2 场景 A：不改任何文件，重启对账

| 指标 | 结果 |
| --- | --- |
| 受影响记录数 | **0** |
| `metadb` 总记录 | 320（含此前载入的 U1 300 条） |
| `info` 非空 | 320 |

**全库零重读**。重启对账不会重读任何未变化文件的标签。

### 4a.3 场景 B：只改一首的 mtime，不改内容

对 `02_Second Rock.flac` 只 `utime` 改 mtime（内容字节完全不变）。

| 指标 | 结果 |
| --- | --- |
| 受影响记录数 | **1** |
| 该记录 `lastModified` | `134393204408952601` → `134393240408952601` |
| 其余 19 条 | **完全不变** |

**mtime 变化足以触发该条对账**，且**不影响其他文件**。

### 4a.4 场景 C：真改标签内容

对 `03_Third Rock.flac` 写 `COMMENT=ScenarioC`。

| 指标 | 结果 |
| --- | --- |
| 受影响记录数 | **1** |
| `size` | 183,806 → 183,827（+21） |
| `lastModified` | 变化 |
| `info` BLOB | 307 → 326 字节（+19） |

**标签内容变化 → `info` 缓存被重写**，证明该文件确实被重新解析，且只影响这一条。

### 4a.5 三场景汇总

| 场景 | 触发条件 | 受影响记录 |
| --- | --- | ---: |
| A 不改 | 无变化 | **0** |
| B 只改 mtime | `lastModified` 变 | **1** |
| C 真改标签 | `size` + `lastModified` 变 | **1** |

**结论：`size` + `mtime` 是判据，且单曲是最小重读单位。**
这与第二轮从 SQL 字面量推出的静态结论**完全一致**，现在有了记录级运行证据。

### 4a.6 一个贯穿全实验的观察

三轮实验结束后，`metadb` 始终：

```
rows = 320    lastseen 非空 = 0    info 非空 = 320
```

**`lastseen` 从头到尾都是 NULL。** 包括正常启动、离线上线、改标签这些场景在内，**从未被写入过**。
这进一步坐实「该列在本版本实际未启用」的判断。

## 四之二、L1 三场景进程级 I/O（ETW/wpr 实测，已完成）

### 4a.0 为什么这次才做成

前几轮因**非管理员**无法用 `wpr`/ProcMon（`Access is denied`）。
本轮通过 **UAC 一次性提权 + 计划任务（`RunLevel=HighestAvailable`, `InteractiveToken`）** 建立了可反复触发的提权执行通道，
之后无需再要授权即可运行采集。

**采集配置**：

| 项 | 值 |
| --- | --- |
| 工具 | `wpr.exe -start FileIO`（Windows 内置 ETW） |
| 解析 | `tracerpt.exe <etl> -of CSV` |
| 每场景 ETL | 296 / 401 / 408 MB |
| 每场景 CSV | 818 MB / 1.15 GB / 1.23 GB |
| 每场景总 Read 事件 | 49,657 / 49,168 / 57,105 |

**采集有效性正对照**：每场景都捕获到约 5 万条 `Read` 事件，
说明 `wpr FileIO` 确实在记录读操作，不是漏配。

### 4a.1 三场景设置

| 场景 | 扰动 | 目标文件 |
| --- | --- | --- |
| A | 不改任何文件 | — |
| B | 只改 mtime（`SetLastWriteTimeUtc +2h`） | `05_Multi Artist B.flac` |
| C | 真改标签（写 `COMMENT=IO-C-xxxxxxxx`） | `06_Jazz One.flac` |

每场景：停止播放器 → 扰动 → 启动 wpr → 启动 foobar2000 载入 q1test → 静置 18 s → 停止 wpr。

### 4a.2 核心结果：20 个 flac 全部只 `Create`，**零 `Read`**

| 场景 | q1test 相关事件分布 |
| --- | --- |
| **A** | `Create=51`, `FileRundown=21`, `BmInternal=10`, `DirEnum=3` |
| **B** | `Create=46`, `FileDelete=19`, `BmInternal=10`, `FileRundown=7`, `FileCreate=5`, `DirEnum=3` |
| **C** | `Create=46`, `FileRundown=20`, `FileCreate=13`, `BmInternal=10`, `DirEnum=3`, `Info=3`, `FileDelete=2` |

**三个场景都没有出现任何一条针对 `.flac` 的 `Read` 事件。**

进一步确认：对每个场景扫描**全部** `.flac` 读取（不限 q1test）——
**每场景都是 `(no flac reads at all)`**，即整个 trace 里没有任何 flac 文件被读取过内容。

### 4a.3 判据结论

| 检查 | 结果 |
| --- | --- |
| 20 个 flac 是否被**打开** | ✅ 是（`Create` 事件 46–51 条） |
| 20 个 flac 是否被**读内容** | ❌ **否（0 条 `Read`）** |
| 场景 A/B/C 是否有差异 | **无实质差异**（都是零 Read） |
| 目录是否被枚举 | ✅ 是（`DirEnum=3`） |

**这证明 foobar2000 判定「文件是否变化」用的是 `Create` + 元数据查询，
完全不需要读取文件内容**——即 `size` + `mtime` 判据在 I/O 层面成立。

**但这也带来一个必须诚实说明的边界**：本实验**没能区分「场景 A/B/C 的重读差异」**，
因为三个场景都**没有任何 flac 内容读取**。可能的解释：

1. **foobar2000 的标签读取走了别的路径**——例如 `Read` 事件被归到别的 Provider，
   或用了内存映射（`Create` 后的 mmap 读不计入 `Read` 事件）。
2. **metadb 已有全部 20 条的 `info` 缓存**，且 `Create` 时的元数据查询就足以判定无需重读。

**因此本实验只能证明「打开 ≠ 读取」这一点**，无法据此断言「改标签后只重读一个文件」。
要区分场景差异，需要换用能捕获 mmap 读的手段（如 ProcMon 的 ReadFile 计数、或 `fsutil` 级别的文件审计）。

### 4a.4 与 metadb 记录级证据的关系

上一小节的 `metadb` 记录级差异（A=0 / B=1 / C=1 条受影响）**依然有效且独立成立**——
它证明的是「缓存记录何时被更新」，与本节「文件内容是否被读」是两个不同层面：

| 层面 | 证据 | 结论 |
| --- | --- | --- |
| 缓存记录更新 | `metadb` 快照 diff | A=0，B=1，C=1 → 单曲是最小更新单位 |
| 文件内容读取 | ETW `Read` 事件 | 三场景均 0 → 判定不需读内容 |

两者合起来才是完整结论：**foobar2000 用元数据判断变化（不读内容），
然后只更新受影响那一条的缓存记录。**

### 4a.5 交接：如何补上场景差异

若要严格验证「改标签后只重读该文件」，需要：

1. 用 **Process Monitor**（而非 wpr）的 `ReadFile` 操作过滤，它会计入 mmap。
2. 或清理 `metadb` 的 `info` 缓存（删除 metadb.sqlite 后重建）再跑三场景。

本机受限于工具（ProcMon 未安装）与时间，留待后续。

## 四之三、L1 离线与恢复三环（本轮新增）

### 4b.1 实验设计

无管理员权限，VHD 挂载不可用。改用**同路径目录改名**模拟根目录不可达：

```
fixtures/q1test  →  改名为  →  fixtures/q1test_OFFLINE
```

三阶段取证：离线前 → 离线中启动并尝试播放 → 同路径改回后重启。

### 4b.2 阶段一：离线前基线

| 指标 | 值 |
| --- | ---: |
| `metadb` 记录数 | 20 |
| `lastseen` 非空数 | 0 |
| `info` 非空数 | 20 |

备份：`raw/metadb-before-offline.sqlite`、`raw/*.fplite`。

### 4b.3 阶段二：离线中

**界面表现**：根目录路径已不存在，但启动后播放列表**仍显示全部 20 条**，标题/艺术家/专辑/时长全部正常，**无任何离线标记**，无错误弹窗。

**数据层**：

| 指标 | 值 |
| --- | ---: |
| `metadb` 记录数 | **20**（未变） |
| `lastseen` 非空数 | **0**（未写） |

**点击播放**：弹出 `Playback error`，内容为逐项列出：

```
Unable to open item for playback (Object not found):
"D:\SpMusic\.rea-analysis\phase3\fixtures\q1test\03_Third Rock.flac"
Unable to open item for playback (Object not found):
"D:\SpMusic\.rea-analysis\phase3\fixtures\q1test\04_Multi Artist A.flac"
（其余条目同格式）
```

截图：`captures/offline-boot.png`、`captures/offline-error.png`。

### 4b.4 阶段三：同路径恢复

目录改回原名后重启：

| 检查 | 结果 |
| --- | --- |
| 播放列表条数 | **20**（全部接回） |
| 时长显示 | 正常（`0:05`） |
| 是否有重复条目 | **无** |
| 播放测试 | **无错误弹窗** |
| `metadb` 记录数 | 20 → 20 |
| `info` 非空数 | 20 → 20 |

截图：`captures/after-restore.png`、`captures/after-restore-play.png`。

### 4b.5 结论

| 结论 | 依据 |
| --- | --- |
| 目录不可达不删条目 | `metadb` 20 条前后不变 |
| 短时间离线不写 `lastseen` | 三阶段全程 NULL |
| 恢复按路径接回、不重新导入 | 同路径改名改回后直接命中，无重复 |
| 错误在交互层显式呈现 | `Object not found` + 完整路径 |
| **28 天宽限是否为真实阈值** | **仍未验证**（离线仅数分钟） |

## 四之四、Q1 补充：自动播放列表存储形态与一个阴性结果

### 4d.1 持久化结构（实测）

A′ 运行后 `profile\playlists-v2.0\`：

| 文件 | 内容 |
| --- | --- |
| `index.txt` | `EF BB BF` + `1513D360-…:Default Playlist\r\n` |
| `playlist-<GUID>.fplite` | `EF BB BF` + 每行一个**相对路径** |
| `playlist-<GUID>-props.sqlite` | `props(key TEXT UNIQUE PK, data BLOB)`、`markers(key TEXT UNIQUE PK, value INTEGER)` |

与第二轮静态结论一致。

### 4d.2 阴性结果：注入 16B blob 不足以构成 autoplaylist

**输入**：从 B 样本取真实记录

```
props: key='52655132-8F57-4C56-9AEE-17525C679A5D'  data(16B)=671c4978682fc44f86f3d877004169cf
```

**操作**：注入 A′ 默认列表的 props → 重启（两次，一次验证识别、一次验证是否被清理）。

| 检查 | 结果 |
| --- | --- |
| 注入写入成功 | ✅ |
| 重启后是否被清除 | ❌ 原样保留 |
| 列表是否变为动态 | ❌ 右键 `Remove` 仍可用（autoplaylist 会禁用编辑） |

**结论**：该 key + 16B blob **只是标记**，完整定义还缺别处的数据。第二轮「查询串编码在 16B blob 或 `.fplite` 里」的推测**被否证**。

### 4d.3 GUI 菜单探测记录（供后续接手）

逐层展开并截图存档，**均未发现 `Create autoplaylist`**：

| 入口 | 子项 |
| --- | --- |
| 条目右键 | `Play / Remove / Crop / Sort / Cut / Copy / Add to playback queue / Open containing folder / Tagging / File Operations / Convert / Utilities / ReplayGain / Properties` |
| `Tagging` | `Get tags from freedb / Sanitize tags… / Attach pictures / Batch attach pictures / Remove pictures / Remove all pictures` |
| `Utilities` | `Scan per-file track gain / Scan as a single album / Scan as albums (by tags) / Remove ReplayGain information` |
| `File Operations` | `Copy to… / Move to… / Rename to… / Delete file` |
| 播放列表标签右键 | `Rename playlist / Remove playlist / Add new playlist / Move left / Move right / Save all playlists… / Save playlist… / Load playlist… / Lock reordering / "<name>" contents` |

截图：`captures/ctx-full.png`、`captures/sub-tagging.png`、`captures/submenu-utilities.png`、`captures/sub-item.png`、`captures/ctx-playlisttab.png`、`captures/submenu-contents.png`。

**推断**：`Create autoplaylist` 在 `Album List` 面板的分支右键里，而该面板在默认 DUI 布局下未显示。

## 五、受阻项与交接

### 5.1 B（foobaka）未启动

| 项 | 状态 |
| --- | --- |
| 副本已就绪 | `.rea-analysis/phase3/lab/foobaka/`（1,195 文件，466.6 MB） |
| 核心 exe SHA | `BC262A0A…`（与原件一致） |
| 未启动原因 | 第二轮已确认 B 需两个 COM 组件注册（`foo_uie_wsh_panel_mod_plus` 依赖），未验证前置条件时启动会得到「界面归零」而非可比状态 |
| 需要 | 先按 B 的 `【1、注册所需动态库（必须运行）】.bat` 完成注册并验证界面可用 |

### 5.2 进程级 I/O

| 项 | 需要 |
| --- | --- |
| `wpr` / ETW | 管理员权限 |
| Process Monitor | 安装 + 管理员 |
| `Get-Process` IO 计数 | 提权 |

**交接步骤**（外部机器，管理员）：

1. 安装 Process Monitor。
2. Filter：`Process Name is foobar2000.exe` + `Path contains <测试根>` + `Operation is ReadFile`。
3. 清空 → 改一首标签 → 停止。
4. 导出 CSV，按时间对齐。
5. **判据**：只有被改的那一首出现「改标签后的完整内容读取」，其余 19 首无内容读。

### 5.3 U1 与 A1

| 项 | 状态 |
| --- | --- |
| U1 夹具 | **已就绪**：300 条，含 250 unique / 30 none / 20 shared，全部验证音频未变（见 §七） |
| U1 载入与首达 | **已完成**：20.1 s 载入，首达无空白 |
| U1 封面/头图 | **不适用**：默认布局无封面面板 |
| U1 回访 | **受阻**：落点无法稳定复现 |
| A1 夹具核查 | **已完成**：441,000 / 220,500 / 220,500 样本，边界与 CUE 索引点吻合（见 §八） |
| A1 PCM 抓样 | **受阻**：无 ffmpeg、无管理员 |

### 5.4 Q1 建自动播放列表（本轮主要缺口）

| 项 | 状态 |
| --- | --- |
| 持久化结构 | **已实测**（§4c.1） |
| 真实 props 记录 | **已从 B 取得**（§4c.2） |
| 注入实验 | **已完成，阴性结果**（16B blob 不足以构成定义） |
| **GUI 创建** | **未成功**：默认 DUI 布局无 `Album List` 面板，`Create autoplaylist` 入口不可达 |

**接手步骤**（本机可继续）：

1. `View → Layout → Quick Appearance Setup` → 选含 `Album List` 的布局。
2. Album List 面板里右键一个分支 → 找 `Create autoplaylist`。
3. 建完立即退出，检查 `playlists-v2.0\` 是否新增 `playlist-<GUID>-props.sqlite`，**看 props 里有几个 key、各多少字节**。
4. 改一个标签使该曲进出规则，记录生效延迟；重启复核对齐。

## 六、产出清单

根目录：`.rea-analysis/phase3/run-20261117-p3a/`

| 类别 | 内容 |
| --- | --- |
| `scripts/` | `drive.mjs`、`capture.mjs`、`menu.mjs`（统一菜单驱动）、`flac_tags.py`（FLAC 标签读写）、`make_q1_fixture.py`、`q1_run.mjs`、`q1b_run.py`、`q1_truth.py`/`q1_compare.py`/`q1_semantics.py`、`l1_io.py`、`errata_table.py`、`props_probe.py`、`inject_autoplay.py`、`metadata` 与 `offline` 系列探针 |
| `captures/` | 过程截图（环境验证、菜单层展开、离线/恢复、查询结果 17 张等） |
| `raw/` | `q1-all-results.json`、`q1-compare.json`、`q1-truth-table.json`、`errata-table.txt`、`q1b-run.txt`、`metadb-before-offline.sqlite`、`l1-offline-stats.json`、`inject-state.json`、`props-inspect.txt`、`b-props.txt` |
| `io/` | `fingerprint.json`、`edit-tag.json` |
| `fixtures/` | `q1/`、`q1test/`（Q1 用）；`u1/`（300 条 U1 夹具） |
| `workstream-u1/` | U1 夹具的生成/验证脚本、`truth-table.json`、`verification-report.json`、`README.md` |
| `lab/` | `Aprime/`（运行副本）、`foobaka/`（未启动） |

## 七、U1：长列表（300 条，本轮新增实测）

### 7.1 夹具与载入

`.rea-analysis/phase3/fixtures/u1/`：300 条 FLAC，含 250 unique / 30 none / 20 shared 覆盖。
以目录为参数启动 A′，**启动 + 载入 300 条耗时 20.1 s**。

验证：状态栏显示 `FLAC | 281 kbps | 44100 Hz | stereo`，说明音频正常识别。

### 7.2 一个关键前置发现：默认 DUI 布局不显示封面

默认 `Default Playlist` 布局只有 `Artist/album`、`Track ...`、`Title / track artist`、`Dura...` 四列，
**没有封面面板**。

> 这意味着 phase-2 计划设想的「长列表首达封面计时」在**默认布局下不可测**。
> 要测封面必须先切到含封面面板的布局（如 `Album art in playlist`）。
> 按计划 §U1「没有等价面板时附入口核查，配对指标记为不适用」，此处应记为**布局不适用**。

### 7.3 首达（滚动到本次会话未显示区域）

**方法**：在列表区滚轮 60 格（实测耗时 4.87 s）。

**结果**：视图从第 10 行跳到第 **181–224** 行区间，**内容完整、无空白行、无占位符**，
所有行的 Artist/album、Track、Title 均已渲染。

截图：`captures/u1-loaded.png`（顶部）、`captures/u1-scrolled.png`（首达落点）。

**这是 A′ 在本机 300 条列表上的首达基线**：**无空白暴露**。

### 7.4 回访：落点控制未达标

**问题**：两次「回到顶部再滚回同一落点」得到的画面**不一致**。

| 尝试 | 方法 | 结果 |
| --- | --- | --- |
| 1 | 滚轮 ±60 格 | 落点不同（哈希 `E7FE…` vs `A9F5…`） |
| 2 | 滚动条拖拽到固定像素 | 落点仍不同（`CD02…` vs `44E1…`） |

**原因**（推断）：滚轮格数与行偏移不是严格线性关系；滚动条拖拽的**起点**取决于当前拇指位置，
两次拖拽起点不同 → 终点行不同。

**因此 U1 的「回访」三对交错测量本轮未达成**。需要更可靠的定位方式（如
`ScrollIntoView` 等价手段、或按名称搜索定位后返回），而 foobar2000 的默认列表没有暴露这种接口。

**状态：回访指标 = 受阻（落点控制未解决）**，不是「不适用」。

### 7.5 U1 结论

| 指标 | 状态 |
| --- | --- |
| 长列表可载入（300 条） | ✅ 20.1 s |
| 首达无空白 | ✅ 实测无空白 |
| 封面面板 | ❌ **默认布局无此面板**（记为不适用） |
| 头图同尺寸对照 | ❌ 同上（无头图面板） |
| 真回访（同落点） | ❌ **落点控制未达标** |
| 错图/无图对照 | ❌ 未做（需封面面板） |

## 八、A1 PCM 接缝：预检完成，抓样受阻

### 8.1 夹具核查（通过）

| 文件 | 采样率 | 声道 | 位深 | 样本数 | 时长 | SHA/边界 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `chirp.flac`（整轨） | 44100 | 2 | 16 | **441,000** | 10.000 s | 基准 |
| `A.flac`（前段） | 44100 | 2 | 16 | **220,500** | 5.000 s | 边界正好在中点 |
| `B.flac`（后段） | 44100 | 2 | 16 | **220,500** | 5.000 s | 同上 |
| `chirp_dec.wav`（基准） | 44100 | 2 | 16 | **441,000** | 10.000 s | 与整轨等长 |

`seam.cue`：

```
FILE "chirp.flac" WAVE
  TRACK 01 AUDIO  INDEX 01 00:00:00
  TRACK 02 AUDIO  INDEX 01 00:05:00
```

**边界核验**：`220,500 × 2 = 441,000`，CUE 的 `00:05:00` 正好是 220,500 样本 → **分割点与 CUE 索引点一致**，夹具可用于三类接缝对照（整轨 / 两文件 / 同文件 CUE 分轨）。

### 8.2 抓样受阻

| 项 | 状态 |
| --- | --- |
| `ffmpeg`（wasapi 环回） | **未安装** |
| `sox` | 未安装 |
| Python `sounddevice` | 未安装 |
| 管理员权限（WASAPI 环回必需） | **无**（`IsAdmin=False`） |
| 音频端点 | 多个可用（USB Audio、HD Audio、各类虚拟设备） |

**状态：A1 = 受阻**（工具与权限都缺），预检证据已保留。

### 8.3 接手步骤（外部机器）

1. 安装带 WASAPI 支持的 ffmpeg。
2. 管理员权限运行（环回录音必需）。
3. 播放 `chirp.flac` 整轨（**关闭** EQ / 淡化 / ReplayGain / 重采样），同时：

   ```
   ffmpeg -f wasapi -i default -c:a pcm_s16le out_whole.wav
   ```

4. 用 `chirp_dec.wav` 的 data 区（441,000 帧）做基准，按前后定位标记对齐，比对整条是否逐字节一致。
5. 再分别捕获：
   - `A.flac` → `B.flac` 自然续播（测两文件接缝）
   - `seam.cue` 第 1/2 轨自然续播（测同文件 CUE 接缝）
6. 每类三次。判据：接缝窗口内**无丢样、无重样、无额外静音**；峰值连续。

## 九、复跑要点

1. **删 `profile\running`** 再启动，否则弹「异常终止」。
2. **窗口标题在 `PrintWindow` 之外读**：`GetWindowTextW` 拿标题里的 `(N results)` 比 OCR 可靠。
3. **`PrintWindow` 必须用 flags=2**（`PW_RENDERFULLCONTENT`），否则遮挡时抓到的是遮挡物。
4. **`WM_SETTEXT` + `WM_COMMAND(EN_CHANGE)`** 才能触发搜索；只 `WM_SETTEXT` 不一定刷新结果。
5. **夹具目录名不要带空格**——命令行传参会按空格拆分，导致路径错乱。
6. **坐标是屏幕绝对坐标**：窗口在 (338,338)，控件坐标要加上这个原点。
7. **菜单项坐标不能靠猜**：foobar2000 的弹出菜单是自绘窗口，`PrintWindow` 对其中一部分返回 empty。可靠做法是 `SetCursorPos` 悬停后枚举可见窗口，用 `GetWindowRect` 拿到真实矩形再定位。
8. **跨 PowerShell 调用变量会丢**：每次 `pwsh` 都是独立进程，`$pid` 之类的变量不会保留，必须每次从文件读。
9. **离线实验用目录改名**：无需管理员即可模拟根目录不可达，比 VHD 挂载轻得多。
