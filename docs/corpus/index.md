---
doc_id: "INDEX-CORPUS"
title: "逆向语料索引"
doc_type: "index"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
created: "2026-11-20"
updated: "2026-11-20"
source_documents:
  - "docs/README.md"
---

# 逆向语料索引

138 篇。Poweramp 与 foobar2000 的逆向取证存档：这里只存**证据和结论**，不定义 SpMusic 该怎么做。

引用语料结论时先读 [poweramp-corpus-conventions.md](./poweramp-corpus-conventions.md)：它说明版本域（build-1025 / build-1035）、证据口径和命名映射，不读会遇到「名字对得上但文件不存在」的假故障。

## 分组

### 插件系统（12）

插件类型发现链、实例绑定、输出选择与设备 opts 处理。

- [插件系统（九）：byte[] 命令协议与结构体布局](./poweramp-plugin-command-protocol.md) · `ARCH-POWERAMP-PLUGIN-COMMAND-PROTOCOL`
- [插件系统（十）：描述符字段语义与 StateBus 当前插件链](./poweramp-plugin-descriptor-fields.md) · `ARCH-POWERAMP-PLUGIN-DESCRIPTOR-FIELDS`
- [插件系统（三）：插件列表页、设备绑定与跳转关联](./poweramp-plugin-device-binding.md) · `ARCH-POWERAMP-PLUGIN-DEVICE-BINDING`
- [插件系统（七）：设备选项页 helper c1 与 __avail_hires 伪插件](./poweramp-plugin-device-opts-handler.md) · `ARCH-POWERAMP-PLUGIN-DEVICE-OPTS-HANDLER`
- [插件系统（二十二）：最终闭合——StateBus 语义、plugin/у、外部皮肤根元素](./poweramp-plugin-final-closure.md) · `ARCH-POWERAMP-PLUGIN-FINAL-CLOSURE`
- [插件系统（二）：实例绑定与命名约定反射](./poweramp-plugin-instances.md) · `ARCH-POWERAMP-PLUGIN-INSTANCES`
- [插件系统（十八）：lib 元素、原生库声明与描述符字段终订正](./poweramp-plugin-lib-declaration.md) · `ARCH-POWERAMP-PLUGIN-LIB-DECLARATION`
- [插件系统（八）：uniqName 命名约定全链路](./poweramp-plugin-naming-convention.md) · `ARCH-POWERAMP-PLUGIN-NAMING-CONVENTION`
- [插件系统（十一）：输出插件选择链与 OutputOpts](./poweramp-plugin-output-selection.md) · `ARCH-POWERAMP-PLUGIN-OUTPUT-SELECTION`
- [插件系统（二十一）：残余项闭合——建表语句与死字段](./poweramp-plugin-residual-closure.md) · `ARCH-POWERAMP-PLUGIN-RESIDUAL-CLOSURE`
- [插件系统逆向：40 篇专文总览](./poweramp-plugin-system-index.md) · `ARCH-POWERAMP-PLUGIN-SYSTEM-INDEX`
- [Poweramp 插件系统：页面、声明清单与发现链](./poweramp-plugin-system.md) · `ARCH-POWERAMP-PLUGIN-SYSTEM`

### 版本变更日志（8）

12 个版本区块 149 条更新的逐条落地。

- [Poweramp changelog 逐条逆向（音频输出与解码，36 条）](./poweramp-changelog-audio-output.md) · `ARCH-POWERAMP-CHANGELOG-AUDIO-OUTPUT`
- [Poweramp changelog 逆向：耳机/蓝牙 + 播放控制 + 设置杂项（59 条）](./poweramp-changelog-headset-misc.md) · `ARCH-POWERAMP-CHANGELOG-HEADSET-MISC`
- [版本更新逐条逆向：总索引（12 个版本区块 / 149 条）](./poweramp-changelog-index.md) · `ARCH-POWERAMP-CHANGELOG-INDEX`
- [Poweramp changelog 逐条逆向：库、列表与扫描（25 条）](./poweramp-changelog-library.md) · `ARCH-POWERAMP-CHANGELOG-LIBRARY`
- [版本更新深链锚点验证：66 个链接的落点核查](./poweramp-changelog-link-anchor-verify.md) · `ARCH-POWERAMP-CHANGELOG-LINK-ANCHOR-VERIFY`
- [版本更新逆向：残余项再闭合（4 项）](./poweramp-changelog-residual-closure.md) · `ARCH-POWERAMP-CHANGELOG-RESIDUAL-CLOSURE`
- [Poweramp changelog「UI 与皮肤」29 条逐条逆向（build-1025 主域 / build-1035 补域）](./poweramp-changelog-ui-skin.md) · `ARCH-POWERAMP-CHANGELOG-UI-SKIN`
- [Poweramp 版本更新记录（build 971–103x，含设置深链与逆向入口）](./poweramp-release-changelog.md) · `ARCH-POWERAMP-RELEASE-CHANGELOG`

### 设置体系（11）

根结构、fragment 分发、搜索与 faststaticprefs 机制。

- [Poweramp 偏好存储引擎 FastStaticPrefs（mmap）完整解构](./poweramp-faststaticprefs.md) · `ARCH-POWERAMP-FASTSTATICPREFS`
- [插件系统（三十八）：type 是不透明标记——位语义的最终判定](./poweramp-opaque-type-marker.md) · `ARCH-POWERAMP-OPAQUE-TYPE-MARKER`
- [插件系统（三十七）：伪值与混淆类合并](./poweramp-pseudo-values-and-obfuscation.md) · `ARCH-POWERAMP-PSEUDO-VALUES-AND-OBFUSCATION`
- [Poweramp「导出/导入设置」完整实现（含 .poweramp-backup 格式逆向）](./poweramp-settings-export-import.md) · `poweramp-settings-export-import`
- [插件系统（四）：设置分发中枢 f0 与 17 个页面 helper](./poweramp-settings-fragment-dispatch.md) · `ARCH-POWERAMP-SETTINGS-FRAGMENT-DISPATCH`
- [Poweramp 设置页共享运行时机制（build-1035）](./poweramp-settings-page-runtime.md) · `poweramp-settings-page-runtime`
- [Poweramp「设置」根页面结构（外部实现）](./poweramp-settings-root-structure.md) · `ARCH-POWERAMP-SETTINGS-ROOT-STRUCTURE`
- [Poweramp 设置页「搜索」完整实现（SQLite FTS4 全文索引 + 自定义 Layout）](./poweramp-settings-search.md) · `poweramp-settings-search`
- [插件系统（二十六）：utils/m —— 插件实例缓存的自定义哈希表](./poweramp-utils-m-hashmap.md) · `ARCH-POWERAMP-UTILS-M-HASHMAP`
- [插件系统（三十五）：w() 的条件可用性机制（含第三十三篇订正）](./poweramp-w-conditional-enable.md) · `ARCH-POWERAMP-W-CONDITIONAL-ENABLE`
- [插件系统（三十三）：w() 开关装配与掩码语义](./poweramp-w-switch-assembly.md) · `ARCH-POWERAMP-W-SWITCH-ASSEMBLY`

### 列表选项（6）

列表选项矩阵与 SQL builder 构造。

- [Poweramp 专辑子页面「列表选项」的组织与实现（专辑歌曲分类）](./poweramp-album-songs-list-options.md) · `ARCH-POWERAMP-ALBUM-SONGS-LIST-OPTIONS`
- [Poweramp 列表选项实现层全解（排序状态字 / SQL 工厂 / 位索引 / 偏好键全表）](./poweramp-list-options-implementation.md) · `ARCH-POWERAMP-LIST-OPTIONS-IMPLEMENTATION`
- [Poweramp 全分类「列表选项」组织方式横向对照（排序 / 缩放 / 布局 / 记忆）](./poweramp-list-options-matrix.md) · `ARCH-POWERAMP-LIST-OPTIONS-MATRIX`
- [Poweramp 三个排序开关的设置页入口与生效链路](./poweramp-list-options-settings-entry.md) · `ARCH-POWERAMP-LIST-OPTIONS-SETTINGS-ENTRY`
- [Poweramp 列表选项 ORDER BY 构建器全解（含三个隐藏排序开关）](./poweramp-list-options-sql-builders.md) · `ARCH-POWERAMP-LIST-OPTIONS-SQL-BUILDERS`
- [Poweramp 列表选项弹窗参考（动态分组 + 每分类能力探测）](./poweramp-list-options.md) · `ARCH-POWERAMP-LIST-OPTIONS`

### 官方论坛取证（6）

开发者回复与用户诉求的原始取证。

- [Poweramp 论坛讨论取证：A-B Repeat 主题组](./poweramp-forum-ab-repeat.md) · `ARCH-POWERAMP-FORUM-AB-REPEAT`
- [论坛投票功能讨论：开发者回复取证总索引](./poweramp-forum-dev-responses-index.md) · `ARCH-POWERAMP-FORUM-DEV-RESPONSES-INDEX`
- [官方功能索引帖：开发者维护的投票总表与落地版本](./poweramp-forum-index-topic.md) · `ARCH-POWERAMP-FORUM-INDEX-TOPIC`
- [Poweramp 论坛讨论取证：歌词 Lyrics 主题组](./poweramp-forum-lyrics.md) · `ARCH-POWERAMP-FORUM-LYRICS`
- [Poweramp 官方论坛取证：队列 / 插入（Queue / Insert）](./poweramp-forum-queue-insert.md) · `ARCH-POWERAMP-FORUM-QUEUE-INSERT`
- [Poweramp 论坛取证：睡眠定时 / 界面交互 / EQ 声道平衡（开发者回复实录）](./poweramp-forum-ui-sleep-eq.md) · `ARCH-POWERAMP-FORUM-UI-SLEEP-EQ`

### 已实现投票（10）

社区投票前八项的实现方式。

- [Poweramp 官方功能投票清单（未完成 46 项 + 已完成 8 项）](./poweramp-feature-votes.md) · `ARCH-POWERAMP-FEATURE-VOTES`
- [已实现投票逐条逆向 #8：Repeat 按钮文案统一（idea 11）](./poweramp-impl-idea11-repeat-wording.md) · `ARCH-POWERAMP-IMPL-IDEA11-REPEAT-WORDING`
- [已实现投票逐条逆向 #7：Customizable Player Screen Buttons（idea 15）](./poweramp-impl-idea15-custom-buttons.md) · `ARCH-POWERAMP-IMPL-IDEA15-CUSTOM-BUTTONS`
- [已实现投票逐条逆向 #6：输出菜单改为设备优先（idea 39）](./poweramp-impl-idea39-device-first-output.md) · `ARCH-POWERAMP-IMPL-IDEA39-DEVICE-FIRST-OUTPUT`
- [已实现投票逐条逆向 #5：Bit Perfect / USB Exclusive（idea 40）](./poweramp-impl-idea40-bit-perfect.md) · `ARCH-POWERAMP-IMPL-IDEA40-BIT-PERFECT`
- [已实现投票逐条逆向 #4：Multiple item dragging in Playlists/Queue（idea 54）](./poweramp-impl-idea54-multi-drag.md) · `ARCH-POWERAMP-IMPL-IDEA54-MULTI-DRAG`
- [已实现投票逐条逆向 #3：Consistently refer to Player Screen（idea 55）](./poweramp-impl-idea55-player-screen.md) · `ARCH-POWERAMP-IMPL-IDEA55-PLAYER-SCREEN`
- [已实现投票逐条逆向 #2：Synced/Scrolling Lyrics from tags and LRC files（idea 57）](./poweramp-impl-idea57-synced-lyrics.md) · `ARCH-POWERAMP-IMPL-IDEA57-SYNCED-LYRICS`
- [已实现投票逐条逆向 #1：Add to Playlist/Queue at Start or Shuffled（idea 58）](./poweramp-impl-idea58-insert-position.md) · `ARCH-POWERAMP-IMPL-IDEA58-INSERT-POS`
- [已实现投票逐条逆向：八篇专文总览](./poweramp-impl-index.md) · `ARCH-POWERAMP-IMPL-INDEX`

### 音频输出与音效（7）

输出管线、参数级联与位标志位域。

- [插件系统（二十八）：音频输出 flags 位矩阵（UI 侧与合成侧对照）](./poweramp-audio-flags-matrix.md) · `ARCH-POWERAMP-AUDIO-FLAGS-MATRIX`
- [Poweramp 音频输出链路与独占输出（Native 层实证）](./poweramp-audio-output-pipeline.md) · `ARCH-POWERAMP-AUDIO-OUTPUT-PIPELINE`
- [插件系统（三十一）：阶段⑤ 音频参数的动态列表构建](./poweramp-audio-param-stage.md) · `ARCH-POWERAMP-AUDIO-PARAM-STAGE`
- [Poweramp「设置 → 音频」偏好结构（外部实现）](./poweramp-audio-settings-structure.md) · `ARCH-POWERAMP-AUDIO-SETTINGS-STRUCTURE`
- [插件系统（三十四）：msgID 协议与 native 侧字符串佐证](./poweramp-msg-protocol-native-evidence.md) · `ARCH-POWERAMP-MSG-PROTOCOL-NATIVE-EVIDENCE`
- [插件系统（二十四）：OutputOpts flags 位域与 0x1010 语义](./poweramp-output-opts-bitfield.md) · `ARCH-POWERAMP-OUTPUT-OPTS-BITFIELD`
- [插件系统（四十）：OutputOpts 八字段语义闭合](./poweramp-output-opts-fields.md) · `ARCH-POWERAMP-OUTPUT-OPTS-FIELDS`

### 曲库与列表视图（11）

Library 三视图、队列、最近播放与书签。

- [Poweramp 书签参考（独立表 + 播放位置快照）](./poweramp-bookmarks-view.md) · `ARCH-POWERAMP-BOOKMARKS-VIEW`
- [Poweramp 容器类分类页参考（年份 / 流派）](./poweramp-category-views.md) · `ARCH-POWERAMP-CATEGORY-VIEWS`
- [Poweramp 媒体库实体视图参考（专辑 / 艺术家 / 专辑艺术家 / 作曲家）](./poweramp-entity-views.md) · `ARCH-POWERAMP-ENTITY-VIEWS`
- [Poweramp「设置 → 媒体库」及 6 个子页的完整实现（build-1035）](./poweramp-library-full-implementation.md) · `poweramp-library-full-implementation`
- [Poweramp「设置 → 媒体库」偏好结构（build-1035）](./poweramp-library-settings.md) · `poweramp-library-settings`
- [Poweramp 媒体库三视图关系参考（所有歌曲 / 文件夹 / 文件夹层次结构）](./poweramp-library-three-views.md) · `ARCH-POWERAMP-LIBRARY-THREE-VIEWS`
- [Poweramp 播放队列运行逻辑参考记录（外部实现）](./poweramp-queue-runtime-reference.md) · `ARCH-POWERAMP-QUEUE-RUNTIME-REFERENCE`
- [Poweramp 队列参考（独立表 + 入队时间戳驱动）](./poweramp-queue-view.md) · `ARCH-POWERAMP-QUEUE-VIEW`
- [Poweramp 派生列表参考（最近播放 / 最近添加 / 最多播放 / 长 / Top Rated / Low Rated）](./poweramp-recents-views.md) · `ARCH-POWERAMP-RECENTS-VIEWS`
- [Poweramp 搜索逻辑及其对播放队列的影响（外部实现）](./poweramp-search-and-queue-impact.md) · `ARCH-POWERAMP-SEARCH-AND-QUEUE-IMPACT`
- [Poweramp 流参考（从创建到消费的完整链路）](./poweramp-streams-view.md) · `ARCH-POWERAMP-STREAMS-VIEW`

### 皮肤与外观（6）

皮肤解析链、重叠应用与可视化设置。

- [Poweramp「设置 → 外观」偏好结构（外部实现）](./poweramp-look-and-feel-settings.md) · `ARCH-POWERAMP-LOOK-AND-FEEL-SETTINGS`
- [Poweramp 行选中弹窗封面参考（行视图复用 + 场景切换）](./poweramp-row-popup-cover.md) · `ARCH-POWERAMP-ROW-POPUP-COVER`
- [插件系统（二十）：overlapAttr 的应用机制与叠加顺序](./poweramp-skin-overlap-apply.md) · `ARCH-POWERAMP-SKIN-OVERLAP-APPLY`
- [插件系统（十二）：皮肤解析链 SkinInfo / SkinOption 与 overlap 应用](./poweramp-skin-parsing-chain.md) · `ARCH-POWERAMP-SKIN-PARSING-CHAIN`
- [插件系统（六）：皮肤体系与 meta-data 发现](./poweramp-skin-system.md) · `ARCH-POWERAMP-SKIN-SYSTEM`
- [Poweramp「设置 → 可视化」偏好结构（build-1035）](./poweramp-visualization-settings.md) · `poweramp-visualization-settings`

### 锁屏与耳机（10）

锁屏媒体动作与耳机按键子树。

- [Poweramp「设置 → 耳机/蓝牙」完整参考（根页 + 3 个下钻 + 运行时全链路）](./poweramp-headset-complete.md) · `poweramp-headset-complete`
- [Poweramp「设置 → 耳机/蓝牙」的完整实现（build-1035）](./poweramp-headset-full-implementation.md) · `poweramp-headset-full-implementation`
- [Poweramp「设置 → 耳机/蓝牙」偏好结构（build-1035）](./poweramp-headset-settings.md) · `poweramp-headset-settings`
- [Poweramp「耳机/蓝牙」子树完整实现（含 commands_history / audio_focus / long_volume_controls）](./poweramp-headset-subtree.md) · `poweramp-headset-subtree`
- [Poweramp「设置 → 锁屏」分支总览与四份专文的导航索引](./poweramp-lockscreen-branch-overview.md) · `ARCH-POWERAMP-LOCKSCREEN-BRANCH-OVERVIEW`
- [Poweramp「设置 → 锁屏 → Buttons」子页（ui_mediaactions）完整实现](./poweramp-lockscreen-mediaactions-subpage.md) · `ARCH-POWERAMP-LOCKSCREEN-MEDIAACTIONS-SUBPAGE`
- [Poweramp「设置 → 锁屏」偏好结构完整实证](./poweramp-lockscreen-preference-tree.md) · `ARCH-POWERAMP-LOCKSCREEN-PREFERENCE-TREE`
- [Poweramp 锁屏残留未知的深挖闭合（R1–R8）](./poweramp-lockscreen-residual-closure.md) · `ARCH-POWERAMP-LOCKSCREEN-RESIDUAL-CLOSURE`
- [Poweramp 自绘锁屏（Poweramp Lock Screen）运行时完整实现](./poweramp-lockscreen-runtime.md) · `ARCH-POWERAMP-LOCKSCREEN-RUNTIME`
- [Poweramp「设置 → 锁屏」偏好结构（build-1035）](./poweramp-lockscreen-settings.md) · `poweramp-lockscreen-settings`

### 关于与授权（7）

关于页分支、许可状态机与运行时依赖。

- [Poweramp「关于 / 技术支持 / 命令历史 / 翻译」偏好结构（build-1035）](./poweramp-about-and-support-settings.md) · `poweramp-about-and-support-settings`
- [Poweramp「设置 → 关于」分支总览与专文导航](./poweramp-about-branch-overview.md) · `ARCH-POWERAMP-ABOUT-BRANCH-OVERVIEW`
- [Poweramp「设置 → 关于」根页（general）完整实现](./poweramp-about-general-page.md) · `ARCH-POWERAMP-ABOUT-GENERAL-PAGE`
- [Poweramp 授权状态机（AppLSHelper / q4）完整解构](./poweramp-about-license-state-machine.md) · `ARCH-POWERAMP-ABOUT-LICENSE-STATE-MACHINE`
- [Poweramp「设置 → 关于」分支的运行期依赖组件](./poweramp-about-runtime-deps.md) · `ARCH-POWERAMP-ABOUT-RUNTIME-DEPS`
- [Poweramp「设置 → 关于」子页完整实现（feature_packages / translations）](./poweramp-about-subpages.md) · `ARCH-POWERAMP-ABOUT-SUBPAGES`
- [Poweramp「已购买/购买方式」两页完整实现（付费解锁与恢复购买）](./poweramp-purchase-restore-settings.md) · `poweramp-purchase-restore-settings`

### 包与资源（10）

pak 容器格式、URI scheme 与跨包资源解析。

- [插件系统（二十五）：builtin 与 compiled 的真实差异、type 扩容](./poweramp-builtin-compiled-diff.md) · `ARCH-POWERAMP-BUILTIN-COMPILED-DIFF`
- [插件系统（二十九）：跨包资源解析机制与 uniqName 派生边界](./poweramp-cross-package-resources.md) · `ARCH-POWERAMP-CROSS-PACKAGE-RESOURCES`
- [插件系统（十九）：设备选项页 c1.z() 的渲染阶段划分](./poweramp-device-opts-render-stages.md) · `ARCH-POWERAMP-DEVICE-OPTS-RENDER-STAGES`
- [插件系统（十三）：apk:// pak 的物理定位与扫描分流](./poweramp-pak-apk-resolution.md) · `ARCH-POWERAMP-PAK-APK-RESOLUTION`
- [插件系统（二十三）：容器 type 位域与四种取值](./poweramp-pak-container-type-flags.md) · `ARCH-POWERAMP-PAK-CONTAINER-TYPE-FLAGS`
- [插件系统（十五）：pak 数据模型与 milk_presets 两表](./poweramp-pak-data-model.md) · `ARCH-POWERAMP-PAK-DATA-MODEL`
- [插件系统（十七）：pak 预设文件名解析算法](./poweramp-pak-filename-parsing.md) · `ARCH-POWERAMP-PAK-FILENAME-PARSING`
- [插件系统（十六）：pak 读取侧 ContentProvider 与统计查询](./poweramp-pak-read-side.md) · `ARCH-POWERAMP-PAK-READ-SIDE`
- [插件系统（五）：pak 资源定位的四种 URI scheme](./poweramp-pak-uri-schemes.md) · `ARCH-POWERAMP-PAK-URI-SCHEMES`
- [插件系统（十四）：pak zip 扫描与条目入库](./poweramp-pak-zip-scanning.md) · `ARCH-POWERAMP-PAK-ZIP-SCANNING`

### 背景与杂项（10）

背景设置、扫描容器分派、封面与收尾台账。

- [Poweramp 专辑图片选择器参考（候选项枚举 + 文件落盘 + aa_status 位掩码）](./poweramp-album-art-picker.md) · `ARCH-POWERAMP-ALBUM-ART-PICKER`
- [Poweramp「设置 → 专辑封面」偏好结构（build-1035）](./poweramp-album-art-settings.md) · `poweramp-album-art-settings`
- [Poweramp「设置 → 背景」偏好结构（build-1035）](./poweramp-background-settings.md) · `poweramp-background-settings`
- [插件系统（三十九）：边界终账——38 篇的收敛结论](./poweramp-final-boundary-ledger.md) · `ARCH-POWERAMP-FINAL-BOUNDARY-LEDGER`
- [插件系统（三十六）：lib 单值约束与下划线二次定位](./poweramp-lib-single-and-underscore.md) · `ARCH-POWERAMP-LIB-SINGLE-AND-UNDERSCORE`
- [插件系统（三十）：milk/data 数据层与预设随机排序](./poweramp-milk-data-layer.md) · `ARCH-POWERAMP-MILK-DATA-LAYER`
- [Poweramp「设置 → 其他」完整参考（根页 26 元素 + 4 分类 + 全部子页）](./poweramp-misc-complete.md) · `poweramp-misc-complete`
- [Poweramp「设置 → 其他」偏好结构（build-1035）](./poweramp-misc-settings.md) · `poweramp-misc-settings`
- [插件系统（三十二）：四项残余批量闭合](./poweramp-residual-batch-closure.md) · `ARCH-POWERAMP-RESIDUAL-BATCH-CLOSURE`
- [插件系统（二十七）：scanContainer 完整分派与兜底行为](./poweramp-scan-container-dispatch.md) · `ARCH-POWERAMP-SCAN-CONTAINER-DISPATCH`

### 语料规范与总览（1）

证据制度、版本域与命名映射（读任何语料前先读）。

- [Poweramp 逆向语料的可复验约定（证据制度 / 版本域 / 命名映射）](./poweramp-corpus-conventions.md) · `ARCH-POWERAMP-CORPUS-CONVENTIONS`

### foobar2000 研究（23）

查询语法、曲库机制、foobaka 反汇编与阶段结论。

- [foobar2000 2.24.6 反汇编参考：查询引擎与关键结构](./foobar2000-disassembly-reference.md) · `ARCH-FOOBAR2000-DISASSEMBLY-REFERENCE`
- [foobar2000 / foobaka 逆向成果索引](./foobar2000-evidence-index.md) · `ARCH-FOOBAR-EVIDENCE-INDEX`
- [foobar2000 文件操作与播放列表格式](./foobar2000-fileops-playlist.md) · `ARCH-FOOBAR-FILEOPS-PLAYLIST`
- [foobar2000 与 foobaka mixture 研究 · DS 工具能力实测记录](./foobar2000-foobaka-ds-capabilities.md) · `TEST-FOOBAR2000-FOOBAKA-DS-CAPABILITIES`
- [foobar2000 与 foobaka 第二轮逆向研究及 SpMusic 实施方案](./foobar2000-foobaka-ds-phase-2-plan.md) · `TASK-FOOBAR2000-FOOBAKA-DS-PHASE-2`
- [foobar2000 与 foobaka 第三轮逆向执行方案](./foobar2000-foobaka-ds-phase-3-plan.md) · `TASK-FOOBAR2000-FOOBAKA-DS-PHASE-3`
- [foobar2000 与 foobaka mixture 双样本研究目标](./foobar2000-foobaka-ds-research-goals.md) · `TASK-FOOBAR2000-FOOBAKA-DS-RESEARCH`
- [foobar2000 与 foobaka 第二轮研究：候选实施卡与排序建议](./foobar2000-foobaka-phase-2-candidates.md) · `TASK-FOOBAR2000-FOOBAKA-PHASE-2-CANDIDATES`
- [foobar2000 与 foobaka 第二轮实验记录：样本、方法与逐项测量数据](./foobar2000-foobaka-phase-2-comparison.md) · `TEST-FOOBAR2000-FOOBAKA-PHASE-2-COMPARISON`
- [foobar2000 与 foobaka 第二轮逆向研究：汉化深度定量、主题二进制格式与组件宿主链](./foobar2000-foobaka-phase-2-findings.md) · `ARCH-FOOBAR2000-FOOBAKA-PHASE-2-FINDINGS`
- [foobar2000 第三轮实验记录：运行环境、Q1 检索实测与 L1 增量](./foobar2000-foobaka-phase-3-comparison.md) · `TEST-FOOBAR2000-FOOBAKA-PHASE-3-COMPARISON`
- [foobar2000 第三轮：运行证据与第二轮勘误](./foobar2000-foobaka-phase-3-findings.md) · `ARCH-FOOBAR2000-FOOBAKA-PHASE-3-FINDINGS`
- [扫描诊断候选实施卡（部分结果可诊断）](./foobar2000-foobaka-phase-3-scan-diagnostics.md) · `TASK-FOOBAR2000-FOOBAKA-PHASE-3-SCAN-DIAGNOSTICS`
- [foobar2000 第四轮实验记录：PCM 接缝、foobaka 数据层与 IS 语义](./foobar2000-foobaka-phase-4-comparison.md) · `TEST-FOOBAR2000-FOOBAKA-PHASE-4-COMPARISON`
- [foobar2000 第四轮：PCM 接缝闭环、foobaka 数据层与第三轮勘误](./foobar2000-foobaka-phase-4-findings.md) · `ARCH-FOOBAR2000-FOOBAKA-PHASE-4-FINDINGS`
- [foobar2000 界面类实验：移交具备完整桌面的操作者](./foobar2000-gui-operator-handoff.md) · `TASK-FOOBAR-HANDOFF-GUI-OPERATOR`
- [foobar2000 / foobaka 逆向研究交接文档](./foobar2000-handoff.md) · `ARCH-FOOBAR-HANDOFF`
- [foobar2000 / foobaka 逆向研究总结](./foobar2000-investigation-summary.md) · `ARCH-FOOBAR-INVESTIGATION-SUMMARY`
- [foobar2000 的 IS 运算符：完整语义与反汇编证据](./foobar2000-is-operator.md) · `ARCH-FOOBAR-IS-OPERATOR`
- [foobar2000 曲库持久化、增量核对、离线宽限与迁移机制（实测）](./foobar2000-library-mechanisms.md) · `ARCH-FOOBAR2000-LIBRARY-MECHANISMS`
- [foobar2000 公开资料研究与 SpMusic 借鉴方向](./foobar2000-research.md) · `ARCH-FOOBAR2000-RESEARCH`
- [foobar2000 检索语法与动态列表机制（实测）](./foobar2000-search-mechanisms.md) · `ARCH-FOOBAR2000-SEARCH-MECHANISMS`
- [foobar2000 主题容器（.fth）格式](./foobar2000-theme-format.md) · `ARCH-FOOBAR-THEME-FORMAT`

## 已有的专题总览页

这几篇本身也是语料，但承担二级索引入口：

- [poweramp-impl-index.md](./poweramp-impl-index.md) —— 8 篇已实现投票专文
- [poweramp-plugin-system-index.md](./poweramp-plugin-system-index.md) —— 40 篇插件系统专文（按逆向顺序）
- [poweramp-changelog-index.md](./poweramp-changelog-index.md) —— 版本变更逐条逆向的覆盖台账
- [foobar2000-evidence-index.md](./foobar2000-evidence-index.md) —— 24 篇 foobar2000 文档与 39 个证据文件的映射

## 语料与正文的关系

语料是**外部参照**，SpMusic 的能力边界以 `docs/architecture/`、`docs/implementation/` 和代码为准，不以语料里 Poweramp 做了什么为准。反向引用（正文 → 语料）目前很少，需要时说清楚引用的是哪条结论、用来支撑哪个决策。
