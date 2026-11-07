import assert from 'node:assert/strict'
import test from 'node:test'
import { persistSearchCategories, readSearchCategories, SEARCH_CATEGORIES_STORAGE_KEY } from './searchFilterStorage.ts'
import type { SearchCategory } from './librarySearch.ts'

// Local fixture ids stand in for the real category union so these tests do not
// depend on librarySearch's runtime imports; the storage module only needs an
// allowlist of category ids. This helper keeps that deliberate mismatch in one place.
const asCategories = (...ids: unknown[]): SearchCategory[] => ids as unknown as SearchCategory[]
const asCategory = (id: string): SearchCategory => asCategories(id)[0]
const allowed = asCategories('a', 'b', 'c')
const layoutKey = 'spmusic.search.layout-level.v1'

function withWindow(value: object | undefined, run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { value, configurable: true })
  try {
    run()
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

function memoryStore() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

test('missing window, missing or blocked storage, and failing reads restore every allowed category', () => {
  const blockedWindow = Object.defineProperty({}, 'localStorage', {
    get: () => { throw new Error('storage blocked') },
  })
  const failedStore = {
    getItem: () => { throw new Error('read failed') },
    setItem: () => assert.fail('a read must not write'),
  }
  for (const value of [undefined, {}, blockedWindow, { localStorage: failedStore }]) {
    withWindow(value, () => assert.deepEqual(readSearchCategories(allowed), ['a', 'b', 'c']))
  }
})

test('absent, blank, and malformed stored values restore the full default selection without writing', () => {
  const store = memoryStore()
  withWindow({ localStorage: store }, () => {
    assert.deepEqual(readSearchCategories(allowed), ['a', 'b', 'c'])
    for (const invalid of ['', '{bad}', 'null', '{}', '"a"', '"[]"', '0', '["a",]']) {
      store.setItem(SEARCH_CATEGORIES_STORAGE_KEY, invalid)
      assert.deepEqual(readSearchCategories(allowed), ['a', 'b', 'c'], invalid)
      assert.equal(store.values.size, 1)
    }
  })
})

test('an explicit empty selection survives a restart instead of falling back to the default', () => {
  const store = memoryStore()
  withWindow({ localStorage: store }, () => persistSearchCategories([], allowed))
  assert.equal(store.getItem(SEARCH_CATEGORIES_STORAGE_KEY), '[]')
  withWindow({ localStorage: store }, () => assert.deepEqual(readSearchCategories(allowed), []))
})

test('the panel click protocol restores the previous selection after a restart', () => {
  const store = memoryStore()
  // Mirrors SearchPanel: mount reads once, and each filter click writes the next
  // selection without touching the other search preferences.
  const mount = () => {
    let restored: SearchCategory[] = []
    withWindow({ localStorage: store }, () => { restored = readSearchCategories(allowed) })
    return restored
  }
  const clickAll = (current: readonly SearchCategory[]) => {
    const next = current.length === allowed.length ? [] : allowed
    withWindow({ localStorage: store }, () => persistSearchCategories(next, allowed))
    return next
  }
  const clickCategory = (current: readonly SearchCategory[], id: SearchCategory) => {
    const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id]
    withWindow({ localStorage: store }, () => persistSearchCategories(next, allowed))
    return next
  }
  assert.deepEqual(mount(), ['a', 'b', 'c'])
  assert.deepEqual(clickAll(mount()), [])
  assert.deepEqual(mount(), [])
  assert.deepEqual(clickCategory(mount(), asCategory('b')), ['b'])
  assert.deepEqual(mount(), ['b'])
  assert.deepEqual(clickCategory(mount(), asCategory('a')), ['b', 'a'], 'the live selection order follows the click')
  assert.deepEqual(mount(), ['a', 'b'], 'the restored selection uses the canonical order')
  assert.deepEqual(clickAll(mount()), ['a', 'b', 'c'], 'a partial selection selects every category again')
  assert.deepEqual(mount(), ['a', 'b', 'c'])
  assert.deepEqual(clickAll(mount()), [])
  assert.deepEqual(mount(), [])
})

test('unknown ids, non-string members, and duplicates are filtered while order follows the allowlist', () => {
  const store = memoryStore()
  withWindow({ localStorage: store }, () => {
    const cases: readonly (readonly [string, readonly string[]])[] = [
      [JSON.stringify(['unknown', 'b']), ['b']],
      [JSON.stringify([1, null, { id: 'a' }, ['b'], 'c']), ['c']],
      // A non-empty value without a single known category is corrupt, so it falls back.
      [JSON.stringify([true, false, 0]), ['a', 'b', 'c']],
      [JSON.stringify(['c', 'a', 'c', 'a']), ['a', 'c']],
      [JSON.stringify(['b', 'a']), ['a', 'b']],
      // A literally empty stored array is the user's empty selection, not a fallback.
      ['[]', []],
    ]
    for (const [stored, expected] of cases) {
      store.setItem(SEARCH_CATEGORIES_STORAGE_KEY, stored)
      assert.deepEqual(readSearchCategories(allowed), expected, stored)
    }
  })
})

test('inherited object member names never count as a known category', () => {
  const store = memoryStore()
  withWindow({ localStorage: store }, () => {
    store.setItem(SEARCH_CATEGORIES_STORAGE_KEY, JSON.stringify(['__proto__', 'toString', 'constructor', 'hasOwnProperty']))
    assert.deepEqual(readSearchCategories(allowed), ['a', 'b', 'c'])
    store.setItem(SEARCH_CATEGORIES_STORAGE_KEY, JSON.stringify(['__proto__', 'b']))
    assert.deepEqual(readSearchCategories(allowed), ['b'])
    store.setItem(SEARCH_CATEGORIES_STORAGE_KEY, JSON.stringify({ '__proto__': ['a'] }))
    assert.deepEqual(readSearchCategories(allowed), ['a', 'b', 'c'])
  })
})

test('writes store the normalized allowlist order and repeated writes stay byte stable', () => {
  const store = memoryStore()
  withWindow({ localStorage: store }, () => {
    persistSearchCategories(asCategories('c', 'unknown', 'a', 'c'), allowed)
    const first = store.getItem(SEARCH_CATEGORIES_STORAGE_KEY)
    assert.equal(first, '["a","c"]')
    for (let index = 0; index < 3; index += 1) persistSearchCategories(asCategories('a', 'c', 'a'), allowed)
    assert.equal(store.getItem(SEARCH_CATEGORIES_STORAGE_KEY), first)
    assert.deepEqual(readSearchCategories(allowed), ['a', 'c'])
    persistSearchCategories(asCategories(1, null, 'nope'), allowed)
    assert.equal(store.getItem(SEARCH_CATEGORIES_STORAGE_KEY), '[]')
    assert.deepEqual(readSearchCategories(allowed), [])
  })
})

test('blocked, full, and non-array writes never throw or overwrite a stored selection', () => {
  const store = memoryStore()
  store.setItem(SEARCH_CATEGORIES_STORAGE_KEY, '["b"]')
  const failingStore = { getItem: () => null, setItem: () => { throw new Error('quota exceeded') } }
  const blockedWindow = Object.defineProperty({}, 'localStorage', { get: () => { throw new Error('storage blocked') } })
  for (const value of [undefined, blockedWindow, { localStorage: failingStore }]) {
    withWindow(value, () => assert.doesNotThrow(() => persistSearchCategories(asCategories('a', 'b'), allowed)))
  }
  withWindow({ localStorage: store }, () => {
    assert.doesNotThrow(() => persistSearchCategories(undefined as unknown as SearchCategory[], allowed))
    assert.doesNotThrow(() => persistSearchCategories(null as unknown as SearchCategory[], allowed))
    assert.doesNotThrow(() => persistSearchCategories({} as unknown as SearchCategory[], allowed))
    assert.equal(store.getItem(SEARCH_CATEGORIES_STORAGE_KEY), '["b"]')
  })
})

test('reads never write and the selection stays isolated from other search preferences', () => {
  const store = memoryStore()
  store.setItem(layoutKey, '3')
  store.setItem('appearance-sentinel', 'unchanged')
  withWindow({ localStorage: store }, () => assert.deepEqual(readSearchCategories(allowed), ['a', 'b', 'c']))
  assert.equal(store.values.size, 2)
  withWindow({ localStorage: store }, () => persistSearchCategories(asCategories('b'), allowed))
  assert.equal(store.getItem(layoutKey), '3')
  assert.equal(store.getItem('appearance-sentinel'), 'unchanged')
  assert.equal(store.values.size, 3)
})

test('every read returns a new array that never aliases the allowlist or a previous result', () => {
  const store = memoryStore()
  withWindow({ localStorage: store }, () => {
    const first = readSearchCategories(allowed)
    const second = readSearchCategories(allowed)
    assert.notStrictEqual(first, allowed)
    assert.notStrictEqual(first, second)
    assert.deepEqual(first, ['a', 'b', 'c'])
    store.setItem(SEARCH_CATEGORIES_STORAGE_KEY, '["b","a"]')
    const restored = readSearchCategories(allowed)
    assert.notStrictEqual(restored, first)
    assert.deepEqual(restored, ['a', 'b'])
    store.setItem(SEARCH_CATEGORIES_STORAGE_KEY, '[]')
    const empty = readSearchCategories(allowed)
    assert.notStrictEqual(empty, first)
    assert.deepEqual(empty, [])
  })
})
