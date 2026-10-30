# Poweramp 播放队列 — 方法体实证证据（Q1–Q4 闭环）

**用途**：把 `docs/architecture/poweramp-queue-runtime-reference.md` 中标注为【实证·任务卡】的 8 个方法体，升级为【实证·产物】级证据。
本文每条均为 JADX 反编译原文，未经改写。

| 项 | 值 |
| --- | --- |
| 目标 | `com.maxmpz.audioplayer` build-1025-uni (1025009) |
| APK | `.rea-analysis/Poweramp-v3.apk` |
| SHA-256 | `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0` |
| 类 | `com.maxmpz.audioplayer.player.b0`（91 方法 / 45 字段，日志 tag `RestNowPlaying`） |
| 引擎 | JADX headless 0.7.1 via REA |
| 采集时间 | 2026-10-27 |

> 证据 ID 对照表见文末。所有方法体均为 `get_method_body` 的直接返回，`mode: "java"`、`fell_back: false`。

---

## 0. Q1–Q4 结论速览

| # | 原问题 | 结论 |
| --- | --- | --- |
| **Q1** | 8 个方法体是否如任务卡所述 | **8/8 全部属实**，但 **1 处任务卡描述错误**（`shouldMoveToQueueAfterSong` 与 `...AfterList` **不同型**），见 §7 |
| **Q2** | 随机播放是否对全局库洗牌 | **仍待验证**（方法体未给出 `getFiles()` 与播放列表的 URI 差异，属 `loadFilesCursorAndSetState` 内部） |
| **Q3** | `C0732.Q.f3810` / `C0732.R.f3810` 是否存在 | **两者均存在且已被引用**，见 §6/§8 |
| **Q4** | `prev()` 中 `mShuffle==1` 与 `mRepeat==1` 的分支先后 | **`mShuffle==1` 在前并直接 return**，故「随机+循环下 prev 回绕」**不成立** |

---

## 1. `isQueueMode()`

```java
private boolean isQueueMode() {
    return this.mFilesEntity instanceof m3;
}
```

---

## 2. `modesSupportCategoryNavigation(int)`

```java
private boolean modesSupportCategoryNavigation(int i) {
    return (this.mRawFileMode || i == 1) ? false : true;
}
```

⇒ **`i == 1`（随机）或裸文件模式时返回 false**，即分类导航被禁用。

---

## 3. `supportsCategoryNavigation()`

```java
public boolean supportsCategoryNavigation() {
    return (this.mCatCursor != null && modesSupportCategoryNavigation(this.mShuffle)) || isQueueMode();
}
```

---

## 4. `next(boolean z, boolean z2)` 完整方法体

`z` = 允许跨分类；`z2` = 仅探测/预取（不执行）

```java
public int next(boolean z, boolean z2) {
    int i;
    int iStartQueueIfNeededOnNext;
    int i2 = this.mRepeat;
    if (!z2 && this.mRawFileMode) {
        restoreNPFromRawFileMode();
    }
    boolean zIsQueueMode = isQueueMode();
    if (i2 == 3 && z && hasSomething()) {
        return 3;
    }
    if (z2) {
        if (shouldMoveToQueueAfterSong()) {
            return -10;
        }
    } else if (!zIsQueueMode && (iStartQueueIfNeededOnNext = startQueueIfNeededOnNext()) >= 0) {
        return updateCurrentTrack(iStartQueueIfNeededOnNext);
    }
    Cursor cursor = this.mFilesCursor;
    int uriCore = -1;
    if (cursor == null || cursor.isClosed()) {
        return -1;
    }
    int position = cursor.getPosition();
    if (cursor.moveToNext()) {
        i = 1;
    } else {
        cursor.moveToPosition(position);
        i = -3;
    }
    if (i >= 0) {
        uriCore = i;
    } else {
        if (zIsQueueMode) {
            if (z2) {
                return -9;
            }
            this.mHasPendingQueue = false;
            if (C0732.R.f3810 == 1) {
                return exitQueueImpl();
            }
            if (i2 == 1) {
                if (cursor.moveToFirst()) {
                    return updateCurrentTrack(1);
                }
                Log.e("RestNowPlaying", "next failed to repeat queue");
            }
            return i;
        }
        if (z2 && shouldMoveToQueueAfterList()) {
            return -10;
        }
        if (startQueueIfNeededOnList() > 0) {
            return updateCurrentTrack(1);
        }
        if (i2 == 1 || (i2 == 2 && (this.mCatUriMatch.f3309 instanceof o0))) {
            if (androidx.appcompat.widget.f.B(this.mShuffle)) {
                if (z2) {
                    return -8;
                }
                uriCore = toUriCore(this.mFilesUri, true, -1, false);
            } else if (cursor.moveToFirst()) {
                uriCore = 1;
            }
        } else {
            if (this.mShuffle != 1 && this.mCatCursor != null && (i2 == 2 || i2 == 5 || !z)) {
                if (z2) {
                    return -11;
                }
                return nextCategory(i2 != 5);
            }
            uriCore = -3;
        }
    }
    return z2 ? uriCore : updateCurrentTrack(uriCore);
}
```

**关键新事实**（超出任务卡）：
- `androidx.appcompat.widget.f.B(int)` 是「是否按随机排序」的判定，与 `mShuffle == 1` **不同** —— 任务卡未提及
- 队列模式下的 `C0732.R.f3810 == 1` 是「退出队列」的配置开关（任务卡也未提及，与 `Q.f3810` 是**不同字段**）
- `-8` / `-9` / `-11` 确认为 `z2` 分支的预取信号
- `i >= 0` 判定（非 `> 0`）—— 因 `i` 只会是 `1` 或 `-3`

---

## 5. `prev()` 完整方法体

```java
public int prev() {
    int i;
    if (this.mRawFileMode) {
        restoreNPFromRawFileMode();
    }
    Cursor cursor = this.mFilesCursor;
    int i2 = -1;
    if (cursor == null) {
        return -1;
    }
    int position = cursor.getPosition();
    if (cursor.moveToPrevious()) {
        i = 1;
    } else {
        cursor.moveToPosition(position);
        i = -4;
    }
    if (i >= 1) {
        i2 = i;
    } else {
        if (isQueueMode()) {
            return exitQueueImpl();
        }
        int i3 = this.mShuffle;
        if (i3 == 1) {
            return i;
        }
        if (this.mRepeat == 1) {
            if (i3 != 0 || cursor.moveToLast()) {
                i2 = 1;
            }
        } else {
            if (i3 != 1 && this.mCatCursor != null) {
                return prevCategory(true);
            }
            i2 = -4;
        }
    }
    return updateCurrentTrack(i2);
}
```

**Q4 已闭环**：`if (i3 == 1) return i;` 位于 `if (this.mRepeat == 1)` **之前**，因此随机模式下 `prev` 在头部**直接返回 -4**，永不进入 `mRepeat==1` 的回绕分支。
⇒ 「随机 + 循环下 prev 回绕」**不成立**。

**注意一处死分支**：因上面已 `return`，`if (i3 != 1 && ...)` 中的 `i3 != 1` 恒为真 —— 这是冗余条件（反编译忠实还原，非笔误）。

---

## 6. `nextCategory(boolean)` 完整方法体

```java
public int nextCategory(boolean z) {
    if (this.mRawFileMode) {
        restoreNPFromRawFileMode();
    }
    if (!supportsCategoryNavigation()) {
        return -6;
    }
    if (isQueueMode()) {
        return exitQueueImpl();
    }
    int iStartQueueIfNeededOnList = startQueueIfNeededOnList();
    if (iStartQueueIfNeededOnList > 0) {
        return updateCurrentTrack(iStartQueueIfNeededOnList);
    }
    Cursor cursor = this.mCatCursor;
    if (cursor == null) {
        return -6;
    }
    int position = cursor.getPosition();
    if (!cursor.moveToNext() && (!z || cursor.getCount() <= 1 || !cursor.moveToFirst())) {
        cursor.moveToPosition(position);
        return -3;
    }
    o0 o0Var = this.mFilesEntity;
    if (o0Var == null) {
        Log.w("RestNowPlaying", "nextCategory !mFilesEntity");
        return -6;
    }
    int iLoadFilesCursorFromCatCursor = loadFilesCursorFromCatCursor(
            cursor, o0Var, this.mCatUriMatch, this.mShuffle, true, 0, false, false);
    if (iLoadFilesCursorFromCatCursor > 0) {
        iLoadFilesCursorFromCatCursor = 2;
    }
    return updateCurrentTrack(iLoadFilesCursorFromCatCursor);
}
```

**任务卡遗漏**：成功换分类后**不会**移动 `mFilesCursor` 位置（与 `prevCategory` 相反），见下节。

---

## 7. `prevCategory(boolean)` 完整方法体

```java
private int prevCategory(boolean z) {
    if (!supportsCategoryNavigation()) {
        return -6;
    }
    if (isQueueMode()) {
        return exitQueueImpl();
    }
    Cursor cursor = this.mCatCursor;
    if (cursor == null) {
        return -6;
    }
    int position = cursor.getPosition();
    if (!cursor.moveToPrevious() && (cursor.getCount() <= 0 || !cursor.moveToLast())) {
        cursor.moveToPosition(position);
        return -4;
    }
    o0 o0Var = this.mFilesEntity;
    if (o0Var == null) {
        Log.w("RestNowPlaying", "nextCategory !mFilesEntity");
        return -6;
    }
    int iLoadFilesCursorFromCatCursor = loadFilesCursorFromCatCursor(
            cursor, o0Var, this.mCatUriMatch, this.mShuffle, true, 0, false, false);
    Cursor cursor2 = this.mFilesCursor;
    if (z && iLoadFilesCursorFromCatCursor > 0 && cursor2 != null) {
        cursor2.moveToLast();
    }
    if (iLoadFilesCursorFromCatCursor > 0) {
        iLoadFilesCursorFromCatCursor = 2;
    }
    return updateCurrentTrack(iLoadFilesCursorFromCatCursor);
}
```

**与 `nextCategory` 的不对称**：
- `prevCategory` **无** `mRawFileMode` 恢复（`nextCategory` 有）
- `prevCategory` 换分类后**若 `z` 为真则 `mFilesCursor.moveToLast()`**（进入新分类的最后一首）；`nextCategory` 无对应移动（默认停在第一首位置）
- 回绕条件不同：`prevCategory` 用 `count <= 0 || !moveToLast()`；`nextCategory` 用 `count <= 1`（**注意 `<= 1` 而非 `<= 0`**）
- 日志文案复制错误：`prevCategory` 里打印的是 `"nextCategory !mFilesEntity"`

---

## 8. 两个延迟队列判定（**任务卡此处有误，已更正**）

### 8.1 `shouldMoveToQueueAfterSong()`

```java
private boolean shouldMoveToQueueAfterSong() {
    if (!this.mHasPendingQueue || isQueueMode()) {
        return false;
    }
    int i = C0732.Q.f3810;
    return i == 2 || i == 1;
}
```

### 8.2 `shouldMoveToQueueAfterList()`

```java
private boolean shouldMoveToQueueAfterList() {
    if (!this.mHasPendingQueue || isQueueMode()) {
        return false;
    }
    int i = C0732.Q.f3810;
    return i == 1 || i == 2 || i == 3;
}
```

### 8.3 差异（**任务卡称两者「同型」，实为不同**）

| 配置值 `C0732.Q.f3810` | AfterSong | AfterList |
| --- | --- | --- |
| 1 | ✅ | ✅ |
| 2 | ✅ | ✅ |
| 3 | ❌ | ✅ |
| 其他 | ❌ | ❌ |

⇒ **值 `3` 只在「列表播完」时切队列，不在「单曲播完」时切。**
这是任务卡未捕获的行为差异，`i == 3` 是「仅列表结束后切换」的专用取值。

---

## 9. `C0732` / `C0742` 常量引用实证

| 引用 | 出现位置 | 语义（由用法推断，非字面量） |
| --- | --- | --- |
| `C0732.Q.f3810` | `shouldMoveToQueueAfterSong`、`shouldMoveToQueueAfterList` | 延迟队列触发时机，取值 1/2/3 |
| `C0732.R.f3810` | `next()` 队列越界分支 | `== 1` 时队列播完即 `exitQueueImpl()` |
| `androidx.appcompat.widget.f.B(int)` | `next()` 循环回绕分支 | 判定是否随机排序（**与 `mShuffle == 1` 不等价**） |

**注意**：`C0732.Q.f3810` 与 `C0732.R.f3810` 是**同一常量类 `C0732` 下的不同内部类的同名字段**，语义**不同**。任务卡把二者混用，已在此更正。

---

## 10. 仍未闭环

| # | 问题 | 原因 |
| --- | --- | --- |
| Q2 | 随机播放是否全局库洗牌 | 取决于 `loadFilesCursorAndSetState` 与 `prepareFilesUri` 内部，本次未取 |
| — | `androidx.appcompat.widget.f.B(int)` 的具体判定逻辑 | 混淆的 `androidx` 内复刻类，需单独反编译 |
| — | `C0732.Q.f3810` / `C0732.R.f3810` 的**取值集合与资源来源** | 需反编译 `C0732` 类本身与其初始化 |
| — | `-1` 到 Toast 文案的完整映射 | 已在 `findings-core.md:50-53`，本次未复核 |

---

## 11. 证据 ID 索引

| 方法 | Evidence ID |
| --- | --- |
| `isQueueMode` | `ev_d77ba8c3563c026139cd1be2d40b7837d953db0339024bac51986a5c251003f9` |
| `modesSupportCategoryNavigation` | `ev_51deccfbbbc83d75235d772904918b4c7b7ca05f188c8ee9e77197617ee0e8d8` |
| `supportsCategoryNavigation` | `ev_2ca2704d614077e753bee9d449ea2133326061039910395ec3482bf490c254fa` |
| `next` | `ev_8bff79453f5e6398e74d15254f7e892027c8a7c5eb9024bda34f57eeab929b33` |
| `prev` | `ev_a36863ee9cd575acb4b221527e19bc779647d36827ecef53d8a2b613541c3575` |
| `nextCategory` | `ev_f89e759f57279115c59bbcc64853c92a8358086ff29f45cceccf60a99da3358b` |
| `prevCategory` | `ev_c73da790d9bb677ffe972dc53ba640200826a4226b3749fc77b9d30032508f4f` |
| `shouldMoveToQueueAfterSong` | `ev_5fbded7b8b35abb6447506cb805559378910e67cf48313f1043729d5996186a1` |
| `shouldMoveToQueueAfterList` | `ev_fadb8e8b109de8293c67c1db02d83ca0c850fdcefade173e3cab3cf11dd86db4` |

---

## 12. 对 `poweramp-queue-runtime-reference.md` 的修订建议

1. **§3 证据级别升级**：`next`/`prev`/`nextCategory`/`prevCategory`/`supportsCategoryNavigation`/`modesSupportCategoryNavigation`/`shouldMoveToQueueAfter*` 由【实证·任务卡】改为 **【实证·产物】**，引用本文。
2. **§7 更正**：`shouldMoveToQueueAfterSong` 与 `...AfterList` **不是同型**，`i == 3` 仅存在于 AfterList。
3. **§7 更正**：`C0732.Q.f3810`（延迟队列时机）与 `C0732.R.f3810`（队列播完退出）是**不同字段**，不可混用。
4. **§4 更正**：补充「`prev()` 中 `mShuffle==1` 分支在 `mRepeat==1` 之前并直接 return」的实证，Q4 结论为「随机+循环下 prev 不回绕」。
5. **§4 补充**：`prevCategory` 换分类后 `moveToLast()`，`nextCategory` 无对应动作；`prevCategory` 缺 `mRawFileMode` 恢复。
6. **§5 新增**：`next()` 的循环回绕判定用 `androidx.appcompat.widget.f.B(mShuffle)`，**不等价于 `mShuffle == 1`**，需单独验证。
7. **§11 Q2 保持「待验证」**：本轮未取 `loadFilesCursorAndSetState`，随机范围的疑问依然开放。
