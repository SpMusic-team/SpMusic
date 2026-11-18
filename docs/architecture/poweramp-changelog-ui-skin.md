---
doc_id: "ARCH-POWERAMP-CHANGELOG-UI-SKIN"
title: "Poweramp changelog「UI 与皮肤」29 条逐条逆向（build-1025 主域 / build-1035 补域）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni + build-1035-bundle-play（跨版对照，逐条标注口径）"
revision: 1
open_items: 1
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逆向 changelog 中「UI 与皮肤」类 29 条，逐条给出实现位置与机制"
  - ".rea-analysis/_changelog_items.json :: groups[UI皮肤] 数组（29 条，本次条目的唯一清单来源）"
  - ".rea-analysis/decoded/res/values/strings.xml :: changelog_971 / changelog_978 / changelog_978_fp / changelog_989 / changelog_992 / changelog_1003 原文（build-1025）"
  - ".rea-analysis/v1035/decoded/res/values/strings.xml :: changelog_102x / changelog_103x 原文（build-1035 独有，1025 侧不存在）"
  - ".rea-analysis/decoded/res/values/arrays.xml :: changelog_content 区块顺序（build-1025，:96-104）"
  - ".rea-analysis/decoded/res/xml/{poweramp_builtin_skins,ui,ui_player,vis,aa_bg,ui_lyrics,feature_packages,ui_mediaactions}.xml :: 偏好声明原文"
  - ".rea-analysis/v1035/decoded/res/xml/{poweramp_builtin_skins,vis,ui,ui_player,aa_bg,ui_lyrics,widget_4x2_cover,widget_4x4_cover,widget_samsung}.xml :: 1035 侧对照"
  - ".rea-analysis/v1035/decoded/AndroidManifest.xml :: Samsung Flip cover widget 注册"
  - ".rea-analysis/smali/smali/com/maxmpz/widget/player/{h0,AnimTimeHelper,o2,MilkWidget,MilkWidget}.smali :: 偏好键到运行时消费点"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/{common/j,preference/j0,preference/k0,preference/c3,preference/v1,preference/SettingsActivity,preference/ColorPreference,preference/UberLevelPref,preference/BuyUberPref,widget/AmbilwarnaLayout,widget/MarqueeFastTextView,widget/g,list/n0,list/j0,list/A,list/ListWidget,list/q,prefs/V,prefs/B,player/b0,player/H,player/PlayerService}.smali"
  - ".rea-analysis/v1035/decoded/smali/ :: com/maxmpz/audioplayer/{common/BaseMainActivity,MainActivity,player/InternalAPIReceiver,preference/SkinImportSettingsPreference,preference/SkinExportSettingsPreference,preference/SkinGearRadioPreference,widgetpackcommon/Widget4x2ProviderCover}.smali + 混淆类 td1/ed1/dd1/kd1/mj/mr/z61/y61/w81/vr"
  - ".rea-analysis/smali/smali/com/maxmpz/widget/player/{h0,AnimTimeHelper,o2,MilkWidget}.smali :: 偏好键到运行时消费点"
  - "docs/architecture/poweramp-plugin-system-index.md :: 40 篇插件系统专文总览"
  - ".rea-analysis/v1035/decoded/smali/ :: com/maxmpz/audioplayer/{common/BaseMainActivity,MainActivity,player/InternalAPIReceiver,preference/SkinImportSettingsPreference,preference/SkinExportSettingsPreference,preference/SkinGearRadioPreference,widgetpackcommon/Widget4x2ProviderCover}.smali + 混淆包 ׅ/ 下的 td1/ed1/dd1/kd1/mj/ar"
  - "docs/architecture/poweramp-skin-system.md / poweramp-skin-parsing-chain.md / poweramp-skin-overlap-apply.md :: 皮肤解析与 overlapAttr 基础机制（本文引用，不重述）"
  - "docs/architecture/poweramp-impl-idea15-custom-buttons.md :: Customizable Player Screen Buttons（已覆盖，本文不重做）"
  - "docs/architecture/poweramp-look-and-feel-settings.md / poweramp-visualization-settings.md / poweramp-background-settings.md :: 外观/可视化/背景分支既有结构文档"
  - "docs/architecture/poweramp-settings-fragment-dispatch.md :: f0 分发表（用于说明 helper 归属）"
---

# Poweramp changelog「UI 与皮肤」29 条逐条逆向

## 0. 一句话结论

**29 条中 24 条找到了可复核的实现（其中 5 条只在 build-1035 中存在，晚于 1025），1 条穷尽排查后未定位，1 条只部分成立，2 条为主动不重做的已覆盖条目，4 条是同一实现在 FP 清单中的重复陈述。**

- 「找到实现」24 条的分解：
  - **19 条**在 **build-1025** 里同时具备「XML 偏好声明 + smali 消费点」双重证据；
  - **5 条**属 `changelog_102x` / `changelog_103x` 区块（构建号 1026+，**晚于 build-1025**），
    只在 **build-1035** 中定位到：#20 Samsung Flip widgets、#21 皮肤作者保护/可选校验、
    #22 皮肤设置 JSON 导出导入、#24 Blended 皮肤选项、#23 Uberpatron 政策陈述（部分成立）。
- 其余 5 条：#2 穷尽排查后**未定位**（§3.1）；#15/#25 为**主动不重做**的已覆盖条目（§3.2）；
  #26/#27/#28/#29 是 #12/#11/#9/#10 同一实现在 FP 清单里的**重复陈述**（§1 去重说明）。

> **换算**：17(1025) + 5(1035) + 2(已覆盖) + 1(未定位) + 4(重复) = 29。

| 分组 | 条目 | 计数 |
| --- | --- | ---: |
| build-1025 有完整双重证据 | #1,3,4,5,6,7,8,9,10,11,12,13,14,16,17,18,19 | **17** |
| build-1035 独占 | #20,21,22,23,24 | **5** |
| 已覆盖不重做 | #15,25 | **2** |
| 未定位 | #2 | **1** |
| FP 清单重复陈述 | #26,27,28,29 | **4** |
| **合计** | | **29** |

---

## 1. 逐条逆向表

图例：
- **口径**列 —— `1025` = build-1025 产物（`.rea-analysis/decoded/` + `.rea-analysis/smali/smali/`）；
  `1035` = build-1035 产物（`.rea-analysis/v1035/decoded/`）。
- 行首 # 为本文自编号（与 JSON 数组下标一致，便于对数）。
- 若某条在原文 changelog 里是**一条含多个子项**的条目（如三合一 Background Gradient），
  表中仍按 1 条计，但在「机制」列内逐子项给出位置。

### 1.1 总表

| # | 更新原文（区块 / 摘要） | 实现位置 | 口径 |
| ---: | --- | --- | --- |
| 1 | `971` prev./next category actions for Media Buttons | `decoded/res/xml/ui_mediaactions.xml:6,10`；`decoded/res/values/arrays.xml:727-751,764-776`；`player/H.smali:1071,1087`；`player/PlayerService.smali:1210,9479` | 1025 |
| 2 | `971` visualization latency 也应用到 lyrics | **未找到实现**（见 §3.1） | — |
| 3 | `978` cosmetic Uberpatron badges | `decoded/res/xml/feature_packages.xml:14,15,16`；`preference/UberLevelPref.smali:151`；`prefs/B.smali:172` | 1025 |
| 4 | `978` predictive back animation on Android 14+ | `decoded/AndroidManifest.xml`（`enableOnBackInvokedCallback="true"`）；`widget/base/О.smali:28,49,58,78,178` | 1025 |
| 5 | `978` Full Cover / Centered skin options 更多标签空间 | `poweramp_builtin_skins.xml:13,17,80,84`；`styles.xml:13358-13375` | 1025 |
| 6 | `978` Visualizations / Ignore Touch | `decoded/res/xml/vis.xml:12`；`h0.smali:864,870`；`o2.smali:797,804,815` | 1025 |
| 7 | `978` Background Gradient / Color / For Lists（3 选项） | `decoded/res/xml/aa_bg.xml:8,9,10`；`h0.smali:1199,1209,1219`；`MilkWidget.smali:1063-1122`；`j0.smali:448,458,468` | 1025 |
| 8 | `978` Keep screen on for the lyrics | `decoded/res/xml/ui_lyrics.xml:11`；`h0.smali:1239,1247`；`list/q.smali:1785,1791` | 1025 |
| 9 | `978_fp` Line2 Press / Line2 Long Press | `ui_player.xml:25,26`；`prefs/В.smali:1793,1811,1813,1827`；`list/А.smali:110,142`；`list/ListWidget.smali:237,269` | 1025 |
| 10 | `978_fp` Animations（`anim_speed`） | `ui.xml:18`；`arrays.xml:67-76`；`h0.smali:844,862`；`AnimTimeHelper.smali:42-152` | 1025 |
| 11 | `989` Hide System Bars For Full Screen | `vis.xml:14`；`h0.smali:1271,1287`；`p2.smali:172,204,224` | 1025 |
| 12 | `989` Menu Button Long Press | `ui_player.xml:22`；`h0.smali:1289,1303`；`list/А.smali:1155,1181,1186` | 1025 |
| 13 | `992` Bold+ font for Settings | `ui.xml:7`；`arrays.xml:883-888`；`prefs/В.smali:1127,1133`；`SettingsActivity.smali:816,829,834,839,844` | 1025 |
| 14 | `992` improved compatibility with the old 3rd party skins | `common/j.smali:2066-2093` | 1025 |
| 15 | `1003` customizable buttons row on the player screen | **已覆盖**（`poweramp-impl-idea15-custom-buttons.md`），本文不重做 | — |
| 16 | `1003` Player Buttons Background | `poweramp_builtin_skins.xml:23,25,90,92`；`attrs.xml:3627`；`styles.xml:415-417` | 1025 |
| 17 | `1003` Label Background 不再改屏幕背景 | `poweramp_builtin_skins.xml:18,20,85,87`；`styles.xml:505-509,14280-14287` | 1025 |
| 18 | `1003` Animate Long Labels Everywhere | `ui_player.xml:6,7`；`h0.smali:648,1481`；`common/j.smali:526-550` | 1025 |
| 19 | `1003` Dark Skin Transparent Status Bar | `poweramp_builtin_skins.xml:124,128`；`styles.xml:19037-19039` | 1025 |
| 20 | `102x` Samsung Flip widgets for cover screens | `v1035/decoded/AndroidManifest.xml:154,158,159,166,170,171`；`widget_samsung.xml:2`；`Widget4x2ProviderCover.smali:1,48,63` | **1035** |
| 21 | `102x` skin authors 保护/可选校验 | `InternalAPIReceiver.smali:248,297,361,493`；`SkinGearRadioPreference.smali:79,339` | **1035** |
| 22 | `102x` 3rd-party 皮肤设置 JSON 导出/导入 | `SkinExportSettingsPreference.smali:23,618`；`SkinImportSettingsPreference.smali:23`；`ed1.smali:52,80`；`dd1.smali:131,146,179`；`kd1.smali:2305-2448` | **1035** |
| 23 | `102x` 全部新功能已并入 base app，可买 Uberpatron 支持 | `feature_packages.xml:14`；`v1035 strings.xml`（`uber_support1/2/3`） | 1025+1035（部分成立，见 §4.3-Q4） |
| 24 | `103x` Blended 皮肤选项 | `v1035 poweramp_builtin_skins.xml:12,13,81,82`；`attrs.xml:2968,2977`；`styles.xml:2029,2030,9637,9638,14844,14853`；`BaseMainActivity.smali:121,128,140,168`；`MainActivity.smali:140` | **1035** |
| 25 | `fp1` customizable Player Screen Buttons | **已覆盖**（同 #15） | — |
| 26 | `fp1` Menu Button Long Press | 同 #12（FP 清单重复陈述） | 1025 |
| 27 | `fp1` Hide System Bars For Full Screen | 同 #11 | 1025 |
| 28 | `fp1` Line2 Press / Line2 Long Press | 同 #9 | 1025 |
| 29 | `fp1` Animations | 同 #10 | 1025 |

> **去重说明**：#26/#27/#28/#29 与 #12/#11/#9/#10 是**同一实现**在
> `changelog_989`/`changelog_978_fp` 两个区块的重复陈述（前者写「new option」，
> 后者写「FP#1 内容清单」）。`poweramp_builtin_skins.xml` 与 `ui_player.xml` 中均只有一个同名 key。
> 因此 29 条对应 **24 个独立实现点 + 1 条已覆盖 + 1 条未找到（#2）**，
> 其中 4 个实现点被 FP 清单重复计数。

---

### 1.2 逐条展开

### 1.2-1（#1）prev./next category actions for Media Buttons

**XML**：`decoded/res/xml/ui_mediaactions.xml` 整个文件只有 6 个 `notify_actionN`
（`:6-13`）与 1 个提示行（`:4`）。实测两版**字节完全相同**（`=== ` 为 true），
说明这不是 1025 之后才改的结构 —— **新增的是枚举项，不是控件**。

**新增枚举项**（`decoded/res/values/arrays.xml`）：

```
727: <string-array name="pref_notify_actions_entries">   // 共 11 项
737:   <item>@string/h_prev_list</item>                  // "Prev. category"
738:   <item>@string/h_next_list</item>                  // "Next category"
764: <integer-array name="pref_notify_actions_values">   // 共 11 项
774:   <item>10</item>                                   // h_prev_list
775:   <item>9</item>                                    // h_next_list
740: <array name="pref_notify_actions_icons">
750:   <item>@drawable/v_prev_cat_android</item>
751:   <item>@drawable/v_next_cat_android</item>
```

> **「新增取空号、不重排」的第二处实证**：`minus_10`/`plus_10` 用的值分别是
> `8`/`7`（`arrays.xml:772-773`），而 Prev/Next 用了 `10`/`9`（`:774-775`）。
> 即 value 7/8 先被 plus/minus 10 秒占据，新增两项时取剩余空号，
> **老用户已保存的偏好值语义完全不变**。这与 `poweramp-impl-index.md` §3 记录的模式一致。

**运行时分发**：`smali/.../audioplayer/player/H.smali`（MsgBus 分发器）按 message id 分支：

| 行 | 内容 |
| ---: | --- |
| `:1071` | `const v10, 0x7f0d00dc` = `cmd_player_play_next_category` |
| `:1087` | `const v10, 0x7f0d00dd` = `cmd_player_play_prev_category` |
| `:1124` | `const v10, 0x7f0d00de` = `cmd_player_play_first_category` |
| `:1093` | `invoke-virtual {v0}, ...b0;->supportsCategoryNavigation()Z`（prev 分支守卫） |
| `:1130` | 同上（first-category 分支守卫） |
| `:1170` | `const v1, 0x7f080288` = `@string/jumped_to_first_category`（Toast） |

id 名称出处：`decoded/res/values/public.xml:8912-8913`（`cmd_player_play_next_category` / `..._prev_category`）。

**核心调用**：`smali/.../player/PlayerService.smali`

```
1195: .method public final F(I)V                         // next category 入口
1210:   invoke-virtual {v0, v1}, ...b0;->nextCategory(Z)I // v1 = 1（跳过当前）
1218:   const-string v8, "playNextCategory"               // 统计/日志标签
1226:   invoke-virtual/range {v2 .. v8}, ...PlayerService;->L(IIIIILjava/lang/String;)I

9479:   invoke-virtual {v2}, ...b0;->prevCategory()I
9487:   const-string v7, "playPrevCategory"
9493:   invoke-virtual/range {v1 .. v7}, ...PlayerService;->L(IIIIILjava/lang/String;)I
```

**前置守卫**：`.../player/b0.smali:8198` `supportsCategoryNavigation()Z` ——
要求 `mCatCursor != null` 且 `modesSupportCategoryNavigation(mShuffle)`（`:8201-8207`），
**或**处于 queue 模式（`:8214-8218`）。

> **这意味着这两个媒体按钮在不支持分类导航的上下文会静默失效**（无 Toast、无日志）。

**注意 `prevCategory` 有两个入口**：`player/b0.smali:4045` 的 `private prevCategory(Z)I`
与 `:7604` 的 `public prevCategory()I`（后者 `:7616` 转调前者）。

---

### 1.2-2（#2）visualization latency is now also applied to lyrics

**未找到实现。** 完整排查范围、已定位到但不足以证成的相关物、以及两种可能解释，
见 **§3.1**（避免此处与 §3.1 重复 200 行）。

---

### 1.2-3（#3）cosmetic Uberpatron badges

**XML**：`decoded/res/xml/feature_packages.xml:13-17`（`other` 分类内）

```
14: <...BuyUberPref android:icon="@drawable/settings_uberpatron_colored"
                   android:title="@string/buy_uber_badges" android:key="buy_uber_badges" />
15: <...UberLevelPref android:icon="@drawable/transparent_nothing"
                     android:key="uber_level" w:zeroTopPad="true" />
16: <...RawTextPreference w:line1="@string/uber_support1"
        w:line2="@string/uber_support2" w:line3="@string/uber_support3" />
```

**文案自证「纯外观」**（`decoded/res/values/strings.xml`）：

| 键 | 值 |
| --- | --- |
| `uber_support1` | ● support Poweramp development |
| `uber_support2` | ● get Uberpatron Edition Badges |
| `uber_support3` | **● currently these are purely cosmetic items** |
| `buy_uber_badges` | Buy Uberpatron Badges |

**徽章渲染**：`smali/.../preference/UberLevelPref.smali`（493 行）

| 行 | 内容 |
| ---: | --- |
| `:1-2` | `extends RawTextPreference`（一个富文本偏好项，不是独立控件树） |
| `:151` | `X()V` —— 重建徽章文本 |
| `:158-164` | 取 `prefs/B.b()` 得到的等级数 |
| `:166-188` | `>0` 时输出 `x<N>` 形式，否则输出 `0` |
| `:205-215` | `>= 0x32`（50）时在徽章前加换行 |
| `:240-246` | 模板 `0x7f0808bf` = `@string/uberpatron_badges_purchased_s` |
| `:252-310` | `>=2` 时对数字串套 `RelativeSizeSpan`（`0.1*n` 取整 +1.0）逐级放大 |
| `:313-317` | 套 `StyleSpan(BOLD)` |
| `:65-114` | `access$anim2`：`scaleX/scaleY` 从 0 弹到 1，`250ms`（`0xfa`） |

**等级来源**：`smali/.../audioplayer/prefs/B.smali`（拉丁大写 B，与下面提到的西里尔 `с` 不同文件）

```
172: .method public static b()I
175:   sget-object v0, ...prefs/B;->c:...r;
179:   sget-object v1, ...prefs/B;->с:...r;      // ← 西里尔小写 es (U+0441)
183:   add-int/2addr v0, v1                     // ★ 两个独立计数项相加
185:   return v0
```

> **两个字段名只差一个 Unicode 码点**：`c` = U+0063 拉丁小写 c，`с` = U+0441 西里尔小写 es。
> 这是 obfuscator 的典型产物（见 `poweramp-corpus-conventions.md` §4）。
> **语义推测（未验证）**：两个计数可能是「Google Play 侧」与「RuStore/Huawei 侧」等级分别累加 —— 依据是
> `already_purchased.xml:5,7,8` 有三个渠道并列的恢复购买项。

**购买入口**：`preference/BuyUberPref.smali:1,42,64`；
回调在 `preference/A.smali:425-427`（读 `h` 字段）。

---

### 1.2-4（#4）predictive back animation on Android 14+

**Manifest 开关**（`decoded/AndroidManifest.xml` 的 `<application>` 行）：

```
android:enableOnBackInvokedCallback="true"
```

> 注意：该属性在 **build-1025 与 build-1035 均存在**，不是 1035 新增。

**实现**：`smali/.../widget/base/О.smali`（273 行；O 为西里尔大写 O，U+041E）

| 行 | 内容 |
| ---: | --- |
| `:28-61` | `<clinit>`：`P = (SDK_INT >= 33)`（`0x21`）、`р = (SDK_INT >= 34)`（`0x22`） |
| `:70-91` | 构造：`р` 真 → `widget/base/P`（`:74-76`）；否则 `P` 真 → `androidx/activity/e`（`:85-89`）；否则 null |
| `:97` | `iput-object p1, ...->x:Landroid/window/OnBackInvokedCallback;` |
| `:156-178` | 注册：`P` 且 SDK≥33 → `registerOnBackInvokedCallback(0, x)` |
| `:184-226` | `Х()` 注销 + 回收 `VelocityTracker` |

> **三级降级是本条的实现本质**：
> API 34+ 走专用实现类 `widget/base/P`（`widget/base/P.smali:84` `onBackInvoked()V`），
> API 33 走 `androidx.activity` 兼容回调，API < 33 走传统 `onBackPressed`
> （`x` 字段为 null，`:94-97`）。
> **Predictive back 的「动画」由系统的 `OnBackInvokedDispatcher` 提供，
> 应用侧只负责「把返回手势接进自己的栈管理」，没有自绘动画代码。**

---

### 1.2-5（#5）Full Cover, Centered skin options - more room for labels

**XML**（`decoded/res/xml/poweramp_builtin_skins.xml`，同名节点出现两次，Light/Black 各一份）：

```
13: <multiSwitch dependency="alt_layout" key="track_labels_align" name="@string/track_labels">
15:   <option name="@string/centered" overlapAttr="@attr/overlap_track_labels_centered" />
17: <msg align="top" icon="@drawable/centered_layout" iconAlign="top"
        line1="@string/centered" smallLine1="@string/applied_for_alt_full" />
```

Black 皮肤为 `:80-84`，结构完全一致。

**「more room for labels」的证据在提示文案**：

| 键 | build-1025 | build-1035 |
| --- | --- | --- |
| `applied_for_alt_full` | `Applied for Alternative layout/Full cover` | **`Applied for Alternative layout, Full cover, and Blended`** |

> 1035 新增 Blended 后把同一提示扩写 —— 说明这行提示本身就是 978 那次调整的产物。

**样式层**：`decoded/res/values/styles.xml:13358-13375` `Base_Alt2_TrackLabelsCentered`
把 `ItemTrackTitle_scene_aa` / `ItemTrackLine2_scene_aa` / `ItemTrackMenu_scene_aa` /
`ItemLikeUnlikeLayout*` / `ItemRatingBar*` / `ItemTrackLyrics_scene_aa` 全量重绑
（共 13 条 `<item>`）—— 即「居中排布时重新分配标签与按钮槽位」。

> **行号跨版差异**：同一 style 在 build-1035 对应 `styles.xml:12094-12111`，
> 内容逐条比对**完全一致**，仅行号不同。

---

### 1.2-6（#6）Visualizations / Ignore Touch

**XML**：`decoded/res/xml/vis.xml:12`

```
12: <...MultilineSwitchPreference android:title="@string/ignore_touch"
        android:key="vis_ignore_touch_faded"
        android:summary="@string/ignore_first_touch_in_fade_controls" />
```

- `ignore_touch` = `Ignore Touch`
- `ignore_first_touch_in_fade_controls` = `Ignore first touch in Fade Controls mode`
- **key 带 `_faded` 后缀，title 用短名 `ignore_touch`** ——
  检索时若只搜 `vis_ignore_touch` 在 XML 里会只命中 key 不命中 title。

**偏好存储**：`smali/.../widget/player/h0.smali:864-870` → 静态字段 `o0`（bool，默认 `v4`=false）。
（`h0` 的全限定父类是 `Lcom/maxmpz/preference/fastprefs/m;`，即 FastStaticPrefs 的一套 view-model。）

**消费点**：`smali/.../widget/player/o2.smali`（`o2 extends p2`，玩家界面触摸层，6219 行）

| 行 | 内容 |
| ---: | --- |
| `:652` | `.method public final O(Landroid/view/MotionEvent;)Z` —— 触摸分发 |
| `:655` | `iget v0, ...o2;->О:I` —— 控件淡出状态机 |
| `:702-706` | 状态为 4（已淡出）或 3（将淡出） |
| `:709-733` | 对 `J` 视图做 `isAttachedToWindow` / `isShown` / `getAlpha() > 0` 三重检查 |
| `:735-779` | 用 `getRawX/getRawY` + `getLocationOnScreen` 做命中测试 |
| `:790-801` | **未命中控件**时读 `h0->o0`（= `vis_ignore_touch_faded`） |
| `:803-804` | 开关打开 → `const/4 v3, 0x1`（消费本次触摸） |
| `:813-815` | `if-eqz v3` → `invoke-virtual {p0}, ...o2;->К()V` |
| `:4740-4780` | `К()V` = 重新排定淡出定时器（`postDelayed`，延时 = `t*1000 + h0->F`（`vis_temp_ui_ms`）） |

> **机制概括**：Fade Controls 模式下第一次点击本用于「唤出控件」，
> 打开 Ignore Touch 后这次点击被**吞掉**（返回 1，不再下发给下层视图），
> 同时重置淡出计时器。**不是禁用触摸，而是丢弃「唤醒用的那一次」。**

**同组关联键**（同在 `vis.xml`，本文顺带登记）：
`vis_panel_faded_alpha`（`:8`）、`vis_controls_faded_alpha`（`:9`）、
`vis_temp_ui_ms`（`:10`）、`vis_list_faded_alpha`（`:13`）。
四者在 `h0.smali` 中分别是 `u`/`v`/`F,G`/`w` 字段。

---

### 1.2-7（#7）Background Gradient / Color / For Lists

**XML**：`decoded/res/xml/aa_bg.xml:8-10`（三选项紧邻排列，共享一个前置提示行 `:7`）

```
7:  <...RawTextPreference w:line1="@string/pref_aa_bg_skins_hint" ... />
8:  <...SeekbarPreference title="@string/aa_bg_gradient" key="aa_bg_gradient"
        w:max="10" w:min="0" w:leftLabel="@string/none" w:rightLabel="@string/maximum_short" />
9:  <...ColorPreference    title="@string/aa_bg_gradient_color" key="aa_bg_gradient_color" summary="%s" />
10: <...MultilineSwitchPreference title="@string/aa_bg_gradient_for_list"
        key="aa_bg_gradient_for_list" summary="@string/summary_aa_bg_gradient_for_list" />
```

文案：`Background Gradient` / `Background Gradient Color` / `Background Gradient For Lists`；
`summary_aa_bg_gradient_for_list` = `Also apply background gradient for list background`。

**偏好定义**（`smali/.../widget/player/h0.smali`）：

| 行 | 键 | 类型 | 默认值 |
| ---: | --- | --- | --- |
| `:1199-1207` | `aa_bg_gradient` | `j0`（int） | **4**（`const/4 v2, 0x4`） |
| `:1209-1217` | `aa_bg_gradient_color` | `l0`（String） | **`"#FF000000"`**（`:1211`） |
| `:1219-1227` | `aa_bg_gradient_for_list` | `h0`（bool） | **true**（`const/4 v2, 0x1`） |

**设置页绑定**：`smali/.../preference/j0.smali`

| 行 | 内容 |
| ---: | --- |
| `:86` | `.method public final l()V`（页面初始化；首句 `packed-switch v0` 分三支） |
| `:371` | `:pswitch_2` = `aa_bg` 页分支（`.packed-switch 0x0` 第 3 项，`:499-504`） |
| `:448-456` | `aa_bg_gradient` → `setOnPreferenceChangeListener` |
| `:458-466` | `aa_bg_gradient_color` → 同上 |
| `:468-478` | `aa_bg_gradient_for_list` → 同上（多一层 `if-eqz v0` 判空） |

**运行时消费**：`smali/.../widget/player/MilkWidget.smali`（可视化宿主，含背景渐变）

| 行 | 内容 |
| ---: | --- |
| `:1063-1065` | 读 `h0->q0`（`aa_bg_gradient`）的 int |
| `:1067-1069` | 读 `h0->r0`（`aa_bg_gradient_color`）的 String |
| `:1071-1083` | 宿主为列表（`iget-boolean ...->K`）**且** `h0->s0`（`aa_bg_gradient_for_list`）→ 保留 |
| `:1085-1087` | 否则 `const/4 v2, 0x0`（**关闭该列表的渐变**） |
| `:1089-1091` | `invoke-static {v0, v6, v3}, ...Utils;->К(III)I` —— 三值合成为一个签名 int |
| `:1093-1112` | 与 `MilkLoader` 现存值比对，无变化则提前 `return-void` |
| `:1116-1122` | 写入 `MilkLoader->Н`(int) / `->H`(String) / `->Р`(bool) / `->O`(int) |

> **关键设计**：三选项不是「读值→画」，而是**折叠成一个签名 int 再做差量比较**
> （`:1089` `Utils.К`），只有签名变化时才重建 `MilkLoader` 状态。
> `aa_bg_gradient_for_list` 是**局部覆盖**：只在列表性宿主上生效，非列表宿主恒为关闭。
> `MilkLoader` 的四个目标字段是 `Н`(int) / `H`(String) / `Р`(bool) / `O`(int)，
> **其中一个字段同时承担「颜色失效标记」**（`:1116` 与 `:1122` 写同一个 `O`）—— 这是本文未完全展开点，见 §4.3-Q5。

---

### 1.2-8（#8）Keep screen on for the lyrics

**XML**：`decoded/res/xml/ui_lyrics.xml:11`

```
11: <...MultilineSwitchPreference android:title="@string/pref_keep_screen_on"
        android:key="lyrics_keep_screen" android:summary="@string/pref_summary_lyrics_keep_screen" />
```

- `pref_keep_screen_on` = `Keep Screen On`
- `pref_summary_lyrics_keep_screen` = `Keep screen on for the lyrics`

> **陷阱**：`ui.xml:22` 的全局 `keep_screen_on` 使用**同一 title 字符串**
> `pref_keep_screen_on`，但 key 不同（`keep_screen_on` vs `lyrics_keep_screen`）。
> **按文案检索无法区分，必须按 key 名。**

**偏好定义**：`smali/.../widget/player/h0.smali:1239-1247`（`u0`，bool，默认 `v3`=false）。

**消费点**：`smali/.../audioplayer/list/q.smali`（歌词列表页，4027 行）

```
1785: sget-object v1, ...h0;->u0:...h0;       // lyrics_keep_screen
1787: iget-boolean v1, v1, ...H;->А:Z
1789: if-eqz v1, :cond_2
1791: invoke-interface {v0, v2}, ...list/h0;->W0(Z)V   // 交给宿主 Activity 处理
```

`list/h0` 是接口，`W0(Z)V` 声明在 `smali/.../audioplayer/list/h0.smali:15`
（`.method public abstract W0(Z)V`）。第二处调用在 `list/q.smali:1872`。

> **本文未下钻到具体 Activity 实现**（`W0` 的实现类），
> 因此「FLAG_KEEP_SCREEN_ON 的加/解」落点未闭合 —— 但这不影响「选项→接口」链路成立。

---

### 1.2-9（#9）Line2 Press / Line2 Long Press

**XML**：`decoded/res/xml/ui_player.xml:25-26`

```
25: <...TagListPreference title="@string/line2_click" key="line2_click"
        w:entries="@array/pref_line2_click_entries" w:values="@array/pref_line2_click_values"
        w:summary="@string/summary_line2_click" w:icons="@array/pref_line2_click_icons" w:featurePack="1" />
26: <...TagListPreference title="@string/line2_long_click" key="line2_long_click"
        ... 同上 w:featurePack="1" />
```

**取值表**（`decoded/res/values/arrays.xml`）：

| 数组 | 行 | 内容 |
| --- | ---: | --- |
| `pref_line2_click_entries` | 638-644 | Disabled / Artist / Album / Folder / Genre |
| `pref_line2_click_icons` | 645-651 | `@null` / artists / albums / folders / genres 24dp |
| `pref_line2_click_values` | 652-658 | **0 / 1 / 2 / 3 / 4** |

> **entries 与 values 一一对应且递增**，与 #10 的 `0/2/1` 形成对照 ——
> **同样是「新增选项」，本条的取值是干净的，因为它是全新 key，无历史包袱。**

**偏好存储**：`smali/.../audioplayer/prefs/В.smali`（V 为西里尔大写 VE，U+0412）

| 行 | 内容 |
| ---: | --- |
| `:1793` | `const-string v1, "line2_click"` |
| `:1811` | `sput-object v4, ...prefs/V;->o2:...s;`（`с(ILjava/lang/String;)...j0` 转 `s`） |
| `:1813` | `const-string v4, "line2_long_click"` |
| `:1827` | `sput-object v1, ...prefs/V;->p2:...s;` |

**消费点**（同一个 msg id 两种语义）：

| 类 | 行 | msg id | 读的字段 | 动作 |
| --- | ---: | --- | --- | --- |
| `list/А.smali` | `:110` | `0x7f0d001e`（`line2`，public.xml:8722） | `prefs/V->o2`（`line2_click`） | `:142` `y0(I)V` |
| `list/ListWidget.smali` | `:237` | `0x7f0d001e` | `prefs/V->p2`（`line2_long_click`） | `:269` `y0(I)V` |

> **同一 msg id `line2` 承载两个语义**：普通点击走 `A`（列表 Fragment），
> 长按走 `ListWidget`（桌面小部件）—— 因为长按在两种宿主里都要能触发。
> **两处都做了同一套「版本门控」**：`ByteBuffer.getInt(2) >= 0 ? s->А : s->B`
> （`list/А.smali:114-140`、`list/ListWidget.smali:241-267`），
> 即 **prefs 引擎支持「主值 / 备用值」双槽并存**（`s->А` 与 `s->B`）。

---

### 1.2-10（#10）Animations（`anim_speed`）

**XML**：`decoded/res/xml/ui.xml:18`

```
18: <...TagListPreference title="@string/animations" key="anim_speed"
        summary="@string/summary_anim_speed" android:defaultValue="false"
        w:entries="@array/anim_speed_entries" w:values="@array/anim_speed_values" w:featurePack="1" />
```

| 数组 | 行 | 内容 |
| --- | ---: | --- |
| `anim_speed_entries` | 67-71 | Disabled / Fast / Default |
| `anim_speed_values` | 72-76 | **0 / 2 / 1** |

> **★ 取值是 `0,2,1` 而不是 `0,1,2`。**
> 这是「新增枚举取空号不重排」的另一种形态：`Default=1` 是最初的唯一值，
> 后加的 `Fast` 取 2，`Disabled` 取 0。
> **按「entries 下标 == values 下标」写代码会直接错位。**

**偏好定义**：`smali/.../widget/player/h0.smali:844-862`（`j0` int，默认 `v0`，字段 `n0`）。
注意 `:846-860` 先调 `с(ILjava/lang/String;)` 再 **从 `m->Х` 列表取最后一个元素**强转 `s`，
是 Kotlin 属性委托的 smali 展开形态。

**消费点**：`smali/.../widget/player/AnimTimeHelper.smali`（180 行）

```
42:  .method public static final calcAnimTime(FZ)F
54:    sget-object v0, ...h0;->n0:...s;            // anim_speed
66-82:  版本门控：ByteBuffer.getInt(2) >= 1 或 getInt(1)==4 → s->А，否则 s->B
88:    const v1, 0x3f19999a    # 0.6f
90-95:  if (v0 == 0) goto :goto_2               // Disabled 分支入口
92-100: if (v0 == 2) goto :cond_3; mul p0, 0.6f  // Fast：×0.6
102-112: else(1) 分支：if(p1) return 0.001f : return p0*0.6f

115-152: В(I)I —— 同一套逻辑的 int 版本
```

> **注意 `:102-112`**：`v0 == 1`（Default）且 `p1` 为真时返回 `0.001f`
> （**近似瞬时的最小值**）。也就是说：
>
> | anim_speed | p1=true | p1=false |
> | --- | --- | --- |
> | 0 Disabled | 原值（`p0`） | 原值 |
> | 1 Default | **0.001f** | `p0 * 0.6f` |
> | 2 Fast | `p0 * 0.6f` | `p0 * 0.6f` |
>
> **语义是「Disabled 不等于 0 时长」，真正的「零动画」由 `0.001f` 表达。**
> `p1` 的确切含义（从参数名不可知，推测为「首次进入」类标志）**未闭合**，见 §4.3-Q2。

---

### 1.2-11（#11）Hide System Bars For Full Screen

**XML**：`decoded/res/xml/vis.xml:14`

```
14: <...MultilineSwitchPreference title="@string/vis_fs_hide_bars" key="vis_fs_hide_bars"
        summary="@string/summary_vis_fs_hide_bars" android:defaultValue="false" w:featurePack="1" />
```

`summary_vis_fs_hide_bars` = `Hide status bar and navigation completely when in Full Screen mode`。

**偏好定义**：`smali/.../widget/player/h0.smali:1271-1287`
（读 `vis_fs_hide_bars` 后 `check-cast ...H;` → 字段 `y0`，bool 默认 false）。

**对外入口 `h0.b()Z`**（`h0.smali:1504-1541`）：读 `y0`，做版本门控后返回。
**4 个调用点**：

| 调用点 | 作用 |
| --- | --- |
| `widget/player/p2.smali:172` | `A()V`：全屏时隐藏系统栏 |
| `widget/player/p2.smali:635` | `х()V`：条件满足时调 `x()` |
| `widget/base/FitsNavigationBarView.smali:63` | 导航栏占位视图 |
| `widget/base/FitsStatusBarView.smali:82` | 状态栏占位视图 |

**核心实现** `p2.smali:169-245`：

```
169: .method public final A()V
172:   invoke-static {}, ...h0;->b()Z
176:   if-eqz v0, :cond_2                  // 开关关 → 直接 return
178-184: SDK_INT >= 30 (0x1e)?
186-196: rootView.getWindowInsetsController() != null?
198-202: h0->р（= hide_status_bar，h0.smali:334-340）
204-224: 计算 hide 的 InsetsType：
          р 为真 → systemBars() & ~statusBars()   // 只隐藏导航栏
          р 为假 → systemBars()                    // 两者都隐藏
224:   controller.hide(v1)
228-242: [SDK < 30 遗留分支] setSystemUiVisibility(getSystemUiVisibility() | 0x4)
```

> **★ 与 `hide_status_bar` 的耦合**：这个选项**不是无条件「全隐」**，
> 而是**先看全局 `hide_status_bar`**（`ui.xml:20` 的 `pref_hide_status_bar`）：
> - `hide_status_bar = true` → 只藏导航栏（状态栏已被全局关掉）
> - `hide_status_bar = false` → 系统栏整体隐藏
>
> **即它是 `hide_status_bar` 的「全屏模式补充」，而不是独立开关。**

---

### 1.2-12（#12）Menu Button Long Press

**XML**：`decoded/res/xml/ui_player.xml:22`

```
22: <...TagListPreference title="@string/menu_button_long_press" key="menu_button_long_press"
        summary="@string/summary_menu_button_long_press" android:dependency="hide_menu"
        w:entries="@array/menu_button_long_press_entries" w:featurePack="1" />
```

- `summary_menu_button_long_press` = `Long press action for the track menu button`
- `android:dependency="hide_menu"` —— 依赖「菜单按钮」取值（`pref_hide_menu_values` = `1,0` 反向映射，见 `arrays.xml:564-571`）
- 取值表 `menu_button_long_press_entries`（`arrays.xml:388-401`）共 **12 项**：
  Disabled / Delete / Add to playlist / Info / Album art / Artist / Album / Folder / Genre / Share / Like / Unlike

> **该数组只有 entries、没有 values**，`TagListPreference` 用下标即值
> （与 #9 的 entries+values 双数组形态不同）—— **同一控件类型两种用法并存**。

**偏好定义**：`smali/.../widget/player/h0.smali:1289-1303`（`j0` int，默认 `v3`，字段 `z0`）。

**消费点**：`smali/.../audioplayer/list/А.smali:1152-1190`

```
1152: .method public final z0()Z
1155:   sget-object v0, ...h0;->z0:...s;
1157-1188: 版本门控 → 取 s->А 或 s->B
1189:   const v2, 0x7f0d0037        // message id
1191-1194: ctx / list/h0 接口
           → 依取值走 delete / add to playlist / info / album art / artist /
             album / folder / genre / share / like / unlike
```

> `:1189` 的 `0x7f0d0037` = **`bus_data_cmd`**（`public.xml` 第 `8747` 行），
> 即**数据层命令总线**，不是 UI 事件总线 —— 这条消息走的是「命令」而非「导航」。
> 属本文未闭合点，见 §4.3-Q3。

---

### 1.2-13（#13）Bold+ font for Settings

**XML**：`decoded/res/xml/ui.xml:7`

```
7: <...TagListPreference title="@string/pref_settings_font" key="settings_font"
       android:defaultValue="2" w:entries="@array/pref_settings_font_labels" />
```

> **只有 `w:entries`，没有 `w:values`** —— 下标即值，默认 `2`（= Bold）。

**取值表**（`decoded/res/values/arrays.xml:883-888`）：

| 下标 | 文案 | 含义 |
| ---: | --- | --- |
| 0 | `@string/_default` | 默认 |
| 1 | `@string/skin_alt_font` | Alternative font |
| 2 | `@string/bold` | Bold |
| 3 | **`@string/bold_plus`** | **Bold+** ← 本条新增 |
| — | `bold_plus` = `Bold+` | （字符串本体） |

**偏好存储**：`smali/.../audioplayer/prefs/В.smali:1127-1133`（`j0`，字段 `L0`，默认 `v6`）。

**应用点（两处）**：

1. **运行时切换**：`smali/.../preference/SettingsActivity.smali:816-846`

```
816: sget-object p2, ...prefs/V;->L0:...j0;      // settings_font
818: iget p2, p2, ...s;->А:I
820-826: 与 v2(=0) / v1(=2) / v0(=3) 比较
829:   const p3, 0x7f0e0718   // Overlap_ActivityTheme_Settings_BoldPlusFont  (下标 3)
834:   const p3, 0x7f0e061d   // Overlap_ActivityTheme_Settings_BoldFont      (下标 2)
839:   const p3, 0x7f0e061c   // Overlap_ActivityTheme_Settings_AltFont       (下标 1)
844:   invoke-virtual {p1, p3, v2}, ...Theme;->applyStyle(IZ)V   // v2 = 0 → force=false
```

   样式 id 名来自 `decoded/res/values/public.xml` 第 `12461`/`12210`/`12209` 行。

2. **首启/迁移**：`smali/.../audioplayer/Application.smali:2783-2785`
   （`с(II)V` migrator 里 `sget-object v5, ...prefs/V;->L0` → `у(I)V` 写入默认）。
   上下文见 `:2769-2783`：`if-gez v1`（版本号小于 0 = 全新安装）
   `→ SDK>=? 取 2/0 → 写入`。

**监听注册**：`smali/.../preference/k0.smali:2368-2382`
（`c3` 监听器索引 **3** → `c3.smali` 的 `pswitch_3``:177-214`）。
`pswitch_3` 做的是：`getSystemService("__ThemeManager")`（`:190`）→
`common/j.Н(...)`（`:214`）**整主题重建** —— 因为字体变了要重绘整个设置界面。

> **`applyStyle(style, false)`（force=false）** 是与皮肤 overlap 的 `force=true` **相反**的选择：
> 字体样式只是**补默认值**，不覆盖皮肤已设过的同名属性。
> 这与 `poweramp-skin-overlap-apply.md` §3 描述的皮肤侧逻辑形成对照（见 §4.2-N5）。

---

### 1.2-14（#14）improved compatibility with the old 3rd party skins

**实现只有一处**：`smali/.../audioplayer/common/j.smali`，方法
`К(Resources, SkinInfo)`（`:1999` 起）。

三段 **legacy 兼容补丁**，特征是「先打 log 说明为什么，再 applyStyle」：

| 行 | 条件 | 打的样式 | 日志 / 含义 |
| ---: | --- | --- | --- |
| `:2066-2079` | `SkinInfo->f` 为真 | `0x7f0e0003` | `applyLegacyStyles applyLegacyMinMax. Please rebuild/adjust skin with new tools to avoid this` |
| `:2081-2093` | `SkinInfo->P < 0x3eb`（**1003**） | `0x7f0e0045` | `applyLegacyStyles ActivityTheme_Legacy_subAA. This will apply extra padding to TopSubAAButtons ... Please upgrade skin targetBuild to >= 1003` |
| `:2026-2062` | `SkinInfo->e` 为 1 / -1 / 0 | `0x7f0e0004` | 暗色模式探测（非日志型） |

> **这是本条的直接答案**：兼容靠 **`targetBuild` 版本号门控**（`0x3eb = 1003`）
> + **一个布尔标志 `SkinInfo->f`**，达到条件就**追加应用一个补丁 style**。
> 补丁只加 padding / min-max，不改语义。
>
> **★ `1003` 这个阈值与 changelog_1003 区块（Player Buttons Background / Label Background）
> 是同一批改动** —— 说明老皮肤在 1003 之后需要补 padding 才能对上新的按钮行布局。
> **这构成了 #14 与 #16/#17 之间的因果链接**，是本批条目里唯一一处「A 条为 B 条打补丁」的关系。

**build-1035 侧仍在**：`v1035/decoded/smali/ׅ/td1.smali:4616,4648`
有**逐字相同的两条日志字符串**，说明 1035 未移除这套兼容（类名换成混淆名 `td1`）。

---

### 1.2-16（#16）Player Buttons Background

**XML**：`decoded/res/xml/poweramp_builtin_skins.xml:23-27`

```
23: <multiSwitch key="player_buttons_bg" name="@string/player_buttons_bg">
24:   <option name="@string/enabled" overlapAttr="" />
25:   <option name="@string/hidden"  overlapAttr="@attr/overlap_player_buttons_no_bg" />
26: </multiSwitch>
27: <msg align="top" line1="@string/hidden" smallLine1="@string/adjust_bg_hint" />
```

Black 皮肤为 `:90-94`（同构）。

**它是内置皮肤专属选项**：节点在 `<skin>` 内（`:4` Light / `:71` Black），
**不属于任何 3rd-party 皮肤**；`overlapAttr` 机制见 `poweramp-skin-overlap-apply.md`。

**attr → style 解析链**：

```
attrs.xml:3627    <attr name="overlap_player_buttons_no_bg" format="reference" />
public.xml:2911   id="0x7f010b5c"
styles.xml:10703  <item name="overlap_player_buttons_no_bg">@style/ActivityTheme_overlap_player_buttons_no_bg</item>
styles.xml:415-417
  <style name="ActivityTheme_overlap_player_buttons_no_bg">
    <item name="colorBgPlayerButton">#01000001</item>
  </style>
values-v25/styles.xml:596  <item name="overlap_player_buttons_no_bg">...同一条目...</item>
```

> **★ `#01000001` 而不是 `#00000000`**：几乎全透明但**非完全透明**。
> 这是刻意的 —— 完全透明的 View 在某些 ROM 上会被跳过命中测试，
> 保留 alpha=1 保证按钮**视觉消失但仍可点**。
> **这是本批条目里最值得记录的实现细节。**

**副作用说明**：开关只改 `colorBgPlayerButton` 一个属性，
因此「隐藏背景」后**按钮依然响应点击**；用户若想彻底不显示按钮，
需用 `ui_player` 页的按钮编辑功能（见 #15 / idea15 专文）。

---

### 1.2-17（#17）Label Background 不再改屏幕背景

**XML**：`decoded/res/xml/poweramp_builtin_skins.xml:18-22`

```
18: <multiSwitch dependency="alt_layout" key="labels_bg" name="@string/labels_bg">
19:   <option name="@string/enabled" overlapAttr="" />
20:   <option name="@string/hidden"  overlapAttr="@attr/overlap_track_labels_no_bg" />
21: </multiSwitch>
22: <msg align="top" line1="@string/hidden" smallLine1="@string/applied_for_alt_full"
        smallLine2="@string/applied_on_main_screen" smallLine3="@string/adjust_bg_hint" />
```

**「不再改屏幕背景」的证据在样式层**：

```
styles.xml:505-509
  <style name="Alt_White_TracksLabelsNoBg" parent="@style/Base_Alt_TracksLabelsNoBg">
    <item name="colorTextBgAlpha">#88000000</item>          // ← 只改「文字底衬 alpha」
    <item name="overlap_light_buttons">@style/ActivityTheme_White_LightButtons_Alt_White_TracksLabelsNoBg</item>
    <item name="Alt_track_labels_scene_aa_margin">10.0dp</item>
  </style>

styles.xml:14280-14287
  <style name="Base_Alt_TracksLabelsNoBg">
    <item name="alt_title_bg">#0000</item>                 // ← 只清标题底衬
    <item name="alt_sub_aa_button_bg">@drawable/hidden_popup_button_layout_activated_large_bg</item>
    <item name="meta_info_bg">@drawable/hidden_popup_button_layout_bg</item>
    <item name="colorAltTitle">?colorOnAABg</item>
    <item name="colorMetaInfo">?colorOnAABg</item>
    <item name="colorIconLessContrast">?colorOnAABgLessContrast</item>
  </style>

styles.xml:484-490  (Alt2_White_TracksLabelsNoBg)
  <item name="alt_ratingbar_bg">#0000</item>
  <item name="alt_menu_bg">@drawable/ripple_hidden_rounded_large</item>
```

> **★ 全套 11 个 `<item>` 里没有任何一个是「屏幕/窗口背景」类属性**
> （无 `android:windowBackground`、无 `colorBg`、无 `aaBgColor`）。
> 全部是 **`*_bg` 后缀的「元素底衬」** 与 **`color*` 前景色**。
> 这就是「doesn't change screen background anymore」的机制层证据：
> **选项语义从「面板背景」收窄为「标签/按钮的文字底衬」。**

**另一侧证据**：`overlap_track_labels_no_bg`（`attrs.xml:3241`，id `0x7f010a7f`）
在 `styles.xml` 中被 6 个主题分别指向不同 style
（`:92, :95, :103, :3174` 等），其中 1035 侧扩展到 8 个
（`:14967,14971,15102,15163,15166,15252,15255`），
**全部是 `*NoBg` 命名的补丁样式，无一触碰窗口背景。**

---

### 1.2-18（#18）Animate Long Labels Everywhere

**XML**：`decoded/res/xml/ui_player.xml:6-7`

```
6: <...MultilineSwitchPreference title="@string/pref_anim_long_labels" key="anim_long_labels"
       summary="@string/pref_summary_anim_long_labels" android:defaultValue="true" />
7: <...MultilineSwitchPreference title="@string/pref_anim_long_labels_in_lists"
       key="anim_long_labels_in_lists" summary="@string/pref_summary_anim_long_labels_in_lists"
       android:dependency="anim_long_labels" android:defaultValue="true" />
```

- `pref_anim_long_labels` = `Animate Long Labels`（原有项）
- `pref_anim_long_labels_in_lists` = **`Animate Long Labels Everywhere`**（本条新增）
- `pref_summary_anim_long_labels_in_lists` = `Animate long track labels also in lists and the miniplayer`
- **`android:dependency="anim_long_labels"`** —— 总开关关掉时此项被禁用

**偏好定义**：`smali/.../widget/player/h0.smali`

| 行 | 键 | 字段 |
| ---: | --- | --- |
| `:648-654` | `anim_long_labels` | `M`（`h0`，bool） |
| `:1481-1487` | `anim_long_labels_in_lists` | `O0`（`h0`，bool） |

**消费点一**：`smali/.../audioplayer/widget/MarqueeFastTextView.smali:13-17`

```
13: sget-object p1, ...h0;->M:...h0;      // anim_long_labels（★ 只读主开关）
15: iget-boolean p1, p1, ...H;->А:Z
17: iput-boolean p1, p0, ...base/MarqueeFastTextView;->D0:Z   // 写入基类跑马灯开关
```

**消费点二**：`smali/.../audioplayer/common/j.smali:526-550`
（主题构造，两开关是 **AND** 关系）

```
526: sget-object p1, ...h0;->M:...h0;       // anim_long_labels
528: iget-boolean p1, p1, ...H;->А:Z
530: if-eqz p1, :cond_13
532: sget-object p1, ...h0;->O0:...h0;      // anim_long_labels_in_lists
534: iget-boolean p1, p1, ...H;->А:Z
536: if-eqz p1, :cond_13
538: const p1, 0x7f010c80                 // @attr/OptionAnimLongLabelsInLists (public.xml:3203)
544: invoke-static {p0, p1}, ...AUtils;->F(Theme;I)I
550: invoke-virtual {p0, p1, v3}, ...Theme;->applyStyle(IZ)V   // v3=1 → force
```

> **★ 本条最有价值的机制**：`Animate Long Labels Everywhere` 不是单纯的运行时布尔分支，
> 而是**被编译进 skin option 体系的一个 `overlap_*` 属性**
> （`0x7f010c80` = `OptionAnimLongLabelsInLists`）。
> 即：**它通过 `applyStyle(style, true)`（force=true）覆盖皮肤提供的跑马灯设置**。
>
> **因此「Everywhere」的优先级高于皮肤自身的选择 —— 方向与 #17 相反。**
> 对比：`anim_long_labels`（主开关）走 `MarqueeFastTextView` 的构造期一次性赋值（软），
> `anim_long_labels_in_lists`（扩展）走 `applyStyle(force=true)`（硬）。

---

### 1.2-19（#19）Dark Skin Transparent Status Bar

**XML**：`decoded/res/xml/poweramp_builtin_skins.xml:124-128`
（**只在 Black 皮肤内**）

```
124: <multiSwitch defaultValue="" key="statusbar_bg" name="@string/skin_transparent_statusbar">
125:   <option name="@string/default_string" overlapStyle="" />
126:   <option name="@string/no_background" overlapStyle="@style/ActivityTheme_Black_NoStatusBar" />
127: </multiSwitch>
128: <msg line1="@string/summary_skin_transparent_statusbar" />
```

**★ 关键：用 `overlapStyle` 而非 `overlapAttr`。**

| 皮肤 | 有 `statusbar_bg` 吗 | 用的字段 |
| --- | --- | --- |
| Light（`:4-70`） | **没有** | — |
| Black（`:71-140`） | 有（`:124`） | `overlapStyle`（**直接 style id**） |

> 这印证了 `poweramp-skin-overlap-apply.md` §1.2 的「两者互斥」规则：
> 该选项**直接写死 style**，不经 attr 间接引用 —— 因为「透明状态栏」不存在
> Light/Black 两套不同实现，没必要间接。
> **同一文件内两种引用方式并存，说明选型是按「是否需要按主题分流」决定的，不是风格统一。**

**样式本体**：`decoded/res/values/styles.xml:19037-19039`

```
19037: <style name="ActivityTheme_Black_NoStatusBar">
19038:   <item name="statusBarBg">#0000</item>
19039: </style>
```

（1035 侧 `:14838-14840` 为 `#00000000`，**语义等价，写法从 4 位归一为 8 位**。）

**文案自证用途**：`summary_skin_transparent_statusbar` =
`Some covers may make status bar icons not readable. In this case you can adjust Background options`
—— 说明这个选项是**为封面图延伸到状态栏下**服务的。

> **changelog 的锚点疑似笔误**：`changelog_1003` 原文链接是
> `settings/ui_player#anim_long_labels_in_lists`（与上一条 #18 指向同一锚点），
> 按语义应为 `settings/ui_theme`。
> **这是 changelog 侧的锚点错误，不是实现问题**，记录在此以免后来者按锚点找不到。

---

### 1.2-20（#20）Samsung Flip widgets for cover screens

> **口径：build-1035 独占。** build-1025 的 `AndroidManifest.xml` 与 `res/xml/`
> 均**无 cover 变体**，且 `res/layout/` 中也没有 cover 专用布局。

**资源差量**（`res/xml/` 目录比对，1025 = 53 个 / 1035 = 59 个）：

| build-1035 独有 | build-1025 独有 |
| --- | --- |
| `widget_4x2_cover.xml`、`widget_4x4_cover.xml`、`widget_samsung.xml`、`audio_bit_perfect.xml`、`audio_outputs2.xml`、`audio_outputs_tweaks.xml`、`splits0.xml`、`usb_device_filter.xml` | `audio_output.xml`、`audio_outputs.xml` |

**`widget_samsung.xml` 全文只有 2 行**：

```
1: <?xml version="1.0" encoding="utf-8"?>
2: <samsung-appwidget-provider display="sub_screen" />
```

> `display="sub_screen"` 是三星的**外屏（FlexWindow / Cover Screen）标记**。
> 这是一个**两行的元数据文件**，真正的实现全在别处。

**Manifest 注册**（`v1035/decoded/AndroidManifest.xml`）：

```
149: <activity ... android:name="...widgetpackcommon.Widget4x4ConfigureCover" ...>
154: <receiver android:enabled="false" android:exported="true" android:label="@string/widget_4x4"
                android:name="...widgetpackcommon.Widget4x4ProviderCover">
155-157:  <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE"/></intent-filter>
158:      <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_4x4_cover"/>
159:      <meta-data android:name="com.samsung.android.appwidget.provider" android:resource="@xml/widget_samsung"/>
160:    </receiver>
161: <activity ... android:name="...widgetpackcommon.Widget4x2ConfigureCover" ...>
166: <receiver android:enabled="false" ... android:name="...Widget4x2ProviderCover">
170:      <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_4x2_cover"/>
171:      <meta-data android:name="com.samsung.android.appwidget.provider" android:resource="@xml/widget_samsung"/>
172:    </receiver>
```

> **★ `android:enabled="false"` 是关键**：两个 cover receiver 默认**不启用**，
> 需由应用在检测到三星外屏设备后动态启用（`PackageManager.setComponentEnabledSetting`）。
> 这是「同一 APK 兼顾普通设备与外屏设备」的常规做法。
> **本文未定位到「谁在什么时候启用它」的代码**（见 §4.3-Q6）。

**类继承关系**：`v1035/.../Widget4x2ProviderCover.smali:1-2`

```
1: .class public final Lcom/maxmpz/audioplayer/widgetpackcommon/Widget4x2ProviderCover;
2: .super Lcom/maxmpz/audioplayer/widgetpackcommon/Widget4x2Provider;
```

> **不是重写，是继承**：cover 变体 = 普通 Provider + 尺寸/边距修正。

**尺寸适配**（`Widget4x2ProviderCover.smali:48-190`）：

| 行 | 内容 |
| ---: | --- |
| `:48-61` | `O(Context)Landroid/content/Context;` → `ׅ/ym1.В(Context)` 做 **context 包装**（外屏密度/尺寸适配） |
| `:63-72` | `j(...)I` 先 `invoke-super` 拿基线，再做修正 |
| `:75-83` | `SDK_INT >= 0x1f (31)` 才修正（`RemoteViews.setViewLayoutWidth/Height` 需 API 31） |
| `:87-103` | `density * 8.0f` → `Math.round` = 四周内边距像素值 |
| `:123-143` | 4 个 view id：`0x7f0d0343`(`folder_prev_button`) / `0344`(`rw_button`) / `0345`(`ff_button`) / `0346`(`folder_next_button`) |
| `:166-178` | 逐个 `setViewLayoutWidth(48.0f, 1)` / `setViewLayoutHeight(48.0f, 1)`（**固定 48dp**） |

> **机制**：外屏尺寸小，普通 widget 的按钮会被拉伸变形，
> 因此 cover 变体在 `onUpdate` 里**强制把 4 个按钮钉死在 48dp 见方**，
> 并统一 8dp 的四周留白（`density*8`）。
> `Widget4x4ProviderCover` 同样继承（`widget_4x4_cover.xml:2` 的
> `minResizeWidth="70.0dip"` 与普通版一致）。

---

### 1.2-21（#21）skin authors 保护 / 可选校验

> **口径：build-1035 独占。** build-1025 的 `res/values/strings.xml` 中
> `skin_unverified` / `skin_open_to_verify` / `skin_settings_*_unverified_*` 全部**不存在**。

**校验入口**：`v1035/decoded/smali/com/maxmpz/audioplayer/player/InternalAPIReceiver.smali`
（`onReceive`，`:21` 起）—— 处理 `handleSkinVerified` 意图。

分四道**递增严格**的关卡：

| 行 | 检查 | 失败日志 |
| ---: | --- | --- |
| `:236-265` | `ׅ/fx.X(context, pkg)` 能否解析出 signer | `handleSkinVerified DISCARD can't resolve signer pak=` |
| `:269-320` | 传入 token 与当前 signer-key **相等** | `handleSkinVerified DISCARD signer-key mismatch pak= token= current=` |
| `:346-395` | `ׅ/fx.В(pkg, false, signerInfo, false)` 返回值**必须 == 1** | `handleSkinVerified DISCARD not trusted pak= state=` |
| `:473-520` | 全部通过 | `handleSkinVerified ACCEPTED pak=` |

> **机制**：这是一个 **Binder/广播驱动的「皮肤签名白名单」**。
> 皮肤 APK 侧把签名信息发进来，宿主用 `ׅ/fx`（签名/信任判定器）比对，
> 只有 `state == 1` 才接受，然后 `ׅ/ir.Н()`（`:484`）落盘。
> **「可选校验」的含义**：未验证的皮肤**仍可使用**，只是被标为 Unverified。

**UI 呈现**：`v1035/.../preference/SkinGearRadioPreference.smali`

| 行 | 内容 |
| ---: | --- |
| `:79` | `const v2, 0x7f08087d` = `@string/skin_unverified`（`Unverified skin`），拼进 summary |
| `:339` | `const p1, 0x7f080864` = `@string/skin_open_to_verify`（`Open skin to verify`） |
| `:348` | 否则 `const p1, 0x7f080636` = `@string/pref_skin_settings`（`Skin Settings`） |

即：**未验证皮肤的齿轮按钮文案变成「Open skin to verify」，已验证的显示「Skin Settings」**。

**文案全表**（`v1035/decoded/res/values/strings.xml`）：

| 键 | 值 |
| --- | --- |
| `skin_unverified` | Unverified skin |
| `skin_unverified_toast` | Skin unverified |
| `skin_open_to_verify` | Open skin to verify |
| `skin_settings_skin_unverified_s` | `Skin %1$s is not verified, its settings can't be imported` |
| `skin_settings_skin_not_installed_s` | `Skin %1$s is not installed` |

> **★ 注意最后一条**：未验证皮肤**可以被使用**，但**其设置不能被导入**。
> 这是「保护」的实际力度边界 —— **保护的是设置交换，不是使用**。

---

### 1.2-22（#22）3rd-party 皮肤设置可导出/导入 JSON

> **口径：build-1035 独占。**

**两个入口偏好**：

| 类 | 行 | 作用 |
| --- | ---: | --- |
| `SkinExportSettingsPreference.smali` | `:1-2` `extends SkinActionPreference` | 导出 |
| 同上 | `:23` | `0x7f080634` = `@string/pref_skin_export_settings`（`Export Skin Settings`） |
| 同上 | `:33` | `0x7f0106ec` 取图标（`AUtils.E`） |
| 同上 | `:618-623` | `ׅ/hd1.В(activity, 0x7f080634, msg, ok)` 显示结果 |
| `SkinImportSettingsPreference.smali` | `:23` | `0x7f080635` = `@string/pref_skin_import_settings` |
| 同上 | `:110-198` | `onClick()`：`getSkinInfo()` → 拿 Activity → 起文件选择 |

**导出执行链**：

```
SkinExportSettingsPreference.smali:618  →  hd1.В(...)  ← 结果回调
        ↑
ׅ/ed1.smali:52   B(Landroid/net/Uri;)V       // 用户选好目标 Uri 后进来
  :64-72    zc1.B.x(SkinInfo) → ir            // 取该皮肤的偏好容器
  :80       ir.getAll() → Map                 // ★ 全量键值快照
  :112-129  new dd1(this, ctx, uri, map, H(long), H(String))
  :134      ThreadPoolExecutor.execute(runnable)
        ↓
ׅ/dd1.smali:62   run()V
  :127-131  ContentResolver.openOutputStream(uri, "wt")
  :146-163  JsonWriter(OutputStreamWriter(os, UTF_8))
  :179      kd1.О(writer, skinInfo, appRes, ownRes, build, version, map)
  :187      writer.close()
```

**JSON 结构**（`ׅ/kd1.smali` `О(...)`，`:2279-2923`，逐个 `name()` 调用）：

| 行 | 字段 | 值 |
| ---: | --- | --- |
| `:2305` | `format` | `:2317` **`"poweramp-skin-settings"`** |
| `:2326` | `formatVersion` | `:2338` **`1`**（long） |
| `:2347` | `package` | `SkinInfo->C`（包名） |
| `:2368` | `skin` | `:2380` `kd1.p(res, skinInfo)` 解析出的皮肤标识 |
| `:2393` | `skinName` | `SkinOption->В`（显示名） |
| `:2414` | `skinBuild` | `SkinInfo->O >>> 24`（`:2283-2287`，**取高字节**） |
| `:2431` | `skinVersion` | 传入的 `String` 参数 |
| `:2448` | `settings` | `:2460` `beginObject()` 起**嵌套对象** |
| `:2289-2295` | — | `setIndent("  ")`（**两空格缩进，便于人工看**） |

**settings 的写入逻辑**（`:2474-2843`）：

```
2474:   iget-object p1, p1, SkinBaseSubCatOptions;->К:Ljava/util/ArrayList;   // 选项列表
2478-82: new HashSet()                                             // 去重集合
2487:   kd1.В(list, ArrayList, HashSet)                              // 展平子选项树
2506-43: 遍历每个 SkinOption，用 option->A（key）去 map 查值；查不到就跳过
2547-60: SkinSelectableSkinOptions（单/多选组）→ 要求值是 Integer
```

> **失败兜底**：`:2843` 的日志字符串
> `writeSkinSettingsJson SKIP bad stored value key=` ——
> 值类型不匹配时**跳过该项而不是中断导出**。
> `:2893` 的 `"SkinSettingsJson"` 是 Log tag。

**导入侧防护**（`v1035/.../strings.xml` 已列）：
`skin_settings_import_file_confirm_s_s`（二次确认）、
`skin_settings_build_mismatch_s_s`（build 不符）、
`skin_settings_skin_mismatch_s_s`（皮肤不符）、
`skin_settings_wrong_skin_s`、`skin_settings_invalid_file`、
`skin_settings_imported_skipped_d`（`%1$d unknown options skipped`）。

> **设计要点**：**导入是「白名单 + 逐项跳过」** —— 未知键跳过并计数，
> 不像整包替换那样一刀切失败。`formatVersion=1` 留了向前兼容位。

---

### 1.2-23（#23）全部新功能并入 base app，可买 Uberpatron 支持

本条是**政策陈述**，实现层面只有两条：

1. **`featurePack` 门控未被用在 1026-1032 这批新功能上**（部分抽样验证）。
2. **Uberpatron 入口保留**（`decoded/res/xml/feature_packages.xml:14`，见 §1.2-3），
   且 1035 继续沿用同一入口。

> **只算部分成立**：本文**没有**逐文件统计 1035 全部 59 个 XML 里 `w:featurePack` 的分布，
> 仅抽样比对了几处。见 §4.3-Q4。

---

### 1.2-24（#24）Blended 皮肤选项

> **口径：build-1035 独占。** build-1025 的 `poweramp_builtin_skins.xml`（141 行）
> **完全没有 `blended` 关键字**，`attrs.xml` 也**没有** `overlap_blended_*`
> （首次出现在 `v1035 attrs.xml:2968,2977`）。

**XML 声明**（`v1035/decoded/res/xml/poweramp_builtin_skins.xml`）

Light 皮肤（`:4` 起）：

```
12: <option checkedByDefault="false" key="blended" name="@string/skin_blended_layout"
              overlapAttr="@attr/overlap_blended_layout" summary="@string/skin_summary_blended_layout" />
13: <msg align="top" icon="@drawable/blended" iconAlign="top"
        smallLine1="@string/applied_in_portrait_only" smallLine2="@string/skin_background_opts" />
```

Black 皮肤（`:81-82`，同构；仅 `:82` 把 `smallLine1=` 改成 `line1=`，
属文案层级差异 —— **这是 §4.2-N7「两段复制」的实证**）。

**文案**（`v1035/decoded/res/values/strings.xml`）：

| 键 | 值 |
| --- | --- |
| `skin_blended_layout` | **`Blended`** |
| `skin_summary_blended_layout` | **`Blends edge-to-edge cover art into the background`** |
| `applied_in_portrait_only` | `Applied in portrait only` |
| `skin_background_opts` | `Use Background options to adjust background blur and colors` |

> `changelog_103x` 原文对这行的描述是
> **`Album art fills the top of the screen edge-to-edge and fades into a background`**，
> 与 `skin_summary_blended_layout` **不是同一句**（前者是 changelog 正文，后者是设置页 summary）。

**新增的两个 attr**（`v1035/decoded/res/values/attrs.xml`）：

```
2968: <attr name="overlap_blended_layout"  format="reference" />
2977: <attr name="overlap_blended_variant" format="reference" />
```

（`public.xml:2535` = `0x7f010d1a`、`:2544` = `0x7f010d23`。）

> **★ 两个 attr 构成「两级覆盖」**：
> - `overlap_blended_layout` —— 决定**布局骨架**（Light/Black 各自不同）
> - `overlap_blended_variant` —— 决定**在已选 alt_layout 之上的变体**（Default / Alt / Full）

**布局 attr 的主题绑定**（`v1035/decoded/res/values/styles.xml`）：

| 行 | 键 | 值 |
| ---: | --- | --- |
| `:2029` | `overlap_blended_layout` | `@style/ActivityTheme_Black_BlendedLayout` |
| `:9637` | `overlap_blended_layout` | `@style/ActivityTheme_White_BlendedLayout` |
| `:2030` / `:9638` | `overlap_blended_variant` | `@style/Blended_Default` |

**变体 attr 的 alt_layout 绑定**（同文件）：

| 行 | 上下文 | 值 |
| ---: | --- | --- |
| `:93` | `Alt_*_Black` | `@style/Blended_Alt_Black` |
| `:97` | `Alt2_*_Black` | `@style/Blended_Full_Black` |
| `:106` | `Alt2_*_White` | `@style/Blended_Full_White` |
| `:2120` | `Alt_*_White` | `@style/Blended_Alt_White` |

> **这就是「Blended 与 3 种 layout 正交组合」的实现**：
> `alt_layout` 选 Default/Alt/Full → 通过 `overlap_blended_variant` 解析到
> `Blended_Default` / `Blended_Alt_*` / `Blended_Full_*` 三族之一。
> **所以 Blended 不是第 4 种布局，而是一个叠加层。**

**骨架样式**（`styles.xml:14844-14858` `Base_BlendedLayout`）：

```
14845: <item name="TopAABounds">@style/Blended_TopAABounds</item>
14846: <item name="TopFitsStatusBarView">@style/Blended_TopFitsStatusBarView</item>
14847: <item name="TopFitsNavigationBarView">@style/Blended_TopFitsNavigationBarView</item>
14850: <item name="alt_menu_bg">@drawable/ripple_inverse_rounded_large</item>
14851: <item name="alt_ratingbar_bg">@drawable/text_bg_alpha_rounded</item>
14852: <item name="alt_title_bg">@drawable/text_bg_alpha_rounded</item>
14853: <item name="aaEffectBlendedMain">@style/Blended_MilkEffect</item>
14854: <item name="blendedLayoutSelected">true</item>          // ★ 自描述标志位
14855-56: lyrics 场景的状态栏/导航栏同步
14857: <item name="CcButton_MainUI_background">@drawable/ripple_text_bg_rounded_large</item>
```

> `:14854` 的 `blendedLayoutSelected=true` 是**样式层的自描述开关**，
> 供后来在 `theme.resolveAttribute` 里反查当前是否处于 blended 模式
> （与 `poweramp-skin-overlap-apply.md` 的 `AUtils.F` 机制配套）。

**运行时判定**：`v1035/decoded/smali/com/maxmpz/audioplayer/common/BaseMainActivity.smali`

```
60-84:   instance-of ...td1 && td1.y(SkinInfo) != null && SkinInfo->Р == true
88-104:  SkinInfo->O 必须等于 ActivityTheme_White 或 ActivityTheme_Black  // 仅内置皮肤
109-113: zc1.B.x(skinInfo) → ir                                          // 取皮肤偏好容器
121:     const-string v2, "blended"
128:     invoke-virtual {v1, v2, v3}, ׅ/rr;->getBoolean(Ljava/lang/String;Z)Z // v3 = 0 = 默认 false
136:     if-eqz v1, :cond_2                                              // 开关关闭 → 跳过
140:     invoke-virtual {v0}, MainActivity;->isBlendedPortraitWindow()Z
148-176: 用 Resources/Theme 重新 setTo（td1.K(...)）
```

**「仅竖屏」的实现** `MainActivity.smali:140-360` `isBlendedPortraitWindow()Z`：

| 行 | 逻辑 |
| ---: | --- |
| `:144-174` | 取 `getWindow().peekDecorView()` |
| `:181-205` | decorView 宽高 > 0 时 |
| `:225-233` | `if-le v1, v0`（`height > width`）→ **return true**；否则 return false |
| `:237-269` | 退化路径：`getLastNonConfigurationInstance()` 若是 `ׅ/ra0` 则读其 `В` 布尔缓存 |
| `:273-357` | API ≥ 30：`WindowManager.getCurrentWindowMetrics().getBounds()` 的 `height > width` |

> **三条降级路径**（decorView → 配置缓存 → WindowMetrics）与 #4 的三级降级是同一风格。
> **`changelog` 说「Applied in portrait only」，实现却是逐次根据实际窗口宽高判定**，
> 而非读 `Configuration.orientation` —— 因此**分屏 / 自由窗口也能正确判断**。

**★ 覆盖关系副作用**：`Blended_Default`（`styles.xml:15089-15103`）内部
重定义了 `overlap_track_labels_no_bg` → `@style/Blended_NoBg`（`:15102`）。
**由于 `applyStyle(force=true)` 后者覆盖前者**（`poweramp-skin-overlap-apply.md` §3），
**Blended 会覆盖用户单独选的 Label Background 设置**。
这是一个不显然的副作用（见 §4.2-N6）。

---

### 1.2-15（#15）/ 1.2-25（#25）customizable Player Screen Buttons

**已覆盖，本文不重做。** 见 `poweramp-impl-idea15-custom-buttons.md`（471 行，`open_items: 0`）。
交叉登记：该功能 5 组偏好键在 `decoded/res/xml/ui_player.xml:10,13,14,15` 全部带 `w:featurePack="1"`。

### 1.2-26..#29（#26/#27/#28/#29）FP 清单重复陈述

与 #12 / #11 / #9 / #10 **同一实现**，只是分别出现在 `changelog_989`（写「new option」）
与 `changelog_978_fp`（写「FP#1 内容清单」）两个区块。**无独立实现**，详见 §1 去重说明。

---

## 2. 共性机制归纳

### 2.1 五条贯穿全部条目的模式

| # | 模式 | 出现条目 | 说明 |
| ---: | --- | --- | --- |
| P1 | **XML 声明 + FastStaticPrefs 静态字段 + 运行时消费点，三段式** | 3,6,7,8,10,11,12,13,18 | 骨架一致：`*.xml` 的 `android:key` → `h0.smali` 的 `const-string` + `sput-object` → 消费类 `sget-object` |
| P2 | **新增枚举取空号，绝不重排** | 1,10 | `notify_action` 用 9/10（跳过已占的 7/8）；`anim_speed` 用 `0=Disabled,1=Default,2=Fast` 而非 0/1/2 |
| P3 | **overlapAttr（间接）vs overlapStyle（直接）二选一** | 16,17,19,24 | 需 Light/Black 各自实现 → 用 attr；只需一套 → 直接 style。#19 纯直接、#16/#17 纯间接、#24 两者混用 |
| P4 | **版本门控 `ByteBuffer.getInt(idx)` 双槽偏好** | 9,10,12 | `getInt(2) >= N ? s->А : s->B` —— 同一 key 在新旧 schema 下取不同槽位 |
| P5 | **多级降级（最精确源优先，失败回退）** | 4,24 | predictive back 三级（API 34/33/<33）；blended 竖屏判定三级（decorView/配置缓存/WindowMetrics） |

### 2.2 `featurePack` 门控在本批的分布（关键发现）

`w:featurePack="1"` 的实测分布：

| 选项 | 文件:行 | Feature Pack |
| --- | --- | --- |
| `anim_speed` | `ui.xml:18` | ✅ |
| `menu_button_long_press` | `ui_player.xml:22` | ✅ |
| `line2_click` / `line2_long_click` | `ui_player.xml:25,26` | ✅ |
| `vis_fs_hide_bars` | `vis.xml:14` | ✅ |
| `edit_player_screen_buttons` 等 5 项 | `ui_player.xml:10,13,14,15` | ✅ |
| `aa_bg_gradient` 三件套 | `aa_bg.xml:8,9,10` | ❌ **无** |
| `vis_ignore_touch_faded` | `vis.xml:12` | ❌ **无** |
| `settings_font` | `ui.xml:7` | ❌ **无** |
| `num_settings_tags` | `ui.xml:23` | ❌ **无** |
| `lyrics_keep_screen` | `ui_lyrics.xml:11` | ❌ **无** |

> **★ 规律**：本批 **978 区块的 5 个选项（#6/#7/#8 等）全部免付费**，
> 而 **989 与 978_fp 区块的 4 个（#10/#11/#12/#9）全部需 Feature Pack #1**。
> 这与 `changelog_978`「new option」vs `changelog_978_fp`「FP#1 内容清单」的分区**完全吻合** ——
> **changelog 的区块归属本身就是付费门控的权威线索。**

### 2.3 内置皮肤的两个「隐形」约束

从 #16/#17/#19/#24 归纳：

1. **只有 2 个内置皮肤**：`poweramp_builtin_skins.xml` 只有 `<skin>` × 2
   （1025：`:4` Light / `:71` Black；1035：`:4` / `:73`）。
2. **选项不是对称的**：

| 选项 | Light | Black |
| --- | --- | --- |
| `statusbar_bg`（Transparent Status Bar） | ❌ 无 | ✅ `:124`（1025） |
| `light_buttons`（More Light） | ✅ `:48`（1025） | ❌ 无 |
| `force_light_navbar` | ✅ `:58` | ❌ 无 |
| `blended` | ✅ `:12`（1035） | ✅ `:81`（1035） |

> **照抄另一个皮肤的选项会引到不存在的 key**，这是维护内置皮肤时最容易犯的错。

### 2.4 4 个「晚于 1025」条目的共同点

#20 / #21 / #22 / #24 全部：
- 在 build-1025 的 `res/xml/` 与 `res/values/strings.xml` 中**零命中**；
- 在 build-1035 中**有完整实现**；
- 其实现类**大量使用 `ׅ/` 混淆包**（`td1` / `ed1` / `dd1` / `kd1` / `mj` /
  `wr` / `z61` / `y61` / `w81` / `vr`）。

> 这正是 `poweramp-corpus-conventions.md` §3/§5 描述的「跨版检索必失败」现象：
> **拿 build-1025 的产物找 build-1035 的功能，得到的不是「没有这个功能」，而是「文件不存在」。**
>
> 附带实证：build-1035 的 `com/maxmpz` 只有 434 个 smali，而 `ׅ/` 下有 3088 个 ——
> **业务逻辑的主体已在混淆包里，不在 `com.maxmpz` 命名空间。**

---

## 3. 未找到实现 / 未重做的条目及排查说明

**共 4 条**：#2（未找到）、#15 与 #25（主动不重做）、#23（部分成立）。

### 3.1 #2 visualization latency is now also applied to lyrics —— **未找到实现**

**结论：在 build-1025 的 smali + res 范围内未找到该行为的消费点。**

**已搜索范围（逐项列出，便于复核）**：

| 维度 | 具体动作 | 结果 |
| --- | --- | --- |
| 资源文案 | `decoded/res/values/strings.xml` 全文检索 `latency`（大小写不敏感） | 只有 `pref_vis_latency_ms` 相关文案，**无「lyrics 同步」类新文案** |
| 偏好键 | `decoded/res/xml/` 全部 **53** 个 XML 检索 `latency` | 只有 `vis.xml:20` 的 `vis_extra_delay_info`（**Redirect** 到 per-output 设置） |
| smali 字段名 | `com/maxmpz` 全部 **1808** 个 smali 检索 `extraDelay` / `ExtraDelay` / `visDelay` / `VisDelay` / `delayMs` / `latency` | 仅 **4** 处命中，全部是**输出管线/日志**而非歌词（见下） |
| 歌词类 | 逐个读完 `dialogs/LyricsActivity.smali`、`widget/player/list/Lyrics{Button,FastTextView,ItemView}.smali` | **无任何 `latency`/`delay` 相关字段**（`LyricsFastTextView.smali` 全文 192 行已读完，只有 `x0`/`y0` 两个跑马灯相关字段） |
| 可视化类 | `widget/player/` 全目录检索 `latency` | 仅 `widget/player/p1.smali:121,169,177`，是 `PipelineInfo.toString()` 的**日志输出** |
| 播放器类 | `audioplayer/player/` 全目录检索 `latency` | **0 命中** |

**已定位到但不足以证成的相关物**：

1. `smali/.../audioplayer/preference/i.smali:443-459` —— 把 `preference/H->P` 的值
   `putInt` 进一个 `ByteBuffer`（**每输出设备一份**的性能参数打包）；
   `Application.smali:3008-3022` 有对应读回（拼 key `"vis_latency_ms"`）。
   → **这是「可视化延迟」的数据通道**，但**找不到它被歌词侧消费的证据**。
2. `smali/.../audioplayer/preference/c1.smali:2486-2529` —— 设备选项页把
   `vis_latency_ms` 绑成 `SeekbarPreference` + `u0` 监听器。
   → **这是「可视化延迟」的设置入口**，同样止步于此。
3. `smali/.../audioplayer/preference/H.smali:65-77` —— `P` 字段就是
   `vis_latency_ms` 的 FastStaticPrefs 包装（`m->K()` 生成的 `r`）。

**因此**：这条 changelog 声称的「把可视化延迟也应用到歌词」，
在 build-1025 中**找不到新增的消费点**。两种可能：

- 改动发生在 **native 层**（`lib/`，本次未分析）；
- 或改动是**纯行为性修正**（歌词原本就没做延迟补偿，改为复用同一通道而**无新增符号**）。

> **本文不对上述两种可能作断言**，只记录「在 build-1025 的 smali + res 范围内未找到」。
> 若后续分析 native，建议从 `lib/*/libaudioplayer*.so` 的歌词/可视化时间戳入口入手。

### 3.2 #15 / #25 —— **已覆盖，主动不重做**

| 条目 | 覆盖文档 | 该文档的结论 |
| --- | --- | --- |
| #15 `1003` customizable buttons row on the player screen | `poweramp-impl-idea15-custom-buttons.md`（471 行） | 10 个偏好键、按钮即子 View、拖影截屏；`open_items: 0`（**彻底闭合**） |
| #25 `fp1` customizable Player Screen Buttons | 同上 | 同上（同一功能在两个区块重复陈述） |

> 本文仅在 §1 表中登记其位置，**不重复其内容**。
> 唯一新增的交叉信息：该功能的 5 组偏好键
> （`edit_player_screen_buttons` / `sub_aa_buttons_no_gap` / `sub_aa_buttons_no_lp_edit` /
> `sub_aa_buttons_{port,land}` / `sub_aa_buttons_layout_{port,land}` /
> `PaEditableButtonsRestorePref`）在 `decoded/res/xml/ui_player.xml:10,13,14,15`
> **全部带 `w:featurePack="1"`**，与 changelog 里「included in 🎁 Feature Pack #1」一致。

### 3.3 #23 —— **部分成立**（详见 §4.3-Q4）

政策陈述「all new features … don't require Feature Package purchase」在
`res/xml/` 层**可抽样验证**（1035 新增的 `audio_bit_perfect.xml` 等未见 `w:featurePack`），
但**未做全量统计**，因此只记为「部分成立」。

---

## 4. 可借鉴 / 不建议照抄

### 4.1 值得借鉴

| # | 做法 | 出处 | 理由 |
| ---: | --- | --- | --- |
| A1 | **`overlapAttr` 两级间接（layout / variant 分离）** | #24 `attrs.xml:2968,2977` | 一个开关同时决定「骨架」和「在 3 种既有布局上的变体」，**不需要 3×2=6 个独立选项** |
| A2 | **样式自描述标志位 `blendedLayoutSelected=true`** | #24 `styles.xml:14854` | 后续 `resolveAttribute` 可反查「当前是否 blended」，避免在 Java 层散布布尔 |
| A3 | **`#01000001` 而非 `#00000000` 做「隐藏」** | #16 `styles.xml:416` | 保留 alpha=1 避免某些 ROM 跳过命中测试，**视觉透明但功能保留** |
| A4 | **多级降级（精确源优先）** | #4 `widget/base/О.smali:28-97`；#24 `MainActivity.smali:140-360` | API 分档 + 运行时信息源分档，**两个维度都不写死** |
| A5 | **偏好双槽（`s->А` / `s->B`）+ 数据版本号门控** | #9 `list/А.smali:114-140`；#10 `AnimTimeHelper.smali:66-82` | **同一 key 支持新旧两套 schema 共存**，升级不用迁移 |
| A6 | **特性开关折叠成「签名 int」再做差量比较** | #7 `MilkWidget.smali:1089-1112` | 3 个选项 → 1 个 int，**避免逐字段比对和无效重建** |
| A7 | **JSON 导入「逐项跳过 + 计数」** | #22 `kd1.smali:2506-2843` + `skin_settings_imported_skipped_d` | 未知键不让整包失败；`formatVersion=1` 留兼容位 |
| A8 | **兼容补丁「先打日志说明原因再 applyStyle」** | #14 `common/j.smali:2072,2087` | 每条 legacy patch 自带「为什么 + 怎么修」的日志，**可维护性极高** |
| A9 | **外屏/小尺寸用继承 + 布局尺寸覆写，不重写 widget** | #20 `Widget4x2ProviderCover.smali:1-2,166-178` | 一个 `extends` + 4 个 `setViewLayoutWidth`，**零重复业务逻辑** |
| A10 | **未验证 ≠ 不可用（分级保护）** | #21 `InternalAPIReceiver.smali:346-395` + 文案 | 未验证皮肤可用但**不能导入设置**，把「安全边界」定在数据交换而非功能使用 |
| A11 | **changelog 区块 = 付费门控的权威线索** | §2.2 | 978 / 978_fp / 989 三区块的 `w:featurePack` 分布 100% 吻合，说明文档分区不是随意排版 |

### 4.2 不建议照抄

| # | 问题 | 出处 | 后果 |
| ---: | --- | --- | --- |
| N1 | **entries/values 下标语义被「取空号」破坏** | #10 `arrays.xml:72-76`（`0,2,1`） | 任何「下标即值」的写法都会静默错位；必须显式维护 values 数组 |
| N2 | **同一 title 字符串被两个不同 key 共用** | #8：`lyrics_keep_screen` 与 `keep_screen_on` 都叫 `Keep Screen On` | 检索时无法通过文案区分，**必须靠 key 名** |
| N3 | **同一 msg id 承载两种语义** | #9：`line2`(`0x7f0d001e`) 在 `A` 是点击、在 `ListWidget` 是长按 | 新增第三种宿主时极易漏接 |
| N4 | **changelog 锚点写错** | #19：`Transparent Status Bar` 指向 `ui_player#anim_long_labels_in_lists` | 实际应在 `ui_theme`；外部文档引用会 404 |
| N5 | **样式层覆盖方向不统一** | #18 用 `force=true`（选项压皮肤）；#13 用 `force=false`（皮肤压选项） | 没有统一规则，**只能逐项实测** |
| N6 | **Blended 隐式覆盖用户的 Label Background 选择** | #24 `styles.xml:15102` + `poweramp-skin-overlap-apply.md` §3 | 用户选了「Hidden」后开 Blended 会被 `Blended_NoBg` 覆盖，**无 UI 提示** |
| N7 | **同一文件内 Light/Black 两大段几乎逐行复制** | `poweramp_builtin_skins.xml` 1025 `:4-70` vs `:71-140` | 改一处必漏另一处；1035 的 `:13` vs `:82` 已出现 `smallLine1` / `line1` 不一致 |
| N8 | **混淆命名只差一个 Unicode 码点** | #3 `prefs/B.smali` 的字段 `c`(U+0063) / `с`(U+0441)（第 175/179 行） | 按名字检索/重构必错；**只能靠行号和类型判断** |
| N9 | **默认隐藏的组件靠运行期动态启用** | #20 `AndroidManifest.xml:154,166`（`enabled="false"`） | 若启用逻辑失败，用户看不到任何报错，widget 只是「不存在」 |

### 4.3 本文未闭合项（对应 front matter `open_items: 3`）

| # | 项 | 现状 |
| ---: | --- | --- |
| ~~Q1~~ | ~~#2 latency → lyrics 消费点~~ | ✅ **已闭合**（`poweramp-changelog-residual-closure.md` §2）：`vis_latency_ms` → `H.P` → `i.А()` 打包进 ByteBuffer 交 native，消费在 `.so` |
| ~~Q2~~ | ~~#10 `calcAnimTime(F,Z)` 的 `Z` 参数语义~~ | ✅ **已闭合**（同上 §1）：`Z` = 是否需要动画；`true` 时 `anim_speed==0` 返回 `0.001f`（瞬时），`false` 时保留 `t*0.6f` |
| ~~Q3~~ | ~~#12 的 `0x7f0d0037` message id 名称~~ | ✅ **已闭合**：`bus_data_cmd`（`public.xml:8747`），数据层命令总线 |
| Q4 | #23「全部新功能免 Feature Pack」 | 仅抽样比对，未统计 1035 全部 59 个 XML 的 `w:featurePack` 分布 |
| ~~Q5~~ | ~~`MilkLoader->O` 双重用途~~ | ✅ **已闭合**（residual-closure §2.5）：**单一用途**——脏值比对缓存（`Н`=当前值，`O`=上次应用值） |
| ~~Q6~~ | ~~cover widget 动态启用点~~ | ✅ **已闭合**（同上 §2.6）：`preference/x0.smali:60-123`——**preference key 即组件类名**，单选式切换 |

---

## 5. 证据索引

### 5.1 区块键勘验（本文版本口径的根据）

| changelog 键 | build-1025 `res/values/strings.xml` | build-1035 `res/values/strings.xml` |
| --- | --- | --- |
| `changelog` | ✅ `:227` | ✅ `:247` |
| `changelog_971` | ✅ `:231` | ✅ `:252` |
| `changelog_978` | ✅ `:232` | ✅ `:253` |
| `changelog_978_fp` | ✅ `:233` | ✅ `:254` |
| `changelog_989` | ✅ `:234` | ✅ `:255` |
| `changelog_989_2` | ✅ `:235` | ✅ `:256` |
| `changelog_992` | ✅ `:236` | ✅ `:257` |
| `changelog_997` | ✅ `:237` | ✅ `:258` |
| `changelog_1000` | ✅ `:228` | ✅ `:248` |
| `changelog_1003` | ✅ `:229` | ✅ `:249` |
| `changelog_1017` | ✅ `:230` | — |
| **`changelog_102x`** | ❌ **不存在** | ✅ `:250` |
| **`changelog_103x`** | ❌ **不存在** | ✅ `:251` |

**计数**：1025 = **11** 个 changelog 键；1035 = **12** 个（去 `1017`，加 `102x` / `103x`）。

**区块顺序**（`decoded/res/values/arrays.xml:96-104` 的 `changelog_content`）：
`1003 → 1000 → 997 → 992 → 989 → 989_2 → 978_fp`

> **注意 `971` / `978` / `1017` 不在此数组中** ——
> 想从数组反推「有哪些区块」会漏掉这 3 个，**必须以 `strings.xml` 为准。**

### 5.2 条目 → 证据文件对照

| # | 口径 | 资源 | smali |
| ---: | --- | --- | --- |
| 1 | 1025 | `ui_mediaactions.xml:6,10`；`arrays.xml:727-751,764-776`；`public.xml:8912-8913` | `player/H.smali:1071,1087,1170`；`player/PlayerService.smali:1195,1210,1218,9479,9487`；`player/b0.smali:8198` |
| 3 | 1025 | `feature_packages.xml:13-17`；`already_purchased.xml:5,7,8` | `preference/UberLevelPref.smali:1-2,65-114,151,240,252-317`；`prefs/B.smali:172-186`；`preference/BuyUberPref.smali:1,42,64` |
| 4 | 1025 | `decoded/AndroidManifest.xml`（`enableOnBackInvokedCallback`） | `widget/base/О.smali:28,49,58,78,97,156-178,184-226`；`widget/base/P.smali:84` |
| 5 | 1025 | `poweramp_builtin_skins.xml:13-17,80-84`；`strings.xml`（`applied_for_alt_full`） | `res/values/styles.xml:13358-13375`（1035：`:12094-12111`） |
| 6 | 1025 | `vis.xml:8,9,10,12,13` | `widget/player/h0.smali:864,870`；`widget/player/o2.smali:652,655,702-733,790-819,4740-4780` |
| 7 | 1025 | `aa_bg.xml:7,8,9,10` | `widget/player/h0.smali:1199-1227`；`widget/player/MilkWidget.smali:1063-1122`；`preference/j0.smali:86,371,448-478` |
| 8 | 1025 | `ui_lyrics.xml:11`；`ui.xml:22`（对照） | `widget/player/h0.smali:1239-1247`；`list/q.smali:1785,1791,1872`；`list/h0.smali:15` |
| 9 | 1025 | `ui_player.xml:25,26`；`arrays.xml:638-658`；`public.xml:8722` | `prefs/В.smali:1793,1811,1813,1827`；`list/А.smali:110,114-142`；`list/ListWidget.smali:237,241-269` |
| 10 | 1025 | `ui.xml:18`；`arrays.xml:67-76` | `widget/player/h0.smali:844-862`；`widget/player/AnimTimeHelper.smali:42-152` |
| 11 | 1025 | `vis.xml:14`；`ui.xml:20`（`hide_status_bar`） | `widget/player/h0.smali:334-340,1271-1287,1504-1541`；`widget/player/p2.smali:169-245,632-645`；`widget/base/FitsNavigationBarView.smali:63`、`widget/base/FitsStatusBarView.smali:82` |
| 12 | 1025 | `ui_player.xml:22`；`arrays.xml:388-401,564-571` | `widget/player/h0.smali:1289-1303`；`list/А.smali:1152-1190` |
| 13 | 1025 | `ui.xml:7`；`arrays.xml:883-888`；`public.xml:12209,12210,12461` | `prefs/В.smali:1127-1133`；`preference/SettingsActivity.smali:816-846`；`preference/k0.smali:2368-2382`；`preference/c3.smali:177-214`；`Application.smali:2769-2785` |
| 14 | 1025 | — | `common/j.smali:1999,2026-2062,2066-2079,2081-2093`；`v1035/.../ׅ/td1.smali:4616,4648` |
| 16 | 1025 | `poweramp_builtin_skins.xml:23-27,90-94`；`attrs.xml:3627`；`public.xml:2911`；`styles.xml:415-417,10703`；`values-v25/styles.xml:596` | （经 `common/j` 的 `applySkinOptionsImpl`，见 `poweramp-skin-overlap-apply.md`） |
| 17 | 1025 | `poweramp_builtin_skins.xml:18-22,85-89`；`attrs.xml:3241`；`public.xml:2690`；`styles.xml:92,95,103,484-490,505-509,3174,14280-14287` | 同上 |
| 18 | 1025 | `ui_player.xml:6,7`；`public.xml:3203` | `widget/player/h0.smali:648-654,1481-1487`；`common/j.smali:526-550`；`audioplayer/widget/MarqueeFastTextView.smali:13-17` |
| 19 | 1025 | `poweramp_builtin_skins.xml:124-128`；`styles.xml:19037-19039`（1035：`:14838-14840`） | （`overlapStyle` 直通，无 smali 侧分支） |
| 20 | **1035** | `v1035/decoded/AndroidManifest.xml:149,154-160,161,166-172`；`res/xml/widget_samsung.xml:2`；`widget_4x2_cover.xml:2`；`widget_4x4_cover.xml:2` | `v1035/.../widgetpackcommon/Widget4x2ProviderCover.smali:1-2,48-61,63-72,75-83,87-103,123-143,166-178`；`Widget4x4ProviderCover.smali:1,160`；`Widget4x2ConfigureCover.smali:1,25`；`ׅ/ar.smali:625,639` |
| 21 | **1035** | `v1035/decoded/res/values/strings.xml`（见 §1.2-21 文案表） | `v1035/.../player/InternalAPIReceiver.smali:21,236-265,269-320,346-395,473-520`；`v1035/.../preference/SkinGearRadioPreference.smali:79,339,348` |
| 22 | **1035** | `strings.xml`（`pref_skin_export_settings` / `pref_skin_import_settings` / `skin_settings_*` 共 11 条） | `SkinExportSettingsPreference.smali:1-2,23,33,618`；`SkinImportSettingsPreference.smali:23,110-198`；`ׅ/ed1.smali:52-139`；`ׅ/dd1.smali:62-190`；`ׅ/kd1.smali:2279-2923`；`ׅ/mj.smali:120,146` |
| 24 | **1035** | `poweramp_builtin_skins.xml:12,13,81,82`；`attrs.xml:2968,2977`；`public.xml:2535,2544`；`styles.xml:93,97,106,2029,2030,2120,9637,9638,14844-14858,15089-15103,15239-15253` | `v1035/.../common/BaseMainActivity.smali:60-176`；`v1035/.../MainActivity.smali:140-360` |

### 5.3 复验命令

**B 制（`路径:行号`）**：本文所有 smali 引用均可直接在
`.rea-analysis/smali/smali/`（1025）或 `.rea-analysis/v1035/decoded/smali/`（1035）下回读。

```
# 核验 #18 的 overlapAttr 覆盖链（1025）
$l = Get-Content -LiteralPath '.rea-analysis/smali/smali/com/maxmpz/audioplayer/common/j.smali' -Encoding UTF8
$l[525]   # 期望：sget-object p1, Lcom/maxmpz/widget/player/h0;->M:...
$l[531]   # 期望：sget-object p1, Lcom/maxmpz/widget/player/h0;->O0:...
$l[537]   # 期望：const p1, 0x7f010c80
$l[549]   # 期望：invoke-virtual {p0, p1, v3}, ...Theme;->applyStyle(IZ)V

# 核验 #24 的 blended 竖屏判定（1035）
$m = Get-Content -LiteralPath '.rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/MainActivity.smali' -Encoding UTF8
$m[139]   # 期望：.method public final isBlendedPortraitWindow()Z
$m[224]   # 期望：if-le v1, v0, :cond_1
```

**XML / 资源侧**：`文件:行号` 均为物理行号（1 起点），用 `read` 直接回读即可。

**区块键勘验**（§5.1）：

```
foreach ($b in 'decoded','v1035\decoded') {
  $p = ".rea-analysis/$b/res/values/strings.xml"
  $n = (Select-String -LiteralPath $p -Pattern '<string name="changelog' -AllMatches).Count
  "$b : $n"
}
# 期望：decoded : 11       v1035\decoded : 12
```

---

## 6. 相关文档

| 文档 | 关系 |
| --- | --- |
| `poweramp-release-changelog.md` | changelog 原文（本文条目的上游） |
| `poweramp-corpus-conventions.md` | **前置必读**：A/B 两制、版本域、混淆命名 |
| `poweramp-plugin-system-index.md` | 插件系统 40 篇总览（皮肤解析基础链在此） |
| `poweramp-impl-index.md` | 8 篇已实现投票总览（本文 #15/#25 引用其 idea15） |
| `poweramp-skin-system.md` | 皮肤系统总述（本文 #16/#17/#19/#24 的基础机制，不重述） |
| `poweramp-skin-parsing-chain.md` | skin XML → SkinInfo/SkinOption 解析链 |
| `poweramp-skin-overlap-apply.md` | **overlapAttr 应用与叠加顺序**（本文 P3/N5/N6 的机制依据） |
| `poweramp-look-and-feel-settings.md` | 外观分支 8 个 XML 的完整结构（本文只取与本批条目相关的节点） |
| `poweramp-visualization-settings.md` | `vis.xml` 全表（本文 #6/#11 的对照） |
| `poweramp-background-settings.md` | `aa_bg.xml` 全表（本文 #7 的对照） |
| `poweramp-settings-fragment-dispatch.md` | `f0` 分发表：`aa_bg`→`j0`、`vis`→`n3`、`ui`/`ui_player`/`ui_theme`→`k0` |
| `poweramp-impl-idea15-custom-buttons.md` | Customizable Player Screen Buttons（#15/#25 已覆盖，本文不重做） |

---

> 口径：**build-1025-uni（versionCode 1025009）为主域；build-1035-bundle-play（1035009）为补域**。
> 每条目均已标注口径；未标注者默认为 build-1025。
