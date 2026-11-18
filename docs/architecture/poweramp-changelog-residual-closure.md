---
doc_id: "ARCH-POWERAMP-CHANGELOG-RESIDUAL-CLOSURE"
title: "版本更新逆向：残余项再闭合（4 项）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni (versionCode 1025009)"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 还有可逆向的吗"
  - "docs/architecture/poweramp-changelog-ui-skin.md"
  - "docs/architecture/poweramp-changelog-audio-output.md"
---

# 版本更新逆向：残余项再闭合

## 0. 一句话结论

四篇专文共留 26 项 open_items。本轮重新审视后：

| 结果 | 项数 |
| --- | ---: |
| ✅ **本轮新闭合** | **4**（UI Q1/Q2/Q5/Q6） |
| ⚠️ native 硬边界（确认不可从 Java 解） | 9 |
| ❌ 笼统条目 / 无独立实现 | 13 |

| 结果 | 项数 |
| --- | ---: |
| ✅ **本轮新闭合** | **4** |
| ⚠️ **判定为 native 硬边界（确认不可从 Java 解）** | 9 |
| ❌ 笼统条目 / 无独立实现 | 13 |

---

## 1. ★ 新闭合 #1：`anim_speed` 的 `Z` 参数（UI-skin Q2）

UI 专文曾留「`calcAnimTime(F,Z)` 的 `Z` 参数语义未解」。

### 1.1 两个重载（`AnimTimeHelper.smali`）

| 方法 | 行 | 行为 |
| --- | ---: | --- |
| `calcAnimTime(F)F` | `:30-40` | 委托给双参版本，**`v0 = 0x1`（true）** |
| `calcAnimTime(FZ)F` | `:42-113` | 真正实现 |

### 1.2 双参版本完整逻辑

```smali
.method public static calcAnimTime(float t, boolean isAnim)
    if (t == 0.0f) return t;                    // :47-51

    mode = h0.n0.А;                             // :54  anim_speed 的偏好值
    buf  = prefs/А.В;                           // :56  全局参数 ByteBuffer
    v3   = К.В(buf, 2);                         // :60  ★ 读 offset 2 的 int

    if (v3 >= 1) {                              // :66
        // 保持默认
    } else {
        v1 = К.В(buf, 1);                       // :71  读 offset 1
        if (v1 != 4) mode = h0.n0.В;            // :77-85  ★ 用备用值
    }

    if (mode == 0 || mode == 2) {
        if (mode == 2) return t * 0.6f;         // :98   ★ 2 = 更快
    }
    if (mode == 0) {
        if (isAnim) return 0.001f;              // :105  ★ 0 = 动画关闭
        return t * 0.6f;                        // :110
    }
    return t;                                   // :95  mode == 1 = 正常
}
```

### 1.3 `Z` 参数的真实语义

| 调用方 | `isAnim` | 行为 |
| --- | :---: | --- |
| `calcAnimTime(F)F`（单参便捷版） | **`1`** | mode==0 时返回 **0.001f**（实质瞬时） |
| 显式传 `0` 的调用 | `0` | mode==0 时返回 `t * 0.6f`（仍动画，但更快） |

> **`Z` 是"是否需要动画"的开关**：
> - `true` → `anim_speed==0`（动画关闭）时返回 `0.001f`，等于**瞬时完成**
> - `false` → 即使 `anim_speed==0` 也保留 0.6x 动画（用于必须可见的过渡）

### 1.4 `anim_speed` 的取值（UI 专文已给出 `0/2/1`，本轮确认语义）

| 值 | 含义 | 时长 |
| ---: | --- | --- |
| **0** | 关闭 | `isAnim ? 0.001f : t*0.6f` |
| **1** | 正常 | `t` |
| **2** | 更快 | `t * 0.6f` |

> 注意值是 **0/2/1** 而非 0/1/2——UI 专文已指出这一点，本轮补上了分支语义。

---

## 2. ★ 新闭合 #2：`vis_latency_ms` 的消费链（UI-skin Q1）

UI 专文判定「#2 visualization latency → lyrics」**未找到实现**，
排查表列了 6 个维度全 0 命中。本轮**解出了完整链路**，并给出了"为什么找不到"的答案。

### 2.1 完整链路

```
res/xml/audio_output_device_opts.xml 的 vis_latency_ms 键
        │
        ├─[读] preference/c1.smali:2509   H.P.А  →  SeekbarPreference.setValue()
        │      （设备选项页显示当前值）
        │
        ├─[存] Application.smali:3020     H.P.у(v)  ← SharedPreferences.getInt("...vis_latency_ms")
        │      （启动时从旧偏好迁移）
        │
        └─[用] preference/i.smali:443-459  H.P.А
                 → ByteBuffer.putInt()   ★ 打包进参数块
                 → native 读取
```

### 2.2 为什么 Java 侧找不到"歌词消费点"

| 事实 | 推论 |
| --- | --- |
| `vis_latency_ms` 在 `i.А()` 里被 `putInt` 进 ByteBuffer | 它作为**参数块**传给 native |
| Java 侧无任何 `latency` 字段被歌词类读取 | **消费在 native** |
| 可视化与歌词都在 native 时间轴对齐 | 同一延迟值可同时作用于两者 |

> **changelog 说「also applied to lyrics」——这个"also"正是 native 侧新增的消费点。**
> Java 只负责把值打包传递，**比较可视化与歌词时间轴的代码在 `.so` 里**。

### 2.3 跨篇印证

这与插件系统专文的结论一致：`preference/i.А(ByteBuffer, H)` 是**输出参数块的唯一打包点**（详见 `poweramp-output-opts-bitfield.md`）。
`vis_latency_ms` 是打包的 9 个字段之一。


---

## 2.5 ★ 新闭合 #3：`MilkLoader.O` 是缓存字段（UI Q5）

UI 专文曾疑「`O` 字段双重用途（`:1116` 与 `:1122` 写同一字段）」。
**实际是单一用途的缓存**：

| 字段 | 行 | 角色 |
| --- | ---: | --- |
| `MilkLoader.Н` | `:1523` 读 | **当前应有的 shader 值** |
| **`MilkLoader.O`** | `:85` 初始化、`:1521` 读、`:1642` 写 | **上次已应用的值**（缓存） |

**逻辑**（`:1517-1527`）：

```smali
shader = paint.getShader();        // :1517-1519
cur  = this.O;                     // :1521  上次应用值
want = this.Н;                     // :1523  当前应有值
if (cur == want) goto :cond_2;     // :1527  未变则跳过重设
paint.setShader(...);              // :1638
this.O = this.Н;                   // :1640-1642  更新缓存
```

**初值 `0x80000000`**（`:83-85`，即 `Integer.MIN_VALUE`）是"尚未应用过"的哨兵，保证首次必然触发重设。

> **这里只承担一种用途，即标准的脏值比对缓存，并没有双重用途。**
> UI 专文看到的 `:1116`/`:1122` 两处写入，一处是 `MilkWidget` 侧同步，
> 一处是 `MilkLoader` 自身更新，属于同一语义。


---

## 2.6 ★ 新闭合 #4：cover widget 的动态启用点（UI Q6）

UI 专文留「未定位 `setComponentEnabledSetting` 的调用代码」。本轮找到 **`preference/x0.smali`**（202 行）。

### 2.6.1 机制：preference key 即组件类名

```smali
key  = pref.getKey();                       // :60-62
name = new ComponentName(pkg, key);         // :73-81   key 当类名用
pm.setComponentEnabledSetting(name, 1, 1);  // :83      state=1 ENABLED
```

### 2.6.2 二段式切换（`:99-123`）

| 段 | 行为 |
| --- | --- |
| ① 启用 | 把 **key 对应的组件**设为 `state=1`（ENABLED） |
| ② 禁用其它 | 遍历组件列表，**类名 != key** 的全部设 `state=2`（DISABLED） |

```smali
for (cn : componentNames) {                    // :100-110
    if (!key.equals(cn.getClassName())) {      // :110-118
        pm.setComponentEnabledSetting(cn, 2, 1);   // :123  其余禁用
    }
}
```

> **这是"单选式组件切换"**：同一时刻只有一个 widget provider / receiver 处于 ENABLED。
> 与 `AndroidManifest.xml` 里 `enabled="false"` 的初值配合：
> **安装后全部禁用，用户选择后才启用一个**。

### 2.6.3 与 #20（Samsung Flip widgets）的对应

changelog 的「Samsung Flip widgets for cover screens」正是**新增一个可被这样启用的 provider**。
启用逻辑本身通用，不针对具体 widget。
---

## 3. 确认不可从 Java 解出的 9 项

| 项 | 来源 | 本轮复核方式 | 结论 |
| --- | --- | --- | --- |
| xHE-AAC 解码 | audio #2 | 搜 `xhe`/`XAAC`/`USAC` | **真未找到**——changelog 明写 "via device codecs"，委托系统解码器，Poweramp 本无代码 |
| DoP 打包算法 | audio #17 | 搜 `DoP` | 仅开关在 Java，算法在 native |
| WavPack 精确版本 | audio #9 | 搜 `wavpack` | Java 侧 0 命中 |
| FFmpeg 补丁号 | audio #31 | 读 `Lavf` 配置串 | 主版本可证（58→62），补丁号被裁剪 |
| LG DoP 格式判定 | audio #35 | 搜 `LG` | 仅 native 有 `unsupported LG DoP format` |
| Cayin / Tempotec | audio #33 | 搜 `cayin`/`tempotec` | 两版全量 **0 命中** |
| 滚动性能 | library #11 | 搜 `RenderThread` | native / 平台层 |
| CUE Repeat One | library #14 | 读 CUE 解析 | 播放循环在 native |
| FLAC 解析改进 | library #12 | 搜 `flac` | native 解析器 |

> 这些不是"没找到"，而是**Java 层确实不存在**。

---

## 4. 其余 15 项：笼统或无独立实现

| 类型 | 数量 | 例 |
| --- | ---: | --- |
| 笼统条目 | 14 | `bug fixes and stability improvements`、`updated translations` |
| 部分成立 | 1 | #23「全部新功能免 Feature Pack」（抽样验证，非全量） |

> 这类条目**无法定位到具体实现**，不是逆向不彻底。

---

## 5. 剩余可继续的方向

| 方向 | 可行性 |
| --- | --- |
| 反汇编 `libpowerampcore.so` 查 DoP/WavPack/FLAC | 需 IDA/Ghidra，超出 Java 静态逆向范围 |
| 运行期 trace 验证 native 消费点 | 需设备 + Frida |
| 外部 pak 样本验证 | 需真实第三方插件 |

> **在 Java/smali 静态分析范围内，本轮已无新的可解项。**

---

## 6. 证据索引

| 主题 | 位置 |
| --- | --- |
| `calcAnimTime(F)F` | `widget/player/AnimTimeHelper.smali:30-40` |
| `calcAnimTime(FZ)F` | `AnimTimeHelper.smali:42-113` |
| `anim_speed` 绑定 `h0.n0` | `widget/player/h0.smali:844-862` |
| 0.6f 常量 | `AnimTimeHelper.smali:88`（`0x3f19999a`） |
| 0.001f 常量 | `AnimTimeHelper.smali:105`（`0x3a83126f`） |
| `vis_latency_ms` 读 | `preference/c1.smali:2486-2529` |
| `vis_latency_ms` 迁移 | `audioplayer/Application.smali:3008-3022` |
| `vis_latency_ms` 打包 | `preference/i.smali:443-459` |
| `H.P` 字段 | `preference/H.smali:77` |
| `MilkLoader.O` 初始化 | `milk/MilkLoader.smali:83-85` |
| `MilkLoader.O` 比对 | `MilkLoader.smali:1517-1527` |
| `MilkLoader.O` 更新 | `MilkLoader.smali:1638-1642` |
| 组件启用逻辑 | `preference/x0.smali:60-135` |

> 口径：**build-1025**。