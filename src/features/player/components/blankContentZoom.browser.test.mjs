// Independent blank-area zoom and stream-dock acceptance. Run against Vite:
// SPMUSIC_PLAYWRIGHT=<installed Playwright> node <this file>. Native audio is mocked.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5177'
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
 return {...descriptor,durationMs:descriptor.sourceKind==='stream'||window.unknownLocalDuration?null:60000,metadata:{title:descriptor.sourceKind==='stream'?null:'Local song '+descriptor.id,artist:descriptor.sourceKind==='stream'?null:'Local artist',album:descriptor.sourceKind==='stream'?null:'Local album',albumArtist:null,composer:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}};
};
window.backendInvoke=async(command,args)=>{
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
const stationUrl = 'https://example.test/groovesalad-128-aac?Key=Preserved'
const cdp = await page.context().newCDPSession(page)
const baseline = process.env.SPMUSIC_ZOOM_BASELINE === '1'
const dockOnly = process.env.SPMUSIC_TEST_DOCK_ONLY === '1'
const detailsOnly = process.env.SPMUSIC_TEST_ZOOM_DETAILS_ONLY === '1'
const results = []
const panelFor = kind => kind === 'playlist' ? page.locator('.playlist-panel:not([inert])') : active(kind)
const level = async kind => Number(await panelFor(kind).locator('.playlist-grid').getAttribute('data-layout-level'))
async function root(kind = 'streams', value = 8) {
  await page.goto(origin+'/__stream_information_test?zoom='+kind,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.vm?.playlist.library.streamSongs?.length>=4&&!window.vm.playlist.library.streamsLoading)
  await page.evaluate(value=>{
    for(const key of ['spmusic.streams.layout-level.v1','spmusic.all-songs.layout-level.v1','spmusic.playlist.layout-level.v1'])localStorage.setItem(key,String(value))
  },value)
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.vm?.playlist.library.streamSongs?.length>=4&&!window.vm.playlist.library.streamsLoading)
  await page.evaluate(kind=>kind==='playlist'?window.vm.playlist.library.onSelect('m3u8\u0000/lists/short.m3u8'):window.vm.playlist.library.onSelectCategory(kind),kind)
  await panelFor(kind).locator('.playlist-grid[data-layout-level="'+value+'"]').waitFor()
}
async function blankPoint(kind) {
  return panelFor(kind).evaluate(node=>{
    const r=node.getBoundingClientRect(),dock=document.querySelector('.playlist-playback-dock')?.getBoundingClientRect()
    const bottom=Math.min(r.bottom,dock?.top??innerHeight,innerHeight)
    for(let y=bottom-35;y>r.top+310;y-=20)for(const fraction of [.5,.65,.35]){
      const x=r.left+r.width*fraction,t=document.elementFromPoint(x,y)
      if(t&&node.contains(t)&&!t.closest('button,input,textarea,select,[role="button"],.playlist-card,.playlist-management-quick-index'))return{x,y,target:t.className,panelHeight:r.height}
    }
    throw Error('no hit-testable content blank area')
  })
}
async function ctrlWheel(point, delta=80) {
  await page.keyboard.down('Control');await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,delta);await page.keyboard.up('Control');await page.waitForTimeout(220)
}
async function trackpad(point, delta=80, count=1) {
  for(let i=0;i<count;i++){await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:point.x,y:point.y,deltaX:0,deltaY:delta,modifiers:2});await page.waitForTimeout(35)}
  await page.waitForTimeout(180)
}
async function touch(point) {
  const touches=spread=>[{x:point.x-spread,y:point.y,id:1,radiusX:2,radiusY:2},{x:point.x+spread,y:point.y,id:2,radiusX:2,radiusY:2}]
  const targets=await page.evaluate(({x,y})=>[-45,45].map(dx=>document.elementFromPoint(x+dx,y)?.className),point)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches(45)})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touches(100)})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await page.waitForTimeout(220)
  return targets
}
try {
  for(const kind of dockOnly||detailsOnly?[]:['streams','songs','playlist']) {
    await root(kind)
    const point=await blankPoint(kind)
    await ctrlWheel(point)
    const mouse=await level(kind)
    results.push({kind,input:'ctrl-wheel',point,actual:mouse,expected:9})
    if(!baseline)assert.equal(mouse,9,kind+' blank Ctrl+wheel')
    await root(kind)
    const pad=await blankPoint(kind)
    await trackpad(pad)
    const track=await level(kind)
    results.push({kind,input:'trackpad',point:pad,actual:track,expected:9})
    if(!baseline)assert.equal(track,9,kind+' blank trackpad pinch')
    await root(kind)
    const fingers=await blankPoint(kind)
    const targets=await touch(fingers)
    const pinch=await level(kind)
    results.push({kind,input:'touch',point:fingers,targets,actual:pinch,expected:7,scale:await page.evaluate(()=>visualViewport.scale)})
    if(!baseline){
      assert.equal(pinch,7,kind+' blank two-finger pinch')
      assert.equal(await page.evaluate(()=>visualViewport.scale),1,kind+' collection pinch suppresses native page zoom')
      const key=kind==='streams'?'spmusic.streams.layout-level.v1':kind==='songs'?'spmusic.all-songs.layout-level.v1':'spmusic.playlist.layout-level.v1'
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'7',kind+' persists blank-area zoom')
    }
    await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1})
  }
  if(!baseline){
    if(!dockOnly){
    await root('streams',7)
    const heading=await active().evaluate(node=>{
      const r=node.getBoundingClientRect()
      for(let y=r.top+60;y<r.top+250;y+=20)for(const f of [.8,.6,.5]){
        const x=r.left+r.width*f,targets=[x-45,x,x+45].map(px=>document.elementFromPoint(px,y))
        if(targets.every(t=>t&&node.contains(t)&&!t.closest('button,input,a[href],[role="button"],.playlist-card,.playlist-management-quick-index')))return{x,y,target:targets[1].className}
      }
      throw Error('no static heading blank found')
    })
    await touch(heading)
    assert.equal(await level('streams'),6,'static heading whitespace accepts pinch')
    assert.equal(await page.evaluate(()=>visualViewport.scale),1)
    const button=active().locator('button').first(),b=await button.boundingBox()
    assert(b)
    const control={x:b.x+b.width/2,y:b.y+b.height/2}
    assert(await page.evaluate(({x,y})=>Boolean(document.elementFromPoint(x,y)?.closest('button')),control))
    await ctrlWheel(control)
    assert.equal(await level('streams'),6,'actual header control is protected')
    await active().getByRole('button',{name:'搜索流',exact:true}).click()
    const input=active().locator('input[type="search"]')
    await input.waitFor()
    const i=await input.boundingBox()
    await ctrlWheel({x:i.x+i.width/2,y:i.y+i.height/2})
    assert.equal(await level('streams'),6,'search input is protected')
    await input.fill('no matching stream blank zoom test')
    await active().locator('.playlist-management-empty').waitFor()
    const empty=await blankPoint('streams')
    await touch(empty)
    assert.equal(await page.evaluate(()=>localStorage.getItem('spmusic.streams.layout-level.v1')),'5','empty search result still accepts blank pinch')
    assert.equal(await page.evaluate(()=>visualViewport.scale),1)
    results.push({kind:'streams',input:'heading-control-input-empty',heading,empty,passed:true})

    await page.setViewportSize({width:1280,height:900})
    await root('streams',0)
    const gap=await active().locator('.playlist-grid').evaluate(node=>{
      const boxes=[...node.querySelectorAll('.playlist-card')].map(card=>card.getBoundingClientRect())
      for(const first of boxes)for(const second of boxes)if(second.left>first.right&&Math.abs(second.top-first.top)<2){
        const x=(first.right+second.left)/2,y=first.top+Math.min(first.height,80)/2,target=document.elementFromPoint(x,y)
        if(target&&node.contains(target)&&!target.closest('.playlist-card'))return{x,y,target:target.className}
      }
      throw Error('no actual gap between card columns')
    })
    await ctrlWheel(gap)
    assert.equal(await level('streams'),1,'column gap accepts Ctrl-wheel')
    const side=page.locator('.playlist-library-sidebar button').first()
    const s=await side.boundingBox()
    assert(s,'sidebar control is visible at desktop width')
    await ctrlWheel({x:s.x+s.width/2,y:s.y+s.height/2})
    assert.equal(await level('streams'),1,'sidebar cannot resize active collection')
    const index=await page.locator('.playlist-management-quick-index').boundingBox()
    assert(index,'quick index is visible')
    await ctrlWheel({x:index.x+index.width/2,y:index.y+index.height/2})
    assert.equal(await level('streams'),1,'quick index cannot resize active collection')
    const dock=await page.locator('.playlist-playback-dock').boundingBox()
    await ctrlWheel({x:dock.x+dock.width/2,y:dock.y+dock.height-30})
    assert.equal(await level('streams'),1,'dock cannot resize active collection')
    results.push({kind:'streams',input:'column-gap-and-external-controls',gap,passed:true})
    }

    // Production playback selection keeps the source identity independent of
    // duration. Inspect the actual slider boxes and computed paint visibility.
    await root('streams',8)
    const dockState=()=>page.locator('.playlist-playback-dock:not([inert])').evaluate(node=>{
      const read=slot=>{const element=node.querySelector('[data-slot="'+slot+'"]'),r=element.getBoundingClientRect(),s=getComputedStyle(element);return{visibility:s.visibility,width:r.width,height:r.height,display:s.display}}
      return{stream:node.hasAttribute('data-playback-stream'),sourceLabels:node.querySelectorAll('.playlist-playback-stream-source').length,url:node.querySelector('.playlist-playback-stream-url')?.textContent,track:read('slider-track'),range:read('slider-range'),thumb:read('slider-thumb')}
    })
    const select=async(category,id)=>{
      await page.evaluate(category=>window.vm.playlist.library.onSelectCategory(category),category)
      await active(category).locator('[data-playlist-track-id="'+id+'"]').click()
      await page.waitForFunction(id=>window.vm.playback.track?.id===id&&!window.vm.playback.isSelectionPending,id)
    }
    const verifyDock=(value,stream)=>{
      assert.equal(value.stream,stream)
      assert.equal(value.sourceLabels,0,'dock omits music icon plus stream label')
      assert.equal(value.track.visibility,'visible','timeline base track remains visible')
      assert(value.track.width>100&&value.track.height>0,'timeline base keeps its geometry')
      assert.equal(value.range.visibility,stream?'hidden':'visible')
      assert.equal(value.thumb.visibility,stream?'hidden':'visible')
      assert(value.thumb.width>0&&value.thumb.height>0,'hidden stream thumb retains layout geometry')
    }
    await select('streams','station')
    const live=await dockState();verifyDock(live,true)
    assert.equal(live.url,stationUrl,'stream URL remains in dock')
    const badge=streamCard('station').locator('.playlist-card-stream-source')
    assert.equal((await badge.innerText()).trim(),'流','card retains stream source label')
    assert(await badge.evaluate(node=>{const probe=document.createElement('span');probe.style.color='var(--player-inverse-primary)';node.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return getComputedStyle(node).color===expected&&getComputedStyle(node.querySelector('svg')).color===expected}),'card label and music icon retain inverse-primary')
    await select('songs','local')
    const normal=await dockState();verifyDock(normal,false)
    assert.equal(await page.evaluate(()=>window.vm.timeline.durationSeconds),60)
    await select('streams','station')
    const liveAgain=await dockState();verifyDock(liveAgain,true)
    await page.evaluate(()=>{window.unknownLocalDuration=true})
    await select('songs','local')
    const unknown=await dockState();verifyDock(unknown,false)
    assert.equal(await page.evaluate(()=>window.vm.timeline.durationSeconds),0,'unknown duration local remains a local song')
    assert.equal(normal.track.width,live.track.width,'switching source preserves base track width')
    assert.equal(unknown.track.height,live.track.height,'unknown duration preserves base track height')
    results.push({input:'stream-local-stream-unknown-local-dock',live,normal,liveAgain,unknown,passed:true})
  }
  console.log(JSON.stringify({baseline,results,errors},null,2))
  if(!baseline)assert.deepEqual(errors,[])
} catch(error) {console.error(JSON.stringify({results,errors},null,2));throw error}
finally {await browser.close()}
