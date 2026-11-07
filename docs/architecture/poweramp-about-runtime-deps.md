---
doc_id: "ARCH-POWERAMP-ABOUT-RUNTIME-DEPS"
title: "Poweramp「设置 → 关于」分支的运行期依赖组件"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1035-bundle-play (versionCode 1035009)"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - "docs/architecture/poweramp-about-and-support-settings.md"
  - "docs/architecture/all-business-plugin-system.md"
  - "docs/architecture/plugin-host-design.md"
---

# Poweramp「设置 → 关于」分支的运行期依赖组件

> **本文定位**：`docs/architecture/poweramp-about-and-support-settings.md` 把「关于」页当作
> **偏好树**来分析（18 个元素、13 个 key、`r91.v()` 的 9 段）。本文不重复那项工作，而是往下推一层，
> 专门解 **4 个不属于设置树、但决定页面行为的运行期组件**：
> `SettingsLicenseActivity`（许可 WebView）、`LicenseStatusPref`（授权状态体系）、
> `updates` 三项检查更新、`addons` 四路运行期发现。
>
> **与既有文档的口径关系**：既有文档 §3.4 / §3.7 的结构性结论（`updates` 整块移除、
> `addons` 空壳 + 运行期填充、`visit_site_about` 无条件移除）经本次复核**全部成立**，本文直接引用、
> 不另作证明；本文新增的是它们**背后依赖的组件**以及**既有文档标为未解的授权语义**。

---

## 0. 一句话结论

| 专题 | 一句话结论 | 结论强度 |
| --- | --- | --- |
| **A** 许可页 | `SettingsLicenseActivity` 是**自包含的 WebView 壳**：许可全文硬编码在 `res/raw/oss.txt`（101907 B），后台线程逐行拼成一个大字符串，再 `loadDataWithBaseURL` 注入 WebView；XML 用**显式 ComponentName** 而非 `action`，因为它**没有 `intent-filter`**，且 `targetPackage` 走字符串资源以便变体复用 | 【实证·原文】+【实证·产物】 |
| **B** 授权体系 | `LicenseStatusPref` 的自删逻辑**在「关于」页永不执行**（`general.xml` 无 `w:removeAsNeeded`）；`0xe5`(229) / `0x110`(272) **不是版本号，而是授权状态机的数值档位**：`H ≥ 0x110` = 已验证、`H ≥ 0xe5` = 正式版、`H < 0xe5` = 试用版 | 【实证·产物】 |
| **C** 检查更新 | 三项**全部是死代码**：整个 `updates` 分类被无条件移除；两个开关虽仍注册进 fast-prefs 槽位表但**返回值被丢弃、无任何字段引用、全树零消费者**；`check_update` 的 key 在全树**零字符串命中** | 【实证·产物】 |
| **D** addons | 四路发现是**第三方 App 通过 Android 元数据协议自荐**，与 skin 系统**无关**（`SKIN_MAIN` 不参与 `addons`）；点任一行 = `getLaunchIntentForPackage` 拉起对方 App | 【实证·产物】 |

---

## 1. 四个组件的横向总表

| 组件 | 类型 | 产物规模 | 生命周期归属 | 是否属于设置树 |
| --- | --- | --- | --- | --- |
| `SettingsLicenseActivity` | `android.app.Activity`（独立进程内页面） | 4984 B / 246 行 | **独立 Activity**，不进 Settings Activity 栈的 helper 体系 | 否（被 `<intent>` 拉起） |
| `LicenseStatusPref` | `ProgressPreference` → `RawTextPreference` | 28707 B / 1521 行 | 偏好控件（`Preference` 子类），由设置页 inflate | **是**（但在运行期被 `setKey` 改名） |
| `check_updates` / `check_beta_updates` | `MultilineSwitchPreference` × 2 | 声明 2 行；后台注册 2 行 | 偏好控件，**所在分类运行期被删** | 是（名义上） |
| `check_update` | `ProgressPreference` | 声明 1 行 | 同上 | 是（名义上） |
| `addons` 填充逻辑 | `r91.v()` 内的 4 段 `try/catch` | `r91.smali:623-1404`（782 行） | helper 方法内联 | 否（运行期注入） |

> `res/xml/general.xml` 共 **26 行 / 2563 B**，`public.xml` 记其资源 id 为 `0x7f160014`。
> 本文引用的所有行号为 **1-based**，均以 `.rea-analysis/v1035/decoded/` 下产物为准。

---

## 2. 专题 A：`SettingsLicenseActivity`（开源许可页）

### 2.1 Activity 完整实现

文件：`smali/com/maxmpz/audioplayer/preference/SettingsLicenseActivity.smali`，**246 行 / 4984 B**
【实证·产物】`:1-13`。

| 元素 | 内容 |
| --- | --- |
| 继承 | `android.app.Activity`（**不是** `SettingsActivity`，也不是任何 Poweramp 基类） |
| 静态字段 | `public static final synthetic у:I`（空常量，编译器产物） |
| 实例字段 | `X:Handler`（主线程 Handler）、`y:WebView` |
| 方法总数 | **3 个**：`<init>`、`onCreate`、`onOptionsItemSelected` |

**没有** `onDestroy`、**没有** `onPause`、**没有** `webView.destroy()`、**没有** `saveState`。
这一点重要：WebView 生命周期完全交给系统，Activity 结束时不做回收。

#### 2.1.1 `onCreate` 逐段（`:52-201`）

```smali
# :56-64  主题：复用设置页的主题解析
invoke-static {p0}, Lcom/maxmpz/audioplayer/preference/SettingsActivity;->getThemeResId(Landroid/content/Context;)I
invoke-virtual {p0, v0}, Landroid/content/Context;->setTheme(I)V
# :69     super.onCreate(p1)
# :74-79  setTitle(0x7f080592)
# :84-92  setContentView(0x7f040051)   ← 包在 try/catch RuntimeException 里
# :97-108 getActionBar().setDisplayHomeAsUpEnabled(true)
# :113-130 findViewById(0x7f0d0278) → cast WebView → iput y
# :134-143 setWebViewClient(new ׅ/jb1())
# :148-170 Thread(new ׅ/p71(0xd, this)).start()
```

资源 id 全部落成【实证·原文】`res/values/public.xml`：

| id | 类型 | 名称 | 取值来源 |
| --- | --- | --- | --- |
| `0x7f080592` | string | `pref_open_source_licenses` | **"Open Source Licenses"**（`res/values/strings.xml:1265`） |
| `0x7f040051` | layout | `dialog_content_webview` | `public.xml:3852` |
| `0x7f0d0278` | id | `webview` | `public.xml:7554` |
| `0x7f140004` | raw | `oss` | `public.xml:11043` |

**布局只有 1 个控件**（`res/layout/dialog_content_webview.xml:1-4`，全文 4 行）：

```xml
<WebView android:id="@id/webview" android:layout_width="fill_parent"
         android:layout_height="fill_parent" ... />
```

> **布局名是 `dialog_content_webview`，却被 Activity 直接当 `setContentView` 用**——这是复用
> 对话框布局的典型做法（同一布局也被别的 WebView 对话框用）。**没有** `ActionBar` 之外的任何
> 装饰控件，也没有"加载中"占位符：许可文本加载前 WebView 是空白的。

#### 2.1.2 许可文本来源：**不是 assets，是 `res/raw`**

这是专题 A 最容易被猜错的一点。全文检索 `assets/` 下**没有**任何 licenses 相关文件
（`assets/` 只有 `milk/`、`milk_presets/`、`milk_textures/`、`cc/`、`dexopt/`、`auto_eq.db`、
`PublicSuffixDatabase.list`）；许可正文在 **`res/raw/oss.txt`**：

| 属性 | 值 |
| --- | --- |
| 文件 | `res/raw/oss.txt` |
| 大小 | **101907 B** |
| 行数 | **2039 行** |
| 格式 | **HTML**（`<!DOCTYPE html><html><head><style>pre{background:#eee;font-size:8pt}</style>...`）【实证·原文】`:1-12` |
| 结构 | `<body>` 内按厂商分块，每块 `<b>厂商名</b>` + `<pre>…许可正文…</pre>` |
| 结尾 | `</body></html>`【实证·原文】`:2038-2039` |

关键词普查（全文 `count`）：`Apache` 18、`MIT` 42、`MPL` 43、`GNU` 14、`Mozilla` 4、`Copyright` 46、
`maxmpz` 12、`License` 170、`Permission is hereby granted` 10。
首块是 AOSP（Apache 2.0 NOTICE），随后 Apache Commons、Jakarta Commons Logging、Nuance、Media Codecs 等。

> **它不是纯文本**：自带 `<style>`，说明作者是**手写 HTML** 而不是拼接许可原文。
> 也因此 `loadDataWithBaseURL` 的 mime 是 `text/html` 而非 `text/plain`。

#### 2.1.3 读取线程：`p71` 的 index `0xd`

`new Thread(new ׅ/p71(0xd, this)).start()`【实证·产物】`:148-170`。
`p71` 是巨型 `Runnable` 分发器（1232 行，24 个分支），index `0xd`=13 映射到 `:pswitch_9`
（`.packed-switch 0x0` 位于 `:1205-1229`，第 14 项）【实证·产物】`p71.smali:1205-1229`。

`pswitch_9` 本体【实证·产物】`p71.smali:500-670`：

```smali
# :518-531  读取 raw 资源
invoke-virtual {v6}, Landroid/content/Context;->getResources()...     # v6 = SettingsLicenseActivity
const v3, 0x7f140004                                                  # raw/oss
invoke-virtual {v2, v3}, Landroid/content/res/Resources;->openRawResource(I)Ljava/io/InputStream;
# :539-544  InputStreamReader → BufferedReader
# :561-590  逐行 readLine，append(行) 再 append('\n' 即 0xa)
# :593-640  异常：IOException → 空串 ""（:644）
# :649-665  Handler.post(new ׅ/x91(this, 7, html))
```

三个观察：

1. **每个资源文件的行尾被强制追加 `'\n'`**（`:579-583` 的 `const/16 v2, 0xa` + `append(C)`），
   所以原文件若有 CRLF 会变成 `\r\n\n`——HTML 里无害。
2. **失败即静默降级为空串**：`catch IOException` → `const-string v0, ""`（`:643-644`），
   随后仍会 post 一个空 HTML 给 WebView。**用户看到的是一片空白，没有任何错误提示。**
3. **线程只做 I/O，不碰 View**；真正的 WebView 操作回主线程（`Handler` 在 `<init>:26-43` 用
   `Looper.getMainLooper()` 构造）。

#### 2.1.4 `x91` index `7`：`loadDataWithBaseURL`

`x91`（2741 行，14 个分支）`.packed-switch 0x0` 在 `:2723-2738`；index `7` 映射到 `:pswitch_6`
【实证·产物】`x91.smali:2723-2738`（第 8 项：`d c b a 9 8 7 **6** 5 4 3 2 1 0`）。

`pswitch_6` 本体【实证·产物】`x91.smali:1332-1376`：

```smali
# :1345  取 SettingsLicenseActivity.y（WebView）
# :1349  String.valueOf(html)
# :1357  const-string v6, "text/html"
# :1361  const-string v7, "utf-8"
# :1365  const/4 v8, 0x0        ← historyUrl = null
# :1368  const/4 v4, 0x0        ← baseUrl    = null
# :1371  invoke-virtual/range {v3 .. v8}, Landroid/webkit/WebView;->loadDataWithBaseURL(...)
```

`baseUrl = null` 意味着页面**没有 origin**：相对链接全部失效，`localStorage`/`document.domain`
行为受限。对本文档而言结论是：**许可页是一个完全自包含、无外部依赖的离线页面**。

#### 2.1.5 链接点击：`jb1` 把 http(s) 踢到浏览器

`setWebViewClient(new ׅ/jb1())`【实证·产物】`:134-143`。`jb1` 只有 94 行、**一个方法**
`shouldOverrideUrlLoading`【实证·产物】`jb1.smali:7-93`：

```java
boolean shouldOverrideUrlLoading(WebView v, String url) {
    if (url != null) {
        if (url.startsWith("http://") || url.startsWith("https://")) {   // :15/:31
            v.getContext().startActivity(
                new Intent(Intent.ACTION_VIEW, Uri.parse(url)));          // :56-77
            return true;                                                  // :82-85
        }
    }
    return false;                                                         // :89-92
}
```

> **只拦 `http://` / `https://`**。其它 scheme（`mailto:`、`tel:`、`intent:`）落到 `return false`
> → 由 WebView 自己处理（通常是无反应）。`oss.txt` 内全是 `<pre>` 纯文本与裸 URL，
> 实际点击概率极低——这条链路更像**防御性代码**。

#### 2.1.6 失败兜底与返回键

```smali
# :89-92    :try_start_0 包住 setContentView
# :178-195  :catch_0 → Log.e("SettingsLicenseActivity", "Failed to create license WebView", e)
#                     → finish()
```

`catch` 覆盖的只有 `setContentView` 一行（`try_start_0`/`try_end_0` 紧贴），
所以 **找不到 `@id/webview` 或强转失败都不会进 catch**——只有"布局 inflate 抛 RuntimeException"
才会走 `finish()`。

返回键【实证·产物】`:203-236`：`onOptionsItemSelected` 比较 `0x102002c`
（= `android.R.id.home`）→ `finish()`；其它交给 `super`。**没有** `onBackPressed` 覆写。

### 2.2 `@string/edition_pak_name` 的实际值

【实证·原文】`res/values/strings.xml:391`：

```xml
<string name="edition_pak_name">com.maxmpz.audioplayer</string>
```

- `public.xml:4592`：`<public type="string" name="edition_pak_name" id="0x7f0801d6" />`
- **全树只有 2 处引用**：
  - `res/xml/general.xml:20`（`oss` 项，本文对象）
  - `res/xml/audio.xml:5`（`AudioInfoActivity`，同一模式）
- **`res/values-*/strings.xml` 没有任何语言覆盖**（63 个语言目录里零命中）——
  它是**包名常量**，本来就不该翻译。

> **没有 flavor 覆盖**。`apktool.yml` 只有 `sdkInfo`（minSdk 21 / targetSdk 36），不含 flavor 信息；
> 该 build 的包名与 `AndroidManifest.xml:2` 的 `package="com.maxmpz.audioplayer"` 一致。
> 也就是说 **`targetPackage` 与 `targetClass` 拼出的 ComponentName 正好指回自己这个包**
> ——见下节。

### 2.3 为什么用 `targetPackage` + `targetClass` 而不是 `action`

这是专题 A 的核心设计问题。先摆事实：

| 事实 | 证据 |
| --- | --- |
| `oss` 的 `<intent>` **只有** `targetPackage` + `targetClass`，**无 `android:action`、无 `data`、无 `category`** | 【实证·原文】`res/xml/general.xml:19-21` |
| `SettingsLicenseActivity` 在 Manifest 里**只有一行**、**自闭合**、**无 `<intent-filter>`** | 【实证·原文】`AndroidManifest.xml:539` |
| 该声明的属性集：`configChanges`、`label`、`name`、`theme` —— **无 `exported`、无 `taskAffinity`、无 `launchMode`** | 同上 |
| `targetPackage` 用**字符串资源**而非字面量 | 【实证·原文】`general.xml:20` |
| App 代码**从不重绑**这个 intent：全树 `Preference;->getIntent()` 只有 1 次调用（在无关的 `EditButtonsRedirPref` 里） | 【实证·产物】`EditButtonsRedirPref.smali:220` |

由此得到的解释（分三层，强度递减）：

**第 1 层（决定性，实证）：没有 `intent-filter` ⇒ `action` 方案在本工程内不可行。**
`AndroidManifest.xml:539` 是自闭合标签，不存在任何 `<intent-filter>`。没有 `intent-filter`
就没有可被隐式 `action` 匹配的入口。若改写成 `<intent android:action="…">`，
`startActivity` 会抛 `ActivityNotFoundException`。**所以显式 ComponentName 不是"风格选择"，
而是唯一能工作的写法。**

**第 2 层（实证+推断）：`targetPackage` 之所以走字符串资源，是为了让 XML 变体无关。**
两个使用点（`general.xml:20`、`audio.xml:5`）都写成 `@string/edition_pak_name` 而非
`com.maxmpz.audioplayer`。同一个 `general.xml` 模板被多个发行变体复用（`bundle-play`/
`bundle-huawei`/`uni` 等），包名不同；写成资源后**只需覆盖一个字符串**即可整体迁移，
不必改 62 个设置 XML 里的每一条 `<intent>`【推断】。这也是 `public.xml` 把它当**公开资源**
（`<public>` 标签）保留的动机——公开资源才允许被别的模块/变体安全覆盖。

**第 3 层（推断）：`targetPackage` 指回自身 ⇒ 这是一次"包内显式跳转"，`exported` 语义不参与。**
因为 `edition_pak_name` 的实际值 = 本 App 包名，`setClassName("com.maxmpz.audioplayer", "…SettingsLicenseActivity")`
在同一个 UID/包内解析。targetSdk 36 下"无 `intent-filter` ⇒ `exported` 默认 `false`"，
但 `exported=false` **只限制外部 App**，包内拉起不受影响。**这解释了为什么 Manifest 里
既不需要 `exported="true"`，也不会有 `SecurityException`。**

> **反过来说**：如果哪天 `oss` 想指向**别的包**的许可页（把 `edition_pak_name` 覆盖成第三方包名），
> 这条链路会立刻因 `exported=false` 而崩。当前设计**隐含假设"自己包内自己解析"**。

补充一个被排除的可能：`<intent>` 是 **framework 的 `<Preference>` 子标签**，由
`android.preference.PreferenceInflater` 解析，**不是 App 代码**。证据：本 build 的
`smali/android/` 只有 `support/` 与 `view/` 两个子包，**没有 `android/preference/` 覆写**
【实证·产物】。所以"为什么这样写"的答案不可能是"Poweramp 自己解析"——
它就是直接用 AOSP 的 `PreferenceInflater` 语义。

### 2.4 Manifest 注册全貌

【实证·原文】`AndroidManifest.xml:539`（全文一行，无子元素）：

```xml
<activity
    android:configChanges="keyboardHidden|orientation|screenSize"
    android:label="@string/pref_open_source_licenses"
    android:name="com.maxmpz.audioplayer.preference.SettingsLicenseActivity"
    android:theme="@style/ActivityTheme_Settings" />
```

| 属性 | 值 | 说明 |
| --- | --- | --- |
| `exported` | **未声明** | targetSdk 36 + 无 `intent-filter` ⇒ **运行时为 `false`**（包内跳转不受影响，见 §2.3 第 3 层） |
| `taskAffinity` | **未声明** | 跟随 `<application>` 默认 affinity ⇒ **与设置页同一 task**，返回栈连续 |
| `launchMode` | **未声明** | 默认 `standard` ⇒ 每次点击都新建实例（但 `oss` 已被 `r91` 换页后仍可反复进入） |
| `theme` | `@style/ActivityTheme_Settings` | `0x7f0e02dc`【实证·原文】`public.xml:9316` |
| `label` | `@string/pref_open_source_licenses` | **与偏好项标题同一字符串**（"Open Source Licenses"） |
| `configChanges` | `keyboardHidden\|orientation\|screenSize` | 旋转/键盘不重建 ⇒ **WebView 不会因旋转重新加载** |

**主题被二次覆盖**：`onCreate` 第一件事就是 `setTheme(SettingsActivity.getThemeResId(ctx))`
【实证·产物】`:56-64`。`getThemeResId`【实证·产物】`SettingsActivity.smali:146-…` 读
`vr->K0`（`z20` int，即主题模式偏好）并映射到 3 个主题资源：
`0x7f0e02de`（`ActivityTheme_SettingsDark`）/ `0x7f0e02dc`（`Settings`）/ `0x7f0e02dd`（`SettingsLight`）。
**所以 Manifest 里的 `theme` 只是"首帧占位"，真正的明暗由 `vr->K0` 决定**——
这保证了许可页与设置页**主题严格同步**，不会出现"设置页深色、许可页浅色"的闪白。

> 旁证一处**未被使用的资源**：`attr/dialog_SettingsLicenseActivity`（`0x7f010642`，
> `attrs.xml:1924` / `public.xml:1605`）**全树零消费**（既无 `<item>` 赋值，也无代码读取）。
> 这是"许可页作为 `Dialog` 风格的 Activity"的**声明残留**，与该 Activity 实际用
> `@style/ActivityTheme_Settings` 相矛盾——列入 §7 未解。

### 2.5 A 专题小结（可移植结论）

| 结论 | 依据 |
| --- | --- |
| 许可页 = **零网络、零 assets、纯本地 raw HTML** | `res/raw/oss.txt` + `loadDataWithBaseURL(baseUrl=null)` |
| 加载路径 **Thread → Handler → WebView**，I/O 与 UI 严格分离 | `p71:0xd` / `x91:7` |
| 失败静默为空页（**无 toast、无重试**） | `p71.smali:643-644` |
| 外部链接交系统浏览器，**仅 http/https** | `jb1.smali:7-93` |
| 显式 ComponentName 是**被迫**选择（无 `intent-filter`） | `AndroidManifest.xml:539` |
| 主题由 `vr->K0` 二次决定，Manifest theme 仅占位 | `SettingsLicenseActivity.smali:56-64` |

---

## 3. 专题 B：`LicenseStatusPref` 与授权状态体系

文件：`smali/com/maxmpz/audioplayer/preference/LicenseStatusPref.smali`，**1521 行 / 28707 B**。

```smali
# :1-21
.class public final Lcom/maxmpz/audioplayer/preference/LicenseStatusPref;
.super Lcom/maxmpz/audioplayer/preference/ProgressPreference;   # ← 显示"旋转进度条"能力
.implements Lcom/maxmpz/widget/MsgBusSubscriber;
.field public static final Companion:Lׅ/d60;
.field public static l:Z          # 静态"已排过延迟任务"闸门
.field public final i:Landroid/os/Handler;
.field public final j:Z           # ← ★ styleable removeAsNeeded
.field public final k:Lׅ/c60;    # ← 延迟 Runnable
```

### 3.1 `w:removeAsNeeded` 的自删条件

#### 3.1.1 属性怎么进到 `j` 字段

构造函数【实证·产物】`:44-137`：

```smali
# :48-51   super(p1, p2, /*Z*/ true)   → ProgressPreference(Context, AttributeSet, true)
# :77      sget-object v1, Lׅ/qt0;->r0:[I            ← styleable 数组
# :84      obtainStyledAttributes(p1, p2, r0, 0, 0)
# :92      invoke-virtual {p1, v2, v2}, TypedArray;->getBoolean(IZ)Z   ← index 0, 默认 false
# :100     iput-boolean p2, p0, LicenseStatusPref;->j:Z
# :109-113 setKey("license_status")                  ← ★ 运行期 key，XML 里无 key
# :123-132 k = new ׅ/c60(this, 0)
```

`qt0->r0` 的内容【实证·产物】`qt0.smali:1883-1908`：

```smali
const/16 v0, 0x25          # 37 —— 上一条数组的长度（此处无关）
new-array v0, v0, [I
fill-array-data v0, :array_28
sput-object v0, Lׅ/qt0;->q0:[I
filled-new-array {v7}, [I  # v7 在第 9 步已被赋为 0x7f010c55
move-result-object v0
sput-object v0, Lׅ/qt0;->r0:[I   ← 单元素数组
```

`v7` 的来源在同文件 `:1073`：`const v7, 0x7f010c55`
→【实证·原文】`public.xml:2506` = **`attr/removeAsNeeded`**（`attrs.xml:2931` 声明为 `boolean`）。

> **所以 `LicenseStatusPref` 的 styleable 是"只有一个属性"的数组**，
> **索引 0 = `removeAsNeeded`**。既有文档提到的 `у->q` 索引 1 / `у->n0` 索引 0 属于
> **旧命名（类 `qt0` 曾叫 `у`）且是 `RawTextPreference` 的 styleable**；
> 本 build 里 `RawTextPreference` 用的是 `qt0->q0`（`RawTextPreference.smali:193`），
> 而 `LicenseStatusPref` 用 `qt0->r0`。**两者索引空间不同，不能混用。**
> 另外 `BuyPrefBase` 用 `qt0->u`（`BuyPrefBase.smali:115`），与 `removeAsNeeded` 无关。

#### 3.1.2 自删发生在 `В()`（**不是** `B()`）

`B()`【实证·产物】`:141-163` 只清 Handler 队列然后 `super.B()`，**没有删除逻辑**。
真正逻辑在 `В()`【实证·产物】`:1283-1520`（238 行）。逐行拆解：

```smali
# :1287-1294  ① 门槛：removeAsNeeded 为 false 就走"不删"分支
iget-boolean v0, p0, LicenseStatusPref;->j:Z
if-eqz v0, :cond_5                       # cond_5(:1443) = 保留

# :1298-1302  ② 取 y40->O（String，"luae" 许可键原文）
sget-object v0, Lׅ/y40;->O:Lׅ/mf1;
iget-object v0, v0, Lׅ/nf1;->А:Ljava/lang/String;

# :1306-1350  ③ 取 y40->P（int，"p" 到期时间戳，秒）并判断"未过期"
sget-object v2, Lׅ/y40;->P:Lׅ/z20;
iget v2, v2, Lׅ/a30;->А:I
if-lez v2, :cond_0                       # P <= 0 → 未过期标记 v2 = 0
int-to-long v2, v2
invoke-static {}, Ljava/lang/System;->currentTimeMillis()J
const/16 v6, 0x3e8
div-long/2addr v4, v6                    # now/1000
cmp-long v6, v2, v4
if-lez v6, :cond_0                       # P > now → v2 = 1（仍在有效期内）
const/4 v2, 0x1

# :1358-1374  ④ y40->H >= 0x110 → 直接删
sget-object v3, Lׅ/y40;->H:Lׅ/z20;
iget v4, v3, Lׅ/a30;->А:I
const/16 v5, 0x110
if-lt v4, v5, :cond_1
goto :goto_1                             # :1421 → removePreference(:1434)

# :1377-1417  ⑤ 三个"保留"豁免
:cond_1  if-nez v2, :cond_5              # 仍在有效期内 → 保留
         if-eqz v0, :cond_2              # 许可键为空 → 跳过
             invoke-virtual {v0}, String;->length()I
             if-nez v0, :cond_5          # 许可键非空 → 保留
:cond_2  iget v0, v3, Lׅ/a30;->А:I       # 再取 H
         const/4 v2, 0x2
         if-eq v0, v2, :cond_5           # H == 2 → 保留
         const/4 v2, 0x3
         if-ne v0, v2, :cond_3
         goto :goto_2                    # H == 3 → 保留（:1444）
         :goto_1
         # :1422-1439 删除
         invoke-virtual {p0}, PrefBase;->getParentGroup()Landroid/preference/PreferenceGroup;
         if-eqz v0, :cond_4
         invoke-virtual {v0, p0}, PreferenceGroup;->removePreference(Landroid/preference/Preference;)Z
         return-void
```

**自删条件的形式化表达**（`removeAsNeeded == true` 前提下）：

```
删除  ⟺  (H ≥ 0x110)
        ∨  ¬( P > 0 ∧ P > now/1000 )
           ∧ ¬( |О| > 0 )
           ∧ H ∉ {2, 3}
```

即：**"已验证"或（"无有效期满"且"无许可键"且"H 不在 2/3"）→ 删除**。

#### 3.1.3 ★ 作用域限定：这套逻辑在「关于」页**永不执行**

【实证·原文】`res/xml/general.xml:6`：

```xml
<com.maxmpz.audioplayer.preference.LicenseStatusPref w:skipSearch="true" />
```

**没有 `w:removeAsNeeded`**——全文件（26 行）`grep` 结果为零命中【实证·产物】。
因此 `j = getBoolean(0, false) = false` ⇒ `В()` 第一行 `:1287-1294` 直接跳 `cond_5`
⇒ **`super.В()` 返回，删除分支不可达**。

**该属性只在 `singlepane.xml` 出现**，出现它的 7 个元素【实证·原文】`res/xml/singlepane.xml`：

| 行 | 元素 | key |
| ---: | --- | --- |
| 6 | `LicenseStatusPref` | *（无 key）* |
| 7 | `BuyPlayFvPref` | `buy_play_fv` |
| 8 | `BuyRustoreFvPref` | `buy_rustore_fv` |
| 9 | `BuyHuaweiFvPref` | `buy_huawei_fv` |
| 10 | `FeaturePackPref` | `fp1` |
| 11 | `AlreadyPurchasedRedirectPref` | `already_purchased` |
| 12 | `FeaturePackRedirectPref` | `feature_packages` |

> **结论必须分两个实例写**：
> - **`general.xml:6` 的实例**（「关于」页）：`removeAsNeeded=false` ⇒ **恒定可见**，不会因授权有效而消失。
> - **`singlepane.xml:6` 的实例**（购买页）：`removeAsNeeded=true` ⇒ 按 §3.1.2 的公式自删。
>
> 这一点修正了"授权有效时该行被移除"在「关于」页的适用性——那个行为属于**购买页实例**。

#### 3.1.4 `В()` 的后半段：延迟刷新（与自删无关但同方法）

保留分支 `:1443-1519`：

```smali
:cond_5  :goto_2
# :1445   super.В()
# :1450-1462  若 H >= 0xe5 → 跳过下面的延迟机制
sget-object v0, Lׅ/y40;->H:Lׅ/z20;
iget v0, v0, Lׅ/a30;->А:I
const/16 v2, 0xe5
if-lt v0, v2, :cond_6          # H >= 0xe5 → goto_3 → 直接 X()
# :1469-1507  否则（H < 0xe5，即"未授权/试用"）：只跑一次
sget-boolean v0, LicenseStatusPref;->l:Z
if-nez v0, :cond_7
const/4 v1, 0x1
sput-boolean v1, LicenseStatusPref;->l:Z          # 全局一次性闸门
invoke-virtual {p0, v1}, ProgressPreference;->setProgress(Z)V        # 开转
new-instance v0, Lׅ/c60;
invoke-direct {v0, p0, v1}, Lׅ/c60;-><init>(...)  # index 1
const-wide/16 v1, 0x3e8
invoke-virtual {v3, v0, v1, v2}, Handler;->postDelayed(J)Z           # 1000ms
# :1514  X()   ← ★ 无论如何都刷新一次
```

`c60`（88 行 Runnable）【实证·产物】`c60.smali:38-86`：

| index | 行为 | 行号 |
| ---: | --- | --- |
| `0` | `setProgress(false)`（关转） | `:55-62` |
| `1` | `X()`（重绘） | `:71-75` |

> **机制解读**：`H < 0xe5`（试用/未授权）时，页面**先转 1 秒再刷新一次**——
> 这是"等待一次校验结果"的视觉补偿；`static l` 保证**整个进程只转一次**，
> 之后进设置页不再转。`H >= 0xe5`（已正式授权）则**完全不转**。

### 3.2 它读取的授权字段：`y40` 与 `ac` 的完整映射

`LicenseStatusPref` 全部 9 处 `y40` 引用（含精确码位）【实证·产物】：

| 行 | 字段 | 码位 | 类型 | 用途 |
| ---: | --- | --- | --- | --- |
| `:185` | `P` | U+0050 LATIN `P` | `z20` (int) | 到期时间戳（秒）→ 判"是否过期" |
| `:243` | `р` | U+0440 CYRILLIC `р` | `ec` (bool) | `"pi"` 开关 |
| `:316` | `о` | U+043E CYRILLIC `о` | `mf1` (String) | `"em"` |
| `:581` | `H` | U+0048 LATIN `H` | `z20` (int) | **授权状态主字段** |
| `:605` | `Р` | U+0420 CYRILLIC `Р` | `z20` (int) | **发行渠道枚举** |
| `:763` | `О` | U+041E CYRILLIC `О` | `mf1` (String) | **许可键原文（掩码显示）** |
| `:1306` | `P` | U+0050 LATIN `P` | `z20` | 同 `:185`，`В()` 里再判一次 |
| `:1358` | `H` | U+0048 LATIN `H` | `z20` | 自删门限 `0x110` |
| `:1450` | `H` | U+0048 LATIN `H` | `z20` | 延迟刷新门限 `0xe5` |

#### 3.2.1 持久化键名（决定性证据）

`ׅ/ac.smali` 是授权 prefs 的**加载器**（SharedPreferences 文件名 `"l"`，见 `:197`）
【实证·产物】`:212-403`：

| 行 | SharedPreferences key | 类型 | 默认值 | → `y40` 字段 |
| ---: | --- | --- | --- | --- |
| `:212-231` | `es` | String | `null` | `y40->O` |
| `:236-252` | `em` | String | `null` | `y40->о` |
| `:257-273` | `hide_verified` | boolean | `false` | `y40->o` |
| `:278-294` | `s` | int | `0` | **`y40->Р`** |
| `:299-319` | `r` | int | **`0x80000000`** | **`y40->H`** |
| `:324-340` | `p` | int | `0` | **`y40->P`** |
| `:345-361` | `pi` | boolean | `false` | `y40->р` |
| `:366-382` | `ae` | String | `null` | `y40->p` |
| `:387-403` | `luae` | String | `null` | **`y40->О`** |

> **`H` 的默认值是 `0x80000000`（`Integer.MIN_VALUE`）而不是 0**——这是一个**哨兵值**：
> 未写过授权状态时 `H` 为负，任何 `H >= 0xe5` / `H >= 0x110` 判断都为假，自然落进"试用"分支。
> 这解释了为什么用 `0xe5`(229) 这种看着奇怪的阈值：**它只需要"高于 0 且远低于 0x80000000 的绝对值"**，
> 真正的语义由**写入方**定义（见 §3.3）。

### 3.3 `0xe5`(229) / `0x110`(272) 到底是什么

**决定性证据在 `ׅ/uu0.smali`**——它把 `H` 翻译成**人类可读的授权档位字符串**
（方法是 `:9311` 的 `public static К(Context, StringBuilder, boolean)`，
`:9420-9518` 是 `H` 的翻译段）【实证·产物】：

```smali
:9420  const/16 v8, 0xe5                     # 阈值 229
:9428  sget-object v7, Lׅ/y40;->H:Lׅ/z20;
:9432  iget v9, v7, Lׅ/a30;->А:I
:9436  if-lt v9, v8, :cond_3                 # H >= 0xe5 ? 走"full" : 走"trial"

# —— H >= 0xe5 分支 ——
:9444  const-string v10, "full"
:9448  new StringBuilder("full")
:9457  const/16 v10, 0x110
:9461  if-ne v7, v10, :cond_1                # H == 0x110 (272) ?
:9465  const-string v7, " verified"
:9469  append(" verified")                   →  "full verified"

:9478  const/16 v10, 0x111
:9482  if-ne v7, v10, :cond_2                # H == 0x111 (273) ?
:9486  const-string v7, " verified cached"
:9490  append(" verified cached")            →  "full verified cached"

# —— 其它 ——
:9497  toString()                            →  "full"
:9508  :cond_3  const-string v7, "trial"     # H < 0xe5  →  "trial"
:9517  :cond_4  const-string v7, "null"      # context == null
```

**这直接给出了 `H` 的语义**（【实证·产物】，不是推断）：

| `H` 的值域 | 语义 | 佐证 |
| --- | --- | --- |
| `H == 0x80000000`（默认） | 从未授权 | `ac.smali:307` 默认值 |
| `0 ≤ H < 0xe5` | **`"trial"`（试用版）** | `uu0.smali:9508-9513` |
| `H == 2` / `H == 3` | 试用子态（保留行） | `LicenseStatusPref.smali:1399-1417` |
| `0xe5 ≤ H < 0x110` | **`"full"`（正式版）** | `uu0.smali:9444-9511` |
| `H == 0x110` (272) | **`"full verified"`（已验证）** | `uu0.smali:9457-9474` |
| `H == 0x111` (273) | **`"full verified cached"`（已验证·缓存）** | `uu0.smali:9478-9495` |
| `H > 0x111` | `"full"`（不再加后缀） | 两个 `if-ne` 均不匹配 |

**这两个常量的真实职责**：

| 常量 | 出现点 | 职责 |
| --- | --- | --- |
| `0xe5` (229) | 全树 **21 个文件**、26 处 `if-lt`/`if-gt` | **"正式版 vs 试用版"总开关**。样式/功能分级的总闸门 |
| `0x110` (272) | `LicenseStatusPref:1366`、`c20:169`、`ua1:111`、`b6:1807`、`uu0:9457` | **"已验证"子档位**。用于隐藏授权状态行、跳过校验 |

> **`0xe5` 不是"版本号"**——它不与任何 `versionCode`/`versionName`/`build` 标识关联。
> 它是授权状态整数的一个**枚举边界**。同一批 `if-lt ... 0xe5` 用法出现在
> `BaseBuyFvPref:184`、`FeaturePackPref:139`、`WelcomeActivity:96`、`AlreadyPurchasedRedirectPref:152`
> 等**全部购买/授权相关类**，以及 `BaseApplication:1174`——**没有一处在版本检查代码里**。
> 这是"授权档位而非版本"最有力的横向证据。

### 3.4 `Р`：发行渠道枚举（本专题的意外收获）

`X()`【实证·产物】`:605-722` 读 `y40->Р` 并按值选字符串，全部落成【实证·原文】
`res/values/strings.xml`：

| `Р` 值 | 资源 id | 字符串 | 代码行 |
| ---: | --- | --- | --- |
| `1` | `0x7f080253` | **"Google Play"** | `:618` → `cond_c` `:725-731` |
| `2` | `0x7f080466` | **"Poweramp website"** | `:622` → `cond_b` `:708-719` |
| `7` | `0x7f080297` | **"Huawei AppGallery"** | `:629` → `cond_a` `:691-702` |
| `8` | `0x7f0807e0` | **"RuStore"** | `:637` → `cond_9` `:674-685` |
| `9` | `0x7f080253` | **"Google Play"**（复用） | `:645` → `cond_8` `:658-671` |
| 其它 | — | `null`（不显示渠道名） | `:647-655` |

> **注意 `Р` 与 `H` 是两个独立维度**：`H` = 授权档位，`Р` = 渠道来源。
> `1` 和 `9` 都映射到 "Google Play" 说明渠道枚举里 Play 有两个子值（很可能是
> "Play 内购" vs "Play 恢复"，但**具体区分未解**，见 §7-Q4）。

### 3.5 `BuyPrefBase` / `FeaturePackPref` 共用的 `removeAsNeeded` styleable

| 类 | styleable 数组 | 索引 0 含义 | 证据 |
| --- | --- | --- | --- |
| `LicenseStatusPref` | `qt0->r0`（**单元素**） | `removeAsNeeded` | `LicenseStatusPref.smali:77-100` + `qt0.smali:1883-1908` |
| `FeaturePackRedirectPref` | `qt0->r0`（同一数组） | `removeAsNeeded` | `FeaturePackRedirectPref.smali:45` |
| `RawTextPreference`（基类） | `qt0->q0`（**37 元素**） | 非 `removeAsNeeded` | `RawTextPreference.smali:193` |
| `BuyPrefBase`（基类） | `qt0->u` | 非 `removeAsNeeded` | `BuyPrefBase.smali:115` |

**结论**：`removeAsNeeded` 这一属性**只有两个类真正读它**——
`LicenseStatusPref` 与 `FeaturePackRedirectPref`，二者共用 `qt0->r0`。
`BuyPrefBase` 及其 4 个子类（`BuyPlayFvPref` / `BuyRustoreFvPref` / `BuyHuaweiFvPref` /
`BuyWebsiteFvPref`）**不读 `removeAsNeeded`**；它们的"自删"由**位掩码 + `X()`** 实现（§3.6）。

> 这与「四页共用该 styleable」的直觉不同：**同一个 XML 属性、两套完全不同的实现机制**。

### 3.6 `wr->w0` 位掩码的位含义

#### 3.6.1 位掩码的载体

`wr->w0` 是一个 `z20`（int fast-pref）【实证·产物】`wr.smali:1749`：

```smali
:1722  invoke-virtual {v5}, Lׅ/ms;->Н()Lׅ/z20;    ← 创建一个 int fast-pref
:1727  move-result-object v1
:1730  invoke-virtual {v10}, Ljava/util/ArrayList;->size()I
:1738  sub-int/2addr v3, v0
:1741  const/16 v7, 0x4c                      ← 期望槽位号 76
:1745  if-ne v7, v3, :cond_2
:1749  sput-object v1, Lׅ/wr;->w0:Lׅ/z20;    ← 强绑槽位 76
:1753  const-string v1, "move_fp1_to_about"   ← 紧邻的另一个 key（无关，是 pb1）
```

> **`wr->w0` 是"无 key 字符串"的按槽位分配 int**：`ms.Н()` 不接收 key，
> 值靠 `ArrayList::size()` 的**位置**固定为第 76 项（`0x4c`）。
> 若槽位错位，同文件 `:312-373` 会抛 `AssertionError("bad slot=11 expecting=… in FastStaticPrefs=…")`。
> 同类断言在 `vr.smali` 有 4 处（`:2565`=0x83、`:2621`=0x86、`:2903`=0x96、`:3558`=0xbb）。
> **这是"无 key → 靠位置找值"的代价：任何新增/删减槽位都会触发断言。**

#### 3.6.2 四个 `getHide_pref()` 实现 + 一个"内联到 `X()`"的特例

**先纠正一个易错点**：`FeaturePackPref` **不实现 `getHide_pref()`**
（该类全文 `getHide_pref` / `setHide_pref` 零命中【实证·产物】），
它把位判断**直接内联进 `X()`**（`:97-169`）。其余 4 个类才走 `getHide_pref()`。

| 类 | 掩码 | 行号 | 所在方法 | 完整条件 |
| --- | --- | --- | --- | --- |
| `BuyPlayFvPref` | `0x2` | `:107-138` | `getHide_pref()` | `(w0 & 0x2) != 0` |
| `BuyHuaweiFvPref` | `0x4` | `:73-104` | `getHide_pref()` | `(w0 & 0x4) != 0` |
| `BuyRustoreFvPref` | `0x4` | `:78-109` | `getHide_pref()` | `(w0 & 0x4) != 0` |
| `BuyWebsiteFvPref` | `0x8` | `:72-103` | `getHide_pref()` | `(w0 & 0x8) != 0` |
| `FeaturePackPref` | `0x1` | `:97-169` | **`X()`（内联）** | `v && ((w0 & 0x1) != 0 \|\| ¬(H >= 0xe5 ∧ x0))` |

> **为什么这个区别重要**：`getHide_pref()` 的返回是"**是否隐藏**"，由基类
> `BaseBuyFvPref.X()` 在 `:261` 处**取反后参与**判断（`:269` `if-nez v4, :cond_3`）；
> 而 `FeaturePackPref.X()` 直接把最终结论 `return` 出去，
> 由 `BuyPrefBase.В():1175` 消费。**两条路径的语义等价，但插值位置不同**——
> 读 `FeaturePackPref` 时如果去找 `getHide_pref()` 会一无所获。

`Buy*FvPref` 的写回与读回严格对称【实证·产物】：

```smali
# 读（BuyHuaweiFvPref.smali:73-104）
sget-object v0, Lׅ/wr;->w0:Lׅ/z20;
iget v0, v0, Lׅ/a30;->А:I
and-int/lit8 v0, v0, 0x4          # 0x4
if-eqz v0, :cond_0 → true / false

# 写（BuyHuaweiFvPref.smali:138-159）
sget-object p1, Lׅ/wr;->w0:Lׅ/z20;
iget v0, p1, Lׅ/a30;->А:I
or-int/lit8 v0, v0, 0x4           # 只置位，不清位
invoke-virtual {p1, v0}, Lׅ/a30;->у(I)V
```

> **`setHide_pref` 只做 `or`，从不清零**——一旦某位被置上就**永不复位**（除非整体重置 prefs）。

**位含义（能定的部分）**：

| 位 | 消费者 | 语义（**由命名反推**） | 强度 |
| ---: | --- | --- | --- |
| `0x1` | `FeaturePackPref`（`X()` 内联） | 隐藏 Feature Pack 行 | 【推断】（`getHide_pref` 语义直译） |
| `0x2` | `BuyPlayFvPref` | 隐藏 Google Play 内购行 | 【推断】 |
| `0x4` | `BuyHuaweiFvPref` **和** `BuyRustoreFvPref` **共用** | 隐藏"非 Play 商店"行 | 【推断】（**两位同码是硬事实**，语义只能推到"共用一类商店"） |
| `0x8` | `BuyWebsiteFvPref` | 隐藏官网购买行 | 【推断】 |

> **`0x4` 被两个类共用**是本节最有价值的实测发现：`BuyHuaweiFvPref` 与 `BuyRustoreFvPref`
> 的 `getHide_pref()` **逐行相同**（`and-int/lit8 v0, v0, 0x4`）。
> 也就是说**掩码不是"一个类一位"，而是"一类商店一位"**（Play / 华为+RuStore / 官网）。
> 谁在写这些位**未找到**（全树无 `setHide_pref` 调用点），列入 §7-Q5。

**`FeaturePackPref` 的条件优先级必须澄清**（既有文档摘要易读错）【实证·产物】`:99-169`：

```smali
:101  iget-boolean v0, BuyPrefBase;->v:Z          # v = 可否购买
:105  if-eqz v0, :cond_2 → return false           # 不可购买 → 永不隐藏
:109  sget-object v0, wr->w0; iget v0 = w0
:117  const/4 v1, 0x1
:120  and-int/2addr v0, v1                        # w0 & 0x1
:123  if-eqz v0, :cond_0 → goto_0 → return true   # 位 1 置位 → 隐藏
:131  sget-object v0, y40->H; iget v0 = H
:139  const/16 v2, 0xe5
:143  if-lt v0, v2, :cond_1                       # H >= 0xe5 → 检查 x0
:147  sget-object v0, wr->x0:Lׅ/pb1; iget-boolean v0
:155  if-eqz v0, :cond_2 → return false           # H>=0xe5 且 x0 为 true → 不隐藏
:160  :goto_0  return v1 (true)                   # 否则隐藏
```

形式化：`hide = v ∧ ( (w0 & 0x1) ∨ ¬(H ≥ 0xe5 ∧ x0) )`
—— 即 **H ≥ 0xe5（正式版）且 `move_fp1_to_about` 为 true 时，`fp1` 行不隐藏**。

### 3.7 `BuyHuaweiFvPref.X()` 恒 `true` —— 核实结果

【实证·产物】`BuyHuaweiFvPref.smali:48-56`：

```smali
.method public final X()Z
    .locals 1
    .line 1
    const/4 v0, 0x1
    .line 2
    return v0
.end method
```

**完全确认：恒 `true`，无任何分支。** 对比 `BuyPlayFvPref.X()`【实证·产物】`:49-90`：

```smali
invoke-super {p0}, BaseBuyFvPref;->X()Z
move-result v0
if-nez v0, :cond_1          # super 已 true → 直接 true
iget-boolean v0, BuyPrefBase;->v:Z
if-eqz v0, :cond_0          # v 分支（:73-77 有个空 getContext 调用）
const/4 v0, 0x0
return v0
:cond_1  const/4 v0, 0x1
return v0
```

#### 3.7.1 `X()` 的调用点：**只有 `BuyPrefBase.В()`**

【实证·产物】`BuyPrefBase.smali:1163-1214`：

```smali
.method public final В()V
# :1167  invoke-virtual {p0}, BuyPrefBase;->X()Z
# :1175  if-eqz v0, :cond_0
# :1179      invoke-virtual {p0}, PrefBase;->removePreference()V   ← ★ 自删
# :1184      return-void
# :1187  :cond_0  invoke-super {p0}, PrefBase;->В()V
# :1196  const/4 v0, 0x1; iput-boolean v0, BuyPrefBase;->k:Z
# :1204  invoke-virtual {v0}, Lׅ/b9;->x()V
# :1209  invoke-virtual {p0}, BuyPrefBase;->update()V
```

> **`X()` 为 true ⇒ 该偏好行被 `removePreference()` 直接从父组里摘掉。**
> 因此 `BuyHuaweiFvPref` **在它被 inflate 的每一个页面上都必然立刻消失**。

#### 3.7.2 `uni` 包"恒被移除"的准确表述

需要**收窄**这个说法，因为它在两个页面上效果不同：

| 场景 | 结果 | 理由 |
| --- | --- | --- |
| `singlepane.xml:9` 的实例 | **必然被移除** | `X()` 恒 true → `В()` → `removePreference()` |
| 任何未来新增的 `buy_huawei_fv` 实例 | **必然被移除** | 同上，与渠道/品牌/SDK 全无关 |
| `general.xml`（「关于」页） | **无该元素** | 「关于」页只声明 `feature_packages`（`FeaturePackRedirectPref`），**不是** `BuyHuaweiFvPref` |

所以准确说法是：**`BuyHuaweiFvPref` 这一类实例在 `В()` 阶段无条件是自删的**；
它**不会**出现在「关于」页，因为「关于」页根本没有这个元素。
把 `X()` 恒 true 解释成"uni 包被移除"是**倒因为果**——它**对所有变体都恒为 true**，
不区分 `uni`/`play`/`huawei`。真正的变体差异在**哪些 XML 被 inflate**（`singlepane.xml` 是否包含该行），
而那由构建期决定，不在本 build 的运行期代码里【推断】。

### 3.8 授权类型枚举：能定的与定不了的

| 维度 | 能确定的 | 强度 |
| --- | --- | --- |
| `H` 的档位划分 | `trial` / `full` / `full verified` / `full verified cached` 四档，边界 `0xe5`、`0x110`、`0x111` | 【实证·产物】`uu0.smali:9420-9518` |
| `H` 的哨兵默认值 | `0x80000000` | 【实证·产物】`ac.smali:307` |
| `H ∈ {2,3}` | 试用期的两个子态（保留授权行） | 【实证·产物】`LicenseStatusPref.smali:1399-1417`；**具体含义未解** |
| `Р` 的渠道枚举 | `1`=Play、`2`=官网、`7`=华为、`8`=RuStore、`9`=Play | 【实证·产物】`:605-722` + `strings.xml` |
| `P` 的时间语义 | **秒级 unix 时间戳**（`currentTimeMillis()/1000` 比较） | 【实证·产物】`:206-228`、`:1321-1336` |
| `О` 的语义 | **许可键原文**（掩码显示：前 6 字符 + `"****"` + 余下） | 【实证·产物】`:763-850` |
| `H` 的完整取值表 | **未解**（只有档位边界，没有逐值语义） | — |
| `Р` 中 `1` 与 `9` 的区别 | **未解** | — |

`О` 掩码渲染的确切逻辑【实证·产物】`:779-850`：

```smali
:783  invoke-virtual {v0}, String;->length()I
:794  if-le v6, v9, :cond_f          # v9 = 6（:791 const/4 v9, 0x6）
:810  const-string v6, "\n"
:820  invoke-virtual {v0, v4, v5}, String;->substring(II)   # v4=0, v5=R("s")… 前段
:828  append(前段)
:833  const-string v4, "****"
:837  append("****")
:842  invoke-virtual {v0, v9}, String;->substring(I)        # 从第 6 字符起
:850  append(余下)
```

即：`key.length() > 6` 时渲染为 `前6字符 + "****" + 其余`。**不是**整体打码，是**中间插星**。

---

## 4. 专题 C：检查更新（`updates` 分类三项）

### 4.1 XML 声明（3 项，1 个分类）

【实证·原文】`res/xml/general.xml:9-13`：

```xml
<PreferenceCategory android:title="@string/pref_update" android:key="updates">
    <com.maxmpz.audioplayer.preference.MultilineSwitchPreference
        android:title="@string/pref_check_updates"       android:key="check_updates"
        android:summary="@string/pref_summary_check_updates" w:skipSearch="true" />
    <com.maxmpz.audioplayer.preference.MultilineSwitchPreference
        android:title="@string/pref_check_beta_updates"  android:key="check_beta_updates"
        android:dependency="check_updates"               w:skipSearch="true" />
    <com.maxmpz.audioplayer.preference.ProgressPreference
        android:persistent="false" android:title="@string/pref_check_udpate_now"
        android:key="check_update" />
</PreferenceCategory>
```

注意 **`pref_check_udpate_now` 的拼写错误**（`udpate`）——原厂笔误，资源名如此，不影响功能。

### 4.2 字段注册与默认值：**已注册，但返回值被丢弃**

**这是本专题最关键、且与既有口径相反的一处**。实测【实证·产物】`vr.smali:2516-2541`：

```smali
# ---- 正常写法（对照）：sput 存在 ----
:2507  const-string v4, "paid_welcome_shown"
:2511  invoke-virtual {v0, v4, v3}, Lׅ/ms;->X(Ljava/lang/String;Z)Lׅ/o40;
:2516  move-result-object v4
:2519  sput-object v4, Lׅ/vr;->u1:Lׅ/o40;        ← ★ 有 sput

# ---- check_updates：无 sput ----
:2523  const-string v4, "check_updates"
:2527  invoke-virtual {v0, v4, v3}, Lׅ/ms;->с(Ljava/lang/String;Z)Lׅ/pb1;
                                                  ← ★ 没有 move-result-object
# ---- check_beta_updates：无 sput ----
:2532  const-string v4, "check_beta_updates"      ← ★ 直接覆盖 v4
:2536  invoke-virtual {v0, v4, v3}, Lׅ/ms;->с(Ljava/lang/String;Z)Lׅ/pb1;
                                                  ← ★ 没有 move-result-object

# ---- 下一个正常写法 ----
:2541  invoke-virtual {v0}, Lׅ/ms;->Р()Lׅ/u80;
```

**三重复核**（同一脚本输出）：

| 检查项 | 结果 |
| --- | --- |
| `:2500-2560` 范围内的 `sput` 指令 | 只有 `:2503`（`t1`）与 `:2519`（`u1`）——**无 `check_*` 的 sput** |
| `:2500-2560` 范围内的 `move-result` | 只有 `:2500`、`:2516`、`:2551`、`:2559`——**`:2527`/`:2536` 之后没有** |
| `vr` 中 `Lׅ/pb1;` 类型静态字段总数 | **98 个**，其中**没有** `check_updates` / `check_beta_updates` 对应者 |

**但"未注册"是错的**。`ms.с(String, Z)` 的内部实现【实证·产物】`ms.smali:2687-2718`：

```smali
.method public final с(Ljava/lang/String;Z)Lׅ/pb1;
:2691  new-instance v0, Lׅ/pb1;
:2695  iget-object v1, p0, Lׅ/ms;->А:Lׅ/er;      # prefs 表
:2699  iget-object v2, p0, Lׅ/ms;->x:Lׅ/ls;      # 文件后端
:2703  invoke-direct {v0, p1, v1, v2, p2}, Lׅ/pb1;-><init>(Ljava/lang/String;Lׅ/er;Lׅ/ls;Z)V
:2708  iget-object p1, p0, Lׅ/ms;->Х:Ljava/util/ArrayList;
:2712  invoke-virtual {p1, v0}, Ljava/util/ArrayList;->add(Ljava/lang/Object;)Z   ← ★ 注册进槽位表
:2717  return-object v0
```

**所以准确的结论是三段式**：

1. **已注册**：对象被 `add` 进 `ms.Х` 槽位表 ⇒ 它是**活的 fast-pref**，值会被写入 prefs 文件；
2. **句柄丢失**：调用方没有 `move-result-object`/`sput` ⇒ **App 代码没有任何途径再拿到这个对象**；
3. **无消费者**：全树扫描 `"check_updates"` / `"check_beta_updates"` 字面量，
   **各只有 1 处命中**——就是 `:2523` / `:2532` 这两条 `const-string` 本身
   【实证·产物】。`smali/` 与 `smali_classes2/` 共 **4929 个 smali 文件**。

> **既有文档 §3.4.1 说"`vr.<clinit>` 里 `ms.с("check_updates", false)`，
> 值仍可读写"——"可写"成立、"可读"不成立。** 正确表述是：
> **`vr` 里没有对应的 `pb1` 字段；两个开关可持久化，但无任何消费者。**

### 4.3 谁消费这两个开关：**答案是没有**

| 检查手段 | 结果 |
| --- | --- |
| `vr` 中 `pb1` 字段与 `"check_updates"` 的绑定 | **不存在**（`:2527`/`:2536` 无 `sput`） |
| 全树 `"check_updates"` 字面量 | 1 处（`vr.smali:2523`，即注册点自身） |
| 全树 `"check_beta_updates"` 字面量 | 1 处（`vr.smali:2532`，即注册点自身） |
| XML 侧引用 | `general.xml:10`/`:11`（仅 `android:key`） |
| `strings.xml` 侧 | 资源名 `pref_check_updates`/`pref_check_beta_updates`（是**标题**，不是 key） |

**开关的实际效果（三层全部失效）**：

1. **UI 层**：`updates` 整个分类被无条件删除（见 §4.4）⇒ 用户**看不到**这两个开关；
2. **逻辑层**：无字段、无读取者 ⇒ 即使值被写进 prefs，**没有任何代码分支依赖它**；
3. **框架层**：`MultilineSwitchPreference` 自身会按 `android:key` 读默认 SharedPreferences，
   但**它从不 bind**（分类已删）⇒ 连框架级读也发生不了。

### 4.4 `updates` 分类的运行期命运：无条件整块移除

【实证·产物】`r91.smali:593-620`：

```smali
:593  iget-object v0, p0, Lׅ/n91;->K:Landroid/preference/PreferenceScreen;
:597  const-string v1, "updates"
:601  invoke-virtual {v0, v1}, PreferenceGroup;->findPreference(Ljava/lang/CharSequence;)Landroid/preference/Preference;
:606  move-result-object v0
:609  if-eqz v0, :cond_4              # 只有 null 检查
:613  iget-object v1, p0, Lׅ/n91;->K:Landroid/preference/PreferenceScreen;
:617  invoke-virtual {v1, v0}, PreferenceGroup;->removePreference(Landroid/preference/Preference;)Z
:622  :cond_4
```

**没有任何条件判断**：不查 prefs、不判 SDK、不判渠道、不判授权。
与 `visit_site_about`（`:473-478`）形状完全一致。

> **`check_update`（Check Now）的 key 在全树零命中**——不是"未找到监听器"，
> 而是**字符串 `"check_update"` 在 4929 个 smali 中一次都不出现**。
> 因为它唯一的声明处是 XML 的 `android:key`，而 `r91` **三次
> `setOnPreferenceClickListener` 全部给了别的元素**：
>
> | 行 | 目标 |
> | ---: | --- |
> | `:150` | `I()` 内部构造的动态 addon 行 |
> | `:437` | `about_version`（→ `x11` index `0xa` → 更新日志页） |
> | `:804` | addon ①（unlock 包） |
>
> **`check_update` 没有任何监听器**。加上分类被删，它连"可点击"都做不到。

### 4.5 `check_beta_updates` 的 `dependency="check_updates"` 运行期含义

`android:dependency` 是 **framework `Preference` 的标准语义**：依赖项未勾选时，
被依赖项的 `enabled` 被强制为 `false`（并置灰）。

**在本 build 里它没有任何运行期含义**：

| 条件 | 结论 |
| --- | --- |
| `check_beta_updates` 元素存在？ | **否**——所在分类 `:617` 被删 |
| `check_updates` 可被勾选？ | **否**——同样已被删 |
| `dependency` 解析发生在何时？ | framework 在 **inflate 后 `onAttached`** 阶段按 key 找依赖项 |

⇒ **`dependency` 的绑定对象在 `onAttached` 时已不存在**（`r91.v()` 是在页面 attach 后才跑，
`PreferenceGroup::removePreference` 后该 `Preference` 的 `mDependencyKey` 解析会被跳过/null 检查）。

**所以这句 XML 是纯"声明残留"**：它声明了"开贝塔检查必须先开常规检查"的**产品语义**，
但本 build 的代码把承载它的整块 UI 都删了。**若未来恢复 `updates` 分类，这句 `dependency`
会立刻重新生效**——它是**唯一一处"删了 UI 但保留了完整语义"的证据**，
说明"移除 `updates` 是渠道策略（Play 包靠商店自动更新），而非功能废弃"【推断】。

### 4.6 `ProgressPreference` 的进度驱动机制（被复用的"转圈"能力）

`ProgressPreference` 只有 **199 行 / 4158 B**【实证·产物】，机制极简：

```smali
# :7     .field public h:Z                       ← 唯一状态位
# :32-49 <init>(Context, AttributeSet, Z)
#        setWidgetLayoutResource(0x7f0400de)     ← layout/preference_progress_widget
#        r20.К(this, true)                       ← setRecycleEnabled / mCanRecycleLayout 反射
# :84-93 getProgress()Z                          ← 读 h
# :116-172 onBindView(View)
#        findViewById(0x7f0d026f)                ← id/progress
#        cast ProgressBar
#        setVisibility(h ? 0 (VISIBLE) : 8 (GONE))
# :175-197 setProgress(Z)
#        if (h != z) { h = z; notifyChanged(); } ← 值变化才刷
```

widget 布局【实证·原文】`res/layout/preference_progress_widget.xml:1-4`：

```xml
<ProgressBar android:id="@id/progress" android:visibility="visible"
    android:layout_width="30.0dip" android:layout_height="30.0dip"
    android:indeterminate="true" style="@android:style/Widget.ProgressBar.Large" />
```

> **是"不确定进度"（`indeterminate="true"`）的旋转圈，不是百分比条。**
> 所以不存在"进度值"这个东西——`setProgress(Z)` 只是**开关转圈**。
> 这也解释了为什么叫 `Progress` 却没有 `setMax`/`setSecondaryProgress`：
> **它就是一个布尔态的 Spinner。**

**`check_update` 是否会转圈？不会**，因为：
1. 分类被删，`onBindView` 永不发生；
2. 无 `setProgress(true)` 调用方（见下）。

**全树 `setProgress(Z)` 的 22 个调用点**（`grep setProgress(Z)V`），**全部与购买/授权有关**：

| 类 | 行 | 场景 |
| --- | --- | --- |
| `BaseRestoreFvPurchasePref` | `:302`、`:337` | 恢复购买 |
| `BuyUberPref` | `:312`、`:405` | Uber 徽章购买 |
| `LicenseStatusPref` | `:978`、`:1482` | 授权态刷新；`В()` 的一次性延迟 |
| `RestoreWebsiteFvPurchasePref` | `:205` | 官网恢复 |
| `ׅ/c60` | `:62` | LicenseStatusPref 的延迟 Runnable |
| `ׅ/m` | `:1011`、`:1026` | 两处购买流程 |
| `ׅ/qk` | `:126`、`:144`、`:172` | 购买流程 |
| `ׅ/sa1` | `:467` | 购买流程 |
| `ׅ/v91` | `:431`、`:464`、`:502` | 购买流程 |
| `ׅ/w81` | `:1088`、`:1106` | 购买流程 |
| `ׅ/y9` | `:751`、`:799` | 点击回调内的购买/恢复 |

> **零个更新检查相关调用点**。这是 `check_update` "点了没反应"的**根因级证据**：
> 不是"实现藏在别处"，而是**驱动侧的代码根本不存在**。

### 4.7 更新检查的结果落地：本 build 无

| 可能的落地方式 | 本 build 是否存在 | 证据 |
| --- | --- | --- |
| 版本更新弹框 | **否** | 无 `*Version*`/`*Upgrade*`/`*Update*` 命名的 Poweramp 类（只有 3rd-party 与 `okio`） |
| 通知 | **否** | `msg_app_version_check`(`0x7f0d03e4`) 只有 1 处引用（`r91.smali:167` 的 `onBusMsg` 判等），且该分支直接 `goto` 到 `super` |
| 跳商店 | **否**（在 `updates` 链路内） | `market://details` 全树仅 1 处：`ׅ/ww.smali:1651`，与 `updates` 无关 |
| Toast | **否** | — |
| 原生下发 | **不可能在本 build 内完成** | `lib/` 不存在（`lib/*.so` 零文件）；`Sync.native_lock` 的实现不在解码产物内 |

`r91.onBusMsg` 的实际内容【实证·产物】`:163-201`：

```smali
.method public final onBusMsg(Lcom/maxmpz/widget/MsgBus;IIILjava/lang/Object;)V
:167  const v0, 0x7f0d03e4          # id/msg_app_version_check
:172  if-ne p2, v0, :cond_0
:176      goto :goto_0             # ← ★ 什么都不做，直接跳去 super
:180  :cond_0  const v0, 0x7f0d0530 # id/cmd_app_feature_pak_settings_refresh
:185  if-ne p2, v0, :cond_1
:189      invoke-virtual {p0}, Lׅ/n91;->у()Z   # 刷新整页
:194  :cond_1  :goto_0
:196  invoke-super/range {p0 .. p5}, Lׅ/n91;->onBusMsg(...)
```

> **`msg_app_version_check` 分支是空分支**：只做 `if-eq` 判定然后 `goto` 到 `super`。
> 也就是说「版本检查完成」这条消息在本 helper 里被**显式忽略**——
> 连"结果落地"的挂点都被留空了。

### 4.8 C 专题的一条横向补证：`restore_defaults` 的缺席不是巧合

`general` / `feature_packages` / `translations` / `support` / `commands_history`
**五个页面全部没有 `restore_defaults`**（Lead 已独立核实）。
本分支可见的持久化项只有 3 个：

| key | 类型 | 持久化 | 在 UI 上可见 |
| --- | --- | --- | --- |
| `check_updates` | `pb1`（有注册、无句柄） | 是 | **否**（分类被删） |
| `check_beta_updates` | `pb1`（有注册、无句柄） | 是 | **否**（分类被删） |
| `move_fp1_to_about` | `pb1`（`wr->x0`，有句柄） | 是 | 是（`singlepane.xml`） |

> 没有一个属于"用户调优参数"，所以不需要 `restore_defaults`【推断】。
> **这也反向印证了 `check_updates` 的"死"**：一个真正被消费的偏好项，
> 其所在页面通常需要恢复默认值的能力；连恢复入口都不给，说明它**不是被当作可用设置设计的**。

---

## 5. 专题 D：`addons` 分类的运行期填充

### 5.1 XML：自闭合的空分类

【实证·原文】`res/xml/general.xml:24`：

```xml
<PreferenceCategory android:title="@string/pref_addons" android:key="addons" />
```

自闭合、**零子元素**、只有 `title` + `key`。**全部内容由 `r91.v()` 运行期注入。**

### 5.2 `r91` 里填充 `addons` 的具体代码段

`r91.v()` 共 1203 行（`:204-1406`），其中 **`addons` 段占 `:623-1404`，782 行 = 全类 53.6%**。

| # | 行号 | 动作 | 关键指令 |
| ---: | --- | --- | --- |
| ⑤ | `:623-650` | 取分类 + 取 PackageManager | `const-string v4, "addons"`（`:635`）→ `findPreference` → `check-cast PreferenceCategory`（`:647`）→ `getPackageManager()`（`:655`） |
| ⑥ | `:651-820` | **addon ① `com.maxmpz.audioplayer.unlock`** | `:667` 包名 → `:671` `getPackageInfo(pkg,0)` → `:679` `if-eqz` → `:683-687` `new Preference(ctx)` → **内联构造**（不走 `I()`）→ `:809` `addPreference` |
| ⑦ | `:825-989` | **addon ② ContentProvider 协议** | `:833` `const/16 v7, 0x80` → `:842` `"android.content.action.DOCUMENTS_PROVIDER"` → `:851` `queryIntentContentProviders(intent, 0x80)` → `:907` `providerInfo` → `:923` `"com.maxmpz.PowerampTrackProvider"` → `:927` `Bundle.getBoolean` → `:943` `I(...)` → `:989` `add-int/2addr v3, v9` |
| ⑧a | `:992-1267` | **addon ③ 广播接收者协议（两路并集）** | `:1001` `new HashMap` → `:1014` `"com.maxmpz.audioplayer.TRACK_CHANGED_EXPLICIT"` → `:1023` `queryBroadcastReceivers(intent, 0)` → `:1104` `"com.maxmpz.audioplayer.TRACK_CHANGED"` → `:1113` 第二次 query → `:1180` `HashMap.values()` → `:1196-1200` `toArray` → `:1212` **`Arrays.sort`** → `:1238` 逐个 `I(...)` |
| ⑧b | `:1270-1373` | **addon ④ Application 元数据协议** | `:1279` `getInstalledApplications(0x80)` → `:1321` `applicationInfo.metaData` → `:1329` `"com.maxmpz.PowerampVisPresets"` → `:1333` **`containsKey`**（非 `getBoolean`！）→ `:1349` `I(...)` → `:1373` `add-int/2addr v3, v6` |
| ⑨ | `:1376-1404` | **None 兜底** | `:1376` `if-nez v3, :cond_13` → `:1384` `new Preference(ctx)` → `:1389` `const v1, 0x7f0803c8`（=`string/none` = **"None"**）→ `:1394` `setTitle` → `:1399` `addPreference` |

**计数器 `v3` 的累加**（决定是否出 "None"）：

| 行 | 指令 | 累加谁 |
| ---: | --- | --- |
| `:989` | `add-int/2addr v3, v9` | ② 的命中数 |
| `:1267` | `add-int/2addr v3, v11` | ③ 的命中数 |
| `:1373` | `add-int/2addr v3, v6` | ④ 的命中数 |

> **① 的计数不在 `v3` 里**：① 走的是内联分支，它自己直接 `addPreference`。
> 也就是说 `v3` 只统计 ②③④——**但 ① 命中时 `v3` 仍为 0 的话，会同时出现 addon ① 和 "None"**。
> 这是一个**潜在 bug**（`v3` 未计入 ①）。列入 §7-Q8。

### 5.3 统一构造器 `r91.I()`（②③④ 共用）

`I(PreferenceCategory, PackageManager, String pkg)`，**155 行**【实证·产物】`r91.smali:7-161`：

```smali
:14   getPackageInfo(pkg, 0)                              # 会抛 NameNotFoundException
:22-30  new Preference(у)                                 # у = SettingsActivity
:35-72  SDK_INT >= 22 ? loadUnbadgedIcon(pm) : loadIcon(pm)   # :39 const/16 v3, 0x16
:80-84  if (icon != null) icon = new ׅ/dt(icon)            # 包一层 Drawable 包装
:93   setIcon(drawable)
:102-110 loadLabel(pm) → setTitle(...)
:115-123 SDK_INT >= 26 → setSingleLineTitle(false)          # :115 const/16 v3, 0x1a
:129-133 setSummary(pi.versionName)                       # ★ 摘要 = 版本号
:138-150 setOnPreferenceClickListener(new ׅ/q91(p0, pm, pi, 1))
:155  addPreference(p)
```

> **摘要固定用 `versionName`** ⇒ 任一 addon 行的副标题都是**插件版本号**，
> 不区分协议类型。用户无法从 UI 判断这一行是"提供曲目"还是"接收广播"还是"可视化预设"。
> 只有 ③ 因为走 `HashMap` + `Arrays.sort` 而按**包名字母序**排列，①②④ 按系统返回顺序——
> **同一分类里两种排序规则混排**，视觉上会更乱。

### 5.4 四种发现手段的协议语义

| # | 发现手段 | 匹配键 | 命中后 | 协议语义 |
| ---: | --- | --- | --- | --- |
| ① | `getPackageInfo("com.maxmpz.audioplayer.unlock", 0)` | **包名硬编码** | 内联构造 + `q91(...,0)` | **官方解锁器**（Full Version Unlocker） |
| ② | `queryIntentContentProviders(DOCUMENTS_PROVIDER, 0x80)` | `metaData["com.maxmpz.PowerampTrackProvider"]` **== true** | `I()` | 该 App 的 ContentProvider **对外提供**当前曲目 |
| ③ | `queryBroadcastReceivers(TRACK_CHANGED_EXPLICIT / TRACK_CHANGED, 0)` | 收到任一广播 | `I()`（去重 + 排序） | 该 App **接收**换曲广播（歌词类 App 典型） |
| ④ | `getInstalledApplications(0x80)` | `metaData` **containsKey** `"com.maxmpz.PowerampVisPresets"` | `I()` | 该 App 提供**可视化预设** |

**②与④的判据不同**，这是一个易漏的不对称：

- ② 用 `Bundle;->getBoolean(String)Z`（`:927`）⇒ 必须显式写 `true`
- ④ 用 `BaseBundle;->containsKey(String)Z`（`:1333`）⇒ **只要键存在即可，值无关**（可写 `false`）

> 语义上 ③ 是"消费 Poweramp 的广播"，②④ 是"被 Poweramp 消费"。**①是同一公司的配套 App。**
> 所以这个分类**不是"Poweramp 插件列表"**，而是**"与 Poweramp 声明过集成关系的第三方 App 汇总"**。

### 5.5 点击行为：拉起对方 App（失败静默）

【实证·产物】`q91.smali`（208 行，`OnPreferenceClickListener`）：

```smali
:50   onPreferenceClick(Preference)
:54   iget p1, p0, Lׅ/q91;->В:I        # index（0 或 1）
:58   packed-switch p1, :pswitch_data_0 # 只有 2 项：0 → :pswitch_0，1 → 默认段
:85-89  getPackageManager().getLaunchIntentForPackage(pi.packageName)
:97   activity.startActivity(intent)
:107-119 catchall → Log.e("SettingsHelperGeneral", "", t)   # ★ 空消息 + 只记日志
:125  return true
```

**两个 `pswitch` 分支的代码完全相同**（`:80-128` 与 `:149-197`），只有 index 不同：
index `0` = addon ①（unlock 包）用，index `1` = ②③④ 用（由 `I():142` 传入）。

> **失败不提示**：`catch` 只 `Log.e`，消息串是**空字符串**。
> 若某 App 被卸载/无 launcher activity（`getLaunchIntentForPackage` 返回 `null`），
> 用户点击后**完全无反馈**——`startActivity(null)` 抛 `NPE` 被 catch 吞掉。

### 5.6 与既有插件文档的关系（只交叉引用）

`addons` 的**四路发现是独立的轻量协议探测**，与 Poweramp 的**插件宿主体系是两套东西**：

| 维度 | `addons` 四路发现（本文） | 插件宿主体系 |
| --- | --- | --- |
| 位置 | `r91.v()` 内联，仅字符串常量 | 独立 Service / 跨进程 AIDL |
| 绑定方式 | `PackageManager` 查询（无 IPC） | `bindService` + Binder |
| 数据通道 | 无（点击即 `startActivity`） | 双向调用 |
| 生命周期 | 设置页 inflate 时一次性扫描 | 常驻，随音频状态变化 |
| 详情 | 本文 §5.1-§5.5 | 见 `docs/architecture/all-business-plugin-system.md`、`docs/architecture/plugin-host-design.md` |

> **不要混淆**：`addons` 分类里**没有**插件（plugin）行。
> 它列的是"声明过集成能力的普通 App"，**不参与音频处理链**。
> 真正的插件宿主（`SKIN_MAIN` 等）走的是另一条完全独立的路径——
> `SKIN_MAIN` 全树只在 `ׅ/za0.smali:6275` 出现一次，**与 `r91` 无交集**。

**任务书里说的"四路发现：插件 / skin / 输出等"需要修正**：实测四路是
**unlock 包 / TrackProvider / TRACK_CHANGED / VisPresets**，
**skin（`SKIN_MAIN`）与音频输出均不在其中**。

---

## 6. 跨专题横向观察

### 6.1 四个组件的"死/活"总判

| 组件 | 声明 | UI 可达 | 逻辑可达 | 最终判定 |
| --- | --- | --- | --- | --- |
| `SettingsLicenseActivity` | Manifest + XML `<intent>` | **是**（`oss` 行保留） | **是**（完整链路） | **活** |
| `LicenseStatusPref`（`general` 实例） | `general.xml:6` | **是** | 自删逻辑**不可达**；渲染逻辑**可达** | **活（半）** |
| `LicenseStatusPref`（`singlepane` 实例） | `singlepane.xml:6` | 是 | 自删**可达** | **活** |
| `check_updates` | `general.xml:10` | **否**（分类删） | **否**（无句柄无消费者） | **死** |
| `check_beta_updates` | `general.xml:11` | **否** | **否** | **死** |
| `check_update` | `general.xml:12` | **否** | **否**（key 零命中、无 `setProgress` 调用方） | **死** |
| `addons` 四路发现 | `general.xml:24` | **是** | **是** | **活** |

### 6.2 三种"删除"的不同性质

本分支有三处 `removePreference`，**性质完全不同**：

| 处 | 行号 | 条件 | 性质 |
| --- | --- | --- | --- |
| `visit_site_about` | `r91.smali:473-478` | **无条件** | **策略性移除**（Play 包不给官网入口） |
| `updates` 分类 | `r91.smali:609-617` | **无条件** | **渠道策略**（商店自动更新替代）——但保留了 `dependency` 等完整语义，说明是"暂时关掉" |
| `LicenseStatusPref`（`singlepane`） | `:1422-1439` | **条件式**（见 §3.1.2） | **状态驱动**（已授权就不需要提示行） |

> 前两个是**构建期/运行期一刀切**，第三个是**真正的状态机**。
> 这也是为什么 `addons` 用 782 行而 `updates` 只用了 25 行删除——
> **本页 53.6% 的 helper 体积花在"列出第三方 App"，0% 花在"检查更新"**。

### 6.3 资源 id 的分布规律

| 组件 | 用的 id 类型 | 说明 |
| --- | --- | --- |
| 许可页 | `string` + `layout` + `id` + `raw` | **唯一用到 `raw` 的组件**（`0x7f140004`） |
| `LicenseStatusPref` | `string` × 15 + `drawable` × 3 + `id` × 1 | 最多字符串的组件 |
| `check_*` | 0（全部走 XML 的 `@string`） | 代码里**零资源引用**——死代码的又一个表征 |
| `addons` | `string/none` × 1（`0x7f0803c8`） | 仅兜底行 |

> **"代码里零资源引用"是死的强信号**：`r91` 的 `updates` 段只用了 `const-string "updates"`
> （`findPreference` 的 key），一个 `0x7f…` 资源常量都没用。对比 `addons` 段用了
> `0x7f0803c8`（"None"）——**用没用资源 id，几乎直接等价于"这行有没有在被构造"**。

---

## 7. 未解问题

> **⚠️ 本节 Q1 / Q2 / Q3 已被 `poweramp-about-license-state-machine.md` 闭合（2026-11-07）。**
> 摘要：
> - **Q1**（谁在写 `H`）：写入端是 **`ׅ/q4`（日志标签 `"AppLSHelper"`）**，它订阅 `bus_app`（`0x7f0d015b`），
>   从 `Bundle` 取 `res` / `store` / `pending_end_ts` / `error`，落地为 `y40.H` / `P` / `р` / `Р`。
> - **Q2**（`0x111` cached）：分发层 `0x110` 与 `0x111` **无差异**（都走 `BaseApplication:3042-3043`），
>   差异纯在展示串（`uu0.K()`），**不影响权限判定**。
> - **Q3**（1 与 9 双 Play）：可信渠道集合是 **`{2, 7, 8}`**，**不含 1 和 9** ⇒ 两者功能无差别。
> - 另：`0xf0d0148` 等"魔数"实为 **高位标记的资源 id**（`0xf0` ↔ `0x7f`），是 **scene 总线标识**，
>   对应 `scene_selection_menu` / `scene_dialog_in` / `scene_dialog_scrollable`。


> 本节按任务要求**如实列出 B 专题定不下来的授权语义**。这些是**产物里确实没有足够信息**的点，
> 不是"没查"。列出比编一个错误结论有价值。

| # | 问题 | 已知（实证） | 缺什么 | 可能的验证路径 |
| ---: | --- | --- | --- | --- |
| **Q1** | **`H` 的完整取值表** | 只知道 4 个边界（`0xe5`/`0x110`/`0x111`/默认 `0x80000000`）与 4 个档位名 | **谁在写 `H`？** 全树 `ac.smali` 是唯一写入口（`:299-319`），但**写入的原始数据来自哪里**未定位；`H ∈ {2,3}` 的语义完全空白 | 反查 `ms.er`（prefs 表）的 `putInt("r", …)` 调用点；这些调用很可能在**原生库**里（`lib/` 不在解码产物中） |
| **Q2** | **`H = 0x111` 的"cached"具体语义** | 字符串为 `"full verified cached"`（`uu0.smali:9486`） | "cached" 是"离线缓存的校验结果"？还是"缓存命中 vs 实时校验"？两者在 `X()` 里**没有分支差异**（`≥0xe5` 同一路径） | 找写 `H=0x110` vs `0x111` 的分叉点——很可能在 native 校验流程里 |
| **Q3** | **`Р` 中 `1` 与 `9` 的双 Play 映射** | `1` → "Google Play"（`:618`）、`9` → "Google Play"（`:645`），**两个值渲染同一字符串** | 为什么要两个值？疑为"Play 内购已确认" vs "Play 恢复购买"，但**代码里无任何区分行为** | 找 `putInt("s", …)` 的写入点；对照 `billingclient` 的 `Purchase.getPurchaseState()` 枚举 |
| **Q4** | **`р`（`"pi"`）的真实含义** | key = `"pi"`，boolean，参与 `X()` 的 `:243/:247` 判断（有效期内 + `pi` → "Checking Purchase"） | `"pi"` 是 `pending iap`？`purchase info`？**`X()` 只把它当布尔用，没有语义线索** | 全树搜 `putBoolean("pi", …)`；对照 `l_pending_iap`（"Checking Purchase"）的文案 |
| **Q5** | **`wr->w0` 位掩码的写入者** | 4 个 `getHide_pref()` 读 4 个位（`0x1`/`0x2`/`0x4`/`0x8`）；`setHide_pref` 只有 `or` 无 `and` | **全树无 `setHide_pref(...)` 调用点**——位从未被置上？还是从 prefs 文件读入？`wr->w0` 是 `ms.Н()` 分配的槽位 76，值来源应是 `wr` 的 SharedPreferences 文件 | 查 `wr` 的 prefs 文件名（`wr.<clinit>` 的 `new ms(name)` 参数）与文件内容 |
| **Q6** | **`H` 与 `Р` 的组合语义** | 两者独立：`H` = 档位、`Р` = 渠道 | `X()` 里 `H` 与 `Р` 的**组合**只出现在"全档位"渲染块（`:597-1171`），**组合矩阵未穷举**（例如 `H=0x110` + `Р=7` 会渲染什么） | 逐分支手工复原 `setLines(...)` 的 13 个参数（`RawTextPreference.setLines$default`） |
| **Q7** | **`Sync.native_lock` 的返回值** | `X()` 的 `:440-580` 分支用 `native_lock(-1)`/`(-2)`/`(-3)` 取标题串再 `setTitle` | **`lib/` 不存在**（解码产物里 `lib/*.so` 零文件）⇒ native 实现不可见；`Sync` 的 `native_lock` 只能看到声明与 `native_close` 配对 | 需从 APK 原始 `lib/` 取 `.so` 再反编译；本 build 的解码产物不含 native |
| **Q8** | **`addons` 的 `v3` 计数器未计入 ①** | ① 走内联分支直接 `addPreference(:809)`，**不经 `v3` 累加**；`v3` 只在 `:989`/`:1267`/`:1373` 累加 ②③④ | 是否是**真 bug**？`unlock` 包存在但 ②③④ 全不命中时，UI 会同时显示 unlock 行 + "None" 行 | 需要真机验证（装 unlock 包，卸载所有第三方集成 App，看是否出现两行） |
| **Q9** | **`attr/dialog_SettingsLicenseActivity`（`0x7f010642`）的用途** | `attrs.xml:1924` 声明、`public.xml:1605` 公开，但**全树零消费**（无 `<item>` 赋值、无代码读取） | 是"曾用 Dialog 主题"的残留？还是为皮肤系统预留的钩子？ | 查其他 build 变体是否使用；或查皮肤包（skin）是否读这个 attr |
| **Q10** | **`check_updates` 双注册槽位的意图** | `:2527`/`:2536` 各建一个 `pb1` 并 `add` 进槽位表，返回句柄丢弃 | 为什么**要注册**而不是直接不写这两行？注册本身有副作用（占用 2 个槽位、影响 `ArrayList::size()` 与后续断言 `0x83`/`0x86`/`0x96`/`0xbb`） | 检查 `vr` 的 4 个槽位断言：若删掉这两行注册，断言数字是否正好差 2 |
| **Q11** | **`h0->w0` 的类归属** | 任务书称 `h0->w0` 是位掩码；**实测位掩码在 `ׅ/wr;->w0`**（`wr.smali:1749`），`ׅ/h0.smali`(6173 行) 的 `w0` **不存在** | `h0` 与 `w0` 的混淆来源未明（`h0` 是 `p50` 子类，字段表里无 `w0`；`w0` 属于 `wr`/`qt0`/`vr` 等多个类） | 澄清任务书命名；本文按实测写 `wr->w0` |

### 7.1 关于 Q1/Q2/Q7 的共同判断

`H` 的写入、`0x111` 的 cached 分叉、`Sync.native_lock` 的返回值——**三者都指向同一个缺口**：
**本 build 的解码产物不含 `lib/*.so`**（`lib/` 目录不存在，`find . -name '*.so'` 零结果）。
Poweramp 的**授权校验核心在 native 层**（`Sync` 类的 `native_lock`/`native_close`，
以及 `LicenseStatusPref:445-513` 的 `synchronized (Sync.class)` 块），
Java 侧只负责**读结果并渲染**【推断】。

> 也就是说：**本文能把 Java 侧的"状态机骨架"完整解出（读什么、比较什么、渲染什么），
> 但"状态从哪来"这一层在 native，超出本次静态分析范围。**
> 这不是分析不到位，而是**产物边界**。

### 7.2 明确标注为"不要采信"的四处旧口径

| 旧口径 | 本文实测 | 处理 |
| --- | --- | --- |
| `у->q` 索引 1 / `у->n0` 索引 0 是 `w:removeAsNeeded` 的 styleable | 本 build 为 `qt0->r0`（**单元素**，索引 0）；`qt0->q0` 是 `RawTextPreference` 的 37 元素数组；`qt0->q` 是 4 元素（`tristate` 等） | **按实测写**，§3.5 已纠正 |
| `h0->w0` 位掩码 | 位掩码在 `ׅ/wr;->w0`（`wr.smali:1749`）；`h0` 无 `w0` 字段 | **按实测写**，§3.6 已纠正，列入 Q11 |
| `vr` 里 `check_updates` 的字段注册与默认值 | **有注册（进槽位表）但无字段**（无 `sput`）；"字段 + 默认值"不成立 | **按实测写**，§4.2 已纠正 |
| `addons` 四路 = 插件/skin/输出 | 四路 = unlock / TrackProvider / TRACK_CHANGED / VisPresets；**skin（`SKIN_MAIN`）不在其中** | **按实测写**，§5.6 已纠正 |

---

## 8. 证据索引

### 8.1 XML 与资源

| 文件 | 行 | 内容 |
| --- | --- | --- |
| `res/xml/general.xml` | `1-26` | 全文（26 行）；`:6` `LicenseStatusPref` 无 `removeAsNeeded`；`:9-13` `updates` 三项；`:19-21` `oss` `<intent>`；`:24` 空 `addons` |
| `res/xml/singlepane.xml` | `6-12` | 7 个带 `w:removeAsNeeded` 的元素 |
| `res/layout/dialog_content_webview.xml` | `1-4` | 单 WebView（`@id/webview`） |
| `res/layout/preference_progress_widget.xml` | `1-4` | `ProgressBar`（`@id/progress`，`indeterminate="true"`） |
| `res/raw/oss.txt` | `1-2039` | 许可 HTML 全文（101907 B） |
| `res/values/strings.xml` | `391` | `edition_pak_name` = `com.maxmpz.audioplayer` |
| `res/values/strings.xml` | `1265` | `pref_open_source_licenses` = "Open Source Licenses" |
| `res/values/attrs.xml` | `1924` | `attr/dialog_SettingsLicenseActivity`（未使用） |
| `res/values/attrs.xml` | `2931` | `attr/removeAsNeeded`（boolean） |
| `res/values/public.xml` | `1605` / `2506` / `3852` / `4592` / `5441` / `7554` / `9316` / `11043` | `dialog_SettingsLicenseActivity` / `removeAsNeeded` / `layout/dialog_content_webview` / `string/edition_pak_name` / `string/pref_open_source_licenses` / `id/webview` / `style/ActivityTheme_Settings` / `raw/oss` |
| `res/values/styles.xml` | `6268` | `ActivityTheme_Settings` → `parent=Base_ActivityTheme_Settings` |
| `AndroidManifest.xml` | `2` | `package="com.maxmpz.audioplayer"`，`sharedUserId="com.maxmpz"` |
| `AndroidManifest.xml` | `539` | `SettingsLicenseActivity` 声明（无 `exported`/`taskAffinity`/`launchMode`，无 `intent-filter`） |

### 8.2 专题 A（许可页）

| 文件 | 行 | 内容 |
| --- | --- | --- |
| `smali/com/maxmpz/audioplayer/preference/SettingsLicenseActivity.smali` | `1-13` | 类声明 + 字段（`X:Handler`、`y:WebView`） |
| 同上 | `44-137` | `<init>`（`Handler` 用主 Looper） |
| 同上 | `52-92` | `onCreate` 头：`getThemeResId` → `setTheme` → `setTitle(0x7f080592)` → `setContentView(0x7f040051)` 于 `try` |
| 同上 | `97-130` | `ActionBar.setDisplayHomeAsUpEnabled` + `findViewById(0x7f0d0278)` → WebView |
| 同上 | `134-170` | `setWebViewClient(jb1)` + `Thread(p71(0xd)).start()` |
| 同上 | `178-201` | `catch RuntimeException` → `Log.e` + `finish()` |
| 同上 | `203-236` | `onOptionsItemSelected`（`0x102002c` = `android.R.id.home` → `finish`） |
| `smali/com/maxmpz/audioplayer/preference/EditButtonsRedirPref.smali` | `220` | **全树唯一** `Preference;->getIntent()` 调用 |
| `smali/com/maxmpz/audioplayer/preference/SettingsActivity.smali` | `146-150` | `getThemeResId` 读 `vr->K0` |
| `smali/ׅ/p71.smali` | `500-670` | `pswitch_9`：读 raw `0x7f140004` → 逐行 append + `'\n'` → `post(x91(7))` |
| `smali/ׅ/p71.smali` | `1205-1229` | `.packed-switch`：index `0xd` → `pswitch_9` |
| `smali/ׅ/x91.smali` | `1332-1376` | `pswitch_6`：`loadDataWithBaseURL(null, html, "text/html", "utf-8", null)` |
| `smali/ׅ/x91.smali` | `2723-2738` | `.packed-switch`：index `7` → `pswitch_6` |
| `smali/ׅ/jb1.smali` | `7-93` | `shouldOverrideUrlLoading`：仅 `http://`/`https://` → `ACTION_VIEW` |

### 8.3 专题 B（授权体系）

| 文件 | 行 | 内容 |
| --- | --- | --- |
| `smali/com/maxmpz/audioplayer/preference/LicenseStatusPref.smali` | `1-21` | 类声明 + 5 个字段（含 `j`=`removeAsNeeded`） |
| 同上 | `44-137` | 构造：`super(…,true)`、`qt0->r0` styleable、`getBoolean(0,false)`→`j`、`setKey("license_status")` |
| 同上 | `141-163` | `B()`（只清 Handler 队列） |
| 同上 | `165-436` | `X()` 前段：`P`（到期）+ `р`（`"pi"`）→ 标题/摘要/点击 |
| 同上 | `440-580` | `X()` 中段：`Sync.native_lock(-1/-2/-3)` 取 native 标题 |
| 同上 | `581-593` | `H >= 0xe5` 门限（进入"正式版"渲染） |
| 同上 | `605-722` | `Р` 渠道枚举 → 5 个商店字符串 |
| 同上 | `763-850` | `О` 许可键掩码（前 6 字符 + `"****"` + 余下） |
| 同上 | `977` | `setProgress(false)`（`H < 0xe5` 分支） |
| 同上 | `1122-1156` | `setLines$default(…, 0x3e0, null)` |
| 同上 | `1172` | `setOnPreferenceClickListener(null)` |
| 同上 | `1283-1406` | `В()` 前段：自删判定（`j` 门槛、`P` 到期、`H>=0x110`、三个豁免） |
| 同上 | `1422-1439` | `removePreference`（自删执行） |
| 同上 | `1445-1514` | `В()` 后段：`super.В()`、`H>=0xe5` 跳过、`c60` 延迟 1s、`X()` |
| `smali/ׅ/c60.smali` | `38-86` | Runnable：index 0 → `setProgress(false)`；index 1 → `X()` |
| `smali/ׅ/qt0.smali` | `1073` | `const v7, 0x7f010c55`（`attr/removeAsNeeded`） |
| `smali/ׅ/qt0.smali` | `1883-1908` | `qt0->r0` = 单元素 `[removeAsNeeded]` |
| `smali/ׅ/y40.smali` | `9-35` | `y40` 13 个静态字段声明 |
| `smali/ׅ/y40.smali` | `99-207` | 各字段的 `ms.р(I)` / `ms.Н()` / `ms.K()` / `ms.P()` 分配 |
| `smali/ׅ/ac.smali` | `175-205` | prefs 文件名 `"l"` |
| `smali/ׅ/ac.smali` | `212-403` | **9 个持久化键 → `y40` 字段的完整映射**（`es`/`em`/`hide_verified`/`s`/`r`/`p`/`pi`/`ae`/`luae`） |
| `smali/ׅ/uu0.smali` | `9311` | `К(Context, StringBuilder, boolean)` 方法头 |
| `smali/ׅ/uu0.smali` | `9420-9518` | **`H` → `"full"`/`" verified"`/`" verified cached"`/`"trial"` 的翻译表** |
| `smali/ׅ/wr.smali` | `1722-1749` | `wr->w0` 槽位分配（`0x4c` = 76） |
| `smali/ׅ/wr.smali` | `1753-1765` | `move_fp1_to_about` → `wr->x0` |
| `smali/ׅ/wr.smali` | `312-373` | `AssertionError("bad slot=11 …")` 槽位校验 |
| `smali/com/maxmpz/audioplayer/preference/BuyPrefBase.smali` | `115` | styleable `qt0->u` |
| `smali/com/maxmpz/audioplayer/preference/BuyPrefBase.smali` | `1163-1214` | `В()`：`X()` → `removePreference()` 或 `super.В()` |
| `smali/com/maxmpz/audioplayer/preference/BuyHuaweiFvPref.smali` | `48-56` | **`X()` 恒 `true`** |
| `smali/com/maxmpz/audioplayer/preference/BuyHuaweiFvPref.smali` | `73-104` | `getHide_pref()` = `(w0 & 0x4) != 0` |
| `smali/com/maxmpz/audioplayer/preference/BuyHuaweiFvPref.smali` | `138-159` | `setHide_pref` 只 `or 0x4` |
| `smali/com/maxmpz/audioplayer/preference/BuyPlayFvPref.smali` | `49-90` | `X()`（委托 `super`） |
| `smali/com/maxmpz/audioplayer/preference/BuyPlayFvPref.smali` | `107-138` | `getHide_pref()` = `(w0 & 0x2) != 0` |
| `smali/com/maxmpz/audioplayer/preference/BuyRustoreFvPref.smali` | `78-109` | `getHide_pref()` = `(w0 & 0x4) != 0`（与 Huawei 同码） |
| `smali/com/maxmpz/audioplayer/preference/BuyWebsiteFvPref.smali` | `72-103` | `getHide_pref()` = `(w0 & 0x8) != 0` |
| `smali/com/maxmpz/audioplayer/preference/FeaturePackPref.smali` | `97-169` | `X()`（**内联位判断，该类无 `getHide_pref`**）：`v ∧ ((w0&1) ∨ ¬(H≥0xe5 ∧ x0))` |
| `smali/com/maxmpz/audioplayer/preference/BaseBuyFvPref.smali` | `212-322` | `X()` 基类实现（`v` / `H>=0xe5` / `getHide_pref` / `vr->p2`） |
| `smali/com/maxmpz/audioplayer/preference/FeaturePackRedirectPref.smali` | `45` | styleable `qt0->r0`（唯一另一个 `removeAsNeeded` 消费者） |

### 8.4 专题 C（检查更新）

| 文件 | 行 | 内容 |
| --- | --- | --- |
| `smali/ׅ/vr.smali` | `2516-2519` | 正常写法对照：`paid_welcome_shown` → `move-result-object` → `sput u1` |
| `smali/ׅ/vr.smali` | `2523-2537` | **`check_updates`/`check_beta_updates`：无 `move-result`、无 `sput`** |
| `smali/ׅ/vr.smali` | `2541-2573` | 紧随的 `ms.Р()`/`ms.K()` + 槽位断言 `0x83` |
| `smali/ׅ/ms.smali` | `2687-2718` | `с(String,Z)`：`new pb1` → `Х.add(...)` → `return`（**注册有副作用**） |
| `smali/ׅ/ms.smali` | `1633-1664` | `X(String,Z)`（对照，`o40` 变体） |
| `smali/ׅ/r91.smali` | `163-201` | `onBusMsg`：`msg_app_version_check`(`0x7f0d03e4`) **空分支**；`cmd_app_feature_pak_settings_refresh` → `у()` |
| `smali/ׅ/r91.smali` | `428-437` | `about_version` 的 `x11(0xa, this)` 监听器 |
| `smali/ׅ/r91.smali` | `593-620` | `updates` 分类**无条件** `removePreference` |
| `smali/com/maxmpz/audioplayer/preference/ProgressPreference.smali` | `1-49` | 类 + 构造（`setWidgetLayoutResource(0x7f0400de)`） |
| 同上 | `84-93` | `getProgress()` |
| 同上 | `116-172` | `onBindView`：`findViewById(0x7f0d026f)` → `setVisibility(h ? 0 : 8)` |
| 同上 | `175-197` | `setProgress(Z)`：值变才 `notifyChanged()` |
| 同上 | `7` | `.field h:Z`（唯一状态位） |
| `smali/ׅ/n91.smali` | `2320-2423` | `n91.onBusMsg`：只处理 `msg_pipeline_started`(`0x7f0d0092`@`:2324`)/`cmd_app_close_settings`(`0x7f0d02ef`@`:2350`)/`cmd_app_settings_refresh`(`0x7f0d0535`@`:2375`，且需 `H()` 相等 @`:2404`) |

### 8.5 专题 D（addons）

| 文件 | 行 | 内容 |
| --- | --- | --- |
| `smali/ׅ/r91.smali` | `7-161` | `I(cat, pm, pkg)` 统一构造器（icon/label/versionName + `q91(…,1)`） |
| `smali/ׅ/r91.smali` | `623-650` | 取 `addons` 分类 + PackageManager |
| `smali/ׅ/r91.smali` | `651-820` | addon ①：`getPackageInfo("com.maxmpz.audioplayer.unlock", 0)` + 内联构造 |
| `smali/ׅ/r91.smali` | `825-951` | addon ②：`queryIntentContentProviders(DOCUMENTS_PROVIDER, 0x80)` + `getBoolean("com.maxmpz.PowerampTrackProvider")` |
| `smali/ׅ/r91.smali` | `992-1238` | addon ③：两次 `queryBroadcastReceivers`（`TRACK_CHANGED_EXPLICIT` / `TRACK_CHANGED`）+ `HashMap` 去重 + `Arrays.sort` |
| `smali/ׅ/r91.smali` | `1270-1360` | addon ④：`getInstalledApplications(0x80)` + `containsKey("com.maxmpz.PowerampVisPresets")` |
| `smali/ׅ/r91.smali` | `989`/`1267`/`1373` | 计数器 `v3` 三处累加 |
| `smali/ׅ/r91.smali` | `1376-1404` | `if (v3 == 0)` → `setTitle(0x7f0803c8)`="None" |
| `smali/ׅ/q91.smali` | `50-128` | 点击：`getLaunchIntentForPackage` → `startActivity`，失败 `Log.e`（空消息） |
| `smali/ׅ/q91.smali` | `203-206` | `.packed-switch 0x0`（仅 2 分支且代码相同） |
| `smali/ׅ/za0.smali` | `6275` | `SKIN_MAIN` 唯一出现处（**与 `addons` 无关**） |

### 8.6 交叉引用（本文不重述）

| 文档 | 关系 |
| --- | --- |
| `docs/architecture/poweramp-about-and-support-settings.md` | 上游：偏好树结构、`r91.v()` 9 段划分、`addons` 四路的**结构性**描述。本文在其基础上补运行期组件细节，并纠正 §3.4.1 的 `check_updates` 字段口径 |
| `docs/architecture/all-business-plugin-system.md` | 插件宿主体系（Service/Binder/跨进程）。与本文 §5 的 `addons` 轻量协议探测**是两套体系** |
| `docs/architecture/plugin-host-design.md` | 同上；`addons` 不参与插件宿主 |

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
