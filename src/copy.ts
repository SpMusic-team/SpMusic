export const appCopy = {
  productName: 'SpMusic',
  appTitle: 'shadcn/ui 前端基底已接入',
  appIntro:
    '当前任务只验证组件库、Tailwind、路径别名、前端文案与状态约束，播放器业务界面留给 SP-007。',
  summaryLabel: '前端基底摘要',
  guardrailLabel: '实现边界',
  summary: {
    componentLibrary: '组件基底',
    componentLibraryValue: 'shadcn/ui',
    trackCount: '假歌曲数量',
    spectrumBars: '演示频谱条',
    playbackStatus: '播放状态枚举',
    cssBaseline: '样式基线',
    cssBaselineValue: 'Tailwind + CSS token',
  },
  playbackStatus: {
    paused: '已暂停',
    playing: '播放中',
  },
  components: {
    title: '已接入基础组件',
    description:
      '最小组件目录已经包含后续播放界面会用到的 Button、Card 和 Badge。',
    buttonPreview: 'Button 预览',
  },
  fixtures: {
    title: 'SP-005 数据仍保留',
    description:
      'Track、PlayerState、假歌曲 fixture、演示频谱和 UI-only 状态仍作为后续播放界面的输入。',
  },
  guardrails: [
    {
      title: '不实现播放器业务',
      description:
        '本任务只完成 shadcn/ui 基底接入，不实现播放、暂停、上一首或下一首交互。',
    },
    {
      title: '不引入真实本地能力',
      description:
        '没有接入真实音频、本地文件读取、媒体库、Tauri command、插件或外部服务。',
    },
    {
      title: '保留前端轻量护栏',
      description:
        '用户可见文案集中管理，播放状态继续使用 paused / playing 稳定枚举。',
    },
  ],
} as const
