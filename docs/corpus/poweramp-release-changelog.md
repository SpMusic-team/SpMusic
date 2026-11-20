---
doc_id: "ARCH-POWERAMP-RELEASE-CHANGELOG"
title: "Poweramp 版本更新记录（build 971–103x，含设置深链与逆向入口）"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 3
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 记录 /files/category/2-poweramp-v3-latest-releases/ 每个版本的更新内容，为逆向做准备"
  - ".rea-analysis/v1035/decoded/res/values/strings.xml（changelog_102x / changelog_103x 等 15 条）"
  - ".rea-analysis/decoded/res/values/strings.xml（build-1025 的 14 条，用于版本对照）"
  - "Wayback: /files/category/2-poweramp-v3-latest-releases/ (2025-08-23)、/files/ (2025-10-21)"
---

# Poweramp 版本更新记录（build 971 – 103x）

## 0. 数据来源：为什么用 APK 而不是论坛

| 来源 | 可获取性 | 结论 |
| --- | --- | --- |
| 论坛 `/files/category/2-poweramp-v3-latest-releases/` | **直连 Cloudflare 403** | 不可直接抓取 |
| Wayback 存档（2025-08-23） | 可读，但**只有文件条目列表**（build 838–1000 的 APK 下载项） | **无更新正文** |
| **APK 内 `changelog_*` 资源** | **完整可读** | ✅ **本文的权威来源** |

> 关键发现：**Poweramp 把每个版本的更新正文编译进了 APK 自身**，即 `res/values/strings.xml` 里的
> `changelog_<版本号>` 系列字符串（如 `changelog_102x`），并由「关于 → 更新日志」页渲染。
> 所以论坛文件页只是**下载入口**，真正的更新内容在 APK 里，而且**带设置深链**。

### 0.1 两版 APK 的 changelog 差异

| 资源 | build-1025 | build-1035 |
| --- | --- | --- |
| `changelog_971` ~ `changelog_1003` | 9 条 | 9 条（`changelog_1003` 内容略短：2514→2448） |
| `changelog_102x` | **无** | ✅ **5306 字符**（最大单条） |
| `changelog_103x` | **无** | ✅ 826 字符 |

⇒ **build-1025 的更新日志止于 1002-10xx，1035 才补上 102x/103x 两段**。
这也印证了上一份文档的结论：Bit Perfect / 设备优先输出是 **1026+ 才落地**的功能。

> **渲染入口**：这些字符串由「设置 → 关于 → Version/Changelog」（`general.xml` 的 `about_version` 项）
> 打开后展示；`fp1_changelog_content` 则用于 Feature Package #1 的说明页。

### 0.2 论坛文件页能看到的版本列表（存档）

Wayback 2025-08-23 的 `/files/category/2-...` 共 **25 个文件条目**：

```
build 838, 841, 853, 860, 866, 871, 874, 882, 884, 893, 905, 911, 921, 925,
      933, 939, 945, 957, 970, 976, 988, 991, 996, 999, 1000
```

> 注意此存档**早于** 1026+，所以不含 Bit Perfect 版本；这也是为什么要以 APK 内 changelog 为准。

---

## 1. 逐版本更新正文

### Builds 971–977

> 资源键：`changelog_971`（617 字符）

```
" <b>Builds 971-977:</b> <ul> <li>prev./next category actions for <a href=settings/ui_mediaactions>Media Buttons</a> <li>AutoEq presets/devices database update <li>visualization latency is now also applied to lyrics for a better time synchronization <li>new <a href=settings/misc#op_framerate>Apply OP High Framerate</a> option<br> <small>For Oppo/OnePlus/Nothing phone devices</small> <li>added support for Spinorama txt presets importing <li>bug fixes and stability improvements <li>updated translations - huge thanks to all Crowdin translators! </ul> <br> "
```

### Builds 978 附加项（Also）

> 资源键：`changelog_978`（2095 字符）

```
" <b>Also:</b> <ul> <li>cosmetic <a href=settings/feature_packages#buy_uber_badges>Uberpatron badges</a> <li>support for MOD, IT, S3M, XM, MPTM tracker formats via libopenmpt <li>support for xHE-AAC format via device codecs <li>support for the predictive back animation on Android 14+ <li>new <a href=settings/library#reset_stats>Reset Stats</a> option in Info/Tags dialog<br> <li>changes to <a href=settings/ui_theme#alt_layout>Full Cover, Centered</a> skin options - more room for labels <li>new Visualizations/<a href=settings/vis#vis_ignore_touch_faded>Ignore Touch</a> option <li>new <a href=settings/aa_bg#aa_bg_gradient>Background Gradient</a>, <a href=settings/aa_bg#aa_bg_gradient_color>Background Gradient Color</a>, <a href=settings/aa_bg#aa_bg_gradient_for_list>Background Gradient For Lists</a> options <li>new option in header menu/Add to Launcher for all categories <li>new <a href=settings/headset#ignore_bt_sec>Ignore Bluetooth Commands</a> option<br> <small>Helps ignoring unwanted commands from headunits/BT devices immediately after a connection</small> <li>new <a href=settings/headset#bt_ignore_repeat_shuffle>Ignore Repeat/Shuffle</a> option<br> <small>Disables processing for BT Repeat/Shuffle commands</small> <li>Queue is now reloaded immediately for <a href=settings/library_queue#queue_clear_on_add>Always Clear On Add</a> + <a href=settings/library_queue#queue_start>Start Playing Queue</a>: Immediately options <li>settings search history <li>optimizations for very large libraries (e.g. 50k+ tracks) <li>new option <a href=settings/library_shuffle#no_reshuffle_for_large_lists>No Reshuffle For Large Lists</a> <li>AutoEq presets/devices database update <li>new <a href=settings/ui#num_settings_tags>Settings Shortcuts in Main Menu</a> option <li>new <a href=settings/ui_lyrics#lyrics_keep_screen>Keep screen on</a> for the lyrics option <li>hex color support in color dialogs </ul><br> "
```

### Builds 978–988（Feature Package 引入）

> 资源键：`changelog_978_fp`（1344 字符）

```
" <b>Builds 978-988:</b> <ul> <li>introducing 🎁 <a href=settings/feature_packages>Feature Packages</a>: <small><ul> <li>the number of big and small features (user requested/voted on Poweramp forum) packed together into low priced in-app purchase <li>a few packages per year <li>new features added to the same package with the each new build <li>new Full Version purchase includes feature package discount <li>this helps with Poweramp app continued development </ul></small> </ul><small><br></small> 🎁 <a href=settings/feature_packages>Feature package #1</a>: <ul> <li>support for multiple items dragging in playlists and Queue<br> <small>Multiple checked items are dragged as a group</small> <li>new <a href=settings/ui_player#line2_click>Line2 Press</a> and <a href=settings/ui_player#line2_click>Line2 Long Press</a> options <li>new <a href=settings/library_lists#hide_unknown_artist>Hide Unknown Artist</a> option<br> <small>Unknown Artist is hidden from track labels in Poweramp UI as possible</small> <li>new <a href=settings/ui#anim_speed>Animations</a> option<br> <small>Navigation animations now can be faster or disabled</small> <li>more features for this package in the next builds </ul> <br> "
```

### Builds 989–991

> 资源键：`changelog_989`（1707 字符）

```
" <b>Builds 989-991:</b> <ul> <li>new <a href=settings/vis#vis_fs_hide_bars>Hide System Bars For Full Screen</a> option<br> <small>🎁 Feature Pack #1</small> <li>new <a href=settings/ui_player#menu_button_long_press>Menu Button Long Press</a> option<br> <small>🎁 Feature Pack #1</small> <li>new cast option: <a href=settings/audio_output_device_opts?device=chromecast&uniqName=com.maxmpz.audioplayer/output.cc#cc_show_meta>Show Meta Information</a> <li>Info/Tags now shows total played count, including playbacks from the count-based or count-sorted categories<br> <small>As previously, the track sorting or standing within such categories is not changed by playback from these</small> <li>added workaround to support DVC on the specific Android 15 firmwares (Pixel 9 series, Samsungs S25) via <a href=settings/audio_dvc#compensate_dvc_vol>Compensate DVC Volume</a> option <li>Poweramp now can indicate inability to detect Absolute Volume<br><small><ul> <li>on some Android 15 devices it's not possible to detect Absolute Volume. Poweramp now assumes Absolute Volume is enabled and disables DVC when <a href=settings/audio_dvc#no_dvc_bt_absvol>No DVC for Bluetooth Absolute Volume</a> option is checked <li>please uncheck this option if you know Absolute Volume is disabled on your device <li>DVC settings page changed to describe the DVC+Absolute Volume functionality better </ul></small> <li>Android 15 restricts access to BT codec information - app won't be always able to show the codec, but still tries to show sample rate/bits <li>Google Cast for Audio (GC4A) 2.0 support </ul> "
```

### Builds 989–991 附加项（Also）

> 资源键：`changelog_989_2`（917 字符）

```
<ul> <b>Also:</b> <li>improved reshuffle for the large (>10k) lists <li>improved very large lists (>20k items) scrolling performance <li>improved mod files scanning performance <li>improved FLAC metadata parsing <li>increased number of Sleep timer possible values <li>audio routing detection code revamp<br> <small>Improved Poweramp detection of the complicated routing changes such as between multiple BT devices</small> <li>improved tag handling of the files with the incorrect extensions (such as a mp4 file with the mp3 extension) <li>.oga, flac in .ogg/.oga support <li>fixed Repeat One in CUE <li>other small changes for Android 15 <li>Target SDK updated to 35 <li>simplified Full Version unlocking via in-app purchase for Play<br> <small>Unlocker app continues to be available on Play for those who previously purchased it</small> </ul> <br>
```

### Builds 992–996

> 资源键：`changelog_992`（2011 字符）

```
" <b>Builds 992-996:</b> <ul> <li>Add to Playlist dialog improvements via selectable modes: <small><ul> <li>Add to single playlist – quickly add songs with a single click to one playlist (duplicates are possible if enabled in Settings) <li>Add – add songs to one or multiple playlists (duplicates are possible if enabled)</li> <li>Toggle – applicable to a single song only. Quickly overview if a song is in playlists and toggle the song in and out (no duplicates)</li> <li>Modes are stored per the selection type – for the single or multiple tracks</li> </ul></small> <li>if file access is removed by the user (via (i)->Storage & cache->Clear access) or by Android (via Manage app if unused), Poweramp now keeps the Library entries intact <small><ul> <li>previously, a normal scan removed inaccessible entries from the Library <li>Full Rescan still removes all inaccessible entries from the Library <li>Poweramp now suggests restoring the missing permissions <li>It's recommended to disable Manage app if unused option for Poweramp as it may suddenly remove the access to files, even if the app is actively used (for example, due to some firmware update) </ul></small> <li><a href=settings/ui#settings_font>Bold+ font</a> for Settings <li>implemented Audio Focus <a href=settings/audio_focus#af_short_duck>Duck Volume</a> for the AAudio output <li>improved resuming and pausing after an audio focus change/call for some devices/firmwares <li>improved audio output detection when voice assistant (Gemini) is used <li>improved <a href=settings/headset#resume_on_bt>Resume on Bluetooth</a> for some devices/firmwares <li>new <a href=settings/headset#beep_more>Beep More</a> option <li>improved compatibility with the old 3rd party skins <li>improved sleep timer <li>improved Bluetooth double/triple button presses for some devices/firmwares <li>updated translations </ul> <br> "
```

### Builds 997–999

> 资源键：`changelog_997`（1375 字符）

```
" <b>Builds 997-999:</b> <ul> <li>16kb page size support<br> <small>Google Play requirement</small> <li>battery, CPU usage, app size optimizations <li>Poweramp may now detect remote-submix (for example, Android Auto) as Other output type <li>enabled <a href=settings/audio_output?uniqName=com.maxmpz.audioplayer/output.athd>Hi-Res output</a> for Android 15+ devices <small><ul> <li>useful for the subset of Android 15+ devices which do not support Hi-Res via AAudio <li><a href=settings/audio_output?uniqName=com.maxmpz.audioplayer/output.aa>AAudio output</a> is recommended for the devices where Hi-Res works with AAudio </ul></small> <li>updated WavPack decoder <li>AutoEq presets/devices database update<br> <small>15199 presets updated</small> <li>new <a href=settings/headset#follow_pl_exact>Strict Resume/Pause/Stop</a> option<br> <small>Use for headunits/devices generating stray play/pause/stop key press commands, which are interpreted as undesired playback toggle or double press</small> <li>improved playlist entries resolution<br> <small>Entries now matched against greater range of sub-paths, and just by filename - in playlist parent folder when appropriate</small> <li>bug fixes and stability improvements <li>updated translations </ul> <br> "
```

### Builds 1000–1001

> 资源键：`changelog_1000`（825 字符）

```
" <b>Builds 1000-1001:</b> <ul> <li>🎂the milestone 1000th build of Poweramp, celebrating 15 years of continuous development and support <li>default No DVC and No Headroom options for Other output (used for the wired Android Auto connection) <li>improved <a href=settings/headset#follow_pl_exact>Strict Resume/Pause/Stop</a> option<br> <small>Better handling of connections that rapidly send play/pause/stop commands</small> <li>Poweramp suggests disabling Manage App If Unused option if detected<br> <small>As reported by out users, this setting may revoke file access not only after 60 days of inactivity but also after firmware updates, date changes, and other unexpected events</small> <li>bug fixes and stability improvements <li>updated translations </ul> <br> "
```

### Builds 1002–10xx

> 资源键：`changelog_1003`（2448 字符）

```
" <b>Builds 1002-1025:</b> <ul> <li>bug fixes and stability improvements <li>customizable buttons row on the player screen<br> <small><ul> <li>included in 🎁 Feature Pack #1 <li>✅ the top voted feature from the <a href=https://forum.powerampapp.com/ideas/?mode=popular>New Poweramp Features</a> list <li>long press between buttons to enter edit mode or start it <a href=settings/ui_player#edit_player_screen_buttons>from the settings</a> <li>20+ buttons, such as track menu and track actions, cast, audio info, etc. are available <li>the classic centered layout - buttons will try to fit around the centered slot <li>the plain layout - buttons placed in a compact row <li>normal or small button sizes are available <li>one row or two rows <li>buttons can be scrolled <li>buttons and layout settings are independent for portrait and landscape due to the varying available space in these orientations <li><a href=settings/ui_player#sub_aa_buttons_no_gap>Prefer No Gap</a> option <li><a href=settings/ui_player#sub_aa_buttons_no_lp_edit>Do Not Edit On Long Press</a> option </ul></small> <li>new <a href=settings/ui_theme#player_buttons_bg>Player Buttons Background</a> option for the built-in skins <li>the skin option <a href=settings/ui_theme#labels_bg>Label Background</a> doesn't change screen background anymore <li>new <a href=settings/audio_focus#resume_on_focus>Resume On Focus</a> option <li>new <a href=settings/library_lists#stream_name_in_title>Stream Name In Title</a> option <li>new <a href=settings/ui_player#anim_long_labels_in_lists>Animate Long Labels Everywhere</a> option <li>new Dark Skin <a href=settings/ui_player#anim_long_labels_in_lists>Transparent Status Bar</a> option <li>repeat mode improvements <small><ul> <li>✅ another voted feature from the New Poweramp Features list <li>added new Play All Categories mode, which plays all categories and stops <li>added hints to shuffle/repeat popups <li>updated wording for repeat modes/hints </ul></small> <li>AutoEq presets/devices database update<br> <small>17703 presets updated</small> <li>improved album art handling for streams with very long uris <li>workaround for the headset/headunit/BT key presses intercepted and modified by Gemini <li>updated translations </ul> <br> "
```

### Builds 1026–1032（音频引擎大版本）

> 资源键：`changelog_102x`（5306 字符）

```
" <b>Builds 1026-1032:</b> <ul> <li><b>major Audio Engine update:</b> <ul> <li>✅ the top voted feature from the <a href=https://forum.powerampapp.com/ideas/?mode=popular>New Poweramp Features</a> list <li><b>USB Exclusive Driver</b>: direct access to the attached USB DAC bypassing Android audio, supporting PCM 44.1-768kHz, DSD64-1024 DoP/Raw, and hardware volume control <li><b><a href=settings/audio_bit_perfect>Bit Perfect Modes</a></b> - intended for DAPs/USB DACs; supported for Hi-Res, USB Exclusive, and partially AAudio <ul> <li><b><a href=settings/audio_bit_perfect#global_follow_sr>Follow Track</a></b>: dynamically reconfigures to match the track's sample rate <li><b><a href=settings/audio_bit_perfect#global_perfect_bit_perfect>Perfect Bit Perfect</a></b>: disables DSP, gains, and crossfade to send decoded audio (including DSD) directly to the output <li><b><a href=settings/audio_bit_perfect#global_pipeline64>64-bit Pipeline</a></b>: extends internal format to Float64 for bit-lossless processing or increased DSP accuracy <li><b><a href=settings/audio_bit_perfect#global_dsd_remaster>DSD Remastering</a></b>: converts audio to DSD64-1024, with or without PCM-domain DSP (can be combined with Perfect Bit Perfect mode) </ul> </li> <li>Hi-Res Output <b>native/DoP DSD64-1024</b> support</li> <li><b>Dynamic Reconfiguration</b>: quickly reconfigures engine on routing/codec changes instead of full reloading</li> </ul> </li> <li><a href=settings/audio_outputs2>Audio Outputs</a> settings improvements: <ul> <li>simplified settings hierarchy with shortened Device ➔ Options navigation</li> <li>new sample rate, format, DSD, and other advanced options for <b>USB Exclusive</b> and <b>Hi-Res</b> outputs <li>per-output <b>Follow Track</b>, <b>Perfect Bit Perfect</b>, <b>64-bit Pipeline</b>, <b>DSD Remastering</b> options - where supported <li><b>Allowed Sample Rates</b> option which enables/disables specific sample rates for the given output <li><b>Base-Rate Synchronous Scaling</b> option which enables sample rate change within same 44K/48K-base family <li>DSD Remastering <b>Target DSD Sample Rate</b> and <b>Allow 48 kHz-based DSD</b> options <li>USB Exclusive: <b>Volume Type</b> and <b>Synchronize Hardware Volume</b> options; <b>Release USB DAC while paused</b>, <b>Allow DSD DOP</b>, <b>Prefer DSD Raw</b>, <b>Warmup on Startup</b>, <B>Force USB 1.1</b> options <li><a href=settings/audio_outputs_tweaks#usb_activity>Show Poweramp for USB DACs</a> option, allowing future connections without a confirmation dialog <li><b>custom profiles</b> for USB and Bluetooth devices <li>Bluetooth codec sample rate matching <li>new <a href=settings/audio_output_device_opts?device=bt#set_codec_sr>Set BT Codec Parameters</a> option which dynamically changes Codec sample rate/format<br> <small>AAudio (recommended) and Hi-Res Outputs<br> Android 9+<br> Some phones (e.g., Samsungs) may not allow codec sample rate to be switched this way; others (e.g., Xiaomis), may not allow specific formats/sample rates, etc.</small> <li>experimental <a href=settings/audio_output_device_opts?device=bt#shizuku_absvol>Allow DVC via Shizuku</a> option <li>output related <b>Advanced Tweaks</b> moved to Audio Output ➔ Advanced Tweaks </ul> <li>preamp range increased to <b>-24..+24dB</b><br> <small>Helps with bass EQ on DAPs</small> <li><b>FFmpeg</b> updated to <b>8.1.1</b> <li><b>Webm</b> format support <li>new <a href=settings/audio_tweaks#mod_interpolation>Tracker Decoder Interpolation</a> option <li>Wired Headset/AUX is renamed to <b>Wired 3.5/4.4 mm</b> for DAPs <li>more accurate display of DSD rates <li>updated/improved Hi-Res output support for DAPs: <b>A&K, Cayin, iBasso, HiBy, FiiO, Shanling, Sony, Tempotec</b> <li><a href=settings/audio#audio_info>Audio Info</a> dialog is updated for the new Audio Engine features and provides <b>Fidelity</b> and <b>Processing</b> scores <li><b>Limit button</b> is now highlighted when overload is detected <li>new <a href=settings/headset#pause_on_usb_connection>Pause On USB DAC connection</a> option <li>new <b>Grant via Shizuku</b> option to enable volume-key long-press track controls <li>Samsung Flip widgets for cover screens <li>rescan in folder scans just that folder (and subfolders) <li>AutoEQ presets update <li>skin authors now have protection/optional verification for their skins <li>3rd-party skin settings can now be exported to and imported from JSON files<br> <small>To import a json file from a file manager, use Open with.. Poweramp</small> <li>all new features and options of this update are included into the base app and don't require Feature Package purchase. If you enjoy the update, you can always support us by <a href=settings/feature_packages#buy_uber_badges>purchasing Uberpatron badges</a> </ul><br> "
```

### Builds 1033–10xx

> 资源键：`changelog_103x`（826 字符）

```
" <b>Builds 1033-10xx:</b> <ul> <li>new <a href=settings/ui_theme#blended>Blended</a> skin option<br> <small>Album art fills the top of the screen edge-to-edge and fades into a background</small> <li>workaround for DVC + BT AAC/SBC codecs silence (enables <a href=settings/audio_dvc#compensate_dvc_vol>Compensate DVC volume</a>) for some Android 17 updates, incl. Samsung OneUI 9.0 <li>LG Android 15+: DSD64/128 DoP support (for custom ROMs supporting that) <li>the current track's genre is now sent over AVRCP <li>DAPs without DVC: No Headroom Gain Reduction option is now available <li>removed the implicit 1.5x gain multiplier from Low Pass parametric filters; existing presets updated to compensate <li>bug fixes, stability, and other small improvements </ul><br> "
```

### Feature Package #1 内容清单

> 资源键：`fp1_changelog_content`（1028 字符）

```
" <ul> <li>customizable <a href=settings/ui_player#edit_player_screen_buttons>Player Screen Buttons</a> <li>new <a href=settings/ui_player#menu_button_long_press>Menu Button Long Press</a> option <li>new <a href=settings/vis#vis_fs_hide_bars>Hide System Bars For Full Screen</a> option <li>support for multiple items dragging in playlists and Queue<br> <small>Multiple checked items are dragged as a group</small> <li>new <a href=settings/ui_player#line2_click>Line2 Press</a> and <a href=settings/ui_player#line2_click>Line2 Long Press</a> options <li>new <a href=settings/library_lists#hide_unknown_artist>Hide Unknown Artist</a> option<br> <small>Unknown Artist is hidden from track labels in Poweramp UI as possible</small> <li>new <a href=settings/ui#anim_speed>Animations</a> option<br> <small>Navigation animations now can be faster or disabled</small> <li>more features for this package in the next builds </ul> <br> "
```

---

## 2. 逆向入口：changelog 里的设置深链

**这是本文最大的实用价值**——官方更新日志的每条功能都带 `settings/<page>#<key>` 形式的深链，
而**这些 page/key 在 APK 产物里可以逐一落地**。

### 2.1 深链落点验证结果

| 类别 | 数量 | 结果 |
| --- | ---: | --- |
| 页面文件存在 | **22/22** | 全部可解析到 `res/xml/<page>.xml` |
| 锚点 key 存在于页面 | **42/47** | 可直接 `grep` 到 `android:key="..."` |
| 锚点未命中 | 5 | 见 §2.2（属可控差异，非错误） |

### 2.2 5 个未命中锚点的解释

| 深链 | 原因 |
| --- | --- |
| `ui_theme#blended` | `ui_theme.xml` 只有 **8 行 / 2 个 key**（`theme_list`/`theme_list_3rdparty`），皮肤选项**运行期生成**；`blended` 是皮肤内的选项 id，不在静态 XML |
| `ui_theme#alt_layout` | 同上（"Full Cover, Centered" 皮肤选项） |
| `ui_theme#player_buttons_bg` | 同上 |
| `ui_theme#labels_bg` | 同上 |
| `ui_mediaactions#buttons` | 该页真实 key 是 `notify_action1..6`；`buttons` 是**跳转用的 preference key**（锁屏页里指向本页），不是本页内的锚点 |

> 结论：**深链格式是 `settings/<xml 文件名>#<android:key>`**，
> 对静态声明的设置项 100% 可靠；对运行期生成的皮肤选项则只能定位到页面，不能定位到行。

### 2.3 可直接使用的逆向起点

下表把 1026+ 的新功能映射到产物位置，供后续逆向直接使用：

| 功能 | 设置页 | 关键 anchor | 逆向切入点 |
| --- | --- | --- | --- |
| USB Exclusive Driver | `audio_outputs2` | `output_usb` | 设备级输出通道选择 |
| Bit Perfect 总页 | `audio_bit_perfect` | — | 19 行页面，4 个开关 |
| Follow Track | `audio_bit_perfect` | `global_follow_sr` | 采样率跟随 |
| Perfect Bit Perfect | `audio_bit_perfect` | `global_perfect_bit_perfect` | 关闭 DSP/增益/淡入淡出 |
| 64-bit Pipeline | `audio_bit_perfect` | `global_pipeline64` | Float64 内部格式 |
| DSD Remastering | `audio_bit_perfect` | `global_dsd_remaster` | DSD64-1024 转换 |
| 输出高级选项 | `audio_outputs_tweaks` | `usb_activity` | USB 免确认连接 |
| BT 编解码参数 | `audio_output_device_opts` | `set_codec_sr` | 动态改 codec 采样率 |
| Shizuku DVC | `audio_output_device_opts` | `shizuku_absvol` | 实验特性 |
| Tracker 插值 | `audio_tweaks` | `mod_interpolation` | libopenmpt 相关 |
| 音频信息对话框 | `audio` | `audio_info` | Fidelity/Processing 评分 |
| USB 连接暂停 | `headset` | `pause_on_usb_connection` | 新开关 |

---

## 2.4 版本串的组装（顺手解出，`about_version` 行）

更新日志的入口是「设置 → 关于」的 `about_version` 项（`general.xml:7`，无 summary）。
它的显示文本由 `ׅ/r91.v()` **运行期拼装**，不是静态资源：

```smali
; r91.smali:204-300（build-1035）
sb = "build-1035-bundle-play"
sb.append(0x0a)                       ; \n
sb.append(Sync.native_lock(-1))       ; ★ 授权串，来自 native
Sync.native_close(1)
sb.append(0x0a)
sb.append( xn0.B() ? "64" : "32" )    ; ★ ABI 位数
sb.append(0x20)                       ; 空格
sb.append(getString(0x7f0800b8))      ; 授权档位串（bit / edition）
```

| 片段 | 来源 | 说明 |
| --- | --- | --- |
| `build-1035-bundle-play` | **硬编码常量** | 版本串写死在 smali 里，随 build 变化 |
| （1025 无此前缀） | — | **build-1025 的同一逻辑不含硬编码 build 串**，见下 |
| 第二行 | `Sync.native_lock(-1)` | **native 层返回**，`lib/` 不存在，静态不可解 |
| `64` / `32` | `xn0.B()` | ABI 位宽判定 |
| 末段 | `0x7f0800b8` | 授权档位文案（见 `poweramp-about-runtime-deps.md`） |

**两版实现不同（实测对比）**：

| | build-1025 | build-1035 |
| --- | --- | --- |
| 处理类 | `preference/y1.smali` 的 `l()` | `ׅ/r91.smali` 的 `v()` |
| 硬编码 build 串 | **无** | `build-1035-bundle-play` |
| 授权串 | `Sync.native_lock(-1)` | 同 |
| ABI 位宽 | `xn0.B() ? 64 : 32` | 同 |

> ⇒ **不要把"硬编码 build 串"当成通用规律**——它是 1035 才加进去的。
> 这也解释了为什么在 1025 产物里全库搜 `build-1025` 是 0 命中。

> **对逆向的意义**：想在产物里定位"当前是什么版本"，**不要搜 versionName**——
> 版本串是硬编码在 `r91.v()` 的常量，且**混入了 native 返回的授权信息**。
> 若只需版本号，直接读 `apktool.yml` 的 `versionName` 更可靠。

---

## 3. 与既有文档的交叉印证

本文记录的版本特征，可与已完成的逆向结论互相验证：

| changelog 记载 | 已逆向结论 | 印证点 |
| --- | --- | --- |
| 1026–1032 "customizable buttons row on the player screen" | `poweramp-feature-votes.md` idea 15 | 对应 `player_screen_buttons` 资源族 |
| 1026–1032 "Bit Perfect Modes" | 同上 idea 40 | `audio_bit_perfect.xml` **仅在 1035 存在** |
| 1026–1032 "simplified settings hierarchy with Device ➔ Options" | 同上 idea 39 | `audio_outputs2.xml` 6 个设备 ButtonPref |
| 1002–10xx "repeat mode improvements ... updated wording" | 同上 idea 11 | `repeat` = "Repeat" |
| 978–988 "multiple items dragging in playlists and Queue" | 同上 idea 54 | Feature Pack #1 首项 |

> 注意：**idea 54（多选拖动）与 idea 15（自定义按钮）都属 Feature Pack #1**，
> 即"投票已实现" ≠ "免费可用"——这是商业化分层，不是功能缺失。

---

## 4. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | build 1004–1025 的更新日志缺失 | APK 内只有 `changelog_1003`（覆盖 1002-10xx）与 `changelog_102x`（1026+），中间无独立条目 |
| Q2 | build 838–970 的更新正文 | 论坛存档页只有文件名；APK 内最早只到 `changelog_971` |
| Q3 | `changelog_102x` 提到的 "Android 17" 等前瞻表述 | 属厂商文案，无法从产物验证 |

> **Q1/Q2 属真实缺口**：更早版本的更新正文既不在当前 APK，也不在可访问的存档里。
> 若要补齐，需拿到对应版本的 APK 并读取其 `changelog_*` 资源。

---

## 5. 证据索引

| 主题 | 位置 |
| --- | --- |
| 全部 changelog 资源 | `v1035/decoded/res/values/strings.xml`（15 条） / `1025: res/values/strings.xml`（14 条） |
| Bit Perfect 页 | `v1035/decoded/res/xml/audio_bit_perfect.xml` |
| 设备优先输出页 | `v1035/decoded/res/xml/audio_outputs2.xml` |
| 输出高级选项页 | `v1035/decoded/res/xml/audio_outputs_tweaks.xml` |
| 皮肤页（运行期生成） | `v1035/decoded/res/xml/ui_theme.xml`（8 行 / 2 key） |
| 媒体按钮页 | `v1035/decoded/res/xml/ui_mediaactions.xml`（key 为 notify_action1..6） |
| 论坛文件页存档 | Wayback 20250823052023（25 个版本条目，build 838–1000） |

> 深链格式：`settings/<xml 文件名>#<android:key>`。
