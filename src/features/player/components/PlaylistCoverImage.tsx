import type { PlaylistCoverImage as PlaylistCoverImageResource } from '@/features/player/model/playerUiViewModel'

type PlaylistCoverImageProps = {
  image: PlaylistCoverImageResource
  className?: string
}

export function PlaylistCoverImage({ image, className }: PlaylistCoverImageProps) {
  return (
    <img
      className={className}
      src={image.src}
      width={image.width}
      height={image.height}
      alt=""
      aria-hidden="true"
      decoding="async"
      onLoad={() => window.dispatchEvent(new CustomEvent('spmusic:playlist-cover-image-load', { detail: image.src }))}
      onError={() => window.dispatchEvent(new CustomEvent('spmusic:playlist-cover-image-error', { detail: image.src }))}
    />
  )
}
