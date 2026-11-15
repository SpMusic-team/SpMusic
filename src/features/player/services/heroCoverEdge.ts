/**
 * Hero artwork tier selection.
 *
 * Single source of truth for "which maxEdge does the hero need", shared by the two owners
 * that can serve a detail hero:
 *
 *   * `useLibraryArtwork` — the non-active browse case (list detail),
 *   * `useAudioPlayer`   — the active playback case.
 *
 * Both must produce the same tier for the same layout, otherwise the same detail page is
 * sharp or blurry depending on how the user arrived, which is the hardest regression to
 * notice (plan §5.5 P1, §5.7 C13).
 *
 * ## Why the measurement target is `.playlist-hero-artwork`
 *
 * The player stage already has a selector (`useArtworkVisualResource.ts:552`), and its
 * *method* — measure an element's `clientWidth`, multiply by DPR, ceil to a bucket — is
 * correct and reused here. Its *target* is not: it measures `.cover-frame`, which exists
 * only on the player stage. The hero's real box is `.playlist-hero-artwork`
 * (`CollectionHero.tsx`), whose `clientWidth` is exactly the hero's available width.
 *
 * ## Why `clientWidth` and not `getBoundingClientRect().width`
 *
 * `.playlist-hero-artwork` is a `motion.div` with `layoutId`, so it takes part in FLIP
 * shared-element transitions. During one, its *rect* is an interpolated size; its
 * `clientWidth` is the layout box. Reading the rect would pin the hero to a low tier
 * permanently, because the measured value is then published and never recomputed
 * (plan §6.5). The CSS `scale` rules on the hero (overscroll stretch) likewise affect only
 * the visual box, not `clientWidth`.
 */

/**
 * Hero tiers, ascending. `2048` is deliberately absent: the plan (D2) admits it to the
 * whitelist but keeps it out of the default buckets until a Release measurement of WebView
 * bitmap residency exists.
 */
/**
 * Hero tiers the selector may choose.
 *
 * 2048 is deliberately EXCLUDED, per plan D2. It was briefly enabled while the WV2 data looked
 * supportive at 1536, then measured directly and rejected: at 2048 the renderer (JS heap side)
 * grew by 27-89 MB across two runs rather than the few MB seen at 1536. That contradicts the
 * mechanism D2 relied on, so the tier is not offered.
 *
 * It stays in the Rust PATH whitelist so the channel can serve it once a narrower investigation
 * explains the renderer growth (see the 2048 note in cover_pixels.rs).
 */
export const HERO_EDGE_BUCKETS = [1024, 1536] as const

/** Highest edge the hero will request. */
export const HERO_MAX_EDGE: HeroEdge = HERO_EDGE_BUCKETS[HERO_EDGE_BUCKETS.length - 1]

/** Any tier the hero may request. */
export type HeroEdge = (typeof HERO_EDGE_BUCKETS)[number]

/**
 * The CSS layout breakpoint the hero geometry switches at.
 *
 * `playlist-panel.css` uses `@media (width > 1024px)` to move the panel right by 320px and
 * add 50px of inline padding. Crossing it changes the hero's CSS width abruptly
 * (992 → 655 px at viewport 1024 → 1025), so a fallback that derives width from the
 * viewport must use the same breakpoint value or it picks the wrong tier near the boundary
 * (plan §1.3, §6.3).
 */
export const HERO_LAYOUT_BREAKPOINT = 1024

/**
 * Hero CSS width implied by a viewport width, used ONLY when the element cannot be
 * measured (`clientWidth === 0`: first paint, detached, display:none).
 *
 * Mirrors the panel's own geometry so the fallback and the measurement agree about which
 * side of the breakpoint the viewport sits on. The category-page hero is 0–18px narrower at
 * every breakpoint (plan §1.3), so this upper bound is safe for both.
 */
export function heroCssWidthFallback(viewportCssWidth: number): number {
  if (!Number.isFinite(viewportCssWidth) || viewportCssWidth <= 0) return 0
  return viewportCssWidth > HERO_LAYOUT_BREAKPOINT
    ? viewportCssWidth - 320 - 50
    : viewportCssWidth - 32
}

/** Smallest bucket that covers `physicalEdge`, capped at the largest bucket. */
function bucketCeil(physicalEdge: number): HeroEdge {
  for (const bucket of HERO_EDGE_BUCKETS) {
    if (bucket >= physicalEdge) return bucket
  }
  return HERO_MAX_EDGE
}

/** The hero's box, as rendered by `CollectionHero`. */
const HERO_ARTWORK_SELECTOR = '.playlist-hero-artwork'

/**
 * Find the hero artwork element.
 *
 * The panels reach it through their own `artworkRef`, but the artwork hooks do not own that
 * ref and must not require prop plumbing just to measure. Querying the selector keeps the
 * measurement next to the rule it feeds.
 *
 * During a shared-element transition two heroes can coexist (the outgoing and incoming
 * panels). The WIDEST one is used: starting a transition on a too-small measurement would
 * pin the incoming hero to a low tier while both are mounted.
 */
export function findHeroArtworkElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const candidates = document.querySelectorAll<HTMLElement>(HERO_ARTWORK_SELECTOR)
  let widest: HTMLElement | null = null
  for (const candidate of candidates) {
    if (!widest || candidate.clientWidth > widest.clientWidth) widest = candidate
  }
  return widest
}

/**
 * Hero tier for the given artwork element, or for the rendered hero when omitted.
 *
 * Measurement wins; the viewport fallback is used only when the element has no layout box.
 * An unmeasurable hero asks for the *cheapest* tier rather than the most expensive one: an
 * element with no width yet has no demonstrated need, and the stable-geometry path will
 * upgrade it once the layout exists (plan §6.5 layer 3).
 */
export function selectHeroEdge(artwork?: Element | null): HeroEdge {
  const element = artwork === undefined ? findHeroArtworkElement() : artwork
  const dpr = Math.max(1, Number(window.devicePixelRatio) || 1)
  const measured = element instanceof HTMLElement ? element.clientWidth : 0
  return heroEdgeForMeasurement({
    clientWidth: measured,
    devicePixelRatio: dpr,
    viewportCssWidth: window.innerWidth,
  })
}

/**
 * Pure form of {@link selectHeroEdge} for tests and for callers that already measured.
 *
 * Keeping the arithmetic separate from the DOM access lets the bucket boundary, the 1024
 * breakpoint pair, and the DPR multiplication be asserted without a browser.
 */
export function heroEdgeForMeasurement(input: {
  /** Measured `clientWidth`, or 0 when unmeasurable. */
  clientWidth: number
  devicePixelRatio: number
  viewportCssWidth: number
}): HeroEdge {
  const dpr = Math.max(1, Number.isFinite(input.devicePixelRatio) ? input.devicePixelRatio : 1)
  const measured = Number.isFinite(input.clientWidth) ? input.clientWidth : 0
  if (measured > 0) return bucketCeil(Math.ceil(measured * dpr))
  const fallbackCssWidth = heroCssWidthFallback(input.viewportCssWidth)
  if (fallbackCssWidth <= 0) return HERO_EDGE_BUCKETS[0]
  return bucketCeil(Math.ceil(fallbackCssWidth * dpr))
}

/** Whether a value is one of the hero tiers. */
export function isHeroEdge(value: unknown): value is HeroEdge {
  return HERO_EDGE_BUCKETS.includes(value as HeroEdge)
}
