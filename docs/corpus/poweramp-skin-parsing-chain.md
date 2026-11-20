---
doc_id: "ARCH-POWERAMP-SKIN-PARSING-CHAIN"
title: "插件系统（十二）：皮肤解析链 SkinInfo / SkinOption 与 overlap 应用"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/corpus/poweramp-skin-system.md（六）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/plugin/SkinInfo.smali"
---

# 插件系统（十二）：皮肤解析链 SkinInfo / SkinOption 与 overlap 应用

## 0. 一句话结论

第六篇只到"meta-data 发现"，本轮补齐**解析侧**：

| 类 | 行数 | 职责 |
| --- | ---: | --- |
| `plugin/SkinInfo` | **4572** | 皮肤解析主体（`<skin>` 及全部子元素） |
| `plugin/SkinOption` | 204 | **单个 `<option>`** 值对象 |
| `plugin/SkinMsg` | — | `<msg>` 说明文字 |
| `plugin/SkinSelectableSkinOptions` | — | `<radio>` / `<multiSwitch>` 的基类 |
| `preference/SkinRadioPreference` | — | 单选组 UI |
| `preference/SkinSwitchPreference` | — | 开关组 UI |
| `preference/SkinSwitchOptionPreference` | — | 单个开关项 UI |

---

## 1. ★ `SkinOption` 字段语义（`toString` 自己写明了）

`SkinInfo` 里 `overlapAttr` 解析后落到 `SkinOption`。其 `toString()`（`:106-160`）：

```smali
super.toString()
+ " key="            + A      // :119      // String
+ " name="           + В      // String
+ " overlapStyle=0x" + х      // :135      // int（资源 id）
+ " overlapAttr=0x"  + Х      // int（资源 id）
+ "  icon="          + у      // int
+ " "                + y      // plugin/у 对象
```

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `A` | `String` | **key** |
| `В` | `String` | **name** |
| `х` | `int` | **overlapStyle 资源 id**（`0` = 无） |
| `Х` | `int` | **overlapAttr 资源 id**（`0` = 无） |
| `у` | `int` | icon 资源 id |
| `y` | `plugin/у` | 附加对象 |
| `X` / `x` | `boolean` | 状态位 |
| `А` / `B` | `String` | summary 等文本 |

> **关键**：`overlapStyle` 与 `overlapAttr` 都是 **int 资源 id**，
> `0` 表示"该维度无覆盖"（对应 XML 里的 `overlapAttr=""`）。

### 1.1 `overlapAttr=""` 的真实含义

第六篇推测"空字符串 = 明确清除"。现在可以精确表述：

| XML 写法 | `SkinOption.Х` | 语义 |
| --- | ---: | --- |
| 属性缺失 | `0` | 无覆盖，不改变主题属性 |
| `overlapAttr=""` | （`getAttributeResourceValue` 返回 `0`） | **与缺失难以区分** |
| `overlapAttr="@attr/xxx"` | 该 attr 的 id | 应用该属性覆盖 |

> **订正第六篇的推测**：`""` 与"缺失"在 `getAttributeResourceValue` 面前**都返回 0**，
> 运行时无法区分。所谓"明确清除"在这个实现里**并不成立**——
> 二者都表示"无覆盖"。这是本轮的一处自我订正。

---

## 2. ★ 属性分派表（`SkinInfo` `:702-780`）

`SkinInfo` 用 **hashCode/equals 链**逐个识别属性名：

| sswitch | 属性名 | 内部分支号 |
| --- | --- | ---: |
| `_7` | `summary` | 1 |
| `_6` | `iconTint` | 2 |
| **`_5`** | **`overlapAttr`** | **3** |
| `_4` | `dependency` | 4 |
| `_3` | `key` | 5 |

> 分支号越小越先出现，但**属性匹配用 equals 链而非 packed-switch**，
> 顺序即代码出现顺序。

---

## 3. `SkinInfo` 的方法结构（4572 行）

| 方法 | 行 | 职责（★ = 本轮实证） |
| --- | ---: | --- |
| 方法 | 行 | 职责 |
| --- | ---: | --- |
| `<init>(I)` | 44 | 按类型构造 |
| `H(parser, I, SkinO...)` | 62 | 静态解析入口 |
| **`x(parser, res, String, ...)`** | **127** | **★ 解析 `msg` 元素**（`:3005` 调用） |
| **`K(parser, res, ZZ)`** | **620** | **★ 解析 `option` 元素**（`:3187` 调用） |
| `y(parser, res, I, Z)` | 1262 | 解析另一类元素（未在 `Н` 中调用） |
| `К(parser, res, ..., )` | 1519 | 含 `option` 判定，疑似单选项构造 |
| **`Н(parser, res, ..., )`** | **2166** | **★ 主分派器**（见下） |
| `у(parser, res, Z)` | 3271 | 解析另一类元素 |
| **`X(parser)`** | **1053** | **★ 解析 `globalOption`**（`:3164` 调用） |
| `х(pm, appInfo, ...)` | 3956 | 跨包解析入口（第六篇） |

> **六个平行的 `parser` 方法**（`x`/`y`/`К`/`Н`/`у`/`K`）分别处理不同的 XML 元素类型。
> 每个都是 500-1000 行，说明皮肤 XML 的结构相当复杂。


### 3.1 ★ `Н()` 是主分派器（`:2166-3271`，1105 行）

`Н()` 按元素 tag 分派到不同方法：

| tag 判定行 | 元素 | 处理 |
| ---: | --- | --- |
| `:2606` | `radio` | 内联构造（`v6 = 0`，走 `К` 系列） |
| `:2995` | `msg` | **调 `x()`**（`:3005`） |
| `:3024` | `multiSwitch` | 内联构造（`v6 = 3`） |
| `:3156` | `globalOption` | **调 `X()`**（`:3164`） |
| `:3179` | `option` | **调 `K()`**（`:3187`） |

> `radio` 与 `multiSwitch` **不调外部方法**，而是内联构造后走 `К`。
> 推测二者共用同一构造路径，只以 `v6`（0 vs 3）区分类型。

---

## 4. `overlap_*` 属性全集（`attrs.xml`，16 个）

| 属性 | 关联的 skin key（据命名推断） |
| --- | --- |
| `overlap_alt_layout` | `alt_layout` = 备选布局 1 |
| `overlap_alt_layout2` | `alt_layout` = 备选布局 2 |
| `overlap_track_labels_centered` | `track_labels_align` = centered |
| `overlap_track_labels_no_bg` | `labels_bg` = hidden |
| `overlap_player_buttons_no_bg` | `player_buttons_bg` = hidden |
| `overlap_less_rounding` | 圆角减弱的变体 |
| `overlap_more_buttons` | 更多按钮 |
| `overlap_plain_seekbar` | 简单进度条 |
| `overlap_light_buttons` | 浅色按钮 |
| `overlap_transparent_navbar` | 透明导航栏 |
| `overlap_navbar_offset` | 导航栏偏移 |
| `overlap_knobs_hilite_color` | 滑块高亮（彩色） |
| `overlap_knobs_hilite_mono` | 滑块高亮（单色） |
| `overlap_graphic_frs_color` | 可视化频谱着色 |
| `overlap_OptionRatingDisabled` | 评分禁用 |
| `overlap_OptionRatingStarsMenu` | 评分星标菜单 |

> **16 个属性全部与皮肤 XML 的 `overlapAttr` 引用一一对应**。
> 命名规则 `overlap_<含义>` 直观可读。

---

## 5. 完整皮肤链路（六 → 十二）

```
meta-data com.maxmpz.PowerampSkins（第六篇）
   ↓ bt/В.A() 读 int 资源 id
   ↓ SkinInfo.х(pm, appInfo, ...)  ← 本篇 :3956
   ↓ 解析 <skins><skin>
      ├─ <radio>       → SkinSelectableSkinOptions
      ├─ <multiSwitch> → SkinSelectableSkinOptions
      ├─ <option>      → SkinOption（overlapAttr/Style 资源 id）
      ├─ <msg>         → SkinMsg
      └─ <globalOption>→ 直接生效
   ↓ UI 层
      ├─ SkinRadioPreference        （单选）
      ├─ SkinSwitchPreference       （多选）
      └─ SkinSwitchOptionPreference （单项）
```

---

## 6. 可借鉴 / 不建议照抄

### 6.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **`toString` 自描述字段** | 调试时一眼看清，本轮就是靠它解出语义 |
| A2 | **overlap 用资源 id 而非字符串** | 编译期校验，避免拼写错误 |
| A3 | **`overlap_<含义>` 命名统一** | 16 个属性全部可读 |
| A4 | **按 XML 元素类型拆成 6 个 parser 方法** | 每个方法职责单一 |

### 6.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | `SkinInfo` 单类 4572 行 | 六个 parser 方法挤在一起 |
| N2 | 属性匹配用 equals 链而非 switch | 每加属性要改多行 |
| N3 | `overlapAttr=""` 与缺失**无法区分** | 无法表达"明确清除"语义 |
| N4 | `SkinOption` 字段名单字母（`A`/`В`/`Х`/`х`/`у`） | 必须靠 `toString` 反推 |

---

## 7. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~overlapAttr 叠加顺序~~ | ✅ **已闭合**（第二十篇）：`applyStyle(style, **true**)` 强制，**后处理者覆盖** |
| ~~Q2~~ | ~~六方法元素归属~~ | ✅ **已闭合**（§3.1）：`msg`→`x`、`option`→`K`、`globalOption`→`X`，`radio`/`multiSwitch` 内联 |
| ~~Q3~~ | ~~`plugin/у` 是什么~~ | ✅ **已闭合**（二十二）：Drawable 提供者，`В(String,SkinInfo)Drawable` |

---

## 8. 证据索引

| 主题 | 位置 |
| --- | --- |
| SkinInfo | `plugin/SkinInfo.smali`（4572 行） |
| 属性分派 | `SkinInfo.smali:702-780`（`summary`/`iconTint`/`overlapAttr`/`dependency`/`key`） |
| overlapStyle 常量 | `SkinInfo.smali:655` |
| overlapAttr 常量 | `SkinInfo.smali:735`、`:1085` |
| `<option>` 解析 | `SkinInfo.smali:620`（`K`） |
| 跨包入口 | `SkinInfo.smali:3956`（`х`） |
| SkinOption | `plugin/SkinOption.smali`（204 行） |
| 字段自证 | `SkinOption.smali:106-160`（`toString`） |
| overlap 属性全集 | `res/values/attrs.xml`（16 个 `overlap_*`） |
| 皮肤 UI 类 | `preference/SkinRadioPreference` / `SkinSwitchPreference` / `SkinSwitchOptionPreference` |
| 主分派器 | `SkinInfo.smali:2166-3271`（`Н`），tag 判定 `:2606`/`:2995`/`:3024`/`:3156`/`:3179` |
| 分派调用 | `x` `:3005`、`X` `:3164`、`K` `:3187` |

> 口径：**build-1025**。
