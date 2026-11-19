---
doc_id: "ARCH-POWERAMP-PLUGIN-INSTANCES"
title: "插件系统（二）：实例绑定与命名约定反射"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 1
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/corpus/poweramp-plugin-system.md（第一篇：类型与发现链）"
  - ".rea-analysis/smali/smali/com/maxmpz/audioplayer/plugin/**"
---

# 插件系统（二）：实例绑定与命名约定反射

## 0. 一句话结论

**插件实例不是注册的，而是按 uniqName 用命名约定反射造出来的**：

```
uniqName:  com.maxmpz.audioplayer/output.at
             ↓ 把 / 换成 .
           com.maxmpz.audioplayer.output.at
             ↓ 取最后一个点之后的 tail=".at"，首字母大写 + 拼 PluginService
类名:      com.maxmpz.audioplayer.output.at.AtPluginService
             ↓ ClassLoader.loadClass + getConstructor(Context, NativePluginInfo)
实例:      new AtPluginService(app, nativePluginInfo)
```

> 命名约定**本身就是注册表**——没有配置文件、没有注解处理器。
> 代价是 uniqName 与包路径必须严格对应。

---

## 1. 实例基类 plugin/А（抽象，95 行）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `A` | `int` | 子类可实现，用于某种 id |
| `B` | `Context` | 应用上下文 |
| `X` | `NativePluginInfo` | **回指 native 描述符** |
| `<init>` | `(Context, NativePluginInfo)` | **唯一的构造签名** |
| `B()` | `int` | 返回一个资源 id（`OslPluginService` 实测 `0x7f020304`） |
| `А()` | `boolean` | 能力位（`OslPluginService` 返回 true） |
| `Х()` | `void` | 生命周期钩子 |
| `х(byte[],int)` | `boolean` | 数据处理入口 |
| `A(int, plugin/X)` | `void` | 回调注册 |

### 1.1 17 个直接子类

| 分类 | 数量 | 类 |
| --- | ---: | --- |
| output | 6 | At / Aa / Osl / Oslhd / Athd / Cc |
| decoder | 6 | Ffmpeg / Amedia / Flac / Wv / Mpc / Mod |
| decoder(osl) | 1 | `decoder.osl.OslPluginService`（与 output 同名不同包） |
| plugin(dsp) | 3 | Milk / Reverb / Tempo |
| plugin(resampler) | 1 | Resampler3 |
| 抽象中间层 | 1 | `BaseFloatParamsPluginService` |
| 空实现 | 1 | `InternalPluginService$NullPluginService` |

> **同名不同包**：`output.osl.OslPluginService` 与 `decoder.osl.OslPluginService` 是两个类。
> 证明 uniqName 的 `/` 之前是包、之后是模块路径。

---

## 2. ★ 工厂方法 NativePluginManager.В(NativePluginInfo)（`:907-1154`）

### 2.1 三级缓存

```smali
synchronized (К) {                          // 实例缓存
    inst = К.А(info.uniq_name);
    if (inst === Х) return null;            // Х = NullPluginService 哨兵
    if (inst != null) return inst;
}
// 未命中 → 反射创建
synchronized (K) {                          // 构造器缓存（static）
    ctor = K.get(className);
    if (ctor == null) {
        cls  = classLoader.loadClass(className);
        ctor = cls.getConstructor(Context.class, NativePluginInfo.class);
        ctor.setAccessible(true);
        K.put(className, ctor);
    }
    inst = ctor.newInstance(app, info);
    К.х(uniqName, inst);                    // 写回实例缓存
}
return (inst === Х) ? null : inst;
```

| 缓存 | 字段 | 键 | 值 | 作用域 |
| --- | --- | --- | --- | --- |
| 实例 | `NativePluginManager.К` | uniqName | `plugin/А` | 单例 Manager |
| 构造器 | `NativePluginManager.K` | 类名字符串 | `Constructor` | **static 全局** |

### 2.2 ★ 类名派生算法（`:952-1017`）

```smali
u    = info.uniq_name;                     // "com.maxmpz.audioplayer/output.at"
i    = u.lastIndexOf(0x2e);                // 最后一个点
tail = (i >= 0) ? u.substring(i) : "";     // ".at"
full = u.replace(0x2f, 0x2e);              // "com.maxmpz.audioplayer.output.at"
sb   = full + ".";
sb  += Character.toUpperCase(tail.charAt(1));   // 大写 A
sb  += tail.substring(2);                       // "t"
sb  += "PluginService";                         // → ...at.AtPluginService
```

### 2.3 实测验证：20 个内置插件的派生结果

| uniqName | 派生类名 | 存在 |
| --- | --- | :---: |
| `output.at` | `output.at.AtPluginService` | ✅ |
| `output.osl` | `output.osl.OslPluginService` | ✅ |
| `output.aa` | `output.aa.AaPluginService` | ✅ |
| `output.oslhd` | `output.oslhd.OslhdPluginService` | ✅ |
| `output.athd` | `output.athd.AthdPluginService` | ✅ |
| `output.cc` | `output.cc.CcPluginService` | ✅ |
| `decoder.ffmpeg` | `decoder.ffmpeg.FfmpegPluginService` | ✅ |
| `decoder.amedia` | `decoder.amedia.AmediaPluginService` | ✅ |
| `decoder.wv` | `decoder.wv.WvPluginService` | ✅ |
| `decoder.mpc` | `decoder.mpc.MpcPluginService` | ✅ |
| `decoder.mod` | `decoder.mod.ModPluginService` | ✅ |
| `plugin.milk` | `plugin.milk.MilkPluginService` | ✅ |
| `plugin.reverb` | `plugin.reverb.ReverbPluginService` | ✅ |
| `plugin.tempo` | `plugin.tempo.TempoPluginService` | ✅ |
| `plugin.resampler3` | `plugin.resampler3.Resampler3PluginService` | ✅ |
| `output.bench` | `output.bench.BenchPluginService` | ❌ |
| `plugin.dspi` | `plugin.dspi.DspiPluginService` | ❌ |
| `subsystem.pipeline` | `subsystem.pipeline.PipelinePluginService` | ❌ |
| `subsystem.decoder_thread` | `subsystem.decoder_thread.Decoder_threadPluginService` | ❌ |
| `subsystem.dsp_thread` | `subsystem.dsp_thread.Dsp_threadPluginService` | ❌ |

**15/20 命中**。5 个缺失全部走异常回退。

---

## 3. 失败路径：NullPluginService 哨兵

```smali
catch (Exception e) {
    Log.e("NativePluginManager", "getInternalPluginService=" + info.uniq_name, e);
    inst = Х;                        // Х = InternalPluginService$NullPluginService
}
К.х(uniqName, inst);                 // ★ 把"失败"也缓存
return (inst === Х) ? null : inst;   // 对外转 null
```

> **关键设计**：失败结果（哨兵）**也被缓存**。下次同 uniqName 直接返回 null，
> 不重复反射、不重复打日志。这是**负缓存**（negative caching）的经典实现。

### 3.1 5 个派生失败的语义归类

| uniqName | 为什么没有 Service |
| --- | --- |
| `subsystem.pipeline` / `decoder_thread` / `dsp_thread` | **subsystem 是纯 native 内部线程**，无 Java 实现 |
| `plugin.dspi` | **DSPI 是接口层**，由 milk/reverb/tempo 实现 |
| `output.bench` | **bench 是内部基准测试**，不对外 |

> 这 5 个在 XML 里**仍然声明**（有 native 实现、要显示在插件列表），
> 但没有 Java Service ⇒ 印证第一篇：**native 实现与 Java Service 是两回事**。

---

## 4. 未被 XML 声明的 2 个 Service

19 个 `*PluginService` 里有 **2 个不在 `poweramp_builtin_plugins.xml`**：

| 类 | 推测 uniqName | 依据 |
| --- | --- | --- |
| `decoder/flac/FlacPluginService` | `com.maxmpz.audioplayer/decoder.flac` | 包路径反推 |
| `decoder/osl/OslPluginService` | `com.maxmpz.audioplayer/decoder.osl` | 包路径反推 |

> 它们只由 **native 的 uniq_name 驱动**。XML 没写 → 无富文案，但**功能完整**
> （`decoder/osl` 还实现了 `B()` 返回 `0x7f020304`、`А()` 返回 true）。
> ⇒ 再次印证：**XML 是文案层，不是存在性声明**。

---

## 5. 三个独立维度（理解插件系统的关键）

| 维度 | 提供方 | 数量 |
| --- | --- | ---: |
| 存在性 | `native_get_plugins()` | 20 + 2 = **22** |
| 文案 | `poweramp_builtin_plugins.xml` | 20 有 / 2 无 |
| 可实例化 | 命名约定反射 | 15 有 / 5 无 |

> 一个插件可以"存在但没有文案"（flac / decoder.osl），
> 也可以"有文案但没有 Java Service"（subsystem×3 / bench / dspi）。
> **三者互相独立**——这是理解插件系统的关键。

---

## 6. 可借鉴 / 不建议照抄

### 6.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **命名约定即注册表** | 零配置、零注解、零代码生成 |
| A2 | **实例缓存与构造器缓存分离** | 前者按插件、后者按类名 |
| A3 | **负缓存（失败也缓存哨兵）** | 避免重复反射与重复日志 |
| A4 | **构造器 setAccessible(true)** | 允许非 public 构造 |
| A5 | **对外把哨兵转 null** | 调用方只见 null |

### 6.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | uniqName 与包路径**强耦合** | 改包名 = 插件失效 |
| N2 | 手工 StringBuilder 拼类名 | 无编译期检查 |
| N3 | 5/20 内置必然走异常路径 | 首次启动打 5 条 Log.e |
| N4 | 依赖包名不被混淆 | `plugin/**` 必须 keep，否则全线失效 |

---

## 7. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`х([BI)` 协议~~ | ✅ **已闭合**（九）：LITTLE_ENDIAN ByteBuffer，msgID 在 offset `0x14` |
| Q2 | `flac` / `decoder.osl` 的**真实 uniqName** | 由 native 提供，**硬边界** |
| ~~Q3~~ | ~~`К` 的确切类型~~ | ✅ **已闭合**（二十六）：`utils/m` = 手写开放寻址哈希表，双数组 + 0.8 负载 |

> **Q2 是硬边界**：uniqName 由 native 决定，静态不可枚举。

---

> **续篇**：插件如何在列表页与设备绑定，见 `poweramp-plugin-device-binding.md`。

## 8. 证据索引

| 主题 | 位置 |
| --- | --- |
| 实例基类 | `plugin/А.smali`（95 行） |
| 唯一构造签名 | `plugin/А.smali:14` |
| 能力位 | `plugin/А.smali:38`（`B()`）、`:46`（`А()`） |
| 工厂方法 | `plugin/NativePluginManager.smali:907-1154` |
| 实例缓存查询 | `NativePluginManager.smali:917-921` |
| 构造器缓存 | `NativePluginManager.smali:1019-1049` |
| 反射签名数组 | `NativePluginManager.smali:45-61`（`Н`） |
| 类名派生 | `NativePluginManager.smali:952-1017`（点 `:955`、斜杠 `:979`） |
| 失败回退 | `NativePluginManager.smali:1053-1101` |
| 负缓存写回 | `NativePluginManager.smali:1110`（`utils/m.х`） |
| 哨兵转 null | `NativePluginManager.smali:1118-1126` |
| 空实现 | `plugin/InternalPluginService$NullPluginService.smali` |

> 口径：**build-1025**。
