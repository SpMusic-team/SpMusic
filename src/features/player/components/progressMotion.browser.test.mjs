// Start Vite. SPMUSIC_PLAYWRIGHT may point at an existing Playwright installation.
// Actual player/controller components, Motion, visual clock, slider and CSS run in Edge.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
import {ControlDock} from '/src/features/player/components/ControlDock.tsx';
import {PlaylistPlaybackDock} from '/src/features/player/components/PlaylistPlaybackDock.tsx';
import {createPlayerVisualTimelineClock} from '/src/features/player/model/visualTimelineClock.ts';
import '/src/index.css';
import '/src/features/player/styles/player.css';
const noop=()=>{},tracks=[0,1].map(i=>({id:'song-'+i,title:'Song '+i,artist:'Artist',album:'Album',durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',lyrics:[]}));
const clock=createPlayerVisualTimelineClock(90);window.calls=[];
function Fixture(){
 const appearance=useAppearance();window.motionConfig={duration:appearance.motion.trackCardCommitDurationSeconds*appearance.appearance.motion.durationScale,ease:appearance.motion.trackCardCommitEase,disabled:appearance.motion.disabled};
 window.setMotionOff=()=>appearance.previewAppearance({...appearance.appearance,motion:{...appearance.appearance.motion,level:'off'}});
 const [state,setState]=React.useState({index:0,sequence:0,intent:null,position:90,interaction:'following',pending:false,mounted:true});
 window.state=state;window.update=patch=>setState(s=>({...s,...patch}));
 window.setPosition=p=>{clock.setPositionSeconds(p);setState(s=>({...s,position:p}))};
 window.select=({index=1,source='next',pending=false,startRatio=.5}={})=>{
  clock.setPositionSeconds(pending?180:0);setState(s=>({...s,index:pending?s.index:index,position:pending?180:0,pending,sequence:s.sequence+1,intent:{requestId:s.sequence+1,sequence:s.sequence+1,targetTrackId:tracks[index].id,direction:source==='previous'?-1:1,source,progressStartRatio:startRatio,preservePlayingVisual:true}}));
 };
 window.commitSelection=()=>{clock.setPositionSeconds(0);setState(s=>({...s,index:tracks.findIndex(t=>t.id===s.intent.targetTrackId),pending:false,position:0}))};
 const playback={track:tracks[state.index],selectionActivitySequence:state.sequence,selectionVisualIntent:state.intent,isSelectionPending:state.pending,isPlaying:true,shuffleMode:'none',repeatMode:'repeat-one',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:async r=>({requestId:r.requestId,completed:true}),onShuffleCycle:noop,onRepeatCycle:noop};
 const timeline={positionSeconds:state.position,durationSeconds:180,interaction:state.interaction,visualClock:clock,onPreviewStart:()=>{window.calls.push('preview');setState(s=>({...s,interaction:'previewing'}))},onPreview:p=>setState(s=>({...s,position:p})),onCommit:p=>{window.calls.push(['commit',p]);clock.setPositionSeconds(p);setState(s=>({...s,position:p,interaction:'following'}))},onCancelPreview:()=>{window.calls.push('cancel');setState(s=>({...s,interaction:'following'}))}};
 const control=React.createElement(ControlDock,{playback,timeline,volume:{valuePercent:50,isBusy:false,isDisabled:false,onChange:noop},queue:{tracks,isOpen:false,onToggle:noop},visualIsPlaying:true,playbackTransitionPending:false,playbackVisualReady:true,onPlayToggle:noop});
 const dock=React.createElement(PlaylistPlaybackDock,{playback,timeline,visualIsPlaying:true,playbackTransitionPending:false,onPlayToggle:noop,searchOpen:false,onClose:noop});
 return state.mounted&&React.createElement(React.Fragment,null,React.createElement('section',{id:'full'},control),React.createElement('section',{id:'reference'},dock));
}
const style=document.createElement('style');style.textContent='#root{padding:30px}#full,#reference{position:relative;width:650px;height:220px}.control-dock,.playlist-playback-dock{position:relative!important;inset:auto!important;transform:none!important;width:600px!important;height:200px!important;padding:20px!important;opacity:1!important}.control-progress{width:560px!important}.playlist-playback-content{opacity:1!important}';document.head.append(style);
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();root.render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(Fixture))));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__progress_motion_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
let passed = 0
const frames = (page, count = 2) => page.evaluate(async count => {
  for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame)
}, count)
async function check(name, run, reduced = false) {
  if (process.env.SPMUSIC_TEST_FILTER && !name.includes(process.env.SPMUSIC_TEST_FILTER)) return
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/__progress_motion_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__progress_motion_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  try {
    await page.goto(origin + '/__progress_motion_test')
    await page.locator('#full [data-slot="slider-thumb"]').first().waitFor()
    await page.evaluate(() => {
      window.readRatio = scope => {
        const slider = document.querySelector(scope + ' .control-progress-slider'),track = slider.querySelector('[data-slot="slider-track"]'),thumb = slider.querySelector('[data-slot="slider-thumb"]')
        const tr = track.getBoundingClientRect(),th = thumb.getBoundingClientRect()
        return (th.x + th.width / 2 - tr.x - th.width / 2) / (tr.width - th.width)
      }
      window.trace = []
      window.capture = true
      function sample(time) { if(!window.capture)return;window.trace.push({ time, full: window.readRatio('#full'), reference: window.readRatio('#reference') });requestAnimationFrame(sample) }
      requestAnimationFrame(sample)
    })
    await frames(page, 3)
    await run(page)
    assert.deepEqual(errors, [])
    console.log('PASS', name)
    passed++
  } finally { await page.close() }
}
async function transition(page, selection) {
  await page.evaluate(ratio => window.setPosition(ratio * 180), selection.startRatio)
  await frames(page)
  await page.evaluate(selection => { window.trace = []; window.select(selection) }, selection)
  await page.waitForFunction(() => window.trace.length > 5 && window.trace.at(-1).time - window.trace[0].time > window.motionConfig.duration * 1000 + 100 && window.trace.at(-1).full < .005)
  const trace = await page.evaluate(() => window.trace)
  const intermediate = trace.filter(f => f.full > .015 && f.full < selection.startRatio - .015)
  if (intermediate.length < 3) console.log('FAILED_TRACE', JSON.stringify({ trace: trace.slice(0, 12), motion: await page.evaluate(() => window.motionConfig) }))
  assert(intermediate.length >= 3, 'full player paints intermediate reset positions')
  assert(trace.every(f => Math.abs(f.full - f.reference) < .015), 'full player follows actual controller easing and duration on every painted frame')
  console.log('PROGRESS_TRACE', JSON.stringify({ selection, frames: trace.length, intermediate: intermediate.length, maxDifference: Math.max(...trace.map(f => Math.abs(f.full - f.reference))) }))
}
try {
  await check('track switch cancels held keyboard preview before its old keyup', async page => {
    const slider = page.locator('#full').getByRole('slider')
    await slider.focus();await page.keyboard.down('ArrowRight');await frames(page)
    assert.equal(await page.evaluate(() => window.state.interaction), 'previewing')
    await page.evaluate(() => { window.select({ index: 1, startRatio: .5 });window.update({ interaction: 'following' }) })
    await frames(page, 3);await page.keyboard.up('ArrowRight');await frames(page)
    const commits = await page.evaluate(() => window.calls.filter(call => call[0] === 'commit'))
    console.log('PREVIEW_SELECTION_COMMITS', JSON.stringify(commits))
    assert.deepEqual(commits, [], 'releasing an old preview must not seek the newly selected track')
    await page.evaluate(() => window.setPosition(10));await frames(page)
    assert(Math.abs(Number(await slider.getAttribute('aria-valuenow')) - 10) < .01)
  })
  await check('next, previous, queue selection and repeated same-track reset match controller curves', async page => {
    for (const selection of [
      { index: 1, source: 'next', startRatio: .5 },
      { index: 0, source: 'previous', startRatio: .75 },
      { index: 1, source: 'queue', startRatio: .3 },
      { index: 1, source: 'automatic', startRatio: 1 },
      { index: 1, source: 'automatic', startRatio: 1 },
    ]) await transition(page, selection)
  })
  await check('automatic continuation holds ending position until selection is ready', async page => {
    await page.evaluate(() => { window.trace = []; window.select({ index: 0, source: 'automatic', pending: true, startRatio: 1 }) })
    await frames(page, 8)
    assert((await page.evaluate(() => window.trace)).every(f => f.full > .995 && f.reference > .995))
    await page.evaluate(() => { window.trace = []; window.commitSelection() })
    await page.waitForFunction(() => window.trace.some(f => f.full < .005))
    assert((await page.evaluate(() => window.trace)).some(f => f.full > .05 && f.full < .95))
  })
  await check('normal visual clock, pointer seek and keyboard seek retain immediate updates', async page => {
    await page.evaluate(() => window.setPosition(135));await frames(page)
    assert(Math.abs(await page.evaluate(() => window.readRatio('#full')) - .75) < .005)
    const thumb = page.locator('#full [data-slot="slider-thumb"]').first()
    const rect = await thumb.boundingBox()
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
    await page.mouse.down();await page.mouse.move(rect.x - 140, rect.y + rect.height / 2, { steps: 4 });await page.mouse.up()
    await frames(page)
    assert((await page.evaluate(() => window.calls)).some(call => call[0] === 'commit'))
    await page.locator('#full').getByRole('slider').focus();await page.keyboard.press('Home');await frames(page)
    assert(Math.abs(await page.evaluate(() => window.readRatio('#full'))) < .005)
    await page.keyboard.press('End');await frames(page)
    assert(Math.abs(await page.evaluate(() => window.readRatio('#full')) - 1) < .005)
    await page.evaluate(() => { window.trace = []; window.setPosition(60) });await frames(page)
    assert(Math.abs(await page.evaluate(() => window.readRatio('#full')) - 1 / 3) < .005)
  })
  for (const reduced of [false, true]) await check(reduced ? 'system reduced motion disables reset tween' : 'appearance motion off disables reset tween', async page => {
    if (!reduced) { await page.evaluate(() => window.setMotionOff());await page.locator('html[data-motion="off"]').waitFor() }
    await page.evaluate(() => { window.trace = []; window.select({ index: 1, startRatio: .5 }) });await frames(page, 4)
    const trace = await page.evaluate(() => window.trace)
    assert(trace.every(f => f.full < .005 && f.reference < .005), 'reduced motion returns directly to current clock')
  }, reduced)
  await check('interrupted selection and unmount stop stale progress ownership', async page => {
    await page.evaluate(() => window.select({ index: 1, startRatio: .5 }))
    await frames(page, 5)
    await transition(page, { index: 0, source: 'previous', startRatio: .8 })
    await page.evaluate(() => window.setPosition(90));await frames(page)
    assert(Math.abs(await page.evaluate(() => window.readRatio('#full')) - .5) < .005)
    await page.evaluate(() => { window.capture = false; window.unmount() });await frames(page)
    assert.equal(await page.locator('#full').count(), 0)
  })
  console.log('PROGRESS_MOTION_RESULT', passed, 'passed')
} finally { await browser.close() }
