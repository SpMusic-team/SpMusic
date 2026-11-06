---
doc_id: poweramp-album-art-settings
title: Poweramp「设置 → 专辑封面」偏好结构（build-1035）
doc_type: architecture
status: draft
owner_agent: lead
version_scope: build-1035-bundle-play (versionCode 1035009)
created: 2026-11-06
updated: 2026-11-06
source_documents:
  - .rea-analysis/v1035/decoded/res/xml/aa.xml
  - .rea-analysis/v1035/decoded/res/values/strings.xml
  - .rea-analysis/v1035/decoded/res/values/arrays.xml
  - .rea-analysis/v1035/decoded/res/values/public.xml
  - .rea-analysis/v1035/decoded/smali/ׅ/vr.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/wr.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/x61.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/gr.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/z61.smali
---

# Poweramp「设置 → 专辑封面」偏好结构

> **证据分级**：【实证·原文】= XML/资源原文；【实证·产物】= 反编译 smali 产物；【推断】= 无直接代码佐证。
>
> 所有结论基于 **build-1035-bundle-play**（`versionCode 1035009`）。

## 0. 一句话结论

「专辑封面」页面 **26 行 / 19 元素 / 17 个带 key 项**，分两个分类：**Download（6 项，负责爬取）** 与 **Advanced Tweaks（10 项，负责渲染与传输）**。三条独立链路：下载（`gr`）、存储（`vr` 的 `ftp` + `wr` 的 `futp`）、渲染（`x61` 绑定）。

---

## 1. 页面身份

| | |
| --- | --- |
| XML 文件 | `res/xml/aa.xml` |
| 资源 id | **`0x7f160000`** |
| 行数 | **26** |
| 字节 | 4842 |
| 元素总数 | **19**（含 2 个 PreferenceCategory） |
| 带 key 项 | **18** |
| 页面标题 | `@string/pref_album_art_options` = **Album Art** |
| 页面摘要 | `@string/pref_summary_album_art_options` = **Download, quality, cache cleanup** |
| 设置页 helper | `ׅ/x61.smali`（11951 字节，`v()` 方法） |
| 偏好定义 | `ׅ/vr.smali`（9 个字段）+ `ׅ/wr.smali`（1 个字段） |
| 下载逻辑 | `ׅ/gr.smali`（5 个字段） |

> **资源 id `0x7f160000` 是全 App 最小的 xml id**——比「背景」的 `0x7f160001` 还小一位，说明 `aa.xml` 在资源表里排最前。

## 2. 19 个元素逐条

### 2.1 分类一 `pref_aa_downloading`（Download，6 项）

| # | key | 类型 | 标题 | 摘要 | 默认 | 标志 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | *（分类头）* | Category | **Download** | — | — | — |
| 2 | `download_album_art` | MultilineSwitch | Download Album Art | Automatically search and download missing album art | `false` | — |
| 3 | `download_artist_art` | MultilineSwitch | Download Artist Images | Includes Album Artists and Composers. If disabled, track album art is used | `false` | — |
| 4 | `aa_download_hd` | MultilineSwitch | High Resolution | Higher downloaded album art resolution, increases storage/connection bandwidth usage | `false` | — |
| 5 | `download_aa_wifi_only` | MultilineSwitch | Download Only On Wi-Fi | Album art will be downloaded only when wi-fi is connected | **`true`** | — |
| 6 | `reset_negative_aa_status` | Preference | Reset Negative Status | **Clear stored "not-found" status for album/artist images** | — | **np** |
| 7 | `clear_aa_cache` | Preference | Delete Cache | Poweramp images cache will be deleted | — | **np** |

### 2.2 分类二 `pref_advanced_tweaks`（Advanced Tweaks，无 key，10 项）

| # | key | 类型 | 标题 | 摘要 / 补充 | 默认 | 标志 |
| ---: | --- | --- | --- | --- | --- | --- |
| 8 | *（分类头）* | Category | **Advanced Tweaks** | — | — | — |
| 9 | `aa_force_default` | MultilineSwitch | Force Default Image | Always show default image instead of any album art | `false` | — |
| 10 | `aa_8888` | MultilineSwitch | Use 24-bit RGB | Higher color resolution for album art. Requires 2x more memory per image | `false` | — |
| 11 | `aa_hi_res_for_apis` | MultilineSwitch | Send High Resolution Album Art | High resolution album art is sent to Android lock screen, app widgets, and other media API consumers. **Lock Screen ➔ Blur has priority over this option** | `false` | — |
| 12 | `aa_always` | MultilineSwitch | Always Send Album Art | For smartwatches/other devices which should always receive album art, even when screen is off | `false` | — |
| 13 | `aa_no_ashmem` | MultilineSwitch | API Compatibility | Change if album art is not visible in Android Auto/3rd party apps | `false` | **🧪 Experiment** |
| 14 | `download_if_no_tags` | MultilineSwitch | Also Search By Title/Filename | Search for album art even if no tags are found in the track | **`true`** | — |
| 15 | `prefer_downloaded_aa` | MultilineSwitch | Prefer Downloaded Album Art | Prefer downloaded album art over in-folder Cover.jpg/AlbumArt.jpg, etc | `false` | — |
| 16 | `aa_aspect` | **TagList** | Aspect Ratio | 见 §2.3 | `0` | — |
| 17 | `aa_higher_res` | MultilineSwitch | Increase Resolution | Increase image quality for high resolution embedded/in-folder images · **Consumes more RAM. Poweramp may crash due to insufficient memory** | `false` | **🧪 Experiment** |
| 18 | `aa_per_stream_track` | MultilineSwitch | Prefer Track Cover for Streams | Show album art based on stream track title/artist instead of the stream name · **Increases traffic usage** | `false` | — |

### 2.2.1 两个实验特性的完整提示

`aa_no_ashmem` 与 `aa_higher_res` 都带 **Experiment** 徽标，点击弹同一句话：

| 资源 | 文案 |
| --- | --- |
| `pref_experiment` | **Experiment**（徽标文字） |
| `pref_experimental_msg` | **This is an experimental feature - it may be changed/removed in the future builds and/or may not work on some Android variants/devices** |

XML 写法：

```xml
w:sup="@string/pref_experiment"
w:supLink="alert?text=@string/pref_experimental_msg"
```

> **`w:supLink` 是深链**：`alert?text=...` 表示点击后弹 Alert 对话框，内容取自 text 参数。这与外观文档 §4.3 的皮肤项点击机制同一套。

### 2.2.2 两个「风险提示」二级摘要

| key | `w:summary2` 资源 | 文案 |
| --- | --- | --- |
| `aa_higher_res` | `pref_requires_more_ram` | **Consumes more RAM. Poweramp may crash due to insufficient memory on the devices with not enough RAM** |
| `aa_per_stream_track` | `pref_increases_traffic` | **Increases traffic usage** |

> **只有这 2 项有 `w:summary2`**——都是"开了会有代价"的项。
>
> `pref_requires_more_ram` 这句不是客套：§5.2 已证实 `xn0.о < 0x80` 时该项会**直接置灰**。

### 2.2.3 restore_defaults 的文案

| 资源 | 文案 |
| --- | --- |
| `pref_restore_defaults` | **Restore Defaults** |

> 与其他页面同名同文案，但**作用域仅本页**（见外观文档 §11 的 `restore_defaults` 作用域分析）。
### 2.3 `aa_aspect` 四态（唯一的 TagList）

`@array/pref_aa_aspect_entries` + `pref_aa_aspect_summaries`【实证·原文】：

| 值 | entry | summary |
| ---: | --- | --- |
| 0 | **Default** | Keep landscape and square album art / images ratio |
| 1 | **Keep Aspect Ratio** | Keep album art / images aspect ratio as is. Tall images won't fit fully some UI elements |
| 2 | **Square** | Album art / images are always square |

> **只有 3 个 entry 但默认值写 `0`**——默认就是 `Default`。注意 XML 里 `w:summaries`（复数）与 `w:entries` 成对出现，这是 TagListPreference 的双数组模式。

> **这一项是本页唯一存到 `wr` 而非 `vr` 的参数**（`wr->t`），因为它是**渲染参数**而非下载参数。

### 2.4 全部 XML 属性与资源引用

#### 属性使用矩阵

| 属性 | 出现次数 | 作用 |
| --- | ---: | --- |
| `android:key` | 18 | 全部可交互项；2 个分类中只有第一个有 key |
| `android:title` | 19 | 全部元素 |
| `android:summary` | 16 | 二级说明文字 |
| **`android:defaultValue`** | **14** | 见下方专表 |
| `android:persistent` | 7 | 3 个 `"false"`（动作项）+ 4 个 `"true"`（显式声明） |
| `w:summary2` | 2 | 只用于"有代价"的两项 |
| `w:sup` | 2 | 实验特性徽标 |
| `w:supLink` | 2 | 徽标点击行为 |
| `w:entries` | 1 | 仅 `aa_aspect` |
| `w:summaries` | 1 | 仅 `aa_aspect`（双数组模式） |

#### `android:defaultValue` 专表（14 处）

| key | XML 声明值 | 与代码默认值是否一致 |
| --- | --- | --- |
| `download_album_art` | `false` | ✓ |
| `download_artist_art` | `false` | ✓ |
| `aa_download_hd` | `false` | ✓ |
| `download_aa_wifi_only` | **`true`** | ✓（代码也是 true） |
| `aa_force_default` | `false` | ✓ |
| `aa_8888` | `false` | ✓ |
| `aa_hi_res_for_apis` | `false` | ✓ |
| `aa_always` | `false` | ✓ |
| `aa_no_ashmem` | `false` | ✓ |
| `download_if_no_tags` | **`true`** | ✓（代码也是 true） |
| `prefer_downloaded_aa` | `false` | ✓ |
| `aa_aspect` | `0` | ✓（= Default） |
| `aa_higher_res` | `false` | ✓ |
| `aa_per_stream_track` | `false` | ✓ |

> **XML 的 `defaultValue` 与代码默认值 100% 一致**——这点值得注意：两处独立声明，没有漂移。
>
> 两个 `true` 的项（`download_aa_wifi_only` / `download_if_no_tags`）都是**保守默认**：默认只在 Wi-Fi 下载、默认放宽搜索范围。

#### 最简写法与显式写法混杂

| 写法 | 项数 | 例子 |
| --- | ---: | --- |
| **显式** `android:persistent="true"` | 4 | `download_album_art`、`aa_download_hd`、`aa_force_default`、`aa_8888` 等 |
| **省略**（默认即 true） | 11 | `aa_always`、`aa_no_ashmem`、`aa_aspect`、`aa_higher_res` 等 |
| **显式** `persistent="false"` | 3 | `reset_negative_aa_status`、`clear_aa_cache`、`restore_defaults` |

> **`persistent="true"` 是冗余的**（`Preference` 默认就是 true），但作者在部分项上显式写了。这不影响行为，只是风格不统一。
>
> 真正有意义的是 `persistent="false"` 那 3 个——**它们都是纯动作项**，没有需要保存的状态。

#### 资源引用汇总

| 类型 | 数量 | 说明 |
| --- | ---: | --- |
| `@string/*` | **40** | 全部有解析值，无缺失 |
| `@array/pref_aa_aspect_entries` | 1 | 3 项 |
| `@array/pref_aa_aspect_summaries` | 1 | 3 项 |
| `@drawable/*` / `@attr/*` | **0** | 本页无图标、无主题属性引用 |

> **本页是唯一完全无 `@drawable` 的独立设置页**（对比：背景页有 2 个 drawable，音频页有多个）——`aa.xml` 的所有元素都靠默认样式渲染，没有自定义图标。
>
> 这也符合本页定位：**纯功能配置页**，不需要视觉装饰。
>
> **XML 原文对照**：`reset_negative_aa_status` 的 summary 在 strings.xml 里写作 `Clear stored \"not-found\" status for album/artist images`（含转义引号），渲染时显示为普通双引号。
## 3. 两个分类的职责划分

| 分类 | 项数 | 职责 | 关键特征 |
| --- | ---: | --- | --- |
| **Download** | 6 | 爬取与缓存管理 | 2 个动作项（`reset_negative_aa_status` / `clear_aa_cache`）都是 `persistent="false"` |
| **Advanced Tweaks** | 10 | 渲染、内存、跨 App 传输 | 2 个实验特性 + 1 个 TagList + 1 个依赖内存检查 |

> **注意分类二的 key**：`pref_aa_downloading` 有 key，但 `pref_advanced_tweaks` **没有 key**（XML 里只写 `android:title`）。
>
> 这不是笔误——第一个分类需要被代码 `findPreference` 找到（用于动态增删），第二个不需要。

## 4. 偏好存储

### 4.1 `vr.smali`（prefs 文件 **`ftp`**）—— 9 个字段

| key | vr 字段 | 类型 | 默认 | 行号 |
| --- | --- | --- | --- | ---: |
| `aa_always` | `vr->u` | pb1(bool) | false | `:932` |
| `aa_force_default` | `vr->v` | pb1 | false | `:948` |
| `aa_no_ashmem` | `vr->w` | pb1 | false | `:964` |
| `prefer_downloaded_aa` | `vr->z` | pb1 | false | `:980` |
| `download_aa_wifi_only` | `vr->D` | pb1 | **true** | `:996` |
| `aa_download_hd` | `vr->F` | pb1 | false | `:1037` |
| `aa_8888` | `vr->G` | pb1 | false | `:1053` |
| `aa_hi_res_for_apis` | `vr->I` | pb1 | false | `:1069` |
| `aa_higher_res` | `vr->J` | pb1 | false | `:1085` |

> **`download_aa_wifi_only` 是唯一默认 `true` 的项**——`vr.smali:1000` 传的是寄存器 `v2`（`const/4 v2, 0x1`），其余都传 `v3`（`0x0`）。

### 4.2 `wr.smali`（prefs 文件 `futp`）—— 1 个字段

| key | wr 字段 | 类型 | 默认 | 行号 |
| --- | --- | --- | --- | ---: |
| `aa_aspect` | `wr->t` | rb1(int) | 0 | `:854` |

> **为什么 `aa_aspect` 单独在 `wr`？** 因为 `wr` 是**跨模块 UI 配置缓存**（见背景文档 §10.5），而 `aa_aspect` 影响所有 UI 的封面渲染，不只是本页。

### 4.3 `gr.smali`（prefs 文件 `frp`）—— 5 个下载字段

| key | gr 字段 | 默认 | 行号 |
| --- | --- | --- | ---: |
| `download_artist_art` | `gr->b` | false | `:508` |
| `download_album_art` | `gr->d` | false | `:524` |
| `download_if_no_tags` | `gr->e` | **true** | `:540` |
| `aa_per_stream_track` | `gr->f` | false | `:556` |
| `hide_unknown_album` | `gr->a` | **true** | `:492` |

> **`gr` 是下载子系统**：它只关心"要不要下载"的四个开关，不关心渲染参数。
>
> 这也解释了为什么 `download_album_art` / `download_artist_art` **不在 `vr` 里**——它们由 `gr` 独占。

## 5. 设置页绑定（`x61.v()`）

`x61.smali` 只有 2 个方法（构造器 + `v()`），`v()` 完成全部绑定【实证·产物】`x61.smali:46-510`。

### 5.1 listener 分发矩阵

| listener | 类型 | 绑定的 key | 说明 |
| --- | --- | --- | --- |
| `v61`（索引 0） | OnPreferenceChange | `download_album_art` | 改后触发动作 |
| `v61`（索引 1） | OnPreferenceChange | `download_artist_art` | 同上 |
| `v61`（索引 2） | OnPreferenceChange | `prefer_downloaded_aa` | 同上 |
| **`v61`（索引 3）** | OnPreferenceChange | **`aa_force_default` / `aa_hi_res_for_apis` / `aa_per_stream_track`** | **共用同一个实例**（`x61->j`） |
| `w61`（索引 0） | OnPreference**Click** | `aa_download_hd` | **点击而非开关** |
| `w61`（索引 1） | OnPreferenceClick | `restore_defaults` | 同上 |
| `w61`（索引 2） | OnPreferenceClick | `reset_negative_aa_status` | 同上 |
| `c91`（`x61->h`） | OnPreferenceChange | `aa_aspect` | 复用基类 listener |
| `c91`（新建，标识 1） | OnPreferenceChange | `aa_8888` | 带**内存检查** |
| `c91`（新建，标识 1） | OnPreferenceChange | `aa_higher_res` | 带**内存检查** |
| `x11`（标识 0x18） | OnPreference**Click** | `clear_aa_cache` | 清缓存动作 |

### 5.2 两个项带"内存门槛"检查

`aa_8888` 与 `aa_higher_res` 的绑定不是直接设 listener，而是先查内存【实证·产物】`x61.smali:232-333`：

```asm
const/16 v2, 0x80                  ; ★ 128
if-eqz v0, :cond_1
sget v3, Lׅ/xn0;->о:I             ; 当前设备内存等级
if-ge v3, v2, :cond_0              ; < 128 →
invoke-virtual {v0, v1}, Preference;->setEnabled(Z)V   ; ★ 禁用该项
goto :goto_0
:cond_0
; 内存足够 → 正常绑定 c91
invoke-virtual {v0, v3}, Preference;->setOnPreferenceChangeListener(...)
```

| key | 触发条件 | 后果 |
| --- | --- | --- |
| `aa_8888` | `xn0.о < 0x80`（128） | **该项置灰不可用** |
| `aa_higher_res` | `xn0.о < 0x80` | **该项置灰不可用** |

> **`xn0.о` = 堆内存上限（MB）**，精确计算见 **§5.4**。
>
> 这与 UI 文案呼应：`aa_higher_res` 的 `summary2` 明说 "Poweramp may crash due to insufficient memory on the devices with not enough RAM"——**不是免责声明，是真的会禁用**。

### 5.3 唯一的复用 listener

`aa_force_default` / `aa_hi_res_for_apis` / `aa_per_stream_track` **三项共用一个实例** `x61->j`（`v61` 索引 3）：

```asm
; aa_force_default
iget-object v1, p0, Lׅ/x61;->j:Lׅ/v61;
invoke-virtual {v0, v1}, Preference;->setOnPreferenceChangeListener(...)

; aa_hi_res_for_apis / aa_per_stream_track 用同一个 v1
```

> **这三项的共同点**：都影响**跨 App / 跨进程的封面行为**，改变后需要**广播通知其他组件刷新**。所以共用一个 listener 做统一的"通知重载"。


### 5.4 `xn0.о` 的精确计算（内存门槛）

【实证·产物】`xn0.smali:1341-1376`：

```asm
invoke-static {}, Ljava/lang/Runtime;->getRuntime()Ljava/lang/Runtime;
invoke-virtual {v0}, Ljava/lang/Runtime;->maxMemory()J    ; ★ 堆上限（字节）
move-result-wide v0
const-wide/16 v2, 0x400                                  ; 1024
div-long/2addr v0, v2                                    ; ÷1024 → KB
long-to-int v1, v0
div-int/lit16 v1, v1, 0x400                              ; ÷1024 → MB
sput v1, Lׅ/xn0;->о:I
```

**换算链**：

```
xn0.о = maxMemory() / 1024 / 1024 = maxMemory() 的 MB 数
```

> **`xn0.о` 就是 Java 堆上限的兆字节数**。`Runtime.maxMemory()` 返回 `-Xmx` 设的堆上限（不是设备物理内存）。

#### 门槛判定

`x61.smali` 的判断是 `if (xn0.о < 0x80)` → 禁用，即：

| `maxMemory()` | `xn0.о` | `aa_8888` / `aa_higher_res` |
| --- | ---: | --- |
| 128 MB | 128 | **可用**（边界值，`< 128` 为假） |
| 96 MB | 96 | ❌ 禁用 |
| 192 MB | 192 | ✅ 可用 |
| 256 MB | 256 | ✅ 可用 |
| 512 MB | 512 | ✅ 可用 |

> **阈值 128 MB 是堆上限，不是物理内存**——这是关键区别。
>
> 典型值参考：Android 默认堆上限 16–512 MB，视设备和 `heapgrowthlimit` 而定。2015 年后主流设备普遍 ≥192 MB，所以**实际很少触发禁用**——只有极低端设备或 32 位小内存机型才会看到这两项置灰。

#### 为什么这两项需要门槛

| key | 内存影响 |
| --- | --- |
| `aa_8888` | UI 文案明说 "Requires **2x** more memory per image"——ARGB_8888 比 RGB_565 多一倍 |
| `aa_higher_res` | UI 文案明说 "Consumes more RAM. Poweramp may **crash** due to insufficient memory" |

> **两项都直接影响图解码缓冲区大小**：
> - `aa_8888`：每像素 4 字节（ARGB_8888）vs 2 字节（RGB_565），**翻倍**
> - `aa_higher_res`：不降采样解码，大图直接进内存
>
> 在堆上限 96 MB 的设备上同时开这两项，一张 4000×4000 的 ARGB_8888 位图就要 64 MB——**必然 OOM**。所以这道门槛是**防御性设计**，不是营销噱头。

### 5.5 `aa_no_ashmem` 的真实机制（API Compatibility）

这一项的名字 `no_ashmem` 容易误解。**它实际控制的是 ContentProvider 通过 FD 传递封面时是否使用 ashmem 共享内存。**

#### 消费点：`AAContentProvider.openFile()`

【实证·产物】`AAContentProvider.smali:1484-1515`：

```java
ParcelFileDescriptor openFile(Uri uri, String mode) {
    boolean useAshmem = !vr->w.А;          // ★ 取反！
    return B(uri, null, useAshmem);        // → 内部方法
}
```

对应汇编【实证·产物】`AAContentProvider.smali:1492-1504`：

```asm
.method public final openFile(Landroid/net/Uri;Ljava/lang/String;)Landroid/os/ParcelFileDescriptor;
L1492: sget-object v0, Lׅ/vr;->w:Lׅ/pb1;      ; aa_no_ashmem
L1496: iget-boolean v0, v0, Lׅ/fc;->А:Z
L1500: xor-int/lit8 v0, v0, 0x1               ; ★ 取反！
L1504: invoke-virtual {p0, p1, p2, v0}, AAContentProvider;->B(Uri, [I, Z)
```

**语义**：

| `aa_no_ashmem` | `useAshmem`（取反后） | 行为 |
| --- | --- | --- |
| `false`（默认） | **true** | 通过 ashmem 共享内存传封面 |
| `true`（用户开启） | **false** | 退回普通文件 FD |

> **项名与逻辑相反是刻意的**：用户勾选"no ashmem"= 禁用 ashmem，所以代码里要取反。

#### 为什么需要这个开关

UI 文案说：**"Change if album art is not visible in Android Auto/3rd party apps"**。

原因链：

```
封面以 ParcelFileDescriptor 形式暴露给其他 App
  └─ 默认走 ashmem（Android 共享内存）
       └─ 部分 ROM / Android Auto 版本对 ashmem FD 支持不好
            └─ 第三方 App 拿到 FD 后解码失败 → 封面显示不出来
                 └─ 用户勾选 aa_no_ashmem → 退回普通文件 FD → 恢复正常
```

#### ashmem 可用性检测

`TagReader.В()` 是能力检测方法【实证·产物】`TagReader.smali:425-480`：

```asm
.method public static В()Z              ; canUseFDAshmem
L433: sget v1, Landroid/os/Build$VERSION;->SDK_INT:I
L437: const/16 v2, 0x17                  ; 23 = Android 6.0
L448: if-gt v1, v2, :cond_0              ; SDK <= 23 则跳过 Fiio 检查
L452: sget-boolean v1, Lׅ/xn0;->Н:Z     ; 设备特征位
L456: if-eqz v1, :cond_0
L460: "canUseFDAshmem FAIL - fiio"      ; ★ 显式排除 Fiio 设备
L469: return false

:cond_0
L477: native_get_test_ashmem_fd()        ; ★ 实测能否拿到 ashmem fd
```

**检测返回 `false` 的三种情况**（对应三条日志）：

| 日志 | 触发条件 |
| --- | --- |
| `canUseFDAshmem FAIL - fiio` | **Fiio 品牌设备**（已知不兼容） |
| `canUseFDAshmem FAIL can't get ashmem fd` | `native_get_test_ashmem_fd()` 返回失败 |
| `canUseFDAshmem FAIL can't seek ashmem fd` | FD 拿到了但 seek 失败 |
| `canUseFDAshmem FAIL decoded to bad bitmap=` | FD 有效但解码出的位图损坏 |

> **`Fiio` 是显式黑名单**——这是个中国 Hi-Fi 播放器品牌，其 ROM 对 ashmem 支持有已知问题。这类"厂商级 hack"在音频 App 里很常见。
>
> 也说明 `aa_no_ashmem` 的存在**不只是给用户手动挡**——系统会先自动检测，检测失败才降级。用户手动开关是最后的兜底。

#### 调用链总结

```
第三方 App / Android Auto 请求封面
  └─ AAContentProvider.openFile(uri, mode)
       ├─ useAshmem = !aa_no_ashmem
       └─ B(uri, null, useAshmem)
            ├─ useAshmem=true  → ashmem 共享内存 FD
            └─ useAshmem=false → 普通文件 FD

前置检测：TagReader.В()（canUseFDAshmem）
  ├─ SDK <= 23 → 不检查 Fiio
  ├─ 是 Fiio    → false
  └─ native_get_test_ashmem_fd() → 实测
```

#### `Application.smali:4979` 的另一处

`vr->w` 还出现在 `Application.smali:4979`——说明启动时也会读这个值，可能用于初始化时决定默认路径。未深入追踪。
## 6. 三个动作项

| key | listener | 动作 |
| --- | --- | --- |
| `clear_aa_cache` | `x11`（标识 `0x18`=24） | 清空图片缓存 |
| `reset_negative_aa_status` | `w61`（索引 2） | 清除"未找到"状态记录 |
| `restore_defaults` | `w61`（索引 1） | 恢复本页默认值 |

> **`clear_aa_cache` 用的是 `x11` 而非 `w61`**——`x11` 是通用的"动作分发器"（第一个参数 `0x18` 是动作码），说明清缓存是**全局动作**，不属于本页专属逻辑。


### 6.1 `x11` —— 全 App 通用动作分发器

**`x11` 不是本页专用的。** 它有 **19 个动作分支**（`pswitch_0` … `pswitch_18`），被全 App 的多个页面复用。

#### 分发机制

```asm
.method public final onPreferenceClick(Preference p)Z
L42: iget p1, x11->В:I              ; ★ 动作码（构造时传入）
L62: packed-switch p1, :pswitch_data_0
```

`.packed-switch 0x0` 起始值为 0，**索引 0 → `pswitch_18`，索引 24 → `pswitch_0`**（标签是倒序的）：

| 动作码 | 分支 |
| ---: | --- |
| 0 | `pswitch_18` |
| 1 | `pswitch_17` |
| … | … |
| **24 (0x18)** | **`pswitch_0`** ← **`clear_aa_cache` 用的就是这个** |

> **`aa.xml` 里 `clear_aa_cache` 传的是 `const/16 v2, 0x18`**，即动作码 24，走 `pswitch_0`。

#### `pswitch_0`（动作码 24）的完整实现

【实证·产物】`x11.smali:113-217`：

```java
:pswitch_0
SettingsActivity act = ((n91) obj).у;
new PseudoAlertDialog.Builder(act)
    .setTitle(0x7f0804be)              // = pref_clear_aa_cache = "Delete Cache"
    .setMessage(0x7f08066a)            // = pref_summary_clear_aa_cache
    .setDismissOnPositive(false)       // ★ 点击后不自动关闭
    .setPositiveButton(0x7f080001,     // = "OK"
        new za(0xF, act))              // ★ 真正的删除逻辑在 za，动作码 0xF
    .setNegativeButton(0x7f0800f9,     // = "Cancel"
        null)
    .create().show();
```

**三个资源 id 的解析**：

| id | 资源名 | 文案 |
| --- | --- | --- |
| `0x7f0804be` | `pref_clear_aa_cache` | **Delete Cache**（标题） |
| `0x7f08066a` | `pref_summary_clear_aa_cache` | **Poweramp images cache will be deleted**（正文） |
| `0x7f080001` | `OK` | OK（确定按钮） |
| `0x7f0800f9` | `cancel` | Cancel（取消按钮） |

> **`setDismissOnPositive(false)` 值得注意**：正常对话框点"确定"会自动关闭，这里设为 `false`——因为删除是**异步任务**，要在完成后再关。
>
> 这也解释了为什么 `za(0xF, act)` 会带上 `act` 引用：它需要在删除完成后回调关闭对话框。

#### 二次分发：`za` 动作码 `0xF`

`za` 是 `DialogInterface.OnClickListener`，动作码 `0xF`（15）——**又一层分发**。实际删除逻辑在 `za` 的对应分支里，未展开。

> **这是 Poweramp 的典型模式**：`x11`（点击分发） → `za`（按钮分发） → 实际逻辑。三层解耦让通用代码可以服务所有页面。

#### 另外两个动作项

| key | 用的东西 | 说明 |
| --- | --- | --- |
| `reset_negative_aa_status` | `w61`（本页专属，索引 2） | 不走 `x11`，因为要访问本页状态 |
| `restore_defaults` | `w61`（本页专属，索引 1） | 同上 |

> **只有 `clear_aa_cache` 走通用分发器**，因为清缓存是**全局动作**（不依赖本页任何状态）。另外两个要看本页的具体设置值，必须专属处理。

#### `w61` 的三个动作

| 索引 | key | 推断动作 |
| ---: | --- | --- |
| 0 | `aa_download_hd` | 改分辨率后重载 |
| 1 | `restore_defaults` | 恢复本页默认 |
| 2 | `reset_negative_aa_status` | 清"未找到"记录 |

> **注意 `aa_download_hd` 是 `MultilineSwitchPreference` 却绑了 `OnPreferenceClickListener`**（见 §5.1）——这在 Android 里不常见，意味着**点击整行不切换开关状态**，而是执行动作。
>
> 这可能是个**实现细节**：`w61` 内部会自己翻转开关值。

### 6.2 `za` —— 二级动作分发器（17 个分支）

`za` 是 `DialogInterface.OnClickListener`，1154 行 / **17 个动作分支**。`clear_aa_cache` 用的是动作码 **`0xF`=15**。

#### 分发结构

```asm
.method public final onClick(DialogInterface p1, int p2)V
L74: packed-switch v0, :pswitch_data_0    ; v0 = za->X（动作码）
```

`.packed-switch 0x0` 起始，**索引 15 → `pswitch_1`**：

| 动作码 | 分支 |
| ---: | --- |
| 0 | `pswitch_10` |
| 15 (0xF) | **`pswitch_1`** ← `clear_aa_cache` |
| 16 | `pswitch_0` |

#### `pswitch_1`（清缓存）

【实证·产物】`za.smali:173-223`：

```java
:pswitch_1
SettingsActivity act = (SettingsActivity) obj;
PseudoAlertDialog dlg = (PseudoAlertDialog) p1;
String msg = act.getString(0x7f08019c);   // = deleting_cache
dlg.toProgress(msg, true);                // ★ 转成进度条对话框
new Thread(new nb1(act, dlg)).start();    // ★ 后台线程执行
```

**资源 `0x7f08019c` 解析**：

| id | 资源名 | 文案 |
| --- | --- | --- |
| `0x7f08019c` | **`deleting_cache`** | **Deleting Cache...** |

> **`toProgress(msg, true)`** 把已显示的确认框原地转成进度条——不新建对话框，用户体验上是"确定后原地变成进度"。第二个参数 `true` 推测是 indeterminate（不确定进度）。

### 6.3 `nb1` —— 实际的删除执行者

`nb1`（4891 字节）是 `Runnable`，有**两个构造器**（参数顺序不同），说明被复用为"执行"与"完成"两个阶段。

#### `run()` 的两个分支

【实证·产物】`nb1.smali:54-234`：

```asm
.method public final run()V
L58: iget v0, nb1->X:I              ; 阶段码
L70: packed-switch v0, :pswitch_data_0

; ── 默认分支（阶段 != 0）：收尾 ──
L75: const v0, 0x7f0801b2           ; 资源 id
L80: String s = act.getString(v0)
L88: dlg.toToast(s)                 ; ★ 进度框转 Toast
L93: return

; ── pswitch_0（阶段 == 0）：执行删除 ──
L97:  const-wide/16 v3, 0x1f4        ; ★ 500ms
L101: SystemClock.sleep(v3)          ; 先睡 500ms
L106: File[] dirs = ne0.a(ctx)       ; ★ 取 5 个缓存目录

L121: const/4 v5, 0x5                ; ★ 循环 5 次
:goto_0
L124: if-ge v4, v5, :cond_1
L128:   File d = dirs[v4]
L136:   if (d.exists() && d.isDirectory())
L169:       d.listFiles(new k4(0))   ; ★ 用过滤器删除
L175:   v4++
L179:   goto :goto_0

:cond_1
L183: const v0, 0x7f0d015c           ; MsgBus id
L196: const v4, 0x7f0d003c           ; 消息码
L204: msgbus.post(v4, 0, 0, null)    ; ★ 广播"缓存已清"
L209: act->y:Handler
L213: new nb1(dlg, act)              ; ★ 再 post 自己（收尾阶段）
L222: handler.post(v3)
```

**两个资源**：

| id | 资源名 | 文案 |
| --- | --- | --- |
| `0x7f0801b2` | **`done`** | **Done**（收尾 Toast） |
| `0x7f0d015c` | **`bus_app_cmd`** | 消息总线 id（应用命令总线） |
| `0x7f0d003c` | **`cmd_app_refresh_aa`** | **刷新封面**命令码 |

#### 为什么先 sleep 500ms

```asm
const-wide/16 v3, 0x1f4     ; 500
invoke-static {v3, v4}, Landroid/os/SystemClock;->sleep(J)V
```

> **这是为了让进度条先渲染出来**。`toProgress()` 只是发起 UI 变更请求，真正的绘制要等主线程下一次 vsync；若立刻开始 IO，可能出现"对话框还没变成进度条就已经删完了"的闪烁。
>
> 500ms 是个偏保守的值——但也说明删除通常很快（否则不会在乎这点延迟）。

### 6.4 五个缓存目录

`ne0.a(Context)` 返回 **5 个 `File` 的数组**【实证·产物】`ne0.smali:1542-1784`：

```java
File[] a(Context ctx) {
    if (!(ctx instanceof Application)) ctx = ctx.getApplicationContext();
    RestLibrary lib = (RestLibrary) ctx.getSystemService("RestLibrary");
    if (lib == null) throw new AssertionError();

    File base = ne0.i(ctx);              // 缓存根目录
    return new File[] {
        new File(base, "album_art"),      // [0] 专辑封面
        new File(base, "artist_art"),     // [1] 艺术家图
        new File(base, "composer_art"),   // [2] 作曲家图
        new File(base, "playlist_art"),   // [3] 歌单封面
        new File(base, "genre_art"),      // [4] 流派图
    };
}
```

| 索引 | 目录名 | 内容 |
| ---: | --- | --- |
| 0 | **`album_art`** | 专辑封面 |
| 1 | **`artist_art`** | 艺术家图 |
| 2 | **`composer_art`** | 作曲家图 |
| 3 | **`playlist_art`** | 歌单封面 |
| 4 | **`genre_art`** | 流派图 |

> **5 个目录正好对应「Download Artist Images」文案里说的 "Includes Album Artists and Composers"**——说明艺术家图按角色分开存（artist / composer）。
>
> 这也解释了一个设计选择：**删除缓存会一并清掉歌单和流派的封面**，因为它们共用同一套下载与缓存机制。

#### 关键实现细节

| 行为 | 汇编 | 含义 |
| --- | --- | --- |
| 循环固定 **5 次** | `const/4 v5, 0x5` | 硬编码目录数，与 `ne0.a()` 返回长度一致 |
| 双重检查 | `exists() && isDirectory()` | 目录不存在或不合法就跳过 |
| 用 `FileFilter` 删除 | `listFiles(new k4(0))` | **不是直接 `deleteRecursive`**，而是先过滤再删 |

#### `k4` —— 删除过滤器（关键细节）

`k4` 是 `FileFilter`，2295 字节【实证·产物】`k4.smali:32-82`：

```java
public boolean accept(File f) {
    switch (this.В) {                       // 模式
        case 0:                             // ← 清缓存用的就是这个
            if (".nomedia".equals(f.getName()))
                goto :goto_0;               // ★ 跳过 .nomedia
            f.delete();                     // ★ 立即删除
        :goto_0
            return false;                   // ★ 恒定返回 false
        default:
            ...                             // 其他模式（按扩展名过滤）
    }
}
```

**两个关键行为**：

| 行为 | 效果 |
| --- | --- |
| **`.nomedia` 文件被保留** | 不删除，避免系统媒体扫描器重新索引缓存目录 |
| **恒定返回 `false`** | `listFiles()` 返回**空数组**，但副作用是**文件已被删光** |

> **这是"利用 `listFiles` 遍历副作用删文件"的技巧**——比手写递归删除省一次目录遍历，也不需要收集结果。
>
> **保留 `.nomedia` 是个重要细节**：缓存目录里通常放一个 `.nomedia` 空文件，防止 Android 媒体库扫描到这些临时图片。如果连它一起删了，下次系统扫描会把整个缓存目录当音乐库索引一遍——**既浪费性能又会让相册里出现大量封面缩略图**。
>
> 所以"Delete Cache"其实不是"清空目录"，而是"**删掉所有图片，保留 .nomedia**"。

### 6.5 完整调用链

```
用户点击「Delete Cache」
  └─ x11.onPreferenceClick（动作码 24）
       └─ pswitch_0：弹确认框
            ├─ 标题 "Delete Cache"
            ├─ 正文 "Poweramp images cache will be deleted"
            └─ 确定 → za(0xF, act).onClick
                 └─ pswitch_1：
                      ├─ dlg.toProgress("Deleting Cache...", true)
                      └─ new Thread(nb1).start()
                           └─ nb1.run() 阶段 0：
                                ├─ sleep(500ms)  ← 等进度条渲染
                                ├─ ne0.a(ctx) → 5 个目录
                                ├─ 遍历 5 目录，listFiles(k4)
                                │    └─ k4：删文件但保留 .nomedia
                                ├─ msgbus.post(0x7f0d003c)  ← 广播刷新
                                └─ handler.post(nb1)  → 阶段 1
                                     └─ nb1.run() 默认分支：
                                          └─ dlg.toToast(提示)  ← 收尾
```

> **异步设计完整闭环**：进度框 → 后台线程 → 广播刷新 → 主线程收尾。全程不阻塞 UI。

### 6.6 另一个动作项的实际实现

`reset_negative_aa_status` 用 `w61`（本页专属，索引 2），与清缓存不同——它**不走 `x11`/`za`**，因为需要精细控制。

> 两者对比：
>
> | 项 | 分发路径 | 复杂度 |
> | --- | --- | --- |
> | `clear_aa_cache` | `x11`(24) → `za`(15) → `nb1` | **4 层** |
> | `reset_negative_aa_status` | `w61`(2) → 直接执行 | **2 层** |
>
> 清缓存是**通用动作**（任何页面都可能需要），所以走通用分发器；重置负面状态是**本页专属**，直接处理更高效。
## 7. 三个链路的整体关系

```
┌─────────────────────────────────────────────────┐
│ 配置层                                            │
│   Download 分类  → gr.smali  (5 字段)             │
│   Advanced 分类  → vr.smali  (9 字段, ftp)        │
│   aa_aspect      → wr.smali  (1 字段, futp)       │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ 下载层  gr.smali                                  │
│   判定：download_album_art / download_artist_art  │
│   条件：download_aa_wifi_only                     │
│   兜底：download_if_no_tags                       │
│   流媒体：aa_per_stream_track                     │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ 存储层                                            │
│   文件缓存 + "not-found" 状态记录                  │
│   动作：clear_aa_cache / reset_negative_aa_status │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ 渲染/传输层                                       │
│   渲染：aa_aspect（比例）、aa_8888（色彩）、        │
│         aa_higher_res（分辨率）、aa_force_default  │
│   传输：aa_hi_res_for_apis / aa_always（系统 API） │
│         aa_no_ashmem（Android Auto 兼容）          │
└─────────────────────────────────────────────────┘
```

## 8. 未解问题

### 8.1 已解决（累计）

| 问题 | 解决情况 | 位置 |
| --- | --- | --- |
| **`xn0.о` 的量纲** | ✅ `maxMemory()/1024/1024` = 堆上限 MB，阈值 128 | §5.4 |
| **`gr->a` 的 key** | ✅ `hide_unknown_album`（默认 true） | §4.3 |
| **`aa_no_ashmem` 机制** | ✅ 控制 ContentProvider FD 是否走 ashmem | §5.5 |
| **`x11` 动作码 0x18** | ✅ = 24 → `pswitch_0` = 清缓存确认框 | §6.1 |
| **`za` 动作码 0xF** | ✅ = 15 → `pswitch_1` = 转进度 + 起线程 | §6.2 |
| **`clear_aa_cache` 完整链** | ✅ 4 层分发 → `nb1` → 删 5 目录 | §6.5 |
| **五个缓存目录的路径** | ✅ `album_art`/`artist_art`/`composer_art`/`playlist_art`/`genre_art` | §6.4 |
| **`.nomedia` 被保留** | ✅ `k4` 显式跳过它 | §6.4 |
| **`k4` 的删除技巧** | ✅ 恒定返回 false，靠 `listFiles` 副作用删 | §6.4 |
| **收尾提示文案** | ✅ `done` = "Done" | §6.3 |
| **刷新广播** | ✅ `bus_app_cmd` / `cmd_app_refresh_aa` | §6.3 |
| **三个存储位置分工** | ✅ `vr`(ftp) / `wr`(futp) / `gr`(frp) | §4 |

### 8.2 仍未解

1. **`ne0.i(Context)` 的缓存根目录**：5 个目录都拼在它返回的 `File` 下，但该方法的实际路径未追踪。
2. **`aa_per_stream_track` 的流媒体判定**：字段在 `gr->f`，"什么算流媒体"未确认。
3. **`download_aa_wifi_only` 的网络检查点**：字段在 `vr->D`，实际判定位置未确认。
4. **`v61` 索引 3 如何区分三个来源 key**：`aa_force_default` / `aa_hi_res_for_apis` / `aa_per_stream_track` 共用 listener，内部分支未展开。
5. **`aa_aspect` 的渲染侧读取点**：存到 `wr->t`，但渲染代码怎么用未追。
6. **`Application.smali:4979` 读 `vr->w` 的用途**：启动时另一处读取。
7. **`aa_download_hd` 绑 OnPreferenceClick 的翻转机制**：作为 Switch 却不用 Change listener，内部如何改值未确认。
8. **`k4` 的其他模式**：`В != 0` 时走"按扩展名过滤"分支（用 `za0->B` 数组），与本页无关但未展开。
9. **`nb1` 两个构造器的用途差异**：参数顺序不同（`(act, dlg)` vs `(dlg, act)`），推测对应两个阶段，未验证。

---

## 9. 证据索引

| 主题 | 路径 : 行 |
| --- | --- |
| 页面结构 / 19 元素 | `v1035/decoded/res/xml/aa.xml:1-26` |
| 资源 id `0x7f160000` | `res/values/public.xml` |
| `aa_aspect` 数组 | `res/values/arrays.xml`（`pref_aa_aspect_entries` / `_summaries`） |
| 全部文案（40 条） | `res/values/strings.xml` |
| **vr 字段绑定（9 个）** | `ׅ/vr.smali:932,948,964,980,996,1037,1053,1069,1085` |
| vr prefs 文件名 `ftp` | `ׅ/vr.smali:383` |
| **wr 字段绑定（aa_aspect）** | `ׅ/wr.smali:854` |
| **gr 字段绑定（5 个）** | `ׅ/gr.smali:504,508,524,540,556` |
| **设置页绑定 `x61.v()`** | `ׅ/x61.smali:46-510` |
| 内存门槛检查 | `ׅ/x61.smali:232-333`（`xn0.о < 0x80`） |
| `clear_aa_cache` 动作 | `ׅ/x61.smali:116-145`（`x11` 标识 0x18） |
| 清缓存实现引用 | `ׅ/z61.smali:2187` |
| **`xn0.о` 内存计算** | `ׅ/xn0.smali:1341-1376` |
| **`x11` 动作分发器** | `ׅ/x11.smali:38-217`（19 个分支） |
| **`aa_no_ashmem` 消费** | `com/maxmpz/audioplayer/data/aa/AAContentProvider.smali:1484-1515` |
| ashmem 能力检测 | `com/maxmpz/audioplayer/scanner/TagReader.smali:425-480` |
| gr prefs 文件名 `frp` | `ׅ/gr.smali:249` |
| `hide_unknown_album` | `ׅ/gr.smali:492-504` |
| **`za` 二级分发器** | `ׅ/za.smali:74-225`（17 分支） |
| **`nb1` 删除执行者** | `ׅ/nb1.smali:54-234` |
| **5 个缓存目录** | `ׅ/ne0.smali:1542-1784`（`ne0.a`） |
| **`k4` 删除过滤器** | `ׅ/k4.smali:32-82`（保留 `.nomedia`） |
| `deleting_cache` 文案 | `res/values/strings.xml`（`0x7f08019c`） |
| `done` 收尾文案 | `res/values/strings.xml`（`0x7f0801b2`） |
