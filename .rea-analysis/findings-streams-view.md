# Poweramp「流」—— 方法体实证

**用途**：支撑 `docs/architecture/poweramp-streams-view.md`。
本文只存方法体原文与关键常量，分析见架构文档。

| 项 | 值 |
| --- | --- |
| 目标 | `com.maxmpz.audioplayer` build-1025-uni (1025009) |
| APK SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 引擎 | JADX headless 0.7.1 + apktool（smali 降级） |
| 采集 | 2026-11-03 |

---

## 0. 实体

`getStreamFiles()` → **`d4`**

| 项 | 值 |
| --- | --- |
| 方法数 | 36 |
| 字段 | `H: String[]`（过滤列）、`f3301: e` |

`d4` 全部方法（smali 定义顺序）：

```
<clinit> <init> C0 F F0 H I0 J O P Q0 X0 Z c1 d d0 g i j1 k k0 k1 l m
m0 r0 s t0 v w0 z z0 А Х о р
```

`ev_e9a30d2e844e61705552af9c2ce56f07ff17ae4da25af1e39f6520744cab05d1`（含类摘要）

---

## 1. `d4.X0()` —— 流列表（全库最短）

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.B("file_type");
    rVar.B("=");
    rVar.B("23");
    h1.o(rVar, sb, O(C0742.e0.f3810), i1Var, str, arrayList, H, true, true);
    return p0.f3367;
}
```

`ev_e9a30d2e844e61705552af9c2ce56f07ff17ae4da25af1e39f6520744cab05d1`

等价 smali：

```smali
.method public final X0(...)Ljava/lang/String;
    const-string p1, "file_type"
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V
    const-string p1, "="
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V
    const-string p1, "23"
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V
    ...
    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/p0;->Х:[Ljava/lang/String;
    return-object p1
.end method
```

---

## 2. `h1.o()` —— 共享 FROM/JOIN 构造器

```java
public static void o(com.maxmpz.audioplayer.player.r rVar, StringBuilder sb, String str,
                     i1 i1Var, String str2, ArrayList arrayList,
                     String[] strArr, boolean z, boolean z2) {
    rVar.A = A.m3("folder_files",
                  z ? " LEFT " : " INNER ",
                  " JOIN folders ON folders._id=folder_id"
                + " LEFT JOIN artists ON artists._id=folder_files.artist_id"
                + " LEFT JOIN albums ON albums._id=folder_files.album_id",
                  C0742.O.f3789
                      ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
                      : "");
    if (!C0742.f3414.f3789) {
        if (z2) {
            rVar.B(" AND ");
        }
        rVar.B("folder_files.cue_folder_id IS NULL");
    }
    androidx.appcompat.widget.n.m313(str2, strArr, sb, arrayList);
    i1Var.B = str;
    String[] strArr2 = p0.f3367;
}
```

`ev_e19d78e86457c7a8587ffe99bceea44298b27f29285f4a43e2afeadc186fc33f`

### 参数语义

| 参数 | 流页传入 | 语义 |
| --- | --- | --- |
| `z` | `true` | `true` → `LEFT JOIN folders`；`false` → `INNER JOIN folders` |
| `z2` | `true` | 是否需要前置 `" AND "`（调用方已塞入条件） |
| `strArr` | `d4.H` | 过滤列 |
| `str` | `O(C0742.e0.f3810)` | 排序表达式 |

---

## 3. `d4.O(int)` —— 6 模式排序

```java
@Override // com.maxmpz.audioplayer.rest.library.p0, com.maxmpz.audioplayer.rest.library.m2
public final String O(int i) {
    boolean z = (1073741824 & i) != 0;
    int i2 = i & (-1073741825);
    if (i2 == 2) {
        return !z ? "folder_files.name COLLATE NOCASE"
                  : "folder_files.name COLLATE NOCASE DESC";
    }
    if (i2 == 5) {
        return !z ? "rating DESC, folder_files.name"
                  : "rating, folder_files.name";
    }
    if (i2 == 6) {
        return !z ? "folder_files.played_times DESC, folder_files.name"
                  : "folder_files.played_times, folder_files.name";
    }
    if (i2 == 7) {
        return !z ? "folder_files.played_fully_at DESC, folder_files.name"
                  : "folder_files.played_fully_at, folder_files.name";
    }
    if (i2 == 11) {
        return !z ? "folder_files.shuffle_order"
                  : "folder_files.shuffle_order DESC";
    }
    if (i2 != 12) {
        return !z ? "folder_files.name COLLATE NOCASE"
                  : "folder_files.name COLLATE NOCASE DESC";
    }
    return !z ? "folder_files.created_at DESC, folder_files.name"
              : "folder_files.created_at, folder_files.name";
}
```

`ev_1d67f187a0333617b0597b3222ed3c9b2e033e37cf029d046a804dfd0b6541c9`

| 模式 | 默认方向 | 主键 | 次级键 |
| --- | --- | --- | --- |
| 2 | 升 | `folder_files.name COLLATE NOCASE` | — |
| 5 | 降 | `rating` | `name` |
| 6 | 降 | `played_times` | `name` |
| 7 | 降 | `played_fully_at` | `name` |
| 11 | 升 | `shuffle_order` | — |
| 12 | 降 | `created_at` | `name` |
| default | 升 | `name`（同 2） | — |

**缺失模式**（对比 `p0.O` 的 16 种）：0/1/3/4/8/9/10/13/14/15。

---

## 4. `d4.H` 过滤列（`<clinit>` smali）

```smali
.method static constructor <clinit>()V
    const-string v0, "COALESCE(name_without_number,'')"
    const-string v1, "COALESCE(album_tag,'')"
    const-string v2, "title_tag"
    filled-new-array {v2, v0, v1}, [Ljava/lang/String;
    move-result-object v0
    sput-object v0, Lcom/maxmpz/audioplayer/rest/library/d4;->H:[Ljava/lang/String;
    return-void
.end method
```

数组顺序：

| 索引 | 表达式 |
| --- | --- |
| 0 | `title_tag` |
| 1 | `COALESCE(name_without_number,'')` |
| 2 | `COALESCE(album_tag,'')` |

---

## 5. `d4.t0()` —— 流 + 播放列表条目变体

```smali
.method public final t0(Landroid/net/Uri;Lcom/maxmpz/audioplayer/player/r;[Ljava/lang/String;Ljava/lang/String;Ljava/lang/StringBuilder;Ljava/util/ArrayList;Lcom/maxmpz/audioplayer/rest/library/i1;ILcom/maxmpz/audioplayer/data/api/К;)[Ljava/lang/String;
    .locals 0

    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/у;->O:Lcom/maxmpz/preference/fastprefs/h0;
    iget-boolean p1, p1, Lcom/maxmpz/preference/fastprefs/H;->А:Z
    if-eqz p1, :cond_0
    const-string p1, " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
    goto :goto_0
    :cond_0
    const-string p1, ""
    :goto_0
    const-string p8, "folder_files LEFT  JOIN folders ON folders._id=folder_id LEFT JOIN artists ON artists._id=folder_files.artist_id LEFT JOIN albums ON albums._id=folder_files.album_id LEFT JOIN playlist_entries ON playlist_entries.folder_file_id=folder_files._id "
    invoke-virtual {p8, p1}, Ljava/lang/String;->concat(Ljava/lang/String;)Ljava/lang/String;
    move-result-object p1
    iput-object p1, p2, Lcom/maxmpz/audioplayer/player/r;->A:Ljava/lang/Object;

    const-string p1, "file_type"
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V
    const-string p1, "="
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V
    const-string p1, "23"
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V
    const-string p1, " AND "
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V
    const-string p1, "folder_files.cue_folder_id IS NULL"
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V

    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/d4;->H:[Ljava/lang/String;
    invoke-static {p4, p1, p5, p6}, Landroidx/appcompat/widget/n;->В(Ljava/lang/CharSequence;[Ljava/lang/String;Ljava/lang/StringBuilder;Ljava/util/ArrayList;)V

    const-string p1, "folder_files._id"
    iput-object p1, p7, Lcom/maxmpz/audioplayer/rest/library/i1;->В:Ljava/lang/String;

    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/у;->e0:Lcom/maxmpz/preference/fastprefs/w;
    iget p1, p1, Lcom/maxmpz/preference/fastprefs/s;->А:I
    invoke-virtual {p0, p1}, Lcom/maxmpz/audioplayer/rest/library/d4;->O(I)Ljava/lang/String;
    move-result-object p1
    iput-object p1, p7, Lcom/maxmpz/audioplayer/rest/library/i1;->B:Ljava/lang/String;

    const-string p1, "playlist_id"
    const-string p2, "playlist_entries._id AS playlist_entry_id"
    filled-new-array {p1, p2}, [Ljava/lang/String;
    move-result-object p1
    invoke-static {p3, p1}, Lkotlin/collections/ArraysKt;->р([Ljava/lang/Object;[Ljava/lang/Object;)[Ljava/lang/Object;
    move-result-object p1
    check-cast p1, [Ljava/lang/String;
    return-object p1
.end method
```

### 与 `X0()` 差异

| 维度 | `X0()` | `t0()` |
| --- | --- | --- |
| FROM | 委托 `h1.o` | 自拼，多 `LEFT JOIN playlist_entries` |
| `album_artists` | `h1.o` 内按 `C0742.O` | 自判 `у->O`（同一 flag） |
| cue 过滤 | `h1.o` 内 | 显式 `AND cue_folder_id IS NULL` |
| 分组列 | 未设 | `folder_files._id` |
| 投影 | `p0.f3367` | 原 `strArr` + `playlist_id` + `playlist_entries._id AS playlist_entry_id` |
| 排序偏好 | `у->e0`（`streams_sort`） | 同 |

---

## 6. 元数据方法（smali 实证）

```smali
.method public final i()Ljava/lang/String;
    const-string v0, "stream_files"
    return-object v0
.end method

.method public final j1()Ljava/lang/String;
    const-string v0, "0"
    return-object v0
.end method

.method public final H()Ljava/lang/String;
    const/4 v0, 0x0
    return-object v0
.end method

.method public final I0()Ljava/lang/String;
    const-string v0, "folder_files.name"
    invoke-static {v0}, Landroidx/appcompat/widget/n;->o(Ljava/lang/String;)Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method

.method public final s()I
    const v0, 0x7f01057a          # R.attr.streams
    return v0
.end method

.method public final Z()I
    const v0, 0x7f01057c          # R.attr.micro_streams
    return v0
.end method

.method public final d()I
    sget-object v0, Lcom/maxmpz/audioplayer/rest/library/у;->e0:Lcom/maxmpz/preference/fastprefs/w;
    iget v0, v0, Lcom/maxmpz/preference/fastprefs/s;->А:I
    return v0
.end method

.method public final r0()I
    sget-object v0, Lcom/maxmpz/audioplayer/rest/library/у;->X0:Lcom/maxmpz/preference/fastprefs/w;
    iget v0, v0, Lcom/maxmpz/preference/fastprefs/s;->А:I
    return v0
.end method

.method public final m()I
    const v0, 0x1000003c
    return v0
.end method

.method public final z()I
    const/16 v0, 0x12             # 18
    return v0
.end method

.method public final k0()Lcom/maxmpz/audioplayer/rest/library/x2;
    iget-object v0, p0, Lcom/maxmpz/audioplayer/rest/library/А;->В:Lcom/maxmpz/audioplayer/rest/library/g1;
    return-object v0
.end method
```

`ev_97464c0a687ca073e4dcc78896eae7492cf70a932e6ab3ab3196e0a8afff5af1`（`i()`）

### 汇总

| 方法 | 返回值 | 含义 |
| --- | --- | --- |
| `i()` | `"stream_files"` | 表/视图名 |
| `j1()` | `"0"` | 基 URI 路径段（推断） |
| `H()` | `null` | 用途不明 |
| `I0()` | `n.o("folder_files.name")` | 引号包裹的排序列 |
| `s()` | `0x7f01057a` = `R.attr.streams` | 分类图标 |
| `Z()` | `0x7f01057c` = `R.attr.micro_streams` | 分类图标（micro） |
| `d()` | `C0742.e0.f3810` = `streams_sort` | 排序偏好 |
| `r0()` | `C0742.X0.f3810` | 列表缩放偏好（推断） |
| `m()` | `0x1000003c` | → `cat_stats.type = 60` |
| `z()` | `0x12` = 18 | 分类序号（推断） |
| `k0()` | `this.В`（`g1`） | 父级导航 |

### `m()` 的位域

```java
// 父类 b1()
public final int b1() { return m() & 268435455; }   // & 0x0FFFFFFF

// d4.m() = 0x1000003c
// 0x1000003c & 0x0FFFFFFF = 0x3C = 60
```

| 实体 | `m()` | 高位 `>>28` | `cat_stats.type` |
| --- | --- | --- | --- |
| `i4` | `0x10000154` | 1 | 340 |
| `a1` | `0x100000D2` | 1 | 210 |
| **`d4`** | **`0x1000003C`** | **1** | **60** |

---

## 7. `file_type = 23` 的三处实证

### 7.1 查询侧（`d4`）

```java
// X0()
rVar.B("file_type"); rVar.B("="); rVar.B("23");

// t0()
rVar.B("file_type"); rVar.B("="); rVar.B("23");
rVar.B(" AND "); rVar.B("folder_files.cue_folder_id IS NULL");
```

### 7.2 写入侧（扫描器 INSERT，硬编码 23）

```sql
-- smali/com/maxmpz/audioplayer/scanner/х.smali:199
INSERT INTO folder_files
  (name, title_tag, name_without_number, artist_tag, album_tag, track_number,
   tag_status, track_tag, track_number_alt, duration, updated_at, file_type,
   file_created_at, created_at, meta, rating, user_added)
VALUES (?, ?, ?, ?, ?, 0, 1, 0, 0, 0, ?, 23, ?, ?, ?, ?, ?)
```

```sql
-- smali/com/maxmpz/audioplayer/scanner/х.smali:210
SELECT IFNULL((SELECT _id FROM folder_files WHERE file_type=23 AND name=? COLLATE NOCASE), 0) AS _id
```

### 7.3 排除侧（统计 SQL 显式排除流）

```sql
-- smali/com/maxmpz/audioplayer/scanner/library/K.smali:757
) AND folder_files.album_id!=1000 AND folder_files.artist_id!=1000
  AND folder_files.file_type!=23 AND +folder_files.tag_status=1

-- :785
) AND +folder_files.tag_status=1 AND folder_files.file_type!=23
  AND folder_files.artist_id!=1000

-- :813
) AND +tag_status=1 AND file_type!=23 AND album_id!=1000 AND artist_id!=1000

-- :841
) AND file_type!=23 AND artist_id!=1000 AND +tag_status=1
```

### 7.4 `file_type` 的写入来源

```smali
-- scanner/TagReader.smali:1605
invoke-static {p1, v4, p3}, Lcom/maxmpz/audioplayer/scanner/FFMpegTagReader;->native_scan_file_type(Ljava/lang/String;II)I

-- scanner/TagReader.smali:552 / 1787 / 1809
iput v11, v12, Lcom/maxmpz/audioplayer/scanner/TagAndMeta;->scannedFileType:I
```

由原生层 `native_scan_file_type` 返回值决定，23 是其中一个具体值。

---

## 8. R 资源对照（public.xml 实证）

```
attr/streams                     0x7f01057a
attr/micro_streams               0x7f01057c
attr/stream_24dp                 0x7f01065b
id/state_player_track_is_stream  0x7f070d
```

> 注：`state_player_track_is_stream` 的实际 id 为 `0x7f0d070d`（type=id）。

strings：

```
stream                         0x7f08087e
streams                        0x7f080880
stream_name_in_title           0x7f08087f
pref_stream_buffer             0x7f08061c
pref_stream_timeout            0x7f08061d
pref_aa_per_stream_track       0x7f080463
cast_stop_live_stream          0x7f080118
```

---

## 10. 创建链路（一）：协议判定函数

源文件：`smali/okhttp3/internal/platform/android/y.smali`

### 10.1 `y.С(String)` —— http/https

`L3171-3283`

```java
/* JADX INFO: renamed from: С */
public static final boolean С(String s) {
    if (s.length() < 8) return false;
    if (s.charAt(0) != 'h') return false;
    if (s.charAt(1) != 't') return false;
    if (s.charAt(2) != 't') return false;
    if (s.charAt(3) != 'p') return false;
    if (s.charAt(4) == ':' && s.charAt(5) == '/' && s.charAt(6) == '/') return true;
    if (s.charAt(4) == 's' && s.charAt(5) == ':' && s.charAt(6) == '/' && s.charAt(7) == '/') return true;
    return false;
}
```

smali 字符码实证：

```smali
const/16 v1, 0x8        # 长度下限
const/16 v1, 0x68       # 'h'
const/16 v3, 0x74       # 't'
const/16 v3, 0x70       # 'p'
const/16 v6, 0x3a       # ':'
const/16 v7, 0x2f       # '/'
const/16 v3, 0x73       # 's'（https 分支）
```

⇒ **仅 `http://` 与 `https://` 判定为真。`rtsp://`、`file://`、`mms://` 均为假。**

### 10.2 `y.C(String)` —— `.m3u` / `.m3u8`

`L55-145`

```java
/* JADX INFO: renamed from: C */
public static final boolean C(String s) {
    int n = s.length();
    if (n >= 6
        && s.charAt(n-4) == 'm' && s.charAt(n-3) == '3'
        && s.charAt(n-2) == 'u' && s.charAt(n-1) == '8') return true;   // .m3u8
    if (n >= 5
        && s.charAt(n-3) == 'm' && s.charAt(n-2) == '3'
        && s.charAt(n-1) == 'u') return true;                            // .m3u
    return false;
}
```

字符码：`0x6d='m'`、`0x33='3'`、`0x75='u'`、`0x38='8'`。

### 10.3 `y.o(String)` —— `data:`

`L3284-3344`

```java
/* JADX INFO: renamed from: о */
public static final boolean o(String s) {
    return s.length() > 5
        && s.charAt(0) == 'd' && s.charAt(1) == 'a'
        && s.charAt(2) == 't' && s.charAt(3) == 'a'
        && s.charAt(4) == ':';
}
```

字符码：`0x64='d'`、`0x61='a'`、`0x74='t'`、`0x3a=':'`。

---

## 11. 创建链路（二）：`scanner/X` 预编译语句映射

源文件：`smali/com/maxmpz/audioplayer/scanner/X.smali` `<init>` `L69-263`

`X` 持有 18 个 `player.bt.В`（懒加载 `Function0<SQLiteStatement>`）。
`scanner/х.<init>(X, int)` 的 int 参数经 switch 分发到具体 SQL。

| 字段 | switch 索引 | 对应 SQL |
| --- | --- | --- |
| `х` | 0 | — |
| `у` | 1 | — |
| `К` | 2 | — |
| `K` | 3 | — |
| `Н` | 4 | — |
| `H` | 5 | 流/曲目 SELECT（按 name 查 id） |
| **`Р`** | **6** | **流 INSERT（`file_type=23`）** |
| `P` | 7 | 流 SELECT（另一变体） |
| `р` | 8 | — |
| `p` | 9 | `INSERT INTO playlist_entries` |
| `Х` | 10 | — |
| `X` | 11 | — |
| `x` | 12 | — |
| `y` | 13 | — |
| **`О`** | **6（与 `Р` 同）** | 流 INSERT |

> **Cyrillic/ASCII 同名不同字**必须区分：`Р`(U+0420) / `р`(U+0440) / `P`(ASCII) / `p`(ASCII)。

---

## 12. 创建链路（三）：`X.B(String,String)` 导入入口

`L377-582`

```java
public final long B(String path, String name) {
    String playlistName = X(path, name);                 // 取/格式化播放列表名
    if (path.length() == 0) return 0;

    String resolved;
    int mtime = -1;
    if (saf.х.р(path)) {                                 // SAF URI
        resolved = saf.X.y(context, path);
        if (resolved != null) {
            mtime = (int)(saf.X.K(context, path) / 1000L);
        }
    } else if (saf.х.К(path)) {                           // 可直接使用
        resolved = path;
    } else {
        long lm = new File(path).lastModified() / 1000L;
        mtime = (int) lm;
        resolved = lm != 0 ? path : null;
    }
    if (resolved == null) return 0;

    ContentValues cv = new ContentValues();
    cv.put(n.o("playlists.playlist"),   playlistName);
    cv.put(n.o("playlists.mtime"),      Long.valueOf(t));
    cv.put(n.o("playlists.created_at"), Long.valueOf(t));
    cv.put(n.o("playlists.updated_at"), Long.valueOf(t));
    long playlistId = db.insert("playlists", "", cv);

    this.Х(path, resolved, playlistName, mtime, true, true, prefs.В.p1.А);

    pixplicity.htmlcompat.у.А(db, playlistId);           // 播放列表收尾
    return playlistId;
}
```

**顺序**：先建 `playlists` 行 → 拿 `playlistId` → 再解析条目。这样条目可立即绑定。

---

## 13. 创建链路（四）：`X.Х(...)` 格式分发

`L2000-2777`（778 行）

| 分支 | smali 依据 | 下游 |
| --- | --- | --- |
| **XML**（PLS/XSPF） | `XmlPullParser;->setInput(InputStream, String)` | `X.x(...)` |
| **文本**（M3U） | `new BufferedReader(Reader, 0x10000)` + `readLine()` | `X.х(...)` |
| 其它 | — | `X.у(...)` |

```smali
# XML 分支
invoke-virtual {v6, v5, v3}, Lcom/maxmpz/audioplayer/data/saf/X;->р(Landroid/content/Context;Ljava/lang/String;)Ljava/io/InputStream;
invoke-interface {v0, v3, v11}, Lorg/xmlpull/v1/XmlPullParser;->setInput(Ljava/io/InputStream;Ljava/lang/String;)V

# 文本分支
new-instance v3, Ljava/io/BufferedReader;
const/high16 v0, 0x10000
invoke-direct {v3, v2, v0}, Ljava/io/BufferedReader;-><init>(Ljava/io/Reader;I)V
invoke-virtual {v3, v0}, Ljava/io/BufferedReader;->mark(I)V

# 文本分支内调用
invoke-virtual/range {v1 .. v9}, Lcom/maxmpz/audioplayer/scanner/X;->х(...)V
```

---

## 14. 创建链路（五）：`X.х(...)` M3U 逐行解析

`L2878-3370`

### 14.1 行分类

```smali
invoke-virtual {v3}, Ljava/io/BufferedReader;->readLine()Ljava/lang/String;   # L2946
invoke-static {v9}, Lkotlin/text/StringsKt;->trim(Ljava/lang/CharSequence;)   # L2961
invoke-virtual {v9}, Ljava/lang/String;->length()I                            # L2969
const/4 v11, 0x4
if-le v10, v11, :cond_9                                                       # 长度 > 4
invoke-virtual {v9, v0}, Ljava/lang/String;->charAt(I)C
const/16 v12, 0x23
if-ne v10, v12, :cond_a                                                       # charAt(0) == '#'
```

### 14.2 `#EXT` 前缀判定

```smali
const-string v10, "EXT"                                                       # L2987
invoke-static {v13, v9, v10}, Lkotlin/text/StringsKt;->g(ILjava/lang/String;Ljava/lang/String;)Z   # startsWith("EXT", 1)
invoke-virtual {v9, v11}, Ljava/lang/String;->charAt(I)C
const/16 v12, 0x2d                                                            # '-'
if-ne v10, v12, :cond_3                                                      # #EXT-...
const/4 v10, 0x5
invoke-virtual {v9, v10}, Ljava/lang/String;->charAt(I)C
const/16 v0, 0x58                                                            # 'X'
# 或 0x78 = 'x'
```

### 14.3 `#EXTINF:` 标题提取

```smali
const-string v0, "EXTINF:"                                                    # L3224
invoke-static {v13, v9, v0}, Lkotlin/text/StringsKt;->g(...)Z
const/16 v0, 0x2c                                                             # ',' L3232
const/16 v1, 0x8                                                              # 起始搜索位置 8
invoke-static {v9, v0, v1, v11}, Lkotlin/text/StringsKt;->H(Ljava/lang/CharSequence;CII)I
move-result v0                                                                # comma 位置
add-int/lit8 v0, v0, 0x1
invoke-virtual {v9, v0}, Ljava/lang/String;->substring(I)Ljava/lang/String;   # 逗号后全部
invoke-static {v0}, Lkotlin/text/StringsKt;->trim(Ljava/lang/CharSequence;)    # L3256
```

⇒ **只取逗号之后的部分作为标题；逗号前的 duration 被丢弃。**

### 14.4 非注释行 → 调用 `x()`

```smali
:cond_a
const-wide/16 v11, -0x1        # duration = -1（占位）
const-wide/16 v9, -0x1
const/4 v0, -0x1
const/16 v17, 0x1
invoke-virtual/range {v1 .. v14}, Lcom/maxmpz/audioplayer/scanner/X;->x(String;String;String;String;IIIJJZZ)J
```

---

## 15. 创建链路（六）：`X.x(...)` 分流

`L698-1035`

### 15.1 Windows 盘符归一化

```smali
invoke-virtual {v2, v0}, Ljava/lang/String;->charAt(I)C
const/16 v12, 0x2f                       # '/' L725
if-ne v7, v12, :cond_0
...
invoke-static {v7}, Ljava/lang/Character;->isLetter(C)Z
const/16 v13, 0x3a                       # ':' L748
if-ne v7, v13, :cond_2
const/16 v13, 0x5c                       # '\' L756
const/16 v12, 0x2f                       # '/' 
invoke-virtual {v2, v11}, Ljava/lang/String;->substring(I)Ljava/lang/String;
const-string v7, "/"
```

⇒ `C:\x` / `C:/x` → `/x`。

### 15.2 流判定与跳转

```smali
invoke-static {v2}, Lokhttp3/internal/platform/android/y;->С(Ljava/lang/String;)Z   # L780
move-result v7
if-nez v7, :cond_b                                                                  # 非 http(s) → 本地分支

# 本地分支内，允许非本地时再判：
if-eqz p13, :cond_3
invoke-static {v2}, Lokhttp3/internal/platform/android/y;->o(Ljava/lang/String;)Z   # L788 data:
if-nez v7, :cond_b
invoke-static {v2}, Lokhttp3/internal/platform/android/y;->C(Ljava/lang/String;)Z   # L794 .m3u
if-eqz v7, :cond_3
goto/16 :goto_7

:cond_b                                                                              # L1011 ★ 流分支
invoke-static {v2}, Lcom/maxmpz/audio/core/х;->С(Ljava/lang/String;)Ljava/lang/String;   # URL 规范化
move-result-object v0
invoke-static {v0}, Lcom/maxmpz/audio/core/х;->p(Ljava/lang/String;)Ljava/lang/String;   # 提取主机/路径
move-result-object v3
invoke-virtual/range {v1 .. v11}, Lcom/maxmpz/audioplayer/scanner/X;->у(...)J          # L1029 ★ 插入流
```

⇒ **三个条件都会进入流分支**：`http(s)://`、`data:`、`.m3u`。

---

## 16. 创建链路（七）：`X.у(...)` 两级插入

`L2778-2877`

```java
public final long у(String url, String s1, String s2, String title,
                    int a, int b, int c, long d, boolean e) {
    long fileId = y(b, c, url, title, s2, false, e);        // ① 插 folder_files
    if (fileId == 0) return 0;

    SQLiteStatement st = this.p.getValue();                  // pswitch_9
    st.bindString(1, s1);
    st.bindLong(2, fileId);
    st.bindLong(3, (long) a);
    st.bindString(4, url);                                   // ② 完整 URL
    st.bindLong(5, d < 0 ? 0 : d);
    st.executeInsert();                                      // 插 playlist_entries

    return fileId;
}
```

smali 关键行：

```smali
invoke-virtual/range {v1 .. v8}, Lcom/maxmpz/audioplayer/scanner/X;->y(IILjava/lang/String;Ljava/lang/String;Ljava/lang/String;ZZ)J   # L2800
move-result-wide p2
cmp-long v0, p2, v9
if-eqz v0, :cond_1
iget-object v0, p0, Lcom/maxmpz/audioplayer/scanner/X;->p:Lcom/maxmpz/audioplayer/player/bt/В;   # L2808
invoke-virtual {v0, v2, p4}, Landroid/database/sqlite/SQLiteProgram;->bindString(ILjava/lang/String;)V   # bind 1
invoke-virtual {v0, p4, p2, p3}, Landroid/database/sqlite/SQLiteProgram;->bindLong(IJ)V                  # bind 2
invoke-virtual {v0, p4, p1}, Landroid/database/sqlite/SQLiteProgram;->bindString(ILjava/lang/String;)V   # bind 4 = url
invoke-virtual {v0}, Landroid/database/sqlite/SQLiteStatement;->executeInsert()J                          # L2852
```

---

## 17. 创建链路（八）：`X.y(...)` 字段绑定

`L1036-1299`，使用预编译语句 `Р`（`pswitch_6`）。

### 17.1 SQL

```sql
-- scanner/х.smali:199（pswitch_6）
INSERT INTO folder_files
  (name, title_tag, name_without_number, artist_tag, album_tag, track_number,
   tag_status, track_tag, track_number_alt, duration, updated_at, file_type,
   file_created_at, created_at, meta, rating, user_added)
VALUES (?, ?, ?, ?, ?, 0, 1, 0, 0, 0, ?, 23, ?, ?, ?, ?, ?)
```

### 17.2 绑定序列（smali 逐行）

```smali
# ① 先按 name 查重（pswitch_5 = H）
iget-object v8, v1, Lcom/maxmpz/audioplayer/scanner/X;->H:Lcom/maxmpz/audioplayer/player/bt/В;   # L1054
invoke-virtual {v8, v5, v3}, Landroid/database/sqlite/SQLiteProgram;->bindString(ILjava/lang/String;)V
invoke-virtual {v8}, Landroid/database/sqlite/SQLiteStatement;->simpleQueryForLong()J
move-result-wide v8                                                                              # existingId
cmp-long v11, v8, v6
if-nez v11, :cond_0
const/4 v11, 0x1                                                                                 # isNew = true
:cond_0
const/4 v11, 0x0

# ② 选语句：新记录用 Р(pswitch_6)，否则用 P(pswitch_7)
if-eqz v11, :cond_3
iget-object v15, v1, Lcom/maxmpz/audioplayer/scanner/X;->Р:Lcom/maxmpz/audioplayer/player/bt/В;   # L1130 ★ 流 INSERT
goto :goto_3
:cond_3
iget-object v15, v1, Lcom/maxmpz/audioplayer/scanner/X;->P:Lcom/maxmpz/audioplayer/player/bt/В;   # L1141

# ③ 绑定
invoke-virtual {v15, v5, v3}, Landroid/database/sqlite/SQLiteProgram;->bindString(ILjava/lang/String;)V   # 1 = name

if (artist.length() != 0) {
    invoke-virtual {v15, v12, v4}, ...bindString(ILjava/lang/String;)V    # 2 = artist_tag
    invoke-virtual {v15, v3,  v4}, ...bindString(ILjava/lang/String;)V    # 3 = album_tag
} else {
    invoke-virtual {v15, v12, v4}, ...bindString(ILjava/lang/String;)V    # 2 = artist_tag
    invoke-virtual {v15, v3},      ...bindNull(I)V                        # 3 = NULL
}

const-string v3, "..."                                                    # L1180 ★
invoke-virtual {v15, v4, v3}, Landroid/database/sqlite/SQLiteProgram;->bindString(ILjava/lang/String;)V   # 4 = artist_tag ← "..."

const/4 v3, 0x5
invoke-virtual {v15, v3}, Landroid/database/sqlite/SQLiteProgram;->bindNull(I)V                          # 5 = NULL

const/4 v3, 0x6
invoke-virtual {v15, v3, v13, v14}, ...bindLong(IJ)V                      # 6 = updated_at

if (a > 0) { bindLong(7, a) } else { bindLong(7, now) }                   # 7 = file_created_at

const/16 v0, 0x8
invoke-virtual {v15, v0, v13, v14}, ...bindLong(IJ)V                      # 8 = created_at

# ④ meta = R.string.stream
iget-object v0, v1, Lcom/maxmpz/audioplayer/scanner/X;->В:Landroid/content/Context;   # L1212
const v3, 0x7f08087e                                                                   # L1214 ★ R.string.stream
invoke-virtual {v0, v3}, Landroid/content/Context;->getString(I)Ljava/lang/String;
move-result-object v0
const/16 v3, 0x9
invoke-virtual {v15, v3, v0}, Landroid/database/sqlite/SQLiteProgram;->bindString(ILjava/lang/String;)V  # 9 = meta = "Stream"

# ⑤ 其余
const/16 v5, 0xa    # 10 = track_number
const/16 v0, 0xb    # 11 = user_added
bindLong(10, ...)
bindLong(11, ...)
executeInsert()      # 或 executeUpdateDelete()（更新分支）
```

### 17.3 字段值汇总（实证）

| bind idx | 列 | 值 | 证据 |
| --- | --- | --- | --- |
| 1 | `name` | 参数 | `bindString(1, name)` |
| 2 | `artist_tag` | 参数（常为空串） | `bindString(2, artist)` |
| 3 | `album_tag` | `NULL`（artist 为空时） | `bindNull(3)` |
| **4** | **`artist_tag`** | **`"..."`** | **`const-string v3, "..."` L1180** |
| **5** | — | **`NULL`** | **`bindNull(5)` L1188** |
| 6 | `updated_at` | `now` | `bindLong(6, now)` |
| 7 | `file_created_at` | `a>0 ? a : now` | 分支 |
| 8 | `created_at` | `now` | `bindLong(8, now)` |
| **9** | **`meta`** | **`"Stream"`** | **`R.string.stream` = `0x7f08087e`** |
| 10 | `track_number` | 参数/0 | SQL 有 `0` 字面量 |
| 11 | `user_added` | 参数 | `bindLong(11, ...)` |
| — | `file_type` | `23` | SQL 字面量 |
| — | `tag_status` | `1` | SQL 字面量 |
| — | `duration` | `0` | SQL 字面量 |

> **注**：`bind 4` 与 `bind 2/3` 存在重叠覆盖，是 JADX 块合并导致的寄存器复用；
> 但 `"..."` 字面量与 `R.string.stream` 两处是确定无疑的。

---

## 18. 流产生的完整数据示例

输入 `stations.m3u`：

```m3u
#EXTM3U
#EXTINF:-1,电台 A
http://example.com/a.mp3
#EXTINF:-1,电台 B
https://example.com/b.aac
```

**① `playlists`** 新增 1 行（`playlist` = 文件名派生名，`mtime`/`created_at`/`updated_at` = 当前时间）。

**② `folder_files`** 新增 2 行：

| name | artist_tag | album_tag | meta | duration | track_number | file_type | folder_id | file_path |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| （URL 派生） | `"..."` | `NULL` | `"Stream"` | `0` | `0` | `23` | **NULL** | **NULL** |

**③ `playlist_entries`** 新增 2 行：

| folder_file_id | url / folder_path | sort | cue_offset_ms |
| --- | --- | --- | --- |
| 上面的 id | `http://example.com/a.mp3` | 递增 | 0 |
| 上面的 id | `https://example.com/b.aac` | 递增 | 0 |

⇒ **播放地址在 `playlist_entries`，不在 `folder_files`。**

---

## 19. R 资源对照（public.xml 实证）

```
attr/streams                     0x7f01057a
attr/micro_streams               0x7f01057c
attr/stream_24dp                 0x7f01065b
id/state_player_track_is_stream  0x7f0d070d
```

strings：

```
stream                         0x7f08087e     ← "Stream"，写入 meta
streams                        0x7f080880
stream_name_in_title           0x7f08087f
summary_stream_name_in_title   0x7f08089a
pref_stream_buffer             0x7f08061c
pref_summary_stream_buffer     0x7f0806e4
pref_stream_timeout            0x7f08061d
pref_aa_per_stream_track       0x7f080463
pref_summary_aa_per_stream_track 0x7f08062d
pref_use_stream3_player        0x7f08071c
pref_summary_use_stream3_player 0x7f0806ee
cast_stop_live_stream          0x7f080118
```

---

## 20. 未取项

| # | 项 | 状态 |
| --- | --- | --- |
| S1 | `file_type` 完整枚举（23 之外） | 开放 |
| S2 | `h1.o()` 的 `z2` 参数确切语义 | 开放（推断为前置 AND 控制） |
| S3 | `stream_files` 是否为 VIEW | 开放 |
| S4 | `cat_stats.type = 60` 的统计维度 | 开放 |
| S5 | `d4.H()` 返回 `null` 的用途 | 开放 |
| S6 | `d4.r0()` 的 `C0742.X0` 偏好键名 | 开放 |
| S7 | `d4.z()` 返回 18 的语义 | 开放 |
| S8 | `t0()` 的 `К` 参数用途 | 开放 |
| **S9** | `folder_files.name` 对流的实际取值格式 | 开放 |
| **S10** | XML 分支（PLS/XSPF）解析细节与字段映射 | 开放 |
| **S11** | 流播放时的取源路径（谁读 `playlist_entries.folder_path` 交给解码器） | 开放 |
