import assert from 'node:assert/strict'
import test from 'node:test'
import { persistRepeatMode, persistShuffleMode, readRepeatMode, readShuffleMode } from './playbackModeStorage.ts'
import { nextRepeatMode, nextShuffleMode, type RepeatMode, type ShuffleMode } from './playbackModes.ts'

const repeatKey = 'spmusic.player.repeat-mode.v1'
const shuffleKey = 'spmusic.player.shuffle-mode.v1'
const layoutKey = 'spmusic.playlist.layout-level.v1'
const repeatModes: readonly RepeatMode[] = ['list-loop', 'repeat-one', 'sequential', 'all-categories-until-stop']
const shuffleModes: readonly ShuffleMode[] = ['none', 'shuffle-all', 'shuffle-category-order', 'shuffle-category-random']

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

test('all 16 mode combinations survive a new window session without changing playlist layout', () => {
  const store = memoryStore()
  store.setItem(layoutKey, '7')
  for (const repeat of repeatModes) {
    for (const shuffle of shuffleModes) {
      withWindow({ localStorage: store }, () => {
        persistRepeatMode(repeat)
        persistShuffleMode(shuffle)
      })
      withWindow({ localStorage: store }, () => {
        assert.equal(readRepeatMode(), repeat)
        assert.equal(readShuffleMode(), shuffle)
      })
      assert.equal(store.getItem(layoutKey), '7')
      assert.equal(store.values.size, 3)
    }
  }
})

test('empty storage restores existing defaults and reads do not write', () => {
  const store = memoryStore()
  withWindow({ localStorage: store }, () => {
    assert.equal(readRepeatMode(), 'list-loop')
    assert.equal(readShuffleMode(), 'none')
    assert.equal(store.values.size, 0)
  })
})

test('corrupt and inherited values fall back independently', () => {
  const store = memoryStore()
  withWindow({ localStorage: store }, () => {
    for (const invalid of ['', 'unknown', 'toString', '__proto__', 'constructor', 'null', '{}', '"repeat-one"', ' repeat-one', 'shuffle-all ']) {
      store.setItem(repeatKey, invalid)
      store.setItem(shuffleKey, 'shuffle-category-random')
      assert.equal(readRepeatMode(), 'list-loop', invalid)
      assert.equal(readShuffleMode(), 'shuffle-category-random', invalid)
      store.setItem(repeatKey, 'sequential')
      store.setItem(shuffleKey, invalid)
      assert.equal(readRepeatMode(), 'sequential', invalid)
      assert.equal(readShuffleMode(), 'none', invalid)
    }
    store.setItem(repeatKey, 'shuffle-all')
    store.setItem(shuffleKey, 'repeat-one')
    assert.equal(readRepeatMode(), 'list-loop')
    assert.equal(readShuffleMode(), 'none')
  })
})

test('missing window, throwing localStorage getter, and failed reads or writes remain safe', () => {
  const blockedWindow = Object.defineProperty({}, 'localStorage', {
    get: () => { throw new Error('storage blocked') },
  })
  const failedStore = {
    getItem: () => { throw new Error('read failed') },
    setItem: () => { throw new Error('quota exceeded') },
  }
  for (const value of [undefined, blockedWindow, { localStorage: failedStore }]) {
    withWindow(value, () => {
      assert.equal(readRepeatMode(), 'list-loop')
      assert.equal(readShuffleMode(), 'none')
      assert.doesNotThrow(() => persistRepeatMode('repeat-one'))
      assert.doesNotThrow(() => persistShuffleMode('shuffle-all'))
    })
  }
})

test('one failed key read leaves the other preference available', () => {
  withWindow({ localStorage: {
    getItem: (key: string) => {
      if (key === repeatKey) throw new Error('repeat read failed')
      return 'shuffle-all'
    },
  } }, () => {
    assert.equal(readRepeatMode(), 'list-loop')
    assert.equal(readShuffleMode(), 'shuffle-all')
  })
})

test('successive cycles persist the final mode and repeated effects are idempotent', () => {
  const store = memoryStore()
  withWindow({ localStorage: store }, () => {
    let repeat = readRepeatMode()
    let shuffle = readShuffleMode()
    for (let index = 0; index < 7; index += 1) {
      repeat = nextRepeatMode[repeat]
      shuffle = nextShuffleMode[shuffle]
      persistRepeatMode(repeat)
      persistShuffleMode(shuffle)
    }
    persistRepeatMode(repeat)
    persistShuffleMode(shuffle)
    assert.equal(readRepeatMode(), 'all-categories-until-stop')
    assert.equal(readShuffleMode(), 'shuffle-category-random')
  })
})
