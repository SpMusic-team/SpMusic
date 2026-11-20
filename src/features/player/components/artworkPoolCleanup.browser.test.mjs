// Actual artwork hook, canvas loader and consumer cleanup. Only media is synthetic.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'

const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const output=process.env.SPMUSIC_POOL_OUTPUT||'D:/SpMusic/.codex-tmp-folder-ui-dist/drag-diagnostics-20261101'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dep=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match,name);return match[1]}
let hook=await(await fetch(origin+'/src/features/player/hooks/useArtworkVisualResource.ts')).text()
if(process.env.SPMUSIC_POOL_REMOVE_CACHED_PREPARE==='1'){
 assert(hook.includes('if (registryGet(identity)) return;'),'diagnostic pre-fix counterfactual point')
 hook=hook.replace('if (registryGet(identity)) return;','')
}
if(process.env.SPMUSIC_POOL_SKIP_CACHED_PREPARE==='1'){
 const marker='const nextPrepared = {'
 assert(hook.includes(marker),'diagnostic cached prepared counterfactual point')
 hook=hook.replace(marker,'if (registryGet(identity)) return; '+marker)
}
hook=hook.replace('const requestFilePath = artwork.coverFilePath;',"window.artworkRawCounts ??= {}; window.artworkRawCounts[artwork.id]=(window.artworkRawCounts[artwork.id]??0)+1; const requestFilePath = artwork.coverFilePath;")
const hookTarget='const currentArtworkReady ='
assert(hook.includes(hookTarget),'readonly hook instrumentation point')
hook=hook.replace(hookTarget,`window.artworkPoolSnapshot=()=>({available:canvasPoolRef.current?.hasAvailable(),registry:[...resourceRegistryRef.current].map(([identity,entry])=>({id:identity.split('\\0')[0],pinned:pinnedIdentitiesRef.current.has(identity),inLayer:layersRef.current.some(layer=>layer.resource===entry.resource),released:entry.resource.isReleased()})),active:artworkLoadQueueActive,jobs:[...artworkLoadJobs.values()].map(job=>({id:job.key.split('\\0')[1],active:job.active,settled:job.settled,priority:job.priority,consumers:job.consumers.size,target:job.key.includes('T8')})),layers:layersRef.current.map(layer=>({id:layer.id,track:layer.track.id,phase:layer.phase,token:layer.previewTokenId,view:Boolean(layer.resource.view)}))});window.artworkPoolResource=id=>[...resourceRegistryRef.current].find(([identity])=>identity.split('\\0')[0]===id)?.[1].resource;`+hookTarget)
hook=hook.replace('available:canvasPoolRef.current?.hasAvailable(),','counts:{...window.artworkRawCounts},available:canvasPoolRef.current?.hasAvailable(),')
hook=hook.replace('inLayer:layersRef.current.some(layer=>layer.resource===entry.resource),','inLayer:layersRef.current.some(layer=>layer.resource===entry.resource),sameIdentityLayer:layersRef.current.some(layer=>layer.identity===identity),')
let fixture=`
import React from '${dep('react.js')}';import ReactDOM from '${dep('react-dom_client.js')}';
import {useArtworkVisualResource,useArtworkResourceConsumer} from '/src/features/player/hooks/useArtworkVisualResource.ts';
import {ArtworkCanvas} from '/src/features/player/components/ArtworkCanvas.tsx';
const tracks=Array.from({length:10},(_,index)=>({id:'T'+index,title:'Track '+index,artist:'Artist',album:'Album',durationSeconds:180,lyrics:[],coverTone:'lagoon',coverImage:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl('+(index*32)+' 70% 50%)"/><text x="2" y="20">'+index+'</text></svg>')}));
const artworks=tracks.map(track=>({id:track.id,resourceKey:track.id,coverTone:track.coverTone,coverImage:track.coverImage}));
function OldConsumer({resource}){useArtworkResourceConsumer(resource);return null}
function Harness(){
 const[center,setCenter]=React.useState(3),[held,setHeld]=React.useState(null),[token,setToken]=React.useState(null);
 const candidates=React.useMemo(()=>[1,-1,2,-2,3,-3].map(offset=>({afterTrackId:tracks[center].id,direction:offset>0?1:-1,track:tracks[center+offset],artwork:artworks[center+offset]})),[center]);
 const visual=useArtworkVisualResource(artworks[center],tracks[center],false,candidates,0,null,token);
 window.api={hold:()=>setHeld(window.artworkPoolResource('T0')),advance:()=>setCenter(4),drop:()=>setHeld(null),begin:()=>setToken({id:100,originTrackId:'T4',targetTrackId:'T8',direction:1,track:tracks[8],artwork:artworks[8]}),snapshot:()=>({...window.artworkPoolSnapshot(),held:Boolean(held),ready:visual.previewArtworkReady})};
 return React.createElement('main',null,held?React.createElement(OldConsumer,{resource:held}):null,visual.slots.filter(Boolean).map(layer=>React.createElement(ArtworkCanvas,{key:layer.id,className:'display',source:layer.resource.view,label:layer.track.id,onReady:()=>visual.markReady(layer.id)})));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
`
if(process.env.SPMUSIC_POOL_ADJACENT==='1'){
 fixture=fixture.replace('length:10','length:64').replace('window.api={hold:',"window.adjacent={move:direction=>setCenter(value=>value+direction),begin:direction=>setToken({id:performance.now(),originTrackId:tracks[center].id,targetTrackId:tracks[center+direction].id,direction,track:tracks[center+direction],artwork:artworks[center+direction]}),commit:()=>{setCenter(value=>value+token.direction);setToken(null)},state:()=>({center,token:token?.id,ready:visual.previewArtworkReady})}; window.api={hold:")
}
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__pool_cleanup.js"').replace('</head>','<style>.display{display:block;width:128px;height:128px}</style></head>')
const browser=await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL||'msedge'})
let passed=0
try{
 for(const delayed of [false,true]){
  if(process.env.SPMUSIC_POOL_CASE&&process.env.SPMUSIC_POOL_CASE!==(delayed?'late':'early'))continue
  const page=await browser.newPage({viewport:{width:800,height:600}}),errors=[],result={delayed,skipCachedPrepare:process.env.SPMUSIC_POOL_SKIP_CACHED_PREPARE==='1'}
  page.on('pageerror',error=>errors.push(error.message))
  page.setDefaultTimeout(15000)
  try{
   await page.route('**/src/features/player/hooks/useArtworkVisualResource.ts*',route=>route.fulfill({contentType:'text/javascript',body:hook}))
   await page.route('**/__pool_cleanup.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
   await page.route('**/__pool_cleanup_test',route=>route.fulfill({contentType:'text/html',body:html}))
   await page.goto(origin+'/__pool_cleanup_test')
   await page.waitForFunction(()=>window.api?.snapshot().registry.length===7&&!window.api.snapshot().active)
   if(process.env.SPMUSIC_POOL_ADJACENT==='1'){
    result.adjacent=[]
    for(const direction of [...Array(28).fill(1),...Array(16).fill(-1),...Array(15).fill(1)]){
     const before=await page.evaluate(()=>({state:window.adjacent.state(),pool:window.api.snapshot()}))
     await page.evaluate(direction=>window.adjacent.begin(direction),direction)
     let ready=false
     try{await page.waitForFunction(()=>window.adjacent.state().ready,null,{timeout:1500});ready=true}catch{}
     const preview=await page.evaluate(()=>({state:window.adjacent.state(),pool:window.api.snapshot()}))
     result.adjacent.push({direction,before,preview,ready})
     if(!ready){result.completed=false;break}
     await page.evaluate(()=>window.adjacent.commit())
     await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    }
    result.completed??=true
    result.final=await page.evaluate(()=>window.api.snapshot())
    result.errors=errors
    mkdirSync(output,{recursive:true})
    writeFileSync(join(output,'pool-adjacent-'+(process.env.SPMUSIC_POOL_LABEL||'candidate')+'.json'),JSON.stringify(result,null,2))
    console.log('POOL_ADJACENT_RESULT',JSON.stringify({completed:result.completed,rounds:result.adjacent.length,final:result.final}))
    assert.deepEqual(errors,[])
    assert.equal(result.completed,true,'actual adjacent artwork must remain ready through 28 forward and repeated reversal')
    passed++;break
   }
   await page.evaluate(()=>window.api.hold())
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
   if(!delayed){
    await page.evaluate(()=>window.api.drop())
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
   }
   await page.evaluate(()=>window.api.advance())
   await page.waitForFunction(()=>window.api.snapshot().registry.some(entry=>entry.id==='T7'))
   result.full=await page.evaluate(()=>window.api.snapshot())
   if(delayed){
    assert.equal(result.full.available,false,'the real eight-canvas pool is full')
    assert.equal(result.full.held,true,'an old actual resource consumer is still mounted')
    const old=result.full.registry.find(entry=>entry.id==='T0')
    assert(old&&!old.pinned&&!old.inLayer,'the departing consumer owns the sole unpinned registry resource')
   }
   await page.evaluate(()=>window.api.begin())
   if(delayed){
    await page.waitForFunction(()=>window.api.snapshot().jobs.some(job=>job.active)&&!window.api.snapshot().available)
    result.waiting=await page.evaluate(()=>window.api.snapshot())
    await page.evaluate(()=>window.api.drop())
   }
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
   result.afterCleanup=await page.evaluate(()=>window.api.snapshot())
   try{await page.waitForFunction(()=>window.api.snapshot().ready,null,{timeout:1500});result.completed=true}catch{result.completed=false}
   result.final=await page.evaluate(()=>window.api.snapshot())
   result.errors=errors
   mkdirSync(output,{recursive:true})
   writeFileSync(join(output,'pool-cleanup-'+(process.env.SPMUSIC_POOL_LABEL||'baseline')+'-'+(delayed?'late':'early')+'.json'),JSON.stringify(result,null,2))
   console.log('POOL_CLEANUP_RESULT',JSON.stringify(result))
   assert.deepEqual(errors,[])
   assert.equal(result.completed,true,'departing consumer cleanup must let the already waiting ninth artwork load finish')
   passed++
  }catch(error){result.harnessError=String(error);result.last=await page.evaluate(()=>window.api?.snapshot()).catch(()=>null);mkdirSync(output,{recursive:true});writeFileSync(join(output,'pool-cleanup-'+(process.env.SPMUSIC_POOL_LABEL||'baseline')+'-'+(delayed?'late':'early')+'.json'),JSON.stringify(result,null,2));throw error}finally{await page.close()}
 }
}finally{await browser.close()}
console.log(JSON.stringify({passed}))
