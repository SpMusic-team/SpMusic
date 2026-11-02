// Opt-in A/B of real native WebView list entry. No IPC or library data is mocked.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {resolve,extname,sep} from 'node:path'

const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const endpoint=process.env.SPMUSIC_NATIVE_CDP
assert(endpoint,'explicit native endpoint required')
const browser=await chromium.connectOverCDP(endpoint)
const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().startsWith('http://tauri.localhost/'))
assert.equal(pages.length,1)
const page=pages[0],dist=resolve('dist'),output=resolve('.codex-tmp-folder-ui-dist/drag-diagnostics-20261101/list-window-native-ab.json')
const result={engine:browser.version(),variants:[],errors:[]}
page.on('pageerror',error=>result.errors.push(error.name+': '+error.message.slice(0,100)))
page.setDefaultTimeout(15000)
const snapshot=()=>page.evaluate(()=>{
 const panel=document.querySelector('.playlist-panel'),grid=panel?.querySelector('.playlist-grid')
 if(!panel||!grid)return null
 const bounds=panel.getBoundingClientRect(),cards=[...grid.children]
 const visible=cards.filter(c=>{const r=c.getBoundingClientRect();return r.bottom>bounds.top&&r.top<bounds.bottom&&r.right>bounds.left&&r.left<bounds.right})
 const current=grid.querySelector('[data-current="true"]'),r=current?.getBoundingClientRect()
 return {total:cards.length,content:cards.filter(c=>c.dataset.contentVisible==='true').length,visible:visible.length,missingText:visible.filter(c=>!c.querySelector('.playlist-card-title')?.textContent?.trim()).length,readyCover:visible.filter(c=>c.querySelector('canvas')||[...c.querySelectorAll('img')].some(i=>i.complete&&i.naturalWidth)).length,scrollTop:panel.scrollTop,scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight,level:grid.dataset.layoutLevel,flow:grid.dataset.layoutFlow,window:grid.dataset.contentWindow,currentOffset:r?(r.top+r.bottom)/2-(bounds.top+bounds.bottom)/2:null,currentContent:current?.dataset.contentVisible??null,selected:cards.filter(c=>c.getAttribute('aria-pressed')==='true').length}
})
const open=async()=>{
 await page.locator('.window-bar').getByRole('button',{name:'播放列表',exact:true}).click()
 await page.locator('.playlist-library-list-scroll button').waitFor()
 assert.equal(await page.locator('.playlist-library-list-scroll button').count(),1,'one existing playlist')
 await page.locator('.playlist-library-list-scroll button').click()
 await page.waitForFunction(()=>{const p=document.querySelector('.playlist-panel');return p?.querySelectorAll('.playlist-card').length>100&&!p.hasAttribute('data-metadata-loading')})
 await page.waitForFunction(()=>{
  const p=document.querySelector('.playlist-panel'),b=p?.getBoundingClientRect();if(!p||!b)return false
  const v=[...p.querySelectorAll('.playlist-card')].filter(c=>{const r=c.getBoundingClientRect();return r.bottom>b.top&&r.top<b.bottom})
  return v.length>0&&v.every(c=>c.querySelector('.playlist-card-title')?.textContent?.trim())
 })
}
const close=async()=>{
 await page.getByRole('button',{name:'打开播放界面',exact:true}).click()
 await page.waitForFunction(()=>!document.querySelector('.playlist-panel'))
}
const assets=async route=>{
 const url=new URL(route.request().url()),relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\//,'')
 const path=resolve(dist,relative)
 assert(path.startsWith(dist+sep),'candidate route must remain inside dist')
 if(!existsSync(path))return route.continue()
 const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}
 return route.fulfill({body:readFileSync(path),contentType:types[extname(path)]||'application/octet-stream'})
}
try{
 assert(await page.evaluate(()=>Boolean(window.__TAURI_INTERNALS__?.invoke)),'real native IPC remains available')
 for(const name of ['baseline','candidate','baseline-return']){
  await page.unroute('http://tauri.localhost/**',assets)
  if(name==='candidate')await page.route('http://tauri.localhost/**',assets)
  await page.reload()
  await page.locator('.window-bar').getByRole('button',{name:'播放列表',exact:true}).waitFor()
  await page.waitForFunction(()=>Boolean(document.querySelector('.cover-input-region')))
  await page.waitForTimeout(1000)
  const variant={name,script:await page.evaluate(()=>[...document.scripts].find(s=>s.src.includes('/assets/app-'))?.src.split('/').pop()),entries:[],regressions:[]}
  result.variants.push(variant)
  // Warm the actual native summary/duration/artwork caches before equal-input samples.
  await page.locator('.window-bar').getByRole('button',{name:'播放列表',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.playlist-panel')||document.querySelector('.playlist-library-list-scroll button'))
  if(!await page.locator('.playlist-panel').count()){
   assert.equal(await page.locator('.playlist-library-list-scroll button').count(),1,'select only the existing unique library playlist')
   await page.locator('.playlist-library-list-scroll button').click()
  }
  await page.waitForFunction(()=>{const p=document.querySelector('.playlist-panel');return p?.querySelectorAll('.playlist-card').length===1798&&!p.hasAttribute('data-metadata-loading')})
  variant.warmup=await snapshot();await page.waitForTimeout(700);await close()
  for(let index=0;index<3;index++){
   await page.evaluate(()=>{
    window.__nativeListTiming={start:null,longTasks:[]}
    window.__nativeListTiming.observer=new PerformanceObserver(list=>window.__nativeListTiming.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration}))))
    window.__nativeListTiming.observer.observe({type:'longtask'})
    const listener=e=>{if(e.target.closest?.('.playlist-library-list-scroll button')){window.__nativeListTiming.start=performance.now();document.removeEventListener('click',listener,true)}}
    document.addEventListener('click',listener,true)
   })
   await open()
   const state=await snapshot()
   const timing=await page.evaluate(()=>{const x=window.__nativeListTiming;x.observer.disconnect();return {ms:performance.now()-x.start,longTasks:x.longTasks.filter(t=>t.start>=x.start).map(t=>t.ms)}})
   assert.equal(state.missingText,0)
   assert.equal(state.total,1798)
   variant.entries.push({index,...timing,state})
   console.log('NATIVE_LIST_AB',JSON.stringify({name,index,...timing,state}))
   await close()
  }
  if(name==='candidate'){
   await open()
   const initial=await snapshot();variant.regressions.push({phase:'entry',state:initial})
   for(const ratio of [.95,.05,.75,1,0]){
    await page.locator('.playlist-panel').evaluate((p,ratio)=>p.scrollTop=(p.scrollHeight-p.clientHeight)*ratio,ratio)
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    const state=await snapshot();variant.regressions.push({phase:'scroll',ratio,state});assert.equal(state.missingText,0,'scrolled viewport text must mount')
   }
   const focus=await page.locator('.playlist-card').nth(1200).evaluate(c=>{c.focus();return c.dataset.playlistTrackId})
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
   variant.focus=await page.evaluate(id=>{const c=[...document.querySelectorAll('.playlist-card')].find(c=>c.dataset.playlistTrackId===id);return {focused:document.activeElement===c,content:c?.dataset.contentVisible,hasText:Boolean(c?.querySelector('.playlist-card-title')?.textContent)}},focus)
   assert.deepEqual(variant.focus,{focused:true,content:'true',hasText:true})
   await page.locator('.playlist-panel').evaluate(p=>p.scrollTop=0)
   await page.waitForTimeout(150)
   await close()
  }
  mkdirSync(resolve('.codex-tmp-folder-ui-dist/drag-diagnostics-20261101'),{recursive:true})
  writeFileSync(output,JSON.stringify(result,null,2))
 }
 assert.deepEqual(result.errors,[])
}finally{
 await page.unroute('http://tauri.localhost/**',assets)
 writeFileSync(output,JSON.stringify(result,null,2))
}
// Disconnect client without closing the native host.
process.exit(0)
