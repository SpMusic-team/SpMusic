import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { Star48Filled } from '@fluentui/react-icons'
import starOutline from '@/assets/rating-star.svg?no-inline'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { Button } from '@/components/ui/button'
import type { TrackRating } from '../model/playerTypes'

type RatingGesture = { id: number; startX: number; startY: number; left: number; pitch: number; original: TrackRating; tapScore: TrackRating; moved: boolean; longPressed: boolean }
const scores = [1, 2, 3, 4, 5] as const

export function StarRating({ value, onChange, disabled = false }: { value: TrackRating; onChange: (value: TrackRating) => void; disabled?: boolean }) {
  const { disabled: motionDisabled } = useAppearanceMotion()
  const [pressed, setPressed] = useState(false)
  const [focused, setFocused] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<RatingGesture | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ value, onChange, disabled })
  useLayoutEffect(() => { latest.current = { value, onChange, disabled } }, [value, onChange, disabled])
  const clearTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
  }
  const cancelGesture = () => {
    clearTimer()
    const gesture = gestureRef.current
    gestureRef.current = null
    if (gesture && rootRef.current?.hasPointerCapture(gesture.id)) rootRef.current.releasePointerCapture(gesture.id)
    setPressed(false)
  }
  useEffect(() => {
    if (!disabled) return
    // Disable can arrive during native capture; clear before another input can write.
    const gesture = gestureRef.current
    gestureRef.current = null
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
    const node = rootRef.current
    if (gesture && node?.hasPointerCapture(gesture.id)) node.releasePointerCapture(gesture.id)
    let current = true
    queueMicrotask(() => { if (current) setPressed(false) })
    return () => { current = false }
  }, [disabled])
  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    gestureRef.current = null
  }, [])
  const updateAt = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.id !== event.pointerId || latest.current.disabled) return
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 8) {
      gesture.moved = true
      clearTimer()
    }
    if (!gesture.moved) return
    const position = (event.clientX - gesture.left) / gesture.pitch
    const rating = Math.max(0, Math.min(5, position <= .25 ? 0 : Math.ceil(position))) as TrackRating
    if (rating !== latest.current.value) latest.current.onChange(rating)
  }
  const expanded = !disabled && (pressed || focused)
  return <div ref={rootRef} className="star-rating" role="group"
    data-motion-disabled={motionDisabled} data-expanded={expanded} data-pressed={pressed && !disabled} data-rating-count={expanded ? 5 : Math.max(1, value)}
    style={{ '--rating-visible-count': expanded ? 5 : Math.max(1, value) } as CSSProperties}
    aria-disabled={disabled}
    aria-label={value ? `歌曲评分：${value} 分，满分 5 分` : '歌曲评分：未评分'}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false) }}
    onPointerDown={event => {
      event.stopPropagation()
      if (disabled || event.button !== 0 || !event.isPrimary || gestureRef.current) return
      event.preventDefault()
      const first = event.currentTarget.querySelector<HTMLButtonElement>('[data-rating-score="1"]')
      if (!first) return
      const geometry = first.getBoundingClientRect()
      const original = value
      const initial = Math.max(1, Math.min(5, Math.ceil((event.clientX - geometry.left) / geometry.width))) as TrackRating
      gestureRef.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, left: geometry.left, pitch: geometry.width, original, tapScore: initial, moved: false, longPressed: false }
      event.currentTarget.setPointerCapture(event.pointerId)
      setFocused(false)
      setPressed(true)
      if (initial !== original) onChange(initial)
      timerRef.current = setTimeout(() => {
        const gesture = gestureRef.current
        if (!gesture || gesture.moved || latest.current.disabled) return
        gesture.longPressed = true
        latest.current.onChange(gesture.original === 5 ? 0 : 5)
        timerRef.current = null
      }, 400)
    }}
    onPointerMove={event => { event.stopPropagation(); updateAt(event) }}
    onPointerUp={event => {
      event.stopPropagation()
      if (gestureRef.current?.id !== event.pointerId) return
      updateAt(event)
      const gesture = gestureRef.current
      if (gesture && !gesture.moved && !gesture.longPressed && gesture.tapScore === gesture.original) onChange(0)
      cancelGesture()
    }}
    onPointerCancel={event => { event.stopPropagation(); if (gestureRef.current?.id === event.pointerId) cancelGesture() }}
    onLostPointerCapture={event => { event.stopPropagation(); if (gestureRef.current?.id === event.pointerId) cancelGesture() }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}
    onClick={event => { event.stopPropagation(); if (event.detail !== 0) event.preventDefault() }}>
    <div className="star-rating-track">
    {scores.map(score => <Button key={score} type="button" variant="ghost" className="star-rating-button" disabled={disabled}
      data-rating-score={score} tabIndex={expanded || score === Math.max(1, value) ? 0 : -1}
      aria-label={`${score} 分`} aria-pressed={value === score}
      onClick={event => { if (event.detail === 0) onChange(value === score ? 0 : score) }} onKeyDown={event => {
        setFocused(true)
        let next: number | undefined
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(5, value + 1)
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, value - 1)
        if (event.key === 'Home' || event.key === 'Delete' || event.key === 'Backspace') next = 0
        if (event.key === 'End') next = 5
        if (next !== undefined) { event.preventDefault(); event.stopPropagation(); onChange(next as TrackRating) }
      }}>
      {score <= value ? <Star48Filled aria-hidden="true" /> : <span className="rating-star-outline" aria-hidden="true" style={{ maskImage: `url("${starOutline}")`, WebkitMaskImage: `url("${starOutline}")` }} />}
    </Button>)}
    </div>
  </div>
}
