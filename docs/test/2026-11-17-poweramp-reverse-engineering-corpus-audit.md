---
doc_id: "TEST-POWERAMP-RE-CORPUS-AUDIT"
title: "Poweramp 逆向研究资料整体体检报告"
doc_type: "test"
status: "done"
owner_agent: "lead"
version_scope: "corpus"
created: "2026-11-17"
updated: "2026-11-17"
source_documents:
  - "docs/architecture/poweramp-*.md（44 份结论文档）"
  - ".rea-analysis/findings-*.md（15 份原始证据）"
  - ".rea-analysis/decoded/（build-1025 解包，apktool 3.0.3）"
  - ".rea-analysis/smali/（build-1025 smali，7308 文件）"
  - ".rea-analysis/v1035/decoded/（build-1035 解包，apktool 2.11.1，含 smali_classes2）"
  - ".rea-analysis/natives/libpowerampcore.so 等 3 个原生库"
  - "user request: 对既有 Poweramp 逆向解包与结论文档做一次整体核查，产出文档体检报告而不改 SPM 代码"
---

# Poweramp 逆向研究资料整体体检报告

结论：**这套资料的可追溯性是好的——331 条代码级引用全部能落地到真实文件和真实行号，抽查的语义逐字吻合，证据链没有断裂。真正的问题不在"结论对不对"，而在"资料的元信息会骗人"：状态字段与实际完成度不对应、两套引证制度并存却无说明、同一个事实有多个符号名而文档没交代命名体系。**

本次核查为只读：没有修改任何 `docs/architecture/poweramp-*.md`，没有触碰 `src/` 与 `src-tauri/`。

## 0. 核查口径与规模

| 项 | 数值 |
| --- | --- |
| 结论文档 | 44 份 `docs/architecture/poweramp-*.md`（约 2.7 MB） |
| 原始证据 | 15 份 `.rea-analysis/findings-*.md` |
| 解包产物 | build-1025：apktool 3.0.3；build-1035：apktool 2.11.1（含 `smali_classes2`） |
| 两个版本 | 1025009 `build-1025-uni`（单 dex）/ 1035009 `build-1035-bundle-play`（bundle 拆分） |
| 证据标记 | 【实证·产物】/【实证·原文】/【实证·smali】/【推断】四级 |

核查方法分七轮，每轮只回答一个问题，前一轮结论不成立就不进入下一轮。全部结论可用本报告描述的方式复跑。

---

## 1. 结论速览

| # | 核查项 | 结果 |
| --- | --- | --- |
| A | 文档内 `.rea-analysis` 路径引用（38 条去重） | **全部存在**，0 失效 |
| B | 引用行号是否越界（14 条带行号） | **全部在文件范围内**，0 越界 |
| C | `ev_` Evidence ID 可追溯性（156 次引用） | **154 命中，2 条断链**（§4） |
| D | smali 行号直引（331 条） | **331 条全部可解析到真实文件，0 越界**（§2） |
| E | 论断语义抽验（9 条随机 + 11 条带字面量） | **20/20 成立** |
| F | 文档间交叉引用（539 处） | **0 指向不存在的文档** |
| G | `source_documents` 仓内路径（123 条） | **0 失效** |
| H | 引证制度一致性 | **两套制度并存，无任何说明**（§3） |
| I | `status` 字段与实际完成度 | **系统性不对应**（§3） |
| J | 版本域归属 | **44 份全部显式声明**，跨版引用均有交代（§5） |

**一句话**：硬证据几乎满分，软元信息（status / 引证体系说明 / 命名体系说明）系统性缺失。

---

## 2. 证据链核查：331 条代码引用全部落地

这是本次核查最有价值的结果。从 13 份文档中提取 **331 条 smali 行号直引**，按各文档声明的版本域解析到真实文件后：

- **331 / 331 可解析到真实存在的 smali 文件**，0 条失效；
- **331 / 331 引用行号在文件实际行数范围内**，0 条越界；
- 其中 11 条在引用行上直接给出了字面量字符串，**11 / 11 逐字命中**。

随机 9 条抽验（文档论断 vs 该行源码原文）：

| 文档论断 | 指针 | 源码实际 | 判定 |
| --- | --- | --- | --- |
| 分发表命中 `0x7f160014` | `smali/ׅ/u61.smali:434` | `const v9, 0x7f160014` | ✅ |
| **`А` 读 `store`** | `smali/ׅ/q4.smali:277` | `const-string v2, "store"` | ✅ |
| `b71.abstract Q()` | `smali/ׅ/b71.smali:937` | `.method public abstract Q()V` | ✅ |
| `nn.В(String,String)` 逗号分词 | `smali/ׅ/nn.smali:7` | `.method public static В(Ljava/lang/String;Ljava/lang/String;)Z` | ✅ |
| `"buttons"` | `smali/ׅ/z61.smali:521` | `const-string v0, "buttons"` | ✅ |
| `pb1` / `t9` 类型链 | `smali/ׅ/pb1.smali:1` | `.class public final Lׅ/pb1;` | ✅ |
| **`g80.dispatchTouchEvent`** | `smali/ׅ/g80.smali:105` | `.method public final dispatchTouchEvent(...)Z` | ✅ |
| 兜底 `None`（`:1389` 并列引用） | `smali/ׅ/r91.smali:1376` | `if-nez v3, :cond_13`；`:1380` 兜底 `new-instance Preference` | ✅（需连读 :1380） |
| **`vk0.B` 逆序读 6 字段** | `smali/ׅ/vk0.smali:244` | `.method public final B(Lׅ/ci1;Z)...`（方法声明，字段体在后续行） | ✅（声明行，符合"方法体"引法） |

**判定**：这套引用是**指针式引证**——左栏写论断，右栏给路径:行号，读者需回读源码验证语义。这种制度本身可靠，但**可复验性依赖读者回到 `.rea-analysis/`**，而该目录默认不入库（见 §7）。

---

## 3. 两个系统性问题

### 3.1 `status` 字段已经失去信息量

44 份文档中 17 份标 `draft`、27 份标 `active`。但按完成度指标看，**这个划分与内容难度、篇幅、证据密度都不相关**：

| 指标 | draft（17 份） | active（27 份） |
| --- | --- | --- |
| 平均行数 | 1402 | 1031 |
| 平均 `ev_` ID 数 | **0.0** | 5.8 |
| 全部含「未解 / 边界」章节 | 是 | 是 |

反例最能说明问题：

- `poweramp-misc-complete.md` 标 **draft**，却是全系列**第 5 长**（2081 行 / 94.9 KB），含根页 26 元素 + 4 分类 + 全部子页；
- `poweramp-settings-export-import.md` 标 **draft**，2415 行，含 `.poweramp-backup` 格式完整逆向；
- `poweramp-lockscreen-branch-overview.md` 标 **active**，仅 362 行，是**纯导航索引**，本不该用同一套状态语义衡量。

`draft` 目前既不表示"内容不全"，也不表示"未复核"——它事实上退化成了"这批是某轮批量写作时一起落盘的"的时间戳。

### 3.2 两套引证制度并存，且无任何说明

这是最容易误导后续使用者的一点：

| 制度 | 文档数 | 版本分布 | status 分布 |
| --- | --- | --- | --- |
| **A. `ev_` ID 制**（引用 REA Evidence 记录） | 10 份 | 9 份锚 1025 | **全部 active** |
| **B. smali 行号直引制**（指针式） | 34 份 | 29 份锚 1035 | draft 17 / active 17 |
| 两者都无 | 0 份 | — | — |

A 制文档（`bookmarks` / `category` / `entity` / `recents` / `streams` / `search-and-queue-impact` / `library-three-views` / `queue-runtime-reference` / `queue-view` / `audio-output-pipeline`）来自 REA 工具链，证据是 `ev_<64hex>` 记录；B 制文档来自 smali 直接检索，证据是 `路径:行号`。

**问题不是并存本身**（两版目标、两套工具链，各有其合理性），**而是没有任何一份文档说明这件事**。后果：读者拿到一份 draft 文档，发现里面一个 `ev_` ID 都没有，很容易误判为"这份没证据"，而实际上它的 331 条行号引用全部可验证。

---

## 4. 两处具体缺陷

### 4.1 断链：`poweramp-recents-views.md` §13 有 2 条 Evidence ID 不存在

| 位置 | 主题 | Evidence ID | 状态 |
| --- | --- | --- | --- |
| `poweramp-recents-views.md:727` | `e4.mo2437`（top_rated_files_limit） | `ev_6f927d81b0a85cd5b7c075409ff9a9ed57b83362ad521978a6f7aa4b8a9299d8` | **全仓无此记录** |
| `poweramp-recents-views.md:728` | `e3.mo2437`（low_rated_files_limit） | `ev_edc936beecef02672ec8ebb5e6f904babc1337969e3db679ad08434328771ebc` | **全仓无此记录** |

其余 154 次 `ev_` 引用全部命中 `findings-*.md`；且 136 个 Evidence ID **无一被文档遗漏**（双向完整）。

**重要：事实本身是真的，只是 ID 失效。** 我回到 build-1025 smali 逐一核对了这两个论断：

```smali
// rest/library/e4.smali  —— Math.max(2, у.g0)  top_rated
.method public final с()I
    sget-object v0, Lcom/maxmpz/audioplayer/rest/library/у;->g0:Lcom/maxmpz/preference/fastprefs/w;
    iget v0, v0, Lcom/maxmpz/preference/fastprefs/s;->А:I
    const/4 v1, 0x2
    invoke-static {v1, v0}, Ljava/lang/Math;->max(II)I      ← 正是 Math.max(2, …)
```

```smali
// rest/library/e3.smali  —— Math.max(2, у.h0)  low_rated
    sget-object v0, Lcom/maxmpz/audioplayer/rest/library/у;->h0:...
    invoke-static {v1, v0}, Ljava/lang/Math;->max(II)I
```

`e4.X0` 内的 LIMIT 拼接也逐字命中：`invoke-virtual {p0}...->с()I` → `const v1, 0x7fffffff` → `if-eq v0, v1, :cond_3` → `const-string v1, " LIMIT "`。

**根因（已查清）**：`mo2437` 是 **JADX 生成的桥接方法名，smali 里根本不存在**。全仓对两个版本执行 `findstr "mo2437"` 均为零命中；它在 smali 中叫 `с()`。文档沿用了 findings 的 JADX 命名，却没标注"该名仅存在于 JADX 命名体系"。**建议的修法不是删 ID，而是补一句命名体系说明并换用可验证的指针。**

### 4.2 重复查询：同一事实存在两个符号名，文档未交代

与 4.1 同源。`poweramp-recents-views.md` 正文用 `mo2437()`，但 smali 里是 `с()`。同类情况在混淆风格上普遍存在（`ׅ` 包内大量单字母类名 + 西里尔字母方法名）。**这不是错误，是缺少一张"JADX 名 ↔ smali 名"对照说明。**

---

## 5. 版本域：比表面看起来干净

按 front-matter 统计：

- **仅锚 1025**：14 份　**仅锚 1035**：25 份　**两版都写**：5 份　**未声明**：**0 份**
- 跨版取证共 3 处，**全部有显式交代**：
  - `poweramp-audio-settings-structure.md` §1.3 明写「**本文以 build-1035 为唯一权威基准**（build-1025 仅作历史对照）」；
  - `poweramp-lockscreen-runtime.md:1307` 主动解释了 `decoded/` 无 `smali_classes2` 而 `v1035/` 有，警告"扫描范围不一致"的误判。
- **5 份"两版都写"逐份查过，全部是有意的跨版对照，不是混用**：
  - `poweramp-list-options.md` §10.2「跨版本对照（build-1035）」
  - `poweramp-queue-view.md` §3.4「跨版本比对」
  - `poweramp-about-branch-overview.md` / `poweramp-lockscreen-branch-overview.md`：在索引里标注了下游文档的版本口径（如「build-1025 首轮枚举，部分结论已被修订」）
  - `poweramp-lockscreen-settings.md`：front-matter 锚 1035，但正文 L44 明确写「**本文保留原样仅供对照**（`status: draft`，build-1025 口径）」

**两版资源的实际差异（供后续选版参考）**：

| | build-1025 | build-1035 |
| --- | --- | --- |
| APK 形态 | 单体 APK，单 `classes.dex` | bundle 拆分（`base.apk` + `split_config.arm64_v8a.apk`） |
| `com.maxmpz` smali | **1808** | **434** |
| 总 smali | 7308 | 4397 + 532（`smali_classes2`） |
| `res/xml` | 53 | 59 |

仅 1035 有：`audio_bit_perfect.xml`、`audio_outputs2.xml`、`audio_outputs_tweaks.xml`、`splits0.xml`、`usb_device_filter.xml`、`widget_4x2_cover.xml`、`widget_4x4_cover.xml`、`widget_samsung.xml`
仅 1025 有：`audio_output.xml`、`audio_outputs.xml`

> 注意 **`com.maxmpz` 类数 1808 vs 434** 这个反差：它是"1025 的 smali 覆盖面更全"的直接证据，也是 4.1 里 `mo2437` 在 1035 侧同样搜不到的原因之一。**选版不能只看版本号更高。**

---

## 6. 待处置项（按优先级）

> **处置状态（2026-11-18 补记）**：P1 三项与 P2 的 `status` 项已处理完毕，
> 处置落点与复核方式见 `docs/corpus/poweramp-corpus-conventions.md` §7。
> 本节原文保留不改，便于对照当年判断。

| 优先级 | 事项 | 性质 | 建议动作 |
| --- | --- | --- | --- |
| ~~**P1**~~ ✅ | ~~`poweramp-recents-views.md` §13 两条 `ev_` 断链~~ | 事实为真，指针失效 | **已修**：换为 `e4.smali:312-326` / `e3.smali:278-292` 指针 + 命名体系说明 |
| ~~**P1**~~ ✅ | ~~两套引证制度无说明~~ | 会误导读者判"无证据" | **已修**：`poweramp-corpus-conventions.md` §2，并在两处根索引挂入口 |
| ~~**P2**~~ ✅ | ~~17 份 `draft` 状态失真~~ | 元信息不可用 | **已修**：44 篇重标为 active/complete/superseded + 新增 `revision`/`open_items`（conventions §6） |
| **P2** | `.rea-analysis/` 默认不入库 | 引用可验证但读者拿不到 | `findings-*.md` 与关键 `res/xml` 已入库（69 文件）；smali 不入库是合理取舍，但需在文档里写明"需自行重新解包" |
| **P3** | 字节数计数口径未写明 | 已被本次核查解释清楚 | 文档的字节数 = 磁盘字节 − CRLF 换行数，即**把 CRLF 归一化为 LF 后的长度**；7 个文件全部精确吻合，建议标注 |

### 6.1 §6 P3 的验证细节

`poweramp-library-full-implementation.md` §1.1 声称媒体库 7 页共 140 行 / 25 533 字节 / 113 元素 / 92 key。实测：

# 台账（每页一行）

| 文件 | 行数 | 元素 | key | 磁盘字节 | CRLF 数 | LF 归一化 | 文档字节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `library.xml` | 29 ✓ | 25 ✓ | 21 ✓ | 5394 | 29 | 5365 | 5365 ✓ |
| `library_lists.xml` | 38 ✓ | 32 ✓ | 29 ✓ | 7064 | 38 | 7026 | 7026 ✓ |
| `library_queue.xml` | 15 ✓ | 12 ✓ | 9 ✓ | 2715 | 15 | 2700 | 2700 ✓ |
| `library_scanner.xml` | 23 ✓ | 18 ✓ | 14 ✓ | 5033 | 23 | 5010 | 5010 ✓ |
| `library_search.xml` | 9 ✓ | 6 ✓ | 5 ✓ | 1052 | 9 | 1043 | 1043 ✓ |
| `library_shuffle.xml` | 11 ✓ | 8 ✓ | 6 ✓ | 2010 | 11 | 1999 | 1999 ✓ |
| `library_playlists.xml` | 15 ✓ | 12 ✓ | 8 ✓ | 2405 | 15 | 2390 | 2390 ✓ |
| **合计** | **140 ✓** | **113 ✓** | **92 ✓** | **25673** | **140** | **25533** | **25533 ✓** |

**行数、元素数、key 数、字节数四项全部精确**。字节口径经反推确认：文档统计的是**把 CRLF 归一化为 LF 后**的长度（磁盘字节 25673 − 140 个 CR = 25533）。这不是错误，是未写明的计数约定。

---

## 7. 复跑方式

本报告全部数字可用以下方式复现，无需重新解包：

1. **路径与行号**：正则 `` `(\.rea-analysis/[^`]+)` `` 提取，按文档 front-matter 声明的版本域决定解析根（1035 → `.rea-analysis/v1035/decoded/`，1025 → `.rea-analysis/`）。
2. **Evidence ID**：全 `docs/architecture/*.md` 提取 `ev_[0-9a-f]{64}`，与 `.rea-analysis/findings-*.md` 中的全集求差。
3. **版本域**：取文档前 3000 字符匹配 `1025009|build-1025` 与 `1035009|build-1035`。
4. **计数复核**：对 `v1035/decoded/res/xml/library*.xml` 统计行数、`android:key=` 出现次数、开标签数、字节数。

---

## 8. 边界与未覆盖

- 本次**未逐条复核全部 331 条引用**的语义，只抽验 20 条（9 条随机 + 11 条自带字面量），**20/20 成立**。剩余属概率性证据，不构成全量断言。
- 本次**未核验原生层结论**（`poweramp-audio-output-pipeline.md` 基于 `libpowerampcore.so` 字符串与符号扫描）。该类证据需重新扫描 `.so` 才能验证。
- 本次**未评估结论对 SpMusic 的适用性**——那属于架构决策范畴，不在体检范围。
- 本次**未修改任何结论文档**，§6 的处置项均为建议，未执行。
