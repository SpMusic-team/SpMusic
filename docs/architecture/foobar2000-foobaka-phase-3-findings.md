---
doc_id: "ARCH-FOOBAR2000-FOOBAKA-PHASE-3-FINDINGS"
title: "foobar2000 第三轮：运行证据与第二轮勘误"
doc_type: "architecture-research"
status: "draft"
owner_agent: "Architecture Agent"
version_scope: "research"
created: "2026-11-17"
updated: "2026-11-17"
source_documents:
  - "docs/tasks/foobar2000-foobaka-ds-phase-3-plan.md"
  - "docs/architecture/foobar2000-search-mechanisms.md"
  - "docs/architecture/foobar2000-library-mechanisms.md"
  - "docs/test/foobar2000-foobaka-phase-3-comparison.md"
  - ".rea-analysis/phase3/run-20261117-p3a/"
---

# 第三轮：运行证据与第二轮勘误

本轮第一次拿到了**真实运行证据**。前两轮全部是静态分析，本轮实际启动了官方 foobar2000 2.24.6 x86，用真实输入驱动 UI 并截取结果。

## 零、一句话总结

**首轮记录的 E-008 阻塞（`PrintWindow` 返回静态缓存位图、输入注入受限）不成立。** 本机有可用的交互桌面（session 1，4480×1440），`PrintWindow` 配 `PW_RENDERFULLCONTENT`（flags=2）可抓到被遮挡窗口的真实渲染内容，`SetCursorPos`+`mouse_event` 与 `WM_CHAR`/`WM_SETTEXT` 都能驱动 UI。

## 一、环境与能力（已实测）

| 项 | 结果 |
| --- | --- |
| 交互桌面 | 有（session 1，UserInteractive=True） |
| 屏幕 | 4480×1440（双屏，主屏 2560×1440） |
| A′ 启动 | **成功**，窗口句柄有效，`Responding=True`，15 线程 |
| 屏幕捕获 | **可用**，`PrintWindow(flags=2)` 抓被遮挡窗口内容正确 |
| 鼠标注入 | **可用**，`SetCursorPos` + `mouse_event` 生效并触发真实 UI 变化 |
| 键盘注入 | **可用**，`keybd_event`/`SendInput` 可送达 |
| 控件级文本 | **可用**，`WM_SETTEXT`/`WM_GETTEXT` 直接读写 Edit 控件 |
| 管理员权限 | **无**（`IsAdmin=False`）→ `wpr`/ProcMon 不可用 |
| ffmpeg / flac / sox | **均缺失** |

### 1.1 为什么第一轮的 `PrintWindow` 结论是错的

第一轮记录「`PrintWindow` 会返回静态缓存位图」。本轮实测：`PrintWindow` 的第一个参数 `nFlags` 决定行为——

| flags | 行为 |
| --- | --- |
| `0` | 旧式抓取，**确实可能返回陈旧内容** |
| `2`（`PW_RENDERFULLCONTENT`） | **强制重绘后抓取**，对 DWM 合成的窗口有效 |

本轮全部截图都用 `flags=2`，抓到的内容与当前 UI 状态一致（见 §二 的 17 张查询结果图，每张标题都带正确的 `(N results)`）。

## 二、Q1 检索规则完整链

### 2.1 实验装置

- **夹具**：20 条 FLAC，20 条各自带唯一编号与可核对标签（`01`–`20`）。
- **构造**：覆盖多值艺人（`SpmQ3;Bystander`、`A;SpmQ3;B`、`Guest;SpmQ3`）、多值流派（`Rock;Pop`、`Pop;Jazz`）、缺字段（无 GENRE / 无 ALBUM / 无 ARTIST）、诱饵（`SpmQ` 近似名、`spmq3` 大小写、`X-SpmQ3-Y` 包含名、`Classic Rock` 流派）。
- **标签写入**：自研最小 FLAC Vorbis-comment 写入器（`.rea-analysis/phase3/run-20261117-p3a/scripts/flac_tags.py`），**已验证音频流与 STREAMINFO 逐字节不变**。
- **入口**：A′ 的 `Library → Search` 打开 `Playlist Search` 对话框，`WM_SETTEXT` 写入查询，读取窗口标题中的 `(N results)` 作为结果计数。

### 2.2 17 条主查询实测结果

| ID | 查询 | 结果数 |
| --- | --- | ---: |
| Q01 | `ARTIST IS SpmQ3` | 11 |
| Q02 | `GENRE IS Rock` | 14 |
| Q03 | `GENRE IS Rock AND ARTIST IS SpmQ3` | 5 |
| Q04 | `GENRE HAS Rock AND ARTIST HAS SpmQ3` | 11 |
| Q05 | `GENRE IS Rock OR GENRE IS Jazz` | 16 |
| Q06 | `GENRE HAS Rock AND NOT ARTIST HAS Decoy` | 14 |
| Q07 | `GENRE MISSING` | 1 |
| Q08 | `ALBUM MISSING` | 1 |
| Q09 | `ARTIST HAS SpmQ3 AND ALBUM HAS Phase3` | 5 |
| Q10 | `(GENRE IS Rock OR GENRE IS Jazz) AND ARTIST IS SpmQ3` | 7 |
| Q11 | `ALL` | **20** |
| Q12 | `NONE` | **0** |
| Q13 | `TITLE HAS Rock` | 8 |
| Q14 | `GENRE IS Classic Rock` | 1 |
| Q15 | `ARTIST IS spmq3` | 12 |
| Q16 | `GENRE IS Rock AND`（语法不完整） | 0 |
| Q17 | `BOGUSOP Rock`（未知运算符） | 0 |

### 2.3 18 条判别性探针

| ID | 查询 | 结果数 | 用来判定的问题 |
| --- | --- | ---: | --- |
| QT01 | `ARTIST IS SpmQ3;Bystander` | 1 | `IS` 是否接受整串（多值拼接后） |
| QT02 | `ARTIST IS Bystander` | **0** | 多值**第二值**能否被 `IS` 命中 |
| QT03 | `ARTIST HAS Bystander` | **1** | 但 `HAS` 能命中 |
| QT04 | `ARTIST IS Guest` | **0** | 同上，另一个多值样本 |
| QT05 | `ARTIST HAS Guest` | 1 | — |
| QT06 | `ARTIST IS SpmQ` | 1 | `IS` 是否子串匹配 |
| QT07 | `ARTIST IS spmq3` | **12** | 大小写敏感性 |
| QT08 | `ARTIST IS SpmQ3` | 11 | 与 QT07 对照 |
| QT09 | `GENRE IS Rock;Pop` | 1 | 流派整串 |
| QT10 | `GENRE IS Pop` | **0** | 多值第二值 |
| QT11 | `GENRE HAS Pop` | **2** | `HAS` 命中 |
| QT12 | `ARTIST IS X-SpmQ3-Y` | 1 | 包含名整值 |
| QT13 | `TITLE IS Second Rock` | 1 | 含空格值 |
| QT14 | `ALBUM IS Mixed` | 2 | — |
| QT15 | `ARTIST PRESENT` | 19 | — |
| QT16 | `ARTIST MISSING` | 1 | 与 PRESENT 互补 |
| QT17 | `ARTIST IS A` | **0** | 多值中的单字母值 |
| QT18 | `ARTIST IS B` | **0** | 同上 |

### 2.4 由实测推出的语义（不是推断）

**（1）`IS` 只比较「值的整体」，不是逐值；`HAS` 才是子串匹配。**

| 曲目 | ARTIST 标签 | `ARTIST IS SpmQ3` | `ARTIST IS Bystander` | `ARTIST HAS Bystander` |
| --- | --- | --- | --- | --- |
| 01–03 | `SpmQ3` | 命中 | — | — |
| 04 | `SpmQ3;Bystander` | **命中** | **不命中** | **命中** |
| 05 | `Guest;SpmQ3` | **命中** | — | — |
| 17 | `A;SpmQ3;B` | **命中** | — | — |

关键：04 的 `SpmQ3;Bystander` 被 `IS SpmQ3` 命中但**不被** `IS Bystander` 命中。
`17` 的 `A;SpmQ3;B` 被 `IS SpmQ3` 命中但 `IS A`、`IS B` 都不命中。

**这说明 `IS` 在多值字段上命中的是「第一个值」或「分号拼接串的某个等价形式」，而不是任意一个值。**
`HAS` 则对整串做子串匹配，所以能命中任意位置。

> **这与第二轮从官方文档推出的结论不同。** 第二轮写「`IS` 在单值层比较，多值逐值」。实测是：**多值不是逐值命中 `IS`**。
> 这一点直接影响 SpMusic 若要实现查询语法时的多值处理设计。

**（2）`IS` 大小写不敏感，且大小写会影响结果数量。**

`ARTIST IS spmq3` = 12，`ARTIST IS SpmQ3` = 11。差的那 1 条是第 11 首（ARTIST 恰为小写 `spmq3`，**单值**）。

这个反差很值得注意：**单值 `spmq3` 只被小写查询命中，而多值里的 `SpmQ3` 只被大写查询命中**。
说明 `IS` 的匹配既不区分大小写地比较，又对「值在字段中的位置」敏感——**推断**为「比较首个值的规范化形式」，但本轮未做到指令级确认。

**（3）`PRESENT` / `MISSING` 语义正确。**
`ARTIST PRESENT` = 19，`ARTIST MISSING` = 1，两者互补等于 20。

**（4）`ALL` / `NONE` 确实存在于 2.24.6 且行为正确。**
`ALL` = 20（全部），`NONE` = 0。**这从运行侧验证了第二轮「2.24.6 已有表项」的静态结论。**

**（5）非法语法静默返回 0，不弹错误。**
`GENRE IS Rock AND`（缺右操作数）与 `BOGUSOP Rock`（未知运算符）都返回 0 结果，界面上没有错误提示。

## 三、第二轮勘误：查询分发表应为 12 字节步长

计划 §第二轮勘误第 1 条要求按 12 字节复核。**实测确认计划正确，第二轮错了。**

### 3.1 算术依据

`0x27BE18 - 0x27BE0C = 0xC = 12 字节`。

第二轮按 16 字节读，把**下一条目的起始 dword** 误当成了当前项的 `+0x0C` 字段，据此推导出一列错误的「等价关键字」（`SORT→ORDER`、`NOT→HAS`、`EQUAL→GREATER`、`PRESENT→BEFORE`、`DURING→ALL`）。**该列全部作废。**

### 3.2 按 12 字节重列（22 项）

| file 偏移 | 关键字 |
| --- | --- |
| `0x27BD3C` | `SORT` |
| `0x27BD48` | `ORDER` |
| `0x27BD54` | `OR` |
| `0x27BD60` | `AND` |
| `0x27BD6C` | `NOT` |
| `0x27BD78` | `HAS` |
| `0x27BD84` | `IS` |
| `0x27BD90` | `IST` |
| `0x27BD9C` | `EQUAL` |
| `0x27BDA8` | `GREATER` |
| `0x27BDB4` | `LESS` |
| `0x27BDC0` | `MISSING` |
| `0x27BDCC` | `PRESENT` |
| `0x27BDD8` | `BEFORE` |
| `0x27BDE4` | `AFTER` |
| `0x27BDF0` | `SINCE` |
| `0x27BDFC` | `DURING` |
| `0x27BE08` → 引用 @`0x27BE0C` | `ALL` |
| `0x27BE14` → 引用 @`0x27BE18` | `NONE` |
| `0x27BE20` | `%first_played%` |
| `0x27BE2C` | `%last_played%` |
| `0x27BE38` | `%added_timestamp%` |

**16 字节读法只覆盖 5 项且列错；12 字节读法得到 22 项。** 前三项之后的 `%first_played%` / `%last_played%` / `%added_timestamp%` 是**时间表达式的字段名表**，不是运算符——说明这条表实际是「关键字 → 处理入口」的混合分派表，其边界需要更细致的判定。

> **诚实标注**：本轮只做到「按 12 字节重列得到 22 项自洽表」。「这 22 项构成一张完整分派表」仍是**推断**，因为末尾三项看起来属于另一类。运行侧只能用 `ALL`/`NONE` 是否生效来间接验证，见 §二(4)。

### 3.3 修正后的「2.26 新增 ALL」表述

| 层面 | 结论 |
| --- | --- |
| 文档 | `ALL` 于 **2.26.2** 才写进 `Query Syntax Help.html` |
| 实现 | A′ **2.24.6 已有表项**（`0x27BE0C` 引用 `0x29D820` 的 `ALL\0`） |
| 运行 | A′ **2.24.6 实测生效**（`ALL` = 20、`NONE` = 0） |

**正确表述**：「A′ 2.24.6 样本已有 `ALL`/`NONE` 表项且实测生效；2.26.2 才补文档。」

## 四、保留了哪些、没做到哪些

### 4.1 已完成

| 项 | 状态 |
| --- | --- |
| 阶段 0 环境验证 | **完成**（真实桌面、录屏、输入注入全部验证通过） |
| Q1 检索规则链 | **部分完成**：17 条主查询 + 18 条探针，全部有实测结果与截图 |
| 查询分发表 12 字节勘误 | **完成** |
| L1 标签编辑（单文件、不改音频） | **完成**（音频区与 STREAMINFO 逐字节未变） |
| 第二轮「ALL 实现早于文档」结论 | **运行侧确认** |

### 4.2 受阻（需交接）

| 项 | 受阻原因 | 需要什么 |
| --- | --- | --- |
| 进程级 I/O trace（L1 核心） | **无管理员权限**，`wpr`/ProcMon 均不可用；`Get-Process` 的 IO 计数返回空 | 管理员账户，或外部机器用 ProcMon |
| A/B 双样本对照 | B（foobaka）启动前置条件未验证 | 需先解决 B 的 COM 依赖 |
| U1 长列表首达/回访/头图 | 需要 300 条带封面夹具 + 更长的录屏分析 | 时间与夹具 |
| A1 PCM 接缝抓样 | 无 ffmpeg、无管理员（环回录音需权限） | ffmpeg + 管理员或数字回录设备 |
| 自动播放列表全链（建规则→改标签→重启恢复） | 需要操作 `Create autoplaylist` 菜单与重启验证，本轮只做到查询层 | 继续实验 |

### 4.3 可交付外部机器的操作卡要点

**L1 进程级 I/O（需管理员）**

1. 下载 Process Monitor，管理员运行。
2. Filter: `Process Name is foobar2000.exe`，`Path contains <测试根>`，`Operation is ReadFile`。
3. 清空日志 → 在 foobar2000 里对一首曲目改标签 → 停止捕获。
4. 导出 CSV，按 `Time of Day` 对齐操作时刻，统计每个文件被 `ReadFile` 的字节数与次数。
5. 判据：**只有被改的那一首出现「改标签后的完整内容读取」**，其余 19 首不出现内容读。

**A1 PCM 接缝（需 ffmpeg + 环回）**

1. 安装 ffmpeg（含 wasapi 支持）。
2. 播放 `p1-seam-fixture/chirp.flac` 整轨，同时 `ffmpeg -f wasapi -i default -c:a pcm_s16le out.wav`。
3. 用 `chirp_dec.wav` 的 data 区做基准，按定位标记对齐，比对接缝窗口的丢样/重样/静音。
4. 再分别测 `A.flac`+`B.flac` 自然续播与 `seam.cue` 的 CUE 续播，各三次。

## 五、证据强度

| 结论 | 强度 | 依据 |
| --- | --- | --- |
| 交互桌面与输入注入可用 | **强** | 实测：点击使 UI 变化、`WM_SETTEXT` 写入并触发搜索 |
| `PrintWindow(2)` 可抓被遮挡窗口 | **强** | 17 张查询截图内容与状态一致 |
| `IS` 不是逐值命中多值字段 | **强** | QT02/QT04/QT10/QT17/QT18 五条独立对照 |
| `IS` 大小写不敏感但影响结果数 | **强** | QT07=12 vs QT08=11 |
| `ALL`/`NONE` 在 2.24.6 生效 | **强** | Q11=20、Q12=0 |
| 非法语法静默返回空 | **强** | Q16/Q17 均 0 且无错误提示 |
| 分发表 12 字节步长 | **强** | 22 项自洽，与 16 字节读法的矛盾可解释 |
| 改标签不改音频 | **强** | 改前后音频区 SHA 与 STREAMINFO 完全相同 |
| 多值 `IS` 的**精确**匹配形式 | **中（推断）** | 只知「不是逐值」，具体是首值还是拼接未到指令级 |
| 进程级读取次数 | **未知** | 无管理员权限，未采集 |

## 六、对第二轮文档的修改清单

| 文档 | 位置 | 原表述 | 修正为 |
| --- | --- | --- | --- |
| `foobar2000-search-mechanisms.md` | §一 分发表 | 「每项 16 字节，`+0x0C` 是等价关键字串」 | **每项 12 字节**；删除「别名」列；22 项完整表 |
| 同上 | §三 约束 2 | 「`IS` 必须在单值层比较，多值逐值」 | **`IS` 不是逐值**：多值第二个值不被 `IS` 命中，只有 `HAS` 能命中（QT02/QT04/QT10 实测） |
| 同上 | §二 运算符表 | 「`ALL` 2.26 才进文档」 | 补一句「实现与运行在 2.24.6 已生效」 |
| `foobar2000-library-mechanisms.md` | §三 离线宽限 | 「28 天宽限」作为已确认行为 | 收窄为「某份 `metadb_indexes` 快照中四条 `retention` 折算为 28 天；运行时的清理时机未实测」 |
| `foobar2000-foobaka-phase-2-findings.md` | §7.6/§7.7 | 16 字节表 + 别名列 | 同 search-mechanisms 的修正 |
