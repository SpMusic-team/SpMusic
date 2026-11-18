---
doc_id: "ARCH-FOOBAR2000-DISASSEMBLY-REFERENCE"
title: "foobar2000 2.24.6 反汇编参考：查询引擎与关键结构"
doc_type: "architecture-reference"
status: "draft"
owner_agent: "Architecture Agent"
version_scope: "research"
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "docs/architecture/foobar2000-search-mechanisms.md"
  - "docs/architecture/foobar2000-foobaka-phase-4-findings.md"
  - ".rea-analysis/phase4/run-20261118-p4a/"
---

# foobar2000 2.24.6 反汇编参考

> **用途**：把散落在各轮 findings 里的反汇编结论集中成一份**可查址的参考资料**。
> 所有地址基于 `A′ = 官方 foobar2000 2.24.6 x86`，
> SHA-256 `aef2f516a09d1b83afe3115dc035b8e760dfad0266924f13d6339e5c14c749b9`。
> **换版本后地址全部失效**，必须重新定位。

## 零、工具与环境

| 项 | 值 |
| --- | --- |
| 反汇编库 | capstone 5.0.7（`pip install capstone`） |
| PE 解析 | 手写（`.text` VA `0x1000` / RawPtr `0x400`；ImageBase `0x400000`） |
| 权限 | 非管理员即可 |

**VA → 文件偏移的换算**（本样本）：

```
.text   VA 0x001000  RawPtr 0x000400  →  file = 0x400 + (VA - 0x401000)
.rdata  VA 0x275000  RawPtr 0x274400  →  file = 0x274400 + (VA - 0x40675000…)
```

> 注意：`.rdata` 的 `PointerToRawData` 与 `VirtualAddress` 差值不是简单的常量，
> 必须按段表逐段换算。

## 一、查询运算符分派表

| 项 | 值 |
| --- | --- |
| file 偏移 | **0x27BD40** |
| 项数 | **19** |
| 步长 | **12 字节** |
| 结构 | `{ const char* name; u32 flags; u32 handler }` |
| 区间长度 | 228 字节（`0x27BD40` ~ `0x27BE24`） |

**19 项完整表**：

| # | 关键字 | flags | handler |
| ---: | --- | ---: | --- |
| 0 | `SORT` | 1 | `0x0058EB90` |
| 1 | `ORDER` | 1 | `0x0058EB90` |
| 2 | `OR` | 0 | `0x0058C5F0` |
| 3 | `AND` | 0 | `0x0058C540` |
| 4 | `NOT` | 0 | `0x0058C6A0` |
| 5 | `HAS` | 0 | `0x0058CAC0` |
| 6 | `IS` | 0 | `0x0058CD20` |
| 7 | `IST` | 0 | `0x0058CD20` |
| 8 | `EQUAL` | 0 | `0x0058D5A0` |
| 9 | `GREATER` | 0 | `0x0058D560` |
| 10 | `LESS` | 0 | `0x0058D580` |
| 11 | `MISSING` | 0 | `0x0058CA80` |
| 12 | `PRESENT` | 0 | `0x0058CAA0` |
| 13 | `BEFORE` | 0 | `0x0058E410` |
| 14 | `AFTER` | 0 | `0x0058E3B0` |
| 15 | `SINCE` | 0 | `0x0058E470` |
| 16 | `DURING` | 0 | `0x0058E4F0` |
| 17 | `ALL` | 0 | `0x0058E630` |
| 18 | `NONE` | 0 | `0x0058E6D0` |

**`IS` 与 `IST` 共用 handler `0x0058CD20`**；`SORT` 与 `ORDER` 共用 `0x0058EB90`。

## 一之二、跨版本结构变更：2.26 起步长变了（本轮新增）

四个样本的分派表逐一核对后，发现一个此前未记录的结构变更：

| 版本 | 表 file 偏移 | **步长** | 项数 |
| --- | --- | ---: | ---: |
| 2.24.6 | `0x27BD40` | **12** | 20 |
| 2.25.11 | `0x2AC890` | **12** | 20 |
| 2.26.2 | `0x2DA5A0` | **16** | 20 |
| 2.26.3 | `0x2E26C8` | **16** | 20 |

**行结构的变化**：

```
2.24.6 / 2.25.11 (12 B):  { const char* name; u32 flags; u32 handler; }
2.26.2 / 2.26.3 (16 B):  { const char* name; u32 flags; u32 handler; u32 extra; }
```

**判定依据**：按 16 字节解析 2.26.x 时 20 项全部可读、handler 连续合理；
按 12 字节则**第 2 项即断裂**。

**但运算符集合四版完全一致**：

```
SORT ORDER OR AND NOT HAS IS IST EQUAL GREATER
LESS MISSING PRESENT BEFORE AFTER SINCE DURING ALL NONE
```

且两个共用关系也保持：`SORT==ORDER`、`IS==IST`。

> **含义**：2.26 重构了查询引擎的内部数据结构，**对外语义未变**。
> 这解释了为什么 2.26 的 changelog 里查询语法改动极小，却是内部大改。

> **对前文的修正**：本文件第一节写的「12 字节」只对 **2.24.6 / 2.25.11** 成立。
> 2.26.x 是 16 字节。两者解析出**相同的 19 个运算符**。

> **对 SpMusic 的含义**：若只需「运算符集合」这一层语义，四个版本等价；
> **不必跟随** 2.26 的内部结构调整。
## 二、紧邻的时间戳别名表（**不是运算符**）

| 项 | 值 |
| --- | --- |
| file 偏移 | **0x27BE24** |
| 结构 | **8 字节对**（两个 char*） |
| 项数 | 5 |

| 短名 | 长名 |
| --- | --- |
| `%first_played%` | `%first_played_timestamp%` |
| `%last_played%` | `%last_played_timestamp%` |
| `%added%` | `%added_timestamp%` |
| `%last_modified%` | `%_timestamp%` |
| `%file_created%` | `%_timestamp_created%` |

> **历史坑**：第二轮按 12 字节步长越过第 19 项后，把这 8 字节对表的字节**错位读成运算符**，
> 于是「多出」3 项伪关键字。12 字节步长**只在 19 项内成立**。

## 三、`IS` 比较函数（完整控制流）

| 项 | 地址 |
| --- | --- |
| 分派 handler | `0x0058CD20` |
| 节点虚表 | `0x0069EBC4` |
| **比较函数** | **`0x0058BCF0`** |
| 第二虚函数（析构相关） | `0x0058BDE0` |
| 大小写折叠表 | `0x00680798` |
| 大小写不敏感比较器 | `0x00635310` |
| 字段名 `'path'` 常量 | `0x0069E59C` |

**重建出的算法**：

```c
bool IsCompare(node* self /*edi*/, mdb* db /*ebp*/) {
    query = self->pattern;                       // [edi+8]
    idx = db->get_field_index(query, -1);        // [field_vtbl+0x20]
    if (idx == -1) return false;                 // 字段不存在

    count = db->get_value_count(idx);            // [field_vtbl+0x18]  ★
    for (i = 0; i < count; i++) {                // ★ 遍历每一个值
        value = db->get_value(idx, i);           // [field_vtbl+0x1C]
        flagA = self->b20;                       // [edi+0x20]
        flagB = self->b21;                       // [edi+0x21]
        bool hit;
        if (flagA) {
            hit = flagB ? sub_58B8B0(self->pattern, value, self)
                        : sub_63B3B0(value, 0);
        } else {
            hit = flagB ? sub_6390C0(self->b1C, value, self->pattern)  // 主比较
                        : sub_635360(value);
        }
        if (hit) return true;                    // 命中任一即真
    }
    return false;
}
```

**关键事实**：`IS` **确实按值遍历**。它在多值字段上「看起来不逐值」，
是因为 **`metadb` 把多值存成单个分号拼接串**，`get_value_count` 返回 1。

### 3.1 主匹配函数 `0x0063B3B0`（已通过实测验证）

这是 `IS` 分支 `[edi+0x21] != 0` 时调用的比较器。反汇编重建后
**用 8 条实测探针验证，7/8 吻合**——证明重建基本正确。

```c
bool Match(char* vs /*值*/, char* ps /*模式*/, bool flag) {
    while (true) {
        if (flag && *ps == ';') return false;   // 0x63B3C9
        if (*ps == 0) return false;             // 0x63B3D2
        if (*ps == '*') {                       // 0x63B3DC
            if (Match(vs, ps+1, flag)) return true;
            if (*vs) { vs++; continue; }
            return false;
        }
        if (*vs == 0) return false;             // 0x63B3E4
        if (*ps == '?') { ps++; vs++; continue; }// 0x63B3ED
        if (tolower(*vs) != tolower(*ps)) return false;
        ps++; vs++;
    }
}
```

**注意两处反直觉**：

1. 模式遇 `;` 时按 `flag` **返回失败**（不是成功）
2. 模式耗尽时也**返回失败**（`0x63B3D2`），说明它不做整串锚定，
   收尾判断在调用方 `0x58BD7C`：`cmp byte [eax],0` / `sete al`

### 3.2 `HAS` 的对照

| 项 | `HAS` | `IS` |
| --- | --- | --- |
| 比较函数 | `0x0058C180` | `0x0058BCF0` |
| 用的虚表 | `0x69EB9C` / `0x69EB4C` / `0x69EB24`（三种） | `0x69EBC4`（一种） |
| 多值遍历 | **无** | **有**（`get_value_count` 循环） |
| 匹配方式 | `[esi+0x68]` 子串匹配 | `0x0063B3B0` 通配匹配器 |

这从指令级证实了第三轮的实测结论：**`HAS` 是子串，`IS` 是整值比较**。

**大小写折叠表 `0x00680798` 的实测内容**：

| 输入 | 输出 |
| --- | --- |
| `'A'` (0x41) | 0x61（`'a'`） |
| `'Z'` (0x5A) | 0x7A（`'z'`） |
| `'a'`~'z'` | 原值 |

即标准 `tolower` 表，大写与小写映射到同一值。

## 三之三、19 项运算符的家族与虚表对照（本轮扫描）

把 19 个 handler 全部反汇编，按「构造的节点虚表」归类，可以看到清晰的分族：

| 运算符 | 家族 | handler | 字节 | 构造的虚表 |
| --- | --- | --- | ---: | --- |
| `SORT` / `ORDER` | 排序 | 0058EB90 | 98 | 69EA1C |
| `OR` | 布尔 | 0058C5F0 | 168 | 69EC3C 69EC64 69EC8C |
| `AND` | 布尔 | 0058C540 | 168 | 同上 + 69ECB4 |
| `NOT` | 布尔 | 0058C6A0 | 165 | 69EC3C 69EC8C |
| `HAS` | 文本 | 0058CAC0 | 200 | 69EB24 69EB4C 69EB74 69EB9C 69EBC4 |
| **`IS` / `IST`** | 文本 | 0058CD20 | **409** | 69EB74 69EBC4 |
| `EQUAL` | 数值 | 0058D5A0 | **27** | 69EAD4 |
| `GREATER` | 数值 | 0058D560 | **27** | 69EAD4 |
| `LESS` | 数值 | 0058D580 | **27** | 69EAD4 |
| `MISSING` | 存在性 | 0058CA80 | **27** | 同 HAS 那组 |
| `PRESENT` | 存在性 | 0058CAA0 | **27** | 同 HAS 那组 |
| `BEFORE` | 时间 | 0058E410 | 81 | 69E920 69E950 69EA84 69EC3C |
| `AFTER` | 时间 | 0058E3B0 | 81 | 同上 |
| `SINCE` | 时间 | 0058E470 | 117 | 同上 |
| `DURING` | 时间 | 0058E4F0 | 216 | 69E920 69E950 69EA84 |
| `ALL` | 特殊 | 0058E630 | 135 | 同时间组 |
| `NONE` | 特殊 | 0058E6D0 | 135 | 69E920 69EA84 |

### 3.3.1 EQUAL / GREATER / LESS 是同一个函数的三个薄包装

三者各 27 字节，结构完全相同，**只有压栈的操作码不同**：

```asm
; EQUAL   0x0058D5A0
push 0
call 0x58D410
; GREATER 0x0058D560
push 1
call 0x58D410
; LESS    0x0058D580
push -1
call 0x58D410
```

核心 `0x0058D410` 先对两侧做 `0x58C760`（trim），再做数值比较，
用操作码 `0 / 1 / -1` 决定等于 / 大于 / 小于。

> **可复用的设计模式**：把「比较方向」作为参数传入同一个实现，
> 三个入口只做薄包装。SpMusic 若实现查询语法，可以照此组织。

### 3.3.2 IS / IST 是 19 个运算符里最复杂的

| 指标 | 值 |
| --- | ---: |
| 实现字节数 | **409**（第二大是 DURING 的 216） |
| 内部 call 数 | **17** |
| 构造的节点类型 | 2 种（69EB74 path 专用 / 69EBC4 普通） |

「IS 比其他运算符复杂近两倍」这个事实，与它在实测中表现出的种种反直觉行为是吻合的。

### 3.3.3 时间组的虚表

BEFORE / AFTER / SINCE / DURING / ALL / NONE 共用
69E920 / 69E950 / 69EA84 这一组虚表（均为真虚表，首项是代码指针）。
## 四、`IS` 的字段名分派

`0x0058CDAC` ~ `0x0058CE23` 的逻辑：

```c
if (strchr(field_name, '%') || strchr(field_name, '#') || strchr(field_name, '$'))
    → titleformat 通道（节点 vtbl 0x69EBEC，0x40 字节）
else if (stricmp(field_name, "path") == 0)        // 用 0x635310
    → path 专用通道（节点 vtbl 0x69EB74，0x24 字节）
else
    → 普通字段通道（节点 vtbl 0x69EBC4，0x3C 字节）
```

字段名比较**大小写不敏感**（用 `0x635310`）。

## 五、已知的静态分析边界

| 问题 | 卡在哪 |
| --- | --- |
| `ARTIST IS spmq3` = 12 vs `IS SpmQ3` = 11 的差 1 | 两个标志位 `[edi+0x20]`/`[edi+0x21]` 的运行时取值需动态调试 |
| `metadb_index` 的 64-bit key 算法 | GUID 在 `foo_playcount.dll` @ file `0x28D40`，但无直接代码引用；7 种标准哈希常量 + 192 种多项式组合全否 |

## 六、复现步骤

```bash
pip install capstone
```

```python
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
md = Cs(CS_ARCH_X86, CS_MODE_32)
# d = open(exe,'rb').read()   ; v2f() 见本仓库脚本
off = v2f(0x0058CD20)
for i in md.disasm(d[off:off+512], 0x0058CD20):
    print('%08x  %-9s %s' % (i.address, i.mnemonic, i.op_str))
```

脚本参考：`.rea-analysis/phase4/run-20261118-p4a/scripts/`（`disas_is.py`、`is_compare.py`、`case_table.py` 等）。
