import { useContext, useLayoutEffect, useRef } from 'react'
import { useAnimationControls } from 'motion/react'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { LibraryChromeTransitionContext } from './useLibraryChromeTransition'
import { readLibraryLayoutRect } from '../model/libraryNavigationGeometry'

export function useCollectionManagementChrome(categoryId: string, isPresent: boolean) {
  const appearance = useAppearanceMotion()
  const chrome = useContext(LibraryChromeTransitionContext)
  const headingRef = useRef<HTMLElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const toolbarControls = useAnimationControls()
  const navigationMotion = appearance.libraryNavigation
  const atomicOverview = chrome.overviewBoundary
  useLayoutEffect(() => {
    if (!isPresent) return
    const heading = headingRef.current
    if (!heading || !chrome.geometry) return
    const measure = () => chrome.geometry!.current.items.set(`heading:${categoryId}`, readLibraryLayoutRect(heading))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(heading)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [categoryId, chrome.geometry, isPresent])
  useLayoutEffect(() => {
    if (atomicOverview && isPresent) {
      toolbarControls.set('initial')
      void toolbarControls.start('animate')
    } else if (isPresent) toolbarControls.set('animate')
    return () => toolbarControls.stop()
  }, [atomicOverview, isPresent, navigationMotion, toolbarControls])
  const toolbarOffset = () => {
    if (appearance.disabled) return { x: 0, y: 0 }
    const source = chrome.geometry?.current.items.get(categoryId)
    const target = chrome.geometry?.current.items.get(`heading:${categoryId}`)
    return source && target ? { x: source.x - target.x, y: source.y - target.y } : { x: 0, y: 0 }
  }
  return { headingRef, toolbarRef, toolbarControls, toolbarOffset, navigationMotion, atomicOverview }
}
