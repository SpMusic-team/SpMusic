import type { CSSProperties } from 'react'

export type PlaylistManagementLayout = Readonly<{
  level: number
  label: string
  flow: 'tile' | 'row' | 'text'
  showArtwork: boolean
  style: CSSProperties
}>
export const PLAYLIST_MANAGEMENT_LAYOUT_STORAGE_KEY = 'spmusic.playlist-management.layout-level.v1'
export const defaultPlaylistManagementLevel = () => 0
export const PLAYLIST_MANAGEMENT_LAYOUTS: readonly PlaylistManagementLayout[] = [
  { level: 0, label: '大卡片视图', flow: 'tile', showArtwork: true, style: { '--management-cover-width': '240px', '--management-cover-height': '165px', '--management-card-width': '270px', '--management-card-inline-padding': '15px', '--management-title-size': '32px', '--management-title-height': '40px', '--management-column-gap': '48px', '--management-row-gap': '48px' } as CSSProperties },
  { level: 1, label: '小卡片视图', flow: 'tile', showArtwork: true, style: { '--management-cover-width': '155px', '--management-cover-height': '107px', '--management-card-width': '165px', '--management-card-inline-padding': '5px', '--management-title-size': '28px', '--management-title-height': '36px', '--management-column-gap': '28px', '--management-row-gap': '20px' } as CSSProperties },
  { level: 2, label: '大封面单行视图', flow: 'row', showArtwork: true, style: { '--management-cover-width': '240px', '--management-cover-height': '165px', '--management-title-size': '32px', '--management-title-height': '40px', '--management-meta-size': '28px', '--management-meta-height': '36px', '--management-copy-gap': '32px' } as CSSProperties },
  { level: 3, label: '小封面单行视图', flow: 'row', showArtwork: true, style: { '--management-cover-width': '155px', '--management-cover-height': '107px', '--management-title-size': '28px', '--management-title-height': '36px', '--management-meta-size': '24px', '--management-meta-height': '32px', '--management-copy-gap': '22px' } as CSSProperties },
  { level: 4, label: '单列文本视图', flow: 'text', showArtwork: false, style: { '--management-title-size': '28px', '--management-title-height': '36px', '--management-meta-size': '24px', '--management-meta-height': '32px' } as CSSProperties },
  { level: 5, label: '双列文本视图', flow: 'text', showArtwork: false, style: { '--management-title-size': '28px', '--management-title-height': '36px', '--management-meta-size': '24px', '--management-meta-height': '32px' } as CSSProperties },
]
