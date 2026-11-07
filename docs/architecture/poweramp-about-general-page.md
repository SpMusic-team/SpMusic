---
doc_id: "ARCH-POWERAMP-ABOUT-GENERAL-PAGE"
title: "Poweramp「设置 → 关于」根页（general）完整实现"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1035-bundle-play (versionCode 1035009)"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - "res/xml/general.xml"
  - "res/values/public.xml"
  - "res/values/strings.xml"
  - "res/values/attrs.xml"
  - "res/values/styles.xml"
  - "res/xml/singlepane.xml"
  - "res/xml/feature_packages.xml"
  - "res/xml/translations.xml"
  - "res/layout/poweramp_logo_pref.xml"
  - "res/layout/preference_progress_widget.xml"
  - "smali/ׅ/r91.smali"
  - "smali/ׅ/n91.smali"
  - "smali/ׅ/u61.smali"
  - "smali/ׅ/u9.smali"
  - "smali/ׅ/nn.smali"
  - "smali/ׅ/vr.smali"
  - "smali/ׅ/wr.smali"
  - "smali/ׅ/ms.smali"
  - "smali/ׅ/x11.smali"
  - "smali/ׅ/q91.smali"
  - "smali/ׅ/xn0.smali"
  - "smali/com/maxmpz/audioplayer/preference/{PowerampLogoPreference,FeaturePackRedirectPref,LicenseStatusPref,UberLevelPref,ProgressPreference,MultilineSwitchPreference,RedirectPreference,PrefBase}.smali"
  - "smali/com/maxmpz/preference/PrefSearchIndexer.smali"
  - "docs/architecture/poweramp-about-and-support-settings.md"
  - "docs/architecture/all-business-plugin-system.md"
  - "docs/architecture/plugin-host-design.md"
---

# Poweramp「设置 → 关于」根页（general）完整实现

## 0. 一句话结论

`general.xml` 是**声明 18 个元素、13 个 key，但运行期只保留 6 个可见 key** 的页面：`r91.v()` 用**两处无条件 `removePreference`** 删掉了整块 `updates`（3 个开关）与 `visit_site_about`，`addons` 空分类由**四路 Android 元数据协议**在运行期填充，`privacy` 的 URL 不在 XML 而在**主题属性**里。

本页与既有文档 `poweramp-about-and-support-settings.md` §3/§8/§9 的口径有 **3 处实质性修正**（见 §9），其中最关键的一条是：**`FeaturePackRedirectPref` 与 `LicenseStatusPref` 在 `general.xml` 里都没有 `w:removeAsNeeded`**，所以它们的"按授权自删"逻辑在本页**根本不会执行** —— 那套逻辑只在 `singlepane.xml` 生效。

---

## 1. 页面身份与规模

| 项 | 实测值 | 证据 |
| --- | --- | --- |
| XML 路径 | `res/xml/general.xml` | 【实证·原文】 |
| 体积 | **2563 字节 / 2538 字符 / 25 行**（文件以换行结尾） | 【实证·原文】(Python 实测 `len(raw)`/`splitlines()`) |
| 元素数 | **18** | 【实证·原文】18 个开标签（含 2 个 `<intent>`、3 个 `PreferenceCategory`、3 个 `PreferenceScreen`） |
| 资源 id | **`0x7f160014`** | 【实证·原文】`public.xml:11067` `<public type="xml" name="general" id="0x7f160014" />` |
| 根节点 | `<PreferenceScreen android:title="@string/pref_about">` | 【实证·原文】`general.xml:2` |
| 根节点 `summary` | **无** | 【实证·原文】`general.xml:2-3` 仅 `android:title` + 3 个 `xmlns` |
| 根节点 `w:ignoreTitle` | **无** | 【实证·原文】全文不含 `ignoreTitle` |
| 根节点 `w:skipSearch` | **无** | 【实证·原文】全文 5 处 `skipSearch` **全在子元素上**（§6） |
| 页面标题 | `@string/pref_about` = **"About"** | 【实证·原文】`strings.xml:1007` |
| helper | `smali/ׅ/r91.smali`，**32207 字节 / 1458 行**，`.super Lׅ/n91;` | 【实证·产物】`r91.smali:1-2` |
| SharedPreferences 名 | **`"global"`** | 【实证·产物】`u61.smali:107,111` |
| 分发表入口 | `smali/ׅ/u61.smali:433` 附近 | 【实证·产物】见下 |
| `restore_defaults` | **无** | 【实证·原文】 |

### 1.1 分发表入口（准确行号）

`u61.onCreate()` 用 `android:key` 之外的另一条路径——**XML 资源 id 直连**——把页面 id 映射到 helper 实例：

| 行号 | 内容 |
| --- | --- |
| `u61.smali:434` | `const v9, 0x7f160014` ← 本页 id |
| `u61.smali:439` | `if-ne v3, v9, :cond_6` ← 命中判定 |
| `u61.smali:443` | `new-instance v0, Lׅ/r91;` ← 构造 helper |
| `u61.smali:447` | `invoke-direct {v0, v1, p0, v3, v4}, Lׅ/n91;-><init>(...)` ← 走的是 **`n91` 的构造器**（`r91` 无自有构造器） |

相邻对照：`u61.smali:456` 的 `0x7f160002` → `already_purchased` → `ׅ/z61`，说明这是一张**平铺的 `if-else` 资源 id 链**，不是查表。

### 1.2 构造期调用顺序（决定 `v()` 何时跑）

`r91` 无构造器，全部初始化在 `n91.<init>` 内完成，顺序固定：

| 顺序 | 行号 | 动作 |
| ---: | --- | --- |
| ① | `n91.smali:476` | `z()` —— 设置页面标题 |
| ② | `n91.smali:481` | `Х()` —— 虚方法，`r91` 覆写 |
| ③ | （稍后，由框架驱动） | `n91.w()` → `n91.v()` |

关键链条【实证·产物】：

```
u61.smali:1736   invoke-virtual {v7}, Lׅ/n91;->w()V      ← 页面切换后驱动
n91.smali:2770   invoke-virtual {p0}, Lׅ/n91;->v()V      ← w() 内首行就是 v()
n91.smali:2763   .method public abstract v()V            ← v() 是抽象模板方法
```

所以 **`v()` 不是构造期执行的，而是每次 `w()`（页面进入/切换）时执行**——这也解释了 `r91.onBusMsg` 为什么能用一条消息重刷整页（`r91.smali:189` → `n91.у()` → `n91.smali:3545` → `w()` → `v()`）。

### 1.3 在设置树中的位置（入口与出边）

本页是**次级页**，入口在设置根页 `singlepane.xml`：

| 层 | 位置 | 内容 |
| --- | --- | --- |
| 入口声明 | `res/xml/singlepane.xml:23` | `RedirectPreference`，`key="general"`、`summary=@string/pref_summary_about`、`w:target="general"`、`w:applyIconTint="false"` |
| 入口标题 | `strings.xml:1007` | `pref_about` = "About" |
| 入口摘要 | `strings.xml:1456` | `pref_summary_about` = "Version/changelog, translations info" |
| 图标属性声明 | `res/values/attrs.xml:961` | `<attr name="settings_general" format="reference" />` |
| 图标主题赋值 | `res/values/styles.xml:10645` | `<item name="settings_general">@drawable/settings_general_colored</item>` |

`w:applyIconTint="false"` 的理由：`_colored` 资源已自带 tint，再套主题 tint 会二次染色。

**出边只有 2 条，且都是叶子页**：

```
singlepane
  └─ general (0x7f160014)
       ├─> feature_packages (0x7f160013)   ← w:target，叶
       └─> translations    (0x7f160029)   ← w:target，叶
```

> **范围界定**：`support`（技术支持 → `xa1`）与 `commands_history`（→ `o91`）**不在 `general` 子树内**，它们是 `singlepane`「其他」分类的独立入口（`singlepane.xml:27` 等）。本文只在 §8 列出口，不展开其内部——那是另一篇文档的范围。

---

## 2. 18 个元素逐条实证

按 XML 实际出现顺序。`np` = `persistent="false"`；`ss` = `w:skipSearch`；**本页 `defaultValue` 全局为零**（`general.xml` 全文无该属性）。

| # | 行 | key | 控件类全名 | 标题实文 | 摘要实文 | defaultValue | persistent | dependency | `w:*` 属性 |
| ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 4 | *（无）* | `com.maxmpz.audioplayer.preference.PowerampLogoPreference` | *（无 title）* | *（无 summary）* | — | 默认 | — | **无任何属性** |
| 2 | 5 | `feature_packages` | `…preference.FeaturePackRedirectPref` | **Feature Packages** | **Explore Poweramp Feature Packages** | — | 默认 | — | `android:icon="?settings_pak"`、`w:target="feature_packages"` |
| 3 | 6 | *（无；运行期 `setKey("license_status")`）* | `…preference.LicenseStatusPref` | *（无 title）* | 运行期生成 | — | 默认 | — | `w:skipSearch="true"` |
| 4 | 7 | `about_version` | `android.preference.Preference`（框架类） | **Version/Changelog** | 运行期生成（§3.3） | — | 默认 | — | **无** |
| 5 | 8 | `uber_level` | `…preference.UberLevelPref` | *（无 title）* | 运行期生成 | — | 默认 | — | `android:clickable="true"` |
| 6 | 9 | `updates` | `android.preference.PreferenceCategory` | **Update** | — | — | — | — | 运行期整块移除 |
| 6a | 10 | `check_updates` | `…preference.MultilineSwitchPreference` | **Check For Updates** | **Check for updates once a week on startup** | — | 默认 **true** | — | `w:skipSearch="true"` |
| 6b | 11 | `check_beta_updates` | `…preference.MultilineSwitchPreference` | **Check For Beta Versions** | *（无）* | — | 默认 **true** | **`check_updates`** | `w:skipSearch="true"` |
| 6c | 12 | `check_update` | `…preference.ProgressPreference` | **Check Now** | *（无）* | — | **np = true** | — | 无 |
| 7 | 14 | `other` | `android.preference.PreferenceCategory` | **Other** | — | — | — | — | — |
| 7a | 15 | `visit_site_about` | `android.preference.PreferenceScreen`（内嵌 `<intent>`） | **Visit Website** | *（无）* | — | — | — | **`w:skipSearch="play,huawei"`** |
| 7a-i | 16 | — | `<intent>` | — | — | — | — | — | `android:action="android.intent.action.VIEW"`、`android:data="http://powerampapp.com/"` |
| 7b | 18 | `translations` | `…preference.RedirectPreference` | **Translations** | *（无）* | — | 默认 | — | `w:target="translations"` |
| 7c | 19 | `oss` | `android.preference.Preference`（内嵌 `<intent>`） | **Open Source Licenses** | *（无）* | — | 默认 | — | — |
| 7c-i | 20 | — | `<intent>` | — | — | — | — | — | `android:targetPackage="@string/edition_pak_name"`、`android:targetClass="com.maxmpz.audioplayer.preference.SettingsLicenseActivity"` |
| 7d | 22 | `privacy` | `android.preference.PreferenceScreen`（**无 `<intent>`**） | **Privacy Policy** | *（无）* | — | — | — | **`w:skipSearch="true"`** |
| 8 | 24 | `addons` | `android.preference.PreferenceCategory` | **Addons** | — | — | — | — | **空分类，运行期填充** |

### 2.1 全部 `@string` 英文实文与行号

| 引用名 | 英文实文 | `strings.xml` 行 | `public.xml` 行 / id |
| --- | --- | ---: | --- |
| `pref_about` | `About` | **1007** | 5191 / `0x7f080487` |
| `feature_packages` | `Feature Packages` | **442** | 4637 / `0x7f080209` |
| `summary_feature_packages` | `Explore Poweramp Feature Packages` | **2035** | 6188 / `0x7f0808b4` |
| `pref_version` | `Version/Changelog` | **1693** | 5853 / `0x7f08074a` |
| `pref_update` | `Update` | **1685** | 5845 / `0x7f080741` |
| `pref_check_updates` | `Check For Updates` | **1060** | 5238 / `0x7f0804bd` |
| `pref_summary_check_updates` | `Check for updates once a week on startup` | **1475** | 5637 / `0x7f080669` |
| `pref_check_beta_updates` | `Check For Beta Versions` | **1057** | 5235 / `0x7f0804ba` |
| `pref_check_udpate_now` | `Check Now` | **1059** | 5237 / `0x7f0804bc` |
| `pref_other` | `Other` | **1268** | 5444 / `0x7f080595` |
| `pref_visit_site` | `Visit Website` | **1719** | 5877 / `0x7f080763` |
| `pref_translations` | `Translations` | **1682** | 5842 / `0x7f08073e` |
| `pref_open_source_licenses` | `Open Source Licenses` | **1265** | 5441 / `0x7f080592` |
| `pref_privacy_policy` | `Privacy Policy` | **1332** | 5497 / `0x7f0805d2` |
| `pref_addons` | `Addons` | **1011** | 5195 / `0x7f08048f` |
| `edition_pak_name` | **`com.maxmpz.audioplayer`** | **391** | 4592 / `0x7f0801d6` |

> `pref_check_udpate_now` 的拼写错误（`udpate`）在资源名里**真实存在**，不是本文笔误【实证·原文】`strings.xml:1059`。

### 2.2 主题属性 `?settings_pak`

| 项 | 值 | 证据 |
| --- | --- | --- |
| 属性声明 | `<attr name="settings_pak" format="reference" />` | 【实证·原文】`attrs.xml:2929` |
| attr id | `0x7f010c53` | 【实证·原文】`public.xml:2504` |
| 主题赋值 | `@drawable/settings_pak_colored` | 【实证·原文】`styles.xml:10688` |

本页只引用 `?settings_pak` 一次（元素 #2）。注意 `general.xml:5` **没有** `w:applyIconTint="false"`，而 `singlepane.xml:12` 的同一个控件**有**——同一控件两处声明的属性集不同（§9.1 第 2 条）。

---

## 3. `vr.smali` 里的状态字段注册

### 3.1 结论：本页 13 个 key 里**只有 2 个**进了 `vr`

`vr.smali` 体积 **79932 字节 / 4044 行**，`.super Lׅ/ms;`，唯一方法 `<clinit>` 占 `375-3996`（**3622 行**）。逐 key 全树检索结果：

| key | 是否在 `vr.<clinit>` | 说明 |
| --- | --- | --- |
| `check_updates` | ✅ **是** | 见 §3.2 |
| `check_beta_updates` | ✅ **是** | 见 §3.2 |
| `about_version` | ❌ 否 | 全树唯一出现：`r91.smali:212`（仅 `findPreference`） |
| `uber_level` | ❌ 否 | 全树**零**出现（连 `findPreference` 都没有） |
| `privacy` | ❌ 否 | 全树零出现 |
| `visit_site_about` | ❌ 否 | 全树零出现 |
| `feature_packages` | ❌ 否 | 全树零出现（`w:target` 由基类消费，见 §8） |
| `translations` | ❌ 否 | 同上 |
| `oss` | ❌ 否 | 全树零出现 |
| `addons` | ❌ 否 | 全树零出现 |
| `license_status` | ❌ 否 | 运行期 `setKey` 生成（`LicenseStatusPref.smali:109`），底层的 `j` 字段是 `w:removeAsNeeded`，非偏好值 |
| `check_update` | ❌ 否 | **全树零出现**（详见 §5.5） |

> **口语化总结**：本页除两个"检查更新"开关外，**没有任何一项是持久化用户设置**。`about_version`/`uber_level`/`license_status` 是**只读展示**，`privacy`/`oss`/`visit_site_about`/`feature_packages`/`translations` 是**跳转**，`addons` 是**只读发现列表**。

### 3.2 两处注册的精确行号与默认值

```
vr.smali:2523   const-string v4, "check_updates"
vr.smali:2527   invoke-virtual {v0, v4, v3}, Lׅ/ms;->с(Ljava/lang/String;Z)Lׅ/pb1;
vr.smali:2532   const-string v4, "check_beta_updates"
vr.smali:2536   invoke-virtual {v0, v4, v3}, Lׅ/ms;->с(Ljava/lang/String;Z)Lׅ/pb1;
```

| 项 | 值 | 证据 |
| --- | --- | --- |
| 默认值寄存器 `v3` | **`0x0` = `false`** | 【实证·产物】`vr.smali:435` 的 `const/4 v3, 0x0` 是 `<clinit>` 内**唯一**一次写 `v3`，到 2527 时未被改写 |
| 返回类型 | `Lׅ/pb1;`（布尔偏好包装） | 【实证·产物】`vr.smali:2527,2536` |
| 注册方法 | `ms.с(String, Z) → pb1` | 【实证·产物】`ms.smali:2687` 方法签名；`ms.smali:2703` `new pb1(key, er, ls, def)`；`ms.smali:2712` `ArrayList.add` |

**两处返回值被丢弃（这是本页最容易被误读的一点）**：

`vr.smali:2527` 与 `2536` 之后**紧跟** `.line 1074-1081` 与 `invoke-virtual {v0}, Lׅ/ms;->Р()`,**没有 `move-result-object`，也没有 `sput-object`**。对比同文件 2500-2519 的正常写法：

```
vr.smali:2500   move-result-object v4
vr.smali:2503   sput-object v4, Lׅ/vr;->t1:Lׅ/rb1;     ← 正常：存进字段
vr.smali:2527   invoke-virtual ... ->с("check_updates", v3)
vr.smali:2532   const-string v4, "check_beta_updates"  ← 直接覆盖 v4，返回值丢弃
```

> **推论（重要）**：这两个 key **只被注册进 `ms` 的偏好列表并落到 `global` SharedPreferences，`vr` 里没有对应的 public static 字段**。全树也**没有任何代码**按字面量 `"check_updates"` 去读它们（除注册点外零命中）。
>
> 也就是说：**这两个开关目前是"可持久化但无人消费"的状态**。它们的值会被 `PreferenceManager` 写入/读取 `global`（元素是默认 `persistent=true`），但 App 侧没有读取方。真正驱动更新检查的是消息 `msg_app_version_check`（`0x7f0d03e4`，`public.xml:7918`），见 §4.6。

### 3.3 `move_fp1_to_about` 与 `vr` **无关**（对 Lead 提示的核对）

Lead 提供的骨架事实里把 `move_fp1_to_about` 列为本页持久化项之一。实测**它不在 `vr`，也不在本页**：

| 项 | 实测 | 证据 |
| --- | --- | --- |
| 声明位置 | **`vr`**：全树零命中 | 【实证·产物】`vr.smali` 4044 行无该字面量 |
| 实际注册处 | **`wr.<clinit>`** | 【实证·产物】`wr.smali:1753` 字面量、`:1757` `ms.с(...)`、`:1765` `sput-object v1, Lׅ/wr;->x0:Lׅ/pb1;` |
| 实际归属页 | **`feature_packages.xml:12`**（不是 `general.xml`） | 【实证·原文】`key="move_fp1_to_about"`、`defaultValue="false"`、`summary=@string/hide_fp_in_settings` |
| 消费点 | `p91.Q()`（`feature_packages` 页 helper） | 【实证·产物】`p91.smali:11` `findPreference("move_fp1_to_about")`、`:39` `setOnPreferenceChangeListener` |

> 因此本页持久化 key **严格只有 2 个**：`check_updates`、`check_beta_updates`。`move_fp1_to_about` 属于**子页** `feature_packages`，是"是否把 Feature Packages 入口隐藏"的开关（`strings.xml:569` "Hide Feature Packages from the Settings top"），与本页是**跨页联动**关系而非本页状态（§8.1）。

### 3.4 本页为什么**没有** `restore_defaults`

「关于」分支（`general` / `feature_packages` / `translations` / `support` / `commands_history`）**全部缺席** `restore_defaults`，而锁屏/耳机/媒体库等页都有。

判断依据【实证·产物 + 推断】：

1. **本分支的持久化项只有 2 个，且都是"开关"不是"调优参数"**——`restore_defaults` 的设计目的是把用户调过的**数值型**参数（`fade_*_ms`、`gapless_preload_ms`、`volume_levels` 等，见 `vr.smali:490-701` 一整片）恢复出厂；本页没有任何这类参数。
2. **本页绝大多数条目不是设置，而是只读展示或跳转**（§3.1 表），对它们"恢复默认"在语义上不成立。
3. **`vr` 里两个 key 的默认值都是 `false`**，且没有 UI 可达（`updates` 整块被删，§4.2），用户根本无法把它们改成非默认值——**无"可恢复的偏离"**。

---

## 4. `r91.smali` 完整解析（本文核心）

### 4.1 类声明、字段表、方法全表

**类声明**（`r91.smali:1-3`）：`.class public final Lׅ/r91;` / `.super Lׅ/n91;` / `.source "_"`

**字段表：`r91` 自身 0 个字段**【实证·产物】1458 行内 `.field` 计数为 **0**。全部状态来自父类 `n91`（`n91.smali:12-64`，共 **27** 个 `.field`），本类只消费其中 3 个：

| 字段 | 类型 | 含义 | 本类用到的行 |
| --- | --- | --- | --- |
| `n91.К` | `SettingsActivity` | 设置 Activity | `r91:208, 442, 593, 613, 631` |
| `n91.у` | `SettingsActivity` | 同上（另一别名） | `r91:26, 373, 504, 651` |
| `n91.K` | `PreferenceScreen` | 根 PreferenceScreen | `r91:208, 442, 593, 631` |

**方法全表（5 个，不是 3 个）**：

| # | 方法 | 行范围 | 行数 | 性质 |
| ---: | --- | --- | ---: | --- |
| 1 | `I(PreferenceCategory, PackageManager, String)V` | **7-161** | 155 | 私有工具：动态 addon 行构造器 |
| 2 | `onBusMsg(MsgBus, int, int, Object)V` | **163-202** | 40 | 覆写：消息总线（2 条消息） |
| 3 | `v()V` | **204-1406** | **1203** | 覆写抽象 `n91.v()`：本页装配主体 |
| 4 | `z()V` | **1408-1423** | 16 | 覆写：页面标题 |
| 5 | `Х()V` | **1425-1458** | 34 | 覆写：应用级动作 |

> **与既有文档的差异**：既有文档 §3.8 只列了 3 个非 `v()` 方法（`z` / `Х` / `onBusMsg`），**漏掉了 `I()`**（虽然它在 §3.4.2 被单独描述）。本文按 `.method` 全量列举为 **5 个**。

### 4.2 `v()` 的逐段装配

`v()`【实证·产物】`r91.smali:204-1406`，`.locals 13`，占全类 **82.5%**（1203/1458）。

既有资料称"9 段"，实测**这 9 段的分界是准确的**，但第 ④ 段内部应拆为"`updates` 移除"与"`addons` 准备"两步，且段 ⑥⑦⑧ 的计数器落地位置需要单独标出。以下为核实后的分段：

| 段 | 行号 | 做什么 | 关键行 |
| ---: | --- | --- | --- |
| ① | **212-437** | `about_version`：取控件 → 拼版本串 → `setSummary` → 挂 `x11(0xa)` 点击 | `212` `findPreference`、`228` 硬编码 build 串、`423` `setSummary`、`432` `x11` |
| ② | **442-483** | `other` cast 成 `PreferenceCategory`；`visit_site_about` **无条件移除** | `446` `"other"`、`462` `"visit_site_about"`、`478` `removePreference` |
| ③ | **484-591** | `privacy`：主题属性 `0x7f0108f6` → `ACTION_VIEW` Intent → `setIntent` | `484` `"privacy"`、`516` resolveAttribute、`587` `setIntent` |
| ④a | **593-622** | `updates` **无条件整块移除** | `597` `"updates"`、`617` `removePreference` |
| ④b | **623-650** | 准备日志标签 + 取 `addons` 分类 + 取 `PackageManager` + 计数器 `v6=0` | `635` `"addons"`、`647` cast、`663` `v6=0` |
| ⑤ | **651-824** | addon ①：`getPackageInfo("com.maxmpz.audioplayer.unlock")`，**内联**构造（不走 `I()`） | `667` 包名、`795` `new q91(...,0)`、`809` `addPreference`；**失败在此置 `v3=0`**（`:821`） |
| ⑥ | **825-991** | addon ②：`queryIntentContentProviders(DOCUMENTS_PROVIDER)` + 元数据 `com.maxmpz.PowerampTrackProvider` → `I()`；累加 `v3 += v9` | `842` action、`923` 元数据键、`943` `I()`、`950` 计数、`989` `add-int/2addr v3, v9` |
| ⑦ | **992-1269** | addon ③：两个广播 action 查 `queryBroadcastReceivers` → `HashMap` 去重 → `Arrays.sort` → 逐个 `I()`；累加 `v3 += v11` | `1014`/`1104` 两个 action、`1001` HashMap、`1212` `Arrays.sort`、`1238` `I()`、`1267` `add-int/2addr v3, v11` |
| ⑧ | **1270-1374** | addon ④：`getInstalledApplications(0x80)` + 元数据 `com.maxmpz.PowerampVisPresets` → `I()`；累加 `v3 += v6` | `1279` getInstalledApplications、`1329` 元数据键、`1349` `I()`、`1356` `v6++`、`1373` `add-int/2addr v3, v6` |
| ⑨ | **1376-1406** | `if (v3 == 0)` → 加一条 `title=@string/none` 的裸 `Preference` 兜底 | `1376` `if-nez v3`、`1389` `0x7f0803c8`、`1399` `addPreference` |

> **计数器 `v3` 的生命周期**（易错点）：`v3` 在 `:241` 被置 `0x1`（此时是 **locale 常量**用途），随后 `:821` 才被置 `0x0` 作为 addon 计数器。`:821` 位于 addon ① 的 `try`/`catch_1` 汇合处——**只要 ① 抛异常或 `pi == null`，`v3` 就被重置为 0**，但 ②③④ 的累加仍在 `:989/:1267/:1373` 发生，所以 ① 成功与否会**整体影响**兜底判定。这是 `v3` 一值多用的第二处（第一处是 `0xa` 兼作换行符与 `x11` index，见 §4.3）。

### 4.3 `about_version` 的版本串组装（本页最长单段逻辑）

范围【实证·产物】`r91.smali:212-437`（226 行）。产物是一个 `StringBuilder`，**5 个片段 + 3 个分隔符**：

| 序 | 行号 | 片段 | 类型 | 说明 |
| ---: | --- | --- | --- | --- |
| — | `224` | `new StringBuilder` | — | — |
| 1 | **`228`** | **`"build-1035-bundle-play"`** | 字面量 | **构建变体标识硬编码进 smali**，是全 App 唯一带 `bundle-` 的构建串（另见 `Application.smali:52` 的 `"Poweramp edition: bundle-play"`） |
| 2 | **`237`** | `v2 = 0xa` = `'\n'` | 分隔符 | 字符常量 |
| 3 | `255`→`259`→`267` | `"vd"` → `Sync.B("vd")` → `Sync.В(1, null)` | 调用 | 在 `synchronized (Sync.class)`（`249`/`298`）内做 **native 许可证握手的前半** |
| 4 | **`272`** | `append(C)` 用 `v2`=`'\n'` | 分隔符 | — |
| 5 | **`280`** | `Sync.native_lock(-1)` 返回串 | 动态 | **native 方法**，返回许可证/设备指纹相关字符串 |
| 6 | `288` | `append(String)` | 拼接 | — |
| 7 | **`293`** | `Sync.native_close(1)` | 调用 | 释放 native 句柄 |
| 8 | **`322`** | `append(C)` 用 `v2`=`'\n'` | 分隔符 | — |
| 9 | **`327`** | `xn0.B()` → `boolean` | 动态 | 见下 |
| 10 | `339` | `"64"`（`if-eqz` 真分支） | 字面量 | — |
| 11 | `354` | `"32"`（`else` 分支） | 字面量 | — |
| 12 | **`364`** | `v4 = 0x20` = `' '` | 分隔符 | **空格**（不是换行） |
| 13 | **`377`** | `getString(0x7f0800b8)` | 资源 | `@string/bit` = **"bit"**（`strings.xml:151`） |
| 14 | **`415`** | `toString()` | — | — |
| 15 | **`423`** | `setSummary(...)` | 落地 | — |

**`xn0.B()` 的语义**（决定 "64"/"32"）【实证·产物】`xn0.smali:1379-1469`：

```java
SDK_INT >= 0x17 (23)  →  return Process.is64Bit();                    // :1383-1403
else                   →  SUPPORTED_64_BIT_ABIS 非空
                         && CPU_ABI == SUPPORTED_64_BIT_ABIS[0]
                         && CPU_ABI == "arm64-v8a"                    // :1407-1468
```

所以第 9 段输出的字面量是 **ABI 位宽判定**，最终串形如：

```
build-1035-bundle-play\n<native_lock 返回串>\n64 bit
```

> **两处 `0xa` 的巧合**：`v2 = 0xa` 既被当作 `'\n'` 字符常量（`272`、`322` 的 `append(C)`），又在 `432` 被当作 `x11` 的 **index** 传入 `new-instance Lׅ/x11; ... <init>(I, Object)`。两者**数值相同、语义无关**——`0x0a` 恰好既是换行符 ASCII 也是该 `pswitch` 分支号。读代码时极易误判为"用换行符当索引"。

**异常处理**：整段包在 `try`/`catch Exception`（`251`）与 `finally` 风格 `catchall` 中，任何异常走 `:401` `Log.e("SettingsHelperGeneral", "", e)`，随后**仍继续** `setSummary`（`415-423` 在 `:goto_3` 之后），即**异常时摘要为部分拼接结果而非崩溃**。

**点击行为**：`432` 挂 `x11`，index `0xa` → 运行期定位到 `:pswitch_e`：

```
x11.smali:550   :pswitch_e
x11.smali:568   const-class v1, Lcom/maxmpz/audioplayer/dialogs/ChangelogActivity;
x11.smali:577   invoke-virtual {v0, p1}, ...SettingsActivity;->startActivity(...)
```

映射依据【实证·产物】`x11.smali:849` `.packed-switch 0x0` 起，索引 `0xa` 对应 `x11.smali:860` 的 `:pswitch_e`（`849+0xa = 860`）。

> 即 **`about_version` 点击 = 打开 `ChangelogActivity`**，与标题 "Version/Changelog" 一致。

### 4.4 `privacy` 的 intent 运行期绑定

XML 里 `privacy` 是**既无 `<intent>` 也无 `w:target` 的自闭合 `PreferenceScreen`**（`general.xml:22`）。URL 来自**主题属性**，运行期注入【实证·产物】`r91.smali:484-591`：

| 行 | 动作 |
| ---: | --- |
| `484` | `findPreference("privacy")` |
| `496` | `if-eqz v0, :cond_3`（找不到则跳过） |
| `500` | `sget-object v1, Lׅ/ze1;->А:Landroid/util/TypedValue;` ← **复用全局静态 TypedValue** |
| `516` | `const v4, 0x7f0108f6` ← `pref_privacy_policy` |
| `521` | `theme.resolveAttribute(0x7f0108f6, v1, true)` |
| `529` | `if-eqz v2, :cond_3`（属性解析失败则跳过） |
| `537` | `new Intent("android.intent.action.VIEW")` |
| `546`-`568` | `tv.string` 为 null 则用 `""`，再 `toString()` |
| `571` | `Uri.parse(s)` |
| `587` | `p.setIntent(i)` |

主题侧取值【实证·原文】：

| 主题 | `pref_privacy_policy` | `styles.xml` 行 |
| --- | --- | ---: |
| `Overlap_ActivityTheme_Base` | **`https://www.iubenda.com/privacy-policy/8016901/full-legal`** | **10692** |
| `Overlap_ActivityTheme_PeqBase` | `https://www.iubenda.com/privacy-policy/32990222/full-legal` | 10702 |

同处还定义了 `pref_privacy_policy_non_play`（`styles.xml:10693` = `…/71177063`，`:10703` = `…/32990222/full-legal`），但 `r91` **只读 `pref_privacy_policy`（`0x7f0108f6`），从不读 non_play 变体**——这是本页"有条件数据但代码不分条件"的又一例。

> **设计要点**：这是本页唯一"用主题属性当数据源"的地方——同一份偏好 XML 在不同主题下可指向不同 URL，XML 本身零改动。代价是**静态分析无法从 XML 得知 URL**（本文的 URL 来自 `styles.xml`，非 `general.xml`）。
>
> **`ze1.А` 是可变全局**：`r91` 直接复用 `ze1` 的静态 `TypedValue` 而不 `new`，意味着短暂活引用会跨调用共享——属于刻意省一次分配（`TypedValue` 每次 `resolveAttribute` 前会被覆写）。

### 4.5 `addons` 分类的四路运行期发现

`addons` 在 XML 中是**完全空的 `PreferenceCategory`**（`general.xml:24`，自闭合，只有 `title` + `key`）。四段独立 `try/catch` 依次填充，**互不影响**（各自 catch 只 `Log.e`）：

| # | 行号 | 发现手段 | 匹配条件 | 命中后 |
| ---: | --- | --- | --- | --- |
| ① | **651-824** | `pm.getPackageInfo("com.maxmpz.audioplayer.unlock", 0)` | 包存在（`:679` `if-eqz v7`） | **内联构造**（不走 `I()`）：icon（`SDK>=0x16` 用 `loadUnbadgedIcon`，否则 `loadIcon`）→ 包 `dt` 包装 → `loadLabel` 作 title → `setSingleLineTitle(false)`（`SDK>=0x1a`）→ `versionName` 作 summary → `q91(this,pm,pi,0)`（注意 **index 传 `v6`=`0x0`**，而 `I()` 传 `0x1`） |
| ② | **825-991** | `pm.queryIntentContentProviders(Intent("android.content.action.DOCUMENTS_PROVIDER"), 0x80)`（`:842`/`:851`） | `providerInfo.metaData.getBoolean("com.maxmpz.PowerampTrackProvider")`（`:923`/`:927`） | `I(cat, pm, providerInfo.packageName)`（`:943`） |
| ③ | **992-1269** | **两次** `pm.queryBroadcastReceivers`：`"com.maxmpz.audioplayer.TRACK_CHANGED_EXPLICIT"`（`:1014`）+ `"com.maxmpz.audioplayer.TRACK_CHANGED"`（`:1104`） | 任一命中即收 `activityInfo.packageName` 进 `HashMap<pkg,pkg>`（`:1081`/`:1171`，**天然去重**） | `values().toArray()` → **`Arrays.sort`（`:1212`，按包名字典序）** → 逐个 `I()`（`:1238`） |
| ④ | **1270-1374** | `pm.getInstalledApplications(0x80)`（`:1279`） | `applicationInfo.metaData.containsKey("com.maxmpz.PowerampVisPresets")`（`:1329`/`:1333`） | `I(cat, pm, applicationInfo.packageName)`（`:1349`） |

**计数器**：`v6`（① 之外另用）与 `v3` 的累加关系见 §4.2 注。四路计数汇总在 `:989`（`v3 += v9`，②）、`:1267`（`v3 += v11`，③）、`:1373`（`v3 += v6`，④）；① 不计入独立变量而是**决定 `v3` 初值**（`:821`）。

**兜底**：`:1376` `if-nez v3, :cond_13` → `:1380` `new Preference(ctx)` → `:1389` `const v1, 0x7f0803c8`（`@string/none` = **"None"**，`strings.xml:832`）→ `:1394` `setTitle(int)` → `:1399` `addPreference`。这条兜底**没有任何 icon/summary/点击监听**，是纯文本占位。

`I()` 的完整职责【实证·产物】`r91.smali:7-161`：

| 行 | 动作 |
| ---: | --- |
| `14` | `getPackageInfo(pkg, 0)` |
| `22`-`30` | `new Preference(settingsActivity)` |
| `35`-`43` | `SDK_INT >= 0x16` ? 走 `loadUnbadgedIcon` |
| `62`-`76` | 否则 `loadIcon`（走 `PackageItemInfo` 签名） |
| `80`-`89` | `d != null` 时包一层 `Lׅ/dt;` |
| `93` | `setIcon` |
| `102`-`110` | `loadLabel` → `setTitle` |
| `115`-`123` | `SDK_INT >= 0x1a` → `setSingleLineTitle(false)` |
| `129`-`133` | **`versionName` → `setSummary`** |
| `138`-`150` | `setOnPreferenceClickListener(new q91(this, pm, pi, 1))` |
| `155` | `addPreference` |

> **摘要恒为 `versionName`**：所有 addon 行的副标题都是插件版本号，不区分用途。
>
> **`q91` 的两个 `pswitch` 分支代码完全相同**【实证·产物】`q91.smali:50-207`：`getLaunchIntentForPackage(pkg)`（`:89`）→ `startActivity`（`:97`），失败仅 `Log.e("SettingsHelperGeneral","",e)`（`:119`），**不弹提示**。`q91` 的 index 字段 `В`（`:24`）只用于分支选择，两分支行为一致——index `0`（① 用）与 `1`（`I()` 用）**语义无差别**，是死代码。

### 4.6 `r91` 除 `v()` 外的其他方法（4 个）

| 方法 | 行范围 | 职责 | 关键证据 |
| --- | --- | --- | --- |
| `I(cat, pm, pkg)` | **7-161** | 动态 addon 行统一构造器（§4.5） | `:14` 起 |
| `onBusMsg(bus, what, arg1, obj)` | **163-202** | 监听 2 条消息：`0x7f0d03e4`（`msg_app_version_check`）→ **无动作，直落 `super`**；`0x7f0d0530`（`cmd_app_feature_pak_settings_refresh`）→ `n91.у()` **整页刷新** | `:167`/`:180` 两个 id；`:189` 调 `у()`；`:196` `invoke-super` |
| `z()` | **1408-1423** | 覆写页面标题：`t(0x7f080487)` = `pref_about` | `:1412` id、`:1417` `n91;->t(I)V` |
| `Х()` | **1425-1458** | `((BaseApplication) AUtils.c(activity, BaseApplication.class)).P(false)` | `:1449` `const/4 v1, 0x0`、`:1452` `BaseApplication;->P(Z)V` |

**两处关键细节**：

1. **`z()` 是完全冗余的覆写**。基类 `n91.z()`（`n91.smali:2981-3008`）已做 `getTitleRes()` → `t(resId)`，而根节点 `android:title="@string/pref_about"` 的 `getTitleRes()` 恰好就是 `0x7f080487`。`r91.z()` 把同一 id 写死，**运行结果与基类逐字相同**。这解释了为什么根节点"没有 `w:ignoreTitle`"却仍显示正确标题——覆写在起作用，且**不依赖** XML 的 title 解析。

2. **`Х()` 传 `false` 而基类传 `true`**（`n91` 的 `Х()` 实现见 `BaseApplication.P(Z)` 调用点）。`P(Z)` 的内部分支（`BaseApplication.smali:482-532` → `o4` Runnable，index `1` vs `2`）本文不展开——属应用级启动路径，非本页范围。

3. **`onBusMsg` 对 `msg_app_version_check` 什么都不做**（`:172` `if-ne p2, v0, :cond_0` → `goto :goto_0` → 直接 `super`）。看似"漏处理"，实则**正确**：`updates` 分类已被 `v()` 整块删除（§4.2 ④a），本页**没有 UI 可更新**；该消息的处理方是根页的 `FeaturePackPref`/其它 helper，经 `super` 冒泡即可。

---

## 5. 7 个自定义控件的实现

路径统一前缀 `smali/com/maxmpz/audioplayer/preference/`。本页实际实例化 **8 个控件 / 7 个 Poweramp 类**（`PowerampLogoPreference`×1、`FeaturePackRedirectPref`×1、`LicenseStatusPref`×1、`UberLevelPref`×1、`MultilineSwitchPreference`×2、`ProgressPreference`×1、`RedirectPreference`×1）。

### 5.1 `PowerampLogoPreference`（4428 B / 198 行）

| 项 | 实测 | 证据 |
| --- | --- | --- |
| 父类 | `android.preference.Preference`（直接继承，非 `PrefBase`） | `:2` |
| 接口 | `Lׅ/xr0;` | `:6` |
| 布局 | `setLayoutResource(0x7f0400c7)` = `@layout/poweramp_logo_pref` | `:16`、`:19` |
| 关键开关 | `r20.К(this, false)` —— **关闭偏好行的默认 milk/背景处理** | `:24` |
| 渲染图像 | `findViewById(0x7f0d01de)`=`@id/image` → `AUtils.E(ctx, 0x7f0102e2)` 取主题属性 `settings_pa_logo` → `getDrawable` → `setImageDrawable` | `:58`、`:95`、`:116` |
| 渲染文字 | `findViewById(0x7f0d02f4)`=`@id/text2` → `setText(0x7f08034b)` = **`@string/maxmp_copyright`** | `:122`、`:143`、`:148` |
| 版权实文 | **"© 2010-2026 Maksim Petrov (Max MP)"** | `strings.xml:740` |
| 高度 | **由布局决定，代码不设**：`layout_height="wrap_content"`，image `marginTop=18dip`，text2 `marginTop=6dip`/`marginBottom=16dip`，wrapper `marginBottom=-16dip` | `res/layout/poweramp_logo_pref.xml:2-6` |
| 点击行为 | **无**。没有 `setOnPreferenceClickListener`，也没有 `setIntent`；XML 亦无 `android:key` | 全类零命中 |

补充：`:154`-`:171` 把 `@id/milk_wrapper`（`PreferenceMilkViewWrapper`）的 `y` 字段反向指回自己（`iput-object p0, p1, ...->y:L...PowerampLogoPreference;`），供 wrapper 回调；`onCreateView`（`:178-191`）与 `onWrapperAttached`（`:193-198`）都是**纯 `super` 转发 / 空实现**。

> **它是纯粹的静态品牌页脚**：Logo 图 + 版权行，无交互、无 key、无持久化。`marginBottom=-16dip` 的负边距是刻意的"吃掉"下方留白，让 Logo 块与第一个真实条目贴紧。

### 5.2 `FeaturePackRedirectPref`（4740 B / 254 行）——**本页最需要修正的控件**

| 项 | 实测 | 证据 |
| --- | --- | --- |
| 父类 | `…preference.RedirectPreference`（**二级派生**） | `:2` |
| 字段 | `public final i:Z`（唯一字段，名字就叫 `i`） | `:7` |
| 属性数组 | `Lׅ/qt0;->r0:[I` | `:38` |
| 读取的属性 | 索引 `0` → **`w:removeAsNeeded`**（`0x7f010c55`） | `:53` `getBoolean(0,false)` |
| 存储 | `iput-boolean p2, ...->i:Z` | `:61` |
| 覆写 | `В()V`（即 `onAttachedToActivity` 钩子链上的虚方法） | `:111-254` |
| 空转发 | `getDp(I)`、`onActivityResume/Start/Stop` 全是 bridge 空实现 | `:75-109` |

**`qt0.r0` 的解析**：`qt0.smali:1900` `filled-new-array {v7}, [I` → `:1908` `sput-object v0, Lׅ/qt0;->r0:[I`，其中 `v7` 来自 `qt0.smali:1073` `const v7, 0x7f010c55` = **`attr/removeAsNeeded`**（`public.xml:2506`）。**该数组只有 1 个元素**，所以 `getBoolean(0)` 读的就是 `removeAsNeeded`。

**`В()` 的完整判定树**（`:111-254`）：

```java
void В() {
    if (!this.i) { super.В(); return; }               // :115,119,248  ← removeAsNeeded=false → 普通跳转
    boolean sdkHigh = (y40.H.А >= 0xe5);              // :123,131,138-152   H = 版本号偏好, 0xe5 = 229
    boolean flagA   = (wr.w0.А & 1) != 0;             // :153,161,164       w0 = 当前版本偏好, 位测试
    if (flagA) goto L_tail;                           // :168
    if (sdkHigh) {
        if (wr.x0.А) goto L_tail;                     // :176,180,184      x0 = move_fp1_to_about
        else { parentGroup.removePreference(this); return; }   // :192,204
    }
    // !sdkHigh 且 !flagA 也会落到 :212/:213
    L_tail:
    if (wr.x0.А) {                                     // :214,218,222
        parentGroup.removePreference(this);            // :238
    }                                                  // :243/:244
}
```

四个分支的行为归纳：

| `w:removeAsNeeded` | `wr.w0.А & 1` | `y40.H.А >= 229` | `wr.x0.А`(`move_fp1_to_about`) | 结果 |
| --- | --- | --- | --- | --- |
| **false** | — | — | — | **`super.В()` 正常跳转，永不自删**（`:248`） |
| true | true | — | — | 跑到 `L_tail`；若 `x0` 为真则**自删** |
| true | false | true | true | 跑到 `L_tail`；**自删** |
| true | false | true | false | **立即自删**（`:204` 后 `return`） |
| true | false | false | 任意 | 落到 `:212` `goto L_tail` → 按 `x0` 决定 |

> **对本页的决定性结论**：`general.xml:5` **没有 `w:removeAsNeeded`**（实测该属性在本页**零出现**），所以 `this.i == false`，**`В()` 第一行就 `super.В()` 返回**（`:248`）。也就是说：
>
> **§5.2 这套"按授权/SDK 自删"的复杂逻辑，在「关于」页完全不执行。** 它只在 `singlepane.xml:12` 生效——那里显式写了 `w:removeAsNeeded="true"`。`general.xml` 里这个控件**永远可见**，点击走父类 `RedirectPreference.В()` → `PrefBase.В()` → 按 `w:target="feature_packages"` 跳子页。
>
> 这也解释了为什么 `general.xml:5` 也没有 `w:applyIconTint="false"`——两处声明是**不同用途的两个实例**，不是同一个配置的重复。

`RedirectPreference.В()`（本页实际走到的路径）【实证·产物】`RedirectPreference.smali:106-130`：`super.В()`（`:110`）→ 若 `this.h`（`setDependencyRaw` 设的字符串，`:99`）非 null → `setDependency(h)`（`:123`）。本页未调 `setDependencyRaw`，故 `h == null`，**只做 `super.В()`**。

### 5.3 `LicenseStatusPref`（28707 B / 1520 行）——第二大控件

| 项 | 实测 | 证据 |
| --- | --- | --- |
| 父类 | `…preference.ProgressPreference`（**三级派生**：`LicenseStatusPref` → `ProgressPreference` → `RawTextPreference` → `PrefBase`） | `:2` |
| 构造 | `super(ctx, attrs, true)` —— 第三参 `true` 传给 `ProgressPreference` | `:51` |
| 属性数组 | `qt0.r0`（与 §5.2 **完全相同**，都是 `removeAsNeeded`） | `:77` |
| 读取 | `getBoolean(0, false)` → `j` | `:92`、`:100` |
| 运行期 key | **`setKey("license_status")`** —— XML 里没有 key | `:109`、`:113` |
| 额外设置 | `setIconAlignedTop(1)` 图标顶对齐 | `:118` |
| 字段 | `static l:Z`（"已跑过首次检查"的一次性标志，`:1470`/`:1478`）、`i:Handler`、`j:Z`、`k:c60` | `:12`-`:20` |

**自删条件**（`В()`，`:1283-1520`，238 行）：

| 行 | 判定 |
| ---: | --- |
| `1287`/`1294` | `if (!this.j) goto :cond_5` —— **`j` = `removeAsNeeded` 关掉就永不自删** |
| `1298`-`1302` | `y40.O`（`mf1`，字符串偏好）取串 |
| `1306`-`1357` | `v2 = (y40.P > now/1000)` —— P 是**许可证到期时间戳（秒）**，即"仍在宽限期内" |
| `1358`-`1374` | `y40.H.А >= 0x110 (272)` → **跳过去自删**（高版本直接显示） |
| `1378` | `if (v2 != 0) goto :cond_5` —— 宽限期内 → 显示 |
| `1382`-`1394` | 若 `v0`（O 的串）非空且长度非 0 → 显示 |
| `1399`-`1417` | `y40.H.А == 2 \|\| == 3` → 显示（这两个版本号是"已激活 Full/Unlocked"态） |
| `1422`-`1440` | 否则 **`parentGroup.removePreference(this)`**（`:1434`）后 `return` |

**显示什么状态**（`X()`，`:165-...`）：

| 行 | 内容 |
| ---: | --- |
| `185`/`199`-`242` | `v2 = (y40.P > now/1000)` 再次判宽限期 |
| `243`-`247` | `v5 = y40.р.А`（`ec` 布尔偏好，区分 IAP / 非 IAP 渠道） |
| `262`/`271` | 宽限期内：`v5` 真 → `l_pending_iap` = **"Checking Purchase"**；假 → `l_pending_call` = **"License Check Pending"** |
| `289`/`298` | 对应消息：`l_pending_iap_msg`（`strings.xml:654`）/ `l_pending_call_msg`（`strings.xml:649`） |
| `316`-`336` | 宽限期外：取 `y40.о` 串作标题（null → `""`） |
| `376` | `setTitle(v2)` |
| `381` | `setIcon(0x7f02028c)` = **`@drawable/excl_24dp`**（一个感叹号图标） |
| `1482` | `setProgress(true)` —— 首次进入时开进度态 |
| `1507` | `handler.postDelayed(runnable, 0x3e8)` —— **1 秒后关闭进度**（`c60`，index `1`） |
| `1514` | `X()` 自调一次收尾 |

**对本页的意义**：`general.xml:6` 同样**没有** `w:removeAsNeeded`，故 `j == false`，`В()` 在 `:1294` 就 `goto :cond_5` → `:1445` `super.В()` → **永不自删**。它在本页**恒定显示**：优先显示"许可证仍在校验"类红色警示（带 `excl_24dp` 感叹号），否则显示许可证持有者串。

> 这是一个**运营状态控件而非设置项**：它不是"用户能改的东西"，而是"告诉用户授权目前处于什么阶段"。在 `singlepane`（根页）它被 `removeAsNeeded="true"` 变成"只在异常时冒出来"的警示条；在「关于」页则刻意常驻，让用户总能查到授权状态。

### 5.4 `UberLevelPref`（18707 B / 912 行）

| 项 | 实测 | 证据 |
| --- | --- | --- |
| 父类 | `…preference.RawTextPreference` | `:2` |
| 构造 | `super(ctx, attrs, true)` | `:31` |
| 属性数组 | `filled-new-array {0x10100e5}` —— 只有 **`android:clickable`** | `:61`、`:66` |
| 读取 | `getBoolean(0,false)` → `k`（**决定是否装点击监听**） | `:85`、`:93` |
| 装监听 | `onAttachedToHierarchy`（`:686`）内：`if (this.k)` → `new x11(0x19, this)` → `setOnPreferenceClickListener` | `:695`、`:707`、`:711`、`:716` |

**`clickable=true` 时点击做什么**：`x11` index `0x19` = 25，`.packed-switch` 的默认分支（`x11.smali:62` 之后、`:113` `:pswitch_0` 之前）——即 **25 超出 `0..24` 的 switch 范围，走 default**：

```
x11.smali:67    check-cast v3, ...UberLevelPref
x11.smali:88    MsgBusHelper.fromContextOrNoop(ctx, 0x7f0d015c)   ← bus_app_cmd
x11.smali:96    const v0, 0x7f0d003e                             ← cmd_app_open_settings
x11.smali:101   const-string v1, "feature_packages#buy_uber_badges"
x11.smali:105   msgBus.post(cmd_app_open_settings, 0, 0, "feature_packages#buy_uber_badges")
```

> **点击 = 发一条深链消息，跳到 Feature Packages 页的 `buy_uber_badges` 锚点**。不直接开 Activity，符合 Poweramp 的"命令总线 + 深链"风格。注意 `x11.smali:71` 的 `sget UberLevelPref.l:I` 读了静态字段但**结果未使用**——又一处死读。

**等级如何渲染**（`X()`，`:269-...`）：

| 行 | 内容 |
| ---: | --- |
| `273`-`277` | `new SpannableStringBuilder()`（`ae1` 子类） |
| `291` | `y40.e()` = **`y40.c.А + y40.с.А`**（`y40.smali:376-399` 实测：两个 `z20` 相加）→ 即 **uber 等级数值** |
| `303` | 字面量 `"x"` 作为前缀 |
| `307`-`332` | 等级 `> 0` → `append("x")` + `append(String.valueOf(level))` |
| `340`-`341` | 等级 `<= 0` → `append("0")` |
| `352`-`372` | 若等级 `> 0` → `v2 = t21.X(level, "x")`（拼 `level + "x"`，用于定位 span） |
| `384` | `level >= 0x32 (50)` 标记 |
| `409`/`417` | 若 `>= 50` → 在 `"\n"` 后追加 `v2` |
| `426`-`451` | `new ae1(AUtils.o(ctx, 0x7f080901, v2))` |
| `438` | `0x7f080901` = **`@string/uberpatron_badges_purchased_s`** = `"Uberpatron Badges Purchased: %s"`（`strings.xml:2108`） |
| `551` | `new RelativeSizeSpan(6)` —— 对 `v2` 那段做**相对字号放大**（`1.0 + level*0.1` 经 `MathKt.В` 取整后 `+1`，`:483-510`） |

**刷新触发**：`onBusMsg`（`:796-844`）监听 `0x7f0d0669` = **`msg_settings_fp_update`**（`public.xml:8416`）→ 置 `h = true`（`:812`）→ 用 `qx.B(runnable, 0x64)` 排一个 **100ms** 延迟任务（`:833`/`:837`），由 `p71`（index `0x15`）驱动重算；`onBindView`（`:725-794`）消费 `h` 标志（`:734`），若为真则清零（`:745`）并播 250ms（`0xfa`）的 `DecelerateInterpolator` 动画。

> 即：**等级行是"赞助等级 + 徽章数"的只读展示**，`clickable=true` 只是让它能跳去买徽章。

### 5.5 `ProgressPreference`（4158 B / 198 行）

| 项 | 实测 | 证据 |
| --- | --- | --- |
| 父类 | `…preference.RawTextPreference` | `:2` |
| 字段 | `public h:Z`（进度态） | `:7` |
| widget 布局 | `setWidgetLayoutResource(0x7f0400de)` = `@layout/preference_progress_widget` | `:38`、`:41` |
| 关 milk | `r20.К(this, true)`（注意**与 Logo 相反**，传 `true`） | `:46` |
| 取控件 | `findViewById(0x7f0d026f)` = `@id/progress` → `ProgressBar` | `:120`、`:133` |
| 驱动 | `h != 0` → `setVisibility(0)`；否则 `setVisibility(8)`（`GONE`） | `:141`、`:149`、`:156`、`:161` |
| 写态 | `setProgress(Z)`：仅在值变化时 `iput` 并 `notifyChanged()` | `:179`、`:187`、`:191` |

widget 布局本身【实证·原文】`res/layout/preference_progress_widget.xml:2`：`<ProgressBar style="@android:style/Widget.ProgressBar.Large" android:indeterminate="true" android:layout_width="30dip" android:layout_height="30dip" />` —— **固定 30dip 的无限旋转进度圈**。

**`check_update` 的实际处境（重要发现）**：

`check_update` 这个 key 在**全树 smali 中零出现**（4929 个文件的字面量检索）。也就是说：

- 没有任何 `findPreference("check_update")`；
- 没有任何代码 `setProgress(true/false)` 到它上面。

而 `ProgressPreference` 类型在全树被 15 个文件引用，实际驱动者都是**购买/恢复授权**流程：`BuyUberPref`、`BaseRestoreFvPurchasePref`、`RestoreWebsiteFvPurchasePref`（各自 `/4`、`/3`、`/4` 次引用）与 `LicenseStatusPref`（`/4`）。`ba1`/`qk`/`v91`/`w81`/`m`/`sa1`/`y61`/`y9`/`e8`/`c60`/`m` 是这些流程的辅助类。

> **结论**：`check_update`（"Check Now"）虽然声明了 `android:persistent="false"`（说明作者预期它是**动作型**条目而非状态型），但它所在的整个 `updates` 分类在 `v()` 里被**无条件删除**（§4.2 ④a），所以**这个控件永远不会出现在屏幕上，它的进度态也永远不会被驱动**。它和 `check_updates`/`check_beta_updates` 一起，构成了本页最大的"声明残留"块。

### 5.6 `MultilineSwitchPreference`（14088 B / 628 行）

| 项 | 实测 | 证据 |
| --- | --- | --- |
| 父类 | **`android.preference.SwitchPreference`**（框架类，**不是** `PrefBase` 派生） | `:2` |
| 核心字段 | `X:Lׅ/wr0;`（一个"多行文本渲染器"） | 由 `:211`/`:295` 等 iget 可见 |
| `getSummary()` | **完全绕过 super**，直接 `X.А(null)` | `:207`-`:227` |
| `getTitle()` | `super.getTitle()` 结果交给 `X.А(...)` 二次加工 | `:240`-`:265` |
| `setSummary(s)` | 先 `X.X(s)`（存一份）**再** `super.setSummary(s)`（存框架那份） | `:543`-`:562` |
| `setSummary2(int/String)` | **只写 `X`**，不碰 super —— 这就是"第二行摘要" | `:564`-`:595` |
| `setSup(String)` | `X.K = s` 且 `X.O = null`（清缓存后重建） | `:597`-`:617` |
| `onBindView` | `super` 之后调 **`wr0.х(...)`** 做整体多行渲染，再取 `Switch` 设 `scaleX/scaleY`、`jumpDrawablesToCurrentState`、装 `ag0` 勾选监听 | `:283`、`:311`、`:331`、`:343`-`:352`、`:384`、`:402` |
| switch 缩放 | `К:F` 字段 + `setSwitchScale(F)` | `:229`-`:238`、`:619`-`:628` |

**与普通 `SwitchPreference` 的差异（三条）**：

1. **摘要不再是一行**。普通 `SwitchPreference` 只有 `getSummary()`/`setSummary()` 一对；本类额外提供 **`setSummary2()`**（第二摘要），由 `wr0` 渲染成标题下 **两行**。`wr0.х(...)`（`:311`）一次传入 2 个 `TextView` 槽位（`v2`/`v3` 两个 null = 让渲染器自己找），正是"多行"的实现点。
2. **`getSummary()` / `setSummary()` 被劫持**。读取时**不返回** `super` 的值（`:218` 直接 `X.А(null)`），写入时**双写**（`:551` 内存 + `:556` 框架）。所以外部若通过 `Preference.getSummary()` 读，拿到的是渲染器的值而非框架存的原始值。
3. **`Switch` 控件被后处理**。`:331` 取到 `Switch` 后设缩放、按时间戳决定是否 `jumpDrawablesToCurrentState`（避免每次绑定都播动画，`100ms` 阈值见 `:372`-`:380`），并**替换**勾选监听为 `ag0`。

**在本页的两个实例**（`check_updates` / `check_beta_updates`）都没有使用 `setSummary2`，只有 `check_updates` 用了 XML 的 `android:summary`；`check_beta_updates` **连 summary 都没有**——但两者仍是 `MultilineSwitchPreference` 而非普通 `SwitchPreference`，属于**统一用同一控件类**的做法。

### 5.7 `RedirectPreference`（2884 B / 130 行）——第 7 个控件

| 项 | 实测 | 证据 |
| --- | --- | --- |
| 父类 | `…preference.RawTextPreference` | `:2` |
| 字段 | `h:String`（`setDependencyRaw` 写入） | `:99` |
| `В()` | `super.В()` → `if (h != null) setDependency(h)` | `:106`-`:130` |
| 本页实例 | `translations`（`general.xml:18`，带 `w:target="translations"`） | — |

`w:target` 的消费在父类：`PrefBase.getTarget()`（`PrefBase.smali:190-218`）/`setTarget()`（`:439-464`）。本页 `translations` 未调 `setDependencyRaw`，所以 `h == null`，`В()` 只做 `super.В()`（`:110`）就返回——跳转由 `w:target` + 基类完成。

> **`PrefBase.В()`（`:466-530`）就是"`onAttachedToActivity` 钩子"的落点**：`PrefBase.onAttachedToActivity()`（`:269-300`）在首次挂载时（`К` 标志位，`:278`-`:289`）调 `В()`（`:293`）；`onAttachedToHierarchy()`（`:302-333`）同样在 `:326` 调一次。这就是 §5.2/§5.3 里"自删"逻辑的**触发时机**——**每个控件在第一次被挂到 Activity/Hierarchy 时执行一次**，不是每次绘制。

---

## 6. `w:skipSearch` 的四种形态逐一判定

### 6.1 本页 5 处实测（含根节点核对）

⚠️ `general.xml` 内有 **3 个** `PreferenceScreen`（根 + `visit_site_about` + `privacy`）。**只取第一个** `<PreferenceScreen` 判断根节点——否则会把子节点的 `skipSearch` 误算到根上。

| 元素 | 行 | key | `skipSearch` 值 |
| --- | ---: | --- | --- |
| **根 `PreferenceScreen`** | **2** | — | **无（不带）** |
| `LicenseStatusPref` | 6 | *（无）* | **`true`** |
| `MultilineSwitchPreference` | 10 | `check_updates` | **`true`** |
| `MultilineSwitchPreference` | 11 | `check_beta_updates` | **`true`** |
| `PreferenceScreen` | 15 | `visit_site_about` | **`play,huawei`** |
| `PreferenceScreen` | 22 | `privacy` | **`true`** |

> **根节点不带 `skipSearch`** ⇒ **整份 `general.xml` 会进搜索索引**，仅上述 5 个条目被排除。对照：`translations.xml:2` 与 `commands_history.xml` 是**根节点带** `skipSearch="true"`，整份不进索引【实证·原文】。
>
> 所以本页 5 处 `skipSearch` 全部是**条目级**，走的是 `u9.А()` 路径，**不是**文档级 `PrefSearchIndexer.y()` 路径。

### 6.2 判定逻辑在 `u9.х()`（全 App 唯一实现）

`u9.х(TypedArray, int idx, boolean def)`【实证·产物】`u9.smali:467-588`（122 行）：

| 行 | 逻辑 | 语义 |
| ---: | --- | --- |
| `471` | `peekValue(idx)` | 取原始 `TypedValue` |
| `479`-`483` | `if (v == null) return def;` | **属性缺失 → 用默认值**（本页调用方默认 `false`） |
| `491` | `const/16 v1, 0x12` | `TYPE_INT_BOOLEAN` |
| `495` | `if (v.type == 0x12)` | **是布尔则走布尔分支** |
| `499`-`504` | `b = getBoolean(idx, def)` | — |
| `507` | `if (b) goto :goto_1` | **`true` → 直接返回 `true`** |
| `515` | `s = getString(idx)` | **布尔 `false` 会继续往下走到字符串分支！** |
| `523`-`535` | `isEmpty(s)` → `goto :goto_0` → 返回 `false` | — |
| `539`-`543` | `nn.В(s, "play")` | **候选 token 1：`"play"`** |
| `555`-`559` | `nn.В(s, "pa")` | **候选 token 2：`"pa"`** |
| `576` | `return false` | 两个都不命中 |
| `584` | `return true` | 命中任一 |

**`"true"` 如何解析**：`TypedArray` 把 `android:skipSearch="true"` 解析成 `TYPE_INT_BOOLEAN`（`0x12`），`peekValue` 的 `type` 命中 `0x12` 分支 → `getBoolean` 返回 `true` → `:507` 直接 `goto :goto_1` → **`return true`**。**不走字符串分支**。

**`"play,huawei"` 如何解析**：`format="string|boolean"` 下这是**字符串**，`TypedValue.type` 是 `TYPE_STRING`，跳过 `0x12` 分支 → `getString` 得 `"play,huawei"` → 非空 → 依次试 `nn.В(s,"play")`、`nn.В(s,"pa")`。

**`nn.В()` 是逗号分隔精确成员判定**（全类仅 106 行、唯一静态方法）【实证·产物】`nn.smali:7-106`：

```
:25    i = list.indexOf(token, i)
:30-33 if (i < 0) return false
:37-45 end = i + token.length()
:56    v4 = 0x2c = ','
:60-72 右边界：end == list.length() 或 list.charAt(end) == ','  否则 i++ 重试
:77-93 左边界：i == 0 或 list.charAt(i-1) == ','               否则 i++ 重试
:98    return true
```

> 标准"逗号分隔精确匹配"，能区分 `"play"` 与 `"plays"`（后者右边界不是 `,` 且未到串尾 → 跳过）。

### 6.3 ⚠️ 关键修正：`"huawei"` **永远不会**被匹配

`u9.х()` 只探测 **两个** token：`"play"`（`:539`）与 `"pa"`（`:555`）。**没有第三个 `"huawei"` 分支**。

因此 `visit_site_about` 的 `w:skipSearch="play,huawei"` 中，`"huawei"` 这一项**是无效的死值**——它既不会被 `nn.В` 匹配（因为代码根本不拿 `"huawei"` 去比），也不会导致任何差异。

全树 `"huawei"` 字面量的真实用途与本判定无关【实证·产物】：

| 位置 | 用途 |
| --- | --- |
| `xn0.smali:407` | `Build.BRAND`/渠道字符串比较家族的一员（与 `google`/`meizu`/`FiiO` 并列，`xn0.<clinit>` 的渠道识别） |
| `uu0.smali:5195` | `"com.huawei.appmarket"` 包名 |
| `n00`/`t00`/`ue`/`dy1`/`HuaweiMigrationActivity` | 华为渠道**数据迁移**流程 |

> **修正既有文档 §8.3 的推论**：既有文档写「`huawei` 版 → `visit_site_about` 跳过；`uni` 版 → 参与索引」的**三态表**。实测这个三态表**不成立**，因为判定代码只有 `play`/`pa` 两个 token：
>
> | 变体 | `visit_site_about`（值 `play,huawei`）实际判定 |
> | --- | --- |
> | `bundle-play`（本 build） | `"play"` 命中 → **跳过索引** ✅ |
> | `bundle-huawei` | `"play"` 不命中、`"pa"` 不命中 → **参与索引**（与既有文档说法**相反**） |
> | `bundle-uni` | 同上 → 参与索引 ✅ |
>
> 换句话说 `"huawei"` 这个值的唯一作用是**给人以"条件式"的错觉**，实际行为等价于 `skipSearch="play"`。

### 6.4 `"pa"` 的语义

`nn` 的类声明是 `.super Lcom/maxmpz/audioplayer/Edition;`，而 `Edition.APP = "pa"`。所以两个 token 的真实含义：

| token | 来源 | 含义 |
| --- | --- | --- |
| `"play"` | 字面量（`u9.smali:539`） | Google Play 构建变体 |
| `"pa"` | `Edition.APP` 常量 | **Poweramp 自身**（`Edition.APP` 恒等于 `"pa"`，即对所有 Poweramp 构建恒真） |

> **这带来一个更强的结论**：由于 `"pa"` 对**任何** Poweramp 构建都命中，**任何字符串形态的 `skipSearch`（只要值里含 `pa`，或值恰好被 `nn.В` 判为含 `pa`）都恒为 `true`**。反过来，不含 `pa`/`play` 的值（如 `audio_dvc.xml` 的 `"peq"`）在所有变体下**恒为 `false`**——即那条 `"peq"` 配置**也是死值**。
>
> 修正后的形态对照：**字符串形态实际上退化成"是否包含 `play` 或 `pa`"的静态判定，与运行期变体无关**（`"play"` 是编译期固定的字面量比较，不是 `BuildConfig` 读取）。`u9.х()` **完全不读** `Build.BRAND`、`BuildConfig`、渠道字段或 `xn0` 的任何东西。

### 6.5 本页 5 处逐条判定（本 build = `bundle-play`）

| 元素 | 属性值 | 类型 | 判定路径 | 本 build 结果 | 该条目在搜索里 |
| --- | --- | --- | --- | --- | --- |
| `LicenseStatusPref` | `true` | `0x12` | 布尔 `true` → `:507` | **true** | **排除** |
| `check_updates` | `true` | `0x12` | 同上 | **true** | **排除** |
| `check_beta_updates` | `true` | `0x12` | 同上 | **true** | **排除** |
| `visit_site_about` | `play,huawei` | `TYPE_STRING` | `nn.В("play,huawei","play")` → **true**（左边界 0、右边界 `,`） | **true** | **排除** |
| `privacy` | `true` | `0x12` | 布尔 `true` | **true** | **排除** |

**5 处全部命中、全部排除索引**，4 处走布尔短路、1 处走字符串匹配。

> **实际效果评估**：由于 `updates` 分类（含 `check_updates`/`check_beta_updates`）与 `visit_site_about` 在 `v()` 里被**无条件删除**（§4.2），这 3 个 `skipSearch` **在 UI 上已无对象**——它们只在"搜索结果"这一侧仍有残余意义：**防止索引里出现 3 条点了无处可去的行**。真正还有 UI 对象的只有 `LicenseStatusPref` 与 `privacy` 两处。
>
> 这也说明一件事：**`skipSearch` 与 UI 可见性是两套独立机制**，`r91` 删 UI 时**不**同步删索引，靠 XML 的 `skipSearch` 兜住。

---

## 7. 分类 `addons` 的运行期填充来源

### 7.1 具体代码位置

填充全部发生在 `r91.v()` 的 ④b-⑨ 段（§4.2）：`addons` 分类对象在 `r91.smali:635`（键名）→ `:647`（`check-cast` 成 `PreferenceCategory`）取得，随后四路发现（§4.5）各自 `addPreference`，最后 `:1376` 兜底。

**唯一写入口**是 `PreferenceGroup.addPreference`，全类**只有 3 个调用点**【实证·产物】（`r91.smali` 内 `addPreference` 仅出现在 `:155`、`:809`、`:1399`）：

| 调用点 | 位于 | 被复用为 |
| --- | --- | --- |
| `:155` | `I()` 末尾 | **②③④ 三路共用**（`I()` 被调 3 次：`:943`、`:1238`、`:1349`） |
| `:809` | addon ① 内联构造 | 仅 ① |
| `:1399` | ⑨ 兜底 `None` 行 | 仅兜底 |

> 所以"5 个逻辑写入点"对应"3 个物理调用点"，其中 `:155` 一处被复用 3 次。数调用点时容易多算，此处特别标注。

### 7.2 物品来源：**不是**官方插件列表，而是三方 App 的三种 Android 元数据协议

| 来源 | 协议载体 | 元数据键 | 语义（推断） |
| --- | --- | --- | --- |
| ② | `ContentProvider` + intent action `android.content.action.DOCUMENTS_PROVIDER` | **`com.maxmpz.PowerampTrackProvider`** | 向第三方提供"当前曲目" |
| ③ | `BroadcastReceiver` + action `com.maxmpz.audioplayer.TRACK_CHANGED(_EXPLICIT)` | （无元数据，靠 action 订阅） | 接收换曲广播 |
| ④ | `Application` 级 `metaData` | **`com.maxmpz.PowerampVisPresets`** | 提供可视化预设包 |
| ① | 硬编码包名 | — | **`com.maxmpz.audioplayer.unlock`**（官方解锁包，唯一非协议来源） |

> 三类协议恰好对应 Poweramp 对外开放的**三个集成点**：曲目数据输出、换曲事件订阅、可视化预设。**没有一个与"皮肤/skin/输出/均衡器预设"相关**——这三类（skin、audio output、EQ preset）在 `smali/com/maxmpz/audioplayer/preference/` 下有**独立的控件族**（`SkinImportSettingsPreference`、`SkinExportSettingsPreference`、`SkinRadioPreference`、`MultilineSwitchPreference` 等十余个 `Skin*` 类），它们由**各自的设置页**管理，**不经过 `addons` 分类**。
>
> 所以 `addons` 的语义应精确表述为：**「与 Poweramp 集成的第三方 App 自荐区」**，而非"插件/skin/预设市场"。

### 7.3 与插件体系文档的关系（只引用，不重述）

| 关系 | 本文处理 |
| --- | --- |
| `addons` 发现机制 vs 业务插件系统 | **见 [`all-business-plugin-system.md`](./all-business-plugin-system.md)** —— 该文覆盖"业务功能如何被插件化装载"；本文只覆盖"第三方 App 如何在此页自荐"。两者是**不同层**：前者是 App 内部功能模块化，后者是 App 间的 Android 元数据协商。 |
| `addons` 条目 vs 插件宿主 | **见 [`plugin-host-design.md`](./plugin-host-design.md)** —— 该文覆盖插件宿主边界与生命周期；本文的 `I()`/`q91` 只是**列表渲染 + 启动外部 App**，不装载任何代码，**不构成插件宿主**。 |
| 明确的边界声明 | `addons` 列表项的点击（`q91`）**只调 `getLaunchIntentForPackage` + `startActivity`**（`q91.smali:89`/`:97`），**从不**把外部代码加载进 Poweramp 进程。 |

---

## 8. 跨页出口

### 8.1 `feature_packages`（子页，叶）

| 项 | 值 | 证据 |
| --- | --- | --- |
| 出口声明 | `general.xml:5` `w:target="feature_packages"` | 【实证·原文】 |
| 目标 XML | `res/xml/feature_packages.xml`，id **`0x7f160013`** | 【实证·原文】`public.xml:11066` |
| 目标标题 | `@string/feature_packages` = "Feature Packages" | `feature_packages.xml:2`、`strings.xml:442` |
| 该页 helper | 由 `u61` 的 `0x7f160013` 分支构造（**非本文范围**） | — |
| 反向联动 | 子页的 `move_fp1_to_about`（`feature_packages.xml:12`）控制**本页入口**是否在 Settings 顶层隐藏（`strings.xml:569`） | §3.3 |

> **双向关系**：本页 → 子页靠 `w:target`；子页 → 本页靠 `move_fp1_to_about` 影响 `singlepane` 顶层入口的可见性。**不展开子页内部**（另一篇文档范围）。

### 8.2 `translations`（子页，叶）

| 项 | 值 | 证据 |
| --- | --- | --- |
| 出口声明 | `general.xml:18` `w:target="translations"` | 【实证·原文】 |
| 目标 XML | `res/xml/translations.xml`，id **`0x7f160029`** | 【实证·原文】`public.xml:11088` |
| 目标标题 | `@string/pref_translations` = "Translations" | `translations.xml:2`、`strings.xml:1682` |
| 目标根节点 | `w:skipSearch="true"`（**文档级**，整份不进索引） | `translations.xml:2` |

> 注意本页 `translations` 条目本身**没有** `skipSearch`（`general.xml:18` 只有 `title`/`key`/`w:target`），而它指向的**目标文档**是整份 skip。两者层级不同，勿混淆。**不展开子页**。

### 8.3 `visit_site_about` 外链（**死链**）

| 项 | 值 | 证据 |
| --- | --- | --- |
| XML 声明 | `<intent android:action="android.intent.action.VIEW" android:data="http://powerampapp.com/" />` | 【实证·原文】`general.xml:16` |
| 运行期 | **被无条件删除**，`<intent>` 永不触发 | 【实证·产物】`r91.smali:462`→`:478` |

```java
// r91.smali:462-483
Preference p = otherCat.findPreference("visit_site_about");   // :462
if (p != null) {                                              // :474
    otherCat.removePreference(p);                             // :478  ← 无任何条件
}
```

> **这是本页第一个"声明残留"**：`http://powerampapp.com/` 在 build-1035 里**不可达**。它的 `w:skipSearch="play,huawei"` 也随之只剩"索引侧"意义（§6.5）。
>
> 注意该 URL 是 **`http://`**（非 https），且无 `targetPackage`——纯隐式 `ACTION_VIEW`。

### 8.4 `oss` 的显式 `ComponentName`

| 项 | 值 | 证据 |
| --- | --- | --- |
| XML 声明 | `<intent android:targetPackage="@string/edition_pak_name" android:targetClass="com.maxmpz.audioplayer.preference.SettingsLicenseActivity" />` | 【实证·原文】`general.xml:20` |
| `targetPackage` 解析 | `@string/edition_pak_name` = **`com.maxmpz.audioplayer`** | 【实证·原文】`strings.xml:391` |
| 目标类存在性 | `smali/com/maxmpz/audioplayer/preference/SettingsLicenseActivity.smali` **存在** | 【实证·产物】 |
| 运行期 | **保留**（只有 `visit_site_about` 和 `updates` 被删） | `r91` 无 `oss` 相关代码 |

> **与 8.3 的对比是本页一条清晰的对照**：`oss` 用**显式** `ComponentName`（同包内 Activity，绝对可靠）；`visit_site_about` 用**隐式** `ACTION_VIEW`（依赖浏览器/系统，且已被删）。本页对"内部跳转"用显式、"外部跳转"用隐式且**主动砍掉**——反映出该版本的取舍：**不再引导用户去官网**。
>
> `@string/edition_pak_name` 作为 `targetPackage` 说明**这个 intent 会随构建变体改变目标包**（`edition_pak_name` 是渠道化字符串），而不是写死 `com.maxmpz.audioplayer`。

### 8.5 `privacy` 的运行期 URL

| 项 | 值 | 证据 |
| --- | --- | --- |
| XML 声明 | 自闭合 `PreferenceScreen`，**无 `<intent>`、无 `w:target`** | 【实证·原文】`general.xml:22` |
| URL 来源 | 主题属性 `pref_privacy_policy`（`0x7f0108f6`），**不是 XML** | 【实证·产物】`r91.smali:516` |
| URL 实值 | **`https://www.iubenda.com/privacy-policy/8016901/full-legal`** | 【实证·原文】`styles.xml:10692` |
| 注入方式 | `new Intent(ACTION_VIEW)` + `Uri.parse(...)` + `setIntent(...)` | `r91.smali:537`/`:571`/`:587` |

详见 §4.4。

### 8.6 出口总表

| 出口 | 类型 | 目标 | 运行期状态 |
| --- | --- | --- | --- |
| `feature_packages` | `w:target` → 子页 | `0x7f160013` | ✅ 可达 |
| `translations` | `w:target` → 子页 | `0x7f160029` | ✅ 可达 |
| `oss` | 显式 `ComponentName` | `com.maxmpz.audioplayer` / `…SettingsLicenseActivity` | ✅ 可达 |
| `privacy` | 运行期 `ACTION_VIEW` | `https://www.iubenda.com/privacy-policy/8016901/full-legal` | ✅ 可达（主题决定 URL） |
| `visit_site_about` | 隐式 `ACTION_VIEW`（XML） | `http://powerampapp.com/` | ❌ **永不可达**（被 `v()` 删除） |
| `about_version` | `x11(0xa)` → `ChangelogActivity` | 同包 Activity | ✅ 可达 |
| `uber_level` | `x11(0x19)` → 深链消息 | `feature_packages#buy_uber_badges` | ✅ 可达（`clickable=true`） |
| `check_updates` / `check_beta_updates` | 开关 | `global` SharedPreferences | ⚠️ **无 UI**（`updates` 被删） |
| `check_update` | 动作（`np`） | — | ❌ **无 UI 且无驱动方** |
| `addons` 行 | `q91` → 外部 App | 各 `getLaunchIntentForPackage` | ✅ 可达（有 addon 时） |

---

## 9. 与既有文档 `poweramp-about-and-support-settings.md` 的差异

### 9.1 三处实质性修正

| # | 既有文档口径 | 本文实测 | 证据 |
| ---: | --- | --- | --- |
| 1 | §8.3 给出 `visit_site_about` 的**三态表**：play 跳过 / huawei 跳过 / uni 参与 | **不成立**。`u9.х()` 只探测 `"play"` 与 `"pa"` 两个 token，**无 `"huawei"` 分支**。huawei 版实际**参与索引**（与原文相反）。`"huawei"` 是死值。 | `u9.smali:539`、`:555`（仅两处 `nn.В` 调用） |
| 2 | §3.2 表把 `FeaturePackRedirectPref` 描述为带"按授权/SDK 自删"逻辑的控件 | 逻辑确实存在（`В()`），但 **`general.xml:5` 没有 `w:removeAsNeeded`**，`i == false` → `В()` 首行即 `super.В()` 返回，**自删逻辑在本页永不执行**。同理 `LicenseStatusPref`（`general.xml:6`）也**没有** `w:removeAsNeeded`，**恒定显示**。该属性只在 `singlepane.xml:6,12` 出现。 | `FeaturePackRedirectPref.smali:115,119,248`；`LicenseStatusPref.smali:1287,1294`；`general.xml:5,6` vs `singlepane.xml:6,12` |
| 3 | §3.8 称 `r91` 有"三个非 `v()` 方法" | 实测 **5 个 `.method`**：`I()`、`onBusMsg()`、`v()`、`z()`、`Х()` —— 非 `v()` 的有 **4 个**，漏计 `I()`。 | `r91.smali:7,163,204,1408,1425` |

### 9.2 三处深化（不矛盾，但本文给出更细的机制）

| # | 主题 | 既有文档 | 本文深化 |
| ---: | --- | --- | --- |
| 1 | `vr` 注册的**返回值丢弃** | §3.4.1 只说"值仍可读写、只是没有 UI 入口" | 实测 `vr.smali:2527`/`2536` 后**无 `move-result-object`/`sput-object`**，两个 key **没有对应字段**，且全树无任何按该字面量的读取方。准确表述应为"可持久化但**无人消费**"。 |
| 2 | `updates` 被删的**后果范围** | §3.4.1 提到"三个开关不可见" | 补上**第四项**：`check_update`（`ProgressPreference`）**全树零 key 命中**，连 `setProgress` 驱动方都不存在，是比"不可见"更强的"**从未被接线**"。 |
| 3 | `addons` 语义 | §3.7 列出四路协议 | 补充：`addons` 与 skin/output/EQ 预设**无关**（那些是独立的 `Skin*` 控件族），并给出 `q91` 两分支**代码完全相同**（index `0`/`1` 是死参数）的实测。 |

### 9.3 一处确认（Lead 提示的核对）

Lead 提供"本页持久化项只有 `check_updates` / `check_beta_updates` / `move_fp1_to_about` 三个"。实测：**前两个正确**，`move_fp1_to_about` **不属于本页**——它在 `wr.<clinit>`（`wr.smali:1753-1765`），声明在 `feature_packages.xml:12`，消费在 `p91.Q()`（`p91.smali:11`）。本文 §3.3 已给出完整定位。

---

## 10. 未解问题

| # | 问题 | 已知 | 待查 |
| ---: | --- | --- | --- |
| Q1 | `Sync.native_lock(-1)` 返回串的确切内容 | 调用序列已知（`r91.smali:255-293`），包在 `synchronized` 内，配套 `native_close(1)` | native 层实现（`libpoweramp` 之类），本文未展开 |
| Q2 | `y40.H` / `y40.O` / `y40.P` / `y40.р` / `y40.c` / `y40.с` 的**字面偏好名** | 字段与类型已知（`y40.smali:9,13,15,19,33,35`），用途由使用点推断（版本号 / 许可证串 / 到期时间戳 / 渠道布尔 / 两个 uber 计数） | 需从 `y40.<clinit>` 或其 `ms.с/b` 调用点反查 key 名；本文只用到其**语义位置** |
| Q3 | `wr.w0` 与 `y40.H` 的**关系** | 两者都是 `Lׅ/z20;`，`В()` 里都当"版本号"用（`y40.H.А >= 0xe5` 与 `wr.w0.А & 1`） | `wr.w0` 在 `wr.smali:1741-1749` 由 `const/16 v7, 0x4c` + `if-ne v7, v3` 门控后赋值，`v3` 来源复杂；未完全解出 |
| Q4 | `flagA = wr.w0.А & 1` 的位语义 | 位测试形态明确（`FeaturePackRedirectPref.smali:161`） | 该位代表哪个 Feature Pack 状态，需 `w0` 的完整语义 |
| Q5 | `Х()` 传 `false` vs 基类 `true` 的**行为差异** | 调用点与参数已知（`r91.smali:1452`） | `BaseApplication.P(Z)`（`:482-532`）→ `o4` index `1`/`2` → `Н(true/false)`（`:2658`）的差异，属应用级启动路径 |
| Q6 | `u9.А()` 里 `qt0.G` 的 index `8`/`9` | 实测 `8` = `w:skipSearch`、`9` = `w:skipSearchForSDK`（`u9.smali:1069`/`1086`） | `qt0.G` 10 个元素的完整映射（本文只用到 8/9） |
| Q7 | `addons` 四路发现**在同一 App 上重复命中**时是否会重复加行 | ②③④ 各自独立累加、无全局去重（③ 内部用 HashMap 去重，跨路不去重） | 一个 App 同时提供 TrackProvider + 订阅 TRACK_CHANGED 时会**出现两行**——是否真实发生需运行期验证 |
| Q8 | `radio`/`ProgressPreference` 的 `check_update` 是否有**规划中被删的功能** | key 全树零命中，但控件类完整保留 | 需比对其他 build 变体，判断是"未接线"还是"已废弃" |

---

## 11. 证据索引

| 主题 | 路径:行 |
| --- | --- |
| **页面 XML** | |
| 根节点 / title / 无 summary / 无 ignoreTitle | `res/xml/general.xml:2` |
| 18 元素全量（按序） | `res/xml/general.xml:4-24` |
| 元素 #1 Logo（零属性） | `res/xml/general.xml:4` |
| 元素 #2 FeaturePackRedirectPref | `res/xml/general.xml:5` |
| 元素 #3 LicenseStatusPref（ss=true） | `res/xml/general.xml:6` |
| 元素 #4 about_version | `res/xml/general.xml:7` |
| 元素 #5 UberLevelPref（clickable） | `res/xml/general.xml:8` |
| 分类 `updates` + 3 子项 | `res/xml/general.xml:9-13` |
| 分类 `other` + 4 子项 | `res/xml/general.xml:14-23` |
| `visit_site_about` 外链 | `res/xml/general.xml:15-17` |
| `oss` 显式 ComponentName | `res/xml/general.xml:19-21` |
| `privacy`（无 intent） | `res/xml/general.xml:22` |
| 分类 `addons`（空） | `res/xml/general.xml:24` |
| **资源** | |
| `general` → `0x7f160014` | `res/values/public.xml:11067` |
| `feature_packages.xml` → `0x7f160013` | `res/values/public.xml:11066` |
| `translations.xml` → `0x7f160029` | `res/values/public.xml:11088` |
| `attr/settings_pak` → `0x7f010c53` | `res/values/public.xml:2504` |
| `attr/pref_privacy_policy` → `0x7f0108f6` | `res/values/public.xml:2297` |
| `attr/removeAsNeeded` → `0x7f010c55` | `res/values/public.xml:2506` |
| `string/pref_about` → `0x7f080487` | `res/values/public.xml:5191` |
| `string/bit` → `0x7f0800b8` | `res/values/public.xml:4353` |
| `string/none` → `0x7f0803c8` | `res/values/public.xml:5018` |
| `msg_app_version_check` → `0x7f0d03e4` | `res/values/public.xml:7918` |
| `cmd_app_feature_pak_settings_refresh` → `0x7f0d0530` | `res/values/public.xml:8250` |
| `About` | `res/values/strings.xml:1007` |
| `Feature Packages` / 其 summary | `res/values/strings.xml:442` / `:2035` |
| `Version/Changelog` | `res/values/strings.xml:1693` |
| `Update` / `Other` / `Addons` | `res/values/strings.xml:1685` / `:1268` / `:1011` |
| `Check For Updates` / 其 summary | `res/values/strings.xml:1060` / `:1475` |
| `Check For Beta Versions` / `Check Now` | `res/values/strings.xml:1057` / `:1059` |
| `Visit Website` / `Translations` / `Privacy Policy` | `res/values/strings.xml:1719` / `:1682` / `:1332` |
| `Open Source Licenses` | `res/values/strings.xml:1265` |
| `edition_pak_name` = `com.maxmpz.audioplayer` | `res/values/strings.xml:391` |
| `bit` / `None` | `res/values/strings.xml:151` / `:832` |
| `maxmp_copyright` = © 2010-2026 | `res/values/strings.xml:740` |
| `l_pending_iap` / `l_pending_call` | `res/values/strings.xml:653` / `:218` |
| `l_pending_iap_msg` | `res/values/strings.xml:654` |
| `uberpatron_badges_purchased_s` | `res/values/strings.xml:2108` |
| `pref_summary_about`（入口摘要） | `res/values/strings.xml:1456` |
| `hide_fp_in_settings`（子页开关） | `res/values/strings.xml:569` |
| `attr/settings_general` 声明 | `res/values/attrs.xml:961` |
| `settings_general` 主题赋值 | `res/values/styles.xml:10645` |
| `settings_pak` 主题赋值 | `res/values/styles.xml:10688` |
| `pref_privacy_policy` = iubenda 8016901 | `res/values/styles.xml:10692` |
| `pref_privacy_policy_non_play`（未使用） | `res/values/styles.xml:10693` |
| **布局** | |
| `poweramp_logo_pref` 布局（高度/边距全在此） | `res/layout/poweramp_logo_pref.xml:2-6` |
| `@id/image` / `@id/text2` | `res/layout/poweramp_logo_pref.xml:5` / `:6` |
| `preference_progress_widget`（30dip 无限进度） | `res/layout/preference_progress_widget.xml:2` |
| **入口与设置树** | |
| `general` 入口行（含 applyIconTint=false） | `res/xml/singlepane.xml:23` |
| `singlepane` 根 ignoreTitle=true | `res/xml/singlepane.xml:2` |
| `singlepane` LicenseStatusPref **有** removeAsNeeded | `res/xml/singlepane.xml:6` |
| `singlepane` FeaturePackRedirectPref **有** removeAsNeeded | `res/xml/singlepane.xml:12` |
| `feature_packages` 的 move_fp1_to_about | `res/xml/feature_packages.xml:12` |
| `translations` 根节点 skipSearch=true | `res/xml/translations.xml:2` |
| **分发表与基类** | |
| 分发表命中 `0x7f160014` | `smali/ׅ/u61.smali:434` / `:439` |
| `new Lׅ/r91;` + 走 n91 构造器 | `smali/ׅ/u61.smali:443` / `:447` |
| SharedPreferences 名 `"global"` | `smali/ׅ/u61.smali:107` / `:111` |
| 页面切换驱动 `n91.w()` | `smali/ׅ/u61.smali:1736` |
| 构造器调 `z()` / `Х()` | `smali/ׅ/n91.smali:476` / `:481` |
| `v()` 是抽象模板方法 | `smali/ׅ/n91.smali:2763` |
| `w()` 首行调 `v()` | `smali/ׅ/n91.smali:2770` |
| 基类 `z()` 默认实现 | `smali/ׅ/n91.smali:2981` |
| `n91.у()` 整页刷新 + 重新驱动 w() | `smali/ׅ/n91.smali:3483` / `:3545` |
| **r91** | |
| 类声明 / super | `smali/ׅ/r91.smali:1-2` |
| `I()` addon 行构造器 | `smali/ׅ/r91.smali:7-161` |
| `onBusMsg` 两条消息 | `smali/ׅ/r91.smali:163-202`（id 在 `:167`/`:180`，刷新在 `:189`） |
| `v()` 全段 | `smali/ׅ/r91.smali:204-1406` |
| 版本串：硬编码 build 串 | `smali/ׅ/r91.smali:228` |
| 版本串：'\n' 常量（兼作 x11 index） | `smali/ׅ/r91.smali:237` |
| 版本串：Sync 握手 | `smali/ׅ/r91.smali:255` / `:259` / `:267` |
| 版本串：native_lock / native_close | `smali/ׅ/r91.smali:280` / `:293` |
| 版本串：64/32 位判定 | `smali/ׅ/r91.smali:327` / `:339` / `:354` |
| 版本串：空格 + `@string/bit` | `smali/ׅ/r91.smali:364` / `:377` |
| 版本串：异常日志 | `smali/ׅ/r91.smali:401` |
| 版本串：setSummary | `smali/ׅ/r91.smali:423` |
| 版本串：挂 x11(0xa) | `smali/ׅ/r91.smali:428` / `:432` |
| `visit_site_about` 无条件删除 | `smali/ׅ/r91.smali:462` / `:478` |
| `privacy` 主题属性取 URL | `smali/ׅ/r91.smali:484` / `:500` / `:516` |
| `privacy` ACTION_VIEW + setIntent | `smali/ׅ/r91.smali:537` / `:571` / `:587` |
| `updates` 无条件整块删除 | `smali/ׅ/r91.smali:597` / `:617` |
| `addons` 取分类 + v6=0 | `smali/ׅ/r91.smali:635` / `:647` / `:663` |
| addon① unlock 包内联构造 | `smali/ׅ/r91.smali:667` / `:795` / `:809` |
| addon① 失败置 v3=0 | `smali/ׅ/r91.smali:821` |
| addon② TrackProvider | `smali/ׅ/r91.smali:842` / `:923` / `:943` |
| addon② 计数落地 | `smali/ׅ/r91.smali:950` / `:989` |
| addon③ 双子 action + HashMap 去重 | `smali/ׅ/r91.smali:1014` / `:1081` / `:1104` |
| addon③ Arrays.sort + 逐个 I() | `smali/ׅ/r91.smali:1212` / `:1238` |
| addon③ 计数落地 | `smali/ׅ/r91.smali:1267` |
| addon④ VisPresets | `smali/ׅ/r91.smali:1279` / `:1329` / `:1349` |
| addon④ 计数落地 | `smali/ׅ/r91.smali:1356` / `:1373` |
| 兜底 `None` | `smali/ׅ/r91.smali:1376` / `:1389` / `:1399` |
| `z()` 覆写标题 | `smali/ׅ/r91.smali:1408` / `:1412` / `:1417` |
| `Х()` 传 P(false) | `smali/ׅ/r91.smali:1425` / `:1449` / `:1452` |
| 点击 → ChangelogActivity | `smali/ׅ/x11.smali:550` / `:568` / `:577`；switch 表 `:849` / `:860` |
| addon 点击 → 外部 App | `smali/ׅ/q91.smali:89` / `:97` / `:119` |
| **持久化** | |
| `vr.<clinit>` 范围 | `smali/ׅ/vr.smali:375-3996` |
| `v3` 默认 false | `smali/ׅ/vr.smali:435` |
| 注册 `check_updates`（返回值丢弃） | `smali/ׅ/vr.smali:2523` / `:2527` |
| 注册 `check_beta_updates`（返回值丢弃） | `smali/ׅ/vr.smali:2532` / `:2536` |
| `ms.с(String,Z)→pb1` 注册语义 | `smali/ׅ/ms.smali:2687` / `:2703` / `:2712` |
| `move_fp1_to_about` 实际在 wr | `smali/ׅ/wr.smali:1741` / `:1745` / `:1749` / `:1753` / `:1757` / `:1765` |
| `move_fp1_to_about` 消费点 | `smali/ׅ/p91.smali:11`（`:39` 挂监听） |
| **skipSearch** | |
| `u9.х()` 全实现 | `smali/ׅ/u9.smali:467-588` |
| 属性缺失 → 默认值 | `smali/ׅ/u9.smali:479` |
| `TYPE_INT_BOOLEAN` 判定 | `smali/ׅ/u9.smali:491` / `:495` |
| 布尔 true 短路返回 | `smali/ׅ/u9.smali:507` |
| 字符串分支（布尔 false 会落到这里） | `smali/ׅ/u9.smali:515` / `:523` |
| token `"play"` | `smali/ׅ/u9.smali:539` / `:543` |
| token `"pa"`（仅这两个） | `smali/ׅ/u9.smali:555` / `:559` |
| 返回 false / true | `smali/ׅ/u9.smali:576` / `:584` |
| `nn.В()` 逗号精确匹配 | `smali/ׅ/nn.smali:7` / `:56` / `:72` / `:93` / `:98` |
| 条目级调用点（`qt0.G` 索引 8） | `smali/ׅ/u9.smali:1054` / `:1069` / `:1074` |
| 跳过分支落地 | `smali/ׅ/u9.smali:1082` / `:1479` |
| 文档级调用点 | `smali/com/maxmpz/preference/PrefSearchIndexer.smali:578` |
| **控件** | |
| PowerampLogo：布局 + 关 milk | `…/PowerampLogoPreference.smali:16` / `:19` / `:24` |
| Logo 图（主题属性） | `…/PowerampLogoPreference.smali:58` / `:95` |
| Logo 版权文字 | `…/PowerampLogoPreference.smali:122` / `:143` / `:148` |
| Logo → wrapper 反指 | `…/PowerampLogoPreference.smali:154` / `:171` |
| FeaturePackRedirectPref 读 removeAsNeeded | `…/FeaturePackRedirectPref.smali:7` / `:38` / `:53` / `:61` |
| 自删判定树 `В()` | `…/FeaturePackRedirectPref.smali:111` / `:115` / `:119` / `:123` / `:131` / `:153` / `:176` / `:214` |
| 自删调用点 | `…/FeaturePackRedirectPref.smali:204` / `:238` |
| `i==false` 直接 super | `…/FeaturePackRedirectPref.smali:248` |
| LicenseStatusPref 构造 + 读 removeAsNeeded | `…/LicenseStatusPref.smali:51` / `:77` / `:92` / `:100` |
| 运行期 setKey("license_status") | `…/LicenseStatusPref.smali:109` / `:113` |
| 自删条件 `В()` | `…/LicenseStatusPref.smali:1283` / `:1287` / `:1294` / `:1366` / `:1378` / `:1403` / `:1413` |
| 自删调用点 / `j==false` 路径 | `…/LicenseStatusPref.smali:1434` / `:1445` |
| 首次检查标志 `l` | `…/LicenseStatusPref.smali:1458` / `:1470` |
| 进度态 1 秒后关闭 | `…/LicenseStatusPref.smali:1482` / `:1507` |
| 状态文案选择 | `…/LicenseStatusPref.smali:185` / `:243` / `:262` / `:271` / `:376` |
| 感叹号图标 | `…/LicenseStatusPref.smali:381` |
| UberLevelPref 读 clickable | `…/UberLevelPref.smali:31` / `:61` / `:93` |
| 装点击监听（clickable 才装） | `…/UberLevelPref.smali:686` / `:695` / `:707` / `:711` / `:716` |
| 等级渲染 `X()` | `…/UberLevelPref.smali:269` / `:303` / `:384` / `:438` / `:551` |
| 消息刷新（msg_settings_fp_update） | `…/UberLevelPref.smali:796` / `:800` / `:812` / `:837` |
| 点击 → 深链消息 | `smali/ׅ/x11.smali:71` / `:88` / `:101` / `:105` |
| ProgressPreference widget + 进度态 | `…/ProgressPreference.smali:38` / `:41` / `:46` / `:84` / `:120` / `:141` / `:161` / `:187` / `:191` |
| MultilineSwitch：劫持 get/setSummary | `…/MultilineSwitchPreference.smali:207` / `:218` / `:240` / `:543` / `:551` |
| MultilineSwitch：setSummary2 / setSup | `…/MultilineSwitchPreference.smali:564` / `:597` |
| MultilineSwitch：多行渲染 + switch 后处理 | `…/MultilineSwitchPreference.smali:311` / `:331` / `:343` / `:384` |
| RedirectPreference.В() | `…/RedirectPreference.smali:106` / `:123` |
| `В()` 的触发时机（onAttached*） | `…/PrefBase.smali:269` / `:293` / `:302` / `:466` |
| **32/64 位判定** | |
| `xn0.B()` 新 API 分支 | `smali/ׅ/xn0.smali:1379` / `:1395` |
| `xn0.B()` 旧 API 分支 | `smali/ׅ/xn0.smali:1407` |
| `"huawei"` 在渠道识别中（与本页无关） | `smali/ׅ/xn0.smali:407` |

---

## 12. 给实现方的三条结论

1. **「关于」页不是设置页，是信息页**。13 个 key 里只有 2 个持久化、且无人消费；真正的工作量在**运行期装配**（版本串拼接、四路 addon 发现、主题属性取 URL），而不是偏好读写。若移植，应把它当**只读视图 + 少量动作**建模，而不是当 `Settings` 表单。

2. **三套"删除"机制并存，别混淆**：①`r91.v()` 的**无条件 `removePreference`**（`updates` 整块、`visit_site_about`）；②控件自删（`w:removeAsNeeded` → `FeaturePackRedirectPref.В()` / `LicenseStatusPref.В()`），**本页未启用**；③索引侧排除（`w:skipSearch`），**独立于前两者**。本页实际生效的只有 ① 和 ③。

3. **`w:skipSearch` 的值域比看起来窄**。判定代码只认 `"play"` / `"pa"` 两个 token（`u9.smali:539`/`:555`），`"huawei"`、`"peq"` 这类值都是**死值**，行为等价于"不含 `play`/`pa` → 恒不跳过"。如果要实现真正的"按构建变体决定"，需要自己加变体判定，不能照抄这套。

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
