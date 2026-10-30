import { useLayoutEffect, useState } from 'react'
import { useAnimationControls } from 'motion/react'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'

export function useCollectionEntryProjection(isPresent: boolean, offscreenReturn: boolean) {
  const appearance = useAppearanceMotion()
  const [session, setSession] = useState({ isPresent, offscreen: offscreenReturn,
    sharedReady: !offscreenReturn || appearance.disabled })
  const current = session.isPresent === isPresent ? session : {
    isPresent, offscreen: isPresent ? offscreenReturn : session.offscreen,
    sharedReady: isPresent ? !offscreenReturn || appearance.disabled : session.sharedReady,
  }
  if (current !== session) setSession(current)
  const entryPending = current.offscreen && !current.sharedReady
  const entryControls = useAnimationControls()
  useLayoutEffect(() => {
    if (!isPresent) return
    let cancelled = false
    const ready = () => {
      if (!cancelled) setSession(previous => previous.sharedReady ? previous : { ...previous, sharedReady: true })
    }
    if (entryPending && !appearance.disabled) {
      entryControls.set('initial')
      void entryControls.start('animate').then(ready)
    } else {
      entryControls.set('animate')
      if (entryPending) ready()
    }
    return () => { cancelled = true; entryControls.stop() }
  }, [entryPending, appearance.disabled, isPresent, appearance.libraryNavigation, entryControls])
  const sharedProjection = !appearance.disabled && !entryPending
  return { offscreenEntry: current.offscreen, entryControls, sharedProjection,
    projectionKey: sharedProjection ? 'shared' : 'local' }
}
