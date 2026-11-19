---
doc_id: "ARCH-POWERAMP-PLUGIN-SYSTEM-INDEX"
title: "插件系统逆向：40 篇专文总览"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 2
open_items: 6
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统（目标循环，18 轮）"
  - "40 篇 poweramp-{plugin,skin,pak,...}*.md 专文"
---

# 插件系统逆向：40 篇专文总览

> 本文件是插件系统 **40 篇专文**的统一入口。
> 排序即**逆向顺序**：第 N 篇建立在第 1..N-1 篇的结论之上。

**统计**：46 项已闭合 · 8 项硬边界 · 6 项其它（详见 §5）

---

## 0. 一览表

| # | 主题 | 核心机制 | 专文 | 未解 |
| ---: | --- | --- | --- | ---: |
| 1 | 类型与发现链（三层叠加） | 20 内置插件、位域类型枚举、三条发现路径 | `poweramp-plugin-system.md` | 2 |
| 2 | 实例绑定（命名约定反射） | uniqName→类名派生 15/20、三级缓存、负缓存哨兵 | `poweramp-plugin-instances.md` | 1 |
| 3 | 插件列表页与设备绑定 | 按设备反查插件、三种跳转分支 | `poweramp-plugin-device-binding.md` | 1 |
| 4 | 设置分发中枢 f0 | 58 分支、17 个 helper、k0 兜底 23 页 | `poweramp-settings-fragment-dispatch.md` | 0 |
| 5 | pak 四种 URI scheme | builtin/compiled/dir/apk:// | `poweramp-pak-uri-schemes.md` | 0 |
| 6 | 皮肤体系（meta-data 发现） | com.maxmpz.PowerampSkins、overlapAttr 覆盖 | `poweramp-skin-system.md` | 0 |
| 7 | 设备选项页 c1 | __avail_hires 伪插件、31 个偏好键 | `poweramp-plugin-device-opts-handler.md` | 0 |
| 8 | uniqName 命名全链路 | 四处派生、pa_output_* 约定 6/6 | `poweramp-plugin-naming-convention.md` | 1 |
| 9 | byte[] 命令协议 | 0x20 最小长度、msgID 偏移 0x14、LE | `poweramp-plugin-command-protocol.md` | 2 |
| 10 | 描述符字段与 StateBus | A/x/y = name/desc/info 资源 id；b4 是计算属性 | `poweramp-plugin-descriptor-fields.md` | 0 |
| 11 | 输出插件选择链 | 四级降级、`flags & 0x80000003` vs `& 0x3`、OutputOpts | `poweramp-plugin-output-selection.md` | 0 |
| 12 | 皮肤解析链 | SkinInfo 4572 行 / SkinOption 204 行、16 个 overlap_* 属性 | `poweramp-skin-parsing-chain.md` | 0 |
| 13 | `apk://` 物理定位 | 自己包/外部包分流、`x1.c` 返回 `В{А,B}` | `poweramp-pak-apk-resolution.md` | 0 |
| 14 | pak zip 扫描 | native 迭代器、assets/milk_presets/ 前缀、10000 上限 | `poweramp-pak-zip-scanning.md` | 1 |
| 15 | pak 数据模型 | 两表 8 条预编译 SQL、容器两段式写入 | `poweramp-pak-data-model.md` | 0 |
| 16 | pak 读取侧 | `MilkRestProvider` CRUD + `GROUP BY type` 聚合 | `poweramp-pak-read-side.md` | 0 |
| 17 | 文件名解析 | `名称 - 作者` 约定、`out[0]`=author | `poweramp-pak-filename-parsing.md` | 0 |
| 18 | lib 元素与原生库 | `lib`/`libBasePath`、`mapLibraryName` | `poweramp-plugin-lib-declaration.md` | 0 |
| 19 | 设备选项页阶段 | `c1.z()` 32 键 / 九阶段 | `poweramp-device-opts-render-stages.md` | 0 |
| 20 | overlap 应用机制 | `applyStyle(,true)` 强制覆盖、`AUtils.F` attr→style | `poweramp-skin-overlap-apply.md` | 1 |
| 21 | 残余项闭合 | DDL 缺失、`х.Н` 死字段 | `poweramp-plugin-residual-closure.md` | 0 |
| 22 | 最终闭合 | StateBus 语义、`plugin/у`、外部皮肤根元素 | `poweramp-plugin-final-closure.md` | 0 |
| 23 | 容器 type 位域 | 4 种 flag + `zip://` 内嵌 scheme | `poweramp-pak-container-type-flags.md` | 0 |
| 24 | OutputOpts flags 位域 | 9 个偏好布尔 or 合成、`0x1010` | `poweramp-output-opts-bitfield.md` | 1 |
| 25 | builtin vs compiled | `y(false)` vs `y(true)`、type 扩至 6 种 | `poweramp-builtin-compiled-diff.md` | 1 |
| 26 | `utils/m` 自定义哈希表 | 双数组 + 0.8 负载 + 负数编码插入点 | `poweramp-utils-m-hashmap.md` | 0 |
| 27 | scanContainer 分派 | 八出口、兜底空扫描、清理分流 | `poweramp-scan-container-dispatch.md` | 0 |
| 28 | 音频 flags 位矩阵 | UI 掩码与合成表交叉验证 | `poweramp-audio-flags-matrix.md` | 0 |
| 29 | 跨包资源解析 | `getResourcesForApplication().getXml()` | `poweramp-cross-package-resources.md` | 0 |
| 30 | milk/data 数据层 | 四类映射、预设 `shuffle_order` 随机重排 | `poweramp-milk-data-layer.md` | 0 |
| 31 | 阶段⑤ 动态列表 | `NumberListPreference`、192kHz 上限 | `poweramp-audio-param-stage.md` | 1 |
| 32 | 四项残余批量闭合 | 调用方、迭代器、日志、SQL 片段 | `poweramp-residual-batch-closure.md` | 0 |
| 33 | `w()` 开关装配 | 十参签名、掩码语义 | `poweramp-w-switch-assembly.md` | 0 |
| 34 | msgID 与 native 互证 | 错误串对照、`plugin_id` | `poweramp-msg-protocol-native-evidence.md` | 1 |
| 35 | `w()` 条件可用性 | 能力位判定、禁用 vs 移除 | `poweramp-w-conditional-enable.md` | 0 |
| 36 | lib 单值 + 下划线 | 仅支持 1 个 lib、跳过前导下划线 | `poweramp-lib-single-and-underscore.md` | 0 |
| 37 | 伪值与混淆合并 | 唯一伪值 `__avail_hires`、4 接口合并 | `poweramp-pseudo-values-and-obfuscation.md` | 0 |
| 38 | type 是不透明标记 | 位域解读证伪（0 处位运算） | `poweramp-opaque-type-marker.md` | 0 |
| 39 | 边界终账 | `Х()` 无 zip 逻辑、8 项定性 | `poweramp-final-boundary-ledger.md` | 0 |
| 40 | OutputOpts 八字段 | `toString` 自证全部字段名 | `poweramp-output-opts-fields.md` | 0 |
| | | | **合计** | **6** |
---

## 1. 五层架构总图

```
┌───────────────────────────────────────────────────────────┐
│  声明层                                                    │
│  poweramp_builtin_plugins.xml（20 条）                     │
│  poweramp_builtin_skins.xml（2 皮肤）                      │
│  <lib> 子元素（原生库，仅 1 个）                            │
└───────────────┬───────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────┐
│  发现层                                                    │
│  插件：assets XML 0x7f160020 + PluginDiscovery（1171 行）   │
│  皮肤：meta-data com.maxmpz.PowerampSkins                  │
│  pak ：6 种 URI scheme（含内嵌 zip://）                     │
│  ⚠ native_get_plugins / native_get_zip_names_iterator      │
└───────────────┬───────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────┐
│  实例层                                                    │
│  uniqName → 反射 *PluginService（15/20 可行）              │
│  缓存：utils/m 手写哈希表（8 起步 / 0.8 负载）              │
│  输出选择：四级降级 → OutputOpts                           │
└───────────────┬───────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────┐
│  配置层                                                    │
│  音频 flags 双轨：32 位合成（i.А）/ 64 位能力（w()）        │
│  偏好：c1 32 键 / 9 个 w() 开关 / requestedCaps=0x1010     │
└───────────────┬───────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────┐
│  呈现层                                                    │
│  f0 分发（58 分支 / 17 helper）                            │
│    ├─ k0 → 插件列表页（按设备反查）                        │
│    └─ c1 → 设备选项页（九阶段、__avail_hires）             │
│  StateBus：b4 = plugin_id、bb = device                     │
└───────────────────────────────────────────────────────────┘
```

---

## 2. 核心不变量

| 不变量 | 说明 | 篇 |
| --- | --- | ---: |
| `uniqName` 是唯一键 | 一个字符串驱动类名/包名校验/pref key/缓存键 | 八 |
| **bit31 = 内置标志** | 低 8 位是角色，两值可用 `{内置, 外部}` 并列 | 一、三 |
| **命名约定即注册表** | 无配置、无注解，改包名即失效 | 二 |
| **XML 是文案层** | 不是存在性声明（2 个插件无 XML、5 个无 Service） | 二 |
| **单 Fragment 多 helper** | 全设置共用一个 `f0` | 四 |
| **三条扩展路径互相独立** | 插件/皮肤/pak 机制各异，成熟度不同 | 五、六、二十九 |
| **资源引用与字面量双轨** | `A != 0` 判定，外部 pak 可本地化 | 十 |
| **音频 flags 分两套宽度** | `i.А()` 合成 32 位；`w()` 用 64 位能力位 | 二十四、三十五 |
| **type 不是位域** | 值关系是巧合，全库 0 处位运算 | 三十八 |
| **每个开关都带能力掩码** | `flags & mask` 决定是否可用 | 三十五 |

---

## 3. 硬边界（8 项，native 不可达）

| # | 边界 | 原因 | 篇 |
| ---: | --- | --- | ---: |
| 1 | `native_get_plugins()` 返回值 | native 方法无方法体 | 一 |
| 2 | `native_get_zip_names_iterator` | 同上 | 十四 |
| 3 | `native_get_compiled_names_iterator` | 同上 | 二十五 |
| 4 | 插件/皮肤的实际实现逻辑 | 在 `.so` 内 | 二 |
| 5 | byte[] 命令生成端 + msgID 枚举 | 常量编译进代码段 | 九、三十四 |
| 6 | `milk_presets` 的 DDL | Java 与 native 均无建表语句 | 二十一 |
| 7 | 设备能力列表来源 | native 查询 | 三十一 |
| 8 | 音频引擎绑定点 | native 内部 | 一 |

---

## 4. 六处重要订正

> 这些结论在初稿中写错，经后续轮次实证后纠正。
> **共同成因**：看到常量就推断语义，未验证消费端。

| 原误判 | 实际 | 订正篇 |
| --- | --- | ---: |
| `applyStyle(..., false)` 先到先得 | **`true`**，后处理者覆盖 | 二十 |
| `builtin:` 与 `compiled:` 行为相同 | `y(false)` vs `y(true)` | 二十五 |
| "跨 pak 去重" | **容器内**唯一（含 `parent_id`） | 十五 |
| `parts[0]`→name | `out[0]`→**author** | 十七 |
| `singlepane` 有 8 个分支 | 实为 `k0` 构造参数 | 四 |
| `0x1` 表示不参与 flags | **bit0 掩码**（Chromecast 可用） | 三十五 |

---

## 5. 剩余 6 项

| 篇 | 问题 | 性质 |
| ---: | --- | --- |
| 9、34 | `0x00-0x13` 二十字节头部布局（**同一项**） | Java 不读、native 无常量表 |
| 24 | bit4（`0x10`）由谁设置 | `H` 是纯字段容器，设置点不在 Java |
| 31 | 设备能力列表填充来源 | native 查询 |
| 3 | 外部插件设置界面如何被唤起 | 需外部 pak 样本 |
| 1 | 音频引擎绑定点 | native 内部 |
| 34 | `FLAG_CMD_MSG_USED_NOW` 的确切作用 | native 代码段 |

> 去重后为 **5 个独立问题**，全部属硬边界或需外部样本。

---

## 6. 关键代码锚点速查

| 主题 | 位置 |
| --- | --- |
| 类型解析 | `plugin/NativePluginManager.smali:132-257`（`X(String,Z)I`） |
| 描述符类 | `plugin/х.smali`（68 行，11 字段） |
| 插件发现 | `player/router/A.smali:2463-3633`（1171 行） |
| 设置分发 | `preference/f0.smali:141-956`（58 分支） |
| 设备选项页 | `preference/c1.smali:497-2723`（2226 行） |
| 开关装配 | `preference/c1.smali:330-410`（`w()`） |
| 位域合成 | `preference/i.smali:322-466`（`А(ByteBuffer,H)`） |
| 输出选择 | `player/r.smali:1670-1985`（`К(...)`） |
| OutputOpts | `processing/А.smali`（175 行） |
| 命令协议 | `plugin/milk/MilkPluginService.smali:139-248` |
| 皮肤解析 | `plugin/SkinInfo.smali`（4572 行） |
| overlap 应用 | `common/j.smali:1820-1900` |
| pak 扫描 | `milk/scanner/B.smali:499-806`（`X(String)`） |
| pak 两表 | `milk/scanner/B.smali:40-126`（8 条预编译 SQL） |
| pak 读取 | `milk/data/MilkRestProvider.smali:120-533` |
| 实例缓存 | `utils/m.smali`（764 行手写哈希表） |

---

## 7. 相关文档

| 文档 | 关系 |
| --- | --- |
| `poweramp-corpus-conventions.md` | **引用体系与版本域**（必读） |
| `poweramp-impl-index.md` | 已实现投票 8 篇总览 |
| `poweramp-feature-votes.md` | 投票清单母文档 |
| `poweramp-settings-root-structure.md` | 设置树根索引 |
| `poweramp-release-changelog.md` | 版本记录（插件相关变更的 build 号） |
| `poweramp-changelog-index.md` | 版本更新逐条逆向总索引 |

> **口径**：`build-1025-uni (versionCode 1025009)`。
> 引用 `ׅ/` 系列路径时对应 build-1035，不可与 1025 混用。
