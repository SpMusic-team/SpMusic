export const appCopy = {
  productName: 'SpMusic',
  foundationTitle: '前端基础骨架已就绪',
  foundationIntro:
    '已集中准备 v0.1 播放界面所需的类型、假歌曲、初始状态、展示文案和基础视觉 token。',
  summaryLabel: '前端基础摘要',
  guardrailLabel: '实现约束',
  summary: {
    trackCount: '假歌曲数量',
    initialStatus: '初始播放状态',
    currentTrack: '默认当前歌曲',
    progress: '初始进度',
    spectrumBars: '演示频谱条',
    noCurrentTrack: '暂无当前歌曲',
  },
  playbackStatus: {
    paused: '已暂停',
    playing: '播放中',
  },
  guardrails: [
    {
      title: '稳定状态枚举',
      description:
        '播放状态只使用 paused / playing，中文只作为展示文案，不进入业务状态。',
    },
    {
      title: '固定假歌曲数据',
      description:
        '演示歌曲只用于 UI-only 状态验证，不表达真实媒体库、路径、来源或持久化能力。',
    },
    {
      title: 'UI-only 进度与频谱',
      description:
        '播放进度和频谱只使用前端演示状态，不读取音频、不分析音频，也不触发真实播放。',
    },
    {
      title: '集中视觉 token',
      description:
        '颜色、间距、圆角和状态色由全局 CSS 变量提供，后续界面实现复用同一基础。',
    },
    {
      title: '范围保持轻量',
      description:
        '当前不引入路由、全局状态库、i18n 框架、主题系统、Tauri command 或真实音频播放。',
    },
  ],
  fixture: {
    eyebrow: 'Fixture',
    title: 'v0.1 假歌曲数据',
  },
} as const
