---
doc_id: "ARCH-POWERAMP-CHANGELOG-HEADSET-MISC"
title: "Poweramp changelog 逆向：耳机/蓝牙 + 播放控制 + 设置杂项（59 条）"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 13
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "docs/corpus/poweramp-release-changelog.md（changelog 原文）"
  - ".rea-analysis/_changelog_items.json（条目清单，groups 耳机蓝牙/播放控制/设置杂项）"
  - "docs/corpus/poweramp-corpus-conventions.md（引用规范）"
  - "docs/corpus/poweramp-headset-complete.md（耳机页完整参考，build-1035）"
  - "docs/corpus/poweramp-misc-complete.md（misc 页完整参考）"
  - "docs/corpus/poweramp-settings-search.md（设置搜索实现）"
  - "docs/corpus/poweramp-settings-export-import.md（导入导出）"
  - ".rea-analysis/decoded/res/xml/headset.xml（build-1025，25 行）"
  - ".rea-analysis/decoded/res/xml/audio_focus.xml（build-1025，18 行）"
  - ".rea-analysis/decoded/res/xml/misc.xml（build-1025，37 行）"
  - ".rea-analysis/decoded/res/xml/feature_packages.xml（build-1025，19 行）"
  - ".rea-analysis/v1035/decoded/res/xml/headset.xml（build-1035，26 行）"
  - ".rea-analysis/v1035/decoded/res/xml/audio_focus.xml（build-1035，18 行）"
  - ".rea-analysis/v1035/decoded/res/xml/misc.xml（build-1035，38 行）"
  - ".rea-analysis/decoded/smali/smali/com/maxmpz/audioplayer/（build-1025 smali）"
  - ".rea-analysis/v1035/decoded/smali/（build-1035 smali，含混淆包）"
  - ".rea-analysis/decoded/apktool.yml（sdkInfo / versionCode）"
  - ".rea-analysis/v1035/decoded/apktool.yml"
---

# Poweramp changelog 逆向：耳机/蓝牙 + 播放控制 + 设置杂项（59 条）

> **版本域纪律（先读这段）**：本文主域是 **build-1025**（`versionCode 1025009` / `build-1025-uni`）。
> 经实测，`changelog_102x`（1026–1032）与 `changelog_103x`（1033+）两个区块的原文
> **在 build-1025 的资源里不存在**——`res/values/strings.xml` 只有 10 个 `changelog_*` 键：
> `changelog_971 / 978 / 978_fp / 989 / 989_2 / 992 / 997 / 1000 / 1003 / 1017`；
> build-1035 有 11 个（多出 `changelog_102x` 与 `changelog_103x`）。
> 因此**属 102x / 103x 区块的条目**一律改在 `.rea-analysis/v1035/decoded/` 下取证，
> 并在表中显式标注。**绝不在 build-1025 里硬找属于后续 build 的东西。**
>
> 证据分级沿用 `poweramp-corpus-conventions.md` §2 的 B 制（`路径:行号`）：
> 【实证·原文】= XML / 资源 / 二进制原文；【实证·产物】= 反编译 smali；
> 【实证·清单】= 条目清单 JSON；【推断】= 无直接代码佐证。

---

## 0.0 路径约定（阅读前必读）

本文引用分两种写法：

| 写法 | 含义 |
| --- | --- |
| `.rea-analysis/...` 开头 | **完整路径**，可直接定位 |
| 不带前缀（如 `headset.xml:16`、`player/i.smali:1830`） | **简写**，按下面规则补全 |

**简写补全规则**：

| 版本 | smali 根 | 资源根 |
| --- | --- | --- |
| build-1025 | `.rea-analysis/smali/smali/com/maxmpz/audioplayer/` | `.rea-analysis/decoded/res/` |
| build-1035（普通包） | `.rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/` | `.rea-analysis/v1035/decoded/res/` |
| **build-1035（混淆包）** | **`.rea-analysis/v1035/decoded/smali/ׅ/`** | — |

> ⚠️ **`ׅ/` 这一层容易漏**。1035 是 bundle 拆分版，`com.maxmpz` 只有 434 个类，
> 业务逻辑大量在混淆包 `ׅ`（U+05C5，一个字符）下的 **3088 个 smali** 里。
> 例：`vr.smali`、`ar.smali`、`t21.smali`、`i.smali`、`oa0.smali` 全都在 `ׅ/` 下。

## 0. 一句话结论

这 **59 条**里有 **16 条是「bug fixes and stability improvements」「updated translations」这类笼统条目**（无可定位实现），
另 **43 条具体条目**中：**30 条完整找到可复验实现**（其中 8 条只能在 build-1035 侧取证）、
**5 条部分找到**（定位到文案/载体/结构，但所声称的效果未完全钉死）、**8 条未找到**。
找到实现的部分呈现出极强的**「设置页极简 / 消费者极重」**规律：偏好键只在 `prefs/В.smali`（1025）或
`vr.smali`（1035）注册一行，真正的逻辑全在**按键分发器**（`player/i.smali`，3159 行）、
**音频焦点回调**（`player/H.smali`，3625 行）、**输出管线**（`processing/Pipeline2.smali`，5612 行）里。

| 组 | 条目 | 完整找到 | 部分找到 | 未找到 | 笼统条目 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 耳机蓝牙 | 15 | 12 | 2 | 1 | 0 |
| 播放控制 | 4 | 4 | 0 | 0 | 0 |
| 设置杂项 | 40 | 14 | 3 | 7 | 16 |
| **合计** | **59** | **30** | **5** | **8** | **16** |

> **口径说明（三类互斥，可对数）**
>
> | 判定 | 定义 | 落点 |
> | --- | --- | --- |
> | **完整找到** | 实现点可指到具体 `文件:行号`，且机制与原文语义一致 | §1 表格的「实现位置 + 机制」两列 |
> | **部分找到** | 已定位到**文案 / 载体 / 结构**之一，但原文声称的效果本身未钉死 | §3.1 表中标注「部分」的行 |
> | **未找到** | 具体条目（含明确功能名/资源名）但两版产物都无法定位 | §3.1 表中标注「无」的行 |
> | **笼统条目** | 条目本身不含可定位对象 | §3.2 |
>
> 30 + 5 + 8 + 16 = 59，闭合。
>
> **「部分找到」不并入「完整找到」**：例如 Absolute Volume 提示（H3/U1）确实在
> `res/values/strings.xml:25` 找到了原文、也在 `player/absvol/` 找到了运行包，
> 但「把它显示出来」的那一行代码找不到——按字面算「实现」是虚的，故单列。

---

## 1. 逐条逆向表

### 1.1 耳机蓝牙（15 条）

| # | 更新原文（changelog 区块） | 实现位置 | 机制 |
| ---: | --- | --- | --- |
| H1 | new `Ignore Bluetooth Commands` option（978 附加项） | 键：`res/xml/headset.xml:16`；注册：`.rea-analysis/smali/smali/com/maxmpz/audioplayer/prefs/В.smali:1837`（`ignore_bt_sec` → `В->r2`，`j0` 整型）；消费：`player/i.smali:1593`、`:1597`、`:1599`、`:1605`、`:1670` | **不是布尔开关，是 0–20 秒的「路由变更后忽略按键」时间窗**。XML 用 `SeekbarPreference`，`w:min="0" w:max="20"`（`headset.xml:16`）。取值 ×1000 转毫秒（`i.smali:1597`），经 `Utils->К(III)I` 与常量 **`0x4e20`=20000 夹取**（`i.smali:1599`、`:1605`）。判定用两个时间差：`now - router/х->p`（最近路由变更，`i.smali:1571`）与 `now - bt/BTReceiver->А`（最近 BT 事件，`i.smali:1583`）；**两者都超窗才放行**（`i.smali:1611`、`:1619`、`:1635`）。命中即记 `" IGNORED due to ignore_bt_sec lastRouteTimeDiff="`（`i.smali:1670`）并 `return-void`（`:1692`） |
| H2 | new `Ignore Repeat/Shuffle` option（978 附加项） | 键：`headset.xml:17`（`android:key="bt_ignore_repeat_shuffle"`）；注册：`prefs/В.smali:1829`（→ `В->q2`，默认 `const/4 v3, 0x0` = `false`，见 `В.smali:407`）；判定：`player/j.smali:529`（方法 `А(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Z`）、`:532`、`:540`、`:542`、`:550`、`:564` | 唯一的**纯布尔短路器**。判据是**「源名字符串包含 `bluetooth`」**（`j.smali:540` `const-string v0, "bluetooth"` → `:542` `StringsKt->х` 包含判定），命中即返回 `true`（`:564`）并打点 `"bt_ignore_repeat_shuffle =>IGNORE action="`（`:550`）。调用方是 MediaSession 回调：`player/l.smali:440`（`onSetShuffleMode`，方法头 `:427` `H(I)V`）、`:1161`（`onSetRepeatMode`，方法头 `:1148` `Н(I)V`），以及 `widget/player/f1.smali:248` / `:271` / `:326` / `:515`。三参语义为 (源名字, 具体源字符串, 动作名) —— 见 `l.smali:436`、`:438` |
| H3 | ⚠️**部分** Poweramp now can indicate inability to detect Absolute Volume（989–991） | 资源：`res/values/strings.xml:25`（`absvol_detection_15` = "• it's not possible to detect Absolute Volume on your device"）；同组 `strings.xml:24`（`absvol_desc_short`）、`:26`（`absvol_disabled_bt_15`）、`:27`（`absvol_uncheck_manually`）；实现包：`player/absvol/`（`A.smali`、`у.smali`）；pref 键 `no_dvc_bt_absvol` 注册于 `prefs/В.smali:397`（→ `В->H`） | **只有「提示文案」与 absvol 运行包；未定位到把该文案挂到界面的引用点**（见 §3.1 U1）。文案组共 4 条，全部是**探针说明/免责**语气，据此判定该能力是「探测失败时明确告知用户」，而非静默降级 |
| H4 | Android 15 restricts access to BT codec information（989–991） | `player/bt/BTReceiver.smali:24`（`В(Context, BluetoothDevice, PaBluetoothCodecConfig)`）、`:84`、`:96`；`:570`、`:573`、`:579`、`:587` | **平台限制的直接物证**：代码同时探测 **两个** extra 键名——`android.bluetooth.codec.extra.CODEC_STATUS`（`BTReceiver.smali:579`）与 `android.bluetooth.extra.CODEC_STATUS`（`:587`），并带 `catchall` 兜底（`:570`）把异常降级为 warn（`:573`）、`v2 = v11`（空设备）继续走。这正是「拿不到 codec 也不崩，继续尝试采样率/位深」的写法；codec 名字/ID 读取在 `:84`、`:96` |
| H5 | improved `Resume on Bluetooth` for some devices/firmwares（992–996） | 键：`headset.xml:7`（`resume_on_bt`）；注册：`prefs/В.smali:965`（→ `В->r0`）；消费：`.rea-analysis/v1035/decoded/smali/ׅ/uy.smali:1295`（方法 `х(Context,Z,I,String,String,Z,Z)V`）、`:1368`、`:1372` | 恢复逻辑走**统一的路由事件处理器**（1035 侧 `uy.х`），方法内同时持有 `resume_on_headset`（`:1368`）与 `resume_on_bt`（`:1372`）两个键名，说明「按当前路由类型选对应开关」是同一函数内分派的——这就是「对某些设备/固件改进」的落点：不是加新开关，而是**收敛到一条按 `t21.A(I)Z` 判型的路径**（`uy.smali:1307`） |
| H6 | new `Beep More` option（992–996） | 键：`headset.xml:19`（`android:key="beep_more"`，`android:dependency="headset_beep"`）；注册：`prefs/В.smali:1867`（→ `В->v2`，默认 `v3`=`false`，`В.smali:407`）；消费 16 处（`i.smali:1136` / `:1190` / `:1214` / `:1308` / `:1345`；`l.smali:98` / `:786` / `:1245` / `:1299` / `:1489`；`f1.smali:201` / `:424` / `:609` / `:660` / `:706`）；**最典型**：`widget/player/f1.smali:195`、`:201`、`:205`、`:215` | `beep_more` **与 `headset_beep`（`prefs/В.smali:1029` → `В->z0`）串联成两级门**：先看 `z0`（`f1.smali:195`），再看 `v2`（`:201`），**两者皆真**才把 beep 标志位置 1（`:205` → `:212` 的 `v3`），最后调 `PSMediaButtonReceiver->В(Context,IILandroid/os/Bundle;)V`（`:215`）。即「Beep More」= 在原有 beep 已开的前提下，扩大发声的**动作覆盖面** |
| H7 | improved Bluetooth double/triple button presses（992–996） | `player/i.smali:1830`、`:1845`、`:1851`、`:2032`；脉冲常量 `:2341`（`const-wide/16 v4, 0x7d0` = 2000 ms）、`:1845`（`0x12c` = 300 ms）；计数器 `PSMediaButtonReceiver->A`（`PSMediaButtonReceiver.smali:6`）、`->X`（`:12`）、`->А`（`:18`） | 一套**显式按键序列状态机**：`PSMediaButtonReceiver->A` 存「上一次键码」、`->А` 存「上一次时间戳」；两击间隔 ≤300 ms（`i.smali:1845` 的 `0x12c`）判为连击（`:1847`），`Handler` 上先 `removeMessages(1/2/3)` 清场（`i.smali:1941`、`:1945`、`:1949`）再按 2000 ms（`:2341`）延迟派发。`isVirtual()` 判定（`:1822`）区分真实按键与注入按键 |
| H8 | new `Strict Resume/Pause/Stop` option（997–999） | 键：`headset.xml:15`（`android:key="follow_pl_exact"`，`android:dependency="enable_headset_controls"`）；注册：`prefs/В.smali:1875`（→ `В->w2`，默认 `v2`=`true`，`В.smali:389`）；消费：`player/i.smali:1083`、`:1087`、`:1099`、`:1102`；`:2364`、`:2366`；`:2470`、`:2481`；`:2831`、`:2915` | 布尔门后**显式列出受控键码**：`0x7f`(127 = KEYCODE_MEDIA_PAUSE)、`0x7e`(126 = KEYCODE_MEDIA_PLAY)、`0x56`(86 = KEYCODE_MEDIA_STOP)，**只有这三个键**在该开关为真时打上「严格」标记（`i.smali:1089` / `:1093` / `:1097` → `:1102`）。该标记传入后续分支：`:2364` 起在 `0x56`/`0x7f` 时先 `i->x()` 重置（`:2369`）再令状态 `= 2`（`:2373`），否则清 `PSMediaButtonReceiver->B`（`:2392`）走普通路径 |
| H9 | improved `Strict Resume/Pause/Stop` option（1000–1001） | 同 H8；差异点在 `i.smali:2470`、`:2481`、`:2831`、`:2915` 四个消费点（同一 `v24` 标记的多分支复用） | 「改进」= 把原来只在一条路径生效的标记，**扩展到 4 条下游路径**（`:2470`/`:2481` 一组、`:2831`、`:2915` 各一组）。未见新增偏好键，属纯行为扩展 |
| H10 | workaround for headset/headunit/BT key presses intercepted and modified by Gemini（1002–10xx） | `player/i.smali:1815`（`const/16 v11, 0x7e`）、`:1818`、`:1820`、`:1822`、`:1828`、`:1845`、`:1851`、`:1871` | 判据三重与：**①键码 = `0x7e`(PLAY)**（`:1815`）；**②`InputDevice` 非空且 `isVirtual()==true`**（`:1820`、`:1822`、`:1828`）——即「注入而非物理」；**③距上次按键 ≤300 ms**（`:1845`）。三者皆中时记 `" IGNORE isAssistant => allow double/triple press"`（`:1851`）并 `return-void`（`:1871`），**放弃本次派发**以让 Gemini 的改写不被当成用户双击 |
| ⚠️**未找到** H11 | custom profiles for USB and Bluetooth devices（1026–1032） | — | **未找到实现**（1035 侧亦未定位），见 §3.1 U2 |
| H12 | ⚠️**部分** Bluetooth codec sample rate matching（1026–1032） | 1035 侧未定位到独立实现；可佐证的结构在 1025：`player/bt/BTReceiver.smali:24`、`:84`、`:96`（codec 配置对象 `PaBluetoothCodecConfig`） | **部分证据**：`PaBluetoothCodecConfig` 是 codec 采样率/格式的载体（`BTReceiver.smali:84` 取 `К()` 字符串、`:96` 取 `x` 整型），但「采样率匹配」的决策点未定位。见 §3.1 U3 |
| H13 | Wired Headset/AUX is renamed to `Wired 3.5/4.4 mm` for DAPs（1026–1032） | 资源：`res/values/public.xml` 中 `wired_headset` = `0x7f0808f9`（1025）/ `0x7f080948`（1035）；使用点：`res/xml/headset.xml:12`（1025）/ `:13`（1035） | **纯文案改名，键不变**：`android:key="headset_controls"` 两版一致，只有 `android:title` 指向的字符串内容变了。**这是「不要照抄」的典型**——改名不能照抄成改键 |
| H14 | new `Pause On USB DAC connection` option（1026–1032） | 键：`.rea-analysis/v1035/decoded/res/xml/headset.xml:8`（`android:key="pause_on_usb_connection"`）；注册：`.rea-analysis/v1035/decoded/smali/ׅ/vr.smali:3519`；消费：`uy.smali:1691`、`:1710`、`:1714`、`:1736` | 1035 新增键（**1025 的 `headset.xml` 25 行里完全没有**）。消费点在同一个路由事件函数 `uy.х`（`:1295`）内：读 `vr->x2`（`:1691`）→ 仅当 `v5 == 3`（`:1710`）时短路，打 `" pause_on_usb_connection => IGNORE"`（`:1714`）后 `return-void`（`:1736`）。**`v5` 的来源**：`:1307` 调 `t21->A(I)Z` 过滤后取原值（`:1322`），而 `t21->А(I)Ljava/lang/String;`（`t21.smali:700`）的映射表 `0→headset / 1→speaker / 2→bt / 3→usb / 4→other / 5→chromecast`（`:758`–`:803`，`3→"usb"` 在 `:775`）。**故 `v5==3` 即 USB** |
| H15 | the current track's genre is now sent over AVRCP（1033+） | `.rea-analysis/v1035/decoded/smali/ׅ/ar.smali:3230`（方法 `y(Lci1;Lcom/maxmpz/audioplayer/player/PlayerServiceCore;Z)V`）、`:3362`、`:3370`、`:3378`、`:3402`、`:3406` | **在 build-1025 里做不到**：1025 侧 `res/values/strings.xml` 无 `changelog_103x`，且 `android/support/v4/media/session/` 内**没有任何一处设置 `android.media.metadata.GENRE`**（全仓仅 3 处 GENRE 字符串，均在 `MediaMetadataCompat.smali` 的**常量定义表**里：`:98`）。1035 侧才出现在**真正的 metadata 组装函数**里：先取 `ci1->O`（`:3362`），为空则退到 `ci1->q`（`oi0`）的 `"stream_genre"`（`:3370`、`:3378`），最后统一 `w3->C("android.media.metadata.GENRE", v0)`（`:3402`、`:3406`）。**这是「同版本域内才有的实现」样本** |

### 1.2 播放控制（4 条）

| # | 更新原文 | 实现位置 | 机制 |
| ---: | --- | --- | --- |
| P1 | increased number of Sleep timer possible values（989–991 附加项） | 布局：`res/layout-sw2dp/merge_sleep_timer_popup_layout.xml:9`（`RoundKnob`，id `@id/round_knob`）、`:8`（`@id/sleep_timer_value`）、`:10`（`play_to_end` 复选）；样式：`res/values/styles.xml:14980`（`SleepTimerRoundKnob`）、`:1495`–`:1497`；计算：`widget/player/SleepTimerBehavior.smali:294`、`:298`、`:300`、`:338`、`:359`、`:371` | **值域 = 圆盘旋钮 0–240 分钟**。`RoundKnob->о`（归一化 0..1）× **`240.0`**（`SleepTimerBehavior.smali:298` 的 `0x406e000000000000L`）→ `MathKt->B(D)I`（`:300`）= 分钟数。「值变多」不是加预设，而是**把原来离散的预设换成连续 240 档旋钮**；确认时再 `×0x3c`(60) 转秒（`:371`），并 `>0` 才下发（`:369`）。另存 `h0->k`（分钟）与 `h0->l`（play_to_end 布尔）回写（`:401`、`:413`） |
| P2 | improved resuming and pausing after an audio focus change/call（992–996） | `player/H.smali:2890`、`:2896`、`:2918`、`:2926`；`player/O.smali:79`、`:83`、`:133`；入口 `PSAudioFocusHelper` 分派（`H.smali:2852` 日志 tag） | 恢复判定是**「被谁暂停」×「哪个开关允许」的笛卡尔积**：`O->Х`=被电话暂停、`O->x`=被焦点变更暂停。恢复条件为 `(Х && resume_after_call)` **或** `(x && af_short && resume_on_focus)`（`H.smali:2881`–`:2900`，三键分别见 `:2918`(w0) / `:2890`(h0) / `:2896`(z2)）。不满足则记 `"after call or audio focus ... wasPausedByPhone=... wasPausedByFocusChange=... resume_after_call=... af_short=... resume_on_focus=..."`（`:2932`–`:2966`）——**这条日志本身就是「对某些设备/固件改进」的调试接口** |
| P3 | improved sleep timer（992–996） | 同 P1；另 `H.smali:2820` 的 `"handleOnSleepTimer"` 为消息处理入口；运行时消息 id `0x7f0d009c`（`res/values/ids.xml:159`） | 改进点落在**「到点后做什么」**：`RoundKnob` 旁新增 `play_to_end` 复选框（`merge_sleep_timer_popup_layout.xml:10`），对应 `state_player_sleep_timer_play_to_end`（`ids.xml:1248`），即「播完当前曲目再停」；并有 `"handleOnSleepTimer"` 独立消息（`H.smali:2820`）与 UI 解耦 |
| P4 | new `Resume On Focus` option（1002–10xx） | 键：`res/xml/audio_focus.xml:13`（`android:key="resume_on_focus"`，`android:defaultValue="true"`，`android:dependency="af_short"`）；注册：`prefs/В.smali:1897`（→ `В->z2`，默认 `v2`=`true`）；消费：`H.smali:2896`、`:2926` | 与 `af_short` 构成**两级门**：`af_short`（`audio_focus.xml:11`，「短时焦点丢失→暂停」）为父；`resume_on_focus` 为子，只在父开时才有意义（XML 用 `android:dependency` 表达，代码里两次连读，`H.smali:2888`→`:2896`）。**注意此处 `resume_on_focus` 与 H8 的 `follow_pl_exact` 是两个不同开关**，都在 `H.smali` 同一个方法附近被读，不要混淆 |

### 1.3 设置杂项（40 条）

> 本组 **40 条 = 16 条笼统条目（§3.2）+ 24 条具体条目**。
>
> 下表 **26 行**的覆盖关系：
>
> | 行 | 覆盖 | 说明 |
> | --- | ---: | --- |
> | M1 | 4 条 | AutoEq 在 971 / 978 / 997 / 1003 四次出现，机制同一 |
> | M23 | 1 条 | AutoEQ presets update（1026–1032），与 M1 同机制 |
> | M26 | 0 条 | 只是 4 条耳机条目（H11–H14）的归并指路，已在 §1.1 计过 |
> | M15 / M17 / M18 | 3 条 | 笼统条目在组内的显式占位（其余 13 条笼统条目在 §3.2 逐条列出） |
> | 其余 21 行 | 20 条 | 每条具体条目各占一行 |
>
> 合计 4 + 1 + 3 + 20 = 28 条去向明确；另 12 条笼统条目只在 §3.2 出现 ⇒ 28 + 12 = 40，闭合。
>
> **标记含义**：⚠️**部分**（M8 / M16 / M19）→ 判定「部分找到」；
> ⚠️**未找到**（M3 / M5 / M7 / M11 / M21 / M22 / M24）→ 判定「未找到」；
> 🚫**笼统**（M15 / M17 / M18）→ 计入 §3.2。
> 其余 16 行为「完整找到」，减去 M26（0 条）与 M23 之外的重复计法后，
> 对应 **14 条**完整找到的具体条目——与 §0 汇总表一致。

| # | 更新原文（区块） | 实现位置 | 机制 |
| ---: | --- | --- | --- |
| M1 | AutoEq presets/devices database update（971 / 978 / 997 / 1003 / 1026–1032，共 5 次） | 资产：`.rea-analysis/decoded/assets/auto_eq.db`（**7 294 976 B**，SQLite 3，`pageSize=4096`，`pageCount=1781`）；表 `eq_presets(_id INTEGER PRIMARY KEY, name TEXT, meta TEXT, parametric INTEGER, data_blob BLOB)` + `android_metadata`；导入入口：`.rea-analysis/v1035/decoded/smali/ׅ/oa0.smali:3592`、`:3738`（`"eq_presets_autoeq_import"`）；`q71.smali:251`（`"_clear_autoeq_known_devices"`）、`:281`（`"_import_autoeq"`） | **「数据库更新」= 直接替换 assets 里的 SQLite 文件**，无迁移代码。`parametric` 列区分参数/图形两类预设，`data_blob` 存曲线；`_clear_autoeq_known_devices` 说明**「已提示过的设备」是本地记忆**，删库即可重置提示。⚠️ 该条目在 5 个区块重复出现，属**最高频的一项**，但每次都没有代码变更——纯资产替换 |
| M2 | new `Apply OP High Framerate` option（971） | 键：`res/xml/misc.xml:23`（`android:key="op_framerate"`，`w:sup="@string/pref_experiment"`）；注册：`widget/player/h0.smali:836`（→ `h0->m0`，默认 `v4`=`false`，见 `h0.smali:274`）；**唯一 UI 消费者**：`common/BaseActivity.smali:1947`；misc 页 helper：`preference/v2.smali:329` | 在 `BaseActivity` 里做的**显示模式优选**：仅 `SDK_INT >= 0x1d`(29)（`BaseActivity.smali:1943`、`:1945`）且开关为真（`:1947`、`:1949`）时进入；遍历 `Display->getSupportedModes()`（`:1968`），**只挑「与当前物理宽高完全一致 且 `getRefreshRate() > 61.0f`」的模式**（`:1999`、`:2005`、`:2011`、`:2015` 的 `0x42740000`），命中即写 `LayoutParams->preferredDisplayModeId`（`:2033`）。全流程包在 `try/catchall` 里（`:2034`、`:2039`），失败只记 `BaseActivity` 日志（`:2050`、`:2054`）——**实验性选项的典型防御写法** |
| ⚠️**未找到** M3 | added support for Spinorama txt presets importing（971） | — | **未找到实现**（见 §3.1 U4）。1025 侧全仓搜 `spinorama`（大小写不敏感）**0 命中**，`assets/` 只有 8 项；1035 侧同样 0 命中 |
| M4 | settings search history（978 附加项） | DDL：`data/migrations/B.smali:4188`（方法 `c0(SQLiteDatabase,Context,I)V` 内）、`:4303`–`:4329`；索引：`:4331`–`:4369`；DAO：`rest/library/y3.smali:31`（表名绑定）、`:33`、`:37`、`:121`、`:125`、`:129` | **SQLite 表 + 两个索引，全新表**：`settings_search_history(_id INTEGER PRIMARY KEY, term TEXT NOT NULL COLLATE NOCASE, updated_at INTEGER NOT NULL)`（字段名取自 `B.smali:4313` / `:4317` / `:4319` / `:4323`，`filled-new-array` 拼接在 `:4325`）。索引两个：**普通索引 `settings_search_history_updated_at` on `updated_at`**（`:4335`–`:4349`）用于按时间倒序取历史；**唯一索引 `settings_search_history_term` on `term`**（`:4355`–`:4367`，注意字符串里多了两个空格，`:4357`）用于去重。DAO `y3` 走通用 `w3` 包装（`y3.smali:37`）。**这套设计与设置搜索本体（`pref_search` FTS 表，见 `y3.smali:121` `pref_search JOIN pref_search_fts ON docid=pref_search._id`、`:125`、`:129` ` MATCH ?`）完全解耦**：历史表是普通表，搜索表是 FTS |
| ⚠️**未找到** M5 | hex color support in color dialogs（978 附加项） | — | **未找到实现**（见 §3.1 U5） |
| M6 | introducing 🎁 `Feature Packages`（978–988） | 页面：`res/xml/feature_packages.xml`（19 行）；控件类：`preference/FeaturePackPref.smali`（925 行）、`FeaturePackRedirectPref.smali`；购买门：`FeaturePackPref.smali:57`（`X()Z`）、`:60`、`:64`、`:70`、`:77`、`:81`、`:85`；状态写入：`:118`（`or-int/lit8` 置 bit0）、`:126` | **引入的是一整套「增值包」机制，不是一个选项**：①页面 `feature_packages.xml` 10 个 `RawTextPreference` 讲销售话术（`:4`–`:10`）、1 个 `FeaturePackPref`（`:11`，`w:buttonOnly="true"`）、1 个「隐藏到关于页」开关 `move_fp1_to_about`（`:12`）、1 个 `BuyUberPref`（`:14`）、1 个 `UberLevelPref`（`:15`）、1 个恢复购买（`:18`）。②**门控是位掩码**：`h0->w0` 是 `fastprefs/r`（int），`& 1` 判 fp1 是否已购（`FeaturePackPref.smali:64`、`:70`）；`:77` 另读 `prefs/B->H` 与 `0xe5`(229) 比较（`:81`），再叠加 `h0->x0`（`move_fp1_to_about`，`h0.smali:1263`、`:1269`、`FeaturePackPref.smali:85`）——**即「老版本用户或已隐藏到关于页」也算通过**。③购买成功后 `or-int/lit8` 置位并 `m->C(false)` 提交（`:118`、`:126`）。④`FeaturePackPref` 继承 `BuyPrefBase`（`:2`），复用既有购买控件骨架 |
| ⚠️**未找到** M7 | Google Cast for Audio (GC4A) 2.0 support（989–991） | — | **未找到实现**（见 §3.1 U6）。1025 侧 `cast/` 与 `cc/` 包存在（`CcPluginService.smali` 等），但未见可指向「2.0」的版本判定点 |
| M8 | ⚠️**部分** improved FLAC metadata parsing（989–991 附加项） | 解码器插件：`decoder/flac/FlacPluginService.smali`；扩展名登记：`data/у.smali:57`（`TYPE_FLAC`）、`:61`（`"flac"`） | **仅定位到入口，未定位到「改进」的具体位置**（见 §3.1 U7）。可确证的是 FLAC 走独立 decoder 插件服务，且两版产物中扩展名/类型登记一致 |
| M9 | audio routing detection code revamp（989–991 附加项） | 类型映射：`.rea-analysis/v1035/decoded/smali/ׅ/t21.smali:700`（`А(I)Ljava/lang/String;`）→ `:758` headset / `:766` other / `:774` usb / `:782` bt / `:790` speaker；反向：`t21.smali:35`（`B(Ljava/lang/String;)I`）→ `:143`(usb→3)、`:163`、`:170`(bt)、`:190`、`:203`(chromecast→1)、`:217`、`:244`(speaker→0)；有效性判定：`t21.smali:7`（`A(I)Z`：`0 <= i <= 5`）；1025 侧对应包：`player/router/`（`A/B/X/y/А/В/К/у/х` 共 9 类） | **revamp 的实质是把「路由类型」收敛成 0–5 的规范枚举，并提供双向映射**。正向 `А(I)`：0=headset、1=speaker、2=bt、3=usb、4=other、5=chromecast（`:758` / `:790` / `:782` / `:774` / `:766` / `:758`）；反向 `B(String)`：`usb→3`（`:143`）、`bt→2`（`:163`、`:170`）、`chromecast→1`（`:203`）、`speaker→0`（`:244`）；越界字符串走 `"Unknown_"+i` 兜底（`t21.smali:743`、`:747`）。`A(I)Z` 的区间检查（`:11`、`:18`）说明**外部传入的 route 值先要做合法性过滤**——这是 revamp 的核心收益 |
| M10 | `.oga`, flac in `.ogg/.oga` support（989–991 附加项） | `data/у.smali:577`（`TYPE_OGA`）、`:581`（`"oga"`）；对照 `:111`（`TYPE_OGG`） | 新增独立类型 `TYPE_OGA`（`:577`、`:581`）而非复用 `TYPE_OGG`（`:111`）——**即「扩展名独立登记，解码器共用」**。该 `у` 类共 **31 个 `TYPE_*` 项**（`у.smali:593` 的 `new-array ..., 0x1f` = 31） |
| ⚠️**未找到** M11 | other small changes for Android 15（989–991 附加项） | — | **未找到实现**（见 §3.1 U13） |
| M12 | Target SDK updated to 35（989–991 附加项） | **原文实证**：`.rea-analysis/decoded/apktool.yml` → `sdkInfo: minSdkVersion: 21 / targetSdkVersion: 35 / versionCode: 1025009 / versionName: build-1025-uni`；对照 1035：`.rea-analysis/v1035/decoded/apktool.yml` → `targetSdkVersion: 36`、`versionCode: 1035009` | **这是全篇唯一「不需要 smali」就能证死的条目**：build-1025 的 `targetSdkVersion` 恰好 = 35。**同时它给出本文最重要的版本锚点**：1025 已含 targetSdk 35，故该变更在 1025 之前已完成；而 1026+ 条目只能去 1035 找 |
| M13 | simplified Full Version unlocking via in-app purchase for Play（989–991 附加项） | 资源：`res/values/strings.xml:450`（`fv_iap_purchase` = "Full Version In-App Purchase"）、`:514`（`iap_on_gplay` = "In-App Purchases on Google Play"）；实现：`common/BaseMainActivity.smali:590`（`play_billing/x1->H(Landroid/app/Activity;)Z`）、`:596`、`:598`、`:600`、`:601` | 走 **Google Play Billing 库**（`com.google.android.gms.internal.play_billing.*`，`BaseMainActivity.smali:590`）。在 Activity 启动的跳转分支里，`:590` 判定「是否需走 Play 计费解锁」，`true` 则置标志 `e` 并直接返回（`:596`、`:598`），不再走 `:601` 起的兼容路径。**「simplified」= 把解锁收敛成一条 Play 判定短路** |
| M14 | 16kb page size support（997–999） | **二进制实证**（自解析 ELF program headers）：`lib/arm64-v8a/libffmpeg_neon.so`、`libpowerampcore.so`、`libyayicn.so` 的**全部 `PT_LOAD` 段 `p_align = 0x4000`（= 16384 = 16 KB）**；1035 侧 `v1035/natives/libffmpeg_neon.so`、`libpowerampcore.so` 同样 `0x4000` | 这是**「Google Play 要求」类合规项的实现判据**：16 KB 页支持的正确验证方式是查 `p_align`，不是查代码。三个 so 全部 `0x4000` 说明已完成；1025 的 `apktool.yml` 里 `lib/` 只有 `arm64-v8a` 一个 ABI，故无 32 位适配歧义 |
| 🚫**笼统** M15 | battery, CPU usage, app size optimizations（997–999） | — | **笼统条目，无可定位实现**（§3.2 G5） |
| M16 | ⚠️**部分** Poweramp suggests disabling Manage App If Unused option if detected（1000–1001） | 文案：`res/values/strings.xml:329`（`disable_app_if_unused`） | **半定位**：文案确实存在且措辞与条目一一对应，但**把这条文案挂到界面上的引用点未定位**（`0x7f080196` 在 1025 全 smali 中 0 命中，见 §3.1 U8） |
| 🚫**笼统** M17 | 🎂the milestone 1000th build（1000–1001） | — | **笼统条目，无可定位实现**（§3.2 G8） |
| 🚫**笼统** M18 | `<b>major Audio Engine update:</b> <ul>`（1026–1032） | — | **笼统条目（分节标题），无独立实现**（§3.2 G13；子项见 M19–M24） |
| M19 | ⚠️**部分** simplified settings hierarchy with shortened Device ➔ Options navigation（1026–1032） | 两版 `res/xml/audio_output.xml`、`audio_output_device_opts.xml` 的层级对比；1035 侧 `vr.smali`（4045 行） | **结构变化确证但未逐项解析**（见 §3.1 U9）。**该功能域归「音频输出」，本文不展开** |
| M20 | `<b>Webm</b>` format support（1026–1032） | `.rea-analysis/v1035/decoded/smali/ׅ/zs.smali:1328`（`"TYPE_WEBM"`）、`:1336`（`"webm"`）、`dy1.smali:9330`（`"webm"`） | **只在 1035 侧存在，1025 侧完全没有**（1025 `data/у.smali` 的 31 个类型里无 WEBM）。实现方式与 M10 完全同构：**新增 `TYPE_WEBM` 枚举 + 扩展名 `"webm"` 登记**。⚠️ 1025 的 `у.smali` 与 1035 的 `zs.smali` 是**同一角色的不同混淆名**，不可跨版本互搜 |
| ⚠️**未找到** M21 | `Audio Info` dialog updated ... provides `Fidelity` and `Processing` scores（1026–1032） | — | **未找到实现**（见 §3.1 U10）。1035 侧搜 `fidelity` 仅命中 AutoEq 预设名（`oa0.smali:9568`–`:9574` 的 "Innerfidelity ..."），**与评分无关**；1025 侧 `fidelity` 0 命中 |
| ⚠️**未找到** M22 | `<b>Limit button</b>` is now highlighted when overload is detected（1026–1032） | — | **未找到实现**（见 §3.1 U11）。两版搜 `overload` 只命中既有文案 `res/values/strings.xml:1439`（`pref_summary_dsp_border_gain`），与「按钮高亮」无关 |
| M23 | AutoEQ presets update（1026–1032） | 同 M1（`oa0.smali:3592`、`:3738`；`q71.smali:281`） | 与 M1 同机制，纯资产替换。这是该主题在本组第 5 次出现（971/978/997/1003/1026–1032 五区块） |
| ⚠️**未找到** M24 | removed the implicit 1.5x gain multiplier from Low Pass parametric filters（1033+） | — | **未找到实现**（见 §3.1 U12）。属 DSP 参数域，两版 `audio_equ.xml` / `peq_equ_bands.xml` 未见对应键；求值在 native（`libpowerampcore.so`），Java 侧无判据 |
| M25 | `Grant via Shizuku`（1026–1032 明细项；本组「设置杂项」区块的对应物） | 键：`.rea-analysis/v1035/decoded/res/xml/misc.xml:34`（`_long_volume_shizuku_grant`，`ProgressPreference`）；实现：`.rea-analysis/v1035/decoded/smali/ׅ/sa1.smali:286`、`:302`、`:314`、`:318`、`:332`、`:336`、`:341`、`:356`、`:361`、`:370`；`:951`；`:1002`；权限常量 `android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER`（`sa1.smali:314`）；Shizuku SDK：`smali/rikka/shizuku/ShizukuProvider.smali`、`smali/moe/shizuku/api/` | **做法极简**：`checkSelfPermission("android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER")`（`:318`）→ 有权限则 `setSummary(0x7f080436 = permission_granted)`（`:336`、`:341`）+ 启用（`:346`）+ 打勾图标 `0x7f020344 = settings_check_48dp`（`:356`、`:361`）；无权限则 `setSummary(0x7f0803bf = no_permission)`（`:370`）。**权限 grant 流程交给 Shizuku Provider 回调，自身不持 root** |
| M26 | `custom profiles` for USB and Bluetooth / Bluetooth codec sample rate matching / `Pause On USB DAC connection` / `Wired Headset/AUX` renamed（1026–1032 中与耳机相关的 4 项） | 见 H11–H14 | 本组不重复，已归入 §1.1 |

> **本表 26 行覆盖 40 条的原因**：14 条笼统条目（§3.2 单列）不占行；M18 是分节标题；
> M23/M1 是同一主题在不同区块重复出现（合计 6 次，按「条目」计 2 行）；M26 是 4 条耳机条目的归并指路。

---

## 2. 共性机制归纳

## 2.1 「一行注册 + 远端消费」是绝对主流的形态

59 条里凡涉及「新增一个设置项」的，实现都长这样：

| 层 | 1025 位置 | 1035 位置 | 规模 |
| --- | --- | --- | --- |
| ① UI 声明 | `res/xml/<page>.xml` 一行 | 同 | 1 行 |
| ② 偏好注册 | `com/maxmpz/audioplayer/prefs/В.smali` 内 5 行（`const-string` + `invoke` + `move-result` + `sput-object` + 空行） | `vr.smali` | 5 行/键 |
| ③ 消费 | **远离②**：`player/i.smali`(3159 行) / `player/H.smali`(3625 行) / `BaseActivity.smali`(2559 行) / `SleepTimerBehavior.smali`(618 行) | 各混淆类 | 1–N 处 |

**证据**：`prefs/В.smali` 中 `ignore_bt_sec`→`r2`（`:1837`、`:1843`）、`bt_ignore_repeat_shuffle`→`q2`（`:1829`、`:1835`）、`beep_more`→`v2`（`:1867`、`:1873`）、`follow_pl_exact`→`w2`（`:1875`、`:1881`）、`resume_on_focus`→`z2`（`:1897`、`:1903`）——**五个键全部集中在 1829–1903 这 75 行内**，而消费者分散在 4 个文件里。

> **对复刻的启示**：照抄这个分层是**合理**的（UI/存储/逻辑彻底解耦）；
> 但**照抄「靠静态 int 字段名（`r2`/`q2`/`v2`/`w2`/`z2`）读偏好」不可行**——
> 这些名字每版都变（1035 侧变成 `vr` 的 `x2` 等；注册表见 `vr.smali:3367`、`:3383`、`:3443`、`:3459`、`:3519`）。

## 2.2 布尔默认值全部硬编码在代码里，且「默认 true」居多

`prefs/В.smali` 的 `<clinit>` 开头定义了 `const/4 v2, 0x1`（`:389`）与 `const/4 v3, 0x0`（`:407`），
之后所有 `m->С(String,Z)` 调用都以 `v2`/`v3` 传默认值。实测：

| 键 | 默认 | 证据 |
| --- | --- | --- |
| `dvc_enabled` | **true** | `В.smali:387`–`:391` |
| `no_dvc_bt_absvol` | **true** | `В.smali:397`–`:399` |
| `af_permanent` / `af_short` / `af_short_duck` | **true** | `В.smali:877` / `:885` / `:893` + `:879` / `:887` / `:895` |
| `bt_ignore_repeat_shuffle` | false | `В.smali:1831`（`v3`） |
| `ignore_bt_sec` | **1 秒** | `В.smali:1839`（整型重载，传 `v2`=`1`） |
| `beep_more` | false | `В.smali:1869`（`v3`） |
| `follow_pl_exact` | **true** | `В.smali:1877`（`v2`） |
| `resume_on_focus` | **true** | `В.smali:1899`（`v2`） |

> **注**：`ignore_bt_sec` 用的是 `m->с(ILjava/lang/String;)` 整型重载，`В.smali:1839` 传 `v2`=`1`——
> 即**默认 1 秒**，而 XML 的 `w:min="0"`（`headset.xml:16`）。**「默认 1 秒」只能从代码得出，XML 里看不见**。

## 2.3 「路由类型 → 6 值枚举」是所有耳机行为的公共底座

H1（`ignore_bt_sec`）、H5（`resume_on_bt`）、H14（`pause_on_usb_connection`）三条**看似无关**的功能，
消费点全部落在同一个判型函数上：

```
t21->A(I)Z            t21.smali:7     // 合法性: 0 <= i <= 5
t21->А(I)String       t21.smali:700   // 0 headset / 1 speaker / 2 bt / 3 usb / 4 other / 5 chromecast
t21->B(String)I       t21.smali:35    // 反向: "usb"->3 (:143)  "bt"->2 (:163,:170)  "chromecast"->1 (:203)  "speaker"->0 (:244)
```

`uy.smali:1295` 的 `х(Context,Z,I,String,String,Z,Z)V` 里 `p2` 就是该枚举，
`:1307` 先 `A(I)Z` 过滤、`:1322` 保留原值到 `v5`、`:1710` 用 `v5 == 3` 判 USB。

> **对复刻的启示**：**这是全篇最值得照抄的一条**——把物理路由收敛成有限的规范枚举，
> 再让所有策略（恢复/暂停/忽略窗口）都只依赖枚举，而不是各自去问系统 API。

## 2.4 时间窗 + 时间戳是防误触的统一手段

同一套「记时间戳 → 算差值 → 比阈值」在至少 3 处复现：

| 场景 | 时间戳来源 | 阈值 | 证据 |
| --- | --- | --- | --- |
| `ignore_bt_sec` 忽略窗口 | `router/х->p`（路由变更）与 `bt/BTReceiver->А` | `ignore_bt_sec`×1000，**上限 20000** | `i.smali:1571`、`:1583`、`:1597`、`:1599`、`:1605` |
| 双击判定 | `PSMediaButtonReceiver->А` | 300 ms（`0x12c`）与 2000 ms（`0x7d0`） | `i.smali:1845`、`:2024`、`:2341` |
| Gemini 注入判据 | `PSMediaButtonReceiver->X` | 300 ms | `i.smali:1841`、`:1845` |

## 2.5 「笼统条目」在两版产物里都留不下痕迹——这是可证伪的

14 条笼统条目（§3.2）有个共同点：**在 `res/values/strings.xml` 里能找到 changelog 原文，
但在 smali / res 里找不到任何对应的新键、新类、新资源**。反过来，
**凡是真做了功能的条目，几乎都能找到一个新增的偏好键**（§1.3 的 26 行里 18 行有明确键名）。
这条规律可以用来快速甄别「是不是真有实现」。

---

## 3. 未找到实现的条目及排查说明

## 3.1 未找到实现的具体条目（13 条：部分找到 5 + 未找到 8）

> 每行末尾的**判定**列区分「部分」与「无」。按 §0 的口径，**部分找到** 5 条、
> **未找到** 8 条；后者含 §1.3 的 M11（`other small changes for Android 15`）。

| # | 条目 | 排查范围与关键词 | 结论 | 判定 |
| ---: | --- | --- | --- | :---: |
| U1 | Absolute Volume 无法检测的提示（H3 的**界面挂载点**） | 1025：全 `res/values*/strings.xml` 搜 `absvol`（4 条文案命中，`:24`–`:27`）；全 smali 搜 `absvol`、`AbsoluteVolume`、`isAbsoluteVolumeSupported`（命中 `player/absvol/A.smali`、`у.smali`）；搜 `0x7f08002d`（`absvol_detection_15` 的资源 id）→ **0 命中** | **文案存在、运行包存在，但引用点未定位**。⚠️ 该资源 id 在 1035 侧变为 `0x7f08002e`，**跨版 id 不可复用** | **部分** |
| U2 | custom profiles for USB and Bluetooth devices（H11） | 1025：`res/xml/*.xml` 与 `prefs/` smali 搜 `profile`（大小写不敏感）；1035：`vr.smali` 内 `profile` 相关键、`res/xml/audio_output*.xml` | **未找到实现**。属 1026–1032 区块，晚于 1025；该功能可能是 per-device 存储而非单一键，未能在有限检索内锁定 | **无** |
| U3 | Bluetooth codec sample rate matching（H12） | 1025：`player/bt/BTReceiver.smali` 全读（735 行），搜 `sample`、`rate`、`codec`；1035：`vr.smali` 搜 `bt_` 前缀键 | **部分证据**：codec 配置载体 `PaBluetoothCodecConfig` 存在（`BTReceiver.smali:24`、`:84`、`:96`），但「匹配」的决策点未定位 | **部分** |
| U4 | Spinorama txt presets importing（M3） | 1025：全 smali + 全 res 搜 `spinorama` → **0 命中**；`assets/` 列目录（8 项，无 spinorama 数据）；1035：同搜 → **0 命中**；另搜 `preset.*\.txt`、`import.*preset` | **未找到实现**。两版产物均 0 命中，该能力很可能在 **native 侧**完成，Java 侧不留痕迹 | **无** |
| U5 | hex color support in color dialogs（M5） | 1025：全 smali 搜 `parseColor`、`HexColor`、`#RRGGBB`、`hex`；`res/values*/strings.xml` 搜 `color dialog`、`hex` | **未找到实现**。仅 changelog 原文自身命中 `hex color`。可能是对话框内部输入校验，复用通用颜色解析而未留独立键 | **无** |
| U6 | Google Cast for Audio (GC4A) 2.0 support（M7） | 1025：`cast/`、`cc/`、`media/` 包内搜 `CAST_SDK_VERSION`、`cast_sdk_version`、`2\.0`；`CcPluginService.smali` 抽读 | **未找到实现**。「2.0」是协议版本声明，无对应 Java 判据；Cast SDK 版本号在 `com.google.android.gms.cast.*` 内部，非 app 侧可控 | **无** |
| U7 | improved FLAC metadata parsing（M8 的「改进」落点） | 1025：`decoder/flac/FlacPluginService.smali`、`data/у.smali` 中 `TYPE_FLAC`/`flac`；搜 `metadata`、`vorbis`、`picture` | **仅定位入口**。FLAC 元数据解析在 native decoder 内，Java 侧只有插件服务壳 | **部分** |
| U8 | Manage App If Unused 建议（M16 的挂载点） | 1025：全 smali 搜 `0x7f080196`（该文案 id）→ **0 命中**；搜 `disable_app_if_unused` 字符串名 → 0 命中（smali 用 id 不用名）；搜 `ManageAppIfUnused`、`app_unused` → 0 命中 | **文案存在（`strings.xml:329`）、引用点未定位**。与 U1 同一模式 | **部分** |
| U9 | simplified settings hierarchy（M19） | 对比两版 `res/xml/audio_output.xml`、`audio_output_device_opts.xml` 的 `w:target` 层级；1035 `vr.smali` 内 device opts 键 | **结构变化确证、未逐项解析**。⚠️ 该功能域归「音频输出」，本文不展开；建议由 audio-output 专文承接 | **部分** |
| U10 | Audio Info dialog 的 Fidelity/Processing 评分（M21） | 1025：全 res + 全 smali 搜 `fidelity` → **0 命中**；1035：搜 `fidelity` → 4 命中，**全部是 AutoEq 预设名**（`oa0.smali:9568`、`:9570`、`:9572`、`:9574` 的 "Innerfidelity ..."），与评分无关 | **未找到实现**。两版均无「评分」语义的 `fidelity` | **无** |
| U11 | Limit 按钮 overload 高亮（M22） | 1025 + 1035：搜 `overload` → 唯一命中 `res/values/strings.xml:1439`（`pref_summary_dsp_border_gain`，既有文案，与按钮高亮无关）；搜 `Limit`、`limiter`、`clip` | **未找到实现**。overload 判定在 DSP/native，「按钮高亮」的 UI 状态位未定位 | **无** |
| U12 | 移除低通参数滤波的隐式 1.5x 增益（M24） | 两版 `res/xml/audio_equ.xml`、`peq_equ_bands.xml` 搜 `gain`；smali 搜 `1\.5f`、`0x3fc00000`（1.5f 位模式） | **未找到实现**。系数在 native DSP，Java 侧无判据 | **无** |
| U13 | `other small changes for Android 15`（M11） | 1025 + 1035：搜 `targetSdk`（已确证 35/36）、`SDK_INT >= 0x23`(35) 的分支、`Build$VERSION_CODES` 中 35 相关常量；`res/values-v35/` 目录存在性 | **未找到实现**（判为「无」）。Android 15 适配为零散行为修正，无单一可指认的键或类；已确证的相关结论只有 targetSdk 升级（见 M12）与 BT codec 限制（H4），二者已单列。 | **无** |

> **U1 与 U8 属同一类**：**文案在、挂载点不在**。这类不应算「完全未找到」，
> 但也不能算「找到实现」。本文按「未找到」计入，并在表中如实标注已定位到的部分。

## 3.2 笼统条目（16 条，无可定位实现，不计入未找到统计）

这些条目**本身不指向任何具体功能**，直接标注，不做凑数式追查。

| # | 原文 | 出现区块 | 判定理由 |
| ---: | --- | --- | --- |
| G1 | `bug fixes and stability improvements` | 971 | 无对象 |
| G2 | `updated translations - huge thanks to all Crowdin translators!` | 971 | 无对象；见 §3.3 |
| G3 | `more features for this package in the next builds` | 978_fp | 前瞻承诺 |
| G4 | `updated translations` | 992 | 同 G2 |
| G5 | `battery, CPU usage, app size optimizations` | 997 | 无对象（app size 可从 `lib/` 三个 so 体积观察，但「优化」本身无判据） |
| G6 | `bug fixes and stability improvements` | 997 | 无对象 |
| G7 | `updated translations` | 997 | 同 G2 |
| G8 | `🎂the milestone 1000th build of Poweramp, celebrating 15 years...` | 1000 | 里程碑声明 |
| G9 | `bug fixes and stability improvements` | 1000 | 无对象 |
| G10 | `updated translations` | 1000 | 同 G2 |
| G11 | `bug fixes and stability improvements` | 1003 | 无对象 |
| G12 | `updated translations` | 1003 | 同 G2 |
| G13 | `<b>major Audio Engine update:</b> <ul>` | 102x | 分节标题 |
| G14 | `bug fixes, stability, and other small improvements` | 103x | 无对象 |

> **注 1**：989–991 附加项里的 `other small changes for Android 15`（M11）措辞指向「Android 15 适配」
> 这一具体域，故记在 §1.3 的 M11 行而非此处，**计入未找到统计**（§3.1 第 13 行）。
>
> **注 2**：本表 16 条 = 设置杂项组内的全部笼统条目。耳机蓝牙（15 条）与播放控制（4 条）
> **均无**笼统条目，故 16 条即全篇笼统条目总数。

## 3.3 关于 `updated translations`（G2/G4/G7/G10/G12）：这一条其实**可以**验证

虽然「翻译更新」是笼统条目，但它的**实现形态是可判定的**：

- 两版 `res/` 下均有大量 `values-*` 目录，实测含 `values-ar / -bn / -cs / -da / -de / -el / -es / -fa / -fr / -hu / -in / -it / -iw / -ja / -ko / -nl / -pl / -pt / -pt-rBR / -ro / -ru / -sk / -sr / -th / -tr / -uk / -vi / -zh / -zh-rCN / -zh-rTW` 等。
- 「更新翻译」= 向这些目录内的 `strings.xml` 重写条目，**不新增键**。
- 因此它**永远不可能**在 smali 里留下痕迹——列为「笼统条目」是正确的，不是偷懒。

> **可验证的间接判据**（将来需要时）：比对两版 `values-<locale>/strings.xml` 的文件大小与条目数。
> 本文不做（超出范围），仅记录方法。

---

## 4. 可借鉴 / 不建议照抄

## 4.1 值得借鉴

| 点 | 做法 | 证据 | 为什么值得 |
| --- | --- | --- | --- |
| **A. 路由类型规范枚举** | `0..5` 六值 + 双向映射 + 越界兜底 `Unknown_<i>` | `t21.smali:7`、`:35`、`:700`、`:743` | 把所有设备策略统一到一个判型函数，新增策略不改分派 |
| **B. 「时间窗」而非「开关」** | `ignore_bt_sec` 是 0–20 秒滑杆，不是布尔 | `headset.xml:16`、`i.smali:1597`、`:1605` | 比「忽略快捷键」这种粗糙开关精确得多，且默认值（1 秒）保守 |
| **C. 三键联动的恢复判定** | 恢复 = `(被电话暂停 && resume_after_call)` 或 `(被焦点暂停 && af_short && resume_on_focus)` | `H.smali:2881`–`:2900` | 把「谁暂停的」与「用户允许什么」显式分离，避免一锅炖 |
| **D. 位掩码做购买状态** | `h0->w0 & 1` 判 fp1，另有版本号 `>= 0xe5` 与「已隐藏」两个旁路 | `FeaturePackPref.smali:64`、`:70`、`:81`、`:85` | 一个 int 存多个包的购买位，扩展成本低 |
| **E. 搜索历史用「普通表 + 唯一索引去重 + 时间倒序索引」** | 两张索引各司其职 | `data/migrations/B.smali:4335`–`:4367` | 与 FTS 搜索表完全解耦，历史表可独立清理 |
| **F. 实验性选项统一加 `w:sup` 角标** | `w:sup="@string/pref_experiment"` + `w:supLink="alert?text=..."` | `misc.xml:22`、`:23`、`:29`；1035 `misc.xml:22`、`:23`、`:34`、`:35` | 风险标注在 UI 层声明式完成，无需代码介入 |
| **G. 16KB 页合规靠构建期对齐** | 三个 so 的 `PT_LOAD p_align` 全为 `0x4000` | 自解析 ELF（`lib/arm64-v8a/*.so`、`v1035/natives/*.so`） | 判据客观、可脚本化，不需要代码审查 |
| **H. 权限授予走 Shizuku 而非自持 root** | `checkSelfPermission("SET_VOLUME_KEY_LONG_PRESS_LISTENER")` → 只有 granted/no_permission 两态文案 | 1035 `misc.xml:34`、`sa1.smali:314`、`:336`、`:370` | 不在 app 内做提权，权限状态如实反映 |

## 4.2 不建议照抄

| 点 | 做法 | 证据 | 为什么不建议 |
| --- | --- | --- | --- |
| **✗ 1. 靠混淆后的静态字段名读偏好** | `В->r2` / `q2` / `v2` / `w2` / `z2` | `prefs/В.smali:1835`、`:1843`、`:1873`、`:1881`、`:1903` | 名字每版都变（1035 变 `vr` 的 `x2` 等），**不可维护**；应改为具名常量 |
| **✗ 2. 默认值只写在代码、UI 完全不可见** | `ignore_bt_sec` 默认 1 秒，XML 只有 `w:min="0"` | `В.smali:1839` vs `headset.xml:16` | 用户与外部复刻者都无法从 UI 得知默认值 |
| **✗ 3. 索引名字符串内混入多余空格** | `"settings_search_history_term  on "`（**两个空格**） | `data/migrations/B.smali:4357` | 拼接 SQL 的副作用；虽合法但极易在重构时踩坑 |
| **✗ 4. 用字符串包含判「是不是蓝牙」** | `StringsKt->х("bluetooth", src)` | `j.smali:540`、`:542` | 依赖上游 source 字符串拼写，脆弱；应为枚举 |
| **✗ 5. 魔数散落** | `0x12c`(300ms)、`0x7d0`(2000ms)、`0x4e20`(20000ms)、`0x3e8`(1000)、`240.0`、`61.0f`、`0xe5`(229) 全部内联 | `i.smali:1845`、`:2341`、`:1599`、`:1597`；`SleepTimerBehavior.smali:298`；`BaseActivity.smali:2015`；`FeaturePackPref.smali:81` | 无语义命名，**改一个忘一个**是必然 |
| **✗ 6. 「Beep More」的两级门隐藏语义** | `headset_beep` && `beep_more` 才 beep | `f1.smali:195`、`:201`、`:205` | 开「Beep More」若父项没开则毫无反应，UI 只靠 `android:dependency`（`headset.xml:19`）灰显，不说明「开了也没用」 |
| **✗ 7. 用 assets 里的 SQLite 整库替换做「数据更新」** | `auto_eq.db` 7.29 MB 整体替换 | `assets/auto_eq.db`；`oa0.smali:3592`、`:3738` | 无增量/无版本号，每次更新 APK 体积线性增长；用户侧自定义会被覆盖 |

---

## 5. 证据索引

## 5.1 XML / 资源（build-1025 主域）

| 证据 | 路径:行号 | 支撑条目 |
| --- | --- | --- |
| 耳机页 25 行全文 | `.rea-analysis/decoded/res/xml/headset.xml:1`–`:25` | H1–H8 |
| `ignore_bt_sec` 0–20 秒滑杆 | `headset.xml:16` | H1 |
| `bt_ignore_repeat_shuffle` | `headset.xml:17` | H2 |
| `follow_pl_exact`（dep=enable_headset_controls） | `headset.xml:15` | H8 |
| `beep_more`（dep=headset_beep） | `headset.xml:19` | H6 |
| `headset_beep` | `headset.xml:18` | H6 |
| `resume_on_bt` | `headset.xml:7` | H5 |
| `avrcp_controls` | `headset.xml:13` | H2（调用面）、H15（AVRCP 域） |
| 音频焦点页 18 行全文 | `.rea-analysis/decoded/res/xml/audio_focus.xml:1`–`:18` | P2、P4 |
| `resume_on_focus`（默认 true，dep=af_short） | `audio_focus.xml:13` | P4 |
| `af_short_duck`（默认 true，dep=af_short） | `audio_focus.xml:14` | P2 |
| `af_short` / `af_permanent` | `audio_focus.xml:11` / `:15` | P2 |
| misc 页 37 行全文 | `.rea-analysis/decoded/res/xml/misc.xml:1`–`:37` | M2、M16 |
| `op_framerate`（带实验角标） | `misc.xml:23` | M2 |
| Feature Packages 页 19 行全文 | `.rea-analysis/decoded/res/xml/feature_packages.xml:1`–`:19` | M6 |
| `move_fp1_to_about` | `feature_packages.xml:12` | M6 |
| `fp1`（FeaturePackPref，buttonOnly） | `feature_packages.xml:11` | M6 |
| `absvol` 文案组 | `.rea-analysis/decoded/res/values/strings.xml:24`–`:27` | H3、U1 |
| `disable_app_if_unused` 文案 | `strings.xml:329` | M16、U8 |
| 各区块 changelog 原文 | `strings.xml:231`(971) `:232`(978) `:233`(978_fp) `:234`(989) `:235`(989_2) `:236`(992) `:237`(997) `:228`(1000) `:229`(1003) `:230`(1017) | 全部 |
| `fv_iap_purchase` / `iap_on_gplay` | `strings.xml:450` / `:514` | M13 |
| 睡眠定时器旋钮布局 | `.rea-analysis/decoded/res/layout-sw2dp/merge_sleep_timer_popup_layout.xml:8`、`:9`、`:10` | P1、P3 |
| `SleepTimerRoundKnob` 样式 | `.rea-analysis/decoded/res/values/styles.xml:14980`、`:14995`–`:14997` | P1 |
| `maxDegree` / `minDegree` 属性定义 | `.rea-analysis/decoded/res/values/attrs.xml:3566`、`:3574` | P1 |
| 睡眠定时器消息/状态 id | `.rea-analysis/decoded/res/values/ids.xml:159`、`:198`、`:231`、`:1248` | P3 |
| **targetSdkVersion 35** | `.rea-analysis/decoded/apktool.yml`（`sdkInfo:` 段） | M12 |
| **auto_eq.db 体量与 schema** | `.rea-analysis/decoded/assets/auto_eq.db`（7 294 976 B；DDL 见 §5.4） | M1、M23 |

## 5.2 smali（build-1025）

| 证据 | 路径:行号 | 支撑条目 |
| --- | --- | --- |
| 偏好注册：`bt_ignore_repeat_shuffle`→`q2` | `prefs/В.smali:1829`、`:1835` | H2 |
| 偏好注册：`ignore_bt_sec`→`r2` | `prefs/В.smali:1837`、`:1843` | H1 |
| 偏好注册：`beep_more`→`v2` | `prefs/В.smali:1867`、`:1873` | H6 |
| 偏好注册：`follow_pl_exact`→`w2` | `prefs/В.smali:1875`、`:1881` | H8 |
| 偏好注册：`resume_on_focus`→`z2` | `prefs/В.smali:1897`、`:1903` | P4 |
| 偏好注册：`headset_beep`→`z0` | `prefs/В.smali:1029`、`:1035` | H6 |
| 偏好注册：`no_dvc_bt_absvol`→`H` | `prefs/В.smali:397` | H3 |
| 默认值常量 `v2`=1 / `v3`=0 | `prefs/В.smali:389`、`:407` | §2.2 |
| BT 忽略判定（纯布尔短路） | `player/j.smali:529`、`:532`、`:540`、`:542`、`:550`、`:564` | H2 |
| BT 忽略的 4 处调用方 | `player/l.smali:349`、`:374`、`:440`、`:1161` | H2 |
| `onSetShuffleMode` / `onSetRepeatMode` | `player/l.smali:427`(H)、`:1148`(Н) | H2 |
| BT 忽略的 widget 侧调用方 | `widget/player/f1.smali:248`、`:271`、`:326`、`:515` | H2 |
| `beep_more` 两级门（最典型） | `widget/player/f1.smali:195`、`:201`、`:205`、`:215` | H6 |
| `ignore_bt_sec` 时间窗计算 | `player/i.smali:1571`、`:1583`、`:1593`、`:1597`、`:1599`、`:1605` | H1 |
| `ignore_bt_sec` 判定与短路 | `i.smali:1611`、`:1619`、`:1635`、`:1660`、`:1670`、`:1692` | H1 |
| `follow_pl_exact` 键码门（0x7f/0x7e/0x56） | `i.smali:1083`、`:1087`、`:1089`、`:1093`、`:1097`、`:1102` | H8 |
| `follow_pl_exact` 下游分支 | `i.smali:2364`、`:2366`、`:2369`、`:2373`、`:2392`、`:2470`、`:2481`、`:2831`、`:2915` | H8、H9 |
| Gemini 注入判据 | `i.smali:1815`、`:1818`、`:1820`、`:1822`、`:1828`、`:1845`、`:1851`、`:1871` | H10 |
| 连击判定与脉冲 | `i.smali:1830`、`:1841`、`:1845`、`:1941`、`:1945`、`:1949`、`:2024`、`:2032`、`:2341` | H7 |
| `enable_headset_controls` 未开即忽略 | `i.smali:1711`、`:1713`、`:1715`、`:1717` | H1 前置 |
| 恢复判定（三键笛卡尔积） | `player/H.smali:2881`、`:2890`、`:2896`、`:2903`、`:2907`、`:2918`、`:2926` | P2、P4 |
| 恢复判定的日志字段 | `H.smali:2932`、`:2950`、`:2956`、`:2962` | P2 |
| 焦点丢失分支 | `H.smali:3161`、`:3172`、`:3199` | P2 |
| `af_permanent` 暂停 | `H.smali:3250`、`:3256` | P2 |
| **duck 分支** | `H.smali:3311`、`:3317`、`:3323`、`:3325`、`:3329`、`:3331`、`:3335` | P2 |
| `setWillPauseWhenDucked` 构建 | `player/O.smali:79`、`:83`、`:133` | P2 |
| duck → 输出管线下发 | `player/PlayerService.smali:12568`、`:12588`、`:12601`、`:12604` | P2 |
| duck 到 native 管线 | `processing/Pipeline2.smali:3001`、`:3052`、`:3057`、`:3062` | P2 |
| 睡眠定时器 0–240 分钟 | `widget/player/SleepTimerBehavior.smali:294`、`:298`、`:300` | P1 |
| 睡眠定时器确认（×60 秒） | `SleepTimerBehavior.smali:338`、`:359`、`:369`、`:371` | P1、P3 |
| 睡眠定时器回写偏好 | `SleepTimerBehavior.smali:401`、`:413` | P1 |
| `handleOnSleepTimer` | `player/H.smali:2820` | P3 |
| 蜂鸣下发入口 | `player/PSMediaButtonReceiver.smali:66`、`:81` | H6 |
| 按键序列静态字段 | `PSMediaButtonReceiver.smali:6`(A)、`:12`(X)、`:18`(А) | H7、H10 |
| 设置搜索历史 DDL | `data/migrations/B.smali:4188`、`:4303`、`:4309`、`:4313`、`:4317`、`:4319`、`:4323`、`:4325` | M4 |
| 设置搜索历史两索引 | `data/migrations/B.smali:4335`、`:4341`、`:4355`、`:4357`、`:4359` | M4 |
| 设置搜索历史 DAO | `rest/library/y3.smali:31`、`:33`、`:37` | M4 |
| 设置搜索 FTS（对照） | `y3.smali:121`、`:125`、`:129` | M4 |
| FeaturePack 购买门 | `preference/FeaturePackPref.smali:57`、`:60`、`:64`、`:70`、`:77`、`:81`、`:85` | M6 |
| FeaturePack 置位提交 | `FeaturePackPref.smali:118`、`:120`、`:126` | M6 |
| `op_framerate` 注册 | `widget/player/h0.smali:836`、`:842` | M2 |
| `op_framerate` 默认 false | `h0.smali:274`（`const/4 v4, 0x0`） | M2 |
| `move_fp1_to_about` 注册 | `h0.smali:1263`、`:1269` | M6 |
| `op_framerate` 唯一消费者 | `common/BaseActivity.smali:1943`、`:1945`、`:1947`、`:1949`、`:1968`、`:1999`、`:2011`、`:2015`、`:2033`、`:2039`、`:2050` | M2 |
| Play Billing 解锁短路 | `common/BaseMainActivity.smali:590`、`:596`、`:598`、`:600`、`:601` | M13 |
| BT codec extra 双键探测 | `player/bt/BTReceiver.smali:24`、`:84`、`:96`、`:570`、`:573`、`:579`、`:587` | H4、H12 |
| 解码器类型/扩展名登记（31 项） | `data/у.smali:57`、`:61`、`:111`、`:577`、`:581`、`:593` | M10、M20 |
| 路由包（1025 侧对应物） | `player/router/`（`A/B/X/y/А/В/К/у/х` 共 9 类） | M9 |
| `FlacPluginService` | `decoder/flac/FlacPluginService.smali:1` | M8 |

## 5.3 smali / 资源（build-1035，1026+ 条目专用）

| 证据 | 路径:行号 | 支撑条目 |
| --- | --- | --- |
| 耳机页 26 行（新增 USB 项） | `.rea-analysis/v1035/decoded/res/xml/headset.xml:8` | H14 |
| `pause_on_usb_connection` 注册 | `.rea-analysis/v1035/decoded/smali/ׅ/vr.smali:3519` | H14 |
| `bt_ignore_repeat_shuffle`（1035 对应物） | `vr.smali:3367` | H2 |
| `ignore_bt_sec`（1035） | `vr.smali:3383` | H1 |
| `beep_more`（1035） | `vr.smali:3443` | H6 |
| `follow_pl_exact`（1035） | `vr.smali:3459` | H8 |
| USB 忽略判定 | `uy.smali:1295`、`:1307`、`:1322`、`:1691`、`:1710`、`:1714`、`:1736` | H14 |
| 路由枚举双向映射 | `t21.smali:7`、`:11`、`:18`、`:35`、`:143`、`:163`、`:170`、`:203`、`:244`、`:700`、`:743`、`:747`、`:758`、`:766`、`:774`、`:782`、`:790`、`:799` | H14、M9 |
| `resume_on_bt` / `resume_on_headset`（1035） | `uy.smali:1368`、`:1372` | H5 |
| AVRCP metadata 组装函数 | `ar.smali:3230` | H15 |
| genre 取值链 | `ar.smali:3362`、`:3370`、`:3378`、`:3402`、`:3406` | H15 |
| `bt_ignore_repeat_shuffle` 打点（1035） | `dy1.smali:6776` | H2 |
| `ignore_bt_sec` 打点（1035） | `rk0.smali:3119` | H1 |
| `follow_pl_exact` 打点（1035） | `rk0.smali:2250` | H8 |
| AutoEq 导入入口 | `oa0.smali:3592`、`:3738`、`:9568`–`:9574` | M1、M23、U10 |
| AutoEq 清设备记忆 / 导入 | `q71.smali:251`、`:281` | M1 |
| 设置搜索历史 DDL（1035） | `qa0.smali:530`、`:587`、`:595`、`:628`、`:632` | M4 |
| `op_framerate`（1035） | `sa1.smali:1212`、`wr.smali:1473` | M2 |
| WebM 类型登记 | `zs.smali:1328`、`:1336`、`dy1.smali:9330` | M20 |
| Shizuku 授权 UI | `sa1.smali:286`、`:302`、`:314`、`:318`、`:332`、`:336`、`:341`、`:346`、`:356`、`:361`、`:370` | M25 |
| misc 页 38 行（新增 Shizuku 项） | `.rea-analysis/v1035/decoded/res/xml/misc.xml:34`、`:35` | M25 |
| Shizuku SDK | `smali/rikka/shizuku/ShizukuProvider.smali`、`smali/rikka/shizuku/ShizukuRemoteProcess.smali`、`smali/moe/shizuku/api/BinderContainer.smali` | M25 |
| **targetSdkVersion 36** | `.rea-analysis/v1035/decoded/apktool.yml`（`sdkInfo:` 段） | M12 对照 |
| 102x / 103x changelog 原文 | `.rea-analysis/v1035/decoded/res/values/strings.xml:250`、`:251` | 全篇版本域判据 |
| `pause_on_usb_connection` 资源 id | `.rea-analysis/v1035/decoded/res/values/public.xml:5093`（`0x7f08041f`） | H14 |

## 5.4 二进制 / 资产（自解析，非工具输出）

| 证据 | 方法与结果 | 支撑条目 |
| --- | --- | --- |
| 16 KB 页对齐 | 自解析 ELF64 program headers：`lib/arm64-v8a/libffmpeg_neon.so`、`libpowerampcore.so`、`libyayicn.so` 的 3 个 `PT_LOAD` 全部 `p_align=0x4000`；`v1035/natives/{libffmpeg_neon,libpowerampcore}.so` 同样 `0x4000` | M14 |
| AutoEq 库 | 自解析 SQLite 头：`SQLite format 3`，`pageSize=4096`，`pageCount=1781`，`size=7294976`；表 `eq_presets(_id INTEGER PRIMARY KEY, name TEXT, meta TEXT, parametric INTEGER, data_blob BLOB)`、`android_metadata(locale TEXT)` | M1、M23 |
| changelog 键存在性 | 逐文件读 `res/values/strings.xml` 统计 `<string name="changelog_*"`：**1025 = 10 个**（`971/978/978_fp/989/989_2/992/997/1000/1003/1017`）；**1035 = 11 个**（多 `102x`、`103x`） | 全篇版本域 |

## 5.5 复验命令（PowerShell，可直接跑）

```powershell
# ① 版本域判据：两个 build 各自的 changelog 区块
$b1025 = Get-Content -Raw -Encoding UTF8 '.rea-analysis/decoded/res/values/strings.xml'
$b1035 = Get-Content -Raw -Encoding UTF8 '.rea-analysis/v1035/decoded/res/values/strings.xml'
"1025 keys: " + (([regex]::Matches($b1025,'name="(changelog_[a-z0-9_]+)"') | ForEach-Object { $_.Groups[1].Value }) | Sort-Object -Unique) -join ', '
"1035 keys: " + (([regex]::Matches($b1035,'name="(changelog_[a-z0-9_]+)"') | ForEach-Object { $_.Groups[1].Value }) | Sort-Object -Unique) -join ', '

# ② targetSdk 判据
Select-String -Path '.rea-analysis/decoded/apktool.yml','.rea-analysis/v1035/decoded/apktool.yml' -Pattern 'targetSdkVersion|versionCode|versionName'

# ③ 偏好字段行号复验（任取两条）
$l = Get-Content -Encoding UTF8 '.rea-analysis/smali/smali/com/maxmpz/audioplayer/prefs/В.smali'
$l[1836]   # 期望： const-string v1, "ignore_bt_sec"
$l[1874]   # 期望： const-string v1, "follow_pl_exact"

# ④ 16KB 对齐复验（需 python/readelf；无则跳过）
#    期望每个 PT_LOAD 的 align 都是 0x4000
```

---

## 附：本文与既有文档的关系

| 既有文档 | 关系 |
| --- | --- |
| `poweramp-headset-complete.md` | **权威参考（build-1035）**。本文 H1–H10 的键位与它一致，但本文补充了「changelog 条目 ↔ 实现」的对应关系与 1025 侧行号；两者不冲突 |
| `poweramp-headset-settings.md` / `-subtree.md` / `-full-implementation.md` | 已被 `-complete` 取代（`status: superseded`）。**本文不引用其结论** |
| `poweramp-misc-complete.md` | misc 页权威参考。本文 M2/M16/M25 与之对应，不重复其全页解析 |
| `poweramp-settings-search.md` | 设置搜索本体。本文 M4 只补「历史表」的 DDL 与索引设计，搜索算法不重复 |
| `poweramp-settings-export-import.md` | 导入导出。**本文未涉及**（该组条目不在本文 59 条内） |
| `poweramp-feature-votes.md` | 投票清单。本文 M6 只解析 Feature Package 的**代码门控**，商务内容不重复 |
| `poweramp-release-changelog.md` | changelog 原文。本文是对其中 59 条的逆向 |

---

## 附：本次任务的版本域更正记录

任务初始假设「59 条全部在 build-1025 中取证」。经实测推翻了这一假设：

| 区块 | 1025 是否存在 | 1035 是否存在 | 处置 |
| --- | --- | --- | --- |
| `changelog_971` / `978` / `978_fp` / `989` / `989_2` / `992` / `997` / `1000` / `1003` | ✅ | ✅ | 在 1025 取证 |
| `changelog_102x`（1026–1032） | ❌ | ✅ | 改在 1035 取证（H11–H14、M18–M25） |
| `changelog_103x`（1033+） | ❌ | ✅ | 改在 1035 取证（H15、M24） |

判据见 §5.4「changelog 键存在性」与 §5.5 命令 ①。
**受影响条目共 12 条**（H11–H15、M18–M25）。其中 **4 条完整找到**（H14、H15、M20、M25）、
**1 条部分找到**（M19）、**7 条未找到或属笼统**（H11、H12、M18=分节标题、M21、M22、M24，
以及 M23 与 M1 同机制）。
