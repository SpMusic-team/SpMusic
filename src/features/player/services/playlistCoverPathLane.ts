import { markPlaylistCoverDecoded } from '../model/playlistCoverReadiness'
import type { PlaylistCoverImage } from '../model/playerUiViewModel'
import {
  audioThumbnailPathUrl,
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
 * The asset path lane for list covers.
 *
 * The backend answers with an absolute JPEG path, the WebView fetches it through
 * the asset protocol and decodes it natively, so no RGBA buffer crosses IPC and no
 * per-pixel BMP conversion runs on the JS main thread. The player's 1024/1536
 * artwork keeps the pixel lane; this module never touches it.
 *
 * ## Why this module owns the whole attempt
 *
 * The rolled-back implementation (`09cc450`) classified only the IPC call and
 * handed the image back to each caller, which then converted and decoded it on
 * its own. Two consequences broke the lane in production:
 *
 * 1. It recorded success at URL conversion, so a decode failure was counted as a
 *    healthy attempt and never fell back.
 * 2. Its cancellation parameter was a bare callback named `isAborted`, but every
 *    caller passed a *positive* predicate (`itemIsCurrent`, `current`). A fully
 *    successful result therefore reported "aborted" and was dropped, which is
 *    exactly the observed symptom: the command returned in ~3 ms, the JPEG and
 *    the asset URL were correct, and the card stayed at `loading`.
 *
 * The fix is structural rather than a renamed parameter: cancellation is a
 * documented named option (`isCurrent`: `true` means still valid), and one attempt
 * spans the whole chain — command → payload validation → `convertFileSrc` →
 * image construction → bounded predecode → currentness recheck — inside a single
 * classification, so "success" cannot be recorded before the image is usable.
 */

/**
 * Consecutive real failures after which the lane is disabled for the session.
 *
 * The path lane is the fast path; if it is systematically broken (command not
 * registered, protocol scope, disk publishing, decode), every list cover would pay
 * two requests before falling back. Disabling it degrades the session to exactly
 * the pre-rollout behaviour plus one failed request per cover.
 */
export const PATH_LANE_FAILURE_THRESHOLD = 8

/**
 * Bound for one image predecode.
 *
 * Deliberately independent of the backend's 2 s publish timeout: a path that has
 * been published can still fail to decode, and that failure must reach the
 * fallback decision instead of hanging the row's `finally` (and with it the
 * `coverActive` slot) for as long as the WebView feels like taking.
 */
export const PREDECODE_TIMEOUT_MS = 3000

let consecutiveFailures = 0
let disabled = false

/**
 * Diagnostics counters.
 *
 * Kept separate from the breaker on purpose: the breaker answers "may the lane be
 * attempted", these answer "what did it actually do". Reporting `pathFailures`
 * for a row that later recovered would be wrong, so the direct-failure count is
 * only incremented where an attempt is classified as `fallback`.
 */
export type PathLaneStats = Readonly<{
  /** Real failures charged to this lane (one per distinct attempt). */
  directFailures: number
  /** Attempts that reported `ready` after a real predecode. */
  prepared: number
  /** Times a caller had to enter the pixel lane because of this lane. */
  fallbacks: number
  /** Times a caller had to enter the pixel lane because the breaker was open. */
  fallbacksFromBreaker: number
  /** Presentation failures escalated once per attempt. */
  presentationFailures: number
}>

const stats: { -readonly [K in keyof PathLaneStats]: number } = {
  directFailures: 0, prepared: 0, fallbacks: 0, fallbacksFromBreaker: 0, presentationFailures: 0,
}

/** Read-only snapshot of the lane's diagnostics counters. */
export function pathLaneStats(): PathLaneStats {
  return { ...stats }
}

/**
 * Errors already charged to the breaker.
 *
 * Two consumers can share one native request: `playlistCoverScheduler` dedupes
 * jobs by lane and identity, then rejects each consumer of the failed job with the
 * *same* error value. Counting every consumer would let one broken channel close
 * the lane in four jobs instead of eight, so a failure is charged once per error
 * object. Distinct failures are distinct objects and are never collapsed.
 *
 * `let`, not `const`, only so the test seam can restore a clean ledger: `WeakSet`
 * has no `clear`, and a module-level const would leak one test's errors into the
 * next.
 */
let countedFailures: WeakSet<object> = new WeakSet()

/**
 * Attempts whose presentation failure was already charged.
 *
 * A path attempt can succeed here and still fail in the DOM afterwards. That is a
 * genuine failure of this lane, but it belongs to *one* attempt: several `<img>`
 * elements displaying the same prepared URL, a re-render, or a retried error event
 * must not each charge a strike. The set is bounded because attempts are
 * short-lived and an unbounded id set would be a leak, not a record.
 */
const countedAttempts = new Set<string>()
const COUNTED_ATTEMPT_LIMIT = 512

/**
 * Record a charge for one attempt, returning `false` when it was already charged.
 *
 * Bounded FIFO eviction: an attempt id evicted long after its row settled can be
 * charged once more, but only if 512 newer attempts have been published since,
 * which cannot happen while that presentation is still current.
 */
function chargeAttempt(attemptId: string): boolean {
  if (countedAttempts.has(attemptId)) return false
  countedAttempts.add(attemptId)
  if (countedAttempts.size > COUNTED_ATTEMPT_LIMIT) {
    const oldest = countedAttempts.values().next().value
    if (oldest !== undefined) countedAttempts.delete(oldest)
  }
  return true
}

let attemptSequence = 0

/** Whether the path lane may still be attempted in this session. */
export function pathLaneAvailable(): boolean {
  return !disabled
}

/** Clear the streak. Only a predecoded, still-current attempt counts as success. */
export function notePathLaneSuccess(): void {
  stats.prepared += 1
  // A late success cannot reopen a lane the breaker already closed; the rollback
  // is session-scoped and must not flap.
  if (disabled) return
  consecutiveFailures = 0
}

/** Record one real path-lane failure, tripping the breaker at the threshold. */
export function notePathLaneFailure(error?: unknown): void {
  if (disabled) return
  if (error !== null && typeof error === 'object') {
    if (countedFailures.has(error)) return
    countedFailures.add(error)
  }
  consecutiveFailures += 1
  stats.directFailures += 1
  if (consecutiveFailures >= PATH_LANE_FAILURE_THRESHOLD) disabled = true
}

/**
 * Charge a presentation (post-publish DOM) failure to one attempt, at most once.
 *
 * The caller passes the `attemptId` of the attempt whose URL the element failed
 * to display. Repeat reports for the same attempt — a second `<img>`, a re-render,
 * a retried event — are not new strikes, and a lane the breaker already closed is
 * never reopened by them either.
 */
export function notePathLanePresentationFailure(attemptId: string): void {
  if (disabled) return
  if (!chargeAttempt(attemptId)) return
  stats.presentationFailures += 1
  consecutiveFailures += 1
  if (consecutiveFailures >= PATH_LANE_FAILURE_THRESHOLD) disabled = true
}

/**
 * Options for exactly one path attempt.
 *
 * Named fields instead of positional callbacks is the point: a bare
 * `(value, predicate, mapper)` signature let a positive predicate land in a
 * parameter documented as negative, which is what broke the previous attempt.
 */
export type AttemptOptions = {
  priority: PlaylistCoverPriority
  signal?: AbortSignal
  /** `true` while the requesting row/job is still valid and may publish. */
  isCurrent: () => boolean
}

/** Why the pixel lane is now being used. Reported for diagnostics and tests. */
export type PathLaneFallbackReason = 'disabled' | 'command' | 'prepare' | 'decode' | 'timeout'

/**
 * The result of one complete path attempt.
 *
 * - `ready`   → the image is URL-converted, predecoded and still current. This is
 *               *not* a claim that the store or the DOM has been updated. The
 *               returned `attemptId` identifies this attempt for exactly one
 *               later presentation-failure charge.
 * - `missing` → the backend confirmed there is no artwork. Nothing to fall back to.
 * - `dropped` → superseded, cancelled or stale. Settle silently, never fall back.
 * - `fallback`→ a real failure, already counted; run the pixel lane once.
 */
export type PreparedPathOutcome =
  | { status: 'ready'; image: PlaylistCoverImage; attemptId: string }
  | { status: 'missing' }
  | { status: 'dropped' }
  | { status: 'fallback'; reason: PathLaneFallbackReason }

/**
 * Outcome to use when {@link pathLaneAvailable} is `false`.
 *
 * A tripped breaker means "do not attempt the lane", which is a decision to use
 * the pixel lane — not an absent verdict. Call sites must therefore keep reading
 * covers; substituting `missing` here would blank every list cover for the rest of
 * the session. It deliberately does not touch the failure counter: the breaker
 * already decided, and re-counting would be bookkeeping for a request never made.
 */
export const PATH_LANE_DISABLED: PreparedPathOutcome = { status: 'fallback', reason: 'disabled' }

function abandoned(options: AttemptOptions): boolean {
  return options.signal?.aborted === true || !options.isCurrent()
}

type PredecodeResult = { status: 'decoded' } | { status: 'aborted' } | { status: 'failed'; reason: 'decode' | 'timeout' }

/**
 * Decode one cover image before it is published, with an independent timeout.
 *
 * This is a local implementation instead of `decodePlaylistCover` because a path
 * attempt must be able to *stop* decoding and must not let a late completion mark
 * the image as ready. Racing the shared promise would leave the original decode
 * running and would still let it call `markPlaylistCoverDecoded`, so a timed-out
 * attempt could later be published as if it had decoded. Here every late event is
 * ignored by the `settled` flag, and the temporary element's `src` is cleared so
 * the pending fetch is dropped rather than merely ignored.
 */
function predecodeCoverImage(image: PlaylistCoverImage, options: AttemptOptions): Promise<PredecodeResult> {
  const element = new Image()
  element.decoding = 'async'
  return new Promise<PredecodeResult>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: PredecodeResult) => {
      if (settled) return
      settled = true
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      element.onload = null
      element.onerror = null
      options.signal?.removeEventListener('abort', onAbort)
      // Decoded-readiness is *not* recorded here on purpose: it is recorded by the
      // caller only once the attempt is known to be publishable. Marking it here
      // would let a decode that finishes after the row went stale mark an object
      // that will never be published.
      // Release the temporary element in every case, including success: the image
      // that will reach the DOM is a separate element and must load the URL
      // through its own decode. Dropping the `src` also cancels a decode that is
      // still in flight, so an abandoned attempt cannot keep a protocol request
      // alive in the background.
      element.removeAttribute('src')
      resolve(result)
    }
    const onAbort = () => finish({ status: 'aborted' })
    element.onload = () => {
      finish(element.complete && element.naturalWidth > 0
        ? { status: 'decoded' }
        : { status: 'failed', reason: 'decode' })
    }
    element.onerror = () => finish({ status: 'failed', reason: 'decode' })
    options.signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => finish({ status: 'failed', reason: 'timeout' }), PREDECODE_TIMEOUT_MS)
    element.src = image.src
    // A fully cached URL can report completion synchronously; the load event is
    // then redundant, and `element.onload` would never fire again.
    if (element.complete && element.naturalWidth > 0) finish({ status: 'decoded' })
  })
}

/**
 * Run one path attempt end to end and classify it exactly once.
 *
 * Keeping the classification here is what stops the fallback decision and the
 * breaker bookkeeping from drifting apart, and it is what makes the *complete*
 * chain — not just the IPC call — the unit of success:
 *
 * - `STALE_REQUEST`, an `AbortSignal` abort and `isCurrent() === false` are drops:
 *   no fallback, no counter change, no negative cache.
 * - a command error, an invalid payload (validated inside `audioCommands`), an
 *   unbuildable asset URL, a decode failure and a predecode timeout are real
 *   failures: counted once, and the caller runs the pixel lane once.
 * - `null` is a verdict, not a failure: it means the backend confirmed absence.
 *
 * The decoded `image` is the same object that was predecoded, because
 * `playlistCoverReadiness` records readiness in a `WeakSet` keyed by identity;
 * rebuilding the object here would silently lose that state.
 */
export async function runPreparedPathAttempt(
  call: () => Promise<AudioThumbnailPath | null>,
  options: AttemptOptions,
): Promise<PreparedPathOutcome> {
  // Nothing is scheduled for work that is already superseded.
  if (abandoned(options)) return { status: 'dropped' }

  let reference: AudioThumbnailPath | null
  try {
    reference = await call()
  } catch (error) {
    // A superseded request is a controlled abort, not a channel defect.
    if (isStaleCoverPixelsError(error)) return { status: 'dropped' }
    if (abandoned(options)) return { status: 'dropped' }
    notePathLaneFailure(error)
    return { status: 'fallback', reason: 'command' }
  }
  // The scheduler resolves `null` for a consumer it dropped, so currentness must
  // be decided *before* `null` is read as "confirmed no artwork".
  if (abandoned(options)) return { status: 'dropped' }
  if (reference === null) return { status: 'missing' }

  let image: PlaylistCoverImage
  try {
    const url = audioThumbnailPathUrl(reference)
    if (typeof url !== 'string' || !url) throw new Error('Asset URL for playlist thumbnail is empty')
    image = { src: url, width: reference.width, height: reference.height, encodedBytes: reference.byteLength }
  } catch {
    if (abandoned(options)) return { status: 'dropped' }
    notePathLaneFailure()
    return { status: 'fallback', reason: 'prepare' }
  }

  const predecode = await predecodeCoverImage(image, options)
  if (predecode.status === 'aborted' || abandoned(options)) return { status: 'dropped' }
  if (predecode.status === 'failed') {
    notePathLaneFailure()
    return { status: 'fallback', reason: predecode.reason }
  }
  // Readiness is recorded only now: the decode succeeded *and* the row is still
  // current, so this object is the one that will be published. Recording it inside
  // the predecode would let a late completion mark an object that is discarded.
  markPlaylistCoverDecoded(image)
  // Success is recorded only now, on a decoded payload of a still-current job.
  notePathLaneSuccess()
  attemptSequence += 1
  return { status: 'ready', image, attemptId: `attempt-${attemptSequence}` }
}

/**
 * Path-lane counterparts of `scheduleTrackThumbnail` / `scheduleFolderThumbnail` /
 * `schedulePlaylistCoverPixels`.
 *
 * Same queue, same `MAX_CONCURRENT`, same priority ordering — only the payload
 * differs. They are the fast path, not a fallback: callers try these first and
 * reach the pixel lanes only after an attempt reports `fallback`.
 */
export function scheduleTrackThumbnailPath(
  input: AudioLoadTrackThumbnailPathInput,
  options: AttemptOptions,
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
  options: AttemptOptions,
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
  options: AttemptOptions,
): Promise<AudioThumbnailPath | null> {
  return scheduleLaneJob(
    'path', 'cover',
    { clientId: input.clientId, windowGeneration: input.windowGeneration, source: [input.filePath], maxEdge: input.maxEdge },
    () => loadAudioPlaylistCoverThumbnailPath(input),
    options,
  )
}

/** One complete track-thumbnail attempt through the asset path lane. */
export function attemptTrackThumbnailPath(
  input: AudioLoadTrackThumbnailPathInput,
  options: AttemptOptions,
): Promise<PreparedPathOutcome> {
  return enterPixelLaneOnFailure(
    () => pathLaneAvailable() ? runPreparedPathAttempt(() => scheduleTrackThumbnailPath(input, options), options) : Promise.resolve(PATH_LANE_DISABLED),
  )
}

/** One complete folder-thumbnail attempt through the asset path lane. */
export function attemptFolderThumbnailPath(
  input: AudioLoadFolderThumbnailPathInput,
  options: AttemptOptions,
): Promise<PreparedPathOutcome> {
  return enterPixelLaneOnFailure(
    () => pathLaneAvailable() ? runPreparedPathAttempt(() => scheduleFolderThumbnailPath(input, options), options) : Promise.resolve(PATH_LANE_DISABLED),
  )
}

/** One complete playlist-cover attempt through the asset path lane. */
export function attemptPlaylistCoverThumbnailPath(
  input: AudioLoadPlaylistCoverThumbnailPathInput,
  options: AttemptOptions,
): Promise<PreparedPathOutcome> {
  return enterPixelLaneOnFailure(
    () => pathLaneAvailable() ? runPreparedPathAttempt(() => schedulePlaylistCoverThumbnailPath(input, options), options) : Promise.resolve(PATH_LANE_DISABLED),
  )
}

/**
 * Count the *decision* to use the pixel lane, not the failure that caused it.
 *
 * The distinction matters for diagnostics: a tripped breaker produces one entry
 * per cover without paying for a request, so counting it as a request failure
 * would report channel defects that were never observed.
 */
function enterPixelLaneOnFailure(run: () => Promise<PreparedPathOutcome>): Promise<PreparedPathOutcome> {
  return run().then((outcome) => {
    if (outcome.status !== 'fallback') return outcome
    if (outcome.reason === 'disabled') stats.fallbacksFromBreaker += 1
    else stats.fallbacks += 1
    return outcome
  })
}

/** Test seam: restore the initial session state. */
export function resetPathLaneForTest(): void {
  consecutiveFailures = 0
  disabled = false
  attemptSequence = 0
  countedAttempts.clear()
  countedFailures = new WeakSet()
  for (const key of Object.keys(stats) as Array<keyof PathLaneStats>) stats[key] = 0
}

