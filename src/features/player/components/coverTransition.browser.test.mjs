// Optional real-browser regression. Start Vite and point SPMUSIC_PLAYWRIGHT
// at an existing Playwright package. No project dependency is installed.
// Only the incoming paint barrier is delayed in the in-memory served module;
// the production resource hook, gesture handlers and Motion animation run unchanged.
// SPMUSIC_COVER_NATIVE_ONLY=1 instead checks the native-trace incoming replacement:
// first-repair surface on both sides, old/new hook, and an unchanged paint barrier.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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
const motionBaselineText = process.env.SPMUSIC_COVER_MOTION_BASELINE_PATH
  ? readFileSync(process.env.SPMUSIC_COVER_MOTION_BASELINE_PATH, 'utf8') : baselineText
const hookPath = '/src/features/player/hooks/useArtworkVisualResource.ts'
const hookBaselineText = execFileSync('git', ['show', ref + ':' + hookPath.slice(1)], { encoding: 'utf8' })
function compile(input, delay) {
  input = input.replaceAll('\r\n', '\n')
  let source = input.replace('const retiringTrackCardProgress = useMotionValue(0)', `
  useLayoutEffect(() => trackCardProgress.on('change', value => window.coverEvents.push({type:'progress',value,animationTime:trackCardAnimationRef.current?.time,slots:artworkSlotsRef.current.map(l=>l&&({id:l.id,phase:l.phase,track:l.track.id})),time:performance.now()})), [trackCardProgress])
  useLayoutEffect(() => { window.coverFreezeAt = value => {trackCardAnimationRef.current?.stop();trackCardOvershootAnimationRef.current?.stop();trackCardProgress.set(value)} }, [trackCardProgress])
  const retiringTrackCardProgress = useMotionValue(0)`)
  source = source.replace('const retiringTrackCardProgress = useMotionValue(0)', `const retiringTrackCardProgress = useMotionValue(0)
  useLayoutEffect(() => retiringTrackCardProgress.on('change', value => window.coverEvents.push({type:'retiring-progress',value,animationTime:retiringTrackCardAnimationRef.current?.time,time:performance.now()})), [retiringTrackCardProgress])`)
  source = source.replace('const trackCardOvershootX = useMotionValue(0)', `const trackCardOvershootX = useMotionValue(0)
  useLayoutEffect(() => trackCardOvershootX.on('change', value => window.coverEvents.push({type:'overshoot',value,run:window.coverOvershootRun,animationTime:window.coverOvershootController?.time,time:performance.now()})), [trackCardOvershootX])`)
  source = source.replace('const animateTrackCardProgress = useCallback', `const coverRecordOvershoot = (value, target, options) => {
    const run = (window.coverOvershootRun || 0) + 1
    window.coverOvershootRun = run
    window.coverEvents.push({type:'overshoot-start',run,from:value.get(),target,durationSeconds:options.duration,width:window.coverLastGestureWidth ?? trackCardCoverGeometry?.width,time:performance.now()})
    const controls = animate(value, target, {...options,onComplete:()=>{window.coverEvents.push({type:'overshoot-complete',run,time:performance.now()});options.onComplete?.()}})
    window.coverOvershootController = controls
    return controls
  }
  const animateTrackCardProgress = useCallback`)
  source = source.replaceAll('animate(trackCardOvershootX,', 'coverRecordOvershoot(trackCardOvershootX,')
  source = source.replace('const hardResetTrackCardInteraction = useCallback', `window.coverReadMotion = () => ({progress:trackCardProgress.get(),offset:trackCardOvershootX.get()})
  window.coverResumeDragContext = () => {
    stopTrackCardAnimation(false)
    const context = trackCardSettleRef.current
    const saved = {progress:trackCardProgress.get(),seconds:context.durationSeconds,kind:context.session.kind}
    runTrackCardSettle(context)
    return {...saved,resumedSeconds:context.durationSeconds}
  }
  window.coverSaveResidual = () => {stopTrackCardAnimation(false);window.coverSavedSession=trackCardSessionRef.current;window.coverSavedOffset=trackCardOvershootX.get()}
  window.coverRunResidual = (restoreSaved = false) => {
    stopTrackCardAnimation(false)
    if(restoreSaved)trackCardOvershootX.set(window.coverSavedOffset)
    const session = trackCardSessionRef.current ?? window.coverSavedSession
    window.coverEvents.push({type:'residual-handoff',progress:trackCardProgress.get(),offset:trackCardOvershootX.get(),time:performance.now()})
    runTrackCardSettle({session,target:1,durationSeconds:0,overshootCoverWidth:window.coverLastGestureWidth,onComplete:()=>{window.coverEvents.push({type:'residual-complete',offset:trackCardOvershootX.get(),time:performance.now()});completeTrackCardExit(session.outgoingLayerId)}})
  }
  const hardResetTrackCardInteraction = useCallback`)
  source = source.replace('trackCardSessionRef.current = session', `window.coverEvents.push({type:'session',session,time:performance.now()}); trackCardSessionRef.current = session`)
  source = source.replace('const commitCoverDrag = useCallback((gesture: CoverDragGesture, releaseVelocityX: number) => {', `const commitCoverDrag = useCallback((gesture: CoverDragGesture, releaseVelocityX: number) => {window.coverLastGestureWidth=gesture.coverWidth;window.coverEvents.push({type:'fling-release',velocity:releaseVelocityX,progress:gesture.progress,direction:gesture.direction,width:gesture.coverWidth,time:performance.now()});`)
  source = source.replace('const controls = animate(trackCardProgress, target, {', `window.coverEvents.push({type:'animation-start',from:trackCardProgress.get(),target,durationSeconds,overshootPx,time:performance.now()}); const controls = animate(trackCardProgress, target, {`)
  source = source.replace('retiringTrackCardAnimationRef.current = animate(retiringTrackCardProgress, 1, {', `window.coverEvents.push({type:'retiring-start',from:retiringTrackCardProgress.get(),time:performance.now()}); retiringTrackCardAnimationRef.current = animate(retiringTrackCardProgress, 1, {`)
  source = source.replace(/(const controls = animate\(trackCardProgress, target, \{[\s\S]*?onComplete: \(\) => \{)/, `$1\n        if (window.coverConfig.dropCompletion) {window.coverEvents.push({type:'dropped-completion',time:performance.now()});return}`)
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
import { useAppearance } from '/src/features/appearance/hooks/useAppearance.ts';
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
 return React.createElement(AppearanceProvider,null,React.createElement(ThemeBridge),state.mounted&&React.createElement(PlayerSurface,{viewModel}));
}
function ThemeBridge(){const context=useAppearance();window.coverThemeSnapshot={motion:context.appearance.motion,commitEase:context.motion.trackCardCommitEase,commitSeconds:context.motion.trackCardCommitDurationSeconds,disabled:context.motion.disabled};window.coverSetMotion=patch=>context.previewAppearance({...context.appearance,motion:{...context.appearance.motion,...patch}});return null}
function assertToken(p,id){if(!p||p.id!==id)throw Error('invalid preview token')}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__cover_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
console.log('BROWSER', browser.version(), 'BASELINE', ref)
async function open(source, dpr, refresh, reducedMotion = 'no-preference', hookSource, videoDir) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: dpr, reducedMotion,
    ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1400, height: 900 } } } : {}) })
  const errors = []
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR', e.message) })
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', r => r.fulfill({ contentType: 'text/javascript', body: source }))
  if (hookSource) await page.route('**/src/features/player/hooks/useArtworkVisualResource.ts*',r=>r.fulfill({contentType:'text/javascript',body:hookSource}))
  await page.route('**/__cover_fixture.js', r => r.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__cover_test', r => r.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__cover_test')
  await page.waitForSelector('.track-card-plane[data-track-card-phase="active"] .cover-frame')
  await page.waitForTimeout(400)
  // Older calibration modes describe their original drag timing. Keep that
  // reference explicit; the speed mode must exercise the real new default.
  const referenceTiming = process.env.SPMUSIC_COVER_MOTION_ONLY || process.env.SPMUSIC_COVER_CLICK_ONLY
    || process.env.SPMUSIC_COVER_DRAG_ONLY || process.env.SPMUSIC_COVER_OVERSHOOT_ONLY
  if (referenceTiming && !process.env.SPMUSIC_COVER_SPEED_ONLY) {
    await page.evaluate(() => window.coverSetMotion({ trackDragDurationScale: 1 }))
    await page.waitForTimeout(80)
  }
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

  await reducedRegression(currentText)
}
async function reducedRegression(source) {
  const reduced=await open(compile(source,180),2,true,'reduce')
  await drag(reduced.page);await assertRest(reduced.page,1)
  await reduced.page.evaluate(()=>{window.coverEvents=[];window.coverSelect(2)})
  await assertRest(reduced.page,2)
  assert.equal(await reduced.page.evaluate(()=>window.coverEvents.find(e=>e.type==='animation-start'&&e.target===1)?.durationSeconds),.08,'reduced motion keeps its existing 80ms automatic transition')
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
// Run separately from the historical paint-barrier regression:
// SPMUSIC_COVER_MOTION_ONLY=1 SPMUSIC_COVER_MOTION_BASELINE_PATH=<pre-change PlayerSurface>
// Optional SPMUSIC_COVER_MOTION_OUTPUT_DIR writes JSON traces; set
// SPMUSIC_COVER_MOTION_VIDEO=1 as well to record videos (requires Playwright ffmpeg).
function motionTiming(events) {
  const start = events.find(e => e.type === 'animation-start' && e.target === 1)
  assert(start, 'automatic selection starts its real Motion animation')
  const completion = events.find(e => e.type === 'progress' && e.time >= start.time && e.value >= .999)
  assert(completion, 'automatic selection completes')
  const samples = [{ time: start.time, value: start.from }, ...events.filter(e =>
    e.type === 'progress' && e.time >= start.time && e.time <= completion.time)]
  assert(samples.length >= 8, 'enough real browser frames to characterize motion')
  for (let index = 1; index < samples.length; index += 1) {
    assert(samples[index].value >= samples[index - 1].value - .00001, 'committed motion is monotonic')
    assert(samples[index].value >= 0 && samples[index].value <= 1, 'committed progress remains bounded')
  }
  const valueAt = fraction => {
    const time = start.time + start.durationSeconds * 1000 * fraction
    const rightIndex = samples.findIndex(s => s.time >= time)
    assert(rightIndex > 0, 'sample brackets requested timeline position')
    const left = samples[rightIndex - 1], right = samples[rightIndex]
    return left.value + (right.value - left.value) * (time - left.time) / (right.time - left.time)
  }
  return { durationMs: completion.time - start.time, declaredDurationMs: start.durationSeconds * 1000,
    quarter: valueAt(.25), half: valueAt(.5), threeQuarter: valueAt(.75), samples }
}
async function motionRegression() {
  const outputDir = process.env.SPMUSIC_COVER_MOTION_OUTPUT_DIR
  if (outputDir) mkdirSync(outputDir, { recursive: true })
  const results = []
  const labels = process.env.SPMUSIC_COVER_BASELINE_ONLY ? ['before']
    : process.env.SPMUSIC_COVER_AFTER_ONLY ? ['after'] : ['before', 'after']
  for (const label of labels) for (const direction of [1, -1]) {
    const recording = outputDir && process.env.SPMUSIC_COVER_MOTION_VIDEO && direction === 1 ? outputDir : undefined
    const { page, errors } = await open(compile(label === 'before' ? motionBaselineText : currentText, 0), 2, false, 'no-preference', undefined, recording)
    // This mode retains the first calibration's linear -> ease-out contract,
    // independently of subsequent changes to the application's default.
    if (label === 'after') {
      await page.evaluate(() => window.coverSetMotion({ trackSwitchEasing: 'ease-out', trackSwitchDurationMs: 300 }))
      await page.waitForTimeout(80)
    }
    // Start away from the fixture's wrapping endpoints so next/previous carry
    // their actual direction through the same controls used by the player.
    await page.evaluate(() => window.coverSelect(2))
    await assertRest(page, 2, 600)
    await page.evaluate(() => { window.coverEvents = [] })
    await page.getByRole('button', { name: direction === 1 ? '下一首' : '上一首', exact: true }).click()
    await assertRest(page, 2 + direction, 600)
    const timing = motionTiming(await page.evaluate(() => window.coverEvents))
    assert.equal(timing.declaredDurationMs, 300, 'full automatic motion retains its 300ms duration')
    const summary = { label, direction, ...timing }
    results.push(summary)
    console.log('MOTION', JSON.stringify({ ...summary, samples: timing.samples.length }))
    if (label === 'before') assert(Math.abs(timing.half - .5) < .08, 'baseline exposes a linear midpoint')
    else {
      assert(timing.quarter > .31 && timing.half > .6, 'default committed motion advances faster early')
      assert(timing.half - timing.quarter > 1 - timing.threeQuarter, 'default committed motion decelerates near rest')
      await page.evaluate(() => window.coverSetMotion({ trackSwitchEasing: 'linear' }))
      await page.waitForTimeout(80)
      await page.evaluate(() => { window.coverEvents = []; window.coverSelect(2) })
      await assertRest(page, 2, 600)
      const linear = motionTiming(await page.evaluate(() => window.coverEvents))
      assert(Math.abs(linear.half - .5) < .08, 'independent theme setting can restore linear committed motion')
      assert(timing.half - linear.half > .08, 'theme setting changes the observed timeline')
      results.push({ label: 'after-linear', direction, ...linear })
    }
    assert.deepEqual(errors, [])
    const video = page.video()
    await page.close()
    if (recording) renameSync(await video.path(), resolve(outputDir, 'track-switch-' + label + '.webm'))
  }
  if (outputDir) writeFileSync(resolve(outputDir, 'track-switch-timing.json'), JSON.stringify(results, null, 2) + '\n')
  if (!process.env.SPMUSIC_COVER_BASELINE_ONLY) {
    const { page, errors } = await open(compile(currentText, 0), 2, false)
    await page.evaluate(() => window.coverSetMotion({ trackSwitchEasing: 'ease-out', trackSwitchDurationMs: 300 }))
    await page.waitForTimeout(80)
    await page.evaluate(() => window.coverSelect(2))
    await assertRest(page, 2, 600)
    await page.evaluate(() => { window.coverSelect(3); setTimeout(() => window.coverSelect(1), 90) })
    await assertRest(page, 1, 800)
    console.log('PASS automatic selection superseded during eased completion')
    // Keep all existing gesture, cancellation, rejection, unmount and reduced
    // motion assertions; these guard the unchanged gesture/lifecycle contract.
    assert.deepEqual(errors, [])
    await page.close()
    await regress()
  }
}
// The second calibration compares the former ease-out/300ms configuration
// against the real application default. The old component is paired with an
// explicit old theme configuration; no current default is called a baseline.
// SPMUSIC_COVER_CLICK_ONLY=1 SPMUSIC_COVER_MOTION_BASELINE_PATH=<click/before/PlayerSurface.tsx>
async function clickRegression() {
  const outputDir = process.env.SPMUSIC_COVER_MOTION_OUTPUT_DIR
  if (outputDir) mkdirSync(outputDir, { recursive: true })
  const results = [], poses = new Map()
  const configuredCurve = 'cubic-bezier(.4, 0, .2, 1)'
  for (const label of ['before', 'after']) for (const direction of [1, -1]) {
    const { page, errors } = await open(compile(label === 'before' ? motionBaselineText : currentText, 0), 2, false)
    if (label === 'before') {
      await page.evaluate(() => window.coverSetMotion({ trackSwitchEasing: 'ease-out', trackSwitchDurationMs: 300 }))
      await page.waitForTimeout(80)
    }
    const theme = await page.evaluate(() => window.coverThemeSnapshot)
    assert.equal(theme.motion.trackSwitchEasing, label === 'before' ? 'ease-out' : configuredCurve)
    assert.deepEqual(theme.commitEase, label === 'before' ? [0, 0, .58, 1] : [.4, 0, .2, 1], 'actual runtime uses the intended curve')
    if (label === 'after') {
      assert.equal(theme.motion.trackSwitchDurationMs, 500, 'real default duration is loaded without a fixture override')
      assert.equal(theme.commitSeconds, .5)
    }
    await page.evaluate(() => window.coverSelect(2))
    await assertRest(page, 2, 800)
    await page.evaluate(() => { window.coverEvents = [] })
    await page.getByRole('button', { name: direction === 1 ? '下一首' : '上一首', exact: true }).click()
    await assertRest(page, 2 + direction, 800)
    const timing = motionTiming(await page.evaluate(() => window.coverEvents))
    assert.equal(timing.declaredDurationMs, label === 'before' ? 300 : 500)
    const expected = label === 'before' ? [.378, .685, .907] : [.237, .775, .959]
    for (const [index, value] of [timing.quarter, timing.half, timing.threeQuarter].entries()) {
      assert(Math.abs(value - expected[index]) < .055, 'observed curve matches the selected calibration within browser frame tolerance')
    }
    assert(timing.durationMs >= timing.declaredDurationMs * .85 && timing.durationMs < timing.declaredDurationMs + 120, 'real completion time retains the configured duration')
    if (label === 'after') {
      const before = results.find(r => r.label === 'before' && r.direction === direction)
      assert(timing.quarter < before.quarter - .08, 'new onset advances less than the old ease-out at a quarter time')
      assert(timing.half > before.half + .04, 'new middle catches up and overtakes the old ease-out')
      assert(1 - timing.threeQuarter < (1 - before.threeQuarter) * .75, 'the last quarter has less distance left to settle')
      assert(timing.half - timing.quarter > 1 - timing.threeQuarter, 'middle travel is faster than the ending travel')
    }
    results.push({ label, direction, theme, ...timing })
    console.log('CLICK_MOTION', JSON.stringify({ label, direction, ...timing, samples: timing.samples.length }))
    // Freeze the same real component at equal progress on a fresh selection.
    // This compares DOM transforms/opacity rather than two elapsed-time poses.
    await page.evaluate(() => { window.coverEvents = []; window.coverSelect(2) })
    await page.waitForFunction(() => window.coverEvents.some(e => e.type === 'animation-start'))
    const snapshots = []
    for (const progress of [.25, .5, .75]) {
      snapshots.push(await page.evaluate(async progress => {
        window.coverFreezeAt(progress)
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return [...document.querySelectorAll('.track-card-plane')].map(plane => ({
          transform: getComputedStyle(plane).transform,
          opacity: getComputedStyle(plane.querySelector('.track-card-content')).opacity,
        })).sort((a, b) => a.transform.localeCompare(b.transform))
      }, progress))
    }
    if (label === 'before') poses.set(direction, snapshots)
    else assert.deepEqual(snapshots, poses.get(direction), 'equal progress preserves the real cover geometry and opacity')
    await assertRest(page, 2, 1500)
    if (label === 'after') {
      await page.evaluate(() => window.coverSetMotion({ trackSwitchEasing: 'linear' }))
      await page.waitForTimeout(80)
      await page.evaluate(() => { window.coverEvents = []; window.coverSelect(3) })
      await assertRest(page, 3, 800)
      const linear = motionTiming(await page.evaluate(() => window.coverEvents))
      assert(Math.abs(linear.half - .5) < .08, 'theme linear override remains effective')
      assert.equal(linear.declaredDurationMs, 500, 'changing curve preserves the independent duration')
      results.push({ label: 'after-linear', direction, ...linear })
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  if (outputDir) writeFileSync(resolve(outputDir, 'click-switch-timing.json'), JSON.stringify(results, null, 2) + '\n')
  const { page, errors } = await open(compile(currentText, 0), 2, false)
  await page.evaluate(() => window.coverSetMotion({ trackSwitchDurationMs: 600, durationScale: 3 }))
  await page.waitForTimeout(80)
  await page.evaluate(() => { window.coverEvents = []; window.coverSelect(2) })
  await assertRest(page, 2, 900)
  const maximum = motionTiming(await page.evaluate(() => window.coverEvents))
  assert.equal(maximum.declaredDurationMs, 600, 'commit duration does not multiply by global durationScale')
  assert(maximum.durationMs > 520 && maximum.durationMs < 720, 'maximum configuration keeps its full completion timeline')
  await page.evaluate(() => { window.coverEvents = [] })
  await drag(page, 1, .1)
  await assertRest(page, 2, 1500)
  const cancelEvents = await page.evaluate(() => window.coverEvents)
  const cancel = cancelEvents.find(e => e.type === 'animation-start' && e.target === 0)
  assert(cancel, 'low progress release runs the cancellation animation')
  assert(Math.abs(cancel.durationSeconds - 1.14) < .00001, 'cancellation keeps its existing scale3 timeline')
  const home = cancelEvents.find(e => e.type === 'progress' && e.time >= cancel.time && e.value === 0)
  assert(home && home.time - cancel.time > 1050, 'watchdog does not truncate scale3 cancellation at 800ms')
  assert.equal(await page.evaluate(() => window.coverCommits.length), 0)
  console.log('PASS maximum 600ms / scale3 and uncropped scale3 cancellation', JSON.stringify({ maximumMs: maximum.durationMs, cancelMs: home.time - cancel.time }))
  await page.evaluate(() => { window.coverEvents = [] })
  await drag(page, 1, .1)
  await page.evaluate(() => setTimeout(() => window.coverSetMotion({ durationScale: 1 }), 100))
  await assertRest(page, 2, 1500)
  const changedEvents = await page.evaluate(() => window.coverEvents)
  const changedCancel = changedEvents.find(e => e.type === 'animation-start' && e.target === 0)
  const changedHome = changedEvents.find(e => e.type === 'progress' && e.time >= changedCancel.time && e.value === 0)
  assert(changedHome && changedHome.time - changedCancel.time > 1050, 'a later scale1 setting must not truncate a cancellation that started at scale3')
  console.log('PASS running cancellation retains its original watchdog budget after theme update', JSON.stringify({ cancelMs: changedHome.time - changedCancel.time }))
  await page.evaluate(() => window.coverSetMotion({ trackSwitchDurationMs: 500, durationScale: 1 }))
  await page.waitForTimeout(80)
  await page.evaluate(() => { window.coverEvents = []; window.coverConfig.dropCompletion = true; window.coverSelect(3) })
  await assertRest(page, 3, 1500)
  const dropped = await page.evaluate(() => window.coverEvents)
  assert(dropped.some(e => e.type === 'dropped-completion'), 'the test actually drops the Motion completion callback')
  const start = dropped.find(e => e.type === 'animation-start')
  const exit = dropped.find(e => e.type === 'exit' && e.time >= start.time)
  assert(exit && exit.time - start.time >= 750 && exit.time - start.time < 1400, 'watchdog retires the interrupted callback within its bounded deadline')
  assert.deepEqual(errors, [])
  await page.close()
  console.log('PASS dropped completion callback is bounded by the watchdog')
  await regress()
}
function bezierCoordinate(parameter, first, second) {
  return 3 * (1 - parameter) ** 2 * parameter * first + 3 * (1 - parameter) * parameter ** 2 * second + parameter ** 3
}
function bezierParameter(value, first, second) {
  let low = 0, high = 1
  for (let index = 0; index < 60; index += 1) {
    const middle = (low + high) / 2
    if (bezierCoordinate(middle, first, second) < value) low = middle
    else high = middle
  }
  return (low + high) / 2
}
const switchProgressAtTime = time => bezierCoordinate(bezierParameter(Math.min(1, Math.max(0, time)), .4, .2), 0, 1)
const switchTimeAtProgress = progress => bezierCoordinate(bezierParameter(progress, 0, 1), .4, .2)
function dragTiming(events, tail, fullDurationMs = 500) {
  const start = events.find(e => e.type === 'animation-start' && e.target === 1)
  assert(start, 'release starts a committed settle')
  const release = events.find(e => e.type === 'release-marker')
  assert(release && Math.abs(release.value - start.from) < .000001, 'release retains the exact last pointer pose')
  const samples = events.filter(e => e.type === 'progress' && e.time >= start.time && e.value >= start.from)
  if (process.env.SPMUSIC_COVER_TRACE) console.log('DRAG_CLOCK', JSON.stringify({ start, points: samples.filter((_s, index) => index % 12 === 0).map(s => ({ ms: s.time - start.time, value: s.value })) }))
  const completion = samples.find(e => e.value >= .999)
  assert(completion, 'committed release reaches the final pose')
  const startTime = switchTimeAtProgress(start.from)
  const expectedMs = tail ? fullDurationMs * (1 - startTime) : fullDurationMs * Math.max(.15, 1 - start.from)
  assert(Math.abs(start.durationSeconds * 1000 - expectedMs) < .5, 'settle duration follows its respective baseline or tail timeline')
  let maxError = 0, worst = null, previous = start.from
  for (const sample of samples.filter(s => s.time <= completion.time)) {
    if (tail) assert(Number.isFinite(sample.animationTime), 'sample captures the real Motion controller clock')
    const elapsed = sample.animationTime * 1000
    const expected = tail ? switchProgressAtTime(startTime + elapsed / fullDurationMs)
      : start.from + (1 - start.from) * switchProgressAtTime(elapsed / expectedMs)
    if (Math.abs(sample.value - expected) > maxError) {
      maxError = Math.abs(sample.value - expected)
      worst = { elapsed, value: sample.value, expected }
    }
    assert(sample.value >= previous - .000001, 'settle continues monotonically from release')
    previous = sample.value
  }
  if (tail) assert(maxError < .04, 'Motion timeline follows the curve tail: ' + JSON.stringify({ start, maxError, worst, tail }))
  return { from: start.from, durationMs: start.durationSeconds * 1000, timeTo999Ms: completion.time - start.time, maxError }
}
// SPMUSIC_COVER_DRAG_ONLY=1 SPMUSIC_COVER_MOTION_BASELINE_PATH=<drag/before.tsx>
async function dragRegression() {
  const results = [], heldPoses = new Map()
  for (const label of process.env.SPMUSIC_COVER_AFTER_ONLY ? ['after'] : ['before', 'after']) for (const direction of [1, -1]) {
    const { page, errors } = await open(compile(label === 'before' ? motionBaselineText : currentText, 0), 2, false)
    if (process.env.SPMUSIC_COVER_TRACE) console.log('DRAG_THEME', JSON.stringify(await page.evaluate(() => window.coverThemeSnapshot)))
    for (const progress of [.35, .7, .9]) {
      await page.evaluate(() => window.coverSelect(2))
      await assertRest(page, 2, 800)
      await page.evaluate(() => { window.coverEvents = [] })
      await drag(page, direction, progress * .55, false)
      const held = await page.evaluate(() => {
        const value = window.coverEvents.filter(e => e.type === 'progress').at(-1)?.value
        window.coverEvents.push({ type: 'release-marker', value, time: performance.now() })
        return { value, poses: [...document.querySelectorAll('.track-card-plane')].map(plane => ({
          transform: getComputedStyle(plane).transform, opacity: getComputedStyle(plane.querySelector('.track-card-content')).opacity,
        })).sort((a, b) => a.transform.localeCompare(b.transform)) }
      })
      assert(Math.abs(held.value - progress) < .02, 'pointer remains directly mapped to the intended held progress')
      const key = direction + ':' + progress
      if (label === 'before') heldPoses.set(key, held)
      else if (heldPoses.has(key)) assert.deepEqual(held, heldPoses.get(key), 'held pointer progress, geometry and opacity are unchanged')
      await page.mouse.up()
      await assertRest(page, 2 + direction, 800)
      const timing = dragTiming(await page.evaluate(() => window.coverEvents), label === 'after')
      results.push({ label, direction, progress, ...timing })
      console.log('DRAG_TAIL', JSON.stringify(results.at(-1)))
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  const outputDir = process.env.SPMUSIC_COVER_MOTION_OUTPUT_DIR
  if (outputDir) {
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(resolve(outputDir, 'drag-tail-timing.json'), JSON.stringify(results, null, 2) + '\n')
  }
  await dragInteractionRegression()
}
async function dragInteractionRegression() {
  const { page, errors } = await open(compile(currentText, 0), 2, false)
  await page.evaluate(() => window.coverSelect(2))
  await assertRest(page, 2, 800)
  await page.evaluate(() => { window.coverEvents = [] })
  await page.getByRole('button', { name: '下一首', exact: true }).click()
  await assertRest(page, 3, 800)
  const button = motionTiming(await page.evaluate(() => window.coverEvents))
  assert.equal(button.declaredDurationMs, 500)
  assert(Math.abs(button.quarter - .237) < .055 && Math.abs(button.half - .775) < .055 && Math.abs(button.threeQuarter - .959) < .055, 'full button animation retains its calibrated curve')
  console.log('PASS button keeps its complete 500ms timeline')
  await page.evaluate(() => window.coverSelect(2))
  await assertRest(page, 2, 800)
  await page.evaluate(() => { window.coverEvents = []; window.coverSelect(3) })
  await page.waitForTimeout(70)
  // During a turn the incoming cover's projected AABB is moving. Press the
  // real persistent input region at the resting cover position instead.
  const region = await page.locator('.cover-input-region').boundingBox()
  assert(region, 'stable cover input geometry')
  const x = region.x + region.width * .8, y = region.y + region.height * .35
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 18, y, { steps: 2 })
  await page.waitForSelector('.track-card-plane[data-track-card-phase="preview"]')
  await page.mouse.move(x - region.width * .7 * .55, y, { steps: 8 })
  await page.waitForTimeout(550)
  await page.mouse.up()
  await assertRest(page, 4, 1300)
  const retiring = await page.evaluate(() => window.coverEvents)
  const retiringStart = retiring.find(e => e.type === 'retiring-start')
  assert(retiringStart, 'real pointer interruption exercises the retiring animation path')
  const retiringSamples = retiring.filter(e => e.type === 'retiring-progress' && e.time >= retiringStart.time)
  assert(retiringSamples.some(e => e.value >= .999), 'retiring card completes instead of remaining stranded')
  const t0 = switchTimeAtProgress(retiringStart.from)
  for (const sample of retiringSamples) {
    assert(Number.isFinite(sample.animationTime), 'retiring sample captures the real Motion controller clock')
    assert(Math.abs(sample.value - switchProgressAtTime(t0 + sample.animationTime / .5)) < .04, 'retiring card follows the same curve tail')
  }
  await page.evaluate(() => window.coverSelect(2))
  await assertRest(page, 2, 800)
  await page.evaluate(() => { window.coverEvents = []; window.coverSelect(3) })
  await page.waitForTimeout(70)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 18, y, { steps: 2 })
  await page.waitForSelector('.track-card-plane[data-track-card-phase="preview"]')
  await page.mouse.move(x - region.width * .1 * .55, y, { steps: 8 })
  await page.waitForTimeout(550)
  await page.mouse.up()
  await assertRest(page, 3, 1600)
  const canceled = await page.evaluate(() => window.coverEvents)
  assert(canceled.some(e => e.type === 'session' && e.session?.outgoingReturnToCenter), 'canceling the caught card exercises recenter')
  assert(canceled.some(e => e.type === 'animation-start' && e.target === 1 && Math.abs(e.durationSeconds - .19) < .00001), 'recenter retains its 190ms local timeline')
  assert.deepEqual(errors, [])
  await page.close()
  console.log('PASS interrupted button / retiring card uses its remaining curve tail')
  await regress()
}
async function fling(page, direction = 1, fraction = .6) {
  const box = await page.locator('.track-card-plane[data-track-card-phase="active"] .cover-frame').first().boundingBox()
  assert(box, 'fast pointer input has a real cover')
  const x = box.x + box.width * (direction > 0 ? .96 : .04), y = box.y + box.height * .35
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - direction * 18, y, { steps: 2 })
  await page.waitForSelector('.track-card-plane[data-track-card-phase="preview"]')
  await page.waitForTimeout(120)
  await page.mouse.move(x - direction * 26, y)
  // One fresh physical move followed immediately by pointerup retains velocity;
  // the normal drag helper deliberately waits 90ms and cannot cover this path.
  // Queue these ordered CDP input commands in the same client turn: waiting
  // for a separate roundtrip can exhaust the product's 70ms freshness window.
  const move = page.mouse.move(x - direction * box.width * fraction, y)
  const release = page.mouse.up()
  await Promise.all([move, release])
}
function overshootTiming(events, before = false, fullSeconds = .5, scale = 1) {
  const commit = events.find(e => e.type === 'animation-start' && e.overshootPx !== 0)
  assert(commit, 'real pointer velocity actually triggers overshoot: ' + JSON.stringify(events.filter(e => e.type === 'fling-release')))
  const outward = events.find(e => e.type === 'overshoot-start' && e.target !== 0)
  assert(outward, 'fast release runs the outward offset animation')
  assert(Math.abs(Math.abs(outward.target) / outward.width - .07) < .00001, 'overshoot amplitude remains seven percent of captured cover width: ' + JSON.stringify(outward))
  const start = events.find(e => e.type === 'overshoot-start' && e.target === 0 && e.from !== 0)
  assert(start, 'the painted nonzero offset enters a return animation')
  const complete = events.find(e => e.type === 'overshoot-complete' && e.run === start.run)
  assert(complete, 'return completes through its own Motion callback')
  const fraction = Math.abs(start.from) / start.width
  const t0 = switchTimeAtProgress(1 - fraction)
  const expectedMs = before ? 90 * scale : fullSeconds * 1000 * (1 - t0)
  assert(Math.abs(start.durationSeconds * 1000 - expectedMs) < 1, 'return uses the expected old or theme-tail duration')
  const samples = events.filter(e => e.type === 'overshoot' && e.run === start.run && e.time >= start.time && e.time <= complete.time)
  assert(samples.length >= 5, 'return has independently sampled moving frames')
  let previous = Math.abs(start.from), maxError = 0
  for (const sample of samples) {
    assert(Number.isFinite(sample.animationTime), 'return samples use its real Motion controller clock')
    assert(Math.abs(sample.value) <= previous + .00001 && sample.value * start.from >= -.00001, 'offset continuously approaches zero without reversal')
    if (!before) {
      const expected = Math.sign(start.from) * start.width * (1 - switchProgressAtTime(t0 + sample.animationTime / fullSeconds))
      maxError = Math.max(maxError, Math.abs(sample.value - expected) / start.width)
    }
    previous = Math.abs(sample.value)
  }
  assert(maxError < .002, 'offset return follows the independently calculated theme tail')
  assert.equal(samples.at(-1).value, 0)
  return { offsetPx: start.from, width: start.width, durationMs: start.durationSeconds * 1000,
    wallMs: complete.time - start.time, maxError, samples: samples.length }
}
// SPMUSIC_COVER_OVERSHOOT_ONLY=single first verifies one physical fling;
// value 1 compares the saved before component in both directions.
async function overshootRegression() {
  if (process.env.SPMUSIC_COVER_OVERSHOOT_ONLY === 'interaction') return overshootInteractions()
  if (process.env.SPMUSIC_COVER_OVERSHOOT_ONLY === 'lifecycle') {
    const test = await open(compile(currentText, 0), 2, false)
    return overshootLifecycle(test.page, test.errors)
  }
  const single = process.env.SPMUSIC_COVER_OVERSHOOT_ONLY === 'single'
  const results = []
  for (const label of single ? ['after'] : ['before', 'after']) for (const direction of single ? [1] : [1, -1]) {
    const { page, errors } = await open(compile(label === 'before' ? motionBaselineText : currentText, 0), 2, false)
    await page.evaluate(() => window.coverSelect(2))
    await assertRest(page, 2, 800)
    await page.evaluate(() => { window.coverEvents = [] })
    await fling(page, direction)
    await assertRest(page, 2 + direction)
    const events = await page.evaluate(() => window.coverEvents)
    const timing = overshootTiming(events, label === 'before')
    results.push({ label, direction, ...timing })
    console.log('OVERSHOOT', JSON.stringify(results.at(-1)))
    assert.deepEqual(errors, [])
    await page.close()
  }
  const outputDir = process.env.SPMUSIC_COVER_MOTION_OUTPUT_DIR
  if (outputDir) {
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(resolve(outputDir, 'overshoot-timing.json'), JSON.stringify(results, null, 2) + '\n')
  }
  if (!single) await overshootInteractions()
}
async function overshootInteractions() {
  const { page, errors } = await open(compile(currentText, 0), 2, false)
  await page.evaluate(() => window.coverSelect(2))
  await assertRest(page, 2, 800)
  await page.evaluate(() => { window.coverEvents = [] })
  await page.getByRole('button', { name: '下一首', exact: true }).click()
  await assertRest(page, 3, 800)
  const button = motionTiming(await page.evaluate(() => window.coverEvents))
  assert.equal(button.declaredDurationMs, 500)
  assert(Math.abs(button.half - .775) < .055, 'button keeps its original calibrated 500ms curve')
  await page.evaluate(() => window.coverSelect(2))
  await assertRest(page, 2, 800)
  await page.evaluate(() => { window.coverEvents = [] })
  await fling(page)
  await page.waitForFunction(() => window.coverEvents.some(e => e.type === 'overshoot-start' && e.target === 0))
  await page.evaluate(() => window.coverRunResidual())
  await assertRest(page, 3)
  const residual = await page.evaluate(() => window.coverEvents)
  const handoff = residual.find(e => e.type === 'residual-handoff')
  assert.equal(handoff.progress, 1, 'saved real fling is already at the final progress')
  assert(Math.abs(handoff.offset) > 0, 'saved real fling still has a painted residual offset')
  const resumed = residual.find(e => e.type === 'overshoot-start' && e.target === 0 && e.time >= handoff.time)
  assert(resumed && resumed.from === handoff.offset, 'zero-duration progress resumes the exact saved offset: ' + JSON.stringify({ handoff, resumed, returns: residual.filter(e => e.type === 'overshoot-start') }))
  const completed = residual.filter(e => e.type === 'residual-complete')
  assert.equal(completed.length, 1)
  assert.equal(completed[0].offset, 0)
  assert(completed[0].time - resumed.time > resumed.durationSeconds * 1000 - 25, 'progress completion waits for the nonzero offset return')
  overshootTiming(residual.filter(e => e.type !== 'overshoot-start' || e.target !== 0 || e.time >= handoff.time))
  console.log('PASS real saved offset / p=1 zero-duration join remains continuous and completes once')
  await page.evaluate(() => window.coverSelect(2))
  await assertRest(page, 2, 800)
  await page.evaluate(() => window.coverSetMotion({ trackSwitchDurationMs: 600, durationScale: 3 }))
  await page.waitForTimeout(80)
  await page.evaluate(() => { window.coverEvents = [] })
  await fling(page, 1, .22)
  await page.evaluate(() => window.coverSetMotion({ trackSwitchDurationMs: 80, durationScale: 1, trackSwitchEasing: 'linear' }))
  await page.setViewportSize({ width: 1200, height: 900 })
  await assertRest(page, 3, 1600)
  const scaled = await page.evaluate(() => window.coverEvents)
  const timing = overshootTiming(scaled, false, 1.8)
  const start = scaled.find(e => e.type === 'animation-start' && e.overshootPx !== 0)
  const returnStart = scaled.find(e => e.type === 'overshoot-start' && e.target === 0)
  const end = scaled.find(e => e.type === 'overshoot-complete' && e.run === returnStart.run)
  assert(end.time - start.time > start.durationSeconds * 1000 + timing.durationMs - 30, 'theme changes cannot shorten the captured serial watchdog budget')
  console.log('PASS scale3 / 600ms return retains captured theme, width and completion budget', JSON.stringify(timing))
  await overshootLifecycle(page, errors)
}
async function overshootLifecycle(page, errors) {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.evaluate(() => window.coverSetMotion({ trackSwitchDurationMs: 500, durationScale: 1, trackSwitchEasing: 'cubic-bezier(.4, 0, .2, 1)' }))
  await page.waitForTimeout(80)
  await page.evaluate(() => window.coverSelect(2))
  await assertRest(page, 2, 800)
  await page.evaluate(() => { window.coverEvents = [] })
  await fling(page)
  await page.waitForFunction(() => window.coverEvents.some(e => e.type === 'overshoot-start' && e.target === 0))
  await page.evaluate(() => { window.coverSaveResidual(); window.coverSetMotion({ level: 'off' }) })
  await page.waitForFunction(() => window.coverThemeSnapshot.disabled)
  // Switching off normally clears the live visual session. Restore only the
  // offset/session saved from that real fling to cover the new-run guard;
  // this is controlled branch coverage, not a claimed natural reproduction.
  await page.evaluate(() => window.coverRunResidual(true))
  await assertRest(page, 3)
  const disabled = await page.evaluate(() => window.coverEvents)
  const disabledHandoff = disabled.find(e => e.type === 'residual-handoff')
  assert(disabledHandoff.offset !== 0, 'off-mode test starts with a real saved residual')
  assert(!disabled.some(e => e.type === 'overshoot-start' && e.time >= disabledHandoff.time), 'a new off-mode run does not start a long return')
  assert.equal(disabled.find(e => e.type === 'residual-complete')?.offset, 0)
  console.log('PASS disabled motion clears a saved residual on the new run')
  await page.evaluate(() => window.coverSetMotion({ level: 'subtle' }))
  await page.waitForFunction(() => !window.coverThemeSnapshot.disabled)
  await page.evaluate(() => window.coverSelect(2))
  await assertRest(page, 2, 800)
  await page.evaluate(() => { window.coverEvents = [] })
  await fling(page)
  await page.waitForFunction(() => window.coverEvents.some(e => e.type === 'overshoot-start' && e.target === 0))
  const unmount = await page.evaluate(() => {
    const run = window.coverEvents.find(e => e.type === 'overshoot-start' && e.target === 0).run
    window.coverUpdate({ mounted: false })
    return { run, time: performance.now() }
  })
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.track-card-plane').count(), 0)
  assert(!await page.evaluate(({ run, time }) => window.coverEvents.some(e => e.type === 'overshoot-complete' && e.run === run && e.time > time), unmount), 'unmount stops the real return callback')
  console.log('PASS unmount cancels a real overshoot return')
  assert.deepEqual(errors, [])
  await page.close()
  const reduced = await open(compile(currentText, 0), 2, false, 'reduce')
  await reduced.page.evaluate(() => window.coverSelect(2))
  await assertRest(reduced.page, 2)
  await reduced.page.evaluate(() => { window.coverEvents = [] })
  await fling(reduced.page)
  await assertRest(reduced.page, 3)
  const reducedEvents = await reduced.page.evaluate(() => window.coverEvents)
  assert(reducedEvents.some(e => e.type === 'fling-release' && Math.abs(e.velocity) >= 1100))
  assert(!reducedEvents.some(e => e.type === 'overshoot-start' && e.target !== 0), 'a real reduced-motion fling never creates overshoot')
  assert.deepEqual(reduced.errors, [])
  await reduced.page.close()
  console.log('PASS reduced motion fast pointer input has no overshoot')
  await regress()
}
async function speedRegression() {
  const dragScale = .95
  const baseDurationMs = 500 * dragScale
  const { page, errors } = await open(compile(currentText, 0), 2, false)
  assert.equal(await page.evaluate(() => window.coverThemeSnapshot.motion.trackDragDurationScale), dragScale, 'speed mode loads the real default without a reference override')
  const codec = await page.evaluate(async dragScale => {
    const codec = await import('/src/features/appearance/model/appearanceThemeCodec.ts')
    const { defaultAppearance } = await import('/src/features/appearance/model/defaultAppearance.ts')
    const document = codec.createAppearanceThemeDocument(defaultAppearance)
    const values = [undefined, .25, .8, dragScale, 1, .24, 1.01, '1', null].map(input => {
      const candidate = structuredClone(document)
      if (input === undefined) delete candidate.theme.motion.trackDragDurationScale
      else candidate.theme.motion.trackDragDurationScale = input
      const parsed = codec.deserializeAppearanceTheme(JSON.stringify(candidate))
      const roundtrip = codec.deserializeAppearanceTheme(codec.serializeAppearanceTheme(parsed.appearance))
      return { input, value: parsed.appearance.motion.trackDragDurationScale, roundtrip: roundtrip.appearance.motion.trackDragDurationScale }
    })
    delete document.theme.motion.trackDragDurationScale
    const custom = structuredClone(defaultAppearance)
    custom.motion.trackDragDurationScale = 1
    return { values, custom: codec.deserializeAppearanceTheme(JSON.stringify(document), custom).appearance.motion.trackDragDurationScale }
  }, dragScale)
  for (const result of codec.values) {
    const expected = typeof result.input === 'number' && result.input >= .25 && result.input <= 1 ? result.input : dragScale
    assert.equal(result.value, expected)
    assert.equal(result.roundtrip, expected)
  }
  assert.equal(codec.custom, 1)
  await page.evaluate(() => window.coverSelect(2))
  await assertRest(page, 2, 800)
  await page.evaluate(() => { window.coverEvents = [] })
  await page.getByRole('button', { name: '下一首', exact: true }).click()
  await assertRest(page, 3, 800)
  const button = motionTiming(await page.evaluate(() => window.coverEvents))
  assert.equal(button.declaredDurationMs, 500)
  assert(Math.abs(button.half - .775) < .055)
  await page.evaluate(() => window.coverSelect(2))
  await assertRest(page, 2, 800)
  await page.evaluate(() => { window.coverEvents = [] })
  await drag(page, 1, .7 * .55, false)
  await page.evaluate(() => window.coverEvents.push({ type: 'release-marker', value: window.coverEvents.filter(e => e.type === 'progress').at(-1).value, time: performance.now() }))
  await page.mouse.up()
  await assertRest(page, 3, 800)
  const committed = dragTiming(await page.evaluate(() => window.coverEvents), true, baseDurationMs)
  await page.evaluate(() => { window.coverEvents = [] })
  await fling(page, -1)
  await assertRest(page, 2)
  const returned = overshootTiming(await page.evaluate(() => window.coverEvents), false, baseDurationMs / 1000)
  await page.evaluate(() => { window.coverEvents = [] })
  await drag(page, 1, .1 * .55)
  await assertRest(page, 2)
  const cancel = await page.evaluate(() => window.coverEvents.find(e => e.type === 'animation-start' && e.target === 0))
  assert(Math.abs(cancel.durationSeconds - .38 * dragScale) < .00001)
  await page.evaluate(() => { window.coverEvents = [] })
  await drag(page, 1, .35 * .55)
  const resumed = await page.evaluate(() => window.coverResumeDragContext())
  await assertRest(page, 3)
  assert.equal(resumed.kind, 'drag')
  assert.equal(resumed.seconds, .5)
  assert.equal(resumed.resumedSeconds, .5, 'resuming keeps the original context base duration')
  const resumedStart = await page.evaluate(() => window.coverEvents.filter(e => e.type === 'animation-start' && e.target === 1).at(-1))
  assert(Math.abs(resumedStart.durationSeconds * 1000 - baseDurationMs * (1 - switchTimeAtProgress(resumed.progress))) < .5, 'resuming applies the drag multiplier once')
  await page.evaluate(() => window.coverSelect(2))
  await assertRest(page, 2, 800)
  await page.evaluate(() => { window.coverEvents = []; window.coverSelect(3) })
  await page.waitForTimeout(70)
  const region = await page.locator('.cover-input-region').boundingBox()
  assert(region)
  const x = region.x + region.width * .8, y = region.y + region.height * .35
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 18, y, { steps: 2 })
  await page.waitForSelector('.track-card-plane[data-track-card-phase="preview"]')
  await page.mouse.move(x - region.width * .1 * .55, y, { steps: 8 })
  await page.waitForTimeout(550)
  await page.mouse.up()
  await assertRest(page, 3)
  const recentered = await page.evaluate(() => window.coverEvents)
  const recenter = recentered.find(e => e.type === 'session' && e.session?.outgoingReturnToCenter)
  assert(recenter, 'the real interrupted gesture exercises recenter')
  assert(recentered.some(e => e.type === 'animation-start' && e.time >= recenter.time && Math.abs(e.durationSeconds - .19 * dragScale) < .00001))
  const retiringStart = recentered.find(e => e.type === 'retiring-start')
  const retiringEnd = recentered.findLast(e => e.type === 'retiring-progress' && e.value >= .999)
  assert(retiringStart && retiringEnd)
  assert(Math.abs(retiringEnd.animationTime * 1000 - baseDurationMs * (1 - switchTimeAtProgress(retiringStart.from))) < 15, 'retiring also uses the single drag multiplier')
  assert.deepEqual(errors, [])
  await page.close()
  const reduced = await open(compile(currentText, 0), 2, false, 'reduce')
  await reduced.page.evaluate(() => { window.coverEvents = []; window.coverSelect(2) })
  await assertRest(reduced.page, 2)
  assert.equal(await reduced.page.evaluate(() => window.coverEvents.find(e => e.type === 'animation-start' && e.target === 1).durationSeconds), .08)
  await reduced.page.evaluate(() => { window.coverEvents = [] })
  await drag(reduced.page, 1, .7 * .55)
  await assertRest(reduced.page, 3)
  const reducedCommit = await reduced.page.evaluate(() => window.coverEvents.find(e => e.type === 'animation-start' && e.target === 1))
  assert(Math.abs(reducedCommit.durationSeconds - .08 * Math.max(.15, 1 - reducedCommit.from)) < .00001, 'reduced drag keeps the original 80ms base without the new multiplier')
  assert.deepEqual(reduced.errors, [])
  await reduced.page.close()
  const report = { dragScale, baseDurationMs, buttonMs: button.declaredDurationMs, committed, returned, cancelMs: cancel.durationSeconds * 1000, recenterMs: 190 * dragScale, resumed, reducedDragMs: reducedCommit.durationSeconds * 1000, codec }
  console.log('DRAG_SPEED', JSON.stringify(report))
  const outputDir = process.env.SPMUSIC_COVER_MOTION_OUTPUT_DIR
  if (outputDir) { mkdirSync(outputDir, { recursive: true }); writeFileSync(resolve(outputDir, 'drag-speed.json'), JSON.stringify(report, null, 2) + '\n') }
}
try {
  if (process.env.SPMUSIC_COVER_SPEED_ONLY) {
    await speedRegression()
    console.log('COVER_DRAG_SPEED_PASS')
  } else if (process.env.SPMUSIC_COVER_OVERSHOOT_ONLY) {
    await overshootRegression()
    console.log('COVER_OVERSHOOT_PASS')
  } else if (process.env.SPMUSIC_COVER_DRAG_ONLY) {
    if (process.env.SPMUSIC_COVER_DRAG_ONLY === 'interaction') await dragInteractionRegression()
    else await dragRegression()
    console.log('COVER_DRAG_TAIL_PASS')
  } else if (process.env.SPMUSIC_COVER_CLICK_ONLY) {
    await clickRegression()
    console.log('COVER_CLICK_MOTION_PASS')
  } else if (process.env.SPMUSIC_COVER_MOTION_ONLY) {
    await motionRegression()
    console.log('COVER_MOTION_PASS')
  } else {
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
  }
} finally { await browser.close() }
