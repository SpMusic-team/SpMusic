import assert from 'node:assert/strict'
import test from 'node:test'
import { persistStartupPage, readStartupPage, type StartupPage } from './startupPageStorage.ts'

const startupKey = 'spmusic.player.startup-page.v1'

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

test('missing or invalid startup preferences default to player without writing storage', () => {
  for (const value of [null, '', 'unknown', 'toString', '__proto__', 'constructor', ' player', 'media-library ', '"media-library"']) {
    withWindow({ localStorage: {
      getItem: (key: string) => { assert.equal(key, startupKey); return value },
      setItem: () => assert.fail('reading startup preference must not write'),
    } }, () => assert.equal(readStartupPage(), 'player'))
  }
})

test('both startup pages survive new sessions and preserve other player preferences', () => {
  const values = new Map([['spmusic.player.repeat-mode.v1', 'repeat-one'], ['spmusic.playlist.layout-level.v1', '7']])
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
  for (const page of ['media-library', 'player'] satisfies StartupPage[]) {
    withWindow({ localStorage }, () => persistStartupPage(page))
    withWindow({ localStorage }, () => assert.equal(readStartupPage(), page))
    assert.equal(values.get('spmusic.player.repeat-mode.v1'), 'repeat-one')
    assert.equal(values.get('spmusic.playlist.layout-level.v1'), '7')
    assert.equal(values.size, 3)
  }
})

test('unavailable window, blocked storage, and read or write failures remain safe', () => {
  const blockedWindow = Object.defineProperty({}, 'localStorage', {
    get: () => { throw new Error('storage blocked') },
  })
  const failedStore = {
    getItem: () => { throw new Error('read failed') },
    setItem: () => { throw new Error('quota exceeded') },
  }
  for (const value of [undefined, blockedWindow, { localStorage: failedStore }]) {
    withWindow(value, () => {
      assert.equal(readStartupPage(), 'player')
      assert.doesNotThrow(() => persistStartupPage('media-library'))
    })
  }
})
