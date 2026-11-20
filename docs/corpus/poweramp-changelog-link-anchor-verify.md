---
doc_id: "ARCH-POWERAMP-CHANGELOG-LINK-ANCHOR-VERIFY"
title: "版本更新深链锚点验证：66 个链接的落点核查"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐条逆向各版本更新内容的实现"
  - "docs/corpus/poweramp-changelog-index.md"
---

# 版本更新深链锚点验证

## 0. 一句话结论

changelog 里 **59 个带锚点的深链**，在 build-1025 中命中 **46 个**（78%）；
未命中的 **13 个全部有解释**——不是文档错误，而是**版本或资源类型差异**。

---

## 1. 验证方法

```
1. 从 changelog 提取 settings/<page>#<key> 形式的深链      → 59 个
2. 扫描 1025 的 53 个 res/xml/*.xml，建 key → 文件索引   → 408 个 key
3. 逐个比对                                            → 命中 46
4. 对 13 个未命中：查 1035 XML + 查 skins XML 的自定义 key 属性
```

---

## 2. 46 个命中（build-1025 直接可用）

这些锚点在 1025 的普通 XML 里以 `android:key="..."` 形式存在，
可直接定位到偏好定义。

典型落点：

| 设置页 | 已验证的 key 举例 |
| --- | --- |
| `headset` | `ignore_bt_sec`、`bt_ignore_repeat_shuffle`、`resume_on_bt`、`beep_more`、`follow_pl_exact` |
| `ui_player` | `line2_click`、`menu_button_long_press`、`anim_long_labels_in_lists` |
| `vis` | `vis_fs_hide_bars`、`vis_ignore_touch_faded` |
| `library_lists` | `hide_unknown_artist`、`stream_name_in_title` |
| `aa_bg` | `aa_bg_gradient`、`aa_bg_gradient_color`、`aa_bg_gradient_for_list` |

---

## 3. ★ 13 个未命中的完整解释

### 3.1 类型 A：1026+ 新功能（9 个，在 1035 中存在）

| 深链 | 1035 中的归属文件 |
| --- | --- |
| `audio_bit_perfect#global_follow_sr` | `audio_bit_perfect.xml` |
| `audio_bit_perfect#global_perfect_bit_perfect` | 同上 |
| `audio_bit_perfect#global_pipeline64` | 同上 |
| `audio_bit_perfect#global_dsd_remaster` | 同上 |
| `audio_outputs_tweaks#usb_activity` | `audio_outputs_tweaks.xml` |
| `audio_output_device_opts#set_codec_sr` | `audio_output_device_opts.xml` |
| `audio_output_device_opts#shizuku_absvol` | 同上 |
| `audio_tweaks#mod_interpolation` | `audio_tweaks.xml` |
| `headset#pause_on_usb_connection` | `headset.xml` |

> **这 9 个正是被判定为"晚于可分析版本"的条目**——
> 它们在 1025 里确实不存在，在 1035 里确实存在。
> **这条验证独立证实了 §0.1 的版本分档结论。**

### 3.2 类型 B：皮肤选项 key（3 个，在 1025 skins XML 中）

| 深链 | 实际位置 |
| --- | --- |
| `ui_theme#alt_layout` | `poweramp_builtin_skins.xml` 的 `<radio key="alt_layout">` |
| `ui_theme#player_buttons_bg` | 同文件的 `<multiSwitch key="player_buttons_bg">` |
| `ui_theme#labels_bg` | 同文件的 `<multiSwitch dependency="alt_layout" key="labels_bg">` |

**为何第一步没命中**：这些元素用的是 **`key="..."`（无 `android:` 前缀）**，
而我的第一轮索引只匹配 `android:key="..."`。

> 这是**资源类型差异**，不是版本差异。
> 皮肤选项走自定义属性，普通设置走 Android 标准属性——两套并存。

### 3.3 类型 C：仅存在于 1035（1 个）

| 深链 | 1025 | 1035 |
| --- | :---: | :---: |
| `ui_theme#blended` | ❌ | ✅（`poweramp_builtin_skins.xml`） |

> `blended` 对应 changelog 的 "Builds 1033-10xx: new Blended skin option"——
> 明确的 1033+ 功能，1025 里没有是**正确的**。

---

## 4. 皮肤选项 key 全集（1025 vs 1035）

| 版本 | key 数 | blended |
| --- | ---: | :---: |
| build-1025 | **31** | ❌ |
| build-1035 | **33** | ✅ |

1025 的 31 个 key：

```
alt_layout, track_labels_align, labels_bg, player_buttons_bg, mu_colors,
font_variant, rounding, seekbar, more_buttons, light_buttons, knob_hilite,
graphic_frs_color, force_light_navbar, navbar_bg, navbar_offset,
android_navbar_bg, statusbar_bg, ...（共 31）
```

> 1035 比 1025 多 2 个。CHANGELOG 提及的新皮肤选项（`blended`）在其中。

---

## 5. 对逆向工作的意义

| 结论 | 影响 |
| --- | --- |
| 46 条深链可直接定位 | 占全部 149 条的 **31%**，是最快的逆向路径 |
| 9 条属 1026+ | 只能查 1035，且 1035 是混淆 bundle 版，难度更高 |
| 3 条属皮肤选项 | 需查 `poweramp_builtin_skins.xml` 而非普通 XML |
| 1 条属 1033+ | 同上，查 1035 |

> **剩余 90 条无深链**——只能靠功能描述去 smali 里找，难度更高。

---

## 6. 证据索引

| 主题 | 位置 |
| --- | --- |
| 深链提取 | `docs/corpus/poweramp-release-changelog.md` 全文 |
| 1025 XML | `.rea-analysis/decoded/res/xml/`（53 个文件） |
| 1035 XML | `.rea-analysis/v1035/decoded/res/xml/`（59 个文件） |
| 1025 皮肤 key | `.rea-analysis/decoded/res/xml/poweramp_builtin_skins.xml`（31 个 key） |
| 1035 皮肤 key | `.rea-analysis/v1035/decoded/res/xml/poweramp_builtin_skins.xml`（33 个 key） |
| 版本差异结论 | `poweramp-changelog-index.md` §0.1 |

> 口径：**build-1025** 主，**build-1035** 补。