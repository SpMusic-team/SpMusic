---
doc_id: "ARCH-POWERAMP-STREAMS-VIEW"
title: "Poweramp 流参考（从创建到消费的完整链路）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-03"
updated: "2026-11-03"
source_documents:
  - "user request: 逆向 Poweramp 媒体库下「流」页的实现与组织，并查清流究竟是什么、怎么运行"
  - "shared task: task-18"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009) :: SHA-256 4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0"
  - ".rea-analysis/findings-streams-view.md（本轮方法体原文）"
  - ".rea-analysis/decoded/res/values/strings.xml（UI 文案）"
  - ".rea-analysis/decoded/res/values/public.xml（R.attr / R.string ID）"
  - "docs/architecture/poweramp-recents-views.md（派生列表 + p0 投影体系）"
  - "docs/architecture/poweramp-bookmarks-view.md（同为 song 视图的自有过滤）"
  - "docs/architecture/poweramp-category-views.md（cat_stats.type 位域编码）"
  - "docs/architecture/media-library-page-relationships.md（SpMusic 侧对照）"
---

# Poweramp 流参考（从创建到消费的完整链路）

## 0. 定位与证据分级

**本文记录外部实现 Poweramp 的「流」页面与其完整生命周期，不是 SpMusic 现状。**

| 标记 | 含义 | 可信度 |
| --- | --- | --- |
| **【实证·产物】** | JADX 反编译方法体原文 | 最高 |
| **【实证·smali】** | 反汇编 smali 原文（本轮主要证据形式） | 最高 |
| **【实证·原文】** | APK 资源字符串 / public.xml 原文 | 高 |
| **【推断】** | 本文作者推理 | 低 |

### 0.1 一句话结论

**流是「从外部播放列表导入的、没有本地文件的 HTTP(S) URL 曲目」，以 `folder_files.file_type = 23` 标记。**

它不是扫描出来的，是**导入 M3U/PLS 时**由解析器写进数据库的。

### 0.2 两条链路

```
【创建侧】 导入 M3U/PLS
            → 逐行解析（#EXTINF 取标题，非注释行取 URL）
            → 判定 http:// 或 https://
            → INSERT folder_files (file_type=23, meta="Stream", 无 folder_id)
            → INSERT playlist_entries (存完整 URL)

【消费侧】 「流」页
            → SELECT ... FROM folder_files WHERE file_type=23
            → d4.X0() 全库最短的列表查询
```

### 0.3 核心特征

| 特征 | 流 | 其它页面 |
| --- | --- | --- |
| 数据来源 | **`folder_files` + `file_type = 23`** | 独立表 / 分类表 / 子查询 |
| 产生方式 | **导入播放列表时插入** | 扫描文件系统 |
| 有无 `folder_id` | **无** | 有 |
| 有无 `file_path` | **无**（URL 在 `playlist_entries`） | 有 |
| 查询写法 | **全库最短 `X0`（4 行）** | 十几到几十行 |
| 构建逻辑 | **完全委托 `h1.o(...)`** | 各自拼装 |
| 排序 | **自有 `O(int)`，仅 6 模式**（全库最少） | 3–16 模式 |
| 投影 | **`p0.f3367`（标准 song 投影）** | 多样 |
| 过滤列 | **自有 3 列** | 4 组共用 |
| 参与专辑/艺术家统计 | **否（显式排除）** | 是 |

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
pref_summary_stream_buffer = "Increasing buffer size also increases stream start time"
pref_stream_timeout      = "Network Stream Timeout"
pref_use_stream3_player  = "Emulate Media Stream (for Hi-Res output)"
cast_stop_live_stream    = "Stop live stream"
```

**四个与流相关的设置**：

| key | 文案 | 作用 |
| --- | --- | --- |
| `stream_name_in_title` | Stream Name In Title | 标题格式 `Stream - Track Title` vs `Track Title` |
| `aa_per_stream_track` | Prefer Track Cover for Streams | 封面用 track 元数据还是流名称 |
| `pref_stream_buffer` | Network Stream Buffer | 网络缓冲大小（影响起播延迟） |
| `pref_stream_timeout` | Network Stream Timeout | 网络超时 |

`pref_use_stream3_player` 说明流有独立的播放器实现路径（Hi-Res 输出场景）。

### 1.2 相关 R 资源

```
attr/streams       0x7f01057a     ← d4.s()
attr/micro_streams 0x7f01057c     ← d4.Z()
attr/stream_24dp   0x7f01065b
id/state_player_track_is_stream  0x7f0d070d   ← 播放态里「当前是流」标志
string/streams     0x7f080880
string/stream      0x7f08087e     ← "Stream"，写入 meta 列
```

`state_player_track_is_stream` 的存在说明：**「是否为流」是曲目的运行时属性**，不只用于列表分区。

---

## 2. 创建链路（一）：什么算「流」

判定函数在 `okhttp3.internal.platform.android.y`（混淆后的通用工具类）。

### 2.1 `y.С(String)` —— http/https 判定

**只有 `http://` 与 `https://` 算流。**

```java
public static final boolean С(String s) {
    if (s.length() < 8) return false;
    if (s.charAt(0) != 'h' || s.charAt(1) != 't' || s.charAt(2) != 't' || s.charAt(3) != 'p') return false;
    if (s.charAt(4) == ':' && s.charAt(5) == '/' && s.charAt(6) == '/') return true;                 // http://
    if (s.charAt(4) == 's' && s.charAt(5) == ':' && s.charAt(6) == '/' && s.charAt(7) == '/') return true;  // https://
    return false;
}
```

smali 特征（字符码实证）：

```smali
const/16 v1, 0x8    ; 长度下限 8
const/16 v1, 0x68   ; 'h'
const/16 v3, 0x74   ; 't'
const/16 v3, 0x70   ; 'p'
const/16 v6, 0x3a   ; ':'
const/16 v7, 0x2f   ; '/'
const/16 v3, 0x73   ; 's'
```

**注意**：`rtsp://`、`file://`、`mms://` 等协议**都不算流**。这是严格的二选一。

### 2.2 `y.C(String)` —— 播放列表文件判定

```java
public static final boolean C(String s) {
    int n = s.length();
    if (n >= 6 && s.charAt(n-4)=='m' && s.charAt(n-3)=='3' && s.charAt(n-2)=='u' && s.charAt(n-1)=='8') return true;  // .m3u8
    if (n >= 5 && s.charAt(n-3)=='m' && s.charAt(n-2)=='3' && s.charAt(n-1)=='u') return true;                        // .m3u
    return false;
}
```

字符码：`0x6d='m'`、`0x33='3'`、`0x75='u'`、`0x38='8'`。

⇒ 识别 `.m3u` 与 `.m3u8` 两种扩展名。**注意不认 `.pls`**（PLS 走 XML/其它分支，见 §3.3）。

### 2.3 `y.o(String)` —— `data:` URI 判定

```java
public static final boolean o(String s) {
    return s.length() > 5
        && s.charAt(0)=='d' && s.charAt(1)=='a' && s.charAt(2)=='t' && s.charAt(3)=='a'
        && s.charAt(4)==':';
}
```

字符码：`0x64='d'`、`0x61='a'`、`0x74='t'`、`0x3a=':'`。

⇒ `data:` 开头的内嵌 URI 也被单独识别。

### 2.4 三者的用途分工

在 `X.x(...)` 的分支逻辑中（§3.4）：

| 函数 | 用途 |
| --- | --- |
| `y.С` | **判定是否流**（走流插入分支） |
| `y.C` | 判定是否播放列表文件（递归展开嵌套 M3U） |
| `y.o` | 判定是否 `data:` URI |

---

## 3. 创建链路（二）：导入与解析

核心类：`com.maxmpz.audioplayer.scanner.X`（播放列表处理器，13 个方法 / 18 个预编译语句字段）。

### 3.1 预编译语句字段映射（`<init>` smali 实证）

`X` 持有 18 个 `player.bt.В` 字段，每个都是懒加载的 `Function0<SQLiteStatement>`。
通过 `scanner/х.<init>(X, int)` 的索引参数对应到 switch case：

| 字段 | switch | 对应 SQL |
| --- | --- | --- |
| `х` | 0 | — |
| `у` | 1 | — |
| `К` | 2 | — |
| `K` | 3 | — |
| `Н` | 4 | — |
| `H` | 5 | 流 SELECT（按 name 查 id） |
| **`Р`** | **6（另 15 也映射到此）** | **流 INSERT（`file_type=23`）** |
| `P` | 7 | 流 SELECT（另一变体） |
| `р` | 8 | — |
| `p` | 9 | `INSERT INTO playlist_entries` |
| `Х` | 10 | — |
| `X` | 11 | — |
| `x` | 12 | — |
| `y` | 13 | — |
| `О` | 6（同上） | 流 INSERT |

> 字段名同名不同字（Cyrillic `Р`/`р`/`P`/`p`）是混淆产物，必须按字符区分。
> 本文用 `Р`（U+0420）表示流 INSERT，`p`（ASCII）表示 playlist_entries INSERT。

### 3.2 导入入口：`X.B(String, String)`

```java
public final long B(String path, String name) {
    // 1. 取 playlist 名称（X.X() 处理重名/格式化）
    String playlistName = X(path, name);
    if (path.length() == 0) return 0;

    // 2. 校验路径有效性
    if (saf.х.р(path)) {                         // SAF/URI 路径
        resolved = saf.K(path);                  // 解析为本地路径
    } else if (saf.х.К(path)) {                  // 已是可用路径
        resolved = path;
    } else {
        resolved = new File(path).lastModified() / 1000 != 0 ? path : null;
    }
    if (resolved == null) return 0;

    // 3. 插入 playlists 表
    ContentValues cv = new ContentValues();
    cv.put("playlists.playlist",   playlistName);
    cv.put("playlists.mtime",      t);
    cv.put("playlists.created_at", t);
    cv.put("playlists.updated_at", t);
    long playlistId = db.insert("playlists", "", cv);

    // 4. 解析该播放列表的全部条目
    this.Х(path, name, playlistId, charset, true, true, prefSkipVideo);

    return playlistId;
}
```

**关键点**：先建 `playlists` 行拿到 `playlistId`，再解析条目。这样每个条目都能立即绑定到所属播放列表。

### 3.3 格式分发：`X.Х(...)`（778 行）

`Х()` 根据内容格式分三路：

| 分支 | 依据 | 调用的方法 |
| --- | --- | --- |
| **XML**（PLS/XSPF） | `XmlPullParser.setInput(InputStream, charset)` | `X.x(...)` |
| **文本**（M3U） | `BufferedReader.readLine()` 逐行 | `X.х(...)` |
| 其它 | — | `X.у(...)` |

smali 特征：

```smali
; XML 分支
invoke-virtual {v6, v5, v3}, data/saf/X;->р(Context;String)InputStream;
Lorg/xmlpull/v1/XmlPullParser;->setInput(Ljava/io/InputStream;Ljava/lang/String;)V

; 文本分支
new-instance v3, Ljava/io/BufferedReader;
const/high16 v0, 0x10000            ; 64 KiB 缓冲
invoke-direct {v3, v2, v0}, Ljava/io/BufferedReader;-><init>(Ljava/io/Reader;I)V
invoke-virtual {v3, v0}, Ljava/io/BufferedReader;->mark(I)V
```

### 3.4 M3U 解析：`X.х(String, String, String, Z, I, Z, Z, Z)`

逐行状态机：

```java
mark(0x10000);                       // 64 KiB 回退点
String line;
String title = null;
while ((line = br.readLine()) != null) {
    line = line.trim();
    if (line.length() <= 4) continue;

    if (line.charAt(0) == '#') {                     // 注释行
        if (startsWith(line, 1, "EXT")) {            // #EXT...
            if (line.charAt(4) == '-') {             // #EXT-XXXXXXXX
                if (line.charAt(5) == 'X' || line.charAt(5) == 'x') {   // #EXT-X (HLS)
                    ...
                }
            }
            if (startsWith(line, 1, "EXTINF:")) {     // ★ 元数据行
                int comma = indexOf(line, ',', 8, false);
                if (comma != -1 && comma < line.length() - 1) {
                    title = line.substring(comma + 1).trim();           // ★ 逗号后 = 标题
                }
            }
        }
        continue;
    }

    // 非注释行 = 路径 / URL
    x(basePath, line, playlistName, title, ..., -1L, -1L, false, false);
}
```

**`#EXTINF:<duration>,<title>` 的解析**：只取**逗号之后**的部分作为标题，逗号前的 duration **被丢弃**（流的时长恒为 0，§4）。

### 3.5 分流：`X.x(...)`

```java
public final long x(String base, String path, String playlistName, String title,
                    int a, int b, int c, long d, long e, boolean f, boolean g) {
    // 1. Windows 盘符归一化：C:\x 或 C:/x → /x
    if (path.charAt(0) != '/') {
        if (path.length() > 3 && Character.isLetter(path.charAt(0))
            && path.charAt(1) == ':' && (path.charAt(2) == '\\' || path.charAt(2) == '/')) {
            path = "/" + path.substring(3);
        }
    }

    // 2. ★ 是否 URL
    if (!y.С(path)) {                              // 不是 http(s)
        if (g) {                                   // 允许非本地
            if (!y.o(path) && y.C(path)) goto stream;   // data:/m3u → 走流
        }
        // 本地文件流程
        if (saf.х.P(path) || saf.х.К(path)) { ... }
        else if (base != null) path = base + path;
        long id = К(path, new String[2]);          // 查 folder_files
        ...
    }

stream:                                            // ★ 是 URL 或播放列表
    String s1 = audio.core.х.С(path);              // URL 规范化
    String s2 = audio.core.х.p(s1);                // 提取主机/路径
    return у(path, s1, s2, title, ...);            // 插入流
}
```

**注意 `goto stream` 的两个来源**：
1. `y.С(path)` 为真 → `http(s)://`
2. `y.o(path)` 为真（`data:`）**或** `y.C(path)` 为真（`.m3u`）→ 也走流分支

⇒ **`.m3u` 条目本身也会被当作流记录**（嵌套播放列表的引用）。

### 3.6 流插入：`X.у(...)` → `X.y(...)`

`у()` 做两件事：

```java
public final long у(String url, String s1, String s2, String title,
                    int a, int b, int c, long d, boolean e) {
    // 1. 插入 folder_files（返回 fileId）
    long fileId = y(b, c, url, title, s2, false, e);
    if (fileId == 0) return 0;

    // 2. 插入 playlist_entries（绑定到播放列表）
    SQLiteStatement st = p.getValue();             // pswitch_9
    st.bindString(1, s1);                          // playlist_id 链
    st.bindLong(2, fileId);                        // folder_file_id
    st.bindLong(3, c);                             // sort
    st.bindString(4, url);                         // ★ 完整 URL 存在这里
    st.bindLong(5, d < 0 ? 0 : d);                 // cue_offset_ms
    st.executeInsert();

    return fileId;
}
```

### 3.7 字段绑定：`X.y(...)`

使用预编译语句 `Р`（`pswitch_6`）—— 即 §3.1 表中标为「流 INSERT」的那条。

```sql
INSERT INTO folder_files
  (name, title_tag, name_without_number, artist_tag, album_tag, track_number,
   tag_status, track_tag, track_number_alt, duration, updated_at, file_type,
   file_created_at, created_at, meta, rating, user_added)
VALUES (?, ?, ?, ?, ?, 0, 1, 0, 0, 0, ?, 23, ?, ?, ?, ?, ?)
```

#### 绑定序列（smali 实证）

```smali
; 先按 name 查已存在记录（pswitch_5 = H 字段）
bindString(1, name);
simpleQueryForLong();                               ; existingId
boolean isNew = (existingId == 0);

if (isNew) st = Р.getValue()  else st = P.getValue();   ; 新记录 vs 更新

bindString(1, name);                                ; name

if (artist.length() != 0) {
    bindString(2, artist);                          ; artist_tag
    bindString(3, artist);                          ; album_tag ← 同一个值
} else {
    bindString(2, artist);                          ; artist_tag
    bindNull(3);                                    ; album_tag = NULL
}

const-string v3, "..."   ; ★ 字面量
bindString(4, "...");                               ; ★ 硬编码 "..."

bindNull(5);                                        ; ★ NULL

bindLong(6, now);                                   ; updated_at

bindLong(7, a > 0 ? a : now);                       ; file_created_at

bindLong(8, now);                                   ; created_at

getString(0x7f08087e);                              ; ★ R.string.stream = "Stream"
bindString(9, "Stream");                            ; ★ meta
```

#### 关键发现

| 列 | 值 | 说明 |
| --- | --- | --- |
| **`artist_tag`** | **`"..."`** | **硬编码三连点**！流没有艺术家，用 `...` 占位 |
| **`album_tag`** | **`NULL`** | 流没有专辑 |
| **`meta`** | **`"Stream"`** | 由 `R.string.stream` 提供（已用 strings.xml 验证） |
| `file_type` | `23` | SQL 字面量 |
| `track_number` | `0` | SQL 字面量 |
| `tag_status` | `1` | SQL 字面量 |
| `duration` | `0` | SQL 字面量 |
| `created_at` / `updated_at` | `now` | `System.currentTimeMillis()` |

**`artist_tag = "..."` 是个很特别的决策**：不是 NULL，而是字面 `"..."`。
这样 UI 显示时不会因 NULL 崩溃，同时视觉上明显是占位符。

### 3.8 一个最小 M3U 示例

```m3u
#EXTM3U
#EXTINF:-1,电台 A
http://example.com/a.mp3
#EXTINF:-1,电台 B
https://example.com/b.aac
```

导入后产生：

**`folder_files`**（2 行，`file_type=23`）

| name | artist_tag | album_tag | meta | duration | file_type |
| --- | --- | --- | --- | --- | --- |
| （URL 派生的 name） | `"..."` | `NULL` | `"Stream"` | `0` | `23` |

**`playlist_entries`**（2 行）

| folder_file_id | url | cue_offset_ms |
| --- | --- | --- |
| 上面的 id | `http://example.com/a.mp3` | 0 |
| 上面的 id | `https://example.com/b.aac` | 0 |

> `#EXTINF:-1` 的 `-1`（duration）被丢弃，不写入数据库。

---

## 4. 流的数据特征汇总

### 4.1 与普通曲目的字段差异

| 列 | 普通曲目 | 流 | 证据 |
| --- | --- | --- | --- |
| `folder_id` | 有值 | **不在 INSERT 列中 → NULL** | §3.7 |
| `file_path` | 有值 | **不在 INSERT 列中 → NULL** | §3.7 |
| `artist_tag` | 真实艺术家 | **`"..."`** | smali 字面量 |
| `album_tag` | 真实专辑 | **`NULL`** | `bindNull(5)` |
| `meta` | 曲目元信息 | **`"Stream"`** | `R.string.stream` |
| `duration` | 实际时长 | **`0`** | SQL 字面量 |
| `track_number` | 音轨号 | **`0`** | SQL 字面量 |
| `file_type` | 音频格式码 | **`23`** | SQL 字面量 |
| `sort` | — | 在 `playlist_entries.sort` | §3.6 |

### 4.2 URL 存两处

| 位置 | 内容 | 用途 |
| --- | --- | --- |
| `folder_files.name` | URL 派生的显示名 | 列表显示 |
| **`playlist_entries.folder_path` / `url`** | **完整 URL** | 播放时取源 |

⇒ **流的真正播放地址在 `playlist_entries`，不在 `folder_files`。**

这解释了两件事：
1. 为什么 `folder_files` 允许无 `file_path`（流的字段留空）
2. 为什么 `d4.t0()` 需要 `LEFT JOIN playlist_entries`（要拿 URL 和条目 id）

### 4.3 为什么必须 `LEFT JOIN folders`

`d4.X0()` 走 `h1.o(..., z=true)` → `LEFT JOIN folders`。

**因为流没有 `folder_id`** —— 用 `INNER JOIN` 会把所有流记录丢掉。

对比：
| 页面 | JOIN 类型 | 原因 |
| --- | --- | --- |
| **流 `d4`** | **LEFT** | 无 `folder_id`，可能是孤儿记录 |
| 长 `d3` | INNER | 长曲目必为本地文件、必属某文件夹 |
| 书签 `a0` | INNER | 书签只对已有曲目创建 |

**JOIN 类型不是随意选的，是被数据模型强制的。**

### 4.4 统计排除

`scanner/library/K.smali` 在四处统计 SQL 中显式排除流：

```sql
-- L757
) AND folder_files.album_id!=1000 AND folder_files.artist_id!=1000
  AND folder_files.file_type!=23 AND +folder_files.tag_status=1

-- L785
) AND +folder_files.tag_status=1 AND folder_files.file_type!=23
  AND folder_files.artist_id!=1000

-- L813
) AND +tag_status=1 AND file_type!=23 AND album_id!=1000 AND artist_id!=1000

-- L841
) AND file_type!=23 AND artist_id!=1000 AND +tag_status=1
```

⇒ **流不参与专辑/艺术家/流派的 `num_files` 统计。**

**原因**：流的 `artist_tag = "..."`、`album_tag = NULL`，若参与统计会让专辑/艺术家页出现「只有 1 首流」的假条目。

---

## 5. 消费链路（一）：列表查询 `d4.X0()` —— 全库最短

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

### 5.1 只有四步

| 步 | 动作 |
| --- | --- |
| 1 | 塞入唯一条件 `file_type = 23` |
| 2 | 委托 `h1.o(...)` 完成 FROM/JOIN/其余 WHERE/排序 |
| 3 | 传自有过滤列 `H` |
| 4 | 返回标准 song 投影 `p0.f3367` |

**对比**：最近播放 `r3` 约 25 行、书签 `a0` 约 15 行、流派 `z0` 约 12 行。流是**唯一把主体逻辑完全外推**的页面。

### 5.2 完整还原

```sql
SELECT <p0.f3367>
FROM folder_files
  LEFT JOIN folders ON folders._id = folder_id              -- z = true（流无 folder_id）
  LEFT JOIN artists ON artists._id = folder_files.artist_id
  LEFT JOIN albums  ON albums._id  = folder_files.album_id
  [LEFT JOIN album_artists ON album_artists._id = folder_files.album_artist_id]  -- C0742.O
WHERE file_type = 23
  [AND folder_files.cue_folder_id IS NULL]                  -- 当 !C0742.f3414 且 z2=true
  [AND <用户搜索词映射到 d4.H 三列>]
ORDER BY <d4.O(streams_sort)>
```

---

## 6. 消费链路（二）：`d4.t0()` —— 流 + 播放列表条目

`d4` 除了 `X0()` 还有 `t0()`，用于**流出现在播放列表里**的场景。

```java
public final String[] t0(Uri uri, r rVar, String[] strArr, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var,
                         int i, com.maxmpz.audioplayer.data.api.К к)
```

### 6.1 原文（smali）

```smali
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
iput-object p1, p2, Lcom/maxmpz/audioplayer/player/r;->A:Ljava/lang/Object;

const-string p1, "file_type"
; ... B("file_type") B("=") B("23")
const-string p1, " AND "
; ... B(" AND ")
const-string p1, "folder_files.cue_folder_id IS NULL"

sget-object p1, Lcom/maxmpz/audioplayer/rest/library/d4;->H:[Ljava/lang/String;
invoke-static {p4, p1, p5, p6}, Landroidx/appcompat/widget/n;->В(...)V

const-string p1, "folder_files._id"
iput-object p1, p7, Lcom/maxmpz/audioplayer/rest/library/i1;->В:Ljava/lang/String;   ; GROUP BY

sget-object p1, Lcom/maxmpz/audioplayer/rest/library/у;->e0:Lcom/maxmpz/preference/fastprefs/w;
iget p1, p1, Lcom/maxmpz/preference/fastprefs/s;->А:I
invoke-virtual {p0, p1}, Lcom/maxmpz/audioplayer/rest/library/d4;->O(I)Ljava/lang/String;
iput-object p1, p7, Lcom/maxmpz/audioplayer/rest/library/i1;->B:Ljava/lang/String;   ; ORDER BY

const-string p1, "playlist_id"
const-string p2, "playlist_entries._id AS playlist_entry_id"
filled-new-array {p1, p2}, [Ljava/lang/String;
invoke-static {p3, p1}, Lkotlin/collections/ArraysKt;->р(...)                       ; 追加投影
```

### 6.2 与 `X0()` 的差异

| 维度 | `X0()` | `t0()` |
| --- | --- | --- |
| FROM 子句 | 委托 `h1.o(...)` | **自己拼**，多一个 `LEFT JOIN playlist_entries` |
| `album_artists` JOIN | `h1.o` 内按 `C0742.O` | **自己判断 `у->O`**（同一 flag） |
| WHERE | `h1.o` 内处理 cue 过滤 | **显式加 `AND cue_folder_id IS NULL`** |
| 分组列 `i1Var.В` | 未设 | **`folder_files._id`** |
| 返回投影 | `p0.f3367` | **原 `strArr` + `playlist_id` + `playlist_entries._id AS playlist_entry_id`** |

⇒ **`t0()` 是「把流作为播放列表条目来查」的变体**，需要 `playlist_entry_id` 才能定位条目、做删除/重排。

`X0()` 用于纯流列表；`t0()` 用于流混在其它列表里的场景。

---

## 7. `stream_files` 与 `folder_files` 的关系

`d4.i()` 返回 `"stream_files"`：

```java
@Override // h0
public final String i() {
    return "stream_files";
}
```

但 `X0()` / `t0()` 的 FROM 主表都是 **`folder_files`**。

⇒ **`stream_files` 不是实际被查询的表名**，而是：
- 要么是 `folder_files` 上的一个 **VIEW**
- 要么只是 URI/路由层的标识符

【推断】前者可能性更高 —— 这样 `i()` 返回的「表名」在概念上自洽，实际查询走 `folder_files` 是为了复用 `h1.o()` 的 JOIN 模板。

**S3 未解**：`stream_files` 是否真为 VIEW，需读建库语句（`onUpgrade` 变量拼 SQL，难以静态取得）。

---

## 8. 排序：`d4.O(int)` —— 全库最简（6 模式）

```java
@Override // p0, m2
public final String O(int i) {
    boolean z = (1073741824 & i) != 0;
    int i2 = i & (-1073741825);
    if (i2 == 2)  return !z ? "folder_files.name COLLATE NOCASE"                     : "folder_files.name COLLATE NOCASE DESC";
    if (i2 == 5)  return !z ? "rating DESC, folder_files.name"                       : "rating, folder_files.name";
    if (i2 == 6)  return !z ? "folder_files.played_times DESC, folder_files.name"    : "folder_files.played_times, folder_files.name";
    if (i2 == 7)  return !z ? "folder_files.played_fully_at DESC, folder_files.name" : "folder_files.played_fully_at, folder_files.name";
    if (i2 == 11) return !z ? "folder_files.shuffle_order"                           : "folder_files.shuffle_order DESC";
    if (i2 != 12) return !z ? "folder_files.name COLLATE NOCASE"                     : "folder_files.name COLLATE NOCASE DESC";
    return !z ? "folder_files.created_at DESC, folder_files.name"                    : "folder_files.created_at, folder_files.name";
}
```

### 8.1 模式表

| 模式 | 默认方向 | 主键 | 次级键 |
| --- | --- | --- | --- |
| **2** | 升 | `folder_files.name COLLATE NOCASE` | — |
| 5 | 降 | `rating` | `name` |
| 6 | 降 | `played_times` | `name` |
| 7 | 降 | `played_fully_at` | `name` |
| 11 | 升 | `shuffle_order` | — |
| 12 | 降 | `created_at` | `name` |
| default | 升 | `name`（同模式 2） | — |

### 8.2 为什么只有 6 种

对比 `p0.O(int)` 的 16 种模式，流**缺失**：

| 缺失 | 原因【推断】 |
| --- | --- |
| 0（音轨号） | 流 `track_number = 0`（固定值） |
| 1（标题） | 流用**文件名**排序（模式 2），因 `title_tag` 不可靠 |
| 3（年份） | 流无 album year |
| 4（添加时间 `file_created_at`） | 流用 `created_at`（模式 12） |
| 8/9（艺术家、专辑内音轨） | 流 `artist_tag="..."`、`album_tag=NULL`，无归属 |
| 10（时长） | 流 `duration = 0`（固定值） |
| 13–15（碟号、路径、年份+专辑） | 同上 |

⇒ **模式裁剪与流的字段特征严格对应**：只保留「名称 / 评分 / 播放统计 / 随机 / 创建时间」五类可靠维度。

### 8.3 次级键统一用 `name`

所有带次级键的模式（5/6/7/12）都用 `folder_files.name`，而 `p0.O` 用 `title_tag`。

⇒ 与 §8.2 一致：**流的 `title_tag` 不可靠，统一回退到文件名。**

---

## 9. 过滤列：`d4.H`（3 列）

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

### 9.1 用途

`H` 作为参数传给 `h1.o(...)` 与 `n.В(...)`，用于**把用户搜索词映射到这些列**。

⇒ 在流页搜索时，只匹配 **标题 / 去编号文件名 / 专辑标签** 这三列。

### 9.2 与其它页面的过滤列对照

| 页面 | 过滤列组 | 来源 |
| --- | --- | --- |
| 所有歌曲 / 派生列表 | `p0.x` / `p0.y` / `p0.X` / `p0.f3368`（四选一） | 共用，受 `C0742.f1` / `C0742.f3418` 控制 |
| **流** | **`d4.H`（自有 3 列）** | 不受那两个 flag 影响 |
| 书签 | `a0.H`（2 个 id） | 自有 |

⇒ **流不走 `p0` 的四选一机制**，这是它少见的「自有逻辑」之一。

---

## 10. `h1.o()`：流页的共享构造器

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

### 10.1 参数语义

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
| **`z2`** | **`true`** | **是否需要前置 `" AND "`（调用方已塞了条件）** |

### 10.2 `z2` 的必要性

流页先调 `rVar.B("file_type")/B("=")/B("23")` 塞了 `file_type=23`，所以后续追加 cue 过滤时必须先补 `" AND "`。

若调用方没塞条件，`z2` 传 `false` 可避免生成 `WHERE  AND ...` 语法错误。

---

## 11. 元数据方法一览（smali 实证）

| 方法 | 返回值 | 含义 |
| --- | --- | --- |
| `i()` | `"stream_files"` | 表/视图名 |
| `j1()` | `"0"` | 基 URI 路径段（推断） |
| `H()` | `null` | 用途不明 |
| `I0()` | `n.o("folder_files.name")` | 引号包裹的排序列 |
| `s()` | `0x7f01057a` = `R.attr.streams` | 分类图标（列表） |
| `Z()` | `0x7f01057c` = `R.attr.micro_streams` | 分类图标（micro） |
| `d()` | `C0742.e0.f3810` = `streams_sort` | 排序偏好 |
| `r0()` | `C0742.X0.f3810` | 列表缩放偏好（推断） |
| `m()` | `0x1000003c` | 见 §11.1 |
| `z()` | `0x12` = 18 | 分类序号（推断） |
| `k0()` | `this.В`（`g1`） | 父级导航 |
| `O(int)` | 排序表达式 | §8 |

### 11.1 `m()` = `0x1000003c` → `cat_stats.type = 60`

与年份（340 = `0x154`）、流派（210 = `0xD2`）同一套**位域编码**：

```java
// 父类 b1()
public final int b1() { return m() & 0x0FFFFFFF; }

// d4.m() = 0x1000003c
// 0x1000003c & 0x0FFFFFFF = 0x3C = 60
```

| 实体 | `m()` | 高位 `>>28` | `cat_stats.type` |
| --- | --- | --- | --- |
| `i4`（Year Albums） | `0x10000154` | 1 | 340 |
| `a1`（Genre Albums） | `0x100000D2` | 1 | 210 |
| **`d4`（Streams）** | **`0x1000003C`** | **1** | **60** |

**S4 未解**：60 的具体统计维度。

> 注意：流页的 `X0()` **不使用** `cat_stats`（只有年份/流派的第 2B 层用）。所以 `m()` 只有在流作为分类被统计时才生效。

---

## 12. 运行时：流怎么被播放

### 12.1 播放地址来源

流有两个「地址」：

| 位置 | 内容 | 角色 |
| --- | --- | --- |
| `folder_files.name` | URL 派生的显示名 | 列表显示用 |
| **`playlist_entries.folder_path`** | **完整 URL** | **播放时取源** |

⇒ 播放器需要 `playlist_entries` 的条目才能拿到真正的 URL，这解释了 `d4.t0()` 为何要 JOIN 它。

### 12.2 运行时状态

```
id/state_player_track_is_stream  0x7f0d070d
```

这是 StateBus 的状态 id，说明「当前曲目是否为流」在播放期是**可查询的运行时属性**。UI 可据此切换图标、禁用不适用操作。

### 12.3 流的专属设置生效点

| 设置 | 影响 |
| --- | --- |
| `stream_name_in_title` | 标题渲染：`Stream - Track Title` vs `Track Title` |
| `aa_per_stream_track` | 封面来源：track 元数据 vs 流名称 |
| `pref_stream_buffer` | 网络缓冲（起播延迟 vs 抗卡顿） |
| `pref_stream_timeout` | 网络超时 |
| `pref_use_stream3_player` | 用独立播放器实现（Hi-Res 输出场景） |

### 12.4 排除于统计之外

见 §4.4。流不参与专辑/艺术家/流派的计数，**这是保证分类页数据可信的关键**。

---

## 13. 与其它页面横向对照

| 维度 | 流 `d4` | 长 `d3` | 书签 `a0` | 最近播放 `r3` | 年份/流派 |
| --- | --- | --- | --- | --- | --- |
| 主表 | `folder_files` | `folder_files` | `bookmarks` | `folder_files`（子查询） | 分类表/关联表 |
| 产生方式 | **导入播放列表** | 扫描 | 用户收藏 | 播放记录 | 扫描+分组 |
| 筛选条件 | **`file_type=23`** | `duration >= 阈值` | — | 时间窗口 | 容器 id |
| 子查询 + LIMIT | 无 | 无 | 无 | **有** | 无 |
| FROM 构造 | **委托 `h1.o`** | 自拼 | 自拼 | 自拼 | 自拼 |
| folders JOIN | **LEFT** | **INNER** | INNER | LEFT | 各异 |
| 排序模式数 | **6（最少）** | 16 | 1（硬编码） | 16 | 3 |
| 过滤列 | **自有 3 列** | `p0` 四选一 | 自有 2 列 | `p0` 四选一 | `p0` 四选一 |
| 投影 | `p0.f3367` | `p0.f3367` | 自有 2 字段 | `p0.f3367` | `y`/`l.X` |

### 结构定位

```
容器类（年份/流派/专辑/艺术家）  →  行是「类别」
派生列表（最近/最多/评分/长）    →  行是「曲目」，按时间/计数/时长筛选
书签                            →  行是「曲目 + 状态快照」
流                              →  行是「曲目」，按【数据来源】分区
```

**流是唯一的「按数据来源分区」视图** —— 不是按行为（播放/评分）也不是按时长，而是按**曲目是怎么进来的**（扫描 vs 导入 URL）。

---

## 14. 可借鉴 / 不建议照抄

### 14.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **用 `file_type` 标记而非路径规则识别流** | 扫描/导入时一次性定标，查询零判断成本 |
| A2 | **在统计 SQL 中显式排除流**（§4.4） | 流无可靠 album/artist，混入会让分类页出现假条目 |
| A3 | **`X0()` 完全委托 `h1.o(...)`** | 4 行完成一个完整视图；共享构造器避免重复 JOIN 拼装 |
| A4 | **排序模式按数据特征裁剪**（16 → 6） | 只保留流的可靠维度，菜单不出现无意义选项 |
| A5 | **次级键统一回退 `name`** | 流 `title_tag` 不可靠，用文件名做 tie-breaker |
| A6 | **`LEFT JOIN folders`（流）vs `INNER`（长）** | JOIN 类型匹配数据模型，非随意选择 |
| A7 | **`t0()` 变体带 `playlist_entry_id`** | 流出现在播放列表时需要条目 id 才能删除/重排 |
| **A8** | **`artist_tag = "..."` 显式占位而非 NULL**（§3.7） | UI 不会因 NULL 崩溃，视觉上明确是占位。比 NULL 更防错 |
| **A9** | **导入前先建 `playlists` 行再解析条目**（§3.2） | 每个条目立即能绑定 playlistId，无需二次回填 |
| **A10** | **`#EXTINF` 解析只取逗号后部分**（§3.4） | 流的 duration 恒为 0，无需解析 `-1` 这类占位值 |

### 14.2 不建议照抄

| # | 做法 | 理由 |
| --- | --- | --- |
| **N1** | **`file_type` 用魔法数字 `23`，且无枚举定义** | 查询侧 `rVar.B("23")`、写入侧 INSERT 字面量 `23`，两侧无共享常量。改动时极易漏改一侧 |
| **N2** | **`i()` 返回 `stream_files` 但实际查 `folder_files`** | 元数据与实际查询不一致，追踪成本高 |
| **N3** | **`X0()` 与 `t0()` 逻辑高度重复未抽公共部分** | 两者 WHERE 几乎相同（`file_type=23` + cue 过滤），只差 `playlist_entries` JOIN 与投影。应参数化而非复制 |
| **N4** | **`h1.o()` 两个 boolean 参数无命名**（`z`/`z2`） | 调用点 `h1.o(..., true, true)` 完全看不出含义 |
| **N5** | **`file_type` 完整枚举缺失于可读层** | 23 只能从 INSERT 字面量反推，无 `FILE_TYPE_STREAM` 常量 |
| **N6** | **`d4.H()` 返回 `null`** | 与其他方法的字符串返回不一致，用途不明 |
| **N7** | **`artist_tag = "..."` 是硬编码字面量，未走资源**（§3.7） | `meta` 走了 `R.string.stream`（可本地化），`artist_tag` 却是裸 `"..."`。同一方法内两种风格 |
| **N8** | **URL 存两处**（`folder_files.name` + `playlist_entries.folder_path`） | 冗余存储，需保证两处同步。仅存 `playlist_entries` 更清晰 |
| **N9** | **`.m3u` 条目也被当作流插入**（§3.5 的 `goto stream`） | 嵌套播放列表引用与真实流共用 `file_type=23`，语义混杂 |
| **N10** | **`#EXTINF` 的 duration 被丢弃** | 已知 `duration=0` 不可靠，但至少可存原始声明值供调试 |

---

## 15. 与 SpMusic 对照

### 15.1 SpMusic 现状

`src/features/player/model/mediaLibraryCategories.ts` **已定义 `streams` 分类**：

```typescript
{ id: 'streams', label: '流', icon: streams, overviewIcon: overview10, ... }
```

但**无对应面板组件**（`components/` 下无 `Stream*` 组件），属占位分类。

### 15.2 维度对照

| # | 维度 | Poweramp | SpMusic 现状 |
| --- | --- | --- | --- |
| 1 | 流页 | `folder_files` + `file_type=23` 过滤 | **占位分类** |
| 2 | 流产生 | 导入 M3U/PLS 时插入 | 无 |
| 3 | 协议范围 | **仅 http/https** | — |
| 4 | 统计排除 | 专辑/艺术家统计显式排除 | 无 |
| 5 | 排序裁剪 | 6 模式 | 单一 `compareByQuickIndex` |
| 6 | 标题格式 | `stream_name_in_title` 可切换 | 无 |
| 7 | 封面来源 | `aa_per_stream_track` 可切换 | 无 |
| 8 | 缓冲/超时 | 独立设置 | 无 |

### 15.3 最小实现建议

流页是**成本最低的分类页**：不需要新表、不需要新分类模型。

| 组件 | 建议 |
| --- | --- |
| 识别 | 扫描/导入时给 track 打 `isStream` 布尔或 `source: 'file' \| 'stream'` |
| 导入 | 若做 M3U/PLS 导入，按 §2.1 只认 `http(s)://` |
| 列表 | 曲目列表加 `isStream === true` 过滤，复用 all-songs 渲染 |
| **统计** | **专辑/艺术家 `numFiles` 统计必须排除流**（Poweramp §4.4 的做法） |
| 排序 | 只提供「名称 / 评分 / 播放次数 / 最近播放 / 随机 / 添加时间」六种 |
| 标题 | 可选 `streamNameInTitle` 开关 |
| 封面 | 可选 `aaPerStreamTrack` 开关 |
| URL 存储 | **只存一处**（建议 `playlist_entries` 或独立 `stream_url` 字段），不要学 N8 的双写 |

**两个必须注意的点**：

1. **专辑/艺术家页若用「GROUP BY 后计数」，必须先排除流**，否则出现「某专辑只有 1 首流」的假条目。
2. **流的播放地址不在曲目表里**。若 SpMusic 的播放器从曲目记录取 `filePath`，接入流时需要额外一条从 `playlist_entries`/`stream_url` 取源的路径。

---

## 16. 未解

| # | 问题 | 优先级 |
| --- | --- | --- |
| **S1** | `file_type` 完整枚举（23 之外的取值） | 中 |
| **S3** | `stream_files` 是否为 VIEW（`i()` 返回它但查询用 `folder_files`） | 中 |
| **S8** | `t0()` 的 `К` 参数（`com.maxmpz.audioplayer.data.api.К`）用途 | 中 |
| **S9** | `folder_files.name` 对流的实际取值格式（URL 原文？去协议？截断？） | 中 |
| **S10** | XML 分支（PLS/XSPF）的解析细节与字段映射 | 中 |
| **S11** | 流播放时的实际取源路径（哪个方法读 `playlist_entries.folder_path` 交给解码器） | **高** |
| S2 | `h1.o()` 的 `z2` 参数确切语义（推断为前置 AND 控制） | 低 |
| S4 | `cat_stats.type = 60` 的统计维度 | 低 |
| S5 | `d4.H()` 返回 `null` 的用途 | 低 |
| S6 | `d4.r0()` 对应的 `C0742.X0` 偏好键名 | 低 |
| S7 | `d4.z()` 返回 18 的语义（分类序号？） | 低 |

> **S11 是把「流能显示」推进到「流能播放并能 seek」的最后一步。**
> 已知 URL 在 `playlist_entries.folder_path`，但播放器如何取它、如何与解码器交接，本轮未追。

---

## 17. Evidence ID 索引

| 主题 | Evidence ID |
| --- | --- |
| **`d4.X0`（流列表 SQL，全库最短）+ 类摘要** | `ev_e9a30d2e844e61705552af9c2ce56f07ff17ae4da25af1e39f6520744cab05d1` |
| **`d4.O(int)`（6 模式排序）** | `ev_1d67f187a0333617b0597b3222ed3c9b2e033e37cf029d046a804dfd0b6541c9` |
| **`h1.o()`（共享 FROM/JOIN 构造器）** | `ev_e19d78e86457c7a8587ffe99bceea44298b27f29285f4a43e2afeadc186fc33f` |
| **`d4.i()`（`"stream_files"`）** | `ev_97464c0a687ca073e4dcc78896eae7492cf70a932e6ab3ab3196e0a8afff5af1` |

### 17.1 创建链路证据（smali 反汇编）

创建链路全部通过 apktool `--no-res` 反汇编取证（7308 个 `.smali`，单 dex 6.35 MB）。

| 主题 | 来源文件与位置 |
| --- | --- |
| `y.С(String)` http/https 判定 | `smali/okhttp3/internal/platform/android/y.smali:3171-3283` |
| `y.C(String)` `.m3u`/`.m3u8` 判定 | 同上 `:55-145` |
| `y.o(String)` `data:` 判定 | 同上 `:3284-3344` |
| `X.B(String,String)` 导入入口 | `smali/com/maxmpz/audioplayer/scanner/X.smali:377-582` |
| `X.Х(...)` 格式分发（778 行） | 同上 `:2000-2777` |
| `X.х(...)` M3U 解析 | 同上 `:2878-3370` |
| `X.x(...)` 分流 | 同上 `:698-1035` |
| `X.у(...)` 流插入 + playlist_entries | 同上 `:2778-2877` |
| `X.y(...)` folder_files 字段绑定 | 同上 `:1036-1299` |
| 流 INSERT SQL（`file_type=23`） | `smali/com/maxmpz/audioplayer/scanner/х.smali:196-206` |
| 统计排除 `file_type!=23` | `smali/com/maxmpz/audioplayer/scanner/library/K.smali:757,785,813,841` |
| 18 个预编译语句字段映射 | `scanner/X.smali:69-263`（`<init>`） |

资源来源：`.rea-analysis/decoded/res/values/strings.xml`、`.rea-analysis/decoded/res/values/public.xml`（apktool 3.0.3，已入库）。

复现命令：

```powershell
$env:JAVA_HOME = "<rea-bundle>/vendor/jdk"
apktool d --no-res -f -o <out> .rea-analysis/Poweramp-v3.apk
# 然后在 <out>/smali 中搜索：
#   const-string ... "pos_ms"      （字符串字面量定位法）
#   const-string ... "file_type"
#   scanner/X;->Р
```

> **方法论**：需要定位某个**字符串字面量**的所有引用点（而非某类/某方法）时，JADX 的检索能力不足，必须落到 smali 层做文本搜索。

---

## 18. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| `poweramp-recents-views.md` | 派生/筛选列表（最近/最多/评分/长）+ 共用排序映射 `p0.O` |
| `poweramp-bookmarks-view.md` | 书签（独立表 + 位置快照） |
| `poweramp-category-views.md` | 年份/流派双路径四层容器；本文 §11.1 引用其 `cat_stats.type` 位域编码 |
| `poweramp-entity-views.md` | 专辑/艺术家/专辑艺术家/作曲家 |
| `poweramp-library-three-views.md` | 所有歌曲/文件夹/文件夹层次结构；本文 §5.2 的投影 `p0.f3367` 与其同源 |
| `poweramp-queue-runtime-reference.md` | 队列状态机。流的播放队列行为未覆盖 |
| `poweramp-search-and-queue-impact.md` | 搜索。本文 §9.1 的过滤列机制与其相关 |
| `media-library-page-relationships.md` | SpMusic 三页面现状 |
