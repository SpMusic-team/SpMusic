---
doc_id: "TASK-FOOBAR2000-FOOBAKA-PHASE-2-CANDIDATES"
title: "foobar2000 与 foobaka 第二轮研究：候选实施卡与排序建议"
doc_type: "task"
status: "draft"
owner_agent: "PM Agent"
version_scope: "研究与产品评估"
created: "2026-11-15"
updated: "2026-11-15"
source_documents:
  - "docs/architecture/foobar2000-foobaka-phase-2-findings.md"
  - "docs/test/foobar2000-foobaka-phase-2-comparison.md"
  - "docs/tasks/foobar2000-foobaka-ds-phase-2-plan.md"
  - "c20ff0c:docs/architecture/foobaka-findings-backlog.md"
---

# 第二轮候选实施卡

本轮**不产出产品代码**。本文只把研究结论整理成可独立评审的候选卡，供后续排期。

## 零、与首轮 15 项候选的关系

首轮（`c20ff0c`）的 15 项候选状态维持不变，但其中 3 项因本轮实测需要**重新核定**：

| 首轮项 | 首轮状态 | 本轮新增依据 | 建议 |
| --- | --- | --- | --- |
| **P1-D** 重采样 | 已测量待决策 | **2.26 把 SSRC/RetroArch 整体换成 ARDFTSRC/Speex**，是官方"换血"而非叠加；且 `SoXR` 在官方构建中根本不存在 | 参考对象应从「SoXR」改为「ARDFTSRC/Speex 的质量档思路」 |
| **P2-D** 布尔查询 | 拆两步 | 2.26 新增 `ALL` 特殊关键字，说明官方也在扩展查询语法 | 第一步可参考 `ALL` 的极简设计 |
| **P1-C** 封面分层 | 已核查补齐 | 本轮未新增实测（界面仍受阻） | 维持现状 |

**新增候选 4 项**（下表 P2-A ~ P2-D），全部来自本轮新实测。

## 一、候选优先级总览

| 编号 | 候选 | 证据强度 | 成本 | 依赖 | 建议 |
| --- | --- | --- | --- | --- | --- |
| **P2-A** | 配置/快照加载路径的可证明性 | **强** | 低 | 无 | **推荐优先** |
| **P2-B** | 错误提示的失败阶段分离 | **强** | 中 | 无 | 推荐 |
| **P2-C** | 二进制差异的改动量判据 | **强** | 低（工具） | 无 | 推荐（研究侧） |
| **P2-D** | 主题系统的配色先行层 | 中 | 中 | 无 | 有条件推荐 |
| **P2-E** | `available` 接真值 + 离线宽限 | **强** | **低** | 无 | **推荐优先**（新增） |
| **P2-F** | 时长缓存落盘 | **强** | **低** | 无 | **推荐优先**（新增） |
| **P2-G** | 子目录读取失败不再静默 | **强** | 低 | 无 | **推荐**（新增） |
| **P2-H** | 查询语法最小文法 | **强** | **高** | P2-J | 有条件推荐（新增） |
| **P2-I** | 联动筛选（facet） | **强** | 中高 | P2-H | 有条件推荐（新增） |
| **P2-J** | 统计字段接入曲目模型 | **强** | 中 | 无 | **P2-H 的前置**（新增） |
| **P2-K** | 动态列表 | **强** | **高** | P2-H + P2-J | 最后做（新增） |
| — | 重采样质量档位（P1-D 修订） | 强 | 高 | 决策 | 保持待决策 |
| — | 三方对比基线纪律（流程） | 强 | 低 | 无 | 建议纳入流程 |

> 新增的 P2-E ~ P2-K 全部来自本轮新完成的**两条逆向主线**：
> [曲库机制](../architecture/foobar2000-library-mechanisms.md) 与
> [检索机制](../architecture/foobar2000-search-mechanisms.md)。

## 一之二、本轮对首轮的两处成本修正

| 项 | 首轮估计 | 本轮实测 | 影响 |
| --- | --- | --- | --- |
| 「最近未播放」类查询条件 | 需**新增持久化层**（首轮说 `playCount`/`lastPlayed` 都缺） | **两者都已存在**（`mostPlayed.ts` 的 `spmusic.most-played.v1`），缺的是**接线** | 成本从「中高」降到「中」，可省一层数据采集 |
| 增量新索引 | 「需新增」 | 判据 `len` + `modified` **已与 foobar2000 同构**（`duration_cache.rs` 的 `SourceIdentity`） | 只差「缓存内容从时长扩到标签摘要」+ 落盘 |

---

## P2-A｜配置与快照的加载路径可证明性

### 现状与问题

本轮发现 foobaka 有**三处"文件存在但不生效"**的实例：

| 实例 | 现象 | 实测依据 |
| --- | --- | --- |
| `theme.fth` 两份 | 根目录 1,398 B 完整配置**未被使用**，实际加载 `profile\theme.fth` 的 546 B 版本 | 两份文件都已解析；DUI 默认文件名是 `theme.fth`，便携模式 profile 优先 |
| `LargeFieldsConfig.txt` | 1,132 B 精心定制，但内核 2.24.6 **根本没有该标识符** | 全样本字符串扫描：2.24.6 与 B 均为 0 命中，只有 2.26.x 有 |
| `version.txt` | 内容是 `foobar2000 v1.6.10`，实际内核 2.24.6 | 运行期模块版本 2.24.6 与服务端日志一致 |

三项的共同点：**文件确实存在、内容自洽、但不影响运行**。

### SpMusic 当前基线

需要核查的点（本轮未做代码核查，仅列出方向）：

- `src/features/persistence/snapshotIdentity.ts`（若已合入）的 provenance 判定
- 启动时读取的配置文件路径解析：是否存在「多个候选路径」且无日志确认实际选了哪个
- 快照的 `appVersion` / `schemaVersion` / `contentDigest` 三字段是否都有实际生效路径

### 最小实施方向

1. **为每个配置/快照读取点记录"实际加载路径"**，并通过启动诊断暴露。
2. **当存在多个候选路径时**，明确优先级并记录"被跳过的候选 + 跳过原因"。
3. **当机制标识符不存在时**（对应 `LargeFieldsConfig` 案例），在读文件之前先判断该能力是否可用，不可用则不读、并给出一条诊断。

### 替代方案

| 方案 | 权衡 |
| --- | --- |
| 只加日志不改进 | 成本最低，但用户仍无法判断 |
| 启动时严格校验并拒绝启动 | 过重，会把「陈旧文件」变成「无法使用」 |
| **（推荐）记录 + 诊断提示，不阻断** | 与首轮 P0-A 的 `DependencySeverity::Optional` 一致 |

### 验收

| 检查 | 通过条件 |
| --- | --- |
| 存在两份同名配置 | 诊断明确指出「实际加载哪一份、跳过哪一份」 |
| 机制不可用时存在对应配置文件 | 不读取、不报错、诊断说明原因 |
| 快照版本不匹配 | 走既有 provenance 分支，不静默使用 |

### 回滚

诊断是纯增量输出，回滚只需移除提示路径。**不改变既有读取语义**。

### 角色

Rust/Tauri（读取点）+ Architecture（诊断契约）+ Test（三场景验证）。

---

## P2-B｜错误提示的失败阶段分离

### 现状与问题

foobaka 的 WSH 面板把至少**四种不同失败**混在相近的提示里：

| 失败路径 | 显示文案 | 资源 ID |
| --- | --- | --- |
| 脚本引擎初始化失败 | `脚本引擎初始化失败` | 10058 |
| 脚本执行失败（`SCRIPT_E_RECORDED`） | `控制台可查看更多信息(脚本错误的原因).` | 10059 |
| 上次运行严重错误 | `拒绝载入上次运行发生严重错误的脚本…` | 10063 |
| 渲染完全失败 | `O.o，脚本有错误哦！:(` | 10064 |

首轮把「界面归零只显示 `O.o`」归因于「缺 COM」，本轮证明**这至少是两条独立路径**，首轮把现象合并了。

### 与本仓库的对应

首轮已实施的 **P0-C 解码失败分级**（`AudioFailureStage` 5 阶段 + 3 个新错误码）是同一原则在音频层的落地。本候选要问的是：**其他层是否也有"统一文案掩盖真实阶段"的情况**。

### 最小实施方向

1. 盘点现有错误提示中**同一文案覆盖多阶段**的位置（音频之外的：文件访问、持久化、原生调用、启动依赖）。
2. 对每一处，判断是否值得拆分阶段；**不必全部拆**，只拆"用户看到同样提示但修复动作不同"的。
3. 与 P0-C 保持同一模式：阶段枚举 + 可选字段 + 前端可展开详情。

### 替代方案

| 方案 | 权衡 |
| --- | --- |
| 全部拆到最细 | 过度设计，维护成本高 |
| **（推荐）只拆"修复动作不同"的** | 判据明确：用户下一步该做什么 |
| 只在诊断面板聚合 | 成本低，但用户仍看不到即时反馈 |

### 验收

| 检查 | 通过条件 |
| --- | --- |
| 至少一处「同文案多阶段」被拆分 | 两个阶段给不同的下一步动作 |
| 阶段信息可被前端读取 | 类型层有对应字段 |
| 既有错误码不破坏 | 向后兼容 |

### 回滚

阶段为可选字段，缺失时退化为原文案。**不破坏既有契约**。

### 角色

Rust/Tauri（阶段定义）+ Frontend（展示）+ Test（多阶段触发验证）。

---

## P2-C｜二进制差异的改动量判据（工具侧）

### 问题

本轮最重要的方法论产出：**字节差异数不能直接当改动量**，且有量化反证：

| 对比 | 绝对对齐差异 | 滚动哈希匹配率 | 字节直方图 L1 | 真实改动量 |
| --- | ---: | ---: | ---: | --- |
| `foo_ui_std.dll` A′ vs B | 523 B（0.044%） | **99.94%** | 0.0365% | 局部极小 |
| 官方 2.26.2→2.26.3 `.text` | 2,698,740 B（**92.35%**） | **74.49%** | 1.830% | 重布局补丁 |
| 官方 2.25.11→2.26.2 `.text` | 2,663,673 B（97.01%） | **42.17%** | 3.332% | 内容改动最大 |

**只用一个指标会得出完全相反的结论。**

### 适用场景

SpMusic 自身可能用到：构建产物对比、回归基线比对、依赖升级影响评估、缓存/快照格式变更检测。

### 最小实施方向

提供一个小工具（脚本级，非产品代码），输入两个二进制/目录，输出**三个指标**：

1. 逐字节差异数与差异段数
2. 16 字节滚动哈希覆盖率
3. 字节直方图 L1 散度

### 验收

| 检查 | 通过条件 |
| --- | --- |
| 对三个已知样本复现上表数字 | 误差 < 0.1% |
| 对完全相同的文件 | 差异 0、覆盖 100%、L1 = 0% |
| 输出可机器读取 | JSON |

### 回滚

独立工具，不进产品路径，无回滚概念。

### 角色

Test（工具实现）+ Rust/Tauri（如果后续要产品化）。

> **注**：本轮已产出可用实现参考（`.rea-analysis/.../workstream-b/scripts/component_similarity.py`），可作为原型。

---

## P2-D｜主题系统的配色先行层

### 现状与问题

首轮从 `.fth` 推出「配色与布局可彻底分离」的建议，但当时依据只是体积对比（140 B vs 800 B）。本轮**从格式设计本身证实了这条**：

| 证据 | 内容 |
| --- | --- |
| 记录类型完全独立 | COLORS（`598CEE8C`）与 LAYOUT（`16691D51`）是**两个不同 GUID 的自包含记录**，各自有独立的正文 |
| 官方分布 | 32 个官方主题中 **19 个只含颜色记录**（140–160 B），**13 个只含布局记录**（260–797 B） |
| 无一混合 | 官方主题**没有任何一个同时含两类记录** |

这与首轮「140–800 B 全是纯配色」的描述不同，但**结论方向更强**：官方自己就把配色和布局做成了互斥的两类主题。

### 对 SpMusic 的含义

若引入主题系统，**先做只含配色的轻量层**是被上游格式设计支持的渐进路径，而不是妥协。

### 最小实施方向

1. 定义纯配色主题的最小字段集（参考 COLORS 记录：颜色项 GUID + BGRA）。
2. **不涉及布局**：面板结构仍由代码决定。
3. 提供内置若干配色预设（对应官方 19 个纯配色主题的做法）。

### 替代方案

| 方案 | 权衡 |
| --- | --- |
| 一步做完整主题（配色 + 布局） | 复杂度高，本轮未解出 `.fth` 布局正文结构 |
| 引入脚本化外观 | 首轮 P3-B 已明确「不建议」 |
| **（推荐）只做配色层** | 格式设计支持，可独立验收 |

### 验收

| 检查 | 通过条件 |
| --- | --- |
| 切换配色不改布局 | 面板尺寸/位置完全不变 |
| 配置可序列化/反序列化 | 往返一致 |
| 新增配色不破坏既有 | 默认配色仍可用 |

### 回滚

配色层可完全关闭，退回默认色。

### 角色

UI/UX（配色语义）+ Frontend（实现）+ Architecture（配置契约）。

### 前置

需要先做一次**SpMusic 当前主题能力盘点**（本轮未做）。

---

## P2-E｜`available` 接真值 + 离线宽限

### 现状与问题（已独立复现）

**（1）`available` 在扫描路径硬编码 `true`**

`src-tauri/src/audio/playlist.rs:112` 与 `:299`：

```rust
available: true,
```

同文件 `:652` 的 `folder_track_ref(path, available)` **是接受 `available` 参数的**，`:653` 也会在真值时去 `fs::metadata`。所以**函数支持真实状态，但两个调用点传了常量**。

**前端 `AlbumLibraryPanel` 已经在用这个字段做置灰/跳过** → 该字段恒真，离线曲目永不置灰。

**（2）子目录读取失败静默**

扫描循环内三处同样的模式：

```rust
Err(error) => {
    tracing::warn!(path = %directory.display(), %error, "skipping unreadable library subdirectory");
    continue;
}
```

`read_dir` 打开失败、遍历条目失败、`symlink_metadata` 失败、`canonicalize` 失败——**全部只进日志**。

**后果：整个子目录读不到时，这一子树的所有曲目直接消失，用户零提示。**

**（3）没有离线宽限**

foobar2000 实测有 **28.0000 天**宽限（`metadb_indexes.retention = 24,192,000,000,000` ticks），SpMusic 没有对应机制。

### foobar2000 的做法（可直接借鉴）

| 层 | 机制 |
| --- | --- |
| 数据层 | `lastseen` + mark & sweep GC，删除阈值 = `now − MAX(retention)` |
| IO 错误分类 | `Drive not found` / `Device not ready` / `Disc not available` / `Network path not found` / `Drive locked by BitLocker` —— **五种都算"暂时"** |
| 交互层 | `Scanning for dead items...` / `Remove dead items` / `Dead item: `（**失效判定交用户决策**） |

### 最小实施方向

1. `available` 改为真实 `fs::metadata(path).is_ok()`（改两个调用点）。
2. 子目录失败**分类**并**上报**：区分「暂时不可达」与「确定不存在」，前者保留、后者可标记。
3. 加一份 `library-entries.v1.json` 记 `firstMissingAt`，超过 N 天才移除——**这是 28 天宽限的最小实现**。

### 验收

| 检查 | 通过条件 |
| --- | --- |
| 拔出移动硬盘 | 曲目仍在列表，但置灰 |
| 子目录权限被拒 | 用户能看到「N 个目录不可读」的提示 |
| 超过宽限期 | 条目才被移除 |

### 回滚

`available` 是既有字段，回滚只需改回常量。宽限机制是新增配置文件，删掉即回到现状。

### ⚠ 必须同批修复的耦合缺陷

`useAudioPlayer.ts:4361`：

```ts
if (… || !target?.available) { clearPlaybackSession(); return }
```

**这条目前不会触发（因为 `available` 恒真）。一旦修好 `available`，它就会把"单曲离线"放大成"整个播放会话清空"。**

**修 P2-E 时必须同时改这条逻辑**，否则引入回归。

### 角色

Rust/Tauri（扫描与状态）+ Frontend（提示与置灰）+ Test（拔盘/权限/超期三场景）。

---

## P2-F｜时长缓存落盘

### 现状

`src-tauri/src/audio/duration_cache.rs` 的判据设计**已经与 foobar2000 同构**：

```rust
pub(crate) struct SourceIdentity {
    pub len: u64,
    pub modified_nanos: i128,
}
```

边界处理甚至比 foobar2000 更显式（5 个 `IdentityIssue` 变体：`StatFailed` / `EmptyFile` / `ModifiedUnavailable` / `BeforeEpoch` / `OutOfRange`）。其中 `EmptyFile` 拒绝缓存 0 字节文件的理由（避免冻结正在拷贝的文件）值得保留。

**问题是 `DurationCache` 是纯内存结构**（`Inner` + `Mutex`），**没有任何落盘路径**。`app_paths.rs` 里只有 4 个 json 文件，没有标签/时长快照。

### 影响

每次重启都要重新探测全部曲目时长。

### 最小实施方向

把 `DurationCache` 的 `(path → {len, modified_nanos, duration})` 序列化落盘，启动时按 `SourceIdentity` 校验后复用。

缓存上限已有（`MAX_ENTRIES = 20_000`、`MAX_PATH_BYTES = 8 MiB`），落盘沿用同一预算即可。

### 验收

| 检查 | 通过条件 |
| --- | --- |
| 冷启动→重启 | 时长直接命中，不进解码器 |
| 改一个文件 | 只有该文件重新探测 |
| 缓存损坏 | 丢弃重建，不崩溃 |

### 回滚

落盘是纯增量；删掉缓存文件即回到现状。

### 角色

Rust/Tauri。

---

## P2-G｜子目录读取失败不再静默

> 与 P2-E 第 2 点重叠。此处单独立卡是因为它**可以独立于 `available` 先修**。

### 现状

三处 `tracing::warn` + `continue`（见 P2-E）。

### 最小实施方向

1. 把扫描期的失败收集成一个 `Vec<ScanIssue>`。
2. 扫描结束后汇总，通过既有诊断通道上报（首轮 P0-A 的 `StartupDiagnostics` 模式可复用）。
3. **不阻断扫描**，只让用户知道「少了多少、因为什么」。

### 验收

| 检查 | 通过条件 |
| --- | --- |
| 子目录权限被拒 | 提示可见，且说明原因 |
| 网络共享断线 | 提示区分「暂时不可达」与「不存在」 |
| 全部正常 | 不产生任何提示 |

### 回滚

纯增量输出。

### 角色

Rust/Tauri + Frontend（展示）+ Test。

---

## P2-J｜统计字段接入曲目模型

> **这是 P2-H（查询语法）的前置**，也是本轮对首轮成本判断的主要修正点。

### 现状

| 数据 | 位置 | 是否进 `AllSongsItem` |
| --- | --- | --- |
| `rating` | `spmusic.track-ratings.v1`，键 `trackId` | ✗ |
| `playCount` + `lastPlayedAt` | `spmusic.most-played.v1`（`mostPlayed.ts`） | ✗ |
| 最近播放 | `spmusic.recently-played.v1` | ✗ |

`AllSongsItem` 的 9 个字段里**没有任何统计数据**。

### 为什么必须先做这个

foobar2000 的 `metadb` 表**自带** `playCount`/`rating`/`lastPlayed`/`firstPlayed`/`dateAdded` **5 列**，所以查询语法天然能访问。

SpMusic 把统计放在**独立的 localStorage 键**里，用 `sourcePath` join。即使实现了查询语法，`%playCount%` 这类字段**仍然查不到**。

### 最小实施方向

1. 在构建 `AllSongsItem` 时 join 一次 `mostPlayed` / `recentlyPlayed` / `trackRatings`，把统计作为**可选只读字段**挂上去。
2. **不改变存储形态**（仍用现有 3 个 localStorage 键），只做读取侧合并。
3. 明确 join 的匹配键：`normalizeAudioSourcePath`（与现有 `mostPlayed` 的键一致）。

### 验收

| 检查 | 通过条件 |
| --- | --- |
| 播放过的曲目 | `AllSongsItem` 上能读到 `playCount` 与 `lastPlayedAt` |
| 未播放过的曲目 | 字段为 undefined，不伪造 0 |
| 文件移动后 | 统计按既有语义断开关联（与现状一致，不引入新问题） |

### 回滚

只读 join，去掉即回到现状。

### 角色

Frontend + Architecture（字段契约）+ Test。

---

## P2-H｜查询语法最小文法

### 现状

`librarySearch.ts` 核心两行：

```ts
const needle = query.trim().toLocaleLowerCase()
const matches = (...text) => text.some(v => String(v ?? '').toLowerCase().includes(needle))
```

**无词分割、无变音折叠、无通配、无布尔、无比较、无字段限定。**

### foobar2000 的 5 条硬约束（必须遵守）

| # | 约束 |
| ---: | --- |
| 1 | `<field>` 含 `#$%` → titleformat 通道；否则 metadata 通道 |
| 2 | **`IS` 必须在单值层比较**，多值逐值、不拼接 |
| 3 | `SORT BY` 必须在查询末尾 |
| 4 | 关键字全大写，值不区分大小写 |
| 5 | `* HAS` 复用简单搜索语义（含文件名与路径） |

**第 2 条最容易做错**，也是「合作艺人出现在多个分类、结果只出现一次」的根本保证。

### 最小文法（对齐实测分发表）

```
query := expr (SORT [ASC|DESC]ENDING BY pattern)?
expr  := term ((AND|OR) term)* | NOT expr | '(' expr ')'
term  := field (IS|HAS) str | '*' HAS str
       | field (GREATER|LESS|EQUAL) number
       | field (MISSING|PRESENT)
       | time (BEFORE|AFTER|SINCE|DURING) time
       | time DURING LAST number UNIT
       | ALL | NONE
```

> `ALL` 与 `NONE` 在 foobar2000 **2.24.6 就已实现**（分发表 `0x27BE0C` / `0x27BE18`），不是 2.26 新能力。

### 实施建议：先做第一步

**第一步只做「已有字段的布尔组合 + 数值比较」**：
`genre IS 摇滚 AND year GREATER 2020 AND rating GREATER 3`

暂不做：时间比较（依赖 `firstPlayed`/`dateAdded`，SpMusic 缺）、`SORT BY`、通配。

### 验收

| 检查 | 通过条件 |
| --- | --- |
| 12–20 条真值表 | 全部准确命中 |
| 多值艺人 | `artist IS name1` 命中双艺人曲目 |
| 改一条标签 | 结果立即更新 |
| 非法语法 | 有明确错误，不静默返回空 |

### 回滚

新语法作为可选入口；旧 `includes()` 路径保留。回滚只需关闭新入口。

### 前置

**P2-J（统计字段接入）**。没有它，「rating GREATER 3」写不出来。

### 角色

Architecture（文法契约）+ Frontend（解析与求值）+ Test（真值表）。

---

## P2-I｜联动筛选（facet）

### 现状

SpMusic 的 10 个搜索分类是**互相独立的平铺分类**，没有逐层收窄。

### foobar2000 的做法（ReFacets，官方 DUI）

三层结构：

| 层 | 职责 |
| --- | --- |
| `reFacetsBase` | metadb 4 回调 + `grabTracks` 求值 + `makeVals` 生成取值行 + `splitValsAL` 多值拆分 |
| `reFacetsInstance` | 面板容器（`setup_rebar` / `clearPanes` / `reloadSel`） |
| `ap_refacets` | 与动态列表的桥（`criteriaChanged`） |

联动状态 14 个键：`match` / `column` / `descending` / `ascending` / `sortColumn` / `filter` / `userFilter` / `facet` / `statsColumn` / `columnsOrder` / `source` / `search` / `toolbarLocked` / `multiFilters`。

**多值拆分语法是 `%<field>%`**（未文档化的内部约定），实测用于 `%<genre>%` / `%<album artist>%`；`Artist` 刻意不加尖括号。

**「合作艺人多分类出现、结果只一次」是三层语义叠加**，不是去重算法：
1. `%<artist>%` 逐值展开
2. `IS` 单值层比较
3. 结果是集合，天然去重

### 好消息：SpMusic 已有等价实现

`splitArtists()` + `artistEntries()` + `uniqueArtistSongs()` 的三层组合，**结果语义已等价**。差异只在拆分词表与去重时机。

### 最小实施方向

1. 把现有 10 个平铺分类改造成**可叠加的 facet**（选中一个维度后，其余维度显示命中数）。
2. 复用现有 `splitArtists` / `genreLibrary` 的拆分逻辑，不改拆分词表。
3. 持久化 facet 状态（可参考 14 个键，但**不必全抄**）。

### 验收

| 检查 | 通过条件 |
| --- | --- |
| 流派→艺人收窄 | 点流派后剩余艺人只显示该流派下的 |
| 合作艺人 | 出现在多个艺人类别下，但结果列表只出现一次 |
| 返回 | 保留上级条件 |

### 前置

P2-H（需要结构化查询支撑叠加条件）。

### 角色

Architecture + Frontend + UI/UX + Test。

---

## P2-K｜动态列表

### 现状：整层缺失

`AudioFolderPlaylist`（`src-tauri/src/audio/types.rs:287-303`）只有 `tracks: Vec<AudioFolderTrackRef>` 静态数组。仓库全局 grep `autoplaylist|smartPlaylist|playlistQuery|dynamicPlaylist` → **0 命中**。

### foobar2000 是四件套

| 件 | 实现 |
| --- | --- |
| 条件模型 | `autoplaylist_client` 服务 + `clientData` blob |
| 求值层 | `autoplaylist_instance_impl` + 独立 `autoplaylist worker` 线程 + `delay_action` debounce |
| 锁定/所有权 | 4 个异常类（`not_owned` / `already_owned` / `lock_failure` / 基类） |
| 持久化恢复 | `props.sqlite` 的 `props(key, data BLOB)` + `Could not restore autoplaylist` 路径 |

**存条件不存结果**：
- `playlist-<GUID>-props.sqlite` 存**定义**
- `playlist-<GUID>.fplite` 存**求值后的快照**（缓存，可重建）

### 为什么成本高

`CreateAutoPlaylist` 三行 API 之所以极简，是因为**底层有这四件**。SpMusic 一件都没有。

而且要接受**异步语义**：列表内容会异步到达，不能同步算完再渲染。这与现有静态列表模型是结构性差异。

### 最小实施方向（若要做）

1. 动态列表存 `{id, name, query, clientKind, clientData, cachedTracks}`。
2. 求值走**独立 worker + debounce**，不阻塞 UI。
3. 列表项标 `isDynamic`，UI 据此禁用编辑。
4. 「转静态」= 求值一次取快照（对应 `DuplicatePlaylist` 语义）。
5. 迁移：现有静态列表格式不动。

### 验收

| 检查 | 通过条件 |
| --- | --- |
| 曲库新增 | 动态列表自动包含新歌 |
| 冻结列表 | 不受影响 |
| 两者互转 | 可转换且顺序保留 |
| 重启 | 定义恢复，结果重算 |

### 前置

**P2-H + P2-J**（规则依赖查询模型与统计字段）。

### 角色

Architecture + Rust/Tauri + Frontend + Test。

---

## 二、流程建议：三方对比基线纪律

本条不是代码候选，是研究/验证流程的纪律，建议写入后续任务的验收要求。

### 问题

首轮有**三次**因为缺基线而误判：

| 误判 | 真相 | 教训 |
| --- | --- | --- |
| 「官方组件必有签名，foobaka 剥离了」 | 官方 2.24.6 本来就没签名，2.25+ 才引入 | 没有同版基线，版本特征会被当成改版特征 |
| 「foobaka 的 LargeFieldsConfig 生效」 | 该机制 2.26 才有 | 同上 |
| 「foo_input_std +565 KB」 | 拿 x64 比 x86 了 | 架构也必须同 |

### 建议纪律

任何「A 与 B 有差异」的结论，**必须同时具备**：

1. **同版本**同架构基线（排除版本差异）
2. **同架构**基线（排除架构差异）
3. **差异可归因到具体机制**（不留「大概是某处改了」）

本轮 1,424 B（主程序）+ 1,377 B（组件）+ 33,729 B（`.rdata`）全部给出了类目分解，这个粒度应作为后续同类分析的最低要求。

### 一个反例警示

首轮用「`.text` VirtualSize 完全一致」作为「核心未改」的主证据。**这个证据很弱**——VSize 相同只说明长度相同，不说明内容相同。

本轮改用**逐字节差分 + 滚动哈希 + 直方图三重校验**才真正坐实。后续凡涉及「有没有改」的判断，应直接给三重指标，不要用结构尺寸代替。

---

## 三、明确不做

| 项 | 理由 |
| --- | --- |
| 复刻 `.fth` 的 LAYOUT 格式 | 本轮未解出正文结构，且布局能力已由现有前端实现承载 |
| 复刻 `.fcl` 面板布局系统 | 同上，且 Columns UI 是第三方，不属官方能力 |
| 复刻 WSH/ActiveScript 脚本宿主 | 首轮 P3-B 已定「不建议」；且本轮证实其存在 UAF 缺陷 |
| 按 `MEM_WRITE\|MEM_EXECUTE` 段属性做安全判定 | 该属性异常但内容全是字符串；**判定力不足**，不构成安全结论 |
| 依据 `.movehcs` 存在推断"隐藏代码" | 常规汉化工具做法；本轮无任何代码写入证据 |
| 把官方 2.26 的重采样器"档位"直接搬过来 | ARDFTSRC/Speex 是第三方实现，不附源码 |

## 四、需要补证才能实施的项

| 项 | 缺什么 | 怎么补 |
| --- | --- | --- |
| P2-A | SpMusic 侧配置读取点盘点 | 代码核查 |
| P2-B | 现有「同文案多阶段」的具体位置 | 代码核查 + 错误码盘点 |
| P2-D | SpMusic 当前主题能力盘点 | 代码核查 |
| P1-D 重采样 | 责任层决策 + 听感验证 | 架构决策 + 回环录音 |
| 界面类全局（首达/回访/头图） | 输入注入能力 | 真实桌面或操作卡 |

## 五、证据索引

| 结论 | 文档位置 |
| --- | --- |
| 五处首轮修正、汉化定量、`.fth`/`.fcl`、WSH 逆向 | [phase-2 findings](../architecture/foobar2000-foobaka-phase-2-findings.md) |
| 全部测量数据与复跑命令 | [phase-2 comparison](../test/foobar2000-foobaka-phase-2-comparison.md) |
| **曲库持久化 / 增量 / 离线宽限 / 迁移** | [library mechanisms](../architecture/foobar2000-library-mechanisms.md) |
| **检索语法 / 联动筛选 / 动态列表** | [search mechanisms](../architecture/foobar2000-search-mechanisms.md) |
| 首轮 15 项候选原始论证 | `c20ff0c:docs/architecture/foobaka-findings-backlog.md` |
| 原始二进制数据 | `.rea-analysis/phase2/run-20261115-p2a/` |

### 5.1 本轮新增候选的证据落点

| 候选 | 主要证据 |
| --- | --- |
| P2-E `available` + 离线宽限 | `src-tauri/src/audio/playlist.rs:112,299`（硬编码）；`library-mechanisms` §3（28 天） |
| P2-F 时长缓存落盘 | `src-tauri/src/audio/duration_cache.rs`（`SourceIdentity` 同构，纯内存） |
| P2-G 子目录静默失败 | `playlist.rs` 扫描循环三处 `warn + continue` |
| P2-J 统计字段接入 | `mostPlayed.ts` / `recentlyPlayed.ts`（数据已有）；`AllSongsItem` 9 字段无统计 |
| P2-H 查询语法 | `librarySearch.ts`（两行 `includes()`）；`search-mechanisms` §二/§三 |
| P2-I 联动筛选 | `search-mechanisms` §五（ReFacets 三层 + `%<field>%`） |
| P2-K 动态列表 | `search-mechanisms` §六（四件套）；`types.rs:287-303`（静态数组） |

## 六、合规

本文只记录功能级结论、证据位置与验收方法；不附第三方实现代码，不传播二进制、安装包或配置文件。

## 七、本轮未能实证的关键缺口

以下不是「没时间做」，而是**当前环境无法确证**，已在建议中避开强依赖：

| 缺口 | 影响 | 怎么补 |
| --- | --- | --- |
| `retention` 28 天的**运行时**行为 | P2-E 的宽限值参考 | 外部机器复跑卡 E2-b（把 `lastseen` 设为 `now−29 天`） |
| `autoplaylist` 条件 blob 的编码 | P2-K 的客户端数据格式 | 需动态观察或反汇编 |
| `LargeFieldsConfig` v1/v2 真实边界 | P2-F 的字段分层 | 复跑卡 E3-b |
| 播放统计 64bit 哈希算法 | 「文件移动后统计是否跟随」 | 复跑卡 E3-S5 |
| `%<field>%` 精确语义 | P2-I 的多值拆分实现 | 需指令级反汇编 |
| Columns UI Filter 级联链路 | 仅参考，不计入官方能力 | 需反汇编（第三方优先级低） |
