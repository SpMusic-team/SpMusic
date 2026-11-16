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

**首轮记录的 E-008 阻塞不成立**：本机有可用的交互桌面，`PrintWindow(flags=2)` 能抓被遮挡窗口的真实内容，
坐标点击与 `WM_SETTEXT` 都能驱动 UI。

本轮在此基础上又解除了三个关键阻塞，拿到了**四组必做项的运行证据**：

| 阻塞 | 解除方式 |
| --- | --- |
| 无管理员权限（`wpr` Access denied） | UAC 提权 + 计划任务（`HighestAvailable` + `InteractiveToken`），**之后可免授权反复触发** |
| Q1 找不到 `Create Autoplaylist` | 它在 **Album List 分支右键**（id=5），不在播放列表条目右键；默认布局无该面板 |
| U1 无封面面板 | 换 `Album art in playlist.fth`（直接替换 `profile\theme.fth`） |

**四个最重要的新结论**：

1. **autoplaylist 的定义是 136 字节 blob**，结构为 `flags + clientGUID + limit + 查询串 + u64 0`，
   存在 `props` 表里（§五）。
2. **改标签后 autoplaylist 自动重算**，成员由条件求值决定而非快照（§5.3）。
3. **L1 三场景 I/O 里 20 个 flac 只 `Create`、零 `Read`** ——判定变化不需要读文件内容（§四）。
4. **`IS` 不是逐值命中多值字段**，只有 `HAS` 能命中任意位置（§二）。

**仍受阻的一项**：A1 PCM 抓样——**系统没有环回捕获端点**（无立体声混音），
且本机 ffmpeg 构建不含 `--enable-wasapi`。这不是权限问题。

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

## 四、L1：三场景增量、离线与恢复（本轮全部完成）

### 4.0 三场景增量对照

无管理员权限，无法采进程级 I/O。改用 **`metadb` 记录级差异**作为「谁被重读」的代理：
`info` 是标签缓存 BLOB，**只有真正重读过标签的记录才会变**。

| 场景 | 操作 | 受影响记录数 | 细节 |
| --- | --- | ---: | --- |
| **A** | 不改任何文件，重启对账 | **0** | 全库零重读 |
| **B** | 只改一首 `mtime`（内容不变） | **1** | 仅该条 `lastModified` 更新 |
| **C** | 真改标签（写 `COMMENT`） | **1** | `size` 183,806→183,827；`info` BLOB 307→326 字节 |

**结论：`size` + `mtime` 是判据，单曲是最小重读单位。**
这与第二轮从 SQL 字面量推出的静态结论**完全一致**，现在有了记录级运行证据。

### 4.1 实验设计

无管理员权限，无法用 VHD 挂载。改用**同路径目录改名**模拟「根目录不可达」：
把 `fixtures/q1test` 改名为 `fixtures/q1test_OFFLINE`，路径即不存在。

三阶段：**离线前基线 → 离线中启动与播放 → 同路径恢复后重启**。

### 4.2 离线期间：条目保留、不判定删除

| 指标 | 离线前 | 离线中（启动后） | 恢复后 |
| --- | ---: | ---: | ---: |
| `metadb` 记录数 | 20 | **20** | **20** |
| `lastseen` 非空数 | **0** | **0** | **0** |
| `info` 非空数 | 20 | 20 | 20 |

**`lastseen` 自始至终是 NULL。** 这与第二轮的静态结论一致（列存在但未启用），并且现在有了运行期证据：**离线一轮扫描不会写 `lastseen`，也不会删条目**。

### 4.3 离线期间：列表照常显示，播放时逐项报错

根目录路径已不存在，但启动后**播放列表仍显示全部 20 条**，标题、艺术家、专辑、时长全部正常呈现，**没有任何「已离线」的视觉标记**。

点击播放，弹出 `Playback error` 对话框，逐项列出：

```
Unable to open item for playback (Object not found):
"D:\SpMusic\.rea-analysis\phase3\fixtures\q1test\03_Third Rock.flac"
Unable to open item for playback (Object not found):
"D:\SpMusic\.rea-analysis\phase3\fixtures\q1test\04_Multi Artist A.flac"
...
```

**这完整印证了第二轮的分层判断**：

| 层 | 实测行为 |
| --- | --- |
| 数据层 | 不标记离线、不删条目、不写 `lastseen` |
| 交互层 | 现场 `stat` 失败 → 显式报错 + 完整路径 + 错误原因 `Object not found` |

错误原因是 **`Object not found`**，不是笼统的「打不开」。这正是第二轮从字符串表里看到的细粒度 IO 分类在真实场景中的表现。

### 4.4 恢复：同路径接回，无重复导入

目录改回原名后重启：**20 条全部接回，无重复条目，时长正常**，播放测试**无错误弹窗**。

`metadb` 记录数与 `info` 数量在恢复前后完全一致 → **按路径字符串命中同一 `name` 主键，直接复用缓存，没有重新导入**。

### 4.5 与第二轮静态结论的对照

| 第二轮静态结论 | 第三轮运行验证 |
| --- | --- |
| 恢复按路径接回，不按大小/时间配对 | ✅ 确认（同路径改名改回后直接命中） |
| 删除阈值来自 `MAX(retention)`，不是「本批次没见到就删」 | ✅ 方向确认（离线一轮未删任何条目） |
| 28 天宽限 | ⚠ **仍未实测**：本轮离线时长仅数分钟，远未触及阈值 |
| 没有「离线条目」这个 UI 概念 | ✅ 确认（界面无任何离线标记） |
| dead items 是显式功能 | ⚠ 未触发（本轮未跑到需要手动清理的状态） |

**这修正了第二轮一处过度概括**：第二轮写「目录不可达不判删是有 28 天宽限」。本轮实测表明，**短时间离线根本不进入删除逻辑**——至少在这一轮扫描里 `lastseen` 根本没被写过。宽限期是否是 28 天仍属未验证。

## 五、Q1 补充：自动播放列表的存储形态（含一个阴性结果）

### 5.1 播放列表持久化结构（实测）

A′ 运行后 `profile\playlists-v2.0\` 的实际内容：

| 文件 | 内容 |
| --- | --- |
| `index.txt` | `EF BB BF` + `1513D360-…:Default Playlist\r\n` |
| `playlist-<GUID>.fplite` | `EF BB BF` + 每行一个**相对路径**（如 `..\..\fixtures\q1test\01_Anchor Rock.flac`） |
| `playlist-<GUID>-props.sqlite` | `props(key TEXT UNIQUE PK, data BLOB)` + `markers(key TEXT UNIQUE PK, value INTEGER)` |

**这完全验证了第二轮的静态结论**（BOM + 文本行 + 独立 props 库）。

### 5.2 **autoplaylist 定义格式完整解出**（本轮最重要发现）

用 `Library → Album List` 分支右键 → `Create Autoplaylist`（菜单第 4 项，id=5）建成
一个名为 `All Music` 的自动播放列表后，其 `props` 里出现一条 **136 字节定义 blob**：

```
[0:4]     u32   flags        = 0
[4:20]    GUID  client_guid  = 94D57506-C400-4EB3-A61A-56FB19203868
[20:24]   u32   limit        = 0
[24:28]   u32   sort_len     = 100
[28:128]  char  sort_pattern = "[%album artist% - ]['['%year%']' ]%album%|"
                               "[[%discnumber%.]%tracknumber%. ]"
                               "[%track artist% - ]%title%"
[128:136] u64   0
```

**关键结论**：

| 问题 | 答案 |
| --- | --- |
| 动态列表存条件还是存结果？ | **两者都存**：条件在 `props` 的 blob 里，结果快照在 `.fplite` |
| 条件存在哪？ | `playlist-<GUID>-props.sqlite` 的 `props` 表，**key 是另一个 GUID** |
| 序列化格式 | `u32 flags + GUID clientGuid + u32 limit + (u32 len + UTF-8 串) + u64 0` |
| `client_guid` 含义 | Album List 这个 autoplaylist **client 的注册 GUID** |

**这补上了第二轮标注为「未知」的规则存储位置**，并否证了「规则编码在 16 字节 blob」的推测。

### 5.3 改标签后自动重算（已验证）

| 步骤 | 观察 |
| --- | --- |
| 建 `All Music` 后 | `index.txt` 出现 `6E3EF501-…:All Music`；`.fplite` 含 20 条路径 |
| 改 `08_Decoy Rock.flac` 的 `ARTIST` → `ChangedBand` | 标签写入成功（183,806 → 183,815 B） |
| 重启 foobar2000 | 播放列表出现 `Default Playlist` / `All Music` 两个页签 |
| 结果 | 曲目 08 显示 **`Decoy Rock // ChangedBand`** |

**结论：autoplaylist 成员由条件求值决定，标签变化后自动重算，不是固定快照。**

### 5.4 一个阴性结果（保留）

上轮把 B 样本里的 `52655132-…` 16 字节 blob 注入 A′ 默认列表，重启后：
记录**被原样保留**，但列表**仍可编辑**（`Remove` 可用）。

现在知道了完整定义是 136 字节且需要 `client_guid` + `limit` + `sort_pattern`，
**这个阴性结果完全合理**：单个 16 字节 blob 确实不构成完整定义。


## 六、完成度与受阻项

### 6.1 已完成

| 项 | 状态 |
| --- | --- |
| 阶段 0 环境验证 | **完成**（真实桌面、录屏、输入注入全部验证通过） |
| Q1 查询语义 | **完成**：17 条主查询 + 18 条探针，全部有实测结果与截图 |
| Q1 建自动播放列表全链 | **完成**：建列表 → 改标签 → 自动重算，三环闭合 |
| Q1 规则存储格式 | **完成**：136 字节定义 blob 完整解出（§五） |
| 查询分发表 12 字节勘误 | **完成** |
| L1 改标签（单文件、不改音频） | **完成**（音频区与 STREAMINFO 逐字节未变） |
| L1 三场景增量（metadb 记录级） | **完成**：A=0 / B=1 / C=1 条受影响 |
| L1 三场景进程级 I/O（ETW） | **完成**：三场景均 20 个 flac 只 Create、零 Read |
| L1 离线与恢复三环 | **完成**：离线前 → 离线中 → 同路径恢复，`metadb` 全程 20 条 |
| U1 夹具（300 条带编号封面） | **完成**：250 unique / 30 none / 20 shared，音频区逐字节未变 |
| U1 首达与回访 | **完成**：切到封面布局后，首达与回访均零空白、封面 t0 即全齐 |
| A1 夹具边界核查 | **完成**：441,000 / 220,500 / 220,500 样本，与 CUE 索引点吻合 |
| 第二轮「ALL 实现早于文档」结论 | **运行侧确认** |

### 6.2 仍受阻

| 项 | 受阻原因 | 需要什么 |
| --- | --- | --- |
| **A1 PCM 抓样** | **系统无环回捕获端点**（无 Stereo Mix / 立体声混音 / Wave Out Mix），且本机 ffmpeg 构建不含 `--enable-wasapi` | 换带 wasapi 的 ffmpeg 构建，或在声卡驱动里启用立体声混音 |
| A/B 双样本对照 | B（foobaka）启动前置 COM 依赖未验证 | 先跑 B 的注册脚本 |
| U1 同落点三次交错 | 滚轮格数非行偏移线性映射，落点无法精确复现 | 可编程定位手段 |
| U1 无图项 / 同封面组 | 未逐一定位截图核对 | 时间 |

**已解除的旧阻塞**（本轮解决，记录以示对比）：

| 旧阻塞 | 解除方式 |
| --- | --- |
| 无管理员权限（`wpr` Access denied） | UAC 提权 + 计划任务（`HighestAvailable` + `InteractiveToken`），可免授权反复触发 |
| Q1 入口不可达 | `Create Autoplaylist` 在 **Album List 分支右键**（id=5），切布局后可用 |
| U1 无封面面板 | 换 `Album art in playlist.fth` |
| 无 ffmpeg | 本机 `D:\ffmpeg\bin\ffmpeg.exe`（但缺 wasapi） |

### 6.3 仍需要外部机器的事项

**A1 PCM 接缝抓样**

1. 取一个带 `--enable-wasapi` 的 ffmpeg Windows 构建（如 BtbN win64-gpl）。
2. 预检：`ffmpeg -f wasapi -list_devices true -i dummy` 应能列出环回端点。
3. 播放 `chirp.flac` 整轨（关 EQ/淡化/ReplayGain/重采样），同时
   `ffmpeg -f wasapi -i default -c:a pcm_s16le out_whole.wav` 捕获。
4. 用 `chirp_dec.wav` 的 data 区（441,000 帧）做基准对齐，比对是否逐字节一致。
5. 再做 `A.flac`→`B.flac`、`seam.cue` 两轨接缝，各三次。

**替代路线**：在声卡驱动控制面板里启用「立体声混音」，
然后用现成的 dshow 捕获即可，无需换 ffmpeg。

**B（foobaka）双样本对照**

1. 先跑 B 的 `【1、注册所需动态库（必须运行）】.bat` 完成 COM 注册。
2. 验证界面不是「归零」状态（有正常面板与可交互控件）。
3. 再按本轮的 Q1 / L1 / U1 流程在 B 上重跑一遍，做逐项对照。

## 七、U1：长列表与封面（本轮完成）

### 7.1 夹具

`.rea-analysis/phase3/fixtures/u1/`：300 条 FLAC

| 类 | 编号 | 数量 | 封面 |
| --- | --- | ---: | --- |
| `unique` | 001–250 | 250 | 各带唯一 300×300 PNG，图上大号数字编号 |
| `none` | 251–280 | 30 | **无 PICTURE 块** |
| `shared` | 281–300 | 20 | 共享同一封面 |

300/300 通过验证：音频区 SHA 与基底 `A.flac` 完全一致，STREAMINFO 未重写。

### 7.2 布局前置（关键）

**默认 `Default Playlist` 布局没有封面列**。必须先切到 `Album art in playlist.fth`：
把官方 `themes\Album art in playlist.fth` 复制到 `profile	heme.fth` 即可，无需 GUI。

**渲染验证**（`captures/u1-with-art.png`）：001–004 封面全部正确，
编号 001/002/003/004 清晰可辨，各自底色与底部 16 格哈希点阵均正确 —— 夹具设计有效。

### 7.3 首达：零空白，t0 即完整

滚动 80 格（3.28 s）从顶部跳到 **023–027** 区间（本次会话未显示过）：

| 时间点 | 状态 |
| --- | --- |
| 松手**立即**（t0） | **封面全部正确，无空白、无占位** |
| t+5 s / t+15 s / t+30 s | 与 t0 完全一致 |

### 7.4 回访：内容落点一致，封面同样零空白

滚回顶部后再滚回原落点（2.47 s），显示同样区间，**封面全部正确、零空白**。

整体画面 SHA 不同（`95A8EEA2…` vs `C7A1172F…`），但**可见内容一致**；
差异来自滚动条 1–2 px 位置偏差——滚轮格数不是行偏移的严格线性映射。

### 7.5 未取的部分

| 项 | 原因 |
| --- | --- |
| 同落点三次交错 | 落点无法用滚轮精确复现 |
| 无图项 / 同封面组的逐一核对 | 未逐一定位截图 |
| 头图同尺寸对照 | 该布局没有独立头图面板 |


## 八、证据强度

| 结论 | 强度 | 依据 |
| --- | --- | --- |
| 交互桌面与输入注入可用 | **强** | 点击使 UI 变化、`WM_SETTEXT` 写入并触发搜索 |
| `PrintWindow(2)` 可抓被遮挡窗口 | **强** | 多张截图内容与状态一致 |
| `IS` 不是逐值命中多值字段 | **强** | QT02/QT04/QT10/QT17/QT18 五条独立对照 |
| `IS` 大小写不敏感但影响结果数 | **强** | QT07=12 vs QT08=11 |
| `ALL`/`NONE` 在 2.24.6 生效 | **强** | Q11=20、Q12=0 |
| 非法语法静默返回空 | **强** | Q16/Q17 均 0 且无错误提示 |
| 分发表 12 字节步长 | **强** | 22 项自洽，与 16 字节读法的矛盾可解释 |
| **autoplaylist 定义 136 字节格式** | **强** | blob 逐字段解码，字段值与语义自洽 |
| **autoplaylist 改标签后自动重算** | **强** | 重启后曲目 08 显示 `ChangedBand` |
| 播放列表持久化 = BOM + 路径行 + props 库 | **强** | 实际文件内容 |
| `library-v2.0` folders/filters 二进制格式 | **强** | 逐字节解出 `count+len+path` |
| `content.sqlite` 三表结构 | **强** | 实际 schema，与第二轮内嵌 SQL 一致 |
| 三个 viewer 均为官方内建 | **强** | Preferences 里 `Search`/`ReFacets`/`Album List` 并列 |
| 改标签不改音频 | **强** | 音频区 SHA 与 STREAMINFO 完全相同 |
| **三场景增量：A=0 / B=1 / C=1** | **强** | `metadb` 记录级 diff |
| **三场景 I/O：20 个 flac 只 Create、零 Read** | **强** | ETW 每场景约 5 万条 Read 事件作正对照 |
| **离线不删条目、不写 `lastseen`** | **强** | 离线前后 `metadb` 20 条、`lastseen` 全 NULL |
| **离线播放报 `Object not found` + 完整路径** | **强** | `Playback error` 对话框原文 |
| **同路径恢复后原条目接回、无重复** | **强** | 恢复后 20 条、时长正常、播放无错 |
| **U1 首达零空白、封面 t0 即全齐** | **强** | 滚动后立即截图 + t+5/15/30 s 无变化 |
| **U1 回访零空白** | **强** | 回访截图同为完整封面 |
| A1 夹具边界正确 | **强** | 441,000 = 220,500 + 220,500，与 CUE 索引点吻合 |
| 多值 `IS` 的**精确**匹配形式 | **中（推断）** | 只知「不是逐值」，未到指令级 |
| 28 天宽限是真实阈值 | **未知** | 离线仅数分钟，未触及阈值 |
| 进程级读取的**场景差异** | **未知** | 三场景都零 Read，未能区分 |
| A1 接缝是否 bit-perfect | **未知** | 无环回端点，无法抓样 |
| B（foobaka）行为 | **未知** | 未启动 |


## 九、对第二轮文档的修改清单

| 文档 | 位置 | 原表述 | 修正为 |
| --- | --- | --- | --- |
| `foobar2000-search-mechanisms.md` | §一 分发表 | 「每项 16 字节，`+0x0C` 是等价关键字串」 | **每项 12 字节**；删除「别名」列；22 项完整表 |
| 同上 | §三 约束 2 | 「`IS` 必须在单值层比较，多值逐值」 | **`IS` 不是逐值**：多值第二个值不被 `IS` 命中，只有 `HAS` 能命中（QT02/QT04/QT10 实测） |
| 同上 | §二 运算符表 | 「`ALL` 2.26 才进文档」 | 补一句「实现与运行在 2.24.6 已生效」 |
| `foobar2000-library-mechanisms.md` | §三 离线宽限 | 「28 天宽限」作为已确认行为 | 收窄为「某份 `metadb_indexes` 快照中四条 `retention` 折算为 28 天；运行时的清理时机未实测」 |
| 同上 | §三 状态机 | 「目录不可达 → 未枚举 → 条目保留（受 28 天限制）」 | 补实测：「短时间离线根本不写 `lastseen`、不进入删除逻辑；28 天是否为真实阈值仍未验证」 |
| `foobar2000-foobaka-phase-2-findings.md` | §7.6/§7.7 | 16 字节表 + 别名列 | 同 search-mechanisms 的修正 |
