---
doc_id: "ARCH-POWERAMP-IMPL-IDEA39-DEVICE-FIRST-OUTPUT"
title: "已实现投票逐条逆向 #6：输出菜单改为设备优先（idea 39）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1035-bundle-play (versionCode 1035009)"
revision: 1
open_items: 1
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 继续逐条逆向已实现投票"
  - "docs/architecture/poweramp-feature-votes.md"
  - "docs/architecture/poweramp-release-changelog.md（changelog_102x）"
  - ".rea-analysis/v1035/decoded/res/xml/{audio_outputs2,audio_outputs_tweaks}.xml"
  - ".rea-analysis/v1035/decoded/smali/ׅ/{o81,w81,t21}.smali"
---

# 已完成投票 #6 — 输出菜单改为设备优先（idea 39）

> 投票原文：*"Improve the usability of the Settings=>Audio=>Output menu, so you first see a list of
> physical devices (Speaker, Wired Headset/AUX, USB DAC, Bluetooth, Chromecast) and then underneath
> each device you select what audio method you wish..."*，50 票。

## 0. 一句话结论

**这是一次目录结构反转**——从插件优先改成设备优先，并新增一个承接原插件级选项的二级页。

| 页面 | 1025 | 1035 | 行数 |
| --- | --- | --- | ---: |
| 输出列表 | `audio_outputs.xml` | **`audio_outputs2.xml`** | 8 → 16 |
| 高级调整 | 内嵌在插件列表 | **`audio_outputs_tweaks.xml`**（新页） | 0 → 10 |
| 设备选项 | `audio_output_device_opts.xml` | 同名，改用 `?device=` 寻址 | 保留 |

---

## 1. 结构对比

### 1.1 build-1025：插件优先（8 行）

```xml
<PreferenceScreen android:title="@string/pref_audio_output"
    w:searchIndexer="...SettingsHelperAudioOutputs$SearchIndexer"
    w:searchBreadcrumb1="@string/pref_audio_engine">
    <PreferenceCategory android:title="@string/pref_output_plugins"
                        android:key="output_plugins_list" />   <!-- 空分类，运行期填插件 -->
    <RawTextPreference android:key="output_unassigned_text" />
    <Preference android:key="restore_defaults" />
</PreferenceScreen>
```

> 用户必须先选插件、再进该插件选项——先选方法再选设备，正是投票抱怨的痛点。

### 1.2 build-1035：设备优先（16 行）

```xml
<PreferenceScreen android:title="@string/audio_outputs"
    w:searchIndexer="...SettingsHelperAudioOutputs2$SearchIndexer">  <!-- 面包屑已移除 -->
    <RawTextPreference w:line1="@string/audio_outputs_hint1"
                       w:line2="@string/audio_outputs_hint2" />
    <ButtonPref android:key="output_headset"    android:title="@string/device_headset"
                android:icon="@drawable/wired_24dp"      android:persistent="false" />
    <ButtonPref android:key="output_speaker"    android:title="@string/device_speaker"
                android:icon="@drawable/speaker_24dp"    android:persistent="false" />
    <ButtonPref android:key="output_bt"         android:title="@string/device_bt"
                android:icon="@drawable/bt_24dp"         android:persistent="false" />
    <ButtonPref android:key="output_usb"        android:title="@string/device_usb"
                android:icon="@drawable/usb_24dp"        android:persistent="false" />
    <ButtonPref android:key="output_chromecast" android:title="@string/device_chromecast"
                android:icon="@drawable/chromecast_24dp" android:persistent="false" />
    <ButtonPref android:key="output_other"      android:title="@string/device_other"
                android:icon="@drawable/other_24dp"      android:persistent="false" />
    <PreferenceCategory android:title="@string/pref_other">
        <RedirectPreference android:key="audio_outputs_tweaks"
                            w:target="audio_outputs_tweaks" />   <!-- 原插件选项搬家 -->
    </PreferenceCategory>
    <Preference android:key="restore_defaults" />
</PreferenceScreen>
```

页面提示 `audio_outputs_hint1`：*"Poweramp may use different audio output drivers
depending on the connected output device"* —— 一句话解释了改版的意义：驱动由设备决定。

### 1.3 六设备与枚举对齐

| key | 文案 | 图标 | `t21.А(int)` |
| --- | --- | --- | --- |
| `output_headset` | Wired Headset/AUX | `wired_24dp` | `headset` (0) |
| `output_speaker` | Speaker | `speaker_24dp` | `speaker` (1) |
| `output_bt` | Bluetooth | `bt_24dp` | `bt` (2) |
| `output_usb` | USB DAC | `usb_24dp` | `usb` (3) |
| `output_other` | Other Output Devices | `other_24dp` | `other` (4) |
| `output_chromecast` | Chromecast | `chromecast_24dp` | `chromecast` (5) |

> XML 里 `other` 在 `chromecast` 之前，枚举里 `other`=4、`chromecast`=5——顺序不同。
> XML 顺序是展示优先级，枚举顺序是历史编码。

---

## 2. 运行期：设备按钮如何跳到设备选项页

### 2.1 页面分发

```
u61.smali:1235   const v4, 0x7f160009   → audio_outputs2       → o81 (11558 行)
u61.smali:1281   const v0, 0x7f16000a   → audio_outputs_tweaks → w81 (2901 行)
```

### 2.2 深链构造 `o81.О()`（`:11450-11557`）

```smali
.method public final О()Ljava/lang/String;
    base = super.О()                          ; 父类给的页面 URI
    dev  = Uri.encode(this.F)                 ; 设备 id
    if (this.I != null && length != 0) {
        prof = "&profileName=" + Uri.encode(this.I)
    } else {
        prof = ""
    }
    return t21.y(base, "?device=", dev, prof) ; 形如 ?device=3&profileName=USB_DAC
}
```

> 这就是 per-output / per-profile 覆盖的寻址方式：每个设备（乃至每个 profile）
> 有独立选项页地址，同名设置在不同地址下各自取值。
> `poweramp-impl-idea40-bit-perfect.md` 的按设备覆盖同样靠这个 URI 区分。

### 2.3 设备 id 守卫 `t21.A(I)Z`（`:7-33`）

```smali
.method public static A(I)Z
    if (p0 < 0) return false
    if (p0 > 5) return false      ; 0..5 共 6 类
    return true
}
```

`o81.Q()` 开头（`:1816-1849`）用它守卫：

```smali
deviceId = this.G
if (!t21.A(deviceId)) {
    Log.e("SettingsHelperAudioOutputDeviceOpts", "resolvePlugin !deviceId=" + deviceId)
    return;                                    ; 非法设备 → 放弃渲染
}
plugin = fr.g(this.I, deviceId, true)          ; 按设备解析输出插件
```

> 日志标签 **`SettingsHelperAudioOutputDeviceOpts`**（`:1842`）证实：
> 设备列表页与设备选项页共用同一 helper 家族，后者带 `?device=` 参数。

---

## 3. 高级调整页（新页）

| key | 类型 | persistent | 含义 |
| --- | --- | --- | --- |
| `usb_activity` | MultilineSwitch | **false** | USB 连接时显示 Poweramp |
| `force_no_speaker` | MultilineSwitch | true | Hi-Res 强制不用扬声器 |
| `use_stream3_player` | MultilineSwitch | true（默认 false） | 使用 stream3 播放器 |
| `audio_platform_log` | RedirectPreference | — | 输出检测日志页 |
| `restore_defaults` | Preference | — | 恢复默认 |

> `usb_activity` 是 `persistent="false"`——真实存储由设备选项页的
> `w:target="audio_outputs_tweaks#usb_activity"` 深链定位，
> 与 `poweramp-list-options-settings-entry.md` 的 `settings/<xml>#<key>` 规则一致。

---

## 4. helper 规模与职责

| helper | 行数 | 职责 |
| --- | ---: | --- |
| `ׅ/o81` | **11558** | `audio_outputs2` **+** 设备选项页 `audio_output_device_opts` 共用 |
| `ׅ/w81` | 2901 | `audio_outputs_tweaks` |
| `ׅ/g71` | 1294 | `audio_bit_perfect`（见 idea 40 专文） |

`o81` 覆盖的按键（节选）：

| 类别 | 键 |
| --- | --- |
| 采样率 | `sample_rate`、`allowed_srs`、`prefer_base_rate`、`follow_sr_hint1/2` |
| 格式 | `sample_fmt`、`sample_bits_static`、`use_float` |
| DSD | `dsd_remaster`、`dsd_remaster_sample_rate`、`dsd_remaster_allow_48k`、`allow_dsd_dop`、`prefer_dsd_raw` |
| USB | `pause_usb_release`、`warmup`、`pcm_dsd_extra_warmup`、`force_usb_full_speed` |
| 音量 | `volume_type`、`sync_hw_volume`、`restore_hw_volume`、`shizuku_absvol` |
| 蓝牙 | `set_codec_sr` |
| Bit Perfect | `pipeline64`、`perfect_bit_perfect` |
| DSP 抑制 | `no_headroom`、`no_equ`、`no_duck`、`no_af` |

> **`o81` 是整个输出设置的主干**——设备优先不只是改 XML，
> 而是把所有设备相关选项收拢进同一个 helper。

---

## 5. 与 idea 40 的关系

| | idea 39（本文） | idea 40 |
| --- | --- | --- |
| 管什么 | **用哪个后端** | 该后端支不支持位精确 |
| 页面 | `audio_outputs2` | `audio_bit_perfect` |
| 设备枚举 | `t21.A(int)` 0..5 | `t21.А(int)` 0..5（同一套） |
| 跳转 | `?device=N&profileName=X` | `audio_bit_perfect#global_*` |

> 两者共用 `t21` 的设备枚举与 `?device=` 寻址，是同一次重构的两半：
> 先让设备成为一等公民（idea 39），位精确才能按设备分档（idea 40）。

---

## 6. 可借鉴 / 不建议照抄

### 6.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | 目录反转：把用户心智模型提到上层 | 驱动差异由设备决定 |
| A2 | `?device=&profileName=` 多实例寻址 | 同名设置按设备/配置各自取值 |
| A3 | 设备 id 先校验再渲染 | 非法直接 log + return |
| A4 | 旧插件选项独立成页而非删除 | 老路径不丢 |
| A5 | 搜索索引类随页改名（Outputs → Outputs2） | 搜索仍能命中新页 |

### 6.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 单 helper 11558 行承载两页 | 职责过载 |
| N2 | XML 顺序与枚举顺序不一致 | 易错位 |
| N3 | 移除 `w:searchBreadcrumb1` | 搜索里的层级路径变浅 |

---

## 7. 双向寻址总览（本节承上启下）

整个设备优先体系有**两条互逆的寻址链**：

```
设置页展示：  id(0..5) --t21.А()--> "headset"  --?device=-->  选项页 URI
选项页解析：  "headset" --t21.B()--> id(0..5) --this.G-->   内部字段
```

| 方向 | 入口 | 产物 |
| --- | --- | --- |
| 出站 | `o81.О()` `:11450` | `?device=headset&profileName=...` |
| 入站 | `o81` `:1729` | `this.G`（int）+ `this.F`（原字符串） |

> 两处都用 `t21` 的同一对函数，**保证 UI 显示的内部 id 与实际寻址字符串永远一致**。
> 这也是 idea 40 Bit Perfect 能按设备分档的基础。

---
## 8. 本轮新增解出（原 Q1 / Q3 闭合）

### 8.1 ★ 设备按钮的真实跳转链（Q1 闭合）

`ButtonPref.onClick`（`:343-397`）本身**不含业务**，只是转发：

```smali
.method public onClick(Landroid/view/View;)V
    if (view.getId() == 0x7f0d0265) {          ; 被点的是内部 FastButton
        if (this.k != null) {                   ; 有注入的 OnPreferenceClickListener
            if (this.k.onPreferenceClick(this)) return;   ; 由它处理
        }
    }
    super.onClick(view);                        ; 否则走 RawTextPreference
}
```

真正的跳转在 `ׅ/t71`（`implements OnPreferenceClickListener`，`В` 字段是索引）：

| 索引 | 分支 | 行为 |
| ---: | --- | --- |
| 0 | `pswitch_0`（`:111`） | `PseudoAlertDialog` 确认框（`setTitle 0x7f0801e9` / `setMessage 0x7f080794`） |
| 1 | `pswitch_1`（`:234`） | `Intent → EqPresetsActivity`，带 `selectAndAssignMode` / `selectAndAssignDeviceId` / `selectAndAssignProfileName` |
| 2 | `pswitch_2`（`:311`） | `Intent → AudioBufferActivity`，带 `uniqName` / `device` / `profileName` |
| 3 | （`o81:10441` 构造） | 另一处用途 |

`o81` 里的四处构造：`new t71(this,1)` @`:3407`、`new t71(this,2)` @`:3424`、`new t71(this,0)` @`:10039`、`new t71(this,3)` @`:10441`。

> **关键点**：同一个设备行**挂了两个监听器**——
> `setOnPreferenceClickListener(t71(this,1))`（整行点击）与
> `ButtonPref.setOnClickListener(t71(this,2))`（右侧图标按钮），
> **点整行进预设分配页，点图标直接进缓冲设置页**。这是紧凑的双目标设计。

### 8.2 ★ `?device=` 的消费点（Q3 闭合）

`o81` 从 URI 解析参数（`:1713-1741`）：

```smali
profileName = bundle.getString("profileName")
this.I = profileName
this.G = t21.B(deviceName)      ; ★ 名字 -> 数字 id
this.F = deviceName             ; ★ 同时保留原始名字
if (this.G < 0) { Log.e(TAG, "FAIL device=" + ...) ; return false; }
```

**注意这不是 `getIntExtra`，而是把名字反查成 id**——因为 URI 里传的是 `headset` 这类字符串。

### 8.3 ★ 双向映射 `А` / `B`（本轮重点 + 一处自我订正）

`t21` 里有两个方向相反的函数：

| 函数 | 位置 | 方向 |
| --- | --- | --- |
| `А(I)String` | `:700-804` | **id → 名字** |
| `B(String)I` | `:35-325` | **名字 → id** |
| `A(I)Z` | `:7-33` | 合法性（0..5） |

`А(I)` 的控制流是**逆序 if-eq**，必须按 `:cond_x` 反读：

```smali
if-eqz p0, :cond_5   → p0=0 → cond_5 → "headset"
if-eq p0,1, :cond_4  → p0=1 → cond_4 → "speaker"
if-eq p0,2, :cond_3  → p0=2 → cond_3 → "bt"
if-eq p0,3, :cond_2  → p0=3 → cond_2 → "usb"
if-eq p0,4, :cond_1  → p0=4 → cond_1 → "other"
if-eq p0,5, :cond_0  → p0=5 → cond_0 → "chromecast"
（default 落空 → "Unknown_" + id）
```

`B(String)` 是 **hashCode → sparse-switch → 局部序 → packed-switch → 返回值** 两段跳：

| 名字 | hashCode | sswitch | 局部序 | pswitch | 返回 |
| --- | ---: | --- | ---: | --- | ---: |
| `headset` | `0x2f67a282` | `_0` | 5 | `pswitch_0` | **0** |
| `speaker` | `-0x77b7a001` | `_5` | 0 | `pswitch_5` | **1** |
| `bt` | `0xc52` | `_3` | 2 | `pswitch_3` | **2** |
| `usb` | `0x1c584` | `_2` | 3 | `pswitch_2` | **3** |
| `other` | `0x6527f10` | `_1` | 4 | `pswitch_1` | **4** |
| `chromecast` | `-0x59f47f47` | `_4` | 1 | `pswitch_4` | **5** |

六个 hashCode 已用 Java 算法逐一验算吻合。

互逆校验（`fr:601` 用 `B()`、`:689` 用 `А()`，同一 id 直通）：

| 名字 | `B()` | `А(B())` | 一致 |
| --- | ---: | --- | :---: |
| headset | 0 | headset | ✅ |
| speaker | 1 | speaker | ✅ |
| bt | 2 | bt | ✅ |
| usb | 3 | usb | ✅ |
| other | 4 | other | ✅ |
| chromecast | 5 | chromecast | ✅ |

> **口径订正**：本轮中途我曾误判"`А` 与 `B` 编号空间不一致"，
> 原因是把 `А(I)` 的 `if-eq` 链**顺序读**了。按 `:cond_x` 标签反读后完全互逆。
> `fr:601→:689` 的同函数直通链路是最硬的佐证。

---
## 9. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`ButtonPref.onClick` 实际触发~~ | ✅ **已闭合**（§8.1）：转发给 `t71`，索引 1→EqPresetsActivity、2→AudioBufferActivity |
| Q2 | `fr.g(name, deviceId, true)` 的插件解析规则 | 只知签名与调用点，插件表来源未展开 |
| ~~Q3~~ | ~~`?device=` 消费点~~ | ✅ **已闭合**（§8.2）：`:1713-1741` 用 `t21.B(name)` 反查出 `G` |

> 三项都属再往下跨到插件管理系统的边界；本条的结构反转与寻址机制已完整解出。

---

## 10. 证据索引

| 主题 | 位置 |
| --- | --- |
| 旧页（插件优先） | `1025/decoded/res/xml/audio_outputs.xml`（8 行） |
| 新页（设备优先） | `v1035/decoded/res/xml/audio_outputs2.xml`（16 行） |
| 新二级页 | `v1035/decoded/res/xml/audio_outputs_tweaks.xml`（10 行） |
| 页面分发 | `ׅ/u61.smali:1235`、`:1281` |
| 设备 id 守卫 | `ׅ/t21.smali:7-33` |
| 设备枚举 | `ׅ/t21.smali:700-804` |
| 渲染入口 | `ׅ/o81.smali:1808`（`Q()`）、`:1816-1849` |
| 深链构造 | `ׅ/o81.smali:11450-11557`（`О()`） |
| tweaks helper | `ׅ/w81.smali`（2901 行） |
| ButtonPref | `preference/ButtonPref.smali`（641 行；`onClick` `:343`） |
| 监听器 | `ׅ/t71.smali:38-398`（索引 0/1/2 三分支） |
| 监听器构造 | `o81.smali:3407`(1) / `:3424`(2) / `:10039`(0) / `:10441`(3) |
| 参数解析 | `o81.smali:1713-1741`（`t21.B` 反查 id） |
| 双向映射 | `t21.smali:700-804`（`А`）/ `:35-325`（`B`） |
| 直通佐证 | `fr.smali:601`（`B`）→ `:689`（`А`） |

> 口径：**build-1035**（本条在 1025 中不存在）。