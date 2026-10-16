import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { createPlaylistDurationScanner, resolvePlaylistDuration, type PlaylistDurationResult, type PlaylistDurationScanResult } from '@/features/player/model/playlistDuration'
import { probeAudioPlaylistDurations } from '@/features/player/services/audioCommands'

const scanDuration = createPlaylistDurationScanner(probeAudioPlaylistDurations)
type DurationSource = { sourcePath: string; available?: boolean }
type LibraryDurationSource = { scope: string; sources: readonly DurationSource[] }
type CompletedDuration = { sourceKey: string; sources: readonly DurationSource[]; result: PlaylistDurationScanResult }
const noKnownDurations: ReadonlyMap<string, number> = new Map()

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
// view. Keep the standalone hook below for consumers that own a single scope.
export function usePlaylistLibraryDurations(
  sources: readonly DurationSource[],
  scope: string,
  librarySources: readonly LibraryDurationSource[],
  knownDurations: ReadonlyMap<string, number>,
): ReadonlyMap<string, PlaylistDurationResult> {
  const tasks = useMemo(() => [{ scope, sources }, ...librarySources.filter((item) => item.scope !== scope)]
    .map((item) => ({ ...item, sourceKey: JSON.stringify(item.sources.map(({ sourcePath, available }) => [sourcePath, available !== false])) })),
  [sources, scope, librarySources])
  const [completed, setCompleted] = useState<ReadonlyMap<string, CompletedDuration>>(new Map())
  const completedRef = useRef(completed)
  const readKnownDurations = useEffectEvent(() => knownDurations)
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
        const known = task.scope === scope ? readKnownDurations() : noKnownDurations
        const entries = task.sources.map(({ sourcePath, available }) => ({ sourcePath, available, durationMs: known.get(sourcePath) }))
        const result = await scanDuration(entries, () => current)
        if (!current || !result) return
        const next = new Map(completedRef.current)
        const prepared = task.scope === scope ? mergeKnownDurations(task.sources, result, readKnownDurations()) : result
        next.set(task.scope, { sourceKey: task.sourceKey, sources: task.sources, result: prepared })
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
    // when this list becomes inactive. Hydration never starts another scan.
    void Promise.resolve().then(() => {
      if (!current) return
      const task = tasks.find((item) => item.scope === scope)!
      const cached = completedRef.current.get(scope)
      if (cached?.sourceKey !== task.sourceKey) return
      const result = mergeKnownDurations(task.sources, cached.result, knownDurations)
      if (result === cached.result) return
      const next = new Map(completedRef.current)
      next.set(scope, { ...cached, result })
      completedRef.current = next
      setCompleted(next)
    })
    return () => { current = false }
  }, [tasks, scope, knownDurations])
  return new Map(tasks.map((task) => {
    const cached = completed.get(task.scope)
    const result = cached?.sourceKey === task.sourceKey ? cached.result : undefined
    return [task.scope, resolvePlaylistDuration(task.sources, task.scope === scope ? knownDurations : noKnownDurations, result, !result)]
  }))
}

export function usePlaylistDuration(sources: readonly DurationSource[], scope: string, knownDurations: ReadonlyMap<string, number>): PlaylistDurationResult {
  // A refreshed playlist DTO can carry the same entries in a new array. Show
  // its prepared total while revalidating durations in the background.
  const sourceKey = useMemo(() => JSON.stringify(sources.map(({ sourcePath, available }) => [sourcePath, available !== false])), [sources])
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
