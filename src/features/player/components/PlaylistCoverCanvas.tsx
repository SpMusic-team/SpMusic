import { useLayoutEffect, useRef } from 'react'
import type { PlaylistCoverBitmap } from '@/features/player/model/playerUiViewModel'

type PlaylistCoverCanvasProps = {
  bitmap: PlaylistCoverBitmap
  className?: string
}

export function PlaylistCoverCanvas({ bitmap, className }: PlaylistCoverCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(bitmap.image, 0, 0, bitmap.width, bitmap.height)
  }, [bitmap])

  useLayoutEffect(() => () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = 0
    canvas.height = 0
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
