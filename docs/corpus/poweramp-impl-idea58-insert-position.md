---
doc_id: "ARCH-POWERAMP-IMPL-IDEA58-INSERT-POS"
title: "已实现投票逐条逆向 #1：Add to Playlist/Queue at Start or Shuffled（idea 58）"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 2
open_items: 2
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 从最新已实现投票开始逐条逆向（本条要求深挖至不可再挖）"
  - "docs/corpus/poweramp-feature-votes.md（已完成 8 条清单）"
  - ".rea-analysis/decoded/res/{layout,xml,values}（入口、数组、文案）"
  - ".rea-analysis/smali/smali/com/maxmpz/{audioplayer,widget}/**（执行链）"
---

# 已实现投票逐条逆向 #1：Add to Playlist/Queue at Start or Shuffled（idea 58）

> 官方 changelog：**Feature added to PA build 934**。投票原文：
> *"Insert into Playlist/Queue at start of the list, or in shuffled order"*（0 票，历史条目）。

## 0. 一句话结论

**三态枚举（开头/末尾/洗牌）+ 一个整型偏好 + MsgBus 随消息下发 + 事务化批量插入 +
"插入即赋随机键" + 双重 max 位次补偿 + 反范式 `in_playlist` 缓存。**
真正的复杂度不在 UI，而在 `data/А.X()` 这 1429 行的批量插入事务里。

---

## 1. 三态枚举

`res/values/arrays.xml:432-446`，三个数组**按下标对齐**：

```xml
<integer-array name="playlist_insert_args1">
    <item>1</item>   <!-- 0: insert_at_top    -->
    <item>0</item>   <!-- 1: insert_at_bottom -->
    <item>2</item>   <!-- 2: shuffled         -->
</integer-array>
<array name="playlist_insert_icons_24dp">
    <item>?insert_top_24dp</item><item>?insert_bottom_24dp</item><item>?insert_shuffle_24dp</item></array>
<string-array name="playlist_insert_modes">
    <item>@string/insert_at_top</item><item>@string/insert_at_bottom</item><item>@string/shuffled</item></string-array>
```

| 下标 | 存储值 | 图标 | 简中 | 语义 |
| ---: | ---: | --- | --- | --- |
| 0 | **1** | `insert_top` | 在开头插入 | 插到最前 |
| 1 | **0** | `insert_bottom` | 添加到末尾 | 追加（默认） |
| 2 | **2** | `insert_shuffle` | 随机 | 随机位置 |

> **存储值顺序是 `1, 0, 2` 而非 `0, 1, 2`**：
> "末尾"是历史默认 `0`，后加的"开头"取 `1`、"洗牌"取 `2`，
> **老用户已有偏好值的语义不变**。新增枚举取空号而非重排，是很实用的兼容手法。

### 1.1 三个独立枚举

| 偏好键 | 字段 | 场景 | 值域 |
| --- | --- | --- | --- |
| `playlist_insert_pos` | `h0.Z` | 加入播放列表 | 1/0/2 |
| `queue_insert_pos` | `h0.a0` | 加入队列 | 1/0/2 |
| `play_next_insert_pos` | `h0.b0` | 下一首插入 | 0/2 |

证据：`h0.smali:732/740/748` 三处 `const-string` → `:738/746/754` 三次 `sput-object`。
"下一首"没有"开头"概念，故 `play_next_insert_modes` 数组只有两项。

---

## 2. UI：声明式按钮 + 设置页双入口

### 2.1 入口 A —— 选择菜单（声明式）

`res/layout/dialog_title_extra_playlist_select.xml:8`：

```xml
<com.maxmpz.widget.base.BusSelectablePopupButtonLayout
    android:id="@id/insert"
    w:stateId="@id/state_playlist_insert_pos"        <!-- 读当前值 -->
    w:stateBusId="@id/playlist_list_layout"
    w:buttonsMsgId="@id/cmd_set_playlist_insert_pos" <!-- 写入命令 -->
    w:buttonsBusId="@id/playlist_list_layout"
    w:buttonsArg1="@array/playlist_insert_args1"     <!-- 存储值 -->
    w:buttonsLabels="@array/playlist_insert_modes"   <!-- 文案 -->
    w:buttonsDrawables="@array/playlist_insert_icons_24dp" />
```

> 整套"读状态 → 渲染 → 写回"由控件完成，**宿主代码零逻辑**。
> 同一布局里 `sort`（播放列表排序）用的是完全相同的模式，只是换了三组数组和 id。

### 2.2 入口 B —— 设置页

`res/xml/library_playlists.xml:9`：

```xml
<com.maxmpz.audioplayer.preference.TagListPreference
    android:title="@string/pref_playlist_insert_pos"
    android:key="playlist_insert_pos"
    w:entries="@array/playlist_insert_modes"
    w:values="@array/playlist_insert_args1" />
```

> 两个入口**共用同一偏好键**，互相同步。下方提示 `pref_insert_pos_hint`：
> *"Insert position can also be changed by long pressing the button in the selection menu"*。

---

## 3. 执行链

```
① 点按钮 → BusSelectablePopupButtonLayout
     发 cmd_set_playlist_insert_pos (0x7f0d0482)，arg1 = 选中值
      ↓
② ListWidget.onBusMsg (:1280)
       h0.Z.у(arg1)                       ← 写偏好
       值变化且非静默 → A0(arg1, 0x7f08003f, 0x7f0f0003)  Toast
      ↓
③ PlaylistSelectAndAddToListLayout.onBusMsg (:1930)
       同样写 h0.Z（两条总线都收到，幂等）
      ↓
④ 真正选播放列表时 (该类 :1864/:2226/:2452/:2516)
       MsgBus(bus_data_cmd 0x7f0d0037).В(
           this,
           msg  = cmd_data_mass_add_to_pl (0x7f0d0076),
           arg1 = h0.Z.А,        ← 插入位置随消息下发
           arg2 = у.р,           ← pl_no_dups（是否去重）
           obj  = UriAndIds)
      ↓
⑤ data/А.X(int pos, int n, Object obj)  (:1699)
       按 pos 分三支 → 算 sort → 事务内批量 INSERT
```

> **位置是"发消息时快照"**，不是执行时再读偏好——避免长事务期间用户改设置导致的竞态。

---

## 4. `data/А.X(int,int,Object)` 内部（1429 行）

### 4.1 前置校验

|---|---|
| --- | --- |
| obj 类型 | 必须 `instance-of UriAndIds`，否则直接 return（`:1708-1712`） |
| 实体类型 | `g1.у(uri)` 必须 `instance-of h2`（`:1774-1778`）；`h2` 是**可批量接收条目**的实体接口，唯一方法 `E0(RestProvider, UriAndIds, String[], int)Cursor` |
| ID 来源 | 优先 bundle `"_id"`，为 0 时取 `"_ids"` 数组（`:1728-1763`） |

### 4.2 三条分支

| `p1` | 分支 | 定位 | 关键 SQL |
| ---: | --- | --- | --- |
| **1** | 插到开头 | `:2221` | `SELECT sort FROM playlist_entries WHERE _id=?`（`:2339`） |
| **0** | 追加末尾 | `if-ne v0, v9(=1)` 落 `:cond_f` | `SELECT IFNULL(MAX(sort),-1), COUNT(*) ...`（`:2288`） |
| **2** | 洗牌 | `:2328` | 与开头同段位次计算 + 每行随机键 |

另有 `SELECT IFNULL(MAX(_id), -1) FROM playlist_entries WHERE playlist_id=?`（`:2224`）在 特定分支取 _id 基准。

### 4.3 位次补偿（关键）

`:2380-2402`：

```smali
sub-long v11, v40, v24        ; 目标位次 - 当前 MAX(sort)
max(0, v11)                    ; 不许为负
add v21 (常量 0x1)             ; +1
max(该值, (long) v2)           ; 不小于本批行数
add v24                        ; 加回基准 MAX(sort)
```

> 双重 max 保证：插到开头时**既不覆盖**已有行、**也不因插入行数超过间隙而重叠**。

### 4.4 实际 INSERT（`:2107`）

```sql
INSERT INTO playlist_entries (
    playlist_id, folder_file_id, sort, folder_path, file_name,
    cue_offset_ms, shuffle_order
) VALUES (?, ?, ?, ?, ?, ?, ABS(MAX(-9223372036854775807, RANDOM())))
```

**逐行独立性已验证**：`executeInsert()`（`:2770`）在游标循环体内，
循环末尾 `goto/16 :goto_e`（`:2797`）回跳到 `:goto_e` 的 `Cursor.moveToNext()`（`:2429`）。
⇒ 每行一次 INSERT、每行一次 `RANDOM()`，N 首歌得到 **N 个独立随机键**，不是同一个值。

> `MAX(-9223372036854775807, RANDOM())` 用于避免 `ABS(Long.MIN_VALUE)` 仍为负的溢出陷阱。
> 同一惯用法也出现在 `m3.T0/U0`。

### 4.5 同事务内预编译的四条语句

| 语句 | 作用 | 定位 |
| --- | --- | --- |
| 上面的 INSERT | 插入 | `:2107` |
| `SELECT _id FROM playlist_entries WHERE playlist_id=? AND folder_file_id=?` | 查重 | `:2115` |
| `DELETE FROM playlist_entries WHERE playlist_id=? AND folder_file_id=?` | 按 `pl_no_dups`（`у.р`，`:293`）决定是否先删旧行 | `:2123` |
| `UPDATE folder_files SET in_playlist=EXISTS(SELECT 1 FROM playlist_entries WHERE folder_file_id=folder_files._id) WHERE folder_files._id=?` | 同步反查列 | `:2131` |

> 第四条是**反范式缓存**：`folder_files.in_playlist` 冗余存"是否在任一播放列表"，
> 用 `EXISTS` 子查询每次增删后同步，让列表页免做 JOIN。
> 事务用 `beginTransactionNonExclusive()`（`:2163`）——允许其他读事务并发。

---

## 5. 队列侧：符号即语义

队列不走 `playlist_entries`，而是 `m3.T0/U0`（`:470-511`）：

```smali
; T0 —— 已播段（played_at <= ?）→ 负随机
"UPDATE queue SET shuffle_order=-ABS(MAX(-9223372036854775807, RANDOM()))
   WHERE folder_file_id IN(SELECT _id FROM folder_files WHERE played_at<=?)"
; U0 —— 未播段（played_at > ?）→ 正随机
"UPDATE queue SET shuffle_order=ABS(MAX(-9223372036854775807, RANDOM()))
   WHERE folder_file_id IN(SELECT _id FROM folder_files WHERE played_at>?)"
```

排序表达式（`m3.V0` `:494`）：
`у.C`（`queue_no_shuffle`）为真 → `"queue.sort"`；否则 → `"queue.shuffle_order,queue.sort"`。

| | 播放列表 | 队列 |
| --- | --- | --- |
| 表 | `playlist_entries` | `queue` |
| 随机列 | `shuffle_order`（插入时赋值） | `shuffle_order`（**正负号区分已播/未播**） |
| 已播历史保护 | 靠 `sort` 位次 | 靠**负数段永远排在正数段之前** |

---

## 6. 对 SpMusic 的可借鉴 / 不建议照抄

### 6.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | 新增枚举**取空号**而非重排 | `1,0,2` 保住老数据语义 |
| A2 | **声明式按钮**（stateId + 命令 id + 三数组） | 宿主零逻辑，加选项只改资源 |
| A3 | 参数**随消息快照下发** | 免长事务期竞态 |
| A4 | **插入即赋随机键** | 切随机播放零成本 |
| A5 | 位次补偿用**双重 max** | 防覆盖 / 防重叠 |
| A6 | 反范式 `in_playlist` + `EXISTS` 同步 | 列表页免 JOIN |
| A7 | `beginTransactionNonExclusive` | 允许并发读 |

### 6.2 不建议照抄

| # | 做法 | 问题 |
| --- | --- | --- |
| N1 | 同一枚举复制三份数组 | 三处维护易失步 |
| N2 | `0` 兼任"默认"与"末尾" | 无法区分"没设过"与"明确选末尾" |
| N3 | 两条总线重复写同一偏好 | 靠幂等兜底，属隐式契约 |
| N4 | 单个方法 1429 行 | 分支难以独立测试 |

---

## 7. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | 入口 A 的 `state_playlist_insert_pos` 绑定时机 | 已知 `ListWidget:1010` 读 `h0.Z`；控件的 onBindView 时机未逐帧追 |
| Q2 | `p2`（第二参数）语义 | 仅参与 `Math.max(该值, v2)` 下限约束（`:2396`），推断为本批行数，**静态无更多线索** |

> **已确认到此为止的部分**：`X()` 内部还有大量分支（cue_offset、raw file、多播放列表批量等），
> 但它们属于"批量写入的次要变体"，不影响插入位置语义本身。

---

## 8. 证据索引

| 主题 | 位置 |
| --- | --- |
| 三态数组 | `res/values/arrays.xml:432-446` |
| 按钮声明 | `res/layout/dialog_title_extra_playlist_select.xml:8` |
| 设置项 | `res/xml/library_playlists.xml:9` |
| 三个偏好键 | `widget/player/h0.smali:732/740/748` → `:738/746/754` |
| 状态读取 | `list/ListWidget.smali:1010-1018` |
| 命令写入 | `ListWidget.smali:1280-1296`、`PlaylistSelectAndAddToListLayout.smali:1930-1938` |
| 消息发布 | `PlaylistSelectAndAddToListLayout.smali:1864-1874/2226-2240/2452-2462/2516-2526` |
| 批量插入 | `data/А.smali:1699-3127` |
| INSERT | `data/А.smali:2107` |
| 预编译语句 | `data/А.smali:2115/2123/2131` |
| 事务 | `data/А.smali:2163` |
| 位次补偿 | `data/А.smali:2380-2402` |
| 逐行插入 | `data/А.smali:2770`（`executeInsert`）、`:2797`（回跳）、`:2429`（`moveToNext`） |
| 队列洗牌 SQL | `rest/library/m3.smali:470-511` |
| 消息名 | `0x7f0d0076`=`cmd_data_mass_add_to_pl`；`0x7f0d0037`=`bus_data_cmd`；`0x7f0d0482`=`cmd_set_playlist_insert_pos` |

> 行号口径：**build-1025**。
