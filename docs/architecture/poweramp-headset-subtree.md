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

> **⚠️ 本文已被 `poweramp-headset-complete.md` 取代。**
>
> 该文合并了 `poweramp-headset-settings.md`、`poweramp-headset-full-implementation.md`、`poweramp-headset-subtree.md` 三份文档的全部内容（含 167 条 smali 定位），并做了去重与重组。
>
> **本文保留原样仅供对照**，请以 `poweramp-headset-complete.md` 为准。

> **证据分级**：【实证·原文】= XML/资源原文；【实证·产物】= 反编译 smali；【推断】= 无直接代码佐证。
>
> 全部基于 **build-1035-bundle-play**（`versionCode 1035009`）。
>
> **与 `poweramp-headset-full-implementation.md` 的分工**：那份聚焦**根页 + 按键运行时**（`rk0`/`w8`/`s91` 状态机）；本文覆盖**子树全貌**（1 个真子页 + 2 个跨分支跳转），并补齐根页的资源级细节。两文互补。

---

## 0. 一句话结论

耳机/蓝牙 **不是一棵"7 页子树"**——它只有 **1 个真正的子页面**（`commands_history`），另 2 个是**跨分支跳转**（`audio_focus` 属音频分支、`misc#long_volume_controls` 属 misc 分支）。

**最重要的发现**：`commands_history` 是**空 XML + 全代码生成**的页面，数据来自 `jo0` 的 **64 条环形缓冲区**，并以 **32ms / 250ms 双周期**自动刷新。而 `long_volume_controls` 是需要 **Shizuku 授权**的实验特性。

> **第 2 轮补充**：`commands_history` 的真实定位被低估了——它记录的是**音频焦点与播放决策的完整轨迹**（43 个写入点，13 个在 `rl0` 音频焦点状态机里），实际是**排查"为什么音乐突然暂停/不响应"的黑匣子**，而非单纯的按键历史。详见 §7。

> **第 3 轮**：`w:target` 的三种语法已全链路解出。解出 `?uniqName=&device=#no_af` 指向 Chromecast 设备的音频焦点关闭项，以及 `oo0` 的 30 秒挂载窗口。详见 §8。
>
> **第 4 轮（重要修正）**：**证伪了第 3 轮关于 `"#"→"/"` 转换层的推断**。真实情况是存在**两条独立机制**（`qd0.u` 拼 `"settings/"` 前缀 vs `n91.w` 读 Intent extra），而 XML 的 `#` 语法**不在这两条里**。已用排除法穷尽 6 处 `replace(CC)` 与 3 处 `0x23` 常量。这一项已如实降级为**已知边界**，需动态调试才能闭合。详见 §9。

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
Preference grant = findPreference("_long_volume_shizuku_grant");   // ← 见下方纠正

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

**① `_long_volume_shizuku_grant` 不是动态行（**纠正**：见 `poweramp-misc-complete.md` §9.2）**

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

---

## 7. 第 2 轮深挖：记录结构与数据来源

> 上一轮留了 5 个 P2/P3 问题。本轮**全部闭合**，并发现 `commands_history` 的真实内容比预想的更有价值。

### 7.1 `hf1` 的完整结构（四字段 + 时间戳）

`hf1.smali`（4019 B / 205 行）只有 1 个构造器和 1 个 `toString()`。**字段语义直接写在 `toString()` 的输出格式里**【实证·产物】`hf1.smali:61-204`：

| 字段 | 类型 | 在 `toString()` 中的名字 | 语义 |
| --- | --- | --- | --- |
| `В` | `int` | **`type`** | 记录类型（见 §9.2）|
| `B` | `String` | **`source`** | 来源组件（如 `PlayerServiceCore`）|
| `А` | `String` | **`command`** | 命令/事件名（如 `AUDIOFOCUS_LOSS`）|
| `A` | `String` | **`extraInfo`** | 附加信息（决策依据）|
| `х` | `long` | （未输出）| **构造时自动 `System.currentTimeMillis()`** |

构造器【实证·产物】`hf1.smali:19-57`：

```java
hf1(int type, String source, String command, String extraInfo) {
    this.В = type;
    this.B = source;
    this.А = command;
    this.A = extraInfo;
    this.х = System.currentTimeMillis();   // ← 时间戳自动打点
}
```

> **时间戳不在参数里**——调用方无需传时间，`hf1` 自己打点。这保证了时间戳的准确性（避免调用链延迟）。

**`toString()` 的实际输出格式**：

```
<Object.toString()> type=<类型> source=<来源> command=<命令> extraInfo=<附加信息>
```

### 7.2 `type` 的枚举（3 种）

`toString()` 里的映射逻辑【实证·产物】`hf1.smali:73-112`：

| 值 | 输出 | 含义 |
| ---: | --- | --- |
| **`0`** | `"command"` | **主动命令**（当前 App 内部发起）|
| **`1`** | `"external"` | **外部事件**（系统/硬件/其他 App）|
| 其他 | `String.valueOf(n)` | 预留的扩展值 |

**实测分布**（统计全部 43 个写入点）：

| `type` | 次数 | 典型调用者 |
| ---: | ---: | --- |
| `1`（external）| **27** | `rl0`（音频焦点）、`rk0`（按键）、`ud0`/`uk0`（MediaSession）|
| `0`（command）| **1** | **`zf`（PSSleepTimer）** |
| 动态值 | 15 | 各分支根据条件选择 |

> **`type=0` 全库只有 1 处**：`zf.smali:931` 的睡眠定时器 —— `B(0, "PSSleepTimer", "sleep timer", ...)`。这是"App 内部主动发起的动作"的唯一实例。

### 7.3 43 个写入点：`commands_history` 到底记录什么

**这是本轮最重要的发现**。`commands_history` 不是"按键历史"，而是**音频焦点与播放决策的完整轨迹**。

写入者分布【实证·产物】：

| 类 | 次数 | 职责 | 典型记录内容 |
| --- | ---: | --- | --- |
| **`rl0`** | **13** | **音频焦点处理** | `AUDIOFOCUS_LOSS` / `inPhone` / `pausePlaying af_permanent` / `IGNORE !inPhone && !af_permanent` / `duckPlaying` / `UNDUCK` / `wasPausedByFocusChange=` |
| `dk0` | 7 | 播放核心 | `SHUTDOWN` / `IGNORE exclusive usb output owns attached device` / `cmd_player_dont_resume_after_call` |
| `ik0` | 7 | 音频焦点辅助 | `pauseInCall` / `pauseInCall IGNORE as disabled` |
| `rk0` | 4 | **按键接收** | `KEYCODE_MEDIA_PLAY` / `IGNORED as isAvrcp && playing` |
| `cl0` | 1 | 管线重载 | `reloadPipeline` |
| `jl0` | 1 | — | — |
| `oo0` | 1 | 恢复逻辑 | `RESUME resume_on_mount` |
| `dy1` | 1 | 播放服务 | — |
| `t4` | 1 | 搜索播放 | `handleSearchAndPlay` |
| **`zf`** | **1** | **睡眠定时器** | `sleep timer`（唯一的 `type=0`）|
| `ud0`/`uk0`/`ac1` 等 | 6 | MediaSession | `MediaSessionWrapper` / `onFastForward` |

**`rl0` 的记录实例**（音频焦点状态机）【实证·产物】`rl0.smali:1253-1456`：

```java
// AUDIOFOCUS_LOSS 的三个分支
B(1, "PlayerServiceCore", "AUDIOFOCUS_LOSS", " inPhone");                      // :1273
B(1, "PlayerServiceCore", "AUDIOFOCUS_LOSS", "pausePlaying af_permanent");     // :1303
B(1, "PlayerServiceCore", "AUDIOFOCUS_LOSS", "IGNORE !inPhone && !af_permanent"); // :1350
B(1, "PlayerServiceCore", "AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK", "...");        // :1393
// 其他
B(1, "PlayerServiceCore", "UNDUCK", "afterFocus");                             // :303
B(1, "PlayerServiceCore", "RESUME", "after call or audio focus");              // :609
B(1, "...", "...", "wasPausedByFocusChange= ... AUDIOFOCUS_GAIN");             // :1078
```

> **所以 `commands_history` 页面的实际价值是**：**排查"为什么音乐突然暂停/恢复/不响应"**。
>
> 用户在 `audio_focus` 里配了一堆开关，出问题时打开这个页面，就能看到**系统的每一次焦点变化 + Poweramp 的每一次决策**。这是一个**非常成熟的诊断工具**，远超"按键记录"的定位。

### 7.4 清空菜单的实现（含一处精妙设计）

【实证·产物】`o91.smali:245-298`：

```java
if (itemId == 0x7f0d042b) {          // 清空
    synchronized (jo0.В) {
        jo0.B.clear();                // ① zm.clear()：所有槽位 = null，size = 0
        jo0.A = jo0.A + 1;            // ② 写指针 +1（不是重置为 0！）
    }
    this.J();                         // ③ 重绘
    return true;
}
```

**`zm.clear()` 的实际行为**【实证·产物】`zm.smali:373-416`：

```java
clear() {
    for (int i = 0; i < this.y /* size */; i++)
        this.X[i] = null;             // 清空所有槽位
    this.y = 0;                       // size 归零
}
```

> **为什么是 `A + 1` 而不是 `A = 0`**：
>
> `jo0.A` 同时充当"写指针"和"总记录数"。`o91.j` 字段保存上次渲染时的 `jo0.A` 快照，用于判断"是否有新记录"。
>
> 若清空时把 `A` 重置为 `0`，而 `o91.j` 此时是某个大值，则 `j > A` 会导致**刷新判定失效**（页面不再更新）。
>
> **保持单调递增**（`A++`）让 `o91.j < jo0.A` 恒成立，刷新逻辑不受清空影响。**这是个很容易写错的细节**。

### 7.5 `_long_volume_shizuku_grant` 的创建点（**已定位**）

上一轮说"只找到 `findPreference`，创建点未定位"。**实际它不是动态创建的，而是通过 `addPreference` 手动挂载**。

【实证·产物】`sa1.smali:908-998`：

```java
if (this.k == null) {                     // 懒加载（只建一次）
    // ① 拼接锚点路径
    String anchor = this.H() + "#_long_volume_shizuku_grant";
    //                  ↑ n91.H() = 当前页面路径（"misc"）

    // ② 创建 Shizuku 授权管理器
    this.k = new x80(
        settingsActivity,
        handler,
        anchor,                            // ← 授权完成后跳回的锚点
        new ra1(this),                     // ← 授权回调
        new u0(0xe /* 14 */, this)         // ← 进度更新回调
    );
}

// ③ 用它替换已存在的 Preference
Preference grant = findPreference("_long_volume_shizuku_grant");
// ...
```

**关键点**：

| 项 | 说明 |
| --- | --- |
| **`#` 前缀** | `open_path` 的锚点语法：`"misc#_long_volume_shizuku_grant"` |
| **懒加载** | `if (this.k == null)` —— 只创建一次，复用 |
| **`n91.H()`** | 返回当前页面路径，用于构造可回跳的锚点 |
| **`x80`** | **Shizuku 授权器**（32138 B / 1786 行）|

### 7.6 `x80`：Shizuku 授权器的工作方式

`x80.smali`（32138 B / 1786 行）的核心机制【实证·产物】：

| 步骤 | 实现 | 定位 |
| --- | --- | --- |
| ① 连接 Shizuku | `moe.shizuku.server.IShizukuService` binder | `x80:257` |
| ② 构造授权命令 | `/system/bin/cmd package grant --user <N> <pkg> <permission>` | `x80:138-167` |
| ③ 执行 | 通过 Shizuku 服务以 shell 身份运行 | `x80:190-197` |
| ④ 超时 | **10 秒**（`"timeout after 10 s"`）| `x80:178` |
| ⑤ 失败处理 | `"run FAIL cmd="` / `"run TIMEOUT cmd="` 日志 | `x80:170/182` |
| ⑥ 无 Shizuku | `"no Shizuku binder"` | `x80:243` |
| ⑦ 进程启动失败 | `"start failed: no process"` | `x80:321` |

**授权的目标权限**：`android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER`（`x80:130`）

> **这是标准的 Shizuku 授权模式**：通过 Shizuku 的 shell 权限执行 `pm grant`，把签名级权限授予自己。
>
> **注意用的是 `/system/bin/cmd package grant` 而非 `pm grant`** —— `cmd` 是更底层的入口，在某些 ROM 上更可靠。

### 7.7 上一轮未解项的最终状态

| 原问题 | 最终结论 |
| --- | --- |
| `commands_history` 清空实现 | ✅ **已解**（§9.4）：`zm.clear()` + `A++`（保持单调）|
| `hf1` 三字段语义 | ✅ **已解**（§9.1）：type / source / command / extraInfo + 自动时间戳 |
| `_long_volume_shizuku_grant` 创建点 | ✅ **已解**（§9.5）：`sa1:908-998` 懒加载 + `x80` |
| `jo0` 写入者全集 | ✅ **已解**（§9.3）：43 处，覆盖音频焦点全链路 |
| `cc_af_warning` 带参跳转 | ⚠️ 未追（与耳机主线关系弱，列为 P3）|

### 7.8 新增的观察：`commands_history` 的定位被低估了

综合本轮发现，这个页面的实际定位应该是：

> **不是"按键历史查看器"，而是"播放决策黑匣子"**。

| 用户困惑 | 在 `commands_history` 里能看到 |
| --- | --- |
| 为什么来电后没恢复播放？ | `RESUME RESUME after call or audio focus` 或 `IGNORE !inPhone && !af_permanent` |
| 为什么插了耳机没自动播？ | `RESUME resume_on_mount` 是否出现 |
| 为什么蓝牙按键没反应？ | `IGNORED as isAvrcp && playing` |
| 为什么声音突然变小？ | `duckPlaying` / `UNDUCK afterFocus` |
| 为什么暂停了不恢复？ | `wasPausedByFocusChange= ... AUDIOFOCUS_GAIN` |

> **配套的 `audio_focus` 页面**（§3）正好是这些行为的**配置入口**。两个页面构成"配置 → 验证"的闭环。
>
> 这也解释了为什么 `commands_history` 要从 `headset` 页跳转：**耳机/蓝牙场景是音频焦点问题最高发的地方**。

---

---

## 8. 第 3 轮深挖：跨页跳转的解析机制

> 本轮把 `w:target` 的三种语法（页名 / `页名#锚点` / `页名?参数#锚点`）**从构造到消费全链路解出**。
> **其中最反直觉的发现**：锚点解析用的分隔符是 **`"/"` 而非 `"#"`**。

### 8.1 跳转的完整链路

```
XML: w:target="misc#long_volume_controls"
  ↓ ① RedirectPreference 保存 target 字符串
  ↓ ② 点击时构造 Intent（带 open_path extra）
  ↓ ③ SettingsActivity.getExtraOpenPath() 读出
  ↓ ④ 新 helper 的 n91.w() 解析并定位
  ↓ ⑤ 350ms 后执行滚动/高亮
```

### 8.2 `RedirectPreference`：只存不解析

`RedirectPreference.smali` 全文仅 130 行，**没有任何解析逻辑**【实证·产物】：

| 成员 | 作用 |
| --- | --- |
| `h:Ljava/lang/String` | 保存 `target` 字符串（`setDependencyRaw` 写入）|
| `В()`（`onAttached`）| 若有 `h`，调 `setDependency(h)` |

> 它 `extends RawTextPreference`，本质上只是**带 dependency 能力的文本行**。真正的跳转由点击监听器处理。

### 8.3 `SettingsActivity.getExtraOpenPath()`：两条读取路径

【实证·产物】`SettingsActivity.smali:858-903`：

```java
String getExtraOpenPath() {
    Intent i = getIntent();
    String v = i.getStringExtra("obj");        // ← 优先读 "obj"
    if (v == null) {
        v = i.getStringExtra("open_path");     // ← 回退读 "open_path"
    }
    return v;
}
```

> **双 key 设计**：`obj` 用于组件内跳转（如 helper 之间），`open_path` 用于 Intent 传递（如从其他 App 或桌面快捷方式进入）。**这是同一个入口的两套数据来源**。

### 8.4 `n91.w()`：锚点解析（**核心发现**）

【实证·产物】`n91.smali:2766-2914`（148 行）：

```java
void w() {
    String path = this.у.getExtraOpenPath();       // ① 取路径
    if (path == null || path.length() == 0) return;

    String[] parts = path.split("/");              // ② ★ 用 "/" 分割！
    if (parts.length <= 1) return;

    String anchor = parts[1].trim();               // ③ 取第 2 段
    if (TextUtils.isEmpty(anchor)) return;

    Preference p = this.K.findPreference(anchor);  // ④ 按 key 查找
    if (p == null) return;

    // ⑤ 350ms 后滚动/高亮
    this.X.postDelayed(new b6(this, 0x1b, p), 0x15e /* 350ms */);
}
```

> **⚠️ 分隔符是 `"/"` 而不是 `"#"`**
>
> XML 里写的是 `misc#long_volume_controls`，但解析时用 `split("/")`。这说明**中间一定有一层把 `#` 转成了 `/`**。
>
> 合理推断：`open_path` 的完整形式是 `"<path>/<page>#<anchor>"`，其中 `<path>` 本身用 `/` 分隔层级，`#` 只是**最后一个页面与锚点的分隔**。`split("/")` 取第 2 段，实际取的是"页面 + 锚点"整体，后续再处理 `#`。
>
> 但这与代码不符（`parts[1]` 直接当 key 用）。**更可能的情况**：那层转换发生在 ②③ 之间的某个未展开的 helper 里。标【推断】。

**为什么延迟 350ms**：`postDelayed(..., 0x15e)` —— 等 `PreferenceScreen` 完成布局后才能滚动到目标项。太短则 `View` 未就绪，太长则用户感知卡顿。

### 8.5 带参跳转的构造模式（`v81` 实例）

【实证·产物】`v81.smali:1183-1286`（主题页的带参跳转）：

```java
String path = super.О()                        // ← 当前页面路径
    + "?theme_pak=" + Uri.encode(themePak)     // ← ★ URI 编码！
    + "&theme_id=" + themeId
    + "&theme_page_path=" + pagePath;
this.l = path;                                 // 存入字段
```

**三个关键点**：

| 点 | 说明 |
| --- | --- |
| **`Uri.encode()`** | 参数值必须编码（`v81:1217`），防止值中含 `&`/`=`/`#` 破坏结构 |
| **`?` 起始、`&` 分隔** | 标准 URL query 语法 |
| **`О()` 取 base** | `n91.О()` 返回当前页面路径 |

### 8.6 `?uniqName=...&device=chromecast#no_af` 的语义

回到 `audio_focus` 的那个跳转：

```
audio_output_device_opts?uniqName=com.maxmpz.audioplayer/output.cc&device=chromecast#no_af
```

拆解【推断（基于 §8.4/8.5 的机制）】：

| 部分 | 值 | 含义 |
| --- | --- | --- |
| 页面 | `audio_output_device_opts` | 输出设备选项页 |
| `?uniqName=` | `com.maxmpz.audioplayer/output.cc` | **音频设备唯一名**（Chromecast 输出的标识）|
| `&device=` | `chromecast` | 设备类型 |
| `#no_af` | `no_af` | 锚点：**"no audio focus"** 配置项 |

**`n81` 类佐证**：`n81.toString()` 输出的正是音频设备描述【实证·产物】`n81.smali:97-180`：

```
n81 uri=<uri> opts=0x<hex> deviceId=<int> uniqName=<name> hasSampleRates=<bool> hasSampleFormats=<bool>
```

> 这与 `?uniqName=...&device=...` 的查询参数**完全对应**。所以这个跳转是：
>
> **"跳到 Chromecast 这个具体输出设备的配置页，并定位到 no_af 选项"**
>
> 语义解释：`pref_cc_af_warning` 的文案说 "Chromecast output may ignore calls and short Audio Focus completely" —— 所以给出一个直达链接让用户去关掉 Chromecast 的音频焦点处理。

### 8.7 `w()` 的三个调用点与其时机

【实证·产物】：

| 调用点 | 时机 |
| --- | --- |
| `u61.smali:1736` | **helper 创建完成后**（`new z61(...)` 之后立即调）|
| `n91.smali:3545` | 页面 resume 时 |
| `g91.smali:109` | 内嵌场景 |

> **`u61:1736` 是主路径**：`SettingsActivity` 创建完 helper 后立刻处理 `open_path`，确保跳转进来的页面立即定位到锚点。

### 8.8 5 处单次 `jo0.B()` 写入的完整参数

上轮只列了位置，本轮读出参数【实证·产物】：

| 位置 | 参数 | 语义 |
| --- | --- | --- |
| **`oo0:311`** | `B(1, ..., "RESUME resume_on_mount", " mount event")` | **存储挂载后恢复播放** |
| `cl0:5556` | `B(1, ..., "reloadPipeline", <详情>)` | 音频管线重载 |
| `jl0:6230` | `B(1, ..., <命令>, <详情>)` | 播放核心事件 |
| `dy1:6801` | `B(1, p0, p2, p1)` | 服务层命令 |
| `t4:2085` | `B(1, ..., "handleSearchAndPlay", <详情>)` | 搜索结果播放 |

**`oo0` 的额外发现**：该记录位于一段 **30 秒窗口**判定内【实证·产物】`oo0.smali:290`：

```java
const-wide/16 v4, 0x7530    // 30000ms = 30 秒
cmp-long p2, v2, v4
if-gtz p2, :cond_2          // 超过 30 秒则跳过
```

> **语义**：只有当"存储挂载"事件发生在启动后 **30 秒内**，才触发 `resume_on_mount` 恢复播放。
>
> 这与 `audio_focus` 页的 `resume_on_mount` 选项（"Wait for a storage (up to 30s.) to mount before resuming on start"）**完全对应**——UI 文案说的 "up to 30s" 就是这里的 `0x7530`。

### 8.9 本轮对上一轮未解项的更新

| 原问题 | 结论 |
| --- | --- |
| `cc_af_warning` 带参跳转解析 | ✅ **已解**（§8.6）：`?uniqName=&device=#no_af`，指向 Chromecast 设备的 no_af 配置 |
| `cl0`/`jl0`/`dy1`/`t4` 参数 | ✅ **已解**（§8.8）+ 额外发现 `oo0` 的 30 秒窗口 |
| `x80` 的 `ra1` 回调细节 | ⚠️ 仍未展开（P3）|

---

---

## 9. 第 4 轮：锚点分隔符之谜的真相（**证伪前一版推断**）

> **本轮结论：所谓 `"#"→"/"` 转换层并不存在。** 上一轮的推断是错的。
> 真实情况是：**存在两条互不相干的路径机制**，我之前把它们误认为同一条。

### 9.1 上一轮的推断错在哪里

上一轮我写：

> "XML 写 `misc#key`，但 `w()` 用 `split("/")`，中间必有转换层。标【推断】。"

**本轮把这个推断证伪了**。逐项排查结果：

| 排查方向 | 结果 |
| --- | --- |
| 全库 `replace(CC)` 调用（6 个类）| **无一处是 `#`→`/`**（`dn0` 是 `\`→`/`，`ne` 是 `/`→`_`，`q10/v10/y10` 是 `.` 替换）|
| 全库 `const 0x23`（`#` ASCII）| 3 处，均为数字格式化/字符范围判断，**与路径无关** |
| `PrefBase.setTarget` 链路 | 走 `qd0.u(String)`，拼成 `"settings/" + target`，**`#` 原样保留** |

### 9.2 真相：两条独立的路径机制

**机制 A：`qd0.u()` —— 拼接式页面路径**

【实证·产物】`qd0.smali:9720-9836`（116 行）：

```java
void u(String target) {
    setFragment(null);                       // ← 不用 Android Fragment 机制
    this.К = target;                         // 保存原始 target

    if (target == null) return;

    // URL 直接透传
    if (target.startsWith("http:") || target.startsWith("https://")) {
        this.у = target;
        return;
    }

    // 非 URL：加 "settings/" 前缀
    String prefix = target.startsWith("/") ? "" : "settings";
    this.у = ee1.a(prefix, "/", target);     // 简单字符串拼接
}
```

`ee1.a(a,b,c)` 就是 `a + b + c`【实证·产物】`ee1.smali:308-340`（33 行）。

**所以 `misc#long_volume_controls` 会被拼成 `"settings/misc#long_volume_controls"`，`#` 完好保留。**

**机制 B：`n91.w()` —— 读取 Intent 的 `open_path`**

【实证·产物】`n91.smali:2766-2914`：

```java
void w() {
    String path = activity.getExtraOpenPath();   // ← 从 Intent 读，不是从 qd0
    if (path == null || path.length() == 0) return;

    String[] parts = path.split("/");             // 用 "/" 分割
    if (parts.length <= 1) return;

    String anchor = parts[1].trim();
    Preference p = K.findPreference(anchor);      // 直接当 key 用
    if (p != null) X.postDelayed(new b6(this, 0x1b, p), 0x15e);
}
```

### 9.3 关键问题：`findPreference(parts[1])` 收到的是什么

按机制 B 的代码，若 `open_path = "settings/misc#long_volume_controls"`，则：

```
split("/") → ["settings", "misc#long_volume_controls"]
parts[1]   → "misc#long_volume_controls"
findPreference("misc#long_volume_controls")  ← 含 # ，查不到任何 key！
```

**这意味着机制 B 对带 `#` 的 target 是失效的**——除非 `open_path` 的实际值形态与 XML 不同。

### 9.4 最可能的解释（仍为【推断】）

`RedirectPreference` 的点击**根本不经过 `n91.w()`**。两条机制的适用场景是分开的：

| 机制 | 触发场景 | `open_path` 的值 |
| --- | --- | --- |
| **A（`qd0.u`）** | **设置页内的 RedirectPreference 点击** | 不写 `open_path`，走 `qd0.у` |
| **B（`n91.w`）** | **外部 Intent 跳入**（桌面快捷方式、其他 App、`open_path` extra）| `"<page>/<key>"` 形态 |

证据支撑：

1. `n91.w()` 的三个调用点是 `u61:1736`（helper 创建后）、`n91:3545`（resume）、`g91:109` —— **都在"页面加载"时机**，不是"点击 RedirectPreference"时机
2. `n91.P()`（写 `open_path`）用的是 `р()` = **当前页面路径**，即 `"misc"` 这类，不含锚点
3. 全库只有 1 处 `setFragment` 且传 `null` —— 确认不走 Android 标准 Fragment 跳转

**结论**：机制 B 处理的是 `"settings/misc/long_volume_controls"` 这种**用 `/` 分隔页与 key** 的外部路径，而不是 XML 里的 `#` 语法。

> **XML 的 `#` 语法由谁处理，仍未定位。** 这可能是：
> - 在 `SettingsActivity.startActivity()`（3506–3720 行，215 行）里
> - 在某处把 `#` 转成 `/` 后再拼 `open_path`
> - 或 `#` 只是**给人看的文档标记**，实际运行时由 `qd0.u` 拼的 `"settings/misc#..."` 交给别的消费方

### 9.5 本轮排除的假说（供后续参考）

| 假说 | 排除依据 |
| --- | --- |
| `replace('#','/')` 某处 | 全库 6 个 `replace(CC)` 全部核对，无 `0x23` |
| `const 0x23` 做 indexOf | 3 处均为非路径用途 |
| `qd0.у` 直接被 `n91.w()` 消费 | `n91.w()` 只读 `getExtraOpenPath()`，与 `qd0` 无关 |
| Android `setFragment` 机制 | 全库唯一调用传 `null` |
| `isValidFragment` 做分派 | 只允许 `u61`，是对固定 Fragment 的校验 |

### 9.6 诚实的结论

**这一项应该降级为"已知边界"而非"待解问题"。**

理由：
- 已确认 `#` 不是通过字符串替换处理的（排除法穷尽了所有 `replace` 和 `0x23` 使用）
- 已确认存在两条独立机制，且 `n91.w()` 对带 `#` 的 target 会失效
- 继续追需要**动态调试**（在 `findPreference` 下断点看实参），静态分析已到边界

> **对文档读者最重要的是**：`w:target="page#key"` 这个语法**确实有效**（XML 里大量使用，功能正常），但**其解析路径不在我定位的这两个机制里**。这个断层已如实记录，不再用推断掩盖。

---

## 10. 未解问题

> **第 4 轮**：证伪了 `"#"→"/"` 转换层的存在（§9），把一个 P2 问题降级为**已知边界**。
> **当前状态**：耳机子树的功能机制已全部解出，剩余项均为静态分析无法覆盖的部分。

### 10.1 已知边界（非"待解问题"）

| 项 | 状态 | 需要什么才能解开 |
| --- | --- | --- |
| **XML `w:target="page#key"` 的运行时解析** | **已排除 5 种假说**（§9.5），确认不在 `qd0.u` 与 `n91.w` 两条机制内 | **动态调试**：在 `findPreference` 下断点看实参 |
| `x80` 的 `ra1` 授权回调 | 已定位到 `sa1:924` 传入，未展开 | 读 `ra1.smali`（142 行，成本低但收益也低）|
| `n81.uri` 的构造点 | 全库无 `new-instance n81` | 可能在 native 层或反射创建 |

### 10.2 为什么停止

耳机子树的**功能行为已 100% 可解释**：

| 维度 | 覆盖度 |
| --- | --- |
| 根页 18 个 key 的语义与落地 | ✅ 全部 |
| 3 层依赖链 | ✅ 声明式，零代码 |
| 按键运行时（`rk0`/`w8`/`s91` 状态机） | ✅ 全部 |
| 1 个真子页 `commands_history` | ✅ 记录结构 + 数据源 + 刷新机制 |
| 2 个跨分支跳转 | ✅ 目标页 + 落点 + 参数语义 |
| 跨页跳转的三层机制 | ✅ 已定位两层，第三层为边界 |

**剩余项的共同特点**：都不影响"这个功能怎么工作"的理解，只影响"某一行代码在哪个文件"的完备性。

### 10.3 若将来要继续

按成本排序：

1. **读 `ra1.smali`（142 行）** —— 半小时内可完成，能闭合 `x80` 回调
2. **动态调试 `findPreference`** —— 需要搭 frida/Xposed 环境
3. **反编译 native 层找 `n81` 构造** —— 成本最高，收益最低

## 11. 证据索引

### 11.1 XML / 资源

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

### 11.2 smali

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

### 11.2b 第 2 轮新增定位（记录结构）

| 位置 | 内容 |
| --- | --- |
| **`hf1.smali:19-57`** | **构造器**：type/source/command/extraInfo + 自动 `currentTimeMillis()` |
| **`hf1.smali:61-204`** | **`toString()`：字段名映射的权威来源** |
| `hf1.smali:73-112` | `type` 映射：`0→"command"`、`1→"external"` |
| `hf1.smali:127-195` | 拼接 `type=/source=/command=/extraInfo=` |
| `jo0.smali:19-57` | 环形缓冲构造（64 条）|
| `jo0.smali:61-257` | `B()` 写入 + 加锁 |
| `jo0.smali:261-414` | `В()` 两段拷贝读出 |
| **`zm.smali:373-416`** | **`clear()`：所有槽位 = null，size = 0** |
| **`o91.smali:245-298`** | **清空菜单：`zm.clear()` + `jo0.A++`（保持单调）** |
| `o91.smali:317-357` | 复制菜单（`ClipData.newPlainText`）|
| `o91.smali:371-450` | 分享菜单（`ACTION_SEND` + `SUBJECT`/`TEXT`）|
| **`sa1.smali:908-998`** | **`_long_volume_shizuku_grant` 懒加载创建** |
| `sa1.smali:938-960` | **锚点拼接：`n91.H() + "#_long_volume_shizuku_grant"`** |
| `sa1.smali:972-976` | `u0(0xe, this)` 进度回调 |
| **`x80.smali:130`** | **目标权限 `SET_VOLUME_KEY_LONG_PRESS_LISTENER`** |
| `x80.smali:138-167` | **`/system/bin/cmd package grant --user N ...`** |
| `x80.smali:178` | **10 秒超时** |
| `x80.smali:257` | `moe.shizuku.server.IShizukuService` |
| `x80.smali:243` | `"no Shizuku binder"` 错误分支 |
| **`rl0.smali:1253-1456`** | **13 条音频焦点记录写入** |
| `rl0.smali:1273/1303/1350` | `AUDIOFOCUS_LOSS` 的三分支记录 |
| `rl0.smali:1393` | `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK` |
| `rl0.smali:303/609/1078` | `UNDUCK` / `RESUME` / `wasPausedByFocusChange=` |
| `zf.smali:931` | **唯一的 `type=0`**：`PSSleepTimer` |
| `ik0.smali:1146/1160` | `pauseInCall` 记录 |
| `dk0.smali:4809` | `pausePlaying` |
| `cl0.smali:5556` | `reloadPipeline` |
| `oo0.smali:311` | `RESUME resume_on_mount` |
| `t4.smali:2085` | `handleSearchAndPlay` |

### 11.2c 第 3 轮新增定位（跳转机制）

| 位置 | 内容 |
| --- | --- |
| `RedirectPreference.smali:1-130` | 全文仅存 `h` 字段，无解析逻辑 |
| `RedirectPreference.smali:119-123` | `setDependency(h)` |
| **`SettingsActivity.smali:858-903`** | **`getExtraOpenPath()`：`obj` → `open_path` 双 key 回退** |
| `SettingsActivity.smali:870` | `obj` extra |
| `SettingsActivity.smali:886` | `open_path` extra |
| **`n91.smali:2766-2914`** | **`w()` 锚点解析（148 行）** |
| `n91.smali:2784` | 取 `getExtraOpenPath()` |
| **`n91.smali:2808-2812`** | **`split("/")` —— 分隔符是 `/` 不是 `#`** |
| `n91.smali:2830` | `parts[1]` 取第 2 段 |
| `n91.smali:2874` | `findPreference(anchor)` |
| `n91.smali:2890-2903` | `b6(0x1b)` + **350ms**（`0x15e`）延迟 |
| `n91.smali:3545` | `w()` 的 resume 调用点 |
| `u61.smali:1736` | `w()` 的主调用点（helper 创建后）|
| `g91.smali:109` | 内嵌场景调用 |
| **`v81.smali:1183-1286`** | **带参跳转构造：`?theme_pak=&theme_id=&theme_page_path=`** |
| `v81.smali:1217` | **`Uri.encode()` 参数编码** |
| `v81.smali:1196/1230/1260` | 三个 query 片段 |
| **`n81.smali:97-180`** | **`toString()` 输出 `uri/opts/deviceId/uniqName`** |
| `oo0.smali:290` | **`0x7530` = 30 秒挂载窗口** |
| `oo0.smali:307-311` | `RESUME resume_on_mount` + `mount event` |
| `cl0.smali:5545-5556` | `reloadPipeline` |
| `t4.smali:2078-2085` | `handleSearchAndPlay` |
| `dy1.smali:6798-6801` | 服务层命令 |
| `jl0.smali:6227-6230` | 播放核心事件 |

### 11.2d 第 4 轮新增定位（证伪排查）

| 位置 | 内容 |
| --- | --- |
| **`qd0.smali:9720-9836`** | **`u(String)` target 解析器（116 行）** |
| `qd0.smali:9727` | 清空 `у` 字段 |
| `qd0.smali:9739` | `setFragment(null)` —— 不走 Android Fragment |
| `qd0.smali:9744` | 保存原始 target 到 `К` |
| `qd0.smali:9752-9784` | `http:` / `https://` 直接透传 |
| **`qd0.smali:9788-9818`** | **非 URL：拼 `"settings/" + target`（`#` 保留）** |
| **`ee1.smali:308-340`** | **`a(a,b,c)` = 纯字符串拼接（33 行）** |
| `PrefBase.smali:439-464` | `setTarget()` → `qd0.u()` |
| `PrefBase.smali:83-87` | `new qd0(this)` 构造 |
| `RawTextPreference.smali:294` | 从 styleable 读 target 后调 `setTarget` |
| `n91.smali:2766-2914` | `w()` 读 `getExtraOpenPath()` |
| `n91.smali:2874` | `findPreference(parts[1])` 直接当 key 用 |
| `SettingsActivity.smali:1163-1188` | `isValidFragment` 只允许 `u61` |
| `SettingsActivity.smali:3506-3720` | `startActivity`（215 行，未展开）|

**排除的 6 处 `replace(CC)`**：

| 类 | 行 | 替换对 |
| --- | ---: | --- |
| `dn0` | 1611 | `\` → `/` |
| `ne` | 754 | `/` → `_` |
| `q10`/`v10`/`y10` | 30 | `.` 相关 |
| `jn0` | 2250/2286 | （非路径）|

**排除的 3 处 `const 0x23`**：`b12:1177`、`n71:1866`、`z22:1046` —— 均为数字格式化/字符范围判断。

### 11.3 交叉引用

| 文档 | 关系 |
| --- | --- |
| `poweramp-headset-full-implementation.md` | **姊妹篇**：根页 + 按键运行时（`rk0`/`w8`/`s91`）|
| `poweramp-headset-settings.md` | 偏好结构视角 |
| `poweramp-audio-settings-structure.md` | `audio_focus` 所属分支的完整分析 |
| `poweramp-misc-settings.md` | `long_volume_controls` 所属分支 |
| `poweramp-settings-page-runtime.md` | `u61` 分发表机制、`C`=父页 id |
