// Independent video-derived acceptance. Only native transport is replaced;
// CDP records real painted frames and geometry comes from the actual components.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const baseline = process.env.SPMUSIC_NAVIGATION_BASELINE === '1'
const diagnostic = process.env.SPMUSIC_NAVIGATION_DIAGNOSTIC === '1'
const coreOnly = process.env.SPMUSIC_NAVIGATION_CORE_ONLY === '1'
const jitterOnly = process.env.SPMUSIC_NAVIGATION_JITTER_ONLY === '1'
const output = join(tmpdir(), 'spmusic-element-navigation', diagnostic ? 'diagnostic' : jitterOnly ? baseline ? 'jitter-baseline' : 'jitter-verified' : baseline ? 'baseline' : coreOnly ? 'core' : 'verified')
mkdirSync(output, { recursive: true })
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
const shared = readFileSync(new URL('./playlistManagementMotion.browser.test.mjs', import.meta.url), 'utf8')
const fixtureLiteral = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(fixtureLiteral)
const fixture = runInNewContext(fixtureLiteral[1], { dependency })
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>delete window.listeners[name];};')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__navigation_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__navigation_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const report = [], failures = []
let traceNumber = 0
const check = (condition, message) => { if (!condition) failures.push(message) }

async function trace(page, mode, width, direction, categoryId = 'playlists') {
  const height = page.viewportSize().height
  const name = `${mode}-${width}-${categoryId}-${direction}${jitterOnly ? '-' + traceNumber++ : ''}`
  if (direction === 'category') await page.locator(`.media-library-category[data-category-id="${categoryId}"]`).scrollIntoViewIfNeeded()
  const before = await page.screenshot({ path: join(output, name + '-before.png') })
  const session = await page.context().newCDPSession(page)
  const painted = []
  session.on('Page.screencastFrame', frame => {
    painted.push(frame)
    void session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
  })
  await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: width, maxHeight: height })
  await page.evaluate(() => { window.navigationTraceReady = false })
  const samplesPromise = page.evaluate(async ({ categoryId }) => {
    const opacity = element => {
      let result = element ? 1 : 0
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        result *= Number(style.opacity)
        if (style.visibility === 'hidden' || style.display === 'none') result = 0
      }
      return result
    }
    const box = element => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity: opacity(element) }
    }
    const capture = () => ({ time: performance.now() - started,
      overviewIcon: box(document.querySelector(`.media-library-category[data-category-id="${categoryId}"] .media-library-category-disc`)),
      overviewTitle: box(document.querySelector(`.media-library-category[data-category-id="${categoryId}"] .media-library-category-label`)),
      headingIcon: box(document.querySelector('.playlist-management-category')),
      headingTitle: box(document.querySelector('.playlist-management-heading h2')),
      cover: box(document.querySelector('.playlist-management-cover')),
      toolbar: box(document.querySelector('.playlist-management-toolbar')),
      brand: box(document.querySelector('.media-library-brand')),
      docks: [...document.querySelectorAll('.playlist-playback-dock')].map(dock => ({ ...box(dock), sameNode: dock === window.navigationDockNode, valid: !dock.closest('[inert],[aria-hidden="true"]'), buttons: [...dock.querySelectorAll('button')].filter(button => !button.disabled).length })),
      roots: document.querySelectorAll('.media-library-overview,.playlist-management').length,
      track: window.viewModel.playback.track?.id,
      categoryMotion: ['songs', 'album-artist'].map(id => {
        const parent = document.querySelector(`.media-library-category[data-category-id="${id}"]`)
        if (!parent) return null
        const style = getComputedStyle(parent)
        const inlineMatrix = new DOMMatrixReadOnly(parent.style.transform || 'none')
        const computedMatrix = new DOMMatrixReadOnly(style.transform)
        return { id, parent: box(parent), icon: box(parent.querySelector('.media-library-category-disc')),
          transformError: Math.hypot(inlineMatrix.m41 - computedMatrix.m41, inlineMatrix.m42 - computedMatrix.m42),
          inlineOpacity: parent.style.opacity, computedOpacity: style.opacity,
          opacityAnimations: parent.getAnimations().filter(animation => animation.constructor.name !== 'CSSTransition' && animation.effect?.getKeyframes().some(frame => 'opacity' in frame)).map(animation => ({ type: animation.constructor.name, startTime: animation.startTime, progress: animation.effect.getComputedTiming().progress, keyframes: animation.effect.getKeyframes().map(frame => ({ opacity: frame.opacity, easing: frame.easing })) })) }
      }).filter(Boolean),
    })
    const started = performance.now(), samples = [capture()]
    let clickSnapshot = null
    const cssTransitionRuns = []
    const transitionRun = event => {
      if (event.target.matches('.media-library-category') && ['transform', 'opacity'].includes(event.propertyName)) cssTransitionRuns.push({ time: performance.now() - started, property: event.propertyName, category: event.target.dataset.categoryId })
    }
    document.addEventListener('transitionrun', transitionRun, true)
    document.addEventListener('click', () => { clickSnapshot = capture() }, { capture: true, once: true })
    window.navigationTraceReady = true
    while (performance.now() - started < 700) { await new Promise(requestAnimationFrame); samples.push(capture()) }
    document.removeEventListener('transitionrun', transitionRun, true)
    return { samples, clickSnapshot, cssTransitionRuns }
  }, { categoryId })
  await page.waitForFunction(() => window.navigationTraceReady)
  if (direction === 'category') await page.locator(`.media-library-category[data-category-id="${categoryId}"]`).click()
  else await page.locator('.playlist-management:not([inert]) button[aria-label="返回媒体库"]').click()
  const { samples, clickSnapshot, cssTransitionRuns } = await samplesPromise
  await session.send('Page.stopScreencast')
  await session.detach()
  const after = await page.screenshot({ path: join(output, name + '-after.png') })
  painted.forEach((frame, index) => writeFileSync(join(output, `${name}-${String(index).padStart(3, '0')}.png`), Buffer.from(frame.data, 'base64')))
  const raster = await page.evaluate(async ({ images, width, height }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const read = async bytes => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), character => character.charCodeAt(0))], { type: 'image/png' }))
      context.clearRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height); bitmap.close()
      return context.getImageData(0, 0, width, height).data
    }
    const backgroundColor = pixels => {
      const histogram = new Map()
      for (let y = 60; y < 650; y += 8) for (let x = 20; x < width - 20; x += 8) {
        const offset = (y * width + x) * 4
        const color = (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]
        histogram.set(color, (histogram.get(color) ?? 0) + 1)
      }
      const color = [...histogram].reduce((a, b) => a[1] > b[1] ? a : b)[0]
      return [color >> 16, (color >> 8) & 255, color & 255]
    }
    const first = await read(images[0]), initialBackground = backgroundColor(first), frames = []
    for (const image of images.slice(1)) {
      const pixels = await read(image)
      let dockDelta = 0, count = 0
      // Dock pixels are compared with the original painted dock, independently
      // of DOM opacity; a sibling covering it therefore remains detectable.
      for (let y = height - 190; y < height - 25; y += 2) for (let x = 16; x < width - 16; x += 2) for (let c = 0; c < 3; c++) {
        const index = (y * width + x) * 4 + c
        dockDelta += Math.abs(pixels[index] - first[index]); count++
      }
      // The dominant painted surface color excludes intentional moving icons;
      // a single stationary point could be crossed by an exiting category.
      const background = backgroundColor(pixels)
      const backgroundDelta = Math.max(...background.map((value, index) => Math.abs(value - initialBackground[index])))
      frames.push({ dockMeanPixelDelta: dockDelta / count, backgroundMaxPixelDelta: backgroundDelta, background })
    }
    return { paintedFrames: frames.length, maxDockMeanPixelDelta: Math.max(...frames.map(frame => frame.dockMeanPixelDelta)), maxBackgroundPixelDelta: Math.max(...frames.map(frame => frame.backgroundMaxPixelDelta)), frames }
  }, { images: [before.toString('base64'), ...painted.map(frame => frame.data), after.toString('base64')], width, height })
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const sourceIcon = (clickSnapshot ?? samples[0])[direction === 'category' ? 'overviewIcon' : 'headingIcon']
  const targetKey = direction === 'category' ? 'headingIcon' : 'overviewIcon'
  const targetTitleKey = direction === 'category' ? 'headingTitle' : 'overviewTitle'
  const sourceTitle = (clickSnapshot ?? samples[0])[direction === 'category' ? 'overviewTitle' : 'headingTitle']
  const destination = samples.at(-1)[targetKey]
  const incoming = samples.slice(1).filter(sample => sample[targetKey])
  check(samples.every(sample => sample.docks.filter(dock => dock.valid).length === 1), name + ': exactly one effective dock must persist in every frame')
  check(samples.every(sample => sample.docks.some(dock => dock.valid && dock.sameNode)), name + ': all routes retain the same dock instance')
  check(samples.every(sample => sample.docks.some(dock => dock.valid && dock.opacity >= .99 && dock.buttons > 0)), name + ': persistent dock must stay visible and operable')
  check(samples.every(sample => sample.track === 'a-0'), name + ': navigation preserves current track')
  check(raster.maxDockMeanPixelDelta <= 3, name + ': painted dock must not flash or become covered; mean pixel delta ' + raster.maxDockMeanPixelDelta)
  check(raster.maxBackgroundPixelDelta <= 4, name + ': stable background must not switch color at completion; pixel delta ' + raster.maxBackgroundPixelDelta)
  const categoryFrames = samples.flatMap(sample => sample.categoryMotion)
  const maxTransformError = Math.max(0, ...categoryFrames.map(frame => frame.transformError))
  check(cssTransitionRuns.length === 0, name + ': Motion geometry must not restart native CSS transitions; runs ' + cssTransitionRuns.length)
  check(maxTransformError <= 1, name + ': painted transforms follow Motion without a second interpolation; error ' + maxTransformError)
  for (const id of ['songs', 'album-artist']) {
    const path = samples.flatMap(sample => sample.categoryMotion.filter(item => item.id === id).map(item => ({ time: sample.time, ...item })))
    if (path.length < 3) continue
    const first = path[0].parent, last = path.at(-1).parent
    for (const axis of ['x', 'y']) {
      if (Math.abs(last[axis] - first[axis]) <= 5) continue
      const sign = Math.sign(last[axis] - first[axis])
      check(path.slice(1).every((item, index) => sign * (item.parent[axis] - path[index].parent[axis]) >= -1), name + ': nonselected ' + id + ' moves monotonically on ' + axis)
    }
    // Motion may accelerate opacity with WAAPI, so inline opacity can already
    // hold its destination while the painted opacity follows that timeline.
    const opacitySign = Math.sign(last.opacity - first.opacity)
    check(path.slice(1).every((item, index) => opacitySign * (item.parent.opacity - path[index].parent.opacity) >= -.02), name + ': nonselected ' + id + ' opacity does not reverse or restart')
    check(Math.abs(last.opacity - (direction === 'category' ? 0 : 1)) <= .02, name + ': nonselected ' + id + ' opacity reaches its endpoint')
  }
  if (mode === 'normal' && sourceIcon && destination) {
    check(incoming.length > 3, name + ': record enough actual icon motion frames')
    check(distance(incoming[0][targetKey], sourceIcon) < Math.max(30, distance(sourceIcon, destination) * .25), name + ': incoming category icon starts at the clicked source geometry')
    check(sourceTitle && incoming[0][targetTitleKey] && distance(incoming[0][targetTitleKey], sourceTitle) < Math.max(40, distance(sourceTitle, samples.at(-1)[targetTitleKey]) * .25), name + ': incoming category label starts at the source label geometry')
    check(incoming.some(sample => distance(sample[targetKey], sourceIcon) > 10 && distance(sample[targetKey], destination) > 10), name + ': selected icon has a continuous intermediate path')
    for (const key of [targetKey, targetTitleKey]) for (const axis of ['x', 'y', 'width', 'height']) {
      const path = incoming.filter(sample => sample[key]).map(sample => sample[key][axis])
      if (path.length < 3 || Math.abs(path.at(-1) - path[0]) <= 5) continue
      const sign = Math.sign(path.at(-1) - path[0])
      check(path.slice(1).every((value, index) => sign * (value - path[index]) >= -1), name + ': selected ' + key + ' does not reverse or restart on ' + axis)
    }
    const inViewport = rect => rect && rect.opacity > .08 && rect.x + rect.width > 0 && rect.x < width && rect.y + rect.height > 40 && rect.y < height - 224
    for (const [overviewKey, headingKey] of [['overviewIcon', 'headingIcon'], ['overviewTitle', 'headingTitle']]) {
      check(samples.every(sample => !inViewport(sample[overviewKey]) || !inViewport(sample[headingKey]) || distance(sample[overviewKey], sample[headingKey]) <= 4), name + ': selected ' + headingKey + ' never splits into two separately visible subjects')
    }
    if (direction === 'category') {
      const toolbarFrames = incoming.filter(sample => sample.toolbar && sample.headingIcon.opacity >= .99)
      check(toolbarFrames.some(sample => sample.toolbar.opacity > .05 && sample.toolbar.opacity < .9), name + ': toolbar fades independently while the selected heading remains visible')
      const coverFrames = incoming.filter(sample => sample.cover && sample.cover.opacity > .05)
      if (coverFrames.length > 3) {
        const offsets = coverFrames.map(sample => sample.cover.x - sample.headingIcon.x)
        check(Math.max(...offsets) - Math.min(...offsets) > 20, name + ': cover moves independently rather than sharing the heading translation')
        check(Math.min(...coverFrames.map(sample => sample.cover.width)) < coverFrames.at(-1).cover.width * .95, name + ': cover independently grows into its final artwork geometry')
      }
    }
  }
  if (mode !== 'normal') check(samples.slice(3).every(sample => sample.roots === 1), name + ': disabled motion releases the old route within two rendered frames')
  if (direction === 'overview') {
    const retirement = samples.findIndex((sample, index) => index > 0 && sample.roots === 1 && samples[index - 1].roots > 1)
    if (retirement > 0) check(distance(samples[retirement].overviewIcon, samples[retirement - 1].overviewIcon) <= 5, name + ': grid does not jump when the outgoing page is removed')
    const brand = samples.filter(sample => sample.brand && sample.brand.opacity > .01)
    check(brand.every((sample, index) => index === 0 || sample.brand.opacity >= brand[index - 1].brand.opacity - .01), name + ': brand fades in continuously without disappearing and restarting')
  }
  const evidence = { name, samples, clickSnapshot, cssTransitionRuns, maxTransformError, raster, screenshotPrefix: join(output, name) }
  writeFileSync(join(output, name + '.json'), JSON.stringify(evidence, null, 2))
  report.push({ name, frames: samples.length, paintedFrames: painted.length, raster, firstIncoming: incoming[0], sourceIcon, sourceTitle, destination })
}

try {
  for (const mode of baseline || diagnostic || coreOnly || jitterOnly ? ['normal'] : ['normal', 'reduce', 'off']) for (const width of jitterOnly ? [2560] : mode === 'normal' && !baseline && !diagnostic && !coreOnly ? [2560, 1280, 480] : [diagnostic ? Number(process.env.SPMUSIC_NAVIGATION_DIAGNOSTIC_WIDTH || 1280) : 1280]) {
    const page = await browser.newPage({ viewport: { width, height: jitterOnly ? 1440 : 900 }, reducedMotion: mode === 'reduce' ? 'reduce' : 'no-preference', colorScheme: 'light' })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'))
    await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
    await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
    await page.route('**/__navigation_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
    const pageFixture = mode === 'off' ? fixture.replace('root.render(', `const {defaultAppearance}=await import('/src/features/appearance/model/defaultAppearance.ts');const {saveAppearanceStorage}=await import('/src/features/appearance/model/appearanceStorage.ts');const theme={...defaultAppearance,id:'navigation-off-test',name:'Navigation off',motion:{...defaultAppearance.motion,level:'off'}};saveAppearanceStorage({currentThemeId:theme.id,colorSchemePreference:'light',userThemes:[theme]});root.render(`) : fixture
    await page.route('**/__navigation_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: pageFixture }))
    await page.route('**/__navigation_test', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto(origin + '/__navigation_test')
    await page.waitForFunction(() => window.viewModel)
    await page.evaluate(() => window.viewModel.playback.onOpenAudio())
    await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isSelectionPending)
    await page.waitForFunction(() => [...document.querySelectorAll('.playlist-playback-cover-image')].every(image => image.complete && image.naturalWidth > 0))
    if (diagnostic) {
      const geometry = async label => ({ label, ...await page.evaluate(() => {
        const read = selector => {
          const node = document.querySelector(selector)
          if (!node) return null
          const rect = node.getBoundingClientRect(), style = getComputedStyle(node)
          return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, scrollTop: node.scrollTop, scrollLeft: node.scrollLeft, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, top: style.top, bottom: style.bottom, position: style.position, background: style.backgroundColor }
        }
        return { shell: read('.player-shell'), background: read('.library-navigation-background'), overview: read('.media-library-overview'), documentScrollTop: document.scrollingElement.scrollTop, windowScrollY: scrollY }
      }) })
      const evidence = [await geometry('startup')]
      await page.locator('.media-library-category[data-category-id="playlists"]').scrollIntoViewIfNeeded()
      evidence.push(await geometry('after-scrollIntoView'))
      await page.locator('.media-library-category[data-category-id="playlists"]').click()
      await page.waitForFunction(() => document.querySelector('.playlist-management') && !document.querySelector('.media-library-overview'))
      evidence.push(await geometry('category-settled'))
      await page.getByRole('button', { name: '返回媒体库', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.media-library-overview') && !document.querySelector('.playlist-management'))
      evidence.push(await geometry('overview-return-settled'))
      writeFileSync(join(output, 'layout.json'), JSON.stringify(evidence, null, 2))
      console.log(JSON.stringify({ diagnostic: true, evidence }, null, 2))
      await page.close()
      continue
    }
    await page.evaluate(() => { window.navigationDockNode = document.querySelector('.playlist-playback-dock') })
    check(await page.locator('.playlist-playback-dock:not([aria-hidden="true"])').count() === 1, mode + ': overview initially retains the playback dock')
    for (const categoryId of mode === 'normal' && width === 1280 && !baseline && !coreOnly ? ['playlists', 'folder'] : ['playlists']) {
      for (const direction of jitterOnly ? ['category', 'overview', 'category', 'overview'] : ['category', 'overview']) await trace(page, mode, width, direction, categoryId)
    }
    if (coreOnly) {
      await page.evaluate(() => { window.config.count = 80; window.viewModel.playback.onOpenAudio() })
      await page.waitForFunction(() => window.viewModel.playlist.tracks.length === 80 && !window.viewModel.playback.isSelectionPending)
      await page.locator('.media-library-category[data-category-id="playlists"]').click()
      await page.waitForFunction(() => document.querySelector('.playlist-management') && !document.querySelector('.media-library-overview'))
      const search = page.locator('.playlist-playback-dock button[aria-label="搜索"]')
      await search.click()
      await page.locator('.playlist-management-search input').waitFor({ state: 'visible' })
      await search.click()
      await page.locator('.playlist-management-search input').waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: '打开播放列表 Playlist a', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.playlist-panel') && !document.querySelector('.playlist-management'))
      await search.click()
      await page.locator('.playlist-filter-input').waitFor({ state: 'visible' })
      await search.click()
      await page.locator('.playlist-filter-input').waitFor({ state: 'hidden' })
      const panel = await page.locator('.playlist-panel').boundingBox()
      await page.mouse.move(panel.x + panel.width - 30, panel.y + 180)
      await page.mouse.wheel(0, 1500)
      await page.waitForFunction(() => document.querySelector('.playlist-panel').scrollTop > 400)
      await page.mouse.wheel(0, 120)
      await page.waitForFunction(() => document.querySelector('.playlist-playback-dock').getBoundingClientRect().top >= innerHeight - .5)
      await page.evaluate(() => window.viewModel.playlist.library.onOpenOverview())
      await page.waitForFunction(() => {
        const dock = document.querySelector('.playlist-playback-dock')
        return document.querySelector('.media-library-overview') && !document.querySelector('.playlist-panel') && dock === window.navigationDockNode && !dock.inert && dock.getBoundingClientRect().top < innerHeight - 100
      })
      check(await search.isDisabled(), 'overview clears the retired tracks search binding')
      check(await page.locator('.playlist-filter-input,.playlist-management-search input').count() === 0, 'returning overview leaves no old search input')
      console.log('PASS category/tracks search ownership, hidden tracks to overview restores same neutral dock')
    }
    if (!baseline) {
      const beforeCommands = await page.evaluate(() => window.calls.filter(call => ['audio_transition_playback', 'audio_play', 'audio_pause'].includes(call.command)).length)
      await page.locator('.playlist-playback-dock:not([aria-hidden="true"]) button[aria-label="播放"],.playlist-playback-dock:not([aria-hidden="true"]) button[aria-label="暂停"]').click()
      await page.waitForFunction(before => window.calls.filter(call => ['audio_transition_playback', 'audio_play', 'audio_pause'].includes(call.command)).length > before, beforeCommands)
      await page.evaluate(async () => {
        for (let i = 0; i < 12; i++) {
          if (i % 2 === 0) window.viewModel.playlist.library.onSelectCategory('playlists')
          else window.viewModel.playlist.library.onOpenOverview()
          for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame)
        }
      })
      await page.waitForFunction(() => document.querySelectorAll('.media-library-overview').length === 1 && !document.querySelector('.playlist-management') && document.querySelectorAll('.playlist-playback-dock:not([aria-hidden="true"])').length === 1)
      check(await page.evaluate(() => document.querySelector('.playlist-playback-dock') === window.navigationDockNode), mode + '-' + width + ': rapid reversals preserve the dock instance')
    }
    check(errors.length === 0, mode + ': no runtime errors: ' + errors.join('; '))
    await page.close()
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify({ browser: browser.version(), report, failures }, null, 2))
  console.log(JSON.stringify({ browser: browser.version(), failures, output, traces: report.map(({ name, frames, paintedFrames, raster }) => ({ name, frames, paintedFrames, maxDockMeanPixelDelta: raster.maxDockMeanPixelDelta, maxBackgroundPixelDelta: raster.maxBackgroundPixelDelta })) }, null, 2))
  assert.deepEqual(failures, [], 'video-derived navigation acceptance')
} finally { await browser.close() }
