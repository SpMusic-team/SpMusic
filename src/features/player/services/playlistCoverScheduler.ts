import {
  loadAudioPlaylistCoverPixels,
  loadAudioTrackThumbnail,
  loadAudioFolderThumbnail,
} from './audioCommands'
// Type-only, so it is erased and leaves the single substitutable native-command
// import above as this module's only runtime boundary.
import type {
  AudioCoverPixels,
  AudioLoadPlaylistCoverPixelsInput,
  AudioLoadTrackThumbnailInput,
  AudioLoadFolderThumbnailInput,
} from './audioCommands'

export type PlaylistCoverPriority = 0 | 1 | 2

/**
 * Which list-cover channel a job belongs to.
 *
 * The lane is part of a job's identity, not a detail of it: the same source and
 * `maxEdge` read through both lanes produces two different payloads (RGBA pixels
 * vs. an asset path). Without the lane in the dedupe key a fallback request would
 * be absorbed by the still-running path request for the same source and resolve
 * with the wrong payload type.
 */
export type PlaylistCoverLane = 'pixels' | 'path'

export type LaneJobKind = 'cover' | 'track' | 'folder'

type Consumer = {
  signal?: AbortSignal
  isCurrent?: () => boolean
  resolve: (payload: unknown | null) => void
  reject: (error: unknown) => void
  abort: () => void
}

type Job = {
  key: string
  load: () => Promise<unknown | null>
  priority: PlaylistCoverPriority
  sequence: number
  consumers: Set<Consumer>
  active: boolean
}

/** Identity a job is deduplicated by, excluding the lane that requested it. */
export type LaneJobIdentity = {
  clientId: string
  windowGeneration: number
  /** `[rootPath, directoryPath]` for folders, `[sourcePath|filePath]` otherwise. */
  source: (string | undefined)[]
  maxEdge: number
}

type LaneScheduleOptions = { priority: PlaylistCoverPriority; signal?: AbortSignal; isCurrent?: () => boolean }

/**
 * Ceiling for concurrent native cover invokes.
 *
 * Cover work is a mixed IO + CPU load, so the width is chosen to match what the
 * backend can actually execute rather than to fill the renderer's queue:
 *
 * - `src-tauri/src/audio/cover_pixels.rs` admits `available_parallelism() / 4`
 *   decode workers, floored at one and capped by `MAX_PLAYLIST_DECODE_PERMITS`
 *   (4). Offering more than four concurrent requests cannot start more decodes;
 *   it only deepens the backend queue, which delays the priority-0 current-track
 *   work that the ordering below is supposed to accelerate.
 * - One decode already saturates a core during the Lanczos3 reduction of a large
 *   cover, so four in-flight requests keep every decode slot busy without
 *   oversubscribing small machines.
 * - Resident artwork memory is bounded independently by the byte budgets inside
 *   `useLibraryArtwork` and `useAllSongsWindow`, so the width does not change
 *   steady-state memory; only the transient in-flight pixel buffers multiply
 *   (at most 4 x 512 x 512 x 4 bytes = 4 MiB).
 *
 * This module owns the bound for every lane (`scheduleTrackThumbnail`,
 * `schedulePlaylistCoverPixels`, and the asset path entries), and the hooks keep
 * their own per-consumer limits. The path lane is admitted from this same queue on
 * purpose: an asset request still triggers the backend's decode + Lanczos3 + JPEG
 * encode on a cold cache, so it costs the same permits as a pixel request.
 */
export const MAX_CONCURRENT = 4

const pending: Job[] = []
const jobs = new Map<string, Job>()
let activeCount = 0
let sequence = 0

/**
 * Dedupe key of one lane request.
 *
 * The lane leads the key on purpose: it is part of a job's identity, not a detail
 * of it. The same source and `maxEdge` read through both lanes produces two
 * different payloads (RGBA pixels vs. an asset path), so without it a fallback
 * request would be absorbed by the still-running path request for the same source
 * and would resolve with the wrong payload type.
 */
function laneJobKey(lane: PlaylistCoverLane, kind: LaneJobKind, identity: LaneJobIdentity): string {
  return JSON.stringify([lane, kind, identity.clientId, identity.windowGeneration, ...identity.source, identity.maxEdge])
}

function currentConsumers(job: Job): Consumer[] {
  for (const consumer of job.consumers) {
    if (consumer.signal?.aborted || (consumer.isCurrent && !consumer.isCurrent())) {
      consumer.signal?.removeEventListener('abort', consumer.abort)
      job.consumers.delete(consumer)
      consumer.resolve(null)
    }
  }
  return [...job.consumers]
}

function finish(job: Job, payload?: unknown | null, error?: unknown) {
  if (jobs.get(job.key) === job) jobs.delete(job.key)
  for (const consumer of currentConsumers(job)) {
    consumer.signal?.removeEventListener('abort', consumer.abort)
    job.consumers.delete(consumer)
    if (error === undefined) consumer.resolve(payload ?? null)
    else consumer.reject(error)
  }
  // Decrement before pumping: this job no longer occupies a slot, so its
  // successor may be admitted in the same turn that published this result.
  activeCount -= 1
  pump()
}

function pump() {
  // Refill the free slots in priority order. The waiter list is re-sorted on
  // every call, so a freshly scheduled priority-0 job can overtake jobs already
  // waiting at priority 1 or 2 as soon as any slot frees up.
  pending.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence)
  while (activeCount < MAX_CONCURRENT && pending.length) {
    const job = pending.shift()!
    if (!currentConsumers(job).length) {
      if (jobs.get(job.key) === job) jobs.delete(job.key)
      continue
    }
    activeCount += 1
    job.active = true
    void job.load().then(
      (payload) => finish(job, payload),
      (error: unknown) => finish(job, undefined, error),
    )
  }
}

/**
 * Admit up to {@link MAX_CONCURRENT} native cover invokes at once.
 * Callers retain URL and cache ownership.
 */
export function schedulePlaylistCoverPixels(
  input: AudioLoadPlaylistCoverPixelsInput,
  options: LaneScheduleOptions,
): Promise<AudioCoverPixels | null> {
  return scheduleLaneJob(
    'pixels', 'cover',
    { clientId: input.clientId, windowGeneration: input.windowGeneration, source: [input.filePath], maxEdge: input.maxEdge },
    () => loadAudioPlaylistCoverPixels(input),
    options,
  )
}

/** Use the persisted song thumbnail lane for 128/256 pixel list artwork. */
export function scheduleTrackThumbnail(
  input: AudioLoadTrackThumbnailInput,
  options: LaneScheduleOptions,
): Promise<AudioCoverPixels | null> {
  return scheduleLaneJob(
    'pixels', 'track',
    { clientId: input.clientId, windowGeneration: input.windowGeneration, source: [input.sourcePath], maxEdge: input.maxEdge },
    () => loadAudioTrackThumbnail(input),
    options,
  )
}

/** Resolve folder artwork in the same bounded native queue as song covers. */
export function scheduleFolderThumbnail(
  input: AudioLoadFolderThumbnailInput,
  options: LaneScheduleOptions,
): Promise<AudioCoverPixels | null> {
  return scheduleLaneJob(
    'pixels', 'folder',
    { clientId: input.clientId, windowGeneration: input.windowGeneration, source: [input.rootPath, input.directoryPath], maxEdge: input.maxEdge },
    () => loadAudioFolderThumbnail(input),
    options,
  )
}

/**
 * Admit one request on either lane through the shared pool.
 *
 * Exported for the asset path lane (`playlistCoverPathLane.ts`), which owns the
 * path commands and the circuit breaker. Keeping the queue here and the loaders
 * there is deliberate: this module has exactly one substitutable native-command
 * import, which is what lets the scheduler's own unit test observe admission
 * without a native backend.
 */
export function scheduleLaneJob<T>(
  lane: PlaylistCoverLane,
  kind: LaneJobKind,
  identity: LaneJobIdentity,
  load: () => Promise<T | null>,
  options: LaneScheduleOptions,
): Promise<T | null> {
  if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) return Promise.resolve(null)
  const key = laneJobKey(lane, kind, identity)
  let job = jobs.get(key)
  if (!job) {
    job = { key, load, priority: options.priority, sequence: sequence++, consumers: new Set(), active: false }
    jobs.set(key, job)
    pending.push(job)
  } else if (options.priority < job.priority) {
    job.priority = options.priority
  }
  const queuedJob = job
  const promise = new Promise<unknown | null>((resolve, reject) => {
    const consumer: Consumer = {
      signal: options.signal,
      isCurrent: options.isCurrent,
      resolve,
      reject,
      abort: () => {
        queuedJob.consumers.delete(consumer)
        resolve(null)
        if (!queuedJob.active && !queuedJob.consumers.size) {
          const index = pending.indexOf(queuedJob)
          if (index >= 0) pending.splice(index, 1)
          if (jobs.get(queuedJob.key) === queuedJob) jobs.delete(queuedJob.key)
        }
      },
    }
    queuedJob.consumers.add(consumer)
    options.signal?.addEventListener('abort', consumer.abort, { once: true })
  })
  pump()
  return promise as Promise<T | null>
}
