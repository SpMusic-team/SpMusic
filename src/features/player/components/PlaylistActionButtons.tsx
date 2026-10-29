import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { CollectionReturnIcon } from './CollectionReturnIcon'
import { Button } from '@/components/ui/button'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { IconButton } from '@/features/player/components/IconButton'
import type { PlaybackModePresentation } from '@/features/player/components/playbackModePresentation'
import { appCopy } from '@/features/player/model/playerCopy'

type Props = {
  onBack?: () => void
  shuffle: PlaybackModePresentation
  onShuffle: () => void
  shuffleDisabled?: boolean
  onPlay: () => void
  playDisabled: boolean
  playbackLocked?: boolean
  searchOpen: boolean
  onSearch: () => void
  selectMode: boolean
  onSelect: () => void
  selectDisabled?: boolean
  compact?: boolean
  more: ReactNode
}

// The hero and floating controller use the same controls; pages own the actions.
export function PlaylistActionButtons({ onBack, shuffle, onShuffle, shuffleDisabled,
  onPlay, playDisabled, playbackLocked, searchOpen, onSearch, selectMode, onSelect,
  selectDisabled, compact = false, more }: Props) {
  const icons = useSystemIcons()
  return <>
    {onBack ? <IconButton className="playlist-hero-icon playlist-controller-back-button" icon={CollectionReturnIcon} label="返回" onClick={onBack} /> : null}
    <IconButton className="playlist-hero-icon playlist-hero-shuffle-button" icon={shuffle.icon} label={shuffle.label} aria-pressed={undefined} data-selected={undefined} data-playback-command-lock={playbackLocked || undefined} disabled={shuffleDisabled} onClick={onShuffle} />
    <IconButton className="playlist-hero-icon playlist-hero-play-button" icon={icons.play} label={appCopy.playlistPage.play}
      data-playback-command-lock={playbackLocked || undefined} disabled={playDisabled} pressFeedback={!compact} pressFeedbackTone="surface-variant" onClick={onPlay} />
    <Button className="playlist-search-button playlist-hero-icon" aria-label={appCopy.playlistPage.search} aria-pressed={searchOpen}
      data-selected={searchOpen ? 'true' : undefined} size="icon" variant="ghost" onClick={onSearch}><Search aria-hidden="true" /></Button>
    <Button className="playlist-select-toggle" aria-pressed={selectMode} data-selected={selectMode ? 'true' : undefined} disabled={selectDisabled} onClick={onSelect}>
      {selectMode ? appCopy.playlistPage.done : appCopy.playlistPage.select}
    </Button>
    {more}
  </>
}
