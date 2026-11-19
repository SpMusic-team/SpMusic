---
doc_id: "ARCH-POWERAMP-ALBUM-ART-PICKER"
title: "Poweramp 专辑图片选择器参考（候选项枚举 + 文件落盘 + aa_status 位掩码）"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "project"
revision: 1
created: "2026-11-17"
updated: "2026-11-18"
source_documents:
  - "user request: 逆向 Poweramp 中带头图的更多按钮弹窗里的「专辑图片 / 图片」选项的组织与实现"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009)"
  - ".rea-analysis/smali/smali/com/maxmpz/**（apktool 反汇编）"
  - ".rea-analysis/decoded/res/**（layout / layout-sw2dp / xml / values）"
  - "docs/corpus/poweramp-list-options.md（同族弹窗体例，本弹窗与其共用入口机制）"
  - "docs/corpus/poweramp-album-art-settings.md（设置侧 19 项，本文 §8 交叉核对）"
  - "docs/corpus/poweramp-queue-view.md（aa_status 读取侧的既有记录）"
---

# Poweramp 专辑图片选择器参考（候选项枚举 + 文件落盘 + aa_status 位掩码）

## 0. 定位与证据分级

**本文记录外部实现 Poweramp 的「专辑图片 / 图片」（Album Art / Image）选择器，不是 SpMusic 现状。**

| 标记 | 含义 | 可信度 |
| --- | --- | --- |
| **【实证·smali】** | 反汇编 smali 原文 | 最高 |
| **【实证·原文】** | APK 资源字符串 / public.xml / 布局 XML 原文 | 高 |
| **【推断】** | 本文作者推理 | 低 |

### 0.1 一句话结论

**它是「网格化候选图选择器」：先放一行 "No album art" 哨兵，再按来源（内嵌标签 → 文件夹图片 → 在线下载）把候选图逐个追加进来；点选后把图片压缩写成缓存目录里的一个普通文件，并发 `cmd_app_refresh_aa` 通知全局刷新——既不写标签，也不写数据库 BLOB。**

一句话补充：**同一个菜单项会显示两种文案**——"Album Art"（专辑图片，实体支持在线搜索时）或 "Image"（图片，仅能换本地图时），由实体是否实现 `m1` 决定。

### 0.2 四层结构

```
【入口层】见 §1
   列表项「更多」→ album_art 菜单项 (merge_menu_items_tracks/aa)
   → cmd_list_select_aa_dialog → 列表页取实体 URI
   → cmd_data_album_art → SelectAlbumArtActivity

【枚举层】见 §2 §3
   "No album art" 哨兵（固定 index 0）
   + 内嵌标签封面（TagAndMeta）
   + 文件夹图片（folder/cover/albumart）
   + 在线下载（MusicBrainz → CoverArtArchive / 图片搜索）

【选择层】见 §4
   High Resolution 复选框 → 私有 HandlerThread 重载
   "Also use for: N songs" 复选框 → 级联到父实体

【落盘层】见 §5
   PNG(q100) / JPEG(q95) → <cacheRoot>/selected_aa/*.jpg
   空 bitmap → 0 字节文件（显式"无封面"）
   → cmd_app_refresh_aa
```

### 0.3 与既有文档的分工

| 文档 | 覆盖 |
| --- | --- |
| **本文** | 选择器本体：入口、候选项枚举、两个复选框、落盘格式、`aa_status` 位掩码 |
| `poweramp-album-art-settings.md` | 设置页 `aa.xml` 的 19 项偏好 |
| `poweramp-queue-view.md` | `aa_status` 的**读取**侧（队列详情 `f0()` 过滤 `!=2`） |
| `poweramp-list-options.md` | 同族弹窗机制（`BusActionButton` + `MsgBus` + `w:string` 深链） |

**无覆盖重叠。** 本文 §8 对 `poweramp-album-art-settings.md` 做了交叉核对，列出 5 处版本漂移。

---

## 1. 入口链路

### 1.1 菜单项声明

```xml
<!-- res/layout-sw2dp/merge_menu_items_tracks.xml:6 与 merge_menu_items_aa.xml:8（完全相同） -->
<BusActionButton android:id="@id/album_art"
                 android:text="@string/album_art"
                 android:drawable="?album_art"
                 w:busId="@id/list"
                 w:msgId="@id/cmd_list_select_aa_dialog"
                 w:clickDelay="@integer/activity_start_click_delay"
                 style="?PopupMenuItem" />
```

| 资源 | 值 |
| --- | --- |
| `@id/album_art` | `0x7f0d0262` |
| `@string/album_art` | `0x7f080046` = **"Album Art"** |
| `@string/art_image` | `0x7f08006f` = **"Image"** |
| `cmd_list_select_aa_dialog` | `0x7f0d0061` |
| `cmd_data_album_art` | `0x7f0d0062` |

**出现位置**：`merge_menu_items_tracks`（曲目/文件列表）与 `merge_menu_items_aa`（单曲上下文菜单）。**不在** `merge_menu_items_lib`、`merge_menu_items_playlists`。【实证·原文】

### 1.2 运行时的文案切换

同一个菜单项在运行时会改文案（`z0.smali:559-561`、`у.smali:224-226`）：

```
if (H.В.k0() instanceof m1)  → setText(@string/art_image  "Image")
（z0 分支还额外要求 H.В instanceof b2）
```

`m1` = **支持在线搜索封面的实体**（album / artist / composer / genre…）。因此：

- 实体是 `m1`（专辑、艺术家等有"整张封面"概念）→ 显示 **"Image"**
- 否则（单曲文件等）→ 显示 **"Album Art"**

> 这正好对应你说的"专辑图片"或"图片"两种文案。**【实证·smali】**

### 1.3 三段式消息接力

```
① 菜单点击 → MsgBus(busId=@id/list).post(cmd_list_select_aa_dialog 0x7f0d0061)
   list/n0.smali:5064-5101 处理：
     要求当前页实现 list/c0 → c0.A() 取实体 Uri
     → 再 post(cmd_data_album_art 0x7f0d0062, obj = Uri)

② session/К.smali:1028-1057 处理 cmd_data_album_art：
     В.К(ctx, "dialogs.SelectAlbumArtActivity", 0, 0, uri, null, null)

③ SelectAlbumArtActivity.onCreate 读 Intent "obj" 得 Uri
```

**注意**：这里不直接用 `setData()`，而是 `"obj"` extra——与 `ListOptsActivity` 完全同构（见 `poweramp-list-options.md` §1.4）。【实证·smali】

### 1.4 弹窗形态

`SelectAlbumArtActivity`（1760 行，49 KB）继承 **`BaseDialogActivity`**，实现 `widget/list/Н`（PowerList 回调）。

- 主题按类名动态解析：`"dialog_" + simpleName` → attr `dialog_SelectAlbumArtActivity` → style `@style/dialog_SelectAlbumArtActivity`（parent `BottomsheetDialog`）
- **标题栏隐藏**（`DialogTitleLayoutHidden`）——实机上是无标题的底部面板
- 内容布局：`layout/dialog_content_select_album_art.xml`（12 行）

| id | 视图 | 作用 |
| --- | --- | --- |
| `settings_button` `0x7f0d02e9` | `BusActionButton` | 齿轮，`w:string="aa"` → 封面设置页 |
| `progress` `0x7f0d026f` | `ProgressBar` | 下载中转圈（默认 invisible） |
| `checkbox` `0x7f0d01f0` | `CheckBox` | **"High Resolution"**（`pref_aa_download_hd`） |
| `use_for` `0x7f0d057c` | `CheckBox` | **"Also use for: …"**（默认 gone） |
| `message` `0x7f0d0236` | `TextView` | 提示文案（playlist 场景） |
| `list` `0x7f0d0208` | `PowerList` | 候选图网格 |

底部按钮：`button1` = **"Pick From Gallery"**（`pick_image` 0x7f080420），`button2`/`button3` 隐藏。【实证·原文】

### 1.5 齿轮深链

`settings_button` 的 `w:string="aa"`，与列表选项弹窗同机制（`cmd_app_open_settings` → `SettingsActivity` → `xml/aa.xml`）。**即从选择器可直接跳封面设置页。**

---

## 2. 候选项枚举（列表内容）

### 2.1 行模型

`dialogs/e0`（3 个字段）：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `В` | `Bitmap` | 缩略图 |
| `B` | `String` | 副标题（`"WxH\n来源名"`） |
| `А` | `boolean` | **是否 PNG（无损）** → 决定落盘格式 |

`dialogs/i0`（适配器，继承 `widget/app/A`）：持两个 `ArrayList`——`p`（已就绪）、`О`（待补）。

唯一入库入口 `i0.С(bitmap, label, isPng)`（`i0.smali:218-255`），全库仅 4 处调用：

| 调用点 | 来源 |
| --- | --- |
| `SelectAlbumArtActivity:1663-1679` | **"No album art" 哨兵** |
| `dialogs/d0.smali:140` | 高分辨率候选（`g0.P/р/p`） |
| `dialogs/d0.smali:164` | 低分辨率候选（`g0.О/O/о`） |
| `session/К.smali:6097` | **在线下载完成**（`0x3e8` 消息） |

### 2.2 固定 index 0：移除封面哨兵

```java
// SelectAlbumArtActivity.К()   :1663-1679
i0.С(placeholderBitmap /* gl_poweramp_logo */, getString(0x7f0803a6 /* "No album art" */), false)
```

`onItemClick` 对 index 0 特殊处理：`bitmap = null`（`:1007-1013`）→ 落盘时写成 **0 字节文件**，语义是"显式无封面"（区别于"尚未解析"）。【实证·smali】

### 2.3 三类真实来源

| # | 来源 | 实现 | 副标题 |
| --- | --- | --- | --- |
| ① | **内嵌标签封面** | `TagReader` + `TagAndMeta.getAABitmapAndClean()` | `"WxH\n" + "Embedded album art"`（`embed_album_art` 0x7f0801b2），失败时前缀 `failed`（0x7f0803e3） |
| ② | **文件夹图片** | `data/aa/х.Н(...)` 找 in-folder 图，`support/v4/media/В.С(ctx, path, k, saf)` 解码 | `"WxH\n" + "In-folder image"`（`in_folder_image` 0x7f080277） |
| ③ | **在线下载** | `mayBeDownloadAlbumArt` → `data/aa/P.Х(...)` | `"WxH"`（宽高由消息 `arg1/arg2` 带出） |

**没有 enum 常量区分来源**——只靠副标题文案与 `isPng` 标志区分。【实证·smali】

### 2.3.1 单元格布局与渲染

`res/layout/item_select_aa.xml`（每格）：

```xml
<ClickableFastLayout background="@drawable/ripple_rounded_mini" padding="4dp">
  <AAImageView   id="@id/image" scaleType="?AAImage_scaleType"
                 elevation="2dp" cornerRadius1="?corners_aa_albums"
                 layout_width="match_parent" layout_height="match_parent"/>
  <FastTextView  id="@id/title" maxLines="2" ellipsize="end"
                 textColor="?android:textColorPrimaryInverse"
                 w:lineBackground="@drawable/inverse_rounded_medium"
                 w:layout_attachBottomToBottom="@id/image"
                 paddingLeft/Right="6dp" paddingTop/Bottom="4dp"/>
</ClickableFastLayout>
```

即：**图片占满格子、带圆角与 2dp 阴影；副标题以半透明反色条叠在图片底部，最多 2 行、超出省略。**

渲染（`i0.О(...)` `:129-208`）：

```java
e0 item = p.get(pos);
((AAImageView) view.findViewById(@id/image)).E0(item.В, 0, true);   // 位图
FastTextView tv = view.findViewById(@id/title);
if (!TextUtils.isEmpty(item.B)) { tv.L(item.B); tv.setVisibility(VISIBLE); }
else                              tv.setVisibility(GONE);          // 空副标题则隐藏
```

特殊位置 `pos == -0x4` 直接跳过（用作加载占位的空槽）。【实证·smali】

### 2.4 文件夹图片的固定候选名

`scanner/folder/i.smali:87,99,109`：

```
"folder", "cover", "albumart"
```

大小窗口校验：`0x1000 ≤ size ≤ scanner/A.В`。

### 2.5 缩略图尺寸

`getTexSize(boolean)`（`:95-108`）：

| 参数 | 返回 | 含义 |
| --- | --- | --- |
| `true`（HD） | `0x400` = **1024** | 高分辨率目标 |
| `false` | `0x200` = **512** | 普通 |

三个 `widget/bitmaps/у` 加载器（`j`/`k`/`l`）持各自的 `BitmapFactory.Options`：
- 三者 `A = 3`（scaleType）
- `l` 额外 `inPreferQualityOverSpeed = true`
- 尺寸：`l = getTexSize(m) * 2`、`j = k = getTexSize(m)`

`m`（HD 开关）的判定（`:754-785`）**三条件全满足**：

```java
prefs/В;->F 为真                     // aa_download_hd 偏好
&& Build.VERSION.SDK_INT >= 24       // 0x18
&& Runtime.maxMemory() >= 0x10000000 // 256 MB
```

### 2.6 网格列数

`К()` 建 `PowerList` 时按屏幕朝向选列数（`:1601-1640`）：

```java
int cols = (Configuration.orientation == ORIENTATION_LANDSCAPE)
         ? 4      // 横屏
         : 2;     // 竖屏
new widget/list/c2(displayMetrics.density, cols, -1 /* 宽度占满 */)
```

即 **横屏 4 列、竖屏 2 列**，`-1` 表示宽度拉伸到父容器。【实证·smali】

---

## 3. 两个复选框

### 3.1 `checkbox` = "High Resolution"

- 文案：`@string/pref_aa_download_hd`（`0x7f08045a`）= **"High Resolution"**
- 偏好键：**`aa_download_hd`**，字段 `prefs/В;->F`（`В.smali:695-701`，默认 **false**）
- 监听器 `dialogs/c0`：`activity.m = isChecked` → 重算 `j/k/l` 尺寸 → 若 `!u` 则调 `y()` 重载列表
- 语义：**影响在线下载的分辨率策略**（`d.p` = YA_HD_2026 / Bing HD vs 普通），以及解码目标尺寸 512↔1024
- 下游读取：`data/aa/X.smali:604-623`

### 3.2 `use_for` = "Also use for: …"

默认 `gone`，仅当**实体可级联到父实体**时显示。文案构造（`d0.smali:185-231` 与 `y()` `:1296-1326`）：

```java
String qty  = res.getQuantityString(h0.р(), 1);          // 注意：数量恒为 1
String name = job.Н;                                      // 父实体名（如专辑名）
String arg  = name + " (" + qty + ")";                    // "<名称> (<量词>)"
cb.setText(AUtils.C(arg, getString(0x7f08005c)));         // "Also use for: %s"
cb.setVisibility(VISIBLE);
```

**实际渲染示例**：`Also use for: Abbey Road (album)`

`@string/also_use_for_s` = **"Also use for: %s"**（0x7f08005c）。`@string/playlist_set_aa_msg`（0x7f080438）在 playlist 场景作为 `@id/message` 的提示文案。

**`р()` 返回的是 plurals 资源 id，不是数量**（关键易错点）：

| 实体 | `р()` | plurals | 渲染 |
| --- | --- | --- | --- |
| `p0`（基类，多数分类继承） | `0x7f13000a` | `file` | "(songs)" |
| `j`（专辑） | `0x7f130000` | `album` | "(album)" |
| `t`（艺术家） | `0x7f130003` | `artist` | "(artist)" |
| `d4`（流） | `0x7f130022` | `stream` | "(stream)" |

`item` 定义（`plurals.xml:43`）：`one → @string/song`，`other → @string/songs`。

> **注意**：数量参数恒传 `1`，故永远取 `one` 形式（单数）。即显示的永远是"一个单位"的措辞，与真实曲目数量无关——这里的 `(album)` 表示**目标类型**（父实体是专辑），不是数量。

> **语义**：勾选后，选中的图片同时写入**父实体**的封面路径（`h0.С` = parent art path）。例如在某专辑下改封面，可一并应用为该艺术家的艺术家图。父实体名取自 `g0.Н`。

`use_for` 没有 `OnCheckedChangeListener`——只在点击行时读取。

---

## 4. 选择与写路径

### 4.1 `onItemClick`（`:986-1070`）

```
1. 前置：v(h0 job) != null，index ∈ [0, adapter.x)
2. index == 0 → bitmap = null, isPng = false
   否则 → e0 取 bitmap / isPng
3. 包成 androidx/core/text/A(bitmap, isPng)   ← 惰性解包器
4. selectedArtPath = h0.C
   if (use_for.isChecked()) parentArtPath = h0.С
5. new Thread(com/maxmpz/audioplayer/A(activity, selectedArtPath, wrapper, parentArtPath, 1)).start()
```

### 4.2 落盘线程（`audioplayer/A.smali:38-192`）

```java
// case != 0（本路径）
if (bitmap == null) file.createNewFile();          // 0 字节 = 显式无封面
else {
  NativeUtils.native_mkdirs_for_file(path);
  SelectAlbumArtActivity.у(file, bitmap, isPng);    // ← 真正的写文件
}
// 若有 parentArtPath，对父路径重复同一动作
MsgBus(bus_app_cmd).post(cmd_app_refresh_aa 0x7f0d003c, 0, 0, null);
handler.postDelayed(b0(0), 100);                   // 关弹窗 + 刷新
```

### 4.3 图片格式规则（`у(File,Bitmap,boolean)` `:110-165`）

| `isPng` | CompressFormat | quality |
| --- | --- | --- |
| `true` | **PNG** | `0x64` = **100** |
| `false` | **JPEG** | `0x5f` = **95** |

异常路径：`Log.e("SelectAlbumArtActivity", "selectedArtFile=…")` 并 `file.delete()`。

> **重要**：`isPng` 来自原图 MIME（`image/png`）。所以"从 PNG 源选图"会以无损 PNG 存，"从 JPEG 源"以 q95 JPEG 存。【实证·smali】

### 4.4 从图库选图

`onClick`（`:573-624`）：

```java
Intent i = new Intent(Intent.ACTION_GET_CONTENT);
i.setType("image/*");
startActivityForResult(Intent.createChooser(i, "Pick From Gallery"), 20001 /* 0x4e21 */);
```

`onActivityResult`（`:450-563`）两条路径：

| 条件 | 包装器 | 读取方式 |
| --- | --- | --- |
| `resolvePath(uri)` 得真实路径 | `appcompat/app/H(ctx, 28, path)` | `File(path).exists()` → `BitmapFactory` |
| 否则（content Uri） | `session/e(ctx, resolver, uri, 29)` | `openFileDescriptor(uri, "r")` → 从 fd 解码 |

`resolvePath(uri)`（`:1080-1171`）：`file://` 直接取 path；否则 `ContentResolver.query(uri, ["_data"], …)`。

之后复用同一个 `Thread A`，`use_for` 勾选时同样级联。

---

## 5. 存储模型与 `aa_status`

### 5.1 落盘位置：缓存目录里的普通文件

**不是**标签写入，**不是**数据库 BLOB。

| 类别 | 目录 |
| --- | --- |
| 用户选择 | `selected_aa` / `selected_artist` / `selected_composer` / `selected_playlist` / `selected_genre`（`utils/B.smali:237-349`） |
| 下载所得 | `album_art` / `artist_art` / `composer_art` / `playlist_art` / `genre_art`（`utils/B.smali:112-227`） |

根目录：`getExternalFilesDir(null)`（`utils/B.Х` → `utils/B.A`）。

**扩展名**：`data/aa/х.А(...)` 拼出 `<cacheRoot>/<entity.u0()>/<sanitized>.jpg` —— 即使内容是 PNG，文件名仍是 `.jpg`。读取侧靠解码器嗅探实际格式，不依赖扩展名。【实证·smali】

### 5.2 `aa_status` 是位掩码，不是枚举

这一条**修正了此前多处文档的推断**。

| 值 | 语义 | 写入点 |
| --- | --- | --- |
| **bit0 = 1** | **内嵌标签有封面** | `scanner/library/P.smali:822-828`：`and-int v2, v7, 0x4`（标签扫描标志第 3 位为"发现封面"）→ 存入 `aa_status` |
| **bit1 = 2** | **已确认无封面**（负缓存） | `data/aa/X.smali:1019-1040`：`UPDATE <table> SET aa_status=(aa_status&~2)|2 WHERE _id=?` |
| 0 | 未解析（schema 默认） | 建表默认值；扫描无封面时也写 0 |
| 3 | 有封面 + 曾标记无（掩码容忍） | 无直接写入点，由 `&~2` 掩码组合产生 |

**关键证据**：写入用 `(aa_status&~2)|2` 而非 `=2`——证明它是**位域**，其他位会被保留。

读取侧的统一模式（12 个实体相同）：

```sql
WHERE (folder_files.aa_status IS NULL OR folder_files.aa_status != 2)
ORDER BY folder_files.aa_status DESC
LIMIT 1
```

含义：**跳过 bit1 置位的行**（已知无封面），**优先 bit0 置位的行**（有内嵌封面）。`ORDER BY DESC` 在 0/1/3 上分别得 3>1>0，符合"有图优先"。

### 5.2.1 曲目级 vs 实体级：两套 `aa_status` 用途不同

**这是本节最容易误读的地方**，必须区分：

| 层级 | 列 | 用途 | 写入 |
| --- | --- | --- | --- |
| **曲目级** | `folder_files.aa_status` | 单曲是否有内嵌封面 | 扫描器写 bit0；`aa/X` 按实体表名写 bit1（见下） |
| **实体级** | `albums.aa_status` / `artists.aa_status` / `composers` / `genres` / `years` / `folders` / `playlists` / `album_artists` | 实体**投影列**，用于列表直接取状态而不 join | 同上，`aa/X` 按 `n()` 返回表名动态写入；重置动作批量清 0 |

**`aa/X` 的写入目标是动态表名**——`А.H`（`l1` 实体）的 `х.n()` 返回表名（`p0`→`folder_files`、`l`→`albums`、`w`→`artists`、`d0`→`composers`、`z0`→`genres`、`h4`→`years`），故：

```sql
UPDATE albums   SET aa_status=(aa_status&~2)|2 WHERE _id=?   -- 专辑封面下载失败时
UPDATE artists  SET aa_status=(aa_status&~2)|2 WHERE _id=?   -- 艺术家图下载失败时
```

**触发条件**：`cmd` 分支内部对**每个候选 URL 逐个尝试**，中途失败只记 `"failed to get image for url="` 日志并继续下一个；**全部候选失败后**才执行该 UPDATE（即"确认找不到"才写负缓存）。【实证·smali】

> **此前版本的错误**：旧稿曾判断"实体级 `aa_status` 只被重置为 0、无 1/2 写入，故 `ORDER BY DESC` 是空操作"。经核实 `m1 extends l1` 且 `n()` 返回实体表名，该判断**不成立**——实体级确有 bit1 写入。

### 5.2.2 选择封面后如何"有图"

**选择器完全不写 `aa_status`。** 新封面被识别靠**文件存在性** + 缓存失效广播：

```
① SelectAlbumArtActivity 落盘到 selected_aa/*.jpg
② post cmd_app_refresh_aa (0x7f0d003c)  on bus_app_cmd

③ data/aa/y.smali:169-193 接收（它实现 MsgBusSubscriber）：
     prefs/В;->v (aa_force_default) → widget/bitmaps/А.i
     C()                      ← 清空位图缓存
     msgBus.post(msg_app_aa_refreshed 0x7f0d0044)

④ 列表页 list/n0.smali:4251-4279 接收：
     遍历所有 page 条目 → P.X.В()  ← 清位图
⑤ 重绘时 data/aa/х 重新走解析链（§5.4），选中文件优先命中
```

即 **`aa_status` 不参与"用户已选封面"的判定**；它只负责"内嵌有无"与"确认找不到"两种负/正缓存。用户选择是**文件系统层面的覆盖**。【实证·smali】

### 5.3 "重置负缓存"动作

设置页的 `reset_negative_aa_status` → 确认框 → `dialogs/C.smali:361-386`：

```java
MsgBus(bus_app 0x7f0d0037).post(cmd_data_reset_aa_status 0x7f0d0064);
```

`session/К.smali:1059-1176` 处理：

```sql
ContentValues cv; cv.put("aa_status", "aa_status=0");   // 注意：值是 SQL 片段字符串
UPDATE files     SET ... WHERE aa_status=2;
UPDATE albums    SET ... WHERE aa_status=2;
UPDATE artists   SET ... WHERE aa_status=2;
UPDATE album_artists / albums_by_artist / genres / years / composers / folders 同上
```

即**清空所有 bit1**，让这些条目重新参与封面查找。

> 【推断】`cv.put("aa_status", "aa_status=0")` 传的是表达式字符串而非整数 0。SQLite 在 INTEGER 亲和列上可能按文本处理，但 `!=2` 谓词两侧都等值失效，行为上达成"清除标记"的目的。存储表示未验证。

### 5.4 封面来源优先级

主解析器 `data/aa/х.K(...)`（`х.smali:968-2185`）。调用链：

```
х.К(int aaType, long id, А job, у loader)        :2663-3000
 ① packed-switch aaType 选实体（见下表）
 ② 复用缓存的 SQLiteCursor（setSelectionArguments + requery，避免重建）
 ③ entity.f0(db, cols, args, aaType) 查一行
 ④ 找到 → х.K(у, А, Cursor, int, long)  :968  解析该行
 ⑤ 找不到 → return 3（跳过）
```

**`aaType` 枚举（12 种，`packed-switch 0x1`）**：

| aaType | 实体 | aaType | 实体 |
| --- | --- | --- | --- |
| 1 | `n0` files | 7 | `t` artists |
| 2 | `p3` rawFiles | 8 | `О` albumArtists |
| 3 | `j` albums | 9 | `j3` playlists |
| 4 | `m` albumsByArtist | 10 | `d0` composers |
| 5 | `t0` folders | 11 | `z0` genres |
| 6 | `x0` foldersHier | 12 | `h4` years |

**单行解析的判定顺序**（`х.K(Cursor...)`，按代码位置）：

| 步 | 判定 | 结果 |
| --- | --- | --- |
| ① | `aa_status & 0x1`（bit0，内嵌封面存在） | 走直读文件路径（`:1334/1377/1391/1481`） |
| ② | `tagFlags & 0x4`（标签扫描标志的第 3 位） | 解码内嵌封面（`:1459`） |
| ③ | `selected_aa` 文件存在性 | **核心覆盖点**，见下 |
| ④ | **`aa_status & 0x2`（bit1，负缓存）** | **`v14 = 1` → 抑制在线下载重试**（`:1863`） |
| ⑤ | `prefer_downloaded_aa`（`prefs/В;->z`） | 决定 ⑥⑦ 顺序 |
| ⑥ | `album_art`（下载所得） | 解码 |
| ⑦ | 文件夹图片（`folder`/`cover`/`albumart`） | 解码 |

### 5.4.1 bit1 是**单向闩锁**——这是本设计最需要警惕的一点

**全库只有"设 bit1"，没有"清 bit1"的写入**：

```bash
grep 'aa_status&~2'  → 仅 data/aa/X.smali:1025 一处（|2 设置）
grep 'aa_status=0'   → 仅 session/К.smali:1072（设置页"重置"动作）
```

且 `aa/х` 的成功路径**完全不写库**（`:968-2185` 内无 `compileStatement`/`UPDATE`）。

后果链条：

```
下载全部候选失败 → 写 bit1
       ↓
下次解析 → :1863 读出 bit1 → v14=1
       ↓
:2171-2175  if (returnCode == 0 && v14 != 0) → goto_2（跳过在线下载）
       ↓
即使后来网络恢复，也不会自动重试
       ↓
只有用户在设置里点"重置封面状态"（清 9 张表）才恢复
```

> 【推断】这是有意的**负缓存设计**（避免每次滚动列表都重新联网搜索），代价是"一次失败永久生效"，需用户手动重置。副作用是：若关键候选图当时下载失败，用户可能长期看不到封面却不知原因。

**`aa_status` 的完整表清单**（重置动作覆盖，`session/К.smali:1076-1166`）：

`getFiles()` / `getAlbums()` / `getArtists()` / `getAlbumArtists()` / `getAlbumsByArtist()` / `getGenres()` / `getYears()` / `getComposers()` / `getFolders()` —— **9 个实体**。

**`selected_aa` 的三态语义**（`:1913-1956`）——这是"0 字节文件"设计的闭环：

```java
path = х.А(ctx, "selected_aa", name, cab)
long size = NativeUtils.native_file_size_ar(path)
if (size < 0)  → 文件不存在，继续 ④（用户未覆盖）
if (size == 0) → **返回码 2**：显式"无封面"
                  job.o = widget/bitmaps/К.B（默认占位图）
if (size > 0)  → 解码该文件并返回
```

⇒ 用户在选择器里点 "No album art" 生成的 0 字节文件，在此被判为**显式无封面**并短路整个后续查找。写入侧（§4.2）与读取侧（本节）就此闭环。【实证·smali】

**返回码汇总**：`0` 未找到 / `1` 与 `4` 找到（`4`=缓存命中）/ `2` 显式为空 / `3` 跳过。

文件夹候选名固定 `folder` / `cover` / `albumart`。

---

## 6. 在线下载管线

### 6.1 `mayBeDownloadAlbumArt`（`:255-440`）

9 个参数（`<T::l1; : m1>`）：

```
(m1 entity, String title, String artist, String album, String directQuery,
 int fileType, long id, l1 parent, String parentArtPath)
```

**参数角色经 `k2.M(...)` → `h1.В(...)` 确认**（`h1.smali:3588`）：

| 参数 | 用途 |
| --- | --- |
| `p0` title | query 的标题项 |
| `p1` artist | query 的艺术家项 |
| `p2` album | query 的专辑项 |
| `p3` 直接 query | 非空时**跳过拼接**直接用（playlist 等无标签场景） |
| `p4` fileType | 由 `okhttp3/.../y.c(int)` 判定是否走"无标签也可搜"分支 |
| `p5` StringBuilder | 输出缓冲 |

偏好 `у;->f`（`aa_per_stream_track`，默认 false）影响该分支。

**`fileType` 的确切作用**（`h1.В` 的 `:3595-3643` 分支 + `okhttp3/.../y.c(int)`，后者 `:737`）：

```java
if (fileType == 0x17 /* 23 = 流媒体 */ && prefs.aa_per_stream_track) {
    if (title != null && title.length() != 0 && album != null && album.length() != 0) {
        // 走下方常规拼接
    } else {
        // 直接用 p3（直接 query），不走 title/artist/album 组合
    }
}
```

`fileType == 23` 是 Poweramp 内部"流"的类型码（与 `poweramp-streams-view.md` 记录的 `file_type=23` 一致）。

**常规拼接逻辑**（`:3646-3765`）：title/artist/album 三者皆空时返回 `null`（不搜索）；否则按 `"artist - album - title"` 组合，末尾调 `audio/core/х.k()` 归一化。

流程：

1. `entity.M(...)` 构造搜索 query；`entity.u0()` 得缓存子目录名
2. `х.А(ctx, u0(), sb, cab(0x200))` 拼目标路径；**空名直接 return false**
3. 若 `parent != null`，以 `fileType = -1` 同样处理
4. 组装 `dialogs/h0` 任务对象（`B=id`、`Р=album`、`P=artist`、`р=title`、`О=fileType`、`H=entity`、`C/cache art path`、`С/parent art path`、`c = entity instanceof z1`）
5. 若 `h0.c` 为真（支持在线搜索）：显示 `progress`，`handler.post(H(this,7,h0))` → `P.X(job, hiRes, opts, handler)`

**此方法本身不作偏好检查，也不检查网络**；守卫在下游。【实证·smali】

### 6.1.1 `data/aa` 包完整结构（22 个类）

| 类 | 大小 | 基类 | 职责 |
| --- | --- | --- | --- |
| **`P`** | 87 KB | Object | **下载器**（查找+抓取+落盘缓存），日志名 `"GoogleArtDownloader"` |
| **`х`** | 80 KB | Object | **解析器 `AAResolver`**：核心取图逻辑，返回码 0/1/2/3/4 |
| `X` | 35 KB | **Handler** | 下载任务的 Handler 子类，含 `aa_status` 负缓存写入 |
| `d` | 23 KB | **Enum** | **14 种请求策略**（`YA_2026`/`YA_HD_2026`/`BING_2026`/…） |
| `AAContentProvider` | 23 KB | ContentProvider | `__AAProvider`：以 `ParcelFileDescriptor` 对外暴露封面（内容 URI） |
| `C` | 21 KB | Object | **MusicBrainz JSON 客户端**（含 1 秒限流） |
| `y` | 21 KB | `widget/bitmaps/А` | **位图缓存中枢** + `MsgBusSubscriber`（§7.1） |
| `f` | 18 KB | **Reader** | 逐行读取 HTML/JSON 响应 |
| `e` | 16 KB | Object | **XOR 混淆 URL 表**（密钥 `01 35 78 2B 05 7B 29 5B`） |
| `K` | 15 KB | Object | **CoverArtArchive 客户端** + `ImageCandidate` 评分 |
| `А` | 7.5 KB | **WeakReference** | **单次任务对象**（title/album/artist/path/bitmap/aaType/id） |
| `у` | 5 KB | synthetic | 合成类（Lambda 胶水） |
| `О` | 4.3 KB | Object | **`MBIDResult`**（mbid, score, recordingIndex） |
| `O` | 3.4 KB | Object | **`MBIDs`**（recordingMBIDs, releaseMBIDs） |
| `К` | 3.4 KB | Object | **`ImageCandidate`**（url, score, index） |
| `Р` | 1.1 KB | Object | **全接受 X509TrustManager**（安全缺陷，见 §9.2 N2） |
| `В` | 0.65 KB | Object | `(х, у)` 二元持有者 |
| `H` | 0.58 KB | Object | `(String mime, Bitmap)` 结果载体（下载完成消息的 payload） |
| `Н` | 0.38 KB | synthetic | 合成类 |
| `A` | 214 B | **interface** | 任务接口 |
| `B` | 216 B | **interface** | 回调 `В(А, String)Z` |
| `С` | 189 B | **interface** | — |

**数据流**：

```
dialogs/SelectAlbumArtActivity
  → mayBeDownloadAlbumArt → new dialogs/h0(extends aa/А)
  → aa/P.X(job, hd, opts, handler)
       ① aa/e(URL 表) + aa/d(策略) → 选端点
       ② aa/C(MusicBrainz) → aa/O(MBIDs) → aa/K(CAA) → aa/К(ImageCandidate 评分)
       ③ aa/f(Reader) 解析 HTML/JSON
       ④ 下载 → 原子落盘 → 解码
       ⑤ Message 0x3e8 + aa/H(mime, bitmap) → 列表
  失败全候选 → aa/X.В(Message) → 写 aa_status bit1
  → aa/y 位图缓存 + AAContentProvider 对外提供
```

### 6.2 下载器 `data/aa/P`

日志标签仍叫 `"GoogleArtDownloader"`（历史遗留），实际是多源查找器：

- `В(А, z1)` 构造 query
- `А(А, query, hd)`：MusicBrainz → CoverArtArchive，取 ≤3 个候选 URL
- `B(...)`：HTML/JS **抓取器**（找 marker 岛屿、`\xHH` 反转义、host 过滤）
- `х(url, tmpPath, opts)`：下载 → 原子落盘 → 解码
- `x([B, tmpPath, opts)`：`native_open_fd(...,0x241)` → JPEG q95 重压缩 → `fsync` → `native_file_rename_ar`（临时→正式）
- `B:boolean` = **取消标志**；`А:boolean` = **遇到过 captcha**

`A()` 构造 OkHttp 时用**接受一切的 HostnameVerifier 与 X509TrustManager**，`retryOnConnectionFailure(false)`，超时 4000ms（SDK≥23）/7000ms。

### 6.2.1 请求策略：14 个枚举，实际只用 2 个

`data/aa/d` 是枚举，字段名被混淆成单字符。`<clinit>` 中的 14 个策略：

| 策略名 | 说明 |
| --- | --- |
| `MOBILE_2016` | Google 移动版 2016 |
| `YA_2026` | Yandex 普通（**当前默认**） |
| `YA_HD_2026` | Yandex 高清（**HD 时使用**） |
| `BING_2026` | Bing 普通 |
| `BING_HD_2026` | Bing 高清 |
| `BASE_2026` / `HD_2026` | Google 2026 普通/高清 |
| `BASE_2025` / `HD_2025` | Google 2025 |
| `BASE_2019` / `HD_2019` | Google 2019 |
| `BASE_2018` / `HD_2018` | Google 2018 |
| `MOBILE_2018` | Google 移动版 2018 |

**只有 2 个字段被赋值**（`d.smali:101` / `:137`）：

```java
d.р = YA_2026        // 普通
d.p = YA_HD_2026     // 高清
```

另有一个 `d.О:[Ld;` 数组容纳全部 14 条，但**只被 `values()` 读取**（枚举基础设施），运行时从不遍历。

实际选择点（`P.smali:944-954`）：

```java
d strategy = hd ? d.p /*YA_HD_2026*/ : d.р /*YA_2026*/;
this.Р = strategy;
```

> **结论**：虽然枚举里保留了 2016–2026 六代、两个站点的策略，但运行期**只有 Yandex 两条**生效。**没有代际降级链**——若 Yandex 抓取失败，不会回落到 Bing/Google，而是直接判定"全部候选失败"（触发 §5.4.1 的负缓存）。这是一处值得注意的实现特征。

每条策略携带：URL 模板、User-Agent、marker 起止串、正则 Matcher、前缀过滤、以及一个 `aa/С` 回调。

### 6.3 CoverArtArchive 缩略图选择

`data/aa/K` 的 `<clinit>` 定义两个**尺寸键优先级数组**（`:25-45`）：

| 数组 | 内容 | 用途 |
| --- | --- | --- |
| `K.х` | `["500","large","250","small","1200"]` | 普通 |
| `K.Х` | `["1200","500","large","250","small"]` | **高清（1200 优先）** |

选择逻辑（`K.smali:134-185`）：

```java
JSONObject thumbs = image.optJSONObject("thumbnails");
if (thumbs != null) {
    String[] order = hd ? K.Х : K.х;
    for (String key : order) {
        String url = thumbs.optString(key).trim();
        if (url.startsWith("https://") || url.startsWith("http://")) return url;   // 首个合法即返回
    }
}
// 无 thumbnails 或全不合法 → 回落到 image.image（原图）
return image.optString("image").trim();
```

**即：按尺寸优先级取第一个以 `http(s)://` 开头的 URL；都取不到则用原图 `image` 字段。**

CAA JSON 中实际使用的键（`K.smali:89-328`）：

| 键 | 用途 |
| --- | --- |
| `images` | 图片数组 |
| `thumbnails` | `{small, 250, large, 500, 1200}` |
| `image` | 原图 URL |
| `approved` | 是否已审核（影响排序/过滤） |
| `front` | 是否封面 |
| `types` | 类型数组，含 `"Front"` / `"Back"` |

`ImageCandidate`（`aa/К`）携带 `(url, score, index)`，`MBIDResult`（`aa/О`）携带 `(mbid, score, recordingIndex)`——两者都参与排序。

### 6.3.1 重定向解析

`K.В(HttpUrl, boolean hd, int)`（`:529-660`）：

```java
Request r = new Request.Builder()
    .url(url)
    .header("User-Agent", ua)          // "Poweramp/<versionCode> (support@…)"
    .header("Accept", "application/json")
    .build();
Response resp = client.newCall(r).execute();
if (resp.isRedirect()) {
    String loc = resp.header("Location");
    if (loc != null) url = resp.request().url().resolve(loc);   // 相对/绝对均支持
}
```

即 **手动跟随 302**（`coverartarchive.org/release/<mbid>` 会重定向到实际图片 CDN）。

### 6.3.2 MusicBrainz 客户端（`data/aa/C`）

**端点与查询构造**（`:668-698`）：

```
host = "musicbrainz.org"
path = "ws/2/recording"
query = "recording:\"<title>\"" [ + " AND artist:\"<artist>\"" ] [ + " AND release:\"<album>\"" ]
params: fmt=json, limit=<n>
```

拼接顺序由 `В(String,String,String)`（`:438`）按 title/artist/album 非空逐项追加 `" AND ..."`。

**响应解析**：`recordings` 数组 → `releases` → 提取 MBID，产出 `aa/O`（`MBIDs{recordingMBIDs, releaseMBIDs}`）与 `aa/О`（`MBIDResult{mbid, score, recordingIndex}`）。

**限流（`:851-898`）—— 1000ms 最小间隔**：

```java
synchronized (this.А) {                       // 对象锁串行化
    long now  = SystemClock.elapsedRealtime();
    long wait = (this.A + 1000) - now;        // A 存上次请求时刻
    if (wait > 0) Thread.sleep(wait);
    this.A = SystemClock.elapsedRealtime();
}
```

即**全局串行 + 每秒最多 1 次**，符合 MusicBrainz 的 API 礼仪要求。`elapsedRealtime` 而非 `currentTimeMillis`，不受系统时间调整影响。

Header：`User-Agent: "Poweramp/<versionCode> (support@…)"` + `Accept: application/json`。

### 6.3.3 无代际降级链（重要设计特征）

结合 §6.2.1 与本节，**实际取图路径只有一条**：

```
MusicBrainz（1 req/s 限流）
  → CoverArtArchive /release/<mbid>
    → 302 → 图片 CDN
      → 下载 → 落盘
```

`P.А(...)` 若选择 `YA_2026`/`YA_HD_2026` 策略，则改走 **Yandex 图片搜索抓取**（HTML marker 解析），而不是 MB/CAA。

**两条路径互斥，失败后不回落到另一条**：

| 场景 | 行为 |
| --- | --- |
| MB/CAA 无结果 | 该策略结束 → 判定失败 |
| Yandex 抓取失败 | 判定失败 |
| 任一策略失败 | **不尝试其他策略**，直接进入 §5.4.1 的负缓存写入 |

> 【推断】这是"单策略 + 负缓存"的设计取向：宁可标记为无图并让用户手动选，也不做多源轮询（省流量、避免封 IP）。代价是容错性偏弱。

### 6.4 下载结果回到列表

`P.Х` 完成后发 `Message 0x3e8`，携带 `data/aa/H{mime, bitmap}`，`arg1/arg2` = 宽高：

```java
// session/К.smali:6042-6098
i0.С(bitmap, arg1 + "x" + arg2, mime.equals("image/png"))
```

内存不足时中止：`maxMemory - used < 0xa00000`（10 MB）。

---

### 6.5 在线端点清单（仅作证据记录，未抓取）

| 服务 | 端点 |
| --- | --- |
| Yandex Images | `yandex.com/images/touch/search?...&text=<q>&isize=medium&iorient=square` |
| Yandex HD | 同上但 `isize=large` |
| Bing Images | `bing.com/images/search?q=<q>&qs=n&form=QBIR…` |
| Bing HD | 增加 `qft=+filterui:imagesize-wallpaper` |
| Google Images | `google.com/search?...&tbm=isch&prmd=vin…` |
| Google HD | 增加 `tbs=islt:xga,isz:m` |
| **MusicBrainz** | `musicbrainz.org/ws/2/recording?query=recording:"…"[ AND artist:"…"][ AND release:"…"]&fmt=json&limit=10` |
| **Cover Art Archive** | `coverartarchive.org/release/<mbid>`（JSON `images[]` + `thumbnails{small,250,large,500,1200}`） |

URL 以 XOR 混淆表存储（`data/aa/e.smali`，密钥 `01 35 78 2B 05 7B 29 5B`）。

**被封禁的候选 host**：`lumendatabase.org/`、`google.com/`、`www.google.com/`、含 `gstatic` 的 URL。

MIME 白名单：`image/{jpeg,jpg,png,webp,gif}`。


## 7. 生命周期与线程模型

| 组件 | 说明 |
| --- | --- |
| `h: HandlerThread("select album art loader", prio 10)` | 专用加载线程 |
| `i: Handler(h.getLooper())` | 加载线程调度 |
| `F: session/К`（main looper Handler） | 消息泵 |
| `q: MsgBus` | 订阅 `bus_app` (0x7f0d015b) |
| `D: async/K` | 当前元数据任务 |

**取消语义**（`Н()`，`declared-synchronized`）：

```
g.B = true                                  // 取消下载器
i.removeCallbacksAndMessages(null)
F.removeCallbacksAndMessages(null)
i.post(b0(1)) → OkHttpClient.connectionPool().evictAll() + h.quit()
```

触发点：`onDestroy`、`onDialogCollapsed`、`onBackButtonIntercepted`。

`onDestroy` 额外回收所有 `Bitmap`（遍历 `s.p` / `s.О` 并清空 `e0.В`）——避免泄漏。切换列表时（`y()` 前）会 `D.В()` 取消前一个任务。

### 7.1 封面缓存中枢 `data/aa/y`

`aa/y`（`super widget/bitmaps/А`，实现 `aa/B` 与 `MsgBusSubscriber`）是**全局封面位图缓存的唯一中枢**，也是 `cmd_app_refresh_aa` 的接收方：

| 收到消息 | 动作 |
| --- | --- |
| `cmd_app_refresh_aa` `0x7f0d003c` | `prefs/В;->v`（`aa_force_default`）→ `widget/bitmaps/А.i`；`C()` 清缓存；`post(msg_app_aa_refreshed 0x7f0d0044)` |
| `cmd_app_clean_aa` `0x7f0d003d` | 按传入的 `[J` / `utils/y` / `Long` 批量失效指定 id 的缓存条目 |
| 其他 | 转 `super.dispatchMessage` |

`msg_app_aa_refreshed` 的订阅者与动作：

| 订阅者 | 动作 |
| --- | --- |
| `list/n0.smali:4251-4279` | 遍历所有 page 条目 → `P.X.В()` 清位图（**列表立即重绘**） |
| `widget/Navbar.smali:472-497` | `Navbar.i0.X.В()` 清位图 → `PowerList.H()` 重绘导航栏分类图标 |
| `player/PlayerService.smali:11519-11550` | 与其他 8 个消息共享同一分支（`0x7f0d0049/0044/0043/004a/0227/022f/0310/03c5`）→ 统一刷新播放状态 |
| `player/H.smali:1185-1203` | `removeMessages` + `sendMessageDelayed(msg, PlayerService.C())` → 延迟重发，避免刷新风暴 |
| `output/cc/CcPluginService.smali:2037-2055` | 取 `StateBus 0x7f0d00a2` 的当前曲目 → `P(track, bool)` 重新推送 Cast 封面 |

**这就是"选完封面立刻生效"的机制**：不需要重建列表数据，只需清位图缓存后重绘，重绘时 `data/aa/х` 重新按优先级解析（§5.4），命中新写入的 `selected_aa` 文件。

### 7.1.1 对外暴露：`AAContentProvider`

封面通过一个 **ContentProvider**（authority `__AAProvider`）以 `ParcelFileDescriptor` 形式对外提供，供 WebView / Cast / 系统 MediaSession 消费。

**URI 契约**（`AAContentProvider.smali:144-796`）：

| URI 形态 | 用途 |
| --- | --- |
| `content://__AAProvider/res/<drawable名>?fallbackPx=<n>` | **内置占位图**（`res/` 段 + `fallbackPx` 参数） |
| `content://__AAProvider/<subPath>?aaType=<n>&...` | **真实封面**（`subPath` + `aaType` 定位实体与条目） |

**错误契约**（异常类型与消息固定）：

| 条件 | 异常 |
| --- | --- |
| URI 为空 | `IllegalArgumentException("!uri")` |
| 无法解析出 subPath | `IllegalArgumentException("!subPath uri=" + uri)` |
| `aaType` 非法 | `IllegalArgumentException("!aaType=" + n + " uri=" + uri)` |
| 服务未就绪 | `IllegalStateException("not yet started")` |
| 找不到文件 | `FileNotFoundException(uri.toString())` |

**`onCreate`**（`:823-862`）从 `"RestLibrary"` 系统服务取到 `g1`，据此判定"已启动"；未就绪时 `openFile` 抛 `IllegalStateException`。

支持的可选能力：**ashmem 传输**（`aa_no_ashmem` 偏好可强制走普通文件 fd，见 §8 D 表）。

### 7.2 下载失败与负缓存
`cmd` 处理链在 `aa/X.В(Message)` 内对每个候选 URL 逐个尝试：

```
for (url in candidates) {
  bitmap = P.х(url, tmpPath, opts)      // 下载 → 落盘 → 解码
  if (bitmap == null) {
    Log.e("failed to get image for url=" + url)   // 仅记录，继续下一个
    continue;
  }
}
// 全部候选都失败后：
if (job.H != null) {                     // А.H = l1 实体
  String table = ((х) job.H).n();        // 动态表名
  db.execSQL("UPDATE " + table + " SET aa_status=(aa_status&~2)|2 WHERE _id=" + job.B);
}
```

即**负缓存只在"确认所有候选都取不到"时写入**，而不是单次网络失败就写。这样避免把临时网络问题固化成"永久无封面"。

### 7.3 过期结果丢弃：缓存代次（generation）

`data/aa/X.В(Message)` 在处理每个下载任务前有**代次守卫**（`:50-64`）：

```java
synchronized (bm.y) {
    int jobGen   = job.X;          // 任务创建时的代次快照
    int cacheGen = bm.f;           // 当前缓存代次
    if (jobGen != 0 && (cacheGen - jobGen) >= 32) {
        return;                    // 太旧的任务：丢弃，不写位图也不写 DB
    }
}
```

`bitmaps/А.f` 语义（`bitmaps/А.smali:128-130`、`:1017-1021`）：

| 事项 | 值 |
| --- | --- |
| 初始值 | `1`（构造时 `iput v0=1`） |
| 递增时机 | 每次清缓存（`msg_app_aa_refreshed` → `C()`）时 `f + 1` |
| 丢弃阈值 | 差值 `>= 0x20`（**32**） |

**为什么是 32 而不是 1**：允许少量"落后"任务继续完成（用户快速翻页时不浪费已发出的请求），但明确丢弃落后过多的陈旧结果——**防止旧任务在新一轮加载完成后把过期封面写回缓存**。

> 【推断】阈值 32 为经验值：容忍短期波动，同时在持续交错时收敛。

### 7.4 `data/aa/X` 的消息分支

`dispatchMessage` 按 `X.В`（线程槽位，见 §10 Q9）选择：

| `X.В` | 分支 | 行为 |
| --- | --- | --- |
| 0 | `pswitch_0` | 转 `super.dispatchMessage`（标准 Handler） |
| 1 | `pswitch_1` | → 私有 `В(Message)`（**主处理**：代次守卫 + 取图 + 负缓存） |
| 2 | `pswitch_2` | 初始化辅助对象 |

私有 `В(Message)` 内部再按 `msg.what` 分流：

| `msg.what` | 分支 |
| --- | --- |
| `-1` | `cond_10`（异常/结束路径） |
| `0` | `cond_f`（空 obj） |
| 其他 | 正常：`obj` 转 `aa/А` → 代次守卫 → 执行取图 |

---

## 8. 与 `poweramp-album-art-settings.md` 的交叉核对

设置页 `res/xml/aa.xml`（`0x7f160000`）的 19 项在本文范围内**全部一致**。发现的 5 处版本漂移：

| # | 项 | 旧文档（build-1035） | 本版（1025） |
| --- | --- | --- | --- |
| D1 | 内存判定字段 | `ׅ/xn0->о` | `com/maxmpz/utils/vendor/B->O`（公式与 0x80 阈值相同） |
| D2 | 清缓存 action code | `0x18` | `preference/u(0x17, …)` |
| D3 | 重置负缓存路径 | 直接调用 | `preference/h0(2)` → 确认框 → `dialogs/C(8,…)` → `MsgBus` → `session/К` 批量 UPDATE（**9 张表**） |
| D4 | `aa_mobile_agent` | 未提及 | **声明但无 `sput`，完全死键** |
| D5 | `aa_anim` | 未提及 | 有偏好键，**无消费者** |

另有 1 处**文档未覆盖**：`reset_negative_aa_status` 实际重置的表清单（files / albums / artists / album_artists / albums_by_artist / genres / years / composers / folders）。

---

## 9. 值得借鉴 / 不建议照抄

### 9.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **哨兵行占 index 0**（"No album art"） | 无需额外按钮即可"移除封面"，且天然与"选图"同一交互 |
| A2 | **0 字节文件表示"显式无封面"** | 与"未解析"（无文件）区分开，避免反复重试下载 |
| A3 | **`aa_status` 位掩码而非枚举** | bit0=有图、bit1=已确认无图，可用 `(x&~2)\|2` 只改一位而不覆盖其他信息 |
| A4 | **`!=2` + `ORDER BY DESC` 组合** | 一条 WHERE 同时表达"跳过已知无图"与"有图优先" |
| A5 | **多源候选并列展示** | 内嵌/文件夹/在线同框，用户按宽高与来源自选，优于自动猜测 |
| A6 | **`isPng` 决定落盘格式** | 无损源不降级，有损源不膨胀；规则简单且可预测 |
| A7 | **两个候选尺寸并行加载**（`j/k/l`） | 先出低清缩略图，高清随后替换，网格滚动不卡 |
| A8 | **"Also use for" 级联到父实体** | 改一次封面可同时覆盖专辑/艺术家，避免逐层重复操作 |
| A9 | **`р()` 返回 plurals 资源 id** | 数量文案按分类自然变化（songs/albums/artists），无需字符串拼接分支 |
| A10 | **专用 HandlerThread + 显式取消** | `g.B=true` + `evictAll()` + `h.quit()`，弹窗关闭即停网 |

### 9.2 不建议照抄

| # | 做法 | 理由 |
| --- | --- | --- |
| N1 | **文件名固定 `.jpg` 但内容可能是 PNG** | 扩展名与实际格式不符，依赖解码器嗅探；应让扩展名跟随格式 |
| N2 | **下载器信任一切证书**（always-true HostnameVerifier + 全接受 X509TrustManager） | 中间人可注入任意图片；应使用系统信任链 |
| N3 | **`ContentValues.put("aa_status", "aa_status=0")` 传 SQL 表达式字符串** | 依赖 SQLite 亲和性的隐式行为，应直接写整数 0 |
| N4 | **`aa_status` 位语义无中央定义** | 0/1/2/3 的含义散落在写入点，读者须反推；应有具名常量 |
| N4b | **bit1 负缓存是单向闩锁，无成功时自愈**（§5.4.1） | 一次全候选失败即永久生效，仅靠用户手动"重置"恢复；可考虑成功取图时顺带清 bit1 |
| N5 | **来源区分只靠副标题文案** | 无 enum / 无类型字段，本地化会丢失来源信息，程序也难以分流 |
| N6 | **声明但永不使用的偏好键**（`aa_mobile_agent` 缺 `sput`；`aa_anim` 无消费者） | 死配置误导使用者与维护者 |
| N7 | **`mayBeDownloadAlbumArt` 自身不检查网络与偏好** | 守卫分散在下游，调用方难以预期是否真正发起请求 |
| N8 | **逻辑依赖消息接力三段跳**（`cmd_list_select_aa_dialog` → `cmd_data_album_art` → Activity） | 追踪成本高；两段即可达成的路由用了三段 |

---

## 10. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`aa_status` bit0 是否也覆盖文件夹图片~~ | **已闭环**：`data/aa/х` 只把 `aa_status` 当投影列**读**（`:299`），无写入；bit0 仅由扫描器"内嵌标签有封面"标志（`&0x4`）产生。**文件夹图不置 bit0** |
| Q2 | 是否有写入点产生 `aa_status = 3` | 仅见 `0`/`1`/`2` 与掩码形式，无字面 3 |
| ~~Q3~~ | ~~实体级 `albums.aa_status` 等列的写入点~~ | **已闭环**：`aa/X.В()` 用 `А.H` 的 `n()` 动态取表名写入 bit1；见 §5.2.1 |
| ~~Q4~~ | ~~`cmd_app_refresh_aa` 的接收方~~ | **已闭环**：`data/aa/y.smali:169-193`（实现 `MsgBusSubscriber`），见 §5.2.2 / §7.1 |
| ~~Q5~~ | ~~`g0` 传给 `mayBeDownloadAlbumArt` 的 7 个字符串角色~~ | **已闭环**：经 `k2.M(...)` → `h1.В(...)`，参数为 `title / artist / album / 直接query / fileType / StringBuilder`；见 §6.1 |
| ~~Q6~~ | ~~HD 开关的键名~~ | **已闭环**：`aa_download_hd`（`prefs/В.F`，默认 false） |
| ~~Q7~~ | ~~`widget/list/c2` 网格参数~~ | **已闭环**：**横屏 4 列 / 竖屏 2 列**（`c2(density, 4|2, -1)`），见 §2.6 |
| ~~Q8~~ | ~~选择封面后 `aa_status` 如何得知"有图"~~ | **已闭环**：不写 `aa_status`，靠文件存在性 + 缓存失效广播；见 §5.2.2 |
| Q9 | `aa/X.В:I` 选择器 0/1/2 的语义 | **已确认是线程槽位**：`0`=后台加载线程（`y.smali:448`）、`2`=另一后台线程（`:419`）、`1`=**主线程**（`bitmaps/А.smali:523`） |
| ~~Q10~~ | ~~`msg_app_aa_refreshed` 其余 4 个订阅者~~ | **已闭环**：Navbar 清位图+重绘、PlayerService 多消息合并、`player/H` 延迟重发、CcPlugin 重推 Cast 封面；见 §7.1 |
| ~~Q11~~ | ~~`fileType` 对 query 的影响~~ | **已闭环**：`fileType==23`（流媒体）且 `aa_per_stream_track` 开启时，直接用 `p3` 而不走 title/artist/album 组合；见 §6.1 |
| ~~Q12~~ | ~~成功取到封面时为何不清 bit1~~ | **已确认是单向闩锁**（§5.4.1）：全库无清 bit1 的写入，仅手动重置可解除。属有意负缓存还是疏漏无注释可判 |
| Q13 | `aa_status` 值 3 的实际可达性 | 需 bit0 与 bit1 同时置位；理论可达（先扫描到内嵌图写 1，后下载失败写 3），无埋点验证 |
| Q14 | 代次阈值 32 的取值依据 | 无注释；推测为经验值（§7.3） |
| Q15 | 6 种历史策略（2016/2018/2019/2025）是否还有可达路径 | 当前只见 `YA_2026`/`YA_HD_2026` 被赋值；其余为枚举残留（§6.2.1） |

---

## 11. Evidence 索引

### 11.1 关键产物位置

| 主题 | 来源 |
| --- | --- |
| 选择器实现 | `dialogs/SelectAlbumArtActivity.smali`（1760 行 / 49 KB） |
| 选择器布局 | `res/layout/dialog_content_select_album_art.xml`（12 行） |
| 主题解析 | `BasePowerWidgetActivity.smali:1342-1394`（`"dialog_" + simpleName`） |
| 行模型 / 适配器 | `dialogs/e0.smali`、`dialogs/i0.smali`（`С()` 在 `:218-255`） |
| 监听器 | `dialogs/c0.smali`（HD 复选框）、`dialogs/b0.smali`（刷新/退出）、`dialogs/d0.smali`（候选装载） |
| 落盘线程 | `audioplayer/A.smali:38-192` |
| 图片编码 | `SelectAlbumArtActivity.smali:110-165`（`у(File,Bitmap,boolean)`） |
| 下载器 | `data/aa/P.smali`（含 `e.smali` XOR URL 表） |
| 主解析器 | `data/aa/х.smali:968-2185`（`K(...)` 返回码 0/1/2/3/4） |
| `aa_status` 写入（bit1） | `data/aa/X.smali:1019-1040` |
| `aa_status` 写入（bit0） | `scanner/library/P.smali:822-828` |
| `aa_status` 重置 | `session/К.smali:1059-1176` + `dialogs/C.smali:361-386` |
| 实体 `р()`（plurals） | `p0:3304`（file）、`j:551`（album）、`t`（artist）、`d4`（stream） |
| 设置页 | `res/xml/aa.xml`（`0x7f160000`） |

### 11.2 资源 id 速查

| 名称 | id |
| --- | --- |
| `@id/album_art` | 0x7f0d0262 |
| `cmd_list_select_aa_dialog` | 0x7f0d0061 |
| `cmd_data_album_art` | 0x7f0d0062 |
| `cmd_data_reset_aa_status` | 0x7f0d0064 |
| `cmd_app_refresh_aa` | 0x7f0d003c |
| `@string/album_art` | 0x7f080046 |
| `@string/art_image` | 0x7f08006f |
| `@string/no_album_art` | 0x7f0803a6 |
| `@string/also_use_for_s` | 0x7f08005c |
| `@string/pick_image` | 0x7f080420 |
| `@string/embed_album_art` | 0x7f0801b2 |
| `@string/in_folder_image` | 0x7f080277 |
| `@string/pref_aa_download_hd` | 0x7f08045a（"High Resolution"） |
| `@string/also_use_for_s` | 0x7f08005c |
| `@id/checkbox` | 0x7f0d01f0 |
| `@id/use_for` | 0x7f0d057c |
| `@id/settings_button` | 0x7f0d02e9 |
| `@id/progress` | 0x7f0d026f |
| `@id/message` | 0x7f0d0236 |
| `@id/list` | 0x7f0d0208 |

### 11.3 跨版本对照（build-1035）

`v1035/decoded` 的 `dialogs/SelectAlbumArtActivity.smali`（3227 行 / 64 KB，vs 本版 1760 行 / 49 KB）**结构一致，仅混淆类名与常量内联方式不同**：

| 比对项 | 1025 | 1035 |
| --- | --- | --- |
| 布局 id `@id/checkbox` | 0x7f0d01f0 | **0x7f0d01f0** ✅ |
| `@id/use_for` | 0x7f0d057c | **0x7f0d057c** ✅ |
| `@id/progress` | 0x7f0d026f | **0x7f0d026f** ✅ |
| `@id/message` | 0x7f0d0236 | **0x7f0d0236** ✅ |
| `@id/list` | 0x7f0d0208 | **0x7f0d0208** ✅ |
| `mayBeDownloadAlbumArt` 签名 | `(m1,S,S,S,S,I,J,l1,S)Z` | `(my0,S,S,S,S,I,J,ly0,S)Z` ✅ 同构 |
| `onSubItemClick / onItemClick / resolvePath / onActivityResult` | 有 | **均有** ✅ |
| `GET_CONTENT` 选图 action | 有 | **有**（`:1375`） ✅ |

**字符串改为内联常量**：v1035 中不再出现 `pick_image` / `no_album_art` / `also_use_for_s` / `pref_aa_download_hd` 等字符串名，改为直接的 `const vN, 0x7f...`（编译期内联），因此按字符串名 grep 会漏，须按 id 查。

> 结论：**选择器的布局契约、方法结构、选图 action 跨版本未变**；差异属于构建期优化与混淆重命名，不是功能变更。

### 11.4 复现命令

```powershell
$env:JAVA_HOME = "<rea-bundle>/vendor/jdk"
apktool d --no-res -f -o <out> .rea-analysis/Poweramp-v3.apk
# 关键搜索：
#   "cmd_list_select_aa_dialog"        → 菜单项 msgId
#   "dialogs.SelectAlbumArtActivity"   → 路由目标
#   "aa_status=(aa_status&~2)|2"       → 位掩码写入（证明非枚举）
#   "selected_aa"                      → 用户选择图目录
#   "coverartarchive.org"              → 在线源
#   "Also use for: %s"                 → 级联复选框
```

---

## 12. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| `poweramp-album-art-settings.md` | 设置页 19 项偏好；本文 §8 交叉核对并列出 5 处漂移 |
| `poweramp-queue-view.md` | `aa_status` 读取侧（队列 `f0()`）；本文 §5.2 给出写入侧与位语义 |
| `poweramp-list-options.md` | 同族弹窗（`BusActionButton`/`MsgBus`/`w:string` 深链）；本文复用其入口机制但对象不同 |
| `poweramp-entity-views.md` / `poweramp-category-views.md` | 各分类页面结构；本文只覆盖封面选择器 |
| `poweramp-streams-view.md` | 流分类；本文 §3.2 提到 `d4.р()` = streams 复数 |
| `poweramp-row-popup-cover.md` | **显示层**：行内封面控件（`AAImageView` / `IconView` / `CatImage`）与弹窗图像来源。本文是**数据层**（取图、落盘、负缓存），二者互补 |
