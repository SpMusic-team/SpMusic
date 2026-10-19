// Offscreen return acceptance from the 2026-10-19 reference: the whole
// management group enters from the left at 1.5x; detail exits right at .5x.
// Independent browser acceptance test. Start Vite, then provide an existing
// Playwright package with SPMUSIC_PLAYWRIGHT. No project dependency is installed.
// Real PlayerShell, useAudioPlayer, PlayerSurface and command parsers are used;
// only the native command/event transport is replaced with deterministic input.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = (entry+compiledPanel).match(new RegExp('"(/[^"\\n]*/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
const compiledPanel = await (await fetch(origin + '/src/features/player/components/PlaylistPanel.tsx')).text()
let instrumentedGate
if(process.env.SPMUSIC_GATE_TRACE==='1'){
 const gate=await(await fetch(origin+'/src/features/player/hooks/useLibraryChromeTransition.ts')).text()
 instrumentedGate=gate.replace('setDetailVisibility((previous)', "window.gateTrace??=[];window.gateTrace.push({kind:'publish',routeKey,offscreen,time:performance.now()});setDetailVisibility((previous)")
 instrumentedGate=instrumentedGate.replace(/return \{\s*handoff: current\.handoff,/, "window.gateTrace??=[];window.gateTrace.push({kind:'render',route,previousRoute:session.route,detailVisibility,offscreenReturn:current.offscreenReturn,overviewBoundary:current.overviewBoundary,playerVisible,time:performance.now()});return { handoff: current.handoff,")
 assert(instrumentedGate.includes("kind:'publish'")&&instrumentedGate.includes("kind:'render'"),'trace the real gate publication and route boundary')
}
let sameUnitMotion
if(process.env.SPMUSIC_SAME_UNIT_DIAGNOSTIC==='1'){
 const current=await(await fetch(origin+'/src/features/appearance/model/appearanceMotion.ts')).text()
 sameUnitMotion=current.replace(/(incoming: \{[\s\S]*?animate: \{)\s*x: 0,/, '$1 x: "0%",')
 assert.notEqual(sameUnitMotion,current,'diagnostic changes only the incoming x endpoint to the same percentage unit')
}
let baselineLibrary
if(process.env.SPMUSIC_INCOMING_BASELINE==='1'){
 const current=await(await fetch(origin+'/src/features/player/components/PlaylistLibraryPanel.tsx')).text()
 baselineLibrary=current.replace('const offscreenEntry = currentEntry.offscreen;', 'const offscreenEntry = false;')
 assert.notEqual(baselineLibrary,current,'equivalent pre-fix baseline uses the ordinary stationary management branch')
}
let baselinePanel
if (process.env.SPMUSIC_OFFSCREEN_BASELINE === '1') {
 const original = execFileSync('git',['show',(process.env.SPMUSIC_BASELINE_REF || '96ae40a2a2193e74912049f200feb6f5fb5d461d')+':src/features/player/components/PlaylistPanel.tsx'],{encoding:'utf8'})
 baselinePanel = require('typescript').transpileModule(original,{compilerOptions:{target:99,module:99,jsx:5}}).outputText
 baselinePanel = baselinePanel.replace(/import \{([^}]+)\} from ["']react["'];/,(_line,names)=>`import baselineReact from '${dependency('react.js')}'; const {${names}}=baselineReact;`)
 baselinePanel = baselinePanel.replace(/import \{([^}]+)\} from ["']react\/jsx-dev-runtime["'];/,(_line,names)=>`import baselineJsx from '${dependency('react_jsx-dev-runtime.js')}'; const {${names.replaceAll(' as ',': ')}}=baselineJsx;`)
 baselinePanel = baselinePanel.replace(/from ["']([^"']+)["']/g,(match,id)=>{
  if(id.startsWith('/node_modules/')||id.startsWith('/@fs/'))return match
  if(id.startsWith('@/')) {
   const path='/src/'+id.slice(2),current=compiledPanel.match(new RegExp('["\u0027]('+path+'[^"\u0027]*)["\u0027]'))
   assert(current,'baseline import '+id);return 'from '+JSON.stringify(current[1])
  }
  return 'from '+JSON.stringify(dependency(id.replaceAll('/','_')+'.js'))
 })
}
if(process.env.SPMUSIC_DISABLE_VISIBILITY_PUBLISH==='1'){
 baselinePanel=compiledPanel.replace('const publishDetailVisibility = chromeTransition.publishDetailVisibility;', 'const publishDetailVisibility = undefined;')
 assert.notEqual(baselinePanel,compiledPanel,'diagnostic disables only parent visibility publication')
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'), 'retain real audio command parser')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `
import React from '${dependency('react.js')}';
import {PlayerSurface as RealSurface} from '/__management_real_surface.js';
export function PlayerSurface(props){window.viewModel=props.viewModel;${process.env.SPMUSIC_SCROLL_BASELINE === '1' ? 'props={...props,viewModel:{...props.viewModel,playlist:{...props.viewModel.playlist,entryPosition:undefined}}};' : ''}return React.createElement(RealSurface,props)}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import {useAudioPlayer} from '/src/features/player/hooks/useAudioPlayer.ts';
import '/src/index.css';
window.calls=[];window.config={scope:'a',count:3,sourceKind:'m3u8',sourcePath:null,failPath:null,gate:false,cancel:false};window.pending=[];
const fixtureCover="data:image/svg+xml,"+encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='800' height='500'><rect width='800' height='500' fill='#962aaa'/><circle cx='180' cy='200' r='140' fill='#20cdee'/><path d='M400 0L800 500H400Z' fill='#e9bc30'/></svg>");
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const descriptor=(scope,i)=>({id:scope+'-'+i,sourcePath:'/audio/'+scope+'/'+i+'.flac',fileName:i+'.flac',available:true});
const playlist=()=>({directoryPath:'/audio/'+window.config.scope,directoryName:'Folder '+window.config.scope,sourceKind:window.config.sourceKind,sourcePath:window.config.sourcePath??'/lists/'+window.config.scope+'.m3u8',sourceName:'Playlist '+window.config.scope,selectedIndex:window.config.selectedIndex??0,tracks:Array.from({length:window.config.count},(_,i)=>descriptor(window.config.scope,i))});
const track=path=>{const parts=path.replaceAll('\\\\','/').split('/'),scope=parts.at(-2),i=Number(parts.at(-1).split('.')[0]);return {...descriptor(scope,i),durationMs:180000,metadata:{title:'Song '+scope+' '+i,artist:'Artist '+scope,album:'Album '+scope,albumArtist:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:{mimeType:"image/svg+xml",filePath:fixtureCover,byteLen:1,dataUrl:fixtureCover}}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,time:performance.now()});
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_open_source'){if(window.config.cancel)throw {code:'USER_CANCELLED',message:'cancelled',recoverable:true};return {kind:'playlist',playlist:playlist()}}
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  if(window.config.gate)await new Promise(resolve=>window.pending.push(resolve));
  if(input.path===window.config.failPath)throw {code:'UNREADABLE_FILE',message:'injected unreadable file',recoverable:true};
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:180000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation:response.generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_load_playlist_cover_pixels'||command==='audio_load_cover_pixels'){
  const width=80,height=50,bytes=new Uint8Array(40+width*height*4),view=new DataView(bytes.buffer);
  bytes.set([0x53,0x50,0x58,0x52]);view.setUint16(4,1,true);view.setUint16(6,40,true);
  for(const [offset,value] of [[8,width],[12,height],[16,width*4],[20,1],[24,width*height*4],[28,0],[32,800],[36,500]])view.setUint32(offset,value,true);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const color=Math.hypot(x-18,y-20)<14?[32,205,238,255]:x>40&&y<(x-40)*1.25?[233,188,48,255]:[150,42,170,255];bytes.set(color,40+(y*width+x)*4)}
  return bytes;
 }
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 throw new Error('Unexpected native command '+command);
};
window.emitPosition=positionMs=>{state={...state,positionMs};window.listeners?.audio_state_changed?.({payload:{...state}})};
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();
function HookFixture(){window.playerApi=useAudioPlayer();return React.createElement('output',null,window.playerApi.track?.id??'empty')}
root.render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(new URLSearchParams(location.search).get('kind')==='hook'?HookFixture:PlayerShell))));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__management_fixture.js"')
const browser = await chromium.launch({ headless:true, channel:'msedge' })
const screenshotDirectory = process.env.SPMUSIC_SCREENSHOT_DIR || join(tmpdir(), 'spmusic-playlist-motion')
mkdirSync(screenshotDirectory, {recursive:true})
const report = []
async function open(width=2560,height=1440,kind='shell',reducedMotion='reduce',startupPage='media-library') {
  const page = await browser.newPage({viewport:{width,height},reducedMotion,colorScheme:'light',...(process.env.SPMUSIC_RECORD_VIDEO==='1'?{recordVideo:{dir:screenshotDirectory,size:{width,height}}}:{})})
  await page.addInitScript(({level,startupPage})=>{localStorage.setItem('spmusic.player.startup-page.v1',startupPage);if(level!==null)localStorage.setItem('spmusic.playlist.layout-level.v1',String(level))},{level:process.env.SPMUSIC_COMPACT_POINTER==='1'||process.env.SPMUSIC_FIRST_RETURN==='1'?2:null,startupPage})
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror',error=>{errors.push(error.message);console.error('PAGEERROR',error.message)})
  await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}))
  await page.route('**/__management_real_surface.js',route=>route.fulfill({contentType:'text/javascript',body:realSurface}))
  await page.route('**/__management_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__management_test?*',route=>route.fulfill({contentType:'text/html',body:html}))
  if(baselinePanel)await page.route('**/src/features/player/components/PlaylistPanel.tsx*',route=>route.fulfill({contentType:'text/javascript',body:baselinePanel}))
  if(baselineLibrary)await page.route('**/src/features/player/components/PlaylistLibraryPanel.tsx*',route=>route.fulfill({contentType:'text/javascript',body:baselineLibrary}))
  if(instrumentedGate)await page.route('**/src/features/player/hooks/useLibraryChromeTransition.ts*',route=>route.fulfill({contentType:'text/javascript',body:instrumentedGate}))
  if(sameUnitMotion)await page.route('**/src/features/appearance/model/appearanceMotion.ts*',route=>route.fulfill({contentType:'text/javascript',body:sameUnitMotion}))
  await page.goto(origin+'/__management_test?kind='+kind,{waitUntil:'commit'})
  await page.waitForFunction(kind=>Boolean(kind==='hook'?window.playerApi:window.viewModel),kind)
  return {page,errors}
}
async function importSource(page,scope,patch={}) {
  await page.evaluate(({scope,patch})=>{Object.assign(window.config,{scope,count:3,sourcePath:null,...patch});(window.playerApi?.openAudio??window.viewModel.playback.onOpenAudio)()},{scope,patch})
  await page.waitForFunction(()=>window.playerApi?!window.playerApi.audioBusy&&!window.playerApi.selectionPending:!window.viewModel.playback.isAudioBusy&&!window.viewModel.playback.isSelectionPending)
}
const playbackSnapshot = page => page.evaluate(()=>{const p=window.playerApi;return p?{track:p.track?.id,queue:p.queueTracks.map(t=>t.id),phase:p.playing}:{track:window.viewModel.playback.track?.id,queue:window.viewModel.queue.tracks.map(t=>t.id),phase:window.viewModel.playback.isPlaying}})

async function settled(page, target) {
  await page.waitForFunction(target => {
    const other = target === '.playlist-panel' ? '.playlist-management' : '.playlist-panel'
    const element = document.querySelector(target)
    return element && !document.querySelector(other) && getComputedStyle(element).opacity === '1'
  }, target)
  // Wait for shared geometry to stop changing, independent of duration settings.
  await page.evaluate(async target => {
    let previous = '', stable = 0
    for (let frame = 0; frame < 180 && stable < 5; frame++) {
      await new Promise(requestAnimationFrame)
      const element = document.querySelector(target === '.playlist-panel' ? '.playlist-hero-artwork' : '.playlist-management-cover')
      const rect = element?.getBoundingClientRect()
      const next = rect ? [rect.x, rect.y, rect.width, rect.height].map(n => n.toFixed(2)).join(',') : ''
      stable = next === previous ? stable + 1 : 0
      previous = next
    }
    if (stable < 5) throw new Error('shared cover failed to settle')
  }, target)
}


async function prepare(page,{count=100,anchor=true}={}) {
 if(anchor)await importSource(page,'anchor')
 await importSource(page,'offscreen',{count})
 await page.locator('.media-library-category[data-category-id="playlists"]').click()
 await settled(page,'.playlist-management')
 await page.getByRole('button',{name:'打开播放列表 Playlist offscreen',exact:true}).click()
 await settled(page,'.playlist-panel')
 await page.waitForFunction(()=>document.querySelector('.playlist-hero-image')?.complete)
}
async function scrollHero(page,partial=false) {
 await page.evaluate(partial=>{
  const p=document.querySelector('.playlist-panel'),h=document.querySelector('.playlist-hero-artwork')
  p.scrollTop+=h.getBoundingClientRect().bottom-p.getBoundingClientRect().top+(partial?-50:100)
  p.dispatchEvent(new Event('scroll'))
 },partial)
 await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})
}
async function captureReturn(page,label,selector='.playlist-hero-category',pointer=false,cpuSession=null) {
 const sampling=page.evaluate(async ({selector,pointer})=>{
  const result=[],start=performance.now();window.pointerCleanup?.();window.pointerSamplingReady=false;window.pointerEvents=[];window.pointerDockIds=new WeakMap();window.nextPointerDockId=0;const onPointer=event=>window.pointerEvents.push({type:event.type,time:performance.now()-start,target:event.target.closest('button')?.className});for(const type of ['pointerdown','click'])document.addEventListener(type,onPointer,{capture:true});window.pointerCleanup=()=>{for(const type of ['pointerdown','click'])document.removeEventListener(type,onPointer,{capture:true})}
  const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}}
  const visual=e=>{const style=getComputedStyle(e),m=new DOMMatrixReadOnly(style.transform);let opacity=1;for(let p=e;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);return {...rect(e),layoutWidth:e.offsetWidth,layoutHeight:e.offsetHeight,origin:style.transformOrigin,zIndex:style.zIndex,scaleX:m.a,scaleY:m.d,translateX:m.e,translateY:m.f,opacity}}
  let afterExitFrames=0
  const capture=()=>{
   const p=document.querySelector('.playlist-panel'),hero=document.querySelector('.playlist-hero-artwork'),managementRoot=document.querySelector('.playlist-management')
   if(pointer&&!p)afterExitFrames++
   const c=[...document.querySelectorAll('[data-playlist-scope]')].find(e=>e.dataset.playlistScope===window.viewModel.playlist.library.currentScope)
   result.push({time:performance.now()-start,sourceAfterManagement:Boolean(p&&managementRoot&&(managementRoot.compareDocumentPosition(p)&Node.DOCUMENT_POSITION_FOLLOWING)),managementRoot:managementRoot?visual(managementRoot):null,p:p?{...visual(p),scrollTop:p.scrollTop,transform:getComputedStyle(p).transform}:null,hero:hero?{...rect(hero),opacity:Number(getComputedStyle(hero).opacity)}:null,target:c?rect(c):null,targetCover:c?.querySelector('.playlist-management-cover')?visual(c.querySelector('.playlist-management-cover')):null,projected:Object.fromEntries(Object.entries({cover:'.playlist-management-cover',name:'.playlist-management-name',headingLabel:'.playlist-management-heading h2',categoryIcon:'.playlist-management-category',actions:'.playlist-management-actions'}).map(([kind,selector])=>[kind,[...document.querySelectorAll('.playlist-management:not([inert]) '+selector)].map(visual)])),incoming:Object.fromEntries(['heading','toolbar','card'].map(kind=>[kind,[...document.querySelectorAll('.playlist-management:not([inert]) .playlist-management-'+kind)].map(visual)])),management:[...document.querySelectorAll('.playlist-management-content')].map(visual),outgoingActions:[...document.querySelectorAll('.playlist-controller-actions')].map(visual),dockGeometry:[...document.querySelectorAll('.playlist-playback-dock')].map(e=>{if(!window.pointerDockIds.has(e))window.pointerDockIds.set(e,++window.nextPointerDockId);return {...rect(e),nodeId:window.pointerDockIds.get(e),transform:getComputedStyle(e).transform,hidden:e.getAttribute('aria-hidden'),opacity:Number(getComputedStyle(e).opacity)}}),docks:document.querySelectorAll('.playlist-playback-dock:not([aria-hidden="true"])').length})
  }
  capture();window.pointerSamplingReady=true;if(!pointer)document.querySelector(selector).click()
  const keepSampling=()=>{
   if(!pointer)return performance.now()-start<700
   const click=window.pointerEvents.find(e=>e.type==='click')
   if(!click)return performance.now()-start<12000
   const elapsed=performance.now()-start-click.time
   const sourcePresent=Boolean(document.querySelector('.playlist-panel'))
   return elapsed<700 || (sourcePresent&&elapsed<3000) || (!sourcePresent&&afterExitFrames<6&&elapsed<3500)
  }
  while(keepSampling()){await new Promise(requestAnimationFrame);capture()}
  window.pointerCleanup()
  return result
 },{selector,pointer})
 // Mark the sampler handled while input preparation is pending; a failing
 // input must retain its own error when browser cleanup cancels sampling.
 void sampling.catch(()=>{})
 if(pointer){
  await page.waitForFunction(()=>window.pointerSamplingReady)
  const box=await page.locator(selector).boundingBox()
  assert(box,'real pointer target has painted geometry')
  if(cpuSession)await cpuSession.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.SPMUSIC_CPU_RATE)})
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2)
 }
 const samples=await sampling
 writeFileSync(join(screenshotDirectory,label+'-trace.json'),JSON.stringify(samples,null,2))
 writeFileSync(join(screenshotDirectory,label+'-events.json'),JSON.stringify(await page.evaluate(()=>window.pointerEvents),null,2))
 if(instrumentedGate)writeFileSync(join(screenshotDirectory,label+'-gate.json'),JSON.stringify(await page.evaluate(()=>window.gateTrace),null,2))
 await page.screenshot({path:join(screenshotDirectory,label+'-settled.png')})
 return samples
}
function checkOffscreen(samples,label,{incoming=true,initialDockHidden=false}={}) {
 const first=samples[0].p,live=samples.filter(s=>s.p)
 assert(samples[0].hero.bottom<=first.y,'head image starts entirely above viewport')
 assert(live.every(s=>Math.abs(s.p.scrollTop-first.scrollTop)<1),'return never resets detail scrollTop')
 assert(samples.at(-1).p===null,'detail removed after exit')
 assert(live.some(s=>s.p.opacity>.05&&s.p.opacity<.95),'detail fades over multiple frames')
 if(initialDockHidden){
  assert(samples.every(s=>s.docks<=1),'at most one interactive playback dock while compact controller is hidden')
  assert.equal(samples.at(-1).docks,1,'management restores one interactive playback dock')
 }else assert(samples.every(s=>s.docks===1),'one persistent interactive playback dock')
 assert(live.some(s=>s.p.opacity>.02&&s.p.opacity<.98&&s.p.scaleX<.95&&s.p.translateX>first.layoutWidth*.05),'detail visibly moves right and shrinks while fading')
 assert(live.every(s=>s.p.scaleX<=1.001&&s.p.scaleX>=.499&&Math.abs(s.p.scaleX-s.p.scaleY)<.001),'detail stays within the reference uniform 1 to .5 scale')
 assert(live.every(s=>Math.abs(s.p.translateY)<.5),'detail translates only horizontally')
 assert(live.every(s=>Math.abs(s.p.translateX/first.layoutWidth-(1-s.p.scaleX))<.02),'detail couples rightward travel to shrink: x/W=1-scale')
 assert(live.every(s=>{const [x,y]=s.p.origin.split(' ').map(parseFloat);return Math.abs(x-s.p.layoutWidth/2)<1&&Math.abs(y-s.p.layoutHeight/2)<1}),'detail shrinks around its center')
 assert(live.every(s=>s.hero.bottom<=s.p.y+2),'offscreen hero never projects into visible section')
 const groups=samples.flatMap(s=>s.management.map(e=>({time:s.time,...e})))
 assert(groups.length,'management main content group enters')
 const firstGroup=groups[0],lastGroup=groups.at(-1)
 assert(firstGroup.scaleX>1.4&&firstGroup.translateX/firstGroup.layoutWidth<-.65,'management starts enlarged to 1.5x and offset -75% of its width')
 assert(groups.some(e=>e.opacity>.02&&e.scaleX>1.02&&e.scaleX<1.48&&e.translateX< -5),'management group has a visible intermediate left-to-rest pose')
 assert(groups.every(e=>Math.abs(e.translateX/e.layoutWidth+1.5*(e.scaleX-1))<.025),'management couples translation and scale: x/W=-1.5*(scale-1)')
 assert(groups.every(e=>{const [x,y]=e.origin.split(' ').map(parseFloat);return Math.abs(x)<1&&Math.abs(y)<1}),'management scales around its top left')
 assert(samples.filter(s=>s.p&&s.managementRoot).every(s=>Number(s.p.zIndex)>Number(s.managementRoot.zIndex)||(s.sourceAfterManagement&&s.p.zIndex===s.managementRoot.zIndex)),'source paints above management throughout the overlapping transition')
 assert(Math.abs(lastGroup.scaleX-1)<.001&&Math.abs(lastGroup.translateX)<.5,'management settles at natural size and position')
 const entrance={group:{first:firstGroup,last:lastGroup}}
 if(incoming)for(const kind of ['heading','toolbar','card']){
  const frames=samples.flatMap(s=>s.incoming[kind].map(e=>({time:s.time,...e})))
  assert(frames.length,kind+' is present on management')
  assert(frames.every(e=>Math.abs(e.scaleX-1)<.001&&Math.abs(e.translateX)<.5),kind+' inherits the one group transform without another independent zoom')
  const last=frames.at(-1)
  assert(frames.some(e=>e.opacity>.02&&e.width>last.width*1.02),kind+' is visibly enlarged by the incoming content group')
  entrance[kind]={first:frames[0],last,maxPaintedWidth:Math.max(...frames.filter(e=>e.opacity>.02).map(f=>f.width))}
 }
 if(incoming)entrance.sharedNodes=checkOffscreenProjection(samples)
 return {label,frames:samples.length,scrollTop:first.scrollTop,minWidth:Math.min(...live.map(s=>s.p.width)),initialWidth:first.width,removedMs:samples.find(s=>!s.p)?.time,entrance}
}
function checkOffscreenProjection(samples){
 const result={}
 for(const kind of ['cover','name','headingLabel','categoryIcon','actions']){
  const visible=samples.flatMap(s=>(s.projected?.[kind]||[]).filter(e=>e.opacity>.02).map(e=>({group:s.management[0],...e})))
  assert(visible.length,kind+' has visible projected-node evidence')
  assert(visible.every(e=>Math.abs(e.scaleX-1)<.001&&Math.abs(e.scaleY-1)<.001&&Math.abs(e.translateX)<.5&&Math.abs(e.translateY)<.5),kind+' inherits only the management group transform, without residual shared-layout projection')
  assert(visible.every(e=>Math.abs(e.width-e.layoutWidth*e.group.scaleX)<1.5&&Math.abs(e.height-e.layoutHeight*e.group.scaleY)<1.5),kind+' painted size follows the same management group scale')
  result[kind]={visibleSamples:visible.length,maxLocalX:Math.max(...visible.map(e=>Math.abs(e.translateX))),maxLocalY:Math.max(...visible.map(e=>Math.abs(e.translateY)))}
 }
 return result
}
function checkPointerHandoff(samples,events) {
 const click=events.find(e=>e.type==='click'),first=samples[0],last=samples.at(-1)
 assert(click,'real pointer click is recorded')
 const destination=samples.find(s=>s.management.some(p=>p.opacity>.02&&p.scaleX>1.02&&p.scaleX<1.48))
 const source=samples.find(s=>!s.p || s.p.width<first.p.width-1 || s.p.opacity<.999)
 assert(destination&&source,'both source and destination visibly change')
 const initialDock=first.dockGeometry[0].y,finalDock=last.dockGeometry.find(d=>d.hidden!=='true').y
 const low=Math.min(initialDock,finalDock),high=Math.max(initialDock,finalDock)
 const dockPositions=[...new Set(samples.filter(s=>s.time>=click.time).flatMap(s=>s.dockGeometry.filter(d=>d.hidden!=='true').map(d=>d.y)).filter(y=>y>low+2&&y<high-2).map(y=>Math.round(y*10)/10))]
 const summary={clickMs:click.time,firstDestinationVisibleMs:destination.time-click.time,firstSourceChangeMs:source.time-click.time,initialDockY:initialDock,finalDockY:finalDock,intermediateDockY:dockPositions}
 writeFileSync(join(screenshotDirectory,'compact-pointer-handoff.json'),JSON.stringify(summary,null,2))
 assert(samples.some(s=>s.p?.opacity>.02&&s.p.opacity<.98&&s.management.some(p=>p.scaleX>1.02&&p.scaleX<1.48)),'source exit overlaps management group entry')
 const initialActions=first.outgoingActions[0]
 assert(initialActions,'compact actions are present before returning')
 assert(samples.some(s=>s.p&&s.outgoingActions.some(e=>e.opacity>.02&&e.opacity<.98&&e.width<initialActions.width*.95&&e.x>initialActions.x+5)),'compact source actions move right, shrink and fade with the departing detail')
 assert(dockPositions.length>=2,'dock interpolates across visible intermediate positions instead of jumping to rest: '+JSON.stringify(summary))
 return summary
}
async function checkCategorySignalIsolation(page){
 async function enter(categoryId){
  const frames=await page.evaluate(async categoryId=>{
   const frames=[],start=performance.now()
   window.viewModel.playlist.library.onSelectCategory(categoryId)
   while(performance.now()-start<650){
    await new Promise(requestAnimationFrame)
    const group=document.querySelector('.playlist-management:not([inert]) .playlist-management-content')
    if(group){const m=new DOMMatrixReadOnly(getComputedStyle(group).transform);frames.push({scale:m.a,x:m.e})}
   }
   return frames
  },categoryId)
  assert(frames.length,'category route renders its heading')
  assert(frames.every(e=>Math.abs(e.scale-1)<.001&&Math.abs(e.x)<.5),'ordinary category navigation never reuses offscreen cover entrance')
 }
 await enter('folder');await enter('playlists')
 await settled(page,'.playlist-management')
 await page.getByRole('button',{name:'打开播放列表 Playlist offscreen',exact:true}).click()
 await settled(page,'.playlist-panel');await scrollHero(page)
 await page.evaluate(()=>document.querySelector('.playlist-playback-nav button[aria-label="打开播放界面"]').click())
 await page.waitForFunction(()=>!document.querySelector('.playlist-panel')&&Boolean(document.querySelector('.player-stage')))
 await enter('playlists')
 return {categorySwitch:'offscreen signal cleared',offscreenPlayerThenCategory:'ordinary category entry'}
}
async function checkPartialHero(){
 const partial=await open(1280,900,'shell','no-preference')
 await prepare(partial.page);await scrollHero(partial.page);await scrollHero(partial.page,true)
 const samples=await captureReturn(partial.page,'partial-hero')
 assert(samples[0].hero.bottom>samples[0].p.y,'partial hero is visible')
 assert(samples.filter(s=>s.p).every(s=>Math.abs(s.p.width-samples[0].p.width)<1),'partial hero keeps shared cover branch')
 const finalCoverWidth=samples.at(-1).targetCover?.width
 assert(finalCoverWidth,'management publishes the destination shared cover')
 assert(samples.some(s=>
  (s.hero&&s.p?.opacity>.02&&Math.abs(s.hero.width-samples[0].hero.width)>10)
  ||(s.targetCover?.opacity>.02&&s.targetCover.width>finalCoverWidth+10&&s.targetCover.width<samples[0].hero.width-10)),
 'partial hero retains visible interpolation on the source or destination projection lead')
 assert.deepEqual(partial.errors,[]);await partial.page.close()
 return {offscreenToPartial:'shared artwork restored'}
}
if(process.env.SPMUSIC_PARTIAL_ONLY==='1'){
 try{console.log(JSON.stringify(await checkPartialHero()))}finally{await browser.close()}
 process.exit(0)
}
if(process.env.SPMUSIC_REDUCED_ONLY==='1'){
 try{
  const {page,errors}=await open(1440,900,'shell','reduce','player')
  await importSource(page,'offscreen',{count:160})
  await page.locator('.window-bar').getByRole('button',{name:'播放列表',exact:true}).click()
  await settled(page,'.playlist-panel');await scrollHero(page)
  await page.locator('.playlist-controller-back-button').click()
  await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})
  assert.equal(await page.locator('.playlist-panel').count(),0,'reduced return completes without a timed departure')
  const identities=await page.evaluate(()=>[...document.querySelectorAll('.playlist-management-content,.playlist-management-cover,.playlist-management-name,.playlist-management-heading h2,.playlist-management-category,.playlist-management-actions')].map(e=>new DOMMatrixReadOnly(getComputedStyle(e).transform).isIdentity))
  assert(identities.length>=6&&identities.every(Boolean),'reduced group and restored shared nodes have identity matrices')
  assert.deepEqual(errors,[]);await page.screenshot({path:join(screenshotDirectory,'reduced-direct.png')});await page.close()
  console.log('PASS reduced direct completion and restored shared identities')
 }finally{await browser.close()}
 process.exit(0)
}
if(process.env.SPMUSIC_FIRST_RETURN==='1'){
 try{
  const rounds=Number(process.env.SPMUSIC_FIRST_RETURN_ROUNDS||1)
  for(let round=1;round<=rounds;round++){
   const {page,errors}=await open(1440,900,'shell','no-preference','player')
   const cpuSession=process.env.SPMUSIC_CPU_RATE?await page.context().newCDPSession(page):null
   await importSource(page,'offscreen',{count:Number(process.env.SPMUSIC_FIRST_RETURN_COUNT||1797)})
   assert.equal(await page.locator('.playlist-management').count(),0,'fresh player has never mounted management')
   await page.locator('.window-bar').getByRole('button',{name:'播放列表',exact:true}).click()
   await settled(page,'.playlist-panel')
   await page.waitForFunction(()=>document.querySelector('.playlist-hero-image')?.complete)
   for(const entry of ['first-player-detail','repeat-management-detail']){
    if(entry.startsWith('repeat')){
     await settled(page,'.playlist-management')
     await page.getByRole('button',{name:'打开播放列表 Playlist offscreen',exact:true}).click()
     await settled(page,'.playlist-panel')
    }
    await page.mouse.move(900,450);await page.mouse.wheel(0,2800)
    await page.waitForFunction(()=>document.querySelector('.playlist-controller-actions')?.dataset.actionsVisible==='true')
    await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.playlist-controller-actions')).opacity)===1)
    const before=await page.evaluate(()=>({route:window.viewModel.playlist.library.route,scope:window.viewModel.playlist.library.currentScope,trackCount:window.viewModel.playlist.tracks.length,hero:document.querySelector('.playlist-hero-artwork').getBoundingClientRect().toJSON(),panel:document.querySelector('.playlist-panel').getBoundingClientRect().toJSON(),gate:window.gateTrace?.at(-1)}))
    const label=round+'-'+entry
    writeFileSync(join(screenshotDirectory,label+'-before.json'),JSON.stringify(before,null,2))
    const samples=await captureReturn(page,label,'.playlist-controller-back-button',true,cpuSession)
    if(cpuSession)await cpuSession.send('Emulation.setCPUThrottlingRate',{rate:1})
    // Reproduction mode always records both returns, including a failing first.
    let acceptance
    try{acceptance=checkOffscreen(samples,label,{initialDockHidden:true})}
    catch(error){acceptance={label,failure:error.message}}
    const groups=samples.flatMap(s=>s.management)
    const maxIncomingCouplingError=Math.max(...groups.map(g=>Math.abs(g.translateX/g.layoutWidth+1.5*(g.scaleX-1))))
    report.push({before,cpuRate:Number(process.env.SPMUSIC_CPU_RATE||1),maxIncomingCouplingError,...acceptance})
   }
   assert.deepEqual(errors,[])
   const video=page.video();await page.close();if(video)await video.saveAs(join(screenshotDirectory,'first-and-repeat-'+round+'.webm'))
  }
  writeFileSync(join(screenshotDirectory,'first-return-report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({report:report.map(r=>({label:r.label,failure:r.failure,trackCount:r.before.trackCount,cpuRate:r.cpuRate,maxIncomingCouplingError:r.maxIncomingCouplingError})),screenshots:screenshotDirectory}))
  if(report.some(r=>r.failure))process.exitCode=1
 }finally{await browser.close()}
 process.exit(process.exitCode||0)
}
if(process.env.SPMUSIC_PROJECTION_PROBE==='1'){
 try{
  const {page,errors}=await open(1440,900,'shell','no-preference')
  await prepare(page,{count:1797,anchor:false})
  await page.mouse.move(900,450);await page.mouse.wheel(0,2800)
  await page.waitForFunction(()=>document.querySelector('.playlist-controller-actions')?.dataset.actionsVisible==='true')
  await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.playlist-controller-actions')).opacity)===1)
  const samples=await captureReturn(page,'shared-history-projection','.playlist-controller-back-button',true)
  const summary=Object.fromEntries(['cover','name','headingLabel','categoryIcon','actions'].map(kind=>{
   const visible=samples.flatMap(s=>s.projected[kind]).filter(e=>e.opacity>.02)
   return [kind,{visibleSamples:visible.length,maxTranslateX:Math.max(...visible.map(e=>Math.abs(e.translateX))),minScale:Math.min(...visible.map(e=>e.scaleX)),maxScale:Math.max(...visible.map(e=>e.scaleX))}]
  }))
  writeFileSync(join(screenshotDirectory,'projection-summary.json'),JSON.stringify(summary,null,2))
  assert.deepEqual(errors,[])
  const video=page.video();await page.close();if(video)await video.saveAs(join(screenshotDirectory,'shared-history-projection.webm'))
  console.log(JSON.stringify({summary,screenshots:screenshotDirectory}))
 }finally{await browser.close()}
 process.exit(0)
}
if(process.env.SPMUSIC_COMPACT_POINTER==='1') {
 try {
  const {page,errors}=await open(1440,900,'shell','no-preference')
  await prepare(page,{count:Number(process.env.SPMUSIC_POINTER_TRACK_COUNT || 1797),anchor:false})
  await page.mouse.move(900,450);await page.mouse.wheel(0,2800)
  await page.waitForFunction(()=>document.querySelector('.playlist-controller-actions')?.dataset.actionsVisible==='true')
  await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.playlist-controller-actions')).opacity)===1)
  const before=await page.evaluate(()=>({scrollTop:document.querySelector('.playlist-panel').scrollTop,layout:document.querySelector('.playlist-grid').dataset.layoutLevel,columns:getComputedStyle(document.querySelector('.playlist-grid')).gridTemplateColumns,trackCount:document.querySelectorAll('.playlist-card').length,backRect:document.querySelector('.playlist-controller-back-button').getBoundingClientRect().toJSON()}))
  writeFileSync(join(screenshotDirectory,'compact-pointer-before.json'),JSON.stringify(before,null,2))
  await page.screenshot({path:join(screenshotDirectory,'compact-pointer-before.png')})
  const samples=await captureReturn(page,'compact-pointer','.playlist-controller-back-button',true)
  report.push({before,handoff:checkPointerHandoff(samples,await page.evaluate(()=>window.pointerEvents)),...checkOffscreen(samples,'compact pointer',{initialDockHidden:true})})
  if(process.env.SPMUSIC_SIGNAL_REGRESSION==='1')report.push(await checkCategorySignalIsolation(page))
  assert.deepEqual(errors,[]);const video=page.video();await page.close();if(video)await video.saveAs(join(screenshotDirectory,'compact-return.webm'))
  const reduced=await open(1440,900,'shell','reduce')
  await prepare(reduced.page,{count:1797,anchor:false})
  await reduced.page.mouse.move(900,450);await reduced.page.mouse.wheel(0,2800)
  await reduced.page.waitForFunction(()=>document.querySelector('.playlist-controller-actions')?.dataset.actionsVisible==='true')
  await reduced.page.locator('.playlist-controller-back-button').click()
  await reduced.page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})
  assert.equal(await reduced.page.locator('.playlist-panel').count(),0,'real compact reduced return removes detail immediately')
  assert.equal(await reduced.page.locator('.playlist-management-cover').evaluate(e=>getComputedStyle(e).transform),'none')
  assert.deepEqual(reduced.errors,[]);await reduced.page.screenshot({path:join(screenshotDirectory,'compact-reduced-after.png')});await reduced.page.close()
  report.push({realCompactReduced:'direct completion'})
  console.log(JSON.stringify({browser:browser.version(),report,screenshots:screenshotDirectory}))
 } finally {await browser.close()}
 process.exit(0)
}
try {
 for(const [width,height] of (process.env.SPMUSIC_OFFSCREEN_FOCUSED==='1'?[[1280,900]]:[[1280,900],[480,800]])) {
  const {page,errors}=await open(width,height,'shell','no-preference')
  await prepare(page);await scrollHero(page)
  const playback=await playbackSnapshot(page)
  report.push(checkOffscreen(await captureReturn(page,width+'-offscreen'),'offscreen '+width))
  await settled(page,'.playlist-management')
  for(let repeat=0;repeat<3;repeat++){
   await page.getByRole('button',{name:'打开播放列表 Playlist offscreen',exact:true}).click()
   await settled(page,'.playlist-panel');await scrollHero(page)
   await page.evaluate(async()=>{
    document.querySelector('.playlist-hero-category').click()
    for(let i=0;i<4;i++)await new Promise(requestAnimationFrame)
    document.querySelector('.playlist-management:not([inert]) .playlist-management-card-button[aria-label="打开播放列表 Playlist offscreen"]').click()
   })
   await settled(page,'.playlist-panel')
   assert.equal(await page.locator('.playlist-panel').count(),1)
   assert.equal(await page.locator('.playlist-management').count(),0)
   const state=await page.locator('.playlist-panel').evaluate(p=>({identity:new DOMMatrixReadOnly(getComputedStyle(p).transform).isIdentity,inert:p.inert}))
   assert.deepEqual(state,{identity:true,inert:false},'reentry clears exiting transform and inert')
   await page.evaluate(()=>document.querySelector('.playlist-hero-category').click());await settled(page,'.playlist-management')
  }
  report.push({rapidReentry:3,viewport:[width,height],oneDetail:true,transformCleared:true})
  assert.deepEqual(await playbackSnapshot(page),playback)
  assert.deepEqual(errors,[]);await page.close()
 }
 if(process.env.SPMUSIC_OFFSCREEN_FOCUSED!=='1'){
 const missing=await open(1280,900,'shell','no-preference')
 await prepare(missing.page);await scrollHero(missing.page)
 await missing.page.addStyleTag({content:'.playlist-management-card-button {display:none !important}'})
 report.push(checkOffscreen(await captureReturn(missing.page,'missing-target'),'missing target',{incoming:false}))
 assert.deepEqual(missing.errors,[]);await missing.page.close()
 }
 report.push(await checkPartialHero())
 const player=await open(1280,900,'shell','no-preference')
 await prepare(player.page);await scrollHero(player.page)
 const playerSamples=await captureReturn(player.page,'offscreen-player','.playlist-playback-nav button[aria-label="打开播放界面"]')
 assert(playerSamples.filter(s=>s.p).every(s=>Math.abs(s.p.width-playerSamples[0].p.width)<1),'ordinary player return never uses management shrink')
 assert.equal(await player.page.locator('.playlist-management').count(),0)
 assert.equal(await player.page.locator('.playlist-panel').count(),0)
 assert.deepEqual(player.errors,[]);await player.page.close();report.push({offscreenPlayerReturn:'ordinary fade'})
 if(process.env.SPMUSIC_OFFSCREEN_FOCUSED!=='1'){
 const reduced=await open(480,800,'shell','reduce')
 await prepare(reduced.page);await scrollHero(reduced.page)
 const reducedResult=await reduced.page.evaluate(async()=>{const start=performance.now();document.querySelector('.playlist-hero-category').click();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return {time:performance.now()-start,count:document.querySelectorAll('.playlist-panel').length,transform:getComputedStyle(document.querySelector('.playlist-management-cover')).transform}})
 writeFileSync(join(screenshotDirectory,'reduced-result.json'),JSON.stringify(reducedResult,null,2))
 assert.equal(reducedResult.count,0);assert.equal(reducedResult.transform,'none');assert(reducedResult.time<100,'reduced motion finishes in two normal frames: '+reducedResult.time+'ms')
 assert.deepEqual(reduced.errors,[]);await reduced.page.close();report.push({reduced:reducedResult})
 }
 console.log(JSON.stringify({browser:browser.version(),report,screenshots:screenshotDirectory}))
} catch(error){
 for(const [i,page] of browser.contexts().flatMap(c=>c.pages()).entries())await page.screenshot({path:join(screenshotDirectory,'offscreen-failure-'+i+'.png')}).catch(()=>{})
 throw error
}finally{await browser.close()}
