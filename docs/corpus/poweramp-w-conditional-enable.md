---
doc_id: "ARCH-POWERAMP-W-CONDITIONAL-ENABLE"
title: "插件系统（三十五）：w() 的条件可用性机制（含第三十三篇订正）"
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
  - "docs/corpus/poweramp-w-switch-assembly.md（三十三）"
---

# 插件系统（三十五）：w() 的条件可用性机制

## 0. 一句话结论

读完 `w()` 的完整方法体（80 行）后发现：

**它不是"加一行开关"，而是一个"条件可用性判定器"**——
用 `flags & mask` 判断"该设备是否支持这一项"，支持则启用，不支持则**禁用或移除**。

> 这**推翻了第三十三篇的部分结论**（详见 §4）。

---

## 1. `w()` 的完整逻辑（`:330-410`）

```smali
.method public final w(
    String key, String name, long flags,
    int mask, boolean checked, x0 lsnr, boolean removeIfUnsupported, b1 extra
) Preference

pref = findPreference(name);
if (pref == null) pref = findPreference(joinedKey);   // 双 key 回退
if (pref == null) return null;

if ((flags & (long) mask) != 0) {                     // ★ 支持
    ((TwoStatePreference) pref).setChecked(checked);
    pref.setKey(joinedKey);
    pref.setPersistent(false);
    pref.setOnPreferenceChangeListener(new w0(...));
    pref.setEnabled(true);
} else {                                             // ★ 不支持
    if (removeIfUnsupported) {
        group.removePreference(pref);                // 移除
    } else {
        pref.setEnabled(false);
        ((TwoStatePreference) pref).setChecked(false);   // 禁用并复位
    }
}
return pref;
}
```

### 1.1 参数语义定稿

| 参数 | 类型 | 语义 |
| --- | --- | --- |
| `p1` | `String` | 原始 key |
| `p2` | `String` | 名称（也是首选查找 key） |
| **`p3`** | **`long`** | **设备能力 flags**（64 位！） |
| **`p4`** | **`int`** | **能力掩码** |
| `p5` | `boolean` | 初始是否勾选 |
| `p6` | `x0` | 变更监听器 |
| **`p7`** | **`boolean`** | **不支持时是否移除**（`true` 移除 / `false` 禁用） |
| `p8` | `b1` | 附加参数 |

### 1.2 关键：`flags` 是 **long**（64 位）

`:354` `int-to-long v0, p5` —— 把 int 掩码扩展成 long 后与 `p3` 相与。

> **这印证了第二十八篇的发现**：`c1` 里的检查用了 `0x500000000000000L`（64 位）。
> 现在清楚了——**`w()` 用的就是 64 位 flags**，而 `preference/i.А()` 合成的是 32 位。
> **两者是不同变量，不是同一套位域的两部分。**

---

## 2. ★ 两个 Chromecast 开关的真实差异

| 键 | 掩码 | `p7`（removeIfUnsupported） | 行为 |
| --- | ---: | :---: | --- |
| `no_dvc` | `0x10` | **`0x0`** | 不支持 → **禁用** |
| `cc_force_aa` | **`0x1`** | **`0x1`** | 不支持 → **移除** |
| `cc_show_meta` | **`0x1`** | **`0x1`** | 不支持 → **移除** |

> **差异不在掩码，在 `p7`**：
> 常规音频开关（`no_dvc` 等）不支持时**保留但禁用**（灰显，说明"你的设备不支持"）；
> Chromecast 两项不支持时**直接移除**（因为非 Chromecast 场景下它们毫无意义）。

---

## 3. 掩码含义的最终解读

| 观察 | 解读 |
| --- | --- |
| `flags & mask != 0` → 支持 | mask 的每一位代表**一种设备/插件能力** |
| `no_dvc` = `0x10` | bit4 = "DVC 可用" |
| `cc_force_aa` = `0x1` | bit0 = "Chromecast 可用" |
| `oem_variant` = `0x40000` | bit18 = "OEM 变体可用" |

> **掩码不是"设置项编号"，而是"能力位"**——
> 这解释了为什么不同开关的掩码值差异很大（`0x1` 到 `0x100000`）。

---

## 4. ⚠️ 对第三十三篇的订正

| 第三十三篇说法 | 本轮订正 |
| --- | --- |
| "`0x1` 表示不参与 flags" | ❌ **错**。`0x1` 是**真实的掩码**（bit0 = Chromecast 可用） |
| "Chromecast 独立于本地 flags" | ⚠️ **部分错**。它们同样走 `flags & mask`，只是掩码为 bit0 |
| "7 个掩码 + 2 个独立" | ❌ **应为 9 个掩码**，只是其中 2 个是 bit0 |
| "9 个布尔 vs 7 个掩码数目不一致" | ✅ **仍然成立**，但原因是这 2 项**不支持时被移除**，不进入合成表 |

> **误判原因**：我只看了 `const/4 v5, 0x1` 就下结论"这不是掩码"，
> 没有读 `w()` 的方法体去确认 `p4` 如何被使用。
> 这与之前 `applyStyle(force)` 的误判是**同一类错误**：**先假设再下结论**。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **能力位控制可用性** | 一个方法统一处理"支持/不支持"两种呈现 |
| A2 | **禁用 vs 移除双策略**（`p7`） | 灰显保留信息 vs 彻底隐藏减少干扰 |
| A3 | **不支持时复位 `setChecked(false)`** | 避免残留无效勾选 |
| A4 | **`setPersistent(false)`** | 开关状态另有存储，不走 Preference 持久化 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **`p7` 是布尔开关但无注释** | 调用点只见 `0x0`/`0x1`，不知何意 |
| N2 | 掩码与 `preference/i.А()` 的 32 位 flags 同名不同宽 | 极易混淆（本次就踩坑） |
| N3 | 双 key 回退（`name` → `joinedKey`） | 查找逻辑隐晦 |

---

## 6. 证据索引

| 主题 | 位置 |
| --- | --- |
| `w()` 完整实现 | `preference/c1.smali:330-410` |
| `int-to-long` 掩码扩展 | `c1.smali:354` |
| `flags & mask` 判定 | `c1.smali:356-364` |
| 支持分支 | `c1.smali:366-388` |
| 不支持 → 移除 | `c1.smali:390-397` |
| 不支持 → 禁用 | `c1.smali:399-406` |
| `no_dvc` 传 `p7=0` | `c1.smali:2349` |
| `cc_force_aa` 传 `p7=1` | `c1.smali:2605` |
| `cc_show_meta` 传 `p7=1` | `c1.smali:2643` |

> 口径：**build-1025**。
