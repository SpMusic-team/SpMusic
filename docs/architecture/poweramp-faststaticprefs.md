---
doc_id: "ARCH-POWERAMP-FASTSTATICPREFS"
title: "Poweramp 偏好存储引擎 FastStaticPrefs（mmap）完整解构"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "build-1035-bundle-play (versionCode 1035009)"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - ".rea-analysis/v1035/decoded/smali/ׅ/ls.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/a30.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/t9.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/er.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/ms.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/y40.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/vr.smali"
  - ".rea-analysis/v1035/decoded/smali/ׅ/pb1.smali"
  - "docs/architecture/poweramp-lockscreen-residual-closure.md（§1 首次触及该机制）"
  - "docs/architecture/poweramp-about-license-state-machine.md（授权字段所在体系）"
---

# Poweramp 偏好存储引擎 FastStaticPrefs（mmap）完整解构

> **本文定位**：解开 Poweramp 设置系统的**底层存储引擎**。
> 此前多份文档反复触及它（`vr` 的 98 个 `pb1` 字段、`er` 脏位、`n91.n()` 的注册表查询），
> 但从未把 `ls` / `a30` / `t9` / `er` 这条链完整讲清。**这是整个设置树的共同地基。**

## 0. 一句话结论

Poweramp **不用 `SharedPreferences` 存设置**。它自建了一个叫 **`FastStaticPrefs`** 的引擎：
把**所有偏好按注册顺序**序列化成一串 `int`，写进一个**内存映射文件（`MappedByteBuffer`）**。
读取靠**顺序游标**（`position()`），写入靠**整块刷盘**。
`SharedPreferences` 只是它外面套的一层**兼容壳**（`v2` 桥接，见 `poweramp-lockscreen-residual-closure.md` §1.3）。

**为什么这么做**：设置项有 **98 个 int 级字段**（`vr` 里 `pb1` 字段数），
`SharedPreferences` 每次 `getInt` 都要 hash 查找 + 类型检查；顺序读一整个 mmap 页是**一次内存访问**。
这是**为启动速度做的极端优化**。

---

## 1. 四层结构

```
ls        ← 存储层：File + MappedByteBuffer + position 游标
  ↑
a30       ← 值对象层：B=默认值，А=当前值，у(I)=唯一写入口
  ↑
t9        ← 基类：持有 er（脏位）
  ↑
pb1 / ec / z20 / dd / mf1 …  ← 各类型的具体偏好（boolean/int/ByteBuffer/float…）
```

| 类 | 行数 | 职责 |
| --- | ---: | --- |
| **`ׅ/ls`** | **405** | **mmap 存储后端**（日志标签 `"FastStaticPrefs"`，`ls:35`） |
| `ׅ/a30` | 224 | int 值对象（`B` 默认 / `А` 当前 / `у(I)` 写） |
| `ׅ/t9` | 36 | 值对象抽象基类（持 `В:er`） |
| `ׅ/er` | 246 | 脏位计数器（`В:I`，`А()` = `+1`） |
| `ׅ/ms` | 2834 | 命名空间/工厂（`р(I)` 建 `z20`、`Х:ArrayList` 槽位表） |

【实证·产物】`smali/ׅ/ls.smali`（405 行）、`a30.smali`（224 行）、`t9.smali`（36 行）、`er.smali`（246 行）

---

## 2. `ls` —— mmap 存储后端

### 2.1 字段与身份

```asm
; 【实证·产物】ׅ/ls.smali
 10: .field public K:[B                          ; 字节缓冲（读取用）
 12: .field public final X:Ljava/io/File;         ; ★ 底层文件
 14: .field public y:Ljava/nio/MappedByteBuffer;  ; ★★ 内存映射
 16: .field public final К:I                      ; ★ 版本号（从文件头读）
 18: .field public у:I                           ; ★★ 顺序读游标（position）
```

**日志标签**（`:35`）：`const-string v0, "FastStaticPrefs"` —— **引擎真名**。

### 2.2 文件格式（双魔数校验）

```asm
; 【实证·产物】ׅ/ls.smali:22-200  <init>(File)
 35:     const-string v0, "FastStaticPrefs"    ; 日志 tag
 44:     invoke-virtual {p0}, ls;->B()MappedByteBuffer
 56:     invoke-virtual {v2}, Buffer;->limit()I
 64:     const/16 v4, 0xc                       ; ★ 最小长度 12 字节
 68:     if-lt v3, v4, :cond_1
 72:     invoke-virtual {v2}, ByteBuffer;->getInt()I
 77:     move-result v3                         ; 读文件头第 1 个 int
 80:     const v4, -0xa10edcc                   ; ★★ 魔数 #1（0xF5EF1234）
 85:     if-ne v3, v4, :cond_1
 89:     invoke-virtual {v2}, Buffer;->limit()I
 97:     add-int/lit8 v3, v3, -0x4
101:     invoke-virtual {v2, v3}, ByteBuffer;->getInt(I)I
106:     move-result v3                         ; 读文件尾最后 1 个 int
109:     const v4, -0x1000bcdf                  ; ★★ 魔数 #2（0xEFFF4321）
114:     if-eq v3, v4, :cond_0
121: :cond_0
122:     iput-object v2, p0, Lׅ/ls;->y:MappedByteBuffer   ; ★ 校验通过才挂载
126:     invoke-virtual {v2}, ByteBuffer;->getInt()I
131:     move-result v1
134:     iput v1, p0, Lׅ/ls;->К:I                 ; ★ 读版本号
```

**文件布局**：

```
┌──────────────────────────────────────────────┐
│ offset 0        : MAGIC_HEAD = 0xF5EF1234     │  4 B
│ offset 4        : VERSION    (К)              │  4 B
│ offset 8 .. n-4 : 偏好值序列（按注册顺序的 int）│
│ offset n-4      : MAGIC_TAIL = 0xEFFF4321     │  4 B
└──────────────────────────────────────────────┘
```

| 项 | 值 | 说明 |
| --- | --- | --- |
| `MAGIC_HEAD` | **`-0xa10edcc`** = `0xF5EF1234` | 文件头校验 |
| `MAGIC_TAIL` | **`-0x1000bcdf`** = `0xEFFF4321` | 文件尾校验 |
| 最小长度 | **`0xc`（12 字节）** | 头 4 + 版本 4 + 尾 4 |
| 失败行为 | `Log.e("FastStaticPrefs", "!b file="+file)`（`:39`/`:172`） | **不抛异常**，静默降级为无 mmap |

> **双魔数的设计意图**：头尾各一个，可检测**文件截断**（只校验头的话，写到一半的文件会被误认为有效）。
> 这是典型的"写时崩溃防护"——**FastStaticPrefs 假设进程可能在任何时刻被杀**。

### 2.3 `B()` —— 建立**只读**映射（`:204-317`）

```asm
; 【实证·产物】ׅ/ls.smali:204-316
208:     new-instance v1, Ljava/io/FileInputStream;   ; ★ 只读输入流
216:     invoke-direct {v1, v0}, FileInputStream;-><init>(File)V
222:     invoke-virtual {v1}, FileInputStream;->getChannel()FileChannel;
234:     sget-object v3, Ljava/nio/channels/FileChannel$MapMode;->READ_ONLY:Ljava/nio/channels/FileChannel$MapMode;  ; ★★ 只读！
238:     invoke-virtual {v2}, FileChannel;->size()J
246:     const-wide/16 v4, 0x0
250:     invoke-virtual/range {v2 .. v7}, FileChannel;->map(MapMode;JJ)MappedByteBuffer;
258:     sget-object v2, Ljava/nio/ByteOrder;->LITTLE_ENDIAN:Ljava/nio/ByteOrder;   ; ★★ 小端
262:     invoke-virtual {v0, v2}, ByteBuffer;->order(ByteOrder;)ByteBuffer;
269:     invoke-virtual {v1}, FileInputStream;->close()V
274:     return-object v0
```

**两个决定性事实**：

| 事实 | 含义 |
| --- | --- |
| **`MapMode.READ_ONLY`**（`:234`） | **mmap 是只读的**——读路径与写路径**完全分离** |
| **`ByteOrder.LITTLE_ENDIAN`**（`:258`） | 文件是**小端**格式（Android ARM 原生序） |

> **这推翻了「mmap 既能读也能写」的直觉假设**。
> `ls` 只负责**加载快照**；写盘走 `ms.C()`（见 §7），用 `FileOutputStream`/`RandomAccessFile` 重建整个文件。
> 这是**"读快、写慢、写时整块重建"**的取舍——设置变更是低频操作，不值得为它优化。

### 2.4 `close()` —— 只释放引用，不 unmap（`:318-330`）

```asm
; 【实证·产物】ׅ/ls.smali:318-330
318: .method public final close()V
322:     const/4 v0, 0x0
325:     iput-object v0, p0, Lׅ/ls;->y:Ljava/nio/MappedByteBuffer;   ; ★ 仅置 null
329:     return-void
```

**没有显式 unmap**（Android 上 `MappedByteBuffer` 的释放依赖 GC，这是已知的 JDK 限制）。
只读映射不占修改页，所以泄漏代价可控。

### 2.5 `В(Function0, Function1)` —— 带边界检查的游标推进（`:332-405`）

```asm
; 【实证·产物】ׅ/ls.smali:332-405
336:     iget v0, p0, Lׅ/ls;->у:I
340:     add-int/lit8 v0, v0, 0x1
344:     iput v0, p0, Lׅ/ls;->у:I          ; 游标 +1
352:     if-nez v0, :cond_0                ; buffer 为 null → 走 fallback（p1）
368:     invoke-virtual {v0}, Buffer;->remaining()I
376:     const/16 v2, 0x8
380:     if-ge v1, v2, :cond_1             ; 剩余 < 8 字节 → fallback
396:     invoke-interface {p2, v0}, Function1;->invoke(Object)   ; 正常路径：读 buffer
```

**阈值 `0x8`（8 字节）**与 `a30` 构造函数里的 `limit()-8`（`:66`）**完全一致**——
都是为尾部魔数（4B）+ 余量（4B）预留。**

---

## 7. 写入路径：`ms.C()` —— 整块序列化重建（F2 闭合）

**F2（谁刷盘）已完全解开**。答案是：**不刷 mmap，而是重建整个文件。**

### 7.1 调用链

```
SharedPreferences.Editor.commit() / apply()
  ↓  u2.commit() / u2.apply()          (u2.smali:38 / :101)
  ↓  v2.В()                            (v2.smali:738-779)
  ↓  foreach w2.В(t2[]) → t2.А()Z      (v2.smali:746-774)
  ↓
ms.A()Z  (ms.smali:262-278)  →  ms.C(false,false)
ir.A()Z  (ir.smali:551-567)  →  ir.р(false)
  ↓
ms.C(ZZ)Z  (ms.smali:280-...)  ★★★ 真正的序列化写盘
```

**注意 `u2.putInt` 本身不写盘**（`u2.smali:316-412`），它只做：
```asm
324:     iget-object v0, v0, Lׅ/v2;->В:ConcurrentHashMap;   ; 查注册表
328:     invoke-virtual {v0, p1}, ConcurrentHashMap;->get(Object);
336:     check-cast v0, Lׅ/s2;
344:     instance-of v1, v0, Lׅ/r2;                          ; 必须是 r2（可写）
356:     invoke-interface {v0, p2}, Lׅ/r2;->A(I)V             ; ★ 写内存值
```

`r2` 是**可写偏好接口**（`r2.smali:10` `A(I)V`），实现类只有两个：
- **`ׅ/mr`**（`A(I)` 把值写入 `А` 并 `er.А()` 脏位+1，`mr.smali:35-53`）
- **`ׅ/rb1`**（`super a30`，`toString` 自称 **`"SharedIntPref "`**，`rb1.smali:66`）

> **`rb1` 的名字是一处重要证据**：`"SharedIntPref"` 说明这套系统的设计初衷就是
> **"SharedPreferences 的 int 实现"**——一个兼容层，而不是原创存储格式。

### 7.2 脏位检查（这是 `er` 的真正用途）

```asm
; 【实证·产物】ׅ/ms.smali:280-345
280: .method public final C(ZZ)Z
320:     iget-object v5, p0, Lׅ/ms;->А:Lׅ/er;
324:     iget v5, v5, Lׅ/er;->В:I        ; ★ 当前脏位
328:     if-nez p1, :cond_1              ; p1（force）为 false 时才检查
332:     iget p1, p0, Lׅ/ms;->A:I        ; ★ 上次保存时的脏位快照
338:     if-ne p1, v5, :cond_1          ; ★★ 脏位没变 → 不写！
342:     monitor-exit v4
345:     return v3                      ; 返回 false（无变化）
359: :cond_1
361:     iput v5, p0, Lׅ/ms;->A:I        ; 更新快照
```

**这就是 `er.В` 存在的意义**：
它不是"变更计数器"（`poweramp-lockscreen-residual-closure.md` §1.1 的表述需进一步细化），
而是**「是否需要写盘」的判据**——`er.В` 与 `ms.A`（上次写盘时的快照）比较，
**相等就整个 `C()` 提前返回**。

### 7.3 序列化协议（完整）

```asm
; 【实证·产物】ׅ/ms.smali:421-800
421:     new-instance p1, Lׅ/cg0;         ; 字节缓冲构建器
432:     const v0, -0xa10edcc             ; ★ MAGIC_HEAD
438:     invoke-virtual {p1, v0}, cg0;->A(I)V
443:     iget v0, p0, Lׅ/ms;->B:I
447:     invoke-virtual {p1, v0}, cg0;->A(I)V   ; ★ VERSION

; ── 遍历槽位表按类型分派 ──
452:     iget-object v0, p0, Lׅ/ms;->Х:ArrayList
469:     if-ge v6, v5, :cond_e
485:     check-cast v7, Lׅ/t9;
489:     instance-of v8, v7, Lׅ/a30;      ; ① int
501:     iget v7, v7, Lׅ/a30;->А:I
505:     invoke-virtual {p1, v7}, cg0;->A(I)V
536:     instance-of v8, v7, Lׅ/fc;       ; ② boolean
548:     iget-boolean v7, v7, Lׅ/fc;->А:Z
552:     invoke-virtual {p1, v7}, cg0;->A(I)V   ; 按 int 写
561:     instance-of v8, v7, Lׅ/ht;       ; ③ float
573:     iget v7, v7, Lׅ/ht;->А:F
577:     invoke-static {v7}, Float;->floatToRawIntBits(F)I   ; ★ 位转 int
585:     invoke-virtual {p1, v7}, cg0;->A(I)V
594:     instance-of v8, v7, Lׅ/v80;      ; ④ long
606:     iget-wide v7, v7, Lׅ/v80;->B:J
610:     invoke-virtual {p1, v7, v8}, cg0;->х(J)V   ; 写 8 字节
619:     instance-of v8, v7, Lׅ/nf1;      ; ⑤ String
631:     iget-object v7, v7, Lׅ/nf1;->А:Ljava/lang/String;
639:     invoke-virtual {v7}, String;->length()I
647:     if-lez v8, :cond_a               ; 空串 → 写 0
651:     sget-object v8, Lkotlin/text/Charsets;->UTF_8
655:     invoke-virtual {v7, v8}, String;->getBytes(Charset;)[B
666:     const/high16 v9, 0x100000         ; ★★ 单串上限 1 MiB
670:     if-le v8, v9, :cond_9
679:     invoke-virtual {p1, v8}, cg0;->A(I)V    ; 先写长度
688:     invoke-virtual {p1, v7, v8}, cg0;->А([BI)V ; 再写字节
706:     const/4 v7, -0x1                  ; null 串 → -1
718:     instance-of v8, v7, Lׅ/o31;      ; ⑥ 自定义序列化接口
730:     invoke-interface {v7, p1}, Lׅ/o31;->А(Lׅ/cg0;)V
739:     :cond_d  new AssertionError(v7)  ; ★ 未知类型 → 抛断言

; ── 尾部 ──
752:     const v0, -0x1000bcdf            ; ★ MAGIC_TAIL
757:     invoke-virtual {p1, v0}, cg0;->A(I)V
762:     sget-boolean v0, Lׅ/ms;->у:Z
773:     sput-boolean v5, Lׅ/ms;->у:Z
777:     invoke-virtual {v1}, File;->mkdirs()Z   ; 确保父目录存在
783:     invoke-virtual {v1}, File;->exists()Z
791:     if-nez v0, :cond_10
795:     if-eqz p2, :cond_10
799:     const-wide/16 v6, 0x5              ; 疑似重试/超时参数
```

### 7.4 完整文件格式（写入侧确认）

| 段 | 内容 | 编码 |
| --- | --- | --- |
| HEAD | `MAGIC_HEAD = 0xF5EF1234` | int32 LE |
| | `VERSION`（`ms.B`） | int32 LE |
| 值 × N | 按 `ms.Х` 顺序，逐类型分派（见下） | 见下 |
| TAIL | `MAGIC_TAIL = 0xEFFF4321` | int32 LE |

**值的编码规则**：

| 类型 | 类 | 编码 |
| --- | --- | --- |
| int | `a30` | `А:I` → int32 |
| boolean | `fc` | `А:Z` → int32（0/1） |
| float | `ht` | `floatToRawIntBits(А:F)` → int32 |
| long | `v80` | `B:J` → **int64** |
| String | `nf1` | `len:int32` + UTF-8 bytes；**空串写 0**，**null 写 -1**，**超 1 MiB 截断** |
| 复合 | `o31` | `А(cg0)` 自定义序列化 |
| 其它 | — | **`AssertionError`**（未知类型直接崩） |

> **这套协议的脆弱点**：`cond_d`（`:738-748`）对**任何未识别的值类型直接抛 `AssertionError`**。
> 意味着新增一种偏好类型时，**必须同步改 `ms.C`**，否则首次写盘就会崩。
> 这是"顺序序列化"设计的固有代价（对比 JSON 可以跳过未知字段）。

### 7.5 为什么 `n91.y()` 刷新不等于保存

结合 §7.2：`n91.y()` → `w2.В()` → 线程池 → **重建注册表索引**（`t2.х(map)`）。
它**不调用** `ms.C()`，所以**不写盘**。
真正的写盘只在 `SharedPreferences.Editor.commit()/apply()` 时发生。

这修正了 `poweramp-lockscreen-residual-closure.md` §2 的一处表述：
`w2.В()` 与 `cmd_player_reregister_media_session` 不等价（正确），
但它**同时也与"保存设置"不等价**——两者都不能互相替代。

---

## 3. `a30` —— 值对象（本文核心）

### 3.1 两个字段

```asm
; 【实证·产物】ׅ/a30.smali
  7: .field public final B:I      ; ★ 默认值（构造期传入）
  9: .field public А:I            ; ★ 当前值
```

### 3.2 构造函数：从 mmap 顺序读出初始值

```asm
; 【实证·产物】ׅ/a30.smali:13-93  <init>(er, ls, I)
 17:     invoke-direct {p0, p1}, Lׅ/t9;-><init>(Lׅ/er;)V   ; 基类存 er
 22:     iput p3, p0, Lׅ/a30;->B:I                        ; ★ B = p3（默认值）
 26:     if-eqz p2, :cond_1                               ; ls == null → 跳过读取
 30:     iget p1, p2, Lׅ/ls;->у:I                         ; ★ 取读游标
 34:     add-int/lit8 p1, p1, 0x1
 38:     iput p1, p2, Lׅ/ls;->у:I                         ; ★ 游标 +1
 42:     iget-object p1, p2, Lׅ/ls;->y:MappedByteBuffer;
 46:     if-eqz p1, :cond_1
 50:     invoke-virtual {p1}, Buffer;->position()I
 63:     invoke-virtual {p1}, Buffer;->limit()I
 66:     add-int/lit8 v0, v0, -0x8                        ; ★ 预留尾部 8 字节
 70:     if-le p2, v0, :cond_0                            ; 越界保护
 78:     invoke-virtual {p1}, ByteBuffer;->getInt()I       ; ★★ 顺序读一个 int
 83:     move-result p3
 86: :cond_1
 88:     iput p3, p0, Lׅ/a30;->А:I                        ; ★ А = 读到的值（或默认值）
```

**三个关键点**：

| 点 | 含义 |
| --- | --- |
| **`:22` 先写 `B = p3`** | 默认值在任何情况下都保留（用于 `y()` 恢复默认） |
| **`:38` 游标自增** | 每个值对象**按构造顺序**占用一个 int 槽位——**顺序即协议** |
| **`:66` `limit() - 8`** | 预留尾部：4 B 魔数 + 4 B 余量，防止越界读到魔数 |
| **`:78` 顺序 `getInt()`** | **没有 key 查找**，纯顺序读——这就是"Fast"的来源 |

> **`ls.у` 是全局读游标**，随每个值对象构造而递增。
> **这意味着 `y40` / `vr` / 其它命名空间的字段必须严格按固定顺序注册**——
> 一旦 `vr` 里插入一个新字段，**后面所有字段的偏移都会错位**。
> 这正是 `poweramp-lockscreen-preference-tree.md` 观察到的
> 「`vr:1572` 的 `if-ne` 是槽位自检断言」（FastStaticPrefs 槽号防错）的**根因**。

### 3.3 `у(I)` —— 唯一写入口（带幂等守卫）

```asm
; 【实证·产物】ׅ/a30.smali:197-224
197: .method public final у(I)V
201:     iget v0, p0, Lׅ/a30;->А:I      ; 当前值
205:     if-eq v0, p1, :cond_0          ; ★★ 值相同 → 整个方法返回
209:     iput p1, p0, Lׅ/a30;->А:I      ; 写新值
213:     iget-object p1, p0, Lׅ/t9;->В:Lׅ/er;
217:     invoke-virtual {p1}, Lׅ/er;->А()V   ; ★ 脏位 +1
223: :cond_0  return-void
```

**这与 `fc.у(Z)`（boolean 版）完全同构**，验证了 `poweramp-lockscreen-residual-closure.md` §1.1 的结论：
- `er.А()` 只是 `В += 1`，**不是广播**
- 幂等守卫在 `:205`，值不变**连脏位都不动**

### 3.4 `y()` —— 恢复默认

```asm
; 【实证·产物】ׅ/a30.smali:128-142
128: .method public final y()V
132:     iget v0, p0, Lׅ/a30;->B:I      ; ★ 取默认值 B
136:     invoke-virtual {p0, v0}, Lׅ/a30;->у(I)V   ; 写回
```

**`B` 字段存在的唯一理由**就是这一行。这也解答了 `poweramp-lockscreen-preference-tree.md` §5.6 的
「`p71(6)` 第一行冗余」——`fc.y()` / `a30.y()` 都是「把 `B` 写回」，而 `B` 在构造期就固定了。

---

## 4. `ms` —— 命名空间与工厂

### 4.1 `ms.р(I)` 建 int 偏好

```asm
; 【实证·产物】ׅ/ms.smali:2654-2685
2654: .method public final р(I)Lׅ/z20;
2658:     new-instance v0, Lׅ/z20;
2662:     iget-object v1, p0, Lׅ/ms;->А:Lׅ/er;      ; 共享脏位
2666:     iget-object v2, p0, Lׅ/ms;->x:Lׅ/ls;      ; ★ 共享 mmap 后端
2670:     invoke-direct {v0, v1, v2, p1}, Lׅ/a30;-><init>(...)  ; p1 = 默认值
2679:     invoke-virtual {p1, v0}, ArrayList;->add(...)Z       ; ★ 注册进槽位表
2684:     return-object v0
```

**`p1` 是默认值，不是槽位号**（本文修正了一个常见误读）。
槽位号是**隐式**的——由 `ls.у` 游标在构造时自增决定。

### 4.2 `ms.Х` 槽位表

`ms.Х:ArrayList` 保存了**所有**值对象，供两处使用：
1. `n91.n()` 的注册表查询（`poweramp-lockscreen-residual-closure.md` §1.3）
2. `ms.х(map)` 建立 key→对象 的索引（同上）

---

## 5. `y40` —— 授权命名空间的完整注册序列（实例）

```asm
; 【实证·产物】ׅ/y40.smali:39-269  <clinit>
 51:     const-string v2, "sbuf"                  ; Kotlin property 名
 55:     const-string v3, "getSbuf()Ljava/nio/ByteBuffer;"
 78:     sput-object v2, Lׅ/y40;->Н:[Lkotlin/reflect/KProperty;   ; 反射元数据

 86:     const-string v2, "l"                     ; ★★ 命名空间名 = "l"
 90:     invoke-direct {v0, v2}, Lׅ/ms;-><init>(String)V
 95:     sput-object v0, Lׅ/y40;->K:Lׅ/y40;        ; 单例

 99:     const/high16 v2, -0x80000000             ; ★ H 的默认值 = 哨兵
103:     invoke-virtual {v0, v2}, Lׅ/ms;->р(I)     ; 建 z20
111:     sput-object v2, Lׅ/y40;->H:Lׅ/z20;        ; → 槽位 0

115:     invoke-virtual {v0, v3}, Lׅ/ms;->р(I)     ; v3 = 0
123:     sput-object v2, Lׅ/y40;->Р:Lׅ/z20;        ; → 槽位 1（渠道，默认 0）

127:     invoke-virtual {v0}, Lׅ/ms;->Н()          ; Н() 返回 z20
135:     sput-object v2, Lׅ/y40;->P:Lׅ/z20;        ; → 槽位 2（到期时间戳）

139:     invoke-virtual {v0}, Lׅ/ms;->K()          ; K() 返回 ec（boolean）
147:     sput-object v2, Lׅ/y40;->р:Lׅ/ec;         ; → 槽位 3（已验证标志）

151-195: 4 个 mf1（float）                     ; → 槽位 4-7
199:     K() → ec                              ; → 槽位 8（o）
...
257:     sput-object v5, Lׅ/y40;->C:Lׅ/dd;         ; ByteBuffer 偏好
```

**注册顺序**（即文件内偏移顺序）：

| 槽位 | 字段 | 类型 | 默认值 |
| ---: | --- | --- | --- |
| 0 | **`H`** | `z20`(int) | **`0x80000000`** |
| 1 | **`Р`** | `z20`(int) | `0` |
| 2 | `P` | `z20`(int) | `0`（由 `Н()` 决定） |
| 3 | `р` | `ec`(bool) | — |
| 4-7 | `p`/`О`/`O`/`о` | `mf1`(float) | — |
| 8 | `o` | `ec`(bool) | — |
| … | `C`/`c`/`с` | `dd`/`z20`/`z20` | — |

> **这解释了 `poweramp-about-license-state-machine.md` 里的一个细节**：
> `y40.H` 的默认值 `0x80000000` 是**显式写在 `<clinit>` 里的**（`:99`），
> 不是从别处推断的。而 `ac.smali:303` 的同一个值只是**再读一遍时的 fallback 常量**。

---

## 6. 与 `SharedPreferences` 的关系

`FastStaticPrefs` 是**存储引擎**，`SharedPreferences` 是**对外接口**。
桥接层是 **`ׅ/v2`**（`implements android.content.SharedPreferences`），
它把 `getInt(key, def)` 转换成「在 `ms.х(map)` 建的索引里查 key → 找到值对象 → 返回 `А`」。

```
SettingsActivity / Preference 框架
        ↓  getSharedPreferences("global")
BaseApplication:1014-1074  （见 poweramp-lockscreen-residual-closure.md §1.4）
        ↓
v2 implements SharedPreferences
        ↓  按 key 查 ConcurrentHashMap
ms.Х:ArrayList 里的 98 个 pb1 / z20 / ec 值对象
        ↓  读当前值
a30.А  ←  由 ls:MappedByteBuffer 顺序读取初始化
```

---

## 7. 这套设计的三个后果（对分析者的意义）

### 7.1 字段顺序是**二进制协议**，不能随意调整

`ls.у` 游标顺序即文件偏移。**在任意命名空间的中间插入一个新字段，会让后续所有字段错位**。
这解释了产物里大量「槽位自检断言」的存在（如 `vr:1572` 的 `if-ne` + `AssertionError "bad slot=70 expecting="`）。

**【推断】** 这也是为什么 Poweramp 的版本升级需要 `ac.smali` / `lj.smali` 里的 `onUpgrade` 逻辑
（`lj.smali:3052` 有 `const/16 v0, 0xe5`，与授权状态无关，是 DB schema 版本）。

### 7.2 所有设置「一次读入内存」

启动时 `ls` 建立 mmap，然后**每个值对象构造时读一个 int**。
98+ 个字段 = 98 次顺序 `getInt`，比 `SharedPreferences` 的 98 次 hash 查找快一个数量级。

### 7.3 写入不是实时的

`a30.у(I)` 只改内存里的 `А`，并给 `er` 脏位 `+1`。
**真正刷盘需要外部触发**（`ms` 的提交路径 / `v2.edit()` 的 `apply/commit`）。
这也解释了 `poweramp-lockscreen-residual-closure.md` §2 的观察：
`n91.y()` → `w2.В()` 只是**重建注册表**，不等于「保存到磁盘」。

---

## 8. 对 SpMusic 的借鉴

SpMusic 是 Tauri + React 桌面播放器，用 JSON/TOML 存配置。

| 借鉴点 | 说明 |
| --- | --- |
| ✅ **「默认值内嵌在值对象里」** | Poweramp 每个偏好自带 `B`（默认值），恢复默认不需要外部 schema。桌面端可让每个 setting 的 TS 定义自带 `default`，避免两处维护 |
| ✅ **幂等写入** | `у(I)` 的 `if-eq` 守卫：值不变不触达任何副作用。桌面端若监听配置变化，应先做值比较再广播 |
| ❌ **不要照抄 mmap 顺序序列化** | 桌面端没有"98 个字段启动读"的性能压力；顺序协议让**增删字段极其危险**（必须写迁移逻辑）。JSON/TOML 的 key-value 语义更安全 |
| ❌ **不要照抄"兜底静默降级"** | `ls` 校验失败只 `Log.e` 然后**继续跑**（无 mmap）。桌面端配置损坏应显式报错或重置，不宜静默 |

---

## 9. 残留未知

| # | 问题 | 现状 |
| ---: | --- | --- |
| ~~F1~~ | ~~`ls.B()` 的 mmap 建立细节~~ | ✅ **已闭合**：`FileInputStream` + `getChannel()` + **`MapMode.READ_ONLY`** + **`ByteOrder.LITTLE_ENDIAN`**（`ls.smali:208-262`）。映射大小 = `channel.size()`（`:238`） |
| ~~F2~~ | ~~刷盘触发点~~ | ✅ **已闭合**：**不刷 mmap**。`u2.commit/apply → v2.В → t2.А → ms.C(ZZ)` 整块重建文件；`er.В` 与 `ms.A` 比较决定是否跳过（见 §7） |
| **F3** | `ls.К`（版本号）在版本不匹配时的迁移逻辑 | 只知读入，未找到比较与迁移分支 |
| **F4** | `MAGIC` 常量 `0xF5EF1234` / `0xEFFF4321` 是否有字面含义 | 疑为固定随机串，无法证实 |
| **F5** | `dd`（ByteBuffer 偏好）的序列化格式 | 只知它是 `y40.C`/`C` 的类型，内部 `А:ByteBuffer` 的读写格式未展开 |
| **F6** | 98 个 `pb1` 字段的完整顺序表（跨 `vr`/`y40`/其他命名空间） | 只解出 `y40` 的注册序列，`vr` 的 98 个未逐一编号 |

---

## 10. 证据索引

| 主题 | 路径 : 行 |
| --- | --- |
| **`ls` 字段表（File / MappedByteBuffer / 游标 / 版本）** | `smali/ׅ/ls.smali:10-18` |
| **日志标签 `"FastStaticPrefs"`** | `smali/ׅ/ls.smali:35` |
| **构造 + 双魔数校验** | `smali/ׅ/ls.smali:22-200`（`:44` 取 buffer、`:64` 最小长度 12、`:72-85` MAGIC_HEAD、`:101-114` MAGIC_TAIL、`:122` 挂载、`:126-134` 读版本） |
| 失败降级（静默） | `smali/ׅ/ls.smali:39`（`"!b file="`）、`:172`、`:192` |
| `ls.B()` 建映射 | `smali/ׅ/ls.smali:204` |
| **`a30` 字段 `B`/`А`** | `smali/ׅ/a30.smali:7` / `:9` |
| **`a30` 构造：B=默认、А=顺序读** | `smali/ׅ/a30.smali:13-93`（`:22` iput B、`:30-38` 游标+1、`:66` limit-8、`:78` getInt、`:88` iput А） |
| **`a30.у(I)` 写 + 幂等** | `smali/ׅ/a30.smali:197-224`（`:205` if-eq、`:209` iput、`:217` `er.А`） |
| `a30.y()` 恢复默认 | `smali/ׅ/a30.smali:128-142`（`:132` 取 B） |
| `t9` 基类（持 `В:er`） | `smali/ׅ/t9.smali:1-36` |
| `er` 脏位（`А()` = +1） | `smali/ׅ/er.smali:129-146` |
| **`ms.р(I)` 建 int 偏好** | `smali/ׅ/ms.smali:2654-2685`（`:2670` `a30.<init>`、`:2679` add 进槽位表） |
| `ms` 其他工厂 | `smali/ׅ/ms.smali:2570`（`Н()`→z20）、`:1472`（`K()`→ec）、`:1597`（`P()`→mf1） |
| **`y40` 命名空间名 `"l"`** | `smali/ׅ/y40.smali:86` |
| **`y40.H` 默认值 `0x80000000`** | `smali/ׅ/y40.smali:99`（`const/high16 v2, -0x80000000`）、`:103`（`ms.р`）、`:111`（`sput H`） |
| `y40.Р` 默认 0 | `smali/ׅ/y40.smali:115`（`invoke р(I)` where `v3=0`）、`:123` |
| `y40.P` / `y40.р` | `smali/ׅ/y40.smali:127-135` / `:139-147` |
| `y40.C`（ByteBuffer 偏好） | `smali/ׅ/y40.smali:211-257`（`u0(6)`、`nativeOrder()`、`new dd`、`:257` sput） |
| `dd` 字段（`A:ByteBuffer`） | `smali/ׅ/dd.smali:10` |
| `v2` = SharedPreferences 桥 | `smali/ׅ/v2.smali:6`（implements）、`:12`（map 字段） |
| `ms.х(map)` 建索引 | `smali/ׅ/ms.smali:2720` |
| 上游：注册表链路 | `docs/architecture/poweramp-lockscreen-residual-closure.md` §1.3 / §1.4 |
| 上游：槽位自检断言 | `docs/architecture/poweramp-lockscreen-preference-tree.md` §6.3 N2 |
