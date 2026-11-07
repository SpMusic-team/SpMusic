// Real playlist geometry and its existing artwork-demand callback. This checks
// admission order, not asynchronous decode/paint completion or a timed stagger.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const panel=await(await fetch(origin+'/src/features/player/components/PlaylistPanel.tsx')).text()
const dependency=name=>{
  const match=(entry+panel).match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'))
  assert(match,'resolve '+name)
  return match[1]
}
const shared=readFileSync(new URL('./playlistOverscrollPerformance.browser.test.mjs',import.meta.url),'utf8')
const literal=shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal,'reuse actual PlaylistPanel fixture')
const fixture=runInNewContext(literal[1],{dependency,panelPath:'/src/features/player/components/PlaylistPanel.tsx'})
  .replace('onVisibleTrackIdsChange:()=>window.demands++',"onVisibleTrackIdsChange:(ids,_keep,artwork,demand)=>{window.demands++;window.lastDemand={ids,artwork,demand,scrollTop:document.querySelector('.playlist-panel')?.scrollTop}}")
assert(fixture.includes('window.lastDemand='),'observe the real geometry demand without replacing its implementation')
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__direction_fixture.js"')
const browser=await chromium.launch({headless:true,channel:'msedge'})
async function compare(page,direction){
  const handle=await page.waitForFunction(direction=>{
    const panel=document.querySelector('.playlist-panel'),grid=document.querySelector('.playlist-grid'),bounds=panel.getBoundingClientRect()
    const bottom=bounds.bottom
    const actual=window.lastDemand?.demand?.visibleIds
    if(!actual?.length)return false
    // The existing viewport policy owns membership. Independently verify the
    // direction of its selected real rows rather than requiring every DOM
    // intersection to belong to that policy in the same animation frame.
    const selected=new Set(actual)
    const entries=[...grid.querySelectorAll('[data-playlist-track-id]')].map((node,index)=>({id:node.dataset.playlistTrackId,index,rect:node.getBoundingClientRect()}))
      .filter(entry=>selected.has(entry.id))
    if(entries.length!==actual.length)return false
    const expected=[...entries].sort((a,b)=>Math.abs(a.rect.top-b.rect.top)>1
      ? direction<0?b.rect.top-a.rect.top:a.rect.top-b.rect.top:a.index-b.index).map(entry=>entry.id)
    return {direction,expected,actual,rows:new Set(entries.map(entry=>Math.round(entry.rect.top))).size,
      columns:Number(grid.dataset.layoutColumns),tracks:entries.length,scrollTop:panel.scrollTop,
      selectedRowsIntersectViewport:entries.every(entry=>entry.rect.bottom>bounds.top-1&&entry.rect.top<bottom+1)}
  },direction)
  const evidence=await handle.jsonValue()
  assert(evidence.rows>=2,'fixture displays multiple rows so the direction assertion cannot pass trivially')
  assert(evidence.selectedRowsIntersectViewport,'reported visible rows really intersect the viewport')
  assert.deepEqual(evidence.actual,evidence.expected,JSON.stringify(evidence))
  return evidence
}
async function scroll(page,target){
  const actual=await page.evaluate(target=>{const panel=document.querySelector('.playlist-panel');panel.scrollTop=target;return panel.scrollTop},target)
  await page.waitForFunction(top=>Math.abs((window.lastDemand?.scrollTop??-1)-top)<.1,actual)
}
try{
  for(const level of [0,2,5]){
    const page=await browser.newPage({viewport:{width:1600,height:1100},reducedMotion:'reduce'})
    page.setDefaultTimeout(8000)
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.addInitScript(level=>localStorage.setItem('spmusic.playlist.layout-level.v1',String(level)),level)
    await page.route('**/__direction_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
    await page.route('**/__direction_test?*',route=>route.fulfill({contentType:'text/html',body:html}))
    try{
      await page.goto(origin+'/__direction_test?count=200')
      await page.waitForFunction(()=>window.lastDemand?.demand?.visibleIds.length>1)
      await page.evaluate(()=>document.fonts.ready)
      const seed=await page.evaluate(()=>{const panel=document.querySelector('.playlist-panel');return Math.floor((panel.scrollHeight-panel.clientHeight)*.42)})
      await scroll(page,seed)
      const forward=await compare(page,1)
      // Reversals inside the same geometric window must republish the order,
      // even when the visible membership itself has not changed.
      await scroll(page,seed-1)
      const backward=await compare(page,-1)
      await scroll(page,seed)
      await compare(page,1)
      await scroll(page,seed-230)
      await compare(page,-1)
      assert.deepEqual(errors,[])
      console.log('PASS','playlist artwork row order',JSON.stringify({level,forward:forward.actual,backward:backward.actual,rows:forward.rows}))
    }finally{await page.close()}
  }
}finally{await browser.close()}
