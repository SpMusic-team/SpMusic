---
doc_id: "ARCH-POWERAMP-PSEUDO-VALUES-AND-OBFUSCATION"
title: "插件系统（三十七）：伪值与混淆类合并"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
created: "2026-11-18"
updated: "2026-11-18"
open_items: 0
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/corpus/poweramp-plugin-device-opts-handler.md（七）"
  - "docs/corpus/poweramp-skin-system.md（六）"
---

# 插件系统（三十七）：伪值与混淆类合并

## 0. 一句话结论

| 问题 | 答案 |
| --- | --- |
| 除 `__avail_hires` 外还有其它伪值的伪值？ | ❌ **没有**。73 个 `__` 前缀常量中只有它出现在 `c1` |
| `bt/В` 为何既是皮肤解析器又是 OkHttp 回调？ | ✅ **混淆器把多个无关接口合并到同一个类** |

---

## 1. `__avail_hires` 的唯一性

### 1.1 全库 `__` 前缀常量（73 处）

| 类别 | 数量 | 例子 |
| --- | ---: | --- |
| 内部参数键 | 多 | `__prefs`、`__debug`、`__agg`、`__search`、`__flags` |
| 特殊动作 | 多 | `__unbind_from_all_track_ids`、`__bind_to_track`、`__reload__` |
| **插件伪值** | **1** | **`__avail_hires`**（`c1.smali:114`） |

### 1.2 判定依据

| 检查 | 结果 |
| --- | --- |
| 出现在 `plugin/NativePluginManager` 的 uniqName 查表路径 | 只有 `__avail_hires` |
| 出现在 `preference/c1.v()` 的别名展开分支 | 只有 `__avail_hires` |
| 其它 `__` 常量 | 全部在**非插件**上下文（prefs 键、Intent 参数、SAF flags） |

> **结论：插件系统的伪 uniqName 只有 `__avail_hires` 一个。**
> 第七篇的推测范围可收紧为"唯一"。

### 1.3 为什么它用 `__` 前缀

`__` 与真实 uniqName 的格式（`<pkg>/<module>`，必含 `/`）**天然不冲突**：

| 形式 | 含 `/` | 是否合法 uniqName |
| --- | :---: | :---: |
| `com.maxmpz.audioplayer/output.at` | ✅ | ✅ |
| `__avail_hires` | ❌ | ❌（故可安全用作伪值） |

> 这是**格式隔离**的巧妙用法——不需要额外的标志位或保留编号。

---

## 2. `bt/В` 的多接口混淆合并

### 2.1 类的实现声明（`:5-8`）

```smali
.class public final Lcom/maxmpz/audioplayer/player/bt/В;
.super Ljava/lang/Object;
.implements Lcom/maxmpz/widget/base/s3;      // 皮肤解析相关
.implements Lkotlin/Lazy;                    // Kotlin 惰性值
.implements Lokhttp3/Callback;               // ★ HTTP 回调
.implements Lokio/Socket;                    // ★ Okio Socket
```

### 2.2 为什么会有这种合并

| 原因 | 说明 |
| --- | --- |
| **R8/ProGuard 类合并** | 把"只实现一个接口的空类"合并进已存在的类 |
| **减少 DEX 类数** | 每个类都有固定开销，合并可显著减小体积 |
| **典型代价** | 一个类承担多种毫不相关的职责 |

### 2.3 实际的方法分布

| 方法 | 行 | 所属职责 |
| --- | ---: | --- |
| `A(pm, appInfo, list, flag)` | 463 | **皮肤发现** |
| `onFailure(Call, IOException)` | 950 | **OkHttp 回调** |
| `onResponse(Call, Response)` | 974 | **OkHttp 回调** |
| `getSource()/getSink()` | 853/867 | **Okio Socket** |
| `getValue()` | 881 | **Kotlin Lazy** |

> **一个类里塞了 4 种完全无关的职责**。
> 这也解释了为什么 `bt/В` 有 3252 行——它不是"一个类"，而是"几个类被压在一起"。

### 2.4 对逆向的影响

| 影响 | 说明 |
| --- | --- |
| 方法查找困难 | 要在 3000+ 行里找某个职责的方法 |
| 命名无意义 | 类名 `В` 不提示任何职责 |
| **但职责边界仍可辨** | 靠接口实现与方法签名可区分 |

> 这与 `plugin/х` 的单字母字段是同类问题，但更严重——
> **类级别的混淆合并**比字段名混淆更难应对。

---

## 3. 可借鉴 / 不建议照抄

### 3.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **伪值用不可能出现的格式**（无 `/`） | 与真实值天然隔离 |
| A2 | **类合并减小体积** | 对 Android 分发体积有效 |

### 3.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **类级合并** | 维护与调试代价极高 |
| N2 | 伪值靠约定而非类型 | 拼错静默失败 |
| N3 | 合并后类膨胀至 3252 行 | 单类职责失控 |

---

## 4. 证据索引

| 主题 | 位置 |
| --- | --- |
| `__avail_hires` | `preference/c1.smali:114` |
| 其它 `__` 常量 | 全库 73 处，见 §1.1 |
| `bt/В` 接口声明 | `player/bt/В.smali:5-8` |
| 皮肤发现方法 | `В.smali:463` |
| OkHttp 回调 | `В.smali:950`、`:974` |
| Okio Socket | `В.smali:853`、`:867` |
| Kotlin Lazy | `В.smali:881` |

> 口径：**build-1025**。
