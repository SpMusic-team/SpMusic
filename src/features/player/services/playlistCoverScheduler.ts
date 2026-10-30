import {
  loadAudioPlaylistCoverPixels,
  loadAudioTrackThumbnail,
  loadAudioFolderThumbnail,
  type AudioCoverPixels,
  type AudioLoadPlaylistCoverPixelsInput,
  type AudioLoadTrackThumbnailInput,
  type AudioLoadFolderThumbnailInput,
} from './audioCommands'

export type PlaylistCoverPriority = 0 | 1 | 2

type Consumer = {
  signal?: AbortSignal
  isCurrent?: () => boolean
  resolve: (pixels: AudioCoverPixels | null) => void
  reject: (error: unknown) => void
  abort: () => void
}

type Job = {
  key: string
  input: AudioLoadPlaylistCoverPixelsInput | AudioLoadTrackThumbnailInput | AudioLoadFolderThumbnailInput
  kind: 'cover' | 'track' | 'folder'
  priority: PlaylistCoverPriority
  sequence: number
  consumers: Set<Consumer>
  active: boolean
}

/**
 * Ceiling for concurrent native cover-pixel invokes.
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
 * This module owns the bound for both lanes (`scheduleTrackThumbnail` and
 * `schedulePlaylistCoverPixels`); the hooks keep their own per-consumer limits.
 */
export const MAX_CONCURRENT = 4

const pending: Job[] = []
const jobs = new Map<string, Job>()
let activeCount = 0
let sequence = 0

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

function finish(job: Job, pixels?: AudioCoverPixels | null, error?: unknown) {
  if (jobs.get(job.key) === job) jobs.delete(job.key)
  for (const consumer of currentConsumers(job)) {
    consumer.signal?.removeEventListener('abort', consumer.abort)
    job.consumers.delete(consumer)
    if (error === undefined) consumer.resolve(pixels ?? null)
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
    const load = job.kind === 'folder'
      ? loadAudioFolderThumbnail(job.input as AudioLoadFolderThumbnailInput)
      : job.kind === 'track' ? loadAudioTrackThumbnail(job.input as AudioLoadTrackThumbnailInput)
        : loadAudioPlaylistCoverPixels(job.input as AudioLoadPlaylistCoverPixelsInput)
    void load.then(
      (pixels) => finish(job, pixels),
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
  options: { priority: PlaylistCoverPriority; signal?: AbortSignal; isCurrent?: () => boolean },
): Promise<AudioCoverPixels | null> {
  return scheduleCoverPixels(input, 'cover', options)
}

/** Use the persisted song thumbnail lane for 128/256 pixel list artwork. */
export function scheduleTrackThumbnail(
  input: AudioLoadTrackThumbnailInput,
  options: { priority: PlaylistCoverPriority; signal?: AbortSignal; isCurrent?: () => boolean },
): Promise<AudioCoverPixels | null> {
  return scheduleCoverPixels(input, 'track', options)
}

/** Resolve folder artwork in the same bounded native queue as song covers. */
export function scheduleFolderThumbnail(
  input: AudioLoadFolderThumbnailInput,
  options: { priority: PlaylistCoverPriority; signal?: AbortSignal; isCurrent?: () => boolean },
): Promise<AudioCoverPixels | null> {
  return scheduleCoverPixels(input, 'folder', options)
}

function scheduleCoverPixels(
  input: AudioLoadPlaylistCoverPixelsInput | AudioLoadTrackThumbnailInput | AudioLoadFolderThumbnailInput,
  kind: Job['kind'],
  options: { priority: PlaylistCoverPriority; signal?: AbortSignal; isCurrent?: () => boolean },
): Promise<AudioCoverPixels | null> {
  if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) return Promise.resolve(null)
  const source = kind === 'folder'
    ? [(input as AudioLoadFolderThumbnailInput).rootPath, (input as AudioLoadFolderThumbnailInput).directoryPath]
    : [kind === 'track' ? (input as AudioLoadTrackThumbnailInput).sourcePath : (input as AudioLoadPlaylistCoverPixelsInput).filePath]
  const key = JSON.stringify([kind, input.clientId, input.windowGeneration, ...source, input.maxEdge])
  let job = jobs.get(key)
  if (!job) {
    job = { key, input, kind, priority: options.priority, sequence: sequence++, consumers: new Set(), active: false }
    jobs.set(key, job)
    pending.push(job)
  } else if (options.priority < job.priority) {
    job.priority = options.priority
  }
  const queuedJob = job
  const promise = new Promise<AudioCoverPixels | null>((resolve, reject) => {
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
  return promise
}
