// Runtime confirmation for the version table: starts each version's own Vite
// dev server and reports whether the search page and the add-to-playlist
// affordance are actually in the rendered DOM. Source reading alone is reported
// separately; this file is the runtime half of the evidence.
import { startVersion } from './run-version.mjs'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const versions = JSON.parse(readFileSync(new URL('../../../.codex-tmp-folder-ui-dist/perf-versions/manifest.json', import.meta.url), 'utf8'))
const portBase = Number(process.env.PERF_VERSION_PORT_BASE || 5340)
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })

const probe = `(() => {
  const q = selector => document.querySelector(selector) !== null;
  const count = selector => document.querySelectorAll(selector).length;
  // The dock is the session-owned control surface; its selection section is
  // only mounted by versions that own a real selection/add flow.
  return {
    playerShell: q('.player-shell'),
    searchPageSection: count('.search-page'),
    searchPageInert: document.querySelector('.search-page')?.hasAttribute('inert') ?? null,
    searchBox: q('input[aria-label="聚合搜索"]'),
    searchCategoryFilter: count('[data-search-category]'),
    dockSearchNavButton: [...document.querySelectorAll('.playlist-playback-nav button')].map(node => node.getAttribute('aria-label')).filter(Boolean),
    selectionDock: q('[aria-label="歌曲选择操作"]'),
    selectionActionLabels: [...document.querySelectorAll('.playlist-selection-action')].map(node => node.textContent.trim()),
    playlistFilterInput: count('.playlist-filter-input'),
    managementSelectButton: [...document.querySelectorAll('button')].some(node => ['选择', '取消选择'].includes(node.textContent.trim())),
    createPlaylistButton: [...document.querySelectorAll('button, [role="menuitem"]')].some(node => node.textContent.trim() === '新建播放列表'),
  };
})()`

try {
  const rows = []
  for (const version of versions.versions) {
    const port = portBase + rows.length
    // hold keeps the server up for the browser probe; stop() then guarantees no
    // orphan process survives this probe.
    const server = await startVersion({ path: version.path, port, quiet: true, hold: true })
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      await page.addInitScript(() => {
        // Start on the media library so the library routes render, and pin the
        // list layout so a measurement run is not shape-dependent between versions.
        localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
        localStorage.setItem('spmusic.playlist.layout-level.v1', '1')
        localStorage.setItem('spmusic.playlist-management.layout-level.v1', '1')
        localStorage.removeItem('spmusic.player.session.v1')
      })
      await page.goto(server.origin + '/', { waitUntil: 'load' })
      await page.waitForSelector('.player-shell', { timeout: 30_000 })
      await page.waitForTimeout(2500)
      const dom = await page.evaluate(probe)
      rows.push({ id: version.id, commit: version.commit, origin: server.origin, mainTsx: server.mainTsx.status, dom, pageErrors })
      await page.close()
      console.log(JSON.stringify({ id: version.id, ...dom }))
    } finally {
      const stopped = await server.stop()
      if (!stopped.stopped?.cleaned) throw new Error(`${version.id}: orphan node processes survived: ${JSON.stringify(stopped.orphans)}`)
    }
  }
  console.log('PROBE_RESULT ' + JSON.stringify(rows))
} finally {
  await browser.close()
}
