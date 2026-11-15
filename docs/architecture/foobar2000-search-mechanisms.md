---
doc_id: "ARCH-FOOBAR2000-SEARCH-MECHANISMS"
title: "foobar2000 检索语法与动态列表机制（实测）"
doc_type: "architecture-research"
status: "draft"
owner_agent: "Architecture Agent"
version_scope: "research"
created: "2026-11-15"
updated: "2026-11-15"
source_documents:
  - "docs/tasks/foobar2000-foobaka-ds-phase-2-plan.md"
  - "docs/architecture/foobar2000-foobaka-phase-2-findings.md"
  - ".rea-analysis/phase2/run-20261115-p2a/workstream-search/REPORT-search-and-dynamic-lists.md"
  - ".rea-analysis/phase2/run-20261115-p2a/workstream-ui/raw/REFACETS-EVIDENCE.md"
  - ".rea-analysis/phase2/run-20261115-p2a/workstream-ui/raw/AUTOPLAYLIST-EVIDENCE.md"
---

# foobar2000 检索与动态列表机制实测

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

## 一、查询运算符分发表的结构

A′ 2.24.6 的 `.rdata` `0x27BD40`–`0x27BE28` 是一条**定长表**，每项 16 字节：

```
[+0x00] u32  关键字串 VA
[+0x04] u32  flags（SORT 为 1，其余 0）
[+0x08] u32  handler1（.text 处理函数）
[+0x0C] u32  等价关键字串 VA
```

实测表项（节选）：

| file 偏移 | 关键字 | flags | handler1 | 等价串 |
| --- | --- | ---: | --- | --- |
| `0x27BD40` | `SORT` | 1 | `0x0058EB90` | `ORDER` |
| `0x27BD70` | `NOT` | 0 | `0x0058C6A0` | `HAS` |
| `0x27BDA0` | `EQUAL` | 0 | `0x0058D5A0` | `GREATER` |
| `0x27BDD0` | `PRESENT` | 0 | `0x0058CAA0` | `BEFORE` |
| `0x27BE00` | `DURING` | 0 | `0x0058E4F0` | `ALL` |

> 「等价串」列是按表项 `+0x0C` 字段机械读出并解成字符串的结果，**本轮未反汇编验证其运行时语义**。例如 `ORDER` 是否真是 `SORT` 的别名，属**待验证**。

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
| 2 | **`IS` 必须在单值层比较**，多值逐值、不拼接 | 官方原文：`artist IS name1` 命中双艺人曲目，`%artist% IS name1` **不命中** |
| 3 | **`SORT BY` 必须在查询末尾** | 运算符表注 `Must be at the end of the query` |
| 4 | **关键字全大写**，值不区分大小写 | 官方原文 |
| 5 | **`* HAS` 复用简单搜索语义**（含文件名与路径） | 官方原文 |

**第 2 条是最容易做错的一条**，也是「合作艺人出现在多个分类、结果只出现一次」的根本保证。

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
2. `IS` 在**单值层**比较（见 §三约束 2）
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

> **未知**：那 16 字节 blob 的编码格式。它在 A′/B 全部二进制里 0 命中，**静态解不出**。查询串可能编码在此或 `.fplite` 里。

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

| 结论 | 强度 |
| --- | --- |
| `ALL` 在 2.24.6 已实现 | **强**（字符串 + 表项 + 错误串 + 官方预设使用，双路复算） |
| `NONE` 四版实现、四版未文档 | **强**（同上） |
| 查询运算符分发表结构与位置 | **强**（原始 dword dump） |
| 「播放统计」按通道区分 | **强**（文档 Note 关系 + DDL + 4 个官方预设） |
| 5 条语义约束 | **强**（官方文档原文） |
| ReFacets 属官方 DUI | **强**（字符串 + 修饰名 + 单二进制命中） |
| ReFacets 三层结构 | **强**（修饰名） |
| 动态列表存条件不存结果 | **强**（`Could not restore` + `criteriaChanged` + 两层文件分离） |
| 求值异步 + debounce 存在 | **强**（`runAsync`/`deferOp`/`delay_action` + worker 线程名） |
| `%<field>%` 精确语义 | **中**（符号级 + 配置用法，未到指令级） |
| 分发表「等价串」列的运行时语义 | **待验证**（按 `+0x0C` 字段机械读出） |
| `props.data` 16B blob 编码 | **未知** |
| debounce 具体延时值 | **未知** |
| Columns UI Filter 级联链路 | **未知**（第三方，未反汇编） |

## 十、合规

- 不附第三方实现代码（脚本片段仅用于说明语义）
- 不传播二进制、安装包、配置文件
- SQLite 一律 `mode=ro&immutable=1` 只读打开
- 未运行任何 foobar2000 程序
- Columns UI 能力全程标注为第三方，不计入官方能力
- 原始证据在 `.rea-analysis/phase2/run-20261115-p2a/workstream-search/` 与 `workstream-ui/`（已 gitignore）
