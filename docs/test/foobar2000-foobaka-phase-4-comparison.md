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

## 二之五、PCM 精度与采样率（P2 §3.3 / §3.4）

### 判据设计（关键）

最初想在 24-bit 源的最低有效位上埋标记。**这个设计是错的**：
±1（24-bit 刻度）只相当于 **0.0039 个 16-bit LSB**——低于 16-bit 的可分辨能力，
无论链路保真与否都必然丢失，**证明不了任何事**。

正确判据：在 24-bit 尺度上叠加 **±128 抖动**（= 0.5 个 16-bit LSB）。
若链路保留 24-bit，抖动平滑可见；若降到 16-bit，抖动会被量化掉。

### 结果

| 用例 | 200 帧分段差值绝对值均值 |
| --- | ---: |
| `dither24`（24-bit 源，含 ±0.5 LSB 抖动） | **59.481** |
| `dither16`（16-bit 源，抖动已被量化） | **59.477** |

两者**几乎完全相同**（差 0.004），说明 24-bit 抖动在链路中被量化掉
→ **共享混音链路实际工作在 16-bit**。

### 幅度基线（可靠性验证）

用「先定位信号起点，再取稳定 1 秒窗」的方法测 997 Hz 分量：

| 源类型 | 捕获幅度 |
| --- | ---: |
| 24-bit @48k | 8788.54 |
| 16-bit @48k | 8788.20 |
| 16-bit @44.1k（重采样） | 8788.22 |
| 16-bit @96k（下采样） | 8788.22 |

**四者极差仅 0.34**。且 44.1k 与 96k 源的重采样在幅度上没有可测差异。
采样率转换路径存在（44.1/96 → 48），但**幅度精度由 16-bit 输出决定**。

> **一次自我纠错**：最初把「捕获起点」固定在文件开头测幅度，得到 24-bit 源只有 7774、
> 其余 8788 的假差异。实际是 ffmpeg 解析 24-bit WAV 较慢、开头有较长静音，
> 我的窗口落进了静音区。**修正窗口后四个源完全一致。** 这条记录保留，避免误用。

---

## 二之六、首达/回访三对交错（P2 §1.3，第三轮受阻项）

第三轮记录「滚轮格数非行偏移线性映射，落点无法精确复现」。本轮找到解法：
**用键盘定位代替滚轮**。

| 键 | 行为 |
| --- | --- |
| `Home` | 精确到第 1 条 |
| `PageDown` × N | 每页固定行数，可复现 |
| `End` | 精确到第 300 条 |

### 三对交错结果

| 对 | 落点 | 播放列表区 | 封面区 |
| --- | --- | --- | --- |
| P1 | `PageDown×2` | **一致** | **一致** |
| P2 | `PageDown×5` | **一致** | **一致** |
| P3 | `End` | 不同 → 查明是**鼠标光标位置** | **一致** |

**整图 SHA 三对都不同，但那是无效判据**——它包含鼠标光标、正在播放的曲目编号与进度条。
按区域比对后，**首达与回访的可见内容完全一致，封面零空白**。

> **方法学结论**：这类实验必须按区域比对并排除光标，用整图哈希会得出相反的错误结论。

---

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

### 3.3b B 界面渲染失败的根因定位（数据层，不需要启动）

第三轮记录「B 的主窗口 1248×162、标题为空、画面全白，进程存活 133 线程」，
判定为「Columns UI 布局渲染失败」但**未定位到具体原因**。本轮从磁盘文件反推出来了。

**方法**：解析 `三页面.fcl`（Columns UI 布局，43,282 B）里声明的**面板类型 GUID**，
再到 B 安装目录下**全部 67 个 DLL** 里逐个搜索这些 GUID 的二进制形式。

**`.fcl` 头部（实测）**：

```
[0x00] 16 B  魔数 9FAADFF3-E51A-4A8B-B4A3-D209A36AB301
[0x10] u32   version = 2
[0x14] u32   reserved = 0
[0x18] u32   panel name entries = 11
[0x1C] 连续 11 条 (GUID 16 B + u32 长度 + UTF-8 名)，止于 0x17F
[0x17F..] 42,899 B 布局数据（未解析）
```

**11 个面板类型的解析结果**：

| GUID | 名称 | 在哪个 DLL 里找到 |
| --- | --- | --- |
| `8FA0BC24-…` | Horizontal splitter | `foo_ui_columns.dll` |
| **`4532EC89-C567-4267-B33A-0C154B6F0105`** | **面板栈分离器** | **全部 67 个 DLL 均未命中** |
| `3C2C4BDC-…` | WSH 面板加强版 | `foo_uie_wsh_panel_mod_plus.dll` |
| `547ABB10-…` | ESLyric | `foo_uie_eslyric.dll` |
| `76E6DB50-…` | Menu | `foo_ui_columns.dll` |
| `9BD325A4-…` | DSP preset | `foo_ui_columns.dll` |
| `6E3B8B17-…` | Filter search | `foo_ui_columns.dll` |
| `ABA09E7E-…` | Playback order | `foo_ui_columns.dll` |
| `678FE380-…` | Seekbar | `foo_ui_columns.dll` |
| `D947777C-…` | Spectrum analyser | `foo_ui_columns.dll` |
| `D8E65660-…` | Buttons | `foo_ui_columns.dll` |

**关键细节**：`foo_uie_panel_splitter.dll` **确实装着的**（128,000 B），
但**它里面没有这个 GUID**（`bytes_le` / `bytes` / `mixed` 三种字节排列全部未命中）。

**推断的因果链**：布局声明了 1 个本机无组件提供的面板类型 →
Columns UI **没有 DUI 那样的回退布局**，遇到不可解析的面板类型即中止整个渲染 →
窗口停留在初始化尺寸、内容空白，而进程继续存活并响应。
（机制证据强；**因果链是推断**，但与第三轮「进程活着但不渲染」的观察一致。）

### 3.3c B 界面不稳定的直接证据：样本自带的 35 份崩溃报告

第三轮只能从运行现象推测「Columns UI 布局渲染失败」。本轮在 B 的安装目录里
发现 **`crash reports\` 目录，内含 35 份 `.txt` + 35 份 `.dmp`**——
这是 **B 原作者环境下真实发生的崩溃记录**（2024-12-11 ~ 2025-07-06），不是本轮产生的。

**崩溃模块分布**：

| 模块 | 次数 | 偏移 |
| --- | ---: | --- |
| `OLEAUT32` | **13** | `1F86Dh` |
| `foo_uie_wsh_panel_mod_plus` | **12** | `36E90h` / `4E3DCh` |
| `USER32` | 5 | `3610Fh` |
| `KERNELBASE` | 2 | — |
| `foo_uie_eslyric` | 1 | `1EBB8Ah` |
| `ntdll` | 1 | — |

**异常码**：`C0000005h`（Access violation）33/35，其余 2 份为 `E6538887h`。

**`35 / 35` 全部提到 `dynwrap`**——与根目录的 `dynwrapx.dll` 和
`【1、注册所需动态库（必须运行）】.bat` 直接相关。

**其中 `foo_uie_eslyric` 那一次**的调用路径是 `entry=>app_mainloop`，
即**启动阶段就崩**：

```
Illegal operation:
Code: C0000005h, address: 7C45BB8Ah
Access violation, operation: read, address: 00000000h
Call path: entry=>app_mainloop
Crash location: Module: foo_uie_eslyric, Offset: 1EBB8Ah
```

**这修正了第三轮的判断**。第三轮说「注册脚本已提权执行成功，排除了注册问题」——
本轮实测 **`dynwrapx.dll` 的 COM 注册状态是【未注册】**（`AutoItX3` 已注册）。
结合 35/35 崩溃都含 `dynwrap`，注册缺失与崩溃证据**方向一致**。

> **证据边界**：这些报告来自原作者环境，不能直接证明本轮运行时的状态。
> 但它是 B 界面不稳定的**直接历史证据**，强度远高于「从白屏窗口推测布局失败」。

**对 SpMusic 的含义**：面板脚本宿主（WSH/ActiveScript）与 COM 自动化是 B 不稳定的主要来源。
SpMusic 不走脚本宿主路线，这点上天然更稳；若要支持用户脚本，
必须做成**隔离进程 + 超时 + 崩溃不影响外壳**。

### 3.3d-bis 面板树拓扑：缺失类型为何导致整树崩塌

上一节解出了 `.fcl` 的配置节点序列。本轮进一步把**面板树的父子关系**解出来了。

**实例记录格式**：

```
u32 parent_index | GUID type | u32 nchild | （可选）u32 len + UTF-8 实例名
```

**关键发现**：`4532EC89-…`（面板栈分离器）在 `.fcl` 里出现 **21 次**，
且其中 **18 次是容器节点**（`nchild > 0`）：

| file 偏移 | 父索引 | 子节点数 | 实例名 |
| --- | ---: | ---: | --- |
| `0x00043` | — | 18 | 面板栈分离器（类型表项） |
| `0x0232D` | 2 | **3** | `左` |
| `0x02E28` | — | **3** | `右` |
| `0x02F48` | 1 | **1** | `r` |
| `0x03065` | 2 | **6** | `播放` |
| `0x08B97` | — | **12** | `列表歌词` |
| `0x092EF` | 2 | **2** | `PL` |
| `0x09FF5` | — | **2** | `ES` |

（完整 21 条见 `.rea-analysis/phase4/run-20261118-p4a/raw/fcl-panel-tree.json`）

**对比其它类型的使用次数**：

| 类型 | .fcl 中出现次数 |
| --- | ---: |
| **面板栈分离器（缺失）** | **21** |
| WSH 面板加强版 | 16 |
| Horizontal splitter | 4 |
| ESLyric | 4 |
| 其余 7 种 | 各 2 |

**因果链完整了**：`4532EC89` 不是某个叶子面板，而是**整棵布局树的骨架**——
所有分支容器（左/右/播放/列表歌词/PL/ES）都由它构成。
缺这个类型 ⇒ 18 个容器节点全部无法实例化 ⇒ **整树没有骨架** ⇒ 白屏。

> 这解释了第三轮观察到的现象：不是「某个面板画不出来」，
> 而是「整个布局结构无法展开」，进程仍然活着（无崩溃）但没有任何可渲染的层级。

### 3.3d `.fcl` 布局文件的完整结构（此前标注为「42,899 B 未解」）

第二轮把 `.fcl` 记为「头部已解、其后 42,899 B 未解」。本轮解开了。

**关键认识**：那 42,899 B **不是布局几何数据**，而是**扁平的「长度前缀 + UTF-8 文本」节点序列**。

**文件结构**：

```
[0x00] 16 B  魔数 9FAADFF3-E51A-4A8B-B4A3-D209A36AB301
[0x10] u32   version = 2
[0x14] u32   reserved = 0
[0x18] u32   面板类型表项数 = 11
[0x1C] 11 × (GUID 16B + u32 len + UTF-8 名)，止于 0x17F
[0x17F..] 636 个「u32 len + UTF-8」节点
```

**636 个节点的构成**：

| 类别 | 数量 | 样例 |
| --- | ---: | --- |
| 面板名 / 配置节名 | — | `Columns`、`Layout`、`Colours (unified)`、`Misc layout`、`Titles`、`Groups` |
| **配色条目** | **64** | `Color.Selected.panel` + `RGB(245, 245, 245)` |
| 列定义 | — | `艺术家` / `[%artist%]` / `ARTIST`；`标题` / `[%title%]` / `TITLE` |
| 字体 | — | `Microsoft YaHei UI` |
| **内嵌 WSH 脚本块** | **15** | `// ==PREPROCESSOR== // @name "foobaka Panels" // @import …` |

**12 个配置节全部枚举到**：`Layout`、`Colours`、`Colours (unified)`、`Columns`、
Misc layout`、`Misc fonts`、`Fonts (unified)`、`Titles`、`Groups`、
`Filter panel fields`、`Filter search favourites`、`Filter panel settings`。

**这解释了 B 的「主题」本质**：它 = **面板类型表 + 键值配置 + 内嵌脚本**。
配色是 `Color.<角色> = RGB(r,g,b)` 的显式键值对，不是编译进二进制的东西。

> **对 SpMusic 的含义**：若要做等价的主题能力，配置层应当是**显式的键值模型**
> （每个颜色、每个列定义都是独立可寻的条目），而不是二进制大块。
> 这直接支持第三轮候选卡 P2-D「主题系统的配色先行层」的可行性。

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

## 三之六、autoplaylist 可离线合成（新突破）

第三轮只能通过 Album List 右键菜单建自动播放列表。**本轮证明可以完全离线手工构造**，
foobar2000 启动后会正常接受并自动求值。

### 做法

在 `profile\playlists-v2.0\` 下放三个文件：

```
index.txt                                 （BOM + "GUID:名称\r\n"）
playlist-<GUID>.fplite                    （BOM，成员快照，可留空）
playlist-<GUID>-props.sqlite              （props(key,data) + markers(key,value)）
```

`props` 里写一条 136 B 定义（与第三轮解出的格式一致）：

```
u32 flags=0 | GUID clientGUID | u32 limit | (u32 len + UTF-8 sort_pattern) | u64 0
```

### 结果

| 实验 | 结果 |
| --- | --- |
| `limit=0`，clientGUID 用 Album List 的 `94D57506-…` | **被接受**，`.fplite` 自动求值为 **20 行**，恰好覆盖 q1test 全部 20 条 |
| `limit=5` | **limit 未生效**，仍是全库 19/20 行 |

**这意味着**：不再依赖 GUI 就能造自动播放列表，扫描/求值链路可以完全自动化。

### 一个必须记住的自我纠错

中途我曾判断「136 B 定义不足以决定成员」——**那是错的**。
当时我把一个**已被清空的** `All Music`（0 行）当成了参照。
用新建列表重测后，定义确实足以求值。这条记录保留在此，避免后续误用。

---

## 三之七、过滤条件的位置：穷举后确认「不持久化」

第三轮把「分支级 autoplaylist 规则位置」记为未知（props 为空）。本轮把所有可能的位置都 dump 了：

| 位置 | 内容 |
| --- | --- |
| `props` | **只有 1 行**——就是那 136 B 定义本身 |
| `markers` | 0 行 |
| `.fplite` | 只有成员快照（`file://` 行） |
| `config.sqlite` / `configBlobs`（9 条） | 5 条 ui.elem 位置、1 条 converter 预设（`%title%`）、3 条 cfg_var GUID blob，**无一条含查询串** |
| `config.sqlite` / `configStrings`（2 条） | 只有媒体类型过滤器 `*` 与 `*.CUE` |
| `config.sqlite` / `configInts`、`configReals` | 列表索引、输出音量、累计播放时长，**无查询** |
| `library-v2.0\filters` | 14 B，媒体类型过滤器 |

**结论：过滤条件不持久化在 profile 的任何 SQLite 里。**

**推论**：Album List 创建的 autoplaylist，从磁盘证据看与「整个曲库 + 排序」**不可区分**；
真实过滤来自 Album List 面板的运行时状态（或某个从未被写盘的私有 blob）。

**这对计划的影响**：单变量干预 S（规则不变、结果集变化）
**无法通过手工编辑 profile 复现**。第三轮的受阻不是方法不够，而是**这个条件在磁盘上不存在**。

---

## 三之八、组织与恢复：只读体检已实现

方案 §2.3 允许「暂时无法做该轮操作时，先产出可用的只读体检用例」。本轮完成了这一半。

**`org_healthcheck.py`**（只读：sqlite 复制后 `mode=ro` 打开，源文件仅 stat + 哈希）：

| 维度 | phase3 profile | phase4 profile |
| --- | ---: | ---: |
| `metadb` 行数 | 351 | 357 |
| 被引用路径去重数 | 351 | 376 |
| 播放列表条目 | 41 | 321 |
| 已哈希文件 | 322 | 327 |
| `ok` | 322 | 327 |
| `truly_dead` | 29 | 49 |

**四类去重维度均已可区分**：有意重复（同路径出现在多个列表）、同名不同路径、
同内容、同名不同版本。phase4 的 `truly_dead` 从 29 升到 49，是因为该副本里
u1 夹具被移动/清理，**不是新增失效**。

**未完成的部分**：真正的批量改名/按标签迁移实测（会修改文件，需可丢弃副本 + 完整比对）、
名称冲突与不可写文件的部分失败记录、改名后播放列表引用是否跟随的实测。
原因是 Ghidra 对 1.18 MB 核心 exe 的分析持续超过主机超时。

---

## 四、IS 多值语义：穷举 50 个候选，全部排除

### 4.1 先确定存储形态（本轮新证据）

读 A′ 的 `metadb`，解析 `info` BLOB（`[0:8]` 时长 + `[8:24]` 4×ReplayPlus + `[24:]` `name\0value\0` 串）：

| 曲目 | ARTIST 在 BLOB 中的形态 |
| --- | --- |
| 04_Multi Artist A | **一个键，值 `SpmQ3;Bystander`** |
| 05_Multi Artist B | **一个键，值 `Guest;SpmQ3`** |
| 17_Three Artist | **一个键，值 `A;SpmQ3;B`** |
| 12_Multi Genre | GENRE 一个键，值 `Rock;Pop` |

**抽样 40 行，ARTIST 出现超过 1 次的记录数为 0。**

> **结论**：多值字段在 `metadb` 里**就是一个带分号的单字符串**，
> 不是「一条记录多个 key」。这对 `IS` 的行为是决定性前提。

### 4.2 穷举候选实现

以第三轮 8 条判别性探针为约束（`SpmQ3`=11、`Bystander`=0、`Guest`=0、`spmq3`=12、
`SpmQ`=1、`A`=0、`B`=0、`X-SpmQ3-Y`=1），对 50 个候选实现逐项比对：

| 候选族 | 结果 |
| --- | --- |
| 仅首段 / 仅末段 / 任一段（各含大小写两模式） | 全部不符 |
| 子串包含 | 全部不符 |
| 整串相等 + 首段（OR） | `SpmQ3`=12、`Guest`=1、`A`=1 → 3 项不符 |
| 整串相等 + 末段（OR） | `SpmQ3`=12、`Bystander`=1、`B`=1 → 3 项不符 |
| **整串相等（大小写不敏感）** | **7/8 吻合，唯一失败 `spmq3`（预测 11、实测 12）** |

**没有任何候选能全部吻合。**

### 4.3 尝试用 GUI 复测（本轮未成功）

为拿到新的行为证据，本轮尝试驱动 foobar2000 的检索入口，**未能打通**：

| 项 | 结果 |
| --- | --- |
| 主窗口定位（pid → MainWindowHandle） | **成功** |
| 窗口区域截图（ffmpeg gdigrab + offset/size） | **成功** |
| 弹出菜单抓取（`#32768` + `MN_GETHMENU`） | **成功**，读出 5 项：`&Album List`(id=3)、`&Search`(id=4)、`&ReFacets`(id=5)、分隔线、`&Configure`(id=1) |
| 选择 `Search` 子项 | **失败**：菜单打开正常，但进入子项后 `Playlist Search` 对话框始终不出现 |
| 键盘导航（Down×N + Enter） | **失败** |
| 换布局（替换 `profile\theme.fth`） | **成功**，`Album List + Properties.fth` 能渲染出 Album List 面板 |
| Album List 的 Filter 输入框 | 找到（唯一 Edit 控件），写入生效 |
| Album List 树内容 | **读回为空**，与界面上的 `Nothing to show - configure Media Library first` 一致 |
| `Library → Configure` | **失败**，第二次尝试连弹出菜单都未出现 |

**根因判断**：Album List 需要**先配置好 Media Library** 才有内容；
`profile\library-v2.0\folders` 虽存在（30 B，相对路径 `..\..\fixtures\q1test\`），
但面板仍报未配置。**这与第三轮记录的「Filter 可输入但不刷新」是同一个墙**，
第三轮把它记为受阻而非解决，本轮同样未突破。

**附带问题**：本轮期间 foobar2000 崩溃过一次（窗口变成 `foobar2000 has crashed`，未产生 crash report），
且事后抓的 `crash.png` 拍到了**遮挡它的 Edge 窗口**——
第三轮 `PrintWindow(flags=2)` 的教训在「用 gdigrab 抓被遮挡区域」时同样适用，本轮踩到了。

> **诚实结论**：本轮**没有取得任何新的行为证据**。
> §4.2 的静态穷举结论不受影响，`spmq3` 差 1 的问题**仍然未解释**。

### 4.4 结论性质：这是一个阴性结果

> **本轮证明的是「没有简单的整串/分段实现成立」，不是「IS 的真正规则」。**
>
> 最优候选「整串相等 + 大小写不敏感」精确地只差 `spmq3` 这一项，
> 说明**大小写这一层与分段这一层是耦合的**，简单叠加无法同时满足。
>
> 剩余假设：**E2——存在第二个比较通道参与并集**。
> 要分离它，需要新增「单值大小写与多值首段同形」的夹持样本，
> 并在 GUI 里重测 `IS spmq3` / `IS SpmQ3` 的实际结果数。**本机 GUI 驱动未在本轮执行。**

---

## 五、执行踩坑记录（给复跑的人）

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
