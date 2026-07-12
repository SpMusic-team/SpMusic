import type { RefObject } from 'react'
import { appCopy } from '@/features/player/model/playerCopy'
import type { Track } from '@/features/player/model/playerTypes'

type LyricsPanelProps = {
  track: Track
  activeLyricId?: string
  activeLyricIndex: number
  showTranslations: boolean
  lyricListRef: RefObject<HTMLOListElement | null>
  lyricRefs: RefObject<Map<string, HTMLLIElement>>
}

export function LyricsPanel({ track, activeLyricId, activeLyricIndex, showTranslations, lyricListRef, lyricRefs }: LyricsPanelProps) {
  return (
    <section className="lyrics-panel" aria-labelledby="lyrics-title">
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
              {showTranslations ? <span className="translation-line" lang="zh-CN">{line.translation}</span> : null}
            </li>
          ))}
        </ol>
      ) : <p>{appCopy.lyrics.empty}</p>}
    </section>
  )
}
