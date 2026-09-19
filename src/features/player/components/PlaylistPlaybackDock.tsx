import { DataHistogram24Filled, Grid24Filled } from '@fluentui/react-icons'
import { Menu, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { ProgressControl } from '@/features/player/components/ControlDock'
import { IconButton } from '@/features/player/components/IconButton'
import { PlaylistCoverImage } from '@/features/player/components/PlaylistCoverImage'
import type { PlayerPlaybackViewModel, PlayerTimelineViewModel, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'
import { coverToneForTrackId } from '@/features/player/model/audioTrackModel'

type PlaylistPlaybackDockProps = {
  playback: PlayerPlaybackViewModel
  timeline: PlayerTimelineViewModel
  visualIsPlaying: boolean
  playbackTransitionPending: boolean
  playlistTrack?: PlaylistTrackItemViewModel
  onPlayToggle: () => void
  searchOpen: boolean
  onSearchToggle: () => void
  onClose: () => void
}

export function PlaylistPlaybackDock({
  playback,
  timeline,
  visualIsPlaying,
  playbackTransitionPending,
  playlistTrack,
  onPlayToggle,
  searchOpen,
  onSearchToggle,
  onClose,
}: PlaylistPlaybackDockProps) {
  const systemIcons = useSystemIcons()
  const track = playback.track
  const artwork = playback.artwork
  const imageFallback = artwork?.coverImageFallback ?? track?.coverImageFallback
  const imageSource = artwork?.coverImage ?? track?.coverImage ?? imageFallback
  const localArtwork = playlistTrack?.hasLocalArtwork ?? Boolean(artwork?.coverFilePath ?? track?.coverFilePath)
  const disabled = !track
  const commandBusy = playback.isAudioBusy
    || playback.isSelectionPending
    || timeline.interaction === 'seeking'
    || playbackTransitionPending
    || playback.isTransportBusy

  return (
    <aside className="playlist-playback-dock" aria-label="当前播放">
      <div className="playlist-playback-track" data-tone={track?.coverTone ?? coverToneForTrackId(track?.id ?? '')}>
        <button
          type="button"
          className="playlist-playback-track-button"
          aria-label={track ? `返回播放界面：${track.title}` : '返回播放界面'}
          onClick={onClose}
        >
          <span className="playlist-playback-cover" aria-hidden="true">
            {playlistTrack?.coverThumbnail ? (
              <PlaylistCoverImage image={playlistTrack.coverThumbnail} />
            ) : !localArtwork && imageSource ? (
              <img
                src={imageSource}
                alt=""
                onError={(event) => {
                  const image = event.currentTarget
                  if (imageFallback && image.dataset.fallbackApplied !== 'true') {
                    image.dataset.fallbackApplied = 'true'
                    image.src = imageFallback
                    return
                  }
                  image.hidden = true
                }}
              />
            ) : null}
          </span>
          <span className="playlist-playback-copy">
            <strong>{track?.title ?? '未在播放'}</strong>
            <span>{track ? `${track.artist}/${track.album}` : '选择一首歌曲开始播放'}</span>
          </span>
        </button>
        <Button
          className="playlist-playback-toggle"
          size="icon-lg"
          variant="ghost"
          aria-label={visualIsPlaying ? '暂停' : '播放'}
          aria-pressed={visualIsPlaying}
          disabled={disabled || commandBusy}
          onClick={onPlayToggle}
        >
          {visualIsPlaying ? <systemIcons.pause aria-hidden="true" /> : <systemIcons.play aria-hidden="true" />}
        </Button>
      </div>

      <ProgressControl
        key={track?.id ?? 'playlist-empty'}
        className="playlist-playback-progress"
        timeline={timeline}
        disabled={disabled || commandBusy}
        isPlaying={playback.isPlaying}
        showTimes={false}
      />

      <nav className="playlist-playback-nav" aria-label="播放列表快捷操作">
        <IconButton
          className="playlist-playback-nav-button is-active"
          icon={Grid24Filled}
          label="播放列表"
          selected
          aria-current="page"
          pressFeedback
          pressFeedbackTone="surface-variant"
        />
        <IconButton
          className="playlist-playback-nav-button playlist-playback-statistics-button"
          icon={DataHistogram24Filled}
          label="播放统计"
          disabled
          pressFeedback
          pressFeedbackTone="surface-variant"
        />
        <IconButton
          className="playlist-playback-nav-button"
          icon={Search}
          label="搜索"
          selected={searchOpen}
          pressFeedback
          pressFeedbackTone="surface-variant"
          onClick={onSearchToggle}
        />
        <IconButton
          className="playlist-playback-nav-button"
          icon={Menu}
          label="返回播放界面"
          pressFeedback
          pressFeedbackTone="surface-variant"
          onClick={onClose}
        />
      </nav>
    </aside>
  )
}
