# Poweramp 音频输出链路与独占输出（Native 层实证）

**证据级别**：本文全部来自 `libpowerampcore.so` 的**字符串/符号实证** + JADX 反编译原文。
`libpowerampcore.so` 未被混淆符号表（是 C/C++ 原生库，符号与字面量可读）。

| 项 | 值 |
| --- | --- |
| 目标 | `com.maxmpz.audioplayer` build-1025-uni (1025009) |
| APK SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 原生库 | `lib/arm64-v8a/libpowerampcore.so`（3.43 MB，87,154 个可打印串）、`libffmpeg_neon.so`、`libyayicn.so` |
| 提取位置 | `D:\SpMusic\.rea-analysis\natives\` |
| 引擎 | JADX 0.7.1（Java 面）+ 原始字节串扫描（Native 面） |
| 采集 | 2026-10-27 |

---

## 0. 一句话结论

**Poweramp 的音频输出是一次「插件式」分层：Java 只做能力查询的薄封装，真正的输出在 `libpowerampcore.so` 里，通过 `dlopen("libaaudio.so")` 动态加载 AAudio 并设置 `AAudioStreamBuilder_setSharingMode` 实现独占。**

**关键发现：独占输出不走 AudioTrack，走 AAudio。** 判据见 §4。

---

## 1. Java 层：只是能力查询的薄壳

`com.maxmpz.audioplayer.plugin.OutputInternalHelper`（11 方法 / 0 字段）：

| 方法 | 签名 | 性质 |
| --- | --- | --- |
| `native_output_get_supported_devices` | `(I)I` | **native** |
| `native_output_get_sample_rates` | `(II)I` | **native** |
| `native_output_get_sample_formats` | `(II)I` | **native** |
| `native_output_get_options` | `(II[B)J` | **native** |
| `m2301` | `(I)I` | Java 包装 `get_supported_devices` |
| `m2303` / `m2304` | `(II)I` | Java 包装 |
| `A` | `(II[B)J` | Java 包装 `get_options` |
| `X` | `(II)Z` | Java 包装 |
| `B` | `(Context,I,Z)String` | 设备名解析 |
| `m2302` | `(StateBus,Z,String,StringBuilder)Z` | 状态总线查询 |

`m2301` 原文（典型薄封装）：
```java
public static int m2301(int i) {
    try {
        return native_output_get_supported_devices(i);
    } catch (Throwable th) {
        Log.e("OutputInternalHelper", "", th);
        return -1;
    }
}
```

`native_output_get_options` 的 `body_status` = **`not_available`**，`markers` = `["native_method"]`。
⇒ **Java 层没有独占输出逻辑**，全部委托原生。

---

## 2. Native 层：五个输出后端

从 `libpowerampcore.so` 提取的输出后端标识：

| 后端标识 | 推测实现 | 依据 |
| --- | --- | --- |
| `output.aa` | **AAudio**（Android 8+） | 与 `libaaudio.so`、`AAudio*` 符号同区 |
| `output.at` | **AudioTrack**（Java 侧音频流） | 与 `AudioTrack.getAudioSessionId()` 同区 |
| `output.athd` | **AudioTrack HD**（高解析） | 名含 `hd`；与 `stream3_osl_player_callback` 同区 |
| `output.osl` | **OpenSL ES** | 与 `slCreateEngine.`、`CreateOutputMix` 同区 |
| `output.cc` | **AAudio 回调模式**变体 | 与 `aaoutput.c` 同区，配置串含 `num_blocks` 而非 `num_bufs` |

**AAudio 引用 60 处，OpenSLES 1 处仅为 `slCreateEngine` 字样——但 OpenSL 实现是完整的**（见下）。

### 2.1 纠正：OpenSL ES 不是遗留代码

初判「OpenSL 仅 1 处符号」会误以为它是残留。实际提取到 **23 条** OpenSL 相关串，且包含完整的 IID 接口集：

```
SL_IID_ENGINE                  ← 引擎
SL_IID_BUFFERQUEUE             ← 缓冲队列
SL_IID_PLAY                    ← 播放控制
SL_IID_VOLUME                  ← 音量
SL_IID_ANDROIDEFFECT           ← Android 音效
SL_IID_ANDROIDCONFIGURATION    ← Android 配置（stream type / 采样率）
osloutput_init                 ← 初始化入口
osl_stream3.c                  ← 独立源文件
```

⇒ **`output.osl` 是完整可用的第三后端**，不是遗留。`SL_IID_ANDROIDCONFIGURATION` 的存在尤其关键——它让 OpenSL 能设置 stream type 与采样率，是 Android 4.x 时代的独占手段。

### 2.2 系统音频策略配置文件（`output.osl` 附近出现）

```
/vendor/etc/audio_output_policy.conf
/vendor/etc/audio_io_policy.conf
/vendor/etc/audio_policy.conf
/system/etc/audio_policy.conf
/system/etc/audio_hifi.conf
```

⇒ Poweramp **直接解析厂商的 audio policy 配置文件**来判断可用输出路径。这是绕过 Android 公开 API 限制、探测 OEM 深度的手段。`audio_hifi.conf` 与 §6.3 的 OEM 变体呼应。

---

## 3. AAudio 是**动态加载**的

```
libaaudio.so
%s() could not find libaaudio.so
aaudio_loader.c
```

⇒ 通过 `dlopen` 加载，失败时有显式降级路径（`could not find libaaudio.so`）。

已解析的 AAudio 符号（部分）：

```
AAudio_createStreamBuilder
AAudioStreamBuilder_openStream
AAudioStreamBuilder_setSharingMode        ← 独占关键
AAudioStreamBuilder_setFormat
AAudioStreamBuilder_setSampleRate
AAudioStreamBuilder_setFramesPerDataCallback
AAudioStreamBuilder_setUsage
AAudioStreamBuilder_setContentType
AAudioStreamBuilder_setInputPreset
AAudioStreamBuilder_setSessionId
AAudioStreamBuilder_setErrorCallback
AAudioStreamBuilder_setPackageName
AAudioStreamBuilder_delete
AAudioStream_getSharingMode               ← 读取实际生效模式
AAudioStream_getFormat
AAudioStream_getSampleRate
AAudioStream_getXRunCount                 ← 欠载计数
AAudioStream_getState
AAudioStream_getDirection
AAudioStream_getContentType
AAudioStream_setBufferSizeInFrames
AAudioStream_write / read
AAudioStream_requestStart / requestPause / requestStop
AAudioStream_waitForStateChange
AAudioStream_close
aaudio_data_callback_proc
```

---

## 4. 独占输出：`AAUDIO_SHARING_MODE_EXCLUSIVE`

### 关键判据

`AAudioStreamBuilder_setSharingMode` 与 `AAudioStream_getSharingMode` **成对存在**：

- **写**：`setSharingMode` 用于请求独占/共享
- **读**：`getSharingMode` 用于**回读实际生效值**

> **这是重要设计**：AAudio 的 `setSharingMode(EXCLUSIVE)` 只是**请求**，设备/驱动可能降级为共享。Poweramp 保留了 `getSharingMode` 回读，说明它**不假设请求一定成功**。

### 为什么是 AAudio 而不是 AudioTrack

| 维度 | AudioTrack | AAudio |
| --- | --- | --- |
| 独占模式 | **无公开 API**（只能靠 `AUDIO_OUTPUT_FLAG_DIRECT` 间接） | **有显式 `setSharingMode(EXCLUSIVE)`** |
| 动态加载 | 否（系统类） | 是（`dlopen("libaaudio.so")`） |
| 最低版本 | API 3+ | API 26+ |
| 缓冲区控制 | `setBufferSizeInFrames` | `AAudioStream_setBufferSizeInFrames` |

⇒ Poweramp **同时保留两条路径**：Android 8+ 走 AAudio（可真独占），低版本或 AAudio 不可用时降级到 AudioTrack + `AUDIO_OUTPUT_FLAG_DIRECT`。

### `AUDIO_OUTPUT_FLAG_DIRECT_PCM` 的证据

```
%s %s AUDIO_OUTPUT_FLAG_DIRECT_PCM
parse_direct_pcm
direct_pcm
direct_pcm_24
```

这是 Android 平台侧的「直通 PCM」flag，是 **AAudio 不可用时的次优独占手段**。

---

## 5. 输出能力标志（`PA_OUTPUT_CAP_*`，20 个）

独占/直通相关的核心标志：

| 标志 | 含义（由名称推断） |
| --- | --- |
| **`PA_OUTPUT_CAP_RAW`** | **原始位流输出**（不经混音器） |
| **`PA_OUTPUT_CAP_NO_DUCK`** | 不因通知/来电降低音量 |
| **`PA_OUTPUT_CAP_NO_AUDIO_FOCUS`** | **不申请音频焦点** —— 典型独占行为 |
| `PA_OUTPUT_CAP_CUSTOM_MASTER_VOLUME` | 自管主音量 |
| `PA_OUTPUT_CAP_FORCED_UNITY_GAIN` | 强制单位增益（绕过系统音量） |
| `PA_OUTPUT_CAP_ALWAYS_UNITY_GAIN` | 始终单位增益 |
| `PA_OUTPUT_CAP_NO_HEADROOM_GAIN` | 无 headroom 衰减 |
| `PA_OUTPUT_CAP_NO_EQU` | 系统均衡器不介入 |
| `PA_OUTPUT_CAP_NO_MUSIC_STREAM_VOL` | 不使用系统音乐流音量 |
| `PA_OUTPUT_CAP_NEEDS_VOL_UI` | 需要自绘音量 UI |
| `PA_OUTPUT_CAP_NEEDS_VOLUME_PROVIDER` | 需要外部音量提供者 |
| `PA_OUTPUT_CAP_DELAYED_FORMAT` | 格式延迟确定 |
| `PA_OUTPUT_CAP_FLT_EXTENDED_DYN_RANGE` | 扩展动态范围 |
| `PA_OUTPUT_CAP_TRACK_PLAYBACK` | 轨道播放模式 |
| `PA_OUTPUT_CAP_USE_STREAM3` | 使用 stream3 |
| `PA_OUTPUT_CAP_OEM_VARIANT` | OEM 定制变体 |
| `PA_OUTPUT_CAP_SEEK_FAST_VOLUME` | seek 时快速音量 |
| `PA_OUTPUT_CAP_TRACK_CHANGE_FAST_VOLUME` | 切歌时快速音量 |
| `PA_OUTPUT_CAP_PAUSE_FAST_VOLUME` | 暂停时快速音量 |
| `PA_OUTPUT_CAP_PTS_UI` | PTS 显示 |

**`NO_AUDIO_FOCUS` + `FORCED_UNITY_GAIN` + `NO_DUCK` 三者组合 = 独占播放的完整语义**：
不参与焦点仲裁、不被系统音量影响、不被通知打断。

---

## 6. 内部输出 flag（`FLAG_*`，60 个唯一）

### 6.1 直通/独占相关

| Flag | 含义 |
| --- | --- |
| **`FLAG_DIRECT`** | 直接输出 |
| **`FLAG_DIRECT_PCM`** | 直通 PCM |
| **`FLAG_NEEDS_DIRECT_PCM`** | 需要直通 PCM（由设备探测得出） |
| `FLAG_NEEDS_OFFLOAD_OUTPUT_FLAG` | 需要 offload 输出 flag |
| `FLAG_NEEDS_DEEP_BUFFER` | 需要深缓冲 |
| `FLAG_ALLOW_PCM_32` / `FLAG_SUPPORTS_PCM_32` | 32-bit PCM 许可/支持 |
| `FLAG_SUPPORTS_PCM_24` / `FLAG_SUPPORTS_PCM_24_OFFLOAD` | 24-bit |
| `FLAG_FORCE_PCM_8_24` | 强制 8.24 定点 |
| `FLAG_SUPPORTS_UNITY_GAIN_STREAM` | 支持单位增益流 |
| `FLAG_OUT_PARAMS_UNDETECTABLE` | 输出参数不可探测 |
| `FLAG_SUPPORTS_USB` / `FLAG_SUPPORTS_SPEAKER` / `FLAG_SUPPORTS_LDAC` | 设备能力 |

### 6.2 采样率 flag（8 档）

`FLAG_SR_44K` / `48K` / `88K` / `96K` / `176K` / `192K` / `352K` / `384K`
（与 `INTERNAL_OUTPUT_FLAG_SR_*` 同名对应）

**最高 384 kHz** ⇒ 支持 DXD 级别。

### 6.3 OEM 变体（16 个，**这是 Poweramp 的核心竞争力**）

```
FLAG_VARIANT_SAMSUNG              FLAG_VARIANT_SAMSUNG_UHQA
FLAG_VARIANT_SONY_96              FLAG_VARIANT_MEIZU_HIFI
FLAG_VARIANT_MTK_HIFI             FLAG_VARIANT_LENOVO_HIFI
FLAG_VARIANT_IBASSO               FLAG_VARIANT_UHQA_MSM_BIT
FLAG_VARIANT_DIRECT_HD            FLAG_VARIANT_DIRECT_HD_NS
FLAG_VARIANT_DIRECT_HD_MIUI_STREAM{,_1,_11,_12}
FLAG_VARIANT_DIRECT_HD_STREAM_11  FLAG_VARIANT_DIRECT_PCM8_24
FLAG_VARIANT_DYNAMIC              FLAG_VARIANT_MIXED_HIRES
FLAG_VARIANT_PCM_OFFLOAD          FLAG_VARIANT_USB_ONLY
FLAG_ALLOW_DVC_EFFECT / FLAG_BT_DVC_EFFECT
```

**厂商专有开关的系统属性**（实证字符串）：

| 属性 / 路径 | 用途 |
| --- | --- |
| `persist.audio.uhqa` | Samsung UHQA 开关 |
| `secmm.player.uhqamode` | Samsung UHQA 模式 |
| `ro.lenovo.hifi_support` | Lenovo HiFi |
| `/system/etc/audio_hifi.conf` | 通用 HiFi 配置 |
| `audio.offload.pcm.24bit.enable` | offload 24-bit |
| `!audio.offload.pcm.24bit.enable` | 取反判定 |
| `ro.hardware` | 硬件平台探测 |
| `audio.offload.buffer.size.kb` | offload 缓冲 |

**`handle_mtk_hifi_set_func`** 的存在说明 MTK 平台有专门的函数级处理。

---

## 7. 输出配置日志格式（还原配置项）

三条后端各自的日志模板，可直接读出参数集：

**AAudio 无回调模式**（`output.aa`）：
```
%s frames_per_block=%d block ms=%f num_bufs=%d at_min_buf_frames=%d
config.sr=%d sr=%d config.fmt=%d fmt=%d caps=0x%x latency=%f
```

**AudioTrack**（`output.at`）：
```
%s frames_per_block=%d block ms=%f g_at_min_buf_frames_48k=%d sr_mult=%d at_min_buf_...
```

**AAudio 回调模式**（`output.cc`）：
```
%s frames_per_block=%d num_blocks=%d limited_desired_frames=%f block ms=%f
```

⇒ **输出配置的关键变量**：`frames_per_block`、`num_bufs`/`num_blocks`、`config.sr` vs `sr`（**配置采样率与实际采样率分离**）、`config.fmt` vs `fmt`、`caps`、`latency`。

**重要设计**：`config.sr` 与 `sr` 分开记录，说明 Poweramp **预期采样率可能被系统改写**，并记录偏差。

**AudioTrack 后端还有第三个采样率字段**（`output.at` 完整模板）：
```
%s frames_per_block=%d block ms=%f g_at_min_buf_frames_48k=%d sr_mult=%d
   at_min_buf_frames=%d sr=%d reported_native_sample_rate=%d caps=0x%x latency=%f
```

⇒ **三层采样率**：`sr`（请求值）、`reported_native_sample_rate`（**设备上报的原生值**）、`sr_mult`（倍率）。
`sr_mult` 的存在说明 Poweramp 在 `sr ≠ reported_native_sample_rate` 时**做整数倍重采样**，而非任意比率。这是为保证音质的设计选择。

---

## 8. 完整输出链路（还原）

```
Player pipeline (Java)
  └─ OutputInternalHelper.m2301/m2303/m2304/A/X  ← 能力查询
       └─ native_output_get_{supported_devices,sample_rates,sample_formats,options}
            └─ libpowerampcore.so
                 │
                 ├─ dlopen("libaaudio.so")  ← 动态加载，失败有降级
                 │    └─ AAudio_createStreamBuilder
                 │         ├─ setSampleRate / setFormat
                 │         ├─ setFramesPerDataCallback
                 │         ├─ setSharingMode(EXCLUSIVE?)   ← ★ 独占请求
                 │         ├─ setUsage / setContentType
                 │         └─ openStream
                 │              └─ AAudioStream_getSharingMode  ← ★ 回读实际模式
                 │              └─ AAudioStream_getXRunCount   ← 欠载监测
                 │
                 └─ 降级链：
                      output.aa  (AAudio)
                      output.cc  (AAudio 回调)
                      output.athd (AudioTrack HD + AUDIO_OUTPUT_FLAG_DIRECT_PCM)
                      output.at   (AudioTrack)
                      output.osl  (OpenSL ES)
```

---

## 9. 独占输出的四个设计要点（对 SpMusic 有借鉴价值）

### 9.1 请求与回读分离

`setSharingMode`（请求）+ `getSharingMode`（回读）成对存在。
**独占不是「设了就成」** —— AAudio 允许系统降级。Poweramp 记录实际值，说明 UI 需要如实反映「当前是否真独占」。

### 9.2 能力探测先于打开

四个 `native_output_get_*` 全部是「查」而非「设」：
- `get_supported_devices`
- `get_sample_rates(device, …)`
- `get_sample_formats(device, …)`
- `get_options(device, …)`

⇒ 先枚举设备能力，再为每个设备决定用哪个后端 + 哪种模式。这与我们的 `audio/device/polling.rs` 思路一致。

### 9.3 多后端而非单后端

五个 `output.*` 后端 + 16 个 OEM 变体。
**没有一个后端能在所有设备上最优** —— 这是 Android 音频碎片化的必然结果。

### 9.4 配置采样率与实际采样率双记录

`config.sr=%d sr=%d`（还有 `config.fmt` / `fmt`）。
**预期被系统改写时能诊断**，而不是静默劣化。这是可观测性设计。

---

## 10. 未解 / 待验证

| # | 问题 | 影响 |
| --- | --- | --- |
| **A1** | `AAUDIO_SHARING_MODE_EXCLUSIVE` 具体取值（1？）与调用点的控制流 | 无法确认「什么条件下请求独占」 |
| A2 | `parse_direct_pcm` 的判定逻辑 | 决定何时走 `DIRECT_PCM` 降级 |
| A3 | 五个后端的选择优先级与降级触发条件 | 完整链路图缺这一层 |
| A4 | `PA_OUTPUT_CAP_NO_AUDIO_FOCUS` 的实际实现（是否真的不调 `requestAudioFocus`） | 影响「独占」的语义完整性 |
| A5 | OEM 变体的探测与启用顺序 | 16 个变体如何匹配当前设备 |
| A6 | `output.aa` 的独占失败是否自动重试为共享 | 降级策略 |
| A7 | OpenSL ES 路径是否仍完整（仅 1 处符号） | 可能是遗留代码 |

> 以上均需**反汇编**（Ghidra）而非字符串扫描才能确认。当前证据只到「能力与常量存在」的层面。

---

## 11. 证据索引

| 主题 | 位置 |
| --- | --- |
| Java 薄封装类 | `com.maxmpz.audioplayer.plugin.OutputInternalHelper`（JADX 类摘要） |
| `m2301` 包装实现 | JADX `OutputInternalHelper.m2301`（`ev_2190a37b...`） |
| 4 个 native 方法 | JADX 类摘要，`body_status: not_available`，`markers: ["native_method"]` |
| AAudio 符号 | `libpowerampcore.so` 字符串扫描 |
| `setSharingMode` | 同上，offset 385329 附近 |
| `libaaudio.so` / `aaudio_loader.c` | 同上 |
| `PA_OUTPUT_CAP_*` 20 个 | 同上 |
| `FLAG_*` 60 个 | 同上 |
| 五个 `output.*` 后端 | 同上 |
| 三条配置日志模板 | 同上 |
| OEM 系统属性 | 同上 |
| 原生库提取 | `D:\SpMusic\.rea-analysis\natives\` |

**关键 Evidence ID**：
- `ev_5185172ed564ede9d3f9472a10947ca1e2e7ef02338a543611ebc08186889a8c` — `OutputInternalHelper` 类摘要
- `ev_2190a37b1b8180d416766b5eeb6852cac459489979c4d7b8685ee9c11f103eee` — `m2301` 方法体
- `ev_3b0c1dbfddcb6ec0bda93c063fdc431ad55240cd10808a270de5575f1748fcce` — `native_output_get_options`（native_method 确认）
- `ev_8750babdf7577e5d2c8ae464426fdfa0ba619d8ad7e121644a4532fdfcd1abc5` — `Output` 类搜索
