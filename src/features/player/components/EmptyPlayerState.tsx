import { motion } from 'motion/react'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import type { PlayerContentState } from '@/features/player/model/playerUiViewModel'

type EmptyPlayerStateProps = {
  state?: Exclude<PlayerContentState, 'track'>
  statusText?: string
}

export function EmptyPlayerState({ state = 'empty', statusText }: EmptyPlayerStateProps) {
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const loading = state === 'loading'
  const error = state === 'error'
  const title = loading ? appCopy.audio.loading : error ? appCopy.audio.unavailable : appCopy.queue.emptyTitle
  const description = error ? statusText : appCopy.queue.emptyDescription

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
            <Empty className="empty-cover-state" data-content-state={state}>
              <EmptyHeader>
                {loading ? <Skeleton className="player-loading-cover-skeleton" /> : (
                  <EmptyMedia variant="icon"><systemIcons.music /></EmptyMedia>
                )}
                <EmptyTitle>{title}</EmptyTitle>
                {error && description ? <EmptyDescription>{description}</EmptyDescription> : null}
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
        {loading ? (
          <>
            <Skeleton className="track-pill player-loading-title-skeleton" />
            <Skeleton className="track-pill player-loading-artist-skeleton" />
          </>
        ) : (
          <>
            <span className="track-pill title-pill">{title}</span>
            <span className="track-pill artist-pill">{description}</span>
          </>
        )}
      </motion.div>

      <motion.section
        layout
        className="lyrics-panel empty-lyrics-panel"
        variants={appearanceMotion.variants.track}
        initial="initial"
        animate="animate"
        aria-labelledby="empty-lyrics-title"
        aria-busy={loading}
      >
        <Empty className="empty-lyrics-state" data-content-state={state}>
          <EmptyHeader>
            {loading ? (
              <div className="player-loading-lyrics" aria-hidden="true">
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            ) : (
              <>
                <EmptyMedia variant="icon"><systemIcons.captions /></EmptyMedia>
                <EmptyTitle id="empty-lyrics-title">{error ? title : appCopy.lyrics.title}</EmptyTitle>
                <EmptyDescription>{error ? description : appCopy.lyrics.empty}</EmptyDescription>
              </>
            )}
            {loading ? <EmptyTitle id="empty-lyrics-title" className="sr-only">{title}</EmptyTitle> : null}
          </EmptyHeader>
        </Empty>
      </motion.section>
    </>
  )
}
