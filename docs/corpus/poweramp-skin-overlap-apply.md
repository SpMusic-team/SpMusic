---
doc_id: "ARCH-POWERAMP-SKIN-OVERLAP-APPLY"
title: "插件系统（二十）：overlapAttr 的应用机制与叠加顺序"
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
  - "docs/corpus/poweramp-skin-parsing-chain.md（十二）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/common/j.smali"
---

# 插件系统（二十）：overlapAttr 的应用机制与叠加顺序

## 0. 一句话结论

第十二篇遗留的"`overlapAttr` 多层叠加顺序"本轮闭合：

**不是柔性叠加，而是逐个 `applyStyle(style, true)` 强制应用**——
> `force = true` 表示**覆盖**已有值，因此**后应用的选项覆盖先前的同名属性**。


---

## 1. 应用点（`common/j.applySkinOptionsImpl`，`:1820-1900`）

### 1.1 两条分支

| 分支 | 条件 | 处理 |
| --- | --- | --- |
| **radio/多选组** | `v7 instanceof SkinSelectableSkinOptions` | 用 `О` 字段（组级 style） |
| **单个 option** | 否则 | 用 `Х`（overlapAttr）或 `х`（overlapStyle） |

### 1.2 单选项的三级判定（`:1846-1892`）

```smali
if (prefs.getBoolean(key, option.X)) {          // 该选项被选中
    if (option.Х /* overlapAttr */ != 0) {
        style = AUtils.F(theme, option.Х);       // attr -> style id
        if (style != 0) {
            theme.applyStyle(style, true);       // ★ 强制覆盖（v10=1）
        } else {
            Log.e(tag, "applySkinOptionsImpl bad style for option=" + option);
        }
    } else if (option.х /* overlapStyle */ != 0) {
        theme.applyStyle(option.х, true);          // ★ 强制覆盖（v10=1）
    }
}
```

| 字段 | 类型 | 路径 |
| --- | --- | --- |
| `Х`（overlapAttr） | attr 资源 id | **先 `AUtils.F()` 转成 style**，再 applyStyle |
| `х`（overlapStyle） | style 资源 id | **直接 applyStyle** |

> **两者互斥**：`overlapAttr != 0` 时走前者，否则才看 `overlapStyle`。
> 同一 option 同时写两个 attr/style 时，**`overlapAttr` 优先**。

---

## 2. ★ `AUtils.F(Theme, attr)` —— attr 转 style（`:324-387`）

```smali
.method public static F(Theme theme, int attrId) int
    if (attrId == 0) return 0;
    try {
        TypedValue tv = t.А;                        // 复用的 TypedValue
        if (theme.resolveAttribute(attrId, tv, true)) {
            return tv.resourceId;                   // ★ 取该 attr 指向的资源 id
        }
    } catch (Exception e) {
        Log.e(tag, "attr=0x" + Integer.toHexString(attrId) + " " + AUtils.g(attrId, res));
    }
    return 0;
}
```

> **`resolveAttribute(attrId, tv, true)`** 在当前主题里解析该 attr 的**实际取值**，
> 取到的 `resourceId` 就是应该 applyStyle 的 style id。
> 这是"**间接引用**"——`overlapAttr` 存的是 attr，实际样式由当前主题决定。

### 2.1 间接引用的意义

| 直接写 overlapStyle | 间接写 overlapAttr |
| --- | --- |
| 固定指向某个 style | **由当前主题决定指向哪个 style** |
| 换主题后仍是同一个 style | 换主题后自动指向新主题的对应 style |

> 这让**同一个 skin XML 可适配 Light/Black 两套主题**。
> 也解释了为什么 `attrs.xml` 里有 16 个 `overlap_*` 属性——它们在**每个主题里指向不同的 style**。

---

## 3. ★ 叠加顺序结论

### 3.1 `applyStyle(id, true)` 的语义（已实测）

Android `Theme.applyStyle(int resId, boolean force)`：

| force | 行为 |
| --- | --- |
| `true` | **强制覆盖**已存在的属性值 |
| **`false`** | 只填充**尚未设置**的属性 |

> **实测 `v10 = 0x1`（`:1636` `const/4 v10, 0x1`）**，即 `force = true`。
> 三处 `applyStyle` 传的都是这个 `v10`。

### 3.2 因此叠加规则是

```
按 XML 中 option 的出现顺序依次 applyStyle(style, true)
  → 后处理的选项覆盖先前的同名属性
  → 最终以【最后被选中且设置该属性】的选项为准
```

| 场景 | 结果 |
| --- | --- |
| 两个选项都设 `colorAccent` | **后处理的生效** |
| 选项 A 设 `colorAccent`，B 设 `textColor` | 两者都生效 |
| 选项 A 设了 `textColor`，B 也设了 | B 覆盖 A |

> **是"后者覆盖前者"**，与 CSS 层叠顺序一致。
> 先到先得的前提是 `force = false`，但实测为 `true`。

---

## 4. 完整应用链

```
skin XML:  <option overlapAttr="@attr/xxx" />
    down 解析（SkinInfo.K）
SkinOption.Х = attr 的 id
    down 用户选中该项
j.applySkinOptionsImpl
    down AUtils.F(theme, attr)
theme.resolveAttribute(attr, tv, true)
    down 得到 tv.resourceId（当前主题下的 style）
theme.applyStyle(style, true)    // 强制覆盖
```

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **`overlapAttr` 间接引用** | 同一 XML 适配多主题 |
| A2 | **`applyStyle(..., true)` 强制** | 后处理的选项确实生效，符合"最后选择生效"直觉 |
| A3 | **attr 优先于 style** | 间接引用更灵活，作为首选 |
| A4 | **解析失败有明确日志**（`bad style for option=`） | 可定位坏 skin |
| A5 | **`TypedValue` 复用静态实例** | 避免高频分配 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 选项间顺序敏感 | 同一属性多处设置时，靠 XML 顺序决定胜负 |
| N2 | attr/style 互斥但无文档 | 同时写时只有 attr 生效 |
| N3 | 复用的静态 `TypedValue` | 非线程安全 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| （无） | 原 Q1 已闭合 | `v10 = 0x1`（`:1636`），`force = true` |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| 应用方法 | `audioplayer/common/j.smali:1820-1900`（`applySkinOptionsImpl`） |
| 组级分支 | `j.smali:1822-1842`（`SkinSelectableSkinOptions.О`） |
| 单选项分支 | `j.smali:1846-1892` |
| overlapAttr 读取 | `j.smali:1854` |
| attr 转 style | `j.smali:1858`（`AUtils.F`） |
| applyStyle（attr 路径） | `j.smali:1864` |
| 失败日志 | `j.smali:1871` |
| overlapStyle 读取 | `j.smali:1886` |
| applyStyle（style 路径） | `j.smali:1890` |
| **`force` 参数 = true** | `j.smali:1636`（`const/4 v10, 0x1`） |
| `AUtils.F` | `utils/AUtils.smali:324-387` |
| `resolveAttribute` | `AUtils.smali:334` |

> 口径：**build-1025**。
