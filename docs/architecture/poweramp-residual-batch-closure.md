---
doc_id: "ARCH-POWERAMP-RESIDUAL-BATCH-CLOSURE"
title: "插件系统（三十二）：四项残余批量闭合"
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
  - "docs/architecture/poweramp-milk-data-layer.md（三十）"
  - "docs/architecture/poweramp-utils-m-hashmap.md（二十六）"
---

# 插件系统（三十二）：四项残余批量闭合

## 0. 一句话结论

本篇一次性闭合四个"单一调用点未追"的残余项。

---

## 1. `К.х()` 的调用方（第三十篇 Q1）

全库**仅 1 处**调用：`milk/data/X.smali:1289`。

### 1.1 触发条件（`X.Х(int)`，`:1250-1300`）

```smali
.method public final Х(int mode) Z
    if (mode < 0 || mode > 3) mode = this.А;    // ★ 钳制到 0..3
    if (mode == this.A) return false;           // 无变化
    this.A = mode;
    if (mode == 3 && this.Х != null) {          // ★ mode==3 才重排
        long curId = this.Х.В;                  // 当前预设 id
        К.х(db, curId);                         // ★ 随机重排
    }
    return х(false);
}
```

| 值 | 含义（推断） |
| ---: | --- |
| 0 | 默认顺序 |
| 1 | 按名 |
| 2 | 按作者 |
| **3** | **随机**（触发 `shuffle_order` 重排） |

> **`mode == 3` 是唯一的随机档**——与 `milk_sort_modes` 数组的 5 项不完全对应，
> 说明这里的 0..3 是**内部排序模式**，不是 UI 的 5 项排序列表。

---

## 2. `utils/m` 的四个迭代器字段（第二十六篇 Q1）

| 字段 | 类型 | 引用行 | 作用 |
| --- | --- | --- | --- |
| **`р`** | `utils/l` | `:195/203/212/230/253` | **keys 迭代器**（惰性创建） |
| **`p`** | `utils/l` | `:209/234/241/249` | **values 迭代器**（与 `р` 成对） |
| `H` | `utils/i` | `:405/413/422/440/463` | 另一对迭代器之一 |
| `P` | `utils/i` | `:419/444/451/459` | 另一对迭代器之二 |

### 2.1 惰性创建（`X()Lcom/maxmpz/utils/l`，`:192-258`）

```smali
.method public final X() utils/l;        // keys 迭代器
    if (this.р == null) {
        this.р = new utils/l(this);      // ★ 首次调用才创建
        this.p = new utils/l(this);      // ★ 同时创建配对的那个
    }
    // 然后重置迭代器状态
    iter.y = false;                       // 复位标志
    ...
}
```

> **`р` 与 `p` 同生共死**——创建其中一个时必然创建另一个。
> `H`/`P` 是 `utils/i` 类型（另一族），由 `iterator()`（`:402`）返回。

### 2.2 两族迭代器的分工

| 族 | 字段 | 方法 | 推测用途 |
| --- | --- | --- | --- |
| `utils/l` | `р` / `p` | `X()` | keys / values 迭代 |
| `utils/i` | `H` / `P` | `iterator()`（`:402`） | entry 迭代（Java `Iterator` 契约） |

> `m` 同时实现两套——一套给 Java 集合契约用（`iterator()`），
> 一套内部快速遍历用（`X()` 避免创建 `Map.Entry`）。

---

## 3. `catch(Exception)` 内是否有日志（第二十九篇 Q2）

回到 `router/A.y:2499-2500`：

```smali
try {
    res    = pm.getResourcesForApplication(appInfo);
    parser = res.getXml(xmlId);
} catch (Exception e) {
    // ★ 无日志语句
} catchall (...) {
}
```

> **确认无日志**。两个 catch 块都直接跳到后续逻辑。
> 这与皮肤机制形成对比——皮肤 `bt/В` 有 `Log.e("SkinDiscovery", "no meta for app=")`。

---

## 4. `dir:` 清理的 `"20,15"` 标记（第二十七篇 Q1）

回看 `B.smali:1242`：

```smali
if (uri.equals("dir:")) {
    p1 = "20,15";        // ★ 既非 uri 也非纯数字
    // 之后 p1 作为 SQL 片段参与拼接（:1307-1325）
}
```

**它不是参数值，而是 SQL 片段**——被 `media/A.K(...)` 拼进 WHERE 子句。

| 推断 | 依据 |
| --- | --- |
| 可能是 `LIMIT 20,15` 或列索引 `20,15` | 逗号分隔的两整数 |
| 但拼进的是 "uri=?" 附近 | `:1300` 的后续是 `"uri=?"` |

> **本轮未能确定**。它在 SQL 里的确切位置需逐行还原 `A.K` 的拼接逻辑，
> 而该方法本身也是被混淆的通用字符串拼接工具。
> **记为不可从产物判断**。

---

## 5. 汇总

| 原项 | 结论 |
| --- | --- |
| `К.х()` 调用方 | ✅ 唯一：`X.Х(int)` 且 `mode == 3` |
| `utils/m` 迭代器字段 | ✅ `р`/`p` = 惰性 keys/values 对；`H`/`P` = entry 对 |
| `catch` 内日志 | ✅ **确认无** |
| `"20,15"` 标记 | ❌ **不可从产物判断** |

---

## 6. 证据索引

| 主题 | 位置 |
| --- | --- |
| `X.Х(int)` 触发 | `milk/data/X.smali:1250-1300` |
| 调用 `К.х` | `X.smali:1289` |
| `mode==3` 判断 | `X.smali:1269-1271` |
| 迭代器惰性创建 | `utils/m.smali:192-258`（`X()`） |
| `р`/`p` 赋值 | `m.smali:203/209` |
| `iterator()` | `m.smali:402-469` |
| 无日志的 catch | `player/router/A.smali:2499-2500` |
| 皮肤有日志 | `player/bt/В.smali:511`（对照） |
| `"20,15"` | `milk/scanner/B.smali:1242` |

> 口径：**build-1025**。
