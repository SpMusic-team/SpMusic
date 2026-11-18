---
doc_id: "ARCH-FOOBAR-IS-OPERATOR"
title: "foobar2000 的 IS 运算符：完整语义与反汇编证据"
doc_type: "architecture-research"
status: "draft"
owner_agent: "Architecture Agent"
version_scope: "research"
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "docs/architecture/foobar2000-foobaka-phase-4-findings.md"
  - "docs/architecture/foobar2000-disassembly-reference.md"
  - "docs/architecture/foobar2000-search-mechanisms.md"
---

# foobar2000 的 IS 运算符

> **本文是从 phase-4 findings 拆出的专题文档**，因为 IS 的逆向证据量已足以独立成篇。
> 全局结论见 investigation-summary，地址速查见 disassembly-reference。

## 零、一句话结论

**IS 与 HAS 是两套并行语义，不是包含关系。**
IS 的实现比 HAS 重一倍（409 B vs 200 B），且在多值字段上行为完全不同。
## 一、IS 的语义（部分闭合：排除法）

### 1.1 反汇编：IS 比较函数的完整控制流（本轮突破）

装上 capstone 5.0.7 后，把 `IS` 节点真正执行的比较函数反汇编出来了。

**关键地址**：

| 项 | 地址 |
| --- | --- |
| `IS` / `IST` 分派 handler | `0x0058CD20`（两者共用） |
| `IS` 节点虚表 | `0x0069EBC4` |
| **`IS` 比较函数** | **`0x0058BCF0`** |
| 大小写折叠表 | `0x00680798`（`A`→`a`，小写返回自身） |
| 大小写不敏感比较器 | `0x00635310` |

**重建出的算法**（逐指令核对）：

```
eax = [edi+8]                       ; 查询串
idx = [field_vtbl+0x20](query)      ; 字段索引；-1 → 字段不存在 → 返回假
ebx = [field_vtbl+0x18](idx)        ; ★ 值的个数
for esi in 0 .. ebx-1:              ; ★ 遍历每一个值
    eax = [field_vtbl+0x1C](idx,esi) ; 第 esi 个值
    flagA = [edi+0x20]               ; 标志位 A
    flagB = [edi+0x21]               ; 标志位 B
    if flagA:
        if flagB: call 0x58B8B0(pattern, value, edi)
        else:     call 0x63B3B0(value, 0)
    else:
        if flagB: call 0x6390C0([edi+0x1C], value, pattern)   ← 主比较
        else:     call 0x635360(value)
    if 命中: return true
return false
```

**这解决了「反汇编 vs 实测」的表面矛盾**：

- 反汇编显示 `IS` **确实按值逐个遍历**，命中任一即真；
- 但 `metadb` 把 `ARTIST` 存成**单个分号串**，`get_value_count` 返回 **1**，
  所以「遍历」实际只遍历了那 1 个整串。

两者结合，正好解释第三轮实测的「不是逐值命中」。

**新增的可解释项**：`IS` 处理器在 `0x58CDED` 用大小写不敏感比较器
判断字段名是否等于 `'path'`，相等才走特殊节点（vtbl `0x69EB74`），
否则走普通节点（vtbl `0x69EBC4`）。**只有 `path` 有专用通道，不是文件名。**

> **我上一轮的猜测被推翻**：我曾推测 `IS` 会走文件名通道来解释 `spmq3` 差 1，
> 反汇编证明那不对——文件名通路只对字段名恰好为 `path` 时启用。

### 1.2 19 项运算符的完整扫描（本轮）

把 19 个 handler 全部反汇编并按「构造的节点虚表」归类，得到清晰分族：

| 家族 | 运算符 | 典型实现字节数 |
| --- | --- | ---: |
| 排序 | SORT / ORDER | 98 |
| 布尔 | OR / AND / NOT | 165–168 |
| 文本 | HAS / **IS / IST** | 200 / **409** |
| 数值 | EQUAL / GREATER / LESS | **27** |
| 存在性 | MISSING / PRESENT | **27** |
| 时间 | BEFORE / AFTER / SINCE / DURING | 81–216 |
| 特殊 | ALL / NONE | 135 |

**两个可复用的观察**：

1. **EQUAL / GREATER / LESS 是同一个函数的三个薄包装**——各 27 字节，
   结构完全一致，只有压栈的操作码不同（`0` / `1` / `-1`），都调用核心 `0x0058D410`。
   把「比较方向」作为参数传入同一实现，是值得照搬的组织方式。
2. **IS / IST 是最重的运算符**：409 字节、17 个内部调用，
   比第二名 DURING（216 字节）复杂近两倍——这与它在实测中的反直觉行为吻合。
### 1.3 存储层的关键事实

多值字段在 `metadb.info` 中是**单个分号拼接串**（44 行抽样中 ARTIST 出现 >1 次者为 0）。
这解释了为什么「逐值匹配」的直觉不成立——**存储层根本没有「值」这个概念，只有一串字符**。

### 1.4 排除了什么

穷举 50 个候选实现（整串 / 首段 / 末段 / 任段 / 子串 × 大小写两模式，以及各类 OR 组合）：

| 结论 | 强度 |
| --- | --- |
| 「任一段匹配」不成立 | **强**（会给出 14 vs 实测 11） |
| 「首段匹配」不成立 | **强**（`Guest` 会命中 05，实测 0） |
| 「末段匹配」不成立 | **强**（`Bystander` 会命中 04，实测 0） |
| 「子串包含」不成立 | **强**（`SpmQ` 会命中 15 条，实测 1） |
| 「整串相等 + 大小写不敏感」是**最优但非完美** | 7/8，仅 `spmq3` 差 1 |

### 1.5 仍然未知

**为什么 `ARTIST IS spmq3` = 12 而 `ARTIST IS SpmQ3` = 11？**

数据里只有一个全小写的 `spmq3`（第 11 首），按整串相等 + 不分大小写两查询都应是 11。
差的这一条来源未定。剩余假设是「第二个比较通道参与并集」，但**未实测验证**。

> **诚实标注**：这一节的价值在于**排除**，不在于**确立**。
> 把「不是逐值」升级为「不是任何简单分段/整串实现」，
> 候选空间从 4 种缩到「需要额外通道」这一种。
>
> **本轮已用 capstone 完成反汇编**（见 §3.0）：
> `IS` 比较函数 `0x0058BCF0` 的控制流已完整重建——它**确实按值遍历**，
> 只是存储层把多值存成单串，所以实际只比较整串。
> `'path'` 只有字段名恰为 `path` 时才走专用通道，**并非文件名通路**
> （我上一轮的猜测已被推翻）。
>
> **算法已严格重建并验证**：`IS` 的主匹配函数是 **`0x0063B3B0`**，
> 一个**带通配符（`*` `?`）的大小写不敏感匹配器**，模式中遇 `;` 时按标志位返回失败。
> 把这段反汇编严格翻译成代码后跑 8 条实测探针，**7/8 吻合**——只有 `spmq3` 那条差 1。
> 这说明核心匹配逻辑已被正确理解，剩余的是一个单点特例，不是「整块黑箱」。
>
> **对照 `HAS`**：`HAS` 的比较函数是 `0x0058C180`，直接用 `[esi+0x68]` 做子串匹配，
> **没有** `get_value_count` 循环；`IS` 才有。这从指令级证实了「`HAS` 是子串、`IS` 是整值」。
>
> **仍然未知**：`ARTIST IS spmq3` = 12 与 `IS SpmQ3` = 11 的差 1。
> 两个大小写标志位 `[edi+0x20]`/`[edi+0x21]` 的实际取值需要**动态调试**才能确认，
> 静态反汇编到此为止。
>
> **本轮尝试用 GUI 复测（读 `Playlist Search` 的 `(N results)`）未成功**：
> 菜单能读出（`Search` 为 id=4），但选中后对话框始终不出现；
> 换到带 Album List 的布局后 Filter 可写入，但树内容为空
> （界面提示 `Nothing to show - configure Media Library first`）。
> 这与第三轮记录的是同一个墙。**因此没有任何新的行为数据**，
> `ARTIST IS spmq3` = 12 与 `ARTIST IS SpmQ3` = 11 的差 1 **仍未解释**。

---

## 二、查询分派表的项数修正（19 项，非 22 项）

本轮独立复核 A′ 的分派表，**项数、基址与结构边界都要改**：

| 项 | 第三轮 | 第四轮实测 |
| --- | --- | --- |
| 基址 | `0x27BD3C` | **`0x27BD40`** |
| 项数 | 22 | **19** |
| 区间 | — | `[0x27BD40, 0x27BE24)`，228 字节 |
| 行结构 | 未记录 | `{const char* name; u32 flags; u32 handler}` |

**第三轮多出的 3 项从哪来**：19 项之后紧跟一个**独立结构**——
`0x27BE24` 起、**8 字节一对**、共 5 对的「短名 → 时间戳长名」别名表：

```
%first_played%  -> %first_played_timestamp%
%last_played%   -> %last_played_timestamp%
%added%         -> %added_timestamp%
%last_modified% -> %_timestamp%
%file_created%  -> %_timestamp_created%
```

按 12 字节步长越过第 19 项后，就把这张 8 字节对表的字节错位读成了「运算符」。
**12 字节步长只在 19 项内成立。**

**两个新事实**：

1. **`IS` 与 `IST` 共用 handler `0x0058CD20`** —— 从分派层支持「两者走同一比较例程」。
2. **B（foobaka）同区间 228 字节逐字节相同** —— B 与 A′ 在查询分派层**没有差异**，
   这否掉了「B 可能改过检索语义」的猜测。
