import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useIsPresent, type MotionValue } from 'motion/react'
import type { PlaylistDeleteAction, PlaylistDeleteSnapshot, PlaylistAddAction, PlaylistAddSnapshot, PlaylistAddRequest, PlaylistAddCallbacks, PlaylistRemoveAction } from '../model/playerUiViewModel'

export type LibraryDockSelection = {
  scope?: string | null
  active: boolean
  count: number
  total: number
  allSelected: boolean
  canSelectAll: boolean
  canPlay: boolean
  canCreatePlaylist: boolean
  canDelete?: boolean
  onPrepareDelete?: () => PlaylistDeleteSnapshot | undefined
  onDelete?: PlaylistDeleteAction
  canAddToPlaylist?: boolean
  onPrepareAddToPlaylist?: () => PlaylistAddRequest | undefined
  onRefreshAddToPlaylist?: (snapshot: PlaylistAddSnapshot) => PlaylistAddRequest | undefined
  onAddToPlaylist?: PlaylistAddAction
  onRemoveFromPlaylist?: PlaylistRemoveAction
  onCreateAddPlaylist?: PlaylistAddCallbacks['onCreateAddPlaylist']
  onOpenPlaylistTarget?: (scope: string) => void
  onSelectAll: () => void
  onClear: () => void
  onExit: () => void
  onPlay: () => void
  onCreatePlaylist?: () => void
}

export type LibraryDockBinding = {
  searchOpen: boolean
  onSearchToggle?: () => void
  controllerOffsetY?: MotionValue<number>
  controllerHidden?: boolean
  selection?: LibraryDockSelection
}

export const LibraryDockContext = createContext<{
  dockRef: RefObject<HTMLElement | null>
  activeRouteKey: string | null
  publish: (owner: symbol, routeKey: string, binding: LibraryDockBinding) => () => void
} | null>(null)

// Bind local page controls to the one session-owned dock. Retiring pages must
// neither publish controls nor clear a successor's registration.
export function useLibraryDockBinding(routeKey: string, binding: LibraryDockBinding) {
  const context = useContext(LibraryDockContext)
  const isPresent = useIsPresent()
  const owner = useRef(Symbol('library-dock-page'))
  const action = useRef(binding.onSearchToggle)
  const selectionRef = useRef(binding.selection)
  useLayoutEffect(() => { action.current = binding.onSearchToggle })
  useLayoutEffect(() => { selectionRef.current = binding.selection })
  const toggleSearch = useCallback(() => action.current?.(), [])
  const selectAll = useCallback(() => selectionRef.current?.onSelectAll(), [])
  const clear = useCallback(() => selectionRef.current?.onClear(), [])
  const exit = useCallback(() => selectionRef.current?.onExit(), [])
  const play = useCallback(() => selectionRef.current?.onPlay(), [])
  const create = useCallback(() => selectionRef.current?.onCreatePlaylist?.(), [])
  const prepareDelete = useCallback(() => selectionRef.current?.onPrepareDelete?.(), [])
  const prepareAdd = useCallback(() => selectionRef.current?.onPrepareAddToPlaylist?.(), [])
  const refreshAdd = useCallback((snapshot: PlaylistAddSnapshot) => {
    const current = selectionRef.current
    return current?.scope === snapshot.scope ? current.onRefreshAddToPlaylist?.(snapshot) : undefined
  }, [])
  const addSongs = useCallback<PlaylistAddAction>((snapshot, targetScope, position) => {
    const current = selectionRef.current
    return current?.onAddToPlaylist && current.scope === snapshot.scope
      ? current.onAddToPlaylist(snapshot, targetScope, position)
      : Promise.resolve({ targetScope, addedCount: 0, alreadyPresentCount: 0, failedKeys: [...snapshot.songKeys], errorMessage: '当前列表已关闭，请重新选择歌曲。' })
  }, [])
  const removeSongs = useCallback<PlaylistRemoveAction>((snapshot, targetScope) => {
    const current = selectionRef.current
    return current?.onRemoveFromPlaylist && current.scope === snapshot.scope
      ? current.onRemoveFromPlaylist(snapshot, targetScope)
      : Promise.resolve({ targetScope, addedCount: 0, removedCount: 0, alreadyPresentCount: 0, failedKeys: [...snapshot.songKeys], errorMessage: '当前列表已关闭，请重新选择歌曲。' })
  }, [])
  const createAdd = useCallback((name: string, snapshot: PlaylistAddSnapshot) => {
    const current = selectionRef.current
    return current?.scope === snapshot.scope ? current.onCreateAddPlaylist?.(name, snapshot) : undefined
  }, [])
  const openTarget = useCallback((scope: string) => selectionRef.current?.onOpenPlaylistTarget?.(scope), [])
  const deleteSongs = useCallback<PlaylistDeleteAction>((snapshot, mode) => {
    const action = selectionRef.current?.onDelete
    const currentScope = selectionRef.current?.onPrepareDelete?.()?.scope
    return action && currentScope === snapshot.scope ? action(snapshot, mode) : Promise.resolve({ succeededKeys: [], failedKeys: [...snapshot.songKeys], errorMessage: '当前列表已关闭，请重新选择歌曲。' })
  }, [])
  const selectionActive = binding.selection?.active ?? false
  const selectionScope = binding.selection?.scope
  const count = binding.selection?.count ?? 0
  const total = binding.selection?.total ?? 0
  const allSelected = binding.selection?.allSelected ?? false
  const canSelectAll = binding.selection?.canSelectAll ?? false
  const canPlay = binding.selection?.canPlay ?? false
  const canCreatePlaylist = binding.selection?.canCreatePlaylist ?? false
  const canDelete = binding.selection?.canDelete ?? false
  const canAddToPlaylist = binding.selection?.canAddToPlaylist ?? false
  const hasSelection = Boolean(binding.selection)
  const selection = useMemo(() => hasSelection ? {
    scope: selectionScope, active: selectionActive, count, total, allSelected, canSelectAll, canPlay, canCreatePlaylist, canDelete, canAddToPlaylist,
    onPrepareDelete: prepareDelete, onDelete: deleteSongs,
    onPrepareAddToPlaylist: prepareAdd, onRefreshAddToPlaylist: refreshAdd, onAddToPlaylist: addSongs, onRemoveFromPlaylist: removeSongs,
    onCreateAddPlaylist: createAdd, onOpenPlaylistTarget: openTarget,
    onSelectAll: selectAll, onClear: clear, onExit: exit, onPlay: play, onCreatePlaylist: create,
  } : undefined, [hasSelection, selectionScope, selectionActive, count, total, allSelected, canSelectAll, canPlay, canCreatePlaylist, canDelete, canAddToPlaylist, prepareDelete, deleteSongs, prepareAdd, refreshAdd, addSongs, removeSongs, createAdd, openTarget, selectAll, clear, exit, play, create])
  const hasSearch = Boolean(binding.onSearchToggle)
  const stableBinding = useMemo(() => ({
    searchOpen: binding.searchOpen,
    onSearchToggle: hasSearch ? toggleSearch : undefined,
    controllerOffsetY: binding.controllerOffsetY,
    controllerHidden: binding.controllerHidden,
    selection,
  }), [binding.searchOpen, hasSearch, binding.controllerOffsetY, binding.controllerHidden, toggleSearch, selection])
  const publish = context?.publish
  const active = isPresent && context?.activeRouteKey === routeKey
  useLayoutEffect(() => {
    if (!active || !publish) return
    return publish(owner.current, routeKey, stableBinding)
  }, [active, publish, routeKey, stableBinding])
  return context
}
