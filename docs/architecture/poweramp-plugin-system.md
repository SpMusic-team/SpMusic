---
doc_id: "ARCH-POWERAMP-PLUGIN-SYSTEM"
title: "Poweramp 插件系统：页面、声明清单与发现链"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni (versionCode 1025009)"
revision: 1
open_items: 2
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 从相关页面及其关联关系开始逆向插件系统"
  - ".rea-analysis/decoded/res/xml/{poweramp_builtin_plugins,poweramp_builtin_skins}.xml"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/plugin/**"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/player/router/A.smali（PluginDiscovery）"
---

# Poweramp 插件系统：页面、声明清单与发现链

> 目标：从**页面及其内容关联**入手，解出插件系统的组织结构。
> 本文是插件系统的第一篇，建立"页面 → 清单 → 发现 → 类型"的骨架。

## 0. 一句话结论

**插件不是从 XML 读出来的，而是三层叠加**：

| 层 | 来源 | 作用 |
| --- | --- | --- |
| 实现层 | `native_get_plugins()` | native 返回已编译进 .so 的插件实现 |
| 声明层 | `poweramp_builtin_plugins.xml` | 给每个插件补**文案**（name/desc/info）与 **type 字符串** |
| 发现层 | `PluginDiscovery`（`router/A.y`） | 扫描**外部已安装 APK** 的 `<plugins>` XML |

三者以 **`uniqName`** 为唯一键汇合。

---

## 1. 页面清单（入口）

| 页面 | 行 | 根元素 | 作用 |
| --- | ---: | --- | --- |
| `poweramp_builtin_plugins.xml` | 25 | `<plugins>` | **内置插件声明**（20 条） |
| `poweramp_builtin_skins.xml` | 142 | `<skins>` | **内置皮肤声明**（另一体系，见 §6） |

> 两个页面**结构不同**：插件是扁平清单，皮肤是带 `radio`/`multiSwitch`/`msg` 的完整 UI 描述。

### 1.1 插件页面结构

```xml
<plugins>
    <plugin author="@string/pa_plugin_author"
            name="Pipeline Subsystem"
            type="PA_PLUGIN_TYPE_INTERNAL_SUBSYSTEM"
            uniqName="com.maxmpz.audioplayer/subsystem.pipeline" />
    ...
</plugins>
```

属性只有 6 个（`router/A.y` 实测读取）：

| 属性 | 必需 | 用途 |
| --- | --- | --- |
| `uniqName` | ✅ | **唯一键**，与 native 返回的 `uniq_name` 匹配 |
| `type` | ✅ | 决定插件角色（见 §3） |
| `name` | 内置必填 / 外部可选 | 显示名（可引用 `@string/`） |
| `author` | 可选 | 作者 |
| `description` | 可选 | 描述 |
| `info` | 可选 | 详细信息 |

另有 **`hidden`** 属性（`router/A.y` 里出现字符串常量），用于不显示某些插件。

---

## 2. 内置插件全景（20 条）

| type | 数量 | uniqName |
| --- | ---: | --- |
| `PA_PLUGIN_TYPE_INTERNAL_SUBSYSTEM` | 3 | `subsystem.pipeline` / `subsystem.decoder_thread` / `subsystem.dsp_thread` |
| `PA_PLUGIN_TYPE_INTERNAL_OUTPUT` | 7 | `output.at` / `output.osl` / `output.aa` / `output.oslhd` / `output.athd` / `output.cc` / `output.bench` |
| `PA_PLUGIN_TYPE_INTERNAL_DECODER` | 5 | `decoder.ffmpeg` / `decoder.amedia` / `decoder.wv` / `decoder.mpc` / `decoder.mod` |
| `PA_PLUGIN_TYPE_INTERNAL_DSP` | 3 | `plugin.milk` / `plugin.reverb` / `plugin.tempo` |
| `PA_PLUGIN_TYPE_INTERNAL_DSPI` | 1 | `plugin.dspi` |
| `PA_PLUGIN_TYPE_INTERNAL_RESAMPLER` | 1 | `plugin.resampler3` |

> **输出类占了 7 个**——这正是 idea 39/40 里"按设备选后端"的实体。
> `output.at` = AudioTrack、`output.aa` = AAudio、`output.osl` = OpenSL ES、
> `output.cc` = Chromecast、`output.bench` = 基准测试。

---

## 3. ★ 类型枚举（`NativePluginManager.X`）

`plugin/NativePluginManager.smali:132-257` 是**整个插件系统的类型中枢**：

| type 字符串 | 返回值 | 十六进制 | 外部可用 |
| --- | ---: | --- | :---: |
| `PA_PLUGIN_TYPE_DECODER` | **1** | `0x00000001` | ✅ 仅外部 |
| `PA_PLUGIN_TYPE_DSP` | **2** | `0x00000002` | ✅ 仅外部 |
| `PA_PLUGIN_TYPE_OUTPUT` | **3** | `0x00000003` | ✅ 仅外部 |
| `PA_PLUGIN_TYPE_INTERNAL_SUBSYSTEM` | **-2147483648** | `0x80000000` | 仅内置 |
| `PA_PLUGIN_TYPE_INTERNAL_DSP` | **-2147483646** | `0x80000002` | 仅内置 |
| `PA_PLUGIN_TYPE_INTERNAL_DSPI` | **-2147483640** | `0x80000008` | 仅内置 |
| `PA_PLUGIN_TYPE_INTERNAL_OUTPUT` | **-2147483645** | `0x80000003` | 仅内置 |
| `PA_PLUGIN_TYPE_INTERNAL_RESAMPLER` | **-2147483641** | `0x80000007` | 仅内置 |
| `PA_PLUGIN_TYPE_INTERNAL_DECODER` | **-2147483647** | `0x80000001` | 仅内置 |
| （未匹配） | **-1** | — | 判为非法 |

### 3.1 ★ 位域设计（本条最重要的发现）

把返回值写成二进制即可看出规律：

```
外部插件：  0x00000001  DECODER
            0x00000002  DSP
            0x00000003  OUTPUT

内置插件：  0x80000000  SUBSYSTEM
            0x80000001  DECODER
            0x80000002  DSP
            0x80000003  OUTPUT
            0x80000008  DSPI
            0x80000007  RESAMPLER

            ^
            bit31 = "内置"标志
            低 8 位 = 角色编号
```

验证：`y()` 加载时做的正是这个位运算（`NativePluginManager.smali:780-782`）：

```smali
flags = info.flags
flags & 0xFF            ; 取低 8 位 = 插件角色
if (flags & 0x80000000) ; bit31 = 内置包（PA 自己）
    require packageName == PA 自己
    else throw RuntimeException("bad pak=" + pkg + " plugin=" + uniqName)
```

> **一段代码同时完成三件事**：
> 1. 用低 8 位判角色；
> 2. 用 bit31 判"是否内置"；
> 3. 内置插件**强制校验包名必须是 PA 自己**，否则直接抛异常。
> 这是一道**防止 pak 冒充内置插件**的安全检查。

### 3.2 外部/内置的可用性差异

`X(String, boolean)` 的第二个参数 `isInternal`（`p1`）门控内置类型：

| 调用场景 | `isInternal` | 可用类型 |
| --- | --- | --- |
| 解析 PA 自己的 `builtin_plugins.xml` | `true` | 全部 9 种 |
| 解析外部 pak 的 XML | `false` | **仅 DECODER / DSP / OUTPUT** |

> ⇒ **第三方 pak 只能提供 3 类插件**，无法提供 subsystem/resampler/DSPI。
> 这是权限设计，不是遗漏。

---

## 4. 发现链：三条路径汇合

### 4.1 路径 A：native 提供实现

`NativePluginManager.y()`（`:727-848`）：

```smali
if (alreadyLoaded) return;                     ; 幂等
map = new HashMap();
plugins = native_get_plugins();                ; ★ native 返回 NativePluginInfo[]
for (p : plugins) {
    role = p.flags & 0xFF;
    if (uniq_name 非空 && role >= 0 && p.id >= 0)
        map.put(p.uniq_name, p);               ; ★ 以 uniq_name 为键
    else Log.e("Bad native plugin=" + p);
}
this.А = map;      this.A = plugins;
this.X = true;                                 ; 标记已加载
```

> `native_get_plugins()` 是 **native 方法**（`:259-260`，无方法体）。
> ⇒ 插件实现的注册在 native 层，Java 只拿到描述符。

### 4.2 路径 B：XML 提供文案

`NativePluginManager.x()`（`:324-...`）为**每个已安装包**解析 `0x7f160020`：

```smali
for (pkg : 已安装包集合) {
    appInfo = pm.getApplicationInfo(pkg, 0x80);   ; 0x80 = GET_META_DATA
    startIx = list.size();
    ok = router/A.y(pm, appInfo, 0x7f160020, true, list);   ; ★ 解析该包的 XML
    if (!ok) { ... }
    if (list.size() - 1 <= startIx) Log.e("bad result ...");
}
```

`router/A.y`（`A:2463-3633`，**1171 行**，tag `PluginDiscovery`）：

```smali
label = appInfo.loadLabel(pm)
res   = pm.getResourcesForApplication(appInfo)   ; ★ 跨包读资源
parser = res.getXml(0x7f160020)
if (parser.getName() != "plugins") return false;
for (each <plugin>) {
    name   = attr("name")        ; 可引用 @string/（用对方包的资源解析）
    uniqName = attr("uniqName")
    type   = NativePluginManager.X(attr("type"), !isExternal)
    author = attr("author")
    description = attr("description")
    info   = attr("info")
    if (type == -1) Log.e("... val=" + type + ...);   ; 未知类型 → 丢弃
}
```

> **关键**：`getResourcesForApplication` 让 PA 能**读取第三方包的 `@string/`**，
> 所以外部 pak 的插件名可以直接写资源引用，**自带本地化**。

### 4.3 汇合点

| 键 | 提供方 |
| --- | --- |
| `uniq_name` | native（`NativePluginInfo`）+ XML（`uniqName`） |
| 角色 | native（`flags & 0xFF`）+ XML（`type` 字符串） |
| 文案 | XML（`name`/`author`/`description`/`info`） |

---

## 5. 描述符结构

### 5.1 `plugin/х`（外部/发现的插件，68 行）

`implements Serializable`，`serialVersionUID = 0x62a366d7921a7f7cL`：

| 字段 | 类型 | 推断语义 |
| --- | --- | --- |
| `A` | `int` | **名称资源 id**（`В(ctx)` 里 `ctx.getString(A)`） |
| `B` | `String` | **名称**（`toString()` 直接返回它） |
| `X` | `String` | uniqName |
| `K` | `int` | **type 值**（来自 `X()`） |
| `P` / `Н` / `р` | `String` | author / description / info |
| `p` | `boolean` | hidden |
| `x` / `y` | `int` | 包标识 / 版本 |

`В(Context)`（`:43-67`）体现双轨命名：

```smali
if (A != 0) {
    s = ctx.getString(A);      ; 有资源 id → 用资源（可本地化）
    return s != null ? s : "";
}
return B;                      ; 否则用字面量
```

### 5.2 `NativePluginInfo`（native 返回，131 行）

| 字段 | 类型 |
| --- | --- |
| `id` | `int` |
| `flags` | `int`（bit31=内置，低 8 位=角色） |
| `name` | `String` |
| `uniq_name` | `String` |
| `NULL` | 静态空实例 |

`getPackage()`（`:56-75`）从 `uniq_name` 里按 `/` 切出包名。

---

## 6. 皮肤体系（与插件并列但不同）

`poweramp_builtin_skins.xml`（142 行）根元素是 `<skins>`，每条 `<skin>` 含：

| 子元素 | 作用 |
| --- | --- |
| `<globalOption>` | 全局属性覆盖（`option` + `overlapAttr`） |
| `<radio key=...>` | 单选组（如 `alt_layout` 三选一） |
| `<multiSwitch key=... dependency=...>` | 多选/开关，可依赖别的 key |
| `<msg line1/smallLine1...>` | 说明文字（会按当前选项动态显示） |

`<skin>` 属性：`name` / `author` / `description` / `style`（主题资源）/ `darkMode`（暗色对应主题）/ `forceGlobalOptions`。

> 皮肤是**纯声明式 UI**：`radio`/`multiSwitch` 的 `key` 直接对应设置项，
> `overlapAttr`/`overlapStyle` 是"选中后覆盖哪个主题属性/样式"。
> 这套机制让**新增皮肤只需写 XML**，不用写 Java。

---

## 7. 可借鉴 / 不建议照抄

### 7.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **位域打包"内置标志 + 角色"** | 一个 int 表达两件事，`flags & 0xFF` / `flags & 0x80000000` 即可分判 |
| A2 | **`uniqName` 作跨层唯一键** | native 与 XML 用同一命名空间汇合 |
| A3 | **`getResourcesForApplication` 读对方包资源** | 外部 pak 的文案可本地化 |
| A4 | **`isInternal` 门控可选类型** | 第三方只能提供 3 类，权限清晰 |
| A5 | **内置插件强制校验包名** | 防冒充，`bad pak=` 直接抛异常 |
| A6 | **皮肤纯 XML 声明** | 加皮肤零 Java 代码 |

### 7.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 类型常量用负数（`0x80000000` 起） | 可读性差，需靠位运算理解 |
| N2 | `plugin/х` 单字母字段（`A`/`B`/`X`/`K`/`P`/`Н`/`р`） | 无语义，需靠 `toString`/`В` 反推 |
| N3 | `router/A.y` 单方法 1171 行 | 解析 + 校验 + 全部 6 属性混杂 |
| N4 | 插件与皮肤两套完全不同的 XML 体系 | 概念上都叫"扩展"但结构无共性 |

---

## 8. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | `native_get_plugins()` 的实际返回内容 | 方法无体（native），**硬边界** |
| ~~Q2~~ | ~~外部 pak XML 定位~~ | ✅ **已闭合**（二十九）：`getResourcesForApplication(pak).getXml(0x7f160020)`，依赖资源 id 跨包一致 |
| ~~Q3~~ | ~~`х.x`/`х.y` 含义~~ | ✅ **已闭合**（十）：`x`=`description` 资源 id、`y`=`info` 资源 id |
| Q4 | 插件加载后如何被音频引擎使用（绑定点） | 只见 `В(NativePluginInfo)` 返回 `plugin/А`，内部未展开 |

> **Q1 是硬边界**：插件实现本身在 native，Java 侧只拿描述符。

---

> **续篇**：实例如何按 uniqName 反射构建，见 `poweramp-plugin-instances.md`。

## 9. 证据索引

| 主题 | 位置 |
| --- | --- |
| 插件清单页 | `res/xml/poweramp_builtin_plugins.xml`（25 行，20 条） |
| 皮肤清单页 | `res/xml/poweramp_builtin_skins.xml`（142 行） |
| 类型映射 | `plugin/NativePluginManager.smali:132-257`（`X(String,Z)I`） |
| native 声明 | `NativePluginManager.smali:259-260`（`native_get_plugins`） |
| 加载 | `NativePluginManager.smali:727-848`（`y()`） |
| 位域判定 | `NativePluginManager.smali:780-782`（`& 0xFF`）、`:381-383`（`& 0x80000000`） |
| 包名校验 | `NativePluginManager.smali:387-430`（`bad pak=` 抛异常） |
| XML 合并 | `NativePluginManager.smali:324-560`（`x()`） |
| 发现实现 | `player/router/A.smali:2463-3633`（`y()`，tag `PluginDiscovery`） |
| 跨包资源 | `router/A.smali:2489`（`getResourcesForApplication`） |
| 描述符 | `plugin/х.smali`（68 行）、`plugin/NativePluginInfo.smali`（131 行） |
| 内置插件 id | `0x7f160020`（`poweramp_builtin_plugins`） |

> 口径：**build-1025**。
