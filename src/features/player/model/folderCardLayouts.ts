import type { CSSProperties } from 'react'

export type FolderCardLayout = {
  level: number
  variant: 'tile' | 'row-wide' | 'row-compact' | 'text-two-line' | 'text-single' | 'text-double'
  size: 'large' | 'medium' | 'small'
  flow: 'tile' | 'row' | 'text'
  coverWidth: number
  coverHeight: number
  cardWidth: number | null
  folderGlyph: 16 | 24 | 28 | 32 | 48
  musicGlyph: 'large' | 'medium' | 'small'
  showParent: boolean
  showStatistics: boolean
  style: CSSProperties
}

const definitions = [
  { variant: 'tile', size: 'large', flow: 'tile', coverWidth: 240, coverHeight: 240, cardWidth: 270, folderGlyph: 28, musicGlyph: 'small', showParent: true, showStatistics: false, title: 16, titleLine: 24, parent: 14, parentLine: 20, meta: 14, metaLine: 20 },
  { variant: 'tile', size: 'medium', flow: 'tile', coverWidth: 155, coverHeight: 155, cardWidth: 185, folderGlyph: 24, musicGlyph: 'small', showParent: true, showStatistics: false, title: 16, titleLine: 24, parent: 14, parentLine: 20, meta: 14, metaLine: 20 },
  { variant: 'tile', size: 'small', flow: 'tile', coverWidth: 120, coverHeight: 120, cardWidth: 130, folderGlyph: 16, musicGlyph: 'small', showParent: true, showStatistics: false, title: 16, titleLine: 24, parent: 14, parentLine: 20, meta: 14, metaLine: 20 },
  { variant: 'row-wide', size: 'large', flow: 'row', coverWidth: 240, coverHeight: 165, cardWidth: null, folderGlyph: 48, musicGlyph: 'large', showParent: true, showStatistics: true, title: 32, titleLine: 40, parent: 28, parentLine: 36, meta: 28, metaLine: 36 },
  { variant: 'row-wide', size: 'medium', flow: 'row', coverWidth: 155, coverHeight: 107, cardWidth: null, folderGlyph: 48, musicGlyph: 'medium', showParent: true, showStatistics: true, title: 28, titleLine: 36, parent: 28, parentLine: 36, meta: 24, metaLine: 32 },
  { variant: 'row-compact', size: 'small', flow: 'row', coverWidth: 64, coverHeight: 64, cardWidth: null, folderGlyph: 32, musicGlyph: 'small', showParent: true, showStatistics: true, title: 24, titleLine: 32, parent: 16, parentLine: 24, meta: 14, metaLine: 20 },
  { variant: 'text-two-line', size: 'large', flow: 'text', coverWidth: 0, coverHeight: 0, cardWidth: null, folderGlyph: 32, musicGlyph: 'small', showParent: true, showStatistics: true, title: 24, titleLine: 32, parent: 16, parentLine: 24, meta: 14, metaLine: 20 },
  { variant: 'text-single', size: 'medium', flow: 'text', coverWidth: 0, coverHeight: 0, cardWidth: null, folderGlyph: 16, musicGlyph: 'small', showParent: false, showStatistics: true, title: 24, titleLine: 32, parent: 0, parentLine: 0, meta: 14, metaLine: 20 },
  { variant: 'text-single', size: 'small', flow: 'text', coverWidth: 0, coverHeight: 0, cardWidth: null, folderGlyph: 16, musicGlyph: 'small', showParent: false, showStatistics: true, title: 24, titleLine: 32, parent: 0, parentLine: 0, meta: 14, metaLine: 20 },
  { variant: 'text-double', size: 'small', flow: 'text', coverWidth: 0, coverHeight: 0, cardWidth: 270, folderGlyph: 16, musicGlyph: 'small', showParent: false, showStatistics: true, title: 24, titleLine: 32, parent: 0, parentLine: 0, meta: 14, metaLine: 20 },
] as const

// A folder's ten slots follow the song collection's flow ordering, while their
// geometry and field structure come from the folder component's own variants.
export const FOLDER_CARD_LAYOUTS: readonly FolderCardLayout[] = definitions.map((entry, level) => ({
  ...entry, level,
  style: {
    '--folder-cover-width': `${entry.coverWidth}px`, '--folder-cover-height': `${entry.coverHeight}px`,
    '--folder-card-width': entry.cardWidth ? `${entry.cardWidth}px` : '100%',
    '--folder-title-size': `${entry.title}px`, '--folder-title-line': `${entry.titleLine}px`,
    '--folder-parent-size': `${entry.parent}px`, '--folder-parent-line': `${entry.parentLine}px`,
    '--folder-meta-size': `${entry.meta}px`, '--folder-meta-line': `${entry.metaLine}px`,
  } as CSSProperties,
}))
