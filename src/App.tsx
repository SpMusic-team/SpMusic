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
type ProgressStyle = CSSProperties & { '--progress-percent': string }

const tickMs = 1000

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.floor(value))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function resolveTrack(tracks: Track[], id: string | null) {
  return tracks.find((track) => track.id === id) ?? tracks[0] ?? null
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
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [captions, setCaptions] = useState(true)
  const [muted, setMuted] = useState(false)
  const lyricListRef = useRef<HTMLOListElement>(null)
  const lyricRefs = useRef(new Map<string, HTMLLIElement>())
  const track = useMemo(() => resolveTrack(state.tracks, state.currentTrackId), [state.currentTrackId, state.tracks])
  const playing = state.playbackStatus === 'playing'
  const duration = track?.durationSeconds ?? 0
  const progress = Math.min(Math.max(state.progressSeconds, 0), duration)
  const activeLyric = track?.lyrics.reduce((active, line) => line.timeSeconds <= progress ? line : active, track.lyrics[0])
  const progressStyle: ProgressStyle = { '--progress-percent': `${duration ? progress / duration * 100 : 0}%` }

  const changeTrack = useCallback((direction: Direction, automatic = false) => {
    setState((previous) => {
      if (!previous.tracks.length) return { ...previous, playbackStatus: 'paused', progressSeconds: 0 }
      if (automatic && repeat) return { ...previous, progressSeconds: 0 }
      const currentIndex = Math.max(0, previous.tracks.findIndex((item) => item.id === previous.currentTrackId))
      let nextIndex = (currentIndex + direction + previous.tracks.length) % previous.tracks.length
      if (direction === 1 && shuffle && previous.tracks.length > 1) nextIndex = (currentIndex + 1 + Math.floor(Math.random() * (previous.tracks.length - 1))) % previous.tracks.length
      return { ...previous, currentTrackId: previous.tracks[nextIndex].id, playbackStatus: automatic ? 'playing' : 'paused', progressSeconds: 0 }
    })
  }, [repeat, shuffle])

  useEffect(() => {
    if (!playing || !track) return
    const timer = window.setInterval(() => setState((previous) => {
      const current = resolveTrack(previous.tracks, previous.currentTrackId)
      if (!current) return { ...previous, playbackStatus: 'paused', progressSeconds: 0 }
      if (previous.progressSeconds + 1 >= current.durationSeconds) {
        window.setTimeout(() => changeTrack(1, true), 0)
        return previous
      }
      return { ...previous, progressSeconds: previous.progressSeconds + 1 }
    }), tickMs)
    return () => window.clearInterval(timer)
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

  function setProgress(event: ChangeEvent<HTMLInputElement>) {
    setState((previous) => ({ ...previous, progressSeconds: Number(event.currentTarget.value) }))
  }

  const LikeIcon = likedId === track?.id ? systemIcons.likeSelected : systemIcons.like
  const DislikeIcon = dislikedId === track?.id ? systemIcons.dislikeSelected : systemIcons.dislike

  return (
    <TooltipProvider>
      <main className="player-shell" data-cover={track?.coverTone ?? 'empty'} aria-labelledby="app-title">
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
              <div className="cover-art" data-tone={track.coverTone}>
                <div className="cover-mark"><systemIcons.music /><strong>{appCopy.productName}</strong><span>LOCAL LISTENING</span></div>
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
                <span className="artist-pill">{track.artist} · {track.album}</span>
              </div>
            </article>

            <section className="lyrics-panel" aria-labelledby="lyrics-title">
              <h2 id="lyrics-title" className="sr-only">{appCopy.lyrics.title}</h2>
              {track.lyrics.length ? <ol ref={lyricListRef}>{track.lyrics.map((line) => <li key={line.id} ref={(node) => { if (node) lyricRefs.current.set(line.id, node) }} data-active={line.id === activeLyric?.id}><span>{line.original}</span><span lang="zh-CN">{line.translation}</span></li>)}</ol> : <p>{appCopy.lyrics.empty}</p>}
            </section>
          </section>
        ) : <section className="empty-state"><systemIcons.queue /><h2>{appCopy.queue.emptyTitle}</h2><p>{appCopy.queue.emptyDescription}</p></section>}

        <footer className="control-dock" style={progressStyle}>
          <div className="progress-row"><time>{formatDuration(progress)}</time><input aria-label={appCopy.progress.label} disabled={!track || duration <= 0} max={duration} min="0" onChange={setProgress} type="range" value={progress} /><time>{formatDuration(duration)}</time></div>
          <div className="control-row">
            <div className="control-side"><IconButton icon={systemIcons.shuffle} label={appCopy.controls.shuffle} selected={shuffle} disabled={!track} onClick={() => setShuffle((value) => !value)} /></div>
            <div className="transport">
              <IconButton icon={systemIcons.previous} label={appCopy.controls.previous} disabled={!track} onClick={() => changeTrack(-1)} />
              <Button className="play-button" aria-label={playing ? appCopy.controls.pause : appCopy.controls.play} aria-pressed={playing} disabled={!track} size="icon-lg" onClick={() => setState((previous) => ({ ...previous, playbackStatus: previous.playbackStatus === 'playing' ? 'paused' : 'playing', progressSeconds: previous.progressSeconds >= duration ? 0 : previous.progressSeconds }))}>{playing ? <systemIcons.pause /> : <systemIcons.play />}</Button>
              <IconButton icon={systemIcons.next} label={appCopy.controls.next} disabled={!track} onClick={() => changeTrack(1)} />
              <IconButton icon={systemIcons.repeat} label={appCopy.controls.repeat} selected={repeat} disabled={!track} onClick={() => setRepeat((value) => !value)} />
            </div>
            <div className="control-side control-side-end">
              <IconButton icon={systemIcons.captions} label={appCopy.controls.captions} selected={captions} onClick={() => setCaptions((value) => !value)} />
              <IconButton icon={systemIcons.volume} label={appCopy.controls.volume} selected={muted} onClick={() => setMuted((value) => !value)} />
              <IconButton icon={systemIcons.queue} label={appCopy.controls.queue} />
            </div>
          </div>
        </footer>
      </main>
    </TooltipProvider>
  )
}

export default App
