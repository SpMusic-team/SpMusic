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

## 9. 未取项

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
