---
doc_id: "UI-PLAYER-RESPONSIVE-LAYOUT-STRATEGY"
title: "播放界面响应式布局策略"
doc_type: "ui-spec"
status: "draft"
owner_agent: "UI/UX Agent"
version_scope: "v0.1"
created: "2026-09-15"
updated: "2026-09-19"
source_documents:
  - "docs/ui/player-shell.md"
  - "src/features/player/components/ResponsivePlayerLayout.tsx"
  - "src/features/player/styles/player/responsive.css"
  - "user request: 播放界面四种视图的实时确定性切换与有限缩放"
  - "user report: 1819 × 1108 出现横半屏内容超出设计上限的混合布局"
---

# UI 规格：播放界面响应式布局策略

## 摘要

本文定义播放界面四种视图在窗口连续拉伸时的选择、流式变化和有限 UI 缩放规则，供 Frontend Agent 实现、Test Agent 验收。本文记录的是**方案一（当前实施方案）**；若实机效果、信息密度或切换观感不符合预期，可以替换整套选择策略，不应把本方案参数视为长期固定契约。

## 输入与约束

- 设计稿的最小尺寸决定该视图在给定 UI scale 下能否放下；最大尺寸决定内容画布继续扩张的上限。viewport 单轴超过缩放后的最大内容尺寸时，由内容外侧留白吸收，不因此取消该视图候选。
- 相同 viewport 内容区宽高必须得到相同视图和相同 UI scale。
- 用户拖动窗口时必须实时看到当前尺寸对应的布局；不等待拖动结束。
- 本方案只调整播放界面的响应式布局选择与缩放边界，不改变播放能力、数据契约或控件功能。
- 动画将在后续实现。本次实现应保留稳定的布局标识和共享元素结构，作为后续动画衔接边界。

## 目标

- 用一个只依赖当前 viewport 宽高的确定性纯函数选择视图。
- 在设计稿有效范围内优先使用流式布局吸收尺寸变化。
- 在有效范围之间的空档使用统一、有限的内部 UI 缩放承接。
- 在高信息视图只需近乎无损缩放时，允许它优先于原比例但信息较少的视图。
- 窗口拖动期间每个渲染帧都能呈现最新布局，并避免同一帧重复计算。

## 不在范围内

- 本次不实现跨视图动画、共享元素动画或过渡时序。
- 本次不增加第五种紧凑视图。
- 本次不改变四套设计稿的内容组成和信息层级。
- 本次不使用依赖 previous layout、最大化历史或拖动方向的滞回。
- 本次不使用 `resizeend`、延迟 debounce 或松手后才更新的策略。

## 方案一：确定性候选选择

### 设计无失真有效范围

下表尺寸均以播放界面 viewport 内容区 CSS 像素为基准。最小尺寸用于候选准入；最大尺寸是内容画布上限。设计有效边界采用闭区间。

| 视图标识 | 视图职责 | 最小尺寸 | 最大尺寸 | 信息等级 |
| --- | --- | ---: | ---: | ---: |
| `full` | 大型窗口的完整播放信息 | `1920 × 1080` | `2560 × 1440` | 3 |
| `horizontal` | 宽而矮窗口的横半屏结构 | `1723 × 595` | `2560 × 1080` | 2 |
| `vertical` | 中等宽度高窗口的竖半屏结构 | `1024 × 1120` | `1920 × 1440` | 2 |
| `quarter` | 窄高窗口的竖 1/4 结构 | `640 × 1200` | `1024 × 1440` | 1 |

`horizontal` 与 `vertical` 信息等级相同，但结构职责不同。最终平局顺序固定为：

```text
full > horizontal > vertical > quarter
```

该顺序仅处理所有更高优先级比较项都相等的情况，不单独覆盖缩放适配结果。

### 尺寸输入

视图判定使用 4px 向下分桶后的尺寸，但分桶不得跨过任一设计最小/最大边界。宽度锚点为 `640`、`1024`、`1723`、`1920`、`2560`，高度锚点为 `595`、`1080`、`1120`、`1200`、`1440`：

```text
bucketed = floor(raw / 4) × 4
decision = 存在 bucketed < anchor ≤ raw 时取该 anchor，否则取 bucketed
```

- `decisionWidth`、`decisionHeight` 只用于视图候选、晋级判断和排序。
- 流式列宽、封面尺寸、间距及最终 `renderScale` 使用 `rawWidth`、`rawHeight`。
- 边界锚定保证 `2560 × 595`、`1723 × 595` 等精确设计边界不会因向下分桶落到边界外。
- 4px 分桶不会引入历史状态，因此无论从哪个方向到达，相同原始尺寸的结果都一致。

### 候选 scale 与内容画布上限

对任一视图，记设计最小尺寸为 `Wmin × Hmin`，内容画布最大尺寸为 `Wmax × Hmax`。

```text
Wmin ≤ contentDesignWidth ≤ Wmax
Hmin ≤ contentDesignHeight ≤ Hmax
```

分别计算用于候选选择的比例和用于实际渲染的比例：

```text
decisionScale = min(1.00, decisionWidth / Wmin, decisionHeight / Hmin)
renderScale = min(1.00, rawWidth / Wmin, rawHeight / Hmin)
```

方案一暂定只允许缩小或原比例显示：

```text
0.90 ≤ s ≤ 1.00
```

当且仅当下式成立时，该视图是有效候选：

```text
decisionScale >= MIN_SCALE
```

候选使用最接近原比例的合法值：

```text
candidateScale = decisionScale
scale = renderScale
```

`candidateScale` 只用于确定性选择，`scale` 是实际渲染值。当 `scale = 1` 时，viewport 已能原比例放下该视图的最小设计尺寸；当 `0.90 ≤ scale < 1` 时，保持该视图结构并有限缩小内部 UI。

最大尺寸不参与候选失效判断，但超出最大尺寸的比例参与失真评分。这样既不会因为单轴稍微超出上限而让候选突然消失，也不会把明显超出设计稿工作范围的视图当成无损方案。

先把 viewport 换算到候选视图的设计坐标：

```text
virtualWidth  = decisionWidth / candidateScale
virtualHeight = decisionHeight / candidateScale
```

再计算缩放损失、宽度溢出和高度溢出：

```text
scaleLoss     = 1 - candidateScale
overflowWidth = max(0, virtualWidth / Wmax - 1)
overflowHeight = max(0, virtualHeight / Hmax - 1)
distortion    = max(scaleLoss, overflowWidth, overflowHeight)
```

`distortion` 表示该视图最明显的一项偏离。缩小 1.1% 与超出设计高度 2.6% 可以据此直接比较。内容画布在设计坐标中的尺寸仍为：

```text
contentDesignWidth  = min(viewportWidth / scale, Wmax)
contentDesignHeight = min(viewportHeight / scale, Hmax)
```

渲染后的内容画布为 `contentDesignWidth × scale`、`contentDesignHeight × scale`。viewport 任一轴仍有剩余空间时，将其分配为外围留白或既有布局允许的外部间距。超过设计最大尺寸时不放大按钮和字号，也不因少量超宽或超高退回其他视图。

### 候选排序

可替换参数：

```ts
const MIN_SCALE = 0.90
const PROMOTION_SCALE = 0.96
const DECISION_BUCKET_PX = 4
```

候选选择必须按以下固定步骤执行：

1. 计算四种视图的 `decisionScale`，排除 `decisionScale < MIN_SCALE` 的视图。
2. 从有效候选中取 `distortion <= 1 - PROMOTION_SCALE` 的“近乎无损候选”；边界值包含在内。
3. 若存在近乎无损候选，依次按“信息等级降序、distortion 升序、candidateScale 降序、固定平局顺序”选择第一项。
4. 若不存在近乎无损候选，依次按“distortion 升序、信息等级降序、candidateScale 降序、固定平局顺序”选择第一项。
5. 选择结果只由量化后的当前宽高和固定配置决定；禁止读取当前/上一次布局、窗口是放大还是缩小、是否刚刚最大化等历史信息。

该排序刻意允许高信息视图晋级。例如没有最大范围溢出时，`full@0.97` 可以优先于 `horizontal@1.00`；但 `full@0.94` 不满足晋级门槛，此时选择总体失真更小的候选。原比例显示不再天然等于无失真：若其设计坐标超出 `Wmax` 或 `Hmax`，相应溢出会计入评分。

### 无有效候选时的回退与窗口约束

四种视图按最小设计尺寸扩展到 `0.90–1.00` 后仍无法覆盖所有任意窗口比例，例如 `1100 × 700`。方案一要求：

- 产品支持的窗口约束应尽量阻止用户停留在无候选尺寸；约束必须由同一组设计范围和 `MIN_SCALE` 推导，不另设互相矛盾的魔法数字。
- 因系统 resize 中间帧、DPI 换算或原生窗口限制而短暂出现无候选尺寸时，解析器必须返回确定性 fail-safe，不得回退到 previous layout。
- fail-safe 先把 viewport 投影到各视图在 `MIN_SCALE` 下的最小可承接尺寸，并用 `Wmax × Hmax` 对内容画布投影结果封顶；超过最大内容画布的部分按外围留白处理，不记作失真距离。比较宽、高不足量的归一化距离并选择最近视图；距离相同则按“信息等级、固定平局顺序”选择。
- fail-safe 的 UI scale 固定钳制为 `0.90`，并保证主要播放控制不越界；该状态是防御性渲染，不代表设计稿已覆盖该尺寸。
- 若实测原生窗口无法用合理约束避免长期停留在无候选区域，应把“新增紧凑视图”或“更换窗口约束方式”提交为方案二，而不是继续降低 `MIN_SCALE`。

## 实时 resize 行为

```text
resize 事件
  → 保存最新 raw viewport
  → requestAnimationFrame（每帧最多一次）
  → 4px 分桶尺寸决定 layout
  → 原始尺寸决定流式布局和 UI scale
  → 同一帧提交结果
```

- resize 事件到来后立即安排下一渲染帧更新。
- 同一帧内发生多次 resize 时只处理最后一次原始宽高。
- 不设置延迟 debounce，不等待 `resizeend`。
- 同一视图内，封面、容器、留白和允许缩放的 UI 应随原始尺寸连续变化。
- 跨过固定判定边界时，在该帧立即切换 `data-player-layout`；后续动画只负责视觉衔接，不改变判定时机和最终视图。
- 最大化和系统全屏状态可以触发一次重新测量，但不得绕过尺寸解析器强制指定 `full`。相同内容区尺寸必须得到相同 UI。

## 交互状态矩阵

| 状态 | 触发条件 | 可见反馈 | 可操作项 | 禁用项 | 验收方式 |
| --- | --- | --- | --- | --- | --- |
| 原比例承接 | 至少一个候选的 `renderScale = 1`，且按排序被选中 | 使用所选视图；元素保持设计比例，内容画布可在最大值封顶 | 所有原本可用播放控件 | 无新增禁用项 | 检查 viewport 能放下所选视图最小尺寸，renderScale 为 `1`；超出内容 cap 的轴由外围留白吸收 |
| 近乎无损晋级 | 高信息候选 `scale >= 0.96` | 使用信息更丰富视图；UI 轻微缩小或原比例 | 所有原本可用播放控件 | 无新增禁用项 | 同尺寸重复进入时始终选择同一高信息视图 |
| 有限缩放承接 | 无近乎无损晋级候选；最佳候选 `0.90–0.96` | 保持候选视图结构，UI scale 连续变化 | 所有原本可用播放控件 | 无新增禁用项 | 宽高同时满足缩放后的设计范围，scale 不低于 `0.90` |
| 跨视图边界 | 量化尺寸使确定性最佳候选发生变化 | 当前帧切换结构；本次不要求动画 | 所有原本可用播放控件 | 无新增禁用项 | 慢速来回拖过边界，任一相同尺寸的结果一致 |
| 无有效候选 | 四种视图均无合法缩放区间 | 使用最近可承接视图的 fail-safe，scale 钳制为 `0.90` | 保留主要播放控制 | 可按现有能力禁用会越界的非核心装饰交互 | 指定无候选尺寸不崩溃、不读取 previous layout，主要控制不越界 |
| reduced motion | 系统启用 `prefers-reduced-motion` | 判定和实时 resize 行为不变；后续动画缩短或移除 | 所有原本可用播放控件 | 无新增禁用项 | 开启 reduced motion 后拖动仍实时切换且结果一致 |

## 边界示例

以下结果基于 `MIN_SCALE = 0.90`、`PROMOTION_SCALE = 0.96` 和 4px 分桶；示例中的整数尺寸均能被 4 整除时可直接代入。

| viewport | 关键候选 | 预期视图 | 原因 |
| --- | --- | --- | --- |
| `2560 × 1440` | `full@1.00` | `full` | 全屏设计上界 |
| `2560 × 595` | `horizontal@1.00` | `horizontal` | 高度恰好达到最小值，宽度达到内容画布上限；边界锚定避免 595px 被向下分桶，不进入 fail-safe |
| `2560 × 1080` | `full@1.00`、`horizontal@1.00` | `full` | 均近乎无损，信息等级更高 |
| `1920 × 1080` | `full@1.00`、`horizontal@1.00` | `full` | 闭区间重叠，固定信息等级决胜 |
| `1850 × 1050` | `full≈0.964`、`horizontal@1.00` | `full` | `full` 达到 `0.96` 晋级门槛 |
| `1800 × 1050` | `full=0.938`、`horizontal@1.00` | `horizontal` | `full` 未达到晋级门槛，选择 scale 最接近 `1` |
| `1819 × 1108` | `horizontal@1.00, distortion≈0.0259`、`vertical≈0.9893, distortion≈0.0107` | `vertical` | 横半屏虚拟高度超出 `1080` 上限的代价大于竖半屏轻微缩放，选择总体失真更小的竖半屏 |
| `1600 × 900` | `horizontal≈0.929` | `horizontal` | 横半屏有限缩放后可同时满足宽高范围 |
| `1280 × 1050` | `vertical=0.938` | `vertical` | 竖半屏有限缩放承接高度空档 |
| `1024 × 1200` | `vertical@1.00`、`quarter@1.00` | `vertical` | 信息等级更高；固定边界归属 |
| `900 × 1100` | `quarter≈0.917` | `quarter` | 竖 1/4 有限缩放承接高度空档 |
| `1100 × 700` | 无有效候选 | 确定性 fail-safe | 窗口约束应避免长期停留；中间帧不得崩溃或读取历史布局 |

边界包含关系必须集中定义，不得在多个判断函数中混用不同的 `>` / `>=`。`scale === 0.96` 属于近乎无损候选，`scale === 0.90` 属于合法有限缩放候选。

## 视觉层级与布局行为

- `layout` 决定信息结构、区域顺序、控制区排列和歌词呈现方式。
- 原始 viewport 尺寸优先由 Grid/Flex、`minmax()`、`min()`、`max()`、`clamp()`、弹性留白和容器尺寸吸收。
- UI scale 只填补设计有效范围之间的空档；缩放不应替代视图结构切换。
- 封面和内容容器可在设计允许范围内连续变化；按钮、图标、字号和点击目标只在统一 scale 范围内变化。
- 可点击目标在 `scale = 0.90` 时仍须满足项目既有的最小可操作尺寸要求；若不能满足，应对点击目标单独设下限，而不是继续整体缩小。
- 后续动画应以稳定的 `data-player-layout` 和共享元素 identity 为边界。动画不能参与候选选择，也不能延迟当前尺寸对应的结构更新。

## 空、加载、错误和禁用状态

- 本策略不新增业务空状态、加载状态或错误状态；沿用播放界面既有规格。
- resize 计算是同步本地计算，不显示加载指示。
- 无有效候选属于布局 fail-safe，不向用户显示错误文案。
- 布局变化不得改变播放状态、当前曲目、进度、歌词位置或控件可用性；只有确实无法保证不越界的非核心装饰交互可以在 fail-safe 中隐藏或禁用。

## 可访问性要求

- 视图切换不移动键盘焦点，不重新宣告整个页面。
- 同一控件跨视图重排时保持语义、可访问名称和状态不变。
- resize 和 scale 不得使文本低于既有最小字号约束，点击目标不得因整体缩放低于既有最小尺寸。
- 后续动画遵守 `prefers-reduced-motion`；关闭动画后仍应在拖动过程中实时显示最终布局。

## 文案

- 本策略不新增常规用户可见文案。
- fail-safe 不显示“尺寸不支持”等打断性提示；若未来决定加入窗口尺寸提示，应另行定义触发条件和恢复动作。
- 代码中的视图标识固定使用 `full`、`horizontal`、`vertical`、`quarter`，不得以中文展示文案作为业务枚举。

## 验收标准

- `resolveLayout(width, height, config)` 或等价解析器不接收 previous layout、拖动方向、最大化历史作为输入。
- 对同一原始 viewport 尺寸连续调用至少 100 次，返回的 layout 和 scale 完全一致。
- 从大到小和从小到大分别到达同一尺寸，最终 layout 和 scale 完全一致。
- resize 期间使用 `requestAnimationFrame` 合并更新；每个动画帧至多执行一次解析，且使用该帧前收到的最新尺寸。
- 拖动窗口时不等待鼠标松开或 `resizeend`；跨越判定边界后的下一渲染帧呈现新视图。
- 4px 分桶只参与 layout 判定，且不得跨越设计边界锚点；同一 layout 内的流式尺寸和 UI scale 使用原始 viewport，连续拖动时无 4px 阶梯缩放。
- 四个设计有效范围、`MIN_SCALE = 0.90`、`PROMOTION_SCALE = 0.96`、4px 分桶和固定平局顺序均集中配置，可单独替换。
- 每个有效候选都满足 `decisionScale = min(1, decisionWidth / Wmin, decisionHeight / Hmin)` 且 `decisionScale >= MIN_SCALE`；实际渲染使用原始尺寸计算 `renderScale`。
- 候选失真统一按 `max(1 - decisionScale, max(0, virtualWidth / Wmax - 1), max(0, virtualHeight / Hmax - 1))` 计算；最大范围溢出影响排序但不使候选失效。
- viewport 单轴超过 `Wmax × scale` 或 `Hmax × scale` 时，所选视图保持有效，内容画布在对应最大尺寸封顶，多余空间由外围留白吸收。
- `scale = 0.96` 进入近乎无损晋级集合；`scale = 0.90` 仍是合法候选；低于 `0.90` 的候选被排除。
- 表中所有边界示例返回预期视图。
- 固定高度从最小支持宽度扫描到 `2560px`，以及固定宽度从最小支持高度扫描到 `1440px` 时，同一视图不得出现 `A → B → A` 的往返；至少覆盖 `595px`、`900px`、`1050px`、`1080px`、`1120px`、`1200px` 高度的横向扫描和四套设计最小宽度的纵向扫描。
- `2560 × 595` 必须解析为 `horizontal@1.00`，不得进入 fail-safe。
- `1819 × 1108` 必须解析为 `vertical`，其失真评分低于 `horizontal`，不得呈现横半屏结构与竖向空间混合的布局。
- 最大化与普通窗口在内容区宽高相同的情况下返回相同 layout 和 scale。
- 无有效候选时使用确定性 fail-safe，不崩溃、不出现 `NaN`/无穷 scale、不读取 previous layout，主要播放控制保持可见且不越界。
- 切换 layout 不重置播放状态、当前曲目、进度、歌词状态或键盘焦点。
- `prefers-reduced-motion` 只影响后续动画，不改变布局解析结果和 resize 实时性。

## 风险与可替换参数

| 项目 | 方案一暂定值 | 风险 | 可替换方向 |
| --- | --- | --- | --- |
| 最低 UI scale | `0.90` | 小字号、点击目标或歌词密度可能仍不理想 | 提高下限；为字号/点击目标设置独立下限；新增紧凑视图 |
| 晋级门槛 | `0.96` | 高信息视图可能过早或过晚占用窗口 | 经视觉测试调整为固定新值，仍保持纯函数 |
| 判定分桶 | `4px` 向下取整 | 边界仍可能显得敏感，或分桶边界可见 | 改为 `2px`/`8px`；保持只用于视图判定 |
| 信息等级 | `full > horizontal/vertical > quarter` | “信息更多”不一定在所有比例下更易用 | 调整等级或改用固定评分，但必须保持确定性 |
| 固定平局顺序 | `full > horizontal > vertical > quarter` | 横竖半屏极少数重叠尺寸可能不符合视觉直觉 | 用明确宽高比边界替代，仍只依赖当前尺寸 |
| 最大内容尺寸 | 只限制内容画布，不限制窗口所有权 | 超宽或超高时外围留白可能过多 | 调整内容 cap 或留白分配；不得让最大值造成单轴扫描 `A → B → A` |
| 无候选处理 | 最近区域 fail-safe + 窗口约束 | 原生窗口约束难以表达非矩形可用区域 | 增加紧凑视图；重新定义最小有效范围；实现可预测的尺寸吸附 |
| 实时更新 | 每帧至多一次 | 复杂布局在 resize 时可能掉帧 | 减少布局测量、使用 CSS 流式计算；不得改成松手后更新 |
| 动画 | 本次不实现 | 结构切换仍会有一次明显跳变 | 后续增加共享元素布局动画和淡入淡出，不改变解析规则 |

本方案效果不佳时，应保留“同尺寸同 UI”和“拖动中实时呈现”两项用户期望，再整体评估候选评分、晋级逻辑或新增视图；不采用依赖历史状态的滞回来掩盖问题。

## 建议下一负责 Agent

Frontend Agent 按本规格实现确定性解析器和实时 resize 管线；Test Agent 独立验证边界示例、方向无关性、实时性、无候选 fail-safe 和回归行为。
