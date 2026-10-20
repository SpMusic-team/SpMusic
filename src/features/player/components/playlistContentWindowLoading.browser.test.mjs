// Real shell regression for loading -> mounted grid -> scroll. Native transport
// is deterministic; the production content window, scroll listeners and images run.
// Start Vite, set SPMUSIC_PLAYWRIGHT to an existing package. No dependency added.
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
  assert(match, 'resolve ' + name)
  return match[1]
}
const shared = readFileSync(new URL('./playlistOffscreenReturn.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal, 'reuse deterministic real shell fixture')
const fixture = runInNewContext(literal[1], { dependency })
  .replace('window.calls=[];', 'window.summaryWaiters=[];window.summaryGate=true;window.calls=[];')
  .replace("if(command==='audio_probe_playlist_track_summaries')return", "if(command==='audio_probe_playlist_track_summaries'){if(window.summaryGate)await new Promise(resolve=>window.summaryWaiters.push(resolve));return")
  .replace("error:null}});\n if(command==='audio_load_playlist_cover_pixels'", "error:null}});}\n if(command==='audio_load_playlist_cover_pixels'")
assert(fixture.includes('summaryWaiters.push(resolve)'), 'hold the actual summary command')
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>delete window.listeners[name];};')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__content_window_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(Surface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__content_window_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(8000)
const errors = []
page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR', error.message) })
try {
  await page.addInitScript(() => {
    localStorage.setItem('spmusic.player.startup-page.v1', 'player')
    localStorage.setItem('spmusic.playlist.layout-level.v1', '0')
  })
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__content_window_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__content_window_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__content_window_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  if (process.env.SPMUSIC_CONTENT_WINDOW_BASELINE === '1') {
    const panel = await (await fetch(origin + '/src/features/player/components/PlaylistPanel.tsx')).text()
    const previous = panel.replace(/active: isPresent && metadataStatus !== ["']loading["']/, 'active: isPresent')
    assert.notEqual(previous, panel, 'restore only the skipped-listener lifecycle')
    await page.route('**/src/features/player/components/PlaylistPanel.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: previous }))
  }
  await page.goto(origin + '/__content_window_test', { waitUntil: 'commit' })
  await page.waitForFunction(() => Boolean(window.viewModel))
  await page.evaluate(() => { window.config.count = 200; window.viewModel.playback.onOpenAudio() })
  await page.waitForFunction(() => window.summaryWaiters.length > 0 && !window.viewModel.playback.isSelectionPending)
  await page.evaluate(() => window.viewModel.playlist.onOpenChange(true))
  await page.waitForFunction(() => Boolean(document.querySelector('.playlist-loading-card')) && !document.querySelector('.playlist-grid'))
  await page.evaluate(() => { window.summaryGate = false; window.summaryWaiters.splice(0).forEach(resolve => resolve()) })
  await page.waitForFunction(() => document.querySelectorAll('.playlist-grid [data-playlist-track-id]').length === 200)
  for (const fraction of [0.5, 0.9, 0.2]) {
    await page.evaluate(fraction => {
      const panel = document.querySelector('.playlist-grid').closest('.playlist-panel')
      panel.scrollTop = (panel.scrollHeight - panel.clientHeight) * fraction
    }, fraction)
    await page.waitForFunction(() => {
      const panel = document.querySelector('.playlist-grid').closest('.playlist-panel')
      const bounds = panel.getBoundingClientRect()
      const visible = [...panel.querySelectorAll('[data-playlist-track-id]')].filter(card => {
        const rect = card.getBoundingClientRect()
        return rect.bottom > bounds.top && rect.top < bounds.bottom - 240
      })
      return visible.length > 0 && visible.every(card => card.dataset.contentVisible === 'true' && card.querySelector('img')?.complete && card.querySelector('img')?.naturalWidth > 0)
    })
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ case: 'metadata loading -> ready binds content-window scroll listeners', tracks: 200, positions: [0.5, 0.9, 0.2], passed: true }))
} finally {
  await browser.close()
}
