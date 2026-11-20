import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { createPlaylistDurationScanner, resolvePlaylistDuration, type PlaylistDurationResult, type PlaylistDurationScanResult } from '@/features/player/model/playlistDuration'
import { probeAudioPlaylistDurations } from '@/features/player/services/audioCommands'

const scanDuration = createPlaylistDurationScanner(probeAudioPlaylistDurations)
type DurationSource = { sourcePath: string; available?: boolean }
type LibraryDurationSource = { scope: string; sources: readonly DurationSource[] }
type CompletedDuration = { sourceKey: string; sources: readonly DurationSource[]; result: PlaylistDurationScanResult }
export type PlaylistLibraryDurationData = {
  totals: ReadonlyMap<string, PlaylistDurationResult>
  settledByScope: ReadonlyMap<string, boolean>
  durationsByScope: ReadonlyMap<string, ReadonlyMap<string, number>>
}
const noKnownDurations: ReadonlyMap<string, number> = new Map()

// Totals and per-path probe results do not depend on presentation order.
// Keep duplicates and availability in the identity while allowing a reorder
// to reuse the prepared result instead of unmounting the painted song grid.
function durationSourceKey(sources: readonly DurationSource[]): string {
  return JSON.stringify(sources.map(({ sourcePath, available }) => JSON.stringify([sourcePath, available !== false])).sort())
}

function knownForScope(knownDurationsByScope: ReadonlyMap<string, ReadonlyMap<string, number>>, scope: string): ReadonlyMap<string, number> {
  return knownDurationsByScope.get(scope) ?? noKnownDurations
}

function mergeKnownDurations(sources: readonly DurationSource[], result: PlaylistDurationScanResult, known: ReadonlyMap<string, number>): PlaylistDurationScanResult {
  const durations = new Map(result.durationsByPath)
  let changed = false
  for (const source of sources) {
    const value = known.get(source.sourcePath)
    if (source.available !== false && value != null && Number.isFinite(value) && value >= 0 && durations.get(source.sourcePath) !== value) {
      durations.set(source.sourcePath, value)
      changed = true
    }
  }
  return changed ? { ...result, durationsByPath: durations } : result
}

// One session owner prepares every list, including lists outside the current
// view. Known durations are supplied per scope (never as one global map): the
// truth behind a known duration is the row data of that particular list, so a
// path known in one scope must not silently complete another scope. Required
// shape is `knownDurationsByScope`; there is deliberately no global parameter,
// so two competing sources can never be active at the same time.
// `knownDurations` still wins over probe results (see `resolvePlaylistDuration`).
export function usePlaylistLibraryDurations(
  sources: readonly DurationSource[],
  scope: string,
  librarySources: readonly LibraryDurationSource[],
  knownDurationsByScope: ReadonlyMap<string, ReadonlyMap<string, number>>,
  preferredScopes: readonly string[] = [],
): PlaylistLibraryDurationData {
  const tasks = useMemo(() => [{ scope, sources }, ...librarySources.filter((item) => item.scope !== scope)]
    .sort((left, right) => {
      const leftPriority = preferredScopes.indexOf(left.scope)
      const rightPriority = preferredScopes.indexOf(right.scope)
      return (leftPriority < 0 ? preferredScopes.length : leftPriority)
        - (rightPriority < 0 ? preferredScopes.length : rightPriority)
    })
    .map((item) => ({ ...item, sourceKey: durationSourceKey(item.sources) })),
  [sources, scope, librarySources, preferredScopes])
  const [completed, setCompleted] = useState<ReadonlyMap<string, CompletedDuration>>(new Map())
  const completedRef = useRef(completed)
  const readKnownDurationsByScope = useEffectEvent(() => knownDurationsByScope)
  useEffect(() => {
    let current = true
    const scopes = new Set(tasks.map((task) => task.scope))
    const pruned = new Map([...completedRef.current].filter(([key]) => scopes.has(key)))
    const removed = pruned.size !== completedRef.current.size
    completedRef.current = pruned
    async function scanLists() {
      if (removed) {
        await Promise.resolve()
        if (!current) return
        setCompleted(completedRef.current)
      }
      for (const task of tasks) {
        if (!current) return
        const cached = completedRef.current.get(task.scope)
        if (cached?.sourceKey === task.sourceKey && cached.sources === task.sources) continue
        const known = knownForScope(readKnownDurationsByScope(), task.scope)
        const entries = task.sources.map(({ sourcePath, available }) => ({ sourcePath, available, durationMs: known.get(sourcePath) }))
        const result = await scanDuration(entries, () => current)
        if (!current || !result) return
        const next = new Map(completedRef.current)
        next.set(task.scope, {
          sourceKey: task.sourceKey,
          sources: task.sources,
          result: mergeKnownDurations(task.sources, result, knownForScope(readKnownDurationsByScope(), task.scope)),
        })
        completedRef.current = next
        setCompleted(next)
      }
    }
    void scanLists()
    return () => { current = false }
  }, [tasks, scope])
  useEffect(() => {
    let current = true
    // Retain truthful late metadata with its source key so it also contributes
    // when this list becomes inactive. Every scope merges only its own known
    // durations, and hydration never starts another scan.
    void Promise.resolve().then(() => {
      if (!current) return
      let next: Map<string, CompletedDuration> | null = null
      for (const task of tasks) {
        const cached = completedRef.current.get(task.scope)
        if (!cached || cached.sourceKey !== task.sourceKey) continue
        const result = mergeKnownDurations(task.sources, cached.result, knownForScope(knownDurationsByScope, task.scope))
        if (result === cached.result) continue
        next ??= new Map(completedRef.current)
        next.set(task.scope, { ...cached, result })
      }
      if (!next) return
      completedRef.current = next
      setCompleted(next)
    })
    return () => { current = false }
  }, [tasks, knownDurationsByScope])
  return useMemo(() => {
    const totals = new Map<string, PlaylistDurationResult>()
    const settledByScope = new Map<string, boolean>()
    const durationsByScope = new Map<string, ReadonlyMap<string, number>>()
    for (const task of tasks) {
      const cached = completed.get(task.scope)
      const result = cached?.sourceKey === task.sourceKey ? cached.result : undefined
      const known = knownForScope(knownDurationsByScope, task.scope)
      totals.set(task.scope, resolvePlaylistDuration(task.sources, known, result, !result))
      settledByScope.set(task.scope, task.sources.length === 0 || Boolean(result))
      durationsByScope.set(task.scope, result ? result.durationsByPath : known)
    }
    return { totals, settledByScope, durationsByScope }
  }, [tasks, completed, knownDurationsByScope])
}

export function usePlaylistDuration(sources: readonly DurationSource[], scope: string, knownDurations: ReadonlyMap<string, number>): PlaylistDurationResult {
  // A refreshed playlist DTO can carry the same entries in a new array. Show
  // its prepared total while revalidating durations in the background.
  const sourceKey = useMemo(() => durationSourceKey(sources), [sources])
  const [completed, setCompleted] = useState<{ sourceKey: string; scope: string; result: PlaylistDurationScanResult } | null>(null)
  const readKnownDurations = useEffectEvent(() => knownDurations)
  useEffect(() => {
    let current = true
    const known = readKnownDurations()
    const entries = sources.map(({ sourcePath, available }) => ({ sourcePath, available, durationMs: known.get(sourcePath) }))
    void scanDuration(entries, () => current).then((result) => {
      if (current && result) setCompleted({ sourceKey, scope, result })
    })
    return () => { current = false }
  }, [sources, sourceKey, scope])
  // Newly hydrated truthful metadata can complete an unknown total without
  // restarting native work. A failed probe is never retried in a render loop.
  const scanResult = completed?.sourceKey === sourceKey && completed.scope === scope ? completed.result : undefined
  return resolvePlaylistDuration(sources, knownDurations, scanResult, !scanResult)
}
