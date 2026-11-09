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
 * Build the immutable snapshot one owner publishes for an `<img>`.
 *
 * Every owner goes through this instead of assembling the object literal itself:
 * the token is the only thing that makes a later DOM report attributable, so its
 * five fields and the `src` they describe must never drift between owners. The
 * returned `src` and the returned `token.url` are the same value by construction —
 * a consumer cannot render a URL that its own token does not name.
 */
export function createCoverPresentation(input: Readonly<{
  key: string
  /** Full source identity, including the artwork revision when one exists. */
  identity: string
  sessionGeneration: number
  publishGeneration: number
  src: string
  image?: PlaylistCoverImage
}>): CoverPresentation {
  return {
    ...(input.image ? { image: input.image } : {}),
    src: input.src,
    token: {
      key: input.key,
      identity: input.identity,
      sessionGeneration: input.sessionGeneration,
      publishGeneration: input.publishGeneration,
      url: input.src,
    },
  }
}

/**
 * Whether one DOM report still describes what this owner is showing.
 *
 * This is the single acceptance predicate for all three cover owners. Every
 * clause is a rejection reason that must not degrade into "treat it as current":
 * a report from another owner lifetime, another key, a superseded publish
 * generation, a different descriptor identity (revision included), a URL the
 * element already swapped away from, or a token whose snapshot is gone. Accepting
 * any of those would let one element's late error evict a healthy replacement,
 * charge the breaker for a resource that never failed, or start a recovery for a
 * row that has moved on.
 */
export function isCurrentCoverReport(
  source: Readonly<{
    presentation: CoverPresentation | undefined
    /** Identity the owner would publish for this key right now. */
    identity: string
    sessionGeneration: number
  }>,
  report: CoverPresentationReport,
): boolean {
  const presentation = source.presentation
  if (!presentation) return false
  const { token } = report
  if (token.sessionGeneration !== source.sessionGeneration) return false
  if (token.key !== presentation.token.key) return false
  if (token.publishGeneration !== presentation.token.publishGeneration) return false
  if (token.identity !== presentation.token.identity) return false
  if (token.url !== presentation.token.url) return false
  // The published snapshot must still describe the descriptor the owner holds. A
  // rescan changes the identity, and the element painting the pre-rescan cover is
  // then reporting for a resource nobody displays any more.
  if (presentation.token.identity !== source.identity) return false
  // Compare browser-resolved URLs: the element reports its own resolved form,
  // which is not required to be string-identical to the published one.
  return isSameCoverUrl(report.actualUrl, presentation.token.url)
}

/**
 * One bounded automatic recovery opportunity, per owner, per row, per epoch.
 *
 * The state machine is shared by the three cover owners so they cannot grow three
 * subtly different definitions of "already used my one recovery". Its whole point
 * is that the opportunity is a *resource* property consumed once:
 *
 * - `claim` is synchronous, so several `<img>` elements reporting the same failed
 *   publication in one turn produce exactly one `true`.
 * - `begin` records that the forced pixel job was actually admitted. Until then
 *   the claim holds the slot but has not spent it, so a job dropped before
 *   admission does not burn the epoch.
 * - `loaded`/`settle` close the epoch and keep the record. The record staying
 *   present is the invariant that stops a successful DOM load from restoring the
 *   right to recover: a load is evidence about one moment, not a permanent
 *   guarantee that the resource can be read again later.
 * - `rearm` is the only way to open a new opportunity, and it is deliberately
 *   explicit: identity/revision change, owner lifecycle, re-entry into demand, or
 *   a product retry action call it. Rendering, pumping, `load` events and new
 *   publish generations cannot.
 */
export type CoverRecoveryPhase = 'idle' | 'queued' | 'running' | 'awaiting-dom' | 'settled'

export type CoverRecoveryIdentity = Readonly<{
  /** Owner lifetime id; never reused across an unmount/remount. */
  ownerSession: number
  key: string
  /** Full source identity, including the artwork revision when one exists. */
  identity: string
  /** Retry opportunity counter, not a publish sequence. */
  epoch: number
}>

export type CoverRecoveryRecord = {
  key: string
  identity: string
  epoch: number
  /** Set when the forced pixel job is admitted, never when it is merely queued. */
  attempted: boolean
  phase: CoverRecoveryPhase
  /** Publish generation of the snapshot whose URL the DOM rejected. */
  failedPublishGeneration: number
  /** The URL that failed. It is never restored as a fallback. */
  failedUrl: string
  /** Diagnostics: where the ending epoch stopped. Never read as behaviour. */
  stage?: CoverPresentationFailureStage
}

export type CoverRecoveryClaim = 'queued' | 'spent'

export type CoverRecoveryLedger = ReturnType<typeof createCoverRecoveryLedger>

export function createCoverRecoveryLedger(limit = 128) {
  const records = new Map<string, CoverRecoveryRecord>()
  const active = (record: CoverRecoveryRecord | undefined) =>
    record?.phase === 'queued' || record?.phase === 'running' || record?.phase === 'awaiting-dom'
  const trim = () => {
    if (records.size <= limit) return
    for (const [key, record] of records) {
      if (records.size <= limit) break
      if (active(record)) continue
      records.delete(key)
    }
  }
  return {
    get: (key: string): CoverRecoveryRecord | undefined => records.get(key),
    entries: (): IterableIterator<CoverRecoveryRecord> => records.values(),
    get size(): number { return records.size },
    /**
     * Take the one automatic recovery for this identity.
     *
     * `queued` is returned to exactly one caller: the first qualifying failure for
     * an identity whose opportunity is still unspent. Everything else returns
     * `spent` and must settle instead of scheduling.
     */
    claim(key: string, identity: string, publishGeneration: number, url: string): CoverRecoveryClaim {
      const existing = records.get(key)
      if (existing && existing.identity === identity) {
        // In flight, or already consumed: absorb the report. The failing snapshot
        // is still recorded, because it is the URL the fallback must exclude — after
        // a recovery the failing URL is the replacement, not the original.
        if (existing.attempted || active(existing)) {
          existing.failedPublishGeneration = publishGeneration
          existing.failedUrl = url
          return 'spent'
        }
        // The epoch ended without ever admitting a job, so its opportunity is
        // still there. Re-describing it with the newest failing snapshot keeps
        // the fallback exclusion pointed at the URL that actually failed.
        existing.phase = 'queued'
        existing.failedPublishGeneration = publishGeneration
        existing.failedUrl = url
        return 'queued'
      }
      records.set(key, {
        key, identity, epoch: 0, attempted: false, phase: 'queued',
        failedPublishGeneration: publishGeneration, failedUrl: url,
      })
      trim()
      return 'queued'
    },
    /** Mark the claimed job as admitted. `true` means this caller owns it. */
    begin(key: string): boolean {
      const record = records.get(key)
      if (!record || record.phase !== 'queued' || record.attempted) return false
      record.attempted = true
      record.phase = 'running'
      return true
    },
    /** The replacement was committed; wait for the DOM verdict on it. */
    published(key: string): void {
      const record = records.get(key)
      if (record) record.phase = 'awaiting-dom'
    },
    /** The replacement's DOM load confirmed the recovery. The epoch stays spent. */
    loaded(key: string): void {
      const record = records.get(key)
      if (record) record.phase = 'idle'
    },
    /** The epoch ended without a usable image. The record is retained. */
    settle(key: string): void {
      const record = records.get(key)
      if (record) record.phase = 'settled'
    },
    /** A queued job was dropped before admission; the opportunity is preserved. */
    release(key: string): void {
      const record = records.get(key)
      if (!record || record.attempted || record.phase !== 'queued') return
      record.phase = 'idle'
    },
    /** Whether a new opportunity may be opened for this identity right now. */
    rearm(key: string, identity: string): boolean {
      const record = records.get(key)
      if (!record || record.identity !== identity || active(record)) return false
      record.epoch += 1
      record.attempted = false
      record.phase = 'queued'
      return true
    },
    /** Forget the epoch entirely: the identity/revision it described is gone. */
    forget(key: string): void {
      records.delete(key)
    },
    /** Drop records whose row no longer exists so the ledger cannot grow. */
    prune(isAlive: (key: string, record: CoverRecoveryRecord) => boolean): void {
      for (const [key, record] of records) {
        if (active(record)) continue
        if (!isAlive(key, record)) records.delete(key)
      }
    },
    clear: (): void => { records.clear() },
  }
}

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
