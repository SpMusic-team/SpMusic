---
doc_id: "ARCH-POWERAMP-MILK-DATA-LAYER"
title: "插件系统（三十）：milk/data 数据层与预设随机排序"
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
  - "docs/corpus/poweramp-pak-read-side.md（十六）"
---

# 插件系统（三十）：milk/data 数据层与预设随机排序

## 0. 一句话结论

第十六篇遗留的 `milk/data/{К,B,X,y}` 字段映射，本轮解出：

| 类 | 行数 | 实际职责 |
| --- | ---: | --- |
| **`К`** | **170** | **URI/列名常量 + 随机重排**（抽象类） |
| `B` | 146 | 单行对象（无字段，纯方法） |
| `X` | **1376** | **查询执行器**（Cursor/Statement 持有者） |
| `y` | 76 | 单例 + 静态 URI |

> 并且发现一个此前完全未提的功能：**预设的随机排序**（`shuffle_order`）。

---

## 1. ★ `milk/data/К` —— 常量与随机重排

### 1.1 三个静态字段（`:9-13`）

| 字段 | 类型 | 内容 |
| --- | --- | --- |
| `B` | `String[]` | **查询列名数组** |
| `А` | `String[]` | **另一组列名** |
| `В` | `Uri` | **内容 URI** |

`<clinit>`（`:17-71`）里的列名字符串：

| 行 | 字符串 |
| ---: | --- |
| `:28` | `milk_presets` |
| `:40` | `milk_presets._id` |
| `:48` | `milk_preset_containers.name` |
| `:50` | `milk_presets.author` |
| `:52` | `milk_presets.name` |

> **这印证了第十五篇的列名推断**（`_id`/`author`/`name`/`parent_id`）。

### 1.2 ★ 随机重排方法 `х(SQLiteDatabase, long)`（`:113-154`）

```smali
.method public static х(SQLiteDatabase db, long currentId)
    db.beginTransactionNonExclusive();
   
    // ① 把所有预设的 shuffle_order 设为随机
    db.execSQL("UPDATE milk_presets SET shuffle_order=" +
               "MAX(-9223372036854775807, RANDOM())");
   
    // ② 把当前项设为 Long.MIN_VALUE（★ 置顶）
    db.execSQL("UPDATE milk_presets SET shuffle_order=-9223372036854775808 " +
               "WHERE _id=" + currentId);
   
    db.setTransactionSuccessful();
    db.endTransaction();
}
```

| 常量 | 值 | 作用 |
| --- | ---: | --- |
| `-9223372036854775807` | `Long.MIN_VALUE + 1` | **下界**，防 `ABS` 溢出 |
| `-9223372036854775808` | **`Long.MIN_VALUE`** | **置顶哨兵** |

### 1.3 ★ 为何用 `Long.MIN_VALUE` 置顶

| 排序方向 | 效果 |
| --- | --- |
| 升序（ASC） | `Long.MIN_VALUE` 最小 → **排最前** |
| 降序（DESC） | `Long.MIN_VALUE` 最大 → **排最后** |

> **无论排序方向如何，"当前项"都处于序列的一端**——
> 这比用 `0` 或 `-1` 更安全（不会被随机值碰撞）。

### 1.4 与播放列表 `shuffle_order` 的对比

| | 播放列表/队列 | milk 预设 |
| --- | --- | --- |
| 表 | `playlist_entries` / `queue` | **`milk_presets`** |
| 随机表达式 | `ABS(MAX(-9223372036854775807, RANDOM()))` | **`MAX(-9223372036854775807, RANDOM())`**（无 `ABS`） |
| 置顶机制 | 位次补偿（idea 58） | **`Long.MIN_VALUE` 哨兵** |

> **预设随机不快**——它没有用 `ABS`，因为负数在这里是**有意义**的（置顶）。
> 这解释了为什么可以不用 `ABS`：排序逻辑允许负值参与。

---

## 2. `milk/data/X` —— 查询执行器（1376 行）

字段表：

| 字段 | 类型 | 职责 |
| --- | --- | --- |
| `B` | `MilkRestProvider` | 回指 Provider |
| `В` | `Context` | 上下文 |
| `K` | `PackageManager` | 查包信息 |
| `P` / `p` / `Р` / `р` | `SQLiteStatement` | **4 条预编译语句** |
| `X` / `x` | `Cursor` | **2 个游标** |
| `Н` | `HashMap` | 缓存 |
| `Х` | `milk/data/А` | 关联对象 |
| `у` | `Uri` | 当前 URI |
| `y` | `String[]` | 列名 |
| `A` / `А` / `К` / `х` | `int` | 状态 |

> **4 条预编译 + 2 个游标**——与第十五篇 scanner 的 8 条 SQL 风格一致。
> 说明整个 milk 模块都采用"构造时预编译、循环里复用"的模式。

---

## 3. `milk/data/B` 与 `y`

| 类 | 行数 | 特征 |
| --- | ---: | --- |
| `B` | 146 | **无实例字段**，纯方法类 |
| `y` | 76 | 单例（`В` 静态实例）+ 静态 `Uri`/`String` |

> `y` 的字符串 `"milk_presets"`（`:51`）说明它也涉及表名。

---

## 4. 可借鉴 / 不建议照抄

### 4.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **`Long.MIN_VALUE` 作置顶哨兵** | 单调排序下必居一端，不与随机值碰撞 |
| A2 | **随机下界用 `MIN_VALUE + 1`** | 防 `ABS(MIN_VALUE)` 仍为负 |
| A3 | **常量类集中列名** | `К` 一处定义，避免拼错 |
| A4 | **非独占事务**（`beginTransactionNonExclusive`） | 允许并发读 |

### 4.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **SQL 里直接拼 `currentId`**（字符串拼接） | 注入风险（虽为 long 安全） |
| N2 | 随机重排**影响全表** | 大数据集时是重操作 |
| N3 | 类名 `К`/`X`/`B`/`y` 无语义 | 需靠字段反推 |
| N4 | 4 条预编译语句挤在一类 | 职责偏多 |

---

## 5. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`К.х()` 调用方~~ | ✅ **已闭合**（三十二）：唯一调用点 `X.Х(int)` 且 `mode == 3` |

---

## 6. 证据索引

| 主题 | 位置 |
| --- | --- |
| `К` 类 | `milk/data/К.smali`（170 行） |
| 三个静态字段 | `К.smali:9-13` |
| 列名常量 | `К.smali:28/40/48/50/52` |
| 随机重排方法 | `К.smali:113-154`（`х`） |
| 随机 SQL | `К.smali:121` |
| 置顶 SQL | `К.smali:116` |
| `X` 类 | `milk/data/X.smali`（1376 行） |
| `y` 类 | `milk/data/y.smali`（76 行） |

> 口径：**build-1025**。
