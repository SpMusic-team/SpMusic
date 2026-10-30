// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright package.
// Exercise the real PlayerSurface -> PlaylistPlaybackDock artwork handoff.
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
assert(fixtureLiteral, 'reuse the native playback shell fixture')
const fixture = runInNewContext(fixtureLiteral[1], { dependency })
  .replace('filePath:fixtureCover,byteLen:1,dataUrl:fixtureCover',
    "filePath:'/covers/'+scope+'/'+i+'.png',byteLen:1,dataUrl:null")
  .replace('bytes.set(color,40+(y*width+x)*4)',
    "bytes.set(input?.filePath?.endsWith('/1.png')||input?.sourcePath?.endsWith('/1.flac')?[20,180,40,255]:color,40+(y*width+x)*4)")
  .replace("if(command==='audio_load_playlist_cover_pixels'||command==='audio_load_cover_pixels'){",
    "if(command==='audio_load_playlist_cover_pixels'||command==='audio_load_track_thumbnail'||command==='audio_load_cover_pixels'){if(window.config.failCover && (input?.filePath?.endsWith('/1.png')||input?.sourcePath?.endsWith('/1.flac')))throw {code:'NO_COVER_ART',message:'fixture cover failure',recoverable:false};")
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,
    'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/,
    'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__dock_swipe_real_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}`
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__dock_swipe_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
const errors = []
page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR', error.message) })
await page.addInitScript(() => localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__dock_swipe_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__dock_swipe_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__dock_swipe_test', route => route.fulfill({ contentType: 'text/html', body: html }))

const current = '.playlist-playback-track[data-swipe-plane="current"]'
async function frames() {
  return page.evaluate(() => {
    window.dockSwipeSampling = false
    return window.dockSwipeFrames
  })
}
async function startFrames() {
  await page.evaluate(() => {
    window.dockSwipeFrames = []
    window.dockSwipeSampling = true
    const generation = window.dockSwipeGeneration = (window.dockSwipeGeneration ?? 0) + 1
    const sample = () => {
      if (window.dockSwipeGeneration !== generation) return
      const row = document.querySelector('.playlist-playback-track[data-swipe-plane="current"]')
      const canvas = row?.querySelector('.playlist-playback-cover-canvas')
      const rgba = canvas?.width && canvas?.height
        ? canvas.getContext('2d')?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data : null
      window.dockSwipeFrames.push({ id: window.viewModel.playback.track?.id, title: row?.querySelector('strong')?.textContent,
        rgb: rgba ? [...rgba].slice(0, 3).join(',') : null,
        image: row?.querySelector('img')?.getAttribute('src') ?? null,
        state: row?.dataset.coverState })
      if (window.dockSwipeSampling) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}
async function swipe(direction, target) {
  await startFrames()
  const box = await page.locator(current).boundingBox()
  const x = box.x + box.width * (direction > 0 ? .75 : .25)
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - direction * box.width * .42, y, { steps: 5 })
  await page.locator('.playlist-playback-track[data-swipe-plane="neighbor"]').waitFor()
  await page.mouse.up()
  await page.waitForFunction(id => window.viewModel.playback.track?.id === id && !window.viewModel.playback.isSelectionPending, target)
  await page.waitForTimeout(250)
  const sampled = await frames()
  const incoming = sampled.filter(frame => frame.id === target && frame.title?.includes(`Song ${target.replace('-', ' ')}`))
  assert(incoming.length > 0, `drag commits ${target}`)
  const expected = target === 'a-1' ? '20,180,40' : '150,42,170'
  assert(incoming.every(frame => process.env.SPMUSIC_DOCK_FAIL_COVER === '1' ? frame.rgb === null && frame.state === 'empty' : frame.rgb === expected),
    `every committed frame has the target cover or its resolved empty state: ${JSON.stringify(incoming)}`)
  return incoming
}
async function select(target) {
  await startFrames()
  await page.evaluate(id => window.viewModel.playlist.onTrackSelect(id), target)
  await page.waitForFunction(id => window.viewModel.playback.track?.id === id && !window.viewModel.playback.isSelectionPending, target)
  await page.waitForTimeout(250)
  const sampled = await frames()
  const incoming = sampled.filter(frame => frame.id === target && frame.title?.includes(`Song ${target.replace('-', ' ')}`))
  assert(incoming.length > 0, `selection commits ${target}`)
  const expected = target === 'a-1' ? '20,180,40' : '150,42,170'
  assert(incoming.every(frame => frame.rgb === expected),
    `selection paints only the target cover: ${JSON.stringify(incoming)}`)
  return incoming
}

try {
  await page.goto(origin + '/__dock_swipe_test')
  await page.waitForFunction(() => Boolean(window.viewModel))
  await page.evaluate(failCover => { window.config.count = 3; window.config.failCover = failCover; window.viewModel.playback.onOpenAudio() }, process.env.SPMUSIC_DOCK_FAIL_COVER === '1')
  await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isAudioBusy)
  await page.locator('.media-library-category[data-category-id="playlists"]').click()
  await page.getByRole('button', { name: '打开播放列表 Playlist a', exact: true }).click()
  await page.locator(current).waitFor()
  for (const [direction, target] of (process.env.SPMUSIC_DOCK_FAIL_COVER === '1' ? [[1, 'a-1']] : [[1, 'a-1'], [-1, 'a-0'], [1, 'a-1']])) {
    const incoming = await swipe(direction, target)
    console.log('DOCK_SWIPE', JSON.stringify({ target, incomingFrames: incoming.length,
      canvasColors: [...new Set(incoming.map(frame => frame.rgb))], imageSources: [...new Set(incoming.map(frame => frame.image))] }))
  }
  for (const target of (process.env.SPMUSIC_DOCK_FAIL_COVER === '1' ? [] : ['a-0', 'a-1'])) {
    const incoming = await select(target)
    console.log('DOCK_SELECT', JSON.stringify({ target, incomingFrames: incoming.length,
      canvasColors: [...new Set(incoming.map(frame => frame.rgb))], imageSources: [...new Set(incoming.map(frame => frame.image))] }))
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
