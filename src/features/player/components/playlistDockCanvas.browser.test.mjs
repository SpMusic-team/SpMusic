// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright installation.
// SPMUSIC_DOCK_BASELINE=1 removes only the real surface-to-dock cover handoff.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve ${name}`)
  return match[1]
}
const shared = readFileSync(new URL('./playlistManagementMotion.browser.test.mjs', import.meta.url), 'utf8')
const fixtureLiteral = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(fixtureLiteral, 'reuse the real shell/native transport fixture')
const fixture = runInNewContext(fixtureLiteral[1], { dependency })
  .replace('filePath:fixtureCover,byteLen:1,dataUrl:fixtureCover',
    "filePath:'/covers/'+scope+'/'+i+'.png',byteLen:1,dataUrl:null")
  .replace('coverArt:{mimeType:', "coverArt:window.config.noCoverId===scope+'-'+i?null:{mimeType:")
assert(fixture.includes("filePath:'/covers/'+scope+'/'+i+'.png'"), 'supply decoded pixels without an image URL fallback')
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,
    'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/,
    'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const oldPaint = 'bytes.set(color,40+(y*width+x)*4)'
assert(fixture.includes(oldPaint), 'distinguish a second song by its decoded pixels')
const coloredFixture = fixture.replace(oldPaint,
  "bytes.set(input?.filePath?.endsWith('/1.png')?[20,180,40,255]:color,40+(y*width+x)*4)")
const originalSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = process.env.SPMUSIC_DOCK_BASELINE === '1'
  ? originalSurface.replace('coverLayer: dockArtworkLayer,', 'coverLayer: null,') : originalSurface
if (process.env.SPMUSIC_DOCK_BASELINE === '1') assert.notEqual(surface, originalSurface)
const surfaceWrapper = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__dock_canvas_real_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__dock_canvas_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(() => localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surfaceWrapper }))
await page.route('**/__dock_canvas_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__dock_canvas_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: coloredFixture }))
await page.route('**/__dock_canvas_test', route => route.fulfill({ contentType: 'text/html', body: html }))

try {
  await page.goto(origin + '/__dock_canvas_test')
  await page.waitForFunction(() => Boolean(window.viewModel))
  await page.evaluate(() => { window.config.noCoverId = 'a-2'; window.config.count = 4 })
  await page.evaluate(() => window.viewModel.playback.onOpenAudio())
  await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isAudioBusy)
  await page.locator('.media-library-category[data-category-id="playlists"]').click()
  await page.getByRole('button', { name: '打开播放列表 Playlist a', exact: true }).click()
  await page.locator('.playlist-playback-track[data-swipe-plane="current"]').waitFor()
  await page.waitForFunction(() => document.querySelector('.playlist-playback-track[data-swipe-plane="current"]')?.textContent.includes('Song a 0'))
  const sampleFrames = await page.evaluate(async () => {
    const frames = []
    const sample = () => {
      const track = document.querySelector('.playlist-playback-track[data-swipe-plane="current"]')
      const cover = track?.querySelector('.playlist-playback-cover')
      const canvas = cover?.querySelector('canvas')
      const pixels = canvas?.width && canvas?.height
        ? canvas.getContext('2d')?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data : null
      let opacity = canvas ? 1 : 0
      for (let node = canvas; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        opacity *= Number(style.opacity)
        if (style.visibility === 'hidden' || style.display === 'none') opacity = 0
      }
      frames.push({ time: performance.now(), track: track?.textContent, state: track?.dataset.coverState,
        canvas: Boolean(canvas), opacity, alpha: pixels?.[3] ?? 0, rgb: pixels ? [...pixels].slice(0, 3) : null,
        image: Boolean(cover?.querySelector('img')), placeholder: Boolean(cover?.querySelector('.playlist-playback-cover-mark')) })
    }
    sample()
    window.viewModel.playlist.onTrackSelect('a-1')
    const deadline = performance.now() + 1500
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame)
      sample()
      if (frames.some(frame => frame.track?.includes('Song a 1')) && frames.length > 8) break
    }
    return frames
  })
  const incoming = sampleFrames.filter(frame => frame.track?.includes('Song a 1'))
  assert(incoming.length > 0, 'selection updates the dock')
  const first = incoming[0]
  const summary = { first, selectionToNewFrameMs: first.time - sampleFrames[0].time,
    incomingFrames: incoming.length, blankFrames: incoming.filter(frame => frame.opacity <= 0 || frame.alpha === 0).length,
    pixels: incoming.map(frame => frame.rgb) }
  console.log('DOCK_CANVAS', JSON.stringify(summary))
  if (process.env.SPMUSIC_DOCK_BASELINE === '1') {
    assert(first.opacity <= 0 || first.alpha === 0 || first.placeholder, 'isolated missing handoff exposes an empty or placeholder first frame')
  } else {
    assert.equal(first.state, 'ready', 'new current track never paints a loading cover state')
    assert(first.canvas && first.opacity > 0 && first.alpha > 0, 'dock canvas has visible nontransparent pixels on the first new-track frame')
    assert.equal(summary.blankFrames, 0, 'no incoming dock frame loses cover pixels')
    assert(incoming.some(frame => frame.rgb?.join(',') === '20,180,40'), 'dock hands off to the selected song pixels')
    await page.evaluate(() => window.viewModel.playlist.onTrackSelect('a-2'))
    await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-2'
      && document.querySelector('.playlist-playback-track[data-swipe-plane="current"]')?.textContent.includes('Song a 2'))
    const empty = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
      const track = document.querySelector('.playlist-playback-track[data-swipe-plane="current"]')
      return { state: track?.dataset.coverState, canvas: Boolean(track?.querySelector('.playlist-playback-cover-canvas')),
        placeholder: Boolean(track?.querySelector('.playlist-playback-cover-mark')) }
    })
    assert.deepEqual(empty, { state: 'empty', canvas: false, placeholder: true }, 'genuine missing artwork drops the former canvas')
    await page.evaluate(() => window.viewModel.playlist.onTrackSelect('a-0'))
    await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isSelectionPending)
    await page.evaluate(() => window.viewModel.playlist.onTrackSelect('a-1'))
    await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-1')
    const rapid = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
      const track = document.querySelector('.playlist-playback-track[data-swipe-plane="current"]')
      const canvas = track?.querySelector('.playlist-playback-cover-canvas')
      const rgba = canvas?.getContext('2d')?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
      return { state: track?.dataset.coverState, rgb: rgba ? [...rgba].slice(0, 3) : null, alpha: rgba?.[3] ?? 0 }
    })
    assert.deepEqual(rapid, { state: 'ready', rgb: [20, 180, 40], alpha: 255 }, 'rapid subsequent selection paints only the final track pixels')
    await page.evaluate(() => window.viewModel.playlist.onOpenChange(false))
    await page.locator('.player-stage .cover-image').first().waitFor()
    const ambientMain = await page.evaluate(async () => {
      const samples = []
      const read = selector => [...document.querySelectorAll(selector)].map(canvas => {
        const rgba = canvas.width && canvas.height
          ? canvas.getContext('2d')?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data : null
        let opacity = 1
        for (let node = canvas; node; node = node.parentElement) {
          const style = getComputedStyle(node)
          opacity *= Number(style.opacity)
          if (style.visibility === 'hidden' || style.display === 'none') opacity = 0
        }
        return { rgb: rgba ? [...rgba].slice(0, 3).join(',') : null, alpha: rgba?.[3] ?? 0, opacity }
      })
      window.viewModel.playlist.onTrackSelect('a-3')
      const start = performance.now()
      while (performance.now() - start < 750) {
        await new Promise(requestAnimationFrame)
        const ambient = read('.ambient-cover-image')
        const main = read('.track-card-plane .cover-image')
        const target = pixels => pixels.rgb === '150,42,170' && pixels.alpha > 0 && pixels.opacity > .05
        samples.push({ time: performance.now() - start, ambientTarget: ambient.some(target), mainTarget: main.some(target),
          trackId: window.viewModel.playback.track?.id })
      }
      return samples
    })
    const ambientAhead = ambientMain.filter(frame => frame.ambientTarget && !frame.mainTarget)
    console.log('AMBIENT_MAIN', JSON.stringify({ frames: ambientMain.length, ambientAhead: ambientAhead.length,
      firstAmbientMs: ambientMain.find(frame => frame.ambientTarget)?.time ?? null,
      firstMainMs: ambientMain.find(frame => frame.mainTarget)?.time ?? null }))
    assert(ambientMain.some(frame => frame.ambientTarget && frame.mainTarget), 'cold target eventually paints both ambient and main canvas')
    assert.equal(ambientAhead.length, 0, 'new ambient pixels never precede visible target cover pixels')
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
