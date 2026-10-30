import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearPlaybackSession,
  persistPlaybackSession,
  readPlaybackSession,
  type SavedPlaybackSession,
} from './playbackSessionStorage.ts'

const key = 'spmusic.player.session.v1'
const session: SavedPlaybackSession = {
  version: 1,
  sourcePath: 'C:/Music/song.flac',
  playlist: { sourceKind: 'folder', sourcePath: 'C:/Music' },
  positionMs: 42_500,
  wasPlaying: true,
  wasPaused: false,
  queueOpen: false,
  volume: 67,
}

function withStore(run: (values: Map<string, string>) => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => { values.set(name, value) },
      removeItem: (name: string) => { values.delete(name) },
    },
  } })
  try { run(values) } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

test('last song, position and playback state survive a new read', () => withStore((values) => {
  persistPlaybackSession(session)
  assert.deepEqual(readPlaybackSession(), session)
  persistPlaybackSession({ ...session, playlist: { ...session.playlist, folderMode: 'library' } })
  assert.equal(readPlaybackSession()?.playlist.folderMode, 'library')
  assert.equal(values.size, 1)
  clearPlaybackSession()
  assert.equal(readPlaybackSession(), null)
}))

test('invalid snapshots cannot be restored', () => withStore((values) => {
  for (const change of [
    { version: 2 }, { sourcePath: '' }, { positionMs: -1 },
    { positionMs: Number.POSITIVE_INFINITY }, { wasPlaying: 'true' }, { wasPaused: true }, { volume: 101 },
    { playlist: { sourceKind: 'custom', sourcePath: 'custom:x' } },
    { playlist: { sourceKind: 'folder', sourcePath: 'C:/Music', folderMode: 'unknown' } },
    { playlist: { sourceKind: 'm3u8', sourcePath: 'C:/Music/list.m3u8', folderMode: 'library' } },
  ]) {
    values.set(key, JSON.stringify({ ...session, ...change }))
    assert.equal(readPlaybackSession(), null)
  }
  values.set(key, '{')
  assert.equal(readPlaybackSession(), null)
}))

test('unavailable storage leaves playback operations usable', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('full') },
      removeItem: () => { throw new Error('blocked') },
    },
  } })
  try {
    assert.equal(readPlaybackSession(), null)
    assert.doesNotThrow(() => persistPlaybackSession(session))
    assert.doesNotThrow(clearPlaybackSession)
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
