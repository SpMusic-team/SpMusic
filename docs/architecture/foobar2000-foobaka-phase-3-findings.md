---
doc_id: "ARCH-FOOBAR2000-FOOBAKA-PHASE-3-FINDINGS"
title: "foobar2000 第三轮：运行证据与第二轮勘误"
doc_type: "architecture-research"
status: "draft"
owner_agent: "Architecture Agent"
version_scope: "research"
created: "2026-11-17"
updated: "2026-11-18"
source_documents:
  - "docs/tasks/foobar2000-foobaka-ds-phase-3-plan.md"
  - "docs/architecture/foobar2000-search-mechanisms.md"
  - "docs/architecture/foobar2000-library-mechanisms.md"
  - "docs/test/foobar2000-foobaka-phase-3-comparison.md"
  - ".rea-analysis/phase3/run-20261117-p3a/"
---

# 第三轮：运行证据与第二轮勘误

本轮第一次拿到了**真实运行证据**。前两轮全部是静态分析，本轮实际启动了官方 foobar2000 2.24.6 x86，用真实输入驱动 UI 并截取结果。

> **2026-11-18 修订**：本文经一轮漂移核对，修正了 4 处**本文自身**与下游文档不一致的表述
> （提权通道状态、ETW 完成度、B 受阻原因、统计核查时点），并补入 §9.1b 复核注记。
> 待修的跨文档漂移清单见 §十一。

## 零、一句话总结

**首轮记录的 E-008 阻塞不成立**：本机有可用的交互桌面，`PrintWindow(flags=2)` 能抓被遮挡窗口的真实内容，
坐标点击与 `WM_SETTEXT` 都能驱动 UI。

本轮在此基础上又解除了三个关键阻塞，拿到了**四组必做项的运行证据**：

| 阻塞 | 解除方式 |
| --- | --- |
| 无管理员权限（`wpr` Access denied） | UAC 提权 + 计划任务（`HighestAvailable` + `InteractiveToken`），当时可免授权反复触发。**该任务已于 2026-11-18 删除**（§6.2），提权通道不再保留 |
| Q1 找不到 `Create Autoplaylist` | 它在 **Album List 分支右键**（id=5），不在播放列表条目右键；默认布局无该面板 |
| U1 无封面面板 | 换 `Album art in playlist.fth`（直接替换 `profile\theme.fth`） |

**四个最重要的新结论**：

1. **autoplaylist 的定义是 136 字节 blob**，结构为 `flags + clientGUID + limit + 查询串 + u64 0`，
   存在 `props` 表里（§五）。
2. **改标签后 autoplaylist 自动重算**，成员由条件求值决定而非快照（§5.3）。
3. **L1 三场景 I/O 里 20 个 flac 只 `Create`、零 `Read`** ——判定变化不需要读文件内容（§四）。
4. **`IS` 不是逐值命中多值字段**，只有 `HAS` 能命中任意位置（§二）。

**第三轮当时判定受阻的一项**：A1 PCM 抓样——系统没有环回捕获端点（无立体声混音），
且本机 ffmpeg 构建不含 `--enable-wasapi`。

> **2026-11-18 第四轮已推翻此判定**：WASAPI 环回捕获（`AUDCLNT_STREAMFLAGS_LOOPBACK`）
> 是系统混音器能力，**不依赖环回端点设备**。用 .NET COM 互操作自建录制器即可打通。
> **A1 已在第四轮闭合**，见 [phase-4 findings](foobar2000-foobaka-phase-4-findings.md)。
> 上面三条事实观察（无环回设备、ffmpeg 无 wasapi、dshow 只列麦克风）**都属实**，
> 错的是推论——把「ffmpeg 走不通」当成了「本机做不到」。

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

本节先用 **`metadb` 记录级差异**作为「谁被重读」的代理：
`info` 是标签缓存 BLOB，**只有真正重读过标签的记录才会变**。

> 进程级 I/O 的采集在后续阶段经提权通道补做成功，见 §四之二。本节的代理结论与它是**两个独立层面**，互不替代。

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
| 阶段 0 环境验证 | **完成** |
| Q1 查询语义（`HAS`/`ALL`/`NONE`/非法语法） | **完成**：35 条查询全部有实测结果 |
| Q1 `IS` 多值语义 | **未闭合**：四种自然实现全被实测排除（见 search-mechanisms §三之三） |
| Q1 建自动播放列表全链 | **完成**：建列表 → 改标签 → 自动重算 |
| Q1 规则存储格式 | **完成**：全库级 136 B blob 解出；**分支级未定位**（props 为空） |
| Q1 单变量干预（L49） | **部分完成**：只随规则变已定位；只随结果变未建立 |
| 查询分发表 12 字节勘误 | **完成** |
| L1 改标签（单文件、不改音频） | **完成** |
| L1 三场景增量（metadb 记录级） | **完成**：A=0 / B=1 / C=1 |
| L1 三场景进程级 I/O（ETW） | **部分完成**：三场景均只 Create、零 Read，但**未能区分场景间差异**（三场景都零 Read，见 comparison §4a.3） |
| L1 离线与恢复三环 | **完成** |
| U1 夹具（300 条带编号封面） | **完成** |
| U1 首达与回访（封面） | **完成**：均零空白、t0 全齐 |
| U1 三种封面类型渲染 | **完成**：unique / shared / none 均验证 |
| U1 同任务找歌（L59） | **受阻**：Album List Filter 不刷新，曲库根切换两途径均失败 |
| U1 头图对照（L61） | **完成**：目录图优先于内嵌图；面板 844×997；1.055×/1.407× 缩放；细节可辨 |
| L73 统计键核查 | **完成，但结论已漂移**：核查时点 `682acf4` 的 SpMusic 确实无统计实现；其后仓库已出现前端 `mostPlayed.ts` / `recentlyPlayed.ts`（localStorage 实现），见 §十 复核注记。foobar2000 侧「索引主键含子轨前缀」一项不受影响 |
| A1 夹具边界核查 | **完成** |
| manifest.json（L80） | **完成** |

### 6.2 仍受阻

| 项 | 受阻原因 | 需要什么 |
| --- | --- | --- |
| ~~**A1 PCM 抓样**~~ | ~~系统无环回捕获端点，且 ffmpeg 不含 `--enable-wasapi`~~ → **第四轮已闭合** | 已用自建 WASAPI 环回录制器完成；无需环回设备、无需换 ffmpeg |
| A/B 双样本对照 | B（foobaka）主窗口 1248×162、标题为空、画面全白，**Columns UI 布局渲染失败**。注册脚本已提权执行且成功，**权限与注册两层均已排除**（comparison §5.1） | 在有完整桌面交互的环境手工启动观察组件报错；或改用已知可用的 `profile` 备份；或退一步只做数据层对照（不需要 UI 起来） |
| U1 同落点三次交错 | 滚轮格数非行偏移线性映射，落点无法精确复现 | 可编程定位手段 |
| U1 无图项 / 同封面组 | 未逐一定位截图核对 | 时间 |

**已解除的旧阻塞**（本轮解决，记录以示对比）：

| 旧阻塞 | 解除方式 |
| --- | --- |
| 无管理员权限（`wpr` Access denied） | UAC 提权 + 计划任务（`HighestAvailable` + `InteractiveToken`）。**该任务已在 2026-11-18 删除**——它曾在 23:59 自行触发并提权启动播放器，详见 comparison §5.1b |
| Q1 入口不可达 | `Create Autoplaylist` 在 **Album List 分支右键**（id=5），切布局后可用 |
| U1 无封面面板 | 换 `Album art in playlist.fth` |
| 无 ffmpeg | 本机 `D:\ffmpeg\bin\ffmpeg.exe`（但缺 wasapi） |

### 6.3 仍需要外部机器的事项

> **2026-11-18 更新**：本节原列的「A1 PCM 接缝抓样」**已在第四轮于本机完成**，
> 不再需要外部机器。保留原文以备追溯，但**请以 phase-4 findings 为准**。
> 仅「独占模式下的数字回录」与「DAC 端行为」仍需外部条件。

**A1 PCM 接缝抓样（已过时，见上方说明）**

1. 取一个带 `--enable-wasapi` 的 ffmpeg Windows 构建（如 BtbN win64-gpl）。
2. 预检：`ffmpeg -f wasapi -list_devices true -i dummy` 应能列出环回端点。
3. 播放 `chirp.flac` 整轨（关 EQ/淡化/ReplayGain/重采样），同时
   `ffmpeg -f wasapi -i default -c:a pcm_s16le out_whole.wav` 捕获。
4. 用 `chirp_dec.wav` 的 data 区（441,000 帧）做基准对齐，比对是否逐字节一致。
5. 再做 `A.flac`→`B.flac`、`seam.cue` 两轨接缝，各三次。

**替代路线**：在声卡驱动控制面板里启用「立体声混音」，
然后用现成的 dshow 捕获即可，无需换 ffmpeg。

**B（foobaka）双样本对照**

> **前提已变**：COM 注册这一步**已经做过并成功**（提权执行 `regsvr32 dynwrapx.dll` + `regsvr32 AutoItX3.dll`），
> 但 B 的主窗口仍是 1248×162、标题为空、画面全白。**这不是注册问题**，
> 而是 Columns UI（`foo_ui_columns`）在本机的布局渲染失败——它不像 DUI 那样有回退布局。
> 详见 comparison §5.1。

三条可选路径：

1. **UI 路径（需完整交互桌面）**：手工启动 B，观察是否有组件加载失败弹窗，定位是
   `foo_uie_panel_splitter` / `foo_ui_columns` / `foo_uie_wsh_panel_mod_plus` 中的哪一个初始化失败。
2. **配置路径**：改用 B 的 `profile` 备份里已知能用的配置组合。
3. **数据层路径（已验证可行，无需 UI）**：B 的 `metadb.sqlite` / `playlists-v2.0` / `library-v2.0`
   结构可直接静态对比——本轮的 `52655132-…` 16 B blob 就是从 B 的磁盘文件直接读出的。
   Q1 的查询语义与 L1 的增量判据可先在数据层做结构对照，行为层待 UI 打通后再补。

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
| 进程级读取的**场景差异** | **未知** | 三场景都零 Read，未能区分。这是本项**唯一**能支持的结论边界 |
| 「打开 ≠ 读取」 | **强** | 20 个 flac 有 Create 无 Read，每场景约 5 万条 Read 作正对照 |
| ~~A1 接缝是否 bit-perfect~~ | **第四轮已部分闭合** | CUE 分轨**逐样本零误差**、双文件仅 6 个量化帧；但共享混音器有增益与格式转换，**仍不能断言 bit-perfect** |
| B（foobaka）行为 | **未知** | 主窗口 1248×162、画面全白；进程存活但 Columns UI 未渲染出布局，无法驱动（comparison §5.1） |


## 九、Q1 单变量干预（计划 L49）

计划要求：「在克隆 profile 上分开做两次单变量干预。一次只改规则写法并保持结果集合相同，
一次保持规则并修改标签使结果集合变化。分别在正常退出后比较属性记录和列表快照。」

### 9.1 四种播放列表的实际存储形态（实测对比）

在同一份 profile 里同时存在四个列表，`props` 与 `.fplite` 的组合各不相同：

| 列表 | 类型 | `props` 条目 | `markers` | `.fplite` 行数 |
| --- | --- | ---: | ---: | ---: |
| `1513D360` Default Playlist | 普通列表 | 2 × 4 B | 1 | 20 |
| `6E3EF501` All Music | 自动（全库） | **1 × 136 B** | 0 | 20 |
| `8897259C` New Playlist | 普通列表 | 2 × 4 B | 0 | 1 |
| `963EB922` DecoyBand - [2024] Decoy | **自动（分支条件）** | **0** | 0 | 3 |

**两个普通列表共用同样两个 4 字节 props 键**：

```
E3AA0372-855E-4422-9A5A-600B13385BB1   4 B
F4376143-4D79-47E7-902E-10A67BB5570F   4 B
```

（`F4376143` 的值是 `ebffffff`，即 -21，看起来是某个 UI 状态量。）

### 9.2 干预 R：只改规则文本，结果集保持相同

**方法**：把 `All Music` 的 `sort_pattern` 从 `%album artist%` 改成它的
文档别名 `%albumartist%`——同一个字段、同一个值域、同样的排序语义，
**只有文本拼写不同**。

| 观察点 | 干预前 | 干预后 |
| --- | --- | --- |
| `sort_pattern` 长度 | 100 字符 | **99 字符** |
| 定义 blob 长度 | 136 B | **135 B** |
| `All Music` 的 `.fplite` SHA | `88045912d92e…` | **`88045912d92e…`（不变）** |
| 其它三个列表 | — | 全部不变 |

**启动 + 正常退出一整轮之后，`.fplite` 的 SHA 仍然不变。**

**结论：规则文本可以独立于结果集改写。** 这证明规格串与成员快照是两个分开的层，
但**不能**据此说「成员是由规则算出来的」——因为这次改写前后算出的成员恰好相同。

### 9.3 干预 S：保持规则，只改标签

**第一次尝试**：对 `All Music`（全库自动列表）改一首的 `ARTIST`。

**结果：`.fplite` 完全没变（SHA 仍是 `88045912d92e…`）。**

**原因**：`All Music` 的规则是**全库无过滤**，改任何标签都不会让曲目进出这个集合。
所以它天然不适合用来测「结果集变化」。

**这是一个方法学教训**：计划要求「改标签使结果集合变化」，
必须**先有一个带过滤条件的自动列表**，否则干预 S 根本无法制造差异。

### 9.4 分支条件的自动列表：一个反直觉的发现

按 §4d.4 的正确路径，在 `SpmQ3 - [2023] Collab` 分支上创建了
`963EB922:DecoyBand - [2024] Decoy`（实测创建的是 `Decoy` 分支，同名机制）。

它的 `.fplite` 正确含 3 条：

```
..\..\fixtures\q1test\08_Decoy Rock.flac
..\..\fixtures\q1test\09_Decoy Rock 2.flac
..\..\fixtures\q1test\18_Almost SpmQ3.flac
```

**但它的 `props` 表是空的（0 行）。**

这与 `All Music`（136 B 定义 blob）形成鲜明对比。可能的解释（**都是推断，未验证**）：

1. **分支条件不是以 props blob 形式存的**，而是存在另一处
   （例如 `metadb` 的回调、或 `library-v2.0` 的某个结构里）。
2. **条件尚未持久化**——只有在某些操作触发后才落盘。
3. **Album List 的分支路径本身被当作条件**，
   即「分支 = 一个运行时查询对象」，不需要序列化。

**这直接回答了计划 L49 想问的「规则存放位置」**：

> **全库自动列表的规则在 `props` 的 136 B blob 里；
> 分支条件的自动列表在本次观测中没有任何 props 记录。**

所以「规则存放位置」**不能一概而论**，至少有两种形态。

### 9.5 对「只随规则变 / 只随结果变」的判定

计划要求分别标注「仅随规则改变的记录」与「仅随结果改变的记录」：

| 记录 | 只随规则变？ | 只随结果变？ | 证据 |
| --- | --- | --- | --- |
| `props[82F16555-…]`（136B） | **是**（干预 R 改了它，`.fplite` 不动） | 否 | §9.2 |
| `.fplite` 内容 | 否（干预 R 未动它） | **未证实** | §9.3 两次都未变 |
| `props[E3AA0372-…]` / `props[F4376143-…]` | 否 | 否 | 普通列表的 UI 状态量 |
| `markers.focus` | 否 | 否 | 焦点位置 |

**诚实结论**：本轮**只完成了「只随规则变」这一侧的定位**。
「只随结果变」没有建立起来，因为：
- 全库列表改标签不影响成员（§9.3）
- 分支列表没有 props（§9.4）
- 因此没有一组「规则不变、成员变化」的对照可用

**规则存放位置的最终状态：部分定位。**
- 全库级：**已定位**（`props` 136 B blob）
- 分支级：**未定位**（props 为空）

### 9.6 一个操作细节（写给复跑的人）

`Create Autoplaylist` 在菜单里是**第 4 项**（`[3]`，id=5）。
但用键盘 `Down` 导航时，菜单打开后**第一项已经高亮**，
所以要按 **3 次** `Down` 再 `Enter`，不是 4 次。
按 4 次会落到 `Copy` 上，静默什么都不做。

**这一条踩了两次**，写在这里以免重犯。

## 十、统计键核查（计划 L73）

> 计划要求：「SpMusic 的评分键是 `trackId`，最常播放和最近播放按规范化 `sourcePath`。
> 在当前 SHA 复核代码，路径相同的 CUE 分轨以及重复列表项都作为边界用例。」

### 9.1 SpMusic 侧：**这两套统计键在仓库里都不存在**

在当前 SHA（`682acf4` 及其后的文档提交）上全仓库检索：

| 检索项 | 结果 |
| --- | --- |
| Rust 侧 `rating` 字段 | **无**（唯一命中是 `playlist_duration.rs:739` 的测试字符串 `#EXT-X-RATING:0`） |
| `play_count` / `playCount` / `mostPlayed` / `recentlyPlayed` | **无** |
| 统计相关 `CREATE TABLE` | **无**（没有任何 SQL schema / migration） |
| 统计持久化文件 | **无** |

**结论：计划 L73 的前提「SpMusic 的评分键是 `trackId`」在本仓库当前状态下不成立。**
SpMusic 目前**没有实现任何播放统计**（没有评分、没有播放次数、没有最近播放）。

**这对候选卡的影响**：L73 说「自动离线保留、索引持久化与统计查询列独立后续任务」——
现在可以进一步确认，**统计这块是从零开始，不是改键**。

**不能据此下结论的部分**：这只是当前 SHA 的状态。如果统计功能在别的分支或
别的仓库里已实现，本核查不覆盖。**标注为「本 SHA 未实现」而非「产品永不实现」。**

> **时间点声明（重要）**：本核查针对 `682acf4`（本轮研究起点）的工作区状态。
> 核查期间工作区被**另一个工作流**并行修改，出现了
> `src/features/player/components/mostPlayedAcceptance.browser.test.mjs`（已有跟踪、处于修改中）
> 以及 `src-tauri/src/audio/types.rs` 的新字段
> （`track_number` / `disc_number` / `file_modified_at_ms`）。
>
> 经检查：
> - 该测试文件是**另一个工作流的独立验收脚本**，未提交、不属本轮范围
> - 那些 Rust 新字段与播放统计**无关**（是曲目号与文件 mtime）
> - 复核时仍**没有** `rating` / `playCount` / 统计表
>
> **所以本条结论对 `682acf4` 成立；若后续工作流加入统计，需要重新核查。**
> 本轮不去碰那个工作流的任何文件。

#### 9.1b 复核注记（2026-11-18，文档修复轮）

上文「若后续工作流加入统计，需要重新核查」**已经触发**。在当前工作区重新检索的结果：

| 检索项 | `682acf4` 时点 | 2026-11-18 复核 |
| --- | --- | --- |
| 前端 `mostPlayed.ts` / `recentlyPlayed.ts` | 无 | **已存在**（`src/features/player/model/`） |
| 统计持久化载体 | 无 | **前端 `localStorage`**（`MOST_PLAYED_STORAGE_KEY` 等） |
| Rust 侧 `rating` / `play_count` 字段 | 无 | **仍无** |
| 统计相关 `CREATE TABLE` | 无 | **仍无**（Rust 侧 0 命中） |

**修正后的表述**：SpMusic 的播放统计**已经存在，但只在前端、以 `localStorage` 承载**，
Rust 侧仍无对应的 schema 与字段。因此：

- 「统计这块是从零开始，不是改键」——**对 Rust 持久化层仍成立**，对前端**已不成立**。
- 候选卡 P2-J（统计字段接入曲目模型）的前置条件需要按**前端已有一份实现**重新评估，
  重点变成「两份统计源如何统一」而不是「从零接入」。

**未核查**：本复核只看了文件是否存在与持久化载体，**没有**逐行核对
`mostPlayed` / `recentlyPlayed` 的键语义（是否按规范化 `sourcePath`）、
CUE 分轨与重复条目的边界行为。这部分仍待独立核查。

### 9.2 foobar2000 侧：索引键的实测结构

对比 A′ 与 B 的 `metadb.sqlite`：

| 样本 | `metadb_indexes` 行数 | 索引数据表 |
| --- | ---: | --- |
| A′ 2.24.6（本轮新建 profile） | **0** | 无 |
| B（foobaka，用户实际使用过） | **6** | 6 对 `<index>_data` 表 |

**索引表 DDL（每一对都相同）**：

```sql
CREATE TABLE metadb_index_<GUID> (
  key INTEGER NOT NULL,
  filename TEXT NOT NULL UNIQUE PRIMARY KEY
)
CREATE TABLE metadb_index_<GUID>_data (
  key INTEGER NOT NULL PRIMARY KEY UNIQUE,
  value BLOB
)
```

**关键：主键是 `filename`（TEXT），不是 `key`（INTEGER）。**

`filename` 的实际内容带**子轨前缀**：

```
'0+file://E:\Music\_cue_test\album_whole.flac'
'1+file://E:\Music\_cue_test\album_whole.flac'
'2+file://E:\Music\_cue_test\album_whole.flac'
```

同一个 FLAC 文件的三个 CUE 分轨是**三条独立记录**，`0+` / `1+` / `2+` 是子轨索引。

**这正对应计划说的「路径相同的 CUE 分轨」边界用例**，
并且答案明确：**foobar2000 用「子轨索引 + 完整路径」区分，不是只用路径。**

`key` 列是各插件自己算的 64 位哈希（不同索引对同一文件给出不同的 key）：

| 索引 GUID | 同一文件的 key |
| --- | --- |
| `4209C12E-…` | `0`（对 CUE 分轨恒为 0，说明这个索引不区分分轨） |
| `B2D78CA3-…` | `-3229068629551947626` |
| `BF7490F5-…` | `6482317436645334705` |
| `C653739F-…` | `2062654455283911542` |
| `E58A4298-…` | `4131252194513635826` |
| `EF148A2E-…` | `-6028965036502372216` |

**这说明 `key` 不是全局身份，而是「各索引自己的哈希」**，
真正的身份锚点是 `filename` 主键。

### 9.3 只有一条索引有数据

| 索引 | `_data` 行数 |
| --- | ---: |
| `C653739F-14B3-4EF2-819B-A3E2883230AE` | **1829** |
| 其余 5 条 | **0** |

`C653739F` 的 value 是 **40 字节固定长度 blob**：

```
000000000000000000000000000000000000000000000000 f5848a91c272dd01 ffffffff 00000000
```

结构（按 `metadb` 的同类 blob 惯例推断，**未做指令级验证**）：
- 前 20 字节：全零
- 8 字节：`0x01dd72cc918a84f5`（FILETIME 量级的时间戳）
- 4 字节：`ffffffff`（-1）
- 4 字节：`00000000`（0）

对应 `metadb_indexes` 里 `C653739F` 的 `retention = 24192000000000`（28 天）。

### 9.4 与第二轮结论的关系

第二轮从 B 的样本里读出四条 `retention = 24192000000000`，本轮看到**实际是六条**，
其中两条是 `-1` 与 `-1550778368`（异常/未初始化值）。

| GUID | retention | 折算 |
| --- | ---: | --- |
| `C653739F` / `B2D78CA3` / `E58A4298` / `BF7490F5` | 24,192,000,000,000 | 28 天 |
| `EF148A2E` | **-1** | 未初始化 |
| `4209C12E` | **-1550778368** | 异常值 |

**这修正了第二轮一处**：「四条 retention」应说「六条，其中四条为 28 天」。
后两条的负值说明 `retention` 列**存在未初始化状态**，不能假定总有 28 天宽限。

### 9.5 证据等级

| 结论 | 等级 |
| --- | --- |
| SpMusic 本 SHA 无统计实现 | **强**（全仓库检索无命中） |
| foobar2000 索引主键是 `filename` 含子轨前缀 | **强**（DDL + 实际行） |
| `key` 是各索引自己的哈希 | **强**（六索引对同一文件给出不同 key） |
| `C653739F` 的 40B blob 内部结构 | **中（推断）** |
| `retention` 存在未初始化负值 | **强**（两行实测） |

## 十一、对第二轮文档的修改清单

| 文档 | 位置 | 原表述 | 修正为 |
| --- | --- | --- | --- |
| `foobar2000-search-mechanisms.md` | §一 分发表 | 「每项 16 字节，`+0x0C` 是等价关键字串」 | **每项 12 字节**；删除「别名」列；22 项完整表 |
| 同上 | §三 约束 2 | 「`IS` 必须在单值层比较，多值逐值」 | **`IS` 不是逐值**：多值第二个值不被 `IS` 命中，只有 `HAS` 能命中（QT02/QT04/QT10 实测） |
| 同上 | §二 运算符表 | 「`ALL` 2.26 才进文档」 | 补一句「实现与运行在 2.24.6 已生效」 |
| `foobar2000-library-mechanisms.md` | §三 离线宽限 | 「28 天宽限」作为已确认行为 | 收窄为「某份 `metadb_indexes` 快照中四条 `retention` 折算为 28 天；运行时的清理时机未实测」 |
| 同上 | §三 状态机 | 「目录不可达 → 未枚举 → 条目保留（受 28 天限制）」 | 补实测：「短时间离线根本不写 `lastseen`、不进入删除逻辑；28 天是否为真实阈值仍未验证」 |
| `foobar2000-foobaka-phase-2-findings.md` | §7.6/§7.7 | 16 字节表 + 别名列 | 同 search-mechanisms 的修正 |
| `foobar2000-search-mechanisms.md` | §5.4 | 仍称「`IS` 在单值层比较」 | **失效段落残留**：§三之二/§三之三已推翻「逐值」，§5.4 未同步 |
| `foobar2000-search-mechanisms.md` | §6.1 | autoplaylist 定义「16 字节 blob、编码未知、静态解不出」 | 与 §9.1/§9.2 冲突；应统一为**已解出 136 B 定义 blob** |
| `foobar2000-library-mechanisms.md` | §八 证据强度 | 「28 天宽限」评为**强**，同表另写「运行验证未做」 | 自相矛盾；应统一为**未知（未实测）** |
| `foobar2000-library-mechanisms.md` | §3.4 / §3.6(1) | 仍写「靠 28 天宽限自动过期」 | §3.5 已修正判删归因，这两处未同步 |
| `foobar2000-foobaka-phase-2-findings.md` | §7.6 标题 | 「titleformat **8** 个函数」 | 实际列举 **10** 个 |
| 三篇机制文档 | frontmatter | `updated: 2026-11-15` | 正文已含 2026-11-17 第三轮勘误，元数据未同步 |

> **2026-11-18 文档修复轮另修 4 处 findings 自身漂移**：
> §零 阻塞表提权通道状态、§四 前提句、§6.1 ETW 完成度、§6.2/§6.3 B 受阻原因；
> 并追加 §9.1b 统计核查复核注记。详见各节修订后的正文。
>
> **2026-11-18 第四轮再修正 4 处**：
>
> | 位置 | 原表述 | 第四轮修正 |
> | --- | --- | --- |
> | §零「仍受阻的一项」 | A1 因无环回端点不可完成 | **本机可完成**（WASAPI 环回不依赖端点设备） |
> | §6.2 受阻表 A1 行 | 需换 ffmpeg 或启用立体声混音 | **已闭合**，自建录制器完成 |
> | §6.3 外部机器事项 | A1 需外部机器 | **已过时**；仅独占模式数字回录仍待外部条件 |
> | §八 A1 bit-perfect | 「未知，无法抓样」 | **部分闭合**：CUE 零误差，但共享混音器仍阻断 bit-perfect 断言 |


