import type { CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import type { Track } from '@/features/player/model/playerTypes'
import type { SystemIcon } from '@/icons/systemIcons'
import { IconButton } from './IconButton'

type CoverStyle = CSSProperties & { '--cover-art'?: string }

type CoverPanelProps = {
  track: Track
  coverStyle?: CoverStyle
  likeIcon: SystemIcon
  dislikeIcon: SystemIcon
  liked: boolean
  disliked: boolean
  onLike: () => void
  onDislike: () => void
}

export function CoverPanel({ track, coverStyle, likeIcon, dislikeIcon, liked, disliked, onLike, onDislike }: CoverPanelProps) {
  const systemIcons = useSystemIcons()

  return (
    <article className="cover-column">
      <div className="cover-art" data-tone={track.coverTone} data-has-image={Boolean(track.coverImage)} style={coverStyle}>
        {!track.coverImage ? <div className="cover-mark"><systemIcons.music /><strong>{appCopy.productName}</strong><span>LOCAL LISTENING</span></div> : null}
        <div className="cover-feedback">
          <IconButton icon={likeIcon} label={appCopy.controls.like} selected={liked} onClick={onLike} />
          <IconButton icon={dislikeIcon} label={appCopy.controls.dislike} selected={disliked} onClick={onDislike} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button className="more-button" aria-label={appCopy.controls.more} size="icon" variant="ghost" />}><systemIcons.more /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{appCopy.moreMenu.info}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void navigator.clipboard?.writeText(track.title)}>{appCopy.moreMenu.copyTitle}</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="track-pills" aria-live="polite">
        <span className="title-pill">{track.title}</span>
        <span className="artist-pill">{track.artist} - {track.album}</span>
      </div>
    </article>
  )
}
