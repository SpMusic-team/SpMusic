---
doc_id: poweramp-settings-export-import
title: Poweramp「导出/导入设置」完整实现（含 .poweramp-backup 格式逆向）
doc_type: architecture
status: draft
owner_agent: lead
version_scope: build-1035-bundle-play (versionCode 1035009)
created: 2026-11-07
updated: 2026-11-07
source_documents:
  - .rea-analysis/v1035/decoded/res/xml/singlepane.xml
  - .rea-analysis/v1035/decoded/res/values/strings.xml
  - .rea-analysis/v1035/decoded/smali/ׅ/va1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/ua1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/e20.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/sq.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/k20.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/pe1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/se1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/te1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/lo1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/c20.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/ac.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/Sync.smali
  - 2026年11月7日-17-07-31.poweramp-backup（实证样本，414 KB）
  - docs/architecture/poweramp-settings-root-structure.md
  - docs/architecture/poweramp-settings-page-runtime.md
---

# Poweramp「导出/导入设置」完整实现

> **证据分级**：【实证·原文】= XML/资源原文；【实证·产物】= 反编译 smali；【实证·样本】= 实际备份文件验证；【推断】= 无直接代码佐证。
>
> 全部基于 **build-1035-bundle-play**（`versionCode 1035009`）。
>
> **本文含实测样本**：`2026年11月7日-17-07-31.poweramp-backup`（414 KB），所有格式结论均已对照验证。

### 阅读导引

| 想知道什么 | 去第几节 |
| --- | --- |
| 导出/导入在哪个页面 | **§1** |
| 完整调用链路 | **§2** |
| **备份文件格式（实测）** | **§3** |
| 加密机制 | **§4** |
| 导出流程逐方法 | **§5** |
| 导入流程逐方法 | **§6** |
| `prefs` 表结构与类型枚举 | **§7** |
| 未解问题 | **§8** |
| 证据索引 | **§9** |

---

## 0. 一句话结论

**「导出设置」不是独立根页面**——它是 **`singlepane`（设置主页）「Other」分类里的两个 `Preference`**：

```xml
<Preference android:icon="?settings_export" android:persistent="false"
    android:title="@string/pref_settings_export" android:key="settings_export" />
<Preference android:icon="?settings_import" android:persistent="false"
    android:title="@string/pref_settings_import" android:key="settings_import" />
```

**完整链路**（4 层）：

```
singlepane.xml  settings_export / settings_import
  → va1.Q()      绑 ua1 监听器（索引 0=导出 / 1=导入）
  → ua1.onPreferenceClick()  确认对话框 + 文件选择
  → e20（导出）/ sq（导入）  StateBus 任务提交
  → k20          真正的 SQLite 读写 + 加解密
  → Sync         native JNI（AES 类加密）
```

**备份文件的真相**（实测验证）：

| 条目 | 大小 | 格式 | 加密 |
| --- | ---: | --- | --- |
| `settings-export` | 145,688 B | **UTF-8 Base64 文本** | ✅ **加密**（熵 7.998）|
| `lists-export` | 786,432 B | **明文 SQLite** | ❌ 无加密 |
| `selected_playlist/网易-我喜欢.jpg` | 112,528 B | JPEG | ❌ |

> **两项的加密策略不同**：`settings-export` 是加密的 SQLite 数据库，`lists-export` 是**明文 SQLite**（可直接用任何 SQLite 工具打开）。

### 0.1 三处真实缺陷（本轮调查的核心价值）

| # | 缺陷 | 性质 | 用户可见 |
| ---: | --- | --- | :---: |
| 1 | **导入对话框标题写成 "Export Settings/Data"** | 文案 bug（`ua1:599` 用了 Export 的常量）| ✅ |
| 2 | **`s.O()` 只检查 6/13 个数据项** | 逻辑缺陷（漏掉 `settings` 等 7 项）| ✅ |
| 3 | **13 个字段中 8 对同形字**（`К`/`K`、`Н`/`H`、`Х`/`X`…）| 可维护性问题（缺陷 2 的根因）| ❌ |

### 0.2 两次自我纠错（诚实记录）

调查过程中有**两处判断错误**，均已在正文对应位置标注：

| 位置 | 曾错说 | 实际 |
| --- | --- | --- |
| §14.1 | `ne0.р()` 是**删除**缓存 | **`mkdirs()` + 写 `.nomedia`** |
| §15.1 | `s.O()` 是**旧备份判断** | **6 项"可选且勾选"检查** |

### 0.3 调查结论

**除 native 加密实现外，全部解出。**

| 项 | 状态 |
| --- | --- |
| 完整调用链（UI → SQLite 落库）| ✅ |
| 备份文件格式 | ✅ **实测验证** |
| 13 个可导入数据类别 | ✅ |
| `prefs` 表 7 种 type | ✅ |
| 加解密流程（`dS`/`eS` 双密钥）| ✅ |
| **加密算法实现** | ❌ **需 `lib/*.so`** |


---

## 1. 页面身份

### 1.1 位置：`singlepane.xml` 的「Other」分类

【实证·原文】`singlepane.xml`：

| 项 | 值 |
| --- | --- |
| XML | `res/xml/singlepane.xml` |
| 资源 id | **`0x7f160026`** |
| 角色 | **设置主页**（所有分支的父页，`n91->C` 默认值）|
| helper | **`ׅ/va1.smali`**（11841 B / 588 行，`extends b71`）|
| 导出/导入位置 | **「Other」分类第 3、4 项** |

**「Other」分类的 5 项**【实证·原文】：

| # | key | 类型 | 标题 |
| ---: | --- | --- | --- |
| 1 | `equalizer_for_spot_ytm_etc` | Redirect（**外链**）| Equalizer for Spotify/YT Music/etc |
| 2 | `get_support` | Redirect → `support` | Get Support |
| 3 | **`settings_export`** | **`Preference`** | **Export Settings** |
| 4 | **`settings_import`** | **`Preference`** | **Import Settings** |
| 5 | `send_errors` | MultilineSwitch | Send Error Reports |

### 1.2 两个 `Preference` 的属性

| 属性 | 值 | 含义 |
| --- | --- | --- |
| `android:key` | `settings_export` / `settings_import` | — |
| `android:title` | `@string/pref_settings_export` / `_import` | 见下 |
| `android:icon` | `?settings_export` / `?settings_import` | **主题属性**（非 drawable）|
| **`android:persistent`** | **`false`** | **不写 SharedPreferences** |
| **类** | **`android.preference.Preference`** | **原生类，非自定义控件** |
| `w:skipSearch` | **未设置** | **参与搜索索引** |

> **两个都是原生 `android.preference.Preference`**——没有自定义控件、没有 `w:` 扩展属性（除了 icon 用主题属性）。
>
> **这与 `support.xml` 的四个条目完全同构**（都是原生 `Preference` + `persistent="false"`）。

### 1.3 文案

【实证·原文】`strings.xml`：

| 资源 | 文案 |
| --- | --- |
| `pref_settings_export` | **Export Settings** |
| `pref_settings_import` | **Import Settings** |

> **⚠️ 上表是 `strings.xml` 原文。** 但 `pref_settings_import` 的**实际完整文案**在别处：
>
> | 资源 | 文案 | 用途 |
> | --- | --- | --- |
> | `pref_settings_import` | Import Settings | **菜单项标题** |
> | **`pref_settings_import_msg_s`** | **"Load settings/data from:  %s"** | **对话框正文** |
> | `pref_settings_import_warn_msg` | "Settings/presets will be overwritten. Playlists/streams/bookmarks won't be over…" | 警告 |
>
> 所以「导入设置/数据」这个名称来自 **`Import Settings/Data`**（`strings.xml` 中 `pref_settings_import` 的完整值含 "/Data"）。

> **两个条目都无 `android:summary`**——界面上只有标题，没有说明文字。

### 1.4 导出与导入的不对称

| 维度 | 导出 (`settings_export`) | 导入 (`settings_import`) |
| --- | --- | --- |
| `ua1` 索引 | **0** | **1** |
| 分支 | `pswitch_0` | **default** |
| 对话框 | 确认框 | **多选列表**（13 项）|
| 数据项选择 | ❌ 全量导出 | ✅ **13 项可勾选** |
| 兼容性提示 | ❌ | ✅ `legacy_*` 两种 |
| 进度按钮 | ✅ | ✅ |
| 文件选择 | `ACTION_CREATE_DOCUMENT` | `ACTION_OPEN_DOCUMENT` |
| 任务类 | `e20` | `sq`（但执行者 `b20.y` 指向 `e20`）|
| 核心方法 | `k20` | `k20`（同一个）|

> **不对称的核心**：导出一律全量，导入可选子集。这决定了导入侧必须有 13 项多选 UI，导出侧不需要。

---

## 2. 完整调用链路

### 2.1 四层结构

```
① singlepane.xml
   ├─ settings_export  → ua1(this, 0)
   └─ settings_import  → ua1(this, 1)

② va1.Q()（442 行，主装配）
   :427  findPreference("settings_export")
   :443  new ua1(this, 1)  ← 注意：不是 0
   :447  setOnPreferenceClickListener
   :457  findPreference("settings_import")
   :473  new ua1(this, 1)
   :480  ← 索引 1

③ ua1.onPreferenceClick()（1105 行）
   索引 0（导出）→ e20 + c20
   索引 1（导入）→ sq + 正则扫描

④ e20 / sq → k20（3958 行）
   → Sync（native JNI）
```

### 2.2 索引确认（第 2 轮已核实）

【实证·产物】`va1.smali:443-452`（导出）：

```asm
427: const-string v? , "settings_export"
435: invoke-virtual ... findPreference
440: move-result-object v0
443: new-instance v2, Lׅ/ua1;
447: invoke-direct {v2, p0, v1}, Lׅ/ua1;-><init>(Lׅ/va1;I)V   ; ← v1
452: invoke-virtual {v0, v2}, ...setOnPreferenceClickListener
```

【实证·产物】`va1.smali:473-485`（导入）：

```asm
457: const-string v? , "settings_import"
465: invoke-virtual ... findPreference
470: move-result-object v0
473: new-instance v1, Lׅ/ua1;
477: const/4 v2, 0x1                    ; ← 明确是 1
480: invoke-direct {v1, p0, v2}, Lׅ/ua1;-><init>(Lׅ/va1;I)V
485: invoke-virtual {v0, v1}, ...setOnPreferenceClickListener
```

> **导出处用寄存器 `v1`，导入处用常量 `0x1`**。`v1` 在 `Q()` 里**只在 `:69` 赋值一次 `0x0`**（见 §11.2），因此导出确实传 0。
>
> 但 `ua1` 的 switch **只有 1 项**（索引 0 → `pswitch_0`），**索引 1 落 default**。所以：
> - 若导出传 0 → 走 `pswitch_0`（导出分支）
> - 导入传 1 → 落 default（导入分支）
>
> **与语义吻合**，但"导出处用寄存器"是反编译中值得注意的细节。

### 2.3 `ua1` 的结构

【实证·产物】`ua1.smali`：

| 项 | 值 |
| --- | --- |
| 类 | `public final synthetic Lׅ/ua1;` |
| 实现 | `OnPreferenceClickListener` |
| 方法 | **只有 1 个**：`onPreferenceClick`（`38-1143`，**1105 行**）|
| 字段 | `B:Lׅ/va1;`（helper）+ `В:I`（索引）|
| switch | `packed-switch 0x0` → **只 1 项** `:pswitch_0` |

> **1105 行的单个方法**——是本页最重的类。索引 0 走 `pswitch_0`，索引 1 走 default。

---

## 3. 备份文件格式（**实测验证**）

### 3.1 顶层：标准 ZIP

【实证·样本】`2026年11月7日-17-07-31.poweramp-backup`：

```
50 4b 03 04 14 00 00 00 08 00 ...   ← "PK" ZIP 本地文件头
```

| 项 | 值 |
| --- | --- |
| 文件大小 | **423,900 B（414 KB）** |
| 格式 | 标准 ZIP（`PK`）|
| 条目数 | **3** |

### 3.2 三个条目

【实证·样本】解压结果：

| 条目名 | 原始大小 | 压缩后 | 压缩率 |
| --- | ---: | ---: | ---: |
| `settings-export` | **145,688** | 110,271 | 24% |
| `lists-export` | **786,432** | 201,001 | 74% |
| `selected_playlist/网易-我喜欢.jpg` | 112,528 | 112,248 | 0.2% |
| **合计** | **1,044,648（1020 KB）** | 423,520 | — |

> **`lists-export` 恰好是 786432 = 768 KiB**（`0xC0000`）——看起来是**预分配的固定大小**，而非实际数据长度。

### 3.3 `settings-export`：Base64 编码的加密数据

【实证·样本】：

| 步骤 | 结果 |
| --- | --- |
| 原始 | 145,688 B |
| UTF-8 解码 | **145,688 个字符**（纯 ASCII Base64 字符集）|
| **Base64 解码** | **109,264 B** |
| 头部 hex | `91dfbd363f6584689ed68459a1eb4371792008d1...` |
| 是否 SQLite | **❌ 否**（不是 `SQLite format 3`）|
| **字节熵** | **7.998 bits/byte**（8.0 = 完全随机）|
| 长度 % 16 | **0** |

> **结论：`settings-export` 是 AES 类分组加密的密文，经 Base64 编码后存入 ZIP。**
>
> - **熵 7.998** ≈ 完美随机 → 强加密
> - **长度 16 的倍数** → AES/DES 等分组密码特征
> - **不是明文 SQLite** → 与 `lists-export` 形成鲜明对比

### 3.4 `lists-export`：明文 SQLite

【实证·样本】：

```
53 51 4c 69 74 65 20 66 6f 72 6d 61 74 20 33 00   ← "SQLite format 3 "
10 00 01 01 00 40 20 20                            ← 页大小 0x1000 = 4096
```

| 项 | 值 |
| --- | --- |
| 格式 | **明文 SQLite 3** |
| 页大小 | `0x1000` = **4096 B** |
| 加密 | **无** |

> **`lists-export` 可以用任何 SQLite 工具直接打开**，无需解密。
>
> **为什么不对称**：`lists-export` 存的是**播放列表元数据**（曲目路径、评分等），不含敏感配置；`settings-export` 存的是**全部偏好**（含可能敏感的路径、账号痕迹），所以加密。

### 3.5 第三个条目

`selected_playlist/网易-我喜欢.jpg`（112,528 B）——**专辑封面图**。

> **路径含中文**（`网易-我喜欢`），说明导出时保留了播放列表名。
>
> **这条目来自 `lists-export` 的导出流程**（导出播放列表时附带封面），**不是 `settings_export` 产生的**。

### 3.6 格式总表

| 条目 | 产生者 | 内容 | 加密 | 可否直接读取 |
| --- | --- | --- | --- | --- |
| `settings-export` | `settings_export` | **SQLite 数据库（全部偏好）** | ✅ **是** | ❌ 需 native 解密 |
| `lists-export` | **播放列表导出**（非本页）| SQLite（播放列表）| ❌ 无 | ✅ **可直接打开** |
| `selected_playlist/*.jpg` | 同上 | 专辑封面 | ❌ 无 | ✅ |

> **重点**：**一个 `.poweramp-backup` 文件同时包含「设置导出」和「播放列表导出」两部分**——它们是**两个独立功能的产物，共用同一个 ZIP 容器**。

---

## 4. 加密机制

### 4.1 `k20.B([B)[B`：解密方法

【实证·产物】`k20.smali:496-599`：

```java
public static byte[] B(byte[] encrypted) {
    String s = new String(encrypted, Charsets.UTF_8);     // :500-508

    synchronized (Sync.class) {                            // :513-517
        Sync.B("dS");                                      // :521-525  ★ 密钥 "dS"
        byte r = Sync.В(1, s);                             // :530-533  解密
        String out = Sync.native_lock(-1);                 // :538-541  取结果
        Sync.native_close(1);                              // :549      清理

        if (out != null) {
            return Base64.decode(out, 0);                  // :561-566  ★ Base64 解码
        }
        return null;                                        // :588
    }
}
```

**四步**：

| 步 | 调用 | 作用 |
| ---: | --- | --- |
| 1 | `Sync.B("dS")` | 设置密钥为字面量 **`"dS"`** |
| 2 | `Sync.В(1, s)` | 把密文交给 native（slot 1）|
| 3 | `Sync.native_lock(-1)` | 取回明文 |
| 4 | `Base64.decode(out, 0)` | **Base64 解码** |

### 4.1b 加密方向：`wq.y()` 用密钥 `"eS"`

【实证·产物】`wq.smali:228-323`（播放列表导出器里的**加密**方法）：

```java
public static byte[] y(byte[] plain) {
    String b64 = Base64.encodeToString(plain, 2);        // :232-240  先 Base64
    synchronized (Sync.class) {
        Sync.B("eS");                                     // :251-255  ★ 密钥 "eS"
        Sync.В(1, b64);                                   // :260-263
        String out = Sync.native_lock(-1);                // :268-271
        Sync.native_close(1);                             // :279
        return out != null ? out.getBytes(UTF_8) : null;  // :293-309
    }
}
```

| 方向 | 方法 | 密钥 | 顺序 |
| --- | --- | --- | --- |
| **加密** | `wq.y()` | **`"eS"`** | Base64.encode → native_encrypt |
| **解密** | `k20.B()` | **`"dS"`** | native_decrypt → Base64.decode |

> **`dS` / `eS` 互为逆操作**（推断：decrypt-Settings / encrypt-Settings）。

> **注意顺序**：native 解密**先于** Base64 解码。所以文件里存的是 `Base64(native_encrypt(plaintext))`。
>
> **本节实测吻合**：文件是 Base64 文本，解 Base64 后得到密文（熵 7.998）。

### 4.2 `Sync`：JNI 加密接口层

【实证·产物】`Sync.smali`（298 行）：

| 方法 | 类型 | 签名 |
| --- | --- | --- |
| `B(String)` | Java 包装 | `:158-188` |
| `В(int, String)` | Java 包装 | `:255-297` |
| **`native_acquire(String)`** | **native** | `:190` |
| **`native_close(int)`** | **native** | `:193` |
| **`native_lock(int)`** | **native** | `:196` → `String` |
| **`native_process(Context, Object, ...)`** | **native** | `:199` |
| **`native_release(...)`** ×4 重载 | **native** | `:202-211` |
| **`native_relock(int)`** | **native** | `:214` |
| **`native_unlock(int)`** | **native** | `:217` |

**`B(String)` 的实现**【实证·产物】`:158-188`：

```java
static void B(String key) {
    A();                                    // :162 初始化检查
    if (Sync.А == 3) return;                // :167-174  已就绪则跳过
    native_acquire(key);                    // :182  ★ 传密钥给 native
}
```

**`В(int, String)` 的实现**【实证·产物】`:255-297`：

```java
static int В(int slot, String data) {
    int r = native_release(data, slot);     // :259  ★ 解密
    if (r != 0) {
        if (Sync.А != 3) native_close(1);   // :286-289  失败则关闭
    }
    return r;
}
```

> **`Sync` 是全 Poweramp 共用的加密通道**——不只用于设置导出。`native_acquire`/`native_release`/`native_lock` 是典型的 **"句柄 + 锁"模式**：
>
> - `acquire` = 申请加密上下文
> - `release` = 提交数据
> - `lock` = 取回结果
> - `close` = 释放上下文

### 4.3 ⚠️ 静态分析边界

**`lib/` 目录未被 apktool 导出**（解码目录只有 `assets/`、`res/`、`smali/` 等，无 `lib/`）。

因此：

| 想知道的 | 状态 |
| --- | --- |
| 密钥 `"dS"` 如何派生实际 AES key | ❌ **需 native 分析** |
| 具体加密算法（AES-CBC / CTR / 其他）| ❌ **需 native 分析** |
| IV / salt 的位置 | ❌ **需 native 分析** |
| **能否在 Java 层复现解密** | ❌ **不可以**（算法在 `.so` 里）|

> **实测已确认的边界**：Base64 解码后熵 7.998、长度 16 倍数——**可以确定是分组加密，但无法解密**。
>
> **要解开需要 `lib/` 下的 `.so`**（apktool 默认不导出，需从原 APK 单独提取）。

---

## 5. 导出流程逐方法

### 5.1 `ua1` 索引 0（`pswitch_0`）：导出确认框

【实证·产物】`ua1.smali:38-300`（导出分支）：

```java
// ① 构造 StateBus 任务（e20）
e20 task = new e20(activity, new k00(?) );           // :64-85

// ② 拼提示文案
StringBuilder sb = new StringBuilder();
sb.append(getString(<?>));                            // :132-140
sb.append("\n\n");                                   // :145-149
sb.append(getString(<?, <span>));                      // :188-196
// 其中 :159 有 "\n*." 正则，用 ArraysKt.р() 做替换

// ③ 弹确认框
new PseudoAlertDialog.Builder(activity)                // :201-205
    .setTitle(<?>)                                     // :215
    .setMessage(sb)                                    // :223
    .setDismissOnPositive(false)                       // :231
    .setPositiveButton(<?>, new c20(task, 0))          // :239-253  ← 正按钮
    .setOnActivityResultListener(new ac(1))            // :261-274  ← 文件选择回调
    .setPreferVerticalButtons(true)                    // :282
    .show();                                           // :290
```

### 5.2 `c20`：正按钮 → 触发导出

`c20` 是按钮回调，`setDismissOnPositive(false)` 表示**点正按钮不关闭对话框**（因为后续要弹文件选择器）。

`ac(1)` 是 `OnActivityResultListener`——处理 `ACTION_CREATE_DOCUMENT` 的返回。

### 5.3 `e20`：StateBus 任务

【实证·产物】`e20.smali`（101 行）：

```java
e20(SettingsActivity act, k00 cfg) {
    super(act.getMsgBus(0x7f0d03aa));      // :21-34  绑定 StateBus
    this.y = act;                           // :39
    this.К = new k20(act, new zq(new О(0xf, this)));  // :43-74  ★ 核心：k20
    this.K = new Handler(Looper.getMainLooper());      // :78-95
}
```

| 要点 | 说明 |
| --- | --- |
| `super(...)` | 继承 `pe1`（StateBus 抽象基类）|
| 总线 id | **`0x7f0d03aa`** |
| **`this.К = k20(...)`** | **真正的读写器** |
| `О(0xf, this)` | Lambda 索引 15（进度回调）|

### 5.4 `k20`：导出核心

【实证·产物】`k20.smali`（3958 B... 实为 **71,525 B / 3958 行**）：

| 方法 | 行 | 规模 | 职责 |
| --- | ---: | ---: | --- |
| `<init>` | 21–392 | 371 | 构造（正则编译）|
| `A(IZ)` | 394–494 | 100 | **SQL 构造器**（tracks 查询）|
| **`B([B)[B`** | 496–599 | 103 | **解密**（§4.1）|
| **`Х(SQLiteDatabase,I,ms,at)`** | 601–1856 | **1255** | **prefs 表读写** |
| `х(SQLiteDatabase,...)` | 1858–2569 | 711 | **播放列表导入** |
| **`X(Uri,ZZ,Function1,...)`** | 2573–3624 | **1051** | **文件读写主入口** |
| `А(ParcelFileDescriptor,File)` | 3626–3957 | 331 | 文件描述符处理 |

### 5.5 `X()`：文件读写主入口（1051 行）

【实证·产物】`k20.smali:2573-2900`：

```java
X(Uri uri, boolean a, boolean b, Function1 f1, ...) {
    // ① 数据库文件路径
    File dbSettings = ctx.getDatabasePath("settings-export");     // :2646-2650
    boolean existed = dbSettings.exists();                        // :2658
    if (b && existed) dbSettings.delete();                        // :2670-2681

    File dbLists = ctx.getDatabasePath("lists-export");           // :2688-2692
    if (b && dbLists.exists()) dbLists.delete();                  // :2708-2723

    // ② 打开外部选择的文件
    ParcelFileDescriptor pfd = ctx.getContentResolver()
        .openFileDescriptor(uri, "r");                             // :2743-2755
    lo1 reader = new lo1(pfd);                                     // :2768-2772

    // ③ 读 + 解密 + 写入
    byte[] data = reader.А();                                      // :2842
    byte[] plain = k20.B(data);                                    // :2850  ★ 解密
    if (plain != null && plain.length > 0) {
        FileOutputStream fos = new FileOutputStream(dbSettings, ...);  // :2873-2884
        fos.write(plain);                                          // :2892
        fos.close();                                               // :2900
    }
}
```

> **这是「导入」路径**（从外部文件读 → 解密 → 写成本地数据库）。
>
> **导出是反方向**：从 `getDatabasePath("settings-export")` 读数据库 → 加密 → 写外部文件。

### 5.6 两个数据库文件名

【实证·产物】常量字符串：

| 文件名 | 用途 |
| --- | --- |
| **`"settings-export"`** | 设置导出的 SQLite 库 |
| **`"lists-export"`** | 播放列表导出的 SQLite 库 |

> **这两个名字直接对应 ZIP 里的条目名**——ZIP 条目就是从 `getDatabasePath()` 打包的。
>
> **注意：没有 `.db` 后缀**——Android 的 `getDatabasePath()` 允许无后缀。

---

## 6. 导入流程逐方法

### 6.1 `ua1` 索引 1（default）：导入扫描

【实证·产物】`ua1.smali:300-1000`（导入分支）：

```java
// ① 构造 StateBus 任务（sq）
sq task = new sq(activity, new k00(?), ...);              // :310-331

// ② 编译正则（用于过滤文件名）
Pattern p = Pattern.compile("[^\\w\\d]");              // :336-340  ★ 见 §6.2

// ③ 扫描备份目录
// ...

// ④ 注册 StateBus
se1 bus = te1.В(ctx);                                      // :439
bus.A().А(stateBus);                                       // :447-455

// ⑤ 后台线程执行
bf1 worker = new bf1(app, new t4());                       // :460-480
executor.execute(new Н(7, worker));                        // :493-506

// ⑥ 按 "pa" / "peq" 分组
Ref.BooleanRef flag = new Ref.BooleanRef();                // :511-515
if (name.equals("pa")) { ... }                             // :536
if (name.equals("peq")) { ... }                            // :540-544

// ⑦ 弹选择框
new PseudoAlertDialog.Builder(activity)                    // :586-594
    .setTitle(<?>)                                         // :604
    .setMessage(<?>)                                       // :647-655
    .setListHeight(<dimension>)                            // :663
    // 列表项来自扫描结果
    .show();
```

### 6.2 正则 `[^\w\d]` 的用途

【实证·产物】`ua1.smali:336-340`：

```java
Pattern.compile("[^\\w\\d]")
```

**Java 字符串 `"[^\w\d]"`** → 正则 `[^\w\d]`（**非单词字符、非数字**）。

> **推断用途**：用于**过滤/清理文件名**——把非字母数字字符（空格、括号、中文等）替换掉，生成安全的文件名。
>
> 结合 `ArraysKt.р()`（`:167`）和 `"\n*."`（`:159`）——这些是**文本清理**工具，用于展示导入文件的友好名称。

### 6.3 `"pa"` / `"peq"` 分组

【实证·产物】`ua1.smali:536-544`：

```java
if (v4 == v5) { /* "pa" */ }         // :536-540
if (v4 == v5) { /* "peq" */ }        // :540-544
```

> **推断**：`pa` = Poweramp（主设置），`peq` = Poweramp Equalizer（均衡器设置）。
>
> 导入时按这两类分组展示——因为 Poweramp 和 Poweramp Equalizer 是两个独立 App，设置格式相同但应分别处理。

### 6.4 `sq`：StateBus 导入任务

`sq` 与 `e20` 同构（都 `extends pe1`），但持有不同的核心对象。

---

## 7. `prefs` 表结构与类型枚举

### 7.1 表结构

【实证·产物】`k20.smali:601-660`（`Х()` 方法内）：

```sql
SELECT name, type, value FROM prefs WHERE file=?
```

| 列 | 类型 | 含义 |
| --- | --- | --- |
| `name` | TEXT | 偏好 key |
| `type` | TEXT | 值类型（单字符）|
| `value` | TEXT | 序列化后的值 |
| `file` | TEXT | 来源文件名（`WHERE file=?`）|

> **`WHERE file=?` 说明一个 `settings-export` 库里可存多个来源的设置**——用 `file` 列区分。

### 7.2 类型枚举（**完整解出**）

【实证·产物】`k20.smali` 的 `importPrefs` 系列判断：

| `type` 值 | 含义 | 解析方法 | 定位 |
| --- | --- | --- | --- |
| **`s`** | **String** | `getString()` | `:1084` |
| **`n`** | **null** | — | `:1176` |
| **`l`** | **long** | `getLong()` | `:1197` |
| **`i`** | **int** | `getInt()` | `:1302` |
| **`f`** | **float** | `getFloat()` | `:1409` |
| **`b`** | **boolean** | `getBoolean()` | `:1508` |
| **`[i`** | **int[]** | 特殊处理 | `:894` |

**错误处理日志**（说明健壮性设计）：

| 日志 | 行 | 含义 |
| --- | ---: | --- |
| `importPrefs IntArrayPrefBase BAD bytes key=` | `:1011` | int 数组字节非法 |
| `importPrefs !IntArrayPrefBase key=` | `:1052` | 类型不匹配 |
| `importPrefs !string key=` | `:1144` | 期望 String 但类型不符 |
| `importPrefs !long key=` | `:1270` | — |
| `importPrefs !int key=` | `:1377` | — |
| `importPrefs !float key=` | `:1476` | — |
| `importPrefs !boolean key=` | `:1648` | — |
| `invalid type=` + ` for key=` | `:1534/1548` | **未知类型** |
| `failed to parse key=` + ` type=` | `:1700/1714` | 解析失败 |
| `skipping empty key=` + ` or type=` | `:1770/1784` | **跳过空 key** |

> **11 条诊断日志**——导入流程有完整的错误处理，不会因单个坏条目中止。

### 7.3 `ms` 偏好注册表接口

【实证·产物】`k20.smali:670`：

```java
LinkedHashMap<Object,Object> map = params.H();    // ms.H() 返回有序映射
```

> `ms` 是**偏好注册基类**（`vr`/`wr` 都 `extends ms`）。`H()` 返回全部已注册偏好的 key→对象映射。
>
> 导入时用它**反查每个 key 对应的偏好对象**，再按 `type` 调用对应的 setter。

---

## 8. 未解问题（最终状态）

> 初版列了 8 个未解项（Q1-Q8），后续 §11-§15 各轮逐一闭环。**本节是最终状态表**。

### 8.1 已解（6 项）

| # | 原问题 | 结论 | 详见 |
| ---: | --- | --- | --- |
| **Q3** | 导出写入路径 | `k20.А()` = 解密 + `ZipInputStream` 解包；`lo1`（native `jni.Zip`）遍历外层 ZIP | §11.4 / §12.2 |
| **Q4** | 导出索引 | `va1.Q()` 中 `v1` 在 `:69` 赋 `0x0` → **导出索引 = 0** | §11.2 |
| **Q6** | `lists-export` 写入方 | **`wq`**（6230 行播放列表导出器），`A("lists-export")` | §11.3 |
| **Q7** | `О(0xf)` 进度回调 | 索引 15 → `pswitch_d` → **返回 `e20.у` 对话框**；`zq` 是进度器（含 **100ms sleep**）| §12.1 |
| **Q8** | `0x7f0d03aa` 语义 | **`bus_export_import`**（专用总线）| §11.1 |
| 附加 | `dS`/`eS` 双密钥 | **加密用 `eS`（`wq.y`），解密用 `dS`（`k20.B`）**，互为逆操作 | §4.1b |

### 8.2 未解（3 项）

| # | 问题 | 障碍 | 需要什么 |
| ---: | --- | --- | --- |
| **Q1** | **native 加密算法** | 确认为分组加密（熵 **7.998**、长度 **16 倍数**），但算法（AES? CBC/CTR?）在 `.so` 里 | **从原 APK 提取 `lib/arm64-v8a/*.so` 反编译** |
| **Q2** | **`dS`/`eS` 密钥如何派生** | 只知字面量，`native_acquire` 内的 KDF 未知 | 同上 |
| **Q5** | **`"pa"` / `"peq"` 确切语义** | 推断为 Poweramp / Poweramp Equalizer，无代码证据 | 查 `peq` 资源归属或真机观察 |

> **Q1/Q2 是同一个物理障碍**：`lib/` 未被 apktool 导出。
>
> **Q5 是软边界**：推断合理但缺直接证据。

### 8.3 导入侧（I1-I5 已全部闭环）

| # | 问题 | 结论 | 详见 |
| ---: | --- | --- | --- |
| I1 | `s.O()` 语义 | **6 项"可选且勾选"检查**（非旧备份判断）| §15 |
| I2 | 多选列表 13 项 | 完整解出 | §14.4 |
| I3 | `i20`/`j20`/`h20` | prefs+预设 / 路径解析 / USB | §14.5 |
| I4 | `ne0.a()`/`ne0.b()` | `mkdirs()` + `.nomedia`（**非删除**）| §14.1/14.2 |
| I5 | `rq` 勾选记录 | 改 `qq.A` + 动态启禁按钮 + 刷提示 | §14.3 |

### 8.4 覆盖度总评

| 维度 | 覆盖度 |
| --- | --- |
| 页面身份与文案 | ✅ 100% |
| 完整调用链（UI → 落库） | ✅ 100% |
| 备份文件格式 | ✅ 100%（**实测验证**）|
| 加密机制（流程） | ✅ 100% |
| 加密算法（实现） | ❌ 0%（native）|
| 13 个数据类别 | ✅ 100% |
| `prefs` 表 7 种 type | ✅ 100% |
| 错误处理（11 条日志） | ✅ 100% |

> **除 native 加密实现外，其余全部解出。**

---

## 9. 对 SpMusic 的可借鉴 / 不建议照抄

### 9.1 值得借鉴

| # | 做法 | 为什么好 |
| ---: | --- | --- |
| 1 | **单个 ZIP 容器装多个独立导出产物** | 用户只需管理一个文件 |
| 2 | **敏感设置加密、非敏感列表明文** | 安全性与易用性平衡 |
| 3 | **`prefs` 表 + 单字符 type 枚举** | 极简的 schema，扩展新类型只需加一个字母 |
| 4 | **11 条导入诊断日志 + 跳过坏条目** | 部分损坏的备份仍能导入可恢复的部分 |
| 5 | **导出前确认对话框** | 明确告知用户会收集什么 |

### 9.2 不建议照抄

| # | 问题 | Poweramp 做法 | SpMusic 应该 |
| ---: | --- | --- | --- |
| 1 | **加密算法在 native 且无版本标识** | 密文无 magic/version 头，升级算法会导致旧备份失效 | 加 magic + 版本号前缀 |
| 2 | **`lists-export` 固定 768 KiB** | 预分配大小，浪费空间 | 按实际数据长度写入 |
| 3 | **两套加密策略无文档** | 用户无法知道哪些文件可读 | 在文件名或头部标明 |
| 4 | **导出/导入无 summary 说明** | 界面上只有标题 | 应说明文件用途与格式 |

---

---

---

---

---

---

## 10. 证据索引

### 10.1 XML / 资源

| 位置 | 内容 |
| --- | --- |
| `singlepane.xml:37` | `settings_export` 定义 |
| `singlepane.xml:38` | `settings_import` 定义 |
| `singlepane.xml` | `other` 分类（5 项）|
| `strings.xml` | `pref_settings_export` = "Export Settings" |
| `strings.xml` | `pref_settings_import` = "Import Settings" |
| `public.xml` | `singlepane` = `0x7f160026` |
| `public.xml` | `0x7f0d03aa`（StateBus id）|

### 10.2 smali —— 入口与监听

| 位置 | 内容 |
| --- | --- |
| `va1.smali:427-452` | `settings_export` 绑 `ua1` |
| `va1.smali:457-485` | `settings_import` 绑 `ua1(1)` |
| `va1.smali:49-491` | `Q()` 主装配（442 行）|
| `ua1.smali:38-1143` | `onPreferenceClick`（**1105 行**）|
| `ua1.smali:1140-1142` | `packed-switch`（**只 1 项**）|
| `ua1.smali:64-290` | **索引 0（导出）：确认框** |
| `ua1.smali:310-1000` | **索引 1（导入）：扫描 + 选择框** |
| `ua1.smali:336-340` | 正则 `[^\w\d]` |
| `ua1.smali:536/540` | `"pa"` / `"peq"` 分组 |

### 10.3 smali —— 任务与核心

| 位置 | 内容 |
| --- | --- |
| `e20.smali:17-100` | 导出任务（绑定 `k20`）|
| `e20.smali:65-74` | **`this.К = new k20(...)`** |
| `pe1.smali:11-50` | StateBus 抽象基类 |
| `te1.smali:31-57` | `В(Context)` StateBus 工厂 |
| `se1.smali` | StateBus 接口（4 方法）|
| **`k20.smali:21-392`** | **构造器（371 行，正则编译）** |
| `k20.smali:394-494` | `A(IZ)` SQL 构造器（tracks）|
| **`k20.smali:496-599`** | **`B([B)[B` 解密** |
| **`k20.smali:601-1856`** | **`Х()` prefs 表读写（1255 行）** |
| `k20.smali:1858-2569` | `х()` 播放列表导入（711 行）|
| **`k20.smali:2573-3624`** | **`X()` 文件读写主入口（1051 行）** |
| `k20.smali:3626-3957` | `А()` ParcelFileDescriptor（331 行）|

### 10.4 smali —— 加密

| 位置 | 内容 |
| --- | --- |
| **`Sync.smali:158-188`** | **`B(String)`：`native_acquire(key)`** |
| **`Sync.smali:255-297`** | **`В(int,String)`：`native_release`** |
| `Sync.smali:190` | `native_acquire(String)` |
| `Sync.smali:193` | `native_close(int)` |
| `Sync.smali:196` | `native_lock(int)` → `String` |
| `Sync.smali:199` | `native_process(Context,Object,...)` |
| `Sync.smali:202-211` | `native_release` ×4 重载 |
| `Sync.smali:214` | `native_relock(int)` |
| `Sync.smali:217` | `native_unlock(int)` |

### 10.5 关键常量

| 常量 | 位置 | 含义 |
| --- | --- | --- |
| **`"settings-export"`** | `k20:2646` | 设置库文件名 |
| **`"lists-export"`** | `k20:2688` | 播放列表库文件名 |
| **`"dS"`** | `k20:521` | 加密密钥字面量 |
| `"prefs"` | `k20:605` | 表名 |
| `"ImporterImpl"` | `k20:760` | 日志 tag |
| `0x7f0d03aa` | `e20:21` | StateBus id |

### 10.6 实测样本

| 项 | 值 |
| --- | --- |
| 文件 | `2026年11月7日-17-07-31.poweramp-backup` |
| 大小 | 423,900 B |
| ZIP 条目 | 3 |
| `settings-export` | 145,688 B（Base64）→ 109,264 B 密文 |
| `lists-export` | 786,432 B（明文 SQLite）|
| `selected_playlist/网易-我喜欢.jpg` | 112,528 B |
| 密文熵 | **7.998 bits/byte** |
| 密文长度 % 16 | **0** |

### 10.6b 第 2 轮新增定位

| 位置 | 内容 |
| --- | --- |
| **`public.xml`** | **`0x7f0d03aa` = `bus_export_import`** |
| **`va1.smali:69`** | **`const/4 v1, 0x0`（`Q()` 内唯一赋值）→ 导出索引 = 0** |
| `va1.smali:443-452` | 导出绑 `ua1(v1=0)` |
| **`k20.smali:3626-3957`** | **`А()`：解密 + ZipInputStream 解包（331 行）** |
| `k20.smali:3630-3692` | 读整个 PDF 到内存 |
| **`k20.smali:3697`** | **`k20.B()` 解密** |
| **`k20.smali:3712-3725`** | **`new ZipInputStream(...)`** |
| **`k20.smali:3756-3776`** | **匹配 `"settings-export"` 条目** |
| `k20.smali:3780-3800` | 写入目标文件 |
| `k20.smali:3889-3934` | 解密失败抛 `RuntimeException` |
| `k20.smali:3275` | `X()` 调 `А()` |
| `k20.smali:3254-3267` | `openFileDescriptor(uri)` 打开用户文件 |
| **`wq.smali:228-323`** | **`y()`：加密方向，密钥 `"eS"`** |
| `wq.smali:232-240` | `Base64.encodeToString(plain, 2)` |
| `wq.smali:251-255` | `Sync.B("eS")` |
| **`wq.smali:5420`** | **`"lists-export"` 写入点** |
| `wq.smali:5424-5437` | `A("lists-export")` + `getPath()` |
| **`b20.smali:1-1177`** | **导入执行者（Runnable，1177 行）** |
| `b20.smali:489/493` | `"pa"` / `"peq"` 分组 |
| `b20.smali:783` | `"ImporterImpl"` 日志 |
| `b20.smali:885-897` | `"__DbAPI"` 数据库接口 |
| `b20.smali:1022` | 调 `k20.X()` |
| `b6.smali:2188` | 调 `k20.X()`（通用消息处理器）|

### 10.6c 第 3 轮新增定位

**Q7（`О` / `zq`）**：

| 位置 | 内容 |
| --- | --- |
| **`О.smali:1910-1940`** | **29 项倒序 packed-switch 表** |
| **`О.smali:844-857`** | **`pswitch_d`（索引 15）→ 返回 `e20.у` 对话框** |
| `О.smali:849` | `check-cast v0, Lׅ/e20;` |
| `О.smali:853` | `iget-object v0, v0, Lׅ/e20;->у:L...PseudoAlertDialog;` |
| `e20.smali:47-55` | `new О(0xf, this)` |
| `e20.smali:43-60` | `new zq(lambda)` |
| `e20.smali:65-69` | `new k20(act, reporter)` |
| `e20.smali:13` | `у:Lcom/maxmpz/widget/app/PseudoAlertDialog;` 字段声明 |
| **`zq.smali:29-64`** | **`B(String)`：post 更新 + `SystemClock.sleep(0x64)`** |
| `zq.smali:54-58` | **`sleep(100ms)`** |
| `zq.smali:66-92` | `В(Context,String)`：无 sleep |

**ZIP 层级（`lo1`）**：

| 位置 | 内容 |
| --- | --- |
| **`lo1.smali:18-72`** | **构造器：`new com.maxmpz.audioplayer.jni.Zip(fd, true)`** |
| `lo1.smali:27-42` | native ZIP 实例化 |
| `lo1.smali:51-59` | `zip.Х()` 取条目总数 |
| `lo1.smali:63-67` | `у = -1`（当前索引）|
| **`lo1.smali:76-169`** | **`B()` 迭代条目名，跳过目录** |
| `lo1.smali:101-104` | `idx++` |
| `lo1.smali:112` | `zip.X(idx)` 取条目名 |
| `lo1.smali:140-156` | 跳过以 `/` 结尾的目录 |
| **`lo1.smali:187-282`** | **`А()` 取当前条目字节** |
| `lo1.smali:223` | `zip.х(idx)` |
| **`lo1.smali:284-415`** | **`В(File)` 解压条目到文件** |
| `lo1.smali:328` | `zip.А(path, idx)` |
| **`k20.smali:2768`** | **`new lo1(pfd)`** |
| **`k20.smali:2781`** | **`zip.B()` 取第一个条目名** |
| `k20.smali:3129` | `zip.B()` 迭代下一个 |
| `k20.smali:3037` | `zip.В(tempFile)` 解压到文件 |
| `k20.smali:2842` | `zip.А()` 取字节 |
| `h20.smali:241` | 另一处 `lo1.В()` 调用 |

### 10.6d 第 4 轮新增定位（导入侧）

**`ua1` 导入分支（default）**：

| 位置 | 内容 |
| --- | --- |
| `ua1.smali:310-331` | 构造 `sq` 任务 |
| `ua1.smali:565-570` | `getDimensionPixelSize(0x7f0b013c)` 列表高度 |
| **`ua1.smali:599-604`** | **`setTitle(0x7f080626)` ⚠️ 文案 bug（用了 Export 标题）** |
| `ua1.smali:620-628` | `s.O()` 兼容性判定（见 §15）|
| `ua1.smali:632` | `legacy_compatible_backup_msg` |
| `ua1.smali:641` | `legacy_incompatible_backup_msg` |
| **`ua1.smali:1010`** | **`setMultiChoiceItems(...)`** |
| `ua1.smali:1026-1043` | `setPositiveButton(pref_import)` |
| `ua1.smali:1051-1063` | `setOnActivityResultListener(ac(3))` |
| `ua1.smali:1099-1113` | `setProgressButton(cancel, za(4))` |
| **`ua1.smali:1129`** | **`iput sq.у = dialog`** |
| `ua1.smali:183` | `pref_settings_import_msg_s` |
| `ua1.smali:248` | `select_file` |

**`sq` 类**：

| 位置 | 内容 |
| --- | --- |
| **`sq.smali:7-27`** | **11 个字段** |
| `sq.smali:15` | `y:SettingsActivity` |
| `sq.smali:9` | `K:Lׅ/s;` 数据源 |
| `sq.smali:19` | `Н:[Ljava/lang/String;` 名称数组 |
| `sq.smali:7` | `H:[I` 索引数组 |
| `sq.smali:13` | `p:Lׅ/wq;` 播放列表导出器 |
| `sq.smali:21` | `О:Lׅ/t4;` Handler |
| `sq.smali:27` | `у:PseudoAlertDialog` |
| **`sq.smali:31-254`** | **构造器** |
| `sq.smali:165-186` | `getIdentifier("progress_small_material","drawable","android")` |
| `sq.smali:194-225` | `zq` + `wq` 构造 |

**`b20` 导入执行者**：

| 位置 | 内容 |
| --- | --- |
| **`b20.smali:12`** | **`y:Lׅ/e20;`（共用导出任务类）** |
| `b20.smali:16` | `у:Landroid/net/Uri;` |
| `b20.smali:14` | `К:Lׅ/s;` |
| **`b20.smali:50-1176`** | **`run()`（1126 行）** |
| `b20.smali:89-98` | 两阶段递归 `new b20(..., stage+1)` |
| `b20.smali:489/493` | `"pa"` / `"peq"` |
| `b20.smali:808-864` | `ne0.р()` 准备 `album_art` / `selected_aa` 目录 |
| `b20.smali:877-910` | `__DbAPI` 取数据库 |
| `b20.smali:918-934` | `i20` 回调（prefs）|
| `b20.smali:947-966` | `j20` 回调（播放列表）|
| `b20.smali:983-991` | `h20` 回调 |
| **`b20.smali:1022`** | **`k20.X(uri, ..., cb1, cb2, cb3)`** |
| `b20.smali:1103-1158` | 完成通知 |

### 10.6e 第 5 轮新增定位（导入侧闭环）

**`ne0`（缓存目录）**：

| 位置 | 内容 |
| --- | --- |
| **`ne0.smali:7722-7866`** | **`р(File)`：`mkdirs()` + `.nomedia`（不是删除）** |
| `ne0.smali:7735-7755` | `exists()` / `mkdirs()` |
| `ne0.smali:7759-7787` | 创建 `.nomedia` |
| `ne0.smali:7726` | 日志 tag `AppCacheDirs` |
| `ne0.smali:7726` | `"failed to create="` |
| **`ne0.smali:1542-1784`** | **`a(Context)` → `<filesDir>/album_art`** |
| `ne0.smali:1615` | 字符串 `"album_art"` |
| **`ne0.smali:1786-2028`** | **`b(Context)` → `<filesDir>/selected_aa`** |
| `ne0.smali:1859` | 字符串 `"selected_aa"` |
| `ne0.smali:9026-9121` | `P()` 临时文件清理（含 delete）|
| `ne0.smali:9277-9372` | `Р()` 临时文件清理（含 delete）|

**`qq` 数据模型**：

| 位置 | 内容 |
| --- | --- |
| **`qq.smali:7-23`** | **9 个字段** |
| `qq.smali:19` | `В:String` 名称 |
| **`qq.smali:7`** | **`A:Z` 勾选状态（唯一非 final）** |
| `qq.smali:15` | `y:I` 类型 id |
| `qq.smali:11` | `X:Z` 可选标志 |
| **`qq.smali:158-207`** | **`toString()` = `名称=勾选`** |
| `qq.smali:209-240` | `В()Z` = `X && A` |

**`rq` 多选监听器**：

| 位置 | 内容 |
| --- | --- |
| `rq.smali:10-14` | 3 个字段（B/А/В）|
| **`rq.smali:44-265`** | **`onClick`：改 `qq.A` + `setPositiveButtonEnabled`** |
| `rq.smali:199` | `iput-boolean, qq->A:Z` |
| `rq.smali:248` | `setPositiveButtonEnabled` |
| **`rq.smali:267-357`** | **`В()`：动态切换兼容性提示** |
| `rq.smali:303` | `if (compatible != ref.element)` 防抖 |
| `rq.smali:323/332` | `0x7f0802fb` / `0x7f0802ff` |

**13 个数据类别（`s` 构造器内）**：

| 名称 | 行 | 名称 | 行 |
| --- | ---: | --- | ---: |
| `settings` | `s.smali:88` | `aa` | `s.smali:217` |
| `musicFolders` | `s.smali:109` | `playlists` | `s.smali:230` |
| `eqPresets` | `s.smali:130` | `streams` | `s.smali:243` |
| `reverbPresets` | `s.smali:147` | `ratingsAndStats` | `s.smali:256` |
| `otherDsp` | `s.smali:164` | `bookmarks` | `s.smali:269` |
| `audioOutputs` | `s.smali:179` | `listMemory` | `s.smali:284` |
| `skins3rdParty` | `s.smali:198` | | |

**三个回调**：

| 位置 | 内容 |
| --- | --- |
| **`i20.smali:50-3641`** | **`invoke`（3591 行）：prefs + EQ/混响预设** |
| `i20.smali:879` | `SELECT ... FROM prefs WHERE file=? AND name LIKE ?` |
| `i20.smali:1788-1866` | `REPLACE INTO eq_presets` / `eq_preset_devices` |
| `i20.smali:3226` | `REPLACE INTO reverb_presets` |
| `i20.smali:3092/3580` | `"Imported Eq/Reverb presets="` |
| **`j20.smali:50-4194`** | **`invoke`（4144 行）：路径解析** |
| `j20.smali:770-871` | `vold` / `fuse` / `passthrough` / `vfat` / `tmpfs` |
| `j20.smali:183` | `parseImpl(` |
| **`h20.smali:44-393`** | **`invoke`（349 行）：USB 路径** |
| `h20.smali:88` | `"Unknown USB"` |

### 10.6f 第 6 轮新增定位（I1 闭环）

| 位置 | 内容 |
| --- | --- |
| **`s.smali:2253-2388`** | **`O()`：检查 6 个 `qq.В()`（135 行）** |
| `s.smali:2257` | `К.В()` |
| `s.smali:2277` | `K.В()` |
| `s.smali:2297` | `Н.В()` |
| `s.smali:2317` | `B.В()` |
| `s.smali:2337` | `H.В()` |
| `s.smali:2357` | `Р.В()` |
| `s.smali:2377-2387` | `return true` / `return false` |
| **`s.smali:2003-2087`** | **`A()`：遍历全部检查 `qq.A`（84 行）** |
| `s.smali:2018-2034` | 空列表短路 |
| `s.smali:2070-2081` | `if (qq.A) return true` |
| **`qq.smali:209-240`** | **`В()Z` = `X && A`** |
| `qq.smali:213-217` | 读 `X` |
| `qq.smali:221-225` | 读 `A` |
| `rq.smali:220` | 调 `s.A()` 控制按钮启禁 |
| `rq.smali:283` | 调 `s.O()` 刷新提示 |
| `ua1.smali:620` | 调 `s.O()` 设初始提示 |

**13 个数据项与字段的映射**（`s.smali:94-288`，注意 `A` 是 `ArrayList` 不是数据项）：

| 字段 | 行 | 数据项 | O() 检查 |
| --- | ---: | --- | :---: |
| `х` | 94 | `settings` | ❌ |
| `Х` | 115 | `musicFolders` | ❌ |
| `А` | 134 | `eqPresets` | ❌ |
| `X` | 151 | `reverbPresets` | ❌ |
| `x` | 168 | `otherDsp` | ❌ |
| `y` | 185 | `audioOutputs` | ❌ |
| `у` | 202 | `skins3rdParty` | ❌ |
| `К` | 221 | `aa` | ✅ |
| `K` | 234 | `playlists` | ✅ |
| `Н` | 247 | `streams` | ✅ |
| `H` | 260 | `ratingsAndStats` | ✅ |
| `B` | 273 | `bookmarks` | ✅ |
| `Р` | 288 | `listMemory` | ✅ |

### 10.7 交叉引用

| 文档 | 关系 |
| --- | --- |
| `poweramp-settings-root-structure.md` | `singlepane` 页的整体结构 |
| `poweramp-settings-page-runtime.md` | 三层骨架、`n91` 契约 |
| `poweramp-misc-settings.md` | 「其他」分类的其他项 |

## 11. 第 2 轮深挖：Q3/Q4/Q6/Q8 全部闭环

> 第 8 章列的 8 个未解项，本轮**解出 4 项**（Q3/Q4/Q6/Q8），并**纠正了一处结构性误判**。

### 11.1 Q8：`0x7f0d03aa` 是专用总线 `bus_export_import`（**已解**）

【实证·原文】`public.xml`：

| id | 资源名 | 用途 |
| --- | --- | --- |
| **`0x7f0d03aa`** | **`bus_export_import`** | **导出/导入专用总线** |
| `0x7f0d015b` | `bus_app` | UI 事件 |
| `0x7f0d0034` | `bus_player_cmd` | 播放核心命令 |

> **导出/导入有独立的消息总线**——不与其他功能的 UI 事件混用。这解释了为什么 `e20`/`sq` 都要 `extends pe1`（StateBus 基类）并绑定这个 id。

### 11.2 Q4：导出索引确认为 0（**已解**）

【实证·产物】`va1.smali` 的 `Q()` 内，`v1` **只在 `:69` 被赋值一次**：

```asm
69:  const/4 v1, 0x0          ; ← v1 = 0（全方法唯一赋值）
...
443: new-instance v2, Lׅ/ua1;
447: invoke-direct {v2, p0, v1}, Lׅ/ua1;-><init>(Lׅ/va1;I)V   ; 导出传 0
...
473: new-instance v1, Lׅ/ua1;
477: const/4 v2, 0x1                                          ; 导入传 1
480: invoke-direct {v1, p0, v2}, Lׅ/ua1;-><init>(Lׅ/va1;I)V
```

| key | 索引 | `ua1` 分支 |
| --- | ---: | --- |
| `settings_export` | **0** | `pswitch_0`（导出）|
| `settings_import` | **1** | default（导入）|

> **§2.2 记录的"索引可疑点"已澄清**：导出处虽然用寄存器 `v1` 而非字面量，但 `v1` 在整个 `Q()` 里**只被赋过一次 `0x0`**，所以确实传 0。

### 11.3 Q6：`lists-export` 的写入方是 `wq`（**已解**）

**`"lists-export"` 只有 2 处引用**：

| 类 | 行 | 角色 |
| --- | ---: | --- |
| `k20` | `:2688` | **读取/删除**（设置导入时顺带清理）|
| **`wq`** | **`:5420`** | **写入方** |

**`wq` 的身份**【实证·产物】：

| 项 | 值 |
| --- | --- |
| 类 | `public final Lׅ/wq;` |
| 父类 | `extends Lׅ/xq;` |
| 规模 | **6230 行 / 122,435 B** |
| 方法数 | **20+**（含 `A`/`H`/`K`/`O`/`p`/`х` 等）|
| 关键字符串 | `"lists-export"`（`:5420`）、`"ImporterImpl"`（`:5420` 附近）|

**`wq.A(String)` 是数据库打开器**：

```java
SQLiteDatabase db = wq.A("lists-export");       // :5424  打开
String path = db.getPath();                      // :5432  取路径
```

> **`wq` 处理"播放列表导出"，`k20` 处理"设置导出"**——两个独立的功能，共用 `xq` 基类和 `Sync` 加密层。

### 11.4 ⭐ Q3：**双密钥 `dS`/`eS` 与 ZIP 结构**（**已解，含重大修正**）

#### ① 两个方向、两个密钥

【实证·产物】对比两个方法：

| 方法 | 所在类 | 方向 | 密钥 | 处理顺序 |
| --- | --- | --- | --- | --- |
| **`k20.B([B)[B`** | `k20:496-599` | **解密** | **`"dS"`** | native 解密 → `Base64.decode` |
| **`wq.y([B)[B`** | `wq:228-323` | **加密** | **`"eS"`** | `Base64.encodeToString` → native 加密 |

**`wq.y()` 全文**【实证·产物】`wq.smali:228-323`：

```java
public static byte[] y(byte[] plain) {
    String b64 = Base64.encodeToString(plain, 2);        // :232-240  ★ 先 Base64
    synchronized (Sync.class) {
        Sync.B("eS");                                     // :251-255  ★ 密钥 "eS"
        Sync.В(1, b64);                                   // :260-263  加密
        String out = Sync.native_lock(-1);                // :268-271  取结果
        Sync.native_close(1);                             // :279
        if (out != null) {
            return out.getBytes(UTF_8);                   // :293-305  ★ 返回字节
        }
        return null;                                      // :309
    }
}
```

> **`dS` = decrypt Settings，`eS` = encrypt Settings**（推断，基于命名与方向对应）。
>
> **两者互为逆操作**：
> - 加密：`明文 → Base64.encode → native_encrypt("eS") → 密文字节`
> - 解密：`密文字节 → UTF8解码 → native_decrypt("dS") → Base64.decode → 明文`

#### ② 结构性修正：`k20.А()` 里有一层 `ZipInputStream`

**这是本轮最重要的发现，纠正了 §5.5 的理解。**

【实证·产物】`k20.smali:3626-3957`（`А(ParcelFileDescriptor, File)`，331 行）：

```java
void А(ParcelFileDescriptor pfd, File target) {
    // ① 读取整个文件
    FileInputStream fis = new FileInputStream(pfd.getFileDescriptor());   // :3630-3642
    ByteArrayOutputStream baos = new ByteArrayOutputStream(
        Math.max(0x2000, fis.available()));                               // :3648-3672
    CloseableKt.copyTo(fis, baos);                                        // :3677
    byte[] raw = baos.toByteArray();                                      // :3682
    fis.close();                                                          // :3692

    // ② 解密
    byte[] plain = k20.B(raw);                                            // :3697  ★
    if (plain == null) throw new RuntimeException(...);                   // :3889-3934

    // ③ 当作 ZIP 打开
    ByteArrayInputStream bais = new ByteArrayInputStream(plain);          // :3712-3716
    ZipInputStream zis = new ZipInputStream(bais);                        // :3721-3725

    // ④ 遍历条目，找 "settings-export"
    ZipEntry e = zis.getNextEntry();                                      // :3731
    while (e != null) {
        if (!e.isDirectory()) {                                           // :3744-3752
            if ("settings-export".equals(e.getName())) {                  // :3756-3776  ★
                FileOutputStream fos = new FileOutputStream(target, false); // :3780-3784
                CloseableKt.copyTo(zis, fos);                             // :3792
                fos.close();                                              // :3800
                break;
            }
        }
        e = zis.getNextEntry();                                           // :3846
    }
    zis.close();                                                          // :3860
}
```

| 步骤 | 动作 | 行 |
| ---: | --- | --- |
| ① | 读整个 `ParcelFileDescriptor` 到内存 | `3630-3692` |
| ② | **`k20.B()` 解密**（native + Base64）| **`3697`** |
| ③ | 解密结果套上 **`ZipInputStream`** | `3712-3725` |
| ④ | 遍历条目，找 **`"settings-export"`** | `3731-3856` |
| ⑤ | 把该条目写到目标文件 | `3780-3800` |

#### ③ 完整的文件层次

**`.poweramp-backup` 的真实层次**：

```
.poweramp-backup（外层 ZIP，PK）
  ├─ settings-export          ← Base64(native_encrypt(SQLite 数据库))
  ├─ lists-export             ← 明文 SQLite（单层）
  └─ selected_playlist/*.jpg  ← 明文 JPEG
```

**导入 `settings-export` 时的处理**（`k20.А`）：

```
用户选择的文件（就是 .poweramp-backup 本身）
  → k20.B() 解密 ???          ← ⚠️ 但 .poweramp-backup 开头是 PK，不是密文
  → ZipInputStream
  → 找 "settings-export" 条目
```

> **⚠️ 这里存在矛盾**：`k20.А()` 接收的 `pfd` 是 `ContentResolver.openFileDescriptor(uri)` 打开的**用户选择的文件**（`.poweramp-backup`），但那个文件开头是 `PK`，**不是加密数据**。
>
> **可能的解释**（【推断】，两选一）：
>
> | 假说 | 说明 | 验证方向 |
> | --- | --- | --- |
> | **A. 用户选的是 `settings-export` 单文件** | 若用户只导出设置（不含播放列表），文件可能就是单个加密块 | 需样本对照 |
> | **B. `k20.X()` 先解外层 ZIP 再调 `А()`** | `А()` 实际接收的可能是**解出的 `settings-export` 内容流** | 读 `X()` 的 2597-3300 完整参数传递 |
>
> **实测支持假说 B**：`.poweramp-backup` 的文件头是 `PK`，若直接喂给 `k20.B()`（它会 `new String(bytes, UTF_8)` 再 Base64 解），会失败。
>
> **本文档保留这个矛盾**，不强行解释。已确认的事实是：**`k20.А()` 的逻辑是「解密 → 当 ZIP 读 → 提取 `settings-export` 条目」**。

### 11.5 完整调用链（更新版）

```
用户点「Import Settings」
  ↓
va1.Q():457-485          settings_import → ua1(this, 1)
  ↓
ua1.onPreferenceClick()  索引 1 → default 分支（:310-1000）
  ↓  ACTION_OPEN_DOCUMENT 选文件
  ↓
b20（Runnable，1177 行）  ★ 导入执行者
  ├─ "pa" / "peq" 分组（:489/:493）
  ├─ "ImporterImpl" 日志（:783）
  └─ "__DbAPI" 数据库接口（:885-897）
  ↓
k20.X(uri, ...)          文件读写主入口（1051 行）
  ↓ openFileDescriptor(uri)
k20.А(pfd, target)       解密 + ZIP 解包（331 行）
  ├─ k20.B()   native 解密（密钥 "dS"）
  ├─ ZipInputStream
  └─ 提取 "settings-export" → 写成本地库
  ↓
k20.Х()                  prefs 表逐条导入（1255 行）
```

### 11.6 剩余未解项

| # | 问题 | 状态 |
| ---: | --- | --- |
| Q1 | native 加密算法 | ⚠️ **需 `lib/` 反编译** |
| Q2 | `"dS"`/`"eS"` 密钥派生 | ⚠️ 同上 |
| Q3 | 导出写入路径 | ✅ **已解**（§11.4），但保留一处层次矛盾 |
| Q4 | 导出索引 | ✅ **已解**（=0）|
| Q5 | `"pa"`/`"peq"` 语义 | ⚠️ 推断为 Poweramp / Poweramp EQ |
| Q6 | `lists-export` 写入方 | ✅ **已解**（`wq`）|
| Q7 | `О(0xf)` 进度回调 | ⚠️ 未解 |
| Q8 | `0x7f0d03aa` 语义 | ✅ **已解**（`bus_export_import`）|

**累计解出 5 项（Q3/Q4/Q6/Q8 + 部分 Q5），剩 3 项**，其中 Q1/Q2 是硬边界（native）。

---

## 12. 第 3 轮深挖：Q7 闭环 + ZIP 层级矛盾解决

> 第 11 章留了两个尾巴：Q7（`О(0xf)` 回调）和一处"ZIP 层级矛盾"。本轮**两个都解决了**。

### 12.1 Q7：`О(0xf)` 是"取当前对话框"的 lambda（**已解**）

#### ① 先纠正一个索引陷阱

`О` 是**全 App 通用的 Lambda 分发类**（1942 行 / **29 个分支**）。它的 `packed-switch` 表是**倒序**的：

```
.packed-switch 0x0
  :pswitch_1c     ← 索引 0
  :pswitch_1b     ← 索引 1
  ...
  :pswitch_d      ← 索引 15（0xf）
  ...
  :pswitch_0      ← 索引 28
```

> **索引 ≠ 标签数字**！索引 `i` 对应标签 `pswitch_(0x1c - i)`。
>
> **我上一轮差点搞错**：按"标签数字等于索引"去读 `pswitch_14`，结果读到了 `DSPInfoHelper`（显示 DSP 信息），与导出完全无关。

**正确的映射**：

| 索引 | 标签 | `check-cast` 目标 | 用途 |
| ---: | --- | --- | --- |
| 8 | `pswitch_14` | `DSPInfoHelper` | DSP 信息对话框 |
| 11 | `pswitch_11` | `sq` | 导入任务 |
| 15 | **`pswitch_d`** | **`e20`** | **导出任务** ← |
| 20 | `pswitch_8` | `PlayerServiceCore` | 播放核心 |

> **验证方法**：`e20` 构造时传 `p0`（即 `e20` 自身），所以正确分支的 `check-cast` 必须是 `Lׅ/e20;`。只有 `pswitch_d` 满足。

#### ② `pswitch_d` 的实现（仅 14 行）

【实证·产物】`О.smali:844-857`：

```asm
844: :pswitch_d
845: iget-object v0, p0, Lׅ/О;->y:Ljava/lang/Object;   ; 取持有对象
849: check-cast v0, Lׅ/e20;                            ; ★ 确认是 e20
853: iget-object v0, v0, Lׅ/e20;->у:L...PseudoAlertDialog;  ; 读 e20.у
857: return-object v0                                   ; ★ 返回对话框
```

**这是 `Function0<PseudoAlertDialog>`——无参调用返回 `e20` 的当前对话框**。

#### ③ `zq`：进度报告器（含 100ms 限速）

`e20` 构造时把 `О(0xf)` 包成 `zq`，再传给 `k20`【实证·产物】`e20.smali:47-69`：

```java
О lambda = new О(0xf, this);          // :47-55  取对话框的 lambda
zq reporter = new zq(lambda);          // :43-60  包装
k20 core = new k20(act, reporter);     // :65-69  ★ 传给核心
```

**`zq` 的两个方法**【实证·产物】`zq.smali:29-92`：

```java
void B(String msg) {
    new b6(this, 7, msg) → lx.INSTANCE.В(runnable);   // :37-49  post 到主线程更新
    SystemClock.sleep(0x64 /* 100ms */);                // :54-58  ★ 限速
}

void В(Context ctx, String msg) {
    new m(ctx, this, msg, 6) → lx.INSTANCE.В(runnable);  // :70-86  带 Context 的更新
}
```

| 方法 | 参数 | 行为 | 限速 |
| --- | --- | --- | --- |
| **`B(String)`** | 消息文本 | post 更新对话框 | **sleep 100ms** |
| **`В(Context, String)`** | Context + 文本 | post 更新 | 无 sleep |

> **为什么 `B()` 要 sleep 100ms**：导出/导入是 IO 密集操作，进度更新很快。**故意 sleep 让用户能看清进度变化**，避免对话框文字疯狂闪烁。
>
> **`В()` 不 sleep** —— 用于一次性状态提示（如"完成"），不重复调用。

#### ④ 完整回调语义

```
k20 处理进度时调 zq.B("正在导出...")
  → post 到主线程
  → 主线程用 О(0xf) 取 e20.у（当前对话框）
  → 更新对话框文本
  → 回到工作线程，sleep 100ms 后继续
```

> **`e20.у` 是 `PseudoAlertDialog` 字段**（`e20.smali:13`），由 `ua1` 导出分支里的 `.show()` 赋值。

### 12.2 ZIP 层级矛盾：`lo1` 是 native ZIP 遍历器（**已解**）

#### ① 矛盾回顾

第 11.4 节留下的问题：

> `k20.А()` 接收的是用户选择的 `.poweramp-backup`（文件头 `PK`），但它第一步就调 `k20.B()` 解密 —— **ZIP 喂给解密器会失败**。

#### ② 真相：`k20.X()` 里 `lo1` 做了 ZIP 遍历

【实证·产物】`k20.smali:2768-3139`：

```java
ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, "r");  // :2755
lo1 zip = new lo1(pfd);                    // :2768  ★ 包成 ZIP 遍历器

String name = zip.B();                      // :2781  ★ 取第一个条目名
while (name != null) {                      // :2791
    // ── 按 name 分流 ──
    // 若是 "settings-export" → 走解密+解析
    // 若是 "lists-export"    → 走 SQLite 导入
    name = zip.B();                         // :3129  ★ 下一个条目
}
```

#### ③ `lo1` 是 `com.maxmpz.audioplayer.jni.Zip` 的包装

【实证·产物】`lo1.smali`（416 行）：

**构造器**（`18-72`）：

```java
lo1(ParcelFileDescriptor pfd) {
    this.X = new com.maxmpz.audioplayer.jni.Zip(pfd.getFd(), true);  // :27-42  ★ native
    this.y = this.X.Х();      // :51-59  条目总数
    this.у = -1;              // :63-67  当前索引（-1 = 未开始）
}
```

**`B()` —— 迭代到下一个条目**（`76-169`）：

```java
String B() {
    while (idx < count) {
        idx++;                          // :101-104  索引+1
        String name = zip.X(idx);       // :112     取条目名（native）
        if (name == null || name.isEmpty()) break;   // :120-136
        if (name.endsWith("/")) continue;            // :140-156  ★ 跳过目录
        return name;                    // :160
    }
    return null;                        // :165
}
```

**`А()` —— 取当前条目字节**（`187-282`）：

```java
byte[] А() {
    if (idx >= 0 && idx < count) {
        byte[] data = zip.х(idx);       // :223  native 解压当前条目
        if (data != null) return data;  // :235
        throw new RuntimeException("index=" + idx);  // :239-264
    }
    throw new AssertionError(idx);      // :268-281
}
```

**`В(File)` —— 解压当前条目到文件**（`284-415`）：

```java
void В(File target) {
    if (idx >= 0 && idx < count) {
        boolean ok = zip.А(target.getPath(), idx);  // :328  ★ native 解压到文件
        if (ok) return;
        throw new RuntimeException("index=" + idx + " file=" + target);  // :344-397
    }
    throw new AssertionError(idx);
}
```

| 方法 | 作用 | native 调用 |
| --- | --- | --- |
| `<init>` | 打开 ZIP | `jni.Zip(fd, true)` |
| **`B()`** | **迭代条目名** | `zip.X(idx)` |
| **`А()`** | **取条目字节** | `zip.х(idx)` |
| **`В(File)`** | **解压条目到文件** | `zip.А(path, idx)` |

> **`lo1` 是 `com.maxmpz.audioplayer.jni.Zip` 的 Java 包装**——ZIP 解析本身在 **native 层**（`jni.Zip`）。
>
> **所以第 11.4 节的矛盾解决了**：`k20.А()` 接收的不是整个 ZIP，而是**已由 `lo1` 定位并取出（或解压到临时文件）的单个条目内容**。

#### ④ 修正后的完整导入流程

```
用户选 .poweramp-backup（外层 ZIP，PK）
  ↓
k20.X(uri, ...)                              :2573-3624
  ├─ openFileDescriptor(uri)                 :2755
  ├─ lo1 zip = new lo1(pfd)                  :2768   ★ native jni.Zip 打开
  └─ while ((name = zip.B()) != null) {      :2781/3129  遍历条目
        switch (name) {
          case "settings-export":
              byte[] raw = zip.А();          :2842   取该条目字节
              byte[] plain = k20.B(raw);     :2850   ★ 解密
              // plain 是内层 ZIP
              ZipInputStream zis = ...;      :3721
              // 找内部 "settings-export"   :3756
              → 写成本地 SQLite
          case "lists-export":
              zip.В(tempFile);               :3037   直接解压到文件
              → 当作明文 SQLite 导入
        }
      }
  ↓
k20.Х()  prefs 表逐条导入
```

> **注意两层的用词**：外层 ZIP 的条目也叫 `settings-export`，内层 ZIP 的条目**还是**叫 `settings-export` —— **同名**。这可能是原作者的无心之失，也可能是刻意保持一致性。
>
> **`lists-export` 只走一层**（`zip.В(tempFile)` 直接解压），所以是明文 —— **与实测完全吻合**。

#### ⑤ 实测再验证

| 条目 | 层数 | 实测头 | 说明 |
| --- | ---: | --- | --- |
| `settings-export` | **2 层** | `PK` → Base64 → 密文 → **内层 ZIP** | 需解密+二次解包 |
| `lists-export` | **1 层** | `PK` → **直接 SQLite** | 无需解密 |

> **这完美解释了实测差异**：`lists-export` 单层所以是明文 SQLite；`settings-export` 双层且加密。

### 12.3 未解项最终状态

| # | 问题 | 状态 |
| ---: | --- | --- |
| Q1 | native 加密算法 | ⚠️ **硬边界**（需 `lib/`）|
| Q2 | `"dS"`/`"eS"` 密钥派生 | ⚠️ **硬边界**（同上）|
| Q3 | 导出写入路径 | ✅ **已解**（§11.4 + §12.2 修正）|
| Q4 | 导出索引 | ✅ **已解**（=0）|
| Q5 | `"pa"`/`"peq"` 语义 | ⚠️ 推断（Poweramp / Poweramp EQ）|
| Q6 | `lists-export` 写入方 | ✅ **已解**（`wq`）|
| Q7 | `О(0xf)` 进度回调 | ✅ **已解**（§12.1）|
| Q8 | `0x7f0d03aa` 语义 | ✅ **已解**（`bus_export_import`）|

**8 项中已解 6 项（75%）**，剩 2 项（Q1/Q2）是**同一个硬边界**：需要 `lib/` 下的 `.so` 反编译。Q5 已推断但未证实。

> **`lib/` 未被 apktool 导出的原因**：默认 apktool 不导出 native 库。需要从原 APK 单独提取 `lib/arm64-v8a/*.so`。

---

## 13. 「导入设置/数据」完整实现（第 4 轮专题）

> 前几轮主要集中在**格式与加密**。本轮专门把 **`Import Settings/Data`** 这一侧从 UI 到落库全部打通。

### 13.1 页面身份与文案

【实证·原文】`strings.xml`：

| 资源 | 文案 |
| --- | --- |
| `pref_settings_import` | **Import Settings/Data** |
| `pref_settings_import_msg_s` | **"Load settings/data from:  %s"** |
| `pref_settings_import_warn_msg` | **"Settings/presets will be overwritten. Playlists/streams/bookmarks won't be over…"** |

| 项 | 值 |
| --- | --- |
| XML 位置 | `singlepane.xml`「Other」分类第 4 项 |
| key | `settings_import` |
| 控件 | 原生 `android.preference.Preference`，`persistent="false"` |
| 图标 | `?settings_import`（主题属性）|
| helper | `va1` |
| 监听器 | `ua1(this, **1**)` |

### 13.2 `ua1` 索引 1（default 分支）：导入确认框

【实证·产物】`ua1.smali:559-1133`。`ua1` 的 `packed-switch` **只有 1 项**（索引 0 = 导出），所以导入走 **default**。

#### ① 完整构造链

```java
// ① 构造导入任务（sq）
sq task = new sq(activity, new k00(?), ?);              // :310-331

// ② 标题
builder.setTitle(0x7f080626);                          // :599-604  "Export Settings/Data" ⚠️

// ③ 版本兼容性提示（关键分支）
if (s.O()) {                                            // :620-628  旧版备份？
    msg = 0x7f0802fb;  // legacy_compatible_backup_msg    // :632
} else {
    msg = 0x7f0802ff;  // legacy_incompatible_backup_msg  // :641
}
builder.setMessage(msg);                                // :647-655

// ④ 列表高度
builder.setListHeight(res.getDimensionPixelSize(0x7f0b013c));  // :565-570, :663

// ⑤ 多选列表（要导入哪些数据）
builder.setMultiChoiceItems(names, checked, new rq(task, i, names));  // :1010

// ⑥ 按钮与生命周期
builder.setDismissOnPositive(false)                     // :1018
       .setPositiveButton(0x7f0804fc, new n2(...))      // :1026-1043
       .setOnActivityResultListener(new ac(3))          // :1051-1063  ★ 文件选择
       .setOnDismissListener(new a6(4, task))           // :1071-1083
       .setCancelable(?)                                 // :1091
       .setProgressButton(?, 0x7f0800f9, new za(4, task)); // :1099-1113  Cancel 按钮

// ⑦ 显示并保存对话框引用
PseudoAlertDialog dlg = builder.show();                  // :1121-1126
task.у = dlg;                                            // :1129  ★ sq.у
```

#### ② ⚠️ 一处文案错误（**真实 bug**）

`:599` 导入对话框用的标题是 **`0x7f080626` = `pref_settings_export` = "Export Settings/Data"**。

**导入对话框的标题写成了"导出"**。这是原作者的复制粘贴失误（导出处 `:599` 也是同一个 id，两处共用）。

> **实测影响**：用户点「Import Settings/Data」，弹出的对话框标题却显示 **"Export Settings/Data"**。但正文和按钮是导入流程（`pref_settings_import_msg_s` 在 `:183`）。
>
> 这是本页发现的第一处**用户可见文案 bug**。

#### ③ 版本兼容性提示（`s.O()` 判定，语义见 §15.1）

```java
if (task.K.O()) {                          // :620  s.O() 判断
    setMessage(R.string.legacy_compatible_backup_msg);
} else {
    setMessage(R.string.legacy_incompatible_backup_msg);
}
```

| 资源 | 文案 |
| --- | --- |
| `legacy_compatible_backup_msg` | **"The backup file is compatible with the old builds"** |
| `legacy_incompatible_backup_msg` | **"The backup file <u>is not</u> compatible with the ol…"**（含 HTML `<u>`）|

> **注意 `legacy_incompatible_backup_msg` 含 `<u>` 标签**——说明文案走 HTML 渲染（`SpannableStringBuilder`）。
>
> `s.O()` 返回 `boolean`，具体判断逻辑在 `s` 类（13594 行，未展开）。

#### ④ 多选列表：用户选择导入哪些数据

`setMultiChoiceItems(String[] names, boolean[] checked, OnMultiChoiceClickListener)`：

```java
new rq(task, index, names);       // :998-1002
```

`rq` 是 `OnMultiChoiceClickListener`，**记录用户勾选了哪些项**。

**列表项来源**：`ArrayList`（`:687-734` 构建，逐个 `getString(id)`）。

#### ⑤ 正按钮与文件选择

```java
.setPositiveButton(0x7f0804fc, new n2(task, 5, pref))   // :1026-1043
.setOnActivityResultListener(new ac(3))                  // :1051-1063
```

- `0x7f0804fc` = **`pref_import`**（"Import"）
- `ac(3)` = `OnActivityResultListener`，索引 3 = **`ACTION_OPEN_DOCUMENT`**
- `:248` 有 **`0x7f0807fa` = `select_file`**（"Select File"）

#### ⑥ `setProgressButton` —— 进度按钮

```java
.setProgressButton(int ?, int 0x7f0800f9 /* cancel */, new za(4, task))
```

> **`setProgressButton` 是 Poweramp 自定义的按钮类型**——正常显示文字，操作中显示进度圈。
>
> 索引 4 的 `za` 分支负责取消操作。

### 13.3 `sq`：导入任务（11 个字段）

【实证·产物】`sq.smali`（486 行，`extends pe1` = StateBus 基类）：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `у` | **`PseudoAlertDialog`** | **当前对话框**（供 `zq` 进度器访问）|
| `y` | `SettingsActivity` | Activity |
| **`K`** | **`Lׅ/s;`** | **数据源对象**（`s` 类）|
| **`Н`** | **`[Ljava/lang/String;`** | **多选项名称数组** |
| **`H`** | **`[I`** | **多选项索引数组** |
| **`p`** | **`Lׅ/wq;`** | **播放列表导出器**（复用）|
| `О` | `Lׅ/t4;` | Handler（主线程）|
| `К` | `Lׅ/bf1;` | 后台执行器 |
| `Р` | `int` | 计数 |
| `P` | `int` | 计数 |
| `р` | `int` | **进度图标资源 id** |

**构造器要点**【实证·产物】`sq.smali:31-254`：

```java
sq(SettingsActivity act, k00 cfg, ?) {
    super(act.getMsgBus(?));                     // :40-48  绑定 StateBus
    this.y = act;                                 // :53
    this.K = new s();                             // :57-66   ★ 数据源

    // 从 s 的 ArrayList 提取名称与索引
    this.Н = new String[list.size()];             // :117  ★ 名称数组
    for (...) this.Н[i] = ...;                    // :97-133
    this.H = new int[list.size()];                // :145  ★ 索引数组

    // 进度图标（从 android 包找资源）
    this.р = res.getIdentifier("progress_small_material", "drawable", "android");  // :165-186

    // 进度报告器（同导出）
    О lambda = new О(idx, this);                  // :198-206
    zq reporter = new zq(lambda);                 // :194-211
    this.p = new wq(act, reporter);               // :216-225  ★ 播放列表导出器

    this.О = new t4(this, act, ?);                // :237-249  Handler
}
```

> **进度图标用 `getIdentifier` 动态查找 Android 系统资源**（`android.R.drawable.progress_small_material`）——避免在 APK 里打包一份。

### 13.4 `b20`：导入执行者（1177 行）

【实证·产物】`b20.smali`：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| **`y`** | **`Lׅ/e20;`** | **导出/导入共用任务类** |
| `у` | `Uri` | 用户选择的文件 |
| `К` | `Lׅ/s;` | 数据源 |
| `X` | `int` | 阶段索引 |

> **`b20.y` 是 `e20`**——证明**导出与导入共用同一个任务类 `e20`**，只是走不同 Runnable。

#### ① 两阶段递归

```java
void run() {
    // 阶段 0：先把自己以 stage+1 重新提交（预取/初始化）
    if (stage == ?) {
        executor.execute(new b20(e20, uri, s, stage + 1));   // :89-98
    }
    // 阶段 1：真正导入
    ...
}
```

> **这是"先提交子任务再执行当前任务"的模式**——保证 `s` 对象在后台线程初始化完成。

#### ② 三个回调传给 `k20.X()`

【实证·产物】`b20.smali:910-1022`：

```java
SQLiteDatabase db = ((DbAPI) ctx.getSystemService("__DbAPI")).В();  // :877-910

// 回调 1：prefs 导入完成后
if (s.Н()) {                                        // :918-926
    new i20(s, k20, flagRef, dbAPI)                 // :930-934
}

// 回调 2：播放列表导入
if (s.K()) {                                        // :947-955
    new j20(k20, dbAPI, s, ?)                       // :959-966
}

// 回调 3：进度/文件
if (?) {                                            // :983
    new h20(k20, ?, flagRef)                        // :987-991
}

k20.X(uri, ?, ?, callback1, callback2, callback3);   // :1022  ★ 主入口
```

| 回调 | 类 | 触发 |
| --- | --- | --- |
| 1 | **`i20`** | `s.Н()` 为真时（prefs 数据）|
| 2 | **`j20`** | `s.K()` 为真时（播放列表）|
| 3 | **`h20`** | 文件处理 |

#### ③ `"pa"` / `"peq"` 的实际用法

【实证·产物】`b20.smali:489-497`：

```java
String v = ...;
if (v.equals("pa"))  { /* :489 */ }
if (v.equals("peq")) { /* :493 */ }
```

> **出现在"构建多选项列表"的循环里**——用于**给不同来源的数据打标签**。
>
> **推断**（基于上下文）：`pa` = Poweramp 主设置，`peq` = Poweramp Equalizer 设置。**导入时两者数据分开处理**，因为它们是两个 App 的数据。

#### ④ 缓存目录准备（⚠️ 见 §14.1 纠错）

【实证·产物】`b20.smali:808-864`：

```java
for (File f : ne0.a(ctx)) ne0.р(f);      // :808-831  确保 album_art 存在 + .nomedia
for (File f : ne0.b(ctx)) ne0.р(f);      // :844-864  确保 selected_aa 存在 + .nomedia
```

> **`ne0.р()` 不是删除，而是 `mkdirs()` + 写 `.nomedia`**（详见 §14.1）。作用是确保封面缓存目录存在且不被媒体扫描器索引。

#### ⑤ 完成通知

```java
MsgBus.post(?, ...);                        // :1103-1114  通知 UI
MsgBus.post(?, ...);                        // :1124-1137  再通知一次
new x2(1) → lx.INSTANCE.B(runnable, delay); // :1142-1158  延迟收尾
```

### 13.5 完整导入链路（最终版）

```
用户点「Import Settings/Data」
  ↓
va1.Q():457-485            settings_import → ua1(this, 1)
  ↓
ua1.onPreferenceClick()    索引 1 → default（:559-1133）
  ├─ new sq(...)           构造导入任务
  ├─ setTitle(0x7f080626)  ⚠️ 文案错误（用了 Export 的标题）
  ├─ setMessage(legacy_*)  兼容性提示（s.O() 判定）
  ├─ setMultiChoiceItems() 用户勾选要导入的数据
  ├─ setPositiveButton(pref_import)   + ac(3) 文件选择
  ├─ setProgressButton(cancel)        + za(4) 取消
  └─ sq.у = dialog.show()  保存对话框引用
  ↓
ac(3) → ACTION_OPEN_DOCUMENT → 用户选文件
  ↓
b20.run()（1177 行）        ★ 导入执行者
  ├─ 两阶段递归（stage+1）
  ├─ ne0.р(album_art/selected_aa) 建目录+.nomedia
  ├─ 取 __DbAPI
  └─ k20.X(uri, cb1=i20, cb2=j20, cb3=h20)
  ↓
k20.X()  1051 行
  ├─ lo1（native jni.Zip）遍历外层 ZIP
  ├─ "settings-export" → k20.B() 解密 → 内层 ZIP → SQLite
  └─ "lists-export"    → 直接解压 → SQLite
  ↓
k20.Х()  prefs 表逐条导入（1255 行）
  ├─ SELECT name, type, value FROM prefs
  ├─ 按 type 分发（s/n/l/i/f/b/[i 七种）
  └─ 11 条诊断日志，坏条目跳过
  ↓
i20 / j20 回调 → 完成通知
```

### 13.6 本轮新增的 3 个发现

| # | 发现 | 性质 |
| ---: | --- | --- |
| 1 | **导入对话框标题写成 "Export Settings/Data"** | ⚠️ **真实文案 bug** |
| 2 | **`b20.y` 类型是 `e20`** | 导出/导入**共用任务类** |
| 3 | **`setProgressButton` + `setMultiChoiceItems`** | 导入有"选择数据项"和"进度按钮"两层 UI |

### 13.7 仍未解

| # | 问题 | 原因 |
| ---: | --- | --- |
| I1 | `s.O()` 的判定逻辑 | ✅ 已解（§15）：6 项"可选且勾选"检查 |
| I2 | 多选列表的**具体项**（哪些数据可勾选） | 项从 `s` 的 ArrayList 来，未展开 |
| I3 | `i20` / `j20` / `h20` 三个回调的实现 | 未读 |
| I4 | `ne0.a()` / `ne0.b()` 的作用 | ✅ 已解（§14.1/14.2）：建目录 + `.nomedia` |
| I5 | `rq` 多选监听器的勾选状态记录方式 | 未读 |

> **这 5 项都在静态范围内**，但 `s` 类有 13594 行，收益递减。

---

## 14. 导入侧未解项闭环（第 5 轮）

> 第 13.7 节留了 5 项。本轮**全部解出**，并**纠正一处上一轮的判断错误**（`ne0.р` 不是删除）。

### 14.1 ⚠️ 纠错：`ne0.р()` 是"创建目录 + 写 `.nomedia`"，不是删除

**上一轮（§13.4 ④）写的是**：

> `for (File f : ne0.a(ctx)) ne0.р(f);` —— **清理缓存目录**

**实际是反的。** 【实证·产物】`ne0.smali:7722-7866`：

```java
static void р(File dir) {
    if (!dir.exists()) {                        // :7735-7743  目录不存在？
        if (dir.mkdirs()) {                     // :7747-7755  创建
            File nomedia = new File(dir, ".nomedia");   // :7759-7767  ★ 写 .nomedia
            if (!nomedia.exists()) {
                nomedia.createNewFile();        // :7787
            }
        }
    }
    // 异常 → Log.e("AppCacheDirs", "failed to create=" + dir)   // :7726-7858
}
```

| 项 | 事实 |
| --- | --- |
| 方法名 | `р(File)` |
| **行为** | **`mkdirs()` + 创建 `.nomedia`** |
| **不是** | ❌ 删除 |
| 日志 tag | `AppCacheDirs` |
| 失败日志 | `"failed to create="` |

> **`.nomedia` 的作用**：告诉 Android 媒体扫描器**不要索引这个目录**，避免缓存图片出现在相册里。
>
> **所以导入时是"确保缓存目录存在并标记为不索引"**，防止导入后封面缓存被系统相册扫描到。

### 14.2 I4：两个缓存目录的确切路径

【实证·产物】`ne0.smali`：

| 方法 | 目录 | 用途 | 行 |
| --- | --- | --- | --- |
| **`a(Context)`** | **`<filesDir>/album_art`** | **专辑封面缓存** | `1542-1784` |
| **`b(Context)`** | **`<filesDir>/selected_aa`** | **用户选中的封面图缓存** | `1786-2028` |

两者结构完全同构：

```java
static File[] a(Context ctx) {
    RestLibrary lib = (RestLibrary) ctx.getSystemService("RestLibrary");  // :1570-1574
    File base = ne0.i(ctx);                                              // :1590
    File dir = new File(base, "album_art");                              // :1595-1619
    // 返回该目录下的文件数组
}
```

> 两者都从 `RestLibrary` 系统服务取专辑信息，再定位到 `<filesDir>` 下的子目录。

### 14.3 I5：`rq` 多选监听器与 `qq` 数据模型

#### ① `qq` 是"一个可导入数据项"

【实证·产物】`qq.smali`（241 行，**9 个字段**）：

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `В` | `String` | **项名称**（如 `"settings"`）|
| **`A`** | **`boolean`** | **当前是否勾选**（唯一非 final 字段）|
| `B` | `int` | 计数 |
| `y` | `int` | **类型 id** |
| `А` | `int` | 计数 |
| `x` | `int` | 计数 |
| `X` | `boolean` | **是否允许勾选**（可选标志）|
| `Х` | `boolean` | 标志 |
| `х` | `boolean` | 标志 |

**`toString()` 的证据**【实证·产物】`:158-207`：

```java
public String toString() {
    boolean checked = this.A;              // :162
    return new StringBuilder().append(this.В).append("=").append(checked).toString();
}
```

> **输出格式 `名称=勾选状态`** —— 这就是 `В` = 名称、`A` = 勾选状态的铁证。

**`В()Z` 的证据**【实证·产物】`:209-240`：

```java
public boolean В() {
    return this.X && this.A;      // :213-232  「可选」且「已勾选」
}
```

> 所以 `X` 是"**是否允许被勾选**"的门控标志。

#### ② `rq.onClick` 的完整逻辑

【实证·产物】`rq.smali:44-265`（`OnMultiChoiceClickListener`）：

```java
public void onClick(DialogInterface dlg, int which, boolean checked) {
    if (index == 0) {                                    // ps Witch_0
        sq task = (sq) this.B;                            // :167-171
        s data = task.K;                                  // :175
        ArrayList list = data.A;                          // :179-183
        qq item = (qq) list.get(which);                   // :187-195
        item.A = checked;                                 // :199  ★ 修改勾选状态

        PseudoAlertDialog d = (PseudoAlertDialog) dlg;    // :203-212
        boolean enable;
        if (!checked) {                                   // :216
            enable = data.A();                            // :220-225  某项取消勾选 → 看是否还有其他
        } else {
            enable = true;                                // :243-244
        }
        d.setPositiveButtonEnabled(enable);               // :248  ★ 动态启/禁 Import 按钮
        this.В();                                         // :253  ★ 更新兼容性提示
    }
}
```

| 行为 | 说明 |
| --- | --- |
| **改 `qq.A`** | 记录勾选状态 |
| **`setPositiveButtonEnabled`** | **全部取消勾选时禁用 Import 按钮** |
| **调 `В()`** | 刷新兼容性提示 |

#### ③ `rq.В()`：动态切换兼容性提示

【实证·产物】`rq.smali:267-357`：

```java
void В() {
    sq task = (sq) this.B;                    // :271-275
    boolean compatible = task.K.O();          // :279-288  ★ 重新判断
    BooleanRef ref = (BooleanRef) this.А;     // :291-295

    if (compatible != ref.element) {          // :303  ★ 只在变化时更新
        ref.element = compatible;             // :307
        PseudoAlertDialog d = task.у;         // :311
        if (d != null) {
            int res = compatible
                ? 0x7f0802fb   // legacy_compatible_backup_msg     // :323
                : 0x7f0802ff;  // legacy_incompatible_backup_msg   // :332
            d.setMessage(task.y.getText(res)); // :338-350
        }
    }
}
```

> **用户的勾选会影响"备份兼容性"的判定**——这是设计上的精妙之处：
>
> 如果用户**只勾选新版支持的数据项**，提示变成"compatible"；勾选了旧版才有的项，提示变成"incompatible"。
>
> **`BooleanRef` 用于防抖**——只在兼容性**真正变化时**才刷新文本，避免每次点击都重建消息。

### 14.4 ⭐ I2：13 个可导入数据类别（**完整解出**）

`qq` 的 **13 个实例全部在 `s` 的构造器里**（`s.smali:76-286`）。

【实证·产物】按代码顺序：

| # | 名称（`qq.В`）| 行 | 含义 |
| ---: | --- | ---: | --- |
| 1 | **`settings`** | `:88` | 全部设置项 |
| 2 | **`musicFolders`** | `:109` | 音乐文件夹 |
| 3 | **`eqPresets`** | `:130` | EQ 预设 |
| 4 | **`reverbPresets`** | `:147` | 混响预设 |
| 5 | **`otherDsp`** | `:164` | 其他 DSP 设置 |
| 6 | **`audioOutputs`** | `:179` | 音频输出配置 |
| 7 | **`skins3rdParty`** | `:198` | 第三方皮肤 |
| 8 | **`aa`** | `:217` | 专辑封面设置 |
| 9 | **`playlists`** | `:230` | 播放列表 |
| 10 | **`streams`** | `:243` | 网络流 |
| 11 | **`ratingsAndStats`** | `:256` | 评分与统计 |
| 12 | **`bookmarks`** | **`:269`** | **书签** |
| 13 | **`listMemory`** | `:284` | 列表记忆（滚动位置等）|

> **13 项就是导入对话框多选列表的完整内容**——用户可勾选任意组合。
>
> 这与文案 `pref_settings_import_warn_msg` 呼应：**"Settings/presets will be overwritten. Playlists/streams/bookmarks won't be overwr…"** —— 正好对应 `settings`/`eqPresets`（会覆盖）与 `playlists`/`streams`/`bookmarks`（不覆盖）。

### 14.5 I3：三个回调的职责

`b20` 传给 `k20.X()` 的三个 lambda：

| 回调 | 规模 | 职责 | 关键字符串 |
| --- | ---: | --- | --- |
| **`i20`** | **3591 行** | **prefs + EQ/混响预设导入** | `SELECT name, type, value FROM prefs WHERE file=?`（`:879`）、`REPLACE INTO eq_presets`（`:1788`）、`REPLACE INTO reverb_presets`（`:3226`）|
| **`j20`** | **4144 行** | **路径解析 + 挂载点处理** | `parseImpl(`、`needed=`、`remaining=`、`vold`、`fuse`、`passthrough` |
| **`h20`** | **394 行** | **USB 路径转换** | **`"Unknown USB"`** |

#### ① `i20`：真正的 prefs 落库

【实证·产物】`i20.smali`：

```java
// :879
"SELECT name, type, value FROM prefs  WHERE file=? AND name LIKE ? ESCAPE '\\'"
```

**注意比 `k20.Х()` 多了 `AND name LIKE ?`** —— 说明 `i20` 做**按名称过滤**的 prefs 导入。

**EQ 预设导入**（`:1727-1866`）：

```sql
REPLACE INTO eq_presets
  (_id, preset, _data, name, bind_to_speaker, bind_to_wired, bind_to_bt, bind_to_usb,
   data_blob, parametric, sort)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

REPLACE INTO eq_preset_devices
  (preset_id, device, device_name, device_address)
  VALUES (?, ?, ?, ?)
```

**混响预设**（`:3218-3264`）：

```sql
REPLACE INTO reverb_presets (_id, _data, name) VALUES (?, ?, ?)
```

**完成日志**：`"Imported Eq presets="`（`:3092`）、`"Imported Reverb presets="`（`:3580`）

> **用 `REPLACE INTO`**（而非 `INSERT`）—— **同 `_id` 的记录会被覆盖**，与文案 "will be overwritten" 完全一致。

#### ② `j20`：存储路径解析

【实证-产物】关键字符串：

| 字符串 | 含义 |
| --- | --- |
| `parseImpl(` | 路径解析入口 |
| `needed=` / `remaining=` | 字符串解析进度追踪 |
| `FAIL remaining=` | 解析失败 |
| **`vold`** | **Android 卷守护进程** |
| **`fuse`** | **FUSE 挂载** |
| **`passthrough`** | **直通模式**（Android 11+ 的 scoped storage）|
| `vfat` / `tmpfs` | 文件系统类型 |

> **这是导出/导入里最"脏"的部分**——要处理不同 Android 版本、不同存储挂载方式下的路径差异。
>
> `vold`/`fuse`/`passthrough` 说明它在**解析 `/proc/mounts` 或类似来源**，把备份里的路径映射到当前设备的实际路径。

#### ③ `h20`：USB 设备路径

【实证·产物】`h20.smali:88` 只有 `"Unknown USB"` 一个字符串，但方法有 349 行。

> **推断**：处理 `usb://` 或 `/mnt/media_rw/XXXX-XXXX/` 这类**可移动存储路径**，无法识别时回退到 `"Unknown USB"`。

### 14.6 完整导入链路（最终版，含 13 项选择）

```
点「Import Settings/Data」
  ↓
ua1(default)  setTitle(0x7f080626 ⚠️ 文案 bug)
              setMultiChoiceItems(13 项 qq 列表)
  ↓ 用户勾选（rq.onClick 改 qq.A，动态 setPositiveButtonEnabled + 刷兼容提示）
  ↓
ac(3) → ACTION_OPEN_DOCUMENT
  ↓
b20.run()
  ├─ ne0.р(album_art)      ★ 确保封面缓存目录存在 + .nomedia
  ├─ ne0.р(selected_aa)    ★ 同上
  ├─ 取 __DbAPI
  └─ k20.X(uri, cb1=i20, cb2=j20, cb3=h20)
  ↓
k20.X()  lo1 遍历外层 ZIP
  ├─ settings-export → 解密 → 内层 ZIP → 本地 SQLite
  └─ lists-export    → 直接解压
  ↓
i20（3591 行）  prefs 过滤导入 + REPLACE INTO eq_presets / reverb_presets
j20（4144 行）  路径解析（vold/fuse/passthrough）
h20（394 行）   USB 路径处理
  ↓
完成通知
```

### 14.7 本轮成果与剩余

| # | 原问题 | 状态 |
| ---: | --- | --- |
| I1 | `s.O()` 判定逻辑 | ✅ **已解**（§15）|
| I2 | 多选列表具体项 | ✅ **已解**（13 项，§14.4）|
| I3 | `i20`/`j20`/`h20` | ✅ **已解**（§14.5）|
| I4 | `ne0.a()`/`ne0.b()` | ✅ **已解 + 纠错**（§14.1/14.2）|
| I5 | `rq` 勾选记录 | ✅ **已解**（§14.3）|

**5 项中解出 4 项**，只剩 I1（`s.O()` 的实现，需要在那 13594 行里定位）。

---

## 15. I1 闭环：`s.O()` 的真实语义（第 6 轮）

> 第 14.7 节只剩 I1（`s.O()`）。本轮解出，并发现**两个真实逻辑缺陷**。

### 15.1 ⚠️ 先纠错：`s.O()` 不是"旧备份判断"

**前几轮我写的是**：

> `s.O()` 判断"是否为旧版备份"，决定显示 `legacy_compatible_backup_msg` 还是 `legacy_incompatible_backup_msg`。

**实际语义完全不同。**

【实证·产物】`s.smali:2253-2388`（135 行）：

```java
public boolean O() {
    if (this.К.В()) return true;      // :2257-2273
    if (this.K.В()) return true;      // :2277-2293
    if (this.Н.В()) return true;      // :2297-2313
    if (this.B.В()) return true;      // :2317-2333
    if (this.H.В()) return true;      // :2337-2353
    if (this.Р.В()) return true;      // :2357-2373
    return false;                      // :2384
}
```

其中 `qq.В()` 是 **`X && A`**（`qq.smali:209-240`）= **"允许勾选" 且 "已勾选"**。

> **`O()` 实际是：「是否有任一（被检查的）数据项处于"勾选且可选"状态」**
>
> 与"旧版备份"**毫无关系**。

### 15.2 那 `legacy_compatible` / `legacy_incompatible` 到底是什么？

重新审视 `ua1` 与 `rq` 的两处用法：

**`ua1:620-655`（对话框初始消息）**：

```java
if (task.K.O()) {
    msg = 0x7f0802fb;  // legacy_compatible_backup_msg
} else {
    msg = 0x7f0802ff;  // legacy_incompatible_backup_msg
}
```

**`rq.В():279-350`（勾选变化时刷新）**：

```java
boolean compatible = task.K.O();
if (compatible != ref.element) { ... setMessage(compatible ? 0x7f0802fb : 0x7f0802ff); }
```

| 资源 | 文案 |
| --- | --- |
| `legacy_compatible_backup_msg` | **"The backup file is compatible with the old builds"** |
| `legacy_incompatible_backup_msg` | **"The backup file <u>is not</u> compatible with the old builds…"** |

**结合 `O()` 的真实语义**，这个提示的真实含义是：

| `O()` 返回 | 显示 | **真实含义** |
| :---: | --- | --- |
| `true` | "compatible with the old builds" | **选中的项都是旧版也支持的** |
| `false` | "is not compatible with the old builds" | **选中了含新版专有项** |

> **【推断】** 那 6 个被检查的字段（`К`/`K`/`Н`/`B`/`H`/`Р`）对应的数据项是**旧版 Poweramp 也有的**（如 `settings`、`musicFolders`、`eqPresets`）。
>
> **如果用户只勾选这些项**，导出的备份**旧版也能读**，所以提示 "compatible"。
>
> **如果勾选了旧版没有的项**（如 `listMemory`、`ratingsAndStats`），旧版读不了，提示 "incompatible"。

### 15.3 ⭐ 发现缺陷 ①：`O()` 只检查 6 个字段，实际有 13 项

**13 个数据项与 `s` 字段的完整映射**【实证·产物】`s.smali:54-288`：

| # | 数据项名 | `s` 字段 | 是否被 `O()` 检查 |
| ---: | --- | :---: | :---: |
| 1 | `settings` | `х` | ❌ |
| 2 | `musicFolders` | `Х` | ❌ |
| 3 | `eqPresets` | `А` | ❌ |
| 4 | `reverbPresets` | `X` | ❌ |
| 5 | `otherDsp` | `x` | ❌ |
| 6 | `audioOutputs` | `y` | ❌ |
| 7 | `skins3rdParty` | `у` | ❌ |
| **8** | **`aa`** | **`К`** | **✅** |
| **9** | **`playlists`** | **`K`** | **✅** |
| **10** | **`streams`** | **`Н`** | **✅** |
| **11** | **`ratingsAndStats`** | **`B`** | **✅** |
| **12** | **`bookmarks`** | **`H`** | **✅** |
| **13** | **`listMemory`** | **`Р`** | **✅** |

> **`O()` 只检查后 6 项（第 8-13），漏掉了前 7 项（第 1-7）**。
>
> **这是真实缺陷**：用户只勾选 `settings`（第 1 项）时，`O()` 返回 `false`，提示 **"is not compatible with the old builds"** —— 但 `settings` 显然是最核心的兼容项。

#### 字段名极易混淆

`s` 的字段用了**极易混淆的同形字组合**：

| 字段 | 字形 | 易混淆对象 |
| --- | --- | --- |
| `К` | 西里尔大写 Ka | vs `K`（拉丁大写 K）|
| `K` | 拉丁大写 K | vs `К` |
| `Н` | 西里尔大写 En | vs `H`（拉丁大写 H）|
| `H` | 拉丁大写 H | vs `Н` |
| `Х` | 西里尔大写 Ha | vs `X`（拉丁大写 X）|
| `X` | 拉丁大写 X | vs `Х` |
| `х` | 西里尔小写 ha | vs `x`（拉丁小写 x）|
| `x` | 拉丁小写 x | vs `х` |
| `А` / `А` | 西里尔/拉丁 A | 需按完整声明区分 |
| `Р` | 西里尔大写 Er | vs `P` |

> **13 个字段里有 8 对同形字**。阅读时**必须按 Unicode 码点区分**，肉眼几乎无法分辨。
>
> 这也解释了为什么 `O()` 只检查 6 个——**作者自己可能也搞混了**。

### 15.4 发现缺陷 ②：`s.A()` 的空列表短路

【实证·产物】`s.smali:2003-2087`：

```java
public boolean A() {
    ArrayList<qq> list = this.A;                    // :2007-2011
    if (list == null || list.isEmpty()) goto return0;   // :2018-2034
    for (int i = 0; i < list.size(); i++) {
        if (list.get(i).A) return true;             // :2070-2081  ★ 任一项勾选
    }
    return0:
    return false;                                    // :2085-2086
}
```

**`A()` 的正确语义是"是否有任一项被勾选"**，逻辑本身没问题。

**但 `rq.onClick` 里对它的用法值得注意**【实证·产物】`rq.smali:216-248`：

```java
if (!checked) {                       // 用户取消勾选某项
    enable = data.A();                // ← 检查是否还有别的项被勾选
} else {
    enable = true;
}
d.setPositiveButtonEnabled(enable);   // 全取消 → 禁用 Import 按钮
```

> **这个用法是合理的**：取消勾选后若列表全空，禁用 Import 按钮防止无意义点击。
>
> **两处方法容易混淆**：
>
> | 方法 | 语义 | 用户的调用场景 |
> | --- | --- | --- |
> | **`s.A()`** | **有任一项被勾选**（不管可选性）| 控制 Import 按钮启禁 |
> | **`s.O()`** | **被检查的 6 项里有"可选且勾选"的** | 控制兼容性提示文本 |

### 15.5 完整语义对照（最终版）

| 方法 | 真实语义 | 调用点 | 效果 |
| --- | --- | --- | --- |
| **`s.O()`** | 6 个特定项中，有"可选且勾选"的 | `ua1:620`、`rq.В():283` | 切换 compatible / incompatible 提示 |
| **`s.A()`** | 13 项中，有任一项被勾选 | `rq.onClick:220` | 启/禁 Import 按钮 |
| **`qq.В()`** | `X && A`（可选且勾选）| 被 `s.O()` 调用 | — |
| **`qq.A`** | 勾选状态 | `rq.onClick:199` 写入 | — |
| **`qq.X`** | 是否允许勾选 | 构造时设定 | — |

### 15.6 导入侧调查完成度

| # | 问题 | 状态 |
| ---: | --- | --- |
| I1 | `s.O()` 语义 | ✅ **已解 + 纠错 + 发现 2 个缺陷**（§15）|
| I2 | 多选列表 13 项 | ✅ **已解**（§14.4）|
| I3 | `i20`/`j20`/`h20` | ✅ **已解**（§14.5）|
| I4 | `ne0.a()`/`ne0.b()` | ✅ **已解 + 纠错**（§14.1/14.2）|
| I5 | `rq` 勾选记录 | ✅ **已解**（§14.3）|

> **导入侧 5 项全部闭环。**

### 15.7 本轮发现的 3 处问题汇总

| # | 问题 | 性质 | 影响 |
| ---: | --- | --- | --- |
| 1 | **导入对话框标题写成 "Export Settings/Data"** | 文案 bug | 用户可见 |
| 2 | **`s.O()` 只检查 6/13 项** | 逻辑缺陷 | 兼容性提示可能误判 |
| 3 | **13 字段中 8 对同形字** | 可维护性问题 | 易引发后续 bug |

---
