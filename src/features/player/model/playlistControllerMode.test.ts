import assert from 'node:assert/strict'
import test from 'node:test'
import { persistPlaylistControllerMode, readPlaylistControllerMode } from './playlistControllerMode.ts'

const key = 'spmusic.player.playlist-controller-mode.v1'
function withWindow(value: object | undefined, run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { value, configurable: true })
  try { run() } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

test('new or invalid preference defaults to movable without writing storage', () => {
  for (const value of [null, '', 'unknown', 'Fixed', ' fixed ', '"fixed"', '__proto__']) {
    withWindow({ localStorage: {
      getItem: (name: string) => { assert.equal(name, key); return value },
      setItem: () => assert.fail('a read must not write'),
    } }, () => assert.equal(readPlaylistControllerMode(), 'movable'))
  }
})

test('both modes persist across sessions without changing layout or appearance keys', () => {
  const values = new Map([['spmusic.playlist.layout-level.v1', '7'], ['appearance-sentinel', 'unchanged']])
  const localStorage = {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => values.set(name, value),
  }
  for (const mode of ['fixed', 'movable'] as const) {
    withWindow({ localStorage }, () => persistPlaylistControllerMode(mode))
    withWindow({ localStorage }, () => assert.equal(readPlaylistControllerMode(), mode))
    assert.equal(values.get('spmusic.playlist.layout-level.v1'), '7')
    assert.equal(values.get('appearance-sentinel'), 'unchanged')
    assert.equal(values.size, 3)
  }
})

test('unavailable window, storage access, reads and writes remain safe', () => {
  const blocked = Object.defineProperty({}, 'localStorage', { get: () => { throw new Error('blocked') } })
  const failing = { localStorage: {
    getItem: () => { throw new Error('read failed') },
    setItem: () => { throw new Error('quota exceeded') },
  } }
  for (const value of [undefined, blocked, failing]) {
    withWindow(value, () => {
      assert.equal(readPlaylistControllerMode(), 'movable')
      assert.doesNotThrow(() => persistPlaylistControllerMode('fixed'))
      assert.doesNotThrow(() => persistPlaylistControllerMode('movable'))
    })
  }
})
