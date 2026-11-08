import type { PlaylistCoverImage } from './playerUiViewModel'

// ---------------------------------------------------------------------------
// Presentation contract
//
// A resource owner publishes an immutable snapshot of what an `<img>` must
// display, and the component reports a load/failure back with *that same
// snapshot's* token. The consumer never pairs a displayed URL with a token read
// from the store at error time: doing so would let a stale element's late error
// be attributed to the presentation that replaced it, which would evict a good
// image and charge the cache a failure it never earned.
// ---------------------------------------------------------------------------

/** Immutable identity of one committed cover presentation. */
export type CoverPresentationToken = Readonly<{
  /** Store key this presentation belongs to. */
  key: string
  /** Full descriptor identity, including `artworkRevision`. */
  identity: string
  /** Owner lifetime id. Unique per owner instance, never a reused counter. */
  sessionGeneration: number
  /** Monotonic within the owner; every actual commit replaces it. */
  publishGeneration: number
  /** The URL as published (not normalized). */
  url: string
}>

/** What a card renders: the image (when pixel-backed), the URL and its token. */
export type CoverPresentation = Readonly<{
  image?: PlaylistCoverImage
  src: string
  token: CoverPresentationToken
}>

export type CoverPresentationOutcome = 'loaded' | 'failed'

/** Result a component reports for the exact snapshot it received. */
export type CoverPresentationReport = Readonly<{
  token: CoverPresentationToken
  /** Browser-resolved absolute URL of the element that settled. */
  actualUrl: string
  outcome: CoverPresentationOutcome
}>

/** Where in the chain a presentation finally failed. Diagnostics only. */
export type CoverPresentationFailureStage = 'dom' | 'recovery-command' | 'recovery-decode' | 'recovery-empty'

/**
 * Owner lifetime identifiers.
 *
 * Deliberately process-wide rather than a counter reset per owner: an owner
 * unmount and a new owner mount must never be able to produce the same value,
 * which is what a per-owner sequence starting at zero would do.
 */
const SESSION_COUNTER = Symbol.for('spmusic.coverPresentationSessionGeneration')
type SessionRegistry = { [SESSION_COUNTER]?: number }

export function nextCoverSessionGeneration(): number {
  const registry = globalThis as unknown as SessionRegistry
  const next = (registry[SESSION_COUNTER] ?? 0) + 1
  registry[SESSION_COUNTER] = next
  return next
}

/**
 * Browser-resolved absolute form of a cover URL.
 *
 * Presentation reports compare URLs with this, never with prefix or truncation
 * matching: the DOM resolves relative and non-special-scheme URLs to its own
 * absolute form, so a raw string comparison would reject genuinely current
 * reports (or accept ones for a different resource).
 */
export function coverAbsoluteUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url, typeof window === 'undefined' ? undefined : window.location.href).href
  } catch {
    return url
  }
}

/** Whether two cover URLs name the same resource, after browser resolution. */
export function isSameCoverUrl(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = coverAbsoluteUrl(left)
  const b = coverAbsoluteUrl(right)
  return a !== undefined && a === b
}

/** Global names of the DOM feedback events. One protocol owner, one place. */
export const COVER_IMAGE_LOAD_EVENT = 'spmusic:playlist-cover-image-load'
export const COVER_IMAGE_ERROR_EVENT = 'spmusic:playlist-cover-image-error'

/**
 * Event payload.
 *
 * The presentation token is present whenever the element was given a published
 * snapshot, which is what lets the owner verify currentness instead of matching
 * on the URL alone. `url` stays the element's own `src` for the legacy listeners
 * that only need URL identity; `actualUrl` is the resolved form.
 */
export type CoverImageEventDetail = Readonly<{
  url: string
  actualUrl: string
  token?: CoverPresentationToken
}>

/**
 * Read either the structured payload or a bare URL string.
 *
 * Accepting the legacy string shape keeps a component that was not part of this
 * change from silently going dark; the owner still validates the token, and a
 * payload without a token is never treated as current by the all-songs store.
 */
export function coverImageEventDetail(event: Event): CoverImageEventDetail | undefined {
  const detail = (event as CustomEvent<unknown>).detail
  if (typeof detail === 'string') {
    const actualUrl = coverAbsoluteUrl(detail)
    return actualUrl ? { url: detail, actualUrl } : undefined
  }
  if (!detail || typeof detail !== 'object') return undefined
  const candidate = detail as Partial<CoverImageEventDetail>
  if (typeof candidate.url !== 'string') return undefined
  const actualUrl = candidate.actualUrl || coverAbsoluteUrl(candidate.url)
  if (!actualUrl) return undefined
  return { url: candidate.url, actualUrl, ...(candidate.token ? { token: candidate.token } : {}) }
}

/**
 * Report one settled `<img>` that is displaying a published snapshot.
 *
 * The single place that decides the event name and payload, so a native
 * `<img>` consumer cannot invent a second, subtly different protocol. `currentSrc`
 * is preferred: a fallback swap changes `src` without changing the prop, and the
 * owner must judge the resource that actually settled.
 */
export function reportCoverPresentation(
  token: CoverPresentationToken,
  element: HTMLImageElement,
  outcome: CoverPresentationOutcome,
): void {
  const url = element.currentSrc || element.src
  const actualUrl = coverAbsoluteUrl(url)
  if (!actualUrl) return
  window.dispatchEvent(new CustomEvent(outcome === 'loaded' ? COVER_IMAGE_LOAD_EVENT : COVER_IMAGE_ERROR_EVENT, {
    detail: { url, actualUrl, token },
  }))
}


// Readiness belongs to the resource, not to the temporary view displaying it.
// Weak ownership lets the bounded artwork store release an image normally.
const decodedCovers = new WeakSet<PlaylistCoverImage>()
// Decode readiness is not a presentation: workers prepare images before any
// card mounts. Keep first-reveal history separate and never retain image data.
const presentedCovers = new WeakSet<PlaylistCoverImage>()
const presentedUrls = new Set<string>()
const PRESENTED_URL_LIMIT = 512

export function isPlaylistCoverPresented(image: PlaylistCoverImage | string): boolean {
  return typeof image === 'string' ? presentedUrls.has(image)
    : presentedCovers.has(image) || presentedUrls.has(image.src)
}

export function markPlaylistCoverPresented(image: PlaylistCoverImage | string): void {
  if (typeof image !== 'string') presentedCovers.add(image)
  const src = typeof image === 'string' ? image : image.src
  presentedUrls.delete(src)
  presentedUrls.add(src)
  if (presentedUrls.size > PRESENTED_URL_LIMIT) presentedUrls.delete(presentedUrls.values().next().value!)
}

// Prepare the actual object URL before it reaches a temporary playlist view.
// The caller owns concurrency, staleness checks, and URL disposal.
export async function decodePlaylistCover(image: PlaylistCoverImage): Promise<void> {
  const element = new Image()
  element.decoding = 'async'
  try {
    if (typeof element.decode === 'function') {
      element.src = image.src
      await element.decode()
    } else {
      await new Promise<void>((resolve, reject) => {
        element.onload = () => resolve()
        element.onerror = () => reject(new Error('Playlist cover image could not load'))
        element.src = image.src
      })
    }
    if (!element.complete || element.naturalWidth === 0) throw new Error('Playlist cover image could not decode')
    markPlaylistCoverDecoded(image)
  } finally {
    element.onload = null
    element.onerror = null
    element.removeAttribute('src')
  }
}

export type BoundedDecodeResult = 'decoded' | 'failed' | 'cancelled'

/**
 * Decode one cover with a deadline that belongs to this call only.
 *
 * The unbounded `decodePlaylistCover` above is correct for the normal lane,
 * where a slow WebView is the WebView's own problem. It is not correct for a
 * recovery job: the recovery must settle, restore the previous image or the
 * placeholder, and free its slot, whatever the WebView decides to do. Raising
 * the global timeout instead would change the behaviour of every other caller.
 *
 * This is deliberately not `Promise.race` over `decodePlaylistCover`: racing
 * would leave the original decode running and would still let it call
 * `markPlaylistCoverDecoded` afterwards, publishing readiness for an image the
 * caller already gave up on. Here every late event is ignored, and the temporary
 * element's `src` is cleared so the pending fetch is dropped rather than merely
 * ignored. Readiness is only recorded on the winning path.
 */
export function decodePlaylistCoverWithin(
  image: PlaylistCoverImage,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BoundedDecodeResult> {
  if (signal?.aborted) return Promise.resolve('cancelled')
  return new Promise<BoundedDecodeResult>((resolve) => {
    const element = new Image()
    element.decoding = 'async'
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: BoundedDecodeResult) => {
      if (settled) return
      settled = true
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
      element.onload = null
      element.onerror = null
      signal?.removeEventListener('abort', onAbort)
      element.removeAttribute('src')
      if (result === 'decoded') markPlaylistCoverDecoded(image)
      resolve(result)
    }
    const onAbort = () => finish('cancelled')
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => finish('failed'), timeoutMs)
    element.onload = () => finish(element.complete && element.naturalWidth > 0 ? 'decoded' : 'failed')
    element.onerror = () => finish('failed')
    element.src = image.src
    // A fully cached URL completes synchronously and never fires `load` again.
    if (element.complete && element.naturalWidth > 0) finish('decoded')
  })
}


export function isPlaylistCoverDecoded(image: PlaylistCoverImage): boolean {
  return decodedCovers.has(image)
}

export function markPlaylistCoverDecoded(image: PlaylistCoverImage): void {
  decodedCovers.add(image)
}

export function forgetPlaylistCoverDecoded(image: PlaylistCoverImage): void {
  decodedCovers.delete(image)
}

/**
 * Release a cover URL only when it is an object URL this app created.
 *
 * A cover's `src` is one of two kinds, and they have opposite release rules:
 *
 * - A **blob object URL** (the pixel fallback's `playlistCoverImageFromPixels`)
 *   holds the bitmap alive on the JS side, so it must be revoked explicitly.
 * - An **asset-protocol URL** (the path lane's `convertFileSrc`) does not. Its
 *   decoded bitmap belongs to the WebView and is released when the last `<img>`
 *   referencing it unmounts; `URL.revokeObjectURL` is a spec-level no-op on it.
 *
 * Guarding on the scheme turns that distinction into structure instead of a
 * comment a reader has to trust. Today the unguarded call happens to be harmless
 * for asset URLs, so a regression here would not show up immediately — but a later
 * refactor to reference counting, or a wrapper that only accepts `blob:` URLs,
 * would start silently releasing live list covers. Call this instead of
 * `URL.revokeObjectURL` at every site whose URL may have come from either lane.
 */
export function releasePlaylistCoverUrl(url: string | undefined | null): void {
  if (!url || !url.startsWith('blob:')) return
  URL.revokeObjectURL(url)
}
