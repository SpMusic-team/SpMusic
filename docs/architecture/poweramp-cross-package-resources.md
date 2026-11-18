---
doc_id: "ARCH-POWERAMP-CROSS-PACKAGE-RESOURCES"
title: "插件系统（二十九）：跨包资源解析机制与 uniqName 派生边界"
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
  - "docs/architecture/poweramp-plugin-system.md（一）"
  - "docs/architecture/poweramp-plugin-naming-convention.md（八）"
---

# 插件系统（二十九）：跨包资源解析机制与 uniqName 派生边界

## 0. 一句话结论

本篇闭合两个跨篇遗留：

| 问题 | 答案 |
| --- | --- |
| 外部 pak 的 `<plugins>` XML 如何定位 | **`getResourcesForApplication(外部包).getXml(PA 的资源 id)`** |
| `uniqName` 含 3 段以上时派生是否出错 | **会出错**——`lastIndexOf(".")` 只取最后一段 |

---

## 1. ★ 跨包资源解析（`router/A.y:2489-2497`）

```smali
res    = pm.getResourcesForApplication(appInfo);   // ★ 对方包的 Resources
parser = res.getXml(p2);                            // ★ 用 PA 的资源 id
```

### 1.1 关键点：id 是 PA 的，资源是对方的

| 元素 | 来源 |
| --- | --- |
| `Resources` | **对方包**（`getResourcesForApplication`） |
| `xmlId` | **PA 自己**（`NativePluginManager` 传 `0x7f160020`） |

> **这在 Android 上能工作的原因**：
> 外部 pak 在自己的 APK 里声明了一个同名资源（`res/xml/poweramp_builtin_plugins.xml`），
> aapt 为其分配的 id 在**对方的资源表**里恰好也是 `0x7f160020`（相同的包内序号）。

### 1.2 这个约定的脆弱性

| 风险 | 说明 |
| --- | --- |
| **id 依赖资源声明顺序** | 若 pak 的 `res/xml/` 下文件数量/顺序与 PA 不同，id 会偏移 |
| **无校验** | 取错资源时只会因根元素不是 `plugins` 而静默跳过 |
| **异常被吞** | `:2499` catch 全部 `Exception`，失败只会返回 false |

> 对比第五篇的 `apk://`：那里用 **meta-data 显式声明资源 id**，更可靠。
> 插件走 id 约定、皮肤走 meta-data——**两套机制的成熟度不同**。

---

## 2. `uniqName` 三段以上的派生缺陷

### 2.1 算法回顾（第八篇）

```smali
i    = u.lastIndexOf(0x2e);        // ★ 最后一个"点"
tail = u.substring(i);             // ".at"
full = u.replace(0x2f, 0x2e);     // "/" -> "."
cls  = full + "." + upper(tail[1]) + tail.substring(2) + "PluginService"
```

### 2.2 三段情况的推演

假设 `uniqName = "com.a/b.c.d"`：

| 步骤 | 结果 |
| --- | --- |
| `lastIndexOf(".")` | 在 `".d"` 前 |
| `tail` | **`".d"`**（丢掉了 `.c`） |
| `full` | `"com.a.b.c.d"` |
| 派生类名 | `"com.a.b.c.d.DPluginService"` |

**期望**（若按"`/` 后整段作模块路径"）：`com.a.b.c.d.B_c_dPluginService` 或类似。

> **实际派生会漏掉中间段**，且目标类名与包路径不一致。

### 2.3 现网是否有此情况

检查全部 20 个内置插件的 `uniqName`：

| 段数（`/` 之后按 `.` 拆） | 数量 | 例子 |
| --- | ---: | --- |
| **2 段** | **20（全部）** | `output.at` / `subsystem.decoder_thread` |
| 1 段 | 0 | — |
| 3 段以上 | 0 | — |

> **实测 20 个全部恰好 2 段**（`<模块>.<名字>`），所以该缺陷从未被触发。
> 这也解释了为什么 15/20 的派生能成功——其余 5 个是"**无 Service 类**"而非"派生错"。
>
> 顺带修正本篇初稿的分段统计（曾误记为 6 个 1 段 + 3 个 2 段）。

---

## 3. 两种扩展机制的成熟度对比

| 维度 | 插件（`<plugins>`） | 皮肤（`<skins>`） |
| --- | --- | --- |
| 资源 id 定位 | **隐式约定**（硬编码 `0x7f160020`） | **meta-data 显式声明** |
| 跨包可靠性 | 依赖资源声明顺序 | 由对方包自己给出 id |
| 失败表现 | 静默跳过（根元素不匹配） | 打 `no meta for app=` / `bad meta type` |
| 成熟度 | 较低 | **较高** |

> **皮肤机制是插件的升级版**——用 meta-data 替代了 id 约定。
> 这可能是 PA 团队意识到 id 约定脆弱后的改进。

---

## 4. 可借鉴 / 不建议照抄

### 4.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **`getResourcesForApplication` 跨包读资源** | 让外部 pak 自带本地化文案 |
| A2 | **根元素名校验**（`equals("plugins")`） | 取错资源时能识别 |
| A3 | **皮肤改用 meta-data**（更晚的机制） | 演进方向正确 |

### 4.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **依赖资源 id 跨包一致** | pak 重排资源即失效 |
| N2 | 异常全吞（`catch Exception`） | 失败无诊断线索 |
| N3 | **`lastIndexOf(".")` 对 3 段失效** | 扩展时静默派生错类名 |
| N4 | 无不匹配告警 | 用户只看到"插件没出现" |

---

## 5. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | 外部 pak 的资源 id 是否真与 PA 一致 | 无实际 pak 样本，**不可从产物判断** |
| ~~Q2~~ | ~~catch 内日志~~ | ✅ **已闭合**（三十二）：**确认无日志**，直接跳 `:goto_0` |

---

## 6. 证据索引

| 主题 | 位置 |
| --- | --- |
| 跨包 Resources | `player/router/A.smali:2489` |
| `getXml(id)` | `A.smali:2495` |
| 异常捕获 | `A.smali:2499-2500` |
| 根元素校验 | `A.smali:2523-2527` |
| `uniqName` 派生 | `plugin/NativePluginManager.smali:952-1017` |
| `lastIndexOf(".")` | `NativePluginManager.smali:955` |
| 20 个 uniqName | `res/xml/poweramp_builtin_plugins.xml` |
| 皮肤 meta-data | `audioplayer/Application.smali:38-44`（第六篇） |

> 口径：**build-1025**。
