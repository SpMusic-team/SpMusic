// Independent acceptance of the real playlist detail hero menu.
// Run Vite and point SPMUSIC_PLAYWRIGHT to an existing Playwright installation.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
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
const shared = readFileSync(new URL('./playlistManagementLayouts.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal)
let fixture = runInNewContext(literal[1], { dependency })
fixture = fixture.replace("[view,setView]=React.useState('management')", "[view,setView]=React.useState('detail')")
fixture = fixture.replace("React.createElement(PlaylistPanel,{...common,library,tracks,", "React.createElement(PlaylistPanel,{...common,library,tracks,playlistName:new URLSearchParams(location.search).has('long')?'很长的播放列表名称'.repeat(30):'测试播放列表',totalDurationSeconds:14400,totalDurationStatus:'ready',onOpenAudio:()=>window.actions.push('import-audio'),isOpenAudioDisabled:new URLSearchParams(location.search).has('busy'),")
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__playlist_hero_more_fixture.js"')
const directory = process.env.SPMUSIC_TEST_SCREENSHOTS || 'C:/Users/winkeses/.codex/tmp/playlist-hero-more-independent'
mkdirSync(directory, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const errors = [], evidence = []
const labels = ['重新扫描', '专辑封面', '删除重复项', '重新排序', '添加地址', '在侧栏置顶', '列表选项']
for (const name of ['3ae57', '9b2af', '66817', '9a79e', '08f63', 'f277d', 'b969c', 'e41ce']) {
  assert(statSync(new URL('../../../assets/playlist-hero-menu/' + name + '.svg', import.meta.url)).size > 0, name + ' local Figma asset exists')
}
async function open(query = '', width = 1280, height = 900) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.clear())
  await page.route('**/__playlist_hero_more_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__playlist_hero_more_test*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__playlist_hero_more_test' + query)
  await page.locator('.playlist-panel').waitFor()
  await page.evaluate(() => document.fonts.ready)
  return page
}
const trigger = page => page.locator('.playlist-panel > .playlist-hero .playlist-hero-more-button')
const menu = page => page.getByRole('dialog', { name: '播放列表更多操作', exact: true })
async function geometry(page) {
  return menu(page).evaluate(node => {
    const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    return {
      box: box(node), radius: getComputedStyle(node).borderRadius, background: getComputedStyle(node).backgroundColor,
      header: box(node.querySelector('.playlist-hero-more-header')),
      titleSize: getComputedStyle(node.querySelector('.playlist-hero-more-info h2')).fontSize,
      metadataSize: getComputedStyle(node.querySelector('.playlist-hero-more-info p')).fontSize,
      rows: [...node.querySelectorAll('.playlist-hero-more-action')].map(box),
      images: [...node.querySelectorAll('img')].map(img => ({ sourceKind: img.src.split(':')[0], loaded: img.complete && img.naturalWidth > 0, box: box(img) })),
      scroll: (() => { const el = node.querySelector('.playlist-hero-more-scroll'); return { height: el.clientHeight, full: el.scrollHeight } })(),
    }
  })
}
async function markerStyles(scroll) {
  return scroll.evaluate(el => {
    const style = getComputedStyle(el), bar = getComputedStyle(el, '::-webkit-scrollbar'), track = getComputedStyle(el, '::-webkit-scrollbar-track'), thumb = getComputedStyle(el, '::-webkit-scrollbar-thumb')
    return { width: bar.width, marginRight: style.marginRight, trackTop: track.marginTop, trackBottom: track.marginBottom, trackBackground: track.backgroundColor,
      thumbRadius: thumb.borderRadius, thumbImage: thumb.backgroundImage, thumbSize: thumb.backgroundSize, thumbRepeat: thumb.backgroundRepeat,
      thumbPosition: thumb.backgroundPosition, progress: Number(style.getPropertyValue('--more-scroll-progress')), horizontalOverflow: el.scrollWidth > el.clientWidth }
  })
}
async function markerPositions(scroll) {
  const samples = []
  const range = await scroll.evaluate(el => el.scrollHeight - el.clientHeight)
  if (range <= 0) {
    const sample = await markerStyles(scroll)
    assert.equal(sample.progress, 0, 'nonoverflowing content keeps marker at zero')
    return [{ ...sample, range }]
  }
  for (const fraction of [0, .5, 1]) {
    await scroll.evaluate((el, fraction) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * fraction }, fraction)
    await scroll.page().waitForFunction(({ selector, fraction }) => {
      const el = document.querySelector(selector), actual = Number(getComputedStyle(el).getPropertyValue('--more-scroll-progress'))
      return Math.abs(actual - fraction) < .005
    }, { selector: await scroll.evaluate(el => '.' + el.className), fraction }).catch(async error => {
      console.error('Marker sample failed', fraction, await scroll.evaluate(el => ({ className: el.className, top: el.scrollTop, full: el.scrollHeight, height: el.clientHeight, progress: getComputedStyle(el).getPropertyValue('--more-scroll-progress'), menu: el.parentElement.getBoundingClientRect().toJSON() })))
      throw error
    })
    const sample = await markerStyles(scroll)
    assert(Math.abs(sample.progress - fraction) < .005, 'marker follows actual content scroll')
    assert.equal(sample.horizontalOverflow, false)
    samples.push(sample)
  }
  return samples
}
async function playlistRailGeometry(page) {
  return menu(page).evaluate(el => {
    const box = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom } }
    const rail = el.querySelector('[role="scrollbar"]'), thumb = rail.querySelector('.playlist-hero-more-scrollbar-thumb'), scroll = el.querySelector('.playlist-hero-more-scroll')
    return { menu: box(el), radius: parseFloat(getComputedStyle(el).borderRadius), rail: box(rail), thumb: box(thumb), thumbColor: getComputedStyle(thumb).backgroundImage,
      header: box(el.querySelector('.playlist-hero-more-header')), scrollTop: scroll.scrollTop, range: scroll.scrollHeight - scroll.clientHeight,
      horizontalOverflow: scroll.scrollWidth > scroll.clientWidth, ariaNow: rail.getAttribute('aria-valuenow'), nativeScrollbar: getComputedStyle(scroll).scrollbarWidth }
  })
}
async function dragPlaylistRail(page, fractions = [1, .5, 0]) {
  const samples = []
  for (const fraction of fractions) {
    const before = await playlistRailGeometry(page)
    assert.equal(before.rail.y - before.menu.y, before.radius, 'rail starts one dialog radius below its top')
    assert.equal(before.menu.bottom - before.rail.bottom, before.radius, 'rail ends one dialog radius above its bottom')
    assert.equal(before.rail.width, 10, 'real pointer hit width')
    assert.equal(before.thumb.width, 2.5, 'visible thumb width')
    assert.equal(before.thumb.height, 18, 'actual visible and draggable thumb height')
    await page.mouse.move(before.thumb.x + before.thumb.width / 2, before.thumb.y + before.thumb.height / 2)
    await page.mouse.down()
    await page.mouse.move(before.thumb.x + before.thumb.width / 2, before.rail.y + before.thumb.height / 2 + (before.rail.height - before.thumb.height) * fraction, { steps: 12 })
    await page.mouse.up()
    await page.waitForFunction(fraction => {
      const el = document.querySelector('.playlist-hero-more-scroll')
      return Math.abs(el.scrollTop / (el.scrollHeight - el.clientHeight) - fraction) < .005
    }, fraction)
    const after = await playlistRailGeometry(page)
    assert.deepEqual(after.header, before.header, 'dragging keeps the information header fixed')
    assert.equal(after.horizontalOverflow, false)
    assert(Math.abs((after.thumb.y - after.rail.y) / (after.rail.height - after.thumb.height) - fraction) < .005, 'real thumb geometry tracks content position')
    assert.equal(Number(after.ariaNow), Math.round(fraction * 100))
    samples.push(after)
  }
  return samples
}
async function settleDialog(page) {
  await menu(page).evaluate(async el => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await Promise.all(el.getAnimations({ subtree: true }).filter(animation => animation.effect.getComputedTiming().endTime !== Infinity).map(animation => animation.finished.catch(() => {})))
  })
}
try {
  const page = await open()
  await trigger(page).click()
  await menu(page).waitFor()
  assert.match(await menu(page).innerText(), /测试播放列表/)
  assert.match(await menu(page).innerText(), /80\s*\|\s*4:00:00/)
  assert.deepEqual(await menu(page).locator('.playlist-hero-more-action span').allTextContents(), labels)
  const before = await geometry(page)
  assert.equal(before.box.width, 564)
  assert.equal(before.box.height, 592)
  assert.equal(before.radius, '30px')
  assert.equal(before.background, 'rgb(247, 249, 255)')
  assert.equal(before.titleSize, '32px')
  assert.equal(before.metadataSize, '24px')
  assert(before.rows.every(row => row.height === 48))
  assert.equal(before.rows[1].y - before.rows[0].y, 90)
  assert(before.images.every(img => img.loaded), 'all visible image resources decode')
  assert.equal(before.images.length, 9, 'dynamic cover and all eight static icons')
  assert.equal(before.images[0].box.width, 160, 'dynamic cover width')
  assert.equal(before.images[0].box.height, 160, 'dynamic cover height')
  assert.equal(before.images[1].box.width, 24, 'music icon width')
  assert.equal(before.images[1].box.height, 24, 'music icon height')
  assert(before.images.slice(2).every(img => img.box.width === 48 && img.box.height === 48), 'all seven static action icons retain 48 square geometry')
  assert(before.scroll.full > before.scroll.height, 'lower actions scroll')
  const playlistMarker = await playlistRailGeometry(page)
  assert.equal(playlistMarker.nativeScrollbar, 'none', 'one actual scrollbar without a second native thumb')
  await menu(page).screenshot({ path: directory + '/desktop.png' })
  const playlistPositions = await dragPlaylistRail(page, [1, .5, 0, 1])
  await menu(page).screenshot({ path: directory + '/scrollbar-bottom.png' })
  assert.deepEqual((await geometry(page)).header, before.header, 'header remains fixed while action region scrolls')
  evidence.push({ scenario: 'playlist-full-dialog-real-pointer-drag', initial: playlistMarker, samples: playlistPositions })
  // Pointer capture retains the drag beyond the rail, and clamps at both ends.
  let rail = await playlistRailGeometry(page)
  await page.mouse.move(rail.thumb.x + 1, rail.thumb.y + 9)
  await page.mouse.down()
  await page.mouse.move(rail.thumb.x - 60, rail.rail.y - 50, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('.playlist-hero-more-scroll').scrollTop === 0)
  const scrollbar = menu(page).getByRole('scrollbar', { name: '播放列表操作滚动条' })
  await scrollbar.focus()
  await page.keyboard.press('End')
  await page.waitForFunction(() => document.querySelector('[role="scrollbar"]').getAttribute('aria-valuenow') === '100')
  await page.keyboard.press('Home')
  await page.waitForFunction(() => document.querySelector('[role="scrollbar"]').getAttribute('aria-valuenow') === '0')
  await page.setViewportSize({ width: 900, height: 420 })
  await settleDialog(page)
  const resized = await dragPlaylistRail(page, [1, .5, 0])
  await menu(page).screenshot({ path: directory + '/scrollbar-resized.png' })
  evidence.push({ scenario: 'pointer-capture-keyboard-and-resize', samples: resized })
  await page.setViewportSize({ width: 1280, height: 900 })
  await settleDialog(page)
  await menu(page).getByRole('button', { name: '列表选项', exact: true }).click()
  const notice = page.getByRole('dialog', { name: '列表选项', exact: true })
  await notice.waitFor()
  assert.match(await notice.innerText(), /尚未接入/)
  assert.equal(await page.getByRole('dialog').count(), 1, 'only one dialog focus trap')
  await notice.getByRole('button', { name: '返回更多操作', exact: true }).click()
  await menu(page).waitFor()
  await page.keyboard.press('Escape')
  await menu(page).waitFor({ state: 'hidden' })
  assert.equal(await trigger(page).evaluate(el => el === document.activeElement), true, 'Escape restores opener focus')
  evidence.push({ scenario: 'desktop-design-and-scrolling', geometry: before })

  for (const label of labels) {
    await trigger(page).click()
    await menu(page).getByRole('button', { name: label, exact: true }).click()
    const explanation = page.getByRole('dialog', { name: label, exact: true })
    await explanation.waitFor()
    assert.match(await explanation.innerText(), /尚未接入/)
    await explanation.getByRole('button', { name: '知道了', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal(await trigger(page).evaluate(el => el === document.activeElement), true, label + ' restores focus')
  }
  assert.deepEqual(await page.evaluate(() => window.actions), [], 'menu never imports audio, rescans all folders, or changes category pins')
  await trigger(page).click()
  await menu(page).waitFor()
  await page.mouse.click(10, 10)
  await menu(page).waitFor({ state: 'hidden' })
  assert.equal(await trigger(page).evaluate(el => el === document.activeElement), true, 'outside dismissal restores focus')
  evidence.push({ scenario: 'seven-honest-actions-and-dismissal', passed: true })

  const small = await open('?long', 360, 640)
  await trigger(small).click()
  await menu(small).waitFor()
  const smallGeometry = await geometry(small)
  assert(smallGeometry.box.width <= 328 && smallGeometry.box.height <= 608)
  assert(smallGeometry.box.x >= 0 && smallGeometry.box.y >= 0)
  assert.equal(await menu(small).evaluate(el => el.scrollWidth <= el.clientWidth), true, 'long title does not overflow the dialog')
  await menu(small).getByRole('button', { name: '列表选项', exact: true }).focus()
  await small.keyboard.press('Enter')
  await small.getByRole('dialog', { name: '列表选项', exact: true }).waitFor()
  await small.keyboard.press('Escape')
  await trigger(small).click()
  await menu(small).screenshot({ path: directory + '/small-long-title.png' })
  evidence.push({ scenario: 'small-long-title-keyboard', geometry: smallGeometry })

  // Compare computed native pseudo-elements against the actual player menu in
  // its horizontal half-screen layout, rather than copying a second CSS rule.
  const playerSource = readFileSync(new URL('./moreActionsMenu.browser.test.mjs', import.meta.url), 'utf8')
  const playerLiteral = playerSource.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
  assert(playerLiteral)
  const playerFixture = runInNewContext(playerLiteral[1], { dependency })
  const playerPage = await browser.newPage({ viewport: { width: 1920, height: 800 }, reducedMotion: 'reduce' })
  playerPage.on('pageerror', error => errors.push(error.message))
  await playerPage.route('**/__player_scrollbar_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: playerFixture }))
  await playerPage.route('**/__player_scrollbar_test', route => route.fulfill({ contentType: 'text/html', body: html.replace('__playlist_hero_more_fixture.js', '__player_scrollbar_fixture.js') }))
  await playerPage.goto(origin + '/__player_scrollbar_test')
  await playerPage.locator('.more-button').click()
  await playerPage.locator('.more-actions-menu').waitFor()
  await playerPage.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.more-actions-menu')).getPropertyValue('--more-leading-height')) > 0)
  await playerPage.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.querySelector('.more-actions-menu').getAnimations({ subtree: true }).filter(animation => animation.effect.getComputedTiming().endTime !== Infinity).map(animation => animation.finished.catch(() => {})))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  assert.equal(await playerPage.locator('[data-player-layout]').getAttribute('data-player-layout'), 'horizontal')
  const playerScroll = playerPage.locator('.more-actions-scroll')
  const playerMarker = await markerStyles(playerScroll)
  assert.equal(playerMarker.width, '2.5px')
  assert.equal(playerMarker.marginRight, '5px')
  assert.equal(playerMarker.trackTop, '21px')
  assert.equal(playerMarker.trackBottom, '21px')
  assert.equal(playerMarker.thumbSize, '100% 10%')
  assert.equal(playerMarker.thumbRadius, '999px')
  assert.equal(playerMarker.thumbImage, playlistMarker.thumbColor, 'both menus retain the same gray marker appearance')
  const playerPositions = await markerPositions(playerScroll)
  await playerPage.locator('.more-actions-menu').screenshot({ path: directory + '/player-horizontal-scrollbar.png' })
  await playerPage.keyboard.press('Escape')
  await playerPage.locator('.more-actions-menu').waitFor({ state: 'hidden' })
  evidence.push({ scenario: 'player-horizontal-scrollbar-parity', style: playerMarker, samples: playerPositions })
  assert.deepEqual(errors, [], 'no browser runtime errors')
  writeFileSync(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
  console.log('PASS playlist hero more menu: full-dialog actual pointer dragging, endpoints, midpoint, resize, fixed header, original player scrollbar, assets, menu actions and focus; ' + directory)
} finally { await browser.close() }
