---
doc_id: "ARCH-POWERAMP-OUTPUT-OPTS-BITFIELD"
title: "插件系统（二十四）：OutputOpts flags 位域与 0x1010 语义"
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
  - "docs/architecture/poweramp-plugin-output-selection.md（十一）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/preference/i.smali"
---

# 插件系统（二十四）：OutputOpts flags 位域与 0x1010 语义

## 0. 一句话结论

第十一篇遗留的 `flags & 0x1010` 本轮闭合：

`flags` 不是插件标志，而是**由 9 个用户偏好布尔值合成的音频输出选项位域**
（`preference/i.А(ByteBuffer, H)`，`:322-466`）。
`0x1010` 从中提取 **bit4（0x10）+ bit12（0x1000）** 两项传给 `OutputOpts`。

---

## 1. 位域合成表（`i.А()`，`:322-466`）

9 个 `preference/H` 字段依次读入后 `or-int` 合成：

| 序 | 逐位 or | 掩码 | 来源字段 | 类型 |
| ---: | ---: | ---: | --- | --- |
| 1 | `:387` | **0x80** | `H.р` | boolean |
| 2 | `:392` | **0x20** | `H.p` | boolean |
| 3 | `:397` | **0x40** | `H.О` | boolean |
| 4 | `:406` | **0x1000** | （`prefs/В.J1` 全局偏好） | boolean |
| 5 | `:413` | 变量 | `H.O` | boolean |
| 6 | `:418` | **0x2000** | `H.о` | boolean |
| 7 | `:425` | 变量 | `H.o` | boolean |
| 8 | `:432` | 变量 | `H.C` | boolean |
| 9 | `:465` | `return v3` | — | — |

### 1.1 各掩码的二进制

```
0x20   = 0000 0010 0000   bit5
0x40   = 0000 0100 0000   bit6
0x80   = 0000 1000 0000   bit7
0x1000 = 0001 0000 0000   bit12  ★ 属于 0x1010
0x2000 = 0010 0000 0000   bit13

0x1010 = 0001 0000 0001 0000  = bit12 + bit4
```

---

## 2. ★ `0x1010` 的两项

| 位 | 掩码 | 来源 | 是否在合成表内 |
| --- | ---: | --- | :---: |
| **bit12** | `0x1000` | `prefs/В.J1`（全局偏好） | ✅ `:406` |
| **bit4** | `0x10` | **不在合成表内** | ❌ |

> **bit4 的来源未被 `i.А()` 设置**——说明它由别的路径（可能是 native 或其它偏好）注入。
> 这是本轮的一处**未闭合点**，已记为 Q1。

### 2.1 bit12 的具体含义

`prefs/В.J1` 是全局偏好之一。查询其键名可确定语义（下一步）。

---

## 3. `OutputOpts` 的 8 个字段（第十一篇遗留）

结合 `processing/А` 的构造签名与 `i.А()` 的读取顺序：

| 参数 | 类型 | 来源 |
| --- | --- | --- |
| p1 | `NativePluginInfo` | 选中的插件（第十一篇） |
| p2 | `int` | `device`（设备 id 0..5） |
| p3 | `int` | 另一 int 参数 |
| p4 | `byte[]` | `ByteBuffer.array()`（输出参数原始字节） |
| **p5** | `boolean` | **传入的 `flag` 形参**（`r.К` 的第 5 参） |
| p6 | `String` | 字符串参数 |
| p7 | `String` | 字符串参数 |
| p8 | `int` | `flags & 0x1010` |

> 第 8 个参数**接收 `0x1010` 的取值**——即"bit12 + bit4"两项输出选项。

---

## 4. 完整链路

```
用户偏好（preference/H 的 9 个布尔 + prefs/В.J1）
    down i.А(ByteBuffer, H)
flags = 0x20|0x40|0x80|0x1000|0x2000|...   （9 项 or 合成）
    down r.К(device, name, ..., flag)
optsFlags = flags & 0x1010                    （取 bit12 + bit4）
    down
new processing/А(plugin, device, p3, bytes, p5, p6, p7, optsFlags)
```

> **`0x1010` 是一个"筛选"而非"全部"**——9 个选项里只有 2 个进入 OutputOpts，
> 其余 7 个留在偏好里供其它模块读取。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **布尔选项合成位域** | 一个 int 传 9 项，免多参数 |
| A2 | **下游再筛选 `& mask`** | 各模块只取自己关心的位 |
| A3 | **`or-int/lit16` 一次性置位** | 代码紧凑 |
| A4 | **全局偏好参与合成**（`prefs/В.J1`） | 全局与单项选项统一表达 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **位含义全靠反推** | 无常量名，`0x80`/`0x20` 不知所谓 |
| N2 | **bit4 无设置点** | 来源不明（可能是 native） |
| N3 | 9 个字段逐个 or | 增删需改多处 |
| N4 | `flags` 一词在插件系统里**另有含义** | 与 `NativePluginInfo.flags` 同名易混 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | **bit4（`0x10`）由谁设置** | 不在 `i.А()` 合成表内；**UI 侧确认对应 `no_dvc`**（三十三），但写入路径仍未知 |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| 位域合成 | `preference/i.smali:322-466`（`А(ByteBuffer,H)`） |
| `or 0x80` | `i.smali:387` |
| `or 0x20` | `i.smali:392` |
| `or 0x40` | `i.smali:397` |
| `or 0x1000` | `i.smali:406` |
| `or 0x2000` | `i.smali:418` |
| 返回 | `i.smali:465` |
| 读取 9 字段 | `i.smali:325-363`（`H.C` 在 `:361-363`） |
| `& 0x1010` | `audioplayer/player/r.smali:1953` |
| `r.К` 内 flags 来源 | `r.smali:1707-1709` |

> 口径：**build-1025**。
