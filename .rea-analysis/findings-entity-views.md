# Poweramp 实体视图 —— 方法体实证证据

**用途**：支撑 `docs/architecture/poweramp-entity-views.md` 的原始反编译证据。
本文只存**方法体原文与证据 ID**，分析见架构文档。

| 项 | 值 |
| --- | --- |
| 目标 | `com.maxmpz.audioplayer` build-1025-uni (1025009) |
| APK SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 引擎 | JADX headless 0.7.1 via REA |
| 采集 | 2026-10-28 |

---

## 0. 实体映射（`g1` 类摘要，79 方法 / 38 字段）

```
getAlbums()           : com.maxmpz.audioplayer.rest.library.j
getArtists()          : com.maxmpz.audioplayer.rest.library.t
getAlbumArtists()     : com.maxmpz.audioplayer.rest.library.О     ← 西里尔 О
getComposers()        : com.maxmpz.audioplayer.rest.library.d0
getAlbumsByArtist()   : com.maxmpz.audioplayer.rest.library.m
getGenres()           : com.maxmpz.audioplayer.rest.library.z0
getYears()            : com.maxmpz.audioplayer.rest.library.h4
getFiles()            : com.maxmpz.audioplayer.rest.library.n0
getFolders()          : com.maxmpz.audioplayer.rest.library.t0
getFoldersHier()      : com.maxmpz.audioplayer.rest.library.x0
getSearch()           : com.maxmpz.audioplayer.rest.library.v3
getAllTracks()        : com.maxmpz.audioplayer.rest.library.r
```

证据：`ev_fefbb506fc94b86da675ec3a73b7d1aa6b3b31598f8615f20e1e2985fd94fc7b`

> **`О` 不可寻址**：REA 的精确类名查找以 `Exact class not found` 拒绝该西里尔类名。
> 拉丁 `com.maxmpz.audioplayer.rest.library.O` 存在但是无关 lambda 类：
> `{ A: Object, B: int, X: Object }`，方法仅 `<init>(Object,int,Object)` 与 `invoke(): Object`。

---

## 1. 艺术家 `t.X0()` 原文

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

证据：`ev_db43a88d3caff6b99d54d5611183e205d840fd275f13f5b39e1f026327737ece`
类摘要（30 方法 / 4 字段：`X: P`, `f3377: String`, `x: Lazy`, `y: Lazy`）：
`ev_8e23f672aecd9a32e4f7d373932ce8f541a22e06bc934cc672013698f6474ab8`

### `t.a1()`

```java
public final u a1() {
    return (u) this.y.getValue();
}
```

证据：`ev_34d6b36b6ec45d742e25059a87f4e8125c931d37d87c093a42d8b7c1a1e5e29e`

---

## 2. 作曲家 `d0.X0()` 原文

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

证据：`ev_0d0b2d107ebe09714f52e5e9513c2a3ab8914408fe12c032c55493ded22f1711`
类摘要（52 方法 / 6 字段：`X: Lazy`, `f3293: String[]`, `f3294: Lazy`, `f3295: P`, `x: String`, `y: String[]`）

---

## 3. 专辑 `j.X0()` 原文

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "albums INNER JOIN folder_files ON folder_files.album_id=albums._id INNER JOIN artists ON artists._id =folder_files.artist_id".concat(
        C0742.f3416.f3789
            ? " LEFT JOIN album_artists ON album_artists._id =albums.album_artist_id AND albums.album_artist_id!=1000"
            : "");
    if (!C0742.f3414.f3789) {
        rVar.B("albums.num_files");
        rVar.B("!=0 ");
    }
    Z0(str, sb, arrayList, i1Var, l.f3351);
    return l.X;
}
```

证据：`ev_6b7f78561a0f5048e5ce3758e1a835a408936fa94b2593786a66f86ffce7caf6`
类摘要（25 方法 / 2 字段）：`ev_e3cb27bc09f7b82ececa5b3fb34b661964fd54c0ffc692f2874b03c6afb23535`

### `l.Z0()`

```java
public final void Z0(String str, StringBuilder sb, ArrayList arrayList, i1 i1Var, String[] strArr) {
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(d());
    i1Var.f3335 = "albums._id";
}
```

证据：`ev_6798376df591d554cc5e6e11a86609abb42e039b33a24c21f217892e7990a00b`
`l` 类摘要（31 方法 / 3 数组：`X`, `f3350`, `f3351`）：`ev_c8c2b89cedb8bef0e5bc5797d5e234414a96ea0a2b1a703b6fd9ec5daa6960e0`

### `l.O(int)` 专辑排序

```java
@Override // com.maxmpz.audioplayer.rest.library.m2
public String O(int i) {
    if (i == 0) {
        return h1.m2450().concat(" COLLATE NOCASE");
    }
    if (i == 1) {
        return android.support.v4.media.A.K("album_year, ", h1.m2450(), " COLLATE NOCASE");
    }
    if (i == 2) {
        return "albums.created_at";
    }
    String strX = "IFNULL(album_artist, artist)";
    if (i == 3) {
        if (!C0742.f3416.f3789) {
            strX = h1.X();
        } else if (!C0742.f3413.f3789) {
            strX = "IFNULL(album_artist_sort, artist)";
        }
        return android.support.v4.media.A.m10(strX, " COLLATE NOCASE, ", h1.m2450(), " COLLATE NOCASE");
    }
    if (i == 4) {
        return android.support.v4.media.A.K("albums.num_files, ", h1.m2450(), " COLLATE NOCASE ");
    }
    switch (i) {
        case 1073741824:
            return h1.m2450().concat(" COLLATE NOCASE DESC");
        case 1073741825:
            return android.support.v4.media.A.K("album_year DESC, ", h1.m2450(), " COLLATE NOCASE DESC");
        case 1073741826:
            return "albums.created_at DESC";
        case 1073741827:
            if (!C0742.f3416.f3789) {
                strX = h1.X();
            } else if (!C0742.f3413.f3789) {
                strX = "IFNULL(album_artist_sort, artist)";
            }
            return android.support.v4.media.A.m10(strX, " COLLATE NOCASE DESC, ", h1.m2450(), " COLLATE NOCASE DESC");
        case 1073741828:
            return android.support.v4.media.A.K("albums.num_files DESC, ", h1.m2450(), " COLLATE NOCASE DESC");
        default:
            return h1.m2450().concat(" COLLATE NOCASE");
    }
}
```

证据：`ev_aa50e032e84559bd20c3e65d16cb29a7e34ee31a1bfc0414dd9c7a06978a259c`

### `h1.m2450()` 排序标签开关

```java
public static String m2450() {
    return !C0742.f3413.f3789 ? "album_sort" : "album";
}
```

证据：`ev_740e537e1bc1da3a493a598182bf9fec90e65166bee9c0f2b7199f195264269a`

---

## 4. `h1.H(int)` 艺术家排序

```java
public static String H(int i) {
    String str = (1073741824 & i) != 0 ? " DESC" : "";
    int i2 = i & (-1073741825);
    if (i2 == 0) {
        return android.support.v4.media.A.c(X(), " COLLATE NOCASE ", str);
    }
    if (i2 == 1) {
        StringBuilder sbM4 = android.support.v4.media.A.m4("artists.created_at", str, ", ", X(), " COLLATE NOCASE ");
        sbM4.append(str);
        return sbM4.toString();
    }
    if (i2 != 2) {
        return android.support.v4.media.A.c(X(), " COLLATE NOCASE ", str);
    }
    StringBuilder sbM5 = android.support.v4.media.A.m4("artists.num_files", str, ", ", X(), " COLLATE NOCASE ");
    sbM5.append(str);
    return sbM5.toString();
}
```

证据：`ev_abce0b9bcce13f8e8b43471c9ad10522a28461e0b2302c2fa1009f71af1724ac`

## 5. `h1.K(int)` 作曲家排序

```java
public static String K(int i) {
    String str = (1073741824 & i) != 0 ? " DESC" : "";
    int i2 = i & (-1073741825);
    if (i2 == 0) {
        return android.support.v4.media.A.c(x(), " COLLATE NOCASE ", str);
    }
    if (i2 == 1) {
        StringBuilder sbM4 = android.support.v4.media.A.m4("composers.created_at", str, ", ", x(), " COLLATE NOCASE ");
        sbM4.append(str);
        return sbM4.toString();
    }
    if (i2 != 2) {
        return android.support.v4.media.A.c(x(), " COLLATE NOCASE ", str);
    }
    StringBuilder sbM5 = android.support.v4.media.A.m4("composers.num_files", str, ", ", x(), " COLLATE NOCASE ");
    sbM5.append(str);
    return sbM5.toString();
}
```

证据：`ev_baa2c972d4ade52b5957dd75055d24774c5e1f707063219cfa21433b6dd03d25`

---

## 6. `u.X0()` —— multi_artists + cat_stats

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "albums INNER JOIN folder_files ON folder_files.album_id=albums._id INNER JOIN multi_artists ON multi_artists.file_id=folder_files._id INNER JOIN artists ON artists._id=folder_files.artist_id LEFT JOIN cat_stats ON cat_stats.type="
        + b1() + " AND cat_stats.ref_id=? AND cat_stats.ref_id2=albums._id"
        + (C0742.f3416.f3789
            ? " LEFT JOIN album_artists ON album_artists._id =albums.album_artist_id AND albums.album_artist_id!=1000"
            : "");
    String strD = androidx.appcompat.widget.f.d(uri);
    Intrinsics.checkNotNull(strD);
    arrayList.add(strD);
    rVar.B("multi_artists.artist_id");
    rVar.B("=?");
    arrayList.add(strD);
    if (!C0742.f3414.f3789) {
        rVar.B(" AND ");
        rVar.B("folder_files.cue_folder_id IS NULL");
    }
    Z0(str, sb, arrayList, i1Var, l.f3350);
    return l.X;
}
```

证据：`ev_0e30b53b1130420a6e9f4b80d20851642b4bc93dfeb80b650773ada6ccc62874`
`u` 类摘要（21 方法 / 5 字段：`K: String[]`, `f3378: Lazy`, `f3379: C`, `x: t`, `y: P`）

---

## 7. Flag 交叉引用

| Flag | 出现位置 |
| --- | --- |
| `C0742.f3414.f3789` | `t.X0`, `d0.X0`, `j.X0`, `u.X0`, `x0.a1`, `h1.o` |
| `C0742.k.f3789` | `t.X0`, `d0.X0` |
| `C0742.f3416.f3789` | `j.X0`, `u.X0`, `l.O` |
| `C0742.O.f3789` | `h1.o` |
| `C0742.f3413.f3789` | `h1.m2450`, `l.O` |
| `C0742.t.f3810` | `t.X0` |
| `C0742.Q.f3810` | `d0.X0` |
| `C0742.l.f3810` | `n0.X0` |

> ⚠️ `C0742.Q.f3810`（作曲家排序）与 `C0732.Q.f3810`（队列延迟时机，见 `findings-queue.md`）**不是同一成员**。

---

## 8. 未取项

| 项 | 原因 |
| --- | --- |
| `О`（专辑艺术家）全部方法体 | 西里尔类名不可寻址 |
| `m`（getAlbumsByArtist）方法体 | 本轮未采集 |
| `w.f3387` / `w.f3388` / `l.X` / `l.f3350` / `l.f3351` 静态数组内容 | 需读 `<clinit>` |
| `h1.X()` / `h1.x()` 表达式 | 本轮未采集 |
| `b1()` 返回值 | 本轮未采集 |
| `albums` / `artists` / `composers` / `album_artists` 表 DDL | `findings-db.md` 未覆盖 |
