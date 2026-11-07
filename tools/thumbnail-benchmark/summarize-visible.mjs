import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] || '')
const comparisonArm = process.argv[3] || 'candidate'
const raw = JSON.parse(readFileSync(join(root, 'results.json'), 'utf8'))
const quantile = (values, q) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] : null
}
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  const n = sorted.length
  return n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null
}
const problems = []
if (new Set(raw.map(run => JSON.stringify([run.cardCount, run.layoutLevel, run.viewport]))).size !== 1) problems.push('Playlist/layout/viewport differs')
const eligible = row => !row.unavailable && row.state !== 'empty'
function coverageTime(rows, timeFor) {
  if (!rows.length) return 0
  const times = rows.map(timeFor).map(time => Number.isFinite(time) ? time : Infinity).sort((a, b) => a - b)
  const time = times[Math.ceil(rows.length * .9) - 1]
  return Number.isFinite(time) ? time : null
}
function memoryFor(run) {
  const csv = readFileSync(join(root, `${run.pair}-${run.arm}-${run.cacheMode}`, 'memory.csv'), 'utf8').trim().split(/\r?\n/)
  const columns = csv.shift().replaceAll('"', '').split(',')
  const rows = csv.filter(Boolean).map(line => Object.fromEntries(line.replaceAll('"', '').split(',').map((value, i) => [columns[i], value])))
  const buckets = new Map()
  for (const row of rows) {
    const key = `${row.Role}:${Math.floor(Number(row.Milliseconds) / 500)}`
    const item = buckets.get(key) || { role: row.Role, private: 0, ws: 0 }
    item.private += Number(row.PrivateBytes); item.ws += Number(row.WorkingSet)
    buckets.set(key, item)
  }
  return Object.fromEntries([...new Set(rows.map(row => row.Role))].map(role => {
    const samples = [...buckets.values()].filter(row => row.role === role)
    return [role, { peakPrivateMiB: Math.max(...samples.map(row => row.private)) / 1048576,
      peakWorkingSetMiB: Math.max(...samples.map(row => row.ws)) / 1048576 }]
  }))
}
const runs = raw.map(run => {
  const baseline = raw.find(item => item.pair === run.pair && item.cacheMode === run.cacheMode && item.arm === 'baseline')
  if (!baseline) throw new Error('Missing baseline')
  const stops = run.episodes.map((episode, index) => {
    const reference = baseline.episodes[index]
    if (JSON.stringify(episode.rows.map(row => row.id)) !== JSON.stringify(reference.rows.map(row => row.id))) problems.push(`Target mismatch ${run.pair}/${run.cacheMode}/${run.arm}/${index}`)
    if (episode.columns !== reference.columns || Math.abs(episode.coverCssPixels - reference.coverCssPixels) > .1) problems.push(`Geometry mismatch ${run.pair}/${run.cacheMode}/${run.arm}/${index}`)
    const references = new Map(reference.rows.map(row => [row.id, row]))
    const rows = episode.rows.filter(row => eligible(references.get(row.id) || row))
    for (const row of episode.rows) {
      const other = references.get(row.id)
      if (other && eligible(row) !== eligible(other)) problems.push(`Eligibility mismatch ${run.pair}/${run.cacheMode}/${run.arm}/${index}/${row.index}`)
    }
    const qualityTime = row => {
      const target = references.get(row.id)?.finalEdge
      return target ? row.history.find(event => event.edge >= target)?.ms ?? null : null
    }
    return { fraction: episode.fraction, columns: episode.columns, coverCssPixels: episode.coverCssPixels,
      eligible: rows.length, complete: rows.filter(row => row.complete).length,
      alreadyReady: rows.filter(row => row.alreadyReady).length, errors: rows.reduce((sum, row) => sum + row.errors, 0),
      firstVisibleT90Ms: coverageTime(rows, row => row.firstVisibleMs),
      finalQualityT90Ms: coverageTime(rows, qualityTime),
      finalQualityComplete: rows.filter(row => row.complete && row.finalEdge >= (references.get(row.id)?.finalEdge ?? Infinity)).length,
      lateFallbackObservations: rows.filter(row => row.firstVisibleMs !== null && row.firstVisibleMs >= episode.dwellMs).length,
    }
  })
  const fresh = stops.slice(1, 5)
  const metrics = key => fresh.some(stop => stop[key] === null) ? null : quantile(fresh.map(stop => stop[key]), .95)
  return { pair: run.pair, arm: run.arm, cacheMode: run.cacheMode, stops,
    stopT90P95Ms: metrics('firstVisibleT90Ms'), qualityStopT90P95Ms: metrics('finalQualityT90Ms'),
    freshComplete: fresh.reduce((sum, stop) => sum + stop.complete, 0),
    freshEligible: fresh.reduce((sum, stop) => sum + stop.eligible, 0),
    freshFinalQualityComplete: fresh.reduce((sum, stop) => sum + stop.finalQualityComplete, 0),
    frameP95Ms: quantile(run.frames, .95), framesOver33Ms: run.frames.filter(ms => ms > 33.34).length,
    memory: memoryFor(run),
  }
})
const paired = runs.filter(run => run.arm === 'baseline').map(baseline => {
  const candidate = runs.find(run => run.pair === baseline.pair && run.cacheMode === baseline.cacheMode && run.arm === comparisonArm)
  if (!candidate) throw new Error('Missing paired candidate')
  const reduction = key => baseline[key] > 0 && Number.isFinite(candidate[key]) ? 100 * (1 - candidate[key] / baseline[key]) : null
  return { pair: baseline.pair, cacheMode: baseline.cacheMode,
    reductionPercent: reduction('stopT90P95Ms'), finalQualityReductionPercent: reduction('qualityStopT90P95Ms'),
    baselineMs: baseline.stopT90P95Ms, candidateMs: candidate.stopT90P95Ms,
    baselineQualityMs: baseline.qualityStopT90P95Ms, candidateQualityMs: candidate.qualityStopT90P95Ms,
    baselineComplete: baseline.freshComplete, candidateComplete: candidate.freshComplete,
    baselineEligible: baseline.freshEligible, candidateEligible: candidate.freshEligible,
    candidateFinalQualityComplete: candidate.freshFinalQualityComplete,
  }
})
const summary = [...new Set(paired.map(pair => pair.cacheMode))].map(cacheMode => {
  const items = paired.filter(pair => pair.cacheMode === cacheMode)
  return { cacheMode, pairs: items.length, medianReductionPercent: median(items.map(pair => pair.reductionPercent)),
    fasterPairs: items.filter(pair => pair.reductionPercent > 0).length,
    baselineMedianMs: median(items.map(pair => pair.baselineMs)), candidateMedianMs: median(items.map(pair => pair.candidateMs)),
    medianFinalQualityReductionPercent: median(items.map(pair => pair.finalQualityReductionPercent)),
    censoredPairs: items.filter(pair => pair.reductionPercent === null).length }
})
const report = { comparisonArm, problems, summary, paired, runs,
  limitations: 'T90 retains missing targets as censored. Per-run p95 uses nearest rank over four new stops and therefore is their maximum. Visible means mounted complete img with opacity>=.99 observed on load/transition plus rAF; not physical display paint. First preview and final natural-image quality are separate. Fresh cache is empty at launch, subsequent application prefetch is real; OS cold is uncontrolled. Disk-warm repeats its own previous paths in a new process/profile, not the entire library prebuilt. Memory is startup subtree sampled every500ms, missing later processes and short peaks, not leak proof.' }
writeFileSync(join(root, `visible-summary-${comparisonArm}.json`), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ problems, summary, paired }, null, 2))
