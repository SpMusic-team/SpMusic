import { useLayoutEffect, useRef } from 'react'
import { useAnimationControls, usePresence, type Transition } from 'motion/react'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'

export function useCollectionDetailPresence(offscreenReturn: boolean, returnTransition: Transition,
  onEntrySettled?: () => void, active = true) {
  const appearance = useAppearanceMotion()
  const [isPresent, safeToRemove] = usePresence(active)
  const sectionControls = useAnimationControls()
  const removeRef = useRef(safeToRemove)
  const settledRef = useRef(onEntrySettled)
  useLayoutEffect(() => { removeRef.current = safeToRemove; settledRef.current = onEntrySettled }, [safeToRemove, onEntrySettled])
  useLayoutEffect(() => {
    if (!active) return
    let cancelled = false
    const resting = { opacity: 1, x: 0, y: 0, scale: 1 }
    if (isPresent) {
      void sectionControls.start(resting, returnTransition).then(() => {
        if (!cancelled) settledRef.current?.()
      })
    } else if (appearance.disabled) {
      // Complete through the controls lifecycle even at zero duration. A
      // synchronous set/remove can run before Motion commits its exit members.
      void sectionControls.start(resting, { duration: 0 }).then(() => {
        if (!cancelled) removeRef.current?.()
      })
    } else {
      void sectionControls.start(offscreenReturn ? 'exit' : { opacity: 0, x: 0, y: 0, scale: 1 },
        offscreenReturn ? appearance.libraryNavigation.transition : returnTransition).then(() => {
        if (!cancelled) removeRef.current?.()
      })
    }
    return () => { cancelled = true; sectionControls.stop() }
  }, [active, isPresent, appearance.disabled, appearance.libraryNavigation.transition, offscreenReturn, returnTransition, sectionControls])
  return { isPresent, sectionControls }
}
