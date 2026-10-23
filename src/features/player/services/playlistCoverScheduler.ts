import {
  loadAudioPlaylistCoverPixels,
  loadAudioTrackThumbnail,
  type AudioCoverPixels,
  type AudioLoadPlaylistCoverPixelsInput,
  type AudioLoadTrackThumbnailInput,
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
  input: AudioLoadPlaylistCoverPixelsInput | AudioLoadTrackThumbnailInput
  trackThumbnail: boolean
  priority: PlaylistCoverPriority
  sequence: number
  consumers: Set<Consumer>
  active: boolean
}

const pending: Job[] = []
const jobs = new Map<string, Job>()
let active = false
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
  active = false
  pump()
}

function pump() {
  if (active) return
  pending.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence)
  while (pending.length) {
    const job = pending.shift()!
    if (!currentConsumers(job).length) {
      if (jobs.get(job.key) === job) jobs.delete(job.key)
      continue
    }
    active = true
    job.active = true
    const load = job.trackThumbnail
      ? loadAudioTrackThumbnail(job.input as AudioLoadTrackThumbnailInput)
      : loadAudioPlaylistCoverPixels(job.input as AudioLoadPlaylistCoverPixelsInput)
    void load.then(
      (pixels) => finish(job, pixels),
      (error: unknown) => finish(job, undefined, error),
    )
    return
  }
}

/** Admit one native thumbnail invoke at a time. Callers retain URL and cache ownership. */
export function schedulePlaylistCoverPixels(
  input: AudioLoadPlaylistCoverPixelsInput,
  options: { priority: PlaylistCoverPriority; signal?: AbortSignal; isCurrent?: () => boolean },
): Promise<AudioCoverPixels | null> {
  return scheduleCoverPixels(input, false, options)
}

/** Use the persisted song thumbnail lane for 128/256 pixel list artwork. */
export function scheduleTrackThumbnail(
  input: AudioLoadTrackThumbnailInput,
  options: { priority: PlaylistCoverPriority; signal?: AbortSignal; isCurrent?: () => boolean },
): Promise<AudioCoverPixels | null> {
  return scheduleCoverPixels(input, true, options)
}

function scheduleCoverPixels(
  input: AudioLoadPlaylistCoverPixelsInput | AudioLoadTrackThumbnailInput,
  trackThumbnail: boolean,
  options: { priority: PlaylistCoverPriority; signal?: AbortSignal; isCurrent?: () => boolean },
): Promise<AudioCoverPixels | null> {
  if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) return Promise.resolve(null)
  const key = `${trackThumbnail ? 'track' : 'cover'}\0${input.clientId}\0${input.windowGeneration}\0${trackThumbnail ? (input as AudioLoadTrackThumbnailInput).sourcePath : (input as AudioLoadPlaylistCoverPixelsInput).filePath}\0${input.maxEdge}`
  let job = jobs.get(key)
  if (!job) {
    job = { key, input, trackThumbnail, priority: options.priority, sequence: sequence++, consumers: new Set(), active: false }
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
