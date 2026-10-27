import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

// Keep the production module's bundler-style imports unchanged while exercising
// its actual source in Node, as the player services' tests do.
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const summary = moduleUrl(compile(await readFile(new URL('./playlistTrackSummary.ts', import.meta.url), 'utf8')))
const selection = moduleUrl(compile(await readFile(new URL('./folderSelection.ts', import.meta.url), 'utf8')))
const source = compile(await readFile(new URL('./folderHierarchy.ts', import.meta.url), 'utf8'))
const { folderEntries, folderRootSongs, folderName, folderPath, insideFolder, parentFolder } = await import(moduleUrl(source.replace("'./playlistTrackSummary'", JSON.stringify(summary)).replace("'./folderSelection'", JSON.stringify(selection))))

const song = path => ({ key: path, scope: 'folder:/music', trackId: path, sourcePath: path, available: true, track: { id: path, title: path, artist: '', album: '' } })
const root = (path, directoryPaths) => ({ path, status: 'ready', ...(directoryPaths ? { directoryPaths } : {}) })

test('overlapping roots retain union songs while each hierarchy applies its own selection rules', () => {
  const a = { ...root('/music', ['/music', '/music/Album', '/music/Album/Disc']), selection: { path: '/music', selected: true, directoryRules: [{ relativePath: 'Album', selected: false }] } }
  const b = { ...root('/music/Album', ['/music/Album', '/music/Album/Disc']), selection: { path: '/music/Album', selected: true, directoryRules: [] } }
  const union = [song('/music/root.flac'), song('/music/Album/album.flac'), song('/music/Album/Disc/deep.flac')]
  assert.deepEqual(folderRootSongs(a, union).map(row => row.trackId), ['/music/root.flac'])
  assert.deepEqual(folderRootSongs(b, union).map(row => row.trackId), ['/music/Album/album.flac', '/music/Album/Disc/deep.flac'])
  assert.deepEqual(Object.fromEntries(folderEntries([a, b], union, null).map(entry => [entry.path, entry.songs.length])), { '/music': 1, '/music/Album': 2 })
  assert.deepEqual(folderEntries([a, b], union, { rootPath: '/music', directoryPath: '/music' }), [])
  assert.deepEqual(folderEntries([a, b], union, { rootPath: '/music', directoryPath: '/music/Album' }), [], 'old location inside excluded branch cannot expose independently selected root songs')
  assert.equal(union.length, 3, 'per-root projection never mutates union candidates')
})

test('directory containment compares full segments and preserves path identity', () => {
  assert.equal(insideFolder('/music/Album/track.flac', '/music'), true)
  assert.equal(insideFolder('/music-else/track.flac', '/music'), false)
  assert.equal(insideFolder('/Music/track.flac', '/music'), false)
  assert.equal(insideFolder('/music', '/music/'), true)
  assert.equal(insideFolder('/music/track.flac', '/'), true)
})

test('Windows drive and UNC paths retain their roots and separators', () => {
  assert.equal(folderPath('C:\\Music\\Album\\'), 'C:/Music/Album')
  assert.equal(parentFolder('C:\\Music\\Album\\track.flac'), 'C:/Music/Album')
  assert.equal(insideFolder('C:\\Music\\Album\\track.flac', 'C:\\Music\\'), true)
  assert.equal(insideFolder('C:\\Music-else\\track.flac', 'C:\\Music'), false)
  assert.equal(insideFolder('C:\\track.flac', 'C:\\'), true)
  assert.equal(folderPath('\\\\server\\share\\Music\\'), '//server/share/Music')
  assert.equal(parentFolder('\\\\server\\share\\Music\\track.flac'), '//server/share/Music')
  assert.equal(folderName('C:\\'), 'C:')
})

test('root view lists selected nonempty and failed roots while hiding known empty roots', () => {
  const roots = [root('/music', ['/music', '/music/Album']), root('/music/Album'), root('/empty', ['/empty']), { path: '/missing', status: 'error', error: 'Unavailable' }]
  const rows = folderEntries(roots, [song('/music/a.flac'), song('/music/Album/b.flac')], null)
  assert.deepEqual(rows.map(item => item.path).sort(), ['/missing', '/music', '/music/Album'].sort())
  assert.equal(rows.find(item => item.path === '/missing').error, 'Unavailable')
  assert.equal(rows.find(item => item.path === '/empty'), undefined)
  assert.equal(rows.find(item => item.path === '/music').songs.length, 2)
})

test('directory metadata hides entire empty branches and only exposes immediate nonempty children', () => {
  const roots = [root('/music', ['/music', '/music/Album', '/music/Album/Disc', '/music/Empty', '/music/Empty/Nested'])]
  const rows = folderEntries(roots, [song('/music/a.flac'), song('/music/Album/Disc/b.flac')], { rootPath: '/music', directoryPath: '/music' })
  assert.deepEqual(rows.map(item => item.path), ['/music/Album'])
  assert.equal(rows.every(item => item.complete), true)
})

test('legacy sources infer nonempty ancestors without claiming complete directory metadata', () => {
  const roots = [root('/music')]
  const songs = [song('/music/a.flac'), song('/music/Album/Disc/b.flac'), song('/music-else/outside.flac')]
  const rows = folderEntries(roots, songs, { rootPath: '/music', directoryPath: '/music' })
  assert.deepEqual(rows.map(item => item.path), ['/music/Album'])
  assert.equal(rows[0].complete, false)
  assert.deepEqual(rows[0].songs.map(item => item.sourcePath), ['/music/Album/Disc/b.flac'])
})

test('overlapping sources deduplicate recursive counts and do not absorb adjacent roots', () => {
  const roots = [root('/music', ['/music', '/music/Album']), root('/music/Album'), root('/music-else')]
  const rows = folderEntries(roots, [song('/music/a.flac'), song('/music/Album/b.flac'), song('/music/Album/b.flac'), song('/music-else/c.flac')], null)
  assert.equal(rows.find(item => item.path === '/music').songs.length, 2)
  assert.equal(rows.find(item => item.path === '/music/Album').songs.length, 1)
  assert.equal(rows.find(item => item.path === '/music-else').songs.length, 1)
})

test('a song-only leaf has no invented child directories and clearing roots invalidates navigation', () => {
  const location = { rootPath: '/music', directoryPath: '/music/Album' }
  assert.deepEqual(folderEntries([root('/music', ['/music', '/music/Album'])], [song('/music/Album/a.flac')], location), [])
  assert.deepEqual(folderEntries([], [song('/music/Album/a.flac')], location), [])
})

test('only successful complete zero-audio sources are hidden; unknown and failed sources remain', () => {
  const roots = [root('/empty', ['/empty']), root('/container', ['/container', '/container/child']), root('/legacy'),
    { path: '/loading', status: 'loading', directoryPaths: ['/loading'] },
    { path: '/failed', status: 'error', directoryPaths: ['/failed'] }, root('/audio', ['/audio'])]
  const rows = folderEntries(roots, [song('/audio/track.flac')], null)
  assert.deepEqual(rows.map(item => item.path).sort(), ['/legacy', '/loading', '/failed', '/audio'].sort())
  const children = folderEntries(roots, [], { rootPath: '/container', directoryPath: '/container' })
  assert.deepEqual(children, [])
})
