import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const cache = new Map()
async function moduleUrl(file) {
  if (cache.has(file.href)) return cache.get(file.href)
  let source = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  for (const match of [...source.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    if (!match[1].startsWith('.')) continue
    source = source.replace(match[0], `from '${await moduleUrl(new URL(match[1] + '.ts', file))}'`)
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  cache.set(file.href, url)
  return url
}
const streams = await import(await moduleUrl(new URL('./streams.ts', import.meta.url)))
const summary = await import(await moduleUrl(new URL('./playlistTrackSummary.ts', import.meta.url)))
const song = (id, title) => ({ key: id, trackId: id, sourcePath: `https://radio.test/${id}`, track: { title } })

test('network identity retains path/query case and excludes local path normalization', () => {
  assert.equal(streams.validateStreamAddress(' HTTPS://Radio.Test/Show?Token=ABC '), 'https://radio.test/Show?Token=ABC')
  assert.equal(streams.validateStreamAddress('ftp://radio.test/a'), null)
  assert.equal(streams.validateStreamAddress('https://user:secret@radio.test/a'), null)
  assert.notEqual(summary.normalizeAudioSourcePath('https://radio.test/Show?Token=ABC'), summary.normalizeAudioSourcePath('https://radio.test/show?Token=abc'))
  assert.equal(summary.normalizeAudioSourcePath('C:\\Music\\Track.flac'), 'C:/Music/Track.flac')
})

test('stream summary preserves supplied name and has no fabricated local tags or duration', () => {
  const descriptor = { id: 'radio', fileName: 'https://radio.test/Show', sourcePath: 'https://radio.test/Show', sourceKind: 'stream', title: '  My Radio  ', available: true }
  const row = summary.playlistTrackRowFromSummary(descriptor, null)
  assert.equal(row.title, 'My Radio')
  assert.equal(row.artist, '')
  assert.equal(row.album, '')
  assert.deepEqual(row.stream, { url: descriptor.sourcePath, stationName: undefined })
  assert.equal(row.durationSeconds, 0)
  assert.equal(row.libraryAlbumName, undefined)
  assert.deepEqual(summary.playlistSummaryProbePaths([descriptor]).paths, [])
})

test('stream display resolves explicit name before station name and keeps URL separate', () => {
  const url = 'https://radio.test/Show?Token=ABC'
  const descriptor = { id: 'radio', fileName: url, sourcePath: url, sourceKind: 'stream', title: url, stationName: '  Groove Salad  ' }
  assert.equal(summary.streamTrackTitle(descriptor), 'Groove Salad')
  assert.equal(summary.streamTrackTitle({ ...descriptor, title: 'My station' }), 'My station')
  assert.equal(summary.streamTrackTitle({ ...descriptor, title: 7, stationName: {} }), url)
  const pending = summary.pendingPlaylistTrackRow(descriptor)
  assert.equal(pending.title, 'Groove Salad')
  assert.deepEqual(pending.stream, { url, stationName: 'Groove Salad' })
  assert.equal(summary.playlistCardContentShape(pending), 31)
  assert.equal(summary.playlistCardContentShape({ title: 'Local song', artist: '', album: '' }), 1)
})

test('six sorts use independent real records and retain shuffle order without mutating source', () => {
  const songs = Object.freeze([song('A', 'Alpha'), song('B', 'Beta'), song('C', 'Gamma')])
  const counts = [{ sourcePath: songs[2].sourcePath, playCount: 5, lastPlayedAt: 900 }]
  const recents = [{ sourcePath: songs[0].sourcePath, lastPlayedAt: 800 }]
  const descriptors = [{ id: 'A', createdAtMs: 1 }, { id: 'B', createdAtMs: 3 }, { id: 'C', createdAtMs: 2 }]
  const order = mode => streams.sortStreamSongs(songs, mode, counts, { B: 5, C: 1 }, descriptors, ['C', 'A', 'B'], recents).map(row => row.trackId)
  assert.equal(streams.STREAM_SORTS.length, 6)
  assert.deepEqual(order('name'), ['A', 'B', 'C'])
  assert.deepEqual(order('rating'), ['B', 'C', 'A'])
  assert.deepEqual(order('play-count'), ['C', 'A', 'B'])
  assert.deepEqual(order('last-played'), ['A', 'B', 'C'])
  assert.deepEqual(order('created'), ['B', 'C', 'A'])
  assert.deepEqual(order('shuffle'), ['C', 'A', 'B'])
  assert.deepEqual(order('shuffle'), ['C', 'A', 'B'])
  assert.deepEqual(songs.map(row => row.trackId), ['A', 'B', 'C'])
})


test('rating sorting retains all intermediate scores above unrated tracks', () => {
  const songs = [0, 1, 2, 3, 4, 5].map(n => song(String(n), String(9-n)))
  const ratings = { '1':1, '2':2, '3':3, '4':4, '5':5 }
  assert.deepEqual(streams.sortStreamSongs(songs, 'rating', [], ratings, [], []).map(row => row.trackId), ['5','4','3','2','1','0'])
})
