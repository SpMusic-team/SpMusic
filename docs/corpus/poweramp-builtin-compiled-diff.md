---
doc_id: "ARCH-POWERAMP-BUILTIN-COMPILED-DIFF"
title: "插件系统（二十五）：builtin 与 compiled 的真实差异、type 扩容"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 1
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/corpus/poweramp-pak-uri-schemes.md（五）"
  - "docs/corpus/poweramp-pak-container-type-flags.md（二十三）"
---

# 插件系统（二十五）：builtin 与 compiled 的真实差异、type 扩容

## 0. 一句话结论

第五篇说"`builtin:` 与 `compiled:` 行为完全相同"——**错误**。
本轮实测两者传入 `y(Z)` 的**布尔值相反**，且最终产生**不同的 type**。

| scheme | 调 `y()` | `native_get_compiled_names_iterator` 参数 | 容器 type |
| --- | --- | --- | ---: |
| `builtin:` | **`y(false)`** | `xor 1` → **1** | **0x1** |
| `compiled:` | **`y(true)`** | `xor 1` → **0** | **0x5** |

> 于是容器 type 的取值域从 4 个扩到 **6 个**（含 0x1、0x5）。

---

## 1. 分支对比（`B.X()`，`:514-543`）

```smali
if (uri.equals("builtin:")) {
    y(false);            // :526  const/4 v1, 0x0
    return;
}
if (uri.equals("compiled:")) {
    y(true);             // :541  const/4 v0, 0x1
    return;
}
```

> 第五篇的误判原因：两处都写"直接调 `y(true)`"，实际一处 `false` 一处 `true`。
> **这是本轮订正的第二处"两分支相同"误判**（第一处是 `applyStyle` 的 `force`）。

---

## 2. `y(Z)` 内部的三处分化（`:1001-1090`）

### 2.1 native 迭代器参数（`:1004`）

```smali
v0 = p1 ^ 0x1;        // ★ 取反
iter = native_get_compiled_names_iterator(v0);
```

| 调用 | p1 | `p1 ^ 1` |
| --- | :---: | ---: |
| `builtin:` | `false`(0) | **1** |
| `compiled:` | `true`(1) | **0** |

### 2.2 URI scheme 字符串（`:1027-1041`）

```smali
if (p1) scheme = "compiled";
else    scheme = "builtin";
```

### 2.3 容器 type（`:1052-1061`）

```smali
if (p1) type = 0x5;    // compiled
else    type = 0x1;    // builtin
А(type, uri);
```

> 三者都由同一个 `p1` 驱动，**完全一致地分化**。

---

## 3. ★ 容器 type 完整取值域（6 个）

合并第二十三篇与本轮：

| type | 二进制 | 含义 | 来源 |
| ---: | --- | --- | --- |
| **0x1** | `0b0001` | **builtin 内置表** | `builtin:` |
| **0x5** | `0b0101` | **compiled 编译表** | `compiled:` |
| 0x8 | `0b1000` | 本包 APK | `apk://` 自己包 |
| 0xa | `0b1010` | 外部 APK | `apk://` 外部包 |
| 0xf | `0b1111` | zip 子容器 | 嵌套 zip |
| 0x14 | `0b10100` | 目录容器 | `dir:` |

### 3.1 重新解读位域

```
0x1  = 0000 0001   builtin
0x5  = 0000 0101   compiled   (= 0x1 + 0x4)
0x8  = 0000 1000   apk 自己
0xa  = 0000 1010   apk 外部   (= 0x8 + 0x2)
0xf  = 0000 1111   zip        (= 0x8 + 0x4 + 0x2 + 0x1)
0x14 = 0001 0100   dir        (= 0x10 + 0x4)
```

| 位 | 推断含义 | 佐证 |
| --- | --- | --- |
| bit0 `0x1` | **内置/编译表类** | 0x1、0x5 含；0xf 也含 |
| bit1 `0x2` | **外部** | 仅 0xa、0xf |
| bit2 `0x4` | **需展开** | 0x5、0xf、0x14 含 |
| bit3 `0x8` | **APK 类** | 0x8、0xa、0xf |
| bit4 `0x10` | **目录类** | 仅 0x14 |

> **修正第二十三篇**：bit3 不是"APK 类"的充分条件——0x1/0x5 是表类而非 APK 类，
> 但它们不含 bit3，所以"含 bit3 = APK"仍成立；只是"表类"另有 bit0。

---

## 4. `builtin` 与 `compiled` 的语义推测

| | builtin | compiled |
| --- | --- | --- |
| native 迭代器参数 | 1 | 0 |
| 名称 | "内置" | "已编译" |
| 推测内容 | 随 APK 打包的原始预设 | **预编译/压缩后的预设表** |
| type | 0x1 | 0x5（多一个 bit2） |

> bit2（"需展开"）在 compiled 上置位，说明**编译表需要额外解包/解码**。
> 这与"compiled 是预编译产物"的推测自洽。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **单个布尔驱动三处分化** | 一致性有保证 |
| A2 | **`xor 1` 传反向值** | 用同一形参表达两种语义 |
| A3 | **type 用位域区分"表类/APK 类/目录类"** | 一个 int 表三层分类 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **`y(Z)` 的形参语义反转**（`true` 实为 compiled） | 命名与直觉相反，易误读 |
| N2 | 无常量名 | `0x1`/`0x5` 含义需反推 |
| N3 | 两种 scheme 行为相近却分开写 | 代码重复 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | `native_get_compiled_names_iterator(1/0)` 两种参数的返回差异 | **native，硬边界** |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| `builtin:` → `y(false)` | `milk/scanner/B.smali:514-528` |
| `compiled:` → `y(true)` | `B.smali:531-543` |
| `y(Z)` 入口 | `B.smali:1001` |
| `xor-int/lit8 v0, p1, 0x1` | `B.smali:1004` |
| native 迭代器调用 | `B.smali:1010` |
| scheme 字符串分化 | `B.smali:1027-1041` |
| type 分化（0x5 / 0x1） | `B.smali:1052-1061` |
| 容器入库 | `B.smali:1062`（`А(I,String)`） |

> 口径：**build-1025**。
