// Run Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright package.
// The real shell, selection parents, dialogs and IPC parser run. Native IO is
// deterministic here; actual temporary-file deletion is covered by Rust tests.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const evidenceDirectory = join(tmpdir(), 'spmusic-selection-delete-verification')
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
assert(literal, 'reuse native fixture without executing another suite')
let fixture = runInNewContext(literal[1], { dependency })
fixture = fixture.replace('length:50', 'length:1000')
fixture = fixture.replace('React.createElement(PlayerShell)', 'React.createElement(ThemeProbe)')
fixture += `
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
function ThemeProbe(){const theme=useAppearance();window.themeApi=theme;return React.createElement(PlayerShell)}
`
const renderMarker = "ReactDOM.createRoot(document.getElementById('root')).render("
assert(fixture.includes(renderMarker))
fixture = fixture.replace(renderMarker, `
window.deletedPaths=[];window.deleteFailures=[];window.deleteGate=false;window.deleteResolvers=[];window.persistedPlaylists=[];window.storageError=null;
window.currentTrackGate=false;window.currentTrackResolvers=[];
window.emitExternalCurrent=path=>{currentTrack=track(path);state={...state,phase:'playing',generation:++generation,currentTrackId:currentTrack.id,durationMs:180000,positionMs:0};window.listeners?.audio_state_changed?.({payload:{...state}})};
const originalInvoke=window.backendInvoke;
window.backendInvoke=async(command,args)=>{
 const input=args?.input;
 if(command==='audio_get_current_track'&&window.currentTrackGate){window.calls.push({command,input});const result=currentTrack;await new Promise(resolve=>window.currentTrackResolvers.push(resolve));return result;}
 if(command==='library_get_playlists')return window.persistedPlaylists;
 if(command==='audio_import_playlist'){
   const result=await originalInvoke(command,args);window.persistedPlaylists=[...window.persistedPlaylists.filter(item=>item.sourcePath!==result.sourcePath),result];return result;
 }
 if(command!=='library_delete_tracks')return originalInvoke(command,args);
 window.calls.push({command,input});
 if(window.deleteGate)await new Promise(resolve=>window.deleteResolvers.push(resolve));
 const removedPaths=[...new Set(input.trackPaths)].filter(path=>!window.deleteFailures.includes(path));
 const failures=[...new Set(input.trackPaths)].filter(path=>window.deleteFailures.includes(path)).map(sourcePath=>({sourcePath,code:'UNREADABLE_FILE',message:'fixture locked file'}));
 if(input.mode==='files')window.deletedPaths.push(...removedPaths);
 window.persistedPlaylists=window.persistedPlaylists.map(list=>input.mode==='files'||list.sourcePath===input.sourcePath?({...list,tracks:list.tracks.filter(row=>!removedPaths.includes(row.sourcePath)),selectedIndex:0}):list);
 let nextState=input.mode==='files'?{...state}:null;
 if(input.mode==='files'&&currentTrack&&removedPaths.includes(currentTrack.sourcePath)){
   currentTrack=null;state={...state,phase:'idle',generation:++generation,currentTrackId:null,durationMs:null,positionMs:0};nextState={...state};
 }
 return {removedPaths,failures,playlists:window.persistedPlaylists,state:nextState,storageError:window.storageError};
};
${renderMarker}`)
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__selection_delete_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(Surface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__selection_delete_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
let passed = 0

async function open({ width = 1280, kind = 'playlist', sources = ['a'], m3u = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('spmusic.playlist.layout-level.v1', '4')
    localStorage.setItem('spmusic.all-songs.layout-level.v1', '4')
  })
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__selection_delete_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__selection_delete_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__selection_delete_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__selection_delete_test')
  await page.waitForFunction(() => Boolean(window.viewModel && window.themeApi))
  for (const choice of sources) {
    await page.evaluate(({ choice, m3u }) => {
      window.choice = choice; window.playlistImport = m3u
      if (m3u) window.viewModel.playlist.library.onImportPlaylist()
      else window.viewModel.playlist.library.onSelectFolders()
    }, { choice, m3u })
    await page.waitForFunction(() => !window.viewModel.playlist.library.isImportPending && !window.viewModel.playback.isAudioBusy && !window.viewModel.playback.isSelectionPending)
  }
  await page.evaluate(kind => {
    if (kind === 'songs') window.viewModel.playlist.library.onSelectCategory('songs')
    else window.viewModel.playlist.library.onSelect(window.viewModel.playlist.library.items[0].scope)
  }, kind)
  const grid = page.locator(kind === 'songs' ? '.all-songs-list' : '.playlist-grid:not(.all-songs-list)')
  await grid.locator('.playlist-card').first().waitFor()
  await page.getByRole('button', { name: '选择', exact: true }).first().click()
  await grid.locator('.playlist-card[data-select-mode="true"]').first().waitFor()
  return { page, errors, grid }
}
const activeDock = page => page.locator('.playlist-playback-dock:not([data-dock-superseded])')
const deleteCalls = page => page.evaluate(() => window.calls.filter(call => call.command === 'library_delete_tracks'))
async function choose(context, indices) {
  for (const index of indices) await context.grid.locator('.playlist-card').nth(index).click()
}
async function beginDelete(context) {
  await activeDock(context.page).getByRole('button', { name: '删除', exact: true }).click()
  const dialog = context.page.getByRole('dialog').filter({ has: context.page.getByRole('heading', { name: /确定删除/ }) })
  await dialog.waitFor()
  return dialog
}
async function check(name, options, run) {
  if (process.env.SPMUSIC_DELETE_FILTER && !name.includes(process.env.SPMUSIC_DELETE_FILTER)) return
  const context = await open(options)
  try {
    await run(context)
    assert.deepEqual(context.errors, [])
    passed++; console.log('PASS', name)
  } finally { await context.page.close() }
}

async function panelGeometry(page) {
  return page.locator('.playlist-selection-panel').evaluate(panel => {
    const bounds = panel.getBoundingClientRect()
    const rect = element => {
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }
    }
    return { panel: rect(panel), header: rect(panel.querySelector('.playlist-selection-panel-header')),
      actions: [...panel.querySelectorAll('.playlist-selection-action')].map(element => ({ label: element.textContent, ...rect(element) })),
      icons: [...panel.querySelectorAll('.playlist-selection-icon')].map(element => ({ hasLocalMask: getComputedStyle(element).maskImage.startsWith('url('), ...rect(element) })),
      overflow: [...panel.querySelectorAll('button,.playlist-selection-count')].filter(element => {
        const box = element.getBoundingClientRect()
        return box.x < bounds.x - .5 || box.right > bounds.right + .5 || box.y < bounds.y - .5 || box.bottom > bounds.bottom + .5 || element.scrollWidth > element.clientWidth + 1
      }).map(element => ({ label: element.textContent || element.getAttribute('aria-label'), ...rect(element), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })) }
  })
}

try {
  await check('Figma assets and responsive geometry', { sources: ['many'] }, async context => {
    const sizes = { 'checkbox.svg': 45, 'range.svg': 32, 'help.svg': 32, 'close.svg': 28, 'playlist.svg': 28, 'queue.svg': 28,
      'play-next.svg': 28, 'delete.svg': 28, 'share.svg': 28, 'info.svg': 28, 'artwork.svg': 28, 'completed.svg': 56 }
    for (const [name, size] of Object.entries(sizes)) {
      const asset = readFileSync(new URL('../../../assets/selection-panel/' + name, import.meta.url), 'utf8')
      assert(asset.length > 100, name + ' is local and nonempty')
      const root = asset.match(/<svg\b[^>]*>/)?.[0]
      assert(root?.includes(`width="${size}"`) && root.includes(`height="${size}"`), name + ' retains Figma root dimensions')
    }
    await context.page.evaluate(() => document.fonts.ready)
    let geometry = await panelGeometry(context.page)
    writeFileSync(join(evidenceDirectory, 'geometry-first.json'), JSON.stringify(geometry, null, 2))
    await context.page.screenshot({ path: join(evidenceDirectory, 'selection-default.png') })
    assert.equal(geometry.panel.width, 615)
    assert.equal(geometry.panel.height, 243)
    assert.equal(geometry.actions.length, 7)
    assert(geometry.actions.slice(0, 4).every(action => Math.abs(action.y - geometry.actions[0].y) < .5))
    assert(geometry.actions.slice(4).every(action => Math.abs(action.y - geometry.actions[4].y) < .5))
    assert(geometry.actions[4].y > geometry.actions[0].y)
    assert.deepEqual(geometry.icons.map(icon => icon.width), [45, 32, 32, 28, 28, 28, 28, 28, 28, 28, 28])
    assert.deepEqual(geometry.icons.map(icon => icon.height), geometry.icons.map(icon => icon.width))
    assert(geometry.icons.every(icon => icon.hasLocalMask))
    assert.deepEqual(geometry.overflow, [])
    const divider = await context.page.locator('.playlist-selection-panel-header').evaluate(element => ({
      color: getComputedStyle(element).borderBottomColor,
      token: getComputedStyle(document.documentElement).getPropertyValue('--player-outline-variant').trim(),
    }))
    assert.equal(divider.token, '#c1c7ce')
    assert.equal(divider.color, 'rgb(193, 199, 206)')
    const snapshots = { default: geometry }
    await activeDock(context.page).getByRole('button', { name: '全选', exact: true }).click()
    assert.equal(await activeDock(context.page).locator('.playlist-selection-count').textContent(), '1000/1000')
    for (const width of [1280, 640]) {
      await context.page.setViewportSize({ width, height: 1000 })
      await context.page.evaluate(() => { const theme = structuredClone(window.themeApi.appearance); theme.typography.fontScale = 1.4; window.themeApi.previewAppearance(theme) })
      await context.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      geometry = await panelGeometry(context.page)
      assert.deepEqual(geometry.overflow, [], 'font 1.4 and width ' + width + ' retain every control')
      snapshots[width] = geometry
      await context.page.screenshot({ path: join(evidenceDirectory, 'selection-font140-' + width + '.png') })
    }
    writeFileSync(join(evidenceDirectory, 'geometry.json'), JSON.stringify(snapshots, null, 2))
  })
  await check('cancel and escape never invoke deletion', { m3u: true }, async context => {
    await choose(context, [0])
    let dialog = await beginDelete(context)
    assert.equal((await deleteCalls(context.page)).length, 0)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    dialog = await beginDelete(context)
    await context.page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal((await deleteCalls(context.page)).length, 0)
    assert.equal(await context.grid.locator('[data-selected="true"]').count(), 1)
  })
  await check('folder list removal is unavailable until explicit file mode', {}, async context => {
    await choose(context, [0])
    const dialog = await beginDelete(context)
    assert.equal(await dialog.getByRole('button', { name: '删除', exact: true }).isDisabled(), true)
    assert.match(await dialog.textContent(), /文件夹扫描视图不支持/)
    assert.equal((await deleteCalls(context.page)).length, 0)
    await dialog.getByRole('button', { name: '删除文件', exact: true }).click()
    assert.match(await dialog.textContent(), /移至回收站/)
    assert.equal(await dialog.getByRole('button', { name: '删除', exact: true }).isDisabled(), false)
    assert.equal((await deleteCalls(context.page)).length, 0, 'switching mode does not delete')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal((await deleteCalls(context.page)).length, 0)
  })
  await check('M3U list removal keeps files and reaches empty completion', { sources: ['c'], m3u: true }, async context => {
    await choose(context, [0])
    const dialog = await beginDelete(context)
    await dialog.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)))
    const geometry = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
    assert.deepEqual(geometry, { width: 615, height: 228 })
    const bottom = await dialog.evaluate(element => {
      const panel = element.closest('.playlist-selection-panel'), dock = panel.closest('.playlist-playback-dock')
      return { dialog: element.getBoundingClientRect().bottom, panel: panel.getBoundingClientRect().bottom, dock: dock.getBoundingClientRect().bottom }
    })
    assert.equal(bottom.dialog, bottom.panel, 'confirmation uses the bottom selection panel surface')
    assert.equal(bottom.dialog, bottom.dock, 'confirmation shares the existing dock bottom edge')
    await context.page.screenshot({ path: join(evidenceDirectory, 'delete-confirm.png') })
    await context.page.clock.install()
    const completionClockStart = new Date()
    await context.page.clock.pauseAt(completionClockStart)
    await dialog.getByRole('button', { name: '删除', exact: true }).click()
    await context.page.locator('.playlist-selection-completed').waitFor()
    const calls = await deleteCalls(context.page)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].input, { mode: 'list', sourcePath: '/lists/c.m3u8', trackPaths: ['/audio/c/0.flac'] })
    const result = await context.page.evaluate(() => ({ deleted: window.deletedPaths, lists: window.persistedPlaylists,
      item: window.viewModel.playlist.library.items.find(item => item.sourceKind === 'm3u8') }))
    assert.deepEqual(result.deleted, [])
    assert.equal(result.lists[0].tracks.length, 0)
    assert.equal(result.item.trackCount, 0)
    const completed = await context.page.locator('.playlist-selection-completed').evaluate(panel => {
      const icon = panel.querySelector('.playlist-selection-icon').getBoundingClientRect()
      const box = panel.getBoundingClientRect()
      return { width: box.width, height: box.height, iconWidth: icon.width, iconHeight: icon.height, text: panel.querySelector('.playlist-selection-completed-content').textContent }
    })
    assert.deepEqual(completed, { width: 615, height: 100, iconWidth: 56, iconHeight: 56, text: '完成' })
    await context.page.clock.runFor(150)
    await dialog.waitFor({ state: 'hidden' })
    const completionBottom = await context.page.locator('.playlist-selection-completed').evaluate(panel => ({
      panel: panel.getBoundingClientRect().bottom, dock: panel.closest('.playlist-playback-dock').getBoundingClientRect().bottom,
    }))
    assert.equal(completionBottom.panel, completionBottom.dock)
    await context.page.screenshot({ path: join(evidenceDirectory, 'completed.png') })
    await context.page.clock.runFor(1849)
    assert.equal(await context.page.locator('.playlist-selection-completed').count(), 1)
    await context.page.clock.runFor(1)
    await context.page.locator('.playlist-selection-panel').waitFor({ state: 'hidden' })
  })
  await check('snapshot stays fixed and duplicate confirmation invokes once', { m3u: true }, async context => {
    await choose(context, [0])
    const selectedTitle = await context.grid.locator('[data-selected="true"]').first().textContent()
    const dialog = await beginDelete(context)
    await context.page.evaluate(() => { window.deleteGate = true })
    await context.grid.locator('.playlist-card').nth(1).evaluate(card => card.click())
    await dialog.getByRole('button', { name: '删除', exact: true }).evaluate(button => { button.click(); button.click() })
    await context.page.waitForFunction(() => window.calls.some(call => call.command === 'library_delete_tracks'))
    assert.equal((await deleteCalls(context.page)).length, 1)
    assert.equal((await deleteCalls(context.page))[0].input.trackPaths.length, 1)
    assert.equal((await deleteCalls(context.page))[0].input.trackPaths[0], '/audio/a/0.flac', selectedTitle)
    assert.equal(await dialog.getByRole('button', { name: '删除中…', exact: true }).isDisabled(), true)
    await context.page.keyboard.press('Escape')
    assert.equal(await dialog.isVisible(), true, 'busy dialog cannot disappear while a destructive command runs')
    await context.page.evaluate(() => { window.deleteGate = false; window.deleteResolvers.splice(0).forEach(resolve => resolve()) })
    await context.page.locator('.playlist-selection-completed').waitFor()
    assert.equal((await deleteCalls(context.page)).length, 1)
  })
  await check('partial file deletion reconciles every source and retains failures', { kind: 'songs', sources: ['a', 'b'] }, async context => {
    await activeDock(context.page).getByRole('button', { name: '全选', exact: true }).click()
    await context.page.evaluate(() => { window.deleteFailures = ['/audio/common/shared.flac'] })
    const dialog = await beginDelete(context)
    await dialog.getByRole('button', { name: '删除文件', exact: true }).click()
    await dialog.getByRole('button', { name: '删除', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await context.page.getByRole('alert').filter({ hasText: /fixture locked file/ }).waitFor()
    assert.equal(await context.page.locator('.playlist-selection-completed').count(), 0)
    const calls = await deleteCalls(context.page)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input.mode, 'files')
    assert.equal(calls[0].input.trackPaths.length, 3, 'AllSongs sends each physical path once')
    const result = await context.page.evaluate(() => ({ deleted: window.deletedPaths, songs: window.viewModel.playlist.library.allSongs,
      counts: window.viewModel.playlist.library.items.map(item => item.trackCount) }))
    assert.deepEqual([...result.deleted].sort(), ['/audio/a/0.flac', '/audio/b/0.flac'])
    assert.equal(result.songs.length, 1)
    assert.equal(result.songs[0].sourcePath, '/audio/common/shared.flac')
    assert.deepEqual(result.counts, [1, 1])
    assert.equal(await context.grid.locator('[data-selected="true"]').count(), 1)
    assert.equal(await activeDock(context.page).locator('.playlist-selection-count').textContent(), '1/1')
    await context.page.screenshot({ path: join(evidenceDirectory, 'partial-failure.png') })
  })
  await check('storage failure never reports full completion after files removed', { m3u: true }, async context => {
    await choose(context, [0])
    await context.page.evaluate(() => { window.storageError = { code: 'IO_ERROR', message: 'fixture registry locked' } })
    const dialog = await beginDelete(context)
    await dialog.getByRole('button', { name: '删除文件', exact: true }).click()
    await dialog.getByRole('button', { name: '删除', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await context.page.getByRole('alert').filter({ hasText: /fixture registry locked/ }).waitFor()
    assert.equal(await context.page.locator('.playlist-selection-completed').count(), 0)
    assert.deepEqual(await context.page.evaluate(() => window.deletedPaths), ['/audio/a/0.flac'])
    assert.equal(await context.page.evaluate(() => window.viewModel.playlist.library.items[0].trackCount), 1)
  })
  await check('custom list removal changes real session descriptor without file IPC', { kind: 'songs' }, async context => {
    await choose(context, [0])
    await activeDock(context.page).getByRole('button', { name: '选择帮助', exact: true }).click()
    await context.page.getByRole('dialog', { name: '选择帮助', exact: true }).getByRole('button', { name: '新建播放列表', exact: true }).click()
    const create = context.page.getByRole('dialog', { name: '新建播放列表', exact: true })
    await create.getByLabel('播放列表名称', { exact: true }).fill('Delete session fixture')
    await create.getByRole('button', { name: '创建', exact: true }).click()
    const grid = context.page.locator('.playlist-grid:not(.all-songs-list)')
    await grid.locator('.playlist-card').first().waitFor()
    await context.page.getByRole('button', { name: '选择', exact: true }).first().click()
    await choose({ ...context, grid }, [0])
    const dialog = await beginDelete(context)
    await dialog.getByRole('button', { name: '删除', exact: true }).click()
    await context.page.locator('.playlist-selection-completed').waitFor()
    assert.equal((await deleteCalls(context.page)).length, 0)
    assert.deepEqual(await context.page.evaluate(() => window.deletedPaths), [])
    const items = await context.page.evaluate(() => window.viewModel.playlist.library.items)
    assert.equal(items.find(item => item.sourceKind === 'custom').trackCount, 0)
    assert.equal(items.find(item => item.sourceKind === 'folder').trackCount, 2)
  })
  await check('deleting current file clears playback and removes queue entries', {}, async context => {
    await context.page.evaluate(() => window.viewModel.playlist.library.onPlay(window.viewModel.playlist.library.items[0].scope))
    await context.page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isAudioBusy && !window.viewModel.playback.isSelectionPending)
    await choose(context, [0])
    const dialog = await beginDelete(context)
    await dialog.getByRole('button', { name: '删除文件', exact: true }).click()
    await dialog.getByRole('button', { name: '删除', exact: true }).click()
    await context.page.locator('.playlist-selection-completed').waitFor()
    await context.page.waitForFunction(() => window.viewModel.playback.track === null)
    const state = await context.page.evaluate(() => ({ current: window.viewModel.playback.track,
      queue: window.viewModel.queue.tracks.map(track => track.id), saved: localStorage.getItem('spmusic.player.session.v1') }))
    assert.equal(state.current, null)
    assert(!state.queue.includes('a-0'))
    assert.equal(state.saved, null)
  })
  await check('surviving current hydration restarts after deletion fences a stale request', {}, async context => {
    const initialHydrationCalls = await context.page.evaluate(() => window.calls.filter(call => call.command === 'audio_get_current_track').length)
    await context.page.evaluate(() => { window.currentTrackGate = true; window.emitExternalCurrent('/audio/a/0.flac') })
    await context.page.waitForFunction(() => window.currentTrackResolvers.length === 1)
    await choose(context, [1])
    const dialog = await beginDelete(context)
    await dialog.getByRole('button', { name: '删除文件', exact: true }).click()
    await dialog.getByRole('button', { name: '删除', exact: true }).click()
    await context.page.waitForFunction(() => window.currentTrackResolvers.length === 2)
    await context.page.evaluate(() => window.currentTrackResolvers.shift()())
    assert.equal(await context.page.evaluate(() => window.viewModel.playback.track), null, 'stale response cannot commit')
    await context.page.evaluate(() => { window.currentTrackGate = false; window.currentTrackResolvers.shift()() })
    await context.page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && window.viewModel.playback.contentState === 'track')
    assert.equal(await context.page.evaluate(() => window.calls.filter(call => call.command === 'audio_get_current_track').length), initialHydrationCalls + 2, 'exactly two bounded hydration requests after the external track change')
  })
  console.log('SELECTION_DELETE_REGRESSION_PASS', passed)
  writeFileSync(join(evidenceDirectory, process.env.SPMUSIC_DELETE_FILTER ? 'result-filter.json' : 'result.json'), JSON.stringify({ passed, filter: process.env.SPMUSIC_DELETE_FILTER ?? null }, null, 2))
} finally { await browser.close() }
