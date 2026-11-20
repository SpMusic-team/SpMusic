import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

// Execute the shipped callback with controlled command completion, rather than
// duplicate its implementation. The browser regression covers the full hook/UI.
const source = await readFile(new URL('../hooks/useAudioPlayer.ts', import.meta.url), 'utf8')
const callback = source.slice(source.indexOf('  async function restoreBookmark('), source.indexOf('  const shufflePlaybackQueue', source.indexOf('  async function restoreBookmark(')))
const code = ts.transpileModule(callback, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText
function harness(phase = 'playing') {
  const state = { currentTrackId: 'a', generation: 1, durationMs: 180000, positionMs: 30000, phase }
  const calls = []
  const motions = []
  const deps = {
    audioSelectionInProgressRef: { current: false }, timelineInteractionRef: { current: 'following' },
    bookmarksRef: { current: [{ id: 'b' }] }, bookmarkRestoringRef: { current: false },
    latestAudioStateRef: { current: state }, audioTrackRef: { current: { id: 'a', sourcePath: '/a.flac' } },
    selectionRequestIdRef: { current: 1 }, seekRequestIdRef: { current: 1 }, audioStateRequestGenerationRef: { current: 1 },
    seekTargetGuardRef: { current: null }, recentTrackerRef: { current: { breakBaseline() { calls.push('breakBaseline') } } },
    visualTimelineClock: { getPositionSeconds: () => 30 }, bookmarkProgressSequenceRef: { current: 0 },
    setBookmarkProgressMotion(motion) { motions.push(motion) },
    normalizeAudioSourcePath: path => path, playlistScope: () => 'folder',
    findPlaylistForScope: () => ({ tracks: [{ id: 'a', sourcePath: '/a.flac', available: true }, { id: 'c', sourcePath: '/c.flac', available: true }] }),
    toast: { error() {} }, commandError: e => e, commitAudioError: e => calls.push(['error', e.message]),
    setBookmarkRestoring() {}, setTimelineInteraction() {}, setTransportBusy() {}, activatePlaylistScope() { calls.push('activateScope') },
    applyAudioState(next) { deps.latestAudioStateRef.current = next },
    async seekAudio(positionMs) { calls.push(['seek', positionMs]); return { ...deps.latestAudioStateRef.current, positionMs } },
    async playAudio(options) { calls.push(['play', options]); return { ...deps.latestAudioStateRef.current, phase: 'playing' } },
    async loadFolderAudioTrack(...args) {
      calls.push(['load', ...args]); deps.selectionRequestIdRef.current++
      deps.latestAudioStateRef.current = { ...state, currentTrackId: args[0].id, phase: 'playing', positionMs: args[6] }
      return true
    },
    transportOperationInProgress: () => deps.bookmarkRestoringRef.current,
  }
  const restore = new Function(...Object.keys(deps), `${code}; return restoreBookmark`)(...Object.values(deps))
  return { restore, deps, calls, motions, bookmark: { id: 'b', sourcePath: '/a.flac', positionMs: 58000 }, item: { scope: 'folder', trackId: 'a' } }
}
globalThis.window ??= { performance }

test('playing same-track bookmark seeks without reload, pause, play or selection activation', async () => {
  const h = harness()
  assert.equal(await h.restore(h.bookmark, h.item), true)
  assert.deepEqual(h.calls, ['breakBaseline', ['seek', 58000]])
  assert.equal(h.deps.latestAudioStateRef.current.phase, 'playing')
  assert.equal(h.deps.timelineInteractionRef.current, 'following')
  assert.deepEqual(h.motions.map(m => [m.startRatio, m.targetPositionMs, m.ready]), [[1 / 6, 58000, false], [1 / 6, 58000, true]])
})
test('paused same-track bookmark seeks then starts playback once', async () => {
  const h = harness('paused')
  assert.equal(await h.restore(h.bookmark, h.item), true)
  assert.deepEqual(h.calls, ['breakBaseline', ['seek', 58000], ['play', { restart: false }]])
})
test('cross-track bookmark forwards initial position and normal selection intent atomically', async () => {
  const h = harness()
  assert.equal(await h.restore({ ...h.bookmark, sourcePath: '/c.flac' }, { ...h.item, trackId: 'c' }), true)
  const load = h.calls.find(call => call[0] === 'load')
  assert.equal(load[2], true)
  assert.deepEqual(load[5], { direction: 1, source: 'queue' })
  assert.equal(load[7], 58000)
  assert.ok(!h.calls.some(call => call[0] === 'seek' || call[0] === 'play'))
  assert.deepEqual(h.motions.map(m => [m.startRatio, m.targetPositionMs, m.ready]), [[1 / 6, 58000, false], [1 / 6, 58000, true]])
})
test('seek rejection never plays and releases the lock for retry', async () => {
  const h = harness()
  // Recreate callback with rejected seek injected before binding its closure.
  h.deps.seekAudio = async () => { throw new Error('seek rejected') }
  const restore = new Function(...Object.keys(h.deps), `${code}; return restoreBookmark`)(...Object.values(h.deps))
  assert.equal(await restore(h.bookmark, h.item), false)
  assert.ok(!h.calls.some(call => call[0] === 'play'))
  assert.equal(h.deps.bookmarkRestoringRef.current, false)
  assert.equal(h.deps.timelineInteractionRef.current, 'following')
})
