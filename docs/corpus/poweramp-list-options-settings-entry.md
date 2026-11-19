---
doc_id: "ARCH-POWERAMP-LIST-OPTIONS-SETTINGS-ENTRY"
title: "Poweramp 三个排序开关的设置页入口与生效链路"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 2
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 继续调查（把三个隐藏排序开关追到设置页）"
  - ".rea-analysis/decoded/res/xml/library_lists.xml"
  - ".rea-analysis/decoded/res/values/strings.xml、values-zh-rCN/strings.xml"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/preference/{f0,k0,i2}.smali"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/scanner/ScanDispatcherService.smali"
  - "docs/corpus/poweramp-list-options-sql-builders.md（三个开关的消费点）"
  - "docs/corpus/poweramp-library-full-implementation.md（library_lists 页结构）"
---

# 三个排序开关的设置页入口与生效链路

> 本文补完 `poweramp-list-options-sql-builders.md` §7 的 Q1/Q2：
> **三个隐藏排序开关的 UI 在哪、默认值是多少、改了之后立刻发生什么。**

## 0. 一句话结论

三个开关**全部位于同一个设置页** `library_lists.xml`（设置 › 媒体库 › 列表），
**默认值全部为 `false`**，但**改动后的副作用分三档**：

| 开关 | 位置 | 默认 | 改动后的动作 |
| --- | --- | --- | --- |
| `use_albumartist_albums` | Albums 分类 | false | **即时**：只发 `msg_app_data_changed`，列表重查 |
| `no_sort_field` | Advanced 分类 | false | **即时**：同上 |
| `show_cue_source` | Advanced 分类 | false | **重扫描**：起 ACTION_SCAN_TAGS 服务，带 data_changed_flags=0x10 |

> 关键差别：`show_cue_source` 改变的是**扫描入库范围**（CUE 内虚拟曲目是否入列），
> 不只是排序口径，所以必须重扫；另两个只改 SQL 的 ORDER BY 列，重查即可。

---

## 1. 页面定位：都在 library_lists

全 res/xml 共 53 个文件，三个键**只在一个文件里出现**：

```
library_lists.xml:23   use_albumartist_albums
library_lists.xml:33   no_sort_field
library_lists.xml:34   show_cue_source
```

### 1.1 页面结构（39 行 / 3 个分类）

| 分类 | 行 | 成员数 |
| --- | --- | ---: |
| pref_look_and_feel（Look and Feel） | 4-19 | 13 |
| albums（Albums） | 20-27 | 6 |
| pref_advanced（Advanced） | 28-36 | 8 |
| restore_defaults | 37 | 1 |

页面标题 `pref_lists` = 「列表 / Lists」，
搜索面包屑 w:searchBreadcrumb1 = `pref_library`（媒体库）。

### 1.2 三个开关的原文声明

```xml
<!-- :23  Albums 分类 -->
<MultilineSwitchPreference android:title="@string/pref_use_albumartist_albums"
    android:key="use_albumartist_albums"
    android:summary="@string/pref_summary_use_albumartist_albums"
    android:defaultValue="false" />

<!-- :33 / :34  Advanced 分类 -->
<MultilineSwitchPreference android:key="no_sort_field"
    android:title="@string/pref_sort_no_sort_field"
    android:summary="@string/pref_summary_sort_no_sort_field"
    android:defaultValue="false" />
<MultilineSwitchPreference android:key="show_cue_source"
    android:title="@string/pref_show_cue_source"
    android:summary="@string/pref_summary_show_cue_source"
    android:defaultValue="false" />
```

> 三者都是 MultilineSwitchPreference（开关 + 两行摘要），**无 android:dependency**，
> 即**始终可见、互不门控**。

### 1.3 UI 文案（中英对照）

| 键 | 英文 | 简中 |
| --- | --- | --- |
| pref_use_albumartist_albums | Album Artist Label for Albums | 专辑使用专辑艺术家标签 |
| 其 summary | Show Album Artist tag (if exists) instead of just Artist tag for Albums. **Also changes sorting by Artist** | 专辑显示专辑艺术家标签(若存在)，代替仅显示艺术家标签。**同时会改变按艺术家排序的顺序。** |
| pref_sort_no_sort_field | Don't Ignore Articles For Sort | 排序时不要忽略冠词 |
| 其 summary | Don't ignore articles (the, a, an) in the beginning of albums, artists, and composers | 不要忽略专辑、艺术家和编曲者名字开头的冠词 |
| pref_show_cue_source | Show CUE Disc Image Files | 显示 CUE 光盘镜像文件 |
| 其 summary | Big undivided CUE disc image files will be visible in lists | 未分割的 CUE 光盘镜像文件将显示在文件夹列表中 |

> **值得记录**：`use_albumartist_albums` 的摘要在**英中两版都明写了"同时会改变按艺术家排序"**。
> 这是本 App 少数**主动向用户披露"这个开关会改排序"**的地方——
> 而 `no_sort_field` 与 `show_cue_source` 的摘要**完全没提排序**。

---

## 2. 绑定链路：谁给这些开关挂监听器

```
SettingsActivity
  └─ preference/f0.smali:693   const v0, 0x7f160016   ← library_lists 的 xml 资源 id
       └─ new preference/k0(..., mode=0xa)
            └─ k0.l()  ← 逐键 findPreference + setOnPreferenceChangeListener
```

### 2.1 三个开关挂的监听器（k0.l()）

| 键 | 监听器 | index | 行 |
| --- | --- | ---: | --- |
| no_sort_field | i2 | **0** | k0.smali:3008-3020 |
| show_cue_source | i2 | **2** | k0.smali:3040-3052 |
| use_albumartist_albums | i2 | **4** | k0.smali:3108-3114 |

> **索引 4 是共享的**：hide_unknown_album / hide_unknown_artist / use_albumartist /
> use_albumartist_albums / use_albumartist_albumartists —— **五个开关共用一个监听器实例**
> （k0.smali:3070-3124）。完整索引表：0=no_sort_field、1=hier_files_zoom、
> 2=show_cue_source、3=join_albums、4=五个专辑开关、5=root_hier_immediate。

---

## 3. 生效链路：i2.onPreferenceChange 的三条分支

### 3.1 索引 0 —— no_sort_field（i2.smali:148-167）

```smali
:pswitch_4   ; index 0
MsgBusHelper.fromContextOrThrow(ctx, 0x7f0d015b)   ; bus_app
    .post(0x7f0d0049, 0, 0, null)                   ; msg_app_data_changed
goto :goto_0 ; return true
```

### 3.2 索引 2 —— show_cue_source（i2.smali:106-123）

```smali
:pswitch_2   ; index 2
ScanDispatcherService.A(ctx,
    "pref show_cue_source",   // p1: cause
    0,                        // p2: eraseTags
    1,                        // p3: fastScan      ← 是
    0,                        // p4: rescanLyricsTags
    0x10)                     // p5: data_changed_flags
```

即发出 ACTION_SCAN_TAGS 服务意图（ScanDispatcherService.smali:48），extra 为：

| extra | 值 | 参数位 |
| --- | --- | --- |
| fastScan | true | p3 |
| cause | pref show_cue_source | p1 |
| data_changed_flags | 0x10 | p5 |

> **为什么必须重扫**：show_cue_source 决定扫描期是否把 CUE 内的虚拟曲目写进
> folder_files。这是**数据层变更**，不是排序口径变更。

### 3.3 索引 4 —— 五个专辑开关（i2.smali:80-104）

```smali
:pswitch_1   ; index 4
if (newValue == false) {
    k0.B.post(new j2(k0, 1));   ; 只在【关闭】时 post
}
return true
```

> **不对称**：只在**关掉**时 post，打开时不 post。
>
> **`j2.run()` 的实际内容（本轮已展开）**：
>
> ```smali
> ; j2.smali:29-54 → 起 f2 线程；f2.run() :35-97 做两件事
> UPDATE folder_files SET tag_status=0 WHERE album_artist_id=1000
> ScanDispatcherService.A(ctx, "pref join_albums", 0, 1, 0, 0x10)
> ```
>
> 即：**把 `album_artist_id=1000`（未知专辑艺术家的哨兵值）的行标记为需要重新打标签，
> 然后触发一次 fastScan 重扫**。原因是这个开关关闭后，原来按专辑艺术家归组的专辑
> 要退回按曲目艺术家归组，相关行的 `tag_status` 必须失效重算。
>
> `f2.run()` 里那句 `AssertionError`（`:99-104`）是 rest 库为 null 时的兜底。

### 3.4 msg_app_data_changed 之后谁响应

列表页 list/n0.smali:4417-4423：

```smali
:cond_17
const v12, 0x7f0d0049          ; msg_app_data_changed
if-ne v1, v12, :cond_18
invoke-virtual {v0, v10, v5, v3, v4}, n0->y(ZLjava/lang/Object;II)V   ; 重建列表
return-void
```

全库共 **30 处**引用该消息（数据层 data/А 占 9 处，列表/播放器/偏好各若干），
属于"全局数据变更"广播，不专属于排序。

---

## 4. 三个开关的完整因果链

```
设置页 library_lists
   ├─ no_sort_field ──────────────► у.О  (FastStaticPrefs)
   │                                 │
   │              ┌──────────────────┼──────────────────┐
   │              ▼                  ▼                  ▼
   │        h1.X() 艺术家       h1.x() 作曲家      h1.Х() 专辑
   │        artist|_sort        composer|_sort     album|_sort
   │              └──────────────────┼──────────────────┘
   │                                 ▼
   │                     p0.O() 模式8/9、l.O() 全模式、С.O()
   │
   ├─ use_albumartist_albums ────► у.о ──► l.O() 模式3 的基列
   │
   └─ show_cue_source ──────────► у.Р ──► u0.Z0() 模式4 的计数列
                                  └───► 并触发 rescan（data_changed_flags=0x10）
```

---

## 5. 「按艺术家排序」是唯一会给用户提示的那个

| 开关 | 摘要是否提"影响排序" | 实际是否影响排序 |
| --- | --- | --- |
| use_albumartist_albums | ✅ 明写 | ✅ 改模式 3 的基列 |
| no_sort_field | ❌ 只说"不忽略冠词" | ✅ 改 3 个实体族的排序列 |
| show_cue_source | ❌ 只说"显示 CUE 文件" | ✅ 改文件夹数量排序的计数列 |

> **一处可讨论的 UX 缺口**：用户以为 no_sort_field 只是显示细节，
> 实际它会让专辑/艺术家/作曲家列表的**整体顺序发生变化**。

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~j2.run() 做什么~~ | ✅ **已解**：`UPDATE folder_files SET tag_status=0 WHERE album_artist_id=1000` + fastScan 重扫（`f2.smali:35-97`） |
| Q2 | data_changed_flags=0x10 的位含义 | 只知是 CUE 相关；其余位未枚举 |
| Q3 | ScanDispatcherService.x（:42）非 0 时静默丢弃扫描请求 | 只知有这个前置守卫，何时非 0 未追 |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| 三键声明 | res/xml/library_lists.xml:23 / :33 / :34 |
| 页面标题与面包屑 | library_lists.xml:2 |
| 三个分类 | library_lists.xml:4-19 / 20-27 / 28-36 |
| 页面分派 | preference/f0.smali:692-704（0x7f160016 → k0 mode 0xa） |
| 监听器挂载 | preference/k0.smali:3008-3020 / 3040-3052 / 3070-3124 |
| 索引 0 分支 | preference/i2.smali:148-167 |
| 索引 2 分支 | preference/i2.smali:106-123 |
| 索引 4 分支 | preference/i2.smali:80-104 |
| 索引表 | preference/i2.smali:169-176 |
| 扫描入口 | scanner/ScanDispatcherService.smali:39-112 |
| 扫描前置守卫 | ScanDispatcherService.smali:42-44 |
| 列表页响应 | list/n0.smali:4417-4423 |
| 消息名 | res/values/public.xml（0x7f0d0049 = msg_app_data_changed） |
| UI 文案 | res/values/strings.xml、values-zh-rCN/strings.xml |

> 行号口径：**build-1025**。
