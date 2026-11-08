# Poweramp「队列」—— 方法体实证

**用途**：支撑 `docs/architecture/poweramp-queue-view.md`。
本文只存方法体原文与关键常量，分析见架构文档。

| 项 | 值 |
| --- | --- |
| 目标 | `com.maxmpz.audioplayer` build-1025-uni (1025009) |
| APK SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 引擎 | JADX headless 0.7.1 + apktool（smali 降级） |
| 采集 | 2026-11-03（语义标注复核 2026-11-08） |

---

## 0. 实体

`getQueue()` → **`m3`**
`getQueueFilesForced()` → **`n3`**

| 项 | 值 |
| --- | --- |
| 方法数 | 56 |
| 字段（smali 真名） | `Р: String[]`、`H: String`、`Н: e` |

> JADX 把 `Р` 显示为 `f3357`。Cyrillic `Р`(U+0420) ≠ ASCII `P`。

`m3` 全部方法（smali 定义顺序，56 个）：

```
<clinit> <init> u1* v1* w1* A0 C C0 E F F0 H J M0 N O P Q Q0 R0 S0 T T0 U0 V V0 W X0 Z
c1 d d0 f0 g i k k0 m n n1 p q q0 r r0 r1 s s0 s1 v w0 x z О Х о
```

（`*` = static）

---

## 1. `m3.X0()` —— 列表查询

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "queue INNER JOIN folder_files ON queue.folder_file_id = folder_files._id LEFT JOIN folders ON folders._id=folder_files.folder_id LEFT JOIN albums ON albums._id=folder_files.album_id LEFT JOIN artists ON artists._id=folder_files.artist_id"
        .concat(C0742.O.f3789
            ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
            : "");
    if (C0742.f1.f3789) {
        strArr = C0742.f3418.f3789 ? p0.y : p0.f3368;
    } else {
        strArr = C0742.f3418.f3789 ? p0.x : p0.X;
    }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = "queue.sort";
    return Р;
}
```

`ev_faa508c9b285ee45ef5c9a468449d81fda7042a73fe1834992c0d2185c8bde2a`（含类摘要）

### 1.1 等价 smali（`m3.smali:530-600`）

```smali
.method public final X0(...)Ljava/lang/String;
    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/у;->O:Lcom/maxmpz/preference/fastprefs/h0;
    iget-boolean p1, p1, Lcom/maxmpz/preference/fastprefs/H;->А:Z
    if-eqz p1, :cond_0
    const-string p1, " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
    goto :goto_0
    :cond_0
    const-string p1, ""
    :goto_0
    const-string v0, "queue INNER JOIN folder_files ON queue.folder_file_id = folder_files._id LEFT JOIN folders ON folders._id=folder_files.folder_id LEFT JOIN albums ON albums._id=folder_files.album_id LEFT JOIN artists ON artists._id=folder_files.artist_id"
    invoke-virtual {v0, p1}, Ljava/lang/String;->concat(Ljava/lang/String;)Ljava/lang/String;
    iput-object p1, p2, Lcom/maxmpz/audioplayer/player/r;->A:Ljava/lang/Object;

    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/у;->f1:Lcom/maxmpz/preference/fastprefs/h0;
    iget-boolean p1, p1, Lcom/maxmpz/preference/fastprefs/H;->А:Z
    if-eqz p1, :cond_2
    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/у;->с:Lcom/maxmpz/preference/fastprefs/h0;
    iget-boolean p1, p1, Lcom/maxmpz/preference/fastprefs/H;->А:Z
    if-eqz p1, :cond_1
    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/p0;->y:[Ljava/lang/String;
    goto :goto_1
    :cond_1
    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/p0;->у:[Ljava/lang/String;
    goto :goto_1
    :cond_2
    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/у;->с:Lcom/maxmpz/preference/fastprefs/h0;
    iget-boolean p1, p1, Lcom/maxmpz/preference/fastprefs/H;->А:Z
    if-eqz p1, :cond_3
    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/p0;->x:[Ljava/lang/String;
    goto :goto_1
    :cond_3
    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/p0;->X:[Ljava/lang/String;
    :goto_1
    invoke-static {p3, p1, p4, p5}, Landroidx/appcompat/widget/n;->В(...)V

    const-string p1, "queue.sort"
    iput-object p1, p6, Lcom/maxmpz/audioplayer/rest/library/i1;->B:Ljava/lang/String;

    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/m3;->Р:[Ljava/lang/String;
    return-object p1
.end method
```

### 1.2 `Q0()` 简化包装

```java
@Override // d1
public final String[] Q0(Uri uri, r rVar, ArrayList arrayList, i1 i1Var) {
    X0(uri, rVar, null, null, arrayList, i1Var);
    return Р;
}
```

`m3.smali:368-390`

---

## 2. `m3.<clinit>()` —— 3 表达式投影（smali 原文）

```smali
.method static constructor <clinit>()V
    .registers 3

    const-string v0, "folder_files.played_at >= queue.created_at"

    const-string v1, "queue._id"

    const-string v2, "folder_files._id"

    filled-new-array {v2, v0, v1}, [Ljava/lang/String;

    move-result-object v0

    sput-object v0, Lcom/maxmpz/audioplayer/rest/library/m3;->Р:[Ljava/lang/String;

    return-void
.end method
```

`ev_0827159f78bc24d6a474134cdfb8f69bce95dc71dff6fd4355932348e5d0dbb6`

### 2.1 数组顺序

| 索引 | 表达式 |
| --- | --- |
| 0 | `folder_files._id` |
| **1** | **`folder_files.played_at >= queue.created_at`** |
| 2 | `queue._id` |

**第 1 列是布尔比较式**，用于推导「入队后是否已播放」。

> **语义方向（2026-11-08 复核）**：`>=` = **已播**，`<` = **未播**。决定性证据：`b0.smali:2834` 把 `<` 语句存入字段 `mQueueUnplayedCountSt`（未播计数）；`b0.smali:3897` `moveToFirstNotPlayedQueueEntryOrLast()` 判第 1 列 `== 0` 为 NotPlayed。详见 `docs/architecture/poweramp-queue-view.md` §3.4。

---

## 3. 三个核心静态方法

### 3.1 `u1()` —— 清空保留

`m3.smali:62-114`

```java
public static boolean u1(RestProvider provider, long keepId) {
    SQLiteDatabase db = provider.getWritableDatabase();
    Intrinsics.checkNotNull(db);
    SQLiteStatement st = db.compileStatement("DELETE FROM queue WHERE _id!=?");
    boolean ok;
    try {
        st.bindLong(1, keepId);
        ok = st.executeUpdateDelete() > 0;
    } finally {
        CloseableKt.closeFinally(st, null);
    }
    return ok;
}
```

smali 关键行：

```smali
const-string v0, "DELETE FROM queue WHERE _id!=?"     # L71
invoke-virtual {p0, v0}, Landroid/database/sqlite/SQLiteDatabase;->compileStatement(Ljava/lang/String;)Landroid/database/sqlite/SQLiteStatement;
invoke-virtual {p0, v0, p1, p2}, Landroid/database/sqlite/SQLiteProgram;->bindLong(IJ)V
invoke-virtual {p0}, Landroid/database/sqlite/SQLiteStatement;->executeUpdateDelete()I
if-lez p1, :cond_0                                 # > 0 才 true
```

### 3.2 `v1()` —— 第一个已播条目的 `sort`（入队插入锚点）

> **2026-11-08 修正**：此前本节标题写作「找第一个待播位置」，语义方向错误。`v1()` 返回**第一个已播条目的 `sort`**，唯一用途是给入队 INSERT 当插入锚点；与播放起点/续播无关（续播定位在 `b0.moveToFirstNotPlayedQueueEntryOrLast()`，`b0.smali:3897`）。唯一两个调用点 `data/А.smali:4130`、`:4306` 均只用该值参与 `MAX(sort) − anchor` 的减法算后移行数。

`m3.smali:116-146`

```java
public static long v1(SQLiteDatabase db, boolean useShuffle) {
    String prefix = useShuffle ? "queue.shuffle_order," : "";
    String sql = A.K(
        "SELECT sort FROM queue INNER JOIN folder_files ON folder_files._id=queue.folder_file_id  WHERE folder_files.played_at >= queue.created_at OR queue.created_at=0 ORDER BY ",
        prefix,
        " sort  LIMIT 1");
    return n.x("RestQueue", db, sql, Long.MIN_VALUE);
}
```

smali：

```smali
if-eqz p1, :cond_0
const-string p1, "queue.shuffle_order,"      # L121
goto :goto_0
:cond_0
const-string p1, ""                          # L126
:goto_0
const-string v0, "SELECT sort FROM queue INNER JOIN folder_files ON folder_files._id=queue.folder_file_id  WHERE folder_files.played_at >= queue.created_at OR queue.created_at=0 ORDER BY "   # L129
const-string v1, " sort  LIMIT 1"            # L131
const-wide/high16 v0, -0x8000000000000000L   # L137 = Long.MIN_VALUE
const-string v2, "RestQueue"                 # L139
invoke-static {v2, p0, p1, v0, v1}, Landroidx/appcompat/widget/n;->x(...)J
```

### 3.3 `w1()` —— 双计数器

`m3.smali:148-206`

```java
public static void w1(RestProvider provider, int[] out) {
    SQLiteDatabase db = provider.getWritableDatabase();
    Intrinsics.checkNotNull(db);
    out[0] = 0;
    out[1] = 0;

    SQLiteStatement st = db.compileStatement(
        "SELECT COUNT(*) FROM queue INNER JOIN folder_files ON folder_files._id=queue.folder_file_id WHERE folder_files.played_at >= queue.created_at");
    try { out[0] = (int) st.simpleQueryForLong(); }
    catch (SQLiteDoneException ignored) {}
    finally { st.close(); }

    SQLiteStatement st2 = db.compileStatement("SELECT COUNT(*) FROM queue");
    try { out[1] = (int) st2.simpleQueryForLong(); }
    catch (SQLiteDoneException ignored) {}
    finally { st2.close(); }
}
```

smali：

```smali
const-string v2, "SELECT COUNT(*) FROM queue INNER JOIN folder_files ON folder_files._id=queue.folder_file_id WHERE folder_files.played_at >= queue.created_at"   # L165
aput v4, p1, v0        # out[0] = 已播数

const-string v0, "SELECT COUNT(*) FROM queue"    # L185
aput v0, p1, v1        # out[1] = 总数
```

**`out[0]` 是已播数，不是待播数** —— 由 `b0.smali:7440-7483` `postCreate()` 反证：`v2 = out[0]`、`v0 = out[1]`（`:7446`/`:7450`），随后 `if (v0 > 0 && v2 < v0) mHasPendingQueue = true`（`:7465-7472`）。只有 `out[0]` 为已播数时「已播数 < 总数 ⟺ 仍有待播」才成立。

**注意**：计数器 SQL **不含** `OR created_at=0`。这是与 `v1()` 之间唯一的文本差异；因 `folder_files.played_at` 是 `INTEGER NOT NULL DEFAULT 0`（`data/migrations/B.smali:4456`），`played_at >= 0` 恒真，该兜底分支不可达，故**无可观察行为差异**，不构成「口径不一致」缺陷。此外 `v1()` 取的是锚点 `sort`、`w1()[0]` 数的是行数，两者度量对象不同，不可相互比较。

未播数另有独立实现：`b0.mQueueUnplayedCountSt`（`b0.smali:2834`，`played_at < queue.created_at`），经 `b0.getQueueUnplayedSongs()`（`b0.smali:2607-2627`）取值。两者互补，`已播 + 未播 = 总数`。

---

## 4. 详情查询 `f0()`

`m3.smali:632-690`

```java
public final Cursor f0(SQLiteDatabase db, String[] cols, String[] args, int i) {
    StringBuilder sb = new StringBuilder("SELECT ");
    for (int k = 0; k < cols.length; k++) {
        if (cols[k] != null) {
            if (k > 0) sb.append(", ");
            sb.append(cols[k]);
        }
    }
    sb.append("  FROM queue INNER JOIN folder_files ON queue.folder_file_id = folder_files._id LEFT JOIN folders ON folders._id=folder_files.folder_id LEFT JOIN albums ON albums._id=folder_files.album_id LEFT JOIN artists ON artists._id=folder_files.artist_id WHERE queue._id=? AND (folder_files.aa_status IS NULL OR folder_files.aa_status!=2) ORDER BY folder_files.aa_status DESC LIMIT 1");
    return db.rawQueryWithFactory(null, sb.toString(), args, "", null);
}
```

**队列独有**：`AND (folder_files.aa_status IS NULL OR folder_files.aa_status!=2) ORDER BY folder_files.aa_status DESC`

---

## 5. 插入 / 删除 / 重排

### 5.1 `k()` —— 自动写入 `created_at`

`m3.smali:708-736`

```java
@Override // c2
public final long k(RestProvider provider, SQLiteDatabase db, Uri uri, ContentValues cv) {
    long now = System.currentTimeMillis();
    cv.put(n.o("queue.created_at"), Long.valueOf(now));
    return db.insert("queue", null, cv);
}
```

smali：

```smali
invoke-static {}, Ljava/lang/System;->currentTimeMillis()J    # L711
const-string p1, "queue.created_at"                          # L715
invoke-static {p1}, Landroidx/appcompat/widget/n;->o(Ljava/lang/String;)Ljava/lang/String;
invoke-virtual {p4, p1, p3}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/Long;)V
const-string p1, "queue"                                     # L727
invoke-virtual {p2, p1, p3, p4}, Landroid/database/sqlite/SQLiteDatabase;->insert(...)J
```

### 5.2 `q0()` —— 删除

`m3.smali:874-999`

```java
public final y q0(RestProvider provider, UriAndIds uriAndIds) {
    long[] ids = uriAndIds.A;
    Bundle b = uriAndIds.x;
    if (ids.length == 0) return null;

    boolean force = b.getBoolean("force_files_deletion", false);
    int numCats = b.getInt("num_cats", 0);

    if (force) {
        n3 forced = this.f3404.getQueueFilesForced();
        return p0.Н(provider, forced.B0(), ids, 0, ids.length, numCats,
                    uriAndIds, C0742.p.f3789);
    }

    StringBuilder sb = new StringBuilder(ids.length * 5 + 64);
    StringBuilder sb2 = new StringBuilder();
    if (p0.e0(uriAndIds.B, ids, 0, ids.length, numCats, sb, sb2, false) && numCats == 0) {
        provider.delete(uriAndIds.B, sb.toString(), null);
        return new y(ids);
    }
    return null;
}
```

### 5.3 `T()` —— 重排

`m3.smali:408-468`

```java
@Override // w2
public final boolean T(RestProvider provider, Uri uri, int i) {
    SQLiteDatabase db = provider.getWritableDatabase();
    Intrinsics.checkNotNull(db);
    db.beginTransactionNonExclusive();
    try {
        int n = h1.b(provider, uri, "queue", "queue._id", "queue.sort", "queue.created_at", i);
        if (n > 0) {
            db.setTransactionSuccessful();
            return true;
        }
        return false;
    } finally {
        db.endTransaction();
    }
}
```

smali：

```smali
const-string v4, "queue"            # L420
const-string v5, "queue._id"        # L422
const-string v6, "queue.sort"       # L424
const-string v7, "queue.created_at" # L426
invoke-static/range {v2 .. v8}, Lcom/maxmpz/audioplayer/rest/library/h1;->b(...)I   # L434
```

---

## 6. 元数据方法（smali 全表）

| 方法 | smali 体 | 返回值 |
| --- | --- | --- |
| `i()` | `const-string v0, "queue"` | `"queue"` |
| `n()` | `const-string v0, "queue"` | `"queue"` |
| `H()` | `const-string v0, "queue INNER JOIN folder_files ON folder_files._id=queue.folder_file_id"` | FROM 子句 |
| `A0()` | `const-string v0, "queue.folder_file_id"` | 外键列 |
| `V()` | `const-string v0, "queue._id"` | 主键列 |
| `q()` | `const-string v0, "queue.sort"` | 排序列 |
| `r()` | `iget-object v0, p0, ...->H:Ljava/lang/String;` | 实例字段 |
| `C()` | `const/4 v0, 0x5` | 5 |
| `d()` | `const/4 v0, -0x1` | -1 |
| `m()` | `const v0, 0x10000320` | → `cat_stats.type = 800` |
| `z()` | `const/16 v0, 0xa` | 10 |
| `s()` | `const v0, 0x7f0100d8` | `R.attr.queue` |
| `F0()` | `const v0, 0x7f080757` | `R.string.queue` |
| `r0()` | `sget-object v0, у;->M0` → `list_zoom_queue` | int |
| `n1()` | `const/4 v0, 0x0` | false |
| `r1()` | `const/4 v0, 0x0` | false |
| `s1()` | `const/4 v0, 0x0` | false |
| `v()` | `const/4 v0, 0x0` | false |
| `s0()` | `const/4 p1, 0x0; return-object p1` | null |
| `N()` | `const-wide/16 p1, 0x0` | 0 |
| `O(int)` | `const-string v0, "queue.sort"` | 忽略参数 |

### 6.1 `V0()` —— 条件排序

`m3.smali:494-511`

```java
public final String V0() {
    if (у->C.А) {                          // queue_no_shuffle
        return "queue.sort";
    }
    return "queue.shuffle_order,queue.sort";
}
```

smali：

```smali
sget-object v0, Lcom/maxmpz/audioplayer/rest/library/у;->C:Lcom/maxmpz/preference/fastprefs/h0;
iget-boolean v0, v0, Lcom/maxmpz/preference/fastprefs/H;->А:Z
if-eqz v0, :cond_0
const-string v0, "queue.sort"
return-object v0
:cond_0
const-string v0, "queue.shuffle_order,queue.sort"
return-object v0
```

### 6.2 `W()` —— 条件委托父类

`m3.smali:513-528`

```java
public final void W(SQLiteDatabase db, Uri uri, long id, boolean z) {
    if (!у->C.А && z) {                    // 随机启用且 z
        super.W(db, uri, id, z);
    }
}
```

### 6.3 `m()` 位域

```java
// 父类 b1()
public final int b1() { return m() & 0x0FFFFFFF; }
// 0x10000320 & 0x0FFFFFFF = 0x320 = 800
```

| 实体 | `m()` | `cat_stats.type` |
| --- | --- | --- |
| `i4` | `0x10000154` | 340 |
| `a1` | `0x100000D2` | 210 |
| `d4` | `0x1000003C` | 60 |
| **`m3`** | **`0x10000320`** | **800** |

---

## 7. 双向反查

```java
// m3.smali:299-311 —— 队列 id → 曲目 id
public final long M0(SQLiteDatabase db, long id) {
    return n.y("RestLibraryUtils", db,
        "SELECT queue.folder_file_id FROM queue WHERE _id=?", id);
}

// m3.smali:1069-1081 —— 曲目 id → 队列 id（无 LIMIT）
public final long x(SQLiteDatabase db, long a, long trackId) {
    return n.y("RestQueue", db,
        "SELECT queue._id FROM queue WHERE queue.folder_file_id=?", trackId);
}
```

**日志 tag 不一致**：`RestLibraryUtils` vs `RestQueue`。

---

## 8. 队列偏好键（`у` 类 `<clinit>`）

`rest/library/у.smali`

| 行 | 键名 | 字段 |
| --- | --- | --- |
| 335 | `queue_no_shuffle` | `у->C` |
| 343 | `queue_clear_on_add` | `у->С`（Cyrillic） |
| 351 | `queue_never_clear_on_add` | `у->c` |
| 989 | `list_zoom_queue` | `у->M0`（`fastprefs.w`） |
| 1141 | `search_track_titles_only` | `у->f1` |

smali 片段：

```smali
const-string v1, "queue_no_shuffle"
sput-object v1, Lcom/maxmpz/audioplayer/rest/library/у;->C:Lcom/maxmpz/preference/fastprefs/h0;

const-string v1, "queue_clear_on_add"
sput-object v1, Lcom/maxmpz/audioplayer/rest/library/у;->С:Lcom/maxmpz/preference/fastprefs/h0;

const-string v1, "queue_never_clear_on_add"
sput-object v1, Lcom/maxmpz/audioplayer/rest/library/у;->c:Lcom/maxmpz/preference/fastprefs/h0;
```

**注意三组易混字段**：`C` / `С`(Cyrillic) / `c`。

### 8.1 UI 侧键

```
prefs/В.smali:757    "queue_start"
prefs/В.smali:767    "queue_end"
widget/player/h0.smali:740   "queue_insert_pos"
preference/k0.smali:2803     "queue_no_shuffle"
preference/k0.smali:2815     "queue_clear_on_add"
preference/k0.smali:2837     "queue_never_clear_on_add"
```

---

## 9. R 资源对照（public.xml 实证）

```
attr/queue                       0x7f0100d8
attr/micro_queue                 0x7f0100e8
attr/enqueue                     0x7f01013a
attr/enqueue_shuffled            0x7f01081c
attr/toast_queue                 0x7f010476
attr/queueMinMs                  0x7f0106e8

string/queue                     0x7f080757
string/queue_as_next             0x7f080758
string/queue_as_next_short       0x7f080759
string/open_queue                0x7f0803d5
string/leave_queue               0x7f0802a1
string/exit_queue                0x7f0801c7
string/exited_queue              0x7f0801c8
string/started_queue             0x7f080876
string/enqueue                   0x7f0801b9
string/enqueue_and_stay          0x7f0801ba
string/pref_queue_hint           0x7f0805b9
string/pref_queue_no_shuffle     0x7f0805bc
string/pref_queue_clear_on_add   0x7f0805b5
string/pref_queue_never_clear_on_add 0x7f0805bb
string/pref_queue_insert_pos     0x7f0805ba
string/pref_queue_start          0x7f0805bd
string/pref_queue_end            0x7f0805b6
string/pref_queue_end_exit       0x7f0805b7
string/pref_queue_end_stay       0x7f0805b8
string/pref_summary_queue        0x7f0806b8
string/pref_summary_queue_no_shuffle 0x7f0806bb

id/msg_player_queue_changed      0x7f0d009f
id/state_player_queue_counter    0x7f0d00a6
id/cmd_player_on_queue_updated   0x7f0d00d1
id/behavior_queue_counter        0x7f0d028e
id/queue_counter                 0x7f0d02ce
id/cmd_set_queue_insert_pos      0x7f0d0483
id/state_queue_insert_pos        0x7f0d04f9
id/enqueue                       0x7f0d06a2
id/queue_as_next                 0x7f0d06a3
```

---

## 10. `V0()` 调用方：URI 参数 `shs`（Q2 闭环）

### 10.1 唯一调用点

`smali/com/maxmpz/audioplayer/rest/RestProvider.smali:237-306`

```smali
const-string v4, "lim"                                       # L238
invoke-virtual {v1, v4}, Landroid/net/Uri;->getQueryParameter(Ljava/lang/String;)Ljava/lang/String;

const-string v4, "shs"                                       # L244 ★
invoke-virtual {v1, v4}, Landroid/net/Uri;->getQueryParameter(Ljava/lang/String;)Ljava/lang/String;
move-result-object v4

if-eqz v4, :cond_b                                           # shs != null
invoke-virtual {v4}, Ljava/lang/String;->length()I
move-result v5
if-eqz v5, :cond_b                                           # shs.length() != 0
const-string v5, "0"                                         # L258
invoke-virtual {v4, v5}, Ljava/lang/Object;->equals(Ljava/lang/Object;)Z
move-result v5
if-nez v5, :cond_b                                           # !shs.equals("0")
const-string v5, "false"                                     # L266
invoke-virtual {v4, v5}, Ljava/lang/Object;->equals(Ljava/lang/Object;)Z
move-result v4
if-eqz v4, :cond_9                                           # !shs.equals("false")

:cond_9
instance-of v4, v2, Lcom/maxmpz/audioplayer/rest/library/х;  # L277 ★ 是否为 х 子类
if-eqz v4, :cond_a
check-cast v4, Lcom/maxmpz/audioplayer/rest/library/х;
invoke-virtual {v4}, Lcom/maxmpz/audioplayer/rest/library/х;->V0()Ljava/lang/String;   # L285 ★
move-result-object v4
goto :goto_3
:cond_a
move-object v4, v9                                           # null
:goto_3
move-object v15, v4                                          # 排序覆盖值

:cond_b
move-object/from16 v15, p5                                   # 用默认排序 p5
```

### 10.2 还原

```java
String shs = uri.getQueryParameter("shs");
String sortOverride;
if (shs != null && shs.length() != 0
    && !shs.equals("0") && !shs.equals("false")) {
    if (entity instanceof х) {
        sortOverride = ((х) entity).V0();
    } else {
        sortOverride = null;
    }
} else {
    sortOverride = defaultSort;   // p5，即调用方传入的排序
}
```

| `shs` 取值 | 排序来源 |
| --- | --- |
| 缺省 / `""` / `"0"` / `"false"` | 默认排序（`X0()` 里设的 `queue.sort`） |
| 其它非空值 | `V0()` |

### 10.3 `V0()` 的只有一处 smali 定义在 `х` 基类

```
smali/com/maxmpz/audioplayer/rest/library/х.smali:276   .method public V0()Ljava/lang/String;
```

`m3`、`p3`、`i` 各自覆写。

---

## 11. 入队主逻辑（Q9 闭环）

### 11.1 方法定位

```
smali/com/maxmpz/audioplayer/data/А.smali:3570   .method public final x(ILjava/lang/Object;)V
```

约 500 行消息处理器（`MsgBus` 的 `handleMessage` 风格）。

### 11.2 参数与 Bundle 键

| Bundle 键 | 类型 | 语义 |
| --- | --- | --- |
| `clean_and_play` | boolean | L3622 | 清空并播放 |
| `as_next` | boolean | L3662 | 插入到下一首位置 |
| `playing_entry_id` | long | L3638（写入） | 当前播放条目 id |
| `keep_id` | long | L3803（读取） | 要保留的条目 id |

### 11.3 步骤一：`keepId` 判定

```smali
const-string v8, "clean_and_play"                             # L3622
invoke-virtual {v3, v8, v9}, Landroid/os/Bundle;->getBoolean(Ljava/lang/String;Z)Z
move-result v8

const v10, 0x7f0d00a2                                         # L3630 state_player_track
invoke-interface {v6, v10}, Lcom/maxmpz/widget/StateBus;->getObjectState(I)Ljava/lang/Object;
move-result-object v10
check-cast v10, Lcom/maxmpz/audioplayer/player/g0;

const-string v11, "playing_entry_id"                          # L3638
if-eqz v10, :cond_3                                           # player != null
iget-object v14, v10, Lcom/maxmpz/audioplayer/player/g0;->V:Lcom/maxmpz/audioplayer/rest/library/o0;
instance-of v14, v14, Lcom/maxmpz/audioplayer/rest/library/m3; # L3644 ★ 当前实体是队列
if-eqz v14, :cond_3
if-nez v8, :cond_3                                            # !clean_and_play
invoke-virtual {v10}, Lcom/maxmpz/audioplayer/player/g0;->Х()J
move-result-wide v14
invoke-virtual {v3, v11, v14, v15}, Landroid/os/BaseBundle;->putLong(Ljava/lang/String;J)V   # L3654
goto :goto_0
:cond_3
const-wide/16 v14, 0x0                                        # keepId = 0
:goto_0
```

### 11.4 步骤二：清空决策

```smali
:cond_4
iget-object v13, v1, Lcom/maxmpz/audioplayer/data/А;->X:Lcom/maxmpz/audioplayer/rest/RestProvider;   # L3683
const/4 v12, 0x1

if-nez v8, :cond_5                                            # !clean_and_play
sget-object v9, Lcom/maxmpz/audioplayer/rest/library/у;->С:Lcom/maxmpz/preference/fastprefs/h0;   # L3689 queue_clear_on_add
iget-boolean v9, v9, Lcom/maxmpz/preference/fastprefs/H;->А:Z
if-eqz v9, :cond_8                                            # clear_on_add → 跳到清空路径

:cond_5
sget-object v9, Lcom/maxmpz/audioplayer/rest/library/у;->С:...  # L3696 再读一次
iget-boolean v9, ...
if-eqz v9, :cond_6
# ... 判 never_clear
:cond_6
const/4 v9, 0x0

# L3720
if-eqz v9, :cond_7
const-wide/16 v14, 0x0
:cond_7
invoke-static {v13, v14, v15}, Lcom/maxmpz/audioplayer/rest/library/m3;->u1(...)Z   # L3727 ★ 清空

:cond_8                                                        # L3729
```

后续 `L3827-3909` 是第二次（事务内）清空判定：

```smali
:cond_c
const/4 v14, 0x1                                              # L3816 canClear = true

invoke-virtual {v15}, Landroid/database/sqlite/SQLiteDatabase;->beginTransactionNonExclusive()V   # L3825

if-eqz v14, :cond_10                                          # L3827
invoke-virtual {v9}, Lcom/maxmpz/audioplayer/rest/library/А;->B0()Landroid/net/Uri;
const-string v9, "COUNT(*)"                                   # L3833
filled-new-array {v9}, [Ljava/lang/String;
const-string v22, "folder_files.played_at < queue.created_at" # L3843 ★ 未播条件
invoke-... provider.A(uri, ["COUNT(*)"], "folder_files.played_at < queue.created_at", ...)

if-eqz v9, :cond_e
invoke-interface {v9}, Landroid/database/Cursor;->moveToNext()Z
move-result v14
if-eqz v14, :cond_d
const/4 v14, 0x0
invoke-interface {v9, v14}, Landroid/database/Cursor;->getInt(I)I   # notPlayed
move-result v19
goto :goto_5
:cond_d
const/16 v19, 0x0
:goto_5
invoke-interface {v9}, Landroid/database/Cursor;->close()V

if-nez v19, :cond_10                                          # L3881 ★ notPlayed == 0
sget-object v9, .../у;->С:...                                 # L3883 queue_clear_on_add
iget-boolean v9, ...
if-nez v9, :cond_f                                            # clear_on_add → 清空
sget-object v9, .../у;->c:...                                 # L3889 queue_never_clear_on_add
iget-boolean v9, ...
if-nez v9, :cond_10                                           # never_clear=true → 不清空
:cond_f
const-wide/16 v8, 0x0
invoke-static {v13, v8, v9}, Lcom/maxmpz/audioplayer/rest/library/m3;->u1(...)Z   # L3900 ★ 清空

:cond_10
const-string v12, "SELECT COUNT(*) FROM queue"                # L3910
```

⇒ 清空条件 = `keepId == 0` **&&** `notPlayed == 0` **&&** (`clear_on_add || !never_clear_on_add`)

---

## 12. 洗牌预处理

### 12.1 触发条件

```smali
if-eqz v6, :cond_11        # L3926 useShuffle
if-lez v8, :cond_11        # L3928 queueCount > 0
```

### 12.2 三条 SQL

```smali
const-string v8, "DROP TABLE IF EXISTS temp_queue_shuffle_order"                  # L3930

const-string v11, "CREATE TEMP TABLE temp_queue_shuffle_order AS SELECT queue._id FROM queue INNER JOIN folder_files ON folder_files._id=queue.folder_file_id  WHERE queue._id=? OR folder_files.played_at >= queue.created_at OR queue.created_at=0 ORDER BY queue.shuffle_order, queue.sort"   # L3942

const-string v8, "SELECT COUNT(*) FROM temp_queue_shuffle_order"                  # L3946
const-wide/16 v9, 0x1
# N = count + 1

const-string v8, "UPDATE queue SET shuffle_order=ABS(MAX(shuffle_order, -9223372036854775807))"   # L3956

const-string v9, "UPDATE queue SET shuffle_order=(SELECT rowid-"                  # L3964
# + N
const-string v9, " FROM temp_queue_shuffle_order WHERE temp_queue_shuffle_order._id=queue._id) WHERE _id IN (SELECT _id FROM temp_queue_shuffle_order)"   # L3970
```

---

## 13. INSERT 语句

### 13.1 列与占位符

```smali
const-string v8,  "queue.folder_file_id"     # L3986
const-string v9,  "queue.sort"               # L3992
const-string v10, "queue.created_at"         # L3998
const-string v11, "queue.shuffle_order"      # L4004

if-eqz v27, :cond_12
const-string v12, "?"                        # L4012（as_next 外部给）
goto :goto_9
:cond_12
const-string v12, "ABS(MAX(-9223372036854775807, RANDOM()))"   # L4020（随机）

const-string v13, "\n            INSERT INTO queue ("         # L4025
```

拼接结果：

```sql
INSERT INTO queue (folder_file_id, sort, created_at, shuffle_order) VALUES (?, ?, ?, ?)
```

### 13.2 `sort` 计算

```smali
invoke-static {}, Ljava/lang/System;->currentTimeMillis()J    # L4053
const-string v11, "SELECT IFNULL(MAX(sort), -1) FROM queue"   # L4057
invoke-virtual {v11}, Landroid/database/sqlite/SQLiteStatement;->simpleQueryForLong()J
move-result-wide v12                                          # maxSort

const-wide/16 v33, -0x1                                       # L4076
if-eqz v27, :cond_15                                          # as_next
cmp-long v14, v12, v33
if-lez v14, :cond_15                                          # maxSort > -1

const-string v14, "UPDATE queue SET sort=sort+? WHERE sort > ?"   # L4086 ★ 插队腾位
const-string v21, "SELECT sort FROM queue WHERE _id=?"            # L4097 ★ 取当前项位置
```

---

## 14. Q9：入队不做查重

### 14.1 全路径无查重

| 环节 | smali 位置 | 是否查重 |
| --- | --- | --- |
| `keepId` 判定 | L3614-3661 | 否 |
| 清空决策 | L3683-3909 | 否（只 `COUNT(*)` 未播数） |
| 洗牌预处理 | L3926-3980 | 否（只按 `_id` 重排） |
| INSERT | L4025-4120 | **否，直接追加** |

### 14.2 结论

**同一曲目可多次入队，产生多条 `queue` 行，各自有独立 `created_at` 与 `sort`。**

配合 §2 的状态推导（`folder_files.played_at >= queue.created_at`）：

| 场景 | 结果 |
| --- | --- |
| 单次入队 | 正确 |
| 先后入队（不同 `created_at`） | 正确（时间戳单调） |
| **同批入队（相同 `created_at`）** | **一次播放让多条同时变已播** |

---

## 15. 未取项

| # | 项 | 状态 |
| --- | --- | --- |
| Q1 | `queue` 表完整 DDL | 开放 |
| ~~Q2~~ | ✅ `V0()` 的实际调用方 | **已闭环，§10** |
| Q3 | `n3` 与 `m3` 的差异 | 开放 |
| Q4 | `у->p` 与 `у->C` 是否同键别名 | 开放 |
| Q5 | 四个能力开关的接口语义 | 开放 |
| Q6 | `aa_status` 取值枚举（`2` 是什么） | 开放 |
| Q7 | `C()` = 5、`z()` = 10 的语义 | 开放 |
| Q8 | `r()` 返回的实例字段 `H` 何时赋值 | 开放 |
| ~~Q9~~ | ✅ 同曲目多次入队时的状态判定行为 | **已闭环，§14** |
| Q10 | `clear_on_add` 与 `never_clear_on_add` 同时为 true 时前者优先是否有意 | 开放 |

---

## 16. 附录：语义方向复核补取（2026-11-08）

本节记录为确定 `played_at >= queue.created_at` 语义方向而**新取**的 smali 位置，均为 `build-1025-uni`（SHA-256 见文首）。原有各节方法体原文未改动。

| 位置 | 内容 | 作用 |
| --- | --- | --- |
| `player/b0.smali:2834` | `const-string v1, "SELECT COUNT(*) FROM queue INNER JOIN folder_files ON folder_files._id=queue.folder_file_id WHERE folder_files.played_at < queue.created_at"`，随后 `:2840` `iput-object v0, p0, ...->mQueueUnplayedCountSt:Landroid/database/sqlite/SQLiteStatement;` | **E1**：字段名 `mQueueUnplayedCountSt`（未播计数语句）直接绑定 `<` ⇒ `<` = 未播 |
| `player/b0.smali:2585-2605` | `getQueueStats()[I` → `m3.w1(mContentProvider, out)` | 确认 `w1()` 即 `postCreate()` 的 `out` 来源 |
| `player/b0.smali:2607-2627` | `getQueueUnplayedSongs()I` → 执行 `mQueueUnplayedCountSt.simpleQueryForLong()` | 未播数的独立取值路径 |
| `player/b0.smali:3897-3960` | `moveToFirstNotPlayedQueueEntryOrLast()I`：`:3900` 取 `mFilesCursor`，`:3904` 存原 position，`:3910` `moveToPosition(-1)`，`:3913` `moveToNext()`，`:3924` **`getLong(1)`（第 1 列）**，`:3930-3936` `cmp-long` + `if-nez` 命中返回 `1`，`:3950` 无果时 `moveToLast()` | **E2**：第 1 列值 `== 0` 被当作 **NotPlayed** ⇒ 第 1 列真值 = 已播 |
| `player/b0.smali:4712`、`:6088` | `invoke-direct {p0}, ...->moveToFirstNotPlayedQueueEntryOrLast()I` | 续播定位仅在 `startQueueImpl` 与另一处被调用 |
| `player/b0.smali:7440-7483` | `postCreate()`：`:7446` `aget v2, v0, 0`（out[0]）、`:7450` `aget v0, v0, 1`（out[1]）、`:7465-7472` `if-lez v0` / `if-ge v2, v0` → `iput-boolean ... mHasPendingQueue`、`:7483` `post(0x7f0d009f, v2, v0, null)` | **E3**：`out[0] < out[1]` 才置 `mHasPendingQueue` ⇒ `out[0]` = 已播数 |
| `data/А.smali:4130`、`:4306` | `invoke-static {v15, v6}, .../m3;->v1(...)J` | `v1()` 仅此两个调用点，均在入队消息处理器 |
| `data/А.smali:4137`、`:4318` | `sub-long v6, v37, v12` / `sub-long v12, v37, v3`（`v37` = `MAX(sort)`，见 `:4066`/`:4118`） | 锚点用途：算需后移的行数，非播放位置 |
| `data/А.smali:4086`、`:4186` | `"UPDATE queue SET sort=sort+? WHERE sort > ?"` | 锚点最终用途为腾位 UPDATE |
| `data/migrations/B.smali:4456` | `"played_at INTEGER NOT NULL DEFAULT 0,"` | **S2 依据**：`played_at >= 0` 恒真 ⇒ `created_at=0` 行本就在已播侧，`OR created_at=0` 冗余 |
| `data/migrations/B.smali:5470-5482` | `ALTER TABLE` + `ADD COLUMN` 补列路径（同带默认值） | 旧库升级后同样 NOT NULL |
| `list/q0.smali:449` | `const-string v2, "folder_files.played_at < queue.created_at"`（过滤列数组第 5 项） | 一致性普查：`<` = 未播 |
| `data/А.smali:3843` | 清空判定的 `"folder_files.played_at < queue.created_at"` | 一致性普查：`<` = 未播（原 §11.4 已收） |
| `data/А.smali:3942` | 洗牌临时表的 `>= ... OR created_at=0` | 一致性普查：`>=` = 已播 |

跨版本一致（`build-1035`，`.rea-analysis/v1035/decoded/smali/ׅ/`）：

| 位置 | 内容 |
| --- | --- |
| `p01.smali:31` | `<clinit>` 投射谓词 `played_at >= queue.created_at` |
| `p01.smali:202` | `v1()` 的 `>= ... OR created_at=0` |
| `p01.smali:268` | `w1()[0]` 的 `>=` |
| `p01.smali:727`、`:749` | `shuffle_order` 双 UPDATE（`played_at<=?` / `played_at>?`） |
| `dj.smali:7032` | 清空判定 `<` |
| `dj.smali:7219` | 洗牌临时表 `>= ... OR created_at=0` |
| `k01.smali:3879` | `mQueueUnplayedCountSt` 的 `<`（字段名与 v1025 一致） |
| `mt0.smali:804` | 过滤列数组的 `<` |

⇒ 谓词文本与全部消费点逐字节一致，语义方向不随版本变化。
