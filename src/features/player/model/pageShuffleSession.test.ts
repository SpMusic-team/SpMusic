import assert from 'node:assert/strict'
import test from 'node:test'
import { createPageShuffleOrder, resolvePageShuffleTarget } from './pageShuffleSession.ts'

const tracks = [
  { id: 'a', sourcePath: 'D:/Music/a.flac', available: true },
  { id: 'b', sourcePath: 'D:/Music/b.flac', available: true },
  { id: 'c', sourcePath: 'D:/Music/c.flac', available: true },
  { id: 'missing', sourcePath: 'D:/Music/missing.flac', available: false },
]

test('page order is a complete available permutation and keeps the source display order intact', () => {
  const before = structuredClone(tracks)
  for (const random of [() => 0, () => .5, () => .999]) {
    const order = createPageShuffleOrder(tracks, undefined, random)
    assert.deepEqual([...order].sort(), ['a', 'b', 'c'])
    assert.equal(new Set(order).size, 3)
  }
  assert.deepEqual(tracks, before)
})

test('first selection excludes the playing source path whenever another candidate exists', () => {
  for (const current of tracks.slice(0, 3)) {
    const order = createPageShuffleOrder(tracks, current.sourcePath.replaceAll('/', '\\'), () => .999)
    assert.notEqual(order[0], current.id)
  }
  assert.deepEqual(createPageShuffleOrder([tracks[0]], tracks[0].sourcePath), ['a'])
  assert.deepEqual(createPageShuffleOrder([tracks[3]]), [])
})

test('traversal continues after the original source tail and stops only after the complete plan', () => {
  const session = { scope: 'page', order: ['c', 'a', 'b'] }
  assert.equal(resolvePageShuffleTarget(session, tracks, 'c', 1), 0)
  assert.equal(resolvePageShuffleTarget(session, tracks, 'a', 1), 1)
  assert.equal(resolvePageShuffleTarget(session, tracks, 'b', 1), null)
  assert.equal(resolvePageShuffleTarget(session, tracks, 'c', -1), null)
  assert.equal(resolvePageShuffleTarget(session, tracks, 'a', -1), 2)
})

test('removed or unavailable entries are skipped without wrapping or inventing a fallback', () => {
  const session = { scope: 'page', order: ['a', 'missing', 'deleted', 'b', 'c'] }
  assert.equal(resolvePageShuffleTarget(session, tracks, 'a', 1), 1)
  assert.equal(resolvePageShuffleTarget(session, tracks, 'deleted', 1), 1)
  assert.equal(resolvePageShuffleTarget(session, tracks, 'unknown', 1), null)
  assert.equal(resolvePageShuffleTarget(session, tracks.map(track => ({ ...track, available: track.id === 'a' })), 'a', 1), null)
})
