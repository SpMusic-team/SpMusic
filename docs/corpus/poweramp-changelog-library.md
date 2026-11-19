---
doc_id: "ARCH-POWERAMP-CHANGELOG-LIBRARY"
title: "Poweramp changelog 逐条逆向：库、列表与扫描（25 条）"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 6
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逆向 changelog 中「库、列表与扫描」类 25 条"
  - ".rea-analysis/_changelog_items.json（groups[\"库列表\"]，25 条）"
  - "docs/corpus/poweramp-release-changelog.md"
  - "docs/corpus/poweramp-corpus-conventions.md（引用规范，必读）"
  - "docs/corpus/poweramp-plugin-system-index.md"
  - "docs/corpus/poweramp-impl-index.md"
  - ".rea-analysis/smali/smali/com/maxmpz/（build-1025 smali，1808 文件）"
  - ".rea-analysis/decoded/res/xml/ 与 res/values/（build-1025 资源）"
  - ".rea-analysis/v1035/decoded/res/xml/ 与 smali/（build-1035 资源与 smali）"
---

# Poweramp changelog 逐条逆向：库、列表与扫描（25 条）

> **版本口径**：除 §3 明确标注的 3 条 102x 区块条目外，**全部锚定 build-1025**
> （`.rea-analysis/smali/smali/` + `.rea-analysis/decoded/`）。
> 引用 `ׅ/` 系列路径的仅出现在 §1-E（102x 三条），对应 build-1035。
> 引用制度：**B 制（`路径:行号` 指针式）**，详见
> [poweramp-corpus-conventions.md](poweramp-corpus-conventions.md) §2.2。

---

## §0 一句话结论

这 25 条（去重后 **23 个独立功能**，见 §4.2）里：

| 判定 | 条数 | 明细 |
| --- | ---: | --- |
| **有可指认实现落点** | **21** | #1 #2 #3 #5 #6 #8 #9 #10 #12 #13 #16 #17 #18 #20 #21 #22 #23 #25（其中 #4/#20 见 §2.2/§2.9）|
| **不重做（已有专文）** | 3 | #7 / #24（idea 54）、#15（idea 58）、#19（idea 11） |
| **未找到实现** | **1** | #14（Repeat One in CUE，§3） |
| **硬边界 / 新老不可判** | 2 | #11（滚动性能在 RenderThread）、#13′（.oga 新增性） |

> **#21 / #22 / #23 属 102x 区块**，在 build-1025 **不存在**，其实现位置全部在 **build-1035**（§1-E）。
>
> **覆盖率口径**：按「有可指认实现落点」计 = **21/23 ≈ 91%**；**唯一完全未找到的是 #14**。
> 另有 2 条（#4 / #11）虽有相关机制，但**改进点本身无法从产物逐行证实**（无版本标记 / 落在 native）。
>
> **#23 已升格为「完整闭环」**：其写侧（`ׅ/yy.smali:364-368`）在 1035 定位成功，
> 链条 5 跳全部落在实物行号上（§1-E-23、§2.8）。原先「1025 找不到写侧」的结论保留为**版本事实**，
> 不再记为缺口。


---

## §1 逐条逆向表

分组依据：A=扫描行为，B=大库/列表性能，C=标签与解析，D=队列与统计，E=102x 晚于 1025 的条目，
F=无独立实现的条目。

### A. 扫描行为（4 条）

| # | 更新原文 | 实现位置 | 机制 |
| ---: | --- | --- | --- |
| 16 | if file access is removed by the user … Poweramp now keeps the Library entries intact | `scanner/ScanDispatcherService.smali:498-538`；`rest/library/b4.smali:580-614` | **不做清理**：权限校验失败时**跳过扫描**（`"skipping scan, no storage permission(s)"`，:534-536），而不是删库。`b4.X()` 只在「非 SAF 全量授权」时返回 true，是「要不要扫」的开关，不是「要不要删」的开关 |
| 23 | rescan in folder scans just that folder (and subfolders) | ⚠️ **部分**：`scanner/folder/H.smali` 的**定向扫描引擎**已存在（§1-A），但 1025 **没有任何调用点写入 path extra**：`scanner/ScanDispatcherService.smali:256` 的 10 参签名**没有 path 形参**，16 处调用点全传空；`scanner/folder/H.smali` / `scanner/library/K.smali` 只**读** `path`，无人**写** | ✅ **完整链条已定位**（5 跳）：`v1035/decoded/smali/com/maxmpz/audioplayer/scanner/ScanDispatcherService.smali:969`（取 `o41->B`=`n41`）→ `:989` `yy.A(Intent,n41)` → **`v1035/decoded/smali/ׅ/yy.smali:364-368` 写 `path`**（`n41->В`）→ `:377` **`removeExtra("provider")`** → `v1035/decoded/smali/ׅ/qt.smali:205` 读回。只有 `v1035/decoded/smali/ׅ/yy.smali:364` 一处写 path（全 1035 扫描仅此 1 命中）| 见 §2.8。**关键差异**：1035 把「定向」做成**独立意图构造器** `yy.A(Intent,n41)`——不只是塞 `path`，还**主动删掉 `provider`**（:377），因为定向扫描的目标由 `n41` 携带的**已解析类型**决定，而不是靠 provider 串再解析一次 |
| — | （表格续）| `scanner/folder/H.smali:806-820` | 每个通过筛选的目录用 `com.maxmpz.audioplayer:rescan`（:842）向 ContentProvider 发起**独立 rescan**，并**按「path 首段」去重**（:806-820，`HashMap` 记录已处理卷） |
| — | （表格续）| `scanner/ScanDispatcherService.smali:256-354` | 10 参 `А(...)` 是**唯一的目录扫描入口**，把 8 个布尔打包成 Intent extra：`onlyIfEmpty`(:281)、`fastScan`(:288)、`eraseTags`(:295)、`fullRescan`(:302)、`resolvePlaylists`(:309)、`importSystemPlaylists`(:316)、`reparsePlaylists`(:323)、`scanProviders`(:328) |
| — | （结论）| — | **build-1025 里没有「文件夹内长按 rescan」这个 UI 入口**（见 §3-23）：:256 的 10 参签名**没有 path 形参**，16 处调用点（`preference/g3`、`c0`、`c2`、`e2`、`m2`、`n2`、`o2`、`Application`、`common/m`、`data/х`、`MusicFoldersLayout` …）**全部传 `0`/空为 path**。path extra 只在 `H.smali` 与 `scanner/library/K.smali:1086` **被读**，没有任何 1025 调用点**写**它 |
| 17 | improved playlist entries resolution | `scanner/X.smali:1622-1998`（`К`）+ `scanner/х.smali:29-291`（13 条预编译语句）+ `rest/library/j3.smali:987-1070`（兜底重绑） | **四级降级解析链**，见 §2.1。`scanner/х.smali` 共 **13 条** `pswitch` 预编译语句，其中 4 条（`pswitch_c`/`pswitch_2`/`pswitch_1`/`pswitch_0`）构成**四级 path 匹配** |
| 18 | new Stream Name In Title option | `rest/library/у.smali:1169-1175`（键）→ `rest/library/p0.smali:1960-2000`（消费） | 开关 true 时，从 `" - "` 分隔的标题里**切出后半段**当作 artist 显示（`StringsKt;->Р` 找分隔符，:1970；要求剩余长度 `>= 5`，:1984；取 `sb+3 .. end`，:1986-1992）。默认 false（`m;->С(String,Z)` 第二参 v2=0，:1171） |

> **注**：#16 的「保留条目」是**负向实现**——build-1025 里找不到任何「权限撤销时删库」的代码。
> 与之配对的信号是 `library.xml:5` 的 `pref_pa_keeps_tracks_no_storages` 文案（"Poweramp keeps tracks
> when no storages are available"），即**设计意图直接写在字符串里**，代码侧只做「跳过扫描」。

### B. 大库与列表性能（4 条）

| # | 更新原文 | 实现位置 | 机制 |
| ---: | --- | --- | --- |
| 4 | optimizations for very large libraries (e.g. 50k+ tracks) | 未定位为**单一改动**；相关机制散布：`rest/library/х.smali:10-34`、`scanner/folder/H.smali:479-489`、`scanner/library/K.smali:56-76` | 见 §2.3。可指认的三处结构性优化：①**大列表阈值常量**（:10-34）；②扫描期 **PRAGMA synchronous 1→0**（:479 `"PRAGMA synchronous=1"` 进入、:979 `"PRAGMA synchronous=0"` 事务内提速、:948/:1011/:1135 恢复）；③**标签扫描并发度按 SDK 分级**（:56-76，SDK≥28 → 12，否则 6） |
| 5 | new option No Reshuffle For Large Lists | `prefs/В.smali:1785-1791`；消费端 `player/b0.smali:5627-5647` | 键 `"no_reshuffle_for_large_lists"` 定义在 **`prefs/В.smali:1785-1791`**（`sput → В->n2`，默认 false）。消费：`b0` 在「手动选曲」分支里读 `В->n2`(:5627-5631)，为 true 时再比较 `mFilesCursor.getCount()`(:5635) 与 `rest/library/х->A`(:5641)，**超阈值则把 `v3`（reshuffle 标志）清零**（:5645） |
| 10 | improved reshuffle for the large (>10k) lists | `rest/library/х.smali:14-34` + `player/b0.smali:5641-5647` | **同一个阈值常量** `х.A` 既服务 #5 也服务本条的语义：`SDK_INT >= 28` → **20000**(`0x4e20`)，否则 **10000**(`0x2710`)。这是「>10k / >20k」两个数字在代码里的**唯一出处** |
| 11 | improved very large lists (>20k items) scrolling performance | 未找到与阈值绑定的滚动专项代码；仅 `rest/library/х.smali:23`（20000）；`scanner/library/K.smali:1086` 的 `"path"` 属定向扫描的读侧，与本条无关 | 见 §3-11。可核实的只有「20000 这个数字存在且被用作分界」，**滚动性能本身无 Java 侧可指认实现**（在 native/RenderThread） |

> **⚠️ 一处易错点（已实证）**：`no_reshuffle_for_large_lists` 的**定义**在 `prefs/В.smali:1785`，
> 而 `hide_unknown_artist`/`stream_name_in_title` 的**定义**在 `rest/library/у.smali:1161/1169`。
> 两个偏好存储类不同（`prefs/В` vs `rest/library/у`），**不能按「库相关就都在 у」推断**。

### C. 标签与解析（4 条）

| # | 更新原文 | 实现位置 | 机制 |
| ---: | --- | --- | --- |
| 12 | improved mod files scanning performance | `scanner/TagReader.smali:1633`、`:1673-1696`、`:1817-1824`；`scanner/ModTagReader.smali:24` | **独立的 native 扫描入口**：file_type 落在 `0x19..0x1d`（即 **25..29** = MOD/XM/S3M/IT/MPTM 五个枚举序）时走 `pswitch_0` 分支（:1633,`:1817-1824`），调用 `ModTagReader.native_scan_file`（:1696），**与通用 `TagReader.native_scan_file` 完全分离**（:1773）。分离即「性能优化」的落点：tracker 格式不必走通用解码路径 |
| — | （佐证）| `data/у.smali:451-560` | 枚举表给出 5 个 tracker 类型及其扩展名：`TYPE_MOD`/`TYPE_XM`/`TYPE_S3M`/`TYPE_IT`/`TYPE_MPTM`；`TYPE_STREAM` 的默认串是 `"openmpt tracker"`(:555) |
| 13 | improved tag handling of the files with the incorrect extensions (such as a mp4 file with the mp3 extension) | `scanner/TagReader.smali:1547-1624` | **探测式改判**：先按扩展名推定的 `p3`(file_type) 调 `FFMpegTagReader.native_scan_file_type`(:1605) 拿**真实类型** `v4`；若 `v4 != p3` 且 `-1 < v4 <= 0x1e`（30）则**采用探测到的类型**（:1611-1617），否则回落扩展名类型（:1621-1622）。改判后的类型会写回 `TagAndMeta.scannedFileType`(:1787) |
| — | （.oga/.ogg 扩展名侧）| `data/у.smali:111-121`（`TYPE_OGG`="ogg"）、`:577-583`（`TYPE_OGA`="oga"） | 两个枚举**并存**，即 `.oga` 与 `.ogg` 都在扫描白名单内。**§3 note**：本条 changelog 属 989–991 区块，1025 中两个枚举都已存在，无法从产物区分「新增」与「既有」 |
| — | （FLAC 元数据侧）| `scanner/TagReader.smali:271-274`（`native_scan_file` 声明）、`:277-467`（`В()` ashmem 能力探测） | FLAC 解析主体在 **native**（`native_scan_file` 无方法体）。Java 侧唯一相关是 `В()`：探测 Android ≤23 且厂商 FIIO 时**禁用** fd-ashmem 路径（:290-300，"canUseFDAshmem FAIL - fiio"） |
| 14 | fixed Repeat One in CUE | **未找到实现**（build-1025） | 见 §3-14 |

### D. 队列、统计与列表呈现（5 条）

| # | 更新原文 | 实现位置 | 机制 |
| ---: | --- | --- | --- |
| 1 | new Reset Stats option in Info/Tags dialog | `preference/g2.smali:477-495` → `preference/c2.smali:54-133` → `preference/d2.smali:36-60` → `data/А.smali:5828-5967` | 四段链，见 §2.4。**确认对话框**（`reset_stats_q`="Reset stats?" + 两段警示，`c2:63-99`）→ 确认后 post `cmd_data_reset_track_stats`(0x7f0d0509，`d2:50`) → `data/А.Н()` 把 `played_times`/`total_played_times`/`played_fully_at` **三列置 0**（`А:5853-5881`），再按 `_id=?` 单曲更新（:5924-5926）或全表更新（:5953） |
| 3 | Queue is now reloaded immediately for Always Clear On Add + Start Playing Queue: Immediately | `player/b0.smali:7212`（`onQueueUpdated(Z)`）`:7275-7291` | **三条件合取**：`p1`（本次更新是否由 add 触发，:7275）+ `prefs/В->Q == 1`（`queue_start` 的 "Immediately" 档，数组值 1 见 `arrays.xml:840`）(:7277-7281) + `rest/library/у->С`（`queue_clear_on_add`，:343-349）(:7283-7287) → 返回 `QUEUE_UPDATED_LOAD_NP`(:7289)，即走「立即重载」而非增量。**这正是「now reloaded immediately」的代码形态** |
| — | （清空动作本体）| `rest/library/m3.smali:62-114` | `m3.u1(RestProvider,J)Z` = `DELETE FROM queue WHERE _id!=?`（:71），返回「是否真的删了行」(:88-98)。**保留当前曲、其余全清**是「Always Clear On Add」的字面语义 |
| 9 | Info/Tags now shows total played count, including playbacks from count-based or count-sorted categories | `dialogs/у.smali:613`（常规路径）`:755`（无 tag 路径）；列来源 `data/А.smali:5867`；语义 `data/х.smali:2636-2658` | 关键在于**读的是哪一列**：两处都查 `folder_files.total_played_times`（不是 `played_times`）。两列的差由迁移脚本确立：DB 版本 < `0xf1`(241) 时新增 `total_played_times INTEGER NOT NULL DEFAULT 0` 并 `UPDATE … total_played_times=played_times`（`х:2636-2658`）。此后**增量写入**是 `played_times=played_times+1, total_played_times=total_played_times+1` 成对（`b0:2798`），但**部分播放路径只加 total**（`b0:2751`，仅 `total_played_times+1`）——这就是「包括来自 count-based 分类的播放」的机制：**统计型分类消费 `played_times`（如 `rest/library/p0.smali:876`、`rest/library/h3.smali:192`、`rest/library/d4.smali:214` 的 ORDER BY），而 Info/Tags 展示的是不受分类口径裁剪的 `total_played_times`** |
| 2 | new option in header menu/Add to Launcher for all categories | `list/n0.smali:5921-6081`（菜单命令 `0x7f0d050a`）→ `list/j0.smali:37-97` → `widget/g.smali:30-241` + `:246-436` | 三选项多选对话框，见 §2.5。菜单项 id = `cmd_list_add_to_launcher`(0x7f0d050a，:5921)；标题 `add_to_launcher`("Add to Launcher"，:5971)；三个复选项 `shortcut_plays_list`(:5981)/`shortcut_opens_list`(:5987)/`shuffle`(:5993)；**默认值 `{1,1,0}`** = 「播列表 + 开列表 + 不洗牌」（`:array_5`，:7443-7448）。三种 Intent action 见 `widget/g.smali:37-53` |
| — | （「所有分类」的实现方式）| `widget/g.smali:316-358` | 与「分类」解耦：`g1.x(Uri)` 把任意 catUri 解析为 `h0`（:326），再 `x2.P(Uri)` 取 id（:358）、`h0.s()` 取图标资源（:386）、`x2.Р()` 取子项数（:394）。**任何分类共用一条路径**，没有分类白名单 |

| 8 | new Hide Unknown Artist option | `rest/library/у.smali:1161-1167`（键）→ `rest/library/p0.smali:1552-1565`、`:1579-1592`（SQL） | 不是「过滤行」，而是**改写 SELECT 的表达式**：`e1()` 根据 `hide_unknown_artist` 返回不同 SQL 片段。true 时对 `artist_id = 1000`（"unknown" 哨兵）的曲目 **返回 `NULL` 而不是 `artist`**（:1558、:1585），使第二行 label 整体消失（对应 summary "This may hide the 2nd track label completely"）。**依赖 `hide_unknown_album` 先开**（`library_lists.xml:26` 的 `android:dependency`；代码里 `:1546/:1573` 读 `у->a` 即 `hide_unknown_album`） |

| 20 | improved album art handling for streams with very long uris | `data/aa/х.smali:570-677`（**动态增长的 CharArrayBuffer**）、`androidx/versionedparcelable/В.smali:26-65`（append）、`:535-578`（grow）、`data/aa/P.smali:591-640`（长路径**不经 String** 直接开 fd） | 见 §2.9。核心是**不在 Java 侧构造长 String**：路径以 `char[]` 存放于 `CharArrayBuffer`，按 **1.5×+2** 增量扩容（`В:544-550`），最终交给 `NativeUtils.native_open_fd([CIIIZ)I`（`jni/NativeUtils.smali:50`）——**native 直接吃 char 数组**，绕开 `String`/`Uri` 的长度与分配开销 |

> **#8 的 featurePack 标记**：`library_lists.xml:26` 该条目带 `w:featurePack="1"`，
> 即 Feature Package #1 内容（与 `changelog_978_fp` / `fp1_changelog_content` 一致）。
> #25 与 #8 是**同一条**（两处 changelog 区块重复列同一功能），故本文按 1 条实现计。

| 6 | new Settings Shortcuts in Main Menu option | `com/maxmpz/widget/player/h0.smali:1229-1237`（键 `num_settings_tags`，默认 **5**）→ `preference/v1.smali:540-854`（`B()`） | 见 §2.6。**不是「加菜单项」而是「在主菜单里注入最近访问的设置页标签」**：`v1.B()` 读 `h0->t0`(:545)，为 0 直接返回(:549-551)，否则取 `h0->p0`（MRU 历史数组，:594-602）并**按 `num_settings_tags` 截断**(:610-618)。匹配逻辑：完全相等优先(:675-681)，其次路径前缀匹配且后接 `&`/`#`(:703-761) |

### E. 102x 区块（晚于 build-1025，改在 build-1035 定位）

| # | 更新原文 | 1025 状态 | 1035 定位 | 机制 |
| ---: | --- | --- | --- | --- |
| 21 | new Tracker Decoder Interpolation option | ❌ **0 命中**（`"mod_interpolation"` 在全 1808 个 `com/maxmpz` smali 中 0 处；而相邻的 `"mod_separation"`/`"mod_gain_mb"` 在 `prefs/В.smali:1767-1783` 存在 → 确认是**新增而非改名**） | ✅ `v1035/decoded/res/xml/audio_tweaks.xml:16`（key=`mod_interpolation`）；定义 `v1035/decoded/smali/ׅ/vr.smali:3535-3566`（`sput → vr->y2`, `Lׅ/rb1` → `a30->А`）；消费 `v1035/decoded/smali/com/maxmpz/audioplayer/decoder/mod/ModPluginService.smali:56`、`:122` | **五项枚举 → 五个 int 值**（`arrays.xml` `pref_mod_interpolation_values` = `0,1,2,4,8`；entries = Default/None/Linear/Cubic/Sinc(8 taps)）。值**不是 0..4 连号**，是**位/层级语义**（0=default、1=none、2=linear、4=cubic、8=sinc）——注意 `2/4/8` 恰为 2 的幂，但 **`1`(none) 与 `0`(default) 并存**，故不能当成纯位域解释。三个值作为 `В(IIIIIII)Z` 的第 5/6/7 参（`i2`/`j2`/`y2`）传给 `PlayerServiceCore`（`v1035/decoded/smali/com/maxmpz/audioplayer/decoder/mod/ModPluginService.smali:40-86`）。**改选项即重配解码器**：`v1035/decoded/smali/ׅ/z61.smali:4232-4241` 用 **index=`0x21`(33)** 构造 `a91` 并绑 `setOnPreferenceChangeListener`；`a91.u` 的 `packed-switch` **只有 case 0**（`:297-300`），故 **33 落入 default 分支**（`:57-87`），post `cmd_player_apply_internal_plugin_config`(0x7f0d050c)、`bus_player_cmd`(0x7f0d0034)、payload=`"com.maxmpz.audioplayer/decoder.mod"` |
| 22 | new Grant via Shizuku option to enable volume-key long-press track controls | ❌ **0 命中**（`"_long_volume_shizuku_grant"` 在 1025 全库 0 处） | ✅ `v1035/decoded/res/xml/misc.xml:34`（`w:key="_long_volume_shizuku_grant"`，`ProgressPreference`）；`v1035/decoded/smali/ׅ/sa1.smali:286`、`:951`、`:1002` | 见 §2.7。三项状态机：`checkSelfPermission(SET_VOLUME_KEY_LONG_PRESS_LISTENER)` 已授予 → summary=`permission_granted`(:336→:341)；未授予 → summary=`no_permission`(:370→:375)、开关置 `false` 且 disable(:387,`:392)；Shizuku 授权中 → summary=`pref_grant_via_shizuku_granting`(:409→:424)。点击触发 `ProgressPreference.setProgress(true)`(:467) 并构造 `x80` 授权器（:916-994，key 拼成 `<页面id>#_long_volume_shizuku_grant`，:951） |
| 23 | rescan in folder scans just that folder (and subfolders) | ⚠️ **部分**：`H.smali` 的**定向扫描引擎**已存在（§1-A），但 1025 **没有任何调用点写入 path extra**（16 处 10 参调用全传空） | ✅ `v1035/decoded/smali/com/maxmpz/audioplayer/scanner/ScanDispatcherService.smali:488`（`"path"`）、`:1301`（`ACTION_SCAN_DIRS`）、`:1375`（`qt.А(Intent)`）；核心 `v1035/decoded/smali/ׅ/qt.smali:205-1290` | 见 §2.8。1035 把 1025 的「10 参 boolean 打包」重构成**「Intent → 扫描目标模型」**：`qt.А(Intent)` 读 `path`(:319-323) → `ih0.Z(String)` 解析为 `o41`(:338) → 取 `n41`(:358)，产出具名类型 `nt`（`toString` 自证字段名：`status`/`effectiveCanonicalPath`/`preScanStats`，`v1035/decoded/smali/ׅ/nt.smali:223-303`）。**关键新逻辑**：目标必须落在某个已选 Music Folder 内(:614-646)，否则记 `"Target is not inside a selected Music Folder"`(:670) 并放弃；层级兼容性检查走 :740-793 / :797-866 |

> **口径提醒**：#23 在 1025 有一半（引擎 + 读侧），在 1035 有另一半（**写侧** + 目标解析 + 结果模型）。
> 本文判为「有实现，跨两版拼合」，但**读者不要拿 1025 的 `scanner/ScanDispatcherService.smali:256` 去找 path 形参**
> ——它是 1035 `v1035/decoded/smali/ׅ/yy.smali:923`（`K`，同样无 path）与 `:141`（`A(Intent,n41)`，唯一有 path）的前身。
>
> **为什么 1025 缺写侧不等于「没实现」**：1025 的读侧（`scanner/folder/H.smali:99-218`）
> 与写侧 schema **完全对齐**（同样的 `provider` + `path` 两个 extra），只是**暴露它的入口在 1035 才接上**。
> 这与 changelog 把它列在 **1026–1032** 而非更早，互相印证。

### F. 无独立实现的条目（3 条）

| # | 更新原文 | 判定 | 依据 |
| ---: | --- | --- | --- |
| 7 / 24 | support for multiple items dragging in playlists and Queue | **不重做** | 已由 [poweramp-impl-idea54-multi-drag.md](poweramp-impl-idea54-multi-drag.md) 覆盖（见 [poweramp-impl-index.md](poweramp-impl-index.md) 第 4 行）。#7 与 #24 是**同一条的两处列示**（`changelog_978_fp` idx 2 与 `fp1_changelog_content` idx 4） |
| 15 | Add to Playlist dialog improvements via selectable modes | **不重做** | 已由 [poweramp-impl-idea58-insert-position.md](poweramp-impl-idea58-insert-position.md) 覆盖（`poweramp-impl-index.md` 第 1 行）。本条目在 changelog 里是**标题行**（列表首项、无内容），实体在后续子项 |
| 19 | repeat mode improvements | **不重做** | 已由 [poweramp-impl-idea11-repeat-wording.md](poweramp-impl-idea11-repeat-wording.md) 覆盖（`poweramp-impl-index.md` 第 8 行）。`poweramp-release-changelog.md:259` 亦已交叉印证：本条对应 `repeat` = "Repeat" |

---

## §2 共性机制归纳

### 2.1 播放列表条目解析 = 四级 SQL 降级链（#17）

入口 `scanner/X.smali:1622` `К(String,[String)`，逐级尝试、**命中即返回**：

| 级 | 预编译语句 | 位置 | 匹配条件 |
| ---: | --- | --- | --- |
| 0 | `pswitch_0`（`X->X`）| `scanner/х.smali:265` | `folder_files.name = ?` **且** (`folders.short_name = ?` **或** `folders.path = ?`)，全部 `COLLATE NOCASE`，排除 `is_cue=1` |
| 1 | `pswitch_1`（`X->Х`）| `scanner/х.smali:106-142`（由 13 段 `CharSequence` 拼成）| `folder_files.file_path = ?` `COLLATE NOCASE`（**绝对路径直配**） |
| 2 | `pswitch_2`（`X->Х`）| `scanner/х.smali:155` | `name = ?` **且** `folders.parent_name = ?` **且** `folders.short_name = ?`（**三段全等**）|
| 3 | `pswitch_c`（`X->х`）| `scanner/х.smali:210`（"by filename" 兜底）| `SELECT _id FROM folder_files WHERE file_type=23 AND name=? COLLATE NOCASE`（**只按文件名，不看目录**；`file_type=23` 即「扫描出的真实文件」哨兵）|

> 三级与四级之间的差别就是 changelog 里 "greater range of sub-paths" / "by filename" 两句话的实体：
> 级 2 要求 **parent_name + short_name 两段都对上**，级 0 放宽到 **short_name 或整条 path 之一**，
> 级 3 完全不看目录。`scanner/X.smali:1809-1990` 是按「`\`→`/` 规范化后**从右往左取最多两段子路径**」
> （`StringsKt;->P(ILjava/lang/String;ILjava/lang/String;)I` 反复定位倒数第 1/2/3 个 `/`，:1718-1791），
> 拼出 `(v3, v9, v14)` 三元组后按 级0 → 级1 → 级2 顺序试（:1866-1904、:1909-1945、:1953-1971）。
>
> **解析失败不丢条目**：`folder_file_id IS NULL` 的条目保留在原表，`rest/library/j3.smali:1028-1070`
> 建临时表 `_unresolved_playlist_entries` 做后续重绑，并用 `process_cues` 开关
> （`rest/library/у.smali:279-285` → `у->P`）决定是否追加 `folder_files.cue_folder_id IS NULL` 约束
> （j3:1030-1036 / :1059-1063）。

### 2.2 「优化」类条目的三种可指认形态（#4 / #10 / #11 / #12）

| 形态 | 实例 | 为什么这算「优化」的实证 |
| --- | --- | --- |
| **阈值常量 + 分支** | `rest/library/х.smali:14-34` | 一个 `static final int`，按 SDK 分 10000/20000，**唯一消费点**是 `player/b0.smali:5641` 的 `if-le`。1025 全库仅此 1 处读它（`rest/library/х.smali:31` 是写） |
| **分区 PRAGMA + 批次事务** | `scanner/folder/H.smali:479` vs `:979` | 进入时 `synchronous=1`，写事务前降到 `0`，事务结束后在三个出口（:948 / :1011 / :1135）**统一恢复**。这是「缩短 fsync 次数」的标准手法 |
| **按格式分流 native 入口** | `scanner/TagReader.smali:1633` + `:1817-1824` | `packed-switch` 只覆盖 `0x19..0x1d`，落在这 5 个值的走 `ModTagReader`，**其余全部**走通用 `native_scan_file`。分流本身即「不为 tracker 走重路径」 |

> **另有一条常被误认成 #4 的机制**：`scanner/library/K.smali:56-76` 的并发度常量
> （SDK≥28 → 12，否则 6），以及 `:85-91` 的 `HashMap(100)` 预置容量。
> 这两处**无法证明是 978 那一版加的**（无版本标记），只能作为「大库优化的候选落点」记录。

### 2.3 播放次数为何有两列（#9）

```
played_times         ← 统计型/排序型分类消费（ORDER BY played_times）
total_played_times   ← Info/Tags 展示；不受分类口径裁剪
```

| 事实 | 位置 |
| --- | --- |
| 迁移起点：DB < 241 时新增列并 **一次性对齐** | `data/х.smali:2636-2658`（`"total_played_times=played_times"`，:2652） |
| 常规播放：**两列同时 +1** | `player/b0.smali:2798` |
| 仅位置恢复/部分播放：**只 total +1** | `player/b0.smali:2751`（`"…played_fully_at=played_at, total_played_times=total_played_times+1…"`，无 `played_times`） |
| Info/Tags 读 total | `dialogs/у.smali:613`、`:755` |
| 排序分类读 played | `rest/library/p0.smali:876`、`rest/library/h3.smali:192`、`rest/library/d4.smali:214-219`、`rest/library/h1.smali:1760-1765` |
| Reset Stats 两列都清 | `data/А.smali:5853`、`:5867` |

> **推论（谨慎）**：「including playbacks from the count-based or count-sorted categories」
> 的**可验证含义**是「Info/Tags 用的是与分类排序**不同的一列**」。至于哪条业务路径
> 只加 total，1025 里唯一确凿的是 `b0:2751`（`getUpdateLastPosSt()` 专用的 restore 语句）。
> 其余路径是否也如此，**未逐一穷举**（见 §3）。

### 2.4 Reset Stats 的四段链（#1）

```
preference/g2.smali:477  findPreference("reset_stats")
preference/g2.smali:487  new c2(g2, 5)  →  setOnPreferenceClickListener
      ↓ 点击
preference/c2.smali:207  :pswitch_5  →  构造 PseudoAlertDialog（标题 reset_stats_q）
preference/c2.smali:117  new d2(g2, 2)  →  setPositiveButton(reset)
preference/c2.smali:113  setDismissOnPositive(false)   ← 不自动关，等异步结果
      ↓ 确认
preference/d2.smali:50   post cmd_data_reset_track_stats (0x7f0d0509)
preference/d2.smali:58   toToast(done)
      ↓
data/А.smali:5853/5867/5875  ContentValues{ played_times=0, total_played_times=0, played_fully_at=0 }
data/А.smali:5891-5942        带 target（单曲）：update(..., "_id=?", [id])
data/А.smali:5944-5963        不带 target（全量）：update(..., null, null)
      ↓ 成功（影响行数 > 0）
post msg_app_data_changed(0x7f0d0049)  →  UI 刷新
```

**要点**：
- 「Reset Stats」**不动** rating、不动文件、不动 tag（与 `reset_all_tracks_stats_warn` 文案完全一致）。
- 全量路径的门控是 `p1==1 && p2==1`（`А:5947-5949`），即消息两个 arg 都为 1 才清**全表**；
  否则如果有 `p3`（target 对象）就清单曲。`p3` 为 null 且 arg 不匹配时**什么都不做**（:5965 落 `:cond_2`）。
- 广播 id `0x7f0d0509` 同时在 `android/support/v4/media/session/К.smali:4453` 被接住 → 转 `data/А.Н(IILjava/lang/Object;)V`(:4463)。

### 2.5 Add to Launcher 的三选项 + 两套 shortcut API（#2）

| 项 | 语义（字符串） | 影响 |
| ---: | --- | --- |
| 0 | `shortcut_plays_list` = "Play the list" | `p8` 传 `Z`，决定 action 是 `ACTION_OPEN_LIST_AND_PLAY` |
| 1 | `shortcut_opens_list` = "Open the list" | `p9` 决定是 `ACTION_OPEN_LIST_AND_PLAY` / `ACTION_OPEN_LIBRARY` / `ACTION_VIEW` |
| 2 | `shuffle` = "Shuffle" | `p6` → Uri 加 `shf=2`（否则 `shf=0`），见 `widget/g.smali:366-382` |

**默认 `{1,1,0}`** = 播 + 开 + 不洗牌（`list/n0.smali:7443-7448`）。

**两套 API 分支**（`widget/g.smali:246-436` 的 `B(...)` vs `:30-241` 的静态 `В(...)`）：

| 分支 | 条件 | 实现 |
| --- | --- | --- |
| 现代 | `SDK>=26` 且 has `shortcut` 服务 且（`SDK>=28` 或非 asus）| `ShortcutInfo$Builder` + `createShortcutResultIntent`(:158) + `requestPinShortcut`(:164) |
| 兼容 | 否则（含 `SDK<26`、无服务、asus+SDK 26/27）| `android.intent.extra.shortcut.*` 三件套(:183-214) + `sendBroadcast(INSTALL_SHORTCUT)`(:220-224) |

**图标不是即时生成的**：`B()` 先 `g1.x(Uri)` 解出 `h0`(:326)，再向 `AAProvider.O(...)` 申请
异步位图（:434，参数含 `J`=id、`I`=图标资源、`0x3c`=60 尺寸档），**回调里才真正建快捷方式**
（回调即 `widget/e` 那层 `Function1`，由 `list/j0.smali:82-86` 注入）。

### 2.6 「主菜单设置快捷标签」是 MRU 注入而非菜单项（#6）

```
h0->t0 = num_settings_tags (默认 5)          com/maxmpz/widget/player/h0.smali:1229-1237
v1.B()  :545  读 t0；<=0 直接 return（:549-551）
        :594  读 h0->p0  →  MRU 数组 [pageId, pageTitle, pageId, pageTitle, ...]
        :610-618  上限 = min(数组长 + 2, num_settings_tags * 2)   ← 成对，故 *2
        :675-681  完全匹配当前页 → 停止（不再往下放）
        :703-761  前缀匹配：regionMatches(9, current, 0, len)
                  且末尾必为 '-'/'&'/'#' 之一      ← 9 是 "settings/".length()
        :760      命中后 Х(i, i+1) 交换两相邻项 → 命中项前移
```

> **「9」这个魔数**=`"settings/".length()`。`preference/v1.smali:719` 载入 `const/16 v15, 0x9`，
> :721 作为 `regionMatches(ILjava/lang/String;II)Z` 的第一个实参（起始偏移）传入，
> 即**跳过 9 字符前缀后做同页前缀判定**（例如当前在 `settings/library`，
> 则所有 `settings/library#...` 都算相关）。

### 2.7 Shizuku 授权的三态（#22，build-1035）

| 态 | 判据 | UI |
| --- | --- | --- |
| granted | `checkSelfPermission(SET_VOLUME_KEY_LONG_PRESS_LISTENER) == 0`(:332) | summary=`permission_granted`(:341)、下层 `long_volume_controls` **启用**(:346) |
| denied | 同上 != 0(:369) | summary=`no_permission`(:375)、开关 `setChecked(false)`(:387)、**disable**(:392) |
| granting | `x80->К` / `x80->К(2)` 标志(:401,:442-450) | summary 二选一：`pref_grant_via_shizuku_granting`("Granting...") 或 `pref_summary_long_volume_grant_via_shizuku`(:409 vs :418) |
| 进度条 | `x80` 三元态掩码 → `setProgress(Z)`(:467) | — |

**授权器 `x80` 的构造参数**（sa1:916-994）：`(SettingsActivity, Handler, ra1 回调, "<页面id>#_long_volume_shizuku_grant", u0 超时回调)`。
即**用 CompoundButton 的前缀约定把「授权行」绑到「开关行」上**——这正是 `misc.xml:34`
把 key 写成 `_long_volume_shizuku_grant`（前置下划线 = 伪 key）的原因。

### 2.8 定向扫描：1025 引擎 vs 1035 入口（#23）

| 维度 | build-1025 | build-1035 |
| --- | --- | --- |
| 入口签名 | `ScanDispatcherService.А(Context,String,ZZZZZZZZ)V`（:256，**无 path**）| `qt.А(Intent)→nt`（`v1035/decoded/smali/ׅ/qt.smali:205`），path 从 Intent 读（:319-323）|
| 目标解析 | `H.y`/`H.у` 两个字符串（:212/:218）| `o41`/`n41` **具名类型**（:887-941）；`nt` 有 `status`/`effectiveCanonicalPath`/`preScanStats` |
| 越界判定 | 无（只在已选根内做 `startsWith` 过滤，:715-751）| **显式拒绝**：目标不在任何 Music Folder 内 → `"Target is not inside a selected Music Folder target="`(:670) |
| 不可访问兜底 | `H.К` 标志 + 上溯链(:139/:715) | 三级兜底：①不可访问 → `"Selected Music Folder is inaccessible"`(:756)；②上溯父目录(`:797-866`，`ih0.d/t/W` 三段调用)；③仍不匹配 → `"Accessible-parent walk left selected Music Folder"`(:841) |
| 状态模型 | 无（void）| `ot` 枚举 + `nt`（`FolderScanResult`）；`ot->y`/`ot->у` 是两种失败态(:217,:221) |
| 子目录语义 | `startsWith` 双向（A 是 B 前缀 或 B 是 A 前缀）→ 覆盖子树 | 同（`:634` `StringsKt.j` 做 contains/prefix 判定）|
| **谁写 path** | **无人写**（16 处调用点全传空）| `v1035/decoded/smali/ׅ/yy.smali:364-368`（`A(Intent,n41)`，全库唯一写点）；上游 `v1035/decoded/smali/com/maxmpz/audioplayer/scanner/ScanDispatcherService.smali:969,989` |
| **provider 串** | `scanner/folder/H.smali:99-103` 读 `provider`，`к:111/:139` 置位 | `v1035/decoded/smali/ׅ/yy.smali:377` 用 `removeExtra("provider")` **主动删除**——定向路径不再依赖 provider 串 |

### 2.9 长 URI 专辑封面为什么需要单独处理（#20）

普通路径走 `String`，长 URI（尤其 `content://` + 长 query 的流媒体）会在三处吃亏：
**拼接分配**、**`Uri.parse` 的开销**、**JNI 边界上的编码转换**。build-1025 的处理是
**全程 char[]，只在最后一步交给 native**：

```
data/aa/х.smali:570   А(Context,String,CharSequence,CharArrayBuffer)
        :612  取 AA 缓存目录
        :620  appendDir(buffer, cacheDirPath)
        :624  appendDir(buffer, uriString)          <- 直接往 char[] 里追加
        :628-660  CharSequence 两种写法分流：
                  StringBuilder -> getChars(...) 直接搬
                  其他          -> String.valueOf(...) 再 append
        :672  appendDir(buffer, ".jpg")

androidx/versionedparcelable/В.smali:26   A(CharArrayBuffer,String)   追加一个串
        :38-51  若 sizeCopied + len > data.length -> P(buffer, needed)  扩容
        :535     P(CharArrayBuffer,I)   扩容：newLen = max(needed, len*1.5 + 2)
        :560-568 arraycopy 保留已有内容

data/aa/P.smali:591  x([B,CharArrayBuffer,у)Z     把流封面写盘
        :627-635  native_open_fd(data, 0, sizeCopied, 0x241, false)
                  ^ 直接把 char[] 交给 native 打开 fd
        :644-648  native_set_fd + FileOutputStream   <- Java 侧只拿到 fd
        :691  恢复线程优先级（:616-622 曾降到 0xa）
```

| 观察 | 证据 | 含义 |
| --- | --- | --- |
| **`char[]` 扩容是 1.5 倍 + 2** | `androidx/versionedparcelable/В.smali:544-550` | 摊还 O(1) 追加，避免「每拼一段就 copy 一次」 |
| **native 接受 `char[]` 而非 String** | `audioplayer/jni/NativeUtils.smali:50`（`native_open_fd([CIIIZ)I`）| JNI 层免一次 Java 串→native 串的转换；当 `String` 太长或碎片化时仍能工作 |
| **另有一条 String 版** | `audioplayer/jni/NativeUtils.smali:53`（`native_open_fd_str(Ljava/lang/String;IZ)I`）| 即「短路径走 String 快路径 + 长路径走 char[] 兜底」的分工 |
| **写盘也走 char[]** | `data/aa/P.smali:635` 传 `data` 与 `sizeCopied` | 长 URI 的封面**从头到尾没进过 String** |

> **本条的可验证边界**：1025 里能确证的是「存在一套 char[] 化的长路径管线」以及
> 「流封面的写盘也走它」。**无法确证**的是「changelog 所说的 improvement 具体改了哪一行」
> —— 没有版本标记（同 §2.2 的困境）。故本条记为**有实现、但改进点不可逐行定位**。

---

## §3 未找到实现的条目及排查说明

> 排查方法：在 **`com/maxmpz` 全部 1808 个 smali**（19.83 M 字符）上做进程内全文扫描，
> 再对命中点回读；资源侧扫 `decoded/res/values/*.xml` 与 `res/xml/*.xml`（53 个）；
> 102x 条目另扫 `v1035/decoded/smali` + `smali_classes2`（4929 个 smali）与 `res/xml`（59 个）。

| # | 条目 | 结论 | 搜索范围（关键词 / 目录） |
| ---: | --- | --- | --- |
| 11 | improved very large lists (>20k items) scrolling performance | **未找到专属实现** | 关键词：`CursorWindow`、`setListHeight`、`chunk`、`page_size`、`MAX_ITEMS`、`0x4e20`、`0x2710`、`scrolling`。目录：`com/maxmpz/{list,widget,rest}`、`androidx`。**唯一交叉命中**是 `0x4e20`=20000（`rest/library/х.smali:23`）与 `0x2710`=10000（:28），但两处都只服务 reshuffle 判定，**无第二个消费者**（全库 `rest/library/х->A` 仅 2 处引用：`rest/library/х.smali:31` 写、`player/b0.smali:5641` 读）。滚动性能的实现若存在，应在 RenderThread/自绘 `PowerList` 的 draw 路径或 native，**Java 层无可指认改动** |
| 14 | fixed Repeat One in CUE | **未找到实现**（1025） | 关键词：`REPEAT_ONE`、`repeat_mode`、`repeatMode`、`is_cue`、`cue_offset`、`Repeat One`、`repeat`。目录：`com/maxmpz/{player,data,rest,scanner}`。CUE 侧只有数据层命中（`data/х.smali:1720-1728` 的 `is_cue` 维护、`folders.is_cue` 各类 JOIN），**没有任何 `is_cue` 与 repeat-mode 同时出现的代码点**。Repeat 模式枚举只以调试串形式出现（`player/l.smali:1172`、`com/maxmpz/widget/player/f1.smali:526` 的 `"repeatMode="`）。**该修复的落点在 native 播放循环**（CUE 子轨的 end-of-track 判定）。又：本条属 `changelog_989_2`，理论上应在 1025 内，故不是版本问题 |
| 19' | （`repeat mode improvements` 的**实质内容**）| **不重做**，但注明 | 该条已由 `poweramp-impl-idea11-repeat-wording.md` 覆盖**文案**层面。若读者要的是**行为**层面（Repeat One 在 CUE/队列的边界），§3-14 已说明为 native 边界 |
| 4' | （`optimizations for very large libraries` 的**量化证据**）| **部分未闭合** | 已指认 3 处（§2.2），但**没有任何一处带版本标记**，无法证明是 978 引入。要证实需 diff build-977 与 build-978 的 smali，**本机无 977 产物** |
| 13' | （`.oga, flac in .ogg/.oga` 的**新增性**）| **新/旧不可判** | 1025 中 `TYPE_OGG`("ogg") 与 `TYPE_OGA`("oga") **均已存在**（`data/у.smali:111-121`、`:577-583`）。changelog 说「support」，但产物无法区分「978 加」还是「早就有」。**同样的 `flac in .ogg` 语义（容器探测）在 native**，Java 侧只有 `:1547-1624` 的通用改判链 |
| 12' | （`improved FLAC metadata parsing` 的实质）| **硬边界** | FLAC 解析在 `TagReader.native_scan_file(J...)I`（`scanner/TagReader.smali:271`，**private native，无方法体**）。Java 侧仅 `В()`(:277-467) 做 fd-ashmem 能力探测。**Java 不可达** |

### 3.1 关于「强要求 3」的额外说明

以下三条**不是「找不到」，而是「按指令不做」**：#7/#24（多选拖动）、#15（Add to Playlist 模式）、#19（Repeat 文案），
均已在 §1-F 表格中给出已有的专文链接与 `poweramp-impl-index.md` 行号。**它们不计入 open_items。**

---

## §4 可借鉴 / 不建议照抄

### 4.1 可借鉴

| 机制 | 位置 | 借鉴点 |
| --- | --- | --- |
| **解析降级链 + 不丢条目** | §2.1 | 播放列表条目匹配失败时**保留 `folder_file_id IS NULL` 的行**并用临时表做二轮重绑，而不是删除。对任何「外部引用可能失效」的库设计都适用 |
| **两列计数器分离** | §2.3 | `played_times`（参与排序）/ `total_played_times`（展示）分列，**避免「按 X 排序」与「显示真实总数」互相污染**。代价是一次迁移（`data/х.smali:2636-2658`） |
| **重置操作的不动清单** | §2.4 | 「Reset Stats」的文案明确列出**不改**的三样（rating / 文件 / tag）。`reset_all_tracks_stats_warn` 与代码（`А:5853-5881` 只碰 3 列）**完全一致**——文案即契约 |
| **阈值按 SDK 分级** | §2.2 | 同一语义（「大列表」）在新旧系统给 20000/10000 两个值，而不是硬编码一个 |
| **伪 key 前缀绑定** | §2.7 | `_long_volume_shizuku_grant` 的下划线前缀 + `<页面id>#<key>` 拼法，让「授权状态行」和「功能开关行」靠**命名约定**绑定，无需额外注册表 |
| **两套 shortcut API 并行** | §2.5 | 现代 `ShortcutManager` 与老 `INSTALL_SHORTCUT` 广播**按 SDK + 厂商双重判定**（asus 在 SDK 26/27 走老路），而不是简单 `SDK>=26` |

### 4.2 不建议照抄

| 反模式 | 位置 | 问题 |
| --- | --- | --- |
| **同一偏好存储类分裂** | `prefs/В` vs `rest/library/у` | `no_reshuffle_for_large_lists` 在 `prefs/В:1785`，`hide_unknown_artist`/`stream_name_in_title` 在 `rest/library/у:1161/1169`。**同属「库」域却分居两处**，查找成本高（本文实测：先按 `у` 找 `no_reshuffle_for_large_lists` 是 0 命中） |
| **魔数 9 = `"settings/".length()`** | `preference/v1.smali:719`（载入）→ :721（消费）| 没有任何常量名。若路由前缀改动，此判定静默失效 |
| **枚举值与 UI 索引错位** | `mod_interpolation`（§1-E-21）| 数组 values = `0,1,2,4,8` 而 entries 有 5 项。二者靠**下标**对应，值本身**不是连号**，直接当索引用会错 |
| **「优化」条目无版本痕迹** | §2.2 全部 | 三处优化点都没有 `build`/`version` 字样，导致无法从产物反推「哪一版引入」。changelog 与代码**不可机读对齐** |
| **同一功能在 changelog 重复列示** | #7/#24、#8/#25 | `changelog_978_fp` 与 `fp1_changelog_content` 两区块内容重叠。做条目计数时**必须先去重**（本文 25 条去重后实为 **23 个独立功能**） |

---

## §5 证据索引

> 全部为 **B 制**（`路径:行号`）。路径前缀：build-1025 = `.rea-analysis/smali/smali/com/maxmpz/`，
> 资源 = `.rea-analysis/decoded/`；build-1035 = `.rea-analysis/v1035/decoded/`。
> 「行数」为文件总行数，供越界自检。

**作用域消歧规则（复验前必读）**：

| 本文写法 | 实际文件 | 说明 |
| --- | --- | --- |
| `preference/g2.smali` / `preference/c2.smali` / `preference/d2.smali` | `com/maxmpz/audioplayer/preference/*.smali` | 短类名（`g2`/`c2`/`d2`）在 `rest/library`、`widget/base`、`widget/list`、`widget/player` 里**重名存在**，必须带目录 |
| `player/b0.smali` / `list/n0.smali` / `widget/g.smali` | `com/maxmpz/audioplayer/{player,list,widget}/*` | 同上 |
| `rest/library/х.smali` / `rest/library/h3.smali` / `rest/library/d4.smali` / `rest/library/h1.smali` | `com/maxmpz/audioplayer/rest/library/` | 这 4 个短名同样跨包重名 |
| `data/А.smali` / `data/у.smali` / `data/х.smali` | `com/maxmpz/audioplayer/data/` | 注意 `data/х` 与 `rest/library/х` 是**两个不同文件** |
| `android/support/v4/media/session/К.smali` | `.rea-analysis/smali/smali/android/support/v4/media/session/К.smali`（6920 行）| 在 `com/maxmpz` **之外**，是本 App 打进去的 support 补丁类 |
| `res/xml/*.xml`、`res/values/*.xml` | `.rea-analysis/decoded/res/` | 存在 `xml-v22/`、`values-v26/`、`values-v31/` 等**同名片**；本文一律指**基础目录** |

> **版本域互斥实证**：本文引用的全部 app 类（`b0`/`А`/`х`/`n0`/`g2`/`c2`/`d2`/`j0`/`у`…）
> 在 `v1035/decoded/smali/com/maxmpz/` 下**均不存在同名文件**——1035 侧已改名为 `ׅ/` 体系。
> 因此「同名」只发生在**同一版本内部的跨包重名**，不会跨版本串味。

### 5.1 build-1025 smali（主证据）

| 文件（相对 `com/maxmpz/`） | 行数 | 本文引用行 |
| --- | ---: | --- |
| `audioplayer/preference/g2.smali` | 1104 | 477, 481, 487, 493, 498, 510 |
| `audioplayer/preference/c2.smali` | 246 | 54-133, 113, 117, 201, 207, 237-243 |
| `audioplayer/preference/d2.smali` | 132 | 36-60, 50, 52, 56, 58 |
| `audioplayer/preference/v1.smali` | 2190 | 540-854, 545, 549-551, 594-618, 675-681, 703-761, 721, 760 |
| `audioplayer/preference/k0.smali` | 4076 | 2397-2411 |
| `audioplayer/prefs/В.smali` | 1940 | 757-765 (`queue_start`), 767-773, 775-781, 1767-1783 (`mod_gain_mb`/`mod_separation`), 1785-1791 |
| `audioplayer/data/А.smali` | 7075 | 5828-5967, 5853, 5867, 5875, 5891-5942, 5944-5963 |
| `audioplayer/data/у.smali` | 870 | 111-121, 451-560, 555, 577-583 |
| `audioplayer/data/х.smali` | 2798 | 2636-2658, 2652 |
| `audioplayer/scanner/ScanDispatcherService.smali` | 826 | 256-354, 281, 288, 295, 302, 309, 316, 323, 328, 442-825, 498-538, 534-536 |
| `audioplayer/scanner/folder/H.smali` | 1154 | 54-468, 81, 87, 99-218, 111, 139, 202-212, 214-218, 470-1153, 479, 715-751, 806-820, 842, 948, 979, 1011, 1135 |
| `audioplayer/scanner/TagReader.smali` | 1826 | 271-274, 277-467, 290-300, 1547-1624, 1605, 1611-1617, 1633, 1673-1696, 1696, 1710, 1735, 1773, 1787, 1789, 1817-1824 |
| `audioplayer/scanner/TagAndMeta.smali` | 995 | 64 (`scannedFileType`) |
| `audioplayer/scanner/ModTagReader.smali` | 26 | 24 |
| `audioplayer/scanner/FFMpegTagReader.smali` | 29 | 24, 27 |
| `audioplayer/scanner/X.smali` | 3372 | 377-581, 698-1035, 1622-1998, 1718-1791, 1809-1990, 1866-1904, 1909-1945, 1953-1971, 2000-2776 |
| `audioplayer/scanner/х.smali` | 292 | 29-291, 51, 106-142, 155, 166, 210, 232, 243, 265 |
| `audioplayer/scanner/library/K.smali` | 5646 | 56-76, 85-91, 1086-1130 |
| `audioplayer/player/b0.smali` | 8856 | 7212-7433 (`onQueueUpdated`), 7275-7291, 2742-2763, 2751, 2798, 5627-5647, 5635, 5641, 5645 |
| `audioplayer/rest/library/х.smali` | 1367 | 10-34, 14-34, 17-31, 23, 28 |
| `audioplayer/rest/library/у.smali` | 1468 | 279-285, 343-357, 1161-1167, 1169-1175 |
| `audioplayer/rest/library/m3.smali` | 1114 | 62-114, 71, 88-98 |
| `audioplayer/rest/library/p0.smali` | 3319 | 876, 1537-1598, 1552-1565, 1573-1592, 1907-2702, 1960-2000 |
| `audioplayer/rest/library/b4.smali` | 1160 | 472, 545-578, 580-614, 616-662 |
| `audioplayer/rest/library/j3.smali` | 2293 | 986-1070, 1028-1036, 1030-1036, 1059-1063 |
| `audioplayer/list/n0.smali` | 9046 | 4130-7449 (`onBusMsg`), 5921-6081, 5921, 5925, 5971, 5981, 5987, 5993, 6007, 6013, 6029, 6063, 6065, 6075, 7443-7448 |
| `audioplayer/list/j0.smali` | 98 | 37-97, 82-86, 88-94 |
| `audioplayer/list/r.smali` | 220 | 208-216 |
| `audioplayer/widget/g.smali` | 445 | 30-241, 37-53, 41, 48, 53, 120-164, 158, 164, 179-224, 220, 246-436, 326, 358, 366-382, 386, 394, 434 |
| `audioplayer/dialogs/у.smali` | 1226 | 601-680, 613, 752-790, 755 |
| `audioplayer/data/aa/х.smali` | 3155 | 570-677, 620, 624, 628-660, 672, 968-1060, 2187-2415 |
| `audioplayer/data/aa/P.smali` | 3400 | 591-640, 616-622, 635, 644-648, 691 |
| `audioplayer/jni/NativeUtils.smali` | 71 | 50, 53 |
| `audioplayer/widget/musicfolders/MusicFoldersLayout.smali` | 2112 | 1365-1389, 1551-1573 |

**`com/maxmpz/widget/` 下的偏好宿主（build-1025，相对 `.rea-analysis/smali/smali/`）**：

| 文件 | 行数 | 引用行 | 用途 |
| --- | ---: | --- | --- |
| `com/maxmpz/widget/player/h0.smali` | 1619 | 1229-1237 | #6 `num_settings_tags`（默认 5）与 MRU 历史 `p0` |
| `com/maxmpz/widget/player/f1.smali` | 730 | 526 | #14 旁证：仅调试串 `repeatMode=` |

**非 `com/maxmpz` 的支撑类（build-1025，相对 `.rea-analysis/smali/smali/`）**：

| 文件 | 行数 | 引用行 | 用途 |
| --- | ---: | --- | --- |
| `androidx/versionedparcelable/В.smali` | 3362 | 26-65, 38-51, 535-578, 544-550, 560-568 | #20 char[] 追加与扩容 |
| `android/support/v4/media/session/К.smali` | 6920 | 4453, 4463 | #1 命令 id 分发 |

### 5.2 build-1025 资源

| 文件（相对 `.rea-analysis/decoded/`） | 引用点 | 用途 |
| --- | --- | --- |
| `res/xml/library.xml` | :4 `rescan_folders`, :5 `pref_pa_keeps_tracks_no_storages`, :6 `erase_and_rescan`, :27 `reset_stats` | #1/#16/#23 设置入口 |
| `res/xml/library_lists.xml` | :26 `hide_unknown_artist`（`w:featurePack="1"`）, :35 `stream_name_in_title` | #8/#18 |
| `res/xml/library_queue.xml` | :5 `queue_start`, :11 `queue_clear_on_add`, :12 `queue_never_clear_on_add`, :13 `queue_no_shuffle` | #3 |
| `res/xml/library_shuffle.xml` | :6 `no_reshuffle`, :7 `no_reshuffle_for_large_lists` | #5/#10 |
| `res/xml/library_scanner.xml` | :5-10 六个 `auto_scan` 家族键, :20 `process_cues` | #16/#23 |
| `res/values/arrays.xml` | :834-843 `pref_queue_start_entries/values`（Immediately=**1**）| #3 |
| `res/values/strings.xml` | `no_reshuffle_for_large_lists_msg`, `summary_hide_unknown_artist`, `summary_stream_name_in_title`, `reset_stats_q`, `reset_all_tracks_stats_warn`, `add_to_launcher`, `shortcut_plays_list`/`shortcut_opens_list` | 文案即契约，逐条比对 |
| `res/values/public.xml` | `cmd_list_add_to_launcher`=`0x7f0d050a`, `cmd_data_reset_track_stats`=`0x7f0d0509` | id 反查 |

### 5.3 build-1035（仅 §1-E 三条）

| 文件（**完整路径**，均以 `.rea-analysis/` 为根） | 引用行 | 用途 |
| --- | --- | --- |
| `v1035/decoded/res/xml/audio_tweaks.xml` | :16 | #21 键定义 |
| `v1035/decoded/res/xml/misc.xml` | :34 | #22 键定义 |
| `v1035/decoded/res/values/arrays.xml` | `pref_mod_interpolation_values` = 0/1/2/4/8 | #21 值域 |
| `v1035/decoded/smali/ׅ/vr.smali` | 3535-3566 | #21 偏好字段 `y2` |
| `v1035/decoded/smali/ׅ/z61.smali` | 4208-4241 | #21 设置页绑定 |
| `v1035/decoded/smali/ׅ/a91.smali` | 42-92 | #21 变更监听 |
| `v1035/decoded/smali/com/maxmpz/audioplayer/decoder/mod/ModPluginService.smali` | 56, 122 | #21 消费 |
| `v1035/decoded/smali/ׅ/sa1.smali` | 286, 332-467, 916-994, 951, 1002 | #22 |
| `v1035/decoded/smali/com/maxmpz/audioplayer/scanner/ScanDispatcherService.smali` | 488, 1301, 1375 | #23 入口 |
| `v1035/decoded/smali/ׅ/qt.smali` | 205-1290, 319-323, 338, 358, 614-646, 670, 740-793, 756, 797-866, 841 | #23 核心 |
| `v1035/decoded/smali/ׅ/nt.smali` | 223-303 | #23 结果类型（`toString` 自证字段名） |
| `v1035/decoded/smali/ׅ/x9.smali` | 15-49, 31, 39 | 大列表阈值（20000/10000）|
| `v1035/decoded/smali/ׅ/k01.smali` | 8452-8493 | 阈值消费（1035 版 `onQueueUpdated` 前身）|
| `v1035/decoded/smali/ׅ/yy.smali` | 141-511（`A(Intent,n41)`）、364-368（**唯一 path 写点**）、377（删 provider）、923-1113（`K` 通用 10 参、**无 path**）、942 | #23 写侧 |
| `v1035/decoded/smali/ׅ/n41.smali` | 7-17（6 个字段 `A`/`B`/`А`/`В`/`Х`/`х`）| #23 目标模型 |
| `v1035/decoded/smali/com/maxmpz/audioplayer/scanner/ScanDispatcherService.smali` | 969, 989 | #23 上游调用 |

### 5.4 复验命令

```powershell
# 逐条核验行号（以 #5「No Reshuffle For Large Lists」为例）
$f = '.rea-analysis/smali/smali/com/maxmpz/audioplayer/prefs/В.smali'
(Get-Content -LiteralPath $f -Encoding UTF8)[1784]   # 期望：const-string v1, "no_reshuffle_for_large_lists"
(Get-Content -LiteralPath $f -Encoding UTF8)[1790]   # 期望：sput-object v1, ...->n2:

# 核验阈值常量（应输出 0x4e20 / 0x2710）
Get-Content -LiteralPath '.rea-analysis/smali/smali/com/maxmpz/audioplayer/rest/library/х.smali' -Encoding UTF8 |
  Select-Object -Index 22,27

# 核验「无 path 形参」这一结论：10 参签名命中数应为 1（定义处）
Select-String -Path '.rea-analysis/smali/smali/com/maxmpz/audioplayer/scanner/ScanDispatcherService.smali' `
  -Pattern '\.method public static А\(Landroid/content/Context;Ljava/lang/String;ZZZZZZZZ\)V'
```

---

## §6 与既有文档的关系

| 文档 | 关系 |
| --- | --- |
| [poweramp-corpus-conventions.md](poweramp-corpus-conventions.md) | **引用规范与版本域**（必读）。本文全程 B 制，102x 三条跨到 1035 |
| [poweramp-impl-index.md](poweramp-impl-index.md) | #7/#24→idea 54、#15→idea 58、#19→idea 11 的来源 |
| [poweramp-plugin-system-index.md](poweramp-plugin-system-index.md) | 未直接引用；`mod_interpolation`（#21）经插件系统 `cmd_player_apply_internal_plugin_config` 下发，与该文的命令协议篇相关 |
| [poweramp-release-changelog.md](poweramp-release-changelog.md) | 本文的原始条目来源；其 §3 已交叉印证 #19 |
