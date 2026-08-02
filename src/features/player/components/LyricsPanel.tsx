import type { RefObject } from 'react'
import { motion } from 'motion/react'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import type { Track } from '@/features/player/model/playerTypes'

type LyricsPanelProps = {
  track: Track
  activeLyricId?: string
  activeLyricIndex: number
  lyricListRef: RefObject<HTMLOListElement | null>
  lyricRefs: RefObject<Map<string, HTMLLIElement>>
}

export function LyricsPanel({ track, activeLyricId, activeLyricIndex, lyricListRef, lyricRefs }: LyricsPanelProps) {
  const appearanceMotion = useAppearanceMotion()

  return (
    <motion.section
      layout
      className="lyrics-panel"
      variants={appearanceMotion.variants.track}
      initial="initial"
      animate="animate"
      aria-labelledby="lyrics-title"
    >
      <h2 id="lyrics-title" className="sr-only">{appCopy.lyrics.title}</h2>
      {track.lyrics.length ? (
        <ol ref={lyricListRef}>
          {track.lyrics.map((line, index) => (
            <li
              key={line.id}
              ref={(node) => { if (node) lyricRefs.current.set(line.id, node) }}
              data-active={line.id === activeLyricId}
              data-position={index < activeLyricIndex ? 'past' : index === activeLyricIndex ? 'active' : 'future'}
            >
              <span>{line.original}</span>
              {line.translation ? <span className="translation-line" lang="zh-CN">{line.translation}</span> : null}
            </li>
          ))}
        </ol>
      ) : <p>{appCopy.lyrics.empty}</p>}
    </motion.section>
  )
}
