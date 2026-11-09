import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(process.argv[2] || '')
const runs = JSON.parse(readFileSync(join(root, 'results.json'), 'utf8'))
const comparisonArm = process.argv[3] || 'candidate'
if (new Set(runs.map(run => JSON.stringify([run.cardCount, run.layoutLevel, run.viewport]))).size !== 1) throw new Error('Playlist size, layout or viewport differs across runs')
const percentile = (values, q) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor((sorted.length - 1) * q)] : null
}
const median = values => percentile(values, 0.5)
const summarizeRows = rows => {
  const eligible = rows.filter(row => !row.unavailable && row.state !== 'empty')
  const newLoads = eligible.filter(row => !row.alreadyReady && row.complete && row.waitMs !== null).map(row => row.waitMs)
  return { targets: rows.length, eligible: eligible.length, complete: eligible.filter(row => row.complete).length,
    readyAtStart: eligible.filter(row => row.alreadyReady).length, newLoads: newLoads.length,
    newLoadP50Ms: percentile(newLoads, 0.5), newLoadP95Ms: percentile(newLoads, 0.95),
    longestNewLoadMs: newLoads.length ? Math.max(...newLoads) : null,
    unresolved: eligible.filter(row => !row.complete).length,
  }
}
const summaries = runs.map(run => {
  const csv = readFileSync(join(root, `${run.pair}-${run.arm}`, 'memory.csv'), 'utf8').trim().split(/\r?\n/)
  const columns = csv.shift().replaceAll('"', '').split(',')
  const memory = csv.filter(Boolean).map(line => Object.fromEntries(line.replaceAll('"', '').split(',').map((value, i) => [columns[i], value])))
  const roles = [...new Set(memory.map(row => row.Role))]
  const resource = Object.fromEntries(roles.map(role => {
    const samples = memory.filter(row => row.Role === role)
    const buckets = new Map(), latest = new Map()
    for (const row of samples) {
      const bucket = Math.floor(Number(row.Milliseconds) / 500)
      const current = buckets.get(bucket) || { ws: 0, private: 0 }
      current.ws += Number(row.WorkingSet); current.private += Number(row.PrivateBytes)
      buckets.set(bucket, current); latest.set(row.ProcessId, row)
    }
    return [role, { peakWorkingSetMiB: Math.max(...[...buckets.values()].map(row => row.ws)) / 1048576,
      peakPrivateMiB: Math.max(...[...buckets.values()].map(row => row.private)) / 1048576,
      sumOfLastObservedPrivateMiB: [...latest.values()].reduce((sum, row) => sum + Number(row.PrivateBytes), 0) / 1048576 }]
  }))
  return { pair: run.pair, arm: run.arm, cardCount: run.cardCount, layoutLevel: run.layoutLevel, viewport: run.viewport,
    first: summarizeRows(run.episodes[0].rows),
    freshPositions: summarizeRows(run.episodes.slice(1, 5).flatMap(episode => episode.rows)),
    returns: summarizeRows(run.episodes.slice(5).flatMap(episode => episode.rows)),
    frameP50Ms: percentile(run.frames, 0.5), frameP95Ms: percentile(run.frames, 0.95),
    framesOver33Ms: run.frames.filter(value => value > 33.34).length,
    resource,
  }
})
for (const run of runs.filter(run => run.arm === 'baseline')) {
  const other = runs.find(candidate => candidate.pair === run.pair && candidate.arm === comparisonArm)
  if (!other) throw new Error('Missing paired run')
  run.episodes.forEach((episode, index) => {
    const left = episode.rows.map(row => row.index).join(',')
    const right = other.episodes[index].rows.map(row => row.index).join(',')
    if (left !== right) throw new Error(`Target identity mismatch pair ${run.pair}, episode ${index}`)
    const eligibility = rows => rows.map(row => [row.index, Boolean(row.unavailable), row.state === 'empty'])
    if (JSON.stringify(eligibility(episode.rows)) !== JSON.stringify(eligibility(other.episodes[index].rows))) {
      throw new Error(`Target eligibility mismatch pair ${run.pair}, episode ${index}`)
    }
  })
}
const paired = summaries.filter(run => run.arm === 'baseline').map(baseline => {
  const candidate = summaries.find(run => run.pair === baseline.pair && run.arm === comparisonArm)
  const ratio = key => baseline.freshPositions[key] && candidate.freshPositions[key] !== null
    ? 100 * (1 - candidate.freshPositions[key] / baseline.freshPositions[key]) : null
  return { pair: baseline.pair, p50ReductionPercent: ratio('newLoadP50Ms'), p95ReductionPercent: ratio('newLoadP95Ms'),
    baseline: baseline.freshPositions, candidate: candidate.freshPositions }
})
const report = { comparisonArm, runs: summaries, paired,
  pairedP50ReductionMedianPercent: median(paired.map(pair => pair.p50ReductionPercent)),
  pairedP95ReductionMedianPercent: median(paired.map(pair => pair.p95ReductionPercent)),
  fasterP50Pairs: paired.filter(pair => pair.p50ReductionPercent > 0).length,
  fasterP95Pairs: paired.filter(pair => pair.p95ReductionPercent > 0).length,
  limitations: 'Fresh means first visit in this session, not guaranteed backend cold; warm prefetch varies. Native img load is not final paint. Memory tracks only the startup process subtree at 500 ms intervals, can miss later processes and short peaks; sumOfLastObservedPrivateMiB combines each PID last observation and is not a simultaneous end measurement or leak proof. Reopened list avoids a separately tested baseline first-open listener defect.',
}
writeFileSync(join(root, comparisonArm === 'candidate' ? 'summary.json' : `summary-${comparisonArm}.json`), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
