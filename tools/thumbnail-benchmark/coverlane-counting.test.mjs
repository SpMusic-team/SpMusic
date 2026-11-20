// Counting-contract tests for the coverlane harness.
//
// These cover the ten cases the correction plan §6 names for
// `tools/thumbnail-benchmark/coverlane-counting.test.mjs`, plus the three counting
// defects that motivated the rewrite:
//
//   A. the source bucket key ignored `clientId`
//   B. folder commands produced no source and were silently skipped
//   C. fallback was inferred from "both lanes appeared for one key"
//
// Run: node --test tools/thumbnail-benchmark/coverlane-counting.test.mjs
//
// These tests drive the real counting code. They do not re-implement it, and they
// do not mock the decision under test: the ledger is fed the same event shapes the
// scheduling boundary emits, and the CDP cross-check is fed the same request
// records `LaneRecorder` produces.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CoverAttemptLedger,
  sourceIdentity,
  attemptIdentity,
  workloadKey,
  summarizeLaneAttempts,
  summarizeCommandBytes,
  assessByteComparability,
  normalizeSource,
  laneOfCommand,
  kindOfCommand,
  fingerprint,
} from './coverlane-counting.mjs'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Build one IPC request record the way `LaneRecorder` would. */
function ipcRequest({ command, input, status = 200, decodedBytes = 200, encodedBytes = 260, requestBytes = 120, finished = true }) {
  return {
    command,
    postData: JSON.stringify({ input }),
    status,
    decodedBytes,
    encodedBytes,
    requestBytes,
    finishedAtMs: finished ? 1 : null,
    startedAtMs: 0,
  }
}

const TRACK_PATH = '/audio_load_track_thumbnail_path'
const TRACK_PIXELS = '/audio_load_track_thumbnail'
const FOLDER_PATH = '/audio_load_folder_thumbnail_path'
const FOLDER_PIXELS = '/audio_load_folder_thumbnail'
const COVER_PATH = '/audio_load_playlist_cover_thumbnail_path'
const COVER_PIXELS = '/audio_load_playlist_cover_pixels'

function trackInput({ clientId, sourcePath, generation = 1, maxEdge = 256 }) {
  return { clientId, sourcePath, windowGeneration: generation, maxEdge }
}

function folderInput({ clientId, rootPath, directoryPath, generation = 1, maxEdge = 256 }) {
  return { clientId, rootPath, directoryPath, windowGeneration: generation, maxEdge }
}

function coverInput({ clientId, filePath, generation = 1, maxEdge = 512 }) {
  return { clientId, filePath, windowGeneration: generation, maxEdge }
}

function startEvent({ type = 'pathStart', attemptId, kind = 'track', clientId, generation = 1, sourceKey, edge = 256, requestId, at = 0 }) {
  // `lane` is deliberately absent: a start event's lane follows from the event
  // type in the ledger, and accepting it here would let a test pass a lane the
  // ledger never reads.
  return { type, attemptId, kind, clientId, generation, sourceKey, edge, requestId, at, authority: 'observed' }
}

// ---------------------------------------------------------------------------
// defect B: each artifact kind reads its own source fields
// ---------------------------------------------------------------------------

test('defect B: folder identity uses rootPath + directoryPath', () => {
  const folder = sourceIdentity({ rootPath: 'C:/Music', directoryPath: 'C:/Music/Album' }, 'folder')
  assert.ok(folder.sourceKey, 'folder must produce a source key')
  assert.match(folder.sourceKey, /folder/)
  assert.equal(folder.rootPath, normalizeSource('C:/Music'))
  assert.equal(folder.directoryPath, normalizeSource('C:/Music/Album'))
})

test('defect B: folder request is no longer silently dropped', () => {
  const requests = [ipcRequest({ command: FOLDER_PATH, input: folderInput({ clientId: 'c1', rootPath: 'C:/M', directoryPath: 'C:/M/A' }) })]
  const summary = summarizeLaneAttempts(requests)
  assert.equal(summary.unmatched.count, 0, 'a well formed folder request must not be unmatched')
  assert.equal(summary.laneAttempts.distinctAttempts, 1)
  assert.equal(summary.laneAttempts.byKind.folder, 1)
})

test('defect B: track uses sourcePath, cover uses filePath', () => {
  const track = sourceIdentity({ sourcePath: 'C:/M/a.flac' }, 'track')
  const cover = sourceIdentity({ filePath: 'C:/M/b.flac' }, 'cover')
  assert.match(track.sourceKey, /^track/)
  assert.match(cover.sourceKey, /^cover/)
  assert.notEqual(track.sourceKey, cover.sourceKey, 'track and cover with the same underlying name must not collide')
})

test('defect B: a folder request missing a half is reported, not skipped', () => {
  const requests = [ipcRequest({ command: FOLDER_PATH, input: { clientId: 'c1', rootPath: 'C:/M', windowGeneration: 1, maxEdge: 256 } })]
  const summary = summarizeLaneAttempts(requests)
  assert.equal(summary.unmatched.count, 1)
  assert.match(summary.unmatched.detail[0].reason, /directoryPath/)
})

// ---------------------------------------------------------------------------
// defect A: clients stay separate
// ---------------------------------------------------------------------------

test('defect A: two clients using one lane each are not one fallback', () => {
  const requests = [
    ipcRequest({ command: TRACK_PATH, input: trackInput({ clientId: 'owner-a', sourcePath: 'C:/M/a.flac' }) }),
    ipcRequest({ command: TRACK_PIXELS, input: trackInput({ clientId: 'owner-b', sourcePath: 'C:/M/a.flac' }) }),
  ]
  const summary = summarizeLaneAttempts(requests)
  // Two distinct attempts because clientId is in the attempt identity.
  assert.equal(summary.laneAttempts.distinctAttempts, 2)
  assert.deepEqual(summary.laneAttempts.byClient, { 'owner-a': 1, 'owner-b': 1 })
  // The old code reported bothLaneWorkloads = 1 here and called it a fallback.
  assert.equal(summary.workloads.bothLaneWorkloads, 1, 'the workload did see both lanes')
  assert.equal(summary.workloads.bothLaneAcrossClientsOnly, 1, 'and it is flagged as the defect-A shape')
})

// ---------------------------------------------------------------------------
// case 1: folder same directory fallback == 1
// ---------------------------------------------------------------------------

test('case 1: one folder path->pixels recovery counts exactly 1', () => {
  const ledger = new CoverAttemptLedger({ ownerSession: 's1' })
  const source = sourceIdentity(folderInput({ clientId: 'c1', rootPath: 'C:/M', directoryPath: 'C:/M/A' }), 'folder')
  ledger.record(startEvent({ attemptId: 'a1', kind: 'folder', clientId: 'c1', sourceKey: source.sourceKey, requestId: 'r1' }))
  ledger.record({ type: 'pathFailed', attemptId: 'a1', kind: 'folder', clientId: 'c1', sourceKey: source.sourceKey, reason: 'decode', at: 10, authority: 'observed' })
  ledger.record({
    type: 'fallbackStarted', attemptId: 'a1', recoveryAttemptId: 'rec-1', parentAttemptId: 'a1',
    kind: 'folder', clientId: 'c1', sourceKey: source.sourceKey, edge: 256, recoveryEpoch: 1,
    reason: 'decode', at: 11, authority: 'observed',
  })
  ledger.record({ type: 'fallbackCompleted', recoveryAttemptId: 'rec-1', at: 90, reason: 'pixels-ready', authority: 'observed' })
  const summary = ledger.summarize()
  assert.equal(summary.fallbacks.count, 1, 'exactly one recovery job')
  assert.equal(summary.fallbacks.completed, 1)
  assert.equal(summary.fallbacks.failed, 0)
  assert.equal(summary.attempts.byTerminal.failed, 1, 'the path attempt itself is a failure')
})

// ---------------------------------------------------------------------------
// case 2: different clients, independent lanes == 0
// ---------------------------------------------------------------------------

test('case 2: different clients on independent lanes produce 0 recoveries', () => {
  const ledger = new CoverAttemptLedger({ ownerSession: 's1' })
  const sourceA = sourceIdentity(trackInput({ clientId: 'owner-a', sourcePath: 'C:/M/a.flac' }), 'track')
  const sourceB = sourceIdentity(trackInput({ clientId: 'owner-b', sourcePath: 'C:/M/a.flac' }), 'track')
  ledger.record(startEvent({ attemptId: 'a1', clientId: 'owner-a', sourceKey: sourceA.sourceKey }))
  ledger.record({ type: 'pathReady', attemptId: 'a1', kind: 'track', clientId: 'owner-a', sourceKey: sourceA.sourceKey, at: 5, authority: 'observed' })
  ledger.record(startEvent({ type: 'pixelsStart', attemptId: 'b1', lane: 'pixels', clientId: 'owner-b', sourceKey: sourceB.sourceKey }))
  const summary = ledger.summarize()
  assert.equal(summary.fallbacks.count, 0, 'no recovery was ever started')
  assert.equal(summary.attempts.total, 2)
  assert.equal(summary.attempts.byTerminal.ready, 1)
  assert.equal(summary.attempts.byTerminal['in-flight'], 1, 'the pixels attempt is still running')
})

// ---------------------------------------------------------------------------
// case 3: same directory, different roots stay separate
// ---------------------------------------------------------------------------

test('case 3: same directory name under different roots stays separate', () => {
  const a = sourceIdentity({ rootPath: 'C:/Music', directoryPath: 'C:/Music/Album' }, 'folder')
  const b = sourceIdentity({ rootPath: 'D:/Music', directoryPath: 'D:/Music/Album' }, 'folder')
  assert.notEqual(a.sourceKey, b.sourceKey, 'the root must be part of the folder identity')

  const requests = [
    ipcRequest({ command: FOLDER_PATH, input: folderInput({ clientId: 'c1', rootPath: 'C:/Music', directoryPath: 'C:/Music/Album' }) }),
    ipcRequest({ command: FOLDER_PIXELS, input: folderInput({ clientId: 'c1', rootPath: 'D:/Music', directoryPath: 'D:/Music/Album' }) }),
  ]
  const summary = summarizeLaneAttempts(requests)
  assert.equal(summary.workloads.distinct, 2, 'two roots are two workloads')
  assert.equal(summary.workloads.bothLaneWorkloads, 0, 'so no false both-lane signal')
})

// ---------------------------------------------------------------------------
// case 4: 512 playlist-cover
// ---------------------------------------------------------------------------

test('case 4: a 512 playlist-cover is keyed by filePath and edge', () => {
  const input = coverInput({ clientId: 'hero', filePath: 'C:/M/covers/x.jpg', maxEdge: 512 })
  const identity = sourceIdentity(input, 'cover')
  assert.match(identity.sourceKey, /^cover/)

  const requests = [
    ipcRequest({ command: COVER_PATH, input }),
    ipcRequest({ command: COVER_PATH, input: coverInput({ clientId: 'hero', filePath: 'C:/M/covers/x.jpg', maxEdge: 256 }) }),
  ]
  const summary = summarizeLaneAttempts(requests)
  assert.equal(summary.laneAttempts.distinctAttempts, 2, '256 and 512 are different attempts')
  assert.equal(summary.workloads.distinct, 2, 'and different workloads')
})

test('case 4b: 512 recovery is counted once and carries its edge', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(coverInput({ clientId: 'hero', filePath: 'C:/M/covers/x.jpg', maxEdge: 512 }), 'cover')
  ledger.record(startEvent({ attemptId: 'p512', kind: 'cover', clientId: 'hero', sourceKey: source.sourceKey, edge: 512 }))
  ledger.record({ type: 'pathFailed', attemptId: 'p512', kind: 'cover', clientId: 'hero', sourceKey: source.sourceKey, reason: 'command', at: 4, authority: 'observed' })
  ledger.record({
    type: 'fallbackStarted', attemptId: 'p512', recoveryAttemptId: 'rec-512', parentAttemptId: 'p512',
    kind: 'cover', clientId: 'hero', sourceKey: source.sourceKey, edge: 512, recoveryEpoch: 2,
    reason: 'command', at: 5, authority: 'observed',
  })
  const summary = ledger.summarize()
  assert.equal(summary.fallbacks.count, 1)
  assert.equal(summary.fallbacks.detail[0].edge, 512, 'the recovery carries the edge it was for')
  assert.equal(summary.fallbacks.detail[0].recoveryEpoch, 2)
})

// ---------------------------------------------------------------------------
// case 5: shared native request, several subscribers
// ---------------------------------------------------------------------------

test('case 5: a shared native request is counted once with its consumers listed', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  // Three consumers, one shared request id.
  for (const attemptId of ['a1', 'a2', 'a3']) {
    ledger.record(startEvent({ attemptId, clientId: 'c1', sourceKey: source.sourceKey, requestId: 'shared-1' }))
    ledger.record({ type: 'pathReady', attemptId, kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, requestId: 'shared-1', at: 3, authority: 'observed' })
  }
  const summary = ledger.summarize()
  assert.equal(summary.nativeRequests.distinct, 1, 'one native request')
  assert.equal(summary.nativeRequests.consumerCount, 3, 'three consumers')
  assert.equal(summary.nativeRequests.shared, 1)
  assert.equal(summary.nativeRequests.sharedDetail[0].consumers, 3)
  assert.equal(summary.fallbacks.count, 0)
})

test('case 5b: three consumers of one failed shared request are one recovery, not three', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  for (const attemptId of ['a1', 'a2', 'a3']) {
    ledger.record(startEvent({ attemptId, clientId: 'c1', sourceKey: source.sourceKey, requestId: 'shared-1' }))
    ledger.record({ type: 'pathFailed', attemptId, kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, reason: 'decode', at: 9, authority: 'observed' })
  }
  // The scheduler dedupes to one recovery job for the shared request.
  ledger.record({
    type: 'fallbackStarted', attemptId: 'a1', recoveryAttemptId: 'rec-shared', parentAttemptId: 'a1',
    kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, edge: 256, recoveryEpoch: 1,
    reason: 'decode', at: 10, authority: 'observed',
  })
  const summary = ledger.summarize()
  assert.equal(summary.attempts.byTerminal.failed, 3, 'three consumers did observe the failure')
  assert.equal(summary.fallbacks.count, 1, 'but exactly one recovery job was started')
})

// ---------------------------------------------------------------------------
// case 6: pathReady then DOM failure == 1
// ---------------------------------------------------------------------------

test('case 6: a DOM failure after pathReady produces exactly 1 recovery', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  ledger.record(startEvent({ attemptId: 'a1', clientId: 'c1', sourceKey: source.sourceKey, requestId: 'r1' }))
  ledger.record({ type: 'pathReady', attemptId: 'a1', kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, at: 20, authority: 'observed' })
  // The lane succeeded; the real <img> then failed.
  ledger.record({ type: 'DOMFailure', attemptId: 'a1', publishGeneration: 7, at: 40, reason: 'img-error', authority: 'observed' })
  ledger.record({
    type: 'fallbackStarted', attemptId: 'a1', recoveryAttemptId: 'rec-dom', parentAttemptId: 'a1',
    kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, edge: 256, recoveryEpoch: 1,
    reason: 'dom', at: 41, authority: 'observed',
  })
  ledger.record({ type: 'fallbackCompleted', recoveryAttemptId: 'rec-dom', at: 120, reason: 'pixels-ready', authority: 'observed' })
  const summary = ledger.summarize()
  assert.equal(summary.domFailure.count, 1)
  assert.equal(summary.fallbacks.count, 1, 'exactly one recovery for one DOM failure')
  assert.equal(summary.fallbacks.detail[0].reason, 'dom')
})

test('case 6b: the same DOM failure reported by two images is one failure and one recovery', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  ledger.record(startEvent({ attemptId: 'a1', clientId: 'c1', sourceKey: source.sourceKey }))
  ledger.record({ type: 'pathReady', attemptId: 'a1', kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, at: 20, authority: 'observed' })
  // Two <img> elements share one publication; both report the same error.
  const first = ledger.record({ type: 'DOMFailure', attemptId: 'a1', publishGeneration: 3, at: 40, reason: 'img-error', authority: 'observed' })
  const second = ledger.record({ type: 'DOMFailure', attemptId: 'a1', publishGeneration: 3, at: 41, reason: 'img-error', authority: 'observed' })
  assert.equal(first.accepted, true)
  assert.equal(second.duplicate, true, 'the repeat is recognised as a duplicate')
  ledger.record({
    type: 'fallbackStarted', attemptId: 'a1', recoveryAttemptId: 'rec-once', parentAttemptId: 'a1',
    kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, edge: 256, recoveryEpoch: 1, at: 42, authority: 'observed',
  })
  const summary = ledger.summarize()
  assert.equal(summary.domFailure.count, 1, 'one publication, one failure')
  assert.equal(summary.fallbacks.count, 1)
})

// ---------------------------------------------------------------------------
// case 7: stale / abort == 0
// ---------------------------------------------------------------------------

test('case 7: stale and abort are cancellations, never failures or recoveries', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  ledger.record(startEvent({ attemptId: 'a1', clientId: 'c1', sourceKey: source.sourceKey }))
  ledger.record({ type: 'stale', attemptId: 'a1', kind: 'track', lane: 'path', at: 8, authority: 'observed' })
  ledger.record(startEvent({ attemptId: 'a2', clientId: 'c1', sourceKey: source.sourceKey }))
  ledger.record({ type: 'abort', attemptId: 'a2', kind: 'track', lane: 'path', at: 9, authority: 'observed' })
  const summary = ledger.summarize()
  assert.equal(summary.fallbacks.count, 0, 'a cancellation must never open a recovery')
  assert.equal(summary.cancel.count, 2)
  assert.deepEqual(summary.cancel.byReason, { stale: 1, abort: 1 })
  assert.equal(summary.attempts.byTerminal.dropped, 2)
  assert.equal(summary.attempts.byTerminal.failed ?? 0, 0, 'a dropped attempt is not a failure')
  assert.equal(summary.fallbacks.fromCancellation, 0)
})

test('case 7b: recovery opened for a cancelled attempt is detectable', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  ledger.record(startEvent({ attemptId: 'a1', clientId: 'c1', sourceKey: source.sourceKey }))
  ledger.record({ type: 'stale', attemptId: 'a1', kind: 'track', lane: 'path', at: 8, authority: 'observed' })
  // A bug that opens a recovery on a cancellation must be visible, not silent.
  ledger.record({
    type: 'fallbackStarted', attemptId: 'a1', recoveryAttemptId: 'rec-bug', parentAttemptId: 'a1',
    kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, edge: 256, recoveryEpoch: 1, at: 9, authority: 'observed',
  })
  const summary = ledger.summarize()
  assert.equal(summary.fallbacks.fromCancellation, 1, 'the ledger flags a recovery caused by a cancellation')
})

// ---------------------------------------------------------------------------
// case 8: a failed / timed-out recovery still has a terminal state
// ---------------------------------------------------------------------------

test('case 8: a failed recovery keeps a terminal state instead of hanging', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  ledger.record(startEvent({ attemptId: 'a1', clientId: 'c1', sourceKey: source.sourceKey }))
  ledger.record({ type: 'pathFailed', attemptId: 'a1', kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, reason: 'timeout', at: 10, authority: 'observed' })
  ledger.record({
    type: 'fallbackStarted', attemptId: 'a1', recoveryAttemptId: 'rec-fail', parentAttemptId: 'a1',
    kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, edge: 256, recoveryEpoch: 1, reason: 'timeout', at: 11, authority: 'observed',
  })
  ledger.record({ type: 'fallbackFailed', recoveryAttemptId: 'rec-fail', at: 40, reason: 'decode', authority: 'observed' })
  const summary = ledger.summarize()
  assert.equal(summary.fallbacks.count, 1)
  assert.equal(summary.fallbacks.failed, 1)
  assert.equal(summary.fallbacks.inFlight, 0, 'no recovery is left dangling')
  assert.equal(summary.fallbacks.detail[0].terminal, 'failed')
  assert.equal(summary.fallbacks.detail[0].terminalReason, 'decode')
})

test('case 8b: a recovery with no outcome is reported as in-flight, not success', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  ledger.record(startEvent({ attemptId: 'a1', clientId: 'c1', sourceKey: source.sourceKey }))
  ledger.record({ type: 'pathFailed', attemptId: 'a1', kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, reason: 'decode', at: 10, authority: 'observed' })
  ledger.record({
    type: 'fallbackStarted', attemptId: 'a1', recoveryAttemptId: 'rec-open', parentAttemptId: 'a1',
    kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, edge: 256, recoveryEpoch: 1, at: 11, authority: 'observed',
  })
  const summary = ledger.summarize()
  assert.equal(summary.fallbacks.count, 1, 'the started recovery is counted')
  assert.equal(summary.fallbacks.completed, 0, 'but it is not counted as completed')
  assert.equal(summary.fallbacks.inFlight, 1)
})

// ---------------------------------------------------------------------------
// case 9: a retry on the same key is a new attempt, not merged
// ---------------------------------------------------------------------------

test('case 9: a retry with a new attemptId on the same key does not merge', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  ledger.record(startEvent({ attemptId: 'att-1', clientId: 'c1', sourceKey: source.sourceKey }))
  ledger.record({ type: 'pathFailed', attemptId: 'att-1', kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, reason: 'decode', at: 5, authority: 'observed' })
  ledger.record(startEvent({ attemptId: 'att-2', clientId: 'c1', sourceKey: source.sourceKey }))
  ledger.record({ type: 'pathReady', attemptId: 'att-2', kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, at: 15, authority: 'observed' })
  const summary = ledger.summarize()
  assert.equal(summary.attempts.total, 2, 'two attempts, one workload')
  assert.equal(summary.attempts.byTerminal.failed, 1)
  assert.equal(summary.attempts.byTerminal.ready, 1)
  assert.equal(summary.fallbacks.count, 0, 'a retry is not a recovery')
})

test('case 9b: the same workload key with different clients keeps both attempts', () => {
  const source = sourceIdentity(trackInput({ clientId: 'x', sourcePath: 'C:/M/a.flac' }), 'track')
  assert.equal(workloadKey({ kind: 'track', generation: 1, sourceKey: source.sourceKey, edge: 256 }),
    workloadKey({ kind: 'track', generation: 1, sourceKey: source.sourceKey, edge: 256 }),
    'workload key is stable for the same workload')
  const a = attemptIdentity({ lane: 'path', kind: 'track', clientId: 'owner-a', generation: 1, sourceKey: source.sourceKey, edge: 256 })
  const b = attemptIdentity({ lane: 'path', kind: 'track', clientId: 'owner-b', generation: 1, sourceKey: source.sourceKey, edge: 256 })
  assert.notEqual(a, b, 'attempt identity keeps owners apart')
})

// ---------------------------------------------------------------------------
// case 10: in-flight at window close is neither lost nor success
// ---------------------------------------------------------------------------

test('case 10: an attempt in flight at window close is kept and not counted as success', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  ledger.record(startEvent({ attemptId: 'att-open', clientId: 'c1', sourceKey: source.sourceKey, requestId: 'r-open' }))
  const summary = ledger.summarize()
  assert.equal(summary.attempts.total, 1, 'the in-flight attempt is not dropped')
  assert.equal(summary.attempts.inFlight, 1)
  assert.equal(summary.attempts.inFlightDetail[0].attemptId, 'att-open')
  assert.equal(summary.attempts.byTerminal.ready ?? 0, 0, 'in-flight is never ready')
  assert.equal(summary.attempts.byTerminal.missing ?? 0, 0)
  assert.equal(summary.attempts.byTerminal.failed ?? 0, 0)
})

test('case 10b: a CDP request still in flight is reported, not folded into ok or failed', () => {
  const requests = [
    ipcRequest({ command: TRACK_PATH, input: trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), status: null, finished: false, decodedBytes: 0 }),
    ipcRequest({ command: TRACK_PATH, input: trackInput({ clientId: 'c1', sourcePath: 'C:/M/b.flac' }) }),
  ]
  const summary = summarizeLaneAttempts(requests)
  const open = summary.laneAttempts.attempts.find(row => row.sourceAnonymous === fingerprint(
    sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track').sourceKey,
  ))
  assert.ok(open, 'the in-flight attempt is present')
  assert.equal(open.inFlight, 1)
  assert.equal(open.ok, 0, 'an unfinished request is not a success')
  assert.equal(open.errorStatuses, 0, 'and not a failure')
})

// ---------------------------------------------------------------------------
// native counts vs consumer counts, and no double counting
// ---------------------------------------------------------------------------

test('native command counts and consumer counts are reported separately', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  for (const attemptId of ['c1a', 'c1b']) {
    ledger.record(startEvent({ attemptId, clientId: 'c1', sourceKey: source.sourceKey, requestId: 'native-1' }))
  }
  const summary = ledger.summarize()
  assert.equal(summary.nativeRequests.distinct, 1)
  assert.equal(summary.nativeRequests.consumerCount, 2)
  assert.equal(summary.attempts.total, 2)
})

test('a repeated identical terminal event is not double counted', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  ledger.record(startEvent({ attemptId: 'a1', clientId: 'c1', sourceKey: source.sourceKey }))
  const first = ledger.record({ type: 'pathFailed', attemptId: 'a1', kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, reason: 'decode', at: 5, authority: 'observed' })
  const second = ledger.record({ type: 'pathFailed', attemptId: 'a1', kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, reason: 'decode', at: 6, authority: 'observed' })
  assert.equal(first.duplicate, false)
  assert.equal(second.duplicate, true)
  assert.equal(ledger.summarize().eventCounts.pathFailed, 1, 'the event stream has one failure')
})

test('an unknown event type is rejected rather than silently counted', () => {
  const ledger = new CoverAttemptLedger()
  const result = ledger.record({ type: 'pathExploded', attemptId: 'a1' })
  assert.equal(result.accepted, false)
  assert.equal(ledger.summarize().rejected.length, 1)
})

// ---------------------------------------------------------------------------
// defect C: both-lane coincidence is not the fallback truth
// ---------------------------------------------------------------------------

test('defect C: both lanes on one key is flagged as cross-check only, not as fallback', () => {
  const requests = [
    ipcRequest({ command: TRACK_PATH, input: trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), decodedBytes: 260 }),
    ipcRequest({ command: TRACK_PIXELS, input: trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), decodedBytes: 349580 }),
  ]
  const summary = summarizeLaneAttempts(requests)
  assert.equal(summary.crossCheckOnly, true)
  assert.ok(Array.isArray(summary.notAuthoritative) && summary.notAuthoritative.length >= 3,
    'the block states why it is not authoritative')
  assert.equal(summary.workloads.bothLaneWorkloads, 1)
  // There is deliberately no `fallbackCount` field here: that number now comes
  // only from the ledger, so nothing can quote this block as the truth.
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'fallbackCount'), false,
    'the cross-check must not expose a fallbackCount')
})

test('defect C: an empty ledger reports zero recoveries even when both lanes appear', () => {
  const ledger = new CoverAttemptLedger()
  const source = sourceIdentity(trackInput({ clientId: 'c1', sourcePath: 'C:/M/a.flac' }), 'track')
  // Both lanes observed, no failure and no recovery.
  ledger.record(startEvent({ attemptId: 'p', clientId: 'c1', sourceKey: source.sourceKey }))
  ledger.record({ type: 'pathMissing', attemptId: 'p', kind: 'track', clientId: 'c1', sourceKey: source.sourceKey, at: 3, authority: 'observed' })
  ledger.record(startEvent({ type: 'pixelsStart', attemptId: 'x', lane: 'pixels', clientId: 'c1', sourceKey: source.sourceKey }))
  const summary = ledger.summarize()
  assert.equal(summary.fallbacks.count, 0, 'a confirmed-absence verdict plus a pixels read is not a recovery')
  assert.equal(summary.attempts.byTerminal.missing, 1)
})

// ---------------------------------------------------------------------------
// byte accounting (plan §6)
// ---------------------------------------------------------------------------

test('byte summary separates payload, encoded length and request body', () => {
  const commands = [
    { command: TRACK_PIXELS, lane: 'pixels', kind: 'track', nativeRequests: 3, ok: 3, nonOkStatus: 0, failed: 0, canceled: 0, inFlightAtSnapshot: 0, decodedBytes: 786552, encodedBytes: 786996, requestBytes: 550, perRequestDecodedBytes: [262184, 262184, 262184] },
    { command: TRACK_PATH, lane: 'path', kind: 'track', nativeRequests: 4, ok: 2, nonOkStatus: 0, failed: 0, canceled: 0, inFlightAtSnapshot: 2, decodedBytes: 518, encodedBytes: 798, requestBytes: 744, perRequestDecodedBytes: [259, 259, 0, 0] },
  ]
  const summary = summarizeCommandBytes(commands)
  assert.equal(summary.perCommand[0].observedResponsePayloadBytes, 786552)
  assert.equal(summary.perCommand[0].encodedDataLengthBytes, 786996)
  assert.equal(summary.perCommand[0].meanObservedPayloadPerCompletedRequest, 262184)
  assert.deepEqual(summary.perCommand[0].perRequestObservedPayloadBytes, [262184, 262184, 262184])
  assert.equal(summary.perCommand[1].inFlight, 2)
  assert.match(summary.basis.observedResponsePayloadBytes, /NOT the full wire cost/)
  assert.match(summary.basis.assetReads, /never folded/)
})

test('byte comparability refuses a cross-lane ratio and says why', () => {
  const baseline = summarizeCommandBytes([
    { command: TRACK_PIXELS, lane: 'pixels', kind: 'track', nativeRequests: 3, ok: 3, nonOkStatus: 0, failed: 0, canceled: 0, inFlightAtSnapshot: 0, decodedBytes: 786552, encodedBytes: 786996, requestBytes: 550, perRequestDecodedBytes: [262184, 262184, 262184] },
  ])
  const candidate = summarizeCommandBytes([
    { command: TRACK_PATH, lane: 'path', kind: 'track', nativeRequests: 4, ok: 2, nonOkStatus: 0, failed: 0, canceled: 0, inFlightAtSnapshot: 2, decodedBytes: 518, encodedBytes: 798, requestBytes: 744, perRequestDecodedBytes: [259, 259, 0, 0] },
  ])
  const verdict = assessByteComparability({ baseline, candidate, cacheMode: 'fresh' })
  assert.equal(verdict.comparable, false)
  assert.equal(verdict.ratio, null, 'no ratio is produced for unmatched requests')
  assert.ok(verdict.reasons.some(reason => /completed request counts differ/.test(reason)))
  assert.ok(verdict.reasons.some(reason => /different lanes/.test(reason)))
  assert.match(verdict.verdict, /NOT comparable/)
})

test('byte comparability allows a ratio only for genuinely matched requests', () => {
  const build = (decoded, count) => summarizeCommandBytes([{
    command: TRACK_PATH, lane: 'path', kind: 'track',
    nativeRequests: count, ok: count, nonOkStatus: 0, failed: 0, canceled: 0, inFlightAtSnapshot: 0,
    decodedBytes: decoded, encodedBytes: decoded + 20, requestBytes: 100,
    perRequestDecodedBytes: new Array(count).fill(Math.round(decoded / count)),
  }])
  const verdict = assessByteComparability({
    baseline: build(4000, 4),
    candidate: build(2000, 4),
    cacheMode: 'fresh',
  })
  assert.equal(verdict.comparable, true)
  assert.ok(verdict.ratio.perRequest > 1.9 && verdict.ratio.perRequest < 2.1)
  assert.match(verdict.verdict, /matched/)
})

// ---------------------------------------------------------------------------
// source normalization is unchanged (plan: do not invent new case semantics)
// ---------------------------------------------------------------------------

test('normalization keeps existing behaviour: extended prefix stripped, separators unified, lowercased', () => {
  assert.equal(normalizeSource('\\\\?\\E:\\Music\\A.flac'), 'e:\\music\\a.flac')
  assert.equal(normalizeSource('C:/Music/Album/x.jpg'), 'c:\\music\\album\\x.jpg')
  assert.equal(normalizeSource(null), null)
  assert.equal(normalizeSource(''), null)
})

test('command classification covers both lanes and all three artifacts', () => {
  assert.equal(laneOfCommand(TRACK_PATH), 'path')
  assert.equal(laneOfCommand(TRACK_PIXELS), 'pixels')
  assert.equal(kindOfCommand(TRACK_PATH), 'track')
  assert.equal(kindOfCommand(FOLDER_PATH), 'folder')
  assert.equal(kindOfCommand(COVER_PATH), 'cover')
  assert.equal(kindOfCommand(COVER_PIXELS), 'cover')
})
