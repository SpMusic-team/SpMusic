export type PlaylistDurationStatus = 'loading' | 'ready' | 'unknown' | 'error'
export type PlaylistDurationResult = {
  status: PlaylistDurationStatus
  totalSeconds?: number
  detail?: string
}
export type PlaylistDurationEntry = { sourcePath: string; durationMs?: number | null; available?: boolean }
export type PlaylistDurationProbeItem = { sourcePath: string; durationMs: number | null; error: unknown | null }
export type PlaylistDurationProbe = (paths: string[]) => Promise<PlaylistDurationProbeItem[]>
export type PlaylistDurationScanResult = {
  durationsByPath: ReadonlyMap<string, number>
  itemFailures: ReadonlyMap<string, { kind: 'unknown-duration' | 'probe-error'; error?: unknown }>
  commandFailure?: { kind: 'invoke' | 'protocol'; message: string }
}

function validDuration(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0
}

function failureMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const code = 'code' in error && typeof error.code === 'string' ? `${error.code}: ` : ''
    return `${code}${error.message}`
  }
  return String(error)
}

export function aggregatePlaylistDuration(entries: readonly PlaylistDurationEntry[]): PlaylistDurationResult {
  let totalMs = 0
  for (const entry of entries) {
    if (entry.available === false) continue
    if (!validDuration(entry.durationMs)) return { status: 'unknown' }
    totalMs += entry.durationMs
    if (!Number.isFinite(totalMs)) return { status: 'unknown' }
  }
  return { status: 'ready', totalSeconds: totalMs / 1000 }
}

// Hydrated metadata can resolve a previously failed item while retaining every
// successful probe. Missing files contribute no time; available files must have
// resolved durations before publishing their total.
export function resolvePlaylistDuration(
  entries: readonly PlaylistDurationEntry[],
  knownDurations: ReadonlyMap<string, number>,
  scanResult?: PlaylistDurationScanResult,
  pending = false,
): PlaylistDurationResult {
  const resolvedEntries = entries.map((entry) => {
    const known = knownDurations.get(entry.sourcePath)
    const durationMs = validDuration(known) ? known : scanResult?.durationsByPath.get(entry.sourcePath)
    return { ...entry, durationMs }
  })
  const aggregate = aggregatePlaylistDuration(resolvedEntries)
  if (aggregate.status === 'ready') return aggregate
  if (pending) return { status: 'loading' }
  const unresolvedEntries = resolvedEntries.filter((entry) => entry.available !== false && !validDuration(entry.durationMs))
  const unresolvedCount = unresolvedEntries.length
  if (scanResult?.commandFailure) return {
    status: 'error',
    detail: `${unresolvedCount} 首歌曲尚未完成时长统计：${scanResult.commandFailure.message}`,
  }
  const unresolvedPaths = new Set(unresolvedEntries.map((entry) => entry.sourcePath))
  const probeErrors = [...scanResult?.itemFailures.entries() ?? []].filter(([path, item]) => unresolvedPaths.has(path) && item.kind === 'probe-error').length
  return {
    status: 'unknown',
    detail: `${unresolvedCount} 首歌曲时长未知${probeErrors ? `，${probeErrors} 个文件读取失败` : ''}`,
  }
}

function formatDurationClock(totalSeconds?: number): string | null {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return null
  const seconds = Math.floor(totalSeconds)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}

export function formatPlaylistDurationLabel(
  result: { status?: PlaylistDurationStatus; totalSeconds?: number },
  trackCount: number,
): string {
  if (result.status === 'loading') return '统计中…'
  if (result.status === 'error') return '统计失败'
  if (result.status === 'unknown') return '时长未知'
  return formatDurationClock(result.totalSeconds) ?? (trackCount === 0 ? '0:00' : '未知')
}

// One serialized queue survives effect replacement: a stale native request may
// finish, but its successor cannot overlap it or publish its result.
export function createPlaylistDurationScanner(probe: PlaylistDurationProbe) {
  let tail: Promise<unknown> = Promise.resolve()
  return (entries: readonly PlaylistDurationEntry[], isCurrent: () => boolean): Promise<PlaylistDurationScanResult | null> => {
    const run = tail.then(async () => {
      if (!isCurrent()) return null
      const durationsByPath = new Map<string, number>()
      const itemFailures = new Map<string, { kind: 'unknown-duration' | 'probe-error'; error?: unknown }>()
      for (const entry of entries) {
        if (entry.available !== false && validDuration(entry.durationMs)) durationsByPath.set(entry.sourcePath, entry.durationMs)
      }
      const result: PlaylistDurationScanResult = { durationsByPath, itemFailures }
      const paths = [...new Set(entries.filter((entry) => entry.available !== false).map((entry) => entry.sourcePath))].filter((path) => !durationsByPath.has(path))
      for (let index = 0; index < paths.length; index += 16) {
        if (!isCurrent()) return null
        const batch = paths.slice(index, index + 16)
        let results: PlaylistDurationProbeItem[]
        try {
          results = await probe(batch)
        } catch (error) {
          return isCurrent() ? { ...result, commandFailure: {
            kind: error instanceof Error && error.name === 'PlaylistDurationProtocolError' ? 'protocol' as const : 'invoke' as const,
            message: failureMessage(error),
          } } : null
        }
        if (!isCurrent()) return null
        if (!Array.isArray(results) || results.length !== batch.length || results.some((item, at) => (
          !item || item.sourcePath !== batch[at] || (item.durationMs !== null && !validDuration(item.durationMs))
        ))) return { ...result, commandFailure: { kind: 'protocol' as const, message: 'Invalid playlist duration response' } }
        for (const item of results) {
          if (item.error != null) itemFailures.set(item.sourcePath, { kind: 'probe-error', error: item.error })
          else if (item.durationMs === null) itemFailures.set(item.sourcePath, { kind: 'unknown-duration' })
          else durationsByPath.set(item.sourcePath, item.durationMs)
        }
      }
      return result
    })
    tail = run.catch(() => undefined)
    return run
  }
}
