import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlaylistArtworkStore, playlistArtworkKey, type PlaylistArtworkSnapshot } from './playlistArtworkStore.ts'

const image = (name: string): PlaylistArtworkSnapshot => ({
  coverTone: 'lagoon', hasLocalArtwork: true,
  coverThumbnail: { src: `blob:${name}`, width: 256, height: 256, encodedBytes: 262184 },
})

test('publication notifies only the subscribed song whose canonical snapshot changed', () => {
  const rows = new Map<string, PlaylistArtworkSnapshot>()
  const store = createPlaylistArtworkStore(key => rows.get(key))
  const a = playlistArtworkKey('scope-a', 'a', '/audio/a.flac')
  const b = playlistArtworkKey('scope-a', 'b', '/audio/b.flac')
  let aNotices = 0, bNotices = 0
  const unsubscribeA = store.subscribe(a, () => aNotices++)
  const unsubscribeB = store.subscribe(b, () => bNotices++)
  const snapshot = image('a')
  rows.set(a, snapshot)
  store.notify([a])
  assert.equal(aNotices, 1)
  assert.equal(bNotices, 0)
  assert.equal(store.getSnapshot(a), snapshot)
  store.notify([a, a, b])
  assert.equal(aNotices, 1, 'duplicate and unchanged notifications cannot rerender the card')
  unsubscribeA(); unsubscribeB()
})

test('replacement, rollback, removal and reset expose the current owner without retaining images', () => {
  const original = image('original'), replacement = image('replacement')
  const rows = new Map<string, PlaylistArtworkSnapshot>([['a', original], ['b', image('b')]])
  const store = createPlaylistArtworkStore(key => rows.get(key))
  const observed: (PlaylistArtworkSnapshot | undefined)[] = []
  let bNotices = 0
  const offA = store.subscribe('a', () => observed.push(store.getSnapshot('a')))
  const offB = store.subscribe('b', () => bNotices++)
  rows.set('a', replacement); store.notify(['a'])
  rows.set('a', original); store.notify(['a'])
  rows.delete('a'); store.notify(['a'])
  assert.deepEqual(observed, [replacement, original, undefined])
  assert.equal(store.getSnapshot('a'), undefined, 'the bridge never owns a stale cover after eviction')
  rows.clear(); store.notifyAll()
  assert.equal(bNotices, 1)
  assert.equal(observed.length, 3, 'reset does not publish an already removed row twice')
  offA(); offB()
})

test('scope, track and normalized source path isolate stale publications across replacements', () => {
  const oldKey = playlistArtworkKey('scope-a', 'same-id', 'C:\\music\\old.flac')
  assert.equal(oldKey, playlistArtworkKey('scope-a', 'same-id', 'C:/music/old.flac'))
  const newKey = playlistArtworkKey('scope-a', 'same-id', 'C:/music/new.flac')
  const otherScope = playlistArtworkKey('scope-b', 'same-id', 'C:/music/old.flac')
  assert.notEqual(oldKey, newKey); assert.notEqual(oldKey, otherScope)
  assert.notEqual(oldKey, playlistArtworkKey('scope-a', 'other-id', 'C:/music/old.flac'))
  const rows = new Map<string, PlaylistArtworkSnapshot>()
  const store = createPlaylistArtworkStore(key => rows.get(key))
  let oldNotices = 0, newNotices = 0
  const offOld = store.subscribe(oldKey, () => oldNotices++)
  const offNew = store.subscribe(newKey, () => newNotices++)
  rows.set(newKey, image('new')); store.notify([newKey])
  rows.set(otherScope, image('other-scope')); store.notify([otherScope])
  assert.equal(oldNotices, 0); assert.equal(newNotices, 1)
  assert.equal(store.getSnapshot(oldKey), undefined)
  offOld(); offNew()
})

test('unsubscribe cleans up only that listener; resubscription observes the latest snapshot', () => {
  const rows = new Map<string, PlaylistArtworkSnapshot>()
  const store = createPlaylistArtworkStore(key => rows.get(key))
  let removedNotices = 0, liveNotices = 0
  const off = store.subscribe('song', () => removedNotices++)
  const offLive = store.subscribe('song', () => liveNotices++)
  off(); off()
  const latest = image('latest')
  rows.set('song', latest); store.notifyAll()
  assert.equal(removedNotices, 0); assert.equal(liveNotices, 1)
  const offAgain = store.subscribe('song', () => removedNotices++)
  assert.equal(store.getSnapshot('song'), latest)
  store.notifyAll()
  assert.equal(removedNotices, 0, 'a newly mounted card reads current data without a fake change')
  offAgain(); offLive()
  rows.delete('song'); store.notifyAll()
  assert.equal(removedNotices, 0); assert.equal(liveNotices, 1)
})

test('retention delegates lease ownership to the source cache and is optional', () => {
  const counts = new Map<string, number>()
  const store = createPlaylistArtworkStore(() => undefined, key => {
    counts.set(key, (counts.get(key) ?? 0) + 1)
    return () => counts.set(key, (counts.get(key) ?? 0) - 1)
  })
  const releaseA = store.retain('fallback-song')
  const releaseB = store.retain('fallback-song')
  assert.equal(counts.get('fallback-song'), 2)
  releaseA()
  assert.equal(counts.get('fallback-song'), 1, 'one card releasing cannot remove another card lease')
  releaseB()
  assert.equal(counts.get('fallback-song'), 0)
  const optional = createPlaylistArtworkStore(() => undefined)
  assert.doesNotThrow(() => optional.retain('unknown-song')())
})

test('binding a canonical owner after subscribing publishes current data and updates its retainer', () => {
  const store = createPlaylistArtworkStore(() => undefined)
  const latest = image('bound-owner')
  let notices = 0, leases = 0
  const off = store.subscribe('song', () => notices++)
  store.bind(key => key === 'song' ? latest : undefined, () => { leases++; return () => { leases-- } })
  assert.equal(store.getSnapshot('song'), latest)
  assert.equal(notices, 1, 'cards mounted before layout binding receive the actual owner snapshot')
  const release = store.retain('song')
  assert.equal(leases, 1)
  store.bind(() => undefined)
  assert.equal(notices, 2, 'detaching the owner clears an already displayed snapshot')
  release()
  assert.equal(leases, 0, 'an existing lease retains the release function of its original owner')
  assert.doesNotThrow(() => store.retain('song')())
  off()
})
