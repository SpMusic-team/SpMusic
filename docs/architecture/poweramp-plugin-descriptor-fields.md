---
doc_id: "ARCH-POWERAMP-PLUGIN-DESCRIPTOR-FIELDS"
title: "插件系统（十）：描述符字段语义与 StateBus 当前插件链"
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
  - "docs/architecture/poweramp-plugin-system.md（一）"
  - "docs/architecture/poweramp-plugin-device-binding.md（三）"
---

# 插件系统（十）：描述符字段语义与 StateBus 当前插件链

## 0. 一句话结论

两个此前未解的点在本轮全部闭合：

| 原问题 | 答案 |
| --- | --- |
| `plugin/х` 的 `x`/`y`/`A` 字段是什么 | **三个 XML 属性的资源 id**：`description` / `info` / `name` |
| `StateBus` 的 `0x7f0d00b4` 由谁写入 | **没有写入点**——它是**实时计算**的只读状态 |

---

## 1. ★ `plugin/х` 字段语义（实测反推）

`router/A.y` 里三处 `iput` 都用 **`AttributeSet.getAttributeResourceValue`**：

```smali
// :2710-2714  (属性 "name")
A = attrs.getAttributeResourceValue(i, 0);      // ★ name 的资源 id
х.A = A;

// :3131-3135 (属性 "description")
x = attrs.getAttributeResourceValue(i, 0);      // ★ description 的资源 id
х.x = x;

// :3158-3162 (属性 "info")
y = attrs.getAttributeResourceValue(i, 0);      // ★ info 的资源 id
х.y = y;
```

### 1.1 完整字段表（本轮更新）

| 字段 | 类型 | 语义 | 依据 |
| --- | --- | --- | --- |
| `A` | `int` | **`name` 属性资源 id** | `:2714`，属性 `"name"` |
| `B` | `String` | **`name` 的字面量值**（`toString()` 返回它） | `х.toString()` `:38-40` |
| `X` | `String` | **uniqName** | `:3125`（属性 `uniqName`） |
| `K` | `int` | **type 值**（`NativePluginManager.X` 解析） | `:3036` |
| `x` | `int` | **`description` 资源 id** | `:3135` |
| `y` | `int` | **`info` 资源 id** | `:3162` |
| `P` / `Н` / `р` | `String` | author / description / info 的**字面量** | 结构推断 |
| `p` | `boolean` | **`hidden`** | `k0` 里 `if (p) remove()` |

> **⚠️ 完全否证**：`P`/`Н`/`р` **不是** author/description/info 字面量。
> 实测 `P`=lib 元素值、`р`=libBasePath、`Н` 全库零引用（死字段）。
> 详见 `poweramp-plugin-lib-declaration.md`（十八）与 `poweramp-plugin-residual-closure.md`（二十一）。

### 1.2 双轨命名机制（`х.В(Context)`）

```smali
.method public final В(Context ctx) String
    if (A != 0) {                       // 有资源 id
        s = ctx.getString(A);           // ★ 走资源，可本地化
        return (s != null) ? s : "";
    }
    return B;                            // 否则用字面量
}
```

> **这就是第八篇"6 个用 @string / 14 个用字面量"的机制层面解释**：
> 资源引用时 `A != 0`，字面量时 `A == 0`，同一个字段两条路径。

> **⚠️ 部分订正**：`A`/`B` 的**最终值来自 `<lib name>`**，不是插件显示名。
> 详见 `poweramp-plugin-lib-declaration.md` 第十八篇。

### 1.3 三个属性都支持资源引用的意义

| 属性 | 资源 id 字段 | 字面量字段 |
| --- | --- | --- |
| `name` | `A` | `B` |
| `description` | `x` | `Н`（推断） |
| `info` | `y` | `р`（推断） |

> **外部 pak 完全可以用 `@string/` 让插件名多语言**——
> 这也印证第一篇的 `getResourcesForApplication` 跨包读资源机制。

---

## 2. ★ StateBus `0x7f0d00b4` 是计算属性（无写入点）

### 2.1 全库仅 4 处引用

| 位置 | 角色 |
| --- | --- |
| `preference/k0.smali:248` | **读**（插件列表打勾） |
| `preference/k0.smali:1019` | **读**（同上） |
| `preference/c1.smali:568` | **读**（设备选项页高亮） |
| `widget/player/t1.smali:878` | **实现**（`getIntState` 的 provider） |

**没有任何 `setIntState`** —— 它是**计算出来的**。

### 2.2 计算链（`widget/player/t1.getIntState()`，`:878-890`）

```smali
case 0x7f0d00b4 /* state_player_output_plugin_id */:
    p1 = this.o;                              // widget/player/p1
    return p1.у.В.id;                         // ★ 当前输出插件的 id
    //  p1.у : audioplayer/processing/А
    //  .В   : NativePluginInfo
    //  .id  : int
F

### 2.3 同族状态一览（同一 switch 内）

| 状态 id | 含义 | 来源 |
| --- | --- | --- |
| `0x7f0d00b1` | （未解析） | `p1.A` |
| **`0x7f0d00b4`** | **当前输出插件 id** | `p1.у.В.id` |
| `0x7f0d00bb` | 子项索引 | （c1 读取） |
| `0x7f0d04ff` | 布尔/整数状态 | `m1.В.В` |

> **`processing/А.В` 就是当前生效的 `NativePluginInfo`**——
> 这个字段是音频处理链的"当前输出插件"持有者。

---

## 3. 完整"当前插件"读取链

```
audioplayer/processing/А.В   (NativePluginInfo)
        │
        ▼
widget/player/t1.getIntState(0x7f0d00b4)
        │  返回 .id
        ▼
    ┌───┴────┐
    ▼        ▼
k0 (列表打勾)  c1 (选项页高亮)
    │
    ▼
与 plugin/х.X (uniqName) 比较 → 相同则 setWidgetLayoutResource(勾)
```

---

## 4. 可借鉴 / 不建议照抄

### 4.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **每个文本属性都有"资源 id + 字面量"双字段** | 外部 pak 可自由选择是否本地化 |
| A2 | **`A != 0` 作资源判定** | 简单可靠，无需额外标志位 |
| A3 | **StateBus 用计算属性而非缓存** | 无需同步，永远反映当前真实状态 |
| A4 | **单一数据源 `processing/А.В`** | 只有一个"当前插件"持有者 |

### 4.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | `getAttributeResourceValue` **只取 id，不取字面量** | 需另一条路径取字面量，代码分裂 |
| N2 | `х` 类的字段名无语义（`A`/`B`/`x`/`y`/`X`/`K`/`P`/`Н`/`р`） | 必须靠 `iput` 上下文反推 |
| N3 | StateBus 状态 id 是裸 int（`0x7f0d00b4`） | 无枚举，靠常量名对照 |

---

## 5. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`P`/`Н`/`р` 来源~~ | ✅ **已闭合**（十八 + 二十一篇）：`P`=lib 值、`р`=`libBasePath`、**`Н` 零引用死字段** |
| ~~Q2~~ | ~~`processing/А.В` 赋值点~~ | ✅ **已闭合**（十一）：唯一构造点在 `player/r.К()` `:1955` |

---

## 6. 证据索引

| 主题 | 位置 |
| --- | --- |
| `A` = name 资源 id | `player/router/A.smali:2710-2714` |
| `x` = description 资源 id | `router/A.smali:3131-3135` |
| `y` = info 资源 id | `router/A.smali:3158-3162` |
| 属性名分派表 | `router/A.smali:3082`（author）、`:3105`（description）、`:3140`（info）、`:3167`（hidden） |
| 双轨命名 | `plugin/х.smali:43-67`（`В(Context)`） |
| `toString` 返回 `B` | `plugin/х.smali:35-41` |
| StateBus 实现 | `widget/player/t1.smali:878-890` |
| 状态名 | `0x7f0d00b4` = `state_player_output_plugin_id` |
| 数据源 | `audioplayer/processing/А.В`（`NativePluginInfo`） |
| 读取方 | `preference/k0.smali:248`/`:1019`、`preference/c1.smali:568` |

> 口径：**build-1025**。
