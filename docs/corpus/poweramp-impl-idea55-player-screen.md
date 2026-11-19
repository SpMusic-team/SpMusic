---
doc_id: "ARCH-POWERAMP-IMPL-IDEA55-PLAYER-SCREEN"
title: "已实现投票逐条逆向 #3：Consistently refer to Player Screen（idea 55）"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 2
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 继续逐条逆向已实现投票"
  - "docs/corpus/poweramp-feature-votes.md"
  - ".rea-analysis/decoded/res/values/strings.xml（2049 条英文文案）"
  - ".rea-analysis/decoded/res/values-*/strings.xml（全部语言包）"
---

# 已实现投票逐条逆向 #3：Consistently refer to Player Screen（idea 55）

> 投票原文：*"In Settings and elsewhere, the Player Screen is variously referred to as the
> 'Player User Interface', 'Player UI', or 'Main Screen'. Suggest 'Player Screen' be used consistently."*
> 15 票。

## 0. 一句话结论

**纯资源层改动，零代码逻辑。**但实现方式值得记录：**键名一个没改，只统一了显示值**。
共 8 条旧键名仍含 `main_screen` / `player_ui`，但**英文值已 100% 统一为 "Player Screen"**。

---

## 1. 量化验证：旧术语已从英文清零

对 `values/strings.xml` 全部 **2049 条**英文文案做全量统计：

| 术语 | 命中数 |
| --- | ---: |
| **Player Screen** | **19** |
| Player UI | **0** |
| Player User Interface | **0** |
| Main Screen | **0** |
| player screen（小写，句中） | 2 |

> 投票点名的三个旧术语在**英文资源里已彻底消失**，只剩 "Player Screen" 一种写法。
> 小写两处出现在 changelog 与一句确认文案里（`restore_player_buttons_q`），属正常句中用法。

---

## 2. 键名保留（兼容性设计）

### 2.1 8 条旧键名仍在用

| 键名 | 英文值 | 仍被引用处 |
| --- | --- | --- |
| `pref_main_screen` | Player Screen | `layout-sw2dp/merge_help_main.xml:6`、`arrays.xml:526/527` |
| `pref_main_screen_button` | Player Screen Button | `arrays.xml:527` |
| `pref_main_screen_and_main_menu` | Player Screen and Main Menu | `arrays.xml:529` |
| `pref_player_ui` | Player Screen | `xml/ui.xml:9`、`xml/ui_player.xml:2` |
| `pref_vis_on_main_screen` | Visualization On Player Screen | `xml/vis.xml:4` |
| `pref_summary_vis_on_main_screen` | Visualization can be switched on with Player Screen … | `xml/vis.xml:4` |
| `applied_on_main_screen` | Applied on the Player Screen | `xml/poweramp_builtin_skins.xml:22/60/89` |
| `skin_more_player_ui_opts_avail` | Use [Player Screen] and [Lyrics] options… | `xml/poweramp_builtin_skins.xml:12/79` |

**8 条全部仍有实际引用**（不是死键）。

### 2.2 为什么键名不改

```
pref_main_screen  = "Player Screen"      ← 键名说 main_screen，值说 Player Screen
pref_player_ui    = "Player Screen"      ← 两个键名指向同一个显示值
```

> 若同时改键名，会波及：
> 1. **设置搜索索引**（`pref_search` 表里存 `pref_key`）
> 2. **皮肤包**（`poweramp_builtin_skins.xml` 与第三方皮肤按 key 覆盖文案）
> 3. **翻译工程**（Crowdin 按 key 匹配）
>
> 只改值 = 零迁移成本。这是**纯展示层统一**的教科书做法。

### 2.3 但出现了一个副作用

`strings.xml` 里出现了**三条相邻的冗余键**：

```xml
pref_main_screen               = Player Screen
pref_main_screen_and_main_menu = Player Screen and Main Menu
pref_main_screen_button        = Player Screen Button
```

> 说明作者是**集中改了这一簇**（三条紧邻），且 `strings.xml` **并非按字母序排列**
> （全量校验：首个逆序出现在第 206 条 `l_lvl_response` > `l_apm_response`），
> 所以这簇相邻是**人为编辑痕迹**，不是排序结果。

---

## 3. 本轮发现的真实缺陷

### 3.1 明确的中文不一致（三种译法）

同样的英文 "Player Screen"，简中出现了 **3 种不同译法**：

| 键 | 英文 | 简中 | 译法 |
| --- | --- | --- | --- |
| `pref_main_screen` | Player Screen | **主界面** | A |
| `pref_player_ui` | Player Screen | **播放器界面** | B |
| `pref_main_screen_button` | Player Screen Button | **主屏幕按钮** | C |
| `pref_vis_on_main_screen` | Visualization On Player Screen | **主屏幕显示可视化** | C |
| `pref_main_screen_and_main_menu` | Player Screen and Main Menu | 主界面与主菜单 | A |
| `skin_more_player_ui_opts_avail` | …Player UI… | **播放器界面** | B |

全量统计：简中出现 **「播放器界面」3 次**、**「主界面」5 次**。

> ⇒ **英文统一了，中文没跟着统一**。这条投票只处理了英文（en 为主语言），
> 中文翻译层仍保留旧术语的音译痕迹（"主界面"/"主屏幕" ← 旧词 Main Screen）。

### 3.2 繁体与孟加拉语残留旧词

全语言扫描发现 **2 个语言包仍在正文里出现 "Player UI"**：

| 语言 | 键 | 行 |
| --- | --- | ---: |
| `values-zh-rTW`（繁中） | `skin_more_player_ui_opts_avail` | `:1757` |
| `values-bn`（孟加拉） | `skin_more_player_ui_opts_avail` | `:1737` |

两处都是同一键，且旧词出现在**可点击链接文本**里：

```xml
<!-- zh-rTW -->
"使用 <a href='settings/ui_player#hide_menu'>Player UI</a> 和 …"
```

> 这说明**该键的翻译是在英文改词之前导出的**，未被同步更新。
> 另外 "Player User Interface" 与 "Main Screen" 在**所有语言包中均为 0 命中**——
> 那两种写法已彻底清除。

---

## 4. 与"皮肤系统"的关系

8 条旧键名中有 2 条被 `poweramp_builtin_skins.xml` 引用：

| 键 | 引用位置 | 作用 |
| --- | --- | --- |
| `applied_on_main_screen` | `:22 / :60 / :89` | 三个内置皮肤各自说明"已应用到播放界面" |
| `skin_more_player_ui_opts_avail` | `:12 / :79` | 提示还有更多界面选项可在别处调 |

> 皮肤 XML 用 `@string/` 引用文案，**所以改值即可全皮肤生效**，不必改任何皮肤包。
> 这也是"只改值"的另一个理由。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **只统一显示值，不动键名** | 搜索索引/皮肤/翻译工程零迁移 |
| A2 | **集中编辑同一簇键** | 三条相邻便于一次改完，降低遗漏 |
| A3 | 用**可量化的清零验证**（旧词命中数 → 0） | 比"抽查几个"更可信 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 只统一主语言，未同步翻译 | 简中出现 **3 种译法**（主界面/播放器界面/主屏幕） |
| N2 | 遗留两条同义键（`pref_main_screen` 与 `pref_player_ui`） | 语义重复，后续易误用 |
| N3 | 部分语言包未回归 | 繁中/孟加拉仍有 "Player UI" |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | 简中三种译法是**翻译未同步**还是**刻意区分语境** | 英文同词同义（都指 Player Screen），倾向前者；但无翻译工程记录可证 |
| Q2 | 繁中/孟加拉的 "Player UI" 是否为**上游 Crowdin 未回归** | 只知本 build 未更新，无法判断是否在更高版本修复 |

> **本条是"已实现"项里唯一没有运行期行为的**——没有可 weiter 逆向的代码路径。
> 到此为止不是能力不足，而是**这条改动本身就只有资源层**。

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| 旧术语清零统计 | `values/strings.xml` 全量 2049 条（Player UI / Player User Interface / Main Screen 均 0） |
| 8 条旧键名 | `values/strings.xml`（键名含 main_screen / player_ui） |
| 键名引用 | `xml/ui.xml:9`、`xml/ui_player.xml:2`、`xml/vis.xml:4`、`layout-sw2dp/merge_help_main.xml:6`、`values/arrays.xml:526-529`、`xml/poweramp_builtin_skins.xml:12/22/60/79/89` |
| 简中三译法 | `values-zh-rCN/strings.xml`（主界面 5 次 / 播放器界面 3 次） |
| 繁中残留 | `values-zh-rTW/strings.xml:1757` |
| 孟加拉残留 | `values-bn/strings.xml:1737` |
| 非字母序证据 | `values/strings.xml` 首个逆序 `l_lvl_response` > `l_apm_response`（第 206 条） |

> 口径：**build-1025** 解包资源。
