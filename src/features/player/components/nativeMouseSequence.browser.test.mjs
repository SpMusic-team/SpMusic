// Real native mouse input; requires the separately installed read-only native probe.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync} from 'node:fs'
import {dirname,resolve} from 'node:path'

assert(process.env.SPMUSIC_NATIVE_CDP&&process.env.SPMUSIC_PROBE_OUTPUT,'explicit native endpoint and output required')
const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const browser=await chromium.connectOverCDP(process.env.SPMUSIC_NATIVE_CDP)
const pages=browser.contexts().flatMap(context=>context.pages()).filter(page=>page.url().startsWith('http://tauri.localhost/'))
assert.equal(pages.length,1,'exactly one native app target')
const page=pages[0],rounds=[]
const result={label:process.env.SPMUSIC_PROBE_LABEL||'native-mouse',rounds}
const firstHoldMs=Number(process.env.SPMUSIC_MOUSE_FIRST_HOLD_MS||80)
const afterMs=Number(process.env.SPMUSIC_MOUSE_AFTER_MS||110)
const snapshot=()=>page.evaluate(()=>window.__spmusicNativeProbe?.snapshot())
async function drag(direction,{steady=false,rollback=false}={}){
  const before=await snapshot()
  assert(before?.reactVm,'read-only native recorder must be active')
  assert.equal(before.playlistOpen,false,'never reset a failed state by navigating away')
  const box=await page.locator('.cover-input-region').boundingBox()
  assert(box,'stable native cover input region')
  const x=box.x+box.width*(direction>0?.85:.15),y=box.y+box.height*.35
  await page.mouse.move(x,y)
  await page.mouse.down()
  await page.mouse.move(x-direction*32,y)
  await page.waitForTimeout(steady?200:firstHoldMs)
  const moving=await snapshot()
  await page.mouse.move(x-direction*box.width*(rollback?.10:.72),y,{steps:4})
  if(rollback)await page.waitForTimeout(180)
  const displaced=await snapshot()
  await page.mouse.up()
  await page.waitForTimeout(steady||rollback?600:afterMs)
  const after=await snapshot()
  const round={index:rounds.length,direction,steady,rollback,before,moving,displaced,after,changed:before.logical!==after?.logical}
  rounds.push(round)
  return round
}
try{
  assert(await page.evaluate(()=>Boolean(window.__spmusicNativeProbe)),'start nativeInteractionProbe first')
  result.initial=await snapshot()
  let misses=0,suspect=false
  if(process.env.SPMUSIC_MOUSE_STRICT_FORWARD==='1'){
    const distinct=new Set([result.initial.logical])
    let successful=0
    for(let attempt=0;successful<28&&attempt<100;attempt++){
      const round=await drag(1)
      if(round.changed){successful++;distinct.add(round.after.logical)}
      if(attempt%5===0)console.log('NATIVE_STRICT_FORWARD',JSON.stringify({attempt,successful,distinct:distinct.size,logical:round.after.logical}))
    }
    result.forwardBaseline={successful,distinct:distinct.size,ids:[...distinct]}
    assert(successful>=28&&distinct.size>=29,'cover at least 28 actual distinct forward commits before reversal')
  }
  for(const [direction,count] of (process.env.SPMUSIC_MOUSE_STRICT_FORWARD==='1'?[[-1,16],[1,12]]:[[1,24],[-1,16],[1,12]])){
    for(let index=0;index<count;index++){
      const round=await drag(direction)
      misses=round.changed?0:misses+1
      if(round.index%5===0)console.log('NATIVE_MOUSE_PROGRESS',JSON.stringify({round:round.index,changed:round.changed,pool:round.after?.poolAvailable,pending:round.after?.pending,active:round.after?.slots.filter(layer=>layer.phase==='active').map(layer=>layer.track),logical:round.after?.logical}))
      if(misses>=3&&process.env.SPMUSIC_MOUSE_STOP_ON_MISS==='1'){suspect=true;break}
    }
    if(suspect)break
  }
  if(!suspect)await drag(-1,{rollback:true})
  result.steadyReverse=await drag(-1,{steady:true})
  result.steadyForward=await drag(1,{steady:true})
  result.possiblePersistentFailure=!result.steadyReverse.changed&&!result.steadyForward.changed
  result.final=await snapshot()
  console.log('NATIVE_MOUSE_RESULT',JSON.stringify({rounds:rounds.length,commits:rounds.filter(round=>round.changed).length,possiblePersistentFailure:result.possiblePersistentFailure,final:result.final}))
}finally{
  mkdirSync(dirname(resolve(process.env.SPMUSIC_PROBE_OUTPUT)),{recursive:true})
  writeFileSync(process.env.SPMUSIC_PROBE_OUTPUT,JSON.stringify(result,null,2))
}
// Disconnect only this client; keep the native app and any failed state alive.
process.exit(0)
