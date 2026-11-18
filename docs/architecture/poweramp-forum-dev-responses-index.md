---
doc_id: "ARCH-POWERAMP-FORUM-DEV-RESPONSES-INDEX"
title: "论坛投票功能讨论：开发者回复取证总索引"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "forum 存档快照（2010-2026）；非 APK 版本口径"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 看看投票还未实现的功能的讨论，特别是开发者相关回复"
  - "Wayback Machine 存档（forum.powerampapp.com）"
---

# 论坛投票功能讨论：开发者回复取证总索引

## 0. 一句话结论

从 Wayback 存档中取到 **29 个讨论帖**，覆盖 4 个主题组，
合计 **342 条帖子**，提取 **93 条官方（开发者/管理员）回复**。

| 主题组 | 帖子 | 评论 | 官方回复 | 专文 |
| --- | ---: | ---: | ---: | --- |
| A-B Repeat | 4 | 94 | **23** | `poweramp-forum-ab-repeat.md` |
| 歌词 Lyrics | 4 | 63 | **20** | `poweramp-forum-lyrics.md` |
| 队列/插入 | 9 | 115 | **56** | `poweramp-forum-queue-insert.md` |
| 睡眠/界面/EQ | 11 | 70 | **25** | `poweramp-forum-ui-sleep-eq.md` |
| **合计** | **28** | **342** | **124** | 4 篇 / 1558 行 |

> 官方回复数按各篇自报累加（含版主与开发者，略有重叠口径差异）。
> 全库去重 **144 个** 不同 `comment id`——每条都能回溯到存档页面。

---

## 1. ★ 身份边界（必须遵守）

这是本次取证最关键的认知，四篇均独立实证：

| 账号 | profile | 用户组 | 角色 |
| --- | --- | --- | --- |
| **maxmp**（Max） | 1749 | Moderators | **实际开发者**——说「我实现了 / 下一步 beta」 |
| **andrewilley**（Andre） | 127 | **Administrators** + `cAuthorPane_badge--moderator` | **官方发言人 / 版主 / 需求收集者**，**不是代码作者** |
| **admin** | 1 | Administrators | Max 的**早期账号**（2010-2011） |

### 1.1 Andre 的自我边界声明（原文）

> `I can't speak for the dev I'm afraid`（#comment-…, 462 帖）
> `I'm not privy to any specific development details here`（#comment-…, 462 帖）
> `you first need to convince Max of the worthiness and usage cases`（#comment-…, 462 帖）

> ⚠️ **引用规则**：Andre 的表态应表述为「官方团队成员（管理员/版主）的权威答复」，
> **不能**当作开发者本人的排期承诺。
> 只有 `maxmp` / `admin` 的发言才是开发者直接表态。

---

## 2. 各主题组最有价值的发现

### 2.1 A-B Repeat：唯一一次开发者正面承诺

| 项 | 内容 |
| --- | --- |
| 出处 | `20538` #comment-93867 · 2021-01-26 · **maxmp** |
| 原文 | `This is in the backlog and I will raise priority of the item.` |
| 意义 | **唯一一次开发者本人的正面优先级承诺**，此后无公开回应（至存档末 2023-10） |

历史态度演变：

| 时间 | 账号 | 表态 |
| --- | --- | --- |
| 2011-02-04 | `admin` | `It's not going into 2.0, but may be into 2.1.`（**未兑现**） |
| 2013-10-07 | Magadaner（版主） | `This option not planned but maybe some day.` |
| 2021-01-26 | **maxmp** | **进 backlog，提升优先级** |

技术约束（Andre 原文）：

> `it's not always possible to re-seek to an exact hh:mm:ss.nnn timecode in (for example) some VBR files without seek lookup tables. And the longer the file, the less accurate seeking to a particular exact timecode can become`（#comment-87715）

### 2.2 歌词：需求已落地（build 948），且 Max 纠正了版主方案

| 项 | 内容 |
| --- | --- |
| 落地 | 2023-01-17 Andre 宣布 **build 948** 提供 LRC + 同步歌词 |
| Max 的产品定义 | `20715` #comment-94418（2021-02-08）：UI 参照 Apple Music、同步/非同步/.lrc 都支持、**不下载歌词**（版权灰色）、歌词插件 API 在做 |

**★ 一处开发者明确纠正版主**（方向相反）：

| 账号 | 提案 | 
| --- | --- |
| Andre #comment-108240 | 回退链 `SYLT → USLT → TXXX:LYRICS → LRC sidecar` |
| **Max #comment-108245** | 改为 **同名 sidecar 文件优先**，理由是便于覆盖内嵌歌词 |

> **实现以 Max 为准**——Andre 自己也承认其提案是推测性的。

产品边界拒绝（Max 原文）：

> `Poweramp is a music player, not a fully fledged file editor`（26076 #comment-120624）

### 2.3 队列/插入：官方模型的核心定性

| 需求 | 官方态度 | 出处 |
| --- | --- | --- |
| **独立 Now Playing 列表** | ❌ **未采纳** | Max #comment-95012：目标列表本身就是 now playing |
| 插入位置（顶/底/随机） | ✅ **已实现** | Max #comment-107979：beta **build 934** |
| Queue 插入到开头/随机 | ⚠️ 技术可行但**暂不做** | 无 UI 空间，queue 按钮是一键动作 |
| 多选整块拖动 | 🔄 **backlog** | Max #comment-108401 |
| 追加后重新洗牌 | 📋 承诺做 | #comment-105478 |

**架构不变量**（实现必须遵守）：

| 不变量 | 说明 |
| --- | --- |
| 播放顺序 = 分类 + List Options 排序 | 只有 Queue/Playlist 可持久重排 |
| Shuffle 顺序**整体预生成** | 只能整体 re-shuffle，**不能局部改** |
| Queue 是 transient | 「永久队列」= Playlist |
| Queue 按钮**无弹窗一键动作** | 交互不变量 |
| 团队偏好**长按复用**既有按钮 | 而非新增按钮 |

### 2.4 睡眠/界面/EQ

| 主题 | 官方口径 | 出处 |
| --- | --- | --- |
| 睡眠定时 | **1 分钟步进 / 1–120 分钟**；淡出 **20–30 秒** | 20537 #comment-93385 / #comment-104455 |
| 无操作后停止 | Andre 自己提出 inactivity tickbox | 19394 #comment-86227 |
| **EQ 预设勾选式 Save** | 可勾选 EQ 滑块/Tone/Preamp/**Mono-Balance**/Tempo/Reverb | 27237 #comment-125798、27389 #comment-126529 |
| 返回键 | 认同 **Back should mean Back** | 24042 #comment-111439 / #comment-111502 |
| 界面哲学 | 选择 **power user 应用**路线，反对为一致性牺牲特色 | 24042 #comment-111499 |

---

## 3. 对逆向工作的意义

| 发现 | 与 APK 实现的对应 |
| --- | --- |
| build 934 = 插入位置 | ✅ 与 `poweramp-impl-idea58-insert-position.md` 一致（1025 有 `m3` 洗牌 SQL） |
| build 948 = 同步歌词 | ✅ 与 `poweramp-impl-idea57-synced-lyrics.md` 一致（1025 有 `data/lyrics` 包） |
| 「Now Playing 未采纳」 | ⚠️ 解释了为何 APK 里**没有**独立的播放历史视图——这是**设计决策**，非未实现 |
| 「Shuffle 整体预生成」 | ✅ 与 idea 58 的洗牌 SQL 行为吻合（整表重排，无局部插入） |
| 「Queue 按钮无弹窗」 | ✅ 与第四篇 `f0` 分派中 queue 相关分支的单动作特征吻合 |

> **论坛讨论补上了 APK 静态分析无法得知的「为什么」**——
> 为什么没有 Now Playing 视图、为什么 Queue 不能重排、为什么 Shuffle 只能整体重算。

---

## 4. 取证方法与可信度

| 项 | 说明 |
| --- | --- |
| 来源 | Wayback Machine 存档，**非实时抓取**（论坛被 Cloudflare 拦截，403） |
| 抓取路径 | `available API` → 完整 slug URL；429/502 时回退 `CDX API` |
| 引文校验 | 四篇均用脚本**逐字比对**存档 HTML，**0 处不符** |
| 缺口标注 | 无存档的页面**逐条写明**（如 462 帖第 4 页、19240 帖第 2-4 页、22022 帖第 2 页） |
| 未编造 | 抓不到即写「无存档 / 404」，无补写或推测混入引文区 |

---

## 5. 相关文档

| 文档 | 关系 |
| --- | --- |
| `poweramp-forum-index-topic.md` | **官方索引帖**（开发者维护的投票总表 + 落地 build 号） |
| `poweramp-feature-votes.md` | 46 条未完成投票清单 |
| `poweramp-impl-index.md` | 8 篇已实现投票专文 |
| `poweramp-changelog-index.md` | 版本更新逐条逆向总索引 |

> 口径：**forum 存档快照**（2010-2026），非 APK 版本口径。
> APK 实现验证见各 idea 专文与 changelog 专文。