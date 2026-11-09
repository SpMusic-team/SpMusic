// 临时分析脚本（不属于交付物）：把 scroll-probe 结果 JSON 折成报告用的数字
const fs = require('node:fs')

const file = process.argv[2]
const report = JSON.parse(fs.readFileSync(file, 'utf8'))
const round = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const med = values => {
  const present = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (!present.length) return null
  const mid = Math.floor(present.length / 2)
  return round(present.length % 2 ? present[mid] : (present[mid - 1] + present[mid]) / 2)
}
const q = (values, p) => {
  const present = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (!present.length) return null
  return round(present[Math.min(present.length - 1, Math.ceil(p / 100 * present.length) - 1)])
}

const groups = new Map()
for (const run of report.runs) {
  if (run.error) { console.log('ERROR RUN', run.label, run.error); continue }
  const key = run.view + '-' + run.size
  const list = groups.get(key) ?? []
  list.push(run)
  groups.set(key, list)
}

console.log('### runs per config')
for (const [key, list] of groups) console.log(' ', key, list.length, 'runs:', list.map(r => r.label).join(' '))

const metrics = {}
for (const [key, list] of groups) {
  const agg = { key, n: list.length }
  const take = fn => list.map(fn)
  agg.layoutLevel = list[0].layoutLevel
  agg.inputMode = list[0].inputMode
  agg.sizes = { scrollRange: list[0].geometry.scrollRange, stepPx: list[0].geometry.stepPx, wheelEvents: list[0].geometry.totalWheelEvents }
  agg.dragElapsedMs = med(take(r => r.summary.dragElapsedMs))
  agg.wheelEvents = list[0].geometry.totalWheelEvents
  agg.msPerWheelEvent = round(agg.dragElapsedMs / agg.wheelEvents)
  agg.frames = med(take(r => r.summary.framesForward.count))
  agg.framesIdleP50 = med(take(r => r.summary.framesIdle.p50))
  agg.frameP50 = med(take(r => r.summary.framesForward.p50))
  agg.frameP90 = med(take(r => r.summary.framesForward.p90))
  agg.frameP95 = med(take(r => r.summary.framesForward.p95))
  agg.frameP99 = med(take(r => r.summary.framesForward.p99))
  agg.frameMax = med(take(r => r.summary.framesForward.max))
  agg.over33 = med(take(r => r.summary.framesForward.over33ms))
  agg.over50 = med(take(r => r.summary.framesForward.over50ms))
  agg.longTasks = med(take(r => r.summary.longTasksForward.count))
  agg.longTaskTotalMs = med(take(r => r.summary.longTasksForward.totalMs))
  agg.longTaskMaxMs = med(take(r => r.summary.longTasksForward.maxMs))
  for (const metric of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount', 'TaskCount']) {
    agg[metric] = med(take(r => r.summary.metricsForward[metric]))
  }
  agg.scriptPerFrame = round(agg.ScriptDuration / agg.frames, 2)
  agg.taskPerFrame = round(agg.TaskDuration / agg.frames, 2)
  agg.taskPerWheelEvent = round(agg.TaskDuration / agg.wheelEvents, 1)
  agg.scriptPerWheelEvent = round(agg.ScriptDuration / agg.wheelEvents, 1)
  agg.busyRatio = round(agg.TaskDuration / agg.dragElapsedMs, 3)
  agg.busyRatio60fps = round(agg.taskPerFrame / 16.7, 3)
  agg.avgTaskMs = round(agg.TaskDuration / agg.TaskCount, 1)
  agg.trace = {
    updateLayoutTreeCount: med(take(r => r.trace?.events?.UpdateLayoutTree?.count)),
    updateLayoutTreeMs: med(take(r => r.trace?.events?.UpdateLayoutTree?.cpuMs)),
    layoutCount: med(take(r => r.trace?.events?.Layout?.count)),
    layoutMs: med(take(r => r.trace?.events?.Layout?.cpuMs)),
    paintCount: med(take(r => r.trace?.events?.Paint?.count)),
    paintMs: med(take(r => r.trace?.events?.Paint?.cpuMs)),
    prePaintCount: med(take(r => r.trace?.events?.PrePaint?.count)),
    functionCallCount: med(take(r => r.trace?.events?.FunctionCall?.count)),
    functionCallMs: med(take(r => r.trace?.events?.FunctionCall?.cpuMs)),
    fireAnimationFrameCount: med(take(r => r.trace?.events?.FireAnimationFrame?.count)),
    styleP50: med(take(r => r.trace?.styleElements?.p50)),
    styleP90: med(take(r => r.trace?.styleElements?.p90)),
    styleP95: med(take(r => r.trace?.styleElements?.p95)),
    styleMax: med(take(r => r.trace?.styleElements?.max)),
    styleLarge: med(take(r => r.trace?.styleElements?.largeCount)),
    styleHuge: med(take(r => r.trace?.styleElements?.hugeCount)),
    styleTotalElements: med(take(r => r.trace?.styleElements?.totalElements)),
    perWheelEventLayoutTree: round(agg.updateLayoutTreeCount / agg.wheelEvents, 2),
    styleTotalPerWheelEvent: round(agg.styleTotalElements / agg.wheelEvents, 1),
  }
  agg.native = {
    calls: med(take(r => r.summary.nativeForward.calls)),
    modelledMs: med(take(r => r.summary.nativeForward.totalModelledNativeMs)),
    thumbnails: med(take(r => r.summary.nativeForward.byCommand.audio_load_track_thumbnail?.count ?? 0)),
    probes: med(take(r => Object.entries(r.summary.nativeForward.byCommand).filter(([c]) => c.startsWith('audio_probe_')).reduce((s, [, v]) => s + v.count, 0))),
    beginWindows: med(take(r => r.summary.nativeForward.byCommand.audio_begin_playlist_cover_window?.count ?? 0)),
    byCommand: (() => {
      const out = {}
      for (const run of list) for (const [command, value] of Object.entries(run.summary.nativeForward.byCommand)) {
        const slot = out[command] ?? (out[command] = { count: 0, delayMs: 0 })
        slot.count += value.count
        slot.delayMs += value.delayMs
      }
      return out
    })(),
  }
  agg.rates = {
    rowsPerSecond: med(take(r => r.rates.rowsPerSecond)),
    thumbnailsPerSecond: med(take(r => r.rates.thumbnailsPerSecond)),
    nativeCallsPerSecond: med(take(r => r.rates.nativeCallsPerSecond)),
    pxPerSecond: med(take(r => r.rates.pxPerSecond)),
  }
  agg.cover = {
    rowsEntered: med(take(r => r.coverLatency.rowsEntered)),
    rowsReady: med(take(r => r.coverLatency.rowsReady)),
    preloaded: med(take(r => r.coverLatency.rowsPreloadedAtEntry)),
    preloadedRatio: med(take(r => r.coverLatency.preloadedRatio)),
    delayed: med(take(r => r.coverLatency.rowsDelayed)),
    missed: med(take(r => r.coverLatency.rowsMissedVisibleCover)),
    delayP50: med(take(r => r.coverLatency.delayMs.p50)),
    delayP90: med(take(r => r.coverLatency.delayMs.p90)),
    delayMax: med(take(r => r.coverLatency.delayMs.max)),
    allDelayP50: med(take(r => r.coverLatency.allDelayMs.p50)),
    allDelayP90: med(take(r => r.coverLatency.allDelayMs.p90)),
    mountToEnterP50: med(take(r => r.coverLatency.mountToEnterMs.p50)),
    mountToEnterP90: med(take(r => r.coverLatency.mountToEnterMs.p90)),
  }
  agg.mounted = {
    min: med(take(r => r.mountedCurve.min)),
    p50: med(take(r => r.mountedCurve.p50)),
    max: med(take(r => r.mountedCurve.max)),
  }
  agg.idle = {
    firstRowAtMs: med(take(r => r.idleLoad.view?.firstRowAtMs)),
    t90: med(take(r => r.idleLoad.view?.t90FirstVisibleMs)),
    rowsVisible: med(take(r => r.idleLoad.view?.rowsInitiallyVisible)),
    nativeCalls: med(take(r => r.idleLoad.native.calls)),
    nativeMs: med(take(r => r.idleLoad.native.totalModelledNativeMs)),
  }
  agg.backward = {
    elapsedMs: med(take(r => r.phases.find(p => p.name === 'backward')?.elapsedMs)),
    task: med(take(r => r.phases.find(p => p.name === 'backward')?.metrics.TaskDuration)),
    script: med(take(r => r.phases.find(p => p.name === 'backward')?.metrics.ScriptDuration)),
    frameP95: med(take(r => r.phases.find(p => p.name === 'backward')?.frames.p95)),
    nativeCalls: med(take(r => r.phases.find(p => p.name === 'backward')?.native.calls)),
  }
  agg.pauseMid = {
    task: med(take(r => r.phases.find(p => p.name === 'pause-mid')?.metrics.TaskDuration)),
    nativeCalls: med(take(r => r.phases.find(p => p.name === 'pause-mid')?.native.calls)),
    cardsPixelsBegin: med(take(r => r.phases.find(p => p.name === 'pause-mid')?.began.cardsWithPixels)),
    cardsPixelsEnd: med(take(r => r.phases.find(p => p.name === 'pause-mid')?.ended.cardsWithPixels)),
  }
  metrics[key] = agg
}

console.log('\n### MAIN TABLE')
const order = ['library-l4-900', 'library-l4-1800', 'library-l1-900', 'library-l1-1800', 'playlist-900', 'playlist-1800']
for (const key of order) {
  const agg = metrics[key]
  if (!agg) continue
  console.log('\n--- ' + key + ' (layout ' + agg.layoutLevel + ', n=' + agg.n + ', ' + agg.frames + ' frames, ' + agg.dragElapsedMs + 'ms)')
  console.log('  geometry        range=' + agg.sizes.scrollRange + 'px step=' + agg.sizes.stepPx + 'px wheelEvents=' + agg.wheelEvents
    + '  msPerWheelEvent=' + agg.msPerWheelEvent + '  mountedCards=' + agg.mounted.min + '-' + agg.mounted.max + ' (p50 ' + agg.mounted.p50 + ')')
  console.log('  idle firstRow   ' + agg.idle.firstRowAtMs + 'ms  t90=' + agg.idle.t90 + 'ms  rows=' + agg.idle.rowsVisible
    + '  native=' + agg.idle.nativeCalls + '/' + agg.idle.nativeMs + 'ms')
  console.log('  frames          p50=' + agg.frameP50 + ' p90=' + agg.frameP90 + ' p95=' + agg.frameP95 + ' p99=' + agg.frameP99
    + ' max=' + agg.frameMax + ' over33=' + agg.over33 + ' over50=' + agg.over50 + ' (idle p50 ' + agg.framesIdleP50 + ')')
  console.log('  longtask        n=' + agg.longTasks + ' total=' + agg.longTaskTotalMs + 'ms max=' + agg.longTaskMaxMs + 'ms')
  console.log('  mainThread      Task=' + agg.TaskDuration + 'ms (' + agg.busyRatio + ' of wall, ' + agg.taskPerFrame
    + 'ms/frame = ' + round(agg.busyRatio60fps * 100) + '% of 16.7ms) Script=' + agg.ScriptDuration
    + 'ms (' + agg.scriptPerFrame + 'ms/frame) Layout=' + agg.LayoutDuration + 'ms Recalc=' + agg.RecalcStyleDuration
    + 'ms LayoutCount=' + agg.LayoutCount + ' TaskCount=' + agg.TaskCount + ' avgTask=' + agg.avgTaskMs + 'ms')
  console.log('  perWheelEvent   Task=' + agg.taskPerWheelEvent + 'ms Script=' + agg.scriptPerWheelEvent + 'ms')
  console.log('  trace styles    UpdateLayoutTree n=' + agg.trace.updateLayoutTreeCount + ' (' + agg.trace.updateLayoutTreeMs
    + 'ms) elementCount p50=' + agg.trace.styleP50 + ' p90=' + agg.trace.styleP90 + ' p95=' + agg.trace.styleP95
    + ' max=' + agg.trace.styleMax + ' >=20:' + agg.trace.styleLarge + ' >=50:' + agg.trace.styleHuge
    + ' totalElems=' + agg.trace.styleTotalElements + ' (' + agg.trace.styleTotalPerWheelEvent + '/wheelEvent)')
  console.log('  trace layout    Layout n=' + agg.trace.layoutCount + ' (' + agg.trace.layoutMs + 'ms) Paint n=' + agg.trace.paintCount
    + ' (' + agg.trace.paintMs + 'ms) PrePaint n=' + agg.trace.prePaintCount + ' FunctionCall n=' + agg.trace.functionCallCount
    + ' (' + agg.trace.functionCallMs + 'ms) rAF n=' + agg.trace.fireAnimationFrameCount)
  console.log('  native          calls=' + agg.native.calls + '/' + agg.native.modelledMs + 'ms thumbnails=' + agg.native.thumbnails
    + ' probes=' + agg.native.probes + ' coverWindows=' + agg.native.beginWindows)
  console.log('  throughput      rows/s=' + agg.rates.rowsPerSecond + ' thumbnails/s=' + agg.rates.thumbnailsPerSecond
    + ' native/s=' + agg.rates.nativeCallsPerSecond + ' px/s=' + agg.rates.pxPerSecond)
  console.log('  covers          entered=' + agg.cover.rowsEntered + ' ready=' + agg.cover.rowsReady + ' preloaded=' + agg.cover.preloaded
    + ' (' + round(agg.cover.preloadedRatio * 100) + '%) delayed=' + agg.cover.delayed + ' missed=' + agg.cover.missed
    + ' (' + round(agg.cover.missed / Math.max(1, agg.cover.rowsEntered) * 100) + '%)')
  console.log('  coverDelay      delayed p50=' + agg.cover.delayP50 + ' p90=' + agg.cover.delayP90 + ' max=' + agg.cover.delayMax
    + '  allRows p50=' + agg.cover.allDelayP50 + ' p90=' + agg.cover.allDelayP90
    + '  mountToEnter p50=' + agg.cover.mountToEnterP50 + ' p90=' + agg.cover.mountToEnterP90)
  console.log('  backward        ' + agg.backward.elapsedMs + 'ms Task=' + agg.backward.task + 'ms Script=' + agg.backward.script
    + 'ms frameP95=' + agg.backward.frameP95 + ' native=' + agg.backward.nativeCalls)
  console.log('  pauseMid(1s)    Task=' + agg.pauseMid.task + 'ms native=' + agg.pauseMid.nativeCalls
    + ' cardsWithPixels ' + agg.pauseMid.cardsPixelsBegin + '->' + agg.pauseMid.cardsPixelsEnd)
  console.log('  commands        ' + Object.entries(agg.native.byCommand).map(([c, v]) => c + '=' + v.count).join(' '))
}

console.log('\n### COMMAND BREAKDOWN (sum over runs)')
const commandTotals = {}
for (const key of order) {
  const agg = metrics[key]
  if (!agg) continue
  for (const [command, value] of Object.entries(agg.native.byCommand)) {
    const slot = commandTotals[command] ?? (commandTotals[command] = {})
    slot[key] = value.count
  }
}
console.table(commandTotals)

console.log('\n### POSITION SWEEP (per phase, first run of each config)')
for (const key of order) {
  const list = groups.get(key)
  if (!list) continue
  const run = list[0]
  console.log('--- ' + key + ' (' + run.size + ' tracks)')
  console.table(run.phases.filter(p => p.name.startsWith('forward-') || p.name === 'backward').map(p => ({
    phase: p.name,
    scrollTop: p.began.scrollTop,
    ms: p.elapsedMs,
    fP95: p.frames.p95,
    fMax: p.frames.max,
    over50: p.frames.over50ms,
    Task: p.metrics.TaskDuration,
    Script: p.metrics.ScriptDuration,
    Layout: p.metrics.LayoutDuration,
    Recalc: p.metrics.RecalcStyleDuration,
    native: p.native.calls,
    cardsPx: p.ended.cardsWithPixels,
  })))
}

console.log('\n### BY DEPTH (first run of each config; bucket 0 = top)')
for (const key of order) {
  const list = groups.get(key)
  if (!list) continue
  const run = list[0]
  console.log('--- ' + key)
  console.table(run.coverLatency.byDepth.map(b => ({
    bucket: b.bucket,
    rows: b.rowsEntered,
    cards: b.cardsMedian,
    delayP50: b.coverDelayP50,
    delayP90: b.coverDelayP90,
    delayMax: b.coverDelayMax,
  })))
}

console.log('\n### MOUNTED CARD CURVE (distinct values per config, medians over runs)')
for (const key of order) {
  const list = groups.get(key)
  if (!list) continue
  console.log(' ', key, 'distinct:', list.map(r => r.mountedCurve.distinct.join('/')).join(' | '))
}

console.log('\n### ENGINE')
console.log(JSON.stringify({ gitCommit: report.engine.gitCommit, gitDirty: report.engine.gitDirty,
  originVerified: report.engine.originVerified, browser: report.engine.browser, viewport: report.engine.viewport,
  generatedAt: report.engine.generatedAt, input: report.engine.input }, null, 1))
