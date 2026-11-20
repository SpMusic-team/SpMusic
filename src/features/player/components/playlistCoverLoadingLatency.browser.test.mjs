// Real shell cover-arrival and scroll regression. Only native transport is mocked.
// Start Vite; set SPMUSIC_PLAYWRIGHT to an installed Playwright package.
// Optional A/B: SPMUSIC_PLAYLIST_BASELINE_DIR contains pre-fix Vite-transformed
// PlayerShell.tsx.js and PlaylistPanel.tsx.js captured from the same Vite server.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const layoutLevel = process.env.SPMUSIC_PLAYLIST_LAYOUT_LEVEL || '2'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const shared = readFileSync(new URL('./playlistOffscreenReturn.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal, 'reuse real shell fixture')
const fixture = runInNewContext(literal[1], { dependency })
  .replace('window.calls=[];', 'window.summaryWaiters=[];window.summaryGate=true;window.calls=[];')
  .replace("if(command==='audio_probe_playlist_track_summaries')return", "if(command==='audio_probe_playlist_track_summaries'){if(window.summaryGate)await new Promise(resolve=>window.summaryWaiters.push(resolve));return")
  .replace("error:null}});\n if(command==='audio_load_playlist_cover_pixels'", "error:null}});}\n if(command==='audio_load_playlist_cover_pixels'")
  .replace('const width=80,height=50,bytes=', 'await new Promise(resolve=>setTimeout(resolve,15));const width=80,height=50,bytes=')
assert(fixture.includes('summaryWaiters.push(resolve)'))
assert(fixture.includes('setTimeout(resolve,15)'))
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>delete window.listeners[name];};')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__latency_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(Surface,props)}`
const card = (await (await fetch(origin + '/src/features/player/components/PlaylistCard.tsx')).text())
  .replace(/(function PlaylistCard\(\{[^]*?\}\) \{)/, '$1 window.coverMetrics.renders++;')
assert(card.includes('window.coverMetrics.renders++'), 'instrument actual memoized card render')
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__latency_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })

async function measure(baseline = false) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(level => {
    localStorage.setItem('spmusic.player.startup-page.v1', 'player')
    localStorage.setItem('spmusic.playlist.layout-level.v1', level)
    window.coverMetrics = { renders: 0, cardRects: 0 }
    const rect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      if (!window.skipRectMetrics && this.hasAttribute('data-playlist-track-id')) window.coverMetrics.cardRects++
      return rect.call(this)
    }
  }, layoutLevel)
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/src/features/player/components/PlaylistCard.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: card }))
  await page.route('**/__latency_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__latency_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__latency_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  if (baseline) for (const name of ['PlayerShell.tsx', 'PlaylistPanel.tsx']) {
    const body = readFileSync(join(process.env.SPMUSIC_PLAYLIST_BASELINE_DIR, name + '.js'), 'utf8')
    await page.route(`**/src/features/player/components/${name}*`, route => route.fulfill({ contentType: 'text/javascript', body }))
  }
  try {
    await page.goto(origin + '/__latency_test', { waitUntil: 'commit' })
    await page.waitForFunction(() => Boolean(window.viewModel))
    await page.evaluate(() => { window.config.count = 600; window.viewModel.playback.onOpenAudio() })
    await page.waitForFunction(() => window.summaryWaiters.length > 0 && !window.viewModel.playback.isSelectionPending)
    await page.evaluate(() => window.viewModel.playlist.onOpenChange(true))
    await page.waitForFunction(() => Boolean(document.querySelector('.playlist-loading-card')))
    await page.evaluate(() => { window.summaryGate = false; window.summaryWaiters.splice(0).forEach(resolve => resolve()) })
    await page.waitForFunction(() => document.querySelectorAll('.playlist-grid [data-playlist-track-id]').length === 600)
    // One settled frame puts initial mounting outside the measured arrival window.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.evaluate(() => { window.coverMetrics = { renders: 0, cardRects: 0 }; window.measureStart = performance.now(); window.calls = [] })
    const samples = []
    for (const fraction of [0, 0.55, 0.9, 0.2]) {
      await page.evaluate(fraction => {
        const panel = document.querySelector('.playlist-grid').closest('.playlist-panel')
        panel.scrollTop = (panel.scrollHeight - panel.clientHeight) * fraction
        window.sampleStart = performance.now()
      }, fraction)
      await page.waitForFunction(() => {
        window.skipRectMetrics = true
        const panel = document.querySelector('.playlist-grid').closest('.playlist-panel'), bounds = panel.getBoundingClientRect()
        const visible = [...panel.querySelectorAll('[data-playlist-track-id]')].filter(node => {
          const rect = node.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom - 240
        })
        const ready = visible.length > 0 && visible.every(node => node.querySelector('img')?.complete && node.querySelector('img')?.naturalWidth > 0)
        window.skipRectMetrics = false
        return ready
      })
      samples.push(await page.evaluate(fraction => ({ fraction, elapsedMs: performance.now() - window.sampleStart,
        renders: window.coverMetrics.renders, cardRects: window.coverMetrics.cardRects,
        thumbnails: window.calls.filter(call => call.command === 'audio_load_track_thumbnail').length }), fraction))
    }
    const result = await page.evaluate(() => ({ ...window.coverMetrics, elapsedMs: performance.now() - window.measureStart,
      thumbnails: window.calls.filter(call => call.command === 'audio_load_track_thumbnail').length }))
    // Resize invalidates the cached geometry. Unequal grid columns deliberately
    // fail its uniform-width validation and exercise the live-measurement path.
    await page.setViewportSize({ width: 1250, height: 850 })
    await page.evaluate(() => {
      const grid = document.querySelector('.playlist-grid')
      grid.style.gridTemplateColumns = '1fr 2fr'
      const panel = grid.closest('.playlist-panel')
      panel.scrollTop = (panel.scrollHeight - panel.clientHeight) * 0.72
    })
    await page.waitForFunction(() => {
      const grid = document.querySelector('.playlist-grid'), panel = grid.closest('.playlist-panel'), bounds = panel.getBoundingClientRect()
      const cards = [...grid.querySelectorAll('[data-playlist-track-id]')]
      const visible = cards.filter(node => { const rect = node.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom - 240 })
      return Math.abs(cards[0].offsetWidth - cards[1].offsetWidth) > 10 && visible.length > 0
        && visible.every(node => node.querySelector('img')?.complete && node.querySelector('img')?.naturalWidth > 0)
    })
    assert.deepEqual(errors, [])
    return { ...result, samples, resizedIrregularGrid: 'passed' }
  } finally { await page.close() }
}
try {
  const baseline = process.env.SPMUSIC_PLAYLIST_BASELINE_DIR ? await measure(true) : null
  const current = await measure()
  console.log(JSON.stringify({ scenario: '600-track real playlist; native thumbnail delay 15ms; four windows', layoutLevel, baseline, current }))
  if (baseline) {
    assert(current.renders < baseline.renders * 0.5, 'cover arrivals must avoid rendering the whole collection')
    if (layoutLevel === '0') assert(current.cardRects <= baseline.cardRects + 100, 'existing indexed layout does not regress')
    else assert(current.cardRects < baseline.cardRects * 0.8, 'dense cover layout uses bounded geometry measurements')
  }
  assert(current.thumbnails > 0, 'scrolling exercises real thumbnail pipeline')
} finally { await browser.close() }
