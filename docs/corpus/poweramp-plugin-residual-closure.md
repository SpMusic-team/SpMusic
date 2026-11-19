---
doc_id: "ARCH-POWERAMP-PLUGIN-RESIDUAL-CLOSURE"
title: "插件系统（二十一）：残余项闭合——建表语句与死字段"
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
  - "docs/corpus/poweramp-plugin-lib-declaration.md（十八）"
---

# 插件系统（二十一）：残余项闭合——建表语句与死字段

## 0. 一句话结论

本篇专门记录**三个负面结论**（"查不到"也是结论）：

| 问题 | 结论 | 性质 |
| --- | --- | --- |
| `milk_presets` 的 `CREATE TABLE` | **Java 侧与 native 侧均不存在** | 不可从产物判断 |
| `plugin/х.Н` 字段 | **全库零引用**，死字段 | 已确认 |
| `milk_presets_parent_id_fragment_index` | 索引名存在，但创建语句缺失 | 同上 |

---

## 1. ★ `milk_presets` 建表语句的去向

### 1.1 已经排除的位置

| 位置 | 检查方式 | 结果 |
| --- | --- | --- |
| `audioplayer/data/migrations/B.smali`（6292 行） | 全文搜 `milk_preset` | **仅 1 处**：`:4271` `drop index IF EXISTS milk_presets_shuffle_order` |
| `migrations/А.smali`（279 行）/ `В.smali`（556 行） | 同上 | 0 |
| 全 `.smali` 的 `const-string` 含 `milk` | 112 处 | 无 `CREATE TABLE milk*` |
| 全 `.smali` 含 `milk` 且含 `CREATE/TEXT NOT NULL/INTEGER NOT NULL` | 交叉组合 | **0** |
| `libpowerampcore.so` 字符串扫描 | `CREATE TABLE milk` | **0** |

### 1.2 native 侧只有资源路径

`libpowerampcore.so` @293258 的上下文：

```
... Astroidea XMF.Puma Tracker.Images Music System.
... /dev/cpuctl/apps/bg_non_interactive/tasks.add_tid_to_cgroup failed ...
... milk_presets/ .milk /shaders/comp_vs_300.glsl ...
```

> 这是 **`milk_presets/` 资源路径常量**（与第十四篇的 `assets/milk_presets/` 同源），
> **不是 SQL**。native 里也没有建表语句。

### 1.3 存在的索引名（反向证据）

全库字符串中出现过：

| 字符串 | 含义 |
| --- | --- |
| `milk_presets_parent_id_fragment_index` | **唯一索引名**（对应第十五篇的 `(parent_id, fragment)` 业务唯一键） |
| `milk_presets(parent_id, fragment)` | 索引的列定义片段 |
| `milk_presets.rating` / `.name` / `.author` / `._id` | 列引用 |

> **索引名与列名都出现了，唯独没有 `CREATE`**。
> 推测：建表语句可能由 **SQLite 的 `.sql` 资源文件**或 **native 的 SQL 脚本**加载，
> 都不在当前可静态读取的产物范围内。

### 1.4 结论

> **`milk_presets` / `milk_preset_containers` 的 DDL 不可从静态产物取得。**
> 但第十五篇通过 8 条 SQL 反推出的列结构**已足够描述数据模型**，
> 且本篇 §1.3 的索引名与其完全吻合，可视为**间接验证**。

---

## 2. `plugin/х.Н` 是死字段

全库检索 `plugin/х;->Н:` —— **0 处引用**。

| 字段 | 类型 | 引用数 |
| --- | --- | ---: |
| `х.Н` | `String` | **0** |
| 其余 10 个字段 | — | 均 > 0 |

### 2.1 与第十篇的对照

第十篇把 `P`/`Н`/`р` 三个 String 并列为"author/description/info 的字面量"（推测）。
本轮实测：

| 字段 | 实测 |
| --- | --- |
| `х.P` | **`lib` 元素值**（经 `mapLibraryName`）——第十八篇 |
| `х.р` | **`libBasePath`**——第十八篇 |
| `х.Н` | **零引用，死字段** |

> 三者**没有一个是 author/description/info 的字面量**。
> 第十篇的那条推测**完全错误**，已在本篇彻底否定。

### 2.2 为什么会有死字段

混淆后的类保留字段但不保留所有引用是常见的：

| 原因 | 说明 |
| --- | --- |
| 反射访问 | 字段名在 `toString`/序列化里用，代码里不直接读 |
| 版本残留 | 曾经使用，重构后未删 |
| 序列化保留 | 实现了 `Serializable`（`х` 有 `serialVersionUID`），字段需保留兼容 |

> `plugin/х` 确实 `implements Serializable`（`serialVersionUID = 0x62a366d7921a7f7cL`），
> **第三种原因最可能**——为旧版序列化数据兼容而保留。

---

## 3. 本轮对既有文档的订正汇总

| 篇 | 原结论 | 订正 |
| ---: | --- | --- |
| 十 | `P`/`Н`/`р` = author/description/info 字面量 | `P`=lib 值、`р`=libBasePath、`Н`=死字段 |
| 十五 | "跨 pak 去重" | 容器内唯一（`parent_id` + `fragment`） |
| 十五 | `parts[0]`→name、`parts[1]`→author | `out[0]`→author、`out[1]`→name（第十七篇订正） |
| 二十 | `applyStyle(..., false)` 先到先得 | `applyStyle(..., true)` 后者覆盖 |
| 四 | `singlepane` 有 8 个分支 | 实为 `k0` 构造参数，仅 1 处条件 |
| 六 | `overlapAttr=""` 表示明确清除 | 与缺失不可区分（都返回 0） |

> **六处订正全部来自"实际读代码"而非推断**。
> 这是本系列逆向最重要的方法论收获：**先确认常量/字段的实际值，再下结论**。

---

## 4. 插件系统已闭合的完整范围

| 层面 | 已解内容 | 篇 |
| --- | --- | --- |
| 类型系统 | 6 类位域枚举、bit31 内置标志 | 一 |
| 发现 | assets XML + meta-data + URI scheme 三路 | 一、六、五 |
| 实例化 | uniqName → 类名反射、三级缓存、负缓存 | 二 |
| 命名 | 四处派生约定、`pa_output_*` | 八 |
| 描述符 | 11 字段语义、`lib` 元素 | 十、十八 |
| 列表页 | 按设备反查、三种跳转 | 三 |
| 分发 | `f0` 58 分支 / 17 helper | 四 |
| 设备选项页 | 32 键九阶段、`__avail_hires` | 七、十九 |
| 输出选择 | 四级降级、OutputOpts | 十一 |
| 命令协议 | byte[] 结构体、msgID 偏移 | 九 |
| 皮肤 | meta-data 发现、SkinInfo 解析、overlap 应用 | 六、十二、二十 |
| pak | 四 scheme、物理定位、zip 扫描、两表、文件名解析、读取侧 | 五、十三、十四、十五、十七、十六 |

---

## 5. 剩余的硬边界（全部已确认为不可达）

| # | 边界 | 证据 |
| ---: | --- | --- |
| 1 | `native_get_plugins()` 返回值 | 方法无方法体 |
| 2 | `native_get_zip_names_iterator` | 同上 |
| 3 | 插件实现的真实逻辑 | 在 `.so`，Java 只拿描述符 |
| 4 | byte[] 命令生成端 | 单向通道，写入在 native |
| 5 | flac/osl 的真实 uniqName | native 决定 |
| 6 | `milk_presets` DDL | 本篇 §1——Java 与 native 均无 |

---

## 6. 证据索引

| 主题 | 位置 |
| --- | --- |
| migration 里唯一的 milk 提及 | `audioplayer/data/migrations/B.smali:4271` |
| native 的 milk_presets | `libpowerampcore.so` @293258（资源路径，非 SQL） |
| 索引名 | 全库字符串 `milk_presets_parent_id_fragment_index` |
| `х.Н` 零引用 | 全库检索 `plugin/х;->Н:` = 0 |
| `х` 可序列化 | `plugin/х.smali:9`（`serialVersionUID`） |

> 口径：**build-1025**。
