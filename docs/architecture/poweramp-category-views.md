---
doc_id: "ARCH-POWERAMP-CATEGORY-VIEWS"
title: "Poweramp 容器类分类页参考（年份 / 流派）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-03"
updated: "2026-11-03"
source_documents:
  - "user request: 逆向 Poweramp 媒体库下「年份」「流派」两页的组织方式与多层下钻结构"
  - "shared task: task-15 / task-16"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009) :: SHA-256 4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0"
  - ".rea-analysis/findings-category-views.md（本轮方法体原文 + 偏好键映射）"
  - ".rea-analysis/decoded/res/values/strings.xml（UI 文案）"
  - ".rea-analysis/decoded/res/values/public.xml（R.attr / R.string ID）"
  - "docs/architecture/poweramp-entity-views.md（专辑/艺术家/作曲家，本文承接其 X0 框架）"
  - "docs/architecture/poweramp-recents-views.md（派生列表 + 共用排序映射 p0.O）"
  - "docs/architecture/media-library-page-relationships.md（SpMusic 侧对照）"
---

# Poweramp 容器类分类页参考（年份 / 流派）

## 0. 定位与证据分级

**本文记录外部实现 Poweramp 的「年份」「流派」两页，不是 SpMusic 现状。**

| 标记 | 含义 | 可信度 |
| --- | --- | --- |
| **【实证·产物】** | JADX 反编译方法体原文 | 最高 |
| **【实证·smali】** | 反编译失败时的 smali 原文（本文 §7 偏好键即此级） | 最高 |
| **【实证·原文】** | APK 资源字符串 / public.xml 原文 | 高 |
| **【推断】** | 本文作者推理 | 低 |

### 0.1 两页的核心共性（先看结论）

**年份与流派都是「容器 + 两条并列下钻路径」的四层模型**，这是它们区别于专辑/艺术家的根本特征：

```
第 1 层   容器列表（年份 / 流派）
   ├─ 第 2 层 A：该容器下【全部歌曲】          ← 平铺路径
   └─ 第 2 层 B：该容器下【专辑列表】           ← 分层路径
        └─ 第 3 层：该专辑在该容器内的【歌曲】
```

**专辑与艺术家只有单一路径**（专辑 → 歌曲；艺术家 → 专辑 → 歌曲）。年份和流派额外提供了「直接看全部歌曲」的平铺入口。

原因【推断】：
- 年份没有天然二级组织，用户可能只想「2020 年我都听了什么歌」
- 流派同理
- 但用户也可能想「2020 年 / 摇滚类 有哪些专辑」

**两页的四层结构完全同构**，差异全部收敛到数据层：
- 容器与曲目的关联方式（年份用**值匹配**，流派用**关联表**）
- 排序偏好字段
- JOIN 数量

### 0.2 缺口状态

**本轮已闭环 4 项**（C1 / C2 / C6 / C7），均已升级为【实证·产物】：

| # | 原缺口 | 现状 |
| --- | --- | --- |
| ~~C1~~ | `y.m3143(int)` 流派排序 | ✅ **已闭环**，见 §9.1（3 模式） |
| ~~C2~~ | `h1.m2447(int)` 年份排序 | ✅ **已闭环**，见 §9.2 —— **并发现次级键方向缺陷** |
| ~~C6~~ | `cat_stats.type` 取值 | ✅ **已闭环**：年份 **340**、流派 **210**，见 §9.3 |
| ~~C7~~ | 三个排序函数是否转发到 `p0.O` | ✅ **已闭环**：**各自独立实现**，见 §9.4 |

**仍开放**：

| # | 缺口 | 影响 |
| --- | --- | --- |
| C3 | `a1.U()` / `i4.U()` 返回歌曲字符串是笔误还是有意 | 见 §8（两处同型） |
| C4 | `genre_entries` / `genres` / `years` 表完整 DDL | `findings-db.md` 仅覆盖 `folder_files` |
| C5 | `unknown_genre_name` 对应的哨兵 ID | 类似 `album_artist_id = 1000` |
| C8 | `h1.m2447` 的次级键方向缺陷是否有意（见 §9.2） | 仅当 `years.year` 重复时可见 |

---

## 1. 实体映射

| UI 文案【实证·原文】 | 访问器 | 实体 | 方法数 | 层级 |
| --- | --- | --- | --- | --- |
| `years` = "Years" | `getYears()` | **`h4`** | 48 | 1（容器） |
| （第 2 层 A） | `h4.X` (Lazy) | **`l4`** | 14 | 2A（全部歌曲） |
| `year_albums` = "Year Albums" | `h4.f3330` (Lazy) | **`i4`** | 21 | 2B（专辑） |
| `year_album_songs` = "Year Album Songs" | `i4.f3336` (Lazy) | **`j4`** | 13 | 3（专辑内歌曲） |
| `genres` = "Genres" | `getGenres()` | **`z0`** | 56 | 1（容器） |
| （第 2 层 A） | `z0.X` (Lazy) | **`c1`** | 16 | 2A（全部歌曲） |
| `genre_albums` = "Genre Albums" | `z0.Z0()` | **`a1`** | 21 | 2B（专辑） |
| `genre_album_songs` = "Genre Album Songs" | `a1.f3282` (Lazy) | **`b1`** | 13 | 3（专辑内歌曲） |

### 1.1 导航链（实证）

**年份**
```java
// h4
public final x2 mo2427() { return (l4) this.X.getValue(); }        // → l4
public final q1 A()      { return (i4) this.f3330.getValue(); }    // → i4
// i4
public final x2 mo2427() { return (j4) this.f3336.getValue(); }    // → j4
```

**流派**
```java
// z0
public final x2 mo2427() { return (c1) this.X.getValue(); }        // → c1
public final a1 Z0()     { return (a1) this.f3402.getValue(); }    // → a1
// a1
public final x2 mo2427() { return (b1) this.f3282.getValue(); }    // → b1
```

### 1.2 相关 UI 文案全量【实证·原文】

```
years              = "Years"
year               = "Year"
by_year            = "By year"
by_year_album      = "By year/album"
all_year_songs     = "All Year Songs"
year_albums        = "Year Albums"
year_album         = "Year Album"
year_album_songs   = "Year Album Songs"

genres                  = "Genres"
genre                   = "Genre"
genre_short             = "Genre"
all_genre_songs         = "All Genre Songs"
genre_albums            = "Genre Albums"
genre_album             = "Genre Album"
genre_album_songs       = "Genre Album Songs"
unknown_genre_name      = "Unknown genre"
pref_genres_split_chars = "Symbols to Split Multiple Genres"
pref_genres_split_chars_msg = "One or multiple symbols like ; // $"
```

**标签含义澄清**：`all_year_songs` / `all_genre_songs` 应理解为「**该**年份/流派的全部歌曲」，而非「所有年份/流派的歌曲」。它们是单容器过滤（`years._id = ?` / `genre_id = ?`），跨容器并不成立。

---

## 2. 年份（Years）

### 2.1 第 1 层：容器列表 `h4`

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "years";
    if (!C0742.f3414.f3789) {
        rVar.B("years.num_files");
        rVar.B("!=0 ");
    }
    androidx.appcompat.widget.n.m313(str, f3329, sb, arrayList);
    i1Var.f3335 = "years._id";
    i1Var.B = h1.m2447(C0742.a0.f3810);
    return y;
}
```

```sql
SELECT <y>
FROM years
WHERE years.num_files != 0          -- 当 !C0742.f3414.f3789
  [AND <用户过滤 from f3329>]
GROUP BY years._id
ORDER BY <h1.m2447(years_sort)>
```

**单表零 JOIN**，与艺术家/作曲家同型。`years` 是独立实体表，`num_files` 已预计算。

### 2.2 第 2 层 A：全部歌曲 `l4`

```java
@Override
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    rVar.A = "years INNER JOIN folder_files ON folder_files.year=years.year "
           + "INNER JOIN folders ON folders._id=folder_files.folder_id  "
           + "LEFT JOIN albums  ON albums._id=folder_files.album_id "
           + "LEFT JOIN artists ON artists._id=folder_files.artist_id"
           .concat(C0742.O.f3789
               ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
               : "");
    if (!C0742.f3414.f3789) {
        rVar.B("folder_files.cue_folder_id IS NULL AND ");
    }
    rVar.B("years._id=?");
    String strD = androidx.appcompat.widget.f.d(uri);
    Intrinsics.checkNotNull(strD);
    arrayList.add(strD);
    if (C0742.f1.f3789) { strArr = C0742.f3418.f3789 ? p0.y : p0.f3368; }
    else { strArr = C0742.f3418.f3789 ? p0.x : p0.X; }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(C0742.b0.f3810);
    return p0.f3367;
}
```

```sql
SELECT <p0.f3367>
FROM years
  INNER JOIN folder_files ON folder_files.year = years.year      -- ★ 值匹配
  INNER JOIN folders      ON folders._id = folder_files.folder_id
  LEFT  JOIN albums       ON albums._id  = folder_files.album_id
  LEFT  JOIN artists      ON artists._id = folder_files.artist_id
  [LEFT JOIN album_artists ON album_artists._id = folder_files.album_artist_id]
WHERE [folder_files.cue_folder_id IS NULL AND] years._id = ?
  [AND <用户过滤>]
ORDER BY <p0.O(years_files_sort)>
```

**三个要点**：

1. **关联条件是 `folder_files.year = years.year`（按值比较），不是 ID**
   曲目表直接存 `year` 数值，年份表也存 `year` 数值，按数值相等匹配。
   对比：专辑用 `folder_files.album_id = albums._id`（按 ID）。
   **四种容器中只有年份是按值匹配。**

2. **`INNER JOIN folders` 但 `LEFT JOIN albums/artists`**
   文件夹必需（曲目必属某文件夹），专辑与艺术家可选（元数据可能缺失）。

3. **返回 `p0.f3367`**，与「所有歌曲」同一投影 ⇒ **song 视图**。

### 2.3 第 2 层 B：专辑列表 `i4`

```java
@Override
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "albums INNER JOIN years ON years.year=album_year "
           + "INNER JOIN folder_files ON folder_files.album_id=albums._id "
           + "INNER JOIN artists ON artists._id =folder_files.artist_id "
           + "LEFT JOIN cat_stats ON cat_stats.type=" + b1()
           + " AND cat_stats.ref_id=? AND cat_stats.ref_id2=albums._id"
           .concat(C0742.f3416.f3789
               ? " LEFT JOIN album_artists ON album_artists._id =albums.album_artist_id AND albums.album_artist_id!=1000"
               : "");
    String strD = androidx.appcompat.widget.f.d(uri);
    Intrinsics.checkNotNull(strD);
    arrayList.add(strD);                        // 绑定 cat_stats.ref_id
    rVar.B("years._id");
    rVar.B("=?");
    if (!C0742.f3414.f3789) {
        rVar.B(" AND ");
        rVar.B("folder_files.cue_folder_id IS NULL");
    }
    arrayList.add(strD);                        // 再绑定 years._id  ← 同一值绑定两次
    Z0(str, sb, arrayList, i1Var, l.f3351);
    return l.X;                                 // ★ 专辑投影
}

@Override // com.maxmpz.audioplayer.rest.library.i
public final String a1() {
    return "SELECT albums._id FROM albums INNER JOIN years ON years.year=albums.album_year  WHERE years._id=? GROUP BY albums._id";
}
```

```sql
SELECT <l.X>
FROM albums
  INNER JOIN years        ON years.year = album_year            -- ★ 按 albums.album_year 匹配
  INNER JOIN folder_files ON folder_files.album_id = albums._id
  INNER JOIN artists      ON artists._id = folder_files.artist_id
  LEFT  JOIN cat_stats    ON cat_stats.type = <b1()>
                         AND cat_stats.ref_id = ? AND cat_stats.ref_id2 = albums._id
  [LEFT JOIN album_artists ON ... AND albums.album_artist_id != 1000]
WHERE years._id = ?
  [AND folder_files.cue_folder_id IS NULL]
GROUP BY albums._id
ORDER BY <l.O(years_albums_sort)>
```

**与专辑页同款的 `GROUP BY albums._id` 聚合**，加一层年份过滤。

`a1()` 是同语义的精简版（只取 id），供其他路径复用。

### 2.4 第 3 层：专辑内歌曲 `j4`

```java
@Override // com.maxmpz.audioplayer.rest.library.r0
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    rVar.A = "folder_files INNER JOIN years ON years.year=album_year "
           + "INNER JOIN albums ON albums._id=folder_files.album_id "
           + "INNER JOIN artists ON artists._id=folder_files.artist_id "
           + "INNER JOIN folders ON folders._id=folder_id "
           .concat(C0742.O.f3789
               ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
               : "");
    rVar.B("years._id"); rVar.B("=? AND ");
    rVar.B("albums._id"); rVar.B("=?");
    if (!C0742.f3414.f3789) {
        rVar.B(" AND ");
        rVar.B("folder_files.cue_folder_id IS NULL");
    }
    String encodedPath = uri.getEncodedPath();
    String strB  = androidx.appcompat.widget.f.b(1, encodedPath);   // 位置 1 = year id
    String strB2 = androidx.appcompat.widget.f.b(3, encodedPath);   // 位置 3 = album id
    arrayList.add(strB);
    arrayList.add(strB2);
    if (C0742.f1.f3789) { strArr = C0742.f3418.f3789 ? p0.y : p0.f3368; }
    else { strArr = C0742.f3418.f3789 ? p0.x : p0.X; }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(C0742.d0.f3810);
    return p0.f3367;
}

@Override // x2
public final int Z() { return R.attr.micro_years; }
```

**双条件**：`years._id = ? AND albums._id = ?`。URI 路径位置 1 取年份、位置 3 取专辑。

`Z()` 返回 `R.attr.micro_years` —— 沿用年份分类图标而非专辑图标。

---

## 3. 流派（Genres）

### 3.1 第 1 层：容器列表 `z0`

```java
@Override
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "genres INNER JOIN genre_entries ON genre_entries.genre_id=genres._id "
           + "INNER JOIN folder_files ON folder_files._id=genre_entries.folder_file_id";
    if (!C0742.f3414.f3789) {
        rVar.B("genres.num_files");
        rVar.B("!=0 ");
    }
    androidx.appcompat.widget.n.m313(str, f3401, sb, arrayList);
    i1Var.f3335 = "genres._id";
    i1Var.B = com.pixplicity.htmlcompat.y.m3143(C0742.J.f3810);
    return y;
}
```

```sql
SELECT <y>
FROM genres
  INNER JOIN genre_entries ON genre_entries.genre_id = genres._id
  INNER JOIN folder_files  ON folder_files._id = genre_entries.folder_file_id
WHERE genres.num_files != 0
  [AND <用户过滤 from f3401>]
GROUP BY genres._id
ORDER BY <y.m3143(genres_sort)>
```

### 3.2 关键：`genre_entries` 是曲目↔流派多对多表

**流派首页是「四种容器中唯一需要两个 JOIN 的」**：

| 容器 | 主表 | JOIN 数 | 曲目关联方式 |
| --- | --- | --- | --- |
| 年份 `h4` | `years` | **0** | 曲目有 `year` 标量列 |
| 艺术家 `t` | `artists` | **0** | 曲目有 `artist_id` 单值外键 |
| 作曲家 `d0` | `composers` | **0** | 曲目有 `composer_id` 单值外键 |
| **流派 `z0`** | `genres` | **2** | **一首歌可属多个流派 → 需关联表** |

`genre_entries(genre_id, folder_file_id)` 实现**多对多**，性质与艺术家的 `multi_artists` 相同。

**这正是 `pref_genres_split_chars`（"Symbols to Split Multiple Genres"）的物理承载**：
标签 `"Rock; Pop"` 按分隔符拆成两行，一首歌同时归属 Rock 与 Pop。

> 拆分明细见 `poweramp-entity-views.md` §7.1（艺术家的 `is_unsplit` 双行存储）。流派的拆分机制同族，但流派表**没有** `is_unsplit` 列参与过滤 —— `z0.X0()` 中未见 `is_unsplit` 条件，只有 `num_files != 0`。这是一个差异，含义见 §9 N2。

### 3.3 第 2 层 A：全部歌曲 `c1`

```java
@Override
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    rVar.A = "genre_entries INNER JOIN folder_files ON folder_files._id=folder_file_id "
           + "INNER JOIN folders ON folders._id=folder_files.folder_id  "
           + "LEFT JOIN albums  ON albums._id=folder_files.album_id "
           + "LEFT JOIN artists ON artists._id=folder_files.artist_id"
           .concat(C0742.O.f3789
               ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
               : "");
    if (!C0742.f3414.f3789) {
        rVar.B("folder_files.cue_folder_id IS NULL AND ");
    }
    rVar.B("genre_id=?");
    String strD = androidx.appcompat.widget.f.d(uri);
    Intrinsics.checkNotNull(strD);
    arrayList.add(strD);
    if (C0742.f1.f3789) { strArr = C0742.f3418.f3789 ? p0.y : p0.f3368; }
    else { strArr = C0742.f3418.f3789 ? p0.x : p0.X; }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(C0742.L.f3810);
    return p0.f3367;
}
```

```sql
SELECT <p0.f3367>
FROM genre_entries
  INNER JOIN folder_files ON folder_files._id = folder_file_id
  INNER JOIN folders      ON folders._id = folder_files.folder_id
  LEFT  JOIN albums       ON albums._id  = folder_files.album_id
  LEFT  JOIN artists      ON artists._id = folder_files.artist_id
  [LEFT JOIN album_artists ON album_artists._id = folder_files.album_artist_id]
WHERE [folder_files.cue_folder_id IS NULL AND] genre_id = ?
ORDER BY <p0.O(genres_files_sort)>
```

**主表是 `genre_entries` 而非 `genres`** —— 直接从关联表遍历，无需再 JOIN `genres`（`genre_id` 已在关联表内）。

**与年份 `l4` 的严格同构**：都是单容器条件、都返回 `p0.f3367`、都用 `LEFT JOIN albums/artists` + `INNER JOIN folders`。

### 3.4 第 2 层 B：专辑列表 `a1`

```java
@Override
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "albums INNER JOIN folder_files ON folder_files.album_id=albums._id "
           + "INNER JOIN genre_entries ON folder_file_id=folder_files._id "
           + "INNER JOIN artists ON artists._id =folder_files.artist_id "
           + "LEFT JOIN cat_stats ON cat_stats.type=" + b1()
           + " AND cat_stats.ref_id=? AND cat_stats.ref_id2=albums._id"
           .concat(C0742.f3416.f3789
               ? " LEFT JOIN album_artists ON album_artists._id =albums.album_artist_id AND albums.album_artist_id!=1000"
               : "");
    String strD = androidx.appcompat.widget.f.d(uri);
    Intrinsics.checkNotNull(strD);
    arrayList.add(strD);
    rVar.B("genre_id");
    rVar.B("=?");
    if (!C0742.f3414.f3789) {
        rVar.B(" AND ");
        rVar.B("folder_files.cue_folder_id IS NULL");
    }
    arrayList.add(strD);
    Z0(str, sb, arrayList, i1Var, l.f3351);
    return l.X;
}

@Override // com.maxmpz.audioplayer.rest.library.q1
public final int U() { return R.string.all_genre_songs; }   // ⚠️ 见 §8
```

```sql
SELECT <l.X>
FROM albums
  INNER JOIN folder_files  ON folder_files.album_id = albums._id
  INNER JOIN genre_entries ON folder_file_id = folder_files._id
  INNER JOIN artists       ON artists._id = folder_files.artist_id
  LEFT  JOIN cat_stats     ON cat_stats.type = <b1()>
                          AND cat_stats.ref_id = ? AND cat_stats.ref_id2 = albums._id
  [LEFT JOIN album_artists ON ... AND albums.album_artist_id != 1000]
WHERE genre_id = ?
  [AND folder_files.cue_folder_id IS NULL]
GROUP BY albums._id
ORDER BY <l.O(genres_albums_sort)>
```

**与年份 `i4` 同构**：都是 `GROUP BY albums._id`、都返回 `l.X`、都带 `cat_stats` JOIN、都把同一个值绑定两次（`cat_stats.ref_id` 与容器 id）。

### 3.5 第 3 层：专辑内歌曲 `b1`

```java
@Override // com.maxmpz.audioplayer.rest.library.r0
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    rVar.A = "folder_files INNER JOIN genre_entries ON folder_file_id=folder_files._id "
           + "INNER JOIN genres ON genres._id=genre_id "
           + "INNER JOIN albums ON albums._id=folder_files.album_id "
           + "INNER JOIN artists ON artists._id=folder_files.artist_id "
           + "INNER JOIN folders ON folders._id=folder_id "
           .concat(C0742.O.f3789
               ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
               : "");
    rVar.B("genre_id"); rVar.B("=? AND ");
    rVar.B("albums._id"); rVar.B("=?");
    if (!C0742.f3414.f3789) {
        rVar.B(" AND ");
        rVar.B("folder_files.cue_folder_id IS NULL");
    }
    String encodedPath = uri.getEncodedPath();
    String strB  = androidx.appcompat.widget.f.b(1, encodedPath);   // genre id
    String strB2 = androidx.appcompat.widget.f.b(3, encodedPath);   // album id
    arrayList.add(strB);
    arrayList.add(strB2);
    if (C0742.f1.f3789) { strArr = C0742.f3418.f3789 ? p0.y : p0.f3368; }
    else { strArr = C0742.f3418.f3789 ? p0.x : p0.X; }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(C0742.N.f3810);
    return p0.f3367;
}

@Override // x2
public final int Z() { return R.attr.micro_albums; }
```

**双条件** `genre_id = ? AND albums._id = ?`，与年份 `j4` 完全对应。

---

## 4. 四层结构总表

### 4.1 年份

| 层 | 实体 | 主表 | JOIN | 条件 | 投影 | 排序偏好 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `h4` | `years` | **0** | `num_files != 0` | `y` | `a0` `years_sort` |
| 2A | `l4` | `years` | 4 | `years._id = ?` | `p0.f3367` | `b0` `years_files_sort` |
| 2B | `i4` | `albums` | 4~5 + `GROUP BY` | `years._id = ?` | `l.X` | `c0` `years_albums_sort` |
| 3 | `j4` | `folder_files` | 5 | `years._id = ? AND albums._id = ?` | `p0.f3367` | `d0` `years_albums_files_sort` |

### 4.2 流派

| 层 | 实体 | 主表 | JOIN | 条件 | 投影 | 排序偏好 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `z0` | `genres` | **2** | `num_files != 0` | `y` | `J` `genres_sort` |
| 2A | `c1` | `genre_entries` | 5 | `genre_id = ?` | `p0.f3367` | `L` `genres_files_sort` |
| 2B | `a1` | `albums` | 4~5 + `GROUP BY` | `genre_id = ?` | `l.X` | `M` `genres_albums_sort` |
| 3 | `b1` | `folder_files` | 6 | `genre_id = ? AND albums._id = ?` | `p0.f3367` | `N` `genres_albums_files_sort` |

### 4.3 排序偏好四元组完全同构

| 容器 | 容器列表 | 全部歌曲 | 容器内专辑 | 专辑内歌曲 |
| --- | --- | --- | --- | --- |
| 年份 | `C0742.a0` `years_sort` | `C0742.b0` `years_files_sort` | `C0742.c0` `years_albums_sort` | `C0742.d0` `years_albums_files_sort` |
| 流派 | `C0742.J` `genres_sort` | `C0742.L` `genres_files_sort` | `C0742.M` `genres_albums_sort` | `C0742.N` `genres_albums_files_sort` |

**两套四元组字段名规律完全一致**：`<cat>_sort` / `<cat>_files_sort` / `<cat>_albums_sort` / `<cat>_albums_files_sort`。

> 同族还有：`artists_*`（`t`/`u`/`v`/`w`）、`composers_*`（`Q`/`R`/`S`/`T`）、`album_artists_*`（`z`/`D`/`E`/`F`）。
> 即 **Poweramp 对每个多值分类都生成四个排序偏好**，这是一条贯穿全库的规律。

---

## 5. 四种容器的数据关联方式对照

| 容器 | 曲目如何关联 | 一对多 / 多对多 | 首页 JOIN |
| --- | --- | --- | --- |
| 年份 | `folder_files.year = years.year`（**标量值匹配**） | 一对多 | 0 |
| 艺术家 | 曲目有 `artist_id`（单值外键） | 一对多 | 0 |
| 作曲家 | 曲目有 `composer_id`（单值外键） | 一对多 | 0 |
| 流派 | `genre_entries(genre_id, folder_file_id)` | **多对多** | **2** |

**年份是唯一按「值」而非「ID」关联的容器**，这是它的 `year` 是曲目元数据标量（来自标签）的必然结果。

**流派是唯一多对多**，因此首页必须 JOIN 关联表才能统计 `num_files`。

> 注：艺术家在 `poweramp-entity-views.md` §7.2 中存在 `multi_artists` 关联表，但其**首页 `t.X0()` 并不使用它**（依赖 `artists.num_files` 预计算）。流派的首页则**必须** JOIN 关联表。这是两者的实际差异。

---

## 6. song 视图 vs category 视图

| 层类型 | 投影 | 视图类型 | 证据 |
| --- | --- | --- | --- |
| 第 1 层（容器列表） | `y` | **category** | 行是年份/流派，非曲目 |
| 第 2A 层（全部歌曲） | `p0.f3367` | **song** | 与「所有歌曲」同一投影 |
| 第 2B 层（容器内专辑） | `l.X` | **category** | 与专辑页同一投影 |
| 第 3 层（专辑内歌曲） | `p0.f3367` | **song** | 同上 |

⇒ **四层中两层是 song、两层是 category，交替出现**。这是四层模型的结构特征：每下一层都在「容器 ↔ 曲目」之间切换。

---

## 7. 偏好键全量（smali 实证）

以下取自 `C0742.<clinit>` 的 **smali 原文**（本期 JADX 对 `C0742` 转为 smali，反而比 JVM 反编译更可靠）。

```
years_sort                -> C0742.a0  (fastprefs.w)
years_files_sort          -> C0742.b0  (fastprefs.w)
years_albums_sort         -> C0742.c0  (fastprefs.w)
years_albums_files_sort   -> C0742.d0  (fastprefs.w)

genres_sort               -> C0742.J   (fastprefs.w)
genres_files_sort         -> C0742.L   (fastprefs.w)
genres_albums_sort        -> C0742.M   (fastprefs.w)
genres_albums_files_sort  -> C0742.N   (fastprefs.w)
```

同批确认的相关键：

```
long_files_min_duration       -> C0742.a1
recently_played_from          -> C0742.b1   (fastprefs.z, long)
recently_added_from           -> C0742.c1   (fastprefs.z, long)
most_played_ts_from           -> C0742.d1   (fastprefs.z, long)
most_played_files_limit       -> C0742.f0
top_rated_files_limit         -> C0742.g0
low_rated_files_limit         -> C0742.h0
recently_added_files_limit    -> C0742.i0
recently_played_files_limit   -> C0742.j0
streams_sort                  -> C0742.e0
```

**所有 int 偏好的默认值统一由寄存器 `v3`（`const/4 v3, 0x0`）提供 ⇒ 默认 0。**
XML 的 `android:defaultValue` 是首次启动时写入的另一层（详见 `poweramp-recents-views.md` §9.5）。

---

## 8. 一个实际缺陷：`U()` 返回的文案 ID 与内容不符

### 8.1 现象

| 实体 | `U()` 返回 | `Z()` 返回 | 实际内容 |
| --- | --- | --- | --- |
| `i4`（年份内专辑） | `R.string.all_year_songs` | — | **专辑列表**（`GROUP BY albums._id`，`l.X`） |
| `a1`（流派内专辑） | `R.string.all_genre_songs` | `R.attr.micro_albums` | **专辑列表**（`GROUP BY albums._id`，`l.X`） |
| `l4`（年份内全部歌曲） | — | — | 全部歌曲 |
| `c1`（流派内全部歌曲） | — | — | 全部歌曲 |

**`a1` 与 `i4` 都是「专辑列表」，却返回了「全部歌曲」的字符串 ID。**

### 8.2 为什么判定是缺陷而非有意的

1. `Z()`（图标）对 `a1` 返回 `micro_albums` —— **图标是专辑**，与 SQL 的 `l.X` 一致
2. 若 `U()` 也是专辑语义，应返回 `R.string.genre_albums` / `R.string.year_albums`
3. `strings.xml` 中**同时存在**这三个字符串：`all_genre_songs` / `genre_albums` / `genre_album_songs`
4. `U()` 是 `q1` 接口的「标题」方法，返回字符串资源 id

⇒ **最强的解释是代码引用了错误的字符串常量**（例如复制粘贴邻近类所致）。

### 8.3 影响与证据强度

| 判定 | 强度 |
| --- | --- |
| `a1`/`i4` 的 SQL 返回专辑投影 | 【实证·产物】 |
| `a1.Z()` 返回 `micro_albums` | 【实证·产物】 |
| `U()` 返回歌曲字符串是缺陷 | **【推断】**，无法从静态证据排除「UI 不使用 `U()` 生成标题」 |

---

## 9. 排序函数谱系与缺陷

本轮补齐了三个此前未读的排序函数，并发现其中**一个是独立实现、一个存在方向缺陷**。

### 9.1 `y.m3143(int)` —— 流派排序（**3 模式**）

```java
// com.pixplicity.htmlcompat.y
/* JADX INFO: renamed from: В, reason: contains not printable characters */
public static final String m3143(int i) {
    String str;
    String[] strArr = z0.y;
    String str2 = (1073741824 & i) != 0 ? " DESC" : "";
    int i2 = i & (-1073741825);
    if (i2 == 0) {
        return "genre COLLATE NOCASE ".concat(str2);
    }
    if (i2 == 1) {
        str = "genres.created_at";
    } else {
        if (i2 != 2) {
            return "genre COLLATE NOCASE ".concat(str2);
        }
        str = "genres.num_files";
    }
    return android.support.v4.media.A.m3(str, str2, ", genre COLLATE NOCASE ", str2);
}
```

| 模式 | 默认方向 | 排序键 | 次级键 |
| --- | --- | --- | --- |
| `0` | 升 | `genre COLLATE NOCASE` | — |
| `1` | 升 | `genres.created_at` | `genre COLLATE NOCASE` |
| `2` | 升 | `genres.num_files` | `genre COLLATE NOCASE` |
| `+ 0x40000000` | 降 | 主键与次级键**同步**降序 | |

**次级键方向正确跟随主键**（`str2` 同时传给主键和次级键）。

流派四层（`z0` / `c1` / `a1` / `b1`）**全部**经由 `z0.O(int)` → `y.m3143(i)`：
```java
// z0.O(int)
@Override // m2
public final String O(int i) { return com.pixplicity.htmlcompat.y.m3143(i); }
```

> `int i2` 的 `default` 分支回落到模式 0（`genre`），与 `p0.O` 相同。

### 9.2 `h1.m2447(int)` —— 年份排序（**3 模式，次级键方向缺陷**）

```java
// com.maxmpz.audioplayer.rest.library.h1
/* JADX INFO: renamed from: Н, reason: contains not printable characters */
public static String m2447(int i) {
    String str;
    int i2 = 1073741824 & i;
    String str2 = i2 == 0 ? " DESC" : "";      // ★ 主键：无 DESC 位 → DESC
    String str3 = i2 != 0 ? " DESC" : "";      // ★ 次级键：有 DESC 位 → DESC
    int i3 = i & (-1073741825);
    if (i3 == 0) {
        return "years.year".concat(str2);
    }
    if (i3 == 1) {
        str = "years.created_at";
    } else {
        if (i3 != 2) {
            return "years.year".concat(str2);
        }
        str = "years.num_files";
    }
    return android.support.v4.media.A.m3(str, str3, ", years.year", str2);
}
```

**注意 `str2` 与 `str3` 是两个方向相反的变量**：

| DESC 位 | 主键方向（`str2`/`str3` 用于主键时） | 次级键方向 |
| --- | --- | --- |
| **未设**（`i2 == 0`） | `str2 = " DESC"` ⇒ **降** | `str3 = ""` ⇒ **升** |
| **设**（`i2 != 0`） | `str2 = ""` ⇒ **升** | `str3 = " DESC"` ⇒ **降** |

即 **主键与次级键方向永远相反**，且**默认（无 DESC 位）是降序**。

#### 与其它三个函数的对照

| 函数 | 用途 | 模式数 | 无 DESC 位时主键 | 次级键方向 |
| --- | --- | --- | --- | --- |
| `y.m3143` | 流派 | 3 | **升** | 跟随主键 |
| `h1.H` | 艺术家 | 3 | **升** | 跟随主键 |
| `h1.K` | 作曲家 | 3 | **升** | 跟随主键 |
| **`h1.m2447`** | **年份** | **3** | **降** | **与主键相反** |

⇒ **`m2447` 在两个方面都与同族函数不一致**：默认方向相反、次级键方向相反。

#### 实际影响

| 判定 | 强度 |
| --- | --- |
| `str2` 与 `str3` 方向相反 | **【实证·产物】**（三行代码直接可见） |
| 主键与次级键会输出相反方向 | **【实证·产物】** |
| **用户实际看不到异常** | **【推断】** —— `years.year` 若恒唯一，次级键不参与排序，缺陷不可见；仅当 `years.year` 出现重复（如 NULL 年份被归一为同一值）时，排序才不稳定 |

⇒ 这属于**潜伏缺陷**：默认降序恰好符合「年份从新到旧」的直觉预期，所以界面看起来正常；一旦数据异常（`year` 重复或为 NULL），排序列会退化为「主键升 / 次级键降」的错乱组合。

### 9.3 `cat_stats.type` 的取值（**位掩码，非常量**）

`i4` / `a1` 的 `cat_stats.type` 来自父类 `i.b1()`：

```java
// com.maxmpz.audioplayer.rest.library.i  —— 公共抽象父类
public final int b1() {
    return m() & 268435455;          // & 0x0FFFFFFF
}
```

各实体覆写 `m()` 提供常量，再由 `b1()` 取低 28 位：

```java
// i4.m()
@Override // x2
public final int m() { return 268435796; }    // 0x10000154

// a1.m()
@Override // x2
public final int m() { return 268435666; }    // 0x100000D2
```

| 实体 | 层级 | `m()` | `m() & 0x0FFFFFFF` | `cat_stats.type` |
| --- | --- | --- | --- | --- |
| **`i4`** | 年份内专辑 | `268435796` = `0x10000154` | `0x154` | **340** |
| **`a1`** | 流派内专辑 | `268435666` = `0x100000D2` | `0xD2` | **210** |

**高位 `>>28` 均为 `1`**，低 28 位落在 `0x000000D2`–`0x00000154`（210–340）区间。

⇒ `cat_stats.type` **不是简单枚举 `0/1/2`**，而是一个**位域编码的分类类型号**：高位区段标志 + 低 28 位分类 id。两个并列层级（第 2B 层）**各有独立的统计类型**，互不干扰。

`cat_stats(ref_id, ref_id2)` 同时绑定容器 id 与 `albums._id`，说明统计粒度是**「容器 × 专辑」**这一组合。

### 9.4 三个排序函数**各自独立实现**，非转发（C7 闭环）

| 函数 | 实现方式 | 与 `p0.O` 的关系 |
| --- | --- | --- |
| `p0.O(int)` | 16 个模式，覆盖 song 视图全部排序 | 基准 |
| `y.m3143(int)` | 3 个模式，`genre` / `created_at` / `num_files` | **独立** |
| `h1.m2447(int)` | 3 个模式，`years.year` / `created_at` / `num_files` | **独立** |
| `h1.H(int)` | 3 个模式（艺术家） | **独立** |
| `h1.K(int)` | 3 个模式（作曲家） | **独立** |

**结构规律**：

| 视图类型 | 排序函数 | 模式数 | 排序依据 |
| --- | --- | --- | --- |
| **category 视图**（容器列） | `y.m3143` / `h1.m2447` / `h1.H` / `h1.K` | **3** | 名称 / `created_at` / `num_files` |
| **song 视图**（曲目列） | `p0.O` | **16** | 音轨号/标题/文件名/年份/添加时间/评分/播放次数/… |

⇒ **不是"转发到统一实现"，而是"按视图类型分成两族，各自独立"**。
category 视图只需要「按名称/按添加时间/按曲目数」三种就够了（容器没有音轨号、时长等概念）；song 视图需要 16 种。

这也解释了为什么 `z0.O(int)` 只是简单转发 —— 它在两族之间做了一行桥接，而不是复用 `p0.O`。

---

## 10. 可借鉴 / 不建议照抄

### 10.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **容器提供「平铺」与「分层」两条并列路径** | 年份/流派没有天然二级单位，用户诉求两极化；两个入口比强行二选一更合理 |
| A2 | **四层共用一套 `X0` 钩子 + `i1` 查询描述符** | 差异全部收敛到表名/JOIN 串/投影数组/排序偏好，无分支爆炸 |
| A3 | **排序偏好按「容器 × 层级」四元组生成** | 用户在「流派列表」和「流派内歌曲」想要的排序往往不同；四个独立偏好避免互相干扰 |
| A4 | **多对多关联表（`genre_entries`）+ 预计算 `num_files`** | 首页用 `num_files` 过滤（O(1)），下钻才走关联表；兼顾首屏性能与正确性 |
| A5 | **容器过滤统一放在 `WHERE`，聚合统一用 `GROUP BY <容器>._id`** | 第 1/2B 层用 GROUP BY，第 2A/3 层不用，规则清晰 |
| A6 | **`p0.f3367` 投影复用** | 所有 song 层共用同一投影，前端渲染组件可完全复用 |

### 10.2 不建议照抄

| # | 做法 | 理由 |
| --- | --- | --- |
| N1 | **`U()` 文案 ID 与实体内容不符**（`a1`/`i4`） | 见 §8。应在类型层面区分「容器标题」与「歌曲列表标题」 |
| N2 | **流派无 `is_unsplit` 过滤，但艺术家/作曲家都有** | 三个多值分类的处理不一致。流派若也支持拆分，为何不需要「显示合并行」开关？语义未对齐 |
| N3 | **同一个值被 `arrayList.add()` 两次**（`i4`/`a1` 的 `cat_stats.ref_id` 与容器 id） | 依赖「两处参数恰好相同」的隐式约定，可读性与健壮性差。应显式注释或分离参数 |
| N4 | **`z0.O(int)` 与 `z0.X0()` 分别委托 `y.m3143()`** | 排序表达式构造散落在被委托类中，追踪成本高 |
| N5 | **年份用值匹配（`folder_files.year = years.year`）** | 值匹配无法利用索引友好性；若 `year` 出现 NULL 或多值会出问题。用 `year_id` 外键更稳 |
| **N6** | **`h1.m2447` 的次级键方向与主键相反**（见 §9.2） | 同族四个排序函数中唯一不一致者。且默认方向也与其他三个相反（默认降序）。属于潜伏缺陷：`years.year` 唯一时不可见，数据异常时排序错乱 |
| **N7** | **同类排序函数分散在三个不同类**（`p0.O` / `y.m3143` / `h1.*`） | 两族逻辑高度相似（都是「清 DESC 位 + switch + 拼次级键」），却在三个类中重复实现。`m2447` 的方向缺陷很可能正是重复实现导致的抄写错误 |
| **N8** | **`cat_stats.type` 用位域编码且依赖父类 `b1()` 掩码提取** | `m()` 返回魔数 `0x10000154` / `0x100000D2`，经 `& 0x0FFFFFFF` 才得到 340 / 210。可读性极差，且无法从常量字面值直观看出分类类型 |

---

## 11. 与 SpMusic 对照

### 11.1 SpMusic 现状

`src/features/player/model/mediaLibraryCategories.ts` 定义 12 个分类，含：

| id | label |
| --- | --- |
| `year` | **年份** |
| `genre` | **流派** |

**两者均只有分类定义与根菜单图标，无任何面板组件**（`components/` 下无 `Year*` / `Genre*` 组件）。

### 11.2 维度对照

| # | 维度 | Poweramp | SpMusic 现状 |
| --- | --- | --- | --- |
| 1 | 年份/流派页 | 两个完整四层模型 | **两个占位分类** |
| 2 | 容器→曲目关联 | 年份值匹配 / 流派关联表 | 无 |
| 3 | 多流派拆分 | `pref_genres_split_chars` + `genre_entries` | 无（单字符串） |
| 4 | 下钻路径 | **平铺 + 分层并列** | 无 |
| 5 | 排序偏好 | 每个容器 4 个独立偏好 | 单一 `compareByQuickIndex` |
| 6 | 投影复用 | song 层统一 `p0.f3367` | — |
| 7 | 预计算计数 | `years.num_files` / `genres.num_files` | 无 |

### 11.3 核心差异与最小实现建议

**Poweramp 的四层模型本质是「一个容器筛选 × 两种呈现粒度」。**

若 SpMusic 实现，最小方案：

| 层 | 实现方式 | 是否需新表 |
| --- | --- | --- |
| 容器列表 | 对曲目元数据 GROUP BY `year` / `genre` | **否** |
| 全部歌曲 | 曲目过滤 `year == x` / `genre 包含 x` | **否** |
| 容器内专辑 | 曲目过滤后 GROUP BY `album` | **否** |
| 专辑内歌曲 | 曲目过滤 `year == x && album == y` | **否** |

⇒ 前 3 层用**纯前端筛选**即可，无需新增表。
⇒ 只有「多流派」需要把 `genre` 从单字符串改为数组/关联结构。

---

## 12. 未解

### 12.1 本轮已闭环（4 项）

| # | 原问题 | 结论 | 证据位置 |
| --- | --- | --- | --- |
| ~~C1~~ | `y.m3143(int)` 流派排序映射 | 3 模式：`genre` / `genres.created_at` / `genres.num_files` | §9.1 |
| ~~C2~~ | `h1.m2447(int)` 年份排序映射 | 3 模式，**且次级键方向与主键相反** | §9.2 |
| ~~C6~~ | `cat_stats.type` 取值 | 年份 **340**、流派 **210**（`m() & 0x0FFFFFFF` 提取） | §9.3 |
| ~~C7~~ | 三个排序函数是否转发到 `p0.O` | **各自独立实现**；分 category 族（3 模式）与 song 族（16 模式） | §9.4 |

### 12.2 仍开放

| # | 问题 | 优先级 |
| --- | --- | --- |
| C3 | `a1.U()` / `i4.U()` 返回歌曲字符串是否有意（见 §8） | 中 |
| C4 | `genre_entries` / `genres` / `years` 表 DDL | 中 |
| C5 | `unknown_genre_name` 的哨兵 id（对照 `album_artist_id = 1000`） | 低 |
| **C8** | `h1.m2447` 次级键方向缺陷是否纯属笔误（见 §9.2 / N6） | 低 |
| C9 | `cat_stats.type` 高位 `>>28 == 1` 的含义 | 低 |
| C10 | 流派为何无 `is_unsplit` 过滤（艺术家/作曲家都有，见 §3.2） | 中 |

---

## 13. Evidence ID 索引

| 主题 | Evidence ID |
| --- | --- |
| **`y.m3143`（流派排序 3 模式）+ `y` 类摘要** | `ev_45deecf8920769141b8636859f44cfd81bb3bd8e1525d30dcbbb9fbc3cbd9af5` |
| **`h1.m2447`（年份排序 3 模式，次级键方向缺陷）** | `ev_810d4e35972ceab350ee904ac53958428a12d246c057e078aa6ec67e532ac343` |
| **`i.b1`（`m() & 0x0FFFFFFF` 掩码提取）** | `ev_9b62b2c26e51e6b2fe25db58cdbf3f6bce24df7c83a6348fe5dc02c74399eee3` |
| **`i4.m`（`0x10000154` ⇒ type 340）** | `ev_4de42c2d40ea47941ed2afc9b639be44c215fa7fb95feeb46da5fec93a716171` |
| **`a1.m`（`0x100000D2` ⇒ type 210）** | `ev_859cb756e4b4ded382cb2f5bdfeb5c176938315a6eaae868a285f9de5958530d` |
| **`h4.X0`（年份列表）+ 类摘要** | `ev_445ab65a10ede03f8c2ace43c42bdbbcdf657e62417c2f0a11f6d8b9ac37d4e8` |
| `h4.A`（→ `i4`） | `ev_6aaf56d0c45ccd7cff1c974f0572b285208389f556159708d96d30867ed88f40` |
| `h4.mo2427`（→ `l4`） | `ev_8e6236f09041080842e49ea1910103afb84ce5eca2602a8c78c8176b81c6b57c` |
| **`i4.X0`（Year Albums）** | `ev_27aa73fc2518010972d36ffcc2053b68e35df51d5b7104df630b1af1848ba9ec` |
| `i4.U`（`all_year_songs`） | `ev_9fae1051e01f4846dea9094e5c1c88858eff1b69db12a7f23fc0065b6cd3f3f2` |
| `i4.a1`（精简 SQL） | `ev_81ea41b16d91d5b6089d641953b8b8519f171ca579a22c87732b12ee7e4ec2e7` |
| `i4.d`（`years_albums_sort`） | `ev_aaefcb9b1df92f4d91f6265d05d505a4af55bdce5d15424e972bfe4d9fe980f3` |
| `i4.mo2427`（→ `j4`） | `ev_668b0694e5fff072fd5a8f3cdaa997b8567441f33defef4b967997cb3c926162` |
| **`j4.X0`（Year Album Songs）** | `ev_841d6806392e0e1617c689585f6e617b48e8721fe75b2d4e4e67888b589653ae` |
| `j4.Z`（`micro_years`） | `ev_307e6385fbc1d2bc54c7bc0a41ff6593b73d33a8b765e46a889fa4635b72843c` |
| `j4.k0`（→ `i4`） | `ev_9a04cf59119bcca0b88e08c74dc5d884521a9e396c4b4c369207339005ba8b36` |
| **`l4.X0`（All Year Songs）** | `ev_05d8574ad6420a8028f919ea95b6330624df96b199fa2a5b4254e413417aebd7` |
| **`z0.X0`（流派列表）** | `ev_d2cc951bb732f9f75fde8297daf9e91254ee25721a6b4e3adfa1434d1dd5f303` |
| `z0.Z0`（→ `a1`） | `ev_a930f72524ea247c78e3a3e27bcb8fd1231fc4d97e17c147ff6aa39019d1b158` |
| `z0.mo2427`（→ `c1`） | `ev_67d44ff12be352eea2c254763df0f744557958a25fbc81c33ba525592e77cbd4` |
| `z0.O`（委托 `y.m3143`） | `ev_723539273809e33e0c83a35c2d59d4aed5476d2bdb4431fb835bc9dd9ed5dc59` |
| **`a1.X0`（Genre Albums）** | `ev_28d36789a306af64708c49f6de98ea2c973c0dccf06dec3e13dfb8a773ea3559` |
| `a1.U`（`all_genre_songs`） | `ev_a973141986be0eb4c5d02013fd450c9a0d5b8147f8671734270dd832fadc3149` |
| `a1.mo2427`（→ `b1`） | `ev_c64274d32cf88ad196f65268f6b1336c42c0b7e665ce3c725f84550362f2013b` |
| **`b1.X0`（Genre Album Songs）** | `ev_2a24511028b323ce5c201763903193aaf474c71e4a0e070f734ca3fbb25c1eab` |
| `b1.Z`（`micro_albums`） | `ev_0768301db709760164172ada66aa03ec5fbaf9e783a0eea0ca14b0231fb601c1` |
| **`c1.X0`（All Genre Songs）** | `ev_d5aea3c66653eabcfd15ab24061335a3730100a008121b2757ac101db89b0224` |
| **`C0742.<clinit>`（smali，偏好键全量）** | `ev_e4e5a4b1ea51d48548ba91d2a9a9b20034c02e5ce69d58e20dd4bd5c0542b6e1` |

资源来源：`.rea-analysis/decoded/res/values/strings.xml`、`.rea-analysis/decoded/res/values/public.xml`（apktool 3.0.3，已入库）。
复现命令：
```
apktool d --no-src -f -o .rea-analysis/decoded .rea-analysis/Poweramp-v3.apk
```

---

## 14. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| `poweramp-entity-views.md` | 专辑/艺术家/专辑艺术家/作曲家（单层 category + 单一下钻路径）。本文承接其 `X0` 框架，只覆盖**年份/流派**这两个**双路径四层**容器 |
| `poweramp-recents-views.md` | 派生/筛选列表（最近播放/添加/最多播放/长/评分）+ 共用排序映射 `p0.O(int)`。本文 §4/§6 引用其投影与排序结论 |
| `poweramp-library-three-views.md` | 所有歌曲/文件夹/文件夹层次结构。本文的 song 层投影 `p0.f3367` 与其「所有歌曲」同源 |
| `poweramp-queue-runtime-reference.md` | 队列状态机。无重叠 |
| `poweramp-search-and-queue-impact.md` | 搜索。其子分类下钻与本文容器下钻机制不同，仅交叉引用 |
| `poweramp-audio-settings-structure.md` | 音频设置。本文 §7 的 `pref_genres_split_chars` 属库设置，无重叠 |
| `media-library-page-relationships.md` | SpMusic 三页面现状。本文 §10 只做对照 |
