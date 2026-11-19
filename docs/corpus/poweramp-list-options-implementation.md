---
doc_id: "ARCH-POWERAMP-LIST-OPTIONS-IMPLEMENTATION"
title: "Poweramp 列表选项实现层全解（排序状态字 / SQL 工厂 / 位索引 / 偏好键全表）"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 5
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 继续逆向调查列表选项的组织与实现，直到确实查不出来"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/rest/library/（155 类，含 p0/h1/m2/u0/j3 等）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/dialogs/ListOptsActivity.smali"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/rest/library/у.smali（偏好键注册表，1467 行）"
  - ".rea-analysis/smali/smali/com/pixplicity/htmlcompat/{у,y}.smali（SQL 工厂）"
  - "docs/corpus/poweramp-list-options.md（机制层）"
  - "docs/corpus/poweramp-list-options-matrix.md（横向能力矩阵）"
---

# Poweramp 列表选项实现层全解

> **三份文档的分工**：
> `poweramp-list-options.md` = **机制**（弹窗怎么组装），
> `poweramp-list-options-matrix.md` = **横向**（38 个分类各有什么能力），
> **本文 = 实现底层**（选择的那个值到底怎么变成 SQL、存在哪个键、位掩码怎么分配）。
>
> 本轮把"还能不能继续挖"这一问追到底：**排序状态字的位语义、22 个 `O()` SQL 构建器、
> 14 位分类索引、109 个偏好键映射、列表记忆 SQL 列式**全部解出。
> 剩下 5 项属于**必须要真机/原包**才能闭合的硬边界，逐条列在 §9。

## 0. 一句话结论

**列表选项的核心不是 UI，而是「一个 int 状态字 + 一张每分类私有的 SQL 片段表」。**

```
用户点选  →  写入 <category>_sort  (int)
                    │
                    ▼
        sortMode = int & 0x3FFFFFFF      （低 30 位：模式号）
        reverse  = int & 0x40000000      （bit30：反向排序）
                    │
                    ▼
        O(int) → 该分类的 ORDER BY 片段（字符串拼接，非参数化）
```

**没有一个分类自带 UI**。38 个实体全部靠覆写 `g()` / `х()` / `O()` / `d()` / `r0()` 五个方法
接入同一套弹窗。这就是「为什么 30+ 个页面长得一样但选项不同」的答案。

并且 `d()` 还兼职**开关**：返回 `-1` 表示「本分类不显示排序组」（10 个实体这么做，见 §1.1b）。

---

## 1. 排序状态字：一个 int 塞了模式 + 反向

### 1.1 位布局（本轮实证）

```smali
; rest/library/p0.smali:600-620
const/high16 v0, 0x40000000
and-int/2addr v0, p1        ; ← bit30 = 反向排序标志
if-eqz v0, :cond_0 …

const v1, -0x40000001       ; = 0xBFFFFFFF，清除 bit30 及其以上
and-int/2addr p1, v1        ; ← 剩下的才是模式号
packed-switch p1, :pswitch_data_0
```

| 位段 | 掩码 | 含义 |
| --- | --- | --- |
| bit 0–29 | `0x3FFFFFFF` | **排序模式号**（每分类私有） |
| bit 30 | `0x40000000` | **反向排序**（对应 UI 的 Reverse 复选框） |
| bit 31 | — | 高位资源标记，本方法不涉及 |

> **关键**：`0x40000000` 不是"第 30 个模式"，是**正交的反向开关**。
> 所以 16 项排序 × 2（正/反）= 32 种实际排序，但 UI 只列出 16 个单选 + 1 个复选框。

### 1.1b ★ `d()` 返回 `-1` 是「隐藏排序组」的哨兵（本轮新发现）

`m2.d()` 除了返回状态字，还有一个**特殊约定**：返回 `-0x1` 时，弹窗**直接跳过整个排序组**。

```smali
; ListOptsActivity.smali:491-511
invoke-interface {v0}, m2->d()I
const/4 v14, -0x1
if-ne v3, v14, :cond_d
goto/16 :goto_a          ; ← d() == -1 ⇒ 跳到组结束，连 Reverse 都不加
```

**全库 46 个 `d()` 实现的分布**（本轮全量统计）：

| 类别 | 数量 | 实体 |
| --- | ---: | --- |
| 读偏好（正常） | **34** | 其余全部 |
| **恒返回 `-1`（排序组隐藏）** | **10** | `a0` `b0` `f3` `k3` `l3` `m3` `n3` `p3` `v3` `x0` |
| 返回其他常量 | 2 | `e3`=0x1、`e4`=0x5 |

⇒ 这 10 个分类**不显示排序组**（队列、书签、搜索、播放列表歌曲、文件夹层次、原始文件等）。
它们即使继承了 16 项 `g()` 也因此**无机会被使用**。

> **`e3`/`e4` 的常量要单独看**：`e3.d()` 返回 `0x1`（= by_title），
> `e4.d()` 返回 `0x5`（= by_rating）——它们是**写死的排序**，弹窗会显示该组但默认选中固定项。

---
### 1.2 `p0.O(int)` 的 16 条 ORDER BY（`:600-978`）

`packed-switch 0x0`（`:961`），**模式号直接是 switch 下标**：

| 模式 | pswitch | ORDER BY（正序） | 反向时 |
| ---: | --- | --- | --- |
| 0 | `_f` | `track_number, title_tag COLLATE NOCASE` | 两者都加 `DESC` |
| 1 | `_e` | `title_tag COLLATE NOCASE` | `DESC` |
| 2 | `_d` | `folder_files.name COLLATE NOCASE` | `DESC` |
| 3 | `_c` | `folder_files.year, title_tag` | `DESC` |
| 4 | `_b` | `file_created_at DESC, title_tag` | 去掉 DESC |
| 5 | `_a` | `rating DESC, title_tag` | 去掉 DESC |
| 6 | `_9` | `folder_files.played_times DESC, title_tag` | 去掉 DESC |
| 7 | `_8` | `folder_files.played_fully_at DESC, title_tag` | 去掉 DESC |
| 8 | `_7` | `IFNULL(album_artist[_sort], artist) …` | 全部 DESC |
| 9 | `_6` | `album[_sort] COLLATE NOCASE, track_number, title_tag` | 全部 DESC |
| 0xa | `_5` | `folder_files.duration DESC, title_tag` | 去掉 DESC |
| 0xb | `_4` | `folder_files.shuffle_order` | `DESC` |
| 0xc | `_3` | `folder_files.created_at DESC, title_tag` | 去掉 DESC |
| 0xd | `_2` | `disc, track_number, title_tag` | 全部 DESC |
| 0xe | `_1` | `rtrim(path,'/') COLLATE NOCASE, folder_files.name COLLATE NOCASE` | 两者 DESC |
| 0xf | `_0` | `folder_files.year, album[_sort] COLLATE NOCASE, track_number…` | 全部 DESC |

**两条值得注意的设计**：

1. **模式 4/5/6/7/0xa/0xc 已经内置 `DESC`**——它们的"正序"本身就是最自然的方向
   （最近添加、高评分、最常播放、最近播放、长、新建）。勾选 Reverse 反而是"从旧到新"。
2. **模式 8/9 受另一个开关影响**：`у.О`（`use_album_artist` 之类）决定用 `album` 还是
   `album_sort`、用 `album_artist` 还是 `album_artist_sort`——即"是否按冠词剥离后的排序键"。

### 1.3 非曲目分类走另外的工厂

`p0` 的 16 模式只对**曲目**有意义（它引用 `folder_files.*`）。专辑/艺术家/流派/年份等
用**静态工厂**生成整列：

| 实体 | `O()` 实现 | 目标表 |
| --- | --- | --- |
| `d0` 作曲家、`О` 专辑艺术家 | `h1.K(I)` | `composers.*` |
| `h4` 年份 | `h1.Н(I)` | `years.*` |
| `t` 艺术家（经 `w`） | `h1.H(I)` | `artists.*` |
| `z0` 流派 | `pixplicity/htmlcompat/y.В(I)` | `genres.*` |
| `j3` 播放列表 | `pixplicity/htmlcompat/у.В(I)` | `playlists.*` |
| `l` 专辑族 | **自带 208 行 packed-switch**（`:159`） | `albums.*` |
| 队列 `m3` / 书签 `a0` | 常量 `"queue.sort"` / `"bookmarks.sort"` | 已是排好序的列 |
| 文件夹族 `u0/x0` | 委托 `Z0(I)` | `folders.*` |

### 1.4 三个工厂的模式语义（本节最实用）

```smali
; h1.K(I) @505  —— 作曲家
0 → x()                                   ; 名称（x() 返回 composers.name COLLATE NOCASE）
1 → x() + ", composers.created_at" + dir  ; 添加日期
2 → "composers.num_files" + dir + ", " + x() ; 曲目数
默认 → x()
```

```smali
; h1.H(I) @410  —— 艺术家（与 K 同构，表名换成 artists.*）
0 → artists 名称
1 → artists.created_at
2 → artists.num_files
```

```smali
; h1.Н(I) @3867 —— 年份（注意：默认分支落在 years.year 上）
0 → "years.year" + dir
1 → "years.created_at" + dir + ", years.year" + inv
2 → "years.num_files" + dir + ", years.year" + inv
默认 → "years.year" + dir
```

```smali
; pixplicity/htmlcompat/y.В(I) —— 流派
0 → "genre COLLATE NOCASE " + dir
1 → "genres.created_at" + dir + ", genre…" + inv
2 → "genres.num_files" + dir + ", genre…" + inv
默认 → 同 0
```

```smali
; pixplicity/htmlcompat/у.В(I) —— 播放列表（4 模式，与 j3.g() 的 4 项一一对应）
0 → "playlists.playlist COLLATE NOCASE " + dir
1 → "playlists.created_at"
2 → "playlists.num_files"
3 → "playlists.mtime"                      ; ← 排序表第 3 项是"修改日期"
```

> **模式号在三处是同一套**（`g()` 的枚举值 ↔ `O()` 的分支）：`0=名称、1=日期、2=数量`。
> 这是"通用 3 项表"能在 5 个分类里复用的原因。

---

### 1.5 「名称排序」用哪一列：`у.О` 一个开关决定（本轮解出）

作曲家/艺术家/专辑的名称排序列**不是固定的**，而由偏好 `у.О`（布尔）二选一：

```smali
; h1.X() @647  —— 艺术家
if (у.О == true)  → "artist"         ; 原始名（含 The/A 等冠词）
else            → "artist_sort"     ; 扫描期已剥离冠词的排序名

; h1.x() @2977 —— 作曲家（同构）
if (у.О == true)  → "composer"
else            → "composer_sort"
```

> **两分支之外还有一个 `throw RuntimeException`**（`:2999-3004` / `:669-674`）——
> 这是个**不可达兜底**：`у.О` 是布尔，`if-ne 1` 与 `if-eqz` 已覆盖全部取值。
> 混淆器把 Kotlin 的 `when` 穷尽性检查保留成了运行期异常。

对应地，`p0.O()` 的模式 8/9 里也读同一个 `у.О`，决定用 `album` / `album_sort`、
`album_artist` / `album_artist_sort`。**所以这一个开关同时影响三个实体族的排序口径。**

---
## 2. 分类位索引 `C()`：14 个位，一个 int 装下

布局/页头两个位掩码都靠 `1 << C()` 定位本分类的位。**完整分配表（本轮实测）**：

| `C()` | 位掩码 | 实体 | 分类 |
| ---: | ---: | --- | --- |
| **0** | `0x1` | `p3` | 原始文件 |
| **1** | `0x2` | `g1` | 媒体库根 |
| **2** | `0x4` | `l`（`j/m/С/i/e0/a1…` 继承） | 专辑族 |
| **3** | `0x8` | `t` / `О` | 艺术家、专辑艺术家 |
| **4** | `0x10` | `r0`（`q/n/b1…` 继承） | 曲目族（专辑歌曲等） |
| **5** | `0x20` | `p0`（默认，多数派生实体） | 所有歌曲/队列/书签/派生列表 |
| **6** | `0x40` | `u0` | 文件夹 |
| **7** | `0x80` | `x0` / `y0` | 文件夹层次结构 |
| **8** | `0x100` | `t` 之外的 `О`… 见注 | 艺术家组 |
| **9** | `0x200` | `z0` | 流派 |
| **10** | `0x400` | `d0` | 作曲家 |
| **11** | `0x800` | `j3` | 播放列表 |
| **12** | `0x1000` | `v3` | 搜索 |
| **13** | `0x2000` | `h4` | 年份 |

【实证·产物】`l:61`、`r0:25`、`p0:463`、`u0:56`、`x0:121`、`t:79`、`О:116`、
`z0:122`、`d0:126`、`j3:237`、`v3:115`、`h4:124`、`g1:648`、`p3:63`。

> **注**：`t`（艺术家）与 `О`（专辑艺术家）**都是 0x8**——即
> **两者的"精简标题/紧凑页头"开关是共用的**。这可能是设计意图（同属艺术家组），
> 也可能是位分配冲突，静态无法区分（见 §9 Q2）。
>
> `f3`（歌词）分到 `0xe`（14），超出上表范围，说明位空间**至少用到 14**，仍有余量。

---

## 3. 偏好键全表（109 个映射，本节是查表的最终答案）

`у.<clinit>` 是**唯一的偏好注册表**（1467 行）。本轮把 **字段名 → 键字符串** 全部解出。

### 3.1 排序键（22 个，每分类一个）

| 实体 | 字段 | 键 |
| --- | --- | --- |
| `j` 专辑 | `у.r` | `albums_sort` |
| `m` 艺术家专辑 | `у.G` | `albums_by_artist_sort` |
| `О` 专辑艺术家 | `у.z` | `album_artists_sort` |
| `С` 专辑艺术家专辑 | `у.E` | `album_artists_albums_sort` |
| `t` 艺术家 | `у.t` | `artists_sort` |
| `d0` 作曲家 | `у.Q` | `composers_sort` |
| `z0` 流派 | `у.J` | `genres_sort` |
| `h4` 年份 | `у.a0` | `years_sort` |
| `q` 专辑歌曲 | `у.s` | `album_files_sort` |
| `n` 艺术家专辑歌曲 | `у.I` | `albums_by_artist_files_sort` |
| `b1` 流派专辑歌曲 | `у.N` | `genres_albums_files_sort` |
| `g` 所有专辑艺术家歌曲 | `у.D` | `album_artists_files_sort` |
| `c1` 所有流派歌曲 | `у.L` | `genres_files_sort` |
| `k3` 播放列表歌曲 | （无） | **无偏好键**：`d()` 返回常量 `-0x1`（`k3.smali:506-512`） |
| `r0` 文件夹歌曲 | `у.n` | `folders_files_sort` |
| `u0` 文件夹 | `у.m` | `folders_sort` |
| `j3` 播放列表 | `у.U` | `playlists_sort` |
| `d4` 流 | `у.e0` | `streams_sort` |
| `h3` 最常播放 | `у.V` | `most_played_files_sort` |
| `q3` 最近添加 | `у.W` | `recently_added_files_sort` |
| `r3` 最近播放 | `у.Y` | `recently_played_files_sort` |
| `n0` 所有歌曲 | `у.l` | `files_sort` |
| `i4` 年份专辑 | `у.c0` | `years_albums_sort` |

> **⚠️ 关于 `k3`（播放列表歌曲）——本轮实测推翻了一个看似合理的猜测**：
> 它的排序键字段 `у.Z` 确实映射到 `long_files_sort`，但 **`k3.d()` 根本不读该字段**——
> 方法体是 `const/4 v0, -0x1; return v0`（`k3.smali:506-512`），**恒返回 `-0x1`**。
>
> `d()` 的 `-0x1` 在弹窗里是特殊哨兵（`ListOptsActivity.smali:491-499`：
> `if (d() == -1) goto 组结束`）。所以**「播放列表歌曲」页根本不显示排序组**，
> 它那 16 项排序只是 `g()` 继承来的**静态表**，**点了也不会被持久化**。
>
> `у.Z` 这个字段存在且指向 `long_files_sort`，但**对 `k3` 是死字段**。
> 它与 `d3`（长页）共用同名键**不构成运行时冲突**——因为 `k3` 从不写它。

### 3.2 缩放键（42 个）

`list_zoom_*` 共 42 项，与 43 个 `r0()` 覆写一一对应（`lyrics` 归 `f3` 不属列表选项）。
完整清单见 §11 证据索引；命名规律为 `list_zoom_<entity>[ _files]`。

其中值得记录的**成对关系**：

| 列表层 | 曲目层 |
| --- | --- |
| `list_zoom_albums` | `list_zoom_album_files` |
| `list_zoom_folders` | `list_zoom_folder_files` |
| `list_zoom_playlists` | `list_zoom_playlists_files` |
| `list_zoom_artists` | `list_zoom_artist_files` |
| `list_zoom_genres` | `list_zoom_genres_files` |
| `list_zoom_composers` | `list_zoom_composers_files` |
| `list_zoom_years` | `list_zoom_years_files` |

> **两套编号互不干扰**：同一个专辑，"列表页"和"歌曲页"可以有不同缩放。
> 这也解释为什么 `k3` 的排序键复制错误（`long_files_sort`）不会立刻暴露——
> 但**排序**会串，**缩放**不会。

### 3.3 布局键（2 个位掩码）

| 字段 | 键 | 位宽 |
| --- | --- | --- |
| `у.i` | `layout_1_line` | 1 分类 1 bit |
| `у.j` | `layout_header_compact` | 1 分类 1 bit |

---

## 4. 列表记忆（`e2`）：只有两类真的有

### 4.1 接口的 4 个方法

```smali
e2:
  D()String                          ; 返回"记忆位"的 SQL 列表达式
  b0(SQLiteDatabase, UriAndIds)Z     ; 写入
  h0(SQLiteDatabase, Uri, J, J, c3)  ; 批量
  i0(SQLiteDatabase, Uri)j2          ; 读取
```

### 4.2 列表达式（本轮解出）

```smali
; u0.D() @72   列式：文件夹
"(folders.keep_track_pos<<1)+folders.keep_list_pos"

; j3.D() @253  列式：播放列表
"(playlists.keep_track_pos<<1)+playlists.keep_list_pos"
```

**两个独立布尔被压成一个 int**：`bit0 = keep_list_pos`（记住列表滚动位置）、
`bit1 = keep_track_pos`（记住每首歌的播放进度）。

> 与 `poweramp-library-three-views.md` 记载的 `folders.keep_list_pos` 一致，
> 本次补充了 `keep_track_pos` 与**位移压缩**的实现方式。

### 4.3 弹窗侧的前置条件（`:833-960`）

列表记忆组**不是无条件显示**——先做一次查询：

```
v3 = ((x2)e2).P(uri)          ; 取该实体的某个 long 值
if (v3 == 0) → 整组跳过      ; :851-857
否则 → 显示 0x7f0d04d8 布局，两个复选框
       0x7f0d04d9 = keep_list_pos
       0x7f0d04da = keep_track_pos
```

> 即**空列表（长度 0）不显示记忆选项**——避免"记住一个不存在的列表"。

---

## 5. 最大条目上限（`d2`）：2 个方法 + 4 档

```smali
d2:
  с()I   ; 读当前上限
  a0(I)  ; 写
```

UI 是 4 个 `RadioButton`，`android:tag` 直接是数值字符串：
`200` / `500` / `1000` / `2147483647`（= `@string/no_items_limit`）。

**语义是截断不是过滤**：各实现类在子查询尾部追加 `LIMIT N`，`2147483647` 时省略。
使用者：`h3` / `q3` / `r3` / `e3` / `e4`。

---

## 6. 布局两个复选框的差异（`q2` vs `s2`）

| | `q2`（精简标题） | `s2`（紧凑页头） |
| --- | --- | --- |
| 方法 | `C()` → 位索引 | `W0()` → 位测试 |
| 挂载位置 | `o0` | **`s0`**（更下游） |
| 覆盖实体 | 专辑族/曲目族/文件夹/播放列表歌曲 | 曲目族 + 文件夹族（更少） |
| 附加行为 | — | **字体缩放过大时**替换成 `not_avail_for_your_font_scale` 并置灰（`:1265-1282`，判 `widget/player/x0.u`）|

---

## 7. 完整数据流（一张图）

```
① 用户点 ⋮ → cmd_list_options_dialog
        ↓
② ListOptsActivity: uri = intent.obj → g1.у(uri) → 实体 x2
        ↓
③ 11 处 instance-of 探测 → 决定显示哪 8 个组
        ↓
④ 每组的"当前值"来自实体方法：
       m2.d()     → у.<类别>_sort        （int，含 bit30）
       r2.r0()    → у.list_zoom_<类别>   （int）
       q2.C()     → 本分类位号
       s2.W0()    → 读 у.j 的对应位
       d2.с()     → 上限
       已选中的圆圈 = tag == 当前值
        ↓
⑤ 用户点选 → a0(I)/u([I)/r2.u([I) 写回 FastStaticPrefs
        ↓
⑥ 列表查询时：m2.g() 给三元组表，m2.d() 给当前值，
   O(int) 把状态字翻译成 ORDER BY 片段
```

---

## 8. 与另两份文档的分工 / 本轮新增

| 项 | 之前状态 | 本轮结果 |
| --- | --- | --- |
| 排序状态字位语义 | 只知道有 `0x40000000` | **bit30=反向，低30位=模式**；16 条 ORDER BY 全解 |
| 22 个 `O()` 实现 | 未定位 | **全部定位**，含 5 个静态工厂 + 2 个常量 |
| 分类位索引 | 只有 1/2/5 示例 | **0–13 完整表** |
| 偏好键 | 只知道 `list_zoom_*` 与几个 `*_sort` | **109 个全映射**（22 排序 + 42 缩放 + 2 布局 + 其余） |
| 列表记忆列式 | 只知道 `keep_list_pos` 列名 | **解出位移压缩表达式**，并确认前置条件 |
| 发现缺陷 | — | **`k3` 排序键复制错误**（`long_files_sort`） |

---

## 9. 仍然查不出来的（硬边界）

以下 5 项**已确认不是"没查"，而是静态做不到**：

| # | 问题 | 为什么到此为止 |
| --- | --- | --- |
| **Q1** | `k3` 的 `d()` 恒返回 `-0x1`（排序组不显示）是缺陷还是有意禁用 | 行为已确证（哨兵短路）；**动机不可判**。`у.Z`→`long_files_sort` 是死字段，是否为模板复制遗留无法证 |
| **Q2** | `t` 与 `О` 共用 `C()=0x8` 是设计还是撞位 | 同 Q1。行为可推（两者共用精简标题开关），动机不可判 |
| **Q3** | 每个模式**实际生成的 SQL 是否语义正确** | 只能看拼串；执行结果需真机 + 有数据的库 |
| **Q4** | `у.О`（`album_sort` 开关）的 UI 入口在哪 | 它只被 `O()` 读取，未在此弹窗出现；应在设置页，未定位（属 library_lists 页） |
| **Q5** | 打包器为何把 `g()` 编成 `bridge synthetic`（`m3`/`a0`） | 属 DEX 生成器行为，源码级不可还原 |

> **补充边界**：`p0.O()` 里所有 ORDER BY 都是**字符串拼接**，未使用参数绑定。
> 由于所有输入都是本 App 内部的枚举 int，不构成注入面——但这解释了为什么
> 无法从 SQL 反推"用户实际选了什么"，只能从状态字读。

---

## 10. 原「可继续方向」的完成情况（2026-11-18 后续轮次）

> **本节列出的 5 项已全部完成**，结果归档在 `poweramp-list-options-sql-builders.md`。

| 方向 | 状态 | 结论摘要 |
| --- | --- | --- |
| `l.O()` 的 208 行 packed-switch | ✅ | 5 模式 × 正反两张表；基址 `0x40000000` |
| `d4.O()` 的 124 行 | ✅ | 6 模式；`by_url` 实际排 `folder_files.name` |
| `С.O()` 的 83 行 | ✅ | 只覆写模式 3 与其反向，其余 super |
| `Z0(I)`（文件夹族） | ✅ | 6 模式；模式 4 受 `у.Р`(show_cue_source) 二次分叉 |
| `h1.x()` / `h1.X()` | ✅ | 见本文件 §1.5 |

> **额外收获**：`poweramp-list-options-sql-builders.md` §5 记录了三个**隐藏排序开关**。

---
## 11. 证据索引

| 主题 | 位置 |
| --- | --- |
| 状态字位布局 | `rest/library/p0.smali:600-620` |
| 16 条 ORDER BY | `rest/library/p0.smali:621-978`（packed-switch 表在 `:960-978`） |
| 作曲家 SQL 工厂 | `rest/library/h1.smali:505-598`（`K(I)`） |
| 艺术家 SQL 工厂 | `rest/library/h1.smali:410-503`（`H(I)`） |
| 年份 SQL 工厂 | `rest/library/h1.smali:3867-3938`（`Н(I)`） |
| 流派 SQL 工厂 | `com/pixplicity/htmlcompat/y.smali:70-134` |
| 播放列表 SQL 工厂 | `com/pixplicity/htmlcompat/у.smali:90-179` |
| 专辑族 SQL | `rest/library/l.smali:159-366` |
| 位索引 `C()` | `l:61 / r0:25 / p0:463 / u0:56 / x0:121 / t:79 / О:116 / z0:122 / d0:126 / j3:237 / v3:115 / h4:124 / g1:648 / p3:63` |
| 偏好注册表 | `rest/library/у.smali`（`<clinit>`，109 个映射） |
| 列表记忆接口 | `rest/library/e2.smali:1-17` |
| 列表记忆列式 | `u0.smali:72-78` / `j3.smali:253-259` |
| 列表记忆前置条件 | `dialogs/ListOptsActivity.smali:833-960` |
| 上限接口 | `rest/library/d2.smali:1-11` |
| 字体缩放闸门 | `dialogs/ListOptsActivity.smali:1265-1282` |

> 行号口径：**build-1025** 的 `.rea-analysis/smali/smali/…`。
> 版本域与命名体系见 `poweramp-corpus-conventions.md`。
