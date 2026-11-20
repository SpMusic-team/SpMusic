import assert from 'node:assert/strict'
import test from 'node:test'
import {
  readOnlyArtworkFallbackPaths,
  selectArtworkEvictionKey,
  withReadOnlyArtworkFallback,
} from './playlistArtworkFallback.ts'

const cover = (src: string, width = 128) => ({ src, width, height: width, encodedBytes: width * width * 4 })

test('a row keeps its identity when the read-only cache has no cover for it', () => {
  const row = { id: 'b-1', title: 'B Song 1', artist: 'Artist', album: 'Album' }
  assert.equal(withReadOnlyArtworkFallback(row, undefined), row)
  // A cache row without a thumbnail cannot add an image either.
  const knownArtwork = { ...row, hasLocalArtwork: false }
  assert.equal(withReadOnlyArtworkFallback(knownArtwork, { hasLocalArtwork: false }), knownArtwork)
  const withoutThumbnail = withReadOnlyArtworkFallback(row, { hasLocalArtwork: false })
  assert.equal(withoutThumbnail.coverThumbnail, undefined)
  assert.equal(withoutThumbnail.hasLocalArtwork, false)
})

test('the cached cover fills a row that has not rehydrated its own artwork yet', () => {
  const cached = cover('blob:cached')
  const row = { id: 'b-1', title: 'B Song 1', artist: 'Artist', album: 'Album' }
  const layered = withReadOnlyArtworkFallback(row, { hasLocalArtwork: true, coverThumbnail: cached })
  assert.equal(layered.coverThumbnail, cached)
  assert.equal(layered.hasLocalArtwork, true)
  // Text stays untouched.
  assert.equal(layered.title, 'B Song 1')
})

test('the active visual always wins over the cached fallback', () => {
  const cached = cover('blob:cached')
  const active = cover('blob:active', 256)
  const row = { id: 'b-1', hasLocalArtwork: true, coverThumbnail: active }
  assert.equal(withReadOnlyArtworkFallback(row, { hasLocalArtwork: true, coverThumbnail: cached }), row)
})

test('a cached cover cannot overwrite the active lane knowing there is no artwork', () => {
  const cached = cover('blob:cached')
  const layered = withReadOnlyArtworkFallback({ id: 'b-1', hasLocalArtwork: false }, { hasLocalArtwork: true, coverThumbnail: cached })
  assert.equal(layered.hasLocalArtwork, false)
  // The thumbnail is still a real cover, so it may fill the unknown image slot.
  assert.equal(layered.coverThumbnail, cached)
})

test('fallback paths list exactly the displayed covers that must stay resident', () => {
  const cached = cover('blob:cached')
  const artworkByPath = new Map([
    ['/audio/b/0.flac', { hasLocalArtwork: true, coverThumbnail: cached }],
    ['/audio/b/1.flac', { hasLocalArtwork: true, coverThumbnail: cover('blob:other') }],
  ])
  const sourcePathById = new Map([
    ['b-0', '/audio/b/0.flac'],
    ['b-1', '/audio/b/1.flac'],
    ['b-2', '/audio/b/2.flac'],
  ])
  // b-0 uses the cached cover; b-1 already has an active thumbnail; b-2 has no
  // cached cover at all and therefore nothing to pin.
  const rows = [
    { id: 'b-0' },
    { id: 'b-1', coverThumbnail: cover('blob:active') },
    { id: 'b-2' },
  ]
  assert.deepEqual([...readOnlyArtworkFallbackPaths(rows, sourcePathById, artworkByPath)], ['/audio/b/0.flac'])
  assert.equal(readOnlyArtworkFallbackPaths([], sourcePathById, artworkByPath).size, 0)
})

test('eviction protects demanded and displayed covers before the oldest resident', () => {
  const desired = new Set(['demanded'])
  const pinned = new Set(['displayed'])
  assert.equal(selectArtworkEvictionKey(['old-cache', 'demanded', 'displayed'], desired, pinned), 'old-cache')
  assert.equal(selectArtworkEvictionKey([], desired, pinned), undefined)
})

test('a displayed cover outlives an unpinned demanded one', () => {
  // Re-reading a demanded resident is recoverable; revoking a displayed URL is
  // not, so the unpinned demanded entry leaves first.
  assert.equal(selectArtworkEvictionKey(['demanded', 'displayed'], new Set(['demanded']), new Set(['displayed'])), 'demanded')
})

test('the bounded cache still evicts when every resident is displayed', () => {
  assert.equal(
    selectArtworkEvictionKey(['pinned-a', 'pinned-b'], new Set(), new Set(['pinned-a', 'pinned-b'])),
    'pinned-a',
  )
})
