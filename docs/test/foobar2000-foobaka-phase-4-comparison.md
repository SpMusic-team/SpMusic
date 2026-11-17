---
doc_id: "TEST-FOOBAR2000-FOOBAKA-PHASE-4-COMPARISON"
title: "foobar2000 第四轮实验记录：PCM 接缝、foobaka 数据层与 IS 语义"
doc_type: "test-report"
owner_agent: "Test Agent"
status: "draft"
version_scope: "research"
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "docs/tasks/foobar2000-foobaka-ds-phase-3-plan.md"
  - "docs/architecture/foobar2000-foobaka-phase-3-findings.md"
  - "docs/test/foobar2000-foobaka-phase-3-comparison.md"
  - ".rea-analysis/phase4/run-20261118-p4a/"
---

# 第四轮实验记录

本文是运行期实验的原始记录。机制归因与勘误见 [phase-4 findings](../architecture/foobar2000-foobaka-phase-4-findings.md)。

## 零、一句话总结

**第三轮判定「A1 PCM 抓样不可能」是本机能力判断失误，不是环境限制。**
本机确实没有环回端点设备，但 **WASAPI 环回捕获（`AUDCLNT_STREAMFLAGS_LOOPBACK`）不需要设备支持**——
用 .NET COM 互操作自建录制器即可。**A1 本轮闭合。**

## 一、环境与执行纪律

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-18（Asia/Shanghai） |
| 主机 | Windows 11 x64，session 1 |
| 交互桌面 | `UserInteractive=True` |
| 权限 | **非管理员**（`IsAdmin=False`），本轮未使用任何提权通道 |
| 样本 | A′ 官方 foobar2000 2.24.6 x86；B foobaka Mixture 1.7.12 |
| 音频端点 | 默认渲染端点，混音格式 **48 kHz / 立体声 / 32-bit float** |
| 第三方工具 | ffmpeg/ffplay（gyan.dev full build，**无 `--enable-wasapi`**）、Python 3.13 |

**纪律**：所有写操作限于 `.rea-analysis/phase4/`；原始样本目录未被修改。
**未创建任何计划任务，未申请提权**（对应第三轮 §5.1b 事故教训）。

## 二、A1：PCM 接缝捕获（本轮闭合）

### 2.1 为什么第三轮判定「不可完成」

第三轮结论是「系统无环回捕获端点 + 两个 ffmpeg 构建都无 wasapi」。两个观察都**属实**：

| 第三轮观察 | 本轮复核 |
| --- | --- |
| 无 Stereo Mix / 立体声混音 / Wave Out Mix | **仍然属实** |
| `ffmpeg -list_devices -f dshow` 只列出麦克风类 | **仍然属实** |
| 本机 ffmpeg 无 `--enable-wasapi` | **仍然属实** |

**但推论错了**：这三条只说明「ffmpeg 这条路线走不通」，
不说明「本机无法捕获环回」。WASAPI 环回是**系统混音器自带能力**，
只要进程能调 COM 接口就能录，与设备是否暴露环回端点无关。

### 2.2 自制 WASAPI 环回录制器

用 PowerShell 7.7 / CLR 11 的 `Add-Type` 直接编译 C# 互操作代码，
调用 `IMMDeviceEnumerator` → `IMMDevice.Activate(IAudioClient)`
→ `Initialize(SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, ...)` → `IAudioCaptureClient`。

| 实现要点 | 说明 |
| --- | --- |
| COM 类型必须**单文件定义** | 两个源文件定义同 GUID 的 `ComImport` 类会导致 CLR 类型缓存冲突（`Unable to cast object of type 'X' to type 'Y'`） |
| 静音无音频时环回**不出包** | 不播放任何声音时 `GetNextPacketSize` 恒为 0，录制得到 0 帧 |
| 混音格式是 32-bit float | 需自行转 16-bit 写 WAV |

**关键前置发现**：首次录制只拿到峰值 1654（源为 32768）。查端点音量发现
`scalar=0.0000, mute=True`——**系统处于静音状态**（用户误触，已确认）。
解静音后峰值恢复 **32767**，链路保真成立。

### 2.3 负对照（计划 L65）

**目的**：证明录制链路能定位已知长度的静音。

| 项 | 值 |
| --- | --- |
| 源整轨 | `chirp_dec.wav`（441,000 帧 / 10.000 s） |
| 源带静音 | `chirp_with_gap250ms.wav`（452,025 帧，第 220,500 帧插入 11,025 帧 = 250 ms） |
| 地面真值 | 静音起点 5.000000 s，长度 250.000 ms |

**实测**：

| 项 | 结果 |
| --- | --- |
| 整轨捕获内部静音段 | **无**（阈值 240 帧） |
| 带静音捕获内部静音段 | **236057 起始，长 11,937 帧** |
| 折算时长（48 kHz） | **248.688 ms** |
| 误差 | **−1.312 ms** |
| **判定** | **PASS**（判据 ±2 ms） |

> 误差来自 44.1 kHz → 48 kHz 重采样的边界取样，非夹具错误。

### 2.4 主实验：两种接缝

**前置**：把夹具预转换为 48 kHz，**让系统混音器直通**，避免 44.1→48 的二次重采样。

**对齐方法**：先用 3000 帧窗口做逐帧最小平方误差对齐，再按 `alpha = dot(a,b)/dot(a,a)` 做整体增益校正。

| 用例 | 播放方式 | 对齐偏移 | 增益 | **最大误差** | **失配帧数** |
| --- | --- | ---: | ---: | ---: | ---: |
| 同文件 CUE 两分轨 | foobar2000 播放 `seam48.cue` | 24 帧 | 0.127203 | **0** | **0 / 480000** |
| A.flac → B.flac 双文件 | foobar2000 播放两个独立文件 | 24 帧 | 0.127203 | 246 | 6 / 480000 |

**这组数字的意义**：

- **CUE 分轨：逐样本完全一致（误差 0、失配 0）**——接缝处没有任何丢样、重样或插入。
- **双文件：6 个失配帧，最大偏差 246**。相对捕获峰值 4168 约为 **5.9%**，
  且全部是单帧级抖动（失配段均为 1 帧宽），属混音器增益转换的**量化噪声**，不是音频断层。

### 2.5 接缝处的直接证据

捕捉到接缝两侧的原始采样（捕获坐标 240024 = A 结束 / B 开始）：

```
f240022   L=-1893
f240023   L=-4168
f240024   L=0        ← 接缝点
f240025   L=3826
f240026   L=2235
```

**接缝前后 10 帧的 RMS 能量**：

| 窗口起点 | RMS |
| --- | ---: |
| 240004 | 3037.8 |
| 240014 | 2992.9 |
| **240024（接缝）** | **2853.5** |
| 240034 | 2872.7 |
| 240044 | 2981.8 |

**接缝前后 400 帧的零帧比例：0.25%（即 1 帧）**。

> 单个零帧是 chirp 波形自身的过零点，不是静音段。
> **能量没有塌陷、没有延迟、没有衰减包络** —— 这就是 gapless 的波形级证据。

### 2.6 这一节闭合了什么、没闭合什么

| 项 | 状态 |
| --- | --- |
| 本机能否捕获环回 PCM | **是**（自建 WASAPI 录制器） |
| 负对照能否定位 250 ms 静音 | **是**，误差 −1.312 ms |
| foobar2000 CUE 分轨接缝是否丢样 | **否**，逐样本零误差 |
| foobar2000 双文件续播是否丢样 | **无丢样**，6 个量化抖动帧 |
| 接缝是否 bit-perfect | **不能断言**：受共享混音器影响（增益 0.127、32f→16i 转换） |
| DAC 端行为 | **未知**：环回只能证明「PCM 到达混音器」 |

## 三、B（foobaka）数据层对照

### 3.1 版本性结构差异（本轮新发现）

| 维度 | A′ 2.24.6 | B foobaka 1.7.12 | 说明 |
| --- | --- | --- | --- |
| 播放列表目录 | `playlists-v2.0`（9 文件） | **`playlists-v1.4`**（2 文件） | **不同代**的存储格式 |
| 播放列表清单 | `index.txt`（BOM + 文本行） | **`index.dat`（二进制）** | 格式完全不同 |
| 单个列表 | `playlist-<GUID>.fplite` | **`<32位HEX>.fpl`** | 命名与编码都不同 |
| 列表属性库 | `playlist-<GUID>-props.sqlite` | **无独立库**（props 内联在 index.dat） | — |
| 曲库目录配置 | `library-v2.0\folders` | **`library\folders`** | 路径不同 |
| 曲库过滤 | `library-v2.0\filters` | `library\filters` | 同构 |

**这解释了第三轮的一个困惑**：第三轮在 B 的样本里能读到 `props: key='52655132-…'`，
却找不到对应的 `playlist-<GUID>-props.sqlite`——因为 **B 根本没有这个文件**，
那条记录来自别处。

### 3.2 `52655132-…` 的真实身份（修正第三轮）

**B 的 `playlists-v1.4\index.dat`（103 字节）实测布局**：

```
[0x00]  16 B   容器魔数 35475e2a601b4b4b82575c8e6126fdf6
[0x10]  u32    条目数 = 1
[0x14]  u32    名字长度 = 7
[0x18]  char[7] "Default"
[0x1F]  u32    属性条目数 = 40（值 0x28）
...
[0x2B]  u32    = 16
[0x2F]  16 B   = 32516552578f564c9aee17525c679a5d
                → GUID(LE) = 52655132-8F57-4C56-9AEE-17525C679A5D
```

**结论**：`52655132-8F57-4C56-9AEE-17525C679A5D` 是
**播放列表属性表中的「属性类型 GUID」**，旁边跟着 16 字节的属性值。
它**不是** autoplaylist 的 client GUID，也不是某个 `props` 表的 key。

> **修正第三轮**：第三轮把「从 B 读到 `props: key='52655132-…'`」当作
> 「B 的 autoplaylist props」，并据此做了一次阴性注入实验。
> 本轮看清楚了：那条记录的来源是 **v1.4 的 index.dat 属性表**，
> 与 v2.0 的 `props` 表**不是同一个东西**，那次阴性实验的解释需要重写。

### 3.3 metadb 对照（B 有数据、A′ 空白）

| 项 | B foobaka | A′ 2.24.6 |
| --- | ---: | ---: |
| `metadb` 行数 | **1,829** | 351 |
| `metadb_indexes` 行数 | **6** | **0** |
| 有数据的索引表 | 1 个（`C653739F`，1829 行） | 0 个 |
| `lastseen` 非空 | **0** | 0 |
| `playCount > 0` | **0** | 0 |
| `rating > 0` | **0** | 0 |
| `lastPlayed` 非空 | **0** | 0 |
| `dateAdded` 非空 | **0** | 0 |
| `firstPlayed` 非空 | **0** | 0 |

**retention 分布（B）**：

| GUID | retention | 折算 |
| --- | ---: | --- |
| `C653739F-14B3-4EF2-819B-A3E2883230AE` | 24,192,000,000,000 | 28.0000 天 |
| `B2D78CA3-C718-4088-9733-61C1CD0A6CEB` | 24,192,000,000,000 | 28.0000 天 |
| `E58A4298-065E-469B-B5D6-199106E283DD` | 24,192,000,000,000 | 28.0000 天 |
| `BF7490F5-D59D-49D0-B69A-8F81809CEF48` | 24,192,000,000,000 | 28.0000 天 |
| `EF148A2E-3368-4516-99AA-2E65E57D5B28` | **−1** | 未初始化 |
| `4209C12E-C2F4-40CA-B2BC-FB61C32687D0` | **−1,550,778,368** | 异常值 |

**与第三轮一致**，本轮独立复核确认。

### 3.4 一个反直觉的发现：统计列从未被写过

B 是用户**实际使用过**的配置（1,829 条曲目、6 个索引、有 `foo_playcount` 组件），
但 **`playCount`、`rating`、`lastPlayed`、`dateAdded`、`firstPlayed` 五列全为空**，
只有 `C653739F` 索引表有 1,829 行数据。

**这说明**：播放统计**不走 `metadb` 主表的那五个列**，而走
`metadb_index_<GUID>` + `_data` 的组件索引表。
主表五列是**结构预留但未启用**。

> 这对 SpMusic 的含义：如果要仿 foobar2000 的统计模型，
> **应仿「独立索引表 + 64 bit 哈希键」，不是「主表加五列」**。

### 3.5 曲库根配置格式（B 为 20 字节）

`library\folders`：`01000000 08000000 08000000 453a5c4d75736963`

解码：`u32 count=1 / u32 len=8 / u32 len=8 / "E:\Music"`

**与 A′ 的 `library-v2.0\folders` 格式不同**（A′ 为 `count + len + path`；
B 实测多了一个内嵌长度），且路径为**绝对路径**，A′ 为相对路径。

## 四、执行踩坑记录（给复跑的人）

| # | 坑 | 现象 | 解法 |
| ---: | --- | --- | --- |
| 1 | 两个 `.cs` 重复定义同 GUID 的 `ComImport` 类 | `Unable to cast object of type 'X' to type 'Y'` | **合并到同一文件**，共享同一套互操作类型 |
| 2 | `Add-Type -Path` 多文件跨程序集引用 | `CS0103: 当前上下文中不存在名称 'WasapiLoopback'` | 同上，合并单文件 |
| 3 | C# 注释用 `#` | `CS1024: 应输入预处理器指令` | 改 `//` |
| 4 | PowerShell 逐采样循环分析 WAV | 38 万采样跑分钟级 | 改 C# 分析器，秒级 |
| 5 | 无音频播放时环回录制 | `Capture` 返回 0 帧 | 环回只在有音频流时出包；**必须先起播再录** |
| 6 | 系统静音导致峰值异常 | 捕获峰值 1654 vs 源 32768 | 查 `IAudioEndpointVolume`；本轮已确认是用户误触静音 |
| 7 | 44.1k 源 + 48k 混音器 | 二次重采样破坏逐样本可比性 | **预先转 48 kHz**，让混音器直通 |
| 8 | 粗扫步长 256 找对齐偏移 | 跳过了真实偏移（误差 alpha≈0） | 用**逐帧精确搜索**，窗口取 3000 帧 |

## 五、产出清单

根目录：`.rea-analysis/phase4/run-20261118-p4a/`

| 类别 | 内容 |
| --- | --- |
| `scripts/` | `WasapiLoopback.cs`（环回录制 + 播放 + 音量控制，单文件）、`WavAnalyzer.cs`（对齐/比对/静音定位/时间线）、若干 Python 探针 |
| `audio/` | `neg-whole.wav`、`neg-gap.wav`（负对照）；`foobar-AB-gapless.wav`、`foobar-cue-seam.wav`（主实验）；`src-*.wav`（48k 源夹具）；`*.timeline.csv` |
| `raw/` | `a1-results.json`、`a1-negative-control.json`、`b-index-dat.json`、`volume-before.txt` |
| `fixtures/cue/` | `seam48.cue` + `chirp48.wav`（CUE 分轨夹具） |

## 六、复跑要点

1. **先确认音量不是静音**：`[SeamProbe.WasapiLoopback]::ReadVolume()` 应返回 `unmuted`。
2. **先起播再录**：静音时环回不出包，`Capture` 会返回 0。
3. **录制器与播放器必须在同一 session**，且默认渲染端点一致。
4. **比对前先把源预转换为混音器采样率**（本例 48 kHz），否则重采样会淹没逐样本差异。
5. **对齐用逐帧精扫**，窗口 3000 帧、搜索范围 100,000 帧，实测偏移稳定为 **24 帧**。
6. **增益校正后再比**：共享混音器有独立增益（本例 alpha ≈ 0.127），不校正无法比对波形。
