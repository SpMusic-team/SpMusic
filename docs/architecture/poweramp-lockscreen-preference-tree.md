---
doc_id: "ARCH-POWERAMP-LOCKSCREEN-PREFERENCE-TREE"
title: "Poweramp「设置 → 锁屏」偏好结构完整实证"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1035-bundle-play (versionCode 1035009)"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - ".rea-analysis/v1035/decoded/res/xml/lockscreen.xml"
  - ".rea-analysis/v1035/decoded/res/values/strings.xml"
  - ".rea-analysis/v1035/decoded/res/values/public.xml"
  - ".rea-analysis/v1035/decoded/res/drawable/settings_quote_background.xml"
  - ".rea-analysis/v1035/decoded/smali/ׅ/la1.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/vr.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/n2.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/f81.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/tc.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/x11.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/p71.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/xn0.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/nr0.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/n91.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/fc.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/pb1.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/t9.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/b6.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/w2.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/u61.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/z61.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/app/base/BaseApplication.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/widget/app/BasePowerWidgetApplication.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RawTextPreference.smali"
  - ".rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RedirectPreference.smali"
  - "docs/architecture/poweramp-lockscreen-settings.md"
  - "docs/architecture/poweramp-settings-page-runtime.md"
  - "docs/architecture/poweramp-settings-root-structure.md"
  - "docs/decisions/2026-07-09-document-metadata-standard.md"
---

# Poweramp「设置 → 锁屏」偏好结构完整实证

> **证据分级**
> - **【实证·原文】** 可在 `res/xml`、`res/values`、`res/drawable` 原文直接查到。
> - **【实证·产物】** 可在反编译 smali 中查到，一律给出 `文件相对路径:起止行`。
> - **【推断】** 分析者推理，可能出错；凡标此项者均已说明理由与替代解释。
>
> 全部结论基于 **build-1035-bundle-play**（`versionCode 1035009`）。行号均由
> `.rea-analysis/tools/probe_pt_49_final_check.py` 逐条机器核对（221 个引用，0 失败）。

---

## 0. 必读：混淆标识符的真实码位（本文档的书写约定）

任务简报中有一条流传的踩坑记录：*"磁盘目录名是 `ׅ`（U+05C5），但 smali 文件内部的类描述符是 `讌`（U+8ACC）"*（注：`讌` 实为 U+8B8C，简报标注的 U+8ACC 有误，见下方勘误）。

**本次逐字节复核表明这条记录不成立。**

| 位置 | 实测码位 | 说明 |
| --- | --- | --- |
| 磁盘目录名 | **U+05C5** HEBREW MARK LOWER DOT | 唯一一个非 ASCII 单字符包目录 |
| `la1.smali:1` 类描述符 | **U+05C5** | `.class public final Lׅ/la1;` |
| `vr.smali:1461` 字段引用 | **U+05C5** | `sput-object v4, Lׅ/vr;->j0:Lׅ/pb1;` |
| 全树 `讌`（**U+8B8C**）出现次数 | **0** | 扫描 `smali/` + `res/` 全部文件 |
| 全树 `諌`（U+8ACC）出现次数 | **0** | 同上（顺带核对） |
| 全树 `謌`（U+8B0C）出现次数 | **0** | 同上（顺带核对） |
| 全树非 ASCII 单字符包名 | **只有 U+05C5 一种，3088 个 `.class` 命中 / 3802 个文件含之** | 无第二种 |

【实证·产物】`probe_pt_05_codepoints.py` / `probe_pt_06_identity.py` / `probe_pt_52_recodepoint.py`

> **结论**：目录名与类描述符**完全一致**，都是 U+05C5。不存在"目录用 A、描述符用 B"的分离。
> 曾经的"搜不到"应是 **PowerShell 控制台编码**问题（U+05C5 是不可见的希伯来元音符号，
> 复制粘贴极易丢失或变形），而非产物中存在两个码位。
>
> **码位勘误**：简报正文中的字面量 `讌` 实际是 **U+8B8C**，不是 U+8ACC（U+8ACC 是形近的 `諌`）。
> 两者在产物中**都不存在**，所以无论按哪个码位核对，结论一致：**没有第二个码位**。
>
> **本文档统一用 `ׅ`（U+05C5）书写该包名**；`讌`（U+8B8C）在产物中不存在，本文不再使用。

**关于 `smali_classes2/`**（Lead 复核后的修订）：产物根下**同时存在** `smali/` 与 `smali_classes2/` 两个目录，但**本页涉及的全部类都在 `smali/` 下**：

| 目录 | `.smali` 数 | 顶层包 | 是否含本页类 |
| --- | ---: | --- | :---: |
| `smali/` | **4397** | `android`、`androidx`、`com`、`kotlin`、`moe`、`okhttp3`、`okio`、`pl`、`rikka`、`yuku`、`ׅ/` | **✅ 全部** |
| `smali_classes2/` | 532 | 仅 `j$/`、`java/`（`j$` 为 desugar 生成的 `java.util` 回填） | ❌ 无 |

其中 `smali/ׅ/` 独占 **3088** 个 `.smali`。

【实证·产物】`.rea-analysis/tools/probe_lead9_smali2.py`（逐目录枚举 + 10 个关键类定位）。
`la1` / `vr` / `n91` / `u61` / `p71` / `y61` / `h80` / `g80` / `t4` / `ar` **全部在 `smali/ׅ/`**，无一在 `smali_classes2/`。

> 另注：旧产物 `.rea-analysis/decoded/`（build-1025）**没有 smali 目录**，只有 `classes.dex` + `res/` + `lib/`。本文只用 `v1035/decoded/` 的 apktool 产物，不要混用两套路径。

---

## 1. 页面身份与规模

| 项 | 值 | 证据 |
| --- | --- | --- |
| XML 文件 | `res/xml/lockscreen.xml` | 【实证·原文】 |
| 字节数 | **3224** | 【实证·原文】`probe_pt_01_xml.py`（SHA1 `92753fde…`） |
| 行数 | **21** | 【实证·原文】 |
| 元素总数 | **15** | 【实证·原文】`<tag` 计数 = 15 |
| `android:key` 数 | **12** | 【实证·原文】 |
| 父节点 | `<PreferenceScreen>`，无 `android:key` | 【实证·原文】`lockscreen.xml:2` |
| 资源 id | **`0x7f16001d`** | 【实证·原文】`res/values/public.xml:11076` |
| helper 类 | `ׅ/la1`（extends `ׅ/n91`） | 【实证·产物】`la1.smali:1-2` |
| helper 体积 | **13557 B / 580 行** | 【实证·产物】 |
| 状态字段注册 | `ׅ/vr` 的 `<clinit>` | 【实证·产物】`vr.smali:375-3996` |
| 分发起点 | `u61.smali:852-865` | 【实证·产物】 |
| 页面钩子 | `n91.v()` 抽象方法 | 【实证·产物】`n91.smali:2763` |

### 1.1 15 个元素 vs 12 个 key

12 个 key 与 15 个元素的差额说明：

| 元素 | 计数 | key |
| --- | ---: | --- |
| 根 `<PreferenceScreen>` | 1 | **无** |
| `<PreferenceCategory>` | 2 | `ics_ls_cat`、`pref_poweramp_ls` |
| `<intent>`（嵌套子节点） | 1 | **无** |
| 普通偏好元素 | 11 | 见 §2 |
| **合计** | **15** | **12** |

### 1.2 属性普查（逐项实数）

| 属性 | 次数 | 分布 |
| --- | ---: | --- |
| `android:key` | **12** | 除根、提示块、`<intent>` 外全部 |
| `android:title` | **13** | 根 1 + 分类 2 + 偏好 10 |
| `android:summary` | **10** | **根 1 + 偏好 9**（含提示块；`ls_app_settings` 与 `restore_defaults` 无） |
| `android:defaultValue` | **7** | 7 个状态键，无遗漏 |
| `android:persistent="true"` | **7** | 与 `defaultValue` **完全重合** |
| `android:persistent="false"` | **1** | 仅 `ls_app_settings`（`:14`） |
| `android:dependency` | **5** | `ls_aa_blur`→`ics_ls_aa`；4 项→`ls_enable` |
| `android:background` | 1 | 提示块（`:5`） |
| `android:action` / `android:data` | 1 / 1 | `<intent>`（`:15`） |
| `w:keepPaddings` | 1 | 提示块（`:5`） |
| `w:target` | 1 | `buttons`（`:9`） |
| `xmlns:android` / `xmlns:w` | 1 / 1 | 根（`:3`） |

【实证·原文】`probe_pt_46_census.py`

---

## 2. 15 个元素逐条实证

### 2.1 根节点（`:2-3`）

```xml
<PreferenceScreen android:title="@string/pref_lock_screen"
                  android:summary="@string/pref_summary_lock_screen"
  xmlns:android="…" xmlns:w="…">
```

| 属性 | 实文 | strings.xml |
| --- | --- | ---: |
| `android:title` | **Lock Screen** | `:1190` |
| `android:summary` | **Poweramp lock screen options** | `:1531` |

无 `android:key`，无 `skipSearch` ⇒ 整份 XML 参与设置搜索索引。

### 2.2 分类一 `ics_ls_cat` = Android Lock Screen（`:4-10`，5 项）

| # | key | 控件类全名 | 标题实文 | 摘要实文 | defaultValue | persistent | dependency | w:\* |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | *（无）* | `com.maxmpz.audioplayer.preference.RawTextPreference` | — | **Android Lock Screen support is always enabled, as it's required for Bluetooth track info, smart watch support, other apps, etc.** | — | 类内强制 `false` | — | `w:keepPaddings="true"`、`android:background="@drawable/settings_quote_background"` |
| 2 | `ics_ls_aa` | `…preference.MultilineSwitchPreference` | **Album Art** | Show album art on Android lock screen. This option may also affect Android Auto covers. Not supported by some devices/ROMs | **`true`** | `true` | — | — |
| 3 | `ls_aa_blur` | `…preference.MultilineSwitchPreference` | **Blur** | Lock screen album art is blurred. The album art background isn't shown by some devices. This option is not recommended for smart watches or apps that use Poweramp album art | **`false`** | `true` | **`ics_ls_aa`** | — |
| 4 | `ls_default_aa` | `…preference.MultilineSwitchPreference` | **Show Default Image** | Send default placeholder image when no album art exists for the track. Also affects smart watches, other apps utilizing media APIs. Default image is defined by skin | **`false`** | `true` | — | — |
| 5 | `buttons` | `com.maxmpz.audioplayer.preference.RedirectPreference` | **Buttons** | **Media action buttons** | — | 类内强制 `false` | — | **`w:target="ui_mediaactions"`** |

【实证·原文】`lockscreen.xml:5`（提示块）、`:6`、`:7`、`:8`、`:9`

`@string` 行号：`pref_enable_ics_ls_aa:1108`、`pref_summary_enable_ics_ls_aa:1490`、
`pref_ls_aa_blur:1201`、`pref_summary_ls_aa_blur:1535`、`pref_ls_default_aa:1202`、
`pref_summary_ls_default_aa:1536`、`buttons:174`、`notify_action_buttons:840`、
`pref_ics_ls:1162`、`pref_summary_android_ls_msg:1460`。

> **#1 是本页唯一无 key 的条目**，也是唯一带 `android:background` 的条目。它**不能**被
> `findPreference` 定位，因此 `la1` 全文对它无任何操作 ⇒ 永久存在（§6.5 有独立证明）。

### 2.3 分类二 `pref_poweramp_ls` = Poweramp Lock Screen（`:11-19`，5 项）

| # | key | 控件类全名 | 标题实文 | 摘要实文 | defaultValue | persistent | dependency |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 6 | `ls_enable` | `…MultilineSwitchPreference` | **Show On Lock Screen** | Poweramp shows itself on top of system lock screen if music is playing. Settings, deletion, edit tag, etc. actions trigger device lock screen | **`false`** | `true` | — |
| 7 | `ls_force_timeout` | `…MultilineSwitchPreference` | **Shorter Timeout** | Apply shorter screen timeout when Poweramp is on lock screen | **`true`** | `true` | `ls_enable` |
| 8 | `ls_app_settings` | **`android.preference.Preference`**（原生类） | **Open App Settings** | **XML 无**，运行期写入（§5.2） | — | **`false`**（显式） | `ls_enable` |
| 9 | `ls_enable_land` | `…MultilineSwitchPreference` | **Landscape Layout** | Enable rotation to landscape layout | **`false`** | `true` | `ls_enable` |
| 10 | `direct_unlock` | `…MultilineSwitchPreference` | **Direct Unlock** | Unlock directly to home screen (if possible) instead of Android lockscreen | **`false`** | `true` | `ls_enable` |

【实证·原文】`lockscreen.xml:12`、`:14`、`:17`、`:18`、`:13`

`@string` 行号：`pref_enable_lock_screen:1109`、`pref_summary_enable_lock_screen:1491`、
`pref_ls_force_timeout:1204`、`pref_summary_ls_force_timeout:1538`、
`pref_open_app_settings:1264`、`pref_ls_enable_land:1203`、
`pref_summary_ls_enable_land:1537`、`pref_direct_unlock:1076`、
`pref_summary_direct_unlock:1480`、`pref_poweramp_ls:1316`。

> **#8 `ls_app_settings` 是唯一"原生类 + 显式 non-persistent + 无 summary"的条目。**
> 它是本页唯一的**动作型**偏好（其余都是状态型或跳转型）。

### 2.4 页尾（`:20`）

| # | key | 控件类全名 | 标题实文 | 备注 |
| ---: | --- | --- | --- | --- |
| 11 | `restore_defaults` | **`android.preference.Preference`** | **Restore Defaults** | `@string/pref_restore_defaults`（`:1366`）；无 summary、无 persistent 声明 |

> **`restore_defaults` 与 `ls_app_settings` 同为原生 `android.preference.Preference`**，
> 都没写 `android:persistent`。原生 `Preference` 的 `mPersistent` 默认 `true`，
> 但两者都没有 `defaultValue` 也无 `TwoStatePreference` 值语义，
> 故实际不产生可持久化条目 —— 这一点与 `buttons`（类内强制 `false`）不同，
> 属**"持久化标志为真但永不写值"**的空转情形【推断，依据 Android `Preference` 源码语义】。

### 2.5 唯一的嵌套 `<intent>`（`:14-16`）全文

```xml
<Preference android:persistent="false"
            android:title="@string/pref_open_app_settings"
            android:key="ls_app_settings"
            android:dependency="ls_enable">
    <intent android:action="android.settings.APPLICATION_DETAILS_SETTINGS"
            android:data="package:com.maxmpz.audioplayer" />
</Preference>
```

| 属性 | 值 | 语义 |
| --- | --- | --- |
| `android:persistent="false"` | 显式关闭 | `ls_app_settings` 是**命令**不是设置，不写 `"global"` |
| `android:action` | `android.settings.APPLICATION_DETAILS_SETTINGS` | 系统"应用详情"页 |
| `android:data` | `package:com.maxmpz.audioplayer` | **带 `package:` scheme ⇒ 指向本应用详情页** |
| `android:dependency` | `ls_enable` | 动作项同样受母开关门控 |

> **与 `n2` 的权限跳转形成对照**（§5.3）：本条目跳**本应用**详情页（带 `package:`），
> 而权限弹框正按钮跳**全局**悬浮窗授权列表（`MANAGE_OVERLAY_PERMISSION`，**不带** `package:`）。
> 两者是不同目的地、不同代码路径，不能混为一谈。

### 2.6 `drawable/settings_quote_background`（提示块背景）

```xml
<layer-list xmlns:android="…">
    <item android:left="16.0dip" android:top="8.0dip" android:right="16.0dip" android:bottom="4.0dip">
        <shape>
            <corners android:radius="16.0dip" />
            <stroke android:width="1.0px" android:color="?android:textColorHint" />
            <padding android:left="36.0dip" android:top="3.0dip" android:right="37.0dip" android:bottom="4.0dip" />
        </shape>
    </item>
</layer-list>
```

【实证·原文】`res/drawable/settings_quote_background.xml:1-11`（id `0x7f020576`，`public.xml:3660`）

**只有 `stroke`、没有 `solid` 填充**，描边色取主题属性 `?android:textColorHint` ⇒
自动跟随深浅主题。`padding` 左右不对称（36 vs 37）说明是照视觉稿手调的。

---

## 3. `vr.smali` 的 7 个状态字段（权威默认值来源）

### 3.1 字段声明（`:231-285`）

| 字段 | 声明行 | 类型 |
| --- | ---: | --- |
| `j0` | **`vr.smali:231`** | `Lׅ/pb1;` |
| `k0` | **`vr.smali:239`** | `Lׅ/pb1;` |
| `l0` | **`vr.smali:247`** | `Lׅ/pb1;` |
| `m0` | **`vr.smali:255`** | `Lׅ/pb1;` |
| `n0` | **`vr.smali:263`** | `Lׅ/pb1;` |
| `o0` | **`vr.smali:271`** | `Lׅ/pb1;` |
| `p0` | **`vr.smali:279`** | `Lׅ/pb1;` |

全部为 `.field public static final`，类型统一 `ׅ/pb1`（`pb1 extends fc extends t9`，
§5.6）。

### 3.2 注册（`<clinit>` 内，`:1449-1576`）

`vr.smali` 的 `<clinit>` 从 `:375` 起，到 `:3996` 结束 —— **全文 3622 行，占总文件 90%**。

| 字段 | pref key 字符串 | 注册调用 | 默认值寄存器 | `sput` 行 |
| --- | --- | --- | --- | ---: |
| — | `ls_enable`（`:1449`） | `с(String,Z)`（`:1453`） | **`v3`** | **`:1461`** |
| `k0` | `direct_unlock`（`:1465`） | `с(String,Z)`（`:1469`） | **`v3`** | **`:1477`** |
| `l0` | `ics_ls_aa`（`:1481`） | `с(String,Z)`（`:1485`） | **`v2`** | **`:1493`** |
| `m0` | `ls_enable_land`（`:1497`） | `с(String,Z)`（`:1501`） | **`v3`** | **`:1509`** |
| `n0` | `ls_aa_blur`（`:1513`） | `с(String,Z)`（`:1517`） | **`v3`** | **`:1525`** |
| `o0` | `ls_default_aa`（`:1529`） | `с(String,Z)`（`:1533`） | **`v3`** | **`:1541`** |
| `p0` | `ls_force_timeout`（`:1545`） | `с(String,Z)`（`:1549`） | **`v2`** | **`:1576`** |

> **注意 `j0` 的 `sput` 在 `:1461`，而它的 key 字符串在 `:1449`。**
> 表格里首行的"字段"列留空，因为 `ls_enable` 就是 `j0` 的 key（§3.3）。

### 3.3 `v2` / `v3` 两个预置布尔常量

```asm
396:  const-string v1, "dvc_enabled"
400:  const/4 v2, 0x1            ; ★ v2 = true
403:  invoke-virtual {v0, v1, v2}, Lׅ/ms;->с(Ljava/lang/String;Z)Lׅ/pb1;
...
431:  const-string v1, "crossfade_auto_advance"
435:  const/4 v3, 0x0            ; ★ v3 = false
438:  invoke-virtual {v0, v3, v1}, Lׅ/ms;->b(ILjava/lang/String;)Lׅ/rb1;
```

【实证·产物】`vr.smali:400`（`v2`）、`vr.smali:435`（`v3`）

**两处赋值之后到 `:1580` 之间，`v2`/`v3` 再未被任何指令写过**
（机器核对：该区间内对 `v2`/`v3` 的写操作只有这两条 `const/4`，其余全是读取）
【实证·产物】`probe_pt_26_v23.py`。

因此整个 `:1449-1576` 段内：

- `с(key, v2)` ⇒ **默认 `true`**：`ics_ls_aa`、`ls_force_timeout`
- `с(key, v3)` ⇒ **默认 `false`**：`ls_enable`、`direct_unlock`、`ls_enable_land`、`ls_aa_blur`、`ls_default_aa`

`с` 的方法签名：`.method public final с(Ljava/lang/String;Z)Lׅ/pb1;`【实证·产物】`ms.smali:2687`

### 3.4 双源一致性核对（7/7）

| # | pref key | XML `defaultValue` | XML 行 | `vr` 字段 | `vr` 默认 | 一致？ |
| ---: | --- | --- | ---: | --- | --- | :---: |
| 6 | `ls_enable` | `false` | `:12` | **`j0`** | `false`（`v3`） | ✅ |
| 10 | `direct_unlock` | `false` | `:18` | **`k0`** | `false`（`v3`） | ✅ |
| 2 | `ics_ls_aa` | `true` | `:6` | **`l0`** | `true`（`v2`） | ✅ |
| 9 | `ls_enable_land` | `false` | `:17` | **`m0`** | `false`（`v3`） | ✅ |
| 3 | `ls_aa_blur` | `false` | `:7` | **`n0`** | `false`（`v3`） | ✅ |
| 4 | `ls_default_aa` | `false` | `:8` | **`o0`** | `false`（`v3`） | ✅ |
| 7 | `ls_force_timeout` | `true` | `:13` | **`p0`** | `true`（`v2`） | ✅ |

**结论：7/7 一致。** 两处修改任一处而不同步即会失配，属**无静态校验的维护风险**。

> **`p0`（`ls_force_timeout`）的 `sput` 位置特殊**：它在 `:1576`，紧邻前一行 `:1572`
> 有一条 `if-ne v10, v9, :cond_5`。经解析，`:cond_5` 落在 `:3878`，其体是
> `new-instance v1, Ljava/lang/AssertionError;` 与字符串 `"bad slot=70 expecting="`
> —— 这是 **`ms` 内部 FastStaticPrefs 槽位编号自检断言**（期望第 70 号槽），
> **不是设备条件分支**。`p0` 在正常运行路径上**必然被赋值**
> 【实证·产物】`vr.smali:1572`、`vr.smali:3878-3898`。
> 同一模式在本文件另有 6 处（`:924`/`:1572`/`:2068`/`:2569`/`:2625`/`:2907`/`:3562`
> 各配一个断言块），全部指向 `AssertionError`，属代码生成器的槽位防错。

### 3.5 7 个字段的消费方（不在本页 helper 内）

本次未逐一反编译消费侧（原有文档 §9 Q5/Q6 亦为未解）。已知结构：
`pb1` 是布尔偏好句柄，`.у(Z)` 写值（§5.6）。`ls_enable` 的**唯一**业务逻辑在
`la1.I()`（§5.2），而 `ics_ls_aa`/`ls_aa_blur`/`ls_default_aa` 只通过
`tc(7)` 发消息通知重注册（§5.4），并不直接读字段。

---

## 4. `la1.smali` 完整逐段解析

### 4.0 结构总览

```
la1.smali  13557 B / 580 行
  :1-3     .class public final Lׅ/la1; / .super Lׅ/n91; / .source "_"
  :7-288   .method public static I(Lׅ/la1;Landroid/preference/Preference;Ljava/lang/Object;)Z
  :288     .end method
  :292-579 .method public final v()V
  :580     .end method
```

【实证·产物】`probe_pt_04_la1_skeleton.py`

`v()` 是 `n91` 的**唯一抽象钩子**：`.method public abstract v()V`【实证·产物】`n91.smali:2763`，
由 `n91.w()` 在 `:2770` 调用（`invoke-virtual {p0}, Lׅ/n91;->v()V`）⇒ 每页 helper 覆写它做装配。

**`la1` 没有任何实例字段**（无 `.field`），7 个字段全在 `vr`。这是 `н91` 家族的通用形态。

### 4.1 `I()` —— 权限闸门（`:7-288`）

签名三参：`(la1 实例, Preference, Object newValue)`，返回 `Z`。
这是 `OnPreferenceChangeListener` 的**委托实现**（`static`，供 `f81` 静态调用）。

#### 判定链（逐行）

| 步 | 行 | 指令 | 语义 |
| ---: | ---: | --- | --- |
| ① | **`:27`** | `if-eqz p2, :cond_1` | **`newValue == false` → 跳到 `:283` 返回 `true`**（关锁屏永不拦） |
| ② | **`:31`** | `sget-boolean p2, Lׅ/xn0;->О:Z` | 读平台能力标志 |
| ③ | **`:49`** | `if-eqz p2, :cond_0` | `О == false` → 跳 `:216`（**单层告知框**） |
| ④ | **`:53`** | `sget p2, Landroid/os/Build$VERSION;->SDK_INT:I` | 读 SDK |
| ⑤ | **`:57`** | `const/16 v4, 0x17` | 23 |
| ⑥ | **`:61`** | `if-lt p2, v4, :cond_0` | **SDK < 23 → 跳 `:216`（单层告知框）** |
| ⑦ | **`:69`** | `invoke-static {p2}, Landroid/provider/Settings;->canDrawOverlays(...)` | 查悬浮窗权限 |
| ⑧ | **`:77`** | `if-nez p2, :cond_1` | **已授权 → 跳 `:283` 返回 `true`** |
| ⑨ | `:81-205` | 构造 `PseudoAlertDialog$Builder` → `show()` | 未授权 → **双层权限框** |
| ⑩ | **`:210`** | `const/4 p0, 0x0` | `p0 = 0` |
| ⑪ | **`:213`** | `return p0` | ★ **返回 `false` ⇒ 开关回滚** |
| ⑫ | **`:216`** | `:cond_0` | 单层告知框（`n91.G`） |
| ⑬ | **`:278`** | `invoke-virtual {p0, p1, p2}, Lׅ/n91;->G(Ljava/lang/String;Ljava/lang/String;)V` | 仅标题+正文+OK 按钮 |
| ⑭ | **`:283-287`** | `:cond_1` → `const/4 p0, 0x1` → `return p0` | **返回 `true`** |

【实证·产物】`la1.smali:7-288`

#### 两条"放行"路径的语义差别

`I()` 有三条出口，其中两条返回 `true` 但**副作用完全不同**：

| 出口 | 触发条件 | 返回值 | 副作用 | 含义 |
| --- | --- | --- | --- | --- |
| `:283` 直达 | `newValue==false`，或 `О==false`，或 `SDK<23`，或**权限已授予** | **`true`** | **无** | 静默放行 |
| `:216` 告知框 | 走过 `:49` 或 `:61` 跳转 | **`true`** | `n91.G()` 弹**单层**告知框（正按钮 = `OK` `0x7f080001`） | **告知但允许** |
| `:210-213` | `О!=false` 且 `SDK>=23` 且**权限未授予** | **`false`** | 弹**双层**权限框 | ★ **告知并阻止** |

> **`false` 回滚是本页与耳机页最本质的区别。**
> `TwoStatePreference` 的 `OnPreferenceChangeListener` 返回 `false` 时**不提交新值**，
> 且开关视觉回滚。所以用户点开关后被弹框、关掉弹框，开关自己弹回原位（关）。
>
> 耳机页 `s91` 的监听器**每个分支都 `return true`**，弹框纯告知、开关照样打开。
> **两者代码形状几乎一样，语义完全相反** —— 这是静态分析最容易搞错的地方。

#### 双层权限框的构造（`:81-205`）

| 元素 | 资源 | 实文 | 行 |
| --- | --- | --- | ---: |
| 标题 | `0x7f0805c2` = `pref_poweramp_ls` | **Poweramp Lock Screen** | `strings.xml:1316` |
| 正文第 1 段 | `0x7f0805c5` = `pref_poweramp_ls_permissions_10` | Android 10 requires "Display over other apps permission" to show Poweramp Lock Screen | `:1319` |
| 分隔 | `"\n\n"`（`const-string v2, "\n\n"` @ `:40`） | — | — |
| 正文第 2 段 | `0x7f0805c4` = `pref_poweramp_ls_permissions2` | For shorter lock screen timeout, "Apps that can change system settings" or "Modify system settings" permission should be set for Poweramp | `:1318` |
| 正按钮 | **`:174`** `const p0, 0x7f080816` = `setup_permissions` | **Setup Permissions** | `:1879` |
| 正按钮回调 | **`:165`** `const/16 v1, 0xd` → **`:169`** `new-instance Lׅ/n2;` | `n2(la1, 13, Preference)` | — |
| 负按钮 | **`:184`** `const p0, 0x7f0800f9` = `cancel` | **Cancel** | `:209` |
| 负按钮回调 | `:189` `const/4 p1, 0x0` | `null` | — |

#### 单层告知框（`:216-278`）

| 元素 | 资源 | 行 |
| --- | --- | ---: |
| 标题 | `v3` = `0x7f0805c2`（`pref_poweramp_ls`） | — |
| 正文 | `0x7f0805c3`（`pref_poweramp_ls_permissions`）**+ `"\n\n"` + `0x7f0805c4`** | `:234`、`:252`、`:257` |
| 显示 | **`:278`** `n91.G(title, message)` | — |

> **两个弹框的正文第 1 段不同**：双层框用 `permissions_10`（Android 10 专项），
> 单层框用 `permissions`（通用"去应用详情手动设"）。第 2 段（`permissions2`）两者相同。

### 4.2 `v()` —— 7 个装配动作（`:292-579`）

按 `v()` 内的实际执行顺序：

| 序 | 动作 | 行 | 触及的 key |
| ---: | --- | ---: | --- |
| ① | `new Lׅ/tc;` + `const/4 v1, 0x7` | **`:296-303`** | 索引 **7** |
| ② | `ics_ls_aa` → `setOnPreferenceChangeListener(v0)` | **`:308-324`** | `ics_ls_aa` |
| ③ | `ls_aa_blur` → 同一 v0 | **`:329-345`** | `ls_aa_blur` |
| ④ | `ls_default_aa` → 同一 v0 | **`:350-366`** | `ls_default_aa` |
| ⑤ | `xn0.o` / `xn0.С` 门控 → 删 `ls_enable_land` | **`:371-424`** | `ls_enable_land` |
| ⑥ | `ls_enable` → `new Lׅ/f81;(p0, 3, v0)` → 监听 | **`:425-453`** | `ls_enable` |
| ⑦ | `ls_app_settings` → 两段动态 summary | **`:458-540`** | `ls_app_settings` |
| ⑧ | `restore_defaults` → `new Lׅ/x11;(0xf, p0)` → 点击 | **`:545-574`** | `restore_defaults` |
| ⑨ | `return-void` | **`:579`** | — |

> **注意 `:424` 的 `:cond_0` 标签位于删除块之后**，说明第 ⑤ 步是
> "**任一条件不满足就整体跳过删除**"（§4.2.1）。第 ⑥ 步的 `findPreference("ls_enable")`
> 在 `:429`，紧接 `:cond_0` 之后 —— 即**无论是否删除了 `ls_enable_land`，`ls_enable` 都要装配**。

#### 4.2.1 `ls_enable_land` 的删除条件（`:371-419`）

```asm
371:  sget-boolean v0, Lׅ/xn0;->o:Z      ; 平板标志
375:  if-nez v0, :cond_0               ; o != 0 → 跳过删除
379:  sget-boolean v0, Lׅ/xn0;->С:Z      ; 大屏标志
383:  if-nez v0, :cond_0               ; С != 0 → 跳过删除
387:  iget-object v0, p0, Lׅ/n91;->K:PreferenceScreen
391:  const-string v1, "pref_poweramp_ls"
395:  invoke-virtual {v0, v1}, PreferenceGroup;->findPreference(...)
403:  check-cast v0, Landroid/preference/PreferenceCategory;   ; ★ 转成分类
407:  const-string v1, "ls_enable_land"
411:  invoke-virtual {v0, v1}, PreferenceGroup;->findPreference(...)
419:  invoke-virtual {v0, v1}, PreferenceGroup;->removePreference(...)Z
424:  :cond_0
```

**`if-nez` 语义 = "为零则跳"**，因此 `if-nez … :cond_0` 表示"**该标志为 0 就跳过**"。
两条串联的结果是：

> **只有 `xn0.o == 0` 且 `xn0.С == 0`（都是小屏）时才删除 `ls_enable_land`；
> 任一为真（平板或大屏）则保留。**

【实证·产物】`la1.smali:371-419`

两个标志的精确计算：

| 标志 | 计算式 | 行 |
| --- | --- | --- |
| `xn0.o` | `(screenLayout & 0xf)` **`== 0x4`（XLARGE）** → true；或 `== 0x3`（LARGE）**且** `max(widthPixels, heightPixels) > 0x3e8(1000)` → true；否则 false | `BasePowerWidgetApplication.smali:628`（取 `screenLayout`）、`:632`（`and-int/lit8 …, 0xf`）、`:646`（`if-eq v1, v3`，`v3=0x4`）、`:673`（`if-le v1, v5`，`v5=0x3e8`）、`:700`（`sput-boolean v1, Lׅ/xn0;->o:Z`） |
| `xn0.С` | `heightPixels <= 1000` **且** `widthPixels > 1000` → true；或 `heightPixels > 1000` → true；否则 false。**等价于 `max(w,h) > 1000`** | `:738`（`if-gt v1, v5`）、`:742`（`if-le v2, v5`）、`:762`（`sput-boolean v3, Lׅ/xn0;->С:Z`） |

【实证·产物】`probe_pt_45_screen.py`

> **【推断】** 为什么小屏才删：`ls_enable_land` 是"允许自绘锁屏转横屏布局"。
> 小屏设备横屏锁屏没有实际场景，删掉以免误导；平板/大屏则有意义。
> 这是**存在性门控**（`removePreference`），不是变灰 —— 用户在小屏上**根本看不到**这一条。

#### 4.2.2 `ls_app_settings` 的两段动态 summary（`:458-540`）

```asm
462:  const-string v1, "ls_app_settings"
466:  invoke-virtual {v0, v1}, PreferenceGroup;->findPreference(...)
471:  move-result-object v0
474:  new-instance v1, Ljava/lang/StringBuilder;
483:  const v2, 0x7f0805c3            ; pref_poweramp_ls_permissions
492:  invoke-virtual {v3, v2}, Context;->getString(I)…
500:  invoke-virtual {v1, v2}, StringBuilder;->append(...)
505:  const-string v2, "\n\n"          ; ★ 两段分隔
509:  invoke-virtual {v1, v2}, StringBuilder;->append(...)
514:  const v2, 0x7f0805c4            ; pref_poweramp_ls_permissions2
519:  invoke-virtual {v3, v2}, Context;->getString(I)…
527:  invoke-virtual {v1, v2}, StringBuilder;->append(...)
532:  invoke-virtual {v1}, StringBuilder;->toString()…
540:  invoke-virtual {v0, v1}, Preference;->setSummary(Ljava/lang/CharSequence;)V
```

【实证·产物】`la1.smali:458-540`

渲染结果 = `permissions` + 空行 + `permissions2`，即：

> Some devices may require additional Lock Screen permission manually set in Android settings ➔ Apps for Poweramp
>
> For shorter lock screen timeout, "Apps that can change system settings" or "Modify system settings" permission should be set for Poweramp

> **为什么必须代码写**：XML 的 `android:summary` 只能挂**单个** `@string`，
> 无法表达 `"\n\n"` 拼接。且 `ls_app_settings` 是**原生 `Preference`**，
> 不支持 `w:line1`/`w:line2`（那是 `RawTextPreference` 的专属属性）。

#### 4.2.3 `restore_defaults` 的装配（`:545-574`）

```asm
549:  const-string v1, "restore_defaults"
553:  invoke-virtual {v0, v1}, PreferenceGroup;->findPreference(...)
561:  new-instance v1, Lׅ/x11;
565:  const/16 v2, 0xf                  ; ★ 索引 15
569:  invoke-direct {v1, v2, p0}, Lׅ/x11;-><init>(ILjava/lang/Object;)V
574:  invoke-virtual {v0, v1}, Preference;->setOnPreferenceClickListener(...)
```

【实证·产物】`la1.smali:545-574`

---

## 5. 关联类逐个定位

### 5.1 分发起点 `u61.smali:852-865`

```asm
852:  const v0, 0x7f16001d               ; xml/lockscreen
857:  if-ne v3, v0, :cond_13            ; 页面 id 不匹配 → 下一个
861:  new-instance v0, Lׅ/la1;          ; ★ 实例化 helper
865:  invoke-direct {v0, v1, p0, v3, v10}, Lׅ/n91;-><init>(SettingsActivity, Lׅ/m91;, I, I)V
```

【实证·产物】`u61.smali:852-865`

`la1` 全局仅 9 处引用（1 处定义 + 1 处实例化 + 7 处 `check-cast` + 1 处静态调用）
【实证·产物】`probe_pt_28_final.py`。

### 5.2 `n2.smali:182-256` —— 双层框正按钮落地

`n2` 是通用的 `DialogInterface$OnClickListener`，`X:I` 字段为**索引**，
`:66` `packed-switch v0, :pswitch_data_0`；表在 `:1515-1529`，`idx 13 → :pswitch_0`（体 `:182`）
【实证·产物】`probe_pt_13_table_parse.py`。

```asm
182:  :pswitch_0
183:  iget-object p1, p0, Lׅ/n2;->y:Ljava/lang/Object;
187:  check-cast p1, Lׅ/la1;                     ; 回调对象
191:  iget-object p2, p0, Lׅ/n2;->у:Ljava/lang/Object;
195:  check-cast p2, Landroid/preference/Preference;
204:  check-cast p2, Landroid/preference/SwitchPreference;   ; ★ 再转成开关
208:  invoke-virtual {p2, v4}, Landroid/preference/TwoStatePreference;->setChecked(Z)V   ; ★ v4=1
214:  iget-object p1, p1, Lׅ/n91;->К:L…SettingsActivity;
218:  new-instance p2, Landroid/content/Intent;
222:  const-string v0, "android.settings.action.MANAGE_OVERLAY_PERMISSION"   ; ★ 全局悬浮窗列表
226:  invoke-direct {p2, v0}, Landroid/content/Intent;-><init>(Ljava/lang/String;)V
231:  invoke-virtual {p1, p2}, …SettingsActivity;->startActivity(Landroid/content/Intent;)V
233:  .catchall {…} :catchall_0
241:  :catchall_0
245:  const-string p2, "SettingsHelperLockscreen"   ; ★ 日志 tag = 原始类名
249:  invoke-static {p2, v2, p1}, Landroid/util/Log;->e(…)
254:  :goto_0
255:  return-void
```

【实证·产物】`n2.smali:182-256`

`v4` 的来源：`:63` `const/4 v4, 0x1`（方法首部，`:44-66` 内）【实证·产物】。

| 细节 | 含义 |
| --- | --- |
| **`setChecked(true)` 手工补设** | `I()` 返回 `false` 导致框架回滚了视觉状态；用户点"Setup Permissions"时**由代码重新置 true**，表达"用户已表达意图" |
| Intent **不带 `package:`** | 跳**全局**"显示在其他应用上层"列表；对照 `ls_app_settings` 的 `<intent>` **带** `package:com.maxmpz.audioplayer`（§2.5） |
| 整段包在 `try/catchall` 中 | `startActivity` 抛任何异常都被 `Log.e` 吞掉，**不崩溃** |
| `Log.e("SettingsHelperLockscreen", …)` | ★ 混淆器未改字符串常量，**直接证实 `la1` 原名是 `SettingsHelperLockscreen`** |

> **右移一步的语义**：不是"打开权限就顺便打开开关"，而是"**用户既然点了去授权，
> 就默认他想要这个功能，先把开关摆到开的位置**"。授权回来后 `I()` 重跑，
> 若权限已授予则 `:283` 返回 `true`，开关正式生效。
> 若用户放弃授权返回，开关**仍停在开的状态**（代码已 `setChecked(true)`），
> 但下一轮 `performClick` 前的 `isChecked` 与偏好值可能不一致 ——
> 这是**已知的行为毛刺**【推断，未在真机验证】。

### 5.3 `f81.smali` —— 纯转发（idx 3）

表在 `:471-475`：`idx 0→pswitch_3`、`1→pswitch_2`、`2→pswitch_1`、**`3→pswitch_0`（体 `:104`）**。

```asm
104:  :pswitch_0
105:  check-cast v4, Lׅ/la1;
109:  check-cast v3, Landroid/preference/Preference;
113:  invoke-static {v4, v3, p2}, Lׅ/la1;->I(Lׅ/la1;Landroid/preference/Preference;Ljava/lang/Object;)Z
118:  move-result p1
121:  return p1                          ; ★ 原样透传
```

【实证·产物】`f81.smali:104-121`

`f81` 三字段（`:10`/`:12`/`:14`）：`B`=`Object`（此处是 `la1`）、`А`=`Object`（此处是 `Preference`）、
`В`=`I`（索引）。构造函数 `:18` `(Object, int, Object)`。

> **纯转发是 `return false` 能生效的必要条件。** 中间任何一层把返回值改成 `true`
> 或忽略返回值，回滚就失效。`f81` 的 `pswitch_0` 只有 `check-cast` ×2 + 静态调用 + `return`。

### 5.4 `tc.smali` —— 媒体会话重注册（idx 7）

表在 `:899-909`，`idx 7 → :pswitch_2`（体 `:470`）：

```asm
470:  :pswitch_2
471:  check-cast v4, Lׅ/la1;
475:  iget-object p1, v4, Lׅ/n91;->у:L…SettingsActivity;
479:  const p2, 0x7f0d0034                      ; bus_player_cmd
484:  invoke-static {p1, p2}, Lcom/maxmpz/widget/MsgBusHelper;->fromContextOrThrow(Context, I)MsgBus;
492:  const p2, 0x7f0d0206                      ; ★ cmd_player_reregister_media_session
497:  invoke-interface {p1, p2, v2, v2, v1}, Lcom/maxmpz/widget/MsgBus;->post(IIILjava/lang/Object;)V
502:  return v3                                 ; v3 = 1 → true
```

【实证·产物】`tc.smali:470-502`

`v2` = `:49` `const/4 v2, 0x0`，`v3` = `:52` `const/4 v3, 0x1` ⇒ `post(0x7f0d0206, 0, 0, null)`，
**全空 payload，纯信号**，返回 `true`。

| 项 | 值 | 证据 |
| --- | --- | --- |
| 总线 id | `0x7f0d0034` = `bus_player_cmd` | `public.xml:6974` |
| 消息 id | `0x7f0d0206` = `cmd_player_reregister_media_session` | `public.xml:7440` |
| 触发者 | `ics_ls_aa` / `ls_aa_blur` / `ls_default_aa` **三个**共用 | `la1.smali:296-366` |

> **一个监听器服务三个开关是精准的**：这三项只影响"发往系统媒体会话的封面数据"，
> 而媒体会话注册是**一次性快照**，改参数必须**重新注册**才生效。
> **`ls_enable` 不用这条路** —— 自绘锁屏启停不是媒体会话的事（§5.5）。

### 5.5 `x11.smali` —— 恢复默认链（idx 15）

表在 `:849-874`，`idx 15 → :pswitch_9`（体 `:446`）：

```asm
446:  :pswitch_9
447:  check-cast v3, Lׅ/la1;
451:  new-instance p1, Lׅ/p71;
455:  const/4 v0, 0x6                    ; ★ p71 索引 6
458:  invoke-direct {p1, v0, v3}, Lׅ/p71;-><init>(ILjava/lang/Object;)V
463:  invoke-virtual {v3, p1, v1, v2}, Lׅ/n91;->m(Ljava/lang/Runnable;Ljava/lang/Runnable;I)V
```

【实证·产物】`x11.smali:446-463`

`v1` = `:49` `const/4 v1, 0x0`（负 Runnable = `null`），`v2` = `:52` `const/4 v2, 0x0`（消息 id），
`v4` = `:59` `const/4 v4, 0x1`（返回值 `true`）。

`n91.m` 签名：`.method public final m(Ljava/lang/Runnable;Ljava/lang/Runnable;I)V`【实证·产物】`n91.smali:2190`：

```asm
2194:  new-instance v2, Lׅ/b6;
2202:  invoke-direct {v2, p0, v0, p1}, Lׅ/b6;-><init>(Lׅ/n91;ILjava/lang/Runnable;)V   ; p1 = p71
2210:  const v1, 0x7f0805f6            ; pref_restore_defaults_msg
2224:  invoke-virtual/range {v0 .. v5}, Lׅ/n91;->l(ILjava/lang/Runnable;Ljava/lang/Runnable;IZ)V
```

【实证·产物】`n91.smali:2190-2229`

`n91.l(int, Runnable, Runnable, int, boolean)` 签名 `:2068`，构造确认框：

| 元素 | 资源 | 行 |
| --- | --- | ---: |
| 标题 | **`:2085` `0x7f0805f5` = `pref_restore_defaults`** → **Restore Defaults** | `n91.smali:2085` / `strings.xml:1366` |
| 正文 | `p1` = 调用方传入的 `0x7f0805f6` ⇒ **All options on this page will be restored to the default values** | `n91.smali:2098` / `strings.xml:1367` |
| 正按钮 | **`:2145` `0x7f080001` = `OK`**，回调 `e91`（携带 `b6`） | `n91.smali:2145` / `public.xml:4206` |
| 负按钮 | **`:2158` `0x7f0800f9` = `cancel`**，回调 `null` | `n91.smali:2158` |

> **标题是 `Restore Defaults`、正文才是 `All options on this page…`**。
> 即确认框标题复用了条目名（`pref_restore_defaults`），正文用 `_msg`。
> 这一点容易误记为"标题是 `_msg`"。

### 5.6 `p71.smali:878-931` —— 恢复默认后的补丁

`p71` 表在 `:1206`，`idx 6 → :pswitch_10`（体 `:878`）：

```asm
878:  :pswitch_10
879:  check-cast v6, Lׅ/la1;
883:  sget-boolean v0, Lׅ/xn0;->Х:Z      ; Xiaomi/MIUI
887:  if-nez v0, :cond_9
891:  sget-boolean v0, Lׅ/xn0;->В:Z      ; Samsung
895:  if-nez v0, :cond_9
899:  sget-boolean v0, Lׅ/xn0;->х:Z      ; Meizu
903:  if-nez v0, :cond_9
907:  sget-boolean v0, Lׅ/xn0;->А:Z      ; Huawei
911:  if-eqz v0, :cond_a               ; А != 0 → 跳过
915:  :cond_9
916:  sget-object v0, Lׅ/vr;->n0:Lׅ/pb1;  ; ★ ls_aa_blur 句柄
920:  invoke-virtual {v0, v5}, Lׅ/fc;->у(Z)V   ; v5 = 0 → 强制写 false
925:  invoke-virtual {v6}, Lׅ/n91;->y()V        ; ★ 刷 "__agg" 服务
930:  :cond_a
931:  return-void
```

【实证·产物】`p71.smali:878-931`；`v5` = `:58` `const/4 v5, 0x0`（方法首部）

**执行条件**：`Х`/`В`/`х` 任一为真 **或** `А` 为假 —— 即**非华为即执行，华为则跳过**。

四个标志的精确归属（本次新增实证）：

| 标志 | 归属 | 赋值行 |
| --- | --- | --- |
| `xn0.Х` | **Xiaomi（MIUI）** | `xn0.smali:976`（源 `ro.miui.ui.version.name` @ `:496`） |
| `xn0.В` | **Samsung** | `xn0.smali:960`（brand `samsung` @ `:200`） |
| `xn0.х` | **Meizu** | `xn0.smali:972`（brand `meizu` @ `:442`） |
| `xn0.А` | **Huawei** | `xn0.smali:968`（brand `huawei` @ `:407`） |

【实证·产物】`probe_pt_44_brands.py`。注意 `xn0` 里存在 **`A`(ASCII) / `А`(Cyrillic) /
`B` / `В` / `x` / `х` / `K` / `К` / `H` / `Н` / `O` / `О` / `C` / `С` / `y` / `у` / `p`**
多组**同形异码**字段，混淆器刻意制造了拉丁/西里尔混淆对（`:956-1000` 一次性 `sput` 了 17 个）。
引用时**必须按码位精确区分**。

#### 关键：`fc.y()` 与 `fc.у(Z)` 的真实语义

类型链：`pb1 .super fc .super t9 .super Object`【实证·产物】`pb1.smali:1-2`、`fc.smali:1-2`、`t9.smali:1-2`。

```asm
; fc.smali:144-158  y()
144:  .method public final y()V
148:  iget-boolean v0, p0, Lׅ/fc;->B:Z      ; ★ B = 构造期存下的【默认值】
152:  invoke-virtual {p0, v0}, Lׅ/fc;->у(Z)V ; 写回默认值

; fc.smali:213-240  у(Z)
213:  .method public final у(Z)V
217:  iget-boolean v0, p0, Lׅ/fc;->А:Z      ; ★ А = 当前值
221:  if-eq v0, p1, :cond_0                ; ★ 值没变 → 直接返回（幂等）
225:  iput-boolean p1, p0, Lׅ/fc;->А:Z
229:  iget-object p1, p0, Lׅ/t9;->В:Lׅ/er;
233:  invoke-virtual {p1}, Lׅ/er;->А()V     ; ★ 写值即广播
```

【实证·产物】`fc.smali:144-158` / `fc.smali:213-240`

`er.А()` 只是把计数器 `er.В` 自增（`:133-141`）—— 一个**变更序号**，
供上层判断偏好是否被改动过【实证·产物】`er.smali:129-146`。

> **这解开了旧文档的 Q7（`p71(6)` 第一行是否冗余）**：
> `vr->n0` 类型是 `pb1`，其 `.у(Z)` 继承自 `fc`，语义是"**把值写成该偏好的默认值**"，
> 而 **`ls_aa_blur` 的默认值本来就是 `false`**（`vr.<clinit>` 传 `v3=0`，§3.4）。
> 所以 `у(false)` 等价于 `у(默认值)` —— **第一行确实冗余**；
> 且因 `fc.у()` 有 `if-eq` 幂等守卫，即使执行也**不产生额外广播**（值未变则不调 `er.А()`）。
>
> **真正有价值的是第二行 `n91.y()`。**

#### 两个同名 `y()` 必须区分

| 方法 | 类 | 行 | 语义 |
| --- | --- | --- | --- |
| `n91.y()` | `n91`（页面 helper 基类） | **`n91.smali:2941-2978`** | 取 `"__agg"` 系统服务（`:2957`）→ `check-cast Lׅ/w2;`（`:2969`）→ `w2.В()`（`:2973`） |
| `fc.y()` / `t9.y()` | 偏好句柄基类 | **`fc.smali:144-158`** | 把该偏好的值恢复为默认值 |

`w2.В()` 本体：`:55` 取线程池 `mh1.B`，`:75` `execute(new Lׅ/Н;(4, this))`
【实证·产物】`w2.smali:55-81` —— 即**异步提交一个刷新任务**。

### 5.7 `n91.m` / `n91.G` / `n91.n` —— 三个被本页用到的基类方法

| 方法 | 签名 | 行 | 本页用途 |
| --- | --- | --- | --- |
| `n91.G(String,String)` | 标题 + 正文 + 单 OK 按钮（`0x7f080001` `OK`，回调 `null`） | **`:1134-1188`**（正按钮 `:1161`） | 权限闸门**单层告知框**（§4.1 :278） |
| `n91.m(Runnable,Runnable,int)` | 包一层 `b6`，转调 `n91.l`，正文固定 `0x7f0805f6` | **`:2190-2229`** | `restore_defaults` 确认框（§5.5） |
| `n91.n(PreferenceGroup,v2)` | **static**，递归通用重置 | **`:714-884`** | 由 `b6.run()` 调用（§5.8） |

`n91.n()` 的七道筛选（`:742`–`:869`）：

| # | 行 | 条件 |
| ---: | ---: | --- |
| ① | `:742` | `Preference;->isPersistent()` 必须为真 |
| ② | `:762`–`:766` | 类必须**不是**裸 `android.preference.Preference` |
| ③ | `:782`–`:790` | 是 `PreferenceGroup` 则跳过（`:857`–`:869` 转递归） |
| ④ | `:802`–`:810` | `TUtils.isEmpty(getKey())` 必须为假（**必须有 key**） |
| ⑤ | `:814`–`:823` | 按 key 查 `v2.В`（`ConcurrentHashMap`）注册表 |
| ⑥ | `:826`–`:830` | 必须查到（非 null） |
| ⑦ | `:834`–`:838` | 必须 `instance-of Lׅ/t9;` |
| ★ | **`:850`** | `invoke-virtual {v3}, Lׅ/t9;->y()V` —— 调默认值恢复 |

【实证·产物】`n91.smali:714-884`

> 对本页的推论：7 个状态键（持久 + 有 key + `MultilineSwitchPreference`）**全部满足**①–④，
> 其中能在 `v2` 注册表里查到的会经 ⑦ 调 `t9.y()` 重置。
> `ls_app_settings`（原生 `Preference` + 非持久）**被 ① 或 ② 挡掉**；
> 提示块（无 key + `RawTextPreference` 类内强制非持久）**被 ① 和 ④ 双重挡掉**。
> ⇒ **提示块在"恢复默认"后依然存在**，这是独立于"`la1` 从不删它"的第二重证明。

### 5.8 `b6.run()` —— 恢复默认的真实执行顺序（重要）

`n91.m` 传下去的 `p1`（=`p71(6)`）被 `b6` 存为 `у` 字段，在 `b6.run()` 末尾执行
**在通用重置之后、且在刷 `"__agg"` 之后**：

```asm
400:  invoke-static {v0, v3}, Lׅ/n91;->n(Landroid/preference/PreferenceGroup;Lׅ/v2;)V  ; ★ ① 通用重置
409:  invoke-virtual {v0}, Lׅ/w2;->В()V                                                  ; ★ ② 刷 "__agg"
419:  invoke-interface {v2}, Ljava/lang/Runnable;->run()V                                 ; ★ ③ p71(6)
```

【实证·产物】`b6.smali:400` / `:409` / `:419`（`v2` = `:368` `check-cast … Ljava/lang/Runnable;`）

顺序即：**通用重置 → 刷 `w2`（"__agg"）→ 跑 `p71(6)` 补丁**。

`b6.smali:414` 的 `if-eqz v2, :cond_3` 说明：**`p71(6)` 只在 `n91.m` 传入非 null Runnable 时执行**；
若某页调 `n91.m(null, …)` 则 `:419` 被跳过。

> **`"__agg"` 服务身份已确认**：`BaseApplication.getSystemService` 里
> `const-string v0, "__agg"`（`:1557`）→ `:1577` `const/4 v3, 0x4`（索引 4）
> → `:1689` `packed-switch v3` → 表 `:2093-2108`，`idx 4 → :pswitch_a`（`:1821`）
> → `:1842` `check-cast p1, Lׅ/w2;` 返回
> 【实证·产物】`BaseApplication.smali:1557`/`:1577`/`:1689`/`:1821`/`:1842`。
> 该 `w2` 来自 `с:Lׅ/tg1;` 的 lazy（`:1826`–`:1834`），是**单例**，与 `v2` 构造时
> 传入的 `w2` 同源（`О.smali:1737` `invoke-direct {v2, v0, v1}, Lׅ/v2;-><init>(Lׅ/w2;…)`
> 而 `v0` 即 `О.smali:1682` `check-cast v0, Lׅ/w2;` 的 `p0.y`，同一 `__agg` 单例）
> ⇒ **`n91.y()`、`b6` 的 `w2.В()`、`p71` 的 `n91.y()` 操作的是同一个 `w2` 实例。**

### 5.9 `xn0.smali` —— 平台标志

`xn0` 是 `abstract` 类（`:1`），全部静态标志在 `<clinit>`（`:63` 起）计算。

#### `xn0.О`（权限闸门第一条件）

```asm
67:   sget v0, Landroid/os/Build$VERSION;->SDK_INT:I
77:   const/16 v3, 0x1d              ; 29
81:   if-ge v0, v3, :cond_1         ; SDK < 29 → :cond_1
85:   const/16 v4, 0x1c              ; 28
89:   if-ne v0, v4, :cond_0         ; SDK != 28 → :cond_0
93:   invoke-static {}, Lׅ/ac;->Х()I ; PREVIEW_SDK_INT
101:  if-lez v4, :cond_0            ; PREVIEW_SDK_INT <= 0 → :cond_0
105:  goto :goto_0                  ; → v4 = 1
108:  :cond_0
109:  const/4 v4, 0x0
115:  :cond_1
116:  :goto_0
117:  const/4 v4, 0x1
121:  sput-boolean v4, Lׅ/xn0;->О:Z
```

【实证·产物】`xn0.smali:67-121`

**真值表（逐分支推导）**：

| SDK_INT | 走哪条 | `О` |
| --- | --- | :---: |
| `< 29`（≤ 28） | `:81` `if-ge` 成立 → `:cond_1` → `:goto_0` → `v4=1` | **`true`** |
| `== 28` 且 `PREVIEW_SDK_INT > 0` | `:81` 不成立 → `:89` `if-ne` 不成立 → `:93` → `:101` `if-lez` 不成立 → `:105` `goto_0` → `v4=1` | **`true`** |
| `== 28` 且 `PREVIEW_SDK_INT <= 0` | → `:101` 成立 → `:cond_0` → `v4=0` | `false` |
| `> 29` | `:81` 不成立 → `:89` `if-ne` 成立 → `:cond_0` → `v4=0` | `false` |

> **`const/16 v4, 0x1c`（28）这条分支在 Android 正式版上永不成立** ——
> `Build.VERSION.SDK_INT` 对已发布 SDK 永远是 `PREVIEW_SDK_INT` 对应的正式号，
> 不存在"SDK_INT==28 且 PREVIEW_SDK_INT>0"。
> 所以 `О` 的**实际效果**退化为：**`SDK_INT < 29` → `true`；`SDK_INT >= 29` → `false`**。
>
> 而 `I()` 的判定是 `if-eqz О, :cond_0`（`:49`）—— `О == false` 时走**单层告知框**。
> ⇒ 在 Android 10+（SDK ≥ 29）上，`I()` **不做 `canDrawOverlays` 检查，只弹单层告知框并放行**；
> 在 Android 9-（SDK ≤ 28）上，`О == true`，继续检查 `SDK>=23` 与 `canDrawOverlays`。
>
> **这与文案完全矛盾**：`permissions_10`（`0x7f0805c5`）说
> "Android 10 requires 'Display over other apps permission'"，
> 但代码恰恰在 **Android 10 上跳过了这项检查**。
> 这是一个**真实的实现与文案不一致**，旧文档 Q2 的"未解"在此得到解释：
> 不是"为什么把 preview SDK 当条件"，而是**该条件是给 Android 9 及以下用的**，
> 命名与文案造成误导【实证·产物 + 推断（真值表为实证，语义解释为推断）】。

#### `xn0.o` / `xn0.С` / `xn0.Х`/`В`/`х`/`А`

字段声明：`o` 在 `:27`（`public static o:Z`，**非 final**）、`О` 在 `:43`（`final`）、`С` 在 `:47`（`final`）。

- `o`（平板）/`С`（大屏）**不在 `xn0.<clinit>` 计算**，而在
  `BasePowerWidgetApplication.smali:700` / `:762` —— 因为需要 `DisplayMetrics` 与 `Configuration`。
- `Х`/`В`/`х`/`А` 在 `xn0.<clinit>:956-1000` 一次性赋值，值来自 OEM brand 判定链
  （§5.6 表）。

### 5.10 `nr0.smali` —— SDK 版本常量

```asm
15:   sget v0, Landroid/os/Build$VERSION;->SDK_INT:I
19:   const/16 v1, 0x21            ; ★ 33
23:   if-lt v0, v1, :cond_0        ; SDK >= 33 → v0 = 0x1
27:   const/4 v0, 0x1
34:   :cond_0  const/4 v0, 0x0
38:   sput-boolean v0, Lׅ/nr0;->В:Z
```

【实证·产物】`nr0.smali:15-38`（**文件共 43 行**）

`nr0.В = (SDK_INT >= 33)`。本页 `la1` **不引用** `nr0`；只有 `z61`（通知设置页）用它：

```asm
521:  const-string v0, "buttons"
529:  invoke-virtual {v1, v0}, PreferenceGroup;->findPreference(...)
537:  if-eqz v0, :cond_b
541:  sget-boolean v1, Lׅ/nr0;->В:Z    ; SDK >= 33 ?
545:  if-nez v1, :cond_8              ; 为假（SDK<33）→ 继续删除
553:  invoke-virtual {v1, v0}, PreferenceGroup;->removePreference(...)Z   ; ★ 删掉
```

【实证·产物】`z61.smali:521-553`

> **`ui_notify` 页在 SDK < 33 时删掉 `buttons`；`lockscreen` 与 `misc` 两页都不删。**
> 同一入口在三处可见性不一致（旧文档此项结论正确，§7 复核）。

### 5.11 `buttons` 三处同名（不属于本页 helper 的职责）

`w:target="ui_mediaactions"` 全树仅 3 处：【实证·原文】`lockscreen.xml:9`、`ui_notify.xml:7`、`misc.xml:10`。

`RedirectPreference.smali:2` `.super Lcom/maxmpz/audioplayer/preference/RawTextPreference;`，
而 `RawTextPreference` 构造函数内**无条件** `setPersistent(false)`：

```asm
174:  const/4 v3, 0x0
177:  invoke-virtual {v0, v3}, Landroid/preference/Preference;->setPersistent(Z)V
```

【实证·产物】`RawTextPreference.smali:174-177`

⇒ `buttons` **从不写入 `"global"`**，三处同名不构成状态覆盖。
`la1` 全文**不出现** `"buttons"` 字符串。

---

## 6. 与现有文档的差异对比

对照文档：`docs/architecture/poweramp-lockscreen-settings.md`（620 行，`status: draft`）。
本节逐条复核，分三类。**共 11 条纠正、12 条新发现、6 类确认。**

### 6.1 ✅ 经复核确认正确

| # | 原文档结论 | 复核 |
| ---: | --- | --- |
| C1 | XML **21 行 / 3224 B / 15 元素 / 12 key** | ✅ 全对 |
| C2 | 7 个状态键 + 2 分类键 + 1 跳转键 + 2 动作键 = 12 | ✅ 全对 |
| C3 | 唯一无 key 提示块带 `settings_quote_background` + `w:keepPaddings` | ✅ 全对 |
| C4 | 唯一内嵌 `<intent>`：`APPLICATION_DETAILS_SETTINGS` + `package:com.maxmpz.audioplayer`，`lockscreen.xml:14-16` | ✅ 全对（行号精确） |
| C5 | §5.1 默认值表 **7/7 一致**，`v2=1`（`:400`）/`v3=0`（`:435`） | ✅ 全对，7 个 `vr` 行号逐条核实无误 |
| C6 | §6.1 判定链四条分支的**行号**（`:27`/`:31`/`:53-61`/`:65-74`/`:77`/`:210-213`） | ✅ 全对（本页 §4.1 逐行复核） |
| C7 | §6.8 动作表 7 个动作的行号（`:296-366`/`:371-424`/`:425-453`/`:458-540`/`:545-574`） | ✅ 全对 |
| C8 | `n2` 正按钮 `setChecked` `:208`、Intent `:222-231`、日志 tag `:245`、`n2.smali:182-256` | ✅ 全对 |
| C9 | `tc` idx 7 → `:470-502` → `0x7f0d0206`；`f81` 表 `:470-476`；`x11` 表 `:848-875`；`p71` 表 `:1205-1230` | ✅ 全部对（表格入口行 ±1 属可接受） |
| C10 | `RawTextPreference` 构造函数无条件 `setPersistent(false)` `:174-177` | ✅ 全对（`const/4 v3,0x0` 在 `:174`，调用在 `:177`） |
| C11 | `RedirectPreference extends RawTextPreference`，`buttons` 不写 `"global"`，三处同名不冲突 | ✅ 全对 |
| C12 | `z61` 在 `nr0.В`（SDK<33）时删 `ui_notify` 的 `buttons`，`la1`/`sa1` 不删 | ✅ 全对（`z61.smali:521-553`） |

### 6.2 ⚠️ 需要纠正

| # | 原文档位置 | 原文 | 实际 | 证据 |
| ---: | --- | --- | --- | --- |
| ~~M1~~ | — | ~~原文档把类描述符写成 `L讌/…`~~ | **此条撤销（Lead 复核）**：原文档 `poweramp-lockscreen-settings.md` 的用法**本来就是正确的** —— 全文 `U+05C5` 出现 **40 次**，`讌`(U+8B8C) / `諌`(U+8ACC) / `謌`(U+8B0C) 各 **0 次**。所谓"码位踩坑"实为**任务简报本身的口误**，不是原文档的错误。**原文档在此项无问题。** | `.rea-analysis/tools/probe_lead10_doccheck.py` |
| **M2** | §1 表 | `u61.smali:852-870` | 分发在 **`:852-865`**；`:870` 是 `goto/16 :goto_3`，`:875` 起已是下一个 `:cond_13`（`0x7f160001`） | 【实证·产物】`u61.smali:852-865` |
| **M3** | §2.5 属性矩阵 | `android:summary` **9** 次，分布"根 + #2/3/4/5/6/7/10" | **10** 次。分布 = **根（`:2`）+ #2/3/4/5/6/7/10 + 提示块（`:5`）**。原表把根算进去了却漏了提示块 | 【实证·原文】`probe_pt_46` |
| **M4** | §2.5 | `android:title` 未列次数 | **13** 次（根 1 + 分类 2 + 偏好 10） | 【实证·原文】`probe_pt_46` |
| **M5** | §6 表 | `v()` 在 `:292-579` | **`:292-580`**。`:579` 是 `return-void`，`:580` 才是 `.end method` | 【实证·产物】`la1.smali:579-580` |
| **M6** | §6.3 | `ls_enable_land` 删除条件写作"两个都为假（小屏）→ 删除"（结论对），但把 `:379`/`:383` 的 `if-nez` 描述为"`С != 0 → 跳过删除" | 结论对，**`if-nez` 的机制表述需精确化**：`if-nez` = "为 0 则跳转" ⇒ `if-nez … :cond_0` 是"标志为 0 就跳过"，与"!=0 则跳过"等价但方向相反，易反向误读。本文档 §4.2.1 按指令语义重写 | 【实证·产物】`la1.smali:375`/`:383` |
| **M7** | §5.2 运行期文案表 | `pref_poweramp_ls_permissions` 用于"`ls_app_settings` summary 第 1 段"（对），但把 `pref_poweramp_ls` 仅记为"权限弹框标题" | `pref_poweramp_ls`（`0x7f0805c2`）**同时**是分类标题（`lockscreen.xml:11`）**和**权限弹框标题（`la1.smali:44`）；`permissions_10` 只用于**双层框**第 1 段，**单层框**第 1 段用 `permissions`（`la1.smali:234`） | 【实证·产物】`la1.smali:44`/`:234` |
| **M8** | §6.7 + §9 Q7 | 认为 `vr->n0.у(0)` 的 `у` 语义不明，"第一行是否冗余无法分离验证" | **已解**：`fc.у(Z)` = 写值并广播（带 `if-eq` 幂等守卫）；`fc.y()` = 恢复默认值。`n0` 默认即 `false` ⇒ **第一行确实冗余且幂等无害**，真正价值在第二行 `n91.y()` | 【实证·产物】`fc.smali:144-158`/`:213-240` |
| **M9** | §9 Q2 | "为何把 preview SDK 作为需要权限提示的条件，未解" | **已解**：`xn0.О` 实际效果是 **`SDK_INT < 29` → `true`；`≥ 29` → `false`**（`const/16 v4, 0x1c` 分支在正式版不可达）⇒ **Android 10+ 上 `I()` 跳过 `canDrawOverlays` 检查**，与 `permissions_10` 文案**相反** | 【实证·产物】`xn0.smali:67-121` + `la1.smali:49` |
| **M10** | §5.3 | 称提示块"`la1.smali` 全文没有任何针对该条目的 `removePreference` —— 它无 key，连 `findPreference` 都无法定位。**所以这个提示块是永久的**" | 结论对，**但只靠"不删"推理不足**。第二重独立证明：`n91.n()` 的七道筛选里，提示块因 **无 key（`:802`）** 与 **类内强制非持久（`:742`）** 被**双重**挡掉，恢复默认也不会动它 | 【实证·产物】`n91.smali:742`/`:802` |
| **M11** | §6.7 | "`n91.y()`（取 `__agg` 系统服务 `n91.smali:2941-2979` → `w2.В()` → 刷新媒体会话/服务）" 表述含糊，"`__agg` 是什么"未定 | **`__agg` = `Lׅ/w2;` 单例**，经 `BaseApplication.getSystemService` 索引 4 返回（`:1557`/`:1577`/`:1821`/`:1842`）；`w2.В()` = 向线程池 `mh1.B` 提交异步刷新任务（`w2.smali:55-81`） | 【实证·产物】`BaseApplication.smali:1557-1842`、`w2.smali:55-81` |

### 6.3 🆕 本次新发现

| # | 新发现 | 证据 |
| ---: | --- | --- |
| **N1** | **`v2`/`v3` 在 `<clinit>` 中只被赋值一次**（`:400`/`:435`），到 `:1580` 再无写入 ⇒ 7 个默认值可在该区间内静态判定，无需运行时推测 | 【实证·产物】`probe_pt_26` |
| **N2** | **`p0`（`ls_force_timeout`）的 `sput` 位于一条 `if-ne` 之后（`:1572`）**，但该分支是 **FastStaticPrefs 槽位自检断言**（`:cond_5` @ `:3878` → `AssertionError` + `"bad slot=70 expecting="`），**不是设备条件**。此前易被误读为"该偏好条件注册" | 【实证·产物】`vr.smali:1572`/`:3878-3898` |
| **N3** | **`xn0` 存在 17 组拉丁/西里尔同形异码字段**（`A`/`А`、`B`/`В`、`x`/`х`、`K`/`К`、`H`/`Н`、`O`/`О`、`C`/`С`、`y`/`у`、`p`…），`:956-1000` 一次性 `sput`。引用必须按码位区分 | 【实证·产物】`xn0.smali:956-1000` |
| **N4** | **`p71(6)` 的四个门控标志的真实归属**：`Х`=Xiaomi/MIUI、`В`=Samsung、`х`=Meizu、`А`=Huawei ⇒ 执行条件是"**非华为即执行**" | 【实证·产物】`probe_pt_44_brands.py` |
| **N5** | **`fc.у(Z)` 有 `if-eq` 幂等守卫**（`:221`），值未变则**不**调 `er.А()` 广播 ⇒ 冗余写入无副作用 | 【实证·产物】`fc.smali:213-240` |
| **N6** | **`b6.run()` 的执行顺序**：通用重置（`:400`）→ 刷 `w2`（`:409`）→ **最后**跑 `p71(6)`（`:419`）。即补丁在 `__agg` 刷新**之后**，且 `p71` 自己**又**调一次 `n91.y()` ⇒ `__agg` 刷新发生 **2 次** | 【实证·产物】`b6.smali:400-419` + `p71.smali:925` |
| **N7** | **恢复默认确认框标题是 `Restore Defaults`（`0x7f0805f5`），正文才是 `All options on this page…`（`0x7f0805f6`）**，且标题在 `n91.l` 内硬编码，正文由调用方传入 | 【实证·产物】`n91.smali:2085`/`:2098` |
| **N8** | **`n91` 共 51 个方法、4122 行**（不是 53 个 / 3096 行）；`<clinit>` 之外无 `xn0` 相关 | 【实证·产物】`probe_pt_16` |
| **N9** | **`la1` 没有任何实例字段**（无 `.field`）；7 个状态句柄全在 `vr`，`la1` 只持有基类 `n91` 的 `у`/`К`/`K` | 【实证·产物】`la1.smali:1-6` |
| **N10** | **`nr0.smali` 共 43 行**（不是 31 行）；`nr0.В = SDK_INT >= 0x21(33)` | 【实证·产物】`nr0.smali:1-43` |
| **N11** | **`smali_classes2/` 存在但不含本页任何类**（Lead 复核修订）：`smali/` 4397 个 `.smali`（含 `ׅ/` 的 3088 个），`smali_classes2/` 532 个但**只有 `j$/` 与 `java/`**（desugar 回填）。本页 10 个关键类全部在 `smali/ׅ/` | 【实证·产物】`probe_lead9_smali2.py` |
| **N12** | **`ls_app_settings` 的 `<intent>` 与 `n2` 的权限跳转是两个不同目的地**：前者带 `package:`（本应用详情页），后者不带（全局悬浮窗列表）。且后者的 `startActivity` 包在 `try/catchall` 中，异常仅 `Log.e` 不崩溃 | 【实证·原文】`lockscreen.xml:15`；【实证·产物】`n2.smali:213-249` |

### 6.4 差异条数汇总

| 类别 | 条数 |
| --- | ---: |
| ✅ 确认正确 | **12**（C1–C12） |
| ⚠️ 需要纠正 | **10**（M2–M11；M1 已撤销，原文档该项本就正确） |
| 🆕 新发现 | **12**（N1–N12） |
| **合计** | **34**（排除撤销的 M1） |

> **关于 M1 的撤销**：这类"分析简报自身口误被记成被审文档错误"的情况，在多层委派里很常见。
> 结论按**产物字节**定，不按简报定 —— 原文档 `U+05C5` 用法正确，本节如实撤销。

---

## 7. 未解问题（本次仍未能闭合）

| # | 问题 | 现状 |
| ---: | --- | --- |
| Q1 | 默认值双源是否有生成期校验 | 7/7 当前一致，未见构建期断言。**维护风险** |
| ~~Q2~~ | ~~`ls_force_timeout` / `direct_unlock` 的消费代码~~ | ✅ **已由 `poweramp-lockscreen-runtime.md` 解出**：两者均在 `LockScreenHelper`（`ׅ/h80`）内消费 |
| ~~Q3~~ | ~~自绘锁屏本体（渲染 `ls_enable` 的 Activity/Service）~~ | ✅ **已由 `poweramp-lockscreen-runtime.md` 解出**：不是独立 Activity/Service，而是 `MainActivity` 的窗口标志 + `Window.Callback` 包装 |
| Q4 | `I()` 中 `n2` 的 `setChecked(true)` 后用户放弃授权，开关与偏好值是否会失配 | 静态分析无法确定；需真机验证（§5.2 已标为推断） |
| Q5 | `xn0.О` 在 SDK 29+ 跳过 `canDrawOverlays`，是**有意放宽**还是**回归缺陷** | 代码与文案矛盾已证实（M9）；动机无法从产物判定 |
| Q6 | `ics_ls_aa` 的 "Not supported by some devices/ROMs" 具体指什么 | 文案自陈，未在代码找到 fallback 分支 |
| Q7 | `p71(6)` 在华为（`xn0.А`）上被跳过是否是"华为不需要该补丁" | 标志归属已明（N4），但"为何华为例外"无代码依据 |

---

## 8. 证据索引

| 主题 | 路径 : 行 |
| --- | --- |
| **XML 全文 15 元素** | `res/xml/lockscreen.xml:1-21` |
| 根节点 title/summary | `res/xml/lockscreen.xml:2` |
| 提示块（无 key） | `res/xml/lockscreen.xml:5` |
| `ics_ls_aa` / `ls_aa_blur` / `ls_default_aa` | `res/xml/lockscreen.xml:6` / `:7` / `:8` |
| `buttons` → `ui_mediaactions` | `res/xml/lockscreen.xml:9` |
| 分类二起始 | `res/xml/lockscreen.xml:11` |
| `ls_enable` / `ls_force_timeout` | `res/xml/lockscreen.xml:12` / `:13` |
| **内嵌 `<intent>`** | `res/xml/lockscreen.xml:14-16`（action/data `:15`） |
| `ls_enable_land` / `direct_unlock` | `res/xml/lockscreen.xml:17` / `:18` |
| `restore_defaults` | `res/xml/lockscreen.xml:20` |
| **页面标题/摘要** | `res/values/strings.xml:1190` / `:1531` |
| 分类名 | `res/values/strings.xml:1162`（Android Lock Screen）/ `:1316`（Poweramp Lock Screen） |
| 提示块文案 | `res/values/strings.xml:1460` |
| 7 个标题 | `1108`/`1201`/`1202`/`1109`/`1204`/`1264`/`1203`/`1076`（+`174` Buttons） |
| 9 个摘要 | `1490`/`1535`/`1536`/`840`/`1491`/`1538`/`1537`/`1480` |
| 4 段权限文案 | `1317`/`1318`/`1319` + 按钮 `1879`/`209` |
| 恢复默认文案 | `1366`/`1367` |
| 资源 id `0x7f16001d` | `res/values/public.xml:11076` |
| `cmd_player_reregister_media_session` | `res/values/public.xml:7440` |
| `bus_player_cmd` | `res/values/public.xml:6974` |
| `settings_quote_background` | `res/values/public.xml:3660`；定义 `res/drawable/settings_quote_background.xml:1-11`（描边色 `:7`） |
| `OK` 字符串 | `res/values/public.xml:4206` |
| **`vr` 7 字段声明** | `smali/ׅ/vr.smali:231`/`239`/`247`/`255`/`263`/`271`/`279` |
| **`vr` `<clinit>` 范围** | `smali/ׅ/vr.smali:375-3996` |
| `v2=1` / `v3=0` | `smali/ׅ/vr.smali:400` / `:435` |
| 7 处注册（key 字符串 / `sput`） | `1449→1461`、`1465→1477`、`1481→1493`、`1497→1509`、`1513→1525`、`1529→1541`、`1545→1576` |
| `с(String,Z)` 签名 | `smali/ׅ/ms.smali:2687` |
| `p0` 槽位断言 | `smali/ׅ/vr.smali:1572` → `:3878-3898` |
| **`la1` 头部** | `smali/ׅ/la1.smali:1-2` |
| **`la1.I()` 全文** | `smali/ׅ/la1.smali:7-288` |
| `I()` 判定点 | `:27`（newValue==false）/ `:31`（`О`）/ `:49` / `:53`/`:57`/`:61`（SDK<23）/ `:69`（canDrawOverlays）/ `:77` |
| `I()` **`return false`** | `smali/ׅ/la1.smali:210-213` |
| `I()` 单层告知框 | `smali/ׅ/la1.smali:216-278`（`n91.G` `:278`） |
| `I()` `return true` | `smali/ׅ/la1.smali:283-287` |
| 双层框标题/正文/按钮 | `smali/ׅ/la1.smali:44`（`:44`）/ `:112`+`:234`/`:257` / `:174`+`:184` |
| **`la1.v()` 全文** | `smali/ׅ/la1.smali:292-580` |
| `tc(7)` ×3 | `smali/ׅ/la1.smali:296-366`（key `:312`/`:333`/`:354`） |
| 屏幕门控删 `ls_enable_land` | `smali/ׅ/la1.smali:371-424` |
| `f81(3)` | `smali/ׅ/la1.smali:425-453`（`:445`/`:448`/`:453`） |
| 动态 two-part summary | `smali/ׅ/la1.smali:458-540`（`\n\n` `:505`，`setSummary` `:540`） |
| `x11(15)` | `smali/ׅ/la1.smali:545-574`（`:565`/`:569`/`:574`） |
| **`n2` 正按钮（idx 13）** | `smali/ׅ/n2.smali:182-256`（表 `:1515-1529`，`setChecked` `:208`，Intent `:222-231`，tag `:245`，`Log.e` `:249`） |
| **`f81` 表 / `pswitch_0`** | `smali/ׅ/f81.smali:471-475` / `:104-121` |
| **`tc` 表 / `pswitch_2`** | `smali/ׅ/tc.smali:899-909` / `:470-502` |
| **`x11` 表 / `pswitch_9`** | `smali/ׅ/x11.smali:849-874` / `:446-463` |
| **`p71` 表 / `pswitch_10`** | `smali/ׅ/p71.smali:1206` / `:878-931` |
| `p71` `v5=0` | `smali/ׅ/p71.smali:58` |
| **`fc.y()` / `fc.у(Z)`** | `smali/ׅ/fc.smali:144-158` / `:213-240`（幂等 `:221`，`er.А()` `:233`） |
| `pb1` / `t9` 类型链 | `smali/ׅ/pb1.smali:1-2` / `smali/ׅ/fc.smali:1-2` / `smali/ׅ/t9.smali:1-2` |
| `er.А()` 计数器自增 | `smali/ׅ/er.smali:129-146` |
| **`b6.run()` 顺序** | `smali/ׅ/b6.smali:400`（`n91.n`）/ `:409`（`w2.В`）/ `:419`（`p71`） |
| **`n91.n()` 七道筛选** | `smali/ׅ/n91.smali:714-884`（`isPersistent` `:742`，`getKey` `:802`，`t9.y()` `:850`） |
| `n91.G()` 单层框 | `smali/ׅ/n91.smali:1134-1188`（OK `:1161`） |
| `n91.m()` | `smali/ׅ/n91.smali:2190-2229` |
| `n91.l()` 确认框 | `smali/ׅ/n91.smali:2068-2188`（标题 `:2085`，正文 `:2098`，正 `:2145`，负 `:2158`） |
| **`n91.y()`（刷 `__agg`）** | `smali/ׅ/n91.smali:2941-2978`（`__agg` `:2957`，`w2` `:2969`，`w2.В` `:2973`） |
| `n91.v()` 抽象 / `n91.w()` 调用 | `smali/ׅ/n91.smali:2763` / `:2770` |
| `w2.В()` 异步刷新 | `smali/ׅ/w2.smali:55-81` |
| **`__agg` 服务身份** | `smali/com/maxmpz/app/base/BaseApplication.smali:1557`（字符串）→ `:1577`（索引 4）→ `:1689`（switch）→ `:1821`（`:pswitch_a`）→ `:1842`（`check-cast w2`） |
| **`xn0.О` 计算** | `smali/ׅ/xn0.smali:67-121`（`SDK_INT` `:67`，`0x1d` `:77`，`0x1c` `:85`，`ac.Х()` `:93`，`sput` `:121`） |
| `xn0.Х`/`В`/`х`/`А` 赋值 | `smali/ׅ/xn0.smali:976`/`:960`/`:972`/`:968` |
| OEM brand 判定 | `smali/ׅ/xn0.smali:200`(samsung)/`:407`(huawei)/`:442`(meizu)/`:496`(ro.miui.ui.version.name) |
| `xn0` 字段声明 | `smali/ׅ/xn0.smali:27`（`o`）/ `:43`（`О`）/ `:47`（`С`） |
| **`xn0.o`（平板）计算** | `smali/com/maxmpz/widget/app/BasePowerWidgetApplication.smali:628`/`:632`/`:646`/`:673`/`:700` |
| **`xn0.С`（大屏）计算** | `smali/com/maxmpz/widget/app/BasePowerWidgetApplication.smali:738`/`:742`/`:762` |
| **`nr0.В`（SDK≥33）** | `smali/ׅ/nr0.smali:15-38`（`0x21` `:19`） |
| `z61` SDK<33 删 `buttons` | `smali/ׅ/z61.smali:521`（字符串）/`:541`（`nr0.В`）/`:553`（`removePreference`） |
| **`la1` 分发起点** | `smali/ׅ/u61.smali:852`（`0x7f16001d`）/`:857`/`:861`（`new la1`）/`:865` |
| `RawTextPreference` 强制非持久 | `smali/com/maxmpz/audioplayer/preference/RawTextPreference.smali:174`/`:177` |
| `RedirectPreference` 继承 | `smali/com/maxmpz/audioplayer/preference/RedirectPreference.smali:2` |
| `buttons` 三处同名 | `lockscreen.xml:9` / `ui_notify.xml:7` / `misc.xml:10` |
| 前置文档 | `docs/architecture/poweramp-lockscreen-settings.md`（本文 §6 逐条对照） |
| 文档元数据规范 | `docs/decisions/2026-07-09-document-metadata-standard.md` |
| **分支总览（本文的上游索引）** | `docs/architecture/poweramp-lockscreen-branch-overview.md` |
| **子页面层（`ui_mediaactions`）** | `docs/architecture/poweramp-lockscreen-mediaactions-subpage.md` |
| **运行时层（`LockScreenHelper` / 窗口锁屏态）** | `docs/architecture/poweramp-lockscreen-runtime.md` |
