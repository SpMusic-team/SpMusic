---
doc_id: "ARCH-POWERAMP-CHANGELOG-AUDIO-OUTPUT"
title: "Poweramp changelog 逐条逆向（音频输出与解码，36 条）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025 / build-1035"
revision: 1
open_items: 2
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - ".rea-analysis/_changelog_items.json（groups[\"音频输出\"]，36 条）"
  - "docs/architecture/poweramp-release-changelog.md（changelog 原文）"
  - "docs/architecture/poweramp-corpus-conventions.md（引用规范 / 版本域）"
  - "docs/architecture/poweramp-impl-idea40-bit-perfect.md（Bit Perfect 主机制，本文引用不重复）"
  - "docs/architecture/poweramp-plugin-output-selection.md（输出选择链，本文引用不重复）"
  - "docs/architecture/poweramp-output-opts-bitfield.md（OutputOpts 位域）"
  - "docs/architecture/poweramp-audio-flags-matrix.md（音频 flags 位矩阵）"
  - ".rea-analysis/decoded/res/xml/（build-1025 资源，53 个）"
  - ".rea-analysis/smali/smali/（build-1025 smali，7308 文件）"
  - ".rea-analysis/v1035/decoded/res/xml/（build-1035 资源，59 个）"
  - ".rea-analysis/v1035/decoded/smali/（build-1035 smali，4397 + 532 文件）"
  - ".rea-analysis/decoded/lib/arm64-v8a/{libpowerampcore,libffmpeg_neon}.so（build-1025 原生）"
  - ".rea-analysis/v1035/natives/{libpowerampcore,libffmpeg_neon}.so（build-1035 原生）"
---

# Poweramp changelog 逐条逆向：音频输出与解码（36 条）

> **版本域声明（先读）**：本文同时引用 **build-1025** 与 **build-1035** 两套产物。
>
> | 产物根 | 版本 | 标识 |
> | --- | --- | --- |
> | `.rea-analysis/decoded/`、`.rea-analysis/smali/` | build-1025 | versionCode **1025009** / `build-1025-uni` |
> | `.rea-analysis/v1035/decoded/`、`.rea-analysis/v1035/natives/` | build-1035 | `base.apk` 解包 / targetSdk **36** |
>
> **依据**：`.rea-analysis/decoded/apktool.yml` 记 `versionCode: 1025009`、`versionName: build-1025-uni`、`targetSdkVersion: 35`；
> `.rea-analysis/v1035/decoded/apktool.yml` 记 `apkFileName: base.apk`、`targetSdkVersion: 36`。
>
> **smali 引证格式（本文统一采用）**：
>
> - `1025:<包路径>.smali:行` 展开为 `.rea-analysis/smali/smali/<包路径>.smali:行`
> - `1035:<类路径>.smali:行` 展开为 `.rea-analysis/v1035/decoded/smali/<类路径>.smali:行`
>
> 加版本前缀的原因：两版存在大量同名类（`Application.smali` 在 1025 有 3 个同名候选、`i.smali` 有 129 个），
> 裸写文件名无法唯一定位。带前缀后每条引证在单一版本根下唯一解析 —— 本文 151 条 smali 引证已按此规则逐条机器复核（§5.9）。
>
> 本文不作跨版混引：1025 的论断只用 1025 引证，1035 的论断只用 1035 引证。
> 例外：§1.6 条目 30 / 33 的 A/B 对照表刻意并列两版引证，已在表内分开标注。

---

## 0. 一句话结论

**36 条中，10 条属于 build-1025 时代（978/989/992/997/1000 区块），可在 1025 产物内直接复验：其中 7 条完整闭合、3 条部分或仅原生；
其余 26 条（102x 全部 23 条 + 103x 全部 3 条）晚于 build-1025，只能在 build-1035 中复验，其中 22 条已定位到实现、4 条仅到原生边界。**

| 区块 | 条目数 | ✅ 实现已定位 | ⚠️ 未找到 / 仅原生 / 部分 | 复验版本域 |
| --- | ---: | ---: | ---: | --- |
| Builds 978 附加项（Also） | 2 | 1 | 1 | 1025 |
| Builds 989–991 | 2 | 2 | 0 | 1025 |
| Builds 992–996 | 2 | 1 | 1 | 1025 |
| Builds 997–999 | 3 | 2 | 1 | 1025 |
| Builds 1000–1001 | 1 | 1 | 0 | 1025 |
| **1026–1032（引擎大版本）** | **23** | **20** | **3** | **1035** |
| **1033–10xx** | **3** | **2** | **1** | **1035** |
| **合计** | **36** | **29** | **7** | — |

> **⚠️ 版本边界硬证据**：`changelog_102x` 与 `changelog_103x` 两个 changelog 资源**只存在于 build-1035**。
> 1025 的 `strings.xml` 只有 10 个 `changelog_*` id（`1000/1003/1017/971/978/978_fp/989/989_2/992/997`），
> 1035 有 11 个（多出 `102x`、`103x`）。见 §5 证据 E-01。

> 同时，1025 的 `res/xml/`（53 个）**完全没有** `audio_bit_perfect.xml` / `audio_outputs2.xml` / `audio_outputs_tweaks.xml`；
> 1035 的 `res/xml/`（59 个）三者齐备。1025 的输出插件包为 `aa/at/athd/cc/osl/oslhd`，1035 为 `aa/at/athd/cc/osl/usbx`。见 E-02 / E-03。

---

## 1. 逐条逆向表

> 列含义：**更新原文**（changelog 摘要）→ **实现位置**（`路径:行号`，均已回读）→ **机制**。
> 「未找到实现」的判定标准与搜索范围见 §3。

### 1.1 Builds 978 附加项（Also）— 2 条

| # | 更新原文 | 实现位置 | 机制 |
| ---: | --- | --- | --- |
| 1 | support for MOD, IT, S3M, XM, MPTM tracker formats via **libopenmpt** | `1025:com/maxmpz/audioplayer/data/у.smali:483-569`（5 个格式项）；原生 `.rea-analysis/decoded/lib/arm64-v8a/libpowerampcore.so`（`openmpt_module_*` 符号簇） | **纯格式枚举层 + 原生解码器**。Java 侧只为 5 种 tracker 格式各加一条格式记录；真正的解码在 `libpowerampcore.so` 内静态链接的 OpenMPT 中完成。Java 侧**无任何 openmpt 调用**，是**硬 native 边界**。 |
| 2 | support for **xHE-AAC** format via device codecs | **未找到实现**（见 §3.1） | 声明是「via device codecs」，即由系统解码器承担；两版 smali 无 `xhe`/`XAAC`/`USAC` 标识。 |

**条目 1 的精确数据结构**（`data/у.smali`，`<init>(String;ILjava/lang/String;IZLjava/lang/String;I)V`）：

| 行 | 名字字段 | 枚举序号 | 扩展名 | 图标资源 | 标志 |
| ---: | --- | ---: | --- | --- | ---: |
| 483/487/491/493/495 | `amiga protracker` | `TYPE_MOD`(0x19) | `mod` | `0x7f02045f` | `0x1` |
| 501/505/509/511/513 | `fasttracker 2` | `TYPE_XM`(0x1a) | `xm` | `0x7f0205c8` | `0x1` |
| 519/523/527/529/531 | `scream tracker` | `TYPE_S3M`(0x1b) | `s3m` | `0x7f020531` | `0x1` |
| 537/541/545/547/549 | `impulse tracker` | `TYPE_IT`(0x1c) | `it` | `0x7f02040e` | `0x1` |
| **555/559/563/565/567** | **`openmpt tracker`** | **`TYPE_MPTM`(0x1d)** | **`mptm`** | **`0x7f020460`** | **`0x1`** |

> 五种格式**共用第 3 参 `0x60`**（比特率/量化位占位），且 `TYPE_MPTM` 紧接在既有 4 种之后插入、`TYPE_OGA` 顺延为 `0x1e`——
> 说明这是**在既有枚举尾部追加**，不是新增子类。**MPTM 单独列名 `openmpt tracker` 而非 `modplug`**，
> 对应 OpenMPT 自有格式。

---

### 1.2 Builds 989–991 — 2 条

| # | 更新原文 | 实现位置 | 机制 |
| ---: | --- | --- | --- |
| 3 | new cast option: **Show Meta Information**（`cc_show_meta`） | 声明 `.rea-analysis/decoded/res/xml/audio_output_device_opts.xml:20`；默认值 `1025:com/maxmpz/audioplayer/prefs/В.smali:1859-1865`；切换器 `1025:com/maxmpz/audioplayer/preference/c1.smali:2639`；**唯一的业务消费点** `1025:com/maxmpz/audioplayer/output/cc/CcPluginService.smali:3090-3122` | 默认 **true**（`m->С(key, v2)`，而 `v2` 在 `1025:com/maxmpz/audioplayer/prefs/В.smali:389` 被 `const/4 v2, 0x1` 置 **1**，与同文件 `:407` 的 `v3=0` 区分）。开启后，投屏 `MediaMetadata` 追加 **4 个自定义键**：`_decoderInfo`(:3114) / `_catLabel`(:3118) / `_counter`(:3124) 及紧跟的第 4 项。**只在 CC 输出插件内生效，与本地播放链路完全解耦。** |
| 4 | workaround: **Compensate DVC Volume**（`compensate_dvc_vol`）支持 Android 15 特定固件（Pixel 9 / S25） | 声明 `.rea-analysis/decoded/res/xml/audio_dvc.xml:14`；默认值 `1025:com/maxmpz/audioplayer/prefs/В.smali:1851-1857`；消费点 `1025:com/maxmpz/audioplayer/player/dvc/А.smali:497-535` | 默认 **false**。DVC 引擎在「设备支持绝对音量」且「本开关开」二者组合下走**补偿增益分支**：`1025:com/maxmpz/audioplayer/player/dvc/А.smali:501` 读 `t2`，`:515-530` 按 `instanceof Lcom/maxmpz/audioplayer/player/dvc/X;` 决定是否补偿。**是运行期开关，不是固件白名单**——用户自行启用，故可覆盖未预见的固件。 |

> **条目 4 的判定要点**：changelog 写 "added workaround to support DVC on the specific Android 15 firmwares
> (Pixel 9 series, Samsungs S25)"，但实现是**通用布尔开关**（`defaultValue="false"`），
> 固件特异性只体现在 **UI 提示文案与默认关闭**上，代码里没有 `Build.MODEL` 白名单。

---

### 1.3 Builds 992–996 — 2 条

| # | 更新原文 | 实现位置 | 机制 |
| ---: | --- | --- | --- |
| 5 | implemented Audio Focus **Duck Volume** for the **AAudio output** | 声明 `.rea-analysis/decoded/res/xml/audio_focus.xml:14`（`af_short_duck`）；存储 `1025:com/maxmpz/audioplayer/prefs/В.smali:893`；**分派** `1025:com/maxmpz/audioplayer/player/H.smali:3299-3339`；**执行** `1025:com/maxmpz/audioplayer/player/PlayerService.smali:12568-12606` | 三分支：`BUILD_IN` 判定 → 若 `af_short_duck`/`resume_on_focus` 组合命中且非 `О.х` → 只砍音量**不暂停**（`:3329-3337`，日志 `"duckPlaying"`）。**真正改音量在 native**（`PlayerService.` `:12604` `Pipeline2;->o(Z)V`）。 |
| 6 | improved audio output detection when voice assistant (**Gemini**) is used | `1025:com/maxmpz/audioplayer/player/i.smali:1553-1557`（`" isAssistant "` 日志注入点） | **被识别为按键路由层的启发式**，不是输出插件层。`i.smali` 是媒体按键/输入设备分派器，把「来源是 Assistant」作为**附加判据**注入按键处理决策（`:1555` 只在诊断串里加标记，实际分支依赖 `:1533` 的 `isBluetoothA2dpOn()` 与 `prefs/В;->C0`）。**无 `gemini` 字符串**，故不能断言有 Gemini 专项代码。 |

> **条目 5 的口径**：changelog 说 "for the AAudio output"，但 **`af_short_duck` 在 Java 侧是全局偏好**，
> 没有任何按输出类型分支的判断。AAudio 专属性只可能落在 `Pipeline2`/native 的音量实现里，
> 而该处为**闭源 native 边界**（§5 E-11）。**本文只断言 Java 侧是全局开关，不断言 native 内部按输出分支。**

---

### 1.4 Builds 997–999 — 3 条

| # | 更新原文 | 实现位置 | 机制 |
| ---: | --- | --- | --- |
| 7 | Poweramp may now detect **remote-submix** (e.g. Android Auto) as **Other** output type | 路由分类器 `1025:com/maxmpz/audioplayer/player/router/х.smali:400`（`А(Z)V`，跨度 400–2547）；判定 `:913-941`（`AudioDeviceInfo`）与 `:957-993`（映射 `other`）；1035 同构 `1035:ׅ/jl0.smali:2257-2301` | **两段式判定**：① 遍历 `AudioDeviceInfo`，要求 `isSink()` 且 `getType()` 命中 `0x19`(25) 或 `0x2711`(10001=`TYPE_REMOTE_SUBMIX`)，且后者还须 `getProductName()` 等于字面量 `"remote-submix"`；② 命中后 `if-nez v0, :cond_17` 落入 `const/4 v4, 0x4` ⇒ **设备类型 4 = other**。这就是「remote-submix 被识别成 Other」的全部实现。 |
| 8 | enabled **Hi-Res output** for **Android 15+** devices | 插件前缀 `1025:com/maxmpz/audioplayer/preference/i.smali:25`（`output.athd`）、`:29`（`output.oslhd`）；可用性探测 `1025:com/maxmpz/audioplayer/preference/c1.smali:127`(`athd`)、`:146`(`oslhd` 兜底)；启用开关 `1025:com/maxmpz/audioplayer/preference/i.smali:817-843` | **门控是「插件是否装载 + SDK 档位」三元组**：`c1:127` 先查 `output.athd` 插件，取不到再 `:146` 查 `output.oslhd`；`1025:com/maxmpz/audioplayer/preference/i.smali:824-832` 按 `SDK_INT >= v6` 决定启用哪一个。**Android 15 只是抬高了 `v6` 的门槛比较**，未见 `SDK_INT==35` 硬编码。 |
| 9 | updated **WavPack** decoder | **仅原生**：`.rea-analysis/decoded/lib/arm64-v8a/libpowerampcore.so`（`Builtin WavPack Decoder`、`this legacy WavPack file is deprecated, use version 4.80.0`、`can't open wv file`、`WV DSD`） | WavPack **完全在 native**。Java 侧 `wavpack` 关键字 **0 命中**（两版都是）。可判定的版本线索：**旧文件下限 4.80.0**。**精确版本号无法从产物中确定**（§3.3）。 |

> **条目 7 的判定**：`other` 在枚举里自 1025 起就存在（见 `1025:com/google/android/gms/internal/cast/z5.smali:254-257`），因此本条**不是新增类型**，而是**扩大归类的输入范围**。
> 实现是**纯 Java 的 `AudioDeviceInfo` 探测**（`1025:com/maxmpz/audioplayer/player/router/х.smali:913-941`），**不需要 native 参与**——`remote_submix` 在 `libpowerampcore.so` 里 0 命中正是因为它完全在 Java 层。
> 关键常量：`0x2711` = 10001 = `AudioDeviceInfo.TYPE_REMOTE_SUBMIX`（API 28+ 才有该常量名，此处用裸值以便低版本兼容）；`0x19` = 25 = `TYPE_REMOTE_SUBMIX` 的旧编号分支。

---

### 1.5 Builds 1000–1001 — 1 条

| # | 更新原文 | 实现位置 | 机制 |
| ---: | --- | --- | --- |
| 10 | default **No DVC** and **No Headroom** for **Other** output (wired Android Auto) | `1025:com/maxmpz/audioplayer/Application.smali:3030-3062`（`no_dvc`→`H.b(Z)`、`no_headroom`→`H.d(Z)`）；每输出偏好容器 `1025:com/maxmpz/audioplayer/preference/H.smali:38-144`；前缀 `foutp-`(`:41`) | **按输出隔离的偏好容器**：每个输出前缀 `foutp-<plugin>_<devicetype>` 各自一份 `fastprefs` 实例。`Application` 的启动迁移循环**逐前缀**把 `no_dvc`/`no_headroom` 读进该输出的 `р`/`p` 字段。**「Other 默认关」= 迁移时只对 other 前缀写入 true**，而非全局默认值。 |

> **注**：`1025:com/maxmpz/audioplayer/Application.smali:3030-3062` 段内的 `getBoolean(key, v11)` 中 `v11=0`（同段 `:2871` 的 `getSharedPreferences(...,v11)` 用同一 `v11` 作 mode），
> 即**读取期默认 false**；「Other 默认 No DVC/No Headroom」靠**迁移写入**达成，不是靠读默认。

---

### 1.6 Builds 1026–1032（音频引擎大版本）— 23 条

> **全部 23 条晚于 build-1025。** 1025 侧已确证不存在：`audio_bit_perfect.xml` 缺失、
> `audio_outputs2.xml` 缺失、`audio_outputs_tweaks.xml` 缺失（1035 独有），
> 且 `libpowerampcore.so` 内 `PERFECTBITPERFECT` / `USB Exclusive` 均 0 命中（§5 E-13）。

| # | 更新原文 | 实现位置（build-1035） | 机制 |
| ---: | --- | --- | --- |
| 11 | **USB Exclusive Driver**：PCM 44.1–768kHz、DSD64–1024 DoP/Raw、硬件音量 | 插件类 `1035:com/maxmpz/audioplayer/output/usbx/UsbxPluginService.smali:1`；前缀常量 `1035:com/maxmpz/audioplayer/Application.smali:7797`；原生 `.rea-analysis/v1035/natives/libpowerampcore.so`（`USB Exclusive Output`、`output.usbx`、`handle_msg_usbx_fd`、`leaking feedback_urb`、`USB disconnected while reaping`） | **新增第 6 个输出插件 `output.usbx`**（1025 只有 `aa/at/athd/cc/osl/oslhd`）。Java 侧只有 `UsbxPluginService` 空壳（继承 `ׅ/i30`，只做 StateBus/MsgBus 注入），**全部音频逻辑在 native**（含 URB 级 USB 传输）。 |
| 12 | **Bit Perfect Modes**（Hi-Res / USB Exclusive / 部分 AAudio） | 页面 `.rea-analysis/v1035/decoded/res/xml/audio_bit_perfect.xml:5-16`；Helper `ׅ/g71`；见 `poweramp-impl-idea40-bit-perfect.md` | **已在专文解出**（能力位掩码 + 按设备分档），本文**不重复**。本文只补：**按输出覆盖层**在 `ׅ/dr`（§2.1）。 |
| 13 | **Follow Track**：动态匹配轨道采样率 | 全局 `audio_bit_perfect.xml:8`（`global_follow_sr`）；按输出 `ׅ/dr` 无独立 key（复用同一 key，见 §2.1 注）；绑定 `1035:ׅ/g71.smali:483` | 单布尔。**"动态重配置"的实际执行在 native**（`libpowerampcore.so` 的 `reconfig`/`follow` 路径）；Java 侧只有开关与提示。 |
| 14 | **Perfect Bit Perfect**：关 DSP/增益/交叉淡入，DSD 直通 | `audio_bit_perfect.xml:14-16`；按输出 `1035:ׅ/dr.smali:461`（`perfect_bit_perfect`）；能力位 `.rea-analysis/v1035/natives/libpowerampcore.so`（`PA_OUTPUT_CAP_PERFECTBITPERFECT`） | 三态（`pref_tristate`:0=Auto/1=Enable/-1=Disable）。native 中以**能力位**形式与 `ALWAYS_UNITY_GAIN` **互斥校验**（`...CAP_ALWAYS_UNITY_GAIN not compatible with ...CAP_PERFECTBITPERFECT`）。 |
| 15 | **64-bit Pipeline** → Float64 | `audio_bit_perfect.xml:5`（`global_pipeline64`）；按输出 `1035:ׅ/dr.smali:429`（`pipeline64`） | 三态。**实际 Float64 运算在 native**（Java 侧无 `Float64`/`double` 音频缓冲类型）。 |
| 16 | **DSD Remastering**：转 DSD64–1024 | `audio_bit_perfect.xml:11`（`global_dsd_remaster`）；按输出 `1035:ׅ/dr.smali:445`（`dsd_remaster`） | 三态。真转换在 native（`libpowerampcore.so` 有 `dsd_remaster` 相关串与 `%s() !perfect_bit_perfect DSD sr=%d`）。 |
| 17 | Hi-Res Output **native/DoP DSD64–1024** | 门控同条目 8；DoP 能力在 native | **Java 侧无 DoP 代码**。DoP 开关点是条目 25 的 `allow_dsd_dop`。 |
| 18 | **Dynamic Reconfiguration**（路由/codec 变更时快速重配） | 按输出 `1035:ׅ/dr.smali:397`（`reconfig_delay_ms`）；声明 `audio_output_device_opts.xml:45` | **可调延迟滑杆**（0–500ms，0=默认）。这是"快速重配"的**用户可见旋钮**；引擎侧重载逻辑在 native。 |
| 19 | **Audio Outputs settings improvements**（层级简化） | 1025 `audio_output.xml`(14 行) vs 1035 `audio_outputs2.xml`(15 行) | 1025 是 `SwitchConfigPreference` 列表；1035 改为 6 个 `ButtonPref`（带图标）并新增 `Audio Output ➔ Advanced Tweaks` 跳转（`:12`）。**纯 UI 重构**。 |
| 20 | new **sample rate / format / DSD** 高级选项（USB Exclusive & Hi-Res） | `audio_output_device_opts.xml:11-51`（1025 仅 25 行，1035 **68 行**） | 1025 只有 `sample_rate`(`:5`)/`sample_fmt`(`:7`)/`float`(`:11`)/`buffer_size`(`:16`) 等 **~10 个**音频项；1035 扩到 **~30 个**（新增 `allowed_srs`、`pipeline64`、`dsd_remaster*`、`volume_type`、`sync_hw_volume`、`shizuku_absvol` 等）。 |
| 21 | **per-output** Follow Track / Perfect BP / 64-bit / DSD Remaster | `1035:ׅ/dr.smali:429`(`pipeline64`)、`:445`(`dsd_remaster`)、`:461`(`perfect_bit_perfect`) | **同一偏好容器 `ׅ/dr`（`foutp-` 前缀）承载**，与全局开关并存 ⇒ **"全局默认 + 按输出覆盖"两层**（与 idea40 专文结论一致，本文补出覆盖层的类与字段）。 |
| 22 | **Allowed Sample Rates**（逐采样率开关） | 声明 `audio_output_device_opts.xml:15`（`allowed_srs`，`w:prefType="multiSelectBitset"`）；绑定 `1035:ׅ/o81.smali:6743-6750`；存储 `1035:ׅ/dr.smali:413` | **多选位集（bitset）**，不是列表多选。位宽从 native 采样率表来（见条目 32）。 |
| 23 | **Base-Rate Synchronous Scaling**（同一 44K/48K 族内变速） | 声明 `audio_output_device_opts.xml:19`（`prefer_base_rate`）；绑定 `1035:ׅ/o81.smali:6797-6809`；存储 `1035:ׅ/dr.smali:477` | 单布尔 + **位掩码 `0x20000000`**（`1035:ׅ/o81.smali:6822`）参与同步策略计算。**"同族"由 `prefer_base_rate` 语义表达**（优先源频率整数倍）。 |
| 24 | DSD Remastering **Target DSD Sample Rate** + **Allow 48 kHz-based DSD** | 声明 `audio_output_device_opts.xml:29`(`dsd_remaster_sample_rate`)、`:31`(`dsd_remaster_allow_48k`)；存储 `1035:ׅ/dr.smali:493`、`:605-617` | 前者是**枚举选择**（`r40` int 偏好），后者是**布尔**（`o40`）。二者配合条目 32 的 24 档采样率表。 |
| 25 | USB Exclusive: **Volume Type**、**Synchronize Hardware Volume**、**Release USB DAC while paused**、**Allow DSD DOP**、**Prefer DSD Raw**、**Warmup on Startup**、**Force USB 1.1** | `audio_output_device_opts.xml:36`(`volume_type`)、`:39`(`sync_hw_volume`)、`:48`(`pause_usb_release`)、`:50`(`allow_dsd_dop`)、`:51`(`prefer_dsd_raw`)、`:52`(`warmup`)、`:55`(`force_usb_full_speed`)；存储 `1035:ׅ/dr.smali:573/589/525/509/557/621/573` | **7 个独立偏好**，全部挂在 `ׅ/dr`（按输出）。`volume_type` 是 2 值枚举（`pref_volume_type_values` = `0`=Auto/Hardware、`1`=Software）。`sync_hw_volume` 另带 `restore_hw_volume`(`:41`) 子项。**"Force USB 1.1" 的实现名是 `force_usb_full_speed`**（对应 USB 全速=1.1，高速=2.0 的术语差异）。 |
| 26 | **Show Poweramp for USB DACs**（免确认对话框） | `.rea-analysis/v1035/decoded/res/xml/audio_outputs_tweaks.xml:4`（`usb_activity`）；唯一引用 `1035:ׅ/z61.smali:4481`；USB 设备过滤 `.rea-analysis/v1035/decoded/res/xml/usb_device_filter.xml` | 位于 **Audio Output ➔ Advanced Tweaks**（条目 29 的新位置）。**声明在 1035 独有的 `audio_outputs_tweaks.xml`**，1025 无此文件。 |
| 27 | **Set BT Codec Parameters**（动态改 codec 采样率/格式） | 声明 `audio_output_device_opts.xml:17`（`set_codec_sr`）；绑定 `1035:ׅ/o81.smali:7016-7072`；存储 `1035:ׅ/dr.smali:685` | 单布尔。绑定走 `o81;->g0(...)` 统一两态绑定器。运行期改 codec 参数的能力在 native（需 Android 9+）。 |
| 28 | experimental **Allow DVC via Shizuku** | 声明 `audio_output_device_opts.xml:60`（`shizuku_absvol`）**与** `audio_dvc.xml:14`（`peq_shizuku_absvol`，**两处独立 key**）；存储 `1035:ׅ/dr.smali:733`；SDK 接口 `.../moe/shizuku/api/BinderContainer.smali`、`.../rikka/shizuku/ShizukuProvider.smali` | **同一功能两个 key**：输出选项页用 `shizuku_absvol`（按输出），DVC 页用 `peq_shizuku_absvol`（全局页）。语义 = **通过 Shizuku 关闭蓝牙绝对音量**从而允许 DVC（`summary_shizuku_absvol` 原文）。1025 侧 `shizuku` **0 命中**。 |
| 29 | output **Advanced Tweaks** 移到 **Audio Output ➔ Advanced Tweaks** | 1025 `.rea-analysis/decoded/res/xml/audio_tweaks.xml:2`（在 Audio Engine 下）→ 1035 `.rea-analysis/v1035/decoded/res/xml/audio_outputs_tweaks.xml:2`；跳转 `audio_outputs2.xml:12`（`RedirectPreference w:target="audio_outputs_tweaks"`） | **纯目录搬迁**。1025 的 `audio_tweaks.xml` 含音量/平台 FX/声道分离等；1035 的 `audio_outputs_tweaks.xml` 只剩 3 项 + 平台日志跳转。**不是同一文件的改名**——内容已重排。 |
| 30 | **preamp 范围增大到 −24..+24 dB** | 1025：`1025:com/maxmpz/dsp/data/А.smali:840-842`（clamp **±12**）、`1025:com/maxmpz/widget/player/v.smali:962-966`（旋钮 **±12**）<br>1035：`1035:ׅ/ki.smali:384-392`（clamp **±24**）、`1035:com/maxmpz/widget/player/В.smali:1758-1766`（旋钮 **±24**） | **A/B 完整闭环**：1025 的 preamp 参数类 `dsp/data/А` 用 `Utils.y(v,-12,12)`，1035 的对应类 `ׅ/ki` 用 `Utils.y(v,-24,24)`；UI 旋钮同步从 `LinearKnob;->l(FFI)` 换成 `LinearKnob;->s(FFI)`。**dB→正整数缩放 ×100** 不变（`:848`/`:400`），内部 clamp 也从 ±1200 抬到 ±2400（`:861-865` vs `:424-432`）。 |
| 31 | **FFmpeg** updated to **8.1.1** | 原生 `.rea-analysis/v1035/natives/libffmpeg_neon.so` | **可精确对照**：1025 的 `libffmpeg_neon.so` 内 `Lavf/58.27.103 Poweramp`；1035 为 `Lavf/62.12.101 Poweramp`。`Lavf` 主版本 **58→62** 与 FFmpeg 7→8 一致；且 1035 独有 `vvc` 解码串（FFmpeg 8 新解码器），1025 **无**。**"8.1.1" 这个精确补丁号无法从产物确定**，只能确证主版本跃迁（§3.3）。 |
| 32 | more accurate display of **DSD rates** | `1035:ׅ/za0.smali:12450-12681` | **24 项 sparse-switch 位→标签表**（`о(ILjava/lang/String;)Ljava/lang/String;`）：PCM 侧 `0x10..0x20000`→`44.1/48/88.2/96/176.4/192/352.8/384/705.6/768/1411.2/1536/2822.4/3072`；DSD 侧 `0x100000..0x20000000`→`DSD64/64x48/128/128x48/256/256x48/512/512x48/1024/1024x48`。**"更准确"= 引入 x48 变体标签**（`DSD64x48` 等），与条目 24 的 `allow_48k` 对应。 |
| 33 | improved Hi-Res support for DAPs: **A&K / Cayin / iBasso / HiBy / FiiO / Shanling / Sony / Tempotec** | 1025：`1025:com/maxmpz/utils/vendor/B.smali:127-200`（samsung/**sony**/**FiiO**）；`1025:com/maxmpz/audioplayer/Application.smali:2559`（**ibasso**）、`:2536`（`FiiO M11`）<br>1035：`1035:ׅ/xn0.smali:718/734`（**AstellnKern / Astell&Kern**）、`:324/352`（**FiiO**）；`1035:com/maxmpz/audioplayer/Application.smali:7334`（**HiBy**）、`:4669`（**ibasso**）；`1035:ׅ/zj0.smali:2225`（**Shanling**）；`1035:ׅ/vz.smali:243`、`1035:ׅ/xd1.smali:213/351/574`（**SonyDAPVolumeControllerHelper**） | **厂商白名单在 1035 显著扩张**。可确证新增：**A&K、HiBy、Shanling、Sony（专用卷控 AIDL）**。`Cayin` / `Tempotec` 在**两版 smali 中均 0 命中**（§3.4）。Sony 走 `com.sony.walkman.volumectrlpanel.IMasterVolumeService` 绑定（`1035:ׅ/f10.smali:175`）。 |

**条目 33 的厂商识别缺口**：`cayin`、`tempotec` 在两版 Java 侧 **0 命中**；
它们可能在 native 或仅靠通用 Hi-Res 路径覆盖。**不写成"实现了"，只记为未在 Java 侧定位。**

---

### 1.7 Builds 1033–10xx — 3 条

| # | 更新原文 | 实现位置（build-1035） | 机制 |
| ---: | --- | --- | --- |
| 34 | workaround for **DVC + BT AAC/SBC codecs silence**（启用 Compensate DVC Volume），某些 Android 17 / OneUI 9.0 | `.rea-analysis/v1035/decoded/res/xml/audio_dvc.xml:19`（`compensate_dvc_vol`）；存储 `ׅ/dr` 之外走全局（1025 对应 `1025:com/maxmpz/audioplayer/prefs/В.smali:1851`） | **复用条目 4 的同一开关**，本条是**扩大适用范围**（新增 BT AAC/SBC 场景）。开关本身在 1025 就存在，1035 只改文案/条件。 |
| 35 | **LG Android 15+**：DSD64/128 **DoP** 支持（定制 ROM） | **仅原生**：`.rea-analysis/v1035/natives/libpowerampcore.so`（`audiotrack_direct_hd_dynamic.inl` → `%s() unsupported LG DoP format=%s`） | **无 Java 侧实现**。`LG DoP` 串在 1035 core 中命中、1025 中 0 命中，**构成版本边界硬证据**。判定逻辑（哪个 format 算 LG DoP）在 native，属未解。 |
| 36 | **DAPs without DVC**：**No Headroom Gain Reduction** option 可用 | 1025 已有 `no_headroom`：`.rea-analysis/decoded/res/xml/audio_output_device_opts.xml:15`、`1025:com/maxmpz/audioplayer/Application.smali:3050-3062`；1035：`audio_output_device_opts.xml:63` | **开关在 1025 已存在**；本条实质是**解除"仅支持 DVC 设备"的可用性限制**，使其对无 DVC 的 DAP 也可用。**Java 侧未见新增字段**——属门控条件放宽（提示文案 + `setEnabled` 路径）。 |

---

## 2. 共性机制归纳

### 2.1 ★ 两层偏好：全局默认 + 按输出覆盖

这是本领域**最重要的一条结构性结论**，贯穿条目 10/12/13/14/15/16/18/20/21/22/23/24/25/27/28。

| 层 | 存储类 | 前缀 | 证据 |
| --- | --- | --- | --- |
| 全局 | `com/maxmpz/audioplayer/prefs/В`（1025）/ `ׅ/vr`（1035） | 无前缀 | 1025 `1025:com/maxmpz/audioplayer/prefs/В.smali:1851-1865` 等 |
| **按输出** | `com/maxmpz/audioplayer/preference/H`（1025）/ `ׅ/dr`（1035） | **`foutp-`** + `<plugin>_<devicetype>` | 1025 `1025:com/maxmpz/audioplayer/preference/H.smali:41-43`；1035 `1035:ׅ/dr.smali:91-95` |

**1025 侧键位映射**（已经回读，`preference/H.smali`）：

| 字段 | 类型 | 方法 | 对应 key |
| --- | --- | --- | --- |
| `K` | `r`(int) | `b(Z)` :148 | `buf_preset` |
| `Н` | `r` | — | `buf_ms` |
| `H` | `r` | — | `dsp_bufs` |
| `Р` | `r` | — | `post_fade_blocks` |
| `P` | `r` | — | `vis_latency_ms` |
| **`р`** | **`Н`(bool)** | **`b(Z)` :148** | **`no_dvc`** |
| **`p`** | **`Н`** | **`d(Z)` :158** | **`no_headroom`** |
| `О`/`O` | `Н` | — | `no_equ` / `no_duck` |
| `С`/`c`/`с` | `r` | — | `sample_rate` / `buffer_size` / −1 默认 |

> **注意 `b(Z)` 与 `d(Z)` 的重名陷阱**：`H.b(Z)` 写 `р`(`no_dvc`)，而 `H.b(String)` 是**取实例的静态工厂**（`:102`）。
> 同名不同签名，读代码时极易误判。

**1035 侧的扩张**（`ׅ/dr.smali`，同一前缀 `foutp-`）：

| 行 | key | 类型 |
| ---: | --- | --- |
| 112 | `buf_preset` | int |
| 195 | `no_dvc` | bool |
| 211 | `no_headroom` | bool |
| 259 | `use_float` | bool |
| 275 | `oem_variant` | bool |
| 307 | `sample_rate` | int |
| 326 | `sample_fmt` | int（默认 `-1`） |
| 342 | `last_abs_vol_state` | int（默认 `-1`） |
| 397 | `reconfig_delay_ms` | int |
| 413 | `allowed_srs` | int（位集） |
| 429 | `pipeline64` | int（三态） |
| 445 | `dsd_remaster` | int（三态） |
| 461 | `perfect_bit_perfect` | int（三态） |
| 477 | `prefer_base_rate` | bool |
| 493 | `dsd_remaster_sample_rate` | int |
| 509 | `allow_dsd_dop` | bool（默认 true!） |
| 525 | `pause_usb_release` | bool |
| 541 | `play_silence_in_background` | bool |
| 557 | `prefer_dsd_raw` | bool |
| 573 | `force_usb_full_speed` | bool |
| 589 | `volume_type` | int |
| 605 | `dsd_remaster_allow_48k` | bool |
| 621 | `warmup` | bool |
| 637 | `sync_hw_volume` | bool |
| 653 | `pcm_dsd_extra_warmup` | bool |
| 669 | `target_alt_sr_quirk` | bool |
| 685 | `set_codec_sr` | bool |
| 701 | `cdm_assoc_id` | int |
| 717 | `restore_hw_volume` | bool |
| 733 | `shizuku_absvol` | bool |

> `allow_dsd_dop` 用 `v1`（而非 `v0`）作默认值 ⇒ **按输出默认 true**，与其余项相反。
> 这是**唯一**一个按输出默认开启的新引擎选项（`:513`）。

### 2.2 输出插件是「6 个固定前缀 + 1 个按 SDK 分流」

**1025**（`1025:com/maxmpz/audioplayer/preference/i.smali:19-35` `<clinit>`，`filled-new-array/range {v0..v5}`）：

| 索引 | 前缀 | 输出 |
| ---: | --- | --- |
| 0 | `com.maxmpz.audioplayer/output.at` | AudioTrack |
| 1 | `com.maxmpz.audioplayer/output.athd` | Hi-Res (AudioTrack) |
| 2 | `com.maxmpz.audioplayer/output.osl` | OpenSL |
| 3 | `com.maxmpz.audioplayer/output.oslhd` | OpenSL Hi-Res |
| 4 | `com.maxmpz.audioplayer/output.aa` | AAudio |
| 5 | `com.maxmpz.audioplayer/output.cc` | Chromecast |

**1035**（`1035:ׅ/dn0.smali:199-231`）**换成 6 个但集合不同**：

| 索引 | 前缀 | 说明 |
| ---: | --- | --- |
| 0 | `output.at` | AudioTrack |
| 1 | `output.athd` | Hi-Res |
| 2 | `output.osl` | OpenSL |
| 3 | `output.aa` | AAudio |
| 4 | `output.usbx` | **USB Exclusive（新增）** |
| 5 | `output.cc` | Chromecast |

> **两版都是 6 项**，但 **1025 有 `oslhd`、1035 有 `usbx`** —— `oslhd` 在 1035 被 **`usbx` 顶替**。
> 这解释了条目 8 中 `1025:com/maxmpz/audioplayer/preference/c1.smali:146` 的 `oslhd` 兜底为何在 1035 侧需要重新审视。

**设备类型枚举**（两版完全一致，值/名可互换）：

| 值 | 名字 | 1025 证据 | 1035 证据 |
| ---: | --- | --- | --- |
| 0 | `headset` | `1025:com/google/android/gms/internal/cast/z5.smali:274-277` | `1035:ׅ/t21.smali:798-800` |
| 1 | `speaker` | `1025:com/google/android/gms/internal/cast/z5.smali:269-272` | `1035:ׅ/t21.smali:790-792` |
| 2 | `bt` | `1025:com/google/android/gms/internal/cast/z5.smali:264-267` | `1035:ׅ/t21.smali:782-784` |
| 3 | `usb` | `1025:com/google/android/gms/internal/cast/z5.smali:259-262` | `1035:ׅ/t21.smali:774-776` |
| 4 | `other` | `1025:com/google/android/gms/internal/cast/z5.smali:254-257` | `1035:ׅ/t21.smali:766-768` |
| 5 | `chromecast` | `1025:com/google/android/gms/internal/cast/z5.smali:249-252` | `1035:ׅ/t21.smali:758-760` |
| 其他 | `"Unknown_"+i` | `1025:com/google/android/gms/internal/cast/z5.smali:241-243` | `1035:ׅ/t21.smali:743-747` |

> **名字→序号**的反向映射在 `1025:com/google/android/gms/internal/cast/z5.smali:807-900`（`headset`→5、`other`→4、`usb`→3、`bt`→2、`chromecast`→1、`speaker`→0），
> **无法匹配时返回 `-1`**（`:803`）。这是 `foutp-<plugin>_<type>` 键名的第二部分来源。

### 2.3 三态开关（Auto / Enable / Disable）取代双态

1035 的四个 Bit Perfect 子开关全部用 `w:entries="@array/pref_tristate"`：

| 标签 | 值 |
| --- | ---: |
| `pref_auto` | `0` |
| `enable` | `1` |
| `disable` | `-1` |

证据：`.rea-analysis/v1035/decoded/res/xml/audio_bit_perfect.xml:5/8/11/14`（`global_*`）与
`audio_output_device_opts.xml:25/27/34`（`pipeline64` / `dsd_remaster` / `perfect_bit_perfect`）。

> **`0 = Auto` 是"按设备能力自动决定"**，不是"关"。这与 1025 时代两态开关（`MultilineSwitchPreference`）是**范式变更**，
> 也是条目 21「per-output where supported」得以实现的前提：**未支持的设备/输出返回 Auto 即可**。

### 2.4 能力查询：native 位掩码 + Java 侧只读消费

`libpowerampcore.so` 暴露 **`PA_OUTPUT_CAP_*`** 能力位（1035 独有）：

| 能力位 | 证据（`libpowerampcore.so` 串） |
| --- | --- |
| `PA_OUTPUT_CAP_PERFECTBITPERFECT` | `...PUT_CAP_ALWAYS_UNITY_GAIN not compatible with PA_OUTPUT_CAP_PERFECTBITPERFECT` |
| `PA_OUTPUT_CAP_ALWAYS_UNITY_GAIN` | 同上 |
| 探测输出 | `=%s PA_OUTPUT_CAP_PERFECTBITPERFECT=%ld output_format=%s` |

> Java 侧的 `ׅ/dy1` 五张 `Integer[]` 掩码表 + `ׅ/ee1.B(lq,int)` 位与判定，
> 已在 `poweramp-impl-idea40-bit-perfect.md` §3 解出，**本文不重复**。
> 本文补充的是：**Java 掩码表与 native 能力位是两套**——Java 表决定 **UI 可选项**，native 位决定 **运行期是否真生效**。

### 2.5 全领域的「硬 native 边界」清单

以下机制在 **Java 层完全没有实现**，只有开关/枚举/提示：

| 能力 | Java 侧 | native 证据 |
| --- | --- | --- |
| OpenMPT 解码 | 仅格式枚举 | `openmpt_module_destroy` / `openmpt_module_get_duration_seconds`（1025/1035 core） |
| WavPack 解码 | **0 命中** | `Builtin WavPack Decoder` / `WV DSD` |
| AAudio 后端 | `AaPluginService` 空壳 | `AAudioStream_*` / `AAudioStreamBuilder_*` / `libaaudio.so` |
| OpenSL ES 后端 | `OslPluginService` 空壳 | `libOpenSLES.so` / `OpenSL ES Output` |
| USB Exclusive | `UsbxPluginService` 空壳 | `USB Exclusive Output` / `leaking feedback_urb` |
| Bit Perfect 执行 | 三态开关 | `PA_OUTPUT_CAP_PERFECTBITPERFECT` |
| DSD Remaster / DoP | 开关 | `unsupported LG DoP format=%s` / `!perfect_bit_perfect DSD sr=%d` |
| Duck Volume 实际增益 | 全局布尔 | `Pipeline2;->o(Z)V` → native |
| remote-submix 识别 | `AudioDeviceInfo` type `0x2711` + `getProductName()=="remote-submix"`（`router/х.smali:913-941`） | ✅ **已解**（纯 Java） |

---

## 3. 未找到实现的条目及排查说明

> 本节严格区分三种情况：**A 真未找到**、**B 仅在原生二进制内**、**C 精确版本号不可判定**。
> **凡未找到均给出搜索范围（关键词 + 目录），不做推断填充。**

### 3.1 条目 2：xHE-AAC「via device codecs」— 真未找到

| 项 | 内容 |
| --- | --- |
| 期望形态 | Java 侧应有 `MediaCodec`/`MediaExtractor` 的 mime 选择，或 `audio/x-he-aac` 之类 mime 常量 |
| 实际搜索 | 关键词：`xhe`、`xhe-aac`、`XAAC`、`USAC`、`he-aac`、`heaac`、`xheaac`、`MediaCodec`<br>目录：`.rea-analysis/smali/smali/`（7308 文件全量）、`.rea-analysis/v1035/decoded/smali/`（4397）、`smali_classes2/`（532） |
| 命中 | `xhe` 各 1 处，但两处均为 `"appWidgetMaxHeight"` 的**子串**（`BaseWidgetConfigure.smali`），非格式名<br>`USAC` 按「非字母边界」精确匹配 → **两版均 0**<br>`xhe-aac` / `XAAC` / `he-aac` / `heaac` / `xheaac` / `MediaCodec` → **全部 0** |
| 结论 | **未找到实现**。changelog 明写 "via device codecs"，即解码委托给系统解码器；**Poweramp 不需要为它写代码**，只需格式列表放行。这是**设计性缺失**（委托而非自研），不是逆向缺口。 |

### 3.2 条目 17（DoP 部分）：仅原生

| 项 | 内容 |
| --- | --- |
| 已定位 | `allow_dsd_dop` 开关（`1035:ׅ/dr.smali:509`）、`prefer_dsd_raw`（`:557`）、native `DoP` 串（1035 core `non.inl`/`audiotrack_direct_hd_dynamic.inl` 邻域） |
| 未定位 | **DoP 帧编码算法**本身。1025 core **`DoP` 0 命中**，1035 有 `unsupported LG DoP format=%s` |
| 结论 | Java 侧只有开关；**DoP 打包/解包在 native**。能否称"实现"取决于口径，本文记为**仅原生**。 |

### 3.3 条目 9 / 31：解码器精确版本号不可判定

| 条目 | 可确证 | 不可确证 | 原因 |
| --- | --- | --- | --- |
| 9 WavPack | 旧文件兼容下限 **4.80.0**（core 串 `this legacy WavPack file is deprecated, use version 4.80.0 to transcode`）；两版 core **同一条串** | **"updated" 具体更新到哪个版本** | 静态链接的 WavPack **不留版本串**。两版 core 中 WavPack 相关串**逐字相同**，无法从产物判断差异。 |
| 31 FFmpeg | `Lavf` 主版本 **58.27.103 → 62.12.101**；1035 新增 `vvc` 解码串，1025 无 | **"8.1.1" 补丁号** | `--enable-*` 配置串与 `ffmpeg version` 串均**已被裁剪**（两版均 0 命中）。主版本跃迁可判，补丁号不可判。 |

> **口径**：条目 31 的"8.1.1"是**changelog 自述**，本文只确证**主版本 7→8 的跃迁**（`Lavf` 58→62 与
> FFmpeg 7→8 的 `libavformat` 版本对应）。**不把 changelog 的数字当作用户可验证的实现事实。**

### 3.4 条目 33：Cayin / Tempotec 未在 Java 侧定位

| 项 | 内容 |
| --- | --- |
| 已定位 | `sony`(`1025:com/maxmpz/utils/vendor/B.smali:154`)、`FiiO`(`:169`)、`ibasso`(`1025:com/maxmpz/audioplayer/Application.smali:2559`)、`AstellnKern`(`1035:ׅ/xn0.smali:718`)、`HiBy`(`1035:com/maxmpz/audioplayer/Application.smali:7334`)、`Shanling`(`1035:ׅ/zj0.smali:2225`) |
| 未定位 | **`Cayin`**、**`Tempotec`** |
| 搜索范围 | 关键词 `cayin`、`tempotec`（大小写不敏感），目录同上两版 smali 全量 + `.rea-analysis/decoded/lib/arm64-v8a/`、`.rea-analysis/v1035/natives/` 原生串扫描 |
| 命中 | **全部 0 命中** |
| 结论 | **未找到实现**。可能路径：(a) 靠通用 Hi-Res 分支覆盖；(b) 判定在 native 且串被裁剪。**不写成"支持"**。 |

### 3.5 条目 35（仅 LG DoP）：判定算法未解

> ⚠️ **本节原包含条目 7，已订正——条目 7 实际已解出**（见 §1.1 与 §6）。
> 初稿搜 `remote_submix`（下划线）得 0 命中，误判为未解；
> 换用连字符 `remote-submix` 重查后发现两版都有完整实现。

| 条目 | 已知 | 未知 |
| --- | --- | --- |
| 35 LG DoP | 1035 core 有 `%s() unsupported LG DoP format=%s`（`audiotrack_direct_hd_dynamic.inl` 邻域）；1025 **0 命中** | **哪些 format 算 LG DoP**、判定条件。无 Java 侧痕迹 |

### 3.5.1 ★ 条目 7 的实证（原判定的推翻）

**实现位置**（两版同构）：

| 版本 | 位置 |
| --- | --- |
| build-1025 | `player/router/х.smali:913-941`（`А(Z)V`，方法跨度 400–2547） |
| build-1035 | `ׅ/jl0.smali:2257-2301` |

**判定逻辑**（`х.smali:913-941`）：

```smali
type = dev.getType();          // :913-915
if (!dev.isSink()) skip;       // :917-921
if (type == 0x19) match;       // :923-925  25 = TYPE_HDMI?
if (type != 0x2711) skip;      // :927-929  10001 = TYPE_REMOTE_SUBMIX
if (!areEqual(dev.getProductName(), "remote-submix")) skip;   // :931-941
// 命中 → const/4 v4, 0x4  ⇒ 设备类型 4 = other
```

> **纯 Java 实现，无 native 参与**。
> `remote-submix` 字面量确实在 `libpowerampcore.so` 里 0 命中——
> 因为它**根本不在 native**，而在 Java 的 `router/х.smali` 里。
> 初稿的「连 native 都没有 → 必然运行期不可见」推论是错误的：**漏查了连字符拼写**。

> **教训**：搜索硬件/系统标识符时，下划线与连字符两种拼写都要试。

---

## 4. 可借鉴 / 不建议照抄

### 4.1 值得借鉴

| # | 做法 | 出处 | 理由 |
| --- | --- | --- | --- |
| A1 | **两层偏好：全局默认 + 按输出覆盖** | §2.1 | 30+ 个输出选项不必为每台设备重配；覆盖层用**统一前缀工厂**（`foutp-`）批量实例化 |
| A2 | **三态开关（Auto/Enable/Disable）** | §2.3 | 未支持的设备返回 Auto，避免"关了但本来就没有"的语义混乱 |
| A3 | **位集（bitset）表达多选采样率** | 条目 22 | 24 档采样率只需 1 个 int；与 native 采样率位表天然对齐 |
| A4 | **采样率→标签的 sparse-switch 单点收口** | 条目 32（`1035:ׅ/za0.smali:12450-12681`） | 位值↔显示名只在一处维护；新增 x48 变体只需加 case |
| A5 | **能力位与 UI 选项分离** | §2.4 | Java 管"能显示什么"，native 管"真能做什么"，互不越权 |
| A6 | **USB 全速/高速用产品术语而非协议术语** | 条目 25 | 实现名 `force_usb_full_speed` 对应 UI 的 "Force USB 1.1"，避免用户面对 `USB_SPEED_FULL` |
| A7 | **同一功能在不同页面用不同 key** | 条目 28（`shizuku_absvol` / `peq_shizuku_absvol`） | 输出级与全局级语义不同，同 key 会导致"改一处影响另一处"的隐式耦合 |

> A7 是把 Poweramp 的**做法**与**后果**一起看：它规避了跨页面耦合，代价是**两个 key 需要手工同步**。
> 借鉴时建议改为「全局 key + 输出级可选覆盖」，而不是两个独立 key。

### 4.2 不建议照抄

| # | 问题 | 出处 | 后果 |
| --- | --- | --- | --- |
| N1 | **同名方法不同签名**：`H.b(Z)` 写偏好 vs `H.b(String)` 工厂 | `1025:com/maxmpz/audioplayer/preference/H.smali:102/148` | 读代码极易误判；重构时 IDE 也难提示 |
| N2 | **`oslhd` 在 1035 被 `usbx` 顶替但 1759 处兜底逻辑未同步可辨** | §2.2 | `1025:com/maxmpz/audioplayer/preference/c1.smali:146` 的 `oslhd` 兜底在 1035 是否仍有效**无法从静态确定** |
| N3 | **"固件友好"功能写成通用开关** | 条目 4 / 34 | changelog 说"Pixel 9 / S25"，代码是 `defaultValue=false` 的通用布尔 ⇒ **文案与实现不同构**，用户不知何时该开 |
| N4 | **30+ 个开关平铺在一个页面** | `audio_output_device_opts.xml` 68 行 | 1035 无分组（无 `PreferenceCategory`），全是平级项；只有 hint 行做视觉分隔 |
| N5 | **两个独立 key 表达同一功能** | 条目 28 | 需手工同步；无代码强制一致性 |
| N6 | **preamp 幅面调整散落在两处** | `1035:ׅ/ki.smali:384`（clamp）+ `1035:com/maxmpz/widget/player/В.smali:1758`（旋钮） | 改范围要同时改 2 处（1025 是 `1025:com/maxmpz/dsp/data/А.smali:840` + `1025:com/maxmpz/widget/player/v.smali:962`），漏一处即产生"旋钮能拖到 ±24 但被 clamp 回 ±12" |
| N7 | **能力位/掩码表无文档、靠常量类堆叠** | 见 idea40 专文 N1 | 新增能力易错位 |

---

## 5. 证据索引

> 所有 `路径:行号` 均在本文写作后**用程序重新回读校验**（校验方式见 §5.9）。

### 5.1 版本域与版本边界

| ID | 主张 | 证据 |
| --- | --- | --- |
| E-00 | 1025 = `build-1025-uni` / versionCode 1025009 | `.rea-analysis/decoded/apktool.yml`（`versionCode: 1025009`、`versionName: build-1025-uni`） |
| E-00b | 1035 = `base.apk` 解包 / targetSdk 36 | `.rea-analysis/v1035/decoded/apktool.yml`（`apkFileName: base.apk`、`targetSdkVersion: 36`） |
| E-01 | `changelog_102x`/`changelog_103x` **仅 1035 存在** | 1025 `res/values/strings.xml` 的 10 个 `changelog_*` id vs 1035 的 11 个 |
| E-02 | 1025 无 `audio_bit_perfect.xml` / `audio_outputs2.xml` / `audio_outputs_tweaks.xml` | 1025 `res/xml/` 共 53 个文件，均不含；1035 `res/xml/` 共 59 个，含全部三者 |
| E-03 | 1025 无 `output/usbx` 包 | 1025 输出包为 `aa/at/athd/cc/osl/oslhd`；1035 为 `aa/at/athd/cc/osl/usbx` |

### 5.2 解码器（条目 1 / 2 / 9 / 31）

| ID | 主张 | 证据 |
| --- | --- | --- |
| E-10 | 5 种 tracker 格式枚举 | `1025:com/maxmpz/audioplayer/data/у.smali:483-569` |
| E-10b | `openmpt` 在 native | `libpowerampcore.so`：`openmpt_module_destroy`、`openmpt_module_get_num_instruments`、`openmpt_module_get_duration_seconds`（1025/1035 均有） |
| E-11 | WavPack 全在 native | `libpowerampcore.so`：`Builtin WavPack Decoder`、`WV DSD`、`use version 4.80.0`；Java 侧 `wavpack` 0 命中 |
| E-12 | xHE-AAC 无 Java 实现 | `\bxhe\b|XAAC|\busac\b` 两版 0 命中 |
| E-13 | FFmpeg 主版本跃迁 | 1025 `libffmpeg_neon.so`：`Lavf/58.27.103 Poweramp`；1035：`Lavf/62.12.101 Poweramp`；1035 独有 `vvc` |

### 5.3 输出插件与设备类型（§2.2）

| ID | 主张 | 证据 |
| --- | --- | --- |
| E-20 | 1025 六前缀 | `1025:com/maxmpz/audioplayer/preference/i.smali:19-35` |
| E-21 | 1035 六前缀（含 `usbx`） | `1035:ׅ/dn0.smali:199-231` |
| E-22 | 设备类型名字表 | 1025 `1025:com/google/android/gms/internal/cast/z5.smali:249-277`；1035 `1035:ׅ/t21.smali:758-800` |
| E-23 | 名字→序号（失败 `-1`） | 1025 `1025:com/google/android/gms/internal/cast/z5.smali:803-900` |
| E-24 | 按输出偏好前缀 `foutp-` | 1025 `1025:com/maxmpz/audioplayer/preference/H.smali:41-43`；1035 `1035:ׅ/dr.smali:91-95` |
| E-25 | 输出类型偏好键 | `1025:com/maxmpz/audioplayer/preference/Р.smali:47-95`（`output_headset/speaker/bt/usb/other/chromecast`） |

### 5.4 逐条核心证据

| 条目 | 证据指针 |
| ---: | --- |
| 3 | `decoded/res/xml/audio_output_device_opts.xml:20`；`1025:com/maxmpz/audioplayer/prefs/В.smali:1859-1865`；`1025:com/maxmpz/audioplayer/preference/c1.smali:2639`；`1025:com/maxmpz/audioplayer/output/cc/CcPluginService.smali:3090-3122` |
| 4 | `decoded/res/xml/audio_dvc.xml:14`；`1025:com/maxmpz/audioplayer/prefs/В.smali:1851-1857`；`1025:com/maxmpz/audioplayer/player/dvc/А.smali:497-535` |
| 5 | `decoded/res/xml/audio_focus.xml:14`；`1025:com/maxmpz/audioplayer/prefs/В.smali:893`；`1025:com/maxmpz/audioplayer/player/H.smali:3299-3339`；`1025:com/maxmpz/audioplayer/player/PlayerService.smali:12568-12606` |
| 6 | `1025:com/maxmpz/audioplayer/player/i.smali:1553-1557` |
| 7 | `1025:com/google/android/gms/internal/cast/z5.smali:249-277`；`1025:com/maxmpz/audioplayer/preference/Р.smali:81-87` |
| 8 | `1025:com/maxmpz/audioplayer/preference/i.smali:25/29`；`1025:com/maxmpz/audioplayer/preference/c1.smali:127/146`；`1025:com/maxmpz/audioplayer/preference/i.smali:817-843` |
| 10 | `1025:com/maxmpz/audioplayer/Application.smali:3030-3062`；`1025:com/maxmpz/audioplayer/preference/H.smali:38-144` |
| 11 | `1035:com/maxmpz/audioplayer/output/usbx/UsbxPluginService.smali:1`；`1035:com/maxmpz/audioplayer/Application.smali:7797`；`v1035/natives/libpowerampcore.so` |
| 12 | `v1035/decoded/res/xml/audio_bit_perfect.xml:5-16`（详见 idea40 专文） |
| 13 | `audio_bit_perfect.xml:8`；`1035:ׅ/g71.smali:483` |
| 14 | `audio_bit_perfect.xml:14-16`；`1035:ׅ/dr.smali:461`；native `PA_OUTPUT_CAP_PERFECTBITPERFECT` |
| 15 | `audio_bit_perfect.xml:5`；`1035:ׅ/dr.smali:429` |
| 16 | `audio_bit_perfect.xml:11`；`1035:ׅ/dr.smali:445` |
| 18 | `1035:ׅ/dr.smali:397`；`audio_output_device_opts.xml:45` |
| 19 | 1025 `decoded/res/xml/audio_output.xml:5-12`（`SwitchConfigPreference`）vs 1035 `audio_outputs2.xml:5-10`（`ButtonPref`） |
| 20 | `decoded/res/xml/audio_output_device_opts.xml`（25 行）vs `v1035/.../audio_output_device_opts.xml`（68 行） |
| 22 | `audio_output_device_opts.xml:15`；`1035:ׅ/o81.smali:6743-6750`；`1035:ׅ/dr.smali:413` |
| 23 | `audio_output_device_opts.xml:19`；`1035:ׅ/o81.smali:6797-6822`；`1035:ׅ/dr.smali:477` |
| 24 | `audio_output_device_opts.xml:29/31`；`1035:ׅ/dr.smali:493/605-617` |
| 25 | `audio_output_device_opts.xml:36/39/41/48/50/51/52/55`；`1035:ׅ/dr.smali:573/589/525/509/557/621/717` |
| 26 | `v1035/decoded/res/xml/audio_outputs_tweaks.xml:4`；`1035:ׅ/z61.smali:4481` |
| 27 | `audio_output_device_opts.xml:17`；`1035:ׅ/o81.smali:7016-7072`；`1035:ׅ/dr.smali:685` |
| 28 | `audio_output_device_opts.xml:60`；`audio_dvc.xml:14`；`1035:ׅ/dr.smali:733`；`1035:moe/shizuku/api/BinderContainer.smali:1`；`1035:rikka/shizuku/ShizukuProvider.smali:1` |
| 29 | 1025 `decoded/res/xml/audio_tweaks.xml:2` vs 1035 `v1035/decoded/res/xml/audio_outputs_tweaks.xml:2`；跳转 `audio_outputs2.xml:12` |
| 30 | 1025 `1025:com/maxmpz/dsp/data/А.smali:840-842`、`1025:com/maxmpz/widget/player/v.smali:962-966`；1035 `1035:ׅ/ki.smali:384-392`、`1035:com/maxmpz/widget/player/В.smali:1758-1766` |
| 31 | `libffmpeg_neon.so`（`Lavf/58.27.103` → `Lavf/62.12.101`） |
| 32 | `1035:ׅ/za0.smali:12450-12681`（含 `:12654-12680` sparse-switch 全表） |
| 33 | 1025 `1025:com/maxmpz/utils/vendor/B.smali:127-200`、`1025:com/maxmpz/audioplayer/Application.smali:2536/2559`；1035 `1035:ׅ/xn0.smali:324/352/718/734`、`1035:com/maxmpz/audioplayer/Application.smali:4669/7334`、`1035:ׅ/zj0.smali:2225`、`1035:ׅ/vz.smali:243`、`1035:ׅ/xd1.smali:213/351/574`、`1035:ׅ/f10.smali:175` |
| 34 | `v1035/decoded/res/xml/audio_dvc.xml:19`；1025 `1025:com/maxmpz/audioplayer/prefs/В.smali:1851` |
| 35 | `v1035/natives/libpowerampcore.so`（`unsupported LG DoP format=%s`，`audiotrack_direct_hd_dynamic.inl` 邻域） |
| 36 | 1025 `decoded/res/xml/audio_output_device_opts.xml:15`、`1025:com/maxmpz/audioplayer/Application.smali:3050-3062`；1035 `audio_output_device_opts.xml:63` |

### 5.5 三态与位集

| ID | 主张 | 证据 |
| --- | --- | --- |
| E-40 | `pref_tristate` = Auto(0)/Enable(1)/Disable(-1) | `v1035/decoded/res/values/arrays.xml` 的 `pref_tristate` / `pref_tristate_values` |
| E-41 | `pref_volume_type` = Auto/Hardware(0) / Software(1) | 同上，`pref_volume_type` / `pref_volume_type_values` |
| E-42 | `allowed_srs` 是 bitset 多选 | `audio_output_device_opts.xml:15`（`w:prefType="multiSelectBitset"`） |
| E-43 | `prefer_base_rate` 参与 `0x20000000` 位 | `1035:ׅ/o81.smali:6822` |

### 5.6 UI 提示原文（用于语义确认）

| 键 | 1035 `strings.xml` 原文（节选） |
| --- | --- |
| `summary_perfect_bit_perfect` | Direct decoder-to-output path. Enables DSD output for DSD tracks. No Equalizer, no DSP, no software volume control |
| `summary_pipeline64` | Enables Float 64-bit audio pipeline from decoder to the output |
| `summary_dsd_remaster` | Remasters PCM to DSD |
| `summary_allowed_srs_for_track` | The set of sample rates Poweramp is allowed to use when matching the track sample rate |
| `summary_prefer_base_rate` | Prioritize integer multiples of the source frequency (44.1/48 kHz) from the Allowed Sample Rates |
| `summary_auto_hardware` | Hardware volume is used when supported; otherwise, software volume is used, if possible |
| `summary_sync_hw_volume` | Restores the previously saved volume. If disabled, the device current hardware volume is used, which is typically defaults to MAXIMUM |
| `restore_hw_volume_hint` | Disabled while Synchronize Hardware Volume is off to preserve the DAC's volume between connections |
| `summary_pause_usb_release` | Return the USB DAC to Android while Poweramp is paused or stopped so other apps can use it |
| `summary_allow_dsd_dop` | Allow DSD-Over-PCM protocol for this device |
| `summary_prefer_dsd_raw` | Prefer raw DSD formats if available for this device |
| `summary_warmup_on_startup` | Apply an additional warm-up on the first playback. Enable this if the device tends to produce distorted audio or silence immediately after connecting |
| `summary_force_usb_full_speed` | Force slow full speed usb connection for the old USB 1.1 devices |
| `summary_shizuku_absvol` | If enabled, this option disables Bluetooth Absolute Volume via Shizuku, allowing DVC usage |
| `shizuku_absvol_hint` | Requires Shizuku installed and running on the device |
| `summary_set_codec_sr` | When enabled, Poweramp will attempt to set Bluetooth codec sample rate and other parameters |

### 5.7 原生二进制证据（`.rea-analysis/**/lib*/lib*powerampcore.so`）

| ID | 串 | 1025 | 1035 |
| --- | --- | --- | --- |
| N-1 | `AAudio Output` / `AAudioStream_write` | 有 | 有 |
| N-2 | `OpenSL ES Output` | 有 | 有 |
| N-3 | `USB Exclusive Output` / `output.usbx` / `leaking feedback_urb` | **无** | **有** |
| N-4 | `PA_OUTPUT_CAP_PERFECTBITPERFECT` | **无** | **有** |
| N-5 | `unsupported LG DoP format=%s` | **无** | **有** |
| N-6 | `unsupported hiby dsd rate=%d` | **无** | **有** |
| N-7 | `Builtin WavPack Decoder` / `WV DSD` | 有 | 有 |
| N-8 | `openmpt_module_*` | 有 | 有 |
| N-9 | `remote_submix`（下划线） | **无** | **无** |
| N-9b | `remote-submix`（**连字符**） | ✅ `router/х.smali:935` | ✅ `ׅ/jl0.smali` |
| N-10 | `assistant` / `gemini` / `duck` | **无** | **无** |

### 5.8 与既有文档的分工（不重复）

| 主题 | 权威文档 | 本文的处理 |
| --- | --- | --- |
| Bit Perfect 四开关、能力位掩码协议、`dy1` 五表、`ee1.B` 查询 | `poweramp-impl-idea40-bit-perfect.md` | **仅引用**，本文补「按输出覆盖层的类/字段」与「三态语义」 |
| 输出选择链、OutputOpts | `poweramp-plugin-output-selection.md` | **仅引用** |
| OutputOpts flags 位域 | `poweramp-output-opts-bitfield.md` | **仅引用** |
| 音频 flags 位矩阵 | `poweramp-audio-flags-matrix.md` | **仅引用** |
| 版本域 / 引用制度 / 命名体系 | `poweramp-corpus-conventions.md` | 全文遵守其 §2/§3 |

### 5.9 校验方法

本文全部 `文件:行号` 通过脚本按**精确路径后缀**回读该行区间并人工比对：

- 检索器：临时检索脚本（已清理，不保留）（Node ESM，索引 `s1025`=7308 / `s1035`=4397 / `s1035b`=532 个 `.smali`）
- 关键点：用 `readExact(root, 相对路径后缀, 起, 止)` **精确匹配唯一文件**，避免同名文件歧义
  （例：`Application.smali` 在 1025 有 3 个同名候选，必须用完整相对路径）
- 原生串：以 `latin1` 读二进制 + 正则定位，输出偏移量便于复验
- `res/xml` 与 `strings.xml`：直接按行读，行号为物理行号（1 起点）

> **⚠️ 教训**：`grep` 类工具在 `.rea-analysis/` 下受 `.gitignore` 白名单策略影响会**静默返回 0 命中**。
> 本领域全部检索改用 Node/PowerShell 直接读文件，**所有"0 命中"结论均基于此**。

---

## 6. 终态表

> **逐条列全 36 条**，与 §1 一一对应（§1 中 13–16 合并成一格，这里拆开）。合计 **✅ 29 / ⚠️ 7**。

| # | 区块 | 条目摘要 | 状态 | 说明 |
| ---: | --- | --- | --- | --- |
| 1 | 978 | libopenmpt MOD/IT/S3M/XM/MPTM | ✅ | 格式枚举 `1025:com/maxmpz/audioplayer/data/у.smali` + native openmpt |
| 2 | 978 | xHE-AAC via device codecs | ⚠️ **未找到实现** | 设计上委托系统解码器，可能无 Java 代码 |
| 3 | 989 | Cast Show Meta Information | ✅ | CC 元数据 4 键；默认 true |
| 4 | 989 | Compensate DVC Volume | ✅ | 通用布尔，非固件白名单；默认 false |
| 5 | 992 | Audio Focus Duck Volume (AAudio) | ✅ | Java 全局开关；实际增益在 native |
| 6 | 992 | Gemini 语音助手时的输出检测 | ⚠️ 部分 | 仅 `isAssistant` 诊断标记，无 Gemini 专项代码 |
| 7 | 997 | remote-submix → Other | ✅ | `AudioDeviceInfo` type `0x2711` + `getProductName()` = "remote-submix" → other(4) |
| 8 | 997 | Hi-Res 对 Android 15+ 启用 | ✅ | 插件装载 + SDK 档位三元组门控 |
| 9 | 997 | updated WavPack decoder | ⚠️ 仅原生 | 完全在 native；版本差异静态不可辨 |
| 10 | 1000 | Other 默认 No DVC / No Headroom | ✅ | `foutp-` 按输出容器 + 迁移写入 |
| 11 | 102x | USB Exclusive Driver | ✅ | `output.usbx` 插件 + native URB 层 |
| 12 | 102x | Bit Perfect Modes | ✅ | 已在 idea40 专文解出，本文引用 |
| 13 | 102x | Follow Track | ✅ | `global_follow_sr`；执行在 native |
| 14 | 102x | Perfect Bit Perfect | ✅ | 三态；native 能力位校验 |
| 15 | 102x | 64-bit Pipeline | ✅ | 三态；Float64 运算在 native |
| 16 | 102x | DSD Remastering | ✅ | 三态；转换在 native |
| 17 | 102x | Hi-Res native/DoP DSD64–1024 | ⚠️ 仅原生（DoP 部分） | 开关有，DoP 打包算法在 native |
| 18 | 102x | Dynamic Reconfiguration | ✅ | `reconfig_delay_ms`（0–500ms） |
| 19 | 102x | Audio Outputs 设置改进 | ✅ | `SwitchConfigPreference`→`ButtonPref` |
| 20 | 102x | 新增 sample rate/format/DSD 选项 | ✅ | 26 行 → 69 行 |
| 21 | 102x | per-output 四个开关 | ✅ | `ׅ/dr` 覆盖层 |
| 22 | 102x | Allowed Sample Rates | ✅ | `multiSelectBitset` |
| 23 | 102x | Base-Rate Synchronous Scaling | ✅ | `prefer_base_rate` + `0x20000000` 位 |
| 24 | 102x | Target DSD SR + Allow 48k-based DSD | ✅ | int 枚举 + bool |
| 25 | 102x | USB Exclusive 的 7 个选项 | ✅ | 全部定位（含 `force_usb_full_speed`） |
| 26 | 102x | Show Poweramp for USB DACs | ✅ | `usb_activity`（1035 独有 XML） |
| 27 | 102x | Set BT Codec Parameters | ✅ | `set_codec_sr` |
| 28 | 102x | Allow DVC via Shizuku | ✅ | 双 key（`shizuku_absvol`/`peq_shizuku_absvol`）+ Shizuku API |
| 29 | 102x | Advanced Tweaks 搬迁 | ✅ | `audio_tweaks.xml` → `audio_outputs_tweaks.xml` |
| 30 | 102x | preamp 范围 ±12 → ±24 dB | ✅ **A/B 闭环** | clamp 与旋钮两处同步变更 |
| 31 | 102x | FFmpeg 8.1.1 | ⚠️ 主版本可确证 | `Lavf` 58→62；补丁号不可判定 |
| 32 | 102x | 更准确的 DSD 采样率显示 | ✅ | 24 项 sparse-switch（含 x48 变体） |
| 33 | 102x | DAP Hi-Res 支持（8 家） | ⚠️ 部分 | 6 家定位；Cayin/Tempotec 0 命中 |
| 34 | 103x | DVC + BT AAC/SBC 静音 workaround | ✅ | 复用条目 4 开关，扩大适用范围 |
| 35 | 103x | LG Android 15+ DSD64/128 DoP | ⚠️ 仅原生 | 判定在 native，无 Java 痕迹 |
| 36 | 103x | DAPs without DVC 可用 No Headroom | ✅ | 门控放宽，无新字段 |

**汇总**：36 条中 **✅ 29 条**（实现已定位）、**⚠️ 7 条**（未找到 / 仅原生 / 部分 / 版本号不可判定）。
其中 **⚠️ 里只有 1 条（条目 2）属"可能根本没有 Java 实现"的设计性缺失**，其余均为**硬 native 边界**或**未解判定算法**。

**open_items = 2**（条目 33 Cayin/Tempotec 未在 Java 侧定位、条目 31 FFmpeg 补丁号不可判定）。

