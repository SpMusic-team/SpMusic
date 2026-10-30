// Real shell regression: once a song list can scroll, every row already has
// its title, artist, duration and format. Artwork remains asynchronous.
// Start Vite and point SPMUSIC_PLAYWRIGHT at an installed Playwright package.
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
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
const shared = readFileSync(new URL('./allSongs.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal, 'reuse the deterministic all-songs shell fixture')
const fixture = runInNewContext(literal[1], { dependency })
  .replace('many:Array.from({length:50}', 'many:Array.from({length:600}')
  .replace('window.calls=[];', 'window.durationGate=false;window.pendingDurations=[];window.durationFailure=false;window.calls=[];')
  .replace("if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));",
    "if(command==='audio_probe_playlist_durations'){if(window.durationGate)await new Promise(resolve=>window.pendingDurations.push(resolve));if(window.durationFailure)throw {code:'INTERNAL_ERROR',message:'injected duration failure',recoverable:true};return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));}")
assert(fixture.includes('window.pendingDurations.push(resolve)'), 'gate the actual native duration command')
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'), 'retain production command parsing')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__duration_real_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;window.librarySettings=props.librarySettings;return React.createElement(Surface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__duration_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })

async function open() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR', error.message) })
  await page.addInitScript(() => {
    localStorage.setItem('spmusic.player.startup-page.v1', 'player')
    localStorage.setItem('spmusic.playlist.layout-level.v1', '4')
    localStorage.setItem('spmusic.all-songs.layout-level.v1', '4')
  })
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__duration_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__duration_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__duration_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__duration_test')
  await page.waitForFunction(() => Boolean(window.viewModel && window.librarySettings))
  return { page, errors }
}

async function importMany(page) {
  await page.evaluate(() => { window.choice = 'many'; window.viewModel.playback.onOpenAudio() })
  await page.waitForFunction(() => !window.viewModel.playback.isAudioBusy && !window.viewModel.playback.isSelectionPending)
}

async function release(page, kind) {
  await page.evaluate(kind => {
    if (kind === 'summary') {
      window.summaryGate = false
      window.pendingSummaries.splice(0).forEach(resolve => resolve())
    } else {
      window.durationGate = false
      window.pendingDurations.splice(0).forEach(resolve => resolve())
    }
  }, kind)
}

async function assertFarRowFirstFrame(page, selector, scrollSelector, title) {
  const observation = await page.evaluate(async ({ selector, scrollSelector, title }) => {
    const row = document.querySelector(selector)
    const scroller = document.querySelector(scrollSelector)
    if (!row || !scroller) return { missing: !row ? 'row' : 'scroller' }
    scroller.scrollTop = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 100
    await new Promise(requestAnimationFrame)
    return {
      title: row.querySelector('.playlist-card-title')?.textContent,
      artist: row.querySelector('.playlist-card-artist')?.textContent,
      format: row.querySelector('.playlist-card-format')?.textContent,
      visible: row.getBoundingClientRect().top < scroller.getBoundingClientRect().bottom,
      contentVisible: row.getAttribute('data-content-visible'),
      rowTop: row.getBoundingClientRect().top,
      scrollTop: scroller.scrollTop,
      wanted: title,
    }
  }, { selector, scrollSelector, title })
  assert.equal(observation.missing, undefined, JSON.stringify(observation))
  assert.equal(observation.visible, true, 'far row is in the viewport')
  assert.equal(observation.title, title, 'title exists in the first frame at the far index: ' + JSON.stringify(observation))
  assert.match(observation.artist ?? '', /^Artist many-550(?:\s*-\s*Album many-550)?$/, 'artist and album exist in the first frame at the far index')
  assert.match(observation.format ?? '', /3:00\s*\|\s*flac/i, 'duration and format exist in the first frame at the far index')
}

try {
  const { page, errors } = await open()
  await page.evaluate(() => { window.summaryGate = true; window.durationGate = true })
  await importMany(page)
  await page.waitForFunction(() => window.pendingSummaries.length > 0 && window.pendingDurations.length > 0)
  await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('songs'))
  await page.getByRole('heading', { name: '全部歌曲' }).waitFor()
  assert.equal(await page.locator('.all-songs-list .playlist-card').count(), 0, 'all-songs list cannot scroll while tags and durations are pending')
  await release(page, 'summary')
  await page.waitForFunction(() => window.calls.some(call => call.command === 'audio_probe_playlist_track_summaries'))
  assert.equal(await page.locator('.all-songs-list .playlist-card').count(), 0, 'resolved tags alone do not expose rows with missing durations')
  await release(page, 'duration')
  await page.locator('.all-songs-list [data-playlist-track-id="many-550"]').waitFor()
  await assertFarRowFirstFrame(page, '.all-songs-list [data-playlist-track-id="many-550"]', '.playlist-management-content', 'Z Song 550')
  const scope = await page.evaluate(() => window.viewModel.playlist.library.items[0]?.scope)
  assert(scope, 'imported folder appears as a playlist scope')
  await page.evaluate(scope => window.viewModel.playlist.library.onSelect(scope), scope)
  await page.locator('.playlist-grid:not(.all-songs-list) [data-playlist-track-id="many-550"]').waitFor()
  await assertFarRowFirstFrame(page, '.playlist-grid:not(.all-songs-list) [data-playlist-track-id="many-550"]', '.playlist-panel', 'Z Song 550')
  assert.deepEqual(errors, [], 'no browser error in ready scopes')
  await page.close()

  const stale = await open()
  await stale.page.evaluate(() => { window.summaryGate = true; window.durationGate = true })
  await importMany(stale.page)
  await stale.page.waitForFunction(() => window.pendingSummaries.length > 0 && window.pendingDurations.length > 0)
  await stale.page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('songs'))
  await stale.page.getByRole('heading', { name: '全部歌曲' }).waitFor()
  await stale.page.evaluate(() => window.librarySettings.onClear())
  await stale.page.waitForFunction(() => window.viewModel.playlist.library.allSongs.length === 0)
  await release(stale.page, 'summary')
  await release(stale.page, 'duration')
  await stale.page.waitForTimeout(50)
  assert.equal(await stale.page.locator('.all-songs-list .playlist-card').count(), 0, 'late results cannot repopulate a cleared library')
  assert.equal(await stale.page.evaluate(() => window.viewModel.playlist.library.allSongs.length), 0)
  assert.deepEqual(stale.errors, [], 'no browser error after late response')
  await stale.page.close()

  const failed = await open()
  await failed.page.evaluate(() => { window.durationFailure = true })
  await importMany(failed.page)
  await failed.page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('songs'))
  await failed.page.locator('.all-songs-list [data-playlist-track-id="many-550"]').waitFor()
  const failedRow = await failed.page.locator('.all-songs-list [data-playlist-track-id="many-550"]').evaluate(row => ({
    title: row.querySelector('.playlist-card-title')?.textContent,
    artist: row.querySelector('.playlist-card-artist')?.textContent,
    format: row.querySelector('.playlist-card-format')?.textContent,
  }))
  assert.equal(failedRow.title, 'Z Song 550', 'duration command failure ends loading and preserves title')
  assert.match(failedRow.artist ?? '', /^Artist many-550/, 'duration command failure preserves artist')
  assert.match(failedRow.format ?? '', /flac/i, 'duration command failure preserves known container format')
  assert.doesNotMatch(failedRow.format ?? '', /3:00/, 'a failed duration probe never fabricates a duration')
  assert.deepEqual(failed.errors, [], 'no browser error after explicit duration failure')
  await failed.page.close()
  console.log(JSON.stringify({ case: 'all-songs and playlist distant-row first frame; gated summary/duration; clear stale response; explicit failure', passed: true }))
} finally {
  await browser.close()
}
