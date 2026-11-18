---
doc_id: "ARCH-POWERAMP-PAK-DATA-MODEL"
title: "插件系统（十五）：pak 数据模型与 milk_presets 两表"
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
  - "docs/architecture/poweramp-pak-zip-scanning.md（十四）"
  - ".rea-analysis/smali/smali/com/maxmpz/milk/scanner/B.smali"
---

# 插件系统（十五）：pak 数据模型与 milk_presets 两表

## 0. 一句话结论

pak 扫描结果落在**两张表**：`milk_preset_containers`（容器 = 一个 pak/目录）
与 `milk_presets`（预设条目）。**8 条预编译 SQL 全部在此文件**。

---

## 1. 八条预编译语句（`B.<init>`）

| # | 指向字段 | SQL | 位置 |
| ---: | --- | --- | ---: |
| 1 | `В` | `SELECT _id FROM milk_preset_containers WHERE uri=? LIMIT 1` | `:51` |
| 2 | `B` | `INSERT INTO milk_preset_containers (uri, type) VALUES (?, ?)` | `:59` |
| 3 | `А` | `UPDATE milk_preset_containers SET name=?, uri_extra=?, updated_at=? WHERE _id=?` | `:67` |
| 4 | `A` | `SELECT _id FROM milk_presets WHERE parent_id=? AND fragment=? LIMIT 1` | `:75` |
| 5 | `х` | `INSERT INTO milk_presets (parent_id, fragment, author, name, updated_at) VALUES (?,?,?,?,?)` | `:83` |
| 6 | `Х` | `UPDATE milk_presets SET updated_at=? WHERE _id=?` | `:91` |
| 7 | `X` | `SELECT changes()` | `:99` |
| 8 | `x` | `SELECT total_changes()` | `:107` |

> **1-3 管容器，4-6 管预设，7-8 是 SQLite 变更计数**。
> 全部在构造器里 `compileStatement` 一次性预编译——避免循环内重复编译。

---

## 2. ★ `milk_preset_containers`（容器表）

从 1-3 条 SQL 可反推列结构：

| 列 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| `_id` | INTEGER PK | — | 容器 id |
| `uri` | TEXT | INSERT | **去重键**（`apk://<pkg>` 或 `dir:...`） |
| `type` | INTEGER | INSERT | 容器类型（对应 flag `0x8`/`0xa`） |
| `name` | TEXT | UPDATE | 显示名（扫描后回填） |
| `uri_extra` | TEXT | UPDATE | **附加信息**（即 `?tex=` 或 extra 参数） |
| `updated_at` | INTEGER | UPDATE | 时间戳 |

> **两段式写入**：先 `INSERT (uri, type)` 拿到 id，扫描完成后再 `UPDATE (name, uri_extra, updated_at)`。
> 这样即使扫描中途失败，也能看到一条"不完整"的容器记录。

---

## 3. ★ `milk_presets`（预设表）

| 列 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| `_id` | INTEGER PK | — | 预设 id |
| `parent_id` | INTEGER | INSERT | **外键 → container._id** |
| `fragment` | TEXT | INSERT | **在 zip 内的相对路径** |
| `author` | TEXT | INSERT | 作者（从名字切分） |
| `name` | TEXT | INSERT | 显示名 |
| `updated_at` | INTEGER | INSERT/UPDATE | 时间戳 |

### 3.1 唯一性约束（隐含）

第 4 条 SQL：

```sql
SELECT _id FROM milk_presets WHERE parent_id=? AND fragment=? LIMIT 1
```

> **`(parent_id, fragment)` 构成业务唯一键**——同一容器内同一路径只有一个预设。
> 但注意：第十四篇说"跨 pak 去重"，这里却是按 `parent_id` 查——
> **实际上是"容器内唯一"，不是全局唯一**。这是对第十四篇的一处精确化。

### 3.2 `fragment` 与 `name` 的关系

第十四篇看到 `split(name, Р)` 后取 `parts[0]`/`parts[1]`。结合本表列：

| 写入位置 | 列 | 取值 |
| --- | --- | --- |
| `bindString(2)` | `fragment` | 完整 name |
| `bindString(3)` | `author` | **`out[0]`** = 文件名 `" - "` 之**后**的半段 |
| `bindString(4)` | `name` | **`out[1]`** = 文件名 `" - "` 之**前**的半段 |

> **已由第十七篇实证**：文件名形如 `名称 - 作者.milk`，前半是名称、后半是作者，
> 但输出数组 `out[0]` 存作者、`out[1]` 存名称（顺序相反）。
> `Р` 是 `new String[2]`，正好容纳两个切分结果。

---

## 4. 完整的扫描-入库时序

```
у() 入口
  │
  ├─ А(flag, apkPath)                                    [语句 1→3]
  │     ├─ В.query → 若存在直接返回 _id
  │     └─ 否则 B.insert(uri, type) → 得 _id，再 х()/更新
  │                                    ↓
  │                              containerId
  │
  ├─ for each zip entry:
  │     └─ K(name, containerId)                          [语句 4→5/6]
  │           ├─ A.query(parent_id, fragment)
  │           ├─ 命中 → Х.update(updated_at)
  │           └─ 未命中 → х.insert(parent_id, fragment, author, name, updated_at)
  │
  └─ К(containerId, apkPath, pkg, extra, tex)            [语句 3]
        └─ А.update(name, uri_extra, updated_at)
```

> **先建容器 → 逐条建预设 → 最后回填容器名**。
> 容器名要等扫描完才知道（可能来自 zip 内某文件），所以只能最后更新。

---

## 5. `SELECT changes()` / `total_changes()` 的用途

| 语句 | 含义 | 用途 |
| --- | --- | --- |
| `SELECT changes()` | **上一条语句**影响的行数 | 判断 UPDATE 是否真的改了 |
| `SELECT total_changes()` | 连接建立以来**累计**变更数 | 整体进度/是否需要重建 |

> 预编译这两条说明作者关心"**这次扫描到底改动了几行**"——
> 用于决定是否需要触发 UI 刷新或重建索引。

---

## 6. 对第十四篇的订正

| 第十四篇表述 | 本轮订正 |
| --- | --- |
| "去重是跨 pak 的，同名预设只存一份" | **不准确**。查询条件含 `parent_id`，实为**容器内唯一** |
| "`Р` 是名字分隔数组，值未查" | **已查**：`new String[2]`，`split` 的输出容器，非分隔符表 |

> 真正的跨容器共享**并不存在**——每个 pak 的预设独立存储。
> 代价是多个 pak 含相同预设时会重复，收益是删除某个 pak 时互不影响。

---

## 7. 可借鉴 / 不建议照抄

### 7.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | 8 条 SQL 构造函数内**一次性预编译** | 循环内零编译开销 |
| A2 | **两段式容器写入** | 扫描失败也留可诊断记录 |
| A3 | `(parent_id, fragment)` **业务唯一键** | 容器内幂等重扫 |
| A4 | 预编译 `changes()`/`total_changes()` | 精确知道改动量 |

### 7.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **异常当分支**（`SQLiteDoneException` = 未命中） | 高频查询性能差 |
| N2 | 无显式 `CREATE TABLE`（在 migrations 里） | 表结构散落两处 |
| N3 | `Р` 复用同一数组跨多次 `split` | 非线程安全 |
| N4 | `uri_extra` 语义模糊 | 既是 `?tex=` 又是 extra 参数 |

---

## 8. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`type` 取值含义~~ | ✅ **已判定**（三十八）：**不透明标记**，6 个值由调用方按场景选，无位语义 |
| ~~Q2~~ | ~~CREATE TABLE 位置~~ | ✅ **已确认不可得**（二十一）：Java 与 native 均无 |

---

## 9. 证据索引

| 主题 | 位置 |
| --- | --- |
| `Р` 初始化 | `milk/scanner/B.smali:45-49`（`new String[2]`） |
| 容器查询 | `B.smali:51` |
| 容器插入 | `B.smali:59` |
| 容器更新 | `B.smali:67` |
| 预设查询 | `B.smali:75` |
| 预设插入 | `B.smali:83` |
| 预设更新 | `B.smali:91` |
| 变更计数 | `B.smali:99`、`:107` |
| 容器入库方法 | `B.smali:1152-1203`（`А(I,String)J`） |
| 预设入库方法 | `B.smali:377-470`（`K(String,J)`） |
| 容器回填 | `B.smali:1571-1575`（`К`） |

> 口径：**build-1025**。
