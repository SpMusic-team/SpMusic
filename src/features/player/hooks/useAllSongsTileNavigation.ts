import { useLayoutEffect, useRef, type RefObject } from 'react'

// WAAPI affects presentation without touching the card's inline transform or
// triggering its CSS pressed-state transition when a navigation finishes.
export function useAllSongsTileNavigation(listRef: RefObject<HTMLDivElement | null>, panelRef: RefObject<HTMLElement | null>, enabled: boolean, ready: boolean, present: boolean, transform: string, opacity: number, duration: number, easing: string) {
  const interrupted = useRef(new WeakMap<HTMLElement, Keyframe>())
  useLayoutEffect(() => {
    const list = listRef.current, panel = panelRef.current
    const snapshots = interrupted.current
    if (!enabled || !ready || !list || !panel) return
    const first = list.firstElementChild as HTMLElement | null
    if (!first) return
    const columns = getComputedStyle(list).gridTemplateColumns.split(' ').length
    const second = list.children.item(columns) as HTMLElement | null
    const stride = second ? second.offsetTop - first.offsetTop : first.offsetHeight
    const top = panel.getBoundingClientRect().top - list.getBoundingClientRect().top - first.offsetTop
    const begin = Math.max(0, Math.floor(top / stride) - 1) * columns
    const end = Math.min(list.children.length, (Math.ceil((top + panel.clientHeight) / stride) + 1) * columns)
    const moving: { row: HTMLElement; animation: Animation }[] = []
    for (let index = begin; index < end; index++) {
      const row = list.children.item(index) as HTMLElement
      const baseOpacity = row.dataset.unavailable === 'true' ? 0.5 : 1
      const from = snapshots.get(row) ?? { transform: present ? transform : 'none', opacity: present ? opacity * baseOpacity : baseOpacity }
      snapshots.delete(row)
      const animation = row.animate([{ ...from, transformOrigin: 'left top' }, { transform: present ? 'none' : transform, opacity: present ? baseOpacity : opacity * baseOpacity, transformOrigin: 'left top' }], { duration: duration * 1000, easing, fill: 'both' })
      moving.push({ row, animation })
      if (present) void animation.finished.then(() => animation.cancel()).catch(() => {})
    }
    return () => {
      for (const { row, animation } of moving) {
        if (animation.playState === 'running') {
          const style = getComputedStyle(row)
          snapshots.set(row, { transform: style.transform, opacity: style.opacity })
        }
        animation.cancel()
      }
    }
  }, [listRef, panelRef, enabled, ready, present, transform, opacity, duration, easing])
}
