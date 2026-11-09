# Poweramp 媒体库三视图关系（所有歌曲 / 文件夹 / 文件夹层次结构）

**证据级别**：【实证·产物】= JADX 反编译原文；【实证·原文】= APK 资源字符串；【推断】= 作者推理。

| 项 | 值 |
| --- | --- |
| 目标 | `com.maxmpz.audioplayer` build-1025-uni (1025009) |
| APK SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 引擎 | JADX headless 0.7.1 via REA |
| 采集 | 2026-10-28 |

---

## 0. 结论速览

1. Poweramp UI **确实有三个页面**：`folders`="Folders" 与 `folders_hier`="Folders Hierarchy"（`strings.xml` 实证），加上所有歌曲。
2. **三页不在同一层级**：所有歌曲是 **song 视图**（行=歌曲）；两个文件夹页都是 **category 视图**（行=文件夹，不含歌曲）。
3. `folders` 表是**自引用树 + 物化路径**，且**预计算四个计数列**。
4. 一个**全局 flag `C0742.f3414.f3789`** 同时控制「空文件夹判定用哪个计数」和「是否包含 CUE 虚拟曲目」。
5. 层级页的「作用域歧义」被 **3 个显式设置**消解（`pref_hier_flat_shf` / `pref_hier_no_advance` / `pref_root_hier_immediate`）。
6. **层次结构是默认页面**，普通「文件夹」是备选（`pref_summary_menu_nav_to_folders`）。

---

## 1. 三视图 → 实体映射

`rest.library.g1` 是唯一库门面（`findings-core.md:191-207`【实证·产物】）：

| 页面 | 访问器 | 实体类 | 方法数 |
| --- | --- | --- | --- |
| 所有歌曲 | `getFiles()` | **`n0`** | 33 |
| 文件夹 | `getFolders()` | **`t0`** → 委派 `v0` | 4 / 3 |
| 文件夹层次结构 | `getFoldersHier()` | **`x0`** | 41 |

---

## 2. UI 证据（`strings.xml`，2056 条）【实证·原文】

```
folders          = Folders
folders_hier     = Folders Hierarchy
folder_songs     = Folder Songs
folder_short     = Folder
```

### 2.1 层级页专属设置

| key | 值 |
| --- | --- |
| `pref_hier_flat_shf` | Shuffle All Songs In Folder Hierarchy |
| `pref_summary_hier_flat_shf` | Shuffle Songs mode **shuffles all songs from the whole folder hierarchy**. If enabled, header Shuffle button uses this mode as well |
| `pref_hier_no_advance` | No "Play All Categories" For Hier Folders |
| `pref_summary_hier_no_advance` | Don't apply Play All Categories mode when Folders Hierarchy playback started with the list header play button |
| `pref_root_hier_immediate` | Folders Hierarchy Immediate Root |
| `pref_summary_root_hier_immediate` | If only one root music folder exists, **show its contents immediately** in top Folders Hierarchy category. This option **will go deeper until folder with tracks or multiple subfolders** |
| `not_applied_in_folders_hier` | Not applied in Folders Hierarchy |
| `pref_menu_nav_to_folders` | Navigate to the Folders |
| `pref_summary_menu_nav_to_folders` | Track menu / Folders button navigates to the Folders category **instead of** the Folders Hierarchy |
| `shuffle_hier_songs_long` | Shuffle Songs (In Hierarchy) |
| `pref_summary_hier_files_zoom` | Apply Folder Files zoom level for Folders Hierarchy category when a folder… |
| `selected_folder_exists_in_hier` | The folder already exists in the previously added folder |

**关键推论**：`pref_summary_menu_nav_to_folders` 存在 ⇒ 默认导航目标是 **Hierarchy**，普通 Folders 需手动切换。

---

## 3. `folders` 表 schema【实证·产物，`findings-db.md:691`】

```
folders:
  _id, path, name,
  parent_id, parent_name, short_name,      ← 自引用树
  is_cue,
  num_files,          ← 直接曲目数
  num_all_files,      ← 递归曲目数（含全部子目录）
  num_subfolders,     ← 直接子目录数
  duration,           ← 直接时长
  hier_duration,      ← 递归时长
  hier_num_files,     ← 递归曲目数（与 num_all_files 并存）
  keep_list_pos, keep_track_pos,
  sort_path,          ← 物化路径
  parent_label
```

**四个计数列预计算**：`num_files` / `num_all_files` / `num_subfolders` / `hier_num_files`。
⇒ 运行时无需递归即可回答「此文件夹子树共多少曲目」。

---

## 4. 文件夹层次结构：`x0`

### 4.1 `x0.X0()` 原文【实证·产物】

```java
@Override // com.maxmpz.audioplayer.rest.library.u0, AbstractC0743
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    rVar.A = "folders";
    androidx.appcompat.widget.n.m313(str, K, sb, arrayList);
    if (uri.getBooleanQueryParameter("no_empty", false)) {
        a1(rVar, false);
    }
    i1Var.B = "sort_order, rtrim(sort_path, '/') COLLATE NOCASE";
    return u0.f3381;
}
```

**要点**：
- 表 = `folders`（**不是** `folder_files`）
- 排序 = `sort_order, rtrim(sort_path, '/') COLLATE NOCASE` —— **物化路径字符串比较**，不是 `parent_id` 递归
- 支持 `?no_empty=1` 查询参数

### 4.2 `x0.a1()` —— 空文件夹过滤【实证·产物】

```java
public static void a1(com.maxmpz.audioplayer.player.r rVar, boolean z) {
    if (z) {
        rVar.B("(");
    }
    if (C0742.f3414.f3789) {
        rVar.B("folders.num_all_files>0");      // 递归计数
    } else {
        rVar.B("folders.num_files>0");          // 直接计数
    }
    if (z) {
        rVar.B(" OR folders.num_subfolders!=0)");   // 有子目录也算非空
    }
}
```

⇒ `z=true` 时生成：`(folders.num_files>0 OR folders.num_subfolders!=0)`
⇒ 全局 flag `C0742.f3414.f3789` 决定用 `num_all_files` 还是 `num_files`。

### 4.3 `x0` 其它能力

- `v0(): x3[]` —— **返回子分类数组**（层级页可再分类）
- `c1(): y0`
- `K0(x2)` / `mo2427(): x2`
- 父链：`x0 extends u0 extends AbstractC0743`

---

## 5. 普通文件夹：`t0`（**SQL 未取证**）

`t0` 只有 4 个方法 / 2 个字段【实证·产物】：

```
t0 { <init>(g1); G0(String): В; d0(): х; mo2427(): x2 }
fields: X: P, x: kotlin.Lazy
```

```java
// t0.d0()
@Override // AbstractC0735, com.maxmpz.rest.InterfaceC0837
public final AbstractC0838 d0() { return this.X; }

// t0.mo2427()
@Override // com.maxmpz.audioplayer.rest.library.w1
public final x2 mo2427() { return (v0) this.x.getValue(); }
```

⇒ `t0` 是**纯转发器**，惰性创建 `v0`。

`v0` 只有 3 个方法 / 3 个字段：
```
v0 { <init>(t0); d0(): х; k0(): x2 }
fields: H: t0, P: d, f3383: e
```

`t0` 的父类 `AbstractC0735`（12 方法）中 `N0(Uri, r, ArrayList, i1): String[]` 是 **abstract_method**（无方法体）。

`P`（3 方法 / 2 字段）仅持有 `B: int` 与 `f3278: A`，是 **URI 匹配持有者**，非 SQL 构建器。

⇒ **普通「文件夹」页的真实 SQL 在 `v0` 的 `d` / `e` 字段所指类中，本轮未追。**

---

## 6. 所有歌曲：`n0`

### 6.1 `n0.X0()` 原文【实证·产物】

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                   StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    h1.o(rVar, sb, O(C0742.l.f3810), i1Var, str, arrayList, h1.m2453(), false, false);
    return p0.f3367;
}
```

### 6.2 `h1.o()` —— 共享装配器【实证·产物】

```java
public static void o(r rVar, StringBuilder sb, String str, i1 i1Var, String str2,
                     ArrayList arrayList, String[] strArr, boolean z, boolean z2) {
    rVar.A = A.m3("folder_files",
        z ? " LEFT " : " INNER ",
        " JOIN folders ON folders._id=folder_id" +
        " LEFT JOIN artists ON artists._id=folder_files.artist_id" +
        " LEFT JOIN albums ON albums._id=folder_files.album_id",
        C0742.O.f3789 ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id" : "");
    if (!C0742.f3414.f3789) {
        if (z2) {
            rVar.B(" AND ");
        }
        rVar.B("folder_files.cue_folder_id IS NULL");
    }
    androidx.appcompat.widget.n.m313(str2, strArr, sb, arrayList);
    i1Var.B = str;
}
```

**要点**：
- 表 = `folder_files`
- **`JOIN folders ON folders._id=folder_id`** —— 所有歌曲页也 JOIN `folders`（取路径）
- 默认 `INNER`，`z=true` 时 `LEFT`（z 由调用方传 `false`）
- 投影 = `p0.f3367`

### 6.3 同一 flag 的双重作用

`C0742.f3414.f3789` 在两处出现：

| 位置 | flag = true | flag = false |
| --- | --- | --- |
| `x0.a1()` | `num_all_files>0` | `num_files>0` |
| `h1.o()` | **不过滤** `cue_folder_id` | 过滤 `cue_folder_id IS NULL` |

⇒ 该 flag 是**跨模块全局开关**，同时影响「文件夹非空口径」与「CUE 虚拟曲目是否计入」。
其取值与来源在各文档中均标为未解（音频设置文档 P 系列）。

---

## 7. 三视图集合关系

设：

- `S` = `folder_files` 全部行（全部曲目）
- `F` = `folders` 全部行
- `F_nonempty` = `a1()` 过滤后的子集

```
所有歌曲行集   = S
               （可选再过滤 cue_folder_id IS NULL）

文件夹页行集   = F 的某个子集        ← SQL 未取证，精确条件未知
层次结构页行集 = F_nonempty
               = { f ∈ F | (f.num_files>0 ∨ f.num_subfolders≠0) }   （flag=false）
               或 { f ∈ F | (f.num_all_files>0 ∨ f.num_subfolders≠0) }（flag=true）
```

**结构关系**：

```
S ── JOIN folders ──→ F          （所有歌曲可算出每首歌所属文件夹）
F ── parent_id 自引用 ──→ 树
F ── sort_path 物化路径 ──→ 树序
```

**新增曲目 `s` 落入文件夹 `f` ⟺ `s.folder_id = f._id`**
**`f` 的递归曲目集** = `{ s | s.folder_id ∈ subtree(f) }`，其基数即 `f.num_all_files`（预计算）

---

## 8. 与 SpMusic 三页的对照

SpMusic 侧依据 `docs/architecture/media-library-page-relationships.md`。

| 维度 | Poweramp | SpMusic |
| --- | --- | --- |
| 三页类型 | 1 个 song 视图 + **2 个 category 视图** | 3 个**都是歌曲列表** |
| 文件夹页是否含歌曲 | **否**（只有文件夹行） | 是（列出歌曲） |
| 递归计数 | `num_all_files` 列预计算 | 运行时 `reduce` 现算 |
| 层级排序 | `rtrim(sort_path,'/')` 物化路径 | `folderPath` 字符串比较 |
| 空文件夹判定 | `num_files`/`num_all_files` + `num_subfolders`，flag 切换 | `!(status==='ready' && complete && songs.length===0)` |
| 层级作用域歧义 | **3 个显式设置消解** | **未消解**（显示非递归 / 批量播放递归 / 单曲播放非递归） |
| 随机 + 层级 | `pref_hier_flat_shf` 显式声明「摊平整子树」 | 无此概念 |
| 播放推进 | `pref_hier_no_advance` 不跨分类 | `all-categories-until-stop` 模式 |
| 单根自动下钻 | `pref_root_hier_immediate` | 无 |
| 默认落地页 | **Hierarchy**（`pref_summary_menu_nav_to_folders`） | `folder` 或 `folders`（待确认） |

**核心差异**：SpMusic 把「层级播放作用域」的三个分歧实现留在代码里（D 系列缺陷）；Poweramp **把它变成用户可见开关**。

---

## 9. 未解 / 待验证

| # | 问题 | 影响 |
| --- | --- | --- |
| **L1** | 普通「文件夹」页（`t0`→`v0`→`d`/`e`）的**真实 SQL** | 无法确定其排序方式与是否平铺全部文件夹。**本文最大缺口** |
| L2 | `C0742.f3414.f3789` 的**取值来源** | 决定「空文件夹」口径与 CUE 是否计入 |
| L3 | `u0.f3381` 与 `p0.f3367` 两个投影数组的**列定义** | 决定两页返回的具体字段 |
| L4 | `x0.v0(): x3[]` 返回的子分类构成 | 层级页是否可再按子维度切分 |
| L5 | 普通「文件夹」与「层次结构」是否**共用同一 URI 实体**（仅 query 参数不同） | 若是，则两者是同一实体的两种呈现 |
| L6 | `AbstractC0735.N0`（抽象）在运行时由谁实现 | 与 L1 相关 |
| L7 | `pref_summary_menu_nav_to_folders` 的**默认值** | 确认是否 Hierarchy 为默认 |

---

## 10. 与既有文档的关系

| 文档 | 关系 |
| --- | --- |
| `docs/architecture/media-library-page-relationships.md` | **SpMusic 现状**，本文做对照基准 |
| `docs/architecture/poweramp-queue-runtime-reference.md` | 队列状态机（`next`/`prev`/`nextCategory`）。层级页的「不跨分类推进」与其中的 `nextCategory` 门控相关 |
| `docs/architecture/poweramp-search-and-queue-impact.md` | 搜索实体 `v3` 也用 `x3[]` 子分类，与 `x0.v0()` 同型 |
| `docs/architecture/poweramp-audio-settings-structure.md` | 该文的 P 系列未解与本文 L2 是同一 flag |

---

## 11. Evidence ID 索引

| 主题 | Evidence ID |
| --- | --- |
| `t0` 类摘要 | `ev_c486f26752b15d225ba9c0c5a773ba5aa85c0b8bd4bf4ebbbec5583b15be61b7` |
| `x0` 类摘要 | `ev_105b7813e9d7df6afd6c64edc73284da6c71ddf83d28172392561241d18bcc63` |
| **`x0.X0`（层级 SQL）** | `ev_663f7fc590c5faad5707fb8bd18d0d8105f450bf520750d236a23534d868ec2a` |
| **`x0.a1`（no_empty 过滤）** | `ev_d8f654b10c00859423ef3166f9231a1a4e758c7f57592d80c5627b0d2a13eca5` |
| `t0.d0` | `ev_cc5ba7c28cfa5e5054f5e86375206be01e21dc12e1c78e9b2dbb35224185e715` |
| **`t0.mo2427`（→`v0`）** | `ev_2c13c65969b7dc2169550532b7ffb9ee28575cce528e51e6cac1c8dd7c6fa5e7` |
| `v0` 类摘要 | `ev_02e92698f65b6f3e1901f85ef677c5d73c942c7c4b92caa4bfef785b2a7762c0` |
| `P` 类摘要 | `ev_bdc33aa33f0d525e8fcb8d5ab1a7c7de49b2d499c8f80b1c39893a746319d877` |
| `AbstractC0735.N0`（abstract） | `ev_d7ce43a1441ac8fbcfee231fea31f3ef1b2d7eaf3cc74b3d304742f8acff3ffb` |
| `n0` 类摘要 | `ev_42f73f9c053b9fdcad9762d5be061a0ddf78136e6578ded68082647daa239468` |
| **`n0.X0`（所有歌曲）** | `ev_1bf51e258ed26ba113b77b94d8d59290cfc5953f33b02f0cd7ec204d17491cf4` |
| **`h1.o`（共享装配器）** | `ev_f65dc4c72c7d67af6a116a1795134828b7584dc5d95aa2c5c3583940e442898b` |

**字符串证据来源**：`.rea-analysis/decoded/res/values/strings.xml`（2056 条，apktool 3.0.3 解码）。
复现命令（需 Java）：
```
apktool d --no-src -f -o .rea-analysis/decoded .rea-analysis/Poweramp-v3.apk
```
