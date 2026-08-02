import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MotionConfig, useReducedMotion } from 'motion/react'
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
const QUARTER_MAX_WIDTH = 1120
const QUARTER_ENTER_WIDTH = QUARTER_MAX_WIDTH - HYSTERESIS

function isMinimumCompactViewport(viewport: ViewportSize): boolean {
  return viewport.width < 700 && viewport.height < SHORT_LAYOUT_BREAKPOINT
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

  if (previous === 'quarter') {
    if (
      compactMinimum
      || (
        viewport.width < QUARTER_MAX_WIDTH
        && viewport.height >= viewport.width - HYSTERESIS
      )
    ) return 'quarter'
  } else if (
    compactMinimum
    || (
      viewport.width < QUARTER_ENTER_WIDTH
      && viewport.height >= viewport.width + HYSTERESIS
    )
  ) {
    return 'quarter'
  } else if (
    !previous
    && viewport.width < QUARTER_MAX_WIDTH
    && viewport.height >= viewport.width
  ) {
    return 'quarter'
  }

  if (previous === 'vertical') {
    if (viewport.height >= viewport.width - HYSTERESIS) return 'vertical'
  } else if (viewport.height >= viewport.width + HYSTERESIS) {
    return 'vertical'
  } else if (!previous && viewport.height >= viewport.width) {
    return 'vertical'
  }

  if (previous === 'horizontal') {
    if (viewport.width >= 2 * viewport.height - HYSTERESIS) return 'horizontal'
  } else if (viewport.width >= 2 * viewport.height + HYSTERESIS) {
    return 'horizontal'
  } else if (!previous && viewport.width >= 2 * viewport.height) {
    return 'horizontal'
  }

  return 'full'
}

export function ResponsivePlayerLayout({ children, nativeWindowState, windowBar }: ResponsivePlayerLayoutProps) {
  const reduceMotion = useReducedMotion()
  const [layout, setLayout] = useState<PlayerLayoutMode>(() => resolveLayout(readViewport(), nativeWindowState))
  const [short, setShort] = useState(() => readViewport().height < SHORT_LAYOUT_BREAKPOINT)
  const layoutRef = useRef(layout)

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
      syncLayout(readViewport(), nativeWindowState)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [nativeWindowState, syncLayout])

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
