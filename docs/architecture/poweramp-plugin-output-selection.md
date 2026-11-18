---
doc_id: "ARCH-POWERAMP-PLUGIN-OUTPUT-SELECTION"
title: "插件系统（十一）：输出插件选择链与 OutputOpts"
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
  - "docs/architecture/poweramp-plugin-descriptor-fields.md（十）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/player/r.smali"
---

# 插件系统（十一）：输出插件选择链与 OutputOpts

## 0. 一句话结论

第十篇留下的"`processing/А.В` 何时被赋值"本轮闭合：

**`processing/А` 是 `OutputOpts` 值对象，全库只有一个构造点**
——`player/r.К(int, String, String, String, boolean)`。

该方法实现了**四级降级选择链**，任一环节失败都有明确日志与兜底。

---

## 1. `processing/А` 是 OutputOpts（`toString` 自证）

```smali
.method public final toString()Ljava/lang/String;
    sb = new StringBuilder("OutputOpts");
    sb += Integer.toHexString(hashCode());
    sb += "{outputPlugin=" + this.В;
    sb += ", routedDeviceName='" ...
}
```

### 1.1 字段表

| 字段 | 类型 | 构造参数 | 推测语义 |
| --- | --- | --- | --- |
| `А` | `boolean` | p5 | 某布尔开关 |
| `B` | `byte[]` | p4 | 输出参数原始字节 |
| `X` | `String` | p7 | 字符串参数 |
| `x` | `int` | p8 | int 参数 |
| **`В`** | **`NativePluginInfo`** | **p1** | **★ 当前输出插件** |
| `Х` | `String` | p6 | 字符串参数 |
| `х` | `int` | p2 | int 参数 |
| （`A`） | `int` | p3 | int 参数 |
| `y` | static | — | 空实例（`NULL` 插件 + `0xff`） |

**构造签名**（`:56`）：

```smali
<init>(NativePluginInfo, int, int, byte[], boolean, String, String, int)
F

### 1.2 空实例（`<clinit>` `:28-53`）

```smali
new А(NativePluginInfo.NULL,   // ← 空插件
      0xff,                    // ← 哨兵
      0, 0 /* null bytes */, 0, "", "", 0);
А.y = that;                    // 静态单例
```

> `0xff` 再次出现（第十篇的 `c1` 也用 `0xff` 作"非当前"哨兵）。

---

## 2. ★ 四级降级选择链（`r.К()`，`:1670-1987`）

方法签名：

```smali
.method public К(int device, String selectedName, String deviceName,
                 String profileName, boolean flag) OutputOpts
```

### 2.1 第 1 级：按名字查表

```smali
npm = this.X (NativePluginManager);
info = npm.х(selectedName);                        // ① 按 uniqName 查
if (info == null) {
    Log.e(tag, "no selected output plugin found, using default");
} else if ((info.flags & (-0x7ffffffd)) == 0) {   // ② 必须是 INTERNAL_OUTPUT
    Log.e(tag, "bad internal selected output plugin found, using default");
}
```

> **第②步是关键**：`info.flags & 0x80000003` —— 用**位与**判断
> "是不是内置输出插件"。非输出类型一律拒绝。

### 2.2 第 2 级：回退到 `output.osl`

```smali
if (info == null) {
    info = npm.х("com.maxmpz.audioplayer/output.osl");   // ③ 默认 OpenSL
    if (info == null || (info.flags & 0x3) == 0) {        // ④ 且必须是输出类型
        throw new RuntimeException("no/bad default output plugin=" + info);
    }
}
```

> **第④步用 `& 0x3`**（不是 `0x80000003`）—— 表示"外部或内置的输出类"。
> 与第②步的严格校验形成对比：默认插件可以是**外部**的。

### 2.3 第 3 级：设备合法性


```smali
// :1975-1986
:cond_9
throw new RuntimeException("bad device=" + device);
```

> 设备 id 非法时直接抛异常（不会降级）。

### 2.4 第 4 级：构造 OutputOpts

```smali
// :1953-1973
flags = (v6 & 0x1010);                    // ★ 位掩码提取
opts  = new А(
    info,                                  // В = 选中的插件
    p1 (device),                           // х
    p3,                                    // A
    byteBuffer.array(),                    // B = 原始字节
    p5,                                    // А
    p6, p7, p8
return opts;
```

> `0x1010` 位掩码（bit4 + bit12）从日志里的 `flags` 提取，用于传给 OutputOpts。

### 2.5 完整降级表

| 级 | 条件 | 结果 | 日志 |
| ---: | --- | --- | --- |
| 1 | `npm.х(name)` 命中且 `flags & 0x80000003 != 0` | 采用 | `"selected output="` + 详情 |
| 2a | 未命中 | 打 `"no selected output plugin found, using default"` | `Log.e` |
| 2b | 命中但非输出类型 | 打 `"bad internal selected output plugin found, using default"` | `Log.e` |
| 2c | → 用 `output.osl`，且 `flags & 0x3 != 0` | 采用 | — |
| 2d | `output.osl` 也没有/不是输出 | **抛异常** `"no/bad default output plugin="` | — |
| 3 | `device` 非法 | **抛异常** `"bad device="` | — |

---

## 3. 与第十篇的闭环

```
r.К(device, selectedName, ...)          ← 选择输出插件
   │  建立 OutputOpts（含 NativePluginInfo）
   ▼
processing/А 实例（= OutputOpts）
   │  .В = 选中的 NativePluginInfo
   ▼
widget/player/t1.getIntState(0x7f0d00b4)
   │  返回 .В.id
   ▼
k0 / c1 读 StateBus 打勾与高亮
```

> **"当前插件"的来源链完整了**：
> 用户选择 → `r.К()` 构建 OutputOpts → StateBus 计算属性 → UI 读。

---

## 4. 位掩码在本条的新用法

| 掩码 | 用途 | 出处 |
| --- | --- | --- |
| `flags & 0xFF` | 取角色（第一篇） | `y()` `:782` |
| `flags & 0x80000000` | 判内置（第一篇） | `:381` |
| **`flags & 0x80000003`** | **必须是内置输出** | `r.К()` `:1888` |
| **`flags & 0x3`** | **是输出类（不限内置）** | `r.К()` `:1919` |
| **`flags & 0x1010`** | **提取传给 OutputOpts 的位** | `r.К()` `:1953` |

> **两处掩码不一致是刻意的**：
> 用户明确选择时严（必须内置输出），默认兜底时松（可以是外部输出）。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **四级降级 + 明确日志** | 每级失败都有可追踪记录 |
| A2 | **用户选择严校验、默认兜底松校验** | 兼顾正确性与鲁棒性 |
| A3 | **OutputOpts 不可变值对象** | 构造后只读，线程安全 |
| A4 | **`toString` 自带类名** | 日志里易识别（`OutputOpts<hex>{}`） |
| A5 | **空实例单例 `А.y`** | 避免 null 判断散落 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 8 参数构造器 | 位置参数无名字，易错序 |
| N2 | `0x1010` 掩码无注释 | 含义不可考 |
| N3 | 默认插件 uniqName 硬编码 `output.osl` | 换默认要改代码 |
| N4 | 降级失败抛 `RuntimeException` | 无专门异常类型，调用方难分辨 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`flags & 0x1010` 语义~~ | ✅ **已闭合**（二十四）：bit12=`prefs/В.J1`、bit4 来源未知；flags 由 9 个偏好布尔 or 合成 |
| ~~Q2~~ | ~~OutputOpts 8 字段语义~~ | ✅ **已闭合**（四十）：`toString` 自证——`routedDeviceName`/`routedEndDeviceName`/`blob`/`isSafe`/`requestedCaps`/`device`/`uiFlags` |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| OutputOpts 类 | `audioplayer/processing/А.smali`（175 行） |
| `toString` 自证类名 | `А.smali:82-109`（`"OutputOpts"`） |
| `В` = NativePluginInfo | `А.smali:20`（字段）、`:61`（赋值） |
| 空实例 | `А.smali:28-53`（`NativePluginInfo.NULL` + `0xff`） |
| 唯一构造点 | `audioplayer/player/r.smali:1955` |
| 方法签名 | `r.smali:1670`（`К(I,String,String,String,Z)`） |
| 按名查表 | `r.smali:1871` |
| 未命中日志 | `r.smali:1877` |
| 类型校验 `0x80000003` | `r.smali:1886-1890` |
| 回退 `output.osl` | `r.smali:1909-1913` |
| 默认类型校验 `0x3` | `r.smali:1919-1921` |
| 抛异常 | `r.smali:1929-1945`（无默认）、`:1978-1986`（坏设备） |
| `0x1010` 掩码 | `r.smali:1953` |

> 口径：**build-1025**。
