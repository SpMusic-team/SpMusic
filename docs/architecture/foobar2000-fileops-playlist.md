---
doc_id: "ARCH-FOOBAR-FILEOPS-PLAYLIST"
title: "foobar2000 文件操作与播放列表格式"
doc_type: "architecture-research"
status: "draft"
owner_agent: "Architecture Agent"
version_scope: "research"
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "docs/architecture/foobar2000-library-mechanisms.md"
---

# foobar2000 文件操作与播放列表格式

> 本文从 library-mechanisms 拆出，覆盖「按标签整理文件」与「播放列表存储」两块。
## 一、File Operations 预设格式

第 2 轮只做到「`foo_fileops.dll` 有 Copy/Move/Rename/Link 能力，且不更新引用」的字符串级观察。
本轮解出了**预设文件的完整格式**。

### 1.1 格式：INI 风格纯文本

| 项 | 值 |
| --- | --- |
| 预设文件 | `FileOps-Presets.txt` / `FileOps-Presets-Rename.txt` |
| 节标记 | `[preset]` |
| 文件类型过滤器 | `Text files|*.txt` |
| 支持导入/导出 | 是（`Imports/Exports File Operations preset list from a text file.`） |

**8 个键（按二进制里的排列顺序）**：

```
[preset]
name=按专辑整理
operation=Move
targetDirectory=D:\Music\%album artist%\%album%
fileNamePattern=[%discnumber%.]%tracknumber%. %title%
moveOtherFiles=1
removeEmpty=1
showOutput=1
overwrite=0
```

**`operation` 的取值是动词**，不是数字：

| 值 | 含义 |
| --- | --- |
| `Copy` | 复制 |
| `Move` | 移动 |
| `Rename` | 重命名 |
| `Link` | 链接 |

### 1.2 可用的模板占位符

从 `foo_fileops.dll` 的字符串表直接读出这 9 个：

```
%artist%  %album%  %album artist%  %date%  %tracknumber%
%discnumber%  %title%  %track artist%  %filename%
```

**默认模板**（说明官方推荐的命名风格）：

```
%tracknumber%. 
[%discnumber%.]%tracknumber%. 
$num(%discnumber%,1)%tracknumber%. 
```

即：**碟号可选（方括号），轨号必填，两位对齐**。

### 1.3 与「改名后引用是否跟随」的关系

这是 P2 §2.3 遗留的问题。结合第 2 轮的静态结论可以给出**有条件的答案**：

| 层 | 行为 | 证据 |
| --- | --- | --- |
| `foo_fileops.dll` 本身 | **不做**引用更新 | 该 DLL 不含任何 metadb/library/playlist 标识符 |
| 内核 | 通过 `metadb_handle_impl::set_path` + `on_changed_sorted` 触发回调 | 字符串证据 |
| 播放列表文件 | ⚠ **仍未实测** | 需人工执行一次改名 |

> **诚实标注**：格式已解开，但「改名后 `.fplite` 是否同步」**仍需实机验证**。
> 已写入 [操作者移交卡](foobar2000-gui-operator-handoff.md) 的任务 C。

### 1.4 对 SpMusic 的含义

若 SpMusic 要支持「按标签整理文件」，**这个 INI 格式值得直接采用**：

| 对比 | INI（foobar 方案） | JSON |
| --- | --- | --- |
| 用户手改 | 容易 | 需要懂语法 |
| 模板可读性 | 高（`name=值` 一行一条） | 低（引号+逗号） |
| 导入导出 | 天然支持 | 需额外做 |
| 嵌套结构 | 弱 | 强 |

预设本身是**扁平的键值对**，没有嵌套需求 —— 所以 INI 更合适。

### 2.5 `.fpl` 的尾部区：之前遗漏的 26.6%（第 34 轮修正）

> **⚠ 修正第 20 轮**：当时说「`.fpl` 结构已解出」——**不完整**。
> 本轮发现元数据块之后还有 **468 字节（26.6%）** 之前完全没注意到。

**完整布局**：

| 区 | 范围 | 大小 | 内容 |
| --- | --- | ---: | --- |
| 头部 | `0x00`–`0x3C` | 60 B | magic + GUID + 曲目数 + 块长 |
| **元数据块** | `0x3C`–`0x50E` | **1,234 B** | 路径 + 5 UUID + 19 标签键 + 值 + 技术参数 |
| **尾部区** | `0x50E`–`0x6E2` | **468 B** | **索引偏移表（本轮首次发现）** |

### 尾部区的结构

开头两个 u32：`(1, 145)`——疑为记录数与某项长度。

从 `+80` 起是清晰的 **(索引, 偏移) 对**：

```
  (1,  82)
  (2, 119)
  (3, 156)
  (4, 193)
  (5, 230)
  (6, 236)
  (7, 249)
  ...
```

**索引从 1 连续递增，偏移单调递增** —— 这是**索引偏移表**（用于快速定位记录）。

### 为什么之前会漏

第 20 轮只读到 `0x3C + 1234 = 0x50E` 就认为文件结束，
**没有检查 `0x50E` 之后是否还有内容**。实际文件长 `0x6E2`。

> **方法学教训**：解析二进制结构时，
> **必须核对「已解析长度 == 文件长度」**，否则会漏掉尾部区。
> 这个判据在 `.fth` 解析时用了（精确 EOF 检查），在 `.fpl` 时却漏用了。

### 一个有意思的呼应

尾部区 `+40`–`+56` 出现 `0xC47A0000`（= `-1000.0`）和 `0xBF800000`（= `-1.0`）各两次，
这正是第 2 轮在 `metadb` 里发现的 **ReplayGain 哨兵值组合**。
说明 `.fpl` 也内嵌了 RG 状态（虽为未扫描的哨兵）。

### 样本量限制（无法补强）

全盘搜索确认：**只有 1 个独立 `.fpl` 样本**（2 份副本 SHA-256 相同）。
因此上述结构**无法通过多样本验证是否恒定**。这是本研究的硬限制。

## 二、`.fpl`(v1.4) 与 `.fplite`(v2.0) 的语义差异（第 20 轮新增）

> **样本量限定（必须知道）**：
> - `.fpl`：**只有 1 个独立样本**（`A7D17B3C….fpl`，仓库里另一份是副本）
> - `.fplite`：19 个文件（来自 phase3/phase4 的运行副本）
>
> 因此下文的 **`.fpl` 结构解出**只对**这 1 个样本**成立。
> 字段序列（路径 + UUID + 标签键 + 标签值 + 技术参数）的**存在性**可信，
> 但**字段个数、顺序是否恒定**未经多样本验证。

第 4 轮记录了「B 用 `playlists-v1.4`、A′ 用 `playlists-v2.0`」，但只到结构差异。
本轮把两种格式的**设计哲学差异**解出来了。

### 2.1 `.fpl`（v1.4）：自包含，带完整元数据快照

```
[0x00] 16 B  魔数 003759DB444D564E8034C62ABA89A6B9
[0x10] 16 B  GUID 78E94CAD-3544-4A74-85FF-A7DC9EF77D09（playlist 类标识）
[0x20] u32   0
[0x24] u32   1（曲目数）
[0x28] 16 B  GUID F95941F6-C88B-436E-9D3E-C4678785D649（instance id）
[0x38] u32   1234（元数据块总长度）
[0x3C] 1234 B 元数据块（NUL 分隔的 64 个字段）
```

**元数据块的字段序列**：

| 段 | 内容 |
| --- | --- |
| [0] | `file://` 绝对路径 |
| [1]–[5] | 5 个 UUID（疑似 TOC / 索引 / 校验） |
| [6]–[26] | 标签**键**列表：`ALBUM` `ALBUM ARTIST` `ARTIST` `GENRE` `TITLE` … 共 19 个 |
| [27]–[44] | 标签**值**列表（与键一一对应） |
| [45]– | 技术参数：`bitrate=9232` `bitspersample=24` `channels=2` `codec=FLAC` `samplerate=192000` `encoding=lossless` `md5=…` `tool=reference libFLAC 1.3.0` |

### 2.2 `.fplite`（v2.0）：纯引用，只有路径

```
EF BB BF（BOM）+ 每行一个相对路径
```

**没有任何元数据**。显示时的标签全部来自 `metadb`。

### 2.3 取舍

| 维度 | `.fpl` (v1.4) | `.fplite` (v2.0) |
| --- | --- | --- |
| 单曲体积 | **1762 B** | **42 B** |
| 差额 | — | **约 42 倍** |
| 自包含 | **是**（脱库也能显示） | **否**（需查 metadb） |
| 元数据冗余 | 每份列表各存一份 | 全局唯一 |
| 格式 | 二进制 | 纯文本 |

**foobar 从 v1.4 转向 v2.0 的动机很清楚**：用 42 倍的空间换全局唯一性。
代价是播放列表不再自包含——`metadb` 重建前显示不出标签。

### 2.4 对 SpMusic 的含义

SpMusic 当前的 `library-playlists.v1.json`（`StoredTrack { source_path, title? }`）
**走的是 v2.0 路线**，这个选择是对的：

| 理由 | 说明 |
| --- | --- |
| 避免冗余 | 同一份标签不在多处存 |
| 一致性 | 改标签后所有列表自动一致 |
| 体积 | 大库时差异达数量级 |

> **但要意识到代价**：曲库不可用时，播放列表显示不出标签。
>
> **若需要「离线可读的播放列表」**，建议**另做一个导出格式**（自包含），
> 而不是把主存储格式改回去——两种需求应该用两种格式满足。
