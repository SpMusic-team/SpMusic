// Real PlayerShell/PlayerSurface pointer path; only native transport is controlled.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const server = await createServer({ cacheDir: mkdtempSync(path.join(tmpdir(), 'spmusic-stream-player-vite-')), server: { host: '127.0.0.1', port: 5184, strictPort: true } })
const evidenceDir = path.join(tmpdir(), 'spmusic-stream-player-evidence')
mkdirSync(evidenceDir, { recursive: true })
let browser
const report = [], errors = []
try {
  await server.listen()
  const origin = 'http://127.0.0.1:5184'
  const main = await (await fetch(origin + '/src/main.tsx')).text()
  const dependency = name => {
    const match = main.match(new RegExp('"(/[^"\\n]+/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
    assert(match, `resolve Vite dependency ${name}`)
    return match[1]
  }
  const shared = readFileSync(new URL('./streamAuthor.browser.test.mjs', import.meta.url), 'utf8')
  const literal = shared.match(/const fixture = (`[^]*?`)\r?\nconst html/)
  assert(literal, 'reuse native transport fixture, not another test suite')
  const fixture = runInNewContext(literal[1], { dependency })
    + "\nimport * as diagnostics from '/src/features/player/diagnostics/playerDragDiagnostics.ts';window.diag=diagnostics;"
  const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
    .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
    .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
  assert(service.includes('window.backendInvoke'))
  const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
  const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__real_stream_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
  const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__stream_player_fixture.js"')
  browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  await page.routeWebSocket(origin.replace('http:', 'ws:') + '/**', socket => socket.close())
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__real_stream_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__stream_player_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__stream_player_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.addInitScript(() => {
    localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
    localStorage.setItem('spmusic.streams.layout-level.v1', '4')
  })
  const streamUrl = 'https://example.test/groovesalad-128-aac?Key=Preserved'
  const active = category => page.locator(`.playlist-management-content[data-library-category="${category}"]:not([inert])`)
  const fullArtist = () => page.locator('.track-card-plane[data-track-card-phase="active"] .artist-pill').last()
  const fullDock = () => page.locator('.control-dock:visible').last()
  async function select(category, id) {
    await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
    await active(category).locator(`[data-playlist-track-id="${id}"]`).click()
    await page.waitForFunction(id => window.vm.playback.track?.id === id && !window.vm.playback.isSelectionPending, id)
  }
  async function openFull() {
    await page.locator('.playlist-playback-dock:not([inert]) .playlist-playback-track-button').click()
    await fullArtist().waitFor({ state: 'visible' })
    await page.waitForFunction(() => [...document.querySelectorAll('.track-card-plane[data-track-card-phase="active"] .cover-frame')].some(node => node.getBoundingClientRect().width > 0))
  }
  async function railVisibility() {
    return fullDock().evaluate(node => Object.fromEntries(['slider-track', 'slider-range', 'slider-thumb'].map(slot => {
      const element = node.querySelector(`[data-slot="${slot}"]`)
      return [slot, element && { visibility: getComputedStyle(element).visibility, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }]
    })))
  }
  async function gesture(direction, fraction = .55, cancel = false) {
    await page.waitForFunction(() => {
      const active = [...document.querySelectorAll('.track-card-plane[data-track-card-phase="active"] .title-pill')].at(-1)
      return active?.getAttribute('aria-label') === `${window.vm.playback.track?.title}，更多操作`
        && !document.querySelector('.track-card-plane[data-track-card-phase="incoming"],.track-card-plane[data-track-card-phase="preview"]')
    })
    const cover = page.locator('.track-card-plane[data-track-card-phase="active"] .cover-frame').last()
    const b = await cover.boundingBox()
    assert(b && b.width > 0, 'actual full cover input region')
    const x = b.x + b.width * (direction === 1 ? .78 : .22), y = b.y + b.height * .4
    const hit = await page.evaluate(({x,y}) => { const n=document.elementFromPoint(x,y);return {tag:n?.tagName,classes:n?.className,frame:!!n?.closest('.cover-frame'),deck:!!n?.closest('.track-card-deck')} }, {x,y})
    await page.evaluate(() => window.diag.startPlayerDragDiagnostics())
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - direction * b.width * fraction, y, { steps: 10 })
    const preview = await page.evaluate(() => ({
      planes: [...document.querySelectorAll('.track-card-plane')].map(node => ({ phase: node.dataset.trackCardPhase, layer: node.dataset.trackCardLayerId })),
      calls: window.calls.slice(-7), track: window.vm.playback.track?.id,
    }))
    if (cancel) {
      await cover.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true })
    }
    await page.mouse.up()
    const diagnostics = await page.evaluate(() => JSON.parse(window.diag.freezePlayerDragDiagnostics()))
    writeFileSync(path.join(evidenceDir, 'drag-diagnostics.json'), JSON.stringify(diagnostics, null, 2))
    return { ...preview, hit, b, diagnostics }
  }
  await page.goto(origin + '/__stream_player_test')
  await page.waitForFunction(() => window.vm?.playlist.library.streamSongs?.length >= 4 && !window.vm.playlist.library.streamsLoading)
  await select('streams', 'station')
  assert.equal(await active('streams').locator('[data-playlist-track-id="station"] .playlist-card-stream-url').innerText(), streamUrl)
  await openFull()
  const initialLine = await fullArtist().innerText()
  const initialRail = await railVisibility()
  const sourceLoadCount = await page.evaluate(() => window.calls.filter(call => call.command === 'audio_load_and_play').length)
  const preview = await gesture(1)
  let committed = false
  try { await page.waitForFunction(count => window.calls.filter(call => call.command === 'audio_load_and_play').length > count, sourceLoadCount, { timeout: 2500 }); committed = true } catch {}
  report.push({ scenario: 'initial-stream-before-author', initialLine, initialRail, preview, committed })
    assert.equal(initialLine, streamUrl)
    assert.equal(initialRail['slider-track'].visibility, 'visible')
    assert(initialRail['slider-track'].width > 0)
    for (const slot of ['slider-range', 'slider-thumb']) assert.equal(initialRail[slot].visibility, 'hidden')
    assert(committed, 'real cover pointer drag commits the neighboring stream')
    await page.waitForFunction(() => !window.vm.playback.isSelectionPending && window.vm.playback.track?.id !== 'station')
    const nextId = await page.evaluate(() => window.vm.playback.track.id)
    await gesture(-1)
    await page.waitForFunction(() => window.vm.playback.track?.id === 'station' && !window.vm.playback.isSelectionPending)
    report.push({ scenario: 'coverless-stream-forward-backward', nextId, restoredId: 'station' })
    await page.waitForFunction(() => !window.vm.playback.detailsPending
      && [...document.querySelectorAll('.track-card-plane[data-track-card-phase="active"] .title-pill')].at(-1)?.getAttribute('aria-label') === `${window.vm.playback.track?.title}，更多操作`
      && !document.querySelector('.track-card-plane[data-track-card-phase="incoming"],.track-card-plane[data-track-card-phase="preview"]'))
    await page.evaluate(() => window.publishArtist('Loaded Stream Author'))
    await page.waitForFunction(() => [...document.querySelectorAll('.track-card-plane[data-track-card-phase="active"] .artist-pill')].at(-1)?.getAttribute('aria-label') === 'Loaded Stream Author，所有艺术家歌曲')
    assert.equal(await fullArtist().getAttribute('aria-label'), 'Loaded Stream Author，所有艺术家歌曲')
    await page.evaluate(() => window.publishArtist(null))
    await page.waitForFunction(url => [...document.querySelectorAll('.track-card-plane[data-track-card-phase="active"] .artist-pill')].at(-1)?.getAttribute('aria-label') === url + '，所有艺术家歌曲', streamUrl)
    report.push({ scenario: 'full-author-loaded-and-cleared', passed: true })
    await page.screenshot({ path: path.join(evidenceDir, 'full-stream.png') })
    const beforeCancel = await page.evaluate(() => window.calls.filter(call => call.command === 'audio_load_and_play').length)
    await gesture(1, .12, true)
    await page.waitForTimeout(400)
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'audio_load_and_play').length), beforeCancel)
    report.push({ scenario: 'cover-pointer-cancel-preserves-stream', passed: true })
    // Native selection failure must leave the old stream usable for another drag.
    await page.evaluate(() => { window.failNextLoad = true })
    await gesture(1)
    await page.waitForFunction(() => !window.vm.playback.isSelectionPending && window.vm.playback.track?.id === 'station')
    await gesture(1)
    await page.waitForFunction(() => !window.vm.playback.isSelectionPending && window.vm.playback.track?.id !== 'station')
    report.push({ scenario: 'failed-cover-selection-recovers-for-next-drag', passed: true })
    await page.evaluate(() => window.vm.playlist.onOpenChange(true))
    await select('songs', 'local')
    await openFull()
    assert.equal(await fullArtist().innerText(), 'Local artist - Local album')
    const localRail = await railVisibility()
    for (const slot of ['slider-track', 'slider-range', 'slider-thumb']) assert.equal(localRail[slot].visibility, 'visible')
    report.push({ scenario: 'local-title-and-timeline-preserved', localRail })
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ passed: true, scenarios: report.map(item => item.scenario), errors, evidenceDir }, null, 2))
  writeFileSync(path.join(evidenceDir, 'final.json'), JSON.stringify({ report, errors }, null, 2))
} finally {
  if (browser) await browser.close()
  await server.close()
}
