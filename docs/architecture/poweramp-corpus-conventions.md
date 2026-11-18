---
doc_id: "ARCH-POWERAMP-CORPUS-CONVENTIONS"
title: "Poweramp 逆向语料的可复验约定（证据制度 / 版本域 / 命名映射）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 修复语料体检报告指出的三个系统性问题（status 失真 / 两套引证制度无说明 / 4 套混淆命名不可互换无从查证）"
  - "docs/test/2026-11-17-poweramp-reverse-engineering-corpus-audit.md"
  - ".rea-analysis/decoded/（build-1025 解包，apktool 3.0.3）"
  - ".rea-analysis/smali/（build-1025 smali，7308 文件）"
  - ".rea-analysis/v1035/decoded/（build-1035 解包，apktool 2.11.1，含 smali_classes2）"
  - "docs/decisions/2026-07-09-document-metadata-standard.md"
---

# Poweramp 逆向语料的可复验约定

> **本文是元规范，不承载取证结论。** 任何一篇 `poweramp-*.md` 的读者在按文中的
> `路径:行号` 回读源码之前，应先读本文，否则会遇到"名字对得上但文件根本不存在"这类
> 纯粹由**版本域**造成的假故障。

## 0. 本文解决什么问题

仓库里 44 篇 Poweramp 结论文档的**硬证据是可验证的**（体检报告实测：331 条 smali 行号
引用 0 失效、539 处交叉引用 0 断链、语义抽验 20/20 成立）。真正的缺陷全在**软约定**上，
而软约定缺失会让读者把"约定的问题"误判成"结论的问题"。

| # | 缺陷 | 后果 | 本文的解法 |
| --- | --- | --- | --- |
| 1 | 两套引证制度并存且无说明 | 没有 `ev_` ID 的文档被误判为"没证据" | §2 定义 A/B 两制 + 复验命令 |
| 2 | 4 套混淆命名体系，文档未交代 | 按 A 文档的类名去 B 版本的产物里找 → 扑空 → 误判"文档造假" | §3 版本域路径映射 + §4 命名规律 + §5 反例实证 |
| 3 | `status` 字段与完成度不对应 | 元信息不可用 | §6 重定义 + 新增 `revision` / `open_items` 两个可对数 |

---

## 1. 两个 build 是两套产物，不是"新版本覆盖旧版本"

仓库同时保留了两个 build 的解包产物。**它们不是同一套东西的两个快照**，而是
**两套独立的混淆映射**。

| | build-1025 | build-1035 |
| --- | --- | --- |
| versionCode | **1025009** | **1035009** |
| versionName | `build-1025-uni` | `build-1035-bundle-play` |
| APK 形态 | 单体 APK，单 `classes.dex` | bundle 拆分（`base.apk` + `split_config.arm64_v8a.apk`） |
| apktool | 3.0.3 | 2.11.1 |
| 解包根 | `.rea-analysis/decoded/` | `.rea-analysis/v1035/decoded/` |
| smali 位置 | `.rea-analysis/smali/smali/`（独立反汇编缓存） | `.rea-analysis/v1035/decoded/smali/` + `smali_classes2/` |
| 总 smali | **7308** | 4397 + 532 |
| `com.maxmpz` smali | **1808** | **434** |
| `res/xml` | 53 | 59 |
| 混淆包 | 无单字符非 ASCII 包 | `ׅ/`（U+05C5）独占 **3088** 个 `.smali` |

> **⚠️ 选版不能只看版本号更高。** `com.maxmpz` 类数 1808 vs 434 说明
> **build-1025 的 smali 覆盖面更全**（单体 APK 未被拆包）。两版都要用，按需选。

---

## 2. 两套引证制度（A / B）

文档引证**不统一**，这不是错误——两套制度对应两条工具链。**但必须知道你读的是哪一套。**

### 2.1 A 制：REA Evidence ID（`ev_<64hex>`）

| 项 | 内容 |
| --- | --- |
| 证据形态 | `ev_<64 位十六进制>`，指向 REA 工具链捕获的一次具名操作记录 |
| 记录落在 | `.rea-analysis/findings-*.md`（已入库，**14 份**，共 **136** 个唯一 ID） |
| 版本域 | 锚定 **build-1025** 一侧的 REA 产物 |
| 采用文档 | **10 份**（B 线为主）：`audio-output-pipeline`(4) / `bookmarks-view`(29) / `category-views`(28) / `entity-views`(14) / `library-three-views`(12) / `queue-runtime-reference`(18) / `queue-view`(2) / `recents-views`(26) / `search-and-queue-impact`(19) / `streams-view`(4)，括号内为引用次数 |
| 复验方式 | 在 `findings-*.md` 里全文搜索该 ID 即可命中记录体 |

### 2.2 B 制：smali 指针式引证（`路径:行号`）

| 项 | 内容 |
| --- | --- |
| 证据形态 | `类文件路径:起止行`，左栏写论断、右栏给指针，读者需回读源码判语义 |
| 记录落在 | 直接引用解包产物（路径形如 `.rea-analysis/<root>/…`），不另存记录 |
| 版本域 | 多数锚定 **build-1035** |
| 采用文档 | **绝大多数**设置树文档 |
| 复验方式 | 见 §3 的路径映射；行号即物理行号（1 起点） |

### 2.3 复验命令（可直接跑）

```powershell
# A 制：列出全文引用的 ev_ ID 并按 findings 求差（应为空）
$doc  = Get-Content -Raw -Encoding UTF8 'docs/architecture/poweramp-recents-views.md'
$used = [regex]::Matches($doc, 'ev_[0-9a-f]{64}') | ForEach-Object { $_.Value } | Sort-Object -Unique
$known= Get-ChildItem '.rea-analysis/findings-*.md' | ForEach-Object {
          [regex]::Matches((Get-Content -Raw -Encoding UTF8 $_), 'ev_[0-9a-f]{64}') } |
        ForEach-Object { $_.Value } | Sort-Object -Unique
Compare-Object $used $known | Where-Object SideIndicator -eq '<='   # 断链项

# B 制：逐条核验某个类文件的行号是否越界
$lines = Get-Content -LiteralPath '.rea-analysis/v1035/decoded/smali/ׅ/u61.smali' -Encoding UTF8
$lines[433]   # 期望：const v9, 0x7f160014
```

> **体检报告实测结论**（2026-11-17，本次复核仍成立）：
> A 制 138 个 ID 中 **136 命中、2 条断链**（已在 §7 修好）；
> B 制 331 条行号引用 **0 失效、0 越界**。

---

## 3. 版本域 → 路径映射（**最容易踩的坑**）

```
文档写 .rea-analysis/decoded/…      → build-1025（res / assets / lib / classes.dex，无 smali）
文档写 .rea-analysis/smali/smali/…  → build-1025 的 smali 缓存
文档写 .rea-analysis/v1035/decoded/…→ build-1035（含 smali / smali_classes2）
```

**同一篇文档里出现两类路径 = 作者在做跨版对照**，不是笔误。全仓共 5 篇属此类
（`audio-settings-structure` / `list-options` / `queue-view` / `lockscreen-preference-tree` /
`lockscreen-runtime`），逐篇都已在正文交代口径。

---

## 4. 四套混淆命名体系

同一个类在不同产物里有**不同名字**，因为它们来自四次不同的反编译。**名字不可跨版本检索。**

| 体系 | 形态 | 例 | 出现在 |
| --- | --- | --- | --- |
| **1025-smali** | 保留原类名 + 混淆短名 | `rest/library/e4`、`m3`、`a0`、`d4` | `.rea-analysis/smali/` |
| **1035-smali** | 单字符/双字符类名，集中在 `ׅ/` | `ׅ/u61`、`ׅ/z61`、`ׅ/vr`、`ׅ/sa1` | `.rea-analysis/v1035/decoded/smali/ׅ/` |
| **JADX 名** | 带 `moNNNN` 桥接方法名、`C0742` 类名 | `e4.mo2437`、`C0742.f3413` | A 制文档正文与 `findings-*.md` |
| **原始名** | 未混淆的 SDK/库类 | `androidx.appcompat.widget.f` | 两版都有 |

### 4.1 命名规律（1035 侧，可直接用来猜类名）

```
a61  b71  c91  d41  e01  e91    ← 基础设施 / 工厂类
a01  …  z01                      ← 数据层
h80  g80  t4                     ← LockScreenHelper / Window.Callback 包装 / Handler
u61  n91  z61  p91  ba1  ga1     ← Fragment 分发表 / 页面基类 / 通用分派器 / 各页 helper
vr   wr   y40   ms   ls   a30    ← 偏好存储四层（FastStaticPrefs）
```

### 4.2 JADX 名 ↔ smali 名 **不是**一一对应文档化过的

唯一已确认的映射对：

| JADX 名 | smali 名（1025） | 说明 |
| --- | --- | --- |
| `e4.mo2437` / `e3.mo2437` | `e4.с()` / `e3.с()` | `mo2437` 是 JADX 生成的**桥接方法名**，smali 里**不存在** |

> **检索 `mo2437` 两版产物均为零命中**——这是命名体系差异，不是文档写错。
> 遇到 `moNNNN` 时，请按**语义**去 smali 里找等价方法（如"返回 int 限额的那个无参方法"）。

---

## 5. 反例实证：为什么"按名字找"必失败

以设置页分发表常量 `0x7f160014`（= `general.xml` 的页面 id）为例：

| 检索目标 | build-1025 | build-1035 |
| --- | --- | --- |
| 含 `0x7f160014` 的 smali 文件 | **0 命中** | **3 命中**（`ׅ/u61.smali:434`、`:1616`、`Application.smali:2652`） |
| 文件 `u61.smali` | **不存在** | 存在（3088 个 `ׅ/*.smali` 之一） |
| 文件 `vr.smali` / `z61.smali` / `n91.smali` / `sa1.smali` | 均**不存在** | 均存在 |

**结论**：引用 `ׅ/u61` 的文档**只能**在 `.rea-analysis/v1035/decoded/` 下复验。
拿 build-1025 的产物去找，得到的是"文件不存在"这个**假故障**，而不是"结论有误"。

---

## 6. 元数据约定（`status` / `revision` / `open_items`）

本节是对 `docs/decisions/2026-07-09-document-metadata-standard.md` 在本语料内的具体化。

### 6.1 `status` 重新定义为三分

原 `draft` / `active` 与完成度**完全不相关**（17 份 `draft` 里有 2081 行的 `misc-complete`
和 2415 行的 `settings-export-import`）。现改为：

| 值 | 判据（可机器判定） | 典型 |
| --- | --- | --- |
| `complete` | 正文自述**全部未解项已闭环**（`open_items: 0`） | `settings-search`（7/7 闭环） |
| `superseded` | 正文顶部**自述已被同分支后续文档取代**、"仅供参考对照" | `about-and-support-settings`、`lockscreen-settings`、`headset-settings`、`headset-subtree`、`headset-full-implementation`、`misc-settings` |
| `active` | 其余（当前权威版本，仍有开放项） | 其余 37 份 |

### 6.2 新增两个字段

| 字段 | 类型 | 定义 |
| --- | --- | --- |
| `revision` | int | 正文自述的**深挖轮次**（无"第 N 轮"表述则为 `1`）。表示调查投入，**不表示完成度** |
| `open_items` | int | 正文终态表里**仍未闭合**的条目数。`0` 表示作者主张已闭环；**不表示结论必然正确** |

> `open_items` 的口径：只数文档自己列出的"仍未解/仍开放/仍未能闭合"条目，
> **已标注 ✅ / ~~删除线~~ 的不计**。它是**作者自述值**，本次修订即按各文终态表逐篇核对录入。
>
> **本次修订中 `revision` / `open_items` 未回填的 5 篇**（正文无单一终态表，无法机器求值）：
> `album-art-picker` / `row-popup-cover` / `lockscreen-branch-overview` /
> `lockscreen-residual-closure` / `about-branch-overview`。
> 这 5 篇有多张分节终态表，条目口径不一。**不给数字好过给一个错的数字**——
> 需要精确值时请逐节阅读，不要依赖 front matter。

### 6.3 读法示例

| 组合 | 含义 |
| --- | --- |
| `complete` + `open_items: 0` | 作者主张调查结束 |
| `active` + `revision: 6` + `open_items: 3` | 已深挖 6 轮，仍有 3 项未解 |
| `active` + `revision: 1` + `open_items: 16` | 单轮扫描，缺口大，**引用时需谨慎** |
| `superseded` | 不要再引用其结论，改引取代它的文档 |

---

## 7. 本次修订记录（2026-11-18）

针对体检报告 §6 的处置项：

| 处置项 | 状态 | 落点 |
| --- | --- | --- |
| P1 两套引证制度无说明 | ✅ **已修** | 本文 §2 |
| P1 `recents-views` §13 两条 `ev_` 断链 | ✅ **已修** | 该文 §13 改为 smali 指针 + 括注"JADX 名" |
| P1 命名体系无说明 | ✅ **已修** | 本文 §4 / §5 |
| P2 17 份 `draft` 状态失真 | ✅ **已修** | 44 篇 front matter 重标 + 新增 `revision` / `open_items`（§6） |
| P2 `.rea-analysis/` 默认不入库 | ⚠️ **已在本文说明** | §8 |
| P3 字节数 = CRLF→LF 归一化长度 | ✅ **已说明** | §9 |

## 8. 产物可得性（体检报告 P2 项的交代）

`.gitignore` 对 `.rea-analysis/` 采取白名单策略：**只放行 `*.md` 与 69 个关键
`res/xml` + `strings.xml`**（`git ls-files .rea-analysis | wc -l` = 69）。
smali、`v1035/`、`natives/`、`tools/` 全部**不入库**。

⇒ **B 制引证（`路径:行号`）在本机可复验，克隆仓库后不可直接复验**，需按下式重新解包：

```powershell
apktool d --no-src -f -o .rea-analysis/decoded .rea-analysis/Poweramp-v3.apk
# build-1035 需 base.apk + split_config.arm64_v8a.apk 两个 bundle 分片
```

这**不是证据缺失**，是仓库体积取舍。A 制（`ev_`）不受影响——记录体在 `findings-*.md` 里已入库。

## 9. 计数口径（体检报告 P3 项的交代）

结论文档中出现的**字节数**统一为：**把 CRLF 归一化为 LF 后的长度**，
即 `磁盘字节数 − 行数`。实测 **build-1035** 的 7 个媒体库 XML 全部精确吻合：`library*.xml` 磁盘 **25673 B** − **140** 行 = **25533 B**，与
`poweramp-library-full-implementation.md` 记载一致（key 92 / 元素 113 亦全部吻合）。

> **注意**：同一批文件在 **build-1025** 下是 **25667 B**（`library.xml` 少 6 B：5388 vs 5394），
> 归一化后 **25527 B**。**拿错版本比对就会得出「文档写错了」的假结论**——这正是本节的用途。
> 该文属 `version_scope: project` 的 16 篇之一，其统计实际取的是 build-1035 产物。

引用这些字节数做比对时请用同一口径，否则会得到"文档写错"的假结论。

---

## 10. 语料全景（44 篇的定位索引）

| 线 | 覆盖 |
| --- | --- |
| **A 线：设置树** | 根页 → 共享运行时 → 偏好存储引擎 → 11 个分支（音频/外观/可视化/背景/专辑封面/媒体库/耳机/锁屏/其他/关于/导出导入/搜索/付费） |
| **B 线：媒体库视图与运行时** | 实体 / 分类 / 派生列表 / 书签 / 流 / 队列 / 搜索 / 音频输出链路 |

两线的接口：**设置树改行为参数，B 线描述这些参数如何影响实际数据流**。
完整文档地图见 `poweramp-settings-root-structure.md` §8。
