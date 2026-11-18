---
doc_id: "ARCH-POWERAMP-PLUGIN-NAMING-CONVENTION"
title: "插件系统（八）：uniqName 命名约定全链路"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni (versionCode 1025009)"
revision: 1
open_items: 1
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/architecture/poweramp-plugin-instances.md（二）"
  - "docs/architecture/poweramp-plugin-device-binding.md（三）"
---

# 插件系统（八）：uniqName 命名约定全链路

## 0. 一句话结论

`uniqName` 形如 **`<包名>/<模块路径>`**，**同一个字符串驱动四处完全不同的机制**：

| # | 用途 | 派生规则 |
| ---: | --- | --- |
| 1 | **类名**（反射实例化） | `/`→`.`，末段首字母大写 + `PluginService` |
| 2 | **包名校验**（内置防冒充） | 取 `/` 之前的部分 |
| 3 | **Preference key** | `"pa_output_" + uniqName` |
| 4 | **HashMap 键**（两处缓存） | 直接用原串 |

> **一个字符串，四种解释**。这是插件系统最核心的隐式契约。

---

## 1. 四种用途的精确规则

### 1.1 → 类名（`NativePluginManager:952-1017`）

```smali
u    = "com.maxmpz.audioplayer/output.at"
tail = u.substring(u.lastIndexOf(0x2e))    // ".at"
full = u.replace(0x2f, 0x2e)              // "com.maxmpz.audioplayer.output.at"
cls  = full + "." + upper(tail[1]) + tail.substring(2) + "PluginService"
     = "com.maxmpz.audioplayer.output.at.AtPluginService"
```

⚠️ **注意 `lastIndexOf(0x2e)` 的微妙**：它找的是**最后一个点**，
而不是最后一个 `/`。对于 `.../output.at`，最后一个点就在 `.at` 前，结果正确；
但对于 `.../subsystem.decoder_thread`，tail = `.decoder_thread`，
派生类名含下划线 `Decoder_threadPluginService`——**不是合法惯例但在 Java 里合法**。

### 1.2 → 包名（`NativePluginManager:375-430`）

```smali
pkg = info.getPackage();                  // 从 uniq_name 按 "/" 切出
if (flags & 0x80000000) {                 // 内置
    if (!pkg.equals(ownPackageName))
        throw new RuntimeException("bad pak=" + pkg + " plugin=" + uniq_name + " paPak=" + own);
}
```

> `getPackage()`（`NativePluginInfo:56-75`）= `uniq_name` 里 `/` 之前的部分。
> **内置插件的包名必须等于 PA 自己的包名**，否则抛异常——防冒充。

### 1.3 → Preference key（`k0.smali:1070-1080`）

```smali
key = "pa_output_" + plugin.H;            // H = uniqName
// 例："pa_output_com.maxmpz.audioplayer/output.at"
pref.setKey(key);
```

> **注意 key 里含 `/` 和 `.`**——不是标准 Android preference key 风格，
> 但 SharedPreferences 允许任意字符串，所以能工作。

### 1.4 → HashMap 键

| 缓存 | 位置 | 键 |
| --- | --- | --- |
| uniqName → NativePluginInfo | `NativePluginManager.А`（`y()` `:800`） | uniqName 原串 |
| uniqName → plugin/А 实例 | `NativePluginManager.К`（`В()` `:919`） | uniqName 原串 |

---

## 2. ★ 命名约定的第二层：`pa_output_<tail>` 字符串键

`poweramp_builtin_plugins.xml` 里 6 个输出插件的 `name` 用资源引用，且**键名与 uniqName 尾段严格对应**：

| 字符串键 | uniqName | 尾段 | 一致 |
| --- | --- | --- | :---: |
| `pa_output_at` | `.../output.at` | `at` | ✅ |
| `pa_output_osl` | `.../output.osl` | `osl` | ✅ |
| `pa_output_aa` | `.../output.aa` | `aa` | ✅ |
| `pa_output_oslhd` | `.../output.oslhd` | `oslhd` | ✅ |
| `pa_output_athd` | `.../output.athd` | `athd` | ✅ |
| `pa_output_cc` | `.../output.cc` | `cc` | ✅ |

**6/6 完全吻合**。即约定为：

```
uniqName 尾段  ==  @string/pa_output_<尾段> 去掉前缀
output.at      →      pa_output_at
```

### 2.1 但只有 6 个用了资源引用

20 个内置插件的 `name` 分两类：

| 类型 | 数量 | 例子 |
| --- | ---: | --- |
| **`@string/pa_output_*`** | **6** | 6 个对外输出插件 |
| **字面量** | **14** | `"Pipeline Subsystem"` / `"Milk DSP"` / `"Poweramp Built-in FFmpeg Decoder"` |

> **分界线很清晰**：只有**用户会在设置里看到的输出插件**做了国际化，
> 其余 14 个（subsystem / decoder / dsp / resampler / bench）用英文硬编码。
> 因为它们要么不显示（subsystem/bench），要么名称是技术术语（FFmpeg/WavPack）。

---

## 3. 命名约定的三个"陷阱"

### 3.1 大小写敏感的下划线

`subsystem.decoder_thread` 派生类名 `Decoder_threadPluginService`
—— **含下划线**，与其它插件的驼峰命名不一致。

### 3.2 同名不同包

| uniqName | 类 |
| --- | --- |
| `output.osl` | `output.osl.OslPluginService` |
| `decoder.osl` | `decoder.osl.OslPluginService` |

> **两个 `OslPluginService`**，靠包名区分。`decoder.osl` 甚至没在 XML 里声明。

### 3.3 `__avail_hires` 是伪 uniqName

第七篇已解：`c1.v()` 里 `uniqName == "__avail_hires"` 时**不查表**，
而是动态解析成 `output.athd` / `output.oslhd`。

> 它**不符合** `<pkg>/<module>` 格式（没有 `/`）。
> 若误传给 `npm.х()` 会返回 null。**约定只在小范围内成立**。

---

## 4. 完整命名链图示

```
              poweramp_builtin_plugins.xml
              ┌──────────────────────────────────┐
              │ uniqName="com.maxmpz.audioplayer/output.at"
              │ type="PA_PLUGIN_TYPE_INTERNAL_OUTPUT"
              │ name="@string/pa_output_at"
              └──────────────┬───────────────────┘
                             │
        ┌────────────────────┼─────────────────────┐
        │                    │                     │
        ▼                    ▼                     ▼
  ┌───────────┐      ┌─────────────┐      ┌──────────────┐
  │ 类名派生  │      │ 包名校验    │      │ 资源键派生   │
  │ /→. +     │      │ split("/")[0]│      │ "pa_output_" │
  │ Pascal    │      │             │      │  + tail      │
  └─────┬─────┘      └──────┬──────┘      └──────┬───────┘
        │                   │                    │
        ▼                   ▼                    ▼
  AtPluginService   com.maxmpz.audioplayer   pa_output_at
        │                   │                    │
        └─────────┬─────────┘                    │
                  ▼                              ▼
         反射 newInstance()              getString(键)
         （需 native uniq_name 匹配）      （多语言文案）
```

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **一个 uniqName 贯穿四层** | 无需额外注册表 |
| A2 | **资源键与 uniqName 尾段同名** | 人工可推导，便于排查 |
| A3 | **只给用户可见项做国际化** | 14 个技术术语保持英文，省翻译成本 |
| A4 | **包名校验防内置冒充** | 单向信任边界清晰 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 四处派生无统一入口 | 改约定需同步 4 处 |
| N2 | `lastIndexOf(".")` 对 3 段以上 uniqName 脆弱 | `a/b.c.d` 会派生出错误 tail |
| N3 | `pa_output_` 前缀硬编码在 `k0` | 新增类型要改代码 |
| N4 | 伪值 `__avail_hires` 破坏格式一致性 | 无类型系统保护 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | 外部 pak 的 `name` 是否带 `@string/` | 无 pak 样本，**不可从产物判断** |
| ~~Q2~~ | ~~3 段以上派生~~ | ✅ **已闭合**（二十九）：确会漏中间段；但**实测 20 个全部恰好 2 段**，从未触发 |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| 类名派生 | `plugin/NativePluginManager.smali:952-1017` |
| `lastIndexOf(".")` | `NativePluginManager.smali:955` |
| 包名切分 | `plugin/NativePluginInfo.smali:56-75`（`getPackage()`） |
| 包名校验 | `NativePluginManager.smali:375-430` |
| Preference key | `preference/k0.smali:1070-1080` |
| HashMap 键（info） | `NativePluginManager.smali:798-800`（取 `uniq_name` 后 `put`） |
| HashMap 键（实例） | `NativePluginManager.smali:917-921`（按 `uniq_name` 取） |
| `pa_output_*` 字符串 | `res/values/strings.xml`（6 个） |
| 插件清单 | `res/xml/poweramp_builtin_plugins.xml`（20 条：6 引用 + 14 字面量） |
| 伪值 | `preference/c1.smali:114`（`__avail_hires`） |

> 口径：**build-1025**。
