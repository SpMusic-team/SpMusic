// Vite + existing Playwright; real shell, menus, shared dialogs and IPC parsers.
// Native IO alone is deterministic. No real library files are removed.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const realMenu = await (await fetch(origin + '/src/features/player/components/MoreActionsMenu.tsx')).text()
const dependency = name => {
  const match = (entry + realSurface + realMenu).match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const shared = readFileSync(new URL('./allSongs.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal, 'reuse native transport fixture without running its suite')
let fixture = runInNewContext(literal[1], { dependency })
fixture=fixture.replace('React.createElement(PlayerShell)','React.createElement(IconProbe)')
fixture+=`
import {AddCircle48Regular,CheckmarkCircle48Regular} from '${dependency('@fluentui_react-icons.js')}';
function IconProbe(){return React.createElement(React.Fragment,null,React.createElement(PlayerShell),React.createElement('div',{hidden:true},React.createElement('span',{'data-expected-icon':'plus'},React.createElement(AddCircle48Regular)),React.createElement('span',{'data-expected-icon':'checked'},React.createElement(CheckmarkCircle48Regular))))}
`
fixture = fixture.replace("artist:'Artist '+row.id,album:'Album '+row.id", "artist:new URLSearchParams(location.search).has('unknown')?null:'Artist '+row.id,album:new URLSearchParams(location.search).has('unknown')?null:'Album '+row.id")
const renderMarker = "ReactDOM.createRoot(document.getElementById('root')).render("
fixture = fixture.replace(renderMarker, `
window.persistedPlaylists=['a','b','c'].map(choice=>{window.choice=choice;window.playlistImport=true;return playlist()});
window.choice='a';window.playlistImport=false;window.deletedPaths=[];
window.folderSettings={revision:0,roots:[{path:'/audio/a',selected:true,directoryRules:[]}]};
const nativeInvoke=window.backendInvoke;
window.backendInvoke=async(command,args)=>{
 const input=args?.input;
 if(command==='library_get_playlists')return structuredClone(window.persistedPlaylists);
 if(command==='library_get_folders')return structuredClone(window.folderSettings);
 if(command==='library_add_playlist_tracks'){
  window.calls.push({command,input});
  const target=window.persistedPlaylists.find(item=>item.sourcePath===input.sourcePath);
  const existing=new Set(target.tracks.map(item=>item.sourcePath));
  const addedPaths=[...new Set(input.trackPaths)].filter(path=>!existing.has(path));
  const alreadyPresentPaths=input.trackPaths.filter(path=>existing.has(path));
  const additions=addedPaths.map(path=>({...byPath.get(path)}));
  const next={...target,tracks:input.position==='start'?[...additions,...target.tracks]:[...target.tracks,...additions]};
  window.persistedPlaylists=window.persistedPlaylists.map(item=>item===target?next:item);
  return {playlist:next,addedPaths,alreadyPresentPaths,failures:[]};
 }
 if(command==='library_delete_tracks'){
  window.calls.push({command,input});
  if(window.deleteError)throw {code:'STORAGE_ERROR',message:'fixture delete rejected',recoverable:true};
  const removedPaths=[...new Set(input.trackPaths)];
  if(input.mode==='files')window.deletedPaths.push(...removedPaths);
  window.persistedPlaylists=window.persistedPlaylists.map(item=>input.mode==='files'||item.sourcePath===input.sourcePath?{...item,tracks:item.tracks.filter(row=>!removedPaths.includes(row.sourcePath)),selectedIndex:0}:item);
  if(input.mode==='files'&&currentTrack&&removedPaths.includes(currentTrack.sourcePath)){
   currentTrack=null;state={...state,phase:'idle',generation:++generation,currentTrackId:null,durationMs:null,positionMs:0};
  }
  return {removedPaths,failures:[],playlists:structuredClone(window.persistedPlaylists),state:input.mode==='files'?{...state}:null,storageError:null};
 }
 return nativeInvoke(command,args);
};
${renderMarker}`)
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__more_integration_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(Surface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__more_integration_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
let passed = 0

async function open(width = 1440, unknown = false) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(12000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('spmusic.playlist.layout-level.v1', '4'))
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__more_integration_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__more_integration_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__more_integration_test*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__more_integration_test' + (unknown ? '?unknown=1' : ''))
  await page.waitForFunction(() => window.viewModel?.folderSelection?.committed && !window.viewModel.playlist.library.isPlaylistRestorePending && window.viewModel.playlist.library.items.some(item => item.scope.includes('/audio/a')))
  await page.evaluate(() => window.viewModel.playlist.library.onPlay(window.viewModel.playlist.library.items.find(item => item.scope.includes('/lists/a.m3u8')).scope))
  await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isSelectionPending && !window.viewModel.playback.detailsPending)
  return { page, errors }
}
async function begin(page, label) {
  const menu = page.locator('.more-actions-menu')
  if (!await menu.isVisible()) await page.locator('.track-card-plane[data-track-card-phase="active"] .more-button').click()
  await menu.waitFor()
  await menu.getByRole('button', { name: label, exact: true }).click()
  if (!['删除','播放列表'].includes(label)) await menu.waitFor({ state: 'hidden' })
}
const calls = (page, command) => page.evaluate(command => window.calls.filter(call => call.command === command), command)
const target = (page, name) => page.locator('.playlist-add-row').filter({ hasText: name })
async function assertEntryIcon(page,checked) {
  const entry=page.locator('.more-actions-menu .more-action').filter({hasText:'播放列表'})
  await page.waitForFunction(checked=>{
    const entry=[...document.querySelectorAll('.more-actions-menu .more-action')].find(button=>button.getAttribute('aria-label')==='播放列表')
    const reference=document.querySelector('[data-expected-icon="'+(checked?'checked':'plus')+'"] path')
    return entry?.dataset.containsTrack===String(checked)&&entry.querySelector('svg path')?.getAttribute('d')===reference?.getAttribute('d')
  },checked)
  assert.equal(await entry.getAttribute('data-contains-track'),String(checked))
  assert.equal(await entry.locator('svg').getAttribute('viewBox'),'0 0 48 48')
}
async function check(name, run, width, unknown = false) {
  if (process.env.SPMUSIC_MORE_FILTER && !name.includes(process.env.SPMUSIC_MORE_FILTER)) return
  const context = await open(width, unknown)
  try { await run(context.page); assert.deepEqual(context.errors, []); passed++; console.log('PASS', name) }
  finally { await context.page.close() }
}

try {
  await check('player controls omit search while captions volume queue and library search remain',async page=>{
    await page.setViewportSize({width:2560,height:1440})
    const dock=page.locator('.control-dock')
    await dock.waitFor()
    assert.equal(await dock.getByRole('button',{name:'搜索',exact:true}).count(),0)
    assert.equal(await dock.getByRole('button',{name:'桌面字幕暂未接入',exact:true}).isVisible(),true)
    await dock.locator('.volume-control > button').click()
    assert.equal(await dock.getByRole('group',{name:'音量控制',exact:true}).isVisible(),true)
    await dock.locator('.volume-control > button').click()
    await dock.getByRole('button',{name:'播放列表',exact:true}).click()
    await page.getByRole('region',{name:'播放队列',exact:true}).waitFor()
    await dock.getByRole('button',{name:'播放列表',exact:true}).click()
    await page.getByRole('region',{name:'播放队列',exact:true}).waitFor({state:'hidden'})
    await page.evaluate(()=>window.viewModel.playlist.library.onSelectCategory('songs'))
    const libraryDock=page.locator('.playlist-playback-dock:not([data-dock-superseded])')
    await libraryDock.getByRole('button',{name:'搜索',exact:true}).click()
    const search=page.getByRole('searchbox',{name:'聚合搜索',exact:true})
    await search.waitFor()
    await search.fill('A Song')
    await page.waitForFunction(()=>document.querySelectorAll('.search-songs .playlist-card').length===1)
    assert.match(await page.locator('.search-songs .playlist-card').textContent(),/A Song/)
    await libraryDock.getByRole('button',{name:'搜索',exact:true}).click()
    await page.locator('.search-page').waitFor({state:'hidden'})
    assert.equal(await page.evaluate(()=>window.viewModel.playlist.library.route.categoryId),'songs')
  })
  await check('menu entry reflects any playlist membership after add remove and track changes',async page=>{
    await page.locator('.more-button').click()
    await assertEntryIcon(page,true)
    async function toggle(name,checkedAfter) {
      await begin(page,'播放列表')
      const dialog=page.getByRole('dialog',{name:'播放列表',exact:true})
      const before=await target(page,name).getAttribute('aria-pressed')
      await target(page,name).click()
      await page.waitForFunction(({name,before})=>{
        const row=[...document.querySelectorAll('.playlist-add-row')].find(row=>row.textContent.includes(name))
        return row?.getAttribute('aria-pressed')!==before
      },{name,before})
      await dialog.getByRole('button',{name:'完成',exact:true}).click()
      await dialog.waitFor({state:'hidden'})
      await assertEntryIcon(page,checkedAfter)
    }
    await toggle('List a',false)
    await toggle('List b',true)
    await toggle('List c',true)
    await toggle('List b',true)
    await toggle('List c',false)
    assert.equal((await calls(page,'library_add_playlist_tracks')).length,2)
    await page.keyboard.press('Escape')
    await page.locator('.more-actions-menu').waitFor({state:'hidden'})
    await page.evaluate(()=>window.viewModel.playlist.library.onPlay(window.viewModel.playlist.library.items.find(item=>item.scope.includes('/lists/b.m3u8')).scope))
    await page.waitForFunction(()=>window.viewModel.playback.track?.id==='b-0'&&!window.viewModel.playback.isSelectionPending)
    await page.locator('.track-card-plane[data-track-card-phase="active"] .more-button').click()
    await assertEntryIcon(page,true)
    await page.keyboard.press('Escape')
    await page.locator('.more-actions-menu').waitFor({state:'hidden'})
    await page.evaluate(()=>window.viewModel.playlist.library.onPlaySong(window.viewModel.playlist.library.items.find(item=>item.scope.includes('/audio/a')).scope,'a-0'))
    await page.waitForFunction(()=>window.viewModel.playback.track?.id==='a-0'&&!window.viewModel.playback.isSelectionPending)
    await page.locator('.track-card-plane[data-track-card-phase="active"] .more-button').click()
    await assertEntryIcon(page,false)
  })
  await check('delete cancel and Escape leave current track and files untouched', async page => {
    await begin(page, '删除')
    let dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /确定删除/ }) })
    await dialog.waitFor()
    assert.equal((await calls(page, 'library_delete_tracks')).length, 0)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.more-actions-menu').isVisible(),true,'cancel returns to parent menu')
    await begin(page, '删除')
    dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /确定删除/ }) })
    await dialog.waitFor()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.more-actions-menu').isVisible(),true,'Escape closes only the nested confirmation')
    assert.equal((await calls(page, 'library_delete_tracks')).length, 0)
    assert.equal(await page.evaluate(() => window.viewModel.playback.track.id), 'a-0')
    assert.deepEqual(await page.evaluate(() => window.deletedPaths), [])
  })
  await check('current source list removal ignores separately browsed playlist', async page => {
    await page.evaluate(() => {
      const library=window.viewModel.playlist.library;
      library.onSelect(library.items.find(item=>item.scope.includes('/lists/b.m3u8')).scope);
    })
    await page.waitForFunction(() => window.viewModel.playlist.library.currentScope?.includes('/lists/b.m3u8'))
    await page.evaluate(() => window.viewModel.playlist.onOpenChange(false))
    await begin(page, '删除')
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /确定删除/ }) })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: '删除', exact: true }).click()
    await page.waitForFunction(() => window.calls.some(call=>call.command==='library_delete_tracks'))
    const records=await calls(page,'library_delete_tracks')
    assert.equal(records.length,1)
    assert.deepEqual(records[0].input,{mode:'list',sourcePath:'/lists/a.m3u8',trackPaths:['/audio/a/0.flac']})
    assert.deepEqual(await page.evaluate(()=>window.deletedPaths),[])
    assert.equal(await page.evaluate(()=>window.persistedPlaylists.find(item=>item.sourcePath==='/lists/b.m3u8').tracks.length),2)
  })
  await check('scanned folder requires explicit file mode and clears deleted current track',async page=>{
    await page.evaluate(()=>window.viewModel.playlist.library.onPlay(window.viewModel.playlist.library.items.find(item=>item.scope.includes('/audio/a')).scope))
    await page.waitForFunction(()=>window.viewModel.playback.moreActions?.deleteSnapshot?.canRemoveFromList===false&&!window.viewModel.playback.isSelectionPending)
    await begin(page,'删除')
    const dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:/确定删除/})})
    await dialog.waitFor()
    assert.equal(await dialog.getByRole('button',{name:'删除',exact:true}).isDisabled(),true)
    await dialog.getByRole('button',{name:'删除文件',exact:true}).click()
    assert.equal((await calls(page,'library_delete_tracks')).length,0,'selecting file mode does not mutate')
    await dialog.getByRole('button',{name:'删除',exact:true}).click()
    await page.waitForFunction(()=>window.deletedPaths.length===1&&window.viewModel.playback.track===null)
    const records=await calls(page,'library_delete_tracks')
    assert.equal(records.length,1)
    assert.equal(records[0].input.mode,'files')
    assert.deepEqual(records[0].input.trackPaths,['/audio/a/0.flac'])
  })
  await check('backend delete rejection stays visible and retry invokes the same frozen snapshot once',async page=>{
    await page.evaluate(()=>{window.deleteError=true})
    await begin(page,'删除')
    const dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:/确定删除/})})
    await dialog.getByRole('button',{name:'删除',exact:true}).click()
    await dialog.getByRole('alert').filter({hasText:'fixture delete rejected'}).waitFor()
    assert.equal(await dialog.isVisible(),true)
    assert.equal(await page.evaluate(()=>window.persistedPlaylists.find(item=>item.sourcePath==='/lists/a.m3u8').tracks.length),2)
    await page.evaluate(()=>{window.deleteError=false})
    await dialog.getByRole('button',{name:'删除',exact:true}).evaluate(button=>{button.click();button.click()})
    await dialog.waitFor({state:'hidden'})
    const records=await calls(page,'library_delete_tracks')
    assert.equal(records.length,2,'one failed attempt plus one retry despite double click')
    assert.deepEqual(records[0].input,records[1].input)
  })
  await check('playlist membership uses existing checked asset and additions stay unique', async page => {
    await begin(page,'播放列表')
    const dialog=page.getByRole('dialog',{name:'播放列表',exact:true})
    await dialog.waitFor()
    assert.equal(await target(page,'List a').getAttribute('aria-pressed'),'true')
    assert.equal(await target(page,'List b').getAttribute('aria-pressed'),'false')
    assert(await target(page,'List a').locator('.playlist-selection-icon').evaluate(async element=>{
      const source=(await import('/src/assets/selection-panel/playlist-add/checked.svg?import')).default
      return getComputedStyle(element).maskImage.includes(source)
    }),'uses existing circle-check asset')
    await target(page,'List b').click()
    await page.waitForFunction(()=>document.querySelector('.playlist-add-row[data-target-scope*="/lists/b.m3u8"]')?.getAttribute('aria-pressed')==='true')
    assert.equal((await calls(page,'library_add_playlist_tracks')).length,1)
    assert.deepEqual((await calls(page,'library_add_playlist_tracks'))[0].input.trackPaths,['/audio/a/0.flac'])
    const paths=await page.evaluate(()=>window.persistedPlaylists.find(item=>item.sourcePath==='/lists/b.m3u8').tracks.map(item=>item.sourcePath))
    assert.equal(paths.length,new Set(paths).size)
    await dialog.getByRole('button',{name:'完成',exact:true}).click()
    await dialog.waitFor({state:'hidden'})
  })
  for (const [label,category,location] of [['艺术家','artist','artistLocation'],['专辑','album','albumLocation'],['文件夹','folder','flatFolderLocation']]) {
    await check(label+' opens exact collection detail and exits player',async page=>{
      await begin(page,label)
      await page.waitForFunction(({category,location})=>window.viewModel.playlist.isOpen&&window.viewModel.playlist.library.route.categoryId===category&&window.viewModel.playlist.library[location]!==null,{category,location})
      const state=await page.evaluate(({location})=>({location:window.viewModel.playlist.library[location],track:window.viewModel.playback.track.id}),{location})
      assert.equal(state.track,'a-0')
      if(label==='文件夹')assert.equal(state.location.directoryPath,'/audio/a')
      else assert(JSON.stringify(state.location).includes(label==='专辑'?'Album a-0':'Artist a-0'),JSON.stringify(state.location))
      if(label==='艺术家')await page.locator('.album-card').filter({hasText:'Album a-0'}).first().waitFor()
      else await page.locator('.playlist-card').filter({hasText:'A Song'}).first().waitFor()
    })
  }
  for(const [label,category,location] of [['艺术家','artist','artistLocation'],['专辑','album','albumLocation']]) {
    await check('unknown '+label+' opens real null-metadata group',async page=>{
      await begin(page,label)
      await page.waitForFunction(({category,location})=>window.viewModel.playlist.isOpen&&window.viewModel.playlist.library.route.categoryId===category&&window.viewModel.playlist.library[location]!==null,{category,location})
      const value=await page.evaluate(location=>window.viewModel.playlist.library[location],location)
      assert(JSON.stringify(value).includes('null'),'uses unknown group identity rather than display placeholder')
      if(label==='艺术家')await page.locator('.album-card').filter({hasText:'未知专辑'}).first().waitFor()
      else await page.locator('.playlist-card').filter({hasText:'A Song'}).first().waitFor()
    },undefined,true)
  }
} finally { await browser.close() }
console.log(JSON.stringify({passed}))
