---
doc_id: "ARCH-FOOBAR-HANDOFF"
title: "foobar2000 / foobaka 逆向研究交接文档"
doc_type: "handoff"
status: "final"
owner_agent: "Architecture Agent"
version_scope: "research"
created: "2026-11-18"
updated: "2026-11-18"
---

# 交接文档：怎么用这些结论，怎么继续

> 这份文档面向**接手的人**。看完它，你不需要读完前面 24 篇。

## 零、30 秒速览

| 问题 | 一句话答案 |
| --- | --- |
| 这套研究可信吗？ | **只有 `.fth` 那套经过 69–128 个真实样本验证**，其余多基于 1–4 个样本 |
| 最该先看哪篇？ | [证据强度分级](foobar2000-evidence-index.md) → [全局总结](foobar2000-investigation-summary.md) |
| 能直接用于 SpMusic 吗？ | 可以，但**只用「强」级别那几条** |
| 还能继续逆向吗？ | 静态已到边界，剩下需**动态调试**或**人工操作界面** |

## 一、能用的结论（按可用度排序）

### 1.1 可直接落地

| 结论 | 怎么用 | 出处 |
| --- | --- | --- |
| **「部分加载 + 列出缺失项」优于整块失败** | 布局加载逐项尝试，失败项记占位并累积清单 | [DUI 对比](foobar2000-foobaka-phase-4-findings.md) |
| **容器类型与叶子类型要分级处理** | 容器缺失降级为扁平，叶子缺失只影响自身 | 同上 |
| **配色与布局预设应分离** | 做成两个独立交换单位，不要混合主题包 | [theme-format](foobar2000-theme-format.md) |
| **ReplayGain 用哨兵值表未设置** | `-1000.0` = 增益未扫，`-1.0` = 峰值未扫 | [library-mechanisms](foobar2000-library-mechanisms.md) |
| **FileOps 预设用 INI 格式** | 8 键 / 4 操作 / 9 占位符，比 JSON 更适合手改 | [fileops-playlist](foobar2000-fileops-playlist.md) |
| **统计走独立索引表** | 主键含子轨前缀（`0+`/`1+`） | [library-mechanisms](foobar2000-library-mechanisms.md) |
| **不要在主进程跑脚本宿主** | foobaka 35 份崩溃报告中 25 份来自 WSH/OLEAUT32 | [phase-4-findings](foobar2000-foobaka-phase-4-findings.md) |
| **通配符按码点推进，非字节** | JS 里用 `for...of` 而非索引 | [is-operator](foobar2000-is-operator.md) |

### 1.2 需要谨慎使用

| 结论 | 为什么谨慎 |
| --- | --- |
| `.fcl` 的 11 个面板实例 / 4 层树 | **1 个独立样本**，其他布局可能不同 |
| `.fcl` 的 type 枚举 0/1/2/4/5 | **1 个样本**，取值集合可信，占比不可外推 |
| `.fpl` 字段序列 | **1 个样本**，字段是否恒定未验证 |
| `IS` 算法的 7/8 重建 | 差 1 未解释，可能有分支没覆盖到 |

## 二、不能用的（已到边界）

| 项 | 状态 | 唯一可行路径 |
| --- | --- | --- |
| `ARTIST IS spmq3`=12 vs `SpmQ3`=11 | 静态已穷尽 | 动态调试：在标志位 `[edi+0x20]/[edi+0x21]` 下断点 |
| `metadb_index` 64-bit 哈希 | 两条路径均失败 | 动态调试：`get_key` 返回处读 `eax:edx` |
| `.fth` 内层几何字段 | 结构因主题而异 | 反汇编 `foo_ui_std` 序列化代码 |
| 同任务找歌 / 批量迁移实测 | 自动化两轮均失败 | **人工操作**，见 [移交卡](../tasks/foobar2000-gui-operator-handoff.md) |

## 三、剩余未完成条款（P2/P3 方案）

| 条款 | 状态 | 说明 |
| --- | --- | --- |
| P2 §1.1 同任务找歌 | **受阻→已移交** | Album List 必须先人工配置 Media Library |
| P2 §2.3 批量改名/迁移 | **一半完成** | 只读体检已实现，写操作待人工 |
| P2 §3.4 RG 可选验证 | **未做** | 优先级最低，可选 |
| P3 Q1 单变量干预 S | **已证明静态不可能** | 过滤条件不落盘，结论即答案 |
| P3 U1 同任务找歌 | **受阻→已移交** | 与 P2 §1.1 同一堵墙 |
| P3 B 侧行为对照 | **数据层完成** | 行为层需完整桌面 |

**这 6 项里没有一项能靠纯静态分析补齐。**

## 四、如果你要复现

### 4.1 环境

```powershell
# Python（含 capstone 5.0.7）
$py = 'C:\Users\winkeses\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$env:PYTHONIOENCODING = 'utf-8'
```

### 4.2 核心脚本

| 脚本 | 用途 |
| --- | --- |
| `WasapiLoopback.cs` | WASAPI 环回录制 + 播放 + 音量控制 |
| `WavAnalyzer.cs` | WAV 对齐/比对/静音定位 |
| `op_table.py` | 运算符分派表扫描 |
| `decode_playlists.py` | 播放列表定义解码 |
| `org_healthcheck.py` | 曲库只读体检 |

### 4.3 关键地址（A′ 2.24.6 x86）

| 项 | 地址 |
| --- | --- |
| 运算符分派表 | file `0x27BD40`，19 项 × 12 B |
| `IS`/`IST` handler | `0x0058CD20` |
| `IS` 比较函数 | `0x0058BCF0` |
| `IS` 主匹配器 | `0x0063B3B0` |
| `HAS` 比较函数 | `0x0058C180` |
| 大小写折叠表 | `0x00680798` |

## 五、最容易犯的三个错（都踩过）

| # | 错误 | 正确做法 |
| ---: | --- | --- |
| 1 | **只用 2 个相似样本就下通用结论** | 第 19 轮这样得出「`.fth` 内层有统一四字段」，扩展到 13 个样本后被推翻 |
| 2 | **不核对「已解析长度 == 文件长度」** | 第 20 轮因此漏掉 `.fpl` 的 468 B 尾部（26.6%） |
| 3 | **靠上下文就近猜测 GUID 含义** | 第 6–27 轮把 GUID 与面板名的对应整体错位一格，第 28 轮逐条配对才纠正 |

> 这三条是本研究过程中**真实犯过的错**，写在这里是为了让接手的人少走弯路。

## 六、文件地图

```
docs/architecture/
  foobar2000-evidence-index.md      <- 索引 + 证据强度分级（从这里开始）
  foobar2000-investigation-summary.md <- 全局总结
  foobar2000-disassembly-reference.md <- 反汇编地址速查
  foobar2000-is-operator.md          <- IS 运算符专题
  foobar2000-theme-format.md         <- .fth 格式（证据最强）
  foobar2000-fileops-playlist.md     <- 文件操作与播放列表
  foobar2000-library-mechanisms.md   <- 曲库存储
  foobar2000-search-mechanisms.md    <- 查询语法
  search-grammar-gap-analysis.md     <- SpMusic 差距分析
  dynamic-playlist-format.md         <- 动态列表格式设计
docs/test/
  foobar2000-foobaka-phase-{2,3,4}-comparison.md  <- 实验记录
docs/tasks/
  foobar2000-gui-operator-handoff.md <- 界面实验移交卡
.rea-analysis/phase4/run-20261118-p4a/
  raw/      52 个证据 JSON
  scripts/  24 个可复用脚本
```

## 七、两个终止条件

| 条件 | 状态 | 依据 |
| --- | --- | --- |
| **逆向不出结果** | **已达成** | 剩余 4 项全部需要动态调试或人工操作，静态路径已穷尽 |
| **需要实机运行 SpMusic** | **未达成** | SpMusic 侧全部是静态核查与设计，未做过任何运行时验证 |

> 若继续投入，应转向 **SpMusic 侧的实际实现与验证**；
> 因为设计文档（差距分析、动态列表格式）**从未经运行时检验**。
