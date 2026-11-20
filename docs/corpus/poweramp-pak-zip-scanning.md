---
doc_id: "ARCH-POWERAMP-PAK-ZIP-SCANNING"
title: "插件系统（十四）：pak zip 扫描与条目入库"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 1
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/corpus/poweramp-pak-apk-resolution.md（十三）"
  - ".rea-analysis/smali/smali/com/maxmpz/milk/scanner/B.smali"
---

# 插件系统（十四）：pak zip 扫描与条目入库

## 0. 一句话结论

第十三篇的 Х(apkPath, pkg, flag, set) 只是防重入包装器；真正的 zip 枚举在 у()，而枚举本身又交给 native。

> zip 名字枚举是 native 方法，Java 只拿到一个字符串迭代器。这是继 native_get_plugins 之后第二处硬边界。

---

## 1. Х() 防重入包装（`:1408-1462`）

流程：先判空，再用 apk:// 加编码后的包名做去重键，未见过则转调 у()。

| 要点 | 说明 |
| --- | --- |
| 去重键 | apk:// 加 Uri.encode(pkg)，与第五篇构造端一致 |
| p5 参数 | 恒为 true（`:1448` const/4 v7, 0x1） |
| 调用点 | `:286`、`:330`、`:667`、`:712` |

> 去重键用 URI 而非包名，保证同一 pak 不被重复扫描。这也是第五篇构造必须 Uri.encode 的原因：它是身份标识。

---
## 2. у() 扫描核心（`:1464-1588`）

### 2.1 前置

包名长度必须大于 1，随后把容器写入数据库并取回 id。

### 2.2 前缀选择（`:1486-1509`）

```smali
if (prefixMode) {
    iter = native_get_zip_names_iterator(pkg, "assets/milk_presets/", extra);
} else {
    iter = native_get_zip_names_iterator(pkg, "", 1);
}
```

> pak 的预设必须放在 assets/milk_presets/ 下，这是外部 pak 的目录约定。第五篇遗留的资源文件名约定问题在此得到答案。

### 2.3 遍历（`:1513-1568`）

| 常量 | 值 | 含义 |
| --- | ---: | --- |
| 0x2710 | **10000** | 单 pak 最多条目数 |
| assets/milk_presets/ | — | 固定资源前缀 |
| ?tex= | — | 贴图目录查询参数 |

### 2.4 目录项与文件项

| 类型 | 判据 | 处理 |
| --- | --- | --- |
| 目录 | name 以斜杠结尾 | 非前缀模式记 ?tex=，不入库 |
| 文件 | 其它 | 调 K(name, containerId) 入库 |

> 只有第一个目录被记为 tex。

---
## 3. K(String, long) 条目入库（`:377-470`）

采用先查后插两段式：

| 阶段 | 条件 | 动作 |
| --- | --- | --- |
| 查询 | 选中容器内同名预设 | simpleQueryForLong |
| 命中 | 已存在 | 只写关联表，计数加一 |
| 未命中 | 触发 SQLiteDoneException | 插入新预设行，按分隔数组切分名字 |

> **⚠️ 订正（第十五篇）**：去重是**容器内**的（查询含 `parent_id`），不是跨 pak。
> 同名预设在不同 pak 中**会重复存储**，换来的是删除某 pak 时互不影响。

---

## 4. 完整 pak 扫描链路

```
scanContainer(uri)  (:499)
  builtin: / compiled:  ->  y(true)
  dir:                  ->  File 扫描
  apk://                ->  分自己包/外部包（第十三篇）
        ↓
    Х(apkPath, pkg, flag, seen)     防重入
        ↓
    у(flag, path, pkg, extra, true)
        ├─ А(flag, path)  容器入库
        ├─ native_get_zip_names_iterator("assets/milk_presets/")
        └─ 逐条：目录记 ?tex= / 文件调 K()
```

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | URI 作去重键 | 与构造端一致，天然唯一 |
| A2 | 固定 assets/milk_presets/ 前缀 | pak 打包规范清晰 |
| A3 | 10000 条上限 | 防恶意 pak 撑爆数据库 |
| A4 | 先查后插 | **容器内**幂等重扫（不跨 pak） |
| A5 | 目录跳过但记 tex | 贴图目录不污染预设列表 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 异常控制流（把 SQLiteDoneException 当不存在） | 正常分支用异常，性能差 |
| N2 | native 做 zip 枚举 | 无法静态验证，纯黑盒 |
| N3 | 10000 是魔法数 | 无命名常量 |
| N4 | parts 数组无边界校验 | 名字不含分隔符时可能越界 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | native_get_zip_names_iterator 的实现 | **native，硬边界** |
| ~~Q2~~ | ~~Р 字段内容~~ | ✅ **已闭合**（十七）：`Р` 是 `new String[2]` **输出参数**，接收 author/name |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| Х() 防重入 | `milk/scanner/B.smali:1408-1462` |
| 去重键构造 | `B.smali:1423-1437` |
| 去重判定 | `B.smali:1439-1445` |
| у() 扫描核心 | `B.smali:1464-1588` |
| 包名长度校验 | `B.smali:1467-1475` |
| 容器入库 | `B.smali:1478` |
| 固定前缀 | `B.smali:1494-1496` |
| 空前缀分支 | `B.smali:1505-1507` |
| 10000 上限 | `B.smali:1520` |
| 目录判定 | `B.smali:1528-1532` |
| ?tex= | `B.smali:1544-1552` |
| 条目入库调用 | `B.smali:1562` |
| 收尾 | `B.smali:1571-1575` |
| K() 先查后插 | `B.smali:377-470`（catch 标签 `:436`） |

> 口径：**build-1025**。
