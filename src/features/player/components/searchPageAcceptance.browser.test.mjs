// Independent acceptance: real PlayerShell and PlayerSurface, only native transport replaced.
// Vite must be running at SPMUSIC_TEST_ORIGIN (default http://127.0.0.1:5173).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

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
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__search_acceptance_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;return React.createElement(RealSurface,props)}`
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
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__search_acceptance_fixture.js"')
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
await page.route('**/__search_acceptance_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__search_acceptance_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__search_acceptance_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
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
const category = id => search().locator(`[data-search-category="${id}"]`)
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
try {
  await page.goto(origin + '/__search_acceptance_test?normal=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 188 && !window.vm.playlist.library.isImportPending)
  if(process.env.SPMUSIC_SEARCH_SCROLLBAR_ONLY) {
    const scrollbarStyle=locator=>locator.evaluate(node=>{
      const bar=getComputedStyle(node,'::-webkit-scrollbar'),track=getComputedStyle(node,'::-webkit-scrollbar-track'),thumb=getComputedStyle(node,'::-webkit-scrollbar-thumb'),button=getComputedStyle(node,'::-webkit-scrollbar-button')
      const unit=parseFloat(getComputedStyle(node).getPropertyValue('--more-unit'))||1
      return {width:bar.width,trackTop:parseFloat(track.marginTop)/unit,trackBottom:parseFloat(track.marginBottom)/unit,trackBackground:track.backgroundColor,radius:thumb.borderRadius,image:thumb.backgroundImage,size:thumb.backgroundSize,repeat:thumb.backgroundRepeat,buttons:button.display}
    })
    const progress=()=>search().evaluate(node=>({top:node.scrollTop,max:node.scrollHeight-node.clientHeight,marker:Number(node.style.getPropertyValue('--more-scroll-progress')),gutter:node.offsetWidth-node.clientWidth}))
    await openSearch()
    await category('songs').waitFor()
    const searchStyle=await scrollbarStyle(search())
    assert.equal(searchStyle.width,'2.5px','platform-wide native bar replaced by shared thin track')
    assert.equal(searchStyle.size,'100% 10%')
    assert.equal(searchStyle.repeat,'no-repeat')
    assert.equal(searchStyle.buttons,'none')
    assert((await progress()).gutter<=3,'thin native track occupies at most3 CSS pixels')
    await page.mouse.move(600,400)
    await page.mouse.wheel(0,800)
    await page.waitForFunction(()=>document.querySelector('.search-page').scrollTop>100)
    const wheel=await progress()
    assert(Math.abs(wheel.marker-wheel.top/wheel.max)<0.001,'wheel updates marker proportion')
    await page.mouse.wheel(0,-20000)
    await page.waitForFunction(()=>document.querySelector('.search-page').scrollTop===0)
    const drag=async down=>{
      const r=await search().evaluate(node=>{const b=node.getBoundingClientRect(),track=getComputedStyle(node,'::-webkit-scrollbar-track');return {right:b.right,top:b.top,bottom:b.bottom,start:parseFloat(track.marginTop)||0,end:parseFloat(track.marginBottom)||0}})
      const top=r.top+r.start+5,bottom=r.bottom-r.end-5
      await page.mouse.move(r.right-1,down?top:bottom)
      await page.mouse.down()
      await page.mouse.move(r.right-1,down?bottom:top,{steps:30})
      await page.mouse.up()
      console.log('SEARCH_SCROLLBAR_DRAG',JSON.stringify({down,r,after:await progress()}))
    }
    await drag(true)
    const nativeDragReachedEnd=(await progress()).top>=(await progress()).max-1
    if(!nativeDragReachedEnd) {
      const rect=await search().boundingBox()
      await page.mouse.click(rect.x+rect.width-1,rect.y+rect.height-40)
      console.log('SEARCH_NATIVE_TRACK_CLICK',JSON.stringify(await progress()))
      console.log('SEARCH_NATIVE_DRAG_UNVERIFIED: headless overlay scrollbar has no input target; using native keyboard to verify end reachability')
      await search().focus()
      await page.keyboard.press('Control+End')
    }
    await page.waitForFunction(()=>{const n=document.querySelector('.search-page');return n.scrollTop>=n.scrollHeight-n.clientHeight-1})
    const end=await progress()
    assert(end.marker>=0.999,'end scroll position updates marker')
    const last=category('songs').locator('.playlist-card[data-song-key]').filter({hasText:'Song solo'})
    await last.waitFor()
    const lastRect=await last.boundingBox()
    assert(lastRect.y>=40&&lastRect.y+lastRect.height<=900,'virtualized final song is painted in viewport')
    assert(await category('songs').locator('[data-song-key]').count()<189,'end remains virtualized')
    await screenshot('search-scrollbar-end')
    if(nativeDragReachedEnd) await drag(false)
    else {await search().focus();await page.keyboard.press('Control+Home')}
    await page.waitForFunction(()=>document.querySelector('.search-page').scrollTop===0)
    assert.equal((await progress()).marker,0)
    await input().fill('no-such-query-739')
    await search().getByText('没有找到匹配结果',{exact:true}).waitFor()
    assert((await progress()).max<=0,'short no-result content has no overflow rail')
    assert.equal((await progress()).gutter,0,'short content hides native thumb/gutter')
    assert.equal((await progress()).marker,0,'short content resets progress')
    await input().fill('')
    await category('songs').waitFor()
    await page.setViewportSize({width:640,height:720})
    await page.mouse.move(400,350)
    await page.mouse.wheel(0,900)
    await page.waitForFunction(()=>document.querySelector('.search-page').scrollTop>0)
    await page.setViewportSize({width:1280,height:900})
    const resized=await progress()
    assert(Math.abs(resized.marker-resized.top/resized.max)<0.001,'resize keeps normalized marker')
    await screenshot('search-scrollbar-resize')
    await page.evaluate(()=>{const item=window.vm.search.allSongs[0];window.vm.search.onPlaySong(item.scope,item.trackId,[{scope:item.scope,trackId:item.trackId}])})
    await page.waitForFunction(()=>!window.vm.playback.isSelectionPending&&window.vm.playback.track)
    await closeSearch()
    await page.evaluate(()=>window.vm.playlist.onOpenChange(false))
    await page.waitForFunction(()=>!window.vm.playlist.isOpen)
    await page.locator('.more-button').filter({visible:true}).click()
    await page.locator('.more-actions-scroll').waitFor()
    const menuStyle=await scrollbarStyle(page.locator('.more-actions-scroll'))
    assert.deepEqual(searchStyle,menuStyle,'search uses actual player more-popup scrollbar style')
    console.log('SEARCH_SCROLLBAR_STYLE',JSON.stringify({searchStyle,menuStyle,wheel,end,resized}))
    assert.deepEqual(errors,[])
    console.log('SEARCH_SCROLLBAR_PASS: wheel, keyboard bounds, marker, virtualized end, filtering, resize, menu style; nativeDragReachedEnd='+nativeDragReachedEnd)
  } else if(process.env.SPMUSIC_SEARCH_TYPOGRAPHY_ONLY) {
    const metrics=locator=>locator.evaluate(node=>{
      const read=selector=>{const element=node.querySelector(selector);if(!element)return null;const style=getComputedStyle(element),rect=element.getBoundingClientRect();return {size:style.fontSize,line:style.lineHeight,family:style.fontFamily,top:rect.top,bottom:rect.bottom}}
      return {title:read('.folder-name'),parent:read('.folder-parent-name'),meta:read('.folder-meta'),rect:node.getBoundingClientRect().toJSON()}
    })
    const styleOnly=field=>field?{size:field.size,line:field.line,family:field.family}:null
    const noOverlap=value=>{const parts=[value.title,value.parent,value.meta].filter(Boolean);for(let i=1;i<parts.length;i++)assert(parts[i-1].bottom<=parts[i].top+1,'collection text lines do not overlap');assert(parts.at(-1).bottom<=value.rect.bottom+1,'collection text not vertically clipped')}
    await openSearch()
    await input().fill('Shared')
    await category('album').waitFor()
    const row=category('album').locator('.search-collection-row').first()
    const collection=await metrics(row)
    const song=await category('songs').locator('.playlist-card').first().evaluate(node=>Object.fromEntries([['title','.playlist-card-title'],['parent','.playlist-card-artist'],['meta','.playlist-card-format']].map(([key,selector])=>{const style=getComputedStyle(node.querySelector(selector));return[key,{size:style.fontSize,line:style.lineHeight,family:style.fontFamily}]})))
    assert.deepEqual(styleOnly(collection.title),song.title,'search collection title matches song typography')
    assert.deepEqual(styleOnly(collection.parent),song.parent,'search collection secondary text matches song typography')
    assert.deepEqual(styleOnly(collection.meta),song.meta,'search collection statistics match song typography')
    assert.deepEqual([collection.title.size,collection.parent.size,collection.meta.size],['23px','18px','14px'])
    noOverlap(collection)
    console.log('SEARCH_MEDIUM_TYPOGRAPHY',JSON.stringify(collection))
    await screenshot('search-typography-1280')
    await page.setViewportSize({width:450,height:900})
    noOverlap(await metrics(row))
    await screenshot('search-typography-450')
    await page.setViewportSize({width:1280,height:900})
    await closeSearch()
    for(const id of ['album','artist','folder']) {
      await selectCategory(id)
      const source=page.locator('.playlist-management-content:not([inert]) .folder-row').first()
      await source.waitFor()
      const actual=await metrics(source)
      assert.equal(actual.title.size,'23px',id+' source title stays synchronized')
      if(actual.meta)assert.equal(actual.meta.size,'14px',id+' source statistics stay synchronized')
      if(actual.parent)assert.equal(actual.parent.size,'18px',id+' source secondary text stays synchronized')
      assert.deepEqual(styleOnly(actual.title),styleOnly(collection.title),id+' source title uses same descriptor')
      if(actual.meta)assert.deepEqual(styleOnly(actual.meta),styleOnly(collection.meta),id+' source metadata uses same descriptor')
      noOverlap(actual)
      console.log('SOURCE_MEDIUM_TYPOGRAPHY',id,JSON.stringify(actual))
      await screenshot('source-typography-'+id)
    }
    assert.deepEqual(errors,[])
    console.log('SEARCH_COLLECTION_TYPOGRAPHY_PASS')
  } else if(process.env.SPMUSIC_SEARCH_FIX_ONLY) {
    const mode=process.env.SPMUSIC_TEST_CONTROLLER_MODE||'fixed'
    await openSearch()
    await category('songs').waitFor()
    assert.equal(await search().locator('.search-page-input button').count(),0,'empty input has no redundant X')
    await input().fill('Singer A')
    assert.equal(await search().locator('.search-page-input button').count(),1,'one explicit clear X')
    assert.equal(await search().getByRole('button',{name:'返回原页面',exact:true}).count(),0,'duplicate return X removed')
    const nativeCancelDisabled=await page.evaluate(()=>Array.from(document.styleSheets).some(sheet=>{try{return Array.from(sheet.cssRules).some(rule=>rule.selectorText?.includes('.search-page-input input::-webkit-search-cancel-button')&&rule.style.display==='none'&&rule.style.getPropertyValue('appearance')==='none')}catch{return false}}))
    assert(nativeCancelDisabled,'browser parsed scoped rule disables native search cancel')
    await screenshot('search-input-single-x')
    await search().getByRole('button',{name:'清空搜索',exact:true}).click()
    assert.equal(await input().inputValue(),'')
    assert.equal(await search().isVisible(),true,'clear never leaves search')
    assert.equal(await input().evaluate(node=>node===document.activeElement),true)
    await closeSearch()
    await openSearch()
    await category('songs').waitFor()
    const controls=()=>page.locator('.playlist-controller-actions[aria-label="搜索结果操作"]')
    await page.waitForFunction(()=>document.querySelector('.playlist-controller-actions[aria-label="搜索结果操作"]')?.dataset.actionsVisible==='false')
    const reveal=async()=>{
      await search().evaluate(node=>{node.focus({preventScroll:true});node.scrollTop=2400})
      await page.waitForFunction(()=>document.querySelector('.playlist-controller-actions[aria-label="搜索结果操作"]')?.dataset.actionsVisible==='true')
      if(mode==='movable') {
        await page.waitForFunction(()=>document.querySelector('.playlist-playback-dock:not([data-dock-superseded])')?.dataset.controllerHidden==='true')
        await search().evaluate(node=>{node.scrollTop=2200})
        await page.waitForFunction(()=>document.querySelector('.playlist-playback-dock:not([data-dock-superseded])')?.dataset.controllerHidden!=='true')
      }
      await controls().getByRole('button',{name:'返回',exact:true}).waitFor()
    }
    await reveal()
    assert.equal(await controls().getByRole('button').count(),6,'return/shuffle/play/search/select/more available')
    const geometry=await controls().evaluate(node=>({actions:node.getBoundingClientRect().toJSON(),dock:document.querySelector('.playlist-playback-dock:not([data-dock-superseded])').getBoundingClientRect().toJSON()}))
    assert(geometry.actions.bottom<=geometry.dock.top+2,'auxiliary group sits above playback controller')
    await screenshot('search-auxiliary-'+mode)
    await controls().getByRole('button',{name:'播放',exact:true}).click()
    await page.waitForFunction(()=>!window.vm.playback.isSelectionPending&&window.vm.queue.tracks.length===189)
    await controls().getByRole('button',{name:'随机播放搜索结果',exact:true}).click()
    await page.waitForFunction(()=>!window.vm.playback.isSelectionPending)
    assert.equal((await page.evaluate(()=>new Set(window.vm.queue.tracks.map(track=>track.id)).size)),189,'aux shuffle uses all unique results')
    await controls().getByRole('button',{name:'搜索视图选项',exact:true}).click()
    assert.equal(await page.getByRole('menuitemradio').count(),7)
    await page.keyboard.press('Escape')
    await page.getByRole('menu').waitFor({state:'hidden'})
    await controls().getByRole('button',{name:'选择',exact:true}).click()
    await page.getByRole('button',{name:'退出选择',exact:true}).click()
    await reveal()
    await controls().getByRole('button',{name:'搜索',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('.search-page')?.scrollTop===0)
    assert.equal(await input().evaluate(node=>node===document.activeElement),true,'aux search reveals and focuses input')
    assert.equal(await search().isVisible(),true,'aux search does not exit page')
    await page.waitForFunction(()=>document.querySelector('.playlist-controller-actions[aria-label="搜索结果操作"]')?.dataset.actionsVisible==='false')
    await reveal()
    await controls().getByRole('button',{name:'返回',exact:true}).click()
    await search().waitFor({state:'hidden'})
    assert.deepEqual(errors,[])
    console.log('SEARCH_INPUT_AUXILIARY_FIX_PASS',mode)
  } else {
  const initialRoute = await page.evaluate(() => structuredClone(window.vm.playlist.library.route))
  for (const extra of [{ctrlKey:false},{altKey:true},{shiftKey:true},{metaKey:true},{repeat:true},{isComposing:true},{key:'g',code:'KeyG'}]) {
    assert.equal(await dispatch(extra),false,'unrelated/modified key leaves navigation alone')
  }
  await openSearch()
  assert.equal(await input().inputValue(),'')
  await input().fill('Singer A')
  await category('artist').waitFor()
  assert.match(await category('artist').innerText(),/Singer A/,'metadata available from cold overview entry')
  assert.match(await category('songs').innerText(),/Song a/)
  assert.doesNotMatch(await category('songs').innerText(),/hidden/i,'excluded roots do not leak into search')
  assert.equal(await search().locator('.playlist-management-quick-index').count(),0)
  assert.equal(await search().locator('.search-songs').getAttribute('data-layout-level'),'4','search default ignores stored card layout')
  assert.equal(await page.locator('.playlist-playback-dock:not([data-dock-superseded])').filter({visible:true}).count(),1,'one active playback controller')
  assert.equal(await search().locator('.search-section-heading [data-slot="separator"]').count(),await search().locator('[data-search-category]').count(),'all result categories have separators')
  await search().getByRole('button',{name:'搜索视图选项',exact:true}).click()
  assert.equal(await page.getByRole('menuitemradio').count(),7,'only row/text layout choices')
  assert.equal(await page.getByRole('menuitemradio',{name:'三列封面视图',exact:true}).count(),0,'card layout not available')
  await page.getByRole('menuitemradio',{name:'单列紧凑文本视图',exact:true}).click()
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({state:'hidden'})
  assert.equal(await search().locator('.search-songs').getAttribute('data-layout-level'),'7')
  await search().getByRole('button',{name:'搜索视图选项',exact:true}).click()
  await page.getByRole('menuitemradio',{name:'单列中封面视图',exact:true}).click()
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({state:'hidden'})
  await search().getByRole('button',{name:'全选搜索分类',exact:true}).click()
  await search().getByText('请选择搜索分类',{exact:true}).waitFor()
  await search().getByRole('button',{name:'筛选流',exact:true}).click()
  await search().getByText('当前没有可搜索的流。',{exact:true}).waitFor()
  assert.equal(await search().getByRole('button',{name:'播放搜索结果',exact:true}).isDisabled(),true)
  await search().getByRole('button',{name:'筛选流',exact:true}).click()
  await search().getByRole('button',{name:'筛选艺术家',exact:true}).click()
  assert.equal(await category('songs').count(),0,'deselected songs do not render')
  await category('artist').getByRole('button',{name:'打开艺术家 Singer A',exact:true}).waitFor()
  await search().getByRole('button',{name:'全选搜索分类',exact:true}).click()
  await category('songs').waitFor()
  await screenshot('search-aggregate-medium')
  await page.setViewportSize({width:450,height:900})
  await screenshot('search-aggregate-450')
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile viewport has no horizontal overflow')
  console.log('SEARCH_GEOMETRY_450',JSON.stringify(await search().evaluate(node=>({width:node.getBoundingClientRect().width,cover:node.querySelector('.search-songs .playlist-card-cover')?.getBoundingClientRect().toJSON(),collection:node.querySelector('.folder-cover')?.getBoundingClientRect().toJSON(),dock:document.querySelector('.playlist-playback-dock:not([data-dock-superseded])')?.getBoundingClientRect().toJSON()}))))
  await page.setViewportSize({width:1280,height:900})
  await closeSearch()
  assert.deepEqual(await page.evaluate(() => window.vm.playlist.library.route),initialRoute,'overview return route retained')
  await openSearch()
  assert.equal(await input().inputValue(),'Singer A','query retained across shortcut round trip')
  await closeSearch()

  await selectCategory('songs')
  const content=page.locator('.playlist-management-content:not([inert])')
  await content.locator('.all-songs-list [data-song-key]').first().waitFor()
  await content.evaluate(node=>{node.scrollTop=800})
  const scroll=await content.evaluate(node=>node.scrollTop)
  assert(scroll>200,'fixture has real original-page overflow')
  await openSearch()
  await closeSearch()
  assert.deepEqual(await page.evaluate(() => window.vm.playlist.library.route),{view:'category',categoryId:'songs'})
  assert.equal(await content.evaluate(node=>node.scrollTop),scroll,'Ctrl+F retains origin scroll position')
  await page.locator('.playlist-playback-dock:not([data-dock-superseded])').getByRole('button',{name:'搜索',exact:true}).click()
  await search().waitFor()
  for(const [id,query,label] of [['album','Session Album','打开专辑 Session Album'],['artist','Session Singer','打开艺术家 Session Singer'],['folder','session','打开文件夹 session']]) {
    await input().fill(query)
    await category(id).getByRole('button',{name:label,exact:true}).click()
    assert.equal(await search().isVisible(),true,'session-only collection opens inside search')
    await search().locator('[data-song-key]').filter({hasText:'Song solo'}).first().waitFor()
    if(id==='album') {
      await search().getByRole('button',{name:'选择',exact:true}).click()
      await search().locator('[data-song-key]').filter({hasText:'Song solo'}).first().click()
      await page.getByRole('button',{name:'选择帮助',exact:true}).click()
      await page.getByRole('dialog',{name:'选择帮助',exact:true}).waitFor()
      assert.equal(await page.getByRole('button',{name:'新建播放列表',exact:true}).count(),0,'session-only selection cannot silently create a folder-only list')
      await page.keyboard.press('Escape')
      await page.getByRole('dialog',{name:'选择帮助',exact:true}).waitFor({state:'hidden'})
    }
    await search().getByRole('button',{name:'返回搜索结果',exact:true}).click()
    if(id==='album') {
      await page.getByRole('status',{name:/已选 0 项/}).waitFor()
      await search().getByRole('button',{name:'完成',exact:true}).click()
    }
  }
  await input().fill('no-such-query-739')
  await search().getByText(/未找到|没有找到|无匹配|暂无搜索/).first().waitFor()
  await input().fill('Jazz')
  await category('genre').waitFor()
  assert.match(await category('genre').innerText(),/Jazz/,'genre comes from summary metadata')
  await input().fill('2023')
  await category('year').waitFor()
  await input().fill('Singer A')
  await category('artist').waitFor()
  await category('songs').locator('[data-song-key]').filter({hasText:'Song a'}).first().click()
  await page.waitForFunction(()=>!window.vm.playback.isSelectionPending&&window.vm.playback.track?.id==='a')
  assert.deepEqual(await page.evaluate(()=>window.vm.queue.tracks.map(track=>track.id)),['a','duet'],'song activation queues only matched songs')
  await screenshot('search-aggregate-filtered')
  await closeSearch()
  await search().waitFor({state:'hidden'})

  // Role-based modal guard, independent of native settings availability.
  assert.equal(await page.evaluate(()=>{
    const dialog=document.createElement('div');dialog.setAttribute('role','alertdialog')
    const target=document.createElement('textarea');dialog.append(target);document.body.append(dialog)
    const event=new KeyboardEvent('keydown',{key:'f',code:'KeyF',ctrlKey:true,bubbles:true,cancelable:true})
    target.dispatchEvent(event);dialog.remove();return event.defaultPrevented
  }),false)
  assert.equal(await search().isVisible(),false)
  await page.evaluate(async()=>{const {setGlobalShortcutsSuspended}=await import('/src/features/shortcuts/services/globalShortcutCommands.ts');await setGlobalShortcutsSuspended(true)})
  assert.equal(await dispatch(),false,'shortcut capture gate protects navigation')
  await page.evaluate(async()=>{const {setGlobalShortcutsSuspended}=await import('/src/features/shortcuts/services/globalShortcutCommands.ts');await setGlobalShortcutsSuspended(false)})
  await page.evaluate(()=>window.vm.playlist.onOpenChange(false))
  await page.waitForFunction(()=>!window.vm.playlist.isOpen)
  await openSearch()
  await closeSearch()
  assert.equal(await page.evaluate(()=>window.vm.playlist.isOpen),false,'player origin remains player after search')
  await page.evaluate(()=>window.vm.playlist.library.onSelect(window.vm.playlist.library.items.find(item=>item.sourceKind!=='folder').scope))
  await page.waitForFunction(()=>window.vm.playlist.library.route.view==='tracks')
  await page.evaluate(()=>window.vm.playlist.onTrackSelect('solo'))
  await page.waitForFunction(()=>!window.vm.playback.isSelectionPending&&window.vm.playback.track?.id==='solo')
  await openSearch()
  await page.getByRole('button',{name:'打开当前播放列表',exact:true}).click()
  await search().waitFor({state:'hidden'})
  assert.equal(await page.evaluate(()=>window.vm.playlist.isOpen),true,'dock current playlist navigation exits search')
  await page.goto(origin + '/__search_acceptance_test?summaryGate=1')
  await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===188)
  await openSearch()
  await search().getByText('正在读取音乐标签…',{exact:true}).waitFor()
  assert.equal(await search().locator('[data-search-category]').count(),0,'pending rows do not appear as unknown matches')
  await closeSearch()
  await openSearch()
  await page.evaluate(()=>{window.summaryGate=false;for(const resolve of window.pendingSummaries.splice(0))resolve()})
  await category('songs').waitFor()
  assert(await category('songs').locator('[data-song-key]').count()<188,'large search song sections are virtualized')
  await screenshot('search-all-results-virtualized')

  assert.deepEqual(errors,[],'no browser errors')
  console.log('SEARCH_PAGE_ACCEPTANCE_PASS: real shell, cold metadata, hidden-root exclusion, independent layout, overview/songs/player return, scroll restoration, dock entry, genre/year, empty query, no result, modal/capture gates')
  }
} catch(error) {
  await screenshot('search-acceptance-failure')
  console.error(await page.evaluate(()=>({route:window.vm?.playlist.library.route,search:document.querySelector('.search-page')?.innerText})),errors)
  throw error
} finally {await browser.close()}
