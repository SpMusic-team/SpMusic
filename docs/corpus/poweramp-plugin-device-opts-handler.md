---
doc_id: "ARCH-POWERAMP-PLUGIN-DEVICE-OPTS-HANDLER"
title: "插件系统（七）：设备选项页 helper c1 与 __avail_hires 伪插件"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/corpus/poweramp-settings-fragment-dispatch.md（四）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/preference/c1.smali"
---

# 插件系统（七）：设备选项页 helper c1 与 __avail_hires 伪插件

## 0. 一句话结论

`preference/c1`（2786 行）是 `audio_output_device_opts` 页的专用 helper。
它接收**两个 extras**（`device` + `uniqName`），解析出插件后渲染该设备下的全部音频参数。

**最重要的发现**：`uniqName` 有一个约定伪值 **`__avail_hires`**，
它不是任何真实插件，而是"取当前可用的 Hi-Res 插件"的**动态引用**。

---

## 1. 参数接收（`c1.z()`，`:497-566`）

```smali
b = getArguments();
deviceName = b.getString("device");          // "headset"/"usb"/...
devId      = z5.Х(deviceName);                // 名字 -> 0..5
npm        = getSystemService("__NativePluginManager");
plugin     = c1.v(npm, b.getString("uniqName"));   // ★ 解析插件
if (plugin == null || deviceName == null || deviceName.length() == 0 || devId == -1) {
    return;                                    // 参数不全直接放弃渲染
}
```

| 参数 | 来源 | 校验 |
| --- | --- | --- |
| `device` | extras | 非空 + 能解析成 0..5 |
| `uniqName` | extras | 能解析出 `NativePluginInfo` |

> 这与第三篇的发送端严格对应：
> `k0` 发 `target=audio_output_device_opts` + `uniqName` + `device`，`c1` 全收。

---

## 2. ★ `__avail_hires` 伪插件（`c1.v()`，`:100-181`）

```smali
.method public static v(NativePluginManager npm, String uniqName) NativePluginInfo
    if (uniqName.isEmpty()) return null;
    if (uniqName.equals("__avail_hires")) {           // ★ 约定伪值
        try { info = npm.х("com.maxmpz.audioplayer/output.athd"); }
        catch (e) { Log.e("SettingsHelperAudioOutputDeviceOpts", "", e); }
        if (info == null) {
            try { info = npm.х("com.maxmpz.audioplayer/output.oslhd"); }
            catch (e) { Log.e(..., e); }
        }
        return info;
    }
    try { return npm.х(uniqName); }
    catch (e) { Log.e(..., e); return null; }
}
```

### 2.1 为什么需要它

| | 普通 uniqName | `__avail_hires` |
| --- | --- | --- |
| 含义 | 具体某个插件 | **"当前可用的 Hi-Res 后端"** |
| 解析 | `npm.х(uniqName)` | 先 `output.athd`，失败回退 `output.oslhd` |
| 用途 | 设备绑定到具体插件 | 设备"想要 Hi-Res 但不确定用哪个" |

> **这是"能力查询"而非"实例查询"**。设备偏好里可以写 `__avail_hires`，
> 表示"给我最好的 Hi-Res 后端"，由 c1 在运行期决定落到 athd 还是 oslhd。

`х(String)`（`NativePluginManager:1334-1361`）就是按 `uniqName` 查 HashMap：

```smali
if (!loaded) { Log.e("NativePluginManager","not loaded yet"); return null; }
return А.get(uniqName);        // А = HashMap<String, NativePluginInfo>
```

> ⚠️ **`__avail_hires` 不是真实 uniqName**——若把它传给 `npm.х()` 会返回 null。
> 只有 `c1.v()` 知道如何展开它。这是**隐式协议**，靠约定而非类型保证。

---

## 3. 当前插件的高亮（`:567-591`）

```smali
curPluginId = stateBus.getIntState(0x7f0d00b4);    // 当前活动插件 id
if (plugin.id == curPluginId) {
    x = stateBus.getIntState(0x7f0d00bb);         // 该插件下的当前子项
} else {
    x = 0xff;                                      // ★ 0xff = "非当前"哨兵
}
```

> **`0xff` 作为"非当前插件"哨兵**，与 `poweramp-list-options-implementation.md` 里
> `-1` 作哨兵是同类手法（同项目内多次出现）。

---

## 4. c1 管辖的偏好键（31 个，实测）

| 类别 | 键 |
| --- | --- |
| 采样率/格式 | `sample_rate`、`sample_rate_static`、`sample_fmt`、`sample_bits_static`、`float` |
| 缓冲 | `buffer_size`、`vis_latency_ms` |
| DSP 抑制 | `no_dvc`、`no_headroom`、`no_equ`、`no_duck`、`no_af` |
| Chromecast | `cc_force_aa`、`cc_show_meta`、`cc_button`、`configure_cc_button` |
| 设备 | `device_`、`output_`、`output_switch`、`pa_output_` |
| OEM | `oem_variant` |
| 其它 | `open_path`、`hash`、`restore_defaults`、`audio_outputs`、`ui_player` |

> **与 `o81`（idea 39 的 11558 行 helper）职责重叠**——两者都管设备级音频参数。
> 区别：`o81` 是 1035 的设备优先新页，`c1` 是 1025 的旧设备选项页。

---

## 5. 静态方法 `u(String,String,String)CharSequence`（`:36-99`）

签名表明是**三参数文本构造**（推测：路径+文件名+扩展名或设备+插件+参数）。
未展开实现，但它是 `c1` 里唯一的纯函数，用于生成显示文本。

---

## 6. 完整调用链（三条篇的闭环）

```
第三篇：k0.J()  —— 插件列表页
   ↓ 为每个插件生成 Preference 行
   ↓ setFragment(f0) + extras{target, uniqName, device}
第四篇：f0.onCreate —— 分发中枢
   ↓ target="audio_output_device_opts" → xmlId 0x7f160008
   ↓ 命中分支 → helper = c1
第七篇：c1.z() —— 设备选项页
   ↓ 读 extras{device, uniqName}
   ↓ c1.v() 解析（含 __avail_hires 展开）
   ↓ 渲染 31 个偏好键
```

> **三条线索在此闭合**。插件系统的"列表 → 详情"链路已完全解出。

---

## 7. 可借鉴 / 不建议照抄

### 7.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **参数不全即返回** | 三个前置校验，避免半渲染 |
| A2 | **能力别名 `__avail_hires`** | 设备可声明"要最好的"，而非绑定具体实现 |
| A3 | **逐级回退**（athd → oslhd） | 能力不可用时降级而非失败 |
| A4 | **`0xff` 明确哨兵** | 与真实 0..N 值域分离 |

### 7.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | `__avail_hires` 是**字符串魔法值** | 无类型检查，拼错即静默失败 |
| N2 | 别名只在 `c1.v()` 里识别 | 别处传同一个值会得到 null |
| N3 | `c1` 与 `o81` 职责重叠 | 两套设备参数渲染逻辑并存 |
| N4 | `u()` 三参 String 签名无类型信息 | 调用处易传错顺序 |

---

## 8. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`c1.z()` 主体~~ | ✅ **已划分**（十九）：32 键 → 九阶段，各有行区间 |
| ~~Q2~~ | ~~`0x7f0d00bb` 语义~~ | ✅ **已闭合**（二十二）：`state_player_output_device` |
| ~~Q3~~ | ~~其它伪值~~ | ✅ **已闭合**（三十七）：73 个 `__` 常量中**仅此一个**属插件伪值 |

---

## 9. 证据索引

| 主题 | 位置 |
| --- | --- |
| helper 定义 | `preference/c1.smali`（2786 行） |
| 主渲染入口 | `c1.smali:497`（`z()`） |
| extras 读取 | `c1.smali:508-512`（`device`）、`:536-540`（`uniqName`） |
| 参数校验 | `c1.smali:548-566` |
| ★ 伪插件展开 | `c1.smali:100-181`（`v()`），`:114`（`__avail_hires`） |
| 回退链 | `c1.smali:127`（`output.athd`）→ `:146`（`output.oslhd`） |
| uniqName 查表 | `plugin/NativePluginManager.smali:1334-1361`（`х(String)`） |
| 当前插件高亮 | `c1.smali:568-591`（`0x7f0d00b4` / `0xff`） |
| 偏好键全集 | `c1.smali`（31 个，见 §4） |

> 口径：**build-1025**。
