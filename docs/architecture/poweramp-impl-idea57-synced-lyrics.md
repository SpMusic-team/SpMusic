---
doc_id: "ARCH-POWERAMP-IMPL-IDEA57-SYNCED-LYRICS"
title: "已实现投票逐条逆向 #2：Synced/Scrolling Lyrics from tags and LRC files（idea 57）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni (versionCode 1025009)"
revision: 1
open_items: 1
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 继续逐条逆向已实现投票（本条要求深挖）"
  - "docs/architecture/poweramp-feature-votes.md"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/data/lyrics/**（13 类 4698 行）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/list/lyrics/**（11 类 3126 行）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/scanner/library/Н.smali（LRC 解析器 1186 行）"
  - ".rea-analysis/natives/libpowerampcore.so（TagLib SYLT 佐证）"
---

# 已完成投票 #2 — Synced/Scrolling Lyrics（idea 57）

> 官方 changelog：**build 948** 加入 *"Synced/scrolling Lyrics from tags, including LRC file support"*。

## 0. 一句话结论

**三层分离**：

| 层 | 类 | 职责 |
| --- | --- | --- |
| 解析层 | `scanner/library/Н`（1186 行） | LRC 文本 → 毫秒时间轴 |
| 调度层 | `data/lyrics`（13 类 4698 行） | 四级取词优先级 + 两表缓存 |
| 渲染层 | `list/lyrics`（11 类 3126 行） | 滚动跟随 + 四态行状态机 |

**内嵌标签（ID3 SYLT/USLT）的解析在 native（TagLib）**，Java 只消费现成数组。

---

## 1. LRC 文本解析（`scanner/library/Н`）

### 1.1 时间戳正则

`Н.<clinit>`（`:32-49`）：

```smali
const-string v0, "\\[\\d+:\\d\\d\\.\\d\\d\\d?\\]|\\<\\d+:\\d\\d\\.\\d\\d\\d?\\>"
invoke-static {v0}, Ljava/util/regex/Pattern;->compile(Ljava/lang/String;)Ljava/util/regex/Pattern;

; 首字符集合（2 个）
.array-data 2
    0x3c     ; "<"
    0x5b     ; "["
.end array-data
```

解转义后正则：`[\d+:\d\d\.\d\d\d?]|\<\d+:\d\d\.\d\d\d?\>`，**方括号与尖括号都接受**。

| 形式 | 接受 |
| --- | --- |
| `[mm:ss.xx]` | ✅ |
| `[mm:ss.xxx]` | ✅（末位可选 `\d\d\d?`） |
| `<mm:ss.xx>` | ✅ |
| `[m:ss.xxx]` | ✅（`\d+`） |

> 正则**不校验秒数 ≤ 59**，越界由换算兜底。

### 1.2 毫秒换算 `х(String,int,int[],int)`（`:127-324`）

**不用正则**，逐字符扫描：

```smali
; 三段 ParseUtils.A(...) 分别解析 mm / ss / 小数
p0 = 分钟整数
p2 = 秒整数（要求恰好 2 位）
p1 = 小数，按位数归一化：
    1 位 → ×100
    2 位 → ×10
    3 位 → ×1

; 拼接（:299-307）
const p3, 0xea60            ; 60000
mul-int p0, p0, p3          ; mm × 60000
mul-int/lit16 p2, p2, 0x3e8; ss × 1000
add-int/2addr p2, p0
add-int/2addr p2, p1        ; + 毫秒小计
return p2
```

| 环节 | 规则 | 位置 |
| --- | --- | --- |
| 分隔符 | 必须是 `:`（0x3a） | `:173` |
| 秒字段 | **必须恰好 2 位**，否则失败 | `:208-218` |
| 小数点 | 必须是 `.`（0x2e） | `:233` |
| 小数位 | 1/2/3 位分别 ×100/×10/×1 | `:265-289` |
| 失败哨兵 | 返回 `0x80000000`（Integer.MIN_VALUE） | `:138` |

> **小数位归一化是正确性关键**：`[00:01.5]` 是 0.5 秒 → 1500ms，不是 5ms。
> 这是许多第三方 LRC 播放器的常见 bug 源。

### 1.3 行解析主循环（`А(BufferedReader,...)`，`:687-1035`）

```
while ((line = br.readLine()) != null) {
    if (++count >= 2500) break                ; 0x9c4 行数上限
    if (line.length() < 5) continue          ; 太短跳过
    i = line.indexOf("[", 6)                 ; 从第 6 位找
    if (i == -1 || !isDigit(line.charAt(5))) {
        按 ":" 切分 → trim → Х(key, value)   ; 头部标签分支
    } else {
        А(line, "[", offset, P)              ; 时间行，可含多个时间戳
    }
}

> **两处上限都是条数，但语义不同**：
>
> | 常量 | 值 | 位置 | 意义 |
> | --- | ---: | --- | --- |
> | `0x9c4` | **2500** | `Н.smali:736-738` | **LRC 最多读 2500 行**（`v2` 每 readLine 递增，超限即退出循环） |
> | `0x7d0` | **2000** | `data/lyrics/A.smali:1292` | **最终只保留前 2000 个时间轴条目** |
>
> 即"先最多读 2500 行文本，再最多取 2000 条时间轴"——两级保护，防异常大文件撑爆内存。

### 1.4 一行多时间戳

`А(String,int,int,P)`（`:328-470`）解析出一个时间戳后**继续向后扫描**，
每遇新 `[` 再解析一个，把同一行文本挂到多个时间点（`:382-443`）——
即 LRC 规范里「重复副歌只写一次文本」的实现。

---

## 2. 头部标签（`Х(String,String)`，`:1035-1185`）

用 **hashCode 分派**匹配五个标准标签：

| 标签 | hashCode | 落点 | 语义 |
| --- | ---: | --- | --- |
| `ti` | `0xe75` | `Н.х` | 标题 |
| `ar` | `0xc31` | `Н.A` | 艺术家 |
| `al` | `0xc2b` | `Н.А` | 专辑 |
| `offset` | `-0x3cc89b6d` | `Н.X` | **时间偏移，取负** |
| `length` | `-0x41f1c51a` | `Н.Х` | 曲目长度（同样走 `х()`） |

> `offset` **取负**（`:1156` `neg-int p1, p1`）：LRC 规范 offset 正值表示"歌词提前"，
> 内部统一存"要加的时间量"，故符号取反。

---

## 3. 取词链（`data/lyrics/х.K(y)`，`:479-1432`）

### 3.1 上下文装配：16 列 SQL

`х.smali:568-800` 投影 16 列：

| # | 列 | 映射到 `А` |
| ---: | --- | --- |
| 0 | `has_lyrics_tag` | `А.А:Z` |
| 1 | `lrc_files_id` | `А.A:J` |
| 2 | `cached_lyrics_id` | `А.х:J` |
| 3 | `file_type` | `А.Х:I` |
| 4 | `COALESCE(folder_files.file_path,path||folder_files.name,folder_files.name)` | `А.X:String` |
| 5 | `lrc_files.is_utf8` | `А.x:Z` |
| 6 | `lrc_files.folder_path||lrc_files.simple_filename||lrc_files.extension` | `А.y:String` |
| 7 | `cached_lyrics.content` | `А.у:String` |
| 8 | `cached_lyrics_loading_started_at` | `А.К:J` |
| 9 | `cached_lyrics.created_by_pak` | `А.K:String` |
| 10 | `cached_lyrics.info_line` | `А.Н:String` |
| 11 | `title_tag` | `А.H:String` |
| 12 | `album_tag` | `А.Р:String` |
| 13 | `artist_tag` | `А.P:String` |
| 14 | `folder_files.updated_at` | `А.р:J` |
| 15 | `cached_lyrics.updated_at` | `А.p:J` |

连接（`:702-792`）：

```sql
FROM <实体表>
LEFT JOIN folders       ON folders._id        = folder_id
LEFT JOIN lrc_files     ON lrc_files._id      = lrc_files_id
LEFT JOIN cached_lyrics ON cached_lyrics._id  = cached_lyrics_id
WHERE folder_files._id = ?
```

### 3.2 四级候选链（`:975-1080`）

```smali
set = new LinkedHashSet()                      ; 保序
if (rawFile)                set.add(resolveLrcFile)
if (fileType != 23)         set.add(resolveLyricsTag)
if (fileType != 23 || !rawFile) set.add(resolveLrcFileStreamAndRaw)
                            set.add(resolveViaPlugin)          ; 无条件兜底
```

| 序 | 解析器 | 进入条件 | 优先级含义 |
| ---: | --- | --- | --- |
| 1 | `resolveLrcFile` | **仅 raw 文件**（`А.A == -2`） | 外挂 .lrc 最权威 |
| 2 | `resolveLyricsTag` | `file_type != 23` | 内嵌标签（流不做） |
| 3 | `resolveLrcFileStreamAndRaw` | `file_type != 23 \|\| !rawFile` | 流式/裸 LRC |
| 4 | `resolveViaPlugin` | **无条件** | 第三方插件兜底 |

> `file_type == 23` 是**流媒体**（与 `poweramp-streams-view.md` 一致）。
> ⇒ **流不读内嵌标签、也不按 raw 规则查 LRC 文件**。

### 3.3 三个分支

| 分支 | 位置 | 职责 |
| --- | --- | --- |
| `pswitch_0` | `A:827` | LRC 文件匹配（下述 SQL） |
| `pswitch_1` | `A:1205` | 内嵌标签 / 流式读取 |
| `pswitch_2` | `A:1448` | 插件取词 |

### 3.4 LRC 匹配 SQL（`A:870-1000`）

```sql
SELECT lrc_files.folder_path||lrc_files.simple_filename||lrc_files.extension,
       lrc_files.is_utf8
FROM lrc_files
WHERE lrc_files.title  = ? COLLATE NOCASE
  AND lrc_files.artist = ? COLLATE NOCASE
  AND (lrc_files.album IS NULL OR lrc_files.album = ? COLLATE NOCASE)
LIMIT 1
```

> **专辑允许 NULL**：很多 LRC 只写 ti/ar 不写 al，强匹配会漏掉大批文件。
> 标题+艺术家精确（仅忽略大小写）、专辑可选，是务实取舍。

### 3.5 插件取词（`pswitch_2`，`A:1448-1560`）

```smali
if (А.A != 0 && А.y != null && А.y.length != 0) {     ; 有 lrc 路径才进
    p      = new scanner/library/Н()
    show   = !А.x && prefs.В.c2                       ; is_utf8 + 某偏好
    result = p.B(context, saf, А.y, show, false, false)
}
```

> 把 LRC 文件路径（`А.y`，第 6 列拼接）交给插件，由插件负责实际读取与转码。

---

## 4. 缓存两表

### 4.1 `lrc_files`

DDL 在 `data/migrations/B.smali:3339-3351`，列清单在 `:3255-3335`：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | INTEGER PRIMARY KEY | |
| `created_at` / `updated_at` | INTEGER NOT NULL | |
| `mtime` | INTEGER NOT NULL DEFAULT 0 | 文件修改时间 |
| `title` / `artist` / `album` | TEXT | 从 LRC 头解析 |
| `length` | INTEGER | 曲目长度 |
| `simple_filename` / `extension` / `folder_path` | TEXT NOT NULL | 路径三段 |
| `is_utf8` | INTEGER NOT NULL DEFAULT 0 | 编码判定 |
| `tag_status` | INTEGER NOT NULL | 扫描状态 |

索引（`:3433-3511`）：
- `lrc_files_full_path_index`（UNIQUE）：folder_path + simple_filename + extension
- `lrc_files_title_artist_album`：三列 NOCASE
- `lrc_files_folder_path_simple_filename`

**触发器**（`:3559-3589`）：

```sql
CREATE TRIGGER lrc_files_folder_files_trigger
BEFORE DELETE ON lrc_files
BEGIN
    UPDATE folder_files SET lrc_files_id = NULL, <flag> = 0
    WHERE <col> = old._id;
END
```

> 删 LRC 时**自动清 `folder_files.lrc_files_id`**，避免悬挂引用——纯 SQL 层完整性。

### 4.2 缓存写入（`data/lyrics/A`）

| 语句 | 位置 |
| --- | --- |
| `UPDATE cached_lyrics SET updated_at=?, created_by_pak=?, cached_lyrics_loading_started_at=? ...` | `A:456-480` |
| `INSERT INTO cached_lyrics (created_at, updated_at, created_by_pak) VALUES (?,?,?)` | `A:622-700` |
| `DELETE FROM lrc_files WHERE ...` | `A:1608-1642` |

---

## 5. 渲染侧（`list/lyrics`）

| 类 | 行 | 职责 |
| --- | ---: | --- |
| `K` | 1261 | 列表控制器（滚动/手势/同步驱动） |
| `х` | 936 | 适配器（行绑定、布局测量） |
| `К` | 622 | 状态持有者（时间轴位置） |
| `А` | 274 | 行模型 |
| `Н` | 105 | **行状态枚举** |
| `H` | 39 | 行状态对象 |

### 5.1 四态行状态机（`list/lyrics/Н`）

```
ITEM_STATE_INITIAL
ITEM_STATE_WAITING_FOR_PULL
ITEM_STATE_PULLING
ITEM_STATE_DONE
```

> 这是**滚动动画状态机**（等待拉动 / 拉动中 / 完成），不是歌词高亮状态。
> 说明列表采用**主动跟随滚动**而非瞬时跳转。

### 5.2 时间驱动

`K.K(long)`（`:66-83`）：

```smali
if (К.A != 0) К.A = ms;      ; 仅时间轴已启动时接受更新
```

`К.В(int,int,int,u,long)`（`:178-330`）据该值**逐行推进**，按行状态决定是否发起滚动。

### 5.3 布局测量（`х.a(IZI)`，`:415-518`）

滚动偏移按视口高度动态计算：目标行索引 > 2 时取 `Rect.height()/5 - 行高`，
即把当前行定位在**离顶部约 1/5 屏高**处。

---

## 6. 内嵌标签：native 边界

Java 侧只做装配（`data/lyrics/A.smali:1237-1337`）：

```smali
tagReader.A(path, tagMask, 0x2000)          ; 调 native_scan_file
lines = TagAndMeta.syncLyricsLines           ; String[]
ts    = TagAndMeta.syncLyricsTimestamps      ; int[]（毫秒）
if (lines != null && ts != null && lines.length == ts.length) {
    n = min(2000, lines.length)
    for (i in 0..n) list.add(new LyricsLineEntry(ts[i], lines[i]))
    if (size > 1) CollectionsKt.o(list, Comparator)   ; 按时间排序
}
```

native 侧（`libpowerampcore.so`）：TagLib ID3v2 同步歌词帧符号——
`...ID3v223SynchronizedLyricsFrame11SynchedTextEEE`（@440664）、
`...UnsynchronizedLyricsFrameE`（@469555）、`"SYLT"`（@315101）。

> ⇒ **LRC 文件解析在 Java（本轮已解出），内嵌 SYLT/USLT 在 native。**
> 两条路径最终都汇成 `LyricsLineEntry(timeMs, text)` 数组。

---

## 7. 可借鉴 / 不建议照抄

### 7.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **小数位归一化**（1/2/3 位 ×100/×10/×1） | 正确处理 `[00:01.5]` |
| A2 | **正则与手写扫描器分离** | 正则只判"是不是时间标签"，换算用逐字符扫描免回溯 |
| A3 | **专辑允许 NULL 匹配** | 覆盖只写 ti/ar 的文件 |
| A4 | **四态滚动状态机** | 平滑跟随而非瞬时跳转 |
| A5 | **触发器维护引用完整性** | 删 LRC 自动清 `lrc_files_id` |
| A6 | **候选链 + 无条件兜底插件** | 前三级都可能失败，插件永远最后尝试 |

### 7.2 不建议照抄

| # | 做法 | 问题 |
| --- | --- | --- |
| N1 | 上下限常量分散（2500 / 2000） | 两处不同语义易混 |
| N2 | `0x80000000` 作失败哨兵且与合法值共用 int 域 | 需处处判等 |
| N3 | 三级缓存（`cached_lyrics` / `lrc_files` / `folder_files` 反查列） | 一致性靠触发器，链路长 |

---

## 8. 本轮新增解出（原 Q1/Q2/Q3）

### 8.1 内嵌标签未命中 → 纯文本兜底（`A:1351-1445`）

`pswitch_1` 在 `syncLyricsLines/Timestamps` 不可用时**不会直接失败**，而是退化到纯文本：

```smali
v3 = TagAndMeta.lyrics                  ; 非同步纯文本歌词
if (v3 == null || v3.length == 0) goto :cond_27
if (v3.length < 0x20)          goto :cond_27    ; < 32 字符 → 视为无
if (v3.length > 0x100000)      goto :cond_27    ; > 1 MiB → 放弃

; 先按 LRC 解析（纯文本里也可能混有 [mm:ss] 标记）
p  = new scanner/library/Н()
dt = new H(path)
br = new BufferedReader(new StringReader(v3))
result = p.А(br, false, dt, false)
if (result != null) → 采用

; 仍失败 → 纯文本模式
result = х.Р(v3, dt)                   ; 不解析时间，整段按行
```

> **长度护栏是本轮新发现**：`0x20`（32 字符下限，过滤 "no lyrics" 之类占位串）与
> `0x100000`（1 MiB 上限，防异常大标签）。
> 且**先尝试 LRC 解析再退化纯文本**——因为某些文件的 USLT 里本来就写着 LRC 格式。

### 8.2 插件取词的完整链路（原 Q2）

`pswitch_2`（`A:1448-1660`）→ `scanner/library/Н.B(context, saf, path, show, false, false)`
→ 失败时 `х.Н(context, saf, path, isUtf8)`（`х.smali:96-280`）：

```smali
cs = isUtf8 ? B.В : B.B              ; 两种 Charset
in = saf.р(context, path)             ; 经 SAF 打开
br = new BufferedReader(new data/О(in, cs), 0x4000)   ; 16 KiB 缓冲

loop:
    line = br.readLine()
    if (line == null) break
    if (line.length > 0x3e8) return null     ; 单行 > 1000 字符 → 整体放弃
    if (++n >= 0x7d0) break                  ; 最多 2000 行
    list.add(new LyricsLineEntry(-1, line.trim()))   ; ★ time = -1（const/4 v4,-0x1 @:244）
```

| 常量 | 值 | 含义 |
| --- | ---: | --- |
| `0x4000` | 16384 | BufferedReader 缓冲 |
| `0x3e8` | 1000 | **单行上限**，超限整体返回 null |
| `0x7d0` | 2000 | 行数上限 |
| `0x4` | 4 | **结果至少 4 行**，否则判无效（`:213-215`） |
| `-1` | — | 纯文本行的哨兵时间戳（无时间轴，`:244`） |

> **`time = -1` 是纯文本模式标志**：渲染层据此走静态滚动而非时间跟随。
> 末尾还会剔除最后一个空行（`:196-206`）。

插件失败时 `pswitch_2` 还会执行 `DELETE FROM lrc_files WHERE ...`（`A:1608-1642`），
**标记该 LRC 记录失效**，避免下次继续尝试坏文件。

### 8.3 滚动动画的真实参数（原 Q3）

`list/lyrics/Н` 四态与字段映射（`<clinit>` `:23-59`）：

| 枚举字段 | 常量名 | 语义 |
| --- | --- | --- |
| `Н.B` | `ITEM_STATE_INITIAL` | 初始 |
| `Н.A` | `ITEM_STATE_WAITING_FOR_PULL` | 等待拉动 |
| `Н.X` | `ITEM_STATE_PULLING` | 拉动中（动画进行） |
| `Н.x` | `ITEM_STATE_DONE` | 完成 |

动画时长计算（`К.В()` `:405-455`）：

```smali
rowDelta  = |targetRow - currentRow|      ; 行差
timeDelta = now - К.A                      ; 距上次时间更新
pair      = К.Х * rowDelta                 ; ★ 每行耗时 × 行差
dur       = timeDelta - pair
if (dur >= 0) {
    H.B = PULLING
    H.X = now - dur          ; 动画起点
}
```

进度与插值（`:463-517`）：

```smali
frac  = clamp((now - H.X) / H.x, 0.0, 1.0)   ; H.x = 动画时长
frac2 = interpolator != null ? interpolator.getInterpolation(frac) : frac
H.х   = H.Х - H.А * frac2                     ; 当前滚动偏移
若 frac2 >= 1.0 → H.А = 0; H.B = DONE
```

| 参数 | 来源 | 位置 |
| --- | --- | --- |
| 基础动画时长 | `K.t = 500.0f`（构造器硬编码） | `K.smali:35-37` |
| 每行耗时系数 | `К.Х` | `К.В()` `:424` |
| 插值器 | `widget/base/С.a` 的 `B` 字段 | `:394-404` |

> ⇒ **滚动不是每帧跳一格，而是按 `时间差 × 行差` 平滑推进**，
> 且用可配置 TimeInterpolator，`frac` 到 1.0 才置 DONE。
> 这揭示 `WAITING_FOR_PULL` 的真实含义——**等待"时间轴上该行到来的时刻"**，并非手指拉动。

---
## 9. 证据索引

| 主题 | 位置 |
| --- | --- |
| 时间戳正则 | `scanner/library/Н.smali:35-41` |
| 首字符表 | `Н.smali:43-59` |
| 毫秒换算 | `Н.smali:127-324` |
| 小数位归一化 | `Н.smali:265-289` |
| 最终拼接 | `Н.smali:299-307` |
| 行解析主循环 | `Н.smali:687-1035` |
| 一行多时间戳 | `Н.smali:382-443` |
| 头部标签 | `Н.smali:1035-1185`（offset 取负 `:1156`） |
| 16 列投影 | `data/lyrics/х.smali:568-792` |
| 四级候选链 | `х.smali:975-1080` |
| 解析器三分支 | `data/lyrics/A.smali:827 / 1205 / 1448` |
| LRC 匹配 SQL | `A.smali:870-1000` |
| 插件取词 | `A.smali:1448-1560` |
| 缓存读写 | `A.smali:456-480 / 622-700 / 1608-1642` |
| lrc_files DDL | `data/migrations/B.smali:3255-3351` |
| 索引 | `B.smali:3433-3511` |
| 触发器 | `B.smali:3559-3589` |
| 行状态枚举 | `list/lyrics/Н.smali:23-53` |
| 时间驱动 | `list/lyrics/K.smali:66-83` |
| 时间轴推进 | `list/lyrics/К.smali:178-330` |
| 布局测量 | `list/lyrics/х.smali:415-518` |
| 内嵌歌词装配 | `data/lyrics/A.smali:1237-1337` |
| native SYLT | `libpowerampcore.so` @315101 / @440664 / @469395 / @469555 |
| 纯文本兜底 | `data/lyrics/A.smali:1351-1445`（护栏 `:1369`/`:1377`） |
| 插件结果读取 | `data/lyrics/х.smali:96-280`（`0x3e8`/`0x7d0`/`0x4`/`-0x1`） |
| 状态枚举映射 | `list/lyrics/Н.smali:23-59` |
| 动画时长 | `list/lyrics/К.smali:405-455`（`К.Х` 系数 `:424`） |
| 插值与完成 | `list/lyrics/К.smali:463-517` |
| 基础时长 500f | `list/lyrics/K.smali:35-37` |

> 行号口径：**build-1025**。
