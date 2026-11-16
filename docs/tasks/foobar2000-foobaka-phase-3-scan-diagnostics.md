---
doc_id: "TASK-FOOBAR2000-FOOBAKA-PHASE-3-SCAN-DIAGNOSTICS"
title: "扫描诊断候选实施卡（部分结果可诊断）"
doc_type: "task"
status: "draft"
owner_agent: "PM Agent"
version_scope: "v0.2-candidate"
created: "2026-11-17"
updated: "2026-11-17"
source_documents:
  - "docs/tasks/foobar2000-foobaka-ds-phase-3-plan.md"
  - "docs/architecture/foobar2000-library-mechanisms.md"
  - "docs/test/foobar2000-foobaka-phase-3-comparison.md"
---

# 扫描诊断候选实施卡

计划 §第二轮勘误要求「本轮只出一张 SpMusic 候选实施卡」，起点是「扫描遇不可读目录时跳过并记录警告」这条路径。本文是那张卡。

## 一、当前基线（已独立核实）

### 1.1 起点代码

`src-tauri/src/audio/playlist.rs`，递归扫描函数 `load_recursive_library_playlist`（L158 起）。

核心循环里有**四处**「警告后跳过」：

| 位置 | 失败点 | 当前处理 |
| --- | --- | --- |
| `fs::read_dir(&directory)` | 打开子目录失败 | `tracing::warn!` + `continue` |
| `entries` 迭代 | 读取目录项失败 | `tracing::warn!` + `continue` |
| `fs::symlink_metadata(&path)` | 拿元数据失败 | `tracing::warn!` + `continue` |
| `path.canonicalize()` | 路径解析失败 | `tracing::warn!` + `continue` |

**根目录失败是例外**（语义正确，保留）：

```rust
Err(error) if directory == root => {
    return Err(audio_error(
        AudioErrorCode::UnreadableFile,
        format!("Cannot read library folder: {error}"),
        true,
    ));
}
```

### 1.2 数据结构现状

`AudioFolderPlaylist`（`src-tauri/src/audio/types.rs`）当前字段：

```
directory_path, directory_name,
directory_paths: Option<Vec<String>>,   // 仅「成功枚举的目录」
source_kind, source_path, source_name, selected_index,
tracks: Vec<AudioFolderTrackRef>
```

**没有任何「失败目录」的字段。** `directory_paths` 只记录成功的，所以前端**无法从返回值区分「这个目录本来就没有子目录」与「子目录读失败了」**。

### 1.3 用户可见后果

整个子树读不到时，**该子树下所有曲目静默消失**，UI 不显示任何提示。`tracing::warn` 只进日志文件。

### 1.4 对照 foobar2000（第二轮实测）

| 层 | foobar2000 |
| --- | --- |
| IO 错误分类 | `Drive not found` / `Device not ready` / `Disc not available` / `Network path not found` / `Drive locked by BitLocker` —— **五种都算「暂时」** |
| 交互层 | `Scanning for dead items...` / `Remove dead items` / `Dead item: `（**失效判定交用户决策**） |
| 数据层 | 宽限期后才清理（第二轮从 `retention` 快照推得 28 天，**运行时未实测**） |

**SpMusic 缺的是中间那一层**：既不分类、也不上报、也不给用户决策入口。

## 二、触发条件与可复现性

### 2.1 什么情况下会出现「扫描完成但只得到部分结果」

| 场景 | 是否触发 | 说明 |
| --- | --- | --- |
| 子目录权限被拒 | **是** | `read_dir` 返回 `PermissionDenied` |
| 网络共享部分断连 | **是** | 子树不可达 |
| 移动硬盘上某目录被占用 | 可能 | 取决于错误类型 |
| 目录在扫描过程中被删除 | **是** | `read_dir`/`metadata` 失败 |
| junction/符号链接指向外部 | 否 | 被显式跳过（`is_symlink`/`is_reparse_point`），属设计行为 |

### 2.2 最小复现步骤

1. 建测试根：`T\a\`、`T\b\`、`T\c\`，各放 1–2 个音频文件。
2. 用 `icacls` 移除 `T\b` 的读取权限（当前用户）。
3. 在 SpMusic 里把 `T` 设为曲库根并扫描。
4. **预期（当前行为）**：列表出现 `a`、`c` 的文件，**`b` 完全消失且无任何提示**。
5. 恢复权限后重扫，`b` 的文件重新出现。

> **前置验证**：先确认第 4 步确实「无提示」。若既有 UI 已有此类提示，则本候选的收益要重新评估。

## 三、最小实施方向

### 3.1 目标

把「静默跳过」变成「**跳过但可诊断**」：

1. 保留已成功枚举的条目（**不因部分失败而整体失败**）。
2. 为**本次扫描**汇总：失败目录数、可核实的原因类别、脱敏示例路径。
3. 全成功时不产生任何告警（**零噪声**）。

### 3.2 改动面

| 层 | 改动 |
| --- | --- |
| Rust | `load_recursive_library_playlist` 收集 `Vec<ScanIssue>`；`AudioFolderPlaylist` 增加**可选**字段 |
| Rust | 错误分类：把 `io::ErrorKind` 映射到少量可核实的类别（见 §3.3） |
| 前端 | 读取新字段，在既有诊断通道展示（可复用 startupDiagnostics 的呈现方式） |
| 契约 | `AudioFolderPlaylist` 增加可选字段，需 Architecture 评审 |

### 3.3 建议的原因类别（对齐 foobar2000 的粒度，但不必照抄五种）

| 类别 | 判定 |
| --- | --- |
| `permission-denied` | `ErrorKind::PermissionDenied` |
| `not-found` | `ErrorKind::NotFound` |
| `not-ready` | 设备未就绪（Windows 特定错误码） |
| `io-other` | 其余 |

**不要臆造更细的分类**——foobar2000 那五种是基于 Windows 系统错误码的具体映射，SpMusic 若没有实测过对应错误码，不应凭猜写死。

### 3.4 数据结构建议

```rust
#[serde(skip_serializing_if = "Option::is_none")]
#[ts(optional)]
pub scan_issues: Option<Vec<AudioScanIssue>>,

pub struct AudioScanIssue {
    pub kind: String,          // 上述类别
    pub path_example: String,  // 单个脱敏示例，不列全部
    pub count: u32,            // 该类别共影响多少目录
}
```

**要点**：
- 用**类别 + 计数 + 单个示例**，而不是列出全部失败路径（避免大曲库下返回体膨胀与隐私问题）。
- 字段可选，旧调用方不受影响。

## 四、验收

| # | 检查 | 通过条件 |
| ---: | --- | --- |
| 1 | 全成功扫描 | **零告警**，`scan_issues` 为 `None` 或空 |
| 2 | 单子目录被拒 | 其余目录结果**与全成功时相同**；`scan_issues` 含 1 条 `permission-denied` 且 `count = 1` |
| 3 | 多子目录被拒 | `count` 正确聚合；示例路径只有一个且已脱敏 |
| 4 | 根级失败 | **维持当前错误语义**（返回 `UnreadableFile`，不是告警） |
| 5 | 日志核对 | 同一批次日志与 `scan_issues` 可对应 |
| 6 | 大曲库 | 1000 目录 + 10 失败时，返回体增量 < 1 KB |

## 五、回滚

**只撤汇总输出**：
- 移除 `scan_issues` 字段与前端展示。
- `load_recursive_library_playlist` 的扫描逻辑本身不变（它本来就跳过并继续），所以回滚不改变扫描结果，只去掉诊断。

## 六、实施路径与角色

| 阶段 | 内容 | 角色 |
| ---: | --- | --- |
| 1 | 契约评审（新增可选字段、类别定义） | **Architecture** |
| 2 | Rust 侧收集与分类 | **Rust/Tauri** |
| 3 | 前端展示 | **Frontend** |
| 4 | 独立验收（六个检查项） | **Test** |

**计划允许「首选以已有日志或独立原型验证」**：若 Architecture 判断仅靠改进日志（结构化字段 + 固定前缀）即可满足诊断需求，**可以不做契约变更与前端改动**，成本更低。这种情况下本卡退化为「日志规范化」任务。

## 七、明确不在本卡范围

| 项 | 理由 |
| --- | --- |
| 自动离线保留（宽限期） | 计划明确列为独立后续任务；且 foobar2000 的 28 天运行时行为本轮未实测 |
| 索引持久化 | 同上，独立任务 |
| 统计查询列 | 同上，依赖统计字段接入 |
| `available` 字段接真值 | 属另一条路径（`playlist.rs:112/299`），且**修它必须同批修 `useAudioPlayer.ts` 的会话恢复判断**，见 P2-E |

## 八、立项条件核对

| 条件 | 状态 |
| --- | --- |
| 有当前基线 | ✅ §一（代码位置、四处跳过点、数据结构现状） |
| 有触发条件 | ✅ §二（场景表 + 最小复现步骤） |
| 有验收标准 | ✅ §四（六项） |
| 有回滚方式 | ✅ §五 |
| 可稳定复现「扫描完成但部分结果」 | ⚠ **待验证**：需按 §2.2 实测一次，确认当前确实「无提示」 |

**结论：达到立项条件，但 §2.2 的最小复现必须先跑一次。** 若实测发现既有 UI 已有提示，则本卡收益不足，应降级或撤销。

## 九、证据索引

| 结论 | 位置 |
| --- | --- |
| 四处静默跳过 | `src-tauri/src/audio/playlist.rs` L158 起 |
| 根级失败语义 | 同上（`Err(error) if directory == root`） |
| `AudioFolderPlaylist` 无失败字段 | `src-tauri/src/audio/types.rs` |
| foobar2000 的五种 IO 分类与 dead items | [library-mechanisms](../architecture/foobar2000-library-mechanisms.md) §三 |
| 本轮环境与能力 | [phase-3 comparison](../test/foobar2000-foobaka-phase-3-comparison.md) |
