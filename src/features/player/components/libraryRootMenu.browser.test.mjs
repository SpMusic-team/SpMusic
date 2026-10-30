// Independent acceptance: real PlayerShell and menus, controlled native transport.
// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright installation.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match)
  return match[1]
}
const shared = readFileSync(new URL('./folderHierarchy.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal)
let fixture = runInNewContext(literal[1], { dependency })
fixture = fixture.replace("ReactDOM.createRoot(document.getElementById('root')).render(", `
const originalInvoke=window.backendInvoke;
window.backendInvoke=async(command,args)=>{
 if(command==='library_get_folders')return {revision:0,roots:[{path:'/music',selected:true,directoryRules:[]}]};
 if(command==='library_select_folders')return null;
 if(command==='audio_import_playlist')return null;
 return originalInvoke(command,args);
};
ReactDOM.createRoot(document.getElementById('root')).render(`)
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface}from '/__library_root_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;return React.createElement(RealSurface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__library_root_fixture.js"')
const directory = process.env.SPMUSIC_TEST_SCREENSHOTS || 'C:/Users/winkeses/.codex/tmp/library-root-menu-independent'
mkdirSync(directory, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const errors = [], evidence = []
async function open(query = '', width = 1280, height = 900) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('library-root-initialized')) {
      localStorage.clear()
      localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
      if (location.search.includes('legacy')) localStorage.setItem('spmusic.library.sidebar.folders-pinned.v1', '1')
      sessionStorage.setItem('library-root-initialized', '1')
    }
    if (location.search.includes('storageFailure')) {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('spmusic.library.sidebar.')) throw new Error('Controlled quota failure')
        return original.call(this, key, value)
      }
    }
  })
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__library_root_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__library_root_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__library_root_test*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__library_root_test' + query)
  await page.waitForFunction(() => window.vm?.playlist.library && !window.vm.playlist.library.isFolderRestorePending)
  return page
}
const common = ['选择文件夹', '重新扫描', '在侧栏置顶', '列表选项']
const cases = [
  ['songs', '所有歌曲', common], ['folder', '文件夹', common], ['folders', '文件夹层次结构', common],
  ['album', '专辑', common], ['artist', '艺术家', common], ['album-artist', '专辑艺术家', common],
  ['genre', '流派', common], ['year', '年份', common], ['composer', '作曲家', common],
  ['playlists', '播放列表', ['导出', '重新扫描/解析播放列表', '在侧栏置顶', '列表选项', '新增']],
  ['streams', '流', ['选择文件夹', '重新扫描', '添加地址', '在侧栏置顶', '列表选项']],
  ['queue', '队列', ['重新扫描', '重新排序', '在侧栏置顶', '列表选项', '清空队列']],
  ['bookmarks', '书签', ['选择文件夹', '重新扫描', '重新排序', '在侧栏置顶', '列表选项']],
  ['most-played', '最常播放', [...common, '查看全部', '清空']],
  ['highest-rated', '最高评级', common], ['lowest-rated', '最低评级', common],
  ['recent-played', '最近播放', [...common, '查看全部', '清空']],
  ['recent-added', '最近添加', [...common, '查看全部', '清空']], ['long-tracks', '长', common],
]
const select = async (page, id) => {
  await page.evaluate(id => window.vm.playlist.library.onSelectCategory(id), id)
  const label = cases.find(row => row[0] === id)[1]
  await page.getByRole('region', { name: id === 'folders' ? '文件夹层次结构' : label + '管理', exact: true }).waitFor()
}
const trigger = (page, id) => page.getByRole('button', { name: id === 'folders' ? '更多文件夹操作' : '更多列表操作', exact: true })
const sidebarOrder = page => page.locator('.playlist-library-sidebar:not([data-overlay]) .playlist-library-category').evaluateAll(nodes => nodes.map(node => node.dataset.categoryId))
const nativeCalls = page => page.evaluate(() => window.calls.map(row => row.command))
const settle = page => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame) })

try {
  const page = await open()
  for (const [id, label, labels] of cases) {
    await select(page, id)
    await trigger(page, id).click()
    const dialog = page.getByRole('dialog', { name: label, exact: true })
    await dialog.waitFor()
    assert.deepEqual(await dialog.locator('.folder-root-menu-action span').allTextContents(), labels, id + ' design action matrix')
    const geometry = await dialog.evaluate(node => {
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
      return { box: rect(node), category: rect(node.querySelector('.folder-root-menu-category')), rows: [...node.querySelectorAll('.folder-root-menu-action')].map(rect), images: [...node.querySelectorAll('img')].map(img => ({ src: new URL(img.src).pathname, complete: img.complete && img.naturalWidth > 0, box: rect(img) })), titleSize: getComputedStyle(node.querySelector('[data-slot="dialog-title"]')).fontSize }
    })
    assert.equal(geometry.box.width, 564, id + ' dialog width')
    assert(Math.abs(geometry.box.height - (504 + 90 * (labels.length - 4))) <= 2, id + ' dialog height: ' + geometry.box.height)
    assert.equal(geometry.category.width, 84)
    assert.equal(geometry.category.height, 84)
    assert.equal(geometry.titleSize, '32px')
    assert(geometry.rows.every(row => row.height === 48))
    assert(geometry.images.every(img => img.complete && img.box.width > 0 && img.box.height > 0), id + ' assets load')
    await dialog.screenshot({ path: directory + '/' + id + '.png' })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await trigger(page, id).evaluate(node => document.activeElement === node), true, id + ' Escape restores trigger focus')
    evidence.push({ scenario: 'category-design-' + id, labels, geometry })
  }

  // Every unavailable action is interactive and honest; none modifies native data.
  for (const [id, label, labels] of cases.filter(row => row[0] !== 'folders')) {
    await select(page, id)
    const placeholders = labels.filter(item => !['选择文件夹', '重新扫描', '在侧栏置顶'].includes(item))
    for (const item of placeholders) {
      await trigger(page, id).click()
      await page.getByRole('dialog', { name: label, exact: true }).getByRole('button', { name: item, exact: true }).click()
      const notice = page.getByRole('dialog', { name: item, exact: true })
      await notice.waitFor()
      assert.match(await notice.innerText(), /尚未接入/)
      await page.waitForFunction(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
      assert.equal(await page.getByRole('dialog').count(), 1, 'one focus trap during notice')
      if (item === '列表选项') {
        await notice.getByRole('button', { name: '返回更多操作', exact: true }).click()
        await page.getByRole('dialog', { name: label, exact: true }).waitFor()
        await page.keyboard.press('Escape')
      } else await notice.getByRole('button', { name: '知道了', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      assert.equal(await trigger(page, id).evaluate(node => document.activeElement === node), true, id + ' notice restores trigger focus')
    }
  }
  assert.equal((await nativeCalls(page)).includes('library_clear_folders'), false)
  evidence.push({ scenario: 'all-unavailable-actions-and-no-library-clear', passed: true })

  // Real category pin callback updates the same sidebar and survives reload.
  await select(page, 'artist')
  await trigger(page, 'artist').click()
  await page.getByRole('dialog', { name: '艺术家', exact: true }).getByRole('button', { name: '在侧栏置顶', exact: true }).click()
  await page.waitForFunction(() => window.vm.playlist.library.pinnedCategoryIds.includes('artist'))
  assert.equal((await sidebarOrder(page))[0], 'artist')
  await page.reload()
  await page.waitForFunction(() => window.vm?.playlist.library.pinnedCategoryIds.includes('artist'))
  await select(page, 'artist')
  await trigger(page, 'artist').click()
  await page.getByRole('dialog', { name: '艺术家', exact: true }).getByRole('button', { name: '取消侧栏置顶', exact: true }).click()
  assert.equal((await sidebarOrder(page))[0], 'songs')
  evidence.push({ scenario: 'category-pin-toggle-and-reload', passed: true })

  // Real editor handoff, return, and rescan transport without clearing or playing.
  await select(page, 'songs')
  await trigger(page, 'songs').click()
  await page.getByRole('dialog', { name: '所有歌曲', exact: true }).getByRole('button', { name: '选择文件夹', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '文件夹选择', exact: true })
  await editor.waitFor()
  assert.equal(await page.getByRole('dialog').count(), 1)
  await page.keyboard.press('Escape')
  await editor.waitFor({ state: 'hidden' })
  await page.evaluate(() => { window.calls = []; window.scanGate = true })
  await trigger(page, 'songs').click()
  await page.waitForFunction(() => document.activeElement?.textContent === '选择文件夹')
  await page.keyboard.press('Shift+Tab')
  await page.waitForFunction(() => document.activeElement?.textContent === '列表选项')
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => document.activeElement?.textContent === '选择文件夹')
  await page.getByRole('dialog', { name: '所有歌曲', exact: true }).getByRole('button', { name: '重新扫描', exact: true }).click()
  await page.waitForFunction(() => window.calls.some(row => row.command === 'library_scan_folder'))
  await trigger(page, 'songs').click()
  const busyDialog = page.getByRole('dialog', { name: '所有歌曲', exact: true })
  assert.equal(await busyDialog.getByRole('button', { name: '选择文件夹', exact: true }).isDisabled(), true)
  assert.equal(await busyDialog.getByRole('button', { name: '重新扫描', exact: true }).isDisabled(), true)
  assert.equal(await busyDialog.getByRole('button', { name: '列表选项', exact: true }).isEnabled(), true)
  await page.keyboard.press('Escape')
  await page.evaluate(() => { window.scanGate = false; window.pendingScans.splice(0).forEach(resolve => resolve()) })
  await page.waitForFunction(() => !window.vm.playlist.library.isFolderRescanPending)
  assert(!(await nativeCalls(page)).some(command => ['library_clear_folders', 'audio_load_and_play', 'audio_open_source'].includes(command)))
  evidence.push({ scenario: 'select-editor-handoff-rescan-busy-and-keyboard-focus-trap', passed: true })

  // Existing folder detail keeps its distinct artwork/title and disabled operations.
  await select(page, 'folders')
  await page.evaluate(() => window.vm.playlist.library.onFolderLocationChange({ rootPath: '/music', directoryPath: '/music' }))
  await page.locator('.folder-hierarchy-content .playlist-hero-actions').getByRole('button', { name: '更多文件夹操作' }).click()
  const detail = page.getByRole('dialog', { name: 'music', exact: true })
  await detail.waitFor()
  assert.equal(await detail.locator('.folder-detail-menu-artwork').count(), 1)
  assert.equal(await detail.getByRole('button', { name: '重新扫描', exact: true }).isDisabled(), true)
  await detail.screenshot({ path: directory + '/folder-detail-regression.png' })
  await page.keyboard.press('Escape')
  evidence.push({ scenario: 'existing-folder-detail-menu-regression', passed: true })
  await page.close()

  const legacy = await open('?legacy=1')
  await select(legacy, 'songs')
  assert.equal((await sidebarOrder(legacy))[0], 'folders')
  await legacy.close()
  const denied = await open('?storageFailure=1')
  await select(denied, 'album')
  await trigger(denied, 'album').click()
  await denied.getByRole('dialog', { name: '专辑', exact: true }).getByRole('button', { name: '在侧栏置顶', exact: true }).click()
  assert.equal((await sidebarOrder(denied))[0], 'album')
  await denied.close()
  evidence.push({ scenario: 'legacy-pin-and-storage-failure', passed: true })

  const narrow = await open('', 360, 480)
  await select(narrow, 'most-played')
  await trigger(narrow, 'most-played').click()
  const dialog = narrow.getByRole('dialog', { name: '最常播放', exact: true })
  const box = await dialog.boundingBox()
  assert(box.x >= 16 && box.y >= 16 && box.x + box.width <= 344 && box.y + box.height <= 464)
  await dialog.getByRole('button', { name: '清空', exact: true }).scrollIntoViewIfNeeded()
  assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth), true)
  await dialog.screenshot({ path: directory + '/narrow.png' })
  await narrow.keyboard.press('Escape')
  await settle(narrow)
  await narrow.close()
  evidence.push({ scenario: 'narrow-six-row-menu', passed: true, box })
  assert.deepEqual(errors, [])
  writeFileSync(directory + '/evidence.json', JSON.stringify({ pass: true, evidence, errors }, null, 2))
  console.log(JSON.stringify({ pass: true, cases: evidence.map(row => row.scenario), directory }))
} finally { await browser.close() }
