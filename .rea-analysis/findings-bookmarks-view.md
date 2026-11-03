# Poweramp 书签 —— 方法体实证

**用途**：支撑 `docs/architecture/poweramp-bookmarks-view.md`。
本文只存方法体原文，分析见架构文档。

| 项 | 值 |
| --- | --- |
| 目标 | `com.maxmpz.audioplayer` build-1025-uni (1025009) |
| APK SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 引擎 | JADX headless 0.7.1 via REA |
| 采集 | 2026-11-03 |

---

## 0. 实体

| 访问器 | 实体 | 类摘要 |
| --- | --- | --- |
| `getBookmarks()` | `a0` | 52 方法 / 2 字段（`H: String[]`, `f3281: e`） |
| `getBookmarksFilesForced()` | `b0` | 19 方法 / 0 字段 |

`ev_d827238fa0be30f105438806871117c737191b025c5e7460a44c03377a4eb404`

`a0` 全部方法（52 个）：

```
<clinit> <init> A0 C C0 E F F0 H J M0 O P Q0 R0 S0 T T0 U0 V X0 Z
c c1 d d0 d1 f0 g i i1 k k0 m mo2425 mo2426 n n0 n1 p q q0 r r0 r1
s s1 u1 v w0 x z
```

---

## 1. `a0.X0()` —— 列表查询

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    rVar.A = "bookmarks INNER JOIN folder_files ON bookmarks.folder_file_id = folder_files._id INNER JOIN folders ON folders._id=folder_files.folder_id LEFT JOIN albums ON albums._id=folder_files.album_id LEFT JOIN artists ON artists._id=folder_files.artist_id"
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

`ev_98758a171bb97f22b6064af0a58c67c2d31d1134e54b5182421372968821983b`（含类摘要）

`a0.Q0()` 为同逻辑简化包装：

```java
@Override // d1
public final String[] Q0(Uri uri, com.maxmpz.audioplayer.player.r rVar,
                         ArrayList arrayList, i1 i1Var) {
    return X0(uri, rVar, null, new StringBuilder(), arrayList, i1Var);
}
```

`ev_12f27c68bfff6259d318daa9d2a94798e495b39f42ebafda064e4211c963981b`

---

## 2. `a0.<clinit>()` —— 2 字段投影（smali）

```smali
const-string v0, "folder_files._id"
const-string v1, "bookmarks._id"
filled-new-array {v0, v1}, [Ljava/lang/String;
move-result-object v0
sput-object v0, Lcom/maxmpz/audioplayer/rest/library/a0;->H:[Ljava/lang/String;
```

`ev_c2bd8e9939f24757bf57d832a18bdce5c53c11ca823458be179a72ab2c4f2191`

---

## 3. `a0.d1()` —— 28 列 SELECT（B1 闭环）

```java
@Override // com.maxmpz.audioplayer.rest.library.p0
public final Cursor d1(SQLiteDatabase sQLiteDatabase, String[] strArr) {
    return sQLiteDatabase.rawQueryWithFactory(null,
        "SELECT COALESCE(folder_files.file_path,path||folder_files.name,folder_files.name), folder_files.title_tag, COALESCE(albums.album, album_tag), COALESCE(artists.artist, artist_tag), folder_files.duration, folder_files.tag_status, folder_files.file_type, folder_files.folder_id, folder_files._id, folders.is_cue, folder_files.offset_ms, folder_files.track_number, folder_files.album_id, folder_files.artist_id, eq_preset_songs.preset_id, folder_files.updated_at, NULL, NULL, folder_files.rating, album_artists.album_artist, folder_files.album_artist_id, folder_files.wave, bookmarks.offset_ms, folder_files.url, folder_files.bit_rate, folder_files.replay_gain, (has_lyrics_tag OR lrc_files_id IS NOT NULL OR cached_lyrics_id IS NOT NULL AND cached_lyrics_loading_started_at IS NULL AND file_type!=23) AS _has_lyrics, in_playlist "
      + "FROM folder_files "
      + "INNER JOIN bookmarks ON bookmarks.folder_file_id=folder_files._id "
      + "LEFT JOIN folders ON folders._id=folder_files.folder_id "
      + "LEFT JOIN albums ON albums._id=folder_files.album_id "
      + "LEFT JOIN artists ON artists._id=folder_files.artist_id "
      + "LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id "
      + "LEFT JOIN eq_preset_songs ON eq_preset_songs.file_id=folder_files._id "
      + "WHERE bookmarks._id=?",
        strArr, "", null);
}
```

`ev_ef7358d973fd3ceeb5c62ebcfc69871abda41c3763d34b745900b206b5adfc4b`

**列索引**（0–27）：

```
 0 COALESCE(file_path,path||folder_files.name,folder_files.name)
 1 folder_files.title_tag
 2 COALESCE(albums.album, album_tag)
 3 COALESCE(artists.artist, artist_tag)
 4 folder_files.duration
 5 folder_files.tag_status
 6 folder_files.file_type
 7 folder_files.folder_id
 8 folder_files._id
 9 folders.is_cue
10 folder_files.offset_ms          ← CUE 曲目在整轨内的起始偏移
11 folder_files.track_number
12 folder_files.album_id
13 folder_files.artist_id
14 eq_preset_songs.preset_id
15 folder_files.updated_at
16 NULL
17 NULL
18 folder_files.rating
19 album_artists.album_artist
20 folder_files.album_artist_id
21 folder_files.wave
22 bookmarks.offset_ms             ← ★ 书签播放位置
23 folder_files.url
24 folder_files.bit_rate
25 folder_files.replay_gain
26 (…) AS _has_lyrics
27 in_playlist
```

---

## 4. `a0.n0()` —— 三段 meta 拼接

```java
@Override // com.maxmpz.audioplayer.rest.library.p0, com.maxmpz.audioplayer.rest.library.x2
public final String n0() {
    return "bookmarks.meta||' | '||folder_files.meta||IFNULL(' | '||(SELECT eq_presets.name FROM eq_presets INNER JOIN eq_preset_songs ON eq_preset_songs.preset_id=eq_presets._id WHERE eq_preset_songs.file_id=folder_files._id,''))";
}
```

`ev_fd58a20787d986b587d15ff4d677357c80ebd47bf58e47f0628f67c89cc6b6af`

**注意**：前两段无 `IFNULL`，任一 meta 为 NULL 则整体 NULL。

---

## 5. 列名实证方法

### 5.1 `A0()` / `V()` / `O()` / `i()`

```java
@Override // p0, x2
public final String A0() { return "bookmarks.folder_file_id"; }
```
`ev_cd875db74760b92a8031b365a001fcbebd62a851e8abcc44cc519b30cfc50890`

```java
@Override // x2
public final String V() { return "bookmarks._id"; }
```
`ev_a447c456d59e282ae46fdc9ffebd075149df4dac3f832cd59418f6855361abe9`

```java
@Override // p0, m2
public final String O(int i) { return "bookmarks.sort"; }   // 参数 i 被忽略
```
`ev_bba5c857adf6712173be93e73ad7ce23a2745e3fdaf92e79f9e718ee757aa960`

```java
@Override // x2
public final String i() { return "bookmarks"; }
```
`ev_26cedad9533cc86ccbc89f91de6b960cd0d0e9def83ba8470d089fe05ad9d477`

### 5.2 `H()` —— FROM 子句生成器

```java
@Override // p0
public final String H() {
    return "bookmarks INNER JOIN folder_files ON bookmarks.folder_file_id = folder_files._id "
         + "INNER JOIN folders ON folders._id=folder_files.folder_id "
         + "LEFT JOIN albums ON albums._id=folder_files.album_id "
         + "LEFT JOIN artists ON artists._id=folder_files.artist_id";
}
```
`ev_07be52b21587059d0f492fef1408b9505a6ad2b96ad4f37e8e554e6442f27c0c`

> 与字段 `H: String[]` 同名，JADX 命名冲撞，注意区分。

### 5.3 `T()` —— 重排（确认 `sort` / `created_at`）

```java
@Override // w2
public final boolean T(RestProvider rp, Uri uri, int i) {
    ... h1.b(rp, uri, "bookmarks", "bookmarks._id", "bookmarks.sort", "bookmarks.created_at", i) ...
}
```
`ev_68f833a29e47f9c050d8fd33ae96d5d81970c64fb016a081fed15713d7b73220`

### 5.4 `T0()` / `U0()` —— `shuffle_order`

```java
public final String T0(String str) { ... "bookmarks.shuffle_order" ... }
public final String U0(String str) { ... "bookmarks.shuffle_order" ... }
```
`ev_220d20c5ce0f8ed400075081c2cb03b69ff41dd2ac148fce28621f4e043673f8`

### 5.5 列名汇总（7 列，代码实证）

| 列 | 来源方法 |
| --- | --- |
| `_id` | `V()`、`x()` |
| `folder_file_id` | `A0()`、`X0()` JOIN、`d1()` JOIN |
| `sort` | `O()`、`T()` |
| `created_at` | `T()` |
| `shuffle_order` | `T0()` / `U0()` |
| `meta` | `n0()` |
| **`offset_ms`** | **`d1()`** |

---

## 6. 双向反查与写操作

```java
// 书签 id → 曲目 id
@Override // w2
public final long M0(SQLiteDatabase sQLiteDatabase, long j) {
    return n.y("RestLibraryUtils", sQLiteDatabase,
        "SELECT bookmarks.folder_file_id FROM bookmarks WHERE _id=?", j);
}
// ev_68ac0f0f926f29281e2365ae34956280fff26c3674f746004238167c8283468f

// 曲目 id → 书签 id（无 LIMIT）
@Override // w2
public final long x(SQLiteDatabase sQLiteDatabase, long j, long j2) {
    return n.y("RestBookmarks", sQLiteDatabase,
        "SELECT bookmarks._id FROM bookmarks WHERE bookmarks.folder_file_id=?", j2);
}
```

```java
@Override // c2
public final long k(RestProvider rp, SQLiteDatabase db, Uri uri, ContentValues cv) {
    return db.insert("bookmarks", null, cv);
}
// ev_27b47e53afb65e52085c534ca88b6511c013302a88d9ed6db42c165b8af64973
```

### 6.1 分页（`R0` / `S0`）

两个方法基于 `folder_files.played_at` 做分页锚点，与书签自身列无关：

```java
public final String R0(String str) { ... played_at 相关分页断言 ... }
public final String S0(String str) { ... 同上，另一个方向 ... }
```

`ev_bbbabdabcea18e40c82adc204d505297c83aa3747c6088b4e522722b51d990a2`

⇒ 书签列表的分页**不用 `bookmarks.sort`**，而用曲目的 `played_at`。
这与 `O()` 返回 `"bookmarks.sort"` 形成分工：列表排序用 `sort`，翻页锚点用 `played_at`。

---

## 7. `b0` —— 纯委托壳

```java
@Override
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    this.f3406.getBookmarks().X0(uri, rVar, str, sb, arrayList, i1Var);
    return a0.H;
}
```
`ev_f05b172957a56b0fb89fd5cd16c1eacbb454f71f2dbc8e07d17458e7b446fd53`

---

## 8. DDL 为何取不到

```java
// C0633.onCreate
@Override
public final void onCreate(SQLiteDatabase sQLiteDatabase) {
    onUpgrade(sQLiteDatabase, 0, 244);
}
```
`ev_d7072d4f3731138901f7ca6b328af9d49388fc2349be959b8236ce365117b82e`

`onUpgrade` 体特征：

- 用 `n.n("ALTER TABLE ", str3, " ADD COLUMN ", "last_pos", " INTEGER NOT NULL DEFAULT 0")` 拼接
- `str3 = str`（方法参数），表名外部传入
- **全文搜索 `bookmark` 命中 0 次**
- 日志 tag 出现 `M87_last_position`

`ev_408471b430e38320b096433cb5ff0eefefe005a19b0a875b355f9c09e2d45015`

⇒ 表名不在 `onUpgrade` 字面量中，静态无法枚举完整 DDL。

---

## 9. 写入路径 `a0.u1()`（B2 / B5 闭环）

```java
public final int u1(RestProvider restProvider, h2 h2Var, UriAndIds uriAndIds) {
    long j;
    Cursor cursorE0 = h2Var.E0(restProvider, uriAndIds, null, -1);
    if (cursorE0 == null) {
        return -1;
    }
    int i = 1;
    if (cursorE0.getCount() != 1) {
        cursorE0.close();
        return -1;
    }
    SQLiteDatabase writableDatabase = restProvider.getWritableDatabase();
    Intrinsics.checkNotNull(writableDatabase);
    String strO = androidx.appcompat.widget.n.o("bookmarks.folder_file_id");
    String strO2 = androidx.appcompat.widget.n.o("bookmarks.sort");
    String strO3 = androidx.appcompat.widget.n.o("bookmarks.offset_ms");
    String strO4 = androidx.appcompat.widget.n.o("bookmarks.meta");
    String strO5 = androidx.appcompat.widget.n.o("bookmarks.created_at");
    StringBuilder sbM4 = android.support.v4.media.A.m4("INSERT INTO bookmarks (", strO, ", ", strO2, ", ");
    android.support.v4.media.A.o(sbM4, strO3, ", ", strO4, ", ");
    sbM4.append(strO5);
    sbM4.append(") VALUES (?, ?, ?, ?, ?)");
    SQLiteStatement sQLiteStatementCompileStatement = writableDatabase.compileStatement(sbM4.toString());
    SQLiteStatement sQLiteStatementCompileStatement2 = writableDatabase.compileStatement("SELECT MAX(sort) FROM bookmarks");
    writableDatabase.beginTransactionNonExclusive();
    long jSimpleQueryForLong = sQLiteStatementCompileStatement2.simpleQueryForLong();
    sQLiteStatementCompileStatement2.close();
    long j2 = 0;
    if (jSimpleQueryForLong < 0) {
        jSimpleQueryForLong = 0;
    }
    long j3 = 1;
    long j4 = jSimpleQueryForLong + 1;
    int i2 = uriAndIds.x.getInt("pos_ms", 0);
    StringBuilder sb = new StringBuilder();
    long jCurrentTimeMillis = System.currentTimeMillis();
    int i3 = 0;
    while (cursorE0.moveToNext()) {
        try {
            if (cursorE0.isNull(i)) {
                j = j2;
            } else {
                j = j2;
                if (C0742.f3414.f3789 || cursorE0.getInt(3) == 0) {
                    long j5 = j3;
                    long j6 = cursorE0.getLong(0);
                    Utils.A(sb, i2, false);
                    String string = sb.toString();
                    sQLiteStatementCompileStatement.bindLong(i, j6);
                    long j7 = j4 + j5;
                    sQLiteStatementCompileStatement.bindLong(2, j4);
                    sQLiteStatementCompileStatement.bindLong(3, i2);
                    sQLiteStatementCompileStatement.bindString(4, string);
                    sQLiteStatementCompileStatement.bindLong(5, jCurrentTimeMillis);
                    if (sQLiteStatementCompileStatement.executeInsert() > j) {
                        i3++;
                    }
                    j2 = j;
                    j4 = j7;
                    j3 = j5;
                    i = 1;
                }
            }
            j2 = j;
        } catch (Throwable th) {
            writableDatabase.endTransaction();
            cursorE0.close();
            sQLiteStatementCompileStatement.close();
            throw th;
        }
    }
    if (i3 > 0) {
        writableDatabase.setTransactionSuccessful();
    }
    writableDatabase.endTransaction();
    cursorE0.close();
    sQLiteStatementCompileStatement.close();
    return i3;
}
```

`ev_4fc27fa243586116503a80493a2753fc62b83c87d7d77e79b146bd219a21782f`

### 9.1 字段来源

| bindLong idx | 列 | 值来源 |
| --- | --- | --- |
| 1 | `bookmarks.folder_file_id` | `cursorE0.getLong(0)` |
| 2 | `bookmarks.sort` | `MAX(sort) + 1`（事务内，负值归零，循环中 `+= 1`） |
| **3** | **`bookmarks.offset_ms`** | **`uriAndIds.x.getInt("pos_ms", 0)`** |
| 4 | `bookmarks.meta` | `Utils.A(pos_ms)` 格式化字符串 |
| 5 | `bookmarks.created_at` | `System.currentTimeMillis()`（事务内统一） |

**关键**：`pos_ms` 是 URI/Bundle 参数，缺省 `0`。

---

## 10. `Utils` 时长格式化（B5 闭环）

```java
// com.maxmpz.utils.Utils
public static void A(StringBuilder sb, int i, boolean z) {
    m2719(sb, (i + 500) / 1000, z);
}
```

`ev_16484cc820e2e177317992fee10cc8a0f116d060904c76baa1117b2994442c81`

`A(sb, posMs, false)` ⇒ 毫秒 `+500` 后整除 1000 ⇒ **四舍五入到秒**。

```java
/* JADX INFO: renamed from: х, reason: contains not printable characters */
public static void m2719(StringBuilder sb, int i, boolean z) {
    if (i < 0 || (i == 0 && z)) {
        sb.append(t.f3846);
        return;
    }
    int i2 = i % 60;
    if (i < 3600) {
        sb.append(i / 60);
        sb.append(':');
    } else {
        int i3 = i / 3600;
        int i4 = (i / 60) % 60;
        sb.append(i3);
        sb.append(':');
        if (i4 < 10) {
            sb.append('0');
        }
        sb.append(i4);
        sb.append(':');
    }
    if (i2 < 10) {
        sb.append('0');
    }
    sb.append(i2);
}
```

`ev_e5e2fa2ec2b0e9aa0e1a65921243838ffa27df99fb9a6b00430d80247efd15d8`

### 格式规则

| 条件 | 输出 | 示例 |
| --- | --- | --- |
| `i < 0` 或 `i == 0 && z` | `t.f3846` 占位符 | `--:--` |
| `i < 3600` | `M:SS`（分钟**不**补零） | `3:07` |
| `i >= 3600` | `H:MM:SS`（分钟补零） | `1:03:07` |

⇒ **分钟补零规则在两个分支间不一致**；秒在各分支均补零。

---

## 11. 其它操作方法

```java
// a0.q0 —— 删除
public final com.maxmpz.utils.y q0(RestProvider restProvider, UriAndIds uriAndIds) throws Throwable {
    long[] jArr = uriAndIds.A;
    Bundle bundle = uriAndIds.x;
    if (jArr.length != 0) {
        if (bundle.getBoolean("force_files_deletion")) {
            g1 g1Var = this.f3406;
            return g1Var.getBookmarksFilesForced().mo2455(restProvider, g1Var.getBookmarksFilesForced().B0(), jArr, 0, jArr.length, bundle.getInt("num_cats", 0), uriAndIds, C0742.p.f3789);
        }
        int i = bundle.getInt("num_cats", 0);
        StringBuilder sb = new StringBuilder((jArr.length * 5) + 64);
        if (e0(uriAndIds.B, jArr, 0, jArr.length, i, sb, new StringBuilder(), false) && i == 0) {
            restProvider.delete(uriAndIds.B, sb.toString(), null);
            return new com.maxmpz.utils.y(jArr);
        }
    }
    return null;
}
```
`ev_5743cf276494bdb98995b6d742888d89be93c0a3adf95cbec870c0efee622065`

```java
// a0.p —— 批量重排
@Override // w2
public final boolean p(RestProvider restProvider, Uri uri, int[] iArr) {
    Uri uriB0 = B0();
    if (iArr.length > 1) {
        SQLiteDatabase writableDatabase = restProvider.getWritableDatabase();
        Intrinsics.checkNotNull(writableDatabase);
        Cursor cursorA = restProvider.A(uriB0, new String[]{"bookmarks._id", "bookmarks.sort"}, null, null, null, false);
        if (cursorA != null) {
            try {
                writableDatabase.beginTransactionNonExclusive();
                if (!h1.m2449(writableDatabase, cursorA, iArr, this)) {
                    return false;
                }
                writableDatabase.setTransactionSuccessful();
                return true;
            } finally {
                cursorA.close();
                writableDatabase.endTransaction();
            }
        }
    }
    return false;
}
```
`ev_6157af9be3a7ec2ae08e50ddbb2637d7822341b478640f82fe2c854da1508a9b`

---

## 12. 未取项

| # | 项 | 状态 |
| --- | --- | --- |
| B1 | `bookmarks` 完整 DDL（变量拼 SQL） | 开放 |
| ~~B2~~ | ✅ `offset_ms` 写入方 | **已闭环，§9** |
| B3 | `n1()` / `r1()` / `s1()` / `v()` 语义 | 开放 |
| B4 | `x()` 无 LIMIT 的实际行为 | 开放 |
| ~~B5~~ | ✅ `bookmarks.meta` 内容格式 | **已闭环，§10** |
| B6 | `d()` / `k0()` / `c()` / `s()` / `z()` 等分类元数据方法 | 开放 |
| B7 | `q0()` 删除 / `p()` 重排的完整语义 | 开放（§11 已收原文） |
| **B8** | `pos_ms` 在 UI 侧的赋值点 | 开放 |
| **B9** | `t.f3846` 占位符文本 | 开放 |
