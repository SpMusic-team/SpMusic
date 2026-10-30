// Start Vite and provide an existing Playwright via SPMUSIC_PLAYWRIGHT.
// The real shell, theme pipeline, dock owner, artwork consumers and both song
// collections run. Only native IO is deterministic. Evidence stays in Temp.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const evidenceDirectory = join(tmpdir(), 'spmusic-selection-motion-verification')
mkdirSync(evidenceDirectory, { recursive: true })
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const realDock = await (await fetch(origin + '/src/features/player/components/PlaylistPlaybackDock.tsx')).text()
const dependency = name => {
  const match = (entry + realSurface + realDock).match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const shared = readFileSync(new URL('./allSongs.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal, 'reuse deterministic native transport without executing the other suite')
let fixture = runInNewContext(literal[1], { dependency })
fixture = fixture.replace('length:50', 'length:1000')
const oldArtwork = 'coverArt:null}}};'
assert(fixture.includes(oldArtwork), 'give the player a real owned canvas resource')
fixture = fixture.replace(oldArtwork, "coverArt:row.sourcePath.startsWith('/audio/many/')?{mimeType:'image/png',filePath:'/covers/'+row.id+'.png',dataUrl:null,byteLen:64}:null}}};")
fixture = fixture.replace("command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels'", "command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels'||command==='audio_load_cover_pixels'")
fixture = fixture.replace('React.createElement(PlayerShell)', 'React.createElement(ThemeProbe)')
fixture += `
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
function ThemeProbe(){const theme=useAppearance();window.themeApi=theme;return React.createElement(PlayerShell)}
`
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__selection_motion_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(Surface,props)}`
const dock = `
import React from '${dependency('react.js')}';
import {PlaylistPlaybackDock as Dock} from '/__selection_motion_dock.js';
window.dockMeter={mounts:0,unmounts:0,retains:0,releases:0};
const observed=new WeakSet();
function observe(resource){
 if(!resource||observed.has(resource))return;
 observed.add(resource);const retain=resource.retain;
 resource.retain=()=>{window.dockMeter.retains++;const release=retain();return()=>{window.dockMeter.releases++;release()}};
}
export function PlaylistPlaybackDock(props){
 window.lastSelectionDockProps=props;
 observe(props.coverLayer?.resource);observe(props.previewCoverLayer?.resource);
 React.useEffect(()=>{window.dockMeter.mounts++;return()=>{window.dockMeter.unmounts++}},[]);
 return React.createElement(Dock,props);
}
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__selection_motion_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
let passed = 0

async function open(kind = 'playlist', { reducedMotion = 'no-preference', width = 640, level = 4 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: width === 640 ? 1440 : 1000 }, reducedMotion })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(level => {
    localStorage.setItem('spmusic.playlist.layout-level.v1', String(level))
    localStorage.setItem('spmusic.all-songs.layout-level.v1', String(level))
  }, level)
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/src/features/player/components/PlaylistPlaybackDock.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: dock }))
  await page.route('**/__selection_motion_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__selection_motion_dock.js', route => route.fulfill({ contentType: 'text/javascript', body: realDock }))
  await page.route('**/__selection_motion_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__selection_motion_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__selection_motion_test')
  await page.waitForFunction(() => Boolean(window.viewModel && window.themeApi))
  await page.evaluate(() => { window.choice = 'many'; window.viewModel.playlist.library.onSelectFolders() })
  await page.waitForFunction(() => !window.viewModel.playlist.library.isImportPending && window.viewModel.playlist.library.allSongsMetadataStatus !== 'loading')
  await page.evaluate(() => window.viewModel.playlist.library.onPlay(window.viewModel.playlist.library.items[0].scope))
  await page.waitForFunction(() => window.viewModel.playback.track?.id === 'many-0' && !window.viewModel.playback.isSelectionPending && !window.viewModel.playback.isAudioBusy)
  await page.evaluate(kind => {
    if (kind === 'songs') window.viewModel.playlist.library.onSelectCategory('songs')
    else window.viewModel.playlist.library.onSelect(window.viewModel.playlist.library.items[0].scope)
  }, kind)
  const grid = page.locator(kind === 'songs' ? '.all-songs-list' : '.playlist-grid:not(.all-songs-list)')
  const panel = page.locator(kind === 'songs' ? '.playlist-management-content' : '.playlist-panel')
  await grid.locator('.playlist-card').first().waitFor()
  await page.waitForFunction(() => {
    const dock = document.querySelector('.playlist-playback-dock:not([data-dock-superseded])')
    const canvas = dock?.querySelector('canvas')
    return Boolean(canvas?.width && canvas.height && window.dockMeter.retains > 0)
  }).catch(async error => {
    const diagnostics = await page.evaluate(() => ({ errors: window.selectionPageErrors,
      meter: window.dockMeter, playback: window.viewModel?.playback,
      props: Object.fromEntries(Object.entries(window.lastSelectionDockProps ?? {}).filter(([key]) => ['coverLayer', 'previewCoverLayer', 'requireCanvasPreview', 'playlistTrack'].includes(key))),
      calls: window.calls?.slice(-20), html: document.querySelector('.playlist-playback-dock')?.outerHTML }))
    writeFileSync(join(evidenceDirectory, kind + '-setup-failure.json'), JSON.stringify({ diagnostics, errors }, null, 2))
    throw error
  })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => !document.querySelector('.playlist-playback-dock:not([data-dock-superseded])')?.getAnimations({ subtree: false }).some(animation => animation.playState === 'running'))
  return { page, errors, grid, panel, kind }
}
async function checkpoint(context) {
  return context.page.evaluate(() => {
    const dock = document.querySelector('.playlist-playback-dock:not([data-dock-superseded])')
    const panel = document.querySelector('.playlist-grid')?.closest('.playlist-panel,.playlist-management-content')
    const grid = panel?.querySelector('.playlist-grid')
    const card = grid?.querySelector('.playlist-card')
    const canvas = dock?.querySelector('canvas')
    const pixel = canvas?.width && canvas.height ? [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data] : null
    return { ownerCount: document.querySelectorAll('.playlist-playback-dock:not([data-dock-superseded])').length,
      meter: { ...window.dockMeter }, scrollTop: panel?.scrollTop, cardHeight: card?.getBoundingClientRect().height,
      rowGap: grid ? getComputedStyle(grid).rowGap : null, level: grid?.dataset.layoutLevel, pixel,
      nativePixelReads: window.calls.filter(call => ['audio_load_cover_pixels', 'audio_load_playlist_cover_pixels', 'audio_load_track_thumbnail'].includes(call.command)).length }
  })
}
async function check(name, kind, run, options) {
  if (process.env.SPMUSIC_SELECTION_FILTER && !name.includes(process.env.SPMUSIC_SELECTION_FILTER)) return
  const context = await open(kind, options)
  try { await run(context); assert.deepEqual(context.errors, []); passed++; console.log('PASS', name) }
  finally { await context.page.close() }
}

async function checkThemeContract() {
  const page = await browser.newPage()
  await page.route('**/__selection_theme_contract', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }))
  await page.goto(origin + '/__selection_theme_contract')
  try {
    const result = await page.evaluate(async () => {
      const { defaultAppearance } = await import('/src/features/appearance/model/defaultAppearance.ts')
      const codec = await import('/src/features/appearance/model/appearanceThemeCodec.ts')
      const { createAppearanceMotionRuntime } = await import('/src/features/appearance/model/appearanceMotion.ts')
      const { createAppearanceCssVars } = await import('/src/features/appearance/model/appearanceCss.ts')
      const { applyAppearanceRuntime } = await import('/src/features/appearance/model/appearanceRuntime.ts')
      const appearance = codec.cloneAppearance(defaultAppearance)
      const originalDuration = defaultAppearance.motion.selection.controlsDurationMs
      appearance.motion.selection.controlsDurationMs = 333
      const deepClone = defaultAppearance.motion.selection.controlsDurationMs === originalDuration
      const custom = codec.cloneAppearance(defaultAppearance)
      custom.motion.selection.controlsDurationMs = 333
      custom.motion.selection.dockEnterDurationMs = 620
      custom.motion.selection.checkDrawDelayMs = 222
      custom.motion.selection.checkDrawDurationMs = 777
      const roundtrip = codec.deserializeAppearanceTheme(codec.serializeAppearanceTheme(custom))
      const legacyDocument = codec.createAppearanceThemeDocument(defaultAppearance)
      delete legacyDocument.theme.motion.selection
      delete legacyDocument.theme.colorSchemes.light.playerOutlineVariant
      delete legacyDocument.theme.colorSchemes.dark.playerOutlineVariant
      const legacy = codec.deserializeAppearanceTheme(JSON.stringify(legacyDocument))
      const invalidDocument = codec.createAppearanceThemeDocument(defaultAppearance)
      invalidDocument.theme.motion.selection = { ...invalidDocument.theme.motion.selection,
        controlsDurationMs: -1, checkDrawDelayMs: 3000, checkEasing: 'not-a-curve', surprise: true }
      const invalid = codec.deserializeAppearanceTheme(JSON.stringify(invalidDocument))
      const full = codec.cloneAppearance(defaultAppearance)
      full.motion.durationScale = 1
      const normalCss = createAppearanceCssVars(full, 'light')
      const normalMotion = createAppearanceMotionRuntime(full.motion, false)
      const off = codec.cloneAppearance(full)
      off.motion.level = 'off'
      const offMotion = createAppearanceMotionRuntime(off.motion, false)
      const reducedMotion = createAppearanceMotionRuntime(full.motion, true)
      const cleanup = applyAppearanceRuntime(full, true, 'light')
      const zeroCss = [...document.documentElement.style].filter(key => key.startsWith('--selection-') && (key.endsWith('-duration') || key.endsWith('-delay')))
        .map(key => [key, document.documentElement.style.getPropertyValue(key)])
      cleanup()
      return { defaults: defaultAppearance.motion.selection, deepClone,
        roundtrip: { ok: roundtrip.ok, selection: roundtrip.appearance.motion.selection },
        legacy: { ok: legacy.ok, selection: legacy.appearance.motion.selection, outlineLight: legacy.appearance.colorSchemes.light.playerOutlineVariant,
          outlineDark: legacy.appearance.colorSchemes.dark.playerOutlineVariant },
        invalid: { ok: invalid.ok, selection: invalid.appearance.motion.selection, warnings: invalid.warnings },
        normalCss, normalMotion: normalMotion.selection, offMotion: offMotion.selection, reducedMotion: reducedMotion.selection, zeroCss }
    })
    const expected = { controlsDurationMs: 240, controlsEasing: 'cubic-bezier(.2, 0, 0, 1)', backgroundDurationMs: 180,
      checkFillDurationMs: 80, checkDrawDelayMs: 100, checkDrawDurationMs: 160, checkEasing: 'ease-out',
      dockEnterDurationMs: 480, dockEnterEasing: 'cubic-bezier(.25, 1, .5, 1)', dockCrossfadeDurationMs: 200,
      dockExitDurationMs: 220, dockExitEasing: 'ease-in' }
    assert.deepEqual(result.defaults, expected)
    assert(result.deepClone, 'selection motion is deep-cloned, not shared with a built-in theme')
    assert(result.roundtrip.ok && result.legacy.ok && result.invalid.ok)
    assert.equal(result.roundtrip.selection.controlsDurationMs, 333)
    assert.equal(result.roundtrip.selection.dockEnterDurationMs, 620)
    assert.equal(result.roundtrip.selection.checkDrawDelayMs, 222, 'import preserves a configured custom delay')
    assert.equal(result.roundtrip.selection.checkDrawDurationMs, 777, 'import preserves a configured custom duration')
    assert.equal(result.legacy.outlineLight, '#c1c7ce')
    assert.equal(result.legacy.outlineDark, '#41474d')
    assert.deepEqual(result.legacy.selection, expected, 'old themes missing selection receive safe defaults')
    assert.equal(result.invalid.selection.controlsDurationMs, expected.controlsDurationMs)
    assert.equal(result.invalid.selection.checkDrawDelayMs, expected.checkDrawDelayMs)
    assert.equal(result.invalid.selection.checkEasing, expected.checkEasing)
    assert(result.invalid.warnings.some(warning => warning.includes('surprise')))
    assert.equal(result.normalCss['--selection-check-draw-delay'], '100ms')
    assert.equal(result.normalCss['--selection-check-draw-duration'], '160ms')
    assert.equal(result.normalMotion.dockEnter.duration, 0.48)
    assert.deepEqual(result.normalMotion.dockEnter.ease, [0.25, 1, 0.5, 1])
    for (const runtime of [result.offMotion, result.reducedMotion]) {
      for (const transition of Object.values(runtime)) assert.equal(transition.duration, 0)
    }
    assert(result.zeroCss.length >= 8)
    assert(result.zeroCss.every(([, value]) => value === '0ms'), 'system reduced motion zeroes every selection duration and delay')
    writeFileSync(join(evidenceDirectory, 'theme-contract.json'), JSON.stringify(result, null, 2))
    passed++; console.log('PASS theme: defaults, legacy imports, deep clone, validation, roundtrip, runtime and reduced motion')
  } finally { await page.close() }
}

const activeDock = page => page.locator('.playlist-playback-dock:not([data-dock-superseded])')
async function selectionHelp(page) {
  await activeDock(page).getByRole('button', { name: '选择帮助', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '选择帮助', exact: true })
  await dialog.waitFor()
  return dialog
}
async function enterSelection(context) {
  await context.page.getByRole('button', { name: '选择', exact: true }).first().click()
  await context.grid.locator('.playlist-card[data-select-mode="true"]').first().waitFor()
  await activeDock(context.page).locator('.playlist-selection-panel').waitFor()
}
async function settledPanel(page) {
  await page.waitForFunction(() => {
    const panel = document.querySelector('.playlist-playback-dock:not([data-dock-superseded]) .playlist-selection-panel[data-selection-phase="active"]')
    if (!panel) return false
    const style = getComputedStyle(panel)
    return Number(style.opacity) > 0.999 && Math.abs(new DOMMatrixReadOnly(style.transform).m42) < 0.2
  })
}
async function installOwnerGuard(page) {
  await page.evaluate(() => {
    window.retainedSelectionDock = document.querySelector('.playlist-playback-dock:not([data-dock-superseded])')
    window.retainedSelectionCanvas = window.retainedSelectionDock.querySelector('canvas')
  })
}
async function assertOwner(context, baseline) {
  const after = await checkpoint(context)
  assert.equal(after.ownerCount, 1)
  assert.deepEqual(after.meter, baseline.meter, 'selecting neither remounts dock nor reacquires/releases its artwork')
  assert.deepEqual(after.pixel, baseline.pixel)
  assert(await context.page.evaluate(() => document.querySelector('.playlist-playback-dock:not([data-dock-superseded])') === window.retainedSelectionDock
    && window.retainedSelectionDock.querySelector('canvas') === window.retainedSelectionCanvas))
}
async function panelMetrics(context) {
  return context.page.evaluate(() => {
    const panel = document.querySelector('.playlist-selection-panel')
    if (!panel) return null
    const style = getComputedStyle(panel)
    return { y: new DOMMatrixReadOnly(style.transform).m42, opacity: Number(style.opacity), phase: panel.dataset.selectionPhase,
      inert: panel.inert, hidden: panel.getAttribute('aria-hidden') }
  })
}
async function assertZeroMotion(context, systemReduced) {
  await context.page.waitForFunction(() => [...document.documentElement.style].filter(key => key.startsWith('--selection-') && (key.endsWith('-duration') || key.endsWith('-delay')))
    .every(key => document.documentElement.style.getPropertyValue(key) === '0ms'))
  await context.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const panel = await panelMetrics(context)
  assert(panel && Math.abs(panel.y) < 0.2 && panel.opacity > 0.999, `${systemReduced ? 'system reduced' : 'off'} immediately finishes a running panel`)
  assert.equal(await activeDock(context.page).locator('.playlist-selection-playback-layer').getAttribute('inert'), '')
  const checkState = await context.grid.locator('.playlist-card').nth(1).evaluate(card => {
    const fill = card.querySelector('.playlist-card-checkbox-fill')
    const path = card.querySelector('.playlist-card-checkbox-check path')
    return { fill: Number(getComputedStyle(fill).opacity), dash: parseFloat(getComputedStyle(path).strokeDashoffset) }
  })
  assert(checkState.fill > 0.999 && checkState.dash < 0.001)
}

async function checkSelectionMotion(kind) {
  await check(kind + ': enter/exit, owner identity, immediate semantics and interruption', kind, async context => {
    const { page, grid } = context
    const baseline = await checkpoint(context)
    await installOwnerGuard(page)
    await page.evaluate(() => {
      window.selectionTrajectory = []
      const start = performance.now()
      const sample = () => {
        const panel = document.querySelector('.playlist-selection-panel')
        if (panel) {
          const style = getComputedStyle(panel)
          window.selectionTrajectory.push({ elapsed: performance.now() - start, y: new DOMMatrixReadOnly(style.transform).m42, opacity: Number(style.opacity) })
        }
        if (performance.now() - start < 900) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await enterSelection(context)
    assert.equal(await activeDock(page).locator('.playlist-selection-count').textContent(), '0/1000')
    assert.equal(await activeDock(page).getAttribute('aria-label'), '歌曲选择')
    assert.equal(await activeDock(page).locator('.playlist-selection-playback-layer').getAttribute('aria-hidden'), 'true')
    assert.equal(await activeDock(page).locator('.playlist-selection-playback-layer').getAttribute('inert'), '')
    assert.equal(await page.locator('.playlist-selection-bar').count(), 0, 'count moved into dock without inserting a grid row')
    await settledPanel(page)
    const after = await checkpoint(context)
    assert.equal(after.cardHeight, baseline.cardHeight)
    assert.equal(after.scrollTop, baseline.scrollTop)
    await assertOwner(context, baseline)
    const trace = await page.evaluate(() => window.selectionTrajectory)
    assert(trace.some(sample => sample.y > 5), 'panel actually travels up from below, rather than appearing immediately')
    assert(trace.some(sample => sample.opacity > 0 && sample.opacity < 0.99), 'crossfade has observable intermediate frames')
    writeFileSync(join(evidenceDirectory, kind + '-entry-trajectory.json'), JSON.stringify(trace, null, 2))
    await page.evaluate(() => { window.retainedSelectionPanel = document.querySelector('.playlist-selection-panel') })
    await grid.locator('.playlist-card').nth(1).click()
    assert.equal(await grid.locator('.playlist-card').nth(1).getAttribute('aria-pressed'), 'true')
    assert.equal(await activeDock(page).locator('.playlist-selection-count').textContent(), '1/1000')
    assert(await page.evaluate(() => document.querySelector('.playlist-selection-panel') === window.retainedSelectionPanel), 'single check does not remount/replay the dock entry')
    assert(Math.abs((await panelMetrics(context)).y) < 0.2)
    await page.waitForFunction(() => {
      const path = document.querySelector('.playlist-card[data-selected="true"] .playlist-card-checkbox-check path')
      return path && parseFloat(getComputedStyle(path).strokeDashoffset) < 0.001
    })
    await page.screenshot({ path: join(evidenceDirectory, kind + '-selected.png') })
    await page.evaluate(() => {
      window.selectionExitEvidence = []
      const capture = () => {
        const panel = document.querySelector('.playlist-selection-panel')
        if (panel) window.selectionExitEvidence.push({ phase: panel.dataset.selectionPhase, inert: panel.inert, hidden: panel.getAttribute('aria-hidden'), connected: panel.isConnected })
      }
      window.selectionExitObserver = new MutationObserver(capture)
      window.selectionExitObserver.observe(document.body, { attributes: true, childList: true, subtree: true })
    })
    await activeDock(page).getByRole('button', { name: '退出选择', exact: true }).click()
    await grid.locator('.playlist-card:not([data-select-mode])').first().waitFor()
    await page.waitForFunction(() => !document.querySelector('.playlist-selection-panel'))
    const exitEvidence = await page.evaluate(() => { window.selectionExitObserver.disconnect(); return window.selectionExitEvidence })
    assert(exitEvidence.some(sample => sample.phase === 'exiting' && sample.inert && sample.hidden === 'true' && sample.connected), 'exit keeps only a visual inert copy')
    assert.equal(await activeDock(page).locator('.playlist-selection-playback-layer').getAttribute('inert'), null)
    await assertOwner(context, baseline)
    // Reverse while still entering; there must be one owner and no stale inert state.
    await enterSelection(context)
    await page.evaluate(async () => {
      document.querySelector('.playlist-selection-panel [aria-label="退出选择"]').click()
      await new Promise(requestAnimationFrame)
      const toggle = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '选择')
      if (!toggle) throw Error('selection toggle remains available while the exiting panel is inert')
      toggle.click()
    })
    await settledPanel(page)
    assert.equal(await page.locator('.playlist-selection-panel').count(), 1)
    await assertOwner(context, baseline)
  })

  await check(kind + ': staged fill/check and actual selection actions', kind, async context => {
    const { page, grid } = context
    await enterSelection(context); await settledPanel(page)
    let help = await selectionHelp(page)
    assert.equal(await help.getByRole('button', { name: '播放选中', exact: true }).isDisabled(), true)
    await page.keyboard.press('Escape')
    const target = grid.locator('.playlist-card').nth(2)
    await target.evaluate(async card => {
      card.click()
      await new Promise(requestAnimationFrame)
      getComputedStyle(card.querySelector('.playlist-card-checkbox-fill')).opacity
      window.cardSelectionAnimations = card.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSTransition
        && (animation.effect.target.matches('.playlist-card-checkbox-fill,.playlist-card-checkbox-icon')
          || animation.effect.target.matches('.playlist-card-checkbox-check path')))
      for (const animation of window.cardSelectionAnimations) { animation.pause(); animation.currentTime = 0 }
    })
    assert.equal(await target.getAttribute('aria-pressed'), 'true')
    assert.equal(await activeDock(page).locator('.playlist-selection-count').textContent(), '1/1000')
    const phases = await page.evaluate(() => {
      const card = document.querySelector('.playlist-card[data-selected="true"]')
      const fill = card.querySelector('.playlist-card-checkbox-fill'), path = card.querySelector('.playlist-card-checkbox-check path')
      const timings = window.cardSelectionAnimations.map(animation => ({ property: animation.transitionProperty, ...animation.effect.getTiming() }))
      const samples = []
      for (const time of [0, 90, 180, 260]) {
        for (const animation of window.cardSelectionAnimations) animation.currentTime = time
        samples.push({ time, fill: Number(getComputedStyle(fill).opacity), dash: parseFloat(getComputedStyle(path).strokeDashoffset) })
      }
      return { timings, samples }
    })
    assert(phases.timings.some(timing => timing.property === 'opacity' && timing.duration === 80))
    assert(phases.timings.some(timing => timing.property === 'stroke-dashoffset' && timing.delay === 100 && timing.duration === 160))
    assert(phases.samples[0].fill < 0.01 && phases.samples[0].dash > 0.99)
    assert(phases.samples[1].fill > 0.99 && phases.samples[1].dash > 0.99, 'fill finishes before the delayed tick starts')
    assert(phases.samples[2].dash > 0 && phases.samples[2].dash < 1)
    assert(phases.samples[3].fill > 0.99 && phases.samples[3].dash < 0.01)
    writeFileSync(join(evidenceDirectory, kind + '-check-phases.json'), JSON.stringify(phases, null, 2))
    help = await selectionHelp(page)
    await help.getByRole('button', { name: '播放选中', exact: true }).click()
    await page.waitForFunction(() => window.viewModel.playback.track?.id === 'many-2' && !window.viewModel.playback.isSelectionPending)
    help = await selectionHelp(page)
    await help.getByRole('button', { name: '清除选中', exact: true }).click()
    help = await selectionHelp(page)
    assert.equal(await help.getByRole('button', { name: '播放选中', exact: true }).isDisabled(), true)
    await page.keyboard.press('Escape')
    assert.equal(await activeDock(page).locator('.playlist-selection-count').textContent(), '0/1000')
    await activeDock(page).getByRole('button', { name: '全选', exact: true }).click()
    assert.equal(await activeDock(page).locator('.playlist-selection-count').textContent(), '1000/1000')
    await activeDock(page).getByRole('button', { name: '全选', exact: true }).click()
    assert.equal(await activeDock(page).locator('.playlist-selection-count').textContent(), '0/1000')
    if (kind === 'songs') {
      await grid.locator('.playlist-card').nth(1).click()
      help = await selectionHelp(page)
      await help.getByRole('button', { name: '新建播放列表', exact: true }).click()
      await page.getByRole('dialog', { name: '新建播放列表', exact: true }).waitFor()
    }
  })
}

try {
  await checkThemeContract()
  // Baseline fixture/owner evidence can run before the selection implementation.
  // Animation/theme contract assertions are added after UI/Architecture approval.
  for (const kind of process.env.SPMUSIC_SELECTION_THEME_ONLY === '1' ? [] : ['playlist', 'songs']) await check(kind + ': real owned artwork baseline', kind, async context => {
    const baseline = await checkpoint(context)
    assert.equal(baseline.ownerCount, 1)
    assert(baseline.meter.retains > 0, 'observe the actual artwork resource retain hook')
    assert.deepEqual(baseline.pixel, [255, 0, 0, 255])
    writeFileSync(join(evidenceDirectory, kind + '-baseline.json'), JSON.stringify(baseline, null, 2))
  })
  if (process.env.SPMUSIC_SELECTION_THEME_ONLY !== '1') {
    for (const kind of ['playlist', 'songs']) await checkSelectionMotion(kind)
    for (const systemReduced of [false, true]) await check('running animation responds immediately to ' + (systemReduced ? 'system reduce' : 'motion off'), 'playlist', async context => {
      await enterSelection(context)
      await context.grid.locator('.playlist-card').nth(1).click()
      if (systemReduced) await context.page.emulateMedia({ reducedMotion: 'reduce' })
      else await context.page.evaluate(() => { const theme = structuredClone(window.themeApi.appearance); theme.motion.level = 'off'; window.themeApi.previewAppearance(theme) })
      await assertZeroMotion(context, systemReduced)
      await activeDock(context.page).getByRole('button', { name: '退出选择', exact: true }).click()
      await context.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await context.page.locator('.playlist-selection-panel').count(), 0, 'reduced exit must not retain a delayed panel')
    })
  }
  console.log('SELECTION_MOTION_REGRESSION_PASS', passed)
} finally { await browser.close() }
