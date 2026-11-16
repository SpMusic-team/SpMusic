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

| 项 | 受阻原因 |
| --- | --- |
| U1 长列表首达/回访/头图 | 需 300 条带编号封面夹具 + 逐帧录像分析；本轮未构造 |
| A1 PCM 接缝抓样 | 无 ffmpeg；WASAPI 环回需管理员或专用设备 |

## 六、产出清单

根目录：`.rea-analysis/phase3/run-20261117-p3a/`

| 类别 | 内容 |
| --- | --- |
| `scripts/` | `drive.mjs`（输入注入）、`capture.mjs`（PrintWindow 捕获）、`flac_tags.py`（FLAC 标签读写）、`make_q1_fixture.py`（夹具生成）、`q1_run.mjs`（17 条主查询）、`q1b_run.py`（18 条探针）、`q1_truth.py`/`q1_compare.py`/`q1_semantics.py`（分析）、`l1_io.py`（指纹与增量）、`errata_table.py`（12 字节重表） |
| `captures/` | 27 张过程截图 + `q1/` 17 张查询结果 + `q1b/` 探针数据 |
| `raw/` | `q1-all-results.json`、`q1-compare.json`、`q1-truth-table.json`、`errata-table.txt`、`q1b-run.txt` |
| `io/` | `fingerprint.json`、`edit-tag.json` |
| `fixtures/` | `q1/`（原名版）、`q1test/`（去空格版，实际使用） |
| `lab/` | `Aprime/`（运行副本）、`foobaka/`（未启动） |

## 七、复跑要点

1. **删 `profile\running`** 再启动，否则弹「异常终止」。
2. **窗口标题在 `PrintWindow` 之外读**：`GetWindowTextW` 拿标题里的 `(N results)` 比 OCR 可靠。
3. **`PrintWindow` 必须用 flags=2**。
4. **`WM_SETTEXT` + `WM_COMMAND(EN_CHANGE)`** 才能触发搜索；只 `WM_SETTEXT` 不一定刷新结果。
5. **夹具目录名不要带空格**——命令行传参会按空格拆分，导致路径错乱。
6. **坐标是屏幕绝对坐标**：窗口在 (338,338)，控件坐标要加上这个原点。
