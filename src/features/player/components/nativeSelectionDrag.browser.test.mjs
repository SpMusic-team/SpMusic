// Read-only product experiment in a synthetic media fixture. Uses genuine DOM
// Selection plus trusted browser mouse input, never injected pointercancel.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {runInNewContext} from 'node:vm'

const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const output=resolve(process.env.SPMUSIC_SELECTION_OUTPUT||'.codex-tmp-folder-ui-dist/drag-diagnostics-20261101/selection-native-drag.json')
const componentPath='/src/features/player/components/PlayerSurface.tsx'
const surfaceSource=process.env.SPMUSIC_SELECTION_SURFACE_PATH?readFileSync(process.env.SPMUSIC_SELECTION_SURFACE_PATH,'utf8'):await(await fetch(origin+componentPath)).text()
const entry=await(await fetch(origin+'/src/main.tsx')).text()+surfaceSource
const dependency=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match,name);return match[1]}
const shared=readFileSync(new URL('./coverTransition.browser.test.mjs',import.meta.url),'utf8')
const literal=shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
let fixture=runInNewContext(literal[1],{dependency,componentPath})
fixture=fixture.replace('lyrics:[]','lyrics:Array.from({length:10},(_,j)=>({id:"line-"+j,timeSeconds:j*10,original:"Synthetic lyric "+j,translation:"Translation "+j}))')
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__selection_fixture.js"')
const browser=await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL||'msedge'})
const result={engine:browser.version(),cases:[]}
async function install(page,prevent){
 await page.evaluate(prevent=>{
  window.selectionTrace=[]
  const record=(event,phase='capture')=>{
   const element=event.target instanceof Element?event.target:event.target?.parentElement
   if(event.type==='dragstart'&&prevent&&element?.closest('.cover-frame,.cover-input-region'))event.preventDefault()
   const selection=getSelection()
   window.selectionTrace.push({type:event.type,phase,trusted:event.isTrusted,at:performance.now(),tag:element?.tagName??null,cover:Boolean(element?.closest('.cover-frame,.cover-input-region')),classes:element?.className&&typeof element.className==='string'?element.className.slice(0,120):null,pointerType:event.pointerType??null,buttons:event.buttons??null,defaultPrevented:event.defaultPrevented,selected:selection?.type==='Range',selectedLength:selection?.toString().length??0,types:event.dataTransfer?[...event.dataTransfer.types]:[]})
  }
  for(const type of ['dragstart','dragend','selectstart','selectionchange','pointercancel','pointerdown','pointerup','lostpointercapture'])document.addEventListener(type,record,true)
  document.addEventListener('dragstart',event=>record(event,'bubble'))
 },prevent)
}
const snapshot=page=>page.evaluate(()=>({trace:window.selectionTrace,commits:window.coverCommits?.length??0,selection:{type:getSelection()?.type,length:getSelection()?.toString().length??0},active:[...document.querySelectorAll('.track-card-plane[data-track-card-phase="active"] .title-pill')].map(node=>node.textContent)}))
async function mouseDrag(page,from,to){await page.mouse.move(from.x,from.y);await page.mouse.down();await page.waitForTimeout(80);await page.mouse.move(to.x,to.y,{steps:8});await page.waitForTimeout(120);await page.mouse.up();await page.waitForTimeout(220)}
async function coverDrag(page,direction=1){const box=await page.locator('.cover-input-region').boundingBox();assert(box);const from={x:box.x+box.width*(direction>0?.8:.2),y:box.y+box.height*.35};await mouseDrag(page,from,{x:from.x-direction*box.width*.65,y:from.y})}
async function open(page,prevent){
 await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surfaceSource}))
 await page.route('**/__selection_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
 await page.route('**/__selection_surface',route=>route.fulfill({contentType:'text/html',body:html}))
 await page.goto(origin+'/__selection_surface')
 await page.locator('.track-card-plane[data-track-card-phase="active"] .cover-frame').waitFor()
 await page.evaluate(()=>document.fonts.ready)
 await page.waitForTimeout(400)
 await install(page,prevent)
}
try{
 const canary=await browser.newPage({viewport:{width:1000,height:700}})
 await canary.route('**/__selection_canary',route=>route.fulfill({contentType:'text/html',body:'<p id="text" style="margin:80px;width:800px;font-size:30px">Selected text canary for native browser drag and drop</p>'}))
 await canary.goto(origin+'/__selection_canary');await install(canary,false)
 const point=await canary.evaluate(()=>{const node=document.getElementById('text');const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);const b=range.getBoundingClientRect();return {x:b.x+30,y:b.y+b.height*.4}})
 await mouseDrag(canary,point,{x:point.x+250,y:point.y+100})
 result.canary=await snapshot(canary);await canary.close()
 console.log('SELECTION_CANARY',JSON.stringify({dragstart:result.canary.trace.filter(event=>event.type==='dragstart'),cancel:result.canary.trace.filter(event=>event.type==='pointercancel')}))
 for(const mode of ['range-cover-title','range-cover-lyrics','mouse-cover-outside'])for(const prevent of [false,true]){
  if(process.env.SPMUSIC_SELECTION_EXPECT_FIXED==='1'&&(mode!=='range-cover-lyrics'||prevent))continue
  const page=await browser.newPage({viewport:{width:1600,height:1100},reducedMotion:'reduce'})
  const errors=[];page.on('pageerror',error=>errors.push(error.name))
  try{
   await open(page,prevent)
   const item={mode,prevent,errors}
   if(mode.startsWith('range')){
    item.selected=await page.evaluate(mode=>{
     const cover=document.querySelector('.track-card-plane[data-track-card-phase="active"] .cover-frame')
     const other=mode==='range-cover-title'?document.querySelector('.track-card-plane[data-track-card-phase="active"] .title-pill'):document.querySelector('.lyrics-panel li')
     if(!cover||!other)throw Error('selection endpoints must exist')
     const first=cover.compareDocumentPosition(other)&Node.DOCUMENT_POSITION_FOLLOWING?cover:other,last=first===cover?other:cover
     const range=document.createRange();range.setStartBefore(first);range.setEndAfter(last)
     const selection=getSelection();selection.removeAllRanges();selection.addRange(range)
     return {type:selection.type,length:selection.toString().length,containsCover:selection.containsNode(cover,true),containsOther:selection.containsNode(other,true),order:cover.compareDocumentPosition(other),rangeCollapsed:range.collapsed,selectionCollapsed:selection.isCollapsed,start:range.startContainer.nodeName,end:range.endContainer.nodeName}
    },mode)
    console.log('SURFACE_SELECTION_RANGE',JSON.stringify({mode,prevent,...item.selected}))
    item.before=await snapshot(page)
    await coverDrag(page)
   }else{
    const cover=await page.locator('.cover-input-region').boundingBox(),lyric=await page.locator('.lyrics-panel li').first().boundingBox()
    assert(cover&&lyric)
    await mouseDrag(page,{x:cover.x+cover.width*.8,y:cover.y+cover.height*.35},{x:lyric.x+lyric.width*.7,y:lyric.y+lyric.height*.5})
    item.afterOutside=await snapshot(page)
    await coverDrag(page)
   }
   item.afterFirst=await snapshot(page)
   await coverDrag(page);item.afterNext=await snapshot(page)
   if(mode==='range-cover-lyrics'){
    await coverDrag(page,-1);item.afterReverse=await snapshot(page)
    const box=await page.locator('.cover-input-region').boundingBox()
    await page.mouse.move(box.x+box.width*.5,box.y+box.height*.35);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up()
    item.moreOpened=await page.locator('.more-actions-menu').isVisible().catch(()=>false)
    if(item.moreOpened){await page.keyboard.press('Escape');await page.locator('.more-actions-menu').waitFor({state:'hidden'})}
    await coverDrag(page);item.afterMore=await snapshot(page)
   }
   result.cases.push(item)
   const final=item.afterMore??item.afterNext
   console.log('SURFACE_SELECTION_CASE',JSON.stringify({mode,prevent,selection:item.selected??item.afterOutside.selection,dragStarts:final.trace.filter(event=>event.type==='dragstart'),cancels:final.trace.filter(event=>event.type==='pointercancel'),commits:final.commits,afterFirst:item.afterFirst.commits,afterNext:item.afterNext.commits,afterReverse:item.afterReverse?.commits,moreOpened:item.moreOpened,errors}))
   assert.deepEqual(errors,[])
   if(process.env.SPMUSIC_SELECTION_EXPECT_FIXED==='1'){
    assert(result.canary.trace.some(event=>event.type==='dragstart'&&event.trusted),'the platform must actually support native DnD')
    assert.equal(item.selected.type,'Range')
    assert(item.selected.length>0)
    assert.equal(item.afterFirst.commits,1)
    assert.equal(item.afterNext.commits,2,'a stopped drag must not turn the next drag into native selection DnD')
    assert.equal(item.afterReverse.commits,3,'reverse dragging remains usable with the same actual DOM Selection')
    assert.equal(item.moreOpened,true,'long press still opens More')
    assert.equal(item.afterMore.commits,4,'closing More preserves working cover dragging')
    assert.equal(final.trace.filter(event=>event.type==='pointercancel').length,0)
    const native=final.trace.filter(event=>event.type==='dragstart'&&event.phase==='bubble')
    assert(native.length>0&&native.every(event=>event.trusted&&event.defaultPrevented),'production cover handler cancels the trusted native default action')
   }
  }finally{await page.close()}
 }
 if(process.env.SPMUSIC_SELECTION_EXPECT_FIXED==='1'){
  const page=await browser.newPage({viewport:{width:1600,height:1100},reducedMotion:'reduce'})
  try{
   await open(page,false)
   const title=page.locator('.track-card-plane[data-track-card-phase="active"] .title-pill')
   // A test-only native draggable outside the protected cover region exercises
   // the scope guard with a trusted browser default action.
   await title.evaluate(node=>{node.draggable=true})
   const box=await title.boundingBox(),from={x:box.x+box.width*.5,y:box.y+box.height*.5}
   await mouseDrag(page,from,{x:from.x+100,y:from.y+60})
   result.outsideScope=await snapshot(page)
   const starts=result.outsideScope.trace.filter(event=>event.type==='dragstart'&&event.phase==='bubble')
   assert(starts.some(event=>event.trusted&&!event.cover&&!event.defaultPrevented),'native DnD outside the cover is not canceled by the cover guard')
   console.log('OUTSIDE_COVER_DND',JSON.stringify(starts))
  }finally{await page.close()}
 }
}finally{mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2));await browser.close()}
