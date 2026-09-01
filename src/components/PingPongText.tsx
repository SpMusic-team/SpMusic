import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useAppearance } from '@/features/appearance/hooks/useAppearance'
import { cn } from '@/lib/utils'
import './ping-pong-text.css'

type PingPongTextProps = {
  as?: 'span' | 'strong'
  className?: string
  text: string
}

const OVERFLOW_TOLERANCE = 1

export function PingPongText({ as: Component = 'span', className, text }: PingPongTextProps) {
  const { appearance, motion } = useAppearance()
  const viewportRef = useRef<HTMLSpanElement>(null)
  const movingTextRef = useRef<HTMLSpanElement>(null)
  const animationRef = useRef<Animation | null>(null)
  const hoveredRef = useRef(false)
  const [state, setState] = useState({ animated: false, overflow: false })
  const timing = appearance.player.trackMetadata

  const stopAnimation = useCallback(() => {
    animationRef.current?.cancel()
    animationRef.current = null
  }, [])

  const measureAndAnimate = useCallback(() => {
    const viewport = viewportRef.current
    const movingText = movingTextRef.current
    if (!viewport || !movingText) return

    stopAnimation()
    const distance = Math.max(0, movingText.scrollWidth - viewport.clientWidth)
    const overflow = distance > OVERFLOW_TOLERANCE
    const animated = overflow && !motion.disabled
    setState((previous) => previous.animated === animated && previous.overflow === overflow
      ? previous
      : { animated, overflow })

    if (!animated) return

    const travelDuration = distance / timing.scrollPixelsPerSecond * 1000
    const totalDuration = timing.scrollStartDelayMs
      + travelDuration
      + timing.scrollEdgePauseMs
      + travelDuration
      + timing.scrollEdgePauseMs
    const forwardStart = timing.scrollStartDelayMs / totalDuration
    const forwardEnd = (timing.scrollStartDelayMs + travelDuration) / totalDuration
    const returnStart = (timing.scrollStartDelayMs + travelDuration + timing.scrollEdgePauseMs) / totalDuration
    const returnEnd = (timing.scrollStartDelayMs + travelDuration + timing.scrollEdgePauseMs + travelDuration) / totalDuration

    // 正向/反向滚动段使用 ease-in-out，呈现“慢-快-慢”节奏；
    // 停顿段保持 linear（位置不变，缓动仅保证停顿时长精确）。
    const animation = movingText.animate([
      { transform: 'translate3d(0, 0, 0)', offset: 0, easing: 'linear' },
      { transform: 'translate3d(0, 0, 0)', offset: forwardStart, easing: 'ease-in-out' },
      { transform: `translate3d(-${distance}px, 0, 0)`, offset: forwardEnd, easing: 'linear' },
      { transform: `translate3d(-${distance}px, 0, 0)`, offset: returnStart, easing: 'ease-in-out' },
      { transform: 'translate3d(0, 0, 0)', offset: returnEnd, easing: 'linear' },
      { transform: 'translate3d(0, 0, 0)', offset: 1 },
    ], {
      duration: totalDuration,
      easing: 'linear',
      iterations: Infinity,
    })

    if (hoveredRef.current || document.hidden) animation.pause()
    animationRef.current = animation
  }, [motion.disabled, stopAnimation, timing.scrollEdgePauseMs, timing.scrollPixelsPerSecond, timing.scrollStartDelayMs])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const movingText = movingTextRef.current
    if (!viewport || !movingText) return

    let frame = 0
    const scheduleMeasurement = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(measureAndAnimate)
    }
    const resizeObserver = new ResizeObserver(scheduleMeasurement)
    resizeObserver.observe(viewport)
    resizeObserver.observe(movingText)
    scheduleMeasurement()
    void document.fonts?.ready.then(scheduleMeasurement)

    const handleVisibilityChange = () => {
      const animation = animationRef.current
      if (!animation) return
      if (document.hidden || hoveredRef.current) animation.pause()
      else animation.play()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopAnimation()
    }
  }, [measureAndAnimate, stopAnimation, text])

  const handlePointerEnter = () => {
    hoveredRef.current = true
    animationRef.current?.pause()
  }

  const handlePointerLeave = () => {
    hoveredRef.current = false
    if (!document.hidden) animationRef.current?.play()
  }

  return (
    <Component
      className={cn('ping-pong-text', className)}
      data-animated={state.animated || undefined}
      data-overflow={state.overflow || undefined}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      title={text}
    >
      <span ref={viewportRef} className="ping-pong-text-viewport">
        <span className="ping-pong-text-static">{text}</span>
        <span ref={movingTextRef} aria-hidden="true" className="ping-pong-text-moving">{text}</span>
      </span>
    </Component>
  )
}
