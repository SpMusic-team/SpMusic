---
doc_id: "ARCH-POWERAMP-PLUGIN-LIB-DECLARATION"
title: "插件系统（十八）：lib 元素、原生库声明与描述符字段终订正"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni (versionCode 1025009)"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/architecture/poweramp-plugin-descriptor-fields.md（十）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/player/router/A.smali"
---

# 插件系统（十八）：lib 元素、原生库声明与描述符字段终订正

## 0. 一句话结论

XML 里除 plugin 还有 lib 子元素，它声明插件的原生库。
本轮同时订正第十篇对 х.A 字段来源的判定：A 不是通用显示名资源 id，而是 lib 元素 name 的资源 id。

---

## 1. 完整的 XML 元素与属性表（实测 12 项）

| 行 | 名称 | 类别 |
| ---: | --- | --- |
| :2472 | PluginDiscovery | 日志 tag |
| :2523 | plugins | 根元素 |
| :2606 | plugin | 子元素 |
| :2634 | **lib** | **子元素（新发现）** |
| :2645 | name | 属性（lib 内） |
| :2740 | .. | 路径遍历检查字面量 |
| :2855 | **libBasePath** | **属性（新发现）** |
| :2954 | uniqName | 属性 |
| :3014 | type | 属性 |
| :3082 | author | 属性 |
| :3105 | description | 属性 |
| :3140 | info | 属性 |
| :3167 | hidden | 属性 |

> lib 与 libBasePath 是本轮新发现，此前各篇均未提及。

---

## 2. lib 元素结构

```xml
<plugin uniqName="..." type="..." name="..." author="...">
    <lib name="pa_milk" libBasePath="..." />
</plugin>
```

| 属性 | 写入字段 | 处理 |
| --- | --- | --- |
| name | **х.B**（:2667） | 经 A.К(res, attrs, i) 解析，支持 @string/ |
| name 的资源 id | **х.A**（:2714） | getAttributeResourceValue |
| libBasePath | **х.р**（:2867） | getAttributeValue |
| lib 元素本身的值 | **х.P**（:2751） | getAttributeValue + trim |

### 2.1 х.P 的二次处理（:3322-3330）

在特定分支内 P 会被 System.mapLibraryName(P) 重新赋值——该方法把逻辑库名映射为平台文件名。

> 说明 х.P 最终存的是实际 .so 文件名（如 libpa_milk.so）。

### 2.2 .. 路径检查（:2740）

".." 字面量出现在 libBasePath 处理之前，用于拒绝含上跳的路径，防恶意 pak 用目录遍历读取任意 .so。

---

## 3. 订正第十篇：х.A 字段的真实语义

| 字段 | 第十篇说法 | 本轮订正 |
| --- | --- | --- |
| х.A | name 属性的资源 id | **lib 元素 name 的资源 id** |
| х.B | name 的字面量值 | **lib 元素 name 的字面量值** |

含义变化：第十篇以为 A/B 是插件显示名的双轨，实际它们是 lib 子元素的名字，即原生库名。

### 3.1 关于覆盖

严格说 A 同时被 plugin name 与 lib name 两处写入，后写者覆盖前者。
由于 lib 是 plugin 的子元素、解析在后面，最终值来自 lib name。

---

## 4. 插件原生库加载路径（推断链）

```
XML:   <lib name="pa_milk" libBasePath="libs" />
         down
х.B = "pa_milk"        (字面量或资源解析结果)
х.A = name 的资源 id   (若用 @string/)
х.р = "libs"           (libBasePath)
х.P = System.mapLibraryName(...)  ->  "libpa_milk.so"
         down
native 侧用 P 与 р 拼出完整加载路径
```

> 最后一步是硬边界——真正的 loadLibrary 或 dlopen 在 native。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | lib 子元素声明原生库 | 与 plugin 元数据分离 |
| A2 | System.mapLibraryName 标准化库名 | 跨平台文件命名自动适配 |
| A3 | .. 路径检查 | 防目录遍历 |
| A4 | libBasePath 可配置 | 支持不同 pak 的目录结构 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | A/B 被两处写，后写覆盖 | 语义模糊，plugin name 实际失效 |
| N2 | 字段名单字母（P/р/A/B） | 无注释则无法区分库名与显示名 |
| N3 | ".." 只做子串检查 | 无法拦百分号编码变体 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~lib 可否多次出现~~ | ✅ **已闭合**（三十六）：**不支持**——全字段 `iput-object` 覆盖，无集合结构 |
| ~~Q2~~ | ~~`х.Н` 来源~~ | ✅ **已闭合**（二十一）：全库零引用，**死字段** |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| 全部元素/属性名 | `player/router/A.smali:2472-3167` |
| lib 元素判定 | `A.smali:2634` |
| lib name 转 х.B | `A.smali:2667` |
| lib name 资源 id 转 х.A | `A.smali:2710-2714` |
| .. 检查字面量 | `A.smali:2740` |
| lib 值转 х.P | `A.smali:2747-2751`、`:2755-2759` |
| libBasePath 转 х.р | `A.smali:2855-2867` |
| mapLibraryName | `A.smali:3322-3330` |
| 字段定义 | `plugin/х.smali:13-31` |

> 口径：build-1025。