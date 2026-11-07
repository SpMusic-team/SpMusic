---
doc_id: poweramp-background-settings
title: Poweramp「设置 → 背景」偏好结构（build-1035）
doc_type: architecture
status: draft
owner_agent: lead
version_scope: build-1035-bundle-play (versionCode 1035009)
created: 2026-11-06
updated: 2026-11-06
source_documents:
  - .rea-analysis/v1035/decoded/res/xml/aa_bg.xml
  - .rea-analysis/v1035/decoded/res/values/strings.xml
  - .rea-analysis/v1035/decoded/res/values/public.xml
  - .rea-analysis/v1035/decoded/smali/ׅ/wr.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/y61.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/widget/player/MilkWidget.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/milk/MilkLoader.smali
---

# Poweramp「设置 → 背景」偏好结构

> **证据分级**：【实证·原文】= XML/资源原文；【实证·产物】= 反编译 smali 产物；【推断】= 无直接代码佐证。
>
> 所有结论基于 **build-1035-bundle-play**（`versionCode 1035009`）。

## 0. 一句话结论

「背景」页面只有 **20 行 XML / 15 个元素 / 11 个带 key 项**，但它控制的是**专辑封面模糊背景**这一渲染管线的全部视觉参数：3 个开关 + 4 个数值滑杆组成"模糊"子系统，另有 3 个项组成"渐变"子系统。所有参数最终经 `MilkWidget.Х()` 写入 `MilkLoader` 的 6 个字段，交给原生渲染器。

---

## 1. 页面身份

| | |
| --- | --- |
| XML 文件 | `res/xml/aa_bg.xml` |
| 资源 id | **`0x7f160001`** |
| 行数 | **20** |
| 字节 | 3486 |
| 元素总数 | **15** |
| 带 key 项 | **11** |
| 无 key 提示块 | **4** |
| 页面标题 | `@string/pref_aa_bg_options` = **Background** |
| 页面摘要 | `@string/pref_summary_aa_bg_options` = **Blur, details, intensity, saturation** |
| 设置页 helper | `ׅ/y61.smali`（25783 字节） |
| prefs 字段定义 | `ׅ/wr.smali`（静态字段绑定） |
| 渲染消费方 | `MilkWidget.Х()` → `MilkLoader` 6 个字段 |

> **注意资源 id 是 `0x7f160001`** —— 全 App 最小的 xml 资源 id，说明这个页面在资源表里排第一。

## 2. 15 个元素逐条

按 XML 中实际出现顺序。**np** = `persistent="false"`；**dep** = 有 `android:dependency`。

| # | key | 类型 | 标题 | 摘要 / 提示 | 默认 | 范围 | 依赖 |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `aa_blur_enabled` | MultilineSwitch | Enable Blurred Backgrounds | — | — | — | — |
| 2 | `list_aa_blur_enabled` | MultilineSwitch | List Background | — | — | — | `aa_blur_enabled` |
| 3 | `lyrics_aa_blur_enabled` | MultilineSwitch | Lyrics Background | — | — | — | `aa_blur_enabled` |
| 4 | *（无 key）* | RawText | — | line1: **Skins may override, change, or completely disable background**<br>line2: **Lyrics and list background is specifically dimmed to make text readable** | — | — | — |
| 5 | `aa_bg_gradient` | Seekbar | Background Gradient | %d | — | **0–10** | — |
| 6 | `aa_bg_gradient_color` | **Color** | Background Gradient Color | %s | `#FF000000` | — | — |
| 7 | `aa_bg_gradient_for_list` | MultilineSwitch | Background Gradient For Lists | Also apply background gradient for list background | — | — | — |
| 8 | *（无 key）* | RawText | — | **Skin may override and disable this option** | — | — | — |
| 9 | `aa_blur` | Seekbar | Background Blur | %d | **5** | **0–15** | `aa_blur_enabled` |
| 10 | `aa_blur_scale` | Seekbar | Background Details | %d | **5** | **0–10** | `aa_blur_enabled` |
| 11 | `aa_blur_intensity` | Seekbar | Background Intensity | %d%% | **100** | **0–250** | `aa_blur_enabled` |
| 12 | *（无 key）* | RawText | — | Some skins may adjust this option to make text readable | — | — | — |
| 13 | `aa_blur_saturation` | Seekbar | Background Saturation | %d%% | **150** | **0–300**, step 10 | `aa_blur_enabled` |
| 14 | *（无 key）* | RawText | — | Some skins may adjust this option to make text readable | — | — | — |
| 15 | `restore_defaults` | Preference | Restore Defaults | — | — | — | — |

### 2.1 两个系统的分界

页面虽然只有 15 个元素，但实际分为**两个独立子系统**：

| 子系统 | 元素 | 说明 |
| --- | --- | --- |
| **模糊（Blur）** | #1-3 开关 + #9-13 参数 | 控制模糊背景的 4 个维度 |
| **渐变（Gradient）** | #5-7 | 在背景上叠加渐变遮罩，与模糊无关 |

> **两套互不影响**：`aa_bg_gradient*` 三项**没有** `dependency="aa_blur_enabled"`，即使关闭模糊，渐变仍然生效。

### 2.2 三个开关的层级关系

```
aa_blur_enabled          ← 主开关
  ├─ list_aa_blur_enabled      ← 列表背景（depends on 主开关）
  └─ lyrics_aa_blur_enabled    ← 歌词背景（depends on 主开关）
```

> **子开关是"独立开关"而非"子功能"**：主开关关闭时，两个子开关变灰；但主开关打开时，两个子开关**仍可单独关闭**——即可以"只给列表加模糊，不给歌词加"。

### 2.3 4 个数值参数的实际含义

| key | 标题 | 范围 | 默认 | 滑块两端标签 | 实际含义 |
| --- | --- | --- | ---: | --- | --- |
| `aa_blur` | Background Blur | 0–15 | 5 | **Less … More** | 模糊半径 |
| `aa_blur_scale` | Background Details | 0–10 | 5 | **Solid Color … Detailed** | 下采样倍率（越大越清晰） |
| `aa_blur_intensity` | Background Intensity | 0–250 | 100 | — | 模糊层不透明度 |
| `aa_blur_saturation` | Background Saturation | 0–300 | 150 | — | 色彩饱和度 |

> **默认值组合的含义**：模糊 5 + 细节 5 + 亮度 100% + 饱和度 150%。饱和度默认 **150%** 而非 100%，说明默认就做了**色彩增强**——模糊后颜色会变灰，需要提饱和来补偿。

> **`aa_blur_intensity` 上限 250%** 说明允许"过曝"叠加，不只是 0-100% 的衰减。

### 2.4 全部元素属性与资源引用

#### XML 属性使用矩阵

| 属性 | 出现元素 | 作用 |
| --- | --- | --- |
| `android:key` | 11 个 | 无 key 的 4 个是纯提示块 |
| `android:title` | 全部可交互项 | 主标题 |
| `android:summary` | 3 个 | `aa_bg_gradient_for_list` 与 4 个 Seekbar 用（多数是格式符） |
| `android:defaultValue` | **5 个 Seekbar/开关** | `aa_blur`=5、`aa_blur_scale`=5、`aa_blur_intensity`=100、`aa_blur_saturation`=150（其余靠 XML 缺失→代码默认） |
| `android:dependency` | 5 个 | 4 个 Seekbar + 2 个子开关 |
| `w:min` / `w:max` | 5 个 Seekbar | 范围界定 |
| `w:step` | 1 个 | 仅 `aa_blur_saturation`，step=10 |
| `w:leftLabel` / `w:rightLabel` | 3 个 | `aa_bg_gradient`、`aa_blur`、`aa_blur_scale` |
| `w:tickMark` | 3 个 | 同一资源 `@drawable/pref_seekbar_tickmark` |
| `w:line1` | 2 个 RawText | 提示块主体文案 |
| `w:smallLine1` | 2 个 RawText | 强度/饱和度下方的灰字提示 |
| `w:keepPaddings` | 3 个 RawText | 保留内边距（提示块视觉） |
| `w:zeroTopPad` | 2 个 RawText | 去掉上内边距（紧贴上一元素） |
| `android:background` | 4 个 RawText | 全部为 `@drawable/settings_quote_background`（引用样式） |

#### 三个带端点标签的滑杆

| key | 左标签 | 右标签 | 刻度条 |
| --- | --- | --- | --- |
| `aa_bg_gradient` | **None** | **Max**（`maximum_short`） | ✓ |
| `aa_blur` | **Less** | **More** | ✓ |
| `aa_blur_scale` | **Solid Color** | **Detailed** | ✓ |

> **只有这 3 个滑杆有端点标签和刻度条**——因为它们是"有方向感"的参数（越多/越少、越简/越细）。
>
> `aa_blur_intensity` 和 `aa_blur_saturation` **没有**端点标签和 tickMark，因为它们是纯百分比数值。

#### 两个无刻度滑杆的格式

| key | summary 资源 | 渲染结果 |
| --- | --- | --- |
| `aa_blur_intensity` | `d_percent` | `%d%%` → 如 `100%` |
| `aa_blur_saturation` | `d_percent` | `%d%%` → 如 `150%` |
| `aa_blur` / `aa_blur_scale` / `aa_bg_gradient` | `_d` | `%d` → 纯数字 |

#### 4 个提示块的完整文案

| # | 资源 | 类型 | 原文 |
| ---: | --- | --- | --- |
| 4 | `pref_aa_bg_skins_hint` | line1 | Skins may override, change, or completely disable background |
| 4 | `pref_lyrics_lust_bg_dimmed_hint` | line2 | Lyrics and list background is specifically dimmed to make text readable |
| 8 | `skin_may_override_option` | line1 | Skin may override and disable this option |
| 12 | `pref_aa_blur_intensity_hint` | smallLine1 | Some skins may adjust this option to make text readable |
| 14 | `pref_aa_blur_intensity_hint` | smallLine1 | （同上，复用同一资源） |

> **`pref_aa_blur_intensity_hint` 被用了两次**（强度后、饱和度后），文案完全相同。
>
> 但注意它说的是"**intensity**"，却同时出现在饱和度下方——说明这段文案是**泛指所有数值项**，不是特指强度。

#### 提示块与元素的相对位置

```
#1 aa_blur_enabled
#2 list_aa_blur_enabled        ← 依赖 #1
#3 lyrics_aa_blur_enabled      ← 依赖 #1
#4 提示块（line1+line2）        ← 紧跟三个开关之后
#5 aa_bg_gradient
#6 aa_bg_gradient_color
#7 aa_bg_gradient_for_list
#8 提示块（line1）              ← 紧跟渐变三项之后
#9  aa_blur                     ← 依赖 #1
#10 aa_blur_scale               ← 依赖 #1
#11 aa_blur_intensity           ← 依赖 #1
#12 提示块（smallLine1）        ← 紧跟 intensity
#13 aa_blur_saturation          ← 依赖 #1
#14 提示块（smallLine1）        ← 紧跟 saturation
#15 restore_defaults
```

> **提示块的分布规律**：
> - `#4` 在**开关组**之后 → 说明整体行为
> - `#8` 在**渐变组**之后 → 说明渐变可被覆盖
> - `#12` / `#14` 分别紧跟 intensity / saturation → 说明这两项**可能被皮肤微调**
>
> 注意 `#9` 和 `#10`（blur / scale）**没有**对应提示块——因为它们不会被皮肤调整，只受用户控制。

---
## 3. 偏好存储与默认值

`wr.smali` 的 `<clinit>` 把 10 个 key 全部绑定到静态字段【实证·产物】：

| key | wr 字段 | 读取方法 | 默认值 | 行号 |
| --- | --- | --- | --- | ---: |
| `aa_blur_enabled` | **`wr->m`** | `с(String, boolean)` | false | `:763` |
| `aa_blur` | **`wr->n`** | `b(int, String)` | **5** | `:779` |
| `aa_blur_intensity` | **`wr->q`** | `b(int, String)` | **100 (0x64)** | `:798` |
| `aa_blur_scale` | **`wr->r`** | `b(int, String)` | **5** | `:818` |
| `aa_blur_saturation` | **`wr->s`** | `b(int, String)` | **150 (0x96)** | `:834` |
| `lyrics_aa_blur_enabled` | **`wr->h0`** | `с(String, boolean)` | false | `:1393` |
| `list_aa_blur_enabled` | **`wr->i0`** | `с(String, boolean)` | false | `:1409` |
| `aa_bg_gradient` | **`wr->q0`** | `b(int, String)` | 0 | `:1619` |
| `aa_bg_gradient_color` | **`wr->r0`** | `d(String, String)` | **`#FF000000`** | `:1635` |
| `aa_bg_gradient_for_list` | **`wr->s0`** | `с(String, boolean)` | false | `:1655` |

> **`д(String, String)` 是颜色类型**——`wr->r0` 的类型是 `ub1`（String 载体），默认 `#FF000000`（纯黑）。

> **字段时间顺序很有意思**：模糊系列占 `m/n/q/r/s`（连续），渐变系列占 `q0/r0/s0`（连续）——说明它们是在不同时期加入 `wr` 的。

## 4. 设置页绑定（`y61.smali`）

`y61.smali`（25783 字节）是本页的 helper，在 `onBusMsg` 的 `:pswitch_1` 分支里完成绑定【实证·产物】`y61.smali:811-1030`。

### 4.1 三组 listener

| listener 字段 | 绑定的 key | 作用 |
| --- | --- | --- |
| **`n91->g`**（`c91`） | `aa_blur_enabled`、`lyrics_aa_blur_enabled`、`list_aa_blur_enabled` | 三个开关**共用**一个监听器 |
| **`y61->k`**（`tc`） | `aa_blur`、`aa_blur_scale`、`aa_blur_intensity`、`aa_blur_saturation`、`aa_bg_gradient`、`aa_bg_gradient_color` | 六个数值/颜色项共用 |

```asm
; 三个开关共用 c91
const-string v1, "aa_blur_enabled"
invoke-virtual {v0, v1}, PreferenceGroup;->findPreference(...)
iget-object v1, p0, Lׅ/n91;->g:Lׅ/c91;
invoke-virtual {v0, v1}, Preference;->setOnPreferenceChangeListener(...)
; lyrics_aa_blur_enabled / list_aa_blur_enabled 用同一个 v1

; 数值项共用 tc
const-string v1, "aa_blur"
iget-object v1, p0, Lׅ/y61;->k:Ljava/lang/Object;
check-cast v1, Lׅ/tc;
invoke-virtual {v0, v1}, Preference;->setOnPreferenceChangeListener(...)
; aa_blur_scale/intensity/saturation 用同一个 v1
```

> **`aa_bg_gradient_for_list` 是唯一例外**——它走 `:cond_1` 分支（有 null 检查），说明该监听器可能被跳过。见 `y61.smali:1029` 的 `if-eqz v0, :cond_1`。

## 5. 渲染消费链（核心）

**所有参数最终由 `MilkWidget.Х()` 写入 `MilkLoader`** 【实证·产物】`MilkWidget.smali:1840-2000`：

```java
void Х() {
    MilkLoader loader = milkRenderer.х;

    // ① Background Blur → 直接赋值
    loader.К = wr->n.А;                      // aa_blur

    // ② Background Details → 转成位移量
    int scale = wr->r.А;                     // aa_blur_scale
    if (scale < 10)
        loader.K = 1 << scale;               // ★ 2^scale
    else
        loader.K = 0x7FFFFFFF;               // 饱和

    // ③ Background Saturation → float，×100 归一
    loader.y = (wr->s.А / 100.0f) * this.К;  // this.К 是主题系数

    // ④ Background Intensity → float，×100 归一
    loader.у = (wr->q.А / 100.0f) * this.К;

    // ⑤ 渐变
    int gradient = wr->q0.А;                 // aa_bg_gradient
    String color = wr->r0.А;                 // aa_bg_gradient_color
    boolean forList = this.Н && wr->s0.А;    // aa_bg_gradient_for_list
    ...
}
```

**`MilkLoader` 的字段映射**：

| XML key | 中间字段 | MilkLoader 字段 | 字段类型 | 转换 |
| --- | --- | --- | --- | --- |
| `aa_blur` | `wr->n` | **`К`**（西里尔 Ka） | **int** | 直传 |
| `aa_blur_scale` | `wr->r` | **`K`**（拉丁 K） | **int** | **`1 << scale`** |
| `aa_blur_intensity` | `wr->q` | **`у`**（西里尔 u） | **float** | `value/100 × 主题系数` |
| `aa_blur_saturation` | `wr->s` | **`y`** | **float** | `value/100 × 主题系数` |
| `aa_bg_gradient` | `wr->q0` | **`Н`** | **int** | 直传 |
| `aa_bg_gradient_color` | `wr->r0` | **`H`** | **String** | 直传 |
| `aa_bg_gradient_for_list` | `wr->s0` | **`Р`** | **boolean** | 与 `this.Н` 做 AND |

> **字段名与类型均取自 `MilkLoader` 的真实声明**（`MilkLoader.smali:15,31,37,53` 等）：
> `K:I` / `К:I` / `Н:I` / `H:Ljava/lang/String;` / `y:F` / `у:F` / `Р:Z`
>
> ⚠️ **上一轮文档此处有误**：曾把 `К`/`K` 写成 float、把渐变三项写成"局部变量"，实际它们都是 `MilkLoader` 的字段（见 §5.3）。

> ⚠️ **`К`（西里尔 Ka）与 `K`（拉丁 K）是两个不同字段**，且**都是 int**（不是 float）。这是混淆后的产物，容易看错。

### 5.1 `aa_blur_scale` 的位移语义

```asm
1872: const/4 v2, 0x1
1875: const/16 v3, 0xa          ; 10
1879: if-ge v0, v3, :cond_0     ; scale < 10 ?
1883: shl-int v0, v2, v0        ; ★ 1 << scale
1890: :cond_0
1891: const v0, 0x7fffffff      ; 上限饱和
```

**位移含义**：

| scale | `1 << scale` | 含义（推断） |
| ---: | ---: | --- |
| 0 | 1 | 1× 下采样 → 最模糊（**Solid Color**） |
| 5（默认） | 32 | 32× |
| 9 | 512 | 512× |
| 10+ | `0x7FFFFFFF` | 饱和（**Detailed**） |

> **注意方向**：`scale` 越大 → `1 << scale` 越大 → 采样越精细 → 画面越清晰。这与滑块标签 `Solid Color … Detailed` 一致。
>
> 但 **`scale=0 → 1`** 对应"Solid Color"（纯色），意味着本质上只取 1 个采样点，整块背景变成单一颜色。

### 5.2 皮肤乘数 `this.К` / `this.K`（详见 §5.4）

强度和饱和度都乘以 `this.К`（`MilkWidget` 的 float 字段）：

```asm
1919: iget v5, p0, Lcom/maxmpz/widget/player/MilkWidget;->К:F
1923: mul-float v0, v0, v5
```

> **背景会被刻意压暗**：提示块 line2 明说"Lyrics and list background is specifically dimmed to make text readable"——这是与强度/饱和度参数配合的独立机制。
>
> **这是皮肤系统的接入点**：`this.К` 来自皮肤 XML 的 `w:aaBlurSaturationMult`，`this.K` 来自 `w:aaBlurIntensityMult`（默认均为 1.0）。皮肤通过改这两个乘数整体缩放效果，不碰用户的设置值。完整 attr 表见 **§5.4**。


### 5.3 `MilkLoader` 字段全表与写入方

【实证·产物】`MilkLoader.smali` 的字段声明：

| 字段 | 类型 | 谁写入 | 语义 |
| --- | --- | --- | --- |
| `К` | **int** | MilkWidget / MilkFRS | 模糊级别（`aa_blur`） |
| `K` | **int** | MilkWidget / MilkFRS | 采样倍率（`1 << aa_blur_scale`） |
| `y` | **float** | MilkWidget / MilkFRS | 饱和度 |
| `у` | **float** | MilkWidget / MilkFRS | 强度 |
| `Н` | **int** | MilkWidget | 渐变强度（`aa_bg_gradient`） |
| `H` | **String** | MilkWidget | 渐变颜色（`aa_bg_gradient_color`） |
| `Р` | **boolean** | MilkWidget | 列表渐变开关（`aa_bg_gradient_for_list`） |
| `P` | `[Lׅ/f0;` | MilkWidget | 封面位图数组 |
| `o` | int | MilkWidget | （未解，`Х()` 末尾写入） |

> **`MilkFRS`（均衡器频谱）也写同样的 4 个字段**（`MilkFRS.smali:194,204,216,226`），说明**背景模糊参数对两个视图共享**——播放页的可视化和均衡器的频谱柱用的是同一套模糊配置。

> **`MilkWidget` 在全 App 中零静态引用**（无 `new-instance`、无布局声明）——它由 LayoutInflater 从 XML 动态实例化，或由原生侧通过 JNI 构造。这一点未完全确认。

### 5.4 皮肤通过 18 个自定义 attr 注入参数

`MilkWidget` 的构造器用 `Lׅ/st0;->В:[I`（**18 个 attr id**）调 `obtainStyledAttributes`，把皮肤定义的属性读进字段【实证·产物】：

| 索引 | attr 名 | 目标字段 | 类型/默认 |
| ---: | --- | --- | --- |
| 0 | `bgColor` | — | color, `0xFF000000` |
| 1 | `aaBgColor` | — | color, `-1` |
| 2 | `clipRadius` | — | float, 1.0 |
| 3 | `delayedInit` | — | float, 1.0 |
| 4 | `aaBlurScaleSize` | — | float, 1.0 |
| 5 | `aaBlurLevel` | — | float, 1.0 |
| 6 | `aaBlurSaturation` | — | float, 1.0 |
| 7 | `aaBlurIntensity` | — | float, 1.0 |
| 8 | `aaBlurDarken` | — | float, 1.0 |
| **9** | **`aaBlurIntensityMult`** | **`K`**（int） | float, **1.0** |
| 10 | `aaBlurLighten` | — | float, 0.0 |
| 11 | `aaBlurPinLight` | — | float, -1.0 |
| **12** | **`aaBlurSaturationMult`** | **`К`**（float） | float, **1.0** |
| 13 | `aaEffectList` | — | resourceId |
| 14 | `aaEffectReadable` | — | resourceId |
| 15 | `aaSolidColorTarget` | — | int |
| **16** | **`aaAllowBgGradientForList`** | **`Н`**（final boolean） | boolean |
| 17 | `aaEffectBlendedMain` | — | resourceId |

> **这解开了 §5.2 的谜团**：`this.К` / `this.K` **不是运行时计算的主题系数，而是皮肤在 XML 里声明的乘数属性**（默认都是 1.0）。
>
> 所以皮肤要"调整强度"只需写：
> ```xml
> <com.maxmpz.widget.player.MilkWidget
>     w:aaBlurIntensityMult="0.8"
>     w:aaBlurSaturationMult="1.2" />
> ```

**`Н`（索引 16）的语义确认**：

```asm
; MilkWidget 构造器 L228-235
const/16 v0, 0x10                      ; 索引 16
invoke-virtual {v14, v0, v13}, TypedArray;->getBoolean(IZ)Z
iput-boolean v0, v2, MilkWidget;->Н:Z
```

> `aaAllowBgGradientForList` —— **皮肤是否允许把背景渐变应用到列表页**。
>
> `Х()` 里的 `boolean forList = this.Н && wr->s0.А` 因此是**双重许可**：
> 用户开了 `aa_bg_gradient_for_list` **且** 皮肤允许 `aaAllowBgGradientForList`，渐变才用到列表。
>
> 这与提示块 #4 的 "Skins may ... completely disable background" 完全对应——**皮肤有一票否决权**。


### 5.5 18 个 attr 的完整流转链（寄存器级）

**这是本节的核心**：`MilkWidget` 构造器读取的 18 个 attr，最终只有 **12 个**真正落到字段，其余 6 个在构造器里转手传给下游。

#### 构造器整体流程

```asm
; MilkWidget.<init>(Context, AttributeSet, int, int)
L72:  sget-object v0, Lׅ/st0;->В:[I        ; 18 个 attr id
L80:  obtainStyledAttributes(attrs, v0, defStyleAttr, defStyleRes) → v14

; ── 第 1 组：2 个 color → 局部变量 v5 / v6 ──
L89:  v5 = t.getColor(0,  0xFF000000)      ; bgColor
L96:  v6 = t.getColor(1,  0xFFFFFFFF)      ; aaBgColor

; ── 第 2 组：2 个 mult → 直接存字段 ──
L105: v1 = t.getFloat(0xC, 1.0f)           ; aaBlurSaturationMult
L109: iput v1, MilkWidget->К:F            ; ★ 存字段 К
L114: v1 = t.getFloat(0x9, 1.0f)           ; aaBlurIntensityMult
L118: iput v1, MilkWidget->K:F            ; ★ 存字段 K

; ── 第 3 组：1 个 int + 3 个 float → 局部变量 ──
L123: v7  = t.getInt  (0xF, -1)            ; aaSolidColorTarget
L132: v8  = t.getFloat(0xB, -1.0f)         ; aaBlurPinLight
L141: v9  = t.getFloat(0xA,  0.0f)         ; aaBlurLighten
L148: v10 = t.getFloat(0x8,  1.0f)         ; aaBlurDarken

; ── 第 4 组：3 个 resourceId → 查成 f0 对象 → 数组 ──
L155: r0 = t.getResourceId(0xE, 0)         ; aaEffectReadable
L159: v0 = ih0.P(ctx, r0)                  ; → f0
L166: r1 = t.getResourceId(0xD, 0)         ; aaEffectList
L170: v1 = ih0.P(ctx, r1)                  ; → f0
L177: r3 = t.getResourceId(0x11, 0)        ; aaEffectBlendedMain
L181: v3 = ih0.P(ctx, r3)                  ; → f0
L188: v4 = new f0[3]
L190: v4[0] = v0   ; aaEffectReadable
L192: v4[1] = v1   ; aaEffectList
L196: v4[2] = v3   ; aaEffectBlendedMain

; ── 创建 MilkRenderer ──
L205: v3 = 0x2                             ; 常量
L210: v4 = dw.A                            ; 全局 boolean
L214: v11 = 0x0                            ; 常量
L218: new MilkRenderer(ctx, this, 2, dw.A, v5, v6, v7, v8, v9, v10, 0.0f)
L223: loader->P = v4                       ; ★ 3 个 f0 数组存入 MilkLoader->P

; ── 第 5 组：1 个 boolean → 字段 ──
L231: v0 = t.getBoolean(0x10, true)        ; aaAllowBgGradientForList（默认 true）
L235: iput-boolean v0, MilkWidget->Н:Z    ; ★ 存字段 Н

L238: t.recycle()
```

#### 18 个 attr 的最终去向

| 索引 | attr | 去向 | 最终落点 |
| ---: | --- | --- | --- |
| 0 | `bgColor` | 局部 v5 | → `MilkRenderer` 构造器 p5 → **`MilkLoader->A`**（`0xFF000000 OR p2`） |
| 1 | `aaBgColor` | 局部 v6 | → `MilkRenderer` 构造器 p6 → **`MilkLoader->х`** |
| 2 | `clipRadius` | — | **MilkFRS 专用**（索引 2 → `getFloat`） |
| 3 | `delayedInit` | — | **MilkFRS 专用**（索引 3 → 未在本构造器读到） |
| 4 | `aaBlurScaleSize` | — | **MilkFRS 专用**（索引 4 → `MilkLoader->K`，默认 `0x20`=32） |
| 5 | `aaBlurLevel` | — | **MilkFRS 专用**（索引 5 → `MilkLoader->К`，默认 0） |
| 6 | `aaBlurSaturation` | — | **MilkFRS 专用**（索引 6 → `MilkLoader->y`，默认 1.0） |
| 7 | `aaBlurIntensity` | — | **MilkFRS 专用**（索引 7 → `MilkLoader->у`，默认 1.0） |
| 8 | `aaBlurDarken` | 局部 v10 | → `MilkRenderer` p10 → **`MilkLoader->x:F`** |
| **9** | `aaBlurIntensityMult` | **字段** | **`MilkWidget->K:F`** |
| 10 | `aaBlurLighten` | 局部 v9 | → `MilkRenderer` p9 → **`MilkLoader->X:F`** |
| 11 | `aaBlurPinLight` | 局部 v8 | → `MilkRenderer` p8 → **`MilkLoader->Х:F`** |
| **12** | `aaBlurSaturationMult` | **字段** | **`MilkWidget->К:F`** |
| 13 | `aaEffectList` | 数组[1] | → **`MilkLoader->P[1]`** |
| 14 | `aaEffectReadable` | 数组[0] | → **`MilkLoader->P[0]`** |
| 15 | `aaSolidColorTarget` | 局部 v7 | → `MilkRenderer` p7 → **`MilkLoader->?`** |
| **16** | `aaAllowBgGradientForList` | **字段** | **`MilkWidget->Н:Z`** |
| 17 | `aaEffectBlendedMain` | 数组[2] | → **`MilkLoader->P[2]`** |

> ✅ **索引 2-7 不是死读，而是 `MilkFRS` 专用**！
>
> `MilkWidget` 构造器确实不读这 6 个索引，但 **`MilkFRS` 构造器正好读它们**（见 §5.6）。同一个 `st0->В` 数组被两个 View 共用，各自取不同的子集。

#### `MilkRenderer` → `MilkLoader` 的参数传递

`MilkRenderer` 构造器签名：`(Context, View, I, I, I, I, I, F, F, F, F)`【实证·产物】：

```asm
; MilkRenderer.<init> 内的字段赋值
L193: iput-object p2, MilkRenderer->р:Landroid/view/View;   ; View
L197: iput-object p1, MilkRenderer->K:Landroid/content/Context;
L201: iput p3, MilkRenderer->D:I                            ; = 0x2
L208: iput p4, MilkRenderer->о:I                            ; = dw.A
L215: iput p5, MilkRenderer->b:I                            ; = bgColor
L223: iput p6, MilkRenderer->d:I                            ; = aaBgColor
L231: iput p11, MilkRenderer->O:F                           ; = 0.0f

; 再把 p7-p10 传给 MilkLoader
L283: new MilkLoader(ctx, p7, p8, p9, p10)
      ; MilkLoader(Context, I, F, F, F)
```

**`MilkLoader` 构造器的参数映射**【实证·产物】`MilkLoader.smali:189-212`：

```asm
L189: const/high16 p1, -0x1000000        ; 0xFF000000（不透明黑）
L193: or-int/2addr p1, p2                ; ★ A = 0xFF000000 | p2
L196: iput p1, MilkLoader->A:I
L200: iput p3, MilkLoader->х:I           ; 来自 MilkRenderer p7 = aaSolidColorTarget
L204: iput p4, MilkLoader->Х:F           ; 来自 MilkRenderer p8 = aaBlurPinLight
L208: iput p5, MilkLoader->X:F           ; 来自 MilkRenderer p9 = aaBlurLighten
L212: iput p6, MilkLoader->x:F           ; 来自 MilkRenderer p10 = aaBlurDarken
```

> **`A = 0xFF000000 | bgColor`** 这行很关键——它强制 alpha 为不透明，只保留 RGB。所以 `w:bgColor` 的 alpha 通道**被丢弃**。

#### 三个 blur 混合参数

| 索引 | attr | 默认 | → MilkLoader 字段 | 推断语义 |
| ---: | --- | ---: | --- | --- |
| 8 | `aaBlurDarken` | **1.0** | `x:F` | 变暗系数（1.0 = 不暗） |
| 10 | `aaBlurLighten` | **0.0** | `X:F` | 变亮系数（0.0 = 不变亮） |
| 11 | `aaBlurPinLight` | **-1.0** | `Х:F` | PinLight 混合（**-1.0 = 禁用**） |

> **三个默认值共同构成"无效果"基线**：暗化 1.0（不暗）、亮化 0.0（不亮）、PinLight -1.0（禁用）。
>
> `-1.0` 作为"禁用"哨兵值是常见做法——因为混合系数正常范围是 0.0–1.0，负数不可能出现。

#### 三个 effect 资源

`aaEffectReadable` / `aaEffectList` / `aaEffectBlendedMain` 各自经 `ih0.P(ctx, resId)` 转成 `ׅ/f0` 对象，组成 3 元素数组存入 `MilkLoader->P`：

```asm
L188: new-array v4, 0x3, [Lׅ/f0;
L190: aput-object v0, v4, 0     ; aaEffectReadable
L192: aput-object v1, v4, 1     ; aaEffectList
L196: aput-object v3, v4, 2     ; aaEffectBlendedMain
```

> **`P` 数组的 3 个槽位语义**（推断）：
> - `[0]` **Readable** —— 保证文字可读的模糊效果（对应提示块"make text readable"）
> - `[1]` **List** —— 列表背景专用效果
> - `[2]` **BlendedMain** —— 主界面混合效果
>
> 这解释了为什么提示块说"皮肤可调整"——**皮肤能替换这 3 个效果资源，从而改变模糊的观感而不只是数值**。

### 5.6 `MilkFRS` 与 `MilkWidget` 的 attr 分工（纠正 §5.5）

**同一个 `st0->В` 数组（18 个 attr）被两个 View 共用，各自取不同子集。**

#### `MilkFRS` 的构造器

`MilkFRS` 继承 **`TextureView`**（不是 `SurfaceView`），构造器【实证·产物】`MilkFRS.smali:85-230`：

```asm
; MilkFRS.<init>(Context, AttributeSet, int, int)
L102: sget-object v0, Lׅ/st0;->В:[I          ; 同一个 18 个 attr 数组
L104: obtainStyledAttributes(...) → v0

L113: v5 = t.getColor(0, 0xFF000000)          ; bgColor
L120: v6 = t.getColor(1, 0xFF000000)          ; aaBgColor
L124: if (v5 != 0 && v6 != 0) → 跳过
L130: setOpaque(false)                        ; ★ 任一为 0 → 设为透明

L138: v11 = t.getFloat(2, 0.0f)               ; ★ clipRadius

; 创建 MilkRenderer —— 注意这里传的常量不同
L177: new MilkRenderer(ctx, this,
        1,      ; p3 = 1   (MilkWidget 传 2)
        1,      ; p4 = 1   (MilkWidget 传 dw.A)
        ...
      )
L180: iput v0, bf0->y                         ; 存到父类字段

; ── 4 个 blur 参数直接写 MilkLoader ──
L187: v1 = t.getFloat(6, 1.0f)                ; ★ index 6 = aaBlurSaturation
L194: iput v1, MilkLoader->y:F                ; 饱和度

L199: v1 = t.getInteger(5, 0)                 ; ★ index 5 = aaBlurLevel
L204: iput v1, MilkLoader->К:I                ; 模糊级别

L211: v1 = t.getInteger(4, 0x20)              ; ★ index 4 = aaBlurScaleSize
L216: iput v1, MilkLoader->K:I                ; 采样倍率（默认 0x20 = 32）

L221: v1 = t.getFloat(7, 1.0f)                ; ★ index 7 = aaBlurIntensity
L226: iput v1, MilkLoader->у:F                ; 强度
```

#### 两个 View 的 attr 分工表

| 索引 | attr | `MilkWidget` | `MilkFRS` |
| ---: | --- | --- | --- |
| 0 | `bgColor` | ✅ 读（→ `MilkLoader->A`） | ✅ 读（透明度判断） |
| 1 | `aaBgColor` | ✅ 读（→ `MilkLoader->х`） | ✅ 读（透明度判断） |
| 2 | `clipRadius` | ❌ | ✅ **读**（局部 v11） |
| 3 | `delayedInit` | ❌ | ❌ |
| 4 | `aaBlurScaleSize` | ❌ | ✅ **读** → `MilkLoader->K`（默认 **0x20**） |
| 5 | `aaBlurLevel` | ❌ | ✅ **读** → `MilkLoader->К`（默认 0） |
| 6 | `aaBlurSaturation` | ❌ | ✅ **读** → `MilkLoader->y`（默认 1.0） |
| 7 | `aaBlurIntensity` | ❌ | ✅ **读** → `MilkLoader->у`（默认 1.0） |
| 8 | `aaBlurDarken` | ✅ 读（→ `MilkLoader->x`） | ❌ |
| 9 | `aaBlurIntensityMult` | ✅ 读 → `MilkWidget->K` | ❌ |
| 10 | `aaBlurLighten` | ✅ 读（→ `MilkLoader->X`） | ❌ |
| 11 | `aaBlurPinLight` | ✅ 读（→ `MilkLoader->Х`） | ❌ |
| 12 | `aaBlurSaturationMult` | ✅ 读 → `MilkWidget->К` | ❌ |
| 13 | `aaEffectList` | ✅ 读 → `MilkLoader->P[1]` | ❌ |
| 14 | `aaEffectReadable` | ✅ 读 → `MilkLoader->P[0]` | ❌ |
| 15 | `aaSolidColorTarget` | ✅ 读（→ `MilkRenderer` p7） | ❌ |
| 16 | `aaAllowBgGradientForList` | ✅ 读 → `MilkWidget->Н` | ❌ |
| 17 | `aaEffectBlendedMain` | ✅ 读 → `MilkLoader->P[2]` | ❌ |

**统计**：`MilkWidget` 读 **13 个**，`MilkFRS` 读 **6 个**，交集只有 **2 个**（索引 0/1），索引 3（`delayedInit`）**两边都不读**。

#### 关键修正：同一个字段，两套语义

**`MilkLoader` 的 `К` / `K` / `y` / `у` 被两个 View 写入，但来源完全不同**：

| 字段 | `MilkWidget` 写入来源 | `MilkFRS` 写入来源 |
| --- | --- | --- |
| `К`（int） | **用户设置** `aa_blur`（0–15） | **皮肤 attr** `aaBlurLevel`（默认 0） |
| `K`（int） | **用户设置** `1 << aa_blur_scale`（1–512） | **皮肤 attr** `aaBlurScaleSize`（默认 32） |
| `y`（float） | **用户设置** `aa_blur_saturation/100 × К` | **皮肤 attr** `aaBlurSaturation`（默认 1.0） |
| `у`（float） | **用户设置** `aa_blur_intensity/100 × K` | **皮肤 attr** `aaBlurIntensity`（默认 1.0） |

> **这是本页最重要的架构洞察**：
>
> - **`MilkWidget`（播放页可视化）** 的模糊参数来自 **`aa_bg.xml` 的用户设置** —— 即本页调查的 10 个 key
> - **`MilkFRS`（均衡器频谱）** 的模糊参数来自 **皮肤 attr** —— 用户在设置页**改不到**
>
> 所以「背景」页面**只影响播放页的可视化背景，不影响均衡器的频谱柱背景**。均衡器那边由皮肤说了算。
>
> 这与 `vis_frs_type`（均衡器频谱样式，见可视化文档 §2.3）形成互补：**均衡器的视觉完全由皮肤+独立设置控制，与本页无关**。

#### 默认值印证

`MilkFRS` 的 `aaBlurScaleSize` 默认 **`0x20` = 32**，恰好等于 `MilkWidget` 在 `aa_blur_scale = 5`（默认值）时算出的 `1 << 5 = 32`。

> **这不是巧合**——两套路径在默认配置下**收敛到同一个值**，保证均衡器和播放页的模糊程度视觉一致。

#### `MilkFRS` 的透明度判断

```asm
L113: v5 = t.getColor(0, 0xFF000000)      ; bgColor
L120: v6 = t.getColor(1, 0xFF000000)      ; aaBgColor
L124: if (v5 != 0 && v6 != 0) → :cond_1
L130: setOpaque(false)                     ; 任一为 0 → 透明
```

> **两个颜色都为 0 时才设透明**——逻辑是"只要有一个非零就不透明"。这是 `TextureView` 的优化：不透明可以跳过 alpha 合成。

> 注意 `MilkWidget` 里 `aaBgColor` 的默认是 `-1`（`0xFFFFFFFF`），而 `MilkFRS` 里是 `0xFF000000`——**同一个 attr、不同默认值**。
## 6. 三个提示块的作用

| # | 提示文案 | 位置 | 作用 |
| ---: | --- | --- | --- |
| 4 | **Skins may override, change, or completely disable background**<br>**Lyrics and list background is specifically dimmed to make text readable** | 三开关之后 | 说明皮肤可完全接管；并说明**歌词/列表背景会被刻意压暗**以保文字可读 |
| 8 | **Skin may override and disable this option** | 渐变三项之后 | 仅针对渐变 |
| 12/14 | Some skins may adjust this option to make text readable | 强度/饱和度之后 | 说明皮肤会**微调**而非接管 |

> **三种提示的语义差别**：
> - #4 **"completely disable"** —— 皮肤能让整个背景功能失效
> - #8 **"override and disable"** —— 皮肤能让渐变项失效
> - #12/14 **"adjust"** —— 皮肤只是微调数值，不接管

这与外观文档 §4.5 的 `overlap` 覆盖机制一致：`overlapAttr` / `forceGlobalOptions` 决定覆盖强度。

## 7. 与皮肤系统的关系

本页是**外观分支中最受皮肤影响的一页**——15 个元素里有 **3 个提示块**专门说明皮肤行为。

| 机制 | 表现 |
| --- | --- |
| `forceGlobalOptions="true"` | 皮肤强制设定 `aa_blur_*` 的全局值 |
| `this.К` 主题系数 | 皮肤整体缩放强度/饱和度 |
| `overlapAttr` | 逐项覆盖（如禁用渐变） |

> 详见 `poweramp-look-and-feel-settings.md` §4.5。

## 8. 未解问题

### 8.1 已解决（累计）

| 问题 | 解决情况 | 位置 |
| --- | --- | --- |
| `MilkWidget->Н` 语义 | ✅ 来自皮肤 attr `aaAllowBgGradientForList`（默认 true） | §5.4 |
| `MilkWidget->К` 来源 | ✅ 皮肤 attr `aaBlurSaturationMult`（默认 1.0） | §5.4 |
| `MilkWidget->K` 来源 | ✅ 皮肤 attr `aaBlurIntensityMult`（默认 1.0） | §5.4 |
| `MilkLoader` 字段类型 | ✅ 全表已解（int/float/String/boolean） | §5.3 |
| 渐变三项落点 | ✅ `Н` / `H` / `Р` 三个字段 | §5.3 |
| **18 个 attr 的完整流转** | ✅ 逐索引到最终字段，含寄存器级追踪 | §5.5 |
| **索引 2-7 是否为死读** | ✅ **不是死读，是 `MilkFRS` 专用** | §5.6 |
| **`MilkWidth` vs `MilkFRS` 分工** | ✅ 同一数组两套子集，交集仅索引 0/1 | §5.6 |
| **两个 View 的参数来源差异** | ✅ Widget 用用户设置，FRS 用皮肤 attr | §5.6 |
| **索引 0/1/8/9/10/11/15 的落点** | ✅ 全部追踪到 `MilkRenderer` → `MilkLoader` | §5.5 |
| **索引 13/14/17 三个资源** | ✅ 组成 3 元素数组存入 `MilkLoader->P` | §5.5 |

### 8.2 仍未解

1. **`MilkWidget` 的实例化路径**：全 App 零静态引用（无 `new-instance`，280 个布局里无声明）。推测由 LayoutInflater 从动态构造的 XML 或 JNI 构造，未确认。
2. **索引 3 `delayedInit`**：`MilkWidget` 和 `MilkFRS` **两边都不读**——确认是唯一真正未使用的 attr。但 `poweramp_logo_pref_milk.xml` 里用了 `w:delayedInit="true"`，说明它有作用，实际生效点在别处（可能在 `bf0` 父类）。
3. **`MilkLoader->P` 数组的实际消费**：3 个 `ׅ/f0` 对象存入后，native 侧如何使用未反汇编。
4. **`ׅ/f0` 是什么**：`ih0.P(ctx, resId)` 返回的类型，从 resourceId 解析，语义未查。
5. **`MilkFRS` 的 `p3=1` / `p4=1` 常量**：与 `MilkWidget` 的 `p3=2` / `p4=dw.A` 不同，含义未解。
6. **`MilkLoader->o` 字段**：`Х()` 末尾写入（`MilkWidget.smali:2065`），初始值 `0x80000000`，语义未解。
7. **`aa_blur_scale >= 10` 的饱和值 `0x7FFFFFFF`**：实际传给 native 后的处理未验证。
8. **`aa_bg_gradient` 0–10 的视觉量化**：数值如何映射到渐变强度未确认（`MilkLoader->Н` 的消费方未追）。
9. **18 个 attr 在第三方皮肤中的实际用法**：`poweramp_builtin_skins.xml` 里一个都没定义。

---

## 9. 证据索引

| 主题 | 路径 : 行 |
| --- | --- |
| 页面结构 / 15 元素 | `v1035/decoded/res/xml/aa_bg.xml:1-20` |
| 资源 id `0x7f160001` | `res/values/public.xml` |
| 全部文案 | `res/values/strings.xml`（26 条引用） |
| **wr 字段绑定** | `ׅ/wr.smali:763,779,798,818,834,1393,1409,1619,1635,1655` |
| 开关 listener 绑定 | `ׅ/y61.smali:811-874` |
| 数值项 listener 绑定 | `ׅ/y61.smali:883-1029` |
| **渲染消费 `Х()`** | `com/maxmpz/widget/player/MilkWidget.smali:1840-2000` |
| **MilkLoader 字段声明** | `com/maxmpz/milk/MilkLoader.smali:7-55` |
| **18 个皮肤 attr 数组** | `ׅ/st0.smali:56-76`（`array_0`）+ `res/values/public.xml` |
| 构造器读取 attr | `MilkWidget.smali:72-235` |
| **MilkWidget 完整寄存器流转** | `MilkWidget.smali:60-260` |
| **MilkRenderer 构造器字段赋值** | `MilkRenderer.smali:193-288` |
| **MilkLoader 构造器参数映射** | `MilkLoader.smali:189-212` |
| **MilkFRS 的 attr 读取** | `MilkFRS.smali:102-229` |
| `st0->В` 18 个 attr id | `ׅ/st0.smali:56-76` |
| `Н` 字段来源（索引 16） | `MilkWidget.smali:228-235` |
| MilkFRS 写同样 4 字段 | `com/maxmpz/widget/player/MilkFRS.smali:194,204,216,226` |
| 默认值初始化 | `com/maxmpz/audioplayer/Application.smali:3256-3291` |
| 渐变消费 | `MilkWidget.smali:1957-2000` |
| `s70` / `b70` 中的消费 | `ׅ/s70.smali:503,2273` / `ׅ/b70.smali:1195,1211` |
