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
const fixture = runInNewContext(fixtureLiteral[1], { dependency }).replace('if(!covers)return new Uint8Array(0);', 'if(!covers || (command==="audio_load_track_thumbnail" && input.sourcePath.endsWith("/0.flac")))return new Uint8Array(0);')
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__collection_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__collection_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
    await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
    await page.route('**/__collection_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
    await page.route('**/__collection_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
    await page.route('**/__collection_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.addInitScript(() => localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'))
    await page.goto(origin + '/__collection_test?cover=1&large=1')
    await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 180)

  await page.locator('.media-library-category[data-category-id="folder"]').click()
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  const card = page.locator('.folder-row[data-folder-path="/big"]')
  await card.locator('.folder-cover-image').waitFor()
  const requests = () => page.evaluate(() => window.calls.filter(call => call.command === 'audio_load_track_thumbnail' && call.input.sourcePath.startsWith('/big/')).map(call => call.input.sourcePath))
  assert.deepEqual(await requests(), ['/big/0.flac', '/big/1.flac'], 'missing first candidate falls through and stops on the first available cover')
  const source = await card.locator('.folder-cover-image').getAttribute('src')
  await card.click()
  await page.locator('.playlist-hero-image').waitFor()
  assert.equal(await page.locator('.playlist-hero-image').getAttribute('src'), source, 'hero reuses the directory cover key and decoded image')
  await page.getByRole('button', { name: '返回上一级文件夹', exact: true }).click()
  await card.locator('.folder-cover-image').waitFor()
  assert.equal(await card.locator('.folder-cover-image').getAttribute('src'), source, 'return keeps the selected folder artwork')
  assert.deepEqual(errors, [], 'no runtime errors')
  console.log('PASS 180 direct songs: first missing, second cover, hero and card share decoded artwork')
} finally { await browser.close() }
