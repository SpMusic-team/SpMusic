// Reachability check for the add affordance: navigates the real UI into the
// "所有歌曲" category and reports whether the selection entry point and the
// playlist-add action exist. No backend is faked, so the lists are empty; only
// the controls' presence is claimed, never their enabled state.
import { startVersion } from './run-version.mjs'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const manifest = JSON.parse(readFileSync(new URL('../../../.codex-tmp-folder-ui-dist/perf-versions/manifest.json', import.meta.url), 'utf8'))
const portBase = Number(process.env.PERF_VERSION_PORT_BASE || 5360)
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })

// Clicks the real "所有歌曲" category entry, then reports the controls that the
// version's own code renders for that page.
const probe = `(async () => {
  const text = node => (node.textContent || '').trim();
  const buttons = () => [...document.querySelectorAll('button')];
  const clickable = label => buttons().find(node => text(node) === label || node.getAttribute('aria-label') === label);
  const songsEntry = clickable('所有歌曲') || clickable('打开所有歌曲');
  if (songsEntry) songsEntry.click();
  await new Promise(accept => setTimeout(accept, 1200));
  const selectEntry = clickable('选择');
  if (selectEntry) { selectEntry.click(); await new Promise(accept => setTimeout(accept, 700)); }
  return {
    clickedSongsCategory: Boolean(songsEntry),
    clickedSelect: Boolean(selectEntry),
    selectEntryPresent: Boolean(selectEntry),
    selectModeToggleText: ['选择', '取消选择', '完成'].filter(label => Boolean(clickable(label))),
    selectionDock: document.querySelector('[aria-label="歌曲选择操作"]') !== null,
    selectionActionLabels: [...document.querySelectorAll('.playlist-selection-action')].map(text),
    addToPlaylistPicker: document.querySelector('[aria-label="可添加的播放列表"]') !== null,
    createPlaylistButtons: buttons().filter(node => text(node) === '新建播放列表').length,
    addMenuItem: [...document.querySelectorAll('[role="menuitem"]')].map(text),
    dockNavLabels: [...document.querySelectorAll('.playlist-playback-nav button')].map(node => node.getAttribute('aria-label')).filter(Boolean),
  };
})()`

try {
  const rows = []
  for (const version of manifest.versions) {
    const port = portBase + rows.length
    const server = await startVersion({ path: version.path, port, quiet: true, hold: true })
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      await page.addInitScript(() => {
        localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
        localStorage.setItem('spmusic.playlist.layout-level.v1', '1')
        localStorage.setItem('spmusic.playlist-management.layout-level.v1', '1')
        localStorage.removeItem('spmusic.player.session.v1')
      })
      await page.goto(server.origin + '/', { waitUntil: 'load' })
      await page.waitForSelector('.player-shell', { timeout: 30_000 })
      await page.waitForTimeout(2000)
      const dom = await page.evaluate(probe)
      rows.push({ id: version.id, ...dom, pageErrors })
      console.log(JSON.stringify({ id: version.id, ...dom }))
      await page.close()
    } finally {
      const stopped = await server.stop()
      if (!stopped.stopped?.cleaned) throw new Error(`${version.id}: orphans survived`)
    }
  }
  console.log('ADD_PROBE_RESULT ' + JSON.stringify(rows))
} finally {
  await browser.close()
}
