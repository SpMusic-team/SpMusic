export const appCopy = {
  productName: 'SpMusic',
  appTitle: 'SpMusic 播放界面',
  appIntro: '本地优先、轻量安静的桌面音乐播放界面。',
  shellLabel: 'SpMusic 最小播放界面',
  playbackStatus: {
    paused: '已暂停',
    playing: '播放中',
  },
  status: {
    trackCount: '演示歌曲',
    spectrumCount: '频谱条',
    playback: '播放状态',
  },
  nowPlaying: {
    eyebrow: '正在播放',
    emptyTitle: '暂无当前歌曲',
    emptyDescription: '歌曲列表为空时，播放器会保持安全的空状态。',
    artistLabel: '艺术家',
    albumLabel: '专辑',
    durationLabel: '时长',
  },
  controls: {
    previous: '上一首',
    play: '播放',
    pause: '暂停',
    next: '下一首',
  },
  progress: {
    label: '播放进度',
    elapsed: '已播放',
    total: '总时长',
  },
  spectrum: {
    title: '演示频谱',
    description: '当前播放视觉',
    empty: '暂无频谱数据',
  },
  queue: {
    title: '演示队列',
    description: '固定歌曲用于当前界面状态。',
    current: '当前',
    emptyTitle: '暂无演示歌曲',
    emptyDescription: '添加歌曲数据后会显示播放队列。',
  },
} as const
