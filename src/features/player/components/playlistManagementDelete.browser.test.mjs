// Start Vite and point SPMUSIC_PLAYWRIGHT at an existing Playwright package.
// Real shell, root selection, hook and IPC parser; native IO is controlled.
// Rust registry tests cover actual source-file and persistence operations.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const evidenceDirectory = process.env.SPMUSIC_SCREENSHOT_DIR || join(tmpdir(), 'spmusic-management-delete-verification')
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
assert(literal, 'reuse the shared native fixture without executing another suite')
let fixture = runInNewContext(literal[1], { dependency })
fixture = fixture.replace('React.createElement(PlayerShell)', 'React.createElement(ThemeProbe)')
fixture += `
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
function ThemeProbe(){window.themeApi=useAppearance();return React.createElement(PlayerShell)}
`
const marker = "ReactDOM.createRoot(document.getElementById('root')).render("
assert(fixture.includes(marker))
fixture = fixture.replace(marker, `
window.deleteFailures=[];window.deleteGate=false;window.deleteResolvers=[];window.deleteFatal=false;window.deleteMalformed=false;window.storageFailure=false;window.recycledSources=[];
const seeded=['a','b','c'].map(choice=>{window.choice=choice;window.playlistImport=true;return playlist()});window.choice='a';window.playlistImport=false;
window.persistedPlaylists=JSON.parse(sessionStorage.getItem('native-playlists')??JSON.stringify(seeded));
const persist=()=>sessionStorage.setItem('native-playlists',JSON.stringify(window.persistedPlaylists));persist();
const originalInvoke=window.backendInvoke;
window.backendInvoke=async(command,args)=>{
 if(command==='library_get_folders')return {revision:0,roots:[{path:'/audio/a',selected:true,directoryRules:[]}]};
 if(command==='library_get_playlists')return structuredClone(window.persistedPlaylists);
 if(command==='audio_import_playlist'){
   const result=await originalInvoke(command,args);window.persistedPlaylists=[...window.persistedPlaylists.filter(item=>item.sourcePath!==result.sourcePath),result];persist();return result;
 }
 if(command!=='library_delete_playlists')return originalInvoke(command,args);
 const input=args.input;window.calls.push({command,input:structuredClone(input)});
 if(window.deleteGate)await new Promise(resolve=>window.deleteResolvers.push(resolve));
 if(window.deleteFatal)throw {code:'LIBRARY_STORAGE_ERROR',message:'fixture atomic write failed'};
 if(window.deleteMalformed)return {removedPaths:['/lists/a.m3u8']};
 const requested=[...new Set(input.sourcePaths)];
 const accepted=requested.filter(path=>!window.deleteFailures.includes(path));
 const failures=requested.filter(path=>window.deleteFailures.includes(path)).map(sourcePath=>({sourcePath,code:'PLAYLIST_FILE_ERROR',message:'fixture locked playlist source'}));
 const recycledPaths=input.mode==='files'?accepted:[];window.recycledSources.push(...recycledPaths);
 const removedPaths=window.storageFailure?[]:accepted;
 if(!window.storageFailure){window.persistedPlaylists=window.persistedPlaylists.filter(item=>!removedPaths.includes(item.sourcePath));persist();}
 return {removedPaths,recycledPaths,failures,playlists:structuredClone(window.persistedPlaylists),storageError:window.storageFailure?{code:'LIBRARY_STORAGE_ERROR',message:'fixture registry write failed after recycle'}:null};
};
${marker}`)
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface}from '/__management_delete_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(Surface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__management_delete_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
const evidence = []

async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'); localStorage.setItem('spmusic.playlist.layout-level.v1', '4') })
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__management_delete_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__management_delete_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__management_delete_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__management_delete_test')
  await ready(page)
  await root(page)
  return { page, errors }
}
async function ready(page) { await page.waitForFunction(() => window.viewModel?.playlist.library && window.themeApi && !window.viewModel.playlist.library.isPlaylistRestorePending && !window.viewModel.playlist.library.isFolderRestorePending) }
async function root(page) { await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('playlists')); await page.getByRole('region', { name: '播放列表管理', exact: true }).waitFor() }
const dock = page => page.locator('.playlist-playback-dock:not([data-dock-superseded])')
const dialog = page => page.locator('.playlist-selection-delete-dialog:visible')
const calls = page => page.evaluate(() => window.calls.filter(item => item.command === 'library_delete_playlists'))
const items = page => page.evaluate(() => window.viewModel.playlist.library.items.filter(item => ['m3u8', 'custom'].includes(item.sourceKind)).map(item => ({ name: item.name, scope: item.scope })))
async function select(page, names) {
  if (!(await page.locator('.playlist-management[data-select-mode="true"]').count())) await page.getByRole('region', { name: '播放列表管理', exact: true }).getByRole('button', { name: '选择', exact: true }).first().click()
  for (const name of names) await page.getByRole('button', { name: '选择 ' + name, exact: true }).click()
}
async function begin(page) { await dock(page).getByRole('button', { name: '删除', exact: true }).click(); await dialog(page).waitFor(); return dialog(page) }
async function confirm(page) { await dialog(page).getByRole('button', { name: '删除', exact: true }).click() }
async function check(name, run) {
  if (process.env.SPMUSIC_MANAGEMENT_DELETE_FILTER && !name.includes(process.env.SPMUSIC_MANAGEMENT_DELETE_FILTER)) return
  const context = await open()
  try { await run(context); assert.deepEqual(context.errors, []); evidence.push({ name, passed: true }); console.log('PASS', name) }
  finally { await context.page.close() }
}

try {
  await check('cancel Escape and bottom geometry', async ({ page }) => {
    await select(page, ['List a', 'List b'])
    const panel = await page.locator('.playlist-selection-panel').boundingBox()
    await begin(page)
    const box = await dialog(page).boundingBox()
    assert.equal(box.width, 615)
    assert(Math.abs(box.y + box.height - panel.y - panel.height) < 1, 'dialog and selection panel share the same window bottom offset')
    assert.match(await dialog(page).innerText(), /歌曲.*保留/)
    await page.screenshot({ path: join(evidenceDirectory, 'delete-desktop.png') })
    await dialog(page).getByRole('button', { name: '取消', exact: true }).click()
    await dialog(page).waitFor({ state: 'hidden' })
    assert.equal(await dock(page).locator('.playlist-selection-count').textContent(), '2/3')
    await begin(page); await page.keyboard.press('Escape'); await dialog(page).waitFor({ state: 'hidden' })
    assert.equal((await calls(page)).length, 0)
    assert.equal(await page.getByRole('button', { name: '选择 List a', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.setViewportSize({ width: 360, height: 480 })
    const narrowPanel = await page.locator('.playlist-selection-panel').boundingBox()
    await begin(page)
    const narrow = await dialog(page).boundingBox()
    assert(Math.abs(narrow.y + narrow.height - narrowPanel.y - narrowPanel.height) < 1)
    assert(narrow.x >= 0 && narrow.y >= 0 && narrow.x + narrow.width <= 360 && narrow.y + narrow.height <= 480)
    assert.equal(await dialog(page).evaluate(node => node.scrollWidth <= node.clientWidth), true)
    const controls = await dialog(page).locator('button').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { text: node.textContent, x: r.x, right: r.right, width: r.width, scroll: node.scrollWidth, client: node.clientWidth } }))
    assert(controls.every(control => control.x >= narrow.x && control.right <= narrow.x + narrow.width + 1 && control.scroll <= control.client + 1), 'narrow labels and actions fit')
    await page.screenshot({ path: join(evidenceDirectory, 'delete-narrow.png') })
    evidence.push({ name: 'geometry', desktop: { selection: panel, dialog: box }, narrow: { selection: narrowPanel, dialog: narrow } })
  })
  await check('default removes selected registry only and persists', async ({ page }) => {
    await select(page, ['List a'])
    await begin(page)
    await page.evaluate(() => { window.choice = 'many'; window.playlistImport = true; window.viewModel.playlist.library.onImportPlaylist() })
    await page.waitForFunction(() => !window.viewModel.playlist.library.isImportPending && window.viewModel.playlist.library.items.some(item => item.name === 'List many'))
    await confirm(page)
    await page.waitForFunction(() => !window.viewModel.playlist.library.items.some(item => item.name === 'List a'))
    assert.deepEqual((await calls(page)).map(item => item.input), [{ mode: 'list', sourcePaths: ['/lists/a.m3u8'] }])
    assert.deepEqual(await page.evaluate(() => window.recycledSources), [])
    assert.deepEqual((await items(page)).map(item => item.name).sort(), ['List b', 'List c', 'List many'])
    assert.equal(await page.evaluate(() => window.calls.filter(item => item.command === 'library_delete_tracks').length), 0)
    await page.reload(); await ready(page); await root(page)
    assert.equal((await items(page)).some(item => item.name === 'List a'), false)
  })
  await check('files partial failures pending double-click and retry', async ({ page }) => {
    await select(page, ['List a', 'List b'])
    await begin(page)
    await dialog(page).getByRole('button', { name: '删除文件', exact: true }).click()
    assert.match(await dialog(page).innerText(), /播放列表文件/)
    assert.match(await dialog(page).innerText(), /歌曲.*保留/)
    assert.doesNotMatch(await dialog(page).innerText(), /确定删除歌曲文件/)
    await page.evaluate(() => { window.deleteGate = true; window.deleteFailures = ['/lists/b.m3u8'] })
    await dialog(page).getByRole('button', { name: '删除', exact: true }).evaluate(node => { node.click(); node.click() })
    await page.waitForFunction(() => window.deleteResolvers.length === 1)
    assert.equal((await calls(page)).length, 1)
    assert.equal(await dialog(page).getByRole('button', { name: '取消', exact: true }).isDisabled(), true)
    await page.keyboard.press('Escape'); assert.equal(await dialog(page).isVisible(), true)
    await page.evaluate(() => { window.deleteGate = false; window.deleteResolvers.splice(0).forEach(resolve => resolve()) })
    await page.waitForFunction(() => !window.viewModel.playlist.library.isDeletePending)
    await dialog(page).waitFor({ state: 'hidden' })
    assert.deepEqual((await items(page)).map(item => item.name).sort(), ['List b', 'List c'])
    assert.equal(await dock(page).locator('.playlist-selection-count').textContent(), '1/2')
    assert.equal(await page.getByRole('button', { name: '选择 List b', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.match(await dock(page).getByRole('alert').innerText(), /1.*未能删除/)
    assert.deepEqual(await page.evaluate(() => window.recycledSources), ['/lists/a.m3u8'])
    await page.evaluate(() => { window.deleteFailures = [] })
    await begin(page); await dialog(page).getByRole('button', { name: '删除文件', exact: true }).click(); await confirm(page)
    await page.waitForFunction(() => !window.viewModel.playlist.library.items.some(item => item.name === 'List b'))
    assert.deepEqual((await calls(page)).at(-1).input, { mode: 'files', sourcePaths: ['/lists/b.m3u8'] })
    assert.deepEqual(await page.evaluate(() => window.recycledSources), ['/lists/a.m3u8', '/lists/b.m3u8'])
  })
  await check('registry failure preserves entries and reports file side effect', async ({ page }) => {
    await select(page, ['List a']); await begin(page)
    await dialog(page).getByRole('button', { name: '删除文件', exact: true }).click()
    await page.evaluate(() => { window.storageFailure = true })
    await confirm(page)
    await page.waitForFunction(() => !window.viewModel.playlist.library.isDeletePending)
    await dialog(page).waitFor({ state: 'hidden' })
    assert.equal((await items(page)).length, 3)
    assert.equal(await dock(page).locator('.playlist-selection-count').textContent(), '1/3')
    assert.deepEqual(await page.evaluate(() => window.recycledSources), ['/lists/a.m3u8'])
    assert.match(await dock(page).getByRole('alert').innerText(), /回收/)
    await page.screenshot({ path: join(evidenceDirectory, 'delete-storage-failure.png') })
  })
  await check('transport errors and malformed response never drop selection', async ({ page }) => {
    await select(page, ['List a']); await begin(page)
    await page.evaluate(() => { window.deleteFatal = true })
    await confirm(page); await page.waitForFunction(() => !window.viewModel.playlist.library.isDeletePending)
    await page.getByRole('alert').filter({ hasText: /fixture atomic write failed/ }).waitFor()
    if (await dialog(page).isVisible()) await dialog(page).getByRole('button', { name: '取消', exact: true }).click()
    assert.equal((await items(page)).length, 3)
    assert.equal(await dock(page).locator('.playlist-selection-count').textContent(), '1/3')
    await page.evaluate(() => { window.deleteFatal = false; window.deleteMalformed = true })
    await begin(page); await confirm(page); await page.waitForFunction(() => !window.viewModel.playlist.library.isDeletePending)
    await page.getByRole('alert').filter({ hasText: /格式/ }).waitFor()
    assert.equal((await items(page)).length, 3)
    assert.equal(await page.evaluate(() => window.persistedPlaylists.length), 3)
  })
  await check('mixed session custom and imported root deletion keeps playback detached', async ({ page }) => {
    const customScope = await page.evaluate(() => window.viewModel.playlist.library.onCreatePlaylist('Custom session', ['/audio/a/0.flac']))
    assert(customScope, 'create an existing session-only playlist')
    const activeScope = (await items(page)).find(item => item.name === 'List a').scope
    await page.evaluate(scope => window.viewModel.playlist.library.onPlay(scope), activeScope)
    await page.waitForFunction(() => window.viewModel.playback.isPlaying && !window.viewModel.playback.isSelectionPending)
    await root(page)
    const before = await page.evaluate(() => ({ id: window.viewModel.playback.track.id, playing: window.viewModel.playback.isPlaying, queue: window.viewModel.queue.tracks.map(row => row.id) }))
    await select(page, ['List a', 'Custom session']); await begin(page)
    const nativeStart = await page.evaluate(() => window.calls.length)
    await confirm(page)
    await page.waitForFunction(() => !window.viewModel.playlist.library.items.some(item => ['List a', 'Custom session'].includes(item.name)))
    const after = await page.evaluate(() => ({ id: window.viewModel.playback.track.id, playing: window.viewModel.playback.isPlaying, queue: window.viewModel.queue.tracks.map(row => row.id) }))
    assert.deepEqual(after, before, 'delete collection metadata preserves current audio and queue')
    assert.deepEqual((await calls(page)).map(item => item.input), [{ mode: 'list', sourcePaths: ['/lists/a.m3u8'] }])
    assert.deepEqual(await page.evaluate(start => window.calls.slice(start).filter(item => ['audio_load_file', 'audio_load_and_play', 'audio_seek', 'audio_pause', 'audio_stop'].includes(item.command)), nativeStart), [], 'deleting metadata cannot reload or interrupt the audio transport')
    await page.evaluate(() => window.viewModel.playback.onNext())
    await page.waitForFunction(id => window.viewModel.playback.track?.id !== id && !window.viewModel.playback.isSelectionPending, before.id)
    assert.equal((await items(page)).some(item => item.name === 'List a'), false, 'next cannot re-register source')
    await page.reload(); await ready(page); await root(page)
    assert.equal((await items(page)).some(item => item.name === 'List a'), false, 'startup cannot re-register source')
  })
  await check('unregistered opened M3U only removes locally and cannot recycle source', async ({ page }) => {
    await page.evaluate(() => { window.choice = 'many'; window.playlistImport = true; window.viewModel.playback.onOpenAudio() })
    await page.waitForFunction(() => window.viewModel.playlist.library.items.some(item => item.name === 'List many') && !window.viewModel.playback.isAudioBusy && !window.viewModel.playback.isSelectionPending)
    await root(page); await select(page, ['List many']); await begin(page)
    await dialog(page).getByRole('button', { name: '删除文件', exact: true }).click(); await confirm(page)
    await page.waitForFunction(() => !window.viewModel.playlist.library.isDeletePending)
    await dialog(page).waitFor({ state: 'hidden' })
    assert.equal((await items(page)).some(item => item.name === 'List many'), true)
    assert.match(await dock(page).getByRole('alert').innerText(), /先导入/)
    assert.equal((await calls(page)).length, 0)
    assert.deepEqual(await page.evaluate(() => window.recycledSources), [])
    await begin(page); await confirm(page)
    await page.waitForFunction(() => !window.viewModel.playlist.library.items.some(item => item.name === 'List many'))
    assert.equal((await calls(page)).length, 0, 'unregistered root list removal stays frontend-local')
    assert.deepEqual(await page.evaluate(() => window.persistedPlaylists.map(item => item.sourcePath)), ['/lists/a.m3u8', '/lists/b.m3u8', '/lists/c.m3u8'])
  })
  await check('route change dismisses confirmation without native deletion', async ({ page }) => {
    await select(page, ['List a']); await begin(page)
    await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('songs'))
    await page.getByRole('region', { name: '所有歌曲管理', exact: true }).waitFor()
    await dialog(page).waitFor({ state: 'hidden' })
    assert.equal((await calls(page)).length, 0)
    await root(page)
    assert.equal((await items(page)).length, 3)
  })
  writeFileSync(join(evidenceDirectory, 'evidence.json'), JSON.stringify({ passed: true, evidence }, null, 2))
  console.log(JSON.stringify({ passed: evidence.filter(item => item.passed).length, evidenceDirectory }))
} finally { await browser.close() }
