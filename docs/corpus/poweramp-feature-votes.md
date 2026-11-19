---
doc_id: "ARCH-POWERAMP-FEATURE-VOTES"
title: "Poweramp 官方功能投票清单（未完成 46 项 + 已完成 8 项）"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "project"
revision: 3
open_items: 2
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 收录官方论坛 Ideas 区未完成与已完成全部投票项，并逆向已实现部分"
  - "user screenshot: /ideas/completed/ 页面（8 条已完成）"
  - "user hint: /ideas/category/6-cast-your-votes-for-new-poweramp-features/ （经核实与主列表为同一集合）"
  - "Wayback: ideas 列表 page1(2025-10-20)、page2(2025-08-04)；category/6 page2(2025-10-20)、?sortby=idea_views(2025-10-21)"
  - "Wayback: 官方索引主题 23541（2025-12-01）"
  - ".rea-analysis/decoded/（build-1025）与 .rea-analysis/v1035/decoded/（build-1035）"
  - ".rea-analysis/natives/libpowerampcore.so（TagLib SYLT 佐证）"
---

# Poweramp 官方功能投票清单

## 0. 数据来源与口径

| 项 | 说明 |
| --- | --- |
| 未完成 | **46 条 voting** |
| 已完成 | **8 条**（用户截图 `/ideas/completed/`） |
| 条目总数 | **50 条**（46 + 8 = 54 条目 id，其中 4 条已完成项在投票列表里已被移除） |
| 票数合计 | **3029 票** = 未完成 46 条 **2996** + 已完成中仍在列表的 4 条 **33** |

### 0.1 关于 `category/6` 的核实结论

用户提示的 `/ideas/category/6-cast-your-votes-for-new-poweramp-features/` 经取证后确认：
**它就是主列表页本身，不包含额外条目。**

| 证据 | 结果 |
| --- | --- |
| 列表页 50 条实体的 category 字段 | **全部**指向 `category/6`（50/50） |
| `category/6` 分页结构 | 仅 **2 页**（page1 + page2），各 25 条 = 50 条 |
| `category/6/page/2/` 的 25 条 | 与列表 page1+page2 的 id 集合**完全重合** |
| `category/7-poweramp-equalizer/` | Wayback 显示 **404**，该分类不存在 |
| `/ideas/?page=3` | **无快照**；page1+page2 已覆盖全部 50 条 |

> **结论**：分类页不是"更多条目"的来源，而是同一集合的另一种视图。
> 真正的第 3 个 source 是**不同时间的快照**——它让 16 条票数得到了更新，见 §0.2。

### 0.2 票数口径（多快照取最新）

四个快照交叉比对后发现 **16 条票数随时间变化**（均为上涨或微调）：

| 快照 | 时点 | 覆盖 |
| --- | --- | --- |
| 列表 page1 | 2025-10-20 | 25 条 |
| category/6 ?sortby=idea_views | **2025-10-21（最新）** | 25 条 |
| category/6 page/2 | 2025-10-20 | 25 条 |
| 列表 page2 | 2025-08-04（最旧） | 25 条 |

| idea | 旧值 → 新值 |
| ---: | --- |
| 11 | 38→39 |
| 12 | 42→44 |
| 15 | 138→143 |
| 17 | 28→30 |
| 18 | 95→94 |
| 19 | 135→140 |
| 25 | 71→75 |
| 27 | 23→25 |
| 29 | 111→115 |
| 30 | 131→144 |
| 32 | 64→70 |
| 35 | 52→53 |
| 41 | 34→35 |
| 42 | 77→85 |
| 44 | 70→78 |
| 56 | 47→54 |

> 注：idea 18 是**唯一下降**的（95→94），可能是取消投票。其余均为上涨。
> 本文所有票数已按"各 id 取最新快照"重新校准，故合计 3029 与任一单页快照的小计都不同。

---

## 1. 已完成（8 条）

| # | idea | 票 | 标题 | 实现情况 |
| ---: | ---: | ---: | --- | --- |
| 1 | 58 | **0** | Add to Playlist/Queue at Start or Shuffled | ✅ 1025（`m3` 洗牌 SQL） |
| 2 | 57 | **0** | Synced/Scrolling Lyrics from tags and LRC files | ✅ 1025（`data/lyrics` 包） |
| 3 | 55 | **15** | Consistently refer to "Player Screen" in Settings | ✅ 1025（资源层） |
| 4 | 54 | **18** | Multiple item dragging in Playlists/Queue | ✅ 1025（多选拖动） |
| 5 | 40 | **163** | 'No resample' mode (Output-matches-Source), USB-DACs/DAPs, aka USB Exclusive / Bit Perfect | ✅ **仅 1035**（`audio_bit_perfect.xml`） |
| 6 | 39 | **50** | Settings>Audio>Output submenu hierarchy and device recognition | ✅ **仅 1035**（`audio_outputs2.xml` 设备优先） |
| 7 | 15 | **143** | Customizable Player Screen Buttons | ✅ 1025（`player_screen_buttons`） |
| 8 | 11 | **39** | Simplify confusing wording of the Repeat Icon | ✅ 1025（`repeat` 文案） |

### 1.1 idea 58 —— 插入开头 / 洗牌插入

UI 三选一（`res/values/arrays.xml:432-446`）：
```xml
<integer-array name="playlist_insert_args1"><item>1</item><item>0</item><item>2</item></integer-array>
<array name="playlist_insert_icons_24dp">
    <item>?insert_top_24dp</item><item>?insert_bottom_24dp</item><item>?insert_shuffle_24dp</item></array>
<string-array name="playlist_insert_modes">
    <item>@string/insert_at_top</item><item>@string/insert_at_bottom</item><item>@string/shuffled</item></string-array>
```

| 参数 | 图标 | 文案 | 语义 |
| ---: | --- | --- | --- |
| **1** | `insert_top` | Insert at start | 插到开头 |
| **0** | `insert_bottom` | Add to end | 追加末尾 |
| **2** | `insert_shuffle` | Shuffled | 随机插入 |

核心实现在队列实体 `rest/library/m3`，用符号区分已播/未播段：

```smali
; m3.T0 @470 —— 已播段（played_at <= ?）→ 负值
"UPDATE queue SET shuffle_order=-ABS(MAX(-9223372036854775807, RANDOM()))  WHERE folder_file_id IN(
    SELECT _id FROM folder_files WHERE played_at<=?)"
; m3.U0 @478 —— 未播段（played_at > ?）→ 正值
"UPDATE queue SET shuffle_order=ABS(MAX(-9223372036854775807, RANDOM())) WHERE folder_file_id IN(
    SELECT _id FROM folder_files WHERE played_at>?)"
```

排序时（`m3.V0 @494`）：`у.C`(`queue_no_shuffle`) 为真 → `"queue.sort"`；否则 → `"queue.shuffle_order,queue.sort"`。

> **设计要点**：`shuffle_order` 的正负号是**语义位**——负数段永远排在正数段之前，
> 保证已播历史不被新插入的随机曲目打乱。`MAX(-9223372036854775807, RANDOM())` 还规避了
> `ABS(Long.MIN_VALUE)` 仍为负的溢出陷阱。

> **📄 逐条逆向专文**：idea 58 的完整实现见 `poweramp-impl-idea58-insert-position.md`
> （三态枚举定义、UI 两种入口、MsgBus 下发、批量插入算法、位次补偿）。

> **📄 逐条逆向专文**：idea 57 的完整实现见 `poweramp-impl-idea57-synced-lyrics.md`
> （LRC 正则、毫秒换算、四级候选链、两表缓存、四态滚动状态机）。

### 1.2 idea 57 —— 同步/滚动歌词

新增整个包 `com.maxmpz.audioplayer.data.lyrics`（13 类 / 4698 行）：

| 类 | 行 | 职责 |
| --- | ---: | --- |
| `х` | 1445 | 解析链调度器（`P`/`Н`/`Р`/`H`/`K` 五入口） |
| `A` | 1687 | 主 Chain（Kotlin inline 展开） |
| `y` | 419 | `LyricsChainArgs(fileId/_lyrics/_lyricsData)` |
| `А` | 247 | `LyricsResolveCtx(trackId/hasLyricsTag/cachedLyricsId/lyrics)` |
| `Н` | 226 | `LyricsSourcePlugin`（第三方 pak） |
| `B` | 141 | `Lyrics` 数据结构（`sync`/`lengthMs`/`offsetMs`） |
| `у` | 85 | `LyricsLineEntry(time, line)`，时间单位 **ms(int)** |
| `В` | 105 | 状态枚举 `DATA_LOADING`/`HAS_DATA`/`NO_DATA`/`NO_DATA_BUT_LOADING_PLUGIN` |
| `H`/`K`/`К` | 89×3 | 三种 `LyricsSource` 值对象 |

四级取词优先级（方法名即语义）：
```
resolveLyricsTag            ← 内嵌标签（ID3 SYLT / USLT）
resolveLrcFile              ← 同名 .lrc
resolveLrcFileStreamAndRaw  ← 流式 / 裸 LRC
resolveViaPlugin            ← 第三方歌词插件 pak
```

装配流程（`data/lyrics/A.smali:1237-1337`）：
```
TagReader.A(path, tagMask, 0x2000)  → native_scan_file 填 TagAndMeta
hasLyrics() 且 syncLyricsLines/Timestamps 非空且等长 ?
  → min(2000, len) 条循环构建 LyricsLineEntry
  → size > 1 时 Comparator 排序（CollectionsKt.o）
  → 写入 cached_lyrics 表（х.P）
```

> 上限 `0x7d0` = **2000 行**。

**native 佐证**（`libpowerampcore.so`）：TagLib ID3v2 同步歌词帧符号齐全——
`...ID3v223SynchronizedLyricsFrame11SynchedTextEEE`（@440664）、
`...UnsynchronizedLyricsFrameE`（@469555）、`"SYLT"`（@315101）。
⇒ **文本解析在 native（TagLib），Java 侧只做取用/排序/缓存/渲染**。

> **📄 逐条逆向专文**：idea 40 的完整实现见 `poweramp-impl-idea40-bit-perfect.md`
> （能力位掩码协议、设备类型枚举、四开关逐级收紧关系）。

### 1.3 idea 40 —— Bit Perfect（**仅 1035**）

build-1025 产物里**完全没有** `bit_perfect` / `usb_exclusive`；1035 才有 `res/xml/audio_bit_perfect.xml`（19 行）。

| 设置项 | key | 语义 |
| --- | --- | --- |
| 64-bit Audio Pipeline | `global_pipeline64` | Float64 管线 |
| Follow Track Sample Rate | `global_follow_sr` | 自动匹配源采样率 |
| DSD Remaster | `global_dsd_remaster` | DSD 重制 |
| Perfect Bit Perfect | `global_perfect_bit_perfect` | 严格位精确 |

页面提示：*"Each setting on this page can also be overridden individually for the specific output or profile"*
——**全局默认 + 按设备/配置覆盖**两层结构。

> **📄 逐条逆向专文**：idea 39 的完整实现见 `poweramp-impl-idea39-device-first-output.md`
> （结构反转对比、`?device=&profileName=` 寻址、11558 行 helper 职责）。

### 1.4 idea 39 —— 输出菜单改为设备优先（**仅 1035**）

**1025** `audio_outputs.xml`（8 行，插件优先）：
```xml
<PreferenceCategory android:title="@string/pref_output_plugins" android:key="output_plugins_list" />
<RawTextPreference android:key="output_unassigned_text" />
```

**1035** `audio_outputs2.xml`（16 行，设备优先）：
```xml
<ButtonPref android:key="output_headset"    android:title="@string/device_headset"    android:icon="@drawable/wired_24dp" />
<ButtonPref android:key="output_speaker"    android:title="@string/device_speaker"    android:icon="@drawable/speaker_24dp" />
<ButtonPref android:key="output_bt"         android:title="@string/device_bt"         android:icon="@drawable/bt_24dp" />
<ButtonPref android:key="output_usb"        android:title="@string/device_usb"        android:icon="@drawable/usb_24dp" />
<ButtonPref android:key="output_chromecast" android:title="@string/device_chromecast" android:icon="@drawable/chromecast_24dp" />
<ButtonPref android:key="output_other"      android:title="@string/device_other"      android:icon="@drawable/other_24dp" />
```

| key | 文案 |
| --- | --- |
| `output_headset` | Wired Headset/AUX |
| `output_speaker` | Speaker |
| `output_bt` | Bluetooth |
| `output_usb` | USB DAC |
| `output_chromecast` | Chromecast |
| `output_other` | Other Output Devices |

> **正是投票需求的逐字实现**：原文要求"先看到物理设备列表，再在设备下层选音频方式"。
> 1035 把原来的 `output_plugins_list` 分类**替换成 6 个设备按钮**，新增 `audio_outputs_tweaks` 承接原插件级选项。

> **📄 逐条逆向专文**：idea 55 的完整验证见 `poweramp-impl-idea55-player-screen.md`
> （旧术语清零统计、8 条旧键名保留、简中三种译法不一致、繁中/孟加拉残留）。

### 1.5 idea 55 —— 术语统一为 "Player Screen"

纯资源层，**无代码逻辑**。旧键名保留、显示值统一：

| 资源键（旧名保留） | 当前值 |
| --- | --- |
| `pref_player_ui` | **Player Screen** |
| `pref_main_screen` | **Player Screen** |
| `pref_main_screen_button` | Player Screen Button |
| `applied_on_main_screen` | Applied on the Player Screen |

全 `strings.xml` 提及 "Player Screen" 共 **22 条**。

> **可借鉴**：键名保留历史（仍叫 `pref_main_screen`），只统一**显示值**——不破坏偏好存储兼容性。

> **📄 逐条逆向专文**：idea 15 的完整实现见 `poweramp-impl-idea15-custom-buttons.md`
> （10 个偏好键、横竖屏各一套、编辑入口时序、恢复默认）。

### 1.6 idea 15 —— 可自定义播放界面按钮

| 资源键 | 英文 |
| --- | --- |
| `player_screen_buttons` | Player Screen Buttons |
| `edit_player_screen_buttons` | Edit Player Screen Buttons |
| `player_screen_buttons_desc` | Player screen buttons appear as an optionally scrollable row below the track cover |
| `restore_player_buttons` | Restore Player Screen Buttons |

投票原文本是"编辑封面下 4 个图标（Viz/Sleep/Repeat/Shuffle）"，实现上扩展为**可滚动按钮行**。

> **📄 逐条逆向专文**：idea 11 的完整验证见 `poweramp-impl-idea11-repeat-wording.md`
> （六态模式表、七组平行数组、旧措辞全语言清零、changelog_1003 一手证据）。

### 1.7 idea 11 —— Repeat 图标文案简化

投票建议改为 *"Play One Song | Play Category | Play All Categories | Repeat Song | Repeat Category | Repeat All Categories"*，
替代含 "Advance Category" 的旧措辞。当前 `repeat` = **"Repeat"**，`repeat_*` 系列已无 "Advance Category"。

> **📄 逐条逆向专文**：idea 54 的完整实现见 `poweramp-impl-idea54-multi-drag.md`
> （自研拖拽框架、多选判定、行号收集算法、单/多行同一助手）。

### 1.8 idea 54 —— 多选批量上下移动

落点为多选工具栏 + `queue.sort` / `playlist_entries` 序号重排。
仅确认多选操作与可重排序号列存在，**具体移动算法未逐行展开**（§3 Q2）。

---

## 2. 未完成（46 条）

### 2.1 Player Screen 界面元素（11 条）

| idea | 票 | 需求 |
| ---: | ---: | --- |
| 9 | **156** | User-defined Title and Artist/Album text fields (customise the two lines of information in lists and Player screen using %tagname% formatting). Also a |
| 14 | **146** | Add an icon to indicate if the source file is high-resolution - e.g. no icon under 88k, 88k to 192k as high-res, and above 192k as very high res. Dim  |
| 15 | **143** | Customise swipe/tap gestures on cover artwork, plus allow editing the functionality of the four icons below the cover area: Viz/Sleep/Repeat/Shuffle |
| 13 | **72** | Add option for the metadata line to display the current Category - e.g. "Playlist: <playlist title>", "Album: <album name>", etc. |
| 56 | **54** | Option for the Android 'Back' button to always go back to the previously viewed screen, only acting as a library navigation tool if that's where you p |
| 12 | **44** | Add extra increments to Sleep Timer and a more gentle fade-at-end feature, and include an activity-based reset (e.g. go to sleep 15 minutes after ther |
| 10 | **43** | A-B Repeat, including the ability to (optionally) include an out-point in Bookmarked songs so a repeat cycle can be revisited later. |
| 11 | **39** | Improve wording of the Repeat button to avoid confusing terms like 'Advance Category', thus: Play One Song | Play Category | Play All Categories | Rep |
| 59 | **35** | Support adaptive text colouring or drop shadows, so text without a background box remains visible against any adaptive background colours. |
| 17 | **30** | Provide tickboxes in the Save/Assign feature in the Equalizer screen to specify which items to store in the preset - EQ, Tone, Preamp, Balance, Tempo, |
| 16 | **29** | Add an optional layout for larger horizontal screens featuring the player interface and controls on one side, and the Library song list on the other. |

### 2.2 核心功能（25 条）

| idea | 票 | 需求 |
| ---: | ---: | --- |
| 30 | **144** | Smart / Dynamic Playlists (support for wildcards in folder/filenames in M3U playlists, auto-filtering, and updating of lists ' on the fly' by pre-defi |
| 19 | **140** | 'Now Playing' list view, showing a flat scrollable list of the history of what has been played so far, and upcoming planned tracks (not editable, but  |
| 31 | **137** | Statistics via a Library item (total songs/albums/artists with durations, overall play count this week/month, etc) |
| 29 | **115** | Include separator breaks (sub-headers) in appropriate list layouts, such as Disc# breaks within Album lists, Year headers when sorted By Year, and "To |
| 18 | **94** | Allow editing of embedded Lyric data via the Info/Tags Editor. Also support auto-display of Lyrics (if present) on the main Player Screen - e.g. overl |
| 20 | **83** | Allow changing the order of master Category items for the top-level Library view (using thumb sliders to move items up and down in the List Options me |
| 38 | **83** | 'Favourites' Library Category, where you would be able to add your own selections either as individual songs or Category items (such as a folder, an a |
| 28 | **78** | In the Info/Tags screen, list any Playlists for which the current song is a member. Allow tapping on a Playlist name to go straight to the relevant vi |
| 25 | **75** | Support BPM (Beats Per Minute) tag, and allow it to be used as a sorting method. |
| 32 | **70** | Support for reading and sorting yyyy-mm-dd dates instead of just Year. Should apply to long-format TYER tags, but also need to check if TDAT is presen |
| 23 | **69** | More category sorting options, such as Genres>Artists>Albums>songs or Artists>Albums-by-Year>songs-by-Track#. Also for Playlists/Queue, Re-Sort by pat |
| 37 | **58** | 'Queue Only' mode, where playback occurs only as songs are added into the Queue, and there is no return back to a "complete-Library" system based on l |
| 35 | **53** | Provide a tickbox to assign manually downloaded cover artwork to the current track only, not only to the whole album. |
| 39 | **43** | Improve the usability of the Settings=>Audio=>Output menu, so you first see a list of physical devices (Speaker, Wired Headset/AUX, USB DAC, Bluetooth |
| 36 | **34** | Writing selected Cover Artwork back into files as embedded data |
| 61 | **33** | Read more tag items into database - e.g. Conductor, Orchestra, Soloist, sort-order strings, etc. Ties in with request to customise the Title and Artis |
| 24 | **31** | List Options tickbox for 'smart' sorting of any alphanumeric fields - e.g. human-style sorting of long numbers (1,2,3,10,11,12,100,101,102), improved  |
| 34 | **28** | Reading/writing of Rating information (e.g. POPM tags) in physical audio files rather than only maintaining a local database . (Note: third-party app  |
| 60 | **27** | Implement ratings system for Categories, so you can star-rate or Thumb-rate Albums, Folders, Artists, Genres, Playlists, etc. Add sorting option 'By R |
| 27 | **25** | Show the 'Unknown' category entries ("Unknown Album", "Unknown Genre", etc) at the end of each Category list, as an appendix-style entry, rather than  |
| 21 | **20** | Provide extra choices for the 'Play' and 'Shuffle' icons at the top of lists (via long-press). e.g. Play could also offer Play One Album or Repeat One |
| 26 | **20** | In the Library>Playlists view, add a 'List Options' choice to hide filename extenders (.M3U, .PLS, etc), instead using a small ‘file’ icon to distingu |
| 22 | **14** | Make the 'Play' and 'Shuffle' icons at the top of lists respect the user's choice of 'List Item Click Action', for example opening the Player Screen w |
| 62 | **13** | View or Edit tags for multiple selected songs at the same time via the Info/Tags screen (e.g. to update the Album Artist tag for all songs in one albu |
| 33 | **10** | Add user-definable Article wording (e.g. support for users to ignore "The", "An", "A" in their own languages). |

### 2.3 音频功能（10 条）

| idea | 票 | 需求 |
| ---: | ---: | --- |
| 40 | **163** | 'No Resample' mode (sometimes misnamed as "bit perfect") where the output is adjusted automatically to match each source file's frequency. |
| 43 | **88** | Dynamic Normalise feature (to automatically raise and lower the volume on-the-fly as songs play - not just a per-track gain adjustment like the existi |
| 42 | **85** | Replay Gain scanning of Library content directly from within Poweramp, rather than requiring files to be pre-tagged. |
| 44 | **78** | Segue / "Radio" Crossfade option (to prevent crossfades occurring which fade across abrupt endings or hard-starts of songs). Also increase available l |
| 49 | **72** | Library access to local sources (e.g. playback of songs from home DLNA or NAS servers, SMB/FTP access, Jellyfin, Plex, etc). |
| 50 | **69** | Playback of users' cloud-stored content (e.g. playing your music from Google Drive, Dropbox, or other online locations). |
| 46 | **53** | Add a 'Smart' option in Replay Gain menu, so Album Gain is automatically applied when listening to Albums, but Track Gain is used when listening to Al |
| 45 | **40** | DSP support for Crossfeed (partially mix left and right channels to reduce very wide soundstage panning of stereo images). Include option to completel |
| 41 | **35** | Pitch changing in addition to the current Tempo feature (e.g. for 432Hz re-tuning). |
| 47 | **25** | Output to other products (DLNA or UPnP devices, smart speakers such as Sonos, etc). |

---

> **版本依据**：本文 §1 的"仅 1035 实现"结论，可在 `poweramp-release-changelog.md` 的
> `changelog_102x`（Builds 1026–1032）找到官方原文——Bit Perfect 与设备优先输出正是该版本引入。

## 3. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | `/ideas/completed/` 无存档，8 条之外是否还有已完成项 | 截图可见 8 条，页面有 SORT BY 但无分页证据 |
| Q2 | idea 54 多选批量移动的具体算法 | 只确认多选操作与 `queue.sort` 列，未逐行展开 |
| Q3 | idea 15 自定义按钮是否有数量上限 | 只见"可滚动行"描述，未追上限 |

---

## 4. 证据索引

| 主题 | 位置 |
| --- | --- |
| 已完成 8 条 | 用户提供的 `/ideas/completed/` 截图 |
| 未完成 46 条 | Wayback 列表 page1(2025-10-20)/page2(2025-08-04) + category/6 page2(2025-10-20) + ?sortby=idea_views(2025-10-21) |
| 分类归属核实 | 四快照 50 条 id 集合一致；`category/7` 为 404 |
| 插入位置三选一 | `res/values/arrays.xml:432-446` |
| 洗牌插入 SQL | `rest/library/m3.smali:470-511` |
| Bit Perfect 页 | **`v1035/decoded/res/xml/audio_bit_perfect.xml`**（19 行） |
| 设备优先输出页 | **`v1035/decoded/res/xml/audio_outputs2.xml`**（16 行） vs `1025/audio_outputs.xml`（8 行） |
| 歌词解析骨架 | `scanner/TagAndMeta.smali:66-68`、`data/lyrics/A.smali:1237-1337` |
| 歌词四入口 | `data/lyrics/х.smali:6/96/282/382/479` |
| native SYLT 佐证 | `libpowerampcore.so` @315101 / @440664 / @469395 / @469555 |
| 术语统一 | `res/values/strings.xml`（22 条含 "Player Screen"） |

> 票数为多快照取最新值。合计 **3029** = 未完成 46 条 2996 + 已完成中仍在列表的 4 条（idea 55/54/58/57）33。
> 另 4 条已完成项（40/39/15/11）**已从投票列表移除**，其票数取自 completed 截图：163/50/143/39。
