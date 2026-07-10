import './App.css'
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  ActivityIcon,
  ListMusicIcon,
  Music2Icon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { appCopy } from '@/copy'
import { initialPlayerState } from '@/playerState'
import type { PlayerState, Track } from '@/playerTypes'

type Direction = -1 | 1
type ProgressStyle = CSSProperties & { '--progress-percent': string }
type SpectrumBarStyle = CSSProperties & { '--bar-level': string }

const progressTickMs = 1000

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function clampProgress(progressSeconds: number, durationSeconds: number) {
  if (durationSeconds <= 0) {
    return 0
  }

  return Math.min(Math.max(0, progressSeconds), durationSeconds)
}

function resolveCurrentTrack(tracks: Track[], currentTrackId: string | null) {
  return (
    tracks.find((track) => track.id === currentTrackId) ?? tracks[0] ?? null
  )
}

function getSteppedTrackId(
  tracks: Track[],
  currentTrackId: string | null,
  direction: Direction,
) {
  if (tracks.length === 0) {
    return null
  }

  if (tracks.length === 1) {
    return tracks[0].id
  }

  const currentIndex = tracks.findIndex((track) => track.id === currentTrackId)

  if (currentIndex === -1) {
    return tracks[0].id
  }

  const nextIndex = (currentIndex + direction + tracks.length) % tracks.length

  return tracks[nextIndex].id
}

function App() {
  const [playerState, setPlayerState] =
    useState<PlayerState>(initialPlayerState)
  const currentTrack = useMemo(
    () => resolveCurrentTrack(playerState.tracks, playerState.currentTrackId),
    [playerState.currentTrackId, playerState.tracks],
  )
  const hasTracks = playerState.tracks.length > 0
  const isPlaying = playerState.playbackStatus === 'playing'
  const durationSeconds = currentTrack?.durationSeconds ?? 0
  const progressSeconds = clampProgress(
    playerState.progressSeconds,
    durationSeconds,
  )
  const progressPercent =
    durationSeconds > 0 ? (progressSeconds / durationSeconds) * 100 : 0
  const progressStyle: ProgressStyle = {
    '--progress-percent': `${progressPercent}%`,
  }

  useEffect(() => {
    if (!isPlaying || !currentTrack) {
      return
    }

    const intervalId = window.setInterval(() => {
      setPlayerState((previousState) => {
        const activeTrack = resolveCurrentTrack(
          previousState.tracks,
          previousState.currentTrackId,
        )
        const activeDuration = activeTrack?.durationSeconds ?? 0

        if (!activeTrack || activeDuration <= 0) {
          return {
            ...previousState,
            playbackStatus: 'paused',
            progressSeconds: 0,
          }
        }

        const nextProgress = clampProgress(
          previousState.progressSeconds + 1,
          activeDuration,
        )

        return {
          ...previousState,
          playbackStatus:
            nextProgress >= activeDuration
              ? 'paused'
              : previousState.playbackStatus,
          progressSeconds: nextProgress,
        }
      })
    }, progressTickMs)

    return () => window.clearInterval(intervalId)
  }, [currentTrack, isPlaying])

  function handleTogglePlayback() {
    setPlayerState((previousState) => {
      const activeTrack = resolveCurrentTrack(
        previousState.tracks,
        previousState.currentTrackId,
      )
      const activeDuration = activeTrack?.durationSeconds ?? 0

      if (!activeTrack) {
        return {
          ...previousState,
          playbackStatus: 'paused',
          progressSeconds: 0,
        }
      }

      const nextStatus =
        previousState.playbackStatus === 'playing' ? 'paused' : 'playing'
      const shouldRestart =
        nextStatus === 'playing' &&
        activeDuration > 0 &&
        previousState.progressSeconds >= activeDuration

      return {
        ...previousState,
        currentTrackId: activeTrack.id,
        playbackStatus: nextStatus,
        progressSeconds: shouldRestart ? 0 : previousState.progressSeconds,
      }
    })
  }

  function handleTrackStep(direction: Direction) {
    setPlayerState((previousState) => {
      const nextTrackId = getSteppedTrackId(
        previousState.tracks,
        previousState.currentTrackId,
        direction,
      )

      return {
        ...previousState,
        currentTrackId: nextTrackId,
        playbackStatus: nextTrackId ? previousState.playbackStatus : 'paused',
        progressSeconds: 0,
      }
    })
  }

  function handleTrackSelect(trackId: string) {
    setPlayerState((previousState) => ({
      ...previousState,
      currentTrackId: trackId,
      progressSeconds:
        previousState.currentTrackId === trackId
          ? previousState.progressSeconds
          : 0,
    }))
  }

  function updateProgress(nextProgress: number) {
    setPlayerState((previousState) => {
      const activeTrack = resolveCurrentTrack(
        previousState.tracks,
        previousState.currentTrackId,
      )

      return {
        ...previousState,
        progressSeconds: clampProgress(
          nextProgress,
          activeTrack?.durationSeconds ?? 0,
        ),
      }
    })
  }

  function handleProgressChange(event: ChangeEvent<HTMLInputElement>) {
    updateProgress(Number(event.currentTarget.value))
  }

  function handleProgressInput(event: FormEvent<HTMLInputElement>) {
    updateProgress(Number(event.currentTarget.value))
  }

  function handleProgressPointerDown(
    event: ReactPointerEvent<HTMLInputElement>,
  ) {
    event.currentTarget.setPointerCapture(event.pointerId)
    updateProgressFromPointer(event)
  }

  function handleProgressPointerMove(
    event: ReactPointerEvent<HTMLInputElement>,
  ) {
    if (event.buttons !== 1) {
      return
    }

    updateProgressFromPointer(event)
  }

  function updateProgressFromPointer(event: ReactPointerEvent<HTMLInputElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const duration = Number(event.currentTarget.max)

    if (!Number.isFinite(duration) || duration <= 0 || bounds.width <= 0) {
      return
    }

    const ratio = (event.clientX - bounds.left) / bounds.width
    const nextProgress = Math.round(duration * Math.min(Math.max(ratio, 0), 1))

    updateProgress(nextProgress)
  }

  return (
    <main className="player-shell" aria-labelledby="app-title">
      <header className="player-header">
        <div>
          <Badge variant="outline">{appCopy.productName}</Badge>
          <h1 id="app-title">{appCopy.appTitle}</h1>
          <p>{appCopy.appIntro}</p>
        </div>
        <div className="status-strip" aria-label={appCopy.status.playback}>
          <Badge variant={isPlaying ? 'default' : 'secondary'}>
            {appCopy.playbackStatus[playerState.playbackStatus]}
          </Badge>
          <span>
            {appCopy.status.trackCount}: {playerState.tracks.length}
          </span>
          <span>
            {appCopy.status.spectrumCount}: {playerState.spectrumBars.length}
          </span>
        </div>
      </header>

      <section className="player-grid" aria-label={appCopy.shellLabel}>
        <Card className="now-playing-card">
          <CardHeader>
            <CardDescription>{appCopy.nowPlaying.eyebrow}</CardDescription>
            <CardTitle>
              {currentTrack?.title ?? appCopy.nowPlaying.emptyTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="now-playing-content">
            {currentTrack ? (
              <>
                <div className="cover-art" aria-hidden="true">
                  <Music2Icon />
                  <span>{appCopy.productName}</span>
                </div>
                <div className="track-details" aria-live="polite">
                  <div>
                    <p className="current-artist">{currentTrack.artist}</p>
                    <h2>{currentTrack.title}</h2>
                  </div>
                  <dl className="track-meta">
                    <div>
                      <dt>{appCopy.nowPlaying.artistLabel}</dt>
                      <dd>{currentTrack.artist}</dd>
                    </div>
                    <div>
                      <dt>{appCopy.nowPlaying.albumLabel}</dt>
                      <dd>{currentTrack.album}</dd>
                    </div>
                    <div>
                      <dt>{appCopy.nowPlaying.durationLabel}</dt>
                      <dd>{formatDuration(currentTrack.durationSeconds)}</dd>
                    </div>
                  </dl>
                </div>
              </>
            ) : (
              <div className="empty-state" role="status">
                <ListMusicIcon aria-hidden="true" />
                <h2>{appCopy.nowPlaying.emptyTitle}</h2>
                <p>{appCopy.nowPlaying.emptyDescription}</p>
              </div>
            )}
          </CardContent>

          <CardContent className="playback-panel">
            <div className="progress-panel" style={progressStyle}>
              <div className="progress-labels">
                <span>{appCopy.progress.elapsed}</span>
                <span>{appCopy.progress.total}</span>
              </div>
              <input
                aria-label={appCopy.progress.label}
                className="progress-range"
                disabled={!currentTrack || durationSeconds <= 0}
                max={Math.max(durationSeconds, 0)}
                min="0"
                onChange={handleProgressChange}
                onInput={handleProgressInput}
                onPointerDown={handleProgressPointerDown}
                onPointerMove={handleProgressPointerMove}
                step="1"
                type="range"
                value={progressSeconds}
              />
              <div className="progress-times">
                <span>{formatDuration(progressSeconds)}</span>
                <span>{formatDuration(durationSeconds)}</span>
              </div>
            </div>

            <section className="spectrum-panel" aria-labelledby="spectrum-title">
              <div className="spectrum-heading">
                <ActivityIcon aria-hidden="true" />
                <div>
                  <h2 id="spectrum-title">{appCopy.spectrum.title}</h2>
                  <p>{appCopy.spectrum.description}</p>
                </div>
              </div>
              {playerState.spectrumBars.length > 0 ? (
                <div
                  className="spectrum-bars"
                  data-status={playerState.playbackStatus}
                  aria-hidden="true"
                >
                  {playerState.spectrumBars.map((bar) => {
                    const barStyle: SpectrumBarStyle = {
                      '--bar-level': `${
                        Math.max(0.08, Math.min(1, bar.level)) * 100
                      }%`,
                    }

                    return (
                      <span
                        className="spectrum-bar"
                        key={bar.id}
                        style={barStyle}
                      />
                    )
                  })}
                </div>
              ) : (
                <p className="spectrum-empty">{appCopy.spectrum.empty}</p>
              )}
            </section>
          </CardContent>

          <CardFooter className="player-controls">
            <div className="transport-controls">
              <Button
                aria-label={appCopy.controls.previous}
                disabled={!hasTracks}
                onClick={() => handleTrackStep(-1)}
                size="icon-lg"
                type="button"
                variant="outline"
              >
                <SkipBackIcon />
              </Button>
              <Button
                aria-pressed={isPlaying}
                disabled={!hasTracks}
                onClick={handleTogglePlayback}
                size="lg"
                type="button"
              >
                {isPlaying ? (
                  <PauseIcon data-icon="inline-start" />
                ) : (
                  <PlayIcon data-icon="inline-start" />
                )}
                {isPlaying ? appCopy.controls.pause : appCopy.controls.play}
              </Button>
              <Button
                aria-label={appCopy.controls.next}
                disabled={!hasTracks}
                onClick={() => handleTrackStep(1)}
                size="icon-lg"
                type="button"
                variant="outline"
              >
                <SkipForwardIcon />
              </Button>
            </div>
          </CardFooter>
        </Card>

        <Card className="queue-card">
          <CardHeader>
            <CardTitle>{appCopy.queue.title}</CardTitle>
            <CardDescription>{appCopy.queue.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {playerState.tracks.length > 0 ? (
              <ul className="track-list">
                {playerState.tracks.map((track, index) => {
                  const isCurrent = track.id === currentTrack?.id

                  return (
                    <li key={track.id}>
                      <button
                        aria-current={isCurrent ? 'true' : undefined}
                        className="track-row"
                        data-current={isCurrent}
                        onClick={() => handleTrackSelect(track.id)}
                        type="button"
                      >
                        <span className="track-number">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="track-copy">
                          <span className="track-title">{track.title}</span>
                          <span className="track-subtitle">
                            {track.artist} · {track.album}
                          </span>
                        </span>
                        <span className="track-duration">
                          {formatDuration(track.durationSeconds)}
                        </span>
                        {isCurrent ? (
                          <Badge variant="secondary">
                            {appCopy.queue.current}
                          </Badge>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="empty-state empty-state-compact" role="status">
                <ListMusicIcon aria-hidden="true" />
                <h2>{appCopy.queue.emptyTitle}</h2>
                <p>{appCopy.queue.emptyDescription}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

export default App
