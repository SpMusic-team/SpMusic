---
doc_id: "IMPL-FRONTEND-ARCHITECTURE"
title: "前端架构实现说明"
doc_type: "implementation"
status: "active"
owner_agent: "Frontend Agent"
version_scope: "project"
created: "2026-07-13"
updated: "2026-07-13"
source_documents:
  - "user request: @frontend 可以写一篇前端架构文档"
  - ".agents/prompt/Frontend_Agent.md"
  - "src/app/App.tsx"
  - "src/features/appearance"
  - "src/features/player"
  - "components.json"
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
- Tauri CLI 已作为桌面壳工具存在，但当前前端播放器仍使用 demo 数据和前端模拟播放状态

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
</AppearanceProvider>
```

入口层不应该放播放器业务状态、播放算法、样式细节或后端调用细节。这样后续增加设置页、媒体库页或路由时，不会把 `App.tsx` 变成全局杂物间。

## Appearance 模块

目录：

```txt
src/features/appearance/
  components/
    AppearanceProvider.tsx
  hooks/
    useAppearance.ts
  model/
    appearanceContext.ts
    appearanceCss.ts
    appearanceTypes.ts
    defaultAppearance.ts
```

Appearance 模块负责应用级外观能力，包括：

- 主题 token
- 动效等级
- 图标 provider
- 后续用户主题导入的统一入口

当前 `AppearanceProvider` 会在应用根节点输出：

```tsx
<div
  className="spmusic-app"
  data-theme={appearance.id}
  data-motion={appearance.motion.level}
  data-icon-pack={appearance.icons.provider}
  style={style}
>
  {children}
</div>
```

### Appearance 数据模型

核心类型是 `AppearancePreset`，当前包含：

- `colors`：应用颜色和播放器关键颜色
- `radii`：圆角 token
- `motion`：动效等级、时长倍率、缓动曲线
- `icons`：图标 provider id

当前默认配置在 `defaultAppearance.ts`。后续如果支持用户导入主题 JSON，应该优先转换成 `AppearancePreset`，再交给 `AppearanceProvider`，不要让业务组件直接读取任意用户配置对象。

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

  styles/
    player.css
```

### PlayerShell 职责

`PlayerShell.tsx` 是播放器 feature 的编排组件，负责：

- 持有当前 demo 播放状态
- 派生当前曲目、播放进度、歌词激活行
- 组合播放器 UI 区块
- 调用播放模式算法
- 处理当前前端模拟播放进度

`PlayerShell` 不应该继续膨胀成所有 UI 细节的容器。新增视觉区块时应优先拆到 `components/`；新增纯逻辑时应优先放入 `model/`；新增浏览器行为 hook 时应放入 `hooks/`。

### 组件层职责

播放器组件按 UI 区域拆分：

- `WindowBar`：顶部窗口操作区。
- `CoverPanel`：封面、喜欢/不喜欢、更多菜单、曲目信息胶囊。
- `LyricsPanel`：歌词列表、当前歌词状态和翻译显示。
- `ControlDock`：进度条、播放/暂停、上一首/下一首、随机、循环、字幕、音量、队列按钮。
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

## 后续用户自定义外观的推荐路径

用户希望未来可以自定义整个应用的样式、动效和图标。推荐演进顺序：

1. 设置页选择内置主题、动效等级、图标包。
2. 支持导入受控 `AppearancePreset` JSON。
3. 支持自定义 SVG 图标包，先转换成 `SystemIconProvider`。
4. 最后再考虑高级 CSS 覆盖。

高级 CSS 覆盖必须谨慎，建议至少满足：

- 限定作用域在 `.spmusic-app` 内。
- 禁止远程 `@import`。
- 禁止远程 `url(http...)`。
- 提供恢复默认外观。
- 保存前进行基础校验。
- 出错时回退到默认主题。

当前实现只搭建基础管线，没有开放任意 CSS 注入能力。

## Tauri 集成预留边界

当前前端尚未接入真实音频播放、媒体库扫描或持久化。后续如果需要接入 Tauri command，应遵守：

- command 名称、输入、输出来自 Architecture Agent 或 Rust/Tauri Agent 的契约。
- 前端 adapter 应单独放在对应 feature 的 service 或 api 文件中。
- UI 必须处理 loading、success、error、unavailable 状态。
- 后端不可用时，界面不能崩溃。
- 不在前端硬编码未批准的系统路径、文件协议、数据库结构或音频引擎行为。

建议未来新增：

```txt
src/features/player/services/playerCommands.ts
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

- 播放器仍使用 demo 数据，不代表真实媒体库。
- 播放进度是前端模拟，不代表真实音频引擎。
- Appearance 当前只有默认 preset，尚未提供设置页、持久化或导入能力。
- 图标 provider 已有基础切换管线，但尚未提供用户自定义 SVG 图标包加载。
- 高级 CSS 自定义尚未开放。

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
- 图标统一通过 `useSystemIcons()` 获取。
- 后端能力未获批前，不提前实现真实文件、音频、数据库或插件能力。
