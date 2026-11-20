/**
 * React binding for the hero tier measurement.
 *
 * The tier is derived from the DOM (`.playlist-hero-artwork`'s layout width × DPR), which lives
 * outside React. Two naive ways of reading it are both wrong:
 *
 *   * reading the element's ref during render — React cannot know when it changed, and the
 *     lint rules (correctly) reject it;
 *   * sampling in an effect and calling `setState` — that schedules a cascading render.
 *
 * `useSyncExternalStore` is the sanctioned third way: it subscribes to the change signals and
 * re-samples through a pure snapshot function.
 *
 * The subscription covers every signal the plan requires (§6.4): the hero's own size, the
 * window size, and the display's scale factor. DPR changes fire neither `resize` nor a
 * `ResizeObserver` callback when the window size is unchanged, so the resolution media query is
 * re-armed on each change.
 */
import { useSyncExternalStore } from 'react'

import { selectHeroEdge, type HeroEdge } from '@/features/player/services/heroCoverEdge'

/** The hero element, when it exists. */
function heroElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>('.playlist-hero-artwork')
}

/**
 * Subscribe to every signal that can change the hero's measured tier.
 *
 * Returns an unsubscribe function. The observer is re-created per subscription so a panel
 * mounting after another one unmounted attaches to its own element.
 */
function subscribeHeroMeasurement(onChange: () => void): () => void {
  const target = heroElement()
  const observer = target ? new ResizeObserver(onChange) : null
  if (target) observer?.observe(target)
  window.addEventListener('resize', onChange)

  let resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  const onResolution = () => {
    // The query string embeds the current DPR, so it must be rebuilt after every change.
    resolution.removeEventListener('change', onResolution)
    resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    resolution.addEventListener('change', onResolution)
    onChange()
  }
  resolution.addEventListener('change', onResolution)

  return () => {
    observer?.disconnect()
    window.removeEventListener('resize', onChange)
    resolution.removeEventListener('change', onResolution)
  }
}

/**
 * The hero tier for the current layout, or `undefined` when the hero should stay on the cheap
 * lane.
 *
 * Owners decide when to withdraw demand. Playlist details retain one hero
 * while scrolling and withdraw when the panel leaves.
 */
export function useHeroTier(enabled: boolean): HeroEdge | undefined {
  return useSyncExternalStore(
    subscribeHeroMeasurement,
    () => (enabled ? selectHeroEdge() : undefined),
    // No DOM during server-side rendering; the cheap lane is the safe default.
    () => undefined,
  )
}
