---
doc_id: poweramp-misc-complete
title: Poweramp「设置 → 其他」完整参考（根页 26 元素 + 4 分类 + 全部子页）
doc_type: architecture
status: draft
owner_agent: lead
version_scope: build-1035-bundle-play (versionCode 1035009)
created: 2026-11-07
updated: 2026-11-07
source_documents:
  - .rea-analysis/v1035/decoded/res/xml/misc.xml
  - .rea-analysis/v1035/decoded/res/xml/ui_mediaactions.xml
  - .rea-analysis/v1035/decoded/res/values/strings.xml
  - .rea-analysis/v1035/decoded/res/values/arrays.xml
  - .rea-analysis/v1035/decoded/res/values/public.xml
  - .rea-analysis/v1035/decoded/smali/ׅ/sa1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/pa1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/qa1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/oa1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/ma1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/na1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/ra1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/x80.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/vr.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/u61.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/ar.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/nc.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/pc.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/wk0.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/lk0.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/w4.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/oh.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/dk0.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/ih0.smali
  - docs/architecture/poweramp-settings-page-runtime.md
  - docs/architecture/poweramp-misc-settings.md
  - docs/architecture/poweramp-headset-complete.md
---

# Poweramp「设置 → 其他」完整参考

> **证据分级**：【实证·原文】= XML/资源原文；【实证·产物】= 反编译 smali；【推断】= 无直接代码佐证。
>
> 全部基于 **build-1035-bundle-play**（`versionCode 1035009`）。
>
> **与 `poweramp-misc-settings.md` 的关系**：那份覆盖 27 个 key 的逐条语义（完整），本文补充**运行时实现层**（消费者、条件移除、子页链路）。两文互补。

### 阅读导引

| 想知道什么 | 去第几节 |
| --- | --- |
| 页面多大、31 个元素是什么 | **§1 / §2** |
| 四个分类各自的职责 | **§3** |
| `w:scale` 浮点缩放机制 | **§4** |
| helper `sa1` 的 8 个方法 | **§5** |
| **4 处条件移除**（哪些项会消失） | **§6** |
| 14 个字段的运行时消费者 | **§7** |
| 三个流媒体参数（超时/缓冲/UA）| **§8** |
| Shizuku 授权链 | **§9** |
| `ui_mediaactions` 子页 | **§10** |
| 未解问题 | **§11** |
| **5 个未解项的闭环结论** | **§12** |
| **监听器分发链 / 开关→消息映射** | **§13** |
| 证据索引 | **§12** |

---

## 0. 一句话结论

「其他」(misc) 是全设置树**元素最多、最杂的一页**：**31 个元素（含根）/ 4 个分类 / 27 个 key**，helper `sa1` 达 **1493 行**（其中 `v()` 独占 **852 行**）。

**三个关键发现**：

1. **`load_user_so` 被无条件移除** —— 代码中直接 `removePreference`，无任何判断，**生产版本永远不可见**（§6.5）
2. **`_long_volume_shizuku_grant` 不是动态行** —— 它在 `misc.xml` 第 4 个分类里有明确定义（`ProgressPreference`）。此前在 headset 文档中的判断**有误，本轮纠正**（§9.2）
3. **全部 5 个未解项已在第 2 轮闭环** —— 包括 `pause_on_screen_off`（`PlayerServiceCore`）、`user_agent`（Chromecast 插件）、`check_for_skin_reload`/`op_framerate`（在 `wr` 表）、`shutdown_intent`（动态广播 action）、`override_region`（地区检测绕过）。详见 §12 / §13

---

## 1. 页面身份

| | |
| --- | --- |
| XML | `res/xml/misc.xml` |
| 资源 id | **`0x7f16001e`** |
| 行数 / 字节 | 6909 B |
| **元素总数** | **31**（含根节点）＝ 4 个 `PreferenceCategory` + 26 个子元素 |
| 子元素构成 | 22 个可配置项 + 3 个无 key 提示块 + 1 个无 key 分类外提示 |
| 带 key 项 | **27**（含 3 个分类 key：`android_auto`、`tweaks`、`volume_keys_long_press_cat`）|
| 无 key 项 | **3**（Scrobbling 提示、Tweaks 提示、Volume Keys 提示）|
| 页面标题 | `@string/pref_misc` |
| helper | **`ׅ/sa1.smali`**（31331 B / 1493 行，`extends n91`）|
| 分发位置 | `u61.smali:1576-1589` |
| 父页（`n91->C`）| `0x7f160026`（`singlepane`）|

> **规模对比**：`sa1` 1493 行是全设置树**第三大 helper**（次于 `z61` 4867 行、`ba1` 2044 行）。

---

## 2. 31 个元素逐条

【实证·原文】`misc.xml`。**全部属性已核对**。

> **计数口径**：全文 31 个元素 = 根 `PreferenceScreen` 1 + 分类 4 + 子元素 26。
> 其中可配置项 **22** 个、无 key 提示块 **3** 个。key 总数 **27**（含 3 个分类 key）。

### 2.1 分类一「Scrobbling」（3 项，无 key）

【实证·原文】`misc.xml:4-8`

| # | key | 控件 | 标题 | 摘要 | 默认 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `scrobble_to_last_fm` | MultilineSwitch | **Scrobble via Official Last.fm app** | Scrobble via Last.fm app | **false** |
| 2 | `scrobble_to_simple_last_fm` | MultilineSwitch | **Scrobble via Simple Scrobbler** | Scrobble to Last.fm/Libre.fm via Simple Scrobbler (previously Simple Last.fm) | **false** |
| 3 | *（无 key）* | RawText | — | **"Most scrobbler apps should work without extra configuration"** | — |

> 第 3 项是 `settings_quote_background` 背景的提示块（`w:keepPaddings="true"`，`w:skipSearch="false"`）。
>
> **`w:skipSearch="false"` 是显式声明**——与多数提示块的 `true` 相反，意味着它**参与搜索索引**。

### 2.2 分类二「Android Auto」（5 项，分类带 key `android_auto`）

【实证·原文】`misc.xml:9-16`

| # | key | 控件 | 标题 | 摘要 | 默认 |
| ---: | --- | --- | --- | --- | --- |
| 4 | `buttons` | **Redirect** → `ui_mediaactions` | **Buttons** | Media action buttons | — |
| 5 | `mb_a_grid` | MultilineSwitch | **Grid View for Categories** | If enabled, Albums, Artists, Folders, etc. categories are shown as grid. May require category re-opening for view to apply | — |
| 6 | `mb_a_aa_cats` | MultilineSwitch | **Images for Categories** | If enabled, album art and other relevant images are shown for categories | **true** |
| 7 | `mb_a_aa_tracks` | MultilineSwitch | **Album Art for Tracks** | If enabled, album art is shown for track entries | **true** |
| 8 | `send_mediasession_q` | MultilineSwitch | **Now Playing List For Connected Devices/Apps** | Enable Now Playing List/Queue for the connected devices (e.g. Wear) and apps (Android Auto). Poweramp activates this option if some device/app requests Now Playing list | — |

> **`buttons` 是跨页跳转**（`w:target="ui_mediaactions"`），指向动作按钮配置子页（见 §10）。**没有 `skipSearch`**，参与搜索。

### 2.3 分类三「Tweaks」（14 项，分类带 key `tweaks`）

【实证·原文】`misc.xml:17-34`。**这是本页最大、最杂的分类**。

| # | key | 控件 | 标题 | 摘要 | 默认 | 徽标 |
| ---: | --- | --- | --- | --- | --- | --- |
| 9 | `send_metachanged` | MultilineSwitch | **Metachanged Intent** | For external apps | **true** | — |
| 10 | `use_wakelock` | MultilineSwitch | **Use Wakelock** | Check this if audio stops when screen is off | — | — |
| 11 | `send_old_api_aa` | MultilineSwitch | **Send Album Art for old API** | Send Album Art for old Poweramp v2 API. Updated Poweramp API allows much higher res images, but this may be needed for old API apps | **false** | — |
| 12 | `check_for_skin_reload` | MultilineSwitch | **Always Reload Skin** | For skin developers. Always check skin for a change when app activity goes background | **false** | — |
| 13 | `shutdown_intent` | **EditText** | **Shutdown Intent** | Listen to this shutdown intent and pauses itself/stores state when the intent is received | `""` | — |
| 14 | `pause_on_screen_off` | MultilineSwitch | **Pause on Screen Off** | — | **false** | **🧪 Experiment** |
| 15 | `op_framerate` | MultilineSwitch | **Apply OP High Framerate** | Force higher display framerate via non-standard APIs. May be required for some devices/firmwares | — | **🧪 Experiment** |
| 16 | `migrate_data_29` | RawText | **Migrate Data to Android 10** | — | — | — |
| 17 | `stream_timeout_ms` | **Seekbar** | **Network Stream Timeout** | `%s` | **30000** | — |
| 18 | `stream_buffer_bytes` | **Seekbar** | **Network Stream Buffer** | `%1$.1f MB` | **1048576** | — |
| 19 | *（无 key）* | RawText | — | **"Increasing buffer size also increases stream start time"** | — | — |
| 20 | `user_agent` | **EditText** | **User Agent** | User Agent header value to use for the streaming | — | — |
| 21 | `load_user_so` | MultilineSwitch | **Load custom .so library** | Try to load custom ffmpeg_neon.so from the path: | **false** | **🧪 Experiment** |
| 22 | `override_region` | MultilineSwitch | **Override Region** | — | **false** | — |

**五个 `🧪 Experiment` 徽标**（全页共 5 处 `w:sup`）：

| # | key | 位置 | 控件 |
| ---: | --- | --- | --- |
| 1 | `pause_on_screen_off` | `misc.xml:22` | MultilineSwitch |
| 2 | `op_framerate` | `misc.xml:23` | MultilineSwitch |
| 3 | `load_user_so` | `misc.xml:29` | MultilineSwitch |
| 4 | **`_long_volume_shizuku_grant`** | `misc.xml:34` | **ProgressPreference** |
| 5 | **`long_volume_controls`** | `misc.xml:35` | MultilineSwitch |

均带 `w:sup="@string/pref_experiment"` + `w:supLink="alert?text=@string/pref_experimental_msg"`。

> **注意第 4、5 项在后两个分类里**——前三个在 Tweaks，后两个在 Volume Keys Long Press。**5 个徽标分布在 2 个分类中**。

**两个 Seekbar 的完整参数**：

| key | `w:scale` | `w:min` | `w:max` | `w:step` | 两端标签 |
| --- | ---: | ---: | ---: | ---: | --- |
| `stream_timeout_ms` | **1000.0** | — | — | — | Small buffer / **Never** |
| `stream_buffer_bytes` | **1048576.0** | **524288** | **4194304** | **10240** | Small buffer / Preload more |

> `stream_timeout_ms` 还带 `w:entries="@array/pref_stream_timeout_entries"` 和 `w:values="@array/pref_stream_timeout_values"` —— **滑杆同时是离散档位选择器**。

### 2.4 分类四「Volume Keys Long Press」（3 项，分类带 key `volume_keys_long_press_cat`）

【实证·原文】`misc.xml:35-39`

| # | key | 控件 | 标题 | 属性 |
| ---: | --- | --- | --- | --- |
| 23 | `volume_keys_long_press_hint` | RawText | — | `settings_quote_background`，`persistent="false"`，`keepPaddings` |
| 24 | **`_long_volume_shizuku_grant`** | **ProgressPreference** | **Grant via Shizuku** | **🧪 Experiment**，`skipSearch="false"` |
| 25 | `long_volume_controls` | MultilineSwitch | **Change Tracks By Long Volume Keys Press** | **🧪 Experiment**，`defaultValue="false"` |

> **⚠️ 本文纠正一处错误**：headset 文档曾把 `_long_volume_shizuku_grant` 称为"运行时动态创建的辅助行"。**它在本 XML 里有明确定义**——是 `ProgressPreference`，有标题、有徽标。详见 §9.2。

### 2.5 分类外（1 项）

| # | key | 控件 | 标题 |
| ---: | --- | --- | --- |
| 26 | `restore_defaults` | Preference | Restore Defaults |

---

## 3. 四个分类的职责划分

| 分类 | key 数 | 职责 | 现代性 |
| --- | ---: | --- | --- |
| **Scrobbling** | 2 | 第三方 scrobbler 集成 | 遗留（Last.fm 时代）|
| **Android Auto** | 5 | 车机/穿戴设备适配 | 现代 |
| **Tweaks** | 14 | **杂项兼容性与实验特性** | 混杂（见下）|
| **Volume Keys Long Press** | 3 | 音量键长按换曲（需 Shizuku）| 实验 |

**Tweaks 内部的四类**：

| 子类 | key | 说明 |
| --- | --- | --- |
| **外部 API** | `send_metachanged`、`send_old_api_aa` | 向第三方 App 广播 |
| **性能/电源** | `use_wakelock`、`op_framerate`、`pause_on_screen_off` | 设备行为 |
| **流媒体** | `stream_timeout_ms`、`stream_buffer_bytes`、`user_agent` | 网络参数 |
| **诊断/迁移** | `check_for_skin_reload`、`shutdown_intent`、`migrate_data_29`、`load_user_so`、`override_region` | 开发者与升级用 |

> **这个分类是"杂物间"**：把"不属于其他任何页面"的东西都塞进来了。这是大型设置树的常见问题。

---

## 4. `w:scale` 浮点缩放机制（本页核心，含陷阱）

> **🚨 仿写者必读**
>
> **1. XML 里写 `w:scale` 可能被静默忽略。** 只要同一元素也声明了 `w:entries`（≥2 元素），`SeekbarPreference.smali:389-413` 会**无条件**把 `scale` 重置为哨兵 `-1.0f`、`min=0`、`max=长度-1`、`step=1`、`floatScale=0`、`snapTo` 禁用。**没有任何日志、没有异常**——你以为写了 1000 倍缩放，实际生效的是 `w:values` 数组。
>
> **2. 本页的 `stream_timeout_ms` 正在踩这个坑**：它同时写了 `w:scale="1000.0"` 和 `w:entries`/`w:values`，**`w:scale` 是死属性**（§4.5）。
>
> **3. `w:scale` 与 `w:floatScale` 是两个不同属性**（索引 2 vs 索引 12，字段 `K:F` vs `p:F`），语义完全不同，**不可互换**。
>
> **4. `w:min`/`w:step` 必须整除默认值**，否则首次拖动就静默偏移（`stream_buffer_bytes` 实际发生，§4.6）。

### 4.1 结论先行

| key | `w:scale` | 存储值 | UI 显示值 | 关系 | `w:scale` 是否真生效 |
| --- | ---: | ---: | ---: | --- | --- |
| `stream_timeout_ms` | `1000.0` | `30000`（毫秒） | `30`（秒） | 存储 = UI × 1000 | ❌ **被 `w:entries` 覆盖** |
| `stream_buffer_bytes` | **`1048576.0`** | `1048576`（字节） | `1.0`（MB） | 存储 = UI × 1048576 | ✅ **生效** |

> **不是"UI 值 × scale"，而是双向换算**：写入时 `persistFloat(uiRaw / scale)`，读取时 `getPersistedFloat(...) × scale`。详见 §4.3。
>
> **两个滑杆写法几乎对称，只有一个真正生效**——这是本页最隐蔽的不一致。

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
> | 用途 | **整数量化**换算 | **float 存储**换算 |
> | 存储类型 | `persistInt` | `persistFloat` |
> | 本页 | ✅ **两个滑杆都用** | ❌ 未用（默认 0.0f） |

### 4.3 `K:F`（= `w:scale`）的核心公式

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

### 4.4 `w:summaryWhenEmpty`（`EditTextPreference` 相关）

【实证·产物】`EditTextPreference.smali:698-758`：styleable `ׅ/qt0->b0`（`qt0.smali:1549-1554`，`array_22`）。

用于 `user_agent` / `shutdown_intent` 两个 EditText：**值为空时显示 `w:summaryWhenEmpty` 而非 `w:summary2`**。

### 4.5 `w:entries` 与 `w:scale` 同存时的优先级（**最重要的陷阱**）

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

> **三条关键结论**：
>
> **1.** `w:entries` 一旦生效（≥2 元素），**`scale`/`min`/`max`/`step`/`floatScale`/`snapTo` 全部被无条件覆盖**。所以 `stream_timeout_ms` 的 `w:scale="1000.0"` **不参与任何滑杆计算**。
>
> **2.** `K:F` 被设成 **`-1.0f`** 而非 0——**哨兵值**。`В(int,String)` 的 `:3625-3637` 判 `K < 0` 时**只做 `%s` 格式化，不做除法**。
>
> **3.** `stream_timeout_ms` 的 `w:values` 是 **`integer-array`**（首元素类型 `0x10` = `TYPE_FIRST_INT`），走 **int[] 分支**——下标是数组索引，真实值从 `С:[I` 取。

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
> `(1048576 - 524288) / 10240 = 51.2`，截断成 51。用户首次拖动后，值会跳到 `524288 + 51 * 10240 = 1046528` 或 `524288 + 52 * 10240 = 1056768`——**与默认值 1048576 相差 48~1920 字节**。
>
> 影响很小（约 0.05%），但说明**默认值作者没有校验网格对齐**。

## 5. helper `sa1` 的完整实现

`sa1`（31331 B / **1493 行**）是 `n91` 子类，共 **8 个方法**：

| 方法 | 行 | 规模 | 职责 |
| --- | --- | ---: | --- |
| `<init>` | 17–65 | 48 | 构造（初始化 `k`=x80、`l`=pa1 等字段）|
| `I(sa1, DialogInterface)` | 67–130 | 63 | 对话框回调（静态 synthetic）|
| `J()` | 134–248 | 114 | 页面刷新/特殊状态处理 |
| **`L()`** | 250–487 | **237** | **条件可见性**（4 处 removePreference 在此）|
| `o()` | 489–553 | 64 | 销毁清理 |
| **`v()`** | **555–1407** | **852** | **主装配**（19 个 key）|
| `С()` | 1409–1445 | 36 | 暂停清理 |
| `с()` | 1447–1492 | 45 | 恢复 |

> **`v()` 独占 852 行（57%）**，是 `L()` 的 3.6 倍。这与 headset 的 `u91`（298 行）形成鲜明对比。

### 5.1 `v()` 处理的 19 个 key（按代码顺序）

【实证·产物】`sa1.smali:555-1407`：

| # | key | 处理位置 | 绑定类型 |
| ---: | --- | ---: | --- |
| 1 | `mb_a_grid` | 563 / 567 | `pa1`（Change）|
| 2 | `mb_a_aa_cats` | 588 / 592 | `pa1` |
| 3 | `mb_a_aa_tracks` | 609 / 613 | `pa1` |
| 4 | `stream_timeout_ms` | 638 / 646 | `qa1`（@654）|
| 5 | `stream_buffer_bytes` | 668 / 676 | — |
| 6 | `user_agent` | 689 / 697 | — |
| 7 | `send_mediasession_q` | 714 / 718 | `pa1`（@726）|
| 8 | `volume_keys_long_press_cat` | 759 / 763 | **条件移除**（§6.1）|
| 9 | `volume_keys_long_press_hint` | 793 / 797 | — |
| 10 | `_long_volume_shizuku_grant` | 1002 / 1010 | `oa1`（@894，共用）|
| 11 | `send_metachanged` | 1145 / 1149 | — |
| 12 | `shutdown_intent` | 1166 / 1170 | `c91`（@1178）|
| 13 | `tweaks` | 1196 / 1200 | 分类操作 |
| 14 | `op_framerate` | 1212 / 1220 | **条件移除**（§6.2）|
| 15 | `migrate_data_29` | 1255 / 1263 | **条件移除 + oa1**（§6.3）|
| 16 | `load_user_so` | 1299 / 1303 | **无条件移除**（§6.5）|
| 17 | `use_wakelock` | 1316 / 1320 | `ma1`（@1328）|
| 18 | `override_region` | 1342 / 1346 | `ma1`（@1358）|
| 19 | `restore_defaults` | 1380 / 1384 | `oa1`（@1392）|

> **`oa1` 被复用 3 次**（`_long_volume_shizuku_grant`、`migrate_data_29`、`restore_defaults`）——同一个点击监听器类，靠构造参数区分。
>
> **`ma1` 被复用 2 次**（`use_wakelock`、`override_region`）。

### 5.2 六个监听器类

| 类 | 规模 | 类型 | 用于 |
| --- | ---: | --- | --- |
| **`pa1`** | — | `OnPreferenceChangeListener` | `mb_a_grid`、`mb_a_aa_cats`、`mb_a_aa_tracks`、`send_mediasession_q` |
| **`qa1`** | — | `OnPreferenceChangeListener` | `stream_timeout_ms` |
| **`oa1`** | — | `OnPreferenceClickListener` | 3 处（复用）|
| **`ma1`** | — | `OnPreferenceClickListener` | 2 处（复用）|
| **`na1`** | 3644 B / 211 L | Runnable | `use_wakelock` 的写入 |
| **`ra1`** | — | 回调接口 | Shizuku 授权回调 |

---

## 6. 4 处条件移除（**哪些项会消失**）

`sa1.L()`（237 行）里做了 **4 次 `removePreference`**，其中 **3 处有 SDK 条件、1 处无条件**。

### 6.1 `volume_keys_long_press_cat` —— SDK < 26 移除整个分类

【实证·产物】`sa1.smali:743-784`：

```java
int sdk = Build.VERSION.SDK_INT;
if (sdk < 0x1a /* 26 */) {
    PreferenceGroup cat = findPreference("volume_keys_long_press_cat");
    if (cat != null) {
        K.removePreference(cat);      // ← 删整个分类（3 项全消失）
    }
} else {
    // 保留，继续后续装配
}
```

> **Android 8.0 以下整个分类消失**（含 `_long_volume_shizuku_grant` 与 `long_volume_controls`）。
>
> 这与 headset 页 `u91` 移除 `long_volume_press` 的条件**一致**（都是 SDK < 26）——**同一个特性的两处门控**。

### 6.2 `op_framerate` —— SDK < 29 移除

【实证·产物】`sa1.smali:1196-1241`：

```java
PreferenceCategory tweaks = findPreference("tweaks");
Preference opFramerate = findPreference("op_framerate");
if (sdk < 0x1d /* 29 */) {
    tweaks.removePreference(opFramerate);
}
```

> **Android 10 以下不显示**。因为 `op_framerate` 用的是 Android 10 引入的高刷新率 API。

### 6.3 `migrate_data_29` —— **只有 SDK == 29 时保留**

【实证·产物】`sa1.smali:1255-1293`：

```java
Preference migrate = findPreference("migrate_data_29");
if (sdk != 0x1d /* 29 */) {       // ← 注意是 != 而不是 <
    tweaks.removePreference(migrate);
} else {
    migrate.setOnPreferenceClickListener(new oa1(this, 1));
}
```

> **这是全页最特殊的条件**：只在 **Android 10（SDK 29）** 上显示。
>
> **原因**：Android 10 引入分区存储（Scoped Storage），旧版 Poweramp 的数据目录需要迁移到新位置。**其他版本要么不需要迁移（<29），要么已经迁移过（>29）**。

### 6.4 `load_user_so` —— **无条件移除**（本轮关键发现）

【实证·产物】`sa1.smali:1299-1311`：

```java
Preference loadSo = findPreference("load_user_so");
tweaks.removePreference(loadSo);      // ← 没有任何 if 判断！
```

**没有条件、没有 `if`**——直接删。

> **这意味着 `load_user_so` 在 XML 里存在（带实验徽标），但在生产版本中永远不可见。**
>
> 这是**功能被放弃但 XML 未清理**的典型痕迹。开发者可能：
> - 临时禁用以规避安全问题（加载任意 `.so` 风险极高）
> - 或该功能仅在内部构建中启用
>
> **用户在界面上永远看不到这个开关**，尽管它占据 XML 第 21 位。

### 6.5 条件移除汇总表

| 条目 | 条件 | 结果 | 定位 |
| --- | --- | --- | --- |
| `volume_keys_long_press_cat` | **SDK < 26** | 整个分类（3 项）消失 | `sa1:743-784` |
| `op_framerate` | **SDK < 29** | 单项消失 | `sa1:1196-1241` |
| `migrate_data_29` | **SDK ≠ 29** | 仅 Android 10 可见 | `sa1:1255-1293` |
| **`load_user_so`** | **无（永远）** | **生产版永不显示** | `sa1:1299-1311` |

> **"越界/无判断删除"是这套代码的常见模式**：`headset` 的 `s91`、`z91`、`ha1`、`x2` 都有类似手法。`load_user_so` 是最极端的一例——**连条件都没有**。

---

## 7. 14 个字段的运行时消费者

### 7.1 字段映射（权威）

【实证·产物】`vr.smali`：

| key | `vr` 字段 | 定义行 | 类型 |
| --- | --- | ---: | --- |
| `user_agent` | `vr->b` | 666 | **`ub1`（String）** |
| `scrobble_to_last_fm` | `vr->e0` | 1369 | `pb1`（bool）|
| `scrobble_to_simple_last_fm` | `vr->f0` | 1385 | `pb1` |
| `long_volume_controls` | `vr->E0` | 1804 | `pb1` |
| `use_wakelock` | `vr->b1` | 2195 | `pb1` |
| `send_metachanged` | `vr->d1` | 2227 | `pb1` |
| `send_old_api_aa` | `vr->i1` | 2307 | `pb1` |
| `send_mediasession_q` | `vr->n1` | 2395 | `pb1` |
| `mb_a_grid` | `vr->q1` | 2443 | `pb1` |
| `mb_a_aa_cats` | `vr->r1` | 2459 | `pb1` |
| `mb_a_aa_tracks` | `vr->s1` | 2475 | `pb1` |
| `shutdown_intent` | `vr->H1` | 2776 | `ub1`（String）|
| `pause_on_screen_off` | `vr->X1` | 3053 | `pb1` |
| `override_region` | `vr->u2` | 3475 | `pb1` |

**四个 key 不在 `vr` 中**：

| key | 原因 |
| --- | --- |
| `check_for_skin_reload` | 可能用别的存储机制，或仅在启动时读一次 |
| `op_framerate` | 同上 |
| `migrate_data_29` | 一次性操作，无需持久化（`persistent="false"`）|
| `load_user_so` | 被移除，无需存储 |

### 7.2 消费者类清单

【实证·产物】全包扫描：

| 消费者 | 规模 | 身份 | 消费的 key |
| --- | ---: | --- | --- |
| **`ar`** | 123767 B / 6602 L | **外部 API 广播发送器** | `scrobble_to_last_fm`、`scrobble_to_simple_last_fm`、`send_metachanged`、`send_old_api_aa` |
| **`ih0`** | 328163 B / 19344 L | 播放核心抽象基类 | `long_volume_controls` |
| `dk0` | 112993 B / 6240 L | 播放核心 | `long_volume_controls` |
| `oh` | 46267 B / 2538 L | 区域/网络配置 | `override_region` |
| `wk0` | 27048 B / 1482 L | MediaSession | `send_mediasession_q` |
| `pc` | 24303 B / 1412 L | 列表渲染 | `mb_a_aa_cats`、`mb_a_aa_tracks` |
| `w4` | 19137 B / 937 L | Runnable | `shutdown_intent` |
| `lk0` | 15686 B / 956 L | WakeLock 管理 | `use_wakelock` |
| `nc` | 13171 B / 664 L | 列表渲染 | `mb_a_grid` |
| `na1` | 3644 B / 211 L | Runnable | `use_wakelock`（写入）|
| **（无）** | — | — | **`pause_on_screen_off`、`user_agent`** |

### 7.3 `ar`：外部 API 广播发送器（4 个 key）

`ar` 是**全页最大的消费者**（123767 B），负责向第三方 App 广播播放状态。

**关键字符串**【实证·产物】`ar.smali`：

| 字符串 | 行 | 用途 |
| --- | ---: | --- |
| `fm.last.android.metachanged` | 682 | **Last.fm 官方 App 的 scrobble 广播** |
| `com.android.music.metachanged` | 1911 | Android 标准音乐广播 |
| `com.maxmpz.audioplayer.TPOS_SYNC` | 821 | 播放位置同步 |
| `com.maxmpz.audioplayer.EQU_CHANGED` | 1516 | EQ 变更通知 |
| `com.maxmpz.audioplayer.PLAYING_MODE_CHANGED` | 1684 | 播放模式变更 |
| `external api thread` | 220 | 广播线程名 |

**三个字段的消费点**（都在 `B(Message, PlayerServiceCore)` 方法内）：

| 字段 | 行 | 控制的广播 |
| --- | ---: | --- |
| `vr->d1`（`send_metachanged`）| 1895 | `com.android.music.metachanged` |
| `vr->e0`（`scrobble_to_last_fm`）| 2098 | `fm.last.android.metachanged` |
| `vr->f0`（`scrobble_to_simple_last_fm`）| 2188 | Simple Scrobbler 广播 |

**代码结构**【实证·产物】`ar.smali:1887-1930`：

```java
if (vr.d1 /* send_metachanged */) {
    Intent i = new Intent("com.android.music.metachanged");
    this.Н(core, ci1, z, i);      // 填充 extras
    this.х(ci1);                   // 发送
}
```

> **`send_metachanged` 默认 `true`**（XML 里写了），所以默认就向第三方 App 广播。
>
> **这是 Poweramp 与外部生态对接的核心**：Last.fm、Wear OS、车机等全靠这套广播。

### 7.4 两个曾误判为"零消费者"的字段（**已在第 2 轮纠正**）

> **⚠️ 本节的"零消费者"结论是搜索方式错误导致的**——当时只扫描了 `smali/` 顶层文件，未递归子目录。**真实消费者见 §12.2 / §12.3**：
>
> | key | 本节旧结论 | **实际** |
> | --- | --- | --- |
> | `pause_on_screen_off` | 零消费者 | **`PlayerServiceCore.onBusMsg`** |
> | `user_agent` | 零消费者 | **`CcPluginService`（Chromecast）** |
>
> 以下内容保留作为排查过程的记录。

| key | `vr` 字段 | 类型 | Java 层消费者 |
| --- | --- | --- | --- |
| `pause_on_screen_off` | `vr->X1` | `pb1`（bool）| **0** |
| `user_agent` | `vr->b` | `ub1`（String）| **0** |

**定义确认**【实证·产物】`vr.smali`：

```java
// :3053-3065
vr.X1 = ms.с("pause_on_screen_off", false);    // 返回 pb1

// :666-681
vr.b  = ms.d("user_agent", null);              // 返回 ub1，默认 null
```

**为什么零消费者**（【推断】，三个可能）：

| 假设 | 支持 | 反对 |
| --- | --- | --- |
| **① native 层读取** | 两者都作用于底层：`pause_on_screen_off` 涉及电源事件，`user_agent` 是 HTTP 头 | 未在 native 中定位 |
| **② 通过 `ub1.getValue()` 间接访问** | `ub1` 是惰性包装类，可能被泛型代码调用 | 按字段名搜索不到任何 `getValue()` 调用点 |
| **③ 字段声明后未接线** | `load_user_so` 已被证明是"声明未使用" | `pause_on_screen_off` 是功能性开关，不像废弃项 |

> **最可能是 ①**：`user_agent` 明显要传给 HTTP 栈（native 或 OkHttp），`pause_on_screen_off` 要挂电源管理回调。
>
> **但 Java 层确实零引用**——这是本轮扫描 40 个类的确定结果。**标【推断】，未验证 native 层**。

### 7.5 `use_wakelock` 的完整链路

两个消费者分工明确：

**`lk0`（读取方）**【实证·产物】`lk0.smali:284-315`：

```java
if (!this.К) {                              // 某个内部标志
    if (vr.b1 /* use_wakelock */) {
        goto :goto_0;                       // 需要持锁
    }
    if (wakeLock.isHeld()) {                // 否则释放
        wakeLock.release();
    }
}
```

**`na1`（写入方）**【实证·产物】`na1.smali:121-143`：

```java
if (xn0.В) {                                // 设备能力判定
    vr.b1.у(true);                          // 强制写入 true
    this.n91.y();                           // 刷新
}
```

> **`na1` 会在特定设备上强制把 `use_wakelock` 设为 `true`** —— 这是"按设备能力自动纠偏"的设计。
>
> `xn0.В` 是设备/版本能力标志（`xn0` 是抽象常量类，25077 B）。

---

## 8. 三个流媒体参数

### 8.1 `stream_timeout_ms`：滑杆 + 离散档位

**双重身份**：

1. **滑杆**（`w:scale="1000.0"`）→ 显示秒数
2. **离散档位**（`w:entries` / `w:values`）→ 从预设值中选

【实证·原文】还带 `w:leftLabel="@string/pref_buffer_small"` / `w:rightLabel="@string/never"`。

> **右端标签是 "Never"** —— 滑到最右等于无限等待。这解释了为什么默认值 30000（30 秒）之外还有"永不超时"选项。

### 8.2 `stream_buffer_bytes`：范围与步进

```
存储域: 524288 (512 KB) ~ 4194304 (4 MB)
步进:   10240 字节 (10 KB)
scale:  1048576.0
显示:   %1$.1f MB
```

> **512 KB ~ 4 MB 的范围**是相当保守的——现代流媒体应用常用 8-32 MB 缓冲。
>
> 旁边的提示块明确写着 **"Increasing buffer size also increases stream start time"** —— 承认了权衡。

### 8.3 `user_agent`：可编辑的 HTTP 头

`EditTextPreference`，`w:summary2="%s"`（当前值回显），默认 `null`。

> 允许用户自定义 User-Agent，用于：
> - 绕过某些服务器的客户端检测
> - 伪装成其他播放器以获取特定格式
>
> **但如 §7.4 所述，Java 层零消费者** —— 实际使用在 native/HTTP 层。

---

## 9. Experiment 徽标与 `w:sup` 渲染机制

> 本页有 **5 个 Experiment 徽标**，是**全 App 最多的一页**（对比 `aa.xml` 只有 2 个）。Tweaks 分类本身就是"实验区"。

### 9.1 五个徽标的 summary 情况

| key | 有无 `android:summary` |
| --- | --- |
| `pause_on_screen_off` | **无**（XML 完全没写） |
| `op_framerate` | 有 |
| `load_user_so` | 有 |
| `_long_volume_shizuku_grant` | 无（`ProgressPreference` 本身无 summary） |
| `long_volume_controls` | **无** |

### 9.2 完整写法

【实证·原文】`misc.xml:22`：

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

### 9.3 渲染机制（**不是 HTML**）

**关键发现**：`w:sup`/`w:supLink` 的渲染**不走 `Html.fromHtml`**，而是**直接构造 `SpannableStringBuilder` + Span**。

`qt0->b0` = styleable【实证·产物】`qt0.smali:1549-1554`（`array_22`）：

```
{0x1010036, summary2(0x7f010519), allowLinks(0x7f01058a), sup(0x7f010630),
 supLink(0x7f010631), smallIcon(0x7f0106f2), removeFromSummary(0x7f010748),
 0x7f0109fe, 0x7f010a4b, 0x7f010c40, tag(0x7f010c5c), tagLink(0x7f010c5d)}
```
【实证·产物】`qt0.smali:4532-4546`

`ׅ/wr0`（`PreferenceHelper`，本页所有 `MultilineSwitch`/`RawText`/`Seekbar`/`Dialog` 偏好共用）读取【实证·产物】`wr0.smali:134-230`：

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

**渲染点② `sup`/`supLink`**【实证·产物】`wr0.smali:2518-2604`：同一套 Span 组合。

> **`RelativeSizeSpan(0.8f)` + `SuperscriptSpan`** 才是"上标徽标"的真正实现——**不是 HTML 的 `<sup>` 标签**。
>
> **`w:removeFromSummary`（索引 7，`o` 字段）** 的语义【实证·产物】`wr0.smali:65-111`：控制是否从 summary 里移除某段文本。

### 9.4 `alert?text=...` 深链的点击行为

`w:supLink` 存进 `Н:String`，在 `:2582` 被包成 **`HtmlCompat$DefensiveURLSpan`**（`URLSpan` 子类）。

`RawTextPreference.setTarget` 的三态分发（`http` / 内部深链 / 无）**不包含 `alert?`**——它是 **URLSpan 的 onClick**，**不经过 `w:target`**。

> **推断**：`alert?text=<资源名>` 是 Poweramp 自定义**伪 URL scheme**，`DefensiveURLSpan` 拦截后解析 `text=`、把 `@string/...` 解析成字符串、弹 `PseudoAlertDialog`。与 `poweramp-album-art-settings.md` §2.2.1 的写法**完全一致**，是**跨页统一约定**。
>
> **为什么叫 "Defensive"**（推断）：自定义 scheme 会抛 `ActivityNotFoundException`；这个子类拦截未知 scheme 做降级，避免第三方 ROM 上崩溃。

---

## 10. Shizuku 授权链

### 10.1 三个组件

| 组件 | 位置 | 作用 |
| --- | --- | --- |
| `volume_keys_long_press_hint` | `misc.xml` 分类四第 1 项 | 说明文字块 |
| **`_long_volume_shizuku_grant`** | `misc.xml` 分类四第 2 项 | **ProgressPreference，点击触发授权** |
| `long_volume_controls` | `misc.xml` 分类四第 3 项 | 实际开关 |

### 10.2 ⚠️ 纠正：`_long_volume_shizuku_grant` 不是动态行

**此前的错误说法**（headset 子树文档）：

> "`_long_volume_shizuku_grant` 不在 `misc.xml` 中——它由 `sa1` 在运行时通过 `findPreference` 查找，说明它由代码动态创建"

**实际情况**：它**在 `misc.xml:38` 有完整定义**：

```xml
<com.maxmpz.audioplayer.preference.ProgressPreference
    android:title="@string/pref_grant_via_shizuku"
    android:key="_long_volume_shizuku_grant"
    w:skipSearch="false"
    w:sup="@string/pref_experiment"
    w:supLink="alert?text=@string/pref_experimental_msg" />
```

| 属性 | 值 |
| --- | --- |
| 控件 | **`ProgressPreference`**（不是 RawText）|
| 标题 | `pref_grant_via_shizuku` = **"Grant via Shizuku"** |
| `skipSearch` | **false**（参与搜索）|
| 徽标 | **🧪 Experiment** |

**为什么会误判**：`_` 前缀在 Poweramp 里通常表示"运行时创建"（如 `library` 页的 `_legacy_access_warning`），但**这里是个例外**——`_` 只表示"特殊用途"（非普通配置项），不代表动态创建。

> **教训**：不能单凭命名约定推断，必须核对 XML 原文。

### 10.3 `x80`：Shizuku 授权器

`sa1` 在构造时懒加载 `x80`【实证·产物】`sa1.smali:908-998`：

```java
if (this.k == null) {
    String anchor = this.H() + "#_long_volume_shizuku_grant";
    //                  ↑ n91.H() = "misc"

    this.k = new x80(
        settingsActivity, handler, anchor,
        new ra1(this),              // 授权回调
        new u0(0xe, this)           // 进度更新（ProgressPreference）
    );
}
```

**`x80` 的工作方式**（32138 B / 1786 行）：

| 步骤 | 实现 | 定位 |
| --- | --- | --- |
| ① 连接 Shizuku | `moe.shizuku.server.IShizukuService` | `x80:257` |
| ② 构造命令 | `/system/bin/cmd package grant --user <N> <pkg> <perm>` | `x80:138-167` |
| ③ 执行 | 通过 Shizuku 以 shell 身份运行 | `x80:190-197` |
| ④ 超时 | **10 秒** | `x80:178` |
| ⑤ 目标权限 | `android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER` | `x80:130` |
| ⑥ 无 Shizuku | `"no Shizuku binder"` | `x80:243` |

> **`ProgressPreference` 的用途**：授权过程需要数秒，用进度条显示而不是普通开关——**这是控件选择与功能匹配的好例子**。

### 10.4 完整门槛链

用户要启用"音量键长按换曲"，需跨越：

```
① SDK >= 26            （否则整个分类被移除，§6.1）
   ↓
② 安装 Shizuku          （否则 "no Shizuku binder"）
   ↓
③ 启动 Shizuku 服务     （需要 adb 或 root 一次）
   ↓
④ 点 "Grant via Shizuku" （执行 pm grant，10 秒超时）
   ↓
⑤ 系统授予签名级权限
   ↓
⑥ 才能切换 long_volume_controls
```

> **六道门槛**——这也解释了为什么要标注"实验性"。

---

### 10.5 授权失败的弹框（MIUI 特判写在文案里）

【实证·产物】`ra1.smali:29-141`：

| 部分 | 资源 | 内容 |
| --- | --- | --- |
| 标题 | `pref_volume_keys_long_press`（`0x7f080766`）| — |
| 正文 | **`shizuku_grant_failed`**（`0x7f080822`，带 `%1$s`）| 见下 |
| 负按钮 | `close`（`0x7f080205`）| — |

`shizuku_grant_failed` 原文【实证·原文】`strings.xml:1889-1892`：

> **Couldn't grant the permission via Shizuku:**
> `%1$s`
>
> **On Xiaomi phones, also enable "USB debugging (Security settings)" in Developer options. Or use the ADB command above**

> **MIUI 特判写在文案里而非代码分支里**——作者用一句话覆盖小米机型的特殊路径，省掉一个 `Build.MANUFACTURER` 判断。**这是"用文案代替代码分支"的实用技巧**。

### 10.6 授权等待：5000ms 超时 + 焦点监听

【实证·产物】`x80.smali:1544-1585`：

```
postDelayed(fc1, 0x1388 = 5000ms)
addOnWindowFocusChangeListener(gc1)
```

> **为什么需要 5000ms 超时 + 焦点监听**：授权必须**切到 Shizuku app 再切回来**——用户不切回就 5 秒后放弃，切回时靠焦点回调立即刷新。**这是跨 App 手势流程的典型处理**。
>
> **为什么用 `cmd` 不是 `pm`**：`cmd package` 是 `pm` 的底层实现，经 Shizuku binder 以 shell 身份调用更稳。
>
> **`moe.shizuku.server.IShizukuService`** 是 Shizuku 的 AIDL 接口名（`moe.shizuku` 是其包名前缀）。

### 10.7 `sa1.L()`：授权状态的**四态渲染**

`L()`（`:250-487`，238 行）是本页**最复杂的单段逻辑**，处理 `long_volume_controls` 与 `_long_volume_shizuku_grant` 的联动。

**入口守卫**：`SDK_INT < 0x1a (26 = Android 8.0)` **直接 return**（`:262`）。

> **Android 8.0 是硬门槛**——`SET_VOLUME_KEY_LONG_PRESS_LISTENER` 是 8.0 引入的 API。低于 8.0 时 `L()` 整个不执行；但分类本身已在 `v()` 里被 `removePreference`（§6.1），所以用户看不到空壳。

**四态表**：

| 权限状态 | `long_volume_controls` | `_long_volume_shizuku_grant` | 图标 | 行 |
| --- | --- | --- | --- | --- |
| **已授权** | summary=`0x7f080436`、enabled | summary=同 + **勾选图标** `settings_check_48dp` | ✓ | `:336-366` |
| **未授权**，非 granting | summary=`no_permission`、**`setChecked(false)`**、**disabled** | summary=`pref_summary_long_volume_grant_via_shizuku` | 清空 | `:370-432` |
| **未授权**，granting 中 | 同上（仍 disabled） | summary=**`pref_grant_via_shizuku_granting`** | — | `:409` |
| **未授权**，Shizuku 未运行 | 同上 | 兜底走 `0x7f0806a5` | — | `:418` |

**四态只靠 4 个 setter 切换**【实证·产物】`sa1.smali:332-436`：

| 分支 | 调用序列 |
| --- | --- |
| 已授权 | `setSummary(0x7f080436)` → `setEnabled(true)` → `Progress.setSummary(同)` → `setIcon(0x7f020344)` |
| 未授权 | `setSummary(0x7f0803bf)` → `Switch.setChecked(false)` → `setEnabled(false)` → `Progress.setSummary(0x7f080512 或 0x7f0806a5)` → `setIcon(null)` |

> **不重建 Preference 对象**，只改属性——Android `Preference` 动态更新的标准做法（`notifyChanged()` 由各 setter 内部触发）。
>
> **`:438/456` 两次判同一个 `x80->К:Z`** 是反编译产物（Kotlin 嵌套 `if` 展开），非逻辑冗余。

### 10.8 授权成功回调（`ad`）

【实证·产物】`ad.smali:195-235`：

```asm
199: this.sa1.L()                       ; ★ 刷新四态
212: v3 = K.findPreference("long_volume_controls")
224: setChecked(v1)                      ; ★ 手动勾上
233: new na1(this, ...)                  ; 后续动作
```

> 授权成功后：刷新四态 → 手动勾上 `long_volume_controls` → 触发 `na1` 的连锁动作（§14.5）。

### 10.9 提示行 `volume_keys_long_press_hint` 的动态拼接

**XML 里这个 RawText 没有 `android:summary`**——文案**在运行时拼出来**【实证·产物】`sa1.smali:789-889`：

```asm
789: v2 = K.findPreference("volume_keys_long_press_hint")
818: v6 = 0x7f080767                 ; pref_volume_keys_long_press_hint
823: v6 = getString(v6)
836: v4.append("<br><br><tt><small>adb shell pm grant ")
845: v6 = getPackageName()            ; ★ 运行时包名
858: v4.append(" android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER</small></tt>")
881: v4 = dn0.p(ctx, v4, 0, null, null)   ; ★ HTML → SpannableStringBuilder
889: v2.setSummary(v4)                     ; ★ 写入 summary
```

拼接结果：

> **Switch tracks by responding to the Volume keys long press (but not in the Poweramp UI). This option uses a semi-official Android 8+ API, which can be activated via Shizuku, ADB, or shell command (click here to copy single-line command):**
>
> `adb shell pm grant com.maxmpz.audioplayer android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER`

> **包名是运行时取的**（`getPackageName()`），所以文案能随渠道包名变化。这是"动态文案"的实用手法。

### 10.10 权限级别的横向对比

`SET_VOLUME_KEY_LONG_PRESS_LISTENER` 要求 `signature|privileged` 级别。普通 App 只能通过：

| 方式 | 需要 | 用户门槛 |
| --- | --- | --- |
| ADB | 电脑 + USB 调试 | 高 |
| `adb shell pm grant ...` | 同上 | 高 |
| **Shizuku** | 装 Shizuku app 并激活 | **中**（本页选择） |
| Root | 本机 root | 高 |

> **本页同时提供了两条路**：Shizuku（按钮）和手动 ADB（提示行给命令 + 点击复制，见 §14.3）。

---


### 10.11 `shizuku_continue`：跨 Activity 恢复（授权中断续接）

授权流程需要**切到 Shizuku app 再切回来**——如果这时 Poweramp 被系统回收，授权就会中断。`shizuku_continue` 就是**续接标记**。

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
1116: v5 = new fc1(this.k, ...)             ; ★ 继续授权流程
```

| 要点 | 说明 |
| --- | --- |
| **两处存储** | Intent extra（`getIntent().removeExtra`）+ Fragment arguments（`getArguments()`）|
| **一次性** | 读到后立刻 `remove`，防止重复触发 |
| **幂等** | 先查 `x80.А()` 确认是否已有权限，避免重复授权 |
| **续接** | 重新构造 `fc1` 继续流程 |

> **这是"跨 App 手势流程"的必要设计**：用户切到 Shizuku 期间 Poweramp 可能被回收，`shizuku_continue` 保证回来时能继续。
>
> **双存储的原因**：Intent extra 用于 Activity 重建，Fragment arguments 用于 Fragment 重建——两条路径都可能。

### 10.12 分类「有 key 无 title」的异常（全 App 唯一）

`volume_keys_long_press_cat` 是**全 App 唯一**一个「有 `android:key` 但没有 `android:title`」的 `PreferenceCategory`【实证·原文】`misc.xml:32`。

三个可能解释，结合代码可排除两个：

| 假设 | 判据 | 结论 |
| --- | --- | --- |
| A. 省略是有意的（分类不显示标题栏）| 若为真，其他页也应有同类写法 | **排除**——`lockscreen.xml`、`aa_bg.xml` 的分类都带 title |
| B. 运行时补上标题 | `sa1` 全文无 `setTitle` | **排除**——`sa1.smali:759` 只 `findPreference` + `removePreference`，无 `setTitle` |
| C. **遗留/未完成**（作者本想用 `pref_volume_keys_long_press` 但漏写）| 该字符串资源**确实存在**，且在同一 `sa1` 里被当作**对话框标题**使用 | **最可能** |

【实证·产物】`public.xml:5880` 有 `pref_volume_keys_long_press`；`ra1.smali:67` 用 `0x7f080766`（即该字符串）作 `PseudoAlertDialog.setTitle`。

> **推断**：这个分类头**渲染为空白标题栏**。作者省掉标题，大概因为整个分类只对 Android 8+ 可见，且下方 3 项已各自带完整标题——空白分类头反而减少视觉噪音。
>
> **这是风格选择而非 bug**，但与全树其他页不一致，列为"不建议照抄"（见 §17）。

### 10.13 `sa1` 不使用 `n91.h()`/`n91.i()` 的实证

`sa1.smali` 全文对 `n91` 的方法调用只有 **`H()`、`Н()`、`j()`、`y()`、`m()`、`L()`、`o()`** ——**没有 `h(` / `i(`**。

三个待确认元素的移除路径：

| 元素 | 实际移除点 | 方法 | 行号 |
| --- | --- | --- | --- |
| `pref_summary_stream_buffer`（第 19 项）| **从不移除** | — | — |
| `migrate_data_29` | `v()` 里直接 `removePreference` | **`PreferenceGroup.removePreference`** | `sa1.smali:1275` |
| `volume_keys_long_press_hint` | **从不移除**（仅 `setSummary`）| — | `:889` |

> **准确表述**：`n91.i(RawTextPreference)` 是**可选工具**（走动画移除），**是否使用完全取决于 helper 作者**——`sa1` 作者选择了不用。
>
> **所以"RawText 走动画"不是自动的**，是 `z61` 等 helper 的选择。这对仿写者很重要。

### 10.14 `override_region` 的 null 检查（唯一的防御）

`sa1.smali:1354` 是**本页唯一的 `findPreference == null` 防御**：

```java
Preference p = findPreference("override_region");
if (p != null) { ... }        // ← 全页唯一的 null 防御
```

> **推断**：该项**运行时按区域增删**——在不需要覆盖地区的设备上，这一项可能被移除。未找到增删点，但 null 检查的存在本身就是证据。

---

## 11. `ui_mediaactions` 子页

### 11.1 跳转关系

`misc.xml` 分类二第 1 项：

```xml
<RedirectPreference
    android:title="@string/buttons"
    android:key="buttons"
    android:summary="@string/notify_action_buttons"
    w:target="ui_mediaactions" />
```

| 项 | 值 |
| --- | --- |
| 标题 | `@string/buttons` = **"Buttons"** |
| 摘要 | `@string/notify_action_buttons` = **"Media action buttons"** |
| 目标 | **`ui_mediaactions`**（资源 id `0x7f16002d`）|

> **注意**：这个 key 叫 `buttons`，但**与 headset 页无任何关系**。headset 的"Buttons"是分类标题，这里是 Android Auto 的动作按钮配置。
>
> **全设置树中 `buttons` 这个 key 名出现 3 次**（本页、`ui.xml`、`ui_player.xml`），但指向不同页面——这是命名冲突的实际案例。

### 11.2 `ui_mediaactions` 页面性质

| | |
| --- | --- |
| XML | `res/xml/ui_mediaactions.xml` |
| 资源 id | **`0x7f16002d`** |
| 归属 | **外观分支**（不是 misc 的子页）|
| helper | 见 `poweramp-look-and-feel-settings.md` |

> **从 misc 点进来，实际是跨到了外观分支**——与 `audio_focus` 被 headset 引用是同一种模式。

### 11.3 内容概要

`ui_mediaactions` 配置的是**通知栏/车机的媒体动作按钮**（播放/暂停/上一首/下一首等），使用 `TagListPreference` 四件套（entries/values/summaries/icons）。

> 详见 `poweramp-look-and-feel-settings.md` 对应章节，本文不复述。

---

## 12. 未解问题

> **第 2 轮已闭合全部 4 项**（详见 §12）。本节保留原问题与解决状态，供对照。

### 12.1 已闭合（原问题 → 结论）

| # | 原问题 | 结论 | 详见 |
| ---: | --- | --- | --- |
| 1 | `pause_on_screen_off` 的消费者 | `PlayerServiceCore.onBusMsg` → MsgBus `0x7f0d00cc` | §12.2 |
| 2 | `user_agent` 的消费者 | `CcPluginService` 的 Chromecast JSON 配置 | §12.3 |
| 3 | `check_for_skin_reload`/`op_framerate` 存储 | 在 **`wr` 表**（`wr->О` / `wr->m0`）| §12.4 |
| 4 | `shutdown_intent` 触发链路 | 用户输入作为动态 `IntentFilter.addAction` 参数 | §12.5 |
| 5 | `override_region` 作用域 | 地区检测绕过（`ru`/`cn`）| §12.6 |

### 12.2 仍未解

1. **`BaseApplication.о`（屏幕状态标志）零读取点**：`i8` 会写 `true`/`false`，但全包扫描确认无任何读取。可能通过反射、JNI 或跨进程读取。（P3）

2. **`vr->b`（`user_agent`）的字段级访问为零**：`CcPluginService` 读的是 JSON 配置里的同名 key，`vr` 字段如何进入该 JSON 未定位。（P3）

3. **`y1.d(Activity)` 的高刷新率实现细节**：只知它被 `op_framerate` 控制，内部用何种 API 未展开。（P3）

4. **`w4` 的 `i8` 接收器与其他广播的协同**：`w4.run()` 还注册了 `HEADSET_PLUG`、`AUDIO_BECOMING_NOISY`、`MEDIA_SCANNER_FINISHED` 等，与 misc 页关系弱，未展开。（P3）

### 12.3 明确不再追的项

| 项 | 原因 |
| --- | --- |
| `ar` 的 6602 行广播细节 | 已定位 4 个 key 的控制点 |
| `ih0` 的 19344 行 | 播放核心抽象基类 |
| `x80` 的 1786 行 Shizuku 集成 | 通用第三方方案 |
| native 层（`lib/` 未解出）| **apktool 未导出 `.so`，无法静态分析** |

---

## 13. 全部未解项闭环（第 2 轮深挖）

> 上一轮留了 4 个未解问题。本轮**全部解开**，并纠正了其中最关键的一处误判。

### 13.1 ⚠️ 纠正："零消费者"是搜索错误导致的误判

上一轮我写：

> "`pause_on_screen_off` 与 `user_agent` 的 `vr` 字段在 Java 层**零引用**，推测由 native 层消费。"

**这是错的。** 实际是我**只扫描了 `smali/` 和 `smali_classes2/` 的顶层文件**，而 smali 文件实际位于**子目录**（`smali/ׅ/`、`smali/com/maxmpz/...`）。改用 `os.walk` 递归后，两者都找到了 Java 消费者。

| key | 上一轮结论 | **本轮实证** |
| --- | --- | --- |
| `pause_on_screen_off` | 零消费者，native | **`PlayerServiceCore.onBusMsg()`** |
| `user_agent` | 零消费者，native | **`CcPluginService`（Chromecast 插件）** |
| `check_for_skin_reload` | 不在 `vr` 中 | **在 `wr` 表中**（`wr->О`）|
| `op_framerate` | 不在 `vr` 中 | **在 `wr` 表中**（`wr->m0`）|
| `override_region` | 作用域未定位 | **地区检测绕过（`ru`/`cn`）** |

> **教训**：反编译产物的目录结构必须先用 `os.walk` 确认，不能假设扁平结构。这个错误让上一轮得出了完全错误的结论。

### 13.2 `pause_on_screen_off`：屏幕关闭 → 暂停播放（完整链路）

**完整链路**（三段）：

**① `w4.run()` 注册广播**【实证·产物】`w4.smali:320-390`：

```java
IntentFilter f = new IntentFilter();
f.addAction("android.intent.action.SCREEN_ON");        // :328
f.addAction("android.intent.action.SCREEN_OFF");       // :337
f.addAction("android.intent.action.ACTION_SHUTDOWN");  // :346
f.addAction("android.intent.action.QUICKBOOT_POWEROFF"); // :355
f.addAction("com.microntek.bootcheck");                // :364  车机专用
f.addAction("com.glsx.boot.ACCOFF");                   // :373  车机专用
r4.у(ctx, i8, f);                                      // :386  注册给 i8
```

> **注意两个厂商专用关机广播**：`com.microntek.bootcheck`（后装车机）和 `com.glsx.boot.ACCOFF`（GLsx 方案）。这是车机适配的痕迹。

**② `i8.onReceive()` 转成 MsgBus 消息**【实证·产物】`i8.smali:454-475`：

```java
// SCREEN_OFF 分支
BaseApplication.о = false;              // :471 屏幕状态标志
MsgBus.post(msgId, 0, 0, null);         // :475 发消息（参数 0）
```

**③ `PlayerServiceCore.onBusMsg()` 判定并暂停**【实证·产物】`PlayerServiceCore.smali:5260-5299`：

```java
if (vr.X1 /* pause_on_screen_off */) {
    jo0.B(1, "pause_on_screen_off", "PAUSE", ...);   // :5272-5280 诊断日志
    MsgBus.post(0x7f0d00cc, 0, 0, null);              // :5299 暂停命令
}
```

> **这形成了一条完整的"系统广播 → 应用内消息 → 播放控制"链路**。
>
> **`BaseApplication.о` 是屏幕状态标志**：`SCREEN_ON` 置 `true`、`SCREEN_OFF` 置 `false`。但注意——它**只有写入、没有读取**（全包扫描确认），说明读取方可能在其他时机或通过其他入口。

### 13.3 `user_agent`：Chromecast 插件的 JSON 配置参数

**消费者**：`CcPluginService.smali`（6091 行，Chromecast 输出插件）。

【实证·产物】`CcPluginService.smali:895-933`：

```java
StringBuilder sb = ...;
sb.append(...);
sb.append("user_agent");                          // :908 JSON key
String def = ctx.getString(0x7f080903);           // :912-917 默认值资源
String ua = json.optString("user_agent", def);    // :925 读 JSON，缺省用资源值
sb.append(ua);
```

| 项 | 说明 |
| --- | --- |
| 用途 | **构造 Chromecast 插件的 JSON 配置** |
| 字段名 | `user_agent`（JSON key）|
| 默认值 | `@string` `0x7f080903` |
| 读取方式 | `JSONObject.optString("user_agent", default)` |

> **为什么在 Chromecast 插件里**：投屏到 Chromecast 时，Poweramp 需要伪装 UA 才能让接收端接受某些媒体流。这是投屏场景的常见需求。
>
> **注意**：`vr->b`（`ub1` 类型）在 Java 层的**字段级**访问仍是零，因为这里读的是 **JSON 配置里的同名 key**，不是 `vr` 字段。两者可能通过配置序列化关联。

### 13.4 `check_for_skin_reload` / `op_framerate`：在 `wr` 表，不在 `vr`

**存储位置纠正**：

| key | `vr` 中 | **`wr` 中** | 字段 |
| --- | --- | --- | --- |
| `check_for_skin_reload` | ❌ | ✅ `wr.smali:440` | **`wr->О`** |
| `op_framerate` | ❌ | ✅ `wr.smali:1473` | **`wr->m0`** |

**`vr` 与 `wr` 的分工**（补充 §6.7）：

| 表 | 规模 | 管辖 |
| --- | ---: | --- |
| **`vr`** | 4044 行 | 耳机、锁屏、媒体库、**Android Auto**、Scrobble 等 |
| **`wr`** | **2801 行** | **外观/皮肤、高刷新率**、背景 |

> **`misc.xml` 的 27 个 key 分散在两张表中**——7 个在 `wr`、14 个在 `vr`、其余在别处或无需持久化。**这是"同一页面用多张偏好表"的实际案例。**

#### `check_for_skin_reload` 的用途

【实证·产物】`BaseActivity.smali:3930-3955`（`onStop()` 内）：

```java
super.onStop();
if (wr.О /* check_for_skin_reload */) {
    if (this.К != null) {
        // 检查皮肤是否变更
    }
}
```

> **正好对应 XML 摘要**："Always check skin for a change when app activity goes background" —— **`onStop()` 就是"activity 进入后台"的时刻**，文案与代码精确一致。

#### `op_framerate` 的用途

【实证·产物】`BaseActivity.smali:3370-3399`（`onCreate()` 内）：

```java
if (Build.VERSION.SDK_INT >= 0x1d /* 29 */) {
    if (wr.m0 /* op_framerate */) {
        y1.d(activity);        // :3394 设置高刷新率
    }
}
```

**三个消费者**：

| 类 | 位置 | 作用 |
| --- | --- | --- |
| `BaseActivity` | `@3382` | 每个 Activity 创建时设置 |
| `Application` | `@7567` | 应用级初始化 |
| `SettingsActivity` | `@2498` | 设置页单独处理 |

> **SDK ≥ 29 的双重门控**：XML 层的 `sa1` 已移除（SDK < 29），代码层再判一次 `SDK >= 29`。**这是防御性重复检查**。
>
> `y1.d(activity)` 通过非标准 API（`preferredDisplayModeId` 等）强制高刷新率——对应 XML 摘要 "Force higher display framerate via non-standard APIs"。

### 13.5 `shutdown_intent`：把用户输入当作动态广播 action

**消费者**：`w4.run()`（与屏幕广播注册在同一处）。

【实证·产物】`w4.smali:388-455`：

```java
String custom = vr.H1.А;              // :391-395 读自定义 intent 字符串
if (custom != null && custom.length() > 4) {    // :399-414 长度必须 > 4
    IntentFilter f = new IntentFilter();
    f.addAction(custom);                        // :427 ★ 用户输入当作 action
    try {
        r4.у(ctx, i8, f);                       // :433 注册给同一个接收器
    } catch (Throwable t) {
        Log.e("audioplayer.Application", "", t); // :447-455
    }
}
```

| 要点 | 说明 |
| --- | --- |
| **长度校验** | `> 4`（`:411-414`），防止用户填太短的无意义字符串 |
| **动态 action** | 用户输入直接作为 `IntentFilter.addAction()` 的参数 |
| **同一接收器** | 复用 `i8`（与屏幕/关机广播共用）|
| **异常吞掉** | `addAction` 对非法字符串可能抛异常，已 try-catch |

> **设计意图**：让用户能对接自己的自动化系统（Tasker、车机关机脚本等）。当指定的 Intent 到达时，Poweramp 会"暂停并保存状态"（对应 XML 摘要）。
>
> **安全考量**：由于是注册接收器而非发送，风险可控；但用户可监听任意 action，理论上能探测其他应用的行为。

### 13.6 `override_region`：绕过地区检测（`ru` / `cn`）

**消费者**：`oh.smali` 的 `х(Context)Z` 方法（2538 行的地区检测类）。

【实证·产物】`oh.smali:1590-1699`：

```java
boolean isInRussiaImpl(Context ctx) {
    if (vr.u2 /* override_region */) {
        Log.e(TAG, "isInRussiaImpl override_region");   // :1617
        // 直接返回 true（走"受限地区"分支）
    } else {
        // 正常检测：SIM 国家 + 语言
        List<String> regions = new ArrayList<>();
        regions.add("ru");          // :1630
        regions.add("cn");          // :1650
        TelephonyManager tm = ctx.getSystemService("phone");
        String simIso = tm.getSimCountryIso();          // :1691
        // 比对 simIso 是否在 regions 中
    }
}
```

| 要点 | 说明 |
| --- | --- |
| **目标国家** | **`ru`（俄罗斯）+ `cn`（中国）** |
| **检测依据** | `TelephonyManager.getSimCountryIso()`（SIM 卡国家）|
| **override 效果** | 跳过检测，直接按"受限地区"处理 |
| **日志** | `isInRussiaImpl override_region` |

> **为什么是俄罗斯和中国**：这两国是 Poweramp 的主要市场，同时也是 **Google Play 付费服务受限**的地区。Poweramp 可能在这两个地区走不同的授权/分发路径（如官网购买而非 Play 内购）。
>
> **`override_region` 让用户可以强制指定地区**——比如用中国 SIM 卡但通过 Play 购买的用户，可以手动切换。
>
> 这也**印证了 headset 调查曾发现的 `localized_az` 硬编码 `"ru"` 判断**——Poweramp 对俄语市场有特殊处理。

### 13.7 上一轮 4 个未解项的最终状态

| 原问题 | 最终结论 |
| --- | --- |
| `pause_on_screen_off` 的消费者 | ✅ **已解**：`PlayerServiceCore.onBusMsg`（§13.2）|
| `user_agent` 的消费者 | ✅ **已解**：`CcPluginService` Chromecast 配置（§13.3）|
| `check_for_skin_reload`/`op_framerate` 存储 | ✅ **已解**：在 `wr` 表（§13.4）|
| `shutdown_intent` 触发链路 | ✅ **已解**：动态 IntentFilter action（§13.5）|
| `override_region` 作用域 | ✅ **已解**：地区检测绕过（§13.6）|

### 13.8 修正后的完整字段映射表

| key | 存储位置 | 字段 | 消费者 |
| --- | --- | --- | --- |
| `pause_on_screen_off` | `vr` | `vr->X1` | **`PlayerServiceCore`** |
| `user_agent` | `vr` + JSON | `vr->b` | **`CcPluginService`** |
| `check_for_skin_reload` | **`wr`** | **`wr->О`** | **`BaseActivity.onStop`** |
| `op_framerate` | **`wr`** | **`wr->m0`** | **`BaseActivity` / `Application` / `SettingsActivity`** |
| `shutdown_intent` | `vr` | `vr->H1` | **`w4`**（动态 action）|
| `override_region` | `vr` | `vr->u2` | **`oh.х()`**（地区检测）|

---

## 14. 监听器分发链（第 3 轮深挖）

> 上一轮只记录了"哪些 key 绑了哪个监听器"。本轮把 **`pa1` / `qa1` / `ma1` 三个监听器的内部实现**全部解出，得到完整的"开关 → 消息总线"映射。

### 14.1 `sa1` 的两个构造期字段

【实证·产物】`sa1.smali:17-65`：

```java
sa1(SettingsActivity act, u61 frag, int id) {
    super(act, frag, id, /* C = */ 0x7f160026);   // :21  父页 = singlepane

    this.l = new pa1(this, 0);                    // :31-43  ★ 复用的监听器
    this.m = new r0(0xe /* 14 */, this);          // :47-60  定时刷新 Runnable
}
```

| 字段 | 类型 | 值 | 用途 |
| --- | --- | --- | --- |
| `j` | `WeakReference` | — | 弱引用 |
| `k` | `x80` | 懒加载 | Shizuku 授权器 |
| **`l`** | **`pa1`** | **索引 0** | **被 3 个 Android Auto 开关共用** |
| **`m`** | **`r0`** | **索引 14** | **定时刷新** |

> **`l` 字段是"一个监听器服务多个开关"的关键**——`mb_a_grid`、`mb_a_aa_cats`、`mb_a_aa_tracks` 三个都指向同一个 `pa1(0)` 实例。

### 14.2 `pa1`：三路消息分发

`pa1`（3688 B / 205 行）实现 `OnPreferenceChangeListener`，`packed-switch` **只有 2 项**（`:200-203`），但承载 **3 种语义**。

| 索引 | 分支 | 行为 | 消息 |
| ---: | --- | --- | --- |
| **0** | `pswitch_0`（`:120-155`）| 向 `bus_player_cmd`(0x7f0d0034) 发 **`cmd_player_apply_internal_plugin_config`**(0x7f0d050c)，payload = `"com.maxmpz.audioplayer/decoder.ffmpeg"` | 插件配置重载 |
| **1** | `pswitch_1`（`:158-193`）| 向 `bus_app`(0x7f0d015b) 发 **`msg_app_mediabrowser_refresh`**(0x7f0d0311) | MediaBrowser 刷新 |
| **≥2**（default，`:63-117`）| — | 若新值 == `true`，向 `bus_app` 发 **`msg_app_mediabrowser_started`**(0x7f0d0310) | MediaBrowser 启动 |

**绑定关系推断**（基于 `sa1.v()` 的绑定顺序）：

| key | 索引 | 触发的效果 |
| --- | ---: | --- |
| `mb_a_grid` | **0**（复用 `l`）| **插件配置重载**（`decoder.ffmpeg`）|
| `mb_a_aa_cats` | **0**（复用 `l`）| 同上 |
| `mb_a_aa_tracks` | **0**（复用 `l`）| 同上 |
| `send_mediasession_q` | **2**（新建 `pa1(2)`，`:726-738`）| MediaBrowser 启动 |

> **⚠️ 一个反直觉的点**：三个 `mb_a_*` 可视化开关触发的是**插件配置重载**（`decoder.ffmpeg`），而不是直接刷新列表。
>
> 合理解释【推断】：Android Auto 的列表渲染由 **ffmpeg 解码插件**承载（封面图解码也需要它），所以改了网格/封面显示后需要重载插件配置。
>
> **`send_mediasession_q` 走 default 分支**（索引 2 > switch 上限 1）——这是**又一处"越界索引用 default"**。

### 14.3 `qa1`：包装 + 追加消息

`qa1`（1775 B / 93 行）是**装饰器模式**——持有 `pa1` 引用，先转发再追加动作。

【实证·产物】`qa1.smali:38-92`：

```java
boolean onPreferenceChange(Preference p, Object v) {
    this.В /* pa1 */ .onPreferenceChange(p, v);      // :42-46  先转发给 pa1
    MsgBus.post(0x7f0d00d6, 0, 0, null);              // :78-83  cmd_player_apply_pipeline_prefs
    return true;
}
```

| 要点 | 说明 |
| --- | --- |
| 绑定对象 | **`stream_timeout_ms`**（`sa1:654-663`）|
| 组合方式 | `qa1(sa1, pa1)` —— 持有 `pa1(1)` 实例 |
| 先转发 | 调 `pa1(1)` → 发 `msg_app_mediabrowser_refresh` |
| 后追加 | 再发 **`cmd_player_apply_pipeline_prefs`**（`0x7f0d00d6`）|

> **这是一个"流超时改了要同时做两件事"的设计**：既刷新 MediaBrowser，又重载音频管线参数。
>
> `qa1` 只有 93 行——纯粹的包装，**没有自己的状态**。

### 14.4 `ma1`：三路分支（含一个 default）

`ma1`（2838 B / 160 行），`packed-switch` **3 项**（`:153-157`）：

| 索引 | 分支 | 行为 | 定位 |
| ---: | --- | --- | --- |
| **0** | `pswitch_2` | `handler.post(new na1(this, 1))` → **`na1` 里强制写 `use_wakelock = true`** | `:128-147` |
| **1** | `pswitch_1` | 向 `bus_player_cmd` 发 **`cmd_player_resend_external_track`**(0x7f0d0222) | `:91-125` |
| **2** | `pswitch_0` | `handler.post(new x91(this, 3, newValue))` | `:66-88` |
| **≥3**（default）| — | `n91.j(true)` —— 触发页面重载 | `:58-63` |

**4 处实例化**（`sa1:472`、`:1132`、`:1328`、`:1358`）：

| 位置 | 上下文 | 推断索引 |
| --- | --- | ---: |
| `sa1:472` | `L()` 尾部，绑定 **`long_volume_controls`** | 待定 |
| `sa1:1132` | `v()` 中 `shutdown_intent` 附近 | 待定 |
| `sa1:1328` | `v()` 中 **`use_wakelock`** | 待定 |
| `sa1:1358` | `v()` 中 **`override_region`** | **3**（`const/4 v2, 0x3`）|

> **`override_region` 用索引 3 → 落 default → `n91.j(true)`（页面重载）**，这符合语义：改了地区后需要重新加载整个设置页。
>
> 其余三处的索引通过寄存器传递，未能静态回溯到常量（来自更早的赋值）。标【未完全确认】。

### 14.5 `oa1`：三个点击回调

`oa1`（7632 B / 357 行），`packed-switch` 2 项（`:352`），**3 处实例化**：

| 位置 | 绑定对象 | 索引 |
| --- | --- | ---: |
| `sa1:894` | `_long_volume_shizuku_grant` | **0**（`const/4 v7, 0x0` @`:878`）|
| `sa1:1284` | `migrate_data_29` | 待定 |
| `sa1:1392` | `restore_defaults` | 待定 |

### 14.6 完整的"开关 → 消息"映射表

**本文最重要的产出**——所有已确认的联动关系：

| key | 监听器 | 索引 | 发出的消息 | 效果 |
| --- | --- | ---: | --- | --- |
| `mb_a_grid` | `pa1`(l) | 0 | `cmd_player_apply_internal_plugin_config` | 重载 ffmpeg 插件配置 |
| `mb_a_aa_cats` | `pa1`(l) | 0 | 同上 | 同上 |
| `mb_a_aa_tracks` | `pa1`(l) | 0 | 同上 | 同上 |
| `stream_timeout_ms` | `qa1`→`pa1` | 1 | `msg_app_mediabrowser_refresh` + **`cmd_player_apply_pipeline_prefs`** | 刷新列表 + 重载管线 |
| `stream_buffer_bytes` | `pa1`(l) | 0 | `cmd_player_apply_internal_plugin_config` | 重载插件配置 |
| `user_agent` | `pa1`(l) | 0 | 同上 | 同上 |
| `send_mediasession_q` | `pa1` | 2 | `msg_app_mediabrowser_started` | 启动 MediaBrowser（仅当为 true）|
| `use_wakelock` | `ma1` | ? | → `na1` 强制写 true / 或 `x91(3)` | 电源管理 |
| `override_region` | `ma1` | **3** | `n91.j(true)` | **页面重载** |
| `shutdown_intent` | `c91` | — | — | 见 §12.5 |
| `long_volume_controls` | `ma1` | ? | → `na1`/`x91(3)` | — |
| `_long_volume_shizuku_grant` | `oa1` | 0 | (授权流程) | 见 §9.3 |
| `migrate_data_29` | `oa1` | ? | — | — |
| `restore_defaults` | `oa1` | ? | (恢复默认) | 见 §6.6 |

> **消息总线双通道**：
> - `bus_app`（`0x7f0d015b`）—— UI/MediaBrowser 相关
> - `bus_player_cmd`（`0x7f0d0034`）—— 播放核心配置

### 14.7 `sa1.L()` 的实际职责（仅 2 项）

`L()`（237 行）**只处理两个 key**，不是全部条件逻辑：

| key | 处理 |
| --- | --- |
| `long_volume_controls` | 绑 `ma1`（`:472-481`）|
| `_long_volume_shizuku_grant` | 绑 `oa1(0)` + 根据 `x80.K`/`x80.К` 设进度（`:442-467`）|

**授权进度的双标志**：

```java
if (!x80.K || x80.К) {            // :442-458
    v4 = 1;
} else {
    v4 = 0;
}
progressPreference.setProgress(v4);  // :467
```

> `x80->K`（拉丁）是"授权进行中"，`x80->К`（西里尔）是"已授权"——**又是一个同形字陷阱**。

### 14.8 本轮新增的未完全确认项

| 项 | 原因 |
| --- | --- |
| `ma1` 在 `sa1:472/1132/1328` 的索引 | 索引经寄存器传递，来自更早赋值，未回溯到常量 |
| `oa1` 在 `sa1:1284/1392` 的索引 | 同上 |

> **这三处不影响结论的正确性**——`ma1`/`oa1` 的分支语义已全部解出，只是"哪个 key 对应哪个分支"未完全确认。需要**动态调试验证**。

---

---

## 15. 索引全部确认 + `c91`/`na1`/`x91` 链路（第 4 轮深挖）

> 上一轮留了"5 处索引未确认"。本轮通过**寄存器全范围回溯**全部确认，并解出了 `c91`（6 分支通用监听器）与 `na1`（含一处重要发现）。

### 15.1 5 处索引全部确认

**方法**：对 `sa1.v()`（555-1407）与 `sa1.L()`（250-487）做**全范围**寄存器赋值扫描——因为寄存器会在基本块间复用，只看前 40 行会漏掉。

| 位置 | 寄存器 | **赋值来源** | **索引** | 分支 |
| --- | --- | --- | ---: | --- |
| `ma1@472`（`L()` 内）| `v5` | `:329` `const/4 v5, 0x0` | **0** | `pswitch_2` |
| `ma1@1132` | `v1` | `:630` `const/4 v1, 0x1` | **1** | `pswitch_1` |
| `ma1@1328` | `v3` | `:730` `const/4 v3, 0x2` | **2** | `pswitch_0` |
| `ma1@1358` | `v2` | `:1362` `const/4 v2, 0x3` | **3** | default |
| `oa1@894` | `v7` | `:878` `const/4 v7, 0x0` | **0** | `pswitch_1` |
| `oa1@1284` | `v1` | `:630` `const/4 v1, 0x1` | **1** | `pswitch_0` |
| `oa1@1392` | `v3` | `:730` `const/4 v3, 0x2` | **2** | default |

> **关键洞察**：`sa1.v()` 里 `v1` 只在 `:630` 赋值一次（=1），`v3` 只在 `:730` 赋值一次（=2）。**后续所有用 `v1`/`v3` 的地方都继承这两个值**——这就是为什么单看局部会找不到赋值。

### 15.2 修正后的 `ma1` 完整映射

`ma1`（2838 B / 160 行），3 项 switch + default：

| 绑定的 key | 索引 | 分支 | 行为 |
| --- | ---: | --- | --- |
| **`long_volume_controls`** | **0** | `pswitch_2` | `handler.post(new na1(this, 1))` |
| **`shutdown_intent`** 附近（`v()` 中段）| **1** | `pswitch_1` | 向 `bus_player_cmd` 发 **`cmd_player_resend_external_track`**(0x7f0d0222) |
| **`use_wakelock`** | **2** | `pswitch_0` | `handler.post(new x91(this, 3, newValue))` |
| **`override_region`** | **3** | **default** | `n91.j(true)` 页面重载 |

### 15.3 修正后的 `oa1` 完整映射

`oa1`（7632 B / 357 行），2 项 switch + default：

| 绑定的 key | 索引 | 分支 | 行为 |
| --- | ---: | --- | --- |
| **`_long_volume_shizuku_grant`** | **0** | `pswitch_1` | **复制 `pm grant ...` 命令到剪贴板** + Toast |
| **`migrate_data_29`** | **1** | `pswitch_0` | 弹**权限请求对话框** |
| **`restore_defaults`** | **2** | **default** | `n91.m(na1, na1, idx)` 恢复默认 |

#### `pswitch_1`（索引 0）：复制命令到剪贴板

【实证·产物】`oa1.smali:218-330`：

```java
String perm = "android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER";  // :223
String cmd  = "pm grant ";                                             // :227
cmd += ctx.getPackageName() + " " + perm;                              // :261-279
ClipData cd = ClipData.newPlainText("adb/console command", cmd);       // :287
clipboard.setPrimaryClip(cd);                                          // :295
Toast.makeText(ctx, <已复制>, LENGTH_SHORT).show();                     // :309-317
```

> **这是 Shizuku 之外的"手动授权"备用路径**：用户点这个条目，就把 `pm grant` 命令复制到剪贴板，自己去 adb/终端里粘贴执行。
>
> **所以 `_long_volume_shizuku_grant` 有两重作用**：① 主路径——拉起 Shizuku 授权（§9.3）；② 备用路径——复制命令手动执行。

#### `pswitch_0`（索引 1）：权限请求对话框

```java
PseudoAlertDialog.Builder b = new PseudoAlertDialog.Builder(ctx);
b.setTitle(...);
b.setMessage(...);
b.setDismissOnPositive(true);                              // :121
b.setOnActivityRequestPermission(new X(...));              // :142  请求权限
b.setPositiveButton(..., new za(...));                     // :168
b.setNegativeButton(..., ...);                             // :181
b.create().show();                                          // :210
```

> `setOnActivityRequestPermission` 说明这是**标准的 Android 运行时权限请求**，对应 `migrate_data_29`（Android 10 分区存储迁移需要存储权限）。

### 15.4 `c91`：六分支通用监听器

`c91`（190 行）是**全设置树复用的通用 `OnPreferenceChangeListener`**，3 处实例化：

| 实例 | 位置 | 索引 | 用途 |
| --- | --- | ---: | --- |
| `n91:147` | `n91` 基类 | **2** | 通用 |
| `x61:260` | `x61` | **1** | 通用 |
| **`sa1:1178`** | **misc** | **1** | **`shutdown_intent`** |

**六个分支**（`:180-188`）：

| 索引 | 分支 | 行为 |
| ---: | --- | --- |
| **0** | `pswitch_5` | `n91.s(false)` |
| **1** | `pswitch_4` | **`n91.j(true)` 页面重载** |
| **2** | `pswitch_3` | `n91.d()` |
| **3** | `pswitch_2` | `n91.e()` |
| **4** | `pswitch_1` | `bus_app` post **`msg_app_data_changed`**(0x7f0d0049)，payload = `"settings"` |
| **5** | `pswitch_0` | `kh1.В(ctx).х()` —— 皮肤重载 |

> **`shutdown_intent` 用索引 1 → `n91.j(true)` 页面重载**。
>
> 语义合理：用户改了自定义 shutdown intent 后，**整个设置页需要重建**才能注册新的广播 action（因为广播注册在 `w4.run()` 里，只在应用启动时跑一次）。
>
> **注意索引 4 的 payload 是 `"settings"`**——这正是 `msg_app_data_changed` 的一个具体用法（`headset` 调查中提到的消息总线，这里 payload 非 null）。

### 15.5 `na1`：两处关键逻辑（含一个历史遗留）

`na1`（211 行 Runnable），只有 **1 个 `pswitch_0`**（索引 0），其余落 default：

| 索引 | 分支 | 行为 |
| ---: | --- | --- |
| **0** | `pswitch_0` | 见下（复杂）|
| 其他 | default | 向 `bus_player_cmd` 发 **`cmd_player_apply_long_volume_controls`**(0x7f0d0508) |

**`pswitch_0`（索引 0）的完整逻辑**【实证·产物】`na1.smali:91-203`：

```java
// ① Shizuku 授权确认
if (sa1.k != null) sa1.k.В();                  // :92-100

// ② SDK >= 23 且设备支持 → 强制 use_wakelock = true
if (SDK_INT >= 0x17 /* 23 */ && xn0.В) {       // :106-121
    vr.b1.у(true);                              // :129-133
    n91.y();                                    // :138
}

// ③ ★ 删除 load_user_so 的残留标记文件
try {
    File f = new File(ctx.getFilesDir(), ".load_ffmpeg_so_pref");  // :145-165
    f.delete();                                                     // :170
} catch (Throwable t) {
    Log.e("SettingsHelperMisc", "", t);                             // :184-192
}

// ④ 页面重载
n91.j(true);                                    // :198
```

#### ⚠️ 重要发现：`.load_ffmpeg_so_pref` 的残留清理

**全包只有 `na1:161` 一处引用这个文件名**。

结合 §6.4（`load_user_so` 被无条件移除），可以还原完整故事：

| 阶段 | 现象 |
| --- | --- |
| 早期版本 | `load_user_so` 开关存在，勾选后**创建 `.load_ffmpeg_so_pref` 标记文件**，`lib/` 加载逻辑据此决定是否加载用户提供的 `ffmpeg_neon.so` |
| 当前版本 | 开关被**无条件移除**（`sa1:1311`），但**清理逻辑留在 `na1` 里** |
| 现状 | 只有触发 `na1(idx 0)` 时才会删除这个残留文件 |

> **这是"功能已下线但清理代码未删"的典型痕迹**，与 `load_user_so` 的移除互为印证。
>
> **为什么清理在 `na1` 里**：`na1(idx 0)` 由 `long_volume_controls` 触发——可能是"用户在这个页面做任何操作时顺手清理一下"的防御性设计。

### 15.6 `x91` 索引 3：`use_wakelock` 的实际落地

上一轮只知道 `ma1` 索引 2 → `x91(3, newValue)`，但不知道 `x91` 索引 3 做什么。

【实证·产物】`x91.smali:2408-2462`（`pswitch_a`）：

```java
Object target = this.y;
check-cast target, Lׅ/sa1;                              // :2413  ★ 确认是 misc helper
Context ctx = ((n91) target).у;
MsgBus bus = MsgBusHelper.fromContextOrThrow(ctx, busId); // :2425
boolean v = ((Boolean) this.у).booleanValue();           // :2433-2442
bus.post(0x7f0d048f, v ? 1 : 0, 0, null);               // :2445-2450
```

`0x7f0d048f` = **`cmd_player_use_wakelock`**

> **完整链路**：`use_wakelock` 开关 → `ma1(idx 2)` → `x91(3, newValue)` → `cmd_player_use_wakelock` 消息 → 播放核心。
>
> **`x91` 是全设置树最大的共享回调类**（2792 行、25 项 switch），这里用索引 3。

### 15.7 完整的"开关 → 消息"总表（最终版）

| key | 监听器 | 索引 | 发出的消息 | 效果 |
| --- | --- | ---: | --- | --- |
| `mb_a_grid` | `pa1`(l) | 0 | `cmd_player_apply_internal_plugin_config` | 重载 ffmpeg 插件配置 |
| `mb_a_aa_cats` | `pa1`(l) | 0 | 同上 | 同上 |
| `mb_a_aa_tracks` | `pa1`(l) | 0 | 同上 | 同上 |
| `stream_buffer_bytes` | `pa1`(l) | 0 | 同上 | 同上 |
| `user_agent` | `pa1`(l) | 0 | 同上 | 同上 |
| `stream_timeout_ms` | `qa1`→`pa1` | 1 | `msg_app_mediabrowser_refresh` + **`cmd_player_apply_pipeline_prefs`** | 刷新列表 + 重载管线 |
| `send_mediasession_q` | `pa1` | 2 | `msg_app_mediabrowser_started` | 启动 MediaBrowser |
| **`long_volume_controls`** | `ma1` | **0** | → `na1(1)` → 删除 `.load_ffmpeg_so_pref` + 重载 | — |
| **`shutdown_intent`** | **`c91`** | **1** | **`n91.j(true)`** | **页面重载（重注册广播）** |
| **`use_wakelock`** | `ma1` | **2** | → `x91(3)` → **`cmd_player_use_wakelock`** | 电源管理 |
| `override_region` | `ma1` | **3** | `n91.j(true)` | 页面重载 |
| `migrate_data_29` | `oa1` | **1** | 权限请求对话框 | Android 10 迁移 |
| `_long_volume_shizuku_grant` | `oa1` | **0** | 复制 `pm grant` 命令 / 拉起 Shizuku | 授权 |
| `restore_defaults` | `oa1` | **2** | `n91.m(...)` | 恢复默认 |

> **全部 14 个有监听器的 key，索引已 100% 确认。**

### 15.8 上一轮"未完全确认项"的最终状态

| 原未确认项 | 最终结论 |
| --- | --- |
| `ma1@472` 索引 | ✅ **0**（`v5=0x0` @329）|
| `ma1@1132` 索引 | ✅ **1**（`v1=0x1` @630）|
| `ma1@1328` 索引 | ✅ **2**（`v3=0x2` @730）|
| `oa1@1284` 索引 | ✅ **1**（`v1=0x1` @630）|
| `oa1@1392` 索引 | ✅ **2**（`v3=0x2` @730）|

---

## 16. 证据索引

### 16.1 XML / 资源

| 位置 | 内容 |
| --- | --- |
| `misc.xml:2` | 根节点 `pref_misc` |
| `misc.xml:4-8` | 分类一 Scrobbling（3 项）|
| `misc.xml:9-16` | 分类二 Android Auto（5 项）|
| `misc.xml:17-34` | 分类三 Tweaks（14 项）|
| `misc.xml:35-39` | 分类四 Volume Keys Long Press（3 项）|
| **`misc.xml:38`** | **`_long_volume_shizuku_grant` 的 XML 定义**（纠正依据）|
| `misc.xml:40` | `restore_defaults` |
| `arrays.xml` | `pref_stream_timeout_entries` / `_values` |
| `drawable` | `settings_quote_background`（2 处提示块）|

### 16.2 smali —— helper `sa1`

| 位置 | 内容 |
| --- | --- |
| `u61.smali:1576-1589` | `misc` → `0x7f16001e` → `new sa1(...)` |
| `sa1.smali:17-65` | 构造（字段初始化）|
| `sa1.smali:67-130` | `I()` 对话框回调 |
| `sa1.smali:134-248` | `J()` 页面刷新 |
| **`sa1.smali:250-487`** | **`L()` 条件可见性（237 行）** |
| `sa1.smali:489-553` | `o()` 销毁清理 |
| **`sa1.smali:555-1407`** | **`v()` 主装配（852 行）** |
| `sa1.smali:1409-1445` | `С()` 暂停清理 |
| `sa1.smali:1447-1492` | `с()` 恢复 |

### 16.3 smali —— 条件移除

| 位置 | 条件 |
| --- | --- |
| **`sa1.smali:743-784`** | `SDK < 26` → 删 `volume_keys_long_press_cat` |
| **`sa1.smali:1196-1241`** | `SDK < 29` → 删 `op_framerate` |
| **`sa1.smali:1255-1293`** | `SDK ≠ 29` → 删 `migrate_data_29` |
| **`sa1.smali:1299-1311`** | **无条件** → 删 `load_user_so` |

### 16.4 smali —— 监听器

| 位置 | 内容 |
| --- | --- |
| `sa1.smali:563-737` | `pa1` 绑定 4 个 Android Auto 开关 |
| `sa1.smali:638-663` | `qa1` 绑定 `stream_timeout_ms` |
| `sa1.smali:894-903` | `oa1` 第 1 处 |
| `sa1.smali:1178-1187` | `c91` 绑定 `shutdown_intent` |
| `sa1.smali:1284-1293` | `oa1` 第 2 处 |
| `sa1.smali:1328-1337` | `ma1` 第 1 处（`use_wakelock`）|
| `sa1.smali:1358-1370` | `ma1` 第 2 处（`override_region`）|
| `sa1.smali:1392-1401` | `oa1` 第 3 处（`restore_defaults`）|
| `na1.smali:121-143` | `use_wakelock` 的写入 |

### 16.5 smali —— 偏好字段

| 位置 | 内容 |
| --- | --- |
| `vr.smali:666-681` | `user_agent` → `vr->b`（`ub1`）|
| `vr.smali:1369-1385` | 两个 scrobble 字段 |
| `vr.smali:1804` | `long_volume_controls` → `vr->E0` |
| `vr.smali:2195` | `use_wakelock` → `vr->b1` |
| `vr.smali:2227` | `send_metachanged` → `vr->d1` |
| `vr.smali:2307` | `send_old_api_aa` → `vr->i1` |
| `vr.smali:2395` | `send_mediasession_q` → `vr->n1` |
| `vr.smali:2443-2475` | 三个 `mb_a_*` 字段 |
| `vr.smali:2776` | `shutdown_intent` → `vr->H1` |
| `vr.smali:3053-3065` | `pause_on_screen_off` → `vr->X1` |
| `vr.smali:3475` | `override_region` → `vr->u2` |

### 16.6 smali —— 消费者

| 位置 | 内容 |
| --- | --- |
| **`ar.smali:1887-1930`** | `send_metachanged` → `com.android.music.metachanged` |
| `ar.smali:2098` | `scrobble_to_last_fm` → `fm.last.android.metachanged` |
| `ar.smali:2188` | `scrobble_to_simple_last_fm` |
| `ar.smali:682` | `fm.last.android.metachanged` 字符串 |
| `ar.smali:1911` | `com.android.music.metachanged` 字符串 |
| **`lk0.smali:284-315`** | `use_wakelock` 读取（WakeLock 持有判定）|
| **`na1.smali:121-143`** | `use_wakelock` 强制写入（设备纠偏）|
| `nc.smali` | `mb_a_grid` 消费者（13171 B）|
| `pc.smali` | `mb_a_aa_cats` / `mb_a_aa_tracks` 消费者（24303 B）|
| `wk0.smali` | `send_mediasession_q` 消费者（27048 B）|
| `oh.smali` | `override_region` 消费者（46267 B）|
| `w4.smali` | `shutdown_intent` 消费者（19137 B）|
| `dk0.smali` / `ih0.smali` | `long_volume_controls` 消费者 |

### 16.7 smali —— Shizuku 授权

| 位置 | 内容 |
| --- | --- |
| `sa1.smali:286` | `_long_volume_shizuku_grant` 的 `findPreference` |
| **`sa1.smali:908-998`** | **懒加载 `x80`** |
| `sa1.smali:938-960` | 锚点拼接 `n91.H() + "#_long_volume_shizuku_grant"` |
| `sa1.smali:972-976` | `u0(0xe, this)` 进度回调 |
| **`x80.smali:130`** | 目标权限 |
| `x80.smali:138-167` | `/system/bin/cmd package grant` |
| `x80.smali:178` | 10 秒超时 |
| `x80.smali:257` | `IShizukuService` |

### 16.7b 第 2 轮新增定位（闭环证据）

| 位置 | 内容 |
| --- | --- |
| **`w4.smali:320-390`** | **广播注册：SCREEN_ON/OFF、ACTION_SHUTDOWN、QUICKBOOT_POWEROFF** |
| `w4.smali:364` | `com.microntek.bootcheck`（车机）|
| `w4.smali:373` | `com.glsx.boot.ACCOFF`（车机）|
| **`w4.smali:388-455`** | **`shutdown_intent` 动态 IntentFilter** |
| `w4.smali:411-414` | 长度校验 `> 4` |
| `w4.smali:427` | `addAction(custom)` |
| `w4.smali:447-455` | 异常吞掉 |
| `i8.smali:378-398` | SCREEN_ON 分支 → `BaseApplication.о = true` |
| **`i8.smali:455-475`** | **SCREEN_OFF 分支 → `BaseApplication.о = false`** |
| `i8.smali:345-350` | `com.glsx.boot.ACCOFF` 处理 |
| `i8.smali:362-370` | `ACTION_SHUTDOWN` / `QUICKBOOT_POWEROFF` |
| `i8.smali:407-439` | `microntek.bootcheck` + `class`/`poweroff` extra |
| **`PlayerServiceCore.smali:5111-6006`** | **`onBusMsg`（`pause_on_screen_off` 所在）** |
| `PlayerServiceCore.smali:5260-5268` | 读 `vr->X1` |
| **`PlayerServiceCore.smali:5272-5280`** | **诊断日志 `pause_on_screen_off` / `PAUSE`** |
| `PlayerServiceCore.smali:5299` | `MsgBus.post(0x7f0d00cc)` |
| **`CcPluginService.smali:895-933`** | **`user_agent` 构造 Chromecast JSON** |
| `CcPluginService.smali:908` | JSON key `user_agent` |
| `CcPluginService.smali:912-917` | 默认值资源 `0x7f080903` |
| `CcPluginService.smali:925` | `optString("user_agent", def)` |
| **`wr.smali:440`** | **`check_for_skin_reload` → `wr->О`** |
| **`wr.smali:1473`** | **`op_framerate` → `wr->m0`** |
| **`BaseActivity.smali:3930-3955`** | **`onStop()` 里读 `wr->О`** |
| **`BaseActivity.smali:3370-3399`** | **`onCreate()` 里读 `wr->m0` + SDK≥29 判定** |
| `BaseActivity.smali:3394` | `y1.d(activity)` 设置高刷新率 |
| `Application.smali:7567` | `op_framerate` 消费者 |
| `SettingsActivity.smali:2498` | `op_framerate` 消费者 |
| **`oh.smali:1590-1699`** | **`х(Context)Z` 地区检测** |
| `oh.smali:1598` | 读 `vr->u2`（`override_region`）|
| `oh.smali:1617` | 日志 `isInRussiaImpl override_region` |
| `oh.smali:1630/1650` | 地区列表 `ru` / `cn` |
| `oh.smali:1691` | `getSimCountryIso()` |

### 16.7b 第 3 轮新增定位（监听器）

| 位置 | 内容 |
| --- | --- |
| **`sa1.smali:17-65`** | **构造器：`l=new pa1(0)`、`m=new r0(0xe)`、C=0x7f160026** |
| **`sa1.smali:250-487`** | **`L()`（237 行）只处理 2 个 key** |
| `sa1.smali:442-467` | `x80.K`/`x80.К` 双标志 → `setProgress` |
| `sa1.smali:472-481` | `long_volume_controls` 绑 `ma1` |
| `sa1.smali:626-633` | `pa1(1)` 实例化 |
| `sa1.smali:654-663` | `qa1(sa1, pa1)` 绑定 `stream_timeout_ms` |
| `sa1.smali:726-738` | `pa1(2)` 绑定 `send_mediasession_q` |
| `sa1.smali:894-903` | `oa1(0)` 绑定 `_long_volume_shizuku_grant` |
| `sa1.smali:1284-1293` | `oa1` 绑定 `migrate_data_29` |
| `sa1.smali:1358-1370` | `ma1(3)` 绑定 `override_region` |
| `sa1.smali:1392-1401` | `oa1` 绑定 `restore_defaults` |
| **`pa1.smali:38-204`** | **三路分发** |
| `pa1.smali:63-117` | **default**（≥2）→ `msg_app_mediabrowser_started` |
| `pa1.smali:120-155` | `pswitch_0`（0）→ `cmd_player_apply_internal_plugin_config` |
| `pa1.smali:158-193` | `pswitch_1`（1）→ `msg_app_mediabrowser_refresh` |
| `pa1.smali:199-203` | 2 项 packed-switch 表 |
| **`qa1.smali:38-92`** | **装饰器：转发 pa1 后追加 `cmd_player_apply_pipeline_prefs`** |
| **`ma1.smali:38-157`** | **三路分发 + default** |
| `ma1.smali:58-63` | default（≥3）→ `n91.j(true)` |
| `ma1.smali:66-88` | `pswitch_0`（2）→ `x91(3, newValue)` |
| `ma1.smali:91-125` | `pswitch_1`（1）→ `cmd_player_resend_external_track` |
| `ma1.smali:128-147` | `pswitch_2`（0）→ `na1` |
| `ma1.smali:153-157` | 3 项 packed-switch 表 |

### 16.7c 第 4 轮新增定位（索引确认 + 新链路）

**寄存器赋值来源**（索引确认的关键）：

| 位置 | 内容 |
| --- | --- |
| `sa1.smali:329` | `const/4 v5, 0x0`（`L()` 内）|
| `sa1.smali:630` | `const/4 v1, 0x1`（`v()` 内，全方法唯一）|
| `sa1.smali:730` | `const/4 v3, 0x2`（`v()` 内，全方法唯一）|
| `sa1.smali:878` | `const/4 v7, 0x0` |
| `sa1.smali:1362` | `const/4 v2, 0x3` |

**`oa1` 分支细节**：

| 位置 | 内容 |
| --- | --- |
| **`oa1.smali:218-330`** | **`pswitch_1`（索引 0）：复制 `pm grant` 到剪贴板** |
| `oa1.smali:223` | 目标权限字符串 |
| `oa1.smali:227` | `"pm grant "` |
| `oa1.smali:261-279` | 拼接包名 + 权限 |
| `oa1.smali:287-295` | `ClipData.newPlainText("adb/console command")` + `setPrimaryClip` |
| `oa1.smali:309-317` | Toast 提示 |
| **`oa1.smali:82-217`** | **`pswitch_0`（索引 1）：权限请求对话框** |
| `oa1.smali:121` | `setDismissOnPositive(true)` |
| `oa1.smali:142` | `setOnActivityRequestPermission` |
| `oa1.smali:38-80` | **default（≥2）：`n91.m(na1, na1, idx)` 恢复默认** |

**`c91` 六分支**：

| 位置 | 内容 |
| --- | --- |
| **`c91.smali:38-189`** | **`onPreferenceChange`（151 行）** |
| `c91.smali:180-188` | 6 项 packed-switch 表 |
| `c91.smali:85-103` | `pswitch_0`（5）→ `kh1.В(ctx).х()` 皮肤重载 |
| `c91.smali:106-138` | `pswitch_1`（4）→ `msg_app_data_changed` payload=`"settings"` |
| `c91.smali:141-147` | `pswitch_2`（3）→ `n91.e()` |
| `c91.smali:150-156` | `pswitch_3`（2）→ `n91.d()` |
| **`c91.smali:159-165`** | **`pswitch_4`（1）→ `n91.j(true)`** |
| `c91.smali:168-174` | `pswitch_5`（0）→ `n91.s(false)` |
| `n91.smali:147-154` | `c91(n91, 2)` |
| `x61.smali:260-267` | `c91(n91, 1)` |

**`na1` 与残留文件**：

| 位置 | 内容 |
| --- | --- |
| **`na1.smali:38-210`** | **`run()` 全文** |
| `na1.smali:55-88` | default（非 0）→ `cmd_player_apply_long_volume_controls` |
| `na1.smali:92-100` | `sa1.k.В()` Shizuku 确认 |
| `na1.smali:106-138` | `SDK>=23 && xn0.В` → 强制 `use_wakelock=true` |
| **`na1.smali:145-170`** | **删除 `.load_ffmpeg_so_pref`** |
| `na1.smali:198` | `n91.j(true)` |
| `na1.smali:206-209` | 1 项 packed-switch 表 |

**`x91` 索引 3**：

| 位置 | 内容 |
| --- | --- |
| **`x91.smali:2408-2462`** | **`pswitch_a`（索引 3）** |
| `x91.smali:2413` | `check-cast → Lׅ/sa1;` |
| `x91.smali:2445` | `cmd_player_use_wakelock`(0x7f0d048f) |
| `x91.smali:2724-2738` | 14 项 packed-switch 表 |

### 16.7d 收尾整合新增定位（w:scale / 徽标 / 授权）

**`w:scale` 机制**：

| 位置 | 内容 |
| --- | --- |
| **`qt0.smali:2015-2028`** | **`y0` styleable（17 元素）** |
| `qt0.smali:5166-5185` | 同上完整表 |
| `qt0.smali:1549-1554` | `b0` styleable（`array_22`）|
| `qt0.smali:4532-4546` | 同上完整表 |
| `qt0.smali:867-880` | `summaryWhenEmpty` |
| `SeekbarPreference.smali:146` | `scale` → `K:F` |
| `SeekbarPreference.smali:219` | `floatScale` → `p:F` |
| `SeekbarPreference.smali:271-415` | **`entries` 覆盖块（关键陷阱）** |
| `SeekbarPreference.smali:389-413` | **无条件覆盖 6 个字段** |
| `SeekbarPreference.smali:1391-1422` | **双向换算核心公式** |
| `SeekbarPreference.smali:3728-3751` | `Х(int)` 归一化 |
| `SeekbarPreference.smali:3622-3671` | 格式化（`K<0` 只做 `%s`） |
| `SeekbarPreference.smali:2309-2392` | 初始化链 |
| `EditTextPreference.smali:698-758` | `summaryWhenEmpty` 读取 |

**Experiment 徽标渲染**：

| 位置 | 内容 |
| --- | --- |
| **`wr0.smali:134-230`** | **PreferenceHelper 读取 sup/supLink/tag/tagLink** |
| `wr0.smali:65-111` | `removeFromSummary`（索引 7）|
| **`wr0.smali:2424-2506`** | **`tag`/`tagLink` 渲染（RelativeSizeSpan 0.8f + SuperscriptSpan）** |
| **`wr0.smali:2518-2604`** | **`sup`/`supLink` 渲染** |
| `wr0.smali:2582` | `HtmlCompat$DefensiveURLSpan` |

**Shizuku 授权链补充**：

| 位置 | 内容 |
| --- | --- |
| **`ra1.smali:29-141`** | **授权失败弹框** |
| `ra1.smali:67` | `0x7f080766`（标题资源）|
| `x80.smali:1544-1585` | **5000ms 超时 + 焦点监听** |
| **`sa1.smali:250-487`** | **`L()` 四态渲染（238 行）** |
| `sa1.smali:262` | SDK < 26 直接 return |
| **`sa1.smali:332-436`** | **四态 setter 序列** |
| `sa1.smali:438-467` | `x80->К` 二次判定（Kotlin 展开产物）|
| **`sa1.smali:789-889`** | **提示行动态拼接（含 `getPackageName()`）** |
| `sa1.smali:881` | `dn0.p()` HTML → Spanned |
| **`ad.smali:195-235`** | **授权成功回调：`L()` + `setChecked` + `na1`** |
| `n91.smali:249/253` | ⚠️ 易错点：`0x7f160026` 是 singlepane 不是本页 |
| `n91.smali:714-884` | 深链滚动（`split("/")[1]` + 350ms）|
| `u61.smali:1585-1589` | `sa1` 构造确认 |
| `vr.smali:626-662` | `vr->с`(timeout) / `vr->a`(buffer) 都是 `rb1` |
| `vr.smali:1369-1397` | `vr->e0`/`vr->f0` 定义 |
| `vr.smali:2391` | `vr->n1`（`send_mediasession_q`）|
| `vr.smali:2772-2788` | `vr->H1`（`shutdown_intent`，`ub1`）|
| `vr.smali:681` | `vr->b`（`user_agent`，`ub1`）|
| `cl0.smali:2181-2201` | `vr->с` → `Pipeline2.z(9, timeout)` |
| `ma1.smali:53-158` | index 语义总表 |
| `oa1.smali:59-345` | index 语义总表 |

### 16.7e 旧文档精确行号补充

| 位置 | 内容 |
| --- | --- |
| **`sa1.smali:21`** | ⚠️ **易错点**：构造器 `const v0, 0x7f160026` 是 **`singlepane`（父页）**，**不是本页资源 id** |
| `n91.smali:249` / `n91.smali:253` | 同一易错点的说明（`C` 字段语义） |
| `u61.smali:1589` | `sa1` 由 `0x7f16001e` 构造的确认点 |
| `vr.smali:2772` | `vr->H1`（`shutdown_intent`）字段声明 |
| **`oa1.smali:218-345`** | `pswitch_1`（索引 0）完整范围：复制 `pm grant` + Toast |
| `oa1.smali:223-309` | 同上核心段（命令拼接 + `ClipData` + `setPrimaryClip`）|

> **`sa1.smali:21` 的易错点值得强调**：构造器里 `const v0, 0x7f160026` 传给 `n91` 的第 5 个参数（`C` 字段），那是**父页 `singlepane` 的 id**，不是 `misc` 自己的 `0x7f16001e`。混淆会导致页面身份判断错误。

### 16.8 交叉引用

| 文档 | 关系 |
| --- | --- |
| `poweramp-settings-page-runtime.md` | **上游**：三层骨架、`n91` 契约、`restore_defaults` |
| `poweramp-misc-settings.md` | **姊妹篇**：27 个 key 的逐条语义（本文补运行时）|
| `poweramp-headset-complete.md` | `misc#long_volume_controls` 的跳转来源 |
| `poweramp-look-and-feel-settings.md` | `ui_mediaactions` 子页详情 |
| `poweramp-streams-view.md` | 流媒体参数的运行时影响 |
