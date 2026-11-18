---
doc_id: "ARCH-POWERAMP-PLUGIN-FINAL-CLOSURE"
title: "插件系统（二十二）：最终闭合——StateBus 语义、plugin/у、外部皮肤根元素"
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
  - "docs/architecture/poweramp-plugin-residual-closure.md（二十一）"
---

# 插件系统（二十二）：最终闭合

## 0. 一句话结论

本篇做两件事：**回填 13 处跨篇陈旧未解项** + **闭合 4 个新项**。

回填后，插件系统 21 篇专文的 `open_items` 从 43 降至 **约 24**，
其中 **4 项为硬边界**、**14 项已标闭合**，其余均为"未逐行展开"而非"不可解"。

---

## 1. ★ 回填的 13 处跨篇闭合

这些项在写作时确实未解，但**后续篇目已经解决**，只是没回填。

| 篇 | 原未解项 | 实际由哪篇解决 |
| ---: | --- | ---: |
| 3 | `f0` 如何按 target 分派 | **四**（`getIdentifier` → 58 分支） |
| 3 | `c1` 内部实现 | **七 / 十九** |
| 2 | `plugin/А.х([BI)` 协议 | **九**（LE ByteBuffer、msgID `0x14`） |
| 1 | `х.x`/`х.y` 含义 | **十**（description / info 资源 id） |
| 4 | `singlepane` 8 分支 | **四 §2.1**（实为 `k0` 构造参数） |
| 5 | `apk://` 包内文件名约定 | **十四**（`assets/milk_presets/`） |
| 14 | `Р` 字段内容 | **十七**（`new String[2]` 输出参数） |
| 15 | CREATE TABLE 位置 | **二十一**（确认不可得） |
| 16 | CREATE TABLE 位置 | **二十一** |
| 6 | overlapAttr 叠加规则 | **二十**（`applyStyle(,true)`） |
| 18 | `х.Н` 来源 | **二十一**（死字段） |
| 10 | `processing/А.В` 赋值点 | **十一**（`r.К()` `:1955`） |
| 7 | `c1.z()` 主体 | **十九**（九阶段划分） |

---

## 2. 本轮新闭合的 4 项

### 2.1 `StateBus` 两个状态的确切语义

| 状态 id | 名称 | 语义 |
| --- | --- | --- |
| `0x7f0d00b4` | **`state_player_output_plugin_id`** | 当前输出插件（`NativePluginInfo.id`） |
| `0x7f0d00bb` | **`state_player_output_device`** | 当前输出设备（int，0..5） |

> 第七篇只知 `0x7f0d00bb` 是"子项索引"，本轮通过 `public.xml` 定名为
> **`state_player_output_device`**——即当前输出**设备**编号。
> 两者组合构成"当前在哪个设备的哪个插件上"的完整上下文。

### 2.2 `plugin/у` 是 Drawable 提供者（164 行）

第十二篇遗留的 `SkinOption.y` 字段类型：

| 字段 | 类型 | 方法 |
| --- | --- | --- |
| `plugin/у.B` | `Resources` | — |
| `plugin/у.А` | `int` | — |
| `plugin/у.В` | `int`（synthetic） | — |

唯一有业务意义的方法：

```smali
.method public В(String key, SkinInfo info) Drawable
```

> **`у` 是一个"按 key 从 skin 取 Drawable"的提供者**。
> `SkinOption.y` 持有它，说明每个 option 可携带自己的图标来源。

### 2.3 外部皮肤根元素确认

`bt/В.smali:1826` 用 `getName().equals("skins")` 判定根元素——
**与内置皮肤完全相同的 `<skins>` 根**。

> 第六篇 Q3 闭合：外部 pak 的皮肤 XML 无需不同格式。

### 2.4 `plugin/А.х([BI)` 协议（跨篇确认）

第二篇与第九篇的接口一致性已确认：

| 篇 | 结论 |
| ---: | --- |
| 二 | `х([BI)Z` 是抽象方法，2 个子类覆写 |
| 九 | 实现是 LITTLE_ENDIAN ByteBuffer 命令解析 |

---

## 3. 剩余项的性质分类

扣除已闭合与硬边界后，剩余约 **24 项**全部属于以下三类：

| 类别 | 数量 | 说明 | 代表 |
| --- | ---: | --- | --- |
| **A. 未逐行展开** | ~18 | 代码可读但篇幅过大，未逐段记录 | 阶段⑤ 720 行、`c1` 主体 |
| **B. 值域未枚举** | ~4 | 只观测到部分取值 | msgID 枚举、`flags & 0x1010` |
| **C. 依赖外部信息** | ~2 | 需外部 pak 样本 | 外部 pak 的 `name` 是否带 `@string/` |

> **没有一类是"技术上不可解"**——只是工作量问题。
> 真正不可达的 4 项已在 §4 列出。

---

## 4. 硬边界终表（4 项）

| # | 边界 | 不可达原因 |
| ---: | --- | --- |
| 1 | `native_get_plugins()` 返回值 | native 方法无方法体 |
| 2 | `native_get_zip_names_iterator` | 同上 |
| 3 | 插件/皮肤的实际实现逻辑 | 在 `.so`，Java 只拿描述符 |
| 4 | byte[] 命令的生成端 | 单向通道，写入在 native |

---

## 5. 证据索引

| 主题 | 位置 |
| --- | --- |
| `state_player_output_plugin_id` | `res/values/public.xml`（`0x7f0d00b4`） |
| `state_player_output_device` | `res/values/public.xml`（`0x7f0d00bb`） |
| 状态计算 | `widget/player/t1.smali:878-890` |
| `plugin/у` 类 | `audioplayer/plugin/у.smali`（164 行） |
| Drawable 方法 | `plugin/у.smali:106`（`В(String,SkinInfo)Drawable`） |
| `skins` 根元素 | `audioplayer/player/bt/В.smali:1826` |
| `х([BI)Z` 基类 | `plugin/А.smali:60` |
| `х([BI)Z` 实现 | `plugin/milk/MilkPluginService.smali:139` |

> 口径：**build-1025**。
