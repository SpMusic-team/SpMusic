---
doc_id: "ARCH-POWERAMP-STREAMS-VIEW"
title: "Poweramp 流参考（file_type 过滤视图）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-03"
updated: "2026-11-03"
source_documents:
  - "user request: 逆向 Poweramp 媒体库下「流」页的实现与组织"
  - "shared task: task-18"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009) :: SHA-256 4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0"
  - ".rea-analysis/findings-streams-view.md（本轮方法体原文）"
  - ".rea-analysis/decoded/res/values/strings.xml（UI 文案）"
  - ".rea-analysis/decoded/res/values/public.xml（R.attr / R.string ID）"
  - "docs/architecture/poweramp-recents-views.md（派生列表 + p0 投影体系）"
  - "docs/architecture/poweramp-bookmarks-view.md（同为 song 视图的自有过滤）"
  - "docs/architecture/media-library-page-relationships.md（SpMusic 侧对照）"
---

# Poweramp 流参考（file_type 过滤视图）

## 0. 定位与证据分级

**本文记录外部实现 Poweramp 的「流」页面，不是 SpMusic 现状。**

| 标记 | 含义 | 可信度 |
| --- | --- | --- |
| **【实证·产物】** | JADX 反编译方法体原文 | 最高 |
| **【实证·smali】** | 反编译降级时的 smali 原文 | 最高 |
| **【实证·原文】** | APK 资源字符串 / public.xml 原文 | 高 |
| **【推断】** | 本文作者推理 | 低 |

### 0.1 核心结论（先看）

**「流」不是独立实体表，而是 `folder_files` 上一个 `file_type = 23` 的过滤视图。**

| 特征 | 流 | 其它页面 |
| --- | --- | --- |
| 数据来源 | **`folder_files` + `file_type = 23`** | 独立表 / 分类表 / 子查询 |
| 查询写法 | **全库最短 `X0`（4 行）** | 十几到几十行 |
| 构建逻辑 | **完全委托 `h1.o(...)`** | 各自拼装 |
| 排序 | **自有 `O(int)`，仅 6 模式**（全库最少） | 3–16 模式 |
| 投影 | **`p0.f3367`（标准 song 投影）** | 多样 |
| 过滤列 | **自有 3 列**（`title_tag` / `name_without_number` / `album_tag`） | 4 组共用 |

**`file_type = 23` 是流的唯一标识。** 该值在扫描器 INSERT 语句中硬编码（§3.2）。

### 0.2 已知缺口

| # | 缺口 | 影响 |
| --- | --- | --- |
| **S1** | `file_type` 完整枚举（23 只是其中一个值） | 无法列出所有文件类型；但**不影响流页理解** |
| S2 | `h1.o()` 两个布尔参数的语义（`z` / `z2`） | `z` 已实证为 JOIN 类型开关，`z2` 推断为「是否需要前置 AND」 |
| S3 | `stream_files` 这个表名（`i()` 返回值）是否为 VIEW | 见 §5 |
| S4 | `cat_stats.type = 60` 的具体统计含义 | 与年份 340、流派 210 同族 |

---

## 1. 实体映射

| UI 文案【实证·原文】 | 访问器 | 实体 | 方法数 |
| --- | --- | --- | --- |
| `streams` = "Streams" | `getStreamFiles()` | **`d4`** | 36 |
| `stream` = "Stream" | （单数形式，用于行内） | — | — |

`d4` 字段：`H: String[]`（过滤列）、`f3301: e`。

### 1.1 相关 UI 文案全量

```
streams                  = "Streams"
stream                   = "Stream"
stream_name_in_title     = "Stream Name In Title"
summary_stream_name_in_title = "Use \"Stream - Track Title\" pattern for stream titles,
                                instead of just \"Track Title\"."
pref_aa_per_stream_track = "Prefer Track Cover for Streams"
pref_summary_aa_per_stream_track = "Show album art based on stream track title/artist
                                    instead of the stream name"
pref_stream_buffer       = "Network Stream Buffer"
pref_stream_timeout      = "Network Stream Timeout"
cast_stop_live_stream    = "Stop live stream"
```

**两个与流相关的设置**：

| key | 文案 | 作用 |
| --- | --- | --- |
| `stream_name_in_title` | Stream Name In Title | 标题格式 `Stream - Track Title` vs `Track Title` |
| `aa_per_stream_track` | Prefer Track Cover for Streams | 封面用 track 元数据还是流名称 |

这两个设置解释了流与普通曲目的**显示差异**：流的标题和封面来源不同。

### 1.2 相关 R 资源

```
attr/streams       0x7f01057a     ← d4.s()
attr/micro_streams 0x7f01057c     ← d4.Z()
attr/stream_24dp   0x7f01065b
id/state_player_track_is_stream  0x7f01070d   ← 播放态里「当前是流」标志
string/streams     0x7f080880
```

`state_player_track_is_stream` 的存在说明：**「是否为流」是曲目的一个运行时属性**，不只用于列表分区。

---

## 2. 列表查询（`d4.X0()`）—— 全库最短

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.B("file_type");
    rVar.B("=");
    rVar.B("23");
    h1.o(rVar, sb, O(C0742.e0.f3810), i1Var, str, arrayList, H, true, true);
    return p0.f3367;
}
```

### 2.1 只有四步

| 步 | 动作 |
| --- | --- |
| 1 | 塞入唯一条件 `file_type = 23` |
| 2 | 委托 `h1.o(...)` 完成 FROM/JOIN/其余 WHERE/排序 |
| 3 | 传自有过滤列 `H` |
| 4 | 返回标准 song 投影 `p0.f3367` |

**对比**：最近播放 `r3` 的 `X0` 有约 25 行、书签 `a0` 约 15 行、流派 `z0` 约 12 行。流是**唯一把主体逻辑完全外推**的页面。

---

## 3. `file_type = 23`：流的唯一标识

### 3.1 查询侧（`d4` 两处）

```java
// X0() —— 流向列表
rVar.B("file_type"); rVar.B("="); rVar.B("23");

// t0() —— 流 + 播放列表条目（见 §4）
rVar.B("file_type"); rVar.B("="); rVar.B("23");
rVar.B(" AND "); rVar.B("folder_files.cue_folder_id IS NULL");
```

### 3.2 写入侧（扫描器硬编码）【实证·smali】

```sql
-- scanner/х.smali:199
INSERT INTO folder_files
  (name, title_tag, name_without_number, artist_tag, album_tag, track_number,
   tag_status, track_tag, track_number_alt, duration, updated_at, file_type,
   file_created_at, created_at, meta, rating, user_added)
VALUES (?, ?, ?, ?, ?, 0, 1, 0, 0, 0, ?, 23, ?, ?, ?, ?, ?)
--                                              ↑ file_type 直接写 23
```

```sql
-- scanner/х.smali:210
SELECT IFNULL((SELECT _id FROM folder_files WHERE file_type=23 AND name=? COLLATE NOCASE), 0) AS _id
```

⇒ **流不是通过路径/URL 特征识别的，而是在扫描时被标记为 `file_type=23`。**

### 3.3 排除侧：`file_type != 23`

`scanner/library/K.smali` 在多处统计 SQL 中**排除流**：

```sql
-- L757
AND folder_files.album_id!=1000 AND folder_files.artist_id!=1000
AND folder_files.file_type!=23 AND +folder_files.tag_status=1

-- L785
AND +folder_files.tag_status=1 AND folder_files.file_type!=23
AND folder_files.artist_id!=1000

-- L813
AND +tag_status=1 AND file_type!=23 AND album_id!=1000 AND artist_id!=1000

-- L841
AND file_type!=23 AND artist_id!=1000 AND +tag_status=1
```

⇒ **流不参与专辑/艺术家的 `num_files` 统计**。这是设计上的隔离：
流没有可靠的 album/artist 归属，若混入统计会让专辑/艺术家页出现「只有 1 首流」的假条目。

### 3.4 `file_type` 的其他值

`file_type` 由原生层 `FFMpegTagReader.native_scan_file_type(String, int, int)` 返回，写入 `TagAndMeta.scannedFileType`。

**S1 未解**：完整枚举在原生库与扫描器代码中，本轮未枚举。但**23 = 流**这一点已被两侧（查询 + 写入）双向证实。

---

## 4. 第二个变体：`d4.t0()` —— 流 + 播放列表条目

`d4` 除了 `X0()` 还有 `t0()`，签名带额外参数：

```java
public final String[] t0(Uri uri, r rVar, String[] strArr, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var,
                         int i, com.maxmpz.audioplayer.data.api.К к)
```

### 4.1 原文（smali）

```smali
.method public final t0(Landroid/net/Uri;Lcom/maxmpz/audioplayer/player/r;[Ljava/lang/String;Ljava/lang/String;Ljava/lang/StringBuilder;Ljava/util/ArrayList;Lcom/maxmpz/audioplayer/rest/library/i1;ILcom/maxmpz/audioplayer/data/api/К;)[Ljava/lang/String;
    .locals 0

    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/у;->O:Lcom/maxmpz/preference/fastprefs/h0;
    iget-boolean p1, p1, Lcom/maxmpz/preference/fastprefs/H;->А:Z
    if-eqz p1, :cond_0
    const-string p1, " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
    goto :goto_0
    :cond_0
    const-string p1, ""
    :goto_0
    const-string p8, "folder_files LEFT  JOIN folders ON folders._id=folder_id LEFT JOIN artists ON artists._id=folder_files.artist_id LEFT JOIN albums ON albums._id=folder_files.album_id LEFT JOIN playlist_entries ON playlist_entries.folder_file_id=folder_files._id "
    invoke-virtual {p8, p1}, Ljava/lang/String;->concat(Ljava/lang/String;)Ljava/lang/String;
    move-result-object p1
    iput-object p1, p2, Lcom/maxmpz/audioplayer/player/r;->A:Ljava/lang/Object;

    const-string p1, "file_type"
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V
    const-string p1, "="
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V
    const-string p1, "23"
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V
    const-string p1, " AND "
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V
    const-string p1, "folder_files.cue_folder_id IS NULL"
    invoke-virtual {p2, p1}, Lcom/maxmpz/audioplayer/player/r;->B(Ljava/lang/String;)V

    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/d4;->H:[Ljava/lang/String;
    invoke-static {p4, p1, p5, p6}, Landroidx/appcompat/widget/n;->В(Ljava/lang/CharSequence;[Ljava/lang/String;Ljava/lang/StringBuilder;Ljava/util/ArrayList;)V

    const-string p1, "folder_files._id"
    iput-object p1, p7, Lcom/maxmpz/audioplayer/rest/library/i1;->В:Ljava/lang/String;

    sget-object p1, Lcom/maxmpz/audioplayer/rest/library/у;->e0:Lcom/maxmpz/preference/fastprefs/w;
    iget p1, p1, Lcom/maxmpz/preference/fastprefs/s;->А:I
    invoke-virtual {p0, p1}, Lcom/maxmpz/audioplayer/rest/library/d4;->O(I)Ljava/lang/String;
    move-result-object p1
    iput-object p1, p7, Lcom/maxmpz/audioplayer/rest/library/i1;->B:Ljava/lang/String;

    const-string p1, "playlist_id"
    const-string p2, "playlist_entries._id AS playlist_entry_id"
    filled-new-array {p1, p2}, [Ljava/lang/String;
    move-result-object p1
    invoke-static {p3, p1}, Lkotlin/collections/ArraysKt;->р([Ljava/lang/Object;[Ljava/lang/Object;)[Ljava/lang/Object;
    move-result-object p1
    check-cast p1, [Ljava/lang/String;
    return-object p1
.end method
```

### 4.2 与 `X0()` 的差异

| 维度 | `X0()` | `t0()` |
| --- | --- | --- |
| FROM 子句 | 委托 `h1.o(...)` | **自己拼**，多一个 `LEFT JOIN playlist_entries` |
| `album_artists` JOIN | `h1.o` 内按 `C0742.O` | **自己判断 `у->O`** |
| WHERE | `h1.o` 内处理 cue 过滤 | **显式加 `AND cue_folder_id IS NULL`** |
| 分组列 `i1Var.В` | 未设 | **`folder_files._id`** |
| 返回投影 | `p0.f3367` | **原 `strArr` + `playlist_id` + `playlist_entries._id AS playlist_entry_id`** |

⇒ **`t0()` 是「把流作为播放列表条目来查」的变体**，用于在播放列表中显示流条目（需要 `playlist_entry_id` 才能定位条目、做删除/重排）。

`X0()` 用于纯流列表；`t0()` 用于流出现在其它列表里的场景。

---

## 5. `stream_files` 与 `folder_files` 的关系

`d4.i()` 返回 `"stream_files"`：

```java
@Override // h0
public final String i() {
    return "stream_files";
}
```

但 `X0()` / `t0()` 的 FROM 主表都是 **`folder_files`**。

⇒ **`stream_files` 不是实际被查询的表名**，而是：
- 要么是 `folder_files` 上的一个 **VIEW**（`CREATE VIEW stream_files AS SELECT * FROM folder_files WHERE file_type=23`）
- 要么只是 URI/路由层的标识符

【推断】前者的可能性更高 —— 这样 `i()` 返回的「表名」在概念上自洽，而实际查询走 `folder_files` 是为了能复用 `h1.o()` 的 JOIN 模板。

**S3 未解**：`stream_files` 是否真为 VIEW，需读建库语句（`onUpgrade` 变量拼 SQL，难以静态取得）。

---

## 6. 排序：`d4.O(int)` —— 全库最简（6 模式）

```java
@Override // p0, m2
public final String O(int i) {
    boolean z = (1073741824 & i) != 0;
    int i2 = i & (-1073741825);
    if (i2 == 2) {
        return !z ? "folder_files.name COLLATE NOCASE"
                  : "folder_files.name COLLATE NOCASE DESC";
    }
    if (i2 == 5) {
        return !z ? "rating DESC, folder_files.name"
                  : "rating, folder_files.name";
    }
    if (i2 == 6) {
        return !z ? "folder_files.played_times DESC, folder_files.name"
                  : "folder_files.played_times, folder_files.name";
    }
    if (i2 == 7) {
        return !z ? "folder_files.played_fully_at DESC, folder_files.name"
                  : "folder_files.played_fully_at, folder_files.name";
    }
    if (i2 == 11) {
        return !z ? "folder_files.shuffle_order"
                  : "folder_files.shuffle_order DESC";
    }
    if (i2 != 12) {
        return !z ? "folder_files.name COLLATE NOCASE"
                  : "folder_files.name COLLATE NOCASE DESC";
    }
    return !z ? "folder_files.created_at DESC, folder_files.name"
              : "folder_files.created_at, folder_files.name";
}
```

### 6.1 模式表

| 模式 | 默认方向 | 排序键 | 次级键 |
| --- | --- | --- | --- |
| **2** | 升 | `folder_files.name COLLATE NOCASE` | — | 
| 5 | 降 | `rating` | `name` |
| 6 | 降 | `played_times` | `name` |
| 7 | 降 | `played_fully_at` | `name` |
| 11 | 升 | `shuffle_order` | — |
| 12 | 降 | `created_at` | `name` |
| default | 升 | `name`（同模式 2） | — |

### 6.2 为什么只有 6 种

对比 `p0.O(int)` 的 16 种模式，流**缺失**：

| 缺失 | 原因【推断】 |
| --- | --- |
| 0（音轨号） | 流没有 track number |
| 1（标题） | 流用**文件名**排序（模式 2），因为流标题往往不可靠 |
| 3（年份） | 流没有 album year |
| 4（添加时间 `file_created_at`） | 流用 `created_at`（模式 12），因为流文件没有「创建时间」概念 |
| 8/9（艺术家、专辑内音轨） | 流无可靠 album/artist 归属（§3.3 已被排除在统计外） |
| 10（时长） | 流时长不可靠（可能无限长） |
| 13–15（碟号、路径、年份+专辑） | 同上 |

⇒ **模式裁剪与流的元数据特征严格对应**：只保留「名称 / 评分 / 播放统计 / 随机 / 创建时间」这五类可靠维度。

### 6.3 次级键统一用 `name`

所有带次级键的模式（5/6/7/12）都用 `folder_files.name`，而 `p0.O` 用的是 `title_tag`。

⇒ 与 §6.2 的推断一致：**流的 `title_tag` 不可靠，统一回退到文件名**。

---

## 7. 过滤列：`d4.H`（3 列）

`<clinit>` smali 实证：

```smali
const-string v0, "COALESCE(name_without_number,'')"
const-string v1, "COALESCE(album_tag,'')"
const-string v2, "title_tag"
filled-new-array {v2, v0, v1}, [Ljava/lang/String;
sput-object v0, Lcom/maxmpz/audioplayer/rest/library/d4;->H:[Ljava/lang/String;
```

**数组顺序**（压栈顺序倒置）：

| 索引 | 表达式 |
| --- | --- |
| 0 | `title_tag` |
| 1 | `COALESCE(name_without_number,'')` |
| 2 | `COALESCE(album_tag,'')` |

### 7.1 用途

`H` 作为参数传给 `h1.o(...)` 与 `n.В(...)`，用于**把用户输入的搜索词映射到这些列**（`n.m313` / `n.В` 是文本过滤构造器）。

⇒ 在流页搜索时，只匹配 **标题 / 去编号文件名 / 专辑标签** 这三列。

### 7.2 与其它页面的过滤列对照

| 页面 | 过滤列组 | 来源 |
| --- | --- | --- |
| 所有歌曲 / 派生列表 | `p0.x` / `p0.y` / `p0.X` / `p0.f3368`（四选一） | 共用，受 `C0742.f1` / `C0742.f3418` 控制 |
| **流** | **`d4.H`（自有 3 列）** | 不受那两个 flag 影响 |
| 书签 | `a0.H`（2 个 id） | 自有 |

⇒ **流不走 `p0` 的四选一机制**，这是它少见的「自有逻辑」之一。

---

## 8. `h1.o()`：流页的共享构造器

```java
public static void o(com.maxmpz.audioplayer.player.r rVar, StringBuilder sb, String str,
                     i1 i1Var, String str2, ArrayList arrayList,
                     String[] strArr, boolean z, boolean z2) {
    rVar.A = A.m3("folder_files",
                  z ? " LEFT " : " INNER ",
                  " JOIN folders ON folders._id=folder_id"
                + " LEFT JOIN artists ON artists._id=folder_files.artist_id"
                + " LEFT JOIN albums ON albums._id=folder_files.album_id",
                  C0742.O.f3789
                      ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id"
                      : "");
    if (!C0742.f3414.f3789) {
        if (z2) {
            rVar.B(" AND ");
        }
        rVar.B("folder_files.cue_folder_id IS NULL");
    }
    androidx.appcompat.widget.n.m313(str2, strArr, sb, arrayList);
    i1Var.B = str;
    String[] strArr2 = p0.f3367;
}
```

### 8.1 参数语义

| 参数 | 流页传入 | 语义 |
| --- | --- | --- |
| `rVar` | — | 查询构建器 |
| `sb` | — | 主 WHERE 缓冲 |
| `str` | `O(C0742.e0.f3810)` | 排序表达式 |
| `i1Var` | — | 查询描述符（写入 `B` = 排序） |
| `str2` | 用户过滤串 | 搜索词 |
| `arrayList` | — | 绑定参数 |
| `strArr` | `d4.H` | 过滤列定义 |
| **`z`** | **`true`** | **`true` → `LEFT JOIN folders`；`false` → `INNER JOIN folders`** |
| **`z2`** | **`true`** | **是否需要前置 `" AND "`（因为调用方已塞了条件）** |

### 8.2 完整还原（流页视角）

```sql
SELECT <p0.f3367>
FROM folder_files
  LEFT JOIN folders ON folders._id = folder_id              -- z = true
  LEFT JOIN artists ON artists._id = folder_files.artist_id
  LEFT JOIN albums  ON albums._id  = folder_files.album_id
  [LEFT JOIN album_artists ON album_artists._id = folder_files.album_artist_id]  -- C0742.O
WHERE file_type = 23                                        -- 由 d4.X0 预先塞入
  [AND folder_files.cue_folder_id IS NULL]                  -- 当 !C0742.f3414 且 z2=true
  [AND <用户搜索词映射到 d4.H 三列>]
ORDER BY <d4.O(streams_sort)>
```

### 8.3 `z=true` 的含义

**流页用 `LEFT JOIN folders`，而「长」页 `d3` 用的是 `INNER JOIN folders`。**

【推断】因为流可能是不在已扫描文件夹树中的 URL 条目（网络流），用 `INNER JOIN` 会把它们全部丢掉。

反证：`d3`（长）用 `INNER`，因为长曲目必然是本地文件、必属某文件夹。

---

## 9. 元数据方法一览（smali 实证）

| 方法 | 返回值 | 含义 |
| --- | --- | --- |
| `i()` | `"stream_files"` | 表/视图名 |
| `j1()` | `"0"` | 基 URI 路径段（推断） |
| `H()` | `null` | — |
| `I0()` | `n.o("folder_files.name")` | 引号包裹的排序列 |
| `s()` | `0x7f01057a` = `R.attr.streams` | 分类图标（列表） |
| `Z()` | `0x7f01057c` = `R.attr.micro_streams` | 分类图标（micro） |
| `d()` | `C0742.e0.f3810` = `streams_sort` | 排序偏好 |
| `r0()` | `C0742.X0.f3810` | 列表缩放偏好（推断） |
| `m()` | `0x1000003c` | 见 §9.1 |
| `z()` | `0x12` = 18 | 分类序号（推断） |
| `k0()` | `this.В`（`g1`） | 父级导航 |
| `O(int)` | 排序表达式 | §6 |

### 9.1 `m()` = `0x1000003c` → `cat_stats.type = 60`

与年份（340 = `0x154`）、流派（210 = `0xD2`）同一套**位域编码**：

```java
// 父类 b1()
public final int b1() { return m() & 0x0FFFFFFF; }

// d4.m() = 0x1000003c
// 0x1000003c & 0x0FFFFFFF = 0x3C = 60
```

| 实体 | `m()` | `cat_stats.type` |
| --- | --- | --- |
| `i4`（Year Albums） | `0x10000154` | 340 |
| `a1`（Genre Albums） | `0x100000D2` | 210 |
| **`d4`（Streams）** | **`0x1000003C`** | **60** |

高位 `>>28` 均为 `1`。**S4 未解**：60 的具体统计维度。

> 注意：流页的 `X0()` **不使用** `cat_stats`（只有年份/流派的第 2B 层用）。所以 `m()` 只有在流作为分类被统计时才生效。

---

## 10. 与其它页面横向对照

| 维度 | 流 `d4` | 长 `d3` | 书签 `a0` | 最近播放 `r3` | 年份/流派 |
| --- | --- | --- | --- | --- | --- |
| 主表 | `folder_files` | `folder_files` | `bookmarks` | `folder_files`（子查询） | 分类表/关联表 |
| 筛选条件 | **`file_type=23`** | `duration >= 阈值` | — | 时间窗口 | 容器 id |
| 子查询 + LIMIT | 无 | 无 | 无 | **有** | 无 |
| FROM 构造 | **委托 `h1.o`** | 自拼 | 自拼 | 自拼 | 自拼 |
| folders JOIN | **LEFT** | **INNER** | INNER | LEFT | 各异 |
| 排序模式数 | **6（最少）** | 偏好全值 | 1（硬编码） | 偏好全值 | 偏好全值 |
| 过滤列 | **自有 3 列** | `p0` 四选一 | 自有 2 列 | `p0` 四选一 | `p0` 四选一 |
| 投影 | `p0.f3367` | `p0.f3367` | 自有 2 字段 | `p0.f3367` | `y`/`l.X` |

### 结构定位

```
容器类（年份/流派/专辑/艺术家）  →  行是「类别」
派生列表（最近/最多/评分/长）    →  行是「曲目」，按时间/计数/时长筛选
书签                            →  行是「曲目 + 状态快照」
流                              →  行是「曲目」，按【数据类型】分区
```

**流是唯一的「按 file_type 分区」视图** —— 不是按行为（播放/评分）也不是按时长，而是按**文件本身的性质**。

---

## 11. 可借鉴 / 不建议照抄

### 11.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **用 `file_type` 标记而非路径规则识别流** | 扫描时一次性定标，查询时零判断成本；不依赖 URL 协议/扩展名启发式 |
| A2 | **在统计 SQL 中显式 `file_type != 23` 排除流**（§3.3） | 流无可靠 album/artist，若混入会让专辑/艺术家页出现假条目 |
| A3 | **`X0()` 完全委托 `h1.o(...)`** | 4 行完成一个完整视图；共享构造器避免重复 JOIN 拼装 |
| A4 | **排序模式按数据特征裁剪**（16 → 6） | 只保留流的可靠维度，菜单里不出现「按音轨号排序」这种无意义选项 |
| A5 | **次级键统一回退 `name`** | 流 `title_tag` 不可靠，用文件名做 tie-breaker 更稳 |
| A6 | **`LEFT JOIN folders`（流）vs `INNER`（长）** | 流可能是脱离文件夹树的 URL 条目；长曲目必为本地文件 |
| A7 | **`t0()` 变体带 `playlist_entry_id`** | 流出现在播放列表时，需要条目 id 才能删除/重排 |

### 11.2 不建议照抄

| # | 做法 | 理由 |
| --- | --- | --- |
| **N1** | **`file_type` 用魔法数字 `23`，且无枚举定义** | 查询侧硬编码 `"23"`、写入侧 INSERT 里也是字面量 `23`，两侧无共享常量。改动时极易漏改一侧 |
| **N2** | **`i()` 返回 `stream_files` 但实际查 `folder_files`** | 元数据与实际查询不一致，追踪成本高（本文即为此多花一轮确认） |
| **N3** | **`X0()` 与 `t0()` 逻辑高度重复却未抽公共部分** | 两者 WHERE 几乎相同（`file_type=23` + cue 过滤），只差 `playlist_entries` JOIN 与投影。应参数化而非复制 |
| **N4** | **`h1.o()` 两个 boolean 参数无命名**（`z`/`z2`） | 调用点 `h1.o(..., true, true)` 完全看不出含义。应改为具名参数或枚举 |
| **N5** | **`file_type` 完整枚举缺失于可读层** | 23 只能从 INSERT 字面量反推，无 `FILE_TYPE_STREAM` 之类常量 |
| **N6** | **`d4.H()` 返回 `null`** | 与其他方法的字符串返回不一致，用途不明 |

---

## 12. 与 SpMusic 对照

### 12.1 SpMusic 现状

`src/features/player/model/mediaLibraryCategories.ts` **已定义 `streams` 分类**：

```typescript
{ id: 'streams', label: '流', icon: streams, overviewIcon: overview10, ... }
```

但**无对应面板组件**（`components/` 下无 `Stream*` 组件），属占位分类。

`playerUiViewModel.ts` 中的 `'album'` / `'artist'` 命中是 track 元数据字段名，与此无关。

### 12.2 维度对照

| # | 维度 | Poweramp | SpMusic 现状 |
| --- | --- | --- | --- |
| 1 | 流页 | `folder_files` + `file_type=23` 过滤 | **占位分类** |
| 2 | 流识别 | 扫描时硬编码 `file_type=23` | 无 |
| 3 | 统计排除 | 专辑/艺术家统计显式排除流 | 无 |
| 4 | 排序裁剪 | 6 模式（无音轨号/年份/时长） | 单一 `compareByQuickIndex` |
| 5 | 标题格式 | `stream_name_in_title` 可切换 | 无 |
| 6 | 封面来源 | `aa_per_stream_track` 可切换 | 无 |

### 12.3 最小实现建议

流页是**成本最低的分类页**：不需要新表、不需要新分类模型。

| 组件 | 建议 |
| --- | --- |
| 识别 | 扫描时给 track 打 `isStream` 布尔（或 `fileType` 枚举） |
| 列表 | 曲目列表加 `isStream === true` 过滤，复用 all-songs 渲染 |
| 统计 | 专辑/艺术家 `numFiles` 统计**排除**流（Poweramp 的做法，§3.3） |
| 排序 | 只提供「名称 / 评分 / 播放次数 / 最近播放 / 随机 / 添加时间」六种 |
| 标题 | 可选 `streamNameInTitle` 开关 |
| 封面 | 可选 `aaPerStreamTrack` 开关 |

**一个必须注意的点**：如果 SpMusic 的专辑/艺术家页用「GROUP BY album 后计数」，**必须先排除流**，否则会出现「某专辑只有 1 首流」的假条目。这是 Poweramp 在四处 SQL 里反复加 `file_type!=23` 的原因。

---

## 13. 未解

| # | 问题 | 优先级 |
| --- | --- | --- |
| **S1** | `file_type` 完整枚举（23 之外的取值） | 中 |
| **S3** | `stream_files` 是否为 VIEW（`i()` 返回它但查询用 `folder_files`） | 中 |
| **S4** | `cat_stats.type = 60` 的统计维度 | 低 |
| S2 | `h1.o()` 的 `z2` 参数确切语义 | 低 |
| S5 | `d4.H()` 返回 `null` 的用途 | 低 |
| S6 | `d4.r0()` 对应的 `C0742.X0` 偏好键名 | 低 |
| S7 | `d4.z()` 返回 18 的语义（分类序号？） | 低 |
| S8 | `t0()` 的 `К` 参数（`com.maxmpz.audioplayer.data.api.К`）用途 | 中 |

---

## 14. Evidence ID 索引

| 主题 | Evidence ID |
| --- | --- |
| **`d4.X0`（流列表 SQL，全库最短）+ 类摘要** | `ev_e9a30d2e844e61705552af9c2ce56f07ff17ae4da25af1e39f6520744cab05d1` |
| **`d4.O(int)`（6 模式排序）** | `ev_1d67f187a0333617b0597b3222ed3c9b2e033e37cf029d046a804dfd0b6541c9` |
| **`h1.o()`（共享 FROM/JOIN 构造器）** | `ev_e19d78e86457c7a8587ffe99bceea44298b27f29285f4a43e2afeadc186fc33f` |
| **`d4.i()`（`"stream_files"`）** | `ev_97464c0a687ca073e4dcc78896eae7492cf70a932e6ab3ab3196e0a8afff5af1` |

资源来源：`.rea-analysis/decoded/res/values/strings.xml`、`.rea-analysis/decoded/res/values/public.xml`（apktool 3.0.3，已入库）。
smali 取证：`apktool d --no-res` 反汇编（7308 个 `.smali`），用于 `d4` 方法体、`<clinit>` 投影、`t0()` 全文、`file_type=23` 写入侧。

---

## 15. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| `poweramp-recents-views.md` | 派生/筛选列表（最近/最多/评分/长）+ 共用排序映射 `p0.O`。本文 §6/§10 引用其模式对照 |
| `poweramp-bookmarks-view.md` | 书签（独立表 + 位置快照）。本文 §7/§10 引用其自有过滤列与投影对照 |
| `poweramp-category-views.md` | 年份/流派双路径四层容器。本文 §9.1 引用其 `cat_stats.type` 位域编码 |
| `poweramp-entity-views.md` | 专辑/艺术家/专辑艺术家/作曲家 |
| `poweramp-library-three-views.md` | 所有歌曲/文件夹/文件夹层次结构。本文 §8.2 的投影 `p0.f3367` 与其同源 |
| `poweramp-queue-runtime-reference.md` | 队列状态机。`t0()` 的 `playlist_entries` 与队列无关 |
| `poweramp-search-and-queue-impact.md` | 搜索。本文 §7.1 的过滤列机制与其相关，仅交叉引用 |
| `media-library-page-relationships.md` | SpMusic 三页面现状。本文 §12 只做对照 |
