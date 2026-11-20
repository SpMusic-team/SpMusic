---
doc_id: "ARCH-FOOBAR2000-SEARCH-MECHANISMS"
title: "foobar2000 检索语法与动态列表机制（实测）"
doc_type: "architecture"
status: "draft"
owner_agent: "lead"
version_scope: "research"
created: "2026-11-15"
updated: "2026-11-18"
source_documents:
  - "docs/corpus/foobar2000-foobaka-ds-phase-2-plan.md"
  - "docs/corpus/foobar2000-foobaka-phase-2-findings.md"
  - ".rea-analysis/phase2/run-20261115-p2a/workstream-search/REPORT-search-and-dynamic-lists.md"
  - ".rea-analysis/phase2/run-20261115-p2a/workstream-ui/raw/REFACETS-EVIDENCE.md"
  - ".rea-analysis/phase2/run-20261115-p2a/workstream-ui/raw/AUTOPLAYLIST-EVIDENCE.md"
---

# foobar2000 检索语法与动态列表机制（实测）

本文对应 phase-2 计划点名的**第一条逆向主线**：「研究原版的联动检索与动态列表」。

方法：主程序内嵌 SQL/字符串字面量 + MSVC 修饰名 + 查询运算符分发表 + 随包帮助文档。**未运行任何 foobar2000 程序。**

## 零、三处前提修正

| # | 原说法 | 实测 |
| --- | --- | --- |
| 1 | 「2.26 新增 `ALL` 关键字」 | **只对文档成立**。实现早在 **2.24.6** 就有（分发表 `0x27BE0C`），文档 2.26.2 才补 |
| 2 | 「SpMusic 缺 `playCount`/`lastPlayed`」 | **不准确**。两者都在（`mostPlayed.ts`），缺的是**与查询语言的接线** |
| 3 | 「组件信息不能通过查询访问」 | **需按通道区分**：裸字段名走 metadata 通道读不到；`%play_count%` 走 titleformat 通道**可以** |

### 0.1 关于 `ALL` 的实现证据（双路验证）

| 证据 | 值 |
| --- | --- |
| `ALL\0` 字符串 | file `0x29D820`（VA `0x0069E420`） |
| 分发表项 | `0x27BE0C`（`kw=0x0069E420, flags=0, h1=0x0058E630`） |
| 错误串 | `Invalid ALL syntax`@`0x29DAD0`、`ALL not allowed here`@`0x29DAB8` |
| 实际使用 | `foo_ui_std.dll` ReFacets 预设 `ALL SORT DESCENDING BY %play_count%` |

**另有一个四版全部实现、四版文档全部没写的运算符 `NONE`**：

| 证据 | 值 |
| --- | --- |
| `NONE\0` 字符串 | file `0x29DB7C`（VA `0x0069E77C`） |
| 分发表项 | `0x27BE18` |
| 错误串 | `Invalid NONE syntax`@`0x29DAA4` |

> **方法学教训**：判断「某能力是哪个版本引入的」**必须查二进制分发表**，不能只读 changelog 或 help 文档。`ALL` 与 `NONE` 是同一个教训的正反两面——一个文档迟于实现，一个文档完全不提。

## 一、查询运算符分发表的结构（第三轮已勘误）

> **勘误（2026-11-17）**：本节初版按 **16 字节**步长解读，把下一项起始的 dword 误当成本项的 `+0x0C` 字段，据此推导出的「等价关键字」列（`SORT→ORDER`、`NOT→HAS`、`EQUAL→GREATER`、`PRESENT→BEFORE`、`DURING→ALL`）**全部作废**。
>
> 实测 `0x27BE18 - 0x27BE0C = 12 字节`，正确步长是 **12**。详见 [第三轮 findings](foobar2000-foobaka-phase-3-findings.md) §三。

A′ 2.24.6 的 `.rdata` 里是一条**定长表**，每项 **12 字节**，结构为 `{const char* name; u32 flags; u32 handler}`。

> **第四轮勘误（2026-11-18）**：起止边界与项数**再度修正**。
> 正确基址是 **`0x27BD40`**（不是 `0x27BD3C`——后者是前一个结构的尾部字段），
> 表长 **19 项**，区间 `[0x27BD40, 0x27BE24)` 共 228 字节。
> 第三轮所列的「22 项」里，后 3 项实际属于**紧邻的另一个结构**。

按 12 字节重列共 **19 项**：

| # | file 偏移 | 关键字 | flags | handler |
| ---: | --- | --- | ---: | --- |
| 0 | `0x27BD40` | `SORT` | 1 | `0x0058EB90` |
| 1 | `0x27BD4C` | `ORDER` | 1 | `0x0058EB90` |
| 2 | `0x27BD58` | `OR` | 0 | `0x0058C5F0` |
| 3 | `0x27BD64` | `AND` | 0 | `0x0058C540` |
| 4 | `0x27BD70` | `NOT` | 0 | `0x0058C6A0` |
| 5 | `0x27BD7C` | `HAS` | 0 | `0x0058CAC0` |
| 6 | `0x27BD88` | `IS` | 0 | `0x0058CD20` |
| 7 | `0x27BD94` | `IST` | 0 | `0x0058CD20` |
| 8 | `0x27BDA0` | `EQUAL` | 0 | `0x0058D5A0` |
| 9 | `0x27BDAC` | `GREATER` | 0 | `0x0058D560` |
| 10 | `0x27BDB8` | `LESS` | 0 | `0x0058D580` |
| 11 | `0x27BDC4` | `MISSING` | 0 | `0x0058CA80` |
| 12 | `0x27BDD0` | `PRESENT` | 0 | `0x0058CAA0` |
| 13 | `0x27BDDC` | `BEFORE` | 0 | `0x0058E410` |
| 14 | `0x27BDE8` | `AFTER` | 0 | `0x0058E3B0` |
| 15 | `0x27BDF4` | `SINCE` | 0 | `0x0058E470` |
| 16 | `0x27BE00` | `DURING` | 0 | `0x0058E4F0` |
| 17 | `0x27BE0C` | `ALL` | 0 | `0x0058E630` |
| 18 | `0x27BE18` | `NONE` | 0 | `0x0058E6D0` |

**`IS` 与 `IST` 共用同一个 handler `0x0058CD20`**——这从分派层支持第三轮
「`IS`/`IST` 走同一比较例程」的行为观察。
`SORT` 与 `ORDER` 共用 `0x0058EB90`，且 `flags=1`（其余全为 0）。

**紧跟其后的独立结构**（`0x27BE24` 起，**8 字节对**，共 5 对）——
这是「短名 → 时间戳长名」的**字段别名表**，不是运算符：

| 短名 | 长名 |
| --- | --- |
| `%first_played%` | `%first_played_timestamp%` |
| `%last_played%` | `%last_played_timestamp%` |
| `%added%` | `%added_timestamp%` |
| `%last_modified%` | `%_timestamp%` |
| `%file_created%` | `%_timestamp_created%` |

**这解释了第三轮的困惑**：第三轮按 12 字节步长继续读，把这张 8 字节对表的字节
错位成了「运算符」，于是多出 3 项伪关键字。**12 字节步长只在 19 项内成立。**

**B（foobaka）对照**：同区间 `[0x27BD40, 0x27BE24)` **228 字节逐字节相同**，
19 项完全一致。B 与 A′ 在查询分派层**没有任何差异**。

## 二、查询语法全表（16 个文档化 + 2 个未文档化）

| 运算符 | 类别 | 文档化于 | 2.24.6 有实现 |
| --- | --- | --- | :---: |
| `HAS` / `* HAS` | 文本 | 2.24.6 | ✓ |
| `IS`（含 `?` `*` 通配） | 文本 | 2.24.6（通配 2.25.11 才写进文档） | ✓ |
| `GREATER` / `LESS` / `EQUAL` | 数值 | 2.24.6 | ✓ |
| `MISSING` / `PRESENT` | 缺失 | 2.24.6 | ✓ |
| `BEFORE` / `AFTER` / `SINCE` / `DURING` / `DURING LAST n UNIT` | 时间 | 2.24.6 | ✓ |
| `AND` / `OR` / `NOT` + 括号 | 布尔 | 2.24.6 | ✓ |
| `SORT [ASC\|DESC]ENDING BY` | 排序 | 2.24.6 | ✓ |
| **`ALL`** | 特殊 | **2.26.2 才进文档** | **✓（2.24.6 就有）** |
| **`NONE`** | 特殊 | **四版全缺** | **✓（四版都有）** |

**四版文档差异**：`2.26.2 → 2.26.3` 零行差异；`2.24.6 → 2.25.11` 仅 11 行（全在 `IS` 通配说明）；`2.24.6 → 2.26.2` 仅 25 行（`Special Keywords` 章节 + `ALL`）。**没有任何运算符被增删。**

## 三、五条不可违背的语义约束

这五条是 SpMusic 若要实现查询语法时**必须遵守**的硬约束，每条都有官方文档或实测依据。

| # | 约束 | 依据 |
| ---: | --- | --- |
| 1 | **字段名 vs 格式化串的分派**：`<field>` 含 `#$%` 任一 → titleformat 通道；否则 metadata 通道 | `Query Syntax Help.html` §Notes |
| 2 | **`IS` 与 `HAS` 在多值字段上行为不同**（第三轮实测修正，见下） | A′ 2.24.6 运行实测 |
| 3 | **`SORT BY` 必须在查询末尾** | 运算符表注 `Must be at the end of the query` |
| 4 | **关键字全大写**，值不区分大小写 | 官方原文；第三轮实测确认 |
| 5 | **`* HAS` 复用简单搜索语义**（含文件名与路径） | 官方原文 |

### 三之二、第 2 条约束的实测修正

> **第二轮写的是**「`IS` 必须在单值层比较，多值逐值展开」。
> **第三轮实测推翻了「逐值」这一半**。

判别性对照（20 条夹具，`ARTIST` 多值样本为 `SpmQ3;Bystander`、`Guest;SpmQ3`、`A;SpmQ3;B`）：

| 查询 | 结果 | 说明 |
| --- | ---: | --- |
| `ARTIST IS SpmQ3` | 11 | 多值样本**全部命中** |
| `ARTIST IS Bystander` | **0** | 多值的**第二个值不命中** |
| `ARTIST HAS Bystander` | **1** | 但 `HAS` 命中 |
| `ARTIST IS Guest` | **0** | 同上 |
| `ARTIST HAS Guest` | 1 | — |
| `GENRE IS Pop` | **0** | 多值流派第二值不命中 |
| `GENRE HAS Pop` | **2** | — |
| `ARTIST IS A` / `ARTIST IS B` | **0 / 0** | `A;SpmQ3;B` 的两端值都不命中 |

**结论**：`IS` 在多值字段上**不是逐值匹配**——它只对「某个特定位置的值」（推断为首值，或分号拼接串的等价形式）生效；`HAS` 才是对整串做子串匹配、能命中任意位置。

另有一条实测细节：`ARTIST IS spmq3` = 12 而 `ARTIST IS SpmQ3` = 11，差的 1 条是**单值**恰为小写 `spmq3` 的第 11 首。说明大小写虽不敏感，但「值在字段中的位置」会影响命中结果。

> **精确匹配形式仍是推断**。本轮只确证了「不是逐值」，没有到指令级确认「到底是首值还是拼接串」。完整数据见 [第三轮 comparison](foobar2000-foobaka-phase-3-comparison.md)。

**对 SpMusic 的含义**：若要实现查询语法，多值字段的 `IS`/`HAS` 必须**分别设计**，不能统一按「展开成多值后逐个比较」处理。

### 三之三、第三轮补充：`IS` 语义的穷举拟合（10 项探针）

第三轮用 20 条夹具做了 18 条判别性探针，然后**穷举候选实现**去拟合实测计数。
候选与得分（10 项 ARTIST/GENRE 的 `IS` 探针）：

| 候选实现 | 吻合项 | 不吻合 | 典型反例 |
| --- | ---: | ---: | --- |
| **整串相等、不区分大小写** | **9** | **1** | `IS SpmQ3` 应为 11，算出 12 |
| 整串相等、区分大小写 | 9 | 1 | `IS spmq3` 应为 12，算出 1 |
| 按 `;` 切分后任一分量相等（cs） | 2 | 8 | `IS Bystander` 应为 0，算出 1 |
| 按 `;` 切分后任一分量相等（ci） | 2 | 8 | `IS A` 应为 0，算出 1 |
| 首分量相等（ci / cs） | 4 | 6 | `IS Guest` 应为 0，算出 1 |
| 末分量相等（ci / cs） | 4 | 6 | `IS B` 应为 0，算出 1 |
| 整串前缀 / 包含 | 2–4 | 5–7 | `IS SpmQ` 应为 1，算出 13–14 |

**结论：没有任何一个「简单候选」能 100% 拟合。**
最接近的是「整串相等、不区分大小写」（9/10），唯一失败的是
`ARTIST IS SpmQ3`（实际 11、推算 12）——差的那一首是
**第 11 首，其 `ARTIST` 为小写 `spmq3`**。

### 第三轮能确定与不能确定的

**能确定（10 项探针 + 17 条主查询支撑）**：

| 结论 | 依据 |
| --- | --- |
| `IS` **不是**按 `;` 切分后逐分量比较 | `IS Bystander` = 0、`IS Guest` = 0、`IS A` = 0、`IS B` = 0 —— 这些分量都存在但都不命中 |
| `IS` **不是**子串匹配 | `IS SpmQ` 只命中 1 首（整值恰为 `SpmQ` 的那首） |
| `IS` **不是**前缀匹配 | 同上，若前缀匹配会命中 13 首 |
| `HAS` 是子串匹配 | `HAS Bystander` = 1、`HAS Guest` = 1、`HAS Pop` = 2 |
| 大小写会影响结果数 | `IS spmq3` = 12 vs `IS SpmQ3` = 11 |
| 多值**整串**可以被匹配 | `IS SpmQ3;Bystander` = 1（命中第 04 首） |

**不能确定（诚实标注）**：

`IS SpmQ3` 命中 11 首，其中包含三条多值记录
（`SpmQ3;Bystander`、`Guest;SpmQ3`、`A;SpmQ3;B`），
说明多值字段在 `IS` 比较前**被某种方式归一化了**——
但归一化后的字符串**不等于任何「按 `;` 切分」的形式**：

- 若归一化为首分量：04 命中 ✓、05 不命中 ✗（但实际命中）
- 若归一化为末分量：05 命中 ✓、04 不命中 ✗（但实际命中）
- 若归一化为任一分量：`Bystander`/`Guest`/`A`/`B` 都会命中 ✗（实际都是 0）
- 若归一化为整串：`SpmQ3;Bystander` 不等于 `SpmQ3` ✗（但实际命中）

**四种归一化方式全部被实测排除。** 剩余的唯一解释是
**`IS` 用了 `metadb` 之外的某个比较通道**（例如在 titleformat 层
对字段做了一次特殊求值），而现有证据不足以确定它。

**因此本轮对 `IS` 多值语义的定位是：**
> `IS` 的匹配层次**不是**任一分量，也**不是**整串，
> 而是一个尚未定位的归一化形式；`HAS` 则是明确的整串子串匹配。

### 对 SpMusic 的实操建议

既然 `IS` 的精确多值语义在本轮未能穷尽，若 SpMusic 要实现同类检索：

1. **`HAS` 可以照实现**（整串子串、不区分大小写），语义已确证。
2. **`IS` 不要照抄**。建议明确采用「按 `;` 切分后任一分量整值相等」，
   这是最符合用户直觉的定义，**但要标注与 foobar2000 行为不同**。
3. 若必须逐位兼容，需要先补一轮专门针对 `IS` 归一化的定点实验
   （用单值/双值/三值、大小写混合的受控夹具，逐条比对命中与否）。


## 四、「播放统计能否进查询」的精确边界

这一条在首轮被简化成「不能」，本轮查到需要按**通道**区分。

### 4.1 文档里的那句话

`Query Syntax Help.html`（2.24.6）原文：

> "Note that you can't access technical information (such as codec specifications) or component-provided information (playback statistics and such) **this way**."

### 4.2 「this way」指什么

它指的是**上一条 Note**——「不含 `#$%` 的 `<field>` 按 metadata 字段处理」。所以边界是**通道**而非**字段**：

| 写法 | 通道 | 能否读到播放统计 |
| --- | --- | --- |
| `play_count GREATER 9` | metadata 通道（裸字段名） | **不能** |
| `%play_count% GREATER 9` | titleformat 通道（含 `%`） | **能** |

### 4.3 三条实证

**（1）`metadb` 表本身就带这些列**（主程序 DDL，见 [曲库机制文档](foobar2000-library-mechanisms.md) §1.1）：

```sql
CREATE TABLE IF NOT EXISTS metadb ( ... playCount INTEGER, dateAdded INTEGER,
  firstPlayed INTEGER, lastPlayed INTEGER, rating INTEGER )
```

**（2）ReFacets 自带统计类预设**（`foo_ui_std.dll`，2.24.6 / 2.26.3 偏移）：

| 预设 | 2.24.6 | 2.26.3 |
| --- | --- | --- |
| `ALL SORT DESCENDING BY %play_count%` | `0x12B2C8` | `0x13C4FC` |
| `%play_count% MISSING` | `0x12B2FC` | `0x13C530` |
| `%play_count% GREATER 9` | `0x12B324` | `0x13C558` |
| `%last_played% DURING LAST 1 WEEK` | `0x12B3A0` | `0x13C5D4` |
| `%rating% IS 5` | `0x12B3D0` | `0x13C604` |

**（3）官方文档示例本身也用**：`%rating% GREATER 3`、`NOT %last_played% AFTER %first_played%`。

### 4.4 结论

**「播放统计不能查询」是不准确的**。准确表述是：

> 裸字段名（`play_count`）读不到组件/统计信息；**用 titleformat 形式（`%play_count%`）可以**。

**对 SpMusic 的含义**：如果 SpMusic 的统计字段只在 `localStorage` 而没进入曲目模型，那么即使实现了查询语法，`playCount` 这类字段仍然查不到——**必须先接线，再谈语法**。

## 五、联动筛选（ReFacets）

### 5.1 ReFacets 是官方 DUI 能力，不是第三方

| 证据 | 内容 |
| --- | --- |
| 字符串位置 | `ReFacets` / `reFacets.*` / `ReFacets autoplaylist` 全在 `components\foo_ui_std.dll` |
| C++ 修饰名 | 20 条 RTTI 名，证明是 C++ 类 |
| 单二进制命中 | A′ 的 10 个二进制里 `Facets`/`ReFacets` **只**命中 `foo_ui_std.dll` |
| 面板标识 | 名 `ReFacets`；GUID `{61BFC7AD-C00F-4CEA-8E6A-EA22E01F43F9}`；元素名 `foobar2000.ReFacets.facet` |

> **必须与 Columns UI 严格区分**。`user-components\foo_ui_columns`（2.1.0，作者 `musicmusic`）是**第三方**，其 Filter 面板不属官方能力。

### 5.2 三层类结构（从修饰名还原）

| 类 | 方法 | 语义 |
| --- | --- | --- |
| `reFacetsBase` | `on_items_added` / `on_items_removed` / `on_items_modified_v2` / `on_content_changed` | metadb 通知 → 重算 |
| | `grabTracks` | 取满足条件的曲目集（`metadb_handle_list_t`） |
| | `makeVals` | 生成各 facet 面板的取值行 |
| | `sortTracks` / `setFilter` | 排序 / 设置筛选串 |
| | `splitValsAL` | **多值拆分**（名字即 "split values, Album List"） |
| `reFacetsInstance` | `init` / `setup_rebar` / `clearPanes` / `reloadSel` | 面板容器管理 |
| `ap_refacets` | `criteriaChanged` | **动态列表条件变更回调** |

### 5.3 多值拆分的语法是 `%<field>%`（未文档化）

ReFacets 与 Album List 的默认配置统一使用尖括号形式：

| 字段 | 配置串 |
| --- | --- |
| Genre | `%<genre>%` |
| Album Artist | `%<album artist>%` |
| Artist | `[%artist%]`（**刻意不加尖括号**） |

Album List 预设：

```
by artist → %<artist>%|%album%|[[%discnumber%.]%tracknumber%. ][%track artist% - ]%title%
by genre  → %<genre>%|[%album artist% - ]%album%|...
```

**这个语法在四版 `titleformat_help.html` 里都搜不到**（唯一 `%&lt;` 命中是 HTML 闭合标签）。是**内部约定**，靠配置用法与 RTTI 符号（`splitValsAL`）间接证明。

> **未知**：`%<field>%` 的精确语义（是否等价于「按值拆分」）只有符号级证据，**未到指令级**。

### 5.4 合作艺人「多分类出现、结果只一次」的机制

**不是去重算法，是三层语义叠加**：

1. `%<artist>%` **逐值展开** → N 个分支，同曲出现在 N 个分类下
2. `IS` 在**多值字段上只比较首个值/整串的等价形式，不是逐值**（第三轮实测；见 §三之二，**不是**旧版写的「单值层比较」）
3. 结果集是 `metadb_handle_list_t` **集合**，天然去重

**SpMusic 的等价实现已经存在**：`splitArtists()` + `artistEntries()` + `uniqueArtistSongs()` 的三层组合，结果语义等价。差异只在拆分词表与去重时机。

### 5.5 联动状态：14 个固定键

`match` / `column` / `descending` / `ascending` / `sortColumn` / `filter` / `userFilter` / `facet` / `statsColumn` / `columnsOrder` / `source` / `search` / `toolbarLocked` / `multiFilters`

持久化走 `cfg_var.<GUID>` / `config_object.<GUID>` → `profile/config.sqlite` 的 `configBlobs`（**序列化 blob，非明文**）。

### 5.6 自动重算的 4 个触发源

`on_items_added` / `on_items_removed` / `on_items_modified_v2` / `on_content_changed`，
外加 `implementSearchFilter` 也实现同一组回调（说明**搜索过滤与 facet 列共用通知驱动**）。

**是事件驱动 + 增量重算，不是每次全量重扫。**

## 六、动态列表（autoplaylist）

### 6.1 存条件不存结果：两层分离

| 文件 | 内容 | 语义 |
| --- | --- | --- |
| `playlists-v2.0\index.txt` | `D8232CDB-…:默认列表` | 播放列表清单 |
| `playlist-<GUID>.fplite` | UTF-8 BOM + 每行一个路径 | **求值后的快照**（缓存，可重建） |
| `playlist-<GUID>-props.sqlite` | `props(key, data BLOB)` + `markers(key, value)` | **持久化定义** |

**B 里唯一一条 autoplaylist 实测**：

```
markers: key='focus'  value=0
props:   key='52655132-8F57-4C56-9AEE-17525C679A5D'
         data=<16 字节 blob> 671c4978682fc44f86f3d877004169cf
```

该 GUID 的 LE 字节 `32 51 65 52 57 8F 56 4C 9A EE 17 52 5C 67 9A 5D` 在 `foobar2000.exe`
**四版全部命中**，紧跟 `Changes active playlist.` —— **推断为官方 `autoplaylist_client` 注册 GUID**。

> **第三轮已解出（本节原文已过期）**：autoplaylist 的**完整定义是 136 字节 blob**，
> 结构为 `u32 flags + GUID clientGUID + u32 limit + (u32 len + UTF-8 串) + u64 0`，
> 存在 `props` 表里（第三轮实测，`sort_pattern` 长 100）。
>
> 上面这个 **16 字节 blob 只是一个标记，不构成完整定义**。第三轮做过阴性对照：
> 把仅含该 16 B blob 的记录注入 A′ 默认列表，重启后记录原样保留，但列表**仍可编辑**
> （autoplaylist 会禁用编辑）→ 证明单靠它不足以让列表变成动态。
>
> 因此「查询串可能编码在此或 `.fplite` 里」的推测**已被否证**：定义在 props 的 136 B blob 内。

**旁证**：A′ / 2.26.3 / B 的 `config.sqlite` 全文搜 `autoplaylist|query|playlist` **全部 0 命中** → 定义一定在 `playlists-v2.0\`，不在配置库。

### 6.2 求值是异步 + 延迟合并

| 证据 | 含义 |
| --- | --- |
| `autoplaylist worker`（`0x286230`） | **独立线程** |
| `deferOp(function<void()>)` | 延迟入队 |
| `runAsync(fn, fn)` | 异步 + 回调 |
| `delay_action(uint, list, callback)` | **带 debounce 窗口** |
| `_on_delayed_action` | 延迟动作到期回调 |
| `Could not restore autoplaylist : ` | 启动恢复路径 |

**没有定时轮询的证据**——纯事件 + 延迟合并。**debounce 的具体延时值未静态求得（未知）。**

### 6.3 锁定与所有权语义

4 个专门的异常类：

| 异常类 |
| --- |
| `exception_autoplaylist_not_owned` |
| `exception_autoplaylist_already_owned` |
| `exception_autoplaylist`（基类） |
| `exception_autoplaylist_lock_failure` |

配套提示：`This playlist is already an autoplaylist`、`This playlist is not an autoplaylist`、`Playlist could not be locked`、`on_playlist_locked`。

**一个播放列表要么动态要么静态，且动态状态需要加锁持有，不能被两个 client 同时接管。**

### 6.4 动态 → 静态的三行 API 真实语义

`foobaka-themes/Mix/left/Search.js:834-841`：

```javascript
var last_id = plman.PlaylistCount;
if (this.AutoPlaylist) {
    plman.CreateAutoPlaylist(last_id, pl_name, str_tag);
} else {
    plman.CreateAutoPlaylist(last_id, "&tmp", str_tag);  // 1) 建动态
    plman.DuplicatePlaylist(last_id, pl_name);            // 2) 求值一次 → 静态快照
    plman.RemovePlaylist(last_id);                        // 3) 删动态原件
}
```

**关键**：`DuplicatePlaylist` 是**快照语义**，不是克隆定义。因为**没有 `ConvertToStatic` API**，这是唯一手段。

**为什么必须绕这一圈**：直接改已有列表的动态状态会撞上锁定/所有权检查（§6.3），"新建 + 复制 + 删源"绕开了它。

### 6.5 四件套与 SpMusic 的差距

| 件 | foobar2000 | SpMusic |
| --- | --- | --- |
| 条件模型 | `autoplaylist_client` 服务 + `clientData` blob | **无** |
| 求值层 | `autoplaylist_instance_impl` + 独立 worker + debounce | **无** |
| 锁定/所有权 | 4 个异常类 + 3 条提示 | **无** |
| 持久化恢复 | `props.sqlite` + `Could not restore` 路径 | **无** |

`AudioFolderPlaylist`（`src-tauri/src/audio/types.rs:287-303`）只有 `tracks: Vec<AudioFolderTrackRef>` 静态数组。
仓库全局 grep `autoplaylist|smartPlaylist|playlistQuery|dynamicPlaylist` → **0 命中**。

## 七、SpMusic 检索能力对照

| 能力 | foobar2000 | SpMusic | 差距 |
| --- | --- | --- | --- |
| 简单搜索 | 全词包含 + 忽略拉丁变音 | 子串 `includes()`，**不忽略变音** | 小 |
| 字段限定 `HAS`/`IS` | ✓ | ✗ 所有字段一起 `some()` | **大** |
| 多值逐值比较 | ✓ | ✗ 拼接串比较 | **大** |
| 数值比较 | ✓ | ✗ | **大** |
| 缺失判定 | ✓ | ✗ | **大** |
| 时间比较 | ✓ 5 种 | ✗ | **大** |
| 布尔 + 括号 | ✓ | ✗ | **大** |
| 查询内排序 | ✓ | ✗ | 中 |
| `ALL` / `NONE` | ✓ | ✗ | 小 |
| `IS` 通配 | ✓ 2.25.11+ | ✗ | 中 |
| 大小写 | 全不区分 | 全不区分 | ✓ |
| 多分类 | ReFacets 多面 | 10 分类 | ✓ 相当 |
| 结果去重 | 集合层 | `uniqueSearchSongs()` | ✓ |

`librarySearch.ts` 核心只有两行：

```ts
const needle = query.trim().toLocaleLowerCase()
const matches = (...text) => text.some(v => String(v ?? '').toLowerCase().includes(needle))
```

无词分割、无变音折叠、无通配、无布尔、无比较、无字段限定。

### 7.1 评分与播放历史的复核

| 数据 | foobar2000 | SpMusic | 首轮 | **本轮复核** |
| --- | --- | --- | --- | --- |
| 评分 | `metadb.rating` 百进制，`%rating%` 呈现 1-5 | ✓ `spmusic.track-ratings.v1`，0-5，键 `trackId` | 有 | **有**，刻度不同 |
| 播放次数 | `metadb.playCount` | ✓ `spmusic.most-played.v1` | **说缺** | **修正：不缺** |
| 最后播放 | `metadb.lastPlayed` | ✓ 同上 `lastPlayedAt` | 说缺 | **修正：不缺** |
| 首次播放 | `metadb.firstPlayed` | ✗ | — | **确认缺失** |
| 加入日期 | `metadb.dateAdded` | ✗（`fileCreatedAtMs` 是文件创建时间，语义不同） | — | **确认缺失** |
| **能否进查询** | ✓ | **✗** | — | **这是真实差距** |

**首轮的 P2-D「需先补持久化层」判断应撤回**——数据已经有了，缺的是接线。这把最小实施范围大幅缩小。

## 八、给 SpMusic 的最小实施依据

### 8.1 最小文法（对齐实测分发表）

```
query := expr (SORT [ASC|DESC]ENDING BY pattern)?
expr  := term ((AND|OR) term)*
       | NOT expr
       | '(' expr ')'
term  := field (IS|HAS) str
       | '*' HAS str
       | field (GREATER|LESS|EQUAL) number
       | field (MISSING|PRESENT)
       | time (BEFORE|AFTER|SINCE|DURING) time
       | time DURING LAST number UNIT
       | ALL | NONE
```

### 8.2 联动契约

`{ facet, filter, userFilter, match, sortColumn, ascending, multiFilters }`
+ `%<field>%` 逐值展开
+ 4 个重算触发源（条目增/删/改 + 内容变化）

### 8.3 动态列表契约

`{ id, name, query, clientKind, clientData: Blob, cachedTracks }`
+ 异步 deferred 求值（独立 worker + debounce）
+ 动态→静态 = 求值一次取快照
+ `isDynamic` 标记供 UI 禁用编辑
+ 锁定/所有权检查

## 九、证据强度

### 9.1 第二轮静态结论（保留）

| 结论 | 强度 |
| --- | --- |
| `ALL` 在 2.24.6 已实现 | **强**（字符串 + 表项 + 错误串 + 官方预设使用，双路复算） |
| `NONE` 四版实现、四版未文档 | **强**（同上） |
| 查询运算符分发表结构与位置 | **强**（原始 dword dump） |
| 「播放统计」按通道区分 | **强**（文档 Note 关系 + DDL + 4 个官方预设） |
| 5 条语义约束中的 1/3/4/5 条 | **强**（官方文档原文） |
| ReFacets 属官方 DUI | **强**（字符串 + 修饰名 + 单二进制命中，第三轮运行侧再确认：它列在 Preferences 的官方 viewer 列表里） |
| ReFacets 三层结构 | **强**（修饰名） |
| 动态列表存条件不存结果 | **强**（第三轮已解出 136 B 定义 blob，见 §六） |
| 求值异步 + debounce 存在 | **强**（`runAsync`/`deferOp`/`delay_action` + worker 线程名） |
| `%<field>%` 精确语义 | **中**（符号级 + 配置用法，未到指令级） |
| debounce 具体延时值 | **未知** |
| Columns UI Filter 级联链路 | **未知**（第三方，未反汇编） |

### 9.2 第三轮运行期新增/修正

| 结论 | 强度 | 依据 |
| --- | --- | --- |
| 分发表步长是 **12** 字节（非 16） | **强** | `0x27BE18 − 0x27BE0C = 12`；22 项自洽重列 |
| 原「等价关键字」列作废 | **强** | 该列是 16 字节误读的产物 |
| `ALL` / `NONE` 在 2.24.6 **运行生效** | **强** | `ALL`=20、`NONE`=0 |
| 非法语法静默返回 0，不报错 | **强** | `GENRE IS Rock AND`、`BOGUSOP Rock` 均 0 |
| **`IS` 不是逐分量比较** | **强** | `IS Bystander`/`IS Guest`/`IS A`/`IS B` 全为 0，而这些分量确实存在 |
| **`IS` 不是子串/前缀匹配** | **强** | `IS SpmQ` 只命中整值为 `SpmQ` 的 1 首 |
| **`HAS` 是整串子串匹配** | **强** | `HAS Bystander`=1、`HAS Guest`=1、`HAS Pop`=2 |
| 大小写影响结果数 | **强** | `IS spmq3`=12 vs `IS SpmQ3`=11 |
| **`IS` 多值的归一化形式** | **未知** | 四种候选归一化（首/末/任一分量/整串）**全被实测排除**；最接近的「整串相等 ci」9/10 但差一首 |
| autoplaylist 定义 blob 结构 | **强** | 136 B 逐字段解码（`flags + clientGUID + limit + 长度前缀串 + u64`） |
| autoplaylist 改标签后自动重算 | **强** | 重启后曲目显示改后的 `ARTIST` |
| 规则文本可独立于成员快照改写 | **强** | 改 `sort_pattern` 后 `.fplite` SHA 不变 |
| 分支条件列表的规则位置 | **未知** | 该列表 `props` 为空（0 行），与全库级列表不同 |

### 9.3 一句话总结证据状态

- **能用**：`HAS` 语义、`ALL`/`NONE`、非法语法行为、分发表结构、autoplaylist 定义格式。
- **不能用**：`IS` 在多值字段上的精确语义——**这是本轮唯一没能闭合的语义问题**，
  已知它不是四种自然实现中的任何一种。


## 十、合规

- 不附第三方实现代码（脚本片段仅用于说明语义）
- 不传播二进制、安装包、配置文件
- SQLite 一律 `mode=ro&immutable=1` 只读打开
- 未运行任何 foobar2000 程序
- Columns UI 能力全程标注为第三方，不计入官方能力
- 原始证据在 `.rea-analysis/phase2/run-20261115-p2a/workstream-search/` 与 `workstream-ui/`（已 gitignore）
