---
doc_id: "ARCH-POWERAMP-PAK-READ-SIDE"
title: "插件系统（十六）：pak 读取侧 ContentProvider 与统计查询"
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
  - "docs/architecture/poweramp-pak-data-model.md（十五）"
  - ".rea-analysis/smali/smali/com/maxmpz/milk/data/MilkRestProvider.smali"
---

# 插件系统（十六）：pak 读取侧 ContentProvider 与统计查询

## 0. 一句话结论

第十五篇是**写入侧**（scanner），本篇是**读取侧**——
`milk/data/MilkRestProvider` 是一个标准 `ContentProvider`，
对外提供 pak 与预设的 CRUD，并用一条**聚合查询**给出容器统计。

---

## 1. 标准 ContentProvider 六方法

| 方法 | 行 | 说明 |
| --- | ---: | --- |
| `<init>` | 17 | — |
| `onCreate` | 63 | 初始化 |
| `getWritableDatabase` | 43 | 返回 SQLiteDatabase |
| `query` | **120** | **主查询（413 行）** |
| `insert` | 55 | 插入 |
| `update` | 535 | 更新 |
| `delete` | 27 | 删除 |
| `getType` | 35 | MIME 类型 |

> 与 `audioplayer/rest/RestProvider` 同构——Poweramp 的**每个功能域一个 Provider**。
> 这印证了 `poweramp-plugin-system.md` 里 `RestProvider.getWritableDatabase()` 的用法。

---

## 2. ★ 唯一的聚合查询（`:190`）

```sql
SELECT milk_preset_containers.type,
       COUNT(*)
FROM milk_preset_containers
  INNER JOIN milk_presets
    ON milk_preset_containers._id = milk_presets.parent_id
GROUP BY milk_preset_containers.type
ORDER BY milk_p...
```

### 2.1 语义

**按容器类型统计预设数量**——即"每种来源（内置/APK/目录）各有多少个预设"。

| 子句 | 作用 |
| --- | --- |
| `INNER JOIN ... ON c._id = p.parent_id` | 确认第十五篇的外键关系 |
| `GROUP BY type` | 按容器类型分组 |
| `COUNT(*)` | 每组预设数 |

> **这条 SQL 独立印证了第十五篇推断的表结构**：
> `milk_preset_containers._id` 是主键、`milk_presets.parent_id` 是外键、`type` 列存在。

### 2.2 用途推测

设置页里"可视化预设"分类通常会显示类似：

| 来源 | 数量 |
| --- | ---: |
| Built-in | N |
| APK paks | N |
| Folder | N |

> 正是 `GROUP BY type` 的产物。

---

## 3. 与扫描侧的对应关系

| 侧 | 类 | 职责 |
| --- | --- | --- |
| 写入 | `milk/scanner/B` | 8 条预编译语句，容器+预设两段式写入 |
| 写入调度 | `milk/scanner/MilkScanService` | IntentService，`ACTION_SCAN` |
| 读取 | `milk/data/MilkRestProvider` | ContentProvider，CRUD + 聚合 |
| 数据载体 | `milk/data/{К, B, X, y}` | Cursor → 对象映射 |

> **写入与读取通过 SQLite 解耦**，各自预编译自己的语句。
> 没有共享的数据访问层——这是典型的"按需各自编译"风格。

---

## 4. 相关数据类（`milk/data`）

| 类 | 出现次数 | 推测职责 |
| --- | ---: | --- |
| `MilkRestProvider` | 15 | Provider 本体 |
| `К` | 7 | 行对象 / Cursor 包装 |
| `B` | 4 | 行对象 |
| `X` | 4 | 行对象 |
| `y` | 1 | 工具 |

> 这些类名都是混淆后的单字母，需靠字段反推（同 `plugin/х` 的情况）。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **每功能域一个 ContentProvider** | 边界清晰，权限可控 |
| A2 | **聚合查询在 SQL 层完成** | 避免把全部行读到内存再统计 |
| A3 | **INNER JOIN 表达强关联** | 无预设的容器不计入统计 |
| A4 | **写入/读取各自预编译** | 各取所需，无共享状态 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | `query` 单方法 413 行 | Uri 分派与查询混杂 |
| N2 | 数据类名单字母（`К`/`B`/`X`/`y`） | 无语义，排查困难 |
| N3 | 无 DDL 集中定义（散在 migrations 与 scanner） | 表结构需多处拼凑 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~CREATE TABLE 位置~~ | ✅ **已确认不可得**（二十一）：三处均排除 |
| ~~Q2~~ | ~~`milk/data` 类映射~~ | ✅ **已闭合**（三十）：`К`=常量+随机重排、`X`=查询执行器、`B`/`y`=辅助 |

> **Q1 值得注意**：migrations 中出现 `drop index IF EXISTS milk_presets_shuffle_order`（`:4271`），
> 说明**曾经存在** `milk_presets` 表及索引，但建表语句不在 migrations 的可见字符串里。
> 可能由 native 或另一个 migration 文件创建。

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| Provider 类 | `milk/data/MilkRestProvider.smali` |
| 聚合查询 | `MilkRestProvider.smali:190` |
| `query` 方法 | `MilkRestProvider.smali:120` |
| 其余 CRUD | `:27`（delete）、`:55`（insert）、`:535`（update） |
| drop index 线索 | `audioplayer/data/migrations/B.smali:4271`（`milk_presets_shuffle_order`） |
| 写入侧 | `milk/scanner/B.smali`（第十五篇） |
| 扫描调度 | `milk/scanner/MilkScanService.smali:144` |

> 口径：**build-1025**。
