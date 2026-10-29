import type { MediaLibraryCategoryId, MediaLibraryRoute } from '@/features/player/model/mediaLibraryCategories'
import type { ArtistLocation } from '@/features/player/model/artistLibrary'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DevAudioToolsAvailability, DevAudioToolsSlot } from '@/features/player/components/DevAudioToolsSlot'
import { PlayerSurface } from '@/features/player/components/PlayerSurface'
import { playlistScope, useAudioPlayer } from '@/features/player/hooks/useAudioPlayer'
import { usePlaylistLibraryDurations } from '@/features/player/hooks/usePlaylistDuration'
import { useLibraryArtwork } from '@/features/player/hooks/useLibraryArtwork'
import { playlistDisplayName } from '@/features/player/model/audioTrackModel'
import { formatPlaylistDurationLabel } from '@/features/player/model/playlistDuration'
import { normalizeAudioSourcePath, pendingPlaylistTrackRow } from '@/features/player/model/playlistTrackSummary'
import { readOnlyArtworkFallbackPaths, withReadOnlyArtworkFallback, type ReadOnlyArtworkRow } from '@/features/player/model/playlistArtworkFallback'
import { useGlobalShortcuts } from '@/features/shortcuts/hooks/useGlobalShortcuts'
import type { AllSongsItem, DevAudioToolsViewModel, PlayerUiViewModel, PlaylistArtworkDemand, PlaylistTrackItemViewModel, PlaylistAddRequest, PlaylistAddSnapshot } from '@/features/player/model/playerUiViewModel'
import { playlistArtworkKey } from '@/features/player/model/playlistArtworkStore'
import { readStartupPage } from '@/features/player/model/startupPageStorage'
import { readPlaybackSession } from '@/features/player/model/playbackSessionStorage'
import { playbackQueueOrigin, type PlaybackQueueOrigin } from '@/features/player/model/playbackQueue'
import { sharePlaylistTrackRows } from '@/features/player/model/playlistTrackRows'
import { applyManualSongOrder } from '@/features/player/model/manualSongOrderStorage'
import { playlistArtworkRevision } from '@/features/player/model/playlistArtworkRevision'
import { readPinnedCategoryIds, writePinnedCategoryIds } from '@/features/player/model/librarySidebarPreferences'
import { folderSelectionPath, isDirectorySelected, isRootSelectionActive } from '@/features/player/model/folderSelection'

const EMPTY_KNOWN_DURATIONS: ReadonlyMap<string, number> = new Map()
const EMPTY_FALLBACK_SOURCE_PATHS: ReadonlySet<string> = new Set()

// Merge layers can create new objects for every row even though only one cover
// changed. Preserve the final values by identity so PlaylistCard.memo can skip
// the other songs. State adjustment keeps this cache local to React renders.
function useStablePlaylistTrackRows(input: PlaylistTrackItemViewModel[]): PlaylistTrackItemViewModel[] {
  const [snapshot, setSnapshot] = useState(() => ({ input, rows: input }))
  if (snapshot.input !== input) {
    const rows = sharePlaylistTrackRows(snapshot.rows, input)
    setSnapshot({ input, rows })
    return rows
  }
  return snapshot.rows
}

export function PlayerShell() {
  const [pinnedCategoryIds, setPinnedCategoryIds] = useState(readPinnedCategoryIds)
  const toggleCategoryPin = useCallback((id: MediaLibraryCategoryId) => {
    setPinnedCategoryIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  }, [])
  const foldersPinnedInSidebar = pinnedCategoryIds.includes('folders')
  const toggleFoldersPin = useCallback(() => toggleCategoryPin('folders'), [toggleCategoryPin])
  useEffect(() => { writePinnedCategoryIds(pinnedCategoryIds) }, [pinnedCategoryIds])
  const [isPlaylistOpen, setIsPlaylistOpen] = useState(() => readStartupPage() === 'media-library')
  // Restore only the saved playback source as the player's first return page.
  // Later navigation keeps its own destination throughout this session.
  const [libraryRoute, setLibraryRoute] = useState<MediaLibraryRoute>(() => {
    if (readStartupPage() === 'media-library') return { view: 'overview' }
    const saved = readPlaybackSession()
    return playbackQueueOrigin(saved?.playlist.customPlaylist)?.kind === 'all-songs'
      ? { view: 'category', categoryId: 'songs' } : { view: 'tracks' }
  })
  const [flatFolderLocation, setFlatFolderLocation] = useState<{ rootPath: string; directoryPath: string } | null>(null)
  const [albumLocation, setAlbumLocation] = useState<string | null>(null)
  const [artistLocation, setArtistLocation] = useState<ArtistLocation>(null)
  const [albumArtistLocation, setAlbumArtistLocation] = useState<ArtistLocation>(null)
  const [composerLocation, setComposerLocation] = useState<ArtistLocation>(null)
  const [folderLocation, setFolderLocation] = useState<{ rootPath: string; directoryPath: string } | null>(null)
  const [playlistArtworkSettled, setPlaylistArtworkSettled] = useState(false)
  // While the player is in front, prepare its source list for the cover's
  // return path. The existing artwork lane keeps this work optional and bounded.
  const player = useAudioPlayer(isPlaylistOpen && libraryRoute.view === 'tracks', playlistArtworkSettled, !isPlaylistOpen)
  const committedFolderSettings = player.folderSelection.committed
  const [locationSettings, setLocationSettings] = useState(committedFolderSettings)
  if (locationSettings !== committedFolderSettings) {
    setLocationSettings(committedFolderSettings)
    if (committedFolderSettings) setFolderLocation(previous => {
      if (!previous) return previous
      const root = committedFolderSettings.roots.find(item => folderSelectionPath(item.path) === folderSelectionPath(previous.rootPath))
      if (!root || !isRootSelectionActive(root)) return null
      const base = folderSelectionPath(root.path)
      const current = folderSelectionPath(previous.directoryPath)
      if (current !== base && !current.startsWith(`${base}/`)) return null
      let relative = current === base ? '' : current.slice(base.length + 1)
      let directoryPath = previous.directoryPath.replace(/\\/g, '/').replace(/\/+$/, '')
      const visible = () => isDirectorySelected(root, relative) || root.directoryRules.some(rule => rule.selected
        && (!relative || folderSelectionPath(rule.relativePath).startsWith(`${relative}/`)))
      while (relative && !visible()) {
        relative = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : ''
        directoryPath = directoryPath.slice(0, directoryPath.lastIndexOf('/'))
      }
      if (folderSelectionPath(directoryPath) === current) return previous
      return { ...previous, directoryPath: relative ? directoryPath : root.path }
    })
  }
  useGlobalShortcuts(player)
  const [isDevAudioToolsOpen, setIsDevAudioToolsOpen] = useState(false)
  const [selectedBrowsedScope, setBrowsedScope] = useState<string | null>(null)
  const [playlistEntryPosition, setPlaylistEntryPosition] = useState<NonNullable<PlayerUiViewModel['playlist']['entryPosition']>>({ requestId: 0, target: 'current-track' })
  const librarySources = useMemo(() => [...player.libraryFolderPlaylists, ...player.sessionPlaylists], [player.libraryFolderPlaylists, player.sessionPlaylists])
  const requestedBrowsedScope = selectedBrowsedScope ?? player.playbackSourceScope
  const browsedPlaylist = librarySources.find((item) => playlistScope(item) === requestedBrowsedScope)
  const browsedScope = browsedPlaylist ? requestedBrowsedScope : null
  // A registered folder detail always consumes the selection projection, even
  // when an older direct-folder playback snapshot has the same scope.
  const missingLibrarySource = !browsedPlaylist && (selectedBrowsedScope !== null
    || (requestedBrowsedScope !== null && player.isLibraryFolderScope(requestedBrowsedScope)))
  const isBrowsingActive = (!browsedPlaylist && !missingLibrarySource)
    || (browsedPlaylist?.sourceKind !== 'folder' && browsedScope !== null && browsedScope === player.activePlaylistScope)
  const playbackSourcePlaylist = librarySources.find((item) => playlistScope(item) === player.playbackSourceScope)
  const warmSource = !isPlaylistOpen && player.startupRestoreReady && player.playbackQueueKind !== 'all-songs'
    && player.playbackSourceScope !== player.activePlaylistScope ? playbackSourcePlaylist ?? null : null
  const { rows: libraryArtwork, artworkSource: libraryArtworkSource, setVisibleTrackIds: setLibraryVisibleTrackIds, retainSourcePaths: retainLibrarySourcePaths } = useLibraryArtwork(librarySources,
    isPlaylistOpen && libraryRoute.view === 'tracks' && !isBrowsingActive ? browsedPlaylist ?? null : warmSource,
    isPlaylistOpen || Boolean(warmSource), warmSource ? player.track?.id : undefined)
  const artworkDetailPath = browsedPlaylist?.sourcePath
  const handleLibraryVisibleTrackIds = useCallback((trackIds: readonly string[], keepPersistentArtwork?: boolean, showArtwork?: boolean, demand?: PlaylistArtworkDemand) => {
    if (artworkDetailPath) setLibraryVisibleTrackIds(artworkDetailPath, trackIds, keepPersistentArtwork, showArtwork, demand)
  }, [artworkDetailPath, setLibraryVisibleTrackIds])
  const ensurePlaylistSummaries = player.ensurePlaylistSummaries
  const displayScope = isBrowsingActive ? player.activePlaylistScope : browsedScope
  const selectLibraryCategory = (categoryId: MediaLibraryCategoryId) => {
    setPlaylistArtworkSettled(false)
    setIsPlaylistOpen(true)
    setLibraryRoute({ view: 'category', categoryId })
    if (categoryId === 'folders') setFolderLocation(null)
    if (categoryId === 'folder') setFlatFolderLocation(null)
    if (categoryId === 'album') setAlbumLocation(null)
    if (categoryId === 'artist') setArtistLocation(null)
    if (categoryId === 'album-artist') setAlbumArtistLocation(null)
    if (categoryId === 'composer') setComposerLocation(null)
    if (categoryId === 'songs') setPlaylistEntryPosition((previous) => ({ requestId: previous.requestId + 1, target: 'top' }))
  }
  const openLibrary = () => selectLibraryCategory('playlists')
  const openLibraryOverview = () => { setPlaylistArtworkSettled(false); setIsPlaylistOpen(true); setLibraryRoute({ view: 'overview' }) }
  const browsePlaylist = (scope: string) => {
    setPlaylistArtworkSettled(false)
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
    if (libraryRoute.view !== 'category' || !['songs', 'folders', 'folder', 'album', 'artist', 'album-artist', 'composer'].includes(libraryRoute.categoryId)) return
    for (const source of player.libraryFolderPlaylists) ensurePlaylistSummaries(playlistScope(source))
  }, [libraryRoute, player.libraryFolderPlaylists, ensurePlaylistSummaries])
  const handlePlaylistOpenChange = useCallback((open: boolean) => {
    setPlaylistArtworkSettled(false)
    setIsPlaylistOpen(open)
    if (open && !isPlaylistOpen && player.track) {
      setPlaylistEntryPosition((previous) => ({ requestId: previous.requestId + 1, target: 'current-track' }))
      if (player.playbackQueueKind === 'all-songs') {
        if (!(libraryRoute.view === 'category' && ['folders', 'folder', 'album', 'artist', 'album-artist', 'composer'].includes(libraryRoute.categoryId))) setLibraryRoute({ view: 'category', categoryId: 'songs' })
        setBrowsedScope(null)
      } else {
        setLibraryRoute({ view: 'tracks' })
        setBrowsedScope(librarySources.some((source) => playlistScope(source) === player.playbackSourceScope)
          ? player.playbackSourceScope : null)
      }
    }
  }, [isPlaylistOpen, player.track, player.playbackQueueKind, player.playbackSourceScope, librarySources, libraryRoute])
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
  const preferredDurationScopes = useMemo(() => libraryRoute.view === 'category' && ['songs', 'folders', 'folder', 'album', 'artist', 'album-artist', 'composer'].includes(libraryRoute.categoryId)
    ? player.libraryFolderPlaylists.map(playlistScope)
    : displayScope ? [displayScope] : [],
  [libraryRoute, player.libraryFolderPlaylists, displayScope])
  const durationData = usePlaylistLibraryDurations(durationSources, durationScope, libraryDurationSources, knownDurationsByScope, preferredDurationScopes)
  const playlistDurations = durationData.totals
  const playlistDuration = playlistDurations.get(durationScope)!
  const browsedDuration = browsedPlaylist ? playlistDurations.get(playlistScope(browsedPlaylist))!
    : missingLibrarySource ? { status: 'ready' as const, totalSeconds: 0, detail: undefined } : playlistDuration
  // The queue and the playlist page must agree about a song, so the read-only
  // library artwork is layered onto the shared active rows. It only fills what
  // the active metadata/visual lanes do not know yet: after a cross-source
  // selection the newly active scope has to re-read its own artwork, and the
  // browsed list's real covers bridge that gap instead of dropping to empty.
  const playlistPresentation = useMemo(() => {
    const descriptors = new Map(player.playlistDurationTracks?.map((item) => [item.id, item]))
    const durations = durationData.durationsByScope.get(player.activePlaylistScope ?? '')
    const sourcePathById = new Map<string, string>()
    const timedTracks = rawPlaylistTracks.map((item) => {
      const descriptor = descriptors.get(item.id)
      if (descriptor) sourcePathById.set(item.id, normalizeAudioSourcePath(descriptor.sourcePath))
      const durationMs = durations?.get(descriptor?.sourcePath ?? '')
      return (item.durationSeconds ?? 0) > 0 || durationMs == null ? item : { ...item, durationSeconds: durationMs / 1000 }
    })
    const fallbackSourcePaths = readOnlyArtworkFallbackPaths(timedTracks, sourcePathById, libraryArtwork)
    const tracks = timedTracks.map((row) => {
      const sourcePath = sourcePathById.get(row.id)
      return withReadOnlyArtworkFallback(row, sourcePath ? libraryArtwork.get(sourcePath) : undefined)
    })
    return { tracks, fallbackSourcePaths }
  }, [rawPlaylistTracks, player.playlistDurationTracks, player.activePlaylistScope, durationData.durationsByScope, libraryArtwork])
  const playlistTracks = useStablePlaylistTrackRows(playlistPresentation.tracks)
  const libraryFallbackSourcePaths = playlistPresentation.fallbackSourcePaths
  const isSongsCategoryOpen = isPlaylistOpen && libraryRoute.view === 'category' && ['songs', 'folders', 'folder', 'album', 'artist', 'album-artist', 'composer'].includes(libraryRoute.categoryId)
  const browsedTrackRows = useMemo<PlaylistTrackItemViewModel[]>(() => {
    if (isBrowsingActive) return playlistTracks
    const summaries = browsedScope ? summariesByScope[browsedScope] : undefined
    const durations = browsedScope ? durationData.durationsByScope.get(browsedScope) : undefined
    const activeRows = new Map(playlistTracks.map((item) => [item.id, item]))
    return (browsedPlaylist?.tracks ?? []).map((item) => {
      const row = activeRows.get(item.id) ?? (browsedScope ? summaries?.[item.id] : undefined) ?? pendingPlaylistTrackRow(item)
      const durationMs = durations?.get(item.sourcePath)
      const artwork = libraryArtwork.get(normalizeAudioSourcePath(item.sourcePath))
      const covered = withReadOnlyArtworkFallback(row, artwork)
      return durationMs == null ? covered : { ...covered, durationSeconds: durationMs / 1000 }
    })
  }, [isBrowsingActive, playlistTracks, browsedPlaylist, browsedScope, summariesByScope, durationData.durationsByScope, libraryArtwork])
  const browsedTracks = useStablePlaylistTrackRows(browsedTrackRows)
  const selectPlaybackQueueTrack = player.selectPlaybackQueueTrack
  const selectQueueTrack = player.selectQueueTrack
  const handlePlaylistTrackSelect = useCallback((trackId: string, orderedTrackIds?: readonly string[]) => {
    if (browsedPlaylist && browsedScope) void selectPlaybackQueueTrack({ kind: 'playlist', sourceScope: browsedScope,
      entries: (orderedTrackIds ?? browsedPlaylist.tracks.map(item => item.id)).map(id => ({ scope: browsedScope, trackId: id })) }, trackId)
    else if (isBrowsingActive) selectQueueTrack(trackId)
  }, [browsedPlaylist, browsedScope, isBrowsingActive, selectPlaybackQueueTrack, selectQueueTrack])
  // Other library routes still expose song descriptors to consumers such as
  // custom playlist creation. Build this list only when folder sources change;
  // summary, duration and artwork updates belong to the visible Songs route.
  const allSongDescriptors = useMemo<AllSongsItem[]>(() => {
    const seen = new Set<string>()
    const rows: AllSongsItem[] = []
    for (const source of player.libraryFolderPlaylists) {
      const scope = playlistScope(source)
      const artworkRevision = playlistArtworkRevision(source)
      for (const descriptor of source.tracks) {
        const key = normalizeAudioSourcePath(descriptor.sourcePath)
        if (seen.has(key)) continue
        seen.add(key)
        rows.push({ key, scope, trackId: descriptor.id, sourcePath: descriptor.sourcePath, artworkRevision,
          available: descriptor.available, track: pendingPlaylistTrackRow(descriptor) })
      }
    }
    return rows
  }, [player.libraryFolderPlaylists])
  const allSongsActiveRows = isSongsCategoryOpen ? playlistTracks : null
  const allSongsDurations = isSongsCategoryOpen ? durationData.durationsByScope : null
  // The aggregated rows deliberately carry no artwork. `libraryArtwork` is a Map
  // that the read-only cache rebuilds on every thumbnail it publishes, so merging
  // it here gave the whole library a new row array per arriving cover, which in
  // turn re-ran the quick-index sort, the search filter and the observer setup.
  // Covers reach the aggregated cards through the artwork stores they already
  // subscribe to (`PlaylistCard`'s `artworkSource` / `fallbackArtworkSource`,
  // layered exactly as `withReadOnlyArtworkFallback` did), so a cover update no
  // longer changes any row identity.
  const allSongsRows = useMemo<AllSongsItem[]>(() => {
    if (!isSongsCategoryOpen) return allSongDescriptors
    const rows: AllSongsItem[] = []
    const activeRows = new Map(allSongsActiveRows?.map((item) => [item.id, item]))
    for (const item of allSongDescriptors) {
      const { scope, trackId, sourcePath } = item
      const activeRow = allSongsActiveRows ? activeRows.get(trackId) : undefined
      const sourceRow = summariesByScope[scope]?.[trackId]
      const activeRowReady = player.playlistTrackMetadata[trackId]
        || summariesByScope[player.activePlaylistScope ?? '']?.[trackId]
      const displayRow = activeRow && activeRowReady ? activeRow : sourceRow ?? activeRow ?? item.track
      // Hydration owns presentation, while the tag lane owns grouping identity.
      const row = sourceRow ? { ...displayRow, libraryAlbumName: sourceRow.libraryAlbumName, libraryArtistName: sourceRow.libraryArtistName, libraryComposerName: sourceRow.libraryComposerName, libraryYear: sourceRow.libraryYear, albumArtist: sourceRow.albumArtist } : displayRow
      const durationMs = allSongsDurations?.get(scope)?.get(sourcePath)
      rows.push({ ...item, track: (row.durationSeconds ?? 0) > 0 || durationMs == null ? row : { ...row, durationSeconds: durationMs / 1000 } })
    }
    return rows
  }, [isSongsCategoryOpen, allSongDescriptors, allSongsActiveRows, allSongsDurations, summariesByScope,
    player.activePlaylistScope, player.playlistTrackMetadata])
  // The aggregated page must stay painted when a click activates another folder:
  // the previous active rows lose their player-owned thumbnails, and the read-only
  // artwork already cached for those files bridges the gap. Only rows whose current
  // owner has no cover are pinned to the cache.
  const allSongsFallbackSourcePaths = useMemo(() => {
    if (!isSongsCategoryOpen) return EMPTY_FALLBACK_SOURCE_PATHS
    const fallbackSourcePaths = new Set<string>()
    for (const row of allSongsRows) {
      if ((row.track as ReadOnlyArtworkRow).coverThumbnail) continue
      if (!libraryArtwork.get(row.key)?.coverThumbnail) continue
      fallbackSourcePaths.add(row.key)
    }
    return fallbackSourcePaths
  }, [allSongsRows, isSongsCategoryOpen, libraryArtwork])
  const allSongsManualPaths = player.allSongsManualPaths
  // Without a manual order the derived array *is* the presentation array, so keep
  // that reference instead of copying it on every render.
  const allSongs = useMemo(() => allSongsManualPaths
    ? applyManualSongOrder(allSongsRows, allSongsManualPaths, item => item.sourcePath)
    : allSongsRows, [allSongsRows, allSongsManualPaths])
  const decoratePlaylistAddRequest = useCallback((request: PlaylistAddRequest | undefined): PlaylistAddRequest | undefined => {
    if (!request) return undefined
    const targets = request.targets.map(target => {
      const artwork = target.coverSourcePath ? libraryArtwork.get(normalizeAudioSourcePath(target.coverSourcePath)) : undefined
      return target.coverTrack ? { ...target, coverTrack: { ...target.coverTrack, ...artwork } } : target
    })
    // Picker rows use target scope as their ID; different lists can share a cover song.
    const keyByTrackId = new Map(targets.flatMap(target => target.coverTrack && target.coverSourcePath
      ? [[target.scope, playlistArtworkKey(target.scope, target.coverTrack.id, target.coverSourcePath)] as const] : []))
    return { ...request, targets, artworkSource: { store: libraryArtworkSource.store, keyByTrackId } }
  }, [libraryArtwork, libraryArtworkSource.store])
  const preparePlayerPlaylistAdd = player.preparePlaylistAdd
  const createPlayerAddPlaylist = player.createAddPlaylist
  const preparePlaylistAdd = useCallback((snapshot: PlaylistAddSnapshot) => decoratePlaylistAddRequest(preparePlayerPlaylistAdd(snapshot)),
    [decoratePlaylistAddRequest, preparePlayerPlaylistAdd])
  const createAddPlaylist = useCallback((name: string, snapshot: PlaylistAddSnapshot) => decoratePlaylistAddRequest(createPlayerAddPlaylist(name, snapshot)),
    [decoratePlaylistAddRequest, createPlayerAddPlaylist])
  // The displayed fallback thumbnails are owned by the library cache, so the
  // cache must keep their object URLs resident until an active visual replaces
  // them. `useEffect` runs after the commit that first displays them. The
  // aggregated "all songs" page only pins the cache while it is visible;
  // otherwise its rows are not rendered and the bounded cache may evict.
  useEffect(() => {
    retainLibrarySourcePaths(isSongsCategoryOpen
      ? [...libraryFallbackSourcePaths, ...allSongsFallbackSourcePaths]
      : [...libraryFallbackSourcePaths])
  }, [allSongsFallbackSourcePaths, isSongsCategoryOpen, libraryFallbackSourcePaths, retainLibrarySourcePaths])
  const playlistRowsReady = !displayScope || (
    player.playlistSummaryStatusByScope[displayScope] === 'ready'
    && durationData.settledByScope.get(displayScope) === true
  )
  const startupRowsCurrentReady = !player.hadSavedSession || (!player.queueOpen && !isPlaylistOpen) || playlistRowsReady
  const [startupRowsSettled, setStartupRowsSettled] = useState(false)
  useEffect(() => {
    if (!player.startupRestoreReady || !startupRowsCurrentReady || startupRowsSettled) return
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) setStartupRowsSettled(true) })
    return () => { cancelled = true }
  }, [player.startupRestoreReady, startupRowsCurrentReady, startupRowsSettled])
  const startupRowsReady = startupRowsCurrentReady || startupRowsSettled
  const [startupRowsTimedOut, setStartupRowsTimedOut] = useState(false)
  useEffect(() => {
    if (!player.startupRestoreReady || startupRowsReady || startupRowsTimedOut) return
    const watchdog = window.setTimeout(() => setStartupRowsTimedOut(true), 15_000)
    return () => window.clearTimeout(watchdog)
  }, [player.startupRestoreReady, startupRowsReady, startupRowsTimedOut])
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

  const pageOrigin: PlaybackQueueOrigin = {
    kind: isBrowsingActive && player.playbackQueueKind === 'all-songs' ? 'all-songs' : 'playlist',
    sourceScope: isBrowsingActive && player.playbackQueueKind === 'all-songs' ? undefined
      : isBrowsingActive ? player.playbackSourceScope ?? displayScope ?? undefined : displayScope ?? undefined,
  }

  const viewModel: PlayerUiViewModel = {
    folderSelection: player.folderSelection,
    playback: {
      track: player.track,
      audioOutputInfo: player.audioOutputInfo,
      artwork: player.artwork,
      artworkPrefetchCandidate: player.artworkPrefetchCandidate,
      artworkPrefetchCandidates: player.artworkPrefetchCandidates,
      selectionActivitySequence: player.selectionActivitySequence,
      selectionVisualIntent: player.selectionVisualIntent,
      automaticContinuationVisual: player.automaticContinuationVisual,
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
        albumLocation,
        artistLocation,
        onArtistLocationChange: setArtistLocation,
        albumArtistLocation,
        onAlbumArtistLocationChange: setAlbumArtistLocation,
        composerLocation,
        onComposerLocationChange: setComposerLocation,
        onAlbumLocationChange: setAlbumLocation,
        flatFolderLocation,
        onFlatFolderLocationChange: setFlatFolderLocation,
        folderLocation,
        isFolderRestorePending: player.libraryRestorePending,
        folderError: player.libraryFolderErrors[''],
        onFolderLocationChange: setFolderLocation,
        folderRoots: player.activeFolderPaths.map(path => {
          const source = player.libraryFolderPlaylists.find(item => normalizeAudioSourcePath(item.sourcePath) === normalizeAudioSourcePath(path))
          const error = player.libraryFolderErrors[path]
          const selection = player.folderSelection.committed?.roots.find(root => normalizeAudioSourcePath(root.path) === normalizeAudioSourcePath(path))
          return { path, directoryPaths: source?.directoryPaths, error, selection,
            status: error ? 'error' as const : source ? 'ready' as const : 'loading' as const }
        }),
        allSongs,
        allSongsManualOrder: player.allSongsManualOrder,
        onReorderSongs: player.reorderSongs,
        allSongsMetadataStatus: allSongsRowsReady ? 'ready' : 'loading',
        currentScope: browsedScope,
        activeScope: player.playbackSourceScope,
        onOpen: openLibrary,
        onSelect: browsePlaylist,
        onPlay: (scope) => {
          const item = librarySources.find((entry) => playlistScope(entry) === scope)
          const track = item?.tracks.find((entry) => entry.available)
          if (track && item) void player.selectPlaybackQueueTrack({ kind: 'playlist', sourceScope: scope,
            entries: item.tracks.map((entry) => ({ scope, trackId: entry.id })) }, track.id)
        },
        onPlaySong: (scope, trackId, orderedSongs) => { void player.selectPlaybackQueueTrack({ kind: 'all-songs',
          entries: orderedSongs ?? [{ scope, trackId }] }, trackId) },
        onShufflePlay: (entries) => player.shufflePlaybackQueue({ kind: 'all-songs', entries }),
        onSelectFolders: () => { void player.selectFolders() },
        foldersPinnedInSidebar,
        onToggleFoldersPin: toggleFoldersPin,
        pinnedCategoryIds,
        onToggleCategoryPin: toggleCategoryPin,
        isFolderRescanPending: player.libraryRescanPending,
        onRescanFolders: player.libraryRestorePending || player.libraryImportPending
          || player.libraryStatus === 'clearing' || !player.activeFolderPaths.length
          ? undefined : () => { void player.rescanSelectedLibraryFolders() },
        onImportPlaylist: () => { void player.importPlaylist() },
        isImportPending: player.libraryImportPending || player.deletePending || player.libraryStatus === 'clearing',
        isPlaylistRestorePending: player.playlistRestorePending,
        onCreatePlaylist: player.createPlaylist,
        onPreparePlaylistAdd: preparePlaylistAdd,
        onAddToPlaylist: player.addToPlaylist,
        onRemoveFromPlaylist: player.removeFromPlaylist,
        onCreateAddPlaylist: createAddPlaylist,
        onDeleteSongs: player.deleteSongs,
        isDeletePending: player.deletePending,
      },
      isOpenAudioDisabled: player.audioBusy
        || player.transportBusy
        || player.selectionPending
        || player.timelineInteraction === 'seeking',
      deleteScope: pageOrigin.kind === 'all-songs' ? player.activePlaylistScope : displayScope,
      canRemoveFromList: Boolean(browsedPlaylist && (browsedPlaylist.sourceKind === 'm3u8' || browsedPlaylist.sourceKind === 'custom')
        && !playbackQueueOrigin(browsedPlaylist)),
      onDeleteSongs: player.deleteSongs,
      onReorderSongs: player.reorderSongs,
      onPreparePlaylistAdd: preparePlaylistAdd,
      onAddToPlaylist: player.addToPlaylist,
      onRemoveFromPlaylist: player.removeFromPlaylist,
      onCreateAddPlaylist: createAddPlaylist,
      isDeletePending: player.deletePending,
      onOpenAudio: player.openAudio,
      tracks: browsedTracks,
      artworkSource: isBrowsingActive ? player.playlistArtworkSource : libraryArtworkSource,
      fallbackArtworkSource: isBrowsingActive ? libraryArtworkSource : undefined,
      unavailableTrackIds: browsedUnavailableIds,
      playlistName: browsedPlaylist ? playlistDisplayName(browsedPlaylist) : isBrowsingActive ? player.playlistName : '未选择文件夹',
      metadataStatus: playlistRowsReady ? 'ready' : 'loading',
      totalDurationSeconds: browsedDuration.totalSeconds,
      totalDurationStatus: browsedDuration.status,
      totalDurationDetail: browsedDuration.detail,
      currentTrackId: player.track?.id ?? null,
      shuffleMode: player.shuffleMode,
      onShuffleCycle: player.cycleShuffleMode,
      onShufflePlay: displayScope ? (orderedTrackIds) => player.shufflePlaybackQueue({
        ...pageOrigin,
        entries: orderedTrackIds.map((trackId) => ({ scope: displayScope, trackId })),
      }) : undefined,
      onTrackSelect: player.audioBusy || player.transportBusy || player.timelineInteraction === 'seeking'
        ? undefined
        : handlePlaylistTrackSelect,
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
          preloadAllSongs={Boolean(!isPlaylistOpen && player.startupRestoreReady && player.playbackQueueKind === 'all-songs')}
          onPlaylistNavigationSettled={() => setPlaylistArtworkSettled(true)}
          startupReady={player.startupRestoreReady && (startupRowsReady || startupRowsTimedOut)}
          startupError={startupRowsTimedOut}
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
