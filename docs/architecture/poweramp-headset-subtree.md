---
doc_id: poweramp-headset-subtree
title: Poweramp「耳机/蓝牙」子树完整实现（含 commands_history / audio_focus / long_volume_controls）
doc_type: architecture
status: draft
owner_agent: lead
version_scope: build-1035-bundle-play (versionCode 1035009)
created: 2026-11-07
updated: 2026-11-07
source_documents:
  - .rea-analysis/v1035/decoded/res/xml/headset.xml
  - .rea-analysis/v1035/decoded/res/xml/commands_history.xml
  - .rea-analysis/v1035/decoded/res/xml/audio_focus.xml
  - .rea-analysis/v1035/decoded/res/xml/misc.xml
  - .rea-analysis/v1035/decoded/res/values/strings.xml
  - .rea-analysis/v1035/decoded/res/values/public.xml
  - .rea-analysis/v1035/decoded/smali/ׅ/u91.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/o91.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/jo0.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/z61.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/tc.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/x11.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/sa1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/vr.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/u61.smali
  - docs/architecture/poweramp-headset-full-implementation.md
  - docs/architecture/poweramp-audio-settings-structure.md
  - docs/architecture/poweramp-misc-settings.md
---

# Poweramp「耳机/蓝牙」子树完整实现

> **证据分级**：【实证·原文】= XML/资源原文；【实证·产物】= 反编译 smali；【推断】= 无直接代码佐证。
>
> 全部基于 **build-1035-bundle-play**（`versionCode 1035009`）。
>
> **与 `poweramp-headset-full-implementation.md` 的分工**：那份聚焦**根页 + 按键运行时**（`rk0`/`w8`/`s91` 状态机）；本文覆盖**子树全貌**（1 个真子页 + 2 个跨分支跳转），并补齐根页的资源级细节。两文互补。

---

## 0. 一句话结论

耳机/蓝牙 **不是一棵"7 页子树"**——它只有 **1 个真正的子页面**（`commands_history`），另 2 个是**跨分支跳转**（`audio_focus` 属音频分支、`misc#long_volume_controls` 属 misc 分支）。

**最重要的发现**：`commands_history` 是**空 XML + 全代码生成**的页面，数据来自 `jo0` 的 **64 条环形缓冲区**，并以 **32ms / 250ms 双周期**自动刷新。而 `long_volume_controls` 是需要 **Shizuku 授权**的实验特性。

---

## 1. 子树全景

### 1.1 三个下钻目标的性质

| 目标 | 资源 id | 性质 | helper | 规模 |
| --- | --- | --- | --- | ---: |
| `commands_history` | **`0x7f160011`** | ✅ **真子页**（同属 headset 分支）| **`o91`** | 21142 B / 1069 行 |
| `audio_focus` | **`0x7f160007`** | ❌ 跨分支（属**音频**）| **`z61` idx 2** | 仅 ~103 行分支 |
| `misc#long_volume_controls` | `0x7f16001e` | ❌ 跨分支（属**misc**）| `sa1` | 见 §4 |

### 1.2 为什么 `commands_history` 的 XML 是空的

【实证·原文】`commands_history.xml` **全文仅 247 字节**：

```xml
<?xml version="1.0" encoding="utf-8"?>
<PreferenceScreen android:title="@string/pref_last_processed_commands" w:skipSearch="true"
  xmlns:android="http://schemas.android.com/apk/res/android" xmlns:w="http://schemas.android.com/apk/res-auto" />
```

**没有任何子元素**。所有条目由 `o91.J()` 在运行时动态创建。

> **`w:skipSearch="true"`** 让它不进入设置搜索索引——因为它是一条不断变化的日志，索引没有意义。

### 1.3 完整的页面 id 表（59 个）

【实证·产物】`public.xml` 的 `type="xml"` 条目：

| id | 页面 | id | 页面 |
| --- | --- | --- | --- |
| `0x7f160000` | `aa` | `0x7f160011` | **`commands_history`** |
| `0x7f160001` | `aa_bg` | `0x7f160014` | `general` |
| `0x7f160003` | `audio` | `0x7f160015` | **`headset`** |
| `0x7f160007` | **`audio_focus`** | `0x7f160016` | `library` |
| `0x7f160008` | `audio_output_device_opts` | `0x7f16001e` | `misc` |
| `0x7f160009` | `audio_outputs2` | `0x7f160026` | `singlepane` |

> **注意 id 不连续**：`0x7f160010`、`0x7f160012/13` 等被其他文档占用或留空，所以**不能用 id 相邻推断页面关系**。

---

## 2. `commands_history` —— 64 条环形缓冲区的可视化（`o91`）

### 2.1 页面身份

| | |
| --- | --- |
| XML | `res/xml/commands_history.xml`（247 B，**空页面**）|
| 资源 id | **`0x7f160011`** |
| helper | **`ׅ/o91.smali`**（21142 B / 1069 行，`extends n91`）|
| 页面标题 | `@string/pref_last_processed_commands` |
| `w:skipSearch` | **true** |

### 2.2 `o91` 的 9 个方法

| 方法 | 行 | 规模 | 职责 |
| --- | --- | ---: | --- |
| `<init>` | 17–49 | 32 | 构造（含 `r0` Runnable 字段）|
| **`I()`** | 51–232 | **181** | **把缓冲区转成文本**（供分享用）|
| `C(MenuItem)` | 236–461 | 225 | 菜单项点击（清空/复制）|
| **`J()`** | 463–778 | **315** | **重建整个页面**（核心）|
| `o()` | 780–803 | 23 | 销毁：移除回调 |
| **`v()`** | 805–810 | **5** | **完全空实现**（无静态条目可绑）|
| `С()` | 812–835 | 23 | 暂停：移除回调 |
| `о(Menu)` | 837–1029 | 192 | 构建 3 个菜单项 |
| `с()` | 1031–1068 | 37 | 恢复：渲染 + 250ms 轮询 |

> **`v()` 只有 5 行且是纯 `return-void`** —— 这是全设置树**最极端的"零静态绑定"页面**。对比：`library_shuffle` 34 行（6 key），`headset` 298 行（18 key），此页 **0 个静态 key / 5 行**。

### 2.3 数据源：`jo0` 的环形缓冲区

`jo0.smali`（7094 B / 415 行）是**进程级日志收集器**，只有 3 个方法：

| 方法 | 行 | 职责 |
| --- | ---: | --- |
| `<clinit>` | 17–59 | 初始化环形缓冲 |
| **`B(I,String,String,String)`** | 61–257 | **写入一条记录** |
| **`В()[hf1[]`** | 261–414 | **读出全部记录**（按时间顺序重组） |

#### 2.3.1 缓冲区规格

【实证·产物】`jo0.smali:34-54`：

```java
new zm(/* circular */ true, /* capacity */ 0x40 /* 64 */, hf1.class)
```

| 属性 | 值 | 说明 |
| --- | --- | --- |
| 容量 | **`0x40` = 64 条** | 超出后覆盖最旧的 |
| 类型 | **环形**（`zm` 第 1 参 = true）| FIFO 覆盖 |
| 元素 | `hf1`（含 `int` + 3 个 `String`）| |

#### 2.3.2 写入路径

`B(type, a, b, c)` 做三件事：

1. **打 Android 日志**（tag `PlayerCommandsHistory`）—— `jo0:78-132`
   ```java
   Log.w("PlayerCommandsHistory", a + " " + a + b + " " + a + c);
   ```
   > 注意 `a` 被重复拼接了 3 次（`a + " " + a + b + " " + a + c`），疑为混淆后的冗余。

2. **加锁写入环形缓冲** —— `jo0:137-241`
   ```java
   synchronized (buffer) {
       if (buffer.size == 64) {
           // 满了：用取模覆盖最旧位置
           WRITE_IDX = (WRITE_IDX + 1) % 64;
           int slot = (WRITE_IDX + 0x3f) % 64;
           buffer.X[slot] = record;
       } else {
           buffer.B(record);   // 未满：追加
       }
       WRITE_IDX++;
   }
   ```

3. **`В()` 读出**：未满时直接拷贝；满了则**分两段拷贝**（从 `WRITE_IDX` 到末尾 + 从 0 到 `WRITE_IDX`），重组为时间正序 —— `jo0:288-321`

> **设计要点**：用 `WRITE_IDX` 同时表达"写指针"与"记录总数"，避免额外计数器。`ArraysKt.х(from,to,src,dst)` 做两段拼接。

### 2.4 页面渲染：`J()` 的完整逻辑

【实证·产物】`o91.smali:463-778`：

```java
void J() {
    PreferenceScreen root = this.K;
    root.removeAll();                          // ← 先清空（o91:475）

    hf1[] records = jo0.В();                   // 取全部记录（o91:484）

    StringBuilder sb = new StringBuilder();
    SimpleDateFormat fmt = new SimpleDateFormat("HH:mm:ss.SSS", Locale.US);
    Date d = new Date();
    LargeRawTextPreference last = null;

    for (hf1 r : records) {                    // 每条记录 → 一个 Preference
        sb.setLength(0);
        d.setTime(r.timestamp);
        sb.append(fmt.format(d))
          .append(' ')
          .append(r.fieldA)
          .append(' ')
          .append(r.fieldB);
        LargeRawTextPreference p = new LargeRawTextPreference(ctx, null);
        p.setSummary(sb.toString());
        root.addPreference(p);
        last = p;
    }

    if (records.length > 0) {
        // 有数据 → 32ms 后检查是否要刷新（o91:686-707）
        handler.postDelayed(new b6(this, 0x1c, last), 0x20 /* 32ms */);
    } else {
        // 无数据 → 显示 "empty"（o91:716-739）
        LargeRawTextPreference p = new LargeRawTextPreference(ctx, null);
        p.setSummary(0x7f080005 /* @string/_empty = "empty" */);
        root.addPreference(p);
    }

    // 记录当前写指针，供下次对比（o91:746-763）
    synchronized (jo0.B) { this.j = jo0.A; }
}
```

### 2.5 双周期刷新机制（本页最精妙处）

| 周期 | 触发 | 位置 | 用途 |
| ---: | --- | --- | --- |
| **250ms** | `с()` 里 `postDelayed(r0, 0xfa)` | `o91:1053-1057` | **页面可见时**轮询 |
| **32ms** | `J()` 里 `postDelayed(b6(0x1c), 0x20)` | `o91:703-707` | **渲染刚结束时**快速检查 |

**状态字段 `j`** 是关键：每次 `J()` 结束都记录 `jo0.A`（写指针），下次对比可判断是否有新记录。

> **为什么需要 32ms 的短周期**：用户打开页面时若恰好在按键，新记录可能在 0-32ms 内到达。用短延迟做一次"补查"，避免等到下一个 250ms 周期才发现。
>
> **250ms 的取舍**：既能让用户看到滚动更新，又不会因过于频繁的重建 `Preference` 造成卡顿。**这是"日志查看器"类界面的合理刷新率**。

### 2.6 生命周期：三个方法都在"移除回调"

| 方法 | 动作 | 位置 |
| --- | --- | --- |
| `o()`（销毁）| `handler.removeCallbacks(r0)` + `super` | `o91:780-803` |
| `С()`（暂停）| 同上 | `o91:812-835` |
| `с()`（恢复）| `J()` 渲染 + `removeCallbacks` + `postDelayed(0xfa)` | `o91:1031-1068` |

> **`removeCallbacks` 先于 `super` 调用**，确保页面切换时不残留定时器。这是防止 `Handler` 泄漏的标准写法。

### 2.7 三个菜单项

【实证·产物】`o91.о(Menu)`（837–1029 行）+ `C(MenuItem)`（236–461 行）：

| # | 菜单 | 图标/文案 | 动作 |
| ---: | --- | --- | --- |
| 1 | **清空** | `Menu.add(..., 0x7f080... )` | 清空 `jo0` 缓冲 + 刷新 |
| 2 | **复制** | 同上 | 把 `I()` 生成的全文写入剪贴板 |
| 3 | **分享** | `ShareActionProvider` + `ACTION_SEND` / `text/plain` | 分享 `I()` 的结果（`o91:921-981`）|

**`I()` 的输出格式**（181 行，`o91:51-232`）：

```
HH:mm:ss.SSS <字段A> <字段B>
==================
HH:mm:ss.SSS <字段A> <字段B>
==================
...
```

> 每条记录前有时间戳，之后是 `==================` 分隔线（`o91:137` 字面量）。这是给人肉眼扫读的设计。

---

## 3. `audio_focus` —— 跨分支子页（`z61` idx 2）

### 3.1 性质

| | |
| --- | --- |
| XML | `res/xml/audio_focus.xml`（3574 B，**有 11 个元素**）|
| 资源 id | **`0x7f160007`** |
| 归属 | **音频分支**（`w:searchBreadcrumb1="@string/pref_audio_engine"`）|
| helper | **`z61` 索引 2** → `pswitch_11`（`z61.smali:4597-4698`，**仅 103 行**）|
| 入口 | headset 根页第 9 行（无 key 的 RedirectPreference）|

### 3.2 11 个元素逐条

【实证·原文】`audio_focus.xml`：

| # | key | 控件 | 标题 | 默认 | 依赖 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `resume_after_call` | Switch | **Resume After Call** | **true** | — |
| 2 | `resume_on_start` | Switch | **Resume On Start** | **false** | — |
| 3 | `resume_on_resume` | Switch | **Resume On Reopen** | true | `resume_on_start` |
| 4 | `resume_on_mount` | Switch | **Wait For Storage** | false | `resume_on_start` |
| 5 | `cc_af_warning` | Redirect | （无标题） | — | → `audio_output_device_opts?...chromecast#no_af` |
| 6 | *（无 key）* | Redirect | （无标题） | — | → `ui_notify#keep_notification_always` |
| 7 | `af_short` | Switch | **Short Audio Focus Change / Calls** | **true** | — |
| 8 | `pause_in_call` | Switch | **Pause In Call** | true | — |
| 9 | `resume_on_focus` | Switch | **Resume On Focus Gain** | true | `af_short` |
| 10 | `af_short_duck` | Switch | **Duck Volume** | true | `af_short` |
| 11 | `af_permanent` | Switch | **Permanent Audio Focus Change** | true | — |
| — | `restore_defaults` | Preference | Restore Defaults | — | — |

> **`audio_focus_cat`** 是分类的 key（`PreferenceCategory`），不计入 11 项。

### 3.3 9 个偏好字段映射

【实证·产物】`vr.smali`：

| key | `vr` 字段 | 定义行 |
| --- | --- | ---: |
| `resume_after_call` | `vr->w0` | 1676 |
| `resume_on_start` | `vr->s0` | 1612 |
| `resume_on_resume` | `vr->t0` | 1628 |
| `resume_on_mount` | `vr->u0` | 1644 |
| `af_short` | `vr->h0` | 1417 |
| `pause_in_call` | `vr->x0` | 1692 |
| `resume_on_focus` | `vr->w2` | 3503 |
| `af_short_duck` | `vr->i0` | 1433 |
| `af_permanent` | `vr->g0` | 1401 |

### 3.4 `pswitch_11` 的 103 行做了什么

【实证·产物】`z61.smali:4597-4698`，**只有 3 件事**：

```java
// ① af_short 绑定监听器 tc(3)
af_short.setOnPreferenceChangeListener(new tc(3 /* idx */, this));

// ② 若 af_short 已开启 → 强制 pause_in_call 勾选并禁用
if (vr.h0 /* af_short */) {
    TwoStatePreference pic = findPreference("pause_in_call");
    pic.setChecked(true);      // ← v4 = 1
    pic.setEnabled(false);     // ← v15 = 0
}

// ③ restore_defaults 绑定 x11(4)
findPreference("restore_defaults")
    .setOnPreferenceClickListener(new x11(4, this));
```

### 3.5 `af_short` ⇄ `pause_in_call` 的互斥联动（本页唯一逻辑）

**初始态**（`z61:4628-4673`）：`af_short == true` → `pause_in_call` 被 `setChecked(true)` + `setEnabled(false)`

**动态态**（`tc` 索引 3，`tc.smali:598-667`）：

```java
boolean onPreferenceChange(Preference p, Object newValue) {
    Preference pic = findPreference("pause_in_call");
    if (pic != null) {
        if ((Boolean) newValue) {              // af_short 变为 true
            ((TwoStatePreference) pic).setChecked(true);   // 强制勾选
            pic.setEnabled(false);             // 禁用
        } else {                               // af_short 变为 false
            pic.setEnabled(true);              // 恢复可编辑
        }
    }
    return true;
}
```

**语义解释**：

| `af_short` 状态 | `pause_in_call` 状态 | 为什么 |
| --- | --- | --- |
| **开启** | 强制 true + 禁用 | "短焦点变化暂停"已覆盖来电场景，无需单独配置 |
| **关闭** | 用户可编辑 | 需要单独控制是否因来电暂停 |

> **这是"父开关覆盖子选项"的典型设计**：不是简单置灰，而是**强制勾选 + 置灰**，明确表达"此选项已由上级接管"。
>
> **对比 headset 页的 `headset_beep` ⇄ `beep_more`**：那对只是 `android:dependency` 置灰（不清值），而这里**会改写值**。两种策略的差异值得注意。

### 3.6 为什么这个页面被 headset 引用

headset 根页第 9 行是**无 key 的 RedirectPreference**：

```xml
<RedirectPreference android:title="@string/pref_audio_focus"
    android:summary="@string/pref_summary_audio_focus_from_headset"
    w:target="audio_focus" w:skipSearch="true" />
```

摘要文案是 **"Few other play/resume options are available in Audio Focus settings"** —— 它是"引导用户去别处配置"的跳转条目，因为耳机相关的声音恢复行为与音频焦点高度重叠。

---

## 4. `misc#long_volume_controls` —— Shizuku 授权的实验特性

### 4.1 XML 定义

【实证·原文】`misc.xml:35`：

```xml
<MultilineSwitchPreference
    android:title="@string/pref_long_volume_controls"
    android:key="long_volume_controls"
    android:defaultValue="false"
    w:sup="@string/pref_experiment"
    w:supLink="alert?text=@string/pref_experimental_msg" />
```

| 属性 | 含义 |
| --- | --- |
| `w:sup="@string/pref_experiment"` | **"实验性"徽标**（显示在标题上方）|
| `w:supLink="alert?text=..."` | 点击徽标弹出实验性说明 |
| `defaultValue="false"` | 默认关闭 |

### 4.2 三个相关类

【实证·产物】：

| 类 | 位置 | 内容 |
| --- | --- | --- |
| `vr` | `vr.smali:1804-1816` | 注册偏好字段 **`vr->E0`** |
| `sa1` | `sa1.smali:274-405` | **misc helper 的运行时判定**（核心）|
| `ad` | `ad.smali:204-224` | 开关点击后的状态同步 |

### 4.3 `sa1` 的权限判定链（核心）

【实证·产物】`sa1.smali:262-405`：

```java
// ① 找两个 Preference
Preference lvc  = findPreference("long_volume_controls");
Preference grant = findPreference("_long_volume_shizuku_grant");   // ← 动态行！

// ② 检查权限
if (checkSelfPermission(
        "android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER") != 0) {

    // 未授权分支
    lvc.setSummary(<需要授权的说明>);
    lvc.setEnabled(false);                    // ← 开关禁用
    grant.setSummary(<Shizuku 授权引导>);
    grant.setIcon(<感叹号图标>);              // ← RawTextPreference 设置图标
} else {
    // 已授权分支
    lvc.setSummary(<默认摘要>);
    lvc.setEnabled(true);
    ((TwoStatePreference) lvc).setChecked(vr.E0);   // ← 同步实际值
}
```

### 4.4 两个关键点

**① `_long_volume_shizuku_grant` 是动态行**

这个 key **不在 `misc.xml` 中**——它由 `sa1` 在运行时通过 `findPreference` 查找，说明它由代码动态创建（或来自其他 XML 片段）。

> **这与 media library 的 `_legacy_access_warning` 是同一模式**：`_` 前缀 = 运行时创建的辅助行。

**② 用的是 Android 13+ 的系统权限**

`SET_VOLUME_KEY_LONG_PRESS_LISTENER` 是 **Android 13（API 33）** 引入的签名级权限——只有系统应用或通过 **Shizuku** 等提权工具才能获得。

这解释了：

| 现象 | 原因 |
| --- | --- |
| 标注"实验性" | 依赖非官方提权渠道 |
| headset 页的 `long_volume_press` 在 **SDK < 26** 时被移除 | 该 API 从 8.0 才存在 |
| headset 页的 `no_android_long_press` 在 **SDK > 33** 时被移除 | Android 14 起行为变化，不再需要 |

### 4.5 从 headset 到这里的跳转体验

```
headset 根页
  └─ long_volume_press（无标题，摘要 "Press here for Volume keys long press option"）
     └─ 跳转到 misc#long_volume_controls
        └─ 用户看到：实验性徽标 + 默认关闭 + 需要 Shizuku 授权
```

> **体验落差**：从耳机页点进来，期待的是"配置长按音量键"，实际面对的是一个**需要额外安装 Shizuku 并授权**的实验特性。这是个明显的期望管理问题。
>
> 而且这条跳转**本身还有 SDK 门控**：SDK < 26 时 `long_volume_press` 整行被 `u91` 移除，用户根本看不到入口。

---

## 5. 跨页机制对比

### 5.1 三种下钻类型的实现差异

| 类型 | 例子 | 实现 | 子页 helper |
| --- | --- | --- | --- |
| **同分支真子页** | `commands_history` | `u61` 分发表 → `0x7f160011` → `o91` | 专用类 |
| **跨分支页** | `audio_focus` | `w:target` → `0x7f160007` → `z61` idx 2 | 共享分支 |
| **跨页锚点** | `misc#long_volume_controls` | `w:target="misc#key"` | misc 的 `sa1` |

### 5.2 `w:target` 的三种语法

| 语法 | 例子 | 含义 |
| --- | --- | --- |
| `target="页名"` | `audio_focus`、`commands_history` | 跳到该页顶部 |
| `target="页名#锚点"` | `misc#long_volume_controls` | 跳到该页并定位到指定 key |
| `target="页名?params#锚点"` | `audio_output_device_opts?uniqName=...&device=chromecast#no_af` | 带参数跳转 |

### 5.3 动态行（`_` 前缀）的两次出现

| key | 页面 | 创建者 | 用途 |
| --- | --- | --- | --- |
| `_legacy_access_warning` | `library` | `ba1` | SAF/legacy 模式警告 |
| `_long_volume_shizuku_grant` | `misc` | `sa1` | Shizuku 授权引导 |

> **约定**：`_` 前缀 = 运行时创建、不持久化、不参与搜索索引的辅助行。

---

## 6. 根页补充：资源级细节

### 6.1 headset 页的 3 个图标资源

| 资源 | 用在 | 说明 |
| --- | --- | --- |
| `@drawable/pref_seekbar_tickmark` | `ignore_bt_sec` | 滑杆刻度 |
| （无图标）| 大部分条目 | 用默认样式 |
| `exclamation_circle_warn_48dp` | `_legacy_access_warning`（library 页）| **非本页** |

> **headset 页没有任何自定义图标**——除 `seekbar` 刻度外全部走默认样式。

### 6.2 `long_volume_press` 的无标题设计

【实证·原文】`headset.xml:15`：

```xml
<RedirectPreference android:key="long_volume_press"
    android:summary="@string/pref_headset_long_volume_press_hint"
    w:target="misc#long_volume_controls" w:skipSearch="true" />
```

**没有 `android:title`**，只有 `summary`。所以界面显示的是一个**空标题 + 说明文字**的条目。

> 对比同页的 `audio_focus` 跳转（有标题 "Audio Focus"）。**同为跳转，一个有标题一个没有**，这是不一致的设计。

---

## 7. 未解问题

1. **`commands_history` 清空菜单的确切实现**：`C(MenuItem)` 有 225 行，只确认了"清空缓冲 + 刷新"，但清空时是否重置 `WRITE_IDX` 未逐行验证。（P2）

2. **`hf1` 的三个字段语义**：`B(int, String, String, String)` 的四个参数分别是什么（命令类型？来源？结果？）未解。（P2）

3. **`_long_volume_shizuku_grant` 的创建位置**：`sa1` 只 `findPreference`，创建点未定位（可能在另一个 helper 或动态 addPreference）。（P2）

4. **`audio_focus` 的 `cc_af_warning` 带参数跳转**：`?uniqName=com.maxmpz.audioplayer/output.cc&device=chromecast#no_af` 的解析与消费未追。（P3）

5. **`jo0` 缓冲区的写入者全集**：已知 `rk0` 会写入按键日志，但其他写入点未枚举。（P3）

---

## 8. 证据索引

### 8.1 XML / 资源

| 位置 | 内容 |
| --- | --- |
| `headset.xml:2` | 根节点 `pref_headset_bt` |
| `headset.xml:9` | `audio_focus` 跳转（无 key）|
| `headset.xml:15` | `long_volume_press` 跳转（**无标题**）|
| `headset.xml:24` | `commands_history` 跳转 |
| `commands_history.xml:2` | **空 PreferenceScreen**（247 B）|
| `audio_focus.xml:2` | 根节点 + `searchBreadcrumb1` |
| `audio_focus.xml:4-21` | 11 个元素 |
| `misc.xml:35` | `long_volume_controls` + `w:sup` 实验徽标 |
| `public.xml` | 59 个 `type="xml"` 页面 id |

### 8.2 smali

| 位置 | 内容 |
| --- | --- |
| `u61.smali:983-999` | `audio_focus` → `z61` idx **2** |
| `u61.smali:1362-1375` | `headset` → `u91` |
| `u61.smali:1576-1585` | `misc` → `sa1` |
| `u61.smali:1634-1643` | `commands_history` → `o91` |
| **`o91.smali:805-810`** | **`v()` 空实现（5 行）** |
| `o91.smali:463-778` | `J()` 页面重建（315 行）|
| `o91.smali:475` | `removeAll()` |
| `o91.smali:484` | `jo0.В()` 取记录 |
| `o91.smali:686-707` | **32ms 补查** |
| `o91.smali:716-739` | 空态 "empty" |
| `o91.smali:746-763` | 记录 `j = jo0.A` |
| `o91.smali:1031-1068` | `с()`：渲染 + **250ms 轮询** |
| `o91.smali:51-232` | `I()` 文本生成（181 行）|
| `o91.smali:921-981` | `ShareActionProvider` + `ACTION_SEND` |
| **`jo0.smali:34-54`** | **环形缓冲 64 条** |
| `jo0.smali:61-257` | `B()` 写入 + 加锁覆盖 |
| `jo0.smali:78-132` | `Log.w("PlayerCommandsHistory", ...)` |
| `jo0.smali:261-414` | `В()` 两段拷贝重组 |
| `z61.smali:4597-4698` | `pswitch_11` = `audio_focus`（103 行）|
| `z61.smali:4628-4673` | `af_short` 开启 → 强制 `pause_in_call` |
| `z61.smali:4752-4774` | 20 项 switch 表 |
| **`tc.smali:598-667`** | **`af_short` 监听器（索引 3）** |
| `tc.smali:899-910` | 10 项 switch 表 |
| `x11.smali:849-875` | 25 项 switch 表 |
| `sa1.smali:262-405` | `long_volume_controls` 权限判定 |
| `sa1.smali:314-318` | `SET_VOLUME_KEY_LONG_PRESS_LISTENER` 检查 |
| `sa1.smali:286` | `_long_volume_shizuku_grant` |
| `vr.smali:1804-1816` | `long_volume_controls` → `vr->E0` |
| `vr.smali:1417-3503` | `audio_focus` 9 个字段 |

### 8.3 交叉引用

| 文档 | 关系 |
| --- | --- |
| `poweramp-headset-full-implementation.md` | **姊妹篇**：根页 + 按键运行时（`rk0`/`w8`/`s91`）|
| `poweramp-headset-settings.md` | 偏好结构视角 |
| `poweramp-audio-settings-structure.md` | `audio_focus` 所属分支的完整分析 |
| `poweramp-misc-settings.md` | `long_volume_controls` 所属分支 |
| `poweramp-settings-page-runtime.md` | `u61` 分发表机制、`C`=父页 id |
