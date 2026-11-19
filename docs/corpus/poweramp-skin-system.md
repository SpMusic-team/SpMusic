---
doc_id: "ARCH-POWERAMP-SKIN-SYSTEM"
title: "插件系统（六）：皮肤体系与 meta-data 发现"
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
  - "docs/corpus/poweramp-pak-uri-schemes.md（五）"
  - ".rea-analysis/decoded/res/xml/poweramp_builtin_skins.xml"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/player/bt/В.smali"
---

# 插件系统（六）：皮肤体系与 meta-data 发现

## 0. 一句话结论

**皮肤与插件是两套独立的扩展机制**，甚至发现方式都不同：

| | 插件 | 皮肤 |
| --- | --- | --- |
| 发现入口 | `assets`-style XML `0x7f160020` | **meta-data 键 `com.maxmpz.PowerampSkins`** |
| 声明格式 | `<plugins><plugin uniqName=...>` | `<skins><skin name=...>` |
| 解析器 | `router/A.y`（1171 行） | `player/bt/В.A`（:463-593） |
| 标识 | `uniqName` | meta-data 的 **int 资源 id** |
| 实例 | 反射 `*PluginService` | 无（纯资源覆盖） |

---

## 1. ★ meta-data 发现机制（与插件完全不同）

### 1.1 键名定义（`Application.<clinit>`，`:38-44`）

```smali
const-string v0, "com.maxmpz.PowerampSkins"
filled-new-array {v0}, [Ljava/lang/String;
sput-object v0, Lcom/maxmpz/audioplayer/Application;->F:[Ljava/lang/String;
```

> **`Application.F` 是一个字符串数组**（当前只有 1 个元素），
> 这是皮肤系统的全部"注册表"。

### 1.2 扫描逻辑（`bt/В.A(pm, appInfo, list, flag)`，`:463-593`）

```smali
keys = this.X;                    // = Application.F
meta = appInfo.metaData;          // ★ 读对方包的 <meta-data>
if (meta == null) return false;
for (key : keys) {
    if (!meta.containsKey(key)) continue;
    v = meta.get(key);
    if (v == null) { Log.e("SkinDiscovery", "findExternalApkInfos no meta for app=" + app); continue; }
    if (!(v instanceof Integer)) {
        Log.e("SkinDiscovery", "findExternalApkInfos bad meta type expected int got=" + v);
        continue;
    }
    resId = ((Integer) v).intValue();   // ★ meta-data 值是 xml 资源 id
    if (resId != 0) А(pm, appInfo, list, resId, flag);   // 解析该资源
}
```

| 要点 | 说明 |
| --- | --- |
| meta-data **值类型** | 必须是 `Integer`（资源 id），否则打日志跳过 |
| 日志 tag | **`SkinDiscovery`** |
| 值含义 | 对方包里 `<skins>` XML 的**资源 id** |

> **对比插件**：插件读的是对方包的 `getResources().getXml(固定id 0x7f160020)`，
> 即 **PA 自己的 id 在对方包内被复用**（因为 aapt 会给同名资源分配相似 id，
> 但更可能是对方把资源 id 写进了 meta-data）。
> 皮肤则是**显式在 meta-data 里声明资源 id**——更规范。

---

## 2. 内置皮肤清单（`poweramp_builtin_skins.xml`，142 行）

| skin | style | darkMode | 说明 |
| --- | --- | --- | --- |
| `@string/skin_light` | `@style/ActivityTheme_White` | `@style/ActivityTheme_Black` | Light 皮肤 |
| `@string/skin_black` | `@style/ActivityTheme_Black` | — | Black 皮肤（无暗色变体） |

> **只有 2 个**。`skin_light` 有暗色对应主题，`skin_black` 没有（它本身就是暗色）。

### 2.1 `<skin>` 属性

| 属性 | 含义 |
| --- | --- |
| `name` | 显示名（`@string/`） |
| `author` | 作者 |
| `description` | 描述 |
| `style` | **主主题资源** |
| `darkMode` | **暗色模式对应主题** |
| `forceGlobalOptions` | 强制全局选项 |

---

## 3. 皮肤内部的四种声明元素

全文件元素频次（实测）：

| 元素 | 数量 | 作用 |
| --- | ---: | --- |
| `option` | **68** | 单个选项 |
| `multiSwitch` | 23 | 多选/开关组 |
| `msg` | 11 | 说明文字 |
| `globalOption` | 4 | 全局属性覆盖 |
| `skin` | 2 | 皮肤本体 |
| `radio` | 2 | 单选组 |

### 3.1 `radio` —— 单选组

```xml
<radio key="alt_layout" name="@string/layout">
    <option icon="@drawable/default_layout" name="@string/_default"
            overlapAttr="" summary="@string/skin_summary_default" />
    <option icon="@drawable/alt_layout" name="@string/skin_alt_layout"
            overlapAttr="@attr/overlap_alt_layout" summary="..." />
    <option icon="@drawable/alt2_layout" name="@string/skin_alt_layout2"
            overlapAttr="@attr/overlap_alt_layout2" summary="..." />
</radio>
```

> 三个选项对应"默认 / 备选布局 / 备选布局 2"。
> `key="alt_layout"` **直接就是设置项 key**（与 `ui_theme` 页的 `alt_layout` 同名）。

### 3.2 `multiSwitch` —— 带依赖的多选

```xml
<multiSwitch dependency="alt_layout" key="track_labels_align" name="@string/track_labels">
    <option name="@string/_default" overlapAttr="" />
    <option name="@string/centered" overlapAttr="@attr/overlap_track_labels_centered" />
</multiSwitch>
```

> **`dependency` 让此项只有在 `alt_layout` 为某值时才可用**。
> 这是皮肤内部的**条件可见性**，与设置页的 `android:dependency` 同构。

### 3.3 `overlapAttr` / `overlapStyle` —— 覆盖机制（核心）

| 属性 | 指向 | 作用 |
| --- | --- | --- |
| `overlapAttr` | `@attr/...` | **选中后覆盖主题的某个属性** |
| `overlapStyle` | `@style/...` | **选中后覆盖整份样式** |
| `overlapAttr=""` | 空 | 选中后**清空**该属性（回到默认） |

实例：

```xml
<multiSwitch key="mu_colors" minSdk="31" name="@string/mu_colors">
    <option name="@string/disabled"         overlapStyle="" />
    <option name="@string/more_pronounced" overlapStyle="@style/ActivityTheme_White_Mu_More" />
    <option name="@string/less_pronounced" overlapStyle="@style/ActivityTheme_White_Mu_Less" />
</multiSwitch>
```

> **空字符串 ≠ 缺失**：`overlapStyle=""` 表示"明确清除，回到基础主题"。
> 这是一个明确的语义区分，值得记录。

### 3.4 `msg` —— 条件说明文字

```xml
<msg align="top" line1="@string/hidden" smallLine1="@string/applied_for_alt_full"
     smallLine2="@string/applied_on_main_screen" smallLine3="@string/adjust_bg_hint" />
```

| 属性 | 用途 |
| --- | --- |
| `align` | 对齐（`top`） |
| `line1` | 主文本 |
| `smallLine1..3` | 最多三行小字 |
| `icon` / `iconAlign` | 可选图标 |

> `msg` 在 XML 里**紧跟在某个选项之后**，
> 表示"当该选项被选中时显示这段说明"。即**上下文相关的帮助文本**。

### 3.5 `globalOption` —— 全局覆盖

```xml
<globalOption option="@attr/OptionRatingDisabled"
              overlapAttr="@attr/overlap_OptionRatingDisabled" />
```

> 与 `option` 的区别：`globalOption` **不受任何 switch 控制**，直接生效。

---

## 4. 与设置页的联动

第三/四篇的 `ui_theme` 页（`0x7f160034` → helper `k0`）与 `ui_theme_opts`（`0x7f160035` → `f1`）：

| 页面 | 内容来源 |
| --- | --- |
| `ui_theme` | 皮肤列表（**运行期从 `poweramp_builtin_skins.xml` 生成**） |
| `ui_theme_opts` | 当前皮肤的 `radio`/`multiSwitch`（**运行期生成**） |

> **这两个 XML 页面都是"空壳"**——真正的选项在皮肤声明里。
> 这解释了一个早期困惑：`poweramp-list-options-settings-entry.md` 里提到
> `ui_theme.xml` 只有 8 行 / 2 个 key，皮肤选项**运行期生成**（见 `poweramp-release-changelog.md` §2.2）。
> **本文给出了机制层面的解释。**

---

## 5. 三种扩展机制全景（截至本篇）

| 机制 | 发现方式 | 声明 | 能力 |
| --- | --- | --- | --- |
| **插件** | assets XML `0x7f160020` + 反射 | `<plugins>` | 输出/解码/DSP 实现 |
| **皮肤** | meta-data `com.maxmpz.PowerampSkins` | `<skins>` | 资源与样式覆盖 |
| **pak 资源** | URI scheme `apk://<pkg>` | 无声明 | 可视化预设等纯资源 |

> 三者**互相独立**、**机制各异**。理解 Poweramp 的扩展性，
> 必须同时掌握这三条路径，不能只看"插件"两个字。

---

## 6. 可借鉴 / 不建议照抄

### 6.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **meta-data 声明资源 id** | 比硬编码 id 规范，外部包可自定 |
| A2 | **`overlapAttr` vs `overlapStyle` 分离** | 单属性覆盖 vs 整份样式覆盖 |
| A3 | **空值 ≠ 缺失**（`overlapAttr=""`） | 明确的"清除"语义 |
| A4 | **`msg` 跟随选项** | 上下文相关帮助，不占独立区域 |
| A5 | **`dependency` 条件可用** | 皮肤内部也能表达依赖 |
| A6 | **纯 XML 声明皮肤** | 加皮肤零 Java 代码 |

### 6.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | meta-data 值**必须是 int**，格式错误只打日志 | 静默失效，用户无感 |
| N2 | 键名数组 `Application.F` 只有 1 项却用数组 | 为将来扩展预留，但增加理解成本 |
| N3 | 皮肤与插件两套完全不同的发现机制 | 概念统一但实现分裂 |
| N4 | `overlapAttr` 需与 `attrs.xml` 手工对齐 | 拼错无编译期检查 |

---

## 7. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~overlapAttr 叠加规则~~ | ✅ **已闭合**（二十）：`applyStyle(style, true)` 强制，后处理者覆盖 |
| ~~Q2~~ | ~~`bt/В` 双重身份~~ | ✅ **已闭合**（三十七）：**混淆类合并**——同时 implements 4 个无关接口 |
| ~~Q3~~ | ~~外部皮肤根元素~~ | ✅ **已闭合**（二十二）：`bt/В:1826` 判定 `skins`，与内置相同 |

---

## 8. 证据索引

| 主题 | 位置 |
| --- | --- |
| 皮肤清单 | `res/xml/poweramp_builtin_skins.xml`（142 行，2 皮肤） |
| meta-data 键 | `audioplayer/Application.smali:38-44`（`com.maxmpz.PowerampSkins`） |
| 发现逻辑 | `audioplayer/player/bt/В.smali:463-593`（`A(pm,appInfo,list,I)`；`containsKey` `:479`/`:493`） |
| 日志 tag | `bt/В.smali:505`（`SkinDiscovery`） |
| 类型校验 | `bt/В.smali:529-564`（必须 Integer） |
| 递归解析 | `bt/В.smali:579` |
| 调用方 | `audioplayer/common/j.smali:2198`（传 flag=4） |
| 内建清单调用 | `j.smali:2245-2253`（自身包） |
| 皮肤页 id | `0x7f160034`（`ui_theme`）、`0x7f160035`（`ui_theme_opts`） |

> 口径：**build-1025**。
