---
doc_id: "ARCH-POWERAMP-ROW-POPUP-COVER"
title: "Poweramp 行选中弹窗封面参考（行视图复用 + 场景切换）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
revision: 1
created: "2026-11-17"
updated: "2026-11-18"
source_documents:
  - "user request: 歌曲/文件夹/专辑等作为列表项被选中时，弹窗中的图像或专辑封面如何组织和实现"
  - ".rea-analysis/Poweramp-v3.apk :: com.maxmpz.audioplayer build-1025-uni (1025009)"
  - ".rea-analysis/smali/smali/com/maxmpz/**（apktool 反汇编）"
  - ".rea-analysis/decoded/res/**（layout / layout-sw2dp / values）"
  - "docs/architecture/poweramp-list-options.md（同族弹窗的入口与菜单机制）"
  - "docs/architecture/poweramp-album-art-picker.md（封面数据层：aa_status / AAResolver / 优先级）"
---

# Poweramp 行选中弹窗封面参考（行视图复用 + 场景切换）

## 0. 定位与证据分级

**本文记录外部实现 Poweramp 的「列表项选中弹窗」中封面（专辑图片 / 分类图标）的组织方式，不是 SpMusic 现状。**

| 标记 | 含义 | 可信度 |
| --- | --- | --- |
| **【实证·smali】** | 反汇编 smali 原文 | 最高 |
| **【实证·原文】** | 布局 XML / styles.xml / public.xml 原文 | 高 |
| **【推断】** | 本文作者推理 | 低 |

### 0.1 一句话结论

**弹窗里没有独立的封面控件——它是把被点击的那一行视图整个"搬"进浮层，行自带的封面控件随之原样显示。**

也就是说：封面不是"弹窗画的"，而是"行带进来的"。这解释了为什么弹窗封面与列表行封面**尺寸档位不同但图像完全一致**。

### 0.2 关键机制：物理移入，不是截图也不是重建

```java
// widget/base/p2.smali:1032-1058
placeholder.removeViewInLayout(rowView);   // 从列表原位移除
rowView.setScaleX(...); rowView.setScaleY(...);
popupLayer.addView(rowView, params);       // 加入浮层
```

**同一 View 实例**被 `removeViewInLayout` → `addView` 迁移，因此：

- 所有子控件（封面、标题、序号、元数据）保持原有状态
- 无需重新加载位图——**封面位图直接复用**，零额外解码
- 关闭弹窗时再逆向迁回原位置

### 0.3 两条行类型，两套图像控件

| 行类型 | 布局 | 图像控件 | 弹窗中显示 | 弹窗菜单布局 |
| --- | --- | --- | --- | --- |
| **曲目行**（歌曲/队列项/**专辑详情内的歌曲**） | `item_track.xml` | `AAImageView id=@id/aa_image` (0x7f0d0014) + `CatImage id=@id/cat_image` (0x7f0d001c) | **专辑封面 88~120dp**（圆角+阴影） | `merge_menu_items_tracks` |
| **分类行**（专辑/文件夹/艺术家/流派/年份/播放列表） | `item_text.xml` | `IconView id=@id/aa_image`（同 id，不同类） | **分类图标 44dp**（无圆角、无阴影） | `merge_menu_items_lib` |

> 两者**共用 `@id/aa_image`**，但控件类不同：`AAImageView`（74 KB，真正的位图控件）vs `IconView`（1.7 KB，基类 `FastTextView`，只设 drawable）。
>
> **关键**：用户看到"专辑弹窗里有大封面"时，那是**专辑详情页里的歌曲行**（曲目行）；而在**专辑列表页**点专辑行，看到的是 44dp 图标。实机截图已验证这一区别（§3.7）。

**共同点**：两者的图像都**不是弹窗自己画的**，而是随被复用的行视图一起进入浮层。两个菜单布局里都**没有任何图像控件**（§1.3 / §3.5）。

---

## 1. 弹窗的物理结构

### 1.1 弹层宿主

`widget/base/MenuPlaceholderLayout`（`super SceneFastLayout`）承载整个浮层，持有 `p2`（`w` 字段）作为调度器。

`p2.А(View, int, int, int, boolean, boolean, float, float, Object, f)`（`:686-1180`）是唯一的入口：

| 步骤 | 行 | 动作 |
| --- | --- | --- |
| ① | `:726-760` | 创建**遮罩层** `NonOverlappingView`：背景色、`LayerType=2`（HARDWARE）、可点击、`visibility=GONE` 占位 |
| ② | `:764-768` | 包成 `SceneParams(z3)`，`А(0)` 设为默认场景 |
| ③ | `:1028` | `e4.B(...)` 应用场景参数 |
| ④ | `:1030` | `g0.х(rowView)` —— 保存原布局参数 |
| ⑤ | `:1032` | **`removeViewInLayout(rowView)`** —— 从列表原位摘除 |
| ⑥ | `:1036-1056` | 记录并设置 `scaleX`/`scaleY`（缩放动画起点） |
| ⑦ | `:1058` | **`addView(rowView, params)`** —— 加入浮层 |
| ⑧ | `:1083` | 若需占位，在列表原位插入占位视图 |
| ⑨ | `:1106` | 菜单布局加入 |

### 1.2 场景切换：`scene_item_menu`

行视图被移入后切换到 **`scene_item_menu`**（0x7f0d013c）或 **`scene_item_menu_lu`**（0x7f0d0299，详见 `poweramp-list-options.md` §1.8：由 `rating_type != 0` 决定）。

场景切换会让行内**每个子控件**按 `SceneParams` 重新套用样式——包括封面控件的尺寸、圆角、可见性。

### 1.3 菜单布局里没有封面

`res/layout-sw2dp/merge_item_popup_menu.xml` 的全部内容：

```xml
<merge>
  <SceneParams forId="parent" scene="@id/scene_item_menu" scene_2="@id/scene_item_menu_lu" .../>
  <InvisibleView id="@id/spacer"/>
  <SceneParams scene="@id/scene_item_menu" baseScene="defaultScene"/>
  <SceneParams scene="@id/scene_item_menu_lu" style="?ItemPopupMenuTopSpacer_scene_item_menu_lu"/>
  <FastLayout id="@id/menu_items">
      <NonOverlappingView id="@id/separator"/>
  </FastLayout>
  <!-- 其余为若干 SceneParams 可见性规则 -->
</merge>
```

**没有任何 `ImageView` / `AAImageView` / `CatImage`。** 只有 `spacer`、`menu_items`（菜单项容器）、`separator`。

> **推论（强）**：用户在弹窗中看到的封面，**100% 来自被复用的行视图**，弹层本身不提供封面。这与 §0.1 的结论相互印证。【实证·原文】

---

## 2. 曲目行的封面：`AAImageView` + `CatImage`

### 2.1 两个控件并存的原因

`item_track.xml` 同时含两个图像控件：

| 控件 | id | 角色 | 实现规模 |
| --- | --- | --- | --- |
| `AAImageView` | `@id/aa_image` | **专辑封面**（位图） | 74 KB，`super View` |
| `CatImage` | `@id/cat_image` | **分类字形/图标**（可抑制） | 41 行，`super FastTextView` |

### 2.1.1 `AAImageView.E0` vs `IconView.E0`（同名方法，语义相反）

两个控件都实现 `widget/list/P.E0(Bitmap, int, boolean)`，但实现完全不同：

| | `AAImageView.E0`（`:1344-1400`） | `IconView.E0`（`:28-45`） |
| --- | --- | --- |
| bitmap 参数非空 | **直接使用该 bitmap** | **忽略** |
| bitmap 为空 | 回退：`getDrawable(resId)`，仅当是 `BitmapDrawable` 时取其 bitmap；否则不显示 | 回退：`a0(resId)` 设字形 |
| 适用 | 曲目行（真封面） | 分类行（图标） |

```java
// AAImageView.E0 核心
Bitmap bmp = p1;
if (bmp == null && p2 != 0) {
    Drawable d = ctx.getDrawable(p2);
    if (d instanceof BitmapDrawable) bmp = ((BitmapDrawable) d).getBitmap();
}
if (bmp == null) bmp = null;      // 无图可显示
// 后续按 bmp 做圆角/elevation 绘制
```

⇒ **同名接口方法，一个吃位图、一个只吃资源 id**——这是"同 id 多态"设计最隐蔽的代价（§6.2 N1）。

```java
public final class CatImage extends FastTextView {
    public boolean x0;                          // 唯一的字段

    @Override public final void onDraw(Canvas c) {
        if (x0) return;                          // ← x0=true 则不绘制
        super.onDraw(c);
    }
    public final boolean v0() { return x0; }
}
```

**它本身不含任何业务逻辑**，只是给 `FastTextView` 加了一个"可跳过绘制"的开关。

开关由 `AAItemView`（`:530-557`）按数据决定：

```java
CatImage ci = this.J;
if (v3 == null && v4 == null) {          // 无分类图标数据
    ci.setText(""); ci.t(null, 0);
    ci.x0 = true;                        // 抑制绘制
} else {
    ci.р(CharSequence); ci.v(int);       // 设字形与颜色
    ci.x0 = false;                       // 正常绘制
}
```

⇒ **`CatImage` 负责"分类图标"这条正交信息**（这一行属于哪个类别），与 `AAImageView` 的"专辑封面"互不替代；弹窗场景下由样式置 `gone`（§2.2）。

### 2.2 弹窗场景下的可见性（决定性差异）

| 控件 | 弹窗场景样式 | 结果 |
| --- | --- | --- |
| `aa_image` | `?ItemTrackAAImage_scene_item_menu` | **`visibility: visible`** |
| `cat_image` | `?ItemTrackCatImage_scene_item_menu` → **`@style/ItemTrackCatImage_gone`** | **`visibility: gone`** |

`ItemTrackCatImage_gone`（`styles.xml:11611`）：

```xml
<style name="ItemTrackCatImage_gone">
  <item name="android:layout_gravity">right|top</item>
  <item name="android:visibility">gone</item>
  <item name="android:layout_width">wrap_content</item>
  <item name="android:layout_height">wrap_content</item>
  <item name="applyEvenIfGone">true</item>
</style>
```

⇒ **弹窗里只显示专辑封面（`aa_image`），分类图标（`cat_image`）被隐藏。** 这是"为什么弹窗里看到的是封面而不是图标"的直接原因。【实证·原文】

### 2.3 弹窗封面的尺寸档位

`ItemTrackAAImage_scene_item_menu`（`styles.xml:4479`）：

```xml
<style name="ItemTrackAAImage_scene_item_menu">
  <item name="android:visibility">visible</item>
  <item name="android:layout_width">@dimen/ItemTrackAAImage_scene_item_menu_size</item>
  <item name="android:layout_height">@dimen/ItemTrackAAImage_scene_item_menu_size</item>
  <item name="android:layout_marginLeft">@dimen/ItemTrackAAImage_scene_item_menu_marginTBL</item>
  <item name="android:layout_marginTop">@dimen/ItemTrackAAImage_scene_item_menu_marginTBL</item>
  <item name="android:layout_marginRight">@dimen/ItemTrackAAImage_scene_item_menu_marginR</item>
  <item name="android:layout_marginBottom">@dimen/ItemTrackAAImage_scene_item_menu_marginTBL</item>
  <item name="android:elevation">?list_aa_elevation</item>
  <item name="cornerRadius1">?corners_aa_tracks_menu</item>
  <item name="cornerRadius2">?corners_aa_albums_menu</item>
  <item name="cornerRadius3">?corners_aa_other_menu</item>
  <item name="hiRes">false</item>
</style>
```

关键点：

- **`cornerRadius1/2/3` 三档** —— 按条目类型（曲目/专辑/其他）分别取圆角主题值
- **`hiRes = false`** —— 弹窗封面**不请求高清**（复用列表中已有的低清缩略图，省内存）
- 与列表场景共用 `elevation`（`?list_aa_elevation`）

### 2.4 尺寸随屏幕档位自适应

`@dimen/ItemTrackAAImage_scene_item_menu_size` 在四套资源中不同：

| 资源目录 | 尺寸 |
| --- | --- |
| `values`（默认） | **88.0dp** |
| `values-sw360dp-h600dp-port` | **104.0dp** |
| `values-sw600dp-large` | **108.0sp** |
| `values-sw800dp-h800dp-xlarge` | **136.0sp** |

对应边距：默认 `marginTBL=8dp` / `marginR=2dp`；高屏 `16dp` / `6dp`。

> 注意大屏用 `sp`（随字体缩放），小屏用 `dp`——这是 Poweramp 的有意选择。【实证·原文】

### 2.5 `_lu` 变体

`ItemTrackAAImage_scene_item_menu_lu`（`styles.xml:11280`）**完全继承**基础样式：

```xml
<style name="ItemTrackAAImage_scene_item_menu_lu" parent="@style/ItemTrackAAImage_scene_item_menu" />
```

⇒ `_lu` 场景（`rating_type != 0`）**封面尺寸与基础弹窗完全一致**，差异只在行内文字/元数据的排版（详见 `poweramp-list-options.md` §1.8）。

---

## 3. 分类行的封面：`IconView`

### 3.1 同一 id，不同控件类

`item_text.xml:4`：

```xml
<com.maxmpz.widget.player.list.IconView android:id="@id/aa_image" style="?ItemTextAAImage" />
```

**注意**：这里复用了 `@id/aa_image` 这个 id，但控件类是 `IconView` 而非 `AAImageView`。

【实证·smali】设计基础是 **`widget/list/P` 接口**（`widget/list/P.smali:1-45`，仅 922 B）：

```java
public interface P {
    void  C0(bitmaps/А, int, long, int, int);   // 异步加载绑定
    void  E0(Bitmap, int, boolean);             // 位图/图标设置
    int   I();
    void  J();
    void  o();
    void  r0();
    long  В();
}
```

| 控件 | 实现 `P` | 体积 | 基类 |
| --- | --- | --- | --- |
| `AAImageView` | **是** | 74 KB | `android.view.View` |
| `IconView` | **是** | 1.7 KB | `widget/base/FastTextView` |
| `CatImage` | 否 | — | — |

`AAItemView.onFinishInflate()`（`:976-1006`）按 **id `0x7f0d0014`** 查找并统一转成 `widget/list/P` 存入字段 `D`：

```java
if (child.getId() == 0x7f0d0014 /* @id/aa_image */) {
    this.D = (widget/list/P) child;      // 多态，不关心具体是 AAImageView 还是 IconView
}
```

⇒ **同 id 不同类是本设计的核心**：所有绑定代码只依赖接口，两种行类型共用一套绑定逻辑。代价见 §6.2 N1。【实证·smali】

### 3.2 `IconView` 的实际职责：图标，不是封面

`IconView.E0(Bitmap, int, boolean)`（`IconView.smali:28-45`）：

```java
public void E0(Bitmap bmp, int resId, boolean flag) {
    if (resId != 0) {
        FastTextView.a0(resId);     // getDrawable(resId) → 设为 TextView 的 drawable
        return;
    }
    FastTextView.t(null, 0);        // 清空
}
```

**它完全忽略传入的 `Bitmap` 参数。** 而 `IconView.C0(...)`（`:22-26`）是**空实现**（直接 `return`）。

**关键佐证**：`TextItemView.L0(...)`（绑定方法）调用时，第一个实参恒为 `null`：

```java
// TextItemView.smali:121-127
widget/list/P p = this.D;
p.E0(null /* ← 恒为 null！ */, p6 /* 图标 resId */, false);
```

即**分类行的图像槽只承载"图标资源 id"，从不承载位图**。【实证·smali】

### 3.3 分类行（含专辑）在弹窗里显示的是图标，不是封面大图

`ItemTextAAImage` 的尺寸与外观证实这一点：

| 属性 | 列表（基础） | 弹窗场景 |
| --- | --- | --- |
| 宽高 | **36dp** | **44dp** |
| `cornerRadius1` | `0.0dp` | （继承） |
| `elevation` | `0.0px` | （继承） |
| `drawableOnly` | `true` | — |

对比曲目行弹窗封面 **88dp 起、带圆角与 2dp 阴影**（§2.3）——两者规格差异悬殊，说明分类行的图像槽定位是"小图标"。

> **结论修正**：**专辑 / 文件夹 / 艺术家等分类行，其弹窗中显示的是 44dp 分类图标，而不是专辑封面大图。** 只有**曲目行**（`item_track.xml` / `AAImageView`）在弹窗中显示 88dp+ 的专辑封面。
>
> 若用户在专辑行弹窗里看到的是封面，那属于 **grid 场景**（`ItemTextAAImage_scene_grid`）或该行的封面由 `AAItemView` 的其它绘制路径提供，需进一步验证。【推断，见 §7 P1】

### 3.4 `IconView` 的图标来源

两处 `z1(...)` 调用（`TextItemView:320-364` 的 `Drawable` 版本）都不是分类封面：

| 调用点 | 场景 | Drawable 来源 |
| --- | --- | --- |
| `list/provider/O.smali:291` | 歌词行 | `data/lyrics/Н.А` |
| `widget/P.smali:392` | **Cast 设备选择** | `androidx/mediarouter/media/q` 设备图标 |

分类行真正的图标 id 由列表 provider 通过 `e0.L0(...)` 的 `p6` 参数传入（`TextItemView:53` 签名中的第 6 个 int）。

### 3.5 弹窗场景

分类行的弹窗布局是 **`merge_item_text_popup_menu.xml`**（`item_text.xml:34` 的 `behavior_menu`），与曲目行不同：

```xml
<merge>
  <SceneParams forId="parent" scene="@id/scene_item_menu" scene_2="@id/scene_item_menu_lu" style="?ItemPopupMenu_scene_item_menu"/>
  <InvisibleView id="@id/spacer" style="?ItemTextPopupMenuTopSpacer"/>
  <FastLayout id="@id/menu_items" style="?ItemTextPopupMenuItemsLayout">
      <NonOverlappingView id="@id/separator" style="?ItemPopupMenuSeparator"/>
  </FastLayout>
  <SceneParams scene="@id/scene_bottom_toolbar" visibility="gone"/>
</merge>
```

同样**不含任何图像控件**——分类行的图像同样来自被移入的行视图。【实证·原文】

### 3.6 viewType → 布局分派（决定性证据）

`widget/app/A.о(I)`（`:477-586`）把 viewType 映射为布局：

| 传入 `p1` | 布局 |
| --- | --- |
| `_item_type_track` 0x7f0d0140 | **`item_track.xml`**（0x7f04007d，`AAImageView`） |
| `_item_type_text` 0x7f0d0143 | **`item_text.xml`**（0x7f04007a，`IconView`） |
| `_item_type_separator` 0x7f0d0141 | 0x7f040077 |
| `_item_type_basic_header` 0x7f0d0142 | 随机色 `NonOverlappingView`（占位） |
| **其他** | **把 `p1` 直接当 layout id 用**（`cond_3`，`:561-565`） |

#### 各 provider 的 `o(I)` 返回值（index ≥ 0）

| provider | 返回 | 用于 |
| --- | --- | --- |
| `B` / `P` / `А` / `В` / `Н` / **`Р`** | `_item_type_track` | 曲目类 |
| **`О`** | **`_item_type_text`** | **专辑（`j.smali:164` 创建）** |
| `C` / `d` / `K` / `O` | 走 super / 复杂分支 | — |

> **注意**：`provider/О`（西里尔 U+041E，261 行）与 `provider/O`（拉丁 U+004F，424 行）是**两个不同类**，容易混淆。

### 3.7 初版矛盾已解：两类页面各有各的弹窗

初版曾记录「静态分析指向 `item_text`+`IconView`，实机却见 120dp 封面」的疑点。**两张新实机截图解开了它——那是两个不同页面层级。**

#### 决定性观察（同一个专辑条目，两个上下文）

| | 截图 A（19:34:43） | 截图 B（19:34:48） |
| --- | --- | --- |
| 弹窗头部 | 44dp **分类图标** + 专辑名 | **120dp 圆角封面** + 专辑名 + 艺术家 + `1 \| 4:59 \| 2014` |
| 菜单项 | 选择文件夹 / 重新扫描 / 加入桌面 / 列表选项（**4 项**） | 选择文件夹 / 重新扫描 / **专辑封面** / 加入桌面 / 列表选项（**5 项**） |
| 菜单布局 | **`merge_menu_items_lib.xml`** | **`merge_menu_items_tracks.xml`** |
| 触发页面 | **专辑列表页 `j`** | **曲目类页面 `z0` / `у`** |

#### 验证一：菜单项数量与布局精确对应

| 布局 | 可见项 | 含 `album_art` |
| --- | --- | --- |
| `merge_menu_items_lib.xml` | 4（select_folders / pref_rescan_folders / add_to_launcher / list_opts） | **无** |
| `merge_menu_items_tracks.xml` | 11（album_art / delete_dups / resort / add_url / clear_q / show_all / clear 等） | **有** |

截图 A 的 4 项 = `lib`；截图 B 的「专辑封面」= `tracks` 的 `album_art`。完全吻合。

#### 验证二：页面类的 `n([I)Z` 返回不同布局

| 页面类 | 菜单布局 | provider | 行布局 | 弹窗图像 |
| --- | --- | --- | --- | --- |
| 专辑列表页 `j` | `merge_menu_items_lib` (0x7f0400ba) | `provider/О` → `_item_type_text` | **`item_text.xml`** | 44dp 图标 |
| 曲目页 `z0` / `у` | `merge_menu_items_tracks` (0x7f04008d) | track provider → `_item_type_track` | **`item_track.xml`** | **120dp 封面** |

#### 结论

**矛盾不存在。** 两张截图是不同层级：

- **截图 A = 专辑列表页**（`j`）：行代表"一个专辑"，弹窗头显示 44dp 分类图标，菜单无「专辑封面」
- **截图 B = 专辑详情页内的曲目行**（`z0`/`у`）：行代表"一首歌"，弹窗头显示 120dp 专辑封面，菜单有「专辑封面」

120dp 恰为 `ItemTrackAAImage_scene_zoomed` 的宽高，数字精确吻合。

#### `album_art` 项的显示条件

`z0.d0(v0, ViewGroup)`（`:501-561`）动态控制：

```java
x2 k0 = entity.k0();
if (k0 instanceof m1 && !(k0 instanceof b2)) {
    album_art.setText(@string/art_image);   // "Image"
    album_art.setVisibility(VISIBLE);
} else {
    album_art.setVisibility(GONE);
}
```

| 实体 | `m1` | `b2` | `album_art` |
| --- | --- | --- | --- |
| 曲目（`p0` 等） | ✓ | — | **显示 "Image"** |
| 专辑（`l`→`j`） | ✓ | — | 显示 |
| 艺术家（`w`） | ✓ | **✓** | **隐藏** |
| 作曲家（`d0`） | ✓ | **✓** | **隐藏** |
| 流派（`z0`） | ✓ | — | 显示 |

> `b2` 实现者：`d0`、`e0`、`f`、`f0`、`g`、`g0`、`u`、`w`、`z`、`С`——这些分类**没有**「专辑封面」项。
>
> 另注：`z0` 同时是**曲目页基类名**与**流派实体名**（不同包），此处指页面类 `list/z0`。

#### 弹窗头部文本的构成（截图 B 的 `1 | 4:59 | 2014`）

截图 B 弹窗头部的三行文本全部来自**同一行视图**的三个子控件，在 `scene_item_menu` 场景下均可见：

| 控件 | id | 弹窗样式 | 内容 |
| --- | --- | --- | --- |
| `MarqueeFastTextView` | `@id/title` | `ItemTrackTitle_scene_item_menu`（visible） | 专辑名 |
| `MarqueeFastTextView` | `@id/line2` | `ItemTrackLine2_scene_item_menu`（visible） | 艺术家 |
| `FastTextView` | `@id/meta` | `ItemTrackMeta_scene_item_menu`（visible） | `1 \| 4:59 \| 2014` |

`meta` 的拼接逻辑在 `AAItemView.L0(...)`（`:320` 签名，`:397-461` 拼接）：

```java
StringBuilder sb = utils/t.K;        // 复用静态 builder
if (num > 0) {
    sb.append(num);
    if (num2 > 0) sb.append(" / ").append(num2);       // 碟片/音轨
    if (duration != null && duration.length() > 0)
        sb.append(" | ").append(duration);             // "4:59"
} else if (num2 > 0) {
    sb.append(num2);
    if (duration != null && duration.length() > 0)
        sb.append(" | ").append(duration);
} else {
    meta.setText(duration);
}
```

`" | "` 分隔符硬编码于 `:397`。

绑定入口唯一：`list/provider/B.c(...)`（`:164`）调用 `AAItemView.L0(...)`，参数取自行条目 `list/х`：

| `list/х` 字段 | 类型 | 用途 |
| --- | --- | --- |
| `с`（西里尔） | `int` | 传入 `num` |
| `c`（拉丁） | `String` | 传入 `duration` 或元数据片段 |

> 两个字段名仅大小写/编码不同（拉丁 `c` vs 西里尔 `с`），与 `j2.А`/`j2.A` 属同类混淆陷阱。

---

## 4. 第三种入口：多选工具栏的「图像」

用户第二张截图显示的是**多选模式工具栏**底部有一个「图像」按钮，点击后打开的就是 `SelectAlbumArtActivity`（封面选择器）。

### 4.1 多选工具栏的组成

`res/layout-sw2dp/merge_selection_menu_list_items_w_aa.xml`：

```xml
<merge>
  <include android:layout="@layout/merge_selection_menu_list_base_items" />
  <BusStateEnabledActionButton
      android:text="@string/art_image"          <!-- "Image" -->
      android:drawable="?album_art"
      w:msgId="@id/cmd_list_album_art"
      w:stateId="@id/state_list_one_item_selected"    <!-- 仅单选可用 -->
      w:stateMsgId="@id/state_list_selection_count"
      style="?SelectionListContextButton" />
</merge>
```

基础项（`merge_selection_menu_list_base_items.xml`）依次为：

| 按钮 | `msgId` | 启用条件 |
| --- | --- | --- |
| 播放列表（含插入位置子菜单） | `cmd_list_add_to_pl_dialog` | `state_list_something_selected` |
| 队列 | `cmd_list_add_to_q` | 同上 |
| 下一首播放 | `cmd_list_add_as_next_to_q` | 同上 |
| 删除 | `cmd_list_delete_dialog` | `state_list_can_delete` |
| 分享 | `cmd_list_send_dialog` | `state_list_something_selected` |
| **图像**（仅 `_w_aa` 变体） | `cmd_list_album_art` | **`state_list_one_item_selected`** |

**关键**：`图像` 按钮的启用条件是 **`state_list_one_item_selected`（恰好选中 1 项）**——因为封面是按单个实体设定的，多选时无法确定目标。

### 4.2 点击后的链路

```
多选工具栏「图像」
  → post cmd_list_album_art (0x7f0d030d) on bus @id/list
  → list/n0.smali:5331-5357 处理：收集选中项 id（array_0/array_1 两套）
  → 打开 dialogs/SelectAlbumArtActivity（详见 poweramp-album-art-picker.md）
```

`state_list_one_item_selected` = `0x7f0d03cf`，`art_image` = `0x7f08006f`（"Image"）。

### 4.3 与单行「更多」菜单的「图像」区别

| 入口 | 菜单来源 | msgId | 说明 |
| --- | --- | --- | --- |
| **单行「更多」菜单** | `merge_menu_items_tracks.xml:6` / `merge_menu_items_aa.xml:8` | `cmd_list_select_aa_dialog` (0x7f0d0061) | 作用于当前行 |
| **多选工具栏** | `merge_selection_menu_list_items_w_aa.xml` | **`cmd_list_album_art`** (0x7f0d030d) | 作用于选中的 1 项 |

两者**最终都打开 `SelectAlbumArtActivity`**，但命令 id、触发条件与上下文不同。

> 用户第二张截图正是**多选工具栏 → 图像**这条路径，弹窗内可见「高分辨率」复选框、「无专辑封面」占位、「从 SD 卡中选择」按钮——这些都是 `SelectAlbumArtActivity` 的界面元素（详见 `poweramp-album-art-picker.md` §1.4）。

弹窗封面**不引入新的取图路径**——它用的就是列表行已有的那张位图（§0.2 物理复用）。

数据侧细节见 `poweramp-album-art-picker.md`：

| 主题 | `poweramp-album-art-picker.md` 中的章节 |
| --- | --- |
| `AAResolver` 优先级链（内嵌 → selected_aa → 下载 → 文件夹） | §5.4 |
| `aa_status` 位掩码（bit0 内嵌、bit1 负缓存） | §5.2 |
| 位图缓存中枢 `data/aa/y` + 代次守卫 | §7.1 / §7.3 |
| `AAContentProvider` 对外提供 | §7.1.1 |
| 弹窗封面尺寸档位与 `cornerRadius` 三档 | **本文 §2.3** |

**本文补充的关键点**：弹窗场景设 `hiRes=false`（§2.3），意味着**弹窗不会触发更高分辨率的重新解码**，直接复用行内已有位图。

---

## 5. 完整流程

### 5.1 单行「更多」弹窗（图像随行迁入）

```
① 用户点击行的「更多」按钮（@id/menu, style ?ItemTrackMenu / ?ItemTextMenu）
      ↓
② c1.D/E 拦截（widget/player/c1.smali:468/495），判 id == 0x7f0d0021
      ↓
③ 页面类 n([I)Z 返回 {menuLayoutId, sceneId}      ← 四选一菜单布局
      ↓
④ p2.А(rowView, ...) 执行物理搬迁：
      removeViewInLayout(rowView)  →  scale 设置  →  addView(popupLayer)
      同时插入遮罩层与占位视图
      ↓
⑤ 行视图切换到 scene_item_menu（或 _lu）
      → 所有子控件按 SceneParams 重套样式
      → aa_image 按行类型取不同尺寸（曲目行 88~136sp；分类行 44dp）
      → cat_image: gone
      → 菜单布局 inflate 进 @id/menu_items
      ↓
⑥ 用户看到：图像 + 标题 + 元数据 + 菜单项，全部在一个浮层内
      ↓
⑦ 关闭 → 逆向迁回列表原位
```

**图像来源**：不是弹窗画的，而是**行视图自带的图像控件**随物理迁移一起进入浮层（§0.2）。

### 5.2 多选工具栏「图像」（另一条路径）

```
① 长按/选择模式 → 选中 1 行（state_list_one_item_selected）
      ↓
② 底部工具栏出现「图像」按钮（merge_selection_menu_list_items_w_aa.xml）
      ↓
③ 点击 → post cmd_list_album_art (0x7f0d030d)
      ↓
④ list/n0.smali:5331 收集选中项 id
      ↓
⑤ 打开 dialogs/SelectAlbumArtActivity（封面选择器）
      → 高分辨率复选框 / 无专辑封面占位 / 从 SD 卡中选择
      → 详见 poweramp-album-art-picker.md
```

### 5.3 两条路径的关系

| | 单行弹窗 | 多选工具栏 |
| --- | --- | --- |
| 图像显示 | **行视图自带**（随迁入） | 无（弹窗内自成一套） |
| 打开内容 | 操作菜单 | **完整封面选择器** |
| 触发 | 点行内「更多」 | 选中后点底部「图像」 |

---

## 6. 值得借鉴 / 不建议照抄

### 6.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **物理复用行视图**（`removeViewInLayout` + `addView`） | 零重建成本，位图/状态天然保留，动画连续性好 |
| A2 | **场景系统统一样式**（`SceneParams`） | 同一行在列表/弹窗/播放器多场景下用声明式样式切换，无需多份布局 |
| A3 | **弹窗设 `hiRes=false`** | 弹窗尺寸小（88dp），复用低清缩略图足够，避免额外解码 |
| A4 | **`cornerRadius1/2/3` 三档** | 一条样式规则适配曲目/专辑/其他三类圆角 |
| A5 | **遮罩层 + 占位视图** | 搬迁期间保持布局稳定，避免列表跳动 |
| A6 | **尺寸按屏幕档位自适应**（88dp→136sp） | 小屏省空间、大屏给足视觉，且大屏用 `sp` 随字体缩放 |

### 6.2 不建议照抄

| # | 做法 | 理由 |
| --- | --- | --- |
| N1 | **两种行类型复用同一 `@id/aa_image` 但控件类不同** | `AAImageView` vs `IconView` 同 id 不同类，按 id 查找的代码需额外 `instanceof` 判断，易错 |
| N2 | **`CatImage` 在弹窗场景靠样式置 `gone`** | 可见性散落在 `styles.xml` 的 attr 间接映射（`?ItemTrackCatImage_scene_item_menu` → `@style/ItemTrackCatImage_gone`），追踪成本高 |
| N3 | **`_lu` 变体仅继承不改** | 只为一个空变体多维护一套 attr → style 映射 |
| N4 | **场景规则数量庞大** | `item_track.xml` 有 200+ 行 `SceneParams`，可维护性差 |
| N5 | **行视图物理迁移** | 若迁移期间有异步回调更新行内容，可能出现"已移走仍在更新"的状态竞争【推断】 |

---

## 7. 未解与边界

### 7.1 本轮已闭环

| # | 原待补项 | 结论 | 位置 |
| --- | --- | --- | --- |
| ~~P1~~ | `IconView` 的渲染细节 | **只设 drawable（图标 resId），忽略 Bitmap**；`C0` 为空实现 | §3.2 |
| ~~P2~~ | `ItemTextAAImage` 弹窗尺寸 | 列表 36dp → 弹窗 **44dp**；无圆角无阴影 | §3.3 |
| P3 | 分类行取图的 `aaType` 调用点 | **不适用**——分类行不取封面位图 | §3.2 |
| P4 | `AAImageView.E0(Bitmap,int,boolean)` 语义 | 尚未详读（`AAImageView` 74 KB） | — |
| P5 | `AAImageView` 的 `fallbackPx` 占位机制 | 尚未详读 | — |
| P6 | 场景切换是否触发位图重新加载 | 弹窗场景设 `hiRes=false`，**推断不重载** | §2.3 |
| P7 | 行视图迁回原位的完整逻辑与动画 | 未展开 | — |

### 7.2 仍开放

| # | 问题 | 说明 |
| --- | --- | --- |
| ~~Q1~~ | ~~专辑页实机走 `item_track` 还是 `item_text`~~ | **已解决**：两者都对，取决于页面层级（§3.7） |
| ~~Q2~~ | ~~`AAItemView` 是否有 `onDraw` 级封面绘制~~ | **已确认没有**：`draw()` 仅 `super` + 装饰层 `T.i5`，无自有封面逻辑（§2.1 补充） |
| ~~Q3~~ | ~~`CatImage` 在列表场景的用途~~ | **已闭环**：分类图标控件，`x0` 开关控制是否绘制；弹窗场景 `gone`（§2.1） |
| Q4 | 行迁回原位的动画与占位清理 | 已确认由 `e4.Х/х` 场景动画驱动（非 add/remove），细节未逐帧展开（§7.5） |
| Q5 | `AAImageView.E0` 与 `C0` 的完整语义 | `E0` 已闭环（优先吃 bitmap，§2.1.1）；`C0` 异步路径未展开 |
| ~~Q6~~ | ~~`AAImageView` 的 `fallbackPx` 占位机制~~ | **已闭环**：布尔开关 + `res/<drawable>?` URI 路径，用于占位图（§7.5） |
| ~~Q7~~ | ~~截图 B 头部文本来自哪个布局~~ | **已闭环**：同一行视图的 `@id/title` / `line2` / `meta` 三控件，弹窗场景均 visible（§3.7 末节） |

### 7.3 实机截图带来的修正

用户先后提供 4 张实机截图，逐轮修正了本文结论：

| 轮次 | 观察 | 修正 |
| --- | --- | --- |
| 1–3 | 列表选项弹窗内容、齿轮跳转 | 确认 `ListOptsActivity` 组织方式（另见 `poweramp-list-options.md`） |
| 4 | 专辑列表每行约 120dp 圆角封面 | 一度以为与静态分析矛盾 → **实为不同页面层级**（§3.7） |
| 5 | 多选工具栏底部有「图像」按钮 | 发现第三条入口 `cmd_list_album_art`（§4） |
| 6 | 点「图像」→ 含「高分辨率」「无专辑封面」「从 SD 卡中选择」 | 确认为 `SelectAlbumArtActivity`（§4.2） |
| **7（本轮）** | **同一专辑条目两个弹窗：一个有封面无该项、一个有该项有封面** | **矛盾彻底解决**：专辑列表页 = `lib` 菜单 + 图标；专辑详情曲目行 = `tracks` 菜单 + 120dp 封面（§3.7） |

### 7.4 最终结论对照

| 场景 | 行布局 | 弹窗图像 | 菜单布局 | 「专辑封面」项 |
| --- | --- | --- | --- | --- |
| **专辑列表页**（点专辑行） | `item_text.xml` | 44dp 分类图标 | `merge_menu_items_lib` | **无** |
| **专辑详情页**（点歌曲行） | `item_track.xml` | **120dp 专辑封面** | `merge_menu_items_tracks` | **有** |
| **所有歌曲/队列等** | `item_track.xml` | 88~120dp 封面 | `merge_menu_items_tracks` | 有 |
| **艺术家行** | `item_text.xml` | 44dp 图标 | `merge_menu_items_lib` | 无（实体实现 `b2`） |
| **多选工具栏** | 行视图 | （不显示） | `merge_selection_menu_list_items_w_aa` | 打开选择器 |

> **一句话**：弹窗里的封面是"行带进来的"，所以**行代表什么，弹窗就显示什么**——代表专辑就显示图标（分类行），代表歌曲就显示封面（曲目行）。

### 7.5 本轮补充闭环的两个实现细节

#### `fallbackPx` 占位机制

`AAContentProvider`（`data/aa/AAContentProvider.smali:144-796`）支持一种特殊 URI：

```
content://__AAProvider/res/<drawable名>?fallbackPx=<任意值>
```

处理逻辑（`:211-285`）：

```java
if (subPath.equals("res")) {
    String name = UriUtil.b(1, uri.getEncodedPath());     // drawable 名
    boolean hasFallback = UriUtil.C(uri, "fallbackPx");   // 只看参数是否存在
    int resId = resources.getIdentifier(name, "drawable", pkg);
    if (resId == 0) { /* 走 fallback 分支 */ }
    else { /* 解码该 drawable 为位图并返回 */ }
}
```

- `fallbackPx` 是**布尔开关**（只判存在性），不是尺寸参数
- 该路径用于给"无封面"场景提供**资源占位图**（如 `gl_poweramp_logo` = `0x7f02009d`）
- 与真实封面路径（`<subPath>?aaType=<n>`）并列，由 subPath 首段分流

#### 行视图迁回：由场景动画系统驱动，非直接 add/remove

初版推测迁回是对称的 `removeView`/`addView`。实测**不成立**：`p2.B(boolean)`（`:150-467`，关窗入口）内部**没有任何视图增删调用**，只有：

```java
// p2.smali:229 / :238 / :445
e4.Х(boolean animate, float duration, s3 callback);
```

`e4.Х(Z, F, s3)`（`widget/base/e4.smali:5685-5705`）是薄封装，转调：

```java
e4.х(boolean, float, float, int, float, s3);
```

即**场景动画调度器**统一驱动。`MenuPlaceholderLayout`（`super SceneFastLayout`）持有 `e4` 实例（字段 `v`），由它按 `z3` SceneParams 完成行视图的可见性/位置回归。

> 因此迁出是"显式 add/remove"，迁回是"场景系统驱动"——**两个方向机制不对称**。这与 §6.2 N5 提到的状态竞争风险相关：迁回期间行视图仍可能接收到异步更新。

---

## 8. Evidence 索引
### 8.1 关键产物位置

| 主题 | 来源 |
| --- | --- |
| 弹层宿主 | `widget/base/MenuPlaceholderLayout.smali`（`super SceneFastLayout`，持 `p2`） |
| **搬迁核心** | `widget/base/p2.smali:686-1180`（`А(...)`），关键行 `:1032` / `:1058` |
| 场景应用 | `widget/base/e4.smali:1833`（`B(z3,I,I,LayoutParams,AttributeSet,I,I)`） |
| 曲目行布局 | `res/layout-sw2dp/item_track.xml`（`aa_image` / `cat_image` / 3 个 `LoadableBehavior`） |
| 分类行布局 | `res/layout-sw2dp/item_text.xml`（`IconView` 复用 `aa_image` id） |
| 曲目弹窗布局 | `res/layout-sw2dp/merge_item_popup_menu.xml`（**无图像控件**） |
| 分类弹窗布局 | `res/layout-sw2dp/merge_item_text_popup_menu.xml`（**无图像控件**） |
| 封面+菜单合并布局 | `res/layout-sw2dp/merge_item_aa_and_header.xml` |
| 弹窗封面样式 | `values/styles.xml:4479`（`ItemTrackAAImage_scene_item_menu`） |
| 分类图标隐藏样式 | `values/styles.xml:11611`（`ItemTrackCatImage_gone`） |
| 尺寸定义 | `values*/dimens.xml`（`ItemTrackAAImage_scene_item_menu_size` 四档） |

### 8.2 资源 id 速查

| 名称 | id |
| --- | --- |
| `@id/aa_image` | 0x7f0d0014 |
| `@id/cat_image` | 0x7f0d001c |
| `@id/aa_panel` | 0x7f0d03db |
| `@id/menu` | 0x7f0d0021 |
| `@id/menu_items` | 0x7f0d02cd |
| `@id/behavior_aa_and_header` | 0x7f0d0418 |
| `@id/behavior_menu` | 0x7f0d0290 |
| `scene_item_menu` | 0x7f0d013c |
| `scene_item_menu_lu` | 0x7f0d0299 |
| `scene_aa` | 0x7f0d028d |

### 8.3 复现命令

```powershell
$env:JAVA_HOME = "<rea-bundle>/vendor/jdk"
apktool d --no-res -f -o <out> .rea-analysis/Poweramp-v3.apk
# 关键搜索：
#   "ItemTrackAAImage_scene_item_menu"     → 弹窗封面尺寸/圆角
#   "ItemTrackCatImage_gone"               → 分类图标为何隐藏
#   "removeViewInLayout"                   → 行视图搬迁
#   "merge_item_popup_menu"                → 确认菜单层无图像
```

---

## 9. 与既有文档的边界

| 文档 | 边界 |
| --- | --- |
| `poweramp-list-options.md` | 弹窗的**入口链路与菜单项**（`cmd_list_options_dialog`、`merge_menu_items_*`）；本文是其**图像侧**补充 |
| `poweramp-album-art-picker.md` | 封面**数据层**（`aa_status`、`AAResolver`、下载管线）；本文只讲**显示层**如何复用位图 |
| `poweramp-queue-view.md` | 队列**数据模型**；本文涉及队列行的封面显示 |
| `poweramp-entity-views.md` / `poweramp-category-views.md` | 各分类页面结构；本文聚焦选中弹窗的封面 |

---

## 10. 系列收口：三份文档的分层关系

本轮调查累计产出三份文档，按**从入口到像素**分层，互不重叠：

```
【第 1 层·入口与菜单】poweramp-list-options.md
    「更多」按钮 → BusActionButton → MsgBus → 菜单布局四选一
    → cmd_list_options_dialog → ListOptsActivity（8 个动态分组）
    → 齿轮深链 SettingsActivity

【第 2 层·封面数据】poweramp-album-art-picker.md
    SelectAlbumArtActivity（候选图网格）
    → 内嵌/文件夹/在线三源 → 落盘 selected_aa
    → aa_status 位掩码（bit0 内嵌 / bit1 负缓存）
    → AAResolver 优先级链 → AAContentProvider 对外提供

【第 3 层·封面显示】poweramp-row-popup-cover.md（本文）
    行视图物理复用（removeViewInLayout → addView）
    → 场景切换 scene_item_menu
    → aa_image 按行类型取不同控件（AAImageView 120dp / IconView 44dp）
    → cat_image 在弹窗场景 gone
```

### 10.1 三者的接口点

| 从 → 到 | 接口 |
| --- | --- |
| 第 1 层 → 第 2 层 | 齿轮 `w:string="aa"` → `xml/aa.xml`；多选工具栏 `cmd_list_album_art` → `SelectAlbumArtActivity` |
| 第 2 层 → 第 3 层 | 位图经 `data/aa/y` 缓存 → 由列表 provider 绑到行内 `aa_image` |
| 第 1 层 → 第 3 层 | `p2.А(rowView,...)` 物理搬迁 + `p2.d0()` 运行时裁剪菜单项 |

### 10.2 本次调查的边界声明

| 已闭环 | 说明 |
| --- | --- |
| 弹窗结构 | 行视图复用 + 场景系统，两方向机制不对称 |
| 三类图像控件 | `AAImageView`（封面）/ `IconView`（图标，忽略位图）/ `CatImage`（可抑制的分类字形） |
| 两级页面差异 | 专辑列表页（`lib` 菜单 + 44dp 图标）vs 专辑详情曲目行（`tracks` 菜单 + 120dp 封面） |
| 封面数据全链路 | 三源枚举 → 落盘 → 位掩码 → 优先级链 → 内容提供者 |
| 负缓存语义 | bit1 单向闩锁，仅手动重置可解除 |

| 明确未查（价值低） | 原因 |
| --- | --- |
| `e4` 场景动画逐帧算法 | 驱动器已定位，逐帧细节与"封面如何组织"无关 |
| `AAImageView`（74 KB）全方法 | `E0`/`C0` 语义已明确，其余为绘制/缓存优化 |
| `P`（87 KB）下载器内部 | 策略与端点已列出，抓取状态机属实现细节 |
| 6 种历史策略可达性 | 当前仅 2 条生效，其余为枚举残留 |

### 10.3 复现入口

三份文档均附 `复现命令`（apktool 反汇编 + 关键搜索串），可按需重跑：

```powershell
$env:JAVA_HOME = "<rea-bundle>/vendor/jdk"
apktool d --no-res -f -o <out> .rea-analysis/Poweramp-v3.apk
```

| 文档 | 起始搜索串 |
| --- | --- |
| `poweramp-list-options.md` | `"list_opts"` / `"cmd_list_options_dialog"` |
| `poweramp-album-art-picker.md` | `"aa_status=(aa_status&~2"` / `"selected_aa"` |
| 本文 | `"ItemTrackAAImage_scene_item_menu"` / `"removeViewInLayout"` |
