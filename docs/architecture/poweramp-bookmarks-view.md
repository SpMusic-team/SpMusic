---
doc_id: "ARCH-POWERAMP-BOOKMARKS-VIEW"
title: "Poweramp 书签参考（独立表 + 播放位置快照）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-03"
updated: "2026-11-03"
source_documents:
  - "user request: 逆向 Poweramp 媒体库下「书签」页的实现与组织"
  - "shared task: task-17"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009) :: SHA-256 4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0"
  - ".rea-analysis/findings-bookmarks-view.md（本轮方法体原文）"
  - ".rea-analysis/decoded/res/values/strings.xml（UI 文案）"
  - ".rea-analysis/decoded/res/values/public.xml（R.attr / R.string ID）"
  - ".rea-analysis/findings-db.md（folder_files / playlist_entries 结构）"
  - "docs/architecture/poweramp-recents-views.md（派生列表 + p0 投影体系）"
  - "docs/architecture/poweramp-category-views.md（容器类分类页）"
  - "docs/architecture/media-library-page-relationships.md（SpMusic 侧对照）"
---

# Poweramp 书签参考（独立表 + 播放位置快照）

## 0. 定位与证据分级

**本文记录外部实现 Poweramp 的「书签」页面，不是 SpMusic 现状。**

| 标记 | 含义 | 可信度 |
| --- | --- | --- |
| **【实证·产物】** | JADX 反编译方法体原文 | 最高 |
| **【实证·原文】** | APK 资源字符串 / public.xml 原文 | 高 |
| **【推断】** | 本文作者推理 | 低 |

### 0.1 核心结论（先看）

**书签不是「曲目列表的视图」，而是「带播放位置快照的曲目引用」。**

它有三个与其它页面根本不同的特征：

| 特征 | 书签 | 其它页面 |
| --- | --- | --- |
| 数据来源 | **独立 `bookmarks` 表** | 多为 `folder_files` 派生或分类表 |
| 排序 | **完全硬编码 `bookmarks.sort`**，连 DESC 位都不参与 | 大多读偏好（1–4 个） |
| 列表投影 | **自有 2 字段**（两个 id） | 多为 `p0.f3367` / `y` / `l.X` |
| 播放位置 | **`bookmarks.offset_ms`** | 无此概念 |
| 显示行 | **三段 meta 拼接**（书签 / 曲目 / EQ 预设） | 标准曲目行 |
| **位置来源** | **URI 参数 `pos_ms`** | — |
| **meta 内容** | **`pos_ms` 的可读格式化（`M:SS` / `H:MM:SS`）** | — |

**位置字段是 `bookmarks.offset_ms`（毫秒），证据在 `a0.d1()` 的完整 SELECT 里。**
**写入端在 `a0.u1()`，位置来自 URI 参数 `pos_ms`，同时格式化出一份 `meta`。**

### 0.2 缺口状态

**本轮已闭环 B2**（写入 + 读取两端），并顺带确认 meta 语义：

| # | 原缺口 | 现状 |
| --- | --- | --- |
| ~~B2~~ | 位置写入/消费路径 | ✅ **已闭环**，见 §4.5 / §4.6 |
| ~~B5~~ | `bookmarks.meta` 内容格式 | ✅ **已闭环**：`Utils.A(pos_ms)` 格式化出的时长串，见 §4.6 |

**仍开放**：

| # | 缺口 | 影响 |
| --- | --- | --- |
| **B1** | `bookmarks` 表完整 DDL | `data.C0633.onUpgrade` 用变量拼 SQL（`n.n("ALTER TABLE ", str, ...)`），表名来自参数，静态无法枚举 |
| B3 | `n1()` / `r1()` / `s1()` / `v()` 四个 boolean 的语义 | 影响批量操作行为 |
| B8 | `pos_ms` 在 UI 侧的赋值点（播放器当前进度 → URI 参数） | 见 §4.5 末 |
| B4 | 同曲目多书签时 `x()` 无 `LIMIT` 的行为 | 见 §6.1 |

---

## 1. 实体映射

| UI 文案【实证·原文】 | 访问器 | 实体 | 方法数 | 字段 |
| --- | --- | --- | --- | --- |
| `bookmarks` = "Bookmarks" | `getBookmarks()` | **`a0`** | 52 | `H: String[]`、`f3281: e` |
| — | `getBookmarksFilesForced()` | **`b0`** | 19 | 0 |

### 1.1 相关 UI 文案全量

```
bookmarks       = "Bookmarks"
bookmark        = "Bookmark"
bookmarks_hint  = "Playlist with the playback position for songs.
                   Bookmark button appears in the current track menu"
```

`bookmarks_hint` 是理解本页的关键：**书签 = 带播放位置的播放列表**，入口在**当前曲目菜单**。

### 1.2 `b0` 是纯委托壳

```java
@Override
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    this.f3406.getBookmarks().X0(uri, rVar, str, sb, arrayList, i1Var);
    return a0.H;
}
```

**`b0` 与 `a0` 走同一套 SQL、同一投影**，差别只在 "Forced" 语义。
与 `getQueue()` / `getQueueFilesForced()` 那一对同型。

---

## 2. 列表查询（`a0.X0()`）

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    rVar.A = "bookmarks INNER JOIN folder_files ON bookmarks.folder_file_id = folder_files._id "
           + "INNER JOIN folders ON folders._id=folder_files.folder_id "
           + "LEFT JOIN albums ON albums._id=folder_files.album_id "
           + "LEFT JOIN artists ON artists._id=folder_files.artist_id"
           .concat(C0742.O.f3789
               ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
               : "");
    if (C0742.f1.f3789) { strArr = C0742.f3418.f3789 ? p0.y : p0.f3368; }
    else { strArr = C0742.f3418.f3789 ? p0.x : p0.X; }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = "bookmarks.sort";
    return H;
}
```

### 2.1 还原

```sql
SELECT folder_files._id, bookmarks._id             -- ★ 只有两个字段
FROM bookmarks
  INNER JOIN folder_files ON bookmarks.folder_file_id = folder_files._id
  INNER JOIN folders      ON folders._id = folder_files.folder_id
  LEFT  JOIN albums       ON albums._id  = folder_files.album_id
  LEFT  JOIN artists      ON artists._id = folder_files.artist_id
  [LEFT JOIN album_artists ON album_artists._id = folder_files.album_artist_id]
WHERE [<用户过滤>]
ORDER BY bookmarks.sort                            -- ★ 硬编码
```

### 2.2 三个独特点

**① 排序完全硬编码，甚至不接受 DESC 位**

```java
i1Var.B = "bookmarks.sort";
```

对比：评分页至少传常量 `O(5)`、最多播放至少保留 DESC 位。书签是**全库唯一连方向都锁死**的列表。

`a0.O(int)` 也印证 —— **参数 `i` 被完全忽略**：

```java
@Override // p0, m2
public final String O(int i) {
    return "bookmarks.sort";
}
```

**② 投影是全库最简的 2 字段**（`<clinit>` 实证）

```smali
const-string v0, "folder_files._id"
const-string v1, "bookmarks._id"
filled-new-array {v0, v1}, [Ljava/lang/String;
sput-object v0, Lcom/maxmpz/audioplayer/rest/library/a0;->H:[Ljava/lang/String;
```

**不是 `p0.f3367`** —— 书签是唯一**不用标准 song 投影**的 song 类页面。

**③ JOIN 类型组合**

`INNER JOIN folders` + `LEFT JOIN albums/artists` —— 与「长」页 `d3` 同型（曲目必属文件夹，专辑/艺术家可选）。

---

## 3. `bookmarks` 表结构（代码反推，实证）

| 列 | 类型推断 | 证据 |
| --- | --- | --- |
| `_id` | INTEGER PK | `V()` → `"bookmarks._id"`；`x()` 的 SELECT |
| `folder_file_id` | INTEGER（外键 → `folder_files._id`） | `A0()` → `"bookmarks.folder_file_id"`；`X0` 的 JOIN 条件 |
| `sort` | INTEGER | `O()` / `T()` 的 `"bookmarks.sort"` |
| `created_at` | INTEGER | `T()` 传给 `h1.b(...)` 的 `"bookmarks.created_at"` |
| `shuffle_order` | INTEGER | `T0()` / `U0()` 引用 |
| `meta` | TEXT | `n0()` 的 `bookmarks.meta` |
| **`offset_ms`** | **INTEGER（毫秒）** | **`d1()` 的 `bookmarks.offset_ms`** |

### 3.1 为什么 DDL 取不到

`data.C0633.onUpgrade(db, 0, 244)` 是唯一的建表路径，但它用**变量拼 SQL**：

```java
sQLiteDatabase.execSQL(n.n("ALTER TABLE ", str3, " ADD COLUMN ", "last_pos", " INTEGER NOT NULL DEFAULT 0"));
```

`str3 = str`（方法参数），且 `onUpgrade` 中**搜不到任何 `bookmark` 字面量**（0 次命中）。
⇒ `bookmarks` 表的创建语句在**动态拼接的外部字符串**里，静态分析无法枚举。

**已实证的 7 个列名来自各方法里的字符串常量，可信度不受影响**，但完整列清单无法保证。

---

## 4. 位置字段：`bookmarks.offset_ms`（B1 闭环）

### 4.1 决定性证据：`a0.d1()` 完整 SELECT

```java
@Override // p0
public final Cursor d1(SQLiteDatabase sQLiteDatabase, String[] strArr) {
    return sQLiteDatabase.rawQueryWithFactory(null,
        "SELECT COALESCE(folder_files.file_path,path||folder_files.name,folder_files.name), "
      + "folder_files.title_tag, COALESCE(albums.album, album_tag), COALESCE(artists.artist, artist_tag), "
      + "folder_files.duration, folder_files.tag_status, folder_files.file_type, folder_files.folder_id, "
      + "folder_files._id, folders.is_cue, folder_files.offset_ms, folder_files.track_number, "
      + "folder_files.album_id, folder_files.artist_id, eq_preset_songs.preset_id, folder_files.updated_at, "
      + "NULL, NULL, folder_files.rating, album_artists.album_artist, folder_files.album_artist_id, "
      + "folder_files.wave, bookmarks.offset_ms, folder_files.url, folder_files.bit_rate, "
      + "folder_files.replay_gain, "
      + "(has_lyrics_tag OR lrc_files_id IS NOT NULL OR cached_lyrics_id IS NOT NULL "
      + " AND cached_lyrics_loading_started_at IS NULL AND file_type!=23) AS _has_lyrics, in_playlist "
      + "FROM folder_files INNER JOIN bookmarks ON bookmarks.folder_file_id=folder_files._id "
      + "LEFT JOIN folders ON folders._id=folder_files.folder_id "
      + "LEFT JOIN albums ON albums._id=folder_files.album_id "
      + "LEFT JOIN artists ON artists._id=folder_files.artist_id "
      + "LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id "
      + "LEFT JOIN eq_preset_songs ON eq_preset_songs.file_id=folder_files._id "
      + "WHERE bookmarks._id=?",
        strArr, "", null);
}
```

### 4.2 28 列索引布局

| # | 列 | # | 列 |
| --- | --- | --- | --- |
| 0 | `COALESCE(file_path, path\|\|name, name)` | 14 | `eq_preset_songs.preset_id` |
| 1 | `folder_files.title_tag` | 15 | `folder_files.updated_at` |
| 2 | `COALESCE(albums.album, album_tag)` | 16 | `NULL` |
| 3 | `COALESCE(artists.artist, artist_tag)` | 17 | `NULL` |
| 4 | `folder_files.duration` | 18 | `folder_files.rating` |
| 5 | `folder_files.tag_status` | 19 | `album_artists.album_artist` |
| 6 | `folder_files.file_type` | 20 | `folder_files.album_artist_id` |
| 7 | `folder_files.folder_id` | 21 | `folder_files.wave` |
| 8 | `folder_files._id` | **22** | **`bookmarks.offset_ms`** ★ |
| 9 | `folders.is_cue` | 23 | `folder_files.url` |
| 10 | `folder_files.offset_ms` | 24 | `folder_files.bit_rate` |
| 11 | `folder_files.track_number` | 25 | `folder_files.replay_gain` |
| 12 | `folder_files.album_id` | 26 | `... AS _has_lyrics` |
| 13 | `folder_files.artist_id` | 27 | `in_playlist` |

### 4.3 两个 `offset_ms` 必须区分

| 列 | 语义 | 用途 |
| --- | --- | --- |
| `folder_files.offset_ms`（#10） | **CUE 曲目在整轨文件内的起始偏移** | 定位虚拟曲目在物理文件中的起点 |
| **`bookmarks.offset_ms`（#22）** | **书签记录的播放位置** | 恢复播放进度 |

**同名不同义。** 混用会导致：把 CUE 偏移当播放位置、或把播放位置写进 CUE 偏移。

### 4.4 单位：毫秒

| 证据 | 说明 |
| --- | --- |
| 列名带 `_ms` 后缀 | `bookmarks.offset_ms` |
| 同族 `folder_files.offset_ms` / `playlist_entries.cue_offset_ms` 均为 ms | `findings-db.md` |
| CUE 计算 `startMs` / `endMs` 全程 ms | `findings-format.md:466-471` |

⇒ **`bookmarks.offset_ms` 单位为毫秒**，与 `duration`、`offset_ms` 同一单位体系。

### 4.5 写入端：`a0.u1()`（B2 闭环）

这是书签**创建**的唯一路径，一次性给出了位置来源、meta 内容、sort 与 created_at 的算法。

```java
public final int u1(RestProvider restProvider, h2 h2Var, UriAndIds uriAndIds) {
    Cursor cursorE0 = h2Var.E0(restProvider, uriAndIds, null, -1);
    if (cursorE0 == null) return -1;
    if (cursorE0.getCount() != 1) { cursorE0.close(); return -1; }   // 必须恰好 1 条曲目

    SQLiteDatabase db = restProvider.getWritableDatabase();
    String strO  = n.o("bookmarks.folder_file_id");
    String strO2 = n.o("bookmarks.sort");
    String strO3 = n.o("bookmarks.offset_ms");
    String strO4 = n.o("bookmarks.meta");
    String strO5 = n.o("bookmarks.created_at");
    StringBuilder sb = A.m4("INSERT INTO bookmarks (", strO, ", ", strO2, ", ");
    A.o(sb, strO3, ", ", strO4, ", ");
    sb.append(strO5);
    sb.append(") VALUES (?, ?, ?, ?, ?)");

    SQLiteStatement ins = db.compileStatement(sb.toString());
    SQLiteStatement maxSort = db.compileStatement("SELECT MAX(sort) FROM bookmarks");

    db.beginTransactionNonExclusive();
    long max = maxSort.simpleQueryForLong();
    maxSort.close();
    if (max < 0) max = 0;
    long nextSort = max + 1;

    int posMs = uriAndIds.x.getInt("pos_ms", 0);          // ★ 位置来自 URI 参数
    StringBuilder metaSb = new StringBuilder();
    long now = System.currentTimeMillis();
    int inserted = 0;

    while (cursorE0.moveToNext()) {
        if (!cursorE0.isNull(1) && (C0742.f3414.f3789 || cursorE0.getInt(3) == 0)) {
            long fileId = cursorE0.getLong(0);
            Utils.A(metaSb, posMs, false);                // ★ meta = 时长格式化
            String meta = metaSb.toString();

            ins.bindLong(1, fileId);
            ins.bindLong(2, nextSort);
            ins.bindLong(3, posMs);                       // ★ offset_ms
            ins.bindString(4, meta);                      // ★ meta
            ins.bindLong(5, now);                         // ★ created_at
            if (ins.executeInsert() > 0) inserted++;

            nextSort += 1;
        }
    }
    if (inserted > 0) db.setTransactionSuccessful();
    db.endTransaction();
    cursorE0.close();
    ins.close();
    return inserted;
}
```

#### 五个字段的来源与算法

| 列 | 值 | 来源 |
| --- | --- | --- |
| `folder_file_id` | `cursorE0.getLong(0)` | 查询游标第 0 列 |
| `sort` | `MAX(sort) + 1`（事务内取，<0 归零） | `SELECT MAX(sort) FROM bookmarks` |
| **`offset_ms`** | **`uriAndIds.x.getInt("pos_ms", 0)`** | **URI/Bundle 参数 `pos_ms`** |
| `meta` | **`Utils.A(pos_ms)` 格式化结果** | 由 `pos_ms` 派生 |
| `created_at` | `System.currentTimeMillis()` | 事务内统一取值 |

#### 三个检查点

1. **必须恰好命中 1 条曲目**：`cursorE0.getCount() != 1` 直接返回 `-1`。这说明书签是**单曲目**操作，不支持批量。
2. **`pos_ms` 缺省为 0**：`getInt("pos_ms", 0)`。若调用方未传，书签会落在曲目开头（0ms）。
3. **`sort` 在事务内取 MAX**：`beginTransactionNonExclusive()` 包住 `MAX(sort)` 与全部 insert，避免并发下 sort 重复。
   但注意 `MAX(sort)` 查询在事务开始后、循环开始前只做了一次——若同事务内插入多条，靠 `nextSort += 1` 递增维持唯一。

> **B8 未解**：`pos_ms` 由哪个调用方（UI 层）用播放器当前进度填充，本轮未追到。

### 4.6 `meta` 内容：`pos_ms` 的可读时长（B5 闭环）

```java
// com.maxmpz.utils.Utils
public static void A(StringBuilder sb, int i, boolean z) {
    m2719(sb, (i + 500) / 1000, z);        // 毫秒 → 秒（四舍五入）
}

public static void m2719(StringBuilder sb, int i, boolean z) {
    if (i < 0 || (i == 0 && z)) {
        sb.append(t.f3846);                 // 占位符（如 "--:--"）
        return;
    }
    int i2 = i % 60;
    if (i < 3600) {
        sb.append(i / 60);                  // 分钟
        sb.append(':');
    } else {
        int i3 = i / 3600;
        int i4 = (i / 60) % 60;
        sb.append(i3); sb.append(':');
        if (i4 < 10) sb.append('0');
        sb.append(i4); sb.append(':');
    }
    if (i2 < 10) sb.append('0');
    sb.append(i2);                          // 秒（两位数）
}
```

#### 格式规则

| 时长范围 | 输出 | 示例 |
| --- | --- | --- |
| `< 0` 或 `== 0 && z` | 占位符 `t.f3846` | `--:--` |
| `< 1 小时` | `M:SS` | `3:07` |
| `>= 1 小时` | `H:MM:SS` | `1:03:07` |

#### 一个格式不一致点

**秒数补零，分钟不补零**（1 小时以内时）。

- `3:07` —— 分钟 3 没有前导零，秒 07 有
- `1:03:07` —— 进入小时分支后分钟才补零

⇒ 同一格式化函数在不同区间对分钟的补零规则不一致。属产品层面的细节瑕疵，不影响功能。

> 该函数是**通用时长格式化器**（`Utils.m2719`），不只服务书签 —— 播放器时间显示也会走它。
> 因此这个不一致是**全局可见**的，不是书签专有问题。

---

## 5. 显示逻辑：三段 meta 拼接

`a0.n0()` 是书签页**唯一的自定义显示表达式**：

```java
@Override // p0, x2
public final String n0() {
    return "bookmarks.meta||' | '||folder_files.meta"
         + "||IFNULL(' | '||(SELECT eq_presets.name FROM eq_presets"
         + " INNER JOIN eq_preset_songs ON eq_preset_songs.preset_id=eq_presets._id"
         + " WHERE eq_preset_songs.file_id=folder_files._id,''))";
}
```

```sql
bookmarks.meta || ' | ' || folder_files.meta
  || IFNULL(' | ' || (
       SELECT eq_presets.name FROM eq_presets
       INNER JOIN eq_preset_songs ON eq_preset_songs.preset_id = eq_presets._id
       WHERE eq_preset_songs.file_id = folder_files._id
     ), '')
```

### 显示规则

```
<书签 meta> | <曲目 meta> | <EQ 预设名>
```

- 前两段无条件拼接（用 `||`，遇 NULL 整体为 NULL）
- 第三段用 `IFNULL(...,'')` 包裹，**无 EQ 预设时不抛错但也可能不留分隔**

### 一个实现疑点

`bookmarks.meta || ' | ' || folder_files.meta` **没有 IFNULL 保护**：
SQLite 的 `||` 遇 `NULL` 结果是 `NULL`。若任一 `meta` 为 NULL，整个表达式返回 NULL，第三段也不会显示。

⇒ 只有当**两个 meta 都非 NULL** 时，这三段才完整可见。若 `meta` 允许为空（很可能），显示会静默丢失。

这是「用一条 SQL 拼三层信息」的代价：省了 N+1 查询，但缺了 NULL 保护。

---

## 6. 双向反查与写操作

### 6.1 书签 id ↔ 曲目 id

```java
// 书签 id → 曲目 id
@Override // w2
public final long M0(SQLiteDatabase db, long j) {
    return n.y("RestLibraryUtils", db,
        "SELECT bookmarks.folder_file_id FROM bookmarks WHERE _id=?", j);
}

// 曲目 id → 书签 id
@Override // w2
public final long x(SQLiteDatabase db, long j, long j2) {
    return n.y("RestBookmarks", db,
        "SELECT bookmarks._id FROM bookmarks WHERE bookmarks.folder_file_id=?", j2);
}
```

**`x()` 没有 `LIMIT`** —— 同一曲目有多个书签时只返回第一个（SQLite 未定义顺序），语义不明确。

**两个方法的日志 tag 不同**（`RestLibraryUtils` vs `RestBookmarks`），同族函数用了不同 tag，排障时易漏看。

### 6.2 写入

```java
@Override // c2
public final long k(RestProvider rp, SQLiteDatabase db, Uri uri, ContentValues cv) {
    return db.insert("bookmarks", null, cv);
}
```

`ContentValues` 由外部构造，**位置字段的赋值在此不可见**（B2）。

### 6.3 重排与洗牌

```java
// T() —— 重排，确认列名
@Override // w2
public final boolean T(RestProvider rp, Uri uri, int i) {
    // h1.b(rp, uri, "bookmarks", "bookmarks._id", "bookmarks.sort", "bookmarks.created_at", i)
}
```

`table` / `idCol` / `sortCol` / `createdAtCol` 四个参数齐全，与 playlist / queue 走同一个重排工具。

### 6.4 分页（`R0` / `S0`）

两个方法基于 `folder_files.played_at` 做分页锚点 —— 与书签自身列无关。

---

## 7. 与其它页面横向对照

| 维度 | 书签 `a0` | 评分 `e4`/`e3` | 最近播放 `r3` | 长 `d3` | 年份/流派 |
| --- | --- | --- | --- | --- | --- |
| 主表 | **`bookmarks`** | `folder_files` | `folder_files`（子查询） | `folder_files` | 分类表 / 关联表 |
| 子查询 + LIMIT | 无 | **有** | **有** | 无 | 无 |
| 排序 | **硬编码，忽略参数** | 硬编码常量 `O(5)`/`O(1)` | 偏好全值 | 偏好全值 | 偏好全值 |
| 投影 | **自有 2 字段** | `p0.f3367` | `p0.f3367` | `p0.f3367` | `y` / `l.X` |
| 位置概念 | **有（`offset_ms`）** | 无 | 无 | 无 | 无 |
| 自定义显示 | **三段 meta 拼接** | 无 | 无 | 无 | 无 |

### 结构定位

```
容器类（年份/流派/专辑/艺术家）   →  行是「类别」
派生列表（最近/最多/评分/长）     →  行是「曲目」，条件是筛选
书签                             →  行是「曲目 + 状态快照」
```

**书签是唯一的「有状态曲目引用」页面。** 这解释了为什么投影只要两个 id —— 位置和元信息都在 `bookmarks` 行里，按 `bookmarks._id` 二次取。

---

## 8. 可借鉴 / 不建议照抄

### 8.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **书签独立成表，而非给 `folder_files` 加位置列** | 同一首歌可以有多个书签（不同段落），一对多是必需的 |
| A2 | **位置存 `offset_ms` 整数毫秒** | 与 `duration` / `cue_offset_ms` 同一单位体系，无换算歧义 |
| A3 | **列表投影只取两个 id** | 位置等重字段按需二次查，首屏轻；书签页通常条目不多但要带元信息 |
| A4 | **`n0()` 用一条 SQL 拼三层 meta** | 避免 N+1 查询（书签 / 曲目 / EQ 预设） |
| A5 | **加入 `shuffle_order` 列** | 可对书签集合单独洗牌，不影响曲目本身顺序 |
| A6 | **`T()` 复用通用重排工具**（表/id/sort/created_at 四参数） | 与 playlist / queue 同一套，行为一致 |
| **A7** | **`offset_ms` 与 `meta` 双写**（§4.5） | 整数列供比较/seek，文本列供直接显示。**不用为了显示而解析整数**，也不用为了 seek 而解析文本 —— 各自读各自需要的那个 |
| **A8** | **`sort` 取 `MAX(sort)+1` 且在事务内** | 新书签追加到末尾；事务包住 `MAX` 与全部 insert，避免并发下 sort 冲突 |
| **A9** | **强制 `cursorE0.getCount() == 1`**（§4.5） | 书签是单曲目操作，多于 1 条直接拒绝（返回 -1），避免误批量创建 |

### 8.2 不建议照抄

| # | 做法 | 理由 |
| --- | --- | --- |
| **N1** | **排序彻底硬编码，且 `O(int)` 忽略入参** | 用户完全无法调整顺序；接口签名有参数却不用，属误导性设计。至少应支持按位置/创建时间排序 |
| **N2** | **投影只给两个 id，位置不在列表里** | 若列表要显示「03:42」这样的位置标签，必须逐条二次查询 → N+1 隐患。应把 `bookmarks.offset_ms` 加进投影 |
| **N3** | **`n0()` 的 meta 拼接无 NULL 保护** | `||` 遇 NULL 整体为 NULL，任一 meta 为空则三段全丢。应逐段 `IFNULL` |
| **N4** | **`x()` 无 `LIMIT`** | 同曲目多书签时返回值不确定 |
| **N5** | **同族方法用不同日志 tag**（`RestLibraryUtils` / `RestBookmarks`） | 排障易漏 |
| **N6** | **DDL 用变量拼 SQL，表名来自参数** | 导致无法静态审计表结构（本文即受此影响，只能代码反推 7 个列） |
| **N7** | **`offset_ms` 与 `meta` 内容冗余**（§4.6） | `meta` 是 `offset_ms` 的格式化副本，同一信息存两份。若用户改了时长显示格式，旧 meta 不会更新，会出现「整数对、文本旧」的不一致 |
| **N8** | **时长格式化器分钟不补零**（§4.6） | `3:07` 而非 `03:07`，但进入小时分支后又补零（`1:03:07`）。同一函数内规则不一致，且该函数是**全局通用**的（播放器时间也走它），影响面超出书签 |
| **N9** | **`u1()` 的 `MAX(sort)` 只查一次** | 事务包住了，但同事务内多行插入靠 `nextSort += 1` 维持。若 insert 部分失败，`sort` 序列会出现空洞（虽不影响正确性） |
| **N10** | **`pos_ms` 缺省 0 静默兜底** | 调用方漏传参数时书签落在曲目开头，无任何提示。应校验或拒绝 |

---

## 9. 与 SpMusic 对照

### 9.1 SpMusic 现状

`src/features/player/model/mediaLibraryCategories.ts` 定义 12 个分类，**不含 `bookmarks`**。
现有分类：`songs` / `folder` / `folders` / `album` / `artist` / `album-artist` / `genre` / `year` / `composer` / `playlists` / `streams` / `queue`。

`playbackQueue.ts` 的 `PlaybackQueueOrigin` 只有 `'all-songs' | 'playlist'`。

### 9.2 维度对照

| # | 维度 | Poweramp | SpMusic 现状 |
| --- | --- | --- | --- |
| 1 | 书签页 | 独立表 + 位置快照 | **无** |
| 2 | 播放位置 | `bookmarks.offset_ms` | 无持久化书签概念 |
| 3 | 同曲目多书签 | 支持（一对多） | — |
| 4 | 显示 meta | 三段拼接（书签/曲目/EQ） | — |
| 5 | 排序 | 硬编码 `sort` | — |
| 6 | 洗牌 | `shuffle_order` 列 | — |

### 9.3 最小实现建议

书签是**成本最低的可选功能**：不需要新实体、不需要新分类模型，只需一张小表 + 曲目列表加一列。

| 组件 | 建议 |
| --- | --- |
| 表 | `bookmarks(id, track_id, offset_ms, created_at, sort)` |
| 入口 | 当前曲目菜单（与 Poweramp 一致） |
| 列表 | 「所有歌曲」加一个 `is_bookmarked` 过滤，或独立小列表 |
| 恢复播放 | 选中书签 → 播放该曲目并 seek 到 `offset_ms` |
| 位置显示 | **直接把 `offset_ms` 放进投影**（不要学 Poweramp 的 N2 缺陷） |

**必须注意**：若 SpMusic 也有 CUE 虚拟曲目，`bookmarks.offset_ms` 与 CUE 的 `offset_ms` 要**分开两个字段**，否则会出现本文 §4.3 的同名不同义问题。

---

## 10. 未解

### 10.1 本轮已闭环（2 项）

| # | 原问题 | 结论 | 证据位置 |
| --- | --- | --- | --- |
| ~~B2~~ | `offset_ms` 写入与消费路径 | 写入端 `a0.u1()`：位置来自 URI 参数 `pos_ms`，绑定到 `offset_ms`；读取端 `a0.d1()` 第 22 列 | §4.5 / §4.1 |
| ~~B5~~ | `bookmarks.meta` 内容格式 | `Utils.A(pos_ms)` 格式化出的时长串（`M:SS` / `H:MM:SS`），与 `offset_ms` 同源冗余 | §4.6 |

### 10.2 仍开放

| # | 问题 | 优先级 |
| --- | --- | --- |
| **B8** | `pos_ms` 在 UI 层的赋值点（播放器当前进度 → URI 参数） | **中** |
| **B1** | `bookmarks` 表完整 DDL（`onUpgrade` 变量拼 SQL，无法静态枚举） | 中 |
| B3 | `n1()` / `r1()` / `s1()` / `v()` 四个 boolean 的语义 | 中 |
| B4 | 同曲目多书签时 `x()` 的实际返回（无 `LIMIT`） | 低 |
| B6 | `a0.d()` / `k0()` / `c()` / `s()` / `z()` 等分类元数据方法 | 低 |
| B7 | `q0()`（删除）/ `p()`（批量重排）的完整行为 | 低 |
| B9 | `t.f3846` 占位符的实际文本（负值/零值时长时显示） | 低 |

> B2 闭环后，书签的「创建 → 存储」链路已完全打通。
> 剩余的 B8 是「播放器进度 → `pos_ms`」这一段的 UI 侧赋值，属调用方而非书签实体本身。

---

## 11. Evidence ID 索引

| 主题 | Evidence ID |
| --- | --- |
| `g1` 库门面（`getBookmarks` / `getBookmarksFilesForced`） | `ev_d827238fa0be30f105438806871117c737191b025c5e7460a44c03377a4eb404` |
| **`a0.u1`（创建路径，B2/B5 闭环）** | `ev_4fc27fa243586116503a80493a2753fc62b83c87d7d77e79b146bd219a21782f` |
| **`Utils.A`（毫秒→秒四舍五入）** | `ev_16484cc820e2e177317992fee10cc8a0f116d060904c76baa1117b2994442c81` |
| **`Utils.m2719`（时长格式化 `M:SS` / `H:MM:SS`）** | `ev_e5e2fa2ec2b0e9aa0e1a65921243838ffa27df99fb9a6b00430d80247efd15d8` |
| `a0.q0`（删除路径） | `ev_5743cf276494bdb98995b6d742888d89be93c0a3adf95cbec870c0efee622065` |
| `a0.p`（批量重排） | `ev_6157af9be3a7ec2ae08e50ddbb2637d7822341b478640f82fe2c854da1508a9b` |
| `a0.d1`（28 列 SELECT，`bookmarks.offset_ms`） | `ev_ef7358d973fd3ceeb5c62ebcfc69871abda41c3763d34b745900b206b5adfc4b` |
| **`a0.X0`（列表 SQL）+ 类摘要** | `ev_98758a171bb97f22b6064af0a58c67c2d31d1134e54b5182421372968821983b` |
| `a0.Q0` | `ev_12f27c68bfff6259d318daa9d2a94798e495b39f42ebafda064e4211c963981b` |
| **`a0.<clinit>`（2 字段投影，smali）** | `ev_c2bd8e9939f24757bf57d832a18bdce5c53c11ca823458be179a72ab2c4f2191` |
| **`a0.d1`（28 列 SELECT，含 `bookmarks.offset_ms`）** | `ev_ef7358d973fd3ceeb5c62ebcfc69871abda41c3763d34b745900b206b5adfc4b` |
| **`a0.n0`（三段 meta 拼接）** | `ev_fd58a20787d986b587d15ff4d677357c80ebd47bf58e47f0628f67c89cc6b6af` |
| **`a0.A0`（`bookmarks.folder_file_id`）** | `ev_cd875db74760b92a8031b365a001fcbebd62a851e8abcc44cc519b30cfc50890` |
| `a0.V`（`bookmarks._id`） | `ev_a447c456d59e282ae46fdc9ffebd075149df4dac3f832cd59418f6855361abe9` |
| `a0.O`（硬编码排序） | `ev_bba5c857adf6712173be93e73ad7ce23a2745e3fdaf92e79f9e718ee757aa960` |
| `a0.i`（表名 `bookmarks`） | `ev_26cedad9533cc86ccbc89f91de6b960cd0d0e9def83ba8470d089fe05ad9d477` |
| `a0.H`（FROM 子句生成器） | `ev_07be52b21587059d0f492fef1408b9505a6ad2b96ad4f37e8e554e6442f27c0c` |
| `a0.T`（重排，列名实证） | `ev_68f833a29e47f9c050d8fd33ae96d5d81970c64fb016a081fed15713d7b73220` |
| `a0.M0` / `a0.x`（双向反查） | `ev_68ac0f0f926f29281e2365ae34956280fff26c3674f746004238167c8283468f` |
| `a0.k`（insert） | `ev_27b47e53afb65e52085c534ca88b6511c013302a88d9ed6db42c165b8af64973` |
| `a0.R0` / `a0.S0`（分页） | `ev_bbbabdabcea18e40c82adc204d505297c83aa3747c6088b4e522722b51d990a2` |
| `a0.T0` / `a0.U0`（shuffle_order） | `ev_220d20c5ce0f8ed400075081c2cb03b69ff41dd2ac148fce28621f4e043673f8` |
| **`b0.X0`（纯委托壳）** | `ev_f05b172957a56b0fb89fd5cd16c1eacbb454f71f2dbc8e07d17458e7b446fd53` |
| `C0633.onCreate` → `onUpgrade(db,0,244)` | `ev_d7072d4f3731138901f7ca6b328af9d49388fc2349be959b8236ce365117b82e` |
| **`C0633.onUpgrade`（无 bookmark 字面量，变量拼 SQL）** | `ev_408471b430e38320b096433cb5ff0eefefe005a19b0a875b355f9c09e2d45015` |

资源来源：`.rea-analysis/decoded/res/values/strings.xml`、`.rea-analysis/decoded/res/values/public.xml`（apktool 3.0.3，已入库）。
复现命令：
```
apktool d --no-src -f -o .rea-analysis/decoded .rea-analysis/Poweramp-v3.apk
```

---

## 12. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| `poweramp-recents-views.md` | 派生/筛选列表（最近播放/添加/最多播放/长/评分）+ 共用排序映射 `p0.O`。本文 §7 引用其投影与排序对照 |
| `poweramp-category-views.md` | 年份/流派双路径四层容器。本文 §7 引用其"容器 vs 曲目"分类 |
| `poweramp-entity-views.md` | 专辑/艺术家/专辑艺术家/作曲家 |
| `poweramp-library-three-views.md` | 所有歌曲/文件夹/文件夹层次结构。本文 §7 的投影 `p0.f3367` 与其同源 |
| `poweramp-queue-runtime-reference.md` | 队列状态机。书签可入队，但队列逻辑无重叠 |
| `poweramp-search-and-queue-impact.md` | 搜索。无重叠 |
| `findings-db.md` | 表结构。**本文补充了 `bookmarks` 表的 7 个列（该文档此前无记录）** |
| `media-library-page-relationships.md` | SpMusic 三页面现状。本文 §9 只做对照 |
