// Real PlayerShell, pointer handlers and native IPC parsers; only native IO is a fixture.
// Start Vite and point SPMUSIC_PLAYWRIGHT at an existing Playwright installation.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{
  const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'))
  assert(match,'Vite dependency '+name)
  return match[1]
}
const shared=readFileSync(new URL('./allSongs.browser.test.mjs',import.meta.url),'utf8')
const literal=shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal,'reuse deterministic audio transport without running another suite')
let fixture=runInNewContext(literal[1],{dependency})
fixture=fixture.replace('React.createElement(PlayerShell)','React.createElement(PlayerWithToaster)')
fixture+=`
import {Toaster} from '/src/components/ui/sonner.tsx';
function PlayerWithToaster(){return React.createElement(React.Fragment,null,React.createElement(PlayerShell),React.createElement(Toaster,{position:'bottom-right'}))}
`
fixture=fixture.replace('const title=id=>names[id]??',"const title=id=>new URLSearchParams(location.search).has('long')?'很长歌曲名称 '.repeat(50):names[id]??")
  .replace("artist:'Artist '+row.id","artist:new URLSearchParams(location.search).has('long')?'Artist '.repeat(60):'Artist '+row.id")
const renderMarker="ReactDOM.createRoot(document.getElementById('root')).render("
fixture=fixture.replace(renderMarker,`
window.choice='a';window.playlistImport=true;window.persistedPlaylists=[playlist()];window.playlistImport=false;
window.summaryGate=new URLSearchParams(location.search).has('cold');
window.summaryError=new URLSearchParams(location.search).has('summaryError');
const nativeInvoke=window.backendInvoke;
window.backendInvoke=async(command,args)=>{
 if(command==='library_get_playlists')return window.persistedPlaylists;
 if(command==='library_get_folders')return {revision:0,roots:[{path:'/audio/a',selected:true,directoryRules:[]}]};
 if(command==='audio_probe_playlist_track_summaries'&&window.summaryError)throw {code:'UNREADABLE_FILE',message:'fixture metadata rejected',recoverable:true};
 return nativeInvoke(command,args);
};
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountPlayer=()=>root.unmount();root.render(`)
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const realSurface=await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()
const surface=`import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__long_press_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(Surface,props)}`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__long_press_fixture.js"')
const browser=await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL||'msedge'})
const active='.track-card-plane[data-track-card-phase="active"]'
let passed=0
async function open({cold=false,long=false,summaryError=false}={}){
  const page=await browser.newPage({viewport:{width:1600,height:1100},reducedMotion:'reduce',hasTouch:true})
  page.setDefaultTimeout(12000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}))
  await page.route('**/__long_press_surface.js',route=>route.fulfill({contentType:'text/javascript',body:realSurface}))
  await page.route('**/__long_press_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__long_press_test*',route=>route.fulfill({contentType:'text/html',body:html}))
  const query=new URLSearchParams({...cold?{cold:'1'}:{},...long?{long:'1'}:{},...summaryError?{summaryError:'1'}:{}})
  await page.goto(origin+'/__long_press_test'+(query.size?'?'+query:''))
  await page.waitForFunction(()=>window.vm?.playlist.library.items.some(item=>item.scope.includes('/lists/a.m3u8'))&&!window.vm.playlist.library.isPlaylistRestorePending)
  await page.evaluate(()=>window.vm.playlist.library.onPlay(window.vm.playlist.library.items.find(item=>item.scope.includes('/lists/a.m3u8')).scope))
  await page.waitForFunction(()=>window.vm.playback.track?.id==='a-0'&&!window.vm.playback.isSelectionPending&&!window.vm.playback.detailsPending)
  await page.locator(active+' .title-pill').filter({hasText:long?'很长歌曲名称':'A Song'}).waitFor()
  await page.evaluate(()=>document.fonts.ready)
  return {page,errors}
}
async function pointer(page,selector){
  const box=await page.locator(active+' '+selector).boundingBox()
  assert(box,selector+' geometry')
  const point={x:box.x+box.width*.5,y:box.y+box.height*.35}
  await page.mouse.move(point.x,point.y)
  await page.mouse.down()
  return point
}
async function hold(page){await page.waitForTimeout(650)}
async function assertPlayer(page){
  assert.equal(await page.evaluate(()=>window.vm.playlist.isOpen),false)
  assert.equal(await page.locator('.more-actions-menu').count(),0)
}
async function check(name,run,options){
  if(process.env.SPMUSIC_LONG_PRESS_FILTER&&!name.includes(process.env.SPMUSIC_LONG_PRESS_FILTER))return
  const context=await open(options)
  try{await run(context.page);assert.deepEqual(context.errors,[]);passed++;console.log('PASS',name)}
  finally{await context.page.close()}
}
try{
  await check('long labels remain inside their pills and viewport after button composition',async page=>{
    for(const [width,height] of [[2560,1440],[1600,1100],[900,720]]){
      await page.setViewportSize({width,height})
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      const metrics=await page.locator(active+' .track-pills').evaluate(node=>[...node.querySelectorAll('button.track-pill')].map(button=>{
        const text=button.querySelector('.ping-pong-text-viewport'),box=button.getBoundingClientRect(),inner=text.getBoundingClientRect()
        return {x:box.x,right:box.right,width:box.width,innerX:inner.x,innerRight:inner.right,overflow:getComputedStyle(text).overflowX,buttonOverflow:button.scrollWidth>button.clientWidth+1}
      }))
      assert.equal(metrics.length,2)
      for(const metric of metrics){
        assert(metric.x>=0&&metric.right<=width+1,JSON.stringify({width,height,metric}))
        assert(metric.innerX>=metric.x&&metric.innerRight<=metric.right+1,JSON.stringify(metric))
        assert(['hidden','clip'].includes(metric.overflow),JSON.stringify(metric))
        assert.equal(metric.buttonOverflow,false,JSON.stringify(metric))
      }
    }
  },{long:true})
  for(const selector of ['.cover-frame','.title-pill'])await check(selector+' long hold opens existing more without release navigation',async page=>{
    await pointer(page,selector)
    await hold(page)
    await page.locator('.more-actions-menu').waitFor()
    await page.mouse.up()
    assert.equal(await page.evaluate(()=>window.vm.playlist.isOpen),false,'long-press release cannot act as cover tap')
    assert.equal(await page.locator('.more-actions-menu').isVisible(),true)
    assert.match(await page.locator('.more-actions-menu .more-track-title').textContent(),/A Song/)
    await page.keyboard.press('Escape')
    await page.locator('.more-actions-menu').waitFor({state:'hidden'})
  })
  await check('trusted touch cover hold opens more and consumes compatibility release',async page=>{
    const box=await page.locator(active+' .cover-frame').boundingBox()
    const cdp=await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:box.x+box.width*.5,y:box.y+box.height*.35}]})
    await hold(page)
    await page.locator('.more-actions-menu').waitFor()
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    assert.equal(await page.evaluate(()=>window.vm.playlist.isOpen),false)
    assert.equal(await page.locator('.more-actions-menu').isVisible(),true)
  })
  await check('cover context shortcut and metadata keyboard actions remain accessible',async page=>{
    await page.locator(active+' .cover-collapse-button').focus()
    await page.keyboard.press('Shift+F10')
    await page.locator('.more-actions-menu').waitFor()
    await page.locator('.more-actions-menu').focus()
    await page.keyboard.press('Escape')
    await page.locator('.more-actions-menu').waitFor({state:'hidden'})
    await page.locator(active+' .title-pill').focus()
    await page.keyboard.press('Enter')
    await page.locator('.more-actions-menu').waitFor()
    await page.locator('.more-actions-menu').focus()
    await page.keyboard.press('Escape')
    await page.locator('.more-actions-menu').waitFor({state:'hidden'})
    await page.locator(active+' .artist-pill').focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(()=>window.vm.playlist.library.artistLocation?.view==='songs')
    await page.locator('.album-songs .playlist-card').filter({hasText:'A Song'}).waitFor()
  })
  await check('artist album label hold opens artist songs including current song',async page=>{
    await pointer(page,'.artist-pill')
    await hold(page)
    await page.mouse.up()
    await page.waitForFunction(()=>window.vm.playlist.isOpen&&window.vm.playlist.library.route.categoryId==='artist'&&window.vm.playlist.library.artistLocation?.view==='songs')
    assert.match(await page.evaluate(()=>window.vm.playlist.library.artistLocation.artistKey),/Artist a-0/)
    await page.locator('.album-songs .playlist-card').filter({hasText:'A Song'}).waitFor()
    assert.equal(await page.locator('.more-actions-menu').count(),0)
  })
  await check('cold library tags resolve artist songs and release never selects destination song',async page=>{
    const before=await page.evaluate(()=>window.calls.filter(call=>call.command==='audio_load_and_play').length)
    await pointer(page,'.artist-pill')
    await hold(page)
    await page.waitForFunction(()=>window.pendingSummaries.length>0)
    assert.equal(await page.evaluate(()=>window.vm.playlist.isOpen),false,'metadata request waits on the player')
    await page.evaluate(()=>{window.summaryGate=false;window.pendingSummaries.splice(0).forEach(resolve=>resolve())})
    await page.waitForFunction(()=>window.vm.playlist.library.artistLocation?.view==='songs')
    await page.mouse.up()
    await page.locator('.album-songs .playlist-card').filter({hasText:'A Song'}).waitFor()
    assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.command==='audio_load_and_play').length),before,'release click is consumed after navigation')
  },{cold:true})
  await check('cold artist request is cancelled when current track changes',async page=>{
    await pointer(page,'.artist-pill')
    await hold(page)
    await page.mouse.up()
    await page.evaluate(()=>window.vm.playback.onNext())
    await page.waitForFunction(()=>window.vm.playback.track?.id==='shared'&&!window.vm.playback.isSelectionPending)
    await page.evaluate(()=>{window.summaryGate=false;window.pendingSummaries.splice(0).forEach(resolve=>resolve())})
    await hold(page)
    await assertPlayer(page)
  },{cold:true})
  await check('cold artist request is cancelled when leaving the player',async page=>{
    await pointer(page,'.artist-pill')
    await hold(page)
    await page.mouse.up()
    await page.evaluate(()=>window.vm.playlist.onOpenChange(true))
    await page.evaluate(()=>{window.summaryGate=false;window.pendingSummaries.splice(0).forEach(resolve=>resolve())})
    await hold(page)
    const route=await page.evaluate(()=>({route:window.vm.playlist.library.route,artist:window.vm.playlist.library.artistLocation}))
    assert.equal(route.route.view,'tracks')
    assert.equal(route.artist,null)
  },{cold:true})
  await check('library metadata failure gives a visible error and a later hold retries',async page=>{
    await pointer(page,'.artist-pill')
    await hold(page)
    await page.mouse.up()
    await page.getByText(/无法读取.*艺术家|读取.*失败|艺术家.*重试/).first().waitFor()
    assert.equal(await page.evaluate(()=>window.vm.playlist.isOpen),false)
    await page.evaluate(()=>{window.summaryError=false})
    await pointer(page,'.artist-pill')
    await hold(page)
    await page.mouse.up()
    await page.waitForFunction(()=>window.vm.playlist.library.artistLocation?.view==='songs')
    await page.locator('.album-songs .playlist-card').filter({hasText:'A Song'}).waitFor()
  },{summaryError:true})
  await check('short cover tap still returns to playlist',async page=>{
    await pointer(page,'.cover-frame')
    await page.mouse.up()
    await page.waitForFunction(()=>window.vm.playlist.isOpen)
    assert.equal(await page.locator('.more-actions-menu').count(),0)
  })
  for(const selector of ['.title-pill','.artist-pill'])await check(selector+' short press and right button do not activate long actions',async page=>{
    await pointer(page,selector)
    await page.mouse.up()
    await hold(page)
    await assertPlayer(page)
    const box=await page.locator(active+' '+selector).boundingBox()
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
    await page.mouse.down({button:'right'})
    await hold(page)
    await page.mouse.up({button:'right'})
    await assertPlayer(page)
  })
  for(const selector of ['.cover-frame','.title-pill','.artist-pill'])await check(selector+' moved or cancelled press cannot fire later',async page=>{
    const point=await pointer(page,selector)
    await page.mouse.move(point.x,point.y+32)
    await hold(page)
    await page.mouse.up()
    await assertPlayer(page)
    await pointer(page,selector)
    await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,pointerType:'mouse',isPrimary:true,bubbles:true})))
    await hold(page)
    await page.mouse.up()
    await assertPlayer(page)
  })
  await check('second pointer or blur cancels a pending title hold',async page=>{
    await pointer(page,'.title-pill')
    await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerdown',{pointerId:2,pointerType:'touch',isPrimary:false,button:0,buttons:1,bubbles:true})))
    await hold(page)
    await page.mouse.up()
    await assertPlayer(page)
    await pointer(page,'.title-pill')
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')))
    await hold(page)
    await page.mouse.up()
    await assertPlayer(page)
  })
  for(const selector of ['.cover-frame','.title-pill','.artist-pill'])await check(selector+' pending hold is cancelled on track change and unmount',async page=>{
    await pointer(page,selector)
    await page.evaluate(()=>window.vm.playback.onNext())
    await page.waitForFunction(()=>window.vm.playback.track?.id==='shared'&&!window.vm.playback.isSelectionPending)
    await hold(page)
    await page.mouse.up()
    await assertPlayer(page)
    await page.locator(active+' .title-pill').filter({hasText:'Shared Song'}).waitFor()
    await pointer(page,selector)
    await page.evaluate(()=>window.unmountPlayer())
    await hold(page)
    await page.mouse.up()
    assert.equal(await page.locator('.more-actions-menu').count(),0)
    assert.equal(await page.locator('.player-shell').count(),0)
  })
}finally{await browser.close()}
console.log(JSON.stringify({passed}))
