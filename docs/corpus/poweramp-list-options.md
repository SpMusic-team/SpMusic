---
doc_id: "ARCH-POWERAMP-LIST-OPTIONS"
title: "Poweramp 列表选项弹窗参考（动态分组 + 每分类能力探测）"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "project"
revision: 1
open_items: 16
created: "2026-11-17"
updated: "2026-11-18"
source_documents:
  - "user request: 逆向 Poweramp 媒体库根页面工具栏更多选项弹窗中「列表选项」的组织和具体实现"
  - "user request: 实机截图交叉验证（所有歌曲 / 文件夹 / 播放列表）与齿轮按钮设置跳转"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009) :: SHA-256 4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0"
  - ".rea-analysis/v1035/decoded（build-1035-bundle-play 1035009，跨版本对照）"
  - ".rea-analysis/smali/smali/com/maxmpz/**（apktool 反汇编，7308 个 .smali）"
  - ".rea-analysis/decoded/res/**（values / layout / layout-sw2dp / xml）"
  - "docs/corpus/poweramp-library-three-views.md（folders 表与 keep_list_pos 交叉印证）"
  - "docs/corpus/poweramp-settings-export-import.md（listMemory 导出类目交叉印证）"
  - "docs/corpus/poweramp-queue-view.md（同族独立表视图体例）"
---

# Poweramp 列表选项弹窗参考（动态分组 + 每分类能力探测）

## 0. 定位与证据分级

**本文记录外部实现 Poweramp 的「列表选项」（List Options）弹窗组织与数据模型，不是 SpMusic 现状。**

| 标记 | 含义 | 可信度 |
| --- | --- | --- |
| **【实证·产物】** | JADX 反编译方法体原文 | 最高 |
| **【实证·smali】** | 反汇编 smali 原文（`<clinit>`、`fill-array-data` 等） | 最高 |
| **【实证·原文】** | APK 资源字符串 / public.xml / 布局 XML 原文 | 高 |
| **【实证·实机】** | 用户提供的真实设备截图，与上述产物交叉验证 | 高（但仅覆盖截图中可见部分） |
| **【推断】** | 本文作者推理 | 低 |

### 0.1 一句话结论

**列表选项不是一张固定表单，而是「8 个分组 + 按分类能力动态点亮」的弹窗：`ListOptsActivity.onCreate` 用 8 处 `instance-of` 探测当前分类实体实现了哪些接口，再逐组 `setVisibility(VISIBLE)`；分组内部的选项来自实体自己的三元组数组。**

一句话补充：**同一份弹窗代码，在「所有歌曲」下显示 16 项排序、在「文件夹」下显示 6 项排序 + 倒序 + 布局、在「播放列表」下显示 4 项排序 + 倒序 + 查看方式**——这正是 Poweramp 自己的帮助文案所说的 "List Options are different per each category"。

### 0.2 三层结构

```
【入口层】见 §1
   列表项/页头「更多」按钮 (@id/menu)
   → P.n([I)Z 返回 {menuLayoutId, sceneId}   ← 四选一菜单布局
   → BusActionButton(msgId=cmd_list_options_dialog)
   → n0.H() 取分类 URI → ListOptsActivity

【组装层】见 §2 §3
   ListOptsActivity.onCreate
   → g1.у(uri) 解析分类实体（失败即 collapseDialog 退出）
   → 8 × instance-of 探测 → 逐组可见性
   → 各组内容由实体方法提供（g():int[] 三元组、с()、r0()、х() 等）

【持久层】见 §4
   排序/倒序 → sort_mode_* / 0x40000000 位
   视图模式 → list_zoom_<category>（每分类独立）
   精简标题 / 紧凑页头 → layout_1_line / layout_header_compact（位掩码 1<<C()）
   列表记忆 → playlists/folders.keep_list_pos / keep_track_pos
```

### 0.3 与既有队列文档的分工

| 文档 | 覆盖 |
| --- | --- |
| **本文** | **列表选项弹窗**：入口链路、8 个分组、每分类能力矩阵、排序/视图/记忆三套持久化、齿轮设置跳转 |
| `poweramp-queue-view.md` | 队列**页面**的数据模型（独立表 + `played_at >= created_at` 谓词） |
| `poweramp-queue-runtime-reference.md` | 播放运行时状态机（next/prev、随机语义） |
| `poweramp-library-three-views.md` | folders 表结构（本文 §4.3 交叉引用其 `keep_list_pos` 列） |

**无覆盖重叠。** 队列页的「列表选项」弹窗内容见本文 §3 矩阵，队列数据模型见 `poweramp-queue-view.md`。

---

## 1. 入口链路

### 1.1 「更多」按钮不是工具栏 overflow

Poweramp **没有** ActionBar/Toolbar overflow。列表根页是 `com.maxmpz.audioplayer.list.ListWidget`（`activity_main.xml:7`，id `@id/list`），"更多"表现为**每个列表项自带的小菜单按钮**：

```
res/layout-sw2dp/merge_item_aa_and_header.xml:4
<FastButton android:id="@id/menu" android:contentDescription="@string/menu" style="?ItemTrackMenu" />
res/layout-sw2dp/item_text.xml:24   （分类行，style="?ItemTextMenu"）
```

该按钮通过同文件的 `SceneParams` 绑定了 `scene_header` / `scene_header_1` 场景，因此**页头行上也有**——这就是实机上看到的"根页面工具栏更多按钮"。【实证·原文】【实证·实机】

点击由 `widget/player/c1.smali:468/495` 拦截（判 `id == 0x7f0d0021`）→ `c1.p0()`（`:2686`）。

### 1.2 菜单布局四选一（`P.n([I)Z`）

菜单项不是 `Menu` 资源，而是 merge 布局里的 `BusActionButton`。页面类通过 `n(int[])` 返回 `{layoutId, sceneId}`：

| 页面类 | 菜单布局 | 场景 |
| --- | --- | --- |
| `z0`, `у`（曲目/文件） | `merge_menu_items_tracks` (0x7f04008d) | `scene_item_menu` |
| `e`, `j`, `Н`, `С`, `t0`（媒体库/主页各类） | `merge_menu_items_lib` (0x7f0400ba) | `scene_item_menu` |
| `o0`（播放列表） | `merge_menu_items_playlists` (0x7f0400be) | `scene_item_menu` |
| `q`, `А`（单曲上下文） | `merge_menu_items_aa` (0x7f04008b) | `scene_item_menu` / `_lu` |
| 基类 `P` | 返回 `false` → 无菜单（`P.smali:1177-1183`） | — |

`list_options` 项存在于 **lib / tracks / playlists** 三种布局，**`merge_menu_items_aa.xml` 中没有**（已确认 0 命中）——单曲上下文菜单不含列表选项。【实证·原文】

### 1.3 菜单项声明

```xml
<!-- merge_menu_items_lib.xml:7 / merge_menu_items_tracks.xml:11 / merge_menu_items_playlists.xml:6 -->
<BusActionButton android:id="@id/list_options"
                 android:text="@string/list_opts"
                 android:drawable="?list_options"
                 w:busId="@id/list"
                 w:msgId="@id/cmd_list_options_dialog"
                 style="?PopupMenuItem" />
```

`cmd_list_options_dialog` = `0x7f0d0084`，全库**只有一个 smali 命中**：`list/n0.smali:5009`。

### 1.4 从点击到弹窗

```
BusActionButton 点击 → MsgBus 发 (busId=@id/list, msgId=cmd_list_options_dialog)
→ ListWidget.onBusMsg (ListWidget.smali:1258-1349) 转发
→ n0.onBusMsg (n0.smali:5009-5015)
     const v8, 0x7f0d0084
     if-ne v1, v8, :cond_3c
     invoke-virtual {v0}, Lcom/maxmpz/audioplayer/list/n0;->H()V
→ n0.H() (n0.smali:1549-1601)
     取当前页 P.w()（分类 URI，clearQuery 后）
     В.у(ctx, ListOptsActivity.class, arg1=0, uri)
```

`В.у`（`widget/app/В.smali:1494` → `y:1102`）构造 **action 为 null** 的组件 Intent，URI 以 **`"obj"` Parcelable extra** 传递（`:1136-1144`），**从不调用 `setData()`**（`:1204-1207` 由 `p6=null` 守卫生效）。因此 `ListOptsActivity` 里 `getData()` 为 null，走 extras 分支（`ListOptsActivity.smali:113-125`）。【实证·smali】

### 1.5 通用弹层结构

`@id/menu_items` 是 `FastLayout`（`merge_item_popup_menu.xml:8`），内含 `separator`。双列排布由样式实现：

| 样式 | 关键项 | 效果 |
| --- | --- | --- |
| `PopupMenuItem` | `layout_width=match_parent` | 全宽单行 |
| `PopupMenuItem50` | `layout_widthPercent=50%` + `consumeSpace=horizontal|reset_auto` | 半宽，两两并排 |

故 `merge_menu_items_aa.xml` 里 `add_to_pl50` / `bookmark` / `info` / `lyrics_in_menu` / `artist` / `album` / `folder` / `genre` 用 `PopupMenuItem50` 两两并排，而 `delete` / `add_to_pl` / `album_art` 全宽——**网格化上下文菜单**，与列表菜单的单列风格不同。【实证·原文】

### 1.6 运行时菜单项裁剪（`P.d0`）

`n()` 选布局，`P.d0(v0, ViewGroup)` 改内容。基类 `P.d0` 是真空实现（`P.smali:877-881`，`.locals 0` + `return-void`），仅 8 个页面类覆写：

| 类 | 动作 |
| --- | --- |
| `e` | 无条件 `add_to_home` → VISIBLE（`e.smali:159-175`） |
| `С` | 无条件 `add_to_home` → VISIBLE（`С.smali:786-802`） |
| `К` | 仅 `l==0` 时 `add_to_home` → VISIBLE（`К.smali:145-173`） |
| `q` | 只调 `info` LayoutParams、`lyrics_in_menu` → GONE（`q.smali:2135-2193`） |
| `q0`（队列页） | `folders` → GONE、`clear_q` → VISIBLE（`q0.smali:310-338`） |
| `А` | 仅调共享 `В->f`，不动项（`А.smali:415-427`） |
| `z0`（曲目页基类） | 主要裁剪者，见下表 |
| `у` | 强制 `resort` / `delete_dups` → GONE（`у.smali:242-256`） |

**tracks 布局运行时裁剪表**【实证·smali】：

| 项 | XML 初值 | 由 `d0` 控制 | 条件 |
| --- | --- | --- | --- |
| `folders` | visible | → GONE | `H.В` 是 `k3`（`z0:602-608`） |
| `rescan` | visible | 仅改名 | 同上（见 §1.7） |
| `album_art` | visible | 显隐 | `k0()` 是 `m1`（`z0:564-576`） |
| `delete_dups` | visible | 显隐 | `H.В` 是 `k3`（`z0:629-640`） |
| `resort` | visible | 显隐 | `H.В` 是 `w2`（`z0:611-627`） |
| `add_url` | **gone** | → VISIBLE | 页面是 `list/v` **且** `H.В` 是 `k1`（`z0:536-542`） |
| `clear_q` | **gone** | → VISIBLE | 仅队列页（`q0:327-335`） |
| `show_all` | **gone** | → VISIBLE | `H.В` 是 `x1`（被过滤/限量，`z0:654-660`） |
| `clear` | **gone** | → VISIBLE | 同上（`z0:646-652`） |

`folders` / `rescan` 只在 **lib** 与 **tracks** 出现，**不在 aa、不在 playlists**（playlists 有另一个改过文案的 `rescan`）。

### 1.7 `rescan` 的运行时改名

同一按钮承担两种动作，靠 `BusActionBehavior.P=1` 切换：

| 条件 | 文案 | 动作 |
| --- | --- | --- |
| 默认 | `pref_rescan_folders` = "Rescan" | 重扫目录 |
| `H.В` 是 `k3` | `0x7f080776` = **"Resolve playlists"** | 解析播放列表（`z0:592-600`） |

### 1.8 `scene_item_menu` vs `scene_item_menu_lu`

`P.n()` 返回的场景 id 由**偏好 `widget/player/h0;->c` = `"rating_type"`（整型）**决定（`А.smali:664-677`）：

```
if (rating_type != 0) → scene_item_menu_lu (0x7f0d0299)
else                  → scene_item_menu    (0x7f0d013c)
```

**`_lu` 不是换菜单内容**，而是同一场景的**紧凑变体**：`ItemLikeUnlikeLayout_scene_item_menu_lu` 让喜欢/不喜欢控件 `visible` 并 `scale=0.725`，并把 `ItemTrackTitle` / `Line2` / `Meta` / `Num` / `AAImage` / `RatingBar` / `PopupMenuTopSpacer` 全部重继承调整排版。即**启用评分/喜欢控件时改用的行布局变体**。【实证·原文】

> **勘误性质说明**：本节早期版本曾把 `h0;->c` 误认为场景开关。实际是整型偏好 `rating_type`（`h0.smali:396-402`，`const-string "rating_type"` + `m->с(ILjava/lang/String;)j0`）。

---

## 2. 组装层：8 个分组与能力探测

### 2.1 布局骨架

`res/layout/dialog_content_list_opts.xml`（`merge`，内容区 style `?DialogContent`）：

| 顺序 | id | 触发条件 | 内容 |
| --- | --- | --- | --- |
| 1 | `library_layout` 0x7f0d0266 | `instance-of g1` | Home Category 按钮（动态生成） |
| 2 | `search_layout` 0x7f0d0215 | `instance-of v3` | 搜索分类复选框（动态生成） |
| 3 | `list_memory_layout` 0x7f0d04d8 | `h0.k0()` 是 `e2` **且** `P(uri)!=0` | `list_pos` / `per_track_progress` |
| 4 | `duration_group` 0x7f0d0416 | `instance-of d3` | Min Duration SeekBar |
| 5 | `limit_group` 0x7f0d0267 | `instance-of d2` | Max Items 200/500/1000/unlimited |
| 6 | `sort_group` 0x7f0d0268 | `instance-of m2` 且 `d()!=-1` 且 `g()!=h1.В` | 排序单选（动态生成）+ 倒序 |
| 7 | `layout_group` 0x7f0d0699 | `q2` 或 `s2` 至少命中一个 | `compact_header` / `show_titles_only` |
| 8 | `zoom_group` 0x7f0d0269 | `instance-of r2` | 查看方式（动态生成） |

**全部默认 `gone`**，只有对应分支执行 `setVisibility(0)`。未知实体类型会得到空弹窗——但当前无此类实体能走到这里。【实证·原文】【实证·smali】

### 2.2 探测点一览（`ListOptsActivity.smali`）

| 行 | 探测 | 命中后 |
| --- | --- | --- |
| `:185` | `v8 instanceof g1` | `library_layout` |
| `:375` | `v8 instanceof v3` | `search_layout` |
| `:481` | `v8 instanceof m2` | `sort_group` |
| `:690` | `v8 instanceof d2` | `limit_group` |
| `:760` | `v8 instanceof d3` | `duration_group` |
| `:833` | `h0.k0() instanceof e2` | `list_memory_layout` |
| `:964` | `v8 instanceof r2` | `zoom_group` |
| `:1127` | `v0 instanceof q2` | `layout_group`（`show_titles_only`） |
| `:1243` | `v0 instanceof s2` | `layout_group`（`compact_header`） |

> **重要**：`d3`（Long Tracks）与 `v3`（Search）是 `final class`（`.super …/o0`），**不是接口**。二者均可由 `g1.getLong()` / `g1.getSearch()` 返回，因此两组都可达。【实证·smali】

### 2.3 空实体守卫

`g1.у(uri)` 返回 null → `collapseDialog()` + `return`（`:174-178`）。这是唯一的结构性守卫。每个实体都通过 `o0`/`p0` 继承 `m2` **或** 通过 `q2`/`s2` 继承 `r2`，故最小集合为 Search `v3`（仅排序）与 Library root `g1`（仅视图 + Home）。

---

## 3. 每组的具体实现

### 3.1 `library_layout` —— Home Category

按 `b3.В:[La3;]` 逐项生成 `FastButton`（style `0x7f0e03b8 SettingsListOptsCheckboxLibrary_Home`）+ `CheckBox`（style `0x7f0e03b9`）。

`a3` 结构（`a3.smali:6-27`）：`{В: 分类 id, B: 1<<id（构造时算出）, А: Supplier}`。

**20 个分类全表**（数组顺序 ≠ id；id 被刻意打乱以保持旧值稳定）：

| 数组序 | `a3.В` | 掩码 | 分类 | 说明行 `c()` |
| --- | --- | --- | --- | --- |
| 0 | 0 | 0x1 | All Songs | — |
| 1 | 1 | 0x2 | Folders | — |
| 2 | 2 | 0x4 | Folders Hierarchy | — |
| 3 | 3 | 0x8 | Albums | — |
| 4 | 4 | 0x10 | Artists | — |
| 5 | 5 | 0x20 | Album Artists | "Category based on Album Artist tag" |
| 6 | 6 | 0x40 | Albums by Artist | "Category with separate Album per each Artist/Album combination" |
| 7 | 7 | 0x80 | Genres | — |
| 8 | 17 | 0x20000 | Years | — |
| 9 | 8 | 0x100 | Composers | — |
| 10 | 9 | 0x200 | Playlists | — |
| 11 | 18 | 0x40000 | Streams | — |
| 12 | 10 | 0x400 | Queue | — |
| 13 | 19 | 0x80000 | Bookmarks | "Playlist with the playback position for songs…" |
| 14 | 11 | 0x800 | Most Played | — |
| 15 | 13 | 0x2000 | Top Rated | — |
| 16 | 15 | 0x8000 | Low Rated | — |
| 17 | 12 | 0x1000 | Recently Played | — |
| 18 | 14 | 0x4000 | Recently Added | — |
| 19 | 16 | 0x10000 | Long | — |

> `c()` 只有 3 个分类覆写，其余返回 0（`ListOptsActivity:342-350` 在 0 时跳过说明行）。它是**静态解释性字符串**，不是动态计数。

**偏好 `prefs/В;->H0` = `library_lists`**，默认 **`0xfffbf`**（`prefs/В.smali:1093-1101`）。逐位解析：19/20 位启用，**仅 bit 6 被清除** → 出厂默认不提供 **Albums by Artist**。这与它是 Albums 的派生重复定位吻合。【实证·smali + 推断】

**偏好 `prefs/В;->I0` = `library_home`**，默认 **`0`**（= All Songs，`prefs/В.smali:1103-1109`，默认值取自 `<clinit>` 中唯一一次赋值的 `v3=0x0`）。`-1` = 无首页分类（长按清除、旧版迁移写入）。UI 上 `I0 == a3.В` 时 alpha 1.0，否则 0.1。

### 3.2 `search_layout` —— 搜索分类

遍历 `v3.v1()[Lx3;]`，第 i 项对应偏好 `widget/player/g0;->Н` 的第 i 位（`1<<i`）。该偏好默认 **`-1`**（全 10 位开启，`g0.smali:35-41`），容器键 `"search"`。

10 项：Albums / Artists / Album Artists / Folders / Genres / Years / Composers / Playlists / All Songs / Streams（位 0x001…0x200）。

取消勾选某项 → `v3.u1(mask)` 过滤后**该媒体类型完全从本地搜索结果移除**（每类一条查询再 `MergeCursor`）。

### 3.3 `sort_group` —— 排序（最复杂的一组）

`m2.g():int[]` 是**三元组数组** `(labelRes, sortMode, hintRes)`，长度须能被 3 整除（`:528-532` 校验，否则整组跳过）：

- 每个三元组生成一个 `RadioButton`（style `0x7f0e044d ListOptsRadioButton`）
- `labelRes` → 文本；`sortMode` → `android:tag`
- 勾选条件：`(d() & 0x3FFFFFFF) == sortMode`（`:514-577`）
- `hintRes != 0` → 用 `y()` 在该项下方插一行小字（`:613-615`）
- 末尾追加公共 **"Reverse"** 复选框（`@string/reverse` 0x7f0807a5，`:637-679`）

**位编码**：`d()` 低 31 位 = 当前 sortMode；`0x40000000` = Descending（`p0.O(int)` 用 `p1 & 0x40000000` 取倒序位，`p1 &= ~0x40000000` 取模式号，再 `packed-switch 0x0..0xf` 选 ASC/DESC 变体）。排序 SQL 由 `p0.O(int)` 产出。

**Reverse 复选框的精确机制**（`ListOptsActivity:633-679` + `dialogs/m.smali`）：

- 位置：排序单选循环结束后追加到同一 `sort_group` 末尾
- 初始勾选：`(d() & 0x40000000) != 0`
- 监听器 `m` 以 **B=1** 构造（排序项用 B=0）；`m.onCheckedChanged` 的 `packed-switch` **只有 case 0**，故 B=1 落入 default 分支：`p1 = d() & ~0x40000000; if (checked) p1 |= 0x40000000; obj.J(p1)`
- 即 **Reverse 是同一个 sortMode 字上的一个高位**，不是独立偏好

**提前退出的两种情形**：`d() == -1`，或 `g() == h1.В`。**`h1.В` 是空数组**（`h1.smali:13-17`：`new-array v0, v0=0` → `sput-object`），故返回空数组 = "该分类没有可选排序项"。

#### 3.3.1 所有歌曲（`p0.g()`，16 项）

`p0.smali:1693-1755`，`const/16 v0, 0x30` = 48 个 int = 16 三元组。【实证·smali】【实证·实机：前 9 项与截图逐项一致】

| # | 标签 | sortMode | 提示 |
| --- | --- | --- | --- |
| 1 | By track # | 0 | — |
| 2 | By disc and track # | 0xd | — |
| 3 | By title | 0x1 | — |
| 4 | By filename | 0x2 | — |
| 5 | By path | 0xe | — |
| 6 | By artist | 0x8 | — |
| 7 | By album | 0x9 | — |
| 8 | By year | 0x3 | — |
| 9 | By year/album | 0xf | — |
| 10 | By date added to Library | 0xc | — |
| 11 | By date added/modified | 0x4 | **Filesystem date/time** |
| 12 | By rating | 0x5 | — |
| 13 | By duration | 0xa | — |
| 14 | By time last played | 0x7 | **Play time is not updated while playing by this sort** |
| 15 | By play count | 0x6 | **Play count is not updated while playing by this sort** |
| 16 | By shuffle order | 0xb | **Matches actual shuffle order** |

> 实机截图中第 3 项 "根据标题" 被选中，与 `sort_mode` 默认值/当前值一致。

#### 3.3.2 文件夹（`u0.g()`，6 项）

`u0.smali:517-548`，`const/16 v0, 0x12` = 18 个 int = 6 三元组。【实证·smali】【实证·实机：与截图 6 项一致】

| # | 标签 | sortMode | 提示 |
| --- | --- | --- | --- |
| 1 | By name | 0 | — |
| 2 | By path (case sensitive) | 1 | — |
| 3 | By path | 5 | — |
| 4 | By date added to Library | 2 | — |
| 5 | By date added/modified | 3 | **Filesystem date/time** |
| 6 | By number of tracks | 4 | — |

>`sortMode 4` → SQL `folders.num_files` / `folders.num_all_files`（`u0.Z0`，`:352-365`，受偏好选择）。完整映射（`u0.Z0(I)`，`:286-380`）：

| sortMode | SQL 表达式 |
| --- | --- |
| 0 | `folders.name COLLATE NOCASE` |
| 1 | `path`（原样，区分大小写） |
| 2 | `folders.created_at` |
| 3 | `folders.dir_modified_at` |
| 4 | `folders.num_files` / `folders.num_all_files` |
| 5 | `path COLLATE NOCASE` |

> 标签与 SQL 完全吻合：mode 1/5 分别对应"区分大小写"与不区分的 `path`，mode 4 是**文件数**而非音轨号。

> **⚠ 简体中文翻译缺陷**：截图第 6 项显示"根据音轨号"，但英文原文是 **"By number of tracks"（按歌曲数量）**。`values-zh-rCN/strings.xml` 把 `by_num_tracks` 误译为"根据音轨号"，与 `by_track`（By track #）译文完全重复。繁体 `values-zh-rTW` 正确区分为 `依歌曲數量` / `依曲目 #`。**这是 Poweramp 简中本地化缺陷，不是语义推导错误。**【实证·原文】

#### 3.3.2.1 「按歌曲数量」的完整证据链（二次核验）

本条曾引起质疑（"按数量会不会是逆向误读"），故做完整闭环核验：

| 环节 | 证据 | 结论 |
| --- | --- | --- |
| ① 三元组原始数据 | `u0.g()` `:529-548`，第 6 组 = `0x7f0800d1` / `4` / `0` | label=`by_num_tracks`, tag=**4** |
| ② label 解析 | `public.xml` → `by_num_tracks`；`values/strings.xml:175` = **"By number of tracks"** | 英文原文即"曲目数量" |
| ③ radio 绑定 | `ListOptsActivity:591-595` 把 `[i*3+1]` 放进 `setTag()` | 点选该行 → tag=4 |
| ④ 写回 | `dialogs/m.smali:82-100`：`(tag & 0x3FFFFFFF) \| (old & 0x40000000)` → `m2.J(I)` | 持久化 mode=4 |
| ⑤ 偏好读写一致 | `u0.J(I)` 写 `у.m`，`u0.d()` 读 `у.m`，键名 **`folders_sort`**（`у.smali:461`） | 同一键，读写闭合 |
| ⑥ SQL 分派 | `u0.O(int)` → `Z0(int)`；mode 4 分支 `:325-327` → `:352-365` 用 `folders.num_files` / `folders.num_all_files` | **按文件数量排序** |
| ⑦ 列语义实证 | `g1.smali:2158`：`UPDATE folders SET num_files=(SELECT COUNT(*) FROM folder_files WHERE folder_id=folders._id ...)` | `num_files` = 该文件夹下歌曲计数 |

⇒ **「按歌曲数量」是正确语义，"根据音轨号"是简中误译。技术上无歧义。**

#### 3.3.2.2 翻译碰撞的全库扫描（本轮新增）

对全部 `values-*` 做自动比对（`by_track` 与 `by_num_tracks` 译文是否相同）：

| 语言 | `by_track` | `by_num_tracks` | 判定 |
| --- | --- | --- | --- |
| `values`（英文） | By track # | By number of tracks | 正确 |
| `values-zh-rTW`（繁中） | 依曲目 # | 依歌曲數量 | 正确 |
| `values-de` | Nach Titelnummer | Nach Anzahl der Titel | 正确 |
| `values-ru` | По номеру трека | По кол-ву треков | 正确 |
| **`values-zh-rCN`（简中）** | 根据音轨号 | **根据音轨号** | **碰撞** |
| **`values-ja`（日文）** | トラック番号順 | **トラック番号順** | **碰撞** |

**只有简中与日文存在该碰撞**（2/40+ 语言），其余均正确区分。⇒ 属个别语言的翻译疏漏，非框架性设计缺陷。

#### 3.3.2.3 碰撞性质：跨菜单歧义，非同菜单重复

**重要区分**——经逐菜单核验，该碰撞**不在同一菜单内**：

| 菜单 | 是否含 `by_track` | 是否含 `by_num_tracks` | 同菜单内碰撞 |
| --- | --- | --- | --- |
| 所有歌曲 `p0` | ✓（第 1 项） | ✗ | 无 |
| 文件夹 `u0` | ✗ | ✓（第 6 项） | 无 |
| 播放列表 `j3` | ✗ | ✓（第 4 项） | 无 |
| 专辑 `l` | ✗ | ✓（第 5 项） | 无 |

**碰撞的实际形态**：

```
用户在「所有歌曲」看到「根据音轨号」→ 实际按 track_number 标签排
用户在「文件夹」  看到「根据音轨号」→ 实际按 曲目数量 排   ← 同一文案，不同行为
```

所以这不是"菜单里出现两个一样的选项"，而是**跨菜单的同一文案指向不同语义**——用户带着前一个菜单的理解去选后一个，行为不符预期。

#### 3.3.2.4 同类问题的全库排查（确认范围）

对**排序菜单实际会用到的 25 个 label**（见下表）逐一比对全部语言，确认无第二处影响排序的碰撞。

**排序菜单实际使用的 label 全集**（`0x7f08…` 共 25 个，含 4 个 hint）：

`by_album` `by_album_artist` `by_artist` `by_date_added_modified` `by_date_added_to_lib` `by_disc_and_track` `by_duration` `by_filename` `by_name` `by_num_tracks` `by_path` `by_path_cs` `by_play_count` `by_played_at` `by_rating` `by_shuffle` `by_title` `by_track` `by_url` `by_year` `by_year_album` ＋ hint：`fs_date_time` `matches_actual_shuffle_order` `play_count_not_updated` `play_time_not_updated`

**全语言 `by_*` 重复译文扫描结果（仅 3 处）**：

| 语言 | 碰撞译文 | 涉及键 | 是否影响排序菜单 |
| --- | --- | --- | --- |
| `values-zh-rCN` | 「根据音轨号」 | `by_track` / `by_num_tracks` | **是**（§3.3.2.3） |
| `values-ja` | 「トラック番号順」 | `by_track` / `by_num_tracks` | **是**（同上） |
| `values-tr` | 「Şanatçıya/albüme/parçaya göre」 | `by_album_track` / `by_artist_album_track` | **否** |

土耳其语那对的 `by_album_track`（By album/track#）与 `by_artist_album_track`（By artist/album/track #）**不出现在任何分类的 `g()` 排序数组中**（实测 25 个 label 里没有它们），故不影响排序菜单——但若将来某个分类启用它们，土语会立刻出现同类问题。

> **结论**：影响排序菜单的翻译碰撞共 **2 处**（简中、日文），均为 `by_track` ↔ `by_num_tracks`；另有 1 处潜在（土语）目前不生效。

#### 3.3.3 播放列表（`j3.g()`，4 项）

`j3.smali:1328-1353`，`const/16 v0, 0xc` = 12 个 int = 4 三元组。【实证·smali】【实证·实机：与截图 4 项一致】

| # | 标签 | sortMode | 提示 |
| --- | --- | --- | --- |
| 1 | By name | 0 | — |
| 2 | By date added to Library | 1 | — |
| 3 | By date added/modified | 3 | — |
| 4 | By number of tracks | 2 | — |

`j3.O(I)` 委托 `com/pixplicity/htmlcompat/у.В(I)`，其 switch 与标签一致：`0→playlists.playlist COLLATE NOCASE`、`1→playlists.created_at`、`2→playlists.num_files`、`3→playlists.mtime`。【实证·smali】

> 注意播放列表的 `sortMode 3` = `mtime`（date modified），与「所有歌曲」的 `3`=`by_year`、「文件夹」的 `3`=`dir_modified_at` **含义不同**——sortMode 是**每分类私有编号**，不可跨分类比较。

#### 3.3.4 其他分类

| 分类 | 项数 | 来源 |
| --- | --- | --- |
| Albums `l` | 5 | by_name/0, by_artist/3, by_year/1, by_date_added_to_lib/2, by_num_tracks/4 |
| 基类 `p0` | 16 | 见 §3.3.1（所有歌曲、流派、年份等继承） |
| Most Played `h3` | **0** | `g()` 返回 `null` → 只剩 Reverse 复选框（`d()` 正常，组可见） |
| `q3` / `r3` | **16** | ~~原记「继承 `o3.g()` = 空数组」**有误**~~：二者**未覆写 `g()`**，沿 `o3→o0→p0` 继承 **`p0.g()` 的 16 项**（2026-11-18 按传递闭包复算订正） |

### 3.4 `limit_group` —— Max Items

静态布局里 4 个 `RadioButton`，`android:tag` 就是数值字符串：`200` / `500` / `1000` / `2147483647`（=`@string/no_items_limit`）。`d2.с()` 返回当前值 → 按 tag 匹配勾选（`:708-726`）。

**语义是截断，不是过滤**：每个实现类在子查询尾部追加 `LIMIT N`，`2147483647` 时省略：

```
h3:196-209  ORDER BY folder_files.played_times DESC
q3:206-220  ORDER BY file_created_at DESC
r3:189-203  played_fully_at>? ORDER BY played_fully_at DESC
e3:97-111   rating=1
e4:121-135  rating>1 ORDER BY rating DESC
```

然后包成 `) AS folder_files LEFT JOIN folders …` 作为 FROM。

| 分类 | 偏好键 | 默认 |
| --- | --- | --- |
| Most Played | `most_played_files_limit` | 200 |
| Top Rated | `top_rated_files_limit` | 200 |
| Low Rated | `low_rated_files_limit` | 200 |
| Recently Added | `recently_added_files_limit` | 200 |
| Recently Played | `recently_played_files_limit` | 200 |

### 3.5 `duration_group` —— Min Duration

仅 `instance-of d3`（Long Tracks）。SeekBar `setMax(0x77)` = 119：

- 进度 `0..119` → `(progress+1) * 60000` ms → **1..120 分钟**
- 初始进度 = `max(1, stored/60000 - 1)`（`:802-820`）
- 时间显示走 `Utils.A(StringBuilder,int,boolean)`：`(+500)/1000` 后 `mm:ss`（<1h）或 `h:mm:ss`，秒补零。`120000ms → "2:00"`
- **只在 `onStopTrackingTouch` 提交**（`dialogs/r.smali:70-95`），拖动过程不写盘
- 持久化：`rest/library/у;->a1` = `long_files_min_duration`

**语义是过滤，不是截断**：`d3` 的 WHERE 追加 `folder_files.duration >= ?`（`d3:147-163`），直接绑定该偏好。

> 对照 §3.4：`limit_group` 截断行数，`duration_group` 过滤行集合。二者机制不同，勿混淆。

### 3.6 `list_memory_layout` —— 列表记忆

仅 `h0.k0() instanceof e2` 且 `x2.P(uri) != 0`。两个 CheckBox：

- `list_pos` (0x7f0d04d9) → 列 `keep_list_pos`
- `per_track_progress` (0x7f0d04da) → 列 `keep_track_pos`

**列落在真实表上**（`j3` → `playlists`，`u0` → `folders`），`e2.D()` 把它们编码成一个 SQL 表达式列：

```sql
-- j3.smali:253-259
"(playlists.keep_track_pos<<1) + playlists.keep_list_pos"
-- u0.smali:72-78
"(folders.keep_track_pos<<1) + folders.keep_list_pos"
```

读取：`i0(db, uri)` → `SELECT keep_list_pos, keep_track_pos FROM <table> WHERE _id=?`（`j3:1519`、`u0:593`），返回 `j2(playedEntryId, sort, keepListPos, keepTrackPos)`。

写入：`dialogs/l.smali` 用 `ContentValues` + `cmd_data_set_list_meta`（`0x7f0d0360`）→ `e2.b0()` → `db.update(<table>, cv, where, null)`（`A.smali:193-203`）。三个门控：ctor 分支、`isPressed()`（防程序回填写库）、静态 tag。

**为什么只有播放列表和文件夹有**：它们拥有跨会话持久的身份行（`folders._id` / `playlists._id`），位置有地方可存。临时视图（所有歌曲、专辑、艺术家、最多播放…）没有这样的行，故不实现 `e2`，该组隐藏。

**与设置页的显式互引**（Poweramp 自己的文案，`library.xml` 内 `RawTextPreference`）：

> "Individual playlists and folders can be set to keep each track progress via their header menu / **List Options**"

对应 `pref_restore_pos` = "Store/Restore Per Track Progress"、`pref_restore_pos_min_dur` = "Track Duration For Per Track Progress and -10/+10s Buttons"（默认 45 秒）、`pref_played_dur` = "Count As Played"（默认 50%）。【实证·原文】

> **⚠ 疑似回填映射缺陷【实证·smali + 推断】**：`j2(J I Z Z)` 构造为 `p4 → А`（西里尔 A）、`p5 → A`（拉丁 A）。`j3.i0` 中 `v10 = keep_list_pos`、`v11 = keep_track_pos`，故 `j2.А` = `keep_list_pos`、`j2.A` = `keep_track_pos`。而回填代码 `data/api/х.smali:1320-1330` 把 `j2.А`(keep_list_pos) 赋给 `v9`(= `per_track_progress`)，把 `j2.A`(keep_track_pos) 赋给 `v8`(= `list_pos`)——**两个复选框的初始勾选状态交叉**。写入路径（`l.smali`）正确。静态代码层面确定，未做真机 UI 验证。

### 3.7 `layout_group` —— 布局

章节标题 `@string/layout` = **"Layout"**（0x7f0802a0，`dialog_content_list_opts.xml:34-38`）。两个子项，**任一命中**才显示该组（`v2>0` → `:1284/:1294/:1296`）：

| 子项 | id / 文案 | 偏好 | 判定 |
| --- | --- | --- | --- |
| `compact_header` | 0x7f0d069a / "Compact header" (0x7f080159) | `у;->j` = `layout_header_compact` | `х.W0()` 读 `(у.j & (1<<C()))` |
| `show_titles_only` | 0x7f0d069b / "Show titles only" (0x7f08082b) | `у;->i` = `layout_1_line` | `(у.i & (1<<х.C())) != 0` |

**两者由不同接口独立门控**：`compact_header` 需 `instance-of q2`（`:1127`），`show_titles_only` 需 `instance-of s2`（`:1243`）。因此**文件夹只显示 `compact_header`**（`u0` 实现 `q2` 但不实现 `s2`），该组仍因 `v2>0` 而可见——这正是实机截图中"布局"章节下只见一个复选框的原因。

**两个禁用条件（均为无障碍适配，非缺陷）**：

1. `show_titles_only` 置灰：`!q2.X(r2.r0())`。`х.X(I)`（`х.smali:1014-1041`）**仅对 -2 / -3 / -4** 返回 true（显式三次 `if-eq` 比较，**不含 -1**）——这三个视图模式均为单行变体，再开"只显示标题"无意义。切换视图模式后重新求值。

> 精确常量：`-0x3`(-3)、`-0x2`(-2)、`-0x4`(-4) 三个分支 → true；其余（含 -1、0、1…5）→ false。
2. `compact_header` 置灰 + 插入 `not_avail_for_your_font_scale`：`x0.u == false`。`x0.u` 计算（`x0.smali:487-511`）：

```
v5 = attr maxFontScaleForCompact，默认 1.3
v6 = scaledDensity / density          ← 当前字体缩放系数
u  = (v6 <= v5)
```

即**用户字体放大超过阈值时紧凑页头会被裁切，故隐藏该选项**。

### 3.8 `zoom_group` —— 查看方式

`r2.х():int[]` 同样是三元组 `(labelRes, zoomValue, hintRes)`，第 3 位在全库 4 个实现中**恒为 0**（无逐项提示）。左对齐 50% 宽 style `ListOptsRadioButton50` (0x7f0e0562，`layout_widthPercent=50%`)，对比排序项用全宽 `ListOptsRadioButton` (0x7f0e044d)。当前值 `r2.r0()`，写回 `r2.F(I)`。

章节标题 `@string/view_as` = **"View As"**（0x7f0808d8），其下提示 `@string/h_pinch_to_zoom` = **"Pinch-to-zoom &lt;img src=zoom_arrows_12dp&gt; for zooming"**（0x7f08023c，带 `info_16dp` 前置图标 → 实机的 ⓘ）。

**只在 4 个类覆写 `х()`**，其余约 30 个分类继承基类（例如 `j3` 播放列表**不覆写**，用基类 10 档）：

| 实现 | 项数 | 内容 |
| --- | --- | --- |
| `х` 基类 | 10 | 完整刻度（见下） |
| `g1` 库根 | 4 | grid_small(-1), grid(0), list_compact(2), list(1) |
| `v3` 搜索 | 6 | 全部列表型，无网格 |
| `f3` 歌词 | 3 | **Small Font / Default / Large Font**（字号，非视图） |

基类 10 档（`х.smali:1322-1365`，`const/16 v0, 0x1e` = 30 ints）按 zoomValue 形成连续刻度：

| zoom | 标签 | 简中 | 形态 |
| --- | --- | --- | --- |
| -4 | Grid - 1 line small | 网格 - 紧凑一行 | 单行网格、无封面、超小 |
| -3 | 1 line extra small | 紧凑单行 | 单行、无封面、超小 |
| -2 | 1 line | 单行 | 单行、无封面 |
| -1 | List - no images | 列表 - 不显示图像 | 双行、无封面 |
| 0 | List - compact | 列表 - 极小 | 紧凑双行 + 小封面 |
| 1 | Grid - extra small | 网格 - 极小 | 网格超小 |
| 2 | Grid - small | 网格 - 小 | 网格小 |
| 3 | List - small | 列表 - 小 | 小列表 |
| 4 | List | 列表 | 标准列表 |
| 5 | Grid | 网格 | 标准网格 |

> 负值全部是"无封面"模式——这也解释了为何 `hintRes` 全为 0：这些模式自带语义。
> **实机对照**：播放列表截图中"查看方式"头两格正是 **-4（网格 - 紧凑一行）** 与 **-3（紧凑单行）**，与基类数组前两项顺序一致。

`f3` 这组说明 **"查看方式"不是固定视图选择器，而是各分类自行定义的视觉参数**（歌词页复用它做字号）。

**zoom → scene 完整映射**（`list/Р.smali:800-1080` 的 `packed-switch -0x4`，10 档全解）：

| zoom | titles_only=false | titles_only=true |
| --- | --- | --- |
| -4 | `scene_1_small_no_aa` | 同（无条件） |
| -3 | `scene_1_small_no_aa` | 同 |
| -2 | `scene_1_small_no_aa` | 同 |
| -1 | `scene_small_no_aa`(0x7f0d069e) | `scene_1_small_no_aa`(0x7f0d069f) |
| 0 | `scene_small` | `scene_1_small`(0x7f0d04a8) |
| 1/2 | `scene_grid` | `scene_grid_1`(0x7f0d0296) |
| 3 | `0`（继承默认） | `scene_1`(0x7f0d0291) |
| 4 | `scene_zoomed`(0x7f0d013b) | `scene_1_zoomed`(0x7f0d0292) |
| 5 | `scene_grid_zoomed` | `scene_grid_1_zoomed` |

即 **`_1` 后缀 = 单行变体**，由 titles_only 开关决定。

---

## 4. 持久化：三套独立存储，布局期合流

| 旋钮 | 存储 | 粒度 |
| --- | --- | --- |
| 排序 | `sort_mode_<category>` 整型 + `0x40000000` 倒序位 | 每分类一键 |
| 查看方式 | `list_zoom_<category>` 整型（40+ 个键） | 每分类一键 |
| 精简标题 | `у.i` = `layout_1_line` **位掩码** | 每分类 1 bit |
| 紧凑页头 | `у.j` = `layout_header_compact` **位掩码** | 每分类 1 bit |
| 列表记忆 | `playlists` / `folders` 表的 `keep_list_pos` / `keep_track_pos` | 每个列表行 |

### 4.0 `sortMode` 与 `zoomValue` 都是「每分类私有编号」

**同一个数字在不同分类下含义不同**，不可跨分类比较：

| 值 | 所有歌曲（`p0`） | 文件夹（`u0`） | 播放列表（`j3`） |
| --- | --- | --- | --- |
| 1 | By title | By path (case sensitive) | By date added to Library |
| 2 | By filename | By date added to Library | By number of tracks |
| 3 | By year | By date added/modified | By date added/modified |
| 4 | By date added/modified | By number of tracks | — |

⇒ 每分类的 `g()` 三元组就是该分类自己的编号表；`O(int)` 的 `packed-switch` 也是每分类一份。这是"选项数据由实体提供"设计的直接结果（见 §8.1 A2）。

### 4.1 `C()` 位索引方案

`1 << х.C()`，一个 int 容纳 32 个分类，避免每分类一个布尔键：

| `C()` | 分类 |
| --- | --- |
| 1 | `g1` 库根 |
| 2 | 专辑/艺术家/流派/年份专辑族（`l`→`j`, `i`, `С`…） |
| 5 | `p0` 基类、`o0`、`a0` 书签、`m3` 队列 |
| 6 | `u0` 文件夹 |
| 7 | `x0` / `y0` 文件夹层级 |
| 8 | `t` 艺术家、`О` 专辑艺术家 |
| 9 | `z0` 流派 |
| 0xb | `j3` 播放列表 |
| 0xc | `v3` 搜索 |
| 0xd | `h4` 年份 |
| 0xe | `f3` 歌词 |

> **已知位冲突**：`a0` 与 `m3` 同为 5、`x0` 与 `y0` 同为 7、`t` 与 `О` 同为 8。可能是有意同族共享，也可能是疏漏；无对照表可判定。【推断】

### 4.2 三者的合流关系

三个存储独立，但在布局期互相作用（`list/Р.smali:733-1080`）：

```
zoom 值 → 基础 scene（如 5→grid_zoomed, 4→zoomed, 2/1→grid）
titles_only = true → 换成对应 _1 变体（grid → grid_1）
compact_header → 只改页头行高（D0() 返回 x0.z / x0.q）
```

`D0(x0)I` 返回**行布局样式索引**：`Р.smali:379-393` 把 `D0(x0) + x0.j` 写入 `widget/list/х->y`（item-type 选择器）。它与菜单布局选择（`n()`）**无关**。

### 4.3 与导出模块一致

`folders` 与 `playlists` 都带 `keep_list_pos` / `keep_track_pos`（`preference/exportimport/х.smali:714-716`、`:1044-1046`，均为 `INTEGER NOT NULL`），导出类目 `listMemory` = 第 13 类。`scanner/y.smali:71` 在新建播放列表时初始化这两个值。

> 交叉印证：`poweramp-library-three-views.md:126` 已记录 `folders` 含这两列，但未说明 `playlists` 同样带这一对。

---

## 5. 齿轮按钮：跳转到哪个设置页

### 5.1 声明

```xml
<!-- res/layout/dialog_content_list_opts.xml:4 -->
<BusActionButton android:id="@id/button"
                 android:drawable="@drawable/settings_24dp"
                 android:contentDescription="@string/settings"
                 w:busId="@id/bus_app_cmd"
                 w:msgId="@id/cmd_app_open_settings"
                 w:string="library"
                 style="?DialogSettingsGearIcon" />
```

| 资源 | id |
| --- | --- |
| `@id/button` | 0x7f0d0265 |
| `bus_app_cmd` | 0x7f0d015c |
| `cmd_app_open_settings` | 0x7f0d003e |
| `@string/settings` | 0x7f08081f |
| `@string/library` | 0x7f0802ad |

**`@id/button` 与"关闭"按钮 `button1` (0x7f0d0234) 是两个不同 id，不冲突。** "关闭"来自通用 `merge_dialog_buttons.xml:11`（style `?DialogPositiveButtonStyle`），`ListOptsActivity:1317-1331` 设置其文本为 `@string/close` 并绑定点击关闭。

> 同族证据：`item_empty_list_with_config.xml:5` 的齿轮用 `w:string="folders_library/music_folders_button"`——说明 `w:string` 是**设置页路径**，支持 `/` 子路径。

### 5.2 从齿轮到设置页的完整链路

`BusActionButton` 只是 `BusActionBehavior` 的外壳，`w:*` 属性在 behavior 构造时一次 `obtainStyledAttributes` 读出（索引序：`busId`/`msgId`/`longPressMsgId`/`arg1`/`arg2`/`string`）。`android:id` **不被 behavior 读取**，只作为 Activity 侧 `findViewById` 的视图 id。点击最终调用：

```java
MsgBus.В(sender=this, msgId, arg1, arg2, obj /* = w:string */)
```

`arg1`/`arg2` 缺省为 **0**（本例未声明 `arg1`）。`MsgBus.В` 同步派发给订阅者。

**真正的处理器是 `BaseApplication.onBusMsg`（`app/base/BaseApplication.smali:1196-1224`）**——它是全库唯一 `switch` 该 msgId 的地方，其余 11 处 `0x7f0d003e` 引用全部是**发送方**：

```java
const v0, 0x7f0d003e                       // cmd_app_open_settings
if-ne p2, v0, :cond_5
В.К(ctx, ".preference.SettingsActivity", arg1, arg2, obj, null, null)
```

`В.К` → `В.y`（`:1102-1232`）构造 Intent：`putExtra("obj", "library")`（`:1123-1131`），组件为 `SettingsActivity`，`arg1` 为 0 故不写该 extra。

`SettingsActivity.getExtraOpenPath()`（`:500-525`）读出 `"obj"` → 路径按 `/` 切分取首段 = `"library"`（`:1069-1146`），随后（`:1241-1339`）：

```java
Bundle b = new Bundle(); b.putAll(intent.getExtras());
b.putString("target", "library"); b.putString("hash", null);
// ":android:show_fragment" = preference.f0, ":android:show_fragment_args" = b
```

`preference/f0.onCreate`（`:75-135`）取 `target` → `getIdentifier("library", "xml", pkg)` = **0x7f160015**，再按 id 选分片（`:680-690`）：

| xml id | 分片类 | 设置屏 |
| --- | --- | --- |
| `0x7f160015` | **`g2`** | `library.xml`（Library） |
| `0x7f160016` | **`k0`** | `library_lists.xml`（Lists） |

> 这解释了为何 `library_lists` 屏的 `library_list_opts` 点击监听绑在 `k0.smali:2871`——`k0` 正是该屏的分片实现。

**完整链路**：齿轮 → `MsgBus(bus_app_cmd, cmd_app_open_settings, obj="library")` → `BaseApplication` 路由 → `SettingsActivity` → 分片 `f0` → `res/xml/library.xml`（Library）→ 分片 `g2`。

### 5.3 目标页面：Library 设置根页

`xml/library.xml`（id `0x7f160015`），`PreferenceScreen` 标题 `@string/pref_library` = **"Library"**。

点齿轮后用户**第一眼**看到的层级：

| 分组 | 条目 | key | 行 |
| --- | --- | --- | --- |
| — | Rescan | `rescan_folders` | :4 |
| — | Full Rescan | `erase_and_rescan` | :6 |
| — | Select Folders | `music_folders_button` | :7 |
| — | SAF 文件夹提示 | `some_saf_folders_unavailable` | :8 |
| — | File Access Legacy Mode | `file_access_legacy` | :9 |
| — | legacy 警告 | `_legacy_access_warning` | :10 |
| — | Ignore Short Tracks | `scan_min_track_duration`（默认 6s） | :11 |
| — | Ignore Video Tracks | `skip_video` | :12 |
| — | Auto-Find Music Folders | `auto_find_button` | :13 |
| **Advanced** | Store/Restore Per Track Progress | `restore_pos`（默认 true） | :15 |
| | Long Skip / Rewind | `long_skip_rewind` | :16 |
| | Track Duration For Per Track Progress… | `restore_pos_min_dur`（默认 45s，max 60） | :17 |
| | Count As Played | `played_dur`（默认 50%，max 100） | :18 |
| | *(提示)* | "Individual playlists and folders can be set to keep each track progress via their header menu / **List Options**" | :19 |
| | **Lists** | `library_lists` → `library_lists` | **:20** |
| | Search | `library_search` → `library_search` | :21 |
| | Queue | `library_queue` → `library_queue` | :22 |
| | Playlists | `library_playlists` → `library_playlists` | :23 |
| | Shuffle | `library_shuffle` → `library_shuffle` | :24 |
| | Scanner | `library_scanner` → `library_scanner` | :25 |
| — | Reset stats | `reset_stats` | :27 |
| — | Restore Defaults | `restore_defaults` | :28 |

### 5.4 与列表选项最相关的设置页：`library_lists`

`xml/library_lists.xml`（id `0x7f160016`，分片 **`k0`**），标题 `@string/pref_lists` = **"Lists"**（面包屑 `pref_library`）。**第一项就是列表选项**（`:5`）：

| 分组 | 条目 | key | 行 / 备注 |
| --- | --- | --- | --- |
| **Look and Feel** | **Library List Options** | `library_list_opts` | :5；summary = "Select top visible Library categories. **Also available from Library header menu**" |
| | Static Navbar | `static_navbar` | :6；"Don't move Navbar away in lists"（默认 false） |
| | Seekbar in Navbar | `navbar_seekbar` | :7 |
| | Headers With Meta | `headers_meta` | :8（默认 true） |
| | A-Z Scroll | `az_scroll` | :9（默认 true） |
| | Localized A-Z Scroll | `localized_az` | :10（依赖 az_scroll） |
| | Header Buttons | `list_header_buttons` | :11 |
| | Bottom Buttons | `list_bottom_toolbar` | :12 |
| | Show Track Number | `track_num_type` | :13（默认 0） |
| | Show Disc | `track_disc_meta` | :14（依赖 track_num_type） |
| | Filename As Title | `title_filename` | :15 |
| | Click Restarts Track | `list_action_resets` | :16 |
| | List Item Action | `list_item_action` | :17（默认 1） |
| | Delete Action | `enable_deletion` | :18（默认 true） |
| **Albums** | Join Albums / Album Artist Label for Tracks / Album Artist for Albums / Album Artist for Album Artists / Hide Unknown Album / Hide Unknown Artist | `join_albums` `use_albumartist` `use_albumartist_albums` `use_albumartist_albumartists` `hide_unknown_album` `hide_unknown_artist` | :21-26 |
| **Advanced** | Show Unsplit Combined Categories / No "Play All Categories" For Hier Folders / Folders Hierarchy Immediate Root / Hierarchy Files Zoom Level / "Don't Ignore Articles For Sort" / Show CUE Disc Image Files / Stream Name In Title | `show_unsplit_cats` `hier_no_advance` `root_hier_immediate` `hier_files_zoom` `no_sort_field` `show_cue_source` `stream_name_in_title` | :29-35 |
| — | Restore Defaults | `restore_defaults` | :37 |

`library_list_opts` 这个 key 正是 `preference/k0.smali:2868-2883` 绑定的点击入口（`k0` 即该屏分片）——**打开的是同一个 `ListOptsActivity`，但 URI 是库根 `g1.B`，且 `arg1=1`**。

### 5.5 两个设置侧入口（同 Activity，不同 URI）

| 设置页 | 绑定位置 | 打开对象 | arg1 |
| --- | --- | --- | --- |
| Search 屏（`library_search.xml:5`） | `k0.smali:2629` → `p2.smali:73-77` | `g1.getSearch().B0()` | **1** |
| Lists 屏（`library_lists.xml:5`） | `k0.smali:2871` → `h2.smali:65-69` | `g1.B`（库根） | **1** |

菜单路径传 `arg1=0`，设置路径传 `1`。`arg1==1` 时 `ListOptsActivity:1351-1371` 把 `@id/button`（齿轮）设为 **INVISIBLE（4）**——保留布局占位，**避免"设置里再开设置"的递归导航**。

### 5.6 重要否定事实：多数列表选项没有设置页入口

经全仓交叉检索，以下键**只存在于 per-list 偏好或 ContentValues，没有对应的设置 XML**：

| 键 | 实际归属 |
| --- | --- |
| `keep_list_pos` / `keep_track_pos` | `playlists` / `folders` 表列，由弹窗自身写入（`dialogs/l.smali`） |
| `layout_1_line` / `layout_header_compact` | `rest/library/у.smali:423,431`（位掩码） |
| `most_played_files_limit` 等 5 个上限 | `у.smali:719-757` |
| `long_files_min_duration` | `у.smali:1095` |
| `sort_mode_*` / `list_zoom_*`（40+ 键） | 仅 `list_zoom_lyrics` 出现在 `ui_lyrics.xml:14`，其余无设置页 |

⇒ **列表选项弹窗本身就是这些偏好的唯一 GUI**。设置侧的 `Lists` / `Search` 两屏只承载"分类集合"类选项（`library_list_opts`、`list_opts`），不承载排序/视图/记忆。

### 5.7 其余 library 设置屏（相关但非列表选项本身）

| 屏幕 | 标题 | 相关键 |
| --- | --- | --- |
| `library_queue.xml` | Queue | `queue_start`, `queue_end`, `queue_insert_pos`, `play_next_insert_pos`, `queue_clear_on_add`, `queue_never_clear_on_add`, `queue_no_shuffle` |
| `library_search.xml` | Search | **`list_opts`**（Search Categories）, `search_play_tracks`, `search_track_titles_only` |
| `library_playlists.xml` | Playlists | `playlists_import/export`, `playlist_insert_pos`, `pl_del_entry_w_track`, `pl_auto_resolve`, `pl_no_dups` |
| `library_shuffle.xml` | Shuffle | `shuffle_random_factor`, `no_reshuffle`, `no_reshuffle_for_large_lists`, `category_shuffle`, `hier_flat_shf` |
| `library_scanner.xml` | Scanner | 扫描器选项 |

---

## 6. 分类 × 分组能力矩阵

`instance-of` 探测基于 `v8 = g1.у(uri)`。下表按"实体实现了哪些接口"推出其显示的组：

| 分类（实体类） | m2 | d2 | d3 | r2 | q2 | s2 | e2 | 显示的分组 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Queue `m3` | ✓ | – | – | ✓ | ✓ | – | – | 排序 + 查看 + 布局 |
| Bookmarks `a0` | ✓ | – | – | ✓ | ✓ | – | – | 排序 + 查看 + 布局 |
| Streams `d4` | ✓ | – | – | ✓ | ✓ | – | – | 排序 + 查看 + 布局 |
| All Songs `n0` | ✓ | – | – | ✓ | ✓ | – | – | 排序 + 查看 + 布局 |
| Folders `u0` / hier `x0` | ✓ | – | – | ✓ | ✓ | – | ✓ | + 列表记忆 |
| Albums `j` / byArtist `m` | ✓ | – | – | ✓ | ✓ | – | – | 排序 + 查看 + 布局 |
| Artist files `n`/`q` | ✓ | – | – | ✓ | ✓ | ✓ | – | 排序 + 查看 + 布局 |
| Artists `t` / AlbumArtists `О` / Composers `d0` | ✓ | – | – | ✓ | – | – | – | **排序 + 查看** |
| Genres `z0` / Years `h4` | ✓ | – | – | ✓ | – | – | – | **排序 + 查看** |
| Most Played `h3` / Recently Added `q3` / Played `r3` / Top & Low Rated | ✓ | ✓ | – | ✓ | ✓ | – | – | **+ 上限** |
| Long Tracks `d3` | ✓ | – | ✓ | – | – | – | – | **仅 排序 + 时长** |
| Playlists `j3` | ✓ | – | – | ✓ | – | – | ✓ | 排序 + 查看 + 记忆 |
| Search `v3` | ✓ | – | – | – | – | – | – | **仅 排序** |
| Library root `g1` | – | – | – | ✓ | – | – | – | **仅 Home + 查看** |

> **⚠️ 2026-11-18 复核补充（§6 矩阵口径）**：`d()` 返回 `-1` 时整组隐藏，涉及
> `m3`/`a0`/`v3`/`x0`/`k3`/`p3`/`b0`/`l3`/`n3`/`f3` 共 10 个实体。本表按 `g()` 归类，
> 与按 `d()` 的实际表现不同。详见 `poweramp-list-options-implementation.md` §1.1b。
>
> **无分类会隐藏全部 8 组**。最小集合是 Search（仅排序）与 Library root（Home + 查看）。
>
> **⚠️ 本表未收录「专辑歌曲」类**：`rest/library/q`（以及复用它的 `artist/composer/genre/year_album_songs`）
> 是**继承**而非直连——`q` 自身不实现任何能力接口，4 个组全部来自祖先
> `q → r0 → s0 → o0 → p0`，按本表的直连口径会被漏掉。
> 该类的逐条结论见 `poweramp-album-songs-list-options.md`。

---

## 7. 实机交叉验证结论

用户提供三张真实设备截图（简体中文 UI），与 smali 推导逐项对照：

| 分类 | 截图可见项 | smali 推导 | 结论 |
| --- | --- | --- | --- |
| 所有歌曲 | 排序 16 项中的前 9 项（音轨号→年份/专辑），第 3 项选中 | 16 项，sortMode 0/0xd/0x1/0x2/0xe/0x8/0x9/0x3/0xf… | **一致** |
| 文件夹 | 6 项排序 + 倒序 + "布局"章节头 | 6 三元组 + reverse + `layout_group` | **一致**（第 6 项为简中误译） |
| 文件夹 | 第 5 项下有 "文件系统日期/时间" 小字 | 第 5 项 `hintRes` = `fs_date_time` | **一致** |
| 播放列表 | 4 项排序 + 倒序 + "查看方式"章节 + "双指缩放以缩放" + 双列网格 | 4 三元组 + reverse + `zoom_group`（`ListOptsRadioButton50` 50% 宽） | **一致** |
| 三个弹窗 | 标题 "列表选项: <分类名>" | `@string/list_opts_s` = "List Options: %s" 格式化 | **一致** |
| 三个弹窗 | 右上齿轮 + 底部"关闭" | `@id/button` 齿轮 + `merge_dialog_buttons` 的 `button1` | **一致** |

**唯一差异**是简体中文 `by_num_tracks` 误译为"根据音轨号"（见 §3.3.2），属本地化缺陷，非语义错误。

### 7.1 简体中文翻译缺陷详录

| 键 | 英文原文 | 简中（`values-zh-rCN`） | 繁中（`values-zh-rTW`） | 判定 |
| --- | --- | --- | --- | --- |
| `by_track` | By track # | 根据音轨号 | 依曲目 # | 正确 |
| `by_num_tracks` | **By number of tracks** | **根据音轨号** ← 与上一行重复 | **依歌曲數量** | **误译** |
| `by_disc_and_track` | By disc and track # | 根据碟片和音轨号 | — | 正确 |
| `by_title` | By title | 根据标题 | 依標題 | 正确 |

**后果**：文件夹弹窗（§3.3.2）第 6 项与"所有歌曲"弹窗第 1 项在简中下**显示完全相同**，用户无法区分「按歌曲数量」与「按音轨号」，而二者语义（`COUNT` vs `track_number`）完全不同。

**复现**：`Select-String res/values-zh-rCN/strings.xml -Pattern 'name="by_(num_tracks|track)"'`

### 7.2 交叉验证的局限

| 项 | 说明 |
| --- | --- |
| 截图仅覆盖 3 个分类 | 其余 27+ 分类的弹窗未实机验证，仅 smali 推导 |
| 截图滚动位置受限 | "所有歌曲"只显示前 9 项，后 7 项靠 smali |
| 设备上实际持久化值未知 | 需读运行时偏好，非静态产物可得 |
| 简中无法区分末项 | 恰好是上述翻译缺陷所致，smali 为准 |

---

## 8. 可借鉴 / 不建议照抄

### 8.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **一份弹窗 + `instance-of` 能力探测** | 8 个分组一套代码服务 30+ 分类，无需为每分类写表单 |
| A2 | **选项数据由实体提供**（`g()` / `х()` 三元组） | 排序项和视图模式属于分类自身知识，弹窗只做渲染 |
| A3 | **三元组数组 (label, value, hint)** | 值与文案分离，可直接映射为 radio 的 tag |
| A4 | **位掩码 `1<<C()` 做每分类布尔** | 一个 int 存 32 个分类，避免键爆炸 |
| A5 | **空数组表示"无选项"**（`h1.В`） | 比 null 或特殊标志更简洁，配合 `d()==-1` 双重守卫 |
| A6 | **`P.n()` 声明式选择菜单布局** | 页面类返回 `{layout, scene}` 二元组，无需塞条件分支 |
| A7 | **设置深链 `w:string` 支持 `/` 子路径** | 同一套齿轮可指向任意设置页，无需硬编码 Activity |
| A8 | **`arg1=1` 时隐藏齿轮** | 避免设置内再开设置的递归导航 |
| A9 | **截断与过滤用不同分组** | `limit_group`（LIMIT）与 `duration_group`（WHERE）职责清晰 |
| A10 | **字体缩放超限时禁用紧凑页头并给出原因** | 无障碍友好的显式降级，而非静默裁切 |

### 8.2 不建议照抄

| # | 做法 | 理由 |
| --- | --- | --- |
| N1 | **`list_memory` 回填两列交叉**（§3.6） | `j2.А`/`j2.A` 仅大小写不同（西里尔 vs 拉丁），实测赋值与列语义相反；应显式命名 `keepListPos`/`keepTrackPos` |
| N2 | **`C()` 位值冲突**（`a0`/`m3` 同 5 等） | 依赖隐式约定，新增分类易撞位；应有唯一分配表 |
| N3 | **`h1.В` 空数组当哨兵** | 与"返回空列表"语义重叠，需 `d()==-1` 二次判断才安全 |
| N4 | **`_lu` 场景命名不可读** | 同一菜单场景的两个排版变体，命名未表达意图 |
| N5 | **`scene_zoomed` 方向不可自证** | "zoomed" 指更大还是更小封面，只能靠样式层推断 |
| N6 | **`by_num_tracks` 在简中/日文误译** | 与 `by_track` 译文完全相同，导致跨菜单同一文案指向不同语义（§3.3.2.2–.4）。应为"按歌曲数量"独立命名 |
| N7 | **`d3`/`v3` 用 `final class` 探测而非接口** | 类型探测比接口能力声明脆弱，子类化或重构会静默失效 |
| N8 | **菜单项裁剪分散在 8 个 `d0` 覆写** | 无统一声明，需读遍所有页面类才能知道某分类可见哪些项 |

---

## 9. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | `_zoom` 后缀方向（更大或更小封面） | 由皮肤/样式层决定，smali 只见 id→id 映射 |
| Q2 | `C()` 位冲突是有意还是疏漏 | 无对照表，无法判定 |
| Q3 | `Р.f/g/h` 行高 int 对应的 attr 名 | 来自 `x0` styleable 索引，未逐一解码 |
| Q4 | `listPosHint` 存行号还是行 id | `j2.B` 命名 `listPosHint`、`j2.В` 命名 `listEntryId`，游标恢复路径未追到底 |
| Q5 | `_lu` 三字母展开 | 风格像 like/unlike 或 layout-upgraded，无命名证据 |
| Q6 | §3.6 回填交叉在真机是否可见 | 静态代码确定，UI 未验证（需真机开 playlist 仅勾 List Position 后重开弹窗） |
| Q7 | `library_lists` 默认清 bit 6 的意图 | 行为确定（排除 Albums by Artist），动机无注释 |
| Q8 | `arg1` 在弹窗内是否还有其他语义 | 只确认 `==1` 时齿轮设为 INVISIBLE（4） |
| Q9 | `BusActionBehavior` 的 `StateBus 0x7f0d03d2` 守卫语义 | 疑为双击闩锁，未验证 |
| Q10 | "布局"章节在实机是否完整可见或被裁切 | XML 序确定，裁切属绘制期事实 |
| Q11 | 设备上实际持久化的 `sort_mode` / `list_zoom` 值 | 需读运行时偏好，静态产物不可得 |
| Q12 | 所有歌曲实例究竟是 `n0` 还是 `s0` | 二者都 `i()`="files" 且都不覆写 `g()`，行为等价但无法从 Intent 分发定位 |

### 9.1 可进一步验证的路径（需真机）

| # | 待验 | 方法 |
| --- | --- | --- |
| V1 | §3.6 回填交叉是否可见 | 建 playlist → 仅勾 "List Position" → 关弹窗再开 → 观察哪个复选框被勾 |
| V2 | 简中误译的实际观感 | 切简中 → 文件夹弹窗 → 第 6 项与所有歌曲第 1 项并排对比 |
| V3 | 齿轮 `arg1=1` 隐藏 | 设置 › Lists › Library List Options → 观察右上角无齿轮 |
| V4 | `C()` 位冲突后果 | 同一设备上分别切"精简标题"于书签与队列，观察是否联动（若联动即确认撞位） |

---

## 10. Evidence ID 索引

### 10.1 关键产物位置

| 主题 | 来源 |
| --- | --- |
| 弹窗实现 | `.rea-analysis/smali/smali/com/maxmpz/audioplayer/dialogs/ListOptsActivity.smali`（1618 行） |
| 弹窗布局 | `.rea-analysis/decoded/res/layout/dialog_content_list_opts.xml` |
| 回填任务 | `dialogs/n.smali`（8245 B）、`dialogs/q.smali` |
| 监听器 | `dialogs/i.smali`（多路复用）、`g.smali`（Home/Search）、`j.smali`（长按）、`l.smali`（列表记忆）、`m.smali`（排序）、`r.smali`（时长） |
| 能力接口 | `rest/library/m2`（排序）、`d2`（上限）、`e2`（记忆）、`r2`（视图）、`q2`/`s2`（布局） |
| 排序三元组 | `p0:1693-1755`（16 项）、`u0:517-548`（6 项）、`j3:1328-1353`（4 项）、`l:526+`（专辑 5 项） |
| 视图三元组 | `х:1322-1365`（基类 10）、`g1:3165-3190`（4）、`v3:1376-1407`（6）、`f3:439-461`（3） |
| zoom→scene | `list/Р.smali:800-1080`（packed-switch -0x4，10 档） |
| 菜单布局 | `res/layout-sw2dp/merge_menu_items_{lib,tracks,playlists,aa}.xml` |
| 弹层容器 | `res/layout-sw2dp/merge_item_popup_menu.xml`、`merge_item_text_popup_menu.xml` |
| 设置屏 | `res/xml/library.xml`、`library_lists.xml`、`library_search.xml`、`library_queue.xml`、`library_playlists.xml`、`library_shuffle.xml` |
| 设置路由 | `preference/SettingsActivity.smali:500-525`（`getExtraOpenPath`）、`:1069-1146`（路径切分）、`:1241-1339`（Fragment args） |
| **设置路由分发器** | **`app/base/BaseApplication.smali:1196-1224`**（唯一 `switch` `0x7f0d003e` 处） |
| 设置分片 | `preference/f0.smali:75-135`（`target`→`getIdentifier`）、`:680-690`（xml id → 分片类） |
| 首页分类表 | `rest/library/b3.smali`（20 项）、`a3.smali`、`z2.smali`（switch → 实体） |
| 偏好键 | `rest/library/у.smali`（`list_zoom_*` L767-1153）、`prefs/В.smali:1093-1109` |
| BusActionButton | `widget/base/BusActionBehavior.smali:125-175`（属性解码）、`:635/:830`（`MsgBus.В` 派发） |
| 简体中文 | `.rea-analysis/decoded/res/values-zh-rCN/strings.xml` |
| 繁体中文 | `.rea-analysis/decoded/res/values-zh-rTW/strings.xml`（对照证伪） |

### 10.2 跨版本对照（build-1035）

`v1035/decoded` 中 `dialogs/ListOptsActivity.smali`（3158 行）暴露**同样的 8 个布局 id**（`0x7f0d0266/0215/0267/0268/0416/04d8/0269/0699` + 子项 `0x7f0d069a/069b/04d9/04da`）与**同样的 8 处探测**，仅混淆类名变化（`hy0`≈g1、`e11`≈v3、`mz0`≈m2、`dz0`≈d2、`ez0`≈e2、`rz0`≈r2、`qz0`≈q2、`sz0`≈s2 继承）。**分组集合未变。**

### 10.3 复现命令

```powershell
$env:JAVA_HOME = "<rea-bundle>/vendor/jdk"
apktool d --no-res -f -o <out> .rea-analysis/Poweramp-v3.apk
# 关键搜索：
#   "list_opts"                     → 弹窗标题与偏好
#   "cmd_list_options_dialog"       → 菜单项 msgId
#   "list_zoom_"                    → 每分类视图偏好
#   "layout_1_line"                 → 精简标题位掩码
#   "keep_list_pos"                 → 列表记忆列
#   const/16 v0, 0x30              → 16 项排序三元组（p0.g）
```

---

## 11. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| **`poweramp-list-options-matrix.md`** | **全分类横向矩阵**：38 个实体、7 种排序表、4 套缩放表、接口闭包口径。**本文 §6 矩阵的排序项数需按该文订正** |
| **`poweramp-album-songs-list-options.md`** | **专辑歌曲分类（`rest/library/q`）**：实体切换点、16 项 vs 5 项排序对照、每分类偏好键。本文 §6 矩阵未收录该类，以该文为准 |
| `poweramp-queue-view.md` | 队列**数据模型**（`queue` 表、`played_at >= created_at`）。本文仅覆盖队列页的列表选项组 |
| `poweramp-queue-runtime-reference.md` | 播放运行时状态机。本文不涉及 |
| `poweramp-library-three-views.md` | folders 表结构；本文 §4.3 引用其 `keep_list_pos` 列并补充 `playlists` 同样带这一对 |
| `poweramp-settings-export-import.md` | `listMemory` 导出类目；本文 §4.3 交叉印证 |
| `poweramp-category-views.md` / `poweramp-entity-views.md` / `poweramp-recents-views.md` | 各分类的页面结构；本文只覆盖其列表选项弹窗 |
| `poweramp-settings-root-structure.md` | 设置根结构；本文 §5.3 记录 Library 分支入口 |
| `poweramp-album-art-picker.md` | 封面选择器（`SelectAlbumArtActivity`）与封面数据层（`aa_status` / `AAResolver`）；本文 §5 的齿轮深链目标 `xml/aa.xml` 属该文档范围 |
| `poweramp-row-popup-cover.md` | 选中弹窗中**封面/图标如何显示**（行视图物理复用 + 场景切换）；本文只覆盖**菜单项与列表选项**，二者互补 |
