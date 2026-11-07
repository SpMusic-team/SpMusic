// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright package.
// Real PlaylistPanel/dock, pointer handlers and appearance runtime. Only the
// parent preview/commit callbacks are fixtures; no production module is patched.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
import {PlaylistPanel} from '/src/features/player/components/PlaylistPanel.tsx';
import {TooltipProvider} from '/src/components/ui/tooltip.tsx';
import {createPlayerVisualTimelineClock} from '/src/features/player/model/visualTimelineClock.ts';
import '/src/index.css';import '/src/features/player/styles/player.css';
const noop=()=>{},tracks=Array.from({length:6},(_,i)=>({id:'song-'+i,title:'Song '+i,artist:'Artist '+i,album:'Album '+i,durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:false,lyrics:[],coverImage:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="'+['#d34','#3a6','#46e','#da3','#a5c','#2ab'][i]+'"/></svg>')}));
const artworks=tracks.map(t=>({id:t.id,coverTone:t.coverTone,coverImage:t.coverImage,resourceKey:t.id}));
window.calls=[];window.config={defer:false,reject:false,busyOnCommit:false,target:null};window.pendingResolvers=[];
let tokenId=0,pending=null,index=0;
function Fixture(){
 const appearance=useAppearance();window.setMotionOff=()=>appearance.previewAppearance({...appearance.appearance,motion:{...appearance.appearance.motion,level:'off'}});
 const clock=React.useMemo(()=>createPlayerVisualTimelineClock(45),[]);
 const [state,setState]=React.useState({index:0,busy:false,sequence:0,intent:null,playing:false,mounted:true,position:45,duration:180});index=state.index;
 window.enableTimelineScenario=()=>{window.config.liveTimeline=true;clock.setPositionSeconds(45);setState(s=>({...s,playing:true,position:45,duration:180}))};
 window.setTimelinePosition=position=>{clock.setPositionSeconds(position);setState(s=>({...s,position}))};
 window.updateFixture=patch=>setState(s=>({...s,...patch}));
 window.automaticSelection=({same=false,fail=false}={})=>{
  const origin=index;
  window.automaticAt=performance.now();clock.setPositionSeconds(0);
  setState(s=>{const target=same?s.index:(s.index+1)%tracks.length;return {...s,index:target,busy:true,position:0,duration:0,sequence:s.sequence+1,intent:{requestId:s.sequence+1,sequence:s.sequence+1,targetTrackId:tracks[target].id,direction:1,source:'automatic',progressStartRatio:1,preservePlayingVisual:false}}});
  setTimeout(()=>{if(fail)clock.setPositionSeconds(45);setState(s=>fail?{...s,index:origin,busy:false,intent:null,position:45,duration:180}:{...s,busy:false,position:.2,duration:240})},100);
 };
 const select=(target,token)=>{
  const outgoingPosition=clock.getPositionSeconds();
  setState(s=>({...s,index:target,busy:window.config.liveTimeline||window.config.busyOnCommit,...(window.config.liveTimeline?{position:0,duration:0,playing:false}:{}),sequence:s.sequence+1,intent:{requestId:s.sequence+1,sequence:s.sequence+1,targetTrackId:tracks[target].id,direction:token?.direction??1,source:'next',progressStartRatio:s.duration>0?(window.config.liveTimeline?outgoingPosition:s.position)/s.duration:0,preservePlayingVisual:s.playing,previewTokenId:token?.id}}));
  if(window.config.liveTimeline)clock.setPositionSeconds(0);
  if(window.config.liveTimeline){
   setTimeout(()=>setState(s=>({...s,busy:false,playing:true})),40);
   setTimeout(()=>{clock.setPositionSeconds(.2);setState(s=>({...s,duration:240,position:.2}))},120);
   setTimeout(()=>{clock.setPositionSeconds(.4);setState(s=>({...s,position:.4}))},180);
  }
 };
 const prepare=React.useCallback(direction=>{
   const target=window.config.target??((index+direction+tracks.length)%tracks.length),token={id:++tokenId,originTrackId:tracks[index].id,targetTrackId:tracks[target].id,direction,track:tracks[target],artwork:artworks[target]};
   window.calls.push({type:'prepare',id:token.id,direction,target,time:performance.now()});
   const resolve=()=>{pending=token;window.calls.push({type:'resolved',id:token.id,time:performance.now()});return token};
   if(window.config.defer)return new Promise(done=>window.pendingResolvers.push(()=>done(resolve())));
   return Promise.resolve(resolve());
 },[]);
 const commit=React.useCallback(id=>{
   window.calls.push({type:'commit',id,time:performance.now()});
   if(window.config.reject)return false;
   if(!pending||pending.id!==id)throw Error('single preview slot token mismatch');
   const token=pending;pending=null;select(tracks.findIndex(t=>t.id===token.targetTrackId),token);return true;
 },[]);
 const discard=React.useCallback(id=>{window.calls.push({type:'discard',id,time:performance.now()});if(pending?.id===id)pending=null},[]);
 const playback={track:tracks[state.index],artwork:artworks[state.index],isPlaying:state.playing,shuffleMode:'none',repeatMode:'list-loop',selectionActivitySequence:state.sequence,selectionVisualIntent:state.intent,isAudioBusy:state.busy,isSelectionPending:state.busy,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:()=>window.calls.push({type:'previous-fallback'}),onNext:()=>window.calls.push({type:'next-fallback'}),onPrepareTrackPreview:prepare,onCommitTrackPreview:commit,onDiscardTrackPreview:discard,onPlayToggle:async r=>({requestId:r.requestId,completed:true}),onShuffleCycle:noop,onRepeatCycle:noop};
 const timeline={positionSeconds:state.position,durationSeconds:state.duration,interaction:state.interaction??'following',visualClock:window.config.liveTimeline?clock:undefined,onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop};
 return React.createElement('main',{className:'player-shell'},state.mounted&&React.createElement(PlaylistPanel,{controllerMode:'fixed',tracks,playlistName:'Swipe fixture',currentTrackId:tracks[state.index].id,shuffleMode:'none',onShuffleCycle:noop,onOpenAudio:noop,onTrackSelect:noop,playback,timeline,visualIsPlaying:state.playing,playbackTransitionPending:false,onPlayToggle:()=>{window.calls.push({type:'toggle'});setState(s=>({...s,playing:!s.playing}))},onClose:()=>window.calls.push({type:'close'})}));
}
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();
root.render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(TooltipProvider,null,React.createElement(Fixture)))));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__controller_swipe_fixture.js"')
const browser = await chromium.launch({ headless:true, channel:process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge', args:['--disable-features=LocalNetworkAccessChecks'] })
const screenshots = process.env.SPMUSIC_SCREENSHOT_DIR || join(tmpdir(), 'spmusic-controller-swipe')
mkdirSync(screenshots,{recursive:true})
let passed=0

const activeSelector='.playlist-playback-track[data-swipe-plane="current"]'
const active=page=>page.locator(activeSelector).first()
async function frames(page,count=2){await page.evaluate(async count=>{for(let i=0;i<count;i++)await new Promise(requestAnimationFrame)},count)}
async function open({reduced=false,width=1280}={}){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:reduced?'reduce':'no-preference'})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>localStorage.setItem('spmusic.playlist.layout-level.v1','7'))
  await page.route('**/__controller_swipe_fixture.js',r=>r.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__controller_swipe_test',r=>r.fulfill({contentType:'text/html',body:html}))
  await page.goto(origin+'/__controller_swipe_test')
  await page.locator('.playlist-playback-toggle').waitFor()
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.playlist-panel')).transform==='none')
  await frames(page)
  return {page,errors}
}
async function check(name,run,options){
  if(process.env.SPMUSIC_TEST_FILTER&&!process.env.SPMUSIC_TEST_FILTER.split('|').some(filter=>name.includes(filter)))return
  const {page,errors}=await open(options)
  try{await run(page);assert.deepEqual(errors,[],'no unhandled browser errors');console.log('PASS',name);passed++}
  catch(error){await page.screenshot({path:join(screenshots,'failure.png')});console.log('FAIL_STATE',JSON.stringify(await snapshot(page)));throw error}
  finally{await page.close()}
}
const calls=page=>page.evaluate(()=>window.calls)
async function snapshot(page){return page.evaluate(selector=>{
  const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}
  const plane=document.querySelector(selector)
  return {plane:rect(plane),cover:rect(plane?.querySelector('.playlist-playback-cover')),copy:rect(plane?.querySelector('.playlist-playback-copy')),toggle:rect(plane?.querySelector('.playlist-playback-toggle')),progress:rect(document.querySelector('.playlist-playback-progress')),nav:rect(document.querySelector('.playlist-playback-nav')),text:plane?.textContent,html:plane?.outerHTML,calls:window.calls}
},activeSelector)}
async function rest(page,index=0){
  await page.waitForFunction(({selector,index})=>{
    const plane=document.querySelector(selector);if(!plane||!plane.textContent.includes('Song '+index))return false
    return Math.abs(new DOMMatrixReadOnly(getComputedStyle(plane).transform).m41)<.5
  },{selector:activeSelector,index})
  await frames(page)
}
async function start(page,{direction=1,button=false}={}){
  const box=await active(page).boundingBox(),target=button?await active(page).locator('.playlist-playback-toggle').boundingBox():null
  assert(box,'active track geometry')
  const point={x:target?target.x+target.width/2:box.x+box.width*(direction>0?.75:.25),y:box.y+box.height/2,width:box.width}
  await page.mouse.move(point.x,point.y);await page.mouse.down();return point
}
async function move(page,point,fraction,direction=1){await page.mouse.move(point.x-direction*point.width*fraction,point.y,{steps:4});await frames(page)}
async function drag(page,options={}){const point=await start(page,options);await move(page,point,options.fraction??.42,options.direction);await page.mouse.up();return point}
async function beginProgressTrace(page){await page.evaluate(()=>{
  window.progressTrace=[];window.progressTraceRunning=true
  function sample(){
    if(!window.progressTraceRunning)return
    const slider=document.querySelector('.playlist-playback-progress .control-progress-slider'),track=slider?.querySelector('[data-slot="slider-track"]'),thumb=slider?.querySelector('[data-slot="slider-thumb"]')
    if(track&&thumb)window.progressTrace.push({time:performance.now(),song:document.querySelector('.playlist-playback-track[data-swipe-plane="current"]')?.textContent,x:thumb.getBoundingClientRect().x-track.getBoundingClientRect().x,width:track.getBoundingClientRect().width})
    requestAnimationFrame(sample)
  }requestAnimationFrame(sample)
})}
async function endProgressTrace(page,song){return page.evaluate(song=>{window.progressTraceRunning=false;return window.progressTrace.filter(s=>s.song?.includes(song))},song)}
function nearly(actual,expected,label){assert(Math.abs(actual-expected)<1,label+': '+actual+' vs '+expected)}
async function releaseTrace(page,index,direction,stride){
  await page.evaluate(()=>{
    window.rowTrace=[];const generation=window.rowTraceGeneration=(window.rowTraceGeneration??0)+1
    function sample(){if(generation!==window.rowTraceGeneration)return;const el=document.querySelector('.playlist-playback-track[data-swipe-plane="current"]');if(el)window.rowTrace.push({text:el.textContent,x:new DOMMatrixReadOnly(getComputedStyle(el).transform).m41});requestAnimationFrame(sample)}requestAnimationFrame(sample)
  })
  await page.mouse.up();await rest(page,index);await frames(page,3)
  const samples=await page.evaluate(()=>{window.rowTraceGeneration++;return window.rowTrace})
  const current=samples.filter(s=>s.text.includes('Song '+index))
  assert(current.length>0&&current.every(s=>Math.abs(s.x)<1),'new selected row is painted at origin in every sampled frame')
  assert(samples.some(s=>s.x*direction < -stride*.98),'settle uses the same complete page stride')
}

try{
  await check('short click and keyboard preserve open and play actions',async page=>{
    await active(page).locator('.playlist-playback-track-button').click()
    await active(page).locator('.playlist-playback-toggle').click()
    await active(page).locator('.playlist-playback-track-button').focus();await page.keyboard.press('Enter')
    assert.deepEqual((await calls(page)).map(c=>c.type),['close','toggle','close'])
  })
  await check('whole row follows pointer with identical neighbour and fixed progress/navigation',async page=>{
    const before=await snapshot(page),point=await start(page)
    await move(page,point,.25)
    const during=await snapshot(page),dx=during.plane[0]-before.plane[0]
    assert(dx<-100,'row follows left drag')
    for(const part of ['cover','copy','toggle'])nearly(during[part][0]-before[part][0],dx,part+' shares horizontal plane')
    assert.deepEqual(during.progress,before.progress,'progress geometry fixed');assert.deepEqual(during.nav,before.nav,'navigation geometry fixed')
    const neighbour=page.locator('.playlist-playback-track[aria-hidden="true"]')
    assert.equal(await neighbour.count(),1,'one prepared neighbour')
    assert((await neighbour.textContent()).includes('Song 1'),'correct next token content')
    assert.equal(await neighbour.locator('.playlist-playback-cover').count(),1);assert.equal(await neighbour.locator('.playlist-playback-copy').count(),1)
    assert.equal(await neighbour.locator('svg').count(),1,'neighbour includes play icon')
    assert.equal(await neighbour.getAttribute('inert')!==null,true,'preview has no interaction')
    const adjacent=await neighbour.boundingBox()
    const spacing=await page.locator('.playlist-controller-swipe-viewport').evaluate(el=>({gap:parseFloat(getComputedStyle(el).columnGap),padding:parseFloat(getComputedStyle(el.closest('.playlist-playback-dock')).getPropertyValue('--playlist-dock-inline-padding'))}))
    const stride=point.width+2*spacing.padding+spacing.gap
    assert(spacing.gap>0,'theme has a visible positive page gap')
    nearly(adjacent.x-during.plane[0],stride,'neighbour uses full highlighted row plus visible gap')
    nearly(adjacent.x-spacing.padding-(during.plane[0]+point.width+spacing.padding),spacing.gap,'neighbour virtual highlight leaves a real visual gap')
    await page.screenshot({path:join(screenshots,'whole-row-drag.png')})
    await move(page,point,.48)
    const moved=await neighbour.boundingBox(),current=await active(page).boundingBox();nearly(moved.x-current.x,stride,'drag preserves neighbour stride')
    await releaseTrace(page,1,1,stride)
    const reverse=await start(page,{direction:-1});await move(page,reverse,.42,-1)
    const previous=await neighbour.boundingBox(),origin=await active(page).boundingBox();nearly(origin.x-previous.x,stride,'reverse uses identical stride')
    await releaseTrace(page,0,-1,stride)
    const events=await calls(page);assert.equal(events.filter(c=>c.type==='commit').length,2)
    assert(!events.some(c=>['toggle','close','next-fallback','previous-fallback'].includes(c.type)),'drag suppresses synthesized click and fallback transport')
  })
  await check('drag beginning on play button does not toggle playback',async page=>{
    await drag(page,{button:true});await rest(page,1)
    assert(!(await calls(page)).some(c=>c.type==='toggle'),'dragging button is whole-row gesture')
  })
  await check('rounded translucent play container and page gap survive desktop and narrow widths',async page=>{
    for(const width of [1280,520,320]){
      await page.setViewportSize({width,height:900});await frames(page,4)
      await page.waitForFunction(()=>[...document.querySelectorAll('.playlist-playback-track[data-swipe-plane="current"] :is(.playlist-playback-cover,.playlist-playback-copy)')].every(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).isIdentity))
      const toggle=active(page).locator('.playlist-playback-toggle'),before=await snapshot(page)
      const geometry=await toggle.evaluate(el=>{
        const r=el.getBoundingClientRect(),style=getComputedStyle(el),pseudo=getComputedStyle(el,'::before'),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.fillStyle=pseudo.backgroundColor;context.fillRect(0,0,1,1)
        return {x:r.x,right:r.right,width:r.width,height:r.height,radius:parseFloat(style.borderRadius),alpha:context.getImageData(0,0,1,1).data[3]/255,icon:el.querySelector('svg').getBoundingClientRect().width}
      })
      nearly(geometry.width,100,'play container width at '+width);nearly(geometry.height,80,'play container height at '+width)
      assert(geometry.radius>=30&&geometry.alpha>0&&geometry.alpha<1,'large rounded container uses translucent material')
      nearly(geometry.icon,48,'icon size remains independent of hitbox')
      assert(geometry.x>=before.plane[0]&&geometry.right<=before.plane[0]+before.plane[2]+1,'toggle stays inside whole row at '+width)
      assert(before.cover[0]+before.cover[2]<=before.copy[0]&&before.copy[0]+before.copy[2]<=geometry.x,'cover, copy and toggle do not overlap at '+width)
      await toggle.hover()
      await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.playlist-playback-track[data-swipe-plane="current"] .playlist-playback-toggle'),'::before').opacity)>.99)
      await page.screenshot({path:join(screenshots,'toggle-hover-'+width+'.png')})
      const point=await start(page,{button:true})
      assert(await toggle.locator('.press-feedback-button-ripple').count()>0,'press feedback appears inside large rounded container')
      await page.screenshot({path:join(screenshots,'toggle-press-'+width+'.png')})
      await move(page,point,.4)
      await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.playlist-playback-track[data-swipe-plane="current"] .playlist-playback-toggle'),'::before').opacity)<.01)
      assert.equal(await active(page).locator('.press-feedback-button-ripple').count(),0,'drag clears local pressed material')
      const during=await snapshot(page),dx=during.plane[0]-before.plane[0]
      assert(dx<-10);nearly(during.toggle[0]-before.toggle[0],dx,'large play container moves with row')
      const neighbour=await page.locator('.playlist-playback-track[data-swipe-plane="neighbor"]').boundingBox()
      const spacing=await page.locator('.playlist-controller-swipe-viewport').evaluate(el=>({gap:parseFloat(getComputedStyle(el).columnGap),padding:parseFloat(getComputedStyle(el.closest('.playlist-playback-dock')).getPropertyValue('--playlist-dock-inline-padding'))}))
      nearly(neighbour.x-during.plane[0]-during.plane[2]-2*spacing.padding,spacing.gap,'positive visual gap at '+width);assert(spacing.gap>0)
      await page.screenshot({path:join(screenshots,'toggle-drag-'+width+'.png')})
      await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();await rest(page)
    }
    assert(!(await calls(page)).some(c=>c.type==='toggle'||c.type==='close'),'drag never activates play or open')
  })
  await check('short drag returns, vertical intent cancels, click suppression expires',async page=>{
    const point=await start(page);await move(page,point,.015);await page.mouse.up();await rest(page)
    const vertical=await start(page);await page.mouse.move(vertical.x-4,vertical.y-60,{steps:4});await page.mouse.up();await rest(page)
    assert(!(await calls(page)).some(c=>c.type==='commit'))
    await active(page).locator('.playlist-playback-toggle').click()
    assert.equal((await calls(page)).filter(c=>c.type==='toggle').length,1,'next intentional click works')
  })
  await check('release coordinates determine final distance when pointermove is sparse',async page=>{
    await page.evaluate(()=>window.addEventListener('pointerdown',event=>window.lastPointerId=event.pointerId,{capture:true}))
    const returned=await start(page);await move(page,returned,.3)
    await page.evaluate(point=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:window.lastPointerId,isPrimary:true,button:0,clientX:point.x,clientY:point.y,bubbles:true})),returned)
    await page.mouse.up();await rest(page)
    assert(!(await calls(page)).some(c=>c.type==='commit'),'release back at origin does not commit stale long move')
    const reached=await start(page);await move(page,reached,.03)
    await page.waitForTimeout(120)
    await page.evaluate(point=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:window.lastPointerId,isPrimary:true,button:0,clientX:point.x-point.width*.4,clientY:point.y,bubbles:true})),reached)
    await page.mouse.up();await rest(page,1)
    assert.equal((await calls(page)).filter(c=>c.type==='commit').length,1,'release beyond threshold commits despite last short move')
  })
  await check('rejected commit returns original row without wrong neighbour',async page=>{
    await page.evaluate(()=>window.config.reject=true);await drag(page);await rest(page)
    assert.equal((await calls(page)).filter(c=>c.type==='commit').length,1)
    assert.equal(await page.locator('.playlist-playback-track[aria-hidden="true"]').count(),0)
    assert((await calls(page)).some(c=>c.type==='discard'),'rejected token released')
  })
  await check('accepted synchronous selection and busy flag retain settling motion',async page=>{
    await page.evaluate(()=>window.config.busyOnCommit=true)
    const point=await start(page);await move(page,point,.4)
    await page.evaluate(()=>{window.settleSamples=[];function sample(){const el=document.querySelector('.playlist-playback-track');window.settleSamples.push({time:performance.now(),x:new DOMMatrixReadOnly(getComputedStyle(el).transform).m41,text:el.textContent});if(window.settleSamples.length<40)requestAnimationFrame(sample)}requestAnimationFrame(sample)})
    await page.mouse.up();await rest(page,1)
    const samples=await page.evaluate(()=>window.settleSamples)
    assert(samples.filter(s=>Math.abs(s.x)>.5).length>=2,'accepted commit animates despite synchronous busy presentation')
    assert.equal((await calls(page)).filter(c=>c.type==='commit').length,1)
  })
  await check('random preview target is committed unchanged',async page=>{
    await page.evaluate(()=>window.config.target=4)
    await drag(page);await rest(page,4)
    assert.equal((await calls(page)).filter(c=>c.type==='prepare').length,1,'do not reselect random target')
  })
  await check('progress stays painted through selection, loading duration and visual clock updates',async page=>{
    await page.evaluate(()=>window.enableTimelineScenario());await frames(page,4)
    await page.evaluate(()=>{
      window.progressSamples=[];window.stopProgressSamples=false
      const ids=new WeakMap();let nextId=0
      const visible=el=>{if(!el)return {id:0,opacity:0,visibility:'missing',x:0,y:0,width:0,height:0,bg:''};const r=el.getBoundingClientRect(),style=getComputedStyle(el);let opacity=1;for(let p=el;p&&p!==document.body;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);if(!ids.has(el))ids.set(el,++nextId);return {id:ids.get(el),opacity,visibility:style.visibility,x:r.x,y:r.y,width:r.width,height:r.height,bg:style.backgroundColor}}
      function sample(time){
        const slider=document.querySelector('.playlist-playback-progress .control-progress-slider'),track=slider?.querySelector('[data-slot="slider-track"]'),range=slider?.querySelector('[data-slot="slider-range"]'),thumb=slider?.querySelector('[data-slot="slider-thumb"]')
        window.progressSamples.push({time,slider:visible(slider),track:visible(track),range:visible(range),thumb:visible(thumb),text:document.querySelector('.playlist-playback-track[data-swipe-plane="current"]')?.textContent,busy:document.querySelector('.playlist-playback-dock')?.hasAttribute('data-playback-command-busy'),toggle:document.querySelector('.playlist-playback-toggle')?.getAttribute('aria-label'),max:slider?.querySelector('input')?.max})
        if(!window.stopProgressSamples)requestAnimationFrame(sample)
      }requestAnimationFrame(sample)
    })
    await drag(page);await rest(page,1);await page.waitForTimeout(600)
    const samples=await page.evaluate(()=>{window.stopProgressSamples=true;return window.progressSamples})
    const after=samples.filter(s=>s.text?.includes('Song 1')),initial=samples[0]
    const metrics={frames:samples.length,afterFrames:after.length,sliderIds:[...new Set(samples.map(s=>s.slider.id))],thumbIds:[...new Set(samples.map(s=>s.thumb.id))],maxDomains:[...new Set(after.map(s=>s.max))],hiddenThumb:after.filter(s=>s.thumb.visibility!=='visible').length,hiddenRange:after.filter(s=>s.range.visibility!=='visible').length,minTrackOpacity:Math.min(...after.map(s=>s.track.opacity)),minThumbOpacity:Math.min(...after.map(s=>s.thumb.opacity)),maxThumbX:Math.max(...after.map(s=>s.thumb.x-s.track.x)),minTrackWidth:Math.min(...after.map(s=>s.track.width))}
    console.log('PROGRESS_SELECTION_SAMPLE',JSON.stringify(metrics))
    assert(after.length>=8,'sample loading, ready duration and resumed visual clock frames')
    assert(after.every(s=>s.track.visibility==='visible'&&s.thumb.visibility==='visible'&&s.range.visibility==='visible'),'track, range and thumb never become hidden after selection')
    assert(after.every(s=>s.toggle==='暂停'),'playing manual switch keeps pause icon through transient backend loading frame')
    assert(after.every(s=>s.track.opacity>=initial.track.opacity-.01&&s.thumb.opacity>=initial.thumb.opacity-.01),'loading and disabled transitions do not flash half opacity')
    assert(after.every(s=>Math.abs(s.track.width-initial.track.width)<1&&s.track.bg===initial.track.bg),'full unplayed track keeps geometry and material')
    assert(after.every(s=>s.thumb.x>=s.track.x-1&&s.thumb.x+s.thumb.width<=s.track.x+s.track.width+1),'thumb remains inside actual track')
    assert(after.every(s=>s.thumb.width>=initial.thumb.width-.5&&s.thumb.height>=initial.thumb.height-.5),'thumb keeps painted size while duration changes')
    const thumbTravel=after.map(s=>s.thumb.x-s.track.x)
    assert(thumbTravel[0]>initial.track.width*.15&&thumbTravel[0]<initial.track.width*.35,'new-track thumb begins near previous 25% progress')
    assert(thumbTravel.some(x=>x>initial.track.width*.05&&x<initial.track.width*.2),'thumb traverses intermediate positions')
    assert(thumbTravel.at(-1)<5,'new-track thumb finishes near the left edge')
    assert(after.slice(0,-1).every((s,i)=>thumbTravel[i+1]<=thumbTravel[i]+2),'thumb moves right to left without a visible rebound')
  })
  await check('reverse switch animates progress from current position and seeking interrupts it',async page=>{
    await page.evaluate(()=>window.enableTimelineScenario());await frames(page,4)
    await drag(page);await rest(page,1);await page.waitForTimeout(600)
    await page.evaluate(()=>window.setTimelinePosition(90));await frames(page,4)
    await beginProgressTrace(page)
    await drag(page,{direction:-1});await rest(page,0);await page.waitForTimeout(100)
    const beforeSeek=await page.evaluate(()=>window.progressTrace.filter(s=>s.song?.includes('Song 0')))
    assert(beforeSeek[0]?.x>beforeSeek[0]?.width*.25&&beforeSeek[0]?.x<beforeSeek[0]?.width*.55,'reverse switch starts near previous 90/240 progress')
    await page.evaluate(()=>window.updateFixture({interaction:'previewing'}));await frames(page,3)
    await page.evaluate(()=>window.updateFixture({interaction:'following'}));await frames(page,4)
    const samples=await endProgressTrace(page,'Song 0')
    assert(samples.at(-1)?.x<5,'seek interruption returns progress to current visual clock')
    assert(samples.some(s=>s.x<beforeSeek[0].x-20),'reverse progress moved before interruption')
  })
  await check('reduced motion switches progress directly to the new timeline',async page=>{
    await page.evaluate(()=>window.enableTimelineScenario());await frames(page,4)
    await beginProgressTrace(page);await drag(page);await rest(page,1);await frames(page,4)
    const samples=await endProgressTrace(page,'Song 1')
    assert(samples.length>0&&samples.every(s=>s.x<5),'reduced motion has no right-edge progress animation')
  },{reduced:true})
  await check('automatic selection holds right edge until delayed track geometry is ready',async page=>{
    await page.evaluate(()=>window.enableTimelineScenario());await frames(page,4)
    await page.evaluate(()=>{document.querySelector('.playlist-playback-progress .control-progress-slider').style.width='0px'})
    await frames(page,3)
    await beginProgressTrace(page)
    await page.evaluate(()=>window.automaticSelection())
    await page.waitForFunction(()=>document.querySelector('.playlist-playback-track[data-swipe-plane="current"]')?.textContent.includes('Song 1'))
    await page.waitForFunction(()=>!document.querySelector('.playlist-playback-dock')?.hasAttribute('data-playback-command-busy'))
    await page.evaluate(()=>{document.querySelector('.playlist-playback-progress .control-progress-slider').style.width=''})
    await page.waitForTimeout(650)
    const samples=(await endProgressTrace(page,'Song 1')).filter(s=>s.width>100)
    assert(samples.length>=8&&samples.slice(0,2).some(s=>s.x>s.width*.75),'first painted frame starts at far right after geometry measurement')
    assert(samples.some(s=>s.x>s.width*.2&&s.x<s.width*.8),'measured animation traverses track')
    assert(samples.at(-1).x<5,'measured animation returns to new timeline')
  })
  await check('failed automatic selection releases pending right-edge hold',async page=>{
    await page.evaluate(()=>window.enableTimelineScenario());await frames(page,4)
    await beginProgressTrace(page)
    await page.evaluate(()=>window.automaticSelection({fail:true}))
    await page.waitForFunction(()=>document.querySelector('.playlist-playback-track[data-swipe-plane="current"]')?.textContent.includes('Song 1'))
    const pending=await page.evaluate(()=>window.progressTrace.filter(s=>s.song?.includes('Song 1')))
    assert(pending.length>0&&pending.every(s=>s.x>s.width*.75),'pending request holds the right edge')
    await page.waitForFunction(()=>document.querySelector('.playlist-playback-track[data-swipe-plane="current"]')?.textContent.includes('Song 0')&&!document.querySelector('.playlist-playback-dock')?.hasAttribute('data-playback-command-busy'))
    await frames(page,4)
    const restored=await endProgressTrace(page,'Song 0')
    assert(Math.abs(restored.at(-1).x/restored.at(-1).width-.25)<.03,'failed request restores previous visual clock')
  })
  for(const boundary of ['cancel','blur','escape','busy','external','unmount'])await check(boundary+' cancels prepared gesture and never commits',async page=>{
    const point=await start(page);await move(page,point,.35)
    await page.evaluate(boundary=>{
      if(boundary==='cancel')document.querySelector('.playlist-playback-track').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1}))
      if(boundary==='blur')window.dispatchEvent(new Event('blur'))
      if(boundary==='busy')window.updateFixture({busy:true})
      if(boundary==='external')window.updateFixture({index:3,sequence:100})
      if(boundary==='unmount')window.unmountFixture()
    },boundary)
    if(boundary==='escape')await page.keyboard.press('Escape')
    await page.mouse.up()
    if(boundary!=='unmount')await rest(page,boundary==='external'?3:0)
    assert(!(await calls(page)).some(c=>c.type==='commit'),'cancelled boundary never commits')
    assert((await calls(page)).some(c=>c.type==='discard'),'cancelled boundary discards token')
  })
  await check('late preview after release and blur is discarded and cannot re-enter',async page=>{
    await page.evaluate(()=>window.config.defer=true);await drag(page)
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')))
    await page.evaluate(()=>window.pendingResolvers.shift()());await rest(page)
    assert(!(await calls(page)).some(c=>c.type==='commit'))
    assert((await calls(page)).some(c=>c.type==='discard'),'late token discarded')
    assert.equal(await page.locator('.playlist-playback-track[aria-hidden="true"]').count(),0)
  })
  await check('long hold brightens whole rounded row, quick drag stays dim, movement fades it',async page=>{
    const light=()=>active(page).locator('.playlist-controller-swipe-highlight').evaluate(el=>Number(getComputedStyle(el).opacity))
    await page.screenshot({path:join(screenshots,'idle.png')})
    const quick=await start(page)
    await page.waitForTimeout(45)
    const shortOpacity=await light()
    await move(page,quick,.27)
    const quickOpacity=await light()
    assert(shortOpacity<.04&&quickOpacity<.04,'quick interaction never reaches strong highlight')
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();await rest(page)
    const held=await start(page)
    await page.waitForTimeout(400)
    const longOpacity=await light()
    assert(longOpacity>.15&&longOpacity>shortOpacity+.1,'sustained hold reaches visible highlight')
    const geometry=await active(page).locator('.playlist-controller-swipe-highlight').boundingBox(),plane=await active(page).boundingBox()
    const dock=await page.locator('.playlist-playback-dock').boundingBox()
    nearly(geometry.width,dock.width,'highlight includes both row padding edges');nearly(geometry.height,plane.height,'highlight spans row height')
    assert(geometry.x<=plane.x&&geometry.x+geometry.width>=plane.x+plane.width,'highlight covers entire cover/copy/toggle row')
    await page.screenshot({path:join(screenshots,'long-hold.png')})
    await move(page,held,.26)
    await page.waitForTimeout(240)
    assert(await light()<.02,'movement fades hold highlight')
    await page.screenshot({path:join(screenshots,'held-drag.png')})
    await page.mouse.up();await rest(page,1)
    console.log('HIGHLIGHT_SAMPLE',JSON.stringify({shortOpacity,quickOpacity,longOpacity}))
  })
  await check('direction reversal ignores earlier asynchronous preview',async page=>{
    await page.evaluate(()=>window.config.defer=true)
    const point=await start(page);await move(page,point,.2);await move(page,point,.2,-1)
    await page.evaluate(()=>{while(window.pendingResolvers.length)window.pendingResolvers.shift()()})
    await frames(page);await page.mouse.up();await rest(page,5)
    const events=await calls(page),commits=events.filter(c=>c.type==='commit')
    assert.equal(commits.length,1);assert.equal(events.find(c=>c.type==='prepare'&&c.id===commits[0].id).direction,-1)
  })
  await check('reduced motion retains repeated functional swipe',async page=>{
    await drag(page);await rest(page,1)
    await drag(page,{direction:-1});await rest(page,0)
    assert.equal((await calls(page)).filter(c=>c.type==='commit').length,2)
  },{reduced:true})
  await check('appearance motion off retains functional swipe and rollback',async page=>{
    await page.evaluate(()=>window.setMotionOff());await frames(page)
    await drag(page);await rest(page,1)
    await page.evaluate(()=>window.config.reject=true)
    await drag(page);await rest(page,1)
    assert.equal((await calls(page)).filter(c=>c.type==='commit').length,2)
    assert.equal(await page.locator('.playlist-playback-track[aria-hidden="true"]').count(),0)
  })
  console.log('PLAYLIST_CONTROLLER_SWIPE_RESULT',passed,'passed; screenshots:',screenshots)
}finally{await browser.close()}
