---
doc_id: "UI-PLAYER-RESPONSIVE-LAYOUT-STRATEGY"
title: "播放界面响应式布局策略"
doc_type: "ui-spec"
status: "draft"
owner_agent: "UI/UX Agent"
version_scope: "v0.1"
created: "2026-09-15"
updated: "2026-09-20"
source_documents:
  - "docs/ui/player-shell.md"
  - "src/features/player/model/responsivePlayerLayout.ts"
  - "src/features/player/components/ResponsivePlayerLayout.tsx"
  - "src/features/player/styles/player/responsive.css"
  - "src-tauri/tauri.conf.json"
  - "user request: 播放界面视图的实时确定性切换与有限缩放"
  - "user report: 1819 × 1108 出现横半屏内容超出设计上限的混合布局"
  - "最小Compact.png（用户提供设计稿）"
  - "user design: Compact 在横向、纵向及交叉拉伸下的布局状态"
  - "user report: 629 × 715 时底部播放控制被内容区裁切"
  - "user report: 955 × 795 时 Compact 歌词被错误测量为每行一个字"
  - "user report: 1220 × 714 时 Compact 封面尺寸异常"
  - "user acceptance: 播放视图切换与内部布局修复验收通过"
---

# UI 规格：播放界面响应式布局策略

## 摘要

本文记录当前已实现并经用户验收的播放界面响应式行为。播放界面包含 `full`、`horizontal`、`vertical`、`quarter`、`compact` 五个顶层视图；`compact` 负责原四种设计视图未覆盖的低高度窗口，并根据当前宽高切换内部结构。

当前实现遵循“同尺寸同 UI”和“拖动中实时呈现”。任何视觉过渡都不得参与布局判定或延迟当前尺寸对应的属性提交。

## 输入与约束

- viewport 指播放界面内容区的 CSS 像素宽高。
- Tauri 窗口初始尺寸为 `1120 × 720`，原生最小配置为 `640 × 720`。Windows 外框、缩放比例和 DPI 换算可能使 WebView 实际内容区短暂或持续比该配置略小；`640 × 720` 仍是正式 Compact 设计基准，不因防御处理而下调。
- 相同 viewport 宽高必须得到相同顶层视图、Compact 子视图和 UI scale。
- 布局只依赖当前宽高与集中配置，不读取 previous layout、拖动方向、最大化历史或曲目文本长度。
- 拖动窗口时实时显示当前尺寸对应的布局，不等待 `resizeend`。
- `MIN_SCALE = 0.90`；现有四种视图允许在 `0.90–1.00` 之间有限缩小，Compact 使用自己的流式布局。
- Compact 中部控制行和底部控制坞复用 `quarter` 的组件、交互和视觉状态，不复制业务逻辑。

## 目标

- 覆盖所有 `width >= 640` 且 `height >= 720` 的受支持窗口尺寸，不再把无设计依据的 fail-safe 当作常规布局。
- 在设计有效范围内使用流式空间吸收变化，在范围空档内使用有限比例缩放。
- Compact 根据横向和纵向可用空间逐级增加歌曲信息与歌词，同时保证核心播放控制不越界。
- 每个切换边界可复现、可测试，并在拖动窗口时立即生效。

## 规则边界

- 视图选择规则不定义跨视图动画、共享元素动画或过渡时序。
- 响应式布局不改变播放、队列、歌词同步或音频输出能力。
- 选择过程不使用依赖历史状态的滞回。
- 选择过程不使用内容长度动态决定视图；文本内容只影响溢出呈现。
- Compact 不包含常驻队列浮层或多行上下文歌词列表。

## 顶层视图与有效范围

### 五种顶层视图

| 视图标识 | 职责 | 最小设计尺寸或基准 | 最大设计尺寸或正式职责域 | 信息等级 |
| --- | --- | ---: | ---: | ---: |
| `full` | 大型窗口的完整播放信息 | `1920 × 1080` | `2560 × 1440` | 3 |
| `horizontal` | 宽而矮窗口的横半屏结构 | `1723 × 720` | `2560 × 1080` | 2 |
| `vertical` | 中等宽度高窗口的竖半屏结构 | `1024 × 1120` | `1920 × 1440` | 2 |
| `quarter` | 窄高窗口的竖 1/4 结构 | `640 × 1200` | `1024 × 1440` | 1 |
| `compact` | 填补四种设计视图均无合法候选的低高度区域 | `640 × 720` | L 形职责域，见下节 | 不参与四视图评分 |

`horizontal` 的最小设计高度由 `595px` 调整为 `720px`。结合 `MIN_SCALE = 0.90`、4px 判定分桶和原生最小高度 `720px`，它从 `1552 × 720` 开始承接受支持窗口。

### Compact 顶层职责域

Compact 负责以下 L 形区域：

```text
640–923 × 720–1079
924–1551 × 720–1007
```

其外包矩形为 `640 × 720` 至 `1551 × 1079`，但右上角不属于 Compact：从 `924 × 1008` 开始由 `vertical` 接管。

| 达到的 viewport | 接管视图 | 说明 |
| ---: | --- | --- |
| `1552 × 720` | `horizontal` | 横半屏在 `0.90` 下成为合法候选 |
| `924 × 1008` | `vertical` | 竖半屏在 `0.90` 下成为合法候选 |
| `640 × 1080` | `quarter` | 竖 1/4 在 `0.90` 下成为合法候选 |

Compact 职责域采用闭区间集中定义。CSS 不得使用另一套媒体查询重新决定顶层视图。

## Compact 子视图

### 状态表

| 宽度 | 高度 | 子视图标识 | 顶部结构 | 歌词 |
| ---: | ---: | --- | --- | --- |
| `640–899` | `720–890` | `compact-row` | 左封面、右歌曲信息 | 隐藏 |
| `640–899` | `891–1030` | `compact-stacked` | 封面居中，歌曲信息移到封面下方 | 隐藏 |
| `640–899` | `1031–1079` | `compact-stacked-lyric` | 上下结构 | 一个完整歌词块 |
| `900–923` | `720–1030` | `compact-row-lyric` | 左封面、右歌曲信息 | 一个完整歌词块 |
| `900–923` | `1031–1079` | `compact-stacked-lyric` | 复用 `640 × 1031` 的上下结构 | 一个完整歌词块 |
| `924–1551` | `720–1007` | `compact-row-lyric` | 左封面、右歌曲信息 | 一个完整歌词块 |

固定锚点：

```text
width: 900
height: 891, 1031
```

- `900px` 表示横向结构已有足够宽度安置最小歌词块，不根据当前歌词长短改变。
- `891px` 表示窄 Compact 已有足够高度将歌曲信息移动到封面下方。
- `1031px` 表示上下结构已有足够高度显示一个完整歌词块。
- 宽高条件同时满足时，`compact-stacked-lyric` 优先；已经显示的歌词不得因结构改为上下排列而消失。

解析器按以下固定优先级选择 Compact 子状态，因此安全下溢尺寸也得到确定结果：

1. `height >= 1031`：`compact-stacked-lyric`。
2. 否则 `width >= 900`：`compact-row-lyric`。
3. 否则 `height >= 891`：`compact-stacked`。
4. 其余：`compact-row`。

### 最小 Compact：640 × 720

| 项目 | 规格 |
| --- | ---: |
| 左右窗口边距 | `26px` |
| 封面 | `362 × 362px` |
| 封面与歌曲信息间距 | `12px` |
| 右侧歌曲信息最大可用宽度 | `214px` |
| 中部控制 | 复用 `quarter` |
| 底部控制坞 | 复用 `quarter` |

横向空间必须满足：

```text
26 + 362 + 12 + 214 + 26 = 640
```

顶部间距沿用其他播放视图的标题栏后内容起始规则，不另设第二套标题栏间距。

### 歌曲信息与溢出

歌曲信息包含歌曲名和 `作者 - 专辑名`。

- 未溢出时，胶囊宽度适应内容并保持静止。
- 溢出时，胶囊占满可用宽度，内部文字使用往返的“乒乓球”效果展示剩余内容。
- 文本在两端短暂停顿；悬停或键盘聚焦时暂停。
- 歌曲名与 `作者 - 专辑名` 分别检测溢出，一个溢出不得驱动另一个滚动。
- `prefers-reduced-motion` 下禁用滚动，改用单行省略号。
- 文本长度不得参与布局选择，避免同尺寸因换歌得到不同子视图。

### 歌词块

Compact 最多显示一个当前歌词块：

- 只有原文时，一个歌词块为当前原文。
- 存在翻译时，当前原文与对应翻译共同组成不可拆分的歌词块。
- 不显示上一句、下一句或常驻歌词列表。
- 内容过长时沿用既有歌词换行或裁切规则，不改变 `900px` 和 `1031px` 锚点。
- 视图切换不得重置当前歌词位置。
- Compact 的歌词宽度链从 `track-lyrics-region`、`lyrics-panel` 到歌词列表和当前歌词项均为 `100%`，各层同时允许收缩，禁止由中间层的内容宽度把歌词区压成单字列。
- 隐藏歌词项、`display: none` 状态或小于 `120px` 稳定测量阈值的极窄宽度不能作为稳定测量结果，也不得写入视觉分行缓存。
- 视觉分行以可见歌词列表的稳定可用宽度统一测量；宽度恢复后由 `ResizeObserver` 触发重测并替换缓存，不能继续复用隐藏状态产生的旧分行。

### 封面流式尺寸

- `640 × 720` 下封面基准尺寸为 `362 × 362px`。
- 封面始终保持正方形，不得单轴拉伸。
- 横向歌词结构的封面同时受歌词区最小宽度和顶部可用高度约束：

```text
coverSize <= viewportWidth - 26 - 12 - lyricAreaMinWidth - 26
coverSize <= 扣除中部控制、底部控制坞及规定间距后的顶部可用高度
```

在 `900px` 宽度锚点，`lyricAreaMinWidth = 474px`，封面仍为 `362px`：

```text
900 - 26 - 12 - 474 - 26 = 362
```

- 拉宽但高度不变时，新增空间优先保证歌曲信息和歌词块；封面只在宽、高约束均允许时增大。
- 增加高度时，封面区域随可用空间连续增大，但不得挤压中部控制和底部控制坞。
- `compact-stacked-lyric` 在 `900–923 × 1031–1079` 直接复用 `640 × 1031` 的上下结构，不新增子视图。
- 上下歌词结构的封面随宽度增大，同时为歌曲名、`作者 - 专辑名`、完整歌词块、中部控制、底部控制坞及间距保留完整空间。
- 高度约束先达到上限时停止放大封面，多余宽度转为两侧留白。

### 中部与底部

- Shuffle、音频输出状态、Repeat 复用 `quarter` 中部控制组件。
- 进度、时间、上一首、播放/暂停、下一首、频谱入口、音量复用 `quarter` 底部控制坞。
- 两部分组成稳定底部区域；顶部内容增长不得将其推出 viewport。
- Compact 不显示常驻播放队列浮层；队列入口保持原有交互。

## 已实现的内部定位契约

这些规则属于各顶层视图内部的定位，不参与顶层候选评分。

### Vertical

- 舞台采用左封面、右歌词的两列结构，歌曲信息位于左列封面下方。
- 歌词面板在封面右侧的全部剩余列中水平、垂直居中；面板自身宽高受既有上限约束，但居中基准是右侧剩余区，而不是整个 viewport。
- 底部外部模式行与控制坞跨越两列，保持相对整个舞台居中。

### Horizontal

- 封面位于左列，歌曲信息与歌词位于右列。封面框及封面列在各自可用高度内垂直居中。
- 默认分支中，播放信息徽标与控制坞位于右列底部，二者共享同一控制区并保持 `24px` 间距。
- 当 `height >= 900px` 且 `width <= height + 836px` 时，控制区跨越舞台全宽；曲目信息卡高度同步扣除控制区高度，封面仍在剩余可用区内垂直居中。
- 该分支直接使用原始 viewport，是一像素硬边界。`950px` 高时，`1786px` 宽仍为全宽控制区，`1787px` 宽切换为右列控制区；顶层视图在两侧均为 `horizontal`。

### Quarter

- 舞台左右 inset 固定为 `26px`；歌曲信息 `justify-self: start` 且无额外横向 margin，因此歌曲信息左缘固定在 viewport 左侧 `26px`。
- 控制区域扩展到 `100vw`，再用补偿 margin 抵消舞台的 `26px` inset。底部控制坞、播放信息徽标以及 Shuffle / Repeat 行均以 viewport 水平中心为基准，不随内容列中心漂移。
- `640 × 1200` 与因 4px 分桶共享同一判定宽度的 `641 × 1200` 都保持上述定位。

### Compact

- 横向子状态保持左封面、右歌曲信息/歌词结构；上下子状态改为单列。
- `compact-stacked` 与 `compact-stacked-lyric` 的歌曲信息使用 `justify-self: start`，在 Compact 舞台的 `26px` 左 inset 处靠左，不随居中的封面一起居中。
- 防御下溢时先在虚拟 `640 × 720` 画布上完成同一套定位，再整体等比缩放到真实 WebView 内容区。

## 现有四种视图的候选选择

解析器始终先为 `full`、`horizontal`、`vertical`、`quarter` 计算确定性候选；只有四种设计视图均无合法候选时，才进入 Compact 或更低一级的防御状态。这落实了“设计覆盖优先，空档再由有限比例缩放或 Compact 承接”。

- 每种视图先检查当前判定尺寸能否以同一比例放下设计最小宽高；比例低于 `0.90` 时不构成合法候选。
- `scale = 1` 表示设计最小尺寸可按原比例容纳；`0.90 <= scale < 1` 时保持该视图结构并有限等比缩小固定 UI token。
- 单轴超过设计最大尺寸不会直接取消候选，多余空间由外围留白或流式区域吸收；超出最大范围的比例会计入失真，防止不合适的结构长期占用窗口。

```text
decisionScale = min(1.00, decisionWidth / Wmin, decisionHeight / Hmin)
renderScale = min(1.00, rawWidth / Wmin, rawHeight / Hmin)
virtualWidth = decisionWidth / decisionScale
virtualHeight = decisionHeight / decisionScale
scaleLoss = 1 - decisionScale
overflowWidth = max(0, virtualWidth / Wmax - 1)
overflowHeight = max(0, virtualHeight / Hmax - 1)
distortion = max(scaleLoss, overflowWidth, overflowHeight)
```

`decisionScale >= 0.90` 时成为有效候选。代码中的 `PROMOTION_SCALE = 0.96` 对应 `distortion <= 0.04` 的晋级集合：

1. 存在晋级候选时，只在晋级集合中按“信息等级降序、distortion 升序、decisionScale 降序、固定平局顺序”选择；这允许接近原比例的高信息视图优先于原比例但信息较少的视图。
2. 否则按“distortion 升序、信息等级降序、decisionScale 降序、固定平局顺序”选择。
3. 固定平局顺序为 `full > horizontal > vertical > quarter`。

该过程完全由当前宽高和集中配置决定。同一尺寸不会因拖动方向、上一个视图、最大化历史或当前文本内容而改变结果。

此规则继续保证 `1819 × 1108` 选择 `vertical`：横半屏超出最大设计高度的损失大于竖半屏的轻微缩放。

## 尺寸判定与实时 resize

判定使用 4px 向下分桶，但不得跨过固定锚点。锚点至少包含：

```text
width: 640, 900, 924, 1552, 1723, 1920, 2560
height: 720, 891, 1008, 1031, 1080, 1120, 1200, 1440
```

```text
bucketed = floor(raw / 4) × 4
decision = 存在 bucketed < anchor <= raw 时取该 anchor，否则取 bucketed
```

- 判定尺寸只用于顶层视图、Compact 子视图及候选排序。
- 流式封面尺寸、间距和 `renderScale` 使用原始 viewport。
- `891` 与 `1031` 必须作为明确锚点，不能分别被分桶为 `888` 与 `1028`。

实时流程：

```text
resize
  -> 保存最新 raw viewport
  -> requestAnimationFrame（每帧最多一次）
  -> 解析顶层视图与 Compact 子视图
  -> 用 raw viewport 计算流式尺寸
  -> 同一帧提交
```

不设置延迟 debounce，不等待 `resizeend`。结构标识在当前帧立即提交；已有视觉过渡不能推迟视图选择结果。

## 防御状态

Tauri 原生最小配置仍为 `640 × 720`，但 Windows 外框与 DPI 换算可能让 WebView 内容区略小。此时正式设计基准不变，解析器按以下顺序处理：

1. 先计算现有四种视图的标准候选；存在合法候选时仍使用标准候选。
2. 没有标准候选，且内容区至少为 `576 × 648`（`640 × 720 × MIN_SCALE`）时，返回 Compact 防御下溢：

   ```text
   layout = compact
   fallback = true
   scale = min(1, width / 640, height / 720)
   ```

3. Compact 子视图仍按当前内容区宽高和既有 `900`、`891`、`1031` 锚点确定；不得先把尺寸放大到 `640 × 720` 后再选择子视图。
4. 无标准候选且任一轴低于安全下溢下界（`width < 576` 或 `height < 648`）时，才进入既有 legacy fail-safe。该状态只负责避免崩溃，不承诺匹配 Compact 设计稿。

防御 Compact 使用 `640 × 720` 虚拟布局基准整体等比缩放到真实内容区，底部控制坞必须完整留在 viewport 内。它不是新的正式设计尺寸，不改变 Tauri 最小配置，也不扩展 Compact 正式职责域。

- 返回结果必须确定，不读取 previous layout。
- 不显示“尺寸不支持”等错误文案。
- 不允许 `NaN`、无穷 scale 或崩溃。

## 交互状态矩阵

| 状态 | 触发条件 | 可见反馈 | 验收方式 |
| --- | --- | --- | --- |
| Compact 横向 | `compact-row` | 左封面、右歌曲信息，无歌词 | `640 × 720` 匹配最小稿 |
| Compact 横向歌词 | `compact-row-lyric` | 左封面、右歌曲信息及歌词块 | `900 × 720` 显示歌词，`899 × 720` 不显示 |
| Compact 上下 | `compact-stacked` | 封面居中，歌曲信息位于下方 | `640 × 891` 切换且无歌词 |
| Compact 上下歌词 | `compact-stacked-lyric` | 上下结构增加歌词块 | `640 × 1031` 显示歌词；交叉域结构一致 |
| Compact 防御下溢 | 无标准候选且 `width >= 576`、`height >= 648` | `fallback=true`，整体等比缩放，核心控制完整可见 | `629 × 715` 与 `1220 × 714` 均进入防御 Compact |
| 歌词测量恢复 | 歌词区从隐藏或极窄状态恢复 | 按恢复后的列表宽度重新分行 | `955 × 795` 的当前歌词不出现每行一个字 |
| 现有视图有限缩放 | 最佳候选 `0.90–1.00` | 保持结构并有限缩放 | scale 不低于 `0.90` |
| reduced motion | 启用 `prefers-reduced-motion` | 往返文字改为省略号 | 布局选择不变 |

## 空、加载、错误和禁用状态

- 本策略不新增业务空、加载或错误状态。
- resize 是同步本地计算，不显示加载指示。
- 当前歌词为空时不显示伪内容；布局子视图不因此改变。
- 布局变化不得改变播放状态、当前曲目、进度、队列、歌词位置或控件可用性。

## 可访问性要求

- 视图切换不移动键盘焦点，不重新宣告整个页面。
- 同一控件跨视图重排时保持语义、可访问名称和状态不变。
- 尺寸变化不得让点击目标低于项目既有最小可操作尺寸。
- 滚动文本仍暴露完整可访问名称。
- `prefers-reduced-motion` 下使用省略号，不改变视图选择。

## 文案与标识

- 顶层标识固定为 `full`、`horizontal`、`vertical`、`quarter`、`compact`。
- Compact 子视图固定为 `compact-row`、`compact-row-lyric`、`compact-stacked`、`compact-stacked-lyric`。
- 标识不作为用户可见文案。

## 边界示例

| viewport | 顶层视图 | 子视图或说明 |
| ---: | --- | --- |
| `576 × 648` | `compact` | 防御下溢下界，`compact-row`、`fallback=true`、`scale=0.90` |
| `629 × 715` | `compact` | 防御下溢，`compact-row`、`fallback=true`、`scale≈0.9828`，控制坞完整可见 |
| `640 × 720` | `compact` | `compact-row`，封面 `362 × 362` |
| `640 × 1200` | `quarter` | 竖 1/4 设计最小尺寸；歌曲信息左缘为 `26px`，底部区域以 viewport 居中 |
| `641 × 1200` | `quarter` | 4px 分桶判定宽度仍为 `640`；内部定位与 `640 × 1200` 一致 |
| `899 × 720` | `compact` | `compact-row`，无歌词 |
| `900 × 720` | `compact` | `compact-row-lyric` |
| `640 × 890` | `compact` | `compact-row` |
| `640 × 891` | `compact` | `compact-stacked` |
| `640 × 1030` | `compact` | `compact-stacked` |
| `640 × 1031` | `compact` | `compact-stacked-lyric` |
| `900 × 1031` | `compact` | `compact-stacked-lyric` |
| `880 × 1034` | `compact` | `compact-stacked-lyric`；歌曲信息在舞台左缘靠左 |
| `923 × 1079` | `compact` | `compact-stacked-lyric` |
| `924 × 1007` | `compact` | `compact-row-lyric` |
| `924 × 1008` | `vertical` | Compact 退出 |
| `955 × 795` | `compact` | `compact-row-lyric`；歌词按完整可用宽度重测，不形成单字列 |
| `1220 × 714` | `compact` | 防御下溢，`compact-row-lyric`、`fallback=true`、`scale≈0.9917` |
| `640 × 1080` | `quarter` | Compact 退出 |
| `1551 × 720` | `compact` | `compact-row-lyric` |
| `1552 × 720` | `horizontal` | Compact 退出 |
| `1720 × 950` | `horizontal` | `scale≈0.9983`；满足全宽控制区分支 |
| `1750 × 1170` | `vertical` | `scale=1`；歌词在右侧剩余区居中 |
| `1786 × 950` | `horizontal` | 顶层不变；全宽底部控制区分支的闭区间上界 |
| `1787 × 950` | `horizontal` | 顶层不变；硬切换为右列底部控制区 |
| `1819 × 1108` | `vertical` | 竖半屏失真低于横半屏 |
| `2560 × 1440` | `full` | 全屏设计上界 |

## 验收标准

- Tauri 原生窗口最小配置保持 `640 × 720`，正式 Compact 设计基准不变。
- 解析器不接收 previous layout、拖动方向、最大化历史或当前文本长度。
- 同一 viewport 连续调用 100 次，顶层视图、子视图和 scale 一致；正反向到达同尺寸结果一致。
- 每帧至多解析一次并使用最新尺寸，不等待鼠标松开。
- Compact 精确覆盖 `640–923 × 720–1079` 与 `924–1551 × 720–1007`。
- `899/900`、`890/891`、`1030/1031`、`923/924`、`1007/1008`、`1079/1080`、`1551/1552` 两侧各验证一像素。
- `891` 与 `1031` 不得因 4px 分桶提前或延后切换。
- `640 × 720` 封面为 `362 × 362px`，左右边距 `26px`，封面与歌曲信息间距 `12px`，各区域不重叠。
- `900 × 720` 显示一个完整歌词块，封面仍为 `362 × 362px`。
- `900–923 × 1031–1079` 复用 `640 × 1031` 上下歌词结构，不产生额外子视图。
- 封面放大时保持正方形，并为歌曲信息、歌词、中部与底部控制保留空间；不足时停止增大。
- 歌曲信息溢出时各自独立往返；悬停或聚焦暂停；reduced motion 下使用省略号。
- Compact 中部和底部复用 `quarter` 组件与状态，不复制播放状态。
- Compact 不显示常驻队列浮层，队列入口仍可操作。
- `640 × 1200` 与 `641 × 1200` 均解析为 `quarter`；歌曲信息左缘保持 `26px`，控制坞、播放信息徽标与 Shuffle / Repeat 行以 viewport 水平中心定位。
- `880 × 1034` 解析为 `compact-stacked-lyric`；歌曲信息靠 Compact 舞台左缘排列。
- `1720 × 950` 解析为 `horizontal` 并使用全宽底部控制区；封面在扣除控制区后的可用高度内居中。
- `1750 × 1170` 解析为 `vertical`；歌词在封面右侧剩余区域内居中。
- `1786 × 950` 与 `1787 × 950` 顶层均为 `horizontal`；前者使用全宽底部控制区，后者使用右列控制区。
- `1819 × 1108` 继续解析为 `vertical`。
- 在 `width >= 640`、`height >= 720` 的受支持验证域内不进入常规 fail-safe。
- 无标准候选且 `width >= 576`、`height >= 648` 时解析为 Compact 防御下溢，`fallback=true`，`scale=min(1,width/640,height/720)`；更小尺寸才进入 legacy fail-safe。
- `629 × 715` 解析为 `compact-row` 防御下溢，scale 约为 `0.9828`，底部播放控制器不得被 viewport 裁切。
- `1220 × 714` 解析为 `compact-row-lyric` 防御下溢，scale 约为 `0.9917`；封面保持正方形且不越过内容区和底部控制区。
- Compact 歌词区域各层宽度为 `100%` 且允许收缩；隐藏或小于 `120px` 稳定测量阈值的宽度不得提交视觉分行缓存。
- 歌词区域恢复有效宽度时，`ResizeObserver` 必须触发重测；`955 × 795` 下当前歌词不得表现为每行一个字。
- 切换视图不重置播放状态、曲目、进度、歌词位置、队列或键盘焦点。

## 已知验证风险与实现约束

| 项目 | 风险 | 处理要求 |
| --- | --- | --- |
| L 形职责域 | min/max 矩形会错误覆盖右上区域 | 集中定义域与三个退出边界 |
| 多个子视图 | 分散媒体查询可能互相覆盖 | 解析器输出唯一子视图标识 |
| 封面连续放大 | 挤压歌词或底部控制 | 同时使用宽高约束，不足时封顶 |
| 歌词长度 | 内容测量切换破坏同尺寸同 UI | 固定 `900`/`1031` 锚点 |
| 歌词测量 | 隐藏项的零宽或极窄宽度污染分行缓存 | 忽略不稳定宽度，以列表宽度测量并由 `ResizeObserver` 在恢复后重测 |
| 乒乓球文本 | 持续运动影响阅读 | 两端停顿、暂停、支持 reduced motion |
| 4px 分桶 | 非 4 倍数边界可能被吞 | 注册全部锚点 |
| 原生最小尺寸 | DPI 或外框换算使 WebView 小于 `640 × 720` | 保持 Tauri 最小配置和正式基准；在 `576 × 648` 以上启用 Compact 防御下溢，更小才使用 legacy fail-safe |
| 横半屏内部硬边界 | `1786 → 1787 × 950` 时控制区从全宽切为右列，视觉位置会瞬时变化 | 作为当前确定性行为保留；回归时必须同时检查边界两侧，后续若优化过渡不得改变同尺寸结果 |
| Windows 多 DPI | 原生窗口尺寸、外框和 WebView CSS viewport 的换算可能随 DPI 改变 | 在 Windows 不同缩放比例下记录实际 `innerWidth/innerHeight`，重点复验 `640 × 720` 原生下限、`576 × 648` 安全下溢和控制区裁切 |
| 实时 resize | 多次测量可能掉帧 | 每帧一次，优先 CSS 流式计算 |
| 视觉过渡 | 结构硬切换可能出现瞬时跳变 | 过渡只能平滑呈现，不得改变判定结果或延迟结构标识提交 |

## 当前实现与验收状态

- 解析器实现位于 `src/features/player/model/responsivePlayerLayout.ts`，React resize 提交与布局标识位于 `src/features/player/components/ResponsivePlayerLayout.tsx`，视图内部定位位于 `src/features/player/styles/player/responsive.css`。
- Tauri 的 `minWidth` / `minHeight` 为 `640` / `720`，初始窗口为 `1120 × 720`。
- 本文列出的视图切换、Compact 安全下溢、歌词宽度恢复及内部定位修复已由用户验收。
- `1786 → 1787 × 950` 的横半屏内部硬切换和 Windows 多 DPI 实机覆盖保留为已知验证风险。
