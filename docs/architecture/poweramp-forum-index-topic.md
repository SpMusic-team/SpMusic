---
doc_id: "ARCH-POWERAMP-FORUM-INDEX-TOPIC"
title: "官方功能索引帖：开发者维护的投票总表与落地版本"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "forum 存档快照（2018-2026）"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 看看投票还未实现的功能的讨论，特别是开发者相关回复"
  - "Wayback: forum.powerampapp.com/topic/23541-..."
---

# 官方功能索引帖：开发者维护的投票总表与落地版本

## 0. 一句话结论

Poweramp 论坛有一个**开发者亲自维护的功能索引帖**（topic **23541**），
它比 `/ideas/` 投票页多出两类关键信息：

| 信息 | 投票页 | **索引帖** |
| --- | :---: | :---: |
| 条目总数 | 50 | **48**（44 VOTE + 4 COMPLETE） |
| **落地 build 号** | ❌ | ✅ **有** |
| **讨论帖链接** | ❌ | ✅ 29 个 |
| 投票资格规则 | ❌ | ✅ 有 |
| 明确排除项 | ❌ | ✅ 1 条 N/A |

> **索引帖是「投票结果 → 实际开发」之间的桥梁**，
> 因为它标注了哪些已完成、以及**在哪个 build 完成**。

---

## 1. 索引帖基本信息

| 项 | 值 |
| --- | --- |
| URL | `forum.powerampapp.com/topic/23541-frequently-requested-features-index-and-voting-list/` |
| 标题 | Frequently Requested Features Index and Voting List |
| 作者 | **andrewilley**（署名 **Andre**，版主 badge，Poweramp 团队成员） |
| 存档 | 2023-03 / 2024-07 / 2026-04 等多个快照 |
| 曾用名 | `frequently-requested-features-index-list`（2023 快照） |

### 1.1 帖子的自我说明（原文要点）

> This is an index of the most commonly discussed Feature Requests to help new users find existing conversations...
> Please do not add any specific request discussions to this thread...
> There is now also an opportunity for users to upvote their favourite features for developer consideration.

**投票规则（原文）**：

| 规则 | 原文 |
| --- | --- |
| 资格 | registered site members only |
| 限制 | one vote per person per subject |
| 反滥用 | There is no point in simply voting for everything as that would make each of your individual votes statistically meaningless |
| 新人限制 | **2 days membership and 2 valid forum posts required for voting** |

> 这条「2 天 + 2 帖」的门槛解释了为什么 `/ideas/` 的票数增长缓慢且稳定。

---

## 2. ★ 落地 build 号（索引帖独有）

索引帖用 `[ COMPLETE ]` 标记已完成项，并在部分条目后注明 build：

| 条目 | 标注 |
| --- | --- |
| Synced/scrolling Lyrics from tags, including LRC file support | **Feature added to PA build 948** |
| Insert into Playlist/Queue at start of the list, or in shuffled order | **Feature added to PA build 934** |
| Move multi-selected items up and down in Playlists or the Queue as a block | （无 build 号） |
| 统一 Player Screen 表述 | （无 build 号） |

### 2.1 与既有文档的交叉验证

既有 `poweramp-feature-votes.md` §1 记录 8 条已完成，
其中 4 条与索引帖的 COMPLETE 标记**完全对应**：

| idea | 索引帖 COMPLETE | 既有文档 |
| ---: | :---: | --- |
| 57 歌词 | ✅ | ✅ 1025 有 `data/lyrics` 包 |
| 58 插入位置 | ✅ | ✅ 1025 有 `m3` 洗牌 SQL |
| 54 多选拖拽 | ✅ | ✅ 1025 有多选拖动 |
| 55 Player Screen | ✅ | ✅ 1025 资源层 |

> **索引帖只标了 4 条，而用户截图显示 8 条**——差异在于另外 4 条
> （idea 40/39/15/11）**已从投票列表移除**，索引帖也不再列它们。
> 这与既有文档 §0 的统计口径一致：「4 条已完成项在投票列表里已被移除」。

### 2.2 build 948 与 934 的意义

| build | 落地功能 | 与当前 APK（1025）的关系 |
| ---: | --- | --- |
| **934** | 插入位置（开头/洗牌） | ✅ 1025 已包含 |
| **948** | 同步歌词 | ✅ 1025 已包含 |

> 两者都远早于 1025，因此**在 1025 产物里能找到实现**——
> 这与 `poweramp-impl-idea58-insert-position.md` / `-idea57-synced-lyrics.md` 的结论吻合。

---

## 3. 明确的排除项（N/A）

索引帖末尾有一条与其它条目不同的标记：

```
[N/A] Access to commercial streaming services (Spotify, iTunes, Amazon Music,
      YouTube Music, etc).
      <-- Note: unlikely to happen due to licensing restrictions
```

> **这是整份索引里唯一的 N/A**，也是**唯一由官方明确表态不会做**的功能。
> 原因写得很直白：licensing restrictions（授权限制）。

### 3.1 与「云存储」条目的区别

| 条目 | 状态 | 差别 |
| --- | --- | --- |
| Playback of users' **cloud-stored content**（Google Drive / Dropbox） | `[VOTE]` | 用户自己的文件，可行 |
| Access to **commercial streaming services** | **`[N/A]`** | 第三方曲库，受授权限制 |

> 官方把「自己的云盘」与「商业流媒体」**明确分开**——前者开放投票，后者直接否决。

---

## 4. 索引帖的 48 条结构

| 分组 | 条数 | 说明 |
| --- | ---: | --- |
| Player Screen Interface Elements | **12** | 界面元素相关 |
| Core App Features | **26** | 核心功能 |
| Audio Features | **10** | 音频功能 |
| **合计** | **48** | = 44 VOTE + 4 COMPLETE |

> 与 `/ideas/` 的 50 条（46 未完成 + 4 已完成仍在列表）相比，
> 索引帖少了 2 条，多了 1 条 N/A——**两者不是同一集合**，需分别引用。

---

## 5. 可借鉴（对文档体系）

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **索引帖与投票页分离** | 索引负责导航与状态，投票负责计数 |
| A2 | **完成项标注 build 号** | 用户能立刻知道「我用的版本有没有」 |
| A3 | **明确写出 N/A 及原因** | 减少重复提问（授权限制说清楚） |
| A4 | **投票门槛（2 天 + 2 帖）** | 抑制刷票，提升票数有效性 |

---

## 6. 证据索引

| 主题 | 位置 |
| --- | --- |
| 索引帖 2024 快照（完整正文） | `web.archive.org/web/20240601/https://forum.powerampapp.com/topic/23541-...` |
| 索引帖 2026 快照（最新，含投票页链接） | `web.archive.org/web/20260411/...` |
| 2023 快照（旧标题） | `web.archive.org/web/20230326/...frequently-requested-features-index-list/` |
| 投票规则原文 | 索引帖开头段落 |
| build 948 / 934 标注 | 索引帖 COMPLETE 条目末尾 |
| N/A 条目 | 索引帖 Audio Features 末尾 |

> 口径：论坛快照时间跨度 2023-03 至 2026-04。**非 APK 版本口径**。