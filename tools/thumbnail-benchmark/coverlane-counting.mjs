// Corrected counting model for the coverlane harness.
//
// This module exists because the first version of `laneAttemptSummary` had three
// defects that the correction plan §6 names explicitly. All three are fixed here,
// and this file is the single place the fixes live so the tests can drive them
// without a browser.
//
// ## Defect A (fixed): the source bucket ignored `clientId`
//
// The old bucket key was `[kind, generation, source, maxEdge]`. Two different
// owners that each ran only their own lane (owner 1 → path only, owner 2 → pixels
// only) collapsed into one bucket that showed both lanes, and was reported as one
// fallback that never happened.
//
// ## Defect B (fixed): folder commands produced `null`, so their requests vanished
//
// The old source extraction was `input.sourcePath ?? input.filePath`. A folder
// command carries `rootPath` and `directoryPath`, so every folder request was
// dropped by `if (!source) continue` and a folder path→pixels fallback counted 0.
//
// ## Defect C (fixed): fallback was *inferred* from key coincidence
//
// "Both lanes appeared for one key" is not proof of a fallback. A first-touch
// fallback, a recovery job, a retry, or two independent owners can all produce
// both lanes without a single recovery. Fallback is now counted from an explicit
// attempt/outcome ledger that the scheduling boundary reports directly:
//
//   pathStart, pathReady, pathMissing, pathFailed,
//   fallbackStarted, fallbackCompleted, fallbackFailed,
//   DOMFailure, stale, abort, breaker
//
// The CDP command stream stays available, but only as a CROSS-CHECK, and the
// summary says so in its own fields.

/**
 * Normalize one source path for identity comparison.
 *
 * This is the harness's pre-existing normalization: strip the Windows extended
 * path prefix, collapse separators, lower-case. The correction plan asks to keep
 * using the existing normalization rather than inventing new case semantics, so
 * this function is moved here unchanged from coverlane-common.mjs.
 */
export function normalizeSource(source) {
  if (typeof source !== 'string' || !source) return null
  return source.replace(/^\\\\\?\\/, '').replace(/\//g, '\\').toLowerCase()
}

/** `audio_load_track_thumbnail_path` -> `path`; `audio_load_track_thumbnail` -> `pixels`. */
export function laneOfCommand(command) {
  if (!command) return 'unknown'
  if (/_path$/.test(command)) return 'path'
  if (/cover_pixels|_thumbnail$/.test(command)) return 'pixels'
  return 'other'
}

/** Which artifact a command concerns: `cover`, `folder`, or `track`. */
export function kindOfCommand(command) {
  if (!command) return null
  if (/playlist_cover/.test(command)) return 'cover'
  if (/_folder_thumbnail/.test(command)) return 'folder'
  if (/_track_thumbnail/.test(command) || /load_cover_pixels/.test(command)) return 'track'
  return null
}

/**
 * Build the identity key of one attempt from a parsed IPC request body.
 *
 * Fix for defect B: each artifact kind reads the fields it actually carries:
 *   * `folder` → `rootPath` + `directoryPath`
 *   * `track`  → `sourcePath`
 *   * `cover`  → `filePath`
 *
 * Returns `null` only when the command carried no usable source at all, and the
 * caller records that as an explicit unmatched request instead of silently
 * skipping it (which is what defect B did).
 */
export function sourceIdentity(input, kind) {
  if (!input || typeof input !== 'object') return null
  if (kind === 'folder') {
    const root = normalizeSource(input.rootPath ?? null)
    const directory = normalizeSource(input.directoryPath ?? null)
    // A folder request without both halves cannot be identified; report it.
    if (!root || !directory) return { kind, sourceKey: null, missing: !root ? 'rootPath' : 'directoryPath' }
    return {
      kind,
      sourceKey: `folder\u0000${root}\u0000${directory}`,
      rootPath: root,
      directoryPath: directory,
    }
  }
  if (kind === 'cover') {
    const file = normalizeSource(input.filePath ?? null)
    if (!file) return { kind, sourceKey: null, missing: 'filePath' }
    return { kind, sourceKey: `cover\u0000${file}`, filePath: file }
  }
  if (kind === 'track') {
    const source = normalizeSource(input.sourcePath ?? null)
    if (!source) return { kind, sourceKey: null, missing: 'sourcePath' }
    return { kind, sourceKey: `track\u0000${source}`, sourcePath: source }
  }
  return { kind, sourceKey: null, missing: 'unknownKind' }
}

/**
 * The identity of one *attempt*: lane + artifact + owner + generation + source + edge.
 *
 * Fix for defect A: `clientId` is part of the attempt identity, so two owners that
 * independently use two lanes stay two attempts.
 */
export function attemptIdentity({ lane, kind, clientId, generation, sourceKey, edge }) {
  return [lane, kind, clientId ?? '-', generation ?? '-', sourceKey ?? '-', edge ?? '-'].join('\u0001')
}

/**
 * The identity used to decide "these two requests are about the same workload".
 *
 * Deliberately EXCLUDES `clientId`: the question "did this artifact fall back"
 * is about the workload, and the plan requires folder to be keyed by
 * root+directory and other kinds by their own source field. Owners are counted
 * separately in `attempts`, which is where per-client isolation belongs.
 */
export function workloadKey({ kind, generation, sourceKey, edge }) {
  return [kind, generation ?? '-', sourceKey ?? '-', edge ?? '-'].join('\u0001')
}

// ---------------------------------------------------------------------------
// Attempt / outcome ledger
// ---------------------------------------------------------------------------

export const EVENT_TYPES = Object.freeze([
  'pathStart', 'pathReady', 'pathMissing', 'pathFailed',
  'pixelsStart',
  'fallbackStarted', 'fallbackCompleted', 'fallbackFailed',
  'DOMFailure', 'stale', 'abort', 'breaker',
])

/** Reasons that are a controlled cancellation, never a channel failure. */
export const NON_FAILURE_REASONS = Object.freeze(['stale', 'abort', 'superseded', 'canceled'])

/** Terminal states one attempt may reach. */
export const TERMINAL_STATES = Object.freeze([
  'ready', 'missing', 'failed', 'dropped', 'in-flight',
])

function isNonFailureReason(reason) {
  return typeof reason === 'string' && NON_FAILURE_REASONS.includes(reason)
}

/** Exposed for the counting tests: a cancellation must never count as failure. */
export { isNonFailureReason }

/**
 * Records the scheduling-boundary events of one measurement window and derives
 * fallback / failure facts from them.
 *
 * Design rules taken from the plan:
 *   * every event carries the owner and attempt coordinates, so a shared native
 *     request and its several consumers are separable;
 *   * a recovery job has its own `recoveryAttemptId` pointing at a
 *     `parentAttemptId`, so "one recovery" is countable even when one parent had
 *     several consumers;
 *   * a shared native request has a `requestId`, counted once no matter how many
 *     consumers awaited it;
 *   * `stale` / `abort` are cancellations, not failures, and never open a fallback;
 *   * an attempt with no terminal event is `in-flight` — never silently dropped,
 *     and never counted as success.
 */
export class CoverAttemptLedger {
  constructor({ ownerSession = null, labelless = false } = {}) {
    this.ownerSession = ownerSession
    this.labelless = labelless
    this.events = []
    this.rejected = []
    this.attempts = new Map()
    this.nativeRequests = new Map()
    this.recoveries = new Map()
    this.domFailures = []
    this.breakers = []
    this.cancellations = []
  }

  #attemptRecord({ attemptId, lane, kind, clientId, generation, sourceKey, edge, recoveryEpoch, requestId }) {
    const existing = this.attempts.get(attemptId)
    if (existing) {
      if (requestId !== undefined && existing.requestIds === undefined) existing.requestIds = new Set()
      if (requestId !== undefined) existing.requestIds.add(requestId)
      return existing
    }
    const record = {
      attemptId,
      lane,
      kind,
      clientId: clientId ?? null,
      generation: generation ?? null,
      sourceKey: sourceKey ?? null,
      edge: edge ?? null,
      recoveryEpoch: recoveryEpoch ?? null,
      startedAt: null,
      terminal: 'in-flight',
      terminalReason: null,
      requestIds: new Set(requestId !== undefined && requestId !== null ? [requestId] : []),
    }
    this.attempts.set(attemptId, record)
    return record
  }

  /**
   * Record one event. Returns `{accepted, duplicate, rejected}` so a caller can
   * see whether the ledger double-counted.
   *
   * A repeated terminal event for the same attempt with the same state and reason
   * is a duplicate (several DOM consumers can report the same failure). A *new*
   * attempt with the same workload key is never a duplicate.
   */
  record(event) {
    const type = event?.type
    if (!EVENT_TYPES.includes(type)) {
      this.rejected.push({ reason: `unknown event type: ${String(type)}`, event })
      return { accepted: false, duplicate: false, rejected: 'unknown-type' }
    }
    // Recovery outcomes are scoped to a recovery job, not to a consumer attempt:
    // `fallbackCompleted` / `fallbackFailed` identify themselves with
    // `recoveryAttemptId`. Requiring `attemptId` on them (as the first version did)
    // silently rejected every recovery outcome and left every recovery "in-flight".
    const recoveryScoped = type === 'fallbackStarted' || type === 'fallbackCompleted' || type === 'fallbackFailed'
    if (recoveryScoped) {
      if (!event.recoveryAttemptId) {
        this.rejected.push({ reason: `${type} has no recoveryAttemptId`, event })
        return { accepted: false, duplicate: false, rejected: 'no-recovery-id' }
      }
    } else if (!event.attemptId) {
      this.rejected.push({ reason: 'event has no attemptId', event })
      return { accepted: false, duplicate: false, rejected: 'no-attempt-id' }
    }

    const attribute = event.authority ?? 'derived'
    if (attribute !== 'observed' && attribute !== 'derived') {
      this.rejected.push({ reason: `unknown authority: ${attribute}`, event })
      return { accepted: false, duplicate: false, rejected: 'bad-authority' }
    }

    // Duplicate detection is per (event type, attempt, recovery job, terminal
    // state, reason). It must NOT collapse two DIFFERENT event types that happen
    // to share a reason: a `pathFailed{reason:decode}` and a
    // `fallbackStarted{reason:decode}` are distinct facts about one attempt, and
    // an earlier signature that ignored both `type` ordering and the recovery id
    // silently swallowed the recovery.
    const signature = [
      type,
      event.attemptId ?? '',
      event.recoveryAttemptId ?? '',
      event.publishGeneration ?? '',
      event.terminalState ?? '',
      event.reason ?? '',
    ].join('\u0001')
    if (this.#seen.has(signature)) {
      return { accepted: false, duplicate: true, rejected: null }
    }
    this.#seen.add(signature)

    const stored = {
      ...event,
      authority: attribute,
      index: this.events.length,
      ownerSession: event.ownerSession ?? this.ownerSession,
    }
    this.events.push(stored)

    if (stored.requestId !== undefined && stored.requestId !== null) {
      const entry = this.nativeRequests.get(stored.requestId) || { requestId: stored.requestId, consumers: new Set(), command: stored.command ?? null }
      entry.consumers.add(event.attemptId)
      this.nativeRequests.set(stored.requestId, entry)
    }

    if (type === 'pathStart' || type === 'pixelsStart') {
      const record = this.#attemptRecord({
        attemptId: event.attemptId,
        lane: type === 'pathStart' ? 'path' : 'pixels',
        kind: event.kind ?? null,
        clientId: event.clientId,
        generation: event.generation,
        sourceKey: event.sourceKey,
        edge: event.edge,
        recoveryEpoch: event.recoveryEpoch,
        requestId: event.requestId,
      })
      record.startedAt = event.at ?? null
      return { accepted: true, duplicate: false, rejected: null }
    }

    if (type === 'pathReady' || type === 'pathMissing' || type === 'pathFailed') {
      const record = this.#attemptRecord({
        attemptId: event.attemptId,
        lane: 'path',
        kind: event.kind ?? null,
        clientId: event.clientId,
        generation: event.generation,
        sourceKey: event.sourceKey,
        edge: event.edge,
        recoveryEpoch: event.recoveryEpoch,
        requestId: event.requestId,
      })
      record.terminal = type === 'pathReady' ? 'ready' : type === 'pathMissing' ? 'missing' : 'failed'
      record.terminalReason = event.reason ?? null
      return { accepted: true, duplicate: false, rejected: null }
    }

    if (type === 'fallbackStarted') {
      // A recovery job is its own attempt with a pointer to the attempt it repairs.
      const recoveryAttemptId = event.recoveryAttemptId ?? event.attemptId
      if (!this.recoveries.has(recoveryAttemptId)) {
        this.recoveries.set(recoveryAttemptId, {
          recoveryAttemptId,
          parentAttemptId: event.parentAttemptId ?? null,
          kind: event.kind ?? null,
          clientId: event.clientId ?? null,
          generation: event.generation ?? null,
          sourceKey: event.sourceKey ?? null,
          edge: event.edge ?? null,
          recoveryEpoch: event.recoveryEpoch ?? null,
          reason: event.reason ?? null,
          startedAt: event.at ?? null,
          completedAt: null,
          terminal: 'in-flight',
          terminalReason: null,
          requestIds: new Set(),
        })
      }
      const recovery = this.recoveries.get(recoveryAttemptId)
      if (event.requestId !== undefined && event.requestId !== null) recovery.requestIds.add(event.requestId)
      return { accepted: true, duplicate: false, rejected: null }
    }

    if (type === 'fallbackCompleted' || type === 'fallbackFailed') {
      const recoveryAttemptId = event.recoveryAttemptId ?? event.attemptId
      const recovery = this.recoveries.get(recoveryAttemptId)
      if (!recovery) {
        // A completion with no recorded start is a real anomaly, not something to
        // paper over: it means the window opened mid-recovery.
        this.rejected.push({ reason: 'fallback outcome without fallbackStarted', event })
        return { accepted: true, duplicate: false, rejected: 'orphan-fallback-outcome' }
      }
      recovery.terminal = type === 'fallbackCompleted' ? 'settled' : 'failed'
      recovery.terminalReason = event.reason ?? null
      recovery.completedAt = event.at ?? null
      if (event.requestId !== undefined && event.requestId !== null) recovery.requestIds.add(event.requestId)
      return { accepted: true, duplicate: false, rejected: null }
    }

    if (type === 'DOMFailure') {
      this.domFailures.push({
        attemptId: event.attemptId,
        publishGeneration: event.publishGeneration ?? null,
        recoveryEpoch: event.recoveryEpoch ?? null,
        at: event.at ?? null,
        reason: event.reason ?? null,
        authority: attribute,
      })
      return { accepted: true, duplicate: false, rejected: null }
    }

    if (type === 'breaker') {
      this.breakers.push({
        attemptId: event.attemptId,
        consecutiveFailures: event.consecutiveFailures ?? null,
        at: event.at ?? null,
        reason: event.reason ?? null,
        authority: attribute,
      })
      return { accepted: true, duplicate: false, rejected: null }
    }

    // stale / abort
    this.cancellations.push({
      attemptId: event.attemptId,
      kind: event.kind ?? null,
      lane: event.lane ?? null,
      reason: type,
      at: event.at ?? null,
      authority: attribute,
    })
    const record = this.attempts.get(event.attemptId)
    if (record) {
      record.terminal = 'dropped'
      record.terminalReason = type
    }
    return { accepted: true, duplicate: false, rejected: null }
  }

  #seen = new Set()

  /**
   * Derive the countable facts.
   *
   * `fallbackCount` is the number of distinct recovery jobs, deduped by
   * `recoveryAttemptId`. That is the only quantity called a fallback; both-lanes
   * key coincidence is deliberately NOT used.
   */
  summarize() {
    const attempts = [...this.attempts.values()]
    const recoveries = [...this.recoveries.values()]

    const byTerminal = {}
    for (const attempt of attempts) byTerminal[attempt.terminal] = (byTerminal[attempt.terminal] ?? 0) + 1

    const inFlight = attempts.filter(attempt => attempt.terminal === 'in-flight')
    const cancellations = attempts.filter(attempt => attempt.terminal === 'dropped')

    // A cancellation must never be reported as a failure, and a cancellation must
    // never open a recovery. Both are asserted in the summary so a regression is
    // visible rather than merely absent.
    const fallbacksFromCancellation = recoveries.filter(recovery => {
      const parent = recovery.parentAttemptId ? this.attempts.get(recovery.parentAttemptId) : null
      return parent ? parent.terminal === 'dropped' : false
    })

    const terminalRecoveries = recoveries.filter(recovery => recovery.terminal !== 'in-flight')
    const pendingRecoveries = recoveries.filter(recovery => recovery.terminal === 'in-flight')

    // Consumers versus native requests: a shared request serves many consumers.
    const nativeRequests = [...this.nativeRequests.values()]
    const sharedRequests = nativeRequests.filter(entry => entry.consumers.size > 1)

    return {
      basis: {
        fallbackTruth:
          'counted from explicit fallbackStarted/Completed/Failed events at the scheduling boundary; ' +
          'NOT from "both lanes appeared for one key"',
        fallbackUnit: 'one distinct recoveryAttemptId, deduped even when several consumers awaited it',
        nativeRequestUnit: 'one distinct requestId, so a shared request is counted once',
        consumerUnit: 'one distinct attemptId',
        cancellations:
          'stale/abort/superseded are dropped attempts: never a failure, never a fallback',
        inFlight:
          'an attempt with no terminal event is in-flight; it is neither success nor failure',
      },
      eventCounts: countBy(this.events.map(event => event.type)),
      eventAuthority: countBy(this.events.map(event => event.authority)),
      attempts: {
        total: attempts.length,
        byLane: countBy(attempts.map(attempt => attempt.lane)),
        byKind: countBy(attempts.map(attempt => attempt.kind)),
        byTerminal,
        inFlight: inFlight.length,
        inFlightDetail: inFlight.map(attempt => ({
          attemptId: attempt.attemptId, lane: attempt.lane, kind: attempt.kind,
          clientId: attempt.clientId, terminal: attempt.terminal,
        })),
        cancelled: cancellations.length,
      },
      nativeRequests: {
        distinct: this.nativeRequests.size,
        shared: sharedRequests.length,
        consumerCount: this.nativeRequests.size === 0
          ? 0
          : nativeRequests.reduce((total, entry) => total + entry.consumers.size, 0),
        sharedDetail: sharedRequests.map(entry => ({
          requestId: entry.requestId, consumers: entry.consumers.size, command: entry.command,
        })),
      },
      /** The answer to "did anything fall back", from explicit events only. */
      fallbacks: {
        started: recoveries.length,
        completed: recoveries.filter(recovery => recovery.terminal === 'settled').length,
        failed: recoveries.filter(recovery => recovery.terminal === 'failed').length,
        inFlight: pendingRecoveries.length,
        /** The one number to quote as "fallback count". */
        count: recoveries.length,
        fromCancellation: fallbacksFromCancellation.length,
        detail: recoveries.map(recovery => ({
          recoveryAttemptId: recovery.recoveryAttemptId,
          parentAttemptId: recovery.parentAttemptId,
          kind: recovery.kind,
          clientId: recovery.clientId,
          edge: recovery.edge,
          recoveryEpoch: recovery.recoveryEpoch,
          reason: recovery.reason,
          terminal: recovery.terminal,
          terminalReason: recovery.terminalReason,
          requestIds: [...recovery.requestIds],
        })),
      },
      /** The answer to "did any DOM image fail", from recorded events only. */
      domFailure: {
        count: this.domFailures.length,
        attempts: new Set(this.domFailures.map(failure => failure.attemptId)).size,
        detail: this.domFailures,
      },
      cancel: {
        count: this.cancellations.length,
        byReason: countBy(this.cancellations.map(cancellation => cancellation.reason)),
        detail: this.cancellations,
      },
      breaker: {
        count: this.breakers.length,
        detail: this.breakers,
      },
      rejected: this.rejected,
      terminalRecoveryCount: terminalRecoveries.length,
    }
  }
}

function countBy(values) {
  const out = {}
  for (const value of values) {
    const key = value === null || value === undefined ? 'none' : String(value)
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

// ---------------------------------------------------------------------------
// CDP cross-check (never the fallback truth)
// ---------------------------------------------------------------------------

/**
 * Group IPC requests into attempts and workloads for CROSS-CHECKING only.
 *
 * The returned `crossCheck` block is explicitly labelled: it can confirm that the
 * ledger's counts are plausible, and it can flag a workload that used both lanes,
 * but it cannot itself establish that a recovery happened. Defects A and B are
 * fixed here too, so the cross-check at least keys folder correctly and keeps
 * clients apart.
 */
export function summarizeLaneAttempts(ipcRequests) {
  const attempts = new Map()
  const workloads = new Map()
  const unmatched = []

  for (const record of ipcRequests) {
    const lane = laneOfCommand(record.command)
    const kind = kindOfCommand(record.command)
    if (!kind || (lane !== 'path' && lane !== 'pixels')) {
      unmatched.push({ command: record.command, reason: 'not a cover-lane command', decodedBytes: record.decodedBytes })
      continue
    }
    let body
    try { body = record.postData ? JSON.parse(record.postData) : null } catch { body = null }
    const input = body && body.input ? body.input : {}
    const identity = sourceIdentity(input, kind)
    if (!identity || !identity.sourceKey) {
      // Fix for defect B: a request with no usable source is REPORTED, not skipped.
      unmatched.push({
        command: record.command,
        reason: `missing ${identity ? identity.missing : 'input'}`,
        decodedBytes: record.decodedBytes,
      })
      continue
    }
    const clientId = typeof input.clientId === 'string' ? input.clientId : null
    const generation = Number.isInteger(input.windowGeneration) ? input.windowGeneration : null
    const edge = Number.isInteger(input.maxEdge) ? input.maxEdge : null

    const attemptKey = attemptIdentity({ lane, kind, clientId, generation, sourceKey: identity.sourceKey, edge })
    const attempt = attempts.get(attemptKey) || {
      lane, kind, clientId, generation, edge,
      sourceKey: identity.sourceKey,
      nativeRequests: 0, ok: 0, missingResponses: 0, errorStatuses: 0, inFlight: 0,
      decodedBytes: 0, encodedBytes: 0, requestBytes: 0, durationsMs: [],
      perRequestDecodedBytes: [],
    }
    attempt.nativeRequests += 1
    if (record.status === 200) attempt.ok += 1
    else if (record.status !== null) attempt.errorStatuses += 1
    else attempt.inFlight += 1
    if (record.status === 200 && record.decodedBytes > 0 && record.decodedBytes <= 8) attempt.missingResponses += 1
    attempt.decodedBytes += record.decodedBytes
    attempt.encodedBytes += record.encodedBytes
    attempt.requestBytes += record.requestBytes ?? 0
    attempt.perRequestDecodedBytes.push(record.decodedBytes)
    if (record.finishedAtMs !== null) attempt.durationsMs.push(record.finishedAtMs - record.startedAtMs)
    attempts.set(attemptKey, attempt)

    // Fix for defect A: the workload key keeps clients apart by construction,
    // because each entry below is written per attempt (which includes clientId).
    const workload = workloadKey({ kind, generation, sourceKey: identity.sourceKey, edge })
    const bucket = workloads.get(workload) || {
      kind, generation, edge, sourceKey: identity.sourceKey,
      lanes: { path: 0, pixels: 0 }, clients: new Set(),
    }
    bucket.lanes[lane] += 1
    bucket.clients.add(clientId ?? '-')
    workloads.set(workload, bucket)
  }

  const workloadRows = [...workloads.values()]
  const bothLane = workloadRows.filter(row => row.lanes.path > 0 && row.lanes.pixels > 0)
  // A both-lane workload where every client used only ONE lane is the exact shape
  // of defect A: it looks like a fallback but no single owner recovered.
  const bothLaneAcrossClientsOnly = bothLane.filter(row => {
    const perClient = new Map()
    for (const attempt of attempts.values()) {
      if (attempt.sourceKey !== row.sourceKey) continue
      if (attempt.kind !== row.kind) continue
      if (attempt.generation !== row.generation) continue
      if (attempt.edge !== row.edge) continue
      const entry = perClient.get(attempt.clientId ?? '-') || { path: 0, pixels: 0 }
      entry[attempt.lane] += 1
      perClient.set(attempt.clientId ?? '-', entry)
    }
    return [...perClient.values()].every(entry => entry.path === 0 || entry.pixels === 0)
  })

  return {
    crossCheckOnly: true,
    notAuthoritative: [
      'This block is derived from CDP IPC/asset commands. It is a CROSS-CHECK, not the fallback truth.',
      'A workload that appears through both lanes does NOT prove a recovery happened: a first-touch',
      'fallback, a recovery job, a retry, or two independent owners all produce that shape.',
      'The authoritative fallback count is ledger.fallbacks.count, built from explicit scheduling-',
      'boundary events.',
    ],
    laneAttempts: {
      distinctAttempts: attempts.size,
      byLane: countBy([...attempts.values()].map(row => row.lane)),
      byKind: countBy([...attempts.values()].map(row => row.kind)),
      byClient: countBy([...attempts.values()].map(row => row.clientId ?? 'none')),
      attempts: [...attempts.values()].map(row => ({
        lane: row.lane, kind: row.kind, clientId: row.clientId, generation: row.generation,
        edge: row.edge, sourceAnonymous: fingerprint(row.sourceKey),
        nativeRequests: row.nativeRequests, ok: row.ok, missingResponses: row.missingResponses,
        errorStatuses: row.errorStatuses, inFlight: row.inFlight,
        decodedBytes: row.decodedBytes, encodedBytes: row.encodedBytes, requestBytes: row.requestBytes,
      })),
    },
    workloads: {
      distinct: workloadRows.length,
      /** Diagnostic only: both lanes appeared for one workload. NOT a fallback count. */
      bothLaneWorkloads: bothLane.length,
      /** The defect-A shape: both lanes, but no single client used both. */
      bothLaneAcrossClientsOnly: bothLaneAcrossClientsOnly.length,
      detail: bothLane.map(row => ({
        kind: row.kind, generation: row.generation, edge: row.edge,
        sourceAnonymous: fingerprint(row.sourceKey),
        pathAttempts: row.lanes.path, pixelAttempts: row.lanes.pixels,
        clientCount: row.clients.size,
      })),
    },
    unmatched: {
      count: unmatched.length,
      decodedBytes: unmatched.reduce((total, row) => total + (row.decodedBytes ?? 0), 0),
      detail: unmatched.slice(0, 50),
    },
  }
}

/**
 * Stable short fingerprint of a normalized source key.
 *
 * Uses a small pure-JS FNV-1a so this module stays dependency-free for `--test`
 * (no `node:crypto` import needed, and no absolute music path leaks into output).
 */
export function fingerprint(value) {
  if (typeof value !== 'string' || !value) return null
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// Byte accounting (plan §6: no cross-lane ratio without matched requests)
// ---------------------------------------------------------------------------

/**
 * Per-command byte detail, deliberately NOT reduced to one ratio.
 *
 * The plan requires, per command: request count, completed count, in-flight count,
 * match coverage, unmatched reasons/bytes, per-request lengths and set totals; and
 * it requires that `Network.dataReceived` be called the *observed response
 * payload* rather than full wire cost.
 */
export function summarizeCommandBytes(ipcByCommand) {
  const rows = ipcByCommand.map(command => {
    const perRequest = Array.isArray(command.perRequestDecodedBytes)
      ? command.perRequestDecodedBytes
      : null
    return {
      command: command.command,
      lane: command.lane,
      kind: command.kind,
      nativeRequests: command.nativeRequests,
      completed: command.ok,
      nonOkStatus: command.nonOkStatus,
      failed: command.failed,
      canceled: command.canceled,
      inFlight: command.inFlightAtSnapshot ?? null,
      observedResponsePayloadBytes: command.decodedBytes,
      encodedDataLengthBytes: command.encodedBytes,
      requestBodyBytes: command.requestBytes,
      meanObservedPayloadPerCompletedRequest: command.ok > 0
        ? Math.round(command.decodedBytes / command.ok) : null,
      perRequestObservedPayloadBytes: perRequest,
    }
  })
  const totals = {
    nativeRequests: rows.reduce((total, row) => total + row.nativeRequests, 0),
    completed: rows.reduce((total, row) => total + row.completed, 0),
    inFlight: rows.reduce((total, row) => total + (row.inFlight ?? 0), 0),
    observedResponsePayloadBytes: rows.reduce((total, row) => total + row.observedResponsePayloadBytes, 0),
    encodedDataLengthBytes: rows.reduce((total, row) => total + row.encodedDataLengthBytes, 0),
    requestBodyBytes: rows.reduce((total, row) => total + row.requestBodyBytes, 0),
  }
  return {
    basis: {
      observedResponsePayloadBytes:
        'sum of Network.dataReceived.dataLength. This is the decoded response payload observed ' +
        'by CDP. It is NOT the full wire cost and NOT a proof of every byte transferred.',
      encodedDataLengthBytes:
        'sum of Network.loadingFinished.encodedDataLength. Reported separately because it includes ' +
        'framing the protocol layer added, which the harness has not proven.',
      requestBodyBytes: 'UTF-8 byte length of the serialized JSON request body.',
      assetReads: 'asset JPEG reads are reported in the asset block, never folded into IPC bytes.',
      excluded: 'No fixed per-request estimate is used anywhere.',
    },
    perCommand: rows,
    totals,
  }
}

/**
 * Decide whether a baseline-vs-candidate byte comparison is even meaningful.
 *
 * The correction plan is explicit: 786,552 B against 518 B may not be described as
 * "about 1500x per cover" when the two figures come from different request counts,
 * different payload kinds, or unmatched cache states. This function refuses to
 * produce a ratio unless the requests are genuinely matched.
 */
export function assessByteComparability({ baseline, candidate, cacheMode }) {
  const reasons = []
  const baselineCommands = baseline.perCommand ?? []
  const candidateCommands = candidate.perCommand ?? []

  const baselinePayload = baselineCommands.reduce((total, row) => total + row.observedResponsePayloadBytes, 0)
  const candidatePayload = candidateCommands.reduce((total, row) => total + row.observedResponsePayloadBytes, 0)
  const baselineCompleted = baselineCommands.reduce((total, row) => total + row.completed, 0)
  const candidateCompleted = candidateCommands.reduce((total, row) => total + row.completed, 0)

  const kinds = new Set([...baselineCommands, ...candidateCommands]
    .map(row => row.kind).filter(Boolean))
  const lanes = new Set([...baselineCommands, ...candidateCommands]
    .map(row => row.lane).filter(lane => lane === 'path' || lane === 'pixels'))

  if (baselineCompleted !== candidateCompleted) {
    reasons.push(
      `completed request counts differ (${baselineCompleted} vs ${candidateCompleted}), so a per-request ` +
      'quotient is not a like-for-like comparison',
    )
  }
  if (lanes.size > 1) {
    reasons.push(
      `the two arms read through different lanes (${[...lanes].join(' vs ')}), which by construction ` +
      'return different payload kinds (image pixels versus a path reference); the byte figures are ' +
      'not the same unit and their ratio is not a per-cover speed or cost ratio',
    )
  }
  if (kinds.size > 1) {
    reasons.push(`artifact kinds differ (${[...kinds].join(', ')}), so the requests are not the same workload`)
  }
  if (cacheMode && !['fresh', 'warm'].includes(cacheMode)) {
    reasons.push(`cache state "${cacheMode}" is not a matched pair`)
  }

  const comparable = reasons.length === 0
  return {
    comparable,
    cacheMode,
    reasons,
    figures: {
      baseline: {
        commands: baselineCommands.map(row => row.command),
        nativeRequests: baseline.totals?.nativeRequests ?? null,
        completed: baselineCompleted,
        observedResponsePayloadBytes: baselinePayload,
      },
      candidate: {
        commands: candidateCommands.map(row => row.command),
        nativeRequests: candidate.totals?.nativeRequests ?? null,
        completed: candidateCompleted,
        observedResponsePayloadBytes: candidatePayload,
      },
    },
    ratio: comparable && candidateCompleted > 0 && candidatePayload > 0
      ? {
        perRequest: (baselinePayload / baselineCompleted) / (candidatePayload / candidateCompleted),
        onTotals: baselinePayload / candidatePayload,
      }
      : null,
    verdict: comparable
      ? 'The requests are matched; a ratio may be quoted with its basis stated.'
      : 'NOT comparable. Report the two payload totals separately and do not claim a multiplier. ' +
        'Sample is insufficient to support a ratio conclusion.',
  }
}
