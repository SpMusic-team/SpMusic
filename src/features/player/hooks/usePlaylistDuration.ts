import { useEffect, useEffectEvent, useState } from 'react'
import { createPlaylistDurationScanner, resolvePlaylistDuration, type PlaylistDurationResult, type PlaylistDurationScanResult } from '@/features/player/model/playlistDuration'
import { probeAudioPlaylistDurations } from '@/features/player/services/audioCommands'

const scanDuration = createPlaylistDurationScanner(probeAudioPlaylistDurations)
type DurationSource = { sourcePath: string; available?: boolean }

export function usePlaylistDuration(sources: readonly DurationSource[], scope: string, knownDurations: ReadonlyMap<string, number>): PlaylistDurationResult {
  const [completed, setCompleted] = useState<{ sources: readonly DurationSource[]; scope: string; result: PlaylistDurationScanResult } | null>(null)
  const readKnownDurations = useEffectEvent(() => knownDurations)
  useEffect(() => {
    let current = true
    const known = readKnownDurations()
    const entries = sources.map(({ sourcePath, available }) => ({ sourcePath, available, durationMs: known.get(sourcePath) }))
    void scanDuration(entries, () => current).then((result) => {
      if (current && result) setCompleted({ sources, scope, result })
    })
    return () => { current = false }
  }, [sources, scope])
  // Newly hydrated truthful metadata can complete an unknown total without
  // restarting native work. A failed probe is never retried in a render loop.
  const scanResult = completed?.sources === sources && completed.scope === scope ? completed.result : undefined
  return resolvePlaylistDuration(sources, knownDurations, scanResult, !scanResult)
}
