import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
}).outputText
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const summary = url(compile(await readFile(new URL('./playlistTrackSummary.ts', import.meta.url), 'utf8')))
const selection = url(compile(await readFile(new URL('./folderSelection.ts', import.meta.url), 'utf8')))
const source = compile(await readFile(new URL('./folderHierarchy.ts', import.meta.url), 'utf8'))
const { folderNavigationKey } = await import(url(source.replace("'./playlistTrackSummary'", JSON.stringify(summary)).replace("'./folderSelection'", JSON.stringify(selection))))

test('card and hero normalize the same Windows directory identity', () => {
  assert.equal(folderNavigationKey('D:\\Music\\', 'D:\\Music\\Album\\'),
    folderNavigationKey('D:/Music', 'D:/Music/Album'))
})

test('overlapping selected roots own separate projection and cover identities', () => {
  assert.notEqual(folderNavigationKey('/music', '/music/album'), folderNavigationKey('/music/album', '/music/album'))
})

test('identity preserves case and encodes separators without tuple collisions', () => {
  assert.notEqual(folderNavigationKey('/Music', '/Music/album'), folderNavigationKey('/music', '/music/album'))
  assert.notEqual(folderNavigationKey('/a\u0000/b', '/c'), folderNavigationKey('/a', '/b\u0000/c'))
})
