---
doc_id: "ARCH-POWERAMP-RECENTS-VIEWS"
title: "Poweramp 派生列表参考（最近播放 / 最近添加 / 最多播放 / 长 / Top Rated / Low Rated）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-10-30"
updated: "2026-10-30"
source_documents:
  - "user request: 逆向 Poweramp 媒体库下「最近播放」「最近添加」「最多播放」「长」四页的组织与实现"
  - "shared task: task-13 / task-14"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009) :: SHA-256 4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0"
  - ".rea-analysis/findings-recents-views.md（本轮方法体原文 + 偏好键映射）"
  - ".rea-analysis/decoded/res/xml/library.xml（played_dur 门槛设置）"
  - ".rea-analysis/decoded/res/values/strings.xml（UI 文案）"
  - "docs/architecture/poweramp-entity-views.md（实体视图框架，本文承接其 X0 钩子模型）"
  - "docs/architecture/poweramp-queue-runtime-reference.md（b0 队列管理器，写入路径所在）"
  - "docs/architecture/media-library-page-relationships.md（SpMusic 侧对照）"
---

# Poweramp 派生列表参考（最近播放 / 最近添加 / 最多播放 / 长 / Top Rated / Low Rated）

## 0. 定位与证据分级

**本文记录外部实现 Poweramp 的派生列表页面，不是 SpMusic 现状。**

覆盖六页，分属**两种形态**：

| 形态 | 页面 | 结构特征 |
| --- | --- | --- |
| **Top-N 形态** | 最近播放 `r3` / 最近添加 `q3` / 最多播放 `h3` / Top Rated `e4` / Low Rated `e3` | 子查询内 `ORDER BY … LIMIT N` 截断，再 JOIN 富化，外层再排序（§2–§6、§15） |
| **筛选形态** | **长 `d3`** | 直接 JOIN + `duration >= 阈值`，**无子查询、无 LIMIT**（§14） |

两者共用同一实体框架（`AbstractC0743` 的 `X0` 钩子）、同一投影 `p0.f3367`、同一套 flag，以及**同一个排序映射 `p0.O(int)`**（§17）。

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

## 1. 实体映射

| UI 文案【实证·原文】 | 访问器 | 实体 | 方法数 | 形态 |
| --- | --- | --- | --- | --- |
| `recently_played` = "Recently Played" | `getRecentlyPlayed()` | **`r3`** | 31 | Top-N |
| `recently_added` = "Recently Added" | `getRecentlyAdded()` | **`q3`** | 29 | Top-N |
| `most_played` = "Most Played" | `getMostPlayed()` | **`h3`** | 31 | Top-N |
| `long_files` = "Long" | `getLong()` | **`d3`** | 24 | **筛选**（§14）|
| `top_rated` = "Top Rated" | `getTopRated()` | **`e4`** | 19 | Top-N（§15）|
| `low_rated` = "Low Rated" | `getLowRated()` | **`e3`** | 17 | Top-N（§15）|

四者均继承 `AbstractC0743`，实现 `X0(Uri, r, String, StringBuilder, ArrayList, i1)` 钩子——与专辑/艺术家/作曲家完全同一个实体框架。

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
**不存在**「最近播放 / 最近添加 / 最多播放 / 长 / Top Rated / Low Rated」六个分类，也无对应的播放统计或评分存储。

`playbackQueue.ts` 的 `PlaybackQueueOrigin` 只有 `'all-songs' | 'playlist'` 两种来源。

> 六个页面里，**「长」与两个评分页的实现成本最低**：
> - 「长」不需要新表、不需要新实体，本质只是「所有歌曲」加一个 `duration >= 阈值` 条件；
> - 两个评分页只需要曲目元数据上一个 `rating INTEGER 0–5` 列，配合 `> 1` / `= 1` 两个条件即可同时支撑星型与拇指两套 UI（§16.8）。

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
| ~~G7~~ | ~~`p0.O(int)` 排序映射~~ ✅ **已闭环**，见 §17（六页共用总表） | — |
| **G8** | 三个 `*_from` 窗口偏好**由谁写入、何时写入** —— 默认 0 表示"不限"，但用户在 UI 上如何设置时间筛选未找到入口 | **中** |
| G9 | `mUpdateDurationSt` 的 SQL（唯一未读的预编译语句） | 低 |
| G10 | `p0.f3367` 投影数组与 `p0.x`/`y`/`X`/`f3368` 过滤数组的内容 | 中 |
| **R1** | 拇指模式下 like/unlike 落到 `rating` 列哪些值（推断 5 / 1）—— 需追 MsgBus `mo2748` 的订阅方 | **中** |
| **R2** | `RatingBar.d(float, boolean)` 因 JADX 块合并而失真，2/3/4 星如何写入需 smali 复核 | **中** |
| R3 | Low Rated 子查询无 `ORDER BY` 是疏漏还是有意（静态证据无法区分） | 低 |

> G5 的"默认值"部分已闭环；其"更新时机"部分转记为 **G8**。
> G1 的闭环使 §7 的写入机制从推断升级为实证，并顺带确认了 `played_fully_at` 与 `played_at` 的**派生关系**（后者是唯一时钟源）。

---

## 13. Evidence ID 索引

| 主题 | Evidence ID |
| --- | --- |
| `g1` 库门面（实体映射） | `ev_fefbb506fc94b86da675ec3a73b7d1aa6b3b31598f8615f20e1e2985fd94fc7b` |
| **`e4.X0`（Top Rated SQL，类摘要 + 方法体一并返回）** | `ev_adee2652eac06d255e5c5c0e2e6055c61bc0086836701fd729e40c7a01d65449` |
| **`e3.X0`（Low Rated SQL，同上）** | `ev_3df5bec0faf6e496f8094fc37a9a719fe5d0f2ac16710358e9223a939fea5037` |
| `e4.mo2437`（top_rated_files_limit） | `ev_6f927d81b0a85cd5b7c075409ff9a9ed57b83362ad521978a6f7aa4b8a9299d8` |
| `e3.mo2437`（low_rated_files_limit） | `ev_edc936beecef02672ec8ebb5e6f904babc1337969e3db679ad08434328771ebc` |
| **`p0.O(int)`（排序映射总表，G7）** | `ev_1e2ad4fc55f8ecfe280c5a39e15f01d4b8a9ebb36614e813f6eda9b98db832da` |
| `RatingBar` 类摘要（34 方法 / 28 字段） | `ev_9aa08753783b12b5f8d2ff3cb65f98c0d5f68c9628a1f1bdaba44ac2011f7282` |
| **`RatingBar.onTouchEvent`（交互状态机）** | `ev_dcef6878849eabd257fb63b754115afd1253a7ef2201db459f103ecb58a92921` |
| **`RatingBar.d`（坐标→值，⚠️ JADX 警告）** | `ev_2f2ad374680a3d4905207bcf51d28ad4bf010e6b34f3ee3146c2fa7dd8c3ed4e` |
| **`RatingBar.performLongClick`（5↔0 切换）** | `ev_2812f13b95cef72a82f50c513be79aa2e18b2a0ff913ae82dbcf9b8d6a44b8c8` |
| **`RatingBar.e`（MsgBus 上报）** | `ev_169684f6953e351c49444175a51c729bdecb7e682286211d0bd5cc6d8645a07e` |
| `searched_android_classes "Rating"`（仅 2 类命中） | `ev_3ba50ce03b4fb15b4b06b6adb15d78149c4d01bbcb0a3b9aea034b9685f45359` |
| `r3` 类摘要 | `ev_dde1c7c78d006e939cd850031763d9e788e8a8cf54e5244c9f6c08abdc1f7b9e` |
| **`r3.X0`（最近播放 SQL）** | `ev_d830abe440a57b8df30d04a50ea7d79f4346af2519c64151d8bf623cfec24d59` |
| `r3.mo2437`（限额） | `ev_9f96cf80a63bf47977634ea51df1a861b9198dadaae099add0b1ba8161515839` |
| **`q3.X0`（最近添加 SQL）** | `ev_f0c45a19a733e79c85ebe21467b2d0b4602c4ab9aa7f288c529612b26477f177` |
| **`h3.X0`（最多播放 SQL）** | `ev_52798c423715873f6291f94a8e476c5d3038e997c727f74eef2ba33ced6cd9ed` |
| `h3.mo2437`（限额） | `ev_85eacab488b395c8dd39cc92c45ef8550236a28d37d60af9fc9d33339f6d9ea4` |
| `q3.mo2437`（限额，G2） | `ev_11f0eecbfa7d1f77fa54e743a24a0a9fe05e20718ad7ee73ffa7aaa4bd9fba11` |
| **`h3.d`（强制排序模式，G3）** | `ev_f3df9ecc8a1c4388159a6293d79f64d9ad92458c323e6180657f94eea2d2ac9b` |
| **`d3.X0`（长页 SQL，类摘要 + 方法体一并返回）** | `ev_e6e824ff4c326786ea1e9ad75a813adf67f0e1834d4ba4d8ed1cd1763a49724f` |
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

## 14. 「长」（Long）：第四种形态 —— 筛选视图

**实体**：`getLong()` → **`d3`**（24 方法 / 1 字段，继承 `AbstractC0743`）
**UI 文案**【实证·原文】：`long_files` = `"Long"`，筛选控件标签 `min_duration` = `"Min. Duration"`

### 14.1 `d3.X0()` 原文【实证·产物】

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    rVar.A = "folder_files INNER  JOIN folders ON folders._id=folder_id LEFT JOIN artists ON artists._id=folder_files.artist_id LEFT JOIN albums ON albums._id=folder_files.album_id"
        .concat(C0742.O.f3789
            ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
            : "");
    if (!C0742.f3414.f3789) {
        rVar.B("folder_files.cue_folder_id IS NULL");
        rVar.B(" AND ");
    }
    rVar.B("folder_files.duration");
    rVar.B(">=");
    rVar.B(String.valueOf(C0742.a1.f3810));      // 阈值直接拼字面量
    if (C0742.f1.f3789) {
        strArr = C0742.f3418.f3789 ? p0.y : p0.f3368;
    } else {
        strArr = C0742.f3418.f3789 ? p0.x : p0.X;
    }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(C0742.Z.f3810);                  // long_files_sort
    return p0.f3367;                              // 与「所有歌曲」同一投影
}
```

### 14.2 还原

```sql
SELECT <p0.f3367>
FROM folder_files
  INNER JOIN folders ON folders._id = folder_id
  LEFT  JOIN artists ON artists._id = folder_files.artist_id
  LEFT  JOIN albums  ON albums._id  = folder_files.album_id
  [LEFT JOIN album_artists ON album_artists._id = folder_files.album_artist_id]
WHERE [folder_files.cue_folder_id IS NULL AND]
      folder_files.duration >= :long_files_min_duration
  [AND <用户过滤>]
ORDER BY <long_files_sort>
```

### 14.3 与 Top-N 形态的结构差异（核心）

| 维度 | 最近播放 / 最近添加 / 最多播放 | **长** |
| --- | --- | --- |
| 结构 | `(SELECT … ORDER BY … LIMIT N) AS folder_files` 再 JOIN | **直接 JOIN，无子查询** |
| 结果规模 | 固定 N 条（`max(2, *_files_limit)`） | **全部匹配项** |
| 筛选依据 | 时间列 / 播放次数 | **`duration >= 阈值`** |
| 分页 | SQL 内 `LIMIT` 决定 | 由外层查询框架分页 |

⇒ 「长」不是 Top-N 列表，而是**整库的筛选视图**：更接近「所有歌曲」加一个 `duration` 条件。

**共同点**（说明同属一个框架）：返回 `p0.f3367` 投影（song 视图）、过滤列数组四选一（`C0742.f1` × `C0742.f3418`）、`O(...)` 外层排序、受 `C0742.f3414` 与 `C0742.O` 控制。

### 14.4 两个偏好

| 字段 | 偏好键 | 类型 | 用途 |
| --- | --- | --- | --- |
| `C0742.a1` | **`long_files_min_duration`** | `w`（int） | 时长阈值 |
| `C0742.Z` | **`long_files_sort`** | `w`（int） | 排序模式 |

> ⚠️ **大小写陷阱**：`C0742.Z`（大写）= `long_files_sort`；`C0742.z`（小写）= `album_artists_sort`。两者完全不同。

### 14.5 时长单位：**毫秒**（三条独立佐证）

| # | 证据 | 出处 |
| --- | --- | --- |
| 1 | 列索引映射 `2=duration (ms)`，该映射读的正是 `folder_files.duration` | `findings-format.md:147` |
| 2 | "`duration` via statement `e` (whole-file duration, **in ms**)" | `findings-format.md:464` |
| 3 | CUE 计算 `duration = endMs - startMs`，全程 ms 后写入 `folder_files.duration` | `findings-format.md:471` |

**并且 `d3.X0()` 里没有任何 `×1000` 换算**：

```java
rVar.B(String.valueOf(C0742.a1.f3810));   // 直接拼进 SQL
```

⇒ **`long_files_min_duration` 与 `folder_files.duration` 同为毫秒。**
⇒ 若照抄此设计，阈值必须用 ms；用秒会导致筛选结果整体错位约 1000 倍。

UI 上可能以秒展示（`pref_duration_below_s` = `"Less than (seconds): %s"` 证明有秒制格式化器），
但**存储与比较都是毫秒**，换算只发生在展示层。

### 14.6 默认值 0 的真实语义

`long_files_min_duration` **在 `res/xml/*.xml` 中没有任何条目**（不同于 `played_dur` 有 `android:defaultValue="50"`）。
而 `C0742.<clinit>` 中 **83 个 int 偏好全部复用同一寄存器 `v3`，且 `v3` 只被赋值一次 `const/4 v3, 0x0`**
⇒ 代码层默认值为 **0**。

初看 `duration >= 0` 等于"全部曲目"，但结合 CUE 处理中的哨兵可得到更合理的解释：

> `findings-format.md:471`：`duration = endMs - startMs`，**`only emitted when endMs != -1 && duration > 0`**
> ⇒ **`-1` 是"未知时长"的哨兵值。**

因此默认值 0 的实际语义【推断】是：**排除时长为负（未知）的曲目**，保留所有已知时长的曲目。
即便如此，"Long" 页在用户设定阈值前仍然近似等于全部已知时长曲目 —— 页面名与默认行为不匹配，属设计上的小瑕疵。

### 14.7 实现细节与不一致

| 现象 | 说明 |
| --- | --- |
| **阈值内联为字面量** | `String.valueOf(C0742.a1.f3810)` 直接拼进 WHERE 片段，非绑定参数。与 `h3` 同风格，与 `r3` 的绑定参数不同 —— 同一框架内**三种风格并存** |
| **`INNER JOIN folders`** | 曲目必须属于某个文件夹才出现；Top-N 形态用的是 `LEFT JOIN folders`（其行来自子查询，不能因 JOIN 丢失） |
| **`INNER  JOIN` 双空格** | 混淆产物残留 |
| **无 `mo2437()` 覆写** | `d3` 未覆写限额方法，证实无 LIMIT |

### 14.8 未解

| # | 问题 |
| --- | --- |
| L1 | `long_files_min_duration` 是否有运行时代码写入默认阈值（静态证据未找到） |
| L2 | ~~`duration` 单位~~ ✅ **已闭环：毫秒**（§14.5） |
| L3 | `d3.O(int)` 排序映射（继承自 `p0`），`long_files_sort` 可选模式未知 |
| L4 | "Min. Duration" 控件是否就是写 `long_files_min_duration` 的入口（文案存在，绑定关系未验证） |

---

## 15. Top Rated / Low Rated：两个评分页

| 页面 | UI 文案【实证·原文】 | 访问器 | 实体 | 方法数 |
| --- | --- | --- | --- | --- |
| 最高评分 | `top_rated` = `"Top Rated"` | `getTopRated()` | **`e4`** | 19 |
| 最低评分 | `low_rated` = `"Low Rated"` | `getLowRated()` | **`e3`** | 17 |

两者都是 Top-N 形态。

### 15.1 `e4.X0()` 原文【实证·产物】

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    String[] strArr;
    String str2 = i1Var.f3334;
    if (str2 != null && str2.length() != 0) {
        throw new AssertionError(i1Var.f3334);          // 禁止 projection override
    }
    StringBuilder sb2 = new StringBuilder("(SELECT * FROM folder_files WHERE ");
    if (!C0742.f3414.f3789) {
        sb2.append("folder_files.cue_folder_id IS NULL AND ");
    }
    sb2.append("rating>1 ORDER BY rating DESC ");       // ★ 阈值 + 内层排序
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
    if (C0742.f1.f3789) { strArr = C0742.f3418.f3789 ? p0.y : p0.f3368; }
    else { strArr = C0742.f3418.f3789 ? p0.x : p0.X; }
    androidx.appcompat.widget.n.m313(str, strArr, sb, arrayList);
    i1Var.B = O(5);                                     // ★ 排序模式硬编码
    return p0.f3367;
}
```

### 15.2 `e3.X0()` 原文（差异部分）【实证·产物】

```java
    // 同样的 assertion 守卫、同样的 JOIN、同样的四选一过滤列、同样的投影
    StringBuilder sb2 = new StringBuilder("(SELECT * FROM folder_files WHERE ");
    if (!C0742.f3414.f3789) {
        sb2.append("folder_files.cue_folder_id IS NULL AND ");
    }
    sb2.append("rating=1");                             // ★ 精确等于 1
    int iMo2437 = mo2437();
    if (iMo2437 != Integer.MAX_VALUE) {
        sb2.append(" LIMIT ");
        sb2.append(iMo2437);
    }
    // ★ 注意：没有 ORDER BY
    ...
    i1Var.B = O(1);                                     // ★ 排序模式硬编码为 1
```

### 15.3 还原

```sql
-- Top Rated
SELECT <p0.f3367> FROM (
    SELECT * FROM folder_files
    WHERE [folder_files.cue_folder_id IS NULL AND] rating > 1
    ORDER BY rating DESC
    LIMIT :top_rated_files_limit
) AS folder_files LEFT JOIN folders/artists/albums[/album_artists]
ORDER BY rating DESC, title_tag                 -- O(5)

-- Low Rated
SELECT <p0.f3367> FROM (
    SELECT * FROM folder_files
    WHERE [folder_files.cue_folder_id IS NULL AND] rating = 1
    LIMIT :low_rated_files_limit                -- ★ 无 ORDER BY
) AS folder_files LEFT JOIN folders/artists/albums[/album_artists]
ORDER BY title_tag COLLATE NOCASE               -- O(1)
```

### 15.4 核心：两者恰好互补

| 页面 | 条件 | 值域 |
| --- | --- | --- |
| Top Rated | `rating > 1` | 2 – 5 |
| Low Rated | `rating = 1` | 恰好 1 |
| （未评分） | `rating = 0` | 两页都不进 |

⇒ **不重叠，且合起来恰好覆盖所有"已评分"曲目（rating ≥ 1）。**

这是干净的设计：没有用 `rating <= 1` 或 `rating = 0`，否则"0 星既是最低分又是未评分"会产生歧义。**0 被保留为"未评分"哨兵。**

### 15.5 限额（各自独立偏好）

```java
// e4
@Override // d2 — JADX renamed from: с
public final int mo2437() { return Math.max(2, C0742.g0.f3810); }   // top_rated_files_limit
// e3
@Override // d2 — JADX renamed from: с
public final int mo2437() { return Math.max(2, C0742.h0.f3810); }   // low_rated_files_limit
```

### 15.6 Low Rated 的两个实现缺陷

**① 子查询内没有 `ORDER BY`**

`e3` 是 `WHERE rating=1` 后**直接 `LIMIT N`**。对比 `e4` 有 `ORDER BY rating DESC` 再 LIMIT。

⇒ `LIMIT` 截取的是**任意 N 条** rating=1 的曲目（实际取决于 SQLite 扫描顺序，通常为 rowid），**不是"最低的 N 条"**。

由于所有候选评分都是 1，"最低 N 条"本身也缺乏定义，但这意味着**集合成员不确定**。

**② 外层按标题排序**

`i1Var.B = O(1)` → 模式 1 = `title_tag`（见 §17）。

⇒ 该页显示顺序与评分**完全无关**。叠加 ①，"Low Rated" 实际呈现的是：
> 「评分 = 1 的曲目里，某 N 条，按标题排序」

**无法从静态证据区分这是有意设计还是疏漏**，记为观察项。

### 15.7 与其它 Top-N 页对照

| 页面 | 内层 `ORDER BY` | 外层排序来源 |
| --- | --- | --- |
| 最近播放 `r3` | `played_fully_at DESC` | 偏好 `Y` `recently_played_files_sort`（全值）|
| 最近添加 `q3` | `file_created_at DESC` | 偏好 `W` `recently_added_files_sort`（全值）|
| 最多播放 `h3` | `played_times DESC` | 偏好 `V` **仅取 DESC 位** + 强制模式 6 |
| **Top Rated `e4`** | `rating DESC` | **`O(5)` 完全硬编码** |
| **Low Rated `e3`** | **无** | **`O(1)` 完全硬编码** |

⇒ 评分两页**完全不读排序偏好**，用户无法更改排序。这是比「最多播放」（至少可切升降序）更严格的锁定。

---

## 16. 评分模型与拇指模式

### 16.1 `rating_type`：四档显示模式

`res/xml/ui_player.xml` 原文【实证·原文】：

```xml
<com.maxmpz.audioplayer.preference.TagListPreference
    android:title="@string/pref_rating_type" android:key="rating_type"
    android:defaultValue="1" w:entries="@array/pref_rating_type_entries" />
```

`pref_rating_type_entries` = **`["Disabled", "Like/Unlike (thumbs)", "5 stars", "5 stars (menu/lists only)"]`**

| 值 | 模式 |
| --- | --- |
| 0 | Disabled（关闭评分） |
| **1** | **Like/Unlike（拇指）— 默认** |
| 2 | 5 stars |
| 3 | 5 stars（仅菜单/列表） |

`rating_type` **不在 `C0742`**（库偏好中枢）中，属 UI 偏好命名空间。

### 16.2 值域：0 – 5 整数

三条独立佐证：

| 证据 | 出处 |
| --- | --- |
| `d()` 中 `if (i < 0) i4 = 0; else if (i <= 5) i4 = i;`（超出保持 5） | `RatingBar.d` |
| 长按在 `5` 与 `0` 之间切换 | `RatingBar.performLongClick` |
| 提示文案 "Swipe over stars… Long press to toggle between **5 or 0 stars**" | `pref_rating_type_5stars_hint` |

`pref_rating_type_5stars_hint` 全文：
> *"Swipe over stars to select rating. Touch an empty space where star should be placed for immediate rating. Long press to toggle between 5 or 0 stars"*

### 16.3 核心结论：`RatingBar` 完全不知道 `rating_type` 的存在

`com.maxmpz.widget.base.RatingBar`（34 方法 / 28 字段）是**评分类型无关的通用控件**，只产出一个 **0–5 整数**。

其变更通知原文【实证·产物】：

```java
public final void e() {
    com.maxmpz.widget.list.e1 e1Var = (com.maxmpz.widget.list.e1)
        AUtils.O(this, com.maxmpz.widget.list.e1.class, null);
    if (e1Var != null) {
        long jMo2940 = ((AAItemView) e1Var).D.mo2940();       // 当前行的 track id
        if (jMo2940 != 0) {
            MsgBusHelper.fromContextOrThrow(getContext(), this.p)
                .mo2748(this, this.f3943, this.O, 0, Long.valueOf(jMo2940));
        }
    }
}
```

`this.O` 原样传出，**无任何 like/star 转换**。

⇒ **拇指模式不是控件模式，而是"显示 + 解释"层。** 星型与拇指共用同一列、同一值域，只是画不同图标、读的时候按不同语义解释。

这也与 `h_main_rating` 文案一致：*"Rating can be switched to `<star>` / `<like>`"* —— 是**图标切换**，不是数据模型切换。

### 16.4 交互状态机（`onTouchEvent`，无 JADX 警告）

字段角色：

| 字段 | 作用 |
| --- | --- |
| `O` | 当前评分（0–5） |
| `i` | 按下瞬间的快照值（用于变更检测） |
| `g` | 手势状态：`0` 空闲 / `1` 按下 / `2` 拖拽 / `3` 长按 |
| `h` | 按下时的 X 坐标 |
| `f3945` | 单个图标宽度（px） |
| `m` | **布局模式**：`1` 居中 5 星 / `5` 反向 / 其他 = 左对齐逐个 |
| `f3943` | 随消息传出（疑似 surface/类型标识） |
| `p` | MsgBus tag |

```java
ACTION_DOWN → this.n = <PowerList>; 请求父级不拦截
              记录 this.h = x, this.g = 1, this.i = this.O（快照）, i(5)
              启动按压动画（R.id.anim_ratingbar_pressed, 0.45f）
ACTION_MOVE → 若 g == 1 且 |x - h| > touchSlop * 2 → g = 2, cancelLongPress()
              若 g == 2 → d(x, true)     连续拖拽调值
ACTION_UP   → 若 g == 1 → d(x, false)   单击定值
              若 i != O → e()           发出变更
              g = 0，恢复 i(max(1, O))
```

**触摸滑动阈值用 `touchSlop × 2`**（比系统默认更保守），轻点不易被误判为拖拽。

### 16.5 长按 = 5 ↔ 0 切换（`performLongClick`，无 JADX 警告）

```java
@Override
public final boolean performLongClick() {
    if (this.O == 5) {
        this.O = 0;
    } else {
        this.O = 5;
    }
    invalidate();
    androidx.core.view.j.m654(this, 0);
    this.g = 3;
    super.setPressed(false);
    i(Math.max(1, this.O));
    ...
    return super.performLongClick();
}
```

与提示文案完全对应。这段同时证明**值域上限是 5**。

### 16.6 坐标 → 值换算（`d(float, boolean)`）—— ⚠️ 反编译不可靠

三种布局模式分别换算，然后硬夹到 0–5：

```java
if (this.f3945 > 0) {                                 // f3945 = 单图标宽度
    int paddingLeft = (int) ((f - getPaddingLeft()) + 0.5f);
    int i2 = this.m;                                  // 布局模式
    int i3 = 0;
    int i4 = 5;
    if (i2 == 1) {                                    // 居中 5 星
        float width = ((getWidth() - getPaddingLeft()) - getPaddingRight()) / 2.0f;
        int i5 = this.f3945;
        float f2 = width - ((i5 * 5) / 2.0f);         // 5 星组左边界
        float f3 = paddingLeft;
        int iCeil = (int) Math.ceil((f3 - f2) / i5);
        z2 = f3 > f2 && f3 < (((float) this.f3945) / 2.0f) + f2;
        i = iCeil;
    } else if (i2 != 5) {                             // 左对齐逐个
        int i6 = this.f3945;
        i = (paddingLeft / i6) + 1;
        z2 = paddingLeft < i6 / 2;
    } else {                                          // m == 5 反向（右→左）
        int i7 = this.f3945;
        i = 5 - (paddingLeft / i7);
        z2 = paddingLeft > (i7 * 5) - (i7 / 2);
    }
    if (i < 0) { i4 = 0; }
    else if (i <= 5) { i4 = i; }                      // 否则 i4 保持 5
    ...
}
```

> ⚠️ **该方法带两条 JADX `block merged / PHI` 警告**，最终 `i3` 的赋值被折叠成
> `i3 = z ? i4 : i4;`（三元两边相同），明显失真。
> **2/3/4 星如何写入 `i3` 这一段不可靠**，需 SMLALI 复核才能定论。
> 可确认的只有：值域夹 0–5、三种布局分支、"刻意的最低分是 1"这一特殊分支：

```java
if (i4 == 0 && !z /* 单击而非拖拽 */ && this.O == 0) {
    i3 = 1;                                           // 在"0"位置单击且当前已是 0 → 抬到 1
}
```

### 16.7 like / unlike 落到哪些值【推断，未实证】

控件不区分评分类型，所以只能由消费侧映射。目前最强的支持是**两条 SQL 恰好把 0–5 切成两段**：

| 页面 | 条件 | 若 like→5 / unlike→1 |
| --- | --- | --- |
| Top Rated | `rating > 1` | 恰为「点过赞」 |
| Low Rated | `rating = 1` | 恰为「踩过」 |
| 未评分 | `rating = 0` | 两页都不进 |

结合 `rating_type` 是图标切换而非数据模型切换，这套解释自洽。

**但决定性证据在 MsgBus 消息 `mo2748(...)` 的订阅方（真正写 `rating` 列的地方），本轮未追。**

### 16.8 可借鉴 / 不建议照抄

**值得借鉴**：

| # | 做法 | 理由 |
| --- | --- | --- |
| R-A1 | **一个 0–5 列同时支撑星型与拇指两套 UI** | 零额外存储；派生列表用 `> 1` / `= 1` 两个条件即可同时适配 |
| R-A2 | **`0` 保留为"未评分"哨兵** | 避免"0 星既是最低分又是未评分"的歧义 |
| R-A3 | **长按 5↔0 快速切换** | 单手操作效率高，配合提示文案可发现 |
| R-A4 | **`touchSlop × 2` 才转拖拽** | 列表内嵌控件，避免点击被误判为滑动 |

**不建议照抄**：

| # | 做法 | 理由 |
| --- | --- | --- |
| R-N1 | **把值补偿逻辑混在 View 里**（`i4==0 && !z && O==0 → 1`） | 与触摸状态机耦合，且已复杂到让反编译失真。应把"坐标→离散值"抽成纯函数 |
| R-N2 | **变更通过 MsgBus 全局消息上报**（`mo2748`） | 隐式耦合，调用方难以静态追踪（本轮即因此无法确证 like 映射） |
| R-N3 | **评分两页完全不读排序偏好** | 用户无法改排序；若是有意为之应写清，否则是缺失 |

---

## 17. 排序映射总表：`p0.O(int)`（六页共用）

此前多轮未解的"排序模式编号含义"已完全还原。该方法定义在 `com.maxmpz.audioplayer.rest.library.p0`，被所有 song 视图列表共用。

### 17.1 原文【实证·产物】

```java
public String O(int i) {
    boolean z = (1073741824 & i) != 0;          // 0x40000000 = DESC 位
    switch (i & (-1073741825)) {                // 清除 DESC 位
        case 0:  return !z ? "track_number, title_tag COLLATE NOCASE"
                           : "track_number DESC, title_tag COLLATE NOCASE DESC";
        case 1:  return !z ? "title_tag COLLATE NOCASE"
                           : "title_tag COLLATE NOCASE DESC";
        case 2:  return !z ? "folder_files.name COLLATE NOCASE"
                           : "folder_files.name COLLATE NOCASE DESC";
        case 3:  return !z ? "folder_files.year, title_tag"
                           : "folder_files.year DESC, title_tag";
        case 4:  return !z ? "file_created_at DESC, title_tag"
                           : "file_created_at, title_tag";
        case 5:  return !z ? "rating DESC, title_tag"
                           : "rating, title_tag";
        case 6:  return !z ? "folder_files.played_times DESC, title_tag"
                           : "folder_files.played_times, title_tag";
        case 7:  return !z ? "folder_files.played_fully_at DESC, title_tag"
                           : "folder_files.played_fully_at, title_tag";
        case 8:  /* artist + album，含 C0742.O / C0742.f3413 三档降级 */;
        case 9:  /* album + track_number */;
        case 10: return !z ? "folder_files.duration DESC, title_tag COLLATE NOCASE"
                           : "folder_files.duration, title_tag COLLATE NOCASE DESC";
        case 11: return !z ? "folder_files.shuffle_order"
                           : "folder_files.shuffle_order DESC";
        case 12: return !z ? "folder_files.created_at DESC, title_tag"
                           : "folder_files.created_at, title_tag";
        case 13: /* disc, track_number */;
        case 14: /* rtrim(path,'/'), folder_files.name */;
        case 15: /* folder_files.year + album + track_number */;
        default: return !z ? "track_number, title_tag COLLATE NOCASE"
                           : "track_number DESC, title_tag COLLATE NOCASE DESC";
    }
}
```

### 17.2 模式对照

| 模式 | 未置 DESC 位时 | 语义 |
| --- | --- | --- |
| 0 | `track_number, title_tag` | 音轨号（默认） |
| 1 | `title_tag` | **标题** ← Low Rated `e3` |
| 2 | `folder_files.name` | 文件名 |
| 3 | `folder_files.year, title_tag` | 年份 |
| 4 | `file_created_at DESC, title_tag` | 添加时间（**默认降序**） |
| 5 | `rating DESC, title_tag` | **评分（默认降序）** ← Top Rated `e4` |
| 6 | `played_times DESC, title_tag` | **播放次数（默认降序）** ← 最多播放 `h3` |
| 7 | `played_fully_at DESC, title_tag` | **最近播放时间（默认降序）** |
| 8 | artist + album | 艺术家 / 专辑 |
| 9 | album + track_number | 专辑内音轨号 |
| 10 | `duration DESC, title_tag` | 时长（**默认降序**） |
| 11 | `shuffle_order` | 随机序 |
| 12 | `created_at DESC, title_tag` | 创建时间（**默认降序**） |
| 13 | `disc, track_number` | 碟号 + 音轨号 |
| 14 | `rtrim(path,'/'), folder_files.name` | 路径 |
| 15 | `year, album, track_number, title_tag` | 年份 + 专辑 |
| default | 同模式 0 | 音轨号 |

### 17.3 DESC 位的反直觉语义

`0x40000000` **不是简单的"反转"**，而是"切换到另一个方向"。

模式 **4 / 5 / 6 / 7 / 10 / 12 的默认方向本身就是降序**，所以置上 DESC 位反而是把结果变成**升序**。

⇒ 若自研时把 DESC 位理解为"降序开关"，这六个模式的默认行为会正好相反。

### 17.4 各页如何使用

| 页面 | 传入 `O(...)` 的参数 | 用户可否改排序 |
| --- | --- | --- |
| 最近播放 `r3` | `C0742.Y.f3810`（偏好全值） | 可 |
| 最近添加 `q3` | `C0742.W.f3810`（偏好全值） | 可 |
| 最多播放 `h3` | `(C0742.V.f3810 & 0x40000000) \| 6` | **仅升降序** |
| Top Rated `e4` | `5` | **不可** |
| Low Rated `e3` | `1` | **不可** |
| 长 `d3` | `C0742.Z.f3810`（偏好全值） | 可 |

---

## 18. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| `poweramp-entity-views.md` | 专辑/艺术家/专辑艺术家/作曲家。本文承接其 `X0` 钩子模型，覆盖六个派生/筛选列表：最近播放/最近添加/最多播放（§2–§6）、长（§14）、Top Rated/Low Rated（§15），以及评分模型（§16）与共用排序映射（§17） |
| `poweramp-library-three-views.md` | 所有歌曲/文件夹/文件夹层次结构。本文的投影 `p0.f3367` 与其「所有歌曲」同源，仅交叉引用 |
| `poweramp-queue-runtime-reference.md` | 队列状态机。本文 §7 的写入路径在 `b0` 内，与其共用同一个队列管理器 |
| `poweramp-search-and-queue-impact.md` | 搜索。无重叠 |
| `poweramp-audio-settings-structure.md` | 音频设置。本文 `played_dur` 属库设置，非音频设置，无重叠 |
| `media-library-page-relationships.md` | SpMusic 三页面现状。本文 §10 只做对照 |
