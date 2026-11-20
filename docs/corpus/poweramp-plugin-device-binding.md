---
doc_id: "ARCH-POWERAMP-PLUGIN-DEVICE-BINDING"
title: "插件系统（三）：插件列表页、设备绑定与跳转关联"
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
  - "docs/corpus/poweramp-plugin-system.md（一）"
  - "docs/corpus/poweramp-plugin-instances.md（二）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/preference/k0.smali"
---

# 插件系统（三）：插件列表页、设备绑定与跳转关联

## 0. 一句话结论

**插件列表页不是"列插件"，而是"按设备反查插件"**：

用户的 `output_<device>` 偏好（每个设备选了哪个插件）→ 反建成 `插件 → 该插件的设备列表`，
再以此为分组渲染。**这不是一个扁平的插件清单，而是一张设备-插件双向表**。

---

## 1. 入口：`k0.J()`（`preference/k0.smali:821-...`）

### 1.1 第一步：取插件（两个 type 一起过滤）

```smali
// :826-832
types = { -0x7ffffffd, 0x3 };        // INTERNAL_OUTPUT + 外部 OUTPUT
list  = new ArrayList(0xa);          // 容量 10
npm   = getSystemService("__NativePluginManager");
npm.А(list, types);                  // ★ 按类型过滤填充
// :856-882
for (p : list) if (p.p /* hidden */) list.remove(p);   // ★ 剔除 hidden
```

> **`{-0x7ffffffd, 3}` 即 `{0x80000003, 0x00000003}`**——
> 同时要"内置输出"和"外部输出"，这正是第一篇位域设计带来的便利：
> **两个值并列即可跨内置/外部**。

### 1.2 第二步：建立"插件 → 设备列表"反查表（`:921-1014`）

```smali
map = new HashMap();                 // uniqName -> ArrayList<设备名>
for (i = 0; i < 6; i++) {            // 6 个设备
    dev = DeviceName.of(i);          // 复用 t21 的 headset/speaker/bt/usb/other/chromecast
    // 1) 读该设备的偏好
    plug = prefs.getString("output_" + dev, null);
    if (plug.isEmpty()) {
        plug = (i == 5) ? "com.maxmpz.audioplayer/output.cc"   // chromecast 默认
                        : "com.maxmpz.audioplayer/output.osl"; // 其余默认 OpenSL
    }
    // 2) 按插件分组，追加设备名
    if (!map.containsKey(plug)) map.put(plug, new ArrayList());
    // 3) 设备显示名从资源取 "device_" + dev
    resId = res.getIdentifier("device_" + dev, "string", pkg);
    map.get(plug).add(devResId != 0 ? ctx.getString(devResId) : dev);
}
```

| 偏好键 | 设备 | 默认插件（未设时） |
| --- | --- | --- |
| `output_headset` | headset | `output.osl` |
| `output_speaker` | speaker | `output.osl` |
| `output_bt` | bt | `output.osl` |
| `output_usb` | usb | `output.osl` |
| `output_other` | other | `output.osl` |
| `output_chromecast` | chromecast | **`output.cc`** |

> **默认值的设计**：只有 Chromecast 有专属默认后端（`output.cc`），其余全部落到 `output.osl`。
> 这与 `poweramp-impl-idea39-device-first-output.md` 的六设备枚举完全一致。

### 1.3 第三步：逐插件生成 Preference 行（`:1037-1200`）

```smali
group = findPreference("output_plugins_list");
for (p : list) {
    key = "pa_output_" + p.H;                      // H = uniqName
    if (findPreference(key) == null) {
        pref = new Preference(ctx);
        group.addPreference(pref);
        pref.setTitle(p.В(ctx));                   // 名称（资源或字面量）
        pref.setPersistent(false);
        pref.setKey(key);
        // ---- 三种跳转分支 ----
        if (map.get(p.H) 包含 "chromecast") {
            pref.setFragment(f0);
            extras.putString("target",   "audio_output_device_opts");
            extras.putString("uniqName", p.H);
            extras.putString("device",   "chromecast");
        } else if (p.K == -0x7ffffffd /* INTERNAL_OUTPUT */) {
            pref.setFragment(f0);
            extras.putString("target",   "audio_output");
            extras.putString("uniqName", p.H);
        }
        // ---- 当前插件打勾 ----
        if (curInfo != null && curInfo.uniq_name.equals(p.H))
            pref.setWidgetLayoutResource(0x7f04011a);  // 勾选图标
    }
}
```

---

## 2. ★ 三种跳转分支（本条核心）

| 条件 | `target` | 额外参数 | 落到 |
| --- | --- | --- | --- |
| 该插件被 Chromecast 使用 | `audio_output_device_opts` | `uniqName` + `device=chromecast` | 设备选项页 |
| 内置输出插件（`K == 0x80000003`） | `audio_output` | `uniqName` | 输出页 |
| 其它（外部输出插件） | （不设 Fragment） | — | 仅展示 |

> **同一个列表里三种行行为不同**：Chromecast 特例 → 设备选项页；内置 → 输出页；
> 外部插件 → 不可点（因为外部插件的设置界面在它自己的包里）。

### 2.1 目标 Fragment

`f0 = preference/f0`（`const-class v5, Lcom/maxmpz/audioplayer/preference/f0;` 的 canonicalName 经 `setFragment` 使用）。

### 2.2 当前插件的"打勾"

`StateBus.getIntState(0x7f0d00b4)` 拿到**当前活动插件 id**，`npm.A(id)` 取 `NativePluginInfo`，
与行插件的 `uniq_name` 比较，相同则 `setWidgetLayoutResource(0x7f04011a)` 显示勾选。

---

## 3. 与设备优先改版（idea 39）的接口

| 概念 | 位置 |
| --- | --- |
| 旧插件列表页 | `audio_outputs.xml`（1025）的 `output_plugins_list` |
| 新设备优先页 | `audio_outputs2.xml`（1035）的六个 `ButtonPref` |
| 共同的设备枚举 | `t21` 的 0..5 |
| 共同的偏好键 | `output_<device>` |

> **1025 的 `k0.J()` 正是 idea 39 要改的那一页的实现**——
> 它把 6 个设备折叠成"按插件分组"，用户看到的仍是插件名，
> 而设备关系只体现在分组里。这正是投票抱怨的"先选方法再选设备"。

---

## 4. SearchIndexer 的用法（旁证）

三个搜索索引器都用**单个类型**过滤：

| 类 | 类型数组 |
| --- | --- |
| `SettingsHelperAudioOutput$SearchIndexer` | `{-0x7ffffffd}` |
| `SettingsHelperAudioOutputDeviceOpts$SearchIndexer` | `{-0x7ffffffd}` |
| `SettingsHelperAudioOutputs$SearchIndexer` | `{-0x7ffffffd}` |

> 三个都只要**内置输出插件**（不含外部 `3`）。
> 说明搜索索引有意只覆盖内置，外部插件的设置项不进搜索。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **位域让"跨内置/外部"只需并列两个值** | `{-0x7ffffffd, 3}` 一行搞定 |
| A2 | **按偏好反建成双向表** | 一次遍历同时得到"插件→设备"与默认值 |
| A3 | **`output_<device>` 键名与枚举同名** | `t21` 的设备名直接拼键 |
| A4 | **`hidden` 标志统一剔除** | 内部插件不进列表 |
| A5 | **默认值按设备特化**（仅 chromecast 不同） | 简单且够用 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 默认插件 uniqName **硬编码**在 `k0` 里 | 换默认后端要改代码 |
| N2 | 三种跳转分支靠 `if/else` 硬判类型值 | 新增插件类型需同步改此处 |
| N3 | `pa_output_` + uniqName 拼 Preference key | 含 `/` 与 `.`，非标准 key 风格 |
| N4 | 外部插件行不可点但**仍显示** | 用户点击无反应，体验差 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`f0` 如何按 target 分派~~ | ✅ **已闭合**（四）：`getIdentifier` → 58 分支 → 17 helper |
| ~~Q2~~ | ~~`0x7f0d00b4` 写入者~~ | ✅ **已闭合**（十/二十二）：**计算属性**无写入点，源自 `processing/А.В.id` |
| Q3 | 外部插件的设置界面如何被 PA 唤起 | 分支里没设 Fragment，推测走插件自身 Activity |

---

> **续篇**：f0 内部如何按 target 分派 helper，见 poweramp-settings-fragment-dispatch.md。

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| 插件列表构建 | `preference/k0.smali:821-1200`（`J()`） |
| 类型过滤 | `k0.smali:826-832`（`{-0x7ffffffd, 3}`） |
| 反向填充 | `k0.smali:854`（`npm.А(list, types)`） |
| 剔除 hidden | `k0.smali:874-878`（`Iterator.remove` @`:878`） |
| 设备反查表 | `k0.smali:921-1014`（前缀 `:938`、资源类型 `:995`） |
| 默认插件 | `k0.smali:958-965`（`output.cc` / `output.osl`） |
| 三跳转分支 | `k0.smali:1116-1166` |
| 打勾 | `k0.smali:1178-1194`（`0x7f04011a`） |
| 类型过滤器本体 | `plugin/NativePluginManager.smali:850-905`（`А(ArrayList,[I)`） |
| SearchIndexer ×3 | `preference/SettingsHelperAudioOutput{,DeviceOpts,s}$SearchIndexer.smali` |

> 口径：**build-1025**。
