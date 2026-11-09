import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const modules = new Map()
const moduleUrl = async file => {
  if (modules.has(file.href)) return modules.get(file.href)
  let source = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  for (const path of new Set([...source.matchAll(/from ['"](\.[^'"]+)['"]/g)].map(match => match[1]))) {
    const dependency = await moduleUrl(new URL(path + '.ts', file))
    source = source.replaceAll("'" + path + "'", JSON.stringify(dependency)).replaceAll('"' + path + '"', JSON.stringify(dependency))
  }
  const result = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  modules.set(file.href, result)
  return result
}
const model = await import(await moduleUrl(new URL('./genreLibrary.ts', import.meta.url)))
const { splitGenres, genreEntries, genreAlbums, genreRoute } = model
const song = (id, genre, album = 'Mixed') => ({
  key: '/music/' + album + '/' + id + '.flac', scope: 'real-scope:' + id, trackId: id,
  sourcePath: '/music/' + album + '/' + id + '.flac', available: true,
  track: { id, title: id, artist: 'Singer', libraryArtistName: 'Singer', album, libraryAlbumName: album, albumArtist: 'Ensemble', libraryGenreName: genre, durationSeconds: 180 },
})
const ids = songs => songs.map(item => item.trackId).sort()

test('split supported multi-value separators, preserve single slash and avoid duplicate memberships', () => {
  assert.deepEqual(splitGenres(' Rock; Pop； Electronic // Ambient $ Jazz ; Rock ;; '), ['Rock', 'Pop', 'Electronic', 'Ambient', 'Jazz'])
  assert.deepEqual(splitGenres('Pop/Rock'), ['Pop/Rock'])
  assert.deepEqual(splitGenres(' ;；//$ '), [])
  assert.deepEqual(splitGenres('Rock;rock;Rock'), ['Rock', 'rock'], 'case-sensitive identities are distinct from case-insensitive display sorting')
})

test('pending genres are absent; completed empty tags use an identity separate from the literal unknown label', () => {
  const entries = genreEntries([song('pending', undefined), song('null', null), song('blank', ' '), song('literal', '未知流派')])
  assert.equal(entries.length, 2)
  const unknown = entries.find(entry => entry.key === JSON.stringify(['genre', null]))
  const literal = entries.find(entry => entry.key === JSON.stringify(['genre', '未知流派']))
  assert.deepEqual(ids(unknown.songs), ['blank', 'null'])
  assert.deepEqual(ids(literal.songs), ['literal'])
  assert.equal(entries.some(entry => entry.songs.some(item => item.trackId === 'pending')), false)
})

test('repeat scan roots count each physical song once and never rewrite native playback identities or tags', () => {
  const original = song('a', 'Rock; Pop;Rock')
  const input = Object.freeze([Object.freeze({ ...original, track: Object.freeze(original.track) }), { ...original, scope: 'duplicate-root' }, song('b', 'Rock')])
  const entries = genreEntries(input)
  const rock = entries.find(entry => entry.name === 'Rock'), pop = entries.find(entry => entry.name === 'Pop')
  assert.deepEqual(ids(rock.songs), ['a', 'b'])
  assert.deepEqual(ids(pop.songs), ['a'])
  assert.equal(rock.songs[0].scope, 'real-scope:a')
  assert.equal(original.track.libraryGenreName, 'Rock; Pop;Rock')
})

test('genre albums include only genre-filtered members, including mixed-genre albums', () => {
  const a = song('a', 'Rock;Pop'), b = song('b', 'Jazz'), c = song('c', 'Rock'), d = song('d', 'Pop', 'Solo')
  const entries = genreEntries([a, b, c, d])
  const rock = entries.find(entry => entry.name === 'Rock'), pop = entries.find(entry => entry.name === 'Pop')
  const rockAlbums = genreAlbums(rock), popAlbums = genreAlbums(pop)
  assert.equal(rockAlbums.length, 1)
  assert.deepEqual(ids(rockAlbums[0].songs), ['a', 'c'])
  assert.equal(popAlbums.length, 2)
  assert.deepEqual(ids(popAlbums.flatMap(entry => entry.songs)), ['a', 'd'])
  assert.deepEqual(genreAlbums(undefined), [])
  assert(!rockAlbums[0].songs.includes(b), 'a Jazz member of the same global album cannot leak into the Rock album')
})

test('routes distinguish root, flat songs, albums and album tracks, with arbitrary encoded genre names', () => {
  const genreKey = JSON.stringify(['genre', 'Rock / "Pop";:[]'])
  const locations = [null, { genreKey, view: 'albums' }, { genreKey, view: 'songs' }, { genreKey, view: 'album', albumKey: 'album:a:b' }]
  assert.equal(new Set(locations.map(genreRoute)).size, 4)
  assert.equal(genreRoute(null), 'category:genre')
})

test('four sorting scopes persist independently, validate stored data, and isolate year preferences', () => {
  const cache = new Map()
  globalThis.localStorage = { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) }
  for (const scope of ['root', 'albums', 'songs', 'album-tracks']) {
    const sort = { field: scope === 'root' || scope === 'albums' ? 'name' : 'title', direction: scope === 'root' ? 'asc' : 'desc' }
    model.writeGenreSort(scope, sort)
    assert.deepEqual(model.readGenreSort(scope), sort)
  }
  assert.equal(cache.size, 4)
  cache.set('spmusic.year-root.sort.v1', JSON.stringify({ field: 'year', direction: 'desc' }))
  cache.set('spmusic.genre-songs.sort.v1', '{broken')
  assert.deepEqual(model.readGenreSort('songs'), { field: 'title', direction: 'asc' })
  assert.deepEqual(model.readGenreSort('root'), { field: 'name', direction: 'asc' })
  assert.equal(JSON.parse(cache.get('spmusic.year-root.sort.v1')).field, 'year')
  delete globalThis.localStorage
})

test('sorting changes display order without mutating source membership', () => {
  const source = [song('a', 'Rock'), song('b', 'Pop'), song('c', 'Rock')]
  const entries = genreEntries(source), names = entries.map(entry => entry.name)
  assert.deepEqual(model.sortGenreEntries(entries, { field: 'count', direction: 'desc' }).map(entry => entry.name), ['Rock', 'Pop'])
  assert.deepEqual(entries.map(entry => entry.name), names)
  assert.deepEqual(ids(model.sortGenreSongs(source, { field: 'title', direction: 'desc' })), ['a', 'b', 'c'])
  assert.deepEqual(model.sortGenreSongs(source, { field: 'title', direction: 'desc' }).map(item => item.trackId), ['c', 'b', 'a'])
})
