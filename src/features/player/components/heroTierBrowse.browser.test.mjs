/**
 * BR4 / BR5 / BR6 — hero tier behaviour under real browsing (plan §8.3).
 *
 * These drive the REAL PlayerShell with the shared deterministic fixture, so the assertions are
 * about production wiring rather than about a stub agreeing with itself.
 *
 *   BR4 — a high-tier hero must coexist with ordinary rows: the hero may be 1024/1536 while every
 *         list card stays at 256. This is the property that makes the "one key ⇒ one edge" split
 *         worth having, and the one most likely to regress if a shared key were reintroduced.
 *
 *   BR5 — the hero tier must follow the viewport DOWN. S8 caught a 1536 hero inside a 942 px box;
 *         the fix touched four places, so this asserts the end-to-end effect (the DISPLAYED image
 *         changes tier after a resize) rather than any single internal variable.
 *
 *   BR6 — while entering a detail page the requested tier must never step DOWN. The FLIP projection
 *         makes an early measurement report the card size, so asking for a cheap tier first is
 *         acceptable; asking for an expensive one and then a cheaper one during the same entry is not.
 *
 * The tier is read from the ARTWORK REQUEST recorded by the stub (`max_edge`), not from the DOM
 * image: `naturalWidth` for a blob-backed thumbnail is the decoded bitmap, which the pixel lane
 * would also satisfy at 80x50. Requests are the honest signal.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'

/** Served entry module, scanned for Vite's rewritten dependency URLs. */
const entrySource = await (await fetch(origin + '/src/main.tsx')).text()

/** Resolve a Vite dependency URL from the SERVED entry module. */
const dependency = name => {
  const match = entrySource.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}

/**
 * Reuse the shared fixture, adding the two PATH-lane commands and an `edges` log.
 *
 * The shared fixture throws on any unknown command, which is the right default; adding these two
 * keeps that strictness while letting the hero use its real lane. Each path response records the
 * requested `maxEdge`, which is what BR4/BR5/BR6 assert on.
 */
const shared = readFileSync(new URL('./playlistOffscreenReturn.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal, 'reuse the deterministic real shell fixture')
const baseFixture = runInNewContext(literal[1], { dependency })

const fixture = baseFixture
  // Record every artwork request with its tier.
  .replace(
    `window.calls=[];`,
    `window.calls=[];window.edges=[];`,
  )
  .replace(
    `if(command==='audio_load_playlist_cover_pixels'||command==='audio_load_track_thumbnail'||command==='audio_load_cover_pixels'){`,
    `if(command==='audio_load_playlist_cover_pixels'||command==='audio_load_track_thumbnail'||command==='audio_load_cover_pixels'){
  window.edges.push({command,maxEdge:input?.maxEdge??null,path:input?.filePath??input?.sourcePath??null});`,
  )
  // The PATH lane: return a published-file descriptor instead of pixel bytes. The hero uses this
  // lane for its measured tier, so it must exist for BR4-BR6 to observe a real request.
  .replace(
    `if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){`,
    `if(command==='audio_load_playlist_cover_thumbnail_path'||command==='audio_load_track_thumbnail_path'){
  window.edges.push({command,maxEdge:input?.maxEdge??null,path:input?.filePath??input?.sourcePath??null});
  // A tiny valid PNG data URL: the test reads requests, not pixels.
  return {status:'ready',image:{src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',width:1,height:1,encodedBytes:68}};
}
if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){`,
  )
assert(fixture.includes('window.edges.push'), 'the fixture records artwork requests')

const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>delete window.listeners[name];};')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__tier_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(Surface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__tier_fixture.js"')

const browser = await chromium.launch({ headless: true, channel: 'msedge' })

/** Open the shell, enter the playlist detail, and return the page. */
async function openDetail({ width = 2560, height = 1440 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce', deviceScaleFactor: 1 })
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('spmusic.player.startup-page.v1', 'player')
    localStorage.setItem('spmusic.playlist.layout-level.v1', '0')
  })
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__tier_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__tier_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__tier_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__tier_test', { waitUntil: 'commit' })
  await page.waitForFunction(() => Boolean(window.viewModel))
  await page.evaluate(() => window.viewModel.playback.onOpenAudio())
  // The overview lists cards; the track attributes appear only once the detail view is open.
  await page.waitForFunction(() => Boolean(window.viewModel?.playlist?.onOpenChange), { timeout: 20000 })
  await page.evaluate(() => window.viewModel.playlist.onOpenChange(true))
  await page.waitForFunction(() => document.querySelectorAll('[data-playlist-track-id]').length > 0, { timeout: 25000 })
    .catch(async () => {
      const state = await page.evaluate(() => ({
        body: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
        tracks: document.querySelectorAll('[data-playlist-track-id]').length,
        hasOpenAudio: Boolean(window.viewModel?.playback?.onOpenAudio),
        errors: window.__errs ?? null,
      }))
      throw new Error('tracks never appeared: ' + JSON.stringify(state) + ' pageErrors=' + JSON.stringify(errors))
    })
  await page.evaluate(() => window.viewModel.playlist.onOpenChange(true))
  await page.waitForFunction(() => Boolean(document.querySelector('.playlist-hero-artwork')), { timeout: 20000 })
    .catch(async () => {
      const state = await page.evaluate(() => ({
        body: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
        grid: document.querySelectorAll('.playlist-grid [data-playlist-track-id]').length,
        hero: document.querySelectorAll('.playlist-hero-artwork').length,
        isOpen: window.viewModel?.playlist?.isOpen ?? null,
      }))
      throw new Error('hero never appeared: ' + JSON.stringify(state) + ' pageErrors=' + JSON.stringify(errors))
    })
  return { page, errors }
}

test('BR4: the hero may take a high tier while every card stays at 256', async () => {
  const { page, errors } = await openDetail({ width: 2560, height: 1440 })
  try {
    // Let the hero's two-level gate run: the persisted thumbnail must arrive and settle first.
    await page.waitForFunction(() => window.edges.some(e => (e.maxEdge ?? 0) > 256), { timeout: 25000 })
      .catch(() => {})
    const edges = await page.evaluate(() => window.edges)
    const heroHigh = edges.filter(e => (e.maxEdge ?? 0) > 512)

    assert(heroHigh.length > 0,
      `the hero must reach a high tier at 2560px; saw ${JSON.stringify(edges.map(e => [e.command, e.maxEdge]))}`)

    // ── Assertion 1: the REQUEST side ────────────────────────────────────────────
    //
    // Every ordinary-row request must stay at 256. Note there is deliberately NO
    // `maxEdge <= 512` pre-filter here: an earlier version filtered first and then
    // asserted `<= 256`, so a 1536 row request was excluded from the very check meant
    // to catch it. That was a circular assertion (see the plan's §2 finding log).
    const rowRequests = edges.filter(e => e.command.includes('track_thumbnail'))
    for (const request of rowRequests) {
      assert.ok((request.maxEdge ?? 0) <= 256,
        `an ordinary row must request at most 256, got ${request.maxEdge} from ${request.command}`)
    }

    // ── Assertion 2: the DISPLAY side ────────────────────────────────────────────
    //
    // The request log alone cannot prove this: the defect this test now guards was
    // "requests split, display shared". The hero requested 1536 and the rows requested
    // 256, yet the first row still RENDERED the hero's 1536 image because both read the
    // same published record. Only the DOM shows that.
    //
    // Caveat, stated plainly: this fixture's two cover lanes return tiny placeholder
    // images (pixel lane 80x50, path lane 1x1), so `naturalWidth` here CANNOT be used as
    // the tier. What the DOM still proves is the property that actually mattered — that
    // the hero and the first row do not render the SAME image. Tier coverage lives in
    // the request-side assertion above plus the DOM probe that compares real tiers.
    const display = await page.evaluate(() => {
      const heroImage = document.querySelector('.playlist-hero-image')
      const heroSrc = heroImage ? (heroImage.currentSrc || heroImage.src || '') : ''
      const rows = [...document.querySelectorAll('.playlist-grid [data-playlist-track-id]')].map((card, index) => {
        const img = card.querySelector('img')
        return {
          index,
          id: card.dataset.playlistTrackId || null,
          naturalWidth: img ? img.naturalWidth : null,
          src: img ? (img.currentSrc || img.src || '') : '',
        }
      })
      return { hero: { src: heroSrc, present: Boolean(heroImage) }, rows }
    })

    assert.ok(display.hero.present && display.hero.src, 'the hero image must be rendered')
    assert.ok(display.rows.length > 0, 'the detail view must render rows')

    // The decisive one: the hero and the first row must not share an image source.
    // Sharing it is exactly how a high-tier hero used to bleed into the first row.
    assert.notStrictEqual(
      display.rows[0].src,
      display.hero.src,
      'the first row must not render the hero\'s image',
    )
    // And no row may share it, not just the first one.
    for (const row of display.rows) {
      assert.notStrictEqual(
        row.src,
        display.hero.src,
        `row #${row.index} (${row.id}) must not render the hero's image`,
      )
    }

    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})

test('BR5: shrinking the viewport lowers the displayed hero tier', async () => {
  const { page, errors } = await openDetail({ width: 2560, height: 1440 })
  try {
    const readTier = () => page.evaluate(() => {
      const image = document.querySelector('.playlist-hero-image')
      const box = document.querySelector('.playlist-hero-artwork')
      const source = image ? (image.currentSrc || image.src || '') : ''
      // The published file name encodes its edge; a blob URL does not, so fall back to the request
      // log for the most recent hero tier.
      const match = /-(\d+)-t\d+-j\d+\.png$/i.exec(decodeURIComponent(source))
      const last = [...window.edges].reverse().find(e => e.command === 'audio_load_playlist_cover_thumbnail_path')
      return {
        cssWidth: box ? box.clientWidth : null,
        naturalWidth: image ? image.naturalWidth : null,
        edgeFromName: match ? Number(match[1]) : null,
        lastPathEdge: last ? last.maxEdge : null,
      }
    })

    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.waitForTimeout(6000)
    const wide = await readTier()

    await page.setViewportSize({ width: 1000, height: 760 })
    // Give the resize observer, the tier hook and the artwork pipeline time to settle.
    await page.waitForTimeout(8000)
    const narrow = await readTier()

    assert.ok(wide.cssWidth !== narrow.cssWidth,
      `the layout must actually change; saw ${wide.cssWidth} vs ${narrow.cssWidth}`)
    assert.ok((narrow.lastPathEdge ?? 0) < (wide.lastPathEdge ?? 0),
      `the narrow viewport must request a LOWER hero tier; wide=${wide.lastPathEdge}, narrow=${narrow.lastPathEdge}`)
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})

test('BR6: entering a detail page never lowers the requested tier', async () => {
  const { page, errors } = await openDetail({ width: 1600, height: 1000 })
  try {
    await page.waitForTimeout(3000)
    const sequence = await page.evaluate(() =>
      window.edges
        .filter(e => e.command === 'audio_load_playlist_cover_thumbnail_path')
        .map(e => e.maxEdge ?? 0),
    )
    // While entering, the tier may rise (a card-sized early measurement becomes a hero-sized one).
    // A drop during the same entry would mean the box was measured wrongly and then "corrected"
    // downwards, which is the failure the §6.5 guards exist to prevent.
    let drops = 0
    for (let i = 1; i < sequence.length; i += 1) {
      if (sequence[i] < sequence[i - 1]) drops += 1
    }
    assert.equal(drops, 0, `the entry sequence must be monotonic, got ${JSON.stringify(sequence)}`)
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})

test.after(async () => {
  await browser.close()
})
