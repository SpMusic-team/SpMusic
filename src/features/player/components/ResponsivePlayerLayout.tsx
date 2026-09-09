import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MotionConfig, useReducedMotion } from 'motion/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { WindowLayoutState } from './WindowBar'

type PlayerLayoutMode = 'full' | 'horizontal' | 'vertical' | 'quarter'

type ViewportSize = {
  width: number
  height: number
}

type ResponsivePlayerLayoutProps = {
  children: ReactNode
  nativeWindowState: WindowLayoutState
  windowBar: ReactNode
}

const HYSTERESIS = 16
const SHORT_LAYOUT_BREAKPOINT = 600
const QUARTER_MIN_WIDTH = 640
const QUARTER_MAX_WIDTH = 1024
const HORIZONTAL_HALF_MIN_HEIGHT = 595
const HORIZONTAL_HALF_MAX_HEIGHT = 1080
const QUARTER_MIN_HEIGHT = 1120
const QUARTER_MAX_HEIGHT = 1440
const VERTICAL_HALF_MIN_WIDTH = 1024
const VERTICAL_HALF_MAX_WIDTH = 1920
const VERTICAL_HALF_MIN_HEIGHT = 1120
const VERTICAL_HALF_MAX_HEIGHT = 1440
const HORIZONTAL_HALF_MIN_CONTENT_WIDTH = 1080
const HORIZONTAL_HALF_SIDE_INSET = 60
const HORIZONTAL_HALF_COLUMN_GAP = 24
const HORIZONTAL_HALF_VERTICAL_INSET = 96
const DEFAULT_MIN_WINDOW_WIDTH = QUARTER_MIN_WIDTH

function isMinimumCompactViewport(viewport: ViewportSize): boolean {
  return viewport.width < 700 && viewport.height < SHORT_LAYOUT_BREAKPOINT
}

function horizontalHalfMinimumWidth(viewport: ViewportSize): number {
  const effectiveHeight = Math.max(viewport.height, HORIZONTAL_HALF_MIN_HEIGHT)
  const coverSize = effectiveHeight - HORIZONTAL_HALF_VERTICAL_INSET
  return HORIZONTAL_HALF_SIDE_INSET * 2
    + coverSize
    + HORIZONTAL_HALF_COLUMN_GAP
    + HORIZONTAL_HALF_MIN_CONTENT_WIDTH
}

function getWindowMinimumWidth(layout: PlayerLayoutMode, viewport: ViewportSize): number {
  if (layout !== 'horizontal') return DEFAULT_MIN_WINDOW_WIDTH

  const designMinimumWidth = horizontalHalfMinimumWidth(viewport)
  // At the minimum design height there is no smaller supported layout. Keep
  // the full horizontal-half boundary; above it, leave a hysteresis-sized
  // opening so resize can switch layouts before the dock is clipped.
  if (viewport.height <= HORIZONTAL_HALF_MIN_HEIGHT) return designMinimumWidth
  return Math.max(
    DEFAULT_MIN_WINDOW_WIDTH,
    designMinimumWidth - HYSTERESIS - 1,
  )
}

function getWindowMinimumHeight(layout: PlayerLayoutMode): number {
  return layout === 'quarter' ? QUARTER_MIN_HEIGHT : HORIZONTAL_HALF_MIN_HEIGHT
}

function isQuarterViewport(viewport: ViewportSize, previous?: PlayerLayoutMode): boolean {
  const heightInRange = previous === 'quarter'
    ? viewport.height >= QUARTER_MIN_HEIGHT - HYSTERESIS
      && viewport.height <= QUARTER_MAX_HEIGHT + HYSTERESIS
    : viewport.height >= QUARTER_MIN_HEIGHT
      && viewport.height <= QUARTER_MAX_HEIGHT
  const widthInRange = previous === 'quarter'
    ? viewport.width >= QUARTER_MIN_WIDTH - HYSTERESIS
      && viewport.width <= QUARTER_MAX_WIDTH + HYSTERESIS
    : viewport.width >= QUARTER_MIN_WIDTH
      && viewport.width <= QUARTER_MAX_WIDTH
  return heightInRange && widthInRange
}

function isVerticalHalfViewport(viewport: ViewportSize, previous?: PlayerLayoutMode): boolean {
  const inset = previous === 'vertical' ? HYSTERESIS : 0
  return viewport.width >= VERTICAL_HALF_MIN_WIDTH - inset
    && viewport.width <= VERTICAL_HALF_MAX_WIDTH + inset
    && viewport.height >= VERTICAL_HALF_MIN_HEIGHT - inset
    && viewport.height <= VERTICAL_HALF_MAX_HEIGHT + inset
}

function isHorizontalHalfViewport(viewport: ViewportSize, previous?: PlayerLayoutMode): boolean {
  const effectiveHeight = Math.max(viewport.height, HORIZONTAL_HALF_MIN_HEIGHT)
  const heightInRange = viewport.height <= HORIZONTAL_HALF_MAX_HEIGHT
    || (previous === 'horizontal' && viewport.height <= HORIZONTAL_HALF_MAX_HEIGHT + HYSTERESIS)

  if (!heightInRange) return false

  const minimumWidth = horizontalHalfMinimumWidth(viewport)
  const aspectThreshold = 2 * effectiveHeight
  if (previous === 'horizontal') {
    return viewport.width >= Math.max(aspectThreshold, minimumWidth) - HYSTERESIS
  }
  return viewport.width >= Math.max(aspectThreshold, minimumWidth) + HYSTERESIS
}

function readViewport(): ViewportSize {
  if (typeof window === 'undefined') return { width: 1920, height: 1080 }
  return { width: window.innerWidth, height: window.innerHeight }
}

function resolveLayout(
  viewport: ViewportSize,
  nativeWindowState: WindowLayoutState,
  previous?: PlayerLayoutMode,
): PlayerLayoutMode {
  if (nativeWindowState.maximized || nativeWindowState.fullscreen) return 'full'

  const compactMinimum = isMinimumCompactViewport(viewport)

  if (compactMinimum) return 'quarter'

  // The vertical half-screen is a bounded transition composition rather than
  // a portrait-only aspect-ratio rule. It owns the documented 1024px boundary;
  // hysteresis only extends an already-active vertical composition below it.
  if (isVerticalHalfViewport(viewport, previous)) return 'vertical'

  if (isQuarterViewport(viewport, previous)) return 'quarter'

  if (previous === 'vertical') {
    if (viewport.height >= viewport.width - HYSTERESIS) return 'vertical'
  } else if (viewport.height >= viewport.width + HYSTERESIS) {
    return 'vertical'
  } else if (!previous && viewport.height >= viewport.width) {
    return 'vertical'
  }

  if (isHorizontalHalfViewport(viewport, previous)) return 'horizontal'

  return 'full'
}

export function ResponsivePlayerLayout({ children, nativeWindowState, windowBar }: ResponsivePlayerLayoutProps) {
  const reduceMotion = useReducedMotion()
  const [layout, setLayout] = useState<PlayerLayoutMode>(() => resolveLayout(readViewport(), nativeWindowState))
  const [short, setShort] = useState(() => readViewport().height < SHORT_LAYOUT_BREAKPOINT)
  const layoutRef = useRef(layout)
  const windowMinimumRef = useRef<string | null>(null)

  const syncWindowMinimum = useCallback((nextLayout: PlayerLayoutMode, viewport: ViewportSize, windowState: WindowLayoutState) => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return

    const minWidth = windowState.maximized || windowState.fullscreen
      ? DEFAULT_MIN_WINDOW_WIDTH
      : getWindowMinimumWidth(nextLayout, viewport)
    const minHeight = getWindowMinimumHeight(nextLayout)
    const key = `${minWidth}:${minHeight}`
    if (windowMinimumRef.current === key) return
    windowMinimumRef.current = key

    void getCurrentWindow().setSizeConstraints({
      minWidth,
      minHeight,
    }).catch(() => {
      windowMinimumRef.current = null
    })
  }, [])

  const syncLayout = useCallback((viewport: ViewportSize, windowState: WindowLayoutState) => {
    const nextLayout = resolveLayout(viewport, windowState, layoutRef.current)
    if (nextLayout !== layoutRef.current) {
      layoutRef.current = nextLayout
      setLayout(nextLayout)
    }
    setShort((current) => {
      const next = current
        ? viewport.height < SHORT_LAYOUT_BREAKPOINT + HYSTERESIS
        : viewport.height < SHORT_LAYOUT_BREAKPOINT - HYSTERESIS
      return current === next ? current : next
    })
  }, [])

  useEffect(() => {
    function handleResize() {
      const viewport = readViewport()
      syncLayout(viewport, nativeWindowState)
      syncWindowMinimum(layoutRef.current, viewport, nativeWindowState)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [nativeWindowState, syncLayout, syncWindowMinimum])

  return (
    <MotionConfig transition={{ layout: { duration: reduceMotion ? 0 : 0.3, ease: 'easeOut' } }}>
      <div
        className="responsive-player-layout"
        data-player-layout={layout}
        data-player-short={short || undefined}
      >
        {windowBar}
        {children}
      </div>
    </MotionConfig>
  )
}
