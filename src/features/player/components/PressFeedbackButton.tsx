import {
  forwardRef,
  type ButtonHTMLAttributes,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

type PressFeedback = {
  clientX: number
  clientY: number
  id: number
}

type PressFeedbackButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onPointerCancel' | 'onPointerDown' | 'onPointerUp'> & {
  children: ReactNode
  /** Re-measures the ripple's target bounds when a press synchronously changes content. */
  layoutKey?: unknown
  onPressStart?: () => void
  tone?: 'surface-variant' | 'secondary-container'
}

/**
 * A semantic button with a pointer-originated ripple. A completed ripple remains
 * visible while its primary pointer is held, then clears on release or cancel.
 */
export const PressFeedbackButton = forwardRef<HTMLButtonElement, PressFeedbackButtonProps>(function PressFeedbackButton({
  children,
  className,
  layoutKey,
  onClick: onExternalClick,
  onPressStart,
  tone = 'surface-variant',
  type = 'button',
  ...buttonProps
}: PressFeedbackButtonProps, forwardedRef) {
  const [feedback, setFeedback] = useState<PressFeedback | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const feedbackRef = useRef<HTMLSpanElement>(null)
  const feedbackIdRef = useRef(0)
  const activePointerIdRef = useRef<number | null>(null)
  const pointerIsDownRef = useRef(false)
  const rippleFinishedRef = useRef(false)

  const assignButtonRef = (node: HTMLButtonElement | null) => {
    buttonRef.current = node
    if (typeof forwardedRef === 'function') {
      forwardedRef(node)
      return
    }
    if (forwardedRef) (forwardedRef as Ref<HTMLButtonElement> & { current: HTMLButtonElement | null }).current = node
  }

  const startFeedback = (clientX: number, clientY: number) => {
    feedbackIdRef.current += 1
    rippleFinishedRef.current = false
    setFeedback({ id: feedbackIdRef.current, clientX, clientY })
    onPressStart?.()
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary) return

    activePointerIdRef.current = event.pointerId
    pointerIsDownRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    startFeedback(event.clientX, event.clientY)
  }

  const releasePointer = (pointerId: number, cancelled = false) => {
    if (activePointerIdRef.current !== pointerId) return

    activePointerIdRef.current = null
    pointerIsDownRef.current = false
    if (cancelled || rippleFinishedRef.current) setFeedback(null)
  }

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onExternalClick?.(event)
    if (event.defaultPrevented) return

    // Pointer presses are handled on pointerdown. detail=0 is keyboard activation.
    if (event.detail !== 0) return

    const bounds = event.currentTarget.getBoundingClientRect()
    startFeedback(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
  }

  useLayoutEffect(() => {
    if (!feedback) return

    const button = buttonRef.current
    const ripple = feedbackRef.current
    const parent = button?.parentElement
    if (!button || !ripple || !parent) return

    const currentBounds = button.getBoundingClientRect()
    let coverageLeft = currentBounds.left
    let coverageTop = currentBounds.top
    let coverageRight = currentBounds.right
    let coverageBottom = currentBounds.bottom

    // Only content-changing controls (currently the playback information badge)
    // need to predict their post-press bounds. Static icon buttons must use their
    // live bounds; forcing a fit-content clone changes their fixed icon size.
    if (layoutKey !== undefined) {
      const clone = button.cloneNode(true) as HTMLButtonElement
      clone.querySelector('.press-feedback-button-ripple')?.remove()
      clone.setAttribute('aria-hidden', 'true')
      clone.tabIndex = -1
      clone.style.setProperty('position', 'fixed', 'important')
      clone.style.setProperty('inset', '0 auto auto 0', 'important')
      clone.style.setProperty('width', 'fit-content', 'important')
      clone.style.setProperty('height', 'fit-content', 'important')
      clone.style.setProperty('visibility', 'hidden', 'important')
      clone.style.setProperty('pointer-events', 'none', 'important')
      clone.style.setProperty('transition', 'none', 'important')
      clone.style.setProperty('animation', 'none', 'important')
      parent.append(clone)
      const targetBounds = clone.getBoundingClientRect()
      clone.remove()

      const targetLeft = currentBounds.left + (currentBounds.width - targetBounds.width) / 2
      const targetTop = currentBounds.top + (currentBounds.height - targetBounds.height) / 2
      coverageLeft = Math.min(currentBounds.left, targetLeft)
      coverageTop = Math.min(currentBounds.top, targetTop)
      coverageRight = Math.max(currentBounds.right, targetLeft + targetBounds.width)
      coverageBottom = Math.max(currentBounds.bottom, targetTop + targetBounds.height)
    }
    const radius = Math.max(
      Math.hypot(feedback.clientX - coverageLeft, feedback.clientY - coverageTop),
      Math.hypot(feedback.clientX - coverageRight, feedback.clientY - coverageTop),
      Math.hypot(feedback.clientX - coverageLeft, feedback.clientY - coverageBottom),
      Math.hypot(feedback.clientX - coverageRight, feedback.clientY - coverageBottom),
    )
    ripple.style.setProperty('--press-feedback-diameter', `${Math.ceil(radius * 2)}px`)

    const setOriginFromBounds = (bounds: DOMRect) => {
      ripple.style.setProperty('--press-feedback-x', `${feedback.clientX - bounds.left}px`)
      ripple.style.setProperty('--press-feedback-y', `${feedback.clientY - bounds.top}px`)
    }

    // Fixed-size controls must keep the geometry captured on pointerdown. Opening
    // an overlay (the more-actions dialog) can move its trigger while this ripple
    // is still running; following those later bounds makes the ripple jump away
    // from the button and no longer match the diameter calculated above.
    setOriginFromBounds(currentBounds)
    if (layoutKey === undefined) return

    let frame = 0
    const startedAt = performance.now()
    const keepOriginAtPointer = () => {
      const liveBounds = button.getBoundingClientRect()
      setOriginFromBounds(liveBounds)

      // The playback-information button changes width over 250ms on press.
      if (performance.now() - startedAt < 300) frame = requestAnimationFrame(keepOriginAtPointer)
    }

    frame = requestAnimationFrame(keepOriginAtPointer)
    return () => cancelAnimationFrame(frame)
  }, [feedback, layoutKey])

  return (
    <button
      {...buttonProps}
      ref={assignButtonRef}
      className={cn('press-feedback-button', `press-feedback-button-${tone}`, className)}
      type={type}
      onPointerDown={handlePointerDown}
      onPointerUp={(event) => releasePointer(event.pointerId)}
      onPointerCancel={(event) => releasePointer(event.pointerId, true)}
      onClick={handleClick}
    >
      {feedback ? (
        <span
          ref={feedbackRef}
          key={feedback.id}
          aria-hidden="true"
          className="press-feedback-button-ripple"
          onAnimationEnd={() => {
            rippleFinishedRef.current = true
            if (!pointerIsDownRef.current) setFeedback((current) => current?.id === feedback.id ? null : current)
          }}
        />
      ) : null}
      {children}
    </button>
  )
})
