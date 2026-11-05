import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
}).outputText).toString('base64')}`
const summaryUrl = compile(await readFile(new URL('./playlistTrackSummary.ts', import.meta.url), 'utf8'))
const source = (await readFile(new URL('./bookmarks.ts', import.meta.url), 'utf8')).replace("'./playlistTrackSummary'", JSON.stringify(summaryUrl))
const { BOOKMARKS_STORAGE_KEY, readBookmarks, writeBookmarks, projectBookmarks } = await import(compile(source))
const entry = (id, positionMs = 58000, sort = 0) => ({ id, sourcePath: 'D:\\Music\\a.flac', positionMs, createdAt: 1234, sort })
function storage(initial = null) {
  let raw = initial
  globalThis.localStorage = {
    getItem: key => { assert.equal(key, BOOKMARKS_STORAGE_KEY); return raw },
    setItem: (key, value) => { assert.equal(key, BOOKMARKS_STORAGE_KEY); raw = value },
  }
  return () => raw
}

test('same song supports multiple positions, independent identity and removal across reload', () => {
  storage()
  writeBookmarks([entry('first'), entry('second', 103000, 1)])
  let restored = readBookmarks()
  assert.deepEqual(restored.map(x => [x.id, x.positionMs]), [['first', 58000], ['second', 103000]])
  assert.equal(restored[0].sourcePath, 'D:/Music/a.flac')
  writeBookmarks(restored.filter(x => x.id !== 'first'))
  restored = readBookmarks()
  assert.deepEqual(restored.map(x => x.id), ['second'])
})

test('schema rejects unsupported versions, malformed JSON and invalid records', () => {
  for (const raw of ['{broken', 'null', JSON.stringify({ version: 2, entries: [entry('a')] }), JSON.stringify({ version: 1, entries: {} })]) {
    storage(raw)
    assert.deepEqual(readBookmarks(), [])
  }
  const valid = entry('valid', 0)
  storage(JSON.stringify({ version: 1, entries: [null, {}, valid, valid,
    { ...entry('negative'), positionMs: -1 }, { ...entry('fraction'), positionMs: 0.5 },
    { ...entry('unsafe'), positionMs: Number.MAX_SAFE_INTEGER + 1 },
    { ...entry('empty-path'), sourcePath: '  ' }, { ...entry('bad-time'), createdAt: -1 },
    { ...entry('bad-sort'), sort: -1 }] }))
  assert.deepEqual(readBookmarks().map(x => x.id), ['valid'])
})

test('saved ordering is independent from song library ordering', () => {
  storage(JSON.stringify({ version: 1, entries: [entry('last', 100, 7), entry('first', 0, 2)] }))
  assert.deepEqual(readBookmarks().map(x => x.id), ['first', 'last'])
})

test('projection keeps missing media and maps repeated song records without collapsing them', () => {
  const song = { id: 'track-a', sourcePath: 'D:/Music/a.flac' }
  const entries = [entry('a'), entry('b', 1000), { ...entry('missing'), sourcePath: 'D:/Music/missing.flac' }]
  const projected = projectBookmarks([song], entries)
  assert.equal(projected.length, 3)
  assert.equal(projected[0].item, song)
  assert.equal(projected[1].item, song)
  assert.equal(projected[2].item, undefined)
  assert.equal(projected[2].bookmark.id, 'missing')
  assert.deepEqual(projectBookmarks([], entries).map(x => x.bookmark.id), ['a', 'b', 'missing'])
})

test('read access failure recovers safely and write quota failure propagates', () => {
  const previous = storage()
  writeBookmarks([entry('saved')])
  const raw = previous()
  globalThis.localStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } }
  assert.deepEqual(readBookmarks(), [])
  assert.throws(() => writeBookmarks([entry('unsaved')]), /quota/)
  assert.equal(previous(), raw)
})
