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
 if(command==='library_get_streams')return {directoryPath:'',directoryName:'流',sourceKind:'streams',sourcePath:'streams:library',sourceName:'流',selectedIndex:0,tracks:[]};
 if(command==='library_scan_folder')return {...await originalInvoke(command,args),directoryModifiedAtMs:{'/music':1000,'/music/Album':2000}};
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
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
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
  await page.goto(origin + '/__library_root_test' + query, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.vm?.playlist.library && !window.vm.playlist.library.isFolderRestorePending)
  return page
}
const common = ['选择文件夹', '重新扫描', '在侧栏置顶', '列表选项']
const cases = [
  ['songs', '所有歌曲', common], ['folder', '文件夹', common], ['folders', '文件夹层次结构', common],
  ['album', '专辑', common], ['artist', '艺术家', common], ['album-artist', '专辑艺术家', common],
  ['genre', '流派', ['选择文件夹', '重新扫描', '列表选项']], ['year', '年份', ['选择文件夹', '重新扫描', '列表选项']], ['composer', '作曲家', common],
  ['playlists', '播放列表', ['导入', '导出', '重新扫描/解析播放列表', '在侧栏置顶', '列表选项', '新增']],
  ['streams', '流', ['添加地址', '导入播放列表', '重新排序', '在侧栏置顶', '列表选项']],
  ['queue', '队列', ['重新扫描', '重新排序', '在侧栏置顶', '列表选项', '清空队列']],
  ['bookmarks', '书签', ['选择全部可见书签', '删除所选书签', '在侧栏置顶', '列表选项']],
  ['most-played', '最常播放', [...common, '查看全部', '清空']],
  ['highest-rated', '最高评级', common], ['lowest-rated', '最低评级', common],
  ['recent-played', '最近播放', [...common, '查看全部', '清空']],
  ['recent-added', '最近添加', [...common, '查看全部', '清空']], ['long-tracks', '长', common],
]
const songSorts = [
  '根据音轨号', '根据碟片和音轨号', '根据标题', '根据文件名', '根据路径', '根据艺术家', '根据专辑',
  '根据年份', '根据年份/专辑', '根据添加到媒体库的日期', '根据添加/修改日期', '根据星级',
  '根据持续时间', '根据最后播放的时间', '根据播放次数', '根据随机顺序',
]
const views = ['网格-紧凑一行', '紧凑单行', '单行', '列表-不显示图像', '列表-极小', '列表-小', '列表', '网格-极小', '网格-小', '网格']
const limits = ['200', '500', '1000', '无限制']
const byName = '根据名称', byArtist = '根据艺术家', byYear = '根据年份', byAdded = '根据添加到媒体库的日期'
const byModified = '根据添加/修改日期', byCount = '根据歌曲数量'
const groups = {
  songs: { '排序': songSorts, '布局': [], '查看方式': views },
  folder: { '排序': [byName, '根据路径（区分大小写）', '根据路径', byAdded, byModified, byCount], '布局': [], '查看方式': views },
  folders: { '布局': [], '查看方式': views },
  album: { '排序': [byName, byArtist, byYear, byAdded, byCount], '布局': [], '查看方式': views },
  artist: { '排序': [byName, byAdded, byCount], '查看方式': views },
  'album-artist': { '排序': [byName, byAdded], '查看方式': views },
  genre: { '排序': [byName, byAdded, byCount], '查看方式': views },
  year: { '排序': [byYear, byAdded, byCount], '查看方式': views },
  composer: { '排序': [byName, byAdded, byCount], '查看方式': views },
  playlists: { '排序': [byName, byAdded, byModified, byCount], '查看方式': views },
  streams: { '排序': ['根据URL', byAdded, '根据星级', '根据最后播放的时间', '根据播放次数', '根据随机顺序'], '布局': [], '查看方式': views },
  queue: { '布局': [], '查看方式': views },
  bookmarks: { '布局': [], '查看方式': views },
  'most-played': { '最大项目': limits, '排序': [], '布局': [], '查看方式': views },
  'highest-rated': { '最大项目': limits, '布局': [], '查看方式': views },
  'lowest-rated': { '最大项目': limits, '布局': [], '查看方式': views },
  'recent-played': { '最大项目': limits, '排序': songSorts, '布局': [], '查看方式': views },
  'recent-added': { '最大项目': limits, '排序': songSorts, '布局': [], '查看方式': views },
  'long-tracks': { '最短持续时间': [], '最大项目': limits, '排序': songSorts, '布局': [], '查看方式': views },
}
const select = async (page, id) => {
  await page.evaluate(id => window.vm.playlist.library.onSelectCategory(id), id)
  const label = cases.find(row => row[0] === id)[1]
  const collectionPage = ['folder', 'folders', 'bookmarks', 'album', 'artist', 'album-artist', 'genre', 'year', 'composer'].includes(id)
  await page.getByRole('region', { name: collectionPage ? label : label + '管理', exact: true }).waitFor()
}
const trigger = (page, id) => page.getByRole('button', { name: id === 'folders' ? '更多文件夹操作' : id === 'bookmarks' ? '更多书签操作' : '更多列表操作', exact: true })
const openOptions = async (page, id, action = '列表选项') => {
  const label = cases.find(row => row[0] === id)[1]
  await trigger(page, id).click()
  if (id === 'bookmarks') await page.getByRole('menu').getByRole('menuitem', { name: action, exact: true }).click()
  else await page.getByRole('dialog', { name: label, exact: true }).getByRole('button', { name: action, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '列表选项：' + label, exact: true })
  await dialog.waitFor()
  return dialog
}
const group = (dialog, label) => dialog.getByRole('group', { name: label, exact: true })
const radio = (dialog, section, label) => group(dialog, section).getByRole('radio', { name: label, exact: true })
const checkRadio = (dialog, section, label) => radio(dialog, section, label).check()
const checkbox = (dialog, label) => dialog.getByRole('checkbox', { name: label, exact: true })
const closeOptions = async (dialog) => {
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}
const sidebarOrder = page => page.locator('.playlist-library-sidebar:not([data-overlay]) .playlist-library-category').evaluateAll(nodes => nodes.map(node => node.dataset.categoryId))
const nativeCalls = page => page.evaluate(() => window.calls.map(row => row.command))
const settle = page => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame) })

try {
  const page = await open()
  for (const [id, label, labels] of cases) {
    await select(page, id)
    await trigger(page, id).click()
    const dialog = id === 'bookmarks' ? page.getByRole('menu') : page.getByRole('dialog', { name: label, exact: true })
    await dialog.waitFor()
    const actions = id === 'bookmarks' ? dialog.getByRole('menuitem') : dialog.locator('.folder-root-menu-action span')
    assert.deepEqual(await actions.allTextContents(), labels, id + ' design action matrix')
    const geometry = await dialog.evaluate(async node => {
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
      const category = node.querySelector('.folder-root-menu-category')
      const title = node.querySelector('[data-slot="dialog-title"]')
      const images = [...node.querySelectorAll('img')]
      await Promise.all(images.map(image => image.decode()))
      return { box: rect(node), category: category && rect(category), rows: [...node.querySelectorAll('.folder-root-menu-action')].map(rect), images: images.map(img => ({ src: new URL(img.src).pathname, complete: img.complete && img.naturalWidth > 0, box: rect(img) })), titleSize: title && getComputedStyle(title).fontSize }
    })
    if (id === 'bookmarks') assert(geometry.box.width > 0 && geometry.box.height > 0, 'bookmark dropdown has a visible box')
    else {
      assert.equal(geometry.box.width, 564, id + ' dialog width')
      assert(Math.abs(geometry.box.height - (504 + 90 * (labels.length - 4))) <= 2, id + ' dialog height: ' + geometry.box.height)
      assert.equal(geometry.category.width, 84)
      assert.equal(geometry.category.height, 84)
      assert.equal(geometry.titleSize, '32px')
      assert(geometry.rows.every(row => row.height === 48))
      assert(geometry.images.every(img => img.complete && img.box.width > 0 && img.box.height > 0), id + ' assets load')
    }
    await dialog.screenshot({ path: directory + '/' + id + '.png' })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await trigger(page, id).evaluate(node => document.activeElement === node), true, id + ' Escape restores trigger focus')
    const options = await openOptions(page, id)
    assert.equal(await page.getByRole('dialog').count(), 1, id + ' menu hands off to one dialog')
    assert.deepEqual(await options.locator('legend').allTextContents(), Object.keys(groups[id]), id + ' ordered option groups')
    for (const [name, expected] of Object.entries(groups[id])) {
      const controls = group(options, name)
      assert.deepEqual(await controls.locator('label:has(input[type=radio])').allTextContents(), expected, id + ' ' + name)
      for (const control of await controls.getByRole('radio').all()) assert.equal(await control.isEnabled(), true)
    }
    assert.equal(await checkbox(options, '倒序').count(), Number('排序' in groups[id]), id + ' reverse presence')
    assert.equal(await checkbox(options, '仅显示标题').count(), Number('布局' in groups[id]), id + ' title-only presence')
    assert.equal(await options.getByRole('slider').count(), Number(id === 'long-tracks'), id + ' duration slider presence')
    assert(await options.getByRole('button', { name: '媒体库设置', exact: true }).isEnabled())
    await options.getByText('可使用双指缩放切换', { exact: true }).waitFor()
    const sheet = await options.evaluate(async node => {
      const size = element => { const { width, height } = element.getBoundingClientRect(); return [width, height] }
      const images = [...node.querySelectorAll('img')]
      await Promise.all(images.map(image => image.decode()))
      return {
        size: size(node),
        gear: size(node.querySelector('.all-songs-options-header img')),
        hint: size(node.querySelector('.all-songs-options-view-hint img')),
        choices: [...node.querySelectorAll('.all-songs-options-radio img, .all-songs-options-checkbox img')].map(size),
      }
    })
    assert.equal(sheet.size[0], 615, id + ' list options sheet width')
    assert(sheet.size[1] <= 659, id + ' list options sheet respects maximum height')
    if (['folders', 'queue', 'bookmarks'].includes(id)) {
      assert(Math.abs(sheet.size[1] - 584) <= 2, id + ' compact options sheet height: ' + sheet.size[1])
    }
    assert.deepEqual(sheet.gear, [32, 32])
    assert.deepEqual(sheet.hint, [16, 16])
    assert(sheet.choices.every(([width, height]) => width === 24 && height === 24), id + ' option control sizes')
    if (['folders', 'long-tracks', 'bookmarks'].includes(id)) await options.screenshot({ path: directory + '/options-' + id + '.png' })
    await closeOptions(options)
    assert.equal(await trigger(page, id).evaluate(node => document.activeElement === node), true, id + ' options returns focus to More')
    evidence.push({ scenario: 'category-design-' + id, labels, geometry, sheet })
  }

  // Stream actions are now implemented and covered by streamsAcceptance; this
  // legacy placeholder check continues to cover the remaining categories.
  for (const [id, label, labels] of cases.filter(row => !['folders', 'streams', 'bookmarks'].includes(row[0]))) {
    await select(page, id)
    const placeholders = labels.filter(item => !['导入', '选择文件夹', '重新扫描', '在侧栏置顶', '列表选项'].includes(item)
      && !(id === 'most-played' && ['查看全部', '清空'].includes(item))
      && !(id === 'queue' && ['重新排序', '清空队列'].includes(item)))
    for (const item of placeholders) {
      await trigger(page, id).click()
      await page.getByRole('dialog', { name: label, exact: true }).getByRole('button', { name: item, exact: true }).click()
      const notice = page.getByRole('dialog', { name: item, exact: true })
      await notice.waitFor()
      assert.match(await notice.innerText(), /尚未接入/)
      await page.waitForFunction(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
      assert.equal(await page.getByRole('dialog').count(), 1, 'one focus trap during notice')
      await notice.getByRole('button', { name: '知道了', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      assert.equal(await trigger(page, id).evaluate(node => document.activeElement === node), true, id + ' notice restores trigger focus')
    }
  }
  assert.equal((await nativeCalls(page)).includes('library_clear_folders'), false)
  evidence.push({ scenario: 'all-unavailable-actions-and-no-library-clear', passed: true })

  // Use native folder scan data to verify effective order, missing values,
  // card geometry, title suppression, then isolate and reload the preferences.
  await select(page, 'folder')
  const flat = page.locator('.folder-hierarchy-content[data-folder-category="folder"]')
  const folderPaths = () => flat.locator('[data-folder-path]').evaluateAll(nodes => nodes.map(node => node.dataset.folderPath))
  for (const path of ['/music/Album', '/music/Album/Disc', '/music']) await flat.locator('[data-folder-path="' + path + '"]').waitFor()
  let options = await openOptions(page, 'folder')
  await checkRadio(options, '排序', byCount)
  await settle(page)
  assert.deepEqual(await folderPaths(), ['/music/Album', '/music/Album/Disc', '/music'], 'folder sort uses the number of member songs')
  await checkRadio(options, '排序', byModified)
  await settle(page)
  assert.deepEqual(await folderPaths(), ['/music', '/music/Album', '/music/Album/Disc'])
  await checkbox(options, '倒序').check()
  await settle(page)
  assert.deepEqual(await folderPaths(), ['/music/Album', '/music', '/music/Album/Disc'], 'unknown date stays after known folders when reversed')
  await checkRadio(options, '查看方式', '列表-极小')
  assert(await radio(options, '查看方式', '列表-极小').isChecked())
  await flat.locator('[data-folder-level="5"].folder-row .folder-parent-name').first().waitFor({ state: 'attached' })
  await checkbox(options, '仅显示标题').check()
  assert.equal(await flat.locator('.folder-parent-name').count(), 0)
  assert.equal(await flat.locator('.folder-meta').count(), 3, 'folder statistics remain available in title-only mode')
  await closeOptions(options)
  await select(page, 'folders')
  options = await openOptions(page, 'folders')
  assert.equal(await checkbox(options, '仅显示标题').isChecked(), false)
  assert(await radio(options, '查看方式', '列表-小').isChecked(), 'hierarchy retains its independent default')
  await options.getByRole('button', { name: '媒体库设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.waitFor()
  assert.equal(await page.getByRole('dialog').count(), 1)
  await settings.getByText('已选择 1 个文件夹', { exact: true }).waitFor()
  await page.waitForFunction(() => document.activeElement?.textContent === '歌曲文件夹')
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'hidden' })
  assert.equal(await trigger(page, 'folders').evaluate(node => document.activeElement === node), true)
  await page.reload()
  await page.waitForFunction(() => window.vm?.playlist.library && !window.vm.playlist.library.isFolderRestorePending)
  await select(page, 'folder')
  options = await openOptions(page, 'folder')
  assert(await radio(options, '排序', byModified).isChecked())
  assert(await radio(options, '查看方式', '列表-极小').isChecked())
  assert(await checkbox(options, '倒序').isChecked())
  assert(await checkbox(options, '仅显示标题').isChecked())
  await closeOptions(options)
  evidence.push({ scenario: 'folder-live-sort-layout-title-only-and-settings-with-isolated-reload', passed: true })

  await select(page, 'album')
  const albums = page.locator('.album-card .folder-name')
  await albums.filter({ hasText: 'Album root2' }).waitFor()
  const names = ['Album album', 'Album deep', 'Album root', 'Album root2']
  assert.deepEqual(await albums.allTextContents(), names)
  options = await openOptions(page, 'album')
  await checkbox(options, '倒序').check()
  await settle(page)
  assert.deepEqual(await albums.allTextContents(), [...names].reverse())
  await closeOptions(options)
  await select(page, 'long-tracks')
  await page.getByText('暂无符合时长的歌曲', { exact: true }).waitFor()
  options = await openOptions(page, 'long-tracks')
  const minimum = options.getByRole('slider', { name: '最短持续时间', exact: true })
  await minimum.press('Home')
  await checkRadio(options, '最大项目', '500')
  await checkRadio(options, '排序', '根据标题')
  await checkbox(options, '倒序').check()
  await closeOptions(options)
  const longTitles = page.locator('.all-songs-list .playlist-card-title')
  await longTitles.filter({ hasText: 'Title root2' }).waitFor()
  assert.deepEqual(await longTitles.allTextContents(), ['Title root2', 'Title root', 'Title deep', 'Title album'])
  await select(page, 'most-played')
  options = await openOptions(page, 'most-played')
  await checkRadio(options, '最大项目', '1000')
  await checkbox(options, '倒序').check()
  await closeOptions(options)
  await page.waitForFunction(() => window.vm.playlist.library.mostPlayedOptions?.limit === 1000 && window.vm.playlist.library.mostPlayedOptions?.direction === 'asc')
  await page.reload()
  await page.waitForFunction(() => window.vm?.playlist.library && !window.vm.playlist.library.isFolderRestorePending)
  await select(page, 'long-tracks')
  options = await openOptions(page, 'long-tracks')
  assert.equal(await options.getByRole('slider', { name: '最短持续时间' }).inputValue(), '60')
  assert(await radio(options, '最大项目', '500').isChecked())
  assert(await radio(options, '排序', '根据标题').isChecked())
  await closeOptions(options)
  await select(page, 'most-played')
  options = await openOptions(page, 'most-played')
  assert(await radio(options, '最大项目', '1000').isChecked())
  assert(await checkbox(options, '倒序').isChecked())
  await closeOptions(options)
  evidence.push({ scenario: 'album-and-long-songs-reorder-filter-and-per-root-limit-persistence', passed: true })

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
