import { useCallback, useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react'
import type { PlaylistCoverImage as PlaylistCoverImageResource } from '@/features/player/model/playerUiViewModel'
import { forgetPlaylistCoverDecoded, isPlaylistCoverDecoded, isPlaylistCoverPresented, markPlaylistCoverDecoded, markPlaylistCoverPresented } from '@/features/player/model/playlistCoverReadiness'

type PlaylistCoverImageProps = ({ image: PlaylistCoverImageResource; src?: never } | { image?: never; src: string }) & {
  className?: string
  reveal?: boolean
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void
}

export function PlaylistCoverImage({ image, src, className, reveal = false, onError }: PlaylistCoverImageProps) {
  const source = image ? image.src : src!
  const imageRef = useRef<HTMLImageElement>(null)
  const presentedInThisElement = useRef(false)
  const [loaded, setLoaded] = useState(() => image ? isPlaylistCoverDecoded(image) : isPlaylistCoverPresented(source))
  const [revealOnLoad, setRevealOnLoad] = useState(() => reveal && !isPlaylistCoverPresented(image ?? source))
  const acceptLoadedImage = useCallback((element: HTMLImageElement) => {
    if (!element.complete || element.naturalWidth === 0) return
    const actualSource = element.currentSrc || element.src
    if (image) markPlaylistCoverDecoded(image)
    if (reveal) {
      // A fallback may change element.src without changing the original prop.
      // Consume only the source which actually succeeded, after DOM commit.
      const originalSucceeded = actualSource === new URL(source, window.location.href).href
      const identity = image && originalSucceeded ? image : actualSource
      if (!presentedInThisElement.current) {
        const motionDisabled = Boolean(element.closest('.spmusic-app[data-motion="off"], .playlist-grid[data-cover-motion="off"]'))
          || window.matchMedia('(prefers-reduced-motion: reduce)').matches
        setRevealOnLoad(!motionDisabled && !isPlaylistCoverPresented(identity))
      }
      markPlaylistCoverPresented(identity)
      if (!image && originalSucceeded) markPlaylistCoverPresented(source)
    }
    presentedInThisElement.current = true
    setLoaded(true)
  }, [image, reveal, source])

  // `onLoad` is the primary trigger, but it is not guaranteed to fire before
  // React attaches it: a cached thumbnail (an object URL over the BMP bytes)
  // can already be complete at commit. Check before paint so a cached raw URL
  // also appears immediately when motion is disabled.
  //
  // Deliberately one-way. When the artwork is later upgraded (SP-022 swaps the
  // thumbnail for a larger maxEdge in place, on this same element) the browser
  // keeps painting the previous bitmap until the new one decodes - measured:
  // the old frame stays on screen for the whole request. Resetting `loaded`
  // here would hide that frame behind the placeholder and turn every layout or
  // DPR change into a flash, so the cross-dissolve covers first appearance and
  // upgrades keep the seamless in-place sharpen.
  useLayoutEffect(() => {
    const element = imageRef.current
    if (!element) return
    const finishReveal = (event: AnimationEvent) => {
      if (event.animationName === 'playlist-card-cover-reveal') setRevealOnLoad(false)
    }
    element.addEventListener('animationend', finishReveal)
    element.addEventListener('animationcancel', finishReveal)
    acceptLoadedImage(element)
    return () => {
      element.removeEventListener('animationend', finishReveal)
      element.removeEventListener('animationcancel', finishReveal)
    }
  }, [acceptLoadedImage])

  return (
    <img
      ref={imageRef}
      className={className}
      src={source}
      width={image?.width}
      height={image?.height}
      alt=""
      aria-hidden="true"
      decoding="async"
      data-loaded={loaded ? 'true' : 'false'}
      data-reveal={revealOnLoad ? 'new' : undefined}
      onLoad={(event) => {
        acceptLoadedImage(event.currentTarget)
        if (image) window.dispatchEvent(new CustomEvent('spmusic:playlist-cover-image-load', { detail: image.src }))
      }}
      onError={(event) => {
        if (image) {
          forgetPlaylistCoverDecoded(image)
          window.dispatchEvent(new CustomEvent('spmusic:playlist-cover-image-error', { detail: image.src }))
        }
        onError?.(event)
      }}
    />
  )
}
