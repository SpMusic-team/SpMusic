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

### 0.2 已知缺口

| # | 缺口 | 影响 |
| --- | --- | --- |
| G1 | `b0.initSql()` 中 `mUpdateLastPosSt` / `mUpdatePlayedTimesAndLastPosSt` 的**SQL 文本** | 无法确定 `played_fully_at` 的赋值条件（§7 的写入机制只能到字段命名级） |
| G2 | `q3.mo2437()` 方法体 | 其限额偏好是按同构推断 |
| G3 | `h3.d()` 方法体 | 最多播放的排序来源未确证 |
| G4 | `C0742.f3413`–`f3418`（7 个 boolean）的键 | `<clinit>` 体反编译截断 |

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

---

## 6. 三页差异对照（核心）

| 维度 | 最近播放 `r3` | 最近添加 `q3` | 最多播放 `h3` |
| --- | --- | --- | --- |
| 时间列 | **`played_fully_at`** | **`file_created_at`** | `played_fully_at` |
| 内层排序 | `played_fully_at DESC` | `file_created_at DESC` | **`played_times DESC`** |
| 窗口偏好 | `b1` `recently_played_from` | `c1` `recently_added_from` | `d1` `most_played_ts_from` |
| 条数偏好 | `j0` `recently_played_files_limit` | `i0` `recently_added_files_limit` | `f0` `most_played_files_limit` |
| 排序偏好 | `Y` `recently_played_files_sort` | `W` `recently_added_files_sort` | `V`（经 `d()`）|
| 窗口应用 | **无条件**，绑定参数 | **仅当 > 0**，绑定参数 | **无条件**，**内联字面量** |
| 附加条件 | — | — | **`played_times > 0`** |
| projection 断言 | 无 | 无 | **有**（禁止覆盖）|
| 限额下限 | `max(2, …)` | `max(2, …)`【推断，G2】 | `max(2, …)` |

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
| **`played_fully_at`** | 最后一次**完整播放**（达 `played_dur` 门槛） | 推断为 `b0.mUpdateLastPosSt`（G1） |

### 7.1 写入路径（`b0` 字段命名实证）

`b0`（队列管理器）持有 5 个预编译语句：

| 字段 | 推断职责 |
| --- | --- |
| `mUpdatePlayedAtSt` | 写 `played_at` |
| **`mUpdateLastPosSt`** | 写最后位置 **+ `played_fully_at`** |
| **`mUpdateLastPosNoPlayedFullyAtSt`** | 写最后位置，**不含** `played_fully_at` |
| `mUpdatePlayedTimesAndLastPosSt` | 写 `played_times` + 最后位置 |
| `mUpdateDurationSt` | 写时长 |

**`NoPlayedFullyAt` 这个命名本身是关键证据**：存在一个专门的"不写 `played_fully_at`"变体，说明「是否同时认定完整播放」是一个**显式代码分支**，而非靠 SQL 表达式兜底。

> G1：两个变体的 SQL 文本在 `b0.initSql()` 中构建，本轮未读取，故 §7.1 的职责划分是**按命名推断**。

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

| # | 问题 | 优先级 |
| --- | --- | --- |
| **G1** | `b0.initSql()` 中 `mUpdateLastPosSt` / `mUpdatePlayedTimesAndLastPosSt` 的 SQL 文本 —— `played_fully_at` 的确切赋值条件 | **高** |
| G2 | `q3.mo2437()` 方法体（推断为 `max(2, recently_added_files_limit)`） | 中 |
| G3 | `h3.d()` 方法体（是否返回 `C0742.V.f3810`） | 中 |
| G4 | `C0742.f3413`–`f3418`（7 个 boolean）的绑定键 | 中 |
| G5 | `C0742.b1.B` / `c1.B` / `d1.B` 的**默认值与更新时机** —— 是"上次打开该页的时间"还是"最近 N 天"？ | **高** |
| G6 | `g0Var.V.s1()` 的确切语义（推断为"虚拟/CUE 条目"） | 中 |
| G7 | `r3` / `q3` / `h3` 的 `O(int)` 排序映射（三者均未声明，继承自父类） | 中 |
| G8 | `p0.f3367` 投影数组与 `p0.x`/`y`/`X`/`f3368` 过滤数组的内容 | 中 |

G5 尤其关键：它决定「最近」到底是"最近一次打开页面以来"还是固定时间跨度。
G1 可把 §7 的写入机制从字段命名级提升到 SQL 级。

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
