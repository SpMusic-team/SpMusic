import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const cache = new Map()
async function moduleUrl(file) {
  if (cache.has(file.href)) return cache.get(file.href)
  let source = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
  for (const match of [...source.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    if (!match[1].startsWith('.')) continue
    const dependency = await moduleUrl(new URL(match[1] + '.ts', file))
    source = source.replace(match[0], `from '${dependency}'`)
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  cache.set(file.href, url)
  return url
}
const { searchLibrary, uniqueSearchSongs } = await import(await moduleUrl(new URL('./librarySearch.ts', import.meta.url)))
const { playlistTrackRowFromSummary, playlistTrackRowEqual } = await import(await moduleUrl(new URL('./playlistTrackSummary.ts', import.meta.url)))
const song = (scope, path, tags = {}) => ({ key: path, scope, trackId: path, sourcePath: path, available: true,
  track: { id: path, title: path, artist: 'Singer', album: 'Record', libraryArtistName: 'Singer', libraryAlbumName: 'Record', libraryYear: 2023, libraryGenreName: 'Jazz', ...tags } })

test('shared source paths remain present in each playlist while song and aggregate queues deduplicate', () => {
  const sharedA = song('A', 'C:/Music/shared.flac')
  const sharedB = song('B', 'C:/Music/shared.flac')
  const library = { allSongs: [sharedA, sharedB, song('B', 'C:/Music/other.flac')], items: [{ scope: 'A', name: 'One', sourceKind: 'custom' }, { scope: 'B', name: 'Two', sourceKind: 'custom' }] }
  const playlists = searchLibrary(library, '', ['playlists'])[0].collections
  assert.deepEqual(playlists.map(item => item.songs.map(song => song.scope)), [['A'], ['B', 'B']])
  assert.equal(searchLibrary(library, '', ['songs'])[0].songs.length, 2)
  assert.equal(uniqueSearchSongs(playlists.flatMap(item => item.songs)).length, 2)
})

test('aggregated matching respects category selection and real artist/year/genre tags', () => {
  const library = { allSongs: [song('A', 'one', { title: 'Moon' }), song('A', 'two', { libraryArtistName: 'Guest', libraryGenreName: 'Rock', libraryYear: 2024 })], items: [] }
  assert.equal(searchLibrary(library, 'singer', ['artist'])[0].collections[0].name, 'Singer')
  assert.deepEqual(searchLibrary(library, 'jazz', ['genre'])[0].collections.map(item => item.name), ['Jazz'])
  assert.deepEqual(searchLibrary(library, '2024', ['year'])[0].collections.map(item => item.name), ['2024'])
  assert.equal(searchLibrary(library, ' MOON ', ['songs'])[0].songs[0].track.title, 'Moon')
  assert.deepEqual(searchLibrary(library, '', []), [])
  assert.equal(searchLibrary(library, '', ['streams'])[0].songs.length, 0)
})

test('pending tags do not create unknown groups, completed null tags do', () => {
  const library = { allSongs: [song('A', 'pending', { libraryGenreName: undefined, libraryYear: undefined }), song('A', 'read', { libraryGenreName: null, libraryYear: null })], items: [] }
  const sections = searchLibrary(library, '', ['genre', 'year'])
  assert.deepEqual(sections.map(section => section.collections.map(item => [item.name, item.songs.length])), [[['未知流派', 1]], [['未知年份', 1]]])
})

test('genre summary changes survive row equality and trims missing values to null', () => {
  const descriptor = { id: 'one', fileName: 'one.flac' }
  const jazz = playlistTrackRowFromSummary(descriptor, { genre: ' Jazz ' })
  const rock = playlistTrackRowFromSummary(descriptor, { genre: 'Rock' })
  assert.equal(jazz.libraryGenreName, 'Jazz')
  assert.equal(playlistTrackRowEqual(jazz, rock), false)
  assert.equal(playlistTrackRowFromSummary(descriptor, null).libraryGenreName, null)
})
