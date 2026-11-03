# Poweramp 年份 / 流派 —— 方法体实证

**用途**：支撑 `docs/architecture/poweramp-category-views.md`。
本文只存方法体原文与偏好键，分析见架构文档。

| 项 | 值 |
| --- | --- |
| 目标 | `com.maxmpz.audioplayer` build-1025-uni (1025009) |
| APK SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 引擎 | JADX headless 0.7.1 via REA |
| 采集 | 2026-11-03 |

---

## 0. 实体树

```
h4 (getYears, 48 方法, 6 字段)
 ├─ X      (Lazy) ──→ l4   All Year Songs      (14 方法)
 └─ f3330  (Lazy) ──→ i4   Year Albums         (21 方法)
                       └─ f3336 (Lazy) ──→ j4  Year Album Songs (13 方法)

z0 (getGenres, 56 方法, 6 字段)
 ├─ X      (Lazy) ──→ c1   All Genre Songs     (16 方法)
 └─ f3402  (Lazy) ──→ a1   Genre Albums        (21 方法)
                       └─ f3282 (Lazy) ──→ b1  Genre Album Songs (13 方法)
```

字段清单：

| 类 | 字段 |
| --- | --- |
| `h4` | `X: Lazy`, `f3329: String[]`, `f3330: Lazy`, `f3331: P`, `x: String`, `y: String[]` |
| `i4` | `K: String[]`, `f3336: Lazy`, `f3337: C`, `x: h4`, `y: P` |
| `j4` | `H: i4`, `P: d`, `f3345: e` |
| `l4` | `H: k4`, `f3354: h4`, `f3355: d` |
| `z0` | `X: Lazy`, `f3401: String[]`, `f3402: Lazy`, `f3403: P`, `x: String`, `y: String[]` |
| `a1` | `K: String[]`, `f3282: Lazy`, `f3283: C`, `x: z0`, `y: P` |
| `b1` | `H: a1`, `P: d`, `f3286: e` |
| `c1` | `H: e`, `P: String[]`, `f3288: z0`, `f3289: d` |

---

## 1. `h4.X0()` —— 年份列表

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

`ev_445ab65a10ede03f8c2ace43c42bdbbcdf657e62417c2f0a11f6d8b9ac37d4e8`（含类摘要）

导航：

```java
// h4.A()
@Override // v1
public final q1 A() { return (i4) this.f3330.getValue(); }
// ev_6aaf56d0c45ccd7cff1c974f0572b285208389f556159708d96d30867ed88f40

// h4.mo2427()
@Override // w1 — JADX renamed from: О
public final x2 mo2427() { return (l4) this.X.getValue(); }
// ev_8e6236f09041080842e49ea1910103afb84ce5eca2602a8c78c8176b81c6b57c
```

---

## 2. `l4.X0()` —— All Year Songs

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    rVar.A = "years INNER JOIN folder_files ON folder_files.year=years.year INNER JOIN folders ON folders._id=folder_files.folder_id  LEFT JOIN albums ON albums._id=folder_files.album_id LEFT JOIN artists ON artists._id=folder_files.artist_id"
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

`ev_05d8574ad6420a8028f919ea95b6330624df96b199fa2a5b4254e413417aebd7`

**关键**：`folder_files.year=years.year` 是**值匹配**，非 ID 匹配。

---

## 3. `i4.X0()` —— Year Albums

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "albums INNER JOIN years ON years.year=album_year INNER JOIN folder_files ON folder_files.album_id=albums._id INNER JOIN artists ON artists._id =folder_files.artist_id LEFT JOIN cat_stats ON cat_stats.type="
        + b1() + " AND cat_stats.ref_id=? AND cat_stats.ref_id2=albums._id"
        + (C0742.f3416.f3789
            ? " LEFT JOIN album_artists ON album_artists._id =albums.album_artist_id AND albums.album_artist_id!=1000"
            : "");
    String strD = androidx.appcompat.widget.f.d(uri);
    Intrinsics.checkNotNull(strD);
    arrayList.add(strD);
    rVar.B("years._id");
    rVar.B("=?");
    if (!C0742.f3414.f3789) {
        rVar.B(" AND ");
        rVar.B("folder_files.cue_folder_id IS NULL");
    }
    arrayList.add(strD);
    Z0(str, sb, arrayList, i1Var, l.f3351);
    return l.X;
}
```

`ev_27aa73fc2518010972d36ffcc2053b68e35df51d5b7104df630b1af1848ba9ec`

```java
// i4.U()
@Override // q1
public final int U() { return R.string.all_year_songs; }
// ev_9fae1051e01f4846dea9094e5c1c88858eff1b69db12a7f23fc0065b6cd3f3f2

// i4.a1()
@Override // i
public final String a1() {
    return "SELECT albums._id FROM albums INNER JOIN years ON years.year=albums.album_year  WHERE years._id=? GROUP BY albums._id";
}
// ev_81ea41b16d91d5b6089d641953b8b8519f171ca579a22c87732b12ee7e4ec2e7

// i4.d()
@Override // m2
public final int d() { return C0742.c0.f3810; }
// ev_aaefcb9b1df92f4d91f6265d05d505a4af55bdce5d15424e972bfe4d9fe980f3

// i4.mo2427()
@Override // w1 — JADX renamed from: О
public final x2 mo2427() { return (j4) this.f3336.getValue(); }
// ev_668b0694e5fff072fd5a8f3cdaa997b8567441f33defef4b967997cb3c926162
```

**注意**：`Z0(str, sb, arrayList, i1Var, l.f3351)` 复用专辑元数据类 `l` 的 `Z0`，其中含 `i1Var.f3335 = "albums._id"`（GROUP BY）。

---

## 4. `j4.X0()` —— Year Album Songs

```java
@Override // com.maxmpz.audioplayer.rest.library.r0, com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    rVar.A = "folder_files INNER JOIN years ON years.year=album_year INNER JOIN albums ON albums._id=folder_files.album_id INNER JOIN artists ON artists._id=folder_files.artist_id INNER JOIN folders ON folders._id=folder_id "
        .concat(C0742.O.f3789
            ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
            : "");
    rVar.B("years._id");
    rVar.B("=? AND ");
    rVar.B("albums._id");
    rVar.B("=?");
    if (!C0742.f3414.f3789) {
        rVar.B(" AND ");
        rVar.B("folder_files.cue_folder_id IS NULL");
    }
    String encodedPath = uri.getEncodedPath();
    String strB = androidx.appcompat.widget.f.b(1, encodedPath);
    Intrinsics.checkNotNull(strB);
    arrayList.add(strB);
    String strB2 = androidx.appcompat.widget.f.b(3, encodedPath);
    Intrinsics.checkNotNull(strB2);
    arrayList.add(strB2);
    if (C0742.f1.f3789) { strArr = C0742.f3418.f3789 ? p0.y : p0.f3368; }
    else { strArr = C0742.f3418.f3789 ? p0.x : p0.X; }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(C0742.d0.f3810);
    return p0.f3367;
}
```

`ev_841d6806392e0e1617c689585f6e617b48e8721fe75b2d4e4e67888b589653ae`

```java
// j4.Z()
@Override // r0, x2
public final int Z() { return R.attr.micro_years; }
// ev_307e6385fbc1d2bc54c7bc0a41ff6593b73d33a8b765e46a889fa4635b72843c

// j4.k0()
@Override // h0
public final x2 k0() { return this.H; }   // → i4（父级导航）
// ev_9a04cf59119bcca0b88e08c74dc5d884521a9e396c4b4c369207339005ba8b36
```

---

## 5. `z0.X0()` —— 流派列表

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "genres INNER JOIN genre_entries ON genre_entries.genre_id=genres._id INNER JOIN folder_files ON folder_files._id=genre_entries.folder_file_id";
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

`ev_d2cc951bb732f9f75fde8297daf9e91254ee25721a6b4e3adfa1434d1dd5f303`（含类摘要）

导航与委托：

```java
// z0.Z0()
public final a1 Z0() { return (a1) this.f3402.getValue(); }
// ev_a930f72524ea247c78e3a3e27bcb8fd1231fc4d97e17c147ff6aa39019d1b158

// z0.mo2427()
@Override // w1 — JADX renamed from: О
public final x2 mo2427() { return (c1) this.X.getValue(); }
// ev_67d44ff12be352eea2c254763df0f744557958a25fbc81c33ba525592e77cbd4

// z0.O(int)
@Override // m2
public final String O(int i) { return com.pixplicity.htmlcompat.y.m3143(i); }
// ev_723539273809e33e0c83a35c2d59d4aed5476d2bdb4431fb835bc9dd9ed5dc59
```

---

## 6. `c1.X0()` —— All Genre Songs

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    rVar.A = "genre_entries INNER JOIN folder_files ON folder_files._id=folder_file_id INNER JOIN folders ON folders._id=folder_files.folder_id  LEFT JOIN albums ON albums._id=folder_files.album_id LEFT JOIN artists ON artists._id=folder_files.artist_id"
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

`ev_d5aea3c66653eabcfd15ab24061335a3730100a008121b2757ac101db89b0224`

**主表是 `genre_entries`**，单条件 `genre_id=?`。

---

## 7. `a1.X0()` —— Genre Albums

```java
@Override
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "albums INNER JOIN folder_files ON folder_files.album_id=albums._id INNER JOIN genre_entries ON folder_file_id=folder_files._id INNER JOIN artists ON artists._id =folder_files.artist_id LEFT JOIN cat_stats ON cat_stats.type="
        + b1() + " AND cat_stats.ref_id=? AND cat_stats.ref_id2=albums._id"
        + (C0742.f3416.f3789
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
```

`ev_28d36789a306af64708c49f6de98ea2c973c0dccf06dec3e13dfb8a773ea3559`

```java
// a1.U()
@Override // q1
public final int U() { return R.string.all_genre_songs; }
// ev_a973141986be0eb4c5d02013fd450c9a0d5b8147f8671734270dd832fadc3149

// a1.mo2427()
@Override // w1 — JADX renamed from: О
public final x2 mo2427() { return (b1) this.f3282.getValue(); }
// ev_c64274d32cf88ad196f65268f6b1336c42c0b7e665ce3c725f84550362f2013b
```

---

## 8. `b1.X0()` —— Genre Album Songs

```java
@Override // com.maxmpz.audioplayer.rest.library.r0, com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    rVar.A = "folder_files INNER JOIN genre_entries ON folder_file_id=folder_files._id INNER JOIN genres ON genres._id=genre_id INNER JOIN albums ON albums._id=folder_files.album_id INNER JOIN artists ON artists._id=folder_files.artist_id INNER JOIN folders ON folders._id=folder_id "
        .concat(C0742.O.f3789
            ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
            : "");
    rVar.B("genre_id");
    rVar.B("=? AND ");
    rVar.B("albums._id");
    rVar.B("=?");
    if (!C0742.f3414.f3789) {
        rVar.B(" AND ");
        rVar.B("folder_files.cue_folder_id IS NULL");
    }
    String encodedPath = uri.getEncodedPath();
    String strB = androidx.appcompat.widget.f.b(1, encodedPath);
    Intrinsics.checkNotNull(strB);
    arrayList.add(strB);
    String strB2 = androidx.appcompat.widget.f.b(3, encodedPath);
    Intrinsics.checkNotNull(strB2);
    arrayList.add(strB2);
    if (C0742.f1.f3789) { strArr = C0742.f3418.f3789 ? p0.y : p0.f3368; }
    else { strArr = C0742.f3418.f3789 ? p0.x : p0.X; }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(C0742.N.f3810);
    return p0.f3367;
}
```

`ev_2a24511028b323ce5c201763903193aaf474c71e4a0e070f734ca3fbb25c1eab`

```java
// b1.Z()
@Override // r0, x2
public final int Z() { return R.attr.micro_albums; }
// ev_0768301db709760164172ada66aa03ec5fbaf9e783a0eea0ca14b0231fb601c1
```

---

## 9. 偏好键（smali 实证）

本期 JADX 对 `C0742.<clinit>` 转为 **smali 模式**（`fell_back: true`），原文比 JVM 反编译更可靠。

```smali
const-string v1, "years_sort"
invoke-virtual {v0, v3, v1}, Lcom/maxmpz/preference/fastprefs/m;->р(ILjava/lang/String;)Lcom/maxmpz/preference/fastprefs/w;
sput-object v1, Lcom/maxmpz/audioplayer/rest/library/у;->a0:Lcom/maxmpz/preference/fastprefs/w;

const-string v1, "years_files_sort"          → у;->b0
const-string v1, "years_albums_sort"         → у;->c0
const-string v1, "years_albums_files_sort"   → у;->d0

const-string v1, "genres_sort"               → у;->J
const-string v1, "genres_files_sort"         → у;->L
const-string v1, "genres_albums_sort"        → у;->M
const-string v1, "genres_albums_files_sort"  → у;->N
```

`ev_e4e5a4b1ea51d48548ba91d2a9a9b20034c02e5ce69d58e20dd4bd5c0542b6e1`

同批确认（部分）：

```smali
"artists_sort"                → у;->t
"artists_files_sort"          → у;->u
"artists_albums_sort"         → у;->v
"artists_albums_files_sort"   → у;->w
"album_artists_sort"          → у;->z
"album_artists_files_sort"    → у;->D
"album_artists_albums_sort"   → у;->E
"album_artists_albums_files_sort" → у;->F
"composers_sort"              → у;->Q
"composers_files_sort"        → у;->R
"composers_albums_sort"       → у;->S
"composers_albums_files_sort" → у;->T
"albums_sort"                 → у;->r
"album_files_sort"            → у;->s
"folders_sort"                → у;->m
"folders_files_sort"          → у;->n
"folders_hier_files_sort"     → у;->q
"files_sort"                  → у;->l
"streams_sort"                → у;->e0
"playlists_sort"              → у;->U
```

**`v3 = const/4 v3, 0x0`** ⇒ 所有 int 偏好默认值 0。

---

## 10. R 资源 ID（public.xml 实证）

```
attr/micro_all_songs            0x7f0100de
attr/micro_folders              0x7f0100df
attr/micro_folders_hier         0x7f0100e0
attr/micro_albums               0x7f0100e1
attr/micro_artists              0x7f0100e2
attr/micro_album_artists        0x7f0100e3
attr/micro_albums_by_artist     0x7f0100e4
attr/micro_composers            0x7f0100e5
attr/micro_playlists            0x7f0100e6
attr/micro_genres               0x7f0100e7
attr/micro_queue                0x7f0100e8
attr/micro_most_played          0x7f0100e9
attr/micro_top_rated            0x7f0100ea
attr/micro_low_rated            0x7f0100eb
attr/micro_recently_played      0x7f0100ec
attr/micro_recently_added       0x7f0100ed
attr/micro_raw_file             0x7f0100ee
attr/micro_long_files           0x7f0104ed
attr/years                      0x7f010579
attr/micro_years                0x7f01057b

string/all_year_songs    0x7f080058
string/year_album        0x7f0808fc
string/year_album_songs  0x7f0808fd
string/year_albums       0x7f0808fe
string/years             0x7f0808ff
```

`micro_*` 系列共 **20 个 attr**，即媒体库各分类页的图标属性。

---

## 11. 未取项

| # | 项 | 原因 |
| --- | --- | --- |
| C1 | `com.pixplicity.htmlcompat.y.m3143(int)` | 未读取；流派四层排序全部经过它 |
| C2 | `h1.m2447(int)` | 未读取；年份首页排序 |
| C4 | `genre_entries` / `genres` / `years` 表 DDL | `findings-db.md` 未覆盖 |
| C5 | `unknown_genre_name` 的哨兵 id | 未定位 |
| C6 | `b1()` 返回的 `cat_stats.type` 取值 | 未读取 |
| — | `z0.h()` / `z0.x0()` / `z0.mo2435()` | 与本文主题无直接关系 |
| — | `j4`/`b1` 的 `P: d` 字段用途 | 未读取 |
