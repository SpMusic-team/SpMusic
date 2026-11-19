---
doc_id: "ARCH-POWERAMP-IMPL-IDEA15-CUSTOM-BUTTONS"
title: "已实现投票逐条逆向 #7：Customizable Player Screen Buttons（idea 15）"
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
  - ".rea-analysis/decoded/res/xml/ui_player.xml"
  - ".rea-analysis/smali/smali/com/maxmpz/{widget/player,audioplayer/preference}/**"
---

# 已实现投票逐条逆向 #7：Customizable Player Screen Buttons（idea 15）

> 投票原文：*"Ability to customize which buttons appear on the player screen and in what order"*。
> 属 **Feature Pack #1**——`ui_player.xml` 里相关条目全部标注 `w:featurePack="1"`。

## 0. 一句话结论

**按钮顺序 = 一个 `int[]`，按屏幕方向存两份；布局 = 一个 `int` 列数；编辑 = 长按空白处进入。**

| 概念 | 偏好键 | 类型 |
| --- | --- | --- |
| 竖屏按钮序列 | `sub_aa_buttons_port` | **`int[]`** |
| 横屏按钮序列 | `sub_aa_buttons_land` | **`int[]`** |
| 竖屏列数 | `sub_aa_buttons_layout_port` | `int` |
| 横屏列数 | `sub_aa_buttons_layout_land` | `int` |
| 竖屏行数 | `sub_aa_buttons_lines_port` | `int` |
| 横屏行数 | `sub_aa_buttons_lines_land` | `int` |
| 竖屏小按钮 | `sub_aa_buttons_small_buttons_port` | `bool` |
| 横屏小按钮 | `sub_aa_buttons_small_buttons_land` | `bool` |
| 无间隙 | `sub_aa_buttons_no_gap` | `bool` |
| 禁用长按编辑 | `sub_aa_buttons_no_lp_edit` | `bool` |

> **关键设计：竖屏/横屏各存一套**（9 个键里 6 个成对）。旋转屏幕不重排，而是换一整套。

---

## 1. 设置入口（`res/xml/ui_player.xml`）

```xml
<PreferenceCategory android:title="@string/player_screen_buttons">
    <RawTextPreference w:line1="@string/player_screen_buttons_desc"
                       w:line2="@string/player_screen_layouts_desc"
                       w:line3="@string/edit_player_screen_buttons_desc" />
    <EditButtonsRedirPref android:title="@string/edit_player_screen_buttons"
                         android:key="edit_player_screen_buttons" w:featurePack="1">
        <intent android:action="com.maxmpz.audioplayer.ACTION_OPEN_MAIN" />
    </EditButtonsRedirPref>
    <MultilineSwitchPreference android:key="sub_aa_buttons_no_gap"
                               w:summary="@string/summary_prefer_no_gap" w:featurePack="1" />
    <MultilineSwitchPreference android:key="sub_aa_buttons_no_lp_edit"
                               w:summary="@string/summary_sub_aa_buttons_no_lp_edit" w:featurePack="1" />
    <PaEditableButtonsRestorePref android:title="@string/restore_player_buttons" w:featurePack="1" />
</PreferenceCategory>
```

**设置页本身不含编辑器**——它只有一个"去编辑"的重定向项。

三行说明文案揭示了三种进入方式：

| 文案键 | 内容 |
| --- | --- |
| `player_screen_buttons_desc` | 按钮在封面下方，可横向滚动 |
| `player_screen_layouts_desc` | 布局按横竖屏分别保存 |
| `edit_player_screen_buttons_desc` | *"长按按钮之间空白处，或用下面的按钮"* |
| `long_press_between_buttons_to_edit` | 长按空白处编辑 |
| `hold_and_drag_buttons` | 按住拖动重排 |

---

## 2. 偏好注册（`widget/player/h0.smali:1349-1425`）

```smali
"sub_aa_buttons_port"                → h0.D0 : fastprefs/v   ; int[]  
"sub_aa_buttons_layout_port"         → h0.E0 : fastprefs/w   ; int    
"sub_aa_buttons_layout_land"         → h0.F0 : fastprefs/w   ; int    
"sub_aa_buttons_no_lp_edit"          → h0.G0 : fastprefs/h0  ; bool   
"sub_aa_buttons_small_buttons_port"  → h0.H0 : fastprefs/t   ; bool   
"sub_aa_buttons_small_buttons_land"  → h0.I0 : fastprefs/t   ; bool   
"sub_aa_buttons_lines_port"          → h0.L0 : fastprefs/w   ; int    
"sub_aa_buttons_lines_land"          → h0.M0 : fastprefs/w   ; int    
"sub_aa_buttons_land"                → h0.<...> : fastprefs/v ; int[] 
"sub_aa_buttons_no_gap"              → h0.P0 : fastprefs/h0  ; bool   
```

> 注意 `fastprefs/v` = **int[] 类型**（`:1349-1357`、`:1435`），
> `fastprefs/w` = int，`fastprefs/h0`/`t` = bool。**类型由注册方法决定**（`р`/`С`/`X`）。

---

## 3. 编辑入口的真实链路

### 3.1 从设置页跳转（`EditButtonsRedirPref.onClick` `:98-187`）

```smali
1. busAppCmd(0x7f0d015c).В(this, cmd_app_close_settings(0x7f0d02ef), 0, 0, null)
      → 先关掉设置界面
2. intent = getIntent();  intent.setPackage(context.getPackageName())
      → 包内定向 ACTION_OPEN_MAIN
3. context.startActivity(intent)
4. l1.В(runnable, delay)  where delay = (当前页 != 上次页) ? 0x1f4(500ms) : 0x96(150ms)
```

> **精细的时序设计**：先关设置、再启主页，中间留 150/500ms 让转场结束。
> 若当前已在主页则只用 150ms，否则 500ms——避免白屏或动画打架。

### 3.2 长按空白处

编辑模式由 `sub_aa_buttons_no_lp_edit`（默认 **false**）控制：
**该开关为 true 时才禁用长按编辑**。即默认允许长按编辑。

> 与文案 `long_press_between_buttons_to_edit` 一致：长按按钮之间空白处即进入编辑。

---

## 4. 恢复默认（`PaEditableButtonsRestorePref`）

继承 `EditableButtonsRestorePrefBase`，`restore(Map)` 逐个重置：

| 顺序 | 键 | 行 |
| ---: | --- | ---: |
| 1 | `sub_aa_buttons_port` | `:87` |
| 2 | `sub_aa_buttons_land` | `:100` |
| 3 | `sub_aa_buttons_layout_port` | `:113` |
| 4 | `sub_aa_buttons_layout_land` | `:126` |
| 5 | `sub_aa_buttons_small_buttons_port` | `:139` |
| 6 | `sub_aa_buttons_small_buttons_land` | `:152` |
| 7 | `sub_aa_buttons_lines_port` | `:165` |
| 8 | `sub_aa_buttons_lines_land` | `:178` |

只有一个 title（`restore_player_buttons` = *"Restore Player Screen Buttons"*）
和 question（`restore_player_buttons_q` = *"Restore player screen buttons to the defaults?"*）。

> 兄弟类 `PeqEditableButtonsRestorePref` 是均衡器的同款实现，
> 说明这套"可编辑按钮 + 恢复默认"是**通用模式**，播放界面与 EQ 各用一份。

---

## 5. Feature Pack 标记

`ui_player.xml` 里实测 **7 处** `w:featurePack="1"`：

| 行 | 元素 | key |
| ---: | --- | --- |
| 10 | `EditButtonsRedirPref` | `edit_player_screen_buttons` |
| 13 | `MultilineSwitchPreference` | `sub_aa_buttons_no_gap` |
| 14 | `MultilineSwitchPreference` | `sub_aa_buttons_no_lp_edit` |
| 15 | `PaEditableButtonsRestorePref` | （无 key） |
| 22 | `TagListPreference` | `menu_button_long_press` |
| 25 | `TagListPreference` | `line2_click` |
| 26 | `TagListPreference` | `line2_long_click` |

> 说明自定义按钮体系**整体属于付费 Feature Pack**，不是免费功能。
> 与 `changelog_978_fp`（Feature Pack 引入）对应。

---

## 6. 可借鉴 / 不建议照抄

### 6.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **按钮顺序存 `int[]` 而非分隔字符串** | 读取零解析，直接索引 |
| A2 | **横竖屏各存全套**（6 个成对键） | 旋转不改写用户布局 |
| A3 | **"编辑器不在设置页"**，用重定向 + 屏幕内直接编辑 | 所见即所得 |
| A4 | **转场延迟按"是否已在目标页"分档**（150/500ms） | 避免动画打架 |
| A5 | **恢复默认复用基类 + 键清单** | 播放界面与 EQ 共用一套 |
| A6 | **`no_lp_edit` 用否定命名** | 默认允许编辑，开关用于禁用 |

### 6.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | 10 个扁平偏好键，无统一前缀对象 | 增删按钮需同步改 8-10 处 |
| N2 | `int[]` 存按钮 id，无版本号 | 按钮 id 重排会导致老数据错位 |
| N3 | 设置页文案与真实入口分离 | 用户需读三行说明才知道怎么进 |

---

## 7. 按钮行在布局中的挂载与"加载式行为"

`layout-sw2dp/activity_main.xml` 第 60 行：

```xml
<com.maxmpz.widget.player.SubAAButtonsLayout android:id="@id/sub_aa_buttons"
                                            style="?TopSubAAButtons" />
```

紧随其后第 67 行是**编辑行为**：

```xml
<com.maxmpz.widget.player.LoadableDraggableButtonsBehavior
    android:id="@id/behavior_subaabuttons_edit"
    style="@style/behavior_subaabuttons_edit" />
```

### 7.1 `LoadableDraggableButtonsBehavior`（仅 68 行）

这个类**没有任何拖拽逻辑**，只是一个字段极简的中转器：

```smali
.class public final Lcom/maxmpz/widget/player/LoadableDraggableButtonsBehavior;
.super Lcom/maxmpz/widget/base/LoadableBehavior;
.implements Lcom/maxmpz/widget/base/p4;          ; 拖拽接口

.field public C:Lcom/maxmpz/widget/base/Shim;
.field public o:Lcom/maxmpz/widget/base/SceneFastLayout;

.method public final O0()Z                        ; 触发入口
    bus = MsgBusHelper.fromContextOrNoop(ctx, bus_gui(0x7f0d015d))
    bus.В(this, cmd_gui_end_button_edit(0x7f0d052a), 0, 0, null)
    return true;
}

.method public final А(Landroid/view/MotionEvent;)Z
    return false;                                  ; 不消费触摸
}
```

> **设计要点**：`LoadableDraggableButtonsBehavior` 干的是"**结束**编辑"这件事，
> 而不是开始。真实拖拽由 `SubAAButtonsLayout` 自己处理（见 §8.3），
> 这里只负责在合适的时机广播 `cmd_gui_end_button_edit` 通知全局退出编辑态。

### 7.2 编辑态场景

`SubAAButtonsLayout` 切编辑模式时用的资源 id **`0x7f0d0725` = `scene_alt`**（§8.1 的 `:3821`）。

| id | 名字 | 用途 |
| --- | --- | --- |
| `0x7f0d015d` | `bus_gui` | GUI 命令总线 |
| `0x7f0d052a` | `cmd_gui_end_button_edit` | 结束按钮编辑 |
| `0x7f0d0725` | `scene_alt` | 编辑态场景（按钮显示虚线/提示） |

---
## 8. 本轮新增解出（Q2 / Q3）

### 8.1 核心类 SubAAButtonsLayout（3882 行）

这不是普通容器，而是**自绘 + 自测量 + 自手势**的复合控件：

| 职责 | 方法 | 行 |
| --- | --- | ---: |
| 布局 | `onLayout` | 2195 |
| 测量 | `onMeasure` | 2742 |
| 绘制 | `onDraw` | 2038 |
| 手势 | `onInterceptTouchEvent` / `onTouchEvent` | 2157 / 2900 |
| 长按进编辑 | `performLongClick` | 3010 |
| 编辑模式切换 | `y1(Z)` 内 | 3811-3828 |
| 按钮列表 | `d0:ArrayList` | 64 |
| 去空后的列表 | `v1()` | 3339 |

编辑模式字段是 **`c0:Z`**，切换逻辑（`:3811-3828`）：

```smali
:3814  v0 = this.c0
:3816  if (v0 == 0) goto :goto_1
:3821  const v4, 0x7f0d0725        ; 编辑态额外资源
:3826  v0 ^= 1                     ; 取反
:3828  this.c0 = v0                 ; 写回
       ; 随后遍历 z:ArrayList 逐个更新子按钮外观
```

另一个状态位 `g0:Z`（`:2675-2705`）是**滚动位置只恢复一次**的标志：

```smali
if (!g0) {
    idx = isRtl ? h0.J0 : h0.K0;   ; 横/竖屏各自的滚动下标
    setScrollX(idx);
    g0 = true;
}
```

> 按钮行**可横向滚动**，滚动位置也分横竖屏存（`J0`/`K0`），
> 与文案 `player_screen_buttons_desc` 的 "optionally scrollable row" 对应。

### 8.2 布局版本用 sbuf ByteBuffer（Q2 部分闭合）

构造器开头（`:101`）：

```smali
v0 = prefs/А.В                  ; 全局 ByteBuffer
v2 = К.В(v0, 2)                 ; К.В(buf,i) = buf.getInt(i*4)
if (v2 < 1) v2 = v0.getInt(4);  ; 旧格式回退
if (v2 != 4) {                  ; 不是新版布局
    cols = isRtl ? h0.E0.А : h0.F0.А;   ; layout_port / layout_land
    this.V = (cols == 0);
}
```

`prefs/А.В` 来源链：

| 环节 | 位置 |
| --- | --- |
| `prefs/А.В` | `prefs/А.smali:25` |
| 取自 `prefs/B.C` | `prefs/А.smali:13-21` |
| `prefs/B.C` = 匿名 ByteBuffer 偏好 | `prefs/B.smali:143-153` |
| 键名 **`sbuf`** | `prefs/B.smali:51`（`getSbuf()` `:45`） |
| 序列化器 `data/aa/у`（4 项） | `prefs/B.smali:131-135` |

`К.В` 本体（`audioplayer/К.smali:38-48`）：

```smali
.method public static final В(Ljava/nio/ByteBuffer;I)I
    mul-int/lit8 p1, p1, 0x4     ; index * 4
    return p0.getInt(p1);        ; 定长 int 槽
}
```

> **`sbuf` 是"小整数配置块"**：一次读多个 int，免去为每个布局参数单独注册 fastpref。

### 8.3 拖拽重排与 idea 54 不是同一套（Q3 闭合）

| | idea 54（列表行） | idea 15（按钮行） |
| --- | --- | --- |
| 框架 | `widget/list/p0` MultiGridDragHelper | **`widget/base/SceneFastLayout` + `TouchHandler`** |
| 数据 | 数据库 `sort` 列 | 偏好 `int[]` |
| 手势 | 自研替代 ItemTouchHelper | `onInterceptTouchEvent` + `performLongClick` |
| 排序落点 | `n0.K` 排列数组 | `d0:ArrayList` 顺序 |

证据（`SubAAButtonsLayout`）：

| 行 | 内容 |
| ---: | --- |
| `:3013` | `Q` 字段是 `widget/base/i5`（手势持有者） |
| `:3023` | 转型为 `widget/base/b5` + `TouchHandler<*>` |
| `:2920` | `X.Х(MotionEvent)` 返回事件码 |
| `:2157` | 自实现 `onInterceptTouchEvent` |

> **结论：两套拖拽互不复用。** 列表用 `widget/list/*`，按钮行用 `widget/base/*`。
> 这解释了为何 idea 54 的 `MultiGridDragHelper` 里找不到按钮相关代码。

---
## 9. 本轮新增解出（Q1：按钮 id 枚举的去向）

### 9.1 结论：没有"按钮 id 常量表"

我原本假设存在一张 `int[]` 常量枚举表（如 `{0x7f0d0001, 0x7f0d0002, ...}`），
**实测不存在**。真正的事实是：

> **按钮 = 布局里的子 View，id 由 XML 定义，顺序由 `int[]` 偏好记录这些 id。**

证据链：

| 环节 | 位置 | 内容 |
| --- | --- | --- |
| 1 | `layout-sw2dp/activity_main.xml:60` | `SubAAButtonsLayout` 挂载 |
| 2 | `SubAAButtonsLayout.smali:64` | `d0:ArrayList` 存**子 View**（非 id） |
| 3 | `SubAAButtonsLayout.smali:1286/1304` | `ViewGroup.getChildAt(i)` 取子 View |
| 4 | `SubAAButtonsLayout.smali:1343/1747/3646` | `View.getId()` 读按钮 id |
| 5 | `DraggableSourceBehavior.smali:1886` | `layout.v1()` 拿去空后的按钮列表 |

即 `int[]` 偏好里的每个 int **就是一个 View 的资源 id**，
渲染时按数组顺序排列子 View，编辑时按拖动结果写回新数组。

### 9.2 为什么这比"常量表"更好

| 优点 | 说明 |
| --- | --- |
| 零硬编码 | 新增按钮只需在布局加一个子 View，不必改 Java 常量表 |
| id 天然唯一 | 直接复用 Android 资源 id 空间（`R.id.*`） |
| 快速查找 | `findViewById(id)` 即可定位，无需维护 id→View 映射 |

### 9.3 真正的拖拽实现在 `DraggableSourceBehavior`（2199 行）

这是本轮最重要的定位修正。`LoadableDraggableButtonsBehavior`（68 行）只是空壳，
**真身是 `DraggableSourceBehavior`**：

| 方法 | 行 | 职责 |
| --- | ---: | --- |
| `<init>` | 54 | 取 `FastLayout` 容器 |
| `B()` static | 211 | 拖拽动画辅助 |
| `onLongClick` | 888 | **长按进入拖拽** |
| `onTouch` | 1016 | 触摸跟踪 |
| `А(View,View)` | 692 | 拖拽目标判定 |
| `А()` | 1875 | **提交新顺序**（遍历 `layout.v1()`） |
| `В(view,view,ZZ)` | 1983 | 拖影渲染（Bitmap + translationX/Y） |
| `onViewAttachedToWindow` | 1140 | 挂载时初始化 |

提交逻辑（`:1875-1979`）：

```smali
А():
    B(this)                                  ; 先做动画收尾
    layout = this.y                          ; SubAAButtonsLayout
    if (layout == null) return
    views = layout.v1()                      ; 去空后的按钮 View 列表
    for (i = 0; i < views.size(); i++) {
        v = views.get(i)
        memo = (g) v.getTag(_clickable_memo) ; 0x7f0d01d6
        if (memo != null) {
            v.setOnLongClickListener(null)
            v.setClickable(memo.В)
            v.setLongClickable(memo.B)
            v.setTag(_clickable_memo, null)  ; 清理备忘
        } else {
            Log("!View button=" + v)
        }
    }
```

> **`_clickable_memo`（`0x7f0d01d6`）是编辑态的"可点击性暂存"**：
> 进入编辑时把每个按钮的 clickable/longClickable 存成 `widget/player/g` 对象挂到 tag 上并禁用，
> 退出编辑时按备忘**精确还原**。这是比"统一设 false 再统一设 true"更严谨的做法——
> 因为不同按钮原本的可点击性可能不同（如某些按钮本身不可点）。

### 9.4 拖影渲染细节（`:1983-2080`）

```smali
В(child, container, z1, z2):
    pChild = AUtils.e(child, PointF)       ; 子按钮全局坐标
    pCont  = AUtils.e(container, PointF)   ; 容器全局坐标
    影子 = new View(ctx)
    影子.layoutParams = b1(bmp.width, bmp.height)
    影子.lp.X = 0x33                       ; 布局选项
    影子.translationX/Y = 相对位移
    影子.background = BitmapDrawable(bmp)  ; 用截图像素做拖影
```

> 拖影不是"复制一个按钮控件"，而是**截屏成 Bitmap 再做成 Drawable**——
> 保证拖影与按钮外观 100% 一致，且不受按钮自身动画/状态影响。

---
## 10. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~按钮 id 完整枚举~~ | ✅ **已闭合**（§9.1）：**不存在常量表**——按钮即布局子 View，`int[]` 存的就是 `View.getId()` |
| ~~Q2~~ | ~~列数取值域~~ | ✅ **部分闭合**（§8.2）：值取自 `sbuf` 的 `getInt(2)`，`!=4` 时回退到 `h0.E0/F0` |
| ~~Q3~~ | ~~拖拽重排落点~~ | ✅ **已闭合**（§8.3）：与 idea 54 **互不复用**，按钮行走 `widget/base/*` 手势体系 |

> Q3 值得注意：本条与 idea 54（多选拖动）都涉及"排序"，
> 但一个是**偏好里的数组**、一个是**列表行的位置**，可能共用 `widget/list/p0` 也可能各写一套。

---

## 11. 证据索引

| 主题 | 位置 |
| --- | --- |
| 设置页 | `1025/decoded/res/xml/ui_player.xml`（36 行；按钮分类 `:8-16`） |
| 偏好注册 | `widget/player/h0.smali:1349-1425` |
| int[] 类型 | `h0.smali:1349-1357`（`sub_aa_buttons_port`）、`:1435`（`sub_aa_buttons_land`） |
| PropertyReference | `h0.smali:230-252`（`getSub_aa_buttons_port/land()[I`） |
| 编辑跳转 | `audioplayer/preference/EditButtonsRedirPref.smali:98-187` |
| 恢复默认 | `audioplayer/preference/PaEditableButtonsRestorePref.smali:87-178` |
| 基类 | `preference/EditableButtonsRestorePrefBase.smali` |
| ACTION_OPEN_MAIN 处理 | `widget/player/o2.smali:5266`（sswitch_7 → case 0） |
| 核心控件 | `widget/player/SubAAButtonsLayout.smali`（3882 行） |
| 编辑模式字段 | `SubAAButtonsLayout.smali:60`（`c0:Z`），切换 `:3811-3828` |
| 滚动位置 | `SubAAButtonsLayout.smali:2675-2705`（`g0:Z`，`h0.J0/K0`） |
| sbuf 读取 | `SubAAButtonsLayout.smali:101-105`（`К.В(prefs/А.В, 2)`） |
| sbuf 定义 | `prefs/B.smali:45/51/131-153`（`getSbuf()` / `sbuf` / `data/aa/у`） |
| `К.В` | `audioplayer/К.smali:38-48`（`getInt(i*4)`） |
| 真实拖拽实现 | `widget/player/DraggableSourceBehavior.smali`（2199 行） |
| 长按进入 | `DraggableSourceBehavior.smali:888`（`onLongClick`） |
| 提交顺序 | `DraggableSourceBehavior.smali:1875-1979`（`А()`） |
| 拖影渲染 | `DraggableSourceBehavior.smali:1983-2080`（`В(view,view,ZZ)`） |
| 可点击性备忘 | `_clickable_memo` = `0x7f0d01d6`，`widget/player/g` 存两布尔 |
| 按钮即子 View | `SubAAButtonsLayout.smali:1286/1304`（`getChildAt`）、`:1343/1747/3646`（`getId`） |
| 消息 id | `cmd_app_close_settings`=`0x7f0d02ef`、`bus_app_cmd`=`0x7f0d015c`、属性 `sub_aa_buttons`=`0x7f0d001f` |

> 口径：**build-1025**。
