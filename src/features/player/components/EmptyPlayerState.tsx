import { motion } from 'motion/react'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'

export function EmptyPlayerState() {
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()

  return (
    <>
      <motion.article layout className="cover-column empty-cover-column">
        <motion.div
          className="cover-frame"
          variants={appearanceMotion.variants.track}
          initial="initial"
          animate="animate"
        >
          <div className="cover-art empty-cover-art">
            <Empty className="empty-cover-state">
              <EmptyHeader>
                <EmptyMedia variant="icon"><systemIcons.music /></EmptyMedia>
                <EmptyTitle>{appCopy.queue.emptyTitle}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          </div>
        </motion.div>
      </motion.article>

      <motion.div
        layout
        className="track-pills empty-track-pills"
        variants={appearanceMotion.variants.track}
        initial="initial"
        animate="animate"
        aria-live="polite"
      >
        <span className="track-pill title-pill">{appCopy.queue.emptyTitle}</span>
        <span className="track-pill artist-pill">{appCopy.queue.emptyDescription}</span>
      </motion.div>

      <motion.section
        layout
        className="lyrics-panel empty-lyrics-panel"
        variants={appearanceMotion.variants.track}
        initial="initial"
        animate="animate"
        aria-labelledby="empty-lyrics-title"
      >
        <Empty className="empty-lyrics-state">
          <EmptyHeader>
            <EmptyMedia variant="icon"><systemIcons.captions /></EmptyMedia>
            <EmptyTitle id="empty-lyrics-title">{appCopy.lyrics.title}</EmptyTitle>
            <EmptyDescription>{appCopy.lyrics.empty}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </motion.section>
    </>
  )
}
