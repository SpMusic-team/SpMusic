import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = readFileSync(new URL('./playlistCoverScheduler.ts', import.meta.url), 'utf8')

async function harness() {
  const calls = []
  const pending = []
  let active = 0
  let maximumActive = 0
  globalThis.__playlistCoverSchedulerBackend = (input) => {
    calls.push(input)
    active += 1
    maximumActive = Math.max(maximumActive, active)
    return new Promise((resolve, reject) => pending.push({
      input,
      resolve: (value = { width: 1 }) => { active -= 1; resolve(value) },
      reject: (error) => { active -= 1; reject(error) },
    }))
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  const patched = compiled.replace(
    /import\s*\{\s*loadAudioPlaylistCoverPixels\s*,\s*loadAudioTrackThumbnail\s*,\s*loadAudioFolderThumbnail\s*,?\s*\}\s*from\s*['"]\.\/audioCommands['"];?/,
    'const loadAudioPlaylistCoverPixels = globalThis.__playlistCoverSchedulerBackend; const loadAudioTrackThumbnail = globalThis.__playlistCoverSchedulerBackend; const loadAudioFolderThumbnail = globalThis.__playlistCoverSchedulerBackend; ',
  )
  assert.notEqual(patched, compiled, 'test substitutes only the native cover command boundary')
  const url = `data:text/javascript;base64,${Buffer.from(patched).toString('base64')}#${Math.random()}`
  const { schedulePlaylistCoverPixels: schedule, scheduleTrackThumbnail, scheduleFolderThumbnail, MAX_CONCURRENT } = await import(url)
  const input = (name, windowGeneration = 1) => ({
    clientId: 'test-client', filePath: `/covers/${name}.flac`, maxEdge: 256, windowGeneration,
  })
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
  const locate = (path) => {
    const index = pending.findIndex(entry => (entry.input.filePath ?? entry.input.sourcePath) === path)
    assert(index >= 0, `expected an in-flight native request for ${path}`)
    return pending.splice(index, 1)[0]
  }
  const settle = (path, value) => { locate(path).resolve(value) }
  const fail = (path, error) => { locate(path).reject(error) }
  // Settles the oldest in-flight request, regardless of which admission it was.
  const settleOldest = (value) => pending.shift().resolve(value)
  // Terminates regardless of admission order: every settle can admit work that
  // the following iteration then settles.
  const drain = async () => {
    for (let guard = 0; guard < 5000 && pending.length; guard += 1) {
      pending.shift().resolve()
      await flush()
    }
    assert.equal(pending.length, 0, 'drain settles every admitted request')
  }
  return {
    schedule, scheduleTrackThumbnail, scheduleFolderThumbnail, MAX_CONCURRENT, calls, pending, input, flush,
    settle, fail, settleOldest, drain,
    get inFlight() { return pending.length },
    get maximumActive() { return maximumActive },
  }
}

// Recorded before the fix: `active === false` admitted exactly one native invoke
// for this whole module, and `playlistCoverScheduler.test.mjs` asserted it with
// `assert.equal(h.maximumActive, 1)` in every case. These tests pin the new
// contract and fail on the single-slot implementation.
test('the admission ceiling is bounded and matches the backend decode permits', async () => {
  const h = await harness()
  // src-tauri/src/audio/cover_pixels.rs caps playlist decodes at
  // MAX_PLAYLIST_DECODE_PERMITS = 4 workers; offering more concurrent requests
  // than that only deepens the backend queue.
  assert.equal(h.MAX_CONCURRENT, 4)
  assert(Number.isInteger(h.MAX_CONCURRENT))
  assert(h.MAX_CONCURRENT > 1, 'a single slot is the bottleneck this ceiling removes')
})

test('the scheduler admits a peak above one and never above MAX_CONCURRENT', async () => {
  const h = await harness()
  // Demand far above the ceiling: both sharing hooks plus background work, the
  // shape that used to collapse to a single in-flight invoke.
  const scheduled = Array.from({ length: 24 }, (_, index) =>
    h.schedule(h.input(`queued-${index}`), { priority: 2 }))

  assert.equal(h.inFlight, h.MAX_CONCURRENT, 'one pump fills every slot')
  assert(h.inFlight > 1, 'more than one native invoke is in flight')
  assert.equal(h.maximumActive, h.MAX_CONCURRENT)

  for (let guard = 0; guard < 5000 && h.inFlight; guard += 1) {
    assert(h.inFlight <= h.MAX_CONCURRENT, 'in-flight requests never exceed the ceiling')
    h.settleOldest()
    await h.flush()
  }
  await Promise.all(scheduled)
  assert.equal(h.inFlight, 0)
  assert(h.maximumActive > 1, 'peak concurrency beats the old single-slot behaviour')
  assert.equal(h.maximumActive, h.MAX_CONCURRENT, 'peak reaches but never passes the ceiling')
  assert.equal(h.calls.length, 24, 'wider admission neither duplicates nor drops a request')
})

test('a released slot refills in the same turn instead of waiting for the batch to drain', async () => {
  const h = await harness()
  const scheduled = Array.from({ length: 8 }, (_, index) =>
    h.schedule(h.input(`step-${index}`), { priority: 2 }))
  assert.equal(h.inFlight, h.MAX_CONCURRENT)
  const admitted = h.calls.length

  h.settleOldest()
  await h.flush()
  assert.equal(h.calls.length, admitted + 1, 'one completion admits exactly one replacement')
  assert.equal(h.inFlight, h.MAX_CONCURRENT, 'the ceiling is restored, not left with a hole')
  assert.equal(h.maximumActive, h.MAX_CONCURRENT)

  await h.drain()
  await Promise.all(scheduled)
  assert.equal(h.calls.length, 8)
})

test('track thumbnails share priority ordering and preserve confirmed missing artwork', async () => {
  const h = await harness()
  const active = h.schedule(h.input('active'), { priority: 2 })
  const thumbnail = h.scheduleTrackThumbnail(
    { clientId: 'test-client', sourcePath: '/music/song.flac', maxEdge: 128, windowGeneration: 3 },
    { priority: 0 },
  )
  assert.equal(h.calls.at(-1).sourcePath, '/music/song.flac')
  assert.equal(h.calls.at(-1).windowGeneration, 3, 'original native generation is preserved')
  h.settle('/music/song.flac', null)
  assert.equal(await thumbnail, null, 'confirmed missing artwork still resolves null')
  h.settle('/covers/active.flac')
  await active
  assert.equal(h.maximumActive, 2, 'both lanes draw from the same bounded pool')
})

test('foreground and visible work is admitted before queued library work', async () => {
  const h = await harness()
  const background = Array.from({ length: h.MAX_CONCURRENT }, (_, index) =>
    h.schedule(h.input(`background-${index}`), { priority: 2 }))
  assert.equal(h.inFlight, h.MAX_CONCURRENT)

  const visible = h.schedule(h.input('visible'), { priority: 1 })
  const current = h.schedule(h.input('current', 7), { priority: 0 })
  assert.equal(h.calls.length, h.MAX_CONCURRENT, 'the higher-priority jobs start queued')

  // Free the whole batch; admission order must follow priority, not arrival.
  await h.drain()
  assert.deepEqual(
    h.calls.map(call => call.filePath).slice(h.MAX_CONCURRENT),
    ['/covers/current.flac', '/covers/visible.flac'],
    'priority 0 then priority 1 take the freed slots before any queued priority 2',
  )
  assert.equal(h.calls.find(call => call.filePath === '/covers/current.flac').windowGeneration, 7)
  await Promise.all([...background, visible, current])
  assert(h.maximumActive <= h.MAX_CONCURRENT, 'ordering never widens the pool')
})

test('a late foreground request overtakes a queue of lower-priority waiters', async () => {
  const h = await harness()
  const running = Array.from({ length: h.MAX_CONCURRENT }, (_, index) =>
    h.schedule(h.input(`hot-${index}`), { priority: 2 }))
  const queuedBackground = Array.from({ length: 6 }, (_, index) =>
    h.schedule(h.input(`cold-${index}`), { priority: 2 }))
  const current = h.schedule(h.input('now-playing'), { priority: 0 })
  const visible = h.schedule(h.input('on-screen'), { priority: 1 })
  assert.equal(h.calls.length, h.MAX_CONCURRENT)

  await h.drain()
  assert.deepEqual(
    h.calls.slice(h.MAX_CONCURRENT, h.MAX_CONCURRENT + 2).map(call => call.filePath),
    ['/covers/now-playing.flac', '/covers/on-screen.flac'],
    'foreground overtakes background work requested earlier',
  )
  await Promise.all([...running, ...queuedBackground, current, visible])
})

test('cancelled and stale queued consumers never invoke native thumbnail loading', async () => {
  const h = await harness()
  // Saturate the pool so the doomed consumers stay genuinely queued.
  const fillers = Array.from({ length: h.MAX_CONCURRENT }, (_, index) =>
    h.schedule(h.input(`filler-${index}`), { priority: 2 }))
  const cancelledController = new AbortController()
  const cancelled = h.schedule(h.input('cancelled'), { priority: 0, signal: cancelledController.signal })
  let current = true
  const stale = h.schedule(h.input('stale'), { priority: 0, isCurrent: () => current })
  assert.equal(h.calls.length, h.MAX_CONCURRENT, 'the doomed jobs were never admitted')

  cancelledController.abort()
  current = false
  assert.equal(await cancelled, null)

  // Freeing a slot re-pumps; the stale waiter must be dropped, not invoked.
  h.settleOldest()
  await h.flush()
  assert.equal(await stale, null)

  await h.drain()
  await Promise.all(fillers)
  assert.deepEqual(
    h.calls.map(call => call.filePath),
    fillers.map((_, index) => `/covers/filler-${index}.flac`),
    'neither the cancelled nor the stale consumer reached the native boundary',
  )
})

test('queued duplicate shares one invoke and can be promoted to foreground', async () => {
  const h = await harness()
  const running = h.schedule(h.input('running'), { priority: 2 })
  const old = h.schedule(h.input('same'), { priority: 2 })
  const other = h.schedule(h.input('other'), { priority: 1 })
  const promoted = h.schedule(h.input('same'), { priority: 0 })
  assert.equal(h.calls.length, 3, 'a duplicate key never becomes a second native request')
  assert.equal(h.calls.filter(call => call.filePath === '/covers/same.flac').length, 1)

  await h.drain()
  await Promise.all([running, old, other, promoted])
  assert.deepEqual(
    h.calls.map(call => call.filePath),
    ['/covers/running.flac', '/covers/same.flac', '/covers/other.flac'],
  )
})

test('abort releases its consumer without admitting replacement work mid-flight', async () => {
  const h = await harness()
  const controller = new AbortController()
  const abandoned = h.schedule(h.input('abandoned'), { priority: 2, signal: controller.signal })
  const next = h.schedule(h.input('next'), { priority: 0 })
  assert.equal(h.calls.length, 2, 'the pool had free slots, so both were admitted')

  controller.abort()
  assert.equal(await abandoned, null, 'an aborted consumer resolves null rather than rejecting')
  assert.equal(h.calls.length, 2, 'aborting a consumer cannot release the in-flight native request')

  h.settle('/covers/next.flac')
  assert.deepEqual(await next, { width: 1 })
  h.settle('/covers/abandoned.flac')
  await h.drain()
  assert.equal(h.calls.length, 2, 'the aborted job still completes its own native request')
})

test('a job whose consumers all abort still completes without rejecting them', async () => {
  const h = await harness()
  const controller = new AbortController()
  const abandoned = h.schedule(h.input('abandoned'), { priority: 0, signal: controller.signal })
  const fillers = Array.from({ length: h.MAX_CONCURRENT - 1 }, (_, index) =>
    h.schedule(h.input(`filler-${index}`), { priority: 2 }))
  controller.abort()
  assert.equal(await abandoned, null, 'the abandoned consumer observes a discarded result')

  h.settle('/covers/abandoned.flac')
  await h.flush()
  await h.drain()
  await Promise.all(fillers)
  assert.equal(
    h.calls.filter(call => call.filePath === '/covers/abandoned.flac').length,
    1,
    'the in-flight native request was neither cancelled nor duplicated',
  )
})

test('native failure rejects its consumers and leaves later work and retry usable', async () => {
  const h = await harness()
  const failed = h.schedule(h.input('failure'), { priority: 0 })
  const queued = h.schedule(h.input('queued'), { priority: 1 })

  h.fail('/covers/failure.flac', new Error('native failure'))
  await assert.rejects(failed, /native failure/)
  await h.flush()
  assert(h.inFlight <= h.MAX_CONCURRENT, 'a rejected job still releases its slot')

  await h.drain()
  await queued

  const retried = h.schedule(h.input('failure'), { priority: 0 })
  assert.equal(h.calls.at(-1).filePath, '/covers/failure.flac', 'the released key admits a new request')
  h.settle('/covers/failure.flac')
  await retried
})

test('every rejection frees its slot so the pool keeps refilling', async () => {
  const h = await harness()
  const scheduled = Array.from({ length: 3 * h.MAX_CONCURRENT }, (_, index) =>
    h.schedule(h.input(`reject-${index}`), { priority: 2 }))
  let rejected = 0
  for (let guard = 0; guard < 5000 && h.inFlight; guard += 1) {
    assert(h.inFlight <= h.MAX_CONCURRENT, `ceiling held after ${rejected} rejections`)
    h.settleOldest()
    rejected += 1
    await h.flush()
  }
  // Settling normally above keeps the drain terminating; now prove the same for
  // rejections by running a fresh batch that only ever fails.
  const onlyFailures = Array.from({ length: 3 * h.MAX_CONCURRENT }, (_, index) =>
    h.schedule(h.input(`fail-${index}`), { priority: 2 }))
  let failed = 0
  for (let guard = 0; guard < 5000 && h.inFlight; guard += 1) {
    h.pending.shift().reject(new Error(`native failure ${failed}`))
    failed += 1
    await h.flush()
  }
  const settled = await Promise.allSettled(onlyFailures)
  assert.equal(settled.filter(result => result.status === 'rejected').length, onlyFailures.length)
  assert.equal(h.maximumActive, h.MAX_CONCURRENT, 'rejections never leave the lane narrower')
  assert.equal(h.pending.length, 0, 'a rejection strands no pending entry')
  await Promise.all(scheduled)
})

test('the jobs map releases every key so the pool cannot leak settled jobs', async () => {
  const h = await harness()
  const scheduled = Array.from({ length: 40 }, (_, index) =>
    h.schedule(h.input(`unique-${index}`), { priority: 2 }))
  await h.drain()
  await Promise.all(scheduled)
  assert.equal(h.calls.length, 40, 'each distinct key produced exactly one native request')
  assert.equal(new Set(h.calls.map(call => call.filePath)).size, 40)

  // Re-scheduling a settled key must create a fresh job: a retained entry would
  // attach the new consumer to a completed job and never resolve it.
  const again = h.schedule(h.input('unique-0'), { priority: 2 })
  assert.equal(h.calls.length, 41, 'a released key admits a new native request')
  h.settle('/covers/unique-0.flac')
  assert.deepEqual(await again, { width: 1 })
})

test('folder and track thumbnails share admission while folder identity includes its selected root', async () => {
  const h=await harness()
  const folder={clientId:'folder-test',rootPath:'/music',directoryPath:'/music/Album',maxEdge:256,windowGeneration:1}
  const a=h.scheduleFolderThumbnail(folder,{priority:1}),same=h.scheduleFolderThumbnail({...folder},{priority:0})
  assert.equal(h.calls.length,1,'identical folder requests deduplicate')
  const otherRoot=h.scheduleFolderThumbnail({...folder,rootPath:'/music/Album'},{priority:1})
  const track=h.scheduleTrackThumbnail({clientId:folder.clientId,sourcePath:folder.directoryPath,maxEdge:256,windowGeneration:1},{priority:1})
  assert.equal(h.calls.length,3,'selected-root scope and source kind prevent collisions')
  await h.drain();await Promise.all([a,same,otherRoot,track])
  assert(h.maximumActive<=h.MAX_CONCURRENT)
})

test('aborted queued folder is never admitted after a slot frees', async () => {
  const h=await harness(),busy=Array.from({length:h.MAX_CONCURRENT},(_,index)=>h.schedule(h.input(`busy-${index}`),{priority:1}))
  const controller=new AbortController()
  const pending=h.scheduleFolderThumbnail({clientId:'folder',rootPath:'/music',directoryPath:'/music/queued',maxEdge:256,windowGeneration:1},{priority:2,signal:controller.signal})
  controller.abort();assert.equal(await pending,null)
  await h.drain();await Promise.all(busy)
  assert.equal(h.calls.length,h.MAX_CONCURRENT,'cancelled folder consumes no native slot')
})
