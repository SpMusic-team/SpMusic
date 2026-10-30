// Actual Shell, hook, model and dialog; only native transport is simulated.
// Run Vite first, then SPMUSIC_PLAYWRIGHT=<installed playwright> node this-file.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => { const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"')); assert(match); return match[1] }
const shared = readFileSync(new URL('./folderHierarchy.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal, 'shared audio fixture remains identifiable')
let fixture = runInNewContext(literal[1], { dependency })
fixture = fixture.replace("ReactDOM.createRoot(document.getElementById('root')).render(", `
window.requests=[];window.settings={revision:3,roots:['/music','/music/Album','/music-else','/missing'].map(path=>({path,selected:true,directoryRules:[]}))};
if(new URLSearchParams(location.search).has('disabled'))window.settings.roots=window.settings.roots.map(root=>({...root,selected:root.path==='/music-else'}));
window.holdScans=false;window.pendingScans=[];window.holdPicker=false;window.pendingPickers=[];window.pendingTrees=[];window.holdTrees=false;window.scanFailures=[];window.holdSave=false;window.pendingSaves=[];
const nativeOriginal=window.backendInvoke;
window.backendInvoke=async(command,args)=>{
 window.requests.push({command,args});
 if(command==='library_get_folders')return structuredClone(window.settings);
 if(command==='library_select_folders')return window.holdPicker?await new Promise(resolve=>window.pendingPickers.push(resolve)):window.pickedPaths??null;
 if(command==='library_replace_folders'){
  if(window.holdSave)await new Promise(resolve=>window.pendingSaves.push(resolve));
  if(window.saveFailure)throw {code:'LIBRARY_STORAGE_ERROR',message:'Controlled atomic write failure'};
  if(args.input.expectedRevision!==window.settings.revision)throw {code:'LIBRARY_SETTINGS_CONFLICT',message:'Controlled revision conflict'};
  window.settings={revision:window.settings.revision+1,roots:structuredClone(args.input.roots)};
  return structuredClone(window.settings);
 }
 if(command==='library_list_folder_directories'){
  const input=args.input;
  const overriddenChildren=window.treeOverrides?.[input.directoryPath];
  if(window.holdTrees)await new Promise(resolve=>window.pendingTrees.push(resolve));
  if(window.treeFailure)throw {code:'IO_ERROR',message:'Controlled directory failure'};
  const children=overriddenChildren??(input.directoryPath==='/music'?[{path:'/music/Album',name:'Album',hasChildren:true},{path:'/music/Empty',name:'Empty',hasChildren:false},{path:'/music/Denied',name:'Denied',hasChildren:null,readError:{code:'IO_ERROR',message:'Denied'}}]:input.directoryPath==='/music/Album'?[{path:'/music/Album/Disc',name:'Disc',hasChildren:false}]:[]);
  return {...input,children};
 }
 if(command==='library_clear_folders'){window.settings={revision:window.settings.revision+1,roots:[]};return null}
 if(command==='library_scan_folder'){
  if(window.holdScans)await new Promise(resolve=>window.pendingScans.push({path:args.path,resolve}));
  if(window.scanFailures.includes(args.path))throw {code:'IO_ERROR',message:'Controlled scan failure'};
 }
 if(command==='audio_import_playlist')return null;
 if(command==='audio_open_source'&&window.directFile){
  for(const item of [['direct-a','/direct/a.flac'],['direct-b','/direct/b.flac']]){const row=descriptor(item);all.set(row.sourcePath,row)}
  const selected=track('/direct/a.flac');currentTrack=selected;state={...state,phase:'ready',generation:++generation,currentTrackId:selected.id,durationMs:selected.durationMs,positionMs:0};return {kind:'track',track:selected};
 }
 if(command==='audio_list_folder_tracks'&&window.directFile)return {directoryPath:'/direct',directoryName:'direct',sourceKind:'folder',sourcePath:'/direct',sourceName:'direct',selectedIndex:0,tracks:['/direct/a.flac','/direct/b.flac'].map(path=>all.get(path))};
 return nativeOriginal(command,args);
};
window.testRoot=ReactDOM.createRoot(document.getElementById('root'));window.testRoot.render(`)
assert(fixture.includes('window.testRoot.render'))
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface}from '/__selection_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;window.librarySettings=props.librarySettings;return React.createElement(RealSurface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__selection_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const errors = [], evidence = []
const directory = process.env.SPMUSIC_TEST_SCREENSHOTS || 'C:/Users/winkeses/.codex/tmp/folder-selection-independent'
mkdirSync(directory, { recursive: true })
const count = (calls, command) => calls.filter(call => call.command === command).length
const calls = page => page.evaluate(() => window.requests)
const ready = page => page.waitForFunction(() => window.vm?.playlist.library && !window.vm.playlist.library.isFolderRestorePending && !window.vm.playlist.library.isImportPending)
const ids = page => page.evaluate(() => window.vm.playlist.library.allSongs.map(row => row.trackId).sort())
const committed = page => page.evaluate(() => structuredClone(window.vm.folderSelection.committed))
const resetCalls = page => page.evaluate(() => { window.requests = [] })
const settle = page => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame) })
async function open(query = '', expectedSongs = 5, saved = null) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1080 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => { errors.push(error.message); console.error('FOLDER_SELECTION_PAGEERROR', error.stack) })
  await page.addInitScript(saved => { localStorage.clear(); localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'); if (saved) localStorage.setItem('spmusic.player.session.v1', JSON.stringify(saved)) }, saved)
  for (const [pattern, body] of [['**/src/features/player/services/audioCommands.ts*', service], ['**/src/features/player/components/PlayerSurface.tsx*', surface], ['**/__selection_surface.js', realSurface], ['**/__selection_fixture.js', fixture]]) await page.route(pattern, route => route.fulfill({ contentType: 'text/javascript', body }))
  await page.route('**/__selection_test*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__selection_test' + query)
  try { await ready(page) } catch (error) { console.error('FOLDER_SELECTION_STARTUP', JSON.stringify({ errors, state: await page.evaluate(() => ({ vm: !!window.vm, requests: window.requests, text: document.body.innerText.slice(0, 2000) })) })); throw error }
  await page.waitForFunction(expected => window.vm.playlist.library.allSongs.length === expected, expectedSongs)
  return page
}
async function save(page, transform) {
  await page.evaluate(async transform => {
    const settings = structuredClone(window.vm.folderSelection.committed)
    const roots = Function('roots', 'return (' + transform + ')(roots)')(settings.roots)
    try { await window.vm.folderSelection.onSave({ expectedRevision: settings.revision, roots }); window.lastSaveError = null }
    catch (error) { window.lastSaveError = error.message ?? error.code }
  }, transform.toString())
}
async function chooser(page) {
  await page.evaluate(() => window.vm.playlist.library.onSelectCategory('folders'))
  await page.getByRole('button', { name: '更多文件夹操作', exact: true }).click()
  await page.getByRole('button', { name: '选择文件夹', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '文件夹选择', exact: true })
  await dialog.waitFor()
  await settle(page)
  return dialog
}
const rootRow = (dialog, path) => dialog.locator('.folder-selection-row[data-root]').filter({ has: dialog.page().locator(`.folder-selection-name[title="${path}"]`) })
const childRow = (dialog, path) => dialog.locator('.folder-selection-row').filter({ has: dialog.page().locator(`.folder-selection-name[title="${path}"]`) })
const checked = row => row.getByRole('checkbox').getAttribute('aria-checked')
async function dismiss(page, dialog) { await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }) }

try {
  const page = await open()
  assert.deepEqual(await ids(page), ['album', 'deep', 'other', 'root', 'root2'])
  await page.evaluate(() => window.vm.playlist.library.onSelectCategory('songs'))
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  const entries = await page.evaluate(() => window.vm.playlist.library.allSongs.map(({ scope, trackId }) => ({ scope, trackId })))
  await page.evaluate(entries => window.vm.playlist.library.onPlaySong(entries.find(entry => entry.trackId === 'root').scope, 'root', entries), entries)
  await page.waitForFunction(() => window.vm.playback.track?.id === 'root' && !window.vm.playback.isAudioBusy)
  const queue = await page.evaluate(() => window.vm.queue.tracks.map(track => track.id))
  const title = await page.evaluate(() => window.vm.playlist.library.allSongs.find(song => song.trackId === 'root').track.title)

  // Disabling is a committed filter, retaining registry entries and active queue.
  await resetCalls(page)
  await page.evaluate(() => { window.holdScans = true })
  await save(page, roots => roots.map(root => root.path === '/music' || root.path === '/music/Album' || root.path === '/missing' ? { ...root, selected: false } : root))
  await page.waitForFunction(() => window.pendingScans.length === 1)
  assert.deepEqual(await ids(page), ['other'], 'raw scan data is immediately filtered before post-save scans finish')
  assert.equal((await committed(page)).roots.length, 4, 'disabled roots remain registered')
  assert.deepEqual(await page.evaluate(() => window.vm.queue.tracks.map(track => track.id)), queue, 'active queue snapshot survives disabling')
  assert.equal(await page.evaluate(() => window.vm.playback.track.id), 'root')
  let requests = await calls(page)
  assert(requests.findIndex(call => call.command === 'library_replace_folders') < requests.findIndex(call => call.command === 'library_scan_folder'), 'atomic persistence precedes scanning')
  assert.deepEqual(requests.filter(call => call.command === 'library_scan_folder').map(call => call.args.path), ['/music-else'], 'only active roots scan')
  assert.equal(count(requests, 'audio_load_and_play') + count(requests, 'audio_load_file'), 0, 'settings do not reload the current decoder')
  await page.evaluate(entries => window.vm.playlist.library.onPlaySong(entries[0].scope, entries[0].trackId, entries), entries)
  await settle(page)
  assert.equal(count(await calls(page), 'audio_load_and_play') + count(await calls(page), 'audio_load_file'), 0, 'stale excluded entries cannot create a new playback queue')
  await page.evaluate(() => { window.holdScans = false; window.pendingScans.splice(0).forEach(job => job.resolve()) })
  await ready(page)

  // Re-enabling plus a failed rescan must reveal retained last-good data/cache.
  await page.evaluate(() => { window.scanFailures = ['/music'] })
  await save(page, roots => roots.map(root => root.path === '/music' ? { ...root, selected: true, directoryRules: [{ relativePath: 'Album', selected: false }] } : root))
  await ready(page)
  assert.deepEqual(await ids(page), ['other', 'root', 'root2'])
  assert.equal(await page.evaluate(() => window.vm.playlist.library.allSongs.find(song => song.trackId === 'root').track.title), title, 'disabled raw metadata is retained')
  assert.equal(await page.evaluate(() => window.lastSaveError), null, 'scan failure does not fail an already saved setting')
  assert((await committed(page)).roots.find(root => root.path === '/music').selected)

  // Independent child remains after parent removal, including its own visibility rules.
  await save(page, roots => roots.filter(root => root.path !== '/music').map(root => root.path === '/music/Album' ? { ...root, selected: false, directoryRules: [{ relativePath: 'Disc', selected: true }] } : root))
  await ready(page)
  assert.deepEqual(await ids(page), ['deep', 'other'])
  assert(!(await committed(page)).roots.some(root => root.path === '/music'))
  assert.deepEqual(await page.evaluate(() => window.vm.queue.tracks.map(track => track.id)), queue)

  // Storage failure and CAS conflict leave committed settings unchanged.
  const beforeFailure = await committed(page)
  await page.evaluate(() => { window.saveFailure = true; window.requests = [] })
  await save(page, roots => roots.filter(root => root.path !== '/music/Album'))
  assert.deepEqual(await committed(page), beforeFailure)
  assert.equal(count(await calls(page), 'library_scan_folder'), 0)
  await page.evaluate(() => { window.saveFailure = false; window.settings.revision++ })
  await save(page, () => [])
  assert.deepEqual(await committed(page), beforeFailure)
  assert.equal(await page.evaluate(() => window.lastSaveError), 'Controlled revision conflict')
  evidence.push({ stage: 'hook-contract', queue, committed: await committed(page), candidates: await ids(page) })
  await page.close()

  // Real menu transitions into the chooser without opening the OS picker.
  const ui = await open()
  await ui.evaluate(() => window.vm.playlist.library.onSelectCategory('folders'))
  await ui.getByRole('button', { name: '更多文件夹操作', exact: true }).click()
  await resetCalls(ui)
  await ui.getByRole('button', { name: '选择文件夹', exact: true }).click()
  const dialog = ui.getByRole('dialog', { name: '文件夹选择', exact: true })
  await dialog.waitFor()
  await settle(ui)
  assert.equal(count(await calls(ui), 'library_select_folders'), 0)
  assert.equal(await ui.getByRole('dialog').count(), 1, 'menu and chooser never compete as focus traps')
  await ui.waitForFunction(() => !document.querySelector('.folder-selection-row .folder-selection-name[title="/music-else"]')?.closest('.folder-selection-row').querySelector('.folder-selection-expand'))
  assert.equal(await rootRow(dialog, '/music-else').getByRole('button', { name: '展开 music-else' }).count(), 0, 'a root with no child directories has no arrow after initial direct-child probe')
  await ui.screenshot({ path: `${directory}/folder-selection-1280.png` })
  const geometry = await dialog.evaluate(node => {
    const style = getComputedStyle(node), title = node.querySelector('h2'), tree = node.querySelector('.folder-selection-tree'), footer = node.querySelector('footer')
    const box = element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
    return { dialog: box(node), background: style.backgroundColor, radius: style.borderRadius, title: { ...box(title), font: getComputedStyle(title).fontSize, line: getComputedStyle(title).lineHeight }, tree: box(tree), footer: box(footer), icons: [...node.querySelectorAll('img')].map(img => ({ name: img.src.split('/').at(-1), loaded: img.complete, natural: [img.naturalWidth, img.naturalHeight], width: img.width, height: img.height })) }
  })
  assert.equal(geometry.dialog.width, 566); assert.equal(geometry.dialog.height, 956)
  assert.equal(geometry.radius, '30px'); assert.equal(geometry.background, 'rgb(247, 249, 255)')
  assert.equal(geometry.title.font, '32px'); assert.equal(geometry.title.line, '40px')
  assert(geometry.icons.every(icon => icon.loaded && icon.natural[0] > 0 && icon.natural[1] > 0), 'exact SVG assets load with nonempty natural dimensions')
  for (const icon of geometry.icons) assert.deepEqual([icon.width, icon.height], icon.natural, `natural icon size: ${icon.name}`)
  const music = rootRow(dialog, '/music')
  await music.getByRole('button', { name: '展开 music', exact: true }).click()
  const empty = childRow(dialog, '/music/Empty')
  await empty.waitFor()
  assert.equal(await empty.getByRole('button').count(), 0, 'known empty child is a leaf with no arrow')
  const denied = childRow(dialog, '/music/Denied')
  assert.equal(await denied.getByRole('button', { name: '展开 Denied' }).count(), 1, 'IO-unknown directory is expandable, never a false leaf')
  await music.getByRole('checkbox').click()
  const album = childRow(dialog, '/music/Album').first()
  assert.equal(await checked(album), 'false', 'unchecked parent changes descendants')
  await album.getByRole('button', { name: '展开 Album', exact: true }).click()
  const disc = childRow(dialog, '/music/Album/Disc')
  await disc.getByRole('checkbox').click()
  assert.equal(await checked(disc), 'true')
  assert.equal(await checked(album), 'mixed')
  assert.equal(await checked(music), 'mixed', 'unchecked root plus checked grandchild is mixed')
  const leafOffset = await disc.locator('.folder-selection-name').evaluate(node => node.getBoundingClientRect().x - document.querySelector('.folder-selection-row[data-root]').getBoundingClientRect().x)
  assert.equal(leafOffset, 96, 'desktop depth-two leaf text follows Figma 96px inset')
  await ui.screenshot({ path: `${directory}/folder-selection-mixed.png` })
  await ui.evaluate(() => { window.pickedPaths = ['/music', '/new'] })
  await dialog.getByRole('button', { name: '添加文件夹或存储', exact: true }).click()
  await rootRow(dialog, '/new').waitFor()
  assert.equal(await checked(rootRow(dialog, '/new')), 'true', 'new root is selected by default')
  assert.equal(await checked(music), 'mixed', 'duplicate native pick preserves all draft rules')
  assert.equal(await rootRow(dialog, '/music').count(), 1)
  await ui.evaluate(() => { window.pickedPaths = null })
  await dialog.getByRole('button', { name: '添加文件夹或存储', exact: true }).click()
  assert.equal(await dialog.locator('.folder-selection-row[data-root]').count(), 5, 'picker cancel leaves draft untouched')
  await music.getByRole('checkbox').click()
  assert.equal(await checked(music), 'true')
  assert.equal(await checked(album), 'true')
  assert.equal(await checked(disc), 'true', 'parent toggle clears descendant overrides')
  await rootRow(dialog, '/new').getByRole('button', { name: '移除 new' }).click()
  assert.equal(count(await calls(ui), 'library_replace_folders'), 0, 'remove, toggle and picker do not commit')
  assert.equal(count(await calls(ui), 'library_scan_folder'), 0, 'draft editing never scans audio')
  await ui.setViewportSize({ width: 390, height: 740 })
  await ui.waitForFunction(() => document.querySelector('.folder-selection-dialog')?.getBoundingClientRect().width <= 358)
  const narrow = await dialog.evaluate(node => { const footer = node.querySelector('footer').getBoundingClientRect(); return { width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, footerBottom: footer.bottom, viewport: innerHeight } })
  await ui.screenshot({ path: `${directory}/folder-selection-390.png` })
  assert(narrow.width <= 358 && narrow.scrollWidth <= narrow.clientWidth, `narrow chooser has no horizontal overflow: ${JSON.stringify(narrow)}`)
  assert(narrow.footerBottom <= narrow.viewport, 'fixed footer stays reachable on narrow viewport')
  for (let index = 0; index < 18; index++) { await ui.keyboard.press('Tab'); assert(await dialog.evaluate(node => node.contains(document.activeElement)), 'Tab focus stays inside the only dialog') }
  await music.getByRole('checkbox').focus()
  await ui.keyboard.press('Space')
  assert.equal(await checked(music), 'false', 'Space toggles the focused real checkbox')
  await rootRow(dialog, '/missing').getByRole('button', { name: '移除 missing', exact: true }).click()
  evidence.push({ stage: 'dialog', geometry, narrow })
  await dismiss(ui, dialog)
  assert.equal(await ui.evaluate(() => document.activeElement?.getAttribute('aria-label')), '更多文件夹操作', 'Escape restores focus to original root More trigger')
  assert.equal(count(await calls(ui), 'library_replace_folders'), 0)

  // Failure leaves the exact draft open; Save blocks dismissal until native commit returns.
  const retryDialog = await chooser(ui)
  assert.equal(await checked(rootRow(retryDialog, '/music')), 'true', 'Escape discarded draft edits')
  assert.equal(await rootRow(retryDialog, '/missing').count(), 1, 'Escape restores a root removed only from the draft')
  await rootRow(retryDialog, '/music').getByRole('checkbox').click()
  await ui.evaluate(() => { window.holdSave = true; window.saveFailure = true; window.requests = [] })
  await retryDialog.getByRole('button', { name: '保存并扫描', exact: true }).click()
  await ui.waitForFunction(() => window.pendingSaves.length === 1)
  await ui.keyboard.press('Escape')
  assert(await retryDialog.isVisible(), 'save busy ignores Escape')
  await ui.mouse.click(2, 2)
  assert(await retryDialog.isVisible(), 'save busy ignores backdrop')
  assert.equal(await retryDialog.getByRole('checkbox', { disabled: false }).count(), 0)
  await ui.evaluate(() => { window.holdSave = false; window.pendingSaves.splice(0).forEach(resolve => resolve()) })
  await retryDialog.getByRole('alert').filter({ hasText: 'Controlled atomic write failure' }).waitFor()
  assert.equal(await checked(rootRow(retryDialog, '/music')), 'false', 'failed save preserves edited draft')
  assert.equal((await committed(ui)).roots.find(root => root.path === '/music').selected, true)
  assert.equal(count(await calls(ui), 'library_scan_folder'), 0)
  assert.equal(count(await calls(ui), 'library_get_folders'), 0, 'ordinary storage failure never refreshes or replaces the committed context')
  await ui.evaluate(() => { window.saveFailure = false })
  await retryDialog.getByRole('button', { name: '保存并扫描', exact: true }).click()
  await retryDialog.waitFor({ state: 'hidden' })
  await ready(ui)
  assert.equal((await committed(ui)).roots.find(root => root.path === '/music').selected, false)

  // A real external revision conflict preserves this draft, then reopening adopts latest settings.
  const beforeConflict = await committed(ui)
  const conflictDialog = await chooser(ui)
  await rootRow(conflictDialog, '/music').getByRole('checkbox').click()
  const external = await ui.evaluate(() => {
    window.settings = { revision: window.settings.revision + 1, roots: [...window.settings.roots, { path: '/external', selected: false, directoryRules: [] }] }
    window.requests = []
    return structuredClone(window.settings)
  })
  await conflictDialog.getByRole('button', { name: '保存并扫描', exact: true }).click()
  await conflictDialog.getByRole('alert').filter({ hasText: 'Controlled revision conflict' }).waitFor()
  await ui.waitForFunction(() => !window.vm.folderSelection.isSaving)
  assert.deepEqual(await committed(ui), beforeConflict, 'conflict refresh never overwrites the mounted editor committed context')
  assert.equal(await checked(rootRow(conflictDialog, '/music')), 'true', 'CAS conflict retains edited draft')
  assert.equal(await rootRow(conflictDialog, '/external').count(), 0, 'external settings wait until a new draft session')
  let conflictCalls = await calls(ui)
  assert.equal(conflictCalls.find(call => call.command === 'library_replace_folders').args.input.expectedRevision, beforeConflict.revision)
  assert.equal(count(conflictCalls, 'library_get_folders'), 1, 'CAS failure reads the actual newer registry once')
  assert.equal(count(conflictCalls, 'library_scan_folder'), 0)
  await dismiss(ui, conflictDialog)
  const refreshedDialog = await chooser(ui)
  assert.deepEqual(await committed(ui), external, 'reopening adopts the newer revision and external roots')
  assert.equal(await checked(rootRow(refreshedDialog, '/music')), 'false', 'reopened draft starts from latest settings, discarding the conflicted edit')
  assert.equal(await checked(rootRow(refreshedDialog, '/external')), 'false')
  await rootRow(refreshedDialog, '/music').getByRole('checkbox').click()
  await resetCalls(ui)
  await refreshedDialog.getByRole('button', { name: '保存并扫描', exact: true }).click()
  await refreshedDialog.waitFor({ state: 'hidden' })
  await ready(ui)
  conflictCalls = await calls(ui)
  assert.equal(conflictCalls.find(call => call.command === 'library_replace_folders').args.input.expectedRevision, external.revision, 'retry submits fresh CAS revision')
  assert.equal((await committed(ui)).revision, external.revision + 1)
  assert.equal((await committed(ui)).roots.find(root => root.path === '/music').selected, true)
  assert((await committed(ui)).roots.some(root => root.path === '/external'), 'successful retry preserves externally added root')
  evidence.push({ stage: 'external-CAS-recovery', conflictedRevision: beforeConflict.revision, refreshedRevision: external.revision, savedRevision: (await committed(ui)).revision })

  // Closing picker and enumeration sessions invalidates late replies, including after reopening.
  const lateDialog = await chooser(ui)
  await ui.evaluate(() => { window.holdPicker = true })
  await lateDialog.getByRole('button', { name: '添加文件夹或存储', exact: true }).click()
  await ui.waitForFunction(() => window.pendingPickers.length === 1)
  await dismiss(ui, lateDialog)
  const freshDialog = await chooser(ui)
  await ui.evaluate(() => { window.holdPicker = false; window.pendingPickers.splice(0).forEach(resolve => resolve(['/late-picker'])) })
  await settle(ui)
  assert.equal(await rootRow(freshDialog, '/late-picker').count(), 0, 'closed picker cannot mutate a new draft')
  await rootRow(freshDialog, '/music').getByRole('button', { name: '展开 music', exact: true }).click()
  await childRow(freshDialog, '/music/Denied').waitFor()
  await ui.evaluate(() => { window.holdTrees = true })
  await childRow(freshDialog, '/music/Denied').getByRole('button', { name: '展开 Denied', exact: true }).click()
  await ui.waitForFunction(() => window.pendingTrees.length === 1)
  await dismiss(ui, freshDialog)
  await ui.evaluate(() => { window.holdTrees = false })
  const reopen = await chooser(ui)
  await ui.evaluate(() => { window.pendingTrees.splice(0).forEach(resolve => resolve()) })
  await settle(ui)
  assert.equal(await childRow(reopen, '/music/Empty').count(), 0, 'old enumeration cannot populate a reopened draft')
  await rootRow(reopen, '/music').getByRole('button', { name: '展开 music', exact: true }).click()
  await childRow(reopen, '/music/Denied').waitFor()
  await ui.evaluate(() => { window.treeFailure = true })
  await childRow(reopen, '/music/Denied').getByRole('button', { name: '展开 Denied', exact: true }).click()
  await reopen.getByRole('alert').filter({ hasText: 'Controlled directory failure' }).waitFor()
  await ui.evaluate(() => { window.treeFailure = false })
  await reopen.getByRole('button', { name: '重试', exact: true }).click()
  await childRow(reopen, '/music/Empty').waitFor()
  await dismiss(ui, reopen)
  evidence.push({ stage: 'UI-save-and-lifecycle', committed: await committed(ui) })
  await ui.close()

  // A removed root and a re-added root own different enumeration generations.
  const races = await open()
  let raceDialog = await chooser(races)
  await races.evaluate(() => { window.holdTrees = true; window.pickedPaths = ['/race']; window.treeOverrides = { '/race': [{ path: '/race/old', name: 'old', hasChildren: false }] } })
  await raceDialog.getByRole('button', { name: '添加文件夹或存储', exact: true }).click()
  await races.waitForFunction(() => window.pendingTrees.length === 1)
  await rootRow(raceDialog, '/race').getByRole('button', { name: '移除 race', exact: true }).click()
  await races.evaluate(() => { window.holdTrees = false; window.treeOverrides['/race'] = [{ path: '/race/fresh', name: 'fresh', hasChildren: false }] })
  await raceDialog.getByRole('button', { name: '添加文件夹或存储', exact: true }).click()
  await rootRow(raceDialog, '/race').getByRole('button', { name: '展开 race', exact: true }).click()
  await childRow(raceDialog, '/race/fresh').waitFor()
  await races.evaluate(() => window.pendingTrees.splice(0).forEach(resolve => resolve()))
  await settle(races)
  assert.equal(await childRow(raceDialog, '/race/old').count(), 0, 'late result from removed root cannot overwrite re-added root cache')
  await dismiss(races, raceDialog)

  // Clear closes old drafts; native results cannot resurrect them. Backdrop restores the root trigger.
  await races.emulateMedia({ reducedMotion: 'no-preference' })
  await races.evaluate(() => { window.dialogCounts = []; window.transitionCount = 0; const start = document.startViewTransition?.bind(document); if (start) document.startViewTransition = callback => { window.transitionCount++; return start(callback) }; window.dialogObserver = new MutationObserver(() => window.dialogCounts.push(document.querySelectorAll('[role="dialog"]').length)); window.dialogObserver.observe(document.body, { childList: true, subtree: true }) })
  raceDialog = await chooser(races)
  await rootRow(raceDialog, '/music').getByRole('checkbox').click()
  await races.mouse.click(2, 2)
  await raceDialog.waitFor({ state: 'hidden' })
  assert.equal(await races.evaluate(() => document.activeElement?.getAttribute('aria-label')), '更多文件夹操作', 'backdrop restores original More trigger')
  assert(await races.evaluate(() => window.dialogCounts.every(count => count <= 1)), 'motion transfer never mounts two live focus traps')
  assert(await races.evaluate(() => !document.startViewTransition || window.transitionCount > 0), 'normal motion uses the actual view transition')
  await races.emulateMedia({ reducedMotion: 'reduce' })
  raceDialog = await chooser(races)
  assert.equal(await checked(rootRow(raceDialog, '/music')), 'true', 'backdrop discarded the unchecked draft')
  await races.evaluate(() => { window.holdPicker = true })
  await raceDialog.getByRole('button', { name: '添加文件夹或存储', exact: true }).click()
  await races.waitForFunction(() => window.pendingPickers.length === 1)
  await races.evaluate(() => window.librarySettings.onClear())
  await raceDialog.waitFor({ state: 'hidden' })
  await races.waitForFunction(() => window.vm.folderSelection.committed?.roots.length === 0)
  await races.evaluate(() => window.pendingPickers.splice(0).forEach(resolve => resolve(['/resurrect'])))
  await settle(races)
  assert.deepEqual((await committed(races)).roots, [])
  assert.deepEqual(await ids(races), [])
  await races.close()

  const unmount = await open()
  const unmountDialog = await chooser(unmount)
  await unmount.evaluate(() => { window.holdPicker = true })
  await unmountDialog.getByRole('button', { name: '添加文件夹或存储', exact: true }).click()
  await unmount.waitForFunction(() => window.pendingPickers.length === 1)
  await unmount.evaluate(() => { window.testRoot.unmount(); window.pendingPickers.splice(0).forEach(resolve => resolve(['/after-unmount'])) })
  await settle(unmount)
  assert.equal(await unmount.getByRole('dialog').count(), 0, 'unmounted picker result never publishes a dialog')
  await unmount.close()

  const startup = await open('?disabled=1', 1)
  assert.deepEqual((await calls(startup)).filter(call => call.command === 'library_scan_folder').map(call => call.args.path), ['/music-else'], 'startup scans active settings only')
  assert.equal((await committed(startup)).roots.length, 4, 'startup retains disabled registration')
  await resetCalls(startup)
  await startup.evaluate(() => window.vm.playlist.library.onRescanFolders())
  await startup.waitForFunction(() => !window.vm.playlist.library.isFolderRescanPending)
  assert.deepEqual((await calls(startup)).filter(call => call.command === 'library_scan_folder').map(call => call.args.path), ['/music-else'], 'rescan uses active settings only')
  const activeEntries = await startup.evaluate(() => window.vm.playlist.library.allSongs.map(({ scope, trackId }) => ({ scope, trackId })))
  assert.equal(await startup.evaluate(entries => window.vm.playlist.library.onShufflePlay(entries), activeEntries), true)
  assert.deepEqual(await startup.evaluate(() => window.vm.queue.tracks.map(row => row.id)), ['other'], 'new queue includes active root candidates only')
  evidence.push({ stage: 'late-remove-clear-unmount-startup', startup: await committed(startup) })
  await startup.close()

  const restored = await open('?disabled=1', 1, { version: 1, sourcePath: '/music/root.flac', playlist: { sourceKind: 'folder', sourcePath: '/music', folderMode: 'library' }, positionMs: 0, wasPlaying: false, wasPaused: true, queueOpen: false, volume: 50 })
  await restored.waitForFunction(() => window.vm.playback.track?.id === 'root' && !window.vm.playback.isAudioBusy)
  assert.deepEqual(await ids(restored), ['other'], 'dedicated raw snapshot restore never republishes disabled library songs')
  assert.deepEqual(await restored.evaluate(() => window.vm.queue.tracks.map(row => row.id)), ['root', 'root2', 'album', 'deep'], 'saved playback queue may restore its own disabled raw source')
  assert.deepEqual((await calls(restored)).filter(call => call.command === 'library_scan_folder').map(call => call.args.path).sort(), ['/music', '/music-else'], 'only the saved playback snapshot receives the explicit inactive raw scan exception')
  await restored.evaluate(() => window.vm.playlist.onOpenChange(false))
  await restored.evaluate(() => window.vm.playlist.onOpenChange(true))
  await settle(restored)
  assert.equal(await restored.evaluate(() => window.vm.playlist.tracks.length), 0, 'disabled restored library queue remains separate from folder detail')
  evidence.push({ stage: 'disabled-snapshot-restore', candidates: await ids(restored), queue: await restored.evaluate(() => window.vm.queue.tracks.map(row => row.id)) })
  await restored.close()

  // Library detail uses committed selection while the existing playback snapshot continues.
  const detail = await open()
  console.log('FOLDER_SELECTION_STAGE detail-regression')
  const musicScope = await detail.evaluate(() => window.vm.playlist.library.items.find(item => item.name === 'music').scope)
  await detail.evaluate(scope => window.vm.playlist.library.onPlay(scope), musicScope)
  await detail.waitForFunction(() => window.vm.playback.track?.id === 'root' && !window.vm.playback.isAudioBusy)
  await detail.evaluate(scope => window.vm.playlist.library.onSelect(scope), musicScope)
  await detail.waitForFunction(() => window.vm.playlist.tracks.length === 4)
  const detailQueue = await detail.evaluate(() => window.vm.queue.tracks.map(row => row.id))
  await detail.evaluate(() => { window.vm.playlist.library.onSelectCategory('folders'); window.vm.playlist.library.onFolderLocationChange({ rootPath: '/music', directoryPath: '/music/Album' }) })
  await save(detail, roots => roots.map(root => root.path === '/music' ? { ...root, directoryRules: [{ relativePath: 'Album', selected: false }] } : root))
  await ready(detail)
  assert.deepEqual(await detail.evaluate(() => window.vm.playlist.library.folderLocation), { rootPath: '/music', directoryPath: '/music' }, 'saving excludes current branch and returns to legal ancestor')
  assert.deepEqual(await ids(detail), ['album', 'deep', 'other', 'root', 'root2'], 'independent overlapping child keeps its union candidates')
  await detail.evaluate(scope => window.vm.playlist.library.onSelect(scope), musicScope)
  assert.deepEqual(await detail.evaluate(() => window.vm.playlist.tracks.map(row => row.id).sort()), ['root', 'root2'], 'parent root detail excludes child selected through another root')
  await detail.evaluate(() => { window.vm.playlist.library.onSelectCategory('folders'); window.vm.playlist.library.onFolderLocationChange({ rootPath: '/music', directoryPath: '/music' }) })
  await detail.getByRole('heading', { name: 'music', exact: true }).waitFor()
  assert.equal(await detail.locator('[data-folder-path="/music/Album"]').count(), 0, 'overlapping child cannot reappear inside excluded parent hierarchy')
  const parentMetadata = await detail.locator('.folder-hero .playlist-hero-meta, .playlist-hero .playlist-hero-meta').filter({ has: detail.locator('svg') }).innerText()
  assert.match(parentMetadata, /^2\b/, 'parent hierarchy recursive count respects its own selection')
  await detail.evaluate(scope => window.vm.playlist.library.onSelect(scope), musicScope)
  await save(detail, roots => roots.map(root => root.path === '/music' ? { ...root, selected: false, directoryRules: [] } : root))
  await ready(detail)
  assert.equal(await detail.evaluate(() => window.vm.playlist.tracks.length), 0, 'disabled library detail cannot expose its playback snapshot')
  assert.deepEqual(await detail.evaluate(() => window.vm.queue.tracks.map(row => row.id)), detailQueue)
  await save(detail, roots => roots.filter(root => root.path !== '/music'))
  await ready(detail)
  for (let index = 0; index < 3; index++) {
    await detail.evaluate(() => window.vm.playlist.onOpenChange(false))
    await detail.evaluate(() => window.vm.playlist.onOpenChange(true))
    await settle(detail)
    assert.equal(await detail.evaluate(() => window.vm.playlist.tracks.length), 0, 'removed root never falls back to current queue after reopening')
  }
  assert.deepEqual(await detail.evaluate(() => window.vm.queue.tracks.map(row => row.id)), detailQueue)
  evidence.push({ stage: 'detail-selection-boundary', parentMetadata, queue: detailQueue, candidates: await ids(detail) })
  await detail.close()

  // Directly opened files retain their unregistered sibling detail and shuffle behavior.
  const direct = await open()
  console.log('FOLDER_SELECTION_STAGE direct-file-regression')
  await direct.evaluate(() => { window.directFile = true; window.vm.playback.onOpenAudio() })
  await direct.waitForFunction(() => window.vm.playback.track?.id === 'direct-a' && !window.vm.playback.isAudioBusy)
  await direct.evaluate(() => window.vm.playlist.onOpenChange(false))
  await direct.evaluate(() => window.vm.playlist.onOpenChange(true))
  await direct.waitForFunction(() => window.vm.playlist.tracks.length === 2)
  assert.deepEqual(await direct.evaluate(() => window.vm.playlist.tracks.map(row => row.id).sort()), ['direct-a', 'direct-b'])
  assert.equal(await direct.evaluate(() => window.vm.playlist.onShufflePlay(['direct-a', 'direct-b'])), true, 'selection guard permits unregistered direct-file sibling shuffle')
  assert.deepEqual(await direct.evaluate(() => window.vm.queue.tracks.map(row => row.id).sort()), ['direct-a', 'direct-b'])
  evidence.push({ stage: 'direct-file-regression', siblings: await direct.evaluate(() => window.vm.queue.tracks.map(row => row.id)) })
  await direct.close()
  assert.deepEqual(errors, [], 'no uncaught errors in the actual application')
  writeFileSync(`${directory}/results.json`, JSON.stringify(evidence, null, 2))
  console.log('FOLDER_SELECTION_ACCEPTANCE', JSON.stringify(evidence))
} finally {
  await browser.close()
}
