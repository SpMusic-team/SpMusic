#!/usr/bin/env node
// scroll-probe — 拖动/滚动媒体库歌曲列表时的分段耗时实测。
//
// 与既有 run.mjs（测「首行出现」）的分工：本探针测的是列表已经在屏幕上之后，
// 用户连续拖动/滚动到列表底部这段过程的成本。
//
// 复用（不修改）tools/perf-regression/lib 与 run.mjs 的既有契约：
//   * lib/fixture.mjs   —— 打桩原生 IPC（window.backendInvoke）、固定延迟模型 MODEL、
//                          window.__PERF__ 计量、window.__PERF_VM__ 视图模型、
//                          window.__PERF_OPEN_START__ 首屏取样器
//   * lib/harness.mjs   —— 独立端口的 dev server、origin 校验、Edge 启动、统计函数
//   * vite.perf.config.mts
//
// 新增的（全部注入在 page.evaluate / CDP 侧完成，不改 src/ 也不改 lib/）：
//   1. 真实滚轮输入 page.mouse.wheel(deltaY ≈ 面板视口 1/3, 16ms 间隔)，按距离分 6 个相位
//   2. rAF 间隔分布 + PerformanceObserver('longtask')
//   3. CDP Performance.getMetrics 的 Task/Script/Layout/RecalcStyle 增量（每相位）
//   4. CDP Tracing（devtools.timeline…）→ UpdateLayoutTree/Layout/Paint 的 count 与 cpuMs，
//      以及 UpdateLayoutTree.elementCount（每帧重算了多少元素样式）
//   5. IntersectionObserver(root=panel) 逐行记录「进入视口 → 封面 img 有可用像素」延迟
//   6. 每 6 帧采样一次已挂载 [data-playlist-track-id] 数量 —— 渲染窗口曲线
//
// 打桩边界（与 run.mjs 完全一致，结论里必须带）：
//   只有原生 IPC（Rust 进程 + 文件系统）是假的；React 组件、列表窗口、封面调度器、
//   SPXR 解码与 BMP/objectURL 管线都是生产代码。绝对数不代表真机。
//
// 用法：
//   $env:SPMUSIC_PLAYWRIGHT = 'C:\Users\winkeses\.dsh\tools\node_repl\node_modules\playwright'
//   node tools/perf-regression/scroll-probe.mjs --worktree D:\SpMusic `
//     --sizes 900,1800 --views library-l4,library-l1,playlist --repeat 3 `
//     --out tools/perf-regression/results/current/scroll-1800.json
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MODEL, buildFixtureModule, buildSurfaceProbeModule, patchedAudioCommands } from './lib/fixture.mjs'
import {
  gitHead, gitIsDirty, gitSubject, loadPlaywright,
  resolveBrowserExecutable, startDevServer, summarize, verifyOrigin,
} from './lib/harness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PERF_CONFIG = path.join(HERE, 'vite.perf.config.mts')

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf('--' + name)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}
const worktreePath = path.resolve(flag('worktree', process.cwd()))
const outPath = flag('out', path.join(HERE, 'results', 'current', 'scroll-probe.json'))
const repeat = Number(flag('repeat', '3'))
const repeatSecondary = Number(flag('repeat-secondary', '2'))
const segments = Math.max(1, Number(flag('segments', '6')))
const pauseMs = Number(flag('pause', '1000'))
const stepRatio = Number(flag('step-ratio', String(1 / 3)))
const cpuRates = flag('cpu-rates', '1').split(',').map(Number).filter(Boolean)
const sizes = flag('sizes', '900,1800').split(',').map(Number)
const viewNames = flag('views', 'library-l4,library-l1,playlist').split(',').map(item => item.trim()).filter(Boolean)
const viewport = { width: Number(flag('width', '1600')), height: Number(flag('height', '1000')) }
const intervalMs = Number(flag('interval', '16'))

const LIBRARY_ROOT = '/perf/library'
const log = message => console.log('[scroll-probe] ' + message)

// 视图矩阵：
//   library-l4 媒体库「所有歌曲」，布局 4 = 单列中封面（应用真实默认值，全库 >100 首）→ 渲染窗口启用
//   library-l1 媒体库「所有歌曲」，布局 1 = 三列封面 tile（既有 baseline 固定布局）→ 窗口禁用、全量挂载
//   playlist   播放列表详情页 PlaylistPanel，布局 0 = 两列大封面（宽屏默认）→ 全量挂载
const COVER_IMAGE = 'img.playlist-card-cover-image, img.playlist-card-cover-image-eager, .playlist-card-cover img'
const VIEWS = {
  'library-l4': { kind: 'library', layoutLevel: 4, primary: true,
    selector: { panel: '.playlist-management-content', grid: '.playlist-grid.all-songs-list', card: '[data-playlist-track-id]', image: COVER_IMAGE } },
  'library-l1': { kind: 'library', layoutLevel: 1, primary: false,
    selector: { panel: '.playlist-management-content', grid: '.playlist-grid.all-songs-list', card: '[data-playlist-track-id]', image: COVER_IMAGE } },
  playlist: { kind: 'playlist', layoutLevel: 0, primary: false,
    selector: { panel: '.playlist-panel', grid: '.playlist-grid', card: '[data-playlist-track-id]', image: COVER_IMAGE } },
}

const SELECTORS = { shell: '.player-shell' }

// ---------------------------------------------------------------------------
// 页面内探针：只读 DOM、不改 DOM、不碰 React 状态，因此不改变被测代码路径。
// 由 page.evaluate(installProbe, options) 安装，暴露 window.__SCROLL_PROBE__。
// ---------------------------------------------------------------------------
function installProbe(options) {
  const S = options.selector
  const state = {
    phase: 'install',
    panel: null,
    grid: null,
    frames: [],
    longTasks: [],
    samples: [],
    rows: [],
    byKey: new Map(),
    observed: new Map(),
    capture: false,
    lastTime: null,
    tick: 0,
    sampleEvery: options.sampleEvery || 6,
    lastCardCount: -1,
    dockInset: 0,
    anchorPageTime: null,
    maxRows: options.maxRows || 5000,
    errors: [],
    center: { x: 0, y: 0 },
  }
  const now = () => performance.now()
  const round2 = value => Math.round(value * 100) / 100
  const cardsOf = () => (state.grid ?? state.panel)?.querySelectorAll(S.card) ?? []
  const keyOf = element => element?.dataset?.playlistTrackId || element?.dataset?.songKey || ''
  const imageOf = element => element?.querySelector(S.image) || element?.querySelector('img') || null
  const pixelsReady = image => Boolean(image && image.complete && image.naturalWidth > 0)

  function measureContainers() {
    state.panel = document.querySelector(S.panel)
    state.grid = state.panel ? (state.panel.matches(S.grid) ? state.panel : state.panel.querySelector(S.grid)) : null
    if (!state.panel) return false
    const rect = state.panel.getBoundingClientRect()
    state.center = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
    const dock = document.querySelector('.playlist-playback-dock')
    if (dock) {
      const dockRect = dock.getBoundingClientRect()
      const panelRect = state.panel.getBoundingClientRect()
      if (dockRect.height > 0 && dockRect.top > panelRect.top && dockRect.top < panelRect.bottom
        && dockRect.bottom > panelRect.bottom - 40) {
        state.dockInset = Math.max(0, Math.min(240, Math.round(panelRect.bottom - dockRect.top)))
      }
    }
    return true
  }

  function rowFor(key) {
    let row = state.byKey.get(key)
    if (row) return row
    if (state.rows.length >= state.maxRows) return null
    row = {
      key, mountAt: round2(now()), mountPhase: state.phase,
      enterAt: null, enterPhase: null, readyAt: null, readyPhase: null,
      readyAtEntry: null, missed: false, exitAt: null,
      mountToEnterMs: null, readyDelayMs: null, element: null,
    }
    state.byKey.set(key, row)
    state.rows.push(row)
    return row
  }

  let observer = null
  function ensureObserver() {
    if (observer || !state.panel) return
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const element = entry.target
        const row = state.byKey.get(keyOf(element))
        if (!row) continue
        if (entry.isIntersecting) {
          if (row.enterAt !== null) continue
          row.enterAt = round2(entry.time || now())
          row.enterPhase = state.phase
          row.element = element
          row.mountToEnterMs = round2(row.enterAt - row.mountAt)
          if (pixelsReady(imageOf(element))) {
            row.readyAtEntry = true
            row.readyAt = row.enterAt
            row.readyPhase = row.enterPhase
            row.readyDelayMs = 0
          } else {
            row.readyAtEntry = false
          }
        } else if (row.enterAt !== null && row.readyAt === null) {
          // 行离开视口时封面仍未就绪：用户看到的是空白封面，单独计数。
          row.missed = true
          row.exitAt = round2(now())
        }
      }
    }, { root: state.panel, threshold: 0, rootMargin: `0px 0px -${state.dockInset}px 0px` })
    observeAll(true)
  }

  function observeAll(force) {
    const cards = cardsOf()
    const count = cards.length
    const countChanged = count !== state.lastCardCount
    state.lastCardCount = count
    if (!force && !countChanged) return count
    for (let i = 0; i < cards.length; i += 1) {
      const element = cards[i]
      const key = keyOf(element)
      if (!key) continue
      const row = rowFor(key)
      if (!row) continue
      if (row.element !== element) row.element = element
      if (state.observed.get(key) !== element) {
        state.observed.set(key, element)
        observer?.observe(element)
      }
    }
    return count
  }

  function resolvePending(time) {
    let pending = 0
    const rows = state.rows
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      if (row.enterAt === null || row.readyAt !== null || row.missed) continue
      const element = row.element
      if (!element) continue
      pending += 1
      if (!element.isConnected) { row.missed = true; continue }
      if (!pixelsReady(imageOf(element))) continue
      row.readyAt = round2(time)
      row.readyPhase = state.phase
      row.readyDelayMs = round2(row.readyAt - row.enterAt)
    }
    return pending
  }

  function sampleCamera(time) {
    if (!state.panel || !state.panel.isConnected) measureContainers()
    if (!state.panel) return
    const cards = observeAll(false)
    state.samples.push({
      phase: state.phase,
      t: round2(time),
      scrollTop: Math.round(state.panel.scrollTop),
      scrollHeight: state.panel.scrollHeight,
      clientHeight: state.panel.clientHeight,
      cards,
      pending: resolvePending(time),
    })
  }

  function frame(time) {
    if (!state.capture) { state.loopRunning = false; return }
    if (state.lastTime !== null) state.frames.push({ phase: state.phase, dt: round2(time - state.lastTime), t: round2(time) })
    state.lastTime = time
    state.tick += 1
    if (state.tick % state.sampleEvery === 0) sampleCamera(time)
    else resolvePending(time)
    requestAnimationFrame(frame)
  }

  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        state.longTasks.push({ phase: state.phase, duration: round2(entry.duration), startTime: round2(entry.startTime) })
      }
    }).observe({ entryTypes: ['longtask'] })
  } catch (error) { state.errors.push(String(error)) }

  function phaseSlice(name) {
    return {
      frames: state.frames.filter(item => item.phase === name),
      longTasks: state.longTasks.filter(item => item.phase === name),
      samples: state.samples.filter(item => item.phase === name),
    }
  }

  window.__SCROLL_PROBE__ = {
    install() {
      if (!measureContainers()) return { ok: false, error: 'panel not found: ' + S.panel }
      ensureObserver()
      const cards = observeAll(true)
      return {
        ok: true,
        cards,
        dockInset: state.dockInset,
        center: state.center,
        scrollHeight: state.panel.scrollHeight,
        clientHeight: state.panel.clientHeight,
        scrollTop: state.panel.scrollTop,
      }
    },
    begin(name) {
      if (!measureContainers()) return { ok: false, error: 'panel not found' }
      if (!observer) ensureObserver()
      observeAll(true)
      state.phase = name
      state.lastTime = null
      state.capture = true
      if (!state.loopRunning) {
        state.loopRunning = true
        requestAnimationFrame(frame)
      }
      if (state.anchorPageTime === null) {
        state.anchorPageTime = round2(now())
        performance.mark('scroll-probe-anchor')
      }
      performance.mark('scroll-probe:' + name + ':start')
      let withPixels = 0
      for (const element of cardsOf()) if (pixelsReady(imageOf(element))) withPixels += 1
      return { ok: true, phase: name, cards: state.lastCardCount, cardsWithPixels: withPixels,
        scrollTop: state.panel.scrollTop, scrollHeight: state.panel.scrollHeight,
        clientHeight: state.panel.clientHeight }
    },
    end(name) {
      state.capture = false
      performance.mark('scroll-probe:' + name + ':end')
      let withPixels = 0
      let transparentReady = 0
      for (const element of cardsOf()) {
        const image = imageOf(element)
        if (!pixelsReady(image)) continue
        withPixels += 1
        if (Number(getComputedStyle(image).opacity) < 0.99) transparentReady += 1
      }
      return { ok: true, phase: name, cards: state.lastCardCount, cardsWithPixels: withPixels,
        transparentReady, phaseSlice: phaseSlice(name),
        scrollTop: state.panel.scrollTop, scrollHeight: state.panel.scrollHeight,
        clientHeight: state.panel.clientHeight }
    },
    setScrollTop(value) {
      if (!state.panel) measureContainers()
      if (!state.panel) return null
      state.panel.scrollTop = value
      return state.panel.scrollTop
    },
    nudge(delta) {
      if (!measureContainers()) return null
      state.panel.scrollTop += delta
      return state.panel.scrollTop
    },
    state() {
      return {
        anchorPageTime: state.anchorPageTime,
        frames: state.frames,
        longTasks: state.longTasks,
        samples: state.samples,
        rows: state.rows.map(row => ({
          key: row.key, mountAt: row.mountAt, mountPhase: row.mountPhase,
          enterAt: row.enterAt, enterPhase: row.enterPhase, readyAt: row.readyAt, readyPhase: row.readyPhase,
          readyAtEntry: row.readyAtEntry, missed: row.missed, exitAt: row.exitAt,
          mountToEnterMs: row.mountToEnterMs, readyDelayMs: row.readyDelayMs,
        })),
        errors: state.errors,
      }
    },
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------------
function percentile(values, p) {
  const present = values.filter(value => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b)
  if (!present.length) return null
  const index = Math.min(present.length - 1, Math.max(0, Math.ceil((p / 100) * present.length) - 1))
  return Math.round(present[index] * 100) / 100
}
const round = (value, digits = 2) => (typeof value === 'number' && Number.isFinite(value)
  ? Math.round(value * 10 ** digits) / 10 ** digits : null)

function frameSummary(frames, budget) {
  const values = frames.map(frame => frame.dt)
  if (!values.length) return { count: 0, p50: null, p90: null, p95: null, p99: null, max: null, mean: null, over33ms: 0, over50ms: 0, overBudget: null }
  return {
    count: values.length,
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: round(Math.max(...values)),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    over33ms: values.filter(dt => dt > 33.4).length,
    over50ms: values.filter(dt => dt > 50).length,
    overBudget: budget ? values.filter(dt => dt > budget * 1.5).length : null,
  }
}

function longTaskSummary(tasks) {
  const durations = tasks.map(task => task.duration)
  return {
    count: durations.length,
    totalMs: round(durations.reduce((sum, value) => sum + value, 0)),
    maxMs: durations.length ? round(Math.max(...durations)) : null,
    p90Ms: percentile(durations, 90),
  }
}

const TRACE_NAMES = ['UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'RasterTask', 'CompositeLayers',
  'EventDispatch', 'FireAnimationFrame', 'FunctionCall', 'MajorGC']

function aggregateTrace(traceEvents, offsetMs, phases) {
  const aggregate = Object.fromEntries(TRACE_NAMES.map(name => [name, { count: 0, cpuMs: 0, maxMs: 0 }]))
  const styleElements = []
  const styleByPhase = new Map()
  const phaseOf = timeMs => {
    for (let i = 0; i < phases.length; i += 1) {
      const phase = phases[i]
      if (timeMs >= phase.pageStart && timeMs <= phase.pageEnd) return phase.name
    }
    return 'outside'
  }
  for (const event of traceEvents) {
    if (event.ph !== 'X' || !aggregate[event.name]) continue
    const timeMs = event.ts / 1000 + offsetMs
    const durationMs = (event.dur || 0) / 1000
    const bucket = aggregate[event.name]
    bucket.count += 1
    bucket.cpuMs += durationMs
    bucket.maxMs = Math.max(bucket.maxMs, durationMs)
    if (event.name === 'UpdateLayoutTree') {
      const elementCount = event.args?.elementCount || 0
      styleElements.push(elementCount)
      const phase = phaseOf(timeMs)
      const list = styleByPhase.get(phase) ?? []
      list.push(elementCount)
      styleByPhase.set(phase, list)
    }
  }
  for (const value of Object.values(aggregate)) { value.cpuMs = round(value.cpuMs); value.maxMs = round(value.maxMs) }
  return {
    events: aggregate,
    styleElements: {
      n: styleElements.length,
      p50: percentile(styleElements, 50),
      p90: percentile(styleElements, 90),
      p95: percentile(styleElements, 95),
      max: styleElements.length ? Math.max(...styleElements) : null,
      // 「每次样式重算碰了多少元素」的分档：>=20 基本就是 React 提交一次整窗重渲染
      largeCount: styleElements.filter(count => count >= 20).length,
      hugeCount: styleElements.filter(count => count >= 50).length,
      totalElements: styleElements.reduce((sum, value) => sum + value, 0),
    },
    styleElementsByPhase: Object.fromEntries([...styleByPhase].map(([phase, list]) => [phase, {
      n: list.length, p50: percentile(list, 50), p95: percentile(list, 95), max: Math.max(...list),
      largeCount: list.filter(count => count >= 20).length,
      totalElements: list.reduce((sum, value) => sum + value, 0),
    }])),
  }
}

// ---------------------------------------------------------------------------
// 一次页面 = 一个测量回合
// ---------------------------------------------------------------------------
const METRIC_NAMES = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount', 'TaskCount']

async function readMeters(page) {
  return page.evaluate(() => {
    const perf = window.__PERF__
    const calls = perf.calls()
    const byCommand = {}
    let totalDelayMs = 0
    const seen = new Set()
    for (const call of calls) {
      const entry = byCommand[call.command] ?? (byCommand[call.command] = { count: 0, uniqueKeys: 0, delayMs: 0 })
      entry.count += 1
      entry.delayMs += call.delayMs
      totalDelayMs += call.delayMs
      const dedup = call.command + '\u0000' + call.key
      if (!seen.has(dedup)) { seen.add(dedup); entry.uniqueKeys += 1 }
    }
    return { calls: calls.length, byCommand, totalModelledNativeMs: Math.round(totalDelayMs * 100) / 100 }
  })
}

async function measureSession({ page, cdp, browser, origin, view, viewName, size, runIndex, layoutLevel, fixtureModule, surfaceProbe, patchedAudio, realSurface, shellHtml }) {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') pageErrors.push('console: ' + message.text()) })

  await page.route('**/src/features/player/services/audioCommands.ts*', route =>
    route.fulfill({ contentType: 'text/javascript', body: patchedAudio }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route =>
    route.fulfill({ contentType: 'text/javascript', body: surfaceProbe }))
  await page.route('**/__perf_real_surface.js', route =>
    route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__perf_fixture.js', route =>
    route.fulfill({ contentType: 'text/javascript', body: fixtureModule }))
  await page.route('**/__perf_test', route =>
    route.fulfill({ contentType: 'text/html', body: shellHtml }))

  await page.goto(origin + '/__perf_test', { waitUntil: 'commit' })
  await page.waitForFunction(() => Boolean(window.__PERF_VM__), null, { timeout: 90_000 })
  await page.waitForFunction(() => {
    const vm = window.__PERF_VM__
    return Boolean(vm) && vm.playlist.library.allSongs.length > 0
  }, null, { timeout: 120_000 }).catch(() => {})
  await page.waitForFunction(() => {
    const vm = window.__PERF_VM__
    return Boolean(vm) && !vm.playlist.library.isImportPending && !vm.playlist.library.isPlaylistRestorePending
  }, null, { timeout: 60_000 }).catch(() => {})

  // 先启用同一 CPU 节流，保证「首屏静置」与「拖动」在同一算力下测量
  await cdp.send('Performance.enable')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: page.__cpuRate || 1 })
  const metricsNow = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]))
  const pageNow = () => page.evaluate(() => performance.now())

  // ---- 对照 a：首屏静置加载（与 run.mjs measureLibraryView 同口径） ----
  await page.evaluate(() => window.__PERF__.reset())
  const idleLoad = await (async () => {
    await page.evaluate(options => window.__PERF_OPEN_START__(options), {
      dwellMs: 8000,
      budgetMs: 30000,
      panelSelector: view.selector.panel,
      gridSelector: '.playlist-grid',
      cardSelector: view.selector.card,
    })
    await page.evaluate(kind => {
      const vm = window.__PERF_VM__
      if (kind === 'library') { vm.playlist.library.onSelectCategory('songs'); return }
      const item = vm.playlist.library.items.find(entry => String(entry.scope).includes('cold'))
      vm.playlist.library.onSelect(String(item.scope))
    }, view.kind)
    const state = await page.waitForFunction(() => {
      const current = window.__PERF_OPEN_STATE__ && window.__PERF_OPEN_STATE__()
      return current && current.state === 'done' ? current.result : false
    }, null, { timeout: 60_000, polling: 100 }).then(handle => handle.jsonValue())
    const native = await readMeters(page)
    return { view: state, native }
  })()

  // 等首屏封面落定，避免把首屏 loading 计入拖动
  await page.waitForTimeout(1500)

  // ---- 安装探针 ----
  const installed = await page.evaluate(installProbe, { selector: view.selector, sampleEvery: 6 })
  if (!installed.ok) throw new Error('probe install failed: ' + installed.error)

  const phases = []
  async function withPhase(name, input) {
    await page.evaluate(() => window.__PERF__.reset())
    const before = await metricsNow()
    const pageStart = await pageNow()
    const began = await page.evaluate(phaseName => window.__SCROLL_PROBE__.begin(phaseName), name)
    const startedAt = Date.now()
    await input()
    const elapsedMs = Date.now() - startedAt
    // 先把所有相位读数取完，再做 end() 的盘点工作，避免盘点开销计入本相位。
    const pageEnd = await pageNow()
    const after = await metricsNow()
    const native = await readMeters(page)
    const ended = await page.evaluate(phaseName => window.__SCROLL_PROBE__.end(phaseName), name)
    const record = {
      name,
      elapsedMs,
      pageStart: round(pageStart),
      pageEnd: round(pageEnd),
      began: { cards: began.cards, cardsWithPixels: began.cardsWithPixels, scrollTop: began.scrollTop, scrollHeight: began.scrollHeight, clientHeight: began.clientHeight },
      ended: { cards: ended.cards, cardsWithPixels: ended.cardsWithPixels, transparentReady: ended.transparentReady,
        scrollTop: ended.scrollTop, scrollHeight: ended.scrollHeight, clientHeight: ended.clientHeight },
      metrics: Object.fromEntries(METRIC_NAMES.map(key => [key, round((after[key] - before[key]) * (key.endsWith('Duration') ? 1000 : 1))])),
      native,
      frames: frameSummary(ended.phaseSlice.frames, null),
      longTasks: longTaskSummary(ended.phaseSlice.longTasks),
      longTaskList: ended.phaseSlice.longTasks,
      samples: ended.phaseSlice.samples,
      rawFrames: ended.phaseSlice.frames,
    }
    phases.push(record)
    return record
  }

  const initial = await page.evaluate(() => window.__SCROLL_PROBE__.install())
  if (!initial.ok) throw new Error('probe reinstall failed')
  const geometry = initial

  await page.evaluate(() => window.__SCROLL_PROBE__.setScrollTop(0))
  await page.waitForTimeout(500)

  // trace 只覆盖拖动相位，避免把首屏加载的 trace 混进来
  await page.evaluate(() => { window.__TRACE_ANCHOR_READY__ = true })
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,cc,benchmark',
    transferMode: 'ReturnAsStream',
  })

  // ---- 相位 0：静置（帧预算校准） ----
  const idle = await withPhase('idle', async () => { await page.waitForTimeout(800) })
  const budget = idle.frames.p50 || 16.7

  const scrollRange = Math.max(1, geometry.scrollHeight - geometry.clientHeight)
  const stepPx = Math.max(40, Math.round(geometry.clientHeight * stepRatio))
  const totalWheelEvents = Math.max(segments, Math.round(scrollRange / stepPx))
  const perSegment = Math.ceil(totalWheelEvents / segments)

  const wheelForward = async () => {
    await page.mouse.move(geometry.center.x, geometry.center.y)
    for (let i = 0; i < perSegment; i += 1) {
      await page.mouse.wheel(0, stepPx)
      await page.waitForTimeout(intervalMs)
    }
  }
  const programForward = async px => {
    for (let i = 0; i < perSegment; i += 1) {
      await page.evaluate(delta => window.__SCROLL_PROBE__.nudge(delta), px)
      await page.waitForTimeout(intervalMs)
    }
  }
  const wheelBackward = async events => {
    await page.mouse.move(geometry.center.x, geometry.center.y)
    for (let i = 0; i < events; i += 1) {
      await page.mouse.wheel(0, -stepPx)
      await page.waitForTimeout(intervalMs)
    }
  }

  let inputMode = 'wheel'
  const forward = []
  for (let segment = 1; segment <= segments; segment += 1) {
    const record = await withPhase('forward-' + segment, inputMode === 'wheel'
      ? wheelForward
      : () => programForward(stepPx))
    forward.push(record)
    if (segment === 1 && record.ended.scrollTop === 0) {
      // 滚轮没驱动这个容器（焦点/命中问题）→ 退回程序化 scrollTop（等价于拖动滚动条）
      inputMode = 'program'
      log('  wheel did not move the panel; falling back to programmatic scrollTop for the remaining segments')
    }
    if (segment === Math.ceil(segments / 2)) {
      await withPhase('pause-mid', async () => { await page.waitForTimeout(pauseMs) })
    }
  }
  await withPhase('settle-bottom', async () => { await page.waitForTimeout(800) })

  const atBottom = await page.evaluate(() => {
    const probeState = window.__SCROLL_PROBE__
    return { scrollTop: document.querySelector('.playlist-management-content, .playlist-panel')?.scrollTop,
      probe: Boolean(probeState) }
  })

  // ---- 对照 c：反向滚回顶部 ----
  const back = await withPhase('backward', inputMode === 'wheel'
    ? () => wheelBackward(perSegment * segments)
    : async () => {
      for (let i = 0; i < perSegment * segments; i += 1) {
        await page.evaluate(delta => window.__SCROLL_PROBE__.nudge(-delta), stepPx)
        await page.waitForTimeout(intervalMs)
      }
    })
  await withPhase('settle-top', async () => { await page.waitForTimeout(600) })

  const state = await page.evaluate(() => window.__SCROLL_PROBE__.state())

  // ---- trace 解析 ----
  let trace = null
  try {
    const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
    await cdp.send('Tracing.end')
    const { stream } = await complete
    let content = ''
    for (;;) {
      const read = await cdp.send('IO.read', { handle: stream })
      content += read.base64Encoded ? Buffer.from(read.data, 'base64').toString('utf8') : read.data
      if (read.eof) break
    }
    await cdp.send('IO.close', { handle: stream })
    const events = JSON.parse(content).traceEvents
    const anchor = events.find(event => event.name === 'scroll-probe-anchor')
    const offset = anchor && state.anchorPageTime !== null ? state.anchorPageTime - anchor.ts / 1000 : null
    trace = offset === null
      ? { error: 'no anchor mark in trace' }
      : aggregateTrace(events, offset, phases.map(phase => ({ name: phase.name, pageStart: phase.pageStart, pageEnd: phase.pageEnd })))
    trace.traceBytes = content.length
  } catch (error) {
    trace = { error: String(error && error.message ? error.message : error) }
  }

  // ---- 行级「进视口 → 封面可用」延迟 ----
  const allSamples = phases.flatMap(phase => phase.samples)
  const progressSamples = allSamples.filter(sample => sample.phase.startsWith('forward'))
  const ratioFor = (phase, at) => {
    const list = phases.find(item => item.name === phase)?.samples ?? []
    const nearest = list.find(sample => sample.t >= at) ?? list[list.length - 1]
    return nearest ? Math.min(1, Math.max(0, (nearest.scrollTop - (progressSamples[0]?.scrollTop ?? 0)) / scrollRange)) : 0
  }
  const rows = state.rows.filter(row => row.enterAt !== null)
  for (const row of rows) row.depthRatio = ratioFor(row.enterPhase, row.enterAt)
  const delayed = rows.filter(row => row.readyAt !== null && row.readyAtEntry === false)
  const preloaded = rows.filter(row => row.readyAtEntry === true)
  const missed = rows.filter(row => row.readyAt === null)
  const depthBuckets = Array.from({ length: 10 }, (_, index) => ({ bucket: index, rows: [], delay: [], cards: [] }))
  for (const row of rows) {
    const bucket = depthBuckets[Math.min(9, Math.floor(row.depthRatio * 10))]
    bucket.rows.push(row)
    if (row.readyAtEntry === false && row.readyDelayMs !== null) bucket.delay.push(row.readyDelayMs)
  }
  for (const sample of progressSamples) {
    const bucket = depthBuckets[Math.min(9, Math.floor((sample.scrollTop / scrollRange) * 10))]
    bucket.cards.push(sample.cards)
  }
  const coverLatency = {
    rowsEntered: rows.length,
    rowsReady: rows.filter(row => row.readyAt !== null).length,
    rowsPreloadedAtEntry: preloaded.length,
    rowsDelayed: delayed.length,
    rowsMissedVisibleCover: missed.length,
    preloadedRatio: rows.length ? round(preloaded.length / rows.length, 3) : null,
    delayMs: {
      n: delayed.length,
      p50: percentile(delayed.map(row => row.readyDelayMs), 50),
      p90: percentile(delayed.map(row => row.readyDelayMs), 90),
      max: delayed.length ? round(Math.max(...delayed.map(row => row.readyDelayMs))) : null,
    },
    allDelayMs: {
      n: rows.length,
      p50: percentile(rows.map(row => row.readyDelayMs), 50),
      p90: percentile(rows.map(row => row.readyDelayMs), 90),
    },
    mountToEnterMs: {
      n: rows.length,
      p50: percentile(rows.map(row => row.mountToEnterMs), 50),
      p90: percentile(rows.map(row => row.mountToEnterMs), 90),
    },
    byEnterPhase: Object.fromEntries([...new Set(delayed.map(row => row.enterPhase))].map(phase => {
      const list = delayed.filter(row => row.enterPhase === phase)
      return [phase, { n: list.length, p50: percentile(list.map(row => row.readyDelayMs), 50),
        p90: percentile(list.map(row => row.readyDelayMs), 90) }]
    })),
    byDepth: depthBuckets.map(bucket => ({
      bucket: bucket.bucket,
      rowsEntered: bucket.rows.length,
      cardsMedian: percentile(bucket.cards, 50),
      cardsMax: bucket.cards.length ? Math.max(...bucket.cards) : null,
      coverDelayP50: percentile(bucket.delay, 50),
      coverDelayP90: percentile(bucket.delay, 90),
      coverDelayMax: bucket.delay.length ? Math.max(...bucket.delay) : null,
    })),
  }
  const mountedCurve = {
    n: allSamples.length,
    min: allSamples.length ? Math.min(...allSamples.map(item => item.cards)) : null,
    p50: percentile(allSamples.map(item => item.cards), 50),
    p90: percentile(allSamples.map(item => item.cards), 90),
    max: allSamples.length ? Math.max(...allSamples.map(item => item.cards)) : null,
    distinct: [...new Set(allSamples.map(item => item.cards))].sort((a, b) => a - b).slice(0, 40),
  }

  const forwardFrames = forward.flatMap(phase => phase.rawFrames)
  const forwardElapsed = forward.reduce((sum, phase) => sum + phase.elapsedMs, 0)
  const dragScrolledPx = Math.max(0, (atBottom.scrollTop ?? 0))
  const thumbnails = forward.reduce((sum, phase) => sum + (phase.native.byCommand.audio_load_track_thumbnail?.count ?? 0), 0)
  const rates = {
    wallsMs: forwardElapsed,
    scrolledPx: dragScrolledPx,
    pxPerSecond: forwardElapsed ? round(dragScrolledPx / forwardElapsed * 1000) : null,
    rowsPerSecond: forwardElapsed ? round(rows.length / forwardElapsed * 1000) : null,
    thumbnailsPerSecond: forwardElapsed ? round(thumbnails / forwardElapsed * 1000) : null,
    nativeCallsPerSecond: forwardElapsed ? round(forward.reduce((sum, phase) => sum + phase.native.calls, 0) / forwardElapsed * 1000) : null,
  }
  return {
    view: viewName,
    viewKind: view.kind,
    layoutLevel,
    size,
    run: runIndex,
    cpuRate: page.__cpuRate || 1,
    inputMode,
    budgetMs: round(budget),
    idleLoad: { view: idleLoad.view, native: idleLoad.native },
    rates,
    geometry: { scrollHeight: geometry.scrollHeight, clientHeight: geometry.clientHeight,
      scrollRange, stepPx, totalWheelEvents, perSegment, intervalMs, dockInset: geometry.dockInset,
      center: geometry.center },
    endState: { atBottom: atBottom.scrollTop, samplesLast: allSamples[allSamples.length - 1]?.scrollTop ?? null },
    phases,
    summary: {
      framesIdle: idle.frames,
      framesForward: frameSummary(forwardFrames, budget),
      framesForwardPerPhase: forward.map(phase => ({ name: phase.name, ...phase.frames })),
      framesBackward: back.frames,
      longTasksForward: longTaskSummary(phases.filter(phase => phase.name.startsWith('forward')).flatMap(phase => phase.longTaskList)),
      longTasksAll: longTaskSummary(state.longTasks),
      nativeForward: combineNative(forward),
      nativeBackward: { calls: back.native.calls, totalModelledNativeMs: back.native.totalModelledNativeMs, byCommand: back.native.byCommand },
      nativeIdle: { calls: idle.native.calls, totalModelledNativeMs: idle.native.totalModelledNativeMs },
      metricsForward: combineMetrics(forward),
      metricsForwardPerPhase: forward.map(phase => ({ name: phase.name, elapsedMs: phase.elapsedMs, ...phase.metrics })),
      metricsBackward: back.metrics,
      metricsIdle: idle.metrics,
      dragElapsedMs: forward.reduce((sum, phase) => sum + phase.elapsedMs, 0),
    },
    coverLatency,
    mountedCurve,
    commandBreakdown: combineNative(forward).byCommand,
    trace,
    probeErrors: state.errors,
    pageErrors,
  }
}

function combineFrames(phases, budget) { return frameSummary(phases.flatMap(phase => phase.rawFrames), budget) }
function combineNative(phases) {
  const byCommand = {}
  let calls = 0
  let totalModelledNativeMs = 0
  for (const phase of phases) {
    calls += phase.native.calls
    totalModelledNativeMs += phase.native.totalModelledNativeMs
    for (const [command, value] of Object.entries(phase.native.byCommand)) {
      const slot = byCommand[command] ?? (byCommand[command] = { count: 0, delayMs: 0, uniqueKeys: 0 })
      slot.count += value.count
      slot.delayMs += value.delayMs
      slot.uniqueKeys += value.uniqueKeys
    }
  }
  return { calls, totalModelledNativeMs: round(totalModelledNativeMs), byCommand }
}
function combineMetrics(phases) {
  const out = Object.fromEntries(METRIC_NAMES.map(key => [key, 0]))
  for (const phase of phases) for (const key of METRIC_NAMES) out[key] += phase.metrics[key] ?? 0
  for (const key of METRIC_NAMES) out[key] = round(out[key])
  return out
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const head = gitHead(worktreePath)
  log('worktree ' + worktreePath + ' HEAD ' + String(head).slice(0, 8))

  const { chromium } = loadPlaywright()
  const executablePath = resolveBrowserExecutable(process.env.SPMUSIC_BROWSER_EXECUTABLE)

  const configs = []
  for (const viewName of viewNames) {
    const view = VIEWS[viewName]
    if (!view) throw new Error('unknown view ' + viewName + '; known: ' + Object.keys(VIEWS).join(','))
    for (const size of sizes) {
      configs.push({ viewName, view, size, repeats: view.primary ? repeat : repeatSecondary, layoutLevel: view.layoutLevel })
    }
  }
  log('configs: ' + configs.map(config => config.viewName + '/' + config.size + 'x' + config.repeats).join(' '))

  let server
  let browser
  const records = []
  try {
    server = await startDevServer({ worktreePath, perfConfigPath: PERF_CONFIG, log })
    const originCheck = await verifyOrigin({ origin: server.origin, worktreePath, log })

    const mainText = await (await fetch(server.origin + '/src/main.tsx', { signal: AbortSignal.timeout(30_000) })).text()
    const dependency = name => {
      const escaped = name.replaceAll('.', '\\.')
      const found = mainText.match(new RegExp('"(/node_modules/\\.vite/deps/' + escaped + '[^"\\n]*)"'))
      if (!found) throw new Error('could not resolve Vite dependency ' + name)
      return found[1]
    }
    const audioResponse = await fetch(server.origin + '/src/features/player/services/audioCommands.ts', { signal: AbortSignal.timeout(30_000) })
    if (!audioResponse.ok) throw new Error('cannot fetch audioCommands.ts')
    const patchedAudio = patchedAudioCommands(await audioResponse.text())
    const surfaceResponse = await fetch(server.origin + '/src/features/player/components/PlayerSurface.tsx', { signal: AbortSignal.timeout(45_000) })
    if (!surfaceResponse.ok) throw new Error('cannot fetch PlayerSurface.tsx')
    const realSurface = await surfaceResponse.text()
    const shellHtml = (await (await fetch(server.origin + '/', { signal: AbortSignal.timeout(30_000) })).text())
      .replace(/src="\/src\/[^"]+"/, 'src="/__perf_fixture.js"')

    browser = await chromium.launch({ headless: true, executablePath })
    log('browser ' + browser.version())

    for (const config of configs) {
      const fixtureModule = buildFixtureModule(fixtureConfig(config.size, dependency))
      const surfaceProbe = buildSurfaceProbeModule(fixtureConfig(config.size, dependency), realSurface)
      for (const cpuRate of cpuRates) {
        for (let run = 0; run < config.repeats; run += 1) {
          const label = config.viewName + '-' + config.size + '-cpu' + cpuRate + '-r' + run
          const context = await browser.newContext({ viewport, reducedMotion: 'reduce', colorScheme: 'light' })
          const page = await context.newPage()
          page.__cpuRate = cpuRate
          try {
            await page.addInitScript(level => {
              localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
              localStorage.setItem('spmusic.playlist.layout-level.v1', String(level))
              localStorage.setItem('spmusic.all-songs.layout-level.v1', String(level))
              localStorage.removeItem('spmusic.player.session.v1')
            }, config.layoutLevel)
            const cdp = await context.newCDPSession(page)
            const record = await measureSession({ page, cdp, browser, origin: server.origin, view: config.view,
              viewName: config.viewName, size: config.size, runIndex: run, layoutLevel: config.layoutLevel,
              fixtureModule, surfaceProbe, patchedAudio, realSurface, shellHtml })
            record.cpuRate = cpuRate
            record.label = label
            record.idleLoad.firstRowAtMs = record.idleLoad.view?.firstRowAtMs ?? null
            records.push(record)
            log(label
              + ' idle.firstRow=' + (record.idleLoad.view?.firstRowAtMs ?? '-')
              + ' drag.p95=' + record.summary.framesForward.p95
              + ' over50=' + record.summary.framesForward.over50ms
              + ' task=' + record.summary.metricsForward.TaskDuration
              + ' layoutMs=' + record.summary.metricsForward.LayoutDuration
              + ' recalcMs=' + record.summary.metricsForward.RecalcStyleDuration
              + ' styleElems=' + (record.trace?.styleElements?.p50 ?? '-')
              + ' cards=' + record.mountedCurve.min + '-' + record.mountedCurve.max
              + ' coverP50=' + record.coverLatency.delayMs.p50
              + ' preload=' + record.coverLatency.preloadedRatio
              + ' missed=' + record.coverLatency.rowsMissedVisibleCover
              + ' native=' + record.summary.nativeForward.calls + '/' + record.summary.nativeForward.totalModelledNativeMs + 'ms')
            writeFileSync(outPath, JSON.stringify(buildReport(records, { head, browser, originCheck, server, viewport }), null, 2))
          } catch (error) {
            records.push({ label, view: config.viewName, size: config.size, error: String(error && error.message ? error.message : error) })
            log(label + ' FAILED: ' + (error && error.message ? error.message : error))
            mkdirSync(path.dirname(outPath), { recursive: true })
            writeFileSync(outPath, JSON.stringify(buildReport(records, { head, browser, originCheck, server, viewport }), null, 2))
          } finally {
            await context.close()
          }
        }
      }
    }

    const report = buildReport(records, { head, browser, originCheck, server, viewport })
    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(report, null, 2))
    log('wrote ' + outPath)
    printSummary(report)
    return report
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (server) await server.stop()
  }
}

function fixtureConfig(size, dependency) {
  return {
    reactUrl: dependency('react.js'),
    reactDomUrl: dependency('react-dom_client.js'),
    model: MODEL,
    fixture: {
      libraryRoot: LIBRARY_ROOT,
      folderTrackCount: size,
      playlist: {
        directoryPath: '/perf/lists',
        directoryName: 'perf',
        sourcePath: '/perf/lists/cold.m3u8',
        name: 'Perf Cold List',
        trackPaths: Array.from({ length: size }, (_, i) => LIBRARY_ROOT + '/' + i + '.flac'),
      },
    },
  }
}

function buildReport(records, { head, browser, originCheck, server, viewport }) {
  const ok = records.filter(record => !record.error)
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    engine: {
      tool: 'tools/perf-regression/scroll-probe.mjs',
      gitCommit: head,
      gitSubject: gitSubject(worktreePath),
      gitDirty: gitIsDirty(worktreePath),
      worktreePath,
      origin: server ? server.origin : null,
      originVerified: originCheck ? originCheck.ok : null,
      servedPlayerShell: originCheck ? originCheck.servedFile : null,
      browser: browser ? { name: 'msedge', version: browser.version() } : null,
      viewport,
      mockedLatencyModel: MODEL,
      input: { device: 'page.mouse.wheel', deltaY: 'panel.clientHeight * ' + stepRatio, intervalMs, segments, pauseMs },
      mocks: {
        fake: ['window.backendInvoke transport (native Rust process + filesystem)'],
        real: [
          'index.html, main.tsx, App, AppearanceProvider',
          'PlayerShell, PlayerSurface, PlaylistLibraryPanel, PlaylistPanel, PlaylistCard, PlaylistCoverImage',
          'useAllSongsWindow (cover store/pump), useAllSongsRenderWindow (render window), playlistCoverScheduler, playlistCoverPixels',
          'audioCommands.ts parsers and validators (only its two @tauri-apps imports are replaced)',
        ],
        probe: [
          'page.mouse.wheel real input; deltaY = one third of the panel viewport; 16ms between events',
          'rAF interval sampler + PerformanceObserver(longtask)',
          'CDP Performance.getMetrics deltas per phase',
          'CDP Tracing devtools.timeline: UpdateLayoutTree/Layout/Paint/... count + cpuMs + elementCount',
          'IntersectionObserver(root=panel) per-row enter time; img.complete && naturalWidth>0 for cover ready',
          'mounted [data-playlist-track-id] count sampled every 6 animation frames',
        ],
      },
      caveats: [
        '封面就绪 = img.complete && img.naturalWidth>0。可见性另带 opacity>=0.99 门；本次 context 用 reducedMotion=reduce 关掉了 reveal 动画，结果里 transparentReady 计数是等价性证据。',
        'IntersectionObserver 回调在交叉发生的那一帧投递，所以「进入视口」粒度约 1 帧（<=16.7ms）。',
        '每相位的原生计量是 __PERF__.reset() 之后的增量；相位边界读数本身有 <1ms 开销。',
        'trace 事件按 performance.mark 锚点换算到页面时钟后归相位，跨界事件可能落到相邻相位。',
        'dev server 是 Vite dev 构建（未压缩、带 HMR 运行时），比生产包更重，绝对值只用于同一环境内比较。',
      ],
    },
    summary: summarizeByConfig(ok),
    runs: records,
  }
}

function summarizeByConfig(records) {
  const groups = new Map()
  for (const record of records) {
    const key = record.view + '-' + record.size + '-cpu' + record.cpuRate
    const list = groups.get(key) ?? []
    list.push(record)
    groups.set(key, list)
  }
  const out = {}
  for (const [key, list] of groups) {
    const pick = (path) => list.map(item => path(item))
    const commandPhases = {}
    for (const item of list) for (const phase of item.phases ?? []) {
      const slot = commandPhases[phase.name] ?? (commandPhases[phase.name] = { calls: 0, modelledMs: 0, byCommand: {} })
      slot.calls += phase.native.calls
      slot.modelledMs += phase.native.totalModelledNativeMs
      for (const [command, value] of Object.entries(phase.native.byCommand)) {
        const entry = slot.byCommand[command] ?? (slot.byCommand[command] = { count: 0, delayMs: 0 })
        entry.count += value.count
        entry.delayMs += value.delayMs
      }
    }
    for (const slot of Object.values(commandPhases)) slot.modelledMs = round(slot.modelledMs)
    out[key] = {
      runs: list.length,
      layoutLevel: list[0].layoutLevel,
      inputMode: list[0].inputMode,
      dragElapsedMs: summarize(pick(item => item.summary.dragElapsedMs)),
      idleFirstRowAtMs: summarize(pick(item => item.idleLoad.view?.firstRowAtMs ?? null)),
      idleT90Ms: summarize(pick(item => item.idleLoad.view?.t90FirstVisibleMs ?? null)),
      idleNativeCalls: summarize(pick(item => item.idleLoad.native.calls)),
      idleNativeMs: summarize(pick(item => item.idleLoad.native.totalModelledNativeMs)),
      framesIdleP50: summarize(pick(item => item.summary.framesIdle.p50)),
      framesP50: summarize(pick(item => item.summary.framesForward.p50)),
      framesP95: summarize(pick(item => item.summary.framesForward.p95)),
      framesP99: summarize(pick(item => item.summary.framesForward.p99)),
      framesMax: summarize(pick(item => item.summary.framesForward.max)),
      framesOver33: summarize(pick(item => item.summary.framesForward.over33ms)),
      framesOver50: summarize(pick(item => item.summary.framesForward.over50ms)),
      framesBackP95: summarize(pick(item => item.summary.framesBackward.p95)),
      framesBackOver50: summarize(pick(item => item.summary.framesBackward.over50ms)),
      longTasksCount: summarize(pick(item => item.summary.longTasksForward.count)),
      longTasksTotalMs: summarize(pick(item => item.summary.longTasksForward.totalMs)),
      longTasksMaxMs: summarize(pick(item => item.summary.longTasksForward.maxMs)),
      taskDurationMs: summarize(pick(item => item.summary.metricsForward.TaskDuration)),
      scriptDurationMs: summarize(pick(item => item.summary.metricsForward.ScriptDuration)),
      layoutDurationMs: summarize(pick(item => item.summary.metricsForward.LayoutDuration)),
      recalcStyleDurationMs: summarize(pick(item => item.summary.metricsForward.RecalcStyleDuration)),
      layoutCount: summarize(pick(item => item.summary.metricsForward.LayoutCount)),
      recalcStyleCount: summarize(pick(item => item.summary.metricsForward.RecalcStyleCount)),
      nativeCalls: summarize(pick(item => item.summary.nativeForward.calls)),
      nativeModelledMs: summarize(pick(item => item.summary.nativeForward.totalModelledNativeMs)),
      thumbnailCalls: summarize(pick(item => item.summary.nativeForward.byCommand.audio_load_track_thumbnail?.count ?? 0)),
      probeCalls: summarize(pick(item => Object.entries(item.summary.nativeForward.byCommand)
        .filter(([command]) => command.startsWith('audio_probe_')).reduce((sum, [, value]) => sum + value.count, 0))),
      mainThreadBusyRatio: summarize(pick(item => item.summary.dragElapsedMs
        ? round(item.summary.metricsForward.TaskDuration / item.summary.dragElapsedMs, 3) : null)),
      avgTaskMs: summarize(pick(item => item.summary.metricsForward.TaskCount
        ? round(item.summary.metricsForward.TaskDuration / item.summary.metricsForward.TaskCount) : null)),
      taskPerRowMs: summarize(pick(item => item.coverLatency.rowsEntered
        ? round(item.summary.metricsForward.TaskDuration / item.coverLatency.rowsEntered) : null)),
      taskPer1000pxMs: summarize(pick(item => item.rates.scrolledPx
        ? round(item.summary.metricsForward.TaskDuration / item.rates.scrolledPx * 1000) : null)),
      scriptPer1000pxMs: summarize(pick(item => item.rates.scrolledPx
        ? round(item.summary.metricsForward.ScriptDuration / item.rates.scrolledPx * 1000) : null)),
      rowsPerSecond: summarize(pick(item => item.rates.rowsPerSecond)),
      thumbnailsPerSecond: summarize(pick(item => item.rates.thumbnailsPerSecond)),
      framesP95VsIdle: summarize(pick(item => item.summary.framesIdle.p50
        ? round(item.summary.framesForward.p95 / item.summary.framesIdle.p50) : null)),
      coverDelayP50: summarize(pick(item => item.coverLatency.delayMs.p50)),
      coverDelayP90: summarize(pick(item => item.coverLatency.delayMs.p90)),
      coverDelayMax: summarize(pick(item => item.coverLatency.delayMs.max)),
      preloadedRatio: summarize(pick(item => item.coverLatency.preloadedRatio)),
      rowsEntered: summarize(pick(item => item.coverLatency.rowsEntered)),
      rowsMissed: summarize(pick(item => item.coverLatency.rowsMissedVisibleCover)),
      mountedMin: summarize(pick(item => item.mountedCurve.min)),
      mountedMax: summarize(pick(item => item.mountedCurve.max)),
      styleElementsP50: summarize(pick(item => item.trace?.styleElements?.p50 ?? null)),
      styleElementsP95: summarize(pick(item => item.trace?.styleElements?.p95 ?? null)),
      styleElementsMax: summarize(pick(item => item.trace?.styleElements?.max ?? null)),
      styleLargeCount: summarize(pick(item => item.trace?.styleElements?.largeCount ?? null)),
      styleHugeCount: summarize(pick(item => item.trace?.styleElements?.hugeCount ?? null)),
      styleTotalElements: summarize(pick(item => item.trace?.styleElements?.totalElements ?? null)),
      updateLayoutTreeCount: summarize(pick(item => item.trace?.events?.UpdateLayoutTree?.count ?? null)),
      updateLayoutTreeMs: summarize(pick(item => item.trace?.events?.UpdateLayoutTree?.cpuMs ?? null)),
      layoutTraceMs: summarize(pick(item => item.trace?.events?.Layout?.cpuMs ?? null)),
      paintTraceMs: summarize(pick(item => item.trace?.events?.Paint?.cpuMs ?? null)),
      frameTraceMs: summarize(pick(item => item.trace?.events?.FireAnimationFrame?.cpuMs ?? null)),
      eventDispatchMs: summarize(pick(item => item.trace?.events?.EventDispatch?.cpuMs ?? null)),
      commandPhases,
    }
  }
  return out
}

function printSummary(report) {
  const rows = []
  for (const [key, value] of Object.entries(report.summary)) {
    rows.push({
      config: key,
      runs: value.runs,
      'idleFirst': value.idleFirstRowAtMs.median,
      'fP50': value.framesP50.median,
      'fP95': value.framesP95.median,
      'fMax': value.framesMax.median,
      '>50': value.framesOver50.median,
      'LT#': value.longTasksCount.median,
      'LTms': value.longTasksTotalMs.median,
      'busy%': value.mainThreadBusyRatio.median === null ? null : Math.round(value.mainThreadBusyRatio.median * 100),
      'avgTask': value.avgTaskMs.median,
      'Task': value.taskDurationMs.median,
      'Script': value.scriptDurationMs.median,
      'Layout': value.layoutDurationMs.median,
      'Recalc': value.recalcStyleDurationMs.median,
      'lay#': value.layoutCount.median,
      'styP50': value.styleElementsP50.median,
      'styP95': value.styleElementsP95.median,
      'bigRecalc': value.styleLargeCount.median,
      'native#': value.nativeCalls.median,
      'nativeMs': value.nativeModelledMs.median,
      'covP50': value.coverDelayP50.median,
      'covP90': value.coverDelayP90.median,
      'pre%': value.preloadedRatio.median === null ? null : Math.round(value.preloadedRatio.median * 100),
      'missed': value.rowsMissed.median,
      'cards': value.mountedMin.median + '-' + value.mountedMax.median,
    })
  }
  console.log('\n=== scroll-probe summary (medians across runs) ===')
  console.table(rows)
  // 拖动成本随位置的变化（每个配置每次运行的分段）
  for (const run of report.runs || []) {
    if (run.error) continue
    const forward = (run.phases || []).filter(phase => phase.name.startsWith('forward-'))
    if (!forward.length) continue
    console.log('--- position sweep: ' + run.label + ' (layout ' + run.layoutLevel + ', ' + run.geometry.scrollRange + 'px)')
    console.table(forward.map(phase => ({
      phase: phase.name,
      scrollFrom: phase.began.scrollTop,
      ms: phase.elapsedMs,
      fP95: phase.frames.p95,
      fMax: phase.frames.max,
      '>50': phase.frames.over50ms,
      Task: phase.metrics.TaskDuration,
      Script: phase.metrics.ScriptDuration,
      Layout: phase.metrics.LayoutDuration,
      Recalc: phase.metrics.RecalcStyleDuration,
      native: phase.native.calls,
      cards: phase.ended.cards,
      pxs: phase.ended.cardsWithPixels,
    })))
  }
}

main().then(report => {
  const anyFailure = (report.runs || []).some(run => run.error)
  process.exitCode = anyFailure ? 1 : 0
}).catch(error => {
  console.error('FATAL', error && error.stack ? error.stack : error)
  process.exitCode = 2
})
