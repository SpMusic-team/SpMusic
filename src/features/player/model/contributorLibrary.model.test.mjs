import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const moduleUrl = async name => url(compile(await readFile(new URL(name, import.meta.url), 'utf8')))
const summaryUrl = await moduleUrl('./playlistTrackSummary.ts')
const selectionUrl = await moduleUrl('./folderSelection.ts')
const hierarchyUrl = url(compile(await readFile(new URL('./folderHierarchy.ts', import.meta.url), 'utf8')).replace("'./playlistTrackSummary'", JSON.stringify(summaryUrl)).replace("'./folderSelection'", JSON.stringify(selectionUrl)))
const quickUrl = await moduleUrl('./quickIndex.ts')
const albumUrl = url(compile(await readFile(new URL('./albumLibrary.ts', import.meta.url), 'utf8')).replace("'./folderHierarchy'", JSON.stringify(hierarchyUrl)).replace("'./quickIndex'", JSON.stringify(quickUrl)))
const artistUrl = url(compile(await readFile(new URL('./artistLibrary.ts', import.meta.url), 'utf8')).replaceAll("'./albumLibrary'", JSON.stringify(albumUrl)).replace("'./quickIndex'", JSON.stringify(quickUrl)))
const { artistEntries, artistAlbums, artistRoute, uniqueArtistSongs } = await import(artistUrl)
const { playlistTrackRowFromSummary, playlistTrackRowEqual, pendingPlaylistTrackRow } = await import(summaryUrl)
const song = (id, artist, albumArtist, composer, album = 'Album') => ({
  key: `/music/${id}.flac`, scope: `real:${id}`, trackId: id, sourcePath: `/music/${id}.flac`, available: true,
  track: { id, title: id, artist: 'Display fallback', album, libraryArtistName: artist, albumArtist, libraryComposerName: composer, libraryAlbumName: album, libraryYear: 2023 },
})
const categories = ['artist', 'album-artist', 'composer']

test('three contributor categories use independent raw tags and namespace identities', () => {
  const track = song('one', 'Performer', 'Album Credit', 'Writer')
  assert.deepEqual(categories.map(category => artistEntries([track], category).map(entry => entry.name)), [['Performer'], ['Album Credit'], ['Writer']])
  const same = song('same', 'Shared Name', 'Shared Name', 'Shared Name')
  assert.equal(new Set(categories.map(category => artistEntries([same], category)[0].key)).size, 3)
  assert.deepEqual(categories.map(category => JSON.parse(artistEntries([same], category)[0].key)[0]), categories)
})

test('absent tags do not borrow performer, other contributor, or display fallback', () => {
  const missing = song('missing', 'Performer Only', null, null)
  const pending = song('pending', 'Other Performer', undefined, undefined)
  for (const [category, label] of [['album-artist', '未知专辑艺术家'], ['composer', '未知作曲家']]) {
    const entries = artistEntries([missing, pending], category)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].name, label)
    assert.deepEqual(entries[0].songs.map(track => track.trackId), ['missing'])
    assert.equal(JSON.parse(entries[0].key)[1], null)
    const literal = song('literal', null, label, label)
    const withLiteral = artistEntries([missing, literal], category)
    assert.equal(withLiteral.length, 2)
    assert.equal(withLiteral[0].name, withLiteral[1].name)
    assert.notEqual(withLiteral[0].key, withLiteral[1].key)
  }
})

test('both new categories split, deduplicate and preserve approved exceptions', () => {
  const duet = song('duet', 'Performer', ' A / B / A // ', ' A / B / A // ')
  const band = song('band', 'Performer', 'AC/DC/+/-', 'AC/DC/+/-')
  for (const category of ['album-artist', 'composer']) {
    const entries = artistEntries([duet, { ...duet, scope: 'duplicate' }, band], category)
    assert.deepEqual(entries.map(entry => entry.name).sort(), ['+/-', 'A', 'AC/DC', 'B'].sort())
    assert.deepEqual(entries.find(entry => entry.name === 'A').songs, [duet])
    assert.equal(uniqueArtistSongs(entries.flatMap(entry => entry.songs)).length, 2)
    assert.equal(entries.find(entry => entry.name === 'AC/DC').songs[0], band)
  }
})

test('contributor albums contain only selected member songs and retain base album grouping and years', () => {
  const a = song('a', 'Singer A', 'Ensemble', 'Writer One')
  const b = song('b', 'Singer B', 'Ensemble', 'Writer Two')
  const duet = song('duet', 'Singer C', 'Ensemble/Guest', 'Writer One/Writer Two')
  a.track.libraryYear = 2023; b.track.libraryYear = 1999; duet.track.libraryYear = 2024
  const composer = artistEntries([a, b, duet], 'composer').find(entry => entry.name === 'Writer One')
  assert.deepEqual(composer.songs.map(track => track.trackId), ['a', 'duet'])
  const albums = artistAlbums(composer)
  assert(!albums.some(album => album.songs.includes(b)), 'other composers cannot enter album playback through shared album membership')
  assert(albums.every(album => album.year >= 2023), 'other composer year cannot affect the scoped albums')
  assert.deepEqual(uniqueArtistSongs(albums.flatMap(album => album.songs)).map(track => track.trackId).sort(), ['a', 'duet'])
  const albumArtist = artistEntries([a, b, duet], 'album-artist').find(entry => entry.name === 'Ensemble')
  assert.deepEqual(albumArtist.songs.map(track => track.trackId), ['a', 'b', 'duet'])
})

test('route identities isolate the same name and every drilldown across all categories', () => {
  const locations = [null, { artistKey: 'same', view: 'albums' }, { artistKey: 'same', view: 'songs' }, { artistKey: 'same', view: 'album', albumKey: 'album' }]
  const routes = categories.flatMap(category => locations.map(location => artistRoute(location, category)))
  assert.equal(new Set(routes).size, routes.length)
  assert.equal(artistRoute(null), 'category:artist', 'original artist route remains compatible')
})

test('summary projection and equality retain raw composer independently from display artist', () => {
  const descriptor = { id: 'one', fileName: 'one.flac' }
  const summary = { artist: null, albumArtist: 'Ensemble', composer: ' Writer ', album: 'Album' }
  const row = playlistTrackRowFromSummary(descriptor, summary)
  assert.equal(row.artist, 'Ensemble')
  assert.equal(row.libraryArtistName, null)
  assert.equal(row.albumArtist, 'Ensemble')
  assert.equal(row.libraryComposerName, 'Writer')
  assert.equal(playlistTrackRowEqual(row, { ...row, libraryComposerName: 'Other Writer' }), false)
  assert.equal(playlistTrackRowFromSummary(descriptor, { ...summary, composer: null }).libraryComposerName, null)
  assert.equal(pendingPlaylistTrackRow(descriptor).libraryComposerName, undefined)
})
