---
doc_id: "ARCH-POWERAMP-UTILS-M-HASHMAP"
title: "插件系统（二十六）：utils/m —— 插件实例缓存的自定义哈希表"
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
  - "docs/architecture/poweramp-plugin-instances.md（二）"
  - ".rea-analysis/smali/smali/com/maxmpz/utils/m.smali"
---

# 插件系统（二十六）：utils/m —— 插件实例缓存的自定义哈希表

## 0. 一句话结论

第二篇遗留的"`NativePluginManager.К` 的确切类型"本轮闭合：

**`utils/m` 是一个 764 行的自定义开放寻址哈希表**，
用**双数组（keys[] / values[]）** + **0.8 负载因子** + **自动扩容**实现。

> 它不是 `HashMap`，也不是 `WeakHashMap`——是**手写的、无对象包装的**专用容器。

---

## 1. 构造参数与容量规划（`m(II)`，`:59-99`）

```smali
.method public constructor <init>(int capacityHint, int unused)
    final float LOAD = 0x3f4ccccd;        // ★ 0.8f
    size  = n.B(capacityHint, LOAD);      // 向上取到 2 的幂
    this.x = (int)(size * LOAD);          // ★ 阈值 = size * 0.8
    this.K = size - 1;                    // ★ 掩码（size 是 2 的幂）
    this.y = Long.numberOfLeadingZeros(this.K);   // 用于 hash 归一化
    this.A = new Object[size];            // ★ keys
    this.X = new Object[size];            // ★ values
}
```

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `A` | `Object[]` | **keys 数组** |
| `X` | `Object[]` | **values 数组** |
| `x` | `int` | **扩容阈值**（`size * 0.8`） |
| `K` | `int` | **取模掩码**（`size - 1`，因 size 为 2 的幂） |
| `y` | `int` | `numberOfLeadingZeros(mask)`，用于 hash 归一 |
| `B` | `int` | 当前元素数 |
| `H` / `P` / `p` / `р` | `utils/i` / `utils/l` | 迭代器相关 |

### 1.1 调用点

`NativePluginManager.<init>`（`:101-107`）：

```smali
new utils/m(0x8, v1);      // ★ 初始容量 8
this.К = that;              // 插件实例缓存（uniqName -> plugin/А）
```

> 初始容量 **8**——插件数量本就少（20 个），8 起步很合理。

---

## 2. 查找算法 `A(Object)I`（`:103-164`）

返回值的**符号约定**是关键：

| 返回值 | 含义 |
| --- | --- |
| `>= 0` | **命中**，该值为槽位下标 |
| `< 0` | **未命中**，`(-v - 1)` 是**可插入槽位** |

> 这是 **`HashMap` 风格的"-1 编码"**：用负数同时表达"未命中"与"插入点"，
> 避免额外一次探测。

---

## 3. 写入 `х(K, V)`（`:713-763`）

```smali
.method public final х(Object key, Object value)
    i = A(key);                        // 查找
    if (i >= 0) {
        old = X[i]; X[i] = value;      // ★ 覆盖，返回旧值
        return old;
    }
    slot = -i - 1;                     // ★ 解出插入点
    A_arr[slot] = key;
    X_arr[slot] = value;
    B++;                               // 计数
    if (B >= x) {                      // ★ 超过阈值
        Х(A_arr.length << 1);          // 扩容两倍
    }
    return null;
}
```

| 步骤 | 说明 |
| --- | --- |
| 命中 | **返回旧值**（与 `HashMap.put` 一致） |
| 未命中 | 写入并计数 |
| 扩容 | 当 `B >= size*0.8` 时 `size *= 2` |

### 3.1 `Х(int)` 是扩容方法

`:607-712`，接收新容量，重哈希全部元素。

---

## 4. 与插件系统的关系

| 缓存 | 类型 | 键 | 值 | 容量 |
| --- | --- | --- | --- | --- |
| **实例缓存** | `utils/m` | uniqName | `plugin/А` | 8 起步，0.8 负载 |
| 构造器缓存 | `java.util.HashMap`（static） | 类名 | `Constructor` | 默认 |

> **两个缓存用了不同容器**：实例缓存手写、构造器缓存用 JDK。
> 推测原因：实例缓存需**频繁查找**（每次播放都可能查），手写可省去装箱与 `Map.Entry` 开销。

### 4.1 性能动机

| 对比 | `java.util.HashMap` | `utils/m` |
| --- | --- | --- |
| 节点对象 | 每个 entry 一个 Node | **无**（双数组） |
| 装箱 | 泛型需装箱 | 直接用 `Object[]` |
| 迭代 | EntrySet 迭代器 | 自定义 `utils/l` |

> **空间与分配次数**是主要动机——这在 Android 上很常见。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **双数组无节点对象** | 零 Node 分配 |
| A2 | **0.8 负载因子** | 时间/空间折中的常用值 |
| A3 | **size 取 2 的幂 + 掩码取模** | `& mask` 比 `%` 快 |
| A4 | **负返回值编码插入点** | 一次探测完成查与插 |
| A5 | **hash 用 `numberOfLeadingZeros` 归一** | 让高位参与低位运算 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 手写 764 行容器 | 维护成本高，易藏 bug |
| N2 | 字段名单字母（`A`/`X`/`x`/`K`/`y`/`B`） | 必须靠构造器反推语义 |
| N3 | 构造器第二个 int 参数**未使用** | 遗留参数 |
| N4 | 无并发保护 | 需外部 `synchronized`（Manager 确实这么做了） |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~四个迭代器字段~~ | ✅ **已闭合**（三十二）：`р`/`p` = 惰性 keys/values 对；`H`/`P` = entry 对 |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| 类定义 | `utils/m.smali`（764 行） |
| 构造（II） | `m.smali:59-99` |
| 0.8 负载因子 | `m.smali:64`（`0x3f4ccccd`） |
| 阈值 | `m.smali:76` |
| 掩码 | `m.smali:78-80` |
| 双数组 | `m.smali:90-96` |
| 查找 | `m.smali:103-164`（`A`） |
| 写入 | `m.smali:713-763`（`х`） |
| 扩容 | `m.smali:607-712`（`Х`） |
| 调用点 | `plugin/NativePluginManager.smali:101-107` |
| 初始容量 8 | `NativePluginManager.smali:103` |

> 口径：**build-1025**。
