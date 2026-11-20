// Real touch regression: start Vite, set SPMUSIC_PLAYWRIGHT to an existing
// Playwright package, and optionally SPMUSIC_BROWSER_EXECUTABLE to Edge/Chromium.
// No dependency is installed. Production components and gesture handlers are
// served unchanged; only the view model and audio preparation boundary are fake.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const componentPath = '/src/features/player/components/PlayerSurface.tsx'
const transformed = process.env.SPMUSIC_COVER_SURFACE_PATH ? readFileSync(process.env.SPMUSIC_COVER_SURFACE_PATH,'utf8') : await (await fetch(origin + componentPath)).text()
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = (transformed + '\n' + entry).match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
// Reuse the existing full-surface fixture without executing its test runner.
const existing = readFileSync(new URL('./coverTransition.browser.test.mjs', import.meta.url), 'utf8')
const template = existing.match(/const fixture = `([\s\S]*?)`\r?\nconst html/)[1]
let fixture = template.replace(/\$\{dependency\('([^']+)'\)\}/g, (_match, name) => dependency(name))
  .replaceAll('${componentPath}', componentPath)
  .replace('window.coverEvents=[];', 'window.coverEvents=[];window.playlistRequests=[];window.playlistSelections=[];window.previewEvents=[];window.inputTrace=[];')
  .replace('window.coverConfig={refresh:true,reject:false,staged:false};', 'window.coverConfig={refresh:false,reject:false,staged:false,previewDelay:0};')
  .replace('playlist:{isOpen:false,onOpenChange:noop,', `playlist:{isOpen:state.isPlaylistOpen||false,onOpenChange:open=>{window.playlistRequests.push(open);setState(s=>({...s,isPlaylistOpen:open}))},currentTrackId:tracks[state.index].id,onTrackSelect:id=>{window.playlistSelections.push(id);select(tracks.findIndex(t=>t.id===id))},`)
  .replace('feedback:{onToggle:noop}', "feedback:{onToggle:value=>window.coverEvents.push({type:'feedback',value})}")
  .replace('onDiscardTrackPreview:noop', `onDiscardTrackPreview:id=>{window.previewEvents.push({type:'discard',id});if(id<0){tokenId++;pending=null}else if(pending?.id===id)pending=null}`)
  .replace('window.coverCommits.push(id);', `window.previewEvents.push({type:'commit',id,origin:pending?.originTrackId,current:tracks[currentIndex].id});window.coverCommits.push(id);`)
  .replace('currentIndex=state.index;', 'currentIndex=state.index;window.fixtureTrackId=tracks[state.index].id;')
const prepareStart = fixture.indexOf(' const prepare=')
const prepareEnd = fixture.indexOf(' const commit=', prepareStart)
assert(prepareStart >= 0 && prepareEnd > prepareStart, 'fixture preparation boundary')
fixture = fixture.slice(0, prepareStart) + `
 const prepare=React.useCallback(async direction=>{
   const id=++tokenId,index=(currentIndex+direction+tracks.length)%tracks.length,originTrackId=tracks[currentIndex].id;
   pending=null;window.previewEvents.push({type:'prepare',id,direction,originTrackId});
   if(window.coverConfig.previewDelay)await new Promise(resolve=>setTimeout(resolve,window.coverConfig.previewDelay));
   if(id!==tokenId){window.previewEvents.push({type:'stale',id});return null}
   pending={id,originTrackId,targetTrackId:tracks[index].id,direction,track:tracks[index],artwork:artworks[index]};
   window.previewEvents.push({type:'prepared',id});return pending
 },[]);
` + fixture.slice(prepareEnd)
fixture = `for(const type of ['pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture','touchend','click'])document.addEventListener(type,e=>window.inputTrace?.push({type,target:e.target.tagName,cls:String(e.target.className),pointerId:e.pointerId,isPrimary:e.isPrimary,detail:e.detail,cancelable:e.cancelable,defaultPrevented:e.defaultPrevented,track:window.fixtureTrackId,captured:document.querySelector('.track-card-deck')?.hasPointerCapture(e.pointerId),time:performance.now(),eventTime:e.timeStamp,trusted:e.isTrusted}),true);\n` + fixture
fixture=fixture.replace('const playback={track:currentTrack','const playback={moreActions:{trackId:currentTrack.id,onPrepareNavigation:noop},track:currentTrack')
  .replace('timeline:{positionSeconds:0,durationSeconds:180','timeline:{positionSeconds:state.progress??0,durationSeconds:180')
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__cover_collapse_fixture.js"')
const browser = await chromium.launch({ headless: true, ...(process.env.SPMUSIC_BROWSER_EXECUTABLE
  ? { executablePath: process.env.SPMUSIC_BROWSER_EXECUTABLE }
  : { channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' }) })
console.log('BROWSER', browser.version())
const active = '.track-card-plane[data-track-card-phase="active"]'
const caseFilter = process.env.SPMUSIC_COVER_CASE ? new RegExp(process.env.SPMUSIC_COVER_CASE) : null
let passed = 0

async function open(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, hasTouch: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  if(options.missedRelease)await page.addInitScript(()=>{
    window.droppedTerminals=[]
    for(const type of ['pointerup','lostpointercapture'])window.addEventListener(type,event=>{
      if(window.dropTerminal?.[type]){window.dropTerminal[type]--;window.droppedTerminals.push({type,time:performance.now(),pointerId:event.pointerId,buttons:event.buttons});event.stopImmediatePropagation()}
    },true)
    // Chromium's trusted mouse ID is fixed. The optional ID-change case below
    // is an explicitly synthetic pointer-protocol test of the capture boundary.
    const leases=new WeakMap(),set=Element.prototype.setPointerCapture,has=Element.prototype.hasPointerCapture,release=Element.prototype.releasePointerCapture
    Element.prototype.setPointerCapture=function(id){if(window.syntheticMouseProtocol&&id===99){leases.set(this,id);return}return set.call(this,id)}
    Element.prototype.hasPointerCapture=function(id){if(window.syntheticMouseProtocol&&id===99)return leases.get(this)===id;return has.call(this,id)}
    Element.prototype.releasePointerCapture=function(id){if(window.syntheticMouseProtocol&&id===99){if(leases.get(this)===id){leases.delete(this);queueMicrotask(()=>this.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:id,pointerType:'mouse',isPrimary:true,buttons:0,bubbles:true})))}return}return release.call(this,id)}
  })
  let body = fixture
  if(options.manyTracks)body=body.replace('Array.from({length:6}', 'Array.from({length:64}')
    .replaceAll('(state.index+5)%6','(state.index+63)%6').replace(/%6(?!\d)/g,'%64')
    .replace("['#d34','#3a6','#46e','#da3','#a5c','#2ab'][i]","['#d34','#3a6','#46e','#da3','#a5c','#2ab'][i%6]")
    .replace('const artworks=',`tracks.forEach((track,index)=>{const prefix='data:image/svg+xml,';const svg=decodeURIComponent(track.coverImage.slice(prefix.length));track.coverImage=prefix+encodeURIComponent(svg.replace('</svg>','<text x="4" y="20">'+index+'</text></svg>'))});const artworks=`)
    .replace(/const candidates=React.useMemo\([^\n]+;/,`const candidates=React.useMemo(()=>[1,-1,2,-2,3,-3].map(offset=>{const index=(state.index+offset+tracks.length)%tracks.length;return{afterTrackId:currentTrack.id,direction:offset>0?1:-1,track:tracks[index],artwork:artworks[index]}}),[currentTrack,currentArtwork]);`)
  if (options.noArtwork) body = body.replace('const artworks=', 'tracks.forEach(t=>delete t.coverImage);const artworks=')
  if (options.noPreview) body = body.replace('onPrepareTrackPreview:prepare', 'onPrepareTrackPreview:undefined')
  if(options.candidateRace){
    body=body.replace(/const candidates=React.useMemo\([^\n]+;/,'const candidates=React.useMemo(()=>[],[currentTrack,currentArtwork]);')
    body+=`\nwindow.racePublished=new Set();window.onPreviewLayers=layers=>{const preview=layers.find(layer=>layer.phase==='preview'&&layer.token!=null);if(preview&&!window.racePublished.has(preview.token)){window.racePublished.add(preview.token);window.coverDetailRefresh()}};`
  }
  if(options.manyTracks){
    const readOwner=`window.distinctGestureSnapshot=()=>({track:track?.id,press:coverPressRef.current&&{track:coverPressRef.current.originTrackId,tap:coverPressRef.current.tapEligible},drag:coverDragRef.current&&{id:coverDragRef.current.gestureId,track:coverDragRef.current.originTrackId,direction:coverDragRef.current.direction,moved:coverDragRef.current.moved,released:coverDragRef.current.released,progress:coverDragRef.current.progress,targetReady:coverDragRef.current.targetReady,token:coverDragRef.current.token&&{id:coverDragRef.current.token.id,origin:coverDragRef.current.token.originTrackId,target:coverDragRef.current.token.targetTrackId}},phase:coverInteractionPhaseRef.current,session:trackCardSessionRef.current,slots:artworkSlotsRef.current.map(layer=>layer&&({id:layer.id,track:layer.track.id,phase:layer.phase,identity:layer.identity,token:layer.previewTokenId})),preview:trackCardPreviewToken&&{id:trackCardPreviewToken.id,origin:trackCardPreviewToken.originTrackId,target:trackCardPreviewToken.targetTrackId},paint:window.previewPaintSnapshot?.(),previewArtworkReady,geometry:trackCardCoverGeometry});`
    assert(transformed.includes('const handleMoreOpenChange = useCallback'),'distinct-track instrumentation target')
    let traced=transformed.replace('const handleMoreOpenChange = useCallback',readOwner+'const handleMoreOpenChange = useCallback')
    const oldGate='const startCoverDrag = useCallback((event) => {\n\t\tconst coverFrame = event.target.closest(".cover-frame");'
    const gate=traced.includes(oldGate)?oldGate:'let coverFrame = resolveCoverFrame();'
    assert(traced.includes(gate),'start drag gate instrumentation')
    traced=traced.replace(gate,gate+`(window.startDragTrace??=[]).push({time:performance.now(),logical:track?.id,geometryReady:trackCardGeometryReady,frameConnected:coverFrame?.isConnected,contains:Boolean(coverFrame&&event.currentTarget.contains(coverFrame)),targetConnected:event.target.isConnected,activeMatch:artworkSlots.some(layer=>layer?.phase==='active'&&layer.track.id===track?.id),phase:coverInteractionPhaseRef.current});`)
      .replace('const clearCoverPress = useCallback(() => {',`const clearCoverPress = useCallback(() => {if(coverPressRef.current)(window.clearPressTrace??=[]).push({time:performance.now(),stack:new Error().stack});`)
      .replace('const handleCoverPointerCancel = useCallback(() => {',`const handleCoverPointerCancel = useCallback(() => {(window.cancelTrace??=[]).push({time:performance.now(),stack:new Error().stack});`)
    await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:traced}))
    let hookSource=await(await fetch(origin+'/src/features/player/hooks/useArtworkVisualResource.ts')).text()
    hookSource=hookSource.replace('setPaintedPreviewTokenId(preview.previewTokenId);',`(window.previewPaintOrder??=[]).push({type:'paint-ready',token:preview.previewTokenId,layer:preview.id,time:performance.now()});setPaintedPreviewTokenId(preview.previewTokenId);`)
      .replace('if (!previewToken) return;\n\t\tsetPaintedPreviewTokenId(null);',`if (!previewToken) return;(window.previewPaintOrder??=[]).push({type:'reset-null',token:previewToken.id,painted:[...paintedLayerIdsRef.current],existing:layersRef.current.some(layer=>layer.previewTokenId===previewToken.id),time:performance.now()});\n\t\tsetPaintedPreviewTokenId(null);`)
    if(options.candidateRace)hookSource=hookSource.replace('setLayers(nextLayers);',`setLayers(nextLayers);window.onPreviewLayers?.(nextLayers.map(layer=>({id:layer.id,phase:layer.phase,token:layer.previewTokenId})));`)
    const hookTrace=`window.previewPaintSnapshot=()=>({token:previewToken?.id,paintedToken:paintedPreviewTokenId,paintedLayers:[...paintedLayerIdsRef.current],layers:layersRef.current.map(layer=>({id:layer.id,track:layer.track.id,phase:layer.phase,token:layer.previewTokenId,view:Boolean(layer.resource.view)}))});`
    await page.route('**/src/features/player/hooks/useArtworkVisualResource.ts*',route=>route.fulfill({contentType:'text/javascript',body:hookSource.replace('const previewArtworkReady =',hookTrace+'const previewArtworkReady =')}))
    const baselinePath=join(tmpdir(),'spmusic-cover-distinct-before-surface.js')
    if(!existsSync(baselinePath))writeFileSync(baselinePath,transformed)
  }
  await page.route('**/__cover_collapse_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body }))
  await page.route('**/__cover_collapse_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__cover_collapse_test')
  await page.waitForSelector(active + ' .cover-frame')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1 }] : [] })
  const point = async () => {
    const box = await page.locator(active + ' .cover-frame').first().boundingBox()
    assert(box, 'active cover geometry')
    return { x: box.x + box.width * .5, y: box.y + box.height * .35, width: box.width }
  }
  return { page, errors, touch, point }
}

async function tap(context, dx = 0, dy = 0, hold = 100) {
  const { touch, point, page } = context
  const { x, y } = await point()
  await touch('touchStart', { x, y })
  if (hold) await page.waitForTimeout(hold)
  if (dx || dy) await touch('touchMove', { x: x + dx, y: y + dy })
  await touch('touchEnd')
}

async function tapMovingCover(context, hold = 0) {
  const { page, touch } = context
  // Confirm a target before input. Never cancel/retry a first touch or turn a
  // quick tap into a 60ms hold to make the destination assertion pass.
  const handle = await page.waitForFunction(() => {
    for (const button of document.querySelectorAll('.cover-collapse-button')) {
      const box = button.getBoundingClientRect()
      const x = box.x + box.width / 2, y = box.y + box.height * .35
      if (document.elementFromPoint(x, y)?.closest('.cover-collapse-button')) return { x, y }
    }
    return false
  })
  const point = await handle.jsonValue()
  await touch('touchStart', point)
  if (hold) await page.waitForTimeout(hold)
  await touch('touchEnd')
  const down = await page.evaluate(() => window.inputTrace.filter(e => e.type === 'pointerdown').at(-1))
  assert(down?.cls.includes('cover-collapse-button'), 'first touch must actually start on the sampled cover: ' + JSON.stringify(down))
}

async function assertFirstQuickCollapsed(context, point, baseline) {
  const { page, touch } = context
  await page.waitForTimeout(200)
  const first = await page.evaluate(() => ({ requests: window.playlistRequests, commits: window.coverCommits.length, prepares: window.previewEvents.filter(e => e.type === 'prepare').length, selections: window.playlistSelections, track: window.fixtureTrackId, panel: !!document.querySelector('.playlist-panel'), trace: window.inputTrace }))
  // A second click is diagnostic evidence only. It can never rescue a failed
  // first-click assertion or change the recorded first result.
  let second = null
  if (!first.panel) {
    await page.waitForTimeout(500)
    await touch('touchStart', point)
    await touch('touchEnd')
    await page.waitForTimeout(100)
    second = await page.evaluate(() => ({ requests: window.playlistRequests, track: window.fixtureTrackId }))
  }
  assert.deepEqual(first.requests, [true], JSON.stringify({ first, second }))
  assert(first.panel, 'the first touch must open and retain the playlist')
  assert.equal(first.track, baseline.track)
  assert.equal(first.commits, baseline.commits)
  assert.equal(first.prepares, baseline.prepares)
  assert.deepEqual(first.selections, [])
  const down = first.trace.filter(event => event.type === 'pointerdown').at(-1)
  const up = first.trace.find(event => event.type === 'pointerup' && event.pointerId === down?.pointerId)
  console.log('FIRST_TOUCH', JSON.stringify({ down: down?.cls, up: up?.cls, durationMs: up ? up.eventTime - down.eventTime : null, compatibilityClicks: first.trace.filter(event => event.type === 'click' && event.pointerId === down?.pointerId).map(event => event.target), requests: first.requests }))
}

async function assertCollapsed(page) {
  // The native compatibility click follows pointerup; waiting through it and
  // the existing view transition proves the destination actually stays open.
  await page.waitForTimeout(650)
  const state = await page.evaluate(() => ({ requests: window.playlistRequests, commits: window.coverCommits, selections: window.playlistSelections, prepares: window.previewEvents.filter(e => e.type === 'prepare'), panel: !!document.querySelector('.playlist-panel'), trace: window.inputTrace }))
  assert.deepEqual(state.requests, [true], JSON.stringify(state))
  assert.deepEqual(state.commits, [], 'a cover tap never commits a track preview')
  assert.deepEqual(state.selections, [], 'compatibility click never selects a playlist track')
  assert.deepEqual(state.prepares, [], 'a cover tap never prepares another track')
  assert(state.panel, 'playlist stays mounted after compatibility click')
  assert(state.trace.some(event => event.type === 'pointerup' && event.trusted), 'real touch completion observed; Chromium may omit its compatibility click')
}

async function assertPlayerStable(page, expected = 0) {
  await page.waitForTimeout(650)
  const state = await page.evaluate(() => ({ requests: window.playlistRequests, title: document.querySelector('.track-card-plane[data-track-card-phase="active"] .title-pill')?.textContent, previews: document.querySelectorAll('.track-card-plane[data-track-card-phase="preview"]').length, panel: !!document.querySelector('.playlist-panel') }))
  assert.deepEqual(state.requests, [], JSON.stringify(state))
  assert(state.title?.includes('Song ' + expected), JSON.stringify(state))
  assert.equal(state.previews, 0)
  assert.equal(state.panel, false)
}

async function drag(context, direction = 1, fraction = .8, release = true) {
  const { page, touch } = context
  const box = await page.locator(active + ' .cover-frame').first().boundingBox()
  const x = box.x + box.width * (direction > 0 ? .96 : .04)
  const y = box.y + box.height * .35
  await touch('touchStart', { x, y })
  await touch('touchMove', { x: x - direction * 30, y })
  await page.waitForSelector('.track-card-plane[data-track-card-phase="preview"]')
  await page.waitForTimeout(120)
  for (let step = 1; step <= 8; step++) {
    await touch('touchMove', { x: x - direction * (30 + (box.width * fraction - 30) * step / 8), y })
  }
  if (release) await touch('touchEnd')
}

async function check(name, run, options) {
  if (caseFilter && !caseFilter.test(name)) return
  const context = await open(options)
  try {
    await run(context)
    assert.deepEqual(context.errors, [], 'no uncaught browser errors')
    console.log('PASS', name)
    passed++
  } finally { await context.page.close() }
}

try {
  await check('mouse drag remains usable after cover long press opens and closes more',async({page})=>{
    const frame=await page.locator(active+' .cover-frame').first().boundingBox()
    const x=frame.x+frame.width*.5,y=frame.y+frame.height*.35
    await page.mouse.move(x,y)
    await page.mouse.down()
    await page.locator('.more-actions-menu').waitFor()
    await page.mouse.up()
    assert.deepEqual(await page.evaluate(()=>window.playlistRequests),[],'long press does not collapse the player')
    await page.keyboard.press('Escape')
    await page.locator('.more-actions-menu').waitFor({state:'hidden'})
    for(const [direction,expected] of [[1,'track-1'],[-1,'track-0']]){
      const before=await page.evaluate(()=>window.coverCommits.length)
      const box=await page.locator('.cover-input-region').boundingBox()
      const start=box.x+box.width*(direction>0?.85:.15),height=box.y+box.height*.35
      await page.mouse.move(start,height)
      await page.mouse.down()
      await page.mouse.move(start-direction*32,height)
      await page.waitForSelector('.track-card-plane[data-track-card-phase="preview"]')
      await page.waitForTimeout(120)
      await page.mouse.move(start-direction*box.width*.7,height)
      await page.mouse.up()
      await page.waitForFunction(({before,expected})=>window.coverCommits.length===before+1&&window.fixtureTrackId===expected,{before,expected})
      await page.waitForTimeout(500)
    }
    assert.deepEqual(await page.evaluate(()=>window.playlistRequests),[])
    assert.equal(await page.locator('.more-actions-menu').count(),0)
  })
  await check('stationary missed release and changed mouse id recover through complete event route',async({page})=>{
    const read=()=>page.evaluate(()=>({track:window.fixtureTrackId,owner:window.distinctGestureSnapshot?.()}))
    const box=await page.locator('.cover-input-region').boundingBox(),x=box.x+box.width*.75,y=box.y+box.height*.35
    await page.mouse.move(x,y);await page.mouse.down()
    await page.evaluate(()=>{window.dropTerminal={pointerup:1,lostpointercapture:1}})
    await page.mouse.up();await page.waitForTimeout(30)
    const missed=await read()
    await page.evaluate(()=>window.coverSelect(10));await page.waitForTimeout(600)
    const controller=await read()
    await page.evaluate(({x,y})=>{window.syntheticMouseProtocol=true;document.querySelector('.cover-input-region').dispatchEvent(new PointerEvent('pointerdown',{pointerId:99,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:x,clientY:y,bubbles:true,cancelable:true}))},{x,y})
    const pressed=await read()
    await page.evaluate(({x,y})=>document.querySelector('.cover-input-region').dispatchEvent(new PointerEvent('pointermove',{pointerId:99,pointerType:'mouse',isPrimary:true,button:-1,buttons:1,clientX:x-32,clientY:y,bubbles:true})),{x,y})
    await page.waitForTimeout(120)
    await page.evaluate(({x,y,width})=>{const target=document.querySelector('.cover-input-region');target.dispatchEvent(new PointerEvent('pointermove',{pointerId:99,pointerType:'mouse',isPrimary:true,button:-1,buttons:1,clientX:x-width*.72,clientY:y,bubbles:true}));target.dispatchEvent(new PointerEvent('pointerup',{pointerId:99,pointerType:'mouse',isPrimary:true,button:0,buttons:0,clientX:x-width*.72,clientY:y,bubbles:true}))},{x,y,width:box.width})
    await page.waitForTimeout(700)
    const after=await read(),path=join(tmpdir(),'spmusic-cover-missed-press-new-id.json')
    writeFileSync(path,JSON.stringify({syntheticProtocol:true,missed,controller,pressed,after,clears:await page.evaluate(()=>window.clearPressTrace),dropped:await page.evaluate(()=>window.droppedTerminals),trace:await page.evaluate(()=>window.inputTrace)},null,2))
    console.log('NEW_MOUSE_ID_PROBE',JSON.stringify({before:controller.track,after:after.track,oldPress:controller.owner.press,newPress:pressed.owner.press,path}))
    assert.equal(after.track,'track-11','complete window pointer route clears the stale different-id press before a new primary mouse sequence')
  },{manyTracks:true,missedRelease:true})
  await check('same commit candidate publication preserves newly painted preview readiness',async({page})=>{
    const box=await page.locator('.cover-input-region').boundingBox()
    const x=box.x+box.width*.85,y=box.y+box.height*.35
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-32,y)
    await page.waitForTimeout(130)
    await page.mouse.move(x-box.width*.72,y)
    await page.waitForTimeout(100)
    const held=await page.evaluate(()=>window.distinctGestureSnapshot())
    await page.mouse.up();await page.waitForTimeout(700)
    const after=await page.evaluate(()=>({track:window.fixtureTrackId,owner:window.distinctGestureSnapshot(),events:window.previewEvents,paintOrder:window.previewPaintOrder,published:[...window.racePublished]}))
    const path=join(tmpdir(),'spmusic-preview-same-commit-candidates.json')
    writeFileSync(path,JSON.stringify({held,after},null,2))
    console.log('CANDIDATE_RACE',JSON.stringify({heldReady:held.previewArtworkReady,targetReady:held.drag?.targetReady,paintedToken:held.paint?.paintedToken,paintedLayers:held.paint?.paintedLayers,afterTrack:after.track,paintOrder:after.paintOrder,path}))
    assert.equal(held.drag?.targetReady,true,'actual painted preview must become draggable despite concurrent candidate publication')
    assert.equal(after.track,'track-1')
  },{manyTracks:true,candidateRace:true})
  for(const dropLost of [false,true])await check('single missed mouse release '+(dropLost?'and lost capture':'only')+' recovery probe',async({page})=>{
    const read=()=>page.evaluate(()=>({track:window.fixtureTrackId,owner:window.distinctGestureSnapshot?.(),time:performance.now()}))
    const box=await page.locator('.cover-input-region').boundingBox()
    const x=box.x+box.width*.7,y=box.y+box.height*.35
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-32,y);await page.waitForTimeout(100)
    await page.evaluate(dropLost=>{window.dropTerminal={pointerup:1,lostpointercapture:dropLost?1:0}},dropLost)
    await page.mouse.up();await page.waitForTimeout(50)
    const missed=await read()
    // Use the controller's same callback without synthesizing a hover that would
    // independently prove buttons=0 and recover the gesture before selection.
    await page.evaluate(()=>window.coverSelect(10));await page.waitForTimeout(600)
    const controller=await read()
    const probes=[]
    let pointerX=x-32
    for(let index=0;index<3;index++){
      const before=await read()
      const direction=pointerX<box.x+box.width*.5?-1:1
      await page.mouse.down()
      await page.mouse.move(pointerX-direction*32,y)
      await page.waitForTimeout(75)
      const moving=await read()
      pointerX-=direction*box.width*.5
      await page.mouse.move(pointerX,y);await page.mouse.up();await page.waitForTimeout(650)
      const after=await read()
      probes.push({before,moving,after})
      // Keep the next down at the existing pointer position: no buttons=0 move.
    }
    const path=join(tmpdir(),'spmusic-cover-missed-release-'+(dropLost?'both':'up-only')+'.json')
    writeFileSync(path,JSON.stringify({dropLost,missed,controller,probes,dropped:await page.evaluate(()=>window.droppedTerminals),trace:await page.evaluate(()=>window.inputTrace)},null,2))
    console.log('MISSED_RELEASE_PROBE',JSON.stringify({dropLost,missedOwner:{press:missed.owner.press,drag:missed.owner.drag,phase:missed.owner.phase},controllerOwner:{press:controller.owner.press,drag:controller.owner.drag,phase:controller.owner.phase},probes:probes.map(probe=>({before:probe.before.track,after:probe.after.track,press:probe.after.owner.press,drag:probe.after.owner.drag})),path}))
  },{manyTracks:true,missedRelease:true})
  await check('video distinct direction sequence and painted preview rollback stay usable',async({page})=>{
    const rounds=[]
    const path=join(tmpdir(),'spmusic-cover-video-sequence.json')
    const read=()=>page.evaluate(()=>({track:window.fixtureTrackId,commits:window.coverCommits.length,owner:window.distinctGestureSnapshot?.(),time:performance.now()}))
    const save=async()=>writeFileSync(path,JSON.stringify({rounds,latest:await read(),events:await page.evaluate(()=>window.previewEvents),gates:await page.evaluate(()=>window.startDragTrace),trace:await page.evaluate(()=>window.inputTrace)},null,2))
    await page.evaluate(()=>{window.progressTick=0;window.progressTimer=setInterval(()=>window.coverUpdate({progress:(++window.progressTick)/50}),20)})
    async function move(direction,label,{rollback=false}={}){
      const before=await read()
      const box=await page.locator('.cover-input-region').boundingBox()
      const x=box.x+box.width*(direction>0?.85:.15),y=box.y+box.height*.35
      await page.mouse.move(x,y);await page.mouse.down()
      const pressed=await read()
      await page.mouse.move(x-direction*32,y)
      await page.waitForTimeout(30)
      await page.mouse.move(x-direction*box.width*(rollback?.10:.75),y)
      if(rollback)await page.waitForTimeout(260)
      const preview=await read()
      await page.mouse.up()
      await page.waitForTimeout(rollback?500:105)
      const after=await read()
      const committed=before.track!==after.track
      rounds.push({label,direction,rollback,before,pressed,preview,after,committed})
      if(rounds.length%5===0)await save()
      return committed
    }
    async function commits(direction,count,label){
      let successes=0
      for(let attempt=0;attempt<count*3&&successes<count;attempt++){
        if(await move(direction,label+'-'+attempt))successes++
      }
      await save()
      console.log('VIDEO_PHASE',JSON.stringify({label,successes,needed:count,track:(await read()).track,attempts:rounds.length}))
      return successes
    }
    try{
      const forward=await commits(1,28,'forward')
      const reverse=await commits(-1,16,'reverse')
      const forwardAgain=await commits(1,12,'forward-again')
      await move(-1,'reverse-painted-rollback',{rollback:true})
      const rollback=rounds.at(-1)
      await commits(-1,2,'after-rollback-reverse')
      await commits(1,2,'after-rollback-forward')
      const controllerBefore=await read()
      await page.getByRole('button',{name:'下一首',exact:true}).click()
      await page.waitForFunction(track=>window.fixtureTrackId!==track,controllerBefore.track)
      await page.waitForTimeout(500)
      const controllerAfter=await read()
      const postControllerReverse=await commits(-1,2,'after-controller-reverse')
      const postControllerForward=await commits(1,2,'after-controller-forward')
      await save()
      console.log('VIDEO_SEQUENCE_SUMMARY',JSON.stringify({forward,reverse,forwardAgain,rollbackPainted:rollback.preview.owner.drag?.targetReady,rollbackMoved:rollback.preview.owner.drag?.progress,rollbackCommitted:rollback.committed,controllerBefore:controllerBefore.track,controllerAfter:controllerAfter.track,postControllerReverse,postControllerForward,path}))
      assert.equal(forward,28,'reach 28 distinct identities before reversal')
      assert.equal(rollback.preview.owner.drag?.targetReady,true,'the reverse preview was genuinely painted before rollback')
      assert.equal(rollback.committed,false,'the reverse preview must roll back rather than commit')
      assert.equal(postControllerReverse,2,'reverse drag remains possible after controller selection')
      assert.equal(postControllerForward,2,'forward drag remains possible after controller selection')
    }finally{await page.evaluate(()=>clearInterval(window.progressTimer));await save();console.log('VIDEO_SEQUENCE_EVIDENCE',path)}
  },{manyTracks:true})
  for(const settled of [true,false])await check('28 distinct forward commits then reverse '+(settled?'settled':'rapid'),async({page})=>{
    const rounds=[]
    const read=()=>page.evaluate(()=>({track:window.fixtureTrackId,commits:window.coverCommits.length,owner:window.distinctGestureSnapshot?.(),events:window.previewEvents.slice(-12),time:performance.now()}))
    await page.evaluate(()=>{window.progressTick=0;window.progressTimer=setInterval(()=>window.coverUpdate({progress:(++window.progressTick)/50}),20)})
    async function move(direction,expected,label){
      const before=await read()
      const box=await page.locator('.cover-input-region').boundingBox()
      const x=box.x+box.width*(direction>0?.85:.15),y=box.y+box.height*.35
      await page.mouse.move(x,y)
      const hit=await page.evaluate(({x,y})=>{const element=document.elementFromPoint(x,y);return{tag:element?.tagName,className:String(element?.className),inert:Boolean(element?.closest('[inert]')),phase:element?.closest('[data-track-card-phase]')?.getAttribute('data-track-card-phase')}},{x,y})
      await page.mouse.down()
      const pressed=await read()
      await page.mouse.move(x-direction*32,y)
      const started=await read()
      await page.waitForTimeout(35)
      const moving=await read()
      await page.mouse.move(x-direction*box.width*.75,y)
      const displaced=await read()
      await page.mouse.up()
      let failure
      try{await page.waitForFunction(expected=>window.fixtureTrackId===expected,expected,{timeout:3500})}catch(error){failure=error.message}
      if(settled)await page.waitForTimeout(650)
      else await page.waitForTimeout(35)
      const after=await read()
      rounds.push({label,direction,expected,hit,before,pressed,started,moving,displaced,after,failure})
      return !failure
    }
    let firstFailure
    try{
      for(let index=0;index<28;index++)if(!await move(1,'track-'+(index+1),'forward-'+(index+1))){firstFailure='forward-'+(index+1);break}
      const beforeReverse=await read()
      console.log('DISTINCT_FORWARD',JSON.stringify({settled,firstFailure,track:beforeReverse.track,commits:beforeReverse.commits}))
      if(!firstFailure){
        for(const[direction,expected,label]of[[-1,'track-27','reverse-after-28'],[1,'track-28','forward-again'],[-1,'track-27','reverse-again']]){
          if(!await move(direction,expected,label)&&!firstFailure)firstFailure=label
        }
        await page.getByRole('button',{name:'下一首',exact:true}).click()
        await page.waitForFunction(()=>window.fixtureTrackId==='track-28')
        await page.waitForTimeout(650)
        if(!await move(1,'track-29','after-controller-forward')&&!firstFailure)firstFailure='after-controller-forward'
        if(!await move(-1,'track-28','after-controller-reverse')&&!firstFailure)firstFailure='after-controller-reverse'
      }else{
        let current=Number((await read()).track.split('-')[1])
        await move(-1,'track-'+((current+63)%64),'probe-reverse-after-failure')
        current=Number((await read()).track.split('-')[1])
        await move(1,'track-'+((current+1)%64),'probe-forward-after-failure')
        current=Number((await read()).track.split('-')[1])
        await page.getByRole('button',{name:'下一首',exact:true}).click()
        await page.waitForFunction(expected=>window.fixtureTrackId===expected,'track-'+((current+1)%64))
        await page.waitForTimeout(650)
        current=Number((await read()).track.split('-')[1])
        await move(-1,'track-'+((current+63)%64),'probe-reverse-after-controller')
        current=Number((await read()).track.split('-')[1])
        await move(1,'track-'+((current+1)%64),'probe-forward-after-controller')
      }
      assert.equal(firstFailure,undefined,'all forward/reverse drags remain responsive: '+firstFailure)
      assert.equal(rounds.length,33)
    }finally{
      await page.evaluate(()=>clearInterval(window.progressTimer))
      const evidencePath=join(tmpdir(),'spmusic-cover-28-distinct-'+(settled?'settled':'rapid')+'.json')
      writeFileSync(evidencePath,JSON.stringify({settled,firstFailure,rounds,events:await page.evaluate(()=>window.previewEvents),trace:await page.evaluate(()=>window.inputTrace),gates:await page.evaluate(()=>window.startDragTrace),clears:await page.evaluate(()=>window.clearPressTrace),cancels:await page.evaluate(()=>window.cancelTrace)},null,2))
      console.log('DISTINCT_EVIDENCE',evidencePath)
    }
  },{manyTracks:true})
  await check('rapid trusted mouse drags remain usable under 20ms progress renders',async({page})=>{
    await page.evaluate(()=>{window.mouseStress=[];window.progressTick=0;window.progressTimer=setInterval(()=>window.coverUpdate({progress:(++window.progressTick)/50}),20)})
    async function mouseDrag(index,steady=false,reversals=0){
      const box=await page.locator('.cover-input-region').boundingBox()
      const direction=index%2===0?1:-1
      const x=box.x+box.width*(direction>0?.85:.15),y=box.y+box.height*.35
      const before=await page.evaluate(()=>({commits:window.coverCommits.length,track:window.fixtureTrackId,time:performance.now()}))
      await page.mouse.move(x,y);await page.mouse.down()
      await page.mouse.move(x-direction*30,y)
      await page.waitForTimeout(steady?120:25)
      for(let step=0;step<reversals;step++){
        await page.mouse.move(step%2===0?x-direction*box.width*.7:x,y)
        await page.waitForTimeout(25)
      }
      await page.mouse.move(x-direction*box.width*.7,y)
      await page.mouse.up()
      await page.waitForTimeout(steady?650:70)
      const after=await page.evaluate(()=>({commits:window.coverCommits.length,track:window.fixtureTrackId,time:performance.now(),menu:Boolean(document.querySelector('.more-actions-menu'))}))
      await page.evaluate(round=>window.mouseStress.push(round),{index,steady,reversals,before,after})
    }
    for(let index=0;index<24;index++)await mouseDrag(index)
    for(let index=24;index<32;index++)await mouseDrag(index,false,12)
    await page.waitForTimeout(1200)
    for(let index=32;index<35;index++)await mouseDrag(index,true)
    const metrics=await page.evaluate(()=>{clearInterval(window.progressTimer);return {rounds:window.mouseStress,events:window.inputTrace,previewEvents:window.previewEvents,progressTicks:window.progressTick}})
    const evidencePath=join(tmpdir(),'spmusic-cover-mouse-stress.json')
    writeFileSync(evidencePath,JSON.stringify(metrics,null,2))
    console.log('MOUSE_STRESS',JSON.stringify({rounds:metrics.rounds.length,committingRounds:metrics.rounds.filter(round=>round.after.commits>round.before.commits).length,finalCommits:metrics.rounds.at(-1).after.commits,progressTicks:metrics.progressTicks,evidencePath}))
    assert.equal(metrics.rounds.slice(-3).filter(round=>round.after.commits>round.before.commits).length,3,'all final settled mouse drags still work')
    assert(metrics.rounds.filter(round=>round.after.commits>round.before.commits).length>=12,'a majority of rapid alternating mouse drags commit')
    assert(metrics.rounds.every(round=>!round.after.menu),'dragging never opens the long-press menu')
  })
  for (const source of ['next', 'drag']) for (const hold of [0, 1, 5, 10, 20]) {
    await check(`fixed ${source} cover first quick touch hold=${hold}ms`, async context => {
      const { page, point, touch } = context
      const { x, y } = await point()
      const fixed = { x, y }
      if (source === 'next') {
        const box = await page.getByRole('button', { name: '下一首', exact: true }).boundingBox()
        await touch('touchStart', { x: box.x + box.width / 2, y: box.y + box.height / 2 })
        await touch('touchEnd')
      } else {
        await drag(context)
      }
      await page.waitForFunction(() => window.fixtureTrackId === 'track-1')
      // This is the user's fixed cover location while the card transition is
      // running, rather than chasing its moving DOM or waiting for a settle.
      await page.waitForTimeout(180)
      const baseline = await page.evaluate(() => ({ track: window.fixtureTrackId, commits: window.coverCommits.length, prepares: window.previewEvents.filter(e => e.type === 'prepare').length }))
      await touch('touchStart', fixed)
      if (hold) await page.waitForTimeout(hold)
      await touch('touchEnd')
      await assertFirstQuickCollapsed(context, fixed, baseline)
    })
  }
  await check('fixed cover horizontal motion during animation never collapses', async context => {
    const { page, point, touch } = context
    const { x, y } = await point()
    await page.getByRole('button', { name: '下一首', exact: true }).click()
    await page.waitForFunction(() => window.fixtureTrackId === 'track-1')
    await page.waitForTimeout(180)
    await touch('touchStart', { x, y })
    await touch('touchMove', { x: x - 50, y })
    await touch('touchEnd')
    await assertPlayerStable(page, 1)
    assert.deepEqual(await page.evaluate(() => window.coverCommits), [])
  })
  await check('outside fixed cover and in lyrics never collapses', async context => {
    const { page, touch } = context
    const box = await page.locator(active + ' .cover-frame').boundingBox()
    const point = { x: box.x + box.width + 35, y: box.y + box.height * .35 }
    await touch('touchStart', point)
    await touch('touchEnd')
    await assertPlayerStable(page)
  })
  await check('mouse drag pointerId reuse preserves the next and like buttons', async ({ page }) => {
    const box = await page.locator(active + ' .cover-frame').boundingBox()
    const x = box.x + box.width * .96, y = box.y + box.height * .35
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 30, y)
    await page.waitForSelector('.track-card-plane[data-track-card-phase="preview"]')
    await page.waitForTimeout(120)
    await page.mouse.move(x - box.width * .8, y, { steps: 8 })
    await page.mouse.up()
    // Do not wait out the released drag ref before reusing mouse pointerId 1.
    await page.getByRole('button', { name: '下一首', exact: true }).click({ force: true })
    await page.waitForFunction(() => window.fixtureTrackId === 'track-2')
    await page.getByRole('button', { name: '喜欢', exact: true }).click()
    assert.equal(await page.evaluate(() => window.coverEvents.filter(e => e.type === 'feedback').length), 1)
    assert.equal(await page.evaluate(() => window.coverCommits.length), 1)
    assert.deepEqual(await page.evaluate(() => window.playlistRequests), [])
  })
  for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [7, 0], [-7, 0], [0, 7]]) {
    await check(`trusted touch tap with ${dx},${dy}px jitter stays in playlist without changing track`, async context => {
      await tap(context, dx, dy)
      await assertCollapsed(context.page)
    })
  }
  await check('long touch still collapses once without preview or selection', async context => {
    await tap(context, 3, 2, 700)
    await assertCollapsed(context.page)
  })
  await check('holding still retains the original rendered cover without a preview', async context => {
    const { page, point, touch } = context
    await page.evaluate(() => { window.retainedCover = document.querySelector('.track-card-plane[data-track-card-phase="active"] .cover-frame') })
    const { x, y } = await point()
    await touch('touchStart', { x, y })
    await page.waitForTimeout(400)
    const held = await page.evaluate(() => ({ same: window.retainedCover === document.querySelector('.track-card-plane[data-track-card-phase="active"] .cover-frame'), prepares: window.previewEvents.filter(e => e.type === 'prepare').length, transform: getComputedStyle(window.retainedCover.parentElement.parentElement).transform, requests: window.playlistRequests }))
    assert(held.same, 'pointerdown must not remount the cover')
    assert.equal(held.prepares, 0)
    assert.deepEqual(held.requests, [])
    await touch('touchEnd')
    await assertCollapsed(page)
  })
  await check('large vertical movement is cancellation rather than a tap', async context => {
    await tap(context, 0, 40)
    await assertPlayerStable(context.page)
    assert.deepEqual(await context.page.evaluate(() => window.coverCommits), [])
  })
  await check('cover with no artwork accepts native touch', async context => {
    assert.equal(await context.page.locator(active + ' .cover-art').getAttribute('data-has-image'), 'false')
    await tap(context)
    await assertCollapsed(context.page)
  }, { noArtwork: true })
  await check('cover without preview capability accepts native touch', async context => {
    await tap(context)
    await assertCollapsed(context.page)
  }, { noPreview: true })
  await check('touching each overlay button retains its own action', async context => {
    const { page, touch } = context
    for (const index of [0, 1, 2]) {
      const box = await page.locator(active + ' .cover-actions button').nth(index).boundingBox()
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await touch('touchStart', point)
      await touch('touchEnd')
      if (index === 2) await page.waitForSelector('[role="dialog"]')
      assert.deepEqual(await page.evaluate(() => window.playlistRequests), [])
      assert.deepEqual(await page.evaluate(() => window.coverCommits), [])
    }
    assert.equal(await page.evaluate(() => window.coverEvents.filter(e => e.type === 'feedback').length), 2)
    assert.equal(await page.locator('button button').count(), 0)
  })
  for (const delay of [0, 200]) {
    await check(`touch cancellation invalidates pending preview (${delay}ms hydration)`, async context => {
      const { page, point, touch } = context
      await page.evaluate(delay => { window.coverConfig.previewDelay = delay }, delay)
      const { x, y } = await point()
      await touch('touchStart', { x, y })
      await touch('touchMove', { x: x - 50, y })
      await touch('touchCancel')
      await assertPlayerStable(page)
      assert.deepEqual(await page.evaluate(() => window.coverCommits), [])
    })
  }
  await check('forward and reverse touch drags still commit exactly once per drag', async context => {
    await drag(context, 1)
    await assertPlayerStable(context.page, 1)
    await drag(context, -1)
    await assertPlayerStable(context.page, 0)
    const commits = await context.page.evaluate(() => window.previewEvents.filter(e => e.type === 'commit'))
    assert.equal(commits.length, 2)
    assert(commits.every(event => event.origin === event.current), 'commits use the current production origin contract')
    assert.deepEqual(await context.page.evaluate(() => window.playlistSelections), [])
  })
  await check('short touch drag rolls back without collapse or changing track', async context => {
    await drag(context, 1, .12)
    await assertPlayerStable(context.page)
    assert.deepEqual(await context.page.evaluate(() => window.coverCommits), [])
  })
  await check('Escape during a held drag cancels its following native click', async context => {
    await drag(context, 1, .6, false)
    await context.page.keyboard.press('Escape')
    await context.touch('touchEnd')
    await assertPlayerStable(context.page)
    assert.deepEqual(await context.page.evaluate(() => window.coverCommits), [])
  })
  for (const phaseMs of [0, 40, 120]) {
    await check(`tap during track animation at ${phaseMs}ms does not commit another track`, async context => {
      await context.page.evaluate(() => window.coverSelect(1))
      await context.page.waitForFunction(() => window.fixtureTrackId === 'track-1')
      if (phaseMs) await context.page.waitForTimeout(phaseMs)
      await tapMovingCover(context)
      await assertCollapsed(context.page)
      assert.equal(await context.page.evaluate(() => window.fixtureTrackId), 'track-1')
    })
  }
  await check('repeated player/playlist touch cycles never select another track', async context => {
    const { page, touch } = context
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.evaluate(() => { window.playlistRequests = [] })
      await tap(context, 3, 1)
      await assertCollapsed(page)
      const box = await page.locator('.playlist-playback-track-button').boundingBox()
      await touch('touchStart', { x: box.x + box.width / 2, y: box.y + box.height / 2 })
      await touch('touchEnd')
      await page.waitForSelector(active + ' .cover-frame')
      await page.waitForTimeout(500)
      assert.deepEqual(await page.evaluate(() => window.playlistRequests), [true, false])
      assert.equal(await page.evaluate(() => window.fixtureTrackId), 'track-0')
    }
  })
  for (const key of ['Enter', 'Space']) {
    await check(`keyboard ${key} remains accessible`, async ({ page }) => {
      await page.locator(active + ' .cover-collapse-button').focus()
      await page.keyboard.press(key)
      await page.waitForTimeout(650)
      assert.deepEqual(await page.evaluate(() => window.playlistRequests), [true])
      assert.equal(await page.locator('.playlist-panel').count(), 1)
    })
  }
  console.log('COVER_COLLAPSE_REGRESSION_PASS', passed)
} finally { await browser.close() }
