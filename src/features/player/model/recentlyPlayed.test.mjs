import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
const code = ts.transpileModule(await readFile(new URL('./recentlyPlayed.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText.replace(/import .*? from '.\/playlistTrackSummary';/, "const normalizeAudioSourcePath = p => p.replaceAll('\\\\', '/');")
const { RecentlyPlayedTracker, recentlyPlayedSongs, readRecentlyPlayed, writeRecentlyPlayed } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const state = (positionMs, phase = 'playing', generation = 1) => ({ positionMs, phase, generation, currentTrackId: 'a', durationMs: 4000 })
test('actual listening accumulates once per pass, including natural end and excluding pause/seek', () => {
  const tracker = new RecentlyPlayedTracker()
  assert.equal(tracker.sample(state(0), 0), false)
  assert.equal(tracker.sample(state(1000), 1000), false)
  tracker.breakBaseline()
  assert.equal(tracker.sample(state(3000), 1100), false)
  assert.equal(tracker.sample(state(4000, 'ended'), 2100), true)
  assert.equal(tracker.sample(state(4000, 'ended'), 2200), false)
  tracker.sample(state(0), 2300)
  tracker.sample(state(1000), 3300)
  assert.equal(tracker.sample(state(2000), 4300), true)
})
test('jump, pause and generation changes cannot qualify; metadata can arrive after threshold', () => {
  const tracker = new RecentlyPlayedTracker()
  tracker.sample(state(0), 0)
  tracker.sample(state(3000), 500)
  tracker.sample(state(3000, 'paused'), 5000)
  tracker.sample(state(3000), 6000)
  assert.equal(tracker.sample(state(4000), 7000), false)
  tracker.sample(state(0, 'playing', 2), 8000)
  tracker.sample(state(1000, 'playing', 2), 9000)
  assert.equal(tracker.sample(state(2000, 'playing', 2), 10000, false, false), false)
  assert.equal(tracker.sample(state(2100, 'playing', 2), 10100), true)
})
test('storage rejects malformed data and derived list preserves membership and recency', () => {
  let raw = '{broken'
  globalThis.localStorage = { getItem: () => raw, setItem: (_key, value) => { raw = value } }
  assert.deepEqual(readRecentlyPlayed(), [])
  raw = JSON.stringify({ version: 1, entries: [{ sourcePath: 'a', lastPlayedAt: 3 }, { sourcePath: 'a', lastPlayedAt: 7 }, { sourcePath: 'b', lastPlayedAt: -2 }, {}] })
  assert.deepEqual(readRecentlyPlayed(), [{ sourcePath: 'a', lastPlayedAt: 7 }])
  writeRecentlyPlayed([{ sourcePath: 'a', lastPlayedAt: 8 }, { sourcePath: 'b', lastPlayedAt: 10 }])
  assert.deepEqual(recentlyPlayedSongs([{ sourcePath: 'a' }, { sourcePath: 'c' }, { sourcePath: 'b' }], readRecentlyPlayed()).map(x => x.sourcePath), ['b', 'a'])
})
test('duplicate position keeps the advancing interval anchor but pause still clears it', () => {
  const tracker = new RecentlyPlayedTracker()
  tracker.sample(state(0), 0)
  tracker.sample(state(0), 990)
  assert.equal(tracker.sample(state(1000), 1000), false)
  tracker.sample(state(1000, 'paused'), 1100)
  tracker.sample(state(1000), 5000)
  tracker.sample(state(1000), 5990)
  assert.equal(tracker.sample(state(2000), 6000), true)
})
