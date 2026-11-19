---
doc_id: "ARCH-POWERAMP-IMPL-INDEX"
title: "已实现投票逐条逆向：八篇专文总览"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 9
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "docs/corpus/poweramp-feature-votes.md（8 条已完成清单）"
  - "8 篇 poweramp-impl-idea*.md 专文"
---

# 已实现投票逐条逆向：八篇专文总览

> 本文件是 8 篇 `poweramp-impl-idea*.md` 的**统一入口**。
> 每篇专文独立完整，本页只做归类、对照与剩余项汇总。

## 0. 一览表

| # | idea | 票 | 主题 | 层次 | 专文 | rev | 未解 |
| ---: | ---: | ---: | --- | --- | --- | ---: | ---: |
| 1 | 58 | 0 | 插入位置三态（开头/末尾/洗牌） | 数据层 | `poweramp-impl-idea58-insert-position.md` | 2 | 2 |
| 2 | 57 | 27 | 同步/滚动歌词 | 数据层 | `poweramp-impl-idea57-synced-lyrics.md` | 1 | 1 |
| 3 | 55 | 15 | 统一 Player Screen 术语 | 资源层 | `poweramp-impl-idea55-player-screen.md` | 1 | 2 |
| 4 | 54 | 18 | 多选批量拖动 | 交互层 | `poweramp-impl-idea54-multi-drag.md` | 1 | 2 |
| 5 | 40 | 163 | Bit Perfect / USB Exclusive | 音频层 | `poweramp-impl-idea40-bit-perfect.md` | 1 | 0 |
| 6 | 39 | 50 | 输出菜单设备优先 | 设置层 | `poweramp-impl-idea39-device-first-output.md` | 1 | 1 |
| 7 | 15 | 143 | 自定义播放界面按钮 | 交互层 | `poweramp-impl-idea15-custom-buttons.md` | 1 | 0 |
| 8 | 11 | 0 | Repeat 文案统一 | 资源层 | `poweramp-impl-idea11-repeat-wording.md` | 1 | 1 |
| | | | | | **合计** | | **9** |

> 排序按**逆向顺序**（从最新已实现条目往旧），非票数。

---

## 1. 按系统层次归类

### 1.1 数据层（2 篇）

> 数据库写入、缓存、解析

- **idea 58** 插入位置三态（开头/末尾/洗牌） —— `poweramp-impl-idea58-insert-position.md`
- **idea 57** 同步/滚动歌词 —— `poweramp-impl-idea57-synced-lyrics.md`

### 1.2 资源层（2 篇）

> 纯文案/数组，无运行期逻辑

- **idea 55** 统一 Player Screen 术语 —— `poweramp-impl-idea55-player-screen.md`
- **idea 11** Repeat 文案统一 —— `poweramp-impl-idea11-repeat-wording.md`

### 1.3 交互层（2 篇）

> 手势、拖拽、控件

- **idea 54** 多选批量拖动 —— `poweramp-impl-idea54-multi-drag.md`
- **idea 15** 自定义播放界面按钮 —— `poweramp-impl-idea15-custom-buttons.md`

### 1.4 音频层（1 篇）

> 输出后端与音频参数

- **idea 40** Bit Perfect / USB Exclusive —— `poweramp-impl-idea40-bit-perfect.md`

### 1.5 设置层（1 篇）

> 设置页结构与跳转寻址

- **idea 39** 输出菜单设备优先 —— `poweramp-impl-idea39-device-first-output.md`

---

## 2. 每条的核心发现（一句话）

| idea | 核心机制 |
| ---: | --- |
| 58 | 批量插入事务、位次补偿、`shuffle_order` 插入即赋值 |
| 57 | LRC 正则、毫秒换算、四级取词链、两表缓存 |
| 55 | 术语清零统计、8 条旧键名保留、三译法缺陷 |
| 54 | 自研拖拽框架、排列数组、落点同步 |
| 40 | 能力位掩码、设备白名单、多态代理 |
| 39 | 结构反转、`?device=` 寻址、双向映射 |
| 15 | 10 个偏好键、按钮即子 View、拖影截屏 |
| 11 | 六态模式表、七组平行数组 |

---

## 3. 跨条目的共同模式（值得单独记录）

| 模式 | 出现于 | 说明 |
| --- | --- | --- |
| **新增枚举取空号不重排** | idea 58（`1,0,2`）、idea 11（`4,0,5,3,1,2`） | 老用户偏好值语义不变 |
| **声明式控件** | idea 58（按钮三数组）、idea 11（七组平行数组） | 宿主零逻辑，改资源即可 |
| **位掩码表达能力** | idea 40（`1 << ordinal`） | 一个 int 表 N 项能力 |
| **按维度分套存储** | idea 15（横竖屏 6 键成对）、idea 39（`?device=`） | 不同上下文各自独立 |
| **单/多态共用一套代码** | idea 54（`n0.k` 判空） | 免写两套状态机 |
| **参数随消息快照下发** | idea 58 | 免长事务期竞态 |
| **重复实现不抽象** | idea 54 与 idea 15 的拖拽**互不复用** | 列表用 `widget/list/*`，按钮行用 `widget/base/*` |

---

## 4. 剩余未解项汇总

| idea | 未解 | 性质 |
| ---: | ---: | --- |
| 58 | 2 | 控件绑定时机、`p2` 参数语义 |
| 57 | 1 | 内嵌 SYLT 在 **native**（硬边界） |
| 55 | 2 | 翻译工程决策、上游是否已修（**不可从产物判断**） |
| 54 | 2 | 提交映射细节、边缘滚动阈值 |
| 39 | 1 | 插件解析规则（跨到插件系统） |
| 11 | 1 | `repeat_modes_summary` 索引表 |
| 40 | **0** | — |
| 15 | **0** | — |

> **40 与 15 已彻底闭合**。其余剩余项中：
> - idea 57 是 native 硬边界
> - idea 39 的剩余项**正是插件系统**（本仓库尚未逆向，已单独开篇）
> - 其余属"跨到别的子系统"或"无法从产物判断"

---

## 5. 证据口径

| 项 | 约定 |
| --- | --- |
| 版本 | 多数为 **build-1025**；idea 40 / 39 为 **build-1035** |
| 行号 | `.rea-analysis/smali/smali/…`（1025）或 `.rea-analysis/v1035/decoded/smali/…`（1035） |
| 资源 | `.rea-analysis/decoded/res/`（1025）或 `.rea-analysis/v1035/decoded/res/`（1035） |
| 命名 | 混淆名（`ׅ`/Cyrillic）保持原样，不音译 |

详见 `poweramp-corpus-conventions.md`。

---

## 6. 相关文档

| 文档 | 关系 |
| --- | --- |
| `poweramp-feature-votes.md` | 投票清单母文档（46 未完成 + 8 已完成） |
| `poweramp-release-changelog.md` | 版本更新记录，含各条生效的 build 号 |
| `poweramp-corpus-conventions.md` | 语料元规范（引用格式、版本域、命名系统） |
| `poweramp-settings-root-structure.md` | 设置树根索引 |
