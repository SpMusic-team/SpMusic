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
const model = await import(await moduleUrl(new URL('./yearLibrary.ts', import.meta.url)))
const { normalizeYear, yearEntries, yearAlbums, yearRoute } = model
const { albumEntries } = await import(await moduleUrl(new URL('./albumLibrary.ts', import.meta.url)))
const song = (id, year, album = 'Mixed', albumArtist = 'Ensemble') => ({
  key: '/music/' + album + '/' + id + '.flac', scope: 'real-scope:' + id, trackId: id,
  sourcePath: '/music/' + album + '/' + id + '.flac', available: true,
  track: { id, title: id, artist: 'Singer', libraryArtistName: 'Singer', album, libraryAlbumName: album, albumArtist, libraryYear: year },
})
const ids = songs => songs.map(item => item.trackId).sort()

test('actual OST tags join different track artists in one directory and inherit the known year', () => {
  const known = song('「吾导先路」殉道者（第五个）', 2022, '《明日方舟》游戏原声OST', null)
  const missing = song('「如我所见」夜幕', null, known.track.album, null)
  for (const [item, artist, extension] of [[known, 'Mentalmeisters', 'flac'], [missing, '塞壬唱片-MSR', 'mp3']]) {
    item.track.artist = item.track.libraryArtistName = artist
    item.key = item.sourcePath = 'E:/Music/' + artist + ' - ' + item.track.title + '.' + extension
  }
  const input = Object.freeze([known, missing].map(item => Object.freeze({ ...item, track: Object.freeze(item.track) })))
  for (const members of [input, [...input].reverse(), [...input, { ...input[1], scope: 'duplicate-root' }]]) {
    const albums = albumEntries(members), years = yearEntries(members)
    assert.equal(albums.length, 1)
    assert.equal(albums[0].year, 2022)
    assert.deepEqual(ids(albums[0].songs), ids(input))
    assert.deepEqual(years.map(entry => entry.year), [2022])
    assert.deepEqual(ids(years[0].songs), ids(input))
    assert.equal(yearAlbums(albums, null).length, 0)
    assert.equal(yearAlbums(albums, 2022)[0], albums[0])
  }
  assert.equal(input[1].track.libraryYear, null)
  assert.equal(input[1].scope, 'real-scope:「如我所见」夜幕')
})

test('directory compilation inheritance keeps pending and valid years intact without crossing explicit or directory boundaries', () => {
  const known = song('known', 2022, 'OST', null), missing = song('missing', null, 'OST', null)
  const pending = song('pending', undefined, 'OST', null), later = song('later', 2024, 'OST', null)
  const elsewhere = song('elsewhere', null, 'OST', null), explicit = song('explicit', null, 'OST', 'Singer')
  missing.track.libraryArtistName = 'Other'
  elsewhere.key = elsewhere.sourcePath = '/other/OST/elsewhere.flac'
  const input = [known, missing, pending, later, elsewhere, explicit]
  const years = model.yearEffectiveYears(input), albums = albumEntries(input)
  assert.equal(years.get(known.key), 2022); assert.equal(years.get(missing.key), 2022)
  assert.equal(years.get(pending.key), undefined); assert.equal(years.get(later.key), 2024)
  assert.equal(years.get(elsewhere.key), null); assert.equal(years.get(explicit.key), null)
  assert(!yearEntries(input).some(entry => entry.year === null))
  assert.deepEqual(ids(yearEntries(input).flatMap(entry => entry.songs)), ['known', 'later', 'missing'])
  assert.equal(yearAlbums(albums, 2022).length, 1)
  assert.deepEqual(ids(yearAlbums(albums, 2022)[0].songs), ['known', 'later', 'missing', 'pending'])
  assert.equal(yearAlbums(albums, null).length, 0)
})

test('normalization separates pending from completed invalid and accepts the existing u32 domain', () => {
  assert.equal(normalizeYear(undefined), undefined)
  for (const input of [null, 0, -1, 2023.5, NaN, Infinity, '2023', 4294967296]) assert.equal(normalizeYear(input), null)
  for (const input of [1, 2018, 4294967295]) assert.equal(normalizeYear(input), input)
})

test('year root defaults newest first and excludes pending and unresolved completed years', () => {
  const input = [song('a', 2018), song('b', 2026), song('c', null, 'Unknown'), song('d', undefined), song('e', 0, 'Invalid'), song('f', 2019)]
  const root = yearEntries(input)
  assert.deepEqual(root.map(item => item.year), [2026, 2019, 2018])
  assert.deepEqual(ids(root.flatMap(item => item.songs)), ['a', 'b', 'f'])
  assert(!root.some(item => item.songs.some(member => member.trackId === 'd')))
  assert.equal(new Set(root.map(item => item.key)).size, root.length)
})

test('overlapping roots deduplicate real song keys and retain first playback identity without mutating inputs', () => {
  const first = song('a', 2018), duplicate = { ...first, scope: 'duplicate-scope', trackId: 'duplicate-id' }
  const input = Object.freeze([Object.freeze(first), Object.freeze(duplicate), Object.freeze(song('b', 2018))])
  const entry = yearEntries(input)[0]
  assert.deepEqual(ids(entry.songs), ['a', 'b'])
  assert.equal(entry.songs.find(item => item.trackId === 'a'), first)
  assert.equal(entry.songs.find(item => item.trackId === 'a').scope, 'real-scope:a')
  assert.deepEqual(input, [first, duplicate, input[2]])
})

test('mixed-year album keeps its full membership while missing-year flat songs inherit the album earliest valid year', () => {
  const input = [song('a', 2018), song('b', 2019), song('c', null), song('other', 2019, 'Other')]
  const root = yearEntries(input), albums = albumEntries(input)
  assert.deepEqual(ids(root.find(item => item.year === 2018).songs), ['a', 'c'])
  assert.deepEqual(ids(root.find(item => item.year === 2019).songs), ['b', 'other'])
  assert(!root.some(item => item.year === null), 'a missing-year member of a known-year album no longer creates an unknown-year category')
  const year2018 = yearAlbums(albums, 2018)
  assert.equal(year2018.length, 1)
  assert.equal(year2018[0].name, 'Mixed')
  assert.deepEqual(ids(year2018[0].songs), ['a', 'b', 'c'])
  assert.equal(year2018[0], albums.find(item => item.name === 'Mixed'), 'reuse complete global album rather than regroup a year subset')
  assert.deepEqual(yearAlbums(albums, 2019).map(item => item.name), ['Other'])
  assert.deepEqual(yearAlbums(albums, null), [], 'a missing-year track does not make its known-year album unknown')
})

test('derived missing year respects complete album credit identity even when titles match', () => {
  const a = song('a', 2018, 'Same', 'A'), missingA = song('missing-a', null, 'Same', 'A')
  const b = song('b', 2022, 'Same', 'B'), missingB = song('missing-b', null, 'Same', 'B')
  const unknownC = song('unknown-c', null, 'Same', 'C'), invalidA = song('invalid-a', 0, 'Same', 'A')
  const root = yearEntries([a, missingA, b, missingB, unknownC, invalidA])
  assert.deepEqual(ids(root.find(item => item.year === 2018).songs), ['a', 'invalid-a', 'missing-a'])
  assert.deepEqual(ids(root.find(item => item.year === 2022).songs), ['b', 'missing-b'])
  assert(!root.some(item => item.year === null))
  assert(!root.some(item => item.songs.includes(unknownC)))
})

test('album fallback does not infer pending songs, overwrite valid tags, mutate raw metadata or replace playable identity', () => {
  const a = song('a', 2018), b = song('b', 2019), missing = song('missing', null), pending = song('pending', undefined)
  const input = Object.freeze([a, b, missing, pending].map(item => Object.freeze({ ...item, track: Object.freeze({ ...item.track }) })))
  const before = input.map(item => [item.key, item.scope, item.trackId, item.track.libraryYear])
  const root = yearEntries(input)
  assert.deepEqual(ids(root.find(item => item.year === 2018).songs), ['a', 'missing'])
  assert.deepEqual(ids(root.find(item => item.year === 2019).songs), ['b'])
  assert(!root.some(entry => entry.songs.some(item => item.trackId === 'pending')))
  assert.equal(root.find(item => item.year === 2018).songs.find(item => item.trackId === 'missing'), input[2])
  assert.deepEqual(input.map(item => [item.key, item.scope, item.trackId, item.track.libraryYear]), before)
})

test('effective year map supplies full-library fallback to subset year sorting without changing raw tags', () => {
  const a = song('a', 2018), b = song('b', 2019), c = song('c', null), pending = song('pending', undefined)
  const all = [a, b, c, pending], effective = model.yearEffectiveYears(all)
  assert.equal(effective.get(a.key), 2018); assert.equal(effective.get(b.key), 2019)
  assert.equal(effective.get(c.key), 2018); assert.equal(effective.get(pending.key), undefined)
  const subset = [song('other', 2017, 'Other'), c]
  assert.deepEqual(model.sortYearSongs(subset, { field: 'year', direction: 'desc' }, effective).map(item => item.trackId), ['c', 'other'], 'subset cannot regroup missing member without its known-year sibling')
  assert.deepEqual(model.sortYearSongs([a, b, c], { field: 'year', direction: 'asc' }, effective).map(item => item.trackId), ['a', 'c', 'b'])
  assert.equal(c.track.libraryYear, null)
})

test('only unknown and pending input produces an empty year view without changing the full library', () => {
  const input = Object.freeze([song('unknown', null, 'Unknown'), song('invalid', 0, 'Invalid'), song('pending', undefined, 'Pending')]
    .map(item => Object.freeze({ ...item, track: Object.freeze(item.track) })))
  const root = yearEntries(input)
  assert.deepEqual(root, [])
  const albums = albumEntries(input), effective = model.yearEffectiveYears(input)
  assert.deepEqual(yearAlbums(albums, null), [])
  assert.deepEqual(ids(albums.flatMap(item => item.songs)), ['invalid', 'pending', 'unknown'])
  assert.equal(effective.get(input[0].key), null); assert.equal(effective.get(input[1].key), null)
  assert.equal(effective.get(input[2].key), undefined)
  assert.deepEqual(input.map(item => item.track.libraryYear), [null, 0, undefined])
})

test('changing metadata moves the album year without changing album identity or playable members', () => {
  const input = [song('a', 2018), song('b', 2019)]
  const before = albumEntries(input)[0]
  input[0].track.libraryYear = 2020
  const after = albumEntries(input)[0]
  assert.equal(after.key, before.key)
  assert.equal(after.year, 2019)
  assert.equal(yearAlbums([after], 2018).length, 0)
  assert.equal(yearAlbums([after], 2019)[0], after)
  assert.deepEqual(ids(after.songs), ['a', 'b'])
})

test('route identity distinguishes root, unknown year, all songs, albums and album keys with punctuation', () => {
  const locations = [null, { year: null, view: 'albums' }, { year: null, view: 'songs' },
    { year: 2018, view: 'albums' }, { year: 2018, view: 'songs' },
    { year: 2018, view: 'album', albumKey: '["album","a:b"]' },
    { year: 2019, view: 'album', albumKey: '["album","a:b"]' },
    { year: 2018, view: 'album', albumKey: '["album","a",":b"]' }]
  assert.equal(new Set(locations.map(yearRoute)).size, locations.length)
  assert.equal(yearRoute(null), 'category:year')
})

test('numeric year ordering and song counts are deterministic and omit unknown years in either direction', () => {
  const root = yearEntries([song('a', 9), song('b', 10), song('c', 10), song('missing', null, 'Unknown')])
  const original = [...root]
  assert.deepEqual(model.sortYearEntries(root, { field: 'year', direction: 'asc' }).map(item => item.year), [9, 10])
  assert.deepEqual(model.sortYearEntries(root, { field: 'year', direction: 'desc' }).map(item => item.year), [10, 9])
  assert.equal(model.sortYearEntries(root, { field: 'count', direction: 'desc' })[0].year, 10)
  assert.deepEqual(root, original, 'sorts do not mutate shared grouped entries')
})

test('song and album sorts preserve identities, use actual fields and leave absent numeric values last', () => {
  const a = song('a', null, 'Unknown'), b = song('b', 2019), c = song('c', 2018)
  a.track.durationSeconds = undefined; b.track.durationSeconds = 100; c.track.durationSeconds = 20
  const input = Object.freeze([a, b, c])
  assert.deepEqual(ids(model.sortYearSongs(input, { field: 'year', direction: 'asc' })), ['a', 'b', 'c'])
  assert.deepEqual(model.sortYearSongs(input, { field: 'year', direction: 'asc' }).map(item => item.trackId), ['c', 'b', 'a'])
  assert.deepEqual(model.sortYearSongs(input, { field: 'duration', direction: 'desc' }).map(item => item.trackId), ['b', 'c', 'a'])
  assert.deepEqual(model.sortYearSongs(input, { field: 'title', direction: 'desc' }).map(item => item.trackId), ['c', 'b', 'a'])
  assert.equal(model.sortYearSongs(input, { field: 'duration', direction: 'asc' })[0], c)
  const albums = albumEntries([a, b, c, song('single', 2026, 'Zed')])
  assert.deepEqual(model.sortYearAlbums(albums, { field: 'count', direction: 'desc' }).map(item => item.name), ['Mixed', 'Unknown', 'Zed'])
  assert.deepEqual(input, [a, b, c])
})

test('four sorting scopes persist independently, validate values and recover from malformed or unavailable storage', () => {
  const store = new Map()
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) }
  try {
    assert.deepEqual(model.readYearSort('root'), { field: 'year', direction: 'desc' })
    assert.deepEqual(model.readYearSort('albums'), { field: 'name', direction: 'asc' })
    for (const scope of ['songs', 'album-tracks']) assert.deepEqual(model.readYearSort(scope), { field: 'title', direction: 'asc' })
    const settings = { root: { field: 'count', direction: 'asc' }, albums: { field: 'artist', direction: 'desc' }, songs: { field: 'duration', direction: 'desc' }, 'album-tracks': { field: 'year', direction: 'asc' } }
    for (const [scope, setting] of Object.entries(settings)) model.writeYearSort(scope, setting)
    for (const [scope, setting] of Object.entries(settings)) assert.deepEqual(model.readYearSort(scope), setting)
    model.writeYearSort('root', { field: 'artist', direction: 'asc' })
    model.writeYearSort('root', { field: 'year', direction: 'invalid' })
    assert.deepEqual(model.readYearSort('root'), settings.root)
    for (const corrupt of ['invalid json', '{"field":"count","direction":"sideways"}', '{"field":"duration","direction":"asc"}', '[]', '0']) {
      store.set('spmusic.year-root.sort.v1', corrupt)
      assert.deepEqual(model.readYearSort('root'), { field: 'year', direction: 'desc' })
    }
    globalThis.localStorage = { getItem() { throw Error('denied') }, setItem() { throw Error('denied') } }
    assert.deepEqual(model.readYearSort('root'), { field: 'year', direction: 'desc' })
    assert.doesNotThrow(() => model.writeYearSort('root', { field: 'year', direction: 'asc' }))
  } finally { delete globalThis.localStorage }
})
