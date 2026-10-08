import { useEffect, useRef, useState } from 'react'
import type { PlaylistCoverImage as PlaylistCoverImageResource } from '@/features/player/model/playerUiViewModel'
import { forgetPlaylistCoverDecoded, isPlaylistCoverDecoded, markPlaylistCoverDecoded } from '@/features/player/model/playlistCoverReadiness'

type PlaylistCoverImageProps = {
  image: PlaylistCoverImageResource
  className?: string
}

export function PlaylistCoverImage({ image, className }: PlaylistCoverImageProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [loaded, setLoaded] = useState(() => isPlaylistCoverDecoded(image))

  // `onLoad` is the primary trigger, but it is not guaranteed to fire before
  // React attaches it: a cached thumbnail (an object URL over the BMP bytes)
  // can already be complete by the time the effect runs. Without this backstop
  // the image would stay at the fade's opacity 0 forever.
  //
  // Deliberately one-way. When the artwork is later upgraded (SP-022 swaps the
  // thumbnail for a larger maxEdge in place, on this same element) the browser
  // keeps painting the previous bitmap until the new one decodes - measured:
  // the old frame stays on screen for the whole request. Resetting `loaded`
  // here would hide that frame behind the placeholder and turn every layout or
  // DPR change into a flash, so the cross-dissolve covers first appearance and
  // upgrades keep the seamless in-place sharpen.
  useEffect(() => {
    const element = imageRef.current
    if (element && element.complete && element.naturalWidth > 0) {
      markPlaylistCoverDecoded(image)
      setLoaded(true)
    }
  }, [image])

  return (
    <img
      ref={imageRef}
      className={className}
      src={image.src}
      width={image.width}
      height={image.height}
      alt=""
      aria-hidden="true"
      decoding="async"
      data-loaded={loaded ? 'true' : 'false'}
      onLoad={() => {
        markPlaylistCoverDecoded(image)
        setLoaded(true)
        window.dispatchEvent(new CustomEvent('spmusic:playlist-cover-image-load', { detail: image.src }))
      }}
      onError={() => {
        forgetPlaylistCoverDecoded(image)
        window.dispatchEvent(new CustomEvent('spmusic:playlist-cover-image-error', { detail: image.src }))
      }}
    />
  )
}
