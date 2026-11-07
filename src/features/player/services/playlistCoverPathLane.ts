import {
  isStaleCoverPixelsError,
  loadAudioFolderThumbnailPath,
  loadAudioPlaylistCoverThumbnailPath,
  loadAudioTrackThumbnailPath,
  type AudioLoadFolderThumbnailPathInput,
  type AudioLoadPlaylistCoverThumbnailPathInput,
  type AudioLoadTrackThumbnailPathInput,
  type AudioThumbnailPath,
} from './audioCommands'
import { scheduleLaneJob, type PlaylistCoverPriority } from './playlistCoverScheduler'

/**
 * Circuit breaker for the list-cover asset path lane.
 *
 * The path lane is the fast path: the backend answers with an absolute JPEG path
 * and the WebView fetches and decodes it through the asset protocol. If that
 * channel is systematically broken (command not registered, protocol scope, disk
 * publishing), every list cover would pay two invokes before falling back. After
 * {@link PATH_LANE_FAILURE_THRESHOLD} consecutive real failures this module turns
 * the lane off for the rest of the session, so the worst case degrades to exactly
 * the pre-rollout behaviour plus one failed invoke per cover.
 *
 * Deliberately session-scoped and in-memory:
 *
 * - No `localStorage`, no user setting, no persistence. The rollback conditions
 *   are "switch branch and rebuild" and "restart and retry", both of which reset
 *   this module anyway. Persisting the state would keep a transient startup
 *   failure latched across restarts.
 * - Only *consecutive* failures count. A single success clears the streak, so a
 *   long-running session cannot slowly accumulate its way to a shutdown.
 *
 * Not counted as failures: `STALE_REQUEST` (a controlled abort of a superseded
 * request), a confirmed missing cover (`null`), and `AbortSignal` cancellation.
 * Counting them would shut the lane down for reasons that say nothing about the
 * channel's health.
 */
export const PATH_LANE_FAILURE_THRESHOLD = 8

let consecutiveFailures = 0
let disabled = false

/** Whether the path lane may still be attempted in this session. */
export function pathLaneAvailable(): boolean {
  return !disabled
}

/** Clear the streak. Recorded for every successful path-lane payload. */
export function notePathLaneSuccess(): void {
  consecutiveFailures = 0
}

/** Record one real path-lane failure, tripping the breaker at the threshold. */
export function notePathLaneFailure(): void {
  if (disabled) return
  consecutiveFailures += 1
  if (consecutiveFailures >= PATH_LANE_FAILURE_THRESHOLD) disabled = true
}

type PathScheduleOptions = { priority: PlaylistCoverPriority; signal?: AbortSignal; isCurrent?: () => boolean }

/**
 * Path-lane counterparts of `scheduleTrackThumbnail` / `scheduleFolderThumbnail` /
 * `schedulePlaylistCoverPixels`.
 *
 * Same queue, same `MAX_CONCURRENT`, same priority ordering — only the payload
 * differs. They are the fast path, not a fallback: callers try these first and
 * reach the pixel lanes only after {@link runPathLaneCall} reports `fallback`.
 */
export function scheduleTrackThumbnailPath(
  input: AudioLoadTrackThumbnailPathInput,
  options: PathScheduleOptions,
): Promise<AudioThumbnailPath | null> {
  return scheduleLaneJob(
    'path', 'track',
    { clientId: input.clientId, windowGeneration: input.windowGeneration, source: [input.sourcePath], maxEdge: input.maxEdge },
    () => loadAudioTrackThumbnailPath(input),
    options,
  )
}

export function scheduleFolderThumbnailPath(
  input: AudioLoadFolderThumbnailPathInput,
  options: PathScheduleOptions,
): Promise<AudioThumbnailPath | null> {
  return scheduleLaneJob(
    'path', 'folder',
    { clientId: input.clientId, windowGeneration: input.windowGeneration, source: [input.rootPath, input.directoryPath], maxEdge: input.maxEdge },
    () => loadAudioFolderThumbnailPath(input),
    options,
  )
}

export function schedulePlaylistCoverThumbnailPath(
  input: AudioLoadPlaylistCoverThumbnailPathInput,
  options: PathScheduleOptions,
): Promise<AudioThumbnailPath | null> {
  return scheduleLaneJob(
    'path', 'cover',
    { clientId: input.clientId, windowGeneration: input.windowGeneration, source: [input.filePath], maxEdge: input.maxEdge },
    () => loadAudioPlaylistCoverThumbnailPath(input),
    options,
  )
}

/**
 * The outcome of one path-lane attempt, already reduced to the only thing a call
 * site may act on:
 *
 * - `use`      → build the image from the asset URL, do not fall back
 * - `missing`  → confirmed absence, render the placeholder, do not fall back
 * - `dropped`  → superseded or cancelled, settle silently, do not fall back
 * - `fallback` → pixel lane now; the failure has already been counted
 */
export type PathLaneOutcome<T> =
  | { status: 'use'; value: T }
  | { status: 'missing' }
  | { status: 'dropped' }
  | { status: 'fallback' }

/**
 * The outcome to use when {@link pathLaneAvailable} is `false`.
 *
 * A tripped breaker means "do not attempt the lane", which is a decision to use
 * the pixel lane — not an absent verdict. Call sites must branch on
 * `PATH_LANE_DISABLED` rather than skipping the whole cover read, which would
 * leave every list cover blank for the rest of the session. It deliberately does
 * not touch the failure counter: the breaker already decided, and re-counting
 * would be bookkeeping for a request that was never made.
 */
export const PATH_LANE_DISABLED: PathLaneOutcome<never> = { status: 'fallback' }

/**
 * Run one path-lane call and classify it exactly once.
 *
 * Keeping the classification here is the point: the fallback decision and the
 * breaker bookkeeping cannot drift apart at an individual call site, and a call
 * site cannot accidentally count `null` or a stale request as a failure.
 *
 * `/` `isAborted` is consulted on rejection so an `AbortSignal` abort is dropped
 * rather than counted; this module cannot observe a caller's signal itself.
 * `/` `toUrl` converts the payload to an `img src`; a throw there is treated as a
 * lane failure, defensively, because an asset URL that cannot be built must not
 * surface as a permanently blank cover.
 */
export async function runPathLaneCall<T extends object, R>(
  call: () => Promise<T | null>,
  isAborted: () => boolean,
  toUrl: (value: T) => R,
): Promise<PathLaneOutcome<{ reference: T; url: R }>> {
  let value: T | null
  try {
    value = await call()
  } catch (error) {
    // A superseded request is a controlled abort, not a channel defect.
    if (isStaleCoverPixelsError(error)) return { status: 'dropped' }
    if (isAborted()) return { status: 'dropped' }
    notePathLaneFailure()
    return { status: 'fallback' }
  }
  // `null` is a verdict, not a failure: falling back would spend a full decode to
  // re-learn what the backend already proved.
  if (value === null) return { status: 'missing' }
  if (isAborted()) return { status: 'dropped' }
  try {
    const url = toUrl(value)
    notePathLaneSuccess()
    return { status: 'use', value: { reference: value, url } }
  } catch {
    notePathLaneFailure()
    return { status: 'fallback' }
  }
}

/** Test seam: restore the initial session state. */
export function resetPathLaneForTest(): void {
  consecutiveFailures = 0
  disabled = false
}
