// A/B paired measurement of the OPT-0018 list-cover asset path lane.
//
// NEW file under tools/thumbnail-benchmark/. It supersedes the out-of-repo
// D:\opt0018-ab\ab-run.mjs, whose clock started AFTER the action (a 150 ms sleep,
// then "wait for the grid"), which made `settleMs` a local completion figure
// rather than an end-to-end user action. The mechanics worth keeping are kept:
// one isolated cache root per arm, one WebView2 profile per arm, custom-protocol
// release binaries, alternating pair order, warm/cold disk modes.
//
// What changed, mapped to the closeout plan:
//   * 3.1 - `t0` is taken immediately before the click in the same execution
//     context, so "grid not mounted" and "metadata not ready" are inside the
//     total and also recorded as separate marks;
//   * 3.2 - the target set and the has-cover/no-cover split come from a frozen
//     fixture, never from "whichever card owns an <img> right now";
//   * 3.3 - scroll programmes are fixed, `tStop` is recorded, and blank exposure
//     is integrated per frame (see coverlane-stress.mjs for the full pass);
//   * 4   - fallback and DOM failure are COUNTED from CDP network facts and
//     attempt identities, plus in-page counters, never inferred from `.spxr`
//     listings;
//   * 2   - every batch writes a manifest with commits, artifact digests, corpus
//     distribution, host/WebView2, viewport/DPR, script hashes and trial order.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  sleep, sha256File, writeJson, mkdir, requireFresh, assertCacheScope,
  launchArm, closeViaApp, pinViewport, waitForOpenControl, hostFacts, gitFacts, artifactFacts,
  hashHarness, cacheSnapshot, LaneRecorder, SCHEMA_VERSION, percentile, ensureListPanel,
  runtimeServingFacts,
} from './coverlane-common.mjs'
import {
  CoverAttemptLedger, assessByteComparability,
} from './coverlane-counting.mjs'
import {
  pageInstallScript, pageActionScript, ACTION_OPEN_LIST, ACTION_LEAVE_LIST, ACTION_SCROLL,
  PAGE_FINAL_STATE, captureScreenshot,
} from './coverlane-page.mjs'

const USAGE = `Usage:
  node coverlane-ab.mjs --baseline <app.exe> --candidate <app.exe> --fixture <fixture.json>
                        --playlist <playlist.m3u8> --out <new-dir> [options]

Options:
  --pairs <n>              paired trials (default 1)
  --modes <list>           comma list of fresh,warm (default fresh)
  --actions <list>         comma list of open,leave,scroll:slow,scroll:fast (default open)
  --budget-ms <n>          per-action deadline (default 20000)
  --stop-budget-ms <n>     scroll stop-to-settled deadline (default 12000)
  --viewport <w>x<h>       fixed viewport (default from fixture)
  --dpr <n>                device scale factor (default 1)
  --port-base <n>          CDP port base (default 9600)
  --label <name>           free-form label recorded in the manifest
  --settle-ms <n>          unmeasured settle after the source scan (default 2000)
  --no-screenshots         skip key-moment screenshots
  --rust-log <filter>      RUST_LOG for the arms (default off)
`

/** Scroll programmes. Identical for every arm; also used by coverlane-stress.mjs. */
export const SCROLL_PROGRAMS = {
  slow: [
    { kind: 'move', pxPerFrame: 6, ms: 1200 },
    { kind: 'hold', ms: 400 },
    { kind: 'move', pxPerFrame: -6, ms: 700 },
    { kind: 'hold', ms: 300 },
  ],
  fast: [
    { kind: 'move', pxPerFrame: 60, ms: 900 },
    { kind: 'hold', ms: 250 },
    { kind: 'move', pxPerFrame: 90, ms: 500 },
    { kind: 'hold', ms: 250 },
  ],
  reverse: [
    { kind: 'set', fraction: 0.75 },
    { kind: 'hold', ms: 500 },
    { kind: 'move', pxPerFrame: -45, ms: 800 },
    { kind: 'hold', ms: 400 },
  ],
  revisit: [
    { kind: 'set', fraction: 0.85 },
    { kind: 'hold', ms: 500 },
    { kind: 'set', fraction: 0 },
    { kind: 'hold', ms: 600 },
    { kind: 'set', fraction: 0.85 },
    { kind: 'hold', ms: 400 },
  ],
}

function parseArgs(argv) {
  const options = {
    pairs: 1,
    modes: ['fresh'],
    actions: ['open'],
    budgetMs: 20000,
    stopBudgetMs: 12000,
    dpr: 1,
    portBase: 9600,
    screenshots: true,
    label: null,
    settleMs: Number(process.env.COVERLANE_SETTLE_MS || 2000),
    rustLog: process.env.COVERLANE_RUST_LOG || 'off',
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value === undefined) throw new Error(`${flag} needs a value`)
      return value
    }
    switch (flag) {
      case '--baseline': options.baseline = next(); break
      case '--candidate': options.candidate = next(); break
      case '--fixture': options.fixture = next(); break
      case '--playlist': options.playlist = next(); break
      case '--out': options.out = next(); break
      case '--pairs': options.pairs = Number(next()); break
      case '--modes': options.modes = next().split(',').map(s => s.trim()).filter(Boolean); break
      case '--actions': options.actions = next().split(',').map(s => s.trim()).filter(Boolean); break
      case '--budget-ms': options.budgetMs = Number(next()); break
      case '--stop-budget-ms': options.stopBudgetMs = Number(next()); break
      case '--viewport': options.viewport = next(); break
      case '--dpr': options.dpr = Number(next()); break
      case '--port-base': options.portBase = Number(next()); break
      case '--label': options.label = next(); break
      case '--settle-ms': options.settleMs = Number(next()); break
      case '--no-screenshots': options.screenshots = false; break
      case '--rust-log': options.rustLog = next(); break
      default: throw new Error(`unknown option ${flag}\n\n${USAGE}`)
    }
  }
  return options
}

/**
 * Feed the authoritative ledger from one recorded action.
 *
 * `records` are the raw CDP request records and `presentation` is the in-page
 * report from the application's own presentation protocol. Both must be passed
 * explicitly: an earlier version read them off the finished `network` snapshot,
 * which does not exist yet at that point, so the ledger came out empty and looked
 * like "no fallbacks" rather than "not measured".
 *
 * Lane starts/outcomes are marked `observed` (they are real protocol events).
 * This harness cannot see the frontend scheduler's recovery出口, so it never
 * invents a `fallbackStarted`; recovery therefore stays 0 unless a future
 * instrumentation seam reports it, which is stated in the summary.
 */
function buildLedger({ records = [], presentation = null, ownerSession }) {
  const ledger = new CoverAttemptLedger({ ownerSession })
  for (const request of records) {
    const lane = request.command && /_path$/.test(request.command) ? 'path'
      : request.command && /cover_pixels|_thumbnail$/.test(request.command) ? 'pixels' : null
    if (!lane) continue
    const attemptId = `cdp:${request.order}`
    if (lane === 'path') {
      ledger.record({
        type: 'pathStart', attemptId, requestId: `native:${request.order}`,
        at: request.durationMs ?? null, authority: 'observed',
      })
      if (request.status === 200) {
        const type = request.decodedBytes > 0 && request.decodedBytes <= 8 ? 'pathMissing' : 'pathReady'
        ledger.record({ type, attemptId, at: request.durationMs ?? null, authority: 'observed' })
      } else if (request.failed) {
        ledger.record({ type: 'pathFailed', attemptId, reason: request.failed, at: request.durationMs ?? null, authority: 'observed' })
      }
    } else {
      ledger.record({
        type: 'pixelsStart', attemptId, requestId: `native:${request.order}`,
        at: request.durationMs ?? null, authority: 'observed',
      })
    }
  }
  // DOM outcomes, from the application's presentation protocol.
  for (const event of presentation?.ledgerEvents ?? []) ledger.record(event)
  return ledger
}

async function runArm({ arm, pair, mode, options, fixture, outDir }) {
  const cacheRoot = join(outDir, 'cache', `${pair}-${arm.name}-${mode}`)
  assertCacheScope(cacheRoot, `${arm.name}/${mode} cache root`)
  mkdir(cacheRoot)
  mkdir(join(cacheRoot, 'webview'))
  const port = options.portBase + pair * 4 + (arm.side === 'baseline' ? 0 : 2) + (mode === 'warm' ? 1 : 0)
  const record = {
    schemaVersion: SCHEMA_VERSION,
    pair, arm: arm.name, side: arm.side, mode, port, cacheRoot,
    startedAt: new Date().toISOString(),
    actions: [], finalState: null, cache: null, screenshots: [], errors: [],
  }

  const launched = await launchArm({
    executable: arm.executable,
    cacheRoot,
    playlistPath: options.playlist,
    port,
    extraEnv: { RUST_LOG: options.rustLog },
  })
  let cdp = null
  const recorder = new LaneRecorder()
  try {
    cdp = await launched.connect()
    await cdp.send('Network.enable')
    recorder.install(cdp)
    // The URL the WebView actually loaded is the authoritative production-vs-dev
    // signal; a binary built without `custom-protocol` serves from localhost:5173.
    record.serving = runtimeServingFacts(cdp.targetUrl)
    if (!record.serving.comparableReleaseArtifact) {
      throw new Error(
        `${arm.name}: WebView loaded ${cdp.targetUrl}, which is not the custom protocol. ` +
        'Build with `npx tauri build --no-bundle`; a bare `cargo build --release` omits the ' +
        'custom-protocol feature and is not a comparable release artifact.',
      )
    }
    record.viewport = await pinViewport(cdp, {
      width: fixture.viewportWidth, height: fixture.viewportHeight, deviceScaleFactor: options.dpr,
    })
    if (!await waitForOpenControl(cdp)) throw new Error('open-audio control never appeared')

    // ---- 1. instrumentation installed BEFORE any measured input ------------
    // `pageInstallScript` only attaches observers/observers and wraps a few
    // globals; it performs no DOM interaction and starts no image request.
    record.instrumentation = await cdp.evaluate(pageInstallScript())

    // ---- 2. prerequisite: source load (NOT a measured action) -------------
    // The native picker is replaced by the registered isolation patch, so this
    // press returns the fixture playlist instead of opening a dialog. A real user
    // spends thinking time in that dialog; the plan allows excluding it, and both
    // arms start from the same place afterwards.
    recorder.beginWindow()
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
    record.prerequisite = { sourceLoad, network: recorder.snapshot() }
    if (sourceLoad.error) throw new Error(`source prerequisite failed: ${sourceLoad.error}`)
    // Let the music scan settle so the measured action measures the LIST, not the
    // scan. This interval is outside every measured window by construction.
    await sleep(options.settleMs)

    // ---- 3. measured actions ----------------------------------------------
    const labels = fixture.labels || {}
    for (const actionName of options.actions) {
      if (actionName === 'open') {
        recorder.beginWindow()
        const spec = {
          name: 'open-list',
          mode: 'cohort',
          cohort: fixture.cohort.ids,
          labels,
          budgetMs: options.budgetMs,
          opacityThreshold: fixture.opacityThreshold,
          requiredFrames: fixture.requiredFrames,
        }
        const result = await cdp.evaluate(`(${pageActionScript(ACTION_OPEN_LIST)})(${JSON.stringify(spec)})`)
        const entry = { ...result }
        entry.network = recorder.snapshot({
          ledger: buildLedger({
            records: recorder.records(),
            presentation: result.presentation,
            ownerSession: `${pair}-${arm.name}-${mode}-open`,
          }),
          cacheMode: mode,
        })
        if (options.screenshots) {
          mkdir(join(outDir, 'screenshots'))
          entry.screenshot = await captureScreenshot(
            cdp, join(outDir, 'screenshots', `${pair}-${arm.name}-${mode}-open.png`), writeFileSync,
          )
        }
        record.actions.push(entry)
      } else if (actionName === 'leave') {
        recorder.beginWindow()
        const spec = {
          name: 'leave-list',
          mode: 'cohort',
          cohort: fixture.cohort.ids,
          labels,
          budgetMs: options.budgetMs,
          opacityThreshold: fixture.opacityThreshold,
          requiredFrames: fixture.requiredFrames,
        }
        const result = await cdp.evaluate(`(${pageActionScript(ACTION_LEAVE_LIST)})(${JSON.stringify(spec)})`)
        const leaveEntry = { ...result }
        leaveEntry.network = recorder.snapshot({
          ledger: buildLedger({
            records: recorder.records(),
            presentation: result.presentation,
            ownerSession: `${pair}-${arm.name}-${mode}-leave`,
          }),
          cacheMode: mode,
        })
        record.actions.push(leaveEntry)
        // Re-open so a following action still has a list. Not measured.
        const reopened = await ensureListPanel(cdp, { settleMs: 1500 })
        record.prerequisites = [...(record.prerequisites || []), { action: actionName, listPanel: reopened }]
      } else if (actionName.startsWith('scroll')) {
        const programName = actionName.includes(':') ? actionName.split(':')[1] : 'slow'
        const program = SCROLL_PROGRAMS[programName]
        if (!program) throw new Error(`unknown scroll programme ${programName}; known: ${Object.keys(SCROLL_PROGRAMS).join(', ')}`)
        // The list must be open before scrolling. Opening it is a prerequisite,
        // not a measured action, so it is retried and kept outside the window.
        const reopened = await ensureListPanel(cdp, { settleMs: 1500 })
        if (reopened.failed) throw new Error(`cannot open the list before scrolling: ${JSON.stringify(reopened.attemptsLog)}`)
        record.prerequisites = [...(record.prerequisites || []), { action: actionName, listPanel: reopened }]
        await sleep(800)
        recorder.beginWindow()
        const spec = {
          name: `scroll-${programName}`,
          mode: 'exposure',
          cohort: [],
          universe: fixture.universe.ids,
          labels,
          budgetMs: options.budgetMs,
          stopBudgetMs: options.stopBudgetMs,
          opacityThreshold: fixture.opacityThreshold,
          requiredFrames: fixture.requiredFrames,
          program,
        }
        const result = await cdp.evaluate(`(${pageActionScript(ACTION_SCROLL)})(${JSON.stringify(spec)})`)
        const entry = { ...result }
        entry.network = recorder.snapshot({
          ledger: buildLedger({
            records: recorder.records(),
            presentation: result.presentation,
            ownerSession: `${pair}-${arm.name}-${mode}-scroll-${programName}`,
          }),
          cacheMode: mode,
        })
        if (options.screenshots) {
          mkdir(join(outDir, 'screenshots'))
          entry.screenshot = await captureScreenshot(
            cdp, join(outDir, 'screenshots', `${pair}-${arm.name}-${mode}-scroll-${programName}.png`), writeFileSync,
          )
        }
        record.actions.push(entry)
        await cdp.evaluate(`(() => { const panel = document.querySelector('.playlist-panel'); if (panel) panel.scrollTop = 0; return true })()`)
        await sleep(600)
      } else {
        throw new Error(`unknown action ${actionName}`)
      }
    }

    record.finalState = await cdp.evaluate(PAGE_FINAL_STATE)
    record.cache = cacheSnapshot(cacheRoot)
  } catch (error) {
    record.errors.push(String(error && error.stack ? error.stack : error))
    writeJson(join(outDir, 'arms', `${pair}-${arm.name}-${mode}.json`), record)
    throw error
  } finally {
    if (cdp) await closeViaApp(cdp)
    if (cdp) cdp.close()
    const shutdown = await launched.shutdown()
    record.exitCode = shutdown.exitCode
    writeFileSync(join(outDir, 'logs', `${pair}-${arm.name}-${mode}.log`), shutdown.logs || '')
    writeJson(join(outDir, 'arms', `${pair}-${arm.name}-${mode}.json`), record)
  }
  return record
}

/**
 * New-metric versus old-metric decomposition, computed from one recorded action.
 *
 * What the old script actually did (D:\opt0018-ab\ab-run.mjs, `run()` +
 * `FIRST_SCREEN`): click the list control, `await sleep(150)`, then
 * `waitForGrid()` (which polls for `.playlist-panel .playlist-grid` plus at least
 * one `[data-playlist-track-id]`), and only THEN took `t0`. Its `settleMs` is
 * therefore "grid+first card present → every in-view card revealed". Everything
 * before that point -- the click itself, the panel mount, the grid mount and the
 * artificial 150 ms sleep -- was outside its clock entirely.
 *
 * On the new timeline that quantity is exactly
 * `allCoverReadyMs - firstCardMs`. The gap between it and the new end-to-end
 * figure is the time the old script never measured.
 */
export function decomposeAction(action) {
  const marks = action.marks || {}
  const summary = action.summary || {}
  const firstCard = marks.firstCardMs ?? null
  const panelVisible = marks.panelVisibleMs ?? null
  const gridVisible = marks.gridVisibleMs ?? null
  const firstCover = summary.firstCoverMs ?? null
  const allReady = summary.allCoverReadyMs ?? null
  const oldSettle = allReady !== null && firstCard !== null ? allReady - firstCard : null
  const clickToFirstCard = firstCard
  return {
    oldMetric: {
      definition:
        'settleMs in D:\\opt0018-ab\\ab-run.mjs: t0 taken AFTER a 150 ms sleep and AFTER waitForGrid(), ' +
        'so the clock starts once the grid and its first card already exist',
      measuredEquivalentMs: oldSettle,
      excludedBeforeClockMs: clickToFirstCard,
      excludedBreakdown: {
        clickToPanelMs: panelVisible,
        panelToGridMs: panelVisible !== null && gridVisible !== null ? gridVisible - panelVisible : null,
        gridToFirstCardMs: gridVisible !== null && firstCard !== null ? firstCard - gridVisible : null,
        artificialSleepMs: 150,
      },
    },
    newMetric: {
      definition: 'performance.now() immediately before the click, to the last proxy-ready has-cover card',
      actionToFirstCoverMs: firstCover,
      actionToAllCoverReadyMs: allReady,
    },
    segments: {
      clickToPanelMs: panelVisible,
      panelToGridMs: panelVisible !== null && gridVisible !== null ? gridVisible - panelVisible : null,
      clickToGridMs: gridVisible,
      gridToFirstCardMs: gridVisible !== null && firstCard !== null ? firstCard - gridVisible : null,
      clickToFirstCardMs: firstCard,
      firstCardToFirstCoverMs: firstCover !== null && firstCard !== null ? firstCover - firstCard : null,
      firstCardToAllCoverReadyMs: oldSettle,
      clickToEndMs: marks.endMs ?? action.elapsedMs ?? null,
    },
    /** How much the old metric under-reports, and as a share of the true total. */
    underReport: {
      absoluteMs: allReady !== null && oldSettle !== null ? allReady - oldSettle : null,
      fraction: allReady !== null && oldSettle !== null && allReady > 0 ? (allReady - oldSettle) / allReady : null,
    },
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.baseline || !options.candidate || !options.fixture || !options.playlist || !options.out) {
    throw new Error(`missing required arguments\n\n${USAGE}`)
  }
  const fixturePath = resolve(options.fixture)
  if (!existsSync(fixturePath)) throw new Error(`fixture not found: ${fixturePath}`)
  const fixtureRaw = JSON.parse(readFileSync(fixturePath, 'utf8'))
  if (!fixtureRaw.cohort?.ids?.length) throw new Error('fixture has no cohort ids; rebuild it with coverlane-fixtures.mjs')
  if (!fixtureRaw.universe?.ids?.length) throw new Error('fixture has no universe ids; rebuild it with coverlane-fixtures.mjs')
  const viewport = options.viewport
    ? options.viewport.split('x').map(Number)
    : [fixtureRaw.viewport?.requested?.width ?? 1600, fixtureRaw.viewport?.requested?.height ?? 1000]
  const fixture = {
    viewportWidth: viewport[0],
    viewportHeight: viewport[1],
    cohort: fixtureRaw.cohort,
    universe: fixtureRaw.universe,
    labels: fixtureRaw.labels || {},
    opacityThreshold: fixtureRaw.cohort.opacityThreshold,
    requiredFrames: fixtureRaw.cohort.requiredConsecutiveFrames,
  }

  const outDir = requireFresh(options.out, 'output directory')
  mkdir(outDir)
  mkdir(join(outDir, 'arms'))
  mkdir(join(outDir, 'logs'))
  mkdir(join(outDir, 'screenshots'))

  const baseline = { name: 'baseline', side: 'baseline', executable: resolve(options.baseline) }
  const candidate = { name: 'candidate', side: 'candidate', executable: resolve(options.candidate) }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'coverlane-ab',
    label: options.label,
    startedAt: new Date().toISOString(),
    harness: { scriptsSha256: hashHarness(), node: process.version },
    git: gitFacts(),
    host: hostFacts(),
    artifacts: { baseline: artifactFacts(baseline.executable), candidate: artifactFacts(candidate.executable) },
    fixture: {
      path: fixturePath,
      sha256: sha256File(fixturePath),
      fixtureDigest: fixtureRaw.fixtureDigest,
      cohortSize: fixtureRaw.cohort.ids.length,
      universeSize: fixtureRaw.universe.ids.length,
      labels: fixtureRaw.labelSplit,
      opacityThreshold: fixture.opacityThreshold,
      requiredFrames: fixture.requiredFrames,
      caveats: fixtureRaw.caveats || [],
    },
    playlist: { path: resolve(options.playlist), sha256: sha256File(options.playlist) },
    protocol: {
      pairs: options.pairs,
      modes: options.modes,
      actions: options.actions,
      viewport: { width: viewport[0], height: viewport[1], dpr: options.dpr },
      order: 'odd pair baseline first, even pair candidate first',
      cacheRoots: 'one root per (pair, arm, mode) under LOCALAPPDATA so the $CACHE asset scope holds',
      warmDefinition: 'same cache root reused with a NEW process and a NEW WebView2 profile (disk reuse, not in-process cache)',
      isolation: 'registered build-time patches only: AppPaths -> THUMB_UI_ROOT, native picker -> THUMB_UI_PLAYLIST; no scheduling, rendering, IPC or timing change',
      t0Rule: 'performance.now() immediately before click/scroll inside the SAME Runtime.evaluate call; never re-based after a wait',
      visibilityProxy: 'decoded image + opacity >= threshold + clipped area > 0 + N consecutive animation frames + key-moment screenshot. This is NOT a GPU-composite or screen-present measurement.',
      hasCoverSplit: 'all-cover-complete is computed over the has-cover class only; no-cover cards keep their own denominator and cannot complete it early',
      diagnostics: { rustLog: options.rustLog },
      prewarm: 'none; the prerequisite music scan runs before every measured window and is excluded by construction',
      settleOutsideMeasuredWindowsMs: options.settleMs,
    },
    caveats: [
      'OS file cache is uncontrolled. "fresh" means a virgin app cache root, not a cold OS cache.',
      'The readiness predicate is a visible proxy; GPU compositing and screen present are not observed.',
      'No-cover placeholder parity is only covered when the fixture contains labelled no-cover entries.',
      'One process cannot provide two independent cold starts; fresh/warm are separate modes with separate roots.',
      'Fallback is counted from scheduling-boundary events. This harness observes the lane commands and the ' +
        'application presentation events; it does NOT see the frontend recovery出口, so fallback stays 0 unless ' +
        'a future instrumentation seam reports recoveryStarted. Zero therefore means "no recovery observed", ' +
        'not "recovery proven impossible".',
      'The measured list panel (PlaylistPanel) does not pass a coverPresentation token, so DOM cover events are ' +
        'counted but not attributable to a publication. See presentation.tokensSeen: 0 means unattributable.',
      'Byte figures are observed response payloads, not wire cost. No cross-lane multiplier is claimed; see ' +
        'summary.byteComparability for the generated verdict.',
    ],
  }
  writeJson(join(outDir, 'manifest.json'), manifest)

  const rows = []
  for (let pair = 1; pair <= options.pairs; pair++) {
    const order = pair % 2 === 1 ? [baseline, candidate] : [candidate, baseline]
    for (const mode of options.modes) {
      for (const arm of order) {
        const record = await runArm({ arm, pair, mode, options, fixture, outDir })
        for (const action of record.actions) {
          rows.push({
            pair, arm: arm.name, mode, action: action.name, actionMode: action.mode,
            t0RecordedBeforeInput: action.t0RecordedBeforeInput,
            t0ToFirstInputMs: action.t0ToFirstInputMs,
            lastInputAtMs: action.lastInputAtMs,
            marks: action.marks,
            summary: action.summary,
            counters: action.counters,
            longTasks: action.longTasks,
            frameIntervals: action.frameIntervals,
            samplerCost: action.samplerCost,
            samples: action.samples,
            network: {
              ipcTotals: action.network.ipcTotals,
              asset: action.network.asset,
              ipcByCommand: action.network.ipc.map(b => ({
                command: b.command, lane: b.lane, kind: b.kind,
                nativeRequests: b.nativeRequests, ok: b.ok, nonOkStatus: b.nonOkStatus,
                failed: b.failed, canceled: b.canceled,
                decodedBytes: b.decodedBytes, encodedBytes: b.encodedBytes, requestBytes: b.requestBytes,
                durationP50Ms: b.durationP50Ms, durationP95Ms: b.durationP95Ms,
              })),
              /**
               * Cross-check only. `workloads.bothLaneWorkloads` is a shape, not a
               * fallback count; the authoritative number is `ledger.fallbacks.count`.
               */
              crossCheck: {
                notAuthoritative: action.network.laneAttempts.notAuthoritative,
                distinctAttempts: action.network.laneAttempts.laneAttempts.distinctAttempts,
                byLane: action.network.laneAttempts.laneAttempts.byLane,
                byKind: action.network.laneAttempts.laneAttempts.byKind,
                byClient: action.network.laneAttempts.laneAttempts.byClient,
                bothLaneWorkloads: action.network.laneAttempts.workloads.bothLaneWorkloads,
                bothLaneAcrossClientsOnly: action.network.laneAttempts.workloads.bothLaneAcrossClientsOnly,
                unmatched: action.network.laneAttempts.unmatched,
              },
              /** Authoritative fallback / DOM-failure accounting. */
              ledger: action.network.ledger,
              /** Per-command and per-request byte detail; no ratio is implied. */
              commandBytes: action.network.commandBytes,
            },
            decomposition: decomposeAction(action),
            serving: record.serving,
            presentation: action.presentation ?? null,
            finalState: {
              cardCount: record.finalState?.cardCount ?? null,
              schemes: record.finalState?.schemes ?? null,
              states: record.finalState?.states ?? null,
              grid: record.finalState?.grid ?? null,
              counters: record.finalState?.counters ?? null,
            },
            cache: record.cache,
            errors: [...(action.errors || []), ...(record.errors || [])],
          })
        }
        writeJson(join(outDir, 'results.json'), rows)
        console.log(JSON.stringify({
          pair, arm: arm.name, mode,
          actions: record.actions.map(a => ({
            name: a.name,
            t0ToFirstInputMs: a.t0ToFirstInputMs,
            firstCoverMs: a.summary?.firstCoverMs ?? null,
            allCoverReadyMs: a.summary?.allCoverReadyMs ?? null,
            hasCover: a.summary?.hasCover ? { count: a.summary.hasCover.count, ready: a.summary.hasCover.ready } : null,
            cohort: a.summary?.targetCount ?? null,
            ipcRequests: a.network.ipcTotals.nativeRequests,
            ipcBytes: a.network.ipcTotals.decodedBytes,
            assetRequests: a.network.asset.nativeRequests,
            assetBytes: a.network.asset.encodedBytes,
            fallbacks: a.network.ledger?.fallbacks?.count ?? null,
            domFailures: a.network.ledger?.domFailure?.count ?? null,
            bmpCalls: a.counters?.bmpCreateObjectUrl ?? null,
            domErrors: a.summary?.domErrors ?? null,
          })),
          schemes: record.finalState?.schemes ?? null,
          cacheDisk: record.cache ? { total: record.cache.total, byExtension: record.cache.byExtension } : null,
        }))
      }
    }
  }

  const summary = buildSummary(rows)
  writeJson(join(outDir, 'summary.json'), summary)
  console.log('DONE ' + join(outDir, 'results.json'))
  console.log(JSON.stringify(summary.byAction, null, 2))
}

function describe(values) {
  if (!values.length) return { n: 0, mean: null, min: null, max: null, p50: null }
  const sorted = [...values].sort((a, b) => a - b)
  return {
    n: sorted.length,
    mean: Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2)),
    min: Number(sorted[0].toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    p50: Number(percentile(sorted, 0.5).toFixed(2)),
  }
}

function numbers(list, getter) {
  return list.map(getter).filter(v => typeof v === 'number' && Number.isFinite(v))
}

function buildSummary(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = `${row.action}|${row.mode}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const byAction = []
  for (const [key, group] of groups) {
    const [action, mode] = key.split('|')
    const base = group.filter(r => r.arm === 'baseline')
    const cand = group.filter(r => r.arm === 'candidate')
    const sideSummary = list => ({
      t0ToFirstInputMs: describe(numbers(list, r => r.t0ToFirstInputMs)),
      actionToAllCoverReadyMs: describe(numbers(list, r => r.summary?.allCoverReadyMs)),
      actionToFirstCoverMs: describe(numbers(list, r => r.summary?.firstCoverMs)),
      oldMetricEquivalentMs: describe(numbers(list, r => r.decomposition?.oldMetric?.measuredEquivalentMs)),
      underReportMs: describe(numbers(list, r => r.decomposition?.underReport?.absoluteMs)),
      underReportFraction: describe(numbers(list, r => r.decomposition?.underReport?.fraction)),
      segments: {
        clickToPanelMs: describe(numbers(list, r => r.decomposition?.segments?.clickToPanelMs)),
        clickToGridMs: describe(numbers(list, r => r.decomposition?.segments?.clickToGridMs)),
        clickToFirstCardMs: describe(numbers(list, r => r.decomposition?.segments?.clickToFirstCardMs)),
        firstCardToFirstCoverMs: describe(numbers(list, r => r.decomposition?.segments?.firstCardToFirstCoverMs)),
      },
    })
    byAction.push({ action, mode, pairCount: new Set(group.map(r => r.pair)).size, baseline: sideSummary(base), candidate: sideSummary(cand) })
  }

  const correctness = rows.map(row => ({
    pair: row.pair, arm: row.arm, mode: row.mode, action: row.action,
    t0RecordedBeforeInput: row.t0RecordedBeforeInput,
    cohort: row.summary?.targetCount ?? null,
    exposed: row.summary?.exposedCount ?? null,
    ready: row.summary?.ready ?? null,
    notReady: row.summary?.notReady ?? null,
    censoredOffscreen: row.summary?.censoredOffscreen ?? null,
    hasCoverCount: row.summary?.hasCover?.count ?? null,
    hasCoverReady: row.summary?.hasCover?.ready ?? null,
    noCoverCount: row.summary?.noCover?.count ?? null,
    domErrors: row.summary?.domErrors ?? null,
    identityMismatches: row.summary?.identityMismatches ?? null,
    blankAreaMsTotal: Math.round(row.summary?.blankAreaMsTotal ?? 0),
    pathAttempts: row.network.crossCheck.byLane?.path ?? 0,
    pixelAttempts: row.network.crossCheck.byLane?.pixels ?? 0,
    /** Authoritative, from the scheduling-boundary ledger. */
    fallbackCount: row.network.ledger?.fallbacks?.count ?? null,
    fallbackCompleted: row.network.ledger?.fallbacks?.completed ?? null,
    fallbackFailed: row.network.ledger?.fallbacks?.failed ?? null,
    fallbackInFlight: row.network.ledger?.fallbacks?.inFlight ?? null,
    domFailureCount: row.network.ledger?.domFailure?.count ?? null,
    domUnattributed: row.presentation?.unattributed?.length ?? null,
    staleAbortCount: row.network.ledger?.cancel?.count ?? null,
    breakerCount: row.network.ledger?.breaker?.count ?? null,
    /** Cross-check diagnostic only: both lanes appeared for one workload. */
    bothLaneWorkloads: row.network.crossCheck.bothLaneWorkloads,
    bothLaneAcrossClientsOnly: row.network.crossCheck.bothLaneAcrossClientsOnly,
    unmatchedRequests: row.network.crossCheck.unmatched?.count ?? null,
    missingVerdicts: (row.network.ledger?.eventCounts?.pathMissing ?? null),
    assetRequests: row.network.asset.nativeRequests,
    assetForbidden: row.network.asset.forbiddenOrProtocolError,
    assetAllInScope: row.network.asset.allUrlsInsideCacheRoot,
    ipcNonOk: row.network.ipcTotals.nonOkStatus,
    ipcFailed: row.network.ipcTotals.failed,
    ipcCanceled: row.network.ipcTotals.canceled,
    ipcDecodedBytes: row.network.ipcTotals.decodedBytes,
    assetEncodedBytes: row.network.asset.encodedBytes,
    longTasksOver50: row.longTasks?.over50Ms ?? null,
    framesOver50: row.frameIntervals?.over50Ms ?? null,
    bmpCalls: row.counters?.bmpCreateObjectUrl ?? null,
    bmpBytes: row.counters?.bmpBytes ?? null,
    schemes: row.finalState?.schemes ?? null,
    errors: row.errors?.length ?? 0,
  }))

  /**
   * Byte comparability verdict per action and cache mode.
   *
   * The plan forbids quoting a multiplier when the two arms read through
   * different lanes or with different request counts. This block is generated
   * from the recorded data rather than written by hand, so a report cannot quietly
   * restate the old "about 1500x per cover" claim.
   */
  const byteComparability = []
  for (const [key, group] of groups) {
    const [action, mode] = key.split('|')
    const baselineRow = group.find(row => row.arm === 'baseline')
    const candidateRow = group.find(row => row.arm === 'candidate')
    if (!baselineRow || !candidateRow) continue
    byteComparability.push({
      action,
      mode,
      ...assessByteComparability({
        baseline: baselineRow.network.commandBytes,
        candidate: candidateRow.network.commandBytes,
        cacheMode: mode,
      }),
    })
  }

  return { generatedAt: new Date().toISOString(), byAction, correctness, byteComparability }
}

await main()
