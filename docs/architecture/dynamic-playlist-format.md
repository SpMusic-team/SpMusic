---
doc_id: "ARCH-DYNAMIC-PLAYLIST-FORMAT"
title: "动态播放列表的持久化格式设计（SpMusic 自定）"
doc_type: "architecture-design"
status: "draft"
owner_agent: "Architecture Agent"
version_scope: "design"
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "docs/architecture/search-grammar-gap-analysis.md"
  - "docs/architecture/foobar2000-foobaka-phase-4-findings.md"
  - "docs/architecture/foobar2000-library-mechanisms.md"
---

# 动态播放列表的持久化格式设计

> **为什么必须自定格式**：第 3/4 轮已确证，foobar2000 的动态列表
> **过滤条件不持久化在 profile 的任何 SQLite 里**（`props` 只有 136 B 的
> 客户端+排序定义，`config.sqlite` 五张表全部 dump 过，无一条含查询串）。
> 所以**没有可照抄的磁盘布局**——SpMusic 必须自己设计。

## 零、现有实现的事实

`src-tauri/src/library_playlists.rs`（80,267 B）：

```rust
const REGISTRY_FILE: &str = "library-playlists.v1.json";
const REGISTRY_VERSION: u8 = 1;

struct StoredPlaylists { version: u8, playlists: Vec<StoredPlaylist> }
struct StoredPlaylist {
    source_kind: StoredSourceKind,   // 目前只有 M3u8
    source_path: String,
    source_name: String,
    directory_path: String,
    directory_name: String,
    library_added_at_ms: Option<u64>,
    tracks: Vec<StoredTrack>,        // 静态成员快照
}
struct StoredTrack { source_path: String, title: Option<String> }
```

**关键约束**：该文件里 `deny_unknown_fields` 出现 **5 次**（`StoredPlaylists`、`StoredPlaylist`、
`StoredTrack` 以及另外两个输入结构）。这意味着新增字段必须同时升版本号，
否则旧版本读取新文件会直接失败。

这意味着**新增任何字段都必须同时升版本号**，否则旧版本读取新文件会直接失败。

这一点很重要——它既是安全保障（拒绝未知数据），也是升级成本（不能无痛加字段）。

## 一、设计目标

| # | 目标 |
| ---: | --- |
| 1 | 动态列表存**查询定义**，不存成员快照 |
| 2 | 静态列表格式**完全不变**，老文件可直接读 |
| 3 | 动态列表可「转静态」取快照，语义明确 |
| 4 | 求值失败时可诊断，不静默返空 |
| 5 | 未知字段被拒绝而非忽略（与现有风格一致） |

## 二、格式设计

### 2.1 版本升级策略

```rust
const REGISTRY_VERSION: u8 = 2;   // v1 -> v2
```

**向后兼容规则**：

| 场景 | 行为 |
| --- | --- |
| v1 文件被 v2 代码读取 | 照常读，`kind` 缺省视为 `static` |
| v2 文件被 v1 代码读取 | **拒绝并给出明确错误**（`deny_unknown_fields` 生效） |
| v2 文件被 v2 读取 | 正常 |

> 这是**单向兼容**：升级安全，降级不安全。必须接受——因为 `deny_unknown_fields`
> 是现有设计选择，改成忽略未知字段会削弱校验。

### 2.2 用 `kind` 判别，不新增并行字段

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredPlaylist {
    #[serde(default)]
    kind: StoredPlaylistKind,        // 新增；缺省 = Static
    source_kind: StoredSourceKind,
    source_path: String,
    source_name: String,
    directory_path: String,
    directory_name: String,
    library_added_at_ms: Option<u64>,
    tracks: Vec<StoredTrack>,        // 动态列表下为空数组
    #[serde(default, skip_serializing_if = "Option::is_none")]
    query: Option<StoredQuery>,      // 仅动态列表有值
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
enum StoredPlaylistKind {
    #[default]
    Static,
    Dynamic,
}
```

**为什么用 `Option<StoredQuery>` 而不是 enum 内嵌**：

保持 `StoredPlaylist` 的其它字段在两种 kind 下都能原样读写，
转换（静态↔动态）时只需增删 `query` 与 `tracks`，其余字段不动。

### 2.3 查询定义的结构

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredQuery {
    version: u8,                     // 查询语法版本，当前 1
    expression: String,              // 原始查询串，保真保存
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sort: Option<StoredSort>,
    #[serde(default = "default_limit")]
    limit: Option<u32>,              // None = 不限
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredSort {
    field: String,
    descending: bool,
}
```

**关键决策**：

| 决策 | 理由 |
| --- | --- |
| 存**原始查询串**而非 AST | 可读、可手改、与用户输入一一对应；AST 是派生数据，读时重新解析 |
| 查询语法独立版本号 | 未来收紧语法时，老列表可保留旧语义 |
| `limit` 用 `Option<u32>` | `None` 表不限，避免魔法值（-1 之类） |

## 三、转换语义

### 3.1 静态 → 动态

```
kind: Static -> Dynamic
tracks: [ ... ] -> [ ]          清空快照
query: None -> Some(解析用户输入的表达式)
```

**必须显式确认**：原静态列表的成员顺序会丢失（因为动态列表由查询重算）。
建议 UI 上给出提示，或提供「保存为静态快照」的替代路径。

### 3.2 动态 → 静态

```
kind: Dynamic -> Static
tracks: [ ] -> [ 当前求值结果 ]  冻结快照
query: Some(q) -> None
```

**顺序**：快照必须按当前求值顺序写入（含 `sort` 的效果），否则转静态后顺序会变。

### 3.3 求值时机与失败处理

| 场景 | 行为 |
| --- | --- |
| 启动加载 | **不立即求值**，延后到首次展示 |
| 标签变更 | debounce 后重算受影响列表 |
| 语法错误 | 保留旧结果 + 记录错误，**不能清空列表** |
| 曲库不可用 | 保留上次结果 + 标记 stale |

> **第 3 行是硬要求**：foobar 的实测显示非法语法静默返回 0 结果。
> SpMusic 不应照抄——**保留上一次有效结果并报错**，用户体验更好。
> 这与 `appearanceThemeCodec` 的「fallback + warnings」风格一致。

## 四、与 foobar 的对照

| 维度 | foobar2000 | 本设计 |
| --- | --- | --- |
| 定义存哪 | `props` 的 136 B blob（只含 clientGUID + sort） | **JSON 的 `query` 字段**（含完整表达式） |
| 过滤条件 | **不在磁盘**（实测穷举确认） | **显式持久化** |
| 成员快照 | `.fplite`（BOM + 路径行） | `tracks` 字段（仅静态） |
| 语法错误 | 静默返 0 | **保留旧结果 + 报错** |
| 未知字段 | — | `deny_unknown_fields` 拒绝 |

**本设计在两个地方明显优于 foobar**：过滤条件可持久化（foobar 做不到）、
语法错误有反馈（foobar 静默）。

## 五、迁移与回滚

| 阶段 | 动作 | 回滚方式 |
| --- | --- | --- |
| 升级 | `REGISTRY_VERSION` 1 → 2，写入 `kind` 字段 | 保留 v1 文件副本 |
| 读 v1 | `kind` 缺省为 `Static`，行为不变 | 无需回滚 |
| 写 v2 | 旧代码无法读 | **必须整文件回滚**，不能只删字段 |

> **建议**：首次升级前自动备份为 `library-playlists.v1.json.bak`。
> 因为降级读不了 v2，备份是唯一的回退路径。

## 六、证据边界

| 结论 | 强度 | 依据 |
| --- | --- | --- |
| foobar 不持久化过滤条件 | **强** | 第 4 轮穷举 dump 了 props + config.sqlite 全部表 |
| 现有 SpMusic 结构如上 | **强** | 直接读 `library_playlists.rs:70-102` |
| `deny_unknown_fields` 会导致降级不可读 | **强** | serde 语义 |
| 本设计方案 | **设计建议** | 未经实现与实测 |
## 七、与 SpMusic 现有 codec 风格的一致性

本设计的错误处理方式刻意对齐了 `appearanceThemeCodec` 的既有范式：

| 维度 | appearanceThemeCodec | 本设计 |
| --- | --- | --- |
| 解析失败 | 返回 `safeFallback` + `error` | 保留上次结果 + 错误 |
| 未知键 | `reportUnknownKeys` 收集 warning | `deny_unknown_fields` 拒绝 |
| 抛异常 | **0 处** | 不应新增 |

> **一处刻意不同**：appearance 对未知键是「收集 warning 不拒绝」，
> 而 playlists 是「`deny_unknown_fields` 直接拒绝」。
> 这是两个模块的既有差异，**本设计不改动它**——
> 主题是用户可能手改的展示配置（宽容更好），
> 歌单是程序独占的数据文件（严格更好）。

