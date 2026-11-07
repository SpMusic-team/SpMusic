// Opt-in native end-to-end smoke: actual panel, IPC, Rust sink and persisted JSON.
// The host must embed this diagnostic build. Never route new FE onto an old sink.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {basename,dirname,resolve} from 'node:path'

assert(process.env.SPMUSIC_NATIVE_CDP&&process.env.SPMUSIC_PROBE_OUTPUT,'explicit native endpoint and evidence path required')
const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const browser=await chromium.connectOverCDP(process.env.SPMUSIC_NATIVE_CDP)
const pages=browser.contexts().flatMap(context=>context.pages()).filter(page=>page.url().startsWith('http://tauri.localhost/'))
assert.equal(pages.length,1,'exactly one real native diagnostic app')
const page=pages[0],errors=[],result={errors}
page.setDefaultTimeout(15000)
page.on('pageerror',error=>errors.push(error.name))
try{
 assert(await page.evaluate(()=>Boolean(window.__TAURI_INTERNALS__?.invoke)),'real Tauri IPC is required')
 result.assets=await page.evaluate(()=>[...document.scripts].filter(script=>script.src.includes('/assets/')).map(script=>script.src.split('/').pop()))
 assert.equal(await page.locator('[data-player-drag-diagnostics]').count(),0,'diagnostic panel is hidden by default')
 await page.keyboard.press('Control+Shift+Alt+D')
 await page.getByRole('button',{name:'开始记录',exact:true}).click()
 await page.getByRole('status').filter({hasText:'正在记录'}).waitFor()
 if(process.env.SPMUSIC_NATIVE_GUARD_SMOKE==='1'){
  await page.getByRole('button',{name:'隐藏拖拽诊断',exact:true}).click()
  const current=()=>page.evaluate(()=>{
   const node=document.querySelector('.player-shell');let fiber=node?.[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))];while(fiber?.return)fiber=fiber.return
   const stack=[fiber?.stateNode?.current||fiber];while(stack.length){const f=stack.pop();if(!f)continue;if(f.memoizedProps?.viewModel?.playback)return f.memoizedProps.viewModel.playback.track?.id;if(f.sibling)stack.push(f.sibling);if(f.child)stack.push(f.child)}return null
  })
  const initial=await current(),fingerprint=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,12)
  result.guard={initial:fingerprint(initial),rounds:[]}
  result.guard.selection=await page.evaluate(()=>{
   const cover=document.querySelector('.track-card-plane[data-track-card-phase="active"] .cover-frame'),other=document.querySelector('.lyrics-panel li')||document.querySelector('.lyrics-panel')
   if(!cover||!other)return {created:false}
   const first=cover.compareDocumentPosition(other)&Node.DOCUMENT_POSITION_FOLLOWING?cover:other,last=first===cover?other:cover,range=document.createRange()
   range.setStartBefore(first);range.setEndAfter(last);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)
   const events=[];const observer=event=>{if(event.type==='dragstart')events.push({type:event.type,trusted:event.isTrusted,defaultPrevented:event.defaultPrevented});else events.push({type:event.type,trusted:event.isTrusted})}
   window.addEventListener('dragstart',observer);window.addEventListener('pointercancel',observer)
   window.__nativeGuardRead=()=>events;window.__nativeGuardDispose=()=>{window.removeEventListener('dragstart',observer);window.removeEventListener('pointercancel',observer);delete window.__nativeGuardRead;delete window.__nativeGuardDispose}
   return {created:true,type:selection.type,collapsed:selection.isCollapsed}
  })
  assert.equal(result.guard.selection.created,true)
  for(const direction of [1,-1]){
   const before=await current(),box=await page.locator('.cover-input-region').boundingBox(),x=box.x+box.width*(direction>0?.85:.15),y=box.y+box.height*.35
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-direction*32,y);await page.waitForTimeout(200)
   await page.mouse.move(x-direction*box.width*.7,y,{steps:8});await page.waitForTimeout(100);await page.mouse.up();await page.waitForTimeout(600)
   const after=await current();result.guard.rounds.push({direction,before:fingerprint(before),after:fingerprint(after),changed:before!==after})
  }
  result.guard.events=await page.evaluate(()=>window.__nativeGuardRead())
  result.guard.returnedToInitial=await current()===initial
  assert(result.guard.rounds.every(round=>round.changed),'both finite native drags commit')
  assert(result.guard.returnedToInitial,'forward then reverse restores the initial track')
  assert.equal(result.guard.events.filter(event=>event.type==='pointercancel').length,0)
  assert(result.guard.events.filter(event=>event.type==='dragstart').every(event=>event.trusted&&event.defaultPrevented))
  await page.keyboard.press('Control+Shift+Alt+D')
 }
 await page.getByRole('button',{name:'记录故障并保存',exact:true}).click()
 const saved=page.getByLabel('日志已保存，可复制路径')
 await saved.waitFor()
 const path=await saved.inputValue()
 const logDirectory=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:path|resolve_directory',{directory:17}))
 assert.equal(dirname(resolve(path)).toLowerCase(),resolve(logDirectory,'drag-diagnostics').toLowerCase(),'sink stays in the fixed native app log directory')
 assert.match(basename(path),/^player-drag-\d+-\d+-\d+\.json$/)
 const bytes=readFileSync(path),report=JSON.parse(bytes.toString('utf8'))
 assert(bytes.length>0&&bytes.length<=5000000)
 assert.equal(report.schemaVersion,1)
 assert.equal(report.buildMarker,'drag-diagnostics-manual-v2')
 assert.equal(report.kind,'player-drag')
 assert.equal(report.eventCapacity,10000)
 assert(report.events.length>0&&report.events.length<=10000)
 assert(report.events.some(entry=>entry.event==='recording.start'))
 assert(report.events.some(entry=>entry.event==='recording.freeze'))
 assert(report.finalSnapshot.surface,'actual Surface fault state is persisted')
 assert(report.finalSnapshot.audio,'actual audio cursor state is persisted')
 assert(report.finalSnapshot['artwork-scheduler'],'actual scheduler state is persisted')
 assert(report.events.some(entry=>entry.event==='input.raw'),'v2 raw input events are persisted')
 for(const provider of Object.values(report.finalSnapshot)){assert(provider&&typeof provider==='object');assert(!provider.failed)}
 assert.equal(report.finalSnapshot.surface.geometryReady,true)
 assert(report.finalSnapshot.surface.geometry.width>0)
 assert(report.finalSnapshot.surface.layers.some(layer=>layer.phase==='active'))
 assert(report.finalSnapshot.audio.queueSize>0)
 assert.equal(typeof report.finalSnapshot.audio.logicalIndex,'number')
 const pool=Object.entries(report.finalSnapshot).find(([key])=>key.startsWith('pool-'))?.[1]
 assert(pool,'the actual resource pool is captured')
 assert.equal(pool.entries.length,8)
 assert(pool.entries.every(entry=>Number.isInteger(entry.canvasId)))
 const artwork=Object.entries(report.finalSnapshot).find(([key])=>/^artwork-\d/.test(key))?.[1]
 assert(artwork&&artwork.registryCount>0)
 assert(artwork.registry.every(entry=>typeof entry.references==='number'))
 assert(artwork.layers.every(layer=>typeof layer.painted==='boolean'))
 const text=bytes.toString('utf8')
 assert.equal(/\b[a-z]:[\\/]/i.test(text),false,'report contains no raw absolute media paths')
 assert.equal(/data:image|file:\/\/|https?:\/\//i.test(text),false,'report contains no image contents or media URLs')
 result.persisted={file:basename(path),bytes:bytes.length,schemaVersion:report.schemaVersion,buildMarker:report.buildMarker,eventCount:report.events.length,snapshotProviders:Object.keys(report.finalSnapshot),fixedDirectoryVerified:true}
 await page.getByRole('button',{name:'隐藏拖拽诊断',exact:true}).click()
 assert.equal(await page.locator('[data-player-drag-diagnostics]').count(),0)
 assert.deepEqual(errors,[])
 console.log('NATIVE_DIAGNOSTIC_EXPORT',JSON.stringify(result))
}finally{
 if(process.env.SPMUSIC_NATIVE_GUARD_SMOKE==='1')await page.evaluate(()=>{window.__nativeGuardDispose?.();window.getSelection()?.removeAllRanges()}).catch(()=>{})
 mkdirSync(dirname(resolve(process.env.SPMUSIC_PROBE_OUTPUT)),{recursive:true})
 writeFileSync(process.env.SPMUSIC_PROBE_OUTPUT,JSON.stringify(result,null,2))
}
// Disconnect this diagnostic client only. Leave the native app usable.
process.exit(0)
