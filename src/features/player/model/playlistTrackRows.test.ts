import assert from 'node:assert/strict'
import test from 'node:test'
import { sharePlaylistTrackRows } from './playlistTrackRows.ts'
import type { PlaylistTrackItemViewModel } from './playerUiViewModel.ts'

const row = (id: string): PlaylistTrackItemViewModel => ({ id, title: id, artist: 'Artist', album: 'Album' })

test('unchanged presentation rows retain both row and collection identity', () => {
  const previous = [row('a'), row('b')]
  assert.equal(sharePlaylistTrackRows(previous, previous.map(item => ({ ...item }))), previous)
})

test('one arriving cover replaces only its row and preserves every other row', () => {
  const previous = [row('a'), row('b'), row('c')]
  const coverThumbnail = { src: 'blob:new-cover', width: 256, height: 256, encodedBytes: 262184 }
  const next = previous.map(item => item.id === 'b' ? { ...item, coverThumbnail } : { ...item })
  const shared = sharePlaylistTrackRows(previous, next)
  assert.notEqual(shared, previous)
  assert.equal(shared[0], previous[0])
  assert.equal(shared[1], next[1])
  assert.equal(shared[1].coverThumbnail, coverThumbnail)
  assert.equal(shared[2], previous[2])
})

test('metadata updates, new fields and deleted optional fields cannot reuse stale rows', () => {
  const previous = [{ ...row('a'), durationSeconds: 180, hasLocalArtwork: true }]
  const { durationSeconds: _duration, ...withoutDuration } = previous[0]
  const changes = [
    { ...previous[0], title: 'New title' },
    { ...previous[0], artist: 'New artist' },
    { ...previous[0], hasLocalArtwork: false },
    { ...previous[0], durationSeconds: 0 },
    { ...previous[0], coverImage: undefined },
    withoutDuration,
  ]
  for (const changed of changes) {
    const shared = sharePlaylistTrackRows(previous, [changed])
    assert.equal(shared[0], changed)
    assert.deepEqual(shared[0], changed)
  }
  assert.equal(_duration, 180)
})

test('reorder, insert and remove keep the requested order without rebuilding surviving rows', () => {
  const previous = [row('a'), row('b'), row('c')]
  const added = row('d')
  const shared = sharePlaylistTrackRows(previous, [{ ...previous[2] }, added, { ...previous[0] }])
  assert.deepEqual(shared.map(item => item.id), ['c', 'd', 'a'])
  assert.equal(shared[0], previous[2])
  assert.equal(shared[1], added)
  assert.equal(shared[2], previous[0])
  assert.deepEqual(sharePlaylistTrackRows(shared, []), [])
})
