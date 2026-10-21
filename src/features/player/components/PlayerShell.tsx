import type { MediaLibraryCategoryId, MediaLibraryRoute } from '@/features/player/model/mediaLibraryCategories'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DevAudioToolsAvailability, DevAudioToolsSlot } from '@/features/player/components/DevAudioToolsSlot'
import { PlayerSurface } from '@/features/player/components/PlayerSurface'
import { playlistScope, useAudioPlayer } from '@/features/player/hooks/useAudioPlayer'
import { usePlaylistLibraryDurations } from '@/features/player/hooks/usePlaylistDuration'
import { useLibraryArtwork } from '@/features/player/hooks/useLibraryArtwork'
import { playlistDisplayName } from '@/features/player/model/audioTrackModel'
import { formatPlaylistDurationLabel } from '@/features/player/model/playlistDuration'
import { normalizeAudioSourcePath, pendingPlaylistTrackRow } from '@/features/player/model/playlistTrackSummary'
import { useGlobalShortcuts } from '@/features/shortcuts/hooks/useGlobalShortcuts'
import type { AllSongsItem, DevAudioToolsViewModel, PlayerUiViewModel, PlaylistArtworkDemand, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'
import { readStartupPage } from '@/features/player/model/startupPageStorage'

const EMPTY_KNOWN_DURATIONS: ReadonlyMap<string, number> = new Map()

export function PlayerShell() {
  const player = useAudioPlayer()
  useGlobalShortcuts(player)
  const [isDevAudioToolsOpen, setIsDevAudioToolsOpen] = useState(false)
  const [isPlaylistOpen, setIsPlaylistOpen] = useState(() => readStartupPage() === 'media-library')
  const [libraryRoute, setLibraryRoute] = useState<MediaLibraryRoute>({ view: 'overview' })
  const [browsedScope, setBrowsedScope] = useState<string | null>(null)
  const [playlistEntryPosition, setPlaylistEntryPosition] = useState<NonNullable<PlayerUiViewModel['playlist']['entryPosition']>>({ requestId: 0, target: 'current-track' })
  const librarySources = useMemo(() => [...player.libraryFolderPlaylists, ...player.sessionPlaylists], [player.libraryFolderPlaylists, player.sessionPlaylists])
  const browsedPlaylist = librarySources.find((item) => playlistScope(item) === browsedScope)
  const isBrowsingActive = !browsedPlaylist || browsedScope === player.activePlaylistScope
  const { rows: libraryArtwork, setVisibleTrackIds: setLibraryVisibleTrackIds } = useLibraryArtwork(librarySources,
    isPlaylistOpen && libraryRoute.view === 'tracks' && !isBrowsingActive ? browsedPlaylist ?? null : null)
  const artworkDetailPath = browsedPlaylist?.sourcePath
  const handleLibraryVisibleTrackIds = useCallback((trackIds: readonly string[], keepPersistentArtwork?: boolean, showArtwork?: boolean, demand?: PlaylistArtworkDemand) => {
    if (artworkDetailPath) setLibraryVisibleTrackIds(artworkDetailPath, trackIds, keepPersistentArtwork, showArtwork, demand)
  }, [artworkDetailPath, setLibraryVisibleTrackIds])
  const ensurePlaylistSummaries = player.ensurePlaylistSummaries
  const displayScope = isBrowsingActive ? player.activePlaylistScope : browsedScope
  const selectLibraryCategory = (categoryId: MediaLibraryCategoryId) => { setIsPlaylistOpen(true); setLibraryRoute({ view: 'category', categoryId }) }
  const openLibrary = () => selectLibraryCategory('playlists')
  const openLibraryOverview = () => { setIsPlaylistOpen(true); setLibraryRoute({ view: 'overview' }) }
  const browsePlaylist = (scope: string) => {
    // Start the read-only tag pass in the same commit as the navigation, so the
    // detail page's first frame is already a loading state, never placeholder text.
    ensurePlaylistSummaries(scope)
    setPlaylistEntryPosition((previous) => ({ requestId: previous.requestId + 1, target: 'top' }))
    setBrowsedScope(scope)
    setLibraryRoute({ view: 'tracks' })
    setIsPlaylistOpen(true)
  }
  // A browsed list that is not the active one started its pass above; keep a
  // safety net for restores and late scope changes (the call is idempotent).
  useEffect(() => {
    if (!isBrowsingActive && browsedScope) ensurePlaylistSummaries(browsedScope)
  }, [browsedScope, ensurePlaylistSummaries, isBrowsingActive])
  useEffect(() => {
    if (libraryRoute.view !== 'category' || libraryRoute.categoryId !== 'songs') return
    for (const source of player.libraryFolderPlaylists) ensurePlaylistSummaries(playlistScope(source))
  }, [libraryRoute, player.libraryFolderPlaylists, ensurePlaylistSummaries])
  const handlePlaylistOpenChange = useCallback((open: boolean) => {
    setIsPlaylistOpen(open)
    if (open) {
      setPlaylistEntryPosition((previous) => ({ requestId: previous.requestId + 1, target: 'current-track' }))
      setLibraryRoute({ view: 'tracks' })
      if (!browsedPlaylist) setBrowsedScope(player.activePlaylistScope)
    }
  }, [browsedPlaylist, player.activePlaylistScope])
  const currentTrackId = player.track?.id ?? null
  const summariesByScope = player.playlistTrackSummariesByScope
  // Layering order: queue row < read-only tag summary < hydrated metadata <
  // windowed visual. The hydration pump stays authoritative for lyrics, cover
  // file paths, `hasLocalArtwork` and the exact duration.
  const rawPlaylistTracks = useMemo<PlaylistTrackItemViewModel[]>(() => {
    // `queueTracks` always describes the active scope, so its summaries come
    // from the active scope key and never from the list being browsed.
    const summaries = player.activePlaylistScope ? summariesByScope[player.activePlaylistScope] : undefined
    return player.queueTracks.map((queueTrack) => {
      const summaryRow = summaries?.[queueTrack.id]
      const metadata = player.playlistTrackMetadata[queueTrack.id]
      const windowedVisual = player.playlistTrackVisuals[queueTrack.id]
      const hydratedTrack = summaryRow || metadata || windowedVisual
        ? { ...queueTrack, ...summaryRow, ...metadata, ...windowedVisual }
        : queueTrack
      const currentTrack = player.track
      if (!currentTrack || queueTrack.id !== currentTrack.id) return hydratedTrack
      return {
        ...hydratedTrack,
        durationSeconds: currentTrack.durationSeconds,
        fileExtension: currentTrack.fileExtension,
        coverTone: currentTrack.coverTone,
        hasLocalArtwork: Boolean(currentTrack.coverFilePath || currentTrack.coverImage || currentTrack.coverImageFallback),
        audioFormat: currentTrack.audioFormat,
      }
    })
  }, [player.activePlaylistScope, player.playlistTrackMetadata, player.playlistTrackVisuals, player.queueTracks, player.track, summariesByScope])
  // Browsing another session list reuses that scope's summary rows; until they
  // land, rows keep the filename title with an explicitly unknown artist/album
  // instead of the fabricated `本地音频` / playlist-name placeholder.
  const browsedUnavailableIds = useMemo(() => isBrowsingActive ? player.unavailableTrackIds
    : new Set(browsedPlaylist?.tracks.filter((item) => !item.available).map((item) => item.id)),
  [isBrowsingActive, player.unavailableTrackIds, browsedPlaylist])
  const singleTrackSource = player.currentAudioTrack?.sourcePath
  const durationSources = useMemo<readonly { sourcePath: string; id?: string; available?: boolean }[]>(() => player.playlistDurationTracks
    ?? (singleTrackSource ? [{ sourcePath: singleTrackSource }] : []), [player.playlistDurationTracks, singleTrackSource])
  const currentDurationMs = player.currentAudioTrack?.durationMs
  const durationScope = player.playlistDurationScope
  // Known durations of the active scope, derived only from that scope's own row
  // data (tag summary < hydration metadata < windowed visual) plus the current
  // track's raw duration. Nothing here is invented: a zero duration stays
  // unknown because the presentation mapper uses zero for "not hydrated".
  const activeKnownDurations = useMemo(() => {
    const known = new Map<string, number>()
    const tracksById = new Map(rawPlaylistTracks.map((item) => [item.id, item]))
    for (const source of durationSources) {
      if (source.available === false) continue
      const duration = source.id ? tracksById.get(source.id)?.durationSeconds : undefined
      // The presentation mapper uses zero for unknown raw durations. Positive
      // hydrated values are unambiguous; genuine zero needs the raw DTO below.
      if (duration != null && Number.isFinite(duration) && duration > 0) known.set(source.sourcePath, duration * 1000)
    }
    if (singleTrackSource && currentDurationMs != null && Number.isFinite(currentDurationMs) && currentDurationMs >= 0
      && !durationSources.some((source) => source.sourcePath === singleTrackSource && source.available === false)) known.set(singleTrackSource, currentDurationMs)
    return known
  }, [durationSources, rawPlaylistTracks, singleTrackSource, currentDurationMs])
  // Known durations stay per scope and survive a scope switch. While a scope is
  // active, its rows hydrate exact durations; an inactive scope's tag summary
  // rows carry no duration by contract (`playlistTrackRowFromSummary` is always
  // 0), so the only truthful known values it can own are the ones it collected
  // while it was active. They are renamed with the scope so one scope's row data
  // can never complete another scope. `react-hooks/refs` forbids reading a ref
  // during render, so this uses React's documented "adjust state when the input
  // changes" form, which re-renders before committing.
  const libraryDurationSources = useMemo(() => librarySources.map((item) => ({
    scope: playlistScope(item), sources: item.tracks,
  })), [librarySources])
  const [knownScopeState, setKnownScopeState] = useState<Readonly<{
    scope: string
    known: ReadonlyMap<string, number>
    byScope: ReadonlyMap<string, ReadonlyMap<string, number>>
  }>>({ scope: '\u0000', known: EMPTY_KNOWN_DURATIONS, byScope: new Map() })
  if (knownScopeState.scope !== durationScope || knownScopeState.known !== activeKnownDurations) {
    // Keep every live scope (so a switch back reuses what it already learned)
    // and drop scopes of playlists that left the session.
    const liveScopes = new Set([durationScope, ...libraryDurationSources.map((item) => item.scope)])
    const byScope = new Map([...knownScopeState.byScope].filter(([key]) => liveScopes.has(key)))
    byScope.set(durationScope, activeKnownDurations)
    setKnownScopeState({ scope: durationScope, known: activeKnownDurations, byScope })
  }
  const knownDurationsByScope = knownScopeState.byScope
  const preferredDurationScopes = useMemo(() => libraryRoute.view === 'category' && libraryRoute.categoryId === 'songs'
    ? player.libraryFolderPlaylists.map(playlistScope)
    : displayScope ? [displayScope] : [],
  [libraryRoute, player.libraryFolderPlaylists, displayScope])
  const durationData = usePlaylistLibraryDurations(durationSources, durationScope, libraryDurationSources, knownDurationsByScope, preferredDurationScopes)
  const playlistDurations = durationData.totals
  const playlistDuration = playlistDurations.get(durationScope)!
  const browsedDuration = browsedPlaylist ? playlistDurations.get(playlistScope(browsedPlaylist))! : playlistDuration
  const playlistTracks = useMemo(() => {
    const descriptors = new Map(player.playlistDurationTracks?.map((item) => [item.id, item.sourcePath]))
    const durations = durationData.durationsByScope.get(player.activePlaylistScope ?? '')
    return rawPlaylistTracks.map((item) => {
      const durationMs = durations?.get(descriptors.get(item.id) ?? '')
      return (item.durationSeconds ?? 0) > 0 || durationMs == null ? item : { ...item, durationSeconds: durationMs / 1000 }
    })
  }, [rawPlaylistTracks, player.playlistDurationTracks, player.activePlaylistScope, durationData.durationsByScope])
  const browsedTracks = useMemo<PlaylistTrackItemViewModel[]>(() => {
    if (isBrowsingActive) return playlistTracks
    const summaries = browsedScope ? summariesByScope[browsedScope] : undefined
    const durations = browsedScope ? durationData.durationsByScope.get(browsedScope) : undefined
    return (browsedPlaylist?.tracks ?? []).map((item) => {
      const row = (browsedScope ? summaries?.[item.id] : undefined) ?? pendingPlaylistTrackRow(item)
      const durationMs = durations?.get(item.sourcePath)
      const artwork = libraryArtwork.get(normalizeAudioSourcePath(item.sourcePath))
      const covered = artwork ? { ...row, ...artwork } : row
      return durationMs == null ? covered : { ...covered, durationSeconds: durationMs / 1000 }
    })
  }, [isBrowsingActive, playlistTracks, browsedPlaylist, browsedScope, summariesByScope, durationData.durationsByScope, libraryArtwork])
  const allSongs = useMemo<AllSongsItem[]>(() => {
    const seen = new Set<string>()
    const rows: AllSongsItem[] = []
    const activeRows = new Map(playlistTracks.map((item) => [item.id, item]))
    for (const source of player.libraryFolderPlaylists) {
      const scope = playlistScope(source)
      const summaries = summariesByScope[scope]
      const durations = durationData.durationsByScope.get(scope)
      for (const descriptor of source.tracks) {
        const key = normalizeAudioSourcePath(descriptor.sourcePath)
        if (seen.has(key)) continue
        seen.add(key)
        const activeRow = scope === player.activePlaylistScope ? activeRows.get(descriptor.id) : undefined
        const row = activeRow ?? summaries?.[descriptor.id] ?? pendingPlaylistTrackRow(descriptor)
        const durationMs = durations?.get(descriptor.sourcePath)
        rows.push({ key, scope, trackId: descriptor.id, sourcePath: descriptor.sourcePath, available: descriptor.available,
          track: (row.durationSeconds ?? 0) > 0 || durationMs == null ? row : { ...row, durationSeconds: durationMs / 1000 } })
      }
    }
    return rows
  }, [player.libraryFolderPlaylists, player.activePlaylistScope, playlistTracks, summariesByScope, durationData.durationsByScope])
  const playlistRowsReady = !displayScope || (
    player.playlistSummaryStatusByScope[displayScope] === 'ready'
    && durationData.settledByScope.get(displayScope) === true
  )
  const allSongsRowsReady = !player.libraryRestorePending && player.libraryFolderPlaylists.every((source) => {
    const scope = playlistScope(source)
    return player.playlistSummaryStatusByScope[scope] === 'ready'
      && durationData.settledByScope.get(scope) === true
  })
  const toggleTrackFeedback = player.toggleTrackFeedback
  const handleFeedbackToggle = useCallback((feedback: Parameters<typeof toggleTrackFeedback>[1]) => {
    if (currentTrackId) toggleTrackFeedback(currentTrackId, feedback)
  }, [currentTrackId, toggleTrackFeedback])
  const handleDevAudioToolsClose = useCallback(() => setIsDevAudioToolsOpen(false), [])

  const viewModel: PlayerUiViewModel = {
    playback: {
      track: player.track,
      audioOutputInfo: player.audioOutputInfo,
      artwork: player.artwork,
      artworkPrefetchCandidate: player.artworkPrefetchCandidate,
      artworkPrefetchCandidates: player.artworkPrefetchCandidates,
      selectionActivitySequence: player.selectionActivitySequence,
      selectionVisualIntent: player.selectionVisualIntent,
      detailsPending: player.detailsPending,
      contentState: player.contentState,
      isPlaying: player.playing,
      shuffleMode: player.shuffleMode,
      repeatMode: player.repeatMode,
      isAudioBusy: player.audioBusy,
      isSelectionPending: player.selectionPending,
      isTransportBusy: player.transportBusy,
      transportTransition: player.transportTransition,
      transportSettledRequestId: player.transportSettledRequestId,
      statusText: player.statusText,
      onOpenAudio: player.openAudio,
      onPrevious: player.previous,
      onNext: player.next,
      onPrepareTrackPreview: player.prepareTrackCardPreview,
      onPrimeTrackArtwork: player.primeTrackArtwork,
      onCommitTrackPreview: player.commitTrackCardPreview,
      onDiscardTrackPreview: player.discardTrackCardPreview,
      onPlayToggle: player.transitionPlayback,
      onShuffleCycle: player.cycleShuffleMode,
      onRepeatCycle: player.cycleRepeatMode,
    },
    timeline: {
      positionSeconds: player.progress,
      durationSeconds: player.duration,
      interaction: player.timelineInteraction,
      visualClock: player.visualTimelineClock,
      onPreviewStart: player.startProgressPreview,
      onPreview: player.setProgress,
      onCommit: player.commitProgress,
      onCancelPreview: player.cancelProgressPreview,
    },
    volume: {
      valuePercent: player.volume,
      isBusy: player.volumeBusy,
      isDisabled: player.volumeDisabled,
      onChange: player.changeVolume,
    },
    queue: {
      // The queue and the playlist page must never disagree about a song, so
      // both consume the same merged rows (tag summary < hydration metadata <
      // windowed visual) instead of the raw filename-only `queueTracks`.
      tracks: playlistTracks,
      unavailableTrackIds: player.unavailableTrackIds,
      playlistName: player.playlistName,
      isOpen: player.queueOpen,
      onToggle: player.toggleQueue,
      onTrackSelect: player.audioBusy || player.transportBusy || player.timelineInteraction === 'seeking'
        ? undefined
        : player.selectQueueTrack,
    },
    playlist: {
      entryPosition: playlistEntryPosition,
      playbackDockTrack: playlistTracks.find((item) => item.id === currentTrackId),
      isOpen: isPlaylistOpen,
      onOpenChange: handlePlaylistOpenChange,
      library: {
        isOpen: libraryRoute.view !== 'tracks',
        route: libraryRoute,
        onOpenOverview: openLibraryOverview,
        onSelectCategory: selectLibraryCategory,
        items: librarySources.map((item) => {
          const first = item.tracks.find((descriptor) => descriptor.available)
          const scope = playlistScope(item)
          const firstRow: PlaylistTrackItemViewModel | undefined = first ? (scope === player.activePlaylistScope ? playlistTracks.find((row) => row.id === first.id) : undefined)
            ?? summariesByScope[scope]?.[first.id] ?? pendingPlaylistTrackRow(first) : undefined
          const artwork = first ? libraryArtwork.get(normalizeAudioSourcePath(first.sourcePath)) : undefined
          return {
          scope, name: playlistDisplayName(item), trackCount: item.tracks.length, sourceKind: item.sourceKind,
          coverSourcePath: scope === player.activePlaylistScope && firstRow?.coverThumbnail ? undefined : first?.sourcePath,
          coverTrack: firstRow ? { ...firstRow, ...artwork, coverThumbnail: firstRow.coverThumbnail ?? artwork?.coverThumbnail } : undefined,
          totalClock: formatPlaylistDurationLabel(
            playlistDurations.get(playlistScope(item))!,
            item.tracks.length,
          ),
        }}),
        allSongs,
        allSongsMetadataStatus: allSongsRowsReady ? 'ready' : 'loading',
        currentScope: browsedScope,
        activeScope: player.activePlaylistScope,
        onOpen: openLibrary,
        onSelect: browsePlaylist,
        onPlay: (scope) => {
          const item = librarySources.find((entry) => playlistScope(entry) === scope)
          const track = item?.tracks.find((entry) => entry.available)
          if (track) void player.selectSessionPlaylistTrack(scope, track.id)
        },
        onPlaySong: (scope, trackId) => { void player.selectSessionPlaylistTrack(scope, trackId) },
        onSelectFolders: () => { void player.selectFolders() },
        onImportPlaylist: () => { void player.importPlaylist() },
        isImportPending: player.libraryImportPending || player.libraryStatus === 'clearing',
        isPlaylistRestorePending: player.playlistRestorePending,
        onCreatePlaylist: player.createPlaylist,
      },
      isOpenAudioDisabled: player.audioBusy
        || player.transportBusy
        || player.selectionPending
        || player.timelineInteraction === 'seeking',
      onOpenAudio: player.openAudio,
      tracks: browsedTracks,
      unavailableTrackIds: browsedUnavailableIds,
      playlistName: browsedPlaylist ? playlistDisplayName(browsedPlaylist) : player.playlistName,
      metadataStatus: playlistRowsReady ? 'ready' : 'loading',
      totalDurationSeconds: browsedDuration.totalSeconds,
      totalDurationStatus: browsedDuration.status,
      totalDurationDetail: browsedDuration.detail,
      currentTrackId: player.track?.id ?? null,
      shuffleMode: player.shuffleMode,
      onShuffleCycle: player.cycleShuffleMode,
      onTrackSelect: player.audioBusy || player.transportBusy || player.timelineInteraction === 'seeking'
        ? undefined
        : isBrowsingActive ? player.selectQueueTrack : (trackId) => { if (browsedScope) void player.selectSessionPlaylistTrack(browsedScope, trackId) },
      onVisibleTrackIdsChange: isBrowsingActive ? player.setVisiblePlaylistTrackIds : handleLibraryVisibleTrackIds,
    },
    feedback: {
      value: player.currentFeedback,
      valuesByTrackId: player.feedbackByTrackId,
      onToggle: handleFeedbackToggle,
    },
  }

  const devAudioToolsViewModel: DevAudioToolsViewModel = {
    fileName: player.currentAudioTrack?.fileName ?? null,
    hasTrack: Boolean(player.audioState?.currentTrackId),
    phase: player.audioState?.phase ?? 'idle',
    title: player.track?.title ?? null,
    isPlaying: player.playing,
    isAudioBusy: player.audioBusy || player.selectionPending || player.timelineInteraction === 'seeking',
    isTransportBusy: player.transportBusy,
    statusText: player.statusText,
    positionSeconds: player.progress,
    durationSeconds: player.duration,
    onOpen: player.openAudio,
    onOpenAndPlay: player.openAudioAndPlay,
    onPlayToggle: player.togglePlayback,
    onPreview: player.setProgress,
    onCommit: player.commitProgress,
    onRefresh: player.refreshAudioState,
    onStop: player.stopAudioPlayback,
  }

  return (
    <DevAudioToolsAvailability>
      {(isAvailable) => (
        <PlayerSurface
          viewModel={viewModel}
          librarySettings={{
            selectedFolderCount: player.selectedFolderPaths.length,
            status: player.libraryStatus,
            errors: player.libraryFolderErrors,
            onClear: player.clearSelectedLibraryFolders,
          }}
          devAudioTools={isAvailable ? {
            isOpen: isDevAudioToolsOpen,
            onOpenChange: setIsDevAudioToolsOpen,
            content: (
              <DevAudioToolsSlot
                viewModel={devAudioToolsViewModel}
                isOpen={isDevAudioToolsOpen}
                onClose={handleDevAudioToolsClose}
              />
            ),
          } : undefined}
        />
      )}
    </DevAudioToolsAvailability>
  )
}

export default PlayerShell
