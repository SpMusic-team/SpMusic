---
doc_id: poweramp-headset-complete
title: Poweramp「设置 → 耳机/蓝牙」完整参考（根页 + 3 个下钻 + 运行时全链路）
doc_type: architecture
status: draft
owner_agent: lead
version_scope: build-1035-bundle-play (versionCode 1035009)
created: 2026-11-07
updated: 2026-11-07
consolidates:
  - poweramp-headset-settings.md
  - poweramp-headset-full-implementation.md
  - poweramp-headset-subtree.md
source_documents:
  - .rea-analysis/v1035/decoded/res/xml/headset.xml
  - .rea-analysis/v1035/decoded/res/xml/commands_history.xml
  - .rea-analysis/v1035/decoded/res/xml/audio_focus.xml
  - .rea-analysis/v1035/decoded/res/xml/misc.xml
  - .rea-analysis/v1035/decoded/res/values/strings.xml
  - .rea-analysis/v1035/decoded/res/values/arrays.xml
  - .rea-analysis/v1035/decoded/res/values/public.xml
  - .rea-analysis/v1035/decoded/smali/ׅ/u91.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/s91.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/t91.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/o91.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/jo0.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/hf1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/zm.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/rk0.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/w8.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/z61.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/tc.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/x11.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/sa1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/x80.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/qd0.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/vr.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/u61.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/n91.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/SettingsActivity.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/PrefBase.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RedirectPreference.smali
  - docs/architecture/poweramp-settings-page-runtime.md
---

# Poweramp「设置 → 耳机/蓝牙」完整参考

> **证据分级**：【实证·原文】= XML/资源原文；【实证·产物】= 反编译 smali；【推断】= 无直接代码佐证。
>
> 全部基于 **build-1035-bundle-play**（`versionCode 1035009`）。
>
> **本文取代** `poweramp-headset-settings.md`、`poweramp-headset-full-implementation.md`、`poweramp-headset-subtree.md` 三份旧文，内容已合并去重。
>
> **共享机制不重述**：三层骨架、`n91` 基类契约、`restore_defaults` 删 key 语义、`"global"` 共享存储、`C`=父页 id —— 见 `poweramp-settings-page-runtime.md`。

### 阅读导引

| 想知道什么 | 去第几节 |
| --- | --- |
| 页面有多大、18 个 key 是什么 | **§1 / §2** |
| 每项的实际文案与资源名 | **§2 / §3** |
| 三层依赖链怎么实现的 | **§4** |
| helper 只做 8 件事的细节 | **§5** |
| 每个开关改动的实际效果 | **§6** |
| 为什么 18 个 key 只要 298 行 | **§7** |
| 3 个下钻目标分别是什么 | **§8** |
| `commands_history` 完整实现 | **§9** |
| `audio_focus` 完整实现 | **§10** |
| `long_volume_controls` 的 Shizuku 门槛 | **§11** |
| **按键在运行时怎么被处理** | **§12**（状态机）|
| **三道防误触机制** | **§13** |
| 跨页跳转的解析链 | **§14** |
| 未解 / 已知边界 | **§15** |
| 证据索引 | **§16** |

---

## 0. 一句话结论

耳机/蓝牙页共 **18 个 key / 25 行 / 4437 字节**，helper `u91` 只有 **298 行且只做 8 件事**——其余 **10 个 key 完全零代码**。真正的复杂度全在**页面之外**：14 个偏好字段由 **8 个运行时类**消费，其中 `rk0`（`PSMediaButtonReceiver`，**99295 字节 / 5736 行**，核心方法 4328 行）是耳机按键的总入口。

> **这是"设置页极简、消费者极重"的典型样本。**
>
> **整个子树**：1 个真子页（`commands_history`）+ 2 个跨分支跳转（`audio_focus` 属音频、`misc#long_volume_controls` 属 misc）。

---

## 1. 页面身份

| | |
| --- | --- |
| XML | `res/xml/headset.xml` |
| 资源 id | **`0x7f160015`** |
| 行数 / 字节 | 25 / 4437 |
| 元素总数 | 21（含 2 个 `PreferenceCategory`）|
| 带 key 项 | **18**（唯一，无重复）|
| 页面标题 | `@string/pref_headset_bt` = **"Headset/Bluetooth"** |
| helper | **`ׅ/u91.smali`**（6552 B / 298 行，`extends n91`）|
| 父页（`n91->C`）| `0x7f160026`（`singlepane`）|
| 分发位置 | `u61.smali:1357-1375` |

> **helper 规模全设置树倒数第二小**，但消费它的 `rk0` 是**全树最大的消费者**。

---

## 2. 18 个 key 逐条

**np** = `persistent="false"`；**dep** = `android:dependency`。**全部条目都没有 `android:defaultValue`** —— 默认值全在 `vr` 代码里（见 §6.1）。

### 2.1 分类一 `pref_headset_connection` = 「Connection」（5 项）

【实证·原文】`headset.xml:4-10`

| # | key | 控件 | 标题 | 摘要 | 标志 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `resume_on_headset` | MultilineSwitch | **Resume On Wired Headset** | Resume playing when wired headset is connected | persistent=true |
| 2 | `resume_on_bt` | MultilineSwitch | **Resume On Bluetooth** | Resume playing when Bluetooth device is connected | persistent=true |
| 3 | `pause_on_headset` | MultilineSwitch | **Pause On Headset Disconnect** | Pause when wired/Bluetooth headset/USB DAC disconnected | persistent=true |
| 4 | `pause_on_usb_connection` | MultilineSwitch | **Pause On USB DAC connection** | Pause when USB DAC connected. This helps prevent loud noise during device initialization on some USB DACs | — |
| 5 | *（无 key）* | Redirect → `audio_focus` | **Audio Focus** | Few other play/resume options are available in Audio Focus settings | skipSearch |

> 第 5 项**没有 key**，是纯跳转行。

### 2.2 分类二 `pref_headset_buttons` = 「Buttons」（11 项）

【实证·原文】`headset.xml:11-23`。分类**自身带 key `headset_buttons`**。

| # | key | 控件 | 标题 | 摘要 | 依赖 | 标志 |
| ---: | --- | --- | --- | --- | --- | --- |
| 6 | `enable_headset_controls` | MultilineSwitch | **Respond To Buttons** | Enable Headset/Bluetooth controls | — | persistent=true |
| 7 | `headset_controls` | **TagList** | **Wired Headset** | — | — | entries |
| 8 | `avrcp_controls` | **TagList** | **Bluetooth** | — | — | entries（**同一数组**）|
| 9 | `long_volume_press` | Redirect → `misc#long_volume_controls` | **（无标题）** | Press here for Volume keys long press option | — | skipSearch |
| 10 | `follow_pl_exact` | MultilineSwitch | **Strict Resume/Pause/Stop** | Use for headunits/devices generating stray play/pause/stop key press commands, which are interpreted as undesired playback toggle or double press | **`enable_headset_controls`** | persistent=true |
| 11 | `ignore_bt_sec` | **Seekbar** | **Ignore Bluetooth Commands** | Ignore all Bluetooth commands for a period of time after a connection | — | min=0 max=20，summary2=`%d sec`，两端标签 0/20，有 tickMark |
| 12 | `bt_ignore_repeat_shuffle` | MultilineSwitch | **Ignore Repeat/Shuffle** | Ignore Bluetooth Repeat and Shuffle commands completely | — | — |
| 13 | `headset_beep` | MultilineSwitch | **Beep** | — | **`enable_headset_controls`** | persistent=true |
| 14 | `beep_more` | MultilineSwitch | **Beep More** | Beep on all commands, such as from notifications or other controls | **`headset_beep`** | persistent=true |
| 15 | `headset_vibrate` | MultilineSwitch | **Vibrate** | — | **`enable_headset_controls`** | persistent=true |
| 16 | `no_android_long_press` | MultilineSwitch | **Disable Default Long Press** | Disable long press activated voice search while Poweramp is playing | — | persistent=true |

### 2.3 分类外（2 项）

| # | key | 控件 | 标题 | 目标 |
| ---: | --- | --- | --- | --- |
| 17 | `commands_history` | Redirect | **Last Processed Commands** | `commands_history` |
| 18 | `restore_defaults` | Preference | Restore Defaults | — |

### 2.4 三个属性细节

| 现象 | 说明 |
| --- | --- |
| **9 项显式 `persistent="true"`** | 冗余（`Preference` 基类默认即 true），但说明作者在"关键开关"上刻意强调 |
| **`long_volume_press` 无 `title`** | 只有 `summary`，界面上是空标题行。对比同页 `audio_focus` 跳转有标题——**同为跳转却不对称** |
| **`headset_controls` / `avrcp_controls` 无 summary** | 两个 TagList 都没写摘要，靠标题区分（Wired Headset / Bluetooth）|

---

## 3. 资源完整解析

### 3.1 `@array/pref_headset_controls_entries` 逐项展开

【实证·原文】`arrays.xml`

| 索引 | 引用 | 实际英文文案 | **存储值** |
| ---: | --- | --- | ---: |
| 0 | `@string/pref_controls_single` | **Single press** | 0 |
| 1 | `@string/pref_controls_double_triple` | **Double/triple press for next/prev. track** | 1 |
| 2 | `@string/pref_controls_long` | **Long press for next track (when playing)** | 2 |

> 数组**只有 3 项**，且**没有**配对的 `w:values` / `w:summaries` / `w:icons`（对比 `ui_mediaactions.xml` 四件套齐全）。所以 UI 上是**三选一的选择列表**，不是带图标的动作选择器。
>
> **存储值 = 索引**（0/1/2），`s91` 里用 `== 2` 判断"长按"分支，与索引 2 精确吻合。

### 3.2 其余资源

| 资源 | 用途 |
| --- | --- |
| `@drawable/pref_seekbar_tickmark` | `ignore_bt_sec` 滑杆刻度 |
| （无其他 drawable）| **headset 页没有任何自定义图标**，全部走默认样式 |

**本页没有引用任何 `@string` 之外的外部资源**（除 tickMark）。

---

## 4. 三层依赖链

### 4.1 结构

```
enable_headset_controls          ← 母开关（Respond To Buttons）
  ├─ follow_pl_exact             ← 严格模式
  ├─ headset_beep                ← 蜂鸣
  │    └─ beep_more              ← 蜂鸣更多（二级）
  └─ headset_vibrate             ← 振动
```

### 4.2 关键：**这条链没有代码**

对 `u91.smali` 全文扫描【实证·产物】：

| 检查项 | 结果 |
| --- | --- |
| `setEnabled(...)` 调用 | **0** |
| `notifyDependencyChange(...)` 调用 | **0** |
| 涉及依赖的 `findPreference` | **0**（除 `enable_headset_controls` 自身绑监听）|

**三层依赖完全由 XML 的 `android:dependency` 声明式完成**，Android `Preference` 框架自动处理"母开关关闭 → 子项置灰"。

> **这解释了为什么 18 个 key 只需要 298 行 helper。**
>
> 对比：`aa_bg` 页有 6 条 `android:dependency` 却用了 25783 B 的 helper —— 因为那页还要把参数推给 native 渲染器；headset 页的依赖纯是 UI 门控。

---

## 5. `u91.v()` 的完整实现（8 件事）

`u91` 只有**一个方法** `v()`（290 行，其余是类声明）【实证·产物】`u91.smali:7-297`：

| # | 动作 | 对象 | 绑定 | 定位 |
| ---: | --- | --- | --- | --- |
| 1 | 绑监听 | `resume_on_bt` | `s91(this, **0**)` | `:15-39` |
| 2 | 绑监听 | `enable_headset_controls` | `s91(this, **1**)`（带 `if-eqz` 空检查）| `:48-76` |
| 3 | 绑监听 | `headset_controls` | `s91(this, **2**)` | `:82-110` |
| 4 | 绑监听 | `avrcp_controls` | `s91(this, **3**)` | `:115-143` |
| 5 | **条件移除** | `long_volume_press` | SDK < 26 时 `removePreference` | `:148-200` |
| 6 | 绑监听 / **条件移除** | `no_android_long_press` | SDK ≤ 33 绑 `s91(this, **4**)`，否则移除 | `:206-255` |
| 7 | 绑点击 | `restore_defaults` | `x11(0xb, this)` | `:262-291` |
| 8 | — | 其余 10 个 key **零代码** | — | — |

### 5.1 两处 SDK 条件移除（唯一的"动态删除"）

```asm
; ⑤ long_volume_press —— SDK < 26 从分类里移除（:148-205）
164: check-cast v0, Landroid/preference/PreferenceGroup;   ; ★ 转成分类
188: const/16 v3, 0x1a                                   ; 26
192: if-ge v2, v3, :cond_1                               ; SDK < 26 ?
196: if-eqz v1, :cond_1                                  ; 且条目存在
200: invoke-virtual {v0, v1}, PreferenceGroup;->removePreference

; ⑥ no_android_long_press —— SDK > 33 移除（:206-255）
226: const/16 v3, 0x21                                   ; 33
230: if-gt v2, v3, :cond_2                               ; SDK <= 33 → 绑定 s91(4)
255: invoke-virtual {v0, v1}, PreferenceGroup;->removePreference   ; SDK > 33 → 删
```

| 条目 | 保留条件 | 理由 |
| --- | --- | --- |
| `long_volume_press` | **SDK ≥ 26** | Android 8.0 起才支持音量键长按拦截 |
| `no_android_long_press` | **SDK ≤ 33** | Android 14（34）起系统长按行为改变，此项失去意义 |

> **区间互补**（`≥26` 与 `≤33` 交叠于 26–33）：SDK 26–33 两项都在，<26 只有 `no_android_long_press`，>33 只有 `long_volume_press`。
>
> **技术要点**：这两处**直接调 `removePreference` 而非 `n91.h(key)`**——要删的是**分类里的子项**，而 `n91.h()` 只在根 `K` 上 `findPreference`。这是本页 helper 必须自己写这几行的原因。

### 5.2 零代码的 10 个 key

`resume_on_headset`、`pause_on_headset`、`pause_on_usb_connection`、`follow_pl_exact`、`ignore_bt_sec`、`bt_ignore_repeat_shuffle`、`headset_beep`、`beep_more`、`headset_vibrate`、`commands_history`。

> 这 10 项的值被运行时类**直接读取**（见 §6），无需在设置页做任何即时响应。

---

## 6. 14 个偏好字段与 8 个消费者

### 6.1 `vr` 中的字段映射（权威）

【实证·产物】`vr.smali`：

| key | `vr` 字段 | 定义行 | 类型 |
| --- | --- | ---: | --- |
| `resume_on_headset` | `vr->q0` | 1580 | `pb1`（bool）|
| `resume_on_bt` | `vr->r0` | 1596 | `pb1` |
| `pause_on_headset` | `vr->v0` | 1660 | `pb1` |
| `enable_headset_controls` | `vr->y0` | 1708 | `pb1` |
| `headset_beep` | `vr->z0` | 1724 | `pb1` |
| `headset_vibrate` | `vr->A0` | 1740 | `pb1` |
| `headset_controls` | `vr->B0` | 1756 | **`rb1`（int）** |
| `avrcp_controls` | `vr->C0` | 1772 | **`rb1`（int）** |
| `no_android_long_press` | `vr->D0` | 1788 | `pb1` |
| `bt_ignore_repeat_shuffle` | `vr->n2` | 3367 | `pb1` |
| `ignore_bt_sec` | `vr->o2` | 3383 | **`rb1`（int）** |
| `beep_more` | `vr->s2` | 3443 | `pb1` |
| `follow_pl_exact` | `vr->t2` | 3459 | `pb1` |
| `pause_on_usb_connection` | `vr->x2` | 3519 | `pb1` |

> **全部 14 个字段都在 `vr` 中，没有一个在 `gr`**。这与 `misc` 页（两个类分散）形成对比。

### 6.2 8 个消费者类

【实证·产物】扫描全包：

| 消费者 | 规模 | 身份 | 消费的 key |
| --- | ---: | --- | --- |
| **`rk0`** | 99295 B / 5736 L | **`PSMediaButtonReceiver`**（耳机按键接收器）| **8 个**：`enable_headset_controls`、`headset_controls`、`avrcp_controls`、`follow_pl_exact`、`ignore_bt_sec`、`headset_beep`、`beep_more`、`headset_vibrate` |
| `dy1` | 184412 B / 10916 L | 抽象播放控制基类 | `enable_headset_controls`、`headset_controls`、`bt_ignore_repeat_shuffle`、`no_android_long_press` |
| `uy` | 37097 B / 2265 L | 音频设备/连接管理 | `resume_on_headset`、`resume_on_bt`、`pause_on_usb_connection` |
| `w4` | 19137 B / 937 L | Runnable | `resume_on_headset`、`resume_on_bt` |
| `ud0` | 22965 B / 1349 L | `jd0` 子类（传统 MEDIA_BUTTON）| `headset_beep`、`beep_more` |
| `uk0` | 48184 B / 2665 L | `jd0` 子类（MediaSession 扩展）| `headset_beep`、`beep_more` |
| `w80` | 12804 B / 721 L | 抽象类 | `headset_beep`、`headset_vibrate` |
| `dk0` / `v4` / `jl0` | — | 播放控制 | `pause_on_headset`、`enable_headset_controls` |

> **`rk0` 消费 8 个 key**，是绝对的核心。它是 Android 的 `MediaButtonReceiver` 实现，所有耳机/蓝牙按键都从它进来。

### 6.3 `s91` 监听器：4 个 case + default

`s91`（8134 B / 394 行）唯一方法 `onPreferenceChange`（355 行），`packed-switch`（`:386-392`）**只有 4 项**，但 `u91` 传了 **5 个索引**（0/1/2/3/4）——**索引 4 落到 default**。

| idx | key | 触发条件 | 动作 | 行 |
| ---: | --- | --- | --- | --- |
| **0** | `resume_on_bt` | 新值 **true** | `n91.F(0x7f0805fe, 0x7f08076f)` 弹"蓝牙连接需要几秒"提示（只有 OK）| `:347-379` |
| **1** | `enable_headset_controls` | 任意 | `handler.post(new b6(this, 0x1d=29))` | `:321-344` |
| **2** | `headset_controls` | 新值 **== 2** | 弹框（标题 `wired_headset`，正文 `pref_long_press_warning`）+ `post(t91(this, 0))` | `:232-318` |
| **3** | `avrcp_controls` | 新值 **== 2** | 弹框（标题 `bluetooth_headset`，正文同上）；**不 post 任何命令** | `:159-228` |
| **4** | `no_android_long_press` | 新值 **true** | 弹框（标题 `pref_no_android_long_press`，正文同上）+ `post(t91(this, 1))` | `:69-156`（default）|

> **每个分支末尾都是 `return 1`** → 变更一律放行，弹框只是**告知**而非**拦截**。这与锁屏页 `la1.I()` 返回 `false` 回滚开关**语义完全相反**。
>
> **真实的非对称**：`headset_controls`（线控）和 `avrcp_controls`（蓝牙）弹同一个"长按可能失效"提示，但**只有线控 post `t91(0)` 刷新**，蓝牙不刷新。

### 6.4 两个 Runnable 与 MsgBus 落地

**`t91`**（2221 B / 122 行）只有 `run()`（switch 2 项）【实证·产物】：

| 索引 | 发送的消息 | 资源名 | 含义 |
| ---: | --- | --- | --- |
| **0** | `0x7f0d0508` | **`cmd_player_apply_long_volume_controls`** | 应用长按音量键配置 |
| **1**（default）| `0x7f0d048c` | **`cmd_player_refresh_headset_controls`** | 刷新耳机按键控制配置 |

总线 id 均为 `0x7f0d0034`（`bus_player_cmd`）。

**`b6`**（67562 B / 3529 行，索引 29 = default）【实证·产物】`b6.smali:91-147`：

```java
MsgBus.post(0x7f0d048b,                    // cmd_player_enable_headset_controls
            newValue ? 1 : 0,              // 直接透传开关状态
            0, null);
```

> **`enable_headset_controls` 的实际生效方式**：通过 `cmd_player_enable_headset_controls` 消息把布尔值**实时推送给播放内核**，无需重启。

### 6.5 三条消息的完整语义

| 消息 id | 资源名 | 触发来源 | 效果 |
| --- | --- | --- | --- |
| `0x7f0d048b` | `cmd_player_enable_headset_controls` | `s91` idx 1 → `b6[29]` | **开关总闸**（是否响应按键）|
| `0x7f0d048c` | `cmd_player_refresh_headset_controls` | `s91` idx 2/4 → `t91[0/1]` | **刷新按键配置**（单击/双击/长按模型）|
| `0x7f0d0508` | `cmd_player_apply_long_volume_controls` | `t91[0]` | **应用长按音量键配置** |

### 6.6 `restore_defaults` 链路

`s91`/`u91` 自身不处理，走 `x11(0xb, this)`。

| 环节 | 定位 | 内容 |
| --- | --- | --- |
| 绑定 | `u91.smali:278-286` | `const/16 v2, 0xb`（索引 11）|
| 分发 | `x11.smali:849-875` | 25 项 `packed-switch`，索引 11 → `pswitch_5`（`x11.smali:528`）|
| 重置+落盘 | `b6.smali:355-425` | `n(K,v2)` → `v2.B.В()` → 跑 Runnable |
| 二次确认 | `n91.smali:2190-2230` | 固定标题 `0x7f0805f5`、`setDismissOnPositive(false)` |
| 空操作特例 | `x2.smali:50-55` | `packed-switch` 只有 0–3，值 4 落 default → `return` |

> **`x2.smali:50-55` 是"越界索引复用 default"的又一实例**（与 `s91`、`z91`、`ha1` 同类）。

### 6.7 两张并行偏好表：`vr` 与 `wr`

> **`vr` 与 `wr` 是两张并行偏好表**：`vr`（4044 行）管**耳机/锁屏**，`wr` 管**背景/清晰度**；两者都 `extends ׅ/ms`（偏好注册基类）【实证·产物】`vr.smali:2`、`wr.smali:2`。
>
> 偏好注册用 `ms.с(String, boolean)` / `ms.b(int, String)` / `ms.a(String, float)` 三种方法【实证·产物】`ms.smali:2687`。

### 6.8 `headset_controls` 与 `avrcp_controls` 是两个独立字段

> 共用的是"**可选项集合**"（3 项 entries），不是"选中值"——`vr.smali:1756-1784` 两个独立字段。用户在"有线"选长按不影响"蓝牙"。

---

## 7. 规模论证：为什么 18 个 key 只要 298 行

### 7.1 逐 key 覆盖率

| helper 触及 | key | 数量 |
| :---: | --- | ---: |
| ✅ | `resume_on_bt`、`enable_headset_controls`、`headset_controls`、`avrcp_controls`、`long_volume_press`、`no_android_long_press`、`restore_defaults` | **7** |
| ❌ | `resume_on_headset`、`pause_on_headset`、`pause_on_usb_connection`、`follow_pl_exact`、`ignore_bt_sec`、`bt_ignore_repeat_shuffle`、`headset_beep`、`beep_more`、`headset_vibrate`、`audio_focus`、`commands_history` | **11** |

**14 个状态键里 9 个（64%）一行代码都不需要**：纯状态开关/滑杆 9 个 + 纯跳转 2 个。

### 7.2 三个结论

**(1) XML 是"产品模型"，helper 是"平台补丁"**

所有产品语义（开关、分组、依赖、默认值、滑杆范围）都在 XML + `vr` 里；helper 里**没有任何产品判断**，只有 3 类平台适配：

| helper 里做的事 | 为什么框架做不到 |
| --- | --- |
| 弹提示框（4 处）| `Preference` 框架无"改变时弹框"的声明式属性 |
| 发 MsgBus（3 处）| 框架不知道播放服务需要被通知 |
| 按 SDK 删条目（2 处）| 框架无通用条件可见性 |

**(2) 成本结构**

| 部分 | 行数 | 占比 |
| --- | ---: | ---: |
| `v()` 的 7 个装配 | ~280 | ~94% |
| 类声明/空行 | ~17 | ~6% |
| **监听器实现** | **0**（在 `s91`）| 0% |
| **Runnable 实现** | **0**（在 `t91` / `b6`）| 0% |

> `u91 + s91 + t91 ≈ 24 KB`，其中真正属于"耳机页"的只有 `u91` 的 290 行 + `s91` 的 5 个分支。

**(3) 横向对比**

| 页面 | key 数 | helper | 字节 | 每 key 字节 |
| --- | ---: | --- | ---: | ---: |
| **headset** | 18 | `u91` | **6849** | **381** |
| lockscreen | 12 | `la1` | 13557 | 1130 |
| `aa_bg` | 11 | `y61` | 25783 | 2344 |

> **headset 是"每 key 代码密度"最低的页面之一**。锁屏高出 3 倍的原因：**权限闸门 + 动态 summary + 屏幕尺寸门控 + 恢复默认补丁**四件 headset 都没有。

---

## 8. 三个下钻目标

### 8.1 性质对照

| 目标 | 资源 id | 性质 | helper | 规模 |
| --- | --- | --- | --- | ---: |
| `commands_history` | **`0x7f160011`** | ✅ **真子页**（同属 headset 分支）| **`o91`** | 21142 B / 1069 行 |
| `audio_focus` | **`0x7f160007`** | ❌ 跨分支（属**音频**）| **`z61` idx 2** | 仅 ~103 行分支 |
| `misc#long_volume_controls` | `0x7f16001e` | ❌ 跨分支（属**misc**）| `sa1` | 见 §11 |

### 8.2 `w:target` 的三种语法

| 语法 | 例子 | 含义 |
| --- | --- | --- |
| `target="页名"` | `audio_focus`、`commands_history` | 跳到该页顶部 |
| `target="页名#锚点"` | `misc#long_volume_controls` | 跳到该页并定位到指定 key |
| `target="页名?参数#锚点"` | `audio_output_device_opts?uniqName=...&device=chromecast#no_af` | 带参数跳转 |

### 8.3 完整的页面 id 表（59 个，节选）

【实证·产物】`public.xml` 的 `type="xml"` 条目：

| id | 页面 | id | 页面 |
| --- | --- | --- | --- |
| `0x7f160000` | `aa` | `0x7f160015` | **`headset`** |
| `0x7f160003` | `audio` | `0x7f160016` | `library` |
| `0x7f160007` | **`audio_focus`** | `0x7f16001e` | `misc` |
| `0x7f160011` | **`commands_history`** | `0x7f160026` | `singlepane` |

> **id 不连续**：`0x7f160010`、`0x7f160012/13` 等被其他文档占用或留空，**不能用 id 相邻推断页面关系**。

---

## 9. `commands_history` —— 64 条环形缓冲区的可视化

### 9.1 页面身份

| | |
| --- | --- |
| XML | `res/xml/commands_history.xml`（**247 B，空页面**）|
| 资源 id | **`0x7f160011`** |
| helper | **`ׅ/o91.smali`**（21142 B / 1069 行）|
| 页面标题 | `@string/pref_last_processed_commands` |
| `w:skipSearch` | **true** |

**XML 全文**【实证·原文】：

```xml
<?xml version="1.0" encoding="utf-8"?>
<PreferenceScreen android:title="@string/pref_last_processed_commands" w:skipSearch="true"
  xmlns:android="http://schemas.android.com/apk/res/android" xmlns:w="http://schemas.android.com/apk/res-auto" />
```

**没有任何子元素**。所有条目由 `o91.J()` 在运行时动态创建。

### 9.2 `o91` 的 9 个方法

| 方法 | 行 | 规模 | 职责 |
| --- | --- | ---: | --- |
| `<init>` | 17–49 | 32 | 构造（含 `r0` Runnable 字段）|
| **`I()`** | 51–232 | **181** | **把缓冲区转成文本**（供分享用）|
| `C(MenuItem)` | 236–461 | 225 | 菜单项点击（清空/复制）|
| **`J()`** | 463–778 | **315** | **重建整个页面**（核心）|
| `o()` | 780–803 | 23 | 销毁：移除回调 |
| **`v()`** | 805–810 | **5** | **完全空实现** |
| `С()` | 812–835 | 23 | 暂停：移除回调 |
| `о(Menu)` | 837–1029 | 192 | 构建 3 个菜单项 |
| `с()` | 1031–1068 | 37 | 恢复：渲染 + 250ms 轮询 |

> **`v()` 只有 5 行且是纯 `return-void`**（`805-810`，含 `.locals 0` 与 `.line 1`）—— 这是全设置树**最极端的"零静态绑定"页面**。

### 9.3 数据源：`jo0` 的环形缓冲区

`jo0.smali`（7094 B / 415 行）是**进程级日志收集器**，只有 3 个方法：

| 方法 | 行 | 职责 |
| --- | ---: | --- |
| `<clinit>` | 17–59 | 初始化环形缓冲 |
| **`B(int,String,String,String)`** | 61–257 | **写入一条记录** |
| **`В()[hf1[]`** | 261–414 | **读出全部记录**（按时间顺序重组）|

**缓冲区规格**【实证·产物】`jo0.smali:34-54`：

```java
new zm(/* circular */ true, /* capacity */ 0x40 /* 64 */, hf1.class)
```

| 属性 | 值 |
| --- | --- |
| 容量 | **`0x40` = 64 条**（超出覆盖最旧）|
| 类型 | 环形 FIFO |
| 元素 | `hf1` |

**写入路径** `B(type, a, b, c)`：

1. **打 Android 日志**（tag `PlayerCommandsHistory`）—— `jo0:78-132`
2. **加锁写入环形缓冲** —— `jo0:137-241`
   ```java
   synchronized (buffer) {
       if (buffer.size == 64) {
           WRITE_IDX = (WRITE_IDX + 1) % 64;
           int slot = (WRITE_IDX + 0x3f) % 64;
           buffer.X[slot] = record;      // 覆盖最旧
       } else {
           buffer.B(record);             // 追加
       }
       WRITE_IDX++;
   }
   ```
3. **`В()` 读出**：未满直接拷贝；满了则**分两段拷贝**（`WRITE_IDX`→末尾 + 0→`WRITE_IDX`）重组时间正序 —— `jo0:288-321`

> **设计要点**：用 `WRITE_IDX` 同时表达"写指针"与"记录总数"，避免额外计数器。

### 9.4 `hf1` 的完整结构（四字段 + 自动时间戳）

`hf1.smali`（4019 B / 205 行）字段语义直接写在 `toString()` 里【实证·产物】`hf1.smali:61-204`：

| 字段 | 类型 | `toString()` 中的名字 | 语义 |
| --- | --- | --- | --- |
| `В` | `int` | **`type`** | 记录类型（见 §9.5）|
| `B` | `String` | **`source`** | 来源组件（如 `PlayerServiceCore`）|
| `А` | `String` | **`command`** | 命令/事件名（如 `AUDIOFOCUS_LOSS`）|
| `A` | `String` | **`extraInfo`** | 附加信息（决策依据）|
| `х` | `long` | （未输出）| **构造时自动 `System.currentTimeMillis()`** |

构造器【实证·产物】`hf1.smali:19-57`：

```java
hf1(int type, String source, String command, String extraInfo) {
    this.В = type;
    this.B = source;
    this.А = command;
    this.A = extraInfo;
    this.х = System.currentTimeMillis();   // ← 时间戳自动打点
}
```

> **时间戳不在参数里**——`hf1` 自己打点，保证准确性（避免调用链延迟）。

`toString()` 输出格式：

```
<Object.toString()> type=<类型> source=<来源> command=<命令> extraInfo=<附加信息>
```

### 9.5 `type` 的枚举（3 种）

【实证·产物】`hf1.smali:73-112`：

| 值 | 输出 | 含义 |
| ---: | --- | --- |
| **`0`** | `"command"` | **主动命令**（App 内部发起）|
| **`1`** | `"external"` | **外部事件**（系统/硬件/其他 App）|
| 其他 | `String.valueOf(n)` | 预留扩展值 |

**实测分布**（统计全部 43 个写入点）：

| `type` | 次数 | 典型调用者 |
| ---: | ---: | --- |
| `1`（external）| **27** | `rl0`（音频焦点）、`rk0`（按键）、`ud0`/`uk0`（MediaSession）|
| `0`（command）| **1** | **`zf`（PSSleepTimer）** |
| 动态值 | 15 | 各分支根据条件选择 |

> **`type=0` 全库只有 1 处**：`zf.smali:931` 的睡眠定时器 —— `B(0, "PSSleepTimer", "sleep timer", ...)`。

### 9.6 43 个写入点：`commands_history` 到底记录什么

**这是本文最重要的发现之一**。`commands_history` 不是"按键历史"，而是**音频焦点与播放决策的完整轨迹**。

| 类 | 次数 | 职责 | 典型记录内容 |
| --- | ---: | --- | --- |
| **`rl0`** | **13** | **音频焦点处理** | `AUDIOFOCUS_LOSS` / `inPhone` / `pausePlaying af_permanent` / `IGNORE !inPhone && !af_permanent` / `duckPlaying` / `UNDUCK` / `wasPausedByFocusChange=` |
| `dk0` | 7 | 播放核心 | `SHUTDOWN` / `IGNORE exclusive usb output owns attached device` / `cmd_player_dont_resume_after_call` |
| `ik0` | 7 | 音频焦点辅助 | `pauseInCall` / `pauseInCall IGNORE as disabled` |
| `rk0` | 4 | **按键接收** | `KEYCODE_MEDIA_PLAY` / `IGNORED as isAvrcp && playing` |
| `cl0` | 1 | 管线重载 | `reloadPipeline` |
| `jl0` | 1 | 播放核心 | — |
| `oo0` | 1 | 恢复逻辑 | `RESUME resume_on_mount` |
| `dy1` | 1 | 播放服务 | — |
| `t4` | 1 | 搜索播放 | `handleSearchAndPlay` |
| **`zf`** | **1** | **睡眠定时器** | `sleep timer`（唯一的 `type=0`）|
| `ud0`/`uk0` 等 | 6 | MediaSession | `MediaSessionWrapper` / `onFastForward` |

**`rl0` 的记录实例**【实证·产物】`rl0.smali:1253-1456`：

```java
B(1, "PlayerServiceCore", "AUDIOFOCUS_LOSS", " inPhone");                         // :1273
B(1, "PlayerServiceCore", "AUDIOFOCUS_LOSS", "pausePlaying af_permanent");        // :1303
B(1, "PlayerServiceCore", "AUDIOFOCUS_LOSS", "IGNORE !inPhone && !af_permanent"); // :1350
B(1, "PlayerServiceCore", "AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK", "...");           // :1393
B(1, "PlayerServiceCore", "UNDUCK", "afterFocus");                                // :303
B(1, "PlayerServiceCore", "RESUME", "after call or audio focus");                 // :609
B(1, "...", "...", "wasPausedByFocusChange= ... AUDIOFOCUS_GAIN");                // :1078
```

**5 处单次写入的完整参数**：

| 位置 | 参数 | 语义 |
| --- | --- | --- |
| **`oo0:311`** | `B(1, ..., "RESUME resume_on_mount", " mount event")` | **存储挂载后恢复播放** |
| `cl0:5556` | `B(1, ..., "reloadPipeline", ...)` | 音频管线重载 |
| `jl0:6230` | `B(1, ..., <命令>, ...)` | 播放核心事件 |
| `dy1:6801` | `B(1, p0, p2, p1)` | 服务层命令 |
| `t4:2085` | `B(1, ..., "handleSearchAndPlay", ...)` | 搜索结果播放 |

**`oo0` 的 30 秒窗口**【实证·产物】`oo0.smali:290`：

```java
const-wide/16 v4, 0x7530    // 30000ms = 30 秒
cmp-long p2, v2, v4
if-gtz p2, :cond_2          // 超过 30 秒则跳过
```

> 对应 `audio_focus` 页 `resume_on_mount` 的文案 **"Wait for a storage (up to 30s.) to mount before resuming on start"**。

**所以这个页面的实际用途**：

| 用户困惑 | 在 `commands_history` 里能看到 |
| --- | --- |
| 为什么来电后没恢复播放？ | `RESUME after call or audio focus` 缺失，或 `IGNORE !inPhone && !af_permanent` |
| 为什么插了耳机没自动播？ | `RESUME resume_on_mount` 是否出现 |
| 为什么蓝牙按键没反应？ | `IGNORED as isAvrcp && playing` |
| 为什么声音突然变小？ | `duckPlaying` / `UNDUCK afterFocus` |
| 为什么暂停了不恢复？ | `wasPausedByFocusChange= ... AUDIOFOCUS_GAIN` |

### 9.7 页面渲染：`J()` 的完整逻辑

【实证·产物】`o91.smali:463-778`：

```java
void J() {
    PreferenceScreen root = this.K;
    root.removeAll();                          // :475 先清空

    hf1[] records = jo0.В();                   // :484 取全部记录

    StringBuilder sb = new StringBuilder();
    SimpleDateFormat fmt = new SimpleDateFormat("HH:mm:ss.SSS", Locale.US);
    Date d = new Date();
    LargeRawTextPreference last = null;

    for (hf1 r : records) {                    // 每条 → 一个 Preference
        sb.setLength(0);
        d.setTime(r.timestamp);
        sb.append(fmt.format(d)).append(' ').append(r.fieldA).append(' ').append(r.fieldB);
        LargeRawTextPreference p = new LargeRawTextPreference(ctx, null);
        p.setSummary(sb.toString());
        root.addPreference(p);
        last = p;
    }

    if (records.length > 0) {
        // 有数据 → 32ms 后检查是否要刷新（:686-707）
        handler.postDelayed(new b6(this, 0x1c, last), 0x20 /* 32ms */);
    } else {
        // 无数据 → 显示 "empty"（:716-739）
        LargeRawTextPreference p = new LargeRawTextPreference(ctx, null);
        p.setSummary(0x7f080005 /* @string/_empty = "empty" */);
        root.addPreference(p);
    }

    // 记录当前写指针，供下次对比（:746-763）
    synchronized (jo0.B) { this.j = jo0.A; }
}
```

### 9.8 双周期刷新机制（本页最精妙处）

| 周期 | 触发 | 位置 | 用途 |
| ---: | --- | --- | --- |
| **250ms** | `с()` 里 `postDelayed(r0, 0xfa)` | `o91:1053-1057` | **页面可见时**轮询 |
| **32ms** | `J()` 里 `postDelayed(b6(0x1c), 0x20)` | `o91:703-707` | **渲染刚结束时**快速检查 |

**状态字段 `j`** 是关键：每次 `J()` 结束都记录 `jo0.A`（写指针），下次对比判断是否有新记录。

> **为什么需要 32ms 短周期**：用户打开页面时若恰好在按键，新记录可能在 0-32ms 内到达。用短延迟做一次"补查"，避免等到下一个 250ms 周期。
>
> **250ms 的取舍**：既能看到滚动更新，又不会因频繁重建 `Preference` 卡顿。

### 9.9 生命周期：三个方法都在"移除回调"

| 方法 | 动作 | 位置 |
| --- | --- | --- |
| `o()`（销毁）| `removeCallbacks(r0)` + `super` | `o91:780-803` |
| `С()`（暂停）| 同上 | `o91:812-835` |
| `с()`（恢复）| `J()` 渲染 + `removeCallbacks` + `postDelayed(0xfa)` | `o91:1031-1068` |

> **`removeCallbacks` 先于 `super` 调用**，确保页面切换时不残留定时器。

### 9.10 三个菜单项

【实证·产物】`о(Menu)`（837–1029）+ `C(MenuItem)`（236–461）：

| # | 菜单 | 动作 | 定位 |
| ---: | --- | --- | --- |
| 1 | **清空** | 清空 `jo0` 缓冲 + 刷新 | `o91:253-298` |
| 2 | **复制** | `ClipData.newPlainText` 写入剪贴板 | `o91:317-357` |
| 3 | **分享** | `ShareActionProvider` + `ACTION_SEND` / `text/plain` | `o91:371-450` |

**清空菜单的实现（含一处精妙设计）**【实证·产物】`o91.smali:245-298`：

```java
if (itemId == 0x7f0d042b) {          // 清空
    synchronized (jo0.В) {
        jo0.B.clear();                // ① zm.clear()：所有槽位 = null，size = 0
        jo0.A = jo0.A + 1;            // ② 写指针 +1（不是重置为 0！）
    }
    this.J();                         // ③ 重绘
    return true;
}
```

`zm.clear()`【实证·产物】`zm.smali:373-416`：

```java
clear() {
    for (int i = 0; i < this.y /* size */; i++) this.X[i] = null;
    this.y = 0;
}
```

> **为什么是 `A + 1` 而不是 `A = 0`**：
>
> `jo0.A` 同时充当"写指针"和"总记录数"。`o91.j` 保存上次渲染时的 `jo0.A` 快照用于判断"是否有新记录"。
>
> 若清空时把 `A` 归零，而 `o91.j` 此时是某个大值，则 `j > A` 会导致**刷新判定永久失效**（页面卡死不更新）。
>
> **保持单调递增**让 `o91.j < jo0.A` 恒成立。**这是个极易写错的细节**。

**`I()` 的输出格式**（181 行，`o91:51-232`）：

```
HH:mm:ss.SSS <字段A> <字段B>
==================
HH:mm:ss.SSS <字段A> <字段B>
==================
```

---

## 10. `audio_focus` —— 跨分支子页（`z61` idx 2）

### 10.1 性质

| | |
| --- | --- |
| XML | `res/xml/audio_focus.xml`（3574 B，**11 个元素**）|
| 资源 id | **`0x7f160007`** |
| 归属 | **音频分支**（`w:searchBreadcrumb1="@string/pref_audio_engine"`）|
| helper | **`z61` 索引 2** → `pswitch_11`（`z61.smali:4597-4698`，**仅 103 行**）|
| 入口 | headset 根页第 9 行（无 key 的 RedirectPreference）|

### 10.2 11 个元素逐条

【实证·原文】`audio_focus.xml`：

| # | key | 控件 | 标题 | 默认 | 依赖 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `resume_after_call` | Switch | **Resume After Call** | **true** | — |
| 2 | `resume_on_start` | Switch | **Resume On Start** | **false** | — |
| 3 | `resume_on_resume` | Switch | **Resume On Reopen** | true | `resume_on_start` |
| 4 | `resume_on_mount` | Switch | **Wait For Storage** | false | `resume_on_start` |
| 5 | `cc_af_warning` | Redirect | （无标题）| — | → `audio_output_device_opts?...chromecast#no_af` |
| 6 | *（无 key）* | Redirect | （无标题）| — | → `ui_notify#keep_notification_always` |
| 7 | `af_short` | Switch | **Short Audio Focus Change / Calls** | **true** | — |
| 8 | `pause_in_call` | Switch | **Pause In Call** | true | — |
| 9 | `resume_on_focus` | Switch | **Resume On Focus Gain** | true | `af_short` |
| 10 | `af_short_duck` | Switch | **Duck Volume** | true | `af_short` |
| 11 | `af_permanent` | Switch | **Permanent Audio Focus Change** | true | — |
| — | `restore_defaults` | Preference | Restore Defaults | — | — |

> **`audio_focus_cat`** 是分类的 key（`PreferenceCategory`），不计入 11 项。

### 10.3 9 个偏好字段映射

【实证·产物】`vr.smali`：

| key | `vr` 字段 | 定义行 |
| --- | --- | ---: |
| `resume_after_call` | `vr->w0` | 1676 |
| `resume_on_start` | `vr->s0` | 1612 |
| `resume_on_resume` | `vr->t0` | 1628 |
| `resume_on_mount` | `vr->u0` | 1644 |
| `af_short` | `vr->h0` | 1417 |
| `pause_in_call` | `vr->x0` | 1692 |
| `resume_on_focus` | `vr->w2` | 3503 |
| `af_short_duck` | `vr->i0` | 1433 |
| `af_permanent` | `vr->g0` | 1401 |

### 10.4 `pswitch_11` 的 103 行做了什么

【实证·产物】`z61.smali:4597-4698`，**只有 3 件事**：

```java
// ① af_short 绑定监听器 tc(3)
af_short.setOnPreferenceChangeListener(new tc(3, this));

// ② 若 af_short 已开启 → 强制 pause_in_call 勾选并禁用
if (vr.h0 /* af_short */) {
    TwoStatePreference pic = findPreference("pause_in_call");
    pic.setChecked(true);      // v4 = 1
    pic.setEnabled(false);     // v15 = 0
}

// ③ restore_defaults 绑定 x11(4)
findPreference("restore_defaults").setOnPreferenceClickListener(new x11(4, this));
```

### 10.5 `af_short` ⇄ `pause_in_call` 的互斥联动（本页唯一逻辑）

**动态态**（`tc` 索引 3，`tc.smali:598-667`）：

```java
boolean onPreferenceChange(Preference p, Object newValue) {
    Preference pic = findPreference("pause_in_call");
    if (pic != null) {
        if ((Boolean) newValue) {                  // af_short 变为 true
            ((TwoStatePreference) pic).setChecked(true);   // 强制勾选
            pic.setEnabled(false);                 // 禁用
        } else {                                   // af_short 变为 false
            pic.setEnabled(true);                  // 恢复可编辑
        }
    }
    return true;
}
```

| `af_short` 状态 | `pause_in_call` 状态 | 为什么 |
| --- | --- | --- |
| **开启** | 强制 true + 禁用 | "短焦点变化暂停"已覆盖来电场景，无需单独配置 |
| **关闭** | 用户可编辑 | 需要单独控制是否因来电暂停 |

> **这是"父开关覆盖子选项"的典型设计**：不只是置灰，而是**强制勾选 + 置灰**，明确表达"此选项已由上级接管"。
>
> **对比 headset 页的 `headset_beep` ⇄ `beep_more`**：那对只是 `android:dependency` 置灰（不清值），而这里**会改写值**。

### 10.6 为什么被 headset 引用

headset 根页第 9 行：

```xml
<RedirectPreference android:title="@string/pref_audio_focus"
    android:summary="@string/pref_summary_audio_focus_from_headset"
    w:target="audio_focus" w:skipSearch="true" />
```

摘要文案是 **"Few other play/resume options are available in Audio Focus settings"** —— "引导用户去别处配置"的跳转条目，因为耳机相关的声音恢复行为与音频焦点高度重叠。

---

## 11. `misc#long_volume_controls` —— Shizuku 授权的实验特性

### 11.1 XML 定义

【实证·原文】`misc.xml:35`：

```xml
<MultilineSwitchPreference
    android:title="@string/pref_long_volume_controls"
    android:key="long_volume_controls"
    android:defaultValue="false"
    w:sup="@string/pref_experiment"
    w:supLink="alert?text=@string/pref_experimental_msg" />
```

| 属性 | 含义 |
| --- | --- |
| `w:sup="@string/pref_experiment"` | **"实验性"徽标** |
| `w:supLink="alert?text=..."` | 点击徽标弹出实验性说明 |
| `defaultValue="false"` | 默认关闭 |

### 11.2 三个相关类

| 类 | 位置 | 内容 |
| --- | --- | --- |
| `vr` | `vr.smali:1804-1816` | 注册偏好字段 **`vr->E0`** |
| `sa1` | `sa1.smali:274-405` | **misc helper 的运行时判定**（核心）|
| `ad` | `ad.smali:204-224` | 开关点击后的状态同步 |

### 11.3 `sa1` 的权限判定链（核心）

【实证·产物】`sa1.smali:262-405`：

```java
Preference lvc  = findPreference("long_volume_controls");
Preference grant = findPreference("_long_volume_shizuku_grant");   // 见下方纠正

if (checkSelfPermission(
        "android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER") != 0) {
    // 未授权
    lvc.setSummary(<需要授权的说明>);
    lvc.setEnabled(false);
    grant.setSummary(<Shizuku 授权引导>);
    grant.setIcon(<感叹号图标>);
} else {
    // 已授权
    lvc.setSummary(<默认摘要>);
    lvc.setEnabled(true);
    ((TwoStatePreference) lvc).setChecked(vr.E0);
}
```

### 11.4 `_long_volume_shizuku_grant` 的创建点

**它不是动态创建的，而是懒加载 + 锚点拼接**【实证·产物】`sa1.smali:908-998`：

```java
if (this.k == null) {                     // 懒加载（只建一次）
    String anchor = this.H() + "#_long_volume_shizuku_grant";
    //                  ↑ n91.H() = 当前页面路径（"misc"）

    this.k = new x80(
        settingsActivity,
        handler,
        anchor,                            // 授权完成后跳回的锚点
        new ra1(this),                     // 授权回调
        new u0(0xe /* 14 */, this)         // 进度更新回调
    );
}
```

| 项 | 说明 |
| --- | --- |
| **`#` 前缀** | `open_path` 的锚点语法：`"misc#_long_volume_shizuku_grant"` |
| **懒加载** | `if (this.k == null)` —— 只创建一次 |
| **`n91.H()`** | 返回当前页面路径 |

### 11.5 `x80`：Shizuku 授权器

`x80.smali`（32138 B / 1786 行）核心机制【实证·产物】：

| 步骤 | 实现 | 定位 |
| --- | --- | --- |
| ① 连接 Shizuku | `moe.shizuku.server.IShizukuService` binder | `x80:257` |
| ② 构造授权命令 | `/system/bin/cmd package grant --user <N> <pkg> <permission>` | `x80:138-167` |
| ③ 执行 | 通过 Shizuku 服务以 shell 身份运行 | `x80:190-197` |
| ④ 超时 | **10 秒**（`"timeout after 10 s"`）| `x80:178` |
| ⑤ 失败处理 | `"run FAIL cmd="` / `"run TIMEOUT cmd="` | `x80:170/182` |
| ⑥ 无 Shizuku | `"no Shizuku binder"` | `x80:243` |

**目标权限**：`android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER`（`x80:130`）

> **标准 Shizuku 授权模式**：通过 Shizuku 的 shell 权限执行 `pm grant`，把签名级权限授予自己。
>
> **用 `/system/bin/cmd` 而非 `pm`** —— `cmd` 是更底层入口，某些 ROM 上更可靠。

### 11.6 跳转体验落差

```
headset 根页
  └─ long_volume_press（无标题，摘要 "Press here for Volume keys long press option"）
     └─ 跳转到 misc#long_volume_controls
        └─ 用户看到：实验性徽标 + 默认关闭 + 需要 Shizuku 授权
```

> **体验落差**：从耳机页点进来，期待的是"配置长按音量键"，实际面对的是**需要额外安装 Shizuku 并授权**的实验特性。
>
> 而且这条跳转**本身还有 SDK 门控**：SDK < 26 时整行被 `u91` 移除，用户根本看不到入口。

---

## 12. 按键运行时：`PSMediaButtonReceiver`（`rk0`）

### 12.1 身份

| | |
| --- | --- |
| 类 | `Lׅ/rk0;` → `com.maxmpz.audioplayer.player.PSMediaButtonReceiver` |
| 规模 | **99295 B / 5736 行** |
| 入口 | `public static х(Context, Intent)` = **`onReceiveStatic`**，`rk0.smali:1326-5654`（**4328 行**）|
| 接收 Action | `android.intent.action.MEDIA_BUTTON`（`rk0.smali:1413`）|

### 12.2 9 个方法

| 方法 | 行 | 规模 | 职责 |
| --- | --- | ---: | --- |
| `A(Context,I,Z,I,J)` | 7–73 | 66 | 静音/焦点桥 |
| **`B(Context,I)`** | 75–326 | **251** | **振动 + 提示音调度** |
| **`X(Context,IIJ,Bundle,String)`** | 328–588 | **260** | **封装 `API_COMMAND` Intent 并分发** |
| `x()` | 590–621 | 31 | 清理状态（调用 10 次）|
| `y(Context)` | 623–670 | 47 | 设备连接态刷新（6 次）|
| `В(Context,I)` | 672–1295 | **623** | **提示音播放器**（`AudioTrack`）|
| **`Х(I,Z,Z)I`** | 1297–1324 | **27** | **标志位打包**（全链路核心）|
| **`х(Context,Intent)`** | 1326–5654 | **4328** | **`onReceiveStatic`** |
| `А(Application)` | 5658–5735 | 77 | `ComponentName` 单例工厂 |

> **`Х()` 只有 27 行却是全链路枢纽**——所有按键消息都经它打包、再由 `w8.handleMessage` 解包。

### 12.3 处理的设备与来源

从 `rk0` 的字符串常量反推【实证·产物】：

| 来源 | 判定字符串 | 行 |
| --- | --- | --- |
| 语音助手 | `com.google.android.googlequicksearchbox` | `:1713` |
| Android Auto | `com.google.android.projection.gearhead` | `:1903` |
| Poweramp 自身 | `com.maxmpz.audioplayer_util` | `:1923` |
| AVRCP | `AVRCP` | `:1953` |
| 三星 AOD | `com.samsung.android.app.aodservice` | `:2152` |
| 三星 Routines | `com.samsung.android.app.routines` | `:2168` |
| 触摸来源 | `SOURCE_TOUCHSCREEN` | `:2091` |
| 蓝牙音频状态 | `A2dpOn` | `:2863` |

> **4328 行的主要来源不是按键逻辑本身，而是"判断这个按键该不该处理"**——要排除语音助手误触、区分车机、识别 AOD/Routines 等系统代理。

`onReceiveStatic` 结构统计：**27 个 `try` 块**、70 个 `invoke-static`（20 个目标）、98 个 `invoke-virtual`、55 个 `const-string`、35 个 switch/标签。

### 12.4 `Х(I,Z,Z)I`：标志位打包协议（**核心**）

```java
public static int Х(int action, boolean isAvrcp, boolean isPlaying) {
    int packed = action & 0x7;          // 低 3 位：KeyEvent action
    if (isAvrcp)   packed |= 0x100;     // bit 8：来自蓝牙 AVRCP
    if (isPlaying) packed |= 0x200;     // bit 9：当前正在播放
    return packed;
}
```

打包结果放进 `Message.arg2`，`arg1` 放 keyCode【实证·产物】`rk0.smali:3712-3747`。

**解包端**在 `w8.handleMessage`【实证·产物】`w8.smali:353-420`：

```java
int keyCode = msg.arg1;
int packed  = msg.arg2;
boolean isActionDown = (packed & 0x7) == 1;   // KeyEvent.ACTION_DOWN == 1
boolean isAvrcp     = (packed & 0x100) != 0;
boolean isPlaying   = (packed & 0x200) != 0;
```

> **一个 int 编码了「动作 + 来源 + 播放态」三个维度**。
>
> **这也是线控与蓝牙能共用同一套处理逻辑的原因**——两者走同一条消息，只靠 `bit 8` 区分。

### 12.5 `rk0.X()`：`API_COMMAND` Intent 分发

```java
Intent i = new Intent("com.maxmpz.audioplayer.API_COMMAND");
i.putExtra("cmd",   cmd);           // 命令码
i.putExtra("src",   src);           // 来源字符串
i.putExtra("ts",    uptimeMillis);  // 时间戳
i.putExtra("beep",  beepFlag);
i.putExtra("ips",   isPlayingState);
i.setComponent(dy1.p(ctx));         // Poweramp 播放服务
try {
    ctx.startService(i);            // 首选
} catch (Throwable t) {
    if (SDK_INT >= 26) {            // 降级：广播
        i.setComponent(z42.x(ctx));
        ctx.sendBroadcast(i);
    }
}
```
【实证·产物】`rk0.smali:328-559`

**降级链**：

```
startService 失败（Android 8+ 后台服务限制）
  └─ SDK >= 26 → sendBroadcast 给 PowerampAPIReceiver（rk0:537-554）
     └─ 若再失败 → Log.w 后吞掉（rk0:570/581）
```

### 12.6 `В()`：提示音播放器

**纠正一处易混淆**：`B()`（拉丁）负责**振动与调度**；`В()`（西里尔，623 行）才是**音频播放**。

`В()` 的真实身份【实证·产物】`rk0.smali:672-1295`：

| 证据 | 事实 |
| --- | --- |
| `PSMediaButtonReceiver->y` | `SoftReference<AudioTrack>`（缓存播放器）|
| `PSMediaButtonReceiver->у` | 缓冲区大小（帧数）|
| `AUtils.s(ctx)` | 取 **PCM 字节数组** |
| `AudioTrack.write([BII)` | 写入 PCM |
| `AudioTrack.setLoopPoints(...)` + `play()` | 循环播放提示音 |
| `AudioManager.getStreamVolume(3)` | 按 STREAM_MUSIC 音量调 `setVolume` |
| **三个分支 `if-eq v0, 1/2/3`** | **三种提示音类型** |

> **所以 `headset_beep` / `beep_more` 的最终落地就在这里**：`В(type)` 播放对应 PCM 提示音，音量跟随媒体音量。

### 12.7 `w8` 的 4 个 `Message.what` 值

`w8` 是 `Handler`（14347 B / 864 行），`handleMessage` 560 行，**switch 只有 1 项**（`what=1`），其余落到 default 用 `if-ne` 链判定【实证·产物】`w8.smali:455/529/721/761`：

| `what` | 判定 | 含义 |
| ---: | --- | --- |
| **1** | `:pswitch_0` | **立即处理**（action=DOWN 的音量键等）|
| **2** | `:cond_7` | **延迟处理**（需 1000ms 去抖）|
| **3** | `:cond_e` | **延迟处理（长按）** |
| **4** | `:cond_10` | **直接调 `rk0.B()`**（蜂鸣/振动）|

> **注意 `w8` 的 switch 判定依据是构造参数 `В`，不是 `Message.what`。**

**keyCode 常量**（`w8.smali:425-445`）：

| 常量 | keyCode | 按键 |
| --- | ---: | --- |
| `0x4f` | 79 | `KEYCODE_HEADSETHOOK`（线控单键）|
| `0x55` | 85 | `KEYCODE_MEDIA_PLAY_PAUSE` |
| `0x57` | 87 | `KEYCODE_MEDIA_NEXT` |
| `0x58` | 88 | `KEYCODE_MEDIA_PREVIOUS` |
| **`0x7e`** | 126 | `KEYCODE_MEDIA_PLAY` |
| **`0x7f`** | 127 | `KEYCODE_MEDIA_PAUSE` |

---

## 13. 按键状态机与三道防误触

### 13.1 8 个静态状态字段

`PSMediaButtonReceiver` 用 **8 个静态字段**承载跨事件状态【实证·产物】：

| 字段 | 类型 | 写 | 读 | 语义 |
| --- | --- | ---: | ---: | --- |
| **`A`** | `int` | 2（`:3691`、`:4049`）| 3（`:3437`、`:3683`、`:3816`）| **上一次的 keyCode**（`0` = 无历史）|
| **`B`** | `boolean` | 7 | 1（`:3667`）| **本次按下沿已处理过**的幂等标记 |
| **`K`** | `w8` | 0（外部初始化）| 3（`:3639`、`:4869`、`:5547`）| **Handler 单例** |
| **`X`** | `long` | 5 | 3 | **上次按键的 uptimeMillis** |
| **`x`** | `boolean` | 5 | 2 | **按键已被消费**标记 |
| **`А`** | `long` | 3（`:3695`、`:3943`、`:4053`）| 2 | 延迟消息排队时的**基准时间戳** |
| **`Х`** | `long` | 0 | 1（`:4196`）| **最后转发时间** |
| **`х`** | `int` | 1（`:3935`）| 1（`:3925`）| 按键**重复计数** |

> **字段名极难区分**：`X`（拉丁大写）vs `Х`（西里尔大写）vs `x`（拉丁小写）vs `х`（西里尔小写）——**四个不同字段，两个字形**。排查时必须按完整声明（含类型）区分。

### 13.2 状态机的完整判定

`onReceiveStatic` 取到 `KeyEvent` 后【实证·产物】`rk0.smali:1536-1561`：

```java
int keyCode     = e.getKeyCode();      // → v10
int action      = e.getAction();       // → v11（0=UP, 1=DOWN, 2=MULTIPLE）
int repeatCount = e.getRepeatCount();  // → v12
long eventTime  = e.getEventTime();    // → v13
```

主状态机在 `:3660-3747`：

```java
if (!PSMediaButtonReceiver.B) {                    // 本次按下沿尚未处理
    PSMediaButtonReceiver.B = true;                // 幂等标记置位

    if (headset_controls == 1                    // ← 关键：只有"双击/三击"模式才走延迟
        && PSMediaButtonReceiver.A == 0) {         //   且是第一次按键
        PSMediaButtonReceiver.A  = keyCode;
        PSMediaButtonReceiver.А  = now;

        Message m = handler.obtainMessage();
        m.setAsynchronous(true);
        m.what = 2;                                // 延迟消息
        m.arg1 = keyCode;
        m.arg2 = Х(action, isAvrcp, isPlaying);
        m.obj  = context;
        handler.sendMessageDelayed(m, 300ms);      // 双击窗口
    }
}
```

> **这是三个取值差异的真正落点**：`headset_controls == 1`（Double/triple press）时才发 `what=2` 延迟消息；`== 0`（Single press）跳过延迟直接处理。

### 13.3 三道防误触机制

**① 语音助手拦截**【实证·产物】`rk0.smali:3406-3518`：

```java
if (senderIsAssistant
    && keyCode == 0x7e                          // KEYCODE_MEDIA_PLAY
    && inputDevice != null
    && inputDevice.isVirtual()                  // 虚拟输入设备
    && (PSMediaButtonReceiver.A == 0x57         // 上次是 NEXT
        || PSMediaButtonReceiver.A == 0x58)) {  // 或 PREV
    long dt = now - PSMediaButtonReceiver.X;
    if (dt <= 0x12c) {                          // 300ms
        jo0.B(1, "...", "IGNORE isAssistant => allow double/triple press", ...);
        return;                                 // 直接放行给系统
    }
}
```

> **语义**：语音助手在双击/三击 NEXT/PREV 时会合成一个 PLAY 事件。若这个 PLAY 在 300ms 内紧跟 NEXT/PREV，就**交给系统处理**，让系统手势正常工作。

**② 蓝牙去抖 + `follow_pl_exact`**【实证·产物】`w8.smali:573-614`：

```java
long threshold = 0x3e8;   // 1000ms（w8:533）
if (isAvrcp && isPlaying) {
    rk0.x();
    jo0.B(4, "KEYCODE_MEDIA_PLAY", "IGNORED as isAvrcp && playing", "PSMediaButtonReceiver");
    return;                                    // 直接忽略
}
long since = uptimeMillis() - PSMediaButtonReceiver.Х;
if (since > threshold) { /* 新按键 */ } else { rk0.x(); /* 重复丢弃 */ }
```

> **解决车机/耳机重连时补发过期 play/pause 的问题**。

**③ `ignore_bt_sec` 双时间差**【实证·产物】`rk0.smali:2940-3140`：

```java
long btDiff    = now - BTReceiver.А;          // 距上次蓝牙设备事件
long routeDiff = now - <上次路由变化>;

int window = vr.o2 /*ignore_bt_sec*/ * 1000;
int capped = Utils.у(window, 0, 0x4e20);      // clamp 到 20000ms

if (btDiff > 0 && routeDiff > 0
    && (btDiff < capped || routeDiff < capped)) {
    Log.w("PSMediaButtonReceiver", "onReceiveStatic IGNORE AVRCP MEDIA_BUTTON events ...");
    rk0.y(ctx); rk0.x();
    PSMediaButtonReceiver.X = now;
    return;
}
```

> **两个时间差是"或"关系**：蓝牙连接或音频路由变化任一在窗口内就丢弃。
>
> **`capped = 20000ms` 与 UI 的 `w:max="20"` 精确对应**。

### 13.4 三层防护汇总表

| 层 | 触发条件 | 动作 | 阈值 | 定位 |
| ---: | --- | --- | --- | --- |
| **① 语音助手** | assistant + virtual device + PLAY 紧跟 NEXT/PREV | **放行给系统** | **300ms** | `rk0:3406-3518` |
| **② 蓝牙去抖** | `isAvrcp && isPlaying` | **直接忽略** | — | `w8:573-614` |
| **③ 重复按键** | 距上次 < 阈值 | **丢弃** | **1000ms** | `w8:533` |
| **④ `ignore_bt_sec`** | 路由或蓝牙事件在窗口内 | **丢弃** | **用户配置 0–20s** | `rk0:2967-2990` |

> 前三个阈值**硬编码**（300ms / 1000ms），第四个是**唯一可配置**的。

### 13.5 `headset_controls` 三值的最终差异表

| 值 | 文案 | 状态机行为 | 延迟消息 |
| ---: | --- | --- | --- |
| **0** | Single press | **跳过延迟**，直接走立即路径 | 不发 `what=2` |
| **1** | Double/triple press | **发 `what=2` 延迟消息**，300ms 窗口内等第二击 | 发 |
| **2** | Long press | 走 `w8` 的 `what=3` 分支（长按），并弹"可能失效"提示 | 不走延迟 |

> **`headset_controls` 只影响"线控单键"的分发方式**；`avrcp_controls` 影响蓝牙侧，但蓝牙设备通常自己处理双击/三击，走的是 §13.3 的第 ② 层。

### 13.6 `no_android_long_press`：通过 PackageManager 禁用组件

**这个开关不是"拦截事件"，而是把自己的组件整个禁用掉。**

**判定函数** `dy1.c()`（68 行）【实证·产物】`dy1.smali:4360-4427`：

```java
static boolean c() {
    if (vr.y0 /*enable_headset_controls*/
        && vr.B0 /*headset_controls*/ != 2) {
        return true;
    }
    if (Build.VERSION.SDK_INT <= 0x21 /*33*/
        && vr.D0 /*no_android_long_press*/) {
        return true;
    }
    return false;
}
```

调用点 5 处（`dk0:3870/3898/3945/3973`、`rl0:3069`），全部形如：

```java
if (dy1.c()) {
    boolean state = (playerCore.К() != 1);
    dy1.r(ctx, state ^ 1);
}
```

**`dy1.r(Context, boolean)` 才是真正的动作**【实证·产物】`dy1.smali:6978-7087`（109 行）：

```java
static void r(Context ctx, boolean enable) {
    ComponentName cn = new ComponentName(ctx, VoiceSearchHelperActivity.class);
    int newState = enable
        ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED    // 1
        : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;  // 2
    ctx.getPackageManager().setComponentEnabledSetting(cn, newState,
                                                       PackageManager.DONT_KILL_APP);
}
```

> **Poweramp 不是"拦截"长按语音搜索，而是把自己的 `VoiceSearchHelperActivity` 组件整个禁用掉**。Android 的长按手势会去找能处理 `ASSIST` intent 的 Activity，组件 `DISABLED` 后系统就不会启动它。
>
> **`DONT_KILL_APP`** 表示改组件状态后不杀进程——**热生效、不重启**。
>
> 这也解释了为什么标注 SDK ≤ 33：Android 14 改变了长按助手行为，workaround 不再需要，`u91` 在 SDK > 33 时直接移除该行（§5.1）。

### 13.7 `ud0` / `uk0` 的分工

| | `ud0` | `uk0` |
| --- | --- | --- |
| 规模 | 22965 B / 1349 行 | 48184 B / 2665 行 |
| 覆写方法数 | **9** | **18** |
| 构造 | `ud0(vd0)` | `uk0(vk0, qd0)` |
| 宿主 | **`vd0`** | **`vk0`** |

**宿主对比**：

| 宿主 | 规模 | 特征字符串 | 职责 |
| --- | ---: | --- | --- |
| **`vd0`** | 6621 B | `Poweramp`、`android.intent.action.MEDIA_BUTTON` | **传统广播式 MEDIA_BUTTON** |
| **`vk0`** | 41678 B | `PREV_CAT`、`NEXT_CAT`、`SEEK_JUMP_*`、`TOGGLE_RATING`、`LIKE`、`UNLIKE`、`SHUFFLE`、`REPEAT` | **MediaSession 扩展命令** |

> **`ud0`** 处理**传统 `MEDIA_BUTTON` 广播**（Android 4.x 时代方式）→ 9 个回调够用
> **`uk0`** 处理**MediaSession 扩展动作**（Android 5.0+）→ 需 18 个回调
>
> 两者都会在 `B(String)` 里检查 `headset_beep && beep_more`（`ud0:330`、`uk0:161`），逻辑完全相同。

### 13.8 9 条运行时诊断日志

`onReceiveStatic` 里有 **9 条专门用于排查按键为何被忽略**的日志【实证·产物】：

| # | 日志 | 含义 | 定位 |
| ---: | --- | --- | --- |
| 1 | `onReceiveStatic before prefs inited` | 偏好尚未初始化就收到按键 | `:1350` |
| 2 | `onReceiveStatic !ACTION_MEDIA_BUTTON` | Intent action 不匹配 | `:1433` |
| 3 | `keyAction=` | 记录 KeyEvent action 与 keyCode | `:1768` |
| 4 | `follow_pl_exact 1 ` | 严格模式生效 | `:2250` |
| 5 | `isNotButtonPress 1 ` | 判定为非按键事件 | `:2427` |
| 6 | `pressEmulatedByGoogleOrAAuto ` | 判定为 Google/AAuto 模拟 | `:2523` |
| 7 | `IGNORED isNotButtonPress=` | 因上一条而丢弃 | `:3231` |
| 8 | `IGNORED due to ignore_bt_sec` | 因静默窗丢弃 | `:3119` |
| 9 | `IGNORE isAssistant => allow double/triple press` | 放行给系统 | `:3477` |

另有广播 `com.maxmpz.audioplayer.MEDIA_BUTTON_IGNORED`（`:3288`），会对外通知"这个按键被忽略了"。

> **这些日志构成了一套完整的"按键去留决策追踪"**。配合 `commands_history` 子页，用户可以自己诊断按键问题——这是 Poweramp 一个相当成熟的可观测性设计。
>
> **`deviceName=` / `deviceSources=0x` / `eventFlags=0x` / `virt=` / `repeat=` / `actionTime=` / `sourcePak=`**（`:2657-2823`）还会把完整的 `KeyEvent` 属性打出来。

### 13.9 完整链路汇总

```
耳机/蓝牙按键
  ↓
PSMediaButtonReceiver.onReceiveStatic（rk0.х() · 4328 行）
  ├─ 设备/来源判定（8 类白黑名单）
  ↓
构造 Message（what=1/2/3/4, arg1=keyCode, arg2=Х(action,isAvrcp,isPlaying)）
  ↓
w8 Handler.sendMessageDelayed
  ↓
w8.handleMessage（解包 arg2）
  ├─ what=1 → 立即执行
  ├─ what=2 → 1000ms 去抖 / isAvrcp && playing → 忽略
  ├─ what=3 → 长按处理
  └─ what=4 → rk0.B()（蜂鸣 + 振动）
  ↓
rk0.X() 封装 Intent("com.maxmpz.audioplayer.API_COMMAND")
  ↓
startService(dy1) ──失败且 SDK≥26──→ sendBroadcast(PowerampAPIReceiver)
```

### 13.10 两套并行机制

| 机制 | 通道 | 用途 | 触发 |
| --- | --- | --- | --- |
| **`cmd_player_*` MsgBus** | 进程内消息总线 | **改配置**（开关立即生效）| 设置页操作 |
| **`API_COMMAND` Intent** | Service/Broadcast | **传按键事件**（播放控制）| 硬件按键 |

> 前者是"改变行为规则"，后者是"触发一次行为"。两条链路互不干扰。

---

## 14. 跨页跳转的解析机制

### 14.1 跳转的完整链路

```
XML: w:target="misc#long_volume_controls"
  ↓ ① RedirectPreference 保存 target 字符串
  ↓ ② 点击时构造 Intent（带 open_path extra）
  ↓ ③ SettingsActivity.getExtraOpenPath() 读出
  ↓ ④ 新 helper 的 n91.w() 解析并定位
  ↓ ⑤ 350ms 后执行滚动/高亮
```

### 14.2 `RedirectPreference`：只存不解析

`RedirectPreference.smali` 全文仅 130 行，**没有任何解析逻辑**【实证·产物】：

| 成员 | 作用 |
| --- | --- |
| `h:Ljava/lang/String` | 保存 `target` 字符串（`setDependencyRaw` 写入）|
| `В()` | 若有 `h`，调 `setDependency(h)` |

> 它 `extends RawTextPreference`，本质只是**带 dependency 能力的文本行**。真正的跳转由点击监听器处理。

### 14.3 `PrefBase.setTarget` → `qd0.u()`：拼接式页面路径

`RawTextPreference:294` 从 styleable 读 target 后调 `setTarget` → `PrefBase:439-464` → `qd0.u(String)`。

【实证·产物】`qd0.smali:9720-9836`（116 行）：

```java
void u(String target) {
    setFragment(null);                       // ← 不用 Android Fragment 机制
    this.К = target;                         // 保存原始 target

    if (target == null) return;

    // URL 直接透传
    if (target.startsWith("http:") || target.startsWith("https://")) {
        this.у = target;
        return;
    }

    // 非 URL：加 "settings/" 前缀
    String prefix = target.startsWith("/") ? "" : "settings";
    this.у = ee1.a(prefix, "/", target);     // 简单字符串拼接
}
```

`ee1.a(a,b,c)` 就是 `a + b + c`【实证·产物】`ee1.smali:308-340`（33 行）。

> **所以 `misc#long_volume_controls` 会被拼成 `"settings/misc#long_volume_controls"`，`#` 完好保留。**

### 14.4 `n91.w()`：读取 Intent 的 `open_path`

【实证·产物】`n91.smali:2766-2914`（148 行）：

```java
void w() {
    String path = activity.getExtraOpenPath();   // ← 从 Intent 读，不是从 qd0
    if (path == null || path.length() == 0) return;

    String[] parts = path.split("/");             // ★ 用 "/" 分割
    if (parts.length <= 1) return;

    String anchor = parts[1].trim();
    Preference p = K.findPreference(anchor);      // 直接当 key 用
    if (p != null) X.postDelayed(new b6(this, 0x1b, p), 0x15e /* 350ms */);
}
```

**`getExtraOpenPath()`**【实证·产物】`SettingsActivity.smali:858-903`：

```java
String getExtraOpenPath() {
    Intent i = getIntent();
    String v = i.getStringExtra("obj");        // 优先读 "obj"
    if (v == null) {
        v = i.getStringExtra("open_path");     // 回退读 "open_path"
    }
    return v;
}
```

> **双 key 设计**：`obj` 用于组件内跳转，`open_path` 用于 Intent 传递（其他 App / 桌面快捷方式）。

**`w()` 的三个调用点**：

| 调用点 | 时机 |
| --- | --- |
| `u61.smali:1736` | **helper 创建完成后**（主路径）|
| `n91.smali:3545` | 页面 resume 时 |
| `g91.smali:109` | 内嵌场景 |

> **350ms 延迟**：等 `PreferenceScreen` 完成布局后才能滚动到目标项。

### 14.5 带参跳转的构造模式（`v81` 实例）

【实证·产物】`v81.smali:1183-1286`：

```java
String path = super.О()                        // 当前页面路径
    + "?theme_pak=" + Uri.encode(themePak)     // ★ URI 编码！
    + "&theme_id=" + themeId
    + "&theme_page_path=" + pagePath;
```

| 点 | 说明 |
| --- | --- |
| **`Uri.encode()`** | 参数值必须编码（`v81:1217`），防止值中含 `&`/`=`/`#` 破坏结构 |
| **`?` 起始、`&` 分隔** | 标准 URL query 语法 |
| **`О()` 取 base** | `n91.О()` 返回当前页面路径 |

### 14.6 `?uniqName=...&device=chromecast#no_af` 的语义

回到 `audio_focus` 的 `cc_af_warning`：

```
audio_output_device_opts?uniqName=com.maxmpz.audioplayer/output.cc&device=chromecast#no_af
```

| 部分 | 值 | 含义 |
| --- | --- | --- |
| 页面 | `audio_output_device_opts` | 输出设备选项页 |
| `?uniqName=` | `com.maxmpz.audioplayer/output.cc` | **音频设备唯一名**（Chromecast 输出标识）|
| `&device=` | `chromecast` | 设备类型 |
| `#no_af` | `no_af` | 锚点：**"no audio focus"** 配置项 |

**`n81` 类佐证**：`n81.toString()` 输出的正是音频设备描述【实证·产物】`n81.smali:97-180`：

```
n81 uri=<uri> opts=0x<hex> deviceId=<int> uniqName=<name> hasSampleRates=<bool> hasSampleFormats=<bool>
```

> 语义：**"跳到 Chromecast 这个具体输出设备的配置页，并定位到 no_af 选项"**。
>
> 对应 `pref_cc_af_warning` 的文案 "Chromecast output may ignore calls and short Audio Focus completely"——给出直达链接让用户去关掉 Chromecast 的音频焦点处理。

### 14.7 ⚠️ 已知边界：`#` 语法的运行时解析未定位

**这是一个诚实记录的空白**。

排查结论：

| 排查方向 | 结果 |
| --- | --- |
| 全库 `replace(CC)` 调用（6 个类）| **无一处是 `#`→`/`**（`dn0` 是 `\\`→`/`，`ne` 是 `/`→`_`，`q10/v10/y10` 是 `.` 替换）|
| 全库 `const 0x23`（`#` ASCII）| 3 处（`b12:1177`、`n71:1866`、`z22:1046`），均为数字格式化/字符范围判断，**与路径无关** |
| `PrefBase.setTarget` 链路 | 走 `qd0.u`，拼成 `"settings/" + target`，**`#` 原样保留** |

**矛盾点**：按 §14.4，若 `open_path = "settings/misc#long_volume_controls"`，则 `findPreference("misc#long_volume_controls")` 会**查不到任何 key**。

**最可能的解释（【推断】）**：`RedirectPreference` 的点击**根本不经过 `n91.w()`**。两条机制适用场景分开：

| 机制 | 触发场景 | `open_path` 的值 |
| --- | --- | --- |
| **A（`qd0.u`）** | **设置页内的 RedirectPreference 点击** | 不写 `open_path`，走 `qd0.у` |
| **B（`n91.w`）** | **外部 Intent 跳入**（桌面快捷方式、其他 App）| `"<page>/<key>"` 形态 |

证据支撑：

1. `n91.w()` 的三个调用点都在**"页面加载"时机**，不是"点击 RedirectPreference"时机
2. `n91.P()`（写 `open_path`）用的是 `р()` = **当前页面路径**，不含锚点
3. 全库只有 1 处 `setFragment` 且传 `null` —— 确认不走 Android 标准 Fragment 跳转
4. `SettingsActivity.isValidFragment` 只允许 `u61` 一个 Fragment

**结论**：XML 的 `#` 语法由谁处理**仍未定位**。可能需要：
- 在 `SettingsActivity.startActivity()`（3506–3720 行，215 行，未展开）里
- 或 `#` 只是**给人看的文档标记**，实际运行时由 `qd0.u` 拼的 `"settings/misc#..."` 交给别的消费方

> **对文档读者最重要的是**：`w:target="page#key"` 这个语法**确实有效**（XML 里大量使用，功能正常），但**其解析路径不在已定位的两个机制里**。这个断层如实记录，不用推断掩盖。**需动态调试**（在 `findPreference` 下断点看实参）才能闭合。

---

## 15. 未解问题与已知边界

### 15.1 已知边界（非"待解问题"）

| 项 | 状态 | 需要什么才能解开 |
| --- | --- | --- |
| **XML `w:target="page#key"` 的运行时解析** | 已排除 5 种假说（§14.7）| **动态调试**：在 `findPreference` 下断点 |
| `x80` 的 `ra1` 授权回调 | 已定位到 `sa1:924` 传入，未展开 | 读 `ra1.smali`（142 行）|
| `n81.uri` 的构造点 | 全库无 `new-instance n81` | 可能在 native 层或反射创建 |
| `BTReceiver` 类静态缺失 | `rk0:2946` 引用但类文件不存在 | 被 proguard 移除或动态加载 dex |
| `vd0` / `vk0` 的选用时机 | 两者都实现 MediaSession 客户端 | 需追调用方 |

### 15.2 覆盖度评估

| 维度 | 覆盖度 |
| --- | --- |
| 根页 18 个 key 的语义与落地 | ✅ 全部 |
| 3 层依赖链 | ✅ 声明式，零代码 |
| 按键运行时（`rk0`/`w8`/`s91` 状态机） | ✅ 全部 |
| 1 个真子页 `commands_history` | ✅ 记录结构 + 数据源 + 刷新机制 |
| 2 个跨分支跳转 | ✅ 目标页 + 落点 + 参数语义 |
| 跨页跳转的三层机制 | ✅ 两层已定，第三层为边界 |

**剩余项的共同特点**：都不影响"这个功能怎么工作"的理解，只影响"某一行代码在哪个文件"的完备性。

### 15.3 若将来要继续

按成本排序：

1. **读 `ra1.smali`（142 行）** —— 半小时内可完成，能闭合 `x80` 回调
2. **动态调试 `findPreference`** —— 需 frida/Xposed 环境
3. **反编译 native 层找 `n81` 构造** —— 成本最高，收益最低

---

## 16. 对 SpMusic 的可借鉴 / 不建议照抄

### 16.1 根本不可移植

**本页一半以上条目依赖 Android 系统级能力**，其他平台无法照搬：

| 能力 | 依赖 |
| --- | --- |
| 耳机按键接收 | `MediaButtonReceiver` + `ACTION_MEDIA_BUTTON` |
| 设备连接/断开检测 | `AudioManager` 广播 + `A2dpOn` 状态 |
| 音频焦点 | `AudioManager.requestAudioFocus` |
| 长按语音搜索拦截 | `PackageManager.setComponentEnabledSetting` |
| 音量键长按 | `SET_VOLUME_KEY_LONG_PRESS_LISTENER`（签名级）|
| 蓝牙 AVRCP | `MediaSession` 回调 |

### 16.2 值得借鉴的 3 个设计

| # | 做法 | 为什么好 |
| ---: | --- | --- |
| 1 | **XML 承载全部产品语义，helper 只做平台补丁** | 18 key 只用 298 行；改动产品逻辑不用碰代码 |
| 2 | **声明式依赖链**（`android:dependency` 三层） | 零代码实现"母关子灰"，框架自动处理 |
| 3 | **诊断日志 + `commands_history` 黑匣子** | 用户能自查"为什么按键没反应"，减少支持成本 |

### 16.3 不建议照抄的 4 点

| # | 问题 | Poweramp 做法 | SpMusic 应该 |
| ---: | --- | --- | --- |
| 1 | **用越界索引复用 default** | `s91` 名义 4 分支实际 5 语义；`z91`/`ha1` 同样 | 显式给每个语义一个具名常量 |
| 2 | **破坏性操作按钮文案误导** | `skip_video` 的正按钮是 "Scanning..." 而非 "OK" | 破坏性操作应明确写 "Erase & Rescan" |
| 3 | **跳转条目标题不一致** | `long_volume_press` 无 title，`audio_focus` 有 | 同类条目统一 |
| 4 | **实验特性藏在跨页跳转后** | 用户从耳机页点进去才发现要装 Shizuku | 入口处就标明依赖 |

---

## 17. 证据索引

### 17.1 XML / 资源

| 位置 | 内容 |
| --- | --- |
| `headset.xml:2` | 根节点 `pref_headset_bt` |
| `headset.xml:4-10` | 分类一 `pref_headset_connection`（5 项）|
| `headset.xml:9` | `audio_focus` 跳转（无 key）|
| `headset.xml:11-23` | 分类二 `pref_headset_buttons`（11 项）|
| `headset.xml:15` | `long_volume_press` 跳转（**无标题**）|
| `headset.xml:24` | `commands_history` 跳转 |
| `headset.xml:25` | `restore_defaults` |
| `commands_history.xml:2` | **空 PreferenceScreen**（247 B）|
| `audio_focus.xml:2` | 根节点 + `searchBreadcrumb1` |
| `audio_focus.xml:4-21` | 11 个元素 |
| `misc.xml:35` | `long_volume_controls` + `w:sup` 实验徽标 |
| `arrays.xml` | `pref_headset_controls_entries`（3 项）|
| `public.xml` | 59 个 `type="xml"` 页面 id |

### 17.2 smali —— 页面与 helper

| 位置 | 内容 |
| --- | --- |
| `u61.smali:1357-1375` | `headset` → `0x7f160015` → `new u91(...)` |
| `u61.smali:1362-1375` | 同上（`new-instance u91` 细节）|
| `u61.smali:1555` 附近 | `headset` 分发确认 |
| `u61.smali:983-999` | `audio_focus` → `z61` idx **2** |
| `u61.smali:1576-1585` | `misc` → `sa1` |
| `u61.smali:1634-1643` | `commands_history` → `o91` |
| `u61.smali:1736` | `n91.w()` 主调用点 |
| **`u91.smali:7-297`** | **`v()` 全部 8 件事** |
| `u91.smali:148-200` | `long_volume_press` 的 SDK<26 移除 |
| `u91.smali:206-255` | `no_android_long_press` 的 SDK>33 移除 |
| `u91.smali:262-291` | `restore_defaults` → `x11(11)` |

### 17.3 smali —— 监听器与消息

| 位置 | 内容 |
| --- | --- |
| `s91.smali:38-393` | `onPreferenceChange`（355 行）|
| `s91.smali:159-228` | `pswitch_0` = `avrcp_controls`（索引 3）|
| `s91.smali:232-318` | `pswitch_1` = `headset_controls`（索引 2）|
| `s91.smali:321-344` | `pswitch_2` = `enable_headset_controls`（索引 1）|
| `s91.smali:347-379` | `pswitch_3` = `resume_on_bt`（索引 0）|
| `s91.smali:69-156` | **default** = `no_android_long_press`（索引 4）|
| `s91.smali:387-392` | 4 项 packed-switch 表 |
| `t91.smali:38-121` | `run()`：索引 0/1 两条消息 |
| `b6.smali:91-147` | default 分支（索引 29）→ `cmd_player_enable_headset_controls` |
| `b6.smali:3497-3527` | 29 项 packed-switch 表 |
| `x11.smali:849-875` | 25 项 packed-switch 表 |

### 17.4 smali —— 偏好字段

| 位置 | 内容 |
| --- | --- |
| `vr.smali:1580-3519` | 14 个 headset 字段定义（§6.1）|
| `vr.smali:1417-3503` | `audio_focus` 9 个字段 |
| `vr.smali:1804-1816` | `long_volume_controls` → `vr->E0` |

### 17.5 smali —— 运行时 (`rk0` / `w8`)

| 位置 | 内容 |
| --- | --- |
| `rk0.smali:7-73` | `A()` 静音/焦点桥 |
| `rk0.smali:75-326` | `B()` 振动 + 调度（251 行）|
| `rk0.smali:328-588` | `X()` API_COMMAND Intent 分发（260 行）|
| `rk0.smali:590-621` | `x()` 状态清理 |
| `rk0.smali:623-670` | `y()` 设备连接态刷新 |
| **`rk0.smali:672-1295`** | **`В()` 提示音播放器（623 行）** |
| `rk0.smali:681-708` | 取 `SoftReference<AudioTrack>` |
| `rk0.smali:725-730` | `AUtils.s(ctx)` 取 PCM |
| `rk0.smali:842` | `sput ->у` 缓冲区大小 |
| `rk0.smali:1037` | `AudioTrack.write()` |
| `rk0.smali:1051` | `sput ->y` 缓存 AudioTrack |
| `rk0.smali:1102-1153` | 按媒体音量 `setVolume` |
| `rk0.smali:1158-1166` | **三种提示音类型 `if-eq v0, 1/2/3`** |
| **`rk0.smali:1297-1324`** | **`Х(I,Z,Z)I` 标志位打包（27 行）** |
| `rk0.smali:41` / `:310` | `PSMediaButtonReceiver` 类名常量 |
| `rk0.smali:537-554` | startService 失败 → `sendBroadcast` 降级 |
| `rk0.smali:1326-5654` | `х()` = `onReceiveStatic`（4328 行）|
| `rk0.smali:1346-2823` | 9 条诊断日志 + KeyEvent 属性 |
| `rk0.smali:1413` | 接收 `ACTION_MEDIA_BUTTON` |
| **`rk0.smali:1536-1561`** | **取 keyCode/action/repeatCount/eventTime** |
| `rk0.smali:1701-1709` | 读 `vr->B0`（`headset_controls`）|
| `rk0.smali:1995-2007` | 读 `vr->C0` + `vr->t2` |
| `rk0.smali:2015-2027` | `follow_pl_exact` 配合键码 `0x7f`/`0x7e` |
| `rk0.smali:2946` | `BTReceiver->А` 引用（类缺失）|
| `rk0.smali:2967-2990` | `ignore_bt_sec` × 1000 → clamp `0x4e20` |
| `rk0.smali:2998-3043` | **双时间差判定** |
| `rk0.smali:3048-3097` | `IGNORE AVRCP MEDIA_BUTTON events` 日志 |
| `rk0.smali:3119-3140` | `IGNORED due to ignore_bt_sec` |
| `rk0.smali:3288` | 广播 `MEDIA_BUTTON_IGNORED` |
| **`rk0.smali:3406-3518`** | **语音助手拦截（300ms）** |
| `rk0.smali:3667-3695` | **状态机核心**：`B` 幂等 + `A==0` + 写 `A`/`А` |
| `rk0.smali:3699-3747` | 构造 `what=2` 延迟消息 |
| `rk0.smali:3816-3822` | `A` 的第二次读取（重复按键判定）|
| `rk0.smali:3925-3943` | `х`（repeatCount）读写 |
| `rk0.smali:4049-4053` | `A` / `А` 的第二组写入 |
| `rk0.smali:4196` | `Х` 读取（转发时间）|
| `rk0.smali:3437-3473` | `A` 字段比对 + **300ms**（`0x12c`）判定 |
| `w8.smali:88-301` | `dispatchMessage`（213 行）|
| `w8.smali:303-863` | `handleMessage`（560 行）|
| `w8.smali:315-319` | 按构造参数 `В` 分发 |
| **`w8.smali:353-420`** | **`arg2` 解包：低 3 位 + `0x100` + `0x200`** |
| `w8.smali:425-445` | keyCode 常量 |
| `w8.smali:533` | 去抖阈值 `0x3e8`（1000ms）|
| **`w8.smali:573-614`** | **`follow_pl_exact` 去抖** |
| `w8.smali:721-774` | `what=3`（长按）|
| `w8.smali:760-774` | `what=4` → `rk0.B()` |
| `w8.smali:785-846` | 汇聚到 `rk0.X()` |

### 17.5b smali —— 深层机制

| 位置 | 内容 |
| --- | --- |
| **`dy1.smali:4360-4427`** | **`c()Z` 判定**（68 行）|
| **`dy1.smali:6978-7087`** | **`r()`：`setComponentEnabledSetting(VoiceSearchHelperActivity)`** |
| `dy1.smali:7019-7023` | `VoiceSearchHelperActivity` 引用 |
| `dy1.smali:7059` | `DONT_KILL_APP` |
| `dy1.smali:6816-6863` | `p()` = `ComponentName` 工厂 |
| `dk0.smali:3870/3898/3945/3973` | `c()` 的 4 处调用 |
| `rl0.smali:3069` | `c()` 的第 5 处调用 |
| `jd0.smali:1-747` | 媒体控制器客户端基类（19 个空方法）|
| `ud0.smali:29-1348` | 9 个覆写（传统 MEDIA_BUTTON）|
| `uk0.smali:47-2664` | 18 个覆写（MediaSession 扩展）|
| `vd0.smali:300-309` | `new ud0(vd0)` + `qd0.q(callback, handler)` |
| `vk0.smali:1323-1885` | `PREV_CAT`/`NEXT_CAT`/`TOGGLE_RATING`/`LIKE`/`SHUFFLE`/`REPEAT` |
| `id0.smali:1` | `extends MediaSession$Callback` |

### 17.6 smali —— `commands_history`

| 位置 | 内容 |
| --- | --- |
| **`o91.smali:805-810`** | **`v()` 空实现（5 行）** |
| `o91.smali:463-778` | `J()` 页面重建（315 行）|
| `o91.smali:475` | `removeAll()` |
| `o91.smali:484` | `jo0.В()` 取记录 |
| `o91.smali:686-707` | **32ms 补查** |
| `o91.smali:716-739` | 空态 "empty"（`0x7f080005`）|
| `o91.smali:746-763` | 记录 `j = jo0.A` |
| `o91.smali:1031-1068` | `с()`：渲染 + **250ms 轮询** |
| `o91.smali:51-232` | `I()` 文本生成（181 行）|
| **`o91.smali:245-298`** | **清空菜单：`zm.clear()` + `jo0.A++`** |
| `o91.smali:317-357` | 复制菜单 |
| `o91.smali:371-450` | 分享菜单 |
| `o91.smali:921-981` | `ShareActionProvider` + `ACTION_SEND` |
| **`jo0.smali:34-54`** | **环形缓冲 64 条** |
| `jo0.smali:61-257` | `B()` 写入 + 加锁覆盖 |
| `jo0.smali:19-57` | 环形缓冲构造（`<clinit>`）|
| `jo0.smali:78-132` | `Log.w("PlayerCommandsHistory", ...)` |
| `jo0.smali:261-414` | `В()` 两段拷贝重组 |
| **`hf1.smali:19-57`** | **构造器**：四字段 + 自动 `currentTimeMillis()` |
| **`hf1.smali:61-204`** | **`toString()`：字段名权威来源** |
| `hf1.smali:73-112` | `type` 映射：`0→command`、`1→external` |
| `hf1.smali:127-195` | 拼接 `type=/source=/command=/extraInfo=` |
| **`zm.smali:373-416`** | **`clear()`：槽位 null + size=0** |
| **`rl0.smali:1253-1456`** | **13 条音频焦点记录** |
| `rl0.smali:1273/1303/1350` | `AUDIOFOCUS_LOSS` 三分支 |
| `rl0.smali:303/609/1078` | `UNDUCK`/`RESUME`/`wasPausedByFocusChange=` |
| `rl0.smali:1393` | `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK` |
| `zf.smali:931` | **唯一的 `type=0`**：`PSSleepTimer` |
| **`oo0.smali:290`** | **`0x7530` = 30 秒挂载窗口** |
| `oo0.smali:307-311` | `RESUME resume_on_mount`（`oo0.smali:311`）|
| `cl0.smali:5545-5556` | `reloadPipeline`（`cl0.smali:5556`）|
| `jl0.smali:6227-6230` | 播放核心事件（`jl0.smali:6230`）|
| `dy1.smali:6798-6801` | 服务层命令（`dy1.smali:6801`）|
| `t4.smali:2078-2085` | `handleSearchAndPlay`（`t4.smali:2085`）|
| `ik0.smali:1146/1160` | `pauseInCall` |
| `dk0.smali:4809` | `pausePlaying` |

### 17.7 smali —— `audio_focus` / `long_volume_controls`

| 位置 | 内容 |
| --- | --- |
| `z61.smali:4597-4698` | `pswitch_11` = `audio_focus`（103 行）|
| `z61.smali:4628-4673` | `af_short` 开启 → 强制 `pause_in_call` |
| `z61.smali:4752-4774` | 20 项 switch 表 |
| **`tc.smali:598-667`** | **`af_short` 监听器（索引 3）** |
| `tc.smali:899-910` | 10 项 switch 表 |
| `sa1.smali:262-405` | `long_volume_controls` 权限判定 |
| `sa1.smali:314-318` | `SET_VOLUME_KEY_LONG_PRESS_LISTENER` 检查 |
| `sa1.smali:286` | `_long_volume_shizuku_grant` 的 `findPreference` |
| **`sa1.smali:908-998`** | **`_long_volume_shizuku_grant` 懒加载 + 锚点拼接** |
| `sa1.smali:938-960` | `n91.H() + "#_long_volume_shizuku_grant"` |
| `sa1.smali:972-976` | `u0(0xe, this)` 进度回调 |
| **`x80.smali:130`** | **目标权限** |
| `x80.smali:138-167` | `/system/bin/cmd package grant` |
| `x80.smali:178` | **10 秒超时** |
| `x80.smali:257` | `IShizukuService` |
| `x80.smali:243` | `"no Shizuku binder"` |

### 17.8 smali —— 跨页跳转

| 位置 | 内容 |
| --- | --- |
| `RedirectPreference.smali:1-130` | 全文仅存 `h` 字段 |
| **`SettingsActivity.smali:858-903`** | **`getExtraOpenPath()`：`obj` → `open_path`** |
| **`n91.smali:2766-2914`** | **`w()` 锚点解析（148 行）** |
| `n91.smali:2784` | 取 `getExtraOpenPath()` |
| `n91.smali:2808-2812` | **`split("/")`** |
| `n91.smali:2830` | `parts[1]` 取第 2 段 |
| `n91.smali:2874` | `findPreference(anchor)` |
| `n91.smali:2890-2903` | `b6(0x1b)` + **350ms** |
| `n91.smali:3545` | `w()` 的 resume 调用点 |
| `g91.smali:109` | 内嵌场景调用 |
| **`qd0.smali:9720-9836`** | **`u(String)` target 解析器** |
| `qd0.smali:9727` | 清空 `у` 字段 |
| `qd0.smali:9739` | `setFragment(null)` |
| `qd0.smali:9744` | 保存原始 target 到 `К` |
| `qd0.smali:9752-9784` | `http:` / `https://` 直接透传 |
| `qd0.smali:9788-9818` | 拼 `"settings/" + target` |
| **`ee1.smali:308-340`** | **`a(a,b,c)` 纯字符串拼接** |
| `PrefBase.smali:439-464` | `setTarget()` → `qd0.u()` |
| `RawTextPreference.smali:294` | 从 styleable 读 target |
| **`v81.smali:1183-1286`** | **带参跳转构造** |
| `v81.smali:1217` | `Uri.encode()` |
| **`n81.smali:97-180`** | **`toString()` 输出 `uri/opts/deviceId/uniqName`** |
| `SettingsActivity.smali:1163-1188` | `isValidFragment` 只允许 `u61` |

### 17.9 消息 id 对照

| id | 资源名 |
| --- | --- |
| `0x7f0d0034` | `bus_player_cmd` |
| `0x7f0d048b` | `cmd_player_enable_headset_controls` |
| `0x7f0d048c` | `cmd_player_refresh_headset_controls` |
| `0x7f0d0508` | `cmd_player_apply_long_volume_controls` |
| `0x7f0d042b` | `commands_history` 清空菜单 id |

### 17.10 交叉引用

| 文档 | 关系 |
| --- | --- |
| `poweramp-settings-page-runtime.md` | **上游**：三层骨架、`n91` 契约、`restore_defaults`、`C`=父页 id |
| `poweramp-audio-settings-structure.md` | `audio_focus` 所属分支 |
| `poweramp-misc-settings.md` | `long_volume_controls` 所属分支 |
| `poweramp-settings-root-structure.md` | §3.2 下钻索引、§8 文档地图 |
