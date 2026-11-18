---
doc_id: "ARCH-POWERAMP-PAK-URI-SCHEMES"
title: "插件系统（五）：pak 资源定位的四种 URI scheme"
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
  - "docs/architecture/poweramp-plugin-device-binding.md（三）"
  - ".rea-analysis/smali/smali/com/maxmpz/milk/scanner/B.smali"
---

# 插件系统（五）：pak 资源定位的四种 URI scheme

## 0. 一句话结论

**pak 不是一种文件格式，而是四种资源定位前缀**：

| scheme | 指向 |
| --- | --- |
| `builtin:` | 编译进 APK 的内置资源 |
| `compiled:` | 编译后的资源（另一种内置形态） |
| `dir:` | 文件系统路径 |
| `apk://<pkg>` | **另一个已安装 APK 包内的资源** |

> **`apk://` 就是第三方 pak 的接入方式**——与插件体系的 `uniqName` 是**两条独立的路**：
> 插件走 `<plugins>` XML + 反射，pak 走 URI scheme + 跨包读资源。

---

## 1. 判定位置（`milk/scanner/B.X(String)`，`:499-806`）


```smali
.method public final X(Ljava/lang/String;)V       // 参数：容器 URI
    if (uri.equals("builtin:"))  { y(true);  return; }   // :514
    if (uri.equals("compiled:")) { y(true);  return; }   // :531
    if (uri.equals("dir:"))      { ... File 扫描 ... }   // :546
    if (uri.startsWith("apk://")){ ... 跨包扫描 ... }    // :621
}
```

> 前两个是 `equals`（完全匹配），后两个是前缀匹配。
> 说明 `builtin:` / `compiled:` 是**单例容器**，`dir:` / `apk://` 带参数。

---

## 2. `dir:` —— 文件系统

```smali
// :546-580
if (uri.equals("dir:")) {
    path = File.fromUri(context, uri).getPath();     // 去掉 scheme 得路径
    if (path != null && path.length() > 0) {
        f = new File(path);
        if (f.isDirectory()) { ... 递归扫描 ... }
    }
}
```

---

## 3. `apk://` —— 跨包资源（第三方 pak 的核心）

```smali
// :621-639
if (uri.startsWith("apk://")) {
    pkg = Uri.decode(uri.substring(6));      // ★ v0=0x6 @:629, 6 = "apk://".length()
    if (pkg != null) { ... 用该包名读资源 ... }
}
```

> **`substring(6)` 是硬编码偏移**——若将来改 scheme 长度会断裂。
> 包名经 `Uri.decode` 处理，说明构造 URI 时调用了 `Uri.encode`。

### 3.1 构造端（`preference/n3.smali:456-474`）

```smali
// 为自己包构造 pak URI
sb   = new StringBuilder("apk://");
sb  += Uri.encode(context.getPackageName());
uri  = sb.toString();                          // "apk://com.maxmpz.audioplayer"
```

> **PA 自己也用 `apk://`**——把自己的内置可视化预设当作一个 pak。
> 与 `BaseStartupActivity:1491-1505` 的 `checkForAPIsExtras vis_presets_pak=` 对应。

---

## 4. `builtin:` / `compiled:`

两者都直接调 `y(true)`（`B.smali:526` / `:541`），**不做外部扫描**。

| scheme | 行 | 动作 |
| --- | ---: | --- |
| `builtin:` | `:514-528` | `y(**false**)` |
| `compiled:` | `:531-543` | `y(**true**)` |

> **订正（第二十五篇）**：二者**行为不同**——`builtin` 传 `false`、`compiled` 传 `true`，
> 最终产生不同容器 type（`0x1` vs `0x5`）。
> 这也解释了为什么 `preference/n3` 只判断 `builtin:` 而不判断 `compiled:`——
> **设置页只暴露 builtin，compiled 是内部用**。

---

## 5. 重复判定（同一方法内二次出现）

`B.smali` 里这套判定出现**两次**：

| 第一轮 | 第二轮 |
| --- | --- |
| `:514` builtin | `:1208` builtin |
| `:531` compiled | （无） |
| `:546` dir | `:1234` dir |
| `:621` apk:// | `:1253`、`:1425` apk:// |

> 第二轮出现在 `А(I,String)J`（`:1152`）与 `В(String,J)I`（`:1205`）方法里。
> 说明**扫描**与**增量更新**是两条独立代码路径，各自判一遍 scheme。
> 这是可维护性隐患（改 scheme 要改 4 处）。

---

## 6. 与插件体系的关系（重要区分）

| | 插件（plugin） | pak 资源 |
| --- | --- | --- |
| 声明 | `<plugins>` XML | URI scheme |
| 标识 | `uniqName`（`pkg/module`） | `apk://<pkg>` 或路径 |
| 发现 | `PluginDiscovery`（扫全部包） | 按需（用户指定 URI） |
| 实例 | 反射 `*PluginService` | 无实例，只读资源 |
| 类型系统 | `PA_PLUGIN_TYPE_*` 位域 | **无** |
| 用途 | 输出/解码/DSP | 可视化预设、皮肤资源 |

> **两条完全平行的扩展路径**。第一篇标题说"插件系统"，
> 但 `apk://` 这套 pak 机制**不在插件系统内**——它属于资源加载层。

---

## 7. 可借鉴 / 不建议照抄

### 7.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **URI scheme 统一四种来源** | 调用方只传一个字符串 |
| A2 | **`apk://` + `Uri.encode/decode`** | 包名可安全嵌入 URI |
| A3 | **PA 自己也用 `apk://`** | 内置与外部走同一路径，减少分支 |
| A4 | **`dir:` 用 `File.fromUri`** | 复用系统工具，不手撕字符串 |

### 7.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | `substring(6)` 硬编码 scheme 长度 | 改 scheme 即断 |
| N2 | scheme 判定散落 4 处（两个方法） | 易漏改 |
| N3 | `builtin:` 与 `compiled:` 行为完全相同 | 概念冗余 |
| N4 | 无 scheme 白名单校验 | 未知 scheme 走默认分支，静默失败 |

---

## 8. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~包内资源文件名约定~~ | ✅ **已闭合**（十四）：固定前缀 **`assets/milk_presets/`** |
| ~~Q2~~ | ~~`builtin:` vs `compiled:` 差异~~ | ✅ **已闭合**（二十五）：`y(false)` vs `y(true)`，type `0x1` vs `0x5` |
| ~~Q3~~ | ~~未知 scheme 默认行为~~ | ✅ **已闭合**（二十七）：`Log.e("bad container=")` + **空扫描收尾**（不抛异常） |

---

> **续篇**：另一条独立的扩展路径（皮肤）见 poweramp-skin-system.md。

## 9. 证据索引

| 主题 | 位置 |
| --- | --- |
| scheme 判定入口 | `milk/scanner/B.smali:499-806`（`X(String)`） |
| `builtin:` | `B.smali:514-528`；`:1208` |
| `compiled:` | `B.smali:531-543` |
| `dir:` | `B.smali:546-580`；`:1234` |
| `apk://` | `B.smali:621-639`；`:1253`；`:1425` |
| 构造端 | `preference/n3.smali:456-474` |
| 启动检查 | `audioplayer/common/BaseStartupActivity.smali:1491-1505` |
| 扫描服务 | `milk/scanner/MilkScanService.smali:144`（`В`） |
| Action 常量 | `com.maxmpz.milk.ACTION_SCAN` / `ACTION_SCAN_CONTAINER` |

> 口径：**build-1025**。
