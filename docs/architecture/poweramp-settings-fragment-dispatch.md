---
doc_id: "ARCH-POWERAMP-SETTINGS-FRAGMENT-DISPATCH"
title: "插件系统（四）：设置分发中枢 f0 与 17 个页面 helper"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni (versionCode 1025009)"
revision: 1
open_items: 1
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/architecture/poweramp-plugin-device-binding.md（三）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/preference/f0.smali"
---

# 插件系统（四）：设置分发中枢 f0 与 17 个页面 helper

## 0. 一句话结论

`preference/f0` 是**整个设置系统的唯一 Fragment**（1135 行），
通过 `target` 参数 → 资源 id → **17 个 helper 之一**完成分发。

**插件详情页不是独立 Activity，而是这个中枢的一个分支。**

---

## 1. 分发机制（`f0.onCreate`，`:58-956`）

### 1.1 三步

```smali
// ① 固定用 "global" 偏好文件（:67-69）
getPreferenceManager().setSharedPreferencesName("global");

// ② 从 arguments 取 target（:75-83）
target = getArguments().getString("target");

// ③ target -> 资源 id -> 按 id 分派 helper
if (target == "ui_tweaks_player") target = "ui_player";   // ★ 别名重定向
xmlId = res.getIdentifier(target, "xml", pkg);
switch (xmlId) { ... 17 个 helper ... }
```

> **`ui_tweaks_player` → `ui_player` 是唯一的内置别名**（`:93-108`）。
> 说明曾经有过该页面名，后来合并了，但旧跳转仍要兼容。

### 1.2 helper 统计（实测 58 个分支）

| helper | 分支数 | 负责的 xml id 数 | 定位 |
| --- | ---: | ---: | --- |
| **`k0`** | **31** | **23** | **通用兜底**（大部分简单页面） |
| `j0` | 7 | 6 | UI 类页面 |
| `f1` | 4 | 4 | 皮肤/主题相关 |
| `y1` | 2 | 2 | About 系列 |
| `w1` | 2 | 2 | 命令/日志 |
| `z2` `f3` `n3` `q2` `p0` `r0` `c1` `b2` `g2` `l2` `v2` `b3` | 各 1 | 各 1 | 专用页面 |

> 分支数(58) > id 数(43) 是因为**同一 id 在不同条件下落到不同 helper**（见 §2）。

---

## 2. ★ 同名 id 的多分支（关键设计）

多处 id 出现 2 次以上，落到**不同 helper**：

| xml id | 分支数 | helper |
| --- | ---: | --- |
| `singlepane`（`0x7f160025`） | 7 次出现 | 见 §2.1 订正 |
| `audio`（`0x7f160003`） | 6 | `k0` / `j0` |
| `ui`（`0x7f16002e`） | 4 | `k0` / `f1` / `j0` |
| `general`（`0x7f160013`） | 3 | `y1` / `k0` / `w1` |
| `audio_tweaks`（`0x7f16000c`） | 3 | `k0` / `b3` |

> 说明**同一 XML 页面在不同上下文**会交给不同 helper 处理。

### 2.1 订正：singlepane 的真实身份（`0x7f160025`）

> **它不是"有 8 个分支的页面"，而是 `k0` 构造器的第 3 个参数**——
> 表示"该页面在 single-pane 模式下的回退页面 id"。

实测 7 次出现中，**只有 1 次是真正的 if 条件**：

| 行 | 用法 |
| ---: | --- |
| `:153` | `if-ne v10, 0x7f160025, :cond_2` ← **唯一条件判定** |
| `:180` | `const v0, 0x7f160025` —— 预缓存供 `y1` 构造 |
| `:201` / `:224` / `:241` / `:260` / `:452` | **作为 `k0` 构造参数** |

`k0` 构造签名（据 5 处调用点反推）：

```smali
new k0(activity, screenScope /* 0/1/7/9/18 */, this /* f0 */, 0x7f160025)
```

> **`singlepane` 是单窗格模式下该页的替代页**。
> 多窗格设备（平板）用 singlepane 布局，此时某些页面换成另一 XML。
> 这是**为平板适配设计的页面映射参数**，不是分支条件。

> ⚠️ 本篇初稿把它统计成「8 个分支的 id」是**误读**，本轮逐处核对上下文后订正。

---

## 3. 插件相关分支

第三篇里插件列表页用 `setFragment(f0)` + `extras.putString("target", ...)` 跳转，
这里就是接收端：

| 第三篇的 `target` | 本篇的 xml id | helper |
| --- | --- | --- |
| `audio_output_device_opts` | `0x7f160008` | **`c1`** |
| `audio_output` | `0x7f160007` | **`k0`** |

> 所以"插件详情"实际落到两个不同 helper：
> **设备选项页走专用 `c1`，纯输出页走通用 `k0`**。

---

## 4. 其余 helper 的页面归属（实测全表）

| xml id | 名称 | helper |
| --- | --- | --- |
| `0x7f160001` | `aa_bg` | `j0` |
| `0x7f160002` | `already_purchased` | `k0` |
| `0x7f160003` | `audio` | `k0` / `j0` |
| `0x7f160004` | `audio_dvc` | `p0` |
| `0x7f160005` | `audio_equ` | `r0` |
| `0x7f160006` | `audio_focus` | `k0` |
| `0x7f160007` | `audio_output` | `k0` |
| `0x7f160008` | `audio_output_device_opts` | **`c1`** |
| `0x7f160009` | `audio_outputs` | `k0` |
| `0x7f16000a` | `audio_platform_log` | `f1` |
| `0x7f16000b` | `audio_resampler` | `j0` |
| `0x7f16000c` | `audio_tweaks` | `k0` / `b3` |
| `0x7f16000e` | `buy_methods` | `k0` |
| `0x7f160010` | `commands_history` | `w1` |
| `0x7f160011` | `fade` | `k0` |
| `0x7f160012` | `feature_packages` | `k0` |
| `0x7f160013` | `general` | `y1` / `k0` / `w1` |
| `0x7f160014` | `headset` | `b2` |
| `0x7f160015` | `library` | `g2` |
| `0x7f160016` | `library_lists` | `k0` |
| `0x7f160017` | `library_playlists` | `l2` |
| `0x7f160018` | `library_queue` | `k0` |
| `0x7f160019` | `library_scanner` | `k0` |
| `0x7f16001a` | `library_search` | `k0` |
| `0x7f16001b` | `library_shuffle` | `k0` |
| `0x7f16001c` | `lockscreen` | `q2` |
| `0x7f16001d` | `misc` | `v2` |
| `0x7f16001e` | `peq_equ_bands` | `k0` |
| `0x7f16001f` | `peq_equ_tone` | `f1` |
| `0x7f160022` | `rg` | `k0` |
| `0x7f160025` | `singlepane` | `z2` / `y1` / `k0` |
| `0x7f16002d` | `translations` | `k0` |
| `0x7f16002e` | `ui` | `k0` / `f1` / `j0` |
| `0x7f16002f` | `ui_icon` | `f3` |
| `0x7f160030` | `ui_lyrics` | `j0` |
| `0x7f160031` | `ui_mediaactions` | `j0` |
| `0x7f160032` | `ui_notify` | `k0` |
| `0x7f160033` | `ui_player` | `k0` |
| `0x7f160034` | `ui_theme` | `k0` |
| `0x7f160035` | `ui_theme_opts` | `f1` |
| `0x7f160036` | `vis` | `n3` |

---

## 5. 与插件系统的接点

| 插件系统的需要 | 由 f0 提供 |
| --- | --- |
| 进入插件详情 | `setFragment(f0)` + `target=<xml名>` |
| 传插件标识 | `extras.putString("uniqName", ...)` |
| 传设备上下文 | `extras.putString("device", ...)` |
| 数据来源 | 统一 `"global"` SharedPreferences |

> **插件没有自己的设置页 Activity**——全部复用 `f0`。
> 外部插件例外（第三篇：不设 Fragment，走自己的 Activity）。

---

## 6. 可借鉴 / 不建议照抄

### 6.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **单 Fragment + 字符串 target 分发** | 不用注册 Activity，栈管理简单 |
| A2 | **`getIdentifier` 动态解析 xml id** | target 写页面名即可，不必硬编码 id |
| A3 | **别名重定向表**（`ui_tweaks_player`→`ui_player`） | 旧跳转兼容 |
| A4 | **通用 helper `k0` 兜底 23 个页面** | 简单页面零专用代码 |

### 6.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 单方法 `onCreate` 逾 900 行 | 58 分支交织，难测 |
| N2 | 同名 id 多分支靠 if 顺序决定 | 新增用例如需插队，易破坏 |
| N3 | `target` 是**字符串**而非枚举 | 拼错只会在运行期返回 id=0 |
| N4 | 全部共享 `"global"` 偏好文件 | 无隔离，键名冲突风险 |

---

## 7. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`singlepane` 8 分支~~ | ✅ **已订正**（§2.1）：实为 `k0` 构造参数，仅 1 处条件 |
| ~~Q2~~ | ~~`c1` 内部实现~~ | ✅ **已展开**（七、十九）：参数解析 + 32 键九阶段 |

---

## 8. 证据索引

| 主题 | 位置 |
| --- | --- |
| Fragment 定义 | `preference/f0.smali`（1135 行） |
| 偏好文件名 | `f0.smali:67-69`（`"global"`） |
| target 读取 | `f0.smali:75-83` |
| 别名重定向 | `f0.smali:93-108`（`ui_tweaks_player` → `ui_player`） |
| id 解析 | `f0.smali:127-131`（`getIdentifier`） |
| 分派主体 | `f0.smali:141-956` |
| 插件设备选项 | `0x7f160008` → `c1` |
| 插件纯输出页 | `0x7f160007` → `k0` |

> 口径：**build-1025**。
