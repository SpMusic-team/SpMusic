#!/usr/bin/env node
// Search-add → playlist list-load latency harness.
//
// Measures, in a real browser against a real Vite dev server, the two
// quantities the user report separates:
//
//   addActionMs  → cost of the add/create action itself
//                  (confirm click → action resolves → playlist data updated)
//   listLoadMs   → cost of the SUBSEQUENT playlist open
//                  (T90 of initially-visible covers actually becoming visible)
//                  plus the native commands issued and their summed modelled cost
//
// Scenarios (see README.md for the full matrix and rationale):
//   S1   search page → select N → create playlist → open it immediately
//   S1b  same create, but leave the page first, then open it (isolates leftover
//        work from the create action being charged to this open)
//   S2   cold baseline: open a playlist with an identical sourcePath set, with
//        no preceding add/create at all
//   S3   add into an EXISTING playlist from the media-library songs page
//   S4   add while the target playlist is already mounted
//
// Usage:
//   SPMUSIC_PLAYWRIGHT=<dir> node tools/perf-regression/run.mjs \
//     --worktree <abs path> [--version-id V3] [--scenarios S1,S1b,S2,S3,S4]
//     [--repeat 3] [--out <file>]
//
// The same command works against any worktree: nothing here imports from src/.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MODEL, buildFixtureModule, buildSurfaceProbeModule, patchedAudioCommands } from './lib/fixture.mjs'
import {
  gitHead, gitIsDirty, gitSubject, hashSet, loadPlaywright,
  resolveBrowserExecutable, startDevServer, summarize, verifyOrigin,
} from './lib/harness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PERF_CONFIG = path.join(HERE, 'vite.perf.config.mts')

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf('--' + name)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}
const worktreePath = path.resolve(flag('worktree', process.cwd()))
const versionId = flag('version-id', path.basename(worktreePath))
const scenarioList = flag('scenarios', 'S1,S1b,S2,S3,S4').split(',').map(s => s.trim()).filter(Boolean)
const repeats = Number(flag('repeat', '3'))
const outPath = flag('out', path.join(HERE, 'results', 'current', `${versionId}.json`))
const selectionSize = Number(flag('selection', '6'))
// Size of the pre-existing playlist. The user's real playlists are hundreds of
// tracks, and the amplifying path this harness is testing (whole-table summary
// and duration invalidation on add) only becomes visible at that scale.
const playlistSize = Number(flag('playlist-size', String(selectionSize)))
const viewport = { width: 1600, height: 1000 }

const log = message => console.log(`[${versionId}] ${message}`)

// ---------------------------------------------------------------------------
// Fixture shape. S1/S2 must see an identical sourcePath set; `selectionSize`
// controls how many tracks are added, and the cold playlist is built from the
// same paths so cover-cache behaviour is comparable.
// ---------------------------------------------------------------------------
const LIBRARY_ROOT = '/perf/library'
// Library-view scenarios (SA/SC) are sized by the scanned library, not by any
// playlist, so they take their own flag.
const librarySize = Number(flag('library-size', String(Math.max(90, playlistSize + selectionSize * 3))))
const FOLDER_TRACK_COUNT = librarySize
// Scope marker of the fixture's pre-existing playlist.
const COLD_PLAYLIST_SCOPE_MARKER = 'cold.m3u8'

// Tracks S1 selects from the search results, chosen from the "Zeta" title block
// so the search filter surfaces them.
const SELECTED_PATHS = Array.from({ length: selectionSize }, (_, i) => `${LIBRARY_ROOT}/${60 + i}.flac`)

// COMPARABILITY CONTRACT (the Lead's requirement):
// when `--playlist-size` is left at its default the pre-existing playlist holds
// EXACTLY `SELECTED_PATHS`, so S1 ("search-selected N tracks → created playlist
// → open") and S2 ("open the pre-existing playlist cold") look at the same
// sourcePath set → same cover-cache keys, same row count. `run.mjs` asserts the
// sets hash equal before recording numbers.
// At a larger `--playlist-size` the playlist is a realistic, large playlist and
// S1/S2 are no longer the comparable pair; use SW (warm reopen) vs S3 (add then
// open) there instead.
const COLD_PLAYLIST_PATHS = playlistSize === selectionSize
  ? SELECTED_PATHS
  : Array.from({ length: playlistSize }, (_, i) => `${LIBRARY_ROOT}/${i}.flac`)

// Tracks S3/S4 append to the pre-existing playlist: disjoint from its members so
// the add is a genuine insertion rather than an idempotent no-op.
const ADDITIONAL_PATHS = Array.from({ length: selectionSize }, (_, i) => `${LIBRARY_ROOT}/${playlistSize + i}.flac`)

function fixtureConfig(dependency) {
  return {
    reactUrl: dependency('react.js'),
    reactDomUrl: dependency('react-dom_client.js'),
    model: MODEL,
    fixture: {
      libraryRoot: LIBRARY_ROOT,
      folderTrackCount: FOLDER_TRACK_COUNT,
      playlist: {
        directoryPath: '/perf/lists',
        directoryName: 'perf',
        sourcePath: '/perf/lists/cold.m3u8',
        name: 'Perf Cold List',
        // Exactly the tracks S1 selects, so S1 and S2 are comparable.
        trackPaths: COLD_PLAYLIST_PATHS,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------
const SELECTORS = {
  shell: '.player-shell',
  searchPage: '.search-page',
  searchInput: '.search-page input[type=search]',
  searchSongCard: '.search-songs .playlist-card',
  playlistPanel: '.playlist-panel',
  playlistGrid: '.playlist-grid',
  trackCard: '[data-playlist-track-id]',
  dock: '.playlist-playback-dock',
  addDialog: '.playlist-add-dialog',
  addRow: '.playlist-add-row',
}

async function boot(page) {
  await page.waitForFunction(sel => Boolean(document.querySelector(sel)), SELECTORS.shell, { timeout: 40_000 })
  // Wait for the folder scan to finish. The app restores registered roots on
  // mount, but `createPlaylist` only projects songs from scanned FOLDER
  // sources; creating before the scan lands yields a null scope and no
  // playlist. `allSongs` is the projected folder content, so a non-empty
  // length is the real readiness signal here.
  await page.waitForFunction(() => {
    const vm = window.__PERF_VM__
    return Boolean(vm) && vm.playlist.library.allSongs.length > 0
  }, null, { timeout: 60_000 }).catch(() => {
    // Older revisions expose the library projection differently and the pure
    // cold-open scenarios do not need the folder scan at all, so a timeout here
    // is not fatal; the S1 create step fails loudly on its own if it needs it.
  })
  // Wait for the library to settle: summaries and durations ready, no import.
  await page.waitForFunction(() => {
    const vm = window.__PERF_VM__
    return Boolean(vm) && !vm.playlist.library.isImportPending && !vm.playlist.library.isPlaylistRestorePending
  }, null, { timeout: 40_000 }).catch(() => {})
  // Give cover warmup a moment so S1/S2 start from an equivalent steady state.
  await page.waitForTimeout(1200)
}

async function openSearch(page) {
  await page.keyboard.press('Control+f')
  await page.waitForFunction(sel => {
    const element = document.querySelector(sel)
    return element && !element.hidden
  }, SELECTORS.searchPage, { timeout: 15_000 })
  await page.waitForTimeout(400)
}

async function fillSearch(page, query) {
  await page.evaluate(({ selector, value }) => {
    const input = document.querySelector(selector)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, { selector: SELECTORS.searchInput, value: query })
  await page.waitForTimeout(600)
}

async function enterSelectMode(page, scope) {
  const button = page.locator(scope).getByRole('button', { name: '选择', exact: true }).first()
  await button.waitFor({ timeout: 15_000 })
  await button.click()
  await page.waitForTimeout(400)
}

async function selectSearchCards(page, count) {
  // `createPlaylist` keys songs by normalised sourcePath, which the search page
  // publishes as `data-song-key` on the row wrapper. The card element itself
  // only carries the track id, so reading the id here would build a playlist
  // from keys that never match and silently produce a null scope.
  const ids = await page.evaluate(({ selector, count }) => {
    const cards = [...document.querySelectorAll(selector)].slice(0, count)
    for (const card of cards) card.click()
    return cards.map(card => card.closest('[data-song-key]')?.dataset.songKey
      ?? card.getAttribute('data-song-key')
      ?? card.getAttribute('data-playlist-track-id'))
  }, { selector: SELECTORS.searchSongCard, count })
  await page.waitForTimeout(500)
  return ids
}

/** Read the workspace-wide meters in one round trip. */
async function readMeters(page) {
  return page.evaluate(() => {
    const perf = window.__PERF__
    const calls = perf.calls()
    const byCommand = {}
    let totalDelayMs = 0
    const seen = new Set()
    for (const call of calls) {
      const entry = byCommand[call.command] ?? (byCommand[call.command] = { count: 0, uniqueKeys: 0, delayMs: 0 })
      entry.count += 1
      entry.delayMs += call.delayMs
      totalDelayMs += call.delayMs
      const dedup = call.command + '\u0000' + call.key
      if (!seen.has(dedup)) { seen.add(dedup); entry.uniqueKeys += 1 }
    }
    return {
      calls: calls.length,
      byCommand,
      totalModelledNativeMs: Math.round(totalDelayMs * 100) / 100,
      playlists: perf.playlists(),
      addLog: perf.addLog(),
      trackSources: perf.trackSources(),
    }
  })
}

async function resetMeters(page) {
  // Reset only the counters. Do NOT touch __PERF_OPEN_STATE__ / __PERF_OPEN_START__:
  // they are the sampler's API, and clearing them here made the sampler look
  // like it never finished.
  await page.evaluate(() => { window.__PERF__.reset() })
}

/**
 * Measure the open of the currently-mounted playlist.
 * Returns the T90 cover-arrival measurement plus the native work it issued.
 */
async function measureOpen(page, { dwellMs = 8000 } = {}) {
  await resetMeters(page)
  await page.evaluate(options => window.__PERF_OPEN_START__(options), { dwellMs })
  await page.waitForFunction(() => {
    const state = window.__PERF_OPEN_STATE__ && window.__PERF_OPEN_STATE__()
    return state && state.state === 'done'
  }, null, { timeout: dwellMs + 25_000, polling: 100 })
  const open = await page.evaluate(() => window.__PERF_OPEN_STATE__().result)
  const meters = await readMeters(page)
  return { open, native: meters }
}

/**
 * Close the playlist (if mounted), arm the sampler, THEN open it.
 *
 * Ordering is the whole point: covers that arrive *because of* the open must be
 * inside the measured window. Arming after the panel has mounted (the obvious
 * first implementation) measures only already-warm images and reports ~0.6 ms
 * with zero native commands → a number that says nothing about the user report.
 *
 * `openFn` performs the real open action; `alreadyMounted` controls whether we
 * first navigate away so the open is genuinely cold.
 */
async function openAndMeasure(page, { openFn, dwellMs = 8000, clearFirst = true }) {
  if (clearFirst) {
    await page.evaluate(() => {
      const vm = window.__PERF_VM__
      if (vm.playlist.isOpen) vm.playlist.onOpenChange(false)
    })
    // Wait for the panel to actually leave and let queued work drain.
    await page.waitForFunction(sel => !document.querySelector(sel), SELECTORS.playlistPanel, { timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(1200)
  }
  await resetMeters(page)
  await page.evaluate(options => window.__PERF_OPEN_START__(options), { dwellMs })
  await openFn()
  await page.waitForFunction(() => {
    const state = window.__PERF_OPEN_STATE__ && window.__PERF_OPEN_STATE__()
    return state && state.state === 'done'
  }, null, { timeout: dwellMs + 30_000, polling: 100 })
  const open = await page.evaluate(() => window.__PERF_OPEN_STATE__().result)
  const meters = await readMeters(page)
  return { open, native: meters }
}

// ---------------------------------------------------------------------------
// Scenario drivers
// ---------------------------------------------------------------------------

/**
 * Open a playlist through the real library UI, selecting it by substring of its
 * scope. Scopes look like "m3u8\u0000/perf/lists/cold.m3u8", so matching must be
 * on the scope string, not on a track path.
 *
 * Returns a function that performs just the open, so callers can arm the
 * sampler first and then invoke it (see openAndMeasure).
 */
async function resolvePlaylistOpener(page, marker) {
  const resolved = await page.evaluate(async marker => {
    const vm = window.__PERF_VM__
    const item = vm.playlist.library.items.find(entry => String(entry.scope).includes(marker))
    if (!item) return { ok: false, available: vm.playlist.library.items.map(entry => String(entry.scope)) }
    return { ok: true, scope: String(item.scope) }
  }, marker)
  if (!resolved.ok) throw new Error(`playlist scope containing "${marker}" not found; available: ${JSON.stringify(resolved.available)}`)
  const scope = resolved.scope
  return {
    scope,
    open: async () => {
      await page.evaluate(scope => {
        const vm = window.__PERF_VM__
        // Prefer the shipped library selection action; fall back to the scope setter.
        if (vm.playlist.library.onSelect) vm.playlist.library.onSelect(scope)
      }, scope)
    },
  }
}

/** Wait until the mounted playlist actually has rows rendered. */
async function waitForRows(page) {
  await page.waitForFunction(sel => Boolean(document.querySelector(sel)), SELECTORS.playlistPanel, { timeout: 25_000 })
  await page.waitForFunction(({ grid, card }) => document.querySelectorAll(`${grid} ${card}`).length > 0,
    { grid: SELECTORS.playlistGrid, card: SELECTORS.trackCard }, { timeout: 25_000 })
}

/**
 * Shared create step for S1/S1b.
 *
 * Everything here is the shipped flow: Ctrl+F opens the aggregate search page,
 * the query goes into the real search input, selection mode is the real toolbar
 * toggle, cards are the real PlaylistCard elements, and the playlist is created
 * by the shipped `library.onCreatePlaylist` binding reached through the real
 * "选择帮助" dialog. Nothing is synthesised.
 */
async function createPlaylistFromSearch(page) {
  await openSearch(page)
  await fillSearch(page, 'Zeta')
  await enterSelectMode(page, SELECTORS.searchPage)
  const selected = await selectSearchCards(page, selectionSize)
  if (!selected.length) throw new Error('no search result cards were selectable')

  await page.getByRole('button', { name: '选择帮助', exact: true }).click()
  await page.waitForTimeout(250)

  const beforeAdd = await readMeters(page)
  const startedAt = await page.evaluate(() => window.__PERF__.now())

  // The action itself. `onCreatePlaylist` is the shipped binding on the search
  // page's dock selection. It returns the new scope synchronously and adds the
  // playlist to the library list on the next commit.
  const created = await page.evaluate(keys => {
    try {
      const library = window.__PERF_VM__.playlist.library
      if (typeof library.onCreatePlaylist !== 'function') return { ok: false, error: 'no onCreatePlaylist binding' }
      const scope = library.onCreatePlaylist('Perf Search List', keys)
      return { ok: true, scope: scope == null ? null : String(scope) }
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) }
    }
  }, selected)
  if (!created.ok) throw new Error('create-playlist from search failed: ' + created.error)

  // Wait for the library to expose it (the create commits through React state).
  const createdScope = await page.evaluate(async expected => {
    const vm = window.__PERF_VM__
    const deadline = performance.now() + 15000
    while (performance.now() < deadline) {
      const items = vm.playlist.library.items
      const match = expected ? items.find(entry => String(entry.scope) === expected)
        : items.find(entry => String(entry.scope).startsWith('custom'))
      if (match) return String(match.scope)
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    return null
  }, created.scope)
  const addActionMs = await page.evaluate(startedAt => window.__PERF__.now() - startedAt, startedAt)
  const afterAdd = await readMeters(page)
  if (!createdScope) throw new Error('create-playlist returned ' + created.scope + ' but the library never listed it')
  return {
    selected,
    createdScope,
    addActionMs,
    addActionNativeMs: afterAdd.totalModelledNativeMs - beforeAdd.totalModelledNativeMs,
    addNativeCommands: afterAdd.calls - beforeAdd.calls,
  }
}

async function closeSearch(page) {
  // The search page covers the library, so the playlist panel stays
  // `visibility: hidden` with a 0x0 rect until it is dismissed. Opening a
  // playlist while search is still up measures nothing.
  await page.evaluate(() => {
    const vm = window.__PERF_VM__
    if (vm.search && typeof vm.search.onOpenChange === 'function') vm.search.onOpenChange(false)
  })
  await page.waitForFunction(() => {
    const vm = window.__PERF_VM__
    return !vm.search || !vm.search.isOpen
  }, null, { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(400)
}

/** S1 (primary): search page → select → create playlist → open it immediately. */
async function runS1(page) {
  const created = await createPlaylistFromSearch(page)
  await closeSearch(page)
  // The created playlist is already the current scope; the real open follows the
  // create the way a user does it, and the cover work is charged to this open.
  const opener = await resolvePlaylistOpener(page, 'custom')
  const listLoad = await openAndMeasure(page, { openFn: opener.open, clearFirst: true })
  if (listLoad.open && listLoad.open.rowsInitiallyVisible === 0) {
    const diag = await page.evaluate(scope => {
      const vm = window.__PERF_VM__
      const panels = [].slice.call(document.querySelectorAll('.playlist-panel')).map(el => {
        const r = el.getBoundingClientRect()
        const grid = el.querySelector('.playlist-grid')
        return {
          rect: [Math.round(r.width), Math.round(r.height), Math.round(r.top), Math.round(r.bottom)],
          hidden: el.hidden, inert: el.inert ?? null,
          display: getComputedStyle(el).display,
          visibility: getComputedStyle(el).visibility,
          opacity: getComputedStyle(el).opacity,
          grids: grid ? grid.querySelectorAll('[data-playlist-track-id]').length : -1,
          cls: el.className,
        }
      })
      const grids = [].slice.call(document.querySelectorAll('.playlist-grid')).map(el => ({
        cls: el.className, cards: el.querySelectorAll('[data-playlist-track-id]').length,
        rect: [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)],
      }))
      return { openedScope: scope, isPlaylistOpen: vm.playlist.isOpen, panels, grids }
    }, opener.scope)
    console.log('[diag S1 panels]', JSON.stringify(diag).slice(0, 2000))
  }
  return {
    scenario: 'S1',
    addPath: 'search-page:create-playlist',
    createdScope: created.createdScope,
    selectedCount: created.selected.length,
    addActionMs: created.addActionMs,
    addActionNativeMs: created.addActionNativeMs,
    addNativeCommands: created.addNativeCommands,
    listLoad,
    sourcePaths: await page.evaluate(() => window.__PERF__.playlists().flatMap(p => p.tracks.map(t => t.sourcePath))),
  }
}

/** S1b (primary control): same create, but the open happens after leaving the page. */
async function runS1b(page) {
  const created = await createPlaylistFromSearch(page)
  await closeSearch(page)
  // Leave the playlist page and let any post-create work finish, so this open
  // cannot be charged for work the create already started.
  await page.evaluate(() => { window.__PERF_VM__.playlist.onOpenChange(false) })
  await page.waitForFunction(sel => !document.querySelector(sel), SELECTORS.playlistPanel, { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const opener = await resolvePlaylistOpener(page, 'custom')
  const listLoad = await openAndMeasure(page, { openFn: opener.open, clearFirst: true })
  return {
    scenario: 'S1b',
    addPath: 'search-page:create-playlist:deferred-open',
    createdScope: created.createdScope,
    selectedCount: created.selected.length,
    addActionMs: created.addActionMs,
    addActionNativeMs: created.addActionNativeMs,
    addNativeCommands: created.addNativeCommands,
    listLoad,
    sourcePaths: await page.evaluate(() => window.__PERF__.playlists().flatMap(p => p.tracks.map(t => t.sourcePath))),
  }
}

/**
 * SW: warm reopen of the pre-existing playlist, with no add anywhere.
 *
 * This is the baseline the user is actually comparing against: a playlist they
 * have opened before, whose tag summaries and durations are already committed,
 * reopens instantly. S3 is the same playlist reopened right after an add. If S3
 * is much slower than SW at the same `--playlist-size`, the add is what
 * invalidated the whole table — which is the reported symptom.
 */
async function runSW(page) {
  const opener = await resolvePlaylistOpener(page, COLD_PLAYLIST_SCOPE_MARKER)
  // Warm pass: open once, let summaries/durations/covers commit, then leave.
  await opener.open()
  await waitForRows(page)
  await page.waitForFunction(() => {
    const vm = window.__PERF_VM__
    const scope = vm.playlist.playbackSourceScope
    return !scope || vm.playlist.playlistSummaryStatusByScope?.[scope] === 'ready'
  }, null, { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(3000)
  const listLoad = await openAndMeasure(page, { openFn: opener.open, clearFirst: true })
  return {
    scenario: 'SW',
    addPath: 'none:warm-reopen',
    openedScope: opener.scope,
    listLoad,
    sourcePaths: await page.evaluate(() => window.__PERF__.playlists().flatMap(p => p.tracks.map(t => t.sourcePath))),
  }
}

/**
 * Media-library view open: the user's reported problem is that EVERY list under
 * the media library loads slowly, not only playlists. Each library category
 * renders `.playlist-management-content` and, for song lists, a
 * `.playlist-grid.all-songs-list`; while tags and durations are still loading it
 * renders a skeleton instead, so "first row at all" is the honest list-load
 * metric and cover arrival is the follow-up.
 */
async function measureLibraryView(page, { open, panelSelector = '.playlist-management-content',
  gridSelector = '.playlist-grid', cardSelector = '[data-playlist-track-id]', imageSelector }) {
  await resetMeters(page)
  await page.evaluate(options => window.__PERF_OPEN_START__(options), {
    dwellMs: 8000,
    budgetMs: 30000,
    panelSelector,
    gridSelector,
    cardSelector,
    ...(imageSelector ? { imageSelector } : {}),
  })
  await open()
  await page.waitForFunction(() => {
    const state = window.__PERF_OPEN_STATE__ && window.__PERF_OPEN_STATE__()
    return state && state.state === 'done'
  }, null, { timeout: 55_000, polling: 100 })
  const view = await page.evaluate(() => window.__PERF_OPEN_STATE__().result)
  const meters = await readMeters(page)
  if (view && view.rowsInitiallyVisible === 0) {
    const diag = await page.evaluate(() => {
      const pick = sel => [].slice.call(document.querySelectorAll(sel)).map(el => {
        const r = el.getBoundingClientRect()
        return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height),
          vis: getComputedStyle(el).visibility, cards: el.querySelectorAll('[data-playlist-track-id]').length }
      })
      return {
        content: pick('.playlist-management-content'),
        grids: pick('.playlist-grid'),
        allSongsList: pick('.all-songs-list'),
        anyCard: document.querySelectorAll('[data-playlist-track-id]').length,
        emptyState: document.querySelectorAll('.playlist-management-empty').length,
        skeleton: document.querySelectorAll('[class*=skeleton], [aria-busy=true]').length,
      }
    })
    console.log('[diag library zero rows]', JSON.stringify(diag).slice(0, 1400))
  }
  return { view, native: meters }
}

/** SA: media-library "all songs" list (exists since at least 2026-10-25). */
async function runSA(page) {
  const measured = await measureLibraryView(page, {
    open: async () => {
      await page.evaluate(() => window.__PERF_VM__.playlist.library.onSelectCategory('songs'))
    },
  })
  return {
    scenario: 'SA',
    addPath: 'none:library-all-songs',
    listLoad: measured,
    sourcePaths: await page.evaluate(() => window.__PERF__.trackSources()),
  }
}

/** SC: one other library category, chosen by CLI (`--category`). */
async function runSC(page) {
  const category = flag('category', 'album')
  const measured = await measureLibraryView(page, {
    open: async () => {
      await page.evaluate(id => window.__PERF_VM__.playlist.library.onSelectCategory(id), category)
    },
    // Collection categories render [data-collection-key] cards with folder covers.
    cardSelector: category === 'songs' ? '[data-playlist-track-id]' : '[data-collection-key]',
    imageSelector: '.folder-cover img, .folder-cover-image, img.playlist-card-cover-image',
  })
  return {
    scenario: 'SC',
    addPath: 'none:library-' + category,
    category,
    listLoad: measured,
    sourcePaths: await page.evaluate(() => window.__PERF__.trackSources()),
  }
}

/** S2: cold open, no add/create anywhere in this page's life. */
async function runS2(page) {
  const opener = await resolvePlaylistOpener(page, COLD_PLAYLIST_SCOPE_MARKER)
  const listLoad = await openAndMeasure(page, { openFn: opener.open, clearFirst: true })
  return {
    scenario: 'S2',
    addPath: 'none',
    openedScope: opener.scope,
    listLoad,
    sourcePaths: await page.evaluate(() => window.__PERF__.playlists().flatMap(p => p.tracks.map(t => t.sourcePath))),
  }
}

/**
 * S3: add into the EXISTING playlist from the media-library songs page.
 *
 * The search page cannot add to an existing playlist in this revision (see
 * README "Why the search page cannot add to an existing playlist"), so this is
 * the reachable "add to an existing playlist" path. It exists to separate "the
 * add action is expensive" from "the search page is expensive".
 */
async function runS3(page) {
  await page.evaluate(() => window.__PERF_VM__.playlist.library.onSelectCategory('songs'))
  await page.waitForFunction(() => document.querySelectorAll('.all-songs-list .playlist-card').length > 0, null, { timeout: 25_000 })
  await enterSelectMode(page, '.playlist-management')
  const selected = await page.evaluate(async ({ start, count }) => {
    const vm = window.__PERF_VM__
    const cards = [...document.querySelectorAll('.all-songs-list .playlist-card')]
    // Choose tracks that are NOT yet members: the fixture playlist holds the
    // first 48, so pick from the next block.
    const chosen = []
    for (const card of cards) {
      const id = card.getAttribute('data-playlist-track-id')
      const key = card.getAttribute('data-song-key') || id || ''
      const n = Number(String(key).replace(/\D+/g, ''))
      if (Number.isFinite(n) && n >= start && n < start + count && chosen.length < count) chosen.push(card)
    }
    for (const card of chosen) card.click()
    return { count: chosen.length, keys: chosen.map(card => card.getAttribute('data-song-key') || card.getAttribute('data-playlist-track-id')), all: vm.playlist.library.allSongs.length }
  }, { start: playlistSize, count: selectionSize })
  if (!selected.count) throw new Error(`could not select songs from the songs page (allSongs=${selected.all})`)

  await page.evaluate(() => {
    const panel = document.querySelector('.playlist-selection-panel')
    const button = [...panel.querySelectorAll('.playlist-selection-action')].find(b => b.innerText.trim() === '播放列表')
    button?.click()
  })
  await page.waitForFunction(sel => Boolean(document.querySelector(sel)), SELECTORS.addDialog, { timeout: 20_000 })

  const beforeAdd = await readMeters(page)
  const startedAt = await page.evaluate(() => window.__PERF__.now())
  await page.evaluate(sel => { document.querySelector(sel)?.click() }, SELECTORS.addRow)
  await page.waitForFunction(baseline => {
    const list = window.__PERF__.playlists().find(p => p.sourcePath.includes('cold'))
    return list ? list.tracks.length > baseline : false
  }, COLD_PLAYLIST_PATHS.length, { timeout: 25_000 }).catch(() => {})
  const addActionMs = await page.evaluate(startedAt => window.__PERF__.now() - startedAt, startedAt)
  const afterAdd = await readMeters(page)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const opener = await resolvePlaylistOpener(page, COLD_PLAYLIST_SCOPE_MARKER)
  const listLoad = await openAndMeasure(page, { openFn: opener.open, clearFirst: true })
  return {
    scenario: 'S3',
    addPath: 'songs-page:add-to-existing',
    selectedCount: selected.count,
    addActionMs,
    addActionNativeMs: afterAdd.totalModelledNativeMs - beforeAdd.totalModelledNativeMs,
    addNativeCommands: afterAdd.calls - beforeAdd.calls,
    listLoad,
    sourcePaths: await page.evaluate(() => window.__PERF__.playlists().flatMap(p => p.tracks.map(t => t.sourcePath))),
  }
}

/**
 * S4: add while the target playlist is already mounted.
 * The list does not reload; what is measured is the repaint the add triggers.
 */
async function runS4(page) {
  const opener = await resolvePlaylistOpener(page, COLD_PLAYLIST_SCOPE_MARKER)
  await opener.open()
  await waitForRows(page)
  await page.waitForTimeout(1500)

  await resetMeters(page)
  // Arm BEFORE the add so newly-required covers are inside the window.
  await page.evaluate(options => window.__PERF_OPEN_START__(options), { dwellMs: 6000 })
  const startedAt = await page.evaluate(() => window.__PERF__.now())
  await page.evaluate(paths => {
    const library = window.__PERF_VM__.playlist.library
    const item = library.items.find(entry => String(entry.scope).includes('cold'))
    const request = library.onPreparePlaylistAdd?.({ scope: item.scope, songKeys: paths })
    if (request) library.onAddToPlaylist?.(request.snapshot, item.scope, 'end')
  }, SELECTED_PATHS)
  await page.waitForFunction(baseline => {
    const list = window.__PERF__.playlists().find(p => p.sourcePath.includes('cold'))
    return list ? list.tracks.length > baseline : false
  }, COLD_PLAYLIST_PATHS.length, { timeout: 25_000 }).catch(() => {})
  const addActionMs = await page.evaluate(startedAt => window.__PERF__.now() - startedAt, startedAt)
  await page.waitForFunction(() => {
    const state = window.__PERF_OPEN_STATE__ && window.__PERF_OPEN_STATE__()
    return state && state.state === 'done'
  }, null, { timeout: 40_000, polling: 100 })
  const open = await page.evaluate(() => window.__PERF_OPEN_STATE__().result)
  const native = await readMeters(page)
  return {
    scenario: 'S4',
    addPath: 'mounted-playlist:add',
    openedScope: opener.scope,
    addActionMs,
    addActionNativeMs: native.totalModelledNativeMs,
    addNativeCommands: native.calls,
    listLoad: { open, native },
    sourcePaths: await page.evaluate(() => window.__PERF__.playlists().flatMap(p => p.tracks.map(t => t.sourcePath))),
  }
}

const DRIVERS = { S1: runS1, S1b: runS1b, S2: runS2, S3: runS3, S4: runS4, SW: runSW, SA: runSA, SC: runSC }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log(`worktree ${worktreePath}`)
  const head = gitHead(worktreePath)
  log(`HEAD ${head}`)

  const { chromium } = loadPlaywright()
  const executablePath = resolveBrowserExecutable(process.env.SPMUSIC_BROWSER_EXECUTABLE)

  let server
  let browser
  const results = {}
  const skipped = []
  try {
    server = await startDevServer({ worktreePath, perfConfigPath: PERF_CONFIG, log })
    const originCheck = await verifyOrigin({ origin: server.origin, worktreePath, log })

    const mainResponse = await fetch(server.origin + '/src/main.tsx', { signal: AbortSignal.timeout(20_000) })
    const mainText = await mainResponse.text()
    const dependency = name => {
      const escaped = name.replaceAll('.', '\\.')
      const regex = new RegExp('"(/node_modules/\\.vite/deps/' + escaped + '[^"\\n]*)"')
      const found = mainText.match(regex)
      if (!found) throw new Error('could not resolve Vite dependency ' + name)
      return found[1]
    }

    // Fetch the real audioCommands.ts and swap only its two Tauri imports.
    const audioResponse = await fetch(server.origin + '/src/features/player/services/audioCommands.ts', { signal: AbortSignal.timeout(20_000) })
    if (!audioResponse.ok) throw new Error('cannot fetch audioCommands.ts')
    const patchedAudio = patchedAudioCommands(await audioResponse.text())
    const fixtureModule = buildFixtureModule(fixtureConfig(dependency))
    // The real PlayerSurface, re-exported through a one-line probe that
    // publishes its viewModel (the pattern the repo's own tests use).
    const surfaceResponse = await fetch(server.origin + '/src/features/player/components/PlayerSurface.tsx', { signal: AbortSignal.timeout(30_000) })
    if (!surfaceResponse.ok) throw new Error('cannot fetch PlayerSurface.tsx')
    const realSurface = await surfaceResponse.text()
    const surfaceProbe = buildSurfaceProbeModule(fixtureConfig(dependency), realSurface)
    const shellHtml = (await (await fetch(server.origin + '/', { signal: AbortSignal.timeout(20_000) })).text())
      .replace(/src="\/src\/[^"]+"/, 'src="/__perf_fixture.js"')

    browser = await chromium.launch({ headless: true, executablePath })
    log(`browser ${browser.version()}`)

    for (const scenario of scenarioList) {
      const driver = DRIVERS[scenario]
      if (!driver) { skipped.push({ scenario, reason: 'unknown scenario' }); continue }
      results[scenario] = []
      for (let run = 0; run < repeats; run += 1) {
        const context = await browser.newContext({ viewport, reducedMotion: 'reduce', colorScheme: 'light' })
        const page = await context.newPage()
        const pageErrors = []
        page.on('pageerror', error => pageErrors.push(error.message))
        page.on('console', message => { if (message.type() === 'error') pageErrors.push('console: ' + message.text()) })
        try {
          await page.route('**/src/features/player/services/audioCommands.ts*', route =>
            route.fulfill({ contentType: 'text/javascript', body: patchedAudio }))
          await page.route('**/src/features/player/components/PlayerSurface.tsx*', route =>
            route.fulfill({ contentType: 'text/javascript', body: surfaceProbe }))
          await page.route('**/__perf_real_surface.js', route =>
            route.fulfill({ contentType: 'text/javascript', body: realSurface }))
          await page.route('**/__perf_fixture.js', route =>
            route.fulfill({ contentType: 'text/javascript', body: fixtureModule }))
          await page.route('**/__perf_test', route =>
            route.fulfill({ contentType: 'text/html', body: shellHtml }))
          await page.addInitScript(() => {
            localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
            // A fixed layout avoids the harness measuring layout-preference luck.
            localStorage.setItem('spmusic.playlist.layout-level.v1', '1')
            localStorage.setItem('spmusic.all-songs.layout-level.v1', '1')
            localStorage.removeItem('spmusic.player.session.v1')
          })
          await page.goto(server.origin + '/__perf_test', { waitUntil: 'commit' })
          // The surface probe publishes the real view model on first render.
          await page.waitForFunction(() => Boolean(window.__PERF_VM__), null, { timeout: 45_000 })
          await boot(page)
          const record = await driver(page)
          record.run = run
          record.pageErrors = pageErrors
          results[scenario].push(record)
          log(`${scenario} run ${run}: addActionMs=${record.addActionMs ?? '-'} t90=${record.listLoad?.open?.t90FirstVisibleMs ?? '-'} nativeMs=${record.listLoad?.native?.totalModelledNativeMs ?? '-'}`)
        } catch (error) {
          results[scenario].push({ run, error: String(error && error.message ? error.message : error), pageErrors })
          log(`${scenario} run ${run} FAILED: ${error && error.message ? error.message : error}`)
        } finally {
          await context.close()
        }
      }
    }

    // ---- Aggregate ----
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      engine: {
        versionId,
        gitCommit: head,
        gitSubject: gitSubject(worktreePath),
        gitDirty: gitIsDirty(worktreePath),
        worktreePath,
        origin: server.origin,
        originVerified: originCheck.ok,
        servedPlayerShell: originCheck.servedFile,
        viteConfigSource: server.config,
        browser: { name: 'msedge', version: browser.version(), executablePath },
        viewport,
        mockedLatencyModel: MODEL,
        mocks: {
          fake: ['window.backendInvoke transport (native Rust process + filesystem)'],
          real: [
            'index.html, main.tsx, App, AppearanceProvider',
            'PlayerShell, PlayerSurface, SearchPanel, PlaylistLibraryPanel, PlaylistPanel, PlaylistCard',
            'useAudioPlayer, useLibraryArtwork, useAllSongsWindow, playlistCoverScheduler, playlistCoverPixels',
            'audioCommands.ts parsers and response validators (only its two @tauri-apps imports are replaced)',
          ],
        },
        fixture: {
          libraryRoot: LIBRARY_ROOT,
          folderTrackCount: FOLDER_TRACK_COUNT,
          playlistMembers: COLD_PLAYLIST_PATHS.length,
          selectionSize,
          selectedPaths: SELECTED_PATHS,
          coldPaths: COLD_PLAYLIST_PATHS,
        },
      },
      scenarios: summarizeScenarioResults(results),
      samples: results,
      skipped,
    }

    // Prove S1 and S2 track sets are comparable.
    for (const key of Object.keys(report.scenarios)) {
      const entry = report.scenarios[key]
      if (entry.sourcePathHash) log(`${key} sourcePath set ${entry.sourcePathHash.size} tracks hash=${entry.sourcePathHash.fnv1a32}`)
    }

    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(report, null, 2))
    log(`wrote ${outPath}`)
    printSummary(report)
    return report
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (server) await server.stop()
  }
}

function summarizeScenarioResults(results) {
  const out = {}
  for (const [scenario, runs] of Object.entries(results)) {
    const ok = runs.filter(run => !run.error)
    const failed = runs.filter(run => run.error)
    const entry = {
      runs: runs.length,
      succeeded: ok.length,
      failed: failed.length,
      failures: failed.map(run => run.error),
      addPath: ok[0]?.addPath ?? null,
    }
    entry.addActionMs = summarize(ok.map(run => run.addActionMs))
    entry.addActionNativeMs = summarize(ok.map(run => run.addActionNativeMs))
    // Playlist scenarios record `listLoad.open`; library views record
    // `listLoad.view`. Normalise so both summarise and report identically.
    const viewOf = run => run.listLoad?.open ?? run.listLoad?.view
    entry.t90FirstVisibleMs = summarize(ok.map(run => viewOf(run)?.t90FirstVisibleMs))
    entry.p50FirstVisibleMs = summarize(ok.map(run => viewOf(run)?.p50FirstVisibleMs))
    entry.p90FirstVisibleMs = summarize(ok.map(run => viewOf(run)?.p90FirstVisibleMs))
    entry.nativeCommands = summarize(ok.map(run => run.listLoad?.native?.calls))
    entry.nativeModelledMs = summarize(ok.map(run => run.listLoad?.native?.totalModelledNativeMs))
    entry.rowsInitiallyVisible = summarize(ok.map(run => viewOf(run)?.rowsInitiallyVisible))
    // Time until the target list rendered its first row at all (library views
    // show a skeleton until tags/durations settle, so this is the perceived
    // "list is loading" rather than cover arrival).
    entry.firstRowAtMs = summarize(ok.map(run => viewOf(run)?.firstRowAtMs))
    // Command breakdown across runs (sum per command).
    const breakdown = {}
    for (const run of ok) {
      for (const [command, value] of Object.entries(run.listLoad?.native?.byCommand ?? {})) {
        const slot = breakdown[command] ?? (breakdown[command] = { count: 0, delayMs: 0 })
        slot.count += value.count
        slot.delayMs += value.delayMs
      }
    }
    entry.commandBreakdown = breakdown
    const paths = ok.flatMap(run => run.sourcePaths ?? [])
    entry.sourcePathHash = paths.length ? hashSet(paths) : null
    entry.createdScope = ok[0]?.createdScope ?? ok[0]?.openedScope ?? null
    out[scenario] = entry
  }
  return out
}

function printSummary(report) {
  const rows = []
  const order = ['S1', 'S1b', 'S2', 'SW', 'S3', 'S4', 'SA', 'SC']
  for (const key of order) {
    const entry = report.scenarios[key]
    if (!entry) continue
    rows.push({
      scenario: key,
      ok: `${entry.succeeded}/${entry.runs}`,
      addActionMs: entry.addActionMs.median,
      firstRowMs: entry.firstRowAtMs?.median ?? null,
      t90Ms: entry.t90FirstVisibleMs.median,
      p50Ms: entry.p50FirstVisibleMs.median,
      nativeCmds: entry.nativeCommands.median,
      nativeMs: entry.nativeModelledMs.median,
      rows: entry.rowsInitiallyVisible.median,
    })
  }
  console.log('\n=== ' + versionId + ' @ ' + String(report.engine.gitCommit).slice(0, 8) + ' (origin verified: ' + report.engine.originVerified + ') ===')
  console.table(rows)
  const s1 = report.scenarios.S1
  const s2 = report.scenarios.S2
  if (s1 && s2) {
    const delta = (a, b) => (a === null || b === null) ? null : Math.round((a - b) * 100) / 100
    console.log('S1 vs S2 (medians):')
    console.log('  t90 ms      S1=' + s1.t90FirstVisibleMs.median + '  S2=' + s2.t90FirstVisibleMs.median + '  Δ=' + delta(s1.t90FirstVisibleMs.median, s2.t90FirstVisibleMs.median))
    console.log('  native ms   S1=' + s1.nativeModelledMs.median + '  S2=' + s2.nativeModelledMs.median + '  Δ=' + delta(s1.nativeModelledMs.median, s2.nativeModelledMs.median))
    console.log('  native cmds S1=' + s1.nativeCommands.median + '  S2=' + s2.nativeCommands.median + '  Δ=' + delta(s1.nativeCommands.median, s2.nativeCommands.median))
    console.log('  sourcePath hash S1=' + (s1.sourcePathHash && s1.sourcePathHash.fnv1a32) + ' S2=' + (s2.sourcePathHash && s2.sourcePathHash.fnv1a32))
  }
}

main().then(report => {
  const anyFailure = Object.values(report.samples).flat().some(run => run.error)
  process.exitCode = anyFailure ? 1 : 0
}).catch(error => {
  console.error('FATAL', error && error.stack ? error.stack : error)
  process.exitCode = 2
})
