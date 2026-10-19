import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chunkPlaylistSummaryPaths,
  pendingPlaylistTrackRow,
  playlistDescriptorFingerprint,
  playlistSummaryProbePaths,
  playlistTrackRowEqual,
  playlistTrackRowFromSummary,
} from './playlistTrackSummary.ts'

const descriptor = {
  id: 'a-1',
  sourcePath: '/audio/a/1.flac',
  fileName: '1.flac',
  available: true,
}

// The fallback rules below are the ones `audioTrackToPlaylistVisual` uses for the
// expensive hydration path (title → file name, artist → album artist → 本地音频,
// album → 本地音频, cover tone from the track id). Both mappers must agree or the
// rows would jump once hydration lands.
test('a fully tagged summary keeps every field the hydrated row publishes', () => {
  const tagged = playlistTrackRowFromSummary(descriptor, {
    title: 'Song a 1',
    artist: 'Artist a',
    album: 'Album a',
    albumArtist: 'Album Artist a',
    bitDepth: 24,
    sampleRateHz: 96000,
    bitrateKbps: 2304,
    codec: 'FLAC',
  })
  assert.deepEqual(tagged, {
    id: 'a-1',
    title: 'Song a 1',
    artist: 'Artist a',
    album: 'Album a',
    // The tag channel never publishes a duration: it stays with the hydration and
    // duration-probe channels so a tag header estimate cannot flip a total.
    durationSeconds: 0,
    fileExtension: 'flac',
    coverTone: tagged.coverTone,
    audioFormat: { bitDepth: 24, sampleRateHz: 96000, bitrateKbps: 2304, codec: 'FLAC' },
  })
  // The cover tone is the descriptor id's stable hash, never a random value.
  assert.equal(
    playlistTrackRowFromSummary(descriptor, null).coverTone,
    tagged.coverTone,
  )
  assert.equal(
    playlistTrackRowFromSummary({ ...descriptor, id: 'zzz' }, null).coverTone,
    playlistTrackRowFromSummary({ ...descriptor, id: 'zzz' }, null).coverTone,
  )
})

test('blank tags fall back to the file name and the local defaults', () => {
  const row = playlistTrackRowFromSummary(descriptor, {
    title: '   ',
    artist: '',
    album: '\t',
    albumArtist: 'Album Artist a',
    bitDepth: null,
    sampleRateHz: null,
    bitrateKbps: null,
    codec: null,
  })
  assert.equal(row.title, '1')
  assert.equal(row.artist, 'Album Artist a')
  assert.equal(row.album, '本地音频')
  assert.equal(row.durationSeconds, 0)
  assert.equal(row.audioFormat, undefined)
  assert.equal(row.fileExtension, 'flac')
})

test('a fully tagless file still produces a readable row, and a failed item produces the same defaults', () => {
  const untagged = playlistTrackRowFromSummary(descriptor, {
    title: null,
    artist: null,
    album: null,
    albumArtist: null,
    bitDepth: null,
    sampleRateHz: null,
    bitrateKbps: null,
    codec: null,
  })
  assert.deepEqual(
    { title: untagged.title, artist: untagged.artist, album: untagged.album, durationSeconds: untagged.durationSeconds },
    { title: '1', artist: '本地音频', album: '本地音频', durationSeconds: 0 },
  )
  // A degraded pass keeps the file-name row rather than a fabricated playlist name.
  assert.deepEqual(playlistTrackRowFromSummary(descriptor, null), untagged)
})

test('the pending row never fabricates an artist or an album', () => {
  const pending = pendingPlaylistTrackRow({ id: 'a-2', fileName: '2.mp3' })
  assert.deepEqual(pending, { id: 'a-2', title: '2', artist: '', album: '' })
  assert.notEqual(pending.artist, 'Playlist a')
  assert.notEqual(pending.artist, '本地音频')
  assert.notEqual(pending.album, '本地音频')
})

test('rows compare field by field so unchanged batches are not republished', () => {
  const summary = {
    title: 'Song a 1',
    artist: 'Artist a',
    album: 'Album a',
    albumArtist: null,
    bitDepth: 24,
    sampleRateHz: 96000,
    bitrateKbps: null,
    codec: 'FLAC',
  }
  const row = playlistTrackRowFromSummary(descriptor, summary)
  assert.equal(playlistTrackRowEqual(row, playlistTrackRowFromSummary(descriptor, summary)), true)
  assert.equal(playlistTrackRowEqual(row, playlistTrackRowFromSummary(descriptor, { ...summary, artist: 'Other' })), false)
  assert.equal(playlistTrackRowEqual(row, playlistTrackRowFromSummary(descriptor, { ...summary, bitDepth: 16 })), false)
})

test('probe batching is bounded, ordered and de-duplicates source paths', () => {
  const descriptors = [
    { id: 'a-0', sourcePath: '/audio/a/0.flac', available: true },
    { id: 'a-1', sourcePath: '/audio/a/1.flac', available: false },
    { id: 'a-2', sourcePath: '/audio/a/2.flac', available: true },
    { id: 'a-3', sourcePath: '/audio/a/2.flac', available: true },
  ]
  const { paths, descriptorsByPath } = playlistSummaryProbePaths(descriptors)
  assert.deepEqual(paths, ['/audio/a/0.flac', '/audio/a/2.flac'])
  assert.deepEqual(descriptorsByPath.get('/audio/a/2.flac'), ['a-2', 'a-3'])
  assert.equal(descriptorsByPath.has('/audio/a/1.flac'), false)

  const many = Array.from({ length: 600 }, (_, index) => `/audio/big/${index}.flac`)
  const batches = chunkPlaylistSummaryPaths(many, 256)
  assert.deepEqual(batches.map((batch) => batch.length), [256, 256, 88])
  assert.deepEqual(batches.flat(), many)
  assert.deepEqual(chunkPlaylistSummaryPaths([], 256), [])
})

test('the descriptor fingerprint invalidates on id or path changes only', () => {
  const base = [
    { id: 'a-0', sourcePath: '/audio/a/0.flac' },
    { id: 'a-1', sourcePath: '/audio/a/1.flac' },
  ]
  assert.equal(playlistDescriptorFingerprint(base), playlistDescriptorFingerprint([...base]))
  // Separator normalization keeps an unchanged list stable.
  assert.equal(
    playlistDescriptorFingerprint(base),
    playlistDescriptorFingerprint([
      { id: 'a-0', sourcePath: '\\audio\\a\\0.flac' },
      { id: 'a-1', sourcePath: '\\audio\\a\\1.flac' },
    ]),
  )
  assert.notEqual(playlistDescriptorFingerprint(base), playlistDescriptorFingerprint(base.slice(0, 1)))
  assert.notEqual(
    playlistDescriptorFingerprint(base),
    playlistDescriptorFingerprint([base[0]!, { id: 'a-1', sourcePath: '/audio/a/9.flac' }]),
  )
  assert.notEqual(
    playlistDescriptorFingerprint(base),
    playlistDescriptorFingerprint([{ id: 'a-1', sourcePath: '/audio/a/0.flac' }, { id: 'a-0', sourcePath: '/audio/a/1.flac' }]),
  )
})
