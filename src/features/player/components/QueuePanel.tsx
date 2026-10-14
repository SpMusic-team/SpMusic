import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import type { TrackSummary } from '@/features/player/model/playerTypes'

type QueuePanelProps = {
  tracks: TrackSummary[]
  unavailableTrackIds?: ReadonlySet<string>
  currentTrackId: string
  playlistName?: string
  onTrackSelect?: (trackId: string) => void
}

type QueueTrackRowProps = {
  index: number
  item: TrackSummary
  current: boolean
  disabled: boolean
  style: CSSProperties
  setSize: number
  onTrackSelect?: (trackId: string) => void
}

const QueueTrackRow = memo(function QueueTrackRow({
  index,
  item,
  current,
  disabled,
  style,
  setSize,
  onTrackSelect,
}: QueueTrackRowProps) {
  return (
    <li
      data-current={current}
      style={style}
      aria-posinset={index + 1}
      aria-setsize={setSize}
    >
      <Button
        variant="ghost"
        type="button"
        aria-current={current ? 'true' : undefined}
        disabled={disabled}
        onClick={() => onTrackSelect?.(item.id)}
      >
        <span>{index + 1}</span>
        <strong>{item.title}</strong>
        <small>{item.artist}</small>
      </Button>
    </li>
  )
})

const QUEUE_ROW_FALLBACK_PX = 32
const QUEUE_OVERSCAN_ROWS = 6

export const QueuePanel = memo(function QueuePanel({
  tracks,
  unavailableTrackIds,
  currentTrackId,
  playlistName,
  onTrackSelect,
}: QueuePanelProps) {
  const appearanceMotion = useAppearanceMotion()
  const onTrackSelectRef = useRef(onTrackSelect)
  const viewportRef = useRef<HTMLDivElement>(null)
  const rowMeasureRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [rowHeight, setRowHeight] = useState(QUEUE_ROW_FALLBACK_PX)
  useEffect(() => {
    onTrackSelectRef.current = onTrackSelect
  }, [onTrackSelect])
  const handleTrackSelect = useCallback((trackId: string) => {
    onTrackSelectRef.current?.(trackId)
  }, [])
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const rowMeasure = rowMeasureRef.current
    if (!viewport || !rowMeasure) return
    const updateMetrics = () => {
      setViewportHeight(viewport.clientHeight)
      const measuredRowHeight = rowMeasure.getBoundingClientRect().height
      if (measuredRowHeight > 0) {
        setRowHeight((previous) => (
          Math.abs(previous - measuredRowHeight) < 0.5 ? previous : measuredRowHeight
        ))
      }
    }
    updateMetrics()
    const observer = new ResizeObserver(updateMetrics)
    observer.observe(viewport)
    observer.observe(rowMeasure)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
  }, [])

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      setScrollTop(viewportRef.current?.scrollTop ?? 0)
    })
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const currentIndex = tracks.findIndex((item) => item.id === currentTrackId)
    if (!viewport || currentIndex < 0 || viewportHeight <= 0) return
    const rowTop = currentIndex * rowHeight
    const rowBottom = rowTop + rowHeight
    const visibleTop = viewport.scrollTop
    const visibleBottom = visibleTop + viewportHeight
    if (rowTop >= visibleTop && rowBottom <= visibleBottom) return
    const nextScrollTop = Math.max(0, rowTop - (viewportHeight - rowHeight) / 2)
    viewport.scrollTop = nextScrollTop
    setScrollTop(nextScrollTop)
  }, [currentTrackId, rowHeight, tracks, viewportHeight])

  const { startIndex, visibleTracks } = useMemo(() => {
    const firstVisible = Math.floor(scrollTop / rowHeight)
    const start = Math.max(0, firstVisible - QUEUE_OVERSCAN_ROWS)
    const visibleCount = Math.ceil(Math.max(viewportHeight, rowHeight) / rowHeight)
    const end = Math.min(tracks.length, firstVisible + visibleCount + QUEUE_OVERSCAN_ROWS)
    return { startIndex: start, visibleTracks: tracks.slice(start, end) }
  }, [rowHeight, scrollTop, tracks, viewportHeight])

  return (
    <motion.section
      className="debug-queue-panel"
      aria-label={appCopy.queue.title}
      variants={appearanceMotion.variants.panel}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div ref={rowMeasureRef} className="queue-row-measure" aria-hidden="true" />
      {playlistName ? (
        <header>
          <strong>{playlistName}</strong>
          <small>{tracks.length} 首音频</small>
        </header>
      ) : null}
      <div
        ref={viewportRef}
        className="queue-list-viewport"
        onScroll={handleScroll}
      >
        <fieldset className="contents" disabled={!onTrackSelect}>
          <ol style={{ height: tracks.length * rowHeight }}>
            {visibleTracks.map((item, offset) => {
              const index = startIndex + offset
              return (
                <QueueTrackRow
                  key={item.id}
                  index={index}
                  item={item}
                  current={item.id === currentTrackId}
                  disabled={Boolean(unavailableTrackIds?.has(item.id))}
                  style={{ height: rowHeight, transform: `translateY(${index * rowHeight}px)` }}
                  setSize={tracks.length}
                  onTrackSelect={handleTrackSelect}
                />
              )
            })}
          </ol>
        </fieldset>
      </div>
    </motion.section>
  )
})
