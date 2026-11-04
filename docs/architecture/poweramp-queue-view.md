---
doc_id: "ARCH-POWERAMP-QUEUE-VIEW"
title: "Poweramp 队列参考（独立表 + 入队时间戳驱动）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-03"
updated: "2026-11-03"
source_documents:
  - "user request: 逆向 Poweramp 媒体库下「队列」页的实现与组织"
  - "shared task: task-19"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009) :: SHA-256 4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0"
  - ".rea-analysis/findings-queue-view.md（本轮方法体原文）"
  - ".rea-analysis/decoded/res/values/strings.xml（UI 文案）"
  - ".rea-analysis/decoded/res/values/public.xml（R.attr / R.string ID）"
  - "docs/architecture/poweramp-queue-runtime-reference.md（运行时状态机，本文边界见 §15）"
  - "docs/architecture/poweramp-streams-view.md（同为独立表的 song 视图）"
  - "docs/architecture/poweramp-bookmarks-view.md（同为独立表的 song 视图）"
  - "docs/architecture/media-library-page-relationships.md（SpMusic 侧对照）"
---

# Poweramp 队列参考（独立表 + 入队时间戳驱动）

## 0. 定位与证据分级

**本文记录外部实现 Poweramp 的「队列」页面组织与其数据模型，不是 SpMusic 现状。**

| 标记 | 含义 | 可信度 |
| --- | --- | --- |
| **【实证·产物】** | JADX 反编译方法体原文 | 最高 |
| **【实证·smali】** | 反汇编 smali 原文（`<clinit>` 等降级情形） | 最高 |
| **【实证·原文】** | APK 资源字符串 / public.xml 原文 | 高 |
| **【推断】** | 本文作者推理 | 低 |

### 0.1 一句话结论

**队列是独立表 `queue`，用 `queue.created_at`（入队时间戳）与 `folder_files.played_at`（播放时间戳）的比较来判定「该条目入队后是否已播放」。**

这个比较式贯穿三处：列表投影、当前项查询、计数器统计。

### 0.2 三条链路

```
【入队侧】 见 §14
            Bundle(clean_and_play / as_next / ids)
            → 判定 keepId（正在播队列时才保留当前条目）
            → 清空决策（无未播项 且 偏好允许 → u1() 全清）
            → 洗牌预处理（temp_queue_shuffle_order 固化已播顺序）
            → INSERT（sort=MAX+1 或 as_next 插队，created_at=now）
            → 不做查重（同曲目可多条）

【状态侧】 见 §3
            folder_files.played_at >= queue.created_at  → 已播/待播
            无常驻布尔列，状态随播放自动重算

【消费侧】 见 §2 §4
            d4→m3.X0()：列表（投影 3 表达式）
            v1()：找第一个待播位置（含 created_at=0 兜底）
            w1()：待播数 + 总数
            shs 参数 → V0() 覆写为含 shuffle_order 的顺序
```

### 0.3 与既有队列文档的分工

| 文档 | 覆盖 |
| --- | --- |
| **本文** | **页面组织 + 数据模型 + 入队运行机制**：表结构、SQL、投影、计数器、偏好键、入队/清空/洗牌 |
| `poweramp-queue-runtime-reference.md` | **播放运行时状态机**：next/prev 不对称、随机语义、延迟队列、错误码 |

**两者互补，无覆盖重叠。** 本文 §18 给出明确边界。

### 0.4 核心特征

| 特征 | 队列 | 书签 | 流 |
| --- | --- | --- | --- |
| 主表 | **`queue`** | `bookmarks` | `folder_files` |
| 与曲目的 JOIN | **`INNER JOIN`** | `INNER JOIN` | `LEFT JOIN` |
| 排序 | **硬编码 `queue.sort`**（`shs` 参数可覆写为含 shuffle_order） | 硬编码 | 6 模式偏好 |
| 投影 | **3 个表达式**（非普通列） | 2 个 id | `p0.f3367` |
| 入队查重 | **无** | — | — |
| 特有概念 | **入队时间戳驱动的「未播放」判定** | 播放位置快照 | `__dynamic_url` |

---

## 1. 实体映射

| UI 文案【实证·原文】 | 访问器 | 实体 | 方法数 |
| --- | --- | --- | --- |
| `queue` = "Queue" | `getQueue()` | **`m3`** | 56 |
| — | `getQueueFilesForced()` | **`n3`** | — |

`m3` 字段（smali 实证，只有 3 个）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `H` | `String` | 见 §9 |
| `Н` | `e` | 分类元数据 |
| **`Р`** | **`String[]`** | **列表投影（3 个表达式）** |

> JADX 把 `Р` 显示为 `f3357`，smali 才是真名。Cyrillic `Р`(U+0420) 与 ASCII `P` 不同。

### 1.1 相关 UI 文案全量

```
queue                    = "Queue"
open_queue               = "Open the Queue"
leave_queue              = "Leave Queue"
exit_queue               = "Leave queue"
exited_queue             = "Left queue"
started_queue            = "Started queue"
enqueue                  = "Enqueue"
enqueue_and_stay         = "Enqueue and stay in the list"
queue_as_next            = "Play Next"
queue_as_next_short      = "Play Next"
pref_queue_hint          = "Poweramp Queue is a separate dynamic playlist"
pref_summary_queue       = "Queue options"
pref_queue_no_shuffle    = "Ignore Shuffle"
pref_summary_queue_no_shuffle = "Queue is always played in-order.
                                 Also affects Search results Shuffle"
pref_queue_clear_on_add  = "Always Clear On Add"
pref_queue_never_clear_on_add = "Never Clear On Add"
pref_queue_insert_pos    = "Queue Insert Position"
pref_queue_start         = "Start Playing Queue"
pref_queue_end           = "On Queue End"
pref_queue_end_exit      = "Return to previous category"
pref_queue_end_stay      = "Stay in Queue / repeat Queue"
```

**`pref_queue_hint` 是理解队列的定义句**：*"Poweramp Queue is a separate dynamic playlist"*。

### 1.2 相关 R 资源

```
attr/queue                       0x7f0100d8   ← m3.s()
attr/micro_queue                 0x7f0100e8
attr/enqueue                     0x7f01013a
attr/enqueue_shuffled            0x7f01081c
attr/toast_queue                 0x7f010476
attr/queueMinMs                  0x7f0106e8

string/queue                     0x7f080757   ← m3.F0()
```

状态与命令 id：

```
id/msg_player_queue_changed        0x7f0d009f
id/state_player_queue_counter      0x7f0d00a6
id/cmd_player_on_queue_updated     0x7f0d00d1
id/behavior_queue_counter          0x7f0d028e
id/queue_counter                   0x7f0d02ce
id/cmd_set_queue_insert_pos        0x7f0d0483
id/state_queue_insert_pos          0x7f0d04f9
id/enqueue                         0x7f0d06a2
id/queue_as_next                   0x7f0d06a3
```

`state_player_queue_counter` + `behavior_queue_counter` + `queue_counter` 三者说明：**队列计数器是一个实时状态**，会主动推送给 UI 徽标。

---

## 2. 列表查询（`m3.X0()`）

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "queue INNER JOIN folder_files ON queue.folder_file_id = folder_files._id "
           + "LEFT JOIN folders ON folders._id=folder_files.folder_id "
           + "LEFT JOIN albums ON albums._id=folder_files.album_id "
           + "LEFT JOIN artists ON artists._id=folder_files.artist_id"
           .concat(C0742.O.f3789
               ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
               : "");
    if (C0742.f1.f3789) { strArr = C0742.f3418.f3789 ? p0.y : p0.f3368; }
    else { strArr = C0742.f3418.f3789 ? p0.x : p0.X; }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = "queue.sort";
    return Р;
}
```

### 2.1 还原

```sql
SELECT folder_files._id,
       folder_files.played_at >= queue.created_at,    -- ★ 布尔表达式
       queue._id
FROM queue
  INNER JOIN folder_files    ON folder_files._id      = queue.folder_file_id
  LEFT  JOIN folders         ON folders._id           = folder_files.folder_id
  LEFT  JOIN albums          ON albums._id            = folder_files.album_id
  LEFT  JOIN artists         ON artists._id           = folder_files.artist_id
  [LEFT JOIN album_artists   ON album_artists._id     = folder_files.album_artist_id]
WHERE [<用户过滤，过滤列见 §7>]
ORDER BY queue.sort
```

### 2.2 四个要点

**① `INNER JOIN folder_files`（与流页相反）**

队列条目**必然**指向已入库曲目（你只能把库里有的东西加进队列），所以用 `INNER`。
对比流页 `d4` 用 `LEFT`（流可能无 `folder_id`）。

**② 排序硬编码 `queue.sort`**

```java
i1Var.B = "queue.sort";
```

与书签 `a0` 同型——**不接受 DESC 位、不读排序偏好**。
但注意 `V0()` 另有一个含 `shuffle_order` 的变体（§9），二者分工不同。

**③ 投影是 3 个表达式，不是普通列**

见 §3。

**④ 过滤列走 `p0` 四选一**

```java
strArr = C0742.f1.f3789
       ? (C0742.f3418.f3789 ? p0.y : p0.f3368)
       : (C0742.f3418.f3789 ? p0.x : p0.X);
```

⇒ 队列**复用** `p0` 的四选一过滤列机制（与所有歌曲/派生列表相同），不像流页有自有过滤列。

---

## 3. 投影 `m3.Р`：三个表达式（队列最独特的设计）

`<clinit>` smali 实证（JADX 降级为 smali）：

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

### 3.1 数组顺序（压栈倒置）

| 索引 | 表达式 | 类型 |
| --- | --- | --- |
| 0 | `folder_files._id` | 整数 id |
| **1** | **`folder_files.played_at >= queue.created_at`** | **布尔（0/1）** |
| 2 | `queue._id` | 整数 id |

### 3.2 第 1 列的含义

**`folder_files.played_at >= queue.created_at` = 「这条队列项入队之后被播放过」**

| 状态 | `played_at` vs `created_at` | 表达式 |
| --- | --- | --- |
| 入队后未播放 | `played_at` < `created_at`（或 NULL） | `0` |
| 入队后已播放 | `played_at` >= `created_at` | `1` |

⇒ **这一列就是「已播放 / 未播放」标志**，用于 UI 区分（灰显已播、高亮待播）。

**没有额外的 `played` 布尔列** —— 状态由两个时间戳的比较动态推导。这是队列数据模型的核心设计。

### 3.3 与其他页面投影对比

| 页面 | 投影形态 |
| --- | --- |
| 所有歌曲 / 派生列表 | `p0.f3367`（28 个普通列） |
| **队列** | **3 个表达式（含 1 个布尔比较）** |
| 书签 | 2 个 id |
| 流 | `p0.f3367` |
| 年份/流派 | `y` / `l.X` |

⇒ **队列是唯一投影里含计算表达式的页面。**

---

## 4. 三个核心静态方法

### 4.1 `u1(provider, keepId)` —— 清空队列保留一条

```java
public static boolean u1(RestProvider provider, long keepId) {
    SQLiteStatement st = provider.getWritableDatabase()
        .compileStatement("DELETE FROM queue WHERE _id!=?");
    st.bindLong(1, keepId);
    int n = st.executeUpdateDelete();
    return n > 0;
}
```

**用途**【推断】：开新队列时只留指定条目，等价于「清空但保留当前」。

注意：`executeUpdateDelete()` 返回受影响行数，`> 0` 才算成功。**若队列原本只有这一条，返回 `false`**（没有删除任何行），这是返回值语义的一个陷阱。

### 4.2 `v1(db, useShuffle)` —— 找第一个待播位置

```java
public static long v1(SQLiteDatabase db, boolean useShuffle) {
    String prefix = useShuffle ? "queue.shuffle_order," : "";
    String sql = "SELECT sort FROM queue "
               + "INNER JOIN folder_files ON folder_files._id=queue.folder_file_id  "
               + "WHERE folder_files.played_at >= queue.created_at OR queue.created_at=0 "
               + "ORDER BY " + prefix + " sort  LIMIT 1";
    return n.x("RestQueue", db, sql, Long.MIN_VALUE);
}
```

还原：

```sql
SELECT sort
FROM queue
  INNER JOIN folder_files ON folder_files._id = queue.folder_file_id
WHERE folder_files.played_at >= queue.created_at
   OR queue.created_at = 0
ORDER BY [queue.shuffle_order,] sort
LIMIT 1
```

**这是投影里的布尔表达式第一次被用于 WHERE**。

#### 关键细节：`OR queue.created_at = 0`

`created_at = 0` 的条目**无条件视为待播**。

含义【推断】：`created_at = 0` 是「没有入队时间戳」的条目（可能来自旧版本数据或特殊路径插入），无法用时间比较判定，因此显式纳入待播集合。

这是一个**兜底条款**，避免这些条目永远不被播放。

#### 返回 `Long.MIN_VALUE`

`n.x(tag, db, sql, Long.MIN_VALUE)` 的最后一个参数是默认值——查询无结果（`LIMIT 1` 空）时返回 `Long.MIN_VALUE`，即「没有待播项」。

### 4.3 `w1(provider, int[] out)` —— 队列计数器

```java
public static void w1(RestProvider provider, int[] out) {
    SQLiteDatabase db = provider.getWritableDatabase();
    out[0] = 0;
    out[1] = 0;

    // 计数器 0：待播数量
    SQLiteStatement st = db.compileStatement(
        "SELECT COUNT(*) FROM queue INNER JOIN folder_files "
      + "ON folder_files._id=queue.folder_file_id "
      + "WHERE folder_files.played_at >= queue.created_at");
    try { out[0] = (int) st.simpleQueryForLong(); }
    catch (SQLiteDoneException ignored) {}
    finally { st.close(); }

    // 计数器 1：队列总长度
    SQLiteStatement st2 = db.compileStatement("SELECT COUNT(*) FROM queue");
    try { out[1] = (int) st2.simpleQueryForLong(); }
    catch (SQLiteDoneException ignored) {}
    finally { st2.close(); }
}
```

| 索引 | 查询 | 含义 |
| --- | --- | --- |
| `out[0]` | `COUNT(*) ... WHERE played_at >= created_at` | **待播数量** |
| `out[1]` | `COUNT(*) FROM queue` | **队列总长度** |

#### 与 `v1()` 的语义差异（重要）

| 方法 | WHERE | 是否含 `created_at=0` 兜底 |
| --- | --- | --- |
| `w1()` 计数器 | 仅 `played_at >= created_at` | **否** |
| `v1()` 找待播 | `played_at >= created_at` **OR `created_at=0`** | **是** |

⇒ **计数器可能比实际待播项少**（漏掉 `created_at = 0` 的条目）。
这是一个**潜在不一致**：UI 徽标显示的数字与真实待播数可能不符。

> 【推断】影响有限：`created_at=0` 应属罕见数据，但它确实构成两处实现的口径差异。

---

## 5. 单曲目详情查询（`m3.f0()`）

```java
public final Cursor f0(SQLiteDatabase db, String[] cols, String[] args, int i) {
    StringBuilder sb = new StringBuilder("SELECT ");
    for (int k = 0; k < cols.length; k++) {
        if (cols[k] != null) {
            if (k > 0) sb.append(", ");
            sb.append(cols[k]);
        }
    }
    sb.append("  FROM queue INNER JOIN folder_files ON queue.folder_file_id = folder_files._id "
            + "LEFT JOIN folders ON folders._id=folder_files.folder_id "
            + "LEFT JOIN albums ON albums._id=folder_files.album_id "
            + "LEFT JOIN artists ON artists._id=folder_files.artist_id "
            + "WHERE queue._id=? "
            + "AND (folder_files.aa_status IS NULL OR folder_files.aa_status!=2) "
            + "ORDER BY folder_files.aa_status DESC LIMIT 1");
    return db.rawQueryWithFactory(null, sb.toString(), args, "", null);
}
```

### 5.1 两个特殊之处

**① 动态列拼接**

列清单由调用方传入并逐项拼接（跳过 `null`）。这是提取媒体库基类 `p0.e0()` 的标准做法。

**② `aa_status` 过滤**

```sql
AND (folder_files.aa_status IS NULL OR folder_files.aa_status!=2)
ORDER BY folder_files.aa_status DESC
```

`aa_status` = album art status。`!= 2` 排除某个特定状态。

【推断】`aa_status = 2` 可能是「封面已确认为无」或「正在下载」的中间态；
`ORDER BY aa_status DESC` 优先取状态值大的（即更完整/更可用封面）。

**这是队列独有的过滤条件** —— 其他页面的 `d1()` 没有这段（对比书签 `a0.d1()`、`p0.d1()`）。

---

## 6. 插入与删除

### 6.1 插入 `m3.k()` —— 自动写入入队时间戳

```java
@Override // c2
public final long k(RestProvider provider, SQLiteDatabase db, Uri uri, ContentValues cv) {
    long now = System.currentTimeMillis();
    cv.put(n.o("queue.created_at"), Long.valueOf(now));    // ★ 自动填时间戳
    return db.insert("queue", null, cv);
}
```

**这是队列数据模型的关键**：`created_at` 不是由调用方提供，而是**插入时自动生成**。

⇒ 保证每条队列项都有准确的「入队时刻」，使 §3 的布尔比较有意义。

对比：书签 `a0.k()` 是裸 `insert("bookmarks", null, cv)`，`created_at` 由 `u1()` 显式绑定；流的 `created_at` 在 `X.y()` 里绑定。**只有队列在一个统一的 insert 入口自动填。**

### 6.2 删除 `m3.q0()`

标准删除模板（与其他实体同型）：

```java
public final y q0(RestProvider provider, UriAndIds uriAndIds) {
    long[] ids = uriAndIds.A;
    Bundle b = uriAndIds.x;
    if (ids.length == 0) return null;

    boolean force = b.getBoolean("force_files_deletion", false);
    int numCats = b.getInt("num_cats", 0);

    if (force) {
        // 走 p0.Н() —— 强制删除文件本身
        return g1.getQueueFilesForced().p0.Н(provider, uri, ids, 0, ids.length, numCats, uriAndIds, C0742.p.f3789);
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

**语义**：`force_files_deletion=true` 时删除物理文件，否则只删队列条目（不动库里曲目）。

### 6.3 重排 `m3.T()`

```java
@Override // w2
public final boolean T(RestProvider provider, Uri uri, int i) {
    SQLiteDatabase db = provider.getWritableDatabase();
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

**四参数复用通用重排工具**：`table=queue`、`idCol=queue._id`、`sortCol=queue.sort`、`createdAtCol=queue.created_at`。
与书签 `a0.T()`、播放列表 `j3.T()` 同型。

---

## 7. 过滤列：走 `p0` 四选一

```java
if (C0742.f1.f3789) { strArr = C0742.f3418.f3789 ? p0.y : p0.f3368; }
else                { strArr = C0742.f3418.f3789 ? p0.x : p0.X; }
```

| 偏好 | 值 | 语义 |
| --- | --- | --- |
| `C0742.f1` | `search_track_titles_only` | 只搜标题 |
| `C0742.f3418` | （艺术家相关开关） | — |

⇒ **队列没有自有过滤列**，完全复用 `p0` 的四选一。

对比：
| 页面 | 过滤列 |
| --- | --- |
| 所有歌曲 / 派生列表 / **队列** | `p0` 四选一 |
| 流 | 自有 `d4.H`（3 列） |
| 书签 | 自有 `a0.H`（2 个 id） |

---

## 8. 元数据方法全表（smali 实证）

| 方法 | 返回值 | 含义 |
| --- | --- | --- |
| `i()` | `"queue"` | 表名 |
| `n()` | `"queue"` | 表名（重复定义） |
| `H()` | `"queue INNER JOIN folder_files ON folder_files._id=queue.folder_file_id"` | FROM 子句 |
| `A0()` | `"queue.folder_file_id"` | 外键列 |
| `V()` | `"queue._id"` | 主键列 |
| `q()` | `"queue.sort"` | 排序列 |
| `r()` | `this.H` | 实例字段（未在 `<clinit>` 初始化） |
| `C()` | `5` | 分类类型码（推断） |
| `d()` | `-1` | 无排序偏好（推断） |
| **`m()`** | **`0x10000320`** | **`cat_stats.type = 800`**（§8.1） |
| `z()` | `0xa` = 10 | 分类序号（推断） |
| `s()` | `0x7f0100d8` = `R.attr.queue` | 列表图标 |
| `F0()` | `0x7f080757` = `R.string.queue` | 标题文案 |
| `r0()` | `у->M0` = `list_zoom_queue` | 列表缩放 |
| `n1()` / `r1()` / `s1()` / `v()` | `false` | 四个能力开关全为 false |
| `s0()` | `null` | 不支持该操作 |
| `N()` | `0` | 不支持 |
| `O(int)` | `"queue.sort"` | 排序表达式（忽略参数） |

### 8.1 `m()` = `0x10000320` → `cat_stats.type = 800`

```java
// 父类 b1()
public final int b1() { return m() & 0x0FFFFFFF; }
// 0x10000320 & 0x0FFFFFFF = 0x320 = 800
```

| 实体 | `m()` | `cat_stats.type` |
| --- | --- | --- |
| `i4`（Year Albums） | `0x10000154` | 340 |
| `a1`（Genre Albums） | `0x100000D2` | 210 |
| `d4`（Streams） | `0x1000003C` | 60 |
| **`m3`（Queue）** | **`0x10000320`** | **800** |

⇒ 队列的统计类型号明显大于其它分类（800 vs 60/210/340），【推断】属于不同的编号区段。

### 8.2 四个能力开关全 `false`

```java
n1() / r1() / s1() / v() → const/4 v0, 0x0
```

【推断】这四个是「支持某操作」的开关（如是否支持分组、是否支持搜索、是否支持多选等）。
队列全部返回 `false`，说明**队列不支持这些批量/分类操作**——它是一个扁平线性列表，没有分类维度。

### 8.3 `V0()` —— 条件排序表达式

```java
public final String V0() {
    if (у->C.А) {                      // queue_no_shuffle = true
        return "queue.sort";
    }
    return "queue.shuffle_order,queue.sort";
}
```

| `queue_no_shuffle` | `V0()` 返回 |
| --- | --- |
| **true** | `queue.sort` |
| false | `queue.shuffle_order,queue.sort` |

⇒ **队列的显示顺序是否受随机影响，由 `queue_no_shuffle` 决定。**

注意 `O(int)` 恒返回 `queue.sort`，而 `V0()` 会带上 `shuffle_order`。**两个方法分工不同**：
- `O(int)` 用于通用列表排序（`X0()` 的 `i1Var.B`）
- `V0()` 用于需要反映随机顺序的场景（推断为播放顺序计算或洗牌视图）

---

## 9. 队列专用偏好键（`у` 类 `<clinit>` 实证）

| 字段 | 键名 | 类型 | 作用 |
| --- | --- | --- | --- |
| `у->C` | **`queue_no_shuffle`** | `h0`(bool) | **忽略随机，队列始终按序播放** |
| `у->С` (Cyrillic) | `queue_clear_on_add` | `h0` | 添加时始终清空 |
| `у->c` | `queue_never_clear_on_add` | `h0` | 添加时永不清空 |
| `у->M0` | **`list_zoom_queue`** | `w`(int) | 队列列表缩放 |
| `у->f1` | `search_track_titles_only` | `h0` | 搜索仅标题（影响过滤列） |

另有 UI 侧键（`prefs/В.smali`、`preference/k0.smali`）：

```
queue_start                       队列开始行为
queue_end                         队列结束行为
queue_insert_pos                  插入位置
```

### 9.1 `queue_no_shuffle` 的双重影响

从 `pref_summary_queue_no_shuffle` 原文：

> *"Queue is always played in-order. **Also affects Search results Shuffle**"*

⇒ 该开关**不只作用于队列**，还影响搜索结果页的随机行为。
这是一个跨页面的偏好耦合，值得注意。

---

## 10. 双向反查

```java
// 队列 id → 曲目 id
public final long M0(SQLiteDatabase db, long id) {
    return n.y("RestLibraryUtils", db,
        "SELECT queue.folder_file_id FROM queue WHERE _id=?", id);
}

// 曲目 id → 队列 id
public final long x(SQLiteDatabase db, long a, long trackId) {
    return n.y("RestQueue", db,
        "SELECT queue._id FROM queue WHERE queue.folder_file_id=?", trackId);
}
```

与书签 `a0.M0()` / `a0.x()` 完全同型（含同样的**日志 tag 不一致**问题：`RestLibraryUtils` vs `RestQueue`）。

**`x()` 无 `LIMIT`** —— 同一曲目在队列里应该只有一条，但 SQL 未强制。

---

## 11. 队列的数据模型总结

### 11.1 表结构（代码反推）

| 列 | 类型 | 来源 |
| --- | --- | --- |
| `_id` | INTEGER PK | `V()` → `"queue._id"` |
| `folder_file_id` | INTEGER FK | `A0()` → `"queue.folder_file_id"` |
| `sort` | INTEGER | `q()` / `T()` |
| **`created_at`** | **INTEGER（毫秒）** | **`k()` 自动写入 + `T()` 重排参数** |
| `shuffle_order` | INTEGER | `V0()` 引用 |

**没有 `played` 布尔列** —— 播放状态由 `played_at >= created_at` 动态推导。

### 11.2 状态推导规则

```
条目状态 = (folder_files.played_at >= queue.created_at) ? "已播" : "待播"
特例：queue.created_at = 0 → 恒视为 "待播"
```

### 11.3 三个使用点（口径不一致）

| 使用点 | SQL 条件 | 含 `created_at=0` 兜底 |
| --- | --- | --- |
| 列表投影 `Р[1]` | `played_at >= created_at` | 否（纯比较） |
| 找待播 `v1()` | `played_at >= created_at OR created_at=0` | **是** |
| 计数器 `w1()[0]` | `played_at >= created_at` | **否** |

⇒ **`v1()` 与 `w1()` 口径不一致**（详见 §4.3）。这是实现瑕疵。

---

## 12. 与其它页面横向对照

| 维度 | 队列 `m3` | 书签 `a0` | 流 `d4` | 派生列表 `r3` |
| --- | --- | --- | --- | --- |
| 主表 | **`queue`** | `bookmarks` | `folder_files` | `folder_files`（子查询） |
| 与曲目 JOIN | **INNER** | INNER | **LEFT** | LEFT |
| INNER/LETF 理由 | 条目必指向已入库曲目 | 同 | 流可能无 folder_id | 曲目必属文件夹 |
| 排序 | **硬编码 `queue.sort`** | 硬编码 | 6 模式偏好 | 偏好全值 |
| 投影 | **3 个表达式** | 2 个 id | `p0.f3367` | `p0.f3367` |
| 过滤列 | `p0` 四选一 | 自有 2 列 | 自有 3 列 | `p0` 四选一 |
| 特有过滤 | **`aa_status!=2`** | — | `file_type=23` | 时间窗口 |
| 状态列 | **无（时间比较推导）** | `offset_ms` | `__dynamic_url` | — |
| 计数器 | **`w1()` 双计数** | — | — | — |

### 结构定位

```
容器类（年份/流派/专辑/艺术家）  →  行是「类别」
派生列表（最近/最多/评分/长）    →  行是「曲目」，按行为筛选
书签                            →  行是「曲目 + 位置快照」
流                              →  行是「曲目」，按数据来源分区
队列                            →  行是「曲目 + 待播/已播状态」
```

**队列是唯一有「播放进度状态」概念的列表** —— 用时间戳比较而非布尔列实现。

---

## 13. 可借鉴 / 不建议照抄

### 13.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **用 `played_at >= created_at` 推导播放状态**（§3.2） | 不加冗余布尔列，状态随播放自动更新，无需额外写入 |
| A2 | **`k()` 统一入口自动写入 `created_at`**（§6.1） | 保证时间戳准确，调用方无法遗漏或篡改 |
| A3 | **`created_at = 0` 兜底纳入待播**（§4.2） | 旧数据/特殊路径条目不会永远卡在非待播状态 |
| A4 | **`u1()` 一条 SQL 完成「清空保留 N」** | `DELETE WHERE _id!=?` 比先查后删高效 |
| A5 | **投影含计算列**（§3） | 把状态推导下推到 SQL，UI 层零计算 |
| A6 | **`shuffle_order` 与 `sort` 双列**（§8.3） | 原始顺序与随机顺序互不覆盖，切回顺序播放不丢排序 |
| A7 | **`w1()` 一次调用填两个计数器** | 待播数 + 总数同批查询，减少往返 |
| A8 | **`f0()` 动态列拼接**（§5.1） | 复用基类列清单，避免为详情查询写重复 SQL |
| **A9** | **`notPlayed == 0` 才允许清空**（§14.2） | 队列还有未听内容时，新入队不会冲掉它。保护用户未消费的内容 |
| **A10** | **`temp_queue_shuffle_order` 固化已播顺序**（§14.3） | 新入队项随机排在已播区之后，不会插进中间打乱已听顺序 |
| **A11** | **`keepId` 只在「正在播队列」时保留**（§14.2） | 从别处入队时自然清空；在队列中操作时保留当前曲目，行为符合直觉 |
| **A12** | **`as_next` 用 `sort+?` 腾位而非重排全表**（§14.4） | 一次 UPDATE 完成插队，O(n) 而非 O(n log n) |
| **A13** | **`shs` URI 参数旁路覆写排序**（§14.1） | 同一份列表 SQL 支持两种顺序，无需为随机视图另写查询 |

### 13.2 不建议照抄

| # | 做法 | 理由 |
| --- | --- | --- |
| **N1** | **`v1()` 与 `w1()` 的 WHERE 口径不一致**（§4.3 / §11.3） | 一个含 `created_at=0`、一个不含，导致计数器可能少于实际待播数 |
| **N2** | **`u1()` 返回值语义陷阱**（§4.1） | 队列原本只有指定一条时返回 `false`（无行被删），调用方易误判为失败 |
| **N3** | **`x()` 无 `LIMIT`** | 同曲目多次入队时返回值不确定 |
| **N4** | **同族方法日志 tag 不一致**（`RestLibraryUtils` / `RestQueue`） | 排障易漏 |
| **N5** | **`i()` 与 `n()` 都返回 `"queue"`** | 两个方法重复定义同一语义 |
| **N6** | **`O(int)` 忽略参数且与 `V0()` 行为不同**（§8.3） | 两个排序方法各自偏离，调用方必须知道用哪个 |
| **N7** | **`d()` 返回 `-1` 表示无排序偏好** | 魔法负数，与其他实体的 `0` 约定不一致 |
| **N8** | **队列专用过滤 `aa_status!=2` 只在 `f0()` 中**（§5.1） | 列表查询 `X0()` 没有此过滤，两处对同一批数据口径不同 |
| **N9** | **入队完全不查重**（§14.5） | 同曲目可重复入队产生多条行；配合 N10 会让状态判定出错 |
| **N10** | **状态用跨表全局时间比较**（§14.5 / §15.3） | `folder_files.played_at` 被同曲目的所有队列项共享，同批重复入队时一次播放会让多条同时变已播 |
| **N11** | **`clear_on_add` 与 `never_clear_on_add` 同时为 true 时前者静默胜出**（§14.2） | 两个互斥语义的偏好未做互斥校验，配置矛盾时行为不可预期。应改为单一枚举 |
| **N12** | **清空判定用 `played_at < created_at` 而列表投影用 `>=`**（§14.2 vs §3.2） | 两处对称但独立撰写，且清空判定**不含** `created_at=0` 兜底——与 N1 同源的第三处口径差异 |

---

## 14. 运行机制：入队、清空、洗牌（Q2 / Q9 闭环）

> 本节回答两个此前未解的问题：`V0()` 何时被用、同曲目重复入队如何判定。
> 全部结论来自 smali 反汇编 `data/А.smali`（消息处理器）与 `RestProvider.smali`。

### 14.1 `V0()` 的调用方：URI 查询参数 `shs`（Q2 闭环）

`V0()` 在全库**只有一个调用点**：`RestProvider.smali:285`。

```java
// RestProvider —— 查询分发
String shs = uri.getQueryParameter("shs");          // ★ shuffle sort
if (shs != null && shs.length() != 0
    && !shs.equals("0") && !shs.equals("false")) {
    if (entity instanceof х) {                       // 基类
        sortOverride = ((х) entity).V0();            // ★ 用含 shuffle 的顺序
    }
}
```

#### `shs` 参数语义

| `shs` 取值 | 排序来源 |
| --- | --- |
| 缺省 / `""` / `"0"` / `"false"` | `X0()` 里硬编码的 `queue.sort` |
| 其它任意非空值 | `V0()` → `queue_no_shuffle ? queue.sort : "queue.shuffle_order,queue.sort"` |

⇒ **`shs` 是「按随机顺序取列表」的开关**。

这不是队列专属机制——任何继承 `х` 基类的实体都会在收到 `shs` 时走自己的 `V0()`。
`m3.V0()` 的特化点是**它会读 `queue_no_shuffle`**，其它实体的 `V0()` 多为常量或偏好直读。

#### 分工总结

| 方法 | 调用场景 | 返回 |
| --- | --- | --- |
| `O(int)` | `X0()` 设 `i1Var.B`（默认列表排序） | 恒 `"queue.sort"` |
| `V0()` | URI 带 `shs` 非零值 | 按 `queue_no_shuffle` 二选一 |

### 14.2 入队流程：不做查重（Q9 闭环）

入队主逻辑在 `data/А.x(int, Object)`（`L3570` 起，约 500 行消息处理器）。

#### 步骤一：决定保留下标 `playing_entry_id`

```java
boolean cleanAndPlay = bundle.getBoolean("clean_and_play", false);

long keepId = 0;
g0 player = StateBus.getObjectState(0x7f0d00a2);         // state_player_track
if (player != null
    && player.V instanceof m3                            // ★ 当前播放实体确实是队列
    && !cleanAndPlay) {
    keepId = player.Х();                                 // 当前播放条目 id
    bundle.putLong("playing_entry_id", keepId);
}
```

**关键**：只有在「正在播放队列中的曲目」且「不是 clean_and_play」时才保留当前条目。

#### 步骤二：清空决策

```java
boolean canClear = (keepId == 0);

if (canClear) {
    // 统计未播数量
    Cursor c = provider.A(uri, new String[]{"COUNT(*)"},
                          "folder_files.played_at < queue.created_at", null, null, false);
    int notPlayed = (c != null && c.moveToNext()) ? c.getInt(0) : 0;
    if (c != null) c.close();

    if (notPlayed == 0) {
        // ★ 队列里没有未播项 → 考虑清空
        if (у->С.А || !у->c.А) {                          // queue_clear_on_add || !never_clear_on_add
            m3.u1(provider, 0);                          // DELETE FROM queue WHERE _id!=0 → 全清
        }
    }
}
```

#### 清空条件真值表

| `queue_clear_on_add` | `queue_never_clear_on_add` | 无未播项时是否清空 |
| --- | --- | --- |
| `true` | 任意 | **清空** |
| `false` | `false` | **清空**（默认行为） |
| `false` | `true` | **不清空** |

⇒ 默认（两个偏好都未设 = `false`）是**清空**。
`queue_never_clear_on_add = true` 是唯一阻止清空的开关。
`queue_clear_on_add = true` 会**覆盖** `never_clear_on_add`。

【推断】`clear_on_add` 与 `never_clear_on_add` 在设置界面是互斥的两个选项（`pref_queue_clear_on_add` / `pref_queue_never_clear_on_add`），
同时为 true 时前者优先——这是一个未做互斥校验的潜在配置矛盾。

#### 清空的前置条件：`notPlayed == 0`

**只有当队列里所有条目都已播放过，才允许清空。**

⇒ 若队列还有未听的内容，新入队不会冲掉它。这是「保护未播内容」的设计。

### 14.3 洗牌顺序固化：`temp_queue_shuffle_order`

清空决策之后、真正 INSERT 之前，有一段洗牌预处理（`L3930-3980`）：

```sql
-- ① 建临时表：已播部分 + 指定保留项，按 shuffle_order 排序
DROP TABLE IF EXISTS temp_queue_shuffle_order;

CREATE TEMP TABLE temp_queue_shuffle_order AS
SELECT queue._id
FROM queue
  INNER JOIN folder_files ON folder_files._id = queue.folder_file_id
WHERE queue._id = ?
   OR folder_files.played_at >= queue.created_at
   OR queue.created_at = 0
ORDER BY queue.shuffle_order, queue.sort;

-- ② 归一化 shuffle_order（处理负值溢出）
UPDATE queue SET shuffle_order = ABS(MAX(shuffle_order, -9223372036854775807));

-- ③ 按临时表的 rowid 重新分配 shuffle_order
UPDATE queue
SET shuffle_order = (SELECT rowid - <N> FROM temp_queue_shuffle_order
                     WHERE temp_queue_shuffle_order._id = queue._id)
WHERE _id IN (SELECT _id FROM temp_queue_shuffle_order);
```

其中 `<N> = COUNT(*) FROM temp_queue_shuffle_order + 1`。

#### 这段逻辑在做什么

**把「已播 + 当前」的条目按现有随机顺序重新编号为连续的 `shuffle_order`，并把它们排到新插入项之前。**

效果：新入队的曲目随机顺序排在已播项之后，不会插到中间打乱已听过的顺序。

#### 触发条件

```java
if (useShuffle && queueCount > 0) {   // 用随机 且 队列非空
    ...洗牌预处理...
}
```

⇒ 顺序模式下跳过整段。

### 14.4 真正插入

```sql
INSERT INTO queue (folder_file_id, sort, created_at, shuffle_order)
VALUES (?, ?, ?, ?)
```

| 列 | 值 | 说明 |
| --- | --- | --- |
| `folder_file_id` | 曲目 id | 调用方给 |
| `sort` | `IFNULL(MAX(sort), -1) + 1`，或 as_next 时插值 | 追加到末尾 |
| `created_at` | `System.currentTimeMillis()` | 自动 |
| `shuffle_order` | `ABS(MAX(-9223372036854775807, RANDOM()))` | 随机，或 `?` 由外部指定 |

smali 实证：

```smali
const-string v11, "SELECT IFNULL(MAX(sort), -1) FROM queue"          # L4057
invoke-static {}, Ljava/lang/System;->currentTimeMillis()J           # L4053
const-string v12, "ABS(MAX(-9223372036854775807, RANDOM()))"         # L4020（非 as_next）
const-string v12, "?"                                                # L4012（as_next 时外部给）
```

#### as_next 插队逻辑

```sql
-- 目标位置之后的条目整体后移
UPDATE queue SET sort = sort + ? WHERE sort > ?
```

```smali
const-string v14, "UPDATE queue SET sort=sort+? WHERE sort > ?"      # L4086
const-string v21, "SELECT sort FROM queue WHERE _id=?"               # L4097（取当前项位置）
```

⇒ **`as_next` = 插到当前播放项之后，`sort` 值后移腾位**。

### 14.5 不入队查重：Q9 的答案

**整个入队路径没有任何「该曲目已在队列中」的检查。**

| 环节 | 是否查重 |
| --- | --- |
| 清空决策 | 否（只统计未播数） |
| 洗牌预处理 | 否（按 `_id` 重排，不涉及曲目） |
| INSERT | **否，直接追加** |

⇒ **同一曲目可以多次加入队列，产生多条 `queue` 行，各自有独立的 `created_at` 与 `sort`。**

#### 这对 §3 的状态推导意味着什么

回顾 §3.2 的状态判定：

```
条目状态 = folder_files.played_at >= queue.created_at
```

**`played_at` 是 `folder_files` 上的全局播放时间，被同一曲目的所有队列项共享。**

假设曲目 T 被入队两次：

| 时刻 | 事件 | `played_at` | 条目 A（`created_at`=100） | 条目 B（`created_at`=200） |
| --- | --- | --- | --- | --- |
| t=100 | 入队 A | 0 | A: 0 >= 100? 否 → **待播** | — |
| t=150 | 播放 T | **150** | A: 150 >= 100 → **已播** ✓ | — |
| t=200 | 入队 B | 150 | A: 150 >= 100 → 已播 | B: 150 >= 200? 否 → **待播** ✓ |
| t=250 | 再播 T | **250** | A: 已播 | B: 250 >= 200 → **已播** ✓ |

**这个例子中结果是正确的**——因为 `played_at` 是单调递增的时间戳，后来的入队总有更大的 `created_at`。

#### 但存在一个真实歧义

若同一曲目在**同一次批量入队**中被添加两次（`created_at` 相同）：

| `created_at` | 效果 |
| --- | --- |
| A: 300 | 待播 |
| B: 300 | 待播 |
| 播放一次后 `played_at`=350 | **A 和 B 同时变成「已播」** |

⇒ **一次播放会把两条队列项都标记为已播**，但实际只播了一次。

这是「用全局 `played_at` 而非队列项私有播放时间」的结构性后果。
【推断】实际影响有限（用户极少重复入队同一曲目），但语义上确实不精确。

#### 对 SpMusic 的建议（已在 §15.3 展开）

若 SpMusic 要实现相同能力，**应在队列项上存自己的 `playedAt` 快照**，而不是跨表比全局时间。

### 14.6 队列运行时的完整决策图

```
入队请求（Bundle: clean_and_play / as_next / 曲目 ids）
  │
  ├─ ① 判定 keepId
  │    当前播放实体是 m3 且 !clean_and_play ?
  │      是 → keepId = 当前条目 id
  │      否 → keepId = 0
  │
  ├─ ② 清空决策（仅 keepId == 0 时）
  │    统计 COUNT(*) WHERE played_at < created_at   → notPlayed
  │    notPlayed == 0 且 (clear_on_add || !never_clear_on_add) ?
  │      是 → u1(provider, 0) 全清
  │
  ├─ ③ 洗牌预处理（仅 useShuffle && queueCount > 0）
  │    CREATE TEMP temp_queue_shuffle_order（已播 + 保留项，按 shuffle_order 排）
  │    UPDATE queue SET shuffle_order = rowid - N
  │
  ├─ ④ 插入
  │    sort = IFNULL(MAX(sort),-1)+1        （普通追加）
  │    或  UPDATE sort=sort+? WHERE sort>?  （as_next 插队）
  │    created_at = now()
  │    shuffle_order = RANDOM() 或外部值
  │
  └─ ⑤ 播放器接管
       播放 → UPDATE folder_files SET played_at=now()
       条目状态自动变为「已播」（§3.2 的表达式重新求值）
```

---

## 15. 与 SpMusic 对照

`src/features/player/model/mediaLibraryCategories.ts` 定义 12 个分类，**含 `queue`**：

```typescript
{ id: 'queue', label: '队列', icon: queue, overviewIcon: overview5, ... }
```

`playbackQueue.ts` 提供队列模型，`PlaybackQueueOrigin` 为 `'all-songs' | 'playlist'`。

### 15.2 维度对照

| # | 维度 | Poweramp | SpMusic 现状 |
| --- | --- | --- | --- |
| 1 | 队列存储 | **DB 表 `queue`** | 内存 / 前端状态 |
| 2 | 顺序 | `sort` + `shuffle_order` 双列 | 单数组顺序 |
| 3 | 播放状态 | **`played_at >= created_at` 推导** | 无此概念 |
| 4 | 计数器 | 待播数 + 总数 | 单一长度 |
| 5 | 插入时间戳 | 自动写入 | 无 |
| 6 | 「Play Next」 | `queue_as_next` | — |
| 7 | 队列结束行为 | `queue_end`（退出/停留） | — |
| 8 | 忽略随机 | `queue_no_shuffle`（**还影响搜索**） | — |

### 15.3 可借鉴的最小实现

SpMusic 队列如果要加「待播/已播」区分：

| 组件 | 建议 |
| --- | --- |
| 状态 | **不要加 `played` 布尔**，用 `playedAt >= enqueuedAt` 推导（A1） |
| 入队时间 | 入队时自动写 `enqueuedAt`，调用方不可指定（A2） |
| 顺序 | `order` + `shuffleOrder` 双字段（A6） |
| 计数器 | **一处实现**，避免 Poweramp 的 N1 不一致 |
| 兜底 | 无时间戳的条目显式视为待播（A3） |
| **重复入队** | **要么显式查重，要么在队列项上存自己的 `playedAt`**（见下） |

#### 必须修正的一处：不要跨表比全局时间

Poweramp 用 `folder_files.played_at`（曲目**全局**播放时间）与 `queue.created_at`（入队时间）比较。

**这是跨表比较，不是队列项自己的播放记录。**

§14.5 已实证：入队**完全不查重**，同一曲目可产生多条队列行，它们共享同一个 `folder_files.played_at`。

| 场景 | 结果 | 是否正确 |
| --- | --- | --- |
| 曲目在入队**前**刚播过 | `played_at < created_at` → 待播 | ✓ 正确 |
| 曲目单次入队后播放 | `played_at >= created_at` → 已播 | ✓ 正确 |
| **同曲目同批入队两次** | 一次播放让**两条都**变已播 | ✗ **不精确**（只播了一次） |
| **同曲目先后入队两次** | 各按自己的 `created_at` 判定 | ✓ 正确（时间戳单调递增） |

⇒ 只有「同批重复入队」这一种情况会出错。

**建议**：若不打算做入队查重，就在队列项上存自己的 `playedAt` 快照（播放时写入该条目的 `playedAt`，而非曲目的全局 `played_at`）。
这样即使同一曲目入队 N 次，每条也能独立判定。

代价是多一个字段和一次更新；收益是状态语义精确。

#### 其他照抄注意点

| Poweramp 做法 | 建议 |
| --- | --- |
| `shs` URI 参数覆写排序（§14.1） | 可用，但要意识到它会让**同一列表出现两种顺序**，前端需明确当前处于哪种 |
| `temp_queue_shuffle_order` 固化（§14.3） | 值得借鉴：保证新入队项不插进已播区中间 |
| 清空三重条件（§14.2） | 逻辑正确但偏好组合有歧义（`clear_on_add` 与 `never_clear_on_add` 同时 true 时前者胜），建议改成单一枚举 |
| `notPlayed == 0` 才允许清空（§14.2） | 值得借鉴：保护未听内容不被冲掉 |

---

## 16. 未解

### 16.1 已闭环（Q2 / Q9）

| # | 原问题 | 结论 | 证据位置 |
| --- | --- | --- | --- |
| ~~Q2~~ | `V0()` 的实际调用方 | URI 查询参数 `shs` 非空且非 `"0"`/`"false"` 时，`RestProvider` 调用 `((х)entity).V0()` 覆写排序 | §14.1 |
| ~~Q9~~ | 同曲目多次入队的状态判定 | **入队完全不做查重**，同曲目可产生多条队列行；因 `played_at` 全局共享，同批入队的重复项会被一次播放同时标记为已播 | §14.5 |

**附带闭环的运行机制**（原文档未覆盖）：

| 主题 | 结论 | 位置 |
| --- | --- | --- |
| 保留下标 | 仅当「正在播放队列中的曲目」且 `!clean_and_play` 时保留当前条目 | §14.2 |
| 清空条件 | `keepId==0` **且** 无未播项 **且**（`clear_on_add` 或 `!never_clear_on_add`） | §14.2 |
| 洗牌固化 | `temp_queue_shuffle_order` 临时表把已播部分重编号，新项排在之后 | §14.3 |
| as_next 插队 | `UPDATE queue SET sort=sort+? WHERE sort>?` 腾位 | §14.4 |

### 16.2 仍开放

| # | 问题 | 优先级 |
| --- | --- | --- |
| **Q3** | `n3`（`getQueueFilesForced`）的实现与 `m3` 的差异 | 中 |
| **Q4** | `у->p` 与 `у->C` 都指向 `queue_no_shuffle` 的原因（是否别名） | 中 |
| **Q5** | 四个能力开关 `n1/r1/s1/v` 的接口语义 | 中 |
| **Q6** | `aa_status` 的取值枚举（`2` 是什么状态） | 中 |
| **Q1** | `queue` 表完整 DDL（`onUpgrade` 变量拼 SQL，无法静态枚举） | 中 |
| **Q10** | `clear_on_add` 与 `never_clear_on_add` 同时为 true 时前者优先，是否为有意的设计 | 低 |
| Q7 | `C()` 返回 `5`、`z()` 返回 `10` 的语义 | 低 |
| Q8 | `r()` 返回的实例字段 `H` 何时被赋值 | 低 |

> Q2 / Q9 闭环后，队列的**完整生命周期**已全链实证：
> 入队（§14.2–14.4）→ 状态推导（§3.2）→ 列表（§2）→ 待播查找（§4.2）→ 清空（§14.2）。
>
> 剩余项均属外围：`n3` 差异（Q3）、偏好别名（Q4）、UI 语义（Q5–Q8）。

---

## 17. Evidence ID 索引

| 主题 | Evidence ID |
| --- | --- |
| **`m3.X0`（列表 SQL）+ 类摘要** | `ev_faa508c9b285ee45ef5c9a468449d81fda7042a73fe1834992c0d2185c8bde2a` |
| **`m3.<clinit>`（3 表达式投影，smali）** | `ev_0827159f78bc24d6a474134cdfb8f69bce95dc71dff6fd4355932348e5d0dbb6` |

### 16.1 smali 取证（本章大量结论来自 smali）

创建与运行时的关键结构通过 apktool `--no-res` 反汇编取证（7308 个 `.smali`）。

| 主题 | 来源文件与位置 |
| --- | --- |
| 3 表达式投影 `Р` | `rest/library/m3.smali:26-42`（`<clinit>`） |
| `u1()` 清空保留 | `m3.smali:62-114` |
| `v1()` 找待播位置 | `m3.smali:116-146` |
| `w1()` 双计数器 | `m3.smali:148-206` |
| `X0()` 列表查询 | `m3.smali:530-600` |
| `f0()` 详情查询（`aa_status`） | `m3.smali:632-690` |
| `k()` 自动时间戳 | `m3.smali:708-736` |
| `T()` 重排 | `m3.smali:408-468` |
| `q0()` 删除 | `m3.smali:874-999` |
| `M0()` / `x()` 双向反查 | `m3.smali:299-311` / `1069-1081` |
| 元数据方法全表 | `m3.smali:210-1097` |
| 队列偏好键 | `rest/library/у.smali:335-357`、`:989`、`:1141` |

资源来源：`.rea-analysis/decoded/res/values/strings.xml`、`.rea-analysis/decoded/res/values/public.xml`（apktool 3.0.3，已入库）。

复现命令：

```powershell
$env:JAVA_HOME = "<rea-bundle>/vendor/jdk"
apktool d --no-res -f -o <out> .rea-analysis/Poweramp-v3.apk
# 关键搜索：
#   const-string "played_at >= queue.created_at"
#   "FROM queue"
#   "queue_no_shuffle"
```

---

## 18. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| **`poweramp-queue-runtime-reference.md`** | **运行时状态机**：next/prev 不对称、随机语义推导、延迟队列、错误码。**本文不重复这些内容**，只提供其数据层基础 |
| `poweramp-streams-view.md` | 流（独立表 + `file_type=23`）。本文 §12 对照其 LEFT JOIN 选择 |
| `poweramp-bookmarks-view.md` | 书签（独立表 + 位置快照）。本文 §10 对照其反查方法与日志 tag 问题 |
| `poweramp-recents-views.md` | 派生列表 + `p0.O` 排序映射。本文 §7 引用其过滤列四选一机制 |
| `poweramp-category-views.md` | 年份/流派容器。本文 §8.1 引用其 `cat_stats.type` 位域编码 |
| `poweramp-entity-views.md` | 专辑/艺术家/专辑艺术家/作曲家 |
| `poweramp-library-three-views.md` | 所有歌曲/文件夹/层次结构 |
| `poweramp-search-and-queue-impact.md` | 搜索对队列的影响。与本文 §9.1 的 `queue_no_shuffle` 跨页耦合相关 |
| `media-library-page-relationships.md` | SpMusic 三页面现状 |
