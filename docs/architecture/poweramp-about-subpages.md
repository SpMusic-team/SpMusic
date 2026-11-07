---
doc_id: "ARCH-POWERAMP-ABOUT-SUBPAGES"
title: "Poweramp「设置 → 关于」子页完整实现（feature_packages / translations）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1035-bundle-play (versionCode 1035009)"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - ".rea-analysis/v1035/decoded/res/xml/feature_packages.xml"
  - ".rea-analysis/v1035/decoded/res/xml/translations.xml"
  - ".rea-analysis/v1035/decoded/res/xml/general.xml"
  - ".rea-analysis/v1035/decoded/res/xml/singlepane.xml"
  - ".rea-analysis/v1035/decoded/res/xml/ui_notify.xml"
  - ".rea-analysis/v1035/decoded/res/xml/ui_player.xml"
  - ".rea-analysis/v1035/decoded/res/layout/settings_feature_pak_list_button.xml"
  - ".rea-analysis/v1035/decoded/res/layout/settings_feature_pak_vote_button.xml"
  - ".rea-analysis/v1035/decoded/res/layout/preference_feature_pak.xml"
  - ".rea-analysis/v1035/decoded/res/drawable/settings_feature_pak_background.xml"
  - ".rea-analysis/v1035/decoded/res/values/public.xml"
  - ".rea-analysis/v1035/decoded/res/values/strings.xml"
  - ".rea-analysis/v1035/decoded/res/values/attrs.xml"
  - ".rea-analysis/v1035/decoded/res/values/styles.xml"
  - ".rea-analysis/v1035/decoded/res/values/integers.xml"
  - ".rea-analysis/v1035/decoded/smali/ׅ/p91.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/b71.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/n91.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/z61.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/u61.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/qt0.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/nr0.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/x11.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/tc.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/wr.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/go0.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/b9.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/PrefBase.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/BuyPrefBase.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/FeaturePackPref.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/FeaturePackRedirectPref.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/BuyUberPref.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/UberLevelPref.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RestoreFeaturePackPurchasePref.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/BaseRestoreFvPurchasePref.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RawTextPreference.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/MultilineSwitchPreference.smali"
  - "docs/architecture/poweramp-about-and-support-settings.md"
  - "docs/architecture/poweramp-settings-page-runtime.md"
---

# Poweramp「设置 → 关于」子页完整实现（feature_packages / translations）

> **证据分级**
> - 【实证·原文】= XML / 资源原文（`res/` 下文件）
> - 【实证·产物】= apktool 反编译 smali 产物，**必附 `相对路径:起止行`**
> - 【推断】= 无直接代码佐证的语义推断
>
> 全部结论基于 **build-1035-bundle-play**（`versionCode 1035009`）。
>
> **包名码位**：混淆包在**目录名**与**全部 smali 类描述符**中都是 `ׅ`（**U+05C5**，HEBREW ACCENT LOWER DOT）。
> 本 build 全树 U+05C5 出现 162782 次；`讌`(U+8B8C)/`諌`(U+8ACC)/`謌`(U+8B0C) 各 **0** 次。
> 本文所有路径写作 `smali/ׅ/xxx.smali`，其中 `ׅ` = U+05C5。
>
> **共享机制不重述**：三层骨架（`u61` PreferenceFragment → `n91` 基类 → 页面 helper）、`n91` 字段契约、`h()`/`i()` 移除、`qt0` styleable 网关、`u9.х()` 的 `skipSearch` 判定一律见
> `poweramp-settings-page-runtime.md` 与 `poweramp-about-and-support-settings.md`。本文只写**这两页自己的**东西，并显式列出与既有文档的差异（§1.2）。

---

## 0. 一句话结论

`feature_packages` 与 `translations` 是「关于」根页 `general` 的**两个直接子页**，也是整棵设置树里**唯一一对「叶子页 + 极端倒挂」的组合**：

- **`feature_packages`（2618 B / 19 行 / 15 元素 / 6 key）配专用 helper `p91`（2618 B / 129 行）**——XML 与代码**字节数完全相同**（2618 = 2618，纯属巧合但成立），比例 **1 : 1.0**。它是全 App **最小的专用 helper**，却承担了最重的商业逻辑（内购、Uberpatron 徽章、恢复购买、`fp1` 在「设置根页 ↔ 关于页」之间的运行时迁移）。
- **`translations`（4913 B / 36 行 / 32 元素 / 1 key）没有自己的 helper**，只占用通用分派器 `z61` 的 **`pswitch_3` 一个分支（`z61.smali:2133-2173`，41 行 / 946 字节）= `z61` 全类的 0.8%**。29 个语言行**完全不可交互**，整页的全部行为是「给 1 个条目绑 1 个 URL」。

**两页都不是「小页面」，而是「内容型页面」与「交易型页面」在同一套框架下的两个极端解**：一个把代码写成"零"（塞进通用分派器），一个把 XML 写成"零"（全部由代码装配）。而它们的**共同点**是——**都不深挖**：两页 `w:target` 计数均为 **0**，是货真价实的**叶子页**。

---

## 1. 文档定位与与既有文档的差异

### 1.1 引用契约

| 主题 | 归属文档 | 本文的关系 |
| --- | --- | --- |
| 三层骨架 / `u61` 分发表机制 | `poweramp-settings-page-runtime.md` | 只引用 `u61` 的三处分发行号，不重推机制 |
| `general` 根页 18 元素 / `r91` | `poweramp-about-and-support-settings.md` §3 | 只引用其 `w:target` 两条出边 |
| `support`（`xa1`）/ `commands_history`（`o91`） | 同上 §4 / §5 | **非本分支**（二者是 `singlepane.xml` 的独立入口，不在 `general` 子树）；本文仅在对照时标注 |
| `translations` 页 32 元素 | 同上 §6.2 | 本文**核实为 32，与既有文档一致**；本文补 `z61` 索引完整对照表与 `R()` 机制 |
| `feature_packages` 页 | 同上 §14「待补」 | **本文即该「待补」项**，首次成文 |
| `w:skipSearch` 判定 `u9.х()` | 同上 §8 | 只引用结论，不做重推 |
| `PrefBase` / `RawTextPreference` 渲染框架 | `poweramp-settings-page-runtime.md` | 只引用本文实际命中的钩子行号 |

### 1.2 与 `poweramp-about-and-support-settings.md` 的差异（勘误表）

本文实测与既有文档的**四类差异**，逐一列出：

| # | 既有文档口径 | 本文实测 | 类型 |
| ---: | --- | --- | --- |
| 1 | §14「`feature_packages` 页（`p91`，2618 B，最小专用 helper）→ **待补**」 | 本文补齐（§3） | **补空白** |
| 2 | §7.1 四页对照表**不含** `feature_packages` | 本文给出两页的完整对照（§6） | **补空白** |
| 3 | §2.2 / §7.1 记「`p91` 属 `n91` 派生」 | `p91.super = **b71**`，`b71.super = n91`（`p91.smali:2`、`b71.smali:2`）。**`p91` 比 `general` 的 `r91` 多一层 `b71`** | **勘误（深化）** |
| 4 | §6.2「32 个元素」 | **核实为 32，正确**。误差点为「**36 行 ≠ 32 元素**」：4 行是 XML 声明 + 根标签跨行 + 两个闭合标签 | **核实通过** |
| 5 | §6.4「`translations` 索引 `0x10` → `pswitch_3`」 | **核实通过**（`u61.smali:1612` / `z61.smali:2133`） | **核实通过** |
| 6 | §6.4 表把 `0x7f16002f` 记作 `ui` | **`0x7f16002a` = `ui`，`0x7f16002f` = `ui_player`**（`public.xml` 实测，见 §5.3） | **勘误** |
| 7 | §6.4 表只有 20 个 case，未含 `0x14` | `z61` 共计 **21 个实例化点**：索引 `0x00`–`0x13` 有 `pswitch` 分支，**`0x14`（`ui_player`）落 default 块** | **扩容** |
| 8 | §8.3「`visit_site_about` 的 `"play,huawei"` 在 huawei 版跳过」 | `u9.х()` 只认 `"play"` 与 `"pa"`（`u9.smali:539`/`:555`），**无 `"huawei"` 分支** ⇒ huawei / uni 版**均不跳过**。`"huawei"` 是死值 | **勘误（影响 §8.3）** |

> **对第 8 条的影响范围**：仅影响 `general.xml:15` 的 `visit_site_about`。本文涉及的两处 `skipSearch` **不受影响**：
> - `translations.xml:2` 的**根节点** `"true"` 走**布尔短路**（`type == 0x12` → `getBoolean` → 直接 true），与 token 无关；
> - `feature_packages.xml:11` 的 `fp1` 条目也是布尔 `"true"`。

### 1.3 计数口径

| 口径 | 定义 |
| --- | --- |
| **行数** | 文件实际行数（`splitlines()`），含 XML 声明行与独占一行的闭合标签 |
| **元素数** | ElementTree 遍历得到的**元素节点总数，含根节点**（不把 `<?xml?>` 计为元素） |
| **key 数** | `android:key` 属性的出现次数（不是"有状态 key"数） |
| **有效代码** | 落在该页 `pswitch` 分支内的 smali 行数（含空行与 `.line` 伪指令），即"该页占用的 helper 区间" |

---

## 2. 两页身份总表

### 2.1 身份

| | `feature_packages` | `translations` |
| --- | --- | --- |
| XML 路径 | `res/xml/feature_packages.xml` | `res/xml/translations.xml` |
| 字节 / 行 | **2618 B / 19 行**【实证·原文】 | **4913 B / 36 行**【实证·原文】 |
| 资源 id | **`0x7f160013`**【实证·原文】`public.xml` | **`0x7f160029`**【实证·原文】`public.xml` |
| 根节点 | `<PreferenceScreen android:title="@string/feature_packages">` | `<PreferenceScreen android:title="@string/pref_translations" **w:skipSearch="true"**>` |
| 根节点 `skipSearch` | **无** | **`"true"`** ⇒ 整份 XML 不进搜索索引 |
| 元素总数 | **15**（含根） | **32**（含根） |
| `android:key` | **6** | **1** |
| `w:target` | **0** | **0** |
| `<intent>` | **0** | **0** |
| helper | **`ׅ/p91`（专用）**，2618 B / 129 行 | **`ׅ/z61`（通用分派器）**，118199 B / 4866 行 |
| 该页占用 helper 的行 | **129 / 129 = 100%**（整个类） | **41 行**（`z61.smali:2133-2173`）= **0.8%** |
| XML : 代码字节比 | **1 : 1.0** | **1 : 24.1**（有效代码 **1 : 0.19**） |
| 运行期新增条目 | **0** | **0** |
| 运行期移除条目 | **若干**（`fp1` 已购自删 / `restore_purchase` 版本门自删 / `isPriceReduced` 条件删） | **0** |
| `restore_defaults` | **无** | **无** |

### 2.2 从 `general` 下钻的两条边

【实证·原文】`res/xml/general.xml:5` 与 `:18`：

```xml
5:  <...FeaturePackRedirectPref android:icon="?settings_pak" android:title="@string/feature_packages" android:key="feature_packages" android:summary="@string/summary_feature_packages" w:target="feature_packages" />
18: <...RedirectPreference      android:title="@string/pref_translations" android:key="translations" w:target="translations" />
```

- `general` 页使用**两个不同的 Redirect 子类**：`feature_packages` 用 `FeaturePackRedirectPref`（因为它需要 `w:removeAsNeeded` 自删），`translations` 用基类 `RedirectPreference`。
- 注意 `general.xml:5` **不带** `w:removeAsNeeded`（对照 `singlepane.xml:12` **带**）——同一个类在两页行为不同，见 §3.10。

### 2.3 叶子页确认（零出边）

【实证·原文】两页 XML 内 `w:target` 出现次数：

| 页面 | `w:target` | `android:key` | `<intent>` | `PreferenceCategory` |
| --- | ---: | ---: | :---: | ---: |
| `feature_packages.xml` | **0** | 6 | 否 | 1（开+闭共 2 行） |
| `translations.xml` | **0** | 1 | 否 | 1（开+闭共 2 行） |

> **结论**：两页都是**叶子页**。完整子树形状：
>
> ```
> singlepane (0x7f160026)
>   └─ general (0x7f160014, r91)
>        ├─ feature_packages (0x7f160013, p91)   ← 叶
>        └─ translations     (0x7f160029, z61)   ← 叶
> ```
>
> `support`（`0x7f160028`）与 `commands_history`（`0x7f160011`）**不在这棵子树里**——它们是 `singlepane.xml:27` 与 `commands_history` 的父页 `headset` 的独立入口，**非本分支**。

### 2.4 分发表入口（三处）

【实证·产物】`smali/ׅ/u61.smali`（`u61.onCreate` = `:90-1881`）：

| XML id | 页面 | `const` 行 | `if-ne` 行 | `new-instance` 行 | `invoke` 行 | 父类构造 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `0x7f160014` | `general` | **434** | 439 | **443** | 447 | `Lׅ/n91;-><init>` |
| **`0x7f160013`** | **`feature_packages`** | **512** | 517 | **521** | **525** | **`Lׅ/b71;-><init>`** |
| **`0x7f160029`** | **`translations`** | **1599** | 1604 | **1608** | **1624** | `Lׅ/z61;-><init>`（`invoke-direct/range`，6 参） |

`feature_packages` 分支原文【实证·产物】`smali/ׅ/u61.smali:511-530`（节选 4 行）：

```asm
512:     const v10, 0x7f160013
517:     if-ne v3, v10, :cond_9
521:     new-instance v0, Lׅ/p91;
525:     invoke-direct {v0, v1, p0, v3, v4}, Lׅ/b71;-><init>(Landroid/...SettingsActivity;Lׅ/u61;II)V
```

`translations` 分支原文【实证·产物】`smali/ׅ/u61.smali:1599-1624`（节选 4 行）：

```asm
1599:    const v0, 0x7f160029
1612:    const/16 v5, 0x10            ; ★ z61 第 5 参 = 页索引 16
1616:    const v4, 0x7f160014         ; ★ 第 4 参 = **父页 id**（general），不是本页 id
1624:    invoke-direct/range {v0 .. v5}, Lׅ/z61;-><init>(...SettingsActivity;Lׅ/m91;III)V
```

> **`v4 = 0x7f160014` 的正确读法**：`n91.<init>(SettingsActivity, m91, int, int)` 的第 3 参（`p3`）写进 `n91.y`、第 4 参（`p4`）写进 **`n91.C`**【实证·产物】`n91.smali:249` / `:253`。
> `n91.C` 的唯一读取点 `n91.smali:3390`（`n91.р()`）把它转成 `Resources.getResourceEntryName(int)`，即**父页的 XML 资源名**；该值用于页面面包屑/返回栈标签。
> 所以 `:1616` 的 `0x7f160014` 是「**translations 的父页是 general**」，**不是**「这分支在处理 general」。

---

## 3. `feature_packages` 页

### 3.1 页面身份

| | |
| --- | --- |
| XML | `res/xml/feature_packages.xml`，**2618 字节 / 19 行**【实证·原文】 |
| 资源 id | **`0x7f160013`** |
| 根节点 | `<PreferenceScreen android:title="@string/feature_packages">`，**无** `skipSearch` |
| 页面标题 | `@string/feature_packages` = **"Feature Packages"**（`strings.xml:442`） |
| 元素 / key | **15 / 6** |
| 属性总览 | `android:icon`×11、`w:line1`×8、`android:key`×6、`w:reducedPad`×5、`android:title`×4、`android:widgetLayout`×2、`w:zeroTopPad`×2、`w:skipSearch`×1、`w:buttonOnly`×1、`android:persistent`×1、`android:summary`×1、`android:defaultValue`×1、`w:line2`×1、`w:line3`×1、`w:singleNewline`×1 |
| helper | **`ׅ/p91`（专用）**，2618 B / 129 行，`.super Lׅ/b71` |
| **有效代码** | **129 行 = 全类 100%**（页面逻辑与类物理边界完全重合） |
| `w:target` | **0**（叶子页） |

### 3.2 19 行 / 15 元素逐条实证

按 XML 物理顺序。`#` 为元素序号（只数元素节点，不数 `<?xml?>` 与闭合标签）。

| 行 | # | 控件类 | key | 文案实文 | icon | 其他属性 |
| ---: | ---: | --- | --- | --- | --- | --- |
| 1 | — | *(`<?xml version="1.0" encoding="utf-8"?>`)* | — | — | — | 非元素 |
| 2–3 | **1** | `PreferenceScreen` | — | `@string/feature_packages` = **Feature Packages** | — | 根节点，**无 `skipSearch`**（两行跨行写 xmlns） |
| 4 | **2** | `RawTextPreference` | — | `w:line1=@string/fp1_line1` | `@drawable/box_badge_32dp` | `w:reducedPad="true"` |
| 5 | **3** | `RawTextPreference` | — | `w:line1=@string/list_of_features` | `@drawable/list_badge_32dp` | **`android:widgetLayout=@layout/settings_feature_pak_list_button`** |
| 6 | **4** | `RawTextPreference` | — | `w:line1=@string/fp_request_and_vote_on_forum` | `@drawable/vote_badge_32dp` | **`android:widgetLayout=@layout/settings_feature_pak_vote_button`** |
| 7 | **5** | `RawTextPreference` | — | `w:line1=@string/fp1_line2` | `@drawable/grow_badge_32dp` | `w:reducedPad="true"` |
| 8 | **6** | `RawTextPreference` | — | `w:line1=@string/fp1_line3` | `@drawable/code_badge_32dp` | `w:reducedPad="true"` |
| 9 | **7** | `RawTextPreference` | — | `w:line1=@string/fp1_line4` | `@drawable/one_badge_32dp` | `w:reducedPad="true"` |
| 10 | **8** | `RawTextPreference` | **`isPriceReduced`** | `w:line1=@string/fp1_line5` | `@drawable/percent_badge_32dp` | `w:reducedPad="true"` |
| 11 | **9** | `FeaturePackPref` | **`fp1`** | *（无 title；运行时由 ctor 写入）* | — | **`w:skipSearch="true"`**、**`w:buttonOnly="true"`** |
| 12 | **10** | `MultilineSwitchPreference` | **`move_fp1_to_about`** | *（无 title）*，summary = `@string/hide_fp_in_settings` | — | **`android:persistent="true"`**、**`android:defaultValue="false"`** |
| 13 | **11** | `PreferenceCategory` | — | `@string/other` = **Other** | — | 分类容器（开） |
| 14 | **12** | `BuyUberPref` | **`buy_uber_badges`** | `@string/buy_uber_badges` = **Buy Uberpatron Badges** | `@drawable/settings_uberpatron_colored` | — |
| 15 | **13** | `UberLevelPref` | **`uber_level`** | *（无 title）* | `@drawable/transparent_nothing` | `w:zeroTopPad="true"` |
| 16 | **14** | `RawTextPreference` | — | `w:line1/line2/line3` = `@string/uber_support1/2/3` | `@drawable/transparent_nothing` | **`w:singleNewline="true"`**、`w:zeroTopPad="true"` |
| 17 | — | *(`</PreferenceCategory>`)* | — | — | — | 闭合 |
| 18 | **15** | `RestoreFeaturePackPurchasePref` | **`restore_purchase`** | `@string/restore_purchases` = **Restore Purchases** | `@drawable/settings_restore_purchase_colored` | — |
| 19 | — | *(`</PreferenceScreen>`)* | — | — | — | 闭合 |

**元素统计（ElementTree 实测）**：

| 类 | 个数 |
| --- | ---: |
| `com.maxmpz.audioplayer.preference.RawTextPreference` | **8** |
| `PreferenceScreen` | 1 |
| `FeaturePackPref` | 1 |
| `MultilineSwitchPreference` | 1 |
| `PreferenceCategory` | 1 |
| `BuyUberPref` | 1 |
| `UberLevelPref` | 1 |
| `RestoreFeaturePackPurchasePref` | 1 |
| **合计** | **15** |

> **任务书说的「7 个带 icon 的 `RawTextPreference`」精确成立**：7 个在上半区（`box/list/vote/grow/code/one/percent_badge_32dp`），
> 第 **8** 个 `RawTextPreference` 在 `other` 分类里（L16，icon = `transparent_nothing`，三行说明块）。
> `android:icon` 共 **11** 次 = 7（上半区）+ 1（三行说明）+ `BuyUberPref` + `UberLevelPref` + `RestoreFeaturePackPurchasePref`。

**6 个 key 全表**：

| key | 声明行 | 控件类 | 是否持久化 |
| --- | ---: | --- | --- |
| `isPriceReduced` | 10 | `RawTextPreference` | **否**（无 `persistent`，但它自己是**展示型**，见 §3.4） |
| `fp1` | 11 | `FeaturePackPref` | 否（无 `persistent`） |
| **`move_fp1_to_about`** | 12 | `MultilineSwitchPreference` | **是**（`android:persistent="true"` + `defaultValue="false"`） |
| `buy_uber_badges` | 14 | `BuyUberPref` | 否 |
| `uber_level` | 15 | `UberLevelPref` | 否 |
| `restore_purchase` | 18 | `RestoreFeaturePackPurchasePref` | 否 |

> **全页只有 1 个真正落盘的 key**：`move_fp1_to_about`。其余 5 个 key 只用来 `findPreference` 定位，不写 `"global"`。

### 3.3 全部 `@string` 英文实文 + 行号

【实证·原文】`res/values/strings.xml`（202796 字节 / 2183 行）。

**来自 `feature_packages.xml` 的 15 条**：

| # | 资源名 | 英文实文 | 声明行 |
| ---: | --- | --- | ---: |
| 1 | `feature_packages` | `Feature Packages` | **442** |
| 2 | `fp1_line1` | `a number of upgrades, new cool features, and options in a single package` | **473** |
| 3 | `list_of_features` | `list of the included features` | **688** |
| 4 | `fp_request_and_vote_on_forum` | `request and vote for the next package features on the Poweramp forum` | **479** |
| 5 | `fp1_line2` | `the same package gets even more features in the subsequent updates` | **474** |
| 6 | `fp1_line3` | `packages allow us to continue Poweramp development` | **475** |
| 7 | `fp1_line4` | `one time package purchase, instead of a 🤢 subscription` | **476** |
| 8 | `fp1_line5` | `a discounted, minimal price, if you recently purchased Full Version` | **477** |
| 9 | `hide_fp_in_settings` | `Hide Feature Packages from the Settings top` | **569** |
| 10 | `other` | `Other` | **859** |
| 11 | `buy_uber_badges` | `Buy Uberpatron Badges` | **180** |
| 12 | `uber_support1` | `● support Poweramp development` | **2105** |
| 13 | `uber_support2` | `● get Uberpatron Edition Badges` | **2106** |
| 14 | `uber_support3` | `● currently these are purely cosmetic items` | **2107** |
| 15 | `restore_purchases` | `Restore Purchases` | **1801** |

**来自两个 `widgetLayout` 的 5 条**（见 §3.9）：

| # | 资源名 | 英文实文 | 声明行 |
| ---: | --- | --- | ---: |
| 16 | `changelog` | `Changelog` | **247** |
| 17 | `pref_poweramp_forum` | `Forum` | **1314** |
| 18 | `forum_url` | `https://forum.powerampapp.com/` | **470** |
| 19 | `external_link` | `External Link` | **414** |
| 20 | `external_link_msg` | `The link will be opened in the browser/another app` | **415** |

**来自 `FeaturePackPref` 构造函数（非 XML）的 2 条**（见 §3.6.2）：

| # | 资源名 | 英文实文 | 声明行 | 引用点 |
| ---: | --- | --- | ---: | --- |
| 21 | `intro_feat_paks` | `🎁 Feature Packages` | **629** | `FeaturePackPref.smali:36` |
| 22 | `buy_feature_pak_1` | `Buy Feature Package #1` | **176** | `FeaturePackPref.smali:59` |

**`w:line1..line3` 的 attr 声明**【实证·原文】：

```
attrs.xml:1557  <attr name="line1" format="string" />
attrs.xml:1558  <attr name="line2" format="string" />
attrs.xml:1559  <attr name="line3" format="string" />
```

**其余被本页用到的 attr 声明**：

| attr | 声明行 | format |
| --- | ---: | --- |
| `skipSearch` | 1844 | `string|boolean` |
| `singleNewline` | 2199 | `boolean` |
| `buttonOnly` | 2621 | `boolean` |
| `keepPaddings` | 2811 | `boolean` |
| `reducedPad` | 2919 | `boolean` |
| `zeroBottomPad` | 2920 | `boolean` |
| `zeroTopPad` | 2921 | `boolean` |
| `removeAsNeeded` | 2931 | `boolean` |

### 3.4 `smali/ׅ/p91.smali`（2618 B / 129 行）完整解析

**类身份**【实证·产物】`p91.smali:1-3`：

```asm
1: .class public final Lׅ/p91;
2: .super Lׅ/b71;
3: .source "_";
```

**方法全表（只有 3 个方法）**：

| 方法 | 行区间 | 行数 | 角色 |
| --- | ---: | ---: | --- |
| `Q()V` | **7–67** | 61 | **页面装配主函数**（`b71` 的抽象钩子实现） |
| `onBusMsg(MsgBus;IIIObject;)V` | **69–94** | 26 | 总线监听（只认 1 个消息） |
| `Х()V` | **96–129** | 34 | 页面销毁钩子覆写（改 `BaseApplication.P` 的入参） |

> **为什么只有 129 行**：`p91` 的**全部父类工作已被 `b71` 吃掉**。
> `b71`（24273 B / 1460 行，`.super Lׅ/n91`）已经提供了：`LinkedHashMap` 缓存（`b71.smali:45`）、`ix` 防抖 Runnable（`:62`）、
> 抽象 `Q()`（`:937`，声明为 abstract 供子类实现）、`R()`（`:940`，250 ms 合并 + 调 `Q()`）、`S()`（`:99`，防抖调度器，**21 处调用**）、
> `v()`（`:1313`，`J()`→`x()`/`T()`+`S(7)` 的装配编排）、`у()`（`:1415`，取消回调 + `super`）。
> `p91` 只需实现 `Q()` 一个方法——**这就是 129 行的由来**。

#### 3.4.1 `Q()` —— 页面装配（`p91.smali:7-67`）

三段结构。

**段 1：给 `move_fp1_to_about` 绑变更监听（`:11-39`）**

```asm
11:     const-string v0, "move_fp1_to_about"
15:     iget-object v1, p0, Lׅ/n91;->K:Landroid/preference/PreferenceScreen;
19:     invoke-virtual {v1, v0}, Landroid/preference/PreferenceGroup;->findPreference(...)
27:     new-instance v1, Lׅ/tc;
31:     const/4 v2, 0x5                     ; ★ tc 的 index = 5
34:     invoke-direct {v1, v2, p0}, Lׅ/tc;-><init>(ILjava/lang/Object;)V
39:     invoke-virtual {v0, v1}, Landroid/preference/Preference;->setOnPreferenceChangeListener(...)
```

`tc` index `5` → `:pswitch_4`【实证·产物】`tc.smali:554-573`：

```asm
554:    :pswitch_4
555:    check-cast v4, Lׅ/p91;               ; ★ 强转成 p91，确认 index 5 专属本页
559:    iget-object p1, v4, Lׅ/n91;->р:Lcom/maxmpz/widget/MsgBus;
563:    const p2, 0x7f0d0530                 ; ★ cmd_app_feature_pak_settings_refresh
568:    invoke-interface {p1, p2, v2, v2, v1}, Lcom/maxmpz/widget/MsgBus;->post(IIILjava/lang/Object;)V
573:    return v3                            ; 返回 true = 接受变更
```

> **`move_fp1_to_about` 一旦被切换，就向 `bus_app_cmd`（`n91.р`）广播 `0x7f0d0530`**。
> `n91.р` 的来源【实证·产物】`n91.smali:311-328`：`const p4, 0x7f0d015c` → `MsgBusHelper.fromContextOrThrow` → `iput n91.р` → `subscribe(p0)`。
> `0x7f0d015c` = **`id/bus_app_cmd`**【实证·原文】`public.xml`。
> 这是 §3.10 的运行时迁移机制的**上半段**。

**段 2：条件删除 `isPriceReduced`（`:44-60`）**

```asm
44:     sget-object v0, Lׅ/go0;->k:Lׅ/go0;
48:     iget-boolean v0, v0, Lׅ/b9;->Н:Z      ; 内购状态位
52:     if-nez v0, :cond_0
56:     const-string v0, "isPriceReduced"
60:     invoke-virtual {p0, v0}, Lׅ/n91;->h(Ljava/lang/String;)V   ; ← 移除条目
```

`n91.h(String)`【实证·产物】`n91.smali:1689-1716`：

```asm
1689: .method public final h(Ljava/lang/String;)V
1693:     iget-object v0, p0, Lׅ/n91;->K:Landroid/preference/PreferenceScreen;
1697:     invoke-virtual {v0, p1}, PreferenceGroup;->findPreference(...)
1705:     if-eqz p1, :cond_0
1709:     invoke-virtual {v0, p1}, PreferenceGroup;->removePreference(...)   ; 瞬时移除，无动画
```

> **语义**：`go0.k`（`go0.smali:7` 声明的单例 `Lׅ/go0;`，`clinit` 在 `:53` 构造）是**内购控制器**；
> `b9.Н`（`b9.smali:50` 声明 `.field public Н:Z`）是它的一个布尔状态位。
> **【推断】** 结合 `FeaturePackPref.smali:388` 把 `b9.Н` 存进 `FeaturePackPref.D` 的用法，`Н` 应表示「**已购买 Feature Pack #1 / 不再是优惠价**」。
> 于是段 2 的效果是：**已经买过的人看不到「折扣价」那一行**（`isPriceReduced` 是纯展示行，删掉不留空）。

**段 3：无 `else`（`:65-66`）**

`:65` 是 `:cond_0` 标签，`:66` 是 `return-void`。**`go0.k.Н == false` 时不删**，`isPriceReduced` 保持可见。

#### 3.4.2 `onBusMsg` —— 总线监听（`p91.smali:69-94`）

```asm
69: .method public final onBusMsg(Lcom/maxmpz/widget/MsgBus;IIILjava/lang/Object;)V
73:     const v0, 0x7f0d0530        ; cmd_app_feature_pak_settings_refresh
78:     if-ne p2, v0, :cond_0
82:     invoke-virtual {p0}, Lׅ/b71;->у()Z        ; ← 刷新
87:     :cond_0
88:     invoke-super/range {p0 .. p5}, Lׅ/n91;->onBusMsg(...)
93:     return-void
```

`b71.у()`【实证·产物】`b71.smali:1415-1460`：

```java
boolean у() {
    X.removeCallbacks(this.t);           // :1427  取消待执行防抖
    this.q = false;                      // :1435
    boolean r = super.у();               // :1439  → n91.у()
    if (!r) this.s = null;               // :1454
    return r;
}
```

`n91.у()`【实证·产物】`n91.smali:3483-3561`（**这是"整页重建"**）：

```java
boolean у() {
    if (this.С) return false;                                  // :3487-3498  已在加载中 → 拒绝重入
    PreferenceScreen K = this.K;                               // :3502
    n91.O(K, new ac(0x1c));                                    // :3510-3519  遍历整棵偏好树
    this.Н.setPreferenceScreen(null);                          // :3524-3531  ★ 清空
    A(this.y);                                                 // :3536-3540  ★ 重新 inflate XML
    w(); с();                                                  // :3545 / :3550
    return true;                                               // :3555
}
```

`n91.A(int)`【实证·产物】`n91.smali:888-937` 的核心是 `:897`：

```asm
897:    invoke-interface {v0, p1}, Lׅ/m91;->addPreferencesFromResource(I)V
```

> **结论**：`0x7f0d0530` 到达 `p91` 后，页面执行的是「**`setPreferenceScreen(null)` + `addPreferencesFromResource(y)`**」——
> **不是局部刷新，而是整页重新 inflate**。这解释了为什么 `isPriceReduced` 的删除写在 `Q()`（装配）里而不是状态更新里：
> 每次刷新都是全新装配，删了就真的没了。

#### 3.4.3 `Х()` —— 页面钩子覆写（`p91.smali:96-129`）

```asm
96: .method public final Х()V
100:    iget-object v0, p0, Lׅ/n91;->у:Lcom/maxmpz/audioplayer/preference/SettingsActivity;
104:    const-class v1, Lcom/maxmpz/app/base/BaseApplication;
108:    invoke-static {v0, v1}, Lcom/maxmpz/utils/AUtils;->c(Landroid/app/Activity;Ljava/lang/Class;)Landroid/app/Application;
116:    check-cast v0, Lcom/maxmpz/app/base/BaseApplication;
120:    const/4 v1, 0x0                    ; ★ 0，而基类是 1
123:    invoke-virtual {v0, v1}, Lcom/maxmpz/app/base/BaseApplication;->P(Z)V
```

**与基类的差异**【实证·产物】`n91.smali:3341-3374`：

```asm
3341: .method public Х()V
3365:    const/4 v1, 0x1                    ; ★ 基类是 1
3368:    invoke-virtual {v0, v1}, Lcom/maxmpz/app/base/BaseApplication;->P(Z)V
```

`BaseApplication.P(Z)`【实证·产物】`smali/com/maxmpz/app/base/BaseApplication.smali:482-533`：

```java
void P(boolean z) {
    o4 r = z ? new o4(this, 1) : new o4(this, 2);     // :490-517
    lx.INSTANCE.B(r, 250L);                           // :523-527  ★ 延迟 250 ms
}
```

`o4.run()`【实证·产物】`o4.smali:42-168`：

| `o4` 构造 index | `run()` 的 `packed-switch` 落点 | 效果 |
| ---: | --- | --- |
| `0` | `:pswitch_1`（`o4.smali:86`） | 弹 Toast（`0x7f08013b`）+ `finish()` 掉最近的活动 |
| `1` | `:pswitch_0`（`o4.smali:73`） | `BaseApplication.Н(**true**)` |
| `2` / 其它 | default（`o4.smali:58-70`） | `BaseApplication.Н(**false**)` |

> **所以 `p91.Х()` = `P(false)` → `Н(false)`；`n91.Х()`（默认）= `P(true)` → `Н(true)`。**
>
> `n91.Х()` 的唯一调用点是 **`n91.smali:481`**（在 `n91.<init>` 尾部，紧跟 `:476` 的 `z()`）。也就是说：
> **任何页面在构造完成时都会调一次 `Х()`**，而 `p91` 把它改成了「反向」的那个分支。
>
> **谁还覆写了它**【实证·产物】`z61.smali:4777-4834`：`z61.Х()` 的 `packed-switch 0x6` → `:pswitch_0` → 同样 `P(false)`。
> 而 `z61` 的索引 `0x6` 是 **`buy_methods`**（见 §5.3）。
>
> **【推断】** `Х()` 是「**本页是否声明了"买不起/不需要买"的状态**」钩子：只有 `buy_methods`（购买方式页）与 `feature_packages`（功能包页）这两个**直接承载交易**的页面把 `Н` 置为 `false`；
> 其余页面沿用基类的 `true`。`BaseApplication.Н(Z)` 的内部实现（`smali/com/maxmpz/app/base/BaseApplication.smali:5427-5577`，读写 `q4.х:J` 并调 `ih0.R()`）属于应用启动域，**本文不外推**，标记为**未解**（§8 Q2）。

### 3.5 `p91` 的父类链：`b71` → `n91`

| 类 | 字节 / 行 | `.super` | 说明 |
| --- | ---: | --- | --- |
| `ׅ/n91` | 81347 / 4122 | `Ljava/lang/Object;` | **框架基类**（抽象）：持有 `K:PreferenceScreen`、`у:SettingsActivity`、`Н:m91`、`р/P/О:MsgBus`、`y`/`C:int` 等 31 个字段 |
| **`ׅ/b71`** | **24273 / 1460** | **`Lׅ/n91;`** | **「带防抖 + 缓存 + 异步装配」的中间层**（抽象） |
| **`ׅ/p91`** | **2618 / 129** | **`Lׅ/b71;`** | `feature_packages` 页（`final`） |
| `ׅ/r91` | 32207 / — | `Lׅ/n91;` | `general` 页（**跳过 `b71`**，直接继承 `n91`） |

> **这是本文最重要的「为什么 129 行」的答案**：`general` 的 `r91`（32207 B）直接吃 `n91`，自己实现了一套运行期发现逻辑；
> `feature_packages` 的 `p91`（2618 B）走了 `b71` 这条**带了通用异步框架的支线**，于是只剩「把 XML 装起来」这一件事。

`b71` 提供的关键资产【实证·产物】`b71.smali`：

| 成员 | 行 | 作用 |
| --- | ---: | --- |
| `.field public j:J` / `k:Z` / `l:I` / `m:I` / `n:J` / `q:Z` | 7–17 | 时间戳 / 状态标志 |
| `.field public final r:Ljava/util/LinkedHashMap;` | 19 | **偏好缓存**（ctor 在 `:45` 建立） |
| `.field public s:Lׅ/a71;` | 21 | 当前场景 |
| `.field public final t:Lׅ/ix;` | 23 | **防抖 Runnable**（ctor 在 `:62` 建立，`ix(0x1d, this)`） |
| `constructor <init>` | 27–67 | `:31` 调 `n91.<init>`；`:45`/`:62` 建立缓存与 Runnable |
| `static S(b71;I)V` | 99–243 | **防抖调度器**（21 处调用方），内部 `:218` 调 `R()` |
| `abstract Q()V` | **937** | **子类必须实现的装配钩子** ← `p91` 唯一实现的方法 |
| `final R()V` | 940–1092 | **250 ms 合并执行器**：`:1004` 调 `Q()`，`:1012` 置 `k=true` |
| `T()V` | 1094–1099 | **空方法**（供 `v()` 调，默认无操作） |
| `final U()V` | 1101–1204 | 长按/场景相关的重活 |
| `final v()V` | **1313–1352** | **装配编排**：`J()` 判分支 → `x()` 或 `T()+S(7)` |
| `final у()Z` | **1415–1460** | 取消防抖 + `super.у()`（→ 整页重建） |

`ix.smali:80-98`【实证·产物】是 `b71.t` 的 `run()`：`check-cast v9, Lׅ/b71;` → `:93` 调 `b71.R()`。

> **装配链**：
> ```
> n91.<init> 完成
>   → (由 u61 / SettingsActivity 驱动)  b71.v()          [b71.smali:1313]
>        → J() ?  →  T() + S(7)                          [:1338-1346]
>        → !J() ? →  x()                                  [:1329]
>   → b71.S(…)  → (防抖) → b71.R()                       [b71.smali:218 / :1004]
>        → p91.Q()                                       [p91.smali:7]
> ```
> `b71.v()` 的**外部调用点**：全树 **0 处**（`u61` 只 `new` 不调）。它是 `n91.v()`（`n91.smali:2763` 声明为 `abstract`）的实现，
> 由 `n91.smali:2770` 的 `invoke-virtual {p0}, Lׅ/n91;->v()V` 以**虚调用**方式触发——所以静态搜 `b71;->v()` 找不到调用方是正常的。

### 3.6 自定义控件实现

**继承链全图**【实证·产物】（各文件第 2 行 `.super`）：

```
android.preference.Preference
  └─ PrefBase                       (abstract, 11523 B / 530 行)
       ├─ RawTextPreference         (80911 B / 4011 行)
       │    ├─ ProgressPreference   (4158 B / 198 行)
       │    │    ├─ BuyUberPref                    ← L14
       │    │    └─ BaseRestoreFvPurchasePref      (7769 B / 383 行)
       │    │         └─ RestoreFeaturePackPurchasePref  ← L18
       │    ├─ BuyPrefBase          (abstract, 25033 B / 1251 行)
       │    │    └─ FeaturePackPref (34849 B / 1767 行)   ← L11
       │    ├─ UberLevelPref        (18707 B / 912 行)     ← L15
       │    └─ RedirectPreference   (2884 B / 130 行)
       │         └─ FeaturePackRedirectPref (4740 B / 254 行)  ← general.xml:5
       └─ …
android.preference.SwitchPreference
  └─ MultilineSwitchPreference      (14088 B / 628 行)        ← L12
```

#### 3.6.1 `PrefBase` —— 自删机制的唯一执行点

`PrefBase` 是**所有自定义偏好控件的共同祖先**，它提供了本文最关键的一套机制。

**统一钩子 → `В()`**【实证·产物】`PrefBase.smali:269-333`：

```asm
269: .method public onAttachedToActivity()V
278:     iget-boolean v0, p0, PrefBase;->К:Z       ; 已附加过？
282:     if-nez v0, :cond_0
286:     const/4 v0, 0x1
289:     iput-boolean v0, p0, PrefBase;->К:Z       ; 置位，保证只跑一次
293:     invoke-virtual {p0}, PrefBase;->В()V      ; ★ 唯一触发
298:     :cond_0
299:     return-void
302: .method public onAttachedToHierarchy(Landroid/preference/PreferenceManager;)V
311:     iget-boolean p1, p0, PrefBase;->К:Z
315:     if-nez p1, :cond_0
319:     const/4 p1, 0x1
322:     iput-boolean p1, p0, PrefBase;->К:Z
326:     invoke-virtual {p0}, PrefBase;->В()V      ; ★ 同一触发，另一入口
331:     :cond_0
```

> **两条系统回调，一个幂等标志 `К`，一个 `В()`**。这就是「**统一钩子**」：
> 无论框架先调 `onAttachedToHierarchy`（`addPreference` 路径）还是 `onAttachedToActivity`（Activity 路径），
> `В()` 都**保证只执行一次**。所有「按条件自删」的实现类只需覆写 `В()`。

**`В()` 的默认实现**【实证·产物】`PrefBase.smali:466-530`：把 `this` 订阅到 `bus_settings`（`0x7f0d04a6` = `id/bus_settings`），见 `:506`/`:511`/`:523`。

**`removePreference()`**【实证·产物】`PrefBase.smali:418-437`：

```asm
418: .method public final removePreference()V
422:     iget-object v0, p0, PrefBase;->у:Landroid/preference/PreferenceGroup;
426:     if-eqz v0, :cond_0
430:     invoke-virtual {v0, p0}, PreferenceGroup;->removePreference(Landroid/preference/Preference;)Z
436:     :cond_0
```

> `у` 字段（`PrefBase.smali:24` `.field public у:Landroid/preference/PreferenceGroup;`）在 `onParentChanged`（`:342-376`）里由 `:371` 写入。
> **这是"知道自己在哪个父容器里"的缓存**——有了它，`removePreference()` 不用每次回溯 `getParent()`。
>
> **`removePreference()` 全树只有 1 个调用点**：【实证·产物】`BuyPrefBase.smali:1179`。

**反向钩子 `onPrepareForRemoval()`**【实证·产物】`PrefBase.smali:378-416`：被移除时若 `К` 为真 → `B()`（`:390`，退订总线）→ `К = false` → `у = null`（`:411`）。**干净解绑。**

#### 3.6.2 `FeaturePackPref`（L11 / `fp1`）

**构造**【实证·产物】`FeaturePackPref.smali:15-93`：

```asm
19:     sget-object v0, Lׅ/go0;->k:Lׅ/go0;
23:     invoke-direct {p0, p1, p2, v0}, BuyPrefBase;-><init>(Landroid/content/Context;Landroid/util/AttributeSet;Lׅ/b9;)V
28:     iget-boolean p2, p0, BuyPrefBase;->l:Z      ; ★ l = buttonOnly
32:     if-nez p2, :cond_0
36:     const p2, 0x7f0802d3                        ; string/intro_feat_paks = "🎁 Feature Packages"
45:     invoke-static {p1, p2, v0}, Lׅ/ts;->В(...)  ; 带主题变体解析
53:     invoke-virtual {p0, p2}, Preference;->setTitle(...)
58:     :cond_0
59:     const p2, 0x7f0800d1                        ; string/buy_feature_pak_1 = "Buy Feature Package #1"
68:     invoke-static {p1, p2, v0}, Lׅ/ts;->В(...)
80:     invoke-static {p2, p1}, Lׅ/ee1;->с(...)     ; 前后缀拼接
88:     iput-object p1, p0, BuyPrefBase;->q:Ljava/lang/CharSequence;   ; 按钮文案缓存
```

> **关键**：`:28-32` —— **`buttonOnly == true` 时不设 title**。
> `feature_packages.xml:11` 的 `fp1` 正是 `w:buttonOnly="true"`，所以**「关于」子页里的 fp1 没有标题**，只有按钮；
> 而 `singlepane.xml:10` 的 `fp1` 只有 `w:removeAsNeeded="true"`（无 `buttonOnly`）→ `l=false` → **有标题**。
> **同一个 `FeaturePackPref` 类，在两页渲染成两种形态，全靠 `w:buttonOnly`。**

**四个状态位**【实证·产物】`FeaturePackPref.smali:7-11`：

| 字段 | 行 | 来源 | 语义【推断】 |
| --- | ---: | --- | --- |
| `z:Z` | 7 | `b9.Р`（`:380-384`） | 已拥有 |
| `D:Z` | 9 | `b9.Н`（`:388-392`） | 价格已降/已购 |
| `E:Z` | 11 | *（无 `b9` 直读，仅 `:512` 读）* | 网络/加载态 |

**三个谓词**（都是 `BuyPrefBase` 的抽象钩子实现）：

| 方法 | 行 | 返回 `true` 的条件 |
| --- | ---: | --- |
| `X()Z` | **97–169** | `v`（= `removeAsNeeded`，`:101`）为真 且 `(wr.w0.А & 1)` 或 `(ver>=0xe5 且 wr.x0)` —— **要不要删掉自己** |
| `y()Z` | **1650–1697** | `E && !u && !t && !s` |
| `К()Z` | **1699–1734** | （`BuyPrefBase` 里是 `t && u`，`FeaturePackPref` 覆写） |
| `у()Z` | **1736–1767** | `!z && !r`（**未拥有** ⇒ 需要购买按钮） |

**三按钮装配**（`BuyPrefBase.x(...)` 的抽象实现）【实证·产物】`FeaturePackPref.smali:1554-1648`：

```asm
1558:    const/4 p1, 0x0                                    ; 复用为 0
1561:    invoke-virtual {p3, p1}, TextView;->setIncludeFontPadding(Z)V
1574:    const p3, 0x7f0202b4                               ; drawable/gplay_icon_24dp
1587:    invoke-virtual {p6, p2, p1}, FastTextView;->D(Drawable;I)V   ; p6 = 购买按钮，加 Google Play 图标
1596:    const p2, 0xf0d0148
1601:    iput p2, p1, BusActionBehavior;->y:I               ; busId
1605:    const p2, 0xf0d015c
1610:    iput p2, p1, BusActionBehavior;->К:I               ; msgId
1614:    const-string p2, "fp"
1618:    iput-object p2, p1, BusActionBehavior;->P:Ljava/lang/String;  ; 路由串
1622:    const p1, 0x7f0d0537                               ; id/cmd_settings_feature_pak_close
1631:    iput p1, p2, BusActionBehavior;->К:I               ; p5 = 关闭按钮
1635:    const-string p1, "settings/feature_packages?no_backstack=1"
1643:    iput-object p1, p2, BusActionBehavior;->P:Ljava/lang/String;  ; p7 = info 按钮 → 深链回本页
```

> `0xf0d0148` / `0xf0d015c` 是**带高位标记的常量**（`0x7f0d0148 | 0x80000000` 形式的邻近值），
> 同型常量在 `go0.smali:43`（作为 `b9` 构造参数）、`FeaturePackPref.smali:1596/1605`、`BaseBuyFvPref.smali:2446` 等处出现。
> 【推断】它们是 **bus 消息 id / sku 占位**，不经 `public.xml` 解析。**本文不外推其数值语义**（§8 Q3）。

#### 3.6.3 `BuyUberPref`（L14）

- `.super ProgressPreference`（`BuyUberPref.smali:2`），即 `RawTextPreference` 派生 → **带进度条能力**。
- 构造 `:24-146`：`b9` 取自 `go0.k`（`:80`/`:85`），并在 `:136` 直接 `setOnPreferenceClickListener(new y9(...))`（`:127`/`:131`）。
- **`В()` 覆写 `:604-635`**：`super.В()` → `l=true` → `b9.x()` → `update()`。**无自删**。
- 即 `BuyUberPref` 是**唯一不做条件删除**的 Feature-Pack 类控件。

#### 3.6.4 `UberLevelPref`（L15）

- `.super RawTextPreference`（`UberLevelPref.smali:2`），18707 B / 912 行——**同级里最大**（因为它带徽章动画）。
- 构造 `:24-105`：`:61` `const v0, 0x10100e5`（framework attr `android:clickable`）→ `:74` `obtainStyledAttributes` → `:93` `iput k:Z`。
  **注意它读的是 `android:clickable`，不是自定义 attr**；`general.xml:8` 的同名条目显式写了 `android:clickable="true"`，本页 L15 没写 ⇒ 默认 `false`。
- **`В()` 覆写 `:846-912`**：`super.В()`（`:850`）→ 后续是 `bus_settings` 的订阅逻辑（`:883`/`:888`/`:896`/`:900`）。**无自删**。
- `icon=@drawable/transparent_nothing`（`drawable-sw3dp.xml`，247 B）——**刻意用不可见占位符对齐**，这是为了与相邻三行说明块的左侧留白对齐。

#### 3.6.5 `RestoreFeaturePackPurchasePref`（L18）

- `.super BaseRestoreFvPurchasePref`（`:2`）→ 再上 `ProgressPreference` → `RawTextPreference`。
- **`В()` 覆写 `:296-386`**——**本页唯一带"版本门"的自删**：

```asm
300:    sget-object v0, Lׅ/y40;->H:Lׅ/z20;
304:    iget v0, v0, Lׅ/a30;->А:I        ; 应用版本号
308:    const/16 v1, 0xe5                ; 229
312:    if-lt v0, v1, :cond_1            ; 版本 < 229 → 跳到删除
316:    sget-object v0, Lׅ/y40;->K:Lׅ/y40;
325:    invoke-static {}, Lׅ/y40;->e()I
333:    if-lez v0, :cond_0               ; 计数器 <= 0 → 删除
337:    iget-object v0, p0, BaseRestoreFvPurchasePref;->i:Lׅ/b9;
341:    iget v1, v0, Lׅ/b9;->о:I
345:    iget v0, v0, Lׅ/b9;->o:I
349:    if-lt v1, v0, :cond_0            ; 已恢复过 → 删除
357:    :cond_0
358:    invoke-super {p0}, BaseRestoreFvPurchasePref;->В()V   ; ← 保留
365:    :cond_1
366:    :goto_0
367:    invoke-virtual {p0}, PrefBase;->getParentGroup()...
375:    if-eqz v0, :cond_2
379:    invoke-virtual {v0, p0}, PreferenceGroup;->removePreference(...)   ; ★ 自删
```

> **语义**：`restore_purchase` 只在「**版本 ≥ 229 且 有待恢复项 且 尚未恢复过**」时显示。
> 也就是说：**新版本用户如果从没买过任何东西，看不到「恢复购买」**——这是常见的"无货不显示"设计。
> 它**没有**读 `w:removeAsNeeded`（L18 也没写），删除条件完全来自 `b9` 与 `y40`。

### 3.7 `BuyPrefBase`：`w:buttonOnly` / `w:removeAsNeeded` 的读取

#### 3.7.1 styleable 数组：`qt0.u`

构造 **src** 【实证·产物】`qt0.smali`（`clinit`）：

```asm
1068:    const v6, 0x7f0108c4        ; attr/buttonOnly
1073:    const v7, 0x7f010c55        ; attr/removeAsNeeded
1078:    filled-new-array {v6, v7}, [I
1086:    sput-object v6, Lׅ/qt0;->u:[I
```

| 索引 | attr id | 名称 |
| ---: | --- | --- |
| **0** | `0x7f0108c4` | **`buttonOnly`** |
| **1** | `0x7f010c55` | **`removeAsNeeded`** |

> **⚠ 与任务书的表述一致：`removeAsNeeded` 在索引 1。**

**单一数组 `qt0.r0`**（另一个形态）【实证·产物】`qt0.smali`：

```asm
1900:    filled-new-array {v7}, [I      ; v7 = 0x7f010c55（在 :1073 载入）
1908:    sput-object v0, Lׅ/qt0;->r0:[I
```

| 索引 | attr id | 名称 |
| ---: | --- | --- |
| **0** | `0x7f010c55` | **`removeAsNeeded`** |

> **同一个 attr 有两套 styleable 封装**：双属性版 `qt0.u`（索引 1）给 `BuyPrefBase`，单属性版 `qt0.r0`（索引 0）给 4 个 Redirect/Status 类。
> **`qt0.u` 的消费者全树只有 1 个**：【实证·产物】`BuyPrefBase.smali:111`。
> **`qt0.r0` 的消费者 4 个**：`AlreadyPurchasedRedirectPref.smali:58`、`BuyMethodsRedirectPref.smali:38`、`FeaturePackRedirectPref.smali:38`、`LicenseStatusPref.smali:77`。

#### 3.7.2 `BuyPrefBase` 构造读值（任务书所指「约 72-92 行」的正确位置）

【实证·产物】`BuyPrefBase.smali:42-161`，`sget-object p3, Lׅ/qt0;->u:[I` 在 **`:111`**（任务书说的「约 72-92 行」略偏；实际 `obtainStyledAttributes` 在 `:115`，两次读在 `:126` / `:138`）：

```asm
 96:    const p3, 0x7f0400db                          ; layout/preference_feature_pak
101:    invoke-virtual {p0, p3}, Preference;->setLayoutResource(I)V
106:    invoke-virtual {p0, v0}, RawTextPreference;->setKeepPaddings(Z)V   ; v0 = 1
111:    sget-object p3, Lׅ/qt0;->u:[I
115:    invoke-virtual {p1, p2, p3}, Context;->obtainStyledAttributes(...)
120:    move-result-object p1
123:    const/4 p2, 0x0
126:    invoke-virtual {p1, p2, p2}, TypedArray;->getBoolean(IZ)Z    ; ★ idx 0 = buttonOnly
131:    move-result p3
134:    iput-boolean p3, p0, BuyPrefBase;->l:Z                      ; → 字段 l
138:    invoke-virtual {p1, v0, p2}, TypedArray;->getBoolean(IZ)Z   ; ★ idx 1 = removeAsNeeded（v0 = 1）
143:    move-result p2
146:    iput-boolean p2, p0, BuyPrefBase;->v:Z                      ; → 字段 v
150:    invoke-virtual {p1}, TypedArray;->recycle()V
155:    invoke-static {p0, v0}, Lׅ/r20;->К(Landroid/preference/Preference;Z)V
```

| 字段 | 声明行 | attr（索引） | 名称 |
| --- | ---: | --- | --- |
| **`l:Z`** | `:22` | `qt0.u[0]` | **`buttonOnly`** |
| **`v:Z`** | `:38` | `qt0.u[1]` | **`removeAsNeeded`** |

> **这是任务书需要点明的关键配对**：**`l` = `buttonOnly`，`v` = `removeAsNeeded`**。
> 后文的 `X()`（`FeaturePackPref.smali:101`）读的是 **`v`** ⇒ 它判的是「**要不要删**」，不是「是不是按钮模式」。
> 任务书把 `v` 归为 `buttonOnly` 是**倒置的**；正确关系：**`removeAsNeeded` 在索引 1 → 字段 `v`**。

#### 3.7.3 `w:buttonOnly` 如何改变渲染

**布局切换**：`BuyPrefBase` 在 `:96`/`:101` 把 layout 强制换成 **`@layout/preference_feature_pak`**（`0x7f0400db`），
即**所有 `BuyPrefBase` 子类共用同一套大卡片布局**（`res/layout/preference_feature_pak.xml`，3404 B / 12 行）：

| 行 | 控件 | id |
| ---: | --- | --- |
| 4 | `TextView` | `@android:id/title` |
| 5 | `BusActionButton` | `@id/close_button`（`close_stroke` 图标，`busId=@id/bus_settings`） |
| 6 | `TextView` | `@android:id/summary` |
| 7 | `BusActionButton` | `@id/info_button`（`@string/more_info` + `info_16dp`，`msgId=@cmd_app_open`） |
| 8 | `BusActionButton` | `@id/buy_pak_button`（style = `@style/BuyPrefBuyButton`） |
| 9 | `ProgressBar` | `@id/price_progress` |
| 10 | `TextView` | `@id/price`（`w:layout_goneWhenEmpty="true"`） |
| 11 | `StateAnimParams` | `w:scale="1.45"` |

**`buttonOnly` 的实际效果在 `onBindView`**【实证·产物】`BuyPrefBase.smali:253-1153`：

```asm
343:    iget-boolean v5, v0, BuyPrefBase;->l:Z        ; ★ 读 buttonOnly
347:    if-eqz v5, :cond_2
351:    const/16 v6, 0x8                              ; ★ GONE
355:    goto :goto_1
359:    :cond_2
360:    const/4 v6, 0x0                               ; ★ VISIBLE
363:    const v7, 0x1020016                           ; android:id/title
368:    invoke-virtual {v2, v7}, FastLayout;->k1(I)Landroid/view/View;
380:    invoke-virtual {v7, v3}, TextView;->setIncludeFontPadding(Z)V      ; v3 = 0
385:    invoke-virtual {v7, v6}, View;->setVisibility(I)V                  ; ★ title 显隐
390:    const v8, 0x1020010                           ; android:id/summary
395:    invoke-virtual {v2, v8}, FastLayout;->k1(I)Landroid/view/View;
407:    invoke-virtual {v8, v6}, View;->setVisibility(I)V                  ; ★ summary 显隐
```

> **结论**：`w:buttonOnly="true"` ⇒ `l = true` ⇒ `:351` 取 `0x8`（`View.GONE`）⇒ `:385`/`:407` 把 **`title` 与 `summary` 两个 TextView 全部隐藏**。
> 剩下的可见元素是：`close_button` / `info_button` / `buy_pak_button` / `price_progress` / `price` —— **纯按钮 + 价格行**。
>
> 这与 `FeaturePackPref` 构造里 `:28-53` 的「`buttonOnly` 为真就**不 setTitle**」是**同一语义的两道保障**：
> 一道在数据层（不写 title），一道在渲染层（隐藏 title 视图）。**两处都读同一个 `l`**。

`l`（`buttonOnly`）的其他读取点【实证·产物】：

| 位置 | 用途 |
| --- | --- |
| `BuyPrefBase.smali:343` | `onBindView` 控制 title/summary 显隐（上引） |
| `FeaturePackPref.smali:28` | 构造期是否 `setTitle` |
| `FeaturePackPref.smali:590` | `update()` 内（同族判断） |

### 3.8 `w:removeAsNeeded` 的自删机制

#### 3.8.1 机制全图

```
XML: w:removeAsNeeded="true"
  │
  ├─ 若控件是 BuyPrefBase 子类（FeaturePackPref 等）
  │    → qt0.u[1] → BuyPrefBase.v
  │    → 覆写 В()  [BuyPrefBase.smali:1163]
  │        → X()  [FeaturePackPref.smali:97]
  │            → 真？→ PrefBase.removePreference()   [BuyPrefBase.smali:1179 → PrefBase.smali:418]
  │            → 假？→ super.В()（订阅 bus_settings）
  │
  └─ 若控件是 Redirect/Status 族（4 个类）
       → qt0.r0[0] → 各自的 i:Z
       → 覆写 В()，各写各的删除条件
```

**触发点永远是 `PrefBase.В()`**，而 `В()` 由 `PrefBase.onAttachedToActivity`（`:293`）或 `PrefBase.onAttachedToHierarchy`（`:326`）**幂等触发**（`К` 标志，`:289`/`:322`）。

#### 3.8.2 各实现类的 `В()` 与自删行号

| 类 | `В()` 行 | 自删点 | 删除条件来源 |
| --- | ---: | --- | --- |
| `PrefBase` | **466** | —（不删，只订阅 `bus_settings`） | 基类 |
| **`BuyPrefBase`** | **1163** | **`:1179`** `PrefBase.removePreference()` | `X()` |
| **`FeaturePackPref`** | *（不覆写 `В()`，用 `BuyPrefBase` 的）* | 同 `BuyPrefBase:1179` | `X()`=`FeaturePackPref:97`，读 `v`（`removeAsNeeded`）+ `wr.w0` + `wr.x0` |
| `BuyUberPref` | **604** | **无** | 不做自删 |
| `UberLevelPref` | **846** | **无** | 不做自删 |
| `RestoreFeaturePackPurchasePref` | **296** | **`:379`** `PreferenceGroup.removePreference` | 版本 `< 0xe5` 或 `y40.e()<=0` 或 `b9.о>=b9.o` |
| `AlreadyPurchasedRedirectPref` | **282** | **无删除**，改为 `:348` `setEnabled(xor)` | `X()` + `y40.H` 版本门 |
| `BuyMethodsRedirectPref` | **111** | **`:135`** `PreferenceGroup.removePreference` | `i`（`qt0.r0[0]`） |
| **`FeaturePackRedirectPref`** | **111** | **`:204`** 与 **`:238`** 两处 | `i`（`qt0.r0[0]`）+ `wr.w0` + `wr.x0` |
| `ManageAppWarnPref` | **1106** | `:1190` `getParentGroup()` | 自有逻辑 |

#### 3.8.3 `qt0.r0` 单属性版的读取（4 个消费者）

以 `FeaturePackRedirectPref` 为例【实证·产物】`FeaturePackRedirectPref.smali:32-71`：

```asm
38:     sget-object p1, Lׅ/qt0;->r0:[I
42:     const/4 p2, 0x0
45:     invoke-virtual {v1, v2, p1, p2, p2}, Context;->obtainStyledAttributes(...)
53:     invoke-virtual {p1, p2, p2}, TypedArray;->getBoolean(IZ)Z     ; ★ 索引 0
61:     iput-boolean p2, v0, FeaturePackRedirectPref;->i:Z            ; → 字段 i
65:     invoke-virtual {p1}, TypedArray;->recycle()V
```

**完全同构的 4 处**（都是 `getBoolean(0, false)` → `iput i:Z`）：

| 文件 | `sget-object` 行 | `getBoolean` 行 | `iput i:Z` 行 |
| --- | ---: | ---: | ---: |
| `AlreadyPurchasedRedirectPref.smali` | 58 | 73 | 81 |
| `BuyMethodsRedirectPref.smali` | 38 | 53 | 61 |
| `FeaturePackRedirectPref.smali` | 38 | 53 | 61 |
| `LicenseStatusPref.smali` | 77 | 92 | 100 |

> **`w:removeAsNeeded` 全树出现 8 处，全部在 `singlepane.xml` + `buy_methods.xml`**（**本页 `feature_packages.xml` 一处也没有**）：
>
> | 文件:行 | 控件 |
> | --- | --- |
> | `res/xml/buy_methods.xml:16` | `AlreadyPurchasedRedirectPref` |
> | `res/xml/singlepane.xml:6` | `LicenseStatusPref` |
> | `res/xml/singlepane.xml:7` | `BuyPlayFvPref` |
> | `res/xml/singlepane.xml:8` | `BuyRustoreFvPref` |
> | `res/xml/singlepane.xml:9` | `BuyHuaweiFvPref` |
> | **`res/xml/singlepane.xml:10`** | **`FeaturePackPref`（= `fp1`，设置根页那一份）** |
> | `res/xml/singlepane.xml:11` | `AlreadyPurchasedRedirectPref` |
> | `res/xml/singlepane.xml:12` | `FeaturePackRedirectPref` |
>
> **这条事实很关键**：`feature_packages.xml` 里的 `fp1`（L11）**没有** `w:removeAsNeeded`，只有 `w:buttonOnly`。
> 也就是说 **「关于」子页的 `fp1` 永远不会自删**；会自删的是**设置根页 `singlepane.xml:10` 的那一份**。
> 这是 §3.10「`move_fp1_to_about` 控制 `fp1` 显示在哪」机制的**技术基础**。

### 3.9 两个 `widgetLayout` 的布局内容

#### 3.9.1 `res/layout/settings_feature_pak_list_button.xml`（526 B / 3 行）

【实证·原文】`settings_feature_pak_list_button.xml:2`（单行自闭合）：

```xml
<com.maxmpz.widget.base.BusActionButton
    android:text="@string/changelog"                          → "Changelog"
    android:drawable="@drawable/list_16dp"
    w:busId="@id/bus_app_cmd"
    w:msgId="@id/cmd_app_open"
    w:string="activity/dialogs.ChangelogActivity?content=fp_changelog_content&amp;alt_full_content=changelog_content&amp;title=feature_pak_1&amp;altButton=full_changelog"
    style="@style/PrefRoundedTransButton" />
```

| 项 | 值 |
| --- | --- |
| **几个按钮** | **1 个** |
| **按钮文本** | **`Changelog`** |
| **左侧图标** | `list_16dp`（`res/drawable-sw2dp-xxxhdpi/list_16dp.png`，472 B） |
| **点击做什么** | 通过 `bus_app_cmd` 发 `cmd_app_open`，携带**深链串**：打开 `activity/dialogs.ChangelogActivity`，参数 `content=fp_changelog_content` / `alt_full_content=changelog_content` / `title=feature_pak_1` / `altButton=full_changelog` |
| 样式 | `@style/PrefRoundedTransButton`（`styles.xml:13116`，圆角透明按钮：`ripple_inverse_stroke_bg_rounded_circle` 背景、8/8/16/8 dp 内边距、`drawablePaddingStart=14dp`） |

> **`w:string` 的 URL 解码**：`&amp;` → `&`，所以实际深链是
> `activity/dialogs.ChangelogActivity?content=fp_changelog_content&alt_full_content=changelog_content&title=feature_pak_1&altButton=full_changelog`。
> 语义【推断】：展示**功能包专属更新日志**，并提供一个「完整更新日志」备选按钮。

#### 3.9.2 `res/layout/settings_feature_pak_vote_button.xml`（521 B / 3 行）

【实证·原文】`settings_feature_pak_vote_button.xml:2`：

```xml
<com.maxmpz.widget.base.BusActionButton
    android:text="@string/pref_poweramp_forum"                → "Forum"
    android:drawable="@drawable/forum_16dp"
    w:busId="@id/bus_app_cmd"
    w:msgId="@id/cmd_app_open"
    w:arg2="@integer/FLAG_ACTIVITY_NEW_TASK"
    w:string="@string/forum_url"                              → "https://forum.powerampapp.com/"
    w:confirmTitle="@string/external_link"                    → "External Link"
    w:confirmText="@string/external_link_msg"                 → "The link will be opened in the browser/another app"
    style="@style/PrefRoundedTransButton" />
```

| 项 | 值 |
| --- | --- |
| **几个按钮** | **1 个** |
| **按钮文本** | **`Forum`** |
| **左侧图标** | `forum_16dp`（`res/drawable-sw2dp-xxxhdpi/forum_16dp.png`，626 B） |
| **点击做什么** | 先弹**确认对话框**（标题 `External Link` / 正文 `The link will be opened in the browser/another app`），确认后以 `FLAG_ACTIVITY_NEW_TASK` 打开 **`https://forum.powerampapp.com/`** |
| `FLAG_ACTIVITY_NEW_TASK` 值 | `0x10000000`【实证·原文】`res/values/integers.xml:3` |

> **两个 `widgetLayout` 的共同点**：都是**单个 `BusActionButton`**，都走 `bus_app_cmd` + `cmd_app_open`，都用 `PrefRoundedTransButton` 样式。
> **差异**：`list_button` 是**应用内深链**（`activity/...`），无确认；`vote_button` 是**外部 URL**，带强制确认对话框 + `NEW_TASK` 标志。
> **为什么是 `widgetLayout` 而不是 `Preference`**：`android:widgetLayout` 让 `RawTextPreference` 把**整行右侧**换成一个任意 View，
> 于是「一行文字 + 一个按钮」并列显示——这正是 L5/L6 需要的形态（文字在左、按钮在右）。
> 注意 L5/L6 **没有** `w:reducedPad`（因为按钮本身自带 padding）。

### 3.10 `move_fp1_to_about` 的实际作用

**它控制 `fp1`（Feature Pack #1 购买卡片）显示在『设置根页』还是『关于子页』。**

#### 3.10.1 谁读这个 key（全树搜索）

| 位置 | 角色 |
| --- | --- |
| `res/xml/feature_packages.xml:12` | **UI 声明**（`MultilineSwitchPreference`，`persistent=true`，`defaultValue=false`） |
| `smali/ׅ/p91.smali:11` | **写监听**（`Q()` 段 1，绑 `tc(5)`） |
| **`smali/ׅ/wr.smali:1753`** | **★ 读声明** —— `const-string v1, "move_fp1_to_about"` → `:1757` `ms.с(String, Z)` → `:1765` `sput-object v1, Lׅ/wr;->x0:Lׅ/pb1;` |

`wr` 是**快速偏好注册表**（`fastprefs` 层）：`wr.x0` 是类型 `Lׅ/pb1;`（布尔偏好），底层继承 `Lׅ/fc;`（有 `.field public А:Z`）。

**读取 `wr.x0` 的全部代码**（3 处）：

| 位置 | 所在方法 | 用途 |
| --- | --- | --- |
| **`FeaturePackPref.smali:147`** | `X()`（97–169） | 判 `fp1` 是否该自删 |
| **`FeaturePackRedirectPref.smali:176`** | `В()`（111–244） | 分支 A |
| **`FeaturePackRedirectPref.smali:214`** | `В()`（111–244） | 分支 B |

#### 3.10.2 两个 XML 里 `fp1` 分别怎么声明

| 位置 | 声明 | 关键属性差异 |
| --- | --- | --- |
| **`res/xml/singlepane.xml:10`**（设置根页顶部动态区） | `<FeaturePackPref android:background="@drawable/settings_feature_pak_background" android:key="fp1" w:skipSearch="true" **w:removeAsNeeded="true"** />` | 有 `background`（卡片背景）+ **`removeAsNeeded`**；**无** `buttonOnly` ⇒ 有标题 |
| **`res/xml/feature_packages.xml:11`**（关于子页） | `<FeaturePackPref android:key="fp1" w:skipSearch="true" **w:buttonOnly="true"** />` | **无** `background`、**无** `removeAsNeeded`；**有 `buttonOnly`** ⇒ 只显示按钮 |

> `singlepane.xml` 顶部是一个「动态区」（L4–L12 共 9 个条目，全部带 `w:removeAsNeeded="true"` 或 `w:skipSearch="true"`）：
> `manage_app_warn` / `perm_warn` / `LicenseStatusPref` / `BuyPlayFvPref` / `BuyRustoreFvPref` / `BuyHuaweiFvPref` / **`fp1`** / `already_purchased` / `feature_packages`。
> 这些条目**按购买状态动态出现或消失**，`fp1` 是其中之一。

#### 3.10.3 切换的运行时逻辑

**共 4 段代码形成一个闭环。**

**① 决策：`FeaturePackRedirectPref.В()`（`singlepane.xml:12` 的条目）**【实证·产物】`FeaturePackRedirectPref.smali:111-250`

```asm
115:    iget-boolean v0, p0, FeaturePackRedirectPref;->i:Z    ; i = removeAsNeeded
119:    if-eqz v0, :cond_5                                    ; 没写 removeAsNeeded → 不干预，super.В()（:248）
123:    sget-object v0, Lׅ/y40;->H:Lׅ/z20;
127:    iget v0, v0, Lׅ/a30;->А:I                             ; 应用版本
131:    const/16 v1, 0xe5
138:    if-lt v0, v1, :cond_0
142:    const/4 v0, 0x1                                        ; v0 = (ver >= 229)
145:    goto :goto_0
149:    :cond_0
150:    const/4 v0, 0x0
153:    :goto_0
154:    sget-object v1, Lׅ/wr;->w0:Lׅ/z20;
157:    iget v1, v1, Lׅ/a30;->А:I
161:    and-int/2addr v1, v2                                   ; w0.А & 1
164:    if-eqz v1, :cond_1
168:    goto :goto_1                                           ; → :213（保留）
172:    :cond_1
173:    if-eqz v0, :cond_3
176:    sget-object v0, Lׅ/wr;->x0:Lׅ/pb1;                     ; ★ move_fp1_to_about
180:    iget-boolean v0, v0, Lׅ/fc;->А:Z
184:    if-eqz v0, :cond_2
188:    goto :goto_1                                           ; → :213（保留）
192:    :cond_2
192:    invoke-virtual {p0}, PrefBase;->getParentGroup()...
200:    if-eqz v0, :cond_4
204:    invoke-virtual {v0, p0}, PreferenceGroup;->removePreference(...)   ; ★ 自删 A
212:    :cond_3
213:    :goto_1
214:    sget-object v0, Lׅ/wr;->x0:Lׅ/pb1;                     ; ★ move_fp1_to_about（第二判）
218:    iget-boolean v0, v0, Lׅ/fc;->А:Z
222:    if-eqz v0, :cond_4
226:    invoke-virtual {p0}, PrefBase;->getParentGroup()...
234:    if-eqz v0, :cond_4
238:    invoke-virtual {v0, p0}, PreferenceGroup;->removePreference(...)   ; ★ 自删 B
243:    :cond_4
244:    return-void
247:    :cond_5
248:    invoke-super {p0}, RedirectPreference;->В()V
```

【推断】这段的分支语义（按代码结构还原）：

| `move_fp1_to_about` | `w0.А & 1`（功能包可用位） | 结果 |
| :---: | :---: | --- |
| 任意 | **1**（功能包可用） | **保留**（`:168` → `goto_1` → `:213`） |
| **`false`**（留在设置根页） | 0 | 若 `ver>=229` 且 **`x0 == false`** ⇒ **自删 A**（`:204`）；否则落到 `:213` 再判 |
| **`true`**（已移到关于页） | 0 | 走 `:214` → **`x0 == true`** ⇒ **自删 B**（`:238`） |

> **语义一句话**：`singlepane.xml:12` 那个 `feature_packages` **入口行**，在「功能包不可用」时按 `move_fp1_to_about` 决定去留；
> 而当 `move_fp1_to_about == true`（用户把 `fp1` 移到了关于页）时，设置根页上那张 **`feature_packages` 卡片会被删掉**，
> 避免「设置根页有关闭卡片、关于页也有卡片」的重复曝光。

**② 通知：`p91.Q()` 段 1 + `tc(5)`（§3.4.1）**

`move_fp1_to_about` 一旦切换 → `tc(5)` → `n91.р.post(0x7f0d0530, …)` 到 **`bus_app_cmd`**。

**③ 接收：4 个订阅者同时刷新**

`0x7f0d0530`（`id/cmd_app_feature_pak_settings_refresh`）的全树出现点【实证·产物】：

| 位置 | 角色 |
| --- | --- |
| `p91.smali:73` | **接收**（`onBusMsg`，`:78` 判等）→ `b71.у()` → **重建 feature_packages 页** |
| **`r91.smali:180`** | **接收**（`general` 页的 `onBusMsg`）→ **重建 general 页** |
| `tc.smali:563` | **发送**（`move_fp1_to_about` 变更） |
| `va1.smali:524` | **接收**（`singlepane` 页）→ **重建设置根页** |

**④ 生效：整页重建（§3.4.2）**

三页各自 `setPreferenceScreen(null)` + `addPreferencesFromResource`，于是：
- 设置根页重新评估 `singlepane.xml:10` 的 `fp1`（`removeAsNeeded` → 可能被 `X()` 删）
- 关于页重新装配 `feature_packages.xml:11` 的 `fp1`（`buttonOnly` → 按钮形态）
- 关于页重新装配整个 `feature_packages.xml`，含 `isPriceReduced` 的条件删除

> **完整闭环**：
> ```
> 用户在「关于 → Feature Packages」切换 move_fp1_to_about
>   → MultilineSwitchPreference 触发 OnPreferenceChange
>   → tc(5)                              [p91.smali:31-34]
>   → n91.р.post(0x7f0d0530) to bus_app_cmd   [tc.smali:563-568]
>   → 三页 onBusMsg 各自 b71.у()/n91.у()
>   → 三页整页重建 → fp1 从一页"消失"、在另一页"出现"
> ```
> **这就是「一个开关控制一个控件在哪个页面显示」的完整实现**——
> 不是 `View` 搬家，而是**两页各有一份 `fp1` 声明，靠 `removeAsNeeded`/`buttonOnly` 两个 attr 与一个持久化布尔在重建时决定去留**。

---

## 4. `translations` 页

### 4.1 页面身份

| | |
| --- | --- |
| XML | `res/xml/translations.xml`，**4913 字节 / 36 行**【实证·原文】 |
| 资源 id | **`0x7f160029`** |
| 根节点 | `<PreferenceScreen android:title="@string/pref_translations" **w:skipSearch="true"**>` — L2，**根节点独有** |
| 页面标题 | `@string/pref_translations` = **"Translations"**（`strings.xml:1682`） |
| 元素 / key | **32 / 1** |
| 结构 | 1 个 `PreferenceCategory`（`Translators`）+ **30 个 `Preference`**（1 个 Crowdin 入口 + **29 个语言行**） |
| helper | **`ׅ/z61`（通用分派器）**，页索引 **`j = 0x10` (16)** |
| **有效代码** | **`z61.smali:2133-2173`，41 行 / 946 字节** = `z61` 全类的 **0.8%** |
| `restore_defaults` | **无** |
| `w:target` | **0**（叶子页） |

### 4.2 36 行 / 32 元素逐条实证

**「36 行 ≠ 32 元素」的差异说明**（这是任务书要求核实的点）：

```
36 行 = 1（<?xml?>）+ 2（根标签跨 L2-L3）+ 1（L4 Crowdin）+ 1（L5 Category 开）
        + 29（L6-L34 语言行）+ 1（L35 Category 闭）+ 1（L36 根闭）
元素 = 1（根）+ 1（Category）+ 30（Preference）= 32
```

**⇒ 32 个元素是准确的**（既有文档 §6.2 口径正确）；"36" 是**文件行数**，不是元素数。

| 行 | # | 控件类 | key | 标题 | 摘要 |
| ---: | ---: | --- | --- | --- | --- |
| 1 | — | *(`<?xml?>`)* | — | — | — |
| 2–3 | **1** | `PreferenceScreen` | — | `@string/pref_translations` = **Translations** | — | 
| 4 | **2** | `Preference` | **`visit_crowdin`** | `@string/pref_crowdin_project` = **Poweramp Crowdin Project** | **`Visit/join Poweramp translation project at Crowdin.net`**（**XML 内联字面量**，非资源） |
| 5 | **3** | `PreferenceCategory` | — | `@string/pref_translators` = **Translators** | — |
| 6 | **4** | `Preference` | — | `Arabic` | `BLueBLaze, mohjif, Abdullah S Almalki, tictac, Sajed ALAJATI, khansaab, zaid.m.alani, and others` |
| 7 | **5** | `Preference` | — | `Bengali` | `abualam002, MD: Ashikur Rahman, Emilia Mihai, Dok Dok, fuadhasanmaruf, Mahdi Jaman, MD: Ashikrrahman, and others` |
| 8 | **6** | `Preference` | — | `Chinese Simplified` | `Cye3s, sincostandx, Ihon Liu, 天外来客bin, 琳 曹, Miao Zhang, Jane Zhang, Budi Pang, 吴天豪, and others` |
| 9 | **7** | `Preference` | — | `Chinese Traditional` | `Francis Yeh, 人工知能, Jane Zhang, KaiChing Chang, Fu Chun Hsu, 明城, and others` |
| 10 | **8** | `Preference` | — | `Czech` | `MySQL, andrewz, Ondřej Zástěra, Ghull, karanco, Jan Havlík, Michal, Dominik Matus, and others` |
| 11 | **9** | `Preference` | — | `Danish` | `NCAA, chreddy, John Hansen` |
| 12 | **10** | `Preference` | — | `Dutch` | `Erik Paelman, wsnel57, Naxiz, KevinHofstede, charliehpoels, JayJay1989, YolandaCarati` |
| 13 | **11** | `Preference` | — | `French` | `AlbatorV, クリスDownix, AsTro, Fauque Benoit, Sceap, tictac, Rose, Francesco Masini, and others` |
| 14 | **12** | `Preference` | — | `German` | `Andreas Laufer, Fusionplayz, Vincent T., Saintscar, Stefan Druwe, 明城liebst20` |
| 15 | **13** | `Preference` | — | `Greek` | `koliglia, tkredmond, Nikos, BillKan, DainBramaged, DimitrisSalonika, horion70, and others` |
| 16 | **14** | `Preference` | — | `Hebrew` | `Rami Heled, Lidor Elmaliach, benjo24, elyashiv_sabach, עמרי עטייה, Yoel IL, and others` |
| 17 | **15** | `Preference` | — | `Hindi` | `Ankush Jain, jznsamuel, santosh_sahu, Shivaji Kute, Vatsal_Vala, Vogendra Sahu (Raj. C.G), and others` |
| 18 | **16** | `Preference` | — | `Hungarian` | `Z737, Tomi_Ohl, nvi9, Gyula Király, Szilard Kovacs, Gyula Juhász, Bence Ujj, and others` |
| 19 | **17** | `Preference` | — | `Indonesian` | `M Akmal, Muhammad Bintang, Ali Muhammad Reyhan, Amirul Huda, M Arif Majidi, and others` |
| 20 | **18** | `Preference` | — | `Italian` | `Federico Di Lorenzo, Tiwi90, Carlo369, DarkRevenger, Fabrizio Cacicia, Francesco Masini, and others` |
| 21 | **19** | `Preference` | — | `Japanese` | `Kanako Inazu, &quot;sunatomo&quot;, kik0220` → 显示为 `Kanako Inazu, "sunatomo", kik0220` |
| 22 | **20** | `Preference` | — | `Korean` | `신윤호, David Cho, WhiteClover, ENVY, PBJUN` |
| 23 | **21** | `Preference` | — | `Persian` | `Ismail Barinkar, AhmadH, alpha1657, Barinkar, esshx8, mahmoodbaghelani, and others` |
| 24 | **22** | `Preference` | — | `Polish` | `0kti, Maciej Minklejn, TiGerPL v19, Kszemek, Piotr Patalong, oskar, Błażej Jeżewski, Povilas Grebliunas` |
| 25 | **23** | `Preference` | — | `Portuguese, Brazilian` | `Skellingtor, Lucas Vinícius, Loui's, André Gama, Henry F., Vinicius Camargo, Leandro Sales, and others` |
| 26 | **24** | `Preference` | — | `Romanian` | `adi petcu, Andrei Sângeorzan, Cornel_Pavel, flor90, Dee Norbert` |
| 27 | **25** | `Preference` | — | `Russian` | `Ka3u6y6a, and others` |
| 28 | **26** | `Preference` | — | `Serbian` | `Ivan Pesic, emv441, Nebojsa Nikolic, Nikola Vukovic, Nikola Đurić, Stefan Marinkovic, and others` |
| 29 | **27** | `Preference` | — | `Spanish` | `Mihai Pantazi, Lesther Tabares, Bruno Herrera, Brandon Zuriel Alonso Alvarado, and others` |
| 30 | **28** | `Preference` | — | `Slovak` | `Maťo, RandomTypek, marttin, wupuchim, profile.trololol` |
| 31 | **29** | `Preference` | — | `Thai` | `BugviewTH, Nana Jipataa, อรรถพล เติมสายทอง` |
| 32 | **30** | `Preference` | — | `Turkish` | `Fatih Fırıncı, Semih Yeşilyurt, sonysinger, elmasevmem, rserdar, Oğuzcan, KBD, and others` |
| 33 | **31** | `Preference` | — | `Ukrainian` | `taras-ko, Bohdan Antokhov, rapkonig, Ka3u6y6a, Oleksandr, taras0012, rapkonig, and others` |
| 34 | **32** | `Preference` | — | `Vietnamese` | `alienyd, Nguyễn Trung Hậu, robot_boy_tn, Thế, thanhtai2009, Quoc Thanh, tandat nguyen, Hoàng Hải Long` |
| 35 | — | *(`</PreferenceCategory>`)* | — | — | — |
| 36 | — | *(`</PreferenceScreen>`)* | — | — | — |

**元素统计（ElementTree 实测）**：

| 类 | 个数 |
| --- | ---: |
| `Preference` | **30** |
| `PreferenceScreen` | 1 |
| `PreferenceCategory` | 1 |
| **合计** | **32** |

**属性统计**：`android:title`×32、`android:summary`×30、`w:skipSearch`×1、`android:key`×1。

**三个可核对的数据瑕疵（原文如此，不修正）**：

1. **不是字母序**：`Spanish`(29) 在 `Slovak`(30) 之前、`Thai`(31) 在 `Turkish`(32) 之前。
   【推断】这是上游 Crowdin 导出顺序，与 `arrays.xml` 的 `pref_language_values` 声明序 **不一致**（两者是不同数据集）。
2. **`Ukrainian` 行（L33）里 `rapkonig` 出现两次**，且 `Ka3u6y6a` 与 `Russian` 行（L27）重复。
3. **语言数 29**，与设置里的语言选项数（`pref_language_values`）不同——**这是译者致谢名单，不是语言清单**。

### 4.3 唯一的 `android:key`

**`visit_crowdin`（`translations.xml:4`）——全页唯一的可交互项。**

`z61` 在 `pswitch_3` 分支里绑它【实证·产物】`z61.smali:2133-2173`（**这就是 `translations` 页的全部代码，41 行**）：

```asm
2133:    :pswitch_3                                       ; ← index 0x10 落这里
2134:    iget-object v1, v0, Lׅ/n91;->K:Landroid/preference/PreferenceScreen;
2138:    const-string v2, "visit_crowdin"
2142:    invoke-virtual {v1, v2}, PreferenceGroup;->findPreference(...)
2147:    move-result-object v1
2150:    if-eqz v1, :cond_11
2154:    new-instance v2, Lׅ/x11;
2158:    const/16 v3, 0x13                                    ; ★ x11 index = 19
2162:    invoke-direct {v2, v3, v0}, Lׅ/x11;-><init>(ILjava/lang/Object;)V
2167:    invoke-virtual {v1, v2}, Preference;->setOnPreferenceClickListener(...)
2172:    :cond_11
2173:    return-void
```

`x11` 的 index `0x13` → `pswitch_5`【实证·产物】`x11.smali:328-346`：

```asm
328:    :pswitch_5
329:    check-cast v3, Lׅ/z61;
333:    iget-object p1, v3, Lׅ/n91;->у:Lcom/maxmpz/audioplayer/preference/SettingsActivity;
337:    const-string v0, "https://crowdin.net/project/poweramp-player"
341:    invoke-static {p1, v0}, Lcom/maxmpz/utils/AUtils;->q(Landroid/content/Context;Ljava/lang/String;)V
346:    return v4                                            ; 返回 true
```

> **`translations` 页的全部行为 = 1 个 `findPreference` + 1 个 `setOnPreferenceClickListener` + 1 个 URL 字面量。**
> URL 硬编码在 `x11.smali:337`：**`https://crowdin.net/project/poweramp-player`**。
> **29 个语言行完全不可交互**——无监听、无 `w:target`、无 `<intent>`、无 `android:persistent`。

### 4.4 为什么这页用 `z61` 而不是专用 helper

**先纠正一个容易混淆的对照关系**：`feature_packages` **有**专用 helper（`p91`），`translations` **没有**。
两页分属两种解法：

| 页面 | 元素 | key | 专用 helper？ | 体积 | 观察 |
| --- | ---: | ---: | --- | ---: | --- |
| `feature_packages` | 15 | **6** | **是**（`p91`） | 2618 B | 6 个 key + 3 个自定义控件 + 条件删除 + 总线刷新 → **必须专用** |
| **`translations`** | **32** | **1** | **否**（`z61`） | 有效 946 B | 1 个 key 绑 1 个 URL → **41 行足够** |
| `support`（非本分支） | 5 | 4 | 是（`xa1`，3744 B） | — | 4 个 key 各需不同回调（2 URL + 1 对话框 + 1 版本门） |
| `commands_history`（非本分支） | 1 | 0 | 是（`o91`，22210 B） | — | 0 key 但全动态生成 + 菜单 |

> **决定「是否专用 helper」的不是 XML 大小，而是「是否需要框架外的新机制」**：
>
> | 页面 | 需要什么 | 结论 |
> | --- | --- | --- |
> | `translations` | 「给 1 个 item 绑 1 个 URL」——现成 `x11(0x13)` 够 | **塞进 `z61`** |
> | `feature_packages` | 「3 个自定义控件类装配 + 2 个 styleable 读取 + 条件自删 + 三页联动刷新」——`z61` 里任何分支都不该干这个 | **专用 `p91`** |
>
> **反过来看更清楚**：`z61` 的 20 个 `pswitch` 分支里，`pswitch_3`（translations）只有 41 行，
> 而 `pswitch_b`（`library_lists`）有 **622 行**、`pswitch_2`（`ui`）有 **551 行**。
> `translations` 的代码量不是「小」，而是「**根本不需要代码**」——它是一份**纯静态清单**。

### 4.5 整页是否带 `skipSearch`

**是。`translations.xml:2` 的根节点带 `w:skipSearch="true"` ⇒ 整份 XML 不进搜索索引。**

【实证·原文】`translations.xml:2`：

```xml
<PreferenceScreen android:title="@string/pref_translations" w:skipSearch="true"
```

**正确的判定方法**（避免误判）：只取**第一个** `<PreferenceScreen …>` 标签判断。
ElementTree 实测：`translations.xml` 的 `PreferenceScreen` 元素数 = **1**（无嵌套），
故「根节点带 skipSearch」= 「整份 XML 被文档级规则排除」，无歧义。

**文档级 `skipSearch` 的代码路径**（与条目级完全不同）【实证·产物】`PrefSearchIndexer.smali:498-950`：

```java
void y(int xmlResId, XmlResourceParser parser) {
    ...
    TypedArray t = ctx.obtainStyledAttributes(attrs, qt0.O0);       // :559-563
    if (u9.х(t, /*idx*/1, /*def*/false)) return;                    // :578-586  ★ 文档级 skipSearch
    ...
}
```

`qt0.O0` 的 6 个 attr【实证·产物】`qt0.smali`（`O0` 数组重建实测）：

| 索引 | attr id | 名称 |
| ---: | --- | --- |
| 0 | `0x10101e1` | `android:title` |
| **1** | **`0x7f0105f2`** | **`w:skipSearch`** ← 文档级读这个 |
| 2 | `0x7f0105f3` | `w:searchIndexer` |
| 3 | `0x7f0105f4` | `w:searchBreadcrumb1` |
| 4 | `0x7f010632` | `w:ignoreTitle` |
| 5 | `0x7f010c00` | `w:skipSearchForSDK` |

**本 build（`bundle-play`）下 `skipSearch="true"` 的判定**：

`u9.х()`【实证·产物】`u9.smali:467-588`：

```asm
467: .method public static х(Landroid/content/res/TypedArray;IZ)Z
471:     invoke-virtual {p0, p1}, TypedArray;->peekValue(I)...
479:     if-nez v0, :cond_0
483:     return p2                                  ; 无值 → 默认
487:     iget v0, v0, Landroid/util/TypedValue;->type:I
491:     const/16 v1, 0x12                          ; TYPE_INT_BOOLEAN
495:     if-ne v0, v1, :cond_1
499:     invoke-virtual {p0, p1, p2}, TypedArray;->getBoolean(IZ)Z
507:     if-eqz p2, :cond_1
511:     goto :goto_1                               ; ★ 布尔 true → 立即 return true
515: :cond_1
515:     invoke-virtual {p0, p1}, TypedArray;->getString(I)String
523:     invoke-static {p0}, TUtils;->isEmpty(...)Z
539:     const-string p1, "play"                    ; ★ token 1
543:     invoke-static {p0, p1}, Lׅ/nn;->В(String,String)Z
551:     if-nez p1, :cond_4
555:     const-string p1, "pa"                      ; ★ token 2（Edition.APP）
559:     invoke-static {p0, p1}, Lׅ/nn;->В(String,String)Z
576:     const/4 p0, 0x0
582: :cond_4
584:     const/4 p0, 0x1
```

> **`translations.xml:2` 走的是 `:487`–`:511` 的布尔短路路径**（`"true"` → `TYPE_INT_BOOLEAN` → `getBoolean` → `:511` 直接返回 `true`），
> **完全不进入 `:539`/`:555` 的 token 比较**。所以**整页排除与构建变体无关，恒定生效**。
>
> **⚠ 重要勘误（影响 `general.xml:15`，不影响本文两页）**：`u9.х()` 只认 **`"play"`** 与 **`"pa"`** 两个 token，
> 全文件**没有 `"huawei"` 分支**，也不读 `Build.BRAND`。
> 所以 `general.xml:15` 的 `visit_site_about` 写 `w:skipSearch="play,huawei"` 时：
>
> | 变体 | `"play"` 命中？ | `"pa"` 命中？ | 结果 |
> | --- | :---: | :---: | --- |
> | `bundle-play`（本 build） | ✅ | ✅ | **true（跳过）** |
> | `bundle-huawei` | ❌ | ❌ | **false（参与索引）** |
> | `bundle-uni` | ❌ | ❌ | **false（参与索引）** |
>
> **`"huawei"` 是死值**，该属性的实际语义等价于 `skipSearch="play"`。
> 本文两页的 `skipSearch`（`feature_packages.xml:11` 的 `fp1`、`translations.xml:2` 的根节点）都是**布尔 `"true"`**，**不受此勘误影响**。

**`nn.В(String,String)` 的匹配语义**【实证·产物】`nn.smali`（1665 B，`.super Lcom/maxmpz/audioplayer/Edition;`）：
`indexOf(token, from)` 循环 + 校验命中位置**后一字符是 `,`（`0x2c`）**或已到串尾、**前一字符是 `,`** 或 `i==0`。
即「**逗号分隔的精确成员匹配**」。

### 4.6 全部 `@string` 英文实文

`translations.xml` **只有 3 个元素引用字符串资源，其余 29 个全是 XML 内联字面量**——这是本页最显著的特征。

| # | 资源名 | 英文实文 | 声明行 | 引用点 |
| ---: | --- | --- | ---: | --- |
| 1 | `pref_translations` | `Translations` | **1682** | `translations.xml:2`（根 title） |
| 2 | `pref_crowdin_project` | `Poweramp Crowdin Project` | **1072** | `translations.xml:4`（title） |
| 3 | `pref_translators` | `Translators` | **1683** | `translations.xml:5`（Category title） |

**内联字面量（非资源）**：

- `translations.xml:4` 的 `android:summary` = `Visit/join Poweramp translation project at Crowdin.net`
  —— **直接写在 XML 里，不可翻译、不进 `strings.xml`**。对照 `feature_packages.xml` 全页 15 条全是 `@string`，**这是两页最大的资源化程度反差**。
- `translations.xml:6-34` 的 29 条 `android:title`（语言英文名）与 29 条 `android:summary`（译者名单）**全部是内联字面量**。

> **后果**：这 58 条字符串**不参与任何本地化**（无 `values-xx/` 变体），且**不进搜索索引**（整页被根节点 `skipSearch` 排除）。
> 【推断】这正是产品意图——译者名单本身是「原文数据」，翻译它没有意义；而语言名用英文是为了让**任何语言的使用者**都能找到自己的语言。

**`PrefCategory` 文案对照**：`pref_translators` = `Translators`（`strings.xml:1683`）。

### 4.7 条目组织方式

| 维度 | 结论 |
| --- | --- |
| **是否用分类分组** | **是**，且**只有 1 个** `PreferenceCategory`（`Translators`）。Crowdin 入口（L4）在分类**之外**、页面**最顶部** |
| **是否有富文本链接** | **否**。全页 30 个 `Preference` **无一个** `<intent>`、`android:summary` 里**无 HTML 标签**、无 `w:useHtml`、无 `w:line1` 富文本 |
| **是否可点击** | 仅 L4（`visit_crowdin`）有监听；**29 个语言行全部不可交互**（纯展示） |
| **排序** | 非字母序，非 `pref_language_values` 序——【推断】上游 Crowdin 导出序 |
| **单行信息密度** | 每行 = 语言名（title）+ 译者名单（summary）；长名单以 `, and others` 截断 |
| **摘要换行** | 无 `w:singleNewline`、无 `w:reducedPad`——29 行全部用**默认行距**（对照 `feature_packages` 有 5 个 `w:reducedPad`） |

> **与 `feature_packages` 的结构反差**：
>
> | 维度 | `feature_packages` | `translations` |
> | --- | --- | --- |
> | `PreferenceCategory` 数 | 1（`other`） | 1（`Translators`） |
> | 自定义控件类数 | **6** | **0**（全是裸 `Preference`） |
> | `@string` 引用数 | **15**（全部） | **3**（其余 58 条内联） |
> | 富文本 attr（`w:line1/2/3`） | **10** 处 | **0** |
> | 间距 attr（`reducedPad`/`zeroTopPad`） | **7** 处 | **0** |
> | 可交互条目 | 6（全部 6 个 key） | 1（唯一 key） |

---

## 5. `z61` 的分页索引机制

### 5.1 `z61` 的身份

| | |
| --- | --- |
| 路径 | `smali/ׅ/z61.smali` |
| 体积 | **118199 字节 / 4866 行** |
| 声明 | `.class public final Lׅ/z61;`（`:1`） |
| 父类 | `.super Lׅ/n91;`（`:2`） |
| 页索引字段 | **`.field public final synthetic j:I`**（**`:7`**） |

### 5.2 构造期 int index

【实证·产物】`z61.smali:11-25`：

```asm
11: .method public synthetic constructor <init>(Lcom/maxmpz/audioplayer/preference/SettingsActivity;Lׅ/m91;III)V
15:     iput p5, p0, Lׅ/z61;->j:I                                    ; ★ 第 5 参 → 字段 j
19:     invoke-direct {p0, p1, p2, p3, p4}, Lׅ/n91;-><init>(...)V     ; 前 4 参喂基类
25: .end method
```

| 构造参数 | 类型 | 去向 | 语义 |
| ---: | --- | --- | --- |
| `p1` | `SettingsActivity` | `n91.<init>` → `n91.у` | Activity |
| `p2` | `m91` | `n91.<init>` → `n91.Н` | PreferenceFragment 接口 |
| `p3` | `int` | `n91.<init>` → **`n91.y`** | 本页 XML 资源 id |
| `p4` | `int` | `n91.<init>` → **`n91.C`** | **父页 XML 资源 id**（`n91.р()` 转成 res entry name 做面包屑） |
| **`p5`** | `int` | **`z61.j`** | **页索引（分派键）** |

> **这就是「构造期 int index 分派」**：`z61` 是一个**被 21 个页面共用的** helper，
> 每页在 `u61` 里 `new z61(activity, fragment, **本页 id**, **父页 id**, **索引**)`，
> 索引通过 `p5` 存进 `j`，之后 `v()` / `Х()` / `х()` 都靠读 `j` 分派。
>
> **同一模式的其他类**：`y61`（多 index）、`la1`（多 index）、`tc`（10 index）、`x11`（25 index）。

### 5.3 `v()` 的 `packed-switch`（完整对照表）

**`v()` 的物理布局**【实证·产物】`z61.smali`：

| 位置 | 内容 |
| ---: | --- |
| **857** | `.method public final v()V`（`.locals 16`） |
| 865 | `iget v1, v0, Lׅ/z61;->j:I` ← 读索引 |
| 901–917 | 寄存器预载（`"get_support"` / `"restore_defaults"` 等常量） |
| **919** | **`packed-switch v1, :pswitch_data_0`** ← **分派点** |
| 921–1272 | **default 块（352 行）** |
| 1275–4704 附近 | 20 个 `:pswitch_N` 分支体 |
| **4752** | **`:pswitch_data_0`** ← **switch 表起始** |
| **4753** | **`.packed-switch 0x0`**（20 项） |
| **4774** | `.end packed-switch` |
| 4775 | `.end method` |

**switch 表原文**【实证·产物】`z61.smali:4752-4774`：

```asm
4752:    :pswitch_data_0
4753:    .packed-switch 0x0
4754:        :pswitch_13
4755:        :pswitch_12
4756:        :pswitch_11
4757:        :pswitch_10
4758:        :pswitch_f
4759:        :pswitch_e
4760:        :pswitch_d
4761:        :pswitch_c
4762:        :pswitch_b
4763:        :pswitch_a
4764:        :pswitch_9
4765:        :pswitch_8
4766:        :pswitch_7
4767:        :pswitch_6
4768:        :pswitch_5
4769:        :pswitch_4
4770:        :pswitch_3
4771:        :pswitch_2
4772:        :pswitch_1
4773:        :pswitch_0
4774:    .end packed-switch
```

> **只有 20 项 ⇒ 索引 `0x0`–`0x13` 有分支，`0x14` 及以**上**落 default 块**。

#### 5.3.1 **index → 页面 → `pswitch` 完整对照表（21 条）**

数据来源：`u61.onCreate`（`:90-1881`）的 21 个 `new-instance ... Lׅ/z61;` 点 + `public.xml` 的资源名反查 + `z61.smali:4752-4774` 的 switch 表。

| # | **index** | XML id | 页面名 | `u61` `const` 行 | `if-ne` 行 | `new` 行 | `ctor` 行 | **落 `pswitch_`** | **分支起始行** | 分支体行数 |
| ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 1 | **`0x00`** (0) | `0x7f160002` | `already_purchased` | 456 | 461 | 465 | 475 | **`pswitch_13`** | **4704** | 46 |
| 2 | **`0x01`** (1) | `0x7f160003` | `audio` | 920 | 925 | 929 | 944 | **`pswitch_12`** | **4700** | 2 |
| 3 | **`0x02`** (2) | `0x7f160007` | `audio_focus` | 983 | 988 | 992 | 1002 | **`pswitch_11`** | **4597** | ~100 |
| 4 | **`0x03`** (3) | `0x7f16000a` | `audio_outputs_tweaks` | 1281 | 1286 | 1290 | 1300 | **`pswitch_10`** | **4459** | 136 |
| 5 | **`0x04`** (4) | `0x7f16001f` | `peq_equ_bands` | 1178 | 1183 | 1192 | 1202 | **`pswitch_f`** | **4276** | 181 |
| 6 | **`0x05`** (5) | `0x7f16000d` | `audio_tweaks` | 1037 | 1046 | 1051 | 1061 | **`pswitch_e`** | **3955** | 319 |
| 7 | **`0x06`** (6) | `0x7f16000f` | `buy_methods` | 484 | 489 | 493 | 503 | **`pswitch_d`** | **3902** | 51 |
| 8 | **`0x07`** (7) | `0x7f160012` | `fade` | 954 | 959 | 963 | 973 | **`pswitch_c`** | **3675** | 225 |
| 9 | **`0x08`** (8) | `0x7f160017` | `library_lists` | 1403 | 1408 | 1412 | 1423 | **`pswitch_b`** | **3051** | **622** |
| 10 | **`0x09`** (9) | `0x7f160019` | `library_queue` | 1463 | 1468 | 1472 | 1483 | **`pswitch_a`** | **2925** | 124 |
| 11 | **`0x0a`** (10) | `0x7f16001a` | `library_scanner` | 1546 | 1551 | 1555 | 1566 | **`pswitch_9`** | **2765** | 158 |
| 12 | **`0x0b`** (11) | `0x7f16001b` | `library_search` | 1433 | 1438 | 1442 | 1453 | **`pswitch_8`** | **2600** | 163 |
| 13 | **`0x0c`** (12) | `0x7f16001c` | `library_shuffle` | 1516 | 1521 | 1525 | 1536 | **`pswitch_7`** | **2566** | 32 |
| 14 | **`0x0d`** (13) | `0x7f16000c` | `audio_resampler` | 1125 | 1130 | 1134 | 1145 | **`pswitch_6`** | **2465** | 99 |
| 15 | **`0x0e`** (14) | `0x7f160023` | `rg` | 1095 | 1100 | 1104 | 1115 | **`pswitch_5`** | **2284** | 179 |
| 16 | **`0x0f`** (15) | `0x7f160027` | `space` | 1703 | 1708 | 1712 | 1726 | **`pswitch_4`** | **2176** | 106 |
| 17 | **`0x10`** (16) | **`0x7f160029`** | **`translations`** ★ | **1599** | **1604** | **1608** | **1624** | **`pswitch_3`** | **2133** | **41** |
| 18 | **`0x11`** (17) | `0x7f16002a` | `ui` | 539 | 544 | 548 | 564 | **`pswitch_2`** | **1580** | **551** |
| 19 | **`0x12`** (18) | `0x7f160030` | `ui_theme` | 575 | 580 | 585 | 596 | **`pswitch_1`** | **1576** | 2 |
| 20 | **`0x13`** (19) | `0x7f16002e` | `ui_notify` | 777 | 782 | 786 | 797 | **`pswitch_0`** | **1275** | ~200 |
| 21 | **`0x14`** (20) | `0x7f16002f` | **`ui_player`** | 701 | 706 | 710 | 732 | **★ default（无分支）** | **921** | 352 |

**条目数：21**

> **三条重要观察**：
>
> 1. **`0x14`（`ui_player`）没有 `pswitch` 条目**——它落 **default 块**（`z61.smali:921-1272`）。
>    default 块的内容正是 `ui_player.xml` 的条目：`cc_button`（`:928`，`ui_player.xml:18`）、`hint_5stars`（`:962`，`ui_player.xml:20`）。
>    **所以 default 块不是"错误分支"，而是 `ui_player` 的隐式分支**。
> 2. **索引顺序不是页面顺序**：`pswitch_13`（idx 0）在 `z61.smali:4704`（靠后），`pswitch_0`（idx 0x13）在 `:1275`（靠前）。
>    **`pswitch` 编号与源码位置反向**——这是 smali 编译器的 label 命名习惯，**不能按 label 号推 index**。
> 3. **`ui` 是 `0x7f16002a`，`ui_player` 是 `0x7f16002f`**（既有文档 §6.4 表把 `0x7f16002f` 记作 `ui`，属**勘误**）。

#### 5.3.2 `R()` 与 `translations` 的关系

**`R()` 不做索引分派**——这是任务书问题的核心答案。

【实证·产物】`z61.smali:236-586`（351 行）：

```asm
236: .method public R()V
237:     .locals 7
240:     sget-object v0, Lׅ/sh0;->e:Ljava/lang/Object;
244:     invoke-static {}, Lׅ/ny;->H()I                       ; 通知模式
252:     iget-object v1, p0, Lׅ/n91;->K:Landroid/preference/PreferenceScreen;
256:     const-string v2, "notify_colorize"                    ; key 1
260:     invoke-virtual {v1, v2}, PreferenceGroup;->findPreference(...)
268:     sget v2, Landroid/os/Build$VERSION;->SDK_INT:I
272:     const/16 v3, 0x1a                                     ; 26
286:     if-lt v2, v3, :cond_1
294:     if-ne v0, v6, :cond_0
301:     goto :goto_0
309:     invoke-virtual {v1, v2}, Preference;->setEnabled(Z)V
314:     invoke-virtual {v1, v4}, Preference;->setOnPreferenceChangeListener(...)
322: :cond_1
323:     if-eqz v1, :cond_2
331:     invoke-virtual {v2, v1}, PreferenceGroup;->removePreference(...)    ; 移除 notify_colorize（SDK<26）
342:     const-string v2, "notify_prefer_nav"                  ; key 2
346:     invoke-virtual {v1, v2}, PreferenceGroup;->findPreference(...)
373:     invoke-virtual {v1, v2}, Preference;->setEnabled(Z)V
383:     const-string v2, "notification_colors"                ; key 3
387:     invoke-virtual {v1, v2}, PreferenceGroup;->findPreference(...)
410:     invoke-virtual {v1, v0}, Preference;->setEnabled(Z)V
415:     invoke-virtual {v1, v4}, Preference;->setOnPreferenceChangeListener(...)
424:     const-string v1, "notification_type_msg"              ; key 4
428:     invoke-virtual {v0, v1}, PreferenceGroup;->findPreference(...)
440:     iget v3, v2, Lׅ/a30;->А:I
444:     if-eqz v3, :cond_6
448:     if-nez v0, :cond_7
452:     new-instance v0, Lcom/maxmpz/audioplayer/preference/RawTextPreference;    ; ★ 现场 new 一个条目
463:     invoke-direct {v0, v3, v4}, RawTextPreference;-><init>(Context;AttributeSet;)V
468:     invoke-virtual {v0, v5}, Preference;->setOrder(I)V
478:     invoke-virtual {v0, v3}, Preference;->setSummary(I)V
483:     invoke-virtual {v0, v1}, Preference;->setKey(Ljava/lang/String;)V
488:     invoke-virtual {v0, v6}, RawTextPreference;->setZeroTopPad(Z)V
497:     invoke-virtual {v1, v0}, PreferenceGroup;->addPreference(...)
514:     invoke-virtual {v1, v0}, PreferenceGroup;->removePreference(...)        ; 移除（:506 的 cond_6 分支）
521:     const-string v0, "buttons"                            ; ★ key 5
525:     iget-object v1, p0, Lׅ/n91;->K:Landroid/preference/PreferenceScreen;
529:     invoke-virtual {v1, v0}, PreferenceGroup;->findPreference(...)
534:     move-result-object v0
537:     if-eqz v0, :cond_b
541:     sget-boolean v1, Lׅ/nr0;->В:Z                         ; ★ SDK >= 33 ?
545:     if-nez v1, :cond_8
549:     iget-object v1, p0, Lׅ/n91;->K:Landroid/preference/PreferenceScreen;
553:     invoke-virtual {v1, v0}, PreferenceGroup;->removePreference(...)   ; ★ SDK<33 → 删 buttons
558:     return-void
562:     :cond_8
562:     iget v1, v2, Lׅ/a30;->А:I
566:     if-eqz v1, :cond_9
570:     if-ne v1, v6, :cond_a
575:     :cond_9
575:     const/4 v5, 0x1
579:     :cond_a
579:     invoke-virtual {v0, v5}, Preference;->setEnabled(Z)V
584:     :cond_b
585:     return-void
```

**`nr0.В` 的定义**【实证·产物】`nr0.smali`（**634 B / 43 行**）：

```asm
19:     const/16 v1, 0x21          ; 33
23:     if-lt v0, v1, :cond_0
27:     const/4 v0, 0x1
34: :cond_0
34:     const/4 v0, 0x0
38:     sput-boolean v0, Lׅ/nr0;->В:Z
```

⇒ **`nr0.В` = `Build.VERSION.SDK_INT >= 33`**（`:19` 的 `0x21` = 33）。

**核实任务书的三个行号**：

| 任务书 | 实测 | 一致？ |
| --- | --- | --- |
| `z61.smali:521` — `const-string v0, "buttons"` | **521** | ✅ |
| `z61.smali:541` — `sget-boolean v1, Lׅ/nr0;->В:Z` | **541** | ✅ |
| `z61.smali:553` — `removePreference` | **553** | ✅ |

**`R()` 的行为（5 个 key 全部是 ui_notify 的条目）**：

| key | `findPreference` 行 | 动作 |
| --- | ---: | --- |
| `notify_colorize` | 256 | SDK≥26 → 启用/绑定监听；**SDK<26 → `removePreference`（`:331`）** |
| `notify_prefer_nav` | 342 | `setEnabled`（`:373`） |
| `notification_colors` | 383 | `setEnabled`（`:410`）+ 绑监听（`:415`） |
| `notification_type_msg` | 424 | 条件 `new RawTextPreference` 并 `addPreference`（`:452`–`:497`），**或** `removePreference`（`:514`） |
| **`buttons`** | 521 | **SDK<33 → `removePreference`（`:553`）**；SDK≥33 → `setEnabled`（`:579`） |

#### 5.3.3 **`R()` 对 `translations` 页有无特殊处理？——没有，而且根本不执行**

**`R()` 的调用点全树只有 2 处**【实证·产物】：

| 调用点 | 所在分支 | 对应页面 |
| --- | --- | --- |
| **`z61.smali:1306`** | `:pswitch_0`（起 `:1275`） | **`ui_notify`（idx `0x13`）** |
| **`p71.smali:739`** | `:pswitch_b`（起 `:717`） | **`p71` 是通用 lambda 持有类**，其 `run()` 的 index `0x0b`（`p71.smali:1218`） |

`z61.smali:1306` 上下文：

```asm
1275:    :pswitch_0                                            ; ← idx 0x13 = ui_notify
1280:    const-string v2, "notification_type"
1292:    new-instance v2, Lׅ/eb1;
1296:    invoke-direct {v2, v0, v15}, Lׅ/eb1;-><init>(Lׅ/z61;I)V
1301:    invoke-virtual {v1, v2}, Preference;->setOnPreferenceChangeListener(...)
1306:    invoke-virtual {v0}, Lׅ/z61;->R()V                    ; ★ 只有 ui_notify 主动调 R()
```

`p71.smali:717-745` 上下文：

```asm
717:    :pswitch_b                                            ; p71 idx 0x0b
718:    check-cast v6, Lׅ/z61;
722:    invoke-virtual {v6, v4}, Lׅ/n91;->s(Z)V               ; setEnabled
727:    iget-boolean v0, v6, Lׅ/n91;->С:Z
731:    if-eqz v0, :cond_8
735:    goto :goto_6
739:    invoke-virtual {v6}, Lׅ/z61;->R()V                    ; ★ 状态回调里再调 R()
744:    :goto_6
745:    return-void
```

> **结论（明确回答任务书的两个问题）**：
>
> 1. **`R()` 对 `translations` 页没有任何特殊处理**——`R()` 的方法体（`:236-586`）**完全不读 `z61.j`**，
>    它固定操作 5 个 `ui_notify` 的 key。**即使被调到，在 `translations` 页上也是 5 次 `findPreference` 全部返回 `null` 然后什么都不做。**
> 2. **`R()` 在 `translations` 页根本不会被调用**——它的 2 个调用点分别在 `ui_notify` 分支（`z61.smali:1306`）
>    和 `p71` 的状态回调（`p71.smali:739`）。`translations` 的 `pswitch_3` 分支（`:2133-2173`）**只有 41 行，不调 `R()`**。
>
> 因此：**「SDK<33 删 `buttons`」这条逻辑与 `translations` 页完全无关**。

### 5.4 `Х()` / `х()` 的二次索引分派

`z61` 还有两个方法也读 `j` 做分派，但规模都很小：

**【实证·产物】`z61.smali:4777-4834`（`Х()`，58 行）**

```asm
4777: .method public Х()V
4781:     iget v0, p0, Lׅ/z61;->j:I
4785:     packed-switch v0, :pswitch_data_0
4790:     invoke-super {p0}, Lׅ/n91;->Х()V          ; ← 绝大多数索引走这里（n91.Х() → BaseApplication.P(true)）
4795:     return-void
4798:     :pswitch_0
4799:     iget-object v0, p0, Lׅ/n91;->у:Lcom/maxmpz/audioplayer/preference/SettingsActivity;
4803:     const-class v1, Lcom/maxmpz/app/base/BaseApplication;
4807:     invoke-static {v0, v1}, Lcom/maxmpz/utils/AUtils;->c(...)
4819:     const/4 v1, 0x0                            ; ★ 0（基类默认是 1）
4822:     invoke-virtual {v0, v1}, Lcom/maxmpz/app/base/BaseApplication;->P(Z)V
4827:     return-void
4830:     :pswitch_data_0
4831:     .packed-switch 0x6                       ; ★ 只有 idx 6（buy_methods）命中
4832:         :pswitch_0
4833:     .end packed-switch
```

> **只有 `buy_methods`（idx `0x6`）覆写 `Х()`**，其余 20 页走 `super`。
> **与 `p91.Х()` 完全同构**（都调 `P(false)`）——见 §3.4.3。这是「**只有交易页把 `Н` 置 false**」的第二个证据。

**【实证·产物】`z61.smali:4836-4866`（`х()`，31 行）**

```asm
4836: .method public х()V
4840:     iget v0, p0, Lׅ/z61;->j:I
4844:     sparse-switch v0, :sswitch_data_0
4849:     invoke-super {p0}, Lׅ/n91;->х()V
4855: :sswitch_0
4855:     return-void
4861:     :sswitch_data_0
4862:     .sparse-switch
4863:         0x0 -> :sswitch_0                     ; already_purchased
4864:         0x6 -> :sswitch_0                     ; buy_methods
4865:     .end sparse-switch
```

> `х()` 的覆写只对 **`already_purchased`（idx 0）** 与 **`buy_methods`（idx 6）** 生效，且动作是「**什么都不做**」（跳过 `super.х()`）。

### 5.5 `z61` 的其余方法索引分派情况

`z61` 全部 15 个方法中，**只有 3 个读 `j`**：

| 方法 | 行区间 | 行数 | 读 `j`？ | 分派方式 |
| --- | ---: | ---: | :---: | --- |
| `I()` | 27–32 | 6 | ❌ | **空方法**（`return-void`） |
| `J()` | 34–39 | 6 | ❌ | **空方法** |
| `N()` | 41–46 | 6 | ❌ | **空方法** |
| `Q()` | 48–53 | 6 | ❌ | **空方法**（★ 实现 `b71` 的抽象 `Q()`，即**不做装配**） |
| `L(Z)` | 57–140 | 84 | ❌ | 无 |
| `M(Boolean)` | 142–234 | 93 | ❌ | 无（操作 `com.maxmpz.audioplayer.USBMainActivity` 的组件启用状态，见 `:171`/`:206`） |
| **`R()`** | **236–586** | **351** | ❌ | **无（固定 5 个 ui_notify key）** |
| `S(String)` | 588–627 | 40 | ❌ | 无 |
| `T(NumberListPreference)` | 629–762 | 134 | ❌ | 无 |
| `b()` | 764–855 | 92 | ✅ | `packed-switch` **`0x12`**（单值，`:851-854`） |
| **`v()`** | **857–4775** | **3919** | ✅ | **`packed-switch` 20 路（`:919` / `:4752`）** ← 主体 |
| **`Х()`** | **4777–4834** | **58** | ✅ | `packed-switch` **`0x6`**（`:4830`） |
| `х()` | 4836–4866 | 31 | ✅ | `sparse-switch` `{0x0, 0x6}`（`:4861`） |

> **`Q()` 是空方法，这是 `z61` 与 `p91` 最大的结构差异**：
> `p91` 用 61 行的 `Q()` 完成装配（`:7-67`），`z61` 把这个钩子**实现为空**，全部装配逻辑搬进 `v()` 的巨型 switch。
> 这解释了为什么 `z61` 会有 3919 行的 `v()`——**它是 20 个页面的 `Q()` 合并体**。

### 5.6 谁在用 `z61`（21 个页面清单）

| # | 页面 | XML id | index | 分支行数 |
| ---: | --- | --- | ---: | ---: |
| 1 | `already_purchased` | `0x7f160002` | 0x00 | 46 |
| 2 | `audio` | `0x7f160003` | 0x01 | 2 |
| 3 | `audio_focus` | `0x7f160007` | 0x02 | ~100 |
| 4 | `audio_outputs_tweaks` | `0x7f16000a` | 0x03 | 136 |
| 5 | `peq_equ_bands` | `0x7f16001f` | 0x04 | 181 |
| 6 | `audio_tweaks` | `0x7f16000d` | 0x05 | 319 |
| 7 | `buy_methods` | `0x7f16000f` | 0x06 | 51 |
| 8 | `fade` | `0x7f160012` | 0x07 | 225 |
| 9 | `library_lists` | `0x7f160017` | 0x08 | **622** |
| 10 | `library_queue` | `0x7f160019` | 0x09 | 124 |
| 11 | `library_scanner` | `0x7f16001a` | 0x0a | 158 |
| 12 | `library_search` | `0x7f16001b` | 0x0b | 163 |
| 13 | `library_shuffle` | `0x7f16001c` | 0x0c | 32 |
| 14 | `audio_resampler` | `0x7f16000c` | 0x0d | 99 |
| 15 | `rg` | `0x7f160023` | 0x0e | 179 |
| 16 | `space` | `0x7f160027` | 0x0f | 106 |
| 17 | **`translations`** | **`0x7f160029`** | **0x10** | **41** |
| 18 | `ui` | `0x7f16002a` | 0x11 | **551** |
| 19 | `ui_theme` | `0x7f160030` | 0x12 | 2 |
| 20 | `ui_notify` | `0x7f16002e` | 0x13 | ~200 |
| 21 | `ui_player` | `0x7f16002f` | **0x14** | 352（default） |
| | **分支体总计** | | | **≈ 3700** |
| | `v()` 总行数 | | | **3919** |

> **`translations`（41 行）是 21 个分支里第三短的**，只比 `audio`（2 行）和 `ui_theme`（2 行）长。
> 而 `v()` 的 3919 行里，**`library_lists`（622）+ `ui`（551）+ `ui_player`（352）+ `audio_tweaks`（319）+ `fade`（225）+ `ui_notify`（200）= 2269 行（58%）** 只服务 6 个页面。

---

## 6. 跨页横向对照

### 6.1 两页 vs 既有文档四页

| 维度 | **`feature_packages`** | **`translations`** | `general` | `support` ※ | `commands_history` ※ |
| --- | --- | --- | --- | --- | --- |
| XML 字节 / 行 | **2618 / 19** | **4913 / 36** | 2563 / 25 | 707 / — | 247 / — |
| 元素 | **15** | **32** | 18 | 5 | 1 |
| `android:key` | **6** | **1** | 13 | 4 | 0 |
| `w:target` | **0** | **0** | 2 | 0 | 0 |
| helper | **`p91`（专用）** | **`z61`（共用）** | `r91`（专用） | `xa1` | `o91` |
| helper 字节 | **2618** | 118199（有效 **946**） | 32207 | 3744 | 22210 |
| **XML : 代码比** | **1 : 1.0** | 1 : 24.1（有效 **1 : 0.19**） | 1 : 12.6 | 1 : 5.3 | 1 : 89.9 |
| 自定义控件类 | **6 类 / 6 实例** | **0** | 8 实例 / 6 类 | 0 | 0 |
| 富文本 attr（`line1/2/3`） | **10 处** | **0** | 0 | 0 | 0 |
| 间距 attr（`reducedPad`/`zeroTopPad`） | **7 处** | **0** | — | — | — |
| `w:widgetLayout` | **2** | 0 | 0 | 0 | 0 |
| 根节点 `skipSearch` | **无** | **`"true"`** | 无 | 无 | 根节点 `"true"` |
| 条目级 `skipSearch` | **1**（`fp1`） | 0 | 4 | 1 | 0 |
| 进搜索索引 | **是（除 `fp1`）** | **否（整页）** | 是（除 4 条 + 1 条条件） | 是 | 否 |
| 运行期新增条目 | 0 | 0 | 0–N（addons） | 0 | 0–64 |
| 运行期移除条目 | **3 类**（见 §6.2） | **0** | 2 处 | 1 处 | 全部 |
| `restore_defaults` | **无** | **无** | 无 | 无 | 无 |
| 有状态 key（写 `"global"`） | **1**（`move_fp1_to_about`） | **0** | 3 | 0 | 0 |
| 覆写 `Х()` | **是**（`P(false)`） | 否（走 `n91.Х()` → `P(true)`） | 否 | 否 | 否 |

※ `support` / `commands_history` **不是本分支**（不在 `general` 子树），此处仅作横向对照。

### 6.2 `feature_packages` 的三类运行期移除

| 条目 | 行 | 移除机制 | 执行点 | 条件 |
| --- | ---: | --- | --- | --- |
| `isPriceReduced` | 10 | **`n91.h(String)`**（瞬时） | `p91.smali:60` | `go0.k.Н == false` |
| `fp1`（本页，`buttonOnly`） | 11 | **不会移除**（无 `removeAsNeeded`） | — | — |
| `fp1`（`singlepane.xml:10`，`removeAsNeeded`） | — | **`PrefBase.removePreference()`** | `BuyPrefBase.smali:1179` | `X()` 为真 |
| `restore_purchase` | 18 | **`PreferenceGroup.removePreference`** | `RestoreFeaturePackPurchasePref.smali:379` | 版本 `<0xe5` 或 `y40.e()<=0` 或 `b9.о>=b9.o` |
| `uber_level` / `buy_uber_badges` / 三行说明 | 14–16 | **不会移除** | — | — |

### 6.3 「XML 厚度」与「代码厚度」的四象限

```
                 代码厚
                    │
   commands_history │  ● (1 元素 / 22210 B)   ← 空壳 XML + 巨量代码
                    │
                    │            general ● (18 / 32207)
                    │
                    │   support ● (5 / 3744)
   ─────────────────┼──────────────────────────── XML 厚
                    │
      feature_packages ● (15 / 2618)   ← 1:1，罕见均衡
                    │
                    │          translations ● (32 / 有效 946)   ← 厚 XML + 极薄代码
                    │
                 代码薄
```

> **`feature_packages` 是唯一落在对角线上的页面**（1 : 1.0）。
> 这不是巧合：它用**专用 helper** 承担了**恰好与 XML 等量**的逻辑，
> 而 `translations` 把代码压到 0.8%（因为不需要逻辑），`commands_history` 把 XML 压到 1 元素（因为全动态生成）。
> **`feature_packages` 是这套框架里"最正常"的页面**——这也是它值得单独成文的原因。

---

## 7. 对 SpMusic 的可借鉴 / 不建议照抄

### 7.1 可借鉴（跨平台成立）

| # | 做法 | 为什么值得学 | 对应证据 |
| ---: | --- | --- | --- |
| 1 | **`PrefBase` 的统一自删钩子**（两入口 + 幂等标志 + 一个 `В()`） | 「按条件隐藏设置项」在 Android 上需要处理两条系统回调；用一个 `К` 布尔把它们折叠成一个幂等钩子，是所有实现类共享受益的设计 | `PrefBase.smali:269-333` |
| 2 | **`removeAsNeeded` 声明式自删** | 把「这个条目可能不需要」变成一个 XML 属性，实现类只写条件不写调度 → 声明与逻辑分离 | `attrs.xml:2931` + `qt0.u[1]`/`qt0.r0[0]` |
| 3 | **`buttonOnly` 双保险**（数据层不写 title + 渲染层 `GONE`） | 同一个布尔同时约束「数据」和「视图」，避免「标题写了但看不见」的脏状态 | `FeaturePackPref.smali:28-53` + `BuyPrefBase.smali:343-407` |
| 4 | **`fp1` 双声明 + 一个持久化布尔**实现「控件在页面间迁移」 | 不做 View 搬家，而是两页各声明一份 + 重建时按 attr 决定去留。可测试、可回滚、无跨页状态 | `singlepane.xml:10` + `feature_packages.xml:11` + `wr.x0` |
| 5 | **刷新走「整页重建」而非局部更新** | `setPreferenceScreen(null)` + `addPreferencesFromResource` 看似粗暴，但保证装配逻辑（含条件删除）只写一遍 | `n91.smali:3524-3540` |
| 6 | **一个总线消息驱动多页刷新** | `0x7f0d0530` 同时刷新 3 页（`p91`/`r91`/`va1`），避免页间直接引用 | `p91.smali:73` / `r91.smali:180` / `va1.smali:524` |
| 7 | **「不需要逻辑的页面就不要给它写 helper」** | `translations` 32 元素塞进通用分派器只占 41 行；若强行专用会多出上千行样板 | `z61.smali:2133-2173` |
| 8 | **静态清单用内联字面量** | 译者名单/语言名是「数据」不是「文案」，进 `strings.xml` 反而制造 58 条无意义翻译键 | `translations.xml:6-34` |

### 7.2 不建议照抄（平台/商业模式/技术栈不匹配）

| # | 做法 | 为什么不建议 |
| ---: | --- | --- |
| 1 | **单个 helper 用 `int` index 分派 21 个页面** | `z61` 118199 B / 4866 行、`v()` 3919 行单方法。**可读性、增量编译、代码审查全部受损**。现代前端应用「一页一文件」 |
| 2 | **`pswitch` label 号与 index 反向** | `pswitch_0` 对应 index `0x13`、`pswitch_13` 对应 index `0x0`。反编译后维护成本极高 |
| 3 | **`0x14` 靠 default 块隐式处理** | `ui_player` 没有 `pswitch` 条目，靠「落 default」工作。**任何新增 index 会静默走进 `ui_player` 的代码** |
| 4 | **`qt0` 巨型 styleable 容器（5575 行）** | 单个 `~clinit` 里塞上百个 `[I` 数组字面量，靠 `0x7f01xxxx` 原始 id 手写。现代构建系统应生成 |
| 5 | **同一个 attr 两套 styleable 封装**（`qt0.u` vs `qt0.r0`） | 「`removeAsNeeded` 有时是索引 1、有时是索引 0」——极易读错（本文 §3.7.1 就是踩这个坑） |
| 6 | **`skipSearch` 的 `string|boolean` 联合类型** | 既接受 `"true"` 又接受 `"play,huawei"`，且 token 集合与构建变体绑定（`"huawei"` 是死值）。应用**分离的两个属性** |
| 7 | **硬编码商业 URL / SKU 常量**（`https://crowdin.net/project/poweramp-player`、`0xf0d0148`） | 无配置层，改版要重新编译 |
| 8 | **`0xf0d0148` 这类带高位标记的魔数** | 同型值在 7 处出现（`go0:43`、`FeaturePackPref:1596/1605`、`BaseBuyFvPref:2446`、`q4:761`、`sm1:60`、`y9:732`），无一处有注释 |

### 7.3 一句话给实现的建议

> **「把声明式的『是否需要』（`removeAsNeeded`）与『只显示什么』（`buttonOnly`）做成数据属性，把『什么时候重算』统一到一条刷新消息，但不要为了省文件而把 21 个页面塞进一个 switch。」**

---

## 8. 未解问题

| # | 问题 | 现状 | 建议后续 |
| ---: | --- | --- | --- |
| **Q1** | `go0.k.Н`（`b9.Н`）的确切语义 | 【实证】`p91.smali:48` 读它决定是否删 `isPriceReduced`；`FeaturePackPref.smali:388` 把它存进 `D`；`b9.smali:2219`/`:2259` 在「购买状态」分支里置位。**【推断】= 已购买/非优惠价**。但 `b9.smali:2120` 也在初始化时清零 | 需追 `b9` 的 `void` 方法（约 `:2050-2270`）与 `y40`/`ih0` 的购买状态同步 |
| **Q2** | `BaseApplication.Н(Z)` 对 `BaseApplication.P()` 的实际影响 | 【实证】`P(Z)` 建 `o4(this, 1/2)` 延迟 250 ms → `o4.run()` 调 `Н(true/false)`。`Н(Z)` 体在 `smali/com/maxmpz/app/base/BaseApplication.smali:5427` 起（`:5577` 结束），操作 `q4.х:J`、`ih0.R()`。**语义未定** | 属于应用启动/授权域，建议归 `poweramp-settings-page-runtime.md` |
| **Q3** | `0xf0d0148` / `0xf0d015c` 的数值语义 | 【实证】`FeaturePackPref.smali:1596`/`:1605` 赋值给 `BusActionBehavior.y`/`.К`；`go0.smali:43` 作为 `b9` 构造参数。低位与 `0x7f0d01xx` 同构、高位带 `0x80` 标记 | 追 `BusActionBehavior`（47021 B / 2329 行）的 bus 消息路由 |
| **Q4** | `FeaturePackPref.E` 字段（`:11`）的赋值点 | 【实证】只在 `:512`（`onBindView` 内）与 `:1654`（`y()`）被读，**全树无 `iput E:Z`** 命中 | 可能是 Kotlin `lateinit`/内联优化的残留；或由 `update()`（`:368-1553`）间接写 |
| **Q5** | `p71.smali:739` 的 `R()` 调用对应哪个页面 | 【实证】`p71` 是通用 lambda 持有类（1231 行），其 `run()` 有 23 个 `pswitch`；`:pswitch_b`（idx `0x0b`）里 `check-cast v6, Lׅ/z61;` 后调 `R()` | 需追 `new p71(0x0b, z61实例)` 的创建点 |
| **Q6** | `ubler_level` 的 `@drawable/transparent_nothing` 真实内容 | 【实证】`res/drawable-sw3dp/transparent_nothing.xml`，247 B | 读该 XML 确认是否 `<shape>` 全透明；用于对齐而非显示 |
| **Q7** | `translations` 的 29 个语言行为何是 29 而不是 30（`pref_language_values` 有 30 个非空项） | 【实证】两处数据源不同 | 上游 Crowdin 导出快照，**非代码问题**，不必追 |

---

## 9. 证据索引

### 9.1 XML 与布局

| 主题 | 路径 : 行 |
| --- | --- |
| `feature_packages` 根节点（无 `skipSearch`） | **`res/xml/feature_packages.xml:2-3`** |
| `feature_packages` 7 个带 icon 的 `RawTextPreference` | `res/xml/feature_packages.xml:4-10` |
| `feature_packages` 两个 `widgetLayout` | **`res/xml/feature_packages.xml:5`、`:6`** |
| `feature_packages` `isPriceReduced` | **`res/xml/feature_packages.xml:10`** |
| `feature_packages` `fp1`（`buttonOnly`） | **`res/xml/feature_packages.xml:11`** |
| `feature_packages` `move_fp1_to_about` | **`res/xml/feature_packages.xml:12`** |
| `feature_packages` `other` 分类 | `res/xml/feature_packages.xml:13-17` |
| `feature_packages` `restore_purchase` | **`res/xml/feature_packages.xml:18`** |
| **`translations` 根节点 `skipSearch="true"`** | **`res/xml/translations.xml:2`** |
| `translations` 唯一 key `visit_crowdin` | **`res/xml/translations.xml:4`** |
| `translations` 分类 `Translators` | `res/xml/translations.xml:5` |
| `translations` 29 个语言行 | `res/xml/translations.xml:6-34` |
| `general` 的两条子页出边 | **`res/xml/general.xml:5`**、**`:18`** |
| `singlepane` 顶部动态区 / `fp1`（`removeAsNeeded`） | **`res/xml/singlepane.xml:4-12`**，其中 `fp1` 在 **`:10`**，`feature_packages` 入口在 `:12` |
| `singlepane` 根节点 `ignoreTitle` | `res/xml/singlepane.xml:2` |
| `settings_feature_pak_list_button` 全内容 | **`res/layout/settings_feature_pak_list_button.xml:2`**（526 B / 3 行） |
| `settings_feature_pak_vote_button` 全内容 | **`res/layout/settings_feature_pak_vote_button.xml:2`**（521 B / 3 行） |
| `preference_feature_pak` 大卡片布局 | `res/layout/preference_feature_pak.xml:2-12`（`:4` title、`:5` close、`:6` summary、`:7` info、`:8` buy、`:9` progress、`:10` price） |
| `settings_feature_pak_background` | `res/drawable/settings_feature_pak_background.xml:4-10`（圆角 32dp + 描边 + 竖直渐变） |
| `ui_notify.xml` 的 `buttons` key | `res/xml/ui_notify.xml:7` |
| `ui_player.xml` 的 `cc_button` / `hint_5stars` | `res/xml/ui_player.xml:18`、`:20` |

### 9.2 资源值

| 主题 | 路径 : 行 |
| --- | --- |
| `feature_packages` = `Feature Packages` | `res/values/strings.xml:442` |
| `fp1_line1`…`fp1_line5` | `res/values/strings.xml:473`、`474`、`475`、`476`、`477` |
| `fp_request_and_vote_on_forum` | `res/values/strings.xml:479` |
| `list_of_features` | `res/values/strings.xml:688` |
| `hide_fp_in_settings` | `res/values/strings.xml:569` |
| `other` | `res/values/strings.xml:859` |
| `buy_uber_badges` | `res/values/strings.xml:180` |
| `uber_support1/2/3` | `res/values/strings.xml:2105`、`2106`、`2107` |
| `restore_purchases` | `res/values/strings.xml:1801` |
| `changelog` / `pref_poweramp_forum` / `forum_url` | `res/values/strings.xml:247`、`1314`、`470` |
| `external_link` / `external_link_msg` | `res/values/strings.xml:414`、`415` |
| `intro_feat_paks` / `buy_feature_pak_1` | `res/values/strings.xml:629`、`176` |
| `pref_translations` / `pref_crowdin_project` / `pref_translators` | `res/values/strings.xml:1682`、`1072`、`1683` |
| `attrs.xml`：`line1/2/3` | **`res/values/attrs.xml:1557`、`1558`、`1559`** |
| `attrs.xml`：`skipSearch` | `res/values/attrs.xml:1844` |
| `attrs.xml`：`singleNewline` | **`res/values/attrs.xml:2199`** |
| `attrs.xml`：`buttonOnly` | **`res/values/attrs.xml:2621`** |
| `attrs.xml`：`keepPaddings` | `res/values/attrs.xml:2811` |
| `attrs.xml`：`reducedPad` / `zeroBottomPad` / `zeroTopPad` | **`res/values/attrs.xml:2919`、`2920`、`2921`** |
| `attrs.xml`：`removeAsNeeded` | **`res/values/attrs.xml:2931`** |
| `FLAG_ACTIVITY_NEW_TASK` = `0x10000000` | `res/values/integers.xml:3` |
| `style/PrefRoundedTransButton` | `res/values/styles.xml:13116-13127` |
| `public.xml`（11104 条 res id） | `res/values/public.xml` |

### 9.3 分发表与父类链

| 主题 | 路径 : 行 |
| --- | --- |
| `u61.onCreate` 方法边界 | **`smali/ׅ/u61.smali:90-1881`**（1792 行） |
| `general` 分发行 | **`smali/ׅ/u61.smali:434` / `:443` / `:447`** |
| **`feature_packages` 分发行（`p91` / `b71` 构造）** | **`smali/ׅ/u61.smali:512` / `:517` / `:521` / `:525`** |
| **`translations` 分发行（`z61` + index 0x10 + 父页 id）** | **`smali/ׅ/u61.smali:1599` / `:1604` / `:1608` / `:1612` / `:1616` / `:1624`** |
| `u61` 的 `target` bundle 解析 | `smali/ׅ/u61.smali:124-365` |
| `n91` 类声明与 31 个字段 | `smali/ׅ/n91.smali:1-65` |
| `n91.<init>` 签名与 `y`/`C` 写入 | **`smali/ׅ/n91.smali:68`、`:249`、`:253`** |
| `n91.р`（`bus_app_cmd`） | **`smali/ׅ/n91.smali:311-328`**（`:324` 写入） |
| `n91.Х()` 调用点（构造尾部） | **`smali/ׅ/n91.smali:481`** |
| `n91.Х()` 方法体（`P(true)`） | **`smali/ׅ/n91.smali:3341-3374`** |
| `n91.h(String)` 条件移除 | **`smali/ׅ/n91.smali:1689-1716`**（`:1709` 移除） |
| `n91.A(int)` → `addPreferencesFromResource` | `smali/ׅ/n91.smali:888-937`（`:897`） |
| `n91.у()` 整页重建 | **`smali/ׅ/n91.smali:3483-3561`**（`:3524-3531` 清空、`:3536-3540` 重载） |
| `n91.р()` 父页名解析 | `smali/ׅ/n91.smali:3383-3446`（`:3390` 读 `C`） |
| `b71` 类声明 | `smali/ׅ/b71.smali:1-25` |
| `b71.<init>` | **`smali/ׅ/b71.smali:27-67`**（`:31` 调 `n91.<init>`、`:45`/`:62` 建缓存） |
| `b71.abstract Q()` | **`smali/ׅ/b71.smali:937`** |
| `b71.R()`（调 `Q()`） | **`smali/ׅ/b71.smali:940-1092`**（`:1004`） |
| `b71.S(b71;I)` 防抖调度 | `smali/ׅ/b71.smali:99-243`（`:218` 调 `R()`） |
| `b71.v()` 装配编排 | **`smali/ׅ/b71.smali:1313-1352`** |
| `b71.у()Z` | **`smali/ׅ/b71.smali:1415-1460`** |
| `b71.t` 的 Runnable | `smali/ׅ/ix.smali:80-98`（`:93` 调 `b71.R()`） |

### 9.4 `p91`（`feature_packages` 专用 helper）

| 主题 | 路径 : 行 |
| --- | --- |
| 类声明 `.super Lׅ/b71` | **`smali/ׅ/p91.smali:1-3`** |
| `Q()` 全方法 | **`smali/ׅ/p91.smali:7-67`** |
| `Q()` 段 1：`move_fp1_to_about` + `tc(5)` | **`smali/ׅ/p91.smali:11-39`**（`:11` key、`:31` index 5、`:39` 绑监听） |
| `Q()` 段 2：`isPriceReduced` 条件删除 | **`smali/ׅ/p91.smali:44-60`**（`:44` `go0.k`、`:48` `b9.Н`、`:56` key、`:60` `h()`） |
| `onBusMsg` | **`smali/ׅ/p91.smali:69-94`**（`:73` id、`:78` 判等、`:82` `b71.у()`） |
| `Х()` 覆写（`P(false)`） | **`smali/ׅ/p91.smali:96-129`**（`:120` `const/4 v1, 0x0`、`:123` `P(Z)`） |
| `tc` index 5 → `pswitch_4` → 发 `0x7f0d0530` | **`smali/ׅ/tc.smali:554-573`**（`:555` cast `p91`、`:563` id、`:568` post） |
| `tc` 类结构（10 分支） | `smali/ׅ/tc.smali:1-38`、switch 表 `:897-910` |

### 9.5 `z61`（`translations` 共用 helper）

| 主题 | 路径 : 行 |
| --- | --- |
| 类声明 + 索引字段 `j` | **`smali/ׅ/z61.smali:1-7`** |
| 构造器（`p5` → `j`） | **`smali/ׅ/z61.smali:11-25`**（`:15`） |
| 4 个空方法 `I/J/N/Q`（含 `b71.Q()` 的空实现） | **`smali/ׅ/z61.smali:27-53`** |
| `R()` 全方法（**不读 `j`**） | **`smali/ׅ/z61.smali:236-586`**（351 行） |
| `R()` 的 5 个 key | `notify_colorize` `:256`、`notify_prefer_nav` `:342`、`notification_colors` `:383`、`notification_type_msg` `:424`、**`buttons` `:521`** |
| **`R()` 的 SDK<33 删 `buttons`** | **`smali/ׅ/z61.smali:521`（key）/ `:541`（`nr0.В`）/ `:553`（`removePreference`）** |
| `nr0.В` = `SDK_INT >= 33` | **`smali/ׅ/nr0.smali:19`（`0x21`）/ `:38`（`sput`）**，全类 **43 行** |
| `R()` 的 2 个调用点 | **`smali/ׅ/z61.smali:1306`**（`pswitch_0`=ui_notify）、**`smali/ׅ/p71.smali:739`**（`p71` idx 0x0b） |
| `v()` 方法边界 | **`smali/ׅ/z61.smali:857-4775`**（3919 行） |
| `v()` 读索引 | **`smali/ׅ/z61.smali:865`** |
| **`v()` 的分派点** | **`smali/ׅ/z61.smali:919`** |
| `v()` 的 default 块（`ui_player`） | **`smali/ׅ/z61.smali:921-1272`**（`cc_button` `:928`、`hint_5stars` `:962`） |
| **`v()` 的 switch 表** | **`smali/ׅ/z61.smali:4752`（`:pswitch_data_0`）/ `:4753`（`.packed-switch 0x0`）/ `:4774`（`.end`）** |
| **`pswitch_3` = `translations`（41 行）** | **`smali/ׅ/z61.smali:2133-2173`**（`:2138` key、`:2158` `x11` index `0x13`、`:2167` 绑监听） |
| 20 个 `pswitch` 标签行号 | `pswitch_0` `1275`、`pswitch_1` `1576`、`pswitch_2` `1580`、`pswitch_3` `2133`、`pswitch_4` `2176`、`pswitch_5` `2284`、`pswitch_6` `2465`、`pswitch_7` `2566`、`pswitch_8` `2600`、`pswitch_9` `2765`、`pswitch_a` `2925`、`pswitch_b` `3051`、`pswitch_c` `3675`、`pswitch_d` `3902`、`pswitch_e` `3955`、`pswitch_f` `4276`、`pswitch_10` `4459`、`pswitch_11` `4597`、`pswitch_12` `4700`、`pswitch_13` `4704` |
| `Х()` 覆写（只 idx 6） | **`smali/ׅ/z61.smali:4777-4834`**（`:4831` `.packed-switch 0x6`） |
| `х()` 覆写（idx 0 与 6） | **`smali/ׅ/z61.smali:4836-4866`**（`:4862-4865` `.sparse-switch`） |
| `M(Boolean)`（USBMainActivity 组件启用） | `smali/ׅ/z61.smali:142-234`（`:171` 组件名、`:206` `setComponentEnabledSetting`） |

### 9.6 自定义控件

| 主题 | 路径 : 行 |
| --- | --- |
| `PrefBase` 类声明 | `smali/com/maxmpz/audioplayer/preference/PrefBase.smali:1-2`（`.super Landroid/preference/Preference`） |
| `PrefBase` 关键字段 `K`/`X`/`y`/`К`/`у` | `PrefBase.smali:16`、`18`、`20`、`22`、`24` |
| **`PrefBase.onAttachedToActivity` → `В()`** | **`PrefBase.smali:269-300`**（`:289` 置位、**`:293` 调 `В()`**） |
| **`PrefBase.onAttachedToHierarchy` → `В()`** | **`PrefBase.smali:302-333`**（`:322` 置位、**`:326` 调 `В()`**） |
| `PrefBase.onParentChanged`（缓存父容器） | `PrefBase.smali:342-376`（`:371`） |
| `PrefBase.onPrepareForRemoval`（解绑） | `PrefBase.smali:378-416`（`:390`、`:411`） |
| **`PrefBase.removePreference()`** | **`PrefBase.smali:418-437`**（`:430`） |
| `PrefBase.В()` 默认实现（订阅 `bus_settings`） | **`PrefBase.smali:466-530`**（`:506` id `0x7f0d04a6`、`:523` subscribe） |
| `BuyPrefBase` 类声明 | `BuyPrefBase.smali:1-2`（`.super RawTextPreference`） |
| `BuyPrefBase` 字段 `l`/`v`/`t`/`m`/`r`/`s`/`u` | `BuyPrefBase.smali:22`、`38`、`34`、`24`、`30`、`32`、`36` |
| `BuyPrefBase.<init>` | **`BuyPrefBase.smali:42-161`** |
| `BuyPrefBase` 换 layout | `BuyPrefBase.smali:96`、`101`（`0x7f0400db` = `preference_feature_pak`） |
| **`qt0.u` 读取 + `l`/`v` 赋值** | **`BuyPrefBase.smali:111`、`:126`、`:134`（`l`=buttonOnly）、`:138`、`:146`（`v`=removeAsNeeded）、`:150`** |
| `BuyPrefBase.onBindView`（`buttonOnly` 渲染） | **`BuyPrefBase.smali:253-1153`**，关键 **`:343`（读 `l`）、`:351`/`:360`（`0x8`/`0`）、`:385`/`:407`（title/summary 显隐）** |
| **`BuyPrefBase.В()` 自删** | **`BuyPrefBase.smali:1163-1215`**（**`:1179` `PrefBase.removePreference()`**） |
| `BuyPrefBase` 抽象钩子 | `X()` `:214`、`update()` `:1154`、`x(...)` `:1157`、`y()` `:1160`、`у()` `:1250` |
| `FeaturePackPref` 类声明 | `FeaturePackPref.smali:1-2`（`.super BuyPrefBase`） |
| `FeaturePackPref` 状态位 `D`/`E`/`z` | `FeaturePackPref.smali:7`、`9`、`11` |
| `FeaturePackPref.<init>`（`buttonOnly` 抑制 title） | **`FeaturePackPref.smali:15-93`**（`:19` `go0.k`、`:23` 调父构造、**`:28`-`:32` 读 `l`、`:36` `intro_feat_paks`、`:53` `setTitle`、`:59` `buy_feature_pak_1`、`:88` 按钮文案**） |
| `FeaturePackPref.X()` | **`FeaturePackPref.smali:97-169`**（**`:101` 读 `v`**、`:109` `wr.w0`、`:147` `wr.x0`、`:155`/`:165` 返回） |
| `FeaturePackPref.update()` | `FeaturePackPref.smali:368-1553`（`:388` `b9.Н`→`D`、`:516` `b9.Н`） |
| `FeaturePackPref.x(...)` 三按钮装配 | **`FeaturePackPref.smali:1554-1648`**（`:1574` gplay 图标、`:1596`/`:1605` 魔数、`:1622` close id、`:1635` 深链） |
| `FeaturePackPref` 三谓词 | `y()` `:1650-1697`、`К()` `:1699-1734`、`у()` `:1736-1767` |
| `BuyUberPref` 类声明 + 构造 | `BuyUberPref.smali:1-2`、`:24-146`（`:31` `ProgressPreference.<init>`、`:80` `go0.k`、`:136` 点击监听） |
| `BuyUberPref.В()`（无自删） | **`BuyUberPref.smali:604-635`** |
| `UberLevelPref` 类声明 + 构造 | `UberLevelPref.smali:1-2`、`:24-105`（`:31` `RawTextPreference.<init>`、**`:61` `0x10100e5` `android:clickable`**、`:93`） |
| `UberLevelPref.В()`（无自删） | **`UberLevelPref.smali:846-912`** |
| `RestoreFeaturePackPurchasePref` 类声明 + 构造 | `RestoreFeaturePackPurchasePref.smali:1-2`、`:7-225` |
| **`RestoreFeaturePackPurchasePref.В()` 版本门自删** | **`RestoreFeaturePackPurchasePref.smali:296-386`**（`:308` `0xe5`、`:325` `y40.e()`、`:341`/`:345` `b9.о`/`b9.o`、**:379 `removePreference`**） |
| `BaseRestoreFvPurchasePref.В()` | `BaseRestoreFvPurchasePref.smali:352-383`（`:356` super、`:377` `x()`） |
| `FeaturePackRedirectPref.В()`（`move_fp1_to_about` 决策） | **`FeaturePackRedirectPref.smali:111-250`**（`:115` 读 `i`、`:176` `wr.x0`、**`:204` 自删 A**、`:214` `wr.x0`、**`:238` 自删 B**、`:248` super） |
| 4 个类的 `qt0.r0` 读取 | `AlreadyPurchasedRedirectPref.smali:58-81`、`BuyMethodsRedirectPref.smali:38-61`（`:135` 自删）、`FeaturePackRedirectPref.smali:38-61`、`LicenseStatusPref.smali:77-100` |
| `AlreadyPurchasedRedirectPref.В()`（禁用而非删除） | `AlreadyPurchasedRedirectPref.smali:282-354`（`:348` `setEnabled`） |
| `MultilineSwitchPreference` | `MultilineSwitchPreference.smali:1-2`（`.super Landroid/preference/SwitchPreference`）、`:20-83`（ctor） |
| `RawTextPreference` 类声明 + styleable | `RawTextPreference.smali:1-2`、**`:191` `qt0.q0`** |
| `RawTextPreference` 的 `line1/2/3` 读取 | `RawTextPreference.smali:304`（idx 5）、`:311`（6）、`:318`（7）、`:325`（8） |
| **`RawTextPreference` 的 `singleNewline`/`reducedPad`/`zeroPad`** | **`:280`+`:283`（idx 13 = singleNewline）、`:503`+`:506`（idx 31 = zeroTopPad → `o`）、`:512`+`:515`（idx 30 = zeroBottomPad → `C`）、`:521`+`:524`（idx 29 = reducedPad → `С`）** |
| `RedirectPreference` 类声明 | `RedirectPreference.smali:1-2`（`.super RawTextPreference`）、`:106-129`（`В()` 只处理 dependency） |

### 9.7 styleable 数组

| 主题 | 路径 : 行 |
| --- | --- |
| **`qt0.u` = `{buttonOnly, removeAsNeeded}`** | **`smali/ׅ/qt0.smali:1068`（`0x7f0108c4`）/ `:1073`（`0x7f010c55`）/ `:1078`（`filled-new-array`）/ `:1086`（`sput`）** |
| **`qt0.r0` = `{removeAsNeeded}`** | **`smali/ׅ/qt0.smali:1900`（`filled-new-array {v7}`）/ `:1908`（`sput`）**，`v7` 在 `:1073` 载入 |
| `qt0.q0` = `RawTextPreference` 的 37 个 attr | `smali/ׅ/qt0.smali:1883`（`0x25`=37）/ `:1891`（`array_28`）/ `:1896`（`sput`） |
| `qt0.q0` 索引表（关键项） | `[4]`target / **`[5]`line1 / `[6]`line2 / `[7]`line3** / `[13]`singleNewline / `[14]`useHtml / `[16]`applyIconTint / `[21]`keepPaddings / **`[29]`reducedPad / `[30]`zeroBottomPad / `[31]`zeroTopPad** |
| `qt0.O0` = 文档级 6 attr（`skipSearch` 在索引 1） | `smali/ׅ/qt0.smali`（`O0` 数组重建；`[0] 0x10101e1`、**`[1] 0x7f0105f2`**、`[2] 0x7f0105f3`、`[3] 0x7f0105f4`、`[4] 0x7f010632`、`[5] 0x7f010c00`） |

### 9.8 搜索索引与 `skipSearch`

| 主题 | 路径 : 行 |
| --- | --- |
| **`u9.х()` 条目级判定** | **`smali/ׅ/u9.smali:467-588`**（布尔短路 `:487-511`、token `play` `:539`、token `pa` `:555`） |
| `nn.В(String,String)` 逗号分词精确匹配 | `smali/ׅ/nn.smali:7-106`（`.super Lcom/maxmpz/audioplayer/Edition;`） |
| `PrefSearchIndexer.y()` 文档级判定 | **`smali/com/maxmpz/preference/PrefSearchIndexer.smali:498-950`**（`skipSearch` `:578-586`） |
| **参与索引的 44 个 XML（含 `translations`）** | **`smali/com/maxmpz/audioplayer/Application.smali:2611-2654`** —— `:2614` = `feature_packages`（`0x7f160013`）、**:2653 = `translations`（`0x7f160029`）** |

### 9.9 内购 / 版本门 / 总线

| 主题 | 路径 : 行 |
| --- | --- |
| `go0.k`（内购单例，`b9` 派生） | `smali/ׅ/go0.smali:1-2`（`.super Lׅ/b9`）、`:7`（字段）、`:43`（魔数 `0xf0d0148`）、`:53`（`sput`） |
| `b9.Н` 字段与写入点 | `smali/ׅ/b9.smali:50`（声明）、`:2120`、`:2219`、`:2259` |
| `b9` 的 31 个字段 | `smali/ׅ/b9.smali:10-64` |
| `y40.H`（版本号） | `smali/ׅ/y40.smali:111`（`sput`） |
| `wr.x0`（`move_fp1_to_about`） | **`smali/ׅ/wr.smali:1753`（key）/ `:1757`（`ms.с`）/ `:1765`（`sput`）** |
| `wr.w0` | `smali/ׅ/wr.smali:1749` |
| `cmd_app_feature_pak_settings_refresh`（`0x7f0d0530`） | `p91.smali:73`、**`r91.smali:180`**、`tc.smali:563`、**`va1.smali:524`** |
| `bus_app_cmd`（`0x7f0d015c`） | `n91.smali:311-324`（`n91.р`） |
| `bus_settings`（`0x7f0d04a6`） | `PrefBase.smali:506` |
| `x11` index `0x13` → Crowdin URL | **`smali/ׅ/x11.smali:328` / `:337` / `:341`** |
| `BaseApplication.P(Z)` | **`smali/com/maxmpz/app/base/BaseApplication.smali:482-533`**（`:490-517` 建 `o4`、`:523-527` 延迟 250 ms） |
| `BaseApplication.Н(Z)` | `smali/com/maxmpz/app/base/BaseApplication.smali:5427`（起）/ `:5577`（`end method`） |
| `o4.run()` 三路 | `smali/ׅ/o4.smali:42-168`（`:53` switch、`:58-70` default `Н(false)`、`:73` `Н(true)`、`:86` Toast+finish） |

---

## 附：本文实测的 `z61` index 对照表条目数

**21 条**（`0x00`–`0x14`），其中：
- **20 条**有 `pswitch` 分支（`0x00`–`0x13`）
- **1 条**（`0x14` = `ui_player`）落 **default 块**

`z61` 在 `u61.onCreate` 里被 `new` 的**实例化点共 21 处**（行号：465, 475, 493, 503, 548, 564, 585, 596, 710, 732, 786, 797, 929, 944, 963, 973, 992, 1002, 1051, 1061, 1104, 1115, 1134, 1145, 1192, 1202, 1290, 1300, 1412, 1423, 1442, 1453, 1472, 1483, 1525, 1536, 1555, 1566, 1608, 1624, 1712, 1726），
与 21 条对照表一一对应（`new-instance` 行 + `invoke-direct` 行成对出现在同一分支内）。

---

---

## 附：同分支与相关文档

| 文档 | 覆盖层 |
| --- | --- |
| `poweramp-about-branch-overview.md` | 分支总览（入口索引：3 页拓扑、18 元素按性质重分类、版本串组装、授权状态机、收尾清单） |
| `poweramp-about-general-page.md` | 根页层（`general.xml` 18 元素、`r91` 逐段、7 个自定义控件、`skipSearch` 判定） |
| `poweramp-about-subpages.md` | 子页层（`feature_packages` + `translations`、`p91`/`b71`/`z61` 分发与 21 条 index） |
| `poweramp-about-runtime-deps.md` | 运行期依赖（许可页 WebView、检查更新、`addons` 四路） |
| `poweramp-about-license-state-machine.md` | 授权状态机（`q4`/AppLSHelper 写入端、`store` 渠道枚举、scene 总线） |
| **`poweramp-faststaticprefs.md`** | **底层存储引擎**（跨分支共用：只读 mmap、整块序列化、脏位判据） |
| `poweramp-about-and-support-settings.md` | build-1025 首轮枚举（`status: draft`，已被上述文档修订） |
| `poweramp-settings-root-structure.md` | 设置树总索引（上层入口） |
