// Vite + existing Playwright. Real React state and IPC parser; only native IO is deterministic.
// Rust addition_ tests independently verify the real persisted registry boundary.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const evidenceDirectory = join(tmpdir(), 'spmusic-selection-add-verification')
mkdirSync(evidenceDirectory, { recursive: true })
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const dependency = name => {
  const match = (entry + realSurface).match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const shared = readFileSync(new URL('./allSongs.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal)
let fixture = runInNewContext(literal[1], { dependency }).replaceAll('/audio/common/shared.flac', '/audio/a/shared.flac')
fixture = fixture.replace('React.createElement(PlayerShell)', 'React.createElement(ThemeProbe)')
fixture += `
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
function ThemeProbe(){const theme=useAppearance();window.themeApi=theme;return React.createElement(PlayerShell)}
`
const marker = "ReactDOM.createRoot(document.getElementById('root')).render("
assert(fixture.includes(marker))
fixture = fixture.replace(marker, `
window.addFailures=[];window.addError=false;window.addGate=false;window.addResolvers=[];window.loadGate=false;window.loadResolvers=[];window.fileDeletes=[];
window.persistedPlaylists=(window.seedTargets??['a','b','c']).map(choice=>{window.choice=choice;window.playlistImport=true;return playlist()});
window.choice='a';window.playlistImport=false;
window.folderSettings={revision:0,roots:[]};
const originalInvoke=window.backendInvoke;
window.backendInvoke=async(command,args)=>{
 if(command==='audio_load_and_play'&&window.loadGate)await new Promise(resolve=>window.loadResolvers.push(resolve));
 if(command==='library_get_playlists')return window.persistedPlaylists;
 if(command==='library_get_folders')return structuredClone(window.folderSettings);
 if(command==='library_replace_folders'){
   if(args.input.expectedRevision!==window.folderSettings.revision)throw {code:'LIBRARY_SETTINGS_CONFLICT',message:'fixture revision conflict'};
   window.folderSettings={revision:window.folderSettings.revision+1,roots:structuredClone(args.input.roots)};
   return structuredClone(window.folderSettings);
 }
 if(command==='library_delete_tracks'){
   const input=args.input;window.calls.push({command,input});
   if(input.mode!=='list'){window.fileDeletes.push(input);throw Error('switch must never delete files');}
   const selected=new Set(input.trackPaths);const target=window.persistedPlaylists.find(item=>item.sourcePath===input.sourcePath);
   if(!target)throw {code:'INVALID_PATH',message:'fixture unknown target'};
   const removedPaths=target.tracks.filter(item=>selected.has(item.sourcePath)).map(item=>item.sourcePath);
   const next={...target,tracks:target.tracks.filter(item=>!selected.has(item.sourcePath)),selectedIndex:0};
   window.persistedPlaylists=window.persistedPlaylists.map(item=>item===target?next:item);
   return {removedPaths,failures:[],playlists:window.persistedPlaylists,state:null,storageError:null};
 }
 if(command!=='library_add_playlist_tracks')return originalInvoke(command,args);
 const input=args.input;window.calls.push({command,input});
 if(window.addGate)await new Promise(resolve=>window.addResolvers.push(resolve));
 if(window.addError)throw {code:'LIBRARY_STORAGE_ERROR',message:'fixture atomic write failed'};
 const target=window.persistedPlaylists.find(item=>item.sourcePath===input.sourcePath);
 if(!target)throw {code:'INVALID_PATH',message:'fixture unknown target'};
 const existing=new Set(target.tracks.map(item=>item.sourcePath));
 const failures=input.trackPaths.filter(path=>window.addFailures.includes(path)).map(sourcePath=>({sourcePath,code:'UNKNOWN_TRACK',message:'fixture rejected source'}));
 const accepted=[...new Set(input.trackPaths)].filter(path=>!window.addFailures.includes(path));
 const alreadyPresentPaths=accepted.filter(path=>existing.has(path));
 const addedPaths=accepted.filter(path=>!existing.has(path));
 const added=addedPaths.map(path=>({...byPath.get(path)}));
 const tracks=input.position==='start'?[...added,...target.tracks]:input.position==='random'?[...target.tracks.slice(0,1),...added,...target.tracks.slice(1)]:[...target.tracks,...added];
 const next={...target,tracks};
 window.persistedPlaylists=window.persistedPlaylists.map(item=>item===target?next:item);
 return {playlist:next,addedPaths,alreadyPresentPaths,failures};
};
${marker}`)
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const surface = `
import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__selection_add_surface.js';
window.artworkMeter={retains:0,releases:0,subscribes:0,unsubscribes:0};const stores=new WeakSet();
function observe(source){const store=source?.store;if(!store||stores.has(store))return;stores.add(store);
 const retain=store.retain;store.retain=(...args)=>{window.artworkMeter.retains++;const release=retain(...args);return()=>{window.artworkMeter.releases++;release()}};
 const subscribe=store.subscribe;store.subscribe=(...args)=>{window.artworkMeter.subscribes++;const unsubscribe=subscribe(...args);return()=>{window.artworkMeter.unsubscribes++;unsubscribe()}};
}
export function PlayerSurface(props){window.viewModel=props.viewModel;observe(props.viewModel.playlist.artworkSource);observe(props.viewModel.playlist.fallbackArtworkSource);return React.createElement(Surface,props)}
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__selection_add_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
let passed = 0

async function open({ width = 1280, targets = ['a', 'b', 'c'], kind = 'playlist', sourcePlaylist = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(targets => {
    window.seedTargets = targets
    localStorage.setItem('spmusic.playlist.layout-level.v1', '4')
    localStorage.setItem('spmusic.all-songs.layout-level.v1', '4')
  }, targets)
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__selection_add_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__selection_add_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__selection_add_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__selection_add_test')
  await page.waitForFunction(() => Boolean(window.viewModel?.folderSelection?.committed && window.themeApi) && !window.viewModel.playlist.library.isPlaylistRestorePending)
  if (!sourcePlaylist) {
    await addFolder(page, '/audio/a')
    await page.waitForFunction(() => !window.viewModel.playlist.library.isImportPending)
  }
  await page.evaluate(({ kind, sourcePlaylist }) => {
    if (kind === 'songs') window.viewModel.playlist.library.onSelectCategory('songs')
    else window.viewModel.playlist.library.onSelect(window.viewModel.playlist.library.items.find(item => sourcePlaylist ? item.name === 'List a' : item.sourceKind === 'folder').scope)
  }, { kind, sourcePlaylist })
  const grid = page.locator(kind === 'songs' ? '.all-songs-list' : '.playlist-grid:not(.all-songs-list)')
  await grid.locator('.playlist-card').first().waitFor()
  await page.getByRole('button', { name: '选择', exact: true }).first().click()
  return { page, grid, errors }
}
async function addFolder(page, path) {
  await page.evaluate(async path => {
    const editor = window.viewModel.folderSelection
    const committed = editor.committed
    await editor.onSave({ expectedRevision: committed.revision,
      roots: [...committed.roots, { path, selected: true, directoryRules: [] }] })
  }, path)
}
const dock = page => page.locator('.playlist-playback-dock:not([data-dock-superseded])')
const calls = page => page.evaluate(() => window.calls.filter(call => call.command === 'library_add_playlist_tracks'))
const targets = page => page.locator('.playlist-add-row')
const target = (page, label) => targets(page).filter({ hasText: label })
async function choose(context, indices = [0, 1]) {
  for (const index of indices) await context.grid.locator('.playlist-card').nth(index).click()
}
async function begin(context) {
  await dock(context.page).getByRole('button', { name: '播放列表', exact: true }).click()
  const dialog = context.page.getByRole('dialog', { name: '播放列表', exact: true })
  await dialog.waitFor()
  return dialog
}
async function chooseMode(context, mode) {
  await context.page.locator('.playlist-add-tools button').nth(3).click()
  await context.page.getByRole('button', { name: mode === 'multi' ? '添加到多个播放列表' : mode === 'single' ? '添加到单个播放列表' : '切换', exact: true }).click()
}
async function choosePosition(context, position) {
  await context.page.locator('.playlist-add-tools button').nth(2).click()
  await context.page.getByRole('button', { name: position === 'start' ? '在开头插入' : position === 'end' ? '添加到末尾' : '随机', exact: true }).click()
}
async function check(name, options, run) {
  if (process.env.SPMUSIC_ADD_FILTER && !name.includes(process.env.SPMUSIC_ADD_FILTER)) return
  const context = await open(options)
  try { await run(context); assert.deepEqual(context.errors, []); passed++; console.log('PASS', name) }
  finally { await context.page.close() }
}

try {
  await check('Figma bottom geometry, assets and membership states', {}, async context => {
    await choose(context)
    const dialog = await begin(context)
    for (const [name, size] of Object.entries({ 'add.svg': 32, 'sort.svg': 32, 'ascending.svg': 32, 'check-circle.svg': 32, 'checked.svg': 48,
      'insert-end.svg':32, 'insert-random.svg':32, 'insert-start.svg':32, 'menu-check.svg':32, 'mode-multiple.svg':32, 'mode-single.svg':32,
      'mode-switch.svg':32, 'multiple-added.svg':48, 'sort-library-date.svg':32, 'sort-modified.svg':32, 'sort-name.svg':32 })) {
      const asset = readFileSync(new URL('../../../assets/selection-panel/playlist-add/' + name, import.meta.url), 'utf8')
      const root = asset.match(/<svg\b[^>]*>/)?.[0]
      assert(asset.length > 100 && root?.includes(`width="${size}"`) && root.includes(`height="${size}"`), name + ' retains Figma root dimensions')
    }
    const trackIcon = readFileSync(new URL('../../../assets/selection-panel/playlist-add/sort-track.svg', import.meta.url), 'utf8').match(/<svg\b[^>]*>/)?.[0]
    assert(trackIcon?.includes('width="22.6667"') && trackIcon.includes('height="26.6667"'), 'track icon retains its non-square root')
    const geometry = await dialog.evaluate(element => {
      const box = element.getBoundingClientRect(), panel = element.closest('.playlist-selection-panel'), dock = panel.closest('.playlist-playback-dock')
      const rect = element => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height } }
      return { width: box.width, height: box.height, bottom: box.bottom, dockBottom: dock.getBoundingClientRect().bottom,
        headerHeight: element.querySelector('.playlist-add-header').getBoundingClientRect().height,
        firstCoverTop: element.querySelector('.playlist-add-cover').getBoundingClientRect().top - box.top,
        icons: [...element.querySelectorAll('.playlist-selection-icon')].map(rect),
        rows: [...element.querySelectorAll('.playlist-add-row')].map(rect), covers: [...element.querySelectorAll('.playlist-add-cover')].map(rect),
        circles: [...element.querySelectorAll('.playlist-add-empty-circle')].map(rect) }
    })
    assert.equal(geometry.width, 615)
    assert.equal(geometry.height, 909)
    assert.equal(geometry.bottom, geometry.dockBottom)
    assert.equal(geometry.headerHeight, 60)
    assert.equal(geometry.firstCoverTop, 100)
    assert(geometry.rows.every(row => row.height === 88))
    assert.deepEqual(geometry.icons.slice(0, 4), Array.from({ length: 4 }, () => ({ width: 32, height: 32 })))
    assert.deepEqual(geometry.icons.slice(4), [{ width: 48, height: 48 }])
    assert.deepEqual(geometry.covers, Array.from({ length: 3 }, () => ({ width: 93, height: 64 })))
    assert.deepEqual(geometry.circles, Array.from({ length: 2 }, () => ({ width: 40, height: 40 })))
    assert.equal(await target(context.page, 'List a').getAttribute('aria-pressed'), 'true')
    assert.equal(await target(context.page, 'List b').getAttribute('aria-pressed'), 'false')
    assert.equal(await target(context.page, 'List c').getAttribute('aria-pressed'), 'false')
    await context.page.screenshot({ path: join(evidenceDirectory, 'add-default.png') })
    writeFileSync(join(evidenceDirectory, 'geometry.json'), JSON.stringify(geometry, null, 2))
    await context.page.setViewportSize({ width: 640, height: 900 })
    await context.page.evaluate(() => { const theme = structuredClone(window.themeApi.appearance); theme.typography.fontScale = 1.4; window.themeApi.previewAppearance(theme) })
    const overflow = await dialog.evaluate(element => {
      const box = element.getBoundingClientRect()
      return [...element.querySelectorAll('button')].filter(button => { const rect = button.getBoundingClientRect(); return rect.left < box.left - .5 || rect.right > box.right + .5 || rect.bottom > box.bottom + .5 || button.scrollWidth > button.clientWidth + 1 }).map(button => button.textContent || button.getAttribute('aria-label'))
    })
    assert.deepEqual(overflow, [])
    assert((await dialog.boundingBox()).y >= 40, 'the sheet stays below the native title bar')
    await context.page.screenshot({ path: join(evidenceDirectory, 'add-font140-640.png') })
  })
  await check('already present is idempotent and cancel sends no mutation', {}, async context => {
    await choose(context)
    const dialog = await begin(context)
    await chooseMode(context, 'multi')
    assert(await target(context.page, 'List a').locator('.playlist-selection-icon').evaluate(async element => {
      const source=(await import('/src/assets/selection-panel/playlist-add/multiple-added.svg?import')).default
      return getComputedStyle(element).maskImage.includes(source)
    }), 'multiple mode uses the supplied plus-circle asset')
    const iconBox = await target(context.page, 'List a').locator('.playlist-selection-icon').boundingBox()
    assert.equal(iconBox.width,48)
    assert.equal(iconBox.height,48)
    await context.page.screenshot({path:join(evidenceDirectory,'mode-multiple-selected.png')})
    await target(context.page, 'List a').evaluate(button => button.click())
    assert.equal((await calls(context.page)).length, 0)
    await context.page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal((await calls(context.page)).length, 0)
    assert.equal(await context.grid.locator('[data-selected="true"]').count(), 2)
  })
  await check('mixed membership adds missing songs once to multiple targets', {}, async context => {
    await choose(context)
    const dialog = await begin(context)
    await target(context.page, 'List b').click()
    await context.page.waitForFunction(() => window.persistedPlaylists.find(item => item.sourcePath === '/lists/b.m3u8').tracks.length === 3)
    await target(context.page, 'List c').click()
    await context.page.waitForFunction(() => window.persistedPlaylists.find(item => item.sourcePath === '/lists/c.m3u8').tracks.length === 3)
    assert.equal(await target(context.page, 'List b').getAttribute('aria-pressed'), 'true')
    assert.equal(await target(context.page, 'List c').getAttribute('aria-pressed'), 'true')
    const records = await calls(context.page)
    assert.equal(records.length, 2)
    assert.deepEqual(records[0].input, { sourcePath: '/lists/b.m3u8', trackPaths: ['/audio/a/0.flac', '/audio/a/shared.flac'], position: 'start' })
    assert.equal(new Set(await context.page.evaluate(() => window.persistedPlaylists.find(item => item.sourcePath === '/lists/b.m3u8').tracks.map(item => item.sourcePath))).size, 3)
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
    await context.page.locator('.playlist-selection-completed').filter({ hasText: '已添加' }).waitFor()
    await context.page.getByRole('button', { name: '打开', exact: true }).click()
    await context.page.waitForFunction(() => window.viewModel.playlist.library.currentScope?.includes('/lists/c.m3u8'))
  })
  await check('frozen selection and busy lock produce one exact append', {}, async context => {
    await choose(context, [0])
    const dialog = await begin(context)
    await context.page.evaluate(() => { window.addGate = true })
    await context.grid.locator('.playlist-card').nth(1).evaluate(button => button.click())
    await target(context.page, 'List c').evaluate(button => { button.click(); button.click() })
    await context.page.waitForFunction(() => window.addResolvers.length === 1)
    assert.equal((await calls(context.page)).length, 1)
    assert.deepEqual((await calls(context.page))[0].input.trackPaths, ['/audio/a/0.flac'])
    await context.page.keyboard.press('Escape')
    assert.equal(await dialog.isVisible(), true)
    await context.page.evaluate(() => { window.addGate = false; window.addResolvers.splice(0).forEach(resolve => resolve()) })
    await context.page.waitForFunction(() => window.persistedPlaylists.find(item => item.sourcePath === '/lists/c.m3u8').tracks.length === 2)
    await context.page.waitForFunction(() => [...document.querySelectorAll('.playlist-add-row')].some(row => row.dataset.targetScope.includes('/lists/c.m3u8') && row.getAttribute('aria-pressed') === 'true'))
    assert.equal(await target(context.page, 'List c').getAttribute('aria-pressed'), 'true', 'membership refresh uses frozen selection')
  })
  await check('partial failure remains retryable and never pretends full membership', {}, async context => {
    await choose(context)
    const dialog = await begin(context)
    await context.page.evaluate(() => { window.addFailures = ['/audio/a/shared.flac'] })
    await target(context.page, 'List c').click()
    await dialog.getByRole('alert').filter({ hasText: 'fixture rejected source' }).waitFor()
    assert.equal(await target(context.page, 'List c').getAttribute('aria-pressed'), 'false')
    assert.equal(await context.page.locator('.playlist-selection-completed').count(), 0)
    await context.page.evaluate(() => { window.addFailures = [] })
    await target(context.page, 'List c').click()
    await context.page.waitForFunction(() => window.persistedPlaylists.find(item => item.sourcePath === '/lists/c.m3u8').tracks.length === 3)
    assert.equal(await target(context.page, 'List c').getAttribute('aria-pressed'), 'true')
  })
  await check('atomic storage error preserves target and shows no added completion', {}, async context => {
    await choose(context)
    const dialog = await begin(context)
    await context.page.evaluate(() => { window.addError = true })
    await target(context.page, 'List c').click()
    await dialog.getByRole('alert').filter({ hasText: 'fixture atomic write failed' }).waitFor()
    assert.equal(await target(context.page, 'List c').getAttribute('aria-pressed'), 'false')
    assert.equal(await context.page.evaluate(() => window.persistedPlaylists.find(item => item.sourcePath === '/lists/c.m3u8').tracks.length), 1)
    assert.equal(await context.page.locator('.playlist-selection-completed').count(), 0)
  })
  await check('adding relationships preserves live playback identity and independent queue', {}, async context => {
    await context.page.evaluate(() => window.viewModel.playlist.library.onPlay(window.viewModel.playlist.library.items.find(item => item.sourceKind === 'folder').scope))
    await context.page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isSelectionPending && !window.viewModel.playback.isAudioBusy)
    const before = await context.page.evaluate(() => ({ loads: window.calls.filter(call => ['audio_load_file', 'audio_load_and_play'].includes(call.command)).length,
      trackId: window.viewModel.playback.track.id, queue: window.viewModel.queue.tracks.map(item => item.id) }))
    await choose(context)
    await begin(context)
    await target(context.page, 'List b').click()
    await context.page.waitForFunction(() => window.persistedPlaylists.find(item => item.sourcePath === '/lists/b.m3u8').tracks.length === 3)
    const after = await context.page.evaluate(() => ({ loads: window.calls.filter(call => ['audio_load_file', 'audio_load_and_play'].includes(call.command)).length,
      trackId: window.viewModel.playback.track.id, queue: window.viewModel.queue.tracks.map(item => item.id) }))
    assert.deepEqual(after, before)
  })
  await check('sorting menu uses the designed choices and changes only the displayed target order', { targets: ['c', 'a', 'b'] }, async context => {
    await choose(context)
    await begin(context)
    await context.page.locator('.playlist-add-tools button').nth(1).click()
    for (const name of ['根据名称', '根据添加到媒体库的日期', '根据添加/修改日期', '根据音轨号']) {
      await context.page.getByRole('button', { name, exact: true }).waitFor()
    }
    await context.page.getByRole('button', { name: '根据名称', exact: true }).click()
    assert.deepEqual(await targets(context.page).locator('.playlist-add-name').allTextContents(), ['List a', 'List b', 'List c'])
    assert.equal((await calls(context.page)).length, 0)
  })
  await check('all songs can create a real custom target from an empty picker and open it', { kind: 'songs', targets: [] }, async context => {
    assert.equal(await dock(context.page).getByRole('button', { name: '播放列表', exact: true }).isDisabled(), true)
    await choose(context)
    let dialog = await begin(context)
    assert.equal(await targets(context.page).count(), 0)
    assert.match(await dialog.textContent(), /暂无播放列表/)
    await dialog.getByRole('button', { name: '新增播放列表', exact: true }).click()
    const form = context.page.getByRole('dialog', { name: '新增播放列表', exact: true })
    assert.equal(await form.getByLabel('播放列表名称', { exact: true }).inputValue(), 'A Song')
    const geometry = await form.boundingBox()
    assert.equal(geometry.width, 566)
    assert.equal(geometry.height, 333)
    await form.getByLabel('播放列表名称', { exact: true }).fill('Created from frozen songs')
    await form.getByRole('button', { name: '确定', exact: true }).click()
    dialog = context.page.getByRole('dialog', { name: '播放列表', exact: true })
    await target(context.page, 'Created from frozen songs').waitFor()
    assert.equal(await target(context.page, 'Created from frozen songs').getAttribute('aria-pressed'), 'true')
    const items = await context.page.evaluate(() => window.viewModel.playlist.library.items)
    const created = items.find(item => item.sourceKind === 'custom')
    assert.equal(created.trackCount, 2)
    assert.equal(items.find(item => item.sourceKind === 'folder').trackCount, 2)
    assert.equal((await calls(context.page)).length, 0)
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
    await context.page.locator('.playlist-selection-completed').filter({ hasText: '已添加' }).waitFor()
    await context.page.getByRole('button', { name: '打开', exact: true }).click()
    await context.page.waitForFunction(scope => window.viewModel.playlist.library.currentScope === scope, created.scope)
  })
  await check('custom source append updates saved origin without changing its captured live queue', { kind: 'songs' }, async context => {
    const customScope = await context.page.evaluate(() => window.viewModel.playlist.library.onCreatePlaylist('Live source', ['/audio/a/0.flac']))
    assert(customScope)
    await addFolder(context.page, '/audio/b')
    await context.page.waitForFunction(() => !window.viewModel.playlist.library.isImportPending && window.viewModel.playlist.library.allSongs.length === 3)
    await context.page.evaluate(scope => window.viewModel.playlist.library.onPlay(scope), customScope)
    await context.page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isSelectionPending && !window.viewModel.playback.isAudioBusy)
    const before = await context.page.evaluate(() => ({ track: window.viewModel.playback.track.id, queue: window.viewModel.queue.tracks.map(item => item.id) }))
    await choose(context, [1]) // B Song is not yet a member of the one-song custom source.
    await begin(context)
    await target(context.page, 'Live source').click()
    await context.page.waitForFunction(scope => window.viewModel.playlist.library.items.find(item => item.scope === scope)?.trackCount === 2, customScope)
    const state = await context.page.evaluate(() => ({ track: window.viewModel.playback.track.id, queue: window.viewModel.queue.tracks.map(item => item.id),
      saved: JSON.parse(localStorage.getItem('spmusic.player.session.v1')) }))
    assert.deepEqual({ track: state.track, queue: state.queue }, before)
    assert.equal(state.saved.playlist.customPlaylist.tracks.length, 1, 'the independent playback queue remains a captured queue')
    assert.deepEqual(state.saved.playlist.customPlaylist.playbackQueue.sourcePlaylist.tracks.map(item => item.sourcePath), ['/audio/b/0.flac', '/audio/a/0.flac'], 'the updated source obeys the new default start insertion')
    assert.equal((await calls(context.page)).length, 0, 'custom relationship writes stay in the current session')
  })
  await check('pending audio selection cannot activate an old descriptor over a new append', {}, async context => {
    await choose(context)
    await context.page.evaluate(() => {
      window.loadGate = true
      window.viewModel.playlist.library.onPlay(window.viewModel.playlist.library.items.find(item => item.sourceKind === 'folder').scope)
    })
    await context.page.waitForFunction(() => window.loadResolvers.length === 1)
    await dock(context.page).getByRole('button', { name: '播放列表', exact: true }).evaluate(button => button.click())
    assert.equal(await context.page.getByRole('dialog', { name: '播放列表', exact: true }).count(), 0)
    assert.equal((await calls(context.page)).length, 0)
    await context.page.evaluate(() => { window.loadGate = false; window.loadResolvers.splice(0).forEach(resolve => resolve()) })
    await context.page.waitForFunction(() => !window.viewModel.playback.isSelectionPending && !window.viewModel.playback.isAudioBusy)
    await begin(context)
    await target(context.page, 'List b').click()
    await context.page.waitForFunction(() => window.persistedPlaylists.find(item => item.sourcePath === '/lists/b.m3u8').tracks.length === 3)
  })
  await check('default switch removes only relationships and can reuse a now-empty source snapshot', { sourcePlaylist: true }, async context => {
    await choose(context)
    await begin(context)
    await target(context.page, 'List a').click()
    await context.page.waitForFunction(() => [...document.querySelectorAll('.playlist-add-row')].some(row => row.dataset.targetScope.includes('/lists/a.m3u8') && row.getAttribute('aria-pressed') === 'false'))
    assert.equal(await context.page.evaluate(() => window.persistedPlaylists.find(item => item.sourcePath === '/lists/a.m3u8').tracks.length), 0)
    assert.deepEqual(await context.page.evaluate(() => window.fileDeletes), [])
    await target(context.page, 'List b').click()
    await context.page.waitForFunction(() => [...document.querySelectorAll('.playlist-add-row')].some(row => row.dataset.targetScope.includes('/lists/b.m3u8') && row.getAttribute('aria-pressed') === 'true'))
    await context.page.keyboard.press('Escape')
    await context.page.waitForFunction(() => !document.querySelector('.playlist-add-dialog:not([hidden])'))
    assert.equal(await dock(context.page).locator('.playlist-selection-count').textContent(), '0/0', 'the removed source has no stale parent selection')
    // The next picker is intentionally unavailable with an empty source. Re-adding
    // to A below belongs to the original still-open frozen request, so prepare
    // another independent request in the dedicated roundtrip case instead.
  })
  await check('switch can remove its sole source and add the same frozen songs back without reopening', { sourcePlaylist: true }, async context => {
    await choose(context)
    await begin(context)
    await target(context.page, 'List a').click()
    await context.page.waitForFunction(() => [...document.querySelectorAll('.playlist-add-row')].some(row => row.dataset.targetScope.includes('/lists/a.m3u8') && row.getAttribute('aria-pressed') === 'false'))
    await target(context.page, 'List b').click()
    await context.page.waitForFunction(() => [...document.querySelectorAll('.playlist-add-row')].some(row => row.dataset.targetScope.includes('/lists/b.m3u8') && row.getAttribute('aria-pressed') === 'true'))
    await target(context.page, 'List a').click()
    await context.page.waitForFunction(() => [...document.querySelectorAll('.playlist-add-row')].some(row => row.dataset.targetScope.includes('/lists/a.m3u8') && row.getAttribute('aria-pressed') === 'true'))
    const operations = await context.page.evaluate(() => window.calls.filter(call => ['library_delete_tracks', 'library_add_playlist_tracks'].includes(call.command)))
    assert.equal(operations[0].command, 'library_delete_tracks')
    assert.deepEqual(operations[0].input, { mode: 'list', sourcePath: '/lists/a.m3u8', trackPaths: ['/audio/a/0.flac', '/audio/a/shared.flac'] })
    assert.equal(operations.filter(call => call.command === 'library_add_playlist_tracks').length, 2)
    assert.deepEqual(await context.page.evaluate(() => window.persistedPlaylists.find(item => item.sourcePath === '/lists/a.m3u8').tracks.map(item => item.sourcePath)), ['/audio/a/0.flac', '/audio/a/shared.flac'])
  })
  await check('single mode has no checkbox and finishes immediately after one target', {}, async context => {
    await choose(context)
    await begin(context)
    await chooseMode(context, 'single')
    assert.equal(await targets(context.page).locator('.playlist-selection-icon,.playlist-add-empty-circle').count(), 0)
    await context.page.screenshot({path:join(evidenceDirectory,'mode-single-no-checkbox.png')})
    await target(context.page, 'List c').click()
    await context.page.locator('.playlist-selection-completed').filter({ hasText: '已添加' }).waitFor()
    assert.equal((await calls(context.page)).length, 1)
  })
  for (const position of ['end', 'random']) await check('insertion position ' + position + ' is explicit and preserves both ordered subsequences', {}, async context => {
    await choose(context)
    await begin(context)
    await choosePosition(context, position)
    await target(context.page, 'List b').click()
    await context.page.waitForFunction(() => [...document.querySelectorAll('.playlist-add-row')].some(row => row.dataset.targetScope.includes('/lists/b.m3u8') && row.getAttribute('aria-pressed') === 'true'))
    assert.equal((await calls(context.page))[0].input.position, position)
    const members = await context.page.evaluate(() => window.persistedPlaylists.find(item => item.sourcePath === '/lists/b.m3u8').tracks.map(item => item.sourcePath))
    assert.deepEqual(members.filter(path => path !== '/audio/a/0.flac'), ['/audio/b/0.flac', '/audio/a/shared.flac'])
    assert.equal(members.filter(path => path === '/audio/a/0.flac').length, 1)
    if (position === 'end') assert.equal(members.at(-1), '/audio/a/0.flac')
  })
  await check('target artwork subscribes to the existing cache and releases picker consumers', { targets: ['many'] }, async context => {
    await choose(context)
    await context.page.evaluate(() => { window.beforePickerArtwork = { ...window.artworkMeter }; window.ownedDock = document.querySelector('.playlist-playback-dock:not([data-dock-superseded])') })
    const dialog = await begin(context)
    const image = target(context.page, 'List many').locator('.playlist-add-cover img')
    await image.waitFor()
    await image.evaluate(image => image.decode())
    const imageState = await image.evaluate(image => {
      const canvas = document.createElement('canvas');canvas.width=canvas.height=1
      const context = canvas.getContext('2d');context.drawImage(image,0,0,1,1)
      const box=image.getBoundingClientRect()
      return { pixel:[...context.getImageData(0,0,1,1).data], width:box.width, height:box.height }
    })
    assert.deepEqual(imageState, { pixel:[255,0,0,255], width:93, height:64 })
    const active = await context.page.evaluate(() => ({ ...window.artworkMeter, baseline:window.beforePickerArtwork }))
    assert(active.retains > active.baseline.retains && active.subscribes > active.baseline.subscribes, 'picker leases and subscribes through the shared artwork store')
    await context.page.keyboard.press('Escape')
    await dialog.waitFor({ state:'hidden' })
    await context.page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    const after = await context.page.evaluate(() => ({ ...window.artworkMeter, sameOwner:window.ownedDock===document.querySelector('.playlist-playback-dock:not([data-dock-superseded])') }))
    assert(after.releases > active.releases && after.unsubscribes > active.unsubscribes, 'closed picker retires its artwork leases and subscriptions')
    assert.equal(after.retains-after.releases,active.baseline.retains-active.baseline.releases,'picker leaves no outstanding artwork leases')
    assert.equal(after.subscribes-after.unsubscribes,active.baseline.subscribes-active.baseline.unsubscribes,'picker leaves no outstanding artwork subscriptions')
    assert(after.sameOwner)
  })
  await check('designed create sort position and mode subdialogs preserve geometry, defaults and focus', {}, async context => {
    await choose(context)
    await begin(context)
    for (const [tool, title, width, height] of [['sort','播放列表排序',498,398], ['position','插入位置',498,300], ['mode','添加模式',498,300], ['create','新增播放列表',566,333]]) {
      await context.page.locator(`[data-picker-tool="${tool}"]`).click()
      const dialog = context.page.getByRole('dialog', { name:title, exact:true })
      const geometry = await dialog.evaluate(element => {
        const box=element.getBoundingClientRect(), dock=element.closest('.playlist-playback-dock')
        return { width:box.width, height:box.height, bottom:box.bottom, dockBottom:dock.getBoundingClientRect().bottom,
          icons:[...element.querySelectorAll('.playlist-selection-icon')].map(icon=>{const r=icon.getBoundingClientRect();return {width:r.width,height:r.height}}) }
      })
      assert.equal(geometry.width,width)
      assert.equal(geometry.height,height)
      assert.equal(geometry.bottom,geometry.dockBottom)
      if(tool==='sort') {
        assert.equal(await dialog.getByRole('button',{name:'根据名称',exact:true}).getAttribute('aria-pressed'),'true')
        for(const label of ['根据添加到媒体库的日期','根据添加/修改日期','根据音轨号']) {
          const option=dialog.getByRole('button',{name:label,exact:true})
          assert(await option.isDisabled(), 'missing source metadata is truthfully unavailable')
          assert.match(await option.getAttribute('title'),/未提供.*数据/)
        }
        assert(geometry.icons.some(icon=>Math.abs(icon.width-22.6667)<.02&&Math.abs(icon.height-26.6667)<.02))
      } else if(tool==='position') assert.equal(await dialog.getByRole('button',{name:'在开头插入',exact:true}).getAttribute('aria-pressed'),'true')
      else if(tool==='mode') assert.equal(await dialog.getByRole('button',{name:'切换',exact:true}).getAttribute('aria-pressed'),'true')
      else assert.equal(await dialog.getByLabel('播放列表名称',{exact:true}).inputValue(),'A Song')
      await context.page.screenshot({path:join(evidenceDirectory,`submenu-${tool}.png`)})
      await context.page.keyboard.press('Escape')
      await context.page.getByRole('dialog',{name:'播放列表',exact:true}).waitFor()
      assert.equal(await context.page.locator(`[data-picker-tool="${tool}"]`).evaluate(element=>element===document.activeElement),true,'submenu returns focus to its original control')
    }
  })
  await check('switch add then remove reports generic completion rather than a false added result', {}, async context => {
    await choose(context)
    const dialog = await begin(context)
    await target(context.page, 'List c').click()
    await context.page.waitForFunction(() => [...document.querySelectorAll('.playlist-add-row')].some(row => row.dataset.targetScope.includes('/lists/c.m3u8') && row.getAttribute('aria-pressed') === 'true'))
    await target(context.page, 'List c').click()
    await context.page.waitForFunction(() => [...document.querySelectorAll('.playlist-add-row')].some(row => row.dataset.targetScope.includes('/lists/c.m3u8') && row.getAttribute('aria-pressed') === 'false'))
    await dialog.getByRole('button',{name:'完成',exact:true}).click()
    const completion=context.page.locator('.playlist-selection-completed-content')
    await completion.waitFor()
    assert.equal(await completion.textContent(),'完成')
    assert.equal(await completion.getByRole('button',{name:'打开',exact:true}).count(),0)
    assert.deepEqual(await context.page.evaluate(()=>window.fileDeletes),[])
    assert.deepEqual(await context.page.evaluate(()=>window.persistedPlaylists.find(item=>item.sourcePath==='/lists/c.m3u8').tracks.map(item=>item.sourcePath)),['/audio/c/0.flac'])
  })
  console.log('SELECTION_ADD_REGRESSION_PASS', passed)
  writeFileSync(join(evidenceDirectory, process.env.SPMUSIC_ADD_FILTER ? 'result-filter.json' : 'result.json'), JSON.stringify({ passed, filter: process.env.SPMUSIC_ADD_FILTER ?? null }, null, 2))
} finally { await browser.close() }
