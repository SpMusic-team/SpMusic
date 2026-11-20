import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const categorySource = compile(await readFile(new URL('./mediaLibraryCategories.ts', import.meta.url), 'utf8'))
  .replace(/import (\w+) from '([^']+)';/g, (_, name, path) => `const ${name}=${JSON.stringify(path)};`)
const categoriesUrl = moduleUrl(categorySource)
const { mediaLibraryCategories } = await import(categoriesUrl)
const preferenceSource = compile(await readFile(new URL('./librarySidebarPreferences.ts', import.meta.url), 'utf8'))
  .replace("'@/features/player/model/mediaLibraryCategories'", JSON.stringify(categoriesUrl))
const { LIBRARY_SIDEBAR_PREFERENCES_KEY: key, readFoldersPinnedToTop: read, writeFoldersPinnedToTop: write, sidebarLibraryCategories: order } = await import(moduleUrl(preferenceSource))

test('sidebar pin changes only the returned category order and leaves overview source intact', () => {
  const original = mediaLibraryCategories.map(item => item.id)
  assert.deepEqual(order(false).map(item => item.id), original)
  assert.deepEqual(order(true).map(item => item.id), ['folders', ...original.filter(id => id !== 'folders')])
  assert.deepEqual(mediaLibraryCategories.map(item => item.id), original)
  const disposable = order(true)
  disposable.pop()
  assert.equal(order(true).length, original.length)
})

test('pin preference stores exact v1 key and reads only the explicit enabled value', () => {
  const previous = globalThis.window
  try {
    assert.equal(key, 'spmusic.library.sidebar.folders-pinned.v1')
    const storage = new Map()
    globalThis.window = { localStorage: { getItem: name => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, value) } }
    for (const value of [null, '', '0', 'true', 'false', '2', '{malformed}']) {
      storage.set(key, value)
      assert.equal(read(), false)
    }
    write(true)
    assert.equal(storage.get(key), '1')
    assert.equal(read(), true)
    write(false)
    assert.equal(storage.get(key), '0')
    assert.equal(read(), false)
  } finally { globalThis.window = previous }
})

test('absent or inaccessible local storage cannot throw while reading or writing a pin', () => {
  const previous = globalThis.window
  try {
    delete globalThis.window
    assert.equal(read(), false)
    assert.doesNotThrow(() => write(true))
    globalThis.window = { get localStorage() { throw new Error('denied') } }
    assert.equal(read(), false)
    assert.doesNotThrow(() => write(true))
    globalThis.window = { localStorage: { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } } }
    assert.equal(read(), false)
    assert.doesNotThrow(() => write(false))
  } finally { globalThis.window = previous }
})
