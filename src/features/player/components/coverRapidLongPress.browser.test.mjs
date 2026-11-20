// Real Shell + native progress events under a large playlist registry.
// Instrumentation measures only; native audio and the library registry are deterministic.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {runInNewContext} from 'node:vm'

const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const label=process.env.SPMUSIC_STRESS_LABEL||'current'
const nativeSequence=process.env.SPMUSIC_STRESS_NATIVE_SEQUENCE==='1'
const activeName=nativeSequence?'many':'a'
const targetCount=Number(process.env.SPMUSIC_STRESS_TARGETS||(nativeSequence?0:40))
const tracksPerTarget=Number(process.env.SPMUSIC_STRESS_TRACKS||(nativeSequence?64:5000))
const attempts=Number(process.env.SPMUSIC_STRESS_ATTEMPTS||24)
const pulseMs=Number(process.env.SPMUSIC_STRESS_PULSE_MS||20)
const evidence=join(tmpdir(),'spmusic-cover-rapid-long-press')
mkdirSync(evidence,{recursive:true})
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{
  const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'))
  assert(match,'Vite dependency '+name);return match[1]
}
const readModule=async(name)=>process.env.SPMUSIC_STRESS_BASELINE_DIR
  ?readFileSync(join(process.env.SPMUSIC_STRESS_BASELINE_DIR,name+'.js'),'utf8')
  :await(await fetch(origin+'/src/features/player/components/'+name+'.tsx')).text()
let shell=await readModule('PlayerShell')
let surface=await readModule('PlayerSurface')
const menu=await readModule('MoreActionsMenu')
if(!process.env.SPMUSIC_STRESS_BASELINE_DIR){
  const saved=join(evidence,label+'-modules');mkdirSync(saved,{recursive:true})
  for(const[name,body]of Object.entries({PlayerShell:shell,PlayerSurface:surface,MoreActionsMenu:menu}))writeFileSync(join(saved,name+'.js'),body)
  console.log('BASELINE_MODULES',saved)
}
const prepare='decoratePlaylistAddRequest(preparePlayerPlaylistAdd(snapshot))'
assert(shell.includes('(snapshot) => '+prepare),'prepare callback measurement target')
shell=shell.replace('(snapshot) => '+prepare,`(snapshot)=>{const start=performance.now();try{return ${prepare}}finally{(window.prepareSamples??=[]).push({time:start,duration:performance.now()-start,open:Boolean(document.querySelector('.more-actions-menu'))})}}`)
const reset='const hardResetTrackCardInteraction = useCallback(() => {'
assert(surface.includes(reset),'reset measurement target')
surface=surface.replace(reset,reset+"(window.gestureTrace??=[]).push({type:'reset',time:performance.now()});")
surface=surface.replace('const handleMoreOpenChange = useCallback',`window.readGestureOwner=()=>({press:coverPressRef.current&&{track:coverPressRef.current.originTrackId,tap:coverPressRef.current.tapEligible},drag:coverDragRef.current&&{track:coverDragRef.current.originTrackId,moved:coverDragRef.current.moved,released:coverDragRef.current.released,progress:coverDragRef.current.progress,targetReady:coverDragRef.current.targetReady,token:coverDragRef.current.token&&{id:coverDragRef.current.token.id,target:coverDragRef.current.token.targetTrackId}},phase:coverInteractionPhaseRef.current,previewArtworkReady,session:trackCardSessionRef.current,slots:artworkSlotsRef.current.map(layer=>layer&&({id:layer.id,track:layer.track.id,phase:layer.phase,token:layer.previewTokenId,view:Boolean(layer.resource.view)})),geometry:trackCardCoverGeometry});const handleMoreOpenChange = useCallback`)
if(process.env.SPMUSIC_STRESS_UNSTABLE_MORE==='1'){
  const original=surface
  surface=surface.replace('prepareMoreNavigationRef.current?.()','playback.moreActions?.onPrepareNavigation?.()')
    .replace('}, [hardResetTrackCardInteraction]);','}, [hardResetTrackCardInteraction, playback.moreActions]);')
  assert.notEqual(surface,original,'explicit historical dependency counterfactual')
}
const shared=readFileSync(new URL('./allSongs.browser.test.mjs',import.meta.url),'utf8')
const literal=shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
let fixture=runInNewContext(literal[1],{dependency}).replace('length:50','length:'+tracksPerTarget)
if(nativeSequence)fixture=fixture.replace('coverArt:null}}};', "coverArt:{mimeType:'image/png',filePath:'/covers/'+row.id+'.png',dataUrl:null,byteLen:64}}}};")
const marker="ReactDOM.createRoot(document.getElementById('root')).render("
fixture=fixture.replace(marker,`
window.choice='${activeName}';window.playlistImport=true;const activePlaylist=playlist();window.choice='many';const largePlaylist=playlist();
window.persistedPlaylists=[activePlaylist,...Array.from({length:${targetCount}},(_,index)=>({...largePlaylist,sourcePath:'/lists/stress-'+index+'.m3u8',sourceName:'Stress '+index}))];
window.choice='${activeName}';window.playlistImport=false;
const nativeInvoke=window.backendInvoke;
window.backendInvoke=async(command,args)=>{
 if(command==='library_get_playlists')return window.persistedPlaylists;
 if(command==='library_get_folders')return {revision:0,roots:[{path:'/audio/${activeName}',selected:true,directoryRules:[]}]};
 if(command==='audio_load_cover_pixels'&&${nativeSequence}){
  window.calls.push({command,input:args.input});
  const bytes=await nativeInvoke('audio_load_playlist_cover_pixels',args);
  const number=Number(args.input.filePath.match(/many-(\d+)/)?.[1]??0);bytes[40]=number*37%255;bytes[41]=number*61%255;return bytes;
 }
 return nativeInvoke(command,args);
};
window.emitProgress=()=>{if(!state.currentTrackId)return;state={...state,positionMs:(state.positionMs+${pulseMs})%170000};window.listeners?.audio_state_changed?.({payload:{...state}})};
${marker}`)
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
let playerHook=await(await fetch(origin+'/src/features/player/hooks/useAudioPlayer.ts')).text()
playerHook=playerHook.replace('const prepareTrackCardPreview = useCallback',`window.readNativePreview=()=>({logical:logicalCursorTrackIdRef.current,presentation:presentationTrackRef.current?.id,audio:audioTrackRef.current?.id,originIndex:queueTrackIndexRef.current.get(logicalCursorTrackIdRef.current),previewCounter:trackCardPreviewIdRef.current,prepared:preparedTrackCardPreviewRef.current&&{id:preparedTrackCardPreviewRef.current.id,target:preparedTrackCardPreviewRef.current.targetTrackId},hydratedSize:hydratedAudioTrackCacheRef.current.size});const prepareTrackCardPreview = useCallback`)
const wrapper=`import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__stress_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;window.surfaceRenders=(window.surfaceRenders??0)+1;return React.createElement(Surface,props)}`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__stress_fixture.js"')
const browser=await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL||'msedge'})
const page=await browser.newPage({viewport:{width:1600,height:1100},hasTouch:true})
page.setDefaultTimeout(20000)
const errors=[];page.on('pageerror',error=>errors.push(error.message))
const result={label,targetCount,tracksPerTarget,attempts,pulseMs,rounds:[],errors}
try{
  await page.addInitScript(()=>{
    window.gestureTrace=[];window.longTasks=[]
    new PerformanceObserver(list=>{for(const entry of list.getEntries())window.longTasks.push({start:entry.startTime,duration:entry.duration})}).observe({type:'longtask',buffered:true})
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])document.addEventListener(type,event=>window.gestureTrace.push({type,time:performance.now(),eventTime:event.timeStamp,inputDelay:performance.now()-event.timeStamp,id:event.pointerId,x:event.clientX,y:event.clientY,menuOpen:Boolean(document.querySelector('.more-actions-menu')),owner:window.readGestureOwner?.()}),true)
  })
  await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
  if(nativeSequence)await page.route('**/src/features/player/hooks/useAudioPlayer.ts*',route=>route.fulfill({contentType:'text/javascript',body:playerHook}))
  await page.route('**/src/features/player/components/PlayerShell.tsx*',route=>route.fulfill({contentType:'text/javascript',body:shell}))
  await page.route('**/src/features/player/components/MoreActionsMenu.tsx*',route=>route.fulfill({contentType:'text/javascript',body:menu}))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:wrapper}))
  await page.route('**/__stress_surface.js',route=>route.fulfill({contentType:'text/javascript',body:surface}))
  await page.route('**/__stress_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__stress_test',route=>route.fulfill({contentType:'text/html',body:html}))
  await page.goto(origin+'/__stress_test')
  await page.waitForFunction(name=>window.vm?.playlist.library.items.some(item=>item.scope.includes('/lists/'+name+'.m3u8'))&&!window.vm.playlist.library.isPlaylistRestorePending,activeName)
  await page.evaluate(name=>window.vm.playlist.library.onPlay(window.vm.playlist.library.items.find(item=>item.scope.includes('/lists/'+name+'.m3u8')).scope),activeName)
  await page.waitForFunction(name=>window.vm.playback.track?.id===name+'-0'&&!window.vm.playback.isSelectionPending&&!window.vm.playback.detailsPending,activeName)
  if(nativeSequence)await page.locator('.track-card-plane[data-track-card-phase="active"] .cover-frame canvas').waitFor()
  await page.evaluate(()=>document.fonts.ready)
  await page.waitForTimeout(800)
  await page.evaluate(pulseMs=>{window.prepareSamples=[];window.gestureTrace=[];window.longTasks=[];window.surfaceRenders=0;window.progressTimer=setInterval(window.emitProgress,pulseMs)},pulseMs)
  const cdp=await page.context().newCDPSession(page)
  const touch=(type,point)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{id:1,...point}]:[]})
  const snapshot=()=>page.evaluate(()=>({track:window.vm.playback.track?.id,commits:window.calls.filter(call=>call.command==='audio_load_and_play').length,owner:window.readGestureOwner?.(),native:window.readNativePreview?.(),menuOpen:Boolean(document.querySelector('.more-actions-menu')),time:performance.now()}))
  async function drag(index,steady=false,options={}){
    const before=await snapshot()
    const box=await page.locator('.cover-input-region').boundingBox()
    assert(box,'stable cover input region')
    const direction=options.direction??(index%2===0?1:-1)
    const x=box.x+box.width*(direction>0?.85:.15),y=box.y+box.height*.35
    const start=Date.now()
    if(nativeSequence){await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-direction*32,y)}
    else{await touch('touchStart',{x,y});await touch('touchMove',{x:x-direction*32,y})}
    await page.waitForTimeout(steady?100:25)
    const moving=await snapshot()
    if(nativeSequence){await page.mouse.move(x-direction*box.width*(options.rollback?.10:.78),y);if(options.rollback)await page.waitForTimeout(260);await page.mouse.up()}
    else{await touch('touchMove',{x:x-direction*box.width*.78,y});await touch('touchEnd')}
    await page.waitForTimeout(steady?600:options.rollback?500:nativeSequence?140:70)
    const after=await snapshot()
    result.rounds.push({index,steady,options,inputMs:Date.now()-start,before,moving,after})
    return before.track!==after.track
  }
  if(nativeSequence){
    async function phase(direction,count,name){let committed=0;for(let attempt=0;attempt<count*3&&committed<count;attempt++){if(await drag(result.rounds.length,false,{direction,name}))committed++;if(attempt%5===0)writeFileSync(join(evidence,label+'.json'),JSON.stringify(result,null,2))}console.log('NATIVE_PHASE',JSON.stringify({name,committed,needed:count,track:(await snapshot()).track,attempts:result.rounds.length}));return committed}
    result.nativePhases={forward:await phase(1,28,'forward'),reverse:await phase(-1,16,'reverse'),forwardAgain:await phase(1,12,'forward-again')}
    await drag(result.rounds.length,false,{direction:-1,name:'painted-rollback',rollback:true})
    result.nativePhases.afterRollbackReverse=await phase(-1,2,'after-rollback-reverse')
    result.nativePhases.afterRollbackForward=await phase(1,2,'after-rollback-forward')
    await page.getByRole('button',{name:'下一首',exact:true}).click();await page.waitForTimeout(700)
    result.nativePhases.afterControllerReverse=await phase(-1,2,'after-controller-reverse')
    result.nativePhases.afterControllerForward=await phase(1,2,'after-controller-forward')
  }else{
    for(let index=0;index<attempts;index++)await drag(index)
    await page.waitForTimeout(1500)
    for(let index=0;index<3;index++)await drag(attempts+index,true)
  }
  await page.evaluate(()=>clearInterval(window.progressTimer))
  const metrics=await page.evaluate(()=>({prepare:window.prepareSamples,renders:window.surfaceRenders,trace:window.gestureTrace,longTasks:window.longTasks,owner:window.readGestureOwner?.(),track:window.vm.playback.track?.id,calls:window.calls.slice(-120),status:window.vm.playback.statusText,queue:window.vm.queue.tracks.map(track=>track.id)}))
  Object.assign(result,metrics)
  result.summary={closedPrepareCalls:metrics.prepare.filter(item=>!item.open).length,prepareTotalMs:metrics.prepare.reduce((sum,item)=>sum+item.duration,0),prepareMaxMs:Math.max(0,...metrics.prepare.map(item=>item.duration)),committingRounds:result.rounds.filter(round=>round.after.commits>round.before.commits).length,finalSteadyCommits:result.rounds.slice(-3).filter(round=>round.after.commits>round.before.commits).length,longTaskCount:metrics.longTasks.length,longTaskTotalMs:metrics.longTasks.reduce((sum,item)=>sum+item.duration,0),longTaskMaxMs:Math.max(0,...metrics.longTasks.map(item=>item.duration))}
  console.log('STRESS_SUMMARY',JSON.stringify(result.summary))
  assert.deepEqual(errors,[])
  if(nativeSequence){assert.equal(result.nativePhases.forward,28);assert.equal(result.nativePhases.afterControllerReverse,2);assert.equal(result.nativePhases.afterControllerForward,2)}
  assert.equal(result.summary.closedPrepareCalls,0,'a closed menu never prepares playlist membership under registry/render pressure')
  // This transport intentionally has no cover pixels for the active source.
  // Successful mouse commits are covered by the canvas fixture in coverCollapse.
  if(process.env.SPMUSIC_STRESS_REQUIRE_DRAG==='1')assert.equal(result.summary.finalSteadyCommits,3,'all final settled drags remain usable after progress/render pressure')
}finally{
  writeFileSync(join(evidence,label+'.json'),JSON.stringify(result,null,2))
  console.log('EVIDENCE',join(evidence,label+'.json'))
  await browser.close()
}
