// Start Vite; point SPMUSIC_PLAYWRIGHT at an existing Playwright package.
// SPMUSIC_COMPACT_BASELINE=1 routes the checked-in responsive CSS only.
// Real demo PlayerSurface, resolver, LyricsPanel and scroll hook; no layout overrides.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const baseline = process.env.SPMUSIC_COMPACT_BASELINE === '1'
const demoPath = '/src/demo/player/DemoPlayerPage.tsx'
const tracksPath = '/src/demo/player/demoTracks.ts'
const cssPath = '/src/features/player/styles/player/responsive.css'
const bundlePath = '/src/features/player/styles/player.css'
const demo = (await (await fetch(origin + demoPath)).text())
  .replace('return /* @__PURE__ */ _jsxDEV(PlayerSurface', 'window.compactFixture={seek:setProgress,play:setPlaying,position:progress}; return /* @__PURE__ */ _jsxDEV(PlayerSurface')
assert(demo.includes('window.compactFixture='), 'expose demo transport without replacing production composition')
const tracks = await (await fetch(origin + tracksPath)).text()
let oldCssModule
if (baseline) {
  const css = execFileSync('git', ['show', 'HEAD:' + cssPath.slice(1)], { encoding: 'utf8' })
  const module = await (await fetch(origin + bundlePath)).text()
  const match = module.match(/const __vite__css = ("(?:[^"\\]|\\.)*")/)
  assert(match)
  const bundled = JSON.parse(match[1])
  const start = '.responsive-player-layout[data-player-layout="compact"] .lyrics-panel > ol {'
  const end = '.responsive-player-layout[data-player-layout="compact"] .lyrics-panel li[data-active="true"] {'
  const oldRules = css.slice(css.indexOf(start), css.indexOf(end))
  assert(oldRules.includes('display: none') && oldRules.includes('justify-content: center'))
  const replaced = bundled.slice(0, bundled.indexOf(start)) + oldRules + bundled.slice(bundled.indexOf(end))
  oldCssModule = module.replace(match[0], () => 'const __vite__css = ' + JSON.stringify(replaced))
}
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const reports = []
const errors = []
const short = Array.from({ length: 9 }, (_, index) => ({
  id: 'compact-' + index, timeSeconds: index * 20,
  original: 'Short lyric ' + index, translation: '',
}))
async function open(lines = short, viewport = { width: 1440, height: 960 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 })
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**' + demoPath + '*', route => route.fulfill({ contentType: 'text/javascript', body: demo }))
  await page.route('**' + tracksPath + '*', route => route.fulfill({ contentType: 'text/javascript', body: tracks + '\ndemoTracks[0].lyrics=' + JSON.stringify(lines) + ';' }))
  if (oldCssModule) await page.route('**' + bundlePath + '*', route => route.fulfill({ contentType: 'text/javascript', body: oldCssModule }))
  await page.goto(origin + '/demo-player.html')
  await page.locator('.lyrics-panel > ol').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => Boolean(window.compactFixture))
  await seek(page, lines[Math.floor(lines.length / 2)].timeSeconds)
  return page
}
async function seek(page, position) {
  await page.evaluate(position => window.compactFixture.seek(position), position)
  await page.waitForTimeout(450) // Existing navigation/motion duration, not a production workaround.
}
async function metrics(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.lyrics-panel > ol')
    const panel = list.closest('.lyrics-panel')
    const box = element => {
      const r = element.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }
    }
    const panelRect = box(panel), style = getComputedStyle(list)
    return {
      layout: document.querySelector('[data-player-layout]').dataset.playerLayout,
      profile: document.querySelector('[data-player-layout]').dataset.playerCompactProfile,
      panel: panelRect, meta: box(document.querySelector('.track-pills')),
      controls: box(document.querySelector('.player-control-region')),
      top: list.scrollTop, max: list.scrollHeight - list.clientHeight,
      overflow: style.overflowY, before: getComputedStyle(list, '::before').display,
      tight: style.getPropertyValue('--player-lyrics-tight-spacing').trim(),
      normal: style.getPropertyValue('--player-lyrics-normal-spacing').trim(),
      rows: [...list.querySelectorAll('li[data-lyric-index]')].map(row => {
        const text = row.querySelector('.lyric-original-line'), textBox = box(text), rowStyle = getComputedStyle(row)
        let top = Math.max(0, textBox.top), bottom = Math.min(innerHeight, textBox.bottom)
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          if (!['visible', 'clip'].includes(getComputedStyle(parent).overflowY)) {
            const rect = parent.getBoundingClientRect(); top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom)
          }
        }
        return { id: row.dataset.lyricId, active: row.dataset.active === 'true', display: rowStyle.display,
          margin: parseFloat(rowStyle.marginBottom), height: row.getBoundingClientRect().height,
          text: text.textContent, lines: text.querySelectorAll('.lyric-visual-line').length,
          translation: row.querySelector('.translation-line')?.textContent,
          textBox, visible: textBox.height ? Math.max(0, bottom - top) / textBox.height : 0 }
      }),
    }
  })
}
function safe(state, label) {
  assert(state.panel.top >= state.meta.bottom - 1, label + ': lyrics stay below metadata')
  assert(state.panel.bottom <= state.controls.top + 1, label + ': lyrics stay above controls')
  assert.equal(state.tight, '48', label + ': tight theme token retained')
  assert.equal(state.normal, '53', label + ': normal theme token retained')
  assert.equal(state.overflow, 'auto', label + ': native scrolling available')
  assert.notEqual(state.before, 'none', label + ': edge centering spacer retained')
}
function three(state, label) {
  const index = state.rows.findIndex(row => row.active)
  assert(index > 0 && index < state.rows.length - 1)
  const active = state.rows[index].textBox
  assert(Math.abs((active.top + active.bottom) / 2 - (state.panel.top + state.panel.bottom) / 2) < 3, label + ': current text is centered')
  for (const row of state.rows.slice(index - 1, index + 2)) {
    assert.notEqual(row.display, 'none', label + ': adjacent row participates in layout')
    assert(row.visible > .99, label + ': previous/current/next text fully inside scrollport')
  }
}
try {
  console.log('BROWSER', browser.version(), baseline ? 'before' : 'after')
  const page = await open()
  const first = await metrics(page)
  console.log('CORE', JSON.stringify({ layout: first.layout, profile: first.profile,
    panel: first.panel, meta: first.meta, controls: first.controls,
    overflow: first.overflow, before: first.before, tight: first.tight, normal: first.normal,
    rows: first.rows.slice(3, 6) }))
  assert.equal(first.layout, 'compact'); assert.equal(first.profile, 'compact-row-lyric')
  three(first, '1440x960 short lines')
  if (baseline) throw new Error('Original CSS unexpectedly satisfies the three-line requirement')
  safe(first, 'short lines'); assert(first.rows[4].margin >= 53 * 2 / 3)
  reports.push({ case: '1440x960 DPR2 short normal', panelHeight: first.panel.height, visible: first.rows.slice(3, 6).map(row => row.visible), spacing: first.rows[4].margin })
  await page.locator('[data-lyric-index="5"]').click()
  await page.waitForFunction(() => window.compactFixture.position === 100)
  await page.waitForTimeout(450)
  three(await metrics(page), 'click seek')
  await page.locator('[data-lyric-index="4"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.compactFixture.position === 80)
  const beforeWheel = await metrics(page)
  await page.mouse.move((beforeWheel.panel.left + beforeWheel.panel.right) / 2, (beforeWheel.panel.top + beforeWheel.panel.bottom) / 2)
  await page.mouse.wheel(0, 180)
  await page.waitForTimeout(100)
  const manual = await metrics(page)
  assert(Math.abs(manual.top - beforeWheel.top) > 10, 'native wheel changes scroll position')
  await page.waitForFunction(() => {
    const list = document.querySelector('.lyrics-panel > ol')
    const active = list.querySelector('[data-active="true"] .lyric-original-line').getBoundingClientRect()
    const panel = list.getBoundingClientRect()
    return Math.abs((active.top + active.bottom - panel.top - panel.bottom) / 2) < 3
  }, null, { timeout: 6500 }) // Existing five-second manual-scroll idle timer.
  three(await metrics(page), 'automatic follow resumes after wheel')
  for (const position of [0, 160]) {
    await seek(page, position)
    const state = await metrics(page)
    safe(state, 'edge'); assert(state.rows.find(row => row.active).visible > .99, 'first/last lyric remains fully visible')
  }
  await seek(page, 80)
  for (const viewport of [{ width: 1100, height: 800 }, { width: 1440, height: 960 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(450)
    const state = await metrics(page); safe(state, 'resize')
    assert(state.rows.find(row => row.active).visible > .99, 'active text remains readable after resize')
    reports.push({ case: 'resize', viewport, profile: state.profile, panelHeight: state.panel.height })
  }
  three(await metrics(page), 'resize back'); await page.close()
  const tightPage = await open(short.map(line => ({ ...line, timeSeconds: line.timeSeconds / 2 })))
  const tight = await metrics(tightPage); three(tight, 'tight pair'); safe(tight, 'tight pair')
  assert(tight.rows[4].margin >= 48 * 2 / 3)
  reports.push({ case: 'tight pair', spacing: tight.rows[4].margin }); await tightPage.close()
  for (const kind of ['long', 'bilingual']) {
    const lines = short.map(line => ({ ...line,
      original: kind === 'long' ? (line.original + ' across the city after the rain ').repeat(6) : line.original,
      translation: kind === 'bilingual' ? '歌词译文 ' + line.id : '',
    }))
    const current = await open(lines)
    const state = await metrics(current); safe(state, kind)
    assert(state.rows.every(row => row.display !== 'none'), kind + ': adjacent rows retained')
    assert.equal(state.rows[4].text, lines[4].original, kind + ': content preserved')
    assert(state.rows[4].visible > .5, kind + ': active content substantially visible')
    if (kind === 'long') assert(state.rows[4].lines > 1, 'long text wraps')
    else assert.equal(state.rows[4].translation, lines[4].translation)
    reports.push({ case: kind, panelHeight: state.panel.height, activeVisible: state.rows[4].visible, visualLines: state.rows[4].lines })
    await current.close()
  }
  assert.deepEqual(errors, [], 'no browser runtime exceptions')
  console.log('REGRESSION_PASS', JSON.stringify(reports))
} finally {
  await browser.close()
}
