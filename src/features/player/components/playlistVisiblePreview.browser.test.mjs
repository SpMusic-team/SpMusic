// Uses the same real hook, SPXR/BMP parser and browser decode as preload tests.
// Only desktop transport is mocked; no native picker or production probe runs.
import assert from 'node:assert/strict'
import { browser, open, select } from './playlistCoverPreload.browser.test.mjs'

const report = []
const demand = (ids, edge = 256) => ({ visibleIds: ids, prefetchIds: [], coverCssPixels: edge, dpr: 1 })
const requestVisible = (page, ids, edge = 256) => page.evaluate(({ ids, demand }) => {
  window.showFixture()
  window.player.setVisiblePlaylistTrackIds(ids, true, true, demand)
}, { ids, demand: demand(ids, edge) })
const widths = (page, ids) => page.evaluate(ids => Object.fromEntries(ids.map(id => [id,
  window.player.playlistTrackVisuals[id]?.coverThumbnail?.width ?? 0,
])), ids)
const releasePixels = page => page.evaluate(() => {
  window.config.pixelGate = false
  window.pendingPixels.splice(0).forEach(resolve => resolve())
})
const waitWidths = (page, ids, width) => page.waitForFunction(({ ids, width }) => ids.every(id =>
  window.player.playlistTrackVisuals[id]?.coverThumbnail?.width === width), { ids, width })
const upgradeCalls = page => page.evaluate(() => window.calls.filter(call => call.command === 'audio_load_playlist_cover_pixels'
  && call.input.filePath === '/covers/a/1.png' && call.input.maxEdge === 256).length)
async function holdExpiredUpgradeRetry() {
  const { page, errors } = await open()
  await select(page, { count: 12, pixelGate: true, edgeFailures: { '/covers/a/1.png|256': 100 } })
  await page.waitForFunction(() => window.pendingPixels.length === 2)
  await requestVisible(page, ['a-1'])
  await page.evaluate(() => window.pendingPixels.splice(0).forEach(resolve => resolve()))
  await page.waitForFunction(() => window.pendingPixels.some(resolve => resolve.input.filePath === '/covers/a/1.png' && resolve.input.maxEdge === 256))
  const previousUrl = await page.evaluate(() => {
    const index = window.pendingPixels.findIndex(resolve => resolve.input.filePath === '/covers/a/1.png' && resolve.input.maxEdge === 256)
    window.pendingPixels.splice(index, 1)[0]()
    return window.player.playlistTrackVisuals['a-1'].coverThumbnail.src
  })
  await page.waitForFunction(() => window.pendingPixels.length === 2)
  await requestVisible(page, ['a-1', 'a-5', 'a-6', 'a-7', 'a-8'])
  await page.waitForTimeout(700)
  assert.equal(await upgradeCalls(page), 1, 'an expired high-edge retry does not jump past missing visible previews')
  return { page, errors, previousUrl }
}

try {
  {
    const { page, errors } = await open()
    await select(page, { count: 10, pixelGate: true })
    await page.waitForFunction(() => window.pendingPixels.length === 2)
    const ids = Array.from({ length: 8 }, (_, index) => `a-${index + 1}`)
    await requestVisible(page, ids)
    // Drain one bounded operation at a time, keeping the last preview blocked.
    for (let iteration = 0; iteration < 12; iteration++) {
      const state = await page.evaluate(() => ({ ready: Object.keys(window.player.playlistTrackVisuals)
        .filter(id => /^a-[1-7]$/.test(id) && window.player.playlistTrackVisuals[id]?.coverThumbnail),
      lastWaiting: window.pendingPixels.some(resolve => resolve.input.filePath === '/covers/a/8.png'),
      }))
      if (state.ready.length === 7 && state.lastWaiting) break
      await page.waitForFunction(() => window.pendingPixels.some(resolve => resolve.input.filePath !== '/covers/a/8.png'))
      const releasedId = await page.evaluate(() => {
        const index = window.pendingPixels.findIndex(resolve => resolve.input.filePath !== '/covers/a/8.png')
        const [resolve] = window.pendingPixels.splice(index, 1)
        const trackId = 'a-' + resolve.input.filePath.split('/').at(-1).split('.')[0]
        resolve()
        return trackId
      })
      await page.waitForFunction(id => window.player.playlistTrackVisuals[id]?.coverThumbnail, releasedId)
    }
    assert.deepEqual(await widths(page, ids.slice(0, 7)), Object.fromEntries(ids.slice(0, 7).map(id => [id, 128])))
    const beforeLast = await page.evaluate(() => window.calls.filter(call => call.command === 'audio_load_playlist_cover_pixels').map(call => call.input))
    assert(!beforeLast.some(input => input.maxEdge > 128 && input.filePath !== '/covers/a/0.png'),
      'one missing visible preview prevents all ordinary upgrades from occupying a slot')
    assert(!beforeLast.some(input => input.filePath === '/covers/a/9.png'),
      'background work waits behind missing visible previews')
    await releasePixels(page)
    await waitWidths(page, ids, 256)
    const after = await page.evaluate(() => ({ requests: window.calls.filter(call => call.command === 'audio_load_playlist_cover_pixels').map(call => call.input),
      maxActive: window.maxActive, loaded: document.querySelectorAll('img[data-loaded="true"]').length }))
    for (const id of ids) {
      const path = `/covers/a/${id.slice(2)}.png`
      assert.deepEqual(after.requests.filter(input => input.filePath === path).map(input => input.maxEdge), [128, 256])
    }
    assert(after.maxActive <= 2)
    assert(after.loaded >= ids.length)
    assert.deepEqual(errors, [])
    report.push({ case: 'all visible previews precede upgrades and background', previews: 8, finalEdge: 256, maxActive: after.maxActive })
    await page.close()
  }

  {
    const { page, errors } = await open()
    await select(page, { count: 10, sourceGate: true, noCover: [4], dataUrlOnly: [5], unavailable: [6], terminalSources: [7] })
    const ids = Array.from({ length: 8 }, (_, index) => `a-${index + 1}`)
    await requestVisible(page, ids)
    await page.evaluate(() => {
      window.config.sourceGate = false
      window.pendingSources.splice(0).forEach(resolve => resolve())
    })
    const drawable = ['a-1', 'a-2', 'a-3', 'a-8']
    await waitWidths(page, drawable, 256)
    await page.waitForFunction(() => window.player.playlistTrackVisuals['a-9']?.coverThumbnail?.width === 128)
    const result = await page.evaluate(() => ({ noCover: window.player.playlistTrackVisuals['a-4'],
      sourceCalls: window.calls.filter(call => call.command === 'audio_probe_playlist_cover').map(call => call.input.path),
      pixelPaths: window.calls.filter(call => call.command === 'audio_load_playlist_cover_pixels').map(call => call.input.filePath) }))
    assert.equal(result.noCover.hasLocalArtwork, false)
    assert.equal(result.sourceCalls.filter(path => path === '/audio/a/4.flac').length, 1, 'known no-cover is terminal, not an endless upgrade')
    assert.equal(result.sourceCalls.filter(path => path === '/audio/a/5.flac').length, 1)
    assert.equal(result.sourceCalls.filter(path => path === '/audio/a/7.flac').length, 1)
    for (const index of [4, 5, 6, 7]) assert(!result.pixelPaths.includes(`/covers/a/${index}.png`))
    assert.deepEqual(errors, [])
    report.push({ case: 'no cover, dataURL-only, unavailable and terminal source failure release barrier', final: drawable.length })
    await page.close()
  }

  {
    const { page, errors } = await open()
    await select(page, { count: 10, sourceGate: true, sourceMismatchIds: [4] })
    const ids = ['a-1', 'a-2', 'a-3', 'a-4']
    await requestVisible(page, ids)
    await page.evaluate(() => {
      window.config.sourceGate = false
      window.pendingSources.splice(0).forEach(resolve => resolve())
    })
    await waitWidths(page, ids.slice(0, 3), 256)
    assert.equal(await page.evaluate(() => window.player.playlistTrackVisuals['a-4']?.coverThumbnail ?? null), null)
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'audio_probe_playlist_cover'
      && call.input.path === '/audio/a/4.flac').length), 1)
    assert.deepEqual(errors, [])
    report.push({ case: 'wrong source identity cannot block other final upgrades', final: 3 })
    await page.close()
  }

  {
    const { page, errors } = await open()
    await select(page, { count: 8, sourceGate: true })
    await requestVisible(page, ['a-1', 'a-2', 'a-3', 'a-4'])
    await page.waitForFunction(() => window.pendingSources.length === 2)
    await select(page, { scope: 'b' })
    await requestVisible(page, ['b-1', 'b-2', 'b-3', 'b-4'])
    await page.evaluate(() => {
      window.config.sourceGate = false
      window.pendingSources.splice(0).forEach(resolve => resolve())
    })
    await waitWidths(page, ['b-1', 'b-2', 'b-3', 'b-4'], 256)
    const result = await page.evaluate(() => ({ ids: Object.keys(window.player.playlistTrackVisuals),
      paths: window.calls.filter(call => call.command === 'audio_load_playlist_cover_pixels').map(call => call.input.filePath) }))
    assert(result.ids.every(id => id.startsWith('b-')), 'late source results do not publish into the replacement scope')
    assert(result.paths.every(path => !path.startsWith('/covers/a/')), 'truly stale sources do not decode or poison the new barrier')
    assert.deepEqual(errors, [])
    report.push({ case: 'truly stale source is discarded without blocking the replacement scope', final: 4 })
    await page.close()
  }

  {
    const { page, errors } = await open()
    await select(page, { count: 12, pixelGate: true })
    await page.waitForFunction(() => window.pendingPixels.length === 2)
    await requestVisible(page, ['a-1', 'a-2', 'a-3', 'a-4'])
    await requestVisible(page, ['a-5', 'a-6', 'a-7', 'a-8'])
    await page.evaluate(() => window.pendingPixels.splice(0).forEach(resolve => resolve()))
    await page.waitForFunction(() => window.pendingPixels.length === 2)
    const next = await page.evaluate(() => window.pendingPixels.map(resolve => resolve.input))
    assert(next.every(input => ['/covers/a/5.png', '/covers/a/6.png'].includes(input.filePath) && input.maxEdge === 128),
      'latest viewport previews replace queued work from the previous viewport')
    await releasePixels(page)
    await waitWidths(page, ['a-5', 'a-6', 'a-7', 'a-8'], 256)
    const old = await page.evaluate(() => window.player.playlistTrackVisuals['a-5'].coverThumbnail.src)
    await requestVisible(page, ['a-5', 'a-6', 'a-7', 'a-8'], 128)
    assert.equal(await page.evaluate(() => window.player.playlistTrackVisuals['a-5'].coverThumbnail.src), old,
      'a lower demand never clears or downgrades an existing final image')
    assert.deepEqual(errors, [])
    report.push({ case: 'fast viewport replacement and existing-image retention', final: 4 })
    await page.close()
  }

  {
    const { page, errors, previousUrl } = await holdExpiredUpgradeRetry()
    for (let iteration = 0; iteration < 10; iteration++) {
      const state = await page.evaluate(() => ({ ready: ['a-5', 'a-6', 'a-7'].filter(id => window.player.playlistTrackVisuals[id]?.coverThumbnail),
        lastWaiting: window.pendingPixels.some(resolve => resolve.input.filePath === '/covers/a/8.png') }))
      if (state.ready.length === 3 && state.lastWaiting) break
      await page.waitForFunction(() => window.pendingPixels.some(resolve => resolve.input.filePath !== '/covers/a/8.png'))
      const released = await page.evaluate(() => {
        const index = window.pendingPixels.findIndex(resolve => resolve.input.filePath !== '/covers/a/8.png')
        const [resolve] = window.pendingPixels.splice(index, 1)
        resolve()
        return 'a-' + resolve.input.filePath.split('/').at(-1).split('.')[0]
      })
      await page.waitForFunction(id => window.player.playlistTrackVisuals[id]?.coverThumbnail, released)
    }
    assert.equal(await upgradeCalls(page), 1)
    await releasePixels(page)
    await waitWidths(page, ['a-5', 'a-6', 'a-7', 'a-8'], 256)
    await page.waitForFunction(() => window.calls.filter(call => call.command === 'audio_load_playlist_cover_pixels'
      && call.input.filePath === '/covers/a/1.png' && call.input.maxEdge === 256).length === 3)
    await page.waitForTimeout(1100)
    assert.equal(await upgradeCalls(page), 3, 'a deferred retry retains its original three-attempt limit')
    assert.equal(await page.evaluate(() => window.player.playlistTrackVisuals['a-1'].coverThumbnail.src), previousUrl)
    assert.deepEqual(errors, [])
    report.push({ case: 'expired upgrade retry respects preview barrier and bounded attempts', attempts: 3, retained: true })
    await page.close()
  }

  {
    const { page, errors } = await holdExpiredUpgradeRetry()
    await select(page, { scope: 'b', pixelGate: false, edgeFailures: {} })
    await requestVisible(page, ['b-1', 'b-2', 'b-3'])
    await releasePixels(page)
    await waitWidths(page, ['b-1', 'b-2', 'b-3'], 256)
    await page.waitForTimeout(1100)
    assert.equal(await upgradeCalls(page), 1, 'scope replacement disposes an expired deferred retry')
    assert((await page.evaluate(() => Object.keys(window.player.playlistTrackVisuals))).every(id => id.startsWith('b-')))
    await page.evaluate(() => window.unmountFixture())
    await page.waitForFunction(() => window.created.every(src => window.revoked.includes(src)))
    assert.deepEqual(errors, [])
    report.push({ case: 'scope replacement and disposal clear deferred retry ownership', oldAttempts: 1 })
    await page.close()
  }

  {
    const { page, errors } = await open()
    await select(page, { count: 8, sourceGate: true, edgeFailureCode: 'STALE_REQUEST', edgeFailures: { '/covers/a/4.png|128': 100 } })
    const ids = ['a-1', 'a-2', 'a-3', 'a-4']
    await requestVisible(page, ids)
    await page.evaluate(() => {
      window.config.sourceGate = false
      window.pendingSources.splice(0).forEach(resolve => resolve())
    })
    await waitWidths(page, ids.slice(0, 3), 256)
    for (let iteration = 0; iteration < 3; iteration++) await requestVisible(page, ids)
    await page.waitForTimeout(100)
    const result = await page.evaluate(() => ({ attempts: window.calls.filter(call => call.command === 'audio_load_playlist_cover_pixels'
      && call.input.filePath === '/covers/a/4.png').length, image: window.player.playlistTrackVisuals['a-4']?.coverThumbnail ?? null }))
    assert.equal(result.attempts, 3, 'current-job stale responses exhaust the original retry budget without reopening it on refresh')
    assert.equal(result.image, null, 'exhaustion releases the barrier without pretending the rejected card loaded')
    assert.deepEqual(errors, [])
    report.push({ case: 'current stale responses stop after three attempts and release other final upgrades', attempts: 3 })
    await page.close()
  }

  console.log('VISIBLE_PREVIEW', JSON.stringify(report))
} finally { await browser.close() }
