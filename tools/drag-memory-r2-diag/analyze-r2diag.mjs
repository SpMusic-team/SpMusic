// R2 A-route diagnostic analyser.
//
// Reads the r2diag records one diagnostic run produced and answers the THREE questions
// R2 section 3 says must be answered on A before any of B/C/D is implemented. It never
// re-measures; it only aggregates what the read-only probe observed.
//
// Decision thresholds are frozen HERE, before the numbers are looked at, so the gate
// cannot be re-fitted to whatever the run happened to produce. Each one is stated with
// the reason it is the threshold.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const STAGES = ['G', 'H']

// --- frozen gates -------------------------------------------------------
// B: does an off-screen mounted cover population exist at all? R2 asks for "obvious"
// volume before a B package is built. A picture that is mounted but outside the viewport
// costs nothing we can measure unless it is decoded, so the gate is on DECODED off-screen
// source area, not on element count.
const B_MIN_OFFSCREEN_DECODED_IMAGES = 8        // fewer than this cannot explain 200 MB
const B_MIN_OFFSCREEN_SOURCE_MB = 8             // 8 MiB of decoded source is the floor worth chasing
// C: if in-flight predecodes never exceed the ordinary lane width, a separate semaphore
// has nothing to constrain. R2 says "if in flight is few or very short lived, jump to D".
const C_MIN_INFLIGHT_PEAK = 6                   // above the default lane width of 4
const C_MIN_P95_DURATION_MS = 80                // shorter than a frame at 12 fps: no room to throttle
// D: duplicate suppression only pays when the same identity really does overlap.
const D_MIN_OVERLAP_RATIO = 0.02                // 2% of predecodes duplicating a running one

function loadStage(root, stage) {
  const dir = join(root, stage)
  const diagPath = join(dir, 'r2diag.json')
  const rowsPath = join(dir, 'r2diag-rows.json')
  const recPath = join(dir, stage + '.json')
  if (!existsSync(diagPath)) return { stage, missing: diagPath }
  const diag = JSON.parse(readFileSync(diagPath, 'utf8'))
  const rows = existsSync(rowsPath) ? JSON.parse(readFileSync(rowsPath, 'utf8')) : (diag.rows || [])
  let record = null
  if (existsSync(recPath)) { try { record = JSON.parse(readFileSync(recPath, 'utf8')) } catch { record = null } }
  return { stage, diag, rows, record }
}

function quantile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}

function summarizeMounts(samples) {
  const clean = samples.filter(sample => sample && typeof sample.offscreen === 'number')
  if (clean.length === 0) return null
  const offscreen = clean.map(s => s.offscreenDecoded ?? s.offscreen ?? 0)
  const offArea = clean.map(s => s.offscreenAreaPx || 0)
  const on = clean.map(s => s.onscreen || 0)
  const urls = clean.map(s => s.uniqueUrls || 0)
  const dupEl = clean.map(s => s.duplicateElements || 0)
  const cards = clean.map(s => s.cards || 0)
  const withImg = clean.map(s => s.withImage || 0)
  const nearest = clean.map(s => s.nearestOffscreenDistancePx).filter(v => typeof v === 'number')
  return {
    samples: clean.length,
    cardsMedian: quantile(cards, 0.5),
    withImageMedian: quantile(withImg, 0.5),
    onscreenMedian: quantile(on, 0.5),
    offscreenDecodedMedian: quantile(offscreen, 0.5),
    offscreenDecodedMax: Math.max(...offscreen),
    offscreenSourceMiBMedian: round1(quantile(offArea, 0.5) / 1048576),
    offscreenSourceMiBMax: round1(Math.max(...offArea) / 1048576),
    uniqueUrlsMedian: quantile(urls, 0.5),
    duplicateElementsMedian: quantile(dupEl, 0.5),
    nearestOffscreenDistancePxMedian: nearest.length ? quantile(nearest, 0.5) : null,
  }
}

function round1(v) { return v === null || v === undefined ? null : Math.round(v * 10) / 10 }

function summarizePredecode(rows) {
  const finished = rows.filter(r => typeof r.durationMs === 'number')
  const durations = finished.map(r => r.durationMs)
  const byUrl = new Map()
  for (const row of rows) {
    const entry = byUrl.get(row.url) || { url: row.url, requests: 0, overlapped: 0, totalMs: 0 }
    entry.requests += 1
    if (row.overlapped) entry.overlapped += 1
    if (typeof row.durationMs === 'number') entry.totalMs += row.durationMs
    byUrl.set(row.url, entry)
  }
  const repeated = [...byUrl.values()].filter(entry => entry.requests > 1).sort((a, b) => b.requests - a.requests)
  const overlapped = rows.filter(r => r.overlapped).length
  // Duplicated running time: for each start that saw the same URL already running, the
  // time until one of them ends is work that a shared job would not have had to redo.
  let duplicatedMs = 0
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    if (!row.overlapped || typeof row.durationMs !== 'number') continue
    const others = rows.filter(other => other !== row && other.url === row.url &&
      typeof other.startedAt === 'number' && typeof other.endedAt === 'number' &&
      other.startedAt <= row.startedAt && other.endedAt >= row.startedAt)
    if (others.length === 0) continue
    const firstEnd = Math.min(...others.map(other => other.endedAt))
    duplicatedMs += Math.max(0, firstEnd - row.startedAt)
  }
  return {
    requests: rows.length,
    finished: finished.length,
    uniqueUrls: byUrl.size,
    repeatedUrls: repeated.length,
    topRepeated: repeated.slice(0, 8),
    overlappedRequests: overlapped,
    overlapRatio: rows.length ? round1((overlapped / rows.length) * 1000) / 1000 : 0,
    duplicatedMs: Math.round(duplicatedMs),
    durationMs: {
      p50: quantile(durations, 0.5),
      p90: quantile(durations, 0.9),
      p95: quantile(durations, 0.95),
      p99: quantile(durations, 0.99),
      max: durations.length ? Math.max(...durations) : null,
    },
  }
}

const root = process.argv[2]
if (!root) { console.error('usage: node analyze-r2diag.mjs <runroot>'); process.exit(1) }
const stages = STAGES.map(stage => loadStage(root, stage)).filter(s => !s.missing)
if (stages.length === 0) { console.error('no r2diag.json found under ' + root); process.exit(2) }

const out = { runRoot: root, stages: {}, gates: {} }
for (const { stage, diag, rows, record } of stages) {
  out.stages[stage] = {
    inflightPeak: diag.inflightPeak,
    inflightAtEnd: diag.inflight,
    predecodesTotal: diag.predecodesTotal,
    predecodesStillOpen: diag.predecodesStillOpen,
    predecodesOverlapped: diag.predecodesOverlapped,
    domLoads: diag.domLoads,
    domErrors: diag.domErrors,
    imageProxied: diag.imageProxied,
    srcPatched: diag.srcPatched,
    mounts: summarizeMounts(diag.recentMounts || diag.mountSamples || []),
    predecode: summarizePredecode(rows),
    memory: record && record.stress ? {
      settle: record.stress.settle,
      idleSettle: record.stress.idleSettle,
      phases: record.stress.phases,
    } : null,
  }
}

// The H stage is the one R2 judges (disk already warmed); G is reported for contrast.
const judged = out.stages.H || out.stages.G
out.gates = {
  B_offscreen: {
    gate: { minDecodedImages: B_MIN_OFFSCREEN_DECODED_IMAGES, minSourceMiB: B_MIN_OFFSCREEN_SOURCE_MB },
    observed: judged.mounts ? {
      decodedImages: judged.mounts.offscreenDecodedMedian,
      sourceMiB: judged.mounts.offscreenSourceMiBMedian,
    } : null,
    worthDoing: Boolean(judged.mounts &&
      (judged.mounts.offscreenDecodedMedian ?? 0) >= B_MIN_OFFSCREEN_DECODED_IMAGES &&
      (judged.mounts.offscreenSourceMiBMedian ?? 0) >= B_MIN_OFFSCREEN_SOURCE_MB),
  },
  C_inflight: {
    gate: { minInflightPeak: C_MIN_INFLIGHT_PEAK, minP95DurationMs: C_MIN_P95_DURATION_MS },
    observed: { inflightPeak: judged.inflightPeak, p95DurationMs: judged.predecode.durationMs.p95 },
    worthDoing: Boolean((judged.inflightPeak ?? 0) >= C_MIN_INFLIGHT_PEAK &&
      (judged.predecode.durationMs.p95 ?? 0) >= C_MIN_P95_DURATION_MS),
  },
  D_overlap: {
    gate: { minOverlapRatio: D_MIN_OVERLAP_RATIO },
    observed: { overlapRatio: judged.predecode.overlapRatio, duplicatedMs: judged.predecode.duplicatedMs },
    worthDoing: Boolean((judged.predecode.overlapRatio ?? 0) >= D_MIN_OVERLAP_RATIO),
  },
}
out.recommendation = Object.entries(out.gates).filter(([, g]) => g.worthDoing).map(([name]) => name)
console.log(JSON.stringify(out, null, 2))
