// Independent stream information acceptance. Production Shell/Card/CSS; only
// the native boundary is controlled. HTTP header/storage are tested in Rust.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5176'
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
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
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
 return {...descriptor,durationMs:descriptor.sourceKind==='stream'?null:60000,metadata:{title:descriptor.sourceKind==='stream'?null:'Local song '+descriptor.id,artist:descriptor.sourceKind==='stream'?null:'Local artist',album:descriptor.sourceKind==='stream'?null:'Local album',albumArtist:null,composer:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}};
};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_streams')return snapshot();
 if(command==='library_add_stream'){
  const commit=()=>{const rows=streams();if(!rows.some(item=>item.sourcePath===input.url))rows.push({id:'added',sourceKind:'stream',sourcePath:input.url,title:input.title||input.url,fileName:input.title||input.url,available:true,createdAtMs:500});localStorage.setItem('stream.information.registry',JSON.stringify(rows));return snapshot()};
  if(window.gateAdd)return new Promise(resolve=>window.pendingAdds.push(()=>resolve(commit())));
  return commit();
 }
 if(command==='library_get_playlists')return [mixed()];
 if(command==='library_get_folders')return {revision:0,roots:[{path:'/music',selected:true,directoryRules:[]}]};
 if(command==='library_scan_folder')return {directoryPath:'/music',directoryName:'music',sourceKind:'folder',sourcePath:'/music',sourceName:'music',selectedIndex:0,directoryPaths:['/music'],tracks:[local]};
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='library_warm_cover_thumbnails')return {requested:input.paths.length,processed:0,written:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  const result=fullTrack(input.path);
  if(input.path===freshUrl){result.stationName='Fetched Station';if(!window.failStationCache){const rows=streams();rows.find(item=>item.id==='fresh').stationName=result.stationName;rows.find(item=>item.id==='fresh').fileName=result.stationName;localStorage.setItem('stream.information.registry',JSON.stringify(rows));}}
  currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:result.durationMs,positionMs:0};
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
const page = await browser.newPage({ viewport: { width: 640, height: 1024 }, reducedMotion: 'reduce' })
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
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if(evidence)mkdirSync(evidence,{recursive:true})
const active = (category = 'streams') => page.locator('.playlist-management-content[data-library-category="'+category+'"]:not([inert])')
const streamCard = id => active().locator('[data-playlist-track-id="'+id+'"]')
const stationUrl = 'https://example.test/groovesalad-128-aac?Key=Preserved'
const measurements = []
const reloadRoot = async level => {
  await page.evaluate(level=>{localStorage.setItem('spmusic.streams.layout-level.v1',String(level));localStorage.setItem('spmusic.all-songs.layout-level.v1',String(level))},level)
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.vm?.playlist.library.streamSongs?.length>=4&&!window.vm.playlist.library.streamsLoading)
  await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('streams'))
  await active().locator('.all-songs-list[data-layout-level="'+level+'"]').waitFor()
}
try {
  await page.goto(origin+'/__stream_information_test?view=all',{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.vm?.playlist.library.streamSongs?.length>=4&&!window.vm.playlist.library.streamsLoading)
  for(let level=0;level<10;level++) {
    await reloadRoot(level)
    const card=streamCard('station')
    await card.scrollIntoViewIfNeeded()
    assert.equal(await card.getAttribute('data-source-kind'),'stream')
    assert.equal(await card.locator('.playlist-card-title').innerText(),'Groove Salad [SomaFM]')
    const url=card.locator('.playlist-card-stream-url')
    const source=card.locator('.playlist-card-stream-source')
    assert.equal(await url.isVisible(),level<=6,'URL visibility at level '+level)
    if(level<=6){
      assert.equal(await url.innerText(),stationUrl)
      const accessibleUrl=(await url.getAttribute('title')??'')+' '+(await card.getAttribute('title')??'')
      assert(accessibleUrl.includes(stationUrl),'full address is available without ellipsis')
    }
    assert.equal(await source.isVisible(),level>=3,'stream badge visibility at level '+level)
    if(level>=3)assert.equal((await source.innerText()).trim(),'流')
    assert.equal(await card.locator('.playlist-card-stream-cover-mark').isVisible(),level<=5,'stream cover fallback at level '+level)
    assert.equal(await card.locator('.playlist-card-artist').count(),0,'stream must not fabricate artist/album')
    const metric=await card.evaluate((node,level)=>{
      const box=element=>{if(!element)return null;const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}
      const title=node.querySelector('.playlist-card-title'),url=node.querySelector('.playlist-card-stream-url'),badge=node.querySelector('.playlist-card-stream-source')
      return{level,card:box(node),title:box(title),url:box(url),badge:box(badge),badgeVisible:!!badge?.getClientRects().length,urlVisible:!!url?.getClientRects().length,titleEllipsis:getComputedStyle(title).textOverflow,urlEllipsis:url?getComputedStyle(url).textOverflow:null}
    },level)
    if(level===3||level===4)assert(metric.badge.y>=metric.url.bottom-1,'large row badge below URL')
    if(level>=5)assert(metric.badge.right<=metric.card.right+1,'badge remains inside compact row')
    if(level===5||level===6)assert(metric.url.right<=metric.badge.x+1,'address does not overlap right badge')
    if(level>=7)assert(metric.title.right<=metric.badge.x+1,'compact title does not overlap right badge')
    assert(metric.title.right<=metric.card.right+1,'title remains within row')
    measurements.push(metric)
    assert.equal(await streamCard('custom').locator('.playlist-card-title').innerText(),'我的自定义电台')
    if(evidence)await page.screenshot({path:evidence+'/stream-layout-'+level+'.png'})
    await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('songs'))
    await active('songs').locator('.all-songs-list[data-layout-level="'+level+'"]').waitFor()
    const local=active('songs').locator('[data-playlist-track-id="local"]')
    await local.locator('.playlist-card-title').waitFor()
    assert.equal(await local.locator('.playlist-card-title').innerText(),'Local song local')
    assert.equal(await local.locator('.playlist-card-stream-url,.playlist-card-stream-source,.playlist-card-stream-cover-mark').count(),0,'ordinary song stays ordinary at '+level)
    assert.equal(Number(await local.getAttribute('data-content-shape'))&16,0)
  }
  await reloadRoot(9)
  const unknown=streamCard('unknown')
  await unknown.scrollIntoViewIfNeeded()
  assert((await unknown.locator('.playlist-card-title').innerText()).startsWith('https://example.test/VeryLong'))
  assert.equal(await unknown.locator('.playlist-card-stream-url').isVisible(),false)
  const compactOverflow=await unknown.evaluate(node=>{
    const card=node.getBoundingClientRect(),title=node.querySelector('.playlist-card-title'),badge=node.querySelector('.playlist-card-stream-source'),t=title.getBoundingClientRect(),b=badge.getBoundingClientRect()
    return{cardRight:card.right,titleRight:t.right,badgeRight:b.right,titleOverflow:getComputedStyle(title).textOverflow,titleWidth:title.clientWidth,titleScroll:title.scrollWidth}
  })
  assert(compactOverflow.titleRight<=compactOverflow.cardRight+1&&compactOverflow.badgeRight<=compactOverflow.cardRight+1)
  assert.equal(compactOverflow.titleOverflow,'ellipsis')
  assert(compactOverflow.titleScroll>compactOverflow.titleWidth,'long fallback is actually truncated')
  // A name discovered by the native playback result is propagated to the root,
  // playing presentation and queue without probing another network connection.
  await reloadRoot(4)
  const beforeGets=await page.evaluate(()=>window.calls.filter(row=>row.command==='library_get_streams').length)
  await page.evaluate(()=>{window.holdDetails=true;window.gateAdd=true;window.addCompletion=window.vm.playlist.library.onAddStream({url:'https://example.test/new-member',title:'New member'})})
  await page.waitForFunction(()=>window.pendingAdds.length===1)
  await streamCard('fresh').click()
  await page.waitForFunction(()=>window.pendingDetails.length===1)
  await page.evaluate(()=>{window.listeners.audio_track_details_changed({payload:window.pendingDetails.shift()});window.holdDetails=false;window.pendingAdds.shift()();window.gateAdd=false})
  assert.equal(await page.evaluate(()=>window.addCompletion),true)
  await page.waitForFunction(()=>window.vm.playback.track?.title==='Fetched Station'&&!window.vm.playback.isSelectionPending)
  await page.waitForFunction(()=>window.vm.playlist.library.streamSongs.find(row=>row.trackId==='fresh')?.track.title==='Fetched Station')
  assert.equal(await page.evaluate(()=>window.vm.playlist.library.streamSongs.some(row=>row.trackId==='added')),true,'Ready refresh and mutation preserve new member')
  assert.equal(await page.evaluate(()=>window.calls.filter(row=>row.command==='library_get_streams').length),beforeGets+1,'one metadata snapshot refresh after Ready')
  await page.waitForFunction(()=>window.vm.queue.tracks.find(row=>row.id==='fresh')?.title==='Fetched Station')
  assert.equal(await page.locator('.playlist-playback-copy strong').innerText(),'Fetched Station')
  assert((await page.locator('.playlist-playback-copy').innerText()).includes('https://example.test/fresh'),'dock keeps stream address')
  const noRemoteProbes=await page.evaluate(()=>window.calls.filter(row=>['audio_probe_playlist_cover','audio_probe_playlist_durations','audio_probe_playlist_track_summaries','library_warm_cover_thumbnails'].includes(row.command)).flatMap(row=>row.input?.paths??[row.input?.path]).filter(path=>/^https?:/i.test(path??'')))
  assert.deepEqual(noRemoteProbes,[])
  await reloadRoot(4)
  assert.equal(await streamCard('fresh').locator('.playlist-card-title').innerText(),'Fetched Station','cached station name survives restart fixture')
  // A failed native metadata save returns the old snapshot. This session still
  // uses its accepted observation; a stale event is never a source of a name.
  await page.evaluate(()=>{const rows=JSON.parse(localStorage.getItem('stream.information.registry'));const row=rows.find(item=>item.id==='fresh');delete row.stationName;row.fileName=row.sourcePath;localStorage.setItem('stream.information.registry',JSON.stringify(rows))})
  await reloadRoot(4)
  await page.evaluate(()=>{window.failStationCache=true})
  await streamCard('fresh').click()
  await page.waitForFunction(()=>window.vm.playback.track?.title==='Fetched Station'&&!window.vm.playback.isSelectionPending)
  await page.waitForFunction(()=>window.vm.playlist.library.streamSongs.find(row=>row.trackId==='fresh')?.track.title==='Fetched Station')
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('stream.information.registry')).find(item=>item.id==='fresh').stationName),undefined)
  await page.evaluate(()=>window.listeners.audio_track_details_changed({payload:{kind:'ready',requestId:1,generation:0,track:{id:'station',sourceKind:'stream',sourcePath:'https://example.test/groovesalad-128-aac?Key=Preserved',fileName:'Stale injected name',stationName:'Stale injected name',durationMs:null,metadata:{title:null,artist:null,album:null,coverArt:null}}}}))
  assert.equal(await page.evaluate(()=>window.vm.playback.track.title),'Fetched Station')
  assert.equal(await streamCard('station').locator('.playlist-card-title').innerText(),'Groove Salad [SomaFM]')
  // Ordinary song rendering retains artist/album and has no stream-only nodes.
  await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('songs'))
  const localCard=active('songs').locator('[data-playlist-track-id="local"]')
  await localCard.waitFor()
  assert.equal(await localCard.locator('.playlist-card-stream-url,.playlist-card-stream-source,.playlist-card-stream-cover-mark').count(),0)
  assert((await localCard.locator('.playlist-card-artist').innerText()).includes('Local artist'))
  assert((await localCard.locator('.playlist-card-artist').innerText()).includes('Local album'))
  // The shared measured-content window must retain separate stream/local
  // representatives, including a nonrepresentative stream returning on scroll.
  await page.evaluate(()=>{localStorage.setItem('spmusic.playlist.layout-level.v1','4');window.vm.playlist.library.onSelect('m3u8\u0000/lists/mixed-information.m3u8')})
  const mixedPanel=page.locator('.playlist-panel:not([inert])')
  const mixedGrid=mixedPanel.locator('.playlist-grid')
  await mixedPanel.locator('.playlist-grid[data-layout-level="4"]').waitFor()
  const mixedStream=mixedPanel.locator('[data-playlist-track-id="fresh"]')
  await mixedStream.scrollIntoViewIfNeeded()
  await mixedStream.locator('.playlist-card-title').waitFor()
  const beforeHeight=await mixedStream.evaluate(node=>node.getBoundingClientRect().height)
  assert((Number(await mixedStream.getAttribute('data-content-shape'))&16)!==0)
  const mixedLocal=mixedPanel.locator('[data-playlist-track-id="local"]')
  await mixedLocal.scrollIntoViewIfNeeded()
  await mixedLocal.locator('.playlist-card-title').waitFor()
  assert.equal(Number(await mixedLocal.getAttribute('data-content-shape'))&16,0)
  await mixedPanel.evaluate(node=>{node.scrollTop=0})
  await mixedStream.scrollIntoViewIfNeeded()
  await mixedStream.locator('.playlist-card-title').waitFor()
  assert.equal(await mixedStream.locator('.playlist-card-title').innerText(),'Fetched Station')
  assert(Math.abs((await mixedStream.evaluate(node=>node.getBoundingClientRect().height))-beforeHeight)<=1,'scroll reentry keeps stream height')
  // A physical Ctrl key distinguishes wheel steps from a trackpad pinch,
  // whose existing controller intentionally consumes one gesture until idle.
  await page.keyboard.down('Control')
  try {
    for(let level=5;level<=9;level++){
      await mixedGrid.dispatchEvent('wheel',{deltaY:100,ctrlKey:true,bubbles:true,cancelable:true})
      await mixedPanel.locator('.playlist-grid[data-layout-level="'+level+'"]').waitFor()
      await page.waitForTimeout(180) // The existing wheel controller owns a 150 ms step lock.
    }
  } finally { await page.keyboard.up('Control') }
  await mixedStream.scrollIntoViewIfNeeded()
  await mixedStream.locator('.playlist-card-stream-source').waitFor()
  assert.equal(await mixedStream.locator('.playlist-card-stream-url').isVisible(),false)
  assert.equal(await mixedLocal.locator('.playlist-card-stream-source').count(),0)
  assert.deepEqual(errors,[])
  if(evidence)writeFileSync(evidence+'/stream-information-geometry.json',JSON.stringify(measurements,null,2))
  console.log('stream information passed: 10 layout matrix, real source information, title priority, metadata refresh/reload, dock/queue agreement, ordinary song regression')
} catch(error) {
  console.error(await page.evaluate(()=>({route:window.vm?.playlist.library.route,body:document.body.innerText.slice(0,1200),calls:window.calls?.slice(-8)})),errors)
  throw error
} finally { await browser.close() }
