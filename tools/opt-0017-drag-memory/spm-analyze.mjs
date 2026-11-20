// OPT-0017 §5 复算器：把一次运行的内存轨迹、探针轨迹与手势记录对齐成 §5 要的数字。
//
// 只读 CSV/JSONL，不重跑、不改数据。所有阈值在**看数之前**写死在本文件顶部，
// 不允许事后拟合（OPT-0018 §3.4 的教训：阈值凭感觉写会与量级冲突）。
//
// 用法：
//   node spm-analyze.mjs --run runs\A
// 输出：<run>\evidence\summary.json + 控制台可读表

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf('--' + name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const runDir = resolve(arg('run', '.'))
const evidenceDir = join(runDir, 'evidence')

// ---- 事前写死的判定阈值（OPT-0017 §1 / §4 / §5） ---------------------------
const THRESHOLDS = {
  absolutePeakBytes: 300000000,          // §1 主目标：整组 PWS 绝对峰值
  absolutePeakNote: '同口径绝对峰值低于 300,000,000 bytes（约 286.1 MiB）',
  incrementalPeakMedianDrop: 0.15,       // §5.2 主指标活动增量峰中位至少降 15%
  improvedPairsRequired: 0.8,            // §5.2 至少 4/5 对改善
  readinessP95RegressionMs: 16.7,        // §5.3 p95 恶化 >16.7 ms 且 >10% 进入回归复查
  readinessP95RegressionRatio: 0.10,
  samplerP95IntervalMs: 100,             // §4 首轮有效线
  samplerMaxIntervalMs: 250,
  recoveryTargetBytes: null,             // 由 B1 动态推导：B1 + max(20 MiB, 10% × B1)
}

const bytes = value => Number(value)
const mib = value => value / 1048576
const mb = value => value / 1e6
const fmtMiB = value => (value == null || !Number.isFinite(value) ? 'n/a' : value.toFixed(1) + ' MiB')
const percentile = (values, p) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}
const median = values => percentile(values, 50)

// ---- 读内存 CSV：按 tick 聚合整组 PWS -------------------------------------
function readMemory(csvPath) {
  const text = readFileSync(csvPath, 'utf8')
  const lines = text.split(/\r?\n/).filter(Boolean)
  const header = lines.shift().split(',')
  const index = Object.fromEntries(header.map((name, position) => [name, position]))
  const ticks = new Map()
  const perProcess = new Map()
  for (const line of lines) {
    const cells = line.split(',')
    const tickMs = bytes(cells[index.monoMs])
    const pid = cells[index.pid]
    const role = cells[index.role]
    const pws = bytes(cells[index.private_working_set])
    const ws = bytes(cells[index.working_set])
    const pb = bytes(cells[index.private_bytes])
    const utcMs = bytes(cells[index.utcMs])
    if (!ticks.has(tickMs)) ticks.set(tickMs, { monoMs: tickMs, utcMs, total: 0, workingSet: 0, privateBytes: 0, roles: {} })
    const tick = ticks.get(tickMs)
    tick.total += pws
    tick.workingSet += ws
    tick.privateBytes += pb
    tick.roles[role] = (tick.roles[role] || 0) + pws
    const key = pid + ':' + role
    if (!perProcess.has(key)) perProcess.set(key, { pid: Number(pid), role, samples: [], peak: 0 })
    const entry = perProcess.get(key)
    entry.samples.push(pws)
    if (pws > entry.peak) entry.peak = pws
  }
  return { ticks: [...ticks.values()].sort((a, b) => a.monoMs - b.monoMs), perProcess: [...perProcess.values()] }
}

function readTicks(csvPath) {
  if (!existsSync(csvPath)) return null
  const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean)
  lines.shift()
  const rows = lines.map(line => {
    const [tickIndex, monoMs, intervalMs, tickCostMs, processCount] = line.split(',').map(Number)
    return { tickIndex, monoMs, intervalMs, tickCostMs, processCount }
  })
  const intervals = rows.map(row => row.intervalMs).filter(value => value > 0)
  return {
    ticks: rows.length,
    intervalP50: percentile(intervals, 50), intervalP95: percentile(intervals, 95), intervalMax: Math.max(...intervals),
    tickCostP50: percentile(rows.map(row => row.tickCostMs), 50), tickCostMax: Math.max(...rows.map(row => row.tickCostMs)),
    valid: percentile(intervals, 95) <= THRESHOLDS.samplerP95IntervalMs && Math.max(...intervals) <= THRESHOLDS.samplerMaxIntervalMs,
  }
}

// ---- 读手势与阶段：用真实时间轴切段 ---------------------------------------
function readGestures(jsonlPath) {
  if (!existsSync(jsonlPath)) return []
  return readFileSync(jsonlPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
}
function readDrive(jsonPath) {
  if (!existsSync(jsonPath)) return null
  return JSON.parse(readFileSync(jsonPath, 'utf8'))
}
function readProbe(jsonlPath) {
  if (!existsSync(jsonlPath)) return []
  return readFileSync(jsonlPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
}

// 阶段边界：drive.json 给出 plannedMs/actualMs 与顺序，但真实边界要用手势时间戳与
// 采样起点对齐。这里用「阶段起点 = 前一阶段终点」的累计时钟，并显式记录不确定性。
function phaseWindows(drive) {
  if (!drive?.phases?.length) return []
  const startedAt = Date.parse(drive.startedAtUtc)
  let cursor = 0
  return drive.phases.map(phase => {
    const from = cursor
    cursor += phase.actualMs
    return { name: phase.name, kind: phase.kind, plannedMs: phase.plannedMs, actualMs: phase.actualMs, approxStartUtc: startedAt + from, approxEndUtc: startedAt + cursor }
  })
}

// 任何 memory-*.csv 都接受：命名由 spm-sample.ps1 的 -OutCsv 决定，不写死。
const memoryPath = existsSync(evidenceDir)
  ? (readdirSync(evidenceDir).filter(name => /^memory.*\.csv$/.test(name) && !name.endsWith('.ticks.csv'))
      .sort((a, b) => a.localeCompare(b))
      .map(name => join(evidenceDir, name))[0] ?? null)
  : null
const tickPath = memoryPath ? memoryPath.replace(/\.csv$/, '.ticks.csv') : null
const summary = {
  schemaVersion: 1,
  run: runDir,
  generatedAtUtc: new Date().toISOString(),
  thresholds: THRESHOLDS,
  files: { memory: memoryPath ?? null, ticks: tickPath ?? null, drive: existsSync(join(evidenceDir, 'drive.json')) ? join(evidenceDir, 'drive.json') : null },
  validity: {},
  windows: [],
  peaks: {},
  attribution: {},
  verdict: {},
  missing: [],
}

if (!memoryPath) {
  summary.missing.push('memory CSV not found in evidence/ (expected memory-sweep-G.csv from spm-sample.ps1)')
}

const drive = readDrive(join(evidenceDir, 'drive.json'))
const gestures = readGestures(join(evidenceDir, 'gestures.jsonl'))
const probeRows = readProbe(join(evidenceDir, 'probe.jsonl'))
const memory = memoryPath ? readMemory(memoryPath) : { ticks: [], perProcess: [] }
const tickStats = tickPath ? readTicks(tickPath) : null

summary.validity = {
  sampler: tickStats,
  probe: { ticks: probeRows.length, phases: [...new Set(probeRows.map(row => row.phase))] },
  gestures: { rounds: gestures.length, commits: gestures.filter(round => round.changed).length },
  recorder: drive?.recorderFile ? { file: drive.recorderFile } : null,
  driveError: drive?.error ?? null,
}

if (memory.ticks.length) {
  const totals = memory.ticks.map(tick => tick.total)
  const windows = phaseWindows(drive)

  // 时间对齐：内存 CSV 每 tick 自带 utcMs，drive 的阶段窗口给出近似 UTC 边界。
  // 边界来自 drive 的阶段累计耗时，本身有误差；summary 里保留 approx 前缀以示这是估计。
  for (const window of windows) {
    const inside = memory.ticks.filter(tick =>
      Number.isFinite(tick.utcMs) && tick.utcMs >= window.approxStartUtc && tick.utcMs < window.approxEndUtc)
    const values = inside.map(tick => tick.total)
    summary.windows.push({
      name: window.name, kind: window.kind, plannedMs: window.plannedMs, actualMs: window.actualMs,
      samples: values.length,
      medianBytes: median(values), medianMiB: median(values) == null ? null : Number(mib(median(values)).toFixed(2)),
      p95Bytes: percentile(values, 95), peakBytes: values.length ? Math.max(...values) : null,
      peakMiB: values.length ? Number(mib(Math.max(...values)).toFixed(2)) : null,
      latestBytes: values.length ? values[values.length - 1] : null,
    })
  }

  summary.peaks = {
    wholeRunBytes: Math.max(...totals),
    wholeRunMiB: Number(mib(Math.max(...totals)).toFixed(2)),
    wholeRunMB: Number(mb(Math.max(...totals)).toFixed(1)),
    againstAbsoluteTarget: Math.max(...totals) < THRESHOLDS.absolutePeakBytes ? 'within' : 'over',
    overByBytes: Math.max(0, Math.max(...totals) - THRESHOLDS.absolutePeakBytes),
    workingSetPeakMiB: Number(mib(Math.max(...memory.ticks.map(tick => tick.workingSet))).toFixed(2)),
    privateBytesPeakMiB: Number(mib(Math.max(...memory.ticks.map(tick => tick.privateBytes))).toFixed(2)),
  }

  // 分角色峰值：§5.2 要求"同刻角色分项"
  const peakTick = memory.ticks.reduce((best, tick) => (tick.total > best.total ? tick : best), memory.ticks[0])
  summary.attribution = {
    peakAtMonoMs: peakTick.monoMs,
    peakRolesMiB: Object.fromEntries(Object.entries(peakTick.roles).map(([role, value]) => [role, Number(mib(value).toFixed(2))])),
    perProcessPeaksMiB: memory.perProcess.map(entry => ({ pid: entry.pid, role: entry.role, peakMiB: Number(mib(entry.peak).toFixed(2)), samples: entry.samples.length })).sort((a, b) => b.peakMiB - a.peakMiB).slice(0, 12),
    probeAtPeak: nearestProbe(probeRows, peakTick),
  }

  // §5.2 / §5.3 判定
  const recovery = summary.windows.find(window => window.name === 'recovery')
  const b1 = summary.windows.find(window => window.name === 'B1')
  const readiness = gestures.map(round => round.readyMs).filter(value => value != null)
  summary.verdict = {
    absolutePeak: summary.peaks.againstAbsoluteTarget === 'within'
      ? 'pass'
      : 'over target by ' + Number(mb(summary.peaks.overByBytes).toFixed(1)) + ' MB',
    samplerValidity: tickStats ? (tickStats.valid ? 'pass' : 'over §4 line (p95 ' + tickStats.intervalP95 + ' ms, max ' + tickStats.intervalMax + ' ms)') : 'no tick data',
    readinessMs: { samples: readiness.length, p50: median(readiness), p95: percentile(readiness, 95), max: readiness.length ? Math.max(...readiness) : null },
    recoveryToB1: recovery && b1 ? { b1MiB: b1.medianMiB, recoveryPeakMiB: recovery.peakMiB, recoveryMedianMiB: recovery.medianMiB } : null,
    note: '增量峰对比与 AB/BA 配对判定需要至少两臂（A 与候选），由 spm-compare.mjs 完成',
  }
}

function nearestProbe(rows, tick) {
  if (!rows.length || !tick) return null
  const target = tick.monoMs
  let best = null
  for (const row of rows) {
    const distance = Math.abs(row.t - target)
    if (!best || distance < best.distance) best = { distance, row }
  }
  if (!best) return null
  return {
    secondsAway: Number((best.distance / 1000).toFixed(1)),
    canvasAreaMiB: Number(mib(best.row.canvases?.canvasArea ?? 0).toFixed(2)),
    visibleCanvasAreaMiB: Number(mib(best.row.canvases?.visibleCanvasArea ?? 0).toFixed(2)),
    canvases: best.row.canvases?.count ?? null,
    decodedImages: best.row.images?.decoded ?? null,
    decodedSourceMiB: Number(mib(best.row.images?.sourcePixels ?? 0).toFixed(2)),
    jsHeapMiB: best.row.memory ? Number(mib(best.row.memory.jsHeapUsed).toFixed(2)) : null,
    layers: best.row.layers?.length ?? null,
    registry: best.row.registry?.length ?? null,
  }
}

writeFileSync(join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ peaks: summary.peaks, verdict: summary.verdict, validity: summary.validity.sampler, missing: summary.missing }, null, 2))
