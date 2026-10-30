import type { MediaLibraryCategoryId, MediaLibraryRoute } from '@/features/player/model/mediaLibraryCategories'
import type { LibraryFolderSettings, DirectoryChildren, ReplaceLibraryFoldersInput, RootSelection } from '@/features/player/services/audioCommands'
import type { PlaylistArtworkSource } from '@/features/player/model/playlistArtworkStore'
import type { RepeatMode, ShuffleMode } from '@/features/player/model/playbackModes'
import type { PlaylistDurationStatus } from '@/features/player/model/playlistDuration'
import type { Track, TrackArtwork, TrackArtworkPrefetchCandidate, TrackFeedback, TrackSummary } from '@/features/player/model/playerTypes'
import type { PlayerVisualTimelineClock } from '@/features/player/model/visualTimelineClock'
import type { PlaybackQueueEntry } from '@/features/player/model/playbackQueue'
import type { AudioOutputInfo, AudioTransportTarget, AudioTransportTransition } from '@/features/player/services/audioCommands'

export type PlayerContentState = 'empty' | 'loading' | 'track' | 'error'

export type TrackSelectionVisualSource = 'previous' | 'next' | 'automatic' | 'queue'

export type TrackSelectionVisualIntent = {
  requestId: number
  sequence: number
  targetTrackId: string
  direction: -1 | 1
  source: TrackSelectionVisualSource
  progressStartRatio: number
  preservePlayingVisual: boolean
  previewTokenId?: number
}

export type TrackCardPreviewToken = Readonly<{
  id: number
  originTrackId: string
  targetTrackId: string
  direction: -1 | 1
  track: Track
  artwork: TrackArtwork
}>

export type PlayerPlaybackViewModel = {
  track: Track | null
  audioOutputInfo?: AudioOutputInfo | null
  artwork?: TrackArtwork | null
  artworkPrefetchCandidate?: TrackArtworkPrefetchCandidate | null
  artworkPrefetchCandidates?: readonly TrackArtworkPrefetchCandidate[]
  selectionActivitySequence?: number
  selectionVisualIntent?: TrackSelectionVisualIntent | null
  automaticContinuationVisual?: boolean
  detailsPending?: boolean
  contentState?: PlayerContentState
  isPlaying: boolean
  shuffleMode: ShuffleMode
  repeatMode: RepeatMode
  isAudioBusy: boolean
  isSelectionPending?: boolean
  isTransportBusy: boolean
  transportTransition?: AudioTransportTransition | null
  transportSettledRequestId?: number | null
  statusText: string
  onOpenAudio: () => void
  onPrevious: () => void
  onNext: () => void
  onPrepareTrackPreview?: (direction: -1 | 1) => Promise<TrackCardPreviewToken | null>
  onPrimeTrackArtwork?: (direction: -1 | 1) => void
  onCommitTrackPreview?: (tokenId: number) => boolean
  onDiscardTrackPreview?: (tokenId: number) => void
  onPlayToggle: (request: PlayerPlaybackTransitionRequest) => Promise<PlayerPlaybackTransitionResult>
  onShuffleCycle: () => void
  onRepeatCycle: () => void
}

export type PlayerPlaybackTransitionRequest = {
  requestId: number
  expectedTrackId: string
  target: AudioTransportTarget
  durationMs: number
}

export type PlayerPlaybackTransitionResult = {
  requestId: number
  completed: boolean
}

export type PlayerTimelineInteraction = 'following' | 'previewing' | 'seeking'

export type PlayerTimelineViewModel = {
  positionSeconds: number
  durationSeconds: number
  interaction: PlayerTimelineInteraction
  visualClock?: PlayerVisualTimelineClock
  onPreviewStart: () => void
  onPreview: (positionSeconds: number) => void
  onCommit: (positionSeconds: number) => void
  onCancelPreview: () => void
}

export type PlayerVolumeViewModel = {
  valuePercent: number
  isBusy: boolean
  isDisabled: boolean
  onChange: (valuePercent: number) => void
}

export type PlayerQueueViewModel = {
  tracks: TrackSummary[]
  unavailableTrackIds?: ReadonlySet<string>
  playlistName?: string
  isOpen: boolean
  onToggle: () => void
  onTrackSelect?: (trackId: string) => void
}

export type PlaylistCoverImage = Readonly<{
  src: string
  width: number
  height: number
  encodedBytes: number
}>

export type PlaylistTrackItemViewModel = TrackSummary
  & Partial<Pick<Track, 'durationSeconds' | 'fileExtension' | 'coverTone' | 'coverImage' | 'coverImageFallback' | 'audioFormat'>>
  & Readonly<{
    hasLocalArtwork?: boolean
    /** Raw library tags: undefined while pending, null when absent. */
    libraryAlbumName?: string | null
    libraryArtistName?: string | null
    libraryComposerName?: string | null
    libraryGenreName?: string | null
    libraryYear?: number | null
    albumArtist?: string | null
    coverThumbnail?: PlaylistCoverImage
  }>

export type PlaylistTrackMetadata = Pick<
  Track,
  'id' | 'title' | 'artist' | 'album' | 'durationSeconds' | 'fileExtension' | 'coverTone' | 'audioFormat'
> & Readonly<{
  hasLocalArtwork: boolean
}>

// Visual completion cannot overwrite text or duration from the metadata lane.
export type PlaylistTrackVisual = Pick<Track, 'id' | 'coverTone'> & Readonly<{
  hasLocalArtwork: boolean
  coverThumbnail?: PlaylistCoverImage
}>

export type PlaylistLibraryItem = {
  scope: string
  name: string
  trackCount: number
  coverTrack?: PlaylistTrackItemViewModel
  coverSourcePath?: string
  totalClock?: string | null
  sourceKind?: 'folder' | 'm3u8' | 'custom'
}

export type AllSongsItem = Readonly<{
  key: string
  scope: string
  trackId: string
  sourcePath: string
  fileCreatedAtMs?: number | null
  track: PlaylistTrackItemViewModel
  available: boolean
  artworkRevision?: number
}>

export type PlaylistDeleteSnapshot = Readonly<{
  scope: string | null
  songKeys: readonly string[]
  canRemoveFromList: boolean
}>

export type PlaylistDeleteResult = Readonly<{
  succeededKeys: readonly string[]
  failedKeys: readonly string[]
  errorMessage?: string
}>

export type PlaylistDeleteMode = 'list' | 'files'
export type PlaylistDeleteAction = (snapshot: PlaylistDeleteSnapshot, mode: PlaylistDeleteMode) => Promise<PlaylistDeleteResult>

export type SongReorderRequest = Readonly<{ scope: string | null; expectedKeys: readonly string[]; orderedKeys: readonly string[] }>
export type SongReorderAction = (request: SongReorderRequest) => Promise<{ ok: boolean; errorMessage?: string }>

export type PlaylistAddSnapshot = Readonly<{ scope: string | null; songKeys: readonly string[] }>
export type PlaylistAddTarget = PlaylistLibraryItem & Readonly<{ containedCount: number; containsAll: boolean }>
export type PlaylistAddRequest = Readonly<{ snapshot: PlaylistAddSnapshot; targets: readonly PlaylistAddTarget[]; suggestedName?: string; artworkSource?: PlaylistArtworkSource }>
export type PlaylistInsertionPosition = 'start' | 'end' | 'random'
export type PlaylistAddResult = Readonly<{
  targetScope: string
  addedCount: number
  removedCount?: number
  alreadyPresentCount: number
  failedKeys: readonly string[]
  errorMessage?: string
}>
export type PlaylistAddAction = (snapshot: PlaylistAddSnapshot, targetScope: string, position?: PlaylistInsertionPosition) => Promise<PlaylistAddResult>
export type PlaylistRemoveAction = (snapshot: PlaylistAddSnapshot, targetScope: string) => Promise<PlaylistAddResult>
export type PlaylistAddCallbacks = {
  onPreparePlaylistAdd?: (snapshot: PlaylistAddSnapshot) => PlaylistAddRequest | undefined
  onAddToPlaylist?: PlaylistAddAction
  onRemoveFromPlaylist?: PlaylistRemoveAction
  onCreateAddPlaylist?: (name: string, snapshot: PlaylistAddSnapshot) => PlaylistAddRequest | undefined
}

export type PlaylistLibraryViewModel = PlaylistAddCallbacks & {
  artistLocation?: import('./artistLibrary').ArtistLocation
  onArtistLocationChange?: (location: import('./artistLibrary').ArtistLocation) => void
  albumArtistLocation?: import('./artistLibrary').ArtistLocation
  onAlbumArtistLocationChange?: (location: import('./artistLibrary').ArtistLocation) => void
  composerLocation?: import('./artistLibrary').ArtistLocation
  onComposerLocationChange?: (location: import('./artistLibrary').ArtistLocation) => void
  albumLocation?: string | null
  onAlbumLocationChange?: (key: string | null) => void
  folderRoots?: readonly { path: string; directoryPaths?: readonly string[]; status: 'loading' | 'ready' | 'error'; error?: string; selection?: RootSelection }[]
  isFolderRestorePending?: boolean
  folderError?: string
  flatFolderLocation?: { rootPath: string; directoryPath: string } | null
  onFlatFolderLocationChange?: (location: { rootPath: string; directoryPath: string } | null) => void
  folderLocation?: { rootPath: string; directoryPath: string } | null
  onFolderLocationChange?: (location: { rootPath: string; directoryPath: string } | null) => void
  route?: MediaLibraryRoute
  onOpenOverview?: () => void
  onSelectCategory?: (categoryId: MediaLibraryCategoryId) => void
  isOpen: boolean
  items: readonly PlaylistLibraryItem[]
  recentSongs?: readonly AllSongsItem[]
  recentAddedSongs?: readonly AllSongsItem[]
  allSongs?: readonly AllSongsItem[]
  allSongsMetadataStatus?: 'loading' | 'ready'
  allSongsManualOrder?: boolean
  onReorderSongs?: SongReorderAction
  currentScope?: string | null
  activeScope?: string | null
  onOpen: () => void
  onSelect: (scope: string) => void
  onPlay: (scope: string) => void
  onPlaySong?: (scope: string, trackId: string, orderedSongs?: readonly PlaybackQueueEntry[]) => void
  onShufflePlay?: (orderedSongs: readonly PlaybackQueueEntry[]) => Promise<boolean> | boolean
  onSelectFolders?: () => void
  onRescanFolders?: () => void
  isFolderRescanPending?: boolean
  foldersPinnedInSidebar?: boolean
  onToggleFoldersPin?: () => void
  pinnedCategoryIds?: readonly MediaLibraryCategoryId[]
  onToggleCategoryPin?: (categoryId: MediaLibraryCategoryId) => void
  onImportPlaylist?: () => void
  isImportPending?: boolean
  isPlaylistRestorePending?: boolean
  onCreatePlaylist?: (name: string, songKeys: readonly string[]) => string | null
  onDeleteSongs?: PlaylistDeleteAction
  isDeletePending?: boolean
}

export type PlayerPlaylistViewModel = PlaylistAddCallbacks & {
  onReorderSongs?: SongReorderAction
  deleteScope?: string | null
  canRemoveFromList?: boolean
  onDeleteSongs?: PlaylistDeleteAction
  isDeletePending?: boolean
  artworkSource?: PlaylistArtworkSource
  fallbackArtworkSource?: PlaylistArtworkSource
  entryPosition?: Readonly<{ requestId: number; target: 'top' | 'current-track' }>
  library?: PlaylistLibraryViewModel
  playbackDockTrack?: PlaylistTrackItemViewModel
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  isOpenAudioDisabled?: boolean
  onOpenAudio?: () => void
  tracks: PlaylistTrackItemViewModel[]
  unavailableTrackIds?: ReadonlySet<string>
  playlistName?: string
  /**
   * Readiness of the list's real tag text. `loading` means the rows are not
   * trustworthy yet and the panel must show a loading state instead of
   * placeholder song text. Missing means ready, so existing callers that build
   * the view model directly keep their current behaviour.
   */
  metadataStatus?: 'loading' | 'ready'
  currentTrackId?: string | null
  totalDurationSeconds?: number
  totalDurationStatus?: PlaylistDurationStatus
  totalDurationDetail?: string
  shuffleMode: ShuffleMode
  onShuffleCycle: () => void
  onTrackSelect?: (trackId: string, orderedTrackIds?: readonly string[]) => void
  onShufflePlay?: (orderedTrackIds: readonly string[]) => Promise<boolean> | boolean
  onVisibleTrackIdsChange?: (trackIds: readonly string[], keepPersistentArtwork?: boolean, showArtwork?: boolean, demand?: PlaylistArtworkDemand) => void
}

export type PlaylistArtworkDemand = {
  visibleIds: readonly string[]
  prefetchIds: readonly string[]
  heldIds: readonly string[]
  coverCssPixels: number
  dpr: number
}

export type PlayerFeedbackViewModel = {
  value?: TrackFeedback
  valuesByTrackId?: Readonly<Record<string, TrackFeedback>>
  onToggle: (feedback: TrackFeedback) => void
}

export type FolderSelectionViewModel = {
  isOpen: boolean
  committed: LibraryFolderSettings | null
  isSaving: boolean
  error?: string
  onOpenChange: (open: boolean) => void
  onPickFolders: () => Promise<string[] | null>
  onListDirectories: (input: { rootPath: string; directoryPath: string }) => Promise<DirectoryChildren>
  onSave: (input: ReplaceLibraryFoldersInput) => Promise<void>
}

export type PlayerUiViewModel = {
  search?: {
    allSongs?: readonly AllSongsItem[]
    metadataStatus?: 'loading' | 'ready'
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    onPlaySong?: PlaylistLibraryViewModel['onPlaySong']
    onShufflePlay?: PlaylistLibraryViewModel['onShufflePlay']
  }
  folderSelection?: FolderSelectionViewModel
  playback: PlayerPlaybackViewModel
  timeline: PlayerTimelineViewModel
  volume: PlayerVolumeViewModel
  queue: PlayerQueueViewModel
  playlist: PlayerPlaylistViewModel
  feedback: PlayerFeedbackViewModel
}

export type DevAudioToolsViewModel = {
  fileName: string | null
  hasTrack: boolean
  phase: string
  title: string | null
  isPlaying: boolean
  isAudioBusy: boolean
  isTransportBusy: boolean
  statusText: string
  positionSeconds: number
  durationSeconds: number
  onOpen: () => void
  onOpenAndPlay: () => void
  onPlayToggle: () => void
  onPreview: (positionSeconds: number) => void
  onCommit: (positionSeconds: number) => void
  onRefresh: () => void
  onStop: () => void
}
