import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPlaylistArtworkStore,
  heroDisplayIdentity,
  heroPlaylistArtworkKey,
  heroSlotId,
  isHeroArtworkKey,
  isHeroSlotId,
  playlistArtworkKey,
  type PlaylistArtworkSnapshot,
} from './playlistArtworkStore.ts'

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

// ---------------------------------------------------------------------------
// The hero lane's key
// ---------------------------------------------------------------------------

test('the row key stays a 3-tuple and the hero key appends the lane marker', () => {
  // The row key's bytes are a contract: owners destructure it positionally and
  // every existing publication is keyed by it.
  const row = playlistArtworkKey('scope-a', 'a', 'C:\\music\\a.flac')
  const tuple = JSON.parse(row) as unknown[]
  assert.equal(tuple.length, 3, 'the row key is a 3-tuple')
  assert.deepEqual(tuple, ['scope-a', 'a', 'C:/music/a.flac'])

  const hero = heroPlaylistArtworkKey(row)
  const heroTuple = JSON.parse(hero) as unknown[]
  assert.equal(heroTuple.length, 4, 'the hero key is a 4-tuple')
  assert.deepEqual(heroTuple.slice(0, 3), tuple, 'the first three elements ARE the row key')
  assert.equal(heroTuple[3], 'hero')
})

test('a hero key is never equal to a row key, and the lanes are distinguishable', () => {
  const row = playlistArtworkKey('scope-a', 'a', '/music/a.flac')
  const hero = heroPlaylistArtworkKey(row)
  assert.notEqual(hero, row, 'the two lanes must not collide')
  assert.equal(isHeroArtworkKey(hero), true)
  assert.equal(isHeroArtworkKey(row), false, 'a 3-tuple is a row, including every legacy key')
  // A key that merely *looks* like a hero key without the marker is a row.
  assert.equal(isHeroArtworkKey(playlistArtworkKey('scope-a', 'a', 'hero')), false)
  // Different resources cannot share a hero key either.
  assert.notEqual(hero, heroPlaylistArtworkKey(playlistArtworkKey('scope-b', 'a', '/music/a.flac')))
  assert.notEqual(hero, heroPlaylistArtworkKey(playlistArtworkKey('scope-a', 'b', '/music/a.flac')))
  assert.notEqual(hero, heroPlaylistArtworkKey(playlistArtworkKey('scope-a', 'a', '/music/b.flac')))
})

test('the hero key cannot be built from anything but a 3-tuple row key', () => {
  // Forward-construction only: there is no way to spell a hero key from raw
  // parts, so a caller cannot invent a scope the owner did not publish.
  assert.throws(() => heroPlaylistArtworkKey(JSON.stringify(['s', 'a'])), /3-element row key/)
  assert.throws(() => heroPlaylistArtworkKey(JSON.stringify(['s', 'a', 'p', 'hero'])), /3-element row key/)
  assert.throws(() => heroPlaylistArtworkKey(JSON.stringify('not-a-tuple')), /3-element row key/)
})

test('the hero slot id can never be mistaken for a real track id', () => {
  const slot = heroSlotId('track-1')
  assert.notEqual(slot, 'track-1')
  assert.equal(isHeroSlotId(slot), true)
  assert.equal(isHeroSlotId('track-1'), false)
  // Even a track id that already contains the separator does not become a row
  // key by accident: the check is on the suffix.
  assert.equal(isHeroSlotId(`${heroSlotId('track-1')}\u0000hero`), true)
})

test('the hero display identity carries every element that makes a different image', () => {
  const source = { scope: 'folder\u0000/music', trackId: 'track-0', sourcePath: '/music/0.flac', artworkRevision: 3 }
  const identity = heroDisplayIdentity(source)
  const tuple = JSON.parse(identity) as unknown[]
  assert.deepEqual(tuple, ['playlist-hero', 'folder\u0000/music', 'track-0', '/music/0.flac', 3])
  // Each part alone makes a different identity, so §3's sticky hold cannot keep
  // an image that describes something else.
  for (const variant of [
    { ...source, scope: 'folder\u0000/other' },
    { ...source, trackId: 'track-1' },
    { ...source, sourcePath: '/music/1.flac' },
    { ...source, artworkRevision: 4 },
  ]) {
    assert.notEqual(heroDisplayIdentity(variant), identity)
  }
  // The tier is deliberately NOT part of it: a resize must not read as a
  // different image.
  assert.equal(heroDisplayIdentity({ ...source }), identity)
})

test('a hero key and a row key are independent subscriptions in one store', () => {
  const rows = new Map<string, PlaylistArtworkSnapshot>()
  const store = createPlaylistArtworkStore(key => rows.get(key))
  const row = playlistArtworkKey('scope-a', 'a', '/music/a.flac')
  const hero = heroPlaylistArtworkKey(row)
  let rowNotices = 0, heroNotices = 0
  const offRow = store.subscribe(row, () => rowNotices++)
  const offHero = store.subscribe(hero, () => heroNotices++)
  // Publishing the hero must not notify the row, and vice versa: that separation
  // is what stops a high tier from reaching a card.
  rows.set(hero, image('hero')); store.notify([hero])
  assert.equal(heroNotices, 1)
  assert.equal(rowNotices, 0, 'a hero publication does not reach the row subscription')
  rows.set(row, image('row')); store.notify([row])
  assert.equal(rowNotices, 1)
  assert.equal(heroNotices, 1, 'a row publication does not reach the hero subscription')
  // The hero key is absent by default, which is what makes the row fallback the
  // default behaviour with no "is the hero enabled" flag.
  rows.delete(hero); store.notify([hero])
  assert.equal(store.getSnapshot(hero), undefined)
  assert.equal(store.getSnapshot(row), rows.get(row))
  offRow(); offHero()
})

test('getSnapshot returns the owner object itself, never a fresh copy', () => {
  // `useSyncExternalStore` compares snapshots by identity on every read. A reader
  // that projected the snapshot into a new object would make React re-render on
  // every check — an infinite loop the panel hit once. The store must therefore
  // hand back exactly what the owner stored, including for a hero key.
  const rows = new Map<string, PlaylistArtworkSnapshot>()
  const store = createPlaylistArtworkStore(key => rows.get(key))
  const row = playlistArtworkKey('scope-a', 'a', '/music/a.flac')
  const hero = heroPlaylistArtworkKey(row)
  const heroSnapshot = image('hero')
  const rowSnapshot = image('row')
  rows.set(hero, heroSnapshot)
  rows.set(row, rowSnapshot)
  assert.equal(store.getSnapshot(hero), heroSnapshot, 'hero reads are identity-stable')
  assert.equal(store.getSnapshot(hero), store.getSnapshot(hero), 'repeated reads are the same object')
  assert.equal(store.getSnapshot(row), rowSnapshot, 'row reads are identity-stable')
  // An absent key is `undefined` on every read, not a fresh empty object.
  assert.equal(store.getSnapshot(heroPlaylistArtworkKey(playlistArtworkKey('s', 'x', '/p'))), undefined)
})
