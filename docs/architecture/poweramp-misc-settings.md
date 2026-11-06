---
doc_id: poweramp-misc-settings
title: Poweramp「设置 → 其他」偏好结构（build-1035）
doc_type: architecture
status: draft
owner_agent: lead
version_scope: build-1035-bundle-play (versionCode 1035009)
created: 2026-11-06
updated: 2026-11-06
source_documents:
  - .rea-analysis/v1035/decoded/res/xml/misc.xml
  - .rea-analysis/v1035/decoded/res/xml/lockscreen.xml
  - .rea-analysis/v1035/decoded/res/values/strings.xml
  - .rea-analysis/v1035/decoded/res/values/arrays.xml
  - .rea-analysis/v1035/decoded/res/values/public.xml
  - .rea-analysis/v1035/decoded/smali/ׅ/sa1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/u61.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/n91.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/vr.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/wr.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/qt0.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/wr0.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/x80.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/x11.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/ma1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/na1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/oa1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/pa1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/qa1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/ra1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/b6.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/ad.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/cl0.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/SeekbarPreference.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/EditTextPreference.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/ProgressPreference.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RedirectPreference.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/RawTextPreference.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/MultilineSwitchPreference.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/PseudoAlertDialogPreference.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/utils/AUtils.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/decoder/ffmpeg/FfmpegPluginService.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/player/PlayerServiceCore.smali
  - docs/architecture/poweramp-settings-root-structure.md
  - docs/architecture/poweramp-settings-page-runtime.md
  - docs/architecture/poweramp-background-settings.md
  - docs/architecture/poweramp-album-art-settings.md
---

# Poweramp「设置 → 其他」偏好结构

> **证据分级**：【实证·原文】= XML/资源原文；【实证·产物】= 反编译 smali 产物；【推断】= 无直接代码佐证。
>
> 所有结论基于 **build-1035-bundle-play**（`versionCode 1035009`）。
>
> **本文不重述共享机制**：三层骨架、分发表、`w:skipSearch` 两级索引、`w:target` 三态、`n91` 基类契约、`"global"` 共享 SharedPreferences、`k(Z)` 重启换页，均见 `poweramp-settings-page-runtime.md`。本文只写**本页独有**的内容。

## 0. 一句话结论

「其他」页是**全设置树最长的一页**（38 行 XML / 31 元素 / 27 个 `android:key`），却只由**一个 32823 字节的 helper `sa1`** 驱动，且 `sa1` 的 1492 行里**有 900 行集中在单一方法 `v()`**。本页的复杂度不在"控件多"，而在**四个互不相关的子系统被硬塞进同一页**：Scrobbling（外发）、Android Auto（MediaBrowser）、Tweaks（协议/参数杂项）、Volume Keys Long Press（Shizuku 系统权限）。其中最值得研究的是两个**浮点缩放滑杆**（`w:scale` 1000 / 1048576）——**UI 值与存储值差 3 个数量级**。

---

## 1. 页面身份

| | |
| --- | --- |
| XML 文件 | `res/xml/misc.xml`【实证·原文】 |
| 资源 id | **`0x7f16001e`**【实证·原文】`public.xml:11077` |
| 行数 | **38**（含 `<?xml>` 与根标签） |
| 字节 | **6909**（UTF-8） |
| 元素总数 | **31**（根 `PreferenceScreen` + 4 个 `PreferenceCategory` + 26 个条目） |
| `android:key` 数 | **27**（4 个分类占 3 个 + 条目占 24 个） |
| 无 key 条目 | **3** 个 `RawTextPreference` |
| 分类数 | **4** |
| 控件分布 | MultilineSwitch **15** / RawText **4** / Seekbar **2** / **EditText 2** / Progress **1** / Redirect **1** |
| 页面标题 | `@string/pref_misc` = **Misc** |
| 页面摘要 | `@string/pref_summary_misc` = **Scrobbling, Android Auto, other tweaks** |
| 设置页 helper | `ׅ/sa1.smali`（**32823 字节 / 1492 行**） |
| 偏好字段定义 | `ׅ/vr.smali`（本页 **16** 个 key）+ `ׅ/wr.smali`（**2** 个：`check_for_skin_reload`、`op_framerate`） |
| 分发表条目 | `u61.smali:1576-1589` → `new sa1(...)`【实证·产物】 |

> **18 / 27 的差**：5 个 key 不在 `vr`/`wr` 里——`buttons`（Redirect，不持久化）、`migrate_data_29`（RawText 动作项）、`volume_keys_long_press_hint`（RawText）、`_long_volume_shizuku_grant`（Progress 按钮）、`restore_defaults`（裸 `Preference`）。**这 5 个都不需要存储字段**，与运行时文档 §6 的 `"global"` 共享偏好一致。

> **⚠️ 更正一个易错点**：`sa1` 构造函数里 `const v0, 0x7f160026`（`sa1.smali:21`）**不是本页资源 id**——那是 `singlepane`（根页面），作为 `n91` 的**第 4 参 `p4` → `C` 字段**（`n91.smali:253`）。真正的本页 id 是**第 3 参 `p3` → `y` 字段**（`n91.smali:249`），由 `u61.smali:1589` 传入 `0x7f16001e`。
>
> 这与 `poweramp-settings-page-runtime.md` §4.2 的 `y` = "当前页 xml 资源 id" / `C` = "另一个资源 id" 完全吻合——`sa1` 是**唯一把 `C` 硬编码为根页面 id** 的 helper 之一，语义待解（见 §12）。

### 1.1 四项与全树对比

| 指标 | `misc`（本页） | `aa_bg`（背景） | `aa`（专辑封面） | 排名 |
| --- | ---: | ---: | ---: | --- |
| XML 行数 | **38** | 20 | 26 | **第 1** |
| 元素数 | **31** | 15 | 19 | **第 1** |
| `android:key` 数 | **27** | 11 | 18 | **第 1** |
| 分类数 | **4** | 1 | 2 | **第 1** |

> 根文档 §3.1 记 `misc` 为「37 行 / 25 偏好行」——本文按 `read` 实测为 **38 行 / 31 元素 / 27 key**。差异来自计数口径（根文档"偏好行"可能不含分类标签与 `restore_defaults`），**以本文实测为准**。

---

## 2. 31 个元素逐条

按 XML 实际顺序。**np** = `persistent="false"`；**dep** = 有 `android:dependency`；**🧪** = 带 Experiment 徽标。

### 2.1 分类一 `pref_scrobbling`（Scrobbling，**无 key**，3 项）

| # | key | 类型 | 标题 | 摘要 | 默认 | 标志 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | *（分类头）* | Category | **Scrobbling** | — | — | 无 key |
| 2 | `scrobble_to_last_fm` | MultilineSwitch | Scrobble via Official Last.fm app | Scrobble via Last.fm app | `false` | 显式 `persistent="true"` |
| 3 | `scrobble_to_simple_last_fm` | MultilineSwitch | Scrobble via Simple Scrobbler | Scrobble to Last.fm/Libre.fm via Simple Scrobbler (previously Simple Last.fm) | `false` | 显式 `persistent="true"` |
| 4 | *（无 key）* | RawText | — | `w:line1` = **Most scrobbler apps should work without extra configuration** | — | `w:skipSearch="false"`、`w:keepPaddings="true"`、背景 `@drawable/settings_quote_background` |

### 2.2 分类二 `android_auto`（Android Auto，**有 key**，6 项）

| # | key | 类型 | 标题 | 摘要 | 默认 | 标志 |
| ---: | --- | --- | --- | --- | --- | --- |
| 5 | *（分类头）* | Category | **Android Auto** | — | — | **key=`android_auto`** |
| 6 | `buttons` | **Redirect** | Buttons | Media action buttons | — | `w:target="ui_mediaactions"` |
| 7 | `mb_a_grid` | MultilineSwitch | Grid View for Categories | If enabled, Albums, Artists, Folders, etc. categories are shown as grid. **May require category re-opening for view to apply** | — | 无 `defaultValue` |
| 8 | `mb_a_aa_cats` | MultilineSwitch | Images for Categories | If enabled, album art and other relevant images are shown for categories | **`true`** | — |
| 9 | `mb_a_aa_tracks` | MultilineSwitch | Album Art for Tracks | If enabled, album art is shown for track entries | **`true`** | — |
| 10 | `send_mediasession_q` | MultilineSwitch | Now Playing List For Connected Devices/Apps | Enable Now Playing List/Queue for the connected devices (e.g. Wear) and apps (Android Auto). **Poweramp activates this option if some device/app requests Now Playing list** | — | — |

### 2.3 分类三 `tweaks`（Tweaks，**有 key**，15 项）

| # | key | 类型 | 标题 | 摘要 | 默认 | 标志 |
| ---: | --- | --- | --- | --- | --- | --- |
| 11 | *（分类头）* | Category | **Tweaks** | — | — | **key=`tweaks`** |
| 12 | `send_metachanged` | MultilineSwitch | Metachanged Intent | For external apps | **`true`** | 显式 `persistent="true"` |
| 13 | `use_wakelock` | MultilineSwitch | Use Wakelock | Check this if audio stops when screen is off | — | — |
| 14 | `send_old_api_aa` | MultilineSwitch | Send Album Art for old API | Send Album Art for old Poweramp v2 API. Updated Poweramp API allows much higher res images, but this may be needed for old API apps | `false` | 显式 `defaultValue` |
| 15 | `check_for_skin_reload` | MultilineSwitch | Always Reload Skin | **For skin developers.** Always check skin for a change when app activity goes background | `false` | — |
| 16 | `shutdown_intent` | **EditText** | Shutdown Intent | Listen to this shutdown intent and pauses itself/stores state when the intent is received | `""` | **`w:summary2="%s"`** |
| 17 | `pause_on_screen_off` | MultilineSwitch | Pause on Screen Off | — | `false` | **🧪** |
| 18 | `op_framerate` | MultilineSwitch | Apply OP High Framerate | Force higher display framerate via non-standard APIs. May be required for some devices/firmwares | — | **🧪** |
| 19 | `migrate_data_29` | **RawText** | Migrate Data to Android 10 | —（正文见 `pref_summary_migrate_data_29`，走对话框） | — | **np**、`w:skipSearch="false"` |
| 20 | `stream_timeout_ms` | **Seekbar** | Network Stream Timeout | `%s`（格式化） | **`30000`** | **`w:scale="1000.0"`** + `w:entries`/`w:values` |
| 21 | `stream_buffer_bytes` | **Seekbar** | Network Stream Buffer | `@string/f1_mb` = **`%1$.1f MB`** | **`1048576`** | **`w:scale="1048576.0"`**、`w:min=524288`、`w:max=4194304`、`w:step=10240` |
| 22 | *（无 key）* | RawText | — | Increasing buffer size also increases stream start time | — | **np** |
| 23 | `user_agent` | **EditText** | User Agent | User Agent header value to use for the streaming | —（无 `defaultValue`） | 显式 `persistent="true"`、**`w:summary2="%s"`** |
| 24 | `load_user_so` | MultilineSwitch | Load custom .so library | Try to load custom ffmpeg_neon.so from the path: | `false` | **np**、**🧪** |
| 25 | `override_region` | MultilineSwitch | Override Region | — | `false` | — |

### 2.4 分类四 `volume_keys_long_press_cat`（Volume Keys Long Press，**有 key 但无 title**，3 项）

| # | key | 类型 | 标题 | 摘要 | 默认 | 标志 |
| ---: | --- | --- | --- | --- | --- | --- |
| 26 | *（分类头）* | Category | **（XML 无 `android:title`）** | — | — | **key=`volume_keys_long_press_cat`** |
| 27 | `volume_keys_long_press_hint` | RawText | — | **运行时动态生成**（见 §8.4） | — | **np**、`w:keepPaddings="true"`、背景 `@drawable/settings_quote_background` |
| 28 | `_long_volume_shizuku_grant` | **Progress** | Grant via Shizuku | **运行时动态生成**（4 种） | — | **🧪**、`w:skipSearch="false"` |
| 29 | `long_volume_controls` | MultilineSwitch | Change Tracks By Long Volume Keys Press | **运行时动态生成** | `false` | **🧪** |

### 2.5 页尾

| # | key | 类型 | 标题 | 标志 |
| ---: | --- | --- | --- | --- |
| 30 | `restore_defaults` | Preference | Restore Defaults | 无分类包裹 |

> **元素计数对账**：1 根 + 4 分类 + 26 条目 = 31。【实证·原文】`misc.xml:1-38`。
>
> 26 条目 = 2（scrobbling）+ 5（android_auto）+ 14（tweaks）+ 3（volume）+ 1（restore）+ **1**（`pref_summary_stream_buffer` 无 key，计入 tweaks #22）。其中 `#22` 与 `#4`、`#27` 是仅有的 3 个无 key 元素。

---

## 3. 四个分类的职责划分

| 分类 | key | 项数 | 职责 | 消费方 | 可移植性（对 SpMusic） |
| --- | --- | ---: | --- | --- | --- |
| `pref_scrobbling` | **无** | 3 | 把播放进度**外发给第三方 Scrobbler** | 外部 app（Last.fm / Simple Scrobbler） | **不可移植**（见 §11） |
| `android_auto` | `android_auto` | 6 | **Android Auto / MediaBrowser 的展示协议** | `MediaSession` + `MediaBrowserService` | 极低 |
| `tweaks` | `tweaks` | 15 | 协议兼容、流参数、调试开关——**杂项集合** | 五花八门（见 §6/§7） | **部分可借鉴** |
| `volume_keys_long_press_cat` | `volume_keys_long_press_cat` | 3 | **系统级音量键长按注入**（需 Shizuku/root） | 系统 `SET_VOLUME_KEY_LONG_PRESS_LISTENER` | **不可移植** |

### 3.1 `volume_keys_long_press_cat` 有 key 却无 title 的异常

这是全 App **唯一**一个「有 `android:key` 但没有 `android:title`」的 `PreferenceCategory`【实证·原文】`misc.xml:32`。

三个可能解释，结合代码可排除两个：

| 假设 | 判据 | 结论 |
| --- | --- | --- |
| A. 省略是有意的（分类不显示标题栏） | 若为真，其他页也应有同类写法 | **排除**——`lockscreen.xml`、`aa_bg.xml` 的分类都带 title |
| B. 运行时补上标题 | `sa1` 全文无 `volume_keys_long_press_cat` 之外的 `setTitle` | **排除**——`sa1.smali:759` 只 `findPreference` + `removePreference`，无 `setTitle` |
| C. **遗留/未完成**（作者本想用 `pref_volume_keys_long_press` 但漏写） | 该字符串资源**确实存在**（`@string/pref_volume_keys_long_press` = "Volume Keys Long Press"），且在同一 `sa1` 里被当作**对话框标题**使用 | **最可能** |

【实证·原文】`public.xml:5880` 有 `pref_volume_keys_long_press`；`ra1.smali:67` 用 `0x7f080766`（即该字符串）作 `PseudoAlertDialog.setTitle`。

> **推断**：这个分类头**渲染为空白标题栏**（`PreferenceCategory` 无 title 时只画分割线）。作者省掉标题，大概因为**整个分类只对 Android 8+ 可见**，且下方 3 项已各自带完整标题——空白分类头反而减少视觉噪音。这是**风格选择而非 bug**，但与全树其他页不一致，值得列为"不建议照抄"（见 §11）。

---

## 4. `w:scale` 浮点缩放机制（本页核心）

这是本页技术含量最高、也最容易被误读的机制。

> **🚨 仿写者必读（陷阱提示）**
>
> **1. XML 里写 `w:scale` 可能被静默忽略。** 只要同一元素也声明了 `w:entries`（≥2 元素），`SeekbarPreference.smali:389-413` 会**无条件**把 `scale` 重置为哨兵 `-1.0f`、`min=0`、`max=长度-1`、`step=1`、`floatScale=0`、`snapTo` 禁用。**没有任何日志、没有异常**——你以为写了 1000 倍缩放，实际生效的是 `w:values` 数组。
>
> **2. 本页的 `stream_timeout_ms` 正在踩这个坑**：它同时写了 `w:scale="1000.0"` 和 `w:entries`/`w:values`，**`w:scale` 是死属性**（§4.5）。
>
> **3. `w:scale` 与 `w:floatScale` 是两个不同属性**（索引 2 vs 索引 12，字段 `K:F` vs `p:F`），语义完全不同，**不可互换**（§4.2）。
>
> **4. `w:min`/`w:step` 必须整除默认值**，否则首次拖动就静默偏移（`stream_buffer_bytes` 实际发生，§4.6）。

### 4.1 结论先行

| key | `w:scale` | 存储值 | UI 显示值 | 关系 | `w:scale` 是否真生效 |
| --- | ---: | ---: | ---: | --- | --- |
| `stream_timeout_ms` | `1000.0` | `30000`（毫秒） | `30`（秒） | 存储 = UI × 1000 | ❌ **被 `w:entries` 覆盖** |
| `stream_buffer_bytes` | **`1048576.0`** | `1048576`（字节） | `1.0`（MB） | 存储 = UI × 1048576 | ✅ **生效** |

> **不是"UI 值 × scale"，而是双向换算**：写入时 `persistFloat(uiRaw / scale)`，读取时 `getPersistedFloat(...) × scale`。详见 §4.3。
>
> **注意上表最后一列**——两个滑杆写法几乎对称，**只有一个真正生效**。这是本页最隐蔽的不一致。

### 4.2 字段与读取点（精确行号）

`qt0->y0` 是本类的 styleable，**17 个元素**【实证·产物】`qt0.smali:2015-2028`（`array_2d`）+ `:5166-5185`：

```
{0x10100f2, snapTo, scale, entries, values, max, min, step, label, leftLabel,
 rightLabel, tickMark, floatScale, summary2, centerLabel, sup, supLink}
```

| 索引 | attr | 读取行 | 目标字段 | 默认 |
| ---: | --- | --- | --- | --- |
| 2 | **`scale`** | `SeekbarPreference.smali:146` | **`K:F`** | **`-1.0f`** |
| 4 | `entries` | `:271` | 资源 id → `obtainTypedArray` | `0` |
| 12 | **`floatScale`** | `:219` | **`p:F`** | **`0.0f`** |
| 13 | `summary2` | `:262` | `C:String` | null |

> **⚠️ 关键区分**：`w:scale`（索引 2）与 `w:floatScale`（索引 12）是**两个属性、两个字段、两套语义**：
>
> | | `w:scale` → `K:F` | `w:floatScale` → `p:F` |
> | --- | --- | --- |
> | 用途 | **整数量化**换算（§4.3） | **float 存储**换算 |
> | 存储类型 | `persistInt` | `persistFloat` |
> | 本页 | ✅ **两个滑杆都用** | ❌ 未用（默认 0.0f） |
>
> `p:F` 非零时，`getSummary`/`onBindView`/`onSetInitialValue`/`setValue`/`onStopTrackingTouch` 全走 float 通路（存原始 float，不 round）。**本页 `p:F` 均为 0.0f → 走整数通路**。

### 4.3 `K:F`（= `w:scale`）的用法与核心公式

`K:F` 在 `SeekbarPreference` 里被引用 **6 次**，全部是「UI 整数位 ↔ 真实整数」换算：

| 行 | 语义 |
| ---: | --- |
| `:1391-1410` | **绑定**：UI 位 ÷ scale → 存储值；存储 × scale → 回显位 |
| `:1162-1166` | **读取**：存储 × scale → `round` → `A(int)` |
| `:2241-2260` / `:2371-2375` / `:2431-2435` | **初始值**换算（int / Float / String 三个分支） |
| `:3622-3671` | **格式化**：`val / K` 后交给 `%s` |

**核心公式**（`onBindView`，`:1391-1422`）：

```asm
1394: iget v1, ..., ->о:I            ; ① о = 当前 UI 进度位
1395: div-float/2addr v1, v2         ; ② UI 位 ÷ K:F(= w:scale) = 存储值
1398: getPersistedFloat(v1)          ; ③ 读存储
1406: iget v2, ..., ->K:F
1410: mul-float v1, v1, v2           ; ④ 存储 × K = 回显位
1414: Math.round(v1)                 ; ⑤ 取整
1422: Х(v1)                          ; ⑥ 归一化后驱动 SeekBar
```

`Х(int)`（`:3728-3751`）做归一化：`(值 - у) / К` → 存入 `о`。其中 **`у` = `w:min`、`К` = `w:step`**。

> **三个字段千万别混**（混淆后必然算错）：
>
> | 字段 | 来源 | 类型 | 含义 | 默认 |
> | --- | --- | --- | --- | --- |
> | **`K`** | `w:scale`（索引 2） | **float** | 缩放倍数 | `-1.0f` |
> | **`К`** | `w:step`（索引 7） | **int** | 步长 | `1`（0 → 1） |
> | **`у`** | `w:min`（索引 6） | **int** | 最小值 | `0` |

### 4.5 `w:entries` / `w:values` 与 scale 同存时的**优先级**

`stream_timeout_ms` 同时声明了 **`w:scale="1000.0"`** 和 **`w:entries`/`w:values`**。哪个赢？

**答案：`entries` 赢，且会把 `w:scale` 重置为哨兵 `-1.0f`。**

`SeekbarPreference.smali:271-415` 的 `entries` 处理块：

```asm
:271  v8 = getResourceId(4, 0)          ; ★ 索引 4 = w:entries
:277  if (v8 == 0) → :cond_8            ; 无 entries → 整块跳过
:291  v8 = p1.length()
:293  if (v8 >= 2) → 继续, 否则 :cond_7  ; 至少 2 元素才算数
:296  v0 = p1.getType(0)                ; 首元素类型决定分支
:300  if (0x10 <= v0 <= 0x1f) → int[]
:332  else if (v0 == 0x4)     → float[]
:360  else if (v0 == 0x3)     → String[]
:418  else → throw AssertionError(v0)

; ★★ 三条分支汇合后（:389-413）无条件覆盖：
:389  a:Z = true                 ; 数组模式
:392  у:I = 0                    ; ★ w:min 清零
:401  y:I = length-1             ; ★ w:max = 数组长度-1
:404  К:I = 1                    ; ★ w:step 强制 1
:407  K:F = -1.0f                ; ★★ w:scale 重置为哨兵
:410  Н:I = 0x80000000           ; w:snapTo 禁用
:413  p:F = 0.0f                 ; w:floatScale 清零
```

> **⚠️ 这是本节最重要的发现**（三条）：
>
> **1.** `w:entries` 一旦生效（≥2 元素），**`scale`/`min`/`max`/`step`/`floatScale`/`snapTo` 全部被无条件覆盖**。所以 `stream_timeout_ms` 的 `w:scale="1000.0"` **不参与任何滑杆计算**。
>
> **2.** `K:F` 被设成 **`-1.0f`** 而非 0——**哨兵值**。`В(int,String)` 的 `:3625-3637` 判 `K < 0` 时**只做 `%s` 格式化，不做除法**。
>
> **3.** `stream_timeout_ms` 的 `w:values` 是 **`integer-array`**（首元素类型 `0x10` = `TYPE_FIRST_INT`），走 **int[] 分支**——下标是数组索引，真实值从 `С:[I` 取。

**`stream_timeout_ms` 的真实数据流**：

```
w:entries = {1, 5, 10, 15, 30, 60, 120, 300, @string/never}   (9 项, arrays.xml:913)
w:values  = {1000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 2147483647}
             ↑ 索引 4 = 30000，与 w:defaultValue="30000" 一致
             ↑ 索引 8 = Integer.MAX_VALUE，即 "Never"
```

| 层 | 值域 | 说明 |
| --- | --- | --- |
| SeekBar 位置 | `0..8` | 9 档 |
| 存储值 | `С[i]`（`persistInt`） | 1000..2147483647 毫秒 |
| summary 显示 | `b[i].toString()` | `"1"` / `"30"` / `"Never"` |

> **`w:scale="1000.0"` 在这里是死属性**。但 `w:values` 的数值恰好是 `entries × 1000`——作者**用 `values` 手工实现了本想用 `scale` 表达的东西**。
>
> 这揭示两者的**能力边界**：`scale` 只能表达**线性**换算，`values` 可表达**任意映射**（`300 → 300000` 是 ×1000，但 `2147483647` 不是任何数倍）。**同时写两者 = 语义重复，后者胜出。**

### 4.6 `stream_buffer_bytes` 走的是哪条路？

**它没有 `w:entries`/`w:values`**——所以 **`K:F = 1048576.0f` 真正生效**，走 §4.3 的整数通路。

| 属性 | 值 | 生效情况 |
| --- | --- | --- |
| `w:scale` | **`1048576.0`** | ✅ **生效**（无 `entries` 覆盖） |
| `w:min` | `524288` | ✅ → `у` 字段 |
| `w:max` | `4194304` | ✅ → `y` 字段 |
| `w:step` | `10240` | ✅ → `К` 字段 |
| `w:floatScale` | 未声明 → `0.0f` | 走整数通路 |
| `android:defaultValue` | **`1048576`** | `onGetDefaultValue` 用 `getInt`（`:1705-1729`） |

**初始化链**（`onSetInitialValue(false, 1048576)` → `:2309-2392` 的 `Integer` 分支）：

```
① defaultValue = 1048576 (int) → 走 setValue(1048576)
② setValue → Х(1048576) = (1048576 - 524288) / 10240 = 51.2 → div-int 截断 = 51
③ SeekBar 位置 о = 51
④ persistInt(1048576)          ; ★ 存储的是原始字节数，不是 51
⑤ SeekBar 的 max = (4194304 - 524288) / 10240 = 358.4 → 358
```

| 量 | 值 |
| --- | --- |
| SeekBar 范围 | `0 .. 358`（359 档） |
| 默认位置 | **51**（≈ 14%，靠左） |
| 存储值 | `1048576` 字节 = 1 MiB |
| `w:step` 对应的字节粒度 | 10240 字节 = 10 KiB |

> **⚠️ 一个真实缺陷：默认值 1048576 不在步长网格上。**
>
> `(1048576 − 524288) / 10240 = 51.2`——**不是整数**。`div-int` 截断成 51，但 `А(51) = 524288 + 51×10240 = 1046528`，**比默认值少 2048 字节**。
>
> 所以：**用户只要碰一下滑杆再松手**，`onStopTrackingTouch`（`:2758-2799`）就会把值从 `1048576` 写成 `1046528`（或相邻档位）。**1 MiB 这个"整数语义"默认值实际不可精确保留**。
>
> 这是 `w:min`/`w:step` 选择不当导致的（若 `w:min=0` 或 `w:step=2048` 均可整除）。**对 SpMusic 的启示**：滑杆的 `min`/`step` 必须让默认值落在网格上，否则首次交互会静默偏移。

**summary 显示**：`@string/f1_mb` = **`%1$.1f MB`**，走 `В()` 的 `K>0` 分支【实证·产物】`SeekbarPreference.smali:3656-3681`：

```asm
:3657 int-to-float v1, p1        ; p1 = 存储字节数（来自 getPersistedInt）
:3660 div-float/2addr v1, v0     ; ÷ 1048576.0
:3663 AUtils.C(Float.valueOf(v1), "%1$.1f MB")
```

| 存储值 | summary 显示 |
| ---: | --- |
| 524288 | `0.5 MB` |
| **1048576** | **`1.0 MB`** |
| 1046528（碰过滑杆后） | `1.0 MB`（1 位小数掩盖了差异） |
| 4194304 | `4.0 MB` |

> **`f1_mb` 与 `%s` 的本质区别**：
>
> | | `%s`（`stream_timeout_ms`） | `%1$.1f MB`（`stream_buffer_bytes`） |
> | --- | --- | --- |
> | 格式串 | `%s` | `%1$.1f MB` |
> | 参数类型 | **`String`**（entries 数组元素） | **`Float`**（除法结果） |
> | 输出 | `"30"` / `"Never"` | `"1.0 MB"` |
> | 单位 | **无**（靠标签暗示） | **显式 `MB`** |
>
> `1$` 是 Java Formatter 的**显式参数索引**——单参数时与 `%1$` 等价，但配合 `.1f` 精度时必须写索引形式才能混用。

### 4.7 两个滑杆的端点标签与刻度

| key | `w:leftLabel` | `w:rightLabel` | `w:tickMark` |
| --- | --- | --- | --- |
| `stream_timeout_ms` | **Small**（`pref_buffer_small`） | **Never**（`never`） | ❌ 无 |
| `stream_buffer_bytes` | **Small**（`pref_buffer_small`） | **More**（`pref_preload_more`） | ❌ 无 |

> **左标签相同、右标签不同**：Timeout 用 "Never"（**语义终点**），Buffer 用 "More"（**方向而非终点**）。
>
> **两者都无 `w:tickMark`**——对比 `aa_bg.xml` 的 3 个滑杆**都有** `tickMark`。推断：**有刻度条的是"有档位语义"的参数，无刻度条的是"连续数值"**。
>
> 但注意 `stream_timeout_ms` **实际是 9 档离散的**（`w:values` 数组）——**它本该有 tickMark 却没有**，因为 `entries` 模式把 `Н`（snapTo）置成了 `0x80000000`（§4.5）。

### 4.8 为什么用"缩放"而不用"浮点存储"

| 方案 | 存储类型 | 精度 | Poweramp 选择 |
| --- | --- | --- | --- |
| A. 直接存 UI 整数（秒/MB） | `int` | 丢失毫秒/字节精度 | ✗ |
| B. 存 float（走 `w:floatScale`） | `float` | 有精度，但跨类型读易 `ClassCastException` | 另一条通路，本页未用 |
| C. **存基本单位（ms/bytes）+ `w:scale` 换算** | **`int`** | **精确** | **✓ 本页采用** |

> **C 的核心好处**：存储层永远是 `int`，**与消费方接口直接一致**。`vr->с`（timeout）与 `vr->a`（buffer）都是 `rb1`（int 偏好）【实证·产物】`vr.smali:626-662`，消费处直接 `iget А:I`：
>
> - `vr->с` → `Pipeline2.z(9, timeout)`【实证·产物】`cl0.smali:2181-2201`
> - `vr->с` / `vr->a` → `lp0.В(..., 0x5, 0x1000, timeout, buffer, 0, 0)`【实证·产物】`FfmpegPluginService.smali:1712-1749`
>
> **若存 float，每个消费点都要做 `float→int` 转换**；用 scale 换算，**消费方拿到原生单位整数**，零转换。典型的"**存储层牺牲直观性，换消费层零成本**"。

---

## 5. 两个 `EditTextPreference` 专节

**全 App 仅有的两个 `EditTextPreference` 都在本页**【实证·产物】——`grep` 全部 43 个设置 XML，`<com.maxmpz.audioplayer.preference.EditTextPreference` 只出现 2 次，均在 `misc.xml:21,28`。

| key | `#` | 标题 | 默认 | `w:summary2` | `persistent` |
| --- | ---: | --- | --- | --- | --- |
| `shutdown_intent` | #16 | Shutdown Intent | **`""`**（显式空串） | **`%s`** | 省略（= true） |
| `user_agent` | #23 | User Agent | **未声明** | **`%s`** | 显式 `true` |

### 5.1 为什么只有这两个

两个字段的共性：**值是「任意字符串」，无法用枚举/滑杆/开关表达**。

| 项 | 值域 | 为什么不能用其他控件 |
| --- | --- | --- |
| `shutdown_intent` | 任意 **Intent action 字符串**（如 `com.example.SHUTDOWN`） | 无限多，且用户需粘贴 |
| `user_agent` | 任意 **HTTP User-Agent 字符串** | 无限多，且用户需粘贴 |

> **对比**：本页其他"字符串型"配置都做成了**枚举**——`override_region`（开关，因为只有开/关）、`check_for_skin_reload`（开关）。只有这两个**真的需要自由文本**。
>
> 其余 41 个设置页里，所有自由文本需求都被消解掉了（皮肤名走列表、路径走文件选择器、数字走滑杆）。**这解释了为什么 43 页只有 2 个 EditText**。

### 5.2 `EditTextPreference` 的实现与 `w:summary2="%s"` 回显

本页用的**不是 Android 原生 `EditTextPreference`**，而是 `com.maxmpz.audioplayer.preference.EditTextPreference`（继承 `PseudoAlertDialogPreference` → `DialogPreference`）。

**关键字段**【实证·产物】`EditTextPreference.smali:19-25`：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `H` | `String` | **当前值**（`getText()` 返回它，`:87-96`） |
| `P` | `String` | **空值时的显示文案**（来自 `w:summaryWhenEmpty`） |
| `Н` | `EditText` | 对话框里的输入框 |
| `Р` | `boolean` | 已初始化标志 |

**`w:summaryWhenEmpty` 的读取**【实证·产物】`EditTextPreference.smali:698-758`：styleable `ׅ/qt0->i` **只有一个元素** `0x7f01074b` = `summaryWhenEmpty`【实证·产物】`qt0.smali:867-880` + `public.xml:1870`。

```asm
717: getString(0)                    ; ★ 索引 0
725: iput → P:Ljava/lang/String;     ; P = 空值文案
734: getDialogLayoutResource()
742: if (== 0) setDialogLayoutResource(0x7f0400d7)   ; 默认对话框布局
```

> **本页两个 EditText 都没声明 `w:summaryWhenEmpty`** → `P` 为 null → 空值时 summary 兜底为 `""`（`:776`）。

**`w:summary2="%s"` 的回显机制**在父类链完成，`EditTextPreference.В()`（`:760-865`）只负责**生成原始值字符串**：

```asm
764: v0 = H (当前值)
768: if (v0 == null) v0 = ""
789: if (length == 0 && P != null) return P   ; ★ 空值 → summaryWhenEmpty
813: if (length > 0x80) {                     ; ★ 128 字符截断
833:   v0 = v0.substring(0, 0x80)
846:   v0 += "..."
863: return v0
```

该字符串作为 `%s` 实参送进父类格式化（与 `SeekbarPreference.В()` 同一套 `AUtils.C`）。`AUtils.C`（`AUtils.smali:238-296`）用**共享 `Formatter`** `ׅ/ew->В` 做 `format` 后 `setLength(0)` 复用——**避免每次分配 StringBuilder**。

> **截断阈值 `0x80` = 128 字符是硬编码**。典型 Chrome UA 约 120–150 字符，`user_agent` **会被截断**。但这是 UI 层截断，**不影响存储值**。

### 5.3 输入校验：**没有**

`EditTextPreference` 全文**无任何正则/长度/格式校验**：

| 可能的校验点 | 实际情况 | 证据 |
| --- | --- | --- |
| `onDialogClosed` 前验证 | 直接 `callChangeListener(getText())`，返回 true 就 `setText` | `:300-356` |
| `setPositiveButtonEnabled` 控制 | **`sa1` 从未调用** | `sa1.smali` 无该符号 |
| `inputType` / `maxLength` | 未设置，用默认布局 `0x7f0400d7` | `:742-751` |

> **后果**：`shutdown_intent` 填错只是永不触发（Intent 匹配不上）；`user_agent` 填错会被流媒体服务端拒绝（403/400），用户看到"播放失败"却不知道是 UA 问题。**非崩溃级，但排障成本高**。

### 5.4 `shutdown_intent` 的语义

摘要原文：**Listen to this shutdown intent and pauses itself/stores state when the intent is received**【实证·原文】`strings.xml:1628`。

| 项 | 值 |
| --- | --- |
| 类型 | **`String`**（`vr->G1`）【实证·产物】`vr.smali:2772` |
| 默认 | `""`（XML 显式空串） |
| 存储 | `ms.d(String, String)` → `ub1`【实证·产物】`vr.smali:2772-2788` |

> **⚠️ 关键区分**：`shutdown_intent` **不是"发广播"，而是"监听广播"**。
>
> 摘要里 "**Listen to** this shutdown intent" 说得很清楚：用户填入一个 **action 字符串**，Poweramp 注册一个 `BroadcastReceiver` 监听它；**收到时暂停播放并保存状态**（模拟"系统关机前优雅退出"）。
>
> 典型用法：车载/定制 ROM 会在关机前发一个自定义 action，用户把这个 action 填进来，Poweramp 就会在系统被杀之前正确落盘。
>
> **我在 smali 里没有找到这个 receiver 的注册点**（`vr->G1` 只在 `vr.smali:2772` 定义，全 smali 无其他引用）——见 §12 未解问题 Q1。

### 5.5 `user_agent` 的消费方

| 项 | 值 |
| --- | --- |
| 类型 | **`String`**（`vr->b`）【实证·产物】`vr.smali:681` |
| 默认 | `null`（`ms.d(key, null)`） |
| 消费方 | **`FfmpegPluginService.В(lp0)`**【实证·产物】`FfmpegPluginService.smali:1754-1779` |

```asm
1754: sget-object v1, Lׅ/vr;->b:Lׅ/ub1;      ; user_agent
1758: iget-object v1, v1, Lׅ/nf1;->А:Ljava/lang/String;
1762: invoke-static {v1}, TUtils;->isEmpty(CharSequence)Z
1770: if (v2 != 0) → :cond_0                ; 空则不用（走默认）
1774: getBytes(StandardCharsets.UTF_8)
```

> **只在 FFmpeg 解码器路径生效**：`user_agent` 被塞进 `lp0.В(...)` 的同一批参数里（`:1749` 的 `В(IIIIIII)Z`），随后变成 HTTP 头。
>
> **注意默认值是 `null` 而非空串**——`TUtils.isEmpty` 对 null 返回 true，所以默认行为是"用播放器内置 UA"。
>
> **`CcPluginService.smali:908` 也读 `"user_agent"`**，但那是**从 `JSONObject.optString("user_agent", ...)` 读**（Cast/Chromecast 插件配置），**不是** SharedPreferences 的 `vr->b`。同名不同源——**两个独立的 UA 配置**（本页控制的是 FFmpeg 流媒体那个）。

---

## 6. Experiment 徽标专节

### 6.1 本页 5 个徽标

| # | key | 有无 `android:summary` |
| ---: | --- | --- |
| 17 | `pause_on_screen_off` | **无**（XML 完全没写 summary） |
| 18 | `op_framerate` | 有 |
| 24 | `load_user_so` | 有 |
| 28 | `_long_volume_shizuku_grant` | 无（运行时生成） |
| 29 | `long_volume_controls` | 无（运行时生成） |

> **5 个是全 App 最多的一页**（对比：`aa.xml` 只有 2 个）。本页的 Tweaks 分类本身就是"实验区"。

### 6.2 完整写法

【实证·原文】`misc.xml:22`（以 `pause_on_screen_off` 为例）：

```xml
<com.maxmpz.audioplayer.preference.MultilineSwitchPreference
    android:title="@string/pref_pause_on_screen_off"
    android:key="pause_on_screen_off"
    android:defaultValue="false"
    w:sup="@string/pref_experiment"
    w:supLink="alert?text=@string/pref_experimental_msg" />
```

| 资源 | 文案 |
| --- | --- |
| `pref_experiment` | **Experiment** |
| `pref_experimental_msg` | **This is an experimental feature - it may be changed/removed in the future builds and/or may not work on some Android variants/devices** |

### 6.3 渲染机制（**不是 HTML**）

**关键发现**：`w:sup`/`w:supLink` 的渲染**不走 `Html.fromHtml`**，而是**直接构造 `SpannableStringBuilder` + Span**。证据：

`qt0->b0` = styleable【实证·产物】`qt0.smali:1549-1554`，`array_22`：

```
{0x1010036, 0x7f010519(summary2), 0x7f01058a(allowLinks), 0x7f010630(sup),
 0x7f010631(supLink), 0x7f0106f2(smallIcon), 0x7f010748(removeFromSummary),
 0x7f0109fe, 0x7f010a4b, 0x7f010c40, 0x7f010c5c(tag), 0x7f010c5d(tagLink)}
```
【实证·产物】`qt0.smali:4532-4546`

`ׅ/wr0`（`PreferenceHelper`，本页所有 `MultilineSwitch`/`RawText`/`Seekbar`/`Dialog` 偏好共用）读取：【实证·产物】`wr0.smali:134-230`

| 索引 | attr | 目标字段 | 行 |
| ---: | --- | --- | --- |
| 1 | `summary2` | `P:CharSequence` | `:145-149` |
| 3 | **`sup`** | **`K:String`** | `:154-158` |
| 4 | **`supLink`** | **`Н:String`** | `:163-167` |
| 10 | `tag` | `H:String` | `:172-176` |
| 11 | `tagLink` | `Р:String` | `:181-185` |

**渲染点① `tag`/`tagLink`**【实证·产物】`wr0.smali:2424-2506`：

```asm
2424: const v3, 0x3f4ccccd      ; 0.8f ← RelativeSizeSpan 比例
2454: AUtils.B(builder, tag, RelativeSizeSpan(0.8f))
2476: builder.setSpan(SuperscriptSpan, 起, 止, 0)
2489: new HtmlCompat$DefensiveURLSpan(tagLink)
2506: builder.setSpan(urlSpan, 起, 止, 0)
```

**渲染点② `sup`/`supLink`**【实证·产物】`wr0.smali:2518-2604`（**§6.2 用的就是这一套**）：

```asm
2518: v4 = this.K (:L)              ; ★ sup 文字
2522: if (v4 != null) {
2526:   起 = builder.length()
2534:   v5 = this.K
2542:   new RelativeSizeSpan(0.8f)
2547:   AUtils.B(builder, v5, span)   ; ★ 追加 "Experiment"，缩到 0.8 倍
2552:   new SuperscriptSpan()
2561:   止 = builder.length()
2569:   builder.setSpan(SuperscriptSpan, 起, 止, 0)      ; ★ 上标
2574:   v3 = this.Н (:L)              ; ★ supLink
2578:   if (v3 != null) {
2582:     new HtmlCompat$DefensiveURLSpan(v3)            ; ★ 包成可点击
2599:     builder.setSpan(urlSpan, 起, 止, 0)            ; ★ 与上标同区间
2605:   builder.append(分隔符)
```

> **✅ 修正我最初的 Q2 判断**：`sup`（`K`）**不是"未见读取"**——`:2518/2534` 明确读取，`:2547` 渲染。我早先只 grep 了 `:65/88/105`（那是 `removeFromSummary` 的 `o` 字段），漏看了 `:25xx` 这一段。
>
> **两组角标现已完全清楚**：
>
> | | `tag`/`tagLink`（`H`/`Р`） | `sup`/`supLink`（`K`/`Н`） |
> | --- | --- | --- |
> | 渲染行 | `:2424-2506` | `:2518-2604` |
> | 手法 | `RelativeSizeSpan(0.8f)` + `SuperscriptSpan` + `DefensiveURLSpan` | **完全相同** |
> | 触发条件 | 受 `allowLinks`（索引 2）控制 | 不受（推断：无 `allowLinks` 检查） |
> | 本页使用 | ❌ 未用 | ✅ **5 处**（§6.1） |
>
> Poweramp 提供了**两套等价能力**：`sup` 是"简单版"（无 `allowLinks` 开关），`tag` 是"完整版"。本页统一用 `sup`。

**`w:removeFromSummary` 的语义**（`o` 字段，索引 7）【实证·产物】`wr0.smali:65-111`：

```asm
65:  p1 = this.o                       ; o = 要从 summary 剔除的串
69:  if (p1.length() == 0) → :goto_0
90:  p2 = StringsKt.d(summary.toString(), this.o, "")   ; ★ 从 summary 删掉 o
107: p1 = StringsKt.d(summary2.toString(), this.o, "")  ; ★ 也从 summary2 删掉 o
```

> **用途**：避免 `w:summary` 与 `w:summary2` 里出现**重复文字**——把重复片段放进 `removeFromSummary`，渲染前统一从两处剔除。

### 6.4 `alert?text=...` 深链的点击行为

`w:supLink` 存进 `Н:String`，在 `:2582` 被包成 **`HtmlCompat$DefensiveURLSpan`**（`URLSpan` 子类）。

根文档 §4.1 确认 `RawTextPreference.setTarget` 的三态分发（`http` / 内部深链 / 无）。但 `alert?` **不在三态里**——它是 **URLSpan 的 onClick**，**不经过 `w:target`**。

> **推断**：`alert?text=<资源名>` 是 Poweramp 自定义**伪 URL scheme**，`DefensiveURLSpan` 拦截后解析 `text=`、把 `@string/...` 解析成字符串、弹 `PseudoAlertDialog`。与 `poweramp-album-art-settings.md` §2.2.1 的写法**完全一致**，是**跨页统一约定**。
>
> **为什么叫 "Defensive"**（推断）：自定义 scheme 会抛 `ActivityNotFoundException`；这个子类拦截未知 scheme 做降级，避免第三方 ROM 上崩溃。

---

## 7. `_long_volume_shizuku_grant` 与 Shizuku 授权链

### 7.1 为什么需要 Shizuku

`long_volume_controls`（长按音量键切歌）依赖一个**系统级隐藏权限**：

```
android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER
```

这个权限**不是普通应用能声明的**——它要求 `signature|privileged` 级别。普通 App 只能通过以下方式获得：

| 方式 | 需要 | 用户门槛 |
| --- | --- | --- |
| ADB | 电脑 + USB 调试 | 高 |
| `adb shell pm grant ...` | 同上 | 高 |
| **Shizuku** | 装 Shizuku app 并激活 | **中**（本页选择） |
| Root | 本机 root | 高 |

> **本页同时提供了两条路**：Shizuku（按钮）和手动 ADB（提示行里给命令 + 点击复制）。见 §7.4。

### 7.2 提示行 `volume_keys_long_press_hint` 的完整文案

**XML 里这个 RawText 没有 `android:summary`**——文案**在运行时拼出来**【实证·产物】`sa1.smali:789-889`：

```asm
789: v2 = K.findPreference("volume_keys_long_press_hint")
818: v6 = 0x7f080767                 ; ★ pref_volume_keys_long_press_hint
823: v6 = getString(v6)
836: v4.append("<br><br><tt><small>adb shell pm grant ")
845: v6 = getPackageName()            ; ★ 运行时包名
858: v4.append(" android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER</small></tt>")
881: v4 = dn0.p(ctx, v4, 0, null, null)   ; ★ HTML → SpannableStringBuilder
889: v2.setSummary(v4)                     ; ★ 写入 summary
```

拼接结果（`pref_volume_keys_long_press_hint` 原文 + 动态命令）：

> **Switch tracks by responding to the Volume keys long press (but not in the Poweramp UI). This option uses a semi-official Android 8+ API, which can be activated via Shizuku, ADB, or shell command (click here to copy single-line command):**
>
> `adb shell pm grant com.maxmpz.audioplayer android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER`

> **两个细节**：
> 1. "**but not in the Poweramp UI**" —— 只在 App 不在前台时生效（否则与 UI 内音量控制冲突）。
> 2. "**click here to copy**" 的 "here" 可点击——`oa1.smali:218-345` 把命令写进剪贴板并 `Toast` `copied_to_clipboard`（`0x7f080175`）。

**复制实现**【实证·产物】`oa1.smali:223-309`：`ClipData.newPlainText("adb/console command", "pm grant " + packageName + " android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER")`。

> **注意两处命令不同**：提示行显示 **`adb shell pm grant <pkg> <perm>`**（带 `adb shell` 前缀），复制的是 **`pm grant <pkg> <perm>`**（无前缀）。
>
> 复制的版本适合**已在 adb shell 内**的场合（Shizuku 的 `rish`、或已 `adb shell` 进入）——这是**有意区分**，不是笔误。

### 7.3 `ProgressPreference` 的实现

`ProgressPreference` 只有 198 字节【实证·产物】，**继承 `RawTextPreference`**（不是 `Preference`）：

| 成员 | 类型 | 作用 |
| --- | --- | --- |
| `h` | `boolean` | **进度状态**（true = 正在授权） |
| `setProgress(Z)` | 方法 | 有变更检测时 `notifyChanged()`（`:175-198`） |
| `onBindView` | 方法 | 找 `0x7f0d026f` 的 `ProgressBar`，按 `h` 设 `VISIBLE(0)` / `GONE(8)`，再 `super.onBindView`（`:116-173`） |

> **`setProgress` 带变更检测**（`:183` `if (old != new)`）——避免无谓 `notifyChanged()`。**这是本页唯一带此优化的控件。**

**`sa1` 如何驱动它**【实证·产物】`sa1.smali:438-467`：

```asm
438: if (this.k == null) → :cond_3    ; k = x80 (ShizukuGrant)
442:   if (this.k.К:Z == 0) → :cond_3  ; ★ К = "正在授权"
456:     if (this.k.К:Z == 0) → :cond_3
462:   :cond_3  v4 = 0                  ; false
467: v1.setProgress(v4)                ; → ProgressPreference
```

> `x80.К` 为 true → 进度条可见。`К` 在 `x80.X()`（`:1182-1299`）被置 true 并发线程；`x80.В()`（`:1448-1483`）复位 false。
>
> **`:442` 与 `:456` 连判两次同一字段** 是 Kotlin 嵌套 `if` 的反编译产物，非逻辑冗余。

### 7.4 Shizuku 授权链（`ׅ/x80` = `ShizukuGrant`）

`x80` **1785 行**，本页第二大的协同类。9 个方法：

| 方法 | 行 | 作用 |
| --- | --- | --- |
| `<init>` | `:41-116` | 存 5 参数 + 建 2 个 `fc1` Runnable + 1 个 `gc1` 监听器 |
| `B(Context, hk1, int, ArrayList)` | `:118-` | **静态**：构造并执行 `pm grant` |
| `А(Context)` | `:1033-1080` | **静态**：`checkPermission` 判权限 |
| `A()` | `:1084-1176` | 取消回调、销毁 `hk1` |
| `X()` | `:1178-1299` | **发起授权**（起 `Thread`） |
| `x(boolean)` | `:1301-1392` | 弹 Shizuku 请求框 |
| `В()` | `:1394-1489` | **取消授权**（复位状态） |
| `Х(boolean)` | `:1491-1660` | **UI 状态机**（焦点监听 + 5000ms 超时） |
| `х()` | `:1662-1785` | 启用 `ShizukuProvider` 组件 |

**三个关键技术点**：

| 机制 | 实现 | 位置 |
| --- | --- | --- |
| **授权命令** | `/system/bin/cmd package grant --user <uid> <pkg> android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER` | `:138-162` |
| **Shizuku binder 检查** | 查 `ׅ/ec1->В`；null → 返回 `"no Shizuku binder"`；否则 `queryLocalInterface("moe.shizuku.server.IShizukuService")` | `:235-262` |
| **超时 + 焦点监听** | `postDelayed(fc1, 0x1388 = 5000ms)` + `addOnWindowFocusChangeListener(gc1)` | `:1544-1585` |

> **为什么是 `cmd` 不是 `pm`**：`cmd package` 是 `pm` 的底层实现，经 Shizuku binder 以 shell 身份调用更稳。
>
> **`moe.shizuku.server.IShizukuService`** 是 Shizuku 的 AIDL 接口名（`moe.shizuku` 是其包名前缀）。
>
> **为什么需要 5000ms 超时 + 焦点监听**：授权必须**切到 Shizuku app 再切回来**——用户不切回就 5 秒后放弃，切回时靠焦点回调立即刷新。这是**跨 App 手势流程**的典型处理。

**失败弹框**【实证·产物】`ra1.smali:29-141`：标题 `pref_volume_keys_long_press`（`0x7f080766`）+ 正文 `shizuku_grant_failed`（`0x7f080822`，带 `%1$s` 失败原因）+ 负按钮 `close`（`0x7f080205`）。

`shizuku_grant_failed` 原文【实证·原文】`strings.xml:1889-1892`：

> **Couldn't grant the permission via Shizuku:**
> `%1$s`
>
> **On Xiaomi phones, also enable "USB debugging (Security settings)" in Developer options. Or use the ADB command above**

> **MIUI 特判写在文案里而非代码分支里**——作者用一句话覆盖小米机型的特殊路径，省掉一个 `Build.MANUFACTURER` 判断。

### 7.5 `sa1.L()` —— 授权状态的 4 态渲染

`sa1.L()`（`:250-487`，238 行）是本页**最复杂的单段逻辑**，处理 `long_volume_controls` 与 `_long_volume_shizuku_grant` 的**联动状态**。

**入口守卫**：`SDK_INT < 0x1a (26 = Android 8.0)` **直接 return**（`:262`）。

> **Android 8.0 是硬门槛**——`SET_VOLUME_KEY_LONG_PRESS_LISTENER` 是 8.0 引入的 API。低于 8.0 时 `L()` 整个不执行；但分类本身已在 `v()` 里被 `removePreference`（§7.6），所以用户看不到空壳。

**四态表**：

| 权限状态 | `long_volume_controls` | `_long_volume_shizuku_grant` | 图标 | 行 |
| --- | --- | --- | --- | --- |
| **已授权**（`checkPermission == 0`） | summary=`permission_granted`、**enabled** | summary=`permission_granted` + 图标 | ✓ `settings_check_48dp` | `:336-366` |
| **未授权**，非 granting | summary=`no_permission`、**`setChecked(false)`**、**disabled** | summary=`pref_summary_long_volume_grant_via_shizuku` | 清空 | `:370-432` |
| **未授权**，granting 中 | 同上（仍 disabled） | summary=**`pref_grant_via_shizuku_granting`** | — | `:409` |
| **未授权**，Shizuku 未运行 | 同上 | 兜底走 `0x7f0806a5` | — | `:418` |

**四态只靠 4 个 setter 切换**【实证·产物】`sa1.smali:332-436`：

| 分支 | 调用序列 |
| --- | --- |
| 已授权 | `setSummary(0x7f080436)` → `setEnabled(true)` → `Progress.setSummary(同)` → `setIcon(0x7f020344)` |
| 未授权 | `setSummary(0x7f0803bf)` → `Switch.setChecked(false)` → `setEnabled(false)` → `Progress.setSummary(0x7f080512 或 0x7f0806a5)` → `setIcon(null)` |

> **注意：不重建 Preference 对象**，只改属性。这是 Android `Preference` 动态更新的标准做法——`notifyChanged()` 由各 setter 内部触发。
>
> **`:438/456` 两次判同一个 `x80->К:Z`** 是反编译产物（Kotlin 嵌套 `if` 展开），非逻辑冗余。

**`L()` 末尾的绑定**（`:472-481`）：`new ma1(this, 0)` → `long_volume_controls.setOnPreferenceChangeListener`。

**`ma1` 的 index 0 → `na1(1)`**（`ma1.smali:128-147`）：`handler.post(na1)`。

**`na1.run()` 的 index 0 分支**——开关打开时的**连锁动作**【实证·产物】`na1.smali:91-203`：

```asm
92:  v0 = this.k (x80)
100:   v0.В()                            ; ① ★ 取消 Shizuku 授权态
110: const/16 v2, 0x17                   ; ② 23 = Android 6.0
117: if (v0 < 23) → :cond_1
121: sget-boolean v0, Lׅ/xn0;->В:Z        ; ③ 全局标志
129:   vr->b1 (use_wakelock).у(true)      ; ★ 强制开 wakelock
138:   this.y()                           ; 提交偏好
145:   new File(getFilesDir(), ".load_ffmpeg_so_pref")
170:   file.delete()                      ; ④ ★ 删除 so 加载标记
198: this.j(true)                         ; ⑤ ★ 提交 + 重启 Activity
```

> **四步连锁**：关授权态 → （Android 6+ 且全局标志允许）强制开 `use_wakelock` → 删 `.load_ffmpeg_so_pref` → `j(true)` 提交并重启。
>
> **为什么开 wakelock**：长按音量键要在**息屏时**工作。
>
> **⚠️ 隐式跨项耦合**：第 ④ 步会**重置 `load_user_so` 的自定义库加载标记**——两项在 UI 上相距 4 行，功能上却耦合。这是"杂项页"的典型问题，SpMusic 借鉴时应避免（见 §11.5）。

### 7.6 与 `headset` 页锚点的联动

根文档 §3.2 记录了跨页锚点 **`misc#long_volume_controls`**（来自 `headset.xml`）。三处联动：

**① Android < 8 时整分类移除**【实证·产物】`sa1.smali:743-784`：

```asm
747: const/16 v2, 0x1a                 ; 26
751: if (v0 < 26) → :cond_0
753:   v2 = K.findPreference("volume_keys_long_press_cat")
775:     K.removePreference(v2)          ; ★ 整个分类消失
```

> 因此 §3.1 的"有 key 无 title"异常在 Android 8 以下**不影响观感**（分类不存在）。

**② 深链滚动**：`open_path` → `split("/")[1]` → `K.findPreference(key)` → `postDelayed(滚动, 350ms)`（运行时文档 §7.1）。

> **`long_volume_controls` 就是那个 `key`**。`headset.xml` 里的 `href=settings/misc#long_volume_controls` 会**跳到本页并滚动到该行**。
>
> **时序保证**：`L()` 的四态渲染在 `v()` 内完成（`:1036`），而滚动在 `v()` 之后（运行时文档 §4.5）——**用户看到的一定是已渲染好的状态**。

**③ `ad.smali` 授权成功回调**【实证·产物】`ad.smali:195-235`：

```asm
199: this.sa1.L()                       ; ★ 刷新四态
212: v3 = K.findPreference("long_volume_controls")
224: setChecked(v1)                      ; ★ 手动勾上
233: new na1(this, ...)                  ; 后续动作
```

> **为什么要手动 `setChecked`**：`L()` 的"已授权"分支**只 `setEnabled(true)` 而不 `setChecked`**（`:346`）——授权成功后需要**额外一步**把开关打开。

---

## 8. `scrobbling` 分类

### 8.1 两条路径

| key | 标题 | 摘要 | 目标 app |
| --- | --- | --- | --- |
| `scrobble_to_last_fm` | Scrobble via Official Last.fm app | **Scrobble via Last.fm app** | 官方 Last.fm app |
| `scrobble_to_simple_last_fm` | Scrobble via Simple Scrobbler | **Scrobble to Last.fm/Libre.fm via Simple Scrobbler (previously Simple Last.fm)** | Simple Scrobbler（第三方，支持 Last.fm + Libre.fm） |

**两个关键差异**：

| 维度 | Last.fm 官方 | Simple Scrobbler |
| --- | --- | --- |
| 服务端 | 仅 Last.fm | **Last.fm + Libre.fm**（自建/开源，支持 Libre.fm 等兼容站） |
| app 归属 | **官方**（Last.fm 公司） | **第三方**（开源生态） |
| 摘要长度 | 短（21 字符） | **长**（94 字符，含历史名标注） |
| 默认 | `false` | `false` |

> **"previously Simple Last.fm"** 这句是**历史重命名说明**——这个 app 原名 "Simple Last.fm"，后改名 "Simple Scrobbler"（为支持 Libre.fm 等非 Last.fm 服务）。Poweramp 保留旧名标注，因为**老用户记得旧名**。
>
> **两者的实现机制相同**（都是发 Scrobbler 广播），差别只在**目标包名**。见 §12 Q3（未完全确认包名）。

### 8.2 提示块 `pref_scrobble_hint` 全文

【实证·原文】`strings.xml:1392`：

> **Most scrobbler apps should work without extra configuration**

**XML 声明**【实证·原文】`misc.xml:7`：

```xml
<com.maxmpz.audioplayer.preference.RawTextPreference
    android:background="@drawable/settings_quote_background"
    w:line1="@string/pref_scrobble_hint"
    w:skipSearch="false"
    w:keepPaddings="true" />
```

| 属性 | 值 | 含义 |
| --- | --- | --- |
| `android:background` | `settings_quote_background` | 引用块样式（与 `aa_bg.xml` 的 4 个提示块同一 drawable） |
| `w:line1` | `pref_scrobble_hint` | 单行提示正文 |
| **`w:skipSearch`** | **`"false"`** | **显式声明"要进搜索索引"** |
| `w:keepPaddings` | `true` | 保留内边距 |

### 8.3 `w:skipSearch="false"` 的显式写法——为什么

本页有 **3 处**：`pref_scrobble_hint`（#4）、`migrate_data_29`（#19）、`_long_volume_shizuku_grant`（#28）。

三者的共性【实证·原文】：

| 元素 | 类型 | `persistent` | 有 `android:title` | 性质 |
| --- | --- | --- | --- | --- |
| `pref_scrobble_hint` | RawText | 隐式 false | **无** | 纯提示 |
| `migrate_data_29` | RawText | **显式 false** | 有 | 动作项 |
| `_long_volume_shizuku_grant` | **Progress**（继承 RawText） | 隐式 false | 有 | 进度按钮 |

> **共性：三者都不是"普通持久化设置项"**。

而 `RawTextPreference` 构造器**无条件 `setPersistent(false)`**【实证·产物】`RawTextPreference.smali:174-177`：

```asm
174: const/4 v3, 0x0
177: invoke-virtual {v0, v3}, Preference;->setPersistent(Z)V   ; ★ 无条件
```

**推断**：搜索索引器按"是否 persistent"筛选（`PrefSearchIndexer`，见根文档 §4.3）。若为真，则**所有 RawText 默认被跳过**——所以作者需显式写 `"false"` 把它们**捞回索引**。

> 这也解释了为何 `pref_summary_stream_buffer`（#22）**没有**显式 `skipSearch`——它只是缓冲大小说明，**不需单独出现在搜索结果里**。
>
> **默认值本身未能在 smali 确证**（见 §12 Q4），上面是从行为反推的最合理模型。

### 8.4 实现机制（未解）

**未定位到广播实现**——两个 key 只在 `vr.smali:1369-1397` 定义字段（`vr->e0`/`vr->f0`），**全 smali 无其他消费点**。见 §12 Q3。

---

## 9. `android_auto` 分类

### 9.1 6 项职责

| # | key | 职责 |
| ---: | --- | --- |
| 6 | `buttons` | **跳转**到 `ui_mediaactions`（通知/媒体按钮编辑） |
| 7 | `mb_a_grid` | Android Auto 里分类是否网格显示 |
| 8 | `mb_a_aa_cats` | 分类是否显示封面图 |
| 9 | `mb_a_aa_tracks` | 曲目行是否显示封面 |
| 10 | `send_mediasession_q` | 是否给已连接设备提供 Now Playing 列表 |

> **`mb_a_*` 前缀**：`mb` = **MediaBrowser**，`a` = **Auto**。所以 `mb_a_grid` = "MediaBrowser(Auto) 网格"。这是**命名空间前缀**，不是缩写拼写错误。

### 9.2 `buttons` 跳转与**跨页同名 key 冲突**

**这是本页最重要的架构问题**。

`misc.xml:10` 与 `lockscreen.xml:9` 的 `buttons` 项**逐属性完全相同**：

```xml
<!-- misc.xml:10 (android_auto 分类) -->
<com.maxmpz.audioplayer.preference.RedirectPreference
    android:title="@string/buttons" android:key="buttons"
    android:summary="@string/notify_action_buttons" w:target="ui_mediaactions" />

<!-- lockscreen.xml:9 (ics_ls_cat 分类) -->
<com.maxmpz.audioplayer.preference.RedirectPreference
    android:title="@string/buttons" android:key="buttons"
    android:summary="@string/notify_action_buttons" w:target="ui_mediaactions" />
```

**它们都跳 `ui_mediaactions`**（该页 helper 是 `y61`，运行时文档 §3.3）。

#### 冲突还是有意共享？

**关键证据：`RedirectPreference` 不存储任何值。**

```asm
; RedirectPreference 全部成员只有两个方法
:95  setDependencyRaw(String)  → iput h:String      ; 依赖，非值
:106 В()                       → super.В() + setDependency(h)
```

【实证·产物】`RedirectPreference.smali:95-130`

而且它继承的 `RawTextPreference` 构造器**无条件 `setPersistent(false)`**（`RawTextPreference.smali:177`）。

> **结论：这是「有意共享」，不是冲突。**
>
> 理由链：
> 1. `RedirectPreference` **不写入任何 SharedPreferences 键值**（`setPersistent(false)` + 无 `persistXxx` 调用）
> 2. 因此 `"global"` 命名空间里**根本不存在 `buttons` 这个值**
> 3. 两个页面上的 `buttons` 是**两个独立的 UI 元素**，共享一个**只用于 `findPreference` 定位的 key**
> 4. **实际风险**：只有当某段代码写 `findPreference("buttons")` 并期望"唯一"时才出问题。`sa1.v()` **完全不 `findPreference("buttons")`**（`sa1` 里无 `"buttons"` 字符串）
>
> **但这个设计仍是不好的**：它依赖"该 key 永不被持久化"这一**隐式契约**。若将来有人把 `buttons` 改成 `SwitchPreference`，两页会立刻互相覆盖。
>
> **对 SpMusic 的启示见 §11.3。**

### 9.3 `mb_a_*` 三项的默认值语义

| key | 默认 | 含义 |
| --- | --- | --- |
| `mb_a_grid` | **无 `defaultValue`** | 代码默认 false → Android Auto 里**分类用列表**（保守） |
| `mb_a_aa_cats` | **`true`** | 图片**默认开**（体验优先） |
| `mb_a_aa_tracks` | **`true`** | 曲目封面**默认开** |

> **为什么 `mb_a_grid` 没有 `defaultValue`？** 推断：该项是**后加的**（Android Auto 的网格视图支持较晚），作者忘了在 XML 里补 `defaultValue`——但代码侧 `vr` 里也没有对应字段，说明**走 Android Preference 的 XML 默认（false）**。
>
> **两个 `true` 是一致的"体验优先"**：Android Auto 上显示封面能显著提升可用性（车载屏无键盘搜索，靠封面辨识），所以默认开。而**网格布局是"可选的美化"**，默认关。

### 9.4 `send_mediasession_q`

摘要原文【实证-原文】`strings.xml:1620`：

> Enable Now Playing List/Queue for the connected devices (e.g. Wear) and apps (Android Auto). **Poweramp activates this option if some device/app requests Now Playing list**

> **最后一句话很关键**：这个开关**会被自动打开**——若有设备请求 Now Playing 列表，Poweramp **自己把开关置 true**。
>
> 实现见 `pa1.smali` 的 `pswitch_1`（index 1）分支——**当值变化时发 MsgBus `0x7f0d0311`，并在为 true 时额外 `post` `0x7f0d015b`**。
>
> 字段：`vr->n1`（`pb1`，默认 false）【实证·产物】`vr.smali:2391`。

---

## 10. helper `sa1` 的运行时动作逐条

### 10.1 结构总览

| 方法 | 行范围 | 行数 | 职责 |
| --- | --- | ---: | --- |
| `<init>` | `:17-65` | 49 | 建 2 个 listener + 调 `n91.<init>` |
| `I(sa1, DialogInterface)` | `:67-130` | 64 | **静态**：存储权限回调 → `J()` |
| **`J()`** | `:134-248` | **115** | 起线程做存储迁移 |
| **`L()`** | `:250-487` | **238** | **Shizuku 四态渲染 + 绑定**（§7.5） |
| `o()` | `:489-553` | 65 | `onDestroy`：断开 `x80` |
| **`v()`** | `:555-1407` | **853** | **全部装配**（占全文 **57%**） |
| `С()` | `:1409-1445` | 37 | `onStop`：取消 `m` 回调 |
| `с()` | `:1447-1492` | 46 | `onResume`：重启 `m`（延迟 1000ms） |

> **`v()` 853 行 = 1492 行的 57%**——本页几乎所有逻辑都挤在一个方法里，**没有任何子方法拆分**。这是本页**可维护性最差**的地方（见 §11）。

### 10.2 字段

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `j` | `WeakReference` | 指向失败的 `PseudoAlertDialog`（避免泄漏） |
| `k` | **`ׅ/x80`** | **ShizukuGrant 实例**（懒建） |
| `l` | **`ׅ/pa1`** | 预建 listener（index 0） |
| `m` | **`ׅ/r0`** | `Runnable`（index 14），用于 `onResume` 延迟 |

> **`l` 与 `m` 在构造期就建好**（`:31-60`），其余 listener 都在 `v()` 里现场 `new`。

### 10.3 `v()` 逐条（按 XML 顺序 = 代码顺序）

全表按 `v()` 内出现顺序排列。**`findPreference` 的字符串就是 §2 的 key**——这两处是本页唯一的"XML ↔ 代码"对应关系。

| 序 | key / 目标 | 行 | listener | 附加动作 |
| ---: | --- | --- | --- | --- |
| ① | `mb_a_grid` | `:563-579` | **`l`（`pa1(0)`）** | — |
| ② | `mb_a_aa_cats` | `:586-600` | 同 `l` | — |
| ③ | `mb_a_aa_tracks` | `:609-621` | 同 `l` | — |
| ④ | `stream_timeout_ms` | `:638-663` | **`qa1(pa1(1))`** | 额外 `MsgBus.post(0x7f0d00d6)` |
| ⑤ | `stream_buffer_bytes` | `:668-684` | **`pa1(1)`** | — |
| ⑥ | `user_agent` | `:689-705` | 同 `pa1(1)` | — |
| ⑦ | `send_mediasession_q` | `:714-738` | **`pa1(2)`** | — |
| ⑧ | `volume_keys_long_press_cat` | `:743-784` | — | **`SDK<26` 时 `removePreference`** |
| ⑨ | `volume_keys_long_press_hint` | `:789-903` | **`oa1(0)`** | 拼 hint + 写 summary |
| ⑩ | `_long_volume_shizuku_grant` | `:1002-1031` | **`x11(0x10)`** | 点击 → `x80` 授权 |
| ⑪ | *（调 `L()`）* | `:1036` | — | **四态渲染**（§7.5） |
| ⑫ | `send_metachanged` | `:1132-1157` | **`ma1(1)`** | — |
| ⑬ | `shutdown_intent` | `:1166-1187` | **`new c91(this,1)`** | — |
| ⑭ | `op_framerate` | `:1192-1253` | **`n91->g`** | **`SDK<29` 时移除** |
| ⑮ | `migrate_data_29` | `:1255-1297` | **`oa1(1)`** | **`SDK!=29` 时移除** |
| ⑯ | `load_user_so` | `:1299-1311` | — | **无条件 `removePreference`** |
| ⑰ | `use_wakelock` | `:1316-1337` | **`ma1(0)`** | — |
| ⑱ | `override_region` | `:1342-1375` | **`ma1(3)`** | 唯一有 `null` 检查 |
| ⑲ | `restore_defaults` | `:1376-1401` | **`oa1(3)`** | → `n91.m` → `n91.l` |

> **listener 复用极其集中**：19 个绑定只用了 **6 种** listener 实例（`pa1(0/1/2)`、`ma1(0/1/3)`、`oa1(0/1/3)`、`x11(0x10)`、`c91(1)`、`n91->g`）。其中 `pa1` 一个类覆盖 6 个 key。
>
> **`ma1` 的 index 语义**（`ma1.smali:53-158`）：`0` → `na1(1)`（重活）；`1` → `MsgBus.post(0x7f0d0222)`；`2` → `na1(1)`；**`3` → `n91.j(true)`（提交+重启）**。默认分支（≥4）也是 `j(true)`。
>
> **`oa1` 的 index 语义**（`oa1.smali:59-345`）：`0` → **复制命令到剪贴板**；`1` → **`migrate_data_29` 确认框**（`0x7f08056f` 标题 + `0x7f0806b7` 正文 + `0x7f08056e` 正按钮 = "Migrate"）；`2`/`3` → 默认分支 = **恢复默认确认框**。

#### 三个值得单独说明的分支

**⑭ `op_framerate`：`SDK >= 29`** —— "OP" = OnePlus，高刷屏非标准 API 需要 Android 10+。低于 29 时 **`tweaks` 分类内直接移除该项**（`:1236`）。

**⑮ `migrate_data_29`：`SDK == 29`** —— 注意是 **`!=` 而非 `<`**（`:1271`）：

```asm
1271: if (v0 != v5) → :cond_7        ; v5 = 0x1d = 29
1275:   v2.removePreference(v4)       ; ★ Android 11+ 也移除
```

> 摘要原文解释了为什么只此一版需要它：**"Migrate downloaded/selected Album Art if access to cached Album Art is lost due to the Android 10+ file access changes"**——**Android 10 分区存储迁移的一次性工具**，11+ 迁移窗口已过。这是**极窄的版本窗口**，本页独有的设计。

**⑯ `load_user_so`：无条件移除** —— **本页最大的死代码**：

```asm
1299: v0 = findPreference("load_user_so")
1311: v2.removePreference(v0)        ; ★ 没有任何 if 守卫
```

> `load_user_so` 有完整 XML 声明（`#24`）、`MultilineSwitch` 类型、🧪 徽标、摘要（"Try to load custom ffmpeg_neon.so from the path:"）、`defaultValue="false"`、甚至 `persistent="false"`——**然后被无条件删掉，用户永远看不到**。
>
> 这与运行时文档 §3.4 的"动态块自删"**不同**：那里有 `removeAsNeeded` 条件，这里**零条件**。功能被紧急禁用但代码/文案/XMl 全部保留，是**典型的"临时禁用变永久"**。

#### `restore_defaults` 的链路

【实证·产物】`sa1` 只负责绑 `oa1(3)`；真正的确认框与执行在 `n91`：

```asm
; oa1 默认分支 (:64-73)
64: new na1(this, 0)
73: this.m(na1, null, 0)                        ; n91.m(Runnable, Runnable, int)
; n91.m (:2198-2224)
2198: v0 = this.y                               ; ★ 本页资源 id（用于定位作用域）
2202: new b6(this, y, p1)
2210: const v1, 0x7f0805f6                      ; pref_restore_defaults_msg
2224: this.l(0x7f0805f6, b6, p2, p3, true)      ; n91.l() 延迟确认框
; b6 pswitch_4（真正执行，:372-419）
384: if (getSharedPreferences() instanceof v2) {
400:   n91.n(K, v2)                              ; ★ 递归遍历
405:   v3.B.В()                                  ; ★ w2.В() 提交落盘
419: if (p2 != null) p2.run()
```

`pref_restore_defaults_msg` = **"All options on this page will be restored to the default values"**【实证·原文】`strings.xml:1367`。

> 与运行时文档 §5.5 完全一致：**逐页手写绑定**，作用域由传入的 `PreferenceScreen` 决定。

#### `n91.n()` —— 恢复默认的真正实现

【实证·产物】`n91.smali:714-884`：

```asm
730: for (v1 = 0; v1 < group.getPreferenceCount(); v1++) {
742:   if (!v2.isPersistent()) → skip                  ; ★ 跳过 RawText / 动作项
754:   if (v2.getClass() == Preference.class) → skip   ; ★ 跳过裸 Preference
770:   if (PreferenceGroup.isAssignableFrom(...)) → skip ; ★ 跳过分类
802:   if (TUtils.isEmpty(v2.getKey())) → skip
818:   v3 = sharedPrefs.В.get(key)                     ; 按 key 取存储项
834:   if (!(v3 instanceof t9)) → skip
850:   v3.y()                                          ; ★ 删除该项
857:   if (v2 instanceof PreferenceGroup) → 递归
```

> **三重过滤 + 删除语义**：
> 1. 必须 `isPersistent()` → 本页的 3 个 RawText、`migrate_data_29` 自动免于被"恢复"
> 2. 不能是裸 `Preference` → `restore_defaults` 自身不会被删
> 3. 不能是 `PreferenceGroup` → 分类跳过，但**随后递归进入**
>
> **关键：`y()` 是"删除"而非"写回默认值"**。这样下次 `getXxx(default)` 自然返回默认——**默认值只在代码里定义一份，改默认不需要迁移已存储数据**。
>
> **作用域天然是页级**：遍历传进来的 `K`（本页 `PreferenceScreen`），不碰全局。

### 10.4 三个 RawText 的移除路径核实（回答 Lead 的问题）

Lead 问：`pref_summary_stream_buffer`、`migrate_data_29`、`volume_keys_long_press_hint` 各走 `n91.h()` 还是 `n91.i()`？

**答案：三个都不走。**

| 元素 | 实际移除点 | 方法 | 行号 |
| --- | --- | --- | --- |
| `pref_summary_stream_buffer` | **从不移除** | — | — |
| `migrate_data_29` | `v()` 里直接 `removePreference` | **`PreferenceGroup.removePreference`** | `sa1.smali:1275` |
| `volume_keys_long_press_hint` | **从不移除**（仅 `setSummary`） | — | `:889` |

**证据**：`sa1.smali` 全文对 `n91` 的方法调用只有 `H()`、`Н()`、`j()`、`y()`、`m()`、`L()`、`o()`——**没有 `h(` / `i(`**。

```powershell
# 实测：sa1.smali 里所有 removePreference 都是直接调 PreferenceGroup
sa1.smali:779   → volume_keys_long_press_cat（整个分类）
sa1.smali:1236  → op_framerate
sa1.smali:1275  → migrate_data_29
sa1.smali:1311  → load_user_so
```

> **四者全部是 `invoke-virtual {v?, v?}, Landroid/preference/PreferenceGroup;->removePreference(...)`——瞬时移除，无动画。**
>
> **这修正了运行时文档 §5.2 的一个隐含假设**：那里说"只有 `RawTextPreference` 走 `i()`（256ms 淡出）"。但**本页的 `migrate_data_29` 正是 `RawTextPreference`，却走瞬时移除**——因为 `sa1` **主动调了 `removePreference`** 而非 `n91.i()`。
>
> **准确表述应为**：
> - `n91.i(RawTextPreference)` 是**一个可选工具**，走动画
> - **是否使用它完全取决于 helper 作者**——`sa1` 作者选择了不用
> - 因此"RawText 走动画"**不是自动的**，是 `z61` 等 helper 的选择
>
> 见 §11.4（对 SpMusic 的启示：动画移除是**显式调用**而非框架魔法）。

### 10.5 `shizuku_continue` —— 跨 Activity 恢复

【实证·产物】`sa1.smali:1041-1125`：

```asm
1041: v4 = n91.Н()                          ; ★ getArguments()
1049: v5 = this.k.В:SettingsActivity
1053: v6 = v5.getIntent()
1061: const-string v7, "shizuku_continue"
1065: if (v6 != null) → :cond_2
1069:   v6.removeExtra("shizuku_continue")   ; ★ 清 intent extra
1075: :cond_2  v6 = v4.getBoolean("shizuku_continue")   ; ★ 读 arguments
1083: if (v6 == 0) → :goto_0                ; 无则退出
1091: v4.remove("shizuku_continue")         ; ★ 清 arguments（一次性）
1096: v4 = x80.А(v5)                        ; ★ 静态：检查权限
1104: if (v4 != 0) → :cond_4                ; 已有权限 → 结束
1112: v4 = this.k.B (Handler)
1116: v5 = new fc1(this.k, 3)
1125: v4.post(v5)                          ; ★ 继续授权流程
```

> **机制**：Shizuku 授权需要**离开 Poweramp → 去 Shizuku app → 再回来**。回来后 `SettingsActivity` 被重建（或 intent 携带 `shizuku_continue=true`），`sa1` 检查这个标记并**继续未完成的授权**。
>
> **关键细节：`removeExtra` + `Bundle.remove()` 双清**——保证**只执行一次**（幂等）。
>
> 这与 §7.5 的 5 秒超时 + 焦点监听是**同一套流程的两个面**：短时间用焦点监听，被系统回收后用 `shizuku_continue`。

---

## 11. 对 SpMusic 的可借鉴 / 不建议照抄

SpMusic 是 **Tauri + React + Rust** 的桌面本地播放器。本页 4 个分类里，**只有 `tweaks` 的一半有意义**。

### 11.1 分类可移植性总评

| 分类 | 可移植性 | 理由 |
| --- | --- | --- |
| `pref_scrobbling` | **不可移植**（Android 专有） | 依赖 Android `BroadcastReceiver` + 第三方 Scrobbler app 生态。桌面端若要 scrobbling，应**直接实现 Last.fm API**（`track.scrobble` OAuth），不经中间 app |
| `android_auto` | **不可移植** | `MediaBrowserService` / `MediaSession` 是 Android Auto 专有协议。桌面端对应物是 **MPRIS**（Linux）/ **SMTC**（Windows）/ **Now Playing**（macOS） |
| `tweaks` | **部分可移植** | `stream_timeout_ms` / `stream_buffer_bytes` 对应**网络流缓冲策略**，桌面端同样需要；`use_wakelock` 对应**阻止系统休眠**（桌面用 `powerSaveBlocker`） |
| `volume_keys_long_press_cat` | **不可移植** | 依赖 Android 系统级权限 + Shizuku。桌面端全局快捷键用 `tauri-plugin-global-shortcut` 即可，**无需任何提权** |

### 11.2 值得借鉴：`w:scale` 的"整数基本单位 + 显示层换算"

**这是本页唯一值得完整借鉴的机制**。

SpMusic 若要在设置里暴露"流缓冲大小""超时""缓存容量"等参数，会遇到同样的问题：**存储/消费层要精确整数，UI 层要人类可读单位**。

**建议做法**（不需要新属性，用一个 TS 工具函数即可）：

```ts
// src/lib/settings/units.ts
export const BYTES_PER_MB = 1_048_576;

export function toDisplayBytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

export function toStoredBytes(display: number): number {
  return Math.round(display * BYTES_PER_MB);
}
```

**关键点**：
1. **存储层保持原始单位**（毫秒/字节），与 Rust 侧 `u64` 直接对应
2. **UI 层做换算**，不污染存储契约
3. **不要用 float 存储**——Poweramp 的 `w:floatScale` 通路（§4.4）就是反面教材：float 在 SharedPreferences 里跨类型读取极易 `ClassCastException`（见 `SeekbarPreference.smali:1903` 的 `catch ClassCastException`）

**反面案例**：Poweramp 的 `stream_timeout_ms` **同时**用了 `w:scale` 和 `w:entries`/`w:values`，导致 `w:scale` 成为死属性（§4.5）。**不要在一个配置项上叠加两套缩放机制**——选一种。

### 11.3 值得借鉴：Experiment 徽标的分级暴露

`w:sup` + `w:supLink` 的"**角标 + 点击解释**"模式**完全可移植**：

```tsx
// 建议实现（不需要 HTML 注入）
<Tooltip content={t('experimental.msg')}>
  <Badge variant="outline" className="text-[10px]">Experiment</Badge>
</Tooltip>
```

**借鉴要点**：
- 徽标文案短（"Experiment"），**解释在点击/悬停后**——避免每项都塞长摘要
- 所有实验项**共用同一句解释文案**（`pref_experimental_msg`），保证一致性
- 本页 5 个实验项**集中在 Tweaks 分类**，形成清晰的"实验区"

**不要照抄**：Poweramp 用 `SpannableStringBuilder` + `SuperscriptSpan` + `URLSpan` 手工拼（§6.3），这是 Android 专有 API。React 里用 `<Badge>` + `<Tooltip>` 即可。

### 11.4 值得借鉴：`restore_defaults` 的"删除而非写回"语义

`n91.n()`（§10.3 ⑭）的做法是**删除存储项**而非写回默认值：

> 好处：**默认值永远由 `getXxx(default)` 的调用方决定**，改默认值只需改代码一处，不用迁移已存储的旧默认值。

SpMusic 可借鉴：

```ts
// 推荐：删除键，让读取时的默认值生效
async function restoreDefaults(keys: string[]) {
  for (const key of keys) await store.delete(key);
}
```

**对比反面做法**：`for (key of keys) await store.set(key, DEFAULTS[key])` —— 一旦 `DEFAULTS` 改了，老用户的存储里还是旧默认值，**无法享受新默认**。

### 11.5 不建议照抄

| 问题 | Poweramp 做法 | SpMusic 应怎么做 |
| --- | --- | --- |
| **巨型方法** | `v()` 853 行塞下全部装配（§10.1） | 每分类一个 hook / 组件（`useTweaksPrefs()` 等） |
| **跨页同名 key** | `buttons` 在 `misc`/`lockscreen` 重名（§9.2） | 命名空间化：`misc.buttons` / `lockScreen.buttons`，或直接改为**不需要 key**（纯跳转项） |
| **死代码不清理** | `load_user_so` 完整声明后无条件删除（§10.3 ⑩） | 删除功能时**同 PR 删掉 XML/文案/类型定义** |
| **隐式跨项耦合** | 开 `long_volume_controls` 会删 `.load_ffmpeg_so_pref`（§7.5） | 若必须耦合，用**显式的 "dependsOn" 声明**或注释说明 |
| **无输入校验** | 两个 `EditTextPreference` 零校验（§5.3） | 至少做**长度上限 + 非法字符提示**；`user_agent` 建议做**格式提示**（含非法头字符时警告） |
| **128 字符静默截断** | `substring(0, 0x80)` 硬编码（§5.2） | 截断时**显式加省略号**并 `title` 提示全文（Poweramp 加了 `"..."` 但不提示全文） |
| **`skipSearch` 靠"是否 persistent"推断** | 3 处显式 `"false"` 的语义不明确（§8.3） | 搜索可索引性应**显式声明**为独立字段，不从别处推断 |
| **滑杆 `min`/`step` 不整除默认值** | `stream_buffer_bytes`：`(1048576−524288)/10240 = 51.2`，首次拖动把 1 MiB 写成 1046528 字节（§4.6） | 定义滑杆时**断言 `(default - min) % step == 0`**，否则首次交互就静默偏移；`min` 取 0 或 `step` 能整除 `default - min` |
| **XML 属性被静默覆盖** | `stream_timeout_ms` 同时写 `w:scale` 和 `w:entries`，前者被 `:389-413` 无条件重置为哨兵 `-1.0f`（§4.5） | 同一参数**只允许一种缩放机制**；若必须共存，在加载期 `throw` 而非静默覆盖 |

### 11.6 桌面端对应能力映射

| Poweramp 项 | SpMusic 桌面端对应 |
| --- | --- |
| `use_wakelock` | `tauri-plugin-*` 的 `powerSaveBlocker`，或 `invoke('set_prevent_sleep')` |
| `shutdown_intent` | **桌面无对应**（无系统关机广播约定）；可换成"收到 SIGTERM 时保存状态" |
| `pause_on_screen_off` | 无"熄屏"概念，可换成"窗口最小化/失焦时暂停"（需用户可选） |
| `override_region` | 无区域限制需求，**建议不做** |
| `send_metachanged` | 对应 **MPRIS 元数据广播**，桌面端应该总是发（无兼容性问题） |
| `check_for_skin_reload` | 对应**主题文件热重载**，桌面端可用 `notify` 做文件监听，不需要"开发者选项" |

---

## 12. 未解问题

### 12.1 本轮新增未解

| # | 问题 | 已知线索 |
| ---: | --- | --- |
| **Q1** | `shutdown_intent` 的 `BroadcastReceiver` 注册点未找到 | `vr->G1` 仅在 `vr.smali:2772` 定义，全 smali 无其他引用；推断 receiver 在某个 Service 里以字符串常量注册而非引用字段 |
| **Q2** | ~~`w:sup`（`wr0->K`）的读取点未确证~~ | ✅ **已解决**：`wr0.smali:2518/2534` 读取、`:2547` 渲染（见 §6.3）。我最初只查了 `:65/88/105`（那是 `removeFromSummary` 的 `o`），漏看 `:25xx` |
| **Q3** | `scrobble_to_last_fm` / `scrobble_to_simple_last_fm` 的消费方与目标包名 | 两个 `pb1` 字段（`vr->e0`/`vr->f0`）全 smali 无引用；推断在编译进 App 的 scrobbler listener 里，未定位 |
| **Q4** | 单条目 `w:skipSearch` 的**默认值** | 运行时文档 §4.3 指向 `preference/В.smali:461-474` 的 `у->z` 索引 8；我未在该文件 grep 到 `qt0->z` 或该索引的 `getBoolean`。**`"false"` 为何要显式写，只能从行为反推（§8.3）** |
| **Q5** | `vr->R` 是否为 `load_user_so` 的字段 | `sa1.v()` 无条件移除该项（`:1311`），但 `vr.smali` 里仍有未确认用途的字段。若 `vr->R` 就是它，则**字段定义是死代码** |
| **Q6** | `override_region` 为何需要 null 检查 | `sa1.smali:1354` 是本页唯一的 `findPreference == null` 防御；推断该项**运行时按区域增删**，未找到增删点 |
| **Q7** | `sa1` 构造函数的 `p4 = 0x7f160026`（`singlepane`）语义 | 这是 `n91->C` 字段。运行时文档 §10 Q4 也列为未解（"`C` 字段的语义"）。本页是**唯一能确认该值来自资源的样本** |
| **Q8** | `stream_timeout_ms` 的 `w:scale="1000.0"` 是否为**纯死属性** | §4.5 证明它被 `w:entries` 覆盖（`K` 被置 `-1.0f`）。但 `-1.0f` 哨兵**只影响 summary 格式化**，不影响 `Х()` 的位置计算（那里用 `К`/`у`/`y`）。**所以它确实不参与任何计算**——但作者保留它是否为文档意图，无法确证 |
| **Q9** | `0x7f0d00d6`（`qa1` 发的 MsgBus 消息）的订阅方与语义 | 推断为"流超时已变"，未定位订阅点 |
| **Q10** | `op_framerate` 的 `n91->g`（`c91` index 3）具体行为 | `c91` 的 index 3 分支见运行时文档 §5.4 为 `v1.e()`（延迟 1s 执行），但未确认 `e()` 对高刷屏做了什么 |

### 12.2 已解决（本轮）

| 问题 | 结论 | 位置 |
| --- | --- | --- |
| `sa1` 是否为本页 helper | ✅ `u61.smali:1585-1589` 由 `0x7f16001e` 构造 | §1 |
| `sa1` 构造函数里的 `0x7f160026` 是什么 | ✅ 是 `n91` 第 4 参（`C` 字段）= `singlepane`，**不是本页 id** | §1 |
| `w:scale` 的读取点与公式 | ✅ `SeekbarPreference.smali:146` 读入 `K:F`，`:1391-1410` 双向换算 | §4.2-§4.3 |
| `w:scale` 与 `w:entries` 同时存在的优先级 | ✅ **`entries` 赢**，`:389-413` 无条件覆盖 `K/min/max/step` | §4.5 |
| `w:scale` 与 `w:floatScale` 的区别 | ✅ 索引 2 vs 索引 12，`K:F` vs `p:F`，两套通路 | §4.2/§4.4 |
| `f1_mb` 与 `%s` 的区别 | ✅ `%1$.1f MB`（带单位+精度）vs `%s`（裸 `Float.toString`） | §4.6 |
| `buttons` 跨页重名是冲突还是共享 | ✅ **有意共享**（`RedirectPreference` 不持久化任何值） | §9.2 |
| 三个 RawText 的移除路径 | ✅ **都不走 `h()`/`i()`**，`migrate_data_29` 走直接 `removePreference` | §10.4 |
| `_long_volume_shizuku_grant` 的实现 | ✅ `ProgressPreference` 继承 `RawTextPreference`，仅 `h:boolean` + `ProgressBar` 可见性 | §7.3 |
| Shizuku 授权命令 | ✅ `/system/bin/cmd package grant --user <uid> <pkg> <perm>` | §7.4 |
| `migrate_data_29` 的显示条件 | ✅ **仅 `SDK_INT == 29`** | §10.3 ⑨ |
| `op_framerate` 的显示条件 | ✅ **`SDK_INT >= 29`** | §10.3 ⑧ |
| `volume_keys_long_press_cat` 的显示条件 | ✅ **`SDK_INT >= 26`** | §7.6 |
| `load_user_so` 的状态 | ✅ **无条件移除，用户看不到** | §10.3 ⑩ |
| **`w:sup` 的读取与渲染点** | ✅ `K` 在 `:2518/2534` 读、`:2547` 渲染；`Н`（supLink）在 `:2574` 读、`:2582` 包 `DefensiveURLSpan` | §6.3 |
| **`sup` 与 `tag` 的关系** | ✅ **两套等价能力**，渲染手法相同；`tag` 多受 `allowLinks` 控制 | §6.3 |
| `restore_defaults` 的机制 | ✅ `n91.n()` 递归**删除**存储项（不写回默认） | §10.3 ⑭ |

---

## 13. 证据索引

| 主题 | 路径 : 行 |
| --- | --- |
| 页面结构 / 31 元素 | `.rea-analysis/v1035/decoded/res/xml/misc.xml:1-38` |
| 资源 id `0x7f16001e` | `res/values/public.xml:11077` |
| `singlepane` id `0x7f160026` | `res/values/public.xml:11085` |
| 全部文案（26 条 `@string`） | `res/values/strings.xml` 各对应行 |
| `pref_stream_timeout_entries`/`values` | `res/values/arrays.xml:913-934` |
| **分发表：`misc` → `sa1`** | `ׅ/u61.smali:1576-1589` |
| `n91` 构造函数 `y`/`C` 字段赋值 | `ׅ/n91.smali:249,253` |
| **`sa1` 全文** | `ׅ/sa1.smali:1-1492` |
| `sa1.<init>` | `ׅ/sa1.smali:17-65` |
| **`sa1.L()` Shizuku 四态** | `ׅ/sa1.smali:250-487` |
| **`sa1.v()` 全部装配** | `ׅ/sa1.smali:555-1407` |
| hint 文案拼接 | `ׅ/sa1.smali:789-889` |
| `x80` 懒建 + 深链锚点 | `ׅ/sa1.smali:908-994` |
| `shizuku_continue` 处理 | `ׅ/sa1.smali:1041-1125` |
| `op_framerate` SDK 29 判定 | `ׅ/sa1.smali:1228-1244` |
| `migrate_data_29` `== 29` 判定 | `ׅ/sa1.smali:1271-1293` |
| `load_user_so` 无条件移除 | `ׅ/sa1.smali:1299-1311` |
| `restore_defaults` 绑定 | `ׅ/sa1.smali:1376-1401` |
| `sa1.o()` / `С()` / `с()` | `ׅ/sa1.smali:489-553` / `1409-1445` / `1447-1492` |
| **`SeekbarPreference` 全文** | `com/maxmpz/audioplayer/preference/SeekbarPreference.smali:1-3751` |
| `w:scale` → `K:F` | `.../SeekbarPreference.smali:146-150` |
| `w:floatScale` → `p:F` | `.../SeekbarPreference.smali:219-223` |
| **`entries` 覆盖 `scale/min/max/step`** | `.../SeekbarPreference.smali:389-413` |
| 双向换算（绑定） | `.../SeekbarPreference.smali:1391-1422` |
| summary 格式化 `K<0` 哨兵 | `.../SeekbarPreference.smali:3622-3671` |
| `Х(int)` 位置归一化 | `.../SeekbarPreference.smali:3728-3751` |
| `А(int)` 反归一化 | `.../SeekbarPreference.smali:3301-3321` |
| `В(int,String)` 格式化 | `.../SeekbarPreference.smali:3323-3726` |
| `AUtils.C` 共享 Formatter | `com/maxmpz/utils/AUtils.smali:238-296` |
| **`EditTextPreference` 全文** | `com/maxmpz/audioplayer/preference/EditTextPreference.smali:1-865` |
| `w:summaryWhenEmpty` 读取 | `.../EditTextPreference.smali:698-758` |
| `В()` 128 字符截断 | `.../EditTextPreference.smali:760-865` |
| `onDialogClosed` 无校验 | `.../EditTextPreference.smali:300-356` |
| `ProgressPreference` | `com/maxmpz/audioplayer/preference/ProgressPreference.smali:116-198` |
| `RedirectPreference`（无持久化） | `com/maxmpz/audioplayer/preference/RedirectPreference.smali:95-130` |
| `RawTextPreference` 强制 `setPersistent(false)` | `com/maxmpz/audioplayer/preference/RawTextPreference.smali:174-177` |
| `w:sup`/`w:supLink` styleable `b0` | `ׅ/qt0.smali:1549-1554` + `:4532-4546` |
| `w:sup` 渲染（Span） | `ׅ/wr0.smali:2518-2604`（`sup`/`supLink`）+ `:2424-2506`（`tag`/`tagLink`） |
| `w:removeFromSummary` 剔除逻辑 | `ׅ/wr0.smali:65-111` |
| `SeekbarPreference` styleable `y0` | `ׅ/qt0.smali:2015-2028` + `:5166-5185` |
| `EditTextPreference` styleable `i` | `ׅ/qt0.smali:867-880` |
| **`x80` (ShizukuGrant) 全文** | `ׅ/x80.smali:1-1785` |
| `pm grant` 命令 | `ׅ/x80.smali:138-162` |
| Shizuku binder 检查 | `ׅ/x80.smali:235-262` |
| 5000ms 超时 + 焦点监听 | `ׅ/x80.smali:1544-1585` |
| `ShizukuProvider` 启用 | `ׅ/x80.smali:1768-1777` |
| 授权失败弹框 | `ׅ/ra1.smali:29-141` |
| 复制命令到剪贴板 | `ׅ/oa1.smali:218-345` |
| `restore_defaults` `x11(0x17)` | `ׅ/x11.smali:848-875` |
| `n91.m()` → `n91.l()` | `ׅ/n91.smali:2190-2230` |
| **`n91.n()` 递归删除** | `ׅ/n91.smali:714-884` |
| `b6` 恢复默认执行 | `ׅ/b6.smali:355-425` |
| `ma1` 监听器（3 分支） | `ׅ/ma1.smali:38-158` |
| `na1` Runnable（2 分支） | `ׅ/na1.smali:38-209` |
| `pa1` 监听器（3 分支） | `ׅ/pa1.smali:38-203` |
| `qa1` 包装 + 额外 MsgBus | `ׅ/qa1.smali:38-91` |
| `ad` 授权成功回调 | `ׅ/ad.smali:195-235` |
| `stream_timeout_ms` → `Pipeline2.z(9)` | `ׅ/cl0.smali:2181-2201` |
| `stream_timeout_ms`/`buffer` → FFmpeg | `com/maxmpz/audioplayer/decoder/ffmpeg/FfmpegPluginService.smali:1712-1749` |
| `user_agent` → FFmpeg | `.../FfmpegPluginService.smali:1754-1779` |
| `pause_on_screen_off` 消费 | `com/maxmpz/audioplayer/player/PlayerServiceCore.smali:5272-5292` |
| `lockscreen.xml` 的 `buttons` | `res/xml/lockscreen.xml:9` |
| 偏好字段定义（本页 21 个） | `ׅ/vr.smali:626,646,666,1369,1385,1804,2195,2227,2307,2395,2443,2459,2475,2776,3053,3475` |
| `vr->R`（疑为 `load_user_so`） | `ׅ/vr.smali:1193` |
| 运行时共享机制 | `docs/architecture/poweramp-settings-page-runtime.md` §3.3/§4.3/§5.1/§5.2/§5.5/§7 |
| 根页面规模与深链 | `docs/architecture/poweramp-settings-root-structure.md` §3.1/§3.2/§4.1/§4.2 |
| `w:sup` 写法先例 | `docs/architecture/poweramp-album-art-settings.md` §2.2.1 |
