import type { CSSProperties } from 'react'
import { PLAYLIST_SONG_LAYOUTS } from './playlistSongLayouts'

export type PlaylistManagementLayout = Readonly<{
  level: number
  label: string
  flow: 'tile' | 'row' | 'text'
  showArtwork: boolean
  style: CSSProperties
}>

// Version 2 inserts additional densities; preserve the meaning of v1 preferences.
export const PLAYLIST_MANAGEMENT_LAYOUT_STORAGE_KEY = 'spmusic.playlist-management.layout-level.v2'
export const defaultPlaylistManagementLevel = () => {
  try {
    const previous = window.localStorage.getItem('spmusic.playlist-management.layout-level.v1')
    return previous !== null && /^[0-5]$/.test(previous) ? [0, 1, 3, 4, 6, 9][Number(previous)]! : 0
  } catch { return 0 }
}

const definitions: readonly PlaylistManagementLayout[] = [
  { level: 0, label: '大卡片视图', flow: 'tile', showArtwork: true, style: { '--management-cover-width': '240px', '--management-cover-height': '165px', '--management-card-width': '270px', '--management-card-inline-padding': '15px', '--management-title-size': '32px', '--management-title-height': '40px', '--management-column-gap': '48px', '--management-row-gap': '48px' } as CSSProperties },
  { level: 1, label: '中卡片视图', flow: 'tile', showArtwork: true, style: { '--management-cover-width': '155px', '--management-cover-height': '107px', '--management-card-width': '165px', '--management-card-inline-padding': '5px', '--management-title-size': '28px', '--management-title-height': '36px', '--management-column-gap': '28px', '--management-row-gap': '20px' } as CSSProperties },
  { level: 2, label: '小卡片视图', flow: 'tile', showArtwork: true, style: { '--management-cover-width': '120px', '--management-cover-height': '82px', '--management-card-width': '130px', '--management-card-inline-padding': '5px', '--management-title-size': '24px', '--management-title-height': '32px', '--management-column-gap': '28px', '--management-row-gap': '20px' } as CSSProperties },
  { level: 3, label: '大封面单行视图', flow: 'row', showArtwork: true, style: { '--management-cover-width': '240px', '--management-cover-height': '165px', '--management-copy-gap': '32px' } as CSSProperties },
  { level: 4, label: '中封面单行视图', flow: 'row', showArtwork: true, style: { '--management-cover-width': '155px', '--management-cover-height': '107px', '--management-copy-gap': '22px' } as CSSProperties },
  { level: 5, label: '小封面单行视图', flow: 'row', showArtwork: true, style: { '--management-cover-width': '93px', '--management-cover-height': '64px', '--management-copy-gap': '12px', '--management-row-gap': '16px', '--management-item-gap': '24px', '--management-item-block-padding': '12px', '--management-meta-gap': '8px', '--management-icon-size': '16px' } as CSSProperties },
  { level: 6, label: '大间距单列文本视图', flow: 'text', showArtwork: false, style: { '--management-row-gap': '20px' } as CSSProperties },
  { level: 7, label: '中间距单列文本视图', flow: 'text', showArtwork: false, style: { '--management-row-gap': '12px' } as CSSProperties },
  { level: 8, label: '小间距单列文本视图', flow: 'text', showArtwork: false, style: { '--management-row-gap': '4px' } as CSSProperties },
  { level: 9, label: '双列文本视图', flow: 'text', showArtwork: false, style: {} },
]

// Use the same text hierarchy as Songs while preserving list cover geometry.
export const PLAYLIST_MANAGEMENT_LAYOUTS: readonly PlaylistManagementLayout[] = definitions.map((entry, level) => {
  if (entry.flow === 'tile') return entry
  const songStyle = PLAYLIST_SONG_LAYOUTS[level].style
  return { ...entry, style: { ...entry.style,
    '--management-title-size': songStyle['--playlist-card-title-size' as keyof CSSProperties], '--management-title-height': 1.25,
    '--management-meta-size': songStyle['--playlist-card-format-size' as keyof CSSProperties], '--management-meta-height': 1.3,
  } as CSSProperties }
})
