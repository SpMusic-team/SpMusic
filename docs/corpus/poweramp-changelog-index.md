---
doc_id: "ARCH-POWERAMP-CHANGELOG-INDEX"
title: "版本更新逐条逆向：总索引（12 个版本区块 / 149 条）"
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
  - "docs/corpus/poweramp-release-changelog.md"
---

# 版本更新逐条逆向：总索引

## 0. 规模与口径

| 项 | 数量 |
| --- | ---: |
| 版本区块 | **12** |
| 顶层更新条目 | **149** |
| 带设置深链的条目 | 66（分布在 23 个设置页） |
| 已由既有 idea 文档覆盖 | 8 |
| **本轮需逆向** | **141** |

### 0.1 ★ 核心约束：changelog 资源本身按版本分档

> **本项工作最关键的技术事实**（实测 strings.xml 得出）。

| changelog 资源键 | build-1025 | build-1035 |
| --- | :---: | :---: |
| `changelog_971` / `978` / `978_fp` / `989` / `989_2` | ✅ | ✅ |
| `changelog_992` / `997` / `1000` / `1003` / `fp1_changelog_content` | ✅ | ✅ |
| **`changelog_102x`（1026-1032，41 条）** | ❌ **不存在** | ✅ |
| **`changelog_103x`（1033+，7 条）** | ❌ **不存在** | ✅ |

**含义**：

| 条目所属 build | 可在哪个 APK 里找实现 |
| --- | --- |
| 971 – 1025（**101 条**） | ✅ build-1025（`.rea-analysis/smali/`、`.rea-analysis/decoded/`） |
| **1026 – 1032（41 条）** | ⚠️ 只能查 build-1035（`.rea-analysis/v1035/`） |
| **1033 – 103x（7 条）** | ⚠️ 只能查 build-1035 |

### 0.2 四条可逆向性分级

| 情形 | 可逆向性 | 处理方式 |
| --- | --- | --- |
| 条目在对应版本之前引入且仍存在 | ✅ **可定位** | 给出 smali 文件:行号 |
| 条目晚于 1025 但在 1035 存在 | ⚠️ **可定位（1035）** | 标注版本并给 1035 路径 |
| 条目是纯行为调整（"improved X"/"fixed Y"） | ⚠️ **难精确对应** | 说明可能涉及的模块 |
| 笼统项（bug fixes / translations / optimizations） | ❌ **无可定位实现** | 明确标注 |

### 0.3 分类依据

149 条按功能领域分为 6 组（分类脚本输出已用毕并清理，不保留）：

| 领域 | 条数 | 专文 |
| --- | ---: | --- |
| 音频输出与解码 | **36** | `poweramp-changelog-audio-output.md` |
| UI 与皮肤 | **29** | `poweramp-changelog-ui-skin.md` |
| 库、列表与扫描 | **25** | `poweramp-changelog-library.md` |
| 耳机/蓝牙 | **15** | `poweramp-changelog-headset-misc.md` |
| 播放控制 | **4** | 同上 |
| 设置与杂项 | **40** | 同上 |
| **合计** | **149** | |

---

## 1. 12 个版本区块一览

| 区块 | 资源键 | 条目 | 深链 | 主题 |
| --- | --- | ---: | ---: | --- |
| Builds 971–977 | `changelog_971` | 7 | 2 | Media Buttons 分类跳转、可视化延迟、OP 高刷、Spinorama |
| Builds 978 附加项 | `changelog_978` | 19 | 14 | **条目最多**：tracker 格式、Uberpatron、蓝牙忽略、大库优化 |
| Builds 978–988 | `changelog_978_fp` | 6 | 6 | **Feature Package 引入** |
| Builds 989–991 | `changelog_989` | 8 | 5 | 系统栏隐藏、DVC Android 15、GC4A 2.0 |
| Builds 989–991 Also | `changelog_989_2` | 12 | 0 | 大列表性能、audio routing 重构、Target SDK 35 |
| Builds 992–996 | `changelog_992` | 12 | 4 | **Add to Playlist 三模式**、文件访问保留、Duck Volume |
| Builds 997–999 | `changelog_997` | 10 | 3 | 16KB page、Hi-Res Android 15、Strict Resume |
| Builds 1000–1001 | `changelog_1000` | 6 | 1 | 第 1000 个 build 里程碑 |
| Builds 1002–1025 | `changelog_1003` | 13 | 9 | **自定义按钮行**、repeat 改进、skin 选项 |
| **Builds 1026–1032** | `changelog_102x` | **41** | 13 | **音频引擎大版本**（USB Exclusive / Bit Perfect / DSD） |
| Builds 1033–10xx | `changelog_103x` | 7 | 2 | Blended 皮肤、AVRCP genre、Low Pass 增益修正 |
| Feature Package #1 | `fp1_changelog_content` | 8 | 7 | 特性包内容清单 |
| **合计** | | **149** | **66** | |

> **Builds 1026–1032 占 41 条**（27%），且几乎全是新功能——
> 但该版本**晚于可用 APK 1025**，多数条目只能标注为"晚于可分析版本"。

---

## 2. 交付文档（已完成）

| 领域 | 专文 | 条数 | 找到 | 未找到/仅原生 | 行数 | open_items |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 音频输出与解码 | `poweramp-changelog-audio-output.md` | 36 | **29** | 7 | 643 | 2 |
| UI 与皮肤 | `poweramp-changelog-ui-skin.md` | 29 | **24** | 1（+1 部分） | 1516 | 5 |
| 库、列表与扫描 | `poweramp-changelog-library.md` | 25 | **21** | 1（+2 硬边界） | 520 | 6 |
| 耳机蓝牙 + 播放控制 + 设置杂项 | `poweramp-changelog-headset-misc.md` | 59 | **30** | 8（+5 部分） | 535 | 13 |
| **合计** | | **149** | **104** | **17** | **3214** | **26** |

### 2.1 覆盖率说明

| 口径 | 数值 |
| --- | ---: |
| 找到实现 | **104 / 149 = 70%** |
| 未找到 / 仅原生 | 17 |
| 笼统或无独立实现 | 28（bug fixes / translations / FP 清单重复） |

> 注：各篇统计口径略有差异（有的把"部分找到"单列）。
> **104 条找到**是四篇的保守合计，不含"部分找到"。

另有 **残余项再闭合专文**：`poweramp-changelog-residual-closure.md`——
再闭合 4 项（`anim_speed` 的 Z 参数、`vis_latency_ms` 链路、`MilkLoader.O` 缓存、组件单选启用）。

另有 **深链锚点验证专文**：`poweramp-changelog-link-anchor-verify.md`——
59 个带锚点深链的落点核查（46 命中 / 13 有解释）。

---

## 3. 与既有文档的分工

8 条已被既有 idea 文档逆向，本轮**只做索引引用，不重复逆向**：

| 更新项 | 既有专文 |
| --- | --- |
| Bit Perfect / USB Exclusive | `poweramp-impl-idea40-bit-perfect.md` |
| Customizable Player Screen Buttons | `poweramp-impl-idea15-custom-buttons.md` |
| Multiple items dragging | `poweramp-impl-idea54-multi-drag.md` |
| Add to Playlist 三种模式 | `poweramp-impl-idea58-insert-position.md` |
| Repeat 模式文案 | `poweramp-impl-idea11-repeat-wording.md` |
| 设备优先输出菜单 | `poweramp-impl-idea39-device-first-output.md` |
| Synced Lyrics | `poweramp-impl-idea57-synced-lyrics.md` |
| Player Screen 表述统一 | `poweramp-impl-idea55-player-screen.md` |

插件系统基础机制另有 40 篇专文，见 `poweramp-plugin-system-index.md`。

---

## 4. changelog 里的设置深链（66 个，23 个目标页）

深链格式：`settings/<xml-page>#<android:key>`，可直接定位到偏好定义。

| 目标页 | 引用次数 |
| --- | ---: |
| `ui_player` | 12 |
| `headset` | 7 |
| `audio_bit_perfect` | 5 |
| `feature_packages` | 4 |
| `ui_theme` | 4 |
| `ui` | 4 |
| `vis` / `aa_bg` / `library_lists` / `audio_output_device_opts` / `audio_dvc` | 各 3 |
| `library_queue` / `audio_focus` / `audio_output` | 各 2 |
| 其余 11 个页 | 各 1 |

> 深链是**最直接的逆向入口**——把 `#key` 拿到对应 XML 里搜即可定位偏好定义。

---

## 5. 已知的元数据缺口

| 缺口 | 影响 |
| --- | --- |
| **build 1004–1025 无独立 changelog** | APK 内只有 `changelog_1003`（覆盖 1002-10xx）与 `changelog_102x`（1026+），中间无条目 |
| **`changelog_1017` 是空占位** | 实测内容仅 47 字符：`<b>Builds 10xx-10xx:</b> <ul> </ul>` —— 印证 1004-1025 无更新条目 |
| 论坛文件页版本列表为存档 | 只能看到版本号，无逐条更新正文 |

---

## 6. 相关文档

| 文档 | 关系 |
| --- | --- |
| `poweramp-release-changelog.md` | **原始 changelog 母文档**（149 条正文来源） |
| `poweramp-impl-index.md` | 8 篇已实现投票总览 |
| `poweramp-feature-votes.md` | 投票清单母文档 |
| `poweramp-plugin-system-index.md` | 40 篇插件系统专文 |
| `poweramp-settings-root-structure.md` | 设置树根索引 |
| `poweramp-corpus-conventions.md` | 引用体系与版本域（必读） |

> **实现口径**：build-1025（`.rea-analysis/smali/`、`.rea-analysis/decoded/`）；
> **1026+ 条目**：build-1035（`.rea-analysis/v1035/`）。
> 引用 `ׅ/` 系列路径时对应 1035，不可与 1025 混用。
