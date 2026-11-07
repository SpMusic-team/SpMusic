---
doc_id: "ARCH-POWERAMP-ENTITY-VIEWS"
title: "Poweramp 媒体库实体视图参考（专辑 / 艺术家 / 专辑艺术家 / 作曲家）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-10-28"
updated: "2026-10-28"
source_documents:
  - "user request: 逆向 Poweramp 媒体库下「专辑」「艺术家」「专辑艺术家」「作曲家」四类页面的组织方式"
  - "shared task: task-12"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009) :: SHA-256 4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0"
  - ".rea-analysis/findings-entity-views.md（本轮证据汇总）"
  - ".rea-analysis/findings-db.md（表结构）"
  - ".rea-analysis/decoded/res/values/strings.xml（UI 文案与设置）"
  - "docs/architecture/poweramp-library-three-views.md（三视图关系，本文承接其 §1 实体表）"
  - "docs/architecture/media-library-page-relationships.md（SpMusic 侧对照）"
---

# Poweramp 媒体库实体视图参考

## 0. 文档定位与证据分级

**本文记录外部实现 Poweramp 的四类分类页组织方式，不是 SpMusic 现状，也不是照抄规格。**

| 标记 | 含义 | 可信度 |
| --- | --- | --- |
| **【实证·产物】** | JADX 反编译方法体原文 | 最高 |
| **【实证·原文】** | APK 资源字符串原文（`strings.xml`） | 高 |
| **【推断】** | 本文作者推理 | 低 |

### 0.1 最大缺口（先读）

> **「专辑艺术家」实体 `О` 的方法体未取到。**

`g1.getAlbumArtists(): com.maxmpz.audioplayer.rest.library.О` 已实证存在【实证·产物】，但该类名使用**西里尔字母 `О`**（JADX 对混淆名的同形字替换），REA 的精确类名查找以 `Exact class not found` 拒绝传入。

拉丁字母 `O` 确实存在（`com.maxmpz.audioplayer.rest.library.O`），但它是无关的 lambda 类（3 字段 / 2 方法：`invoke()`）。

因此本文对「专辑艺术家」的 SQL 与排序**不做推断**，只记录已实证的周边事实（§5）。

---

## 1. 实体映射（`g1` 库门面全量，实证）

`com.maxmpz.audioplayer.rest.library.g1`（79 方法 / 38 字段）是唯一库门面。

| UI 文案 | 访问器 | 实体 | 方法数 |
| --- | --- | --- | --- |
| Albums（专辑） | `getAlbums()` | **`j`** | 25 |
| Artists（艺术家） | `getArtists()` | **`t`** | 30 |
| Album Artists（专辑艺术家） | `getAlbumArtists()` | **`О`** | 未取 |
| Composers（作曲家） | `getComposers()` | **`d0`** | 52 |
| Albums By Artist | `getAlbumsByArtist()` | `m` | 未取 |
| Genres（流派） | `getGenres()` | `z0` | — |
| Years（年份） | `getYears()` | `h4` | — |
| Files（所有歌曲） | `getFiles()` | `n0` | 33 |
| Folders（文件夹） | `getFolders()` | `t0` → `v0` | 4 → 3 |
| Folders Hierarchy | `getFoldersHier()` | `x0` | 41 |
| Search | `getSearch()` | `v3` | 40 |

UI 文案【实证·原文】：
```
albums            = "Albums"
artists           = "Artists"
album_artists     = "Album Artists"
composers         = "Composers"
artist_short      = "Artist"
album_artist      = "Album Artist"
composer          = "Composer"
```

---

## 2. 结构总览：两种截然不同的形态

| 实体 | 主表 | JOIN | GROUP BY | 复杂度 |
| --- | --- | --- | --- | --- |
| 专辑 `j` | `albums` | **3~4 个** | `albums._id` | 高（需聚合曲目） |
| 艺术家 `t` | `artists` | **0** | `artists._id` | 低（纯单表） |
| 作曲家 `d0` | `composers` | **0** | `composers._id` | 低（纯单表） |
| 专辑艺术家 `О` | ？ | ？ | ？ | 未取 |

**核心分野**：
- **专辑**必须 `INNER JOIN folder_files` 才能知道它包含哪些曲目，再 `GROUP BY albums._id` 折叠回专辑行。
- **艺术家 / 作曲家**是独立实体表，`num_files` 已预计算，**零 JOIN**。

---

## 3. 艺术家：`t`

### 3.1 `t.X0()` 原文【实证·产物】

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    boolean z;
    rVar.A = "artists";
    if (C0742.f3414.f3789) {
        z = false;
    } else {
        rVar.B("artists.num_files");
        rVar.B("!=0 ");
        z = true;
    }
    if (!C0742.k.f3789) {
        if (z) {
            rVar.B(" AND ");
        }
        rVar.B("artists.is_unsplit");
        rVar.B("=0 ");
    }
    androidx.appcompat.widget.n.m313(str, w.f3387, sb, arrayList);
    i1Var.f3335 = "artists._id";
    i1Var.B = h1.H(C0742.t.f3810);
    return w.f3388;
}
```

### 3.2 还原后的查询

```sql
SELECT <w.f3388>
FROM artists
WHERE artists.num_files != 0        -- 当 !C0742.f3414.f3789
  AND artists.is_unsplit = 0        -- 当 !C0742.k.f3789
  [AND <用户过滤 from w.f3387>]
GROUP BY artists._id
ORDER BY <h1.H(C0742.t.f3810)>
```

### 3.3 排序 `h1.H(int)` 原文

```java
public static String H(int i) {
    String str = (0x40000000 & i) != 0 ? " DESC" : "";
    int i2 = i & 0xBFFFFFFF;                       // 清 DESC 位
    if (i2 == 0) return X() + " COLLATE NOCASE " + str;
    if (i2 == 1) return "artists.created_at" + str + ", " + X() + " COLLATE NOCASE " + str;
    if (i2 != 2) return X() + " COLLATE NOCASE " + str;
    return "artists.num_files" + str + ", " + X() + " COLLATE NOCASE " + str;
}
```

| 模式 | 排序键 | 次级键 |
| --- | --- | --- |
| `0` | 名称 `h1.X()` | — |
| `1` | `artists.created_at` | 名称 |
| `2` | `artists.num_files` | 名称 |
| `+ 0x40000000` | 降序（含次级键同步降序） | |

### 3.4 其它方法

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `a1()` | `u` | 惰性创建「该艺术家的专辑」子实体（§7.3） |
| `A()` | `q1` | — |
| `S(int)` | `String` | 表达式映射 |
| `Y0(SQLiteDatabase)` | void | 维护 |
| `f3377` | `String` | 静态串 |

父类：`AbstractC0743`。

---

## 4. 作曲家：`d0`

### 4.1 `d0.X0()` 原文【实证·产物】

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    boolean z;
    rVar.A = "composers";
    if (C0742.f3414.f3789) {
        z = false;
    } else {
        rVar.B("composers.num_files");
        rVar.B("!=0 ");
        z = true;
    }
    if (!C0742.k.f3789) {
        if (z) {
            rVar.B(" AND ");
        }
        rVar.B("composers.is_unsplit");
        rVar.B("=0  ");
    }
    androidx.appcompat.widget.n.m313(str, f3293, sb, arrayList);
    i1Var.f3335 = "composers._id";
    i1Var.B = h1.K(C0742.Q.f3810);
    return y;
}
```

### 4.2 还原后的查询

```sql
SELECT <y>
FROM composers
WHERE composers.num_files != 0      -- 当 !C0742.f3414.f3789
  AND composers.is_unsplit = 0      -- 当 !C0742.k.f3789
  [AND <用户过滤 from f3293>]
GROUP BY composers._id
ORDER BY <h1.K(C0742.Q.f3810)>
```

### 4.3 排序 `h1.K(int)` 原文

```java
public static String K(int i) {
    String str = (0x40000000 & i) != 0 ? " DESC" : "";
    int i2 = i & 0xBFFFFFFF;
    if (i2 == 0) return x() + " COLLATE NOCASE " + str;
    if (i2 == 1) return "composers.created_at" + str + ", " + x() + " COLLATE NOCASE " + str;
    if (i2 != 2) return x() + " COLLATE NOCASE " + str;
    return "composers.num_files" + str + ", " + x() + " COLLATE NOCASE " + str;
}
```

### 4.4 艺术家 vs 作曲家：逐行同构对照【实证·产物】

| 位置 | 艺术家 `t` | 作曲家 `d0` |
| --- | --- | --- |
| 主表 | `"artists"` | `"composers"` |
| 空过滤 | `artists.num_files != 0` | `composers.num_files != 0` |
| 空过滤开关 | `C0742.f3414.f3789` | **同一个** |
| 拆分过滤 | `artists.is_unsplit = 0` | `composers.is_unsplit = 0` |
| 拆分开关 | `C0742.k.f3789` | **同一个** |
| 过滤列数组 | `w.f3387` | `f3293` |
| GROUP BY | `artists._id` | `composers._id` |
| 排序函数 | `h1.H(...)` | `h1.K(...)` |
| 排序模式 flag | `C0742.t.f3810` | `C0742.Q.f3810` |
| 名称表达式 | `h1.X()` | `h1.x()` |
| 投影 | `w.f3388` | `y` |

⇒ **两者共用同一模板**，仅表名 / 排序函数 / 名称表达式 / 数组引用不同。
⇒ **注意 `h1.X()` 与 `h1.x()` 是两个不同方法**（大小写敏感），分别是艺术家与作曲家的名称表达式。

> ⚠️ 混淆陷阱：`C0742.Q.f3810`（作曲家排序）与队列文档中的 `C0732.Q.f3810`（延迟队列时机）是**不同外部类下的同名成员**，`C0742` ≠ `C0732`。引用时必须带完整类名。

---

## 5. 专辑：`j`

### 5.1 `j.X0()` 原文【实证·产物】

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "albums INNER JOIN folder_files ON folder_files.album_id=albums._id "
           + "INNER JOIN artists ON artists._id =folder_files.artist_id"
           + (C0742.f3416.f3789
                ? " LEFT JOIN album_artists ON album_artists._id =albums.album_artist_id"
                + " AND albums.album_artist_id!=1000"
                : "");
    if (!C0742.f3414.f3789) {
        rVar.B("albums.num_files");
        rVar.B("!=0 ");
    }
    Z0(str, sb, arrayList, i1Var, l.f3351);
    return l.X;
}
```

### 5.2 `l.Z0()` —— GROUP BY 的来源【实证·产物】

```java
public final void Z0(String str, StringBuilder sb, ArrayList arrayList, i1 i1Var, String[] strArr) {
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(d());              // ORDER BY
    i1Var.f3335 = "albums._id";    // ← GROUP BY
}
```

### 5.3 还原后的查询

```sql
SELECT <l.X>
FROM albums
  INNER JOIN folder_files   ON folder_files.album_id = albums._id
  INNER JOIN artists        ON artists._id = folder_files.artist_id
  [LEFT JOIN album_artists  ON album_artists._id = albums.album_artist_id
                          AND albums.album_artist_id != 1000]
WHERE albums.num_files != 0        -- 当 !C0742.f3414.f3789
  [AND <用户过滤 from l.f3351>]
GROUP BY albums._id
ORDER BY <l.O(sortMode)>
```

### 5.4 三个 JOIN 的作用

| JOIN | 类型 | 作用 | 注意 |
| --- | --- | --- | --- |
| `folder_files` | **INNER** | 反向聚合曲目；天然排除空专辑 | 使 `num_files != 0` 逻辑冗余 |
| `artists` | **INNER** | 取艺术家名 | 用 `folder_files.artist_id` |
| `album_artists` | **LEFT**（条件） | 取专辑艺术家 | 用 `albums.album_artist_id`，**与上面不同源** |

`AND albums.album_artist_id != 1000` 中 `1000` 是**「未知专辑艺术家」哨兵**【实证·产物，`findings-db.md:282`】，与迁移里 `DELETE FROM artists WHERE _id!=1000` 一致。有哨兵值的专辑不 JOIN `album_artists`，回退到 `artist`。

### 5.5 排序 `l.O(int)` 原文【实证·产物】

```java
public String O(int i) {
    if (i == 0) return h1.m2450() + " COLLATE NOCASE";
    if (i == 1) return "album_year, " + h1.m2450() + " COLLATE NOCASE";
    if (i == 2) return "albums.created_at";
    String strX = "IFNULL(album_artist, artist)";
    if (i == 3) {
        if (!C0742.f3416.f3789)      strX = h1.X();
        else if (!C0742.f3413.f3789) strX = "IFNULL(album_artist_sort, artist)";
        return strX + " COLLATE NOCASE, " + h1.m2450() + " COLLATE NOCASE";
    }
    if (i == 4) return "albums.num_files, " + h1.m2450() + " COLLATE NOCASE ";
    switch (i) {
        case 1073741824: return h1.m2450() + " COLLATE NOCASE DESC";
        case 1073741825: return "album_year DESC, " + h1.m2450() + " COLLATE NOCASE DESC";
        case 1073741826: return "albums.created_at DESC";
        case 1073741827: /* 艺术家 DESC */;
        case 1073741828: return "albums.num_files DESC, " + h1.m2450() + " COLLATE NOCASE DESC";
        default:         return h1.m2450() + " COLLATE NOCASE";
    }
}
```

| 模式 | 排序键 | 次级键 |
| --- | --- | --- |
| `0` | 专辑名 | — |
| `1` | 年份 `album_year` | 专辑名 |
| `2` | 添加时间 `albums.created_at` | — |
| `3` | 艺术家（三档降级，见下） | 专辑名 |
| `4` | 曲目数 `albums.num_files` | 专辑名 |
| `+ 0x40000000` | 降序 | 降序 |

### 5.6 排序键受「排序标签」开关控制

```java
public static String m2450() {
    return !C0742.f3413.f3789 ? "album_sort" : "album";
}
```

⇒ flag `C0742.f3413.f3789` 决定用**排序标签**（`album_sort` / `album_artist_sort`）还是**显示标签**（`album` / `album_artist`）。对中文/日文等需拼音排序的语种很关键。

模式 3 的艺术家排序三档降级：
1. `!C0742.f3416.f3789` → `h1.X()`
2. `!C0742.f3413.f3789` → `IFNULL(album_artist_sort, artist)`
3. 否则 → `IFNULL(album_artist, artist)`

---

## 6. 专辑艺术家：`О`（未取到 SQL）

### 6.1 已实证的存在性

```java
// g1 类摘要
"getAlbumArtists": "()Lcom/maxmpz/audioplayer/rest/library/О;"
```

【实证·产物】独立实体，与 `getArtists()` 的 `t` **不是同一个类**。

### 6.2 已实证的周边事实

| 事实 | 证据 |
| --- | --- |
| 独立 `album_artists` 表 | `findings-db.md:144` |
| 曲目侧 JOIN：`folder_files.album_artist_id`，开关 `C0742.O.f3789` | `h1.o()` |
| 专辑侧 JOIN：`albums.album_artist_id`，开关 `C0742.f3416.f3789` | `j.X0()`、`u.X0()` |
| 哨兵 `album_artist_id = 1000` = 未知 | `findings-db.md:282` |
| 回退表达式 `COALESCE(CASE ... WHEN 1000 THEN artist ELSE album_artist END,'')` | `k3.<clinit>` 等 |

### 6.3 三个独立的「专辑艺术家标签」设置【实证·原文】

| 设置 key | 文案 |
| --- | --- |
| `pref_use_albumartist` | Album Artist Label for **Tracks** |
| `pref_use_albumartist_albumartists` | Album Artist Label for **Album Artist Tracks** |
| `pref_use_albumartist_albums` | Album Artist Label for **Albums** |

摘要原文：*"Show Album Artist tag (if exists) instead of just Artist tag for …"*

**这也是 §8 flag 表中三个不同 flag 存在的原因** —— 不是冗余，而是三个独立设置的各自开关。

### 6.4 未取部分

`О.X0()`、`О` 的排序函数、投影数组、过滤列数组**全部未知**。
**本文不对此做任何推断。**

---

## 7. 三个跨实体子系统

### 7.1 `is_unsplit` —— 多艺术家 / 多作曲家拆分

设置项【实证·原文】：

| key | 文案 |
| --- | --- |
| `pref_artists_split_chars` | Symbols to Split Multiple Artists |
| `pref_artists_split_exceptions` | Unsplit Artists |
| `pref_composers_split_chars` | Symbols to Split Multiple Composers |

机制【实证·产物】：`artists` / `composers` 表含 `is_unsplit` 列。库里同时存在：
- **拆分行**：`"A"`、`"B"`（`is_unsplit = 0`）
- **合并行**：`"A feat. B"`（`is_unsplit = 1`）

页面默认只显示拆分行（`AND is_unsplit = 0`），除非 `C0742.k.f3789` 打开。

⇒ 一首标为 `"A feat. B"` 的曲目，在艺术家页会**同时归属于 A 和 B 两个艺术家**，而不是一个名叫 `"A feat. B"` 的艺术家。

### 7.2 `multi_artists` —— 曲目 ↔ 艺术家多对多

在 `u.X0()` 中实证【实证·产物】：

```java
rVar.A = "albums "
       + "INNER JOIN folder_files ON folder_files.album_id=albums._id "
       + "INNER JOIN multi_artists ON multi_artists.file_id=folder_files._id "
       + "INNER JOIN artists ON artists._id=folder_files.artist_id "
       + "LEFT JOIN cat_stats ON cat_stats.type=" + b1()
       +   " AND cat_stats.ref_id=? AND cat_stats.ref_id2=albums._id" + ...
...
String strD = androidx.appcompat.widget.f.d(uri);   // 从 URI 取 artist id
arrayList.add(strD);
rVar.B("multi_artists.artist_id");
rVar.B("=?");
arrayList.add(strD);
```

`multi_artists(file_id, artist_id)` 是拆分后的**物理承载**，实现曲目↔艺术家多对多。

### 7.3 `cat_stats` —— 分类维度统计

`cat_stats(type, ref_id, ref_id2)`，`b1()` 返回类型串。用途**未完全确定**【推断：播放数/评分等分类级统计】。

### 7.4 `u` —— 「某艺术家的专辑」下钻页

`t.a1()` 惰性创建 `u`。`u.X0()` 特征：
- 主表 `albums`，JOIN `folder_files` + `multi_artists` + `artists` + `cat_stats`
- 过滤 `multi_artists.artist_id = <URI 中的 artist id>`
- 与 `m`（`getAlbumsByArtist()`）的职责边界未明（见未解 B6）

---

## 8. Flag 全景（四实体涉及）

| Flag | 作用域 | 语义 |
| --- | --- | --- |
| `C0742.f3414.f3789` | 文件夹 / 专辑 / 艺术家 / 作曲家 / 曲目 | **全局「排除空」开关**：开则不追加 `num_files != 0` |
| `C0742.k.f3789` | 艺术家 / 作曲家 | **显示未拆分合并行**（开则不追加 `is_unsplit = 0`） |
| `C0742.f3416.f3789` | 专辑（及 `u`） | 专辑侧 `album_artists` JOIN（对应 `pref_use_albumartist_albums`） |
| `C0742.O.f3789` | 曲目（`h1.o`） | 曲目侧 `album_artists` JOIN（对应 `pref_use_albumartist`） |
| `C0742.f3413.f3789` | 专辑 | 用排序标签还是显示标签（`album_sort` vs `album`） |
| `C0742.t.f3810` | 艺术家 | 排序模式 |
| `C0742.Q.f3810` | 作曲家 | 排序模式 |
| `C0742.l.f3810` | 所有歌曲 | 排序模式 |

> ⚠️ **`C0742.Q.f3810`（作曲家排序）≠ `C0732.Q.f3810`（延迟队列时机）**。同名成员、不同外部类。混淆代码中这类近似命名极易误读，引用必须带完整类名。

---

## 9. 与 SpMusic 对照

### 9.1 SpMusic 现状（已核实）

`src/features/player/model/mediaLibraryCategories.ts` 定义了 **12 个分类**，其中四个与本文相关：

| id | label | 引用点 |
| --- | --- | --- |
| `album` | 专辑 | 分类定义 + 根菜单图标 + 类型定义 |
| `artist` | 艺术家 | 同上 |
| `album-artist` | 专辑艺术家 | 分类定义 + 根菜单图标 |
| `composer` | 作曲家 | 分类定义 + 根菜单图标 |

`LibraryRootMenu.tsx:44-49` 仅做 **category id → 图标** 映射（`'album': category3` 等）。

**结论：四个分类均有定义与菜单图标，但没有任何渲染面板组件。**
`src/features/player/components/` 下**不存在** `Album*` / `Artist*` / `Composer*` 组件。
（`playerUiViewModel.ts` 中的 `'album'` / `'artist'` 命中是 **track 元数据字段名**，与分类路由无关。）

### 9.2 维度对照

| # | 维度 | Poweramp | SpMusic 现状 |
| --- | --- | --- | --- |
| 1 | 四个分类页面 | 四个独立实体，各自实现 | **四个占位分类，无面板** |
| 2 | 专辑的组建方式 | `INNER JOIN folder_files` + `GROUP BY albums._id` | 无 |
| 3 | 艺术家/作曲家查询 | **零 JOIN**，`num_files` 预计算 | 无 |
| 4 | 多艺术家 | `is_unsplit` 双行 + `multi_artists` 多对多 | 无（单字符串字段） |
| 5 | 未知专辑艺术家 | `_id = 1000` 哨兵 + COALESCE 回退 | 无 |
| 6 | 专辑艺术家标签 | 三处独立设置 | 无 |
| 7 | 排序模式 | 专辑 5 种 / 艺术家 3 种 / 作曲家 3 种，均 ±DESC | 单一 `compareByQuickIndex` |
| 8 | 排序稳定性 | **每个模式都带次级键** | 弱（依赖单一比较键） |
| 9 | 排序标签开关 | `album_sort` / `album_artist_sort` 可切 | 无概念 |
| 10 | 空分类过滤 | `num_files != 0` 统一 flag | 无 |

### 9.3 核心差异

Poweramp 的四类分类页共享**一套实体框架**（`AbstractC0743` 的 `X0` 钩子 + `i1` 查询描述符 + `h1` 排序映射 + 分类专属投影数组），差异全部收敛到数据里：
- 表名
- JOIN 串
- 过滤列数组
- 投影数组
- 排序映射函数

SpMusic 目前是**每类页面各写一套**的模式（仅三页有实现）。Poweramp 的框架化程度更高。

---

## 10. 可借鉴 / 不建议照抄

### 10.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **专辑用 `GROUP BY` 而非独立聚合表** | 专辑是曲目的聚合结果；SpMusic 曲目已有 `album` 字段，直接 GROUP BY 即可，无需新建表 |
| A2 | **艺术家/作曲家零 JOIN + 预计算 `num_files`** | 单表查询，空分类过滤成本 O(1)；SpMusic 现算是 O(曲目数) |
| A3 | **`is_unsplit` 双行存储** | 拆分与合并行共存，按 flag 选一种显示。比运行时拆字符串可控，且「按 A 筛选」与「按 A feat. B 筛选」都正确 |
| A4 | **`multi_artists` 多对多关联表** | 一首歌可属于多艺术家。SpMusic 若只用单一 `artist` 字符串，艺术家页永远无法正确 |
| A5 | **`1000` 哨兵 + COALESCE 回退** | 比「空值即未知」更明确，能区分「未标注」与「标注为空」 |
| A6 | **排序必带次级键** | 同名/同年/同曲目数时顺序稳定，避免列表抖动 |
| A7 | **排序标签可切换**（`album_sort` vs `album`） | 中日韩等语种需要拼音/注音排序，与显示标签分离 |
| A8 | **`0x40000000` DESC 位** | 一个 int 同时编码「排序维度 + 方向」，减少参数组合 |

### 10.2 不建议照抄

| # | 做法 | 理由 |
| --- | --- | --- |
| N1 | **三类页面各自一套排序函数**（`h1.H` / `h1.K` / `l.O`） | 逻辑高度重复（仅表名前缀与名称表达式不同），却在三个类里分别实现。应统一为一个带表名的排序构造器 |
| N2 | **同名 flag 分散在不同外部类**（`C0742.Q` vs `C0732.Q`） | 已是实际误读风险源。SpMusic 命名必须完全区分 |
| N3 | **`GROUP BY` 在单表查询上仍然设置**（艺术家/作曲家） | 语义空操作，仅为与引擎契约对齐。若自研引擎，应允许省略 |
| N4 | **专辑 `num_files != 0` 与 `INNER JOIN folder_files` 逻辑冗余** | 两个保证同一件事，排障时容易困惑 |
| N5 | **`multi_artists` + `is_unsplit` 双机制并存** | 两者信息重叠（拆分关系既在 `multi_artists` 也在 `is_unsplit` 标记里），一致性维护成本高 |

---

## 11. 未解 / 待验证

| # | 问题 | 影响 | 优先级 |
| --- | --- | --- | --- |
| **B1** | 专辑艺术家 `О` 的 `X0()`、排序、投影、过滤列 | **本文最大缺口**。需换工具（JADX GUI）或取得该类名的确切 Unicode 码点 | **高** |
| **B2** | `w.f3387`（艺术家过滤列）/ `w.f3388`（投影）的内容 | 决定艺术家页返回字段 | 中 |
| B3 | `h1.X()`（艺术家名表达式）/ `h1.x()`（作曲家名表达式） | 判断排序是否受 `C0742.f3413` 排序标签开关影响 | 中 |
| B4 | `b1()` 返回的 `cat_stats.type` 取值 | 确定统计表语义 | 中 |
| B5 | `artists` / `composers` / `album_artists` / `albums` 表的完整 DDL | `findings-db.md` 只列了 `folder_files` | 中 |
| B6 | `m`（`getAlbumsByArtist`）与 `u`（经 `t.a1()`）的关系 | 两个「按艺术家取专辑」实体是否需并存 | 中 |
| B7 | `C0742.k.f3789` 与 `pref_artists_split_chars` 的对应关系 | 确认「显示合并行」是否就是该设置 | 低 |
| B8 | `l.X` / `l.f3350` / `l.f3351` 三个静态数组的内容 | 专辑页投影与两组过滤列 | 中 |

> B1 的可操作绕过：在本机用 JADX GUI 打开 `com.maxmpz.audioplayer.rest.library.О`，或提供该类名的确切码点后重试 REA。

---

## 12. Evidence ID 索引

| 主题 | Evidence ID |
| --- | --- |
| `g1` 库门面（79 方法，实体映射权威来源） | `ev_fefbb506fc94b86da675ec3a73b7d1aa6b3b31598f8615f20e1e2985fd94fc7b` |
| `j` 专辑类摘要（25 方法） | `ev_e3cb27bc09f7b82ececa5b3fb34b661964fd54c0ffc692f2874b03c6afb23535` |
| **`j.X0`（专辑 SQL）** | `ev_6b7f78561a0f5048e5ce3758e1a835a408936fa94b2593786a66f86ffce7caf6` |
| `l` 专辑元数据类（31 方法 / 3 数组） | `ev_c8c2b89cedb8bef0e5bc5797d5e234414a96ea0a2b1a703b6fd9ec5daa6960e0` |
| **`l.Z0`（GROUP BY albums._id）** | `ev_6798376df591d554cc5e6e11a86609abb42e039b33a24c21f217892e7990a00b` |
| **`l.O`（专辑排序 5 模式）** | `ev_aa50e032e84559bd20c3e65d16cb29a7e34ee31a1bfc0414dd9c7a06978a259c` |
| **`h1.m2450`（album_sort vs album）** | `ev_740e537e1bc1da3a493a598182bf9fec90e65166bee9c0f2b7199f195264269a` |
| `t` 艺术家类摘要（30 方法） | `ev_8e23f672aecd9a32e4f7d373932ce8f541a22e06bc934cc672013698f6474ab8` |
| **`t.X0`（艺术家 SQL）** | `ev_db43a88d3caff6b99d54d5611183e205d840fd275f13f5b39e1f026327737ece` |
| `t.a1`（→ `u`） | `ev_34d6b36b6ec45d742e25059a87f4e8125c931d37d87c093a42d8b7c1a1e5e29e` |
| **`u.X0`（multi_artists + cat_stats）** | `ev_0e30b53b1130420a6e9f4b80d20851642b4bc93dfeb80b650773ada6ccc62874` |
| **`d0.X0`（作曲家 SQL）** | `ev_0d0b2d107ebe09714f52e5e9513c2a3ab8914408fe12c032c55493ded22f1711` |
| **`h1.H`（艺术家排序）** | `ev_abce0b9bcce13f8e8b43471c9ad10522a28461e0b2302c2fa1009f71af1724ac` |
| **`h1.K`（作曲家排序）** | `ev_baa2c972d4ade52b5957dd75055d24774c5e1f707063219cfa21433b6dd03d25` |

资源字符串来源：`.rea-analysis/decoded/res/values/strings.xml`（apktool 3.0.3 解码，2056 条，已入库）。
复现命令：
```
apktool d --no-src -f -o .rea-analysis/decoded .rea-analysis/Poweramp-v3.apk
```

---

## 13. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| `poweramp-library-three-views.md` | 所有歌曲 / 文件夹 / 文件夹层次结构。本文承接其实体表并**只覆盖专辑/艺术家/专辑艺术家/作曲家** |
| `poweramp-queue-runtime-reference.md` | 队列状态机。本文只引用其 `C0732` 命名以警示混淆风险 |
| `poweramp-search-and-queue-impact.md` | 搜索。其 `x3[]` 子分类与本文 `u` 职责相近，仅交叉引用 |
| `poweramp-audio-settings-structure.md` | 音频设置。与本文的 flag 体系无重叠 |
| `media-library-page-relationships.md` | SpMusic 三页面现状。本文 §9 只做对照 |
