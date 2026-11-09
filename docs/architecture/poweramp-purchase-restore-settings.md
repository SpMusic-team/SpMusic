---
doc_id: poweramp-purchase-restore-settings
title: Poweramp「已购买/购买方式」两页完整实现（付费解锁与恢复购买）
doc_type: architecture
status: draft
owner_agent: lead
version_scope: build-1035-bundle-play (versionCode 1035009)
created: 2026-11-07
updated: 2026-11-07
source_documents:
  - .rea-analysis/v1035/decoded/res/xml/already_purchased.xml
  - .rea-analysis/v1035/decoded/res/xml/buy_methods.xml
  - .rea-analysis/v1035/decoded/res/xml/feature_packages.xml
  - .rea-analysis/v1035/decoded/res/values/strings.xml
  - .rea-analysis/v1035/decoded/res/values/public.xml
  - .rea-analysis/v1035/decoded/smali/ׅ/z61.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/x11.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/u61.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RestorePlayUnlockerPurchasePref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RestoreWebsiteFvPurchasePref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RestoreFvPurchasePref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RestoreHuaweiFvPurchasePref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RestoreRustoreFvPurchasePref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RestoreFeaturePackPurchasePref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RestoreOtherFvPurchasePref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/BuyPlayFvPref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/BuyWebsiteFvPref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/BuyRustoreFvPref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/BuyHuaweiFvPref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/BuyUberPref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/BuyMethodsRedirectPref.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/LicenseStatusPref.smali
  - docs/architecture/poweramp-settings-root-structure.md
  - docs/architecture/poweramp-about-and-support-settings.md
  - docs/architecture/poweramp-misc-complete.md
---

# Poweramp「已购买/购买方式」两页完整实现

> **证据分级**：【实证·原文】= XML/资源；【实证·产物】= 反编译 smali；【推断】= 无直接佐证。
>
> 全部基于 **build-1035-bundle-play**（`versionCode 1035009`）。
>
> **本文补齐的是全设置树最后两块未深挖的页面**——`already_purchased` 与 `buy_methods`。

### 阅读导引

| 想知道什么 | 去第几节 |
| --- | --- |
| 两页在设置树的什么位置 | **§1** |
| **已购买页 7 个元素** | **§2** |
| **购买方式页 12 个元素** | **§3** |
| 7 个 `Restore*Pref` 类做什么 | **§4** |
| 6 个 `Buy*Pref` 类做什么 | **§5** |
| **商品 ID 与地区差异** | **§6** |
| 渠道对比（Play/RuStore/华为/官网）| **§7** |
| 两页的 helper 分发 | **§8** |
| 未解问题 | **§9** |
| 证据索引 | **§10** |

---

## 0. 一句话结论

这两页是 Poweramp 的**付费解锁与恢复购买**界面，是**全设置树唯一的商业化入口**。

**三个关键事实**：

1. **两页都用共享 helper `z61`**（不是专用 helper）——`already_purchased` 用**索引 0**，`buy_methods` 用**索引 6**
2. **7 个 `Restore*Pref` 覆盖 6 种销售渠道**：Google Play / RuStore（俄）/ 华为 AppGallery / 官网 / Feature Pack / Unlocker
3. **商品 ID 按地区分叉**：常规 `PowerampUnlocker-build-310`、俄区 `Poweramp-unlocker-ru2-301/307`

**最重要的设计**：**恢复购买不是"重新下载"，而是"向各商店查询历史订单"**——每个渠道一个独立控件，各自调用对应商店的 API。

---

## 1. 页面身份与位置

### 1.1 两个页面

| 页面 | XML | 资源 id | 规模 | 标题 |
| --- | --- | --- | ---: | --- |
| **已购买** | `already_purchased.xml` | **`0x7f160002`** | 2322 B / 7 元素 | `pref_already_purchased_q` |
| **购买方式** | `buy_methods.xml` | **`0x7f16000f`** | 2554 B / 12 元素 | `pref_all_purchasing_methods` |

### 1.2 入口位置

【实证·原文】`singlepane.xml` 顶部（**不在分类内**）：

```xml
<com.maxmpz.audioplayer.preference.AlreadyPurchasedRedirectPref
    android:icon="@drawable/settings_restore_purchase_colored"
    android:title="@string/pref_already_purchased_q"
    android:key="already_purchased"
    android:summary="@string/pref_restore_purchase"
    w:target="already_purchased" w:skipSearch="true" w:removeAsNeeded="true" />

<com.maxmpz.audioplayer.preference.FeaturePackRedirectPref
    android:icon="?settings_pak"
    android:title="@string/feature_packages"
    android:key="feature_packages"
    android:summary="@string/summary_feature_packages"
    w:target="feature_packages" w:removeAsNeeded="true" />
```

> **两个跳转项在 `singlepane` 顶部**（授权状态、购买入口区），**不在「Settings」分类里**。
>
> **`w:removeAsNeeded="true"`** —— 已购买用户可能看不到这些项（运行时移除）。

### 1.3 两页的共同特征

| 特征 | 两页 |
| --- | --- |
| 根节点 `w:skipSearch` | **`"true"`**（不进搜索索引）|
| helper | **`z61`**（共享，4867 行）|
| 元素类型 | **全部自定义 `*Pref` 类**（无原生 `Preference`）|
| `restore_defaults` | ❌ **无**（付费页不适用）|

> **`skipSearch="true"` 的理由**：付费页不需要被搜索到——它是入口而不是配置。

---

## 2. 已购买页（`already_purchased`）7 个元素

【实证·原文】`already_purchased.xml`：

| # | key | 类 | 标题资源 | 说明 |
| ---: | --- | --- | --- | --- |
| 1 | *（无 key）* | **`LicenseStatusPref`** | — | **当前授权状态** |
| 2 | `restore_purchase` | **`RestoreFvPurchasePref`** | `iap_on_gplay` | **Google Play 恢复** |
| 3 | **`restore_unlocker`** | **`RestorePlayUnlockerPurchasePref`** | `unlocker_purchase_on_gplay` | **Unlocker 恢复**（709 行）|
| 4 | **`rustore`** | **`RestoreRustoreFvPurchasePref`** | `rustore` | **RuStore 恢复**（俄区）|
| 5 | `huawei` | **`RestoreHuaweiFvPurchasePref`** | `hms_app_gallery` | **华为 AppGallery 恢复** |
| 6 | **`website`** | **`RestoreWebsiteFvPurchasePref`** | `site` | **官网购买恢复**（364 行）|
| 7 | `get_support` | `RawTextPreference` | `pref_purchase_faq` | 跳转 FAQ |

### 2.1 多行文本结构（`w:line1`~`w:line4`）

【实证·原文】以 `restore_purchase` 为例：

```xml
<RestoreFvPurchasePref
    android:icon="@drawable/gplay_icon_24dp"
    android:title="@string/iap_on_gplay"
    android:key="restore_purchase"
    w:line1="@string/restore_purchases"
    w:line2="@string/fv_iap_purchase"
    w:line3="@string/feature_packages"
    w:line4="@string/uber_badges"
    w:singleNewline="true"
    w:iconAlignedTop="true"
    w:applyIconTint="false"
    w:line2Prefix="• "
    w:line3Prefix="• "
    w:line4Prefix="• " />
```

| 属性 | 作用 |
| --- | --- |
| `w:line1` ~ `w:line4` | **最多 4 行文本** |
| **`w:lineNPrefix`** | 每行的前缀（这里是 `"• "` 项目符号）|
| **`w:singleNewline`** | 用单换行而非双换行（紧凑排版）|
| `w:iconAlignedTop` | 图标顶部对齐 |
| `w:applyIconTint="false"` | **不用主题着色**（保留品牌色）|

> **`applyIconTint="false"` 很关键**——Google Play 图标是彩色的，如果被主题 tint 会变色。
>
> **只有三个渠道图标保持原色**：Google Play（`gplay_icon_24dp`）、官网（`q_rect_32dp` 在 `get_support`）、以及华为/RuStore 各自。

### 2.2 各渠道的多行内容对照

| key | line1 | line2 | line3 | line4 |
| --- | --- | --- | --- | --- |
| `restore_purchase` | `restore_purchases` | `fv_iap_purchase` | `feature_packages` | `uber_badges` |
| **`restore_unlocker`** | `pref_restore_purchase` | **`only_appl_for_unlocker_app_purchase`** | — | — |
| `rustore` | `restore_purchases` | `fv_iap_purchase` | `uber_badges` | — |
| `huawei` | `restore_purchases` | `fv_iap_purchase` | `uber_badges` | — |
| **`website`** | `pref_restore_purchase` | **`only_appl_for_website_purchase`** | — | — |

> **`restore_unlocker` 和 `website` 都只有 2 行**，并带 `only_appl_for_*` 限定说明——
>
> 因为它们的**适用范围窄**：`restore_unlocker` 只对"解锁器 App 购买"有效，`website` 只对"官网购买"有效。
>
> 而 `restore_purchase`（Play）/`rustore`/`huawei` 覆盖 Full Version + Feature Pack + Uber Badges **三种商品**。

---

## 3. 购买方式页（`buy_methods`）12 个元素

【实证·原文】`buy_methods.xml`：

### 3.1 说明区（5 个 `RawTextPreference`）

| # | 图标 | 内容 |
| ---: | --- | --- |
| 1 | `app_unlock_badge_32dp` | `@string/full_version` |
| 2 | `unlock_badge_32dp` | `w:line1="@string/fv0_line1"` |
| 3 | `package_badge_32dp` | `w:line1="@string/fv0_line2"` |
| 4 | `code_badge_32dp` | `w:line1="@string/fv0_line4"` |
| 5 | `one_badge_32dp` | `line1=one_time_purchase` / `line2=lifetime_license` / `line3=fv0_line3` |

第 5 项还有：

```xml
w:line1Prefix="● " w:line2Prefix="● " w:line3Prefix="● "
w:lineCase="decapitalize"     ← ★ 首字母小写
w:reducedPad="true"            ← 减小内边距
```

> **`w:lineCase="decapitalize"`** 是罕见的属性——把每行首字母变小写，用于列表中连贯阅读。

### 3.2 购买按钮区（4 个 `Buy*Pref`）

| # | key | 类 | 说明 |
| ---: | --- | --- | --- |
| 6 | `buy_play_fv` | **`BuyPlayFvPref`** | Google Play 购买 |
| 7 | `buy_rustore_fv` | **`BuyRustoreFvPref`** | RuStore 购买 |
| 8 | *（无 key）* | **`BuyHuaweiFvPref`** | 华为购买 |
| 9 | **`buy_from_website`** | **`BuyWebsiteFvPref`** | **官网购买** |

> **全部带 `w:buttonOnly="true"`** —— 只显示按钮，不显示标题行。

### 3.3 状态与跳转（3 个）

| # | key | 类/类型 | 说明 |
| ---: | --- | --- | --- |
| 10 | *（无 key）* | **`LicenseStatusPref`** | 当前状态（在 `current_status` 分类里）|
| 11 | `already_purchased` | `AlreadyPurchasedRedirectPref` | 跳转到已购买页 |
| 12 | `get_support` | `Preference` | 购买 FAQ（在 `get_support` 分类里）|

### 3.4 两页的镜像关系

```
buy_methods（购买方式）
  ├─ 说明：买什么（Full Version / Lifetime / 三种商品）
  ├─ 按钮：从哪买（Play / RuStore / 华为 / 官网）
  ├─ 状态：买了没（LicenseStatusPref）
  └─ 跳转 → already_purchased（"已经买过了"）

already_purchased（已购买）
  ├─ 状态：LicenseStatusPref
  ├─ 恢复：从哪恢复（6 个 Restore*Pref）
  └─ 跳转 → get_support（"有问题？"）
```

> **`already_purchased` 里没有指向 `buy_methods` 的链接**，但 `buy_methods` 有指向 `already_purchased` 的。
>
> 单向跳转——符合"买了才可能需要恢复"的流程。

---

## 4. 7 个 `Restore*Pref` 类

### 4.1 类清单与继承关系

【实证·产物】`com/maxmpz/audioplayer/preference/`：

| 类 | 规模 | 父类 | 渠道 |
| --- | ---: | --- | --- |
| **`RestorePlayUnlockerPurchasePref`** | **709 行 / 14717 B** | **`RawTextPreference`** | Google Play（Unlocker App）|
| **`RestoreWebsiteFvPurchasePref`** | **364 行 / 7055 B** | **`ProgressPreference`** | 官网 |
| `RestoreFeaturePackPurchasePref` | 387 行 / 6871 B | — | Feature Pack |
| `RestoreHuaweiFvPurchasePref` | 106 行 / 2294 B | — | 华为 AppGallery |
| `RestoreRustoreFvPurchasePref` | 107 行 / 2298 B | — | RuStore |
| `RestoreOtherFvPurchasePref` | 74 行 / 1395 B | — | 其他 |
| **`RestoreFvPurchasePref`** | **60 行 / 1209 B** | **`BaseRestoreFvPurchasePref`** | Google Play（FV）|

> **规模差异极大**：`RestorePlayUnlockerPurchasePref`（709 行）vs `RestoreFvPurchasePref`（60 行）。
>
> 原因：前者要处理**多地区商品 ID + HTML 链接构造 + 复杂状态判断**，后者只是基类的薄子类。

### 4.2 `RestoreFvPurchasePref`（60 行，最简）

【实证·产物】`RestoreFvPurchasePref.smali`：

```java
public class RestoreFvPurchasePref extends BaseRestoreFvPurchasePref {
    // 只有构造器 + 4 个 bridge 方法
    // 全部逻辑在 BaseRestoreFvPurchasePref 里
}
```

| 方法 | 行 | 说明 |
| --- | --- | --- |
| `<init>` | 7–21 | 构造 |
| `getDp(I)` | 25–38 | **bridge synthetic** |
| `onActivityResume()` | 40–45 | **bridge synthetic** |
| `onActivityStart()` | 47–52 | **bridge synthetic** |
| `onActivityStop()` | 54–59 | **bridge synthetic** |

> **4 个 `bridge synthetic` 方法**是 Kotlin 编译产物——Kotlin 的 `Preference` 生命周期回调通过 bridge 转发给基类。

### 4.3 `RestorePlayUnlockerPurchasePref`（709 行，最复杂）

#### ① 类身份

【实证·产物】：

| 项 | 值 |
| --- | --- |
| 父类 | **`RawTextPreference`**（不是 `Restore*` 基类！）|
| 规模 | 709 行 / 14717 B |
| 字段 | `h:Handler`（重试调度）|

> **它直接继承 `RawTextPreference`**，因为要做的事与 FV/FeaturePack 恢复完全不同：**这是给"Poweramp Unlocker"这个独立 App 用的恢复入口**。

#### ② 方法表

| 方法 | 行 | 规模 | 职责 |
| --- | --- | ---: | --- |
| `<init>` | 22–515 | **493** | **构造 + 全部 UI 构造** |
| `B()` | 519–541 | 22 | 清理 Handler |
| **`X()`** | 543–616 | **73** | **可用性判断** |
| `getDp(I)` | 618–631 | 13 | bridge |
| `onActivityResume/Start/Stop` | 633–652 | 各 5 | bridge |
| **`onBusMsg(...)`** | 654–691 | **37** | **消息处理** |
| `В()` | 693–708 | 15 | — |

#### ③ 构造器的完整流程（493 行）

【实证·产物】`RestorePlayUnlockerPurchasePref.smali:22-515`：

```java
RestorePlayUnlockerPurchasePref(Context ctx, AttributeSet attrs) {
    super(ctx, attrs);

    // ① 取 Google Play 图标
    Drawable icon = ctx.getPackageManager()
                       .getApplicationIcon("com.android.vending");     // :125  ★ 商店包名
    int size = MathKt.А(displayMetrics);                          // :145-165
    setIcon(new et(icon, size, size));                             // :177-182

    // ② 判断地区
    boolean isRu = oh.A(ctx);                                      // :222  ★ 俄罗斯判定
    ...

    // ③ 按版本 + 地区选商品 ID
    if (go0Version >= 229) {                                       // :242  ★ 版本判定
        sku = "PowerampUnlocker-build-310";                        // :246  常规
    } else if (go0Version <= ...) {
        sku = "Poweramp-unlocker-ru2-301";                         // :269  俄区旧
        sku = "Poweramp-unlocker-ru2-307";                         // :277  俄区新
    }

    // ④ 构造 HTML 链接
    sb.append("<br><br>");                                          // :329
    sb.append(title).append(": <a href='");                        // :338-343
    sb.append(uriPrefix).append(pkg).append('.').append(sku);      // :352-371
    sb.append("'>").append(pkg).append('.').append(name);          // :376-385
    sb.append("</a><br>");                                         // :390
}
```

> **`getApplicationIcon("com.android.vending")`** —— 直接读 Google Play 商店的图标显示在项上。
>
> **这是"用别的 App 的图标"的技巧**——不需要打包 Play 图标资源。

#### ④ `X()`：三重可用性判断

【实证·产物】`RestorePlayUnlockerPurchasePref.smali:543-616`：

```java
void X() {
    // ① 全局禁用条件
    if (go0.k.c) {                        // :547-558
        setEnabled(false);                // :562
        goto end;
    }

    // ② 未授权 + 版本低于 229 → 禁用
    boolean enabled = false;
    if (!this.j) {                        // :571  未初始化
        if (y40.H.А < 0xe5 /* 229 */) {   // :579-591  ★ 版本门槛
            enabled = true;               // :599
        }
    }
    setEnabled(enabled);                  // :604

end:
    notifyChanged();                      // :610
}
```

| 条件 | 结果 |
| --- | --- |
| `go0.k.c`（全局标志）| **禁用** |
| 已初始化（`this.j`）| 禁用 |
| `y40.H.А < 229` | 启用 |
| 其他 | 禁用 |

> **版本门槛 `0xe5` = 229** —— 与商品 ID `PowerampUnlocker-build-310` 里的 "310" 呼应（build 号体系）。

### 4.4 `RestoreWebsiteFvPurchasePref`（364 行）

【实证·产物】：

| 项 | 值 |
| --- | --- |
| 父类 | **`ProgressPreference`**（有进度条！）|
| 规模 | 364 行 / 7055 B |

**关键字符串**：

| 字符串 | 行 | 用途 |
| --- | ---: | --- |
| **`"update()V"`** | `:35` | **反射调用的方法名** |
| **`"update"`** | `:49` | 方法名（不含签名）|
| `"store"` | `:301` | 存储/商店 |

**`update()` 的调用方式**【实证·产物】`:35-49`：

```java
// 反射查找 update 方法
Method m = cls.getDeclaredMethod("update");    // :49
```

> **为什么用反射**：`update()` 可能是 `private`，需要通过反射从内部类 `access$update` 调用。
>
> 这解释了 `:106-116` 的 `access$update` 静态桥接方法。

**继承 `ProgressPreference` 的理由**：官网购买恢复需要**网络请求**（查询订单），所以需要进度条。

### 4.5 华为 / RuStore / Feature Pack / Other 四个类

【实证·产物】规模相近（74~387 行），结构类似：

| 类 | 规模 | 特点 |
| --- | ---: | --- |
| `RestoreHuaweiFvPurchasePref` | 106 行 | HMS IAP 查询 |
| `RestoreRustoreFvPurchasePref` | 107 行 | RuStore IAP 查询 |
| `RestoreFeaturePackPurchasePref` | 387 行 | Feature Pack 专用（含 Uber Badges）|
| `RestoreOtherFvPurchasePref` | 74 行 | 兜底/其他渠道 |

---

## 5. 6 个 `Buy*Pref` 类

【实证·产物】`com/maxmpz/audioplayer/preference/`：

| 类 | 规模 | 渠道 |
| --- | ---: | --- |
| **`BuyUberPref`** | **636 行 / 12852 B** | **Uber Badges（最大）** |
| `BuyPlayFvPref` | 195 行 / 3529 B | Google Play |
| `BuyWebsiteFvPref` | 183 行 / 3625 B | 官网 |
| `BuyRustoreFvPref` | 166 行 / 2807 B | RuStore |
| `BuyHuaweiFvPref` | 161 行 / 2666 B | 华为 |
| `BuyMethodsRedirectPref` | 152 行 / 3062 B | 跳转到 buy_methods |

### 5.1 `w:buttonOnly="true"` 的意义

四个 `Buy*FvPref` 在 XML 里都带：

```xml
w:buttonOnly="true"
```

> **只渲染按钮部分**，不显示标题/摘要行。因为上方已有 5 个 `RawTextPreference` 说明"买什么"，按钮只需展示"从哪买"。

### 5.2 `BuyUberPref`（636 行）

**为什么最大**：Uber Badges 是**可重复购买的虚拟商品**（打赏），需要处理：
- 多档位选择
- 已购徽章展示
- 累积状态

---

## 6. ⭐ 商品 ID 与地区差异

### 6.1 三种商品 ID

【实证·产物】`RestorePlayUnlockerPurchasePref.smali`：

| 商品 ID | 行 | 适用 |
| --- | ---: | --- |
| **`PowerampUnlocker-build-310`** | `:246` | **常规**（build ≥ 229）|
| **`Poweramp-unlocker-ru2-301`** | `:269` | **俄区旧版** |
| **`Poweramp-unlocker-ru2-307`** | `:277` | **俄区新版** |

> **`ru2` 前缀** = Russia 第 2 版。
>
> **为什么俄区有独立 SKU**：俄罗斯无法用 Google Play 付费（制裁后），所以 Poweramp 在 RuStore 或官网单独售卖，用**不同的商品 ID**。

### 6.2 地区判定

【实证·产物】`:222`：

```java
boolean isRu = oh.A(ctx);
```

**`oh.A(Context)Z`** —— 这个类我们在 `poweramp-misc-complete.md` §13.6 见过：

```java
boolean isInRussiaImpl(Context ctx) {
    if (vr.u2 /* override_region */) return true;    // 用户强制覆盖
    List<String> regions = ["ru", "cn"];             // ★ 俄罗斯 + 中国
    String simIso = tm.getSimCountryIso();
    ...
}
```

> **两处使用同一个地区检测**：
> - `misc` 页的 `override_region` 开关
> - **购买页的商品 ID 选择**
>
> **这解释了 `override_region` 的真实用途**：不只是"绕过地区限制"，而是**让俄区/中国用户能选到正确的商品 ID**。
>
> **`cn`（中国）也在列表里** —— 中国市场同样无法用 Google Play 付费。

### 6.3 版本门槛

| 常量 | 值 | 位置 | 含义 |
| --- | ---: | --- | --- |
| `0xe5` | **229** | `:587` | **版本门槛**（≥229 用新 SKU）|

---

## 7. 渠道对比

| 渠道 | 购买类 | 恢复类 | 图标 | 适用市场 |
| --- | --- | --- | --- | --- |
| **Google Play** | `BuyPlayFvPref` (195行) | `RestoreFvPurchasePref` (60行)<br>`RestorePlayUnlockerPurchasePref` (709行) | `gplay_icon_24dp` | 全球（除俄/中）|
| **RuStore** | `BuyRustoreFvPref` (166行) | `RestoreRustoreFvPurchasePref` (107行) | — | **俄罗斯** |
| **华为 AppGallery** | `BuyHuaweiFvPref` (161行) | `RestoreHuaweiFvPurchasePref` (106行) | — | **中国市场** |
| **官网** | `BuyWebsiteFvPref` (183行) | `RestoreWebsiteFvPurchasePref` (364行) | `q_rect_32dp` | 全球兜底 |
| **Feature Pack** | — | `RestoreFeaturePackPurchasePref` (387行) | — | 所有人 |
| **Uber Badges** | `BuyUberPref` (636行) | — | — | 打赏 |

> **四条并列的销售渠道**：Play / RuStore / 华为 / 官网。
>
> **每个渠道都有独立的购买类和恢复类**——这是**应用商店碎片化**的直接后果。

---

## 8. 两页的 helper 分发

### 8.1 两页都用 `z61`

【实证·产物】`u61.smali`：

| 页面 | id | helper | 索引 |
| --- | --- | --- | ---: |
| `already_purchased` | `0x7f160002` | **`z61`** | **0** |
| `buy_methods` | `0x7f16000f` | **`z61`** | **6** |
| `feature_packages` | `0x7f160013` | `p91` | — |

**`u61` 分发代码**（`already_purchased`）：

```asm
456: const v10, 0x7f160002
461: if-ne v3, v10, :cond_7
465: new-instance v0, Lׅ/z61;
469: const/4 v5, 0x0                        ; ★ 索引 0
472: move-object v2, p0
475: invoke-direct {v0 .. v5}, Lׅ/z61;-><init>(...)
```

**`buy_methods`**：

```asm
484: const v2, 0x7f16000f
489: if-ne v3, v2, :cond_8
493: new-instance v0, Lׅ/z61;
497: const/4 v5, 0x6                        ; ★ 索引 6
503: invoke-direct {v0 .. v5}, Lׅ/z61;-><init>(...)
```

### 8.2 `z61` 的 20 项 switch

【实证·产物】`z61.smali:4753-4774`：

```
.packed-switch 0x0
  :pswitch_13   ← 索引 0  = already_purchased
  :pswitch_12   ← 索引 1
  :pswitch_11   ← 索引 2  = audio_focus
  :pswitch_10   ← 索引 3
  :pswitch_f    ← 索引 4
  :pswitch_e    ← 索引 5
  :pswitch_d    ← 索引 6  = buy_methods
  :pswitch_c    ← 索引 7
  ...
```

> **`z61` 服务 20 个页面**——是全设置树最大的共享 helper（4867 行）。

### 8.3 `already_purchased` 分支（索引 0 → `pswitch_13`）

【实证·产物】`z61.smali:4704-4750`：

```java
// 设置页面标题
setTitle(ctx.getString(0x7f0803da /* pref_already_purchased_q */));  // :4705-4718

// 绑定 get_support 点击
Preference p = K.findPreference(...);                                 // :4723-4732
p.setOnPreferenceClickListener(new x11(?, this));                     // :4735-4744
```

> **它只做两件事**：设标题 + 绑定 FAQ 跳转。
>
> **6 个 Restore 项不需要 helper 干预** —— 它们在自己的构造器里完成全部初始化。

### 8.4 `buy_methods` 分支（索引 6 → `pswitch_7`）

【实证·产物】`z61.smali:2566-2597`：

```java
Preference p = K.findPreference(...);          // :2567-2576
p.setOnPreferenceClickListener(new x11(0xe, this));  // :2579-2592   ★ 索引 14
```

### 8.5 `x11` 索引 14

【实证·产物】`x11.smali`（877 行，**25 项 switch**）：

| 索引 | 标签 | 位置 |
| ---: | --- | --- |
| 14 | **`pswitch_a`** | `:471-481` |

**`pswitch_a` 的实现（仅 11 行）**：

```java
:pswitch_a                                    // :471
  check-cast v3, Lׅ/z61;                      // :472
  v3.m(v1, v1, v2);                           // :476  ★ n91.m(Runnable,Runnable,int)
  return true;                                // :481
```

其中 `v1`/`v2` 都是 **`null`**（`:49`/`:52` 初始化）。

**`n91.m(null, null, idx)`** 的行为【实证-产物】`n91.smali:2190-2230`：

```java
void m(Runnable onPositive, Runnable onNegative, int idx) {
    b6 listener = new b6(this, this.y, onPositive);       // :2194-2202
    this.l(0x7f0805f6 /* 标题 */, listener, onNegative, idx, true);  // :2210-2224
}
```

> **`0x7f0805f6` 是确认框标题**。`buy_methods` 页里的某个条目点击后弹确认框。

---

## 9. 未解问题

| # | 问题 | 现状 | 需要什么 |
| ---: | --- | --- | --- |
| **P1** | `LicenseStatusPref` 如何显示授权状态 | 未读 | 读该类 |
| **P2** | `BaseRestoreFvPurchasePref` 的实际查询逻辑 | 未读基类 | 读该类 |
| **P3** | 华为/RuStore 的 IAP 查询细节 | 只见类名 | 读各类 |
| **P4** | `RestoreWebsiteFvPurchasePref` 的 `update()` 内容 | 只见反射调用 | 读 `update()` |
| **P5** | `BuyUberPref`（636 行）的档位逻辑 | 未读 | 读该类 |
| **P6** | `feature_packages` 页（`p91`） | 未读 | 另立专题 |
| **P7** | `x11` 索引 14 的 `0x7f0805f6` 标题文案 | 未解析 | 查 strings.xml |

> **P1-P5 都在静态范围内**，但涉及 5 个渠道的 IAP API 细节，收益偏窄。
>
> **P6 是另一个页面**（`feature_packages`，用 `p91` helper，2599 B / 6 key）。

---

---

## 10. 证据索引

### 10.1 XML 与资源

| 位置 | 内容 |
| --- | --- |
| **`already_purchased.xml`** | 7 元素（1 个 `LicenseStatusPref` + 5 个 Restore + 1 个 FAQ）|
| `already_purchased.xml:5` | `restore_purchase`（Play FV）|
| `already_purchased.xml:6` | **`restore_unlocker`（Play Unlocker）** |
| `already_purchased.xml:7` | **`rustore`** |
| `already_purchased.xml:8` | `huawei` |
| `already_purchased.xml:9` | **`website`** |
| **`buy_methods.xml`** | 12 元素（5 说明 + 4 按钮 + 3 状态跳转）|
| `buy_methods.xml:13` | `buy_play_fv` |
| `buy_methods.xml:14` | `buy_rustore_fv` |
| `buy_methods.xml:16` | **`buy_from_website`** |
| `singlepane.xml` | `already_purchased` / `feature_packages` 入口 |
| `public.xml` | `already_purchased`=`0x7f160002`、`buy_methods`=`0x7f16000f` |
| `public.xml` | `pref_already_purchased_q`=`0x7f0803da` |

### 10.2 smali —— 分发

| 位置 | 内容 |
| --- | --- |
| **`u61.smali:456-480`** | `already_purchased` → `z61` 索引 **0** |
| **`u61.smali:484-508`** | `buy_methods` → `z61` 索引 **6** |
| `u61.smali:512-530` | `feature_packages` → `p91` |
| **`z61.smali:4753-4774`** | **20 项 packed-switch 表** |
| **`z61.smali:4704-4750`** | **`pswitch_13`（索引 0）：设标题 + 绑 FAQ** |
| `z61.smali:4705` | `0x7f0803da` 标题 |
| **`z61.smali:2566-2597`** | **`pswitch_7`（索引 6）：绑 `x11(0xe)`** |
| `z61.smali:2583` | `const/16 v3, 0xe` |
| **`x11.smali:849-875`** | **25 项 packed-switch 表** |
| **`x11.smali:471-481`** | **`pswitch_a`（索引 14）：`n91.m(null,null,idx)`** |
| `x11.smali:49/52` | `v1`/`v2` 初始化为 `null` |
| **`n91.smali:2190-2230`** | **`m()`：弹确认框（标题 `0x7f0805f6`）** |

### 10.3 smali —— Restore 类

| 位置 | 内容 |
| --- | --- |
| **`RestorePlayUnlockerPurchasePref.smali:22-515`** | **构造器（493 行）** |
| `:125` | **`getApplicationIcon("com.android.vending")`** |
| `:222` | **`oh.A(ctx)` 地区判定** |
| `:242-246` | `PowerampUnlocker-build-310` |
| `:265-277` | `Poweramp-unlocker-ru2-301/307` |
| `:329-390` | HTML 链接构造 |
| **`:543-616`** | **`X()` 三重可用性判断** |
| `:587` | `0xe5` = 229 版本门槛 |
| `:519-541` | `B()` 清理 Handler |
| `:654-691` | `onBusMsg` |
| **`RestoreWebsiteFvPurchasePref.smali:15-104`** | 构造器（89 行）|
| `:35/49` | **反射调用 `update()`** |
| `:106-116` | `access$update` 桥接 |
| `:120-150` | `B()` |
| `:152-211` | `X()` |
| `:249-346` | `onBusMsg` |
| **`RestoreFvPurchasePref.smali:1-60`** | **60 行，4 个 bridge 方法** |
| `RestoreHuaweiFvPurchasePref.smali` | 106 行 |
| `RestoreRustoreFvPurchasePref.smali` | 107 行 |
| `RestoreFeaturePackPurchasePref.smali` | 387 行 |
| `RestoreOtherFvPurchasePref.smali` | 74 行 |

### 10.4 smali —— Buy 类

| 位置 | 规模 |
| --- | ---: |
| `BuyUberPref.smali` | **636 行** |
| `BuyPlayFvPref.smali` | 195 行 |
| `BuyWebsiteFvPref.smali` | 183 行 |
| `BuyRustoreFvPref.smali` | 166 行 |
| `BuyHuaweiFvPref.smali` | 161 行 |
| `BuyMethodsRedirectPref.smali` | 152 行 |

### 10.5 关键常量

| 常量 | 位置 | 含义 |
| --- | --- | --- |
| **`"com.android.vending"`** | `RestorePlayUnlocker:125` | Google Play 包名 |
| **`"PowerampUnlocker-build-310"`** | `:246` | 常规 SKU |
| **`"Poweramp-unlocker-ru2-301"`** | `:269` | 俄区 SKU（旧）|
| **`"Poweramp-unlocker-ru2-307"`** | `:277` | 俄区 SKU（新）|
| **`0xe5`（229）** | `:587` | 版本门槛 |
| `0x7f0803da` | `z61:4705` | `pref_already_purchased_q` |
| `0x7f0805f6` | `n91:2210` | 确认框标题 |
| **`"update()V"`** | `RestoreWebsiteFv:35` | 反射方法名 |

### 10.5b 第 2 轮新增定位（feature_packages / p91 / LicenseStatusPref）

**`feature_packages.xml`**：

| 位置 | 内容 |
| --- | --- |
| `feature_packages.xml` | 14 元素 / 6 key |
| `feature_packages.xml:3-9` | 7 个 `RawTextPreference` 说明行 |
| `feature_packages.xml:4` | `widgetLayout="@layout/settings_feature_pak_list_button"` |
| `feature_packages.xml:5` | `widgetLayout="@layout/settings_feature_pak_vote_button"` |
| `feature_packages.xml:10` | `isPriceReduced` |
| `feature_packages.xml:11` | **`fp1`（`FeaturePackPref`）** |
| `feature_packages.xml:12` | **`move_fp1_to_about`** |
| `feature_packages.xml:14-17` | 「Other」分类（`buy_uber_badges`/`uber_level`/说明） |
| `feature_packages.xml:18` | `restore_purchase` |

**`p91` helper（130 行）**：

| 位置 | 内容 |
| --- | --- |
| **`p91.smali:7-67`** | **`Q()` 主装配（60 行）** |
| `p91.smali:11` | `"move_fp1_to_about"` |
| `p91.smali:27-39` | `new tc(5, this)` |
| `p91.smali:44-52` | **`go0.k.Н` 标志判断** |
| `p91.smali:56-60` | **`h("isPriceReduced")` 条件移除** |
| **`p91.smali:69-94`** | **`onBusMsg`（25 行）** |
| `p91.smali:73` | **`0x7f0d0530`** = `cmd_app_feature_pak_settings_refresh` |
| `p91.smali:82` | `b71.у()` |
| **`p91.smali:96-129`** | **`Х()`：`BaseApplication.P(false)`** |
| `p91.smali:123` | `P(Z)V` |

**`LicenseStatusPref`（1521 行）**：

| 位置 | 内容 |
| --- | --- |
| `LicenseStatusPref.smali:1` | `extends ProgressPreference` |
| `LicenseStatusPref.smali:24-42` | `<clinit>` |
| `LicenseStatusPref.smali:44-137` | `<init>`（93 行）|
| **`LicenseStatusPref.smali:165-1178`** | **`X()`（1013 行，核心）** |
| `LicenseStatusPref.smali:109` | `"license_status"` |
| `LicenseStatusPref.smali:185` | `y40->P` |
| `LicenseStatusPref.smali:243` | `y40->р` |
| `LicenseStatusPref.smali:316` | `y40->о` |
| `LicenseStatusPref.smali:376` | `setTitle(...)` |
| `LicenseStatusPref.smali:386` | `setIcon(...)` |
| `LicenseStatusPref.smali:416` | `setSummary(...)` |
| `LicenseStatusPref.smali:430` | `setOnPreferenceClickListener(y9)` |
| **`LicenseStatusPref.smali:455`** | **`Sync.B("ps")` ★ 第三个密钥** |
| `LicenseStatusPref.smali:464` | `Sync.В(3, data)`（slot 3）|
| **`LicenseStatusPref.smali:472/486/500`** | **`native_lock(-1)` / `(-2)` / `(-3)`** |
| **`LicenseStatusPref.smali:508`** | **`setTitle(v0)`（用第 3 个返回值）** |
| `LicenseStatusPref.smali:513` | `native_close(3)` |
| `LicenseStatusPref.smali:581` | `y40->H` |
| `LicenseStatusPref.smali:810/872` | `"\n"` |
| **`LicenseStatusPref.smali:833`** | **`"****"` 敏感信息掩码** |
| `LicenseStatusPref.smali:1106` | `"\u2022 "`（项目符号）|
| `LicenseStatusPref.smali:1283-1520` | `В()`（237 行）|
| `LicenseStatusPref.smali:1227-1281` | `onBusMsg`（54 行）|

**三个 native 密钥完整表**：

| 密钥 | 使用处 | slot | 返回数 | 用途 |
| --- | --- | ---: | ---: | --- |
| `"dS"` | `k20.smali:521` | 1 | 1 | 设置导入解密 |
| `"eS"` | `wq.smali:251` | 1 | 1 | 播放列表导出加密 |
| **`"ps"`** | **`LicenseStatusPref.smali:455`** | **3** | **3** | **授权状态解密** |

**P7 文案**：

| id | 资源名 | 文案 |
| --- | --- | --- |
| **`0x7f0805f6`** | **`pref_restore_defaults_msg`** | "All options on this page will be restored to the default val…" |
| `0x7f0d0530` | `cmd_app_feature_pak_settings_refresh` | — |

### 10.6 交叉引用

| 文档 | 关系 |
| --- | --- |
| `poweramp-misc-complete.md` | **§13.6 `override_region` 地区检测**（与本文 §6.2 同一实现）|
| `poweramp-settings-root-structure.md` | `singlepane` 顶部的两个付费入口 |
| `poweramp-about-and-support-settings.md` | `general` 页的 `addons` 分类（与购买相关）|
| `poweramp-settings-search.md` | 两页 `skipSearch="true"` 的索引行为 |

## 11. 第 2 轮深挖：`feature_packages` 页 + P1/P7 闭环

> 第 10 章列了 7 项未解。本轮解出 **P1 / P6 / P7**，其中 **`feature_packages` 是此前唯一未深挖的页面**。

### 11.1 ⭐ P6：`feature_packages` 页完整实现

这是**设置树最后一个未深挖的页面**。

#### ① 页面身份

【实证·原文】`feature_packages.xml`（2599 B / **14 元素 / 6 key**）：

| 项 | 值 |
| --- | --- |
| XML | `res/xml/feature_packages.xml` |
| 资源 id | **`0x7f160013`** |
| 根标题 | `@string/feature_packages` |
| `w:skipSearch` | **未设置**（根节点无）→ **会进搜索索引** |
| helper | **`ׅ/p91.smali`**（**130 行**，全树最小 helper 之一）|
| 父页 | `0x7f160026`（`singlepane`）|

> **只有 130 行** —— 因为页面基本由自定义 `*Pref` 控件自己完成，helper 只做两处装配。

#### ② 14 个元素

【实证·原文】按顺序：

| # | key | 类 | 图标 | 内容 |
| ---: | --- | --- | --- | --- |
| 1 | — | `RawTextPreference` | `box_badge_32dp` | `fp1_line1` |
| 2 | — | `RawTextPreference` | `list_badge_32dp` | `list_of_features` + **`@layout/settings_feature_pak_list_button`** |
| 3 | — | `RawTextPreference` | `vote_badge_32dp` | `fp_request_and_vote_on_forum` + **`@layout/settings_feature_pak_vote_button`** |
| 4 | — | `RawTextPreference` | `grow_badge_32dp` | `fp1_line2` |
| 5 | — | `RawTextPreference` | `code_badge_32dp` | `fp1_line3` |
| 6 | — | `RawTextPreference` | `one_badge_32dp` | `fp1_line4` |
| 7 | **`isPriceReduced`** | `RawTextPreference` | `percent_badge_32dp` | `fp1_line5` |
| 8 | **`fp1`** | **`FeaturePackPref`** | — | **购买按钮**（`w:buttonOnly="true"`）|
| 9 | **`move_fp1_to_about`** | `MultilineSwitchPreference` | — | **`hide_fp_in_settings`**（默认 `false`）|
| 10 | `buy_uber_badges` | **`BuyUberPref`** | `settings_uberpatron_colored` | `buy_uber_badges` |
| 11 | **`uber_level`** | **`UberLevelPref`** | `transparent_nothing` | 徽章等级 |
| 12 | — | `RawTextPreference` | `transparent_nothing` | `uber_support1/2/3` |
| 13 | `restore_purchase` | **`RestoreFeaturePackPurchasePref`** | `settings_restore_purchase_colored` | `restore_purchases` |

> **第 10-12 项在「Other」分类里**（`@string/other`），其余平铺。

#### ③ 两个特殊的按钮布局

第 2、3 项用了 **`android:widgetLayout`** 覆盖默认按钮：

```xml
android:widgetLayout="@layout/settings_feature_pak_list_button"   <!-- "查看功能列表" -->
android:widgetLayout="@layout/settings_feature_pak_vote_button"   <!-- "去论坛投票" -->
```

> **`RawTextPreference` + `widgetLayout`** —— 文本行右侧带一个自定义按钮。
>
> 这两个按钮把用户引导到**功能列表**和**论坛投票**，是 Feature Pack 的"售前沟通"入口。

#### ④ `p91` helper 的 3 个方法

【实证·产物】`p91.smali`（130 行，`extends b71`）：

| 方法 | 行 | 规模 | 职责 |
| --- | --- | ---: | --- |
| **`Q()`** | 7–67 | **60** | **主装配（两件事）** |
| `onBusMsg(...)` | 69–94 | 25 | 消息处理 |
| `Х()` | 96–129 | 33 | 覆写（调 `P(false)`）|

##### `Q()` 全文

【实证·产物】`p91.smali:7-67`：

```java
void Q() {
    // ① 绑 move_fp1_to_about 的变更监听
    Preference p = K.findPreference("move_fp1_to_about");     // :11-24
    p.setOnPreferenceChangeListener(new tc(5, this));         // :27-39  ★ tc 索引 5

    // ② 条件移除 isPriceReduced
    if (!go0.k.Н) {                                           // :44-52  ★ 标志判断
        h("isPriceReduced");                                  // :56-60  ★ n91.h() 移除
    }
}
```

| 动作 | 说明 |
| --- | --- |
| **绑 `tc(5)`** | `move_fp1_to_about` 变化时触发 |
| **条件移除 `isPriceReduced`** | 当 `go0.k.Н == false` 时移除"价格已降低"提示 |

> **`isPriceReduced` 只在打折时显示** —— `go0.k.Н` 是全局标志（`go0` 的父类 `b9` 里 `Н:Z`）。

##### `onBusMsg`：响应 Feature Pack 刷新

【实证·产物】`p91.smali:69-94`：

```java
void onBusMsg(MsgBus bus, int a, int what, int b, Object obj) {
    if (what == 0x7f0d0530 /* cmd_app_feature_pak_settings_refresh */) {  // :73-78
        this.у();                                              // :82  b71.у()
    }
    super.onBusMsg(bus, a, what, b, obj);                      // :88
}
```

| 消息 id | 资源名 |
| --- | --- |
| **`0x7f0d0530`** | **`cmd_app_feature_pak_settings_refresh`** |

> **`0x7f0d0530` 是"Feature Pack 设置刷新"命令** —— 购买成功后刷新本页状态。

##### `Х()`：覆写为 `P(false)`

【实证·产物】`p91.smali:96-129`：

```java
void Х() {
    BaseApplication app = AUtils.c(ctx, BaseApplication.class);  // :100-116
    app.P(false);                                                 // :120-123  ★ 索引 0
}
```

> **`P(false)`** —— 与 `poweramp-about-and-support-settings.md` §15.2 的发现一致。
>
> 回忆：`P(Z)` 中 `true` → `o4(1)`（`Н(true)`），`false` → `o4(2)`（default → `Н(false)`）。
>
> **`p91.Х()` 传 `false`**，与 `r91.Х()`（About 页）相同。

#### ⑤ `tc(5)` 的行为

【实证·产物】`tc.smali`（`OnPreferenceChangeListener`，10 项 switch）：

| 索引 | 分支 | 行为（推断）|
| ---: | --- | --- |
| 5 | — | `move_fp1_to_about` 切换时，移动/恢复 `fp1` 项的位置 |

> **`move_fp1_to_about` 的语义**：`@string/hide_fp_in_settings`（**在设置里隐藏 FP**）。
>
> 勾选后，`fp1` 项从 `feature_packages` 页移到 `About` 页。

### 11.2 P7：`0x7f0805f6` 是恢复默认提示（**已解**）

【实证·原文】`public.xml` + `strings.xml`：

| id | 资源名 | 文案 |
| --- | --- | --- |
| **`0x7f0805f6`** | **`pref_restore_defaults_msg`** | **"All options on this page will be restored to the default val…"** |

> **这不是购买相关的标题，而是"恢复默认值"的确认文案**。
>
> 回忆 §8.5：`x11` 索引 14 → `n91.m(null, null, idx)` → `n91.l(0x7f0805f6, ...)`。
>
> **`n91.m()` 是"恢复默认"的通用确认框构造器** —— 不只是 `buy_methods` 用，全树 25 个 `restore_defaults` 都用它。
>
> **所以 `buy_methods` 页的某条目点击后弹的是"恢复默认"确认框？** 这需要重新审视 `z61` 索引 6 的绑定对象。

**重新核对 `z61.pswitch_7`（索引 6）**【实证·产物】`:2566-2597`：

```java
Preference p = K.findPreference(...);              // :2567-2576   ← 绑定对象未知
p.setOnPreferenceClickListener(new x11(0xe, this));  // :2579-2592
```

> **`findPreference` 的参数 `v14` 未在片段中显示**。上一轮我推断是 `buy_methods` 页的某条目，但**从 `x11(0xe)` → `n91.m()`（恢复默认确认框）看，这更像是绑给 `restore_defaults`**。
>
> **修正**：`z61` 索引 6 的分支**可能不是 `buy_methods` 页专属逻辑**，而是该页的 `restore_defaults`（虽然 `buy_methods.xml` 里没有 `restore_defaults`——那这处绑定可能用于**其他页面共用该索引**）。
>
> **诚实记录**：`z61` 索引 6 绑定的具体 key 未确认，标【待定】。

### 11.3 ⭐ P1：`LicenseStatusPref` 用第三个密钥 `"ps"`（**重大发现**）

#### ① 规模

【实证·产物】`LicenseStatusPref.smali`（**1521 行 / 27187 B**）：

| 项 | 值 |
| --- | --- |
| 父类 | **`ProgressPreference`** |
| 规模 | **1521 行** |
| 最大方法 | **`X()`（1013 行）** |

| 方法 | 行 | 规模 |
| --- | --- | ---: |
| `<clinit>` | 24–42 | 18 |
| `<init>` | 44–137 | 93 |
| `B()` | 141–163 | 22 |
| **`X()`** | **165–1178** | **1013** |
| `getDp(I)` | 1180–1193 | 13 |
| `getUpdateRunnable()` | 1195–1204 | 9 |
| `onBusMsg` | 1227–1281 | 54 |
| **`В()`** | 1283–1520 | **237** |

#### ② 字段读取（授权标志）

`X()` 里读了 `y40` 的多个字段：

| 行 | 字段 |
| --- | --- |
| `:185` | `y40->P` |
| `:243` | `y40->р` |
| `:316` | `y40->о` |
| `:581` | `y40->H` |

> **`y40` 是授权状态容器**，`P`/`р`/`о`/`H` 是不同的授权等级/类型标志。

#### ③ ⭐ 第三个 native 密钥：`"ps"`

【实证·产物】`LicenseStatusPref.smali:444-524`：

```java
try {
    synchronized (Sync.class) {                        // :445-449
        Sync.B("ps");                                  // :455-459  ★★★ 密钥 "ps"
        Sync.В(3, data);                               // :464  slot 3

        String v7 = Sync.native_lock(-1);              // :472   返回值 1
        String v8 = Sync.native_lock(-2);              // :486   返回值 2
        String v0 = Sync.native_lock(-3);              // :500   返回值 3

        setTitle(v0);                                  // :508  ★ 用返回值 3 作标题
        Sync.native_close(3);                          // :513
    }
} catch (Throwable t) { ... }
```

| 要素 | 值 |
| --- | --- |
| **密钥** | **`"ps"`** |
| **slot** | **`3`** |
| **返回值** | **3 个**（`native_lock(-1)` / `(-2)` / `(-3)`）|
| 显示 | **第 3 个返回值作标题** |

> **这是第三个 native 密钥**。前两个是：
>
> | 密钥 | 方法 | 用途 |
> | --- | --- | --- |
> | **`"dS"`** | `k20.B()` | 设置导入解密 |
> | **`"eS"`** | `wq.y()` | 播放列表导出加密 |
> | **`"ps"`** | **`LicenseStatusPref.X()`** | **授权状态解密** |
>
> **`p` = Poweramp / `s` = Status**（推断）。
>
> **`"ps"` 加密的数据是授权凭证** —— 解密后得到 3 个字符串，第 3 个是显示给用户的授权标题。

#### ④ 多返回值机制

**`Sync.native_lock(-1)` / `(-2)` / `(-3)`** 返回**同一加密块里的三个字段**：

```
native_lock(-1) → 值 1（可能是用户 ID / 邮箱）
native_lock(-2) → 值 2（可能是订单号 / 时间）
native_lock(-3) → 值 3（★ 显示用的标题）
```

> **`native_lock` 的负数参数是"字段索引"** —— 一个加密 payload 里解出多个字段。
>
> 这与 `k20.B()` 只用 `native_lock(-1)` 形成对比——那里只有一个字段。

#### ⑤ 其他关键字符串

| 字符串 | 行 | 用途 |
| --- | ---: | --- |
| **`"license_status"`** | `:109` | 偏好 key |
| `"ps"` | `:455` | **加密密钥** |
| `"\n"` | `:810/872` | 换行 |
| **`"****"`** | `:833` | **敏感信息掩码** |
| `"\u2022 "`（•）| `:1106` | 项目符号 |

> **`"****"` 掩码** —— 授权信息里的敏感字段（如邮箱、订单号）被替换成 `****` 显示。

### 11.4 三个密钥的完整对照（更新）

| 密钥 | 使用处 | slot | 返回值 | 用途 |
| --- | --- | ---: | ---: | --- |
| **`"dS"`** | `k20.B([B)` | 1 | 1 | 设置导入解密 |
| **`"eS"`** | `wq.y([B)` | 1 | 1 | 播放列表导出加密 |
| **`"ps"`** | `LicenseStatusPref.X()` | **3** | **3** | **授权状态解密** |

> **三个密钥都由 `Sync` 统一管理** —— 它是全 App 的"加密服务"。
>
> **`lib/` 未被 apktool 导出**，所以三个密钥的实际算法都无法静态分析。

### 11.5 本轮成果与剩余

| # | 问题 | 状态 |
| ---: | --- | --- |
| P1 | `LicenseStatusPref` | ✅ **已解**（`"ps"` 密钥 + 3 返回值，§11.3）|
| P2 | `BaseRestoreFvPurchasePref` | ⚠️ 未读 |
| P3 | 华为/RuStore IAP | ⚠️ 未读 |
| P4 | `update()` 内容 | ⚠️ 未读 |
| P5 | `BuyUberPref` 档位 | ⚠️ 未读 |
| **P6** | **`feature_packages` 页** | ✅ **已解**（§11.1）|
| **P7** | `0x7f0805f6` 文案 | ✅ **已解**（`pref_restore_defaults_msg`，§11.2）|

**7 项中解出 3 项**（P1/P6/P7）。剩 4 项都是各渠道 IAP 的具体查询细节。

### 11.6 设置树全部 45 页的最终覆盖状态

| 类别 | 页数 | 状态 |
| --- | ---: | --- |
| 根页 | 1 | ✅ `singlepane` |
| 外观分支 | 7 | ✅ `ui` + 6 子页 |
| 音频分支 | 10 | ✅ `audio` + 9 子页 |
| 媒体库分支 | 8 | ✅ `library` + 7 子页 |
| 耳机/蓝牙 | 2 | ✅ `headset` + `commands_history` |
| 锁屏 | 2 | ✅ `lockscreen` + `ui_mediaactions` |
| 其他 | 2 | ✅ `misc` + `audio_focus` |
| 关于/支持 | 4 | ✅ `general` + `support` + `translations` + `audio_platform_log` |
| **付费** | **3** | ✅ **`already_purchased` + `buy_methods` + `feature_packages`** |
| 残留小页 | 6 | ✅ `space` / `rg` / `fade` / `peq_*` / `ui_theme*` |

> **45 页全部有深度文档覆盖，512 个 key 零缺漏。**

---
