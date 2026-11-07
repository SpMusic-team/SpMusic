// Independent stream-author event acceptance. Run against Vite:
// SPMUSIC_PLAYWRIGHT=<installed Playwright> node <this file>. Native audio is mocked.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5178'
const main = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = main.match(new RegExp('"(/[^"\\n]+/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve Vite dependency ${name}`)
  return match[1]
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__stream_information_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.holdDetails=false;window.pendingDetails=[];window.gateAdd=false;window.pendingAdds=[];window.failStationCache=false;
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null,currentRequestId=null;
const stationUrl='https://example.test/groovesalad-128-aac?Key=Preserved';
const freshUrl='https://example.test/fresh';
const longUrl='https://example.test/'+('VeryLongCaseSensitiveSegment'.repeat(12))+'?Token=KeepCase';
const initial=[
 {id:'station',sourceKind:'stream',sourcePath:stationUrl,fileName:'Groove Salad [SomaFM]',title:stationUrl,stationName:'Groove Salad [SomaFM]',createdAtMs:100,available:true},
 {id:'custom',sourceKind:'stream',sourcePath:'https://example.test/custom',fileName:'我的自定义电台',title:'我的自定义电台',stationName:'Server Station',createdAtMs:200,available:true},
 {id:'fresh',sourceKind:'stream',sourcePath:freshUrl,fileName:freshUrl,title:freshUrl,createdAtMs:300,available:true},
 {id:'unknown',sourceKind:'stream',sourcePath:longUrl,fileName:longUrl,title:longUrl,createdAtMs:400,available:true},
];
const local={id:'local',sourceKind:'file',sourcePath:'/music/local.wav',fileName:'local.wav',fileCreatedAtMs:10,available:true};
const fillers=Array.from({length:35},(_,i)=>({id:'filler-'+i,sourceKind:'file',sourcePath:'/music/filler-'+i+'.wav',fileName:'filler-'+i+'.wav',available:true}));
if(!localStorage.getItem('stream.information.registry'))localStorage.setItem('stream.information.registry',JSON.stringify(initial));
const streams=()=>JSON.parse(localStorage.getItem('stream.information.registry'));
const snapshot=()=>({directoryPath:'',directoryName:'流',sourceKind:'streams',sourcePath:'streams:library',sourceName:'流',selectedIndex:0,tracks:streams()});
const mixed=()=>({directoryPath:'/lists',directoryName:'Mixed information',sourceKind:'m3u8',sourcePath:'/lists/mixed-information.m3u8',sourceName:'Mixed information',selectedIndex:0,tracks:[fillers[0],streams().find(item=>item.id==='station'),...fillers.slice(1),streams().find(item=>item.id==='fresh'),local]});
const fullTrack=path=>{
 const descriptor=[local,...fillers,...streams()].find(row=>row.sourcePath===path);
 if(!descriptor)throw Error('Unknown path '+path);
 return {...descriptor,durationMs:descriptor.sourceKind==='stream'||window.unknownLocalDuration?null:60000,metadata:{title:descriptor.sourceKind==='stream'?null:'Local song '+descriptor.id,artist:descriptor.sourceKind==='stream'?null:'Local artist',album:descriptor.sourceKind==='stream'?null:'Local album',albumArtist:null,composer:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}};
};
window.publishArtist=(artist,overrides={})=>{currentTrack={...currentTrack,metadata:{...currentTrack.metadata,artist}};const event={kind:'ready',requestId:currentRequestId,generation,track:currentTrack,...overrides};window.listeners.audio_track_details_changed({payload:event});return event;};window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_streams')return snapshot();
 if(command==='library_add_stream'){
  const commit=()=>{const rows=streams();if(!rows.some(item=>item.sourcePath===input.url))rows.push({id:'added',sourceKind:'stream',sourcePath:input.url,title:input.title||input.url,fileName:input.title||input.url,available:true,createdAtMs:500});localStorage.setItem('stream.information.registry',JSON.stringify(rows));return snapshot()};
  if(window.gateAdd)return new Promise(resolve=>window.pendingAdds.push(()=>resolve(commit())));
  return commit();
 }
 if(command==='library_get_playlists')return [mixed(),{directoryPath:'/lists',directoryName:'Short list',sourceKind:'m3u8',sourcePath:'/lists/short.m3u8',sourceName:'Short list',selectedIndex:0,tracks:[local,...streams().slice(0,1)]}];
 if(command==='library_get_folders')return {revision:0,roots:[{path:'/music',selected:true,directoryRules:[]}]};
 if(command==='library_scan_folder')return {directoryPath:'/music',directoryName:'music',sourceKind:'folder',sourcePath:'/music',sourceName:'music',selectedIndex:0,directoryPaths:['/music'],tracks:[local]};
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='library_warm_cover_thumbnails')return {requested:input.paths.length,processed:0,written:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  if(window.failNextLoad){window.failNextLoad=false;throw {code:'PlaybackFailed',message:'Independent replacement failure fixture',recoverable:true};}
  if(window.holdNextLoad){window.holdNextLoad=false;await new Promise((resolve,reject)=>{window.rejectPendingLoad=()=>{delete window.rejectPendingLoad;reject({code:'PlaybackFailed',message:'Independent held replacement failure',recoverable:true})}});}
  const result=fullTrack(input.path);
  if(input.path===freshUrl){result.stationName='Fetched Station';if(!window.failStationCache){const rows=streams();rows.find(item=>item.id==='fresh').stationName=result.stationName;rows.find(item=>item.id==='fresh').fileName=result.stationName;localStorage.setItem('stream.information.registry',JSON.stringify(rows));}}
  currentTrack=result;currentRequestId=input.requestId;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:result.durationMs,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  const details={kind:'ready',requestId:input.requestId,generation,track:result};
  setTimeout(()=>{if(window.holdDetails)window.pendingDetails.push(details);else window.listeners?.audio_track_details_changed?.({payload:details})},0);return response;
 }
 if(command==='audio_hydrate_track')return fullTrack(input.path);
 if(command==='audio_probe_playlist_cover')return {id:fullTrack(input.path).id,sourcePath:input.path,coverArt:null};
 if(['audio_load_track_thumbnail','audio_load_playlist_cover_pixels','audio_load_folder_thumbnail'].includes(command))return new Uint8Array(0);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:fullTrack(sourcePath).durationMs,error:null}));
 if(command==='audio_probe_playlist_track_summaries')return input.paths.map(sourcePath=>{const row=fullTrack(sourcePath);return {sourcePath,summary:{title:row.metadata.title,artist:row.metadata.artist,album:row.metadata.album,albumArtist:null,composer:null,genre:null,year:null,bitDepth:null,sampleRateHz:null,bitrateKbps:null,codec:null},error:null}});
 if(['audio_transition_playback','audio_play','audio_pause'].includes(command)){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_stop'){state={...state,phase:'stopped',positionMs:0};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__stream_information_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 640, height: 1024 }, hasTouch: true, reducedMotion: 'reduce' })
await page.routeWebSocket(origin.replace('http:', 'ws:') + '/**', socket=>socket.close())
page.setDefaultTimeout(15000)
page.setDefaultNavigationTimeout(30000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__stream_information_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__stream_information_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__stream_information_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => {
  localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
  localStorage.removeItem('spmusic.player.session.v1')
})
const active = (category = 'streams') => page.locator('.playlist-management-content[data-library-category="'+category+'"]:not([inert])')
const streamCard = id => active().locator('[data-playlist-track-id="'+id+'"]')
const indexFor = category => active(category).locator('..').locator('.playlist-management-quick-index')
const stationUrl = 'https://example.test/groovesalad-128-aac?Key=Preserved'
const dock = page.locator('.playlist-playback-dock:not([inert])')
const secondLine = dock.locator('.playlist-playback-stream-url')
const checks = []
const layoutChecks = []
async function expectCardLine(id, value) {
  await page.waitForFunction(({id,value})=>document.querySelector('.playlist-management-content[data-library-category="streams"]:not([inert]) [data-playlist-track-id="'+id+'"] .playlist-card-stream-url')?.textContent===value,{id,value})
  assert.equal(await streamCard(id).locator('.playlist-card-stream-url').getAttribute('title'),value)
}
async function select(category, id) {
  await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
  await active(category).locator('[data-playlist-track-id="'+id+'"]').click()
  await page.waitForFunction(id => window.vm.playback.track?.id===id&&!window.vm.playback.isSelectionPending, id)
}
async function expectLine(value) {
  await page.waitForFunction(value => document.querySelector('.playlist-playback-dock:not([inert]) .playlist-playback-stream-url')?.textContent===value, value)
  assert.equal(await secondLine.getAttribute('title'), value)
  assert.equal(await secondLine.innerText(), value)
  const currentId=await page.evaluate(()=>window.vm.playback.track?.id)
  if(await active().count()&&await streamCard(currentId).count())await expectCardLine(currentId,value)
  checks.push(value)
}
async function zoomTo(target) {
  const grid=active().locator('.playlist-grid')
  let level=Number(await grid.getAttribute('data-layout-level'))
  while(level!==target) {
    const next=level+(target>level?1:-1)
    await page.keyboard.down('Control')
    try {await grid.dispatchEvent('wheel',{deltaY:target>level?100:-100,ctrlKey:true,bubbles:true,cancelable:true})}
    finally {await page.keyboard.up('Control')}
    await active().locator('.playlist-grid[data-layout-level="'+next+'"]').waitFor()
    await page.waitForTimeout(180) // Existing physical-wheel lock is 150ms.
    level=next
  }
}
try {
  await page.addInitScript(() => localStorage.setItem('spmusic.streams.layout-level.v1','4'))
  await page.goto(origin+'/__stream_information_test?stream-author', { waitUntil:'domcontentloaded' })
  await page.waitForFunction(()=>window.vm?.playlist.library.streamSongs?.length>=4&&!window.vm.playlist.library.streamsLoading)
  await select('streams','station')
  assert.equal(await indexFor('streams').count(),0,'stream root omits the alphabet index')
  await expectLine(stationUrl)
  const metadataRefreshes = await page.evaluate(()=>window.calls.filter(row=>row.command==='library_get_streams').length)
  // These Ready events arrive after initial details/selection have settled.
  const first = await page.evaluate(()=>window.publishArtist('  First Artist  '))
  await expectLine('First Artist')
  await expectCardLine('custom','https://example.test/custom')
  await page.evaluate(()=>window.publishArtist('第二位作者'))
  await expectLine('第二位作者')
  await page.evaluate(()=>window.publishArtist(null))
  await expectLine(stationUrl)
  await page.evaluate(()=>window.publishArtist('  '))
  await expectLine(stationUrl)
  await page.evaluate(()=>window.publishArtist('Restored Artist'))
  await expectLine('Restored Artist')
  assert.equal(await dock.locator('.playlist-playback-copy strong').innerText(),'Groove Salad [SomaFM]','programme author updates preserve station title')
  assert.equal(await page.evaluate(()=>window.calls.filter(row=>row.command==='library_get_streams').length),metadataRefreshes,'live author updates do not refresh the stream registry')
  // The same source shows the current author; other streams retain addresses.
  await expectCardLine('station','Restored Artist')
  await expectCardLine('custom','https://example.test/custom')
  assert.equal((await streamCard('station').locator('.playlist-card-stream-source').innerText()).trim(),'流')
  assert.equal(await dock.locator('.playlist-playback-stream-source').count(),0)
  for(const slot of ['slider-range','slider-thumb'])assert.equal(await dock.locator('[data-slot="'+slot+'"]').evaluate(node=>getComputedStyle(node).visibility),'hidden')
  for(let level=0;level<=9;level++) {
    await zoomTo(level)
    const card=streamCard('station')
    await card.scrollIntoViewIfNeeded()
    const details=card.locator('.playlist-card-stream-url')
    assert.equal(await details.innerText(),'Restored Artist')
    assert.equal(await details.isVisible(),level<=6,'author respects the existing second-line layout visibility')
    layoutChecks.push({level,authorVisible:level<=6})
  }
  // Hit-test an actual blank area, excluding cards/controls, then zoom there.
  const blank=await active().evaluate(node=>{
    const r=node.getBoundingClientRect(),dock=document.querySelector('.playlist-playback-dock').getBoundingClientRect()
    for(let y=Math.min(r.bottom,dock.top)-25;y>r.top+260;y-=15)for(const fraction of [.5,.65,.35]){
      const x=r.left+r.width*fraction,t=document.elementFromPoint(x,y)
      if(t&&node.contains(t)&&!t.closest('button,input,textarea,select,[role="button"],.playlist-card,.playlist-management-quick-index'))return{x,y}
    }
    throw Error('no hit-testable blank content area')
  })
  await page.keyboard.down('Control')
  try {await page.mouse.move(blank.x,blank.y);await page.mouse.wheel(0,-100)}
  finally {await page.keyboard.up('Control')}
  await active().locator('.playlist-grid[data-layout-level="8"]').waitFor()
  await page.waitForTimeout(180) // Let the existing 150ms wheel lock finish.
  await zoomTo(4)
  await page.evaluate(()=>window.vm.playlist.library.onSelect('m3u8\u0000/lists/short.m3u8'))
  const ordinary=page.locator('.playlist-panel:not([inert])')
  await ordinary.locator('[data-playlist-track-id="station"]').waitFor()
  assert.equal(await ordinary.locator('.playlist-management-quick-index').count(),0,'ordinary playlist preserves its original no-index layout')
  assert.equal(await ordinary.locator('[data-playlist-track-id="station"] .playlist-card-stream-url').innerText(),'Restored Artist','matching stream in a playlist uses current author')
  await select('songs','local')
  assert.equal(await indexFor('songs').count(),1,'all songs retains its index')
  await page.evaluate(event=>window.listeners.audio_track_details_changed({payload:event}),first)
  assert.equal(await page.evaluate(()=>window.vm.playback.track.artist),'Local artist')
  assert((await dock.locator('.playlist-playback-copy').innerText()).includes('Local artist/Local album'))
  for(const slot of ['slider-range','slider-thumb'])assert.equal(await dock.locator('[data-slot="'+slot+'"]').evaluate(node=>getComputedStyle(node).visibility),'visible')
  await page.evaluate(()=>{window.holdDetails=true;window.vm.playlist.library.onSelectCategory('streams')})
  await streamCard('custom').click()
  await page.waitForFunction(()=>window.pendingDetails.length===1)
  await expectCardLine('station',stationUrl)
  await page.evaluate(event=>window.listeners.audio_track_details_changed({payload:event}),first)
  assert.notEqual(await page.evaluate(()=>window.vm.playback.track?.artist),'First Artist','old selection Ready cannot enter a new pending selection')
  await page.evaluate(()=>{window.listeners.audio_track_details_changed({payload:window.pendingDetails.shift()});window.holdDetails=false})
  await page.waitForFunction(()=>window.vm.playback.track?.id==='custom'&&!window.vm.playback.isSelectionPending)
  await expectLine('https://example.test/custom')
  await page.evaluate(event=>window.listeners.audio_track_details_changed({payload:event}),first)
  await expectLine('https://example.test/custom')
  const current = await page.evaluate(()=>window.publishArtist('Current Station Artist'))
  await expectLine('Current Station Artist')
  await page.evaluate(event=>window.listeners.audio_track_details_changed({payload:{...event,generation:event.generation-1,track:{...event.track,metadata:{...event.track.metadata,artist:'Wrong Generation'}}}}),current)
  await expectLine('Current Station Artist')
  await page.evaluate(event=>window.listeners.audio_track_details_changed({payload:{...event,requestId:event.requestId-1,track:{...event.track,metadata:{...event.track.metadata,artist:'Wrong Request'}}}}),current)
  await expectLine('Current Station Artist')
  await page.evaluate(event=>window.listeners.audio_track_details_changed({payload:{...event,track:{...event.track,sourcePath:'https://example.test/wrong-source',metadata:{...event.track.metadata,artist:'Wrong Source'}}}}),current)
  await expectLine('Current Station Artist')
  await page.evaluate(()=>{window.failNextLoad=true;window.vm.playlist.library.onSelectCategory('songs')})
  await active('songs').locator('[data-playlist-track-id="local"]').click()
  await page.waitForFunction(()=>!window.vm.playback.isSelectionPending&&window.vm.playback.track?.id==='custom')
  await page.evaluate(()=>window.publishArtist('Artist After Failed Replacement'))
  await expectLine('Artist After Failed Replacement')
  for(const [artist,expected] of [['Artist Observed During Pending','Artist Observed During Pending'],[null,'https://example.test/custom']]) {
    await page.evaluate(()=>{window.holdNextLoad=true;window.vm.playlist.library.onSelectCategory('songs')})
    await active('songs').locator('[data-playlist-track-id="local"]').click()
    await page.waitForFunction(()=>typeof window.rejectPendingLoad==='function')
    await page.evaluate(artist=>window.publishArtist(artist),artist)
    assert.notEqual(await page.evaluate(()=>window.vm.playback.track?.artist),artist,'old author is not rendered during replacement preparation')
    await page.evaluate(()=>window.rejectPendingLoad())
    await page.waitForFunction(()=>!window.vm.playback.isSelectionPending&&window.vm.playback.track?.id==='custom')
    await expectLine(expected)
    await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('streams'))
    await expectCardLine('custom',expected)
  }
  await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('playlists'))
  await active('playlists').waitFor()
  assert.equal(await indexFor('playlists').count(),1,'existing playlist-library category index remains')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({passed:true,checks,layoutChecks,lateReady:true,authorChangeAndClear:true,staleGenerationAndSelection:true,listAndLocalRegression:true,streamIndexRemoved:true,adjacentIndexesRetained:true,blankZoom:true},null,2))
} catch(error) {
  console.error(JSON.stringify({checks,errors,context:await page.evaluate(()=>({track:window.vm?.playback.track,calls:window.calls?.slice(-8)}))},null,2))
  throw error
} finally { await browser.close() }
