// Opt-in browser checks for the actual memory recorder and PlayerSurface.
// No project dependency is installed. Start Vite and set SPMUSIC_PLAYWRIGHT.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const modulePath='/src/features/player/diagnostics/playerDragDiagnostics.ts'
const browser=await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL||'msedge'})
let passed=0
async function check(name,run){
 const page=await browser.newPage({viewport:{width:1400,height:900},reducedMotion:'reduce',hasTouch:true})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 page.setDefaultTimeout(12000)
 try{await run(page);assert.deepEqual(errors,[]);passed++;console.log('PASS',name)}finally{await page.close()}
}
async function recorder(page){
 await page.route('**/__diagnostics_empty',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}))
 await page.goto(origin+'/__diagnostics_empty')
 await page.evaluate(()=>{
  window.diagnosticRawListeners=new Map()
  const add=window.addEventListener,remove=window.removeEventListener
  const key=(type,listener,options)=>type+':'+listener?.name+':'+Boolean(typeof options==='boolean'?options:options?.capture)
  window.addEventListener=function(type,listener,options){if(listener?.name==='rawCapture'||listener?.name==='rawMouseBubble')window.diagnosticRawListeners.set(key(type,listener,options),{type,capture:Boolean(typeof options==='boolean'?options:options?.capture),passive:options?.passive===true});return add.call(this,type,listener,options)}
  window.removeEventListener=function(type,listener,options){window.diagnosticRawListeners.delete(key(type,listener,options));return remove.call(this,type,listener,options)}
 })
 await page.evaluate(async path=>{window.diag=await import(path)},modulePath)
}
async function surface(page){
 const componentPath='/src/features/player/components/PlayerSurface.tsx'
 const entry=await(await fetch(origin+'/src/main.tsx')).text()+await(await fetch(origin+componentPath)).text()
 const dependency=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match,name);return match[1]}
 const shared=readFileSync(new URL('./coverTransition.browser.test.mjs',import.meta.url),'utf8')
 const literal=shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
 assert(literal,'reuse the actual Surface fixture without running another suite')
 let fixture=runInNewContext(literal[1],{dependency,componentPath})
 fixture=fixture.replace('return pending},[]);','return window.diagnosticPrepareGate?new Promise(resolve=>window.releaseDiagnosticPrepare=()=>resolve(pending)):pending},[]);')
 assert(fixture.includes('releaseDiagnosticPrepare'),'controlled asynchronous preview boundary')
 fixture+=`\nimport * as diagnostics from '/__diagnostics_recorder.js';window.diag=diagnostics;
 window.diagnosticResets=0;window.diagnosticExports=[];
 window.diagnosticExport=(command,args)=>{window.diagnosticExports.push({command,args,status:{...diagnostics.getPlayerDragDiagnosticsStatus()}});return new Promise((resolve,reject)=>window.diagnosticExportPending={resolve,reject})};`
 let source=await(await fetch(origin+componentPath)).text()
 const reset='const hardResetTrackCardInteraction = useCallback(() => {'
 assert(source.includes(reset),'observe actual hard reset calls without invoking them')
 source=source.replace(reset,reset+'window.diagnosticResets++;')
 source=source.replace('const completeTrackCardExit = useCallback(',"window.diagnosticActiveLogical=()=>({logical:track?.id,active:artworkSlots.filter(layer=>layer?.phase==='active').map(layer=>layer.track.id)}); const completeTrackCardExit = useCallback(")
 let panel=await(await fetch(origin+'/src/features/player/components/PlayerDragDiagnosticsPanel.tsx')).text()
 panel=panel.replace(/import \{ invoke \} from [^;]+;/,'const invoke=(...args)=>window.diagnosticExport(...args);')
 assert(panel.includes('window.diagnosticExport'),'only explicit native export is mocked')
 let diagnostics=await(await fetch(origin+modulePath)).text()
 const hash='function playerDragDiagnosticId(value) {'
 assert(diagnostics.includes(hash),'observe actual identity hash work, including disabled producers')
 diagnostics=diagnostics.replace(hash,hash+'window.diagnosticHashCalls=(window.diagnosticHashCalls??0)+1;')
 // Vite HMR query versions can differ while another agent finishes an edit.
 // Serve one actual recorder instance to all fixture imports.
 const canonical=source=>source.replace(/(["'])\/src\/features\/player\/diagnostics\/playerDragDiagnostics\.ts(?:\?[^"']*)?\1/g,"'/__diagnostics_recorder.js'")
 source=canonical(source);panel=canonical(panel)
 const artwork=canonical(await(await fetch(origin+'/src/features/player/hooks/useArtworkVisualResource.ts')).text())
 const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__diagnostics_surface_fixture.js"')
 await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:source}))
 await page.route('**/src/features/player/components/PlayerDragDiagnosticsPanel.tsx*',route=>route.fulfill({contentType:'text/javascript',body:panel}))
 await page.route('**/__diagnostics_recorder.js',route=>route.fulfill({contentType:'text/javascript',body:diagnostics}))
 await page.route('**/src/features/player/hooks/useArtworkVisualResource.ts*',route=>route.fulfill({contentType:'text/javascript',body:artwork}))
 await page.route('**/__diagnostics_surface_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
 await page.route('**/__diagnostics_surface',route=>route.fulfill({contentType:'text/html',body:html}))
 await page.goto(origin+'/__diagnostics_surface')
 await page.locator('.track-card-plane[data-track-card-phase="active"] .cover-frame').waitFor()
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
}
try{
 await check('disabled recorder has no events or provider work; explicit start is required',async page=>{
  await recorder(page)
  const result=await page.evaluate(()=>{
   let snapshots=0,notifications=0
   const unsubscribe=window.diag.subscribePlayerDragDiagnostics(()=>notifications++)
   const unregister=window.diag.registerPlayerDragDiagnosticSnapshot('test',()=>{snapshots++;return {active:1}})
   for(let index=0;index<100;index++)window.diag.recordPlayerDragDiagnostic('disabled',{index})
   const before={...window.diag.getPlayerDragDiagnosticsStatus(),snapshots,notifications}
   const report=JSON.parse(window.diag.freezePlayerDragDiagnostics())
   unregister();unsubscribe();return {before,report}
  })
  assert.equal(result.before.recording,false)
  assert.equal(result.before.hasRecording,false)
  assert.equal(result.before.snapshots,0)
  assert.equal(result.before.notifications,0)
  assert.deepEqual(result.report.events,[])
 })
 await check('ring is bounded and chronological; event writes do not notify React subscribers',async page=>{
  await recorder(page)
  const result=await page.evaluate(()=>{
   let notifications=0
   window.diag.subscribePlayerDragDiagnostics(()=>notifications++)
   window.diag.startPlayerDragDiagnostics()
   const first=notifications
   for(let index=0;index<100;index++)window.diag.recordPlayerDragDiagnostic('probe',{index})
   const afterNormalWrites=notifications
   for(let index=100;index<10100;index++)window.diag.recordPlayerDragDiagnostic('probe',{index})
   const report=JSON.parse(window.diag.freezePlayerDragDiagnostics())
   return {first,afterNormalWrites,report,status:window.diag.getPlayerDragDiagnosticsStatus()}
  })
  assert.equal(result.first,result.afterNormalWrites)
  assert.equal(result.report.schemaVersion,1)
  assert.equal(result.report.events.length,10000)
  assert.equal(result.report.buildMarker,'drag-diagnostics-manual-v2')
  assert(result.report.droppedCount>0)
  assert.equal(result.status.capped,true)
  assert.equal(result.status.recording,false)
  assert.equal(result.status.frozen,true)
  assert(result.report.events.every((entry,index,entries)=>index===0||entry.sequence>entries[index-1].sequence))
  assert.equal(result.report.events.at(-1).event,'recording.freeze')
 })
 await check('payload strips media paths and metadata; identities are opaque; freeze is immutable',async page=>{
  await recorder(page)
  const result=await page.evaluate(()=>{
   window.diag.startPlayerDragDiagnostics()
   let value=1
   window.diag.registerPlayerDragDiagnosticSnapshot('test',()=>({value,active:window.diag.playerDragDiagnosticId('C:\\private\\song.flac')}))
   window.diag.registerPlayerDragDiagnosticSnapshot('C:\\private\\provider',()=>({value}))
   const id=window.diag.playerDragDiagnosticId('C:\\private\\song.flac')
   const same=window.diag.playerDragDiagnosticId('C:\\private\\song.flac')
   window.diag.recordPlayerDragDiagnostic('probe',{filePath:'C:\\private\\song.flac',title:'PrivateTitle',lyrics:'PrivateLyrics',message:'PrivateError',raw:'C:\\private\\song.flac',url:'https://private.example/song',active:id,phase:'active',nan:NaN,['C:\\private\\key']:'active'})
   window.diag.recordPlayerDragDiagnostic('C:\\private\\event')
   const payload=window.diag.freezePlayerDragDiagnostics()
   value=2;window.diag.recordPlayerDragDiagnostic('after-freeze',{value})
   const retry=window.diag.freezePlayerDragDiagnostics()
   return {id,same,payload,retry}
  })
  assert.equal(result.id,result.same)
  assert.match(result.id,/^id-[a-f0-9]+$/)
  assert.equal(result.payload,result.retry)
  for(const privateValue of ['private','PrivateTitle','PrivateLyrics','PrivateError','song.flac','https://','salt'])assert.equal(result.payload.includes(privateValue),false,privateValue)
  const report=JSON.parse(result.payload)
  assert.equal(report.finalSnapshot.test.value,1)
  assert.equal(report.events.find(entry=>entry.event==='probe').fields.raw,'redacted')
  assert.equal(report.events.find(entry=>entry.event==='probe').fields.nan,null)
  assert.equal(report.events.some(entry=>entry.event==='after-freeze'),false)
 })
 await check('stop is finite, preserves history and provider errors do not break recording',async page=>{
  await recorder(page)
  const result=await page.evaluate(()=>{
   window.diag.registerPlayerDragDiagnosticSnapshot('broken',()=>{throw new Error('C:\\private\\fixture.flac')})
   window.diag.startPlayerDragDiagnostics();window.diag.recordPlayerDragDiagnostic('before-stop')
   window.diag.stopPlayerDragDiagnostics();window.diag.recordPlayerDragDiagnostic('after-stop')
   return JSON.parse(window.diag.freezePlayerDragDiagnostics())
  })
  assert(result.events.some(entry=>entry.event==='snapshot.failed'))
  assert(result.events.some(entry=>entry.event==='recording.stop'))
  assert(result.events.some(entry=>entry.event==='before-stop'))
  assert.equal(result.events.some(entry=>entry.event==='after-stop'),false)
  assert.equal(JSON.stringify(result).includes('private'),false)
 })
 await check('v2 raw listeners are opt-in, passive and detached on stop/freeze; noise is aggregated',async page=>{
  await recorder(page)
  const result=await page.evaluate(()=>{
   const disabled=window.diagnosticRawListeners.size
   window.diag.startPlayerDragDiagnostics()
   const active=[...window.diagnosticRawListeners.values()]
   for(let index=0;index<50;index++){window.diag.recordPlayerDragDiagnostic('hydration.cache-hit');window.diag.recordPlayerDragDiagnostic('artwork.resource.references',{references:3})}
   window.diag.recordPlayerDragDiagnostic('artwork.resource.references',{references:1})
   window.diag.stopPlayerDragDiagnostics()
   const stopped=window.diagnosticRawListeners.size
   const report=JSON.parse(window.diag.freezePlayerDragDiagnostics())
   const frozen=window.diagnosticRawListeners.size
   window.diag.startPlayerDragDiagnostics();const restarted=window.diagnosticRawListeners.size;window.diag.freezePlayerDragDiagnostics()
   return {disabled,active,stopped,frozen,restarted,after:window.diagnosticRawListeners.size,report}
  })
  assert.equal(result.disabled,0)
  assert.equal(result.active.length,17)
  assert(result.active.every(listener=>listener.passive))
  assert.equal(result.stopped,0);assert.equal(result.frozen,0);assert.equal(result.after,0)
  assert.equal(result.restarted,17,'restarting does not duplicate raw listeners')
  assert.deepEqual(result.report.aggregatedCounts,{hydrationCacheHits:50,resourceReferenceChangesAboveOne:50})
  assert.equal(result.report.events.filter(entry=>entry.event==='artwork.resource.references').length,1)
 })
 await check('v2 raw facts preserve event trust/source and selection topology without selected text',async page=>{
  await recorder(page)
  await page.evaluate(()=>{
   const node=document.createElement('p');node.textContent='PrivateSelectedWords';document.body.append(node)
   const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range)
   window.diag.startPlayerDragDiagnostics()
  })
  await page.mouse.move(20,20);await page.mouse.down();await page.mouse.up()
  const report=await page.evaluate(()=>JSON.parse(window.diag.freezePlayerDragDiagnostics()))
  const raw=report.events.filter(entry=>entry.event==='input.raw')
  assert(raw.some(entry=>entry.fields.type==='pointerdown'&&entry.fields.trusted===true))
  assert(raw.some(entry=>entry.fields.type==='mousedown'&&entry.fields.phase==='bubble'))
  assert(raw.some(entry=>entry.fields.selection?.type==='Range'))
  assert(raw.every(entry=>entry.fields.target&&typeof entry.fields.defaultPrevented==='boolean'))
  assert.equal(JSON.stringify(report).includes('PrivateSelectedWords'),false)
  assert.equal(JSON.stringify(report).includes('text/html'),false)
 })
 await check('panel is opt-in; opening, hiding and saving do not reset cover interaction',async page=>{
  await surface(page)
  assert.equal(await page.locator('[data-player-drag-diagnostics]').count(),0)
  const resets=await page.evaluate(()=>window.diagnosticResets)
  await page.keyboard.press('Control+Shift+Alt+D')
  await page.getByRole('button',{name:'开始记录',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'记录故障并保存',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'开始记录',exact:true}).click()
  await page.getByRole('button',{name:'隐藏拖拽诊断',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.diag.isPlayerDragDiagnosticsRecording()),true)
  await page.keyboard.press('Control+Shift+Alt+D')
  assert.equal(await page.evaluate(()=>window.diagnosticResets),resets)
  await page.getByRole('button',{name:'记录故障并保存',exact:true}).click()
  await page.waitForFunction(()=>window.diagnosticExports.length===1)
  const pending=await page.evaluate(()=>({call:window.diagnosticExports[0],resets:window.diagnosticResets}))
  assert.equal(pending.call.command,'player_drag_diagnostics_export')
  assert.equal(pending.call.status.recording,false,'freeze must happen before native export begins')
  assert.equal(pending.call.status.frozen,true)
  assert.equal(pending.resets,resets)
  assert.equal(await page.getByRole('button',{name:'正在保存…',exact:true}).isDisabled(),true)
  await page.evaluate(()=>window.diagnosticExportPending.reject(new Error('C:\\private\\disk-error')))
  await page.getByRole('alert').filter({hasText:'保存失败'}).waitFor()
  assert.equal(await page.evaluate(()=>window.diag.getPlayerDragDiagnosticsStatus().frozen),true)
  const firstPayload=pending.call.args.input.payload
  await page.evaluate(()=>window.diag.recordPlayerDragDiagnostic('after-failure'))
  await page.getByRole('button',{name:'重试保存故障日志',exact:true}).click()
  await page.waitForFunction(()=>window.diagnosticExports.length===2)
  assert.equal(await page.evaluate(()=>window.diagnosticExports[1].args.input.payload),firstPayload)
  await page.evaluate(()=>window.diagnosticExportPending.resolve('C:\\Logs\\drag-diagnostics\\player-drag-fixture.json'))
  await page.getByLabel('日志已保存，可复制路径').waitFor()
  assert.equal(await page.getByLabel('日志已保存，可复制路径').inputValue(),'C:\\Logs\\drag-diagnostics\\player-drag-fixture.json')
  assert.equal(await page.evaluate(()=>window.diagnosticResets),resets)
 })
 await check('disabled real pointer, preview and artwork producers do not hash identities',async page=>{
  await surface(page)
  assert.equal(await page.evaluate(()=>window.diagnosticHashCalls??0),0,'mounting without opt-in performs no identity hashing')
  const box=await page.locator('.cover-input-region').boundingBox()
  const x=box.x+box.width*.85,y=box.y+box.height*.35
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-32,y)
  await page.waitForTimeout(100)
  await page.mouse.move(x-box.width*.72,y);await page.mouse.up()
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  assert.equal(await page.evaluate(()=>window.diagnosticHashCalls??0),0,'disabled producers guard before hash/registry payload evaluation')
  assert.equal(await page.evaluate(()=>window.diag.getPlayerDragDiagnosticsStatus().hasRecording),false)
 })
 await check('real drag refusal identifies active/logical mismatch and preserves fault snapshot',async page=>{
  await surface(page)
  await page.evaluate(()=>{window.diag.startPlayerDragDiagnostics();window.coverUpdate({index:1,detailsPending:true})})
  await page.waitForFunction(()=>window.diagnosticActiveLogical().logical==='track-1'&&window.diagnosticActiveLogical().active.includes('track-0'))
  const box=await page.locator('.cover-input-region').boundingBox()
  const x=box.x+box.width*.85,y=box.y+box.height*.35
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-48,y)
  const report=await page.evaluate(()=>JSON.parse(window.diag.freezePlayerDragDiagnostics()))
  await page.mouse.up()
  const rejection=report.events.find(entry=>entry.event==='drag.start.rejected'&&entry.fields.reason==='active-logical-mismatch')
  assert(rejection,'the actual early return emits a specific refusal reason')
  assert.notEqual(rejection.fields.logicalId,rejection.fields.activeIds[0])
  assert.equal(report.finalSnapshot.surface.logicalId,rejection.fields.logicalId)
  assert.equal(report.finalSnapshot.surface.layers.find(layer=>layer.phase==='active').trackId,rejection.fields.activeIds[0])
  assert.equal(report.finalSnapshot.surface.geometryReady,true)
  assert.equal(JSON.stringify(report).includes('track-1'),false,'only opaque identity fingerprints are persisted')
 })
 await check('real pending preview is captured before promise resolution without hard reset',async page=>{
  await surface(page)
  await page.evaluate(()=>{window.diagnosticPrepareGate=true;window.diag.startPlayerDragDiagnostics()})
  const resets=await page.evaluate(()=>window.diagnosticResets)
  const box=await page.locator('.cover-input-region').boundingBox()
  const x=box.x+box.width*.85,y=box.y+box.height*.35
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-48,y)
  await page.waitForFunction(()=>typeof window.releaseDiagnosticPrepare==='function')
  const report=await page.evaluate(()=>JSON.parse(window.diag.freezePlayerDragDiagnostics()))
  assert(report.events.some(entry=>entry.event==='drag.start.accepted'))
  assert(report.events.some(entry=>entry.event==='preview.request'))
  assert.equal(report.events.some(entry=>entry.event==='preview.result'),false)
  assert(report.finalSnapshot.surface.drag)
  assert.equal(report.finalSnapshot.surface.drag.targetReady,false)
  assert.equal(report.finalSnapshot.surface.drag.tokenId,null)
  assert.equal(report.finalSnapshot.surface.previewPaintReady,false)
  assert.equal(await page.evaluate(()=>window.diagnosticResets),resets)
  await page.mouse.up()
 })
 await check('genuine browser pointer cancellation keeps its source and later mouse dragging recovers',async page=>{
  await surface(page)
  await page.evaluate(()=>window.diag.startPlayerDragDiagnostics())
  const box=await page.locator('.cover-input-region').boundingBox(),x=box.x+box.width*.8,y=box.y+box.height*.35
  const cdp=await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:x-50,y}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]})
  const report=await page.evaluate(()=>JSON.parse(window.diag.freezePlayerDragDiagnostics()))
  assert(report.events.some(entry=>entry.event==='input.raw'&&entry.fields.type==='pointercancel'&&entry.fields.trusted===true))
  assert(report.events.some(entry=>entry.event==='cancel.source'&&entry.fields.source==='native-window'&&entry.fields.trusted===true))
  assert(report.events.some(entry=>entry.event==='cancel.source'&&entry.fields.source==='react-cover'))
  assert.equal(report.finalSnapshot.surface.press,null)
  assert.equal(report.finalSnapshot.surface.drag,null)
  await page.waitForTimeout(500)
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-40,y)
  await page.waitForTimeout(100);await page.mouse.move(x-box.width*.7,y);await page.mouse.up()
  await page.waitForFunction(()=>window.coverCommits.length===1)
 })
}finally{await browser.close()}
console.log(JSON.stringify({passed}))
