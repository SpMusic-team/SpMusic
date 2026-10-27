# Poweramp「设置 → 音频」偏好结构完整逆向

**证据级别**：全部来自 apktool 解码的 `<PreferenceScreen>` XML 原文 + `strings.xml` 标签实证。
**这是 Poweramp 音频设置页的权威结构来源** —— 比反编译 Java 更可靠，因为偏好页面本质由 XML 定义。

| 项 | 值 |
| --- | --- |
| 目标 | `com.maxmpz.audioplayer` build-1025-uni (1025009) |
| APK SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 解码工具 | apktool 3.0.3 + 内置 JDK（`vendor/jdk`） |
| 解码产物 | `D:\SpMusic\.rea-analysis\decoded\res\xml\` |
| 采集 | 2026-10-27 |

---

## 0. 结构总览

「设置 → Audio」是一个 **10 个 XML 文件** 组成的偏好树：

```
audio.xml  ← 根页面（title = "Audio"）
├─ audio_info        → 跳转 AudioInfoActivity（Intent）
├─ fade              → fade.xml（淡入淡出/无缝，非本文范围）
├─ rg                → rg.xml（ReplayGain，非本文范围）
├─ audio_focus.xml   ← 音频焦点
├─ audio_equ.xml     ← 均衡器
├─ audio_resampler.xml ← 重采样器
├─ audio_dvc.xml     ← 直接音量控制
├─ audio_outputs.xml ← 输出插件**列表**
│    └─ audio_output.xml      ← 单个插件的配置
│         └─ audio_output_device_opts.xml ← **设备级**选项
├─ audio_tweaks.xml  ← 高级调整
└─ audio_platform_log.xml ← 输出探测日志（空壳，运行时填充）
```

**关键架构发现**：输出配置是**三层嵌套**，而非扁平。

---

## 1. 根页面 `audio.xml`（8 个入口）

```xml
<PreferenceScreen android:title="@string/pref_audio_engine">   <!-- = "Audio" -->
    <PreferenceScreen title="@string/audio_info" key="audio_info">
        <intent targetClass="com.maxmpz.audioplayer.dialogs.AudioInfoActivity" />
    </PreferenceScreen>
    <RedirectPreference title="@string/pref_fade_and_gapless"     key="fade"          target="fade" />
    <RedirectPreference title="@string/pref_replay_gain"          key="rg"            target="rg" />
    <RedirectPreference title="@string/pref_audio_focus"          key="audio_focus"   target="audio_focus" />
    <RedirectPreference title="@string/equalizer"                                     target="audio_equ" />
    <RedirectPreference title="@string/pref_resampler"            key="audio_resampler" target="audio_resampler" />
    <RedirectPreference title="@string/pref_direct_volume_control" key="audio_dvc"    target="audio_dvc" />
    <RedirectPreference title="@string/pref_audio_output"         key="audio_outputs" target="audio_outputs" />
    <RedirectPreference title="@string/pref_advanced_tweaks"      key="audio_tweaks"  target="audio_tweaks" />
</PreferenceScreen>
```

| 顺序 | key | 标签 | 目标 |
| --- | --- | --- | --- |
| 1 | `audio_info` | Audio Info | `AudioInfoActivity`（**Intent，非偏好页**） |
| 2 | `fade` | Fade and Gapless | `fade.xml` |
| 3 | `rg` | Replay Gain | `rg.xml` |
| 4 | `audio_focus` | Audio Focus | `audio_focus.xml` |
| 5 | — | Equalizer | `audio_equ.xml` |
| 6 | `audio_resampler` | Resampler | `audio_resampler.xml` |
| 7 | `audio_dvc` | Direct Volume Control (DVC) | `audio_dvc.xml` |
| 8 | `audio_outputs` | Output | `audio_outputs.xml` |
| 9 | `audio_tweaks` | Advanced Tweaks | `audio_tweaks.xml` |

**设计要点**：`RedirectPreference` 是 Poweramp 自定义控件，用 `z:target`/`w:target` 指向另一个偏好页面 —— 即**自定义的页面跳转机制**，可带参数（见 §4）。

---

## 2. 输出：三层结构

### 2.1 第一层 `audio_outputs.xml` —— 插件列表

```xml
<PreferenceScreen title="@string/pref_audio_output"
    w:searchIndexer="...SettingsHelperAudioOutputs$SearchIndexer"
    w:searchBreadcrumb1="@string/pref_audio_engine">
    <PreferenceCategory title="@string/pref_output_plugins" key="output_plugins_list" />  <!-- 动态填充 -->
    <RawTextPreference key="output_unassigned_text" />                                    <!-- 未分配提示 -->
    <Preference title="@string/pref_restore_defaults" key="restore_defaults" />
</PreferenceScreen>
```

`output_plugins_list` 是**空 `PreferenceCategory`**，运行时由代码填入已安装的输出插件。
⇒ **插件是数据驱动的，不是硬编码**。这解释了为何有 `output.aa` / `output.at` / `output.athd` / `output.osl` / `output.cc` 五个后端 —— 它们都是"插件"，可被用户启用/禁用/分配。

### 2.2 第二层 `audio_output.xml` —— 单插件配置

```xml
<PreferenceScreen w:searchIndexer="...SettingsHelperAudioOutput$SearchIndexer">
    <RawTextPreference key="output_info" />                       <!-- 插件信息，动态 -->
    <PreferenceCategory title="@string/pref_use_for_output_devices" key="output_devices">
        <SwitchConfigPreference title="@string/device_headset"    key="output_headset"    persistent="false" />
        <SwitchConfigPreference title="@string/device_speaker"    key="output_speaker"    persistent="false" />
        <SwitchConfigPreference title="@string/device_bt"         key="output_bt"         persistent="false" />
        <SwitchConfigPreference title="@string/device_usb"        key="output_usb"        persistent="false" />
        <SwitchConfigPreference title="@string/device_chromecast" key="output_chromecast" persistent="false" />
        <SwitchConfigPreference title="@string/device_other"      key="output_other"      persistent="false" />
    </PreferenceCategory>
    <Preference title="@string/pref_restore_defaults" key="restore_defaults" />
</PreferenceScreen>
```

**6 类输出设备**（这是 Poweramp 的设备抽象）：

| key | 标签 | 说明 |
| --- | --- | --- |
| `output_headset` | Headset | 有线耳机 |
| `output_speaker` | Speaker | 扬声器 |
| `output_bt` | Bluetooth | 蓝牙 |
| `output_usb` | USB | USB DAC |
| `output_chromecast` | Chromecast | 投屏 |
| `output_other` | Other | 其它 |

`SwitchConfigPreference` + `persistent="false"` ⇒ **每个插件 × 每个设备的组合单独持久化**（由代码管理，非 Android 默认 SharedPreferences 机制）。

### 2.3 第三层 `audio_output_device_opts.xml` —— **设备级选项（核心）**

这是独占输出的实际开关所在：

```xml
<PreferenceScreen w:searchIndexer="...SettingsHelperAudioOutputDeviceOpts$SearchIndexer">

    <SwitchStringPreference key="output_switch" summary="@string/enable" skipSearch="true" />

    <NumberListPreference title="@string/pref_sample_rate"  key="sample_rate"  />
    <Preference           key="sample_rate_static" skipSearch="true" />          <!-- 只读显示 -->

    <NumberListPreference title="@string/sample_format"     key="sample_fmt"   />
    <Preference           key="sample_bits_static" skipSearch="true" />          <!-- 只读显示 -->

    <RawTextPreference key="pref_ar_format_changes_when_playing" />
    <RawTextPreference key="pref_sr_format_effects_override_hint" icon="@drawable/exclamation_circle_48dp" />

    <MultilineSwitchPreference title="@string/pref_output_float"            key="float" />
    <RawTextPreference         key="pref_hi_res_no_dvc_hint" icon="@drawable/exclamation_circle_48dp" />

    <MultilineSwitchPreference title="@string/pref_output_disable_dvc"      key="no_dvc" />
    <RawTextPreference         key="bt_dvc_msg" />
    <MultilineSwitchPreference title="@string/pref_output_disable_headroom_gain" key="no_headroom" />

    <Preference                title="@string/pref_buffer_size"             key="buffer_size" />
    <SeekbarPreference         title="@string/pref_vis_lyrics_delay"        key="vis_latency_ms"
                               default="0" min="0" max="2500" />

    <MultilineSwitchPreference title="@string/pref_output_oem_variant"      key="oem_variant" />
    <MultilineSwitchPreference title="@string/pref_cc_force_aa"             key="cc_force_aa" />
    <MultilineSwitchPreference title="@string/cc_show_meta"                 key="cc_show_meta" />
    <MultilineSwitchPreference title="@string/pref_output_disable_equ_tone" key="no_equ" />
    <MultilineSwitchPreference title="@string/pref_output_no_duck"          key="no_duck" />
    <MultilineSwitchPreference title="@string/pref_output_no_af"            key="no_af" />

    <Preference title="@string/pref_restore_defaults" key="restore_defaults" />
</PreferenceScreen>
```

#### 完整选项表（18 项 + 4 个只读提示）

| # | key | 类型 | 标签 | 独占相关 |
| --- | --- | --- | --- | --- |
| 1 | `output_switch` | SwitchString | Enable | 该插件在此设备是否启用 |
| 2 | `sample_rate` | NumberList | Sample Rate | |
| 3 | `sample_rate_static` | 只读 | — | 显示实际采样率 |
| 4 | `sample_fmt` | NumberList | Sample Format | |
| 5 | `sample_bits_static` | 只读 | — | 实际位深 |
| 6 | `pref_ar_format_changes_when_playing` | 提示 | — | 播放中格式会变化 |
| 7 | `pref_sr_format_effects_override_hint` | 提示⚠️ | — | **系统音效(如 Dolby)会强制降级 48k/16bit** |
| 8 | `float` | Switch | **Float32 Sample Format** | 高精度 |
| 9 | `pref_hi_res_no_dvc_hint` | 提示⚠️ | — | **Hi-Res 与 DVC 互斥提示** |
| 10 | `no_dvc` | Switch | **No DVC** | 关闭直接音量控制 |
| 11 | `bt_dvc_msg` | 提示 | — | 蓝牙 DVC 提示 |
| 12 | `no_headroom` | Switch | **No Headroom Gain** | 不预留衰减余量 |
| 13 | `buffer_size` | Preference | **Buffer Size** | 延迟调优 |
| 14 | `vis_latency_ms` | Seekbar | 可视化歌词延迟 | 0–2500ms |
| 15 | `oem_variant` | Switch | **Use OEM Variant** | ★ 用厂商 API 变体 |
| 16 | `cc_force_aa` | Switch | Force Send Album Art | Chromecast |
| 17 | `cc_show_meta` | Switch | — | Chromecast 元数据 |
| 18 | `no_equ` | Switch | **No Equ/Tone** | 禁用音效链路 |
| 19 | `no_duck` | Switch | **No Duck** | ★ 不降音量 |
| 20 | `no_af` | Switch | **Ignore Audio Focus** | ★ 忽略音频焦点 |

**★ = 独占语义的组成部分**：`no_af` + `no_duck` + `no_equ` + `no_headroom` 组合即接近"独占"——不参与焦点仲裁、不让系统降音、不经过音效、不衰减。

---

## 3. 其余子页面

### 3.1 `audio_focus.xml` —— 音频焦点（6 项 + 3 提示）

| key | 标签 | 默认 | dependency |
| --- | --- | --- | --- |
| `resume_after_call` | Resume After Call | `true` | — |
| `resume_on_start` | Resume on Start | `false` | — |
| `resume_on_resume` | Resume on Resume | `true` | `resume_on_start` |
| `resume_on_mount` | Resume on Mount | `false` | `resume_on_start` |
| `af_short` | Pause on Short Focus Loss | `true` | — |
| `pause_in_call` | Pause in Call | `true` | — |
| `resume_on_focus` | Resume on Focus Gain | `true` | `af_short` |
| `af_short_duck` | Duck on Short Focus Loss | `true` | `af_short` |
| `af_permanent` | Pause on Permanent Focus Loss | `true` | — |

**关键**：第 8 行有一个 **`RedirectPreference` 直接跳转到另一个页面的具体选项**：
```xml
<RedirectPreference
    w:target="audio_output_device_opts?uniqName=com.maxmpz.audioplayer/output.cc&amp;device=chromecast#no_af" />
```

⇒ **`RedirectPreference` 支持「页面 + 查询参数 + 锚点」三段式定位**：
- `audio_output_device_opts` — 目标页面
- `?uniqName=com.maxmpz.audioplayer/output.cc&device=chromecast` — 插件与设备
- `#no_af` — 选项锚点

这是整个偏好系统的**跨页深度链接机制**，让"音频焦点说明"能直接跳到"Chromecast 设备的 no_af 开关"。

### 3.2 `audio_dvc.xml` —— 直接音量控制（绝对音量）

| key | 类型 | 标签 |
| --- | --- | --- |
| `dvc_enabled` | Switch | Enable DVC（默认 `true`） |
| `bt_absvol_status` | RawText | 蓝牙绝对音量状态（动态） |
| `no_dvc_bt_absvol` | Switch | No DVC for Bluetooth Absolute Volume（默认 `true`） |
| `no_dvc_gain_mb` | RoundKnob | Headroom Gain，`default=-600`，范围 `-1000..0`，`step=50` |
| `compensate_dvc_vol` | Switch | Compensate DVC Volume |

**DVC 启用条件**（来自 `strings.xml` 原文）：
```
DVC is enabled if:
• per output option allows it
• No DVC for Bluetooth Absolute Volume option allows it
```
⇒ **DVC 是「全局开关 AND 输出级开关」的与逻辑**。

**关键互斥关系**（`strings.xml` 实证）：
- `pref_dvc_may_disable_hi_res` = "DVC may force standard definition audio (48 kHz/16 bit)"
- `pref_hi_res_upsample_warning` = "Poweramp DSP sampling rate always matches output device - non hi-res tracks are upsampled"

⇒ **DVC 与 Hi-Res 输出存在冲突**，这是 Android 音频的固有限制（DVC 需接管音量 → 走混音器 → 失去直通）。

### 3.3 `audio_resampler.xml` —— 重采样（3 项）

| key | 类型 | 标签 | 默认/范围 |
| --- | --- | --- | --- |
| `resampler_type` | TagList | Resampler Type | `0` |
| `resampler_cutoff` | RoundKnob | Cutoff | `970`（**= 97.0%**，scale=10），范围 `800..990` |
| `dither` | NumberList | Dither | `0` |

**`resampler_cutoff` 设计**：`scale="10"` ⇒ 存 970 = 显示 97.0%。范围 80%–99%。这是抗混叠滤波器的截止频率（相对奈奎斯特），精细可调。

### 3.4 `audio_equ.xml` —— 均衡器（13 项）

| key | 类型 | 标签 |
| --- | --- | --- |
| `peq_equ_bands` | Redirect | Equalizer Bands |
| `peq_equ_tone` | Redirect | Tone |
| `eq_labels` | TagList | EQ Labels（默认 `1`） |
| `tone_labels` | TagList | Tone Labels（默认 `2`） |
| `_autosave` | Switch | Autosave |
| `dsp_border_gain` | Switch | DSP Border Gain（默认 `true`） |
| `suggest_autoeq` | Switch | Suggest AutoEQ Presets |
| `_clear_autoeq_known_devices` | RawText | Reset disabled AutoEQ suggestions |
| `_presets_to_peq` | RawText | Send presets to PEQ |
| `_import_autoeq` | RawText | Import AutoEQ presets |
| `reset_eq_presets` | RawText | Reset EQ Presets |

**注意 `_` 前缀 key**（`_autosave`、`_clear_autoeq_known_devices`、`_presets_to_peq`、`_import_autoeq`）：这些是**动作型偏好**（点了执行操作），不是状态存储。Poweramp 用 `_` 前缀区分"命令"与"配置"。

### 3.5 `audio_tweaks.xml` —— 高级调整（2 分类，15 项）

**分类 1：Volume（音量）**
| key | 类型 | 标签 |
| --- | --- | --- |
| `volume_levels` | NumberList | Volume Levels（默认 `0`） |
| `volume_popup` | Switch | Volume Popup |
| `pause_on_volume` | Switch | Pause on Volume（**标记为实验性**，`sup=@string/pref_experiment`） |
| — | Redirect | Long Volume Controls → `misc#volume_keys_long_press_hint` |

**分类 2：Other**
| key | 类型 | 标签 |
| --- | --- | --- |
| `allow_platform_fx` | Switch | Platform FX（默认 `false`） |
| `force_no_speaker` | Switch | **Force Speaker Off (for Hi-Res Output)** |
| `force_audio_on_focus` | Switch | Force Audio on Focus |
| `use_stream3_player` | Switch | Use Stream3 Player（默认 `false`） |
| `mod_gain_mb` | RoundKnob | Mono/Stereo Mod Gain，`scale=100`，范围 `-1000..1000`，`step=100` |
| `mod_separation` | RoundKnob | Mod Separation，范围 `0..200`，`step=10` |
| `reset_eq_presets` | Preference | Reset EQ Presets |
| `reset_reverb_presets` | Preference | Reset Reverb Presets |
| `audio_platform_log` | Redirect | Output Detection Log |

**`force_no_speaker` 的设计洞察**：标签是 "Force Speaker Off (for Hi-Res Output)"，说明摘要写 "Enable this if speaker doesn't switch off after calls, some notifications, etc." —— **Hi-Res 输出需要独占扬声器，但系统可能在通话后忘记切回**，所以要手动强制。

### 3.6 `audio_platform_log.xml` —— 空壳

```xml
<PreferenceScreen title="@string/pref_output_detection_log" w:skipSearch="true" />
```

**完全空的 PreferenceScreen**，运行时 100% 由代码填充输出探测日志。这是 Poweramp 的**可观测性工具**：让用户看到"你的设备被识别成什么、为什么选了某个后端"。

---

## 4. 架构模式总结（**最有价值的部分**）

### 4.1 三层输出配置

```
audio_outputs.xml           ← 插件列表（动态）
    └─ audio_output.xml     ← 插件配置：分配到哪 6 类设备
         └─ audio_output_device_opts.xml  ← 每个「插件×设备」的 20 个选项
```

**为什么这样设计**：同一个 USB DAC 和同一个蓝牙耳机，需要不同的采样率/格式/DVC 设置。
**扁平化会失效** —— 必须「插件 × 设备」双维度。

### 4.2 `RedirectPreference` 是自定义深链机制

支持三种定位粒度：

| 形式 | 例子 | 用途 |
| --- | --- | --- |
| 简单跳转 | `target="audio_dvc"` | 跳到子页面 |
| 带锚点 | `target="misc#volume_keys_long_press_hint"` | 跳到页面内某选项 |
| **带参数+锚点** | `target="audio_output_device_opts?uniqName=...&device=chromecast#no_af"` | **跳到「指定插件+设备」的特定选项** |

⇒ 这让"说明文字"能精确指向配置项，而不是笼统说"去设置里找"。

### 4.3 偏好控件的自制扩展

Poweramp 不用原生 `SwitchPreference`，而是自建了一批：

| 控件 | 用途 |
| --- | --- |
| `MultilineSwitchPreference` | 多行说明的开关 |
| `SwitchConfigPreference` | 按配置键存储的开关 |
| `SwitchStringPreference` | 字符串型开关 |
| `NumberListPreference` | 数字列表（采样率） |
| `TagListPreference` | 带标签的列表 |
| `RoundKnobPreference` | **旋钮**（精细数值，带 `scale`/`step`） |
| `SeekbarPreference` | 滑条 |
| `RawTextPreference` | 富文本（多行提示，`line1..line4`） |
| `RedirectPreference` | 深链 |

**`RawTextPreference` 的 `line1..line4` 设计**：一个控件承载 4 行结构化提示，无需自定义布局。配合 `icon`、`background="@drawable/settings_quote_background"`（引用块）、`zeroTopPad`、`keepPaddings` 等属性，能组合出丰富的提示样式。

### 4.4 只读的「静态」行与可编辑行配对

```xml
<NumberListPreference key="sample_rate" />        <!-- 可编辑：用户期望值 -->
<Preference key="sample_rate_static" />            <!-- 只读：实际生效值 -->
```

同样的模式出现在 `sample_fmt` / `sample_bits_static`。
⇒ **用户设定值与实际生效值分离展示** —— 这是应对 Android 音频"设了不一定生效"的正确 UX。

这与我在 `findings-audio-output.md` §7 记录的 `config.sr` vs `sr` 双记录完全对应。

### 4.5 搜索索引与偏好树解耦

每个页面声明 `w:searchIndexer="...$SearchIndexer"`，由内部类提供扁平搜索索引。
`w:skipSearch="true"` 用于**不应出现在搜索结果**的项（提示行、只读行）。
`w:searchSummary` / `w:searchBreadcrumb1` 用于搜索结果的展示。

⇒ **搜索索引是独立的、按页面注册的**，不是遍历 XML 生成。这也解释了为何 `$SearchIndexer` 是唯一的明名可见类。

### 4.6 实验性功能的标注方式

```xml
<MultilineSwitchPreference key="pause_on_volume"
    w:sup="@string/pref_experiment"
    w:supLink="alert?text=@string/pref_experimental_msg" />
```

⇒ `sup`（superscript 标记）+ `supLink`（点开的说明弹窗）是统一的"实验性/风险"标注机制。

---

## 5. 对 SpMusic 的可借鉴点

| # | 做法 | 为什么值得 |
| --- | --- | --- |
| 1 | **插件×设备双维度配置** | 我们的输出设备只有一套全局设置；USB DAC 与蓝牙应有不同采样率 |
| 2 | **期望值/实际值配对展示** | 直接解决"设了 96k 但实际 48k"的用户困惑 |
| 3 | **深链支持页面+参数+锚点** | 让帮助文档能精确指向具体配置项 |
| 4 | **`_` 前缀区分命令与配置** | 简单的命名约定，避免"动作项"污染配置命名空间 |
| 5 | **只读日志页面**（`audio_platform_log`） | 用户可自助诊断"为什么我的 DAC 没启用 Hi-Res" |
| 6 | **`RawTextPreference` 的 line1..4** | 一个控件承载多行结构化提示，减少自定义布局 |
| 7 | **搜索索引按页面注册** | 比遍历生成更可控，且能精确排除提示行 |

**不建议照抄**：`RoundKnobPreference`（旋钮）在桌面端交互不适用，滑条/输入框更合适。

---

## 6. 未解 / 待验证

| # | 问题 |
| --- | --- |
| P1 | `output_plugins_list` 运行时填充的**插件顺序与显示名**（来自 `output_info` 的动态内容） |
| P2 | 20 个设备选项的**实际持久化键名**（`persistent="false"` 说明由代码管理，键名格式未知） |
| P3 | `sample_rate` / `sample_fmt` 的候选值列表（来自 `pref_*_entries` 数组或代码） |
| P4 | `oem_variant` 开启后具体调用哪条 OEM 路径 |
| P5 | `no_af` 是否真的完全不调 `requestAudioFocus`，还是仅忽略回调 |
| P6 | `float`（Float32）与 `no_dvc` 的互斥/依赖关系 |
| P7 | `vis_latency_ms`（可视化歌词延迟）为何放在**输出选项**里而非显示设置 |

---

## 7. 证据索引

| 主题 | 路径 |
| --- | --- |
| 音频设置根页面 | `decoded/res/xml/audio.xml`（15 行） |
| 输出插件列表 | `decoded/res/xml/audio_outputs.xml`（7 行） |
| 单插件配置（6 类设备） | `decoded/res/xml/audio_output.xml`（14 行） |
| **设备级 20 选项** | `decoded/res/xml/audio_output_device_opts.xml`（25 行） |
| 音频焦点 | `decoded/res/xml/audio_focus.xml`（18 行） |
| DVC | `decoded/res/xml/audio_dvc.xml`（16 行） |
| 重采样 | `decoded/res/xml/audio_resampler.xml`（8 行） |
| 均衡器 | `decoded/res/xml/audio_equ.xml`（17 行） |
| 高级调整 | `decoded/res/xml/audio_tweaks.xml`（23 行） |
| 探测日志（空壳） | `decoded/res/xml/audio_platform_log.xml`（3 行） |
| 全部标签与提示文案 | `decoded/res/values/strings.xml`（2056 条） |

**关联文档**：
- `.rea-analysis/findings-audio-output.md` — 音频输出链路与独占输出的 Native 层实证
- `docs/architecture/poweramp-queue-runtime-reference.md` — 队列运行逻辑
- `docs/architecture/poweramp-search-and-queue-impact.md` — 搜索与队列
