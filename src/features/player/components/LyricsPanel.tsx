import type { KeyboardEvent, RefObject } from 'react'
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
  onLineSelect: (timeSeconds: number) => void
}

export function LyricsPanel({ track, activeLyricId, activeLyricIndex, lyricListRef, lyricRefs, onLineSelect }: LyricsPanelProps) {
  const appearanceMotion = useAppearanceMotion()

  function handleLineKeyDown(event: KeyboardEvent<HTMLLIElement>, timeSeconds: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onLineSelect(timeSeconds)
    }
  }

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
              ref={(node) => {
                if (node) lyricRefs.current.set(line.id, node)
                else lyricRefs.current.delete(line.id)
              }}
              role="button"
              tabIndex={0}
              aria-current={line.id === activeLyricId ? 'true' : undefined}
              data-active={line.id === activeLyricId}
              data-position={index < activeLyricIndex ? 'past' : index === activeLyricIndex ? 'active' : 'future'}
              onClick={() => onLineSelect(line.timeSeconds)}
              onKeyDown={(event) => handleLineKeyDown(event, line.timeSeconds)}
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
