import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = readFileSync(new URL('./playlistCoverPathLane.ts', import.meta.url), 'utf8')

// Every harness imports the module under a distinct fragment, so each test gets
// fresh module state. Without that the session-scoped breaker would leak between
// cases and a "still available" assertion would depend on test order.
let testSequence = 0

/**
 * Harness for the path lane.
 *
 * The decision logic in this module carries the contract, so it is exercised
 * directly rather than through a hook harness. Only the native command imports,
 * the shared scheduler and the readiness/`Image` boundaries are substituted;
 * everything else — including the predecode implementation — runs for real.
 *
 * The fake `Image` never settles on its own. A synchronous fake would hide the
 * late-completion behaviour these tests exist to pin, because a decode could never
 * finish after the attempt had already been classified.
 */
async function harness() {
  const requests = []
  const backends = []
  const images = []
  const decoded = []
  const urlOf = (thumbnail) => `asset://localhost/${thumbnail.path}`
  class FakeImage {
    constructor() {
      this.complete = false
      this.naturalWidth = 0
      this.onload = null
      this.onerror = null
      this.decoding = 'sync'
      this.src = ''
      this.listeners = new Map()
      images.push(this)
    }
    removeAttribute(name) {
      if (name === 'src') this.src = ''
    }
    addEventListener(name, handler) {
      const set = this.listeners.get(name) ?? new Set()
      set.add(handler)
      this.listeners.set(name, set)
    }
    removeEventListener(name, handler) {
      this.listeners.get(name)?.delete(handler)
    }
    /** Simulate a successful decode (fires the recorded `onload`). */
    decode() {
      this.complete = true
      this.naturalWidth = 64
      this.onload?.()
    }
    /** Simulate a decode error. */
    fail() {
      this.onerror?.()
    }
    /** Simulate a load event that produced no pixels. */
    emptyLoad() {
      this.complete = true
      this.naturalWidth = 0
      this.onload?.()
    }
  }
  globalThis.__pathLaneTest = {
    urlOf,
    isStaleCoverPixelsError: (error) => Boolean(error && typeof error === 'object' && error.code === 'STALE_REQUEST'),
    loadAudioTrackThumbnailPath: (input) => { requests.push({ kind: 'track', input }); return backends.shift()() },
    loadAudioFolderThumbnailPath: (input) => { requests.push({ kind: 'folder', input }); return backends.shift()() },
    loadAudioPlaylistCoverThumbnailPath: (input) => { requests.push({ kind: 'cover', input }); return backends.shift()() },
    scheduleLaneJob: (lane, kind, identity, load) => load(),
    markPlaylistCoverDecoded: (image) => { decoded.push(image) },
    FakeImage,
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  // Strip every runtime import; the prelude below supplies those bindings. Type
  // imports are already erased by transpilation. The prelude indirection is
  // deliberate: each binding reads `globalThis.__pathLaneTest` at call time, so a
  // test can swap one boundary (or stand up a fresh harness) without re-importing
  // a module whose state — notably the breaker — must stay per-harness.
  const stripped = compiled.replace(/^import[\s\S]*?from ['"][^'"]+['"];?[ \t]*$/gm, '')
  assert(!/^import\b/m.test(stripped), 'the harness must substitute every runtime import')
  assert(stripped.includes('runPreparedPathAttempt'), 'the exported decision helper is under test')
  const prelude = `
    const audioThumbnailPathUrl = (thumbnail) => globalThis.__pathLaneTest.urlOf(thumbnail)
    const isStaleCoverPixelsError = (error) => globalThis.__pathLaneTest.isStaleCoverPixelsError(error)
    const loadAudioTrackThumbnailPath = (input) => globalThis.__pathLaneTest.loadAudioTrackThumbnailPath(input)
    const loadAudioFolderThumbnailPath = (input) => globalThis.__pathLaneTest.loadAudioFolderThumbnailPath(input)
    const loadAudioPlaylistCoverThumbnailPath = (input) => globalThis.__pathLaneTest.loadAudioPlaylistCoverThumbnailPath(input)
    const scheduleLaneJob = (lane, kind, identity, load) => globalThis.__pathLaneTest.scheduleLaneJob(lane, kind, identity, load)
    const markPlaylistCoverDecoded = (image) => globalThis.__pathLaneTest.markPlaylistCoverDecoded(image)
    const Image = function Image() { return new globalThis.__pathLaneTest.FakeImage() }
  `
  // A distinct fragment per harness keeps every import a fresh module instance, so
  // the breaker state cannot leak from one test into the next.
  const url = `data:text/javascript;base64,${Buffer.from(prelude + stripped).toString('base64')}#${testSequence++}`
  const module = await import(url)

  const reference = { path: '/cache/abc-256-t2-j1.jpg', width: 256, height: 256, byteLength: 12_345 }
  const options = (overrides = {}) => ({ priority: 0, isCurrent: () => true, ...overrides })
  /** An attempt whose command resolves with `value`. */
  const call = (value) => async () => value
  /** An attempt whose command rejects with `error`. */
  const callFail = (error) => async () => { throw error }
  /** Queue a backend resolution for the `attempt*Path` helpers. */
  const respond = (value) => { backends.push(async () => value) }
  const failBackend = (error) => { backends.push(async () => { throw error }) }
  const flush = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  }
  /** Wait for predecode to construct its element, then drive it. */
  const driveDecode = async (action) => {
    await flush()
    const image = images.at(-1)
    assert(image, 'predecode constructed a temporary Image')
    action(image)
    await flush()
    return image
  }
  return {
    module, reference, options, requests, images, decoded, call, callFail, respond, failBackend, flush, driveDecode,
    get pendingImage() { return images.at(-1) },
    reset() { module.resetPathLaneForTest() },
  }
}

// ---------------------------------------------------------------------------
// 1. The defect this change exists for.
// ---------------------------------------------------------------------------

// The rolled-back lane took a bare predicate documented as `isAborted` but every
// caller passed a *positive* predicate, so a fully successful attempt was read as
// "aborted" and dropped. Named options make that confusion impossible; this test
// pins the resulting behaviour end to end.
test('a settled attempt publishes when isCurrent reports the row is still valid', async () => {
  const h = await harness()
  const outcome = h.module.runPreparedPathAttempt(h.call(h.reference), h.options())
  await h.driveDecode((image) => image.decode())
  const result = await outcome
  assert.equal(result.status, 'ready', 'isCurrent=true must publish, never drop')
  assert.equal(result.image.src, 'asset://localhost//cache/abc-256-t2-j1.jpg')
  assert.equal(result.image.width, 256)
  assert.equal(result.image.height, 256)
  assert.equal(result.image.encodedBytes, 12_345)
  // Readiness is recorded in a WeakSet keyed by object identity, so the decoded
  // object itself must be the one returned for publication.
  assert.deepEqual(h.decoded, [result.image], 'the returned image is the decoded object itself')
  assert.equal(h.module.pathLaneAvailable(), true)
})

test('a superseded attempt is dropped at the command boundary without falling back', async () => {
  const h = await harness()
  const outcome = await h.module.runPreparedPathAttempt(
    async () => {
      throw new Error('a superseded attempt must not reach the native command')
    },
    h.options({ isCurrent: () => false }),
  )
  assert.equal(outcome.status, 'dropped')
  assert.equal(h.module.pathLaneAvailable(), true, 'a dropped attempt must not advance the breaker')
  assert.equal(h.images.length, 0, 'no predecode work starts for a superseded attempt')
})

test('a row that becomes stale while the command is in flight is dropped, not fallen back', async () => {
  const h = await harness()
  let current = true
  const outcome = await h.module.runPreparedPathAttempt(
    async () => {
      current = false
      throw new Error('native failure after the row changed')
    },
    h.options({ isCurrent: () => current }),
  )
  assert.equal(outcome.status, 'dropped')
  assert.equal(h.module.pathLaneAvailable(), true, 'a superseded request is a controlled abort')
})

test('a successful payload for a row that became stale is dropped before predecode', async () => {
  const h = await harness()
  let current = true
  const outcome = await h.module.runPreparedPathAttempt(
    async () => { current = false; return h.reference },
    h.options({ isCurrent: () => current }),
  )
  assert.equal(outcome.status, 'dropped')
  assert.equal(h.images.length, 0, 'a stale payload is not decoded at all')
  assert.equal(h.module.pathLaneAvailable(), true)
})

test('a stale request is dropped without counting a failure', async () => {
  const h = await harness()
  const outcome = await h.module.runPreparedPathAttempt(
    h.callFail({ code: 'STALE_REQUEST', message: 'superseded' }),
    h.options(),
  )
  assert.equal(outcome.status, 'dropped')
  assert.equal(h.module.pathLaneAvailable(), true, 'STALE_REQUEST says nothing about channel health')
  assert.equal(h.images.length, 0)
})

test('an already-aborted signal drops the attempt before any work', async () => {
  const h = await harness()
  const controller = new AbortController()
  controller.abort()
  const outcome = await h.module.runPreparedPathAttempt(h.call(h.reference), h.options({ signal: controller.signal }))
  assert.equal(outcome.status, 'dropped')
  assert.equal(h.module.pathLaneAvailable(), true)
  assert.equal(h.images.length, 0)
})

test('an abort during predecode drops the attempt and clears the temporary src', async () => {
  const h = await harness()
  const controller = new AbortController()
  const outcome = h.module.runPreparedPathAttempt(h.call(h.reference), h.options({ signal: controller.signal }))
  await h.flush()
  const image = h.pendingImage
  assert(image, 'predecode started')
  controller.abort()
  assert.equal((await outcome).status, 'dropped')
  assert.equal(image.src, '', 'the temporary Image must not keep the asset request alive')
  assert.equal(image.onload, null, 'the load listener is removed on abort')
  assert.equal(image.onerror, null, 'the error listener is removed on abort')
  assert.equal(image.listeners.get('abort')?.size ?? 0, 0, 'the abort listener is removed on abort')
  assert.equal(h.module.pathLaneAvailable(), true, 'an abort is not a channel failure')
  // A decode that completes after the classification must change nothing.
  image.decode()
  await h.flush()
  assert.deepEqual(h.decoded, [], 'a late decode of an aborted attempt never marks the image decoded')
})

test('a row that becomes stale during predecode is dropped instead of published', async () => {
  const h = await harness()
  let current = true
  const outcome = h.module.runPreparedPathAttempt(h.call(h.reference), h.options({ isCurrent: () => current }))
  await h.flush()
  const image = h.pendingImage
  current = false
  image.decode()
  assert.equal((await outcome).status, 'dropped', 'publication rechecks currentness after the decode')
  assert.deepEqual(h.decoded, [], 'a dropped attempt does not mark the image decoded')
})

// ---------------------------------------------------------------------------
// 2. `null` is a verdict, not a failure.
// ---------------------------------------------------------------------------

test('a null payload is confirmed absence and never falls back', async () => {
  const h = await harness()
  const outcome = await h.module.runPreparedPathAttempt(h.call(null), h.options())
  assert.equal(outcome.status, 'missing')
  assert.equal(h.images.length, 0, 'no predecode starts for confirmed absence')
  assert.equal(h.module.pathLaneAvailable(), true, 'absence is not a channel failure')
})

// ---------------------------------------------------------------------------
// 3. The decode is part of the attempt, so a decode failure falls back once.
// ---------------------------------------------------------------------------

test('an image that fails to decode reports exactly one fallback', async () => {
  const h = await harness()
  const outcome = h.module.runPreparedPathAttempt(h.call(h.reference), h.options())
  await h.driveDecode((image) => image.fail())
  const result = await outcome
  assert.equal(result.status, 'fallback')
  assert.equal(result.reason, 'decode')
  assert.deepEqual(h.decoded, [])
})

test('a load event that produced no pixels counts as a decode failure', async () => {
  const h = await harness()
  const outcome = h.module.runPreparedPathAttempt(h.call(h.reference), h.options())
  await h.driveDecode((image) => image.emptyLoad())
  const result = await outcome
  assert.equal(result.status, 'fallback')
  assert.equal(result.reason, 'decode', 'a load event with naturalWidth 0 is not a usable image')
})

test('an unbuildable asset URL falls back instead of publishing a blank cover', async () => {
  const h = await harness()
  globalThis.__pathLaneTest.urlOf = () => { throw new Error('convertFileSrc failed') }
  try {
    const outcome = await h.module.runPreparedPathAttempt(h.call(h.reference), h.options())
    assert.equal(outcome.status, 'fallback')
    assert.equal(outcome.reason, 'prepare')
    assert.equal(h.images.length, 0, 'no decode is attempted for an unbuildable URL')
  } finally {
    globalThis.__pathLaneTest.urlOf = (thumbnail) => `asset://localhost/${thumbnail.path}`
  }
})

test('a command error falls back once and is counted', async () => {
  const h = await harness()
  const outcome = await h.module.runPreparedPathAttempt(h.callFail(new Error('disk failure')), h.options())
  assert.equal(outcome.status, 'fallback')
  assert.equal(outcome.reason, 'command')
})

test('a predecode timeout falls back and a late completion never publishes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = await harness()
  const outcome = h.module.runPreparedPathAttempt(h.call(h.reference), h.options())
  await h.flush()
  const image = h.pendingImage
  assert(image, 'predecode started')
  t.mock.timers.tick(h.module.PREDECODE_TIMEOUT_MS)
  const result = await outcome
  assert.equal(result.status, 'fallback')
  assert.equal(result.reason, 'timeout')
  assert.equal(image.src, '', 'a timed-out predecode releases the temporary request')
  assert.deepEqual(h.decoded, [], 'a timed-out attempt must not be marked decoded')
  // The decode finishes after the classification: it must stay unpublished, which
  // is what a bare `Promise.race` would have failed to guarantee.
  image.decode()
  await h.flush()
  assert.deepEqual(h.decoded, [], 'a decode completed after the timeout stays unpublished')
})

// ---------------------------------------------------------------------------
// 4. Breaker accounting.
// ---------------------------------------------------------------------------

test('eight consecutive failures trip the breaker for the session', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD; index += 1) {
    assert.equal(h.module.pathLaneAvailable(), true, `the lane is open before failure ${index + 1}`)
    const outcome = await h.module.runPreparedPathAttempt(h.callFail(new Error(`failure ${index}`)), h.options())
    assert.equal(outcome.status, 'fallback')
  }
  assert.equal(h.module.pathLaneAvailable(), false, 'the threshold closes the lane')
})

test('one predecoded success clears the streak', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD - 1; index += 1) {
    await h.module.runPreparedPathAttempt(h.callFail(new Error('failure')), h.options())
  }
  const success = h.module.runPreparedPathAttempt(h.call(h.reference), h.options())
  await h.driveDecode((image) => image.decode())
  assert.equal((await success).status, 'ready')
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD - 1; index += 1) {
    await h.module.runPreparedPathAttempt(h.callFail(new Error('failure')), h.options())
  }
  assert.equal(h.module.pathLaneAvailable(), true, 'failures are consecutive, not cumulative')
})

test('a successful payload whose decode fails does not clear the streak', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD - 1; index += 1) {
    await h.module.runPreparedPathAttempt(h.callFail(new Error('failure')), h.options())
  }
  // The command succeeded here; only the decode failed. Recording success at URL
  // conversion (the rolled-back behaviour) would have hidden this entirely.
  const outcome = h.module.runPreparedPathAttempt(h.call(h.reference), h.options())
  await h.driveDecode((image) => image.fail())
  assert.equal((await outcome).status, 'fallback')
  assert.equal(h.module.pathLaneAvailable(), false, 'this was the eighth consecutive real failure')
})

test('missing and dropped attempts neither advance nor clear the streak', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD - 1; index += 1) {
    await h.module.runPreparedPathAttempt(h.callFail(new Error('failure')), h.options())
  }
  assert.equal((await h.module.runPreparedPathAttempt(h.call(null), h.options())).status, 'missing')
  assert.equal((await h.module.runPreparedPathAttempt(
    h.callFail({ code: 'STALE_REQUEST', message: 'stale' }), h.options())).status, 'dropped')
  assert.equal((await h.module.runPreparedPathAttempt(
    h.call(h.reference), h.options({ isCurrent: () => false }))).status, 'dropped')
  assert.equal(h.module.pathLaneAvailable(), true, 'neither verdict consumed a failure slot')
  // One more real failure is then exactly the threshold.
  await h.module.runPreparedPathAttempt(h.callFail(new Error('failure')), h.options())
  assert.equal(h.module.pathLaneAvailable(), false)
})

test('a late success cannot reopen a breaker the session already closed', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD; index += 1) {
    await h.module.runPreparedPathAttempt(h.callFail(new Error('failure')), h.options())
  }
  assert.equal(h.module.pathLaneAvailable(), false)
  const late = h.module.runPreparedPathAttempt(h.call(h.reference), h.options())
  await h.driveDecode((image) => image.decode())
  assert.equal((await late).status, 'ready', 'an in-flight attempt still settles normally')
  assert.equal(h.module.pathLaneAvailable(), false, 'the rollback is session-scoped and must not flap')
})

test('a disabled lane reports fallback without scheduling a request', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD; index += 1) h.module.notePathLaneFailure()
  assert.equal(h.module.pathLaneAvailable(), false)
  // `missing` here would blank every list cover for the rest of the session.
  assert.equal(h.module.PATH_LANE_DISABLED.status, 'fallback')
  const outcome = await h.module.attemptTrackThumbnailPath(
    { clientId: 'c', sourcePath: '/music/a.flac', maxEdge: 256, windowGeneration: 1 },
    h.options(),
  )
  assert.equal(outcome.status, 'fallback')
  assert.equal(h.requests.length, 0, 'a disabled lane does not pay for a doomed request')
  assert.equal(h.images.length, 0)
})

test('one shared native error is charged once, not once per consumer', async () => {
  const h = await harness()
  // The scheduler dedupes jobs and rejects every consumer of a failed job with the
  // same error value. Counting each consumer would close the lane in four jobs.
  const shared = new Error('shared native failure')
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD * 2; index += 1) {
    const outcome = await h.module.runPreparedPathAttempt(h.callFail(shared), h.options())
    assert.equal(outcome.status, 'fallback')
  }
  assert.equal(h.module.pathLaneAvailable(), true, 'one native failure is one strike')
  // A fresh error object is a genuinely new failure and does count.
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD; index += 1) {
    await h.module.runPreparedPathAttempt(h.callFail(new Error(`failure ${index}`)), h.options())
  }
  assert.equal(h.module.pathLaneAvailable(), false)
})

// ---------------------------------------------------------------------------
// 5. Integration with the path commands.
// ---------------------------------------------------------------------------

test('the exported attempt helpers route to the matching path command', async () => {
  const h = await harness()
  h.respond(h.reference)
  const track = h.module.attemptTrackThumbnailPath(
    { clientId: 'c', sourcePath: '/music/a.flac', maxEdge: 256, windowGeneration: 4 }, h.options())
  await h.driveDecode((image) => image.decode())
  assert.equal((await track).status, 'ready')

  h.respond(h.reference)
  const folder = h.module.attemptFolderThumbnailPath(
    { clientId: 'c', rootPath: '/music', directoryPath: '/music/a', maxEdge: 256, windowGeneration: 4 }, h.options())
  await h.driveDecode((image) => image.decode())
  assert.equal((await folder).status, 'ready')

  h.respond(h.reference)
  const cover = h.module.attemptPlaylistCoverThumbnailPath(
    { clientId: 'c', filePath: '/music/a.flac', maxEdge: 512, windowGeneration: 4 }, h.options())
  await h.driveDecode((image) => image.decode())
  assert.equal((await cover).status, 'ready')

  assert.deepEqual(h.requests.map(({ kind }) => kind), ['track', 'folder', 'cover'])
  assert.equal(h.requests[2].input.maxEdge, 512, 'the 512 hero edge travels on the path lane')
  assert.equal(h.requests[0].input.maxEdge, 256)
})

test('a backend error through the helper falls back once instead of throwing into the hook', async () => {
  const h = await harness()
  h.failBackend(new Error('native failure'))
  const outcome = await h.module.attemptTrackThumbnailPath(
    { clientId: 'c', sourcePath: '/music/a.flac', maxEdge: 256, windowGeneration: 4 }, h.options())
  assert.equal(outcome.status, 'fallback')
  assert.equal(outcome.reason, 'command')
})

test('a null backend payload through the helper is confirmed absence', async () => {
  const h = await harness()
  h.respond(null)
  const outcome = await h.module.attemptTrackThumbnailPath(
    { clientId: 'c', sourcePath: '/music/a.flac', maxEdge: 256, windowGeneration: 4 }, h.options())
  assert.equal(outcome.status, 'missing')
  assert.equal(h.module.pathLaneAvailable(), true)
})

// ---------------------------------------------------------------------------
// 6. Presentation failures belong to one attempt, not to one element.
// ---------------------------------------------------------------------------

test('a ready outcome carries an attempt id so a DOM failure is chargeable', async () => {
  const h = await harness()
  const outcome = h.module.runPreparedPathAttempt(h.call(h.reference), h.options())
  await h.driveDecode((image) => image.decode())
  const result = await outcome
  assert.equal(result.status, 'ready')
  assert.equal(typeof result.attemptId, 'string')
  assert(result.attemptId.length > 0)
})

test('two ready attempts get distinct ids, so one row cannot absorb another row failure', async () => {
  const h = await harness()
  const first = h.module.runPreparedPathAttempt(h.call(h.reference), h.options())
  await h.driveDecode((image) => image.decode())
  const second = h.module.runPreparedPathAttempt(h.call(h.reference), h.options())
  await h.driveDecode((image) => image.decode())
  const a = await first, b = await second
  assert.notEqual(a.attemptId, b.attemptId)
})

test('one presentation failure is charged once even when several elements report it', async () => {
  const h = await harness()
  // A successful attempt first: `notePathLaneSuccess` clears the streak, so the
  // accounting below starts from a known zero.
  const success = h.module.runPreparedPathAttempt(h.call(h.reference), h.options())
  await h.driveDecode((image) => image.decode())
  const { attemptId } = await success
  // Charge one below the threshold with real failures.
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD - 2; index += 1) {
    await h.module.runPreparedPathAttempt(h.callFail(new Error(`failure ${index}`)), h.options())
  }
  // Three mounted elements of the same publication all report an error.
  h.module.notePathLanePresentationFailure(attemptId)
  h.module.notePathLanePresentationFailure(attemptId)
  h.module.notePathLanePresentationFailure(attemptId)
  assert.equal(h.module.pathLaneAvailable(), true,
    'three reports of one attempt cost one strike, not three')
  // Exactly one more real failure reaches the threshold.
  await h.module.runPreparedPathAttempt(h.callFail(new Error('final')), h.options())
  assert.equal(h.module.pathLaneAvailable(), false,
    'the repeated reports were collapsed, so a single additional failure closed the lane')
})

test('a presentation failure cannot reopen a session the breaker already closed', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD; index += 1) {
    await h.module.runPreparedPathAttempt(h.callFail(new Error(`failure ${index}`)), h.options())
  }
  assert.equal(h.module.pathLaneAvailable(), false)
  h.module.notePathLanePresentationFailure('attempt-after-close')
  assert.equal(h.module.pathLaneAvailable(), false, 'the rollback stays session-scoped')
})

test('the lane counts direct failures and fallbacks separately from presentation failures', async () => {
  const h = await harness()
  h.failBackend(new Error('native failure'))
  await h.module.attemptTrackThumbnailPath(
    { clientId: 'c', sourcePath: '/music/a.flac', maxEdge: 256, windowGeneration: 1 }, h.options())
  h.respond(h.reference)
  const ready = h.module.attemptTrackThumbnailPath(
    { clientId: 'c', sourcePath: '/music/b.flac', maxEdge: 256, windowGeneration: 1 }, h.options())
  await h.driveDecode((image) => image.decode())
  const { attemptId } = await ready
  h.module.notePathLanePresentationFailure(attemptId)
  const stats = h.module.pathLaneStats()
  assert.equal(stats.directFailures, 1, 'the command failure is a direct failure')
  assert.equal(stats.fallbacks, 1, 'the caller had to enter the pixel lane once')
  assert.equal(stats.prepared, 1, 'the successful attempt is counted as prepared')
  assert.equal(stats.presentationFailures, 1, 'the DOM failure is reported separately')
  assert.equal(stats.fallbacksFromBreaker, 0)
})

test('a disabled lane accounts a fallback without pretending a request failed', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD; index += 1) {
    h.module.notePathLaneFailure(new Error(`failure ${index}`))
  }
  await h.module.attemptTrackThumbnailPath(
    { clientId: 'c', sourcePath: '/music/a.flac', maxEdge: 256, windowGeneration: 1 }, h.options())
  const stats = h.module.pathLaneStats()
  assert.equal(stats.fallbacksFromBreaker, 1)
  assert.equal(stats.directFailures, h.module.PATH_LANE_FAILURE_THRESHOLD,
    'a request that was never made is not a request failure')
})
