# 任务：静态播放器外壳实现

## 背景

前端当前仍是模板 starter 页面。

## 目标

用假歌曲数据和 UI-only 播放状态，将模板页面替换为 SpMusic 静态播放器外壳。

## 非目标

- 不实现真实音频播放。
- 不使用 `HTMLAudioElement` 播放文件。
- 不添加媒体库、数据库、播放列表、网络存储或插件系统。

## 负责 Agent

Frontend Agent

## 涉及文件 / 模块

- `src/App.tsx`
- `src/App.css`
- `src/index.css`

## 验收标准

- 页面不再显示 Vite / React starter 文案或链接。
- 页面清晰展示 SpMusic 应用身份。
- 页面展示至少 5 条假歌曲。
- 当前歌曲展示歌曲名、艺术家、专辑、时长中的至少 3 类信息。
- 播放 / 暂停能切换 UI 状态。
- 上一首 / 下一首能切换当前假歌曲。
- 当前歌曲在队列中可识别。
- 代码中存在可渲染的空队列分支。
- `npm run lint` 通过。
- `npm run build` 通过。

## 备注

实现应遵循 UI 规格和架构契约。
