// Independent acceptance test. Start Vite and set SPMUSIC_PLAYWRIGHT to an
// existing Playwright package; no project dependency is installed.
// The real app entry, PlayerShell, settings and localStorage are exercised.
// Only native audio transport is replaced, since Chromium has no Tauri host.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const key = 'spmusic.player.startup-page.v1'
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, `
    const convertFileSrc=path=>path;
    const invoke=async(command)=>{
      if(command==='audio_get_state')return {phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null};
      if(command==='audio_get_current_track'||command==='audio_get_output_info')return null;
      throw new Error('Unexpected native command '+command);
    };
  `)
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async()=>()=>{};')
assert(service.includes('Unexpected native command'), 'native transport replaced, command parsers retained')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const report = []

async function open(seed = null, readFailure = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.addInitScript(({ key, seed, readFailure }) => {
    // Seed only the first load: subsequent reloads must observe UI writes.
    if (!sessionStorage.getItem('startup-test-seeded')) {
      if (seed !== null) localStorage.setItem(key, seed)
      sessionStorage.setItem('startup-test-seeded', 'true')
    }
    window.startupTestWrites = []
    window.startupTestWriteFailure = false
    const read = Storage.prototype.getItem
    const write = Storage.prototype.setItem
    Storage.prototype.getItem = function (name) {
      if (this === localStorage && name === key && readFailure) throw new DOMException('Blocked test read', 'SecurityError')
      return read.call(this, name)
    }
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name === key) {
        window.startupTestWrites.push(value)
        if (window.startupTestWriteFailure) throw new DOMException('Full test store', 'QuotaExceededError')
      }
      return write.call(this, name, value)
    }
    window.startupTestFirstView = null
    const observer = new MutationObserver(() => {
      const shell = document.querySelector('.player-shell')
      if (!shell) return
      window.startupTestFirstView = shell.hasAttribute('data-library-overview') ? 'media-library' : 'player'
      observer.disconnect()
    })
    observer.observe(document, { childList: true, subtree: true })
  }, { key, seed, readFailure })
  await page.goto(origin)
  await page.locator('.player-shell').waitFor()
  return { page, errors }
}

const stored = page => page.evaluate(key => localStorage.getItem(key), key)
async function assertView(page, view) {
  await page.waitForFunction(view => {
    const shell = document.querySelector('.player-shell')
    return shell && shell.hasAttribute('data-library-overview') === (view === 'media-library')
  }, view)
  if (view === 'media-library') await page.getByRole('region', { name: '媒体库总览', includeHidden: true }).waitFor()
  else await page.locator('.empty-cover-state').waitFor({ state: 'visible' })
}
async function settings(page) {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const control = page.getByRole('combobox', { name: '启动页面', exact: true })
  await control.waitFor()
  return control
}
async function choose(page, text) {
  await page.getByRole('combobox', { name: '启动页面', exact: true }).click()
  await page.getByRole('option', { name: text, exact: true }).click()
}
async function closeSettings(page) {
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor({ state: 'hidden' })
}

try {
  for (const seed of [null, '', 'invalid', 'overview', '"media-library"', 'PLAYER']) {
    const { page, errors } = await open(seed)
    await assertView(page, 'player')
    assert.equal(await page.evaluate(() => window.startupTestFirstView), 'player', 'first committed view defaults to player')
    const control = await settings(page)
    assert.equal((await control.innerText()).trim(), '播放界面')
    assert.deepEqual(await page.evaluate(() => window.startupTestWrites), [], 'opening app/settings does not rewrite an absent or invalid preference')
    assert.deepEqual(errors, [])
    await page.close()
  }
  report.push('missing and five invalid values: first render and settings default to player; no implicit storage writes')

  const { page, errors } = await open()
  let control = await settings(page)
  assert.equal(await control.getAttribute('aria-describedby'), 'startup-page-description')
  assert.equal(await page.locator('#startup-page-description').innerText(), '下次打开应用时生效。')
  await choose(page, '媒体库')
  assert.equal(await stored(page), 'media-library')
  await assertView(page, 'player')
  await closeSettings(page)
  control = await settings(page)
  assert.equal((await control.innerText()).trim(), '媒体库', 'closing/reopening settings retains selection')
  await closeSettings(page)
  await page.reload()
  await assertView(page, 'media-library')
  assert.equal(await page.evaluate(() => window.startupTestFirstView), 'media-library', 'saved library choice is honored on first render')
  control = await settings(page)
  assert.equal((await control.innerText()).trim(), '媒体库')
  // Verify the labeled control supports keyboard selection as well as clicks.
  await control.focus()
  await page.keyboard.press('ArrowUp')
  await page.getByRole('option', { name: '播放界面', exact: true }).waitFor()
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  assert.equal(await stored(page), 'player')
  await assertView(page, 'media-library')
  await closeSettings(page)
  await page.reload()
  await assertView(page, 'player')
  assert.equal(await page.evaluate(() => window.startupTestFirstView), 'player')
  assert.deepEqual(errors, [])
  await page.close()
  report.push('both choices persist across reload; changing preference preserves the current page; settings reopen and keyboard access pass')

  const navigation = await open('media-library')
  await assertView(navigation.page, 'media-library')
  await navigation.page.getByRole('button', { name: '更多媒体库操作' }).click()
  await navigation.page.getByRole('menuitem', { name: '打开播放界面', exact: true }).click()
  await assertView(navigation.page, 'player')
  await navigation.page.getByRole('button', { name: '播放列表', exact: true }).first().click()
  await navigation.page.getByRole('button', { name: '返回播放列表管理', exact: true }).waitFor()
  assert.equal(await stored(navigation.page), 'media-library')
  assert.deepEqual(await navigation.page.evaluate(() => window.startupTestWrites), [], 'ordinary navigation does not save startup preference')
  await navigation.page.reload()
  await assertView(navigation.page, 'media-library')
  assert.deepEqual(navigation.errors, [])
  await navigation.page.close()
  report.push('media library → player → playlist navigation works and does not overwrite startup preference')

  const blockedRead = await open('media-library', true)
  await assertView(blockedRead.page, 'player')
  assert.equal((await (await settings(blockedRead.page)).innerText()).trim(), '播放界面')
  assert.deepEqual(blockedRead.errors, [])
  await blockedRead.page.close()
  report.push('SecurityError reading the startup preference safely falls back to player')

  const blockedWrite = await open('player')
  await settings(blockedWrite.page)
  await blockedWrite.page.evaluate(() => { window.startupTestWriteFailure = true })
  await choose(blockedWrite.page, '媒体库')
  assert.equal(await stored(blockedWrite.page), 'player', 'failed storage write leaves the previous durable preference')
  await assertView(blockedWrite.page, 'player')
  await closeSettings(blockedWrite.page)
  assert.equal((await (await settings(blockedWrite.page)).innerText()).trim(), '媒体库', 'write failure does not interrupt the in-session selection')
  await blockedWrite.page.reload()
  await assertView(blockedWrite.page, 'player')
  assert.deepEqual(blockedWrite.errors, [])
  await blockedWrite.page.close()
  report.push('QuotaExceededError does not crash settings; durable preference remains unchanged and reload honors it')
  console.log(JSON.stringify({ passed: true, report }, null, 2))
} finally {
  await browser.close()
}
