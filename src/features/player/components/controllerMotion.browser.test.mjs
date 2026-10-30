// Real PlayerSurface/settings/panel/dock with deterministic parent data.
// Start Vite; SPMUSIC_PLAYWRIGHT points to an existing Playwright installation.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const key = 'spmusic.player.playlist-controller-mode.v1'
const entry = await (await fetch(origin+'/src/main.tsx')).text()
const dependency = name => {
  const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'))
  assert(match,'Vite dependency '+name)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
import {PlayerSurface} from '/src/features/player/components/PlayerSurface.tsx';import '/src/index.css';
const noop=()=>{},tracks=Array.from({length:100},(_,i)=>({id:'song-'+i,title:'Song '+i,artist:'Artist',album:'Album',durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:false}));
window.calls=[];
function Fixture(){
 const appearance=useAppearance();window.setMotionOff=()=>appearance.previewAppearance({...appearance.appearance,motion:{...appearance.appearance.motion,level:'off'}});
 const [open,setOpen]=React.useState(true),[interaction,setInteraction]=React.useState('following'),[position,setPosition]=React.useState(45);
 window.setInteraction=setInteraction;
 const currentTrackId=new URLSearchParams(location.search).has('far')?'song-60':'song-0';
 const viewModel={playback:{track:tracks[0],contentState:'track',isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:async r=>{window.calls.push('toggle');return {requestId:r.requestId,completed:true}},onShuffleCycle:noop,onRepeatCycle:noop},
 timeline:{positionSeconds:position,durationSeconds:180,interaction,onPreviewStart:()=>setInteraction('previewing'),onPreview:setPosition,onCommit:p=>{setPosition(p);setInteraction('following')},onCancelPreview:()=>setInteraction('following')},
 volume:{valuePercent:50,isBusy:false,isDisabled:false,onChange:noop},queue:{tracks,isOpen:false,onToggle:noop},
 playlist:{isOpen:open,onOpenChange:setOpen,tracks,playlistName:'Moving controller',currentTrackId,shuffleMode:'none',onShuffleCycle:noop,onOpenAudio:noop,onTrackSelect:id=>window.calls.push(id)},feedback:{onToggle:noop}};
 return React.createElement(PlayerSurface,{viewModel});
}
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();
root.render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(Fixture))));
`
const html=(await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__controller_motion_fixture.js"')
const browser=await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL||'msedge',args:['--disable-features=LocalNetworkAccessChecks']})
const screenshots=process.env.SPMUSIC_SCREENSHOT_DIR||join(tmpdir(),'spmusic-controller-movable')
mkdirSync(screenshots,{recursive:true})
let passed=0

async function open({mode,far=false,reduced=false}={}){
  const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:reduced?'reduce':'no-preference'})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(({key,mode})=>{
    localStorage.setItem('spmusic.playlist.layout-level.v1','7')
    if(mode!==undefined)localStorage.setItem(key,mode)
  },{key,mode})
  if(process.env.SPMUSIC_CONTROLLER_ATTACH_DIAGNOSTIC==='1'){
    const hook=await(await fetch(origin+'/src/features/player/hooks/usePlaylistControllerMotion.ts')).text()
    const diagnosticHook=hook.replace(/if \(!enabled \|\| !panel \|\| !dock\) return;?/, 'window.controllerAttachTrace??=[];window.controllerAttachTrace.push({enabled,panel:Boolean(panel),dock:Boolean(dock),time:performance.now()});if (!enabled || !panel || !dock) return;')
    assert(diagnosticHook!==hook,'diagnostic observes the existing hook attachment boundary')
    await page.route('**/src/features/player/hooks/usePlaylistControllerMotion.ts*',route=>route.fulfill({contentType:'text/javascript',body:diagnosticHook}))
  }
  await page.route('**/__controller_motion_fixture.js',r=>r.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__controller_motion_test*',r=>r.fulfill({contentType:'text/html',body:html}))
  await page.goto(origin+'/__controller_motion_test'+(far?'?far=1':''))
  await page.locator('.playlist-playback-dock').waitFor()
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.playlist-panel')).transform==='none')
  return {page,errors}
}
async function check(name,run,options){
  if(process.env.SPMUSIC_TEST_FILTER&&!name.includes(process.env.SPMUSIC_TEST_FILTER))return
  const {page,errors}=await open(options)
  try{await run(page);assert.deepEqual(errors,[]);if(process.env.SPMUSIC_CONTROLLER_ATTACH_DIAGNOSTIC==='1')console.log('ATTACH_TRACE',JSON.stringify(await page.evaluate(()=>window.controllerAttachTrace)));console.log('PASS',name);passed++}
  catch(error){await page.screenshot({path:join(screenshots,'failure.png')});console.log('FAIL_STATE',await snapshot(page));if(process.env.SPMUSIC_CONTROLLER_ATTACH_DIAGNOSTIC==='1')console.log('ATTACH_TRACE',JSON.stringify(await page.evaluate(()=>window.controllerAttachTrace)));throw error}
  finally{await page.close()}
}
const snapshot=page=>page.evaluate(()=>{
  const panel=document.querySelector('.playlist-panel'),dock=document.querySelector('.playlist-playback-dock'),row=document.querySelector('.playlist-controller-actions')
  const d=dock.getBoundingClientRect(),r=row.getBoundingClientRect(),s=getComputedStyle(dock),rs=getComputedStyle(row)
  const bottom=parseFloat(s.bottom),travel=dock.offsetHeight+bottom
  return {top:panel.scrollTop,maxTop:panel.scrollHeight-panel.clientHeight,offset:d.top-(innerHeight-travel),travel,rowOffset:r.top-(innerHeight-parseFloat(rs.bottom)-row.offsetHeight),gap:d.top-r.bottom,opacity:Number(s.opacity),inert:dock.inert,focused:document.activeElement?.className,mode:localStorage.getItem('spmusic.player.playlist-controller-mode.v1')}
})
async function expectOffset(page,value,expectedGap=12){
  await page.waitForFunction(expected=>{
    const dock=document.querySelector('.playlist-playback-dock'),s=getComputedStyle(dock)
    return Math.abs(dock.getBoundingClientRect().top-(innerHeight-dock.offsetHeight-parseFloat(s.bottom))-expected)<0.5
  },value)
  const s=await snapshot(page)
  assert(Math.abs(s.offset-s.rowOffset)<0.5,'dock and compact actions share vertical displacement')
  assert(Math.abs(s.gap-expectedGap)<0.5,'baseline spacing is preserved during shared motion')
  assert.equal(s.opacity,1,'scrolling never fades the dock')
  return s
}
async function wheel(page,delta){
  const before=await snapshot(page),rect=await page.locator('.playlist-panel').boundingBox()
  await page.mouse.move(rect.x+rect.width-16,Math.min(rect.y+180,700))
  await page.mouse.wheel(0,delta)
  const canMove=delta>0?before.top<before.maxTop:before.top>0
  if(canMove)await page.waitForFunction(top=>document.querySelector('.playlist-panel').scrollTop!==top,before.top)
  await page.evaluate(async()=>{
    let previous=document.querySelector('.playlist-panel').scrollTop,stable=0
    for(let i=0;i<60;i++){
      await new Promise(resolve=>requestAnimationFrame(resolve))
      const top=document.querySelector('.playlist-panel').scrollTop
      stable=top===previous?stable+1:0;previous=top
      if(stable>=3)return
    }
    throw new Error('wheel scrolling did not settle')
  })
  const after=await snapshot(page)
  return {before,after,delta:after.top-before.top}
}
async function settings(page){
  await page.getByRole('button',{name:'设置',exact:true}).click()
  await page.getByRole('dialog',{name:'设置',exact:true}).waitFor()
}
// The settings control is resolved through its visible label, as a user would.
async function chooseMode(page,mode){
  await settings(page)
  await page.getByRole('combobox',{name:'播放控制器'}).click()
  await page.getByRole('option',{name:mode==='fixed'?'固定':'可移动',exact:true}).click()
  await page.getByRole('listbox').waitFor({state:'hidden'})
  await page.screenshot({path:join(screenshots,'settings-'+mode+'.png')})
  await page.keyboard.press('Escape')
  await page.getByRole('dialog',{name:'设置',exact:true}).waitFor({state:'hidden'})
}

try{
  await check('hero exit overlaps button fade and shared downward controller motion',async page=>{
    await expectOffset(page,0)
    await page.evaluate(()=>{
      window.overlapFrames=[];window.captureOverlap=true
      function capture(time){
        const panel=document.querySelector('.playlist-panel'),hero=document.querySelector('.playlist-hero-copy .playlist-hero-actions'),dock=document.querySelector('.playlist-playback-dock'),row=document.querySelector('.playlist-controller-actions')
        const d=dock.getBoundingClientRect(),r=row.getBoundingClientRect(),ds=getComputedStyle(dock),rs=getComputedStyle(row),travel=dock.offsetHeight+parseFloat(ds.bottom)
        window.overlapFrames.push({time,scrollTop:panel.scrollTop,heroAbove:hero.getBoundingClientRect().bottom<=panel.getBoundingClientRect().top,travel,dockY:d.top-(innerHeight-travel),actionsY:r.top-(innerHeight-parseFloat(rs.bottom)-row.offsetHeight),actionsOpacity:Number(rs.opacity)})
        if(window.captureOverlap)requestAnimationFrame(capture)
      }
      window.restartControllerCapture=()=>{window.overlapFrames=[];window.captureOverlap=true;requestAnimationFrame(capture)}
      requestAnimationFrame(capture)
    })
    await wheel(page,400)
    // More downward input during the entry must not restart the Y animation.
    await wheel(page,15)
    await wheel(page,15)
    await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.playlist-controller-actions')).opacity)>=0.999)
    const frames=await page.evaluate(()=>{window.captureOverlap=false;return window.overlapFrames})
    writeFileSync(join(screenshots,'controller-overlap-samples.json'),JSON.stringify(frames,null,2))
    const overlap=frames.filter(f=>f.heroAbove&&f.dockY>1&&f.dockY<f.travel-1&&f.actionsOpacity>0.01&&f.actionsOpacity<0.99&&Math.abs(f.dockY-f.actionsY)<0.5)
    console.log('OVERLAP_EVIDENCE',JSON.stringify({frames:frames.length,overlapFrames:overlap.length,firstFade:frames.find(f=>f.actionsOpacity>0.01),last:frames.at(-1),samples:join(screenshots,'controller-overlap-samples.json')}))
    assert(overlap.length>0,'hero exit must overlap a partial button fade with partial shared downward motion')
    assert(frames.some(f=>f.time>overlap[0].time&&f.dockY>overlap[0].dockY+1&&Math.abs(f.dockY-f.actionsY)<0.5),'dock and buttons continue downward together after fade begins')
    assert(Math.abs(frames.find(f=>f.actionsOpacity>=0.999).dockY-frames[0].travel)<1,'repeated same-direction scrolling does not restart Y behind the original fade')
    await expectOffset(page,(await snapshot(page)).travel)
    await page.evaluate(()=>window.restartControllerCapture())
    await wheel(page,-15)
    const returning=await snapshot(page)
    assert(returning.offset>1&&returning.offset<returning.travel-1,'upward input starts an observable return transition')
    await wheel(page,15)
    await expectOffset(page,returning.travel)
    const reversal=await page.evaluate(()=>{window.captureOverlap=false;return window.overlapFrames})
    assert(reversal.some(f=>f.dockY<returning.travel-10),'interrupted return has painted intermediate positions')
    assert(reversal.every(f=>Math.abs(f.dockY-f.actionsY)<0.5&&f.actionsOpacity>0.99),'reversal keeps visible buttons on the same Y trajectory')
    console.log('REVERSAL_EVIDENCE',JSON.stringify({frames:reversal.length,minimumY:Math.min(...reversal.map(f=>f.dockY)),finalY:reversal.at(-1).dockY}))
  })
  await check('default mode, real settings switch and persisted reload',async page=>{
    await expectOffset(page,0)
    await wheel(page,35)
    await expectOffset(page,0)
    await wheel(page,400)
    await expectOffset(page,(await snapshot(page)).travel)
    await chooseMode(page,'fixed')
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'fixed')
    await page.reload()
    await page.locator('.playlist-playback-dock').waitFor()
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'fixed')
    await wheel(page,100)
    await expectOffset(page,0)
    await chooseMode(page,'movable')
    await expectOffset(page,0)
    await wheel(page,400)
    await expectOffset(page,(await snapshot(page)).travel)
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'movable')
  })
  await check('hero-gated movement, direction reversal and edge overscroll',async page=>{
    await expectOffset(page,0)
    for(const [delta,hidden] of [[60,false],[40,false],[-20,false],[500,true],[-30,false],[15,true]]){
      await wheel(page,delta)
      await expectOffset(page,hidden?(await snapshot(page)).travel:0)
    }
    await wheel(page,10000)
    const bottom=await snapshot(page)
    await expectOffset(page,bottom.travel)
    assert.equal(bottom.top,bottom.maxTop)
    const overscroll=await wheel(page,500)
    assert.equal(overscroll.delta,0)
    await expectOffset(page,bottom.travel)
    await wheel(page,-10000)
    await expectOffset(page,0)
    await page.screenshot({path:join(screenshots,'movable-top.png')})
  },{reduced:true})
  await check('current-song baseline, search reveal, measured resize and 320px layout',async page=>{
    const initial=await expectOffset(page,0)
    assert(initial.top>500,'opening the current song establishes a scrolled baseline')
    await wheel(page,45)
    await expectOffset(page,(await snapshot(page)).travel)
    await page.keyboard.press('Control+f')
    await page.waitForFunction(()=>document.activeElement===document.querySelector('.playlist-filter-input'))
    await expectOffset(page,0)
    assert.equal((await snapshot(page)).top,0)
    await page.locator('.playlist-filter-input').press('Escape')
    await wheel(page,600)
    const hidden=await snapshot(page)
    await expectOffset(page,hidden.travel)
    await page.locator('.playlist-playback-dock').evaluate(el=>el.style.height='160px')
    // This artificial 40px dock-height reduction also moves its CSS baseline
    // 40px down. Verify the measured limit independently of that layout change.
    await expectOffset(page,184,52)
    await page.locator('.playlist-playback-dock').evaluate(el=>el.style.height='200px')
    await page.setViewportSize({width:320,height:800})
    await expectOffset(page,184)
    const rects=await page.locator('.playlist-controller-actions button').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return {x:r.x,right:r.right}}))
    rects.forEach((r,i)=>{assert(r.x>=0&&r.right<=320);if(i)assert(r.x>=rects[i-1].right)})
    await page.screenshot({path:join(screenshots,'movable-320.png')})
  },{far:true,reduced:true})
  await check('pointer drag, seeking, mouse focus and keyboard focus retention',async page=>{
    await wheel(page,60)
    const before=await snapshot(page)
    const thumb=page.locator('.playlist-playback-progress [data-slot="slider-thumb"]').first(),rect=await thumb.boundingBox()
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2)
    await page.mouse.down()
    await wheel(page,400)
    await expectOffset(page,before.offset)
    await page.mouse.up()
    await expectOffset(page,before.offset)
    await wheel(page,20)
    await expectOffset(page,(await snapshot(page)).travel)
    await wheel(page,-20)
    await expectOffset(page,0)
    await page.evaluate(()=>window.setInteraction('seeking'))
    const seeking=await snapshot(page)
    await wheel(page,40)
    await expectOffset(page,seeking.offset)
    await page.evaluate(()=>window.setInteraction('following'))
    await wheel(page,15)
    await expectOffset(page,(await snapshot(page)).travel)
    await wheel(page,-20)
    await expectOffset(page,0)
    await page.locator('.playlist-playback-toggle').click()
    await wheel(page,15)
    await expectOffset(page,(await snapshot(page)).travel)
    await wheel(page,-20)
    await expectOffset(page,0)
    await page.keyboard.press('Tab')
    await page.locator('.playlist-playback-track-button').focus()
    await expectOffset(page,0)
    await wheel(page,40)
    await expectOffset(page,0)
    await page.locator('.playlist-panel').focus()
    await wheel(page,20)
    await expectOffset(page,(await snapshot(page)).travel)
  },{reduced:true})
  await check('hover tooltip cleanup, hidden focus and motion-off movement',async page=>{
    await expectOffset(page,0)
    await page.locator('.playlist-panel').focus()
    await page.getByRole('button',{name:'打开播放界面',exact:true}).hover()
    await page.locator('[data-slot="tooltip-content"]').waitFor()
    await page.keyboard.press('PageDown')
    const travel=(await snapshot(page)).travel
    await expectOffset(page,travel)
    await page.locator('[data-slot="tooltip-content"]').waitFor({state:'hidden'})
    assert.equal(await page.locator('.playlist-playback-dock').evaluate(el=>el.inert),true)
    await page.locator('.playlist-playback-toggle').evaluate(el=>el.focus())
    assert.equal(await page.locator('.playlist-playback-dock').evaluate(el=>el.contains(document.activeElement)),false)
    await page.evaluate(()=>window.setMotionOff())
    await page.locator('html[data-motion="off"]').waitFor()
    assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),false)
    await wheel(page,-40)
    await expectOffset(page,0)
    await wheel(page,20)
    await expectOffset(page,(await snapshot(page)).travel)
  })
  await check('invalid preference defaults to movable',async page=>{
    await wheel(page,400)
    await expectOffset(page,(await snapshot(page)).travel)
  },{mode:'invalid',reduced:true})
  console.log('CONTROLLER_MOTION_RESULT',passed,'passed; screenshots:',screenshots)
}finally{await browser.close()}
