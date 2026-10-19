// Real touch regression: start Vite, set SPMUSIC_PLAYWRIGHT to an existing
// Playwright package, and optionally SPMUSIC_BROWSER_EXECUTABLE to Edge/Chromium.
// No dependency is installed. Production components and gesture handlers are
// served unchanged; only the view model and audio preparation boundary are fake.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const componentPath = '/src/features/player/components/PlayerSurface.tsx'
const transformed = await (await fetch(origin + componentPath)).text()
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = (transformed + '\n' + entry).match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
// Reuse the existing full-surface fixture without executing its test runner.
const existing = readFileSync(new URL('./coverTransition.browser.test.mjs', import.meta.url), 'utf8')
const template = existing.match(/const fixture = `([\s\S]*?)`\r?\nconst html/)[1]
let fixture = template.replace(/\$\{dependency\('([^']+)'\)\}/g, (_match, name) => dependency(name))
  .replaceAll('${componentPath}', componentPath)
  .replace('window.coverEvents=[];', 'window.coverEvents=[];window.playlistRequests=[];window.playlistSelections=[];window.previewEvents=[];window.inputTrace=[];')
  .replace('window.coverConfig={refresh:true,reject:false,staged:false};', 'window.coverConfig={refresh:false,reject:false,staged:false,previewDelay:0};')
  .replace('playlist:{isOpen:false,onOpenChange:noop,', `playlist:{isOpen:state.isPlaylistOpen||false,onOpenChange:open=>{window.playlistRequests.push(open);setState(s=>({...s,isPlaylistOpen:open}))},currentTrackId:tracks[state.index].id,onTrackSelect:id=>{window.playlistSelections.push(id);select(tracks.findIndex(t=>t.id===id))},`)
  .replace('feedback:{onToggle:noop}', "feedback:{onToggle:value=>window.coverEvents.push({type:'feedback',value})}")
  .replace('onDiscardTrackPreview:noop', `onDiscardTrackPreview:id=>{window.previewEvents.push({type:'discard',id});if(id<0){tokenId++;pending=null}else if(pending?.id===id)pending=null}`)
  .replace('window.coverCommits.push(id);', `window.previewEvents.push({type:'commit',id,origin:pending?.originTrackId,current:tracks[currentIndex].id});window.coverCommits.push(id);`)
  .replace('currentIndex=state.index;', 'currentIndex=state.index;window.fixtureTrackId=tracks[state.index].id;')
const prepareStart = fixture.indexOf(' const prepare=')
const prepareEnd = fixture.indexOf(' const commit=', prepareStart)
assert(prepareStart >= 0 && prepareEnd > prepareStart, 'fixture preparation boundary')
fixture = fixture.slice(0, prepareStart) + `
 const prepare=React.useCallback(async direction=>{
   const id=++tokenId,index=(currentIndex+direction+tracks.length)%tracks.length,originTrackId=tracks[currentIndex].id;
   pending=null;window.previewEvents.push({type:'prepare',id,direction,originTrackId});
   if(window.coverConfig.previewDelay)await new Promise(resolve=>setTimeout(resolve,window.coverConfig.previewDelay));
   if(id!==tokenId){window.previewEvents.push({type:'stale',id});return null}
   pending={id,originTrackId,targetTrackId:tracks[index].id,direction,track:tracks[index],artwork:artworks[index]};
   window.previewEvents.push({type:'prepared',id});return pending
 },[]);
` + fixture.slice(prepareEnd)
fixture = `for(const type of ['pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture','touchend','click'])document.addEventListener(type,e=>window.inputTrace?.push({type,target:e.target.tagName,cls:String(e.target.className),pointerId:e.pointerId,isPrimary:e.isPrimary,detail:e.detail,cancelable:e.cancelable,defaultPrevented:e.defaultPrevented,track:window.fixtureTrackId,captured:document.querySelector('.track-card-deck')?.hasPointerCapture(e.pointerId),time:performance.now(),eventTime:e.timeStamp,trusted:e.isTrusted}),true);\n` + fixture
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__cover_collapse_fixture.js"')
const browser = await chromium.launch({ headless: true, ...(process.env.SPMUSIC_BROWSER_EXECUTABLE
  ? { executablePath: process.env.SPMUSIC_BROWSER_EXECUTABLE }
  : { channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' }) })
console.log('BROWSER', browser.version())
const active = '.track-card-plane[data-track-card-phase="active"]'
const caseFilter = process.env.SPMUSIC_COVER_CASE ? new RegExp(process.env.SPMUSIC_COVER_CASE) : null
let passed = 0

async function open(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, hasTouch: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let body = fixture
  if (options.noArtwork) body = body.replace('const artworks=', 'tracks.forEach(t=>delete t.coverImage);const artworks=')
  if (options.noPreview) body = body.replace('onPrepareTrackPreview:prepare', 'onPrepareTrackPreview:undefined')
  await page.route('**/__cover_collapse_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body }))
  await page.route('**/__cover_collapse_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__cover_collapse_test')
  await page.waitForSelector(active + ' .cover-frame')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1 }] : [] })
  const point = async () => {
    const box = await page.locator(active + ' .cover-frame').first().boundingBox()
    assert(box, 'active cover geometry')
    return { x: box.x + box.width * .5, y: box.y + box.height * .35, width: box.width }
  }
  return { page, errors, touch, point }
}

async function tap(context, dx = 0, dy = 0, hold = 100) {
  const { touch, point, page } = context
  const { x, y } = await point()
  await touch('touchStart', { x, y })
  if (hold) await page.waitForTimeout(hold)
  if (dx || dy) await touch('touchMove', { x: x + dx, y: y + dy })
  await touch('touchEnd')
}

async function tapMovingCover(context, hold = 0) {
  const { page, touch } = context
  // Confirm a target before input. Never cancel/retry a first touch or turn a
  // quick tap into a 60ms hold to make the destination assertion pass.
  const handle = await page.waitForFunction(() => {
    for (const button of document.querySelectorAll('.cover-collapse-button')) {
      const box = button.getBoundingClientRect()
      const x = box.x + box.width / 2, y = box.y + box.height * .35
      if (document.elementFromPoint(x, y)?.closest('.cover-collapse-button')) return { x, y }
    }
    return false
  })
  const point = await handle.jsonValue()
  await touch('touchStart', point)
  if (hold) await page.waitForTimeout(hold)
  await touch('touchEnd')
  const down = await page.evaluate(() => window.inputTrace.filter(e => e.type === 'pointerdown').at(-1))
  assert(down?.cls.includes('cover-collapse-button'), 'first touch must actually start on the sampled cover: ' + JSON.stringify(down))
}

async function assertFirstQuickCollapsed(context, point, baseline) {
  const { page, touch } = context
  await page.waitForTimeout(200)
  const first = await page.evaluate(() => ({ requests: window.playlistRequests, commits: window.coverCommits.length, prepares: window.previewEvents.filter(e => e.type === 'prepare').length, selections: window.playlistSelections, track: window.fixtureTrackId, panel: !!document.querySelector('.playlist-panel'), trace: window.inputTrace }))
  // A second click is diagnostic evidence only. It can never rescue a failed
  // first-click assertion or change the recorded first result.
  let second = null
  if (!first.panel) {
    await page.waitForTimeout(500)
    await touch('touchStart', point)
    await touch('touchEnd')
    await page.waitForTimeout(100)
    second = await page.evaluate(() => ({ requests: window.playlistRequests, track: window.fixtureTrackId }))
  }
  assert.deepEqual(first.requests, [true], JSON.stringify({ first, second }))
  assert(first.panel, 'the first touch must open and retain the playlist')
  assert.equal(first.track, baseline.track)
  assert.equal(first.commits, baseline.commits)
  assert.equal(first.prepares, baseline.prepares)
  assert.deepEqual(first.selections, [])
  const down = first.trace.filter(event => event.type === 'pointerdown').at(-1)
  const up = first.trace.find(event => event.type === 'pointerup' && event.pointerId === down?.pointerId)
  console.log('FIRST_TOUCH', JSON.stringify({ down: down?.cls, up: up?.cls, durationMs: up ? up.eventTime - down.eventTime : null, compatibilityClicks: first.trace.filter(event => event.type === 'click' && event.pointerId === down?.pointerId).map(event => event.target), requests: first.requests }))
}

async function assertCollapsed(page) {
  // The native compatibility click follows pointerup; waiting through it and
  // the existing view transition proves the destination actually stays open.
  await page.waitForTimeout(650)
  const state = await page.evaluate(() => ({ requests: window.playlistRequests, commits: window.coverCommits, selections: window.playlistSelections, prepares: window.previewEvents.filter(e => e.type === 'prepare'), panel: !!document.querySelector('.playlist-panel'), trace: window.inputTrace }))
  assert.deepEqual(state.requests, [true], JSON.stringify(state))
  assert.deepEqual(state.commits, [], 'a cover tap never commits a track preview')
  assert.deepEqual(state.selections, [], 'compatibility click never selects a playlist track')
  assert.deepEqual(state.prepares, [], 'a cover tap never prepares another track')
  assert(state.panel, 'playlist stays mounted after compatibility click')
  assert(state.trace.some(event => event.type === 'pointerup' && event.trusted), 'real touch completion observed; Chromium may omit its compatibility click')
}

async function assertPlayerStable(page, expected = 0) {
  await page.waitForTimeout(650)
  const state = await page.evaluate(() => ({ requests: window.playlistRequests, title: document.querySelector('.track-card-plane[data-track-card-phase="active"] .title-pill')?.textContent, previews: document.querySelectorAll('.track-card-plane[data-track-card-phase="preview"]').length, panel: !!document.querySelector('.playlist-panel') }))
  assert.deepEqual(state.requests, [], JSON.stringify(state))
  assert(state.title?.includes('Song ' + expected), JSON.stringify(state))
  assert.equal(state.previews, 0)
  assert.equal(state.panel, false)
}

async function drag(context, direction = 1, fraction = .8, release = true) {
  const { page, touch } = context
  const box = await page.locator(active + ' .cover-frame').first().boundingBox()
  const x = box.x + box.width * (direction > 0 ? .96 : .04)
  const y = box.y + box.height * .35
  await touch('touchStart', { x, y })
  await touch('touchMove', { x: x - direction * 30, y })
  await page.waitForSelector('.track-card-plane[data-track-card-phase="preview"]')
  await page.waitForTimeout(120)
  for (let step = 1; step <= 8; step++) {
    await touch('touchMove', { x: x - direction * (30 + (box.width * fraction - 30) * step / 8), y })
  }
  if (release) await touch('touchEnd')
}

async function check(name, run, options) {
  if (caseFilter && !caseFilter.test(name)) return
  const context = await open(options)
  try {
    await run(context)
    assert.deepEqual(context.errors, [], 'no uncaught browser errors')
    console.log('PASS', name)
    passed++
  } finally { await context.page.close() }
}

try {
  for (const source of ['next', 'drag']) for (const hold of [0, 1, 5, 10, 20]) {
    await check(`fixed ${source} cover first quick touch hold=${hold}ms`, async context => {
      const { page, point, touch } = context
      const { x, y } = await point()
      const fixed = { x, y }
      if (source === 'next') {
        const box = await page.getByRole('button', { name: '下一首', exact: true }).boundingBox()
        await touch('touchStart', { x: box.x + box.width / 2, y: box.y + box.height / 2 })
        await touch('touchEnd')
      } else {
        await drag(context)
      }
      await page.waitForFunction(() => window.fixtureTrackId === 'track-1')
      // This is the user's fixed cover location while the card transition is
      // running, rather than chasing its moving DOM or waiting for a settle.
      await page.waitForTimeout(180)
      const baseline = await page.evaluate(() => ({ track: window.fixtureTrackId, commits: window.coverCommits.length, prepares: window.previewEvents.filter(e => e.type === 'prepare').length }))
      await touch('touchStart', fixed)
      if (hold) await page.waitForTimeout(hold)
      await touch('touchEnd')
      await assertFirstQuickCollapsed(context, fixed, baseline)
    })
  }
  await check('fixed cover horizontal motion during animation never collapses', async context => {
    const { page, point, touch } = context
    const { x, y } = await point()
    await page.getByRole('button', { name: '下一首', exact: true }).click()
    await page.waitForFunction(() => window.fixtureTrackId === 'track-1')
    await page.waitForTimeout(180)
    await touch('touchStart', { x, y })
    await touch('touchMove', { x: x - 50, y })
    await touch('touchEnd')
    await assertPlayerStable(page, 1)
    assert.deepEqual(await page.evaluate(() => window.coverCommits), [])
  })
  await check('outside fixed cover and in lyrics never collapses', async context => {
    const { page, touch } = context
    const box = await page.locator(active + ' .cover-frame').boundingBox()
    const point = { x: box.x + box.width + 35, y: box.y + box.height * .35 }
    await touch('touchStart', point)
    await touch('touchEnd')
    await assertPlayerStable(page)
  })
  await check('mouse drag pointerId reuse preserves the next and like buttons', async ({ page }) => {
    const box = await page.locator(active + ' .cover-frame').boundingBox()
    const x = box.x + box.width * .96, y = box.y + box.height * .35
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 30, y)
    await page.waitForSelector('.track-card-plane[data-track-card-phase="preview"]')
    await page.waitForTimeout(120)
    await page.mouse.move(x - box.width * .8, y, { steps: 8 })
    await page.mouse.up()
    // Do not wait out the released drag ref before reusing mouse pointerId 1.
    await page.getByRole('button', { name: '下一首', exact: true }).click({ force: true })
    await page.waitForFunction(() => window.fixtureTrackId === 'track-2')
    await page.getByRole('button', { name: '喜欢', exact: true }).click()
    assert.equal(await page.evaluate(() => window.coverEvents.filter(e => e.type === 'feedback').length), 1)
    assert.equal(await page.evaluate(() => window.coverCommits.length), 1)
    assert.deepEqual(await page.evaluate(() => window.playlistRequests), [])
  })
  for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [7, 0], [-7, 0], [0, 7]]) {
    await check(`trusted touch tap with ${dx},${dy}px jitter stays in playlist without changing track`, async context => {
      await tap(context, dx, dy)
      await assertCollapsed(context.page)
    })
  }
  await check('long touch still collapses once without preview or selection', async context => {
    await tap(context, 3, 2, 700)
    await assertCollapsed(context.page)
  })
  await check('holding still retains the original rendered cover without a preview', async context => {
    const { page, point, touch } = context
    await page.evaluate(() => { window.retainedCover = document.querySelector('.track-card-plane[data-track-card-phase="active"] .cover-frame') })
    const { x, y } = await point()
    await touch('touchStart', { x, y })
    await page.waitForTimeout(400)
    const held = await page.evaluate(() => ({ same: window.retainedCover === document.querySelector('.track-card-plane[data-track-card-phase="active"] .cover-frame'), prepares: window.previewEvents.filter(e => e.type === 'prepare').length, transform: getComputedStyle(window.retainedCover.parentElement.parentElement).transform, requests: window.playlistRequests }))
    assert(held.same, 'pointerdown must not remount the cover')
    assert.equal(held.prepares, 0)
    assert.deepEqual(held.requests, [])
    await touch('touchEnd')
    await assertCollapsed(page)
  })
  await check('large vertical movement is cancellation rather than a tap', async context => {
    await tap(context, 0, 40)
    await assertPlayerStable(context.page)
    assert.deepEqual(await context.page.evaluate(() => window.coverCommits), [])
  })
  await check('cover with no artwork accepts native touch', async context => {
    assert.equal(await context.page.locator(active + ' .cover-art').getAttribute('data-has-image'), 'false')
    await tap(context)
    await assertCollapsed(context.page)
  }, { noArtwork: true })
  await check('cover without preview capability accepts native touch', async context => {
    await tap(context)
    await assertCollapsed(context.page)
  }, { noPreview: true })
  await check('touching each overlay button retains its own action', async context => {
    const { page, touch } = context
    for (const index of [0, 1, 2]) {
      const box = await page.locator(active + ' .cover-actions button').nth(index).boundingBox()
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await touch('touchStart', point)
      await touch('touchEnd')
      if (index === 2) await page.waitForSelector('[role="dialog"]')
      assert.deepEqual(await page.evaluate(() => window.playlistRequests), [])
      assert.deepEqual(await page.evaluate(() => window.coverCommits), [])
    }
    assert.equal(await page.evaluate(() => window.coverEvents.filter(e => e.type === 'feedback').length), 2)
    assert.equal(await page.locator('button button').count(), 0)
  })
  for (const delay of [0, 200]) {
    await check(`touch cancellation invalidates pending preview (${delay}ms hydration)`, async context => {
      const { page, point, touch } = context
      await page.evaluate(delay => { window.coverConfig.previewDelay = delay }, delay)
      const { x, y } = await point()
      await touch('touchStart', { x, y })
      await touch('touchMove', { x: x - 50, y })
      await touch('touchCancel')
      await assertPlayerStable(page)
      assert.deepEqual(await page.evaluate(() => window.coverCommits), [])
    })
  }
  await check('forward and reverse touch drags still commit exactly once per drag', async context => {
    await drag(context, 1)
    await assertPlayerStable(context.page, 1)
    await drag(context, -1)
    await assertPlayerStable(context.page, 0)
    const commits = await context.page.evaluate(() => window.previewEvents.filter(e => e.type === 'commit'))
    assert.equal(commits.length, 2)
    assert(commits.every(event => event.origin === event.current), 'commits use the current production origin contract')
    assert.deepEqual(await context.page.evaluate(() => window.playlistSelections), [])
  })
  await check('short touch drag rolls back without collapse or changing track', async context => {
    await drag(context, 1, .12)
    await assertPlayerStable(context.page)
    assert.deepEqual(await context.page.evaluate(() => window.coverCommits), [])
  })
  await check('Escape during a held drag cancels its following native click', async context => {
    await drag(context, 1, .6, false)
    await context.page.keyboard.press('Escape')
    await context.touch('touchEnd')
    await assertPlayerStable(context.page)
    assert.deepEqual(await context.page.evaluate(() => window.coverCommits), [])
  })
  for (const phaseMs of [0, 40, 120]) {
    await check(`tap during track animation at ${phaseMs}ms does not commit another track`, async context => {
      await context.page.evaluate(() => window.coverSelect(1))
      await context.page.waitForFunction(() => window.fixtureTrackId === 'track-1')
      if (phaseMs) await context.page.waitForTimeout(phaseMs)
      await tapMovingCover(context)
      await assertCollapsed(context.page)
      assert.equal(await context.page.evaluate(() => window.fixtureTrackId), 'track-1')
    })
  }
  await check('repeated player/playlist touch cycles never select another track', async context => {
    const { page, touch } = context
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.evaluate(() => { window.playlistRequests = [] })
      await tap(context, 3, 1)
      await assertCollapsed(page)
      const box = await page.locator('.playlist-playback-track-button').boundingBox()
      await touch('touchStart', { x: box.x + box.width / 2, y: box.y + box.height / 2 })
      await touch('touchEnd')
      await page.waitForSelector(active + ' .cover-frame')
      await page.waitForTimeout(500)
      assert.deepEqual(await page.evaluate(() => window.playlistRequests), [true, false])
      assert.equal(await page.evaluate(() => window.fixtureTrackId), 'track-0')
    }
  })
  for (const key of ['Enter', 'Space']) {
    await check(`keyboard ${key} remains accessible`, async ({ page }) => {
      await page.locator(active + ' .cover-collapse-button').focus()
      await page.keyboard.press(key)
      await page.waitForTimeout(650)
      assert.deepEqual(await page.evaluate(() => window.playlistRequests), [true])
      assert.equal(await page.locator('.playlist-panel').count(), 1)
    })
  }
  console.log('COVER_COLLAPSE_REGRESSION_PASS', passed)
} finally { await browser.close() }
