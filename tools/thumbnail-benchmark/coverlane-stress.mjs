// Scroll blank-exposure stress measurement.
//
// NEW file under tools/thumbnail-benchmark/. It supersedes the out-of-repo
// D:\opt0018-ab\stress.mjs, which only waited at a destination and then timed
// "catch up to all ready". That cannot show what a user sees DURING a scroll.
//
// Plan section 3.3 asks for, and this file records:
//   * a fixed scroll script, speed, direction, dwell and input method, covering
//     at least slow, fast continuous, reverse and leave-then-revisit;
//   * `t0` immediately before the first input and a separate `tStop` at the last
//     input -- no pre-dwell before the clock starts;
//   * per-animation-frame area and readiness sampling, so a partially clipped
//     card costs proportionally;
//   * blank exposure time, area-weighted blank area x time, per-card
//     first-exposure-to-ready delay, longest single blank, and stop-to-settled;
//   * frame interval distribution, >50 ms long tasks, error and loading residue;
//   * cards that leave the screen before they are ready keep their accrued blank
//     exposure and are marked censored, never "ready".
//
// The target denominator is the fixture's frozen `universe`, and cards enter the
// measured set when they first become visible. That combination avoids the two
// failure modes the plan calls out: a denominator derived from "cards that
// already have pictures", and a missing card silently leaving the set.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import {
  HERE, sleep, sha256File, writeJson, mkdir, requireFresh, assertCacheScope, launchArm, closeViaApp,
  pinViewport, waitForOpenControl, hostFacts, gitFacts, artifactFacts, hashHarness,
  cacheSnapshot, LaneRecorder, SCHEMA_VERSION, runtimeServingFacts,
} from './coverlane-common.mjs'
import {
  pageInstallScript, pageActionScript, ACTION_SCROLL, ACTION_OPEN_LIST, PAGE_FINAL_STATE,
  captureScreenshot,
} from './coverlane-page.mjs'

const USAGE = `Usage:
  node coverlane-stress.mjs --exe <app.exe> --fixture <fixture.json> --playlist <playlist.m3u8>
                            --out <new-dir> [options]

Options:
  --programs <list>        scroll programmes: slow,fast,reverse,revisit (default all four)
  --cycles <n>             repeat the whole programme set (default 1)
  --budget-ms <n>          open-action deadline (default 20000)
  --stop-budget-ms <n>     stop-to-settled deadline (default 12000)
  --viewport <w>x<h>       fixed viewport (default from fixture)
  --dpr <n>                device scale factor (default 1)
  --port <n>               CDP port (default 9850)
  --memory-seconds <n>     also sample memory for n seconds (0 = off, default 0)
  --label <name>           label copied into the manifest
  --rust-log <filter>      RUST_LOG for the arm (default off)
`

/** The four required programmes. Identical for every arm and every cycle. */
export const PROGRAMS = {
  slow: {
    description: 'slow directional scroll: +6 px/frame for 1.2 s, hold, -6 px/frame for 0.7 s',
    segments: [
      { kind: 'move', pxPerFrame: 6, ms: 1200 },
      { kind: 'hold', ms: 400 },
      { kind: 'move', pxPerFrame: -6, ms: 700 },
      { kind: 'hold', ms: 300 },
    ],
  },
  fast: {
    description: 'fast continuous scroll: +60 px/frame for 0.9 s then +90 px/frame for 0.5 s',
    segments: [
      { kind: 'move', pxPerFrame: 60, ms: 900 },
      { kind: 'hold', ms: 250 },
      { kind: 'move', pxPerFrame: 90, ms: 500 },
      { kind: 'hold', ms: 250 },
    ],
  },
  reverse: {
    description: 'jump to 75%, then reverse at -45 px/frame for 0.8 s',
    segments: [
      { kind: 'set', fraction: 0.75 },
      { kind: 'hold', ms: 500 },
      { kind: 'move', pxPerFrame: -45, ms: 800 },
      { kind: 'hold', ms: 400 },
    ],
  },
  revisit: {
    description: 'leave to 85%, return to the top, come back to 85%: warm then cold re-entry',
    segments: [
      { kind: 'set', fraction: 0.85 },
      { kind: 'hold', ms: 500 },
      { kind: 'set', fraction: 0 },
      { kind: 'hold', ms: 600 },
      { kind: 'set', fraction: 0.85 },
      { kind: 'hold', ms: 400 },
    ],
  },
}

function parseArgs(argv) {
  const options = {
    programs: ['slow', 'fast', 'reverse', 'revisit'],
    cycles: 1,
    budgetMs: 20000,
    stopBudgetMs: 12000,
    dpr: 1,
    port: 9850,
    memorySeconds: 0,
    label: null,
    rustLog: process.env.COVERLANE_RUST_LOG || 'off',
    settleMs: Number(process.env.COVERLANE_SETTLE_MS || 2000),
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value === undefined) throw new Error(`${flag} needs a value`)
      return value
    }
    switch (flag) {
      case '--exe': options.exe = next(); break
      case '--fixture': options.fixture = next(); break
      case '--playlist': options.playlist = next(); break
      case '--out': options.out = next(); break
      case '--programs': options.programs = next().split(',').map(s => s.trim()).filter(Boolean); break
      case '--cycles': options.cycles = Number(next()); break
      case '--budget-ms': options.budgetMs = Number(next()); break
      case '--stop-budget-ms': options.stopBudgetMs = Number(next()); break
      case '--viewport': options.viewport = next(); break
      case '--dpr': options.dpr = Number(next()); break
      case '--port': options.port = Number(next()); break
      case '--memory-seconds': options.memorySeconds = Number(next()); break
      case '--label': options.label = next(); break
      case '--rust-log': options.rustLog = next(); break
      case '--settle-ms': options.settleMs = Number(next()); break
      default: throw new Error(`unknown option ${flag}\n\n${USAGE}`)
    }
  }
  return options
}

function startMemorySampler(outDir, pid, seconds, label) {
  const script = join(HERE, 'coverlane-memory.ps1')
  return spawn('powershell.exe', [
    '-NoProfile', '-File', script,
    '-RootProcessId', String(pid),
    '-OutputDirectory', outDir,
    '-IntervalMs', '1000',
    '-DurationSeconds', String(seconds),
    '-Label', label,
  ], { windowsHide: true, stdio: 'ignore' })
}

/** Reduces the per-role CSV into a trend instead of a single made-up number. */
function summariseMemory(csvPath) {
  if (!existsSync(csvPath)) return { available: false, reason: 'csv missing' }
  const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean)
  const rows = lines.slice(1)
  const byRole = new Map()
  for (const line of rows) {
    const parts = line.split(',')
    if (parts.length < 6) continue
    const [, elapsed, pid, role, workingSet, privateBytes] = parts
    if (workingSet === 'exited' || privateBytes === 'exited') continue
    const bucket = byRole.get(role) || { role, samples: [], processes: new Set() }
    bucket.samples.push({
      elapsedSeconds: Number(elapsed),
      workingSetBytes: Number(workingSet),
      privateBytes: Number(privateBytes),
    })
    bucket.processes.add(pid)
    byRole.set(role, bucket)
  }
  const roles = {}
  for (const [role, bucket] of byRole) {
    const sorted = [...bucket.samples].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds)
    if (!sorted.length) continue
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const ws = sorted.map(s => s.workingSetBytes)
    const pv = sorted.map(s => s.privateBytes)
    // Per-minute buckets make a bounded plateau distinguishable from unbounded growth.
    const perMinute = []
    const windowSeconds = last.elapsedSeconds - first.elapsedSeconds
    const minutes = Math.max(1, Math.ceil(windowSeconds / 60))
    for (let minute = 0; minute < minutes; minute++) {
      const from = minute * 60
      const to = from + 60
      const slice = sorted.filter(s => s.elapsedSeconds >= from && s.elapsedSeconds < to)
      if (!slice.length) continue
      perMinute.push({
        minute,
        workingSetBytes: Math.round(slice[slice.length - 1].workingSetBytes),
        privateBytes: Math.round(slice[slice.length - 1].privateBytes),
        samples: slice.length,
      })
    }
    roles[role] = {
      processCount: bucket.processes.size,
      sampleCount: sorted.length,
      windowSeconds,
      workingSetBytes: { first: first.workingSetBytes, peak: Math.max(...ws), last: last.workingSetBytes },
      privateBytes: { first: first.privateBytes, peak: Math.max(...pv), last: last.privateBytes },
      growthBytes: {
        workingSet: last.workingSetBytes - first.workingSetBytes,
        private: last.privateBytes - first.privateBytes,
      },
      perMinute,
    }
  }
  return {
    available: Object.keys(roles).length > 0,
    basis: {
      workingSet: 'Process.WorkingSet64 (includes shareable pages)',
      privateBytes: 'Process.PrivateMemorySize64',
      interval: '1000 ms',
      roles: 'main-rust / renderer / gpu / utility / webview-other sampled separately',
    },
    roles,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.exe || !options.fixture || !options.playlist || !options.out) {
    throw new Error(`missing required arguments\n\n${USAGE}`)
  }
  const fixturePath = resolve(options.fixture)
  if (!existsSync(fixturePath)) throw new Error(`fixture not found: ${fixturePath}`)
  const fixtureRaw = JSON.parse(readFileSync(fixturePath, 'utf8'))
  if (!fixtureRaw.universe?.ids?.length) throw new Error('fixture has no universe ids; rebuild it first')
  const viewport = options.viewport
    ? options.viewport.split('x').map(Number)
    : [fixtureRaw.viewport?.requested?.width ?? 1600, fixtureRaw.viewport?.requested?.height ?? 1000]
  const opacityThreshold = fixtureRaw.cohort.opacityThreshold
  const requiredFrames = fixtureRaw.cohort.requiredConsecutiveFrames
  const labels = fixtureRaw.labels || {}

  const outDir = requireFresh(options.out, 'output directory')
  mkdir(outDir)
  mkdir(join(outDir, 'logs'))
  mkdir(join(outDir, 'screenshots'))
  mkdir(join(outDir, 'actions'))
  const cacheRoot = join(outDir, 'cache')
  assertCacheScope(cacheRoot, 'stress cache root')
  mkdir(cacheRoot)
  mkdir(join(cacheRoot, 'webview'))

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'coverlane-stress',
    label: options.label,
    startedAt: new Date().toISOString(),
    harness: { scriptsSha256: hashHarness(), node: process.version },
    git: gitFacts(),
    host: hostFacts(),
    artifact: artifactFacts(options.exe),
    fixture: {
      path: fixturePath,
      sha256: sha256File(fixturePath),
      fixtureDigest: fixtureRaw.fixtureDigest,
      cohortSize: fixtureRaw.cohort.ids.length,
      universeSize: fixtureRaw.universe.ids.length,
      labelSplit: fixtureRaw.labelSplit,
      opacityThreshold,
      requiredFrames,
      caveats: fixtureRaw.caveats || [],
    },
    playlist: { path: resolve(options.playlist), sha256: sha256File(options.playlist) },
    programs: Object.fromEntries(Object.entries(PROGRAMS).filter(([name]) => options.programs.includes(name))),
    protocol: {
      viewport: { width: viewport[0], height: viewport[1], dpr: options.dpr },
      cycles: options.cycles,
      inputMethod: 'element.scrollTop assignment once per animation frame, inside the page context',
      t0Rule: 'performance.now() immediately before the first scroll assignment',
      tStopRule: 'timestamp of the LAST scroll assignment, stored as marks.tStopMs',
      sampling: 'requestAnimationFrame loop; each sample records clipped card area and readiness',
      visibilityProxy: 'decoded + opacity >= threshold + clipped area > 0 + N consecutive frames',
      denominator: 'fixture universe; a card is added when it first becomes visible, so a missing cover cannot leave the set',
      censoring: 'a card that leaves the screen unready keeps its accrued blank exposure and is marked censored-offscreen, never ready',
      warmState: 'single fresh cache root for the whole run; the first programme therefore cold-generates and later ones may hit disk',
      diagnostics: { rustLog: options.rustLog },
      settleOutsideMeasuredWindowsMs: options.settleMs,
    },
    compliance: {
      longTasks: 'reported per programme (>50 ms and max)',
      frameIntervals: 'p50 / p95 / max / count over 50 ms per programme',
      blankExposure: 'per-card seconds and area-weighted pixel-seconds, plus longest single blank',
      stopToSettled: 'bounded; a timeout is recorded as such rather than as success',
    },
    caveats: [
      'A single process cannot give four independent cold starts; programme order is fixed and stated so the cold/warm position is not hidden.',
      'Stop-to-settled proves the terminal state is correct; it does not prove scroll responsiveness on its own.',
      'The readiness predicate is a visible proxy, not a GPU composite/present observation.',
      'The rAF sampler itself costs main-thread time; its measured per-sample cost is reported alongside the results.',
    ],
  }
  writeJson(join(outDir, 'manifest.json'), manifest)

  const launched = await launchArm({
    executable: options.exe, cacheRoot, playlistPath: options.playlist,
    port: options.port, extraEnv: { RUST_LOG: options.rustLog },
  })
  let cdp = null
  let sampler = null
  const recorder = new LaneRecorder()
  const record = { actions: [], finalState: null, cache: null, memory: null, residue: null, errors: [] }
  try {
    cdp = await launched.connect()
    await cdp.send('Network.enable')
    recorder.install(cdp)
    record.serving = runtimeServingFacts(cdp.targetUrl)
    if (!record.serving.comparableReleaseArtifact) {
      throw new Error(
        `WebView loaded ${cdp.targetUrl}, which is not the custom protocol. ` +
        'Build with `npx tauri build --no-bundle`; a bare `cargo build --release` omits the ' +
        'custom-protocol feature and is not a comparable release artifact.',
      )
    }
    record.viewport = await pinViewport(cdp, {
      width: viewport[0], height: viewport[1], deviceScaleFactor: options.dpr,
    })
    if (!await waitForOpenControl(cdp)) throw new Error('open-audio control never appeared')
    record.instrumentation = await cdp.evaluate(pageInstallScript())

    const sourceLoad = await cdp.evaluate(`(async () => {
      const t0 = performance.now()
      const button = document.querySelector('button.empty-open-audio-button:not(:disabled)')
        || [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '打开音频' && !b.disabled)
      if (!button) return { error: 'open control absent' }
      button.click()
      const deadline = t0 + 90000
      while (performance.now() < deadline) {
        const control = [...document.querySelectorAll('button')].find(b => ['播放列表','打开播放列表','显示播放列表'].includes(b.getAttribute('aria-label')))
        if (control) return { listControlMs: performance.now() - t0 }
        await new Promise(r => requestAnimationFrame(r))
      }
      return { error: 'list control never appeared' }
    })()`)
    record.prerequisite = { sourceLoad }
    if (sourceLoad.error) throw new Error(`source prerequisite failed: ${sourceLoad.error}`)
    await sleep(options.settleMs)

    // Open the list once. Recorded as its own action so the terminal state is
    // attributable, and so a broken list mount fails loudly instead of producing
    // empty scroll programmes.
    recorder.beginWindow()
    const openResult = await cdp.evaluate(`(${pageActionScript(ACTION_OPEN_LIST)})(${JSON.stringify({
      name: 'open-list',
      mode: 'cohort',
      cohort: fixtureRaw.cohort.ids,
      labels,
      budgetMs: options.budgetMs,
      opacityThreshold,
      requiredFrames,
    })})`)
    record.actions.push({ ...openResult, network: recorder.snapshot() })
    writeJson(join(outDir, 'actions', 'open-list.json'), record.actions.at(-1))

    if (options.memorySeconds > 0) {
      sampler = startMemorySampler(outDir, launched.pid, options.memorySeconds + 60, 'stress')
      for (let i = 0; i < 200 && !existsSync(join(outDir, 'sampler-ready-stress')); i++) await sleep(50)
    }

    for (let cycle = 1; cycle <= options.cycles; cycle++) {
      for (const programName of options.programs) {
        const program = PROGRAMS[programName]
        if (!program) throw new Error(`unknown programme ${programName}`)
        recorder.beginWindow()
        const spec = {
          name: `scroll-${programName}-c${cycle}`,
          mode: 'exposure',
          cohort: [],
          universe: fixtureRaw.universe.ids,
          labels,
          budgetMs: options.budgetMs,
          stopBudgetMs: options.stopBudgetMs,
          opacityThreshold,
          requiredFrames,
          program: program.segments,
        }
        const result = await cdp.evaluate(`(${pageActionScript(ACTION_SCROLL)})(${JSON.stringify(spec)})`)
        const network = recorder.snapshot()
        let screenshot = null
        try {
          screenshot = await captureScreenshot(
            cdp, join(outDir, 'screenshots', `c${cycle}-${programName}.png`), writeFileSync,
          )
        } catch { /* a screenshot failure must not discard the timing record */ }
        const entry = { ...result, network, screenshot }
        record.actions.push(entry)
        writeJson(join(outDir, 'actions', `c${cycle}-${programName}.json`), entry)
        console.log(JSON.stringify({
          cycle,
          program: programName,
          t0ToFirstInputMs: result.t0ToFirstInputMs,
          inputCount: result.inputCount,
          tStopMs: result.marks?.tStopMs ?? null,
          stopSettledMs: result.marks?.stopSettledMs ?? null,
          stopTimedOut: Boolean(result.marks?.stopSettledTimeoutMs),
          exposed: result.summary?.exposedCount,
          ready: result.summary?.ready,
          censored: result.summary?.censoredOffscreen,
          notReady: result.summary?.notReady,
          blankExposureMs: result.summary?.blankExposureMsTotal,
          blankAreaMs: Math.round(result.summary?.blankAreaMsTotal ?? 0),
          longestBlankMs: result.summary?.longestBlankMs,
          longTasksOver50: result.longTasks?.over50Ms,
          frameP95Ms: result.frameIntervals?.p95Ms,
          framesOver50: result.frameIntervals?.over50Ms,
          fallbacks: network.laneAttempts.fallbackCount,
          assetRequests: network.asset.nativeRequests,
          domErrors: result.summary?.domErrors,
        }))
        // Return to a stated position so the next programme starts identically.
        await cdp.evaluate(`(() => { const panel = document.querySelector('.playlist-panel'); if (panel) panel.scrollTop = 0; return true })()`)
        await sleep(600)
      }
    }

    record.finalState = await cdp.evaluate(PAGE_FINAL_STATE)
    record.cache = cacheSnapshot(cacheRoot)
    const rows = record.finalState.rows || []
    record.residue = {
      totalCards: rows.length,
      ready: rows.filter(r => r.coverState === 'ready').length,
      loading: rows.filter(r => r.coverState === 'loading').length,
      error: rows.filter(r => r.coverState === 'error').length,
      idle: rows.filter(r => r.coverState === 'idle').length,
      empty: rows.filter(r => r.coverState === 'empty').length,
      imgPresent: rows.filter(r => r.hasImage).length,
      decoded: rows.filter(r => r.decoded).length,
    }
  } finally {
    if (sampler) {
      writeFileSync(join(outDir, 'sampler-stop-stress'), '')
      await sleep(2000)
      try { sampler.kill() } catch { /* already gone */ }
      record.memory = summariseMemory(join(outDir, 'memory-stress.csv'))
    }
    if (cdp) await closeViaApp(cdp)
    if (cdp) cdp.close()
    const shutdown = await launched.shutdown()
    record.exitCode = shutdown.exitCode
    writeFileSync(join(outDir, 'logs', 'process.log'), shutdown.logs || '')
  }

  const summary = buildSummary(record, manifest)
  writeJson(join(outDir, 'result.json'), { ...record, summary })
  writeJson(join(outDir, 'summary.json'), summary)
  console.log('DONE ' + join(outDir, 'summary.json'))
  console.log(JSON.stringify(summary.perProgramme.map(p => ({
    programme: p.programme,
    tStopMs: p.tStopMs,
    stopSettledMs: p.stopSettledMs,
    exposed: p.exposed,
    ready: p.ready,
    censored: p.censoredOffscreen,
    blankAreaMsTotal: p.blankAreaMsTotal,
    longestBlankMs: p.longestBlankMs,
    longTasksOver50: p.longTasksOver50Ms,
  })), null, 2))
}

function buildSummary(record, manifest) {
  const scrolls = record.actions.filter(a => a.name && a.name.startsWith('scroll-'))
  const perProgramme = scrolls.map(action => {
    const targets = action.targets || []
    const tStop = action.marks?.tStopMs ?? null
    const stopSettled = action.marks?.stopSettledMs ?? null
    return {
      programme: action.name,
      t0ToFirstInputMs: action.t0ToFirstInputMs,
      inputCount: action.inputCount,
      tStopMs: tStop,
      stopSettledMs: stopSettled,
      // Stop-to-settled, stated as a difference so it cannot be confused with an
      // absolute-on-the-timeline value.
      stopToSettledMs: tStop !== null && stopSettled !== null ? stopSettled - tStop : null,
      stopSettledTimedOut: Boolean(action.marks?.stopSettledTimeoutMs),
      elapsedMs: action.elapsedMs,
      // Denominator: exposed cards, split by the frozen label classes.
      exposed: action.summary?.exposedCount ?? null,
      ready: action.summary?.ready ?? null,
      notReady: action.summary?.notReady ?? null,
      censoredOffscreen: action.summary?.censoredOffscreen ?? null,
      registrations: action.registrations ?? null,
      dereferences: action.dereferences ?? null,
      hasCoverClass: action.summary?.hasCover ?? null,
      noCoverClass: action.summary?.noCover ?? null,
      unknownCoverClass: action.summary?.unknownCover ?? null,
      blankExposureMsTotal: action.summary?.blankExposureMsTotal ?? null,
      // px^2 * ms is the honest unit but unreadable; also report pixel-seconds
      // (blank area x seconds) which is the same quantity scaled by 1000.
      blankAreaMsTotal: Math.round(action.summary?.blankAreaMsTotal ?? 0),
      blankPixelSecondsTotal: Math.round((action.summary?.blankAreaMsTotal ?? 0) / 1000),
      blankUnit:
        'blankAreaMsTotal is sum(clipped card area in px^2 x milliseconds); ' +
        'blankPixelSecondsTotal is the same value / 1000. Neither is a frame count.',
      longestBlankMs: action.summary?.longestBlankMs ?? null,
      perCard: targets.filter(t => t.exposed).map(t => ({
        id: t.id,
        labelHasCover: t.labelHasCover,
        firstExposedMs: t.firstExposedMs,
        firstImageMs: t.firstImageMs,
        visibleProxyReadyMs: t.visibleProxyReadyMs,
        // Per-card delay from first exposure to proxy-ready; null when censored,
        // because a censored card has no legitimate completion time.
        exposureToReadyMs: t.visibleProxyReadyMs !== null && t.firstExposedMs !== null
          ? t.visibleProxyReadyMs - t.firstExposedMs : null,
        blankAreaMs: Math.round(t.blankAreaMs),
        longestBlankMs: Math.round(t.longestBlankMs),
        maxArea: Math.round(t.maxArea),
        status: t.status,
      })),
      longTasksOver50Ms: action.longTasks?.over50Ms ?? null,
      longTaskMaxMs: action.longTasks?.maxMs ?? null,
      frameP50Ms: action.frameIntervals?.p50Ms ?? null,
      frameP95Ms: action.frameIntervals?.p95Ms ?? null,
      frameMaxMs: action.frameIntervals?.maxMs ?? null,
      framesOver50Ms: action.frameIntervals?.over50Ms ?? null,
      samplerSamples: action.samples ?? null,
      samplerMeanCostMs: action.samplerCost?.meanMs ?? null,
      samplerMaxCostMs: action.samplerCost?.maxMs ?? null,
      network: {
        ipcRequests: action.network?.ipcTotals?.nativeRequests ?? null,
        ipcBytes: action.network?.ipcTotals?.decodedBytes ?? null,
        ipcNonOk: action.network?.ipcTotals?.nonOkStatus ?? null,
        assetRequests: action.network?.asset?.nativeRequests ?? null,
        assetBytes: action.network?.asset?.encodedBytes ?? null,
        assetForbidden: action.network?.asset?.forbiddenOrProtocolError ?? null,
        fallbackCount: action.network?.laneAttempts?.fallbackCount ?? null,
        pathAttempts: action.network?.laneAttempts?.byLane?.path ?? null,
        pixelAttempts: action.network?.laneAttempts?.byLane?.pixels ?? null,
        missingVerdicts: action.network?.laneAttempts?.missingVerdicts ?? null,
      },
      domErrors: action.summary?.domErrors ?? null,
      identityMismatches: action.summary?.identityMismatches ?? null,
    }
  })
  const readyDelays = perProgramme.flatMap(p => p.perCard.map(c => c.exposureToReadyMs)).filter(v => typeof v === 'number')
  const sortedDelays = [...readyDelays].sort((a, b) => a - b)
  const at = q => sortedDelays.length ? sortedDelays[Math.min(sortedDelays.length - 1, Math.floor((sortedDelays.length - 1) * q))] : null
  return {
    generatedAt: new Date().toISOString(),
    viewport: manifest.protocol.viewport,
    opacityThreshold: manifest.fixture.opacityThreshold,
    requiredConsecutiveFrames: manifest.fixture.requiredFrames,
    perProgramme,
    perCardDelayDistribution: {
      basis: 'per exposed card, first visible -> visible proxy ready; censored cards excluded because they have no completion time',
      count: sortedDelays.length,
      p50Ms: at(0.5),
      p90Ms: at(0.9),
      maxMs: sortedDelays.length ? sortedDelays[sortedDelays.length - 1] : null,
    },
    residue: record.residue,
    cache: record.cache,
    memory: record.memory ?? { available: false },
    aggregate: {
      programmes: perProgramme.length,
      totalBlankAreaMs: perProgramme.length
        ? perProgramme.reduce((a, p) => a + (p.blankAreaMsTotal || 0), 0) : null,
      totalBlankPixelSeconds: perProgramme.length
        ? perProgramme.reduce((a, p) => a + (p.blankPixelSecondsTotal || 0), 0) : null,
      totalBlankExposureMs: perProgramme.length
        ? perProgramme.reduce((a, p) => a + (p.blankExposureMsTotal || 0), 0) : null,
      worstLongestBlankMs: perProgramme.length
        ? Math.max(...perProgramme.map(p => p.longestBlankMs || 0)) : null,
      worstStopToSettledMs: perProgramme.length
        ? Math.max(...perProgramme.map(p => p.stopToSettledMs || 0)) : null,
      censoredCards: perProgramme.reduce((a, p) => a + (p.censoredOffscreen || 0), 0),
      notReadyCards: perProgramme.reduce((a, p) => a + (p.notReady || 0), 0),
      domErrors: perProgramme.reduce((a, p) => a + (p.domErrors || 0), 0),
      identityMismatches: perProgramme.reduce((a, p) => a + (p.identityMismatches || 0), 0),
      fallbackCount: perProgramme.reduce((a, p) => a + (p.network?.fallbackCount || 0), 0),
      stopTimeouts: perProgramme.filter(p => p.stopSettledTimedOut).length,
    },
  }
}

await main()
