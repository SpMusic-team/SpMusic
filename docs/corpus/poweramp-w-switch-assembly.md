---
doc_id: "ARCH-POWERAMP-W-SWITCH-ASSEMBLY"
title: "插件系统（三十三）：w() 开关装配与掩码语义"
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
  - "docs/corpus/poweramp-audio-flags-matrix.md（二十八）"
---

# 插件系统（三十三）：w() 开关装配与掩码语义

## 0. 一句话结论

第二十八篇遗留的"`cc_force_aa`/`cc_show_meta` 掩码未取到"本轮闭合：

> ⚠️ **本节初稿结论已订正**：`0x1` **不是**"独立开关"，而是**真实掩码**（bit0 = Chromecast 可用）。
> 真正的差异在 `p7`（不支持时**移除**而非禁用）。详见 `poweramp-w-conditional-enable.md`（三十五）。

---

## 1. `w()` 的完整签名（`:330`）

```smali
.method public final w(
    String  key,        // p1  偏好键
    String  name,       // p2  标题
    long    time,       // p3  时间戳
    int     a,          // p4  ★ 掩码或 0x1
    boolean b,          // p5
    x0      listener,   // p6
    boolean c,          // p7
    b1      extra       // p8
) Preference
```

> **10 个参数**（含 `this`）——这是 `c1` 里最重的装配方法。

---

## 2. ★ 第 4 参数（掩码）的两种用法

### 2.1 传位掩码（参与 flags）

| 键 | 第 4 参 | 位 | `const` 位置 |
| --- | ---: | ---: | ---: |
| `oem_variant` | `0x40000` | bit18 | `:2306` |
| `no_dvc` | `0x10` | bit4 | `:2347` |
| `no_headroom` | `0x20` | bit5 | `:2417` |
| `no_equ` | `0x40` | bit6 | `:2437` |
| `float` | `0x80` | bit7 | `:2455` |
| `no_duck` | `0x2000` | bit13 | `:2544` |
| `no_af` | `0x100000` | bit20 | `:2560` |

### 2.2 传 `0x1`（bit0 掩码）

| 键 | 掩码 | `p7` | 不支持时 |
| --- | ---: | :---: | --- |
| `no_dvc` | `0x10` | `0x0` | **禁用（灰显）** |
| `cc_force_aa` | `0x1` | `0x1` | **移除** |
| `cc_show_meta` | `0x1` | `0x1` | **移除** |

> ⚠️ **本篇初稿误判为「不参与 flags」**。
> 实际 `0x1` 是 bit0 掩码，真正差异在 `p7`（见 §2.3）。
> **订正详见 `poweramp-w-conditional-enable.md`（三十五）。**
--- | ---: | ---: |
| `cc_force_aa` | **`0x1`** | `:2603` |
| `cc_show_meta` | **`0x1`** | `:2641` |

> **两者都用 `const/4 v5, 0x1`**，与掩码开关的 `const/16 v5, 0xNN` 形成鲜明对比。

### 2.3 为什么 Chromecast 用 bit0 + 移除策略

| 理由 | 说明 |
| --- | --- |
| **bit0 = Chromecast 可用** | 与其他位并列，是真实能力位 |
| **移除而非禁用** | 非 Chromecast 场景下这两个开关毫无意义，灰显只会干扰 |
| **状态另存** | `prefs/В.Q1` / `u2`，不走 Preference 持久化 |
--- | --- |
| 第 4 参为 `0x1` | **不是掩码**（掩码不会恰好都是 bit0） |
| 状态另有来源 | 分别来自 `prefs/В.Q1`（`:2591`）与 `prefs/В.u2`（`:2629`） |
| 用途 | Chromecast 是**网络投送**，其参数不走本地音频管线 |

> **合理**：`flags` 位域描述的是"本地音频输出选项"，
> Chromecast 走 `output.cc` 插件与远端协议，不需要本地位标记。

---

## 3. 九个开关的完整对照

| # | 键 | 第 4 参 | 类型 | 状态源 |
| ---: | --- | ---: | --- | --- |
| 1 | `oem_variant` | `0x40000` | 掩码 | FastPrefs |
| 2 | `no_dvc` | `0x10` | 掩码 | `H.р` |
| 3 | `no_headroom` | `0x20` | 掩码 | `H.p` |
| 4 | `no_equ` | `0x40` | 掩码 | `H.О` |
| 5 | `float` | `0x80` | 掩码 | `H.O` |
| 6 | `no_duck` | `0x2000` | 掩码 | `H.о` |
| 7 | `no_af` | `0x100000` | 掩码 | `H.o` |
| 8 | **`cc_force_aa`** | **`0x1`** | **独立** | **`prefs/В.Q1`** |
| 9 | **`cc_show_meta`** | **`0x1`** | **独立** | **`prefs/В.u2`** |

> **9 个掩码**（其中 2 个是 bit0，对应 Chromecast）。
> 而第二十四篇的合成表有 9 个布尔——两者数目相同但不完全重合：
> **2 个 Chromecast 开关不支持时会被移除**，故不进入合成。
>
> ⚠️ 本节初稿曾写"7 个掩码 + 2 个独立"，已订正（详见第三十五篇）。

---

## 4. 位分配全表（含此前未归位的位）

| 位 | 掩码 | 用途 | 来源 |
| ---: | ---: | --- | --- |
| bit4 | `0x10` | `no_dvc` | UI（`:2347`） |
| bit5 | `0x20` | `no_headroom` | UI + 合成 |
| bit6 | `0x40` | `no_equ` | UI + 合成 |
| bit7 | `0x80` | `float` | UI + 合成 |
| bit12 | `0x1000` | （合成表独有） | `prefs/В.J1`（`:406`） |
| bit13 | `0x2000` | `no_duck` | UI + 合成 |
| bit18 | `0x40000` | `oem_variant` | UI（`:2306`） |
| bit20 | `0x100000` | `no_af` | UI（`:2560`） |

> **bit4 与 bit12 是"单侧"位**：
> - bit4（`no_dvc`）**UI 有、合成表无**
> - bit12 **合成表有、UI 无**
>
> 这解释了 `0x1010`（bit12 + bit4）为何特殊——它恰好取两个"单侧"位。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **一个 `w()` 覆盖 9 个开关** | 装配逻辑只写一份 |
| A2 | **第 4 参兼任"掩码/独立"双语义** | 紧凑（但也牺牲可读性） |
| A3 | **Chromecast 独立于本地 flags** | 概念上正确 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **第 4 参语义重载**（掩码 or `0x1`） | 无法从签名判断，需看实参 |
| N2 | 10 参数方法 | 调用点难读 |
| N3 | `0x1` 作为"无掩码"哨兵 | 与真实 bit0 无法区分 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`w()` 布尔参数~~ | ✅ **已闭合**（三十五）：`p5`=初始勾选、`p7`=不支持时移除（`true`）或禁用（`false`） |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| `w()` 签名 | `preference/c1.smali:330` |
| 掩码开关常量 | `c1.smali:2306/2347/2417/2437/2455/2544/2560` |
| **`cc_force_aa` 传 0x1** | `c1.smali:2601-2609` |
| **`cc_show_meta` 传 0x1** | `c1.smali:2639-2647` |
| Chromecast 状态源 | `c1.smali:2591`（`В.Q1`）、`:2629`（`В.u2`） |
| 合成表 | `preference/i.smali:322-466` |

> 口径：**build-1025**。
