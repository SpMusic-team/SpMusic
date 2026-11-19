---
doc_id: "ARCH-FOOBAR-EVIDENCE-INDEX"
title: "foobar2000 / foobaka 逆向成果索引"
doc_type: "index"
status: "draft"
owner_agent: "lead"
version_scope: "research"
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "docs/corpus/foobar2000-*.md（24 篇研究报告与 39 个证据文件的全量映射）"
---

# foobar2000 / foobaka 逆向成果索引

> **用途**：按主题检索「哪条结论在哪篇文档、证据在哪个文件」。
> **24 篇文档 + 39 个证据文件**的全量映射。

## 零、先看哪篇

| 你想知道 | 看这篇 |
| --- | --- |
| 全局结论、两个终止条件 | [foobar2000-investigation-summary.md](foobar2000-investigation-summary.md) |
| 反汇编地址、运算符表 | [foobar2000-disassembly-reference.md](foobar2000-disassembly-reference.md) |
| 查询语法语义 | [foobar2000-search-mechanisms.md](foobar2000-search-mechanisms.md) |
| 曲库/存储机制 | [foobar2000-library-mechanisms.md](foobar2000-library-mechanisms.md) |
| **`IS` 运算符的完整语义** | [foobar2000-is-operator.md](foobar2000-is-operator.md) |
| **文件操作与播放列表格式** | [foobar2000-fileops-playlist.md](foobar2000-fileops-playlist.md) |
| **主题容器 `.fth` 格式** | [foobar2000-theme-format.md](foobar2000-theme-format.md) |
| **最近 8 轮的新发现** | [foobar2000-foobaka-phase-4-findings.md](foobar2000-foobaka-phase-4-findings.md) |
| SpMusic 该怎么实现 | [search-grammar-gap-analysis.md](../architecture/search-grammar-gap-analysis.md) / [dynamic-playlist-format.md](../architecture/dynamic-playlist-format.md) |
| 还有哪些没做、怎么交接 | [foobar2000-gui-operator-handoff.md](foobar2000-gui-operator-handoff.md) |

## 零之二、证据强度分级（**先看这个**）

本研究的结论**可信度差异很大**，关键在样本量。下表按强度排列，
**「强」可以直接用，「中」只能当参考，「弱/未解」不应作为设计依据**。

### 强（样本充分，可放心使用）

| 结论 | 样本量 | 文档 |
| --- | --- | --- |
| `.fth` 容器格式（含解析方法） | **69 份**（32 官方 + 37 foobaka） | [theme-format](foobar2000-theme-format.md) |
| `.fth` 跨版本零变化 | **128 份**（32 × 4 版本） | [theme-format](foobar2000-theme-format.md) |
| 运算符分派表 19 项 | **4 个版本** | [disassembly-reference](foobar2000-disassembly-reference.md) |
| ReplayGain 四值是哨兵 | **400 条记录** | [summary](foobar2000-investigation-summary.md) |
| 接缝无缝（CUE 分轨） | **480,000 样本** | [phase-4-comparison](foobar2000-foobaka-phase-4-comparison.md) |
| `IS`/`HAS` 是并行语义 | 反汇编 + 多轮实测 | [is-operator](foobar2000-is-operator.md) |
| SpMusic 主题 codec 逐字段降级 | 全文核查 | [phase-4-findings](foobar2000-foobaka-phase-4-findings.md) |

### 中（样本少或有未验证部分）

| 结论 | 限制 | 文档 |
| --- | --- | --- |
| `.fcl` 记录 type 枚举（47 条） | **1 个独立样本**，占比不可外推 | [phase-4-findings](foobar2000-foobaka-phase-4-findings.md) |
| `.fcl` 面板树（11 实例 / 4 层） | **1 个独立样本** | [phase-4-findings](foobar2000-foobaka-phase-4-findings.md) |
| `.fpl` 结构（含 468 B 尾部） | **1 个独立样本**，字段是否恒定未验证 | [fileops-playlist](foobar2000-fileops-playlist.md) |
| `IS` 算法重建 | 8 条探针 **7/8 吻合**，差 1 未解释 | [is-operator](foobar2000-is-operator.md) |
| 三个 Tab 页配置对比 | **1 个独立样本** | [phase-4-findings](foobar2000-foobaka-phase-4-findings.md) |

### 未解（需要动态调试，静态已到边界）

| 项 | 为什么做不到 |
| --- | --- |
| `ARTIST IS spmq3` = 12 vs `SpmQ3` = 11 的差 1 | 需在 `get_key`/标志位处下断点 |
| `metadb_index` 的 64-bit 哈希算法 | 两条独立路径（数据反推 + 反汇编）均失败 |
| `.fth` 内层几何字段语义 | 结构因主题而异，无统一定位 |
| `.fpl` 尾部区 `+0`–`+80` 字段语义 | 只有 1 样本，无法交叉验证 |

> **一句话**：**只有 `.fth` 那套是对 69–128 个真实样本验证过的**，
> 其余大多建立在 1–4 个样本上。引用时请先看这一节。

## 一、按主题索引

### 1.1 查询引擎

| 结论 | 文档位置 | 证据文件 |
| --- | --- | --- |
| 运算符分派表 19 项、12/16 字节步长 | disassembly-reference §一 | `operator-table.json` |
| **`IS` 专题（独立成篇）** | [is-operator.md](foobar2000-is-operator.md) | 见该文 |
| **跨版本步长 12→16 的变化** | disassembly-reference §一之二 | `version-dispatch-structure.json` |
| `IS`/`IST` 共用 handler `0x0058CD20` | disassembly-reference §一 | `operator-table.json` |
| `IS` 比较函数 `0x0058BCF0` 完整控制流 | disassembly-reference §三 | `is-handler-disassembly.json` |
| `IS` 主匹配器 `0x0063B3B0`（7/8 探针吻合） | disassembly-reference §3.1 | `is-algorithm-verified.json` |
| `HAS` 是子串、`IS` 是整值（指令级证实） | disassembly-reference §3.2 | `is-algorithm-verified.json` |
| 通配符 `?` 按 UTF-8 字符推进 | findings §3.0b | `utf8-wildcard-semantics.json` |
| 50 个候选实现全排除 | findings §3.2 | `is-semantics.json` |
| 静态分析边界（差 1 未解） | findings §3.3 | `is-static-limit.json` |

### 1.2 数据存储

| 结论 | 文档位置 | 证据文件 |
| --- | --- | --- |
| `metadb` 15 字段（2.26 为 16） | library-mechanisms §一 | `version-metadb-schema.json` |
| **2.26 新增 `partial` 列** | library-mechanisms §一之二 | `version-metadb-schema.json` |
| ReplayGain 四值全是哨兵（400 样本零例外） | findings §三之五 | `replaygain.py` 产出 |
| 多值字段存成单个分号串 | findings §3.1 | `is-semantics.json` |
| 播放统计走独立索引表 | findings §2.3 | `b-behavior-findings.json` |
| 索引主键带子轨前缀 | library-mechanisms | `b-behavior-findings.json` |

### 1.3 动态列表

| 结论 | 文档位置 | 证据文件 |
| --- | --- | --- |
| 136 B 定义 blob 格式 | comparison §三之六 | `autoplaylist-synthesis.json` |
| **可离线合成**（不依赖 GUI） | comparison §三之六 | `autoplaylist-synthesis.json` |
| **过滤条件不持久化**（穷举确认） | comparison §三之七 | `filter-location-exhausted.json` |
| SpMusic 应自定格式 | [dynamic-playlist-format.md](../architecture/dynamic-playlist-format.md) | — |

### 1.4 布局与主题

| 结论 | 文档位置 | 证据文件 |
| --- | --- | --- |
| `.fcl` 记录格式（type 0/1/2/4/5） | findings §2.1f | `fcl-record-semantics.json` |
| **`4532EC89` 是布局骨架（21 实例/18 容器）** | findings §2.1e | `fcl-panel-tree.json` |
| DUI 有部分加载、Columns UI 没有 | findings §2.1g | `dui-vs-columnsui-failure.json` |
| `.fth` 四版格式零变化 | library-mechanisms §三之二 | `fth-format-stability.json` |
| `.fth` 19 纯配色 + 13 纯布局 | library-mechanisms §三之二 | `fth-format-stability.json` |
| `.fth` LAYOUT 内层结构（差分法解出） | **[theme-format §二](foobar2000-theme-format.md)** | `fth-inner-structure.json` |

### 1.5 播放列表格式

| 结论 | 文档位置 | 证据文件 |
| --- | --- | --- |
| B 用 v1.4、A′ 用 v2.0 | findings §2.1 | `b-index-dat.json` |
| **`.fpl` 自包含 vs `.fplite` 纯引用（42 倍差）** | **[fileops-playlist §二](foobar2000-fileops-playlist.md)** | `fpl-vs-fplite.json` |
| `52655132` 是属性类型 GUID 不是 client GUID | findings §2.2 | `b-index-dat.json` |

### 1.6 文件操作

| 结论 | 文档位置 | 证据文件 |
| --- | --- | --- |
| **预设是 INI 格式，8 个键 4 种操作** | **[fileops-playlist §一](foobar2000-fileops-playlist.md)** | `fileops-preset-format.json` |
| 9 个模板占位符与默认模板 | library-mechanisms §2.2.2 | `fileops-preset-format.json` |
| 组织与恢复只读体检 | comparison §三之八 | `org-healthcheck-p4a.json` |
| 批量迁移仍未实测 | handoff 任务 C | `org-recovery-findings.json` |

### 1.7 音频

| 结论 | 文档位置 | 证据文件 |
| --- | --- | --- |
| WASAPI 环回可自建（不依赖设备） | comparison §二 | `a1-results.json` |
| 负对照 250ms 静音定位误差 −1.312ms | comparison §2.3 | `a1-negative-control.json` |
| CUE 分轨逐样本零误差 | comparison §2.4 | `a1-results.json` |
| **共享混音链路工作在 16-bit** | comparison §二之五 | `precision_v2.py` 产出 |

### 1.8 SpMusic 侧

| 结论 | 文档位置 | 证据文件 |
| --- | --- | --- |
| appearance codec 是逐字段降级（126 fallback / 0 throw） | findings §3.6.1 | `spmusic-vs-foobaka-config.json` |
| SpMusic 只有 `HAS` 语义，缺 `IS` | findings §3.6.2 | [search-grammar-gap-analysis.md](../architecture/search-grammar-gap-analysis.md) |
| 字段已齐备，查询层零成本接入 | gap-analysis §三 | — |

### 1.9 受阻项

| 项 | 状态 | 文档 |
| --- | --- | --- |
| GUI 操作类（找歌/搜索对话框） | 移交人工 | [handoff](foobar2000-gui-operator-handoff.md) |
| `IS` 差 1 的解释 | 静态边界 | findings §3.3 |
| 索引 64-bit 哈希 | 静态边界 | `index-hash-final.json` |
| `.fth` 几何字段语义 | 未解 | library-mechanisms §3.3.5 |
| `.fcl` 面板父子关系编码 | 未解 | findings §2.1f |

## 一之二、文档全表（24 篇）

| 文档 | 行数 | 主题 |
| --- | ---: | --- |
| `foobar2000-investigation-summary.md` | 124 | 全局总结与终止条件 |
| `foobar2000-evidence-index.md` | ~200 | 本文（索引） |
| `foobar2000-disassembly-reference.md` | 257 | 反汇编地址速查 |
| `foobar2000-is-operator.md` | 144 | **IS 运算符专题** |
| `foobar2000-search-mechanisms.md` | 418 | 查询语法语义 |
| `foobar2000-library-mechanisms.md` | 413 | 曲库存储机制 |
| `foobar2000-theme-format.md` | 134 | **主题容器格式** |
| `foobar2000-fileops-playlist.md` | 122 | **文件操作与播放列表** |
| `search-grammar-gap-analysis.md` | 159 | SpMusic 查询差距分析 |
| `dynamic-playlist-format.md` | 178 | 动态列表格式设计 |
| `foobar2000-foobaka-phase-2-findings.md` | 612 | 第二轮逆向 |
| `foobar2000-foobaka-phase-2-comparison.md` | 810 | 第二轮实验记录 |
| `foobar2000-foobaka-phase-2-candidates.md` | 483 | 11 张候选实施卡 |
| `foobar2000-foobaka-phase-3-findings.md` | 620 | 第三轮逆向 |
| `foobar2000-foobaka-phase-3-comparison.md` | 935 | 第三轮实验记录 |
| `foobar2000-foobaka-phase-3-scan-diagnostics.md` | 169 | 扫描诊断候选卡 |
| `foobar2000-foobaka-phase-4-findings.md` | 342 | 第四轮（后续 8 轮）逆向 |
| `foobar2000-foobaka-phase-4-comparison.md` | 495 | 第四轮实验记录 |
| `foobar2000-gui-operator-handoff.md` | 122 | 界面实验移交卡 |
| `foobar2000-research.md` | 84 | 首轮公开资料研究 |
| `foobar2000-foobaka-ds-capabilities.md` | 29 | 能力报告 |
| `foobar2000-foobaka-ds-phase-2-plan.md` | 89 | 第二轮执行方案 |
| `foobar2000-foobaka-ds-phase-3-plan.md` | 87 | 第三轮执行方案 |
| `foobar2000-foobaka-ds-research-goals.md` | 56 | 研究目标 |

> **阅读建议**：先看 summary，再按主题看专题，最后按需翻原始轮次记录。
> phase-2/3/4 的 findings + comparison 是**按时间**组织的原始记录，
> 而专题文档是**按主题**重新组织的结论——两者内容有重叠，以专题为准。
## 一之三、证据库一致性（第 38 轮审计）

对全部答案 JSON 做了有效性检查与数值一致性比对：

| 项 | 结果 |
| --- | --- |
| **JSON 有效性** | **51/51 全部有效** |
| 数值冲突 | 发现 1 处（`fcl-header-correction.json` 的计数），**已修正** |
| 残留冲突 | **0** |
| 标记为过期的文件 | 2 个（`fcl-header-correction.json`、`fth-inner-structure.json`） |

**当前一致的权威数值**：

| 指标 | 值 |
| --- | ---: |
| 面板实例数 | **11** |
| 面板类型数 | **10** |
| 类型名出现次数 | 21（10 类型表 + 11 实例） |
| GUID 引用次数 | 45 |
| 记录总数 | 634 |
| 每版本 .fth 数 | 32 |
| 官方 COLORS / LAYOUT | 19 / 13 |

> **过期文件的处理方式**：原地修正 + 保留原始观察值于 `raw_observations_kept`
> + 标注 `SUPERSEDED_BY`。这样既保证当前数值一致，又保留了追溯链。

## 二、证据文件全表（52 个）

| 文件 | 大小 | 主题 |
| --- | ---: | --- |
| `a1-negative-control.json` | 685 B | 音频 负对照 |
| `a1-results.json` | 491 B | 音频 接缝结果 |
| `autoplaylist-synthesis.json` | 1,731 B | 动态列表 合成 |
| `b-behavior-findings.json` | 39,762 B | B 侧行为层全量 |
| `b-crash-reports.json` | 11,353 B | B 崩溃报告汇总 |
| `b-index-dat.json` | 231 B | B 的 v1.4 index.dat |
| `b-ui-rootcause.json` | 3,000 B | B 白屏根因 |
| `dui-vs-columnsui-failure.json` | 2,592 B | DUI vs ColumnsUI |
| `fcl-config-records.json` | 7,829 B | 47 条 .fcl 真记录 |
| `fcl-panel-tree.json` | 2,339 B | 21 个 splitter 实例 |
| `fcl-record-semantics.json` | 961 B | .fcl type 枚举 |
| `fcl-structure.json` | 2,506 B | .fcl 636 节点 |
| `fileops-preset-format.json` | 2,603 B | FileOps INI 格式 |
| `filter-location-exhausted.json` | 2,316 B | 过滤条件穷举阴性 |
| `fpl-vs-fplite.json` | 2,695 B | 两种播放列表格式 |
| `fth-format-stability.json` | 2,039 B | .fth 跨版本零变化 |
| `fth-inner-structure.json` | 1,966 B | .fth 内层结构 |
| `fth-layout-structure.json` | 1,455 B | .fth LAYOUT 层级 |
| `gui-blockers.json` | 2,770 B | GUI 受阻记录 |
| `index-hash-attempts.json` | 1,571 B | 哈希尝试（第 12 轮） |
| `index-hash-final.json` | 2,041 B | 哈希最终判定 |
| `is-algorithm-verified.json` | 1,262 B | IS 算法 7/8 验证 |
| `is-disassembly-final.json` | 1,407 B | IS 反汇编最终 |
| `is-handler-disassembly.json` | 1,628 B | IS handler 分派 |
| `is-semantics.json` | 1,742 B | 50 候选排除 |
| `is-static-limit.json` | 1,744 B | IS 静态边界 |
| `operator-table.json` | 4,424 B | 19 项运算符表 |
| `org-healthcheck-p3a.json` | 145,213 B | 曲库体检 phase3 |
| `org-healthcheck-p4a.json` | 160,343 B | 曲库体检 phase4 |
| `org-recovery-findings.json` | 3,139 B | 组织恢复结论 |
| `spmusic-vs-foobaka-config.json` | 2,731 B | 配置容错对比 |
| `u1-interleave-verdict.json` | 1,586 B | 首达/回访判定 |
| `u1-interleave.json` | 1,170 B | 三对交错原始 |
| `utf8-wildcard-semantics.json` | 1,837 B | UTF-8 通配符 |
| `version-dispatch-structure.json` | 1,972 B | 跨版本分派表 |
| `version-metadb-schema.json` | 2,170 B | 跨版本 schema |
| `_org_profile_*.json` | 26 KB | 曲库 profile 快照 |
| `volume-before.txt` | 14 B | 音量基线 |

## 三、可复用脚本（24 个中的核心）

| 脚本 | 用途 |
| --- | --- |
| `WasapiLoopback.cs` | WASAPI 环回录制 + 播放 + 音量控制 |
| `WavAnalyzer.cs` | WAV 对齐/比对/静音定位 |
| `GuiDrive.cs` / `MenuProbe.cs` / `Keys.cs` | 窗口驱动与菜单读取 |
| `op_table.py` | 运算符分派表扫描 |
| `decode_playlists.py` | 播放列表定义解码 |
| `org_healthcheck.py` | 曲库只读体检 |
| `precision_v2.py` | 音频精度实验 |
| `save_*.py` | 各主题的结论落盘 |

## 四、轮次对照

| 轮次 | 主要产出 |
| --- | --- |
| 1–3 | 文档漂移修复、A1 闭合、B 数据层、IS 排除法 |
| 4 | IS 算法反汇编重建（7/8） |
| 5 | 19 项运算符全扫描 |
| 6 | `.fcl` 记录语义 |
| 7–9 | SpMusic 核查与设计 |
| 10–11 | 移交卡、总结、UTF-8 语义 |
| 12 | 索引哈希最终判定（静态边界） |
| 13 | 跨版本分派表 12→16 字节 |
| 14 | 跨版本 metadb schema（partial 列） |
| 15 | FileOps INI 预设格式 |
| 16 | `.fth` 四版零变化 |
| 17 | DUI vs ColumnsUI 失败策略 |
| 18–19 | `.fth` LAYOUT 内层结构（差分法） |
| 20 | `.fpl` vs `.fplite` 语义差 |
| 21 | 本索引（初版） |
| 22 | phase-4 findings 拆分，IS 独立成篇 |
| 23 | library-mechanisms 按主题拆成三篇 |
| 24 | 索引更新至 24 篇 |
