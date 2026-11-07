// Real-browser regression: start Vite, set SPMUSIC_PLAYWRIGHT to an existing
// Playwright package, then run this file with Node. No dependency installation.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const componentPath = '/src/features/player/components/LyricsPanel.tsx'
const source = await (await fetch(origin + componentPath)).text()
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = filename => {
  const match = (source + '\n' + entry).match(new RegExp('"(/node_modules/\\.vite/deps/' + filename.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve Vite dependency ${filename}`)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import { AppearanceProvider } from '/src/features/appearance/components/AppearanceProvider.tsx';
import { LyricsPanel } from '${componentPath}';
import '/src/index.css';
import '/src/features/player/styles/player.css';
const lines = Array.from({length:40},(_,i)=>({id:'line-'+i,timeSeconds:i*10,original:'Lyric line '+i,translation:i%2?'译文 '+i:''}));
window.selections=[];
const root=ReactDOM.createRoot(document.getElementById('root'));
function Fixture(){
  const [state,setState]=React.useState({position:100,scope:'track-a',revision:0,empty:false,pending:false,interaction:'following',mounted:true});
  window.updateLyricsFixture=patch=>setState(old=>({...old,...patch}));
  const track=React.useMemo(()=>({id:state.scope,title:'Test',artist:'Artist',album:'Album',durationSeconds:400,coverTone:'lagoon',lyrics:state.empty?[]:lines.map(line=>({...line,id:state.scope+':'+line.id,original:line.original+' revision '+state.revision}))}),[state.scope,state.empty,state.revision]);
  const onLineSelect=position=>{window.selections.push({scope:state.scope,position});setState(old=>({...old,position}));};
  return React.createElement(AppearanceProvider,null,React.createElement('div',{className:'spmusic-app'},state.mounted&&React.createElement(LyricsPanel,{track,positionSeconds:state.position,interaction:state.interaction,detailsPending:state.pending,lyricLayoutKey:'test',tightThresholdSeconds:5,onLineSelect})));
}
root.render(React.createElement(Fixture));
`
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
console.log('BROWSER', browser.version())
const errors = []
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
page.on('pageerror', error => errors.push(error.message))
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__lyrics_fixture.js"')
await page.route('**/__lyrics_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__lyrics_test', route => route.fulfill({ contentType: 'text/html', body: html }))
if (process.env.SPMUSIC_ELASTIC_BASELINE) {
  const snapshot = JSON.parse(readFileSync(process.env.SPMUSIC_ELASTIC_BASELINE, 'utf8'))
  for (const [path, body] of Object.entries(snapshot)) {
    const pathname = path.split('?')[0]
    await page.route('**' + pathname + '*', route => route.fulfill({ contentType: 'text/javascript', body }))
  }
}
if (process.env.SPMUSIC_EXPECT_DRAG === '0') {
  const original = execFileSync('git', ['show', 'HEAD:src/features/player/hooks/useActiveLyricScroll.ts'], { encoding: 'utf8' })
  const ts = require('typescript')
  const baseline = ts.transpileModule(original, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/import \{([^}]+)\} from ['"]react['"];?/, (_match, names) => `import baselineReact from '${dependency('react.js')}'; const {${names}} = baselineReact;`)
    .replaceAll('@/features/player/model/lyricTimeline', '/src/features/player/model/lyricTimeline.ts')
  await page.route('**/src/features/player/hooks/useActiveLyricScroll.ts*', route => route.fulfill({ contentType: 'text/javascript', body: baseline }))
}
const list = page.locator('.lyrics-panel > ol')
const selections = () => page.evaluate(() => window.selections)
const scrollTop = () => list.evaluate(element => element.scrollTop)
const centerError = () => list.evaluate(element => {
  const active = element.querySelector('[data-active="true"]')
  const rect = element.getBoundingClientRect()
  const row = active.getBoundingClientRect()
  return Math.abs(row.top + row.height / 2 - rect.top - rect.height / 2)
})
const point = async () => {
  const rect = await list.boundingBox()
  assert(rect)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}
const update = async patch => {
  await page.evaluate(patch => window.updateLyricsFixture(patch), patch)
  await page.waitForTimeout(100)
}
const clearSelections = () => page.evaluate(() => { window.selections = [] })
async function reset() {
  await update({ mounted: false })
  await update({ mounted: true, position: 100, scope: 'track-a', revision: 0, empty: false, pending: false, interaction: 'following' })
  await list.waitFor()
  await page.waitForFunction(() => {
    const element = document.querySelector('.lyrics-panel > ol')
    const row = element?.querySelector('[data-active="true"]')
    if (!row) return false
    const rect = element.getBoundingClientRect(), active = row.getBoundingClientRect()
    return Math.abs(active.top + active.height / 2 - rect.top - rect.height / 2) < 3
  })
  await clearSelections()
}
async function beginDrag(delta = -120) {
  const p = await point()
  const before = await scrollTop()
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(p.x, p.y + delta, { steps: 8 })
  await page.waitForTimeout(100)
  return { p, before, after: await scrollTop() }
}
async function assertResumed(label) {
  await page.waitForFunction(() => {
    const list = document.querySelector('.lyrics-panel > ol'), row = list?.querySelector('[data-active="true"]')
    if (!row) return false
    const a = row.getBoundingClientRect(), b = list.getBoundingClientRect()
    return Math.abs(a.top + a.height / 2 - b.top - b.height / 2) < 3
  }, null, { timeout: 6500 })
  assert(await centerError() < 3, label)
}

const elasticSample = () => list.evaluate(element => ({
  top: element.scrollTop,
  max: element.scrollHeight - element.clientHeight,
  listTop: element.getBoundingClientRect().top,
  rows: [...element.querySelectorAll('li[data-lyric-index]')].map(row => row.getBoundingClientRect().top),
  offset: Number.parseFloat(getComputedStyle(element).translate.split(' ')[1]) || 0,
  distance: Number.parseFloat(getComputedStyle(element).getPropertyValue('--player-lyrics-overscroll-distance')),
  animations: element.getAnimations().length,
}))
async function elasticBoundary(direction) {
  await reset()
  // Let font/ResizeObserver layout frames settle before setting a manual edge.
  await page.waitForTimeout(250)
  await list.evaluate((element, direction) => { element.scrollTop = direction > 0 ? 0 : element.scrollHeight - element.clientHeight }, direction)
  await page.waitForTimeout(50)
  return elasticSample()
}
function assertUnifiedShift(before, after, direction, label) {
  const shifts = after.rows.map((top, index) => top - before.rows[index] + after.top - before.top)
  assert(shifts.every(shift => Math.abs(shift - shifts[0]) < 0.75), label + ': all lyric rows move together')
  assert(direction * shifts[0] > 1, label + ': displacement follows overscroll direction')
  assert(Math.abs(shifts[0] - after.offset + before.offset) < 0.75, label + ': actual geometry follows CSS translate')
  assert(after.distance > 0 && Math.abs(after.offset) <= after.distance + 0.75, label + ': displacement bounded by theme distance')
  assert(after.top >= 0 && after.top <= after.max, label + ': real scroll stays bounded')
}
async function elasticReturned(label) {
  await page.waitForFunction(() => {
    const element = document.querySelector('.lyrics-panel > ol')
    if (!element) return false
    return Math.abs(Number.parseFloat(getComputedStyle(element).translate.split(' ')[1]) || 0) < 0.25
      && element.getAnimations().length === 0
  }, null, { timeout: 2000 })
  assert(Math.abs((await elasticSample()).offset) < 0.25, label)
}
async function elasticOutwardFinished() {
  const duration = await list.evaluate(() => {
    const root = document.querySelector('.spmusic-app')
    const value = getComputedStyle(root).getPropertyValue('--app-motion-fast').trim()
    return Number.parseFloat(value) * (value.endsWith('s') && !value.endsWith('ms') ? 1000 : 1)
  })
  await page.waitForTimeout(Math.max(0, duration) + 20)
}
async function applyElasticTheme(value, motion = 'subtle') {
  const result = await page.evaluate(async ({ value, motion }) => {
    const { defaultAppearance } = await import('/src/features/appearance/model/defaultAppearance.ts')
    const { createAppearanceThemeDocument, deserializeAppearanceTheme } = await import('/src/features/appearance/model/appearanceThemeCodec.ts')
    const { APPEARANCE_STORAGE_KEY } = await import('/src/features/appearance/model/appearanceStorage.ts')
    const theme = structuredClone(defaultAppearance)
    theme.id = 'elastic-test-theme'
    theme.name = 'Elastic test'
    theme.motion.level = motion
    const document = createAppearanceThemeDocument(theme)
    if (value === 'missing') delete document.theme.player.lyricsOverscrollDistance
    else document.theme.player.lyricsOverscrollDistance = value
    const decoded = deserializeAppearanceTheme(JSON.stringify(document))
    const newValue = JSON.stringify({ schemaVersion: 2, currentThemeId: theme.id, colorSchemePreference: 'light', userThemes: [document] })
    localStorage.setItem(APPEARANCE_STORAGE_KEY, newValue)
    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_STORAGE_KEY, newValue }))
    return { ok: decoded.ok, distance: decoded.appearance.player.lyricsOverscrollDistance }
  }, { value, motion })
  await page.waitForTimeout(150)
  return result
}
async function elasticChecks() {
  const baseline = Boolean(process.env.SPMUSIC_ELASTIC_BASELINE)
  for (const direction of [1, -1]) {
    let before = await elasticBoundary(direction)
    let drag = await beginDrag(direction * 100)
    let after = await elasticSample()
    if (baseline) {
      assert(Math.abs(after.offset) < 0.25, 'verified drag baseline has no elastic displacement')
      assert(after.rows.every((top, index) => Math.abs(top - before.rows[index] + after.top - before.top) < 0.75),
        'baseline content has no elastic visual shift ' + JSON.stringify({ beforeTop: before.top, afterTop: after.top, beforeList: before.listTop, afterList: after.listTop }))
      await page.mouse.up()
      console.log('BASELINE_NO_ELASTIC_DRAG', direction, JSON.stringify({ top: after.top, offset: after.offset }))
    } else {
      assertUnifiedShift(before, after, direction, 'drag edge ' + direction)
      const firstOffset = after.offset
      await page.mouse.move(drag.p.x, drag.p.y + direction * 6000)
      const saturated = await elasticSample()
      assertUnifiedShift(before, saturated, direction, 'large drag edge ' + direction)
      assert(Math.abs(saturated.offset) >= Math.abs(firstOffset), 'continued drag increases displacement')
      assert(Math.abs(saturated.offset) - Math.abs(firstOffset) < 100, 'damping prevents raw input displacement')
      await page.mouse.up()
      await elasticReturned('drag release returns elastic offset to zero')
      assert.deepEqual(await selections(), [], 'elastic drag release does not seek')
      console.log('PASS elastic drag direction, unified content, bounded damping, release', direction,
        JSON.stringify({ initial: firstOffset, saturated: saturated.offset, limit: after.distance }))
    }

    before = await elasticBoundary(direction)
    const p = await point()
    await page.mouse.move(p.x, p.y)
    await page.mouse.wheel(0, -direction * 120)
    await page.waitForTimeout(40)
    after = await elasticSample()
    if (baseline) {
      assert(Math.abs(after.offset) < 0.25)
      console.log('BASELINE_NO_ELASTIC_WHEEL', direction)
    } else {
      assertUnifiedShift(before, after, direction, 'wheel edge ' + direction)
      await elasticReturned('wheel idle returns elastic offset to zero')
      console.log('PASS wheel edge direction and idle rebound', direction)
    }
  }
  if (baseline) return

  await elasticBoundary(1)
  let drag = await beginDrag(60)
  let before = await elasticSample()
  await page.mouse.move(drag.p.x, drag.p.y + 55)
  let after = await elasticSample()
  assert(after.offset > 0 && after.offset < before.offset, 'small reverse input smoothly reduces displacement')
  assert.equal(after.top, 0, 'reverse input consumes elastic displacement before scrolling')
  await page.mouse.move(drag.p.x, drag.p.y - 100)
  after = await elasticSample()
  assert(Math.abs(after.offset) < 0.25 && after.top > 50, 'larger reverse input resumes real scrolling')
  await page.mouse.up()
  assert.deepEqual(await selections(), [])
  console.log('PASS drag reversal reduces offset and then resumes scrolling')

  await elasticBoundary(1)
  const wheelPoint = await point()
  await page.mouse.move(wheelPoint.x, wheelPoint.y)
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(40)
  before = await elasticSample()
  await page.mouse.wheel(0, 5)
  await page.waitForTimeout(40)
  after = await elasticSample()
  assert(after.offset > 0 && after.offset < before.offset, 'reverse wheel input reduces displacement without snapping')
  assert.equal(after.top, 0)
  await page.mouse.wheel(0, 120)
  await page.waitForTimeout(40)
  after = await elasticSample()
  assert(Math.abs(after.offset) < 0.25 && after.top > 20, 'reverse wheel resumes real scrolling after elastic offset is consumed ' + JSON.stringify(after))
  console.log('PASS wheel reversal reduces offset and then resumes scrolling')

  await elasticBoundary(1)
  drag = await beginDrag(100)
  await page.mouse.up()
  await page.waitForTimeout(50)
  before = await elasticSample()
  assert(before.offset > 0, 'normal release has a visible rebound interval')
  const reboundPoint = await point()
  await page.mouse.move(reboundPoint.x, reboundPoint.y)
  await page.mouse.down()
  await page.mouse.move(reboundPoint.x, reboundPoint.y + 6)
  after = await elasticSample()
  assert(after.offset > 0 && Math.abs(after.offset - before.offset) < 12, 'new input continues sampled rebound position')
  await page.mouse.up()
  await elasticReturned('second release returns to zero')
  assert.deepEqual(await selections(), [])
  console.log('PASS input during rebound remains continuous')

  await elasticBoundary(1)
  await beginDrag(100)
  await page.mouse.wheel(0, -20)
  await page.waitForTimeout(40)
  const heldOffset = (await elasticSample()).offset
  await page.waitForTimeout(450)
  assert(Math.abs((await elasticSample()).offset - heldOffset) < 0.25, 'wheel during held edge drag must not start elastic idle rebound')
  await page.mouse.up()
  await elasticReturned('held edge release')
  assert.deepEqual(await selections(), [])
  console.log('PASS wheel during held edge drag does not start rebound')

  await elasticBoundary(1)
  const navigationPoint = await point()
  await page.mouse.move(navigationPoint.x, navigationPoint.y)
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(40)
  assert((await elasticSample()).offset > 0)
  await page.locator('li[data-lyric-index="0"]').focus()
  await page.keyboard.press('Enter')
  assert(Math.abs((await elasticSample()).offset) < 0.25, 'lyric navigation cancels elastic presentation before measuring its target')
  assert.equal((await selections()).at(-1)?.position, 0)
  console.log('PASS ordinary lyric navigation resets active elastic offset')

  for (const cancellation of ['cancel', 'blur', 'lost-capture', 'scope', 'lyrics', 'empty', 'pending', 'unmount']) {
    await elasticBoundary(1)
    await beginDrag(100)
    if (cancellation === 'scope') await update({ scope: 'track-b' })
    else if (cancellation === 'lyrics') await update({ revision: 1 })
    else if (cancellation === 'empty') await update({ empty: true })
    else if (cancellation === 'pending') await update({ pending: true })
    else if (cancellation === 'unmount') await update({ mounted: false })
    else await list.evaluate((element, kind) => {
      if (kind === 'cancel') element.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true }))
      if (kind === 'blur') window.dispatchEvent(new Event('blur'))
      if (kind === 'lost-capture' && element.hasPointerCapture(1)) element.releasePointerCapture(1)
    }, cancellation)
    await page.mouse.up()
    if (await list.count()) await elasticReturned(cancellation + ' clears elastic presentation')
    else await page.waitForTimeout(400)
    assert.deepEqual(await selections(), [], cancellation + ' never seeks')
    assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.effect?.target?.matches?.('.lyrics-panel > ol')).length), 0)
  }
  console.log('PASS elastic cancel, blur, lost capture, track/lyrics/loading/empty/unmount cleanup')

  let decoded = await applyElasticTheme('missing')
  assert(decoded.ok && decoded.distance === 40, 'old theme missing field defaults to 40')
  await elasticBoundary(1)
  await beginDrag(100)
  assert((await elasticSample()).offset > 0, 'old theme provider produces default elastic behavior')
  await page.mouse.up()
  await elasticReturned('old theme release')
  decoded = await applyElasticTheme(0)
  assert(decoded.ok && decoded.distance === 0)
  await elasticBoundary(1)
  await beginDrag(100)
  assert(Math.abs((await elasticSample()).offset) < 0.25, 'theme distance 0 disables elastic displacement')
  await page.mouse.up()
  const disabledPoint = await point()
  await page.mouse.move(disabledPoint.x, disabledPoint.y)
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(40)
  assert(Math.abs((await elasticSample()).offset) < 0.25)
  console.log('PASS old theme fallback and theme distance 0 disables drag/wheel displacement')

  decoded = await applyElasticTheme(96)
  assert(decoded.ok && decoded.distance === 96)
  await elasticBoundary(1)
  const configuredDrag = await beginDrag(100)
  await page.mouse.move(configuredDrag.p.x, configuredDrag.p.y + 6000)
  await elasticOutwardFinished()
  const configured = await elasticSample()
  assert(configured.distance === 96 && configured.offset > 20 && configured.offset <= 96, 'provider runtime honors configured maximum distance ' + JSON.stringify(configured))
  await page.mouse.up()
  await elasticReturned('custom distance rebound')
  console.log('PASS configured theme distance 96 reaches runtime and stays bounded')

  await applyElasticTheme(20)
  await elasticBoundary(1)
  await beginDrag(100)
  assert((await elasticSample()).offset > 0)
  await applyElasticTheme(0)
  assert(Math.abs((await elasticSample()).offset) < 0.25, 'disabling theme distance during a held drag clears presentation')
  await page.mouse.up()
  assert.deepEqual(await selections(), [])
  console.log('PASS theme distance change clears held elastic displacement')

  await applyElasticTheme(20)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const mode of ['system-reduce', 'theme-off']) {
    if (mode === 'theme-off') {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await applyElasticTheme(20, 'off')
    }
    await elasticBoundary(1)
    await beginDrag(100)
    assert(Math.abs((await elasticSample()).offset) < 0.25, mode + ' suppresses elastic motion')
    await page.mouse.up()
    assert.equal((await elasticSample()).animations, 0)
  }
  await applyElasticTheme(20)
  console.log('PASS system reduced motion and theme motion off')
}

async function defaultElasticChecks() {
  assert.equal((await elasticSample()).distance, 40, 'default theme runtime uses 40px elastic distance')
  const decoded = await applyElasticTheme('missing')
  assert(decoded.ok && decoded.distance === 40, 'old theme missing distance falls back to 40px')
  for (const direction of [1, -1]) {
    const before = await elasticBoundary(direction)
    assert.equal(before.distance, 40)
    const drag = await beginDrag(direction * 100)
    await page.mouse.move(drag.p.x, drag.p.y + direction * 6000)
    await elasticOutwardFinished()
    const stretched = await elasticSample()
    assertUnifiedShift(before, stretched, direction, 'default drag ' + direction)
    assert(Math.abs(stretched.offset) > 39 && Math.abs(stretched.offset) <= 40, 'continued default drag approaches the 40px limit')
    await page.mouse.up()
    await elasticReturned('default drag rebounds to zero')
    assert.deepEqual(await selections(), [])
    const wheelBefore = await elasticBoundary(direction)
    const p = await point()
    await page.mouse.move(p.x, p.y)
    await page.mouse.wheel(0, -direction * 120)
    await page.mouse.wheel(0, -direction * 6000)
    // Quiet input starts returning after outward completion. Sample the target
    // frame itself rather than waiting past fast duration into the rebound.
    await page.waitForFunction(() => {
      const element = document.querySelector('.lyrics-panel > ol')
      return Math.abs(Number.parseFloat(getComputedStyle(element).translate.split(' ')[1]) || 0) > 39.9
    }, null, { timeout: 2000 })
    const wheeled = await elasticSample()
    assertUnifiedShift(wheelBefore, wheeled, direction, 'default wheel ' + direction)
    assert(Math.abs(wheeled.offset) > 39 && Math.abs(wheeled.offset) <= 40, 'continued default wheel remains bounded at 40px ' + JSON.stringify(wheeled))
    await elasticReturned('default wheel rebounds to zero')
    console.log('PASS default 40px drag/wheel direction, bounds and rebound', direction,
      JSON.stringify({ drag: stretched.offset, wheel: wheeled.offset, limit: stretched.distance }))
  }
  console.log('PASS default runtime and old-theme fallback both use 40px')
  const explicit = await applyElasticTheme(180)
  assert(explicit.ok && explicit.distance === 180 && (await elasticSample()).distance === 180,
    'an explicitly configured custom theme distance 180 remains supported')
  console.log('PASS explicit custom theme distance 180 remains 180px')
}

try {
  await page.goto(origin + '/__lyrics_test')
  await list.waitFor()
  await page.addStyleTag({ content: '.lyrics-panel{position:absolute;left:250px;top:120px;width:500px;height:320px;--prototype-unit:1px;--player-lyrics-item-height:64px;--player-lyrics-font-size:20px;--player-lyrics-line-height:24px;--player-lyrics-translation-font-size:18px;--player-lyrics-translation-line-height:22px;--player-lyrics-tight-spacing:8;--player-lyrics-normal-spacing:12}.lyrics-panel>ol{height:320px}' })
  await page.evaluate(() => document.fonts.ready)
  await reset()

  // Equivalent baseline proves the feature's absence before implementation.
  if (process.env.SPMUSIC_ELASTIC_DEFAULT_ONLY) {
    await defaultElasticChecks()
  } else if (process.env.SPMUSIC_EXPECT_DRAG === '0') {
    const result = await beginDrag()
    await page.mouse.up()
    assert(Math.abs(result.after - result.before) < 2)
    console.log('BASELINE_NO_DRAG', JSON.stringify(result))
  } else {
    let drag
    if (!process.env.SPMUSIC_QUICK) {
    drag = await beginDrag()
    assert(drag.after - drag.before > 70, 'upward drag moves toward later lyrics')
    await page.mouse.up()
    assert.deepEqual(await selections(), [], 'drag release must not seek')
    const manualTop = await scrollTop()
    await update({ position: 130 })
    await page.waitForTimeout(300)
    assert(Math.abs(await scrollTop() - manualTop) < 2, 'automatic follow stays suspended during manual browsing')
    await assertResumed('drag resumes following after existing idle delay')
    console.log('PASS drag, no accidental seek, follow suspension and resume')

    await reset()
    const p = await point(), wheelBefore = await scrollTop()
    await page.mouse.move(p.x, p.y)
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(150)
    const wheelAfter = await scrollTop()
    assert(wheelAfter - wheelBefore > 70)
    await update({ position: 130 })
    await page.waitForTimeout(300)
    assert(Math.abs(await scrollTop() - wheelAfter) < 2)
    await assertResumed('wheel retains existing resume behavior')
    assert.deepEqual(await selections(), [])
    console.log('PASS original native wheel, follow suspension and resume')

    await reset()
    drag = await beginDrag()
    await page.mouse.wheel(0, 40)
    await page.waitForTimeout(150)
    const heldTop = await scrollTop()
    await page.waitForTimeout(5300)
    assert(Math.abs(await scrollTop() - heldTop) < 2, 'holding a drag beyond idle delay, even with wheel input, must not recenter')
    await page.mouse.up()
    assert.deepEqual(await selections(), [])
    await assertResumed('release starts idle delay')
    console.log('PASS long-held drag does not resume prematurely')

    await reset()
    drag = await beginDrag(100)
    assert(drag.before - drag.after > 70, 'downward drag moves toward earlier lyrics')
    await page.mouse.up()
    assert.deepEqual(await selections(), [])
    const clickRow = page.locator('li[data-lyric-index="9"]')
    await clickRow.click()
    assert.equal((await selections()).at(-1)?.position, 90, 'a subsequent normal click still seeks')
    await clearSelections()
    await clickRow.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    assert.deepEqual((await selections()).map(item => item.position), [90, 90], 'keyboard activation retained')
    console.log('PASS downward drag, next normal click, keyboard Enter and Space')

    await reset()
    const small = await point()
    await page.mouse.move(small.x, small.y)
    await page.mouse.down()
    await page.mouse.move(small.x, small.y + 2)
    await page.mouse.up()
    assert.equal((await selections()).length, 1, 'small hand jitter still counts as normal click')
    await reset()
    const right = await point(), rightBefore = await scrollTop()
    await page.mouse.move(right.x, right.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(right.x, right.y - 100)
    await page.mouse.up({ button: 'right' })
    assert(Math.abs(await scrollTop() - rightBefore) < 2)
    assert.deepEqual(await selections(), [])
    console.log('PASS click jitter tolerance and non-left button exclusion')

    await reset()
    drag = await beginDrag()
    await page.mouse.move(drag.p.x + 550, drag.p.y - 160)
    const outsideTop = await scrollTop()
    assert(outsideTop > drag.after + 20, 'pointer capture continues dragging outside list')
    await page.mouse.up()
    await page.mouse.move(drag.p.x, drag.p.y)
    assert(Math.abs(await scrollTop() - outsideTop) < 2)
    assert.deepEqual(await selections(), [])
    console.log('PASS leave region, captured motion, outside release cleanup')

    for (const cancellation of ['cancel', 'blur', 'lost-capture']) {
      await reset()
      drag = await beginDrag()
      await list.evaluate((element, kind) => {
        if (kind === 'cancel') element.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true }))
        if (kind === 'blur') window.dispatchEvent(new Event('blur'))
        if (kind === 'lost-capture' && element.hasPointerCapture(1)) element.releasePointerCapture(1)
      }, cancellation)
      await page.waitForTimeout(100)
      const stopped = await scrollTop()
      await page.mouse.move(drag.p.x, drag.p.y - 200)
      assert(Math.abs(await scrollTop() - stopped) < 2, cancellation + ' stops gesture')
      await page.mouse.up()
      assert.deepEqual(await selections(), [], cancellation + ' release must not seek')
      assert.notEqual(await list.getAttribute('data-dragging'), 'true')
    }
    console.log('PASS pointercancel, window blur, lost pointer capture cleanup')

    for (const patch of [{ scope: 'track-b' }, { pending: true }, { empty: true }, { mounted: false }]) {
      await reset()
      drag = await beginDrag()
      await update(patch)
      await page.mouse.move(drag.p.x, drag.p.y)
      await page.mouse.up()
      assert.deepEqual(await selections(), [], 'interrupted drag never seeks another track or new list')
    }
    await reset()
    await update({ empty: true })
    assert.equal(await list.count(), 0)
    await page.locator('.track-lyrics-empty-state').click()
    assert.deepEqual(await selections(), [])
    console.log('PASS track switch, loading, empty lyrics, unmount interruptions')
    }

    await reset()
    await beginDrag()
    await update({ revision: 1 })
    const replacementRow = await page.locator('li[data-lyric-index="10"]').boundingBox()
    await page.mouse.move(replacementRow.x + replacementRow.width / 2, replacementRow.y + replacementRow.height / 2)
    await page.mouse.up()
    assert.deepEqual(await selections(), [], 'lyrics identity update with stable DOM row IDs must not turn a drag release into seek')
    console.log('PASS same-row lyrics replacement interruption')

    await reset()
    await update({ interaction: 'seeking' })
    drag = await beginDrag()
    const seekingDragTop = await scrollTop()
    await update({ interaction: 'following', position: 160 })
    await page.waitForTimeout(300)
    assert(Math.abs(await scrollTop() - seekingDragTop) < 2, 'a held drag stays manual when seeking transitions to following')
    await page.mouse.up()
    assert.deepEqual(await selections(), [])
    console.log('PASS seeking to following transition during held drag')

    for (const direction of [-1, 1]) {
      await reset()
      drag = await beginDrag(direction * 600)
      await page.mouse.move(drag.p.x, drag.p.y + direction * 7000)
      await page.mouse.up()
      const edge = await list.evaluate(element => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight }))
      assert(edge.top >= 0 && edge.top <= edge.max)
      assert(Math.abs(edge.top - (direction < 0 ? edge.max : 0)) < 2, 'drag clamps at list boundary ' + JSON.stringify(edge))
      assert.deepEqual(await selections(), [])
    }
    console.log('PASS first and last lyric boundaries')
    if (process.env.SPMUSIC_ELASTIC) await elasticChecks()
  }
  assert.deepEqual(errors, [], 'no browser runtime errors')
  console.log('LYRICS_BROWSER_PASS')
} finally {
  await browser.close()
}
