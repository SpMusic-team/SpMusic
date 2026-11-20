---
doc_id: "ARCH-POWERAMP-IMPL-IDEA40-BIT-PERFECT"
title: "已实现投票逐条逆向 #5：Bit Perfect / USB Exclusive（idea 40）"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 继续逐条逆向已实现投票"
  - "docs/corpus/poweramp-feature-votes.md"
  - "docs/corpus/poweramp-release-changelog.md（changelog_102x）"
  - ".rea-analysis/v1035/decoded/res/xml/audio_bit_perfect.xml"
  - ".rea-analysis/v1035/decoded/smali/ׅ/{g71,f71,dy1,t21,ee1}.smali"
---

# 已实现投票逐条逆向 #5：Bit Perfect / USB Exclusive（idea 40）

> **全清单票数最高（163 票）**，且是唯一跨 build 的功能：
> build-1025 产物里 `bit_perfect` / `usb_exclusive` 资源**完全不存在**，1035 才落地。
> `changelog_102x`（Builds 1026-1032）称之为 *"the top voted feature from the New Poweramp Features list"*。

## 0. 一句话结论

**这是"能力位掩码 + 按设备类型分档"的开关体系，不是单一开关。**

| 层 | 实现 | 规模 |
| --- | --- | --- |
| 页面 | `audio_bit_perfect.xml` | 19 行 / **4 开关** + 4 个运行期填充项 |
| Helper | `ׅ/g71` | **1294 行** |
| 能力枚举 | `ׅ/f71` | 2 值（`pipeline64_opts` / `follow_sr_opts`） |
| 掩码表 | `ׅ/dy1`（5 个 `Integer[]`，元素数 6/5/2/2/2） | 共用 10916 行常量类 |
| 查询协议 | `ׅ/ee1.B(lq,int)` | 位与判定 |

---

## 1. 四个开关（`audio_bit_perfect.xml`）

| order | key | 标题 | 配套项 |
| ---: | --- | --- | --- |
| 10 | `global_pipeline64` | 64-bit Audio Pipeline | `pipeline64_opts` + 两行提示 |
| 30 | `global_follow_sr` | Follow Track Sample Rate | `follow_sr_opts` + 一行提示 |
| 60 | `global_dsd_remaster` | DSD Remastering | `dsd_remaster_opts` + 一行提示 |
| 80 | `global_perfect_bit_perfect` | Perfect Bit Perfect | `perfect_bit_perfect_opts` + 三行提示 |

> **每个开关后紧跟一个 `RawTextPreference` 作为"选项行"**，由 helper 运行期渲染
> 该开关在当前设备上的可用档位（无标题、只有图标与正文）。

页面提示 `bit_perfect_hint1`：*"Each setting on this page can also be overridden individually
for the specific output or profile"* ⇒ **全局默认 + 按输出/配置覆盖** 两层结构。

---

## 2. 页面分发与 Helper

```
SettingsActivity → u61.smali:1333   const v0, 0x7f160004
                       → new ׅ/g71(SettingsActivity, u61, xmlId)   (:1343-1347)
```

`ׅ/g71`（1294 行）5 个方法：

| 方法 | 行 | 职责 |
| --- | ---: | --- |
| `<init>` | 26 | 取 `NativePluginManager`，按 `b71.k` 决定是否绑定 |
| `Q()` | 130 | **主渲染**：四开关监听器绑定 + 四 opts 行内容生成 |
| `B(I)` | 110 | 单开关状态刷新 |
| `А(String)` | 1251 | 字符串 → `f71` 枚举（`valueOf`） |
| `В()` | 1275 | 当前设备类型 → `f71.y` |

### 2.1 单开关的绑定模式（pipeline64 为例）

```smali
; g71:130-200
if (!b71.k) {
    sw   = findViewById("global_pipeline64")
    sw.setOnPreferenceChangeListener(new c71(this, 0))
    opts = findViewById("pipeline64_opts")
    this.z = (RawTextPreference) opts
}
```

> 四个开关**结构完全同构**，用同一个 `c71` 监听器类、**不同构造索引**（0/1/2/3）区分。

---

## 3. ★ 能力位掩码协议（本条核心）

### 3.1 能力枚举与掩码

`ׅ/f71` 是 `enum implements lq`，仅两个常量：

| 字段 | 常量名 | ordinal | `В()` 产出 |
| --- | --- | ---: | ---: |
| `f71.у` | `pipeline64_opts` | 0 | `1 << 0` = **1** |
| `f71.К` | `follow_sr_opts` | 1 | `1 << 1` = **2** |

`f71.В()`（`:194-212`）：

```smali
.method public final В()I
    const/4 v0, 0x1
    invoke-virtual {p0}, f71->А()I     ; А() = ordinal()
    shl-int/2addr v0, v1              ; ★ 1 << ordinal()
    return v0
```

### 3.2 查询协议 `ee1.B(lq,int)`（`:91-121`）

```smali
.method public static B(Lׅ/lq;I)Z
    caps = p0.В()              ; 设备/插件上报的能力位
    return (caps & p1) != 0    ; ★ 位与判定
```

> **这就是"按设备分档"的机制**：每个输出设备/插件上报一个 int 位掩码，
> 页面用 `1 << feature` 询问"你支持这一项吗"。

### 3.3 `dy1` 的 5 个掩码表

`<clinit>`（`:160-242`）：

| 字段 | 元素数（实测 aput 计数） | 用途（据取用点推断） |
| --- | ---: | --- |
| `dy1.А` | **6** | 主表 |
| `dy1.A` | **5** | pipeline64 支持时 |
| `dy1.х` | 2 | pipeline64 不支持时 |
| `dy1.Х` | 2 | follow_sr 支持时 |
| `dy1.X` | 2 | 默认 |

`g71` 取用点：`:138`(X) / `:270`(А) / `:278`(х) / `:597`(A) / `:605`(Х)。

> **口径修正**：初稿按"数组长度常量"误记为 5/2/2/2/2；实测按 `aput-object` 计数为
> **6 / 5 / 2 / 2 / 2**。原因是 `<clinit>` 里多个数组共用同一组寄存器缓存，
> 长度常量与元素个数不一一对应。

---

## 4. ★ 设备类型枚举（`t21.А(int)`，`:700-804`）

| 值 | 字符串 |
| ---: | --- |
| 0 | `headset` |
| 1 | `speaker` |
| 2 | `bt` |
| 3 | `usb` |
| 4 | `other` |
| 5 | `chromecast` |
| 其它 | `Unknown_ + 值` |

> 与 `audio_outputs2.xml` 的 6 个设备按钮**一一对应**。说明 **idea 39 与 idea 40 共用同一套设备分类**：
> 前者管"用哪个后端"，后者管"这个后端支不支持位精确"。

`g71.А(String)`（`:1251-1273`）是反向：`f71.valueOf(str)` 把 `"pipeline64_opts"` 转回枚举。

---

## 5. 四开关语义与相互关系

| 开关 | 摘要要点 | changelog 描述 |
| --- | --- | --- |
| `global_pipeline64` | *"Enables Float 64-bit audio pipeline from decoder to the output"* | 扩展内部格式到 Float64 |
| `global_follow_sr` | `summary_follow_track_sr` | 动态匹配曲目采样率 |
| `global_dsd_remaster` | `summary_dsd_remaster` | 转 DSD64-1024，可带/不带 PCM 域 DSP |
| `global_perfect_bit_perfect` | `summary_perfect_bit_perfect` | **禁用 DSP/增益/交叉淡入**，解码结果直出 |

> 四者**逐级收紧**：64-bit 提精度 → Follow Track 匹配采样率 → DSD Remaster 转格式 →
> Perfect 关闭所有处理直通。changelog 明说 Perfect 与 DSD Remaster *"can be combined"*，
> 但与 DSP/增益类设置**互斥**。

---

## 6. 与 USB Exclusive 的关系

| 概念 | 位置 | 归属 |
| --- | --- | --- |
| USB Exclusive Driver | `audio_outputs2.xml` → `output_usb` | idea 39 |
| Bit Perfect 四开关 | `audio_bit_perfect.xml` | **idea 40（本文）** |
| 按设备覆盖 | 设备选项页 `w:target="audio_bit_perfect"` | 两者共用 |

> changelog：Bit Perfect *"supported for Hi-Res, USB Exclusive, and partially AAudio"*——
> **同一套开关对三个后端生效程度不同**，这正是需要位掩码按设备查询的原因。

---

## 7. 可借鉴 / 不建议照抄

### 7.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **能力用位掩码 `1 << ordinal()`** | 一个 int 表 N 项能力，查询 O(1) |
| A2 | **全局默认 + 按设备覆盖两层** | 不必为每台设备重配 |
| A3 | **开关 + `*_opts` 成对声明** | UI 结构一致，渲染收敛到 `Q()` |
| A4 | **同一监听器类按索引区分** | 免写四个近似内部类 |
| A5 | **设备枚举与输出菜单共用** | 概念统一 |

### 7.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | `dy1` 10916 行 + 5 个匿名 `Integer[]` | 名字看不出对应哪档 |
| N2 | `g71.Q()` 1100+ 行，四开关分支交织 | 难独立测试 |
| N3 | 能力查询无文档 | 新增能力易错位 |

---

## 8. 本轮新增解出（原 Q1 / Q2 / Q3）

### 8.1 ★ `dy1` 五张表的**精确值**（Q1 闭合）

`<clinit>` 先把六个 `Integer` 缓存在寄存器里（`:69-132`）：

```smali
v1  = Integer(0)      v3  = Integer(3)      v5  = Integer(2)
v7  = Integer(1)      v9  = Integer(5)      v11 = Integer(4)

; 索引寄存器 v0=0 v6=1 v4=2 v2=3 v10=4 v8=5
```

逐 `aput-object` 还原后：

| 表 | 值 | 长度 |
| --- | --- | ---: |
| `dy1.А` | **[0, 3, 2, 1, 5, 4]** | 6 |
| `dy1.A` | **[0, 3, 2, 1, 4]** | 5 |
| `dy1.х` | **[0, 3]** | 2 |
| `dy1.Х` | **[0, 3]** | 2 |
| `dy1.X` | **[0, 3]** | 2 |

把值代入 `t21.А(int)`（设备枚举）后，语义立刻清晰：

| 表 | 展开为设备类型 | 含义 |
| --- | --- | --- |
| `dy1.А` | headset, usb, bt, speaker, chromecast, other | **全部 6 类设备** |
| `dy1.A` | headset, usb, bt, speaker, other | 6 类去掉 chromecast |
| `dy1.х` / `Х` / `X` | headset, usb | **只保留耳机与 USB** |

> **这解释了一切**：Bit Perfect 只对 **有线耳机（AUX）与 USB DAC** 有意义——
> 蓝牙有损、扬声器无意义、Chromecast 是网络投送。
> 三张力掩码表正是"该设备能不能做位精确"的白名单。
> `dy1.А`（6 类）用于**展示**（哪些设备支持），`dy1.х/Х/X`（2 类）用于**判定**。

### 8.2 两套能力体系与多态代理（Q2 闭合）

`f71.y` 只有一个写入者 `e71.B(int)`（`e71:32-67`），而 `e71` 是**多态代理**：

```smali
; e71.B(int)  :32-67
switch (this.X) {
    case 0: f71.y = p1;   return;     ; ★ Bit Perfect 体系
    default: m71.y = p1;  return;     ; ★ 另一套体系
}
```

两套体系各自在 `<clinit>` 建一个代理：

| 体系 | 枚举类 | 常量 | 代理构造 |
| --- | --- | --- | --- |
| Bit Perfect | `f71` | `pipeline64_opts` / `follow_sr_opts` | `f71:85` → `new e71(0)` |
| 另一套 | `m71` | `dvc_devices` | `m71:59` → `new e71(1)` |

于是 `g71.В()` 读 `f71.y`、`g71.А(str)` 走 `f71.valueOf`，两者都经由同一代理，
**用 `X` 字段区分当前问的是哪一套能力**。

> 这是很紧凑的写法：一个代理类 + 一个 switch 就复用了"位掩码 / 字符串→枚举 / 读当前值"三种操作。
> 代价是**两套枚举的字段同名**（都叫 `y`），读代码时必须先确认 `e71.X` 的取值。

### 8.3 native 边界的确切证据（Q3 闭合为硬边界）

对 `libpowerampcore.so` 做字符串扫描：

| 检索串 | 命中 |
| --- | ---: |
| `pipeline64` | **0** |
| `bit_perfect` / `bitperfect` | **0** |
| `follow_sr` | **0** |
| `dsd_remaster` / `perfect_bit` | **0** |
| `Float64` / `DoP` | **0** |
| `DSD` | 5 |

**四个开关名在 native 里一个都不存在**——它们纯粹是 Java 侧偏好键。
native 只认得"DSD"这个格式概念，来自 TagLib：

```
@469204  N6TagLib3DSF4FileE / N6TagLib3DSDIFF4FileE / N6TagLib6DSDIFF3TagE
@279474  "not configured to handle DSD WavPack files!"
@409360  "DSD"（枚举字符串表）
```

> ⇒ **Bit Perfect 的 Java 侧只到"把用户意图写进 FastStaticPrefs"为止**；
> 真正的"关闭 DSP / 改管线位宽 / 匹配采样率"发生在 native 音频引擎内部，
> 而该引擎的符号已被 strip（`poweramp-audio-output-pipeline.md` 已证实 `.dynstr` 无 AAudio 条目，
> 53 个 AAudio 符号全在 `.rodata`）。**这条到此为硬边界。**

---
## 9. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`dy1` 五数组元素值~~ | ✅ **已闭合**（§8.1）：还原为 `[0,3,2,1,5,4]` 等，实为**设备白名单** |
| ~~Q2~~ | ~~`f71.y` 写入点~~ | ✅ **已闭合**（§8.2）：`e71.B(int)`，由代理 `X` 字段区分的两套体系之一 |
| ~~Q3~~ | ~~四开关实际生效点~~ | ✅ **已确证为硬边界**（§8.3）：四个开关名在 `libpowerampcore.so` **零命中** |

> **Q3 是硬边界**：Bit Perfect 核心在 native 音频引擎，Java 侧只"采集意图 + 写偏好"。
> 与 `poweramp-audio-output-pipeline.md` 一致（AAudio 53 符号在 `.rodata`，控制流在 `.text` 未反汇编）。

---

## 10. 证据索引

| 主题 | 位置 |
| --- | --- |
| 页面全文 | `v1035/decoded/res/xml/audio_bit_perfect.xml`（19 行） |
| 页面分发 | `ׅ/u61.smali:1333-1347`（`0x7f160004` → `g71`） |
| Helper | `ׅ/g71.smali`（`Q()` `:130`、`В()` `:1275`、`А()` `:1251`） |
| 四开关绑定 | `g71.smali:154-199 / 483-520 / 782-807 / 1010-1064` |
| 能力枚举 | `ׅ/f71.smali`（`pipeline64_opts` / `follow_sr_opts`） |
| 掩码生成 | `f71.smali:194-212` |
| 查询协议 | `ׅ/ee1.smali:91-121` |
| 掩码表 | `ׅ/dy1.smali:160-242` |
| 设备枚举 | `ׅ/t21.smali:700-804` |
| 版本分水岭 | `poweramp-release-changelog.md`（`changelog_102x`） |
| 表精确值 | `ׅ/dy1.smali:69-242`（寄存器缓存 `:69-132`） |
| 多态代理 | `ׅ/e71.smali:32-67`（`B`）、`:69-102`（`А`）、`:114-139`（`В`） |
| 两套枚举 | `ׅ/f71.smali`（Bit Perfect）/ `ׅ/m71.smali`（`dvc_devices`） |
| 代理构造点 | `f71.smali:85`、`m71.smali:59` |
| native 零命中 | `libpowerampcore.so` 检索 `pipeline64`/`bit_perfect`/`follow_sr`/`dsd_remaster` 均 0 |
| native DSD 佐证 | `libpowerampcore.so` @469204（TagLib DSF/DSDIFF）、@279474、@409360 |

> 口径：**build-1035**（本条在 1025 不存在）。
