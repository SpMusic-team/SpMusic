---
doc_id: "ARCH-POWERAMP-SCAN-CONTAINER-DISPATCH"
title: "插件系统（二十七）：scanContainer 完整分派与兜底行为"
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
  - "docs/architecture/poweramp-pak-uri-schemes.md（五）"
  - "docs/architecture/poweramp-builtin-compiled-diff.md（二十五）"
---

# 插件系统（二十七）：scanContainer 完整分派与兜底行为

## 0. 一句话结论

第五篇遗留的"未知 scheme 的默认分支行为"本轮闭合：

**未知 scheme 走兜底 `:cond_8`，打一条 `bad container=` 错误日志后，
仍然执行完整的"收尾流程"**——包含事务提交与三条统计日志。

> 即：**不抛异常、不 return，而是"空扫描"收尾**。

---

## 1. 八个出口全部汇合到 `:goto_1`

`X(String)`（`:499-806`）里所有分支最终都跳到 `:goto_1`（`:737`）：

| 出口 | 行 | 对应分支 |
| ---: | ---: | --- |
| 1 | `:528` | `builtin:` |
| 2 | `:543` | `compiled:` |
| 3 | `:590` | `dir:`（成功） |
| 4 | `:601` | `dir:`（非目录） |
| 5 | `:618` | `apk://`（空包名） |
| 6 | `:669` | `apk://`（自己包，扫描完） |
| 7 | `:714` | `apk://`（外部包，扫描完） |
| 8 | `:725` | `:cond_7`（某失败） |

### 1.1 兜底分支 `:cond_8`（`:727`）

```smali
:cond_8
    Log.e("MilkPresetScanner", "scanContainer bad container=" + uri);
:cond_9
:goto_1
    // ★ 无论成功失败，都执行下面的收尾
}
```

> **`cond_8` 紧邻 `cond_9`**，中间只有一条日志——典型的"默认分支"。

---

## 2. ★ 统一收尾流程（`:738-805`）

所有八个出口都会执行：

```smali
// ① 事务提交
if (db.inTransaction()) {
    db.setTransactionSuccessful();
    db.endTransaction();
}

// ② 记录本次时间戳
this.K = v1;                              // 起始时间

// ③ 清理陈旧预设
deleted = В(uri, this.К);                 // 按容器 uri 删过期条目

// ④ 三条统计日志
Log.w("MilkPresetScanner", "deleted presets=" + deleted);
Log.w("MilkPresetScanner", "added presets="   + this.H);
Log.w("MilkPresetScanner", "updated presets=" + this.Н);
return;
```

| 步骤 | 说明 |
| --- | --- |
| ① | 事务提交——**即使扫描失败也提交**（可能已写入部分数据） |
| ② | 更新 `K`（本次扫描的基准时间） |
| ③ | `В(uri, time)` 删除该容器下**未在本次扫描中出现**的预设 |
| ④ | 三条 `Log.w` 统计 |


### 2.2 ★ `В(uri, time)` 的清理差异（本轮新发现）

清理并非对所有 scheme 一视同仁：

| scheme | `p1`（uri 参数） | 结果 |
| --- | --- | --- |
| `builtin:` | **置 null** | `:1264` 判空 → `:1263` 直接 `return 0`（**不清理**） |
| `compiled:` | **置 null** | 同上 |
| `apk://` | 保持原值 | 走通用清理 |
| `dir:` | **换成 `"20,15"`** | 特殊标记，见下 |
| 其它 | 保持原值 | 走通用清理 |

> **`builtin`/`compiled` 不清理**——因为它们的内容随 APK 固定，不存在“陈旧”概念。
> 这解释了 §2.1 的担心不成立：未知 scheme 虽走清理，但 uri 不匹配任何容器。

**`dir:` 的 `"20,15"`** 是个谜面——它既非 uri 也非数字，
推测是**目录扫描的清理半径标记**（可能需要删除 20/15 秒内的条目或类似）。

### 2.3 清理 SQL 的组装

SQL 通过 `media/A.K(...)` 动态拼接（`:1307`/`:1316`/`:1325`），
最终作用于 **`milk_presets`** 表（`:1344`），执行 `db.delete(...)`（`:1346`）。
### 2.1 "空扫描"的后果

对未知 scheme：

| 步骤 | 影响 |
| --- | --- |
| ① 事务 | 无变更，提交空事务 |
| ③ 清理 | **`В(unknownUri, time)` 会删掉该 uri 下的所有预设** |
| ④ 日志 | `deleted presets=N`（N 可能 > 0） |

> ⚠️ **这是一个潜在的破坏性行为**：若传入的 uri 恰好与某个已有容器匹配，
> 未知 scheme 会导致该容器的预设被全部清空。
> 实际上不会发生——因为未知 scheme 的 uri 不会匹配任何已有容器。

---

## 3. 完整分派表（6 种 scheme）

| scheme | 判定 | 处理 |
| --- | --- | --- |
| `builtin:` | `equals` | `y(false)` |
| `compiled:` | `equals` | `y(true)` |
| `dir:` | `equals` | `File.fromUri` → `isDirectory` → 扫描 |
| `apk://` | `startsWith` | 分自己包/外部包（十三篇） |
| **其它** | 兜底 | **`Log.e("bad container=")` + 空扫描收尾** |

> **注意判定方式不同**：前三个用 `equals`，`apk://` 用 `startsWith`，其余兜底。
> 这与第五篇的观察一致（scheme 是"完全匹配"vs"前缀匹配"两组）。

---

## 4. 三条统计日志的意义

| 日志 | 字段 | 含义 |
| --- | --- | --- |
| `deleted presets=` | `В()` 返回值 | 本次清理掉的陈旧条目数 |
| `added presets=` | `this.H` | 本次新增条目数 |
| `updated presets=` | `this.Н` | 本次更新条目数 |

> 三者都是 `Log.w`（warn 级别）——说明作者把它们当**诊断信息**而非正常输出。
> 与第十五篇的 `SELECT changes()` / `total_changes()` 呼应。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **八个出口统一收尾** | 事务、清理、统计只写一份 |
| A2 | **未知输入不抛异常** | 后台服务崩溃代价高，日志足够 |
| A3 | **三条统计日志** | 一眼看出本次扫描成效 |
| A4 | **按 uri 清理陈旧条目** | 保证多次扫描幂等 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **未知输入仍执行清理** | 理论上可能误删（实际因 uri 不匹配而安全） |
| N2 | `bad container=` 后不 return | 静态阅读时易误以为会中断 |
| N3 | 统计用 `Log.w` | 正常信息用警告级别 |
| N4 | 出口多达 8 个 `goto` | 控制流难追踪 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`"20,15"` 标记~~ | ✅ **已定性质**（三十二）：**SQL 片段**（拼进 WHERE），具体语义不可从产物判断 |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| 分派入口 | `milk/scanner/B.smali:499-806`（`X`） |
| 八个出口 | `B.smali:528/543/590/601/618/669/714/725` |
| 兜底 `cond_8` | `B.smali:727-734` |
| 汇合点 `cond_9` | `B.smali:736` |
| 事务提交 | `B.smali:738-748` |
| 时间戳 | `B.smali:751` |
| 清理调用 | `B.smali:755`（`В(uri, K)`） |
| 清理分流 | `B.smali:1208-1262` |
| builtin/compiled 不清理 | `B.smali:1262-1269` |
| dir 的 `"20,15"` | `B.smali:1242` |
| 清理 SQL 目标表 | `B.smali:1344`（`milk_presets`） |
| 三条统计日志 | `B.smali:759-803` |

> 口径：**build-1025**。
