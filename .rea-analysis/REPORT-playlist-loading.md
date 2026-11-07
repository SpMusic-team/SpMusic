# Poweramp 播放列表加载逻辑 — 逆向分析总报告

| | |
|---|---|
| 目标 | `Poweramp.apk.1` / `com.maxmpz.audioplayer` |
| 版本 | `build-1025-uni` (versionCode 1025009) |
| SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 体积 / 类数 | 20,449,483 B / 6,218 个顶层类（单 `classes.dex`，强混淆） |
| SDK | minSdk 21, targetSdk 35, compileSdk 36 |
| Native | `libpowerampcore.so` (3.59 MB)、`libffmpeg_neon.so`、`libyayicn.so` |
| 引擎 | REA + JADX 0.7.1（headless）/ Apktool 3.0.3 / Ghidra 12.1.4 可用 |

> 标注约定：**[实证]** = 实际读到的反编译代码/字符串字面量；**[推断]** = 基于实证的推理。
> 分片明细见：`findings-core.md`（运行时期）、`findings-db.md`（持久层）、`findings-format.md`（文件格式）。

---

## 0. 一句话结论

Poweramp **没有一个叫 `loadPlaylist()` 的集中函数**。播放列表加载被拆成**三条互不相交的链路**：

```
① 文件导入链路   .m3u/.m3u8/.pls/.wpl  ──scanner.X──▶  playlist_entries 行
② 播放加载链路   "播放某列表"           ──PlayerService.E──▶ b0.toUriCore ──▶ SQL Cursor（队列本体）
③ CUE 虚拟轨链路 .cue                   ──data.cue.*──▶ folder_files 虚拟行（完全不碰 playlist_entries）
```

**最关键的架构事实：播放队列不是数组，而是一个活的 `Cursor`。**
上/下一首 = 移动游标；排序在 SQL 里用 `ORDER BY sort` 决定；随机播放 = 换掉 `ORDER BY`，而非重排数据。

---

## 1. 存储层：`folders.db`

**纯 Java SQLite，无 JNI。** `data.C0633 extends SQLiteOpenHelper`：
```java
super(app, "folders.db", null, 244);   // 版本号 244
setWriteAheadLoggingEnabled(true);
setMaxSqlCacheSize(55);
```

### 只有两张播放列表表

```sql
-- playlists（注意：显示名列叫 playlist，不叫 name）
CREATE TABLE playlists(
  _id INTEGER PRIMARY KEY, playlist TEXT, mtime INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT 0, updated_at INTEGER, playlist_path TEXT,
  played_at INTEGER NOT NULL DEFAULT 0, aa_status INTEGER NOT NULL DEFAULT 0,
  num_files INTEGER DEFAULT 0, shuffle_order INTEGER DEFAULT 0
);
-- 后续 ALTER 追加：
--   num_all_files, keep_list_pos, keep_track_pos, duration

-- playlist_entries（曲目成员）
CREATE TABLE IF NOT EXISTS playlist_entries(
  _id INTEGER PRIMARY KEY, folder_file_id INTEGER, playlist_id INTEGER
);
-- 后续 ALTER 追加：
--   sort, shuffle_order, folder_path, file_name, cue_offset_ms, played_at
CREATE INDEX playlist_entries_index1 ON playlist_entries(playlist_id);
CREATE INDEX playlist_entries_index2 ON playlist_entries(folder_file_id);

-- 级联删除
CREATE TRIGGER playlists_trigger DELETE ON playlists BEGIN
  DELETE FROM playlist_entries WHERE playlist_id = old._id;
END;
```

**没有 `tracks` / `files` 表。** 音频行在 `folder_files` 里，播放列表**JOIN** 过去。
**没有播放列表文件夹** —— 无 `folder_id` / `parent_id`；播放列表是**扁平有序列表**，分组只是 UI 层。

### 曲目顺序 = `playlist_entries.sort`

```sql
-- 引入于 schema step i<30，并回填
ALTER TABLE playlist_entries ADD COLUMN sort INTEGER;
UPDATE playlist_entries SET sort = _id;      -- 旧库顺序 == 插入 id
```
`k3.X0` 里 `i1Var.B = "sort"` 即默认 ORDER BY。随机播放用**独立的** `shuffle_order` 列 + `?shs` 参数切换 ORDER BY，**不破坏 `sort`**。

### 成员是"软引用"，不是硬外键 ← 最值得借鉴的设计

`playlist_entries.folder_file_id` **可为 NULL**。持久身份是 **`folder_path` + `file_name`（+ `cue_offset_ms`）**，
`folder_file_id` 只是缓存。媒体库重扫后 id 会变，由修复器 `j3.c1(db)` 重新解析：

```sql
-- 1. 作废失效链接
UPDATE playlist_entries SET folder_file_id=NULL
WHERE _id NOT IN (
  SELECT pe._id FROM playlist_entries pe, folder_files, folders
  WHERE folder_file_id = folder_files._id
    AND folder_files.name = pe.file_name COLLATE NOCASE
    AND folders.path = folder_path COLLATE NOCASE
    AND folder_files.folder_id = folders._id
    AND (folders.is_cue = 0 OR folder_files.offset_ms = cue_offset_ms))
AND folder_file_id IS NOT NULL AND folder_path IS NOT NULL AND file_name IS NOT NULL;
```
然后跑 **4~5 轮递进的 TEMP TABLE 匹配**（父目录+短名 LIKE → 仅短名 LIKE → CUE offset 匹配 →
`SUBSTR(playlist_path,…)` 相对路径匹配 → 名称+目录兜底），修好后失效库缓存。

> **对重写的启示**：播放列表成员应当**按路径持久化、可重新推导**，而不是绑定媒体库自增 id。

### 迁移史里的一个坑

旧版把播放列表建模成文件夹（`folder_playlists` / `folder_playlist_entries`）；
step `i<83`（`M83_beta`）迁移为独立表：
```sql
INSERT INTO playlists(_id,playlist,mtime,created_at,updated_at,playlist_path,played_at)
  SELECT _id, name, mtime, created_at, updated_at, path, played_at FROM folder_playlists;
DROP TABLE IF EXIST folder_playlists;                      -- 注意：拼写错误，少一个 S
ALTER TABLE folder_playlist_entries RENAME TO playlist_entries;
```
`DROP TABLE IF EXIST`（少 `S`）在 `catch(Throwable){}` 里被静默吞掉 ⇒ **旧表从未真正删除**。

---

## 2. 查询层：ContentProvider + 手写 SQL 组装

```
authority  com.maxmpz.audioplayer.data  →  rest.RestProvider      ← 播放列表走这个
authority  com.maxmpz.audioplayer.aa    →  data.aa.AAContentProvider ← query() 是 return null 空壳
```
基址 URI 在 `g1.<init>` 里构造：`content://com.maxmpz.audioplayer.data` **[实证]**

### 调用链

```
RestProvider.query(uri, proj, sel, args, sort)
 └─ A(uri, proj, sel, args, sort, false)          // 唯一真正干活的方法
     ├─ z5.B(g1, uri.getPathSegments())            // 段 → URIMatch 描述符
     ├─ h1.d(...)  → 实体（j3 / k3 / m3 / …）
     ├─ db = getWritableDatabase()                 // 读也走可写句柄
     ├─ 实体.X0(...) 设置 rq.A(表/JOIN) 并追加 WHERE
     └─ player.r.K(rq, db, proj, sel, args, groupBy, sortOrder, limit)
          └─ player.r.X(...) 拼 SQL
               → db.rawQueryWithFactory(C0629, sql, args, findEditTable(rq.A), null)
```

`player.r.X` 拼装顺序：`SELECT <proj|*> FROM <rq.A> [WHERE (实体谓词) AND (调用方 selection)] [GROUP BY] [ORDER BY] [LIMIT]`

### 播放列表的实际 SQL

**列表**（`j3.X0`）：`rq.A = "playlists"`，默认投影 `{"playlists._id"}`；
`?no_empty` → 加 `playlists.num_files != 0`。

**成员**（`k3.X0`）：
```sql
SELECT <proj>
FROM playlist_entries
LEFT JOIN folder_files ON folder_files._id = folder_file_id
LEFT JOIN folders      ON folders._id      = folder_id
LEFT JOIN albums       ON albums._id       = folder_files.album_id
LEFT JOIN artists      ON artists._id      = folder_files.artist_id
[LEFT JOIN album_artists ON album_artists._id = folder_files.album_artist_id]
WHERE (playlist_id = ? [AND folder_files.cue_folder_id IS NULL]) AND (<selection>)
ORDER BY sort
LIMIT <lim>
```
`playlist_id` 取自 URI **最后一段**（`androidx.appcompat.widget.f.d(uri)`）；
列表元信息（`j3.i0`）取 **index 1 段**（`f.e(1, uri)`）⇒ 播放列表详情 URI 是 **2 段式**。

投影常量 **[实证]**：
- `j3.j0()` = `{"playlists._id"}`
- `j3.j()` = `{"folder_files._id", "COALESCE(folder_files.file_path,path||folder_files.name,folder_files.name)", "folders.is_cue", "cue_folder_id", "folders._id", "folder_files._id", "file_type"}`
- `k3.V()` = `"playlist_entries._id"`
- 标题三件套：`COALESCE(title_tag,file_name)`、`COALESCE(album,'')`、`COALESCE(CASE folder_files.album_artist_id WHEN 1000 THEN artist ELSE album_artist END,'')`

### 查询参数

| 参数 | 作用 |
|---|---|
| `no_empty` | 只要非空列表：`playlists.num_files != 0` |
| `shs` | 切换随机 ORDER BY（不修改 `sort`） |
| `lim` | `LIMIT`，**唯一有注入校验的参数** |
| `reshf` | 重新洗牌该实体 |
| `shf_no_cur` | 洗牌时排除当前曲目 |

**安全边界**：只有 `lim` 有正则白名单 `\s*[\d?]+\s*(,\s*[\d?]+\s*)?`，不匹配抛
`IllegalArgumentException("invalid LIMIT clauses:…")`。
`selection` / `selectionArgs` / `sortOrder` / `projection` **全部原样拼进 SQL**。
另外 `Lim`/`orderBy` 之外 `shs` 触发实体 `V0()` 生成 ORDER BY。**没有 `UriMatcher`，没有列白名单。**

### 分页：不是 LIMIT/OFFSET

`h1.C(...)` 做的是 **id 集合再查询**：
```java
if (ids.length != 0 && i < ids.length && i + i2 <= ids.length) {
    StringBuilder sb, sb2;
    if (entity.e0(uri, ids, i, i2, i3, sb, sb2, z)) {   // 生成 "col IN (id…)"
        String[] p = proj == null ? entity.j() : proj;
        if (i4 > 0) sb2.append(" LIMIT ").append(i4);
        return rp.A(uri, p, sb.toString(), null, sb2.toString(), false);  // 再走一遍完整链路
    }
}
return null;
```
四个 int = **(起始下标, 数量, num_cats 门控, LIMIT)**。
`num_cats > 0 && num_cats == count` 才发 `IN(...)`，否则**直接返回 null**（fail-closed，永不发无界查询）。
`IN` 列表长度无上限 ⇒ 5 万首列表会生成 5 万元素的 SQL 字面量。

---

## 3. 播放加载链路（真正的"加载播放列表"）

```
PlayerService.E(Uri, boolean, int, int, int, Intent, String) : int
 └─ b0.toUri(Uri, boolean, int, boolean, Intent) : int
     └─ b0.toUriCore(Uri, boolean, int, boolean) : int
         ├─ g1.m2442(uri) → 实体
         ├─ prepareFilesUri(...) → 文件集 URI
         ├─ getParentCategoryListUriMatch(...) → 父分类（支持"下一分类"导航）
         ├─ o0.mo2425(uri) → 目标 id
         ├─ loadFilesCursorAndSetState(...)   ← 真正装载
         └─ commitShuffle(...)
 └─ PlayerService.L(...) → PlayerService.J(track, ...)
```

`E` 是薄封装 **[实证]**：
```java
public final int E(Uri uri, boolean z, int i, int i2, int i3, Intent intent, String str) {
    this.a = 0;
    if (this.f2900 == null) { z5.m1551("PlayerService", "no pipeline"); return 0; }
    b0 b0Var = this.y;                                   // 队列管理器
    if (b0Var == null) { Log.e("PlayerService", "no RNP"); return 0; }
    int shuffleMode = b0Var.getShuffleMode();
    int iL = L(this.y.toUri(uri, z, -1, false, intent), i, i2,
                (i3 == 1 || i3 == 2) ? 5 : 0, i3, "play ".concat(str));
    if (this.y.getShuffleMode() != shuffleMode) { c0(false, true); }
    return iL;
}
```

### `b0` = 「RestNowPlaying」队列管理器

91 方法 / 45 字段。关键状态：

| 字段 | 类型 | 作用 |
|---|---|---|
| `mFilesCursor` | `Cursor` | **队列本体**（结果集游标） |
| `mCatCursor` | `Cursor` | 父分类游标（如列表页） |
| `mContentProvider` | `rest.RestProvider` | 取游标 |
| `mDb` | `SQLiteDatabase` | 直接句柄（洗牌写回） |
| `mStatementCache` | `rest.library.c3` | 预编译语句缓存 |
| `m/CurrentTrack` | `player.g0` | 当前曲目（47 字段模型） |
| `mShuffle` / `mRepeat` | `int` | 随机/循环模式 |
| `mRawFileMode` | `boolean` | 播放库外裸文件模式 |

导航 API：`next(boolean,boolean)` / `prev()` / `nextCategory(boolean)` / `prevCategory(boolean)` /
`moveFilesCursorToId(Uri)` / `moveToFirstNotPlayedQueueEntryOrLast()` / `toPos(int)` / `exitQueueImpl()`。

### `toUriCore` 解析算法（完整还原）

1. **洗牌解析** `s = extractShuffle(uri); if (s==-1) s = mShuffle; if (i!=-1) s = i;`
   `s != 0` 时读 `?reshf`。
2. **实体解析** `x2 e = mRestLibrary.m2442(uri);` 非 `o0` 则解包 `w1`；仍非 → 日志 + **return -6**。
3. **降级** `if (s==1 && !noCur && (e instanceof t2)) s = 2;`
4. **URI 重写** `filesUri = prepareFilesUri(e, uri, s);`
5. **父分类** `f4 cat = getParentCategoryListUriMatch(e, filesUri, s);`
6. **目标 id** `long id = e.mo2425(filesUri);`
7. **CUE/队列 id 重映射** `if (cat.f3309 instanceof w1) id = ((w1)cat.f3309).N(mDb, id, s==2 && C0732.U.f3789);`
8. **复用判定** 若新旧 `mFilesUri` 的 **path 与 query 都相同**，复用已装载游标（不重查）。
9. **装载** `loadFilesCursorAndSetState(...)`，成功则 `mCatCursor = cursor; mCatUriMatch = cat;`
10. **定位** `moveFilesCursorToId(uri)`；失败且队列模式 → `moveToFirstNotPlayedQueueEntryOrLast()`；否则 `moveToFirst()`。
11. **提交** `if (result > 0) commitShuffle(s);`

返回 `>0` 成功，`-6` 失败。失败码在 `L()` 里映射到 Toast：
`-1` → `no_files_in_the_db`；`-3` → `end_reached`；`-4` → `start_reached` / `shuffle_history_start_reached`。

### 队列装载的两个关键细节

`loadFilesCursorAndSetState` 里 **[实证]**：
```java
cursorA = this.mContentProvider.A(uriToLoad, null, null, null, null, false);  // 走 §2 的 SQL
```
**递归保护**：`if (i2 < 3) return loadFilesCursorFromCatCursor(..., i2+1, ...);`
else `Log.e("RestNowPlaying", "loadFilesCursorAndSetState too much self calls ...")` → `-6`。
最多 3 层分类下钻。

**随机播放走的是 FILES 实体，不是播放列表表** **[实证]**：
```java
n0 files = mRestLibrary.getFiles();
Uri.Builder b = mRestLibrary.getFiles().B0().buildUpon();
if (id != 0) b.encodedFragment(String.valueOf(id));
b.appendQueryParameter("shs", "1");
```
⇒ **「随机播放某列表」= 对全局 files 实体做洗牌视图**，而非遍历 `playlist_entries`。
这是最容易踩坑的行为差异。

### 队列 vs 播放列表的 SQL 差异

| | `k3`（播放列表成员） | `m3`（队列） |
|---|---|---|
| 基表 | `playlist_entries LEFT JOIN folder_files` | **`queue INNER JOIN folder_files`** |
| 谓词 | `playlist_id = ?` + 参数 | **无**（队列是全局的） |
| CUE 过滤 | `AND folder_files.cue_folder_id IS NULL` | **无** |
| 排序 | `"sort"` | **`"queue.sort"`** |

`queue` 是**独立表**（`_id, folder_file_id, created_at, sort`）。
⇒ **「加入队列」是把播放列表复制成 `queue` 行，不是对 `playlist_entries` 建视图。**

---

## 4. 文件导入链路（M3U / M3U8 / PLS / WPL）

### 调度器 `scanner.X#m2473`

```java
String ext    = AbstractC0582.m1900(str2).toLowerCase(Locale.ROOT);  // 最后一个 '.' 之后
String prefix = AbstractC0582.m1898(str);                            // 目录，含尾部 '/'
switch (ext.hashCode()) {
  case 106447:  /* "m3u"  */ m2475(prefix, str, id, false, ...); return;   // false ⇒ 非 UTF-8
  case 111095:  /* "pls"  */ <PLS 行循环>;
  case 117939:  /* "wpl"  */ <WPL XmlPullParser 循环>;
  case 3299913: /* "m3u8" */ m2475(prefix, str, id, true,  ...); return;   // true  ⇒ UTF-8
}
m2475(prefix, str, id, true, ...);   // ← 兜底：任何其它扩展名都当 M3U 解析
```

**注意**：`cue` **不在**这个调度器里。未知/缺失扩展名 → **静默按 M3U 解析**（无 `default` 中止）。

### 编码：BOM 永远覆盖扩展名

```
.m3u8 → UTF-8      .m3u → Charset.defaultCharset()
```
但两者都经过 `data.C0630`（4 字节 `PushbackInputStream` BOM 嗅探）：

| 首字节 | 实际编码 |
|---|---|
| `EF BB BF` | UTF-8 |
| `FE FF` | UTF-16BE |
| `FF FE` | UTF-16LE |
| `00 00 FE FF` | UTF-32BE |
| `FF FE 00 00` | UTF-32LE |
| 其它 | 调用方指定 |

⇒ 带 UTF-16LE BOM 的 `.m3u8` 会按 UTF-16LE 解码。

### M3U 行处理

```
每行: trim → 长度 <= 4 跳过 → 首字符 '#' ? 指令 : 一条条目
  #EXTINF:<秒>,<标题>   → 只取 ',' 之后的标题，时长丢弃
  #EXT-X-RATING:<int>   → 评分（需 ratingsEnabled）
  #EXT-X-{STREAM-INF,VERSION,MEDIA-SEQUENCE,PLAYLIST-TYPE}: 且已有条目 → HLS，中止并整体 base64 内联
  其它 # 行 → 忽略
```

### 路径解析（无 `./` `../` 折叠、无 URL 解码）

1. 首字符非 `/`：
   1. Windows 盘符 `C:\…` / `C:/…` → `"/" + substring(3)`（`C:\Music\x.mp3` → `/Music/x.mp3`）
   2. `http://` / `https://`（或 `data:`、`.m3u`）→ 流条目
   3. 非 `@` 前缀、非 `content:` → **`路径 = 播放列表目录 + 原始行`**
2. 绝对路径 / `content:` / `@` → 原样使用

`m1898(path)` = `substring(0, lastIndexOf('/')+1)`（`lastIndexOf >= 1` 时）。

### PLS：**只认 `FileN=`**

```java
if (!startsWith(line,"File",0,true) || (eq = indexOf(line,'=')) <= 0) continue;
String value = trim(line.substring(eq+1));
if (value.length() > 4) if (x(prefix, value, null, id, n, ...) != 0) n++;
```
`[playlist]`、`TitleN=`、`LengthN=`、`NumberOfEntries=`、`Version=` **全部读后丢弃**。
排序用**循环计数器 `n`**，不是 `FileN` 里的 `N` ⇒ 乱序/跳号的 PLS 顺序不保留。
基础编码硬编码 UTF-8（BOM 仍可覆盖）。

### 错误处理（导入）

| 情形 | 行为 |
|---|---|
| 播放列表文件不存在/不可读 | **`DELETE FROM playlists WHERE _id=?`** ← 直接删掉整个列表 |
| 单行失败 | 吞掉，不计入，不影响其它行 |
| 引用文件缺失 | **不报错**：插入占位行并返回**负 id**，条目保留为"未解析" |

第一条是**破坏性**的：SD 卡拔掉 / SAF 授权丢失 → 列表被清空。

---

## 5. CUE：另一条完全独立的链路

**CUE 不会写 `playlist_entries`。** 它把一个音频文件切分成 N 条**虚拟 `folder_files` 行**。

| 类 | 角色 |
|---|---|
| `data.cue.C0606` | JFlex 生成的词法器（4 状态 DFA） |
| `data.cue.A#B` | 递归下降解析器 |
| `data.cue.C0608` | 整张表结果 |
| `data.cue.C0607` | 一条 `FILE` |
| `data.cue.X` | 一条 `TRACK` |
| `data.cue.B` | 一条 `INDEX`（时间点） |
| `scanner.library.C0760` | 扫描批处理驱动 |

**基础编码 ISO-8859-1**（`new C0630(fis, StandardCharsets.ISO_8859_1)`），BOM 可覆盖。

支持的指令：`TITLE` / `PERFORMER` / `FILE` / `TRACK` / `INDEX`，外加两个浮点 gap 指令。
**`REM` 没有任何分支** ⇒ 整行被消费后丢弃（含 `REM GENRE`、`REM REPLAYGAIN_*`）。
**`INDEX 00` 被丢弃**（`if (idx != 0)`）。

时间换算（75 帧/秒 → 毫秒）：
```java
this.x = ff % 75;  int s = (ff/75) + ss;
this.X = s % 60;   this.A = (s/60) + mm;
int m1986() { return ((x*1000)/75) + (X*1000) + (A*60000); }
```

### 一文件 → N 曲

1. `file.B.size() <= 1` 或图片未解析成功 → **整个 FILE 跳过**（0 或 1 轨不产生虚拟轨）
2. 起始 = 该轨 `INDEX 01`；结束 = 下一条有 index 的轨的 `INDEX 01`，否则整文件 `duration`
3. `end - start > 0` 才产出
4. 轨道号必须 `1..999`
5. 无 index 的轨 → `Log.e("CueBatchProcessor","addTrackToBatch SKIP as no CIE indicies …")`（原文拼写错误）

驱动查询：`SELECT … FROM folders WHERE is_cue=1 AND (num_files=0 OR updated_at=-1)`
⇒ 虚拟轨落在 `folder_files`（`offset_ms`、`cue_folder_id`）与 `folders`（`is_cue`）上，
这正是 §2 里 `folder_files.cue_folder_id IS NULL` 过滤所保护的对象。

---

## 6. 导出

`PlaylistsExportActivity` → `dialogs.B#run` → `rest.library.H#B`（同样是 4 分支扩展名调度）
→ 写入器在 **`com.pixplicity.htmlcompat.i`**（混淆器复用的包名）：`m3120`=M3U/M3U8、`B`=PLS、`m3119`=WPL。

- **GUI 只会产生 `.m3u8`**（若名字不以 `.m3u8` 结尾则自动追加）。
- M3U 输出体：
  ```
  #EXTM3U\r\n
  每条: #EXT-X-RATING:<rating>\r\n  [ #EXTINF:-1,<title>\r\n ]  <path>\r\n
  ```
- **绝对 → 相对**：用 `path.regionMatches(0, prefix, 0, prefix.length(), true)`（**忽略大小写**）匹配
  目标文件所在目录，命中则 `substring(prefix.length())`。
- 导出用的 SQL 与 §2 同源，但自己拼绝对路径：
  ```sql
  SELECT COALESCE(COALESCE(folder_files.file_path, path||folder_files.name, folder_files.name),
                  folder_path||file_name, file_name) AS _path,
         COALESCE(folder_files.title_tag, folder_files.name, file_name) AS _title,
         folder_files.duration, folder_files.rating, folder_files.file_type,
         folder_files.name_without_number
  FROM playlist_entries
  LEFT JOIN folder_files ON folder_files._id = folder_file_id
  LEFT JOIN folders      ON folders._id = folder_files.folder_id
  WHERE playlist_id = ? ORDER BY sort
  ```
- 三个写入器**都不写 BOM**。

---

## 7. 完整数据流（一张图）

```
  用户在列表页点「播放」
        │
        ▼
  PlayerService.E(content://com.maxmpz.audioplayer.data/<seg>/<playlistId>)
        │
        ▼
  b0.toUri ──▶ b0.toUriCore
        │           │
        │           ├─ g1.m2442(uri) ──────────▶ 实体 j3 / k3 / m3 / …
        │           ├─ prepareFilesUri / getParentCategoryListUriMatch
        │           ├─ loadFilesCursorAndSetState
        │           │       └─ RestProvider.A
        │           │             └─ 实体.X0 → rq.A="playlist_entries LEFT JOIN …"
        │           │                → player.r.X 拼 SQL
        │           │                → rawQueryWithFactory
        │           │                   SELECT … FROM playlist_entries … ORDER BY sort
        │           │                      │
        │           │                      ▼
        │           │             b0.mFilesCursor  ◀── 队列本体（活游标）
        │           └─ commitShuffle / moveFilesCursorToId
        ▼
  PlayerService.L ──▶ PlayerService.J(track, …) ──▶ Pipeline2 ──▶ libpowerampcore.so
```

---

## 8. 若要重写一个等价实现，需要照抄的 9 条

1. **成员按路径持久化**（`folder_path` + `file_name`），库 id 只作缓存；重扫后跑多轮递进式重解析。
2. **顺序用显式 `sort` 整数列**，别依赖插入顺序；随机用**独立列**，不要破坏 `sort`。
3. **队列用游标/惰性迭代器**，不要把小列表复制成大数组——但注意 Poweramp 的 `IN(...)` 无长度上限是个缺陷。
4. **过滤掉失效成员要 fail-closed**：库里查不到就整条查询返回空，而不是发无界查询。
5. **区分"播放列表"与"队列"两张表**；加入队列 = 复制。
6. **随机播放播放列表 ≠ 遍历播放列表**——Poweramp 是对全局 files 做洗牌视图。想保持语义一致就得照做；想更直观就按成员洗牌（需明确取舍）。
7. **`no_empty` / `shs` / `lim` 这类 query 参数的语义**比 SQL 本身更影响行为一致性。
8. **导入时 BOM 优先于扩展名**；`.m3u` 与 `.m3u8` 的默认编码不同（平台默认 vs UTF-8）。
9. **别照抄两处缺陷**：`DROP TABLE IF EXIST`（少 S，且被 catch 吞掉）、播放列表文件缺失就删整张表。

---

## 9. 已知空白（诚实标注）

| # | 空白 | 影响 |
|---|---|---|
| 1 | `z5.B(...)` URI 段匹配器本体未反编译 | **只缺各实体的 URI 段字符串**（如 `/playlists` vs `/playlist`）；表名、SQL、基址均已实证 |
| 2 | `PlayerService.J(...)` 本体未读 | 只管"开始播放"的管线交接，不影响加载语义 |
| 3 | `prepareFilesUri` / `getParentCategoryListUriMatch` 本体未读 | URI 重写规则细节未读 |
| 4 | `AbstractC0743.V0()` 随机 ORDER BY 表达式未读 | 洗牌算法未知 |
| 5 | `C0742` 常量类未枚举 | 若干特性开关取值未知 |
| 6 | `C0629` CursorFactory 的反射字段 `f2736` 目标未定 | 可能给游标设窗口/行上限 |
| 7 | CUE 关键字 → token id 映射未解（JFlex 打包表） | 指令识别靠"字段消费方式"推断，非字面量 |
| 8 | `offset_ms` / `cue_offset_ms` 的 SQL 绑定在 `scanner.library.C0753` | CUE 虚拟轨落库细节未读 |
| 9 | `b0#loadFilesCursorAndSetState` 的 JADX 控制流有损坏（"Code duplicated"） | 结构可信，逐分支精确性不可信；已只保留可证实部分 |

**未发现任何 JNI/原生参与播放列表加载**：`libpowerampcore.so` 在可观测范围内只涉及解码/音频管线。
这是"未发现"而非"已证明不存在"。

---

## 附：分析产物

| 文件 | 内容 |
|---|---|
| `findings-core.md` | 运行时解析链路、`b0` 队列管理器、`toUriCore` 算法、Provider/URI 实证 |
| `findings-db.md` | `folders.db` schema、迁移史、Provider 查询路径、分页、队列 vs 列表 |
| `findings-format.md` | M3U/M3U8/PLS/WPL/CUE 解析、导出、错误处理、逐条证据表 |
