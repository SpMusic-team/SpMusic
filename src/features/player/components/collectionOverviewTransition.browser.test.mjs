// Run against Vite with an existing Playwright package in SPMUSIC_PLAYWRIGHT.
// Real collection scenes and Motion run unchanged; only native transport is faked.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve Vite dependency ${name}`)
  return match[1]
}
const source = readFileSync(new URL('./flatFolders.browser.test.mjs', import.meta.url), 'utf8')
const fixtureLiteral = source.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(fixtureLiteral, 'reuse the filesystem fixture without executing its test')
const fixture = runInNewContext(fixtureLiteral[1], { dependency })
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__collection_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__collection_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
    await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
    await page.route('**/__collection_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
    await page.route('**/__collection_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
    await page.route('**/__collection_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.addInitScript(() => localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'))
    await page.goto(origin + '/__collection_test?cover=1')
    await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 40)
    for (const category of ['folder', 'folders', 'album']) {
      // Two passes also exercise retained route/projection state after a return.
      for (let pass = 0; pass < 2; pass++) {
        await page.locator(`.media-library-category[data-category-id="${category}"]`).click()
        await page.waitForFunction(() => !document.querySelector('.media-library-overview') && window.vm.playlist.library.allSongsMetadataStatus === 'ready')
        await page.locator('.playlist-management:not([inert]) .folder-row').first().waitFor()
        const frames = await page.evaluate(async () => {
          const panel = document.querySelector('.playlist-management-content:not([inert])')
          const card = panel.querySelector('.folder-row')
          const animation = card.parentElement
          const dock = document.querySelector('.playlist-playback-dock')
          const samples = []
          panel.querySelector('button[aria-label="返回媒体库"]').click()
          const started = performance.now()
          while (performance.now() - started < 650) {
            if (animation.isConnected) {
              const style = getComputedStyle(animation)
              const matrix = new DOMMatrixReadOnly(style.transform)
              samples.push({ time: performance.now() - started, x: matrix.m41, scale: matrix.a, opacity: Number(style.opacity) })
            }
            await new Promise(requestAnimationFrame)
          }
          return { samples, sameDock: dock === document.querySelector('.playlist-playback-dock'), remaining: document.querySelectorAll('.playlist-management').length }
        })
        assert(frames.sameDock, `${category}: retain playback dock`)
        assert.equal(frames.remaining, 0, `${category}: retire outgoing scenes`)
        if (reducedMotion === 'no-preference') {
          assert(frames.samples.some(frame => frame.x > 30 && frame.scale < .98 && frame.opacity < .95), `${category}: cards move right, shrink and fade like playlists: ${JSON.stringify(frames.samples)}`)
          assert(frames.samples.some(frame => frame.opacity < .15), `${category}: cards finish fading before removal`)
        }
        console.log('PASS', reducedMotion, category, pass, JSON.stringify({
          frames: frames.samples.length,
          maxTravel: Math.max(...frames.samples.map(frame => frame.x)),
          minScale: Math.min(...frames.samples.map(frame => frame.scale)),
          minOpacity: Math.min(...frames.samples.map(frame => frame.opacity)),
        }))
      }
    }
    assert.deepEqual(errors, [], 'no runtime errors')
    await page.close()
  }
} finally { await browser.close() }
