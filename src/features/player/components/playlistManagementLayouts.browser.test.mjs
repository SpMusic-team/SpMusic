// Independent six-layout browser acceptance. Run Vite and provide an existing
// Playwright package via SPMUSIC_PLAYWRIGHT; no dependencies are installed.
// Uses real management/detail components, appearance provider and shared gestures.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const {chromium} = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin+'/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'))
  assert(match,'resolve '+name)
  return match[1]
}
const managementStorage = 'spmusic.playlist-management.layout-level.v1'
const detailStorage = 'spmusic.playlist.layout-level.v1'
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
import {PlaylistLibraryPanel} from '/src/features/player/components/PlaylistLibraryPanel.tsx';
import {PlaylistPanel} from '/src/features/player/components/PlaylistPanel.tsx';
import '/src/index.css';import '/src/features/player/styles/player.css';
const noop=()=>{};
const blob=URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#478"/></svg>'],{type:'image/svg+xml'}));
const cover={src:blob,width:128,height:128,encodedBytes:256};
const tracks=Array.from({length:80},(_,i)=>({id:'track-'+i,title:'Song '+i,artist:'Artist',album:'Album',durationSeconds:180,fileExtension:'flac',hasLocalArtwork:true,coverThumbnail:cover}));
const initialItems=Array.from({length:40},(_,i)=>({scope:'list-'+i,name:'Playlist '+String(i).padStart(2,'0'),sourceKind:'m3u8',trackCount:80,coverTrack:tracks[i]}));
window.actions=[];window.demands=[];
function Fixture(){
 const appearance=useAppearance();const [view,setView]=React.useState('management'),[items,setItems]=React.useState(initialItems),[playing,setPlaying]=React.useState(false),[entry,setEntry]=React.useState({requestId:1,target:'top'}),[sidebarOpen,setSidebarOpen]=React.useState(false);
 window.setFixtureTheme=mode=>appearance.setColorSchemePreference(mode);window.previewFixtureTheme=()=>{const next=structuredClone(appearance.appearance);next.colorSchemes.light.playerInk='#123456';appearance.previewAppearance(next)};
 window.showDetail=()=>{setEntry(previous=>({requestId:previous.requestId+1,target:'top'}));setView('detail')};window.showManagement=()=>setView('management');window.replaceFixtureItems=setItems;window.setFixtureOverlay=setSidebarOpen;
 const library={isOpen:view==='management',route:{view:'category',categoryId:'playlists'},items,currentScope:'list-0',activeScope:'list-0',onOpen:()=>setView('management'),onOpenOverview:()=>window.actions.push('overview'),onSelect:scope=>{window.actions.push('select:'+scope);window.showDetail()},onPlay:scope=>window.actions.push('play:'+scope)};
 const playback={track:{...tracks[75],lyrics:[]},isPlaying:playing,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isSelectionPending:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:noop,onShuffleCycle:noop,onRepeatCycle:noop};
 const timeline={positionSeconds:60,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop};
 const common={playback,timeline,visualIsPlaying:playing,playbackTransitionPending:false,onPlayToggle:()=>{window.actions.push('toggle');setPlaying(previous=>!previous)},librarySidebarOpen:sidebarOpen,onLibrarySidebarOpenChange:setSidebarOpen};
 return React.createElement('main',{className:'player-shell'},view==='management'?React.createElement(PlaylistLibraryPanel,{...common,playlist:{isOpen:true,library,tracks,currentTrackId:'track-75',shuffleMode:'none',onShuffleCycle:noop,onOpenAudio:noop,onOpenChange:noop,isOpenAudioDisabled:false},onOpenPlayer:()=>window.actions.push('open-player')}):React.createElement(PlaylistPanel,{...common,library,tracks,currentTrackId:'track-75',entryPosition:entry,shuffleMode:'none',onShuffleCycle:noop,onVisibleTrackIdsChange:(...args)=>window.demands.push(args),onTrackSelect:id=>window.actions.push('track:'+id),onClose:()=>window.actions.push('open-player')}));
}
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();root.render(React.createElement(AppearanceProvider,null,React.createElement(Fixture)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__management_layout_fixture.js"')
const directory = process.env.SPMUSIC_SCREENSHOT_DIR || join(tmpdir(),'spmusic-management-layouts')
mkdirSync(directory,{recursive:true})
const browser = await chromium.launch({headless:true,channel:'msedge'})
const report=[]
async function open({level='0',detailLevel='8',width=2560,height=1440,motion='no-preference',dark=false}={}){
 const page=await browser.newPage({viewport:{width,height},hasTouch:true,reducedMotion:motion,colorScheme:dark?'dark':'light'});page.setDefaultTimeout(10000)
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(({level,detailLevel,managementStorage,detailStorage})=>{
  if(level!==null)localStorage.setItem(managementStorage,level)
  if(detailLevel!==null)localStorage.setItem(detailStorage,detailLevel)
  window.listenersEvidence=[];window.partAnimations=[];window.touchEvidence=[]
  const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener
  const kinds=new Set(['wheel','touchstart','touchmove','touchend','touchcancel','keydown','keyup','blur'])
  EventTarget.prototype.addEventListener=function(type,listener,options){if(kinds.has(type)&&(this===window||(this instanceof Element&&this.matches('.playlist-management-content'))))window.listenersEvidence.push({target:this,type,listener,active:true});return add.call(this,type,listener,options)}
  EventTarget.prototype.removeEventListener=function(type,listener,options){for(const item of window.listenersEvidence)if(item.target===this&&item.type===type&&item.listener===listener)item.active=false;return remove.call(this,type,listener,options)}
  const animate=Element.prototype.animate
  Element.prototype.animate=function(...args){const animation=animate.apply(this,args);if(this.matches('.playlist-management-cover,.playlist-management-copy'))window.partAnimations.push(animation);return animation}
  for(const type of ['touchstart','touchmove','touchend','touchcancel'])document.addEventListener(type,event=>window.touchEvidence.push({type,trusted:event.isTrusted,canceled:event.defaultPrevented}),{passive:true})
 },{level,detailLevel,managementStorage,detailStorage})
 await page.route('**/__management_layout_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
 if(process.env.SPMUSIC_LAYOUT_BASELINE_PATH)await page.route('**/src/features/player/hooks/useCollectionLayout.ts*',route=>route.fulfill({contentType:'text/javascript',body:readFileSync(process.env.SPMUSIC_LAYOUT_BASELINE_PATH,'utf8')}))
 await page.route('**/__management_layout_test',route=>route.fulfill({contentType:'text/html',body:html}))
 await page.goto(origin+'/__management_layout_test');await page.locator('.playlist-management-card').first().waitFor();await page.evaluate(()=>document.fonts.ready)
 const cdp=await page.context().newCDPSession(page)
 const scrollToGrid=()=>page.locator('.playlist-management-content').evaluate(panel=>{const grid=panel.querySelector('.playlist-management-grid');panel.scrollTop+=grid.getBoundingClientRect().top-panel.getBoundingClientRect().top})
 await scrollToGrid()
 const wheel=async delta=>{const rect=await page.locator('.playlist-management-grid').boundingBox();return cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:rect.x+Math.min(100,rect.width/2),y:Math.max(80,rect.y+Math.min(40,rect.height/2)),deltaX:0,deltaY:delta,modifiers:2})}
 const touch=async(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:2,radiusY:2,force:1}))})
 const points=(distance=120)=>[[0,width/2-distance/2,200],[1,width/2+distance/2,200]]
 const move=async(from,to)=>{for(let step=1;step<=6;step++)await touch('touchMove',from.map(([id,x,y],i)=>[id,x+(to[i][1]-x)*step/6,y+(to[i][2]-y)*step/6]))}
 const pinch=async direction=>{await scrollToGrid();const from=points();await touch('touchStart',from);await move(from,points(direction==='out'?190:65));await touch('touchEnd',[])}
 return {page,errors,cdp,wheel,touch,points,move,pinch,scrollToGrid}
}
const levelOf=page=>page.locator('.playlist-management-grid').getAttribute('data-layout-level')
async function levelIs(page,level){await page.waitForFunction(level=>document.querySelector('.playlist-management-grid')?.dataset.layoutLevel===String(level),level);assert.equal(await levelOf(page),String(level))}
async function check(name,run,options){if(process.env.SPMUSIC_LAYOUT_CASE&&!name.includes(process.env.SPMUSIC_LAYOUT_CASE))return;const context=await open(options);try{await run(context);assert.deepEqual(context.errors,[]);report.push(name)}catch(error){await context.page.screenshot({path:join(directory,'failure.png')});throw error}finally{await context.page.close()}}
try{
 if(process.env.SPMUSIC_SCOPE_ONLY!=='1'){
 await check('six levels, physical Ctrl-wheel repetition, boundaries, FLIP/node/focus retention and separate persistence',async({page,wheel,scrollToGrid})=>{
  await levelIs(page,0)
  await page.locator('.playlist-management-card-button').first().focus()
  await page.evaluate(()=>{window.originalNodes=[...document.querySelectorAll('[data-playlist-scope]')];window.originalFocus=document.activeElement})
  await page.keyboard.down('Control')
  const geometry=[]
  for(let target=1;target<=5;target++){
   await scrollToGrid();await wheel(120);await levelIs(page,target);await page.waitForTimeout(180)
   geometry.push(await page.locator('.playlist-management-card').first().evaluate(card=>{const cover=card.querySelector('.playlist-management-cover'),rect=cover.getBoundingClientRect();return {level:document.querySelector('.playlist-management-grid').dataset.layoutLevel,coverWidth:rect.width,coverHeight:rect.height,display:getComputedStyle(cover).display}}))
  }
  await wheel(120);await page.waitForTimeout(180);await levelIs(page,5)
  for(let target=4;target>=0;target--){await scrollToGrid();await wheel(-120);await levelIs(page,target);await page.waitForTimeout(180)}
  await wheel(-120);await page.waitForTimeout(180);await levelIs(page,0);await page.keyboard.up('Control')
  assert.equal(await page.evaluate(()=>window.originalNodes.every((node,i)=>node===document.querySelectorAll('[data-playlist-scope]')[i])),true)
  assert.equal(await page.evaluate(()=>window.originalFocus===document.activeElement),true)
  assert(await page.evaluate(()=>window.partAnimations.length>0),'shared FLIP animates real management parts')
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),managementStorage),'0')
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),detailStorage),'8')
  assert.equal(await page.evaluate(()=>visualViewport.scale),1)
  assert.deepEqual(await page.evaluate(()=>window.actions),[],'layout gestures never open/play a list')
  report.push({geometry})
  await page.locator('.playlist-management-content').evaluate(panel=>panel.scrollTop=0)
  await page.screenshot({path:join(directory,'management-layout-0.png')})
 })
 await check('trackpad burst/reversal consumes once; idle and blur independently reset sessions',async({page,wheel,scrollToGrid})=>{
  await wheel(-120);await levelIs(page,2)
  for(const delta of [-120,120,-120,120]){await page.waitForTimeout(180);await scrollToGrid();await wheel(delta);await levelIs(page,2)}
  await page.waitForTimeout(400);await wheel(-120);await levelIs(page,1)
  await page.waitForTimeout(180);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await wheel(120);await levelIs(page,2)
  const canceled=await page.locator('.playlist-management > .playlist-library-sidebar').evaluate(element=>{const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120});element.dispatchEvent(event);return event.defaultPrevented})
  assert.equal(canceled,false,'events outside the right content area are not claimed')
 },{level:'3'})
 await check('trusted pinch direction/one-step, reversal, jitter, cancellation, third finger and browser zoom',async({page,touch,points,move,pinch,scrollToGrid})=>{
  await pinch('out');await levelIs(page,2);await page.waitForTimeout(180)
  await pinch('in');await levelIs(page,3);await page.waitForTimeout(180)
  await scrollToGrid();await touch('touchStart',points());await move(points(),points(130));await touch('touchCancel',[]);await levelIs(page,3)
  await touch('touchStart',points());await move(points(),points(190));await levelIs(page,2)
  await page.waitForTimeout(180);await move(points(190),points(400));await move(points(400),points(40));await levelIs(page,2);await touch('touchEnd',[])
  await touch('touchStart',points());await touch('touchStart',[...points(),[2,1400,200]]);await touch('touchEnd',points());await move(points(),points(190));await levelIs(page,2);await touch('touchEnd',[])
  await pinch('out');await levelIs(page,1)
  assert.equal(await page.evaluate(()=>visualViewport.scale),1)
  assert(await page.evaluate(()=>window.touchEvidence.some(event=>event.trusted&&event.canceled&&event.type==='touchmove')))
  assert.deepEqual(await page.evaluate(()=>window.actions),[])
 },{level:'3'})
 await check('unmount removes native gesture handlers and cancels FLIP work',async({page,pinch})=>{
  await pinch('out');await levelIs(page,2)
  await page.evaluate(()=>{window.retainedGrid=document.querySelector('.playlist-management-grid');window.unmountFixture()})
  const cleanup=await page.evaluate(()=>{
   const wheel=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120});window.retainedGrid.dispatchEvent(wheel)
   // Playwright installs its own window touch hit-target interceptors for click
   // actions. They belong to the test runner, not the mounted collection hook.
   return {canceled:wheel.defaultPrevented,activeListeners:window.listenersEvidence.filter(item=>item.active&&!String(item.listener).includes('this._hitTargetInterceptor')).length,runningAnimations:window.partAnimations.filter(animation=>animation.playState==='running'||animation.pending).length}
  })
  assert.deepEqual(cleanup,{canceled:false,activeListeners:0,runningAnimations:0},JSON.stringify(await page.evaluate(()=>window.listenersEvidence.filter(item=>item.active).map(item=>({type:item.type,callback:String(item.listener).slice(0,180)})))))
 },{level:'3'})
 for(const level of ['-1','6','NaN','1.5','01','',null])await check('invalid/missing preference '+String(level)+' falls back without borrowing detail preference',async({page})=>{await levelIs(page,0);assert.equal(await page.evaluate(key=>localStorage.getItem(key),detailStorage),'8')},{level,motion:'reduce'})
 await check('legal preferences are independent across management/detail and remounts',async({page})=>{
  await levelIs(page,5);await page.evaluate(()=>window.showDetail());await page.locator('.playlist-grid').waitFor();assert.equal(await page.locator('.playlist-grid').getAttribute('data-layout-level'),'8')
  await page.keyboard.down('Control');await page.locator('.playlist-grid').evaluate(grid=>grid.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120})));await page.keyboard.up('Control')
  await page.waitForFunction(()=>document.querySelector('.playlist-grid').dataset.layoutLevel==='9')
  await page.locator('.playlist-hero-category').click();await levelIs(page,5)
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),detailStorage),'9')
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),managementStorage),'5')
 },{level:'5',motion:'reduce'})
 await check('search, selection, keyboard open, detail entry top and dock remain functional after switching',async({page,wheel})=>{
  await page.keyboard.down('Control');await wheel(120);await levelIs(page,4);await page.keyboard.up('Control')
  await page.locator('.playlist-management-content').evaluate(panel=>panel.scrollTop=0)
  await page.getByRole('button',{name:'搜索播放列表',exact:true}).click();await page.getByRole('searchbox',{name:'搜索播放列表名称'}).fill('Playlist 03')
  assert.equal(await page.locator('.playlist-management-card').count(),1)
  await page.getByRole('button',{name:'选择',exact:true}).click();await page.getByRole('button',{name:'选择 Playlist 03',exact:true}).press('Space')
  assert.equal(await page.getByRole('button',{name:'选择 Playlist 03',exact:true}).getAttribute('aria-pressed'),'true')
  await page.getByRole('button',{name:'取消选择',exact:true}).click();await page.getByRole('button',{name:'打开播放列表 Playlist 03',exact:true}).press('Enter')
  await page.locator('.playlist-panel').waitFor();assert.equal(await page.locator('.playlist-panel').evaluate(panel=>panel.scrollTop),0)
  assert.deepEqual(await page.evaluate(()=>window.actions),['select:list-3'])
  await page.locator('.playlist-hero-category').click();await levelIs(page,4)
  await page.locator('.playlist-playback-toggle').click();assert.equal(await page.locator('.playlist-playback-toggle').getAttribute('aria-pressed'),'true')
  await page.locator('.playlist-playback-nav').getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('searchbox',{name:'搜索播放列表名称'}).waitFor()
  assert.equal(await page.locator('.playlist-filter-input').count(),0)
 },{level:'3',motion:'reduce'})
 for(let level=0;level<6;level++)await check('geometry/screenshot '+level,async({page})=>{
  await levelIs(page,level)
  const geometry=await page.locator('.playlist-management-cover').first().evaluate(element=>{const rect=element.getBoundingClientRect();return {display:getComputedStyle(element).display,width:rect.width,height:rect.height}})
  if(level<4){assert.equal(geometry.width,level%2===0?240:155);assert.equal(geometry.height,level%2===0?165:107)}else assert.equal(geometry.display,'none')
  const rows=await page.locator('.playlist-management-card').evaluateAll(cards=>cards.slice(0,3).map(element=>{const rect=element.getBoundingClientRect();return {x:rect.x,y:rect.y}}))
  if(level===4)assert(rows[1].y>rows[0].y&&rows[1].x===rows[0].x)
  if(level===5)assert.equal(rows[1].y,rows[0].y)
  await page.locator('.playlist-management-content').evaluate(panel=>panel.scrollTop=0)
  await page.screenshot({path:join(directory,'management-layout-'+level+'.png')})
 },{level:String(level),motion:'reduce'})
 await check('narrow dark/theme/reduced-motion geometry and last-item dock clearance',async({page,wheel})=>{
  const initial=await page.locator('.playlist-management').evaluate(element=>getComputedStyle(element).color)
  await page.evaluate(()=>window.setFixtureTheme('light'));await page.waitForFunction(initial=>getComputedStyle(document.querySelector('.playlist-management')).color!==initial,initial)
  await page.evaluate(()=>window.previewFixtureTheme());await page.waitForFunction(()=>getComputedStyle(document.querySelector('.playlist-management')).color==='rgb(18, 52, 86)')
  await page.keyboard.down('Control');await wheel(120);await levelIs(page,5);await page.keyboard.up('Control')
  assert.equal(await page.evaluate(()=>window.partAnimations.length),0,'reduced motion does not start FLIP')
  await page.locator('.playlist-management-content').evaluate(panel=>panel.scrollTop=panel.scrollHeight)
  const last=await page.locator('.playlist-management-card').last().boundingBox(),dock=await page.locator('.playlist-playback-dock').boundingBox()
  assert(last.y+last.height<=dock.y,'narrow last item clears bottom dock');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:join(directory,'management-narrow-theme-reduced.png')})
 },{level:'4',width:480,height:800,motion:'reduce',dark:true})
 }
 async function regionPoint(page,region){
  if(region==='footer')return page.evaluate(()=>{
   const panel=document.querySelector('.playlist-management-content');panel.scrollTop=panel.scrollHeight
   const last=panel.querySelector('.playlist-management-card:last-child').getBoundingClientRect(),dock=document.querySelector('.playlist-playback-dock').getBoundingClientRect(),rect=panel.getBoundingClientRect()
   return {x:rect.left+rect.width/2,y:(last.bottom+dock.top)/2}
  })
  await page.locator('.playlist-management-content').evaluate(panel=>panel.scrollTop=0)
  if(region==='gap')return page.evaluate(()=>{
   const panel=document.querySelector('.playlist-management-content'),grid=panel.querySelector('.playlist-management-grid');panel.scrollTop+=grid.getBoundingClientRect().top-panel.getBoundingClientRect().top
   const cards=[...grid.querySelectorAll('.playlist-management-card')],first=cards[0].getBoundingClientRect(),second=cards[1].getBoundingClientRect()
   return second.top>first.top?{x:first.left+first.width/2,y:(first.bottom+second.top)/2}:{x:(first.right+second.left)/2,y:first.top+first.height/2}
  })
  const selector=region==='heading'?'.playlist-management-heading':'.playlist-management-actions button:nth-child(2)'
  const rect=await page.locator(selector).boundingBox();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}
 }
 async function wheelAt(cdp,point,deltaY,modifiers=2){await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY,modifiers})}
 const regions=['heading','toolbar','gap','footer']
 await check('right-content Ctrl-wheel works on heading, toolbar button, card gap and footer blank space',async({page,cdp})=>{
  await page.keyboard.down('Control')
  for(const [index,region] of regions.entries()){
   const point=await regionPoint(page,region)
   assert(await page.evaluate(point=>Boolean(document.elementFromPoint(point.x,point.y)?.closest('.playlist-management-content')),point),'native hit target belongs to right content: '+region)
   await wheelAt(cdp,point,120);await levelIs(page,index+1);await page.waitForTimeout(180)
  }
  await page.keyboard.up('Control');assert.equal(await page.evaluate(()=>visualViewport.scale),1)
  assert.deepEqual(await page.evaluate(()=>window.actions),[],'zooming a toolbar control never activates its button')
  await page.locator('.playlist-management-content').evaluate(panel=>panel.scrollTop=0)
  await page.screenshot({path:join(directory,'management-content-gestures.png')})
 },{level:'0'})
 await check('right-content trackpad pinch supports all four regions and still consumes one level per gesture',async({page,cdp})=>{
  for(const [index,region] of regions.entries()){
   if(index)await page.waitForTimeout(400)
   const point=await regionPoint(page,region)
   for(let step=0;step<4;step++)await wheelAt(cdp,point,8)
   await levelIs(page,index+1)
   await page.waitForTimeout(180);await wheelAt(cdp,point,-120);await levelIs(page,index+1)
  }
 },{level:'0'})
 await check('trusted two-touch pinch accepts heading/toolbar/gap/footer without clicking controls',async({page,touch,move})=>{
  for(const [index,region] of regions.entries()){
   const point=await regionPoint(page,region),from=[[0,point.x-40,point.y],[1,point.x+40,point.y]],to=[[0,point.x-80,point.y],[1,point.x+80,point.y]]
   await touch('touchStart',from);await move(from,to);await touch('touchEnd',[]);await levelIs(page,4-index);await page.waitForTimeout(180)
  }
  assert(await page.evaluate(()=>window.touchEvidence.some(event=>event.type==='touchmove'&&event.trusted&&event.canceled)))
  assert.deepEqual(await page.evaluate(()=>window.actions),[])
 },{level:'5'})
 await check('sidebar/dock/dialog/editable targets are excluded; normal wheel, input and detail grid boundary remain intact',async({page,cdp})=>{
  const excluded=async selector=>page.locator(selector).first().evaluate(element=>{
   const wheel=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120});element.dispatchEvent(wheel)
   const a=new Touch({identifier:1,target:element,clientX:400,clientY:160}),b=new Touch({identifier:2,target:element,clientX:520,clientY:160})
   const start=new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[a,b]});element.dispatchEvent(start)
   element.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[]}));return {wheel:wheel.defaultPrevented,touch:start.defaultPrevented}
  })
  for(const selector of ['.playlist-management > .playlist-library-sidebar','.playlist-playback-dock'])assert.deepEqual(await excluded(selector),{wheel:false,touch:false})
  await page.locator('.playlist-management-content').evaluate(panel=>panel.scrollTop=0)
  await page.getByRole('button',{name:'搜索播放列表',exact:true}).click()
  await page.getByRole('searchbox',{name:'搜索播放列表名称'}).fill('Playlist')
  assert.deepEqual(await excluded('.playlist-management-search input'),{wheel:false,touch:false})
  await page.evaluate(()=>window.setFixtureOverlay(true));await page.getByRole('dialog').waitFor()
  assert.deepEqual(await excluded('[role="dialog"]'),{wheel:false,touch:false})
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await levelIs(page,2)
  const point=await regionPoint(page,'heading');await wheelAt(cdp,point,150,0)
  await page.waitForFunction(()=>document.querySelector('.playlist-management-content').scrollTop>0);await levelIs(page,2)
  await page.evaluate(()=>window.showDetail());await page.locator('.playlist-panel').waitFor()
  const claimed=await page.locator('.playlist-hero').evaluate(element=>{const wheel=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120});element.dispatchEvent(wheel);return wheel.defaultPrevented})
  assert.equal(claimed,false,'original detail accepts only its song grid')
  assert.equal(await page.locator('.playlist-grid').getAttribute('data-layout-level'),'8')
 },{level:'2',motion:'reduce'})
 await check('copy WAAPI is translation only, covers retain scaling, rapid reversals never stretch text',async({page,wheel,scrollToGrid})=>{
  await page.keyboard.down('Control')
  for(const [index,delta] of [120,120,-120,120,-120,-120].entries()){
   await scrollToGrid();await wheel(delta)
   await levelIs(page,[1,2,1,2,1,0][index])
   const frames=await page.evaluate(async()=>{
    const frames=[];for(let i=0;i<8;i++){await new Promise(resolve=>requestAnimationFrame(resolve));frames.push([...document.querySelectorAll('.playlist-management-copy')].slice(0,12).map(element=>{const m=new DOMMatrixReadOnly(getComputedStyle(element).transform);return [m.a,m.b,m.c,m.d]}))}return frames
   })
   assert(frames.flat().every(([a,b,c,d])=>Math.abs(a-1)<0.001&&Math.abs(d-1)<0.001&&Math.abs(b)<0.001&&Math.abs(c)<0.001),'text matrices remain translation-only during interrupted/reversed layout')
   await page.waitForTimeout(50)
  }
  await page.keyboard.up('Control')
  const animationEvidence=await page.evaluate(()=>window.partAnimations.map(animation=>({kind:animation.effect.target.classList.contains('playlist-management-copy')?'copy':'cover',transforms:animation.effect.getKeyframes().map(frame=>frame.transform)})))
  assert(animationEvidence.some(item=>item.kind==='copy'),'assertion observes actual copy animations')
  assert(animationEvidence.filter(item=>item.kind==='copy').every(item=>item.transforms.every(transform=>!transform.includes('scale'))),'copy keyframes cannot scale width or height')
  assert(animationEvidence.some(item=>item.kind==='cover'&&item.transforms.some(transform=>transform.includes('scale'))),'covers retain FLIP scaling')
  report.push({animationEvidence:animationEvidence.slice(0,4)})
  await page.locator('.playlist-management-content').evaluate(panel=>panel.scrollTop=0)
  await page.screenshot({path:join(directory,'management-translate-interrupted.png')})
  await page.evaluate(()=>Promise.allSettled(window.partAnimations.filter(animation=>animation.playState==='running'||animation.pending).map(animation=>animation.finished)))
  await page.screenshot({path:join(directory,'management-translate-only.png')})
 },{level:'0'})
 console.log(JSON.stringify({browser:browser.version(),report,screenshots:directory}))
}finally{await browser.close()}
