// Read-only CDP closure inspection. No acquire/reclaim/release method is called.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync} from 'node:fs'
import {dirname,resolve} from 'node:path'

assert(process.env.SPMUSIC_NATIVE_CDP&&process.env.SPMUSIC_PROBE_OUTPUT,'explicit native endpoint and output required')
const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const browser=await chromium.connectOverCDP(process.env.SPMUSIC_NATIVE_CDP)
const pages=browser.contexts().flatMap(context=>context.pages()).filter(page=>page.url().startsWith('http://tauri.localhost/'))
assert.equal(pages.length,1)
const page=pages[0],cdp=await page.context().newCDPSession(page)
const surfaceValues=`function(){
 const node=document.querySelector('.player-shell');if(!node)return[];
 let fiber=node[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))];while(fiber?.return)fiber=fiber.return;
 const stack=[fiber?.stateNode?.current||fiber];let surface;
 while(stack.length){const current=stack.pop();if(current?.memoizedProps?.viewModel?.playback&&current.memoizedProps.viewModel.playlist){surface=current;break}if(current?.sibling)stack.push(current.sibling);if(current?.child)stack.push(current.child)}
 const values=[];for(let hook=surface?.memoizedState,count=0;hook&&count<600;hook=hook.next,count++){const value=hook.memoizedState;values.push(value);if(value&&typeof value==='object'&&'current'in value)values.push(value.current)}
 return values;
}`
const result={snapshots:await page.evaluate(()=>window.__spmusicNativeProbe?.snapshot()||null),scopes:[],resourceScopes:[]}
async function properties(objectId){return cdp.send('Runtime.getProperties',{objectId,ownProperties:true,generatePreview:false})}
async function source(objectId){return (await cdp.send('Runtime.callFunctionOn',{objectId,functionDeclaration:'function(){return this.toString()}',returnByValue:true})).result.value}
async function scopes(functionObjectId){
 const detail=await properties(functionObjectId),scopeList=detail.internalProperties?.find(item=>item.name==='[[Scopes]]')?.value.objectId
 if(!scopeList)return[]
 return (await properties(scopeList)).result.filter(item=>/^\d+$/.test(item.name)&&item.value?.objectId&&item.value.description!=='Global')
}
async function scheduler(objectId){
 return (await cdp.send('Runtime.callFunctionOn',{objectId,returnByValue:true,functionDeclaration:`function(){
  const entries=this instanceof Map?[...this.values()]:Array.isArray(this)?this:null;
  if(!entries?.length||typeof entries[0]?.active!=='boolean'||!(entries[0]?.consumers instanceof Set))return null;
  return entries.map(job=>({active:job.active,settled:job.settled,priority:job.priority,consumers:job.consumers.size}));
 }`})).result.value
}
try{
 const poolFn=await cdp.send('Runtime.evaluate',{expression:`(${surfaceValues})().find(value=>value&&typeof value.hasAvailable==='function'&&typeof value.waitForAvailable==='function')?.hasAvailable`,objectGroup:'spmusicCoverDiagnostic'})
 assert(poolFn.result.objectId,'real artwork canvas pool function must exist')
 result.poolFunction=await source(poolFn.result.objectId)
 for(const scope of await scopes(poolFn.result.objectId)){
  const fields=(await properties(scope.value.objectId)).result
  const output={kind:scope.value.description,primitives:[],collections:[],scheduler:[]}
  for(const field of fields){
   const value=field.value
   if(value?.type==='number'||value?.type==='boolean')output.primitives.push({name:field.name,value:value.value})
   else if(value?.objectId&&['Array','Map','Set'].includes(value.className)){
    output.collections.push({name:field.name,kind:value.className,description:value.description})
    if(value.className==='Map'||value.className==='Array'){
     const jobs=await scheduler(value.objectId)
     if(jobs)output.scheduler.push({name:field.name,jobs})
    }
   }
  }
  result.scopes.push(output)
 }
 const retainers=await cdp.send('Runtime.evaluate',{expression:`(()=>{const registry=(${surfaceValues})().find(value=>value instanceof Map&&value.size>0&&value.values().next().value?.resource?.retain);return registry?[...registry.values()].map(entry=>entry.resource.retain):[]})()`,objectGroup:'spmusicCoverDiagnostic'})
 for(const item of (await properties(retainers.result.objectId)).result.filter(item=>/^\d+$/.test(item.name)&&item.value?.objectId)){
  const entry={index:Number(item.name),source:await source(item.value.objectId),scopes:[]}
  for(const scope of await scopes(item.value.objectId)){
   const primitive=(await properties(scope.value.objectId)).result.filter(field=>field.value?.type==='number'||field.value?.type==='boolean').map(field=>({name:field.name,value:field.value.value}))
   entry.scopes.push({kind:scope.value.description,primitives:primitive})
  }
  result.resourceScopes.push(entry)
 }
 console.log('NATIVE_CLOSURE_RESULT',JSON.stringify({poolFunction:result.poolFunction,scopes:result.scopes,resources:result.resourceScopes.length}))
}finally{
 mkdirSync(dirname(resolve(process.env.SPMUSIC_PROBE_OUTPUT)),{recursive:true})
 writeFileSync(process.env.SPMUSIC_PROBE_OUTPUT,JSON.stringify(result,null,2))
 await cdp.send('Runtime.releaseObjectGroup',{objectGroup:'spmusicCoverDiagnostic'}).catch(()=>{})
 await cdp.detach()
}
process.exit(0)
