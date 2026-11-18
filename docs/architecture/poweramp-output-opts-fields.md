---
doc_id: "ARCH-POWERAMP-OUTPUT-OPTS-FIELDS"
title: "插件系统（四十）：OutputOpts 八字段语义闭合"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni (versionCode 1025009)"
revision: 1
created: "2026-11-18"
updated: "2026-11-18"
open_items: 0
source_documents:
  - "user request: 继续完成剩余的那一项"
  - "docs/architecture/poweramp-plugin-output-selection.md（十一）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/processing/А.smali"
---

# 插件系统（四十）：OutputOpts 八字段语义闭合

## 0. 一句话结论

第十一篇留下的"8 个字段对应什么音频参数"，本轮**全部闭合**——
`OutputOpts` 的 `toString()`（`:82-174`）**自己写明了每个字段的名字**，
再与构造点 `r.К()` 的实参逐一对照即可完成映射。

---

## 1. ★ 字段语义终表（`toString` 自证 + 构造对照）

| 字段 | 类型 | `toString` 中的名字 | 语义 |
| --- | --- | --- | --- |
| `В` | `NativePluginInfo` | **`outputPlugin=`** | 选中的输出插件 |
| `Х` | `String` | **`routedDeviceName=`** | **路由设备名**（如 `USB DAC`） |
| `X` | `String` | **`routedEndDeviceName=`** | **终端设备名**（路由链末端） |
| `B` | `byte[]` | **`blob=`** | 原始参数块（`ByteBuffer.array()`） |
| **`А`** | `boolean` | **`isSafe=`** | **是否为"安全"输出** |
| **`A`** | `int` | **`requestedCaps=`** | **请求的能力位** |
| **`х`** | `int` | **`device=`** | **设备 id（0..5）** |
| **`x`** | `int` | **`uiFlags=`** | **UI 标志位**（即 `0x1010` 筛选结果） |

> **`toString` 是本轮的关键证据**——它把 8 个字段逐一打印，
> 字段名直接给出语义，无需推测。

---

## 2. 构造器签名与实参对照

### 2.1 签名（`А.smali:56`）

```smali
.method public constructor <init>(
    NativePluginInfo p1,   // -> В
    int              p2,   // -> х
    int              p3,   // -> A
    byte[]           p4,   // -> B
    boolean          p5,   // -> А
    String           p6,   // -> Х
    String           p7,   // -> X
    int              p8    // -> x
)
```

### 2.2 字段赋值（`:61-75`）

| 行 | 赋值 |
| ---: | --- |
| `:61` | `В = p1` |
| `:63` | `B = p4` |
| `:65` | `А = p5` |
| `:67` | `х = p2` |
| `:69` | `A = p3` |
| `:71` | `Х = p6` |
| `:73` | `X = p7` |
| `:75` | `x = p8` |

> **注意赋值顺序与形参顺序不同**（`p4` 先于 `p5`、`p2` 先于 `p3`）——
> 这是编译器按字段声明顺序重排的结果，不影响映射。

### 2.3 调用点实参（`r.К()`，`:1953-1971`）

`invoke-direct/range {v1 .. v9}` 表示 `v1`=this、`v2..v9` 依次对应 `p1..p8`：

| 形参 | 寄存器 | 来源 | 对应字段 | 语义 |
| --- | --- | --- | --- | --- |
| `p1` | `v2` | `:1924` `move-object v2, v7` | `В` | **选中的插件** |
| `p2` | `v3` | `:1961` `move v3, p1` | `х` | **device 入参** |
| `p3` | `v4` | `:1965` `move v4, v0` | `A` | `v0` = `:1953` `v6 & 0x1010` |
| `p4` | `v5` | `:1957-1959` `ByteBuffer.array()` | `B` | **参数块** |
| `p5` | `v6` | `:1967` `move v6, v8` | `А` | `v8` = `:1948` `p5`（方法入参） |
| `p6` | `v7` | `:1963` `move-object v7, p3` | `Х` | **第三个方法入参** |
| `p7` | `v8` | `:1969` `move-object v8, p4` | `X` | **第四个方法入参** |
| `p8` | `v9` | `:1805` `move v9, v4` | `x` | **uiFlags** |

---

## 3. ★ 关键交叉验证：`requestedCaps` 就是 `0x1010` 筛选结果

第十一篇记录过"`:1953` `and-int/lit16 v0, v6, 0x1010`"。
本轮确认 **`v0` 正是 `p3` → 字段 `A` → `requestedCaps`**：

```smali
v0 = v6 & 0x1010;          // :1953
move v4, v0;               // :1965  -> p3
// 构造器内 :69
A = p3;                    // -> requestedCaps
```

> **所以 `0x1010` 不是随便选的掩码，它就是"UI 请求的能力位"**。
> `toString` 里打印为 `requestedCaps=<int>`。

### 3.1 与第二十四篇的呼应

| 位 | 掩码 | 来源 | 是否进入 `requestedCaps` |
| ---: | ---: | --- | :---: |
| bit4 | `0x10` | `no_dvc`（UI） | ✅ |
| bit12 | `0x1000` | `prefs/В.J1`（合成） | ✅ |
| bit5/6/7/13/18/20 | 其它 | 其它开关 | ❌ |

> **9 个能力位里只有这 2 个进入 `OutputOpts`**——其余留给别的模块。

---

## 4. 字段消费端

`OutputOpts` 实例被 `StateBus` 消费（第十篇）：

| 访问 | 用途 |
| --- | --- |
| `opts.В.id` | → `state_player_output_plugin_id`（`0x7f0d00b4`） |
| `opts.х` | → `state_player_output_device`（`0x7f0d00bb`） |
| `opts.X` / `opts.Х` | 设备名展示 |

> `A`/`B`/`А`/`x` 主要供**日志与调试**（`toString` 与 native 传参）。

---

## 5. 空实例（`<clinit>`）

`А.y`（`:28-53`）：

| 形参 | 值 | 含义 |
| --- | --- | --- |
| `p1` | `NativePluginInfo.NULL` | 无插件 |
| `p2` | **`0xff`** | device = 255（无效） |
| `p3` | `0` | requestedCaps = 0 |
| `p4` | `null` | 无参数块 |
| `p5` | `false` | isSafe = false |
| `p6`/`p7` | `""` | 设备名为空 |
| `p8` | `0` | uiFlags = 0 |

> `device = 0xff` 是"无效设备"哨兵——真实设备只有 0..5。

---

## 6. 可借鉴 / 不建议照抄

### 6.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **`toString` 打印全部 8 字段** | 调试与逆向都受益（本轮即靠它） |
| A2 | **`routedDeviceName` vs `routedEndDeviceName` 区分前后端** | 路由链可视化 |
| A3 | **`blob` 保留原始字节** | 出问题可回放 |
| A4 | **空实例用 `0xff` 哨兵** | 避免 null 判断 |

### 6.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **字段名单字母**（`А`/`A`/`х`/`x` 四者大小写易混） | 极易看错（`А`基里尔 vs `A`拉丁） |
| N2 | 8 参构造器 | 位置参数无保护 |
| N3 | `uiFlags` 与插件 `flags` 同名不同义 | 概念混淆 |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| 字段声明 | `processing/А.smali:10-24` |
| `toString` 全字段打印 | `А.smali:82-174` |
| `outputPlugin=` | `А.smali:101` |
| `routedDeviceName=` | `А.smali:109` |
| `routedEndDeviceName=` | `А.smali:117` |
| `blob=` | `А.smali:125` |
| `isSafe=` | `А.smali:137` |
| `requestedCaps=` | `А.smali:145` |
| `device=` | `А.smali:153` |
| `uiFlags=` | `А.smali:161` |
| 构造签名 | `А.smali:56` |
| 字段赋值 | `А.smali:61-75` |
| 空实例 `0xff` | `А.smali:39` |
| 构造点 | `player/r.smali:1953-1971` |
| `0x1010` 掩码 | `r.smali:1953` |
| StateBus 消费 | `widget/player/t1.smali`（第十篇） |

> 口径：**build-1025**。
