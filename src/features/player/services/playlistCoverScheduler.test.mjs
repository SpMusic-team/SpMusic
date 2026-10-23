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
    /import\s*\{\s*loadAudioPlaylistCoverPixels\s*,?\s*\}\s*from\s*['"]\.\/audioCommands['"];?/,
    'const loadAudioPlaylistCoverPixels = globalThis.__playlistCoverSchedulerBackend; ',
  )
  assert.notEqual(patched, compiled, 'test substitutes only the native cover command boundary')
  const url = `data:text/javascript;base64,${Buffer.from(patched).toString('base64')}#${Math.random()}`
  const { schedulePlaylistCoverPixels: schedule } = await import(url)
  const input = (name, windowGeneration = 1) => ({
    clientId: 'test-client', filePath: `/covers/${name}.flac`, maxEdge: 256, windowGeneration,
  })
  const flush = async () => { await Promise.resolve(); await Promise.resolve() }
  return { schedule, calls, pending, input, flush, get maximumActive() { return maximumActive } }
}

test('one native thumbnail invoke at a time, with foreground before queued library work', async () => {
  const h = await harness()
  const running = h.schedule(h.input('running'), { priority: 2 })
  const background = h.schedule(h.input('background'), { priority: 2 })
  const visible = h.schedule(h.input('visible'), { priority: 1 })
  const current = h.schedule(h.input('current', 7), { priority: 0 })
  assert.deepEqual(h.calls.map(call => call.filePath), ['/covers/running.flac'])
  h.pending.shift().resolve()
  await h.flush()
  assert.deepEqual(h.calls.map(call => call.filePath), ['/covers/running.flac', '/covers/current.flac'])
  assert.equal(h.calls[1].windowGeneration, 7, 'original native generation is preserved')
  h.pending.shift().resolve()
  await h.flush()
  assert.deepEqual(h.calls.map(call => call.filePath).slice(-1), ['/covers/visible.flac'])
  h.pending.shift().resolve()
  await h.flush()
  assert.deepEqual(h.calls.map(call => call.filePath).slice(-1), ['/covers/background.flac'])
  h.pending.shift().resolve()
  await Promise.all([running, background, visible, current])
  assert.equal(h.maximumActive, 1)
})

test('cancelled and stale queued consumers never invoke native thumbnail loading', async () => {
  const h = await harness()
  const running = h.schedule(h.input('running'), { priority: 2 })
  const cancelledController = new AbortController()
  const cancelled = h.schedule(h.input('cancelled'), { priority: 0, signal: cancelledController.signal })
  let current = true
  const stale = h.schedule(h.input('stale'), { priority: 0, isCurrent: () => current })
  cancelledController.abort()
  current = false
  assert.equal(await cancelled, null)
  h.pending.shift().resolve()
  await running
  assert.equal(await stale, null)
  assert.deepEqual(h.calls.map(call => call.filePath), ['/covers/running.flac'])
  assert.equal(h.maximumActive, 1)
})

test('queued duplicate shares one invoke and can be promoted to foreground', async () => {
  const h = await harness()
  const running = h.schedule(h.input('running'), { priority: 2 })
  const old = h.schedule(h.input('same'), { priority: 2 })
  const other = h.schedule(h.input('other'), { priority: 1 })
  const promoted = h.schedule(h.input('same'), { priority: 0 })
  h.pending.shift().resolve()
  await h.flush()
  assert.deepEqual(h.calls.map(call => call.filePath), ['/covers/running.flac', '/covers/same.flac'])
  h.pending.shift().resolve()
  await h.flush()
  assert.deepEqual(h.calls.map(call => call.filePath), ['/covers/running.flac', '/covers/same.flac', '/covers/other.flac'])
  h.pending.shift().resolve()
  await Promise.all([running, old, other, promoted])
  assert.equal(h.maximumActive, 1)
})

test('abort releases an active consumer without starting another native load early', async () => {
  const h = await harness()
  const controller = new AbortController()
  const abandoned = h.schedule(h.input('abandoned'), { priority: 2, signal: controller.signal })
  const next = h.schedule(h.input('next'), { priority: 0 })
  controller.abort()
  assert.equal(await abandoned, null)
  assert.deepEqual(h.calls.map(call => call.filePath), ['/covers/abandoned.flac'])
  h.pending.shift().resolve()
  await h.flush()
  assert.deepEqual(h.calls.map(call => call.filePath), ['/covers/abandoned.flac', '/covers/next.flac'])
  h.pending.shift().resolve()
  assert.deepEqual(await next, { width: 1 })
  assert.equal(h.maximumActive, 1)
})

test('native failure rejects its consumers and leaves later work and retry usable', async () => {
  const h = await harness()
  const failed = h.schedule(h.input('failure'), { priority: 0 })
  const queued = h.schedule(h.input('queued'), { priority: 1 })
  h.pending.shift().reject(new Error('native failure'))
  await assert.rejects(failed, /native failure/)
  await h.flush()
  assert.deepEqual(h.calls.map(call => call.filePath), ['/covers/failure.flac', '/covers/queued.flac'])
  h.pending.shift().resolve()
  await queued
  const retried = h.schedule(h.input('failure'), { priority: 0 })
  assert.equal(h.calls.at(-1).filePath, '/covers/failure.flac')
  h.pending.shift().resolve()
  await retried
  assert.equal(h.maximumActive, 1)
})
