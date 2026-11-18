---
doc_id: "ARCH-POWERAMP-LIST-OPTIONS-SQL-BUILDERS"
title: "Poweramp 列表选项 ORDER BY 构建器全解（含三个隐藏排序开关）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni (versionCode 1025009)"
revision: 1
open_items: 4
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 继续调查列表选项实现"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/rest/library/{l,d4,u0,С,d0,j3,h1}.smali"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/rest/library/у.smali（开关键）"
  - "docs/architecture/poweramp-list-options-implementation.md（实现层总览，本文是其续篇）"
---

# Poweramp 列表选项 ORDER BY 构建器全解

> 本文是 `poweramp-list-options-implementation.md` §10「仍可继续的方向」的完成版。
> 把剩下的大构建器全部读完，并挖出**三个此前完全没记录的隐藏排序开关**。

## 0. 一句话结论

**排序不是"选一个字段"，而是"选一个字段 + 受 3 个全局开关二次修正"。**

同一个 `sortMode`，在开关不同的设备上会生成**不同的 ORDER BY**：

| 开关键 | 字段 | 影响 |
| --- | --- | --- |
| `no_sort_field` | `у.О` | 名称类排序用**原始名**还是**已剥离冠词的 *_sort 列** |
| `use_albumartist_albums` | `у.о` | 专辑列表按**专辑艺术家**还是按**曲目艺术家**分组 |
| `show_cue_source` | `у.Р` | 文件夹"按数量"排序时数 num_files 还是 num_all_files |

> 前两个在实现层文档 §1.5 已提到 `у.О`；`у.о` 与 `у.Р` 是**本轮新发现**。

---

## 1. 专辑族 `l.O()`（`:159-366`，208 行）

### 1.1 特殊之处：正向模式**不走 packed-switch**

```smali
if-eqz p1, :cond_8        ; 0
if-eq p1, 1, :cond_7      ; 1
if-eq p1, 2, :cond_6      ; 2
if-eq p1, 3, :cond_3      ; 3（艺术家）
if-eq p1, 4, :cond_2      ; 4（数量）
packed-switch p1, :pswitch_data_0
```

**而 `pswitch_data_0` 的基址是 `0x40000000`**（`:359`）——
**"反向"直接用另一张开关表**，而不是像 `p0` 那样先取 bit30 再在每条分支里二选一。

```smali
.packed-switch 0x40000000
    :pswitch_4   ; 0x40000000 = 0 反向
    :pswitch_3   ; 0x40000001 = 1 反向
    :pswitch_2   ; 0x40000002 = 2 反向
    :pswitch_1   ; 0x40000003 = 3 反向
    :pswitch_0   ; 0x40000004 = 4 反向
.end packed-switch
```

> **同一种"反向"语义，两种实现风格**：`p0` 用位测试 + 每分支二选一；
> `l` 用第二个 switch 表。这解释了为什么 `l.O()` 有 208 行而 `d4.O()` 只有 124 行。

### 1.2 五个模式的正向 ORDER BY

| 模式 | 标签 | ORDER BY（正向） | 偏移 |
| ---: | --- | --- | --- |
| 0 | 根据名称 | `h1.Х()` + " COLLATE NOCASE" | `:347-356` |
| 1 | 根据年份 | "album_year, " + Х() + " COLLATE NOCASE" | `:334-345` |
| 2 | 添加日期 | "albums.created_at" | `:329-332` |
| 3 | 根据艺术家 | IFNULL(album_artist[_sort], artist) + " COLLATE NOCASE, " + Х() | `:293-327` |
| 4 | 根据音轨号 | "albums.num_files, " + Х() + " COLLATE NOCASE " | `:278-291` |

**反向（0x40000000|mode）**：

| 模式 | ORDER BY（反向） |
| ---: | --- |
| 0 | Х() + " COLLATE NOCASE DESC" |
| 1 | "album_year DESC, " + Х() + " COLLATE NOCASE DESC" |
| 2 | "albums.created_at DESC" |
| 3 | IFNULL(...) + " COLLATE NOCASE DESC, " + Х() + " COLLATE NOCASE DESC" |
| 4 | "albums.num_files DESC, " + Х() + " COLLATE NOCASE DESC" |

### 1.3 `h1.Х()`：专辑名排序列

```smali
; h1.Х() @4184-4201
if (у.О == true)  → "album"        ; 原始名
else              → "album_sort"   ; 剥离冠词后的列
```

与 `h1.X()`（artist/artist_sort）、`h1.x()`（composer/composer_sort）**同构**。
三个实体族的名称排序口径由**同一个** `no_sort_field` 开关统一控制。

### 1.4 `у.о`（use_albumartist_albums）：模式 3 的二次分叉

模式 3（按艺术家）里还有一层判断（`:213-247`）：

```
if (у.о == true)                       ; 按专辑艺术家分组
    base = if (у.О) "IFNULL(album_artist, artist)"
           else     "IFNULL(album_artist_sort, artist)"
else                                    ; 按曲目艺术家
    base = h1.X()                       ; "artist" 或 "artist_sort"
ORDER BY = base + ", " + Х() + dir
```

> **"按艺术家排序"到底排谁，取决于用户是否开了"专辑按专辑艺术家分组"**。
> 这是"一个排序项，两种语义"——与 sortMode 私有编号是同一类设计代价。

---

## 2. 流 `d4.O()`（`:119-242`，124 行）

标准"位测试 + 每分支二选一"风格。6 个模式：

| 模式 | 标签 | 正向 | 反向 |
| ---: | --- | --- | --- |
| 2 | 根据 URL | folder_files.name COLLATE NOCASE | … DESC |
| 5 | 根据星级 | rating DESC, folder_files.name | rating, folder_files.name |
| 6 | 根据播放次数 | folder_files.played_times DESC, … | 去掉 DESC |
| 7 | 最后播放 | folder_files.played_fully_at DESC, … | 去掉 DESC |
| 0xb | 根据随机顺序 | folder_files.shuffle_order | … DESC |
| 0xc | 添加日期 | folder_files.created_at DESC, … | 去掉 DESC |

> **注意**：流的 `by_url` 模式实际排的是 `folder_files.name`（URL 存在 name 列里），
> 不是独立的 url 列。这与 `poweramp-streams-view.md` 的 `folder_files.url` 记录**不矛盾**——
> 排序用 name，播放取源时才读 url。

---

## 3. 文件夹族 `u0.Z0(I)`（`:286-437`，152 行）

`u0.O()` 与 `x0.O()` 都委托给 `Z0(I)`。6 个模式：

| 模式 | 标签 | 正向 | 反向 |
| ---: | --- | --- | --- |
| 0 | 根据名称 | folders.name COLLATE NOCASE ␠ | folders.name COLLATE NOCASE DESC |
| 1 | 路径（区分大小写） | path | path DESC |
| 2 | 添加日期 | folders.created_at, folders.name… | 两者 DESC |
| 3 | 添加/修改日期 | folders.dir_modified_at, folders.name… | 两者 DESC |
| 4 | 数量 | **见 §3.1** | 同 |
| 5 | 根据路径 | path COLLATE NOCASE ␠ | … DESC |

### 3.1 ★ 模式 4 的二次分叉（本轮新发现 `у.Р`）

```smali
; u0.Z0() :352-392
p1 = "folders.num_files"
v1 = "folders.num_all_files"
if (у.Р == true) p1 = v1        ; show_cue_source
ORDER BY = p1 + ", folders.name COLLATE NOCASE " (+ DESC)
```

`у.Р` 的键是 **`show_cue_source`**（`у.smali:277`）。

> **语义**：开启 CUE 支持后，"按歌曲数量排序"要数**该文件夹下所有文件**
> （folder.num_all_files，含 CUE 内的虚拟曲目），而不是实际入库的曲目数（num_files）。
> 否则一个含 CUE 的文件夹会"看起来只有 1 首歌"，排序结果与用户预期不符。

### 3.2 两种"路径"排序的区别

| 模式 | 排序键 | 大小写 | 对应标签 |
| ---: | --- | --- | --- |
| 1 | path | **敏感** | 根据路径（区分大小写） |
| 5 | path COLLATE NOCASE | 不敏感 | 根据路径 |

> 用户可见的两个选项就来自这里，**不是 UI 层的重复项**。

---

## 4. 专辑艺术家专辑 `С.O()`（`:179-261`，83 行）

**只覆写两个模式**，其余全部委托父类：

```smali
if (p1 == 3)           goto :cond_3   ; 3
if (p1 == 0x40000003)  goto :cond_0   ; 3 反向
invoke-super l->O(p1)                 ; ← 其余 3 个模式直接复用 l
```

| 输入 | ORDER BY |
| --- | --- |
| 3 | album_artist[_sort] + " COLLATE NOCASE, " + album[_sort] + " COLLATE NOCASE" |
| 0x40000003 | 两者都 DESC |

> **为什么必须覆写**：父类 `l` 的模式 3 是 IFNULL(album_artist, artist)（曲目级回退），
> 而在"专辑艺术家专辑"这一层，**专辑艺术家是已知的**，不需要回退；
> 且排序要**先按专辑艺术家、再按专辑名**二级排。这是子类语义覆盖的典型例子。

---

## 5. 三个隐藏开关汇总（本文最大价值）

```
no_sort_field            → h1.X() / h1.x() / h1.Х()
                           artist | artist_sort
                           composer | composer_sort
                           album | album_sort

use_albumartist_albums   → l.O() 模式 3 的基列
                           IFNULL(album_artist[_sort], artist)  vs  artist[_sort]

show_cue_source          → u0.Z0() 模式 4 的计数列
                           folders.num_all_files  vs  folders.num_files
```

> **三者共同点**：都只被 O() 读取，**都不在列表选项弹窗里**。
> 它们的 UI 入口在设置页，所以**用户在列表选项里选"按艺术家"，
> 实际排哪一列还取决于设置页的开关**。

---

## 6. 全部构建器总表（本文完成后无遗漏）

| 实体族 | 方法 | 行数 | 风格 | 模式数 |
| --- | --- | ---: | --- | ---: |
| 曲目族 | p0.O() @600 | 380 | 位测试 + packed-switch | 16 |
| 专辑族 | l.O() @159 | 208 | **前置 if + 基址 0x40000000 的 switch** | 5 × 2 |
| 专辑艺术家专辑 | С.O() @179 | 83 | 覆写 2 个 + super | 5（2 自实现） |
| 文件夹族 | u0.Z0() @286 | 152 | 位测试 + if 链 | 6 |
| 流 | d4.O() @119 | 124 | 位测试 + if 链 | 6 |
| 作曲家 | 委托 h1.K() | 94 | 静态工厂 | 3 |
| 艺术家 | 委托 h1.H() | 94 | 静态工厂 | 3 |
| 年份 | 委托 h1.Н() | 72 | 静态工厂 | 3 |
| 流派 | 委托 pixplicity/y.В() | 65 | 静态工厂 | 3 |
| 播放列表 | 委托 pixplicity/у.В() | 90 | 静态工厂 | 4 |
| 队列/书签 | 常量列 | 1 | — | — |
| 其余 10 个 | d()==-1，不显示排序组 | — | — | — |

---

## 7. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~三个开关在设置页的确切位置~~ | ✅ **已解**，见 `poweramp-list-options-settings-entry.md`：全在 `library_lists.xml`（:23 / :33 / :34） |
| ~~Q2~~ | ~~三个开关的默认值~~ | ✅ **已解**：XML 全部 `android:defaultValue=\"false\"`，见上述文档 §1.2 |
| Q3 | folders.num_all_files 的写入时机 | 只知是排序用列，扫描期如何填充未追 |
| Q4 | l.O() 模式 4 正向首键无 COLLATE | 正反向两侧一致，属正常 |

---

## 8. 证据索引

| 主题 | 位置 |
| --- | --- |
| 专辑族构建器 | rest/library/l.smali:159-366 |
| 反向 switch 基址 | l.smali:358-365（.packed-switch 0x40000000） |
| 专辑名排序列 | h1.smali:4184-4201（Х()） |
| 艺术家名排序列 | h1.smali:647-675（X()） |
| 作曲家名排序列 | h1.smali:2977-3005（x()） |
| 流构建器 | rest/library/d4.smali:119-242 |
| 文件夹构建器 | rest/library/u0.smali:286-437 |
| 文件夹数量开关 | u0.smali:359-388（读 у.Р） |
| 专辑艺术家专辑构建器 | rest/library/С.smali:179-261 |
| 开关键 no_sort_field | у.smali:303-309（у.О） |
| 开关键 use_albumartist_albums | у.smali:319-325（у.о） |
| 开关键 show_cue_source | у.smali:277（у.Р） |

> 行号口径：**build-1025** 的 .rea-analysis/smali/smali/…
