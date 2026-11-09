import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createPlaylistArtworkGrace, PLAYLIST_ARTWORK_GRACE_MS } from './playlistArtworkGrace.ts'

function fakeClock() {
  let now = 0
  const tasks: { at: number; callback: () => void; cancelled: boolean }[] = []
  return {
    now: () => now,
    schedule(callback: () => void, delay: number) {
      const task = { at: now + delay, callback, cancelled: false }
      tasks.push(task)
      return () => { task.cancelled = true }
    },
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const task = tasks.filter((candidate) => !candidate.cancelled && candidate.at <= target)
          .sort((a, b) => a.at - b.at)[0]
        if (!task) break
        now = task.at
        task.cancelled = true
        task.callback()
      }
      now = target
    },
    queuedCallbacks: () => tasks.map((task) => task.callback),
    pending: () => tasks.filter((task) => !task.cancelled).length,
  }
}
const cover = (id: string, bytes = 100, source = `${id}.mp3`) => ({ id, source, bytes, src: `blob:${id}` })

test('a pure owner can register its expiry handler before scheduling resources', () => {
  const clock = fakeClock()
  const grace = createPlaylistArtworkGrace(undefined, clock)
  assert.equal(clock.pending(), 0)
  let expired = 0
  grace.setExpiryHandler(() => { expired += 1 })
  grace.retain([cover('song')], new Set(), 100)
  clock.advance(PLAYLIST_ARTWORK_GRACE_MS)
  assert.equal(expired, 1)
})

test('text to cover within five seconds keeps the same owned URL; expiry really releases without interaction', () => {
  const clock = fakeClock()
  const image = cover('song')
  const resident = new Map([['song', image]])
  let demanded: ReadonlySet<string> = new Set(['song'])
  const revoked: string[] = []
  const grace = createPlaylistArtworkGrace(() => reconcile(), clock)
  function reconcile() {
    const warm = grace.retain([...resident.values()], demanded, 100)
    for (const [id, resource] of resident) if (!demanded.has(id) && !warm.has(id)) {
      revoked.push(resource.src)
      resident.delete(id)
    }
  }
  reconcile()
  demanded = new Set()
  reconcile()
  clock.advance(4999)
  assert.equal(resident.get('song'), image)
  assert.deepEqual(revoked, [])
  demanded = new Set(['song'])
  reconcile()
  clock.advance(10)
  assert.equal(resident.get('song'), image)
  assert.deepEqual(revoked, [])
  demanded = new Set()
  reconcile()
  clock.advance(PLAYLIST_ARTWORK_GRACE_MS)
  assert.equal(resident.size, 0)
  assert.deepEqual(revoked, ['blob:song'])
})

test('repeated text metadata reports do not renew the first inactive deadline', () => {
  const clock = fakeClock()
  let expiryCount = 0
  const grace = createPlaylistArtworkGrace(() => { expiryCount += 1 }, clock)
  const residents = [cover('song')]
  const text = new Set<string>()
  assert.equal(grace.retain(residents, text, 100).has('song'), true)
  clock.advance(4000)
  assert.equal(grace.retain(residents, text, 100).has('song'), true)
  clock.advance(1000)
  assert.equal(expiryCount, 1)
  assert.equal(grace.retain(residents, text, 100).size, 0)
  assert.equal(grace.retain(residents, text, 100).size, 0)
  assert.equal(clock.pending(), 0)
})

test('reacquire, scope reset and dispose fence callbacks that were already queued', () => {
  const clock = fakeClock()
  let expiryCount = 0
  const grace = createPlaylistArtworkGrace(() => { expiryCount += 1 }, clock)
  const residents = [cover('song')]
  grace.retain(residents, new Set(), 100)
  const oldCallback = clock.queuedCallbacks()[0]!
  grace.retain(residents, new Set(['song']), 100)
  oldCallback()
  assert.equal(expiryCount, 0)
  assert.equal(clock.pending(), 0)
  grace.retain(residents, new Set(), 100)
  const beforeReset = clock.queuedCallbacks().at(-1)!
  grace.reset()
  beforeReset()
  assert.equal(expiryCount, 0)
  grace.retain([cover('new-scope')], new Set(), 100)
  const beforeDispose = clock.queuedCallbacks().at(-1)!
  grace.dispose()
  beforeDispose()
  clock.advance(10000)
  assert.equal(expiryCount, 0)
  assert.equal(clock.pending(), 0)
})

test('resource pressure drops inactive covers first, with one nearest-expiry timer', () => {
  const clock = fakeClock()
  const grace = createPlaylistArtworkGrace(() => {}, clock)
  const residents = [cover('active', 1000), cover('warm-a', 100), cover('warm-b', 100)]
  const demanded = new Set(['active'])
  assert.deepEqual([...grace.retain(residents, demanded, 150)], ['warm-a'])
  assert.equal(clock.pending(), 1)
  assert.equal(grace.retain(residents, demanded, 0).size, 0)
  assert.equal(clock.pending(), 0)
  assert.equal(demanded.has('active'), true)
})

test('source replacement and removed residents cannot inherit an old grace lease', () => {
  const clock = fakeClock()
  const grace = createPlaylistArtworkGrace(() => {}, clock)
  grace.retain([cover('same-id')], new Set(), 100)
  clock.advance(2000)
  assert.equal(grace.retain([cover('same-id', 100, 'changed.mp3')], new Set(), 100).size, 0)
  assert.equal(grace.retain([cover('same-id', 100, 'changed.mp3')], new Set(), 100).size, 0)
  grace.retain([], new Set(), 100)
  assert.equal(clock.pending(), 0)
  assert.equal(grace.retain([cover('different')], new Set(), 100).has('different'), true)
})

test('text publisher invalidates cover geometry before deduplication can skip a mode return', () => {
  // The real component must invalidate before even identical text metadata can
  // return early. Otherwise the same cover geometry never reacquires its URLs.
  const source = readFileSync(new URL('../components/PlaylistPanel.tsx', import.meta.url), 'utf8')
  const textBranch = source.slice(source.indexOf('if (!layout.showArtwork) {'), source.indexOf('// Geometry is recalculated'))
  assert.ok(textBranch.indexOf("artworkWindowKeyRef.current = ''") >= 0)
  assert.ok(textBranch.indexOf("artworkWindowKeyRef.current = ''") < textBranch.indexOf('metadataWindowKeyRef.current === windowKey'))
  const emptyGrid = source.slice(source.indexOf('if (!panel || !onVisibleTrackIdsChange) return'), source.indexOf('metadataWindowKeyRef.current = null'))
  assert.ok(emptyGrid.indexOf("if (!layout.showArtwork) artworkWindowKeyRef.current = ''") >= 0)
  assert.ok(emptyGrid.indexOf("if (!layout.showArtwork) artworkWindowKeyRef.current = ''") < emptyGrid.indexOf('if (!grid)'))
})
