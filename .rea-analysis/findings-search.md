# Poweramp 搜索逻辑与「播放搜索结果」对队列的影响

**证据级别**：本文全部为 JADX 反编译**原文实证**（`mode: "java"`、`fell_back: false`），非推断。

| 项 | 值 |
| --- | --- |
| 目标 | `com.maxmpz.audioplayer` build-1025-uni (1025009) |
| APK SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 引擎 | JADX headless 0.7.1 via REA |
| 采集 | 2026-10-27 |

---

## 0. 一句话结论

**Poweramp 的搜索结果是「多个分类游标 + 分节标题」拼成的 `MergeCursor`（虚拟列表），不是一个独立实体。**
播放搜索结果时**没有任何专用路径**——它把搜索 URI 交给标准的 `toUriCore()`，与播放任意列表完全同构。
因此 **`mFilesCursor` 会指向这个 `MergeCursor`**，后续 `next()`/`prev()` 在「分节标题行」上的行为成为关键。

---

## 1. 类结构：`v3 extends p0`

```
com.maxmpz.audioplayer.rest.library.v3   ← 搜索实体（40 方法，5 字段）
    extends p0                            ← 具体分类基类（62 方法）
        implements x2                     ← 实体接口
```

`v3` 字段：
| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `H` | `w3` | **搜索执行器** |
| `f3386` | `x3[]` | 参与搜索的子分类数组 |
| `f3384` | `int` | 搜索模式 |
| `P` | `String` | 搜索词 |
| `f3385` | `d` | — |

关键：`v3` 自己**不构建 SQL**。`v3.X0(...)` 是空实现：
```java
@Override
public final String[] X0(Uri uri, com.maxmpz.audioplayer.player.r rVar, String str,
                         StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    throw new AssertionError();
}
```
⇒ 搜索**绕开了**通用实体 `X0 → player.r.K → rawQuery` 的 SQL 组装链。

---

## 2. 搜索执行入口：`v3.g0`

```java
@Override   // com.maxmpz.audioplayer.rest.library.j1
public final Cursor g0(Context context, SQLiteDatabase sQLiteDatabase, C0603 c0603) {
    com.maxmpz.audioplayer.data.api.K k = (com.maxmpz.audioplayer.data.api.K) c0603;
    k.f2658 = -1;
    return this.H.B(context, sQLiteDatabase, k, false, new u3(k));
}
```
⇒ 直接委托给 `w3.B(...)`，**避开 RestProvider 的 URI→SQL 全链路**。

---

## 3. 搜索核心：`w3.B` 的完整算法

签名：`B(Context, SQLiteDatabase, K query, boolean z, u3 callback) → Cursor`

这是整个搜索逻辑的核心，分五段：

### 3.1 搜索词与「最小长度」

```java
String strX = c0603.x();                        // 分类过滤词（URI 路径）
if (strX == null || strX.length() == 0) strX = null;

int i4 = (strX != null
       || z
       || w3Var.f3393
       || !isCjkLocale(Locale.getDefault()))
       ? 1 : 2;                                 // ← 最小搜索长度
```

**CJK 特殊处理（重要）**：默认最小搜索长度 **1**，但**中日韩语言环境下若无分类过滤词则要求 2**。

```java
int i4 = (strX != null || z || f3393 || !isCjkLocale(...)) ? 1 : 2;
// 等效：非 CJK → 1；CJK 且无 strX 且无 z 且无 f3393 → 2
```

CJK 判定用 `language.hashCode()` 硬编码字符串比较：
```java
iHashCode == 3383 ? !language.equals("ja")
: iHashCode == 3428 ? language.equals("ko")
: iHashCode == 3886 && language.equals("zh")
```
（`3383`=`ja`、`3428`=`ko`、`3886`=`zh` 的 `String.hashCode()`）

### 3.2 搜索词 trim（手写内联，非 `String.trim()`）

```java
String strX2 = c0603.X();
// 手写双指针：从左跳 <=32 的字符，从右跳 <=32 的字符
// Intrinsics.compare(strX2.charAt(pos), 32) <= 0
string = strX2.subSequence(i5, length + 1).toString();
```

### 3.3 空查询 → **搜索历史**分支

```java
if (string == null || string.length() < i4) {
    String str2 = w3Var.A;                      // A = 历史表名
    if (str2 != null && strX == null && (string == null || string.length() == 0)) {
        c0603.f2664 = null;
        c0603.c = true;                         // ← 标记为"历史模式"
        String str3 = w3Var.X;
        String[] strArr = (str3 == null || str3.length() == 0)
            ? new String[]{"'-3' AS _id ", "term"}
            : new String[]{"'-3' AS _id ", "term", str3};
        Cursor cursorQuery = sQLiteDatabase.query(
            str2, strArr, null, null, null, null,
            "updated_at DESC", "16");           // ← 最近 16 条
        if (cursorQuery == null || cursorQuery.getCount() == 0) return cursorQuery;
        MatrixCursor matrixCursor = new MatrixCursor(AbstractC0735.f3405);
        matrixCursor.addRow(new Object[]{-3L,
            context.getString(R.string.clear_search_history)});   // ← "清除历史"行，_id = -3
        return new MergeCursor(new Cursor[]{cursorQuery, matrixCursor});
    }
    if (!z) { c0603.f2664 = null; return null; }   // ← 无历史且非强制 → null
    str = null;                                    // ← 强制模式：空词也搜
}
```

**关键常量**：
- 历史条数上限 **16**
- 历史排序 `updated_at DESC`
- 「清除搜索历史」伪行的 `_id = -3`
- 搜索词为空但 `z=true` 时进入「全量列举」模式

### 3.4 多分类循环 → 拼 `MergeCursor`

```java
x3[] x3VarArr = c0603.O;          // 参与搜索的子分类
int length3 = x3VarArr.length;
ArrayList cursors = new ArrayList();     // 结果游标
ArrayList sections = new ArrayList();    // 分节信息（api.X）

for (int i6 = 0; i6 < length3; i6++) {
    x3 x3Var = x3VarArr[i6];
    String[] strArr4 = strArr3[i6];
    Uri uriB0 = (uriBuild != null) ? uriBuild : x3Var.B0();
    boolean z5 = (uriBuild != null);

    com.maxmpz.audioplayer.player.r rVar = new com.maxmpz.audioplayer.player.r();
    i1 i1Var = new i1();
    ArrayList args = new ArrayList();
    StringBuilder sb = new StringBuilder();

    // ★ 每个子分类用自己的 t0 生成 WHERE 片段
    String[] proj = x3Var.t0(uriB0, rVar, strArr4, str, sb, args, i1Var, i6, c0603);

    Cursor cursorK;
    if (proj == null) {
        cursorK = null;
    } else {
        if (!z5) i1Var.B = x3Var.S(i6);       // 排序表达式
        // ★★ 统一走 player.r.K 执行
        cursorK = com.maxmpz.audioplayer.player.r.K(
            rVar, sQLiteDatabase, proj, sb.toString(), args.toArray(...),
            i1Var.f3335, i1Var.B, i1Var.f3334);
    }

    if (cursorK != null) {
        int count = cursorK.getCount();
        if (count > 0) {
            // 分节标题行
            if (!w3Var.B || (uriBuild != null && (!w3Var.f3390 || i6 <= 0))) {
                i2 = 0;                                   // 不加标题
            } else {
                int i12 = i8 + 1;
                sections.add(new com.maxmpz.audioplayer.data.api.X(i7, i12));
                String label = x3Var.mo2433(context2, i6);
                MatrixCursor mc = new MatrixCursor(strArr2);
                mc.addRow(new Object[]{"-2", label});      // ← 分节标题伪行 _id = "-2"
                arrayList6.add(mc);
                i2 = 1;
            }
            arrayList6.add(cursorK);
            // ... 高亮定位（见 3.5）
            if (u3Var != null) u3Var.invoke(x3Var, cursorK, Integer.valueOf(i13));
            i7 = i2 + count + i7;                          // 累计全局位置
            // 分节图标资源
            int iG = x3Var.G();
            if (iG != 0) { /* resolveAttribute → iArr[i6] = resourceId */ }
        } else {
            cursorK.close();                               // 空结果直接关闭
        }
    }
}

return cursors.size() > 0 ? new MergeCursor(cursors.toArray(new Cursor[0])) : null;
```

### 3.5 命中高亮定位

```java
if (z2 && c0603.f2665 == -1 && c0603.H != 0
    && (iArr2 = c0603.o) != null && !ArraysKt.m3163(iArr2, i6)
    && (iC = androidx.appcompat.widget.n.c(cursorK, c0603.H, -1, -1, -1, false)) != -1) {
    c0603.f2665 = iC + i13;        // ← 记录命中项在全局 MergeCursor 中的位置
}
```

### 3.6 收尾

```java
c0603.C = iArr3;                               // 分节图标资源 id 数组
if (z2 && c0603.f2665 == -1) c0603.H = 0;      // 未命中 → 清空高亮目标
c0603.f2672 = str;                             // 回写实际搜索词
return mergeCursor;
```

---

## 4. 虚行 `_id` 常量汇总（**最关键**）

| `_id` | 含义 | 来源 |
| --- | --- | --- |
| `-2` | **分节标题行** | `mc.addRow(new Object[]{"-2", label})` |
| `-3` | **「清除搜索历史」行** | `matrixCursor.addRow(new Object[]{-3L, ...})` |
| 真实文件 | `folder_files._id`（正数） | 各子分类 `cursorK` |

**这意味着搜索结果的 `mFilesCursor` 是一个混有非曲目行的 `MergeCursor`。**

---

## 5. 播放搜索结果 → 队列的影响

### 5.1 进入路径：**无专用通道**

`v3.m0(boolean, Uri)`：
```java
public final Uri m0(boolean z, Uri uri) {
    return uri.buildUpon().appendEncodedPath("massops").build();
}
```
⇒ 搜索实体继承了 `p0` 的 `massops` 语义，但**播放本身走标准 `toUriCore`**。

`v3.mo2422(boolean)`：
```java
public final x2 mo2422(boolean z) { return this; }
```
⇒ 无变换，直接返回自身（即搜索实体不被改写为其它实体）。

### 5.2 对 `b0` 队列状态的影响

`toUriCore` 的既有逻辑（见 `findings-queue.md`）会把搜索实体当作普通 `o0`：
1. `getParentCategoryListUriMatch` 从搜索 URI 推出父分类
2. `loadFilesCursorAndSetState` 调 `RestProvider.A(...)` → 最终到 `v3.g0` → `w3.B`
3. **`mFilesCursor` 指向这个 `MergeCursor`**

### 5.3 伪行如何被消费【已实证，非推断】

这一节原本是推断，现已通过三个方法体实证闭环。

#### 证据 A：`b0.updateCurrentTrack(int)` —— **不检查 `_id`**

```java
private int updateCurrentTrack(int i) {
    if (i > 0) {
        this.mMetaTrackInfo = null;
        if (!this.mRawFileMode) {
            this.mCurrentTrack = getCurrentTrack();
        }
    }
    return i;
}
```
⇒ 只要 `i > 0`（状态码），就无条件 `getCurrentTrack()`。**伪行不会被这一层拦截。**

#### 证据 B：`b0.getFilesCursorMayBeEntryId` —— 伪行会读到 `-2`/`-3`

```java
private static long getFilesCursorMayBeEntryId(Cursor cursor, o0 o0Var) {
    return o0Var.o1() ? cursor.getLong(cursor.getColumnCount() - 1) : cursor.getLong(0);
}
```
⇒ 停在伪行时，返回值就是 `-2`（标题）或 `-3`（清除历史）。

#### 证据 C：`b0.getCurrentTrack` —— 伪行会走 `generateMissingTrack`

```java
private g0 getCurrentTrack() {
    Cursor cursor = this.mFilesCursor;
    if (cursor == null || cursor.isAfterLast() || cursor.isBeforeFirst()
        || (o0Var = this.mFilesEntity) == null) {
        return null;
    }
    long j7 = cursor.getLong(0);                                  // ← 可能是 -2/-3
    long filesCursorMayBeEntryId = getFilesCursorMayBeEntryId(cursor, this.mActualLoadedFilesEntity);
    ...
    Cursor currentTrackCursor = getCurrentTrackCursor(this.mActualLoadedFilesEntity, filesCursorMayBeEntryId);
    if (currentTrackCursor == null) {
        Log.e("RestNowPlaying", "getCurrentTrack null cursor");
        return null;
    }
    if (currentTrackCursor.moveToFirst()) {
        ... 构造 g0 track ...
    } else {
        Log.e("RestNowPlaying", "getCurrentTrack empty cursor =>missing track");
        n0 files3 = this.mRestLibrary.getFiles();
        g0VarGenerateMissingTrack = generateMissingTrack(
            j8, count, position, files3.m(), files3, a0Var2,
            this.mRestLibrary.getFiles().B0(), uri3,
            this.mRestLibrary.getFiles(), uri3);
    }
}
```

**结论**：伪行 `_id = -2/-3` 去查 `folder_files` 必然 **空游标**，于是打印
`"getCurrentTrack empty cursor =>missing track"` 并调用 `generateMissingTrack(...)`
构造一个"缺失曲目"占位 `g0`。

⇒ **伪行不会被静默跳过，而是被当作"缺失文件"渲染。**

#### 证据 D：`next()` 本身也没有 `_id` 过滤

```java
if (cursor.moveToNext()) { i = 1; } else { cursor.moveToPosition(position); i = -3; }
...
return z2 ? uriCore : updateCurrentTrack(uriCore);
```
⇒ 停在标题行时 `moveToNext()` 成功返回 `1`，队列认为"前进成功"。

### 5.4 四个已验证的后果

| # | 后果 | 证据级别 |
| --- | --- | --- |
| 1 | **`next()` 会停在 `-2`/`-3` 伪行上** | 【实证】`next()` 无 `_id` 检查 + `getFilesCursorMayBeEntryId` 直接返回该值 |
| 2 | **伪行被当作"缺失曲目"渲染**，而非跳过 | 【实证】`getCurrentTrack` 的 `empty cursor =>missing track` 分支 |
| 3 | **`mFilesCursor.getCount()` 含标题行**，可播数 = 总数 − 分节数（− 可能的历史"清除"行） | 【实证】`w3.B` 的 `i7 = i2 + count + i7` 累积逻辑 |
| 4 | 切换分类/改搜索词 → `x3[]` 变化 ⇒ **新的 `MergeCursor`**，旧队列游标失效 | 【实证】`w3.B` 每次重新构建 `new MergeCursor(...)` |

> ⚠️ 唯一残留推断：`generateMissingTrack` 对 `id <= 0` 的**内部**处理（是构造占位曲目还是返回 null）未读其方法体。但**调用点**已实证。

### 5.4 与「播放普通列表」的差异总结

| 维度 | 普通列表（`k3`/`m3`/`n0`） | 搜索结果（`v3`） |
| --- | --- | --- |
| SQL 生成 | 实体 `X0` → `player.r.K` | `w3.B` 循环调各子分类 `t0` → `player.r.K` |
| 游标类型 | 单一 `Cursor` | **`MergeCursor`（多段拼接）** |
| 含伪行 | 否 | **是**（`-2` 标题、`-3` 清除历史） |
| 排序 | 单一 `ORDER BY` | **每段独立排序**，段间固定顺序 |
| 分页 | `h1.C` id 重查 | `MergeCursor` 本身无分页 |
| 队列 `kind` | `playlist` / `all-songs` | 复用其一（无专用 kind） |

---

## 6. massops（批量操作）路径

`p0.mo2455(...)` 是删除类批量操作的实现，显示搜索结果的**批量处理**走 massops：

```java
public com.maxmpz.utils.y mo2455(RestProvider restProvider, Uri uri, long[] jArr,
                                 int i, int i2, int i3, UriAndIds uriAndIds, boolean z) {
    StringBuilder sb = new StringBuilder((jArr.length * 5) + 64);
    StringBuilder sb2 = new StringBuilder();
    // 1) 用 e0 从 id 数组构造 WHERE
    if (e0(uri, jArr, i, i2, i3, sb, sb2, false)
        && (cursorA = restProvider.A(uri, j(), sb.toString(), null, sb2.toString(), false)) != null) {
        if (cursorA.getCount() == 0) { cursorA.close(); return null; }
        try { yVarM2443 = g3.m2443(cursorA, restProvider); }
        catch (B e) { b = e; yVarM2443 = e.A; }
        int i4 = 0;
        if (yVarM2443 != null && yVarM2443.A > 0) {
            sb.setLength(0);
            if (n.m312(sb, V(), yVarM2443.B, 0, yVarM2443.A) && sb.length() > 0) {
                int iDelete = restProvider.delete(uri, sb.toString(), null);
                if (iDelete > 0) {
                    if (z) {                                    // ← z = 同时清理播放列表引用
                        k3 k3VarZ0 = g1Var.getPlaylists().Z0();
                        // DELETE FROM playlist_entries WHERE folder_file_id IN (...)
                        if (n.m312(sb3, "folder_file_id", jArr2, 0, i5)) {
                            restProvider.delete(k3VarZ0.B0(), sb3.toString(), null);
                        }
                    }
                    // 事务内刷新
                    writableDatabase.beginTransactionNonExclusive();
                    g1Var.m2440(writableDatabase);
                    writableDatabase.setTransactionSuccessful();
                    ...
                }
                i4 = iDelete;
            }
        }
        ...
    }
}
```

**注意**：`mo2455` 用的是 `e0(...)` + `restProvider.A(...)`，**不是** `w3.B`。即 massops 对**具体实体**操作，而搜索的 `MergeCursor` 不直接参与批量删除——批量删除针对的是选中项的实体 URI。

---

## 7. 证据 ID 索引

| 方法 | Evidence ID |
| --- | --- |
| `v3` 类摘要（40 方法/5 字段） | `ev_df6c4097218a3fa1d245f35a5c9f2b1451eb0a2e859aba3f687f241999ed58f3` |
| `v3.X0`（空实现 `AssertionError`） | `ev_3b7a655ff6c09a23f1e3a6db9de9b1b21c955a61bb9d53a0a970cb113137a11a` |
| `v3.g0`（委托 `w3.B`） | `ev_3456bc738d2a90bba78cc336dd8c571132b935d8818cb9a2bb75f4f4eede21c7` |
| `w3` 类摘要（5 方法/7 字段） | `ev_025e497fdf2d6aa4ee8bce40486b394fc801bfa118bb60dccafc409fcea08929` |
| **`w3.B`（搜索核心）** | `ev_0850f0407c20ba473addacd1bbbeda88c7e7a3254b0a7874281d305b3ea0dade` |
| `v3.m0`（追加 `massops`） | `ev_47acff4c00f5714781cb4787721950b3d968df4adb9f3c587f42d72f334d47e0` |
| `p0` 类摘要（62 方法/8 字段） | `ev_2fab886e7e1aa600afc2a8cd65f456cca6ae189838055fb980048a70ee553755` |
| `p0.mo2455`（批量删除） | `ev_2de43efb44c7d52833a6ff48ca0b1c03c04e3074783dc738004bb5f2dd6a489e` |
| `v3.mo2422`（返回自身） | `ev_d4b5daf3894284b383e49adfe238292d4c29d2d2694bbaeb35c9b6cc15afd2af` |
| **`b0.updateCurrentTrack`（无 `_id` 检查）** | `ev_34d53ef2d222595cf862f286a094d44324a4e96fe976a8b95a2a9b347f83a142` |
| **`b0.getFilesCursorMayBeEntryId`（伪行直读）** | `ev_29f6f083d020f442e0268cd75bdb0e1a2fa7732e545d397e8307075a05c592be` |
| **`b0.getCurrentTrack`（伪行→missing track）** | `ev_cd77550878cdc54b8c0f352233083b64cba2efe5d1c8859cbf00366c46c08e85` |

---

## 8. 未解 / 待验证

| # | 问题 | 为何重要 |
| --- | --- | --- |
| S1 | ~~`b0` 在 `next()`/`prev()` 中是否跳过 `_id < 0` 的伪行~~ | **已闭环**：不跳过。见 §5.3 |
| S2 | `generateMissingTrack` 内部对 `id <= 0` 的处理 | 调用点已实证；**内部实现未读**——决定占位曲目长什么样 |
| S3 | `w3.B` 的 `boolean z` 参数语义 | 看起来是"强制搜索/全量列举"，未确认 |
| S4 | `w3.B` 的 `f3390` / `f3392` / `f3393` 三个 boolean 字段各自含义 | 影响分节标题出现条件与最小搜索长度 |
| S5 | `x3` 子分类数组 `c0603.O` 的构成顺序 | 决定搜索结果的**分节顺序**（歌曲/专辑/艺术家/文件夹…） |
| S6 | `AbstractC0735.f3405`（`MatrixCursor` 列定义） | 伪行列结构 |
| S7 | 搜索结果的排序是否受 `mShuffle` 影响 | `next()` 的洗牌分支会 `toUriCore(..., true, ...)`，对 `MergeCursor` 重洗行为未知 |
| S8 | `o0.o1()` 的语义 | `getFilesCursorMayBeEntryId` 用它决定读首列还是末列；搜索实体继承自 `p0`，其 `o1()` 返回值未读 |

---

## 9. 对 SpMusic 的可借鉴点（提案，非现状）

1. **`_id = -2/-3` 的"伪行"模式**：把分节标题与特殊操作行编入同一游标，避免维护"实体列表 + 标题列表"两套结构。代价是消费方必须过滤负 id。
2. **按语言切换最小搜索长度**：CJK 用 2、拉丁用 1。SpMusic 当前无此区分，中文单字搜索体验可能需评估。
3. **搜索历史复用同一游标**：空查询时返回历史表 + "清除"伪行，UI 无需切换数据源。
4. **`massops` 与搜索结果分离**：批量操作始终针对**真实实体 URI**，不针对 `MergeCursor`。这是清晰的分层。

---

## 10. 与既有文档的关系

- 队列状态机与 `next`/`prev` 语义：`docs/architecture/poweramp-queue-runtime-reference.md` + `.rea-analysis/findings-queue.md`
- 播放列表实体 `k3` / 队列表 `m3` / 文件实体 `n0`：`.rea-analysis/findings-db.md`
- 本文只补 **搜索实体 `v3` / `w3`** 及其与队列的接合点。
