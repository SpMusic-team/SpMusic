import { useLayoutEffect, useRef } from 'react'
import type { ArtworkSourceView } from '@/features/player/hooks/useArtworkVisualResource'

type ArtworkCanvasProps = {
  source?: ArtworkSourceView
  className?: string
  label?: string
  hidden?: boolean
  maxBackingEdge?: number
  onReady?: () => void
  onError?: () => void
}

function drawCover(canvas: HTMLCanvasElement, view: ArtworkSourceView, maxBackingEdge?: number) {
  const source = view.source
  const cssWidth = canvas.clientWidth
  const cssHeight = canvas.clientHeight
  if (
    cssWidth <= 0
    || cssHeight <= 0
    || view.contentWidth <= 0
    || view.contentHeight <= 0
  ) return false
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const naturalWidth = Math.max(1, Math.round(cssWidth * dpr))
  const naturalHeight = Math.max(1, Math.round(cssHeight * dpr))
  const backingScale = maxBackingEdge
    ? Math.min(1, maxBackingEdge / Math.max(naturalWidth, naturalHeight))
    : 1
  const width = Math.max(1, Math.round(naturalWidth * backingScale))
  const height = Math.max(1, Math.round(naturalHeight * backingScale))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('Canvas 2D context is unavailable')

  const sourceAspect = view.contentWidth / view.contentHeight
  const targetAspect = width / height
  let sourceX = view.contentX
  let sourceY = view.contentY
  let sourceWidth = view.contentWidth
  let sourceHeight = view.contentHeight
  if (sourceAspect > targetAspect) {
    sourceWidth = view.contentHeight * targetAspect
    sourceX = view.contentX + (view.contentWidth - sourceWidth) / 2
  } else if (sourceAspect < targetAspect) {
    sourceHeight = view.contentWidth / targetAspect
    sourceY = view.contentY + (view.contentHeight - sourceHeight) / 2
  }

  context.clearRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  )
  return true
}

export function ArtworkCanvas({
  source,
  className,
  label,
  hidden = false,
  maxBackingEdge,
  onReady,
  onError,
}: ArtworkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const contentRevision = source?.contentRevision
  const callbacksRef = useRef({ onReady, onError })

  useLayoutEffect(() => {
    callbacksRef.current = { onReady, onError }
  }, [onError, onReady])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!source) {
      canvas.width = 0
      canvas.height = 0
      return
    }
    let disposed = false
    let frameId: number | null = null
    const draw = () => {
      frameId = null
      if (disposed) return
      try {
        if (drawCover(canvas, source, maxBackingEdge)) callbacksRef.current.onReady?.()
      } catch {
        callbacksRef.current.onError?.()
      }
    }
    const scheduleDraw = () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(draw)
    }
    const observer = new ResizeObserver(scheduleDraw)
    observer.observe(canvas)
    scheduleDraw()
    return () => {
      disposed = true
      observer.disconnect()
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [contentRevision, maxBackingEdge, source])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    return () => {
      if (!canvas) return
      canvas.width = 0
      canvas.height = 0
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role={hidden ? undefined : 'img'}
      aria-hidden={hidden || undefined}
      aria-label={hidden ? undefined : label}
    />
  )
}
