import { memo, useEffect } from 'react'
import { motion } from 'motion/react'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import type { SystemIcon } from '@/icons/systemIcons'
import type { ArtworkVisualLayer } from '@/features/player/hooks/useArtworkVisualResource'
import { ArtworkCanvas } from './ArtworkCanvas'
import { IconButton } from './IconButton'
import { MoreActionsMenu } from './MoreActionsMenu'

type CoverPanelProps = {
  layer: ArtworkVisualLayer | null
  likeIcon: SystemIcon
  dislikeIcon: SystemIcon
  liked: boolean
  disliked: boolean
  onLike: () => void
  onDislike: () => void
  onReady: () => void
  onLoadError: () => void
  onExitComplete: () => void
}

export const CoverPanel = memo(function CoverPanel({
  layer,
  likeIcon,
  dislikeIcon,
  liked,
  disliked,
  onLike,
  onDislike,
  onReady,
  onLoadError,
  onExitComplete,
}: CoverPanelProps) {
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const track = layer?.track
  const artwork = layer?.artwork
  const phase = layer?.phase
  const coverSource = layer?.resource.view

  useEffect(() => {
    if (!layer || !appearanceMotion.disabled || phase !== 'exiting') return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) onExitComplete()
    })
    return () => { cancelled = true }
  }, [appearanceMotion.disabled, layer, onExitComplete, phase])

  useEffect(() => {
    if (phase === 'incoming' && !coverSource) onReady()
  }, [coverSource, onReady, phase])

  return (
    <motion.article
      className="cover-column"
      aria-hidden={!layer || phase === 'exiting' || undefined}
      style={!layer
        ? { pointerEvents: 'none', visibility: 'hidden' }
        : phase === 'exiting'
          ? { pointerEvents: 'none' }
          : undefined}
    >
      <motion.div
        className="cover-frame"
        variants={appearanceMotion.variants.track}
        initial={false}
        animate={!layer || phase === 'exiting' ? 'exit' : phase === 'incoming' ? 'initial' : 'animate'}
        onAnimationComplete={(definition) => {
          if (layer && definition === 'exit') onExitComplete()
        }}
      >
        <div
          className="cover-art"
          data-tone={artwork?.coverTone ?? 'blue'}
          data-has-image={Boolean(coverSource)}
        >
          <div hidden={!coverSource}>
            <ArtworkCanvas
              className="cover-image"
              source={coverSource}
              label={artwork && track && artwork.id === track.id ? `${track.title} 封面` : undefined}
              onReady={onReady}
              onError={onLoadError}
            />
          </div>
          {layer && track && artwork ? <>
            {!coverSource ? <div className="cover-mark"><systemIcons.music /><strong>{appCopy.productName}</strong><span>LOCAL LISTENING</span></div> : null}
            <div className="cover-actions">
              <div className="cover-feedback">
                <IconButton animated icon={likeIcon} label={appCopy.controls.like} selected={liked} onClick={onLike} />
                <IconButton animated icon={dislikeIcon} label={appCopy.controls.dislike} selected={disliked} onClick={onDislike} />
              </div>
              <MoreActionsMenu
                track={track}
                coverSource={artwork.id === track.id ? coverSource : undefined}
                likeIcon={likeIcon}
                dislikeIcon={dislikeIcon}
                liked={liked}
                disliked={disliked}
                onLike={onLike}
                onDislike={onDislike}
              />
            </div>
          </> : null}
        </div>
      </motion.div>
    </motion.article>
  )
})
