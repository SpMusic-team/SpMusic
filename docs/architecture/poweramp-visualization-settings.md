---
doc_id: poweramp-visualization-settings
title: Poweramp「设置 → 可视化」偏好结构（build-1035）
doc_type: architecture
status: draft
owner_agent: lead
version_scope: build-1035-bundle-play (versionCode 1035009)
created: 2026-11-06
updated: 2026-11-06
source_documents:
  - .rea-analysis/v1035/decoded/res/xml/vis.xml
  - .rea-analysis/v1035/decoded/res/values/strings.xml
  - .rea-analysis/v1035/decoded/res/values/arrays.xml
  - .rea-analysis/v1035/decoded/smali/ׅ/w81.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/wr.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/te0.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/milk/
  - .rea-analysis/v1035/natives/libpowerampcore.so
---

# Poweramp「设置 → 可视化」偏好结构

> **证据分级**：【实证·原文】= XML/资源原文；【实证·产物】= 反编译 smali / 反汇编产物；【推断】= 无直接代码佐证。
>
> 所有结论基于 **build-1035-bundle-play**（`versionCode 1035009`），解包自 `.rea-analysis/v1035/decoded/`。

## 0. 一句话结论

可视化页面是 Poweramp 中**唯一的 MilkDrop 引擎入口**：31 行 XML 只暴露 **24 个带 key 项**，但背后链接了一套完整的原生渲染栈（`com.maxmpz.milk` 包 10 个类 + 23 个 native 方法），预设系统支持**四种来源**（builtin / compiled / apk / dir）与**第三方 App 扩展**，索引存于 SQLite 两张表，并通过 ContentProvider 跨进程共享。

---

## 1. 页面规模与定位

| | |
| --- | --- |
| XML 文件 | `res/xml/vis.xml` |
| 资源 id | **`0x7f160033`** |
| 行数 | **31** |
| 带 key 元素 | **24**（含 5 个分类/容器 key） |
| 页面标题 | `@string/visualization` = **Visualization** |
| 处理 helper | `ׅ/w81.smali`（63627 字节） |
| 渲染侧读取 | `ׅ/wr.smali`（静态字段缓存全部 vis 参数） |
| 原生引擎 | `com.maxmpz.milk` 包（10 类，`MilkRenderer` 76 KB + `MilkLoader` 62 KB） |

> 与音频分支的 `audio_output_device_opts`（63 个 key）相比，可视化页的 XML 很轻——**绝大部分复杂度在原生层**。

## 2. 24 个带 key 元素逐条

按 XML 中实际出现顺序。**np** = `persistent="false"`（运行时动态填充）；**skip** = `w:skipSearch="true"`。

| # | key | 类型 | 标题 | 摘要 / 提示 | 默认 | 范围 | 标志 |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `enable_vis` | MultilineSwitch | Visualization On Player Screen | Visualization can be switched on with Player Screen button · Visualization is shown when music is playing | — | — | np |
| 2 | `vis_frs_type` | TagList | Equalizer Screen Spectrum | — | **2** | 0/1/2 | — |
| 3 | `vis_in_lib` | MultilineSwitch | Visualization in Library | Visible when visualization on Player Screen is enabled. Depending on preset used, some UI elements may become poorly visible | `false` | — | — |
| 4 | `vis_preset_change_sec` | Seekbar | Preset Duration | For By Duration and Shuffle modes · Change each: %d s | `15` | **3–120** | — |
| 5 | `vis_panel_faded_alpha` | Seekbar | Top Visualization Panel Opacity | %d%% | `60` | 0–100 | — |
| 6 | `vis_controls_faded_alpha` | Seekbar | Faded Controls Opacity | %d%% | `50` | 0–100 | — |
| 7 | `vis_temp_ui_ms` | Seekbar | UI Timeout | Time to show UI during active visualization · %d ms | `1500` | **500–15000**, step 100 | — |
| 8 | `vis_aa_visible` | MultilineSwitch | Visible Album Art | Keep album art visible during visualization | **`true`** | — | — |
| 9 | `vis_ignore_touch_faded` | MultilineSwitch | Ignore Touch | Ignore first touch in Fade Controls mode | — | — | — |
| 10 | `vis_list_faded_alpha` | Seekbar | Track Opacity | Track labels, rating, menu, and album art (if visible) opacity · %d%% | `25` | 0–100 | — |
| 11 | `vis_fs_hide_bars` | MultilineSwitch | Hide System Bars For Full Screen | Hide status bar and navigation completely when in Full Screen mode | `false` | — | **🎁 featurePack=1** |
| 12 | `vis_use_compact_bars` | MultilineSwitch | Scaled Bars For Faded Controls | Scale bars visualization to album art area in Fade Controls mode. If disabled, bar visualization is always full-screen | **`true`** | — | — |
| 13 | `milk_hd` | MultilineSwitch | HD | Increased visualization resolution, reduces performance | `false` | — | — |
| 14 | `milk_crop_aspect` | MultilineSwitch | Crop Aspect | Crop visualization instead of scaling it, reduces performance for a better visual match | `false` | — | — |
| 15 | `milk_30_fps` | MultilineSwitch | Force 30 FPS | Reduce frame rate to 30 frames per second | `false` | — | — |
| 16 | `milk_strict` | MultilineSwitch | Strict | Slower .milk presets rendering for a bit better visual match | `false` | — | — |
| 17 | `vis_extra_delay_info` | **Redirect** | Visualization Delay | Extra delay for better audio/visualization/lyrics match is set per each Output/Device type | — | — | skip, np |
| 18 | `vis_rescan` | **ProgressPreference** | Rescan Presets | 增量重扫（带进度条） | — | — | np |
| 19 | `list_3rdparty` | 空 PreferenceCategory | 3rd Party Presets | — | — | — | **运行时填充** |
| 20 | `list` | PreferenceCategory | Presets | 分类容器 | — | — | 见 §2.2 |
| 21 | `vis_full_rescan` | **ProgressPreference** | Full Presets Rescan | Clear scanned presets info and do the full presets rescan | — | — | np |
| 22 | `milk_hide_unliked` | MultilineSwitch | Hide Unliked Presets | Unliked presets are completely hidden. Preset list is reloaded when closed | `false` | — | — |
| 23 | `vis_rescan_hint` | RawText | — | **空壳**，扫描结果运行时填入 | — | — | np |
| 24 | `restore_defaults` | Preference | Restore Defaults | — | — | — | — |

### 2.1 唯一带 featurePack 的项

`vis_fs_hide_bars`（Hide System Bars For Full Screen）是**整页唯一的付费门控项**：

```xml
<MultilineSwitchPreference android:key="vis_fs_hide_bars"
    android:defaultValue="false" w:featurePack="1" />
```

> 按音频文档 §13.9 的机制：徽标常驻显示，未解锁时 `setEnabled(false)`。

### 2.2 分类 Presets（key=`list`）内的 5 个元素

| key | 类型 | 标题 | 说明 |
| --- | --- | --- | --- |
| `vis_rescan` | **ProgressPreference** | Rescan Presets | 增量重扫（带进度条） |
| `vis_rescan_hint` | RawText | — | **空壳**，内容运行时填入扫描结果 |
| `vis_full_rescan` | **ProgressPreference** | Full Presets Rescan | Clear scanned presets info and do the full presets rescan |
| `milk_hide_unliked` | MultilineSwitch | Hide Unliked Presets | Unliked presets are completely hidden. Preset list is reloaded when closed |
| *（无 key）* | RawText | — | **Presets disabling removes their ratings**（带 `w:smallIcon` 警告图标） |

> **`vis_rescan` 与 `vis_full_rescan` 都是 `ProgressPreference`**——不是普通开关，点击后显示进度并驱动后台扫描服务。

### 2.3 `vis_frs_type` 三态

`@array/pref_vis_frs_type_labels`【实证·原文】：

| 值 | 显示 | 含义 |
| ---: | --- | --- |
| 0 | Disabled | 均衡器界面不显示频谱 |
| 1 | Classic | 经典柱状 |
| 2 | **Rounded（默认）** | 圆角柱状 |

> 与 `milk_*` 参数是**两套独立的东西**：`vis_frs_type` 控制**均衡器页**的频谱柱（`MilkFRS` 组件），`milk_*` 控制**播放界面**的 MilkDrop 渲染。

---
## 3. 「隐藏」参数：`vis_mode`

> ⚠️ **本节是初查结论，已被 §10.1 推翻并查清**。保留在此以说明发现过程。

最初在 `wr.smali` 的 `<clinit>` 中发现一个 **XML 里不存在**的参数：

```asm
const-string v7, "vis_mode"
invoke-virtual {v5, v9, v7}, Lׅ/ms;->b(ILjava/lang/String;)Lׅ/rb1;   ; v9 = 0x0
sput-object v7, Lׅ/wr;->e:Lׅ/rb1;
```

| | |
| --- | --- |
| key | **`vis_mode`** |
| 类型 | `rb1`（int pref） |
| 默认值 | **`0`** |
| prefs 文件 | **`futp`** |
| XML 中是否出现 | ❌ 不出现 |

**当时的错误推断**：以为它是"可视化引擎模式选择器"（0=MilkDrop / 1=Spectrum Bars / 2=关闭）。

**实际情况**：它是 **`enable_vis`（可视化开启开关）的真实存储 key**。详见 **§10.1**。

---

## 4. 三处透明度参数的区别

这一页有 **3 个 alpha 参数**，容易混淆，用途完全不同：

| key | 标题 | 默认 | 作用对象 |
| --- | --- | ---: | --- |
| `vis_panel_faded_alpha` | Top Visualization Panel Opacity | 60 | **顶部可视化面板**（歌曲信息条） |
| `vis_controls_faded_alpha` | Faded Controls Opacity | 50 | **淡出的控制按钮** |
| `vis_list_faded_alpha` | Track Opacity | 25 | **曲目标签、评分、菜单、封面**（若可见） |

> `vis_list_faded_alpha` 的 XML 里额外带 `w:floatScale="100.0"`——说明它内部以 float 存储，UI 上仍显示为整数百分比。

---

## 5. 预设系统的四种来源

`list_3rdparty`（空 `PreferenceCategory`）由 `w81.smali:2020-2260` 在运行时填充【实证·产物】。

### 5.1 三种前缀（Java 侧看到的）

| 前缀 | 标题资源 | 英文文案 | 含义 |
| --- | --- | --- | --- |
| **`builtin:`** | `pref_vis_bars_presets` | **Spectrum Bars/Built-in Presets** | 内置频谱柱预设（链表遍历） |
| **`apk://<pkg>`** | `pref_vis_poweramp_presets` | **Built-in Presets** | 从指定 APK 加载的预设 |
| **`dir:<path>`** | `pref_vis_folder_presets` | **Folder Presets** | 用户文件夹中的 `.milk` 预设 |

> **第 4 种 `compiled:` 不在这个列表里**——它在 `te0.B()` 的内部 HashSet 中处理，不出现在 `list_3rdparty` 的 UI 上。完整分派见 §11.2 / §12.3。

### 5.2 动态发现第三方 App

填充流程的最后一步会**扫描已安装应用**【实证·产物】`w81.smali:2201-2260`：

```asm
invoke-virtual {v2}, Landroid/content/Context;->getPackageManager()
const/16 v7, 0x80                                    ; GET_META_DATA
invoke-virtual {v0, v7}, Landroid/content/pm/PackageManager;->getInstalledApplications(I)
; 遍历每个 ApplicationInfo
invoke-static {v0, v10}, Lׅ/dn0;->芯(...)            ; 提取元数据
```

> 即：**任何声明了相应 meta-data 的已安装 App，都会在「3rd Party Presets」里出现一个开关**，用来启用/禁用它的预设提供。

### 5.3 开关工厂方法 `I()`

三个来源都是通过同一个方法创建的【实证·产物】`w81.smali:398-443`：

```java
SwitchPreference I(SharedPreferences sp, PreferenceGroup group,
                   String title, String summary, String prefix) {
    SwitchPreference p = new SwitchPreference(activity);
    group.addPreference(p);
    p.setTitle(title);
    if (summary != null) p.setSummary(summary);
    p.setPersistent(false);              // ★ 不持久化到普通 prefs
    ...                                  // 状态存在 sp（第三个参数）
    return p;
}
```

> **`setPersistent(false)` 是关键**：这些开关的状态不写进默认 prefs，而是走独立的 `SharedPreferences`（`disabled_containers`），由扫描服务读取。

---

## 6. 扫描服务与预设索引

`com.maxmpz.milk.scanner.MilkScanService`（16040 字节，`IntentService`）【实证·产物】：

### 6.1 两个 Action

| Action | 用途 |
| --- | --- |
| `com.maxmpz.milk.ACTION_SCAN` | 全量扫描 |
| `com.maxmpz.milk.ACTION_SCAN_CONTAINER` | 单容器扫描 |

### 6.2 Intent extra

| extra | 类型 | 含义 |
| --- | --- | --- |
| `cause` | String | 触发原因（日志用） |
| `erase` | boolean | 是否先清空已有索引 |
| `container` | String | 指定容器（单容器扫描时） |

### 6.3 预设索引的实际存放位置

> ⚠️ **修正**：初查时以为存在 prefs 里，实际是 **SQLite 两张表**（详见 §11.1）。

| key / 表 | 作用 |
| --- | --- |
| **`vis_presets`**（prefs） | 仅存扫描触发相关的轻量状态 |
| **`disabled_containers`**（prefs） | 被禁用的预设容器 URI 集合（对应 §5 的三方开关） |
| **`milk_preset_containers`**（SQLite 表） | 预设容器索引（uri / name / type / updated_at） |
| **`milk_presets`**（SQLite 表） | 单个预设（parent_id / fragment / author / name / rating / category） |

> **`vis_rescan`（增量）vs `vis_full_rescan`（全量）**：前者对应 `ACTION_SCAN` 不带 `erase`，后者带 `erase=true` 清空重扫。

---

## 7. MilkDrop 原生引擎

`com.maxmpz.milk` 包共 **10 个类**：

| 类 | 大小 | 职责 |
| --- | ---: | --- |
| `MilkRenderer` | 76 KB | **渲染主循环**，18 个 native 方法 |
| `MilkLoader` | 62 KB | **预设加载器**，5 个 native 方法 |
| `MilkRestProvider` | 23 KB | 内容提供者（跨进程共享预设） |
| `MilkScanService` | 16 KB | 扫描服务 |
| `B` | 13 KB | 内部辅助 |
| `NativePresetNamesIterator` | 6.7 KB | 遍历预设名 |
| `TempNativeRef` | 3 KB | 临时原生引用 |
| `MilkPresetRef` | 338 B | 预设句柄包装 |
| `MilkNativeUtils` | 196 B | native 库加载 |
| `В` | 334 B | 内部辅助 |

### 7.1 `MilkLoader` 的 5 个 native 方法

```java
native_create(AssetManager, String pak, String preset, int flags, int sdk, int w, int h) -> long
native_load_preset_by_uri(long h, String uri, String extra, int a, int b, boolean c) -> long
native_load_aa(long h, Bitmap aa, int i, float f1..f5) -> ?
native_set_renderer_egl_context(long h, long eglCtx) -> boolean
native_release(long h)
```

**`native_create` 的 `flags` 参数**有一个关键位【实证·产物】`MilkLoader.smali:2818-2838`：

```asm
const v0, 0x8000
and-int/2addr v0, p4          ; if (flags & 0x8000)
if-eqz v0, :cond_0
invoke-static {}, Lׅ/ne0;->e()I
or-int/2addr p4, v0           ; flags |= ne0.e()
```

> `0x8000` 位触发时，会额外 OR 上一个由 `ne0.e()` 返回的动态标志。详见 §10.4。

### 7.2 `MilkRenderer` 的 18 个 native 方法

| 组 | 方法 |
| --- | --- |
| **生命周期** | `native_create(...)`（10 参数）、`native_release`、`native_on_pause`、`native_on_resume` |
| **Surface** | `native_attach_surface`、`native_detach_surface`、`native_size_changed(int,int)` |
| **渲染** | `native_render_frame(long frameTime, long nanoTime)`、`native_fade(boolean, int)` |
| **音频输入** | `native_set_audio_source_fd_and_serial`、`native_set_bars_rect(int,int,int,int)` |
| **预设** | `native_set_preset(long h, long presetRef)` |
| **封面** | `native_set_aa(h, h, boolean, int, int)`、`native_set_aa_ratio(h, float)`、`native_commit_aa(h, int, int)` |
| **参数** | `native_set_milk_mode(h, boolean, int)`、`native_get_and_reset_cache_save_failed()` |
| **EGL** | `native_get_egl_context(h)` |

> **`native_set_audio_source_fd_and_serial` 值得注意**：可视化直接消费**音频数据的 fd**（文件描述符），不是 PCM 回调——这说明音频引擎（native 侧）会把 PCM 写到管道，MilkDrop 从管道读。这是**零拷贝**设计。

### 7.3 与 `milk_*` 参数的对应

| XML key | native 侧消费方 |
| --- | --- |
| `milk_hd` | `native_create` 的分辨率参数 |
| `milk_crop_aspect` | 渲染缩放策略 |
| `milk_30_fps` | `native_render_frame` 的调用频率 |
| `milk_strict` | `.milk` 预设的兼容模式（更慢但更接近原版） |
| `milk_hide_unliked` | 预设列表过滤（Java 侧） |

> 前 4 项都在 `w81.smali:1611-1710` 绑定了**同一个 `OnPreferenceChangeListener`**——因为任一改变都会触发渲染器重建。flags 的完整映射见 §10.3。

---

## 8. 两套可视化的区分

Poweramp 实际有**两套**可视化，容易混淆：

| | 均衡器频谱 | MilkDrop |
| --- | --- | --- |
| 出现位置 | **均衡器界面** | **播放界面 / 媒体库** |
| 控制参数 | `vis_frs_type`（Disabled/Classic/Rounded） | `enable_vis` + 4 个 `milk_*` |
| 组件 | `MilkFRS` / `MilkWidget` | `com.maxmpz.milk.MilkRenderer` |
| 预设 | 无 | **有**（四种来源，见 §5 / §11.2） |

> **命名陷阱**：`MilkFRS` 虽然名字带 Milk，但它渲染的是**均衡器的频谱柱**，不是 MilkDrop。
> `FRS` 应为 "Frequency Response Spectrum" 之类。

---

## 9. 相关 UI 组件

| 类 | 作用 |
| --- | --- |
| `widget/player/MilkWidget` | 播放界面上的可视化容器 |
| `widget/player/MilkFRS` | 均衡器频谱柱（§8） |
| `preference/PreferenceMilkViewWrapper` | 设置页里的可视化预览 |
| `widget/VisPanelFrame` | 可视化面板框架 |
| `widget/VisPanelItemView` | 面板单项 |

---
## 10. 深层机制（补充调查）

本节解决隐藏参数与 flags 寄存器的问题，并揭示此前未发现的 **`MilkPluginService`**。

### 10.1 `vis_mode` 的真身：就是 `enable_vis` 的存储字段

**§3 的判断已修正**。`vis_mode` 不是"引擎模式选择器"，而是 **`enable_vis`（可视化开启）的实际 pref key**。

**证据链**【实证·产物】：

1. `wr.smali` 的 `<clinit>` 把 `"vis_mode"` 绑定到静态字段 `wr->e`：

```asm
const-string v7, "vis_mode"
invoke-virtual {v5, v9, v7}, Lׅ/ms;->b(ILjava/lang/String;)Lׅ/rb1;   ; v9 = 0x0（默认关）
sput-object v7, Lׅ/wr;->e:Lׅ/rb1;
```

2. `w81.v()`（设置页初始化）把 `wr->e` 的值**直接同步给 `enable_vis` 开关**：

```asm
const-string v3, "enable_vis"
... findPreference(v3) as SwitchPreference
sget-object v5, Lׅ/wr;->e:Lׅ/rb1;
iget v5, v5, Lׅ/a30;->А:I          ; 读 vis_mode
if-eqz v5, :cond_0                  ; != 0 → true
const/4 v5, 0x1
:cond_0  const/4 v5, 0x0
invoke-virtual {v4, v5}, Landroid/preference/TwoStatePreference;->setChecked(Z)V
```

3. `fb1.onPreferenceChange` 的 `pswitch_0` 分支把用户操作**写回 `wr->e`**：

```asm
:pswitch_0
check-cast p2, Ljava/lang/Boolean;
invoke-virtual {p2}, Ljava/lang/Boolean;->booleanValue()Z
sget-object p1, Lׅ/wr;->e:Lׅ/rb1;
invoke-virtual {p1, v7}, Lׅ/a30;->у(I)V      ; vis_mode = (int) bool
```

**结论**：XML 里的 `enable_vis` 是**显示用的 key**，实际读写的 prefs key 是 **`vis_mode`**。二者是同一个开关的两个名字。

**用法**：所有消费点都只做布尔判断（`if (vis_mode != 0)`），从不比较具体数值：

| 位置 | 用法 |
| --- | --- |
| `th1.smali:3104` | `if (vis_mode != 0 && vis_in_lib) → 库中显示可视化` |
| `th1.smali:5441` | 同上，另一处布局分支 |
| `zk0.smali:390/490` | 预设切换逻辑的前置判断 |
| `w81.smali:1365` | 同步到 `enable_vis` 开关 |

### 10.2 `MilkPluginService` —— 此前未发现的插件服务

`com.maxmpz.audioplayer.plugin.milk.MilkPluginService`（4557 字节）**继承 `ׅ/i30`**（即 native 插件基类），说明 **MilkDrop 本身就是一个 Poweramp 插件**。

### 10.3 `milk_*` 参数 → native flags 的完整映射

`MilkPluginService.у()` 是**整个 flags 的组装入口**【实证·产物】：

```java
static void у() {
    // ① SDK 版本门控
    boolean sdkOk = (dw.В >= 1);
    ne0.y(0x80, sdkOk);              // bit 7

    // ② milk_strict → bit 0
    ne0.y(0x1, wr->j /* milk_strict */);

    // ③ milk_hd → bit 1
    ne0.y(0x2, wr->g /* milk_hd */);

    // ④ milk_30_fps → bit 6
    ne0.y(0x40, wr->i /* milk_30_fps */);

    // ⑤ milk_crop_aspect → bit 2
    ne0.y(0x4, wr->h /* milk_crop_aspect */);
}
```

**完整位表**：

| 位 | 掩码 | 来源 | 含义 |
| ---: | --- | --- | --- |
| 0 | `0x1` | `milk_strict` | 严格模式（更慢但更准） |
| 1 | `0x2` | `milk_hd` | 高分辨率渲染 |
| 2 | `0x4` | `milk_crop_aspect` | 裁剪而非缩放 |
| 6 | `0x40` | `milk_30_fps` | 限制 30 FPS |
| 7 | `0x80` | **SDK 版本**（`dw.В >= 1`） | 系统能力门控 |

### 10.4 flags 寄存器：`ne0.X`（12 位）

所有位都汇总到一个静态 int【实证·产物】`ne0.smali`：

```asm
.field public static X:I                     ; 全局 flags 寄存器

method static synchronized y(int bit, boolean on):
    monitor-enter(ne0.class)                  ; 线程安全
    if (on) {
        X = (bit & 0xFFF) | X;                ; set
    } else {
        X = ~(bit & 0xFFF) & X;               ; clear
    }
    monitor-exit

method static synchronized e() -> int:        ; 读取全部
    return X;
```

> **`& 0xFFF` 掩码**说明这是个 **12 位**寄存器（bit 0–11）。当前只用了 0/1/2/6/7 五位。

`ne0.e()` **返回 12 位 flags 的当前值**，在 `MilkLoader.А()` 里被 OR 进 `native_create` 的 flags 参数：

```asm
const v0, 0x8000
and-int/2addr v0, p4          ; if (flags & 0x8000)
if-eqz v0, :cond_0
invoke-static {}, Lׅ/ne0;->e()I
or-int/2addr p4, v0           ; flags |= ne0.e()
```

> 即：**bit 15（`0x8000`）是"启用 Java 侧 flags 注入"的开关**。置位时，`ne0.X` 的 12 位会被 OR 进最终 flags。

### 10.5 `wr` 静态字段全景（78 个绑定）

`wr.smali` 的 `<clinit>` 把 **78 个 pref key** 绑定到静态字段，是所有可视化相关设置的唯一读取入口。其中与可视化直接相关的：

| 字段 | key | 类型 | 默认 |
| --- | --- | --- | ---: |
| `wr->d` | `vis_frs_type` | rb1 | 2 |
| `wr->e` | **`vis_mode`**（=`enable_vis`） | rb1 | 0 |
| `wr->f` | `vis_in_lib` | pb1(bool) | false |
| `wr->g` | `milk_hd` | pb1 | false |
| `wr->h` | `milk_crop_aspect` | pb1 | false |
| `wr->i` | `milk_30_fps` | pb1 | false |
| `wr->j` | `milk_strict` | pb1 | false |
| `wr->u` | `vis_controls_faded_alpha` | rb1 | 50 |
| `wr->v` | `vis_panel_faded_alpha` | rb1 | 60 |
| `wr->w` | `vis_list_faded_alpha` | rb1 | 25 |
| `wr->z` | `vis_aa_visible` | pb1 | true |
| `wr->D` | `vis_preset_change_sec` | rb1 | 15 |
| `wr->E` | `vis_use_compact_bars` | rb1 | true |
| `wr->F` | `vis_temp_ui_ms` | rb1 | 1500 |
| `wr->o0` | `vis_ignore_touch_faded` | rb1 | — |
| `wr->y0` | `vis_fs_hide_bars` | pb1 | false |
| `wr->W` | `milk_presets_sort` | rb1 | — |
| `wr->Y` | `milk_hide_unliked` | pb1 | false |

> **`wr` 是跨模块共享的全局配置缓存**：它不只服务可视化，还缓存了 `ui_player`、`ui_lyrics`、`library_lists` 等模块的参数（78 个 key 里可视化相关只占 18 个）。

### 10.6 参数消费矩阵

| 参数 | 定义 | 组装 flags | 最终消费 |
| --- | --- | --- | --- |
| `milk_strict` | `wr->j` | `MilkPluginService.у()` → bit 0 | native `native_create` |
| `milk_hd` | `wr->g` | → bit 1 | 同上 |
| `milk_crop_aspect` | `wr->h` | → bit 2 | 同上 |
| `milk_30_fps` | `wr->i` | → bit 6 | 同上 |
| `vis_aa_visible` | `wr->z` | — | `th1.smali:9936`（渲染时决定封面是否可见） |
| `vis_use_compact_bars` | `wr->E` | — | `th1.smali:8932`（柱状频谱缩放策略） |
| `vis_temp_ui_ms` | `wr->F` | — | `th1.smali:9665`（UI 自动隐藏计时） |
| `vis_controls_faded_alpha` | `wr->u` | — | `th1.smali:4924/9377`（控件透明度动画） |
| `vis_panel_faded_alpha` | `wr->v` | — | `th1.smali:4906/9358` |
| `vis_list_faded_alpha` | `wr->w` | — | `th1.smali:5053` |
| `vis_ignore_touch_faded` | `wr->o0` | — | `th1.smali:10519` |
| `vis_preset_change_sec` | `wr->D` | — | `zk0.smali:425`（预设轮换计时） |

> **观察**：`th1.smali`（188 KB）是**可视化 UI 的总控制器**——11 个参数里 9 个由它消费。它不负责渲染（那是 `MilkRenderer`），而负责**布局、透明度动画、UI 超时、触摸处理**。

### 10.7 `native_create` 的 10 个参数

`MilkRenderer.native_create`【实证·产物】：

```java
native_create(
    AssetManager am,      // 资源（用于加载 .milk）
    long   eglCtx,        // EGL 上下文（共享渲染）
    Surface surface,      // 渲染目标
    String pakPath,       // 预设包路径
    String presetName,    // 初始预设名
    int w, int h,         // 尺寸
    int flags,            // 能力位（§10.3/10.4）
    int fps,              // 目标帧率（30 或 60）
    int sdk,              // SDK_INT
    int density,          // 屏幕密度
    float scale           // 缩放比
) -> long handle
```

> **`eglCtx` 参数很关键**：MilkDrop 与主渲染共享 EGL 上下文，避免纹理二次上传。这与 §7.2 的 `native_set_renderer_egl_context` 配合，实现**多渲染器共享 GPU 资源**。

---
## 11. 预设索引的数据库模型（补充调查）

本节解决多个未解项，并推翻一个此前的判断：**预设索引不在 prefs 里，而在 SQLite 中**。

### 11.1 两张表

【实证·产物】`dn0.smali:5512-5800` 的建表语句：

#### `milk_preset_containers` —— 预设容器

```sql
CREATE TABLE IF NOT EXISTS milk_preset_containers (
    _id         INTEGER PRIMARY KEY,
    uri         TEXT,
    uri_extra   TEXT NOT NULL DEFAULT '',
    name        TEXT,
    type        INTEGER,
    updated_at  INTEGER
)
CREATE UNIQUE INDEX milk_preset_containers_uri_index
    ON milk_preset_containers (uri)
```

#### `milk_presets` —— 单个预设

```sql
CREATE TABLE IF NOT EXISTS milk_presets (
    _id         INTEGER PRIMARY KEY,
    parent_id   INTEGER,          -- 指向 milk_preset_containers._id
    fragment    TEXT,
    author      TEXT,
    name        TEXT,
    rating      INTEGER NOT NULL DEFAULT 0,
    category    INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER
)
CREATE INDEX milk_presets_parent_id_name_category_index
    ON milk_presets (parent_id, name, category)
```

#### 级联删除触发器

```sql
CREATE TRIGGER IF NOT EXISTS milk_preset_containers_trigger
    DELETE ON milk_preset_containers
BEGIN
    DELETE FROM milk_presets WHERE parent_id = old._id;
END
```

> **`rating` 字段解释了 UI 文案**：`milk_hide_unliked` 的摘要说"Unliked presets are completely hidden"，以及无 key 提示行"Presets disabling removes their ratings"——都对应这个 `rating INTEGER` 列。**禁用容器 → 级联删预设 → 评分丢失**，这是不可逆操作。

### 11.2 四种预设前缀

`te0.smali` 的 `B()` 方法按 `HashSet` 里的前缀集合分派【实证·产物】`te0.smali:444-620`：

| 前缀 | 处理 | 数据来源 |
| --- | --- | --- |
| **`builtin:`** | `set.contains("builtin:")` → 收入内置预设 | 链表遍历（编译进二进制） |
| **`compiled:`** | `set.contains("compiled:")` → 收入编译预设 | native 返回 null（见 §14.5） |
| **`apk://<pkg>`** | 扫描该包的 `publicSourceDir` | 外部 App 的 APK |
| **`dir:<path>`** | `set.contains("dir:")` → 扫描目录 | `/Android/data/<pkg>/milk_presets/` |

**关键代码**（`te0.smali:444-560`）：

```asm
; ① builtin 分支
const-string p4, "builtin:"
invoke-virtual {p3, p4}, Ljava/util/HashSet;->contains(Ljava/lang/Object;)Z
if-nez p4, :cond_1
invoke-virtual {p0, v2}, Lׅ/te0;->y(Z)V

; ② compiled 分支
const-string p4, "compiled:"
invoke-virtual {p3, p4}, Ljava/util/HashSet;->contains(Ljava/lang/Object;)Z
if-nez p4, :cond_2
const/4 p4, 0x1
invoke-virtual {p0, p4}, Lׅ/te0;->y(Z)V

; ③ 扫描本 App 自身 APK（type=8）
iget-object v3, v3, Landroid/content/pm/ApplicationInfo;->publicSourceDir:Ljava/lang/String;
const/16 v4, 0x8                              ; type = 8
invoke-virtual {p0, v3, p4, v4, p3}, Lׅ/te0;->Х(...)

; ④ dir 分支
const-string p4, "dir:"
invoke-virtual {p3, p4}, Ljava/util/HashSet;->contains(Ljava/lang/Object;)Z
if-nez p4, :cond_3
invoke-virtual {p0, p1}, Lׅ/te0;->x(Ljava/lang/String;)V
```

**容器 `type` 字段的完整取值**（详见 §13.2）：

| type | 来源 |
| ---: | --- |
| 1 | `builtin:` |
| 5 | `compiled:` |
| 8 | 本 App 自身 APK |
| 10 | 外部 App |
| 20 | `dir:` |

### 11.3 `dir:` 根路径的完整解析链

【实证·产物】`w81.J()` → `w3.K()` → `uu0.c()`：

```java
// w81.J()  —— 只做 /storage/emulated/ 前缀裁剪
String J() {
    String path = w3.K(ctx).getAbsolutePath();
    if (path.startsWith("/storage/emulated/")) {
        int i = path.indexOf('/', 0x12);   // 跳过 /storage/emulated/0
        if (i != -1) path = path.substring(i);
    }
    return path;
}

// w3.K()  —— 拼 "milk_presets/" 并 mkdirs
File K(Context c) {
    File f = new File(uu0.c(c), "milk_presets/");
    f.mkdirs();
    return f;
}

// uu0.c()  —— SDK 分支
File c(Context c) {
    if (SDK_INT >= 29)
        return new File(Environment.getExternalStorageDirectory().getAbsolutePath()
                        + "/Android/data/" + c.getPackageName() + "/");
    else
        return new File(Environment.getExternalStorageDirectory().getAbsolutePath()
                        + "/Android/data/_" + c.getPackageName() + "/");  // 旧版加下划线
}
```

**最终路径**：

| SDK | 路径 |
| --- | --- |
| **≥ 29** | `/storage/emulated/0/Android/data/com.maxmpz.audioplayer/milk_presets/` |
| < 29 | `/storage/emulated/0/Android/data/_com.maxmpz.audioplayer/milk_presets/`（**注意下划线前缀**） |

> **旧版路径的 `_` 前缀**是个兼容性细节：Android 10 之前 App 的外部目录是 `Android/data/_<pkg>`，10 之后去掉了下划线。Poweramp 两者都支持。

### 11.4 flags 寄存器只剩 1 位未解释

【实证·产物】全树搜索 `ne0.X` 的写入点，**只有 5 处**，全部在 `MilkPluginService.у()`：

| 位 | 掩码 | 已确认来源 |
| ---: | --- | --- |
| 0 | `0x1` | `milk_strict` |
| 1 | `0x2` | `milk_hd` |
| 2 | `0x4` | `milk_crop_aspect` |
| 6 | `0x40` | `milk_30_fps` |
| 7 | `0x80` | SDK 版本门控（`dw.В >= 1`） |

> **bit 3/4/5/8/9/10/11 从未被任何 Java 代码设置**。由于 `ne0.X` 是纯 Java 静态字段（不经 JNI），可以确定这 7 位在本版本中是**死位（预留）**。

### 11.5 预设加载的完整数据流

```
扫描阶段（MilkScanService）
  ACTION_SCAN / ACTION_SCAN_CONTAINER
    └─ te0.B(...) 遍历四种前缀
         ├─ builtin:   → te0.y(false)
         ├─ compiled:  → te0.y(true)
         ├─ apk://pkg  → te0.Х(sourceDir, pkg, type=8|10, set)
         │                 └─ te0.у(type, pkName, uri, name, true)  ← 入库
         └─ dir:path   → te0.x(path)
              ↓
        SQLite: milk_preset_containers (容器)
                milk_presets (条目，parent_id 外键)
              ↓
加载阶段（MilkLoader）
  native_load_preset_by_uri(handle, uri, extra, a, b, c)
    └─ native 侧从 uri 定位并向 .milk 文件解析
```

---
## 12. 预设扫描与入库的完整 SQL 协议（补充调查）

本节给出全部 7 条预编译 SQL 语句，并解出 `compiled:` 与 `fragment` 的语义。

### 12.1 七条预编译语句（`te0` 构造器）

【实证·产物】`te0.smali:41-215`。所有 SQL 在构造器里一次性 `compileStatement`，存入实例字段复用：

| 字段 | SQL | 用途 |
| --- | --- | --- |
| `te0->В` | `SELECT _id FROM milk_preset_containers WHERE uri=? LIMIT 1` | 查容器是否已存在 |
| `te0->B` | `INSERT INTO milk_preset_containers (uri, type) VALUES (?, ?)` | 新建容器 |
| `te0->А` | `UPDATE milk_preset_containers SET name=?, uri_extra=?, updated_at=? WHERE _id=?` | 更新容器元信息 |
| `te0->A` | `SELECT _id FROM milk_presets WHERE parent_id=? AND fragment=? LIMIT 1` | **查预设是否已存在** |
| `te0->х` | `INSERT INTO milk_presets (parent_id, fragment, author, name, updated_at) VALUES (?,?,?,?,?)` | **插入新预设** |
| `te0->Х` | `UPDATE milk_presets SET updated_at=? WHERE _id=?` | 刷新时间戳 |
| `te0->X` | `SELECT changes()` | 影响行数（判断是否新插入） |
| `te0->x` | `SELECT total_changes()` | 总变更数（增量扫描的基准值） |

### 12.2 `fragment` 列的真实语义

**不是"渲染器版本标记"，而是预设的唯一标识键。**

关键证据：查重语句用 `parent_id + fragment` 做联合条件【实证·产物】`te0.smali:109`：

```sql
SELECT _id FROM milk_presets WHERE parent_id=? AND fragment=? LIMIT 1
```

而插入语句把 `fragment` 作为必填列【实证·产物】`te0.smali:125`：

```sql
INSERT INTO milk_presets (parent_id, fragment, author, name, updated_at)
VALUES (?, ?, ?, ?, ?)
```

**结论**：`fragment` = **预设在其容器内的唯一片段标识**（即 `.milk` 文件名或内部 ID）。配合 `parent_id` 构成业务主键：

| 组合 | 含义 |
| --- | --- |
| `(parent_id, fragment)` | **逻辑主键**（去重依据） |
| `(parent_id, name, category)` | 建了普通索引（列表展示排序用） |

> 注意 `INSERT` 只写 `parent_id/fragment/author/name/updated_at`，**不写 `rating` 和 `category`** —— 它们走默认值 `0`。这说明**评分和分类是后续交互产生/更新的**，不是扫描时确定的。

### 12.3 `builtin:` 与 `compiled:` 是同一段代码的两个分支

`te0.y(Z)` 是这两个前缀的共同扫描器【实证·产物】`te0.smali:1896-2120`：

```java
void y(boolean compiled) {           // p1 = true → compiled, false → builtin
    // ① 拿原生预设名迭代器（注意是 xor 后的值）
    Iterator it = NativePresetNamesIterator
                     .native_get_compiled_names_iterator(!compiled);

    // ② 构造 URI，scheme 就是前缀
    String scheme = compiled ? "compiled" : "builtin";
    String uri = new Uri.Builder().scheme(scheme).build().toString();

    // ③ 建/取容器，type 不同
    int type = compiled ? 5 : 1;
    long containerId = А(type, uri);

    // ④ 逐条插入
    int count = 0;
    while (it.hasNext()) {
        String name = it.B();
        if (isEmpty(name)) { Log.e("MilkPresetScanner", ...); continue; }
        K(name, containerId);        // 写 milk_presets
        count++;
    }

    // ⑤ 更新容器的显示名
    if (count > 0) {
        String displayName = compiled ? "<compiled>" : "<builtin>";
        К(containerId, type, displayName, "");   // UPDATE containers SET name=...
    }
}
```

**两者的差异只有三处**：

| 维度 | `builtin:` | `compiled:` |
| --- | --- | --- |
| URI scheme | `builtin` | `compiled` |
| 容器 `type` | **1** | **5** |
| 显示名 | `<builtin>` | `<compiled>` |
| 迭代器参数 | `native_get_compiled_names_iterator(true)` | `native_get_compiled_names_iterator(false)` |

> **实际效果见 §14.5**：native 对参数 `false` 直接返回 null，所以 `compiled:` 分支永远拿不到迭代器。

### 12.4 增量扫描的机制

两条 `SELECT` 语句揭示了增量策略：

| 语句 | 作用 |
| --- | --- |
| `SELECT changes()` | 单条语句影响的行数——判断刚才的 UPDATE/INSERT 是否真的动了数据 |
| `SELECT total_changes()` | 连接生命周期内的总变更数——作为扫描起点的快照 |

配合 §11.1 的清理语句【实证·产物】`te0.smali:674-696`：

```sql
DELETE FROM <容器表> WHERE updated_at < ? OR updated_at IS NULL
DELETE FROM milk_presets WHERE updated_at < ? OR updated_at IS NULL
```

**完整增量逻辑**：

```
scanStart = total_changes()
   ↓
对每个容器/预设执行 INSERT OR UPDATE（更新 updated_at = 当前时间）
   ↓
DELETE WHERE updated_at < scanStart        ← 清掉本次没被触碰的（已删除的）
```

> 这是经典的 **"touch-then-sweep"** 增量扫描：先给所有还存在的记录盖上时间戳，再删掉时间戳旧的。避免全量重建，也避免用大 IN 列表。

### 12.5 扫描的完整调用链

```
MilkScanService.onHandleIntent(intent)
  ├─ ACTION_SCAN              → te0.A() 全量
  └─ ACTION_SCAN_CONTAINER    → te0.X(String container) 单容器
        ↓
te0.B(String, ArrayList<se0>, HashSet<String>, boolean)
  ├─ set.contains("builtin:")  → te0.y(false)  → type=1
  ├─ set.contains("compiled:") → te0.y(true)   → type=5
  ├─ 自身 APK                  → te0.Х(srcDir, pkgName, 8, set)
  ├─ 外部 App 列表             → te0.Х(srcDir, pkgName, 10, set)
  └─ set.contains("dir:")      → te0.x(path)
        ↓
te0.Х → te0.у(type, pkgName, uri, name, isNew)   ← 入库入口
        ↓
te0.А(type, uri) → 容器 id
te0.K(name, containerId) → 预设行
        ↓
DELETE WHERE updated_at < scanStart   ← 清理
```

---

## 13. MilkRestProvider 与容器类型全表（补充调查）

### 13.1 `dir:` 分支的完整实现（`te0.x()`）

【实证·产物】`te0.smali:1530-1740`：

```java
void x(String path) {
    // ① 补尾部斜杠（若缺）
    if (!path.endsWith("/")) path = path + "/";
    if (path.length() <= 1) return;          // 根目录不扫

    // ② 构造 URI: dir:<path>
    String uri = new Uri.Builder()
                     .scheme("dir")
                     .authority("")           // ★ authority 为空
                     .path(path)
                     .build().toString();

    // ③ 原生迭代器
    Iterator it = NativePresetNamesIterator
                     .native_get_dir_names_iterator(path, true);

    if (it != null) {
        if (it.hasNext()) {
            // ④ 建容器 —— ★ type = 0x14 = 20
            long containerId = А(0x14, uri);
            int count = 0;
            while (it.hasNext()) {
                K(it.B(), containerId);      // 写预设
                count++;
            }
            if (count > 0) {
                К(containerId, 0x14, "<default dir>", "");
            }
        }
        it.В();                              // 释放
    }
}
```

> **`authority` 为空**是 `dir:` 的独特之处——`builtin`/`compiled` 都只有 scheme，`dir:` 还有 path，且 authority 空字符串。这是因为 `Uri.Builder` 要求设置 authority 才能设置 path。

### 13.2 容器 type 完整表（五种，全部确认）

| type | 十进制 | 来源 | 证据 |
| ---: | ---: | --- | --- |
| **0x1** | 1 | `builtin:` 内置 | `te0.smali:2003` |
| **0x5** | 5 | `compiled:` 预编译 | `te0.smali:1996` |
| **0x8** | 8 | 本 App 自身 APK | `te0.smali:518` |
| **0xA** | 10 | 外部 App | `te0.smali:605` |
| **0x14** | **20** | **`dir:` 目录** | `te0.smali:1664` |

> **数值不连续是刻意的**：1/5/8/10/20 各自独立分配，中间留空位供未来扩展。这是典型的"稳定 ABI 枚举"做法——已分配的编号永不复用。

### 13.3 `MilkRestProvider` 的数据库与 MIME

【实证·产物】`MilkRestProvider.smali`（23314 字节）：

| 项 | 值 |
| --- | --- |
| 数据库文件 | **`milk.db`** |
| MIME 类型 | **`vnd.android.cursor.item/vnd.maxmpz.milk.row`** |
| 涉及表 | `milk_presets` |

**为什么用 ContentProvider 而不是直接查库**：MilkDrop 预设需要被**其他进程**（如桌面小部件、Android Auto）读取，ContentProvider 是跨进程共享数据的标准途径。

### 13.4 查询参数协议

【实证·产物】`MilkRestProvider.smali:320-530`：

| 参数 | 类型 | 作用 |
| --- | --- | --- |
| **`lim`** | String | 结果数量限制（`LIMIT`） |
| **`adv`** | int（0–3） | **高级排序/过滤模式**，超出范围则视为 `-1`（无效） |
| **`shuffle_order`** | 内部列名 | `adv == 3` 时改用它排序 |
| **`mflt`** | String | **Milk 过滤器**（自定义 WHERE 片段） |

**`adv` 取值的分支**：

```asm
const-string v8, "adv"
invoke-static {v0, v8}, Lׅ/uu0;->с(Landroid/net/Uri;Ljava/lang/String;)I
const/4 v9, 0x3
if-ltz v8, :cond_3          ; 0 <= adv <= 3 有效
if-gt v8, v9, :cond_3
goto :goto_1
:cond_3  const/4 v8, -0x1     ; 否则置 -1
:goto_1
if-ne v8, v9, :cond_4        ; adv == 3 ?
const-string v8, "shuffle_order"   ; 改用 shuffle_order 排序
:cond_4 ...
```

### 13.5 `rating` 过滤的实际 SQL 片段

`milk_hide_unliked` 开关在 Provider 层体现为一段动态 WHERE【实证·产物】`MilkRestProvider.smali:491-527`：

```asm
; if (hideUnliked) {
const-string v0, "milk_presets.rating"
invoke-virtual {v11, v0}, Lׅ/qd0;->В(Ljava/lang/String;)V    ; 追加列名
const-string v0, "!="
invoke-virtual {v11, v0}, Lׅ/qd0;->В(Ljava/lang/String;)V    ; 追加运算符
const/4 v14, 0x1
invoke-static {v14}, Ljava/lang/Integer;->toString(I)Ljava/lang/String;
invoke-virtual {v11, v0}, Lׅ/qd0;->В(Ljava/lang/String;)V    ; 追加值 1
; }
```

**生成的 SQL 条件**：

```sql
milk_presets.rating != 1
```

> **评分的取值语义**（推断）：`1` = 不喜欢（unliked），`0` = 未评分（默认）。所以 `hide_unliked` 只过滤掉 `rating = 1` 的，**未评分的仍然显示**。
>
> 佐证：`INSERT` 时不写 `rating`，默认 `0`（§12.2），说明新预设是"未评分"而非"不喜欢"。

### 13.6 完整架构图

```
┌─────────────────────────────────────────────────────────────┐
│ 扫描层                                                        │
│   MilkScanService (IntentService)                             │
│     └─ te0.B(...)  四种前缀分派                                │
│          ├─ builtin:  → te0.y(false)   type=1                │
│          ├─ compiled: → te0.y(true)    type=5                │
│          ├─ apk://    → te0.Х(...)     type=8/10             │
│          └─ dir:      → te0.x(path)    type=20               │
│                ↓                                              │
│          7 条预编译 SQL（touch-then-sweep 增量）                │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 存储层  milk.db                                               │
│   milk_preset_containers  (_id, uri, uri_extra, name, type)   │
│   milk_presets            (_id, parent_id, fragment, author,  │
│                            name, rating, category, updated_at)│
│   + 级联删除触发器                                             │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 共享层  MilkRestProvider (ContentProvider)                    │
│   MIME: vnd.android.cursor.item/vnd.maxmpz.milk.row           │
│   查询参数: lim / adv(0-3) / shuffle_order / mflt             │
│   过滤: hide_unliked → rating != 1                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 渲染层                                                        │
│   MilkRenderer / MilkLoader → native_create → libpowerampcore │
└─────────────────────────────────────────────────────────────┘
```

---
## 14. 原生迭代器指令级分析（补充调查）

本节用 `llvm-objdump` 反汇编 `libpowerampcore.so`，解出预设名迭代器的原生实现。

### 14.1 四个 JNI 函数的地址

用 `.rela.dyn` 的 `R_AARCH64_RELATIVE` + `.data.rel.ro` 的 `JNINativeMethod` 定位【实证·产物】：

| JNI 方法 | 函数地址 | 签名 |
| --- | ---: | --- |
| `native_get_compiled_names_iterator` | **`0x13f894`** | `(Z)Lcom/maxmpz/milk/NativePresetNamesIterator;` |
| `native_get_dir_names_iterator` | **`0x13fa40`** | `(Ljava/lang/String;Z)Lcom/maxmpz/milk/NativePresetNamesIterator;` |
| `native_load_preset_by_uri` | `0x127924` | `(JLjava/lang/String;Ljava/lang/String;IIZ)J` |
| `native_create` | `0x1276ec` | `(Landroid/content/res/AssetManager;Ljava/lang/String;Ljava/lang/String;IIII)J` |

> 两个迭代器函数地址相邻（`0x13f894` / `0x13fa40`，间隔 0x1ac），确认是同一编译单元的兄弟函数。

### 14.2 四个迭代器类（此前只知一个）

从 `.rodata` 的 RTTI 字符串中搜出【实证·产物】：

| 类名 | 用途 |
| --- | --- |
| **`NativePresetNamesIterator`** | Java 侧看到的类型名（基类） |
| **`PresetNamesIterator`** | 抽象基类 |
| **`ZipPresetNamesIterator`** | **`.zip` 预设包** |
| **`DirPresetNamesIterator`** | **目录扫描** |

> 所以 `native_get_compiled_names_iterator` 返回的**不是** `DirPresetNamesIterator`，而是链表遍历的实现（见 §14.5）。

### 14.3 `dir:` 迭代器：直接遍历文件系统

**入口** `native_get_dir_names_iterator`（`0x13fa40`）：

```asm
13fa40: sub  sp, sp, #0x50
13fa54: bl   0x1402c0                  ; JNIEnv 准备
13fa58: cbz  x2, 0x13fad4              ; jstring path 为空 → assert
13fa5c: mov  w21, w3                   ; 保存 boolean
13fa64: mov  x20, x2                   ; jstring path
13fa6c: and  w8, w21, #0xff
13fa70: cmp  w8, #0x1                  ; ★ boolean 归一化
13fa74: cset w8, eq
13fa78: strb w8, [sp, #0x4]            ; 存为 1 字节
13fa7c: add  x8, sp, #0x8              ; 出参（返回值槽）
13fa80: add  x0, sp, #0x10
13fa84: add  x1, sp, #0x4
13fa88: bl   0x140130                  ; ★ 构造迭代器
13fa8c: ldr  x2, [sp, #0x10]
13fa90: ldr  x8, [x19]                 ; JNIEnv vtable
13fa94: ldr  x8, [x8, #0x550]
13fa9c: blr  x8                        ; ★ NewObject(...)
```

**构造器** `0x140130`：

```asm
140130: ...
14014c: mov  w0, #0x70                 ; ★ 112 字节对象
140154: ...                             ; operator new(112)
140158: ldr  x1, [x22]                ; 路径
14015c: ldrb w2, [x21]                ; boolean
140160: bl   0x13f08c                  ; ★ DirPresetNamesIterator 构造
140164: str  x20, [x19]                ; 写入出参
```

**真正的构造逻辑** `0x13f08c`：

```asm
13f08c: ...
13f0a4: mov  w8, #0x4e50
13f0a8: movk w8, #0x7449, lsl #16      ; w8 = 0x74494E50
13f0ac: str  w8, [x0, #0x8]            ; ★ 写入魔术 "PNIt"
13f0b0: adrp x8, 0x45f000
13f0b4: add  x8, x8, #0xbf8             ; 0x45fbf8
13f0b8: str  x8, [x0], #0x10            ; ★ 写入 vtable 指针
13f0cc: and  w8, w21, #0x1
13f0dc: strb w8, [x20, #0x20]           ; 存 boolean 到 +0x28
; —— 规范化路径（补尾部 /）——
13f100: cmp  w8, #0x2f                 ; 检查是否以 "/" 结尾
13f10c: mov  w1, #0x2f
13f110: bl   ...                        ; 追加 "/"
; —— 打开目录 ——
13f124: bl   0x458c70 <opendir@plt>     ; ★ opendir(path)
13f128: str  x0, [x19, #0x48]           ; 存 DIR*
13f130: mov  w8, #0x1
13f134: strb w8, [x19, #0x28]           ; 标记已打开
13f13c: ... if (dir == NULL) 打印错误
13f14c: adrp x2, 0x45000 + 0x80d        ; "%s() %s failed to open=%s"
13f154: adrp x3, 0x68000 + 0x6e         ; "DirPresetNamesIterator"
```

**关键结论**：

| 项 | 值 |
| --- | --- |
| 对象大小 | **112 字节（0x70）** |
| 魔术标识 | **`"PNIt"`**（`0x74494E50`，位于 `+0x8`） |
| vtable | `0x45fbf8`（位于 `+0x0`） |
| `DIR*` 句柄 | `+0x48` |
| 目录扫描 | **`opendir()` 系统调用** |
| 路径规范化 | **自动补尾部 `/`** |

> `"PNIt"` = **P**reset **N**ames **It**erator 的缩写。这是 C++ 侧的类型魔数，用于运行时断言对象合法性。

### 14.4 迭代器的 vtable（4 个虚函数）

vtable 在文件里是**全零占位**，需经 `.rela.dyn` 解析【实证·产物】：

| 槽位 | 解析后地址 | 对应 Java 方法 |
| --- | ---: | --- |
| `+0x00` | `0x13f330` | **`В()` = 释放（`closedir` + 析构）** |
| `+0x08` | `0x13f370` | **`D()` = 删除（先释放再 free 112 字节）** |
| `+0x10` | `0x13f1a4` | **`hasNext()`** |
| `+0x18` | `0x13f2e4` | **`B()` = next（返回下一个名字）** |

> vtable 前两个是析构函数（`deleting destructor` 在 `+0x08`，普通析构在 `+0x00`），这是 Itanium C++ ABI 的标准布局。

### 14.5 `compiled` / `builtin` 走完全不同的路径

**`native_get_compiled_names_iterator`（`0x13f894`）**的骨架与 dir 版完全不同：

```asm
13f894: sub  sp, sp, #0x50
13f8a4: tst  w2, #0xff
13f8b4: b.eq 0x13f8f0                  ; ★ boolean == false → 返回 null！
13f8b8: mov  x19, x0
13f8bc: add  x8, sp, #0x8
13f8c0: bl   0x13ae2c                  ; ★ 构造（无参数）
13f8c4: sub  x8, x29, #0x10
13f8c8: add  x0, sp, #0x8
13f8cc: bl   0x13fbac                  ; NewObject
...
13f8f0: mov  x19, xzr                  ; ← boolean=false 时返回 null
```

**极其重要的发现**：

> `native_get_compiled_names_iterator(false)` **直接返回 `null`**！
>
> 回到 §12.3 的调用：`te0.y(compiled)` 里写的是 `native_get_compiled_names_iterator(!compiled)`。所以：
> - `te0.y(true)`（compiled 分支）→ 传 `false` → **返回 null → 什么都不扫！**
> - `te0.y(false)`（builtin 分支）→ 传 `true` → 正常扫描

**这解释了为什么 `compiled:` 容器在实践中是空的**——参数被 `xor` 反转了，导致 compiled 分支拿到 null iterator。

> ⚠️ 这可能是**故意的设计**（compiled 功能已废弃/未启用），也可能是**参数传反的 bug**。Java 侧代码逻辑自洽，但 native 侧对 `false` 返回 null，**两者矛盾**。

**构造函数 `0x13ae2c`** 走的是链表遍历（无 `opendir`）：

```asm
13ae50: mov  x8, sp
13ae54: add  x22, x8, #0x8            ; 哨兵节点
13ae58: stp  xzr, xzr, [x19]          ; 清零出参
13ae60: stp  xzr, xzr, [sp, #0x8]
13ae64: str  x22, [sp]                ; 初始化链表头
13ae68: mov  x0, sp
13ae6c: bl   0x13aeec                 ; ★ 遍历链表（内置预设表）
13ae70: ldr  x20, [sp]                ; 取首个节点
13ae74: cmp  x20, x22                 ; 是否到头？
13ae78: b.eq 0x13ae98
13ae7c: add  x1, x20, #0x20
13ae80: mov  x0, x19
13ae84: bl   0x13b240                 ; 追加到结果
13ae8c: bl   0x12be5c                 ; 下一个节点
```

> 没有文件 I/O，纯粹遍历内存中的链表——所以 compiled/builtin 的名单**编译进二进制**。

### 14.6 目录扫描的文件过滤规则

`hasNext()`（`0x13f1a4`）引用的字符串揭示过滤规则【实证·产物】：

```asm
13f1a4: ldrb w8, [x0, #0x29]           ; 状态字节
13f1a8: tbz  w8, #0x0, 0x13f1b4        ; 已就绪 → 直接返回 1
13f1cc: ldrb w8, [x0, #0x28]           ; 是否已 opendir
13f1d0: cmp  w8, #0x1
13f1d4: b.ne 0x13f2cc                 ; 未打开 → 返回 0
13f1d8: adrp x20, 0x63000 + 0xcec     ; ★ ".zip"
13f1e0: adrp x21, 0x58000 + 0x9c4     ; ★ ".milk"
13f1e8: adrp x22, 0x58000 + 0x9ca     ; ★ ".prjm"
```

| 扩展名 | 处理 |
| --- | --- |
| **`.milk`** | 单个 MilkDrop 预设文件 |
| **`.zip`** | 预设包（条目名加入 `+0x58` vector） |
| **`.prjm`** | **projectM 工程文件**（完整规则见 §15.3） |

> 其余文件（`.png` 纹理等）会被跳过。`ZipPresetNamesIterator` 的存在说明 **`.zip` 里可以打包多个 `.milk`**。

### 14.7 `B()`（next）的实现

```asm
13f2e4: mov  x20, x0
13f2f8: bl   0x13f1a4                  ; 先调 hasNext()
13f2fc: tbz  w0, #0x0, 0x13f318        ; false → 抛异常
13f300: strb wzr, [x20, #0x29]         ; ★ 清除"已就绪"标志（消耗式迭代）
13f304: add  x1, x20, #0x30            ; 名字缓冲区 +0x30
13f308: mov  x0, x19                   ; 出参
13f314: b   0x1dd124                   ; 拷贝字符串并返回
```

> **消耗式迭代**：每次 `B()` 都会清掉 `+0x29` 的标志位，下次必须重新调 `hasNext()` 推进。

### 14.8 库版本标识

在 `.note.android.ident` 区发现【实证·产物】：

```
@0x250: "Android"  "r30-beta1"
```

> `libpowerampcore.so` 的构建标识是 **`r30-beta1`**（MilkDrop 引擎基于 projectM 系列，r30 是该系列的版本号）。

---
## 15. 目录扫描的完整反汇编（补充调查）

本节彻底解出 `DirPresetNamesIterator::hasNext()` 的完整逻辑。

### 15.1 `hasNext()` 的完整反汇编

【实证·产物】`libpowerampcore.so:0x13f1a4-0x13f2e4`（320 字节）：

```asm
13f1a4: ldrb w8, [x0, #0x29]        ; 已就绪标志
13f1a8: tbz  w8, #0x0, 0x13f1b4     ; 已就绪 → 直接返回 1
13f1ac: mov  w0, #0x1
13f1b0: ret
13f1b4: stp  x29, x30, [sp, #-0x40]!
13f1c8: mov  x19, x0
13f1cc: ldrb w8, [x0, #0x28]        ; opendir 是否成功
13f1d0: cmp  w8, #0x1
13f1d4: b.ne 0x13f2cc               ; 未打开 → 返回 0

; ── 加载三个扩展名字符串 ──
13f1d8: adrp x20, 0x63000
13f1dc: add  x20, x20, #0xcec       ; x20 = ".zip"
13f1e0: adrp x21, 0x58000
13f1e4: add  x21, x21, #0x9c4       ; x21 = ".milk"
13f1e8: adrp x22, 0x58000
13f1ec: add  x22, x22, #0x9ca       ; x22 = ".prjm"  ★ 第三处！

:loop
13f1f0: ldr  x0, [x19, #0x48]       ; this->dir (DIR*)
13f1f4: bl   0x458c80 <readdir@plt> ; ★ 逐个读目录项
13f1f8: cbz  x0, 0x13f2d0           ; 读完 → 返回 0

; ── 过滤 1：只收普通文件 ──
13f1fc: ldrb w8, [x0, #0x12]        ; dirent.d_type
13f200: cmp  w8, #0x8               ; DT_REG == 8
13f204: b.ne :loop                  ; 非普通文件（目录/链接）→ 跳过

; ── 过滤 2：跳过 "." 与 ".." ──
13f20c: ldrb w8, [x23, #0x13]!      ; dirent.d_name[0]
13f210: cbz  w8, :loop              ; 空名 → 跳过
13f214: cmp  w8, #0x2e              ; == '.' ?
13f218: b.ne 0x13f234               ; 不是点开头 → 继续处理
13f21c: ldrb w8, [x0, #0x14]        ; d_name[1]
13f220: cbz  w8, :loop              ; "." → 跳过
13f224: cmp  w8, #0x2e              ; == '.' ?
13f228: b.ne 0x13f234               ; ".x" → 继续
13f22c: ldrb w8, [x0, #0x15]        ; d_name[2]
13f230: cbz  w8, :loop              ; ".." → 跳过

; ── 取最后一个点后的扩展名 ──
13f234: mov  x0, x23                ; d_name
13f238: mov  w1, #0x2e              ; '.'
13f23c: bl   0x458a20 <strrchr@plt>  ; ★ strrchr(name, '.')
13f240: cbz  x0, :loop              ; 没有扩展名 → 跳过
13f244: mov  x24, x0                ; 保存扩展名指针

; ── .zip 分支（先判断）──
13f248: ldrb w8, [x19, #0x50]       ; 某开关字节
13f24c: cmp  w8, #0x1
13f250: b.ne 0x13f27c               ; 开关关闭 → 跳过 zip 处理
13f254: mov  x0, x20                ; ".zip"
13f258: bl   strlen@plt
13f25c: mov  x2, x0
13f260: mov  x0, x24                ; 扩展名
13f264: mov  x1, x20
13f268: bl   0x458a30 <strncasecmp@plt>  ; ★ 大小写不敏感比较
13f26c: cbnz w0, 0x13f27c           ; 不是 .zip → 继续
13f270: add  x0, x19, #0x58         ; 子目录列表
13f274: mov  x1, x23                ; 文件名
13f278: bl   0x132554                ; ★ 递归展开 zip

; ── .milk / .prjm 分支 ──
13f27c: mov  x0, x21                ; ".milk"
13f280: bl   strlen@plt
13f28c: mov  x1, x21
13f290: bl   strncasecmp            ; 比较 .milk
13f294: cbz  w0, 0x13f2b4           ; ★ 匹配 .milk → 收下
13f298: mov  x0, x22                ; ".prjm"
13f29c: bl   strlen@plt
13f2ac: bl   strncasecmp            ; 比较 .prjm
13f2b0: cbnz w0, :loop              ; 都不是 → 跳过

13f2b4: add  x0, x19, #0x30         ; OK：写入名字缓冲区 +0x30
13f2b8: mov  x1, x23
13f2bc: bl   0x1dd150                ; 拷贝字符串
13f2c0: mov  w0, #0x1
13f2c4: strb w0, [x19, #0x29]       ; ★ 置"已就绪"标志
13f2c8: b    0x13f2d0
13f2cc: mov  w0, wzr                 ; 未打开 → 0
13f2d0: ... 返回
```

### 15.2 三层过滤规则（完整）

| # | 过滤条件 | 汇编依据 |
| ---: | --- | --- |
| 1 | **只收普通文件**（`DT_REG == 8`） | `0x13f1fc-0x13f204` |
| 2 | **跳过 `.` 与 `..`** | `0x13f20c-0x13f230`（逐个字符比对） |
| 3 | **必须有扩展名** | `0x13f23c` `strrchr(name, '.')` 返回非空 |

### 15.3 三种扩展名

| 扩展名 | 字符串地址 | 处理 |
| --- | ---: | --- |
| **`.zip`** | `0x63cec` | 递归展开（`0x132554`） |
| **`.milk`** | `0x589c4` | 直接收录 |
| **`.prjm`** | `0x589ca` | **直接收录**（第三处比较才暴露） |

> **`.prjm` 是 projectM 的工程文件格式**。Poweramp 的 MilkDrop 引擎基于 projectM，所以原生支持它的工程文件——这解释了 §14.8 发现的 `r30-beta1` 版本标识（projectM r30 系列）。
>
> 全部比较都用 **`strncasecmp`**（大小写不敏感），所以 `.MILK` / `.Zip` 也能识别。

### 15.4 `.zip` 的递归展开机制

`0x132554` 是个 **vector 扩容**函数（不是解压器本体）：

```asm
132554: ...
132564: ldp  x20, x8, [x0, #0x8]     ; begin / end
132568: cmp  x20, x8                 ; begin >= end ?
13256c: b.hs 0x13257c                ; 已满 → 扩容
132570: bl   0x132590                ; 保留旧数据
132574: add  x0, x20, #0x18          ; ★ 每项 0x18 字节
132578: b    0x132580
13257c: bl   0x1325c8                ; 分配新块
132580: str  x0, [x19, #0x8]         ; 更新 end 指针
```

> **`+0x18`（24 字节）的步长**说明 zip 条目结构至少 24 字节。`+0x58` 这个字段就是**子 preset 名列表**（`std::vector<std::string>`）。
>
> **关键洞察**：`.zip` 里的预设不是当场解压到磁盘，而是把**文件名（条目名）**追加到 `+0x58` 的 vector。真实解压发生在 `native_load_preset_by_uri` 时，按需读取。

### 15.5 迭代器结构体布局（完整）

结合 §14.3 的构造器与本节：

| 偏移 | 大小 | 字段 | 证据 |
| ---: | ---: | --- | --- |
| `+0x00` | 8 | **vtable 指针** | `0x13f0b8` |
| `+0x08` | 4 | **魔术 `"PNIt"`** | `0x13f0ac` |
| `+0x10` | 16 | 路径字符串（`std::string`） | `0x13f0f4` |
| `+0x20` | 1 | boolean 参数 | `0x13f0dc` |
| `+0x28` | 1 | **已 opendir 标志** | `0x13f134` |
| `+0x29` | 1 | **"已就绪"标志** | `0x13f2c4` |
| `+0x30` | 24 | **当前文件名缓冲**（`std::string`） | `0x13f2b4` |
| `+0x48` | 8 | **`DIR*` 句柄** | `0x13f128` |
| `+0x50` | 1 | **zip 展开开关** | `0x13f248` |
| `+0x58` | 24 | **子预设列表**（`std::vector`） | `0x13f270` |

总计 **112 字节（0x70）**，与 `0x13f14c` 的 `mov w0, #0x70` 一致。

### 15.6 `B()`（next）的消耗式语义

【实证·产物】`0x13f2e4`：

```asm
13f2e4: ...
13f2f8: bl   0x13f1a4                ; 调 hasNext()
13f2fc: tbz  w0, #0x0, 0x13f318      ; false → 抛异常
13f300: strb wzr, [x20, #0x29]       ; ★ 清零"已就绪"
13f304: add  x1, x20, #0x30          ; 名字缓冲 +0x30
13f308: mov  x0, x19                 ; 出参
13f314: b    0x1dd124                 ; 拷贝并返回
```

> **`B()` 必须是"先 hasNext 再 next"的严格交替调用**。直接连调两次 `B()` 第二次会抛异常（因为 `+0x29` 已被清零且未重新推进）。

---
## 16. 未解问题

### 16.1 已解决（累计）

| 问题 | 解决情况 | 位置 |
| --- | --- | --- |
| `vis_mode` 语义 | ✅ 就是 `enable_vis` | §10.1 |
| `native_create` flags 位 | ✅ bit 0/1/2/6/7 | §10.3 |
| `ne0.e()` 返回值 | ✅ 12 位 flags 寄存器 | §10.4 |
| `ne0.X` 剩余位 | ✅ 确认死位 | §11.4 |
| 预设索引存放 | ✅ SQLite 两张表 | §11.1 |
| 四种前缀 + type | ✅ type=1/5/8/10/20 | §11.2 / §13.2 |
| `dir:` 根路径 | ✅ 完整链路 + SDK 分支 | §11.3 |
| `compiled:` 机制 | ✅ native 侧返回 null | §14.5 |
| `fragment` 列语义 | ✅ 预设逻辑主键 | §12.2 |
| 扫描入库 SQL | ✅ 7 条预编译语句 | §12.1 |
| `MilkRestProvider` 协议 | ✅ milk.db + MIME + 4 参数 | §13.3–13.5 |
| 原生迭代器实现 | ✅ 4 类 + 112 字节结构 + `"PNIt"` | §14 |
| 库构建标识 | ✅ `r30-beta1` | §14.8 |
| **目录过滤完整规则** | ✅ **3 层过滤 + 3 种扩展名** | §15.1 / §15.2 |
| **`.prjm` 扩展名** | ✅ 第三个扩展名，projectM 工程文件 | §15.3 |
| **`.zip` 展开机制** | ✅ 条目名入 `+0x58` vector，按需解压 | §15.4 |
| **迭代器结构体布局** | ✅ 10 个字段完整表 | §15.5 |
| **`B()` 消耗式语义** | ✅ 必须 hasNext→next 交替 | §15.6 |

### 16.2 仍未解

1. **`compiled:` 是 bug 还是故意禁用**：native 对 `false` 返回 null，Java 传 `!compiled`，两者矛盾（§14.5）。
2. **`rating` 完整取值域**：只确认 `0`（默认）与 `1`（unliked）。是否有 2/3/4/5 星未验证。
3. **`category` 列语义**：扫描时不写入，用途未确认。
4. **`th1.smali` 完整职责边界**：188 KB，已确认消费 9 个 vis 参数，内部仍有大量未映射逻辑。
5. **`MilkPluginService` 插件注册机制**：继承 `ׅ/i30`，如何被 `pa_get_plugin` 发现未追踪。
6. **`uri_extra` 列内容**：扫描时为空，未找到写入非空值的位置。
7. **`.zip` 的实际解压实现**：已知条目名入 vector、按需读取，但 `native_load_preset_by_uri` 内部如何从 zip 中解出 `.milk` 内容未反汇编。
8. **`+0x50` zip 展开开关的来源**：该字节决定是否展开 `.zip`，但由什么条件设置未确认。

---

## 17. 证据索引

### 17.1 XML / 资源

| 主题 | 路径 : 行 |
| --- | --- |
| 页面结构 / **24 个 key** | `v1035/decoded/res/xml/vis.xml:1-30` |
| `vis_frs_type` 三态数组 | `res/values/arrays.xml`（`pref_vis_frs_type_labels`） |
| 全部提示文案 | `res/values/strings.xml` |

### 17.2 Java 侧（smali）

| 主题 | 路径 : 行 |
| --- | --- |
| 三方预设来源与标题 | `ׅ/w81.smali:2067-2190` |
| App 扫描（GET_META_DATA） | `ׅ/w81.smali:2201-2260` |
| 开关工厂 `I()` | `ׅ/w81.smali:398-443` |
| `dir:` 路径 `J()` | `ׅ/w81.smali:481-554` |
| 预设目录 `K()` | `ׅ/w3.smali:557-588` |
| SDK 路径分支 `c()` | `ׅ/uu0.smali:4368-4550` |
| milk 参数监听绑定 | `ׅ/w81.smali:1611-1710` |
| `vis_mode` 绑定 | `ׅ/wr.smali:612-624` |
| 全部 vis 参数读取 | `ׅ/wr.smali:596-990` |
| **78 个 pref key 静态绑定** | `ׅ/wr.smali:208-2561`（`<clinit>`） |
| `vis_mode` 同步到开关 | `ׅ/w81.smali:1342-1391` |
| `vis_mode` 写回 | `ׅ/fb1.smali:90-153`（`pswitch_0`） |
| MilkPluginService flags 组装 | `com/maxmpz/audioplayer/plugin/milk/MilkPluginService.smali:42-140` |
| flags 寄存器 `ne0.X` | `ׅ/ne0.smali:2081-2116`（读）/ `:6614-6691`（写） |

### 17.3 扫描 / 数据库

| 主题 | 路径 : 行 |
| --- | --- |
| 扫描服务 Action / extra | `com/maxmpz/milk/scanner/MilkScanService.smali:46-90` |
| **两种表建表 SQL** | `ׅ/dn0.smali:5512-5800` |
| **7 条预编译语句** | `ׅ/te0.smali:41-215`（构造器） |
| 四种前缀分派 `B()` | `ׅ/te0.smali:373-704` |
| `builtin`/`compiled` 扫描 `y()` | `ׅ/te0.smali:1896-2120` |
| `dir:` 扫描 `x()` | `ׅ/te0.smali:1530-1740` |
| 容器 id 获取 `А()` | `ׅ/te0.smali:2164-2260` |
| 预设入库 `K()` | `ׅ/te0.smali:704-780` |
| APK 扫描入口 `Х()` | `ׅ/te0.smali:2638-2739` |
| 增量清理 SQL | `ׅ/te0.smali:674-696` |

### 17.4 MilkRestProvider

| 主题 | 路径 : 行 |
| --- | --- |
| 数据库 / MIME | `com/maxmpz/milk/data/MilkRestProvider.smali:46-165` |
| 查询参数 `lim`/`adv`/`mflt` | `…:320-430` |
| `rating` 过滤 | `…:491-527` |
| 表关联查询 | `…:1078-1115` |

### 17.5 原生层（AArch64 反汇编）

| 主题 | 地址 / 路径 |
| --- | --- |
| `native_get_compiled_names_iterator` | `libpowerampcore.so:0x13f894` |
| `native_get_dir_names_iterator` | `libpowerampcore.so:0x13fa40` |
| `DirPresetNamesIterator` 构造 | `0x13f08c`（`"PNIt"` 魔数 @ `+0x8`） |
| vtable @ `0x45fbf8` | `+0x00`=0x13f330 / `+0x08`=0x13f370 / `+0x10`=0x13f1a4 / `+0x18`=0x13f2e4 |
| `hasNext()` 完整逻辑 | `0x13f1a4-0x13f2e4` |
| `B()` next | `0x13f2e4` |
| `compiled` 链表构造 | `0x13ae2c` |
| zip 条目 vector 扩容 | `0x132554` |
| 扩展名字符串 | `.zip`@`0x63cec` / `.milk`@`0x589c4` / `.prjm`@`0x589ca` |
| JNIEnv 槽位（参考 audio 文档） | `0x550`=NewObject |
| 库构建标识 | `.note.android.ident`: `"Android"` + `"r30-beta1"` |

### 17.6 工具链

| 工具 | 版本 / 路径 |
| --- | --- |
| apktool | 2.11.1 + JBR 25 |
| llvm-objdump | **LLVM 23.1.5**（`C:\Program Files\LLVM\bin\llvm-objdump.exe`） |
| 重定位解析 | 自写 Node 脚本（`.rela.dyn` 的 `R_AARCH64_RELATIVE`，type=1027） |

> **注意**：llvm-objdump 的 `-s`（dump section）用**文件偏移**，而 `-d`（disassemble）用**虚拟地址**。两者不同，混用会读错位置。
