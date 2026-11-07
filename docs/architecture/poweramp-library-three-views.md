---
doc_id: "ARCH-POWERAMP-LIBRARY-THREE-VIEWS"
title: "Poweramp 媒体库三视图关系参考（所有歌曲 / 文件夹 / 文件夹层次结构）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-10-28"
updated: "2026-10-28"
source_documents:
  - "user request: 对照 SpMusic 三页面模型，逆向 Poweramp 的「所有歌曲」「文件夹」「文件夹层次结构」三者关系"
  - "shared task: task-11 记录 Poweramp 媒体库三视图关系"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009) :: SHA-256 4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0"
  - ".rea-analysis/findings-library-entities.md（本轮证据汇总，12 条 Evidence ID）"
  - ".rea-analysis/findings-db.md（folders 表 schema）"
  - ".rea-analysis/findings-core.md（g1 实体分类表）"
  - "docs/architecture/media-library-page-relationships.md（SpMusic 侧对照基准）"
  - "docs/architecture/poweramp-queue-runtime-reference.md（nextCategory 门控）"
  - "docs/architecture/poweramp-audio-settings-structure.md（同一全局 flag 的未解项）"
---

# Poweramp 媒体库三视图关系参考

## 0. 文档定位声明（必读）

**本文记录的是外部实现 Poweramp 的媒体内三视图结构，不是 SpMusic 的现状描述。**

> SpMusic 对照基线说明：本文第 2、8、9 节中对 SpMusic 的比较基于平铺文件夹改造前的历史实现。2026-10-28 已实现“平铺所有直接含歌目录、详情仅含本层歌曲”及分类根页快速索引；当前契约以 [媒体库三页面关系](media-library-page-relationships.md) 为准。此更新不改变本文的 Poweramp 取证结果或待验证项。

用途：为 SpMusic 三页面模型（`docs/architecture/media-library-page-relationships.md`）提供**一个有实证支撑的对照物**。凡涉及「我们该怎么做」，集中在第 10 章并明确标注为提案。

### 0.1 证据分级

| 标记 | 含义 | 可信度 |
| --- | --- | --- |
| **【实证·产物】** | JADX 反编译的方法体原文 | 最高 |
| **【实证·原文】** | APK 资源字符串原文（`strings.xml`） | 高 |
| **【推断】** | 本文作者推理，可能出错 | 低 |

### 0.2 最大缺口（先读）

> **普通「文件夹」页的真实 SQL 未取证。**

`getFolders()` → `t0`（仅 4 方法）→ 惰性委派 `v0`（仅 3 方法）→ 字段 `d` / `e`。
`t0` 的父类 `AbstractC0735` 中 `N0(...)` 是**抽象方法**（无方法体），`P` 类只是 URI 匹配持有者，不是 SQL 构建器。
**混淆委托链追到一半断了。**

因此本文对「文件夹」页的**排序方式**与**是否平铺全部文件夹**一律标【推断】，见第 11 章 L1。
**本文不声称两个文件夹页的行集相同**——只能说「可能相同，取决于未取证的 `v0` SQL」。

---

## 1. 三视图 → 实体映射

`com.maxmpz.audioplayer.rest.library.g1` 是唯一库门面【实证·产物，`findings-core.md`】：

| 页面 UI 文案 | 访问器 | 实体类 | 声明方法数 |
| --- | --- | --- | --- |
| **所有歌曲** | `getFiles()` | **`n0`** | 33 |
| **文件夹** | `getFolders()` | **`t0`** → `v0` | 4 → 3 |
| **文件夹层次结构** | `getFoldersHier()` | **`x0`** | 41 |

UI 文案来源【实证·原文，`strings.xml` 2056 条】：
```
folders       = "Folders"
folders_hier  = "Folders Hierarchy"
folder_songs  = "Folder Songs"
```

> 复现资源解码（需 Java）：
> ```
> apktool d --no-src -f -o .rea-analysis/decoded .rea-analysis/Poweramp-v3.apk
> ```

---

## 2. 核心论点一：三页不在同一层级

**这是 Poweramp 与 SpMusic 最本质的差别。**

| 页面 | 视图类型 | 一行的内容 | 能否播放 |
| --- | --- | --- | --- |
| 所有歌曲 | **song 视图** | 一首歌 | 直接播放 |
| 文件夹 | **category 视图** | 一个文件夹 | 不能，需进入 |
| 文件夹层次结构 | **category 视图** | 一个文件夹 | 不能，需进入 |

证据：`x0.X0()` 设置 `rVar.A = "folders"`（表=folders，行=文件夹）；`n0.X0()` 经 `h1.o()` 设置 `rVar.A = "folder_files JOIN folders …"`（表=folder_files，行=曲目）。两条不同的表，两种不同的行语义。

**两个文件夹页里没有任何歌曲，只有文件夹。** 进入某个文件夹后才显示该文件夹的曲目。

⇒ **Poweramp 的「三视图」实际是「1 个曲目视图 + 2 个容器视图」**，不是三个平级的曲目列表。

SpMusic 三页**都是歌曲列表**（`folder` 页也直接列歌曲），这是根本设计分歧。

```
数据流

n0 (所有歌曲)                 x0 (文件夹层次结构)
    │                              │
    │ h1.o()                       │ X0()
    ▼                              ▼
folder_files ──JOIN──> folders <──表── folders
   (曲目行)          (文件夹行)         (文件夹行)
                          ▲
                          │ t0 → v0 (未取证)
                          │ 文件夹
```

---

## 3. `folders` 表 schema

【实证·产物，`findings-db.md` §A.8】

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

### 3.1 四个计数列预计算的意义

`num_files` / `num_all_files` / `num_subfolders` / `hier_num_files` 全部是**存储列**，不是视图计算值。

⇒ 回答「此文件夹子树共多少曲目」**无需递归查询**，直接读 `num_all_files`。

对照 SpMusic：每次用 `reduce` / `filter` 现算（`folderHierarchy.ts:36-67` 的 `folderEntries()`）。
Poweramp 把这个开销移到了**扫描期**（`g1.m2440` 重建这些计数）。

### 3.2 双轨：树 + 物化路径

同时存在 `parent_id`（自引用）与 `sort_path`（物化路径），二者服务的用途不同：

| 列 | 用途 |
| --- | --- |
| `parent_id` | 定位直接子节点（逐层下钻） |
| `sort_path` | **排序**（见 §4.1，无需递归即可得到树序） |

---

## 4. 文件夹层次结构：`x0`

### 4.1 `x0.X0()` 原文【实证·产物】

```java
@Override // com.maxmpz.audioplayer.rest.library.u0, com.maxmpz.audioplayer.rest.library.AbstractC0743
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

**三个要点**：

1. **表 = `folders`**，不是 `folder_files`
2. **排序 = `sort_order, rtrim(sort_path, '/') COLLATE NOCASE`**
   —— 靠**物化路径字符串比较**得到树序，**不做递归**
   `rtrim(sort_path,'/')` 去掉尾部斜杠，避免 `a/b/` 与 `a/b` 不等
3. 支持 `?no_empty=1` 查询参数

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

`z = false`（`X0` 传入值）时生成：

- flag **true**：`WHERE folders.num_all_files > 0`
- flag **false**：`WHERE folders.num_files > 0`

`z = true` 时生成：`WHERE (… OR folders.num_subfolders != 0)`

**语义解读【推断】**：
- `num_files > 0` —— 只显示**本层有曲目**的文件夹（纯容器文件夹被隐藏）
- `num_all_files > 0` —— 显示**子树有曲目**的文件夹（容器文件夹保留，便于下钻）
- `OR num_subfolders != 0` —— 即使无曲目，只要有子目录就保留

⇒ **三种「空」的判定口径由两个参数复合决定**，这是层级导航能正确下钻的关键。

### 4.3 `x0` 的其它能力【实证·产物】

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `v0()` | `→ x3[]` | **返回子分类数组**（层级页可再分类） |
| `c1()` | `→ y0` | — |
| `K0(x2)` | `→ boolean` | 实体匹配 |
| `mo2427()` | `→ x2` | 实体描述符 |

父链：`x0` → `u0` → `AbstractC0743`。

---

## 5. 所有歌曲：`n0`

### 5.1 `n0.X0()` 原文【实证·产物】

```java
@Override // com.maxmpz.audioplayer.rest.library.AbstractC0743
public String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                   StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    h1.o(rVar, sb, O(C0742.l.f3810), i1Var, str, arrayList, h1.m2453(), false, false);
    return p0.f3367;
}
```

### 5.2 `h1.o()` —— 共享装配器【实证·产物】

```java
public static void o(com.maxmpz.audioplayer.player.r rVar, StringBuilder sb, String str,
                     i1 i1Var, String str2, ArrayList arrayList, String[] strArr,
                     boolean z, boolean z2) {
    rVar.A = android.support.v4.media.A.m3("folder_files", z ? " LEFT " : " INNER ",
        " JOIN folders ON folders._id=folder_id" +
        " LEFT JOIN artists ON artists._id=folder_files.artist_id" +
        " LEFT JOIN albums  ON albums._id=folder_files.album_id",
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

| 项 | 值 |
| --- | --- |
| 主表 | `folder_files` |
| JOIN | `JOIN folders ON folders._id = folder_id`（**所有歌曲页也 JOIN folders**，用于取路径） |
| 连接类型 | 默认 `INNER`；`z=true` 时 `LEFT`（`n0` 传 `false`） |
| 可选 JOIN | `artists` / `albums` / 条件性 `album_artists` |
| 条件过滤 | flag=false 时追加 `folder_files.cue_folder_id IS NULL` |
| 投影 | `p0.f3367` |

⇒ **所有歌曲与文件夹页共享同一数据源拓扑**（都以 `folders` 为中心），差别只在**投影**（曲目行 vs 文件夹行）。

### 5.3 同一全局 flag 的双重作用

`C0742.f3414.f3789` 在两处出现【实证·产物】：

| 位置 | flag = true | flag = false |
| --- | --- | --- |
| `x0.a1()` | `folders.num_all_files>0` | `folders.num_files>0` |
| `h1.o()` | **不过滤** `cue_folder_id` | 过滤 `cue_folder_id IS NULL` |

⇒ 该 flag 是**跨模块全局开关**，同时影响：
1. 「空文件夹」的判定口径
2. CUE 虚拟曲目是否计入

> 该 flag 的取值与来源在 `poweramp-audio-settings-structure.md` 的 P 系列未解项中也出现，属**跨文档同一未解点**。本文沿用未解标注，不做推断。

---

## 6. 三视图集合关系（形式化）

记号：

- `S` = `folder_files` 全部行（全部曲目）
- `F` = `folders` 全部行（全部文件夹）
- `flag` = `C0742.f3414.f3789`

### 6.1 各视图的行集

```
所有歌曲行集     = S
                 （flag=false 时再过滤 cue_folder_id IS NULL）

文件夹页行集     = F 的某个子集                 ← L1 未取证，精确条件未知
                 ⊇ 或 = 下文 F_nonempty（取决于 v0 SQL）

层次结构页行集   = F_nonempty

  flag=true  : F_nonempty = { f ∈ F | f.num_all_files > 0 }
  flag=false : F_nonempty = { f ∈ F | f.num_files > 0 }
  （z=true 时追加 ∨ f.num_subfolders ≠ 0）
```

### 6.2 结构关系

```
S ──JOIN folders ON folders._id = folder_files.folder_id──→ F
F ──parent_id 自引用──────────────────────────────────→ 树结构
F ──sort_path 物化路径────────────────────────────────→ 树序
```

### 6.3 归属与递归

- 曲目 `s` 属于文件夹 `f` **⟺** `s.folder_id = f._id`
- `f` 的**递归曲目集** = `{ s ∈ S | s.folder_id ∈ subtree(f) }`
- 其基数 **即** `f.num_all_files`（**预计算列，非查询结果**）
- `f` 的**直接曲目集** = `{ s ∈ S | s.folder_id = f._id }`，基数即 `f.num_files`

### 6.4 成立与不成立的断言

| 断言 | 状态 |
| --- | --- |
| `set(所有歌曲) = ⋃_{f ∈ F} set(直接曲目(f))` | **成立**（`folder_files` 每行必有 `folder_id`） |
| 层次结构页行集 ⊆ `F` | **成立** |
| 文件夹页行集 = 层次结构页行集 | **未知**（L1） |
| 所有歌曲包含 CUE 虚拟曲目 | **取决于 flag**（§5.3） |

---

## 7. 层级页的三个专属设置

【实证·原文，`strings.xml`】这是 Poweramp 处理「层级作用域」的方式。

| 设置 key | 标题 | 说明原文 |
| --- | --- | --- |
| `pref_hier_flat_shf` | Shuffle All Songs In Folder Hierarchy | "Shuffle Songs mode **shuffles all songs from the whole folder hierarchy**. If enabled, header Shuffle button uses this mode as well" |
| `pref_hier_no_advance` | No "Play All Categories" For Hier Folders | "Don't apply Play All Categories mode when Folders Hierarchy playback started with the list header play button" |
| `pref_root_hier_immediate` | Folders Hierarchy Immediate Root | "If only one root music folder exists, **show its contents immediately** in top Folders Hierarchy category. This option **will go deeper until folder with tracks or multiple subfolders**" |

其它相关：

| key | 说明原文 |
| --- | --- |
| `not_applied_in_folders_hier` | "Not applied in Folders Hierarchy" |
| `pref_summary_menu_nav_to_folders` | "Track menu / Folders button navigates to the Folders category **instead of** the Folders Hierarchy" |
| `shuffle_hier_songs_long` | "Shuffle Songs (In Hierarchy)" |
| `selected_folder_exists_in_hier` | "The folder already exists in the previously added folder" |

### 7.1 两条重要推论

**推论 1：层次结构是默认页面。**
`pref_summary_menu_nav_to_folders` 的措辞是「navigates to the Folders category **instead of** the Folders Hierarchy」⇒ 默认目标是 Hierarchy，普通 Folders 是需手动切换的备选。

**推论 2：层级页的「随机」是把整棵子树摊平。**
`pref_hier_flat_shf` 明确写 "shuffles all songs from the **whole folder hierarchy**"。

⇒ Poweramp 把「层级随机到底指当前层还是整个子树」这个歧义，**做成了一个用户可见的开关**。

---

## 8. 与 SpMusic 三页对照

SpMusic 侧依据 `docs/architecture/media-library-page-relationships.md`（702 行，D1–D16 缺陷）。

| # | 维度 | Poweramp | SpMusic |
| --- | --- | --- | --- |
| 1 | 三页类型 | 1 个 song 视图 + **2 个 category 视图** | **3 个都是歌曲列表** |
| 2 | 文件夹页是否含歌曲 | **否**（只有文件夹行） | 是（直接列歌曲） |
| 3 | 进入文件夹的行为 | category 导航（换实体/换 URI） | 切换到该文件夹的曲目列表 |
| 4 | 递归曲目计数 | `num_all_files` **列预计算** | 运行时 `reduce` 现算 |
| 5 | 层级排序 | `rtrim(sort_path,'/')` 物化路径比较 | `folderPath` 字符串比较 |
| 6 | 空/容器文件夹判定 | `num_files` / `num_all_files` / `num_subfolders` 组合，flag 切换 | `!(status==='ready' && complete && songs.length===0)` |
| 7 | 层级作用域歧义 | **3 个显式设置消解** | **未消解**（见 D 系列） |
| 8 | 随机 + 层级 | `pref_hier_flat_shf` 显式声明摊平整子树 | 无此概念 |
| 9 | 播放推进（跨分类） | `pref_hier_no_advance` 默认不跨 | `all-categories-until-stop` 模式 |
| 10 | 单根自动下钻 | `pref_root_hier_immediate` | 无 |
| 11 | 默认落地页 | **Hierarchy** | `folder`（推断，待确认） |
| 12 | 曲目归属表达 | `folder_id` 外键（单一权威） | `folderPath` 字符串派生（多源派生） |

### 8.1 核心差异：隐藏分歧 vs 显式开关

SpMusic 的层次结构页在 `media-library-page-relationships.md` 中被记录为有**三个分歧作用域**：

- 显示：非递归（`directSongs`，`FolderHierarchyPanel.tsx:152`）
- 批量播放：递归（`recursiveSongs`，`:154`，用于 hero 计数与批量 `onSelectFolders`）
- 单曲播放：非递归（`visibleSongs`）

⇒ **同一页面上，用户看到的数量、批量播放的范围、单曲播放的范围三者不一致**，且这一分歧**没有出现在 UI 上**。

Poweramp 的应对是把同类歧义**提到设置层**：

| 歧义点 | SpMusic | Poweramp |
| --- | --- | --- |
| 随机作用域 | 未表达 | `pref_hier_flat_shf` 开关 |
| 播放推进是否跨分类 | 由 `RepeatMode` 隐式决定 | `pref_hier_no_advance` 开关 |
| 单根是否自动下钻 | 无此行为 | `pref_root_hier_immediate` 开关 |

**这是本文对 SpMusic 最有借鉴价值的一条结论**：
歧义没有消失，但 Poweramp 让它**显式、可配置、用户可见**；SpMusic 把它留在了实现内部。

---

## 9. 是否照抄的取舍

### 9.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **文件夹页做成 category 视图，而非曲目列表** | 与「所有歌曲」形成清晰分层：容器 vs 内容。SpMusic 三页都是曲目列表，导致「文件夹页」与「所有歌曲页」语义重叠，用户难以理解差异 |
| A2 | **`num_all_files` 等计数列预计算** | 层级页显示「N 首」和空文件夹判定都是 O(1)；SpMusic 现算是 O(子树规模)，在深目录下会变慢 |
| A3 | **物化路径 `sort_path` 用于排序** | 避免了递归 CTE 或应用层树排序；SQL 层面直接得到树序 |
| A4 | **空文件夹的三个口径（直接/递归/有子目录）可组合** | 纯容器文件夹在「只显示有歌的」模式下会被误隐藏；Poweramp 用 `OR num_subfolders != 0` 解决 |
| A5 | **把层级作用域歧义做成用户开关** | 见 §8.1 |
| A6 | **`?no_empty=1` 作为查询参数** | 同一实体支持「全部」与「仅非空」两种视图，无需两个实体 |

### 9.2 不建议照抄

| # | 做法 | 理由 |
| --- | --- | --- |
| N1 | **一个全局 flag 同时管两件不相干的事**（`C0742.f3414.f3789` 管空文件夹口径 + CUE 计数） | 两个语义本该独立配置；耦合后无法单独调整，也让排障困难。这是混淆/优化带来的偶然耦合，不是设计优点 |
| N2 | **`rtrim(sort_path,'/')` 排序** | 依赖路径字符串的字典序，大小写与 locale 敏感（`COLLATE NOCASE` 已缓解但仍脆弱）。SpMusic 已有明确的 `folderPath` 比较函数，改造成本不划算 |
| N3 | **同时维护 `num_all_files` 与 `hier_num_files` 两个递归计数** | 语义重叠，用途未辨（见 L3）。不要复制这种冗余 |
| N4 | **混淆的委托链**（`t0`→`v0`→`d`/`e`，`AbstractC0735.N0` 抽象） | 这是混淆产物，导致本文 L1 无法闭环。正面教训是：**实体委托层要可读** |

---

## 10. 未解 / 待验证

| # | 问题 | 影响 | 优先级 |
| --- | --- | --- | --- |
| **L1** | 普通「文件夹」页（`t0`→`v0`→`d`/`e`）的**真实 SQL** | 无法确定其排序方式与是否平铺全部文件夹。**本文最大缺口** | **高** |
| **L2** | `C0742.f3414.f3789` 的**取值来源** | 决定「空文件夹」口径与 CUE 是否计入 | **高** |
| L3 | `u0.f3381` 与 `p0.f3367` 两个投影数组的**列定义** | 决定两页返回的具体字段 | 中 |
| L4 | `x0.v0(): x3[]` 返回的子分类构成 | 层级页是否可再按子维度切分 | 中 |
| L5 | 两个文件夹页是否**共用同一 URI 实体**（仅 query 参数不同） | 若是，则两者是同一实体的两种呈现 | 中 |
| L6 | `AbstractC0735.N0`（抽象）在运行时由谁实现 | 与 L1 直接相关 | 中 |
| L7 | `pref_summary_menu_nav_to_folders` 的**默认值** | 确认 Hierarchy 是否真为默认落地页 | 低 |

> L1 需要继续追 `d` / `e` 两个类；L2 需反编译 `C0742` 的初始化；L3 需读静态数组字面量。

---

## 11. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| `docs/architecture/media-library-page-relationships.md` | **SpMusic 现状**。本文 §8 只做对照与引用，不重复其 D1–D16 内容 |
| `docs/architecture/poweramp-queue-runtime-reference.md` | 队列状态机。本文 §7 的「不跨分类」与其 `nextCategory` 门控相关，仅交叉引用 |
| `docs/architecture/poweramp-search-and-queue-impact.md` | 搜索实体 `v3` 同样持有 `x3[]` 子分类，与 `x0.v0()` 同型 |
| `docs/architecture/poweramp-audio-settings-structure.md` | 该文 P 系列未解项与本文 L2 是同一个全局 flag |

---

## 12. Evidence ID 索引

| 主题 | Evidence ID |
| --- | --- |
| `t0` 类摘要（4 方法） | `ev_c486f26752b15d225ba9c0c5a773ba5aa85c0b8bd4bf4ebbbec5583b15be61b7` |
| `x0` 类摘要（41 方法） | `ev_105b7813e9d7df6afd6c64edc73284da6c71ddf83d28172392561241d18bcc63` |
| **`x0.X0`（层级 SQL）** | `ev_663f7fc590c5faad5707fb8bd18d0d8105f450bf520750d236a23534d868ec2a` |
| **`x0.a1`（no_empty 过滤）** | `ev_d8f654b10c00859423ef3166f9231a1a4e758c7f57592d80c5627b0d2a13eca5` |
| `t0.d0`（委派 `P`） | `ev_cc5ba7c28cfa5e5054f5e86375206be01e21dc12e1c78e9b2dbb35224185e715` |
| **`t0.mo2427`（→ `v0`）** | `ev_2c13c65969b7dc2169550532b7ffb9ee28575cce528e51e6cac1c8dd7c6fa5e7` |
| `v0` 类摘要（3 方法） | `ev_02e92698f65b6f3e1901f85ef677c5d73c942c7c4b92caa4bfef785b2a7762c0` |
| `P` 类摘要（URI 持有者） | `ev_bdc33aa33f0d525e8fcb8d5ab1a7c7de49b2d499c8f80b1c39893a746319d877` |
| `AbstractC0735.N0`（abstract） | `ev_d7ce43a1441ac8fbcfee231fea31f3ef1b2d7eaf3cc74b3d304742f8acff3ffb` |
| `n0` 类摘要（33 方法） | `ev_42f73f9c053b9fdcad9762d5be061a0ddf78136e6578ded68082647daa239468` |
| **`n0.X0`（所有歌曲）** | `ev_1bf51e258ed26ba113b77b94d8d59290cfc5953f33b02f0cd7ec204d17491cf4` |
| **`h1.o`（共享装配器）** | `ev_f65dc4c72c7d67af6a116a1795134828b7584dc5d95aa2c5c3583940e442898b` |

`folders` 表 schema 来源：`.rea-analysis/findings-db.md` §A.8（L691）。
`strings.xml` 来源：`.rea-analysis/decoded/res/values/strings.xml`（apktool 3.0.3 解码，2056 条）。
