---
doc_id: "ARCH-SEARCH-GRAMMAR-GAP-ANALYSIS"
title: "foobar2000 查询语法与 SpMusic 现状的差距分析"
doc_type: "architecture"
status: "draft"
owner_agent: "lead"
version_scope: "research"
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "docs/corpus/foobar2000-disassembly-reference.md"
  - "docs/corpus/foobar2000-search-mechanisms.md"
  - "docs/corpus/foobar2000-foobaka-phase-4-findings.md"
---

# foobar2000 查询语法与 SpMusic 现状的差距分析

> 本文把前几轮逆向出的 foobar2000 查询语义，逐条对照 SpMusic 当前实现，
> 给出「已具备 / 需新增 / 可复用位置」。全部结论来自**只读代码核查**，未运行程序。

## 零、一句话结论

**SpMusic 已经具备 `HAS` 的全部语义，缺的是 `IS`、字段限定、布尔组合三件事。**

而这三件事里，**`IS` 最麻烦**——它和 `HAS` 不是包含关系，是两套并行语义。

## 一、现状：SpMusic 的搜索是什么

`src/features/player/model/librarySearch.ts`（47 行）：

```ts
const needle = query.trim().toLocaleLowerCase()
const matches = (...text) =>
  text.some(v => String(v ?? '').toLocaleLowerCase().includes(needle))
```

行为特征：

| 特征 | 值 |
| --- | --- |
| 匹配方式 | 子串包含 |
| 大小写 | 不敏感（`toLocaleLowerCase`） |
| 作用范围 | **跨字段**（把 name/subtitle 拼起来找） |
| 布尔 | 无（单一关键词） |
| 字段限定 | 无 |
| 通配符 | 无 |

## 二、逐条对照

| # | foobar 能力 | SpMusic | 差距 |
| ---: | --- | --- | --- |
| 1 | `HAS`：子串、不分大小写 | **✓ 已等价** | 无 |
| 2 | `IS`：整值相等、不分大小写 | **✗** | 需新增 |
| 3 | `IS` 通配 `*` `?` | **✗** | 需新增 |
| 4 | 字段限定（`ARTIST IS x`） | **✗** 现在跨字段模糊 | 需新增 |
| 5 | 布尔 `AND` / `OR` / `NOT` + 括号 | **✗** | 需新增 |
| 6 | 数值比较 `GREATER` / `LESS` / `EQUAL` | **✗** | 需新增 |
| 7 | 存在性 `MISSING` / `PRESENT` | **✗** | 需新增 |
| 8 | 时间 `BEFORE` / `AFTER` / `SINCE` / `DURING` | **✗** | 需新增 |
| 9 | `SORT BY` | **✗** | 需新增 |
| 10 | `ALL` / `NONE` | **✗** | 需新增 |

## 三、可复用的现有代码

差距虽多，但**数据侧已经齐了**：

### 3.1 字段已经存在

`AllSongsItem`（`playerUiViewModel.ts:199`）→ `PlaylistTrackItemViewModel`（L138）
→ `PlaylistTrackMetadata`，已暴露这些可直接用于字段限定的值：

| foobar 字段 | SpMusic 现有字段 |
| --- | --- |
| `ARTIST` | `libraryArtistName` / `artist` |
| `ALBUM` | `libraryAlbumName` / `album` |
| `ALBUM ARTIST` | `albumArtist` |
| `GENRE` | `libraryGenreName` |
| `DATE` | `libraryYear` |
| `TRACKNUMBER` | `libraryTrackNumber` |
| `DISCNUMBER` | `libraryDiscNumber` |
| `TITLE` | `title` |
| `COMPOSER` | `libraryComposerName` |
| `PATH` | `sourcePath` |
| `LENGTH` | `durationSeconds` |

**字段层零成本**——不需要新增数据采集，只需在查询层建立「字段名 → 取值」映射。

### 3.2 分类模型已经存在

| 模块 | 行数/大小 | 用途 |
| --- | --- | --- |
| `albumLibrary.ts` | 3,639 B | 专辑分组 |
| `artistLibrary.ts` | 2,380 B | 艺术家分组 |
| `genreLibrary.ts` | 4,877 B | 流派分组 |
| `yearLibrary.ts` | 5,948 B | 年份分组 |
| `folderHierarchy.ts` | 4,599 B | 目录层级 |

这些模块已经把「按字段分组」实现完了，`librarySearch.ts` 直接在其上做过滤。
**联动筛选（facet）可以直接复用它们。**

### 3.3 去重已经正确

`uniqueSearchSongs()` 用 `normalizeAudioSourcePath(song.sourcePath)` 作键：

```ts
const seen = new Set<string>()
return songs.filter(song => {
  const key = normalizeAudioSourcePath(song.sourcePath)
  if (seen.has(key)) return false
  seen.add(key); return true
})
```

> **注意与 foobar 的差异**：foobar 用「子轨索引 + 完整路径」区分 CUE 分轨
> （`0+file://…` / `1+file://…`），这里只用规范化路径。
> **若 SpMusic 引入 CUE 分轨，这个去重键必须改成含子轨索引**，否则分轨会被误合并。

## 四、`IS` 为什么不能简单实现

### 4.1 反汇编得出的 `IS` 语义

`IS` 的匹配器 `0x0063B3B0` 重建后（详见 [反汇编参考](../corpus/foobar2000-disassembly-reference.md) §3.1）：

```c
while (true) {
    if (flag && *ps == ';') return false;
    if (*ps == 0) return false;
    if (*ps == '*') { recurse; }
    if (*vs == 0) return false;
    if (*ps == '?') { ps++; vs++; continue; }
    if (tolower(*vs) != tolower(*ps)) return false;
    ps++; vs++;
}
```

### 4.2 与 `HAS` 的关键差异

| 维度 | `HAS` | `IS` |
| --- | --- | --- |
| 实现字节数 | 200 | **409** |
| 虚表数 | 5 种 | 2 种 |
| 多值遍历 | **无** | **有**（`get_value_count`） |
| 匹配算法 | `[esi+0x68]` 子串 | 上面的通配匹配器 |
| 实测对照 | `HAS Bystander` 命中 | `IS Bystander` **不命中** |

**这决定了实现顺序**：不能「先做子串，再加个整值开关」——
必须把 `HAS` 与 `IS` 当成**两个独立的匹配器**，各自实现、各自测试。

### 4.3 一个尚未解释的实测特例

`ARTIST IS spmq3` = 12 而 `ARTIST IS SpmQ3` = 11。
反汇编重建的算法能复现 7/8 条探针，唯独差这一条。
**建议**：SpMusic 实现 `IS` 时，先按「整串相等 + 大小写不敏感」实现，
把这个特例作为**已知差异**记录在测试用例里，等 foobar 侧有动态调试图。

### 4.4 落地时的三个易错点（均来自逆向实测）

| # | 易错点 | 正确做法 |
| ---: | --- | --- |
| 1 | 以为 `IS` 是 `HAS` 的严格子集 | 两者是**并行语义**，必须各自实现、各自测试 |
| 2 | 把多值字段当数组逐值匹配 | foobar 存储层存的是**单个分号串**；逐值遍历前必须先按 `;` 切分 |
| 3 | 忽略通配符的`*`分支是**递归**的 | 实现时用递归回溯，不是简单的正则替换 |

> 第 2 点尤其关键：第三轮实测 `IS Bystander` = 0，
> 原因**不是**「IS 不逐值」，而是「存储层只有一个值」。
> 若 SpMusic 把多值拆成真数组，行为会与 foobar **不同**。
> 这是一个需要**显式决策**的兼容性分叉点。


## 五、建议的实施顺序

| 步 | 内容 | 依赖 | 风险 |
| ---: | --- | --- | --- |
| 1 | **字段限定**（`ARTIST HAS x`） | 无（字段已齐） | 低 |
| 2 | **布尔组合** `AND`/`OR`/`NOT` | 步 1 | 低 |
| 3 | **`IS` 整值比较**（先不做通配） | 步 1 | 中（语义与 `HAS` 并行） |
| 4 | **通配符** `*` `?` | 步 3 | 中 |
| 5 | **数值比较** `GREATER`/`LESS` | 步 1 | 低 |
| 6 | **存在性** `MISSING`/`PRESENT` | 步 1 | 低 |
| 7 | **`SORT BY`** | 步 1 | 低 |
| 8 | **时间比较** | 需时间字段语义统一 | 高 |
| 9 | **动态列表**（存查询、自动重算） | 步 1–7 | 高 |

> **第 9 步特别注意**：第三轮 + 第四轮已确证，foobar 的动态列表
> **过滤条件不持久化在 profile 的任何 SQLite 里**。
> 若 SpMusic 要做，必须自行设计持久化格式，**不能照抄 foobar 的磁盘布局**。

## 六、明确不做的部分

| 项 | 原因 |
| --- | --- |
| 复刻 `%<field>%` 多值拆分语法 | 只有符号级证据，语义未确认 |
| 复刻 `DURING LAST n UNIT` | 时间语义未闭合 |
| 复刻整个 19 项运算符表 | 应只实现 SpMusic 实际需要的子集 |

## 七、本文的证据边界

| 结论 | 强度 | 依据 |
| --- | --- | --- |
| SpMusic 目前只有子串匹配 | **强** | 直接读 `librarySearch.ts` 全文 |
| 字段数据已齐备 | **强** | 读 `AllSongsItem` 类型定义 |
| `IS` 与 `HAS` 是并行语义 | **强** | 反汇编 + 第三轮实测双重证据 |
| `IS` 的完整精确语义 | **部分** | 重建算法 7/8 吻合，差 1 未解释 |
| 去重键需含子轨索引 | **推断** | 由 foobar 的 `0+`/`1+` 前缀推断，SpMusic 尚无 CUE 分轨实测 |
