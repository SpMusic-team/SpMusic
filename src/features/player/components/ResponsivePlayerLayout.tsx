import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { MotionConfig, useReducedMotion } from 'motion/react'
import { resolveResponsivePlayerLayout } from '@/features/player/model/responsivePlayerLayout'
import type { WindowLayoutState } from './WindowBar'

type ResponsivePlayerLayoutProps = {
  children: ReactNode
  nativeWindowState: WindowLayoutState
  windowBar: ReactNode
}

function resolveCurrentViewport() {
  if (typeof window === 'undefined') return resolveResponsivePlayerLayout(1920, 1080)
  return resolveResponsivePlayerLayout(window.innerWidth, window.innerHeight)
}

export function ResponsivePlayerLayout({ children, nativeWindowState, windowBar }: ResponsivePlayerLayoutProps) {
  const reduceMotion = useReducedMotion()
  const [resolvedLayout, setResolvedLayout] = useState(resolveCurrentViewport)
  const resizeFrameRef = useRef<number | null>(null)

  const measureLatestViewport = useCallback(() => {
    const next = resolveCurrentViewport()
    setResolvedLayout((current) => (
      current.layout === next.layout
      && current.compactProfile === next.compactProfile
      && current.scale === next.scale
      && current.fallback === next.fallback
      && current.short === next.short
      && current.decisionWidth === next.decisionWidth
      && current.decisionHeight === next.decisionHeight
        ? current
        : next
    ))
  }, [])

  useEffect(() => {
    function handleResize() {
      if (resizeFrameRef.current !== null) return
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null
        measureLatestViewport()
      })
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
    }
  }, [measureLatestViewport, nativeWindowState])

  const responsiveStyle = {
    '--player-ui-scale': resolvedLayout.scale,
    '--player-ui-scale-inverse': 1 / resolvedLayout.scale,
  } as CSSProperties

  return (
    <MotionConfig transition={{ layout: { duration: reduceMotion ? 0 : 0.3, ease: 'easeOut' } }}>
      <div
        className="responsive-player-layout"
        data-player-layout={resolvedLayout.layout}
        data-player-compact-profile={resolvedLayout.compactProfile ?? undefined}
        data-player-short={resolvedLayout.short || undefined}
        data-player-layout-fallback={resolvedLayout.fallback || undefined}
        data-player-ui-scale={resolvedLayout.scale.toFixed(4)}
        style={responsiveStyle}
      >
        {windowBar}
        {children}
      </div>
    </MotionConfig>
  )
}
