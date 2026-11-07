import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const summary = url(compile(await readFile(new URL('./playlistTrackSummary.ts', import.meta.url), 'utf8')))
const selection = url(compile(await readFile(new URL('./folderSelection.ts', import.meta.url), 'utf8')))
const source = compile(await readFile(new URL('./folderHierarchy.ts', import.meta.url), 'utf8'))
const { flatFolderEntries, folderEntries } = await import(url(source.replace("'./playlistTrackSummary'", JSON.stringify(summary)).replace("'./folderSelection'", JSON.stringify(selection))))
const song = (path, scope = 'folder:/music') => Object.freeze({ key: path, scope, trackId: path, sourcePath: path, available: true, track: Object.freeze({ id: path, title: path, artist: '', album: '' }) })

test('every direct-song directory appears once, including deep leaves, without invented containers', () => {
  const songs = Object.freeze([song('/music/root.flac'), song('/music/Album/a.flac'), song('/music/Album/Disc/b.flac'), song('/music/Container/Deep/c.flac')])
  const rows = flatFolderEntries(songs)
  assert.deepEqual(rows.map(row => row.path).sort(), ['/music','/music/Album','/music/Album/Disc','/music/Container/Deep'].sort())
  for (const row of rows) assert.equal(row.songs.length, 1)
  assert.deepEqual(rows.flatMap(row => row.songs).sort((a,b) => a.key.localeCompare(b.key)), [...songs].sort((a,b) => a.key.localeCompare(b.key)))
  assert.deepEqual(flatFolderEntries([]), [])
})

test('duplicate scans and separators deduplicate physical paths while preserving original playback identity', () => {
  const first = song('D:\\Music\\Album\\a.flac', 'folder:D:/Music')
  const rows = flatFolderEntries([first, song('D:/Music/Album/a.flac', 'folder:D:/Music/Album'), song('D:/Music/Album/b.flac')])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].path, 'D:/Music/Album')
  assert.equal(rows[0].songs.length, 2)
  assert.equal(rows[0].songs[0], first)
  assert.equal(rows[0].songs[0].scope, 'folder:D:/Music')
})

test('same folder names in different storage and adjacent directory prefixes stay distinct', () => {
  const rows = flatFolderEntries([song('/music/Album/a.flac'), song('/external/Album/b.flac'), song('/music-else/c.flac')])
  assert.equal(rows.length, 3)
  assert.equal(rows.filter(row => row.name === 'Album').length, 2)
  assert.deepEqual(rows.filter(row => row.name === 'Album').map(row => row.parentName).sort(), ['external','music'])
  assert.deepEqual(rows.find(row => row.path === '/music-else').songs.map(row => row.sourcePath), ['/music-else/c.flac'])
})

test('flat direct counts differ deliberately from hierarchy recursive counts without mutating source', () => {
  const songs = Object.freeze([song('/music/a.flac'), song('/music/Album/b.flac'), song('/music/Album/Disc/c.flac')])
  const flat = flatFolderEntries(songs)
  const hierarchy = folderEntries([{ path: '/music', status: 'ready', directoryPaths: ['/music','/music/Album','/music/Album/Disc'] }], songs, null)
  assert.equal(flat.find(row => row.path === '/music').songs.length, 1)
  assert.equal(flat.find(row => row.path === '/music/Album').songs.length, 1)
  assert.equal(hierarchy[0].songs.length, 3)
  assert.equal(songs.length, 3)
})

test('Windows drive and UNC directory identities are retained', () => {
  const rows = flatFolderEntries([song('C:\\root.flac'), song('\\\\server\\share\\Album\\a.flac')])
  assert.deepEqual(rows.map(row => row.path).sort(), ['C:','//server/share/Album'].sort())
})
