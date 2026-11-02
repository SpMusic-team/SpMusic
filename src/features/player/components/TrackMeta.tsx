import { PingPongText } from '@/components/PingPongText'
import { Button } from '@/components/ui/button'
import { usePlaylistCardLongPress } from '../hooks/usePlaylistCardLongPress'
import { motion } from 'motion/react'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import type { ArtworkVisualLayer } from '@/features/player/hooks/useArtworkVisualResource'
import { playerViewTransitionLayoutId } from '@/features/player/model/playerViewTransition'

type TrackMetaProps = {
  layer: ArtworkVisualLayer | null
  ownsPlayerViewTransition: boolean
  interactive?: boolean
  onMore?: () => void
  onArtistSongs?: () => void
  onConsumedPointer?: (pointer: { pointerId: number; pointerType: string }) => void
}

export function TrackMeta({ layer, ownsPlayerViewTransition, interactive = false, onMore, onArtistSongs, onConsumedPointer }: TrackMetaProps) {
  const appearanceMotion = useAppearanceMotion()
  const track = layer?.track
  const phase = layer?.phase
  const sharedLayoutId = ownsPlayerViewTransition
    ? playerViewTransitionLayoutId('copy', track?.id)
    : undefined
  const titlePress = usePlaylistCardLongPress({ identity: track?.id ?? '', disabled: !interactive,
    selectMode: false, onEnterSelectMode: onMore, onConsumedPointer })
  const artistPress = usePlaylistCardLongPress({ identity: track?.id ?? '', disabled: !interactive,
    selectMode: false, onEnterSelectMode: onArtistSongs, onConsumedPointer })

  return (
    <motion.div
      // Keep the projection node's mount-time identity in sync with its owner.
      key={sharedLayoutId ?? 'unshared-copy'}
      className="track-pills"
      layoutId={sharedLayoutId}
      transition={{ layout: appearanceMotion.layoutTransition }}
      aria-live={phase === 'active' ? 'polite' : undefined}
    >
      {track ? <>
        <Button variant="ghost" className="track-pill title-pill" disabled={!interactive || !onMore} aria-label={`${track.title}，更多操作`}
          onPointerDown={titlePress.onPointerDown} onContextMenu={titlePress.onContextMenu}
          onClick={event => { if (!titlePress.consumeClick(event) && event.detail === 0) onMore?.() }}>
          <PingPongText text={track.title} />
        </Button>
        <Button variant="ghost" className="track-pill artist-pill" disabled={!interactive || !onArtistSongs} aria-label={`${track.artist} - ${track.album}，所有艺术家歌曲`}
          onPointerDown={artistPress.onPointerDown} onContextMenu={artistPress.onContextMenu}
          onClick={event => { if (!artistPress.consumeClick(event) && event.detail === 0) onArtistSongs?.() }}>
          <PingPongText text={`${track.artist} - ${track.album}`} />
        </Button>
      </> : null}
    </motion.div>
  )
}
