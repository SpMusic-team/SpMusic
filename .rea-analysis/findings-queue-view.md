# Poweramp「队列」—— 方法体实证

**用途**：支撑 `docs/architecture/poweramp-queue-view.md`。
本文只存方法体原文与关键常量，分析见架构文档。

| 项 | 值 |
| --- | --- |
| 目标 | `com.maxmpz.audioplayer` build-1025-uni (1025009) |
| APK SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 引擎 | JADX headless 0.7.1 + apktool（smali 降级） |
| 采集 | 2026-11-03 |

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

### 3.2 `v1()` —— 找第一个待播位置

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
aput v4, p1, v0        # out[0] = 待播数

const-string v0, "SELECT COUNT(*) FROM queue"    # L185
aput v0, p1, v1        # out[1] = 总数
```

**注意**：计数器 SQL **不含** `OR created_at=0`，与 `v1()` 口径不一致。

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

## 10. 未取项

| # | 项 | 状态 |
| --- | --- | --- |
| Q1 | `queue` 表完整 DDL | 开放 |
| Q2 | `V0()` 的实际调用方 | 开放 |
| Q3 | `n3` 与 `m3` 的差异 | 开放 |
| Q4 | `у->p` 与 `у->C` 是否同键别名 | 开放 |
| Q5 | 四个能力开关的接口语义 | 开放 |
| Q6 | `aa_status` 取值枚举（`2` 是什么） | 开放 |
| Q7 | `C()` = 5、`z()` = 10 的语义 | 开放 |
| Q8 | `r()` 返回的实例字段 `H` 何时赋值 | 开放 |
| Q9 | 同曲目多次入队时的状态判定行为 | 开放 |
