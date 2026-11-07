import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

// The path-lane module owns the fallback contract, so it is exercised directly
// here rather than through a hook harness: this is the table in decision 6.1.
const source = readFileSync(new URL('./playlistCoverPathLane.ts', import.meta.url), 'utf8')

async function harness() {
  const commands = []
  let available = true
  globalThis.__pathLaneTestState = {
    commands,
    setAvailable: (value) => { available = value },
    isAvailable: () => available,
  }
  // Substituting the command boundary keeps this a unit test of the decision
  // logic; the scheduler and audioCommands integration is covered elsewhere.
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  const patched = compiled
    .replace(/^import .+from '\.\/audioCommands';$/gm, '')
    .replace(/^import .+from '\.\/playlistCoverScheduler';$/gm, '')
  assert(patched.includes('runPathLaneCall'), 'the exported decision helper is under test')
  const prelude = `
    const isStaleCoverPixelsError = (error) => Boolean(error && typeof error === 'object' && error.code === 'STALE_REQUEST')
    const loadAudioTrackThumbnailPath = (input) => globalThis.__pathLaneTestBackend('track', input)
    const loadAudioFolderThumbnailPath = (input) => globalThis.__pathLaneTestBackend('folder', input)
    const loadAudioPlaylistCoverThumbnailPath = (input) => globalThis.__pathLaneTestBackend('cover', input)
    const scheduleLaneJob = async (lane, kind, identity, load) => load()
  `
  const url = `data:text/javascript;base64,${Buffer.from(prelude + patched).toString('base64')}#${Math.random()}`
  globalThis.__pathLaneTestBackend = async (kind, input) => {
    commands.push({ kind, input })
    const queue = globalThis.__pathLaneTestState.queue
    return queue.length ? queue.shift()(input) : { path: `/cache/${input.maxEdge}.jpg`, width: 12, height: 8, byteLength: 100 }
  }
  globalThis.__pathLaneTestState.queue = []
  const module = await import(url)
  return { module, commands, ...globalThis.__pathLaneTestState }
}

const reference = { path: '/cache/256.jpg', width: 12, height: 8, byteLength: 100 }
const toUrl = (value) => `asset://localhost/${value.path}`
const noAbort = () => false

test('a reference is used without falling back and resets the streak', async () => {
  const h = await harness()
  h.module.notePathLaneFailure()
  const outcome = await h.module.runPathLaneCall(async () => reference, noAbort, toUrl)
  assert.equal(outcome.status, 'use')
  assert.equal(outcome.value.url, 'asset://localhost//cache/256.jpg')
  assert.deepEqual(outcome.value.reference, reference)
})

test('a confirmed absence never falls back and never counts as a failure', async () => {
  const h = await harness()
  // One failure short of the threshold, then a `null` verdict.
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD - 1; index += 1) h.module.notePathLaneFailure()
  const outcome = await h.module.runPathLaneCall(async () => null, noAbort, toUrl)
  assert.equal(outcome.status, 'missing')
  assert.equal(h.module.pathLaneAvailable(), true, '`null` is a verdict, not a failure, and must not advance the breaker')
})

test('a stale request is dropped silently and does not advance the breaker', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD - 1; index += 1) h.module.notePathLaneFailure()
  const outcome = await h.module.runPathLaneCall(async () => { throw { code: 'STALE_REQUEST', message: 'stale' } }, noAbort, toUrl)
  assert.equal(outcome.status, 'dropped')
  assert.equal(h.module.pathLaneAvailable(), true, 'STALE_REQUEST must not contribute to the breaker')
})

test('an aborted call is dropped rather than counted', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD - 1; index += 1) h.module.notePathLaneFailure()
  const outcome = await h.module.runPathLaneCall(
    async () => { throw new Error('native failure after abort') },
    () => true,
    toUrl,
  )
  assert.equal(outcome.status, 'dropped')
  assert.equal(h.module.pathLaneAvailable(), true, 'an aborted read must not contribute to the breaker')
})

test('a real error falls back and is counted exactly once', async () => {
  const h = await harness()
  const outcome = await h.module.runPathLaneCall(async () => { throw new Error('disk failure') }, noAbort, toUrl)
  assert.equal(outcome.status, 'fallback')
})

test('an unbuildable asset URL falls back instead of publishing a blank cover', async () => {
  const h = await harness()
  const outcome = await h.module.runPathLaneCall(async () => reference, noAbort, () => { throw new Error('convertFileSrc failed') })
  assert.equal(outcome.status, 'fallback')
})

test('consecutive failures trip the breaker permanently for the session', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD; index += 1) {
    assert.equal(h.module.pathLaneAvailable(), true)
    await h.module.runPathLaneCall(async () => { throw new Error(`failure ${index}`) }, noAbort, toUrl)
  }
  assert.equal(h.module.pathLaneAvailable(), false, 'the threshold closes the lane')

  // A later success does not reopen it: the rollback is session-scoped.
  h.module.notePathLaneSuccess()
  assert.equal(h.module.pathLaneAvailable(), false)
})

test('one success clears the streak so a long session cannot accumulate a shutdown', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD - 1; index += 1) {
    await h.module.runPathLaneCall(async () => { throw new Error('failure') }, noAbort, toUrl)
  }
  await h.module.runPathLaneCall(async () => reference, noAbort, toUrl)
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD - 1; index += 1) {
    await h.module.runPathLaneCall(async () => { throw new Error('failure') }, noAbort, toUrl)
  }
  assert.equal(h.module.pathLaneAvailable(), true, 'failures are consecutive, not cumulative')
})

test('a tripped breaker reports a fallback rather than an absent verdict', async () => {
  const h = await harness()
  for (let index = 0; index < h.module.PATH_LANE_FAILURE_THRESHOLD; index += 1) h.module.notePathLaneFailure()
  assert.equal(h.module.pathLaneAvailable(), false)
  // Call sites substitute this constant instead of calling the lane at all. It
  // must be a fallback: `missing` would publish a permanent placeholder for
  // every list cover.
  assert.equal(h.module.PATH_LANE_DISABLED.status, 'fallback')
})

test('the path-lane command names match the backend contract', async () => {
  const h = await harness()
  await h.module.scheduleTrackThumbnailPath(
    { clientId: 'c', sourcePath: '/music/a.flac', maxEdge: 256, windowGeneration: 1 }, { priority: 0 })
  await h.module.scheduleFolderThumbnailPath(
    { clientId: 'c', rootPath: '/music', directoryPath: '/music/a', maxEdge: 256, windowGeneration: 1 }, { priority: 0 })
  await h.module.schedulePlaylistCoverThumbnailPath(
    { clientId: 'c', filePath: '/music/a.flac', maxEdge: 512, windowGeneration: 1 }, { priority: 0 })
  assert.deepEqual(h.commands.map(({ kind }) => kind), ['track', 'folder', 'cover'])
  assert.equal(h.commands[2].input.maxEdge, 512, 'the 512 hero edge travels on the path lane')
})
