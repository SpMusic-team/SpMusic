import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = readFileSync(new URL('./longTracks.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const { longTracksSongs, readLongTracksMinDurationMs, writeLongTracksMinDurationMs,
  isLongTracksMinDurationMs, LONG_TRACKS_MIN_DURATION_STORAGE_KEY, DEFAULT_LONG_TRACKS_MIN_DURATION_MS,
  MAX_LONG_TRACKS_MIN_DURATION_MS } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))

test('15 minute threshold includes equal and greater values, excludes unknown and invalid values', () => {
  const values = [899999, 900000, 900001, undefined, NaN, Infinity, -1, 0]
  const songs = values.map((_, i) => Object.freeze({ scope: 'root', sourcePath: String(i), track: { durationSeconds: 99999 } }))
  const durationMap = new Map([['root', new Map(values.map((value, i) => [String(i), value]))]])
  assert.equal(DEFAULT_LONG_TRACKS_MIN_DURATION_MS, 900000)
  assert.deepEqual(longTracksSongs(Object.freeze(songs), durationMap, 900000), [songs[1], songs[2]])
  assert.deepEqual(longTracksSongs(songs, durationMap, 0), [songs[0], songs[1], songs[2], songs[7]])
  assert.deepEqual(longTracksSongs(songs, durationMap, NaN), [songs[1], songs[2]])
  assert.equal(songs[0].sourcePath, '0')
})

test('duration evidence is scoped, and returned order and identity follow the input songs', () => {
  const a = { scope: 'a', sourcePath: '/same.flac' }
  const b = { scope: 'b', sourcePath: '/same.flac' }
  const c = { scope: 'unknown', sourcePath: '/same.flac' }
  const durationMap = new Map([['a', new Map([['/same.flac', 1000]])], ['b', new Map([['/same.flac', 900000]])]])
  assert.deepEqual(longTracksSongs([c, b, a], durationMap, 900000), [b])
  const full = [b, { scope: 'b', sourcePath: '/tail.flac' }]
  durationMap.get('b').set('/tail.flac', 1200000)
  const result = longTracksSongs(full, durationMap, 900000)
  assert.deepEqual(result, full)
  assert.notEqual(result, full)
  assert.equal(result[0], b)
})

test('preference bounds, malformed values and unavailable storage safely use 15 minute default', () => {
  let raw = null
  globalThis.window = { localStorage: { getItem: key => { assert.equal(key, LONG_TRACKS_MIN_DURATION_STORAGE_KEY); return raw }, setItem: (_key, value) => { raw = value } } }
  for (const value of [null, '', 'invalid', '"900000"', '{}', '-1', '1.5', '2147483648', 'null']) {
    raw = value
    assert.equal(readLongTracksMinDurationMs(), 900000)
  }
  for (const value of [0, 900000, MAX_LONG_TRACKS_MIN_DURATION_MS]) {
    assert.equal(isLongTracksMinDurationMs(value), true)
    writeLongTracksMinDurationMs(value)
    assert.equal(readLongTracksMinDurationMs(), value)
  }
  raw = '900000'
  for (const value of [-1, 1.5, NaN, Infinity, MAX_LONG_TRACKS_MIN_DURATION_MS + 1]) {
    assert.equal(isLongTracksMinDurationMs(value), false)
    writeLongTracksMinDurationMs(value)
    assert.equal(raw, '900000')
  }
  globalThis.window = { get localStorage() { throw Error('storage unavailable') } }
  assert.equal(readLongTracksMinDurationMs(), 900000)
  assert.doesNotThrow(() => writeLongTracksMinDurationMs(1200000))
  delete globalThis.window
})
