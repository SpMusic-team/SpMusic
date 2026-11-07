import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const categorySource = compile(await readFile(new URL('./mediaLibraryCategories.ts', import.meta.url), 'utf8'))
  .replace(/import (\w+) from '([^']+)';/g, (_, name, path) => `const ${name}=${JSON.stringify(path)};`)
const categoriesUrl = moduleUrl(categorySource)
const preferenceSource = compile(await readFile(new URL('./librarySidebarPreferences.ts', import.meta.url), 'utf8'))
  .replace("'@/features/player/model/mediaLibraryCategories'", JSON.stringify(categoriesUrl))
const { LIBRARY_CATEGORY_PINS_KEY: key, LIBRARY_SIDEBAR_PREFERENCES_KEY: legacyKey, readPinnedCategoryIds: read, writePinnedCategoryIds: write, sidebarLibraryCategories: order } = await import(moduleUrl(preferenceSource))

test('category pins validate IDs, deduplicate, preserve pin order and do not mutate overview', () => {
  const previous = globalThis.window
  try {
    const storage = new Map([[key, '["artist","invalid","artist",null,"folders",2,"album"]']])
    globalThis.window = { localStorage: { getItem: name => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, value) } }
    assert.deepEqual(read(), ['artist', 'folders', 'album'])
    const pins = read(), ids = order(pins).map(item => item.id)
    assert.deepEqual(ids.slice(0, 3), pins)
    assert.equal(ids.length, 19)
    assert.equal(new Set(ids).size, 19)
    assert.equal(order(false)[0].id, 'songs')
    write(['artist', 'artist', 'folders'])
    assert.equal(storage.get(key), '["artist","folders"]')
    assert.equal(storage.get(legacyKey), '1')
    write(['album'])
    assert.equal(storage.get(legacyKey), '0')
  } finally { globalThis.window = previous }
})

test('legacy folder pin migrates only when the current key is absent or unreadable', () => {
  const previous = globalThis.window
  try {
    const storage = new Map([[legacyKey, '1']])
    globalThis.window = { localStorage: { getItem: name => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, value) } }
    assert.deepEqual(read(), ['folders'])
    storage.set(key, '[]')
    assert.deepEqual(read(), [], 'explicit current empty pin set overrides legacy')
    storage.set(key, '["genre"]')
    assert.deepEqual(read(), ['genre'])
    storage.set(key, 'malformed')
    assert.deepEqual(read(), ['folders'])
    storage.set(key, '{}')
    assert.deepEqual(read(), [], 'valid JSON of wrong shape is sanitized')
  } finally { globalThis.window = previous }
})

test('unavailable or full browser storage cannot throw or corrupt current in-memory pin list', () => {
  const previous = globalThis.window
  try {
    delete globalThis.window
    assert.deepEqual(read(), [])
    assert.doesNotThrow(() => write(['artist']))
    globalThis.window = { get localStorage() { throw new Error('denied') } }
    assert.deepEqual(read(), [])
    const pins = ['album', 'artist']
    assert.doesNotThrow(() => write(pins))
    assert.deepEqual(pins, ['album', 'artist'])
    globalThis.window = { localStorage: { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } } }
    assert.deepEqual(read(), [])
    assert.doesNotThrow(() => write(pins))
  } finally { globalThis.window = previous }
})
