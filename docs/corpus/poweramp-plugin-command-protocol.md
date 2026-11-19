---
doc_id: "ARCH-POWERAMP-PLUGIN-COMMAND-PROTOCOL"
title: "插件系统（九）：byte[] 命令协议与结构体布局"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 2
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/corpus/poweramp-plugin-instances.md（二）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/plugin/milk/MilkPluginService.smali"
---

# 插件系统（九）：byte[] 命令协议与结构体布局

## 0. 一句话结论

`plugin/А.х(byte[], int)` **不是音频数据通道，而是命令通道**：

把 byte[] 包成 **LITTLE_ENDIAN ByteBuffer**，按**固定字节偏移**读结构体字段。
**头部至少 32 字节，msgID 固定在 offset 20**。

> 这是一个**手写的跨 native/Java 二进制协议**，没有 schema、没有版本号。

---

## 1. 基类声明（`plugin/А`）

```smali
.method public х([BI)Z        ; byte[] + int -> boolean（成功/失败）
```

抽象方法，各插件按需覆写。**实测只有 2 个覆写**：

| 插件 | 行数 | 覆写 |
| --- | ---: | :---: |
| `plugin.milk.MilkPluginService` | 250 | ✅ |
| `decoder.ffmpeg.FfmpegPluginService` | 1038 | ✅ |
| `output.at / output.aa / plugin.reverb / plugin.tempo / plugin.resampler3` | — | ❌ |

> **只有"需要接收配置命令"的插件才覆写**。
> output 类插件走自己的 native 调用，不走这条通道。

---

## 2. ★ Milk 插件的完整协议（`MilkPluginService.smali:139-248`）

### 2.1 解析框架

```smali
.method public final х([BI)Z
    ByteBuffer b = ByteBuffer.wrap(bytes);
    b.order(ByteOrder.LITTLE_ENDIAN);        // ★ 小端
   
    if (b.capacity() < 0x20) {                // ★ 最小 32 字节
        Log.e("MilkPluginService", "bad msg size=" + b.capacity());
        return false;
    }
    if (b.getInt(0x14) != 1) {                // ★ offset 20 = msgID，必须 == 1
        Log.e("MilkPluginService", "bad msgID=" + msgID);
        return false;
    }
    if (b.capacity() == 0x28 && b.getInt(0x1c) == 8) {   // ★ 40 字节 & offset 28 == 8
        long v = b.getLong(0x20);             // ★ offset 32 = 8 字节值
        hi = (int)(v & 0xffffffffL);
        lo = (int)((v >>> 32) & 0xffffffffL);
        ...
    }
    ...
}
```

### 2.2 结构体布局（实测反推）

| offset | 大小 | 字段 | 观测值 |
| ---: | ---: | --- | --- |
| **0x14** | 4 | **msgID** | 必须 `1` |
| **0x1c** | 4 | **子类型/长度标记** | 观测 `8` 时进入 long 分支 |
| **0x20** | 8 | **载荷（long）** | 拆成高低两个 int |
| **0x00-0x13** | 20 | （未知头部） | 未读取 |
| **0x20** 起 | — | 最小消息 = 0x20 = 32；扩展消息 = 0x28 = 40 | |

> **20 字节的未知头部**是最大的未解点——它可能含时间戳、序列号或校验和，
> 但 Milk 插件里**完全没读**。说明协议设计上头部由别的组件填充。

### 2.3 两个 int 的拼拆

```smali
v   = b.getLong(0x20);
lo  = (int)(v & 0xffffffffL);         // ushr 后 and
hi  = (int)((v >>> 0x20) & 0xffffffffL);
```

> 即 `0x20` 处是一个 **64 位值，低 32 位在前**（LE），拆成两个 int 分别使用。
> 典型用途：一个采样位置（64 位）或两个 32 位参数打包。

---

## 3. FFmpeg 插件的协议（`FfmpegPluginService.smali:349-1037`）

688 行的实现，与 Milk **共用相同的两个基础常量**：

| 常量 | Milk | FFmpeg | 含义 |
| --- | :---: | :---: | --- |
| `0x20` | ✅ | ✅ | 最小消息长度（32） |
| `0x14` | ✅ | ✅ | msgID 偏移（20） |
| `0x1c` | ✅ | ✅ | 子类型偏移（28） |
| `0x28` | ✅ | — | Milk 40 字节分支 |
| `0x24` | — | ✅ | FFmpeg 专有（36） |
| `0x22` | — | ✅ | FFmpeg 专有（34） |

> **`0x20` + `0x14` 是协议的公分母** ⇒ 可认为"插件命令协议 v1"的固定头部。
> 之后各插件按自己需要在 `0x1c` 起定义子结构。

### 3.1 与 Milk 的差异

| | Milk | FFmpeg |
| --- | --- | --- |
| 实现行数 | 110 | 688 |
| 错误串 | `bad msg size=` / `bad msgID=` | 无 |
| 子类型值 | `8` | 在 `0x22`/`0x24` 读（**非 4 字节对齐**） |

> FFmpeg 的 `0x22`（34）**不是 4 的倍数**——说明那里读的是 `getShort` 或逐字节解析。
> 协议并非严格的 32 位对齐结构体。

---

## 4. 与 native 的关系

| 侧 | 角色 |
| --- | --- |
| Java | **解析** byte[] 命令，转成方法调用 |
| native | **生成** 命令字节流（推测） |

> 佐证：Milk 插件**只读不写**——没有看到任何 `put` 操作，全是 `getInt`/`getLong`。
> 即这条通道是**单向的 native → Java 命令下发**。

### 4.1 为什么不用 JNI 直接调用

| 方案 | 优劣 |
| --- | --- |
| JNI 方法 | 快，但每加一个命令要加一个 native 方法签名 |
| **byte[] 协议**（本方案） | 一套签名走天下，新命令只加 opcode |

> 这是典型的**以协议换扩展性**。代价是无类型安全、无 schema、偏移硬编码。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **固定头部 + 可变体** | `0x20`/`0x14` 全插件统一，后续自定义 |
| A2 | **显式字节序**（`LITTLE_ENDIAN`） | 跨平台无歧义 |
| A3 | **长度前置校验** | `capacity() < 0x20` 直接拒绝，防越界 |
| A4 | **msgID 白名单**（`!= 1` 即拒绝） | 未识别命令明确失败 |
| A5 | **只读不写**的单向通道 | 职责清晰，Java 不可能篡改 native 状态 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **偏移硬编码**（`0x14`/`0x1c`/`0x20`） | 改协议即全线断裂 |
| N2 | **无版本号字段** | 无法兼容多版本 |
| N3 | **20 字节未知头部** | 含义不可考，维护困难 |
| N4 | 非对齐读取（`0x22`） | 依赖具体指令实现 |
| N5 | 无 schema / 无 IDL | 只能靠读代码反推 |
| N6 | 错误仅打日志返回 false | 调用方无法区分失败原因 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | `0x00-0x13` 这 20 字节头部的含义 | **Milk 插件完全没读**；可能由 native 单独消费 |
| ~~Q2~~ | ~~msgID 完整枚举~~ | ✅ **已确认为硬边界**（三十四）：native 常量在代码段；仅找到 `bad msg id=%d` 等错误串佐证 |
| Q3 | 命令的**生成端**在何处 | 只见 Java 读取，写入端推测在 native，**硬边界** |

> **Q3 是硬边界**：`native_get_plugins` 系列方法均无方法体。

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| 基类抽象方法 | `plugin/А.smali:60`（`х([BI)Z`） |
| Milk 实现 | `plugin/milk/MilkPluginService.smali:139-248` |
| 字节序 | `MilkPluginService.smali:146-148` |
| 最小长度 0x20 | `MilkPluginService.smali:160-162` |
| msgID 偏移 0x14 | `MilkPluginService.smali:186-188` |
| msgID 校验 == 1 | `MilkPluginService.smali:194` |
| 长度 0x28 分支 | `MilkPluginService.smali:209-211` |
| 子类型 0x1c == 8 | `MilkPluginService.smali:213-221` |
| long 载荷 0x20 | `MilkPluginService.smali:223-237` |
| FFmpeg 实现 | `decoder/ffmpeg/FfmpegPluginService.smali:349-1037` |
| FFmpeg 常量 | 同文件内 `0x20`/`0x14`/`0x1c`/`0x22`/`0x24` |

> 口径：**build-1025**。
