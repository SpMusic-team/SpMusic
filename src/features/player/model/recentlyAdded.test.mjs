import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const compile = text => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')
const normalization = compile(readFileSync(new URL('./playlistTrackSummary.ts', import.meta.url), 'utf8'))
const source = readFileSync(new URL('./recentlyAdded.ts', import.meta.url), 'utf8').replace("'./playlistTrackSummary'", JSON.stringify(normalization))
const { recentlyAddedSongs } = await import(compile(source))
const queue = readFileSync(new URL('./playbackQueue.ts', import.meta.url), 'utf8')
const { isPlaybackQueueOrigin } = await import(compile(queue))

test('creation time determines membership order independently of title and original order', () => {
  const songs = [{ sourcePath: '/z', fileCreatedAtMs: 100 }, { sourcePath: '/a', fileCreatedAtMs: 50 }, { sourcePath: '/b', fileCreatedAtMs: 100 }]
  assert.deepEqual(recentlyAddedSongs(songs).map(x => x.sourcePath), ['/b', '/z', '/a'])
  assert.deepEqual(songs.map(x => x.sourcePath), ['/z', '/a', '/b'], 'does not mutate the source')
})
test('unknown and invalid timestamps sort last with stable normalized paths', () => {
  const songs = [{ sourcePath: '/z', fileCreatedAtMs: NaN }, { sourcePath: '/a' }, { sourcePath: '/b', fileCreatedAtMs: null }, { sourcePath: '/valid', fileCreatedAtMs: 0 }, { sourcePath: '/c', fileCreatedAtMs: -1 }]
  assert.deepEqual(recentlyAddedSongs(songs).map(x => x.sourcePath), ['/valid', '/a', '/b', '/c', '/z'])
  assert.deepEqual(recentlyAddedSongs([]), [])
})
test('recent-added origin round trips while rejecting real-playlist scope fields', () => {
  assert.equal(isPlaybackQueueOrigin(JSON.parse(JSON.stringify({ kind: 'recent-added' }))), true)
  assert.equal(isPlaybackQueueOrigin({ kind: 'recent-added', sourceScope: 'folder' }), false)
  assert.equal(isPlaybackQueueOrigin({ kind: 'recent-played' }), true)
  assert.equal(isPlaybackQueueOrigin({ kind: 'all-songs' }), true)
})
