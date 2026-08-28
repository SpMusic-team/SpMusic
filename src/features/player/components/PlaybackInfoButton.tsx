import {
  Cd16Regular,
  FastForward16Regular,
  Folder16Regular,
  MusicNote216Regular,
  Speaker216Regular,
  type FluentIcon,
} from '@fluentui/react-icons'
import {
  type MouseEvent,
  type PointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { Button } from '@/components/ui/button'

type PlaybackInfoButtonProps = {
  visible: boolean
  visualIsPlaying: boolean
}

type PlaybackInfoVariant = {
  icon: FluentIcon | null
  text: string
}

type PlaybackInfoFeedback = {
  id: number
  clientX: number
  clientY: number
}

const playbackInfoVariants: readonly PlaybackInfoVariant[] = [
  {
    icon: Speaker216Regular,
    text: 'OPENSL ES OUTPUT 16 BIT 48 KHZ',
  },
  {
    icon: Cd16Regular,
    text: '艺术家专辑 - 1/3',
  },
  {
    icon: FastForward16Regular,
    text: "ETHER STRIKE(‘DIVINE MERCY’ EXTENDED ) - AKIRA COMPLEX",
  },
  {
    icon: null,
    text: '44.1KHZ 320KBPS MP3',
  },
  {
    icon: Folder16Regular,
    text: 'PRIMARY/MUSIC',
  },
  {
    icon: MusicNote216Regular,
    text: '所有歌曲 - 418/1784',
  },
]

export function PlaybackInfoButton({ visible, visualIsPlaying }: PlaybackInfoButtonProps) {
  const [variantIndex, setVariantIndex] = useState(0)
  const [feedback, setFeedback] = useState<PlaybackInfoFeedback | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const feedbackRef = useRef<HTMLSpanElement>(null)
  const feedbackIdRef = useRef(0)
  const currentVariant = playbackInfoVariants[variantIndex]
  const CurrentIcon = currentVariant.icon

  const activateNextVariant = (clientX: number, clientY: number) => {
    feedbackIdRef.current += 1
    setFeedback({
      id: feedbackIdRef.current,
      clientX,
      clientY,
    })
    setVariantIndex((currentIndex) => (currentIndex + 1) % playbackInfoVariants.length)
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    activateNextVariant(event.clientX, event.clientY)
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Pointer activation already runs on pointerdown. A detail of zero identifies
    // keyboard-triggered clicks, which still need an equivalent centered ripple.
    if (event.detail !== 0) return

    const bounds = event.currentTarget.getBoundingClientRect()
    activateNextVariant(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    )
  }

  useLayoutEffect(() => {
    if (!feedback) return

    const button = buttonRef.current
    const ripple = feedbackRef.current
    const parent = button?.parentElement
    if (!button || !ripple || !parent) return

    const currentBounds = button.getBoundingClientRect()
    const clone = button.cloneNode(true) as HTMLButtonElement
    clone.querySelector('.playback-info-button-press-feedback')?.remove()
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
    const targetTop = currentBounds.top
    const coverageLeft = Math.min(currentBounds.left, targetLeft)
    const coverageTop = Math.min(currentBounds.top, targetTop)
    const coverageRight = Math.max(currentBounds.right, targetLeft + targetBounds.width)
    const coverageBottom = Math.max(currentBounds.bottom, targetTop + targetBounds.height)
    const radius = Math.max(
      Math.hypot(feedback.clientX - coverageLeft, feedback.clientY - coverageTop),
      Math.hypot(feedback.clientX - coverageRight, feedback.clientY - coverageTop),
      Math.hypot(feedback.clientX - coverageLeft, feedback.clientY - coverageBottom),
      Math.hypot(feedback.clientX - coverageRight, feedback.clientY - coverageBottom),
    )

    ripple.style.setProperty('--playback-info-feedback-diameter', `${Math.ceil(radius * 2)}px`)

    let animationFrame = 0
    const startedAt = performance.now()
    const keepRippleAtClickPoint = () => {
      const liveBounds = button.getBoundingClientRect()
      ripple.style.setProperty('--playback-info-feedback-x', `${feedback.clientX - liveBounds.left}px`)
      ripple.style.setProperty('--playback-info-feedback-y', `${feedback.clientY - liveBounds.top}px`)

      if (performance.now() - startedAt < 300) {
        animationFrame = requestAnimationFrame(keepRippleAtClickPoint)
      }
    }

    keepRippleAtClickPoint()
    return () => cancelAnimationFrame(animationFrame)
  }, [feedback, variantIndex])

  return (
    <Button
      ref={buttonRef}
      className="playback-info-button"
      type="button"
      variant="secondary"
      data-visible={visible}
      data-playback-state={visualIsPlaying ? 'playing' : 'paused'}
      aria-hidden={!visible || undefined}
      aria-label={`当前播放信息：${currentVariant.text}。点击切换播放信息。`}
      disabled={!visible}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      {feedback ? (
        <span
          ref={feedbackRef}
          key={feedback.id}
          aria-hidden="true"
          className="playback-info-button-press-feedback"
          onAnimationEnd={() => setFeedback((currentFeedback) => currentFeedback?.id === feedback.id ? null : currentFeedback)}
        />
      ) : null}
      <span className="playback-info-button-content">
        {CurrentIcon ? <CurrentIcon data-icon="inline-start" aria-hidden="true" /> : null}
        <span className="playback-info-button-text" aria-live="polite" aria-atomic="true">
          {currentVariant.text}
        </span>
      </span>
    </Button>
  )
}
