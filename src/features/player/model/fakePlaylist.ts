import type { TrackSummary } from './playerTypes'

// 设计稿里「网易-我喜欢」那张播放列表页的占位数据。首版只做前端展示，先不接真实队列，
// 等后续接入后端批量元数据再把这里的假数据替换掉。时长是随意填的，仅用于顶部 `# 数量 | 总时长` 徽标。
export type FakePlaylistTrack = TrackSummary & { durationSeconds: number }

const RAW_TRACKS: ReadonlyArray<readonly [title: string, artist: string, durationSeconds: number]> = [
  ['蜘蛛糸モノ', 'sasakure.UK', 214],
  ['機械の国', 'Feryquitous', 236],
  ['Disruptor Arrangement', 'Akira Complex', 198],
  ['Catanoph', 'An - AD:PIANO', 205],
  ['GRAVITY ZERO', 'seatrus', 221],
  ['MEGATON KICK', 'BlackY / Yooh', 187],
  ['Downburst', 'BlackY', 244],
  ['CLOUD9999', 'XENVITA / Kirin', 176],
  ['Acid Rain', 'Qlarabelle / Yuta', 209],
  ['Singularity', 'ETIA.', 232],
  ['Myosotis', 'M2U / Guriri', 197],
  ['Live Fast Die Young', 'anubasu-anub', 183],
  ['「籠のなか」', '増田俊郎', 226],
  ['情绪回收站', '失落花园', 240],
  ['ARTEMIS', 'BlackY', 215],
  ['LAMIA', 'BlackY', 203],
  ['BERLIN WALL', 'Kobaryo', 191],
  ['Unite the World', 'Daisuke', 172],
]

export const fakePlaylistName = '网易-我喜欢'

export const fakePlaylistTracks: FakePlaylistTrack[] = RAW_TRACKS.map(
  ([title, artist, durationSeconds], index) => ({
    id: `demo-playlist-${index + 1}`,
    title,
    artist,
    album: fakePlaylistName,
    category: '单曲',
    durationSeconds,
  }),
)

export const fakePlaylistTotalSeconds = fakePlaylistTracks.reduce(
  (total, track) => total + track.durationSeconds,
  0,
)
