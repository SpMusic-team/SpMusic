// Opt-in diagnostics for the real Tauri/WebView2 page. Never substitutes native IO.
// Set SPMUSIC_NATIVE_CDP and SPMUSIC_PROBE_OUTPUT; the caller starts the isolated host.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs'
import {dirname,extname,resolve,sep} from 'node:path'

const endpoint=process.env.SPMUSIC_NATIVE_CDP
const output=process.env.SPMUSIC_PROBE_OUTPUT
assert(endpoint&&output,'SPMUSIC_NATIVE_CDP and SPMUSIC_PROBE_OUTPUT must be explicit')
const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const durationMs=Number(process.env.SPMUSIC_PROBE_DURATION_MS||20000)
assert(Number.isFinite(durationMs)&&durationMs>=1000&&durationMs<=180000,'bounded diagnostic duration')
const files=['src/features/player/components/PlayerSurface.tsx','src/features/player/hooks/useArtworkVisualResource.ts','src/features/player/components/MoreActionsMenu.tsx','src/features/player/components/PlayerShell.tsx','src/features/player/hooks/usePlaylistDuration.ts']
const manifest=Object.fromEntries(files.map(file=>{
  const bytes=readFileSync(resolve(file))
  return [file,{sha256:createHash('sha256').update(bytes).digest('hex'),modifiedUtc:statSync(resolve(file)).mtime.toISOString()}]
}))
if(process.env.SPMUSIC_PROBE_EXE){
  const file=process.env.SPMUSIC_PROBE_EXE,bytes=readFileSync(file)
  manifest.nativeHost={sha256:createHash('sha256').update(bytes).digest('hex'),modifiedUtc:statSync(file).mtime.toISOString(),bytes:bytes.length}
}
const browser=await chromium.connectOverCDP(endpoint)
const candidates=[]
for(const context of browser.contexts())for(const page of context.pages()){
  if(!/^https?:\/\/(tauri\.localhost|localhost|127\.0\.0\.1)(:|\/)/.test(page.url()))continue
  if(await page.evaluate(()=>Boolean(window.__TAURI_INTERNALS__?.invoke)).catch(()=>false))candidates.push(page)
}
assert.equal(candidates.length,1,'one native Tauri target must be selected; never guess between windows')
const page=candidates[0]
let candidateAssets
if(process.env.SPMUSIC_PROBE_DIST){
 const prior=await page.evaluate(()=>{const probe=window.__spmusicNativeProbe;if(!probe)return null;const value=probe.read();probe.dispose();return value})
 if(prior){mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output.replace(/\.json$/,'-prior-recorder.json'),JSON.stringify(prior,null,2))}
 const dist=resolve(process.env.SPMUSIC_PROBE_DIST)
 candidateAssets=async route=>{
  const pathname=new URL(route.request().url()).pathname
  const relative=pathname==='/'?'index.html':decodeURIComponent(pathname).replace(/^\//,'')
  const path=resolve(dist,relative)
  assert(path.startsWith(dist+sep),'candidate resource stays inside explicitly selected dist')
  if(!existsSync(path))return route.continue()
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}
  return route.fulfill({body:readFileSync(path),contentType:types[extname(path)]||'application/octet-stream'})
 }
 await page.route('http://tauri.localhost/**',candidateAssets)
 await page.reload()
 await page.locator('.cover-input-region').waitFor()
}
const errors=[]
page.on('pageerror',error=>errors.push(error.name))
const result={label:process.env.SPMUSIC_PROBE_LABEL||'native',manifest,engine:browser.version(),origin:new URL(page.url()).origin,durationMs,errors,assets:await page.evaluate(()=>[...document.scripts].filter(script=>script.src.includes('/assets/')).map(script=>script.src.split('/').pop()))}
try{
  await page.evaluate(()=>{
    if(window.__spmusicNativeProbe)throw new Error('A diagnostic recorder is already active')
    const pending=new Map(),events=[],snapshots=[],longTasks=[]
    const started=performance.now()
    let sequence=0,lastSnapshot='',disposed=false
    const digest=value=>{
      if(value==null)return null
      let hash=2166136261
      for(const char of String(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}
      return (hash>>>0).toString(16)
    }
    const countPending=()=>{
      const counts={total:pending.size,metadata:0,duration:0,cover:0,transport:0,other:0}
      for(const entry of pending.values()){
        const key=/duration/.test(entry.command)?'duration':/cover|artwork/.test(entry.command)?'cover':/hydrate|summar/.test(entry.command)?'metadata':/audio_(load|play|pause|seek|next|previous)/.test(entry.command)?'transport':'other'
        counts[key]++
      }
      return counts
    }
    const record=entry=>{events.push({t:performance.now()-started,...entry});if(events.length>4000)events.shift()}
    const internals=window.__TAURI_INTERNALS__,originalInvoke=internals.invoke
    const invoke=function(command,...args){
      const id=++sequence,start=performance.now()
      // Arguments and native messages can contain full paths; never retain them.
      const name=typeof command==='string'?command:'unknown'
      pending.set(id,{command:name,start})
      record({type:'ipc-start',id,command:name,pending:countPending()})
      let request
      try{request=originalInvoke.call(this,command,...args)}catch(error){
        pending.delete(id);record({type:'ipc-end',id,command:name,ms:performance.now()-start,ok:false});throw error
      }
      return Promise.resolve(request).then(value=>{
        pending.delete(id);record({type:'ipc-end',id,command:name,ms:performance.now()-start,ok:true,pending:countPending()});return value
      },error=>{
        pending.delete(id);record({type:'ipc-end',id,command:name,ms:performance.now()-start,ok:false,pending:countPending()});throw error
      })
    }
    internals.invoke=invoke
    const getRoot=()=>{
      const node=document.querySelector('.player-shell')||document.getElementById('root')?.firstElementChild
      if(!node)return null
      let fiber=node[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))]
      while(fiber?.return)fiber=fiber.return
      return fiber?.stateNode?.current||fiber
    }
    const fibers=()=>{
      const root=getRoot(),all=[],stack=root?[root]:[]
      while(stack.length&&all.length<30000){
        const fiber=stack.pop();all.push(fiber)
        if(fiber.sibling)stack.push(fiber.sibling)
        if(fiber.child)stack.push(fiber.child)
      }
      return all
    }
    const hookValues=fiber=>{
      const values=[]
      let hook=fiber?.memoizedState
      for(let count=0;hook&&count<600;count++,hook=hook.next){
        const value=hook.memoizedState
        values.push(value)
        if(value&&typeof value==='object'&&'current'in value)values.push(value.current)
        if(Array.isArray(value)&&value.length===2&&Array.isArray(value[1]))values.push(value[0])
      }
      return values
    }
    const visible=node=>Boolean(node&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0)
    const inViewport=node=>{const rect=node.getBoundingClientRect();return visible(node)&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth}
    const snapshot=()=>{
      const all=fibers(),surface=all.find(f=>f.memoizedProps?.viewModel?.playback&&f.memoizedProps?.viewModel?.playlist)
      const vm=surface?.memoizedProps.viewModel,values=hookValues(surface)
      const shellValues=[]
      for(let ancestor=surface?.return;ancestor;ancestor=ancestor.return)shellValues.push(...hookValues(ancestor))
      const duration=shellValues.find(value=>value?.settledByScope instanceof Map&&value?.durationsByScope instanceof Map)
      const summaryMaps=shellValues.filter(value=>value&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof Map)&&Object.values(value).length&&Object.values(value).every(status=>status==='loading'||status==='ready'))
      const status=summaryMaps.find(value=>vm?.playlist.library?.currentScope&&Object.hasOwn(value,vm.playlist.library.currentScope))
      const press=values.find(value=>value&&typeof value==='object'&&'pointerId'in value&&'tapEligible'in value)
      const drag=values.find(value=>value&&typeof value==='object'&&'gestureId'in value&&'originTrackId'in value)
      const preview=values.find(value=>value&&typeof value==='object'&&'targetTrackId'in value&&'artwork'in value&&'originTrackId'in value)
      const layers=values.find(value=>Array.isArray(value)&&value.some(layer=>layer?.resource&&layer?.track&&typeof layer.phase==='string'))
      const pool=values.find(value=>value&&typeof value.hasAvailable==='function'&&typeof value.waitForAvailable==='function')
      const registry=values.find(value=>value instanceof Map&&value.size>0&&value.values().next().value?.resource?.retain)
      const pinned=values.find(value=>value instanceof Set&&typeof value.values().next().value==='string'&&value.values().next().value.includes('\u0000'))
      const lifecycle=values.filter(value=>value&&typeof value==='object'&&!Array.isArray(value)&&(
        'requestedArtwork'in value||('identity'in value&&('controller'in value||'phase'in value))
      )).map(value=>({identity:digest(value.identity),track:digest(value.track?.id),after:digest(value.afterTrackId),phase:value.phase??null,promoted:value.promoted??null,resource:Boolean(value.resource),view:Boolean(value.resource?.view),aborted:value.controller?.signal.aborted??null,requestTrack:digest(value.requestedArtwork?.id)}))
      const paintedCandidates=values.filter(value=>value instanceof Set&&value.size>0&&[...value].every(item=>typeof item==='number')).map(value=>[...value])
      const resources=registry?[...registry].map(([identity,entry])=>({identity:digest(identity),view:Boolean(entry.resource.view),released:entry.resource.isReleased(),pinned:pinned?.has(identity)??null,inLayer:Boolean(layers?.some(layer=>layer?.resource===entry.resource))})):[]
      const scope=vm?.playlist.library?.currentScope
      const slots=(layers||[]).filter(Boolean).map(layer=>({id:layer.id,track:digest(layer.track?.id),phase:layer.phase,token:layer.previewTokenId??null,view:Boolean(layer.resource?.view)}))
      const panels=[...document.querySelectorAll('.playlist-panel')].filter(visible)
      const renderedCards=[...document.querySelectorAll('.playlist-card')].filter(visible)
      const cards=renderedCards.filter(inViewport)
      const frame=document.querySelector('.track-card-plane[data-track-card-phase="active"] .cover-frame'),box=frame?.getBoundingClientRect()
      const hit=box?document.elementFromPoint(box.x+box.width*.5,box.y+box.height*.35):null
      const grid=document.querySelector('.playlist-grid'),cardRect=cards[0]?.getBoundingClientRect()
      const input=document.querySelector('.cover-input-region'),inputRect=input?.getBoundingClientRect()
      const inputGeometry=inputRect?{x:inputRect.x,y:inputRect.y,width:inputRect.width,height:inputRect.height}:null
      return {t:performance.now()-started,reactVm:Boolean(vm),logical:digest(vm?.playback.track?.id),playlistOpen:vm?.playlist.isOpen??null,route:vm?.playlist.library?.route?.view==='category'?vm.playlist.library.route.categoryId:vm?.playlist.library?.route?.view??null,descriptorCount:vm?.playlist.library?.items?.find(item=>item.scope===scope)?.trackCount??vm?.playlist.tracks?.length??null,rowModelCount:vm?.playlist.tracks?.length??null,allSongCount:vm?.playlist.library?.allSongs?.length??null,metadata:vm?.playlist.metadataStatus??null,summary:status?.[scope]??null,durationSettled:duration?.settledByScope.get(scope)??null,durationScopeCount:duration?.settledByScope.size??null,visiblePanels:panels.length,renderedCards:renderedCards.length,visibleCards:cards.length,grid:grid?{layoutLevel:grid.dataset.layoutLevel??null,flow:grid.dataset.flow??null,columns:grid.dataset.columns??null,firstCardWidth:cardRect?.width??null,firstCardHeight:cardRect?.height??null}:null,visibleCoverCanvases:cards.filter(card=>card.querySelector('canvas')).length,visibleCoverImages:cards.filter(card=>[...card.querySelectorAll('img')].some(image=>image.complete&&image.naturalWidth>0)).length,slots,lifecycle,paintedCandidates,inputGeometry,preview:preview?{id:preview.id,origin:digest(preview.originTrackId),target:digest(preview.targetTrackId),direction:preview.direction}:null,poolAvailable:pool?pool.hasAvailable():null,resources,press:press?{track:digest(press.originTrackId),pointerId:press.pointerId,type:press.pointerType,tapEligible:press.tapEligible,targetConnected:press.target?.isConnected??null,frameConnected:press.coverFrame?.isConnected??null,currentConnected:press.currentTarget?.isConnected??null,containsFrame:Boolean(press.currentTarget?.contains(press.coverFrame))}:null,drag:drag?{track:digest(drag.originTrackId),pointerId:drag.pointerId,type:drag.pointerType,released:drag.released,captureConnected:drag.captureElement?.isConnected??null,captureHeld:drag.captureElement?.hasPointerCapture?.(drag.pointerId)??null,coverWidth:drag.coverWidth,direction:drag.direction,revision:drag.revision,deferredHandoff:drag.deferredHandoff,targetReady:drag.targetReady,progress:drag.progress,token:drag.token?.id??null}:null,pending:countPending(),hit:hit?{tag:hit.tagName,phase:hit.closest('.track-card-plane')?.dataset.trackCardPhase??null,inert:Boolean(hit.closest('[inert]'))}:null}
    }
    const sample=()=>{
      if(disposed)return
      const value=snapshot(),key=JSON.stringify({...value,t:0})
      if(key!==lastSnapshot){lastSnapshot=key;snapshots.push(value);if(snapshots.length>1000)snapshots.shift()}
    }
    const pointer=event=>{
      const cover=Boolean(event.target?.closest?.('.cover-frame,.cover-input-region'))
      const button=event.target?.closest?.('button'),label=button?.getAttribute('aria-label')
      const control=cover?'cover':label==='播放列表'||label==='打开播放界面'?'playlist':label==='下一首'||label==='上一首'?'transport':label==='更多'?'more':'other'
      if(control==='other'&&event.type==='click')return
      record({type:event.type,control,pointerType:event.pointerType??null,pointerId:event.pointerId??null,buttons:event.buttons??null})
      if(event.type==='pointerdown'||event.type==='pointerup'||control==='playlist')queueMicrotask(sample)
    }
    const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries()){longTasks.push({t:entry.startTime-started,ms:entry.duration});if(longTasks.length>500)longTasks.shift()}})
    observer.observe({type:'longtask',buffered:false})
    for(const type of ['pointerdown','pointerup','pointercancel','click'])document.addEventListener(type,pointer,true)
    const timer=setInterval(sample,250)
    sample()
    window.__spmusicNativeProbe={sample,snapshot,mark:label=>record({type:'mark',label}),read:()=>({started,events,snapshots,longTasks,pendingAtStartUnknown:true,pendingAtEnd:countPending()}),dispose:()=>{
      disposed=true;clearInterval(timer);observer.disconnect()
      for(const type of ['pointerdown','pointerup','pointercancel','click'])document.removeEventListener(type,pointer,true)
      if(internals.invoke===invoke)internals.invoke=originalInvoke
      delete window.__spmusicNativeProbe
    }}
  })
  console.log('NATIVE_PROBE_READY',JSON.stringify({origin:result.origin,durationMs,label:result.label}))
  if(process.env.SPMUSIC_PROBE_ACTIONS==='list'){
    const toggle=page.locator('.window-bar').getByRole('button',{name:'播放列表',exact:true})
    assert.equal(await toggle.count(),1,'one real window-bar playlist control')
    const baseline=await page.evaluate(()=>window.__spmusicNativeProbe.snapshot())
    assert.equal(baseline.playlistOpen,false,'list timing starts from the player; never silently reset the initial state')
    for(const phase of ['first-list-open','second-list-open']){
      await page.evaluate(phase=>window.__spmusicNativeProbe.mark(phase+'-request'),phase)
      const start=Date.now()
      await toggle.click()
      let settled=false
      try{await page.waitForFunction(()=>{
        const state=window.__spmusicNativeProbe.snapshot()
        return state.playlistOpen&&state.metadata==='ready'&&(state.visibleCards>0||state.descriptorCount===0)
      },null,{timeout:durationMs});settled=true}catch{/* A timeout is recorded evidence, not changed into success. */}
      const state=await page.evaluate(()=>window.__spmusicNativeProbe.snapshot())
      result[phase]={ms:Date.now()-start,settled,state}
      console.log('NATIVE_LIST_PHASE',JSON.stringify({phase,...result[phase]}))
      await page.evaluate(phase=>window.__spmusicNativeProbe.mark(phase+'-captured'),phase)
      await page.getByRole('button',{name:'打开播放界面',exact:true}).click()
      await page.waitForFunction(()=>window.__spmusicNativeProbe.snapshot().playlistOpen===false)
    }
  }else await page.waitForTimeout(durationMs)
  Object.assign(result,await page.evaluate(()=>{window.__spmusicNativeProbe.sample();return window.__spmusicNativeProbe.read()}))
  console.log('NATIVE_PROBE_RESULT',JSON.stringify({snapshots:result.snapshots.length,events:result.events.length,pendingAtEnd:result.pendingAtEnd,errors}))
}finally{
  mkdirSync(dirname(resolve(output)),{recursive:true})
  writeFileSync(output,JSON.stringify(result,null,2))
  await page.evaluate(()=>window.__spmusicNativeProbe?.dispose()).catch(()=>{})
  if(candidateAssets)await page.unroute('http://tauri.localhost/**',candidateAssets)
}
// End this diagnostic client without issuing Browser.close to the native host.
process.exit(0)
