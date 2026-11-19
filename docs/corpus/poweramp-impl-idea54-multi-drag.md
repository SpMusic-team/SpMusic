---
doc_id: "ARCH-POWERAMP-IMPL-IDEA54-MULTI-DRAG"
title: "已实现投票逐条逆向 #4：Multiple item dragging in Playlists/Queue（idea 54）"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 2
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 继续逐条逆向已实现投票"
  - "docs/corpus/poweramp-feature-votes.md"
  - ".rea-analysis/smali/smali/com/maxmpz/widget/list/{p0,n0,o0,t1}.smali（自研拖拽框架）"
---

# 已实现投票逐条逆向 #4：Multiple item dragging in Playlists/Queue（idea 54）

> 投票原文：*"Move multi-selected items up and down in Playlists or the Queue as a block,
> rather than just moving single songs"*，18 票。
> changelog 记载：属于 **Feature Package #1**（`changelog_978_fp` 首项）。

## 0. 一句话结论

**不是系统 ItemTouchHelper，而是一套自研拖拽框架**（全库 `ItemTouchHelper` 零命中）。
三层分工：

| 层 | 类 | 行数 | 职责 |
| --- | --- | ---: | --- |
| 编排层 | `widget/list/p0` = **MultiGridDragHelper** | 3686 | 收集多选行、调度、落点计算 |
| 行层 | `widget/list/n0` = **GridDragHelper** | 576 | 单行拖动状态机 |
| 回调层 | `widget/list/o0` | 318 | `x1` 接口实现，衔接列表 |

**触发条件只有一条**：选中数 > 1 **且** 被拖项已勾选（`p0.B()` `:591-611`）。

---

## 1. 触发条件（`p0.B()` `:340-700`）

```smali
; 前置守卫
if (list.a2.х) return false          ; "already in transition"（:365-373）
if (recyclerView.O != null) return false   ; 已有拖动会话（:410-412）

; ★ 多选判定（:591-611）
if (selection.B > 1) {                       ; 选中数大于 1
    if (item instanceof list/A) {            ; 该行支持勾选
        if (((list/A) item).isChecked()) {   ; 且这一行确实被勾选
            multiMode = true;                ; → 进入批量拖动
        }
    }
}
```

> 三个条件缺一不可。**若拖动的是未勾选的行，则退化为单行拖动**——
> 这样"没勾选时拖谁就是谁"的直觉被保留。

---

## 2. 选择模型（`widget/list/t1`）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `X` | `int[]` | **选中位置数组**（对应 adapter 的 position） |
| `B` | `int` | **选中数量** |
| `у` | `v0[]` | 选中行视图缓存 |
| `y` | `int` | 锚点位置（初值 -1，`:37-39`） |
| `х` | `boolean` | 选择模式开关 |
| `A` / `x` / `А` / `Х` | `int` | 其它状态位 |

> `K` 字段是个 `Hanlder` 包装（`:41-47`，构造时 `0x1d` 参数），用于延迟回调。

---

## 3. 多选行的收集算法（`p0` `:1170-1240`）

这是本条最核心的一段：

```smali
; —— 实测反推（变量名按语义重命名）——
; v4 = 首个可见位置 (adapter.B())
; v5 = 末个可见位置 (adapter.А())
len = v5 - v4 + 1
arr = new int[len]
Arrays.fill(arr, -1)                       ; 全部填 -1

sel = selection.X                           ; 选中位置数组 (t1.X)

; 只扫描【可见区间】内的行
for (i = v4; i <= v5; i++) {
    if (sel[i] == 1 && i != anchor) {       ; ★ 该行已勾选 且 不是锚点
        arr[n++] = i;
    }
}

; 由行号数组构建视图数组并挂到行助手
gridViews = В.i(list, arr, adapterPos)
grid.k    = gridViews                       ; ★ 多行视图数组
```

| 步骤 | 方法 | 位置 |
| --- | --- | --- |
| 区间长度与填充 | 内联 | `:1170-1178` |
| 勾选判定 | `aget v2, v11, v4`（取 `sel[i]`）→ `if-ne v2, v14`（v14=1） | `:1199-1201` |
| 锚点排除 | `if-eq v4, v3` | `:1203` |
| 收进数组 | `aput v4, v6, v9` | `:1207` |
| 批量视图 | `В.i(list, int[], int)` | `:1236-1238` |
| 挂到行助手 | `iput → n0.k` | `:1240` |

> **`n0.k` 就是"这批要一起拖的行"**。单行拖动时它是 `null`（`o0:92` 判空），
> 多选时是数组——**同一个助手类，靠 `k` 是否为 null 区分单/多行**。

---

## 4. 行助手的状态机（`widget/list/n0`）

关键字段（`n0.smali:6-84`）：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `k` | `v0[]` | **多选行视图数组**（null = 单行模式） |
| `В` | `PowerList` | 所属列表 |
| `А` | `v0` | 被拖拽的锚行 |
| `P` / `j` | `s` | 拖影/原位的场景对象 |
| `p` / `О` / `Р` | `int` | 位置（初值 -1） |
| `с` | `int` | 由 `p12 * p11 + 0.5f` 取整（`:165-173`），推测为**指针对锚点的偏移** |
| `m` | `float` | 拖影缩放，初值 1.0f（`:187-189`） |
| `B` | `boolean` | 是否为多选模式 |
| `x` | `float` | 触点相对偏移 |
| `y` / `Х` / `X` | `int` | 触摸坐标与阈值 |

> 构造器参数含 `p12 * p11` 的取整运算（`:165-173`）——即**用密度换算触摸点到行顶的距离**，
> 决定拖影跟随手指时的对齐基准。

唯一公开方法 `В(IZI)`（`n0:521`）：接收 (位置, 是否动画, 目标索引)，
推测为**落点更新**入口。

---

## 5. 落点与写回

`MultiGridDragHelper` 对外的写回参数是行号数组；最终落库走两套：

| 目标 | 实现 |
| --- | --- |
| 播放列表 | `playlist_entries.sort`（`data/А` 的批量语句，见 idea 58 专文） |
| 队列 | `queue.sort` + `queue.shuffle_order`（`rest/library/m3`） |

`p0:3393` 的 `у()` 是收尾：先取 `n0.у`（目标位置），再决定是否提交。

> 完整落库 SQL 与 idea 58（插入位置）共用同一批语句，此处不重复。

---

## 6. 与系统方案的区别

| | 系统 `ItemTouchHelper` | Poweramp 自研 |
| --- | --- | --- |
| 是否存在 | 主包有该类，但**本项目零使用** | ✅ 完全自研 |
| 多选支持 | 需自己维护 | **内建 `n0.k` 数组** |
| 拖影 | 默认单 View | **每行独立场景对象**（`P`/`j`） |
| 动画 | `ItemAnimator` | 自研 `a2.х(bool,bool,bool,bool,float,float)`（`:3382`） |

> 自研的代价是 **3686 + 576 + 318 = 4580 行**；收益是能精确控制"多行一起拖"的视觉与落点。

---

## 7. 可借鉴 / 不建议照抄

### 7.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **单/多行用同一助手类，靠 `k` 是否为 null 区分** | 避免两套状态机 |
| A2 | **拖未勾选的行自动退化为单行** | 符合直觉 |
| A3 | **收集时排除锚点**（`i != anchor`） | 锚点单独渲染，不进批量数组 |
| A4 | **`already in transition` 前置守卫** | 防重入 |

### 7.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 4580 行自研拖拽 | 维护成本高，且无单元测试痕迹 |
| N2 | `Arrays.fill(arr, -1)` 后用 `-1` 作哨兵 | 与合法位置共用 int 域 |
| N3 | 单方法 `p0.B()` 超 1000 行 | 分支难以独立验证 |

---

## 8. 本轮新增解出（原 Q1 / Q3 部分）

### 8.1 ★ 排列数组 `n0.K` 的构造与交换（Q1 闭合）

`GridDragHelper` 构造时建两个长度相等的 int 数组（`n0:231-344`）：

```smali
selSize = adapter.X()                      ; 参与拖动的项数
K = new int[selSize]                       ; ★ 排列数组（位置 -> 索引）
H = new int[selSize]                       ; H = 各项原始位置序

if (multiMode && selArray != null && H != null) {
    n = 0; m = 0; anchorSlot = -1
    for (i = 0; i < selSize; i++) {
        if (i == anchorPos) anchorSlot = n;      ; 记录锚点在排列中的槽位
        if (selArray[i] != 0) {
            if (i == anchorPos) { continue; }    ; ★ 跳过锚点
            K[n++] = i;                          ; 收集非锚点选中项
            H[m++] = i;
        }
    }
    for (j = n; j < selSize; j++) K[j] = anchorPos; ; 末尾补锚点
    this.Р = anchorSlot;
} else {
    for (i = 0; i < selSize; i++) K[i] = i;      ; 单行：恒等排列
}
this.l = multiMode ? t1.A : selSize;        ; l = 拖动跟随的位置
```

**`n0.В(IZI)` 就是排列的相邻交换**（`n0:521-575`）：

```smali
.method public final В(IZI)V
    K = this.K
    if (p2 && |p1 - p3| > 1) {          ; 移动超过 1 格 → 逐步冒泡
        dir = (p1 < p3) ? 1 : -1
        :goto_0
        if (p1 == p3) return
        swap K[p1] <-> K[p1 + dir]      ; ★ 相邻交换
        p1 += dir
        goto :goto_0
    }
    swap K[p1] <-> K[p3]                ; 单格直接交换
}
```

| 语义 | 实现 |
| --- | --- |
| `K[i]` | 第 `i` 个“拖动槽位”当前承载的原始项索引 |
| 拖动时 | 每次跨过一行就调 `В(cur, anim, new)` 把排列向前/后旋转一格 |
| 落点 `n0.l` | 多选模式取 `t1.A`；单行取 `selSize`（构造 `n0:237-247`） |
| 锚点豁免 | 构造时把锚点排除出 `K` 前段，末尾单独补位 |

> 调用点共 4 处（`p0:813`、`:820`、`:2052`、`:2337`），每次都和
> `В.l(list, 位置, 目标, 是否循环)` 成对出现——**排列与视图变换必须同步**。

### 8.2 落点判定的驱动源（Q3 部分闭合）

`PowerList.S(Z)`（`:906-1000`）是落点同步器：

```smali
p0 = recyclerView.x; if (p0 instanceof MultiGridDragHelper) {
    n0 = p0.x                    ; 当前拖动会话
    src = (n0 == null) ? 0 : n0.l;    ; ★ 拖动跟随位置
}
if (d1 instanceof c1) src = ((c1) d1).Х(src);   ; 位置换算
t1.А = src;                                     ; 记录当前落点
if (selArray != null) {
    t1.A = src;
    selCount = t1.B;
    list.U(src, src == selCount, selCount);      ; ★ 提交
}
```

> **关键发现**：`p0` 内**没有任何滚动 API 调用**（`scrollBy` / `Scroller` 全为 0 命中）。
> 边缘自动滚动由底层 `PowerList`（继承自自研 `widget/list/` 体系）统一处理，
> 拖动框架只负责**上报当前位置**（`n0.l`），不自己滚。这是清晰的分层。

---
## 9. 未解 / 边界



| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~`n0.В(IZI)` 与 `k` 数组的重排~~ | ✅ **已闭合**（见 §8.1）：`В` 是排列的相邻交换/冒泡，`K` 构造时排除锚点并在末尾补位 |
| Q2 | `p0.у()` 收尾时**先把行号映射成 id 还是直接写 sort** | 只确认取 `n0.у` 后提交，映射细节未展开 |
| Q3 | 边缘自动滚动的**具体阈值** | ✅ 已确认 `p0` 内**零滚动调用**（分层：由 `PowerList` 统一滚），但阈值常量仍未定位 |

> **可继续但未做**：`p0.B()` 1000+ 行里还有"多行落点吸附""拖影跟随插值"等分支，
> 不影响"多选如何被收集与提交"这条主结论。

---

## 10. 证据索引

| 主题 | 位置 |
| --- | --- |
| 多选判定 | `widget/list/p0.smali:591-611` |
| 重入守卫 | `p0.smali:365-373`、`:410-412` |
| 选择模型字段 | `widget/list/t1.smali:6-26` |
| 锚点初值 -1 | `t1.smali:37-39` |
| 行号收集 | `p0.smali:1170-1218` |
| 批量视图构建 | `p0.smali:1236-1240` |
| 行助手字段 | `widget/list/n0.smali:6-84` |
| 密度换算 | `n0.smali:165-173` |
| 落点入口 | `n0.smali:521`（`В(IZI)`） |
| 收尾 | `p0.smali:3393`（`у()`） |
| 单/多行判空 | `widget/list/o0.smali:90-92` |
| 回调层 | `o0.smali:67`（`c0()`） |
| 动画调用 | `p0.smali:3382` |
| 系统类未使用 | 全库 `ItemTouchHelper` **0 命中** |
| 排列构造 | `widget/list/n0.smali:231-344` |
| 锚点豁免 | `n0.smali:275-291` |
| 末尾补锚点 | `n0.smali:313-319` |
| 恒等排列（单行） | `n0.smali:328-336` |
| 相邻交换 | `n0.smali:521-575` |
| 交换调用点 | `p0.smali:813 / 820 / 2052 / 2337` |
| 落点同步器 | `widget/list/PowerList.smali:906-1000` |
| 落点读取 | `PowerList.smali:950-959`（`n0.l`） |
| 提交 | `PowerList.smali:998` |
| 无滚动调用 | `p0.smali` 内 `scrollBy`/`Scroller` 均 0 命中 |

> 行号口径：**build-1025**。
