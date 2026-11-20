---
doc_id: "ARCH-POWERAMP-DEVICE-OPTS-RENDER-STAGES"
title: "插件系统（十九）：设备选项页 c1.z() 的渲染阶段划分"
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
  - "docs/corpus/poweramp-plugin-device-opts-handler.md（七）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/preference/c1.smali"
---

# 插件系统（十九）：设备选项页 c1.z() 的渲染阶段划分

## 0. 一句话结论

第七篇遗留的"`c1.z()` 2200 行主体未展开"，本轮用**键出现顺序**做了阶段划分。

`c1.z()`（`:497-2723`，2226 行）内出现 **32 个字符串键**，
按位置可清晰切成 **6 个渲染阶段**。

---

## 1. 32 个键的完整序列（按行号）

| # | 行 | 键 | 阶段 |
| ---: | ---: | --- | --- |
| 1 | `:508` | `device` | ① 参数 |
| 2 | `:672` | `pa_output_` | ② 标题 |
| 3 | `:682` | `string` | ② 标题 |
| 4 | `:688` | `device_` | ② 标题 |
| 5 | `:700` | `bt_dvc_msg` | ② 标题 |
| 6 | `:820` | `pref_hi_res_no_dvc_hint` | ③ 提示 |
| 7 | `:830` | `pref_sr_format_effects_override_hint` | ③ 提示 |
| 8 | `:884` | `output_` | ④ 输出开关 |
| 9 | `:939` | `output_switch` | ④ 输出开关 |
| 10 | `:992` | `configure_cc_button` | ④ Chromecast |
| 11 | `:1012` | `target` | ④ Chromecast |
| 12 | `:1014` | `ui_player` | ④ Chromecast |
| 13 | `:1018` | `hash` | ④ Chromecast |
| 14 | `:1020` | `cc_button` | ④ Chromecast |
| 15 | `:1213` | `buffer_size` | ⑤ 音频参数 |
| 16 | `:1458` | `sample_rate` | ⑤ 音频参数 |
| 17 | `:1487` | `sample_rate_static` | ⑤ 音频参数 |
| 18 | `:1837` | `sample_fmt` | ⑤ 音频参数 |
| 19 | `:1864` | `sample_bits_static` | ⑤ 音频参数 |
| 20 | `:2263` | `pref_ar_format_changes_when_playing` | ⑥ 提示 |
| 21 | `:2278` | `restore_defaults` | ⑥ 恢复 |
| 22 | `:2304` | `oem_variant` | ⑦ 开关 |
| 23 | `:2345` | `no_dvc` | ⑦ 开关 |
| 24 | `:2415` | `no_headroom` | ⑦ 开关 |
| 25 | `:2435` | `no_equ` | ⑦ 开关 |
| 26 | `:2453` | `float` | ⑦ 开关 |
| 27 | `:2486` | `vis_latency_ms` | ⑦ 开关 |
| 28 | `:2542` | `no_duck` | ⑦ 开关 |
| 29 | `:2558` | `no_af` | ⑦ 开关 |
| 30 | `:2601` | `cc_force_aa` | ⑧ Chromecast 开关 |
| 31 | `:2639` | `cc_show_meta` | ⑧ Chromecast 开关 |
| 32 | `:2702` | `audio_outputs` | ⑨ 跳转 |

---

## 2. 九个阶段的职责

| 阶段 | 行区间 | 职责 |
| --- | --- | --- |
| ① 参数 | `:497-566` | 读 `device`/`uniqName`，校验，解析插件 |
| ② 标题 | `:660-760` | 用 `pa_output_<tail>` 与 `device_<name>` 拼页面标题 |
| ③ 提示 | `:800-880` | 两段说明文字（Hi-Res 无 DVC / 格式影响） |
| ④ 输出开关 | `:884-1100` | 输出启用、Chromecast 按钮配置 |
| ⑤ 音频参数 | `:1180-1900` | **缓冲、采样率、格式、位深**（核心区，720 行） |
| ⑥ 恢复 | `:2260-2300` | 格式变更提示 + 恢复默认 |
| ⑦ 开关组 | `:2300-2600` | **8 个 DSP 抑制/行为开关** |
| ⑧ CC 开关 | `:2600-2680` | Chromecast 专属两项 |
| ⑨ 跳转 | `:2690-2725` | 回 `audio_outputs` 页 |

---

## 3. ★ 与插件命名的呼应

阶段②的两个键**正是第八篇的命名约定**：

```
"pa_output_" + <uniqName 尾段>   →  插件显示名（如 pa_output_athd）
"device_"    + <设备名>          →  设备显示名（如 device_usb）
```

> 页面标题 = **插件名 + 设备名**，例如 "OpenSL ES Hi-Res Output · USB DAC"。
> 这与第三篇的插件列表页（只显示插件名）不同——设备选项页需要**同时表明设备上下文**。

---

## 4. 阶段⑤ 为什么占 720 行

音频参数区是**条件最密集**的区域：

| 参数 | 依赖 |
| --- | --- |
| `buffer_size` | 插件类型（AAudio/OpenSL/Java） |
| `sample_rate` | 插件能力 + 设备能力 |
| `sample_fmt` / `sample_bits_static` | 高解析支持与否 |

> 第七篇看到的 `31 个偏好键` 与本篇 `32 个`的差异：
> 因本篇按 `z()` **单一方法**统计，第七篇统计的是整类。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **阶段顺序 = 用户阅读顺序** | 先参数后细节，符合自上而下阅读 |
| A2 | **标题组合插件名+设备名** | 消除"这是哪个设备"的歧义 |
| A3 | **8 个开关集中在⑦** | 同类项聚合，易于扫视 |
| A4 | **Chromecast 单独成段**（④⑧） | 它与其他后端差异最大 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 单方法 2226 行未拆分 | 无法分段测试 |
| N2 | Chromecast 逻辑散在④与⑧两处 | 上下文割裂 |
| N3 | 阶段边界只能靠键位置推断 | 无显式注释 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~阶段⑤ 720 行分支~~ | ✅ **已闭合**（三十一）：仅 5 键/35 if/**0 次 `w()`**，主体是 `NumberListPreference` 装配 |
| ~~Q2~~ | ~~`oem_variant` 作用~~ | ✅ **已闭合**（二十八）：掩码 bit18，64 位能力标志命中时改标题 |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| `z()` 方法边界 | `preference/c1.smali:497-2723` |
| 参数读取 | `c1.smali:508`（`device`）、`:536`（`uniqName`） |
| 标题键 | `c1.smali:672`（`pa_output_`）、`:688`（`device_`） |
| 提示键 | `c1.smali:820`、`:830` |
| 输出开关 | `c1.smali:884`、`:939` |
| Chromecast 段 | `c1.smali:992-1020`、`:2601-2639` |
| 音频参数 | `c1.smali:1213`、`:1458`、`:1487`、`:1837`、`:1864` |
| 开关组 | `c1.smali:2304-2558`（8 个） |
| 跳转 | `c1.smali:2702`（`audio_outputs`） |

> 口径：**build-1025**。
