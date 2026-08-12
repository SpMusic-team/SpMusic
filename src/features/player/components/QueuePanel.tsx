import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import type { Track } from '@/features/player/model/playerTypes'

type QueuePanelProps = {
  tracks: Track[]
  unavailableTrackIds?: ReadonlySet<string>
  currentTrackId: string
  playlistName?: string
  onTrackSelect?: (trackId: string) => void
}

export function QueuePanel({
  tracks,
  unavailableTrackIds,
  currentTrackId,
  playlistName,
  onTrackSelect,
}: QueuePanelProps) {
  const appearanceMotion = useAppearanceMotion()

  return (
    <motion.section
      className="debug-queue-panel"
      aria-label={appCopy.queue.title}
      variants={appearanceMotion.variants.panel}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {playlistName ? (
        <header>
          <strong>{playlistName}</strong>
          <small>{tracks.length} 首音频</small>
        </header>
      ) : null}
      <ol>
        {tracks.map((item, index) => (
          <li key={item.id} data-current={item.id === currentTrackId}>
            <Button
              variant="ghost"
              type="button"
              aria-current={item.id === currentTrackId ? 'true' : undefined}
              disabled={!onTrackSelect || unavailableTrackIds?.has(item.id)}
              onClick={() => onTrackSelect?.(item.id)}
            >
              <span>{index + 1}</span>
              <strong>{item.title}</strong>
              <small>{item.artist}</small>
            </Button>
          </li>
        ))}
      </ol>
    </motion.section>
  )
}
