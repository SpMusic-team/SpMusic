---
doc_id: "ARCH-POWERAMP-PAK-FILENAME-PARSING"
title: "插件系统（十七）：pak 预设文件名解析算法"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/corpus/poweramp-pak-data-model.md（十五）"
  - ".rea-analysis/smali/smali/com/google/android/gms/cast/framework/media/Н.smali"
---

# 插件系统（十七）：pak 预设文件名解析算法

## 0. 一句话结论

第十五篇的 `Р` 字段（"分隔数组"）本轮闭合：

**它不是分隔符表，而是输出参数**——`Р = new String[2]`，接收 `name` 与 `author`。
真正的解析逻辑在 `Н.h(String, String[])`（144 行），
**从文件名中按多级规则切出"作者"与"名称"**。

---

## 1. 输入与输出

```smali
// 调用方（milk/scanner/B.K() :441-449）
String[] out = Р;               // new String[2]
Н.h(zipEntryName, out);
author = out[0];                // → INSERT bindString(3) = author 列
name   = out[1];                // → INSERT bindString(4) = name 列
```

| 输出 | 字段 | 写入列 |
| --- | --- | --- |
| `out[0]` | 作者 | `milk_presets.author` |
| `out[1]` | 名称 | `milk_presets.name` |

> ⚠️ **与第十五篇的推断相反**：`parts[0]` 是 **author**，`parts[1]` 是 **name**。
> 第十五篇按 `bindString` 序号推测为 `parts[0]→name`，本轮按实际 `aput` 顺序订正。

---

## 2. ★ 解析算法（`Н.h()`，`:66-210`）

### 2.1 第一步：去掉目录前缀（`:69-95`）

```smali
slash = s.indexOf(0x2f /* / */);
if (slash != -1 && slash < s.length() - 1) {
    s = s.substring(slash + 1);        // 只保留最后一个斜杠之后
}
```

> 与第十四篇的 `assets/milk_presets/` 前缀呼应：**扫描时带前缀，解析时剥离**。

### 2.2 第二步：定位三个锚点（`:96-116`）

| 变量 | 计算 | 含义 |
| --- | --- | --- |
| `v0` | `s.indexOf(" - ")` | **破折号分隔符位置** |
| `v3` | `s.lastIndexOf(0x2e /* . */)` | **最后一个点**（扩展名前） |
| — | 若 `v3 == -1` 则 `v3 = s.length()` | 无扩展名时取末尾 |

### 2.3 第三步：计算分隔符长度 `v5`（`:117-163`）

这是最复杂的部分——**按" - "之后的内容再细分**：

```smali
if (v0 > 0 /* 有 " - " */) {
    space = s.indexOf(" ");
    dash  = s.indexOf("-");
    under = s.indexOf("_");
    if (space <= 0 && dash <= 0 && under == 0 && s.length() > 2) {
        under = s.indexOf("_", under + 1);   // 找第二个下划线
    }
    v5 = 1;                               // 分隔符长度 1
} else {
    v5 = 3;                               // " - " 长度 3
}
```

> **`v5` 是分隔符的字节长度**：有 " - " 时用 3，否则按单字符（空格/短横/下划线）算 1。

### 2.4 第四步：切分（`:164-187`）

```smali
if (v0 != -1) {
    v2 = s.substring(0, v0);              // 前半 → 疑似 author
    p0 = s.substring(v0 + v5, v3);        // 后半 → 疑似 name
} else {
    p0 = s.substring(0, v3);              // 无分隔 → 整段为 name
    v2 = "";                              //          author 为空
}
```

### 2.5 第五步：清理返回值（`:188-209`）

```smali
if (v2.length() > 1 && v2.startsWith("_"))
    v2 = v2.substring(1);                 // 去掉前导下划线
out[0] = p0;      // ★ 注意：aput 顺序是 p0 先、v2 后
out[1] = v2;
```

> **这里是关键细节**：`out[0] = p0`（后半段），`out[1] = v2`（前半段）。
> 即**文件名前半是作者、后半是名称**，但输出数组顺序相反。
> 这与调用方 `bindString(3)=author ← out[0]` 语义一致。

---

## 3. 文件名格式规范（反推）

综合算法可得 pak 内预设文件的命名约定：

```
assets/milk_presets/<...>/<名称> - <作者>.milk
                              └──┬──┘   └──┬──┘
                                 名称      作者
```

若没有 " - " 分隔：

```
assets/milk_presets/<名称>.milk        → author = ""
```

| 形态 | author | name |
| --- | --- | --- |
| `A - B.milk` | `B` | `A` |
| `A.milk` | `""` | `A` |
| `dir/A - B.milk` | `B` | `A` |

> **注意顺序**：文件名里是 `名称 - 作者`，不是 `作者 - 名称`。
> 这与常见的"Artist - Title"惯例相反，容易误判。

---

## 4. 算法的鲁棒性分析

| 输入 | 结果 | 评价 |
| --- | --- | --- |
| `A - B.milk` | author=`B`, name=`A` | ✅ 正常 |
| `A.milk` | author=`""`, name=`A` | ✅ 兜底 |
| `A-B.milk` | v0=indexOf(" - ")=-1 → author=`""` | ⚠️ 单短横不识别 |
| `A - B - C.milk` | name 取到第二个 " - " 之前 | ⚠️ 可能截断 |
| `_A - B.milk` | author=`"_B"` → 去前导下划线 → `"B"` | ✅ 已处理 |
| `A - .milk` | name = `""` | ⚠️ 空名 |

> **只认三个字符的 `" - "`**（空格-短横-空格）。
> 文件名里用单短横 `-` 不带空格时**不会被识别为分隔符**。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **输出参数复用同一数组** | 零分配 |
| A2 | **剥离目录前缀** | 支持任意深度的子目录 |
| A3 | **`lastIndexOf(".")` 去扩展名** | 名称里可含点 |
| A4 | **无分隔符时 author 置空** | 优雅降级 |
| A5 | **去前导下划线** | 兼容 `_Artist` 写法 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **只认 `" - "`**（含空格） | 单短横文件名全归 author="" |
| N2 | 复用 `Р` 数组跨多次调用 | 非线程安全 |
| N3 | `v5` 逻辑绕（三个 indexOf 组合） | 难维护 |
| N4 | `name - author` 顺序反直觉 | 易与 `artist - title` 混淆 |
| N5 | 无长度/非法字符校验 | 可能写入超长字符串 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`under` 二次查找~~ | ✅ **已闭合**（三十六）：**它就是分隔位置**（`v0 = indexOf("_", v0+1)`），用于跳过前导下划线 |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| `Р` 定义 | `milk/scanner/B.smali:30`（`final [Ljava/lang/String;`）、`:45-49`（`new String[2]`） |
| 调用点 | `B.smali:441-449` |
| `out[0]`=author | `B.smali:457-459`（`bindString(3)`） |
| `out[1]`=name | `B.smali:463-465`（`bindString(4)`） |
| 解析算法 | `com/google/android/gms/cast/framework/media/Н.smali:66-210`（`h`） |
| 去目录前缀 | `Н.smali:69-95` |
| 锚点定位 | `Н.smali:96-116` |
| 分隔符长度 | `Н.smali:117-163` |
| 切分 | `Н.smali:164-187` |
| 清理与输出 | `Н.smali:188-209` |

> 口径：**build-1025**。
