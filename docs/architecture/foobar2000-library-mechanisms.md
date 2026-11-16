---
doc_id: "ARCH-FOOBAR2000-LIBRARY-MECHANISMS"
title: "foobar2000 曲库持久化、增量核对、离线宽限与迁移机制（实测）"
doc_type: "architecture-research"
status: "draft"
owner_agent: "Architecture Agent"
version_scope: "research"
created: "2026-11-15"
updated: "2026-11-15"
source_documents:
  - "docs/tasks/foobar2000-foobaka-ds-phase-2-plan.md"
  - "docs/architecture/foobar2000-foobaka-phase-2-findings.md"
  - ".rea-analysis/phase2/run-20261115-p2a/workstream-library/REPORT.md"
  - ".rea-analysis/phase2/run-20261115-p2a/workstream-ui/raw/METADB-SCHEMA-EVIDENCE.md"
---

# foobar2000 曲库机制实测

本文对应 phase-2 计划点名的**第二条逆向主线**：「研究曲库断线、增量、迁移和恢复」。

方法：主程序内嵌 SQL 字面量 + MSVC 修饰名 + Win32 导入表 + 对 `metadb.sqlite` 的只读快照分析。**未运行任何 foobar2000 程序。**
全部数字来自本机样本；`foobaka-lab` 下的 `metadb.sqlite` 分析前后 SHA-256 一致（`4D26D786…48B3F6`），未被修改。

## 零、四个正面回答

先给结论，后面给证据。

| 问 | 答 |
| --- | --- |
| 重启时怎么判断哪些文件变了？ | **`size` + `mtime` 二元组**，不是内容哈希 |
| 改一首歌会重读整库吗？ | **不会**，单曲是最小重读单位 |
| 目录不可达会立刻删条目吗？ | **不会**——按 SQL 语义与某份快照的 `retention`（折算 28 天）推断有宽限期，**运行行为未实测** |
| 有换盘重定位能力吗？ | **没有** |

## 一、持久化形态：三层，职责切得很干净

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 元数据权威库 | `profile\metadb.sqlite` | 曲目身份 + 标签缓存 + 统计 |
| 目录树快照 | `profile\library-v2.0\<16HEX>\content.sqlite` | watcher 的目录状态 |
| 组件索引 | `profile\index-data\<GUID>` | 各插件自己的索引 |

### 1.1 `metadb` 主表：15 个字段

```sql
CREATE TABLE IF NOT EXISTS metadb (
  name TEXT UNIQUE PRIMARY KEY NOT NULL,   -- 路径，唯一身份
  info BLOB, infoBrowse BLOB,              -- 标签缓存（两级）
  size INTEGER, lastModified INTEGER,      -- 增量判据
  infoBrowseTime INTEGER,
  lastseen INTEGER,                        -- GC 用（本样本全 NULL，见 §三）
  created INTEGER, attribs INTEGER, attribsValid INTEGER,
  playCount INTEGER, dateAdded INTEGER,
  firstPlayed INTEGER, lastPlayed INTEGER, rating INTEGER
)
```

**关键**：`name` 是 `UNIQUE PRIMARY KEY`，即**路径字符串就是身份**。这决定了后面所有的行为（按路径接回、换盘必断）。

### 1.2 `info` BLOB 的内部结构（逐字节解出，1,821 行零失败）

```
[0:8]    f64    时长（秒）
[8:24]   4×f32  ReplayGain 四值（track gain/peak、album gain/peak）
[24:]    重复的 name\0value\0 字段串
```

实测 **68 种字段名**。两个重要观察：

| 观察 | 数据 |
| --- | --- |
| **标签不摘要，存全文** | `LYRICS` 实测存到 **8,938 B**；`comment` 达 **12,738 B** |
| ReplayGain 四值实测全是占位 | `-1000` / `-1`（表示"无数据"而非真值） |

### 1.3 关键字段的实测状态

| 字段 | 存在 | 说明 |
| --- | --- | --- |
| 路径 | ✅ | `metadb.name` UNIQUE PK，**唯一身份** |
| 大小 | ✅ | `size` |
| 修改时间 | ✅ | `lastModified`（FILETIME） |
| 标签摘要 | ✅ | `info` 全文 |
| 时长 | ✅ | `info[0:8]` |
| 创建时间 | ✅ | `created` |
| 属性位 | ✅ | `attribs` / `attribsValid` |
| **内容哈希** | ❌ | 主表**没有**（哈希在索引层，见 §四） |
| `lastseen` | 列存在 | 但本样本 **1,822 行全 NULL** |
| `playCount`/`rating`/`dateAdded`/`firstPlayed`/`lastPlayed` | 列存在 | 本样本**全部 NULL**（该库从未播放过） |

> `playCount` 等 5 列存在但为空，说明**主程序内建了这些字段但本样本没产生数据**。这修正了「播放统计由组件提供」的说法——主表结构里就有。

## 二、增量核对：`size` + `mtime`，单曲是最小单位

### 2.1 判据

```sql
SELECT info, infoBrowse, size, lastModified, infoBrowseTime, created, attribs, attribsValid
  FROM metadb WHERE name = ?;

UPDATE metadb
   SET info = ?2, size = ?3, lastModified = ?4, created = ?5, attribs = ?6, attribsValid = ?7
 WHERE name = ?1;
```

扫描时先 `stat` 拿大小与时间，与库里比对：
- 都相同 → 用缓存 `info`，**不进解码器**
- 任一不同 → 重读该文件，`UPDATE` 覆盖

**是 OR 关系**：size 变了必然重读；只有 mtime 变也重读。存在 mtime-only 的快速路径（未变则跳过）。

### 2.2 用到的 Win32 API（本机复现验证）

| API | 2.24.6 | 2.25.11 | 2.26.2 | 2.26.3 |
| --- | :---: | :---: | :---: | :---: |
| `GetFileAttributesExW` | ✓ | ✓ | ✓ | ✓ |
| `GetFileAttributesW` | ✓ | ✓ | ✓ | ✓ |
| `GetFileTime` | ✓ | ✓ | ✓ | ✓ |
| `GetFileInformationByHandle` | ✓ | ✓ | ✓ | ✓ |
| `GetFileSizeEx` | ✓ | ✓ | ✓ | ✓ |
| `FindFirstFileW` / `FindNextFileW` / `FindClose` | ✓ | ✓ | ✓ | ✓ |
| `CreateFileW` | ✓ | ✓ | ✓ | ✓ |
| `ReadDirectoryChangesW` | ✓ | ✓ | ✓ | ✓ |
| **`FindFirstFileExW`** | **未引用** | 未引用 | 未引用 | 未引用 |
| **`GetFileInformationByHandleEx`** | **未引用** | 未引用 | 未引用 | 未引用 |

**这是从 API 层反证「身份 = 路径字符串」**：没有用 `FILE_ID_INFO` 一类的方式做文件系统级身份比对，四版本一致。

### 2.3 单曲级别是最小重读单位

三条证据：
1. `UPDATE metadb SET info=?2… WHERE name=?1` 是**单行更新**
2. 有 `Pending` / `Reading tags...` 的**逐条状态机**
3. 有 `File is taking a long time to process` 的**单文件告警**

### 2.4 运行中变更：`ReadDirectoryChangesW` + 三级降级

| 级 | 名称 |
| --- | --- |
| 1 | `watch loop`（文件系统通知） |
| 2 | `fallback loop`（降级轮询） |
| 3 | `single pass`（单次扫描） |

失败路径提示：`Folder monitoring not available for this resource`。

## 三、离线宽限：某份快照中的 `retention` 折算为 28 天

> **第三轮勘误（2026-11-17）**：本节初版把 28 天写成「已确认的产品行为」。实际只做到：**某份 `metadb_indexes` 快照里四条 `retention` 值折算为 28 天**，外加相关 SQL 字符串。**生产环境实际的清理时机与适用条件未实测**，需按 §十 的复跑卡验证。
>
> 具体收窄：「28 天内完全无损」「第 29 天自动清理」「按路径恢复」都是**从 SQL 与单份快照推出的语义**，不是运行观测。

### 3.1 `retention` 字段与实测值

```sql
CREATE TABLE IF NOT EXISTS metadb_indexes (
  name TEXT UNIQUE PRIMARY KEY NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  retention INTEGER NOT NULL DEFAULT 0
);
```

本机 `metadb.sqlite` 实测（**已独立复算**）：

| 索引 GUID | synced | retention（ticks） | 换算 |
| --- | ---: | ---: | --- |
| `C653739F-14B3-4EF2-819B-A3E2883230AE` | 1 | 24,192,000,000,000 | **28.0000 天** |
| `B2D78CA3-C718-4088-9733-61C1CD0A6CEB` | 1 | 24,192,000,000,000 | **28.0000 天** |
| `E58A4298-065E-469B-B5D6-199106E283DD` | 1 | 24,192,000,000,000 | **28.0000 天** |
| `BF7490F5-D59D-49D0-B69A-8F81809CEF48` | 1 | 24,192,000,000,000 | **28.0000 天** |
| `EF148A2E-3368-4516-99AA-2E65E57D5B28` | 1 | −1 | 负数（异常哨兵） |
| `4209C12E-C2F4-40CA-B2BC-FB61C32687D0` | 1 | −1,550,778,368 | 负数（异常哨兵） |

`24,192,000,000,000 ticks ÷ 10^7 ÷ 86,400 = 28.0000 天`（Windows FILETIME 单位 100ns）。

两个负值由这条 SQL 兜底：

```sql
UPDATE metadb_indexes SET retention = 0 WHERE retention < 0
```

### 3.2 GC 是 mark & sweep

```sql
-- 临时表：本批次见到的条目
CREATE TABLE temp.gc_present_items (rowid INTEGER PRIMARY KEY)

-- 1) 只给本次枚举到的行打戳
UPDATE metadb SET lastseen = ? WHERE rowid IN (SELECT rowid FROM temp.gc_present_items);

-- 2) 删掉超期的
DELETE FROM metadb WHERE lastseen < ?;

-- 3) 从未打过戳的补上
UPDATE metadb SET lastseen = ? WHERE lastseen IS NULL;
```

### 3.3 删除阈值 = `now − MAX(retention)`，不是「本批次」

```sql
SELECT MAX(retention) FROM metadb_indexes
```

这条 SQL 的存在**直接证明**删除阈值来自索引表的 `MAX(retention)`，而不是「本次扫描没见到就删」。

**这两个解释的区别决定了整个行为**：

| 错误理解 | 正确理解 |
| --- | --- |
| 「本批次没见到 → 删」 | 「`lastseen < now − 28 天` → 删」 |
| 拔一次移动硬盘就清空 | **拔盘 28 天内完全无损** |

### 3.4 状态机

```
目录可达         → 枚举到 → 更新 lastseen = now
目录不可达/离线  → 未枚举 → lastseen 保持旧值（不更新、不删除）
                       ↓
              距 lastseen 未满 28 天 → 条目保留（仍可搜索/显示）
              距 lastseen 超过 28 天 → 下一轮 GC 删除
目录恢复         → 按路径字符串命中同一 name 主键 → 直接复用缓存
```

**恢复是按路径接回，不是按大小/时间配对**——因为 size/mtime 是**失效判据**不是**身份判据**。

### 3.5 运行期实测（第三轮补充）：短时间离线根本不进入删除逻辑

第三轮在 A′ 2.24.6 上做了「同路径目录改名 → 离线启动 → 同路径改回」实验：

| 阶段 | `metadb` 记录数 | `lastseen` 非空数 | 界面表现 |
| --- | ---: | ---: | --- |
| 离线前 | 20 | **0** | 正常 |
| 离线中（启动后） | **20** | **0** | 20 条照常显示，**无任何离线标记** |
| 恢复后 | **20** | **0** | 20 条接回，时长正常，播放无错 |

**离线期间点击播放**会弹出 `Playback error`，逐项列：

```
Unable to open item for playback (Object not found):
"D:\SpMusic\.rea-analysis\phase3\fixtures\q1test\03_Third Rock.flac"
```

**三条被运行证实的结论**：

1. **不删条目**——离线一轮扫描后 `metadb` 仍是 20 条。
2. **不写 `lastseen`**——始终 NULL。这说明删除逻辑**至少在这一轮根本没被触发**。
3. **错误在交互层显式呈现**——`Object not found` + 完整路径，不是笼统的「打不开」。

**同时这修正了本文 §3.3 的一处过度概括**：原文把「不判删」归因于 28 天宽限。
实测表明**短时间离线压根不进入删除路径**，宽限期是否是 28 天**仍未验证**。

### 3.6 三个反直觉的事实

**（1）没有「离线条目」这个 UI 概念。**
全程序扫描 `offline` 只命中 `SMB2_STATUS_FILE_IS_OFFLINE`（SMB 状态码表）。foobar2000 分两层处理：

| 层 | 行为 |
| --- | --- |
| 数据层 | **不标记离线**，靠 28 天宽限自动过期 |
| 交互层 | 现场 `stat` 失败 + 用户主动跑 `Scanning for dead items...` / `Remove dead items` |

**（2）`lastseen` 是「预留但未启用」的列。**
DDL 里有、GC 的 SQL 全套存在，但本样本 1,822 行**全 NULL**。说明要么该库从未跑过完整 GC，要么打戳是惰性的。

**（3）IO 错误分类极细，且区分「暂时」与「不存在」。**

| 字符串 | 语义 |
| --- | --- |
| `Drive not found` | 盘符不存在 |
| `Device not ready` | 设备未就绪（如光驱空） |
| `Disc not available` | 光盘不在 |
| `Network path not found` | 网络路径不可达 |
| `Drive locked by BitLocker` | 被加密锁定 |

**这五种都是「暂时」而非「永久失效」，对应的是保留而不是删除。** 这个分类粒度值得 SpMusic 直接借鉴。

### 3.7 dead items 是显式功能

| 偏移 | 字符串 |
| --- | --- |
| `0x290BDC` | `Scanning for dead items...` |
| `0x2912F4` | `Remove dead items` |
| `0x291310` | `Removes dead items from the list.` |
| `0x2A4724` | `Dead item: ` |

**失效判定交给用户决策**，不是静默删除，且逐项记日志。

## 四、迁移与恢复

### 4.1 `foo_fileops.dll` 能做四个操作，预览是一等公民

| 能力 | 证据 |
| --- | --- |
| Copy / Move / Rename / Link（硬链接） | 组件功能 |
| **独立预览对话框** | `File Operation Preview` |
| 预览三列 | `Operation` \| `Source` \| `Destination` |
| 空操作提示 | `Preview - nothing to do, destination matches source` |
| 预设可导入导出 | `FileOps-Presets.txt`（文本 INI） |
| 预设键 | `operation` / `targetDirectory` / `fileNamePattern` / `moveOtherFiles` / `removeEmpty` / `overwrite` |
| 预设层级 | `group|preset` |
| 文件名模式 | Title Format |

### 4.2 关键：fileops **不更新引用**

实测该 DLL 里**没有任何** metadb / library / playlist 标识符。引用更新在**核心**：`metadb_handle_impl::set_path` + `on_changed_sorted` / `triggerCallbacks`。

**这是一个干净的分层**：文件操作组件只负责搬文件，身份更新由核心做。

### 4.3 `foo_playcount` 的匹配键是 64bit 哈希，不是路径

```sql
metadb_index_C653739F(key INTEGER, filename TEXT PRIMARY KEY)   -- key = 64bit 哈希
metadb_index_C653739F_data(key, value BLOB)                      -- value 恒 40 B
```

40 B 载荷的逐字节熵实测：

| 区间 | 内容 |
| --- | --- |
| `[24:32]` | FILETIME（≈ `dateAdded`） |
| `[32:36]` | 恒 `FF FF FF FF`（−1 哨兵） |
| 其余 28 B | 恒 0（本样本未播放未评分） |

核心层另有 `handles_by_hash(GUID, _K)` / `handles_by_hashes(GUID, list<_K>)`，**哈希是核心的一等索引键**。

> **待确认的关键点**：`C653739F` 这个 64bit 哈希的**算法未知**。若它是**路径哈希**，那么"文件移动后播放统计丢失"就是必然而非偶然；若是内容哈希，则有机会跟随。这一条已列入复跑卡。

### 4.4 换盘重定位：**没有这个能力**

全程序 + fileops 搜索 `relocate` / `remap` / `rebase` 无命中。

**为什么没有**：因为主键是路径字符串。换盘后路径变了，主键就对不上；而索引层的哈希虽然存在，但**没有把哈希反查结果回写为新路径**的机制。

### 4.5 重复引用：全局唯一 `name`

`metadb.name`、18 个索引的 `filename`、`media.name` **全是 UNIQUE PK**。

所以**同一个文件在多个歌单里出现时，元数据只有一条记录**。歌单只存引用（v2 格式：UTF-8 BOM + 每行一个 `file://…` 的纯文本 fplite + 独立 `-props.sqlite`）。

### 4.6 索引孤儿：metadb 删了，索引不级联删

实测 6 个索引各 7 行 orphan（`_cue_test` / `_lyrics_test` / `_seam_chirp`）。

**metadb 删条目时不级联删索引数据**，各索引按自己的 `retention` 单独过期。配套有 `erase_orphaned_data` / `have_orphaned_data` 两个接口。

## 五、版本演进：2.26 做过一次曲库层重构

| 项 | 2.24.6 | 2.26.3 |
| --- | --- | --- |
| `library-index.sqlite` | **存在** | **消失** |
| `metadb` 表 `partial` 列 | 无 | **新增**（元数据"部分读出"标记） |
| `LargeFieldsConfig-v2.txt` | 无 | **有** |

说明 2.24.6 → 2.26 之间曲库持久化层被重构过。

## 六、`LargeFieldsConfig` 两代，语义不同

任务卡指的是**第二代**（`LargeFieldsConfig-v2.txt`，2.26.3 才有）。但**第一代 `LargeFieldsConfig.txt` 就在 B 根目录**（1,132 B），且语义比 v2 明确：

```
basicMetaMax=2000      # 基本字段大小上限
defaultMetaMax=1000    # 未出现于任一列表的字段上限
infoMax=200           # 技术信息字段上限
fieldBasic=…（18 项）  # 基本元字段
fieldSpam=…（12 项）   # 非常用元字段，"不被缓存"
```

**实测反直觉**：文件里把 `lyrics` 列进了 `fieldSpam`（"不被缓存"），但实测 `LYRICS` 存到了 **8,938 B**，而 `infoMax` 只有 200。

**所以第一代机制不是硬截断**，而是「低优先级 / 可丢弃」。`fieldSpam` 的真实语义需要动态验证。

**第二代 v2** 在二进制里只剩文件名 + 一行官网 URL 注释、**无解析日志**，静态分析到此为止——需要靠复跑卡实测。

## 七、本机实测到的一个编码陷阱

B 的 `library-error-log.txt`（90 B）实测是 **UTF-8 无 BOM**、Tab 分三列：

```
file://…\t原因\tFILETIME
```

**按 GBK 解会乱码**（如 `涓嶆敮鎸佺殑…`）。这与「B 的多数日志是 GBK」的提示**相反**——至少这份日志必须按 UTF-8 读。

**教训**：不能对整个样本套用单一编码假设，要逐文件嗅探。

## 八、证据强度

| 结论 | 强度 | 依据 |
| --- | --- | --- |
| `metadb` 15 字段 schema | **强** | 完整 DDL 字面量 |
| 增量判据 = `size` + `mtime` | **强** | SQL 字面量 + API 导入 |
| 无 `FindFirstFileExW` / `GetFileInformationByHandleEx` | **强** | 四版本导入表复现 |
| 单曲是最小重读单位 | **强** | 单行 UPDATE + 逐条状态机 |
| **28 天宽限** | **强** | `retention` 实测 4 处 24,192,000,000,000 ticks |
| 删除阈值来自 `MAX(retention)` | **强** | `SELECT MAX(retention)` 字面量 |
| 恢复按路径不按大小/时间 | **强** | 主键是 `name` |
| 无换盘重定位 | **强** | 全程序无 `relocate`/`remap` 命中 |
| fileops 不更新引用 | **强** | 该 DLL 无 metadb/library 标识符 |
| 索引不级联删 | **强** | orphan 实测 |
| `lastseen` 实际写入时机 | **未知** | 本库全 NULL |
| `C653739F` 哈希算法 | **未知** | 影响"移动后统计是否跟随" |
| `LargeFieldsConfig` v1/v2 真实边界 | **未知** | 需动态验证 |
| 28 天宽限的**运行时**验证 | **未做** | 需外部机器（复跑卡 E2-b） |

## 九、对 SpMusic 的直接含义

SpMusic 的现状见 [SpMusic 曲库基线核查](#) 与
`.rea-analysis/phase2/run-20261115-p2a/workstream-library/REPORT.md` §5。

三条最值得做的（按性价比）：

| # | 项 | 理由 |
| ---: | --- | --- |
| 1 | `duration_cache` 落盘 | 判据已与 foobar2000 同构（`len` + `modified`），成本极低，省掉启动全部时长探测 |
| 2 | `available` 换成真实 `fs::metadata().is_ok()` | 前端已在用该字段做置灰，后端却硬编码 `true` |
| 3 | 加 `library-entries.v1.json` 记 `firstMissingAt`，N 天后才移除 | 这是 foobar2000 **28 天宽限的最小实现** |

**一条必须先修的静默缺陷**：子目录 `read_dir` 失败只 `tracing::warn` + `continue`，导致**子树掉线 = 静默少歌，用户零提示**。这正好对应 foobar2000 那五种细粒度 IO 错误分类要解决的问题。

## 十、复跑卡（外部机器）

本机无法运行 foobar2000，以下实验需在能运行的机器上做。完整步骤见
`.rea-analysis/phase2/run-20261115-p2a/workstream-library/REPORT.md` §6。

| 卡 | 目标 | 关键观察 |
| --- | --- | --- |
| **E1** 增量 | 验证 `size+mtime` 判据与单曲重读 | S3 只改 size 不改 mtime；S4 只改 mtime 不改 size；S6 直接删文件 |
| **E2** 离线 | 验证 28 天宽限与按路径接回 | 用 **VHD 挂/卸**模拟整盘消失 |
| **E2-b** 加速 | 直接验 GC 阈值 | 退出后把 `lastseen` 设为 `now−29 天` 再启动 |
| **E3** 恢复 | 验证引用更新与统计跟随 | 用 fileops Rename/Move 后查 `metadb_index_C653739F.filename` |
| **E3-b** | 确证 `LargeFieldsConfig-v2` 边界 | 改配置后重建库，对比 `info` 实际字节 |
| **E4** | 2.24.6 ↔ 2.26.3 迁移 | 验 `partial` 列、`library-index.sqlite` 消失 |

FILETIME 换算：`(unix + 11644473600) × 10^7`。

## 十一、合规

本文只记录功能级结论、证据位置与验收方法：

- 不附第三方实现代码
- 不传播二进制、安装包、配置文件
- `metadb.sqlite` 分析用只读副本（`mode=ro&immutable=1`），源文件 SHA-256 前后一致
- 未运行任何 foobar2000 程序
- 原始证据在 `.rea-analysis/phase2/run-20261115-p2a/workstream-library/`（已 gitignore）
