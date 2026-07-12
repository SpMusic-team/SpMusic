import { appCopy } from '@/features/player/model/playerCopy'
import type { Track } from '@/features/player/model/playerTypes'

type QueuePanelProps = {
  tracks: Track[]
  currentTrackId: string
}

export function QueuePanel({ tracks, currentTrackId }: QueuePanelProps) {
  return (
    <section className="debug-queue-panel" aria-label={appCopy.queue.title}>
      <ol>
        {tracks.map((item, index) => (
          <li key={item.id} data-current={item.id === currentTrackId}>
            <span>{index + 1}</span>
            <strong>{item.title}</strong>
            <small>{item.artist}</small>
          </li>
        ))}
      </ol>
    </section>
  )
}
