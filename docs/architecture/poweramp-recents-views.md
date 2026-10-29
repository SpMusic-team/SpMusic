---
doc_id: "ARCH-POWERAMP-RECENTS-VIEWS"
title: "Poweramp 派生列表参考（最近播放 / 最近添加 / 最多播放）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-10-30"
updated: "2026-10-30"
source_documents:
  - "user request: 逆向 Poweramp 媒体库下「最近播放」「最近添加」「最多播放」三页的组织与实现"
  - "shared task: task-13"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009) :: SHA-256 4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0"
  - ".rea-analysis/findings-recents-views.md（本轮方法体原文 + 偏好键映射）"
  - ".rea-analysis/decoded/res/xml/library.xml（played_dur 门槛设置）"
  - ".rea-analysis/decoded/res/values/strings.xml（UI 文案）"
  - "docs/architecture/poweramp-entity-views.md（实体视图框架，本文承接其 X0 钩子模型）"
  - "docs/architecture/poweramp-queue-runtime-reference.md（b0 队列管理器，写入路径所在）"
  - "docs/architecture/media-library-page-relationships.md（SpMusic 侧对照）"
---

# Poweramp 派生列表参考（最近播放 / 最近添加 / 最多播放）

## 0. 定位与证据分级

**本文记录外部实现 Poweramp 的三个「派生列表」页面，不是 SpMusic 现状。**

| 标记 | 含义 | 可信度 |
| --- | --- | --- |
| **【实证·产物】** | JADX 反编译方法体原文 | 最高 |
| **【实证·原文】** | APK 资源字符串 / 偏好 XML 原文 | 高 |
| **【推断】** | 本文作者推理 | 低 |

### 0.1 三页共性（先看结论）

**三个页面没有任何自有数据表。** 它们全部是同一张 `folder_files` 表上的**三种不同筛选 + 排序**，经同一套「子查询截断 → JOIN 富化 → 外层排序」模板产出：

```
(SELECT * FROM folder_files WHERE <时间条件> ORDER BY <时间列> DESC LIMIT <N>) AS folder_files
  LEFT JOIN folders / artists / albums [/ album_artists]
ORDER BY <用户排序偏好>
```

区别只在三个变量：**用哪个时间列**、**用哪个窗口/条数偏好**、**是否附加"播放过"条件**。

### 0.2 缺口状态

**本轮已闭环 4 项**（G1 / G2 / G3 / G5），均已升级为【实证·产物】：

| # | 原缺口 | 现状 |
| --- | --- | --- |
| ~~G1~~ | `b0` 各 `mUpdate*St` 的 SQL 文本 | ✅ **已闭环**，四条 UPDATE 原文见 §7.1。核心发现：`played_fully_at` 是 `played_at` 的快照拷贝 |
| ~~G2~~ | `q3.mo2437()` | ✅ **已闭环**：`Math.max(2, C0742.i0.f3810)` |
| ~~G3~~ | `h3.d()` | ✅ **已闭环**：`(C0742.V.f3810 & 0x40000000) \| 6` —— 排序维度被强制锁死，见 §5.5 |
| ~~G5~~ | 三个窗口偏好的默认值 | ✅ **已闭环**：long 偏好工厂无默认参数 ⇒ **默认 0**，见 §9.5 |

**仍开放**：

| # | 缺口 | 影响 |
| --- | --- | --- |
| G4 | `C0742.f3413`–`f3418`（7 个 boolean）的键 | `<clinit>` 体反编译截断 |
| G6 | `g0Var.V.s1()` 的确切语义 | 推断为"虚拟/CUE 条目" |
| G7 | `r3`/`q3`/`h3` 的 `O(int)` 映射（继承自 `p0`） | 模式 6 具体映射为哪个 ORDER BY 表达式未读 |
| G8 | 三个窗口偏好**由谁写入**（更新时机） | 默认 0 表示"不限"，但用户如何设置时间筛选的 UI 入口未找到 |

---

## 1. 三页实体映射

| UI 文案【实证·原文】 | 访问器 | 实体 | 方法数 |
| --- | --- | --- | --- |
| `recently_played` = "Recently Played" | `getRecentlyPlayed()` | **`r3`** | 31 |
| `recently_added` = "Recently Added" | `getRecentlyAdded()` | **`q3`** | 29 |
| `most_played` = "Most Played" | `getMostPlayed()` | **`h3`** | 31 |

三者均继承 `AbstractC0743`，实现 `X0(Uri, r, String, StringBuilder, ArrayList, i1)` 钩子——与专辑/艺术家/作曲家完全同一个实体框架。

相关 UI 文案：
```
last_played     = "Last Played"
by_played_at    = "By time last played"
played_times    = "Played Times"
pref_played_dur = "Count As Played"
```

---

## 2. 核心模板

三页的 `X0` 都是同一个骨架，只有填入的参数不同。

### 2.1 骨架

```java
StringBuilder sb = new StringBuilder("(SELECT * FROM folder_files");
// ① 可选：排除 CUE 虚拟曲目
if (!C0742.f3414.f3789) sb.append(" WHERE folder_files.cue_folder_id IS NULL");

// ② 时间窗口条件（三页各不相同，见 §6）
sb.append(<窗口条件>);

// ③ 时间列排序 + 截断
sb.append(" ORDER BY <时间列> DESC");
if (mo2437() != Integer.MAX_VALUE) sb.append(" LIMIT ").append(mo2437());

// ④ 子查询结束，再 JOIN 富化
sb.append(") AS folder_files"
        + " LEFT JOIN folders  ON folders._id=folder_id"
        + " LEFT JOIN artists  ON artists._id=folder_files.artist_id"
        + " LEFT JOIN albums   ON albums._id=folder_files.album_id");
if (C0742.O.f3789) {                       // ← use_albumartist
    sb.append(" LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id");
}
rVar.A = sb.toString();

// ⑤ 过滤列数组四选一
String[] strArr = C0742.f1.f3789
    ? (C0742.f3418.f3789 ? p0.y : p0.f3368)
    : (C0742.f3418.f3789 ? p0.x : p0.X);

// ⑥ 外层排序
i1Var.B = O(<排序偏好>);

// ⑦ 投影：与「所有歌曲」完全相同
return p0.f3367;
```

### 2.2 三个关键设计

**① `LIMIT` 在子查询内部**

先选出"最近/最多 N 条**曲目**"，再去做关联。若把 `LIMIT` 放到外层，`folder_files` 与 `folders`/`artists`/`albums` 的关联会放大行数，`LIMIT N` 就不再等于"N 首曲目"。

**② 双层 ORDER BY**

| 层次 | 作用 | 依据 |
| --- | --- | --- |
| 内层 `ORDER BY <时间列> DESC` | 决定**哪些曲目进入列表** | 硬编码 |
| 外层 `ORDER BY O(<偏好>)` | 决定**页面如何显示** | `*_files_sort` 偏好 |

⇒ 用户把排序改成"按标题"时，**进入列表的仍是同一批 N 首**，只是显示顺序变化。这是三页共同的隐性契约。

**③ 投影复用「所有歌曲」**

三页都 `return p0.f3367`，与 `n0`（所有歌曲）同一个投影数组。
⇒ **三页都是 song 视图**，行是曲目，不是容器（对比专辑/艺术家/文件夹是 category 视图）。

---

## 3. 最近播放 `r3`

### 3.1 `r3.X0()` 原文【实证·产物】

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

### 3.2 还原

```sql
SELECT <p0.f3367>
FROM (
    SELECT * FROM folder_files
    WHERE [folder_files.cue_folder_id IS NULL AND]
          folder_files.played_fully_at > :recently_played_from
    ORDER BY folder_files.played_fully_at DESC
    LIMIT :recently_played_files_limit
) AS folder_files
  LEFT JOIN folders        ON folders._id = folder_id
  LEFT JOIN artists        ON artists._id = folder_files.artist_id
  LEFT JOIN albums         ON albums._id  = folder_files.album_id
  [LEFT JOIN album_artists ON album_artists._id = folder_files.album_artist_id]
ORDER BY <recently_played_files_sort>
```

### 3.3 限额

```java
public final int mo2437() {
    return Math.max(2, C0742.j0.f3810);      // recently_played_files_limit，下限 2
}
```

---

## 4. 最近添加 `q3`

### 4.1 `q3.X0()` 原文（差异部分）【实证·产物】

```java
StringBuilder sb2 = new StringBuilder("(SELECT * FROM folder_files");
if (C0742.f3414.f3789) {
    z = false;
} else {
    sb2.append(" WHERE folder_files.cue_folder_id IS NULL");
    z = true;
}
com.maxmpz.preference.fastprefs.z zVar = C0742.c1;
if (zVar.B > 0) {                                   // ★ 仅当窗口 > 0 才加条件
    sb2.append(z ? " AND " : " WHERE ");
    sb2.append("file_created_at>?");
    arrayList.add(String.valueOf(zVar.B));
}
sb2.append(" ORDER BY file_created_at DESC");        // ★ 按文件创建时间
...
i1Var.B = O(C0742.W.f3810);                         // recently_added_files_sort
```

### 4.2 还原

```sql
SELECT <p0.f3367>
FROM (
    SELECT * FROM folder_files
    WHERE [folder_files.cue_folder_id IS NULL AND]
          [file_created_at > :recently_added_from]   -- 仅当窗口值 > 0
    ORDER BY file_created_at DESC
    LIMIT :recently_added_files_limit
) AS folder_files
  LEFT JOIN ...（同 §3）
ORDER BY <recently_added_files_sort>
```

**要点**：窗口为 0 时**不加时间条件**，退化为"全库按文件创建时间倒序取前 N"。
这与最近播放不同（后者的条件恒加入）。

### 4.3 限额（G2 已闭环）

```java
@Override // com.maxmpz.audioplayer.rest.library.d2
/* JADX INFO: renamed from: с */
public final int mo2437() {
    return Math.max(2, C0742.i0.f3810);      // recently_added_files_limit，下限 2
}
```

与 `r3` / `h3` 完全同构：三页的限额都是 `max(2, 各自的 *_files_limit)`。

---

## 5. 最多播放 `h3`

### 5.1 `h3.X0()` 原文【实证·产物】

```java
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    String str2 = i1Var.f3334;
    if (str2 != null && str2.length() != 0) {
        throw new AssertionError(i1Var.f3334);      // ★ 禁止外部覆盖 projection
    }
    StringBuilder sb2 = new StringBuilder("(SELECT * FROM folder_files WHERE ");
    if (!C0742.f3414.f3789) {
        sb2.append("folder_files.cue_folder_id IS NULL AND ");
    }
    sb2.append("folder_files.played_times>0 AND folder_files.played_fully_at>");
    sb2.append(C0742.d1.B);                          // ★ 直接内联字面量，非绑定参数
    sb2.append(" ORDER BY folder_files.played_times DESC ");   // ★ 按播放次数
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
    // 过滤列数组：同 §3
    i1Var.B = O(d());                                // ★ 用实例方法 d()，不是直接读偏好
    return p0.f3367;
}
```

### 5.2 还原

```sql
SELECT <p0.f3367>
FROM (
    SELECT * FROM folder_files WHERE
      [folder_files.cue_folder_id IS NULL AND]
      folder_files.played_times > 0
      AND folder_files.played_fully_at > <most_played_ts_from 的字面量>
    ORDER BY folder_files.played_times DESC
    LIMIT :most_played_files_limit
) AS folder_files
  LEFT JOIN ...（同 §3）
ORDER BY <由 d() 提供的排序>
```

### 5.3 三处独有行为

| 行为 | 说明 |
| --- | --- |
| **双重筛选** | `played_times > 0`（确实播过）**且** `played_fully_at > 窗口`（在时间窗内播过） |
| **按次数排序** | `ORDER BY played_times DESC` —— 唯一按非时间维度排序的页 |
| **断言保护** | 若 `i1Var.f3334`（projection override）非空则 `throw new AssertionError` |

### 5.4 限额

```java
@Override // d2
public final int mo2437() {
    return Math.max(2, C0742.f0.f3810);      // most_played_files_limit，下限 2
}
```

### 5.5 排序维度被强制锁死（`d()` 实证，G3 已闭环）

`h3.X0` 的外层排序写作 `i1Var.B = O(d())`，其中：

```java
@Override // com.maxmpz.audioplayer.rest.library.p0, com.maxmpz.audioplayer.rest.library.m2
public final int d() {
    return (C0742.V.f3810 & 1073741824) | 6;
}
```

拆解：

| 步骤 | 作用 |
| --- | --- |
| `C0742.V.f3810` | 用户偏好 `most_played_files_sort` 的原始值 |
| `& 1073741824`（`0x40000000`） | **只保留 DESC 位**，丢弃所有排序维度位 |
| `\| 6` | **强制排序维度为模式 6** |

⇒ **「最多播放」页不允许用户更换排序维度**，只能是模式 6（按播放次数），用户唯一能控制的是**升序/降序**。

这个设计是自洽的：页面的内层 `ORDER BY played_times DESC` 已经按"最多播放"选出了集合，外层若允许改成"按标题"就会让页面名不副实——所以干脆锁死。

> 对照：`r3`/`q3` 直接把偏好原值传给 `O(...)`（`O(C0742.Y.f3810)` / `O(C0742.W.f3810)`），用户可自由换维度。

**代价**：`most_played_files_sort` 这个 int 偏好除了 DESC 位外，其余位的取值**被静默丢弃**。偏好的表达能力与实际用法不匹配。

---

## 6. 三页差异对照（核心）

| 维度 | 最近播放 `r3` | 最近添加 `q3` | 最多播放 `h3` |
| --- | --- | --- | --- |
| 时间列 | **`played_fully_at`** | **`file_created_at`** | `played_fully_at` |
| 内层排序 | `played_fully_at DESC` | `file_created_at DESC` | **`played_times DESC`** |
| 窗口偏好 | `b1` `recently_played_from` | `c1` `recently_added_from` | `d1` `most_played_ts_from` |
| 条数偏好 | `j0` `recently_played_files_limit` | `i0` `recently_added_files_limit` | `f0` `most_played_files_limit` |
| 排序偏好 | `Y` `recently_played_files_sort` | `W` `recently_added_files_sort` | `V` `most_played_files_sort`（**仅取 DESC 位，维度强制为模式 6**，§5.5）|
| 窗口应用 | **无条件**，绑定参数 | **仅当 > 0**，绑定参数 | **无条件**，**内联字面量** |
| 附加条件 | — | — | **`played_times > 0`** |
| projection 断言 | 无 | 无 | **有**（禁止覆盖）|
| 限额下限 | `max(2, recently_played_files_limit)` | `max(2, recently_added_files_limit)` | `max(2, most_played_files_limit)` |
| 窗口默认值 | **0**（long 偏好无默认参数，§9.5）| **0** | **0** |

### 6.1 同一概念的三种实现风格（实现不一致）

"时间窗口"这一件事，三页写法各异：

| 页 | 写法 | 风险 |
| --- | --- | --- |
| `r3` | `sb.append("...>? ")` + `arrayList.add(String.valueOf(j))` | 绑定参数，安全 |
| `q3` | 同上，但外面多包一层 `if (zVar.B > 0)` | 绑定参数，安全；语义额外多一条"0 = 不限" |
| `h3` | `sb.append(C0742.d1.B)` **直接拼字面量** | 值是 `long`，无注入风险，但**风格不一致**，且绕过了语句缓存 |

⇒ 这是**可维护性缺陷**，不是安全问题。应统一为绑定参数。

### 6.2 一个隐性语义

`h3` 的条件是 `played_times > 0 AND played_fully_at > 窗口`。
`played_times > 0` 与 `played_fully_at` 非空在语义上高度重叠——若 `played_fully_at` 只在"完整播放"时写入，则 `played_times > 0` 是冗余的。二者并存说明【推断】：`played_times` 可能在未达 `played_dur` 门槛时也会自增，因此需要额外用 `played_fully_at` 约束。

---

## 7. `played_at` vs `played_fully_at`：双时间戳

Poweramp 在 `folder_files` 上维护**两个**播放时间列：

| 列 | 语义 | 写入者 |
| --- | --- | --- |
| `played_at` | 最后一次**开始/结束播放** | `b0.mUpdatePlayedAtSt` |
| **`played_fully_at`** | 最后一次**完整播放**（达 `played_dur` 门槛） | `b0.mUpdateLastPosSt` / `mUpdatePlayedTimesAndLastPosSt`（§7.1 实证） |

### 7.1 写入路径（**SQL 原文实证，G1 已闭环**）

`b0` 有 5 个预编译语句。其中 3 个在 `initSql()` 中立即编译，另 2 个走**懒加载 getter**。

#### `b0.initSql()` 原文【实证·产物】

```java
private void initSql() {
    SQLiteDatabase writableDatabase = this.mContentProvider.getWritableDatabase();
    this.mDb = writableDatabase;
    this.mUpdatePlayedAtSt = writableDatabase.compileStatement(
        "UPDATE folder_files SET played_at=? WHERE _id=?");
    this.mUpdatePlayedTimesAndLastPosSt = writableDatabase.compileStatement(
        "UPDATE folder_files SET played_times=played_times+1, total_played_times=total_played_times+1, last_pos=?, played_fully_at=played_at WHERE _id=?");
    this.mRawFileSt = ...;
    this.mQueueUnplayedCountSt = writableDatabase.compileStatement(
        "SELECT COUNT(*) FROM queue INNER JOIN folder_files ON folder_files._id=queue.folder_file_id WHERE folder_files.played_at < queue.created_at");
    this.mTrackMetaProcessor = new s(this.mContext, this.mSafCtx);
}
```

#### 两个懒加载 getter 原文【实证·产物】

```java
public SQLiteStatement getUpdateLastPosSt() {
    if (this.mUpdateLastPosSt == null) {
        this.mUpdateLastPosSt = this.mContentProvider.getWritableDatabase().compileStatement(
            "UPDATE folder_files SET last_pos=?, played_fully_at=played_at WHERE _id=?");
    }
    return this.mUpdateLastPosSt;
}

public SQLiteStatement getUpdateLastPosNoPlayedFullyAtSt() {
    if (this.mUpdateLastPosNoPlayedFullyAtSt == null) {
        this.mUpdateLastPosNoPlayedFullyAtSt = this.mContentProvider.getWritableDatabase().compileStatement(
            "UPDATE folder_files SET last_pos=? WHERE _id=?");
    }
    return this.mUpdateLastPosNoPlayedFullyAtSt;
}
```

#### 四条语句对照

| 语句 | SQL | 触发语义 |
| --- | --- | --- |
| `mUpdatePlayedAtSt` | `SET played_at=?` | 记录"碰过" |
| **`mUpdatePlayedTimesAndLastPosSt`** | `SET played_times+1, total_played_times+1, last_pos=?, **played_fully_at=played_at**` | 计数 + 认定完整播放 |
| **`getUpdateLastPosSt`** | `SET last_pos=?, **played_fully_at=played_at**` | 仅认定完整播放（不加计数） |
| **`getUpdateLastPosNoPlayedFullyAtSt`** | `SET last_pos=?` | **不**认定完整播放 |

#### 核心结论：`played_fully_at` 是 `played_at` 的**快照拷贝**

三条认定语句里写的都是 `played_fully_at = played_at`，**而不是 `played_fully_at = 当前时间`**。

⇒ 系统只有**一个时钟写入点**（`mUpdatePlayedAtSt` 写 `played_at`），`played_fully_at` 只是把那一刻的值复制过来。
⇒ 两列永远不可能出现"`played_fully_at` 晚于 `played_at`"的矛盾状态。

`NoPlayedFullyAt` 这一对语句的存在，说明「是否认定完整播放」是**显式代码分支选不同 SQL**，而不是靠 SQL 表达式里的 CASE/IFNULL 兜底。这是一个清晰的设计。

#### 附带发现：队列未播计数

```sql
SELECT COUNT(*) FROM queue
INNER JOIN folder_files ON folder_files._id=queue.folder_file_id
WHERE folder_files.played_at < queue.created_at
```

⇒ "队列中未播条目数" = 曲目最后播放时间**早于**该条目入队时间的行数。
即：**入队之后再播过，就算已播**。这与 `queue` 表的 `created_at` 列配合，无需额外状态列。

### 7.2 虚拟条目被排除

`b0.updateTrackPlayedAtAsNeeded(g0)` 原文【实证·产物】：

```java
public void updateTrackPlayedAtAsNeeded(g0 g0Var) {
    if (g0Var.V.s1()) {
        return;                                   // ← 虚拟/CUE 条目直接跳过
    }
    SQLiteStatement st = this.mUpdatePlayedAtSt;
    if (st != null) {
        st.bindLong(1, System.currentTimeMillis());
        st.bindLong(2, g0Var.f2950);               // track id
        st.execute();
    }
}
```

⇒ 写 `played_at` 时排除虚拟条目。这与 §2.1 的 `cue_folder_id IS NULL` 过滤是同一立场：
**CUE 虚拟曲目不参与播放统计**。

---

## 8. 播放门槛：`played_dur`

`res/xml/library.xml` 原文【实证·原文】：

```xml
<com.maxmpz.audioplayer.preference.SeekbarPreference
    android:title="@string/pref_played_dur" android:key="played_dur"
    android:summary="@string/pref_summary_played_dur"
    android:defaultValue="50" w:max="100" w:min="0" />
```

文案：*"Count track as played after playing at least: %d%%"*

| 项 | 值 |
| --- | --- |
| 默认 | **50%** |
| 范围 | **0 – 100%** |
| 位置 | 设置 → 库 → 高级 |

这是整条链路的总闸门：**未达门槛 → 不写 `played_fully_at` → 不进入「最近播放」与「最多播放」**。

---

## 9. `C0742`：全局偏好中枢

所有 `C0742.X.f3789` / `.f3810` / `.B` 都是同一套「偏好对象 + 值字段」模式。

### 9.1 结构

`C0742` 有 **116 个静态字段**，全部为 `com.maxmpz.preference.fastprefs.*`：

| 偏好类 | 值字段 | 语义 |
| --- | --- | --- |
| `fastprefs.w` | `f3810` | int |
| `fastprefs.h0` | `f3789` | boolean |
| `fastprefs.z` | `B` | long |

⇒ 这一条解释了此前多份文档里 `C0742.X.f3789`（bool）/ `.f3810`（int）的命名规律。

### 9.2 三组派生列表偏好

| 页面 | 窗口（long） | 条数（int） | 排序（int） | 列表缩放 |
| --- | --- | --- | --- | --- |
| 最近播放 | `b1` `recently_played_from` | `j0` `recently_played_files_limit` | `Y` `recently_played_files_sort` | `R0` |
| 最近添加 | `c1` `recently_added_from` | `i0` `recently_added_files_limit` | `W` `recently_added_files_sort` | `Q0` |
| 最多播放 | `d1` `most_played_ts_from` | `f0` `most_played_files_limit` | `V` `most_played_files_sort` | `N0` |

**三组完全同构** —— 同一套「窗口 + 条数 + 排序 + 缩放」四参数模型。

### 9.3 交叉验证（4/4 通过）

| 字段 | 用法位置 | 提取到的键 | 吻合 |
| --- | --- | --- | --- |
| `l` | `n0.X0`（files 排序） | `files_sort` | ✓ |
| `t` | `t.X0`（artists 排序） | `artists_sort` | ✓ |
| `Q` | `d0.X0`（composers 排序） | `composers_sort` | ✓ |
| `Y` | `r3.X0`（最近播放排序） | `recently_played_files_sort` | ✓ |

并与 `library_lists.xml` 默认值一致（`use_albumartist`=false、`use_albumartist_albumartists`=true、`join_albums`=true、`root_hier_immediate`=false、`show_unsplit_cats`=false）。

### 9.4 提取方法学警示

`C0742` 存在仅靠**大小写**或**字符集**区分的字段：

| 字段 | 键 |
| --- | --- |
| `O` | `use_albumartist` |
| `o` | `use_albumartist_albumartists` |
| `о`（西里尔 о，U+043E） | `use_albumartist_albums` |
| `Q` | `composers_sort` |
| `q` | `folders_hier_files_sort` |

用 PowerShell `@{}`（**大小写不敏感**）提取会把 `Q`/`q` 合并，产出错误映射。必须用
`[System.Collections.Generic.Dictionary[string,string]]::new()`。

> 这条不是 Poweramp 的缺陷，而是**分析方法的坑**——记录下来避免后续重复踩。

### 9.5 偏好默认值：long 类型无默认参数（G5 已闭环）

`C0742.<clinit>` 中，不同偏好类型走**不同签名的工厂方法**：

| 类型 | 工厂调用（smali 实参） | 是否有默认值 |
| --- | --- | --- |
| int `fastprefs.w` | `invoke-virtual {v0, v3, v1}, m;->р(ILjava/lang/String;)L...w;` | **有** —— `v3` 是显式默认 int |
| long `fastprefs.z` | `invoke-static {v0, v1}, m;->O(Lcom/maxmpz/preference/fastprefs/m;Ljava/lang/String;)L...z;` | **无** —— 只有 (registry, key) 两个实参 |
| boolean `fastprefs.h0` | 另见 `(ZLjava/lang/String;)` 形态 | 有（boolean 默认） |

三个窗口偏好 `recently_played_from` / `recently_added_from` / `most_played_ts_from` **全部走 long 工厂**，因此：

> **三者的默认值都是 `0`。**

### 9.6 默认 0 的语义后果（关键）

| 页 | 条件写法 | 默认 0 时的实际行为 |
| --- | --- | --- |
| **最近播放** `r3` | `played_fully_at > ?` **恒加入** | `played_fully_at > 0` ⇒ **所有"曾经完整播放过"的曲目**，按时间倒序取前 N |
| **最近添加** `q3` | `if (c1.B > 0)` 才加入 | 窗口为 0 ⇒ **完全不筛时间** ⇒ 全库按 `file_created_at DESC` 取前 N |
| **最多播放** `h3` | `played_fully_at > <字面量>` **恒加入** | `played_fully_at > 0` + `played_times > 0` ⇒ **所有"曾完整播放过"的曲目**，按播放次数倒序取前 N |

⇒ **在默认配置下，"最近"并不含任何时间跨度限制**，只有条数限制。
三个 `*_from` 偏好是**可选的收窄条件**，用户不改就是"全部历史"。

这也解释了为什么在全部 `res/xml/*.xml` 里**搜不到这三个偏好**：它们不是设置页项，而是列表内的筛选状态。

---

## 10. 与 SpMusic 对照

### 10.1 SpMusic 现状

`src/features/player/model/mediaLibraryCategories.ts` 定义 12 个分类，含 `playlists` / `queue` 等。
**不存在**「最近播放 / 最近添加 / 最多播放」三个分类，也无对应的播放统计存储。

`playbackQueue.ts` 的 `PlaybackQueueOrigin` 只有 `'all-songs' | 'playlist'` 两种来源。

### 10.2 维度对照

| # | 维度 | Poweramp | SpMusic 现状 |
| --- | --- | --- | --- |
| 1 | 三个派生列表 | 三个独立实体，共用模板 | **无** |
| 2 | 数据来源 | 复用 `folder_files` 的时间列，无自有表 | 无 |
| 3 | 播放门槛 | `played_dur`（默认 50%，可调） | 无「算作播放」概念 |
| 4 | 双时间戳 | `played_at` / `played_fully_at` | 无 |
| 5 | 窗口/条数/排序 | 三组同构偏好，全可配置 | 无 |
| 6 | 双层排序 | 内层选集合，外层定显示 | 无 |
| 7 | LIMIT 位置 | **子查询内**（避免 JOIN 放大） | 无 |
| 8 | 视图类型 | song 视图（投影同「所有歌曲」） | — |

### 10.3 核心差异

Poweramp 把「最近播放」建模为**对既有曲目表的时间列筛选**，而不是一张独立的"播放历史"表。
⇒ **零额外存储成本**：只需 `folder_files` 上两列时间戳 + 两列计数。

SpMusic 若要实现，最小改动是给曲目元数据加 `played_at` / `played_fully_at` / `played_times` 三列，
在播放达到阈值时更新，然后复用现有的 all-songs 列表加筛选——**不需要新建历史表**。

---

## 11. 可借鉴 / 不建议照抄

### 11.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **派生列表不建自有表** | 复用曲目表的时间列，存储成本最低；避免"历史表与曲目表不同步"的一致性问题 |
| A2 | **`LIMIT` 放在子查询内** | 先截断再 JOIN，保证 `LIMIT N` 真的等于 N 首 |
| A3 | **双层排序** | 内层定"集合成员"，外层定"显示顺序"，语义清晰 |
| A4 | **`played_dur` 可调门槛（默认 50%）** | 「算作播放」的标准交给用户，比硬编码更合理 |
| A5 | **`played_at` 与 `played_fully_at` 分离** | 区分"碰过"与"听完"，让"最近播放"更有意义 |
| A6 | **投影复用「所有歌曲」** | 三页与 all-songs 返回同构数据，前端可共用渲染组件 |
| A7 | **虚拟条目排除写入** | `g0Var.V.s1()` 提前 return，避免 CUE 虚拟曲目污染统计 |
| A8 | **`played_fully_at = played_at` 快照式派生**（§7.1） | 只有**一个时钟写入点**（写 `played_at`），`played_fully_at` 是那一刻的拷贝。两列**永远不会出现"完整播放时间晚于最后播放时间"的矛盾状态**，也无需事务保证两列一致 |
| A9 | **用 `played_at < queue.created_at` 算未播数**（§7.1） | 不额外维护"已播"布尔列，靠时间戳比较推导；`queue.created_at` 已在表里，零额外存储 |

### 11.2 不建议照抄

| # | 做法 | 理由 |
| --- | --- | --- |
| N1 | **时间窗口的三种不一致写法**（绑定参数 / 条件绑定 / 内联字面量） | 同一概念三套实现，`h3` 还绕过语句缓存。应统一为绑定参数 |
| N2 | **`h3` 用 `throw new AssertionError` 拒绝 projection override** | 运行时抛异常来约束调用方，属于契约未前置到类型系统 |
| N3 | **`played_times > 0` 与 `played_fully_at` 语义重叠** | 若两者仍有必要，应写清区别；否则删除冗余条件 |
| N4 | **偏好字段名混淆**（`O`/`o`/`о`、`Q`/`q`） | 分析成本极高，易误读。自研时命名必须完全区分 |
| N5 | **`C0742` 116 个平铺静态偏好字段** | 无分组、无命名空间，检索困难。应按领域拆分 |

---

## 12. 未解

### 12.1 本轮已闭环（4 项）

| # | 原问题 | 结论 | 证据位置 |
| --- | --- | --- | --- |
| ~~G1~~ | `b0` 各 `mUpdate*St` 的 SQL | `played_fully_at = played_at`（快照拷贝），非当前时间 | §7.1 |
| ~~G2~~ | `q3.mo2437()` | `Math.max(2, C0742.i0.f3810)` | §4.3 更正 |
| ~~G3~~ | `h3.d()` | `(C0742.V.f3810 & 0x40000000) \| 6` —— 强制模式 6 | §5.5 |
| ~~G5~~（默认值部分）| 三个窗口偏好默认值 | **全部为 0**（long 工厂无默认参数） | §9.5 / §9.6 |

### 12.2 仍开放

| # | 问题 | 优先级 |
| --- | --- | --- |
| G4 | `C0742.f3413`–`f3418`（7 个 boolean）的绑定键 —— 存在于类摘要但不在 `<clinit>` 体内 | 中 |
| G6 | `g0Var.V.s1()` 的确切语义（推断为"虚拟/CUE 条目"判定） | 中 |
| G7 | `p0.O(int)` 的模式 6 具体映射为哪个 ORDER BY 表达式（`r3`/`q3`/`h3` 均继承） | 中 |
| **G8** | 三个 `*_from` 窗口偏好**由谁写入、何时写入** —— 默认 0 表示"不限"，但用户在 UI 上如何设置时间筛选未找到入口 | **中** |
| G9 | `mUpdateDurationSt` 的 SQL（唯一未读的预编译语句） | 低 |
| G10 | `p0.f3367` 投影数组与 `p0.x`/`y`/`X`/`f3368` 过滤数组的内容 | 中 |

> G5 的"默认值"部分已闭环；其"更新时机"部分转记为 **G8**。
> G1 的闭环使 §7 的写入机制从推断升级为实证，并顺带确认了 `played_fully_at` 与 `played_at` 的**派生关系**（后者是唯一时钟源）。

---

## 13. Evidence ID 索引

| 主题 | Evidence ID |
| --- | --- |
| `g1` 库门面（实体映射） | `ev_fefbb506fc94b86da675ec3a73b7d1aa6b3b31598f8615f20e1e2985fd94fc7b` |
| `r3` 类摘要 | `ev_dde1c7c78d006e939cd850031763d9e788e8a8cf54e5244c9f6c08abdc1f7b9e` |
| **`r3.X0`（最近播放 SQL）** | `ev_d830abe440a57b8df30d04a50ea7d79f4346af2519c64151d8bf623cfec24d59` |
| `r3.mo2437`（限额） | `ev_9f96cf80a63bf47977634ea51df1a861b9198dadaae099add0b1ba8161515839` |
| **`q3.X0`（最近添加 SQL）** | `ev_f0c45a19a733e79c85ebe21467b2d0b4602c4ab9aa7f288c529612b26477f177` |
| **`h3.X0`（最多播放 SQL）** | `ev_52798c423715873f6291f94a8e476c5d3038e997c727f74eef2ba33ced6cd9ed` |
| `h3.mo2437`（限额） | `ev_85eacab488b395c8dd39cc92c45ef8550236a28d37d60af9fc9d33339f6d9ea4` |
| `q3.mo2437`（限额，G2） | `ev_11f0eecbfa7d1f77fa54e743a24a0a9fe05e20718ad7ee73ffa7aaa4bd9fba11` |
| **`h3.d`（强制排序模式，G3）** | `ev_f3df9ecc8a1c4388159a6293d79f64d9ad92458c323e6180657f94eea2d2ac9b` |
| **`b0.initSql`（4 条语句，G1）** | `ev_fd42efda8d8e41a6f75d386450eb2791e97d07d28403f4c8834d16b4787d45a1` |
| **`b0.getUpdateLastPosSt`（G1）** | `ev_05fe2ece21da6a0fe29d1ace1ccb66764a2be7a01c6f154c9e0341ec462fb52d` |
| `b0.updateTrackPlayedAtAsNeeded` | `ev_d0b474c2b56135d2569818e53e19cf9d9af14fbabb2a9771c8fca35b2fa1b7c8` |
| `C0742` 类摘要（116 字段） | `ev_90ee531e61575a22aa66995833544192dbe7e62f9e6d758dff9beb7aa1d39fef` |
| `C0742.<clinit>` | `ev_0fe14e74dc505f456d7050484d28ee88d265d30f42a11f25f03d35465f41bb67` |

资源与偏好 XML 来源：`.rea-analysis/decoded/res/values/strings.xml`、`.rea-analysis/decoded/res/xml/library.xml`（apktool 3.0.3 解码，已入库）。
复现命令：
```
apktool d --no-src -f -o .rea-analysis/decoded .rea-analysis/Poweramp-v3.apk
```

---

## 14. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| `poweramp-entity-views.md` | 专辑/艺术家/专辑艺术家/作曲家。本文承接其 `X0` 钩子模型，只覆盖三个派生列表 |
| `poweramp-library-three-views.md` | 所有歌曲/文件夹/文件夹层次结构。本文的投影 `p0.f3367` 与其「所有歌曲」同源，仅交叉引用 |
| `poweramp-queue-runtime-reference.md` | 队列状态机。本文 §7 的写入路径在 `b0` 内，与其共用同一个队列管理器 |
| `poweramp-search-and-queue-impact.md` | 搜索。无重叠 |
| `poweramp-audio-settings-structure.md` | 音频设置。本文 `played_dur` 属库设置，非音频设置，无重叠 |
| `media-library-page-relationships.md` | SpMusic 三页面现状。本文 §10 只做对照 |
