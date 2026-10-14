// Optional real-browser regression. Start Vite and point SPMUSIC_PLAYWRIGHT
// at an existing Playwright package. No project dependency is installed.
// Only the incoming paint barrier is delayed in the in-memory served module;
// the production resource hook, gesture handlers and Motion animation run unchanged.
// SPMUSIC_COVER_NATIVE_ONLY=1 instead checks the native-trace incoming replacement:
// first-repair surface on both sides, old/new hook, and an unchanged paint barrier.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const ts = require('typescript')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const componentPath = '/src/features/player/components/PlayerSurface.tsx'
const transformed = await (await fetch(origin + componentPath)).text()
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = (transformed + '\n' + entry).match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const ref = process.env.SPMUSIC_BASELINE_REF || '20722d6'
const baselineText = execFileSync('git', ['show', ref + ':' + componentPath.slice(1)], { encoding: 'utf8' })
const currentText = readFileSync(componentPath.slice(1), 'utf8')
const hookPath = '/src/features/player/hooks/useArtworkVisualResource.ts'
const hookBaselineText = execFileSync('git', ['show', ref + ':' + hookPath.slice(1)], { encoding: 'utf8' })
function compile(input, delay) {
  input = input.replaceAll('\r\n', '\n')
  let source = input.replace('const retiringTrackCardProgress = useMotionValue(0)', `
  useLayoutEffect(() => trackCardProgress.on('change', value => window.coverEvents.push({type:'progress',value,slots:artworkSlotsRef.current.map(l=>l&&({id:l.id,phase:l.phase,track:l.track.id})),time:performance.now()})), [trackCardProgress])
  const retiringTrackCardProgress = useMotionValue(0)`)
  source = source.replace('trackCardSessionRef.current = session', `window.coverEvents.push({type:'session',session,time:performance.now()}); trackCardSessionRef.current = session`)
  source = source.replace('artworkSlotsRef.current = artworkSlots', `window.coverEvents.push({type:'slots',slots:artworkSlots.map(l=>l&&({id:l.id,phase:l.phase,track:l.track.id,identity:l.identity,token:l.previewTokenId})),time:performance.now()}); window.coverOnSlots?.(artworkSlots); artworkSlotsRef.current = artworkSlots`)
  source = source.replace('(layerId: number) => {\n      markArtworkExitComplete', `(layerId: number) => {\n      window.coverEvents.push({type:'exit',layerId,time:performance.now()}); markArtworkExitComplete`)
  source = source.replace('let secondFrameId: number | null = null', 'let secondFrameId: number | null = null; let testTimer: ReturnType<typeof setTimeout> | null = null')
  source = source.replace(`        incomingPaintedRef.current = true
        if (readyPendingRef.current || layer.resource.view) {
          readyPendingRef.current = false
          onReady(layer.id)
        }`, `        const reportTestReady = () => {
          if (cancelled) return
          window.coverEvents.push({type:'paint-ready',layerId:layer.id,time:performance.now()})
          incomingPaintedRef.current = true
          if (readyPendingRef.current || layer.resource.view) {
            readyPendingRef.current = false
            onReady(layer.id)
          }
        }
        if (${delay} === 0) reportTestReady()
        else testTimer = setTimeout(reportTestReady, ${delay})`)
  assert(source.includes('testTimer = setTimeout'), 'paint barrier instrumentation matched')
  source = source.replace('if (secondFrameId !== null) cancelAnimationFrame(secondFrameId)', 'if (secondFrameId !== null) cancelAnimationFrame(secondFrameId); if (testTimer !== null) clearTimeout(testTimer)')
  let js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  js = js.replace(/import \{([^}]+)\} from ["'](react|react-dom|react\/jsx-runtime)["'];?/g, (_line, names, id) => {
    const file = id === 'react' ? 'react.js' : id === 'react-dom' ? 'react-dom.js' : 'react_jsx-runtime.js'
    // Vite's entry uses the dev runtime; both prebundles are CJS default exports.
    const path = file === 'react_jsx-runtime.js' ? dependency('react_jsx-dev-runtime.js').replace('react_jsx-dev-runtime.js', 'react_jsx-runtime.js') : dependency(file)
    return `import test_${id.replaceAll(/[^a-z]/g, '_')} from '${path}'; const {${names.replaceAll(' as ', ': ')}}=test_${id.replaceAll(/[^a-z]/g, '_')};`
  })
  js = js.replace(/from ["']([^"']+)["']/g, (line, id) => {
    if (id === 'motion/react') return `from '${dependency('motion_react.js')}'`
    if (!id.startsWith('@/')) return line
    const path = '/src/' + id.slice(2)
    const ext = ['.tsx', '.ts', '.js', ''].find(ext => existsSync(resolve(path.slice(1) + ext)))
    assert(ext !== undefined, 'resolve ' + id)
    return `from '${path}${ext}'`
  }).replaceAll("import '@/", "import '/src/")
  return js
}
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import { AppearanceProvider } from '/src/features/appearance/components/AppearanceProvider.tsx';
import { PlayerSurface } from '${componentPath}';
import '/src/index.css';
const noop=()=>{};
window.coverEvents=[];window.coverCommits=[];window.coverConfig={refresh:true,reject:false,staged:false};
const tracks=Array.from({length:6},(_,i)=>({id:'track-'+i,title:'Song '+i,artist:'Artist',album:'Album',durationSeconds:180,coverTone:'lagoon',lyrics:[],coverImage:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="'+['#d34','#3a6','#46e','#da3','#a5c','#2ab'][i]+'"/></svg>')}));
const artworks=tracks.map(t=>({id:t.id,coverTone:t.coverTone,coverImage:t.coverImage,resourceKey:t.id}));
let tokenId=0,requestId=0,currentIndex=0,pending=null;
function Fixture(){
 const [state,setState]=React.useState({index:0,intent:null,sequence:0,mounted:true,detailsPending:false,revision:0,artVariant:null});
 currentIndex=state.index;
 const select=(index,token)=>{const request=++requestId;setState(s=>({...s,index,detailsPending:window.coverConfig.staged,sequence:request,intent:{requestId:request,sequence:request,targetTrackId:tracks[index].id,direction:index>s.index?1:-1,source:index>s.index?'next':'previous',previewTokenId:token}}));};
 window.coverUpdate=patch=>setState(s=>({...s,...patch}));
 window.coverRefresh=()=>setState(s=>({...s,intent:s.intent&&{...s.intent}}));
 window.coverDetailRefresh=()=>setState(s=>({...s,detailsPending:false,revision:s.revision+1}));
 window.coverNewRequest=()=>setState(s=>({...s,sequence:s.sequence+100,intent:{...s.intent,requestId:s.intent.requestId+100,sequence:s.sequence+100}}));
 window.coverNewArtwork=kind=>setState(s=>({...s,artVariant:kind,revision:s.revision+1}));
 window.coverSelect=(index)=>select(index);
 const prepare=React.useCallback(async direction=>{const index=(currentIndex+direction+tracks.length)%tracks.length;pending={id:++tokenId,originTrackId:tracks[currentIndex].id,targetTrackId:tracks[index].id,direction,track:tracks[index],artwork:artworks[index]};return pending},[]);
 const commit=React.useCallback(id=>{window.coverCommits.push(id);window.coverEvents.push({type:'commit',time:performance.now()});if(window.coverConfig.reject)return false;const p=pending;assertToken(p,id);select(tracks.findIndex(t=>t.id===p.targetTrackId),id);if(window.coverConfig.refresh){setTimeout(()=>window.coverRefresh(),90);setTimeout(()=>window.coverRefresh(),135)}return true},[]);
 const currentTrack=React.useMemo(()=>({...tracks[state.index]}),[state.index,state.revision]);
 const currentArtwork=React.useMemo(()=>({...artworks[state.index],...(state.artVariant?{coverImage:state.artVariant==='error'?'data:image/png;base64,aW52YWxpZA==':artworks[state.index].coverImage.replace('%231a1','%232b2')+'#changed'}:{})}),[state.index,state.revision,state.artVariant]);
 const candidates=React.useMemo(()=>window.coverConfig.staged?[{afterTrackId:tracks[(state.index+5)%6].id,direction:1,track:currentTrack,artwork:currentArtwork}]:[],[currentTrack,currentArtwork]);
 const playback={track:currentTrack,artwork:currentArtwork,detailsPending:state.detailsPending,artworkPrefetchCandidates:candidates,selectionActivitySequence:state.sequence,selectionVisualIntent:state.intent,isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:()=>select((state.index+5)%6),onNext:()=>select((state.index+1)%6),onPrepareTrackPreview:prepare,onPrimeTrackArtwork:noop,onCommitTrackPreview:commit,onDiscardTrackPreview:noop,onPlayToggle:async r=>({requestId:r.requestId,completed:true}),onShuffleCycle:noop,onRepeatCycle:noop};
 const viewModel={playback,timeline:{positionSeconds:0,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop},volume:{valuePercent:50,isBusy:false,isDisabled:false,onChange:noop},queue:{tracks,isOpen:false,onToggle:noop},playlist:{isOpen:false,onOpenChange:noop,tracks,shuffleMode:'none',onShuffleCycle:noop},feedback:{onToggle:noop}};
 return React.createElement(AppearanceProvider,null,state.mounted&&React.createElement(PlayerSurface,{viewModel}));
}
function assertToken(p,id){if(!p||p.id!==id)throw Error('invalid preview token')}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__cover_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
console.log('BROWSER', browser.version(), 'BASELINE', ref)
async function open(source, dpr, refresh, reducedMotion = 'no-preference', hookSource) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: dpr, reducedMotion })
  const errors = []
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR', e.message) })
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', r => r.fulfill({ contentType: 'text/javascript', body: source }))
  if (hookSource) await page.route('**/src/features/player/hooks/useArtworkVisualResource.ts*',r=>r.fulfill({contentType:'text/javascript',body:hookSource}))
  await page.route('**/__cover_fixture.js', r => r.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__cover_test', r => r.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__cover_test')
  await page.waitForSelector('.track-card-plane[data-track-card-phase="active"] .cover-frame')
  await page.waitForTimeout(400)
  await page.evaluate(refresh => { window.coverConfig.refresh = refresh; window.coverEvents = [] }, refresh)
  return { page, errors }
}
async function drag(page, direction = 1, fraction = .95, release = true) {
  const cover = page.locator('.track-card-plane[data-track-card-phase="active"] .cover-frame').first()
  const box = await cover.boundingBox()
  assert(box, 'active cover geometry')
  const x = box.x + box.width * (direction > 0 ? .96 : .04), y = box.y + box.height * .35
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - direction * 18, y, { steps: 2 })
  await page.waitForSelector('.track-card-plane[data-track-card-phase="preview"]')
  await page.waitForTimeout(120)
  await page.mouse.move(x - direction * box.width * fraction, y, { steps: 8 })
  await page.waitForTimeout(90)
  if (release) await page.mouse.up()
}
async function assertRest(page, track, delay = 1100) {
  await page.waitForTimeout(delay)
  const state = await page.evaluate(() => ({
    active: [...document.querySelectorAll('.track-card-plane[data-track-card-phase="active"] .title-pill')].map(e => e.textContent),
    exiting: document.querySelectorAll('.track-card-plane[data-track-card-phase="exiting"]').length,
    incoming: document.querySelectorAll('.track-card-plane[data-track-card-phase="incoming"]').length,
    transforms: [...document.querySelectorAll('.track-card-plane[data-track-card-phase="active"]')].map(e => new DOMMatrixReadOnly(getComputedStyle(e).transform).isIdentity),
  }))
  assert.equal(state.active.length, 1, JSON.stringify(state))
  assert(state.active[0].includes('Song ' + track), JSON.stringify(state))
  assert.equal(state.exiting, 0, JSON.stringify(state))
  assert.equal(state.incoming, 0, JSON.stringify(state))
  assert(state.transforms.every(Boolean), JSON.stringify(state))
}
async function regress() {
  const {page,errors}=await open(compile(currentText,180),2,true)
  await drag(page);await assertRest(page,1)
  await drag(page,-1);await assertRest(page,0)
  await drag(page);await assertRest(page,1)
  await drag(page);await assertRest(page,2)
  assert.equal(await page.evaluate(()=>window.coverCommits.length),4)
  console.log('PASS forward, reverse and repeated committed drags')
  await page.evaluate(()=>{window.coverConfig.reject=true})
  await drag(page);await assertRest(page,2)
  await page.evaluate(()=>{window.coverConfig.reject=false})
  console.log('PASS rejected commit rolls back without changing selection')
  const before=await page.evaluate(()=>window.coverCommits.length)
  await drag(page,1,.1);await assertRest(page,2)
  assert.equal(await page.evaluate(()=>window.coverCommits.length),before)
  await drag(page,1,.6,false)
  await page.keyboard.press('Escape');await page.mouse.up();await assertRest(page,2)
  assert.equal(await page.evaluate(()=>window.coverCommits.length),before)
  console.log('PASS low progress rollback and Escape cancellation')
  await drag(page,1,.95,false)
  await page.evaluate(()=>window.coverSelect(4))
  await page.waitForFunction(()=>window.coverEvents.some(e=>e.type==='slots'&&e.slots.some(l=>l?.track==='track-4')))
  await page.mouse.up();await assertRest(page,4,1500)
  assert.equal(await page.evaluate(()=>window.coverCommits.length),before)
  console.log('PASS new selection invalidates live gesture')
  await drag(page,1,.95,false)
  await page.evaluate(()=>window.coverUpdate({mounted:false}))
  await page.mouse.up();await page.waitForTimeout(1100)
  assert.equal(await page.locator('.track-card-plane').count(),0)
  assert.deepEqual(errors,[])
  console.log('PASS unmount cancels pending gesture and callbacks')
  await page.close()

  const superseded=await open(compile(currentText,1000),2,true)
  await drag(superseded.page)
  await superseded.page.waitForTimeout(110)
  await superseded.page.evaluate(()=>window.coverSelect(3))
  await assertRest(superseded.page,3,1800)
  assert.deepEqual(superseded.errors,[])
  console.log('PASS new selection invalidates accepted pair and old watchdog')
  await superseded.page.close()

  const reduced=await open(compile(currentText,180),2,true,'reduce')
  await drag(reduced.page);await assertRest(reduced.page,1)
  assert.deepEqual(reduced.errors,[])
  console.log('PASS reduced motion committed drag')
  await reduced.page.close()
}
function compileHook(input) {
  let js=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText
  js=js.replaceAll('import.meta.env.DEV','true')
  js=js.replace(/import \{([^}]+)\} from ["']react["'];?/,(_line,names)=>`import hookReact from '${dependency('react.js')}'; const {${names}}=hookReact;`)
  return js.replace(/from ["']@\/([^"']+)["']/g,(_line,id)=>{
    const path='/src/'+id
    const ext=['.tsx','.ts','.js',''].find(ext=>existsSync(resolve(path.slice(1)+ext)))
    assert(ext!==undefined,'resolve '+id)
    return `from '${path}${ext}'`
  })
}
async function nativeLayerRegression() {
  // Both sides retain the first repair's PlayerSurface. Only the resource hook
  // varies, so this baseline is not the older unpatched surface from 20722d6.
  const currentHook=readFileSync(hookPath.slice(1),'utf8')
  const labels=process.env.SPMUSIC_COVER_BASELINE_ONLY?['before']:process.env.SPMUSIC_COVER_AFTER_ONLY?['after']:['before','after']
  for(const label of labels) for(const delay of [0,120]) {
    const {page,errors}=await open(compile(currentText,0),2,false,'no-preference',compileHook(label==='before'?hookBaselineText:currentHook))
    await page.evaluate(delay=>{
      window.coverConfig.staged=true
      window.coverUpdate({revision:1})
      let fired=false
      window.coverOnSlots=slots=>{
        const incoming=slots.find(l=>l?.phase==='incoming'&&l.previewTokenId!==undefined)
        if(!incoming||fired)return
        fired=true
        window.coverEvents.push({type:'details-scheduled',layerId:incoming.id,time:performance.now()})
        const refresh=()=>{window.coverEvents.push({type:'details-refresh',time:performance.now()});window.coverDetailRefresh()}
        if(delay===0)queueMicrotask(refresh)
        else setTimeout(refresh,delay)
      }
    },delay)
    await drag(page,1,.6)
    await assertRest(page,1,1000)
    const events=await page.evaluate(()=>window.coverEvents)
    const first=events.flatMap(e=>e.type==='slots'?e.slots:[]).find(l=>l?.phase==='incoming'&&l.track==='track-1'&&l.token!==undefined)
    assert(first,'committed preview entered incoming before details refresh')
    const replacements=events.flatMap(e=>e.type==='slots'?e.slots:[]).filter(l=>l?.phase==='incoming'&&l.track===first.track&&l.identity===first.identity&&l.id!==first.id)
    const refresh=events.find(e=>e.type==='details-refresh')
    assert(refresh,'real resource hook received staged details refresh')
    const automatic=events.find(e=>e.type==='session'&&e.session?.kind==='automatic'&&e.time>refresh.time)
    const replay=automatic&&events.some(e=>e.type==='progress'&&e.time>automatic.time&&e.value>0&&e.value<.3)
    console.log(JSON.stringify({scenario:'native-same-identity-details',label,delay,dpr:2,barrierDelay:0,firstIncoming:first.id,replacementIds:[...new Set(replacements.map(l=>l.id))],replay:Boolean(replay)}))
    if(process.env.SPMUSIC_COVER_TRACE)console.log(JSON.stringify(events))
    assert.deepEqual(errors,[])
    if(label==='before'&&delay===0) {
      assert(replacements.length>0,'first repair baseline replaces same-identity incoming')
      assert(replay,'first repair baseline restarts transition after layer replacement')
    } else {
      assert.equal(replacements.length,0,'same-identity same-selection incoming retains layer and token')
      assert(!replay,'details refresh does not restart the committed selection')
    }
    await page.close()
  }
  if(!process.env.SPMUSIC_COVER_BASELINE_ONLY) for(const mode of ['request','artwork','error']) {
    const {page,errors}=await open(compile(currentText,0),2,false,'no-preference',compileHook(currentHook))
    await page.evaluate(mode=>{
      window.coverConfig.staged=true
      window.coverUpdate({revision:1})
      let fired=false
      window.coverOnSlots=slots=>{
        if(fired||!slots.some(l=>l?.phase==='incoming'&&l.previewTokenId!==undefined))return
        fired=true
        queueMicrotask(()=>{
          window.coverEvents.push({type:'boundary-change',mode,time:performance.now()})
          if(mode==='request')window.coverNewRequest()
          else window.coverNewArtwork(mode)
        })
      }
    },mode)
    await drag(page,1,.6)
    await assertRest(page,1,1200)
    const events=await page.evaluate(()=>window.coverEvents)
    const first=events.flatMap(e=>e.type==='slots'?e.slots:[]).find(l=>l?.phase==='incoming'&&l.track==='track-1'&&l.token!==undefined)
    const change=events.find(e=>e.type==='boundary-change')
    assert(first&&change,'boundary change occurred while committed preview incoming')
    const subsequent=events.filter(e=>e.type==='slots'&&e.time>change.time).flatMap(e=>e.slots).filter(l=>l?.track==='track-1')
    assert(subsequent.some(l=>l.id!==first.id),'new request or content must not be swallowed by incoming dedup')
    if(mode==='request') {
      assert(subsequent.some(l=>l.identity===first.identity&&l.id!==first.id),'same identity newer request creates its own incoming')
      assert(events.some(e=>e.type==='session'&&e.session?.key==='selection:101'),'new request is consumed without unrelated prop refresh')
    } else assert(subsequent.some(l=>l.identity!==first.identity),'changed content has a distinct visual identity')
    if(mode==='error')assert.equal(await page.locator('.track-card-plane[data-track-card-phase="active"] .cover-art').getAttribute('data-has-image'),'false','invalid new artwork reaches existing empty fallback')
    assert.deepEqual(errors,[])
    console.log('PASS native incoming dedup boundary',mode)
    await page.close()
  }
}
function analyze(events) {
  const commit = events.find(e => e.type === 'commit')
  const promotion = events.find(e => e.type === 'slots' && e.time > commit?.time && e.slots.some(l => l?.phase === 'exiting'))
  const completion = events.find(e => e.type === 'progress' && e.time > commit?.time && e.value >= .999)
  const resets = events.filter(e => e.type === 'progress' && e.time > completion?.time && e.value < .01
    && e.slots.some(l=>l?.phase==='active') && e.slots.some(l=>l?.phase==='incoming'||l?.phase==='preview'))
  const automatic = events.filter(e => e.type === 'session' && e.session?.kind === 'automatic')
  const replays = automatic.filter(s => events.some(e => e.type === 'progress' && e.time >= s.time && e.value > .01 && e.value < .9))
  const retired = events.find(e => e.type === 'slots' && e.time > commit?.time && e.slots.some(l=>l?.track==='track-1'&&l.phase==='active')&&!e.slots.some(l=>l?.track==='track-0'))
  return { resets: resets.length, automatic: automatic.length, replays: replays.length, commitToCompleteMs: completion?.time - commit?.time, commitToPromotionMs: promotion?.time - commit?.time, commitToRetirementMs:retired?.time-commit?.time, maxProgress: Math.max(...events.filter(e => e.type === 'progress').map(e => e.value)) }
}
try {
  if (!process.env.SPMUSIC_COVER_NATIVE_ONLY) for (const label of process.env.SPMUSIC_COVER_BASELINE_ONLY ? ['before'] : process.env.SPMUSIC_COVER_AFTER_ONLY ? ['after'] : ['before', 'after']) {
    for (const dpr of [1, 2]) for (const {delay, refresh} of [{delay:180,refresh:false},{delay:180,refresh:true},{delay:1000,refresh:false}]) {
      const { page, errors } = await open(compile(label === 'before' ? baselineText : currentText, delay), dpr, refresh)
      await drag(page)
      await page.waitForTimeout(delay + 800)
      const events = await page.evaluate(() => window.coverEvents)
      const result = analyze(events)
      console.log(JSON.stringify({ label, dpr, delay, refresh, ...result }))
      if (process.env.SPMUSIC_COVER_TRACE) console.log(JSON.stringify(events))
      assert.equal(await page.evaluate(() => window.coverCommits.length), 1)
      assert.deepEqual(errors, [])
      if (label === 'before' && (refresh || delay > 800)) {
        assert(result.resets > 0, 'baseline exposes completed drag reset before promotion')
        assert(result.automatic > 0, 'baseline restarts same selection as automatic transition')
      } else {
        assert.equal(result.resets, 0, 'completed drag never resets before promotion')
        assert.equal(result.replays, 0, 'completed drag does not replay automatic transition')
        if (delay > 800) {
          assert(result.commitToRetirementMs < 1100, 'watchdog retires the accepted pair within its bounded deadline')
          assert(!events.some(e=>e.type==='paint-ready'), 'watchdog completes the previously painted preview before delayed incoming-only barrier')
        }
      }
      await assertRest(page,1,0)
      await page.close()
    }
  }
  if (!process.env.SPMUSIC_COVER_BASELINE_ONLY&&!process.env.SPMUSIC_COVER_NATIVE_ONLY) await regress()
  if(process.env.SPMUSIC_COVER_NATIVE_ONLY) await nativeLayerRegression()
  console.log('COVER_TRANSITION_PASS')
} finally { await browser.close() }
