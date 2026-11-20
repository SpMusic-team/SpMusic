// Completed A -> B -> A switches, distinct from same-gesture rollback.
// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright package.
// Real Shell, audio hook, command parsers, Surface, dock and Motion; native IO is fixture data.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve ${name}`)
  return match[1]
}
const shared = readFileSync(new URL('./playlistManagementMotion.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[^]*?`)\r?\nconst html/)
assert(literal, 'reuse deterministic native playback data without running another suite')
const detailsDelay = Number(process.env.SPMUSIC_RETURN_TRACK_DETAILS_DELAY || 0)
assert(Number.isFinite(detailsDelay) && detailsDelay >= 0, 'explicit nonnegative details-event fixture delay')
const fixture = runInNewContext(literal[1], { dependency })
  .replace('filePath:fixtureCover,byteLen:1,dataUrl:fixtureCover', "filePath:'/covers/'+scope+'/'+i+'.png',byteLen:1,dataUrl:null")
  .replace('bytes.set(color,40+(y*width+x)*4)', "bytes.set(input?.filePath?.endsWith('/1.png')||input?.sourcePath?.endsWith('/1.flac')?[20,180,40,255]:[150,42,170,255],40+(y*width+x)*4)")
  .replace('}}),0);return response;', `}}),${detailsDelay});return response;`)
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__return_track_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}`
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__return_track_fixture.js"')
const output = process.env.SPMUSIC_RETURN_TRACK_OUTPUT || join(tmpdir(), 'spmusic-controller-return-track')
mkdirSync(output, { recursive: true })
const label = (process.env.SPMUSIC_RETURN_TRACK_LABEL || 'current').replaceAll(/[^a-z0-9-]/gi, '-')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
const current = '.playlist-playback-track[data-swipe-plane="current"]'
const neighbor = '.playlist-playback-track[data-swipe-plane="neighbor"]'
async function frames(page, count = 2) {
  await page.evaluate(async count => { for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame) }, count)
}
async function beginTrace(page) {
  await page.evaluate(() => {
    window.returnTrackFrames = []
    window.returnTrackSampling = true
    const ids = new WeakMap()
    let nextId = 0
    const identity = node => { if (!ids.has(node)) ids.set(node, ++nextId); return ids.get(node) }
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    function sample(time) {
      if (!window.returnTrackSampling) return
      const rows = [...document.querySelectorAll('.playlist-playback-track')].map(row => {
        const bounds = rect(row)
        const parts = ['cover', 'copy', 'toggle'].map(part => {
          const node = row.querySelector('.playlist-playback-' + part)
          if (!node) return null
          const r = rect(node), style = getComputedStyle(node)
          return { part, node: identity(node), x: r.x - bounds.x, y: r.y - bounds.y, width: r.width, height: r.height,
            opacity: Number(style.opacity), transform: style.transform, visibility: style.visibility }
        })
        const canvas = row.querySelector('canvas')
        return { node: identity(row), phase: row.dataset.swipePlane, title: row.querySelector('strong')?.textContent,
          bounds, opacity: Number(getComputedStyle(row).opacity), parts,
          canvas: canvas ? identity(canvas) : null,
          rgb: canvas?.width && canvas?.height ? [...canvas.getContext('2d').getImageData(20, 20, 1, 1).data].slice(0, 3).join(',') : null,
          image: row.querySelector('img')?.getAttribute('src') ?? null, coverState: row.dataset.coverState }
      })
      const playback = window.viewModel.playback
      window.returnTrackFrames.push({ time, logical: playback.track?.id, audioBusy: playback.isAudioBusy,
        selectionPending: playback.isSelectionPending, detailsPending: playback.detailsPending,
        phase: document.querySelector('.playlist-controller-swipe-viewport')?.dataset.swipePhase, rows })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}
async function swipe(page, direction, target) {
  const box = await page.locator(current).boundingBox()
  assert(box, 'current row exists')
  const x = box.x + box.width * (direction > 0 ? .75 : .25), y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - direction * box.width * .42, y, { steps: 5 })
  await page.waitForFunction(selector => Boolean(document.querySelector(selector + ' canvas')?.width), neighbor)
  await frames(page, 3)
  await page.mouse.up()
  await page.waitForFunction(id => window.viewModel.playback.track?.id === id && !window.viewModel.playback.isAudioBusy && !window.viewModel.playback.isSelectionPending, target)
  await page.waitForFunction(() => document.querySelector('.playlist-controller-swipe-viewport')?.dataset.swipePhase === 'idle')
  await page.waitForTimeout(500)
}
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: process.env.SPMUSIC_RETURN_TRACK_REDUCED === '1' ? 'reduce' : 'no-preference' })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => { errors.push(error.message); console.log('PAGEERROR', error.message) })
try {
  await page.addInitScript(() => localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'))
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__return_track_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__return_track_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__return_track_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__return_track_test')
  await page.waitForFunction(() => Boolean(window.viewModel))
  await page.evaluate(() => window.viewModel.playback.onOpenAudio())
  await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isAudioBusy)
  await page.locator('.media-library-category[data-category-id="playlists"]').click()
  await page.getByRole('button', { name: '打开播放列表 Playlist a', exact: true }).click()
  await page.locator(current).waitFor()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.playlist-panel')).transform === 'none')
  await page.waitForTimeout(500)
  if (process.env.SPMUSIC_RETURN_TRACK_PAUSED !== '1') {
    await page.locator(current + ' .playlist-playback-toggle').click()
    await page.waitForFunction(() => window.viewModel.playback.isPlaying && !window.viewModel.playback.isTransportBusy)
  }
  await beginTrace(page)
  await frames(page, 3)
  for (const [direction, target] of [[1, 'a-1'], [-1, 'a-0'], [1, 'a-1'], [-1, 'a-0']]) await swipe(page, direction, target)
  const result = await page.evaluate(() => { window.returnTrackSampling = false; return { frames: window.returnTrackFrames, calls: window.calls } })
  const path = join(output, label + '.json')
  writeFileSync(path, JSON.stringify(result, null, 2))
  const initial = result.frames[0].rows.find(row => row.phase === 'current')
  assert(initial, 'initial row establishes rigid content offsets')
  const issues = []
  for (const frame of result.frames) for (const row of frame.rows) {
    if (row.phase === 'current' && row.title !== 'Song ' + frame.logical.replace('-', ' '))
      issues.push({ time: frame.time, logical: frame.logical, title: row.title, phase: row.phase, type: 'stale-current-track', rgb: row.rgb })
    const expected = row.title === 'Song a 1' ? '20,180,40' : '150,42,170'
    if (row.rgb !== expected) issues.push({ time: frame.time, logical: frame.logical, title: row.title, phase: row.phase, type: 'cover-pixels', actual: row.rgb, expected })
    for (const part of row.parts.filter(Boolean)) {
      const baseline = initial.parts.find(candidate => candidate?.part === part.part)
      // The inert neighbor play button intentionally uses the disabled opacity.
      // Cover/copy remain opaque; every part must stay rigid within its row.
      if ((part.part !== 'toggle' && part.opacity < .999) || Math.abs(part.x - baseline.x) > 1 || Math.abs(part.y - baseline.y) > 1)
        issues.push({ time: frame.time, logical: frame.logical, title: row.title, phase: row.phase, type: 'projection', part, baseline })
    }
  }
  console.log('CONTROLLER_RETURN_TRACK', JSON.stringify({ frames: result.frames.length, audioLoads: result.calls.filter(call => ['audio_load_file', 'audio_load_and_play'].includes(call.command)).length,
    issues: issues.length, firstIssues: issues.slice(0, 8), path }))
  assert.deepEqual(errors, [], 'no browser/React errors')
  assert.equal(issues.length, 0, 'each row retains its target pixels and rigid fully opaque content through completed switches')
} finally {
  await page.close()
  await browser.close()
}
