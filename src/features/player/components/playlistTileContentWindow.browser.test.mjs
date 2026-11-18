// Isolated real-shell regression for level-2 tile root virtualization.
// Start the worktree's Vite server and set SPMUSIC_PLAYWRIGHT/SPMUSIC_TEST_ORIGIN.
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
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>delete window.listeners[name];};')
assert(service.includes('window.backendInvoke'), 'replace transport and retain command parsing')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__tile_window_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(Surface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__tile_window_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(15000)
const tracks = 620
const errors = []
page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR', error.message) })

async function measureAtTop() {
  return page.evaluate(async () => {
    const panel = document.querySelector('.playlist-grid').closest('.playlist-panel')
    panel.scrollTop = 0
    const grid = panel.querySelector('.playlist-grid')
    let first
    for (let frame = 0; frame < 20; frame += 1) {
      await new Promise(requestAnimationFrame)
      first = [...grid.querySelectorAll('button[data-playlist-track-id]')]
      if (first[0]?.dataset.playlistTrackId === 'a-0') break
    }
    if (first?.[0]?.dataset.playlistTrackId !== 'a-0') throw new Error('top card not restored after return to scrollTop 0')
    const firstRect = first[0].getBoundingClientRect()
    const secondRow = first.findIndex(card => card.getBoundingClientRect().top > firstRect.top + 1)
    if (secondRow < 1) throw new Error('need two mounted rows to measure baseline stride and columns')
    return {
      count: first.length, mode: grid.dataset.contentWindow, columns: secondRow, height: panel.scrollHeight,
      firstTop: firstRect.top - grid.getBoundingClientRect().top, cardHeight: firstRect.height,
      stride: first[secondRow].getBoundingClientRect().top - firstRect.top,
    }
  })
}

async function jump(index, geometry) {
  return page.evaluate(async ({ index, geometry, tracks }) => {
    const grid = document.querySelector('.playlist-grid')
    const panel = grid.closest('.playlist-panel')
    const row = Math.floor(index / geometry.columns)
    const panelTop = panel.getBoundingClientRect().top + panel.clientTop
    panel.scrollTop += grid.getBoundingClientRect().top + geometry.firstTop + row * geometry.stride - panelTop - 105
    const observe = () => {
      const panelRect = panel.getBoundingClientRect()
      const top = Math.max(0, panelRect.top + panel.clientTop)
      const bottom = Math.min(innerHeight, panelRect.top + panel.clientTop + panel.clientHeight)
      const firstTop = grid.getBoundingClientRect().top + geometry.firstTop
      const expected = Array.from({ length: tracks }, (_, track) => {
        const rowTop = firstTop + Math.floor(track / geometry.columns) * geometry.stride
        return rowTop >= bottom - 2 || rowTop + geometry.cardHeight <= top + 2 ? null : 'a-' + track
      }).filter(Boolean)
      const cards = [...grid.querySelectorAll('button[data-playlist-track-id]')]
      const visible = cards.filter(card => {
        const box = card.getBoundingClientRect()
        return box.bottom > top + 2 && box.top < bottom - 2
      })
      return {
        expected, mounted: cards.length, height: panel.scrollHeight, top: panel.scrollTop,
        focused: document.activeElement?.dataset.playlistTrackId,
        visible: visible.map(card => ({ id: card.dataset.playlistTrackId, title: card.querySelector('.playlist-card-title')?.textContent })),
      }
    }
    // Read inside the first animation frame after the jump, before paint.
    const firstFrame = await new Promise(resolve => requestAnimationFrame(() => resolve(observe())))
    for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame)
    return { firstFrame, settled: observe() }
  }, { index, geometry, tracks })
}

function assertWindow(observation, index, geometry) {
  assert(observation.expected.includes('a-' + index), 'planned row is within measured viewport')
  assert(observation.visible.length > 0, 'the landed viewport contains visible cards')
  assert.deepEqual(observation.visible.map(card => card.id), observation.expected, 'mounted visible IDs match actual tile geometry')
  assert(observation.visible.every(card => card.title === 'Song a ' + card.id.slice(2)), 'every visible card retains correct first-frame title')
  assert(observation.mounted < tracks / 2, `mount at most half of ${tracks} roots; got ${observation.mounted}`)
  assert(Math.abs(observation.height - geometry.height) <= 1, 'unmounting preserves scrollable extent')
}

try {
  await page.addInitScript(() => {
    localStorage.setItem('spmusic.player.startup-page.v1', 'player')
    localStorage.setItem('spmusic.playlist.layout-level.v1', '2')
  })
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__tile_window_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__tile_window_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__tile_window_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__tile_window_test', { waitUntil: 'commit' })
  await page.waitForFunction(() => Boolean(window.viewModel))
  await page.evaluate(count => { window.config.count = count; window.viewModel.playback.onOpenAudio() }, tracks)
  await page.waitForFunction(() => window.viewModel.playlist.tracks.length > 0 && !window.viewModel.playback.isSelectionPending)
  const firstPaint = await page.evaluate(async () => {
    window.viewModel.playlist.onOpenChange(true)
    for (let frame = 0; frame < 180; frame += 1) {
      await new Promise(requestAnimationFrame)
      const grid = document.querySelector('.playlist-grid')
      if (!grid) continue
      const panel = grid.closest('.playlist-panel')
      const clip = panel.getBoundingClientRect()
      const cards = [...grid.querySelectorAll('button[data-playlist-track-id]')]
      const visible = cards.filter(card => {
        const box = card.getBoundingClientRect()
        return box.bottom > clip.top && box.top < Math.min(innerHeight, clip.bottom)
      })
      return {
        firstId: cards[0]?.dataset.playlistTrackId,
        firstTitle: cards[0]?.querySelector('.playlist-card-title')?.textContent,
        visibleCount: visible.length,
        blankVisible: visible.filter(card => !card.querySelector('.playlist-card-title')?.textContent).length,
      }
    }
    throw new Error('no playlist grid within the first-paint capture window')
  })
  assert.equal(firstPaint.firstId, 'a-0')
  assert.equal(firstPaint.firstTitle, 'Song a 0')
  assert(firstPaint.visibleCount > 0, 'the first painted viewport contains visible cards')
  assert.equal(firstPaint.blankVisible, 0, 'visible cards have titles on the first paint')
  await page.locator('.playlist-grid[data-layout-level="2"][data-content-window="bounded"]').waitFor()
  await page.evaluate(async () => { await document.fonts.ready })
  const first = await measureAtTop()
  assert.equal(first.mode, 'bounded')
  assert(first.count < tracks / 2, 'initial viewport mounts a bounded number of actual card roots')

  const deep = await jump(525, first)
  assertWindow(deep.firstFrame, 525, first)
  assertWindow(deep.settled, 525, first)
  assert(Math.abs(deep.settled.top - deep.firstFrame.top) <= 1, 'updating mounted rows does not move the scroll position')

  await jump(330, first)
  const edge = await page.locator('.playlist-grid').evaluate(grid => {
    const cards = [...grid.querySelectorAll('button[data-playlist-track-id]')]
    const indices = cards.map(card => Number(card.dataset.playlistTrackId.slice(2)))
    const boundary = indices.findIndex((index, position) => index >= 330 && indices[position + 1] > index + 1)
    if (boundary < 0) return null
    cards[boundary].focus({ preventScroll: true })
    return indices[boundary]
  })
  assert(edge !== null && edge < tracks - 1, 'exercise an actual mounted-window boundary')
  await page.keyboard.press('Tab')
  await page.waitForFunction(id => document.activeElement?.dataset.playlistTrackId === id, 'a-' + (edge + 1))
  await page.keyboard.press('Shift+Tab')
  await page.waitForFunction(id => document.activeElement?.dataset.playlistTrackId === id, 'a-' + edge)
  assert.equal((await jump(120, first)).settled.focused, 'a-' + edge, 'far scroll does not remove a focused card')
  await page.evaluate(() => document.activeElement.blur())

  await page.setViewportSize({ width: 1130, height: 820 })
  const resized = await measureAtTop()
  assert.notEqual(resized.columns, first.columns, 'fixture exercises a real level-2 column change')
  assert(resized.count < tracks / 2, 'resize does not expand to whole-list mounting')
  const reverse = await jump(570, resized)
  assertWindow(reverse.firstFrame, 570, resized)
  assertWindow(reverse.settled, 570, resized)

  await measureAtTop()
  await page.getByRole('button', { name: '选择', exact: true }).first().click()
  await page.locator('.playlist-grid[data-content-window="full"] .playlist-card[data-select-mode="true"]').first().waitFor()
  assert.equal(await page.locator('.playlist-grid button[data-playlist-track-id]').count(), tracks, 'selection restores complete card roots and reorder targets')
  const selected = page.locator('.playlist-grid button[data-playlist-track-id="a-1"]')
  await selected.click()
  assert.equal(await selected.getAttribute('aria-pressed'), 'true', 'regular selection semantics still apply')
  assert.deepEqual(errors, [], 'no browser errors while scrolling, resizing or entering selection')
  console.log(JSON.stringify({ case: 'level-2 actual card window', tracks, initialColumns: first.columns, resizedColumns: resized.columns, initialMounted: first.count, farMounted: deep.settled.mounted, passed: true }))
} finally {
  await browser.close()
}

