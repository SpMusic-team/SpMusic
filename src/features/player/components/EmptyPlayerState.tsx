import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'

export function EmptyPlayerState() {
  const systemIcons = useSystemIcons()

  return (
    <section className="empty-state">
      <systemIcons.queue />
      <h2>{appCopy.queue.emptyTitle}</h2>
      <p>{appCopy.queue.emptyDescription}</p>
    </section>
  )
}
