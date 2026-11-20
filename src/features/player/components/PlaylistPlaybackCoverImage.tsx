import { useEffect, useRef, useState } from 'react'
import type { PlaylistCoverImage } from '@/features/player/model/playerUiViewModel'
import { forgetPlaylistCoverDecoded, isPlaylistCoverDecoded, markPlaylistCoverDecoded } from '@/features/player/model/playlistCoverReadiness'

// The neighbor and committed row are separate mounts. Share only successful
// decode identities, never preview tokens, DOM elements, or URL ownership.
const decodedSources = new Map<string, string>()
let decodedSourceCharacters = 0
const sourceKey = (trackId: string, source: string) => `${trackId}\0${source}`
function forgetSource(key: string) {
  const source = decodedSources.get(key)
  if (source !== undefined && decodedSources.delete(key)) decodedSourceCharacters -= key.length + source.length
}
function rememberSource(trackId: string, requestedSource: string, successfulSource = requestedSource) {
  // Blob URLs belong to the playlist artwork cache and can be revoked when its
  // window moves. The decoded thumbnail object, not a remembered URL string,
  // carries readiness for that resource.
  if (requestedSource.startsWith('blob:') || successfulSource.startsWith('blob:')) return
  const key = sourceKey(trackId, requestedSource)
  forgetSource(key)
  decodedSources.set(key, successfulSource)
  decodedSourceCharacters += key.length + successfulSource.length
  // Data URLs can be large. Keep the latest successful source for the current
  // handoff even when it alone exceeds the budget, and evict older identities.
  while (decodedSources.size > 1 && (decodedSources.size > 32 || decodedSourceCharacters > 2 * 1024 * 1024)) {
    const oldest = decodedSources.keys().next().value
    if (oldest === undefined) break
    forgetSource(oldest)
  }
}

function forgetFailedSource(trackId: string, source: string) {
  for (const [key, successfulSource] of decodedSources) {
    if (key === sourceKey(trackId, source) || successfulSource === source) forgetSource(key)
  }
}

type PlaylistPlaybackCoverImageProps = {
  trackId: string
  thumbnail?: PlaylistCoverImage
  source?: string
  fallbackSource?: string
}

export function PlaylistPlaybackCoverImage({ trackId, thumbnail, source, fallbackSource }: PlaylistPlaybackCoverImageProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const requestedSource = thumbnail?.src ?? source
  // A preview may have painted a successful fallback after its primary failed.
  // The committed row must request that actual bitmap, not replay the failed
  // primary request behind a fresh initial fade.
  const decodedSource = requestedSource ? decodedSources.get(sourceKey(trackId, requestedSource)) : undefined
  const imageSource = decodedSource ?? requestedSource
  const resourceReady = Boolean((thumbnail && isPlaylistCoverDecoded(thumbnail))
    || decodedSource)
  const [loaded, setLoaded] = useState(resourceReady)

  // Keep one img across an original -> thumbnail upgrade. A successful old
  // bitmap stays painted while the browser swaps the same track's resource.
  useEffect(() => {
    const element = imageRef.current
    if (!element || !element.complete || element.naturalWidth === 0
      || element.currentSrc !== element.src || element.getAttribute('src') !== imageSource || !imageSource) return
    rememberSource(trackId, imageSource)
    if (requestedSource && requestedSource !== imageSource) rememberSource(trackId, requestedSource, imageSource)
    if (thumbnail?.src === imageSource) markPlaylistCoverDecoded(thumbnail)
    element.hidden = false
    setLoaded(true)
  }, [imageSource, requestedSource, thumbnail, trackId])

  return (
    <img
      ref={imageRef}
      className="playlist-playback-cover-image"
      src={imageSource}
      width={thumbnail?.width}
      height={thumbnail?.height}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      data-loaded={loaded || resourceReady ? 'true' : 'false'}
      onLoad={(event) => {
        const element = event.currentTarget
        const successfulSource = element.getAttribute('src')
        // A queued load from an earlier request must not grant readiness to
        // the current resource. currentSrc identifies the bitmap just loaded.
        if (!successfulSource || !element.complete || element.naturalWidth === 0
          || element.currentSrc !== element.src
          || (successfulSource !== imageSource && successfulSource !== fallbackSource)) return
        rememberSource(trackId, successfulSource)
        if (requestedSource && requestedSource !== successfulSource) rememberSource(trackId, requestedSource, successfulSource)
        if (thumbnail?.src === successfulSource) {
          markPlaylistCoverDecoded(thumbnail)
          window.dispatchEvent(new CustomEvent('spmusic:playlist-cover-image-load', { detail: successfulSource }))
        }
        element.hidden = false
        setLoaded(true)
      }}
      onError={(event) => {
        const element = event.currentTarget
        const failedSource = element.getAttribute('src')
        if (!failedSource || (failedSource !== imageSource && failedSource !== fallbackSource)) return
        forgetFailedSource(trackId, failedSource)
        if (requestedSource && decodedSource === failedSource) forgetSource(sourceKey(trackId, requestedSource))
        if (thumbnail?.src === failedSource) {
          forgetPlaylistCoverDecoded(thumbnail)
          window.dispatchEvent(new CustomEvent('spmusic:playlist-cover-image-error', { detail: failedSource }))
        }
        if (fallbackSource && failedSource !== fallbackSource) element.src = fallbackSource
        else element.hidden = true
      }}
    />
  )
}
