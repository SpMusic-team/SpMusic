import type { CSSProperties } from 'react'

export type PlaylistSongLayoutDescriptor = Readonly<{
  level: number
  label: string
  columns: number
  flow: 'tile' | 'row' | 'text'
  showArtwork: boolean
  style: CSSProperties
}>

export const PLAYLIST_SONG_LAYOUTS: readonly PlaylistSongLayoutDescriptor[] = [
  { level: 0, label: '两列大封面视图', columns: 2, flow: 'tile', showArtwork: true, style: { '--playlist-cover-size': '215px', '--playlist-card-title-size': '20px', '--playlist-card-artist-size': '15px', '--playlist-card-format-size': '13px' } as CSSProperties },
  { level: 1, label: '三列封面视图', columns: 3, flow: 'tile', showArtwork: true, style: { '--playlist-cover-size': '155px', '--playlist-card-title-size': '17px', '--playlist-card-artist-size': '13px', '--playlist-card-format-size': '12px' } as CSSProperties },
  { level: 2, label: '四列封面视图', columns: 4, flow: 'tile', showArtwork: true, style: { '--playlist-cover-size': '110px', '--playlist-card-title-size': '15px', '--playlist-card-artist-size': '12px', '--playlist-card-format-size': '11px' } as CSSProperties },
  { level: 3, label: '单列大封面视图', columns: 1, flow: 'row', showArtwork: true, style: { '--playlist-cover-size': '135px', '--playlist-card-min-height': '165px', '--playlist-card-title-size': '30px', '--playlist-card-artist-size': '24px', '--playlist-card-format-size': '18px' } as CSSProperties },
  { level: 4, label: '单列中封面视图', columns: 1, flow: 'row', showArtwork: true, style: { '--playlist-cover-size': '96px', '--playlist-card-min-height': '120px', '--playlist-card-title-size': '23px', '--playlist-card-artist-size': '18px', '--playlist-card-format-size': '14px' } as CSSProperties },
  { level: 5, label: '单列小封面视图', columns: 1, flow: 'row', showArtwork: true, style: { '--playlist-cover-size': '58px', '--playlist-card-min-height': '76px', '--playlist-card-title-size': '17px', '--playlist-card-artist-size': '13px', '--playlist-card-format-size': '11px' } as CSSProperties },
  { level: 6, label: '单列详细文本视图', columns: 1, flow: 'text', showArtwork: false, style: { '--playlist-card-min-height': '64px', '--playlist-card-title-size': '17px', '--playlist-card-artist-size': '13px', '--playlist-card-format-size': '11px' } as CSSProperties },
  { level: 7, label: '单列紧凑文本视图', columns: 1, flow: 'text', showArtwork: false, style: { '--playlist-card-min-height': '48px', '--playlist-card-title-size': '15px', '--playlist-card-artist-size': '12px', '--playlist-card-format-size': '10px' } as CSSProperties },
  { level: 8, label: '单列极简文本视图', columns: 1, flow: 'text', showArtwork: false, style: { '--playlist-card-min-height': '36px', '--playlist-card-title-size': '14px', '--playlist-card-artist-size': '11px', '--playlist-card-format-size': '9px' } as CSSProperties },
  { level: 9, label: '双列紧凑文本视图', columns: 2, flow: 'text', showArtwork: false, style: { '--playlist-card-min-height': '40px', '--playlist-card-title-size': '14px', '--playlist-card-artist-size': '11px', '--playlist-card-format-size': '9px' } as CSSProperties },
]

export const PLAYLIST_LAYOUT_STORAGE_KEY = 'spmusic.playlist.layout-level.v1'
export const ALL_SONGS_LAYOUT_STORAGE_KEY = 'spmusic.all-songs.layout-level.v1'
export const defaultPlaylistSongLevel = () => typeof window !== 'undefined' && window.innerWidth > 1024 ? 0 : 3
export const defaultAllSongsLevel = () => 4
