import './App.css'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { appCopy } from '@/copy'
import { systemIcons, type SystemIcon } from '@/icons/systemIcons'
import { initialPlayerState } from '@/playerState'
import type { PlayerState, Track } from '@/playerTypes'

type Direction = -1 | 1
type ShuffleMode = 'none' | 'shuffle-all' | 'shuffle-category-order' | 'shuffle-category-random'
type RepeatMode = 'list-loop' | 'repeat-one' | 'sequential' | 'all-categories-until-stop'
type ProgressStyle = CSSProperties & { '--progress-percent': string }
type PlayerBackgroundStyle = CSSProperties & { '--player-background-art'?: string }
type CoverStyle = CSSProperties & { '--cover-art'?: string }

const nextShuffleMode: Record<ShuffleMode, ShuffleMode> = {
  none: 'shuffle-all',
  'shuffle-all': 'shuffle-category-order',
  'shuffle-category-order': 'shuffle-category-random',
  'shuffle-category-random': 'none',
}

const nextRepeatMode: Record<RepeatMode, RepeatMode> = {
  'list-loop': 'repeat-one',
  'repeat-one': 'sequential',
  sequential: 'all-categories-until-stop',
  'all-categories-until-stop': 'list-loop',
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.floor(value))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function resolveTrack(tracks: Track[], id: string | null) {
  return tracks.find((track) => track.id === id) ?? tracks[0] ?? null
}

function getTrackCategory(track: Track) {
  return track.category ?? track.album
}

function getCategoryOrder(tracks: Track[]) {
  return Array.from(new Set(tracks.map(getTrackCategory)))
}

function randomFromIndexes(indexes: number[], fallback: number, excludedIndex?: number) {
  const candidates = indexes.filter((index) => index !== excludedIndex)
  const pool = candidates.length ? candidates : indexes

  if (!pool.length) return fallback

  return pool[Math.floor(Math.random() * pool.length)]
}

function resolveShuffleAllIndex(tracks: Track[], currentIndex: number) {
  return randomFromIndexes(tracks.map((_, index) => index), currentIndex, currentIndex)
}

function resolveCategoryOrderRandomIndex(tracks: Track[], currentIndex: number, direction: Direction) {
  const current = tracks[currentIndex] ?? tracks[0]
  if (!current) return currentIndex

  const categories = getCategoryOrder(tracks)
  const currentCategoryIndex = Math.max(0, categories.indexOf(getTrackCategory(current)))
  const nextCategory = categories[(currentCategoryIndex + direction + categories.length) % categories.length]
  const indexes = tracks.map((track, index) => getTrackCategory(track) === nextCategory ? index : -1).filter((index) => index >= 0)

  return randomFromIndexes(indexes, currentIndex)
}

function resolveCategoryRandomSequentialIndex(tracks: Track[], currentIndex: number, direction: Direction) {
  const current = tracks[currentIndex] ?? tracks[0]
  if (!current) return currentIndex

  const currentCategory = getTrackCategory(current)
  const categoryIndexes = tracks.map((track, index) => getTrackCategory(track) === currentCategory ? index : -1).filter((index) => index >= 0)
  const currentPosition = categoryIndexes.indexOf(currentIndex)
  const nextInCategory = categoryIndexes[currentPosition + direction]

  if (nextInCategory !== undefined) return nextInCategory

  const categories = getCategoryOrder(tracks)
  const category = randomFromIndexes(categories.map((_, index) => index), 0, categories.indexOf(currentCategory))
  const targetCategory = categories[category]
  const targetIndexes = tracks.map((track, index) => getTrackCategory(track) === targetCategory ? index : -1).filter((index) => index >= 0)

  return direction === 1 ? targetIndexes[0] ?? currentIndex : targetIndexes[targetIndexes.length - 1] ?? currentIndex
}

function resolveNextTrackIndex(tracks: Track[], currentIndex: number, direction: Direction, mode: ShuffleMode) {
  if (mode === 'shuffle-all') return resolveShuffleAllIndex(tracks, currentIndex)
  if (mode === 'shuffle-category-order') return resolveCategoryOrderRandomIndex(tracks, currentIndex, direction)
  if (mode === 'shuffle-category-random') return resolveCategoryRandomSequentialIndex(tracks, currentIndex, direction)

  return (currentIndex + direction + tracks.length) % tracks.length
}

function IconButton({ label, icon: Icon, selected = false, ...props }: { label: string; icon: SystemIcon; selected?: boolean } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button aria-label={label} aria-pressed={selected} data-selected={selected} size="icon" type="button" variant="ghost" {...props} />}>
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function App() {
  const [state, setState] = useState<PlayerState>(initialPlayerState)
  const [likedId, setLikedId] = useState<string | null>(null)
  const [dislikedId, setDislikedId] = useState<string | null>(null)
  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>('none')
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('list-loop')
  const [lyricTransition, setLyricTransition] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const [showTranslations, setShowTranslations] = useState(false)
  const [muted, setMuted] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const lyricListRef = useRef<HTMLOListElement>(null)
  const lyricRefs = useRef(new Map<string, HTMLLIElement>())
  const activeLyricIdRef = useRef<string | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)
  const endingTrackRef = useRef<string | null>(null)
  const track = useMemo(() => resolveTrack(state.tracks, state.currentTrackId), [state.currentTrackId, state.tracks])
  const playing = state.playbackStatus === 'playing'
  const duration = track?.durationSeconds ?? 0
  const progress = Math.min(Math.max(state.progressSeconds, 0), duration)
  const activeLyric = track?.lyrics.reduce((active, line) => line.timeSeconds <= progress ? line : active, track.lyrics[0])
  const activeLyricIndex = track?.lyrics.findIndex((line) => line.id === activeLyric?.id) ?? -1
  const progressStyle: ProgressStyle = { '--progress-percent': `${duration ? progress / duration * 100 : 0}%` }
  const albumArt = track?.coverImage ? `url("${track.coverImage}") center / cover no-repeat` : undefined
  const playerBackgroundStyle: PlayerBackgroundStyle | undefined = albumArt ? { '--player-background-art': albumArt } : undefined
  const coverStyle: CoverStyle | undefined = albumArt ? { '--cover-art': albumArt } : undefined

  const changeTrack = useCallback((direction: Direction, automatic = false) => {
    endingTrackRef.current = null
    setState((previous) => {
      if (!previous.tracks.length) return { ...previous, playbackStatus: 'paused', progressSeconds: 0 }
      const currentIndex = Math.max(0, previous.tracks.findIndex((item) => item.id === previous.currentTrackId))
      const currentTrack = previous.tracks[currentIndex] ?? previous.tracks[0]

      if (automatic && repeatMode === 'repeat-one') return { ...previous, playbackStatus: 'playing', progressSeconds: 0 }
      if (automatic && (repeatMode === 'sequential' || repeatMode === 'all-categories-until-stop') && currentIndex >= previous.tracks.length - 1) {
        return { ...previous, playbackStatus: 'paused', progressSeconds: currentTrack.durationSeconds }
      }

      const nextIndex = resolveNextTrackIndex(previous.tracks, currentIndex, direction, shuffleMode)
      return { ...previous, currentTrackId: previous.tracks[nextIndex].id, playbackStatus: automatic ? 'playing' : previous.playbackStatus, progressSeconds: 0 }
    })
  }, [repeatMode, shuffleMode])

  useEffect(() => {
    if (!playing || !track) return

    let frameId = 0

    function step(timestamp: number) {
      const lastFrameTime = lastFrameTimeRef.current ?? timestamp
      const elapsedSeconds = (timestamp - lastFrameTime) / 1000

      lastFrameTimeRef.current = timestamp

      setState((previous) => {
        const current = resolveTrack(previous.tracks, previous.currentTrackId)
        if (!current) return { ...previous, playbackStatus: 'paused', progressSeconds: 0 }
        const nextProgress = previous.progressSeconds + elapsedSeconds

        if (nextProgress >= current.durationSeconds) {
          if (endingTrackRef.current !== current.id) {
            endingTrackRef.current = current.id
            window.setTimeout(() => {
              endingTrackRef.current = null
              changeTrack(1, true)
            }, 0)
          }

          return { ...previous, progressSeconds: current.durationSeconds }
        }

        return { ...previous, progressSeconds: nextProgress }
      })

      frameId = window.requestAnimationFrame(step)
    }

    frameId = window.requestAnimationFrame(step)

    return () => {
      window.cancelAnimationFrame(frameId)
      lastFrameTimeRef.current = null
    }
  }, [changeTrack, playing, track])

  useEffect(() => {
    if (activeLyric) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const activeLine = lyricRefs.current.get(activeLyric.id)
      const lyricList = lyricListRef.current

      if (!activeLine || !lyricList) return

      lyricList.scrollTo({
        top: activeLine.offsetTop - lyricList.clientHeight / 2 + activeLine.clientHeight / 2,
        behavior: reduceMotion ? 'auto' : 'smooth',
      })
    }
  }, [activeLyric])

  useEffect(() => {
    const nextActiveLyricId = activeLyric?.id ?? null
    const previousActiveLyricId = activeLyricIdRef.current

    if (previousActiveLyricId !== nextActiveLyricId) {
      activeLyricIdRef.current = nextActiveLyricId
      setLyricTransition({ from: previousActiveLyricId, to: nextActiveLyricId })

      const timer = window.setTimeout(() => {
        setLyricTransition((current) => current.to === nextActiveLyricId ? { from: null, to: null } : current)
      }, 560)

      return () => window.clearTimeout(timer)
    }
  }, [activeLyric?.id])

  function setProgress(event: ChangeEvent<HTMLInputElement>) {
    const nextProgress = Number(event.currentTarget.value)

    endingTrackRef.current = null
    setState((previous) => ({ ...previous, progressSeconds: nextProgress }))
  }

  function cycleShuffleMode() {
    setShuffleMode((value) => nextShuffleMode[value])
  }

  function cycleRepeatMode() {
    setRepeatMode((value) => nextRepeatMode[value])
  }

  const LikeIcon = likedId === track?.id ? systemIcons.likeSelected : systemIcons.like
  const DislikeIcon = dislikedId === track?.id ? systemIcons.dislikeSelected : systemIcons.dislike
  const ShuffleIcon = shuffleMode === 'shuffle-all' ? systemIcons.shuffleOff : shuffleMode === 'shuffle-category-order' ? systemIcons.shuffleCategoryOrder : shuffleMode === 'shuffle-category-random' ? systemIcons.shuffleCategoryRandom : systemIcons.shuffle
  const shuffleLabel = shuffleMode === 'shuffle-all' ? appCopy.controls.shuffleOff : shuffleMode === 'shuffle-category-order' ? appCopy.controls.shuffleCategoryOrder : shuffleMode === 'shuffle-category-random' ? appCopy.controls.shuffleCategoryRandom : appCopy.controls.shuffle
  const RepeatIcon = repeatMode === 'repeat-one' ? systemIcons.repeatOne : repeatMode === 'sequential' ? systemIcons.sequential : repeatMode === 'all-categories-until-stop' ? systemIcons.playAllCategories : systemIcons.repeat
  const repeatLabel = repeatMode === 'repeat-one' ? appCopy.controls.repeatOne : repeatMode === 'sequential' ? appCopy.controls.sequential : repeatMode === 'all-categories-until-stop' ? appCopy.controls.playAllCategories : appCopy.controls.repeat
  const CaptionsIcon = showTranslations ? systemIcons.captionsSelected : systemIcons.captions
  const shuffleSelected = shuffleMode !== 'none'
  const repeatSelected = repeatMode !== 'list-loop'

  return (
    <TooltipProvider>
      <main className="player-shell" data-cover={track?.coverTone ?? 'empty'} style={playerBackgroundStyle} aria-labelledby="app-title">
        <div className="ambient-cover" aria-hidden="true" />
        <header className="window-bar">
          <IconButton icon={systemIcons.collapse} label={appCopy.controls.collapse} />
          <h1 id="app-title" className="sr-only">{appCopy.appTitle}</h1>
          <div className="window-actions">
            <IconButton icon={systemIcons.fullscreen} label={appCopy.controls.fullscreen} />
            <IconButton icon={systemIcons.minimize} label={appCopy.controls.minimize} />
            <IconButton icon={systemIcons.maximize} label={appCopy.controls.maximize} />
            <IconButton icon={systemIcons.close} label={appCopy.controls.close} />
          </div>
        </header>

        {track ? (
          <section className="player-stage" aria-label={appCopy.shellLabel}>
            <article className="cover-column">
              <div className="cover-art" data-tone={track.coverTone} data-has-image={Boolean(track.coverImage)} style={coverStyle}>
                {!track.coverImage ? <div className="cover-mark"><systemIcons.music /><strong>{appCopy.productName}</strong><span>LOCAL LISTENING</span></div> : null}
                <div className="cover-feedback">
                  <IconButton icon={LikeIcon} label={appCopy.controls.like} selected={likedId === track.id} onClick={() => { setLikedId((id) => id === track.id ? null : track.id); setDislikedId(null) }} />
                  <IconButton icon={DislikeIcon} label={appCopy.controls.dislike} selected={dislikedId === track.id} onClick={() => { setDislikedId((id) => id === track.id ? null : track.id); setLikedId(null) }} />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button className="more-button" aria-label={appCopy.controls.more} size="icon" variant="ghost" />}><systemIcons.more /></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top"><DropdownMenuGroup><DropdownMenuLabel>{appCopy.moreMenu.info}</DropdownMenuLabel><DropdownMenuItem onClick={() => void navigator.clipboard?.writeText(track.title)}>{appCopy.moreMenu.copyTitle}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="track-pills" aria-live="polite">
                <span className="title-pill">{track.title}</span>
                <span className="artist-pill">{track.artist} - {track.album}</span>
              </div>
            </article>

            <section className="lyrics-panel" aria-labelledby="lyrics-title">
              <h2 id="lyrics-title" className="sr-only">{appCopy.lyrics.title}</h2>
              {track.lyrics.length ? <ol ref={lyricListRef}>{track.lyrics.map((line, index) => <li key={line.id} ref={(node) => { if (node) lyricRefs.current.set(line.id, node) }} data-active={line.id === activeLyric?.id} data-entering={line.id === lyricTransition.to} data-leaving={line.id === lyricTransition.from} data-position={index < activeLyricIndex ? 'past' : index === activeLyricIndex ? 'active' : 'future'}><span>{line.original}</span>{showTranslations ? <span className="translation-line" lang="zh-CN">{line.translation}</span> : null}</li>)}</ol> : <p>{appCopy.lyrics.empty}</p>}
            </section>

            {queueOpen ? (
              <section className="debug-queue-panel" aria-label={appCopy.queue.title}>
                <ol>
                  {state.tracks.map((item, index) => (
                    <li key={item.id} data-current={item.id === track.id}>
                      <span>{index + 1}</span>
                      <strong>{item.title}</strong>
                      <small>{item.artist}</small>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </section>
        ) : <section className="empty-state"><systemIcons.queue /><h2>{appCopy.queue.emptyTitle}</h2><p>{appCopy.queue.emptyDescription}</p></section>}

        <footer className="control-dock" style={progressStyle}>
          <div className="progress-row"><time>{formatDuration(progress)}</time><input aria-label={appCopy.progress.label} disabled={!track || duration <= 0} max={duration} min="0" onChange={setProgress} step="0.01" type="range" value={progress} /><time>{formatDuration(duration)}</time></div>
          <div className="control-row">
            <div className="control-side"><IconButton icon={systemIcons.audioWave} label={appCopy.spectrum.title} disabled={!track} /></div>
            <div className="transport">
              <IconButton icon={ShuffleIcon} label={shuffleLabel} selected={shuffleSelected} disabled={!track} onClick={cycleShuffleMode} />
              <IconButton icon={systemIcons.previous} label={appCopy.controls.previous} disabled={!track} onClick={() => changeTrack(-1)} />
              <Button className="play-button" aria-label={playing ? appCopy.controls.pause : appCopy.controls.play} aria-pressed={playing} disabled={!track} size="icon-lg" onClick={() => setState((previous) => ({ ...previous, playbackStatus: previous.playbackStatus === 'playing' ? 'paused' : 'playing', progressSeconds: previous.progressSeconds >= duration ? 0 : previous.progressSeconds }))}>{playing ? <systemIcons.pause /> : <systemIcons.play />}</Button>
              <IconButton icon={systemIcons.next} label={appCopy.controls.next} disabled={!track} onClick={() => changeTrack(1)} />
              <IconButton icon={RepeatIcon} label={repeatLabel} selected={repeatSelected} disabled={!track} onClick={cycleRepeatMode} />
            </div>
            <div className="control-side control-side-end">
              <IconButton icon={CaptionsIcon} label={appCopy.controls.captions} selected={showTranslations} onClick={() => setShowTranslations((value) => !value)} />
              <IconButton icon={systemIcons.volume} label={appCopy.controls.volume} selected={muted} onClick={() => setMuted((value) => !value)} />
              <IconButton icon={systemIcons.queue} label={appCopy.controls.queue} selected={queueOpen} onClick={() => setQueueOpen((value) => !value)} />
            </div>
          </div>
        </footer>
      </main>
    </TooltipProvider>
  )
}

export default App
