// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright package.
// Real Shell, audio player, Surface, dock, canvas and Motion; native IO is fixture data.
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
const fixture = runInNewContext(literal[1], { dependency })
  .replace('filePath:fixtureCover,byteLen:1,dataUrl:fixtureCover', "filePath:'/covers/'+scope+'/'+i+'.png',byteLen:1,dataUrl:null")
  .replace('React.createElement(AppearanceProvider,null,', 'React.createElement(AppearanceProvider,null,React.createElement(ThemeBridge),')
  + `\nimport {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
function ThemeBridge(){const context=useAppearance();window.setMotionOff=()=>context.previewAppearance({...context.appearance,motion:{...context.appearance.motion,level:'off'}});return null}`
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__drag_return_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}`
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__drag_return_fixture.js"')
let hook = await (await fetch(origin + '/src/features/player/hooks/usePlaylistControllerSwipe.ts')).text()
if (process.env.SPMUSIC_DRAG_RETURN_EARLY_DISCARD === '1') {
  const marker = hook.match(/const settleBack = async \(\) => \{\s+const currentRevision = \+\+revision;/)?.[0]
  assert(hook.includes(marker), 'explicit pre-fix counterfactual restores only early discard')
  hook = hook.replace(marker, marker + '\n      discard();')
}
const output = join(tmpdir(), 'spmusic-drag-return')
mkdirSync(output, { recursive: true })
const label = (process.env.SPMUSIC_DRAG_RETURN_LABEL || 'current').replaceAll(/[^a-z0-9-]/gi, '-')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
const current = '.playlist-playback-track[data-swipe-plane="current"]'
const neighbor = '.playlist-playback-track[data-swipe-plane="neighbor"]'
let passed = 0
async function frames(page, count = 2) {
  await page.evaluate(async count => { for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame) }, count)
}
async function open(mode) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' })
  page.setDefaultTimeout(12000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'))
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/src/features/player/hooks/usePlaylistControllerSwipe.ts*', route => route.fulfill({ contentType: 'text/javascript', body: hook }))
  await page.route('**/__drag_return_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__drag_return_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__drag_return_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__drag_return_test')
  await page.waitForFunction(() => Boolean(window.viewModel))
  if (mode === 'off') await page.evaluate(() => window.setMotionOff())
  await page.evaluate(() => window.viewModel.playback.onOpenAudio())
  await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isAudioBusy)
  await page.locator('.media-library-category[data-category-id="playlists"]').click()
  await page.getByRole('button', { name: '打开播放列表 Playlist a', exact: true }).click()
  await page.locator(current).waitFor()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.playlist-panel')).transform === 'none')
  await frames(page, 5)
  return { page, errors }
}
async function rollback(page, direction, cancel = false) {
  const box = await page.locator(current).boundingBox()
  assert(box, 'current drag row geometry')
  const x = box.x + box.width * (direction > 0 ? .75 : .25), y = box.y + box.height / 2
  const originId = await page.evaluate(() => window.viewModel.playback.track.id)
  const loads = await page.evaluate(() => window.calls.filter(call => ['audio_load_file', 'audio_load_and_play'].includes(call.command)).length)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - direction * box.width * .42, y, { steps: 5 })
  await page.waitForFunction(selector => Boolean(document.querySelector(selector + ' canvas')?.width), neighbor)
  await page.mouse.move(x - direction * box.width * .12, y, { steps: 5 })
  // Release below threshold after velocity expires, ensuring a real rollback.
  await page.waitForTimeout(130)
  await page.evaluate(() => {
    const selector = '.playlist-playback-track[data-swipe-plane="neighbor"]'
    window.returnCanvas = document.querySelector(selector + ' canvas')
    window.returnFrames = []
    window.returnSampling = true
    function sample(time) {
      if (!window.returnSampling) return
      const row = document.querySelector(selector), canvas = row?.querySelector('canvas')
      window.returnFrames.push({ time, logical: window.viewModel.playback.track.id,
        phase: document.querySelector('.playlist-controller-swipe-viewport')?.dataset.swipePhase,
        neighbor: Boolean(row), canvas: Boolean(canvas), sameCanvas: canvas === window.returnCanvas,
        rgba: canvas?.width && canvas?.height ? [...canvas.getContext('2d').getImageData(20, 20, 1, 1).data] : null,
        image: Boolean(row?.querySelector('img')) })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('.playlist-controller-swipe-viewport')?.dataset.swipePhase === 'idle')
  await frames(page, 3)
  const result = await page.evaluate(() => { window.returnSampling = false; return { frames: window.returnFrames, logical: window.viewModel.playback.track.id,
    loads: window.calls.filter(call => ['audio_load_file', 'audio_load_and_play'].includes(call.command)).length } })
  assert.equal(result.logical, originId, 'rollback retains original song')
  assert.equal(result.loads, loads, 'rollback never issues an audio selection')
  assert.equal(await page.locator(neighbor).count(), 0, 'rollback/cancel clears the preview row')
  return result
}
try {
  for (const mode of ['normal', 'reduced', 'off']) {
    if (process.env.SPMUSIC_DRAG_RETURN_MODE && process.env.SPMUSIC_DRAG_RETURN_MODE !== mode) continue
    const { page, errors } = await open(mode)
    try {
      const rounds = []
      for (const direction of [1, -1, 1]) {
        const result = await rollback(page, direction)
        const visible = result.frames.filter(frame => frame.neighbor)
        rounds.push({ direction, ...result })
        writeFileSync(join(output, `${label}-${mode}.json`), JSON.stringify(rounds, null, 2))
        console.log('DRAG_RETURN_CONTINUITY', JSON.stringify({ mode, direction, settlingFrames: visible.length,
          lostCanvasFrames: visible.filter(frame => !frame.canvas || !frame.sameCanvas).length }))
        if (mode === 'normal') assert(visible.length > 0, 'normal motion exercises a painted neighbor during rollback')
        assert(visible.every(frame => frame.canvas && frame.sameCanvas && frame.rgba?.[3] === 255), 'neighbor keeps its painted canvas until rollback removes the row')
      }
      await rollback(page, 1, true)
      assert.deepEqual(errors, [], 'no React/browser errors')
      passed++
    } finally { await page.close() }
  }
} finally { await browser.close() }
console.log(JSON.stringify({ passed }))
