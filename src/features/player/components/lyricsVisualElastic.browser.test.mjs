// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright package.
// Optional SPMUSIC_VISUAL_BASELINE loads saved Vite modules for an A/B run.
// Uses the real demo composition, native wheel input and absolute text geometry.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const baseline = process.env.SPMUSIC_VISUAL_BASELINE
  ? JSON.parse(readFileSync(process.env.SPMUSIC_VISUAL_BASELINE, 'utf8')) : null
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }
const label = baseline ? 'before' : 'after'
console.log('BROWSER', browser.version(), label)

function feedbackClip(state, viewportHeight) {
  const y = Math.max(0, state.panel.y - state.distance)
  return { ...state.panel, y, height: Math.min(viewportHeight, state.panel.y + state.panel.height + state.distance) - y }
}

async function metrics(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.lyrics-panel > ol')
    const panel = list.closest('.lyrics-panel')
    const rect = panel.getBoundingClientRect()
    const rootStyle = getComputedStyle(document.querySelector('.spmusic-app'))
    const duration = key => {
      const value = rootStyle.getPropertyValue(key).trim()
      return Number.parseFloat(value) * (value.endsWith('s') && !value.endsWith('ms') ? 1000 : 1)
    }
    return {
      layout: document.querySelector('[data-player-layout]').dataset.playerLayout,
      distance: Number.parseFloat(getComputedStyle(list).getPropertyValue('--player-lyrics-overscroll-distance')),
      top: list.scrollTop, max: list.scrollHeight - list.clientHeight,
      fast: duration('--app-motion-fast'), standard: duration('--app-motion-standard'),
      panel: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      stageHeight: document.querySelector('.player-stage').scrollHeight,
      stageTop: document.querySelector('.player-stage').scrollTop,
      panelOverflow: getComputedStyle(panel).overflowY,
      rows: [...list.querySelectorAll('li[data-lyric-index]')].map(row => {
        const text = row.querySelector('.lyric-original-line').getBoundingClientRect()
        let top = Math.max(0, text.top)
        let bottom = Math.min(innerHeight, text.bottom)
        for (let ancestor = list; ancestor; ancestor = ancestor.parentElement) {
          if (getComputedStyle(ancestor).overflowY !== 'visible') {
            const rect = ancestor.getBoundingClientRect()
            top = Math.max(top, rect.top)
            bottom = Math.min(bottom, rect.bottom)
          }
        }
        return { center: text.top + text.height / 2, top: text.top, bottom: text.bottom,
          visibleFraction: Math.max(0, bottom - top) / text.height }
      }),
      offset: Number.parseFloat(getComputedStyle(list).translate.split(' ')[1]) || 0,
      animations: list.getAnimations().length,
    }
  })
}
async function openPage(viewport, scale = 1, shortLines = 0) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', error => failures.push('browser runtime: ' + error.message))
  if (baseline) for (const [path, body] of Object.entries(baseline)) {
    await page.route('**' + path.split('?')[0] + '*', route => route.fulfill({ contentType: 'text/javascript', body }))
  }
  if (shortLines) {
    const tracksSource = await (await fetch(origin + '/src/demo/player/demoTracks.ts')).text()
    const lyrics = Array.from({ length: shortLines }, (_, index) => ({
      id: 'quick-drag-' + index, timeSeconds: index * 20,
      original: shortLines === 1 ? '纯音乐，请欣赏' : 'Spirit lyric ' + index, translation: '',
    }))
    await page.route('**/src/demo/player/demoTracks.ts*', route => route.fulfill({
      contentType: 'text/javascript', body: tracksSource + '\ndemoTracks[0].lyrics = ' + JSON.stringify(lyrics) + ';',
    }))
  }
  await page.goto(origin + '/demo-player.html')
  await page.locator('.lyrics-panel > ol').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
  const initial = await metrics(page)
  if (!baseline) check(initial.distance === 40, 'fresh default runtime distance must be 40')
  if (process.env.SPMUSIC_VISUAL_DEFAULT_ONLY || process.env.SPMUSIC_VISUAL_PERSISTED_ONLY) return page
  // Equal 60px token on both versions separates behavior from parameter changes.
  await page.evaluate(async scale => {
    const { defaultAppearance } = await import('/src/features/appearance/model/defaultAppearance.ts')
    const { createAppearanceThemeDocument } = await import('/src/features/appearance/model/appearanceThemeCodec.ts')
    const theme = structuredClone(defaultAppearance)
    theme.id = 'visual-elastic-test'
    theme.name = 'Visual elastic test'
    theme.player.lyricsOverscrollDistance = 60
    theme.motion.durationScale = scale
    const document = createAppearanceThemeDocument(theme)
    const newValue = JSON.stringify({ schemaVersion: 2, currentThemeId: theme.id, colorSchemePreference: 'light', userThemes: [document] })
    localStorage.setItem('spmusic.appearance.v2', newValue)
    window.dispatchEvent(new StorageEvent('storage', { key: 'spmusic.appearance.v2', newValue }))
  }, scale)
  await page.waitForTimeout(100)
  const ready = await metrics(page)
  assert.equal(ready.distance, 60, 'controlled theme token reaches real provider')
  await page.evaluate(() => {
    window.visualWheelEvents = []
    document.addEventListener('wheel', event => window.visualWheelEvents.push({
      time: performance.now(), delta: event.deltaY, target: event.target.tagName,
      panel: Boolean(event.target.closest('.lyrics-panel')), prevented: event.defaultPrevented,
    }))
  })
  return page
}
async function point(page) {
  const state = await metrics(page)
  const p = state.panel
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2)
  return { x: p.x + p.width / 2, y: p.y + p.height / 2 }
}
async function edge(page, direction) {
  await point(page)
  // Reach boundaries through real native scrolling, never by setting scrollTop.
  for (let index = 0; index < 30; index += 1) {
    const state = await metrics(page)
    if (Math.abs(state.top - (direction > 0 ? 0 : state.max)) < 0.5) break
    await page.mouse.wheel(0, -direction * 240)
    await page.waitForTimeout(20)
  }
  const state = await metrics(page)
  await page.waitForTimeout(state.fast + state.standard + 170)
  const ready = await metrics(page)
  assert(Math.abs(ready.top - (direction > 0 ? 0 : ready.max)) < 0.5, 'native input reaches requested edge')
  return ready
}
async function startTrace(page, row) {
  await page.evaluate(row => {
    window.visualFrames = []
    window.visualTracing = true
    const capture = time => {
      if (!window.visualTracing) return
      const list = document.querySelector('.lyrics-panel > ol')
      const panel = list.closest('.lyrics-panel').getBoundingClientRect()
      const text = list.querySelectorAll('li[data-lyric-index]')[row].querySelector('.lyric-original-line').getBoundingClientRect()
      let visibleTop = Math.max(0, text.top)
      let visibleBottom = Math.min(innerHeight, text.bottom)
      const clipping = []
      for (let ancestor = list; ancestor; ancestor = ancestor.parentElement) {
        if (getComputedStyle(ancestor).overflowY !== 'visible') {
          const rect = ancestor.getBoundingClientRect()
          if (text.top < rect.top || text.bottom > rect.bottom) clipping.push({ className: ancestor.className, top: rect.top, bottom: rect.bottom })
          visibleTop = Math.max(visibleTop, rect.top)
          visibleBottom = Math.min(visibleBottom, rect.bottom)
        }
      }
      window.visualFrames.push({ time, y: text.top + text.height / 2, textTop: text.top, textBottom: text.bottom,
        panelTop: panel.top, panelBottom: panel.bottom, scrollTop: list.scrollTop,
        visibleFraction: Math.max(0, visibleBottom - visibleTop) / text.height,
        clipping,
        stageHeight: document.querySelector('.player-stage').scrollHeight,
        stageTop: document.querySelector('.player-stage').scrollTop,
        offset: Number.parseFloat(getComputedStyle(list).translate.split(' ')[1]) || 0 })
      requestAnimationFrame(capture)
    }
    requestAnimationFrame(capture)
  }, row)
}
async function stopTrace(page, before, row, direction, context, expectedTravel = before.distance) {
  const frames = await page.evaluate(() => { window.visualTracing = false; return window.visualFrames })
  const shifts = frames.map(frame => direction * (frame.y - before.rows[row].center))
  const peak = Math.max(...shifts)
  const peakFrame = frames[shifts.indexOf(peak)]
  const overlap = Math.max(0, Math.min(peakFrame.textBottom, peakFrame.panelBottom) - Math.max(peakFrame.textTop, peakFrame.panelTop))
  const end = await metrics(page)
  check(peak >= expectedTravel * 0.95, context + ': ordinary input must visibly reach the expected gesture distance')
  check(peak <= before.distance + 1, context + ': absolute text movement must remain bounded')
  check(frames.every(frame => Math.abs(frame.panelTop - before.panel.y) < 1), context + ': viewport stays stable')
  check(Math.abs(end.offset) < 0.5 && end.animations === 0, context + ': presentation returns to zero')
  // A wrapped lyric can already exceed the short scrollport at rest. Feedback
  // must preserve its existing visible content rather than add external clipping.
  check(peakFrame.visibleFraction >= before.rows[row].visibleFraction - 0.01, context + ': outward feedback preserves the text visible at rest')
  check(frames.every(frame => frame.stageHeight === before.stageHeight && frame.stageTop === before.stageTop), context + ': elastic feedback does not scroll or enlarge the stage')
  check(end.panelOverflow === 'hidden', context + ': ordinary clipping is restored after rebound')
  console.log(JSON.stringify({ context, distance: before.distance, startY: before.rows[row].center, peak,
    endY: end.rows[row].center, panelHeight: before.panel.height,
    peakVisibleTextFraction: overlap / (peakFrame.textBottom - peakFrame.textTop),
    actualVisibleTextFraction: peakFrame.visibleFraction,
    restVisibleTextFraction: before.rows[row].visibleFraction,
    clipping: peakFrame.clipping,
    visibleFrames: frames.filter(frame => frame.textBottom > frame.panelTop && frame.textTop < frame.panelBottom).length,
    totalFrames: frames.length, endOffset: end.offset }))
  return peak
}

try {
  if (process.env.SPMUSIC_VISUAL_PERSISTED_ONLY) {
    const page = await openPage({ width: 2557, height: 1439 })
    const cases = await page.evaluate(async () => {
      const { defaultAppearance } = await import('/src/features/appearance/model/defaultAppearance.ts')
      const { createAppearanceThemeDocument, deserializeAppearanceTheme } = await import('/src/features/appearance/model/appearanceThemeCodec.ts')
      const { parseAppearanceStorage } = await import('/src/features/appearance/model/appearanceStorage.ts')
      const results = []
      for (const schema of [1, 2, 3, 4, 5]) for (const id of ['default', 'saved-custom']) for (const distance of [0, 20, 60, 180]) {
        const theme = structuredClone(defaultAppearance)
        theme.id = id
        theme.name = 'Preserved saved theme'
        theme.player.lyricsOverscrollDistance = distance
        theme.radii.lg = '17px'
        theme.colorSchemes.light.accent = '#315e97'
        const document = createAppearanceThemeDocument(theme)
        const source = { schemaVersion: schema, currentThemeId: id, colorSchemePreference: 'dark', userThemes: [document] }
        const decoded = deserializeAppearanceTheme(JSON.stringify(document)).appearance
        const expected = structuredClone(decoded)
        if (id === 'default' && ((schema <= 4 && distance === 60) || (schema <= 3 && distance === 180) || (schema <= 2 && distance === 20))) {
          expected.player.lyricsOverscrollDistance = 40
        }
        const parsed = parseAppearanceStorage(JSON.stringify(source))
        results.push({ schema, id, distance,
          preserved: JSON.stringify(parsed.userThemes[0]) === JSON.stringify(expected),
          selected: parsed.currentThemeId === id,
          color: parsed.colorSchemePreference === (schema === 1 ? 'system' : 'dark') })
      }
      const theme = structuredClone(defaultAppearance)
      theme.player.lyricsOverscrollDistance = 60
      theme.radii.lg = '17px'
      theme.colorSchemes.light.accent = '#315e97'
      const document = createAppearanceThemeDocument(theme)
      const storage = { schemaVersion: 4, currentThemeId: theme.id, colorSchemePreference: 'light', userThemes: [document] }
      localStorage.setItem('spmusic.appearance.v2', JSON.stringify(storage))
      return results
    })
    check(cases.every(item => item.preserved && item.selected && item.color), 'legacy migration preserves all other theme fields, IDs, preferences and intentional distances')
    console.log('PERSISTED_PARSE_CASES', JSON.stringify(cases))
    await page.reload()
    await page.locator('.lyrics-panel > ol').waitFor()
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(500)
    const storage = await page.evaluate(() => JSON.parse(localStorage.getItem('spmusic.appearance.v2')))
    check(storage.schemaVersion === 5, 'real provider writes one-time schema5 marker after loading old storage')
    check(storage.userThemes[0].theme.player.lyricsOverscrollDistance === 40, 'real provider persists the migrated distance')
    check(storage.userThemes[0].theme.radii.lg === '17px' && storage.userThemes[0].theme.colorSchemes.light.accent === '#315e97', 'real saved migration preserves customized appearance')
    for (const input of ['drag', 'wheel']) {
      const before = await edge(page, 1)
      check(before.distance === 40, 'persisted schema4 default60 reaches actual runtime40')
      const p = await point(page)
      await startTrace(page, 0)
      if (input === 'drag') {
        await page.mouse.down()
        await page.mouse.move(p.x, p.y + 600, { steps: 12 })
      } else {
        for (let tick = 0; tick < 4; tick += 1) { await page.mouse.wheel(0, -6); await page.waitForTimeout(80) }
      }
      const held = await metrics(page)
      // The user's new 40px request replaces the former cover-lower-third goal.
      // Keep exact displacement, real text geometry and rebound checks.
      check(Math.abs(held.offset - 40) < 0.5, input + ': migrated presentation reaches the new 40px default')
      const screenshot = join(tmpdir(), 'SpMusic-lyrics-persisted40-' + label + '-' + input + '.png')
      await page.screenshot({ path: screenshot })
      if (input === 'drag') await page.mouse.up()
      await page.waitForTimeout(before.fast + before.standard + 170)
      await stopTrace(page, before, 0, 1, 'persisted schema4 old60 migrated to40 ' + input)
      console.log('PERSISTED_GEOMETRY', JSON.stringify({ input, screenshot,
        textY: held.rows[0].center, runtime: held.distance,
        offset: held.offset, schema: storage.schemaVersion }))
    }
    await page.reload()
    await page.locator('.lyrics-panel > ol').waitFor()
    check((await metrics(page)).distance === 40, 'second load keeps the completed migration')
    await page.evaluate(() => {
      const storage = JSON.parse(localStorage.getItem('spmusic.appearance.v2'))
      storage.userThemes[0].theme.player.lyricsOverscrollDistance = 180
      localStorage.setItem('spmusic.appearance.v2', JSON.stringify(storage))
    })
    await page.reload()
    await page.locator('.lyrics-panel > ol').waitFor()
    check((await metrics(page)).distance === 180, 'later explicit schema5 custom180 is respected, not migrated again')
    console.log('PERSISTED_RELOAD_AND_LATER_CUSTOM180_CHECKED')
    await page.close()
  } else if (process.env.SPMUSIC_VISUAL_DEFAULT_ONLY) {
    for (const viewport of [{ width: 1800, height: 900 }, { width: 2540, height: 1434 }, { width: 640, height: 1200 }]) {
      const page = await openPage(viewport)
      for (const direction of [1, -1]) {
        for (const amount of [120, 360]) {
          const before = await edge(page, direction)
          const row = direction > 0 ? 0 : before.rows.length - 1
          const p = await point(page)
          await startTrace(page, row)
          await page.mouse.down()
          await page.mouse.move(p.x, p.y + direction * amount, { steps: 12 })
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
          const held = await metrics(page)
          const expected = Math.min(amount, before.distance)
          check(Math.abs(held.offset - direction * expected) < 1, 'default direct drag respects actual pointer distance and cap')
          if (amount === 360) {
            const screenshot = join(tmpdir(), 'SpMusic-lyrics-default40-' + viewport.width + '-' + direction + '.png')
            await page.screenshot({ path: screenshot, clip: feedbackClip(before, viewport.height) })
            const hits = await page.evaluate(row => {
              const text = document.querySelectorAll('li[data-lyric-index]')[row].querySelector('.lyric-original-line')
              const button = document.querySelector('.volume-control > button')
              const rect = button.getBoundingClientRect()
              const textRect = text?.getBoundingClientRect()
              return { dockHit: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
                boundaryTextHit: textRect ? document.elementFromPoint(textRect.x + textRect.width / 2, textRect.y + textRect.height / 2)?.className : null }
            }, row)
            check(hits.dockHit, 'default40 elastic feedback preserves dock control hit testing')
            console.log('DEFAULT_SCREENSHOT', screenshot, JSON.stringify(hits))
          }
          await page.mouse.up()
          await page.waitForTimeout(before.standard + 50)
          await stopTrace(page, before, row, direction, viewport.width + ' default40 quick' + amount + ' edge ' + direction, expected)
        }
      }
      await page.close()
    }
  } else {
  // Quick real gestures must produce feedback before pointerup, independent of
  // the theme's outward animation duration. Real one/three-line layouts match
  // the reported video; the browser gets a frame while the pointer is held.
  if (process.env.SPMUSIC_VISUAL_QUICK_DRAG_ONLY || process.env.SPMUSIC_VISUAL_MIXED_ONLY) {
    const mixedOnly = Boolean(process.env.SPMUSIC_VISUAL_MIXED_ONLY)
    for (const viewport of (mixedOnly ? [{ width: 1800, height: 900 }] : [{ width: 1800, height: 900 }, { width: 640, height: 1200 }])) {
      for (const lines of (mixedOnly ? [3] : [1, 3])) {
        const page = await openPage(viewport, 1, lines)
        for (const direction of (mixedOnly ? [] : [1, -1])) {
          const before = await edge(page, direction)
          const row = direction > 0 ? 0 : before.rows.length - 1
          const p = await point(page)
          await startTrace(page, row)
          await page.mouse.down()
          await page.mouse.move(p.x, p.y + direction * 120, { steps: 12 })
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
          const held = await metrics(page)
          const pointer = await page.evaluate(() => {
            const list = document.querySelector('.lyrics-panel > ol')
            return { captured: list.hasPointerCapture(1), dragging: list.dataset.dragging,
              preview: document.querySelector('.progress-time')?.textContent }
          })
          check(pointer.captured && pointer.dragging === 'true', 'quick drag captures the real mouse pointer')
          check(direction * held.offset >= 59 && Math.abs(held.offset) <= 60.5,
            viewport.width + '/' + lines + '/' + direction + ': quick drag reaches distance before release')
          await page.mouse.up()
          await page.waitForTimeout(before.standard + 50)
          await stopTrace(page, before, row, direction, viewport.width + ' ' + lines + '-line quick120 drag edge ' + direction)
          console.log('QUICK_DRAG_HELD', JSON.stringify({ viewport, lines, direction,
            heldOffset: held.offset, fast: before.fast, pointer }))
        }
        if (viewport.width === 1800 && lines === 3 && !baseline) {
          const before = await edge(page, 1)
          const p = await point(page)
          await page.mouse.wheel(0, -6)
          await page.waitForFunction(() => {
            const list = document.querySelector('.lyrics-panel > ol')
            const offset = Number.parseFloat(getComputedStyle(list).translate.split(' ')[1]) || 0
            return offset > 1 && offset < 59 && list.getAnimations().some(animation =>
              animation.effect.getKeyframes().at(-1).translate.split(/\s+/).every(value => Number.parseFloat(value) === 0))
          })
          await page.mouse.down()
          await page.mouse.move(p.x, p.y + 20)
          const resumed = await metrics(page)
          check(resumed.offset >= 20 && resumed.offset <= 60 && resumed.animations === 0,
            'drag takes over current wheel rebound without waiting for outward animation')
          // A held wheel input may animate outward, but the next pointermove
          // must sample it and resume direct gesture feedback.
          await page.mouse.wheel(0, -6)
          await page.waitForTimeout(before.fast + 20)
          const mixed = await metrics(page)
          check(Math.abs(mixed.offset - 60) < 0.5, 'held wheel reaches the configured boundary target')
          await page.mouse.move(p.x, p.y - 70)
          const reversed = await metrics(page)
          check(Math.abs(reversed.offset) < 0.5 && Math.abs(reversed.top - 30) <= 1 && reversed.animations === 0,
            'reverse drag consumes visual offset then resumes real scrolling after mixed wheel input')
          await page.mouse.up()
          await page.waitForTimeout(before.standard + 20)
          console.log('QUICK_DRAG_MIXED_INPUT', JSON.stringify({ resumed: resumed.offset,
            mixed: mixed.offset, reversed: { offset: reversed.offset, top: reversed.top } }))
        }
        await page.close()
      }
    }
  } else {
  // Small discrete wheel pulses on the actual full/horizontal composition.
  if (!process.env.SPMUSIC_VISUAL_QUARTER_ONLY) {
  for (const viewport of [{ width: 1800, height: 900 }, { width: 2528, height: 1438 }]) {
    const page = await openPage(viewport)
    for (const direction of [1, -1]) {
      const before = await edge(page, direction)
      const row = direction > 0 ? 0 : before.rows.length - 1
      await point(page)
      await startTrace(page, row)
      for (let tick = 0; tick < 4; tick += 1) {
        await page.mouse.wheel(0, -direction * 6)
        await page.waitForTimeout(375)
      }
      await page.waitForTimeout(before.fast + before.standard + 170)
      await stopTrace(page, before, row, direction, viewport.width + ' native wheel6/375ms edge ' + direction)
    }
    // Actual outward frame screenshots with a stable pointer and ongoing input.
    const before = await edge(page, 1)
    const screenshotBase = join(tmpdir(), 'SpMusic-lyrics-visual-' + label + '-' + viewport.width)
    await page.screenshot({ path: screenshotBase + '-rest.png', clip: feedbackClip(before, viewport.height) })
    for (let tick = 0; tick < 4; tick += 1) { await page.mouse.wheel(0, -6); await page.waitForTimeout(80) }
    const visible = await metrics(page)
    await page.screenshot({ path: screenshotBase + '-outward.png', clip: feedbackClip(before, viewport.height) })
    console.log('SCREENSHOTS', screenshotBase, JSON.stringify({ firstTextY: visible.rows[0].center,
      panelTop: visible.panel.y, panelBottom: visible.panel.y + visible.panel.height, offset: visible.offset }))
    await page.close()
  }
  }
  // The short quarter viewport previously moved the wheel event target off ol.
  const quarter = await openPage({ width: 640, height: 1200 })
  for (const direction of [1, -1]) {
  for (const delta of [6, 120]) {
    const before = await edge(quarter, direction)
    await point(quarter)
    await quarter.evaluate(() => { window.visualWheelEvents = [] })
    const screenshotBase = join(tmpdir(), 'SpMusic-lyrics-visual-' + label + '-quarter-' + direction + '-' + delta)
    await quarter.screenshot({ path: screenshotBase + '-rest.png', clip: feedbackClip(before, 1200) })
    const row = direction > 0 ? 0 : before.rows.length - 1
    await startTrace(quarter, row)
    for (let tick = 0; tick < 4; tick += 1) { await quarter.mouse.wheel(0, -direction * delta); await quarter.waitForTimeout(80) }
    const events = await quarter.evaluate(() => window.visualWheelEvents)
    await quarter.screenshot({ path: screenshotBase + '-outward.png', clip: feedbackClip(before, 1200) })
    const volumeHit = await quarter.evaluate(() => {
      const button = document.querySelector('.volume-control > button')
      if (!button) return false
      const rect = button.getBoundingClientRect()
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })
    check(volumeHit, 'quarter outward feedback does not cover the volume control')
    check(events.length === 4 && events.every(event => event.panel && event.prevented), 'quarter wheel' + delta + ': fixed-pointer boundary events are all handled')
    await quarter.waitForTimeout(before.fast + before.standard + 170)
    await stopTrace(quarter, before, row, direction, 'quarter fixed-pointer wheel' + delta + ' edge ' + direction)
    console.log('QUARTER_WHEEL_EVENTS', delta, JSON.stringify(events))
  }
  }
  await quarter.close()
  // A slow theme must finish outward motion even after 150ms wheel idle.
  if (!process.env.SPMUSIC_VISUAL_QUARTER_ONLY) {
  const slow = await openPage({ width: 1800, height: 900 }, 2)
  const slowBefore = await edge(slow, 1)
  await point(slow)
  await startTrace(slow, 0)
  await slow.mouse.wheel(0, -6)
  await slow.waitForTimeout(slowBefore.fast + slowBefore.standard + 170)
  await stopTrace(slow, slowBefore, 0, 1, 'slow theme single wheel6')
  console.log('SLOW_THEME_TOKENS', JSON.stringify({ fast: slowBefore.fast, standard: slowBefore.standard }))
  // Real 120px drag, with pointer capture and normal release.
  const dragBefore = await edge(slow, 1)
  const p = await point(slow)
  await startTrace(slow, 0)
  await slow.mouse.down()
  await slow.mouse.move(p.x, p.y + 120, { steps: 12 })
  await slow.waitForTimeout(dragBefore.fast + 20)
  await slow.mouse.up()
  await slow.waitForTimeout(dragBefore.standard + 50)
  await stopTrace(slow, dragBefore, 0, 1, 'slow theme ordinary 120px drag and release')
  await slow.close()
  }
  }
  }
  console.log('VISUAL_FAILURES', JSON.stringify(failures))
  assert.deepEqual(failures, [])
  console.log('LYRICS_VISUAL_ELASTIC_PASS')
} finally {
  await browser.close()
}
