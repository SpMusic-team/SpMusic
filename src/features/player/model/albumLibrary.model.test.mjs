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
const source = compile(await readFile(new URL('./albumLibrary.ts', import.meta.url), 'utf8')).replace("'./folderHierarchy'", JSON.stringify(hierarchyUrl)).replace("'./quickIndex'", JSON.stringify(quickUrl))
const { albumEntries, albumKey } = await import(url(source))
const { playlistTrackRowFromSummary, playlistTrackRowEqual, pendingPlaylistTrackRow } = await import(summaryUrl)
const song = (id, path, name, albumArtist, artist = 'Singer') => Object.freeze({ key: path.replaceAll('\\', '/'), scope: 'scope:' + id, trackId: id, sourcePath: path, available: true, track: Object.freeze({ id, title: 'Title ' + id, artist, album: name ?? '本地音频', libraryAlbumName: name, albumArtist }) })

test('album year aggregates only unique valid tags and metadata changes preserve group identity and original members', () => {
  const withYear = (id, year) => { const item = song(id, '/music/Mixed/' + id + '.flac', 'Mixed', null); return { ...item, track: { ...item.track, libraryYear: year } } }
  const one = albumEntries([withYear('a', 2023), withYear('b', null)])[0]
  assert.equal(one.year, 2023)
  const changed = albumEntries([withYear('a', 2024), withYear('b', 2024)])[0]
  assert.equal(changed.year, 2024); assert.equal(changed.key, one.key); assert.deepEqual(changed.songs.map(item => [item.scope, item.trackId]), one.songs.map(item => [item.scope, item.trackId]))
  assert.equal(albumEntries([withYear('a', 2023), withYear('b', 2024)])[0].year, null)
  for (const year of [undefined, null, 0, -1, 2023.5, NaN, Infinity, '2023', 4294967296]) assert.equal(albumEntries([withYear('a', year)])[0].year, null)
  for (const year of [1, 4294967295]) assert.equal(albumEntries([withYear('a', year)])[0].year, year)
})

test('same album name by distinct album artists stays separate; multi-disc same album artist joins across directories', () => {
  const input = [song('a', '/music/A/one.flac', 'Echo', 'Ann'), song('b', '/other/B/one.flac', 'Echo', 'Bob'), song('d1', '/music/Box/Disc1/a.flac', 'Box', 'Ensemble', 'Singer A'), song('d2', '/music/Box/Disc2/b.flac', 'Box', 'Ensemble', 'Singer B')]
  const entries = albumEntries(Object.freeze(input))
  assert.equal(entries.length, 3)
  assert.equal(entries.filter(entry => entry.name === 'Echo').length, 2)
  const box = entries.find(entry => entry.name === 'Box')
  assert.equal(box.artist, 'Ensemble')
  assert.deepEqual(box.songs.map(item => item.trackId).sort(), ['d1', 'd2'])
  assert.equal(box.songs[0], input[2], 'original playable identity remains intact')
})

test('missing album artist joins distinct artists in source order and separates same-name folders', () => {
  const entries = albumEntries([song('a', '/music/Mixed/a.flac', 'Mixed', null, ' Singer B '), song('b', '/music/Mixed/b.flac', 'Mixed', null, 'Singer A'), song('repeat', '/music/Mixed/repeat.flac', 'Mixed', null, 'Singer B'), song('unknown', '/music/Mixed/unknown.flac', 'Mixed', null, '本地音频'), song('c', '/other/Mixed/c.flac', 'Mixed', null, 'Singer A')])
  assert.equal(entries.length, 2)
  const compilation = entries.find(entry => entry.songs.length === 4)
  assert.equal(compilation.artist, 'Singer B/Singer A', 'trim and deduplicate actual names, preserve first-seen order, omit display fallback')
  assert.deepEqual(compilation.songs.map(item => item.trackId).sort(), ['a', 'b', 'repeat', 'unknown'])
  assert.equal(entries.find(entry => entry.songs.length === 1).artist, 'Singer A', 'single artist has no separator')
  assert.equal(albumEntries([song('u1', '/music/U/a.flac', 'Unknown', null, ''), song('u2', '/music/U/b.flac', 'Unknown', null, '本地音频')])[0].artist, '未知艺术家')
})

test('Hypersynthetic raw artist tags deduplicate names across solo tracks and slash-separated collaboration', () => {
  // Raw labels from the three user files, independently read by the coordinator.
  // Synthetic descriptors isolate grouping/display without reading user audio.
  const entries = albumEntries([
    song('ether', 'E:/Music/Hypersynthetic/Ether Strike.flac', 'Hypersynthetic', null, 'Akira Complex'),
    song('hypersynthetic', 'E:/Music/Hypersynthetic/Hypersynthetic.flac', 'Hypersynthetic', null, 'Akira Complex'),
    song('remix', 'E:/Music/Hypersynthetic/message within the rift (Arcien Remix).flac', 'Hypersynthetic', null, 'Akira Complex/kors k'),
  ])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].artist, 'Akira Complex/kors k')
  assert.deepEqual(entries[0].songs.map(item => item.trackId).sort(), ['ether', 'hypersynthetic', 'remix'])
})

test('slash fallback trims segments, ignores empty/default names, preserves first occurrence and album artist priority', () => {
  const author = values => albumEntries(values.map((value, index) => song(String(index), '/music/Edge/' + index + '.flac', 'Edge', null, value)))[0].artist
  assert.equal(author([' A / B ', 'B/C', 'C/A', '/ D /']), 'A/B/C/D')
  assert.equal(author(['A///', ' /A/ ', '本地音频 / /', '/ B /']), 'A/B')
  assert.equal(author(['// /本地音频//', '  /  ']), '未知艺术家')
  assert.equal(author([' Solo ', '/Solo//']), 'Solo')
  assert.equal(author(['A & B', 'C;D']), 'A & B/C;D', 'only slash is a separator')
  const first = song('p1', '/music/Priority/a.flac', 'Priority', ' A / A / B ', 'X/Y')
  const second = song('p2', '/other/Priority/b.flac', 'Priority', ' A / A / B ', 'Y/Z')
  const entries = albumEntries([first, second])
  assert.equal(entries.length, 1, 'album identity still uses the original album artist tag')
  assert.equal(entries[0].artist, 'A / A / B', 'album artist remains the preferred original tag, without slash normalization')
  assert.equal(albumKey(first), albumKey(second))
})

test('pending is excluded; completed absent album stays directory-specific and differs from literal fallback text', () => {
  const pending = song('p', '/music/U/p.flac', undefined, undefined)
  const knownUnknown = song('u', '/music/U/u.flac', null, 'Named Artist', '本地音频')
  assert.equal(albumKey(pending), null)
  const entries = albumEntries([pending, knownUnknown, song('u2', '/other/U/u.flac', null, 'Named Artist'), song('real', '/music/U/real.flac', '本地音频', null)])
  assert.equal(entries.length, 3)
  assert.equal(entries.filter(entry => entry.name === '未知专辑').length, 2)
  assert.equal(entries.find(entry => entry.name === '本地音频').songs[0].trackId, 'real')
  assert.equal(albumEntries([pending]).length, 0)
})

test('overlapping scans deduplicate normalized song keys and retain first scope/track ID', () => {
  const first = song('original', 'D:\\Music\\A\\a.flac', 'A', 'Band')
  const duplicate = song('duplicate', 'D:/Music/A/a.flac', 'A', 'Band')
  const entries = albumEntries([first, duplicate, song('b', 'D:/Music/A/b.flac', 'A', 'Band')])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].songs.length, 2)
  assert(entries[0].songs.includes(first))
  assert(!entries[0].songs.includes(duplicate))
  assert.equal(first.scope, 'scope:original')
})

test('raw tag whitespace is normalized and identities safely encode punctuation; ordering does not mutate input', () => {
  assert.equal(albumKey(song('a', '/m/a', '  Box  ', ' Ensemble ')), albumKey(song('b', '/other/b', 'Box', 'Ensemble')))
  assert.notEqual(albumKey(song('a', '/m/a', 'A|B', 'C')), albumKey(song('b', '/m/b', 'A', 'B|C')))
  const input = Object.freeze([song('z', '/m/z', 'Zebra', 'Band'), song('a', '/m/a', 'Alpha', 'Band')])
  assert.deepEqual(albumEntries(input).map(entry => entry.name), ['Alpha', 'Zebra'])
  assert.deepEqual(input.map(item => item.trackId), ['z', 'a'])
  assert.deepEqual(albumEntries([]), [])
})

test('summary mapper keeps raw album tags distinct from display fallback and equality invalidates changed identity', () => {
  const descriptor = { id: 'x', fileName: 'x.flac' }
  const summary = { title: null, artist: null, album: '  Box ', albumArtist: ' Ensemble ', bitDepth: null, sampleRateHz: null, bitrateKbps: null, codec: null }
  const row = playlistTrackRowFromSummary(descriptor, summary)
  assert.equal(row.libraryAlbumName, 'Box')
  assert.equal(row.albumArtist, 'Ensemble')
  assert.equal(playlistTrackRowEqual(row, { ...row, albumArtist: 'Other' }), false)
  assert.equal(playlistTrackRowEqual(row, { ...row, libraryAlbumName: 'Other' }), false)
  const unknown = playlistTrackRowFromSummary(descriptor, null)
  assert.equal(unknown.album, '本地音频')
  assert.equal(unknown.libraryAlbumName, null)
  assert.equal(unknown.albumArtist, null)
  assert.equal(pendingPlaylistTrackRow(descriptor).libraryAlbumName, undefined)
})
