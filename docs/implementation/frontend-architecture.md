---
doc_id: "IMPL-FRONTEND-ARCHITECTURE"
title: "前端架构实现说明"
doc_type: "implementation"
status: "active"
owner_agent: "Frontend Agent"
version_scope: "project"
created: "2026-07-13"
updated: "2026-07-27"
source_documents:
  - "user request: @frontend 可以写一篇前端架构文档"
  - ".agents/prompt/Frontend_Agent.md"
  - "src/app/App.tsx"
  - "src/features/appearance"
  - "src/features/player"
  - "components.json"
  - "docs/architecture/real-audio-playback.md"
  - "docs/tasks/sp-017-frontend-real-audio-integration.md"
  - "user request: CC 图标是桌面字幕开关，不是翻译功能"
---

# 前端架构实现说明

## 摘要

SpMusic 前端采用 React + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui Base UI 的轻量 feature 分层结构。当前前端以桌面音乐播放器壳层为核心，同时已经预留应用级外观系统，用于后续支持用户自定义主题、动效和图标包。

本说明只描述当前 `src/` 前端实现结构、组件边界、状态边界和扩展约束，不替代产品需求、UI/UX 规格或跨端架构决策。

## 当前技术栈

- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- shadcn/ui，当前配置为 Base UI 风格
- Tauri CLI 已作为桌面壳工具存在，播放器 v0.1 已接入真实本地音频播放 command；demo 数据仍用于界面展示、歌词和队列占位

## 总体目录结构

```txt
src/
  main.tsx
  index.css

  app/
    App.tsx

  features/
    appearance/
      components/
      hooks/
      model/

    player/
      components/
      data/
      hooks/
      model/
      styles/

  components/
    ui/

  icons/
    providers/
    systemIcons.ts
    types.ts

  lib/
    utils.ts
```

这套结构的原则是：

- `app/` 只做应用入口和顶层 Provider 组合。
- `features/` 放有业务含义的功能模块。
- `components/ui/` 只放 shadcn/ui 基础组件，不放业务播放器组件。
- `icons/` 维护图标 provider 和统一图标契约。
- `lib/` 放跨功能复用的通用工具。

## 应用入口层

入口文件：

- `src/main.tsx`
- `src/app/App.tsx`

`main.tsx` 负责挂载 React 根节点。`App.tsx` 当前只组合全局外观 Provider 和播放器壳层：

```tsx
<AppearanceProvider>
  <PlayerShell />
  <Toaster />
</AppearanceProvider>
```

入口层不应该放播放器业务状态、播放算法、样式细节或后端调用细节。这样后续增加设置页、媒体库页或路由时，不会把 `App.tsx` 变成全局杂物间。

## Appearance 模块

目录：

```txt
src/features/appearance/
  components/
    AppearanceProvider.tsx
    ThemeManager.tsx
  hooks/
    useAppearance.ts
  model/
    appearanceContext.ts
    appearanceCss.ts
    appearanceRuntime.ts
    appearanceStorage.ts
    appearanceThemeCodec.ts
    appearanceTypes.ts
    builtinAppearances.ts
    defaultAppearance.ts
```

Appearance 模块负责应用级外观能力，包括：

- 主题 token
- 跟随系统、固定浅色和固定深色三种配色偏好
- 每个主题成对的浅色与深色 token
- 动效等级
- 图标 provider
- 版本化主题导入、导出和迁移
- 用户主题持久化与运行时预览
- 普通、高级和实验三级主题能力

当前 `AppearanceProvider` 负责把选中的 `AppearancePreset` 和解析后的配色模式交给 runtime。Provider 监听 `prefers-color-scheme: dark`；仅当偏好为 `system` 时，系统外观变化会实时改变 `resolvedColorScheme`。runtime 会把当前色板的 CSS variables、`data-color-scheme`、兼容 `.dark` 类和 CSS `color-scheme` 同步到应用根、`documentElement` 和 `body`，保证播放器以及挂在 `body` 下的 Base UI Portal 弹窗使用同一套语义 token；高级主题还会复用单一 `<style>` 节点注入 CSS，并在切换或卸载时清理。

```tsx
<div
  className="spmusic-app"
  data-color-scheme={resolvedColorScheme}
  data-theme={appearance.id}
  data-theme-tier={appearance.metadata.tier}
  data-motion={appearance.motion.level}
  data-icon-pack={appearance.icons.provider}
  data-surface-variant={appearance.components.surface}
  data-button-variant={appearance.components.buttons}
  data-window-controls={appearance.components.windowControls}
>
  {children}
</div>
```

### Appearance 数据模型

核心类型是 `AppearancePreset`，当前包含：

- `colorSchemes.light/dark`：成对的应用颜色和播放器关键颜色
- `radii`：圆角 token
- `motion`：动效等级、时长倍率、缓动曲线
- `typography`：字体和字号倍率
- `components`：表面、按钮和窗口控制变体
- `icons`：图标 provider id
- `advanced.customCss`：高级主题的作用域 CSS
- `experimental.layoutCss/resources`：实验布局覆盖和资源声明
- `metadata`：主题等级、能力、作者、说明和风险确认状态

默认配置位于 `defaultAppearance.ts`。默认主题不是一套脱离主题系统的硬编码特例，而是完整、可序列化、可校验的标准级 `AppearancePreset`。内置主题和用户主题都经过同一套类型、runtime 和 CSS token 管线。

配色偏好不是主题文件的一部分，而是用户运行时设置：`colorSchemePreference` 保存 `system | light | dark`，`resolvedColorScheme` 保存当前实际生效的 `light | dark`。偏好与主题 id 一起写入版本化 localStorage，并通过 `storage` 事件跨窗口同步；预览取消时会同时恢复已保存的主题和配色偏好。

导入文件必须先经过 `appearanceThemeCodec.ts` 的版本检查、迁移和白名单校验，再转换成 `AppearancePreset`。当前导出 schema 为 v3；旧 v1/v2 文档中的单份 `colors` 会迁移为浅色和深色两份相同色板，以保持旧主题的原始视觉。v3 导入也允许用户只提供 `theme.colors` 单色板，或只提供 `colorSchemes.light` / `colorSchemes.dark` 其中一份，codec 会复制补齐为内部标准的 `colorSchemes.light/dark`。两份色板完全相同时，导出与本地存储使用较简洁的 `theme.colors`。局部缺失或非法 token 会按当前基准色板逐字段回退。业务组件不得直接读取任意导入对象，也不得自行解析主题 JSON。

### 主题系统开发模式

新增官方 UI 样式或动效时，默认开发顺序是：

1. 在 `AppearancePreset` 中增加结构化、可校验的主题字段；必要时同步升级主题 schema 和迁移函数。
2. 在默认主题和所有内置主题中给出稳定默认值。默认效果必须由标准主题数据完整表达。
3. 在 `appearanceCss.ts` 或 `appearanceRuntime.ts` 中把字段映射为 CSS variables 或受控 `data-*` 属性。
4. 在 `src/index.css` 或 feature CSS 中消费这些变量和属性。
5. 只有用户主动进入高级或实验主题时，才使用 `customCss` 或 `layoutCss`。

官方默认效果不得塞进 `defaultAppearance.advanced.customCss`。否则默认视觉会绕过类型、schema、迁移、编辑 UI、reduced-motion 和回退机制，导致默认主题与普通主题的能力不对等。

例如未来增加歌词弹性、逐字推进、模糊程度、位移距离或滚动跟随强度时，应先定义类似 `lyricsMotion` 的结构化字段，约束枚举和数值范围，再映射为 `--lyrics-*` 变量并暴露主题编辑控件。不要先在默认 CSS 或 `customCss` 中写死复杂效果，再补配置入口。

结构化字段应满足：

- 有明确类型、默认值和合法范围。
- 能被主题 codec 序列化、反序列化和迁移。
- 非法输入可逐字段回退，不污染当前已应用主题。
- `off` 和系统 `prefers-reduced-motion` 能覆盖相关运动效果。
- 普通主题编辑器可以安全暴露对应控件。

### CSS token 边界

全局 token 定义在 `src/index.css`，核心变量包括：

```css
--app-bg
--app-surface
--app-text
--app-accent
--app-radius-sm
--app-radius-md
--app-radius-lg
--app-motion-fast
--app-motion-standard
--app-motion-slow
--app-motion-easing
```

播放器专属变量也可以由 Appearance 下发：

```css
--player-blue
--player-blue-soft
--player-blue-ink
--player-ink
--player-muted
```

后续新增页面或组件时，应优先消费 `--app-*` token。只有播放器高度定制视觉才使用 `--player-*` token。

### 动效规则

动效通过 `data-motion` 和 CSS variable 控制。当前支持的类型模型为：

- `off`
- `subtle`
- `expressive`

当前默认值是 `subtle`。当 `data-motion="off"` 时，全局 CSS 会尽量压缩 animation 和 transition 时长。JS 驱动的歌词滚动也会读取 `--app-motion-slow`，避免 CSS 和 JS 动效割裂。

### 图标规则

图标 provider 定义在 `src/icons/systemIcons.ts`：

```ts
iconProviders = {
  default,
  ios,
  fluent,
  windows,
  fallback,
}
```

业务组件不应该直接固定使用 `systemIcons`。组件内应通过：

```ts
const systemIcons = useSystemIcons()
```

获取当前图标包。这样后续用户切换图标风格时，整个应用可以统一生效。

## Player 模块

目录：

```txt
src/features/player/
  components/
    PlayerShell.tsx
    WindowBar.tsx
    CoverPanel.tsx
    LyricsPanel.tsx
    ControlDock.tsx
    QueuePanel.tsx
    EmptyPlayerState.tsx
    IconButton.tsx

  data/
    demoTracks.ts
    demoSpectrum.ts

  hooks/
    useActiveLyricScroll.ts

  model/
    playbackModes.ts
    playerCopy.ts
    playerState.ts
    playerTypes.ts
    trackUtils.ts

  services/
    audioCommands.ts

  styles/
    player.css
```

### PlayerShell 职责

`PlayerShell.tsx` 是播放器 feature 的编排组件，负责：

- 持有当前 demo 播放状态和真实音频播放状态
- 派生当前曲目、播放进度、歌词激活行
- 组合播放器 UI 区块
- 调用播放模式算法
- 在 demo 曲目上处理前端模拟播放进度
- 在真实音频曲目上调用 `audioCommands.ts`，消费后端返回的播放状态和进度

`PlayerShell` 不应该继续膨胀成所有 UI 细节的容器。新增视觉区块时应优先拆到 `components/`；新增纯逻辑时应优先放入 `model/`；新增浏览器行为 hook 时应放入 `hooks/`。

### 组件层职责

播放器组件按 UI 区域拆分：

- `WindowBar`：顶部窗口操作区。
- `CoverPanel`：封面、喜欢/不喜欢、更多菜单、曲目信息胶囊。
- `LyricsPanel`：歌词列表、当前歌词状态和歌词内译文行展示；不消费底部 `CC` / 桌面字幕开关。
- `ControlDock`：进度条、播放/暂停、上一首/下一首、随机、循环、桌面字幕、音量、队列按钮；桌面字幕在系统 API 未接入时显示为不可用，不调用 Tauri command。
- `QueuePanel`：当前 demo 队列展示。
- `EmptyPlayerState`：曲目为空时的安全 UI。
- `IconButton`：播放器图标按钮封装，统一 tooltip、pressed 状态和 shadcn Button 使用方式。

组件层应尽量只接收明确 props，不直接读 demo 数据，不直接实现播放算法。

### Model 层职责

`model/` 放不依赖 React 渲染生命周期的类型、常量和纯函数：

- `playerTypes.ts`：播放器当前已批准的数据类型。
- `playerState.ts`：当前 demo 初始状态。
- `playbackModes.ts`：随机、循环、下一首解析算法。
- `trackUtils.ts`：曲目解析、时间格式化等工具。
- `playerCopy.ts`：播放器文案。

后续接入真实后端数据时，应先由 Architecture Agent 或 Rust/Tauri Agent 明确 Tauri command 输入输出契约，再替换 `playerState` 或新增前端 command adapter。不要在前端自行假设本地文件系统、音频引擎或媒体库能力已经存在。

### Services 层职责

`services/audioCommands.ts` 是 v0.1 真实播放的前端 command adapter，负责封装：

- `audio_open_file`
- `audio_play`
- `audio_pause`
- `audio_stop`
- `audio_seek`
- `audio_get_state`
- `audio_get_current_track`
- `audio_state_changed` 事件监听

UI 不直接调用 `@tauri-apps/api/core`，而是通过 service 层消费稳定 DTO：`AudioTrackRef`、`AudioPlaybackState`、`AudioCommandError`。前端业务判断使用 `AudioCommandError.code`，不依赖后端 `message`。

### Data 层职责

`data/` 当前只放 demo 数据：

- `demoTracks.ts`
- `demoSpectrum.ts`

这些数据只能代表当前界面演示状态，不能在文案或实现中描述为真实媒体库、真实扫描结果或真实播放能力。

### Hooks 层职责

`useActiveLyricScroll.ts` 负责歌词激活行的滚动行为。它是浏览器行为 hook，不包含业务播放规则。后续如果加入真实音频进度同步，也应保持：

- 音频状态同步归播放状态层处理。
- 歌词滚动只消费当前激活歌词 id。

## shadcn/ui 使用边界

当前项目已存在：

- `components.json`
- `src/components/ui/*`
- Tailwind CSS v4 配置
- shadcn Base UI 风格组件

规则：

- 业务组件放在 `features/*/components/`，不要放进 `src/components/ui/`。
- `src/components/ui/` 只维护 shadcn/ui 基础组件。
- 新增 shadcn 组件前，应确认任务允许新增组件，并使用 `npx.cmd shadcn@latest info --json` 检查当前配置。
- 使用已安装组件时，应使用 `@/components/ui/...` alias。
- 不要绕开 shadcn/ui 体系另建平行基础组件库。

## 样式策略

样式分三层：

1. `src/index.css`：全局 reset、Tailwind/shadcn 引入、应用级 token。
2. `features/appearance`：把 TypeScript 外观 preset 转换成 CSS variables。
3. `features/player/styles/player.css`：播放器专属布局和视觉。

新增 feature 时建议使用：

```txt
src/features/<feature-name>/
  components/
  hooks/
  model/
  styles/
```

如果样式只是某个 feature 私有，应放在该 feature 的 `styles/`。如果样式是全应用 token，应进入 `index.css` 或 Appearance 模块，而不是散落到业务 CSS。

## 主题能力边界

主题系统按风险分为三级：

### 普通主题

普通主题只使用 `AppearancePreset` 中结构化字段，包括颜色、字体、字号倍率、圆角、动效、图标包、窗口按钮和组件变体。这一级是官方默认主题、内置主题以及常规用户主题的首选模式，能够获得完整校验、迁移、编辑、预览、持久化和 reduced-motion 支持。

每个普通主题在运行时都会拥有标准的 `light` 与 `dark` 色板。用户导入主题时可以只写一份单色板；导入边界会自动复制补齐，之后仍可在主题工作室分别编辑浅色与深色。新增官方内置主题时应提供真实的双模式色板，不得用静态 `.dark` 覆盖代替主题数据；Portal 和应用根的配色一致性由 runtime 统一保证。

### 高级主题

高级主题允许 `advanced.customCss`。runtime 使用 `@scope` 把它限制在带 `data-spmusic-theme-scope` 的应用 body 内，因此能覆盖播放器和 Portal UI，但仍可能破坏可读性、可访问性和升级兼容性。应用前必须确认风险；代码会拒绝已知可执行式 CSS 语法，但不会把高级 CSS 当作官方结构化能力。

当某项高级 CSS 用法变成稳定、常用的产品能力时，应把它提升为新的 `AppearancePreset` 字段，而不是继续要求用户复制 CSS 片段。

### 实验主题

实验主题允许 `experimental.layoutCss` 和 `experimental.resources`。`layoutCss` 可执行不加作用域的全局布局覆盖；资源声明支持受控的 `data:`、`blob:`、`http(s):` 和 `file:` 来源模型，实际加载仍受 WebView、CSP 和平台权限限制。实验能力适合探索布局和本地资源引用，不保证跨版本兼容，也绝不包含 JavaScript 或 DOM 插件执行。

三级主题文档都使用版本化 JSON schema。导入发生致命错误时保持当前主题不变；未知字段和局部非法字段产生警告并回退；默认主题可随时恢复。

## Tauri 集成边界

当前前端已接入 v0.1 真实本地音频播放 command，仍未接入媒体库扫描、数据库、真实播放列表或持久化。接入 Tauri command 时应遵守：

- command 名称、输入、输出来自 Architecture Agent 或 Rust/Tauri Agent 的契约。
- 前端 adapter 应单独放在对应 feature 的 service 或 api 文件中。
- UI 必须处理 loading、success、error、unavailable 状态。
- 后端不可用时，界面不能崩溃。
- 不在前端硬编码未批准的系统路径、文件协议、数据库结构或音频引擎行为。

当前真实播放接入采用：

```txt
src/features/player/services/audioCommands.ts
```

前端必须分离两类状态：`AudioTrackRef` 保存低频歌曲资源（元数据、歌词、封面），`AudioPlaybackState` 保存高频传输状态（`currentTrackId`、阶段、进度、时长、音量和错误）。播放/暂停、设备事件以及 500ms 进度同步只能消费轻量 `AudioPlaybackState`；仅在打开文件或恢复连接且歌曲详情缺失时获取 `AudioTrackRef`。

播放键在未加载真实音频时会先调用 `audio_open_file`，用户选择文件后再调用 `audio_play`；已加载真实音频后，播放键在 `audio_play` 与 `audio_pause` 之间切换。真实音频播放中，前端每 500ms 调用 `audio_get_state` 刷新进度；进度条拖动调用 `audio_seek`。左侧波形按钮作为“打开音频”入口，可重新选择一个本地音频文件。

后端检测到输出设备变化时会发送 `audio_state_changed` 事件，payload 为 `AudioPlaybackState`。`PlayerShell` 在挂载时注册监听，收到事件后立即应用后端状态；轮询仍作为播放进度和事件漏收时的兜底同步。

后续如果需要媒体库 command，可新增：

```txt
src/features/media-library/services/libraryCommands.ts
```

但只有在对应 capability 获批并有后端契约后再创建。

## 新增前端功能的放置规则

### 新增播放器内部 UI

放在：

```txt
src/features/player/components/
```

如果需要纯函数或类型，放在：

```txt
src/features/player/model/
```

### 新增应用设置或外观配置 UI

建议创建：

```txt
src/features/settings/
```

或如果只服务外观系统，放在：

```txt
src/features/appearance/components/
```

### 新增媒体库能力

在媒体库需求获批前，不应提前实现真实扫描。获批后建议创建：

```txt
src/features/media-library/
```

### 新增跨功能通用基础 UI

优先使用 shadcn/ui。只有确实是项目自有基础能力，并且不是业务组件时，才考虑放在：

```txt
src/components/
```

不要把播放器、媒体库、设置页等业务组件放进 `components/ui/`。

## 当前已知限制

- 播放器仍保留 demo 数据用于界面展示、歌词和队列占位，不代表真实媒体库。
- 已接入单个本地音频资源的真实播放、暂停、seek 和状态查询；尚未实现媒体库、真实播放列表或歌词与真实音频文件同步。
- Appearance 已提供三个内置主题、主题管理 UI、版本化 JSON 导入导出和 localStorage 持久化；当前持久化仍受浏览器存储配额限制。
- 图标 provider 已有基础切换管线，但尚未提供用户自定义 SVG 图标包加载。
- 高级和实验 CSS 可能破坏布局或可访问性；实验资源是否可加载取决于 WebView、CSP 和平台权限。

## 验证方式

修改前端结构或 Appearance 管线后，至少运行：

```bash
npm.cmd run lint
npm.cmd run build
```

在 Windows PowerShell 执行环境中，如果 `npm` 或 `npx` 被脚本签名策略拦截，应使用 `npm.cmd` 或 `npx.cmd`。

## 维护原则

- 保持 `App.tsx` 薄入口。
- 保持 feature 内聚，不把业务组件塞进全局 UI 基础层。
- 保持 demo 能力和真实能力的表述边界。
- 优先使用应用级 token，而不是散落硬编码颜色、圆角、动效时长。
- 官方新增视觉和动效能力先扩展 `AppearancePreset`，再由 runtime 映射变量并由 CSS 消费；不要写进默认主题的 `customCss`。
- 图标统一通过 `useSystemIcons()` 获取。
- 后端能力未获批前，不提前实现真实文件、音频、数据库或插件能力。
