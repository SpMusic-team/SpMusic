// Independent acceptance: real PlayerShell and PlayerSurface, only native transport replaced.
// Vite must be running at SPMUSIC_TEST_ORIGIN (default http://127.0.0.1:5183).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const main = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = main.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve Vite dependency ${name}`)
  return match[1]
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const shortcutService = (await (await fetch(origin + '/src/features/shortcuts/services/globalShortcutCommands.ts')).text())
  .replace(/import \{ invoke, isTauri \} from [^;]+;/,'const isTauri=()=>true; const invoke=async(command,args)=>({bindings:{previous:"Ctrl+Alt+ArrowLeft",next:"Ctrl+Alt+ArrowRight",volumeUp:"Ctrl+Alt+ArrowUp",volumeDown:"Ctrl+Alt+ArrowDown",togglePlayback:"Ctrl+KeyP"},issues:[],suspended:args?.suspended??false});')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__compact_sidebar_acceptance_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;return React.createElement(RealSurface,props)}`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.summaryGate=new URLSearchParams(location.search).has('summaryGate');window.pendingSummaries=[];window.scanGate=false;window.pendingScans=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const roots=['/music','/hidden'];
window.pulse=(positionMs,phase=state.phase)=>{state={...state,positionMs,phase};window.listeners?.audio_state_changed?.({payload:{...state}})};
window.nativeState=()=>({...state});
const rows=[
 ['a','Shared','Singer A','Album Group','Writer One'],
 ['b','Shared','Singer B','Album Group','Writer Two'],
 ['duet','Shared','Singer A/Singer B','Album Group/Guest/Album Group','Writer One/Writer Two/Writer One'],
 ['missing','Missing','Performer Only',null,null],
 ['literal','Literal','Literal Performer','未知专辑艺术家','未知作曲家'],
 ['other','Other','Singer X','Another Album Credit','Writer Three'],
 ['collab','Other','Singer C','Album Group','Writer One'],
 ['band','Rock','Band Singer','AC/DC','AC/DC'],
 ['hidden','Hidden','Hidden Singer','Hidden Album Credit','Hidden Writer'], ['solo','Session Album','Session Singer','Session Credit','Session Writer'], ...Array.from({length:180},(_,i)=>['extra-'+i,'Extra Album','Extra Singer','Extra Credit','Extra Writer'])
];
const descriptors=rows.map(([id])=>({id,sourcePath:(id==='hidden'?'/hidden/':id==='solo'?'/session/':'/music/')+id+'.flac',fileName:id+'.flac',available:true}));
const track=path=>{const descriptor=descriptors.find(row=>row.sourcePath===path);if(!descriptor)throw Error('Unknown path '+path);const row=rows.find(row=>row[0]===descriptor.id);return {...descriptor,durationMs:4000,metadata:{title:'Song '+row[0],artist:row[2],album:row[1],albumArtist:row[3],composer:row[4],genre:descriptor.id==='a'?'Jazz':'Rock',year:2023,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_playlists')return [{directoryPath:'/session',directoryName:'session',sourceKind:'m3u8',sourcePath:'/lists/solo.m3u8',sourceName:'Solo playlist',selectedIndex:0,tracks:descriptors.filter(row=>row.id==='solo')}];
 if(command==='library_get_folders')return {revision:0,roots:roots.map(path=>({path,selected:path!=='/hidden',directoryRules:[]}))};
 if(command==='library_clear_folders'){roots.length=0;return null}
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='library_scan_folder'){if(window.scanGate)await new Promise(resolve=>window.pendingScans.push(resolve));const path=args.path;return {directoryPath:path,directoryName:path.split('/').at(-1),sourceKind:'folder',sourcePath:path,sourceName:path.split('/').at(-1),selectedIndex:0,directoryPaths:[path],tracks:descriptors.filter(row=>row.sourcePath.startsWith(path+'/'))}}
 if(command==='library_warm_cover_thumbnails')return {requested:input.paths.length,processed:input.paths.length,written:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:4000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:null}}
 if(['audio_load_track_thumbnail','audio_load_playlist_cover_pixels','audio_load_folder_thumbnail'].includes(command))return new Uint8Array(0);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:4000,error:null}));
 if(command==='audio_probe_playlist_track_summaries'){
  if(window.summaryGate)await new Promise(resolve=>window.pendingSummaries.push(resolve));
  return input.paths.map(sourcePath=>{const item=track(sourcePath);return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:item.metadata.albumArtist,composer:item.metadata.composer,genre:item.metadata.genre,year:2023,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(['audio_transition_playback','audio_play','audio_pause'].includes(command)){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__compact_sidebar_acceptance_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: process.env.SPMUSIC_TEST_MOTION ? 'no-preference' : 'reduce', hasTouch: true })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('framenavigated', frame=>{if(frame===page.mainFrame())console.log('NAVIGATED',frame.url())})
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
await page.route('**/src/features/shortcuts/services/globalShortcutCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:shortcutService}))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__compact_sidebar_acceptance_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__compact_sidebar_acceptance_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__compact_sidebar_acceptance_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => { window.WebSocket=class extends EventTarget {readyState=0;send(){}close(){}}; localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'); localStorage.setItem('spmusic.playlist.layout-level.v1','1'); localStorage.removeItem('spmusic.player.session.v1') })
await page.addInitScript(mode=>localStorage.setItem('spmusic.player.playlist-controller-mode.v1',mode),process.env.SPMUSIC_TEST_CONTROLLER_MODE||'fixed')
if(process.env.SPMUSIC_SEARCH_TYPOGRAPHY_ONLY) await page.addInitScript(()=>{for(const key of ['spmusic.albums.layout-level.v1','spmusic.artist-root.layout-level.v1','spmusic.flat-folders.layout-level.v1'])localStorage.setItem(key,'4')})
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if (evidence) mkdirSync(evidence, { recursive: true })
const screenshot = async name => { if (evidence) await page.screenshot({ path: evidence + '/' + name + '.png' }) }

const selectCategory = async category => {
  await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
  await page.waitForFunction(category => window.vm.playlist.library.route.categoryId === category, category)
}
const search = () => page.locator('.search-page')
const input = () => page.getByRole('searchbox', { name: '聚合搜索' })
const closeSearch = async () => {
  await page.keyboard.press('Control+f')
  await search().waitFor({state:'hidden'})
}
const openSearch = async () => {
  await page.keyboard.press('Control+f')
  await search().waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '聚合搜索')
}
const dispatch = extra => page.evaluate(extra => {
  const event = new KeyboardEvent('keydown', {key:'f',code:'KeyF',ctrlKey:true,bubbles:true,cancelable:true,...extra})
  window.dispatchEvent(event)
  return event.defaultPrevented
}, extra ?? {})
const productionCss = readdirSync('dist/assets').filter(name=>name.endsWith('.css')).map(name=>readFileSync('dist/assets/'+name,'utf8')).join('\n')
assert(productionCss.length>10000,'build production CSS before running sidebar acceptance')
const useProductionCss = async()=>{
  await page.locator('style[data-vite-dev-id]').evaluateAll(nodes=>nodes.forEach(node=>node.remove()))
  await page.addStyleTag({content:productionCss})
}
const menu = ()=>page.getByRole('button',{name:'打开媒体库',exact:true})
const sidebarDialog = ()=>page.getByRole('dialog',{name:'媒体库',exact:true})
const assertGeometry=async label=>{
  assert.equal(await page.locator('#playlist-library-overlay').count(),1,'one foreground sidebar dialog owns the overlay ID')
  const value=await sidebarDialog().evaluate(node=>{const rect=node.getBoundingClientRect(),aside=node.querySelector('aside'),child=aside.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewportHeight:innerHeight,visibility:getComputedStyle(aside).visibility,childX:child.x,childY:child.y,translate:getComputedStyle(node).translate}})
  assert(Math.abs(value.x)<1&&Math.abs(value.y)<1,'production popup is top-left aligned: '+JSON.stringify(value))
  assert(value.width>=300&&value.width<=340&&Math.abs(value.height-value.viewportHeight)<2,'full-height sidebar geometry')
  assert(value.childX>=0&&value.childY>=0&&value.visibility==='visible','sidebar contents stay inside visible viewport')
  console.log('COMPACT_SIDEBAR_GEOMETRY',label,JSON.stringify(value))
}
const openSidebar=async label=>{
  await menu().click()
  await sidebarDialog().waitFor()
  await assertGeometry(label)
}
try {
  await page.setViewportSize({width:640,height:720})
  await page.goto(origin+'/__compact_sidebar_acceptance_test?normal=1')
  await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===188&&!window.vm.playlist.library.isImportPending)
  await selectCategory('album')
  await page.locator('.album-card').first().waitFor()
  await openSearch()
  await input().fill('Singer A')
  await useProductionCss()
  await openSidebar('album-search-640x720')
  await screenshot('compact-search-sidebar-640')
  assert.equal(await dispatch(),false,'modal consumes Ctrl+F without leaving search')
  await page.keyboard.press('Escape')
  await sidebarDialog().waitFor({state:'hidden'})
  assert.equal(await menu().getAttribute('aria-expanded'),'false')
  await page.waitForFunction(()=>document.activeElement?.id==='playlist-library-menu')
  assert.equal(await search().isVisible(),true,'Escape closes dialog and preserves search')
  await openSidebar('category-navigation')
  await sidebarDialog().getByRole('button',{name:'艺术家',exact:true}).click()
  await sidebarDialog().waitFor({state:'hidden'})
  await search().waitFor({state:'hidden'})
  await page.waitForFunction(()=>window.vm.playlist.library.route.categoryId==='artist')

  for(const source of ['album','artist','folder','folders','playlists']) {
    await selectCategory(source)
    await openSidebar(source+'-source')
    await sidebarDialog().getByRole('button',{name:'艺术家',exact:true}).click()
    await sidebarDialog().waitFor({state:'hidden'})
    await page.waitForFunction(()=>window.vm.playlist.library.route.categoryId==='artist')
    await selectCategory(source)
    await openSearch()
    assert.equal(await input().inputValue(),'Singer A','source navigation retains search query')
    await openSidebar(source+'-search')
    await sidebarDialog().getByRole('button',{name:'所有歌曲',exact:true}).click()
    await sidebarDialog().waitFor({state:'hidden'})
    await search().waitFor({state:'hidden'})
    await page.waitForFunction(()=>window.vm.playlist.library.route.categoryId==='songs')
  }

  await selectCategory('album')
  await openSearch()
  await openSidebar('playlist-navigation')
  await sidebarDialog().locator('.playlist-library-list').filter({hasText:'Solo playlist'}).click()
  await sidebarDialog().waitFor({state:'hidden'})
  await search().waitFor({state:'hidden'})
  await page.waitForFunction(()=>window.vm.playlist.library.route.view==='tracks')
  await selectCategory('album')
  await openSearch()
  await page.setViewportSize({width:636,height:1440})
  await openSidebar('video-636x1440')
  await screenshot('compact-search-sidebar-636x1440')
  await page.mouse.click(600,1300)
  await sidebarDialog().waitFor({state:'hidden'})
  assert.equal(await search().isVisible(),true,'backdrop closes only sidebar')
  await openSidebar('resize-to-wide')
  await page.setViewportSize({width:1280,height:900})
  await sidebarDialog().waitFor({state:'hidden'})
  assert.equal(await search().isVisible(),true,'wide resize leaves search visible')
  const wideHeader=await page.locator('.window-bar').evaluate(node=>({x:node.getBoundingClientRect().x,width:node.getBoundingClientRect().width}))
  assert.equal(wideHeader.x,0,'search header remains full width after resize')
  assert.equal(wideHeader.width,1280)
  await screenshot('compact-search-resize-wide')
  await page.setViewportSize({width:640,height:720})
  assert.equal(await menu().getAttribute('aria-expanded'),'false','narrow resize does not resurrect old modal')
  await openSidebar('narrow-reopen')
  await page.keyboard.press('Escape')
  await sidebarDialog().waitFor({state:'hidden'})
  await closeSearch()

  // Search from the cover/player also owns a sidebar without a background library page.
  await page.evaluate(()=>window.vm.playlist.onOpenChange(false))
  await page.waitForFunction(()=>!window.vm.playlist.isOpen)
  await openSearch()
  await openSidebar('player-search')
  await sidebarDialog().getByRole('button',{name:'SPMusic，返回媒体库',exact:true}).click()
  await sidebarDialog().waitFor({state:'hidden'})
  await search().waitFor({state:'hidden'})
  await page.waitForFunction(()=>window.vm.playlist.library.route.view==='overview')
  assert.deepEqual(errors,[],'no browser errors')
  console.log('COMPACT_SEARCH_SIDEBAR_PASS: production CSS geometry, foreground-only owner, category navigation, Escape/focus, modal Ctrl+F, backdrop, 640x720/636x1440, wide/narrow resize, player origin')
} catch(error) {
  await screenshot('compact-search-sidebar-failure')
  console.error(await page.evaluate(()=>({route:window.vm?.playlist.library.route,searchOpen:window.vm?.search?.isOpen,dialog:document.querySelector('#playlist-library-overlay')?.outerHTML.slice(0,900),focus:document.activeElement?.outerHTML.slice(0,250)})),errors)
  throw error
} finally {await browser.close()}
