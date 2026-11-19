---
doc_id: "ARCH-POWERAMP-ALBUM-SONGS-LIST-OPTIONS"
title: "Poweramp 专辑子页面「列表选项」的组织与实现（专辑歌曲分类）"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 4
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逆向专辑根页面下某个专辑子页面列表头图中「更多」→「列表选项」的组织与实现（附两张实机截图）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/dialogs/ListOptsActivity.smali（1619 行，分组探测）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/rest/library/q.smali（专辑歌曲实体）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/rest/library/{p0,х,l,j,у}.smali（排序/缩放三元组与偏好键）"
  - ".rea-analysis/decoded/res/values/{public,strings}.xml、values-zh-rCN/strings.xml（标签文案）"
  - ".rea-analysis/v1035/decoded/（build-1035 对照）"
  - "docs/corpus/poweramp-list-options.md（弹窗通用机制，本文不重述）"
  - "docs/corpus/poweramp-entity-views.md（专辑实体 j 与 q 的关系）"
---

# Poweramp 专辑子页面「列表选项」的组织与实现

> **本文定位**：只回答**「专辑歌曲」这一个分类**的列表选项。
> 弹窗的三层骨架、8 个分组、能力探测机制、齿轮跳转、持久化总表，全部在
> `poweramp-list-options.md`；本文**不重述**，只补它没覆盖的那一段：
> **从专辑行进入专辑子页面后，列表选项为什么是这一套**。

## 0. 一句话结论

**「列表选项: 专辑歌曲」不是"专辑页面的选项"，而是一个独立实体 `rest/library/q` 的选项。**

专辑实体 `j` 通过 `getFiles()` 懒加载出一个 `q`；`q` 自己不实现任何能力接口，全部继承自
`q → r0 → s0 → o0 → p0` 这条链。**排序组由 `o0` 提供（即基类 `p0.g()` 的 16 项）**，
视图组由 `p0` 的 `х()[I` 提供（10 档）。因此专辑子页面的**排序项集合与「所有歌曲」完全相同**，
但它**读写的是另一套偏好键**（`album_files_sort` / `list_zoom_album_files`），二者互不影响。

实机截图中还能看到 **2 个 `p0` 里没有的项**（"根据年份/专辑"、"编辑标签"？见 §5），
本文逐条对账并给出差异来源。

---

## 1. 入口链路：从专辑行到弹窗

### 1.1 截图对应的两个界面

| 图 | 界面 | 证据 |
| --- | --- | --- |
| 图 1 | 专辑列表页点某一行的「更多」→ 行菜单 | 菜单项：选择文件夹 / 重新扫描 / 专辑封面 / 加入桌面 / 列表选项 |
| 图 2 | 进入专辑子页面后，**页面头部**（大封面下方）的悬浮动作条最右侧 **⋮** | 动作条：随机、播放、搜索、选择、**⋮** |

> 图 1 的行菜单属于`merge_menu_items_lib`；图 2 的页头 `⋮` 属于页头菜单。
> 两者**最终都调用同一个 `cmd_list_options_dialog`**，差别只在"以哪条 URI 作为上下文"。

### 1.2 关键：弹窗拿到的 URI 决定它是"专辑选项"还是"专辑歌曲选项"

```smali
; ListOptsActivity 从 Intent 的 "obj" extra 取实体 URI（不调 getData）
; 然后 v8 = g1.у(uri)  —— 把 URI 解析成实体对象
; 后续全部 instance-of 探测都针对 v8
```

- 从**专辑列表行**打开 → URI 指向 `albums` → 实体是 `rest/library/j`（专辑）
- 从**专辑子页面页头**打开 → URI 指向该专辑的 `files` 子查询 → 实体是 `rest/library/q`（专辑歌曲）

【实证·产物】`rest/library/j.smali:76-88`：`j` 在收到 `"files"` 段时返回内部懒加载的
`q` 的 `P` 字段（`d` 实例），**这正是把"专辑"下钻成"专辑歌曲"的实体切换点**。

### 1.3 标题的组装

弹窗标题 = `@string/list_opts_s`（`0x7f0802c1`，`"列表选项: %s"`）+ 实体自报的名字。

实体名字由 `F0()` 返回：

| 实体 | `F0()` 返回 | 文案 |
| --- | --- | --- |
| `q`（专辑歌曲） | `0x7f08004e` | **`album_songs` =「专辑歌曲」** |
| `j`（专辑） | 见 `j.smali` | 「专辑」 |

【实证·产物】`rest/library/q.smali:52-58`；【实证·原文】`public.xml` / `strings.xml`。

> 这就解释了截图二标题 `列表选项: 专辑歌曲` 的来源——**它是实体自报名，不是页面标题**。
> 同族还有 `artist_album_songs` / `composer_album_songs` / `genre_album_songs` / `year_album_songs`，
> 说明同一套 `q` 被四个"××专辑歌曲"分类复用，各自只换 `q.k0()` 指回的上级实体。

---

## 2. 分组总览：`q` 到底显示哪几组

### 2.1 能力探测的口径（复述一句，细节见主文档）

`ListOptsActivity` 用 **`instance-of`** 逐个探测实体是否实现能力接口：

| 接口 | 分组标题 | 探测行 |
| --- | --- | --- |
| `m2` | 排序 | `ListOptsActivity.smali:481` |
| `d2` | 最大条目数 | `:690` |
| `d3` | 最短时长 | `:760` |
| `e2` | 列表记忆 | `:833`（探测的是 `k0()` 返回值） |
| `r2` | 查看方式（缩放） | `:964` |
| `q2` | 布局（精简标题） | `:1127` |
| `s2` | 布局（紧凑页头） | `:1243` |

### 2.2 `q` 自己一个接口都不实现，全部来自祖先

**类继承链**（`.super`）：

```
q   extends r0  →  s0  →  o0  →  p0  →  х  →  А  →  Object
```

**各层 `.implements`**：

| 类 | implements | 与本文相关的 |
| --- | --- | --- |
| `q` | （无） | — |
| `r0` | `l2` | `l2 → m2` ⇒ **排序** |
| `s0` | `u2, i2, x3, i3, t3, s2` | `s2` ⇒ **布局-紧凑页头**（且 `s2 → r2`） |
| `o0` | `m1, s1, m2, h2, g2, f2, q2, y1` | `m2` ⇒ **排序**；`q2` ⇒ **布局-精简标题**（且 `q2 → r2`） |
| `p0` / `х` / `А` | `х`: `x2, n2`；`А`: `h0` | 均与列表选项无关 |

### 2.3 ★ 关键机制：`r2`（查看方式）是"搭车"得到的

这是本分类最容易被误解的一点。`r2` **不在任何一层的直接 `.implements` 里**，但弹窗的
`instance-of r2` **会命中**——因为两个**接口**继承了它：

```
q2  [interface] implements r2
s2  [interface] implements r2
```

⇒ 只要实体实现了 `q2` **或** `s2`，就**自动**获得 `r2`。

**因此"查看方式"和"布局"在实现上不可分离**：能从属关系上实现布局复选框的类别，
必然也带缩放档位。这解释了既有文档 §6 矩阵中"排序 + 查看 + 布局"总是成组出现。

### 2.4 命中结果

| 组 | 是否命中 | 依据 |
| --- | --- | --- |
| 排序 | ✅ | `r0 implements l2`，`l2 → m2`；另 `o0 implements m2` |
| 查看方式 | ✅ | **间接**：`o0 implements q2`、`s0 implements s2`，且 `q2 → r2`、`s2 → r2` |
| 布局-精简标题 | ✅ | `o0 → q2` |
| 布局-紧凑页头 | ✅ | `s0 → s2` |
| 最大条目数 | ❌ | `d2` 不在链上（`d2` 无子接口，不被间接继承） |
| 最短时长 | ❌ | `d3` 不在链上 |
| 列表记忆 | ❌ | `e2` 不在链上 |
| Home 分类 | ❌ | `у0` 不在链上 |

> **与截图不符的只有一处**：截图二未滚到"布局"区，所以看不到后两组；
> 静态推导表明它们**存在**。

### 2.5 方法实现在哪一层

接口判定通过后，弹窗调用的是**方法**，方法来自**类继承**（与接口无关）：

| 方法 | 声明于 | 说明 |
| --- | --- | --- |
| `m2.d()` | `q`（覆写） | 读 `у.s`，见 §3.4 |
| `r2.r0()` | `q`（覆写） | 读 `у.r0`，见 §4 |
| `r2.х()[I` | `х` | 10 档缩放三元组 |
| `q2.C()` | `х`（抽象）→ `p0` 覆写 | 本分类位索引；`p0:463` 给出具体值 |
| `s2.W0()` / `r2.u([I)` | `х` | 位掩码读写 |

> 注意 `r2` 的 4 个抽象方法分散在 `q` 与 `х` 两处实现，靠类继承拼齐；
> **接口断言通过 ≠ 同一层实现**。

---

## 3. 排序组：16 个三元组逐条对账

### 3.1 三元组来源

`q` 未覆写 `g()`，直接继承 **`p0.g()`**：

```smali
; rest/library/p0.smali:1693-1755
.method public g()[I
    const/16 v0, 0x30            ; 0x30 / 3 = 16 项
    fill-array-data v0, :array_0
```

每个三元组 = `{标题资源 id, sortMode, 附加标志}`。第 3 位非 0 时说明该项**会禁用播放统计**，
弹窗会在该项下方追加一行提示（`ListOptsActivity` 的 `y(...)` 调用，`:1095-1099`）。

### 3.2 全文 16 项（按数组实际顺序）

| # | sortMode | 标签键 | 英文 | 简中 | 第 3 位 |
| ---: | ---: | --- | --- | --- | --- |
| 1 | 0 | `by_track` | By track # | 根据音轨号 | 0 |
| 2 | 0xd | `by_disc_and_track` | By disc and track # | 根据碟片和音轨号 | 0 |
| 3 | 1 | `by_title` | By title | 根据标题 | 0 |
| 4 | 2 | `by_filename` | By filename | 根据文件名 | 0 |
| 5 | 0xe | `by_path` | By path | 根据路径 | 0 |
| 6 | 8 | `by_artist` | By artist | 根据艺术家 | 0 |
| 7 | 9 | `by_album` | By album | 根据专辑 | 0 |
| 8 | 3 | `by_year` | By year | 根据年份 | 0 |
| 9 | 0xf | `by_year_album` | By year/album | 根据年份/专辑 | 0 |
| 10 | 0xc | `by_date_added_to_lib` | By date added to Library | 根据添加到媒体库的日期 | 0 |
| 11 | 4 | `by_date_added_modified` | By date added/modified | 根据添加/修改日期 | `0x7f080207`=`fs_date_time` |
| 12 | 5 | `by_rating` | By rating | 根据星级 | 0 |
| 13 | 0xa | `by_duration` | By duration | 按持续时间 | 0 |
| 14 | 7 | `by_played_at` | By time last played | 根据最后播放时间 | `0x7f08042e`=`play_time_not_updated` |
| 15 | 6 | `by_play_count` | By play count | 根据播放次数 | `0x7f080428`=`play_count_not_updated` |
| 16 | 0xb | `by_shuffle` | By shuffle order | 根据随机顺序 | `0x7f080308`=`matches_actual_shuffle_order` |

### 3.3 与截图的逐行对账

截图二可见 **9 行**（第 9 行被按钮遮挡一半），按顺序：

| 截图 | 本文表 | 判定 |
| --- | --- | --- |
| 根据音轨号（选中） | #1 `by_track` | ✅ |
| 根据碟片和音轨号 | #2 | ✅ |
| 根据标题 | #3 | ✅ |
| 根据文件名 | #4 | ✅ |
| 根据路径 | #5 | ✅ |
| 根据艺术家 | #6 | ✅ |
| 根据专辑 | #7 | ✅ |
| 根据年份 | #8 | ✅ |
| 根据年份/专辑（被截断） | #9 | ✅ |

**顺序、文案、选中项全部吻合**：截图里"根据音轨号"被选中，对应 `sortMode = 0 = by_track`，
即**专辑子页面的默认排序**。

> **结论**：专辑歌曲的排序组 = `p0.g()` 原样 16 项，**没有为专辑场景做任何裁剪或重排**。
> 这与专辑页（`l.g()`，仅 5 项）形成鲜明对比——见 §6。

---

## 4. 查看方式组：10 档缩放

`r2` 由 `п0` 链上的 `х` 提供，`х()[I` 返回 **30 个 int = 10 组三元组**：

```smali
; rest/library/х.smali:1322-1366
const/16 v0, 0x1e          ; 0x1e / 3 = 10 档
```

| 存储值 | 标签键 | 简中 |
| ---: | --- | --- |
| -4 | `grid_1_no_aa_extra_small` | 网格 - 紧凑一行 |
| -3 | `list_1_no_aa_extra_small` | 紧凑单行 |
| -2 | `list_1_no_aa` | 单行 |
| -1 | `list_no_aa` | 列表 - 不显示图像 |
| 0 | `list_compact` | 列表 - 极小 |
| 3 | `list_small` | 列表 - 小 |
| 4 | `list` | 列表 |
| 1 | `grid_extra_small` | 网格 - 极小 |
| 2 | `grid_small` | 网格 - 小 |
| 5 | `grid` | 网格 |

当前值由 `r2.r0()` 读取 → `у.r0` = **`list_zoom_album_files`**（`у.smali:815-821`）。
选中按 `value == 当前值` 精确比对（`ListOptsActivity.smali:1069`），**不是区间匹配**。

---

## 5. 布局组：两个位掩码复选框

`q` 命中两个布局接口，各对应一个独立位掩码偏好：

| 接口 | 方法 | 偏好键 | 位索引 | 语义 |
| --- | --- | --- | --- | --- |
| `q2` | `C()`（`х` 声明 / `p0` 实现） | `у.i` = **`layout_1_line`** | `1 << C()` | 精简标题（单行） |
| `s2` | `W0()`（`х`） | `у.j` = **`layout_header_compact`** | `1 << C()` | 紧凑页头 |

```smali
; rest/library/х.smali:987-1011  —— W0() 就是一次的位测试
sget-object v0, у->j          ; layout_header_compact 位掩码
iget v0, v0, s->А             ; 当前掩码
invoke-virtual {p0}, х->C()I  ; 本分类的位索引
shl-int v1, v2, v1            ; 1 << C()
and-int/2addr v0, v1          ; 取位
return (v0 != 0)
```

> **设计要点**：一个 int 容纳 32 个分类的 1 bit，避免每分类一个布尔键。
> `C()` 在本链上取值见主文档 §4.1（专辑族为 2）。
>
> **附带发现**：当系统字体缩放过大时，`s2` 那一行会被替换成
> `@string/not_avail_for_your_font_scale`（"不可用于您的字体比例"）并置灰
> （`ListOptsActivity.smali:1265-1282`，判据是 `widget/player/x0.u`）。

---

## 6. 与「专辑页」（`j`）的对照——为什么两者完全不同

同一个专辑，**列表页的选项和子页的选项是两套**：

| | 专辑列表页（`l` / `j`） | 专辑子页面（`q`） |
| --- | --- | --- |
| 实体 | `rest/library/j`（`l` 的子类） | `rest/library/q` |
| 排序表 | **`l.g()`，仅 5 项** | `p0.g()`，**16 项** |
| 排序键 | `у.r` = `albums_sort` | `у.s` = **`album_files_sort`** |
| 缩放键 | `у.q0` = `list_zoom_albums` | `у.r0` = **`list_zoom_album_files`** |
| 条目数 | 专辑数 | 该专辑的曲目数 |

`l.g()` 的 5 项（`rest/library/l.smali:526-555`）：

| sortMode | 标签 | 简中 |
| ---: | --- | --- |
| 0 | `by_name` | 根据名称 |
| 3 | `by_artist` | 根据艺术家 |
| 1 | `by_year` | 根据年份 |
| 2 | `by_date_added_to_lib` | 根据添加到媒体库的日期 |
| 4 | `by_num_tracks` | **根据音轨号**（误译，见 §7） |

> **这就是"每个分类的列表选项是独立的"的实现方式**：
> 不是一份选项表配一堆过滤条件，而是**每个实体自己给一份三元组**。
> 所以 `sortMode = 1` 在专辑页是"按年份"，在专辑歌曲页却是"按标题"——**同一个数字含义不同**。

---

## 7. 简中翻译缺陷：两处"根据音轨号"

全库有 **两个不同的 string** 中文本都是「根据音轨号」：

| 键 | 英文 | 简中 | 出现在 |
| --- | --- | --- | --- |
| `by_track` | By track # | 根据音轨号 | 专辑歌曲等曲目列表（`p0.g()` #1） |
| `by_num_tracks` | **By number of tracks** | **根据音轨号** | **专辑列表页**（`l.g()` #5） |

【实证·原文】`values-zh-rCN/strings.xml:157`（`by_num_tracks`）与 `:166`（`by_track`）。

**后果**：在**专辑列表页**的列表选项里，第 5 项"根据音轨号"实际含义是**"按曲目数量排序"**
（`COUNT(files)`），与"按音轨号排序"（`track_number`）语义完全不同。
繁中（`依歌曲數量`）正确，简中误译。

> 这条与主文档 §7.1 记录的是**同一处缺陷的两个面**：那边是"文件夹页第 6 项"，
> 这边是"专辑页第 5 项"。**同一份错误文案被两个分类共用**，因为二者都指向 `by_num_tracks`。

---

## 8. 跨版本核对（build-1035）

| 项 | build-1025 | build-1035 | 结论 |
| --- | --- | --- | --- |
| `q.smali` 是否存在 | ✅ `rest/library/q.smali` | ✅ `ׅ/q.smali` | 均在 |
| 分组探测 | 8 处 `instance-of` | 8 处（类名换为 `mz0`/`dz0`/`rz0`/`qz0`/`sz0`） | **分组集合未变** |

> **注意版本域**：本文 smali 行号一律按 **build-1025**（`.rea-analysis/smali/`）解析；
> 按 `ׅ/q.smali` 去 build-1035 找得到文件，但**行号不通用**。见 `poweramp-corpus-conventions.md` §3。

---

## 9. 对 SpMusic 的可借鉴 / 不建议照抄

### 9.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **选项由实体提供，不由页面提供** | 一个 `ListOptsActivity` 服务 30+ 分类，新增分类不必改弹窗 |
| A2 | **能力用接口探测，不用分类枚举** | `q` 什么接口都没实现，却因祖先实现而正确获得 4 组；写死分类名必然漏 |
| A3 | **每分类独立偏好键** | `albums_sort` vs `album_files_sort`，改专辑排序不会污染专辑内歌曲排序 |
| A4 | **三元组数组而非 switch** | 16 项排序 = 48 个 int 常量，加项只改数据不动逻辑 |

### 9.2 不建议照抄

| # | 做法 | 问题 |
| --- | --- | --- |
| N1 | **sortMode 每分类私有编号** | 同一数字跨分类含义不同，日志/导出/调试时极易误读（见 §6 表格） |
| N2 | **位掩码配 `C()` 位索引** | 分类数超 32 即失效；且 `C()` 返回值没有任何集中登记表 |
| N3 | **文案键复用而不校验** | §7 的误译能在两个分类同时出现，正是因为没人校验"同一文案是否被多个语义复用" |

---

## 10. 未解 / 边界

| # | 问题 | 现状 | 需要什么 |
| --- | --- | --- | --- |
| Q1 | 截图二"专辑歌曲"页的**默认排序为 0（by_track）** 是首访默认还是用户已设？ | 偏好未初始化时 `a30` 用构造默认值；本机实际值不可得 | 真机读 `album_files_sort` |
| Q2 | 布局两组的复选框在截图中不可见（未滚动到） | 静态推导二者均在（`q2`/`s2` 在链上） | 滚动截图确认 |
| Q3 | `C()` 对 `q` 返回的具体位索引未逐类枚举 | 主文档 §4.1 只列了 1/2/5 等示例 | 逐类调用 `C()` 或反读 `х.C()` 覆写 |
| Q4 | `0x100000ca`（`q.m()`）等高 32 位常量语义 | 只知是"带高位标记的资源 id"族 | 见 `poweramp-about-runtime-deps.md` §7 对 `0xf0d01xx` 的解释，此处高位为 `0x10` |

---

## 11. 证据索引

| 主题 | 位置 |
| --- | --- |
| 分组探测（8 处） | `dialog\ListOptsActivity.smali:481/690/760/833/964/1127/1243`（+ `:304/375/416` 为其他用途） |
| 实体标题 | `rest/library/q.smali:52-58`（`F0()` → `0x7f08004e`） |
| 专辑→歌曲切换点 | `rest/library/j.smali:76-88`（`"files"` → `q`） |
| 16 项排序 | `rest/library/p0.smali:1693-1755` |
| 5 项专辑排序 | `rest/library/l.smali:526-555` |
| 10 档缩放 | `rest/library/х.smali:1322-1366` |
| 位掩码位测试 | `rest/library/х.smali:987-1011`（`W0()`） |
| 排序偏好键 | `rest/library/у.smali:487-493`（`album_files_sort`）、`:478-485`（`albums_sort`） |
| 缩放偏好键 | `у.smali:807-821`（`list_zoom_albums` / `list_zoom_album_files`） |
| 位掩码偏好键 | `у.smali:423-429`（`layout_1_line`）、`:431-437`（`layout_header_compact`） |
| 标签资源 | `res/values/public.xml`、`res/values/strings.xml`、`res/values-zh-rCN/strings.xml` |
| 弹窗标题格式 | `0x7f0802c1` = `list_opts_s` |

> 行号口径：全部为 **build-1025** 的 `.rea-analysis/smali/` 之下 `smali/com/maxmpz/…` 文件的物理行号（1 起点）。

---

## 12. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| `poweramp-list-options.md` | **通用机制**：三层骨架、8 分组、能力探测、齿轮跳转、持久化总表、实机验证。本文只补**专辑歌曲分类** |
| `poweramp-entity-views.md` | 专辑/艺术家/作曲家/专辑艺术家**实体与 SQL**；本文只取 `j→q` 的实体切换点 |
| `poweramp-category-views.md` | 年份/流派等容器页；与本文同为"分类页"但选项来源不同（`h4`/`z0`） |
| `poweramp-corpus-conventions.md` | 版本域与命名体系；本文行号**只在 build-1025 下有效** |
