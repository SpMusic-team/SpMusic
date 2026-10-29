# Poweramp「最近播放 / 最近添加 / 最多播放」——方法体实证

**用途**：支撑 `docs/architecture/poweramp-recents-views.md`。
本文只存方法体原文与偏好键映射，分析见架构文档。

| 项 | 值 |
| --- | --- |
| 目标 | `com.maxmpz.audioplayer` build-1025-uni (1025009) |
| APK SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 引擎 | JADX headless 0.7.1 via REA |
| 采集 | 2026-10-30 |

---

## 1. 三页实体

| 页面 | 访问器 | 实体 | 方法数 | 字段数 |
| --- | --- | --- | --- | --- |
| Recently Played | `getRecentlyPlayed()` | **`r3`** | 31 | 1 (`f3375: e`) |
| Recently Added | `getRecentlyAdded()` | **`q3`** | 29 | 1 (`f3373: e`) |
| Most Played | `getMostPlayed()` | **`h3`** | 31 | 2 (`H: String`, `f3328: e`) |

来源：`g1` 类摘要 `ev_fefbb506fc94b86da675ec3a73b7d1aa6b3b31598f8615f20e1e2985fd94fc7b`

---

## 2. `r3.X0()` 原文（最近播放）

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    boolean z;
    String[] strArr;
    StringBuilder sb2 = new StringBuilder("(SELECT * FROM folder_files");
    if (C0742.f3414.f3789) {
        z = false;
    } else {
        sb2.append(" WHERE folder_files.cue_folder_id IS NULL");
        z = true;
    }
    long j = C0742.b1.B;
    sb2.append(z ? " AND " : " WHERE ");
    sb2.append("folder_files.played_fully_at>? ORDER BY folder_files.played_fully_at DESC");
    arrayList.add(String.valueOf(j));
    int iMo2437 = mo2437();
    if (iMo2437 != Integer.MAX_VALUE) {
        sb2.append(" LIMIT ");
        sb2.append(iMo2437);
    }
    sb2.append(") AS folder_files LEFT  JOIN folders ON folders._id=folder_id LEFT JOIN artists ON artists._id=folder_files.artist_id LEFT JOIN albums ON albums._id=folder_files.album_id");
    if (C0742.O.f3789) {
        sb2.append(" LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id");
    }
    rVar.A = sb2.toString();
    if (C0742.f1.f3789) {
        strArr = C0742.f3418.f3789 ? p0.y : p0.f3368;
    } else {
        strArr = C0742.f3418.f3789 ? p0.x : p0.X;
    }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(C0742.Y.f3810);
    return p0.f3367;
}
```

`ev_d830abe440a57b8df30d04a50ea7d79f4346af2519c64151d8bf623cfec24d59`
类摘要：`ev_dde1c7c78d006e939cd850031763d9e788e8a8cf54e5244c9f6c08abdc1f7b9e`

### `r3.mo2437()`

```java
@Override // d2
public final int mo2437() {
    return Math.max(2, C0742.j0.f3810);
}
```

`ev_9f96cf80a63bf47977634ea51df1a861b9198dadaae099add0b1ba8161515839`

---

## 3. `q3.X0()` 原文（最近添加）

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    boolean z;
    String[] strArr;
    StringBuilder sb2 = new StringBuilder("(SELECT * FROM folder_files");
    if (C0742.f3414.f3789) {
        z = false;
    } else {
        sb2.append(" WHERE folder_files.cue_folder_id IS NULL");
        z = true;
    }
    com.maxmpz.preference.fastprefs.z zVar = C0742.c1;
    if (zVar.B > 0) {
        sb2.append(z ? " AND " : " WHERE ");
        sb2.append("file_created_at>?");
        arrayList.add(String.valueOf(zVar.B));
    }
    sb2.append(" ORDER BY file_created_at DESC");
    int iMo2437 = mo2437();
    if (iMo2437 != Integer.MAX_VALUE) {
        sb2.append(" LIMIT ");
        sb2.append(iMo2437);
    }
    sb2.append(") AS folder_files LEFT  JOIN folders ON folders._id=folder_id LEFT JOIN artists ON artists._id=folder_files.artist_id LEFT JOIN albums ON albums._id=folder_files.album_id");
    if (C0742.O.f3789) {
        sb2.append(" LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id");
    }
    rVar.A = sb2.toString();
    if (C0742.f1.f3789) {
        strArr = C0742.f3418.f3789 ? p0.y : p0.f3368;
    } else {
        strArr = C0742.f3418.f3789 ? p0.x : p0.X;
    }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(C0742.W.f3810);
    return p0.f3367;
}
```

`ev_f0c45a19a733e79c85ebe21467b2d0b4602c4ab9aa7f288c529612b26477f177`

> `q3.mo2437()` 本轮**未读取**。按同构推断应为 `Math.max(2, C0742.i0.f3810)`（`recently_added_files_limit`），但**未经实证**。

---

## 4. `h3.X0()` 原文（最多播放）

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    String str2 = i1Var.f3334;
    if (str2 != null && str2.length() != 0) {
        throw new AssertionError(i1Var.f3334);
    }
    StringBuilder sb2 = new StringBuilder("(SELECT * FROM folder_files WHERE ");
    if (!C0742.f3414.f3789) {
        sb2.append("folder_files.cue_folder_id IS NULL AND ");
    }
    sb2.append("folder_files.played_times>0 AND folder_files.played_fully_at>");
    sb2.append(C0742.d1.B);
    sb2.append(" ORDER BY folder_files.played_times DESC ");
    int iMo2437 = mo2437();
    if (iMo2437 != Integer.MAX_VALUE) {
        sb2.append(" LIMIT ");
        sb2.append(iMo2437);
    }
    sb2.append(") AS folder_files LEFT  JOIN folders ON folders._id=folder_id LEFT JOIN artists ON artists._id=folder_files.artist_id LEFT JOIN albums ON albums._id=folder_files.album_id");
    if (C0742.O.f3789) {
        sb2.append(" LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id");
    }
    rVar.A = sb2.toString();
    if (C0742.f1.f3789) {
        strArr = C0742.f3418.f3789 ? p0.y : p0.f3368;
    } else {
        strArr = C0742.f3418.f3789 ? p0.x : p0.X;
    }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(d());
    return p0.f3367;
}
```

`ev_52798c423715873f6291f94a8e476c5d3038e997c727f74eef2ba33ced6cd9ed`

### `h3.mo2437()`

```java
@Override // d2
/* JADX INFO: renamed from: с */
public final int mo2437() {
    return Math.max(2, C0742.f0.f3810);
}
```

`ev_85eacab488b395c8dd39cc92c45ef8550236a28d37d60af9fc9d33339f6d9ea4`

---

## 5. 写入路径（`b0`）

`b0` 的 5 个预编译语句字段【实证·产物，`b0` 类摘要】：

```
mUpdatePlayedAtSt                : SQLiteStatement
mUpdateLastPosSt                 : SQLiteStatement
mUpdateLastPosNoPlayedFullyAtSt  : SQLiteStatement
mUpdatePlayedTimesAndLastPosSt   : SQLiteStatement
mUpdateDurationSt                : SQLiteStatement
```

`b0.updateTrackPlayedAtAsNeeded(g0)` 原文：

```java
public void updateTrackPlayedAtAsNeeded(g0 g0Var) {
    if (g0Var.V.s1()) {
        return;
    }
    try {
        SQLiteStatement sQLiteStatement = this.mUpdatePlayedAtSt;
        if (sQLiteStatement != null) {
            sQLiteStatement.bindLong(1, System.currentTimeMillis());
            sQLiteStatement.bindLong(2, g0Var.f2950);
            try {
                sQLiteStatement.execute();
            } catch (SQLiteDiskIOException e) {
                Log.e("RestNowPlaying", "", e);
            }
        }
    } catch (Throwable th) {
        Log.e("RestNowPlaying", "", th);
    }
}
```

`ev_d0b474c2b56135d2569818e53e19cf9d9af14fbabb2a9771c8fca35b2fa1b7c8`

---

## 6. 播放门槛设置

`res/xml/library.xml` L18【实证·原文】：

```xml
<com.maxmpz.audioplayer.preference.SeekbarPreference
    android:title="@string/pref_played_dur" android:key="played_dur"
    android:summary="@string/pref_summary_played_dur"
    android:defaultValue="50" w:max="100" w:min="0" />
```

`pref_summary_played_dur` = `"Count track as played after playing at least: %d%%"`

---

## 7. `C0742` 偏好字段 → 键映射（三页相关）

| 字段 | 偏好键 | 类型 | 值字段 |
| --- | --- | --- | --- |
| `b1` | `recently_played_from` | `fastprefs.z` | `B` (long) |
| `j0` | `recently_played_files_limit` | `fastprefs.w` | `f3810` (int) |
| `Y` | `recently_played_files_sort` | `fastprefs.w` | `f3810` |
| `R0` | `list_zoom_recently_played_files` | `fastprefs.w` | `f3810` |
| `c1` | `recently_added_from` | `fastprefs.z` | `B` |
| `i0` | `recently_added_files_limit` | `fastprefs.w` | `f3810` |
| `W` | `recently_added_files_sort` | `fastprefs.w` | `f3810` |
| `Q0` | `list_zoom_recently_added_files` | `fastprefs.w` | `f3810` |
| `d1` | `most_played_ts_from` | `fastprefs.z` | `B` |
| `f0` | `most_played_files_limit` | `fastprefs.w` | `f3810` |
| `V` | `most_played_files_sort` | `fastprefs.w` | `f3810` |
| `N0` | `list_zoom_most_played_files` | `fastprefs.w` | `f3810` |

`C0742` 类摘要（116 字段）：`ev_90ee531e61575a22aa66995833544192dbe7e62f9e6d758dff9beb7aa1d39fef`
`C0742.<clinit>` 类初始化：`ev_0fe14e74dc505f456d7050484d28ee88d265d30f42a11f25f03d35465f41bb67`

### 7.1 偏好类型 → 值字段（通用规律）

| 偏好类 | 值字段 | 语义 |
| --- | --- | --- |
| `com.maxmpz.preference.fastprefs.w` | `f3810` | int |
| `com.maxmpz.preference.fastprefs.h0` | `f3789` | boolean |
| `com.maxmpz.preference.fastprefs.z` | `B` | long |

### 7.2 交叉验证（4/4 通过）

| 字段 | 用法位置 | 提取到的键 | 是否与用法吻合 |
| --- | --- | --- | --- |
| `l` | `n0.X0`（files 实体排序） | `files_sort` | ✓ |
| `t` | `t.X0`（artists 实体排序） | `artists_sort` | ✓ |
| `Q` | `d0.X0`（composers 实体排序） | `composers_sort` | ✓ |
| `Y` | `r3.X0`（最近播放排序） | `recently_played_files_sort` | ✓ |

并与 `res/xml/library_lists.xml` 的默认值一致：`use_albumartist`=false、`use_albumartist_albumartists`=true、`join_albums`=true、`root_hier_immediate`=false、`show_unsplit_cats`=false。

### 7.3 提取方法学陷阱（记录）

`C0742` 中同时存在仅靠**大小写**或**字符集**区分的字段：

| 字段 | 键 |
| --- | --- |
| `O` | `use_albumartist` |
| `o` | `use_albumartist_albumartists` |
| `о`（西里尔 о, U+043E） | `use_albumartist_albums` |
| `Q` | `composers_sort` |
| `q` | `folders_hier_files_sort` |

用 PowerShell `@{}`（大小写不敏感）提取会把 `Q`/`q` 合并，产生错误映射。
必须使用 `[System.Collections.Generic.Dictionary[string,string]]::new()`。

---

## 8. 证据 ID 索引

| 主题 | Evidence ID |
| --- | --- |
| `g1` 库门面 | `ev_fefbb506fc94b86da675ec3a73b7d1aa6b3b31598f8615f20e1e2985fd94fc7b` |
| `r3` 类摘要 | `ev_dde1c7c78d006e939cd850031763d9e788e8a8cf54e5244c9f6c08abdc1f7b9e` |
| **`r3.X0`** | `ev_d830abe440a57b8df30d04a50ea7d79f4346af2519c64151d8bf623cfec24d59` |
| `r3.mo2437` | `ev_9f96cf80a63bf47977634ea51df1a861b9198dadaae099add0b1ba8161515839` |
| **`q3.X0`** | `ev_f0c45a19a733e79c85ebe21467b2d0b4602c4ab9aa7f288c529612b26477f177` |
| **`h3.X0`** | `ev_52798c423715873f6291f94a8e476c5d3038e997c727f74eef2ba33ced6cd9ed` |
| `h3.mo2437` | `ev_85eacab488b395c8dd39cc92c45ef8550236a28d37d60af9fc9d33339f6d9ea4` |
| `b0.updateTrackPlayedAtAsNeeded` | `ev_d0b474c2b56135d2569818e53e19cf9d9af14fbabb2a9771c8fca35b2fa1b7c8` |
| `C0742` 类摘要 | `ev_90ee531e61575a22aa66995833544192dbe7e62f9e6d758dff9beb7aa1d39fef` |
| `C0742.<clinit>` | `ev_0fe14e74dc505f456d7050484d28ee88d265d30f42a11f25f03d35465f41bb67` |

---

## 9. 未取项

| 项 | 原因 |
| --- | --- |
| `q3.mo2437()` 方法体 | 本轮未读取（推断为 `max(2, i0)`） |
| `h3.d()` 方法体 | `h3.X0` 用 `O(d())` 而非直接读偏好；未确认 `d()` 是否返回 `C0742.V` |
| `r3` / `q3` / `h3` 的 `O(int)` | 三者均未声明，继承自父类 |
| `b0.initSql()` 里各 `mUpdate*St` 的 SQL 文本 | 未读取；`played_fully_at` 的赋值条件据此确定 |
| `C0742.f3413`–`f3418`（7 个 boolean）的键 | 存在于类摘要但不在 `<clinit>` 体内（该方法体被反编译截断） |
| `p0.f3367` / `p0.x` / `p0.y` / `p0.X` / `p0.f3368` 数组内容 | 需读 `p0.<clinit>` |
| `g0Var.V.s1()` 语义 | 推断为「虚拟/CUE 条目」判定 |
