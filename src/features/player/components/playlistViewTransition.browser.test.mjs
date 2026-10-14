// Optional real-browser regression harness; no project dependency is installed.
// Start Vite, then run with SPMUSIC_PLAYWRIGHT pointing to an existing Playwright package.
// It preserves the initial Vite-transformed panel in memory. After the baseline,
// Current-source regression runs by default. SPMUSIC_BENCHMARK=1 enables A/B.
// A/B runs unattended by default; SPMUSIC_WAIT_AFTER=1 enables an interactive
// baseline pause (launch with a terminal and type `after` once edits are ready).
// SPMUSIC_BASELINE_REF can override the recorded original revision below.
// SPMUSIC_SKIP_BENCH=1 runs current-source regression checks only.
// SPMUSIC_BASELINE_MODE=current preserves the entire current compiled module
// for a second-stage A/B run while another agent edits the same component.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const panelPath = '/src/features/player/components/PlaylistPanel.tsx'
const transformed = await (await fetch(origin + panelPath)).text()
const entry = await(await fetch(origin+'/src/main.tsx')).text()
const dependency = filename => {
 const match = (transformed+'\n'+entry).match(new RegExp('"(/node_modules/\\.vite/deps/'+filename.replaceAll('.','\\.')+'[^"\\n]*)"'))
 assert(match,`resolved Vite dependency ${filename}`);return match[1]
}
// Restore the exact original effect from a recorded revision, so browser setup
// not require rolling back another agent's production edits.
const baselineRef = process.env.SPMUSIC_BASELINE_REF || '5768a07da65e1d0ce25755e0534f01561043fadc'
const original = process.env.SPMUSIC_BENCHMARK==='1' ? execFileSync('git', ['show',baselineRef+':src/features/player/components/PlaylistPanel.tsx'],{encoding:'utf8'}) : ''
let baseline = transformed
if(process.env.SPMUSIC_BENCHMARK==='1'&&process.env.SPMUSIC_BASELINE_MODE!=='current'&&!process.env.SPMUSIC_SKIP_BENCH){
 const ts=require('typescript')
 baseline=ts.transpileModule(original,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSXDev}}).outputText
 baseline=baseline.replace(/import \{([^}]+)\} from ['"]react['"];/,(_line,names)=>`import testReact from "${dependency('react.js')}"; const {${names}}=testReact;`)
 baseline=baseline.replace(/import \{([^}]+)\} from "react\/jsx-dev-runtime";/,(_line,names)=>`import testJsxRuntime from "${dependency('react_jsx-dev-runtime.js')}"; const {${names.replaceAll(' as ',': ')}}=testJsxRuntime;`)
 baseline=baseline.replace(/from ['"]([^"'\n]+)['"]/g,(match,id)=>{
  if(id==='motion/react')return `from "${dependency('motion_react.js')}"`
  if(id==='lucide-react')return `from "${dependency('lucide-react.js')}"`
  if(!id.startsWith('@/'))return match
  const path='/src/'+id.slice(2);const extension=['.tsx','.ts','.js'].find(ext=>existsSync(resolve(process.cwd(),path.slice(1)+ext)))
  assert(extension,`resolve baseline import ${id}`);return `from "${path}${extension}"`
 })
}
if(process.env.SPMUSIC_BENCHMARK==='1'&&process.env.SPMUSIC_BASELINE_MODE!=='current'&&!process.env.SPMUSIC_SKIP_BENCH)assert(baseline.includes('animateLayoutPart(element, from, element.getBoundingClientRect(), duration, easing)'))
assert(baseline.includes('PlaylistPanel'))
console.log('BASELINE_PRESERVED')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
console.log('BROWSER', browser.version())
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
const { useState } = React; const { createRoot } = ReactDOM;
import { AppearanceProvider } from '/src/features/appearance/components/AppearanceProvider.tsx';
import { PlaylistPanel } from '${panelPath}';
import '/src/index.css';
import '/src/features/player/styles/player.css';
const count = Number(new URLSearchParams(location.search).get('count') || 500);
const blob = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#478"/></svg>'], {type:'image/svg+xml'}));
const tracks = Array.from({length: count}, (_, i) => ({ id: 'track-'+i, title: 'Test song '+i, artist: 'Artist '+(i%5), album: 'Album '+(i%10), durationSeconds: 180, fileExtension: 'flac', coverTone:'lagoon', hasLocalArtwork:true, coverThumbnail: {src:blob,width:128,height:128,encodedBytes:65536} }));
const noop = () => {};
window.demands = []; window.actions = []; window.profiles = []; window.unmountFixture = () => root.unmount();
const demand = (ids, keep, show, data) => window.demands.push({time:performance.now(), ids:[...ids],keep,show,data});
function Fixture() {
 const [current, setCurrent] = useState('track-0'); const [playing, setPlaying] = useState(false);
 const [items,setItems]=useState(tracks);const [unavailable,setUnavailable]=useState(new Set());
 window.updateFixtureTrack=(id,patch)=>setItems(previous=>previous.map(t=>t.id===id?{...t,...patch}:t));
 window.setFixtureUnavailable=ids=>setUnavailable(new Set(ids));
 const playback = {track:{...items.find(t=>t.id===current),lyrics:[]},isPlaying:playing,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:noop,onShuffleCycle:noop,onRepeatCycle:noop};
 const timeline = {positionSeconds:0,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop};
 return React.createElement(React.Profiler,{id:'playlist',onRender:(_id,phase,actual,base,start,commit)=>window.profiles.push({phase,actual,base,start,commit})},React.createElement(PlaylistPanel,{tracks:items,unavailableTrackIds:unavailable,currentTrackId:current,shuffleMode:'none',onShuffleCycle:noop,onVisibleTrackIdsChange:demand,playback,timeline,visualIsPlaying:playing,playbackTransitionPending:false,onPlayToggle:()=>{window.actions.push('play');setPlaying(p=>!p)},onTrackSelect:id=>{window.actions.push(id);setCurrent(id)},onClose:()=>window.actions.push('close')}));
}
const root = createRoot(document.getElementById('root'));
root.render(React.createElement(AppearanceProvider,null,React.createElement(Fixture)));
`

async function openPage(source, count = 500, level = 0, motion = 'no-preference') {
 const page = await browser.newPage({viewport:{width:1280,height:900},reducedMotion:motion})
 const errors = []; page.on('pageerror', e => { errors.push(e.message);console.log('PAGEERROR',e.message) })
 page.on('console',message=>{if(message.type()==='error')console.log('BROWSER_ERROR',message.text())})
 page.on('requestfailed',request=>console.log('REQUEST_FAILED',request.url(),request.failure()?.errorText))
 await page.addInitScript(({level})=>localStorage.setItem('spmusic.playlist.layout-level.v1',String(level)),{level})
 await page.route('**/src/features/player/components/PlaylistPanel.tsx*', r=>r.fulfill({contentType:'text/javascript',body:source}))
 await page.route('**/__playlist_fixture.js', r=>r.fulfill({contentType:'text/javascript',body:fixture}))
 const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__playlist_fixture.js"')
 await page.route('**/__playlist_test?*', r=>r.fulfill({contentType:'text/html',body:html}))
 await page.goto(origin+'/__playlist_test?count='+count)
 await page.waitForSelector('.playlist-card')
 await page.evaluate(()=>document.fonts.ready)
 await page.waitForTimeout(1100)
 if(process.env.SPMUSIC_DIAGNOSTIC_STYLE)await page.addStyleTag({content:process.env.SPMUSIC_DIAGNOSTIC_STYLE})
 assert.deepEqual(errors,[])
 await page.evaluate(()=>{const panel=document.querySelector('.playlist-panel'); panel.scrollTop=document.querySelector('.playlist-grid').offsetTop;})
 await page.waitForTimeout(300)
 // These regressions exercise physical Ctrl+wheel, whose repeated steps remain
 // supported separately from a touchpad pinch's synthesized ctrlKey wheel burst.
 await page.keyboard.down('Control')
 return {page,errors}
}

async function measure(source,label,count) {
 const {page,errors}=await openPage(source,count)
 const cdp=await page.context().newCDPSession(page)
 await cdp.send('Performance.enable')
 const rounds=[]
 for (let i=0;i<8;i++) {
  const prior=await cdp.send('Performance.getMetrics')
  const sample=await page.evaluate(async(delta)=>{
   const intervals=[];let last=performance.now();const end=last+950;let active=true;
   const tick=now=>{intervals.push(now-last);last=now;if(now<end&&active)requestAnimationFrame(tick)};requestAnimationFrame(tick);
   window.demands=[];window.profiles=[];
   let animationCount=0;const originalAnimate=Element.prototype.animate;
   let firstAnimationAt=null, rectReads=0;
   let synchronous=true,firstTargetStyleTime=null,firstTargetStyleDelay=null,firstTargetRectTime=null;
   const originalRect=Element.prototype.getBoundingClientRect;
   const originalStyle=window.getComputedStyle;
   window.getComputedStyle=function(el,...args){const begin=performance.now();const result=originalStyle.call(this,el,...args);if(!synchronous&&firstTargetStyleTime===null&&el.matches('.playlist-card-cover,.playlist-card-copy')){void result.display;firstTargetStyleTime=performance.now()-begin;firstTargetStyleDelay=begin-start}return result};
   Element.prototype.getBoundingClientRect=function(...args){rectReads++;const begin=performance.now();const result=originalRect.apply(this,args);if(!synchronous&&firstTargetRectTime===null&&this.matches('.playlist-card-cover,.playlist-card-copy'))firstTargetRectTime=performance.now()-begin;return result};
   Element.prototype.animate=function(...args){if(this.matches('.playlist-card-cover,.playlist-card-copy')){animationCount++;firstAnimationAt??=performance.now()}return originalAnimate.apply(this,args)};
   const start=performance.now();document.querySelector('.playlist-grid').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:delta}));
   const snapshotTime=performance.now()-start;const snapshotRectReads=rectReads;
   synchronous=false;
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const latency=performance.now()-start;
   await new Promise(r=>setTimeout(r,1000));active=false;
   Element.prototype.animate=originalAnimate;
   Element.prototype.getBoundingClientRect=originalRect;
   window.getComputedStyle=originalStyle;
   return {latency,snapshotTime,snapshotRectReads,firstTargetStyleTime,firstTargetStyleDelay,firstTargetRectTime,profiles:window.profiles,firstAnimationDelay:firstAnimationAt===null?null:firstAnimationAt-start,rectReads,animationCount,maxFrame:Math.max(...intervals),slowFrames:intervals.filter(n=>n>34).length,level:document.querySelector('.playlist-grid').dataset.layoutLevel,demands:window.demands.map(d=>({show:d.show,size:d.data?.coverCssPixels,count:d.ids.length})),remaining:document.getAnimations().filter(a=>a.effect?.target?.matches('.playlist-card-cover,.playlist-card-copy')).length};
  },i%2===0?120:-120)
  const after=await cdp.send('Performance.getMetrics');const map=new Map(prior.metrics.map(m=>[m.name,m.value]));
  for(const name of ['RecalcStyleCount','RecalcStyleDuration','LayoutCount','LayoutDuration','TaskDuration'])sample[name]=after.metrics.find(m=>m.name===name).value-map.get(name)
  assert.equal(sample.level,String(i%2===0?1:0));assert.equal(sample.remaining,0)
  rounds.push(sample)
 }
 assert.deepEqual(errors,[])
 const summary={label,count,contain:await page.locator('.playlist-card').first().evaluate(el=>getComputedStyle(el).contain),rounds};console.log(JSON.stringify(summary));await page.close();return summary
}

async function regress(source) {
 const {page,errors}=await openPage(source,250)
 const initialIds=await page.locator('.playlist-card').evaluateAll(cards=>cards.map(c=>c.dataset.playlistTrackId))
 await page.evaluate(()=>window.originalNodes=[...document.querySelectorAll('.playlist-card')])
 for(let target=1;target<=9;target++) {
  await page.evaluate(()=>document.querySelector('.playlist-grid').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120})))
  await page.waitForTimeout(175)
  assert.equal(await page.locator('.playlist-grid').getAttribute('data-layout-level'),String(target))
 }
 for(let target=8;target>=0;target--) {
  await page.evaluate(()=>document.querySelector('.playlist-grid').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-120})))
  await page.waitForTimeout(175)
  assert.equal(await page.locator('.playlist-grid').getAttribute('data-layout-level'),String(target))
 }
 await page.waitForTimeout(1000)
 assert.equal(await page.evaluate(()=>window.originalNodes.every((n,i)=>n===document.querySelectorAll('.playlist-card')[i])),true)
 assert.deepEqual(await page.locator('.playlist-card').evaluateAll(cards=>cards.map(c=>c.dataset.playlistTrackId)),initialIds)
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.matches('.playlist-card-cover,.playlist-card-copy')).length),0)
 await page.locator('.playlist-select-toggle').click()
 await page.locator('.playlist-card').first().click()
 assert.equal(await page.locator('.playlist-card').first().getAttribute('data-selected'),'true')
 await page.evaluate(()=>document.querySelector('.playlist-grid').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120})))
 await page.waitForTimeout(1000)
 assert.equal(await page.locator('.playlist-card').first().getAttribute('data-selected'),'true')
 await page.locator('.playlist-select-toggle').click()
 await page.locator('.playlist-card').nth(1).click()
 assert.equal(await page.locator('.playlist-card').nth(1).getAttribute('data-current'),'true')
 await page.locator('.playlist-playback-toggle').click()
 assert.equal(await page.locator('.playlist-playback-toggle').getAttribute('aria-pressed'),'true')
 await page.locator('.playlist-search-button').click()
 await page.locator('.playlist-filter-input').fill('Test song 249')
 assert.equal(await page.locator('.playlist-card').count(),1)
 await page.locator('.playlist-filter-input').fill('no matching track')
 assert.equal(await page.locator('.playlist-card').count(),0)
 await page.locator('.playlist-filter-input').fill('')
 assert.equal(await page.locator('.playlist-card').count(),250)
 await page.evaluate(()=>window.updateFixtureTrack('track-2',{title:'Hydrated title',artist:'Hydrated artist',coverThumbnail:undefined,hasLocalArtwork:false}))
 assert.equal(await page.locator('[data-playlist-track-id="track-2"] .playlist-card-title').textContent(),'Hydrated title')
 await page.evaluate(()=>window.setFixtureUnavailable(['track-2']))
 assert.equal(await page.locator('[data-playlist-track-id="track-2"]').isDisabled(),true)
 await page.evaluate(()=>window.setFixtureUnavailable([]))
 assert.equal(await page.locator('[data-playlist-track-id="track-2"]').isDisabled(),false)
 await page.evaluate(()=>{const p=document.querySelector('.playlist-panel');p.scrollTop=p.scrollHeight;p.dispatchEvent(new Event('scroll'))})
 await page.waitForTimeout(300)
 assert(await page.evaluate(()=>window.demands.some(d=>d.ids.includes('track-249'))))
 await page.setViewportSize({width:900,height:700});await page.waitForTimeout(300)
 await page.evaluate(()=>document.querySelector('.playlist-grid').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120})))
 await page.evaluate(()=>window.unmountFixture());await page.waitForTimeout(1000)
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.matches('.playlist-card-cover,.playlist-card-copy')).length),0)
 assert.deepEqual(errors,[]);await page.close()
 const reduced=await openPage(source,40,0,'reduce')
 await reduced.page.evaluate(()=>document.querySelector('.playlist-grid').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120})))
 await reduced.page.waitForTimeout(200)
 assert.equal(await reduced.page.locator('.playlist-grid').getAttribute('data-layout-level'),'1')
 assert.equal(await reduced.page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.matches('.playlist-card-cover,.playlist-card-copy')).length),0)
 await reduced.page.close();console.log('REGRESSION_PASS')
}

try {
 if(process.env.SPMUSIC_DIAGNOSTIC_MODE) {await measure(transformed,process.env.SPMUSIC_DIAGNOSTIC_STYLE?'diagnostic-style':'diagnostic',1000)} else if(process.env.SPMUSIC_SKIP_BENCH||process.env.SPMUSIC_BENCHMARK!=='1') {await regress(transformed)} else {
 await measure(baseline,'before',500)
 await measure(baseline,'before',1000)
 console.log('BASELINE_DONE')
 if(process.env.SPMUSIC_WAIT_AFTER){const input=createInterface({input:process.stdin});await new Promise(resolve=>input.on('line',line=>{if(line.trim()==='after'){input.close();resolve()}}))}
 const after=await(await fetch(origin+panelPath+'?after='+Date.now())).text()
 assert.notEqual(after,baseline,'the implementation must change')
 await measure(after,'after',500);await measure(after,'after',1000)
 await regress(after)
 }
} finally {await browser.close()}
