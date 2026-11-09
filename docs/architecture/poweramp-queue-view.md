---
doc_id: "ARCH-POWERAMP-QUEUE-VIEW"
title: "Poweramp 队列参考（独立表 + 入队时间戳驱动）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-03"
updated: "2026-11-08"
source_documents:
  - "user request: 逆向 Poweramp 媒体库下「队列」页的实现与组织"
  - "shared task: task-19"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009) :: SHA-256 4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0"
  - ".rea-analysis/findings-queue-view.md（本轮方法体原文；§16 为 2026-11-08 语义复核补取）"
  - ".rea-analysis/v1035/decoded/（build-1035 跨版本比对，§3.4）"
  - ".rea-analysis/decoded/res/values/strings.xml（UI 文案）"
  - ".rea-analysis/decoded/res/values/public.xml（R.attr / R.string ID）"
  - "docs/architecture/poweramp-queue-runtime-reference.md（运行时状态机，本文边界见 §15）"
  - "docs/architecture/poweramp-streams-view.md（同为独立表的 song 视图）"
  - "docs/architecture/poweramp-bookmarks-view.md（同为独立表的 song 视图）"
  - "docs/architecture/media-library-page-relationships.md（SpMusic 侧对照）"
---

# Poweramp 队列参考（独立表 + 入队时间戳驱动）

> **勘误（2026-11-08）**：本文此前把 `folder_files.played_at >= queue.created_at` 误标为「待播」。经 smali 重新取证，该谓词的语义是**已播**（`<` 才是未播）。本次修正了全部语义标签与 §4.2 / §4.3 / §11.2 / §11.3 / N1 三处实质结论。§3.2 / §14.2 / §14.3 / §14.5 / §14.6 / §15.3 的方向本就正确、结论未改动（§3.2 仅补充 DDL 前提与「UI 灰显」推断标记）。取证依据见 §3.4。
>
> **术语**：「待播」与「未播」是同一状态的两种叫法（都指 `played_at < queue.created_at`）。本文新增/重写的段落统一用「**已播 / 未播**」这一对；§14.5、§15.3 的既有表格保留原「待播」措辞，语义一致，不必改动。

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
            folder_files.played_at >= queue.created_at  → 已播（否则未播）
            无常驻布尔列，状态随播放自动重算

【消费侧】 见 §2 §4
            d4→m3.X0()：列表（投影 3 表达式，第 1 列 = 已播标志）
            v1()：取第一个已播条目的 sort（= 入队插入锚点，非续播位置）
            w1()：已播数 + 总数
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

**`folder_files.played_at >= queue.created_at` = 「这条队列项入队之后被播放过」= 已播；取反 `<` = 未播。**

| 状态 | `played_at` vs `created_at` | 表达式 |
| --- | --- | --- |
| 入队后未播放 | `played_at` < `created_at` | `0` → 未播 |
| 入队后已播放 | `played_at` >= `created_at` | `1` → 已播 |

> `played_at` 是 `INTEGER NOT NULL DEFAULT 0`（`data/migrations/B.smali:4456`；旧库 `:5470-5482` 走 ALTER，同样带默认值），所以实际数据里不会出现 NULL。SQL 三值逻辑下 NULL 比较结果为 NULL、被当作 `0`（未播），这只会发生在数据损坏时。

⇒ **这一列就是「已播放 / 未播放」标志**，供 UI 区分行状态。【推断】按 Poweramp 的列表习惯推测是「已播灰显、待播高亮」，但本轮的静态取证只追到「该列被列表游标消费」（`b0.smali:3897` 读第 1 列），**灰显/高亮的实际视觉处理未观察到**，仍属推断。

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

### 3.4 语义方向是如何确定的（防止再次反转）

`>=` 是已播这一点有四条互相独立的决定性证据，任何一条都足以排除反向解读：

| # | 证据 | 推论 |
| --- | --- | --- |
| **E1** | `player/b0.smali:2834` 把 `... WHERE folder_files.played_at < queue.created_at` 这条语句存进字段 **`mQueueUnplayedCountSt`**（未播计数语句） | 字段名直接绑定 `<` ⇒ **`<` = 未播** ⇒ 取反 `>=` = 已播 |
| **E2** | `player/b0.smali:3897` `moveToFirstNotPlayedQueueEntryOrLast()` 遍历 `mFilesCursor`，取 **第 1 列**（`getLong(1)`，`:3924`），命中条件为值 **`== 0`**（`:3930-3936`） | 队列投影第 1 列（`m3.<clinit>` `rest/library/m3.smali:29`）就是 `played_at >= created_at`；「值为 0 即 NotPlayed」⇒ **`>=` 为真 = 已播** |
| **E3** | `player/b0.smali:7440-7483` `postCreate()`：`v2 = out[0]`、`v0 = out[1]`（`:7446`/`:7450`），随后 `if (v0 > 0 && v2 < v0) mHasPendingQueue = true`（`:7465-7472`） | 只有 `out[0]` 是**已播数**时，「已播数 < 总数 ⟺ 仍有待播」才成立；若 `out[0]` 是未播数该条件会反向 ⇒ `w1()[0]` = **已播数** |
| **E4** | 全量一致性普查：4 处 `<`（`data/А.smali:3843` 清空判定、`b0.smali:2834`、`list/q0.smali:449` 过滤列、`b0.smali:3924` 游标判定）全部承担「未播」语义；4 处 `>=`（`m3.smali:29` 投影、`:129` `v1`、`:165` `w1`、`data/А.smali:3942` 临时表）全部承担「已播」语义 | 无例外，不存在反向使用的孤例 |

跨版本复核：`.rea-analysis/v1035/decoded`（build-1035）中 `smali/ׅ/p01.smali:31,202,268,727,749`、`ׅ/dj.smali:7032,7219`、`ׅ/k01.smali:3879`、`ׅ/mt0.smali:804` 的谓词与全部消费点**逐字节一致**，语义方向不随版本变化。

> 补充：Poweramp 同时维护**两个互补计数器** —— `m3.w1()[0]` = 已播数，`b0.mQueueUnplayedCountSt`（`getQueueUnplayedSongs()`，`b0.smali:2607-2627`）= 未播数。两者口径互补而非矛盾，详见 §4.3。

---

## 4. 核心静态方法（§4.4 为续播定位补充）

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

### 4.2 `v1(db, useShuffle)` —— 第一个已播条目的 `sort`（入队插入锚点）

> **本次修正**：本节此前被描述为「找第一个待播位置 / 续播位置」，那是错的。`v1()` 返回的是**第一个已播条目的 `sort`**，唯一用途是给入队 INSERT 当**插入锚点**；它与「播放起点 / 续播 / 播放位置」无关。真正的续播定位在 `b0.moveToFirstNotPlayedQueueEntryOrLast()`（见 §4.4）。

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
WHERE folder_files.played_at >= queue.created_at   -- 已播区
   OR queue.created_at = 0                         -- 冗余兜底，见下
ORDER BY [queue.shuffle_order,] sort
LIMIT 1
```

**这是投影里的布尔表达式第一次被用于 WHERE**【实证·smali】`m3.smali:129`。

#### 语义：已播区的下界 `sort`

`WHERE played_at >= created_at` 筛出**已播区**，`ORDER BY [shuffle_order,] sort LIMIT 1` 取其**最小 `sort`**——即已播区在排序轴上占据的起点。入队时拿它做减法，就能算出「已播区之后还有多少行需要后移腾位」。

#### 唯一的两个调用点都在入队消息处理器里，且只用作插入锚点【实证·smali】

| 调用点 | 上下文 | 结果如何被消费 |
| --- | --- | --- |
| `data/А.smali:4130` | `as_next` 分支（`:4092` 判 `if-eqz v28` 后走 `:cond_13`） | `:4137` `sub-long v6, v37, v12`，其中 `v37 = MAX(sort)`（`:4118` 从 `:4066` 的 `IFNULL(MAX(sort),-1)` 传来），`v12` = 锚点 ⇒ 得**需后移的行数**；`:4185` 执行 `UPDATE queue SET sort=sort+? WHERE sort > ?`（`:4086` 编译好的语句） |
| `data/А.smali:4306` | 同一处理器的另一分支 | `:4318` `sub-long v12, v37, v3` 同上；`:4333` `add-long v12, v12, v29` 得新行的起始 `sort` |

⇒ **`v1()` 的返回值只参与 `sort` 的算术，从不被当作播放位置使用。** 它求解的是「从哪个 `sort` 处开始把后续行整体后移」，与 `queue_start / queue_end` 等播放行为偏好没有任何调用关系。

#### 关于 `OR queue.created_at = 0`：冗余兜底，不是「视为待播」

> **本次修正**：本节此前写作「`created_at = 0` 的条目无条件视为待播」「兜底避免这些条目永远不被播放」，这两句都是错的。

`folder_files.played_at` 的定义是 `INTEGER NOT NULL DEFAULT 0`（`data/migrations/B.smali:4456`；旧库从 `:5470-5482` 的 `ALTER TABLE folder_files ADD COLUMN ...` 补列，同样带 `DEFAULT 0`），因此 `played_at` 恒为非空整数，`played_at >= 0` **恒为真**。

⇒ `created_at = 0` 的行在 `played_at >= created_at` 这一个条件上**本来就成立**，已经落在已播侧。`OR queue.created_at = 0` 不改变任何行的归属。

那它还有意义吗？只有一种情形：若 `played_at` 允许为 NULL，`NULL >= 0` 求值为 NULL、被当作假，该行会被排除；此时 `OR created_at = 0` 能把它拉回来【推断】。在当前 DDL 下这是**不可达分支**，属防御性冗余。

⇒ 因此**不存在**「计数器少算待播项」「UI 徽标数字与真实值不符」这类问题（§4.3 已按此重写）。

#### 返回 `Long.MIN_VALUE`

`n.x(tag, db, sql, Long.MIN_VALUE)` 的最后一个参数是默认值——查询无结果（`LIMIT 1` 空）时返回 `Long.MIN_VALUE`，即「队列里没有已播条目」（全新队列 / 全部未播）。
调用点用 `cmp-long` 与 `Long.MIN_VALUE` 比较后再 `Math.max(0, MAX(sort) − anchor)` 兜底（`data/А.smali:4149-4151`、`:4326`），所以该哨兵值不会污染 `sort` 计算。

### 4.3 `w1(provider, int[] out)` —— 队列计数器（已播数 + 总数）

```java
public static void w1(RestProvider provider, int[] out) {
    SQLiteDatabase db = provider.getWritableDatabase();
    out[0] = 0;
    out[1] = 0;

    // 计数器 0：已播数量
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
| `out[0]` | `COUNT(*) ... WHERE played_at >= created_at` | **已播数量** |
| `out[1]` | `COUNT(*) FROM queue` | **队列总长度** |

【实证·smali】`w1()[0]` = 已播数由 `b0.smali:7440-7483` 反证：`postCreate()` 取 `v2 = out[0]`、`v0 = out[1]`，随后 `if (v0 > 0 && v2 < v0) mHasPendingQueue = true`。只有 `out[0]` 是已播数时，「已播数 < 总数 ⟺ 仍有待播」才成立；若它是未播数，这个条件会完全反向。同时 `:7483` 把 `(v2, v0)` 作为 `msg_player_queue_changed` 的两个 int 参数发出，即 UI 徽标拿到的是 `(已播, 总数)`。

#### 与 `v1()` 的关系：不是「同一口径的两种写法」

> **本次修正**：本节此前有一张「`w1()` vs `v1()` 口径差异（重要）」的表，并据此推出「计数器可能比实际待播项少、`v1()` 与 `w1()` 口径不一致是瑕疵」。该结论**不成立**，已删除。

| 方法 | 度量对象 | 返回 | 是否含 `OR created_at=0` |
| --- | --- | --- | --- |
| `w1()[0]` | **行数** | `long` 计数 | 否 |
| `w1()[1]` | **行数** | `long` 计数 | 否 |
| `v1()` | **一个已播行的 `sort` 值** | 锚点 | 是（冗余，§4.2） |

⇒ **`w1()` 数的是行，`v1()` 取的是锚点值。两者度量对象根本不同，不存在「同一指标两处实现不一致」。**

剩余的唯一差异只是**文本层面的**：`v1()` 多写了一个 `OR created_at=0`，`w1()` 没写。按 §4.2 的论证，该分支在当前 DDL 下不可达，因此**无可观察行为差异**，纯属两位作者写法不同。

#### Poweramp 的两套互补计数器

真正值得注意的是：Poweramp 在同一件事上用了**两套独立实现**，二者口径互补而非冲突【实证·smali】：

| 计数器 | 位置 | 语义 | 实现 |
| --- | --- | --- | --- |
| **已播数** `w1()[0]` | `m3.smali:148-206` | `played_at >= created_at` 的行数 | `m3.w1()`，经 `b0.getQueueStats()`（`b0.smali:2585-2605`）调用 |
| **未播数** `b0.mQueueUnplayedCountSt` | `b0.smali:2834`（`initSql()` 内编译），`b0.smali:2607-2627` `getQueueUnplayedSongs()` 执行 | `played_at < created_at` 的行数 | 播放器侧预编译语句 |

⇒ `已播数 + 未播数 = 总数`（在 `played_at` 无 NULL 的前提下）。**二者是同一设计的两个方向，不是一个指标的两份不一致实现。**

> 【推断】维护两处独立 SQL 而非在调用侧做减法，属可优化的冗余——但这只是工程整洁度问题，不构成语义缺陷。本文此前把它误记成「口径不一致的瑕疵」（旧 N1），是本次修正的实质错误之一。

### 4.4 真正的「第一个未播 / 续播位置」：`b0.moveToFirstNotPlayedQueueEntryOrLast()`

`m3` 里**没有**「找第一个未播项」的方法。该职责在播放器类 `b0` 里【实证·smali】：

```smali
.method private moveToFirstNotPlayedQueueEntryOrLast()I        # b0.smali:3897
    iget-object v0, p0, ...->mFilesCursor:Landroid/database/Cursor;   # :3900
    invoke-interface {v0, v2}, Landroid/database/Cursor;->moveToPosition(I)Z   # :3910 移到 -1
  :cond_0
    invoke-interface {v0}, Landroid/database/Cursor;->moveToNext()Z           # :3913
    ...
    invoke-interface {v0, v4}, Landroid/database/Cursor;->getLong(I)J         # :3924 ★ 第 1 列（v4=0x1）
    const-wide/16 v5, 0x0                                                    # :3930
    cmp-long v7, v2, v5                                                      # :3932
    if-nez v7, :cond_0                                                       # :3934 ★ == 0 即命中
    return v4                                                                # :3936 → 1
  :cond_1
    invoke-interface {v0}, Landroid/database/Cursor;->moveToLast()Z           # :3950 全扫无果 → 退到最后一条
```

关键点：

| 要点 | 说明 |
| --- | --- |
| 读的是**第 1 列** `getLong(1)` | 正是 §3.1 中 `folder_files.played_at >= queue.created_at` 那一列 |
| 命中条件是 **`== 0`** | 0 = 谓词为假 = **未播** ⇒ 方法名的「NotPlayed」与判定一致 |
| 全扫无未播项时 `moveToLast()` | 退化为「最后一条」，与 `OrLast` 后缀吻合 |
| 异常返回 `-5`（`:3917` `const/4 v3, -0x5`） | 游标状态异常时的哨兵值 |

调用点仅两处：`b0.smali:4712`（`startQueueImpl` 内，即开始播放队列时定位起点）与 `b0.smali:6088`。

⇒ **「从哪里开始播 / 续播」由该方法决定，与 §4.2 的 `v1()` 完全无关。** 本文旧版把两者混为一谈，是本次修正的核心实质错误。

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
条目状态 = (folder_files.played_at >= queue.created_at) ? "已播" : "未播"
补充：played_at 为 INTEGER NOT NULL DEFAULT 0，故 >= 恒有确定结果
     queue.created_at = 0 的行落在 0 >= 0，直接判为 "已播"（不是特例）
```

> **本次修正**：旧版此处写「`created_at = 0` → 恒视为待播」，方向错误。`played_at NOT NULL DEFAULT 0`（`data/migrations/B.smali:4456`）使 `played_at >= 0` 恒真，这些行**一直是已播**；`v1()` 里的 `OR created_at=0` 是冗余兜底，不构成特例（§4.2）。

### 11.3 各使用点的谓词与语义

| 使用点 | SQL 条件 | 谓词语义 | 含 `created_at=0` |
| --- | --- | --- | --- |
| 列表投影 `Р[1]` | `played_at >= created_at` | **已播标志** | 否（纯比较） |
| `v1()` 取锚点 | `played_at >= created_at OR created_at=0` | **已播区**，取最小 `sort` | **是**（冗余，当前 DDL 下不可达） |
| 计数器 `w1()[0]` | `played_at >= created_at` | **已播数** | **否** |
| 清空判定（§14.2） | `played_at < created_at` | **未播数** | 否 |
| 洗牌临时表（§14.3） | `played_at >= created_at OR created_at=0` | **已播区 + 保留项** | 是（同上，冗余） |
| 未播计数 `b0.mQueueUnplayedCountSt` | `played_at < created_at` | **未播数** | 否 |

⇒ 全部使用点方向一致：`>=` 一律是已播侧，`<` 一律是未播侧，**不存在口径冲突**。
`v1()` / 洗牌临时表多出的 `OR created_at=0` 是唯一文本差异，且按 §4.2 论证无可观察影响。
`v1()` 与 `w1()[0]` 度量对象不同（锚点 `sort` vs 行数），不可相互比较（§4.3）。

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
队列                            →  行是「曲目 + 已播/未播状态」
```

**队列是唯一有「播放进度状态」概念的列表** —— 用时间戳比较而非布尔列实现。

---

## 13. 可借鉴 / 不建议照抄

### 13.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **用 `played_at >= created_at` 推导播放状态**（§3.2） | 不加冗余布尔列，状态随播放自动更新，无需额外写入 |
| A2 | **`k()` 统一入口自动写入 `created_at`**（§6.1） | 保证时间戳准确，调用方无法遗漏或篡改 |
| A3 | **`created_at = 0` 冗余兜底**（§4.2） | `played_at NOT NULL DEFAULT 0` 使 `>=` 恒真，该分支实际不可达；保留它只是对 `played_at` 可能为 NULL 的防御性防御，**并不改变任何行的状态判定** |
| A4 | **`u1()` 一条 SQL 完成「清空保留 N」** | `DELETE WHERE _id!=?` 比先查后删高效 |
| A5 | **投影含计算列**（§3） | 把状态推导下推到 SQL，UI 层零计算 |
| A6 | **`shuffle_order` 与 `sort` 双列**（§8.3） | 原始顺序与随机顺序互不覆盖，切回顺序播放不丢排序 |
| A7 | **`w1()` 一次调用填两个计数器** | 已播数 + 总数同批查询，减少往返 |
| A8 | **`f0()` 动态列拼接**（§5.1） | 复用基类列清单，避免为详情查询写重复 SQL |
| **A9** | **`notPlayed == 0` 才允许清空**（§14.2） | 队列还有未听内容时，新入队不会冲掉它。保护用户未消费的内容 |
| **A10** | **`temp_queue_shuffle_order` 固化已播顺序**（§14.3） | 新入队项随机排在已播区之后，不会插进中间打乱已听顺序 |
| **A11** | **`keepId` 只在「正在播队列」时保留**（§14.2） | 从别处入队时自然清空；在队列中操作时保留当前曲目，行为符合直觉 |
| **A12** | **`as_next` 用 `sort+?` 腾位而非重排全表**（§14.4） | 一次 UPDATE 完成插队，O(n) 而非 O(n log n) |
| **A13** | **`shs` URI 参数旁路覆写排序**（§14.1） | 同一份列表 SQL 支持两种顺序，无需为随机视图另写查询 |

### 13.2 不建议照抄

| # | 做法 | 理由 |
| --- | --- | --- |
| **N1** | **两套独立计数器各写一份 SQL**（§4.3） | 已播数由 `m3.w1()[0]` 算、未播数由 `b0.mQueueUnplayedCountSt` 算，二者口径互补（`>=` / `<`）而非冲突，`已播 + 未播 = 总数`；但同一件事维护两处实现，改谓词时需同步两处，是可收敛的工程冗余，非语义缺陷 |
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
| **N12** | **清空判定用 `played_at < created_at` 而列表投影用 `>=`**（§14.2 vs §3.2） | 两处是同一谓词的互补两半，语义方向正确；但它们**独立撰写**、互为镜像，改一处易漏另一处。清空判定也不含 `created_at=0` 冗余兜底——同样不影响结果（`played_at NOT NULL`，`<` 与 `>=` 恒互补），仅增加维护成本 |

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
| 4 | 计数器 | 已播数 + 总数（`w1()`），另有独立的未播计数（`b0.mQueueUnplayedCountSt`） | 单一长度 |
| 5 | 插入时间戳 | 自动写入 | 无 |
| 6 | 「Play Next」 | `queue_as_next` | — |
| 7 | 队列结束行为 | `queue_end`（退出/停留） | — |
| 8 | 忽略随机 | `queue_no_shuffle`（**还影响搜索**） | — |

### 15.3 可借鉴的最小实现

SpMusic 队列如果要加「已播/未播」区分：

| 组件 | 建议 |
| --- | --- |
| 状态 | **不要加 `played` 布尔**，用 `playedAt >= enqueuedAt` 推导（A1） |
| 入队时间 | 入队时自动写 `enqueuedAt`，调用方不可指定（A2） |
| 顺序 | `order` + `shuffleOrder` 双字段（A6） |
| 计数器 | **一处实现**（如只存未播数，已播数用总数相减），避免 Poweramp 那种两套 SQL 各写一遍（N1） |
| 兜底 | 无需 `created_at=0` 类兜底：把 `enqueuedAt` 定为 NOT NULL DEFAULT 0 即可，`playedAt >= 0` 恒真、天然落在已播侧（A3） |
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
> 入队（§14.2–14.4）→ 状态推导（§3.2）→ 列表（§2）→ 入队锚点 `v1()`（§4.2）/ 续播定位（§4.4）→ 清空（§14.2）。
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
| `v1()` 取已播区锚点 `sort` | `m3.smali:116-146` |
| `w1()` 双计数器 | `m3.smali:148-206` |
| `X0()` 列表查询 | `m3.smali:530-600` |
| `f0()` 详情查询（`aa_status`） | `m3.smali:632-690` |
| `k()` 自动时间戳 | `m3.smali:708-736` |
| `T()` 重排 | `m3.smali:408-468` |
| `q0()` 删除 | `m3.smali:874-999` |
| `M0()` / `x()` 双向反查 | `m3.smali:299-311` / `1069-1081` |
| 元数据方法全表 | `m3.smali:210-1097` |
| 队列偏好键 | `rest/library/у.smali:335-357`、`:989`、`:1141` |

**2026-11-08 语义复核新增取证**（均为 file:line 形式，未产生新的 `ev_*` Evidence ID）：

| 主题 | 来源文件与位置 |
| --- | --- |
| 未播计数语句字段绑定 `<` | `player/b0.smali:2834`、`:2840`（`mQueueUnplayedCountSt`） |
| `getQueueStats()` → `m3.w1()` | `player/b0.smali:2585-2605` |
| `getQueueUnplayedSongs()` | `player/b0.smali:2607-2627` |
| 续播定位 `moveToFirstNotPlayedQueueEntryOrLast()` | `player/b0.smali:3897-3960`；调用点 `:4712`、`:6088` |
| `mHasPendingQueue` 判定 | `player/b0.smali:7440-7483`（`:7446`/`:7450`/`:7465-7472`/`:7483`） |
| `v1()` 调用点与锚点算术 | `data/А.smali:4130`、`:4137`、`:4306`、`:4318`；腾位 UPDATE `:4086`、`:4185` |
| `played_at` DDL（NOT NULL DEFAULT 0） | `data/migrations/B.smali:4456`；旧库 ALTER `:5470-5482` |
| 过滤列中的 `<` | `list/q0.smali:449` |
| 跨版本一致（build-1035） | `.rea-analysis/v1035/decoded/smali/ׅ/p01.smali:31,202,268,727,749`；`dj.smali:7032,7219`；`k01.smali:3879`；`mt0.smali:804` |

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
