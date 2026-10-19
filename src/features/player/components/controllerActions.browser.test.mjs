// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright package.
// Real PlaylistPanel, dock and appearance runtime; only parent callbacks are fixtures.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlaylistPanel} from '/src/features/player/components/PlaylistPanel.tsx';
import {TooltipProvider} from '/src/components/ui/tooltip.tsx';
import '/src/index.css';import '/src/features/player/styles/player.css';
const noop=()=>{};
const tracks=Array.from({length:84},(_,i)=>({id:'song-'+i,title:'Song '+i,artist:'Artist',album:'Album',durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:false}));
window.calls=[];
function Fixture(){
 const [shuffle,setShuffle]=React.useState('none'),[searchRequestId,setSearchRequestId]=React.useState(0),[managed,setManaged]=React.useState(false);
 window.requestSearch=()=>setSearchRequestId(n=>n+1);
 const currentTrackId=new URLSearchParams(location.search).has('far')?'song-83':'song-0';
 const props={controllerMode:'fixed',tracks,playlistName:'Controller actions',currentTrackId,shuffleMode:shuffle,onShuffleCycle:()=>{window.calls.push('shuffle');setShuffle(s=>s==='none'?'shuffle-all':'none')},onOpenAudio:()=>window.calls.push('open'),onTrackSelect:id=>window.calls.push('select:'+id),
 library:{isOpen:false,items:[],onOpen:()=>{window.calls.push('back');setManaged(true)},onSelect:noop,onPlay:noop},
 playback:{track:tracks[0],isPlaying:false,shuffleMode:shuffle,repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:async r=>({requestId:r.requestId,completed:true}),onShuffleCycle:noop,onRepeatCycle:noop},
 timeline:{positionSeconds:45,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop},visualIsPlaying:false,playbackTransitionPending:false,onPlayToggle:()=>window.calls.push('toggle'),onClose:noop,searchRequestId};
 return React.createElement('main',{className:'player-shell'},managed?React.createElement('output',null,'Management fixture'):React.createElement(PlaylistPanel,props));
}
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();
root.render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(TooltipProvider,null,React.createElement(Fixture)))));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__controller_actions_fixture.js"')
const browser = await chromium.launch({ headless:true, channel:process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge', args:['--disable-features=LocalNetworkAccessChecks'] })
const screenshotDirectory = process.env.SPMUSIC_SCREENSHOT_DIR || join(tmpdir(), 'spmusic-controller-actions-motion')
mkdirSync(screenshotDirectory, { recursive:true })
let passed = 0

async function open({ reduced=false, far=false, width=1280, height=900 }={}) {
  const page = await browser.newPage({ viewport:{ width,height }, reducedMotion:reduced?'reduce':'no-preference' })
  const errors=[]
  page.on('pageerror', error=>errors.push(error.message))
  await page.addInitScript(()=>{
    localStorage.setItem('spmusic.playlist.layout-level.v1','7')
    window.samples=[]
    function capture(time){
      const row=document.querySelector('.playlist-controller-actions'),panel=document.querySelector('.playlist-panel'),hero=document.querySelector('.playlist-hero-copy .playlist-hero-actions'),dock=document.querySelector('.playlist-playback-dock')
      if(row&&panel&&hero&&dock){
        const style=getComputedStyle(row),r=dock.getBoundingClientRect(),h=hero.getBoundingClientRect(),p=panel.getBoundingClientRect()
        window.samples.push({time,opacity:Number(style.opacity),x:new DOMMatrixReadOnly(style.transform).m41,visible:row.dataset.actionsVisible,heroBottom:h.bottom,panelTop:p.top,dock:[r.x,r.y,r.width,r.height,Number(getComputedStyle(dock).opacity)],progress:document.querySelector('.playlist-playback-progress input[type="range"]')?.value})
      }
      requestAnimationFrame(capture)
    }
    requestAnimationFrame(capture)
  })
  await page.route('**/__controller_actions_fixture.js',route=>route.fulfill({ contentType:'text/javascript',body:fixture }))
  await page.route('**/__controller_actions_test*',route=>route.fulfill({ contentType:'text/html',body:html }))
  await page.goto(origin+'/__controller_actions_test'+(far?'?far=1':''))
  await page.locator('.playlist-controller-actions').waitFor({ state:'attached' })
  return {page,errors}
}
async function check(name, run, options) {
  if(process.env.SPMUSIC_TEST_FILTER&&!name.includes(process.env.SPMUSIC_TEST_FILTER))return
  const {page,errors}=await open(options)
  try {
    await run(page)
    assert.deepEqual(errors,[],'no unhandled browser errors')
    console.log('PASS',name);passed++
  }finally{await page.close()}
}
const row = page=>page.locator('.playlist-controller-actions')
async function settled(page, visible) {
  await page.waitForFunction(visible=>{
    const el=document.querySelector('.playlist-controller-actions'),s=getComputedStyle(el)
    return el.dataset.actionsVisible===String(visible)&&Math.abs(Number(s.opacity)-(visible?1:0))<0.001&&(!visible||Math.abs(new DOMMatrixReadOnly(s.transform).m41)<0.01)
  },visible)
}
async function pastHero(page, pixels=2) {
  await page.locator('.playlist-panel').evaluate((panel,pixels)=>{
    const hero=panel.querySelector('.playlist-hero-actions').getBoundingClientRect()
    panel.scrollTop+=hero.bottom-panel.getBoundingClientRect().top+pixels
  },pixels)
}
async function top(page) {
  await page.locator('.playlist-panel').evaluate(panel=>panel.scrollTo({top:0,behavior:'instant'}))
}
async function resetSamples(page) { await page.evaluate(()=>window.samples=[]) }
async function assertHiddenInteraction(page) {
  assert.equal(await row(page).getAttribute('aria-hidden'),'true')
  assert.equal(await row(page).evaluate(el=>el.inert&&getComputedStyle(el).pointerEvents==='none'),true)
  assert.equal(await row(page).getByRole('button').count(),0,'hidden buttons excluded from accessible tree')
  await row(page).locator('button').first().evaluate(button=>button.focus())
  assert.equal(await row(page).evaluate(el=>el.contains(document.activeElement)),false,'inert prevents focus')
}

try {
  await check('initial hiding, exact scroll threshold, entry/exit and unchanged dock',async page=>{
    await settled(page,false)
    await assertHiddenInteraction(page)
    const initial=await page.evaluate(()=>window.samples)
    assert(initial.length>0&&initial.every(s=>s.opacity<0.001),'initial render never flashes compact buttons')
    await page.setViewportSize({width:1280,height:200})
    await settled(page,false)
    await page.setViewportSize({width:1280,height:900})
    await pastHero(page,-1)
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    assert.equal(await row(page).getAttribute('data-actions-visible'),'false','one visible pixel of hero keeps compact hidden')
    await resetSamples(page)
    await pastHero(page)
    await settled(page,true)
    const enter=await page.evaluate(()=>window.samples)
    const intermediate=enter.filter(s=>s.opacity>0.01&&s.opacity<0.99)
    assert(intermediate.length>=2,'entry has sampled fade frames')
    assert(intermediate.some(s=>s.x>1),'entry slides from the right')
    assert(intermediate[0].x>intermediate.at(-1).x,'entry moves toward final x=0')
    assert.deepEqual(enter.at(-1).dock,enter[0].dock,'dock geometry and opacity stay fixed')
    assert.notEqual(enter[0].progress,undefined,'sample the actual native range input value')
    assert(enter.every(s=>s.progress===enter[0].progress),'progress value stays unchanged')
    await page.screenshot({path:join(screenshotDirectory,'actions-entered.png')})
    await resetSamples(page)
    await top(page)
    await settled(page,false)
    const exit=await page.evaluate(()=>window.samples)
    assert(exit.some(s=>s.opacity>0.01&&s.opacity<0.99&&s.x>1),'exit fades and slides right')
    assert(exit.every(s=>JSON.stringify(s.dock)===JSON.stringify(enter.at(-1).dock)),'exit leaves dock unchanged')
    await assertHiddenInteraction(page)
    console.log('MOTION_SAMPLE',JSON.stringify({enterFrames:enter.length,fadeFrames:intermediate.length,entryMs:enter.at(-1).time-enter[0].time,exitMs:exit.at(-1).time-exit[0].time}))
  })
  await check('rapid reversal, focus handoff, resize and search return',async page=>{
    await settled(page,false)
    await pastHero(page)
    await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.playlist-controller-actions')).opacity)>0.1)
    await top(page)
    await pastHero(page)
    await top(page)
    await settled(page,false)
    await pastHero(page)
    await settled(page,true)
    await row(page).locator('.playlist-hero-shuffle-button').hover()
    await page.locator('[data-slot="tooltip-content"]').waitFor()
    await top(page)
    await settled(page,false)
    await page.locator('[data-slot="tooltip-content"]').waitFor({state:'hidden'})
    await pastHero(page)
    await settled(page,true)
    await row(page).locator('.playlist-select-toggle').focus()
    await top(page)
    await settled(page,false)
    assert.equal(await row(page).evaluate(el=>el.contains(document.activeElement)),false,'focus moves out before toolbar becomes inert')
    await pastHero(page)
    await settled(page,true)
    await page.setViewportSize({width:320,height:800})
    await page.waitForFunction(()=>{
      const el=document.querySelector('.playlist-controller-actions'),hero=document.querySelector('.playlist-hero-copy .playlist-hero-actions').getBoundingClientRect(),panel=document.querySelector('.playlist-panel').getBoundingClientRect()
      return el.dataset.actionsVisible===String(hero.bottom<=panel.top)
    })
    await pastHero(page)
    await settled(page,true)
    const rects=await row(page).locator('button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,width:r.width,height:r.height,icon:b.querySelector('svg')?.getBoundingClientRect().width}}))
    assert.equal(rects.length,6)
    rects.forEach((r,i)=>{assert(r.x>=0&&r.right<=320);assert.equal(r.height,36);assert.equal(r.y,rects[0].y);if(i)assert(r.x>=rects[i-1].right);if(i!==4){assert.equal(r.width,36);assert.equal(r.icon,24)}})
    await page.screenshot({path:join(screenshotDirectory,'actions-320.png')})
    await row(page).locator('.playlist-search-button').click()
    await page.waitForFunction(()=>document.activeElement===document.querySelector('.playlist-filter-input'))
    // A normal toggle preserves existing nearest-scroll focus behavior; an
    // explicit search request is the path that must return all the way to top.
    await page.evaluate(()=>window.requestSearch())
    await settled(page,false)
    await assertHiddenInteraction(page)
    await page.locator('[data-slot="tooltip-content"]').waitFor({state:'hidden'})
    await page.screenshot({path:join(screenshotDirectory,'actions-search-top.png')})
  })
  await check('initial current-song positioning and explicit search request',async page=>{
    await settled(page,true)
    assert(await page.locator('.playlist-panel').evaluate(el=>el.scrollTop)>0,'far current song starts scrolled')
    await page.evaluate(()=>window.requestSearch())
    await settled(page,false)
    assert.equal(await page.locator('.playlist-panel').evaluate(el=>el.scrollTop),0)
    await page.waitForFunction(()=>document.activeElement===document.querySelector('.playlist-filter-input'))
  },{far:true})
  await check('reduced motion and all six callbacks',async page=>{
    await settled(page,false)
    await pastHero(page)
    await settled(page,true)
    const frames=await page.evaluate(()=>window.samples.filter(s=>s.visible==='true'))
    assert(frames.every(s=>s.opacity===1&&s.x===0),'reduced motion has no intermediate frames or translation')
    await row(page).locator('.playlist-hero-shuffle-button').click()
    await row(page).locator('.playlist-hero-play-button').click()
    await row(page).locator('.playlist-select-toggle').click()
    assert.equal(await row(page).locator('.playlist-select-toggle').textContent(),'完成')
    await row(page).locator('.playlist-select-toggle').click()
    await row(page).locator('.playlist-hero-more-button').click()
    await row(page).locator('.playlist-search-button').click()
    await page.waitForFunction(()=>document.activeElement===document.querySelector('.playlist-filter-input'))
    await page.evaluate(()=>window.requestSearch())
    await settled(page,false)
    await page.locator('.playlist-hero-copy .playlist-search-button').click()
    await pastHero(page)
    await settled(page,true)
    await row(page).locator('.playlist-controller-back-button').click()
    await page.getByText('Management fixture',{exact:true}).waitFor()
    assert.deepEqual(await page.evaluate(()=>window.calls),['shuffle','select:song-0','open','back'])
    assert.equal(await page.locator('.playlist-controller-actions').count(),0)
  },{reduced:true})
  console.log('CONTROLLER_ACTIONS_RESULT',passed,'passed; screenshots:',screenshotDirectory)
}finally{await browser.close()}
