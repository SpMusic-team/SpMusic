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
const committedModules = new Map()
let componentImports = ''
if (process.env.SPMUSIC_MANAGEMENT_COMMITTED_BASELINE === '1') for(const name of ['PlaylistPanel','PlaylistLibraryPanel']) componentImports += await (await fetch(origin+'/src/features/player/components/'+name+'.tsx')).text()
const dependency = name => {
  const match = (entry+componentImports).match(new RegExp('"(/[^"\\n]*/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
if (process.env.SPMUSIC_MANAGEMENT_COMMITTED_BASELINE === '1') {
 const ts = require('typescript'), ref = process.env.SPMUSIC_BASELINE_REF || '96ae40a2a2193e74912049f200feb6f5fb5d461d'
 for(const name of ['PlaylistPanel','PlaylistLibraryPanel']) {
  const original = execFileSync('git',['show',ref+':src/features/player/components/'+name+'.tsx'],{encoding:'utf8'})
  let compiled = ts.transpileModule(original,{compilerOptions:{target:99,module:99,jsx:5}}).outputText
  compiled = compiled.replace(/import \{([^}]+)\} from ["']react["'];/,(_line,names)=>`import baselineReact from '${dependency('react.js')}'; const {${names}}=baselineReact;`)
  compiled = compiled.replace(/import \{([^}]+)\} from ["']react\/jsx-dev-runtime["'];/,(_line,names)=>`import baselineJsx from '${dependency('react_jsx-dev-runtime.js')}'; const {${names.replaceAll(' as ',': ')}}=baselineJsx;`)
  compiled = compiled.replace(/from ["']([^"']+)["']/g,(match,id)=>{
   if(id.startsWith('/node_modules/')||id.startsWith('/@fs/'))return match
   if(id.startsWith('@/')) {
    const path='/src/'+id.slice(2),current=componentImports.match(new RegExp('["\u0027]('+path+'[^"\u0027]*)["\u0027]'))
    assert(current,'baseline import '+id);return 'from '+JSON.stringify(current[1])
   }
   return 'from '+JSON.stringify(dependency(id.replaceAll('/','_')+'.js'))
  })
  committedModules.set(name,compiled)
 }
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
window.calls=[];window.config={scope:'a',count:3,sourceKind:'m3u8',sourcePath:null,failPath:null,failAllLoads:false,gate:false,cancel:false};window.pending=[];
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
  if(window.config.failAllLoads||input.path===window.config.failPath)throw {code:'UNREADABLE_FILE',message:'injected unreadable file',recoverable:true};
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:180000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation:response.generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:result.metadata.coverArt}}
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_probe_playlist_track_summaries')return input.paths.map(sourcePath=>{const parts=sourcePath.replaceAll('\\\\','/').split('/'),scope=parts.at(-2),i=Number(parts.at(-1).split('.')[0]);return {sourcePath,summary:{title:'Song '+scope+' '+i,artist:'Artist '+scope,album:'Album '+scope,albumArtist:null,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
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
async function open(width=2560,height=1440,kind='shell',reducedMotion='reduce') {
  const page = await browser.newPage({viewport:{width,height},reducedMotion,colorScheme:'light'})
  await page.addInitScript(()=>localStorage.setItem('spmusic.player.startup-page.v1','media-library'))
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror',error=>{errors.push(error.message);console.error('PAGEERROR',error.message)})
  await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}))
  await page.route('**/__management_real_surface.js',route=>route.fulfill({contentType:'text/javascript',body:realSurface}))
  await page.route('**/__management_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__management_test?*',route=>route.fulfill({contentType:'text/html',body:html}))
  if(process.env.SPMUSIC_MOTION_TIMING_BASELINE==='1')for(const name of ['PlaylistPanel','PlaylistLibraryPanel']){
    const current=await(await fetch(origin+'/src/features/player/components/'+name+'.tsx')).text()
    const old=current.replace(/Math\.min\(appearanceMotion\.layoutTransition\.duration \?\? 0, [\d.]+\)/g,'(appearanceMotion.layoutTransition.duration ?? 0) * (7 / 3)').replaceAll('transition: returnTransition,','transition: appearanceMotion.layoutTransition,')
    assert(old.includes('(appearanceMotion.layoutTransition.duration ?? 0) * (7 / 3)'),'rebuild pre-fix motion duration')
    await page.route('**/src/features/player/components/'+name+'.tsx*',route=>route.fulfill({contentType:'text/javascript',body:old}))
  }
  for(const [name,body] of committedModules)await page.route('**/src/features/player/components/'+name+'.tsx*',route=>route.fulfill({contentType:'text/javascript',body}))
  await page.goto(origin+'/__management_test?kind='+kind)
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
  // Setup waits use elapsed time: a fixed frame budget shrinks on high-refresh
  // displays. transition() retains its separate 450/725ms acceptance deadlines.
  await page.evaluate(async target => {
    let previous = '', stable = 0
    const deadline = performance.now() + 10000
    while (performance.now() < deadline && stable < 5) {
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

async function transition(page, selector, direction, evidenceName, scale=1) {
  const dockClip=await page.locator('.playlist-playback-dock').boundingBox()
  async function dockInkPixels() {
    const png=await page.screenshot({clip:dockClip})
    return page.evaluate(async bytes=>{
      const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}))
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height
      const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close()
      const pixels=context.getImageData(0,0,canvas.width,100).data
      let ink=0
      for(let index=0;index<pixels.length;index+=4)if(pixels[index]*.2126+pixels[index+1]*.7152+pixels[index+2]*.0722<170)ink++
      return ink
    },Array.from(png))
  }
  const baselineInk=await dockInkPixels()
  const tracePromise = page.evaluate(async ({selector,direction}) => {
    const scope=window.viewModel.playlist.library.currentScope
    function geometry(element) {
      const rect = element.getBoundingClientRect()
      let opacity = 1
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) opacity *= Number(getComputedStyle(ancestor).opacity)
      return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,opacity}
    }
    const samples = []
    const started = performance.now()
    const sample = (timestamp=started) => {window.motionSampleElapsed=performance.now()-started;samples.push({time:window.motionSampleElapsed,rafElapsed:timestamp-started,
      targetReady:Boolean(document.querySelector(direction==='shrink'?'.playlist-management:not([inert])':'.playlist-panel:not([inert])')),
      covers:[...document.querySelectorAll('.playlist-hero-artwork,.playlist-management-cover')].filter(element=>element.matches('.playlist-hero-artwork')||element.closest('[data-playlist-scope]')?.dataset.playlistScope===scope).map(geometry),
      pages:[...document.querySelectorAll('.playlist-panel,.playlist-management-content')].map(element=>({kind:element.className,opacity:Number(getComputedStyle(element).opacity)})),
      docks:[...document.querySelectorAll('.playlist-playback-dock')].map(element=>({...geometry(element),contentOpacity:geometry(element.querySelector('.playlist-playback-track')).opacity,inert:element.inert,hidden:element.getAttribute('aria-hidden')==='true'}))})}
    sample()
    document.querySelector(selector).click()
    while (performance.now()-started < 950) {const timestamp=await new Promise(requestAnimationFrame);sample(timestamp)}
    return samples
  }, {selector,direction})
  // Screenshots are independent of the sampler and retain actual compositing.
  await page.waitForFunction(() => [...document.querySelectorAll('.playlist-panel,.playlist-management-content')].some(element => {
    const opacity = Number(getComputedStyle(element).opacity)
    return opacity > .15 && opacity < .85
  }))
  await page.screenshot({path:join(screenshotDirectory,evidenceName+'-middle.png')})
  const middleInk=await dockInkPixels()
  await page.waitForFunction(()=>window.motionSampleElapsed>400)
  await page.screenshot({path:join(screenshotDirectory,evidenceName+'-late.png')})
  const lateInk=await dockInkPixels()
  const samples = await tracePromise
  writeFileSync(join(screenshotDirectory,evidenceName+'-trace.json'),JSON.stringify(samples,null,2))
  assert(middleInk>=baselineInk*.8&&lateInk>=baselineInk*.8,'dock artwork/text remain painted; baseline '+baselineInk+', middle '+middleInk+', late '+lateInk)
  const start = samples[0].covers[0]
  const last = samples.at(-1).covers[0]
  const lastMoving=samples.findLastIndex(sample=>!sample.targetReady||sample.covers.some(cover=>['x','y','width','height'].some(key=>Math.abs(cover[key]-last[key])>.5)))
  const stableSample=samples[lastMoving+1]
  const removedSample=samples.find(sample=>sample.targetReady&&sample.pages.length===1)
  const timing={geometryStableMs:stableSample?.time,geometryStableRafMs:stableSample?.rafElapsed,oldPageRemovedMs:removedSample?.time,oldPageRemovedRafMs:removedSample?.rafElapsed}
  assert(stableSample&&removedSample,'cover geometry settles and the old page unmounts inside the observation window')
  const deadline=scale===1?450:725
  assert(Math.max(timing.geometryStableMs,timing.oldPageRemovedMs)<=deadline,'actual transition completion must stay within '+deadline+'ms at durationScale='+scale+': '+JSON.stringify(timing))
  assert(direction === 'shrink' ? start.width > last.width+100 : start.width+100 < last.width, direction+' endpoints have different cover geometry')
  const intermediate = samples.filter(sample => sample.covers.some(cover => cover.opacity>.1 && cover.width>Math.min(start.width,last.width)+10 && cover.width<Math.max(start.width,last.width)-10))
  assert(intermediate.length>=3, direction+' must visibly interpolate across multiple frames')
  assert(samples.some(sample => sample.pages.some(panel => panel.opacity>.05 && panel.opacity<.95)), 'page background fades')
  const dock = samples[0].docks[0]
  for (const sample of samples) {
    assert.equal(sample.docks.filter(item=>!item.inert&&!item.hidden).length,1,'one interactive dock during morph')
    for (const next of sample.docks) for (const key of ['x','y','width','height']) assert(Math.abs(next[key]-dock[key])<1,'dock '+key+' remains fixed')
    const contentOpacity=sample.docks.reduce((sum,item)=>sum+item.contentOpacity,0)
    assert(contentOpacity>=.8,'dock content remains visible during handoff; combined opacity '+contentOpacity+' at '+sample.time+'ms')
  }
  return {direction,scale,...timing,frames:samples.length,visibleIntermediateFrames:intermediate.length,start,end:last,
    dockInk:{baseline:baselineInk,middle:middleInk,late:lateInk},
    minCombinedDockOpacity:Math.min(...samples.map(sample=>sample.docks.reduce((sum,item)=>sum+item.contentOpacity,0)))}
}

async function ordinaryPlayerReturn(page) {
  const samples=await page.evaluate(async()=>{
    const samples=[],start=performance.now()
    const capture=()=>samples.push({time:performance.now()-start,
      owner:document.querySelector('.player-shell').hasAttribute('data-controller-background-present'),
      docks:[...document.querySelectorAll('.playlist-playback-dock')].map(element=>{
        const rect=element.querySelector('.controller-shared-background').getBoundingClientRect()
        const cover=element.querySelector('.playlist-playback-cover').getBoundingClientRect()
        return {visible:getComputedStyle(element).visibility!=='hidden',superseded:element.hasAttribute('data-dock-superseded'),x:rect.x,y:rect.y,width:rect.width,height:rect.height,coverWidth:cover.width,coverHeight:cover.height}
      })})
    capture()
    document.querySelector('.playlist-playback-nav button[aria-label="打开播放界面"]').click()
    while(performance.now()-start<800){await new Promise(requestAnimationFrame);capture()}
    return samples
  })
  const initial=samples[0].docks[0]
  const exiting=samples.filter(sample=>sample.time>20&&sample.docks.length)
  assert(exiting.length>2,'ordinary player return retains its original projected dock')
  assert(exiting.every(sample=>sample.owner&&sample.docks.every(dock=>dock.visible&&!dock.superseded)),'ordinary exiting dock remains owner and painted until cleanup')
  assert(exiting.some(sample=>sample.docks.some(dock=>Math.abs(dock.y-initial.y)>2||Math.abs(dock.height-initial.height)>2)),'ordinary dock-to-player shared background still interpolates')
  assert(exiting.some(sample=>sample.docks.some(dock=>Math.abs(dock.coverWidth-initial.coverWidth)>2||Math.abs(dock.coverHeight-initial.coverHeight)>2)),'ordinary dock-to-player shared cover still interpolates')
  assert.equal(samples.at(-1).owner,false,'ordinary return releases owner on actual cleanup')
  assert.equal(samples.at(-1).docks.length,0,'ordinary return removes the original dock')
  await page.locator('.window-bar').getByRole('button',{name:'播放列表',exact:true}).click()
  await settled(page,'.playlist-panel')
  return {ordinaryPlayerReturn:{retainedFrames:exiting.length,sharedGeometry:true,released:true}}
}

async function timingTrace(page,direction) {
  const samples=await page.evaluate(async direction=>{
    const samples=[],started=performance.now();let firstRaf=null
    document.querySelector(direction==='shrink'?'.playlist-hero-category':'.playlist-management-card-button').click()
    while(performance.now()-started<2800){
      const timestamp=await new Promise(requestAnimationFrame);firstRaf??=timestamp
      const target=document.querySelector(direction==='shrink'?'.playlist-management-cover':'.playlist-hero-artwork'),rect=target?.getBoundingClientRect()
      samples.push({time:performance.now()-started,rafTime:timestamp-firstRaf,rect:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null,pages:document.querySelectorAll('.playlist-panel,.playlist-management').length})
    }
    return samples
  },direction)
  const end=samples.at(-1).rect
  assert(end)
  const lastMoving=samples.findLastIndex(sample=>!sample.rect||['x','y','width','height'].some(key=>Math.abs(sample.rect[key]-end[key])>.5))
  return {geometryStableMs:samples[lastMoving+1]?.time,oldPageRemovedMs:samples.find(sample=>sample.pages===1)?.time,rafDeltaMs:samples.at(-1).rafTime,samples}
}

async function setDurationScale(page,scale) {
  await page.evaluate(async scale=>{
    const {defaultAppearance}=await import('/src/features/appearance/model/defaultAppearance.ts')
    const {saveAppearanceStorage}=await import('/src/features/appearance/model/appearanceStorage.ts')
    const theme={...defaultAppearance,id:'speed-test',name:'Speed test',motion:{...defaultAppearance.motion,durationScale:scale}}
    saveAppearanceStorage({currentThemeId:theme.id,colorSchemePreference:'light',userThemes:[theme]})
  },scale)
  await page.reload();await page.waitForFunction(()=>window.viewModel)
}

if(process.env.SPMUSIC_MOTION_TIMING_BASELINE==='1') {
  try {
    for(const scale of [1,3]) {
      const {page}=await open(1280,900,'shell','no-preference')
      await setDurationScale(page,scale);await importSource(page,'timing')
      await page.locator('.media-library-category[data-category-id="playlists"]').click()
      await page.waitForFunction(()=>document.querySelector('.playlist-management')&&document.querySelectorAll('.playlist-panel,.playlist-management').length===1)
      await page.getByRole('button',{name:'打开播放列表 Playlist timing',exact:true}).click()
      await page.waitForFunction(()=>document.querySelector('.playlist-panel')&&document.querySelectorAll('.playlist-panel,.playlist-management').length===1)
      for(const direction of ['shrink','grow']) {
        const {samples,...timing}=await timingTrace(page,direction)
        writeFileSync(join(screenshotDirectory,'baseline-scale-'+scale+'-'+direction+'.json'),JSON.stringify(samples,null,2))
        report.push({scale,direction,...timing});console.log(JSON.stringify(report.at(-1)))
      }
      await page.close()
    }
    writeFileSync(join(screenshotDirectory,'baseline-timing-summary.json'),JSON.stringify(report,null,2))
  } finally {await browser.close()}
  process.exit(0)
}

if (process.env.SPMUSIC_PROGRESS_FOCUSED === '1') {
  const { page, errors } = await open(1280, 900, 'shell', 'no-preference')
  try {
    await importSource(page, 'a')
    await page.locator('.media-library-category[data-category-id="playlists"]').click()
    await settled(page, '.playlist-management')
    await page.getByRole('button', { name: '打开播放列表 Playlist a', exact: true }).click()
    await settled(page, '.playlist-panel')
    await page.locator('.playlist-playback-toggle').click()
    await page.waitForFunction(() => window.viewModel.playback.isPlaying)
    await page.evaluate(() => window.emitPosition(90000))
    await page.waitForFunction(() => {
      const slider = document.querySelector('.playlist-playback-progress .control-progress-slider')
      const track = slider?.querySelector('[data-slot="slider-track"]')
      const thumb = slider?.querySelector('[data-slot="slider-thumb"]')
      return track && thumb && thumb.getBoundingClientRect().x - track.getBoundingClientRect().x > track.getBoundingClientRect().width * .4
    })
    const trace = () => page.evaluate(() => {
      window.progressTrace = []
      window.progressTraceRunning = true
      function sample() {
        if (!window.progressTraceRunning) return
        const slider = document.querySelector('.playlist-playback-progress .control-progress-slider')
        const track = slider?.querySelector('[data-slot="slider-track"]')
        const thumb = slider?.querySelector('[data-slot="slider-thumb"]')
        if (track && thumb) window.progressTrace.push({
          id: window.viewModel.playback.track?.id,
          sequence: window.viewModel.playback.selectionActivitySequence,
          pending: window.viewModel.playback.isSelectionPending,
          x: thumb.getBoundingClientRect().x - track.getBoundingClientRect().x,
          width: track.getBoundingClientRect().width,
          toggles: Array.from(document.querySelectorAll('.playlist-playback-dock .playlist-playback-toggle'))
            .map(toggle => toggle.getAttribute('aria-label')),
        })
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    const finishTrace = () => page.evaluate(() => { window.progressTraceRunning = false; return window.progressTrace })
    const watchToggleIcons = () => page.evaluate(() => {
      window.toggleIconMutations = []
      window.toggleIconObserver?.disconnect()
      window.toggleIconObserver = new MutationObserver(records => {
        for (const record of records) {
          const toggle = record.target
          if (!toggle.matches?.('.playlist-playback-dock .playlist-playback-toggle')) continue
          window.toggleIconMutations.push({ previous: record.oldValue, current: toggle.getAttribute('aria-label'), time: performance.now() })
        }
      })
      window.toggleIconObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-label'], attributeOldValue: true })
    })
    const finishToggleIcons = () => page.evaluate(() => {
      window.toggleIconObserver?.disconnect()
      return window.toggleIconMutations
    })
    const emitEnded = (duplicate = false) => page.evaluate(async duplicate => {
      const state = await window.backendInvoke('audio_get_state')
      const ended = { payload: { ...state, phase: 'ended', positionMs: 180000 } }
      window.listeners?.audio_state_changed?.(ended)
      if (duplicate) window.listeners?.audio_state_changed?.(ended)
    }, duplicate)
    await trace()
    await page.evaluate(() => { window.config.gate = true })
    await page.evaluate(() => window.viewModel.playback.onNext())
    await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-1' && window.viewModel.playback.isSelectionPending)
    await page.waitForTimeout(60)
    const manualPending = await page.evaluate(() => window.progressTrace.filter(sample => sample.id === 'a-1' && sample.pending))
    assert(manualPending.length >= 2 && manualPending[0].x > manualPending[0].width * .35
      && manualPending[0].x < manualPending[0].width * .6, 'manual switch starts near outgoing 50% progress')
    assert(manualPending.every(sample => sample.toggles.length > 0 && sample.toggles.every(label => label === '暂停')),
      'all visible dock instances keep the playing icon during manual selection')
    await page.evaluate(() => { window.config.gate = false; window.pending.splice(0).forEach(resolve => resolve()) })
    await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-1' && !window.viewModel.playback.isSelectionPending)
    await page.waitForTimeout(600)
    const manual = (await finishTrace()).filter(sample => sample.id === 'a-1')
    assert(manual.some(sample => sample.x > sample.width * .05 && sample.x < sample.width * .35), 'manual switch traverses from old progress toward left')
    assert(manual.at(-1).x < 5, 'manual switch settles at new timeline origin')
    assert(manual.every(sample => sample.toggles.every(label => label === '暂停')), 'manual switch never flashes a play icon')
    await trace()
    await watchToggleIcons()
    await page.evaluate(() => { window.config.gate = true })
    await emitEnded(true)
    await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-2' && window.viewModel.playback.isSelectionPending)
    const pending = await page.evaluate(() => window.progressTrace.filter(sample => sample.id === 'a-2' && sample.pending))
    assert(pending.length >= 1 && pending.every(sample => sample.x > sample.width * .75), 'automatic next track holds right edge while backend is pending')
    await page.evaluate(() => { window.config.gate = false; window.pending.splice(0).forEach(resolve => resolve()) })
    await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-2' && !window.viewModel.playback.isSelectionPending)
    await page.waitForTimeout(650)
    const automaticTrace = await finishTrace()
    const automatic = automaticTrace.filter(sample => sample.id === 'a-2')
    const automaticIcons = await finishToggleIcons()
    assert(automaticIcons.every(change => change.previous !== '播放' && change.current !== '播放'), 'automatic continuation never mutates pause icon to play')
    assert(automaticTrace.every(sample => sample.toggles.every(label => label === '暂停')), 'automatic continuation keeps pause icon on every frame including ended old track')
    assert(automatic[0].x > automatic[0].width * .75, 'natural end begins progress at right edge')
    assert(automatic.some(sample => sample.x > sample.width * .2 && sample.x < sample.width * .8), 'natural end traverses intermediate progress')
    assert(automatic.at(-1).x < 5, 'natural end settles at new timeline origin')
    await page.evaluate(() => window.viewModel.playback.onRepeatCycle())
    await page.waitForFunction(() => window.viewModel.playback.repeatMode === 'repeat-one')
    const previousSequence = await page.evaluate(() => window.viewModel.playback.selectionActivitySequence)
    await trace()
    await watchToggleIcons()
    await emitEnded()
    await page.waitForFunction(previous => window.viewModel.playback.selectionActivitySequence > previous && !window.viewModel.playback.isSelectionPending, previousSequence)
    await page.waitForTimeout(650)
    const repeat = (await finishTrace()).filter(sample => sample.id === 'a-2' && sample.sequence > previousSequence)
    const repeatIcons = await finishToggleIcons()
    assert(repeatIcons.every(change => change.previous !== '播放' && change.current !== '播放'), 'repeat-one continuation never mutates pause icon to play')
    assert(repeat.length >= 3 && repeat[0].x > repeat[0].width * .75, 'repeat-one restarts same ID from right edge')
    assert(repeat.some(sample => sample.x > sample.width * .2 && sample.x < sample.width * .8), 'repeat-one traverses intermediate progress')
    assert(repeat.at(-1).x < 5, 'repeat-one settles at timeline origin')
    await page.evaluate(() => window.viewModel.playback.onRepeatCycle())
    await page.waitForFunction(() => window.viewModel.playback.repeatMode === 'sequential')
    const terminalSequence = await page.evaluate(() => window.viewModel.playback.selectionActivitySequence)
    await watchToggleIcons()
    await emitEnded()
    await page.waitForFunction(() => !window.viewModel.playback.isPlaying)
    const terminalIcons = await finishToggleIcons()
    assert(terminalIcons.some(change => change.previous === '暂停' && change.current === '播放'), 'terminal sequential end changes pause icon to play')
    assert.equal(await page.evaluate(() => window.viewModel.playback.selectionActivitySequence), terminalSequence, 'terminal sequential end does not select another track')
    await page.evaluate(() => window.viewModel.playback.onRepeatCycle())
    await page.waitForFunction(() => window.viewModel.playback.repeatMode === 'all-categories-until-stop')
    await page.evaluate(() => window.viewModel.playback.onRepeatCycle())
    await page.waitForFunction(() => window.viewModel.playback.repeatMode === 'list-loop')
    await importSource(page, 'failure')
    await page.locator('.playlist-playback-toggle').click()
    await page.waitForFunction(() => window.viewModel.playback.isPlaying)
    await page.evaluate(() => { window.config.failAllLoads = true })
    await watchToggleIcons()
    await emitEnded()
    await page.waitForFunction(() => !window.viewModel.playback.isSelectionPending
      && window.viewModel.playback.selectionVisualIntent === null)
    const failedContinuationIcons = await finishToggleIcons()
    assert(failedContinuationIcons.some(change => change.previous === '暂停' && change.current === '播放'), 'failed automatic continuation releases the playing icon')
    assert.equal(await page.locator('.playlist-playback-toggle').first().getAttribute('aria-label'), '播放', 'failed automatic continuation shows the stopped icon')
    assert.deepEqual(errors, [], 'no browser errors')
    console.log('PASS manual switch, natural ended and repeat-one icon continuity/progress animation; sequential tail and failed continuation stop through real PlayerShell/useAudioPlayer')
  } finally { await page.close(); await browser.close() }
  process.exit(0)
}

try {
  for(const [width,height] of (process.env.SPMUSIC_MOTION_FOCUSED==='1'?[[1280,900]]:[[1280,900],[480,800]])) {
  const prefix=width===1280?'':'narrow-'
  const {page,errors}=await open(width,height,'shell','no-preference')
  if(width===1280)await importSource(page,'anchor')
  await importSource(page,'motion')
  await page.locator('.media-library-category[data-category-id="playlists"]').click()
  await settled(page,'.playlist-management')
  await page.getByRole('button',{name:'打开播放列表 Playlist motion',exact:true}).click()
  await settled(page,'.playlist-panel')
  await page.waitForFunction(()=>document.querySelector('.playlist-hero-image')?.complete)
  const before = await playbackSnapshot(page)
  const commandCount=await page.evaluate(()=>window.calls.filter(call=>['audio_load_and_play','audio_transition_playback','audio_play','audio_pause'].includes(call.command)).length)
  await page.screenshot({path:join(screenshotDirectory,prefix+'detail-before.png')})
  report.push({width,height,...await transition(page,'.playlist-hero-category','shrink',prefix+'detail-to-management')})
  await settled(page,'.playlist-management')
  await page.screenshot({path:join(screenshotDirectory,prefix+'management-after.png')})
  report.push({width,height,...await transition(page,'.playlist-management-card-button[aria-label="打开播放列表 Playlist motion"]','grow',prefix+'management-to-detail')})
  await settled(page,'.playlist-panel')
  // Reverse before the previous animation settles, then repeat in one session.
  await page.evaluate(async()=>{
    for(let iteration=0;iteration<4;iteration++) {
      document.querySelector('.playlist-panel:not([inert]) .playlist-hero-category').click()
      for(let frame=0;frame<5;frame++)await new Promise(requestAnimationFrame)
      document.querySelector('.playlist-management:not([inert]) .playlist-management-card-button[aria-label="打开播放列表 Playlist motion"]').click()
      for(let frame=0;frame<5;frame++)await new Promise(requestAnimationFrame)
    }
  })
  await settled(page,'.playlist-panel')
  assert.equal(await page.locator('.playlist-panel').count(),1,'rapid reversal retains one detail page')
  assert.equal(await page.locator('.playlist-playback-dock').count(),1,'rapid reversal cleans up old docks')
  assert.deepEqual(await playbackSnapshot(page),before,'browsing animation preserves track, queue and playback')
  assert.equal(await page.evaluate(()=>window.calls.filter(call=>['audio_load_and_play','audio_transition_playback','audio_play','audio_pause'].includes(call.command)).length),commandCount,'navigation never issues playback commands')
  report.push(await ordinaryPlayerReturn(page))
  await page.evaluate(async()=>{
    document.querySelector('.playlist-hero-category').click()
    for(let frame=0;frame<5;frame++)await new Promise(requestAnimationFrame)
    document.querySelector('.playlist-playback-dock:not([aria-hidden="true"]) .playlist-playback-nav button[aria-label="打开播放界面"]').click()
  })
  await page.waitForFunction(()=>document.querySelector('.player-stage')&&!document.querySelector('.playlist-management'))
  const released=await page.evaluate(()=>({retainedDetailCount:document.querySelectorAll('.playlist-panel').length,
    controllerOwner:document.querySelector('.player-shell').hasAttribute('data-controller-background-present')}))
  assert.equal(released.controllerOwner,false,'old retained detail dock cannot keep hiding the player controls after the management dock exits')
  await page.waitForFunction(()=>!document.querySelector('.playlist-panel')&&!document.querySelector('.playlist-playback-dock')&&getComputedStyle(document.querySelector('.control-row')).opacity==='1')
  assert.deepEqual(await playbackSnapshot(page),before,'interrupted detail-management-player navigation preserves playback')
  report.push({interruptedPlayerReturn:released})
  assert.deepEqual(errors,[])
  report.push('rapid reversal, outgoing-page cleanup, stable playback and no playback commands pass')
  await page.close()
  }

  if(process.env.SPMUSIC_MOTION_FOCUSED!=='1'){
  const scaled=await open(1280,900,'shell','no-preference')
  await setDurationScale(scaled.page,3)
  await importSource(scaled.page,'scaled')
  await scaled.page.locator('.media-library-category[data-category-id="playlists"]').click()
  await settled(scaled.page,'.playlist-management')
  await scaled.page.getByRole('button',{name:'打开播放列表 Playlist scaled',exact:true}).click()
  await settled(scaled.page,'.playlist-panel')
  report.push({themeDurationScale:3,...await transition(scaled.page,'.playlist-hero-category','shrink','scale3-detail-to-management',3)})
  await settled(scaled.page,'.playlist-management')
  report.push({themeDurationScale:3,...await transition(scaled.page,'.playlist-management-card-button','grow','scale3-management-to-detail',3)})
  assert.deepEqual(scaled.errors,[])
  await scaled.page.close()
  }

  if(process.env.SPMUSIC_MOTION_FOCUSED!=='1'){
  const reduced=await open(480,800,'shell','reduce')
  await reduced.page.locator('.media-library-category[data-category-id="playlists"]').click()
  await settled(reduced.page,'.playlist-management')
  await reduced.page.getByText('暂无播放列表',{exact:true}).last().waitFor()
  await importSource(reduced.page,'reduced')
  await reduced.page.getByRole('button',{name:'打开播放列表 Playlist reduced',exact:true}).click()
  await settled(reduced.page,'.playlist-panel')
  const reducedDuration=await reduced.page.evaluate(async()=>{const start=performance.now();document.querySelector('.playlist-hero-category').click();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return performance.now()-start})
  assert(reducedDuration<=100,'reduced motion finishes within two animation frames, with no timed animation')
  assert.equal(await reduced.page.locator('.playlist-panel').count(),0,'reduced motion removes detail immediately')
  const reducedCover=await reduced.page.locator('.playlist-management-cover').evaluate(element=>({width:element.getBoundingClientRect().width,transform:getComputedStyle(element).transform}))
  assert.deepEqual(reducedCover,{width:240,transform:'none'},'reduced motion snaps directly to untransformed card')
  await reduced.page.getByRole('button',{name:'打开播放列表 Playlist reduced',exact:true}).click()
  await reduced.page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})
  assert.equal(await reduced.page.locator('.playlist-management').count(),0,'reduced reverse motion removes management immediately')
  assert.deepEqual(reduced.errors,[])
  report.push({reducedMotionCompletionMs:reducedDuration,viewport:'480x800',emptyManagement:true})
  }
  await reduced.page.close()
  console.log(JSON.stringify({browser:browser.version(),report,screenshots:screenshotDirectory}))
} catch(error) {
  for(const [index,page] of browser.contexts().flatMap(context=>context.pages()).entries()) await page.screenshot({path:join(screenshotDirectory,'motion-failure-'+index+'.png')}).catch(()=>{})
  throw error
} finally {await browser.close()}

