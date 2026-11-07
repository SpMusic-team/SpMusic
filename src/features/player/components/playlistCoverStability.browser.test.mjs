// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright installation.
// SPMUSIC_COVER_STABILITY_BASELINE=1 records the failing pre-fix opacity trace.
// Reuse the native-transport fixture from the motion acceptance test so this
// regression exercises the real shell/hook/SPXR parser without a second backend.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const baseline = process.env.SPMUSIC_COVER_STABILITY_BASELINE === '1'
const smoke = process.env.SPMUSIC_COVER_STABILITY_SMOKE === '1'
const overviewOnly = process.env.SPMUSIC_MEDIA_OVERVIEW_ONLY === '1'
const overviewBaseline = process.env.SPMUSIC_MEDIA_OVERVIEW_BASELINE === '1'
const screenshots = join(tmpdir(), 'spmusic-media-overview-stability')
mkdirSync(screenshots, { recursive: true })
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
const sharedTest = readFileSync(new URL('./playlistManagementMotion.browser.test.mjs', import.meta.url), 'utf8')
const fixtureLiteral = sharedTest.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(fixtureLiteral, 'existing motion test exposes its deterministic native fixture')
const fixture = runInNewContext(fixtureLiteral[1], { dependency })
  .replace('coverArt:{mimeType:', 'coverArt:window.config.noCover?null:{mimeType:')
const ordinaryReturnSource = sharedTest.slice(sharedTest.indexOf('async function ordinaryPlayerReturn(page) {'), sharedTest.indexOf('async function timingTrace(page,direction) {'))
const ordinaryPlayerReturn = runInNewContext('(' + ordinaryReturnSource + ')', { assert, settled: async (page, target) => {
  await page.waitForFunction(target => document.querySelector(target) && !document.querySelector('.playlist-management'), target)
} })
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>delete window.listeners[name];};')
assert(service.includes('window.backendInvoke'), 'replace native transport only')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__stability_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__stability_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const report = []
let activePage
async function verifyOverview(page, reducedMotion) {
  const evidence = []
  for (const direction of ['category', 'overview']) {
    const samplesPromise = page.evaluate(async direction => {
      const samples = []; const started = performance.now()
      window.overviewTrace = samples
      const opacity = element => {
        let value = element ? 1 : 0
        for (let node = element; node; node = node.parentElement) {
          const style = getComputedStyle(node); value *= Number(style.opacity)
          if (style.display === 'none' || style.visibility === 'hidden') value = 0
        }
        return value
      }
      const capture = () => {
        const roots = [...document.querySelectorAll('.media-library-overview,.playlist-management')].map(root => {
          const content = root.matches('.media-library-overview') ? root.querySelector('.media-library-grid') : root.querySelector('.playlist-management-heading')
          const background = getComputedStyle(root).backgroundColor
          const backgroundAlpha = background.startsWith('rgba') ? Number(background.match(/[\d.]+/g)?.[3] ?? 1) : background === 'transparent' ? 0 : 1
          const plane = root.querySelector('.playlist-management-plane') ?? root
          const matrix = new DOMMatrixReadOnly(getComputedStyle(plane).transform)
          return { className: root.className, rootOpacity: opacity(root), contentOpacity: opacity(content), planeOpacity: opacity(plane), x: matrix.m41, scale: matrix.a, inert: root.inert, background, backgroundAlpha, children: root.querySelectorAll('button').length }
        })
        // Both route roots occupy the same z-index. The later DOM sibling's
        // opaque route background masks content of earlier siblings.
        let coverage = 0; let transmission = 1
        for (const root of roots.toReversed()) { coverage += root.contentOpacity * transmission; transmission *= 1 - root.rootOpacity * root.backgroundAlpha }
        const backdrop = document.querySelector('.library-navigation-background')
        if (backdrop) transmission *= 1 - opacity(backdrop)
        const docks = [...document.querySelectorAll('.playlist-playback-dock')].map(dock => {
          const rect = dock.getBoundingClientRect()
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity: opacity(dock) }
        })
        samples.push({ time: performance.now() - started, roots, coverage, backdropCoverage: 1 - transmission, docks: docks.length, dockGeometry: docks, track: window.viewModel.playback.track?.id })
      }
      capture()
      if (direction === 'category') document.querySelector('.media-library-category[data-category-id="playlists"]').click()
      else document.querySelector('.playlist-management:not([inert]) button[aria-label="返回媒体库"]').click()
      while (performance.now() - started < 800) { await new Promise(requestAnimationFrame); capture() }
      return samples
    }, direction)
    const screenshotPath = join(screenshots, reducedMotion + '-' + direction + '.png')
    await page.waitForFunction(() => window.overviewTrace?.some(frame => frame.time >= 100))
    const png = await page.screenshot({ path: screenshotPath })
    const ink = await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close()
      const pixels = context.getImageData(0, 40, canvas.width, canvas.height - 40).data
      let colored = 0; let dark = 0
      for (let i = 0; i < pixels.length; i += 4) { if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 45) colored++; if (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722 < 170) dark++ }
      return { colored, dark }
    }, Array.from(png))
    const samples = await samplesPromise
    const worst = samples.reduce((a, b) => a.coverage < b.coverage ? a : b)
    const result = { direction, frames: samples.length, minContentCoverage: worst.coverage, minBackdropCoverage: Math.min(...samples.map(frame => frame.backdropCoverage)), zeroContentFrames: samples.filter(frame => frame.coverage < .05).length, overlappingRootsFrames: samples.filter(frame => frame.roots.length > 1).length, worst, end: samples.at(-1), screenshotPath, screenshotInk: ink }
    evidence.push(result)
    console.log('OVERVIEW_TRANSITION', JSON.stringify({ reducedMotion, ...result }))
    assert.equal(samples.at(-1).roots.length, 1, 'overview/category switch releases the old route')
    assert.equal(await page.locator('[data-library-navigation]').count(), 0, 'settled navigation clears all temporary transparent plane markers')
    assert(samples.every(frame => frame.track === 'a-0'), 'overview/category navigation retains current playback')
    assert.equal(samples.at(-1).docks, 1, 'overview and category both retain the playback dock')
    if (!overviewBaseline) {
      assert(worst.coverage >= .7, 'route content never flashes to an empty opaque surface: ' + JSON.stringify(worst))
      assert(result.minBackdropCoverage >= .999, 'route backdrop never reveals the player during library navigation')
      const moving = samples.filter(frame => frame.roots.length === 2 && frame.time > 0)
      if (reducedMotion === 'no-preference') {
        assert(moving.length >= 3, 'outgoing page remains present through the timed animation')
        // User video requires independent element paths. Their source geometry
        // and painted-frame continuity are checked in mediaLibraryNavigation;
        // a whole-page matrix is not evidence of target motion fidelity.
        assert(moving.some(frame => frame.time >= 100), 'exit does not snap away before the intermediate frame')
        const lastMoving = samples.findLastIndex(frame => frame.roots.length > 1 || frame.roots.some(root => Math.abs(root.x) > .5 || Math.abs(root.scale - 1) > .005 || root.planeOpacity < .995))
        assert(samples[lastMoving + 1]?.time <= 500, 'default animation settles within 500ms')
        const dockFrames = moving.flatMap(frame => frame.dockGeometry)
        assert(dockFrames.length >= 3, 'dock stays mounted throughout the page transition')
        const firstDock = dockFrames[0]
        assert(dockFrames.every(dock => ['x', 'y', 'width', 'height'].every(key => Math.abs(dock[key] - firstDock[key]) <= 1) && dock.opacity >= .99), 'dock geometry and opacity stay fixed while content moves')
      } else {
        const unsettled = samples.slice(3).filter(frame => frame.roots.length !== 1 || frame.roots.some(root => Math.abs(root.x) >= .1 || Math.abs(root.scale - 1) >= .001 || root.planeOpacity !== 1))
        assert.deepEqual(unsettled, [], 'disabled motion settles within two rendered animation frames')
      }
    }
  }
  if (!overviewBaseline) {
    await page.evaluate(async () => {
      for (let i = 0; i < 12; i++) {
        if (i % 2 === 0) window.viewModel.playlist.library.onSelectCategory('playlists')
        else window.viewModel.playlist.library.onOpenOverview()
        for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame)
      }
    })
    await page.waitForFunction(() => document.querySelectorAll('.media-library-overview').length === 1 && !document.querySelector('.playlist-management') && document.querySelectorAll('.playlist-playback-dock:not([aria-hidden="true"])').length === 1)
    assert.equal(await page.locator('.media-library-category').count(), 19, 'rapid overview/category reversal restores all overview icons')
    assert.equal(await page.locator('[data-library-navigation]').count(), 0, 'rapid reversal clears temporary navigation markers')
    assert.equal(await page.evaluate(() => window.viewModel.playback.track?.id), 'a-0', 'rapid overview/category reversal retains playback')
    // Interrupt another route replacement with a real overview menu action.
    await page.evaluate(async () => {
      window.viewModel.playlist.library.onSelectCategory('playlists')
      await new Promise(requestAnimationFrame)
      window.viewModel.playlist.library.onOpenOverview()
      await new Promise(requestAnimationFrame)
      document.querySelector('.media-library-more').click()
    })
    await page.getByRole('menuitem', { name: '打开播放界面', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.player-stage') && !document.querySelector('.playlist-management') && !document.querySelector('.media-library-overview') && !document.querySelector('.playlist-playback-dock') && !document.querySelector('.player-shell').hasAttribute('data-controller-background-present'))
    await page.locator('.window-bar button[aria-label="播放列表"]').click({ force: true })
    await page.waitForFunction(() => document.querySelector('.playlist-panel') && !document.querySelector('.playlist-management') && !document.querySelector('.media-library-overview'))
    assert.equal(await page.locator('.playlist-playback-dock:not([aria-hidden="true"])').count(), 1, 'immediate player return/reopen restores one detail dock without retired management nodes')
    await page.evaluate(() => window.viewModel.playlist.library.onOpenOverview())
    await page.waitForFunction(() => document.querySelector('.media-library-overview') && !document.querySelector('.playlist-panel') && document.querySelectorAll('.playlist-playback-dock:not([aria-hidden="true"])').length === 1)
    console.log('PASS overview/category rapid reversal and cleanup', reducedMotion)
  }
  report.push({ overview: reducedMotion, evidence })
}
try {
  for (const reducedMotion of ['no-preference', 'reduce', ...(overviewOnly ? ['off'] : [])]) {
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: reducedMotion === 'off' ? 'no-preference' : reducedMotion })
    page.setDefaultTimeout(10000)
    activePage = page
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE_ERROR', error.message) })
    await page.addInitScript(() => {
      localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
      const observer = new MutationObserver(() => {
        const overview = document.querySelector('.media-library-overview')
        if (!overview) return
        const style = getComputedStyle(overview), matrix = new DOMMatrixReadOnly(style.transform)
        window.initialOverviewMotion = { opacity: Number(style.opacity), x: matrix.m41, scale: matrix.a }
        observer.disconnect()
      })
      observer.observe(document, { childList: true, subtree: true })
    })
    await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
    await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
    await page.route('**/__stability_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
    const pageFixture = reducedMotion === 'off' ? fixture.replace('root.render(', `const {defaultAppearance}=await import('/src/features/appearance/model/defaultAppearance.ts');const {saveAppearanceStorage}=await import('/src/features/appearance/model/appearanceStorage.ts');const theme={...defaultAppearance,id:'motion-off-test',name:'Motion off test',motion:{...defaultAppearance.motion,level:'off'}};saveAppearanceStorage({currentThemeId:theme.id,colorSchemePreference:'light',userThemes:[theme]});root.render(`) : fixture
    await page.route('**/__stability_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: pageFixture }))
    await page.route('**/__stability_test', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto(origin + '/__stability_test')
    await page.waitForFunction(() => Boolean(window.viewModel))
    if (!overviewBaseline) assert.deepEqual(await page.evaluate(() => window.initialOverviewMotion), { opacity: 1, x: 0, scale: 1 }, 'initial media library appears fully visible without an entry animation')
    await page.evaluate(() => window.viewModel.playback.onOpenAudio())
    await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isSelectionPending)
    if (overviewOnly || !baseline) {
      await verifyOverview(page, reducedMotion)
      if (overviewOnly) { assert.deepEqual(errors, []); await page.close(); continue }
    }
    await page.locator('.media-library-category[data-category-id="playlists"]').click()
    await page.getByRole('button', { name: '打开播放列表 Playlist a', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.playlist-library-cover-image')?.complete && document.querySelector('.playlist-playback-cover-image')?.complete && !document.querySelector('.playlist-management'))
    if (smoke) console.log('PASS initial management/detail exit cleanup')
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 800)))
    await page.evaluate(() => {
      window.coverFrames = []; window.coverNodeIds = new WeakMap(); window.coverNextId = 0; window.coverSampling = true
      const sample = () => {
        const frame = { time: performance.now(), dockCount: document.querySelectorAll('.playlist-playback-dock').length }
        for (const [name, selector] of [['sidebar', '.playlist-library-sidebar:not([data-overlay]) .playlist-library-cover-image'], ['dock', '.playlist-playback-track[data-swipe-plane="current"] .playlist-playback-cover-image']]) {
          frame[name] = [...document.querySelectorAll(selector)].map(image => {
            if (!window.coverNodeIds.has(image)) window.coverNodeIds.set(image, ++window.coverNextId)
            let opacity = 1; const fades = []; const hidden = []
            for (let element = image; element; element = element.parentElement) {
              const style = getComputedStyle(element)
              opacity *= Number(style.opacity)
              if (Number(style.opacity) < .99) fades.push({ className: element.className?.baseVal ?? element.className, opacity: Number(style.opacity) })
              if (style.display === 'none' || style.visibility === 'hidden') { opacity = 0; hidden.push(element.className?.baseVal ?? element.className) }
            }
            return { id: window.coverNodeIds.get(image), src: image.src, loaded: image.dataset.loaded, decoded: image.complete && image.naturalWidth > 0, opacity, fades, hidden }
          })
        }
        window.coverFrames.push(frame)
        if (window.coverSampling) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      window.beforeCoverRequests = window.calls.filter(call => call.command.includes('cover_pixels')).length
    })
    // Actual route callbacks are dispatched in alternating RAFs to cover a
    // user reversing a transition before AnimatePresence has removed its exit.
    for (let i = 0; i < (smoke ? 0 : 4); i++) {
      await page.evaluate(() => window.viewModel.playlist.library.onOpen())
      await page.waitForFunction(() => document.querySelector('.playlist-management') && !document.querySelector('.playlist-panel'))
      // The exit can finish before the incoming fade; include its entire tail.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 700)))
      await page.evaluate(() => window.viewModel.playlist.library.onSelect(window.viewModel.playlist.library.items[0].scope))
      await page.waitForFunction(() => document.querySelector('.playlist-panel') && !document.querySelector('.playlist-management'))
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 700)))
    }
    await page.evaluate(async smoke => {
      for (let i = 0; i < (smoke ? 0 : 16); i++) {
        if (i % 2 === 0) window.viewModel.playlist.library.onOpen()
        else window.viewModel.playlist.library.onSelect(window.viewModel.playlist.library.items[0].scope)
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
    }, smoke)
    await page.waitForFunction(() => document.querySelector('.playlist-panel') && !document.querySelector('.playlist-management'))
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 700)))
    const evidence = await page.evaluate(() => {
      window.coverSampling = false
      const result = { frames: window.coverFrames.length, coverRequestsBefore: window.beforeCoverRequests, coverRequestsAfter: window.calls.filter(call => call.command.includes('cover_pixels')).length }
      for (const name of ['sidebar', 'dock']) {
        const frames = window.coverFrames.map(frame => ({ ...frame, score: 1 - frame[name].reduce((remaining, image) => remaining * (1 - image.opacity), 1) }))
        const worst = frames.reduce((a, b) => a.score < b.score ? a : b)
        result[name] = { minOpacityCoverage: worst.score, minSingleDockCoverage: Math.min(...frames.filter(frame => frame.dockCount === 1).map(frame => frame.score)), missingFrames: frames.filter(frame => !frame[name].length).length, undecodedFrames: frames.filter(frame => frame[name].some(image => !image.decoded)).length, nodeCount: new Set(frames.flatMap(frame => frame[name].map(image => image.id))).size, sources: new Set(frames.flatMap(frame => frame[name].map(image => image.src))).size, worst: worst[name] }
      }
      return result
    })
    report.push({ reducedMotion, ...evidence })
    assert.deepEqual(errors, [], 'no runtime errors')
    assert.equal(evidence.coverRequestsAfter, evidence.coverRequestsBefore, 'route switch does not reload native artwork')
    assert.equal(evidence.sidebar.sources, 1, 'sidebar resource remains stable')
    assert.equal(evidence.dock.sources, 1, 'dock resource remains stable')
    if (!baseline) for (const name of ['sidebar', 'dock']) {
      assert.equal(evidence[name].missingFrames, 0, name + ' remains mounted in every sampled frame')
      assert.equal(evidence[name].undecodedFrames, 0, name + ' retains decoded image')
      assert(evidence[name].minOpacityCoverage >= .98, name + ' remains fully visible: ' + JSON.stringify(evidence[name]))
    }
    if (!baseline) {
      if (reducedMotion === 'no-preference') {
        report.push(await ordinaryPlayerReturn(page))
        console.log('PASS ordinary player return shared geometry and cleanup')
      }
      await page.evaluate(() => window.viewModel.playlist.library.onOpen())
      await page.locator('.playlist-playback-dock:not([aria-hidden="true"]) .playlist-playback-nav button[aria-label="打开播放界面"]').click({ force: true })
      await page.locator('.player-stage').waitFor()
      await page.locator('.window-bar button[aria-label="播放列表"]').click({ force: true })
      await page.locator('.playlist-panel:not([inert])').waitFor()
      await page.locator('.playlist-playback-dock:not([aria-hidden="true"]) .playlist-playback-nav button[aria-label="打开播放界面"]').waitFor()
      const playerReturn = await page.evaluate(async () => {
        const frames = []; const started = performance.now()
        const sample = () => frames.push([...document.querySelectorAll('.playlist-playback-dock')].map(dock => {
          const rect = selector => { const element = dock.querySelector(selector); const bounds = element.getBoundingClientRect(); return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } }
          return { cover: rect('.playlist-playback-cover'), copy: rect('.playlist-playback-copy'), background: rect('.controller-shared-background'), superseded: dock.hasAttribute('data-dock-superseded') }
        }))
        sample()
        document.querySelector('.playlist-playback-dock:not([aria-hidden="true"]) .playlist-playback-nav button[aria-label="打开播放界面"]').click()
        while (performance.now() - started < 850) { await new Promise(requestAnimationFrame); sample() }
        return frames
      })
      await page.waitForFunction(() => document.querySelector('.player-stage') && !document.querySelector('.playlist-playback-dock') && !document.querySelector('.player-shell').hasAttribute('data-controller-background-present'))
      if (reducedMotion === 'no-preference') {
        const start = playerReturn[0].find(dock => !dock.superseded)
        assert(start, 'immediate reopen has a current dock owner')
        report.push({ reducedMotion, immediateReturnGeometry: Object.fromEntries(['cover', 'copy', 'background'].map(part => [part, { start: start[part], samples: playerReturn.flatMap(frame => frame.filter(dock => !dock.superseded).map(dock => dock[part])).filter((_, index) => index % 30 === 0) }])) })
        for (const part of ['cover', 'copy', 'background']) assert(playerReturn.some(frame => frame.some(dock => !dock.superseded && ['x', 'y', 'width', 'height'].some(key => Math.abs(dock[part][key] - start[part][key]) > 2))), part + ' shared geometry restores after immediate route/player/reopen/player')
        const target = await page.locator('.player-stage .cover-frame').evaluateAll(elements => elements.map(element => element.getBoundingClientRect()).reduce((a, b) => a.width > b.width ? a : b).toJSON())
        assert(target.width > start.cover.width + 100, 'player destination cover is larger than the dock cover')
        assert(playerReturn.some(frame => frame.some(dock => !dock.superseded && dock.cover.width > start.cover.width + 2)), 'outgoing cover expands toward the player instead of shrinking to the dock')
        console.log('PASS immediate player/reopen/player shared geometry direction and cleanup')
      }
      await page.locator('.window-bar button[aria-label="播放列表"]').click()
      await page.waitForFunction(() => document.querySelector('.playlist-panel') && !document.querySelector('.playlist-management'))
      report.push({ reducedMotion, interruptedReturnFrames: playerReturn.length, sharedGeometryRestored: reducedMotion === 'no-preference' })
      const originalDockSrc = await page.locator('.playlist-playback-track[data-swipe-plane="current"] .playlist-playback-cover-image').getAttribute('src')
      await page.evaluate(() => window.viewModel.playlist.onTrackSelect('a-1'))
      await page.waitForFunction(src => {
        const image = document.querySelector('.playlist-playback-track[data-swipe-plane="current"] .playlist-playback-cover-image')
        return window.viewModel.playback.track?.id === 'a-1' && !window.viewModel.playback.isSelectionPending && image?.src !== src && image?.complete && image.naturalWidth > 0
      }, originalDockSrc)
      await page.evaluate(() => window.viewModel.playlist.library.onOpen())
      await page.waitForFunction(() => document.querySelector('.playlist-management') && !document.querySelector('.playlist-panel'))
      assert.equal(await page.locator('.playlist-playback-track[data-swipe-plane="current"] .playlist-playback-cover-image').count(), 1, 'new song cover is retained by management')
      await page.evaluate(() => { Object.assign(window.config, { scope: 'empty-cover', noCover: true }); window.viewModel.playback.onOpenAudio() })
      await page.waitForFunction(() => window.viewModel.playback.track?.id === 'empty-cover-0' && !window.viewModel.playback.isSelectionPending)
      await page.waitForFunction(() => !document.querySelector('.playlist-playback-track[data-swipe-plane="current"] .playlist-playback-cover-image'))
      assert.equal(await page.locator('.playlist-playback-track[data-swipe-plane="current"][data-cover-state="empty"]').count(), 1, 'no-cover song shows the intended empty state')
      await page.setViewportSize({ width: 480, height: 800 })
      await page.getByRole('button', { name: '打开媒体库', exact: true }).click()
      await page.getByRole('dialog', { name: '媒体库', exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog', { name: '媒体库', exact: true }).waitFor({ state: 'hidden' })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow overlay does not create horizontal overflow')
      report.push({ reducedMotion, adjacentCases: ['new song uses a new decoded cover', 'management retains the new song', 'empty artwork shows fallback', '480px sidebar overlay opens and closes with Escape'] })
      assert.deepEqual(errors, [], 'adjacent cases have no runtime errors')
    }
    await page.close()
  }
} catch (error) {
  if (activePage && !activePage.isClosed()) report.push({ failureState: await activePage.evaluate(() => ({ track: window.viewModel?.playback.track?.id, route: window.viewModel?.playlist.library.route, pages: [...document.querySelectorAll('.playlist-panel,.playlist-management')].map(element => ({ className: element.className, inert: element.inert, opacity: getComputedStyle(element).opacity })), images: [...document.querySelectorAll('.playlist-library-cover-image,.playlist-playback-cover-image')].map(image => ({ src: image.src, decoded: image.complete && image.naturalWidth > 0 })), lastCalls: window.calls?.slice(-5).map(call => ({ command: call.command, maxEdge: call.input?.maxEdge, time: call.time })) })) })
  throw error
} finally {
  console.log(JSON.stringify({ browser: browser.version(), baseline, smoke, overviewOnly, overviewBaseline, report }))
  await browser.close()
}

