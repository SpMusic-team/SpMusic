---
doc_id: "ARCH-POWERAMP-IMPL-IDEA11-REPEAT-WORDING"
title: "已实现投票逐条逆向 #8：Repeat 按钮文案统一（idea 11）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni (versionCode 1025009)"
revision: 1
open_items: 1
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 继续逐条逆向已实现投票（第 8 条）"
  - "docs/architecture/poweramp-feature-votes.md §1.7"
  - ".rea-analysis/decoded/res/values/{strings,arrays,integers}.xml"
  - "changelog_1003 原文（Builds 1002-10xx）"
---

# 已完成投票 #8 — Repeat 按钮文案统一（idea 11）

> 投票原文：把含 "Advance Category" 的旧措辞换成
> *"Play One Song | Play Category | Play All Categories | Repeat Song | Repeat Category | Repeat All Categories"*。

## 0. 一句话结论

**已完成，且有一手证据**：`changelog_1003` 明写
> *"repeat mode improvements — ✅ another voted feature from the New Poweramp Features list —
> added new Play All Categories mode, which plays all categories and stops —
> added hints to shuffle/repeat popups — **updated wording for repeat modes/hints**"*

旧措辞 **"Advance Category" 在全部 31 个语言包中 0 命中**。

---

## 1. 六态模式表（本条的实体）

`res/values/arrays.xml:1014-1029` 是三个按下标严格对齐的数组：

| 下标 | 显示文案（`repeat_modes`） | 值（`repeat_modes_enum`） | 枚举整数 |
| ---: | --- | --- | ---: |
| 0 | `single_song` = **Play Single Song** | `SINGLE_SONG` | **4** |
| 1 | `play_one_cat` = **Play Category** | `REPEAT_NONE` | **0** |
| 2 | `play_all_cats` = **Play All Categories** | `REPEAT_ADVANCE_AND_STOP` | **5** |
| 3 | `repeat_song` = **Repeat Song** | `REPEAT_SONG` | **3** |
| 4 | `repeat_on` = **Repeat Category** | `REPEAT_ON` | **1** |
| 5 | `repeat_advance` = **Repeat All Categories** | `REPEAT_ADVANCE` | **2** |

> **注意枚举整数值不连续也不按显示顺序**（4,0,5,3,1,2）——
> 说明这 6 个常量是**历史上陆续加入**的，新增时取空号而非重排。
> 这与 idea 58（插入位置 `1,0,2`）是同一套兼容性策略。

### 1.1 与投票提议的逐项对照

| 投票提议 | 产物键 | 实际文案 | 结论 |
| --- | --- | --- | --- |
| Play One Song | `single_song` | Play Single Song | ✅ 等价（用词 Single 而非 One） |
| Play Category | `play_one_cat` | Play Category | ✅ 完全一致 |
| Play All Categories | `play_all_cats` | Play All Categories | ✅ 完全一致 |
| Repeat Song | `repeat_song` | Repeat Song | ✅ 完全一致 |
| Repeat Category | `repeat_on` | Repeat Category | ✅ 完全一致 |
| Repeat All Categories | `repeat_advance` | Repeat All Categories | ✅ 完全一致 |

**6/6 达成**。唯一偏差是 "One Song" → "Single Song"，属同义词替换。

---

## 2. 新增的第 6 态（投票未要求但 changelog 明写）

changelog 说 *"added new **Play All Categories** mode, which plays all categories and stops"*。

对比 `repeat_modes` 与 `repeat_modes_line2` 可见「停」与「循环」是**成对设计**：

| 播放范围 | 停止版 | 循环版 |
| --- | --- | --- |
| 单曲 | `play_single_song_and_pause` | `repeat_one_song` |
| 当前类别 | `play_cur_cat_and_stop` | `play_cur_cat_and_repeat` |
| 全部类别 | **`play_all_cats_and_stop`** | **`play_all_cats_and_repeat`** |

> `REPEAT_ADVANCE_AND_STOP`（值 5）就是那个**新增的第 6 态**——
> 它是"播放全部类别后停止"，与 `REPEAT_ADVANCE`（值 2，循环）互补。

---

## 3. 提示文案（changelog 的 "added hints to shuffle/repeat popups"）

`arrays.xml:1030-1045` 还有两个平行的数组，专供弹窗提示：

| 数组 | 用途 | 内容数 |
| --- | --- | ---: |
| `repeat_modes_line2` | 长按/悬浮提示第一行 | 6 |
| `repeat_modes_summary` | 摘要行 | 6 |

两组的顺序与 `repeat_modes_enum` **不完全一致**——`repeat_modes_summary` 的顺序是
`[play_cur_cat_and_stop, play_cur_cat_and_repeat, play_all_cats_and_repeat,
repeat_one_song, play_single_song_and_pause, play_all_cats]`，
与枚举顺序 `[4,0,5,3,1,2]` 不同，说明它按**另一套索引**取值。

---

## 4. 旧措辞清除的量化验证

对全部语言包做全量扫描：

| 旧措辞 | 命中总数 |
| --- | ---: |
| `Advance Category` | **0** |
| `Advance Cat` | **0** |
| `Play One Song` | **0** |
| `Play current category` | **0** |

> 不只是英文，**所有语言包都已清除**。这与 idea 55（术语统一）形成对比——
> 那一条只统一了主语言，中文/繁中/孟加拉仍有残留。本条做得更彻底。

---

## 5. 图标数组的对应关系

`arrays.xml:998-1013` 有两个图标数组，**顺序与文案数组不同**：

| 数组 | 顺序 |
| --- | --- |
| `repeat_icons_notif_24dp` | `repeat_alpha` / `repeat` / `repeat_advance` / `repeat_song` / `single_song` / `repeat_advance_stop` |
| `repeat_icons_reordered_32dp` | `single_song` / `repeat_none` / `repeat_advance_stop` / `repeat_song` / `repeat` / `repeat_advance` |

> `repeat_icons_reordered_32dp` 的名字带 **reordered**——说明作者曾因顺序不一致而专门做过一次重排。
> 这是该功能历史演进的痕迹。

---

## 6. 可借鉴 / 不建议照抄

### 6.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **三个数组按下标严格对齐**（文案/值/图标） | 新增一态只改三处 |
| A2 | **枚举取空号不重排**（4,0,5,3,1,2） | 老用户偏好值语义不变 |
| A3 | **"停止版/循环版"成对设计** | 6 个显示态覆盖 3×2 组合 |
| A4 | **changelog 直接标注投票来源**（✅ another voted feature） | 可追溯 |

### 6.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 枚举值不连续也不按显示顺序 | 阅读代码需查表 |
| N2 | `repeat_modes_summary` 与 `repeat_modes_enum` 顺序不同 | 需另一套索引，易错位 |
| N3 | 键名 `repeat_on` / `repeat_advance` 与文案 "Repeat Category" / "Repeat All Categories" 不同名 | 按文案搜不到键 |
| N4 | 图标数组有两个版本（其中之一名叫 reordered） | 历史遗留，易混用 |

---

## 7. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | `repeat_modes_summary` 使用的索引表 | 只知顺序与枚举不同，未定位其取值逻辑 |

> **本条是纯资源层改动**（与 idea 55 同类），没有运行期代码路径可继续逆向。
> 但它的资源结构比 idea 55 复杂——三个对齐数组 + 两个提示数组 + 两个图标数组 = **七组平行数组**，
> 这是本条的真正技术内容。

---

## 8. 证据索引

| 主题 | 位置 |
| --- | --- |
| 六态文案 | `res/values/arrays.xml:1014-1021`（`repeat_modes`） |
| 六态值 | `arrays.xml:1022-1029`（`repeat_modes_enum`） |
| 枚举整数 | `res/values/integers.xml`（`SINGLE_SONG`=4 / `REPEAT_NONE`=0 / `REPEAT_ADVANCE_AND_STOP`=5 / `REPEAT_SONG`=3 / `REPEAT_ON`=1 / `REPEAT_ADVANCE`=2） |
| 提示数组 | `arrays.xml:1030-1037`（`repeat_modes_line2`）、`:1038-1045`（`repeat_modes_summary`） |
| 图标数组 | `arrays.xml:998-1005`（notif）、`:1006-1013`（reordered_32dp） |
| 文案本体 | `res/values/strings.xml`（`single_song` / `play_one_cat` / `play_all_cats` / `repeat_song` / `repeat_on` / `repeat_advance`） |
| 官方记载 | `changelog_1003`（Builds 1002-10xx，"updated wording for repeat modes/hints"） |
| 旧措辞清零 | 全部 **31** 个语言包中 `Advance Category` 等 0 命中 |

> 口径：**build-1025**。
