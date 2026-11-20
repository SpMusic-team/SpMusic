// Independent transition diagnostics. Reuses the established real-shell fixture.
// SPMUSIC_PERF_SNAPSHOT writes/reads transformed modules outside the repository.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const harnessUrl = new URL('./playlistManagementMotion.browser.test.mjs', import.meta.url)
const harness = readFileSync(harnessUrl, 'utf8')
const boundary = "if(process.env.SPMUSIC_MOTION_TIMING_BASELINE==='1') {"
if (!harness.includes(boundary)) throw new Error('Existing motion harness boundary changed')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const modules = [
  '/src/features/player/components/PlaylistPanel.tsx',
  '/src/features/player/components/PlaylistLibraryPanel.tsx',
  '/src/features/player/components/PlaylistCard.tsx',
  '/src/features/player/hooks/usePlaylistOverscroll.ts',
  '/src/features/player/hooks/usePlaylistControllerMotion.ts',
  '/src/features/player/components/PlayerShell.tsx',
  '/src/features/player/components/PlaylistCoverImage.tsx',
  '/src/features/player/hooks/useCollectionLayout.ts',
  '/src/features/player/hooks/usePlaylistContentWindow.ts',
]
const snapshot = process.env.SPMUSIC_PERF_SNAPSHOT || join(tmpdir(), 'spmusic-management-transition-baseline')
mkdirSync(snapshot, { recursive: true })
if (process.env.SPMUSIC_PERF_CAPTURE === '1' || process.env.SPMUSIC_PERF_CAPTURE_MISSING === '1') {
  for (let index = 0; index < modules.length; index++) {
    if (process.env.SPMUSIC_PERF_CAPTURE_MISSING === '1' && existsSync(join(snapshot, index + '.js'))) continue
    const response = await fetch(origin + modules[index])
    if (!response.ok) throw new Error('Snapshot unavailable: ' + modules[index])
    writeFileSync(join(snapshot, index + '.js'), await response.text())
  }
  writeFileSync(join(snapshot, 'manifest.json'), JSON.stringify(modules))
}
const replacement = process.env.SPMUSIC_PERF_BASELINE === '1'
const noCrossfade = process.env.SPMUSIC_PERF_NO_CROSSFADE === '1'
const presenceDiagnostic = process.env.SPMUSIC_PERF_PRESENCE === '1'
const reverseFix = process.env.SPMUSIC_PERF_REVERSE_FIX === '1'
const scrollOnly = process.env.SPMUSIC_PERF_READTOP_SCROLL_ONLY === '1'
const windowProbe = process.env.SPMUSIC_PERF_WINDOW_PROBE === '1'
const headerDependency = process.env.SPMUSIC_PERF_HEADER_DEPENDENCY === '1'
if (process.env.SPMUSIC_PERF_ASSERT_WINDOW_METRICS === '1' && !windowProbe) throw new Error('Window metrics assertion requires SPMUSIC_PERF_WINDOW_PROBE=1')
if (replacement && !existsSync(join(snapshot, 'manifest.json'))) throw new Error('Capture baseline first')
let source = harness.slice(0, harness.indexOf(boundary))
  .replace('createRequire(import.meta.url)', `createRequire(${JSON.stringify(fileURLToPath(harnessUrl))})`)
  .replace(/const dependency = name => \{[\s\S]*?\n\}/, 'const dependency = name => { const url=entry.split("\\\"").find(value=>value.startsWith("/")&&value.includes("/deps/"+name));assert(url,"resolve Vite dependency "+name);return url }')
  .replace("await page.addInitScript(()=>localStorage.setItem('spmusic.player.startup-page.v1','media-library'))", "await page.addInitScript(()=>{localStorage.setItem('spmusic.player.startup-page.v1','media-library');window.$RefreshReg$??=()=>{};window.$RefreshSig$??=()=>type=>type})")
  .replace('return React.createElement(RealSurface,props)', 'if(window.ignoreEntryPosition)props={...props,viewModel:{...props.viewModel,playlist:{...props.viewModel.playlist,entryPosition:undefined}}};return React.createElement(RealSurface,props)')
if (process.env.SPMUSIC_PERF_NO_ARTWORK === '1') {
  const artwork = 'coverArt:{mimeType:"image/svg+xml",filePath:fixtureCover,byteLen:1,dataUrl:fixtureCover}'
  if (!source.includes(artwork)) throw new Error('Empty-artwork fixture marker missing')
  source = source.replace(artwork, 'coverArt:null')
}
if (process.env.SPMUSIC_PERF_WINDOW_REGRESSION === '1') source = source
  .replace('window.viewModel=props.viewModel;', 'window.viewModel=props.viewModel;const [allTracksPatch,setAllTracksPatch]=React.useState(null);window.patchAllFixtureTracks=setAllTracksPatch;if(allTracksPatch)props={...props,viewModel:{...props.viewModel,playlist:{...props.viewModel.playlist,tracks:props.viewModel.playlist.tracks.map(track=>({...track,...allTracksPatch}))}}};')
  .replace("fileName:i+'.flac',available:true", "fileName:i+'.flac',available:i!==window.config.unavailableIndex")
if (replacement || noCrossfade || presenceDiagnostic || reverseFix || scrollOnly || windowProbe || headerDependency) {
  const paths = replacement ? JSON.parse(readFileSync(join(snapshot, 'manifest.json'), 'utf8')) : modules
  const routes = await Promise.all(paths.map(async (path, index) => ({ path,
    body: replacement ? readFileSync(join(snapshot, index + '.js'), 'utf8') : await (await fetch(origin + path)).text(),
  })))
  if (noCrossfade) for (const route of routes) route.body = route.body.replace(/(layoutId: [^\n]*playlist-library-cover[^\n]*,)/g, '$1\nlayoutCrossfade: false,')
  if (reverseFix) for (const route of routes) {
    if (route.path.endsWith('/PlaylistPanel.tsx') || route.path.endsWith('/PlaylistLibraryPanel.tsx')) {
      const coverCrossfade = /(layoutId: [^\n]*playlist-library-cover[^\n]*,)\s*layoutCrossfade: false,/
      if (!coverCrossfade.test(route.body)) throw new Error('Reverse-fix marker missing: ' + route.path)
      route.body = route.body.replace(coverCrossfade, '$1')
    }
    if (route.path.endsWith('/PlaylistLibraryPanel.tsx')) {
      if (!/if\s*\(!isPresent\)\s*return;/.test(route.body)) throw new Error('Reverse-fix guard marker missing')
      route.body = route.body.replace(/if\s*\(!isPresent\)\s*return;/, '')
    }
  }
  if (presenceDiagnostic) for (const route of routes) route.body = route.body.replace('const atomicOverview = chromeTransition.overviewBoundary;', 'const atomicOverview = chromeTransition.overviewBoundary; (window.__presence??=[]).push({time:performance.now(),isPresent,atomicOverview,handoff:chromeTransition.handoff,overviewVisible:chromeTransition.overviewVisible});')
  if (scrollOnly) for (const route of routes) if (route.path.endsWith('/usePlaylistControllerMotion.ts')) {
    const before = 'return panel ? Math.max(0, Math.min(panel.scrollTop, panel.scrollHeight - panel.clientHeight)) : 0;'
    if (!route.body.includes(before)) throw new Error('Scroll-only diagnostic marker missing')
    route.body = route.body.replace(before, 'return panel ? Math.max(0, panel.scrollTop) : 0;')
  }
  if (windowProbe) for (const route of routes) if (route.path.endsWith('/usePlaylistContentWindow.ts')) {
    route.body = route.body.replace('const previous = metrics.current;', 'const previous = metrics.current;window.__windowProbe?.push({kind:"refresh",time:performance.now(),representativeKey:latest.current.shapeKey??latest.current.representativeKey,width,viewport:innerWidth,level});')
      .replace('const samples = [', 'window.__windowProbe?.push({kind:"measure",time:performance.now(),representativeKey:latest.current.shapeKey??latest.current.representativeKey,width,viewport:innerWidth,level});const samples = [')
      .replace('new ResizeObserver(schedule)', 'new ResizeObserver(()=>{window.__windowProbe?.push({kind:"resize",time:performance.now()});schedule()})')
    if (!route.body.includes('kind:"measure"')) throw new Error('Window-probe marker missing')
  }
  if (headerDependency) for (const route of routes) if (route.path.endsWith('/PlaylistPanel.tsx')) {
    const before = 'const rebaseController = controllerMotion.rebase;'
    if (!route.body.includes(before)) throw new Error('Header-dependency marker missing')
    route.body = route.body.replace(before, 'const headerLayoutDependency=useMemo(()=>[sharedScope,isPresent,appearance,layoutLevel,searchOpen,playlistName],[sharedScope,isPresent,appearance,layoutLevel,searchOpen,playlistName]);'+before)
      .replace(/(layoutId: [^\n]*playlist-library-(?:cover|name|actions)[^\n]*,)/g, '$1\nlayoutDependency: headerLayoutDependency,')
  }
  source = source.replace("await page.goto(origin+'/__management_test?kind='+kind)",
    `for(const item of ${JSON.stringify(routes)})await page.route('**'+item.path+'*',route=>route.fulfill({contentType:'text/javascript',body:item.body}));\n  await page.goto(origin+'/__management_test?kind='+kind)`)
}
source += `
if(${process.env.SPMUSIC_PERF_SCALE_DIAGNOSTIC === '1'}){
  try{
    const {page}=await open(1280,900,'shell','no-preference')
    await setDurationScale(page,3);await importSource(page,'scaled')
    const frames=await page.evaluate(async()=>{
      const frames=[],start=performance.now()
      document.querySelector('.media-library-category[data-category-id="playlists"]').click()
      while(performance.now()-start<1600){await new Promise(requestAnimationFrame);const element=document.querySelector('.playlist-management-cover');const r=element?.getBoundingClientRect();frames.push({time:performance.now()-start,rect:r?[r.x,r.y,r.width,r.height]:null})}
      return frames
    })
    writeFileSync(join(screenshotDirectory,'scale3-overview-frames.json'),JSON.stringify(frames,null,2))
    const end=frames.at(-1).rect,lastMoving=frames.findLastIndex(frame=>!frame.rect||frame.rect.some((n,i)=>Math.abs(n-end[i])>.01))
    console.log(JSON.stringify({frame180Ms:frames[179]?.time,stableMs:frames[lastMoving+1]?.time,final:end,frames:frames.length}))
  }finally{await browser.close()}
  process.exit(0)
}
async function record(page, count, direction, readGeometry, iteration) {
  const session=await page.context().newCDPSession(page)
  const tracing=${process.env.SPMUSIC_PERF_TRACE !== '0'}
  await session.send('Performance.enable')
  if(${process.env.SPMUSIC_PERF_PROFILE === '1'}){await session.send('Profiler.enable');await session.send('Profiler.start')}
  if(tracing)await session.send('Tracing.start',{categories:'devtools.timeline,toplevel,blink.user_timing',transferMode:'ReturnAsStream'})
  const metricStart=(await session.send('Performance.getMetrics')).metrics
  const observation=await page.evaluate(async({direction,readGeometry})=>{
    const samples=[],start=performance.now();let previous=start
    window.__windowProbe=[]
    const longTasks=[]
    const collect=entries=>{for(const entry of entries)if(entry.startTime+entry.duration>=start)longTasks.push({startMs:entry.startTime-start,durationMs:entry.duration})}
    const observer=new PerformanceObserver(list=>collect(list.getEntries()))
    observer.observe({type:'longtask',buffered:false})
    const scope=direction==='grow'
      ?document.querySelector('.playlist-management-card-button')?.closest('[data-playlist-scope]')?.dataset.playlistScope
      :window.viewModel.playlist.library.currentScope
    performance.mark('spmusic-transition-start')
    document.querySelector(direction==='grow'?'.playlist-management-card-button':'.playlist-hero-category').click()
    while(performance.now()-start<900){
      const timestamp=await new Promise(requestAnimationFrame),now=performance.now()
      const artwork=document.querySelector('.playlist-hero-artwork')
      const covers=readGeometry?[...document.querySelectorAll('.playlist-hero-artwork,.playlist-management-cover')]
        .filter(element=>element.matches('.playlist-hero-artwork')||element.closest('[data-playlist-scope]')?.dataset.playlistScope===scope)
        .map(element=>{const r=element.getBoundingClientRect();let opacity=1;for(let a=element;a;a=a.parentElement)opacity*=Number(getComputedStyle(a).opacity);return{kind:element.matches('.playlist-hero-artwork')?'hero':'management',x:r.x,y:r.y,width:r.width,height:r.height,opacity,transform:getComputedStyle(element).transform}}):[]
      samples.push({time:now-start,delta:now-previous,raf:timestamp,covers,
        visibility:document.visibilityState,
        imageReady:artwork?Boolean(artwork.querySelector('img')?.complete&&artwork.querySelector('img')?.naturalWidth):null,
        cards:document.querySelectorAll('.playlist-card').length,pages:document.querySelectorAll('.playlist-panel,.playlist-management').length})
      previous=now
    }
    collect(observer.takeRecords());observer.disconnect()
    return {samples,longTasks,windowProbe:window.__windowProbe.map(event=>({...event,time:event.time-start})),
      workCalls:window.calls.filter(call=>call.time>=start&&call.time-start<900).map(call=>({command:call.command,time:call.time-start,path:call.input?.sourcePath??call.input?.path??null}))}
  },{direction,readGeometry})
  const {samples,longTasks}=observation
  const metricEnd=(await session.send('Performance.getMetrics')).metrics
  const structure=direction==='grow'?await page.evaluate(()=>{const heights=[...document.querySelectorAll('.playlist-card')].map(element=>element.getBoundingClientRect().height).sort((a,b)=>a-b);return {buttons:heights.length,copies:document.querySelectorAll('.playlist-card-copy').length,covers:document.querySelectorAll('.playlist-card-cover').length,images:document.querySelectorAll('.playlist-card-cover-image').length,scrollHeight:document.querySelector('.playlist-panel')?.scrollHeight,cardHeight:{min:heights[0],median:heights[Math.floor(heights.length/2)],max:heights.at(-1)}}}):null
  if(${process.env.SPMUSIC_PERF_PROFILE === '1'}){const {profile}=await session.send('Profiler.stop');writeFileSync(join(screenshotDirectory,'cpu-'+count+'-'+direction+'-'+readGeometry+'-'+iteration+'.json'),JSON.stringify(profile))}
  let events=[]
  if(tracing){
    const completed=new Promise(resolve=>session.once('Tracing.tracingComplete',resolve))
    await session.send('Tracing.end');const {stream}=await completed
    let raw='';for(;;){const part=await session.send('IO.read',{handle:stream});raw+=part.data;if(part.eof)break}
    await session.send('IO.close',{handle:stream});events=JSON.parse(raw).traceEvents
  }
  await session.detach()
  const named=name=>events.filter(event=>event.name===name&&event.ph==='X')
  const eventStat=name=>({count:named(name).length,durationMs:named(name).reduce((n,event)=>n+(event.dur??0),0)/1000})
  const marker=events.find(event=>event.name==='spmusic-transition-start')?.ts
  const phaseStats=marker?[0,150,350].map((from,index)=>{const to=[150,350,900][index];return {fromMs:from,toMs:to,...Object.fromEntries(['FunctionCall','Layout','UpdateLayoutTree','Paint'].map(name=>[name,named(name).reduce((n,event)=>n+Math.max(0,Math.min(event.ts+(event.dur??0),marker+to*1000)-Math.max(event.ts,marker+from*1000)),0)/1000]))}}):[]
  const metric=Object.fromEntries(metricEnd.map(item=>[item.name,item.value-(metricStart.find(other=>other.name===item.name)?.value??0)]))
  const intervals=samples.slice(1).map(sample=>sample.delta).sort((a,b)=>a-b)
  const expansion=samples.filter(sample=>sample.time<=450),postExpansion=expansion.slice(1)
  const targetKind=direction==='grow'?'hero':'management'
  const targetCover=sample=>sample.covers.find(cover=>cover.kind===targetKind)
  const last=targetCover(samples.at(-1))
  const moving=last?samples.findLastIndex(sample=>{const cover=targetCover(sample);return !cover||['x','y','width','height'].some(key=>Math.abs(cover[key]-last[key])>.5)}):-1
  const stableMs=moving>=0?samples[moving+1]?.time:null
  const countCalls=(start,end)=>Object.fromEntries([...new Set(observation.workCalls.filter(call=>call.time>=start&&call.time<end).map(call=>call.command))]
    .map(command=>[command,observation.workCalls.filter(call=>call.command===command&&call.time>=start&&call.time<end).length]))
  const movingIntervals=samples.slice(1).filter(sample=>stableMs!==null&&sample.time<=stableMs).map(sample=>sample.delta).sort((a,b)=>a-b)
  const result={count,direction,readGeometry,iteration,tracing,baseline:${JSON.stringify(replacement || reverseFix)},
    longTasks,
    windowProbe:observation.windowProbe,workCounts:countCalls(0,900),
    workPhases:{first350:countCalls(0,350),after350:countCalls(350,900),beforeStable:countCalls(0,stableMs??900),afterStable:countCalls(stableMs??900,900)},
    firstWorkMs:Object.fromEntries(['audio_probe_playlist_cover','audio_load_track_thumbnail','audio_load_playlist_cover_pixels'].map(command=>[command,observation.workCalls.find(call=>call.command===command)?.time??null])),
    probedIndices:observation.workCalls.filter(call=>call.command==='audio_load_track_thumbnail').map(call=>Number.parseInt(call.path?.split('/').at(-1)??'',10)),
    firstLaterProbeMs:observation.workCalls.find(call=>call.command==='audio_load_track_thumbnail'&&Number.parseInt(call.path?.split('/').at(-1)??'',10)>=10)?.time??null,
    firstOffscreenProbeMs:observation.workCalls.find(call=>call.command==='audio_load_track_thumbnail'&&Number.parseInt(call.path?.split('/').at(-1)??'',10)>=20)?.time??null,
    movingFrameP95Ms:movingIntervals.length?movingIntervals[Math.ceil(movingIntervals.length*.95)-1]:null,
    longTaskPhases:{first350:longTasks.filter(task=>task.startMs<350),after350:longTasks.filter(task=>task.startMs>=350)},
    structure,expansion450:{maxIncludingFirstMs:Math.max(...expansion.map(sample=>sample.delta)),maxAfterFirstMs:Math.max(...postExpansion.map(sample=>sample.delta)),afterFirstOver16Ms:postExpansion.filter(sample=>sample.delta>16.7).length,afterFirstOver32Ms:postExpansion.filter(sample=>sample.delta>32).length,longTasks:longTasks.filter(task=>task.startMs<450)},
    presence:${presenceDiagnostic}?await page.evaluate(()=>window.__presence??[]):undefined,
    frames:samples.length,firstFrameMs:samples[0]?.time,frameP95Ms:intervals[Math.ceil(intervals.length*.95)-1],maxFrameMs:Math.max(...intervals),over32Ms:intervals.filter(n=>n>32).length,
    stableMs,removedMs:samples.find(sample=>sample.pages===1)?.time,
    zeroVisibleCoverFrames:readGeometry?samples.filter(sample=>!sample.covers.some(cover=>cover.opacity>.1&&cover.width>0&&cover.height>0)).length:null,
    minCombinedCoverOpacity:readGeometry?Math.min(...samples.map(sample=>sample.covers.reduce((n,cover)=>n+cover.opacity,0))):null,
    fullCardCountObserved:direction==='grow'?Math.max(...samples.map(sample=>sample.cards)):null,
    firstImageReadyMs:samples.find(sample=>sample.imageReady)?.time??null,
    metrics:Object.fromEntries(['LayoutCount','LayoutDuration','RecalcStyleCount','RecalcStyleDuration','ScriptDuration','TaskDuration','JSHeapUsedSize'].map(key=>[key,metric[key]])),
    trace:tracing?{Layout:eventStat('Layout'),UpdateLayoutTree:eventStat('UpdateLayoutTree'),Paint:eventStat('Paint'),phases:phaseStats,LongTask:events.filter(event=>event.ph==='X'&&event.cat?.includes('toplevel')&&event.dur>50000).map(event=>({name:event.name,durationMs:event.dur/1000}))}:null,samples}
  writeFileSync(join(screenshotDirectory,'perf-'+count+'-'+direction+'-'+readGeometry+'-'+iteration+'.json'),JSON.stringify(result,null,2))
  if(${process.env.SPMUSIC_PERF_ASSERT_CONTINUITY === '1'}&&readGeometry)assert(result.minCombinedCoverOpacity>=.98,'combined cover opacity must remain >= .98: '+result.minCombinedCoverOpacity)
  if(${process.env.SPMUSIC_PERF_ASSERT_WINDOW_METRICS === '1'}&&direction==='grow'){
    const count=result.windowProbe.filter(event=>event.kind==='measure').length
    assert(count>0&&count<=10,'stable shape set must not remeasure heights per representative transfer: '+count)
    assert(result.structure.copies<300,'metrics regression exercises the bounded content path')
  }
  const {samples:_,...summary}=result;report.push(summary);console.log(JSON.stringify(summary))
}
async function windowSnapshot(page) {
  return page.evaluate(()=>{
    const panel=document.querySelector('.playlist-panel'),grid=document.querySelector('.playlist-grid'),p=panel.getBoundingClientRect()
    const dock=document.querySelector('.playlist-playback-dock'),bottom=Math.min(p.bottom,dock?.getBoundingClientRect().top??p.bottom)
    const cards=[...grid.querySelectorAll('.playlist-card')]
    const visible=cards.filter(card=>{const r=card.getBoundingClientRect();return r.bottom>p.top&&r.top<bottom&&r.right>p.left&&r.left<p.right})
    return {buttons:cards.length,copies:grid.querySelectorAll('.playlist-card-copy').length,covers:grid.querySelectorAll('.playlist-card-cover').length,
      visible:visible.length,missing:visible.filter(card=>!card.querySelector('.playlist-card-copy')?.textContent.trim()).map(card=>card.dataset.playlistTrackId),
      scrollHeight:panel.scrollHeight,scrollTop:panel.scrollTop,level:grid.dataset.layoutLevel,
      last:{label:cards.at(-1)?.getAttribute('aria-label'),copy:Boolean(cards.at(-1)?.querySelector('.playlist-card-copy')),imageReady:Boolean(cards.at(-1)?.querySelector('img')?.complete&&cards.at(-1)?.querySelector('img')?.naturalWidth)}}
  })
}
async function waitWindow(page) {
  await page.waitForFunction(()=>{
    const panel=document.querySelector('.playlist-panel'),grid=document.querySelector('.playlist-grid');if(!panel||!grid)return false
    const p=panel.getBoundingClientRect(),dock=document.querySelector('.playlist-playback-dock'),bottom=Math.min(p.bottom,dock?.getBoundingClientRect().top??p.bottom)
    return [...grid.querySelectorAll('.playlist-card')].every(card=>{const r=card.getBoundingClientRect();return r.bottom<=p.top||r.top>=bottom||r.right<=p.left||r.left>=p.right||Boolean(card.querySelector('.playlist-card-copy')?.textContent.trim())})
  })
}
async function windowRegress() {
  const {page,errors}=await open(1280,900,'shell','reduce')
  await importSource(page,'window',{count:1000,selectedIndex:999,unavailableIndex:998})
  await page.locator('.media-library-category[data-category-id="playlists"]').click();await settled(page,'.playlist-management')
  await page.locator('.playlist-management-card-button').click();await settled(page,'.playlist-panel');await waitWindow(page)
  assert.equal(await page.locator('.playlist-panel').evaluate(panel=>panel.scrollTop),0,'management entry explicitly starts at hero despite active last track')
  const ids=await page.locator('.playlist-card').evaluateAll(cards=>cards.map(card=>card.dataset.playlistTrackId))
  assert.deepEqual(ids,Array.from({length:1000},(_,index)=>'window-'+index),'all button identities and DOM order remain')
  assert(await page.locator('.playlist-card').evaluateAll(cards=>cards.every(card=>card.getAttribute('aria-label')&&card.tabIndex===0)),'offscreen buttons preserve accessible names and keyboard reachability')
  let snapshot=await windowSnapshot(page);assert(snapshot.copies<300,'initial full content stays bounded independently of 1000 button shells');report.push({initialWindow:snapshot})
  console.log('WINDOW initial bounds/ARIA passed')
  await page.locator('.playlist-card').last().evaluate(card=>card.focus({preventScroll:true}))
  await page.waitForFunction(()=>Boolean(document.querySelector('.playlist-card:last-child .playlist-card-copy')))
  assert.equal(await page.locator('.playlist-panel').evaluate(panel=>panel.scrollTop),0,'focus test prevents implicit scroll')
  assert.equal(await page.locator('.playlist-card').last().evaluate(card=>card===document.activeElement),true,'offscreen focused button remains the same node')
  await page.locator('.playlist-card').first().focus()
  console.log('WINDOW focus passed')
  await page.keyboard.down('Control')
  for(let level=0;level<10;level++){
    console.log('WINDOW layout '+level)
    if(level){await page.waitForTimeout(175);await page.locator('.playlist-grid').evaluate(grid=>grid.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120})));await page.waitForFunction(level=>document.querySelector('.playlist-grid').dataset.layoutLevel===String(level),level)}
    await page.locator('.playlist-panel').evaluate(panel=>{panel.scrollTop=0;panel.dispatchEvent(new Event('scroll'))});await waitWindow(page)
    const top=await windowSnapshot(page)
    await page.locator('.playlist-panel').evaluate(panel=>{panel.scrollTop=panel.scrollHeight;panel.dispatchEvent(new Event('scroll'))});await waitWindow(page)
    const tail=await windowSnapshot(page)
    assert.equal(tail.buttons,1000);assert.equal(tail.missing.length,0,'visible tail content at level '+level)
    assert(tail.last.copy,'last track content appears at level '+level)
    if(level===0){await page.waitForFunction(()=>{const image=document.querySelector('.playlist-card:last-child .playlist-card-cover-image');return image?.complete&&image.naturalWidth>0});report.push({tailArtworkLoaded:true})}
    assert(Math.abs(tail.scrollHeight-top.scrollHeight)<=2,'window changes retain full scroll geometry at level '+level+': '+top.scrollHeight+' -> '+tail.scrollHeight)
    assert(tail.copies<300,'tail content stays bounded at level '+level)
    report.push({layout:level,top,tail})
  }
  await page.keyboard.up('Control')
  console.log('WINDOW ten layouts passed')
  await page.setViewportSize({width:480,height:800});await waitWindow(page)
  snapshot=await windowSnapshot(page);assert.equal(snapshot.missing.length,0);report.push({resizedTail:snapshot})
  await page.locator('.playlist-panel').evaluate(panel=>{panel.scrollTop=0;panel.dispatchEvent(new Event('scroll'))});await waitWindow(page)
  await page.locator('.playlist-select-toggle:visible').first().click();await page.locator('.playlist-card').first().click()
  assert.equal(await page.locator('.playlist-card').first().getAttribute('data-selected'),'true')
  await page.locator('.playlist-panel').evaluate(panel=>{panel.scrollTop=panel.scrollHeight;panel.dispatchEvent(new Event('scroll'))});await waitWindow(page)
  await page.locator('.playlist-panel').evaluate(panel=>{panel.scrollTop=0;panel.dispatchEvent(new Event('scroll'))});await waitWindow(page)
  assert.equal(await page.locator('.playlist-card').first().getAttribute('data-selected'),'true','selection survives content eviction and reentry')
  console.log('WINDOW selection passed')
  await page.locator('.playlist-select-toggle:visible').first().click()
  await page.locator('.playlist-search-button:visible').first().click();await page.locator('.playlist-filter-input').fill('999')
  await page.waitForFunction(()=>document.querySelectorAll('.playlist-card').length===1)
  await page.locator('.playlist-filter-input').fill('no matching song');await page.waitForFunction(()=>document.querySelectorAll('.playlist-card').length===0)
  await page.locator('.playlist-filter-input').fill('');await page.waitForFunction(()=>document.querySelectorAll('.playlist-card').length===1000);await waitWindow(page)
  console.log('WINDOW search and empty recovery passed')
  assert.equal(await page.locator('[data-playlist-track-id="window-998"]').isDisabled(),true)
  assert.equal(await page.locator('[data-playlist-track-id="window-998"]').getAttribute('data-unavailable'),'true','unavailable offscreen shell retains disabled/error semantics')
  assert.deepEqual(errors,[]);await page.close()
  const entry=await open(1280,900,'shell','reduce')
  console.log('WINDOW entry test')
  await importSource(entry.page,'entry',{count:1000,selectedIndex:999});await entry.page.evaluate(()=>window.ignoreEntryPosition=true)
  await entry.page.locator('.media-library-category[data-category-id="playlists"]').click();await settled(entry.page,'.playlist-management');await entry.page.locator('.playlist-management-card-button').click();await settled(entry.page,'.playlist-panel');await waitWindow(entry.page)
  const centered=await entry.page.locator('.playlist-card').last().evaluate(card=>{const r=card.getBoundingClientRect(),panel=document.querySelector('.playlist-panel').getBoundingClientRect(),dock=document.querySelector('.playlist-playback-dock').getBoundingClientRect();return{scrollTop:document.querySelector('.playlist-panel').scrollTop,visible:r.bottom>panel.top&&r.top<dock.top,copy:Boolean(card.querySelector('.playlist-card-copy'))}})
  assert(centered.scrollTop>0&&centered.visible&&centered.copy,'without explicit entry, last active track is positioned and rendered');report.push({lastTrackEntry:centered})
  for(const width of [1318,980]){
    await entry.page.setViewportSize({width,height:900});await waitWindow(entry.page)
    const sizes=await entry.page.locator('.playlist-grid').evaluate(grid=>{
      const cards=[...grid.querySelectorAll('[data-content-representative="true"]')],align=cards.map(card=>card.style.alignSelf)
      try{for(const card of cards)card.style.alignSelf='start';return{viewport:innerWidth,gridWidth:grid.clientWidth,heights:cards.map(card=>({shape:card.dataset.contentShape,cached:Number.parseFloat(grid.style.getPropertyValue('--playlist-content-height-'+card.dataset.contentShape)),actual:Number.parseFloat(getComputedStyle(card).height)}))}}
      finally{cards.forEach((card,index)=>card.style.alignSelf=align[index])}
    })
    assert(sizes.heights.every(item=>Number.isFinite(item.cached)&&Math.abs(item.cached-item.actual)<.2),'representative slot height matches actual responsive geometry at '+width)
    report.push({responsiveGeometry:sizes})
  }
  assert.deepEqual(entry.errors,[]);await entry.page.close()
  const shape=await open(1280,900,'shell','reduce')
  console.log('WINDOW shape test')
  await shape.page.evaluate(()=>window.patchAllFixtureTracks({artist:'',album:'',durationSeconds:undefined,fileExtension:undefined,audioFormat:undefined}))
  await importSource(shape.page,'shape',{count:1000});await shape.page.locator('.media-library-category[data-category-id="playlists"]').click();await settled(shape.page,'.playlist-management');await shape.page.locator('.playlist-management-card-button').click();await settled(shape.page,'.playlist-panel');await waitWindow(shape.page)
  const shapeBefore=await shape.page.locator('.playlist-grid').evaluate(grid=>[...grid.querySelectorAll('[data-content-representative="true"]')].map(card=>({id:card.dataset.playlistTrackId,shape:card.dataset.contentShape,height:grid.style.getPropertyValue('--playlist-content-height-'+card.dataset.contentShape)})))
  await shape.page.evaluate(()=>window.patchAllFixtureTracks({artist:'New artist',album:'New album',durationSeconds:180,fileExtension:'flac'}));await waitWindow(shape.page)
  const shapeAfter=await shape.page.locator('.playlist-grid').evaluate(grid=>[...grid.querySelectorAll('[data-content-representative="true"]')].map(card=>({id:card.dataset.playlistTrackId,shape:card.dataset.contentShape,height:grid.style.getPropertyValue('--playlist-content-height-'+card.dataset.contentShape)})))
  assert.deepEqual(shapeBefore.map(item=>item.id),shapeAfter.map(item=>item.id),'same representative identities during metadata shape change')
  assert.notEqual(shapeBefore[0].shape,shapeAfter[0].shape)
  assert(shapeAfter.every(item=>Number.parseFloat(item.height)>0),'new shape height measured despite same representative id')
  report.push({shapeChange:{before:shapeBefore,after:shapeAfter}});assert.deepEqual(shape.errors,[]);await shape.page.close()
  console.log('WINDOW same-id shape remeasurement passed')
  const artwork=await open(1280,900,'shell','reduce')
  for(const key of ['A','B','C'])await artwork.page.route('**/qa-cover-'+key+'.svg',route=>route.fulfill({status:404,contentType:'image/svg+xml',body:''}))
  await artwork.page.route('**/qa-cover-D.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="purple"/></svg>'}))
  await importSource(artwork.page,'error',{count:1000});await artwork.page.locator('.media-library-category[data-category-id="playlists"]').click();await settled(artwork.page,'.playlist-management');await artwork.page.locator('.playlist-management-card-button').click();await settled(artwork.page,'.playlist-panel')
  await artwork.page.evaluate(()=>window.patchAllFixtureTracks({hasLocalArtwork:false,coverThumbnail:undefined,coverImage:'/qa-cover-A.svg',coverImageFallback:'/qa-cover-B.svg'}))
  await artwork.page.waitForFunction(()=>document.querySelector('[data-playlist-track-id="error-5"]')?.dataset.coverState==='error')
  await artwork.page.locator('.playlist-panel').evaluate(panel=>{panel.scrollTop=panel.scrollHeight;panel.dispatchEvent(new Event('scroll'))});await waitWindow(artwork.page)
  await artwork.page.waitForFunction(()=>document.querySelector('[data-playlist-track-id="error-5"]')?.dataset.contentVisible==='false')
  await artwork.page.locator('.playlist-panel').evaluate(panel=>{panel.scrollTop=0;panel.dispatchEvent(new Event('scroll'))});await waitWindow(artwork.page)
  assert.equal(await artwork.page.locator('[data-playlist-track-id="error-5"]').getAttribute('data-cover-state'),'error','failed source pair stays failed after content eviction')
  assert.equal(await artwork.page.locator('[data-playlist-track-id="error-5"] img').count(),0,'failed pair does not retry on reentry')
  await artwork.page.evaluate(()=>window.patchAllFixtureTracks({hasLocalArtwork:false,coverThumbnail:undefined,coverImage:'/qa-cover-C.svg',coverImageFallback:'/qa-cover-D.svg'}))
  await artwork.page.waitForFunction(()=>{const image=document.querySelector('[data-playlist-track-id="error-5"] img');return image?.complete&&image.naturalWidth===64&&image.src.endsWith('/qa-cover-D.svg')&&!image.hidden})
  report.push({artworkFailureReentry:true,newSourceFallbackRecovered:true});assert.deepEqual(artwork.errors,[]);await artwork.page.close()
  console.log('WINDOW artwork failure/source replacement passed')
  const interrupted=await open(1280,900,'shell','no-preference')
  await importSource(interrupted.page,'interrupt',{count:1000});await interrupted.page.locator('.media-library-category[data-category-id="playlists"]').click();await settled(interrupted.page,'.playlist-management');await interrupted.page.locator('.playlist-management-card-button').click();await settled(interrupted.page,'.playlist-panel')
  await interrupted.page.evaluate(async()=>{
    for(let iteration=0;iteration<4;iteration++){
      const panel=document.querySelector('.playlist-panel:not([inert])');panel.scrollTop+=100;panel.dispatchEvent(new Event('scroll'));panel.querySelector('.playlist-hero-category').click()
      for(let frame=0;frame<4;frame++)await new Promise(requestAnimationFrame)
      document.querySelector('.playlist-management:not([inert]) .playlist-management-card-button').click()
      for(let frame=0;frame<4;frame++)await new Promise(requestAnimationFrame)
    }
  })
  await settled(interrupted.page,'.playlist-panel');await waitWindow(interrupted.page)
  assert.equal(await interrupted.page.locator('.playlist-grid').getAttribute('data-content-window'),'bounded')
  assert.equal(await interrupted.page.locator('.playlist-panel').count(),1);assert.equal(await interrupted.page.locator('.playlist-playback-dock').count(),1)
  assert.equal(await interrupted.page.locator('.playlist-panel').evaluate(panel=>panel.scrollTop),0,'old scheduled scroll work does not override new top entry')
  assert.equal((await windowSnapshot(interrupted.page)).missing.length,0);assert.deepEqual(interrupted.errors,[])
  report.push({boundedRapidReversal:true,scheduledScrollExitCleanup:true});await interrupted.page.close()
  console.log('WINDOW bounded rapid reversal and scheduled-scroll exit passed')
  for(const kind of ['advanced','experimental']){
    const {page:themed,errors:themeErrors}=await open(1280,900,'shell','reduce')
    await themed.evaluate(async kind=>{
      const {defaultAppearance}=await import('/src/features/appearance/model/defaultAppearance.ts'),{saveAppearanceStorage}=await import('/src/features/appearance/model/appearanceStorage.ts')
      const theme={...defaultAppearance,id:'window-fallback',name:'Window fallback',metadata:{...defaultAppearance.metadata,tier:kind},advanced:{...defaultAppearance.advanced,customCss:kind==='advanced'?'.playlist-card { --window-qa: 1; }':''},experimental:{...defaultAppearance.experimental,layoutCss:kind==='experimental'?'.playlist-card { --window-qa: 2; }':''}}
      saveAppearanceStorage({currentThemeId:theme.id,colorSchemePreference:'light',userThemes:[theme]})
    },kind)
    await themed.reload();await themed.waitForFunction(()=>window.viewModel);await importSource(themed,'fallback',{count:1000})
    await themed.locator('.media-library-category[data-category-id="playlists"]').click();await settled(themed,'.playlist-management');await themed.locator('.playlist-management-card-button').click();await settled(themed,'.playlist-panel')
    assert.equal(await themed.locator('.playlist-card-copy').count(),1000,'custom CSS conservatively renders all content: '+kind)
    const marker=await themed.locator('.playlist-card').first().evaluate(card=>getComputedStyle(card).getPropertyValue('--window-qa').trim())
    assert.equal(marker,kind==='advanced'?'1':'2','fallback theme CSS really applied')
    assert.deepEqual(themeErrors,[]);report.push({fallback:kind,copies:1000,marker});await themed.close()
  }
  console.log(JSON.stringify({windowRegression:'PASS',report}))
}
if(${process.env.SPMUSIC_PERF_WINDOW_REGRESSION === '1'}){try{await windowRegress()}catch(error){for(const page of browser.contexts().flatMap(context=>context.pages())){await page.screenshot({path:join(screenshotDirectory,'window-regression-failure.png')}).catch(()=>{});await windowSnapshot(page).then(snapshot=>console.log(JSON.stringify({failureSnapshot:snapshot}))).catch(()=>{})}throw error}finally{await browser.close()}process.exit(0)}
if(${process.env.SPMUSIC_PERF_SCROLL_DIAGNOSTIC === '1'}){
  try{
    const {page,errors}=await open(1280,900,'shell','no-preference')
    await importSource(page,'scroll',{count:1000});await page.locator('.media-library-category[data-category-id="playlists"]').click();await settled(page,'.playlist-management');await page.locator('.playlist-management-card-button').click();await settled(page,'.playlist-panel')
    const scroll=await page.evaluate(async()=>{
      const panel=document.querySelector('.playlist-panel'),grid=document.querySelector('.playlist-grid'),start=performance.now(),frames=[],longTasks=[]
      const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(entry=>({startMs:entry.startTime-start,durationMs:entry.duration}))));observer.observe({type:'longtask'})
      let previous=start
      while(performance.now()-start<1000){
        panel.scrollTop+=100;await new Promise(requestAnimationFrame)
        const now=performance.now(),bounds=panel.getBoundingClientRect(),bottom=Math.min(bounds.bottom,document.querySelector('.playlist-playback-dock').getBoundingClientRect().top)
        let visible=0,missing=0
        for(const card of grid.children){const rect=card.getBoundingClientRect();if(rect.bottom>bounds.top&&rect.top<bottom){visible++;if(!card.querySelector('.playlist-card-copy')?.textContent.trim())missing++}}
        frames.push({time:now-start,delta:now-previous,visible,missing,scrollTop:panel.scrollTop,copies:grid.querySelectorAll('.playlist-card-copy').length});previous=now
      }
      longTasks.push(...observer.takeRecords().map(entry=>({startMs:entry.startTime-start,durationMs:entry.duration})));observer.disconnect()
      return {frames,longTasks}
    })
    const summary={baseline:${replacement},frames:scroll.frames.length,maxFrameMs:Math.max(...scroll.frames.map(frame=>frame.delta)),emptyVisibleFrames:scroll.frames.filter(frame=>frame.missing>0).length,longTasks:scroll.longTasks,maxCopies:Math.max(...scroll.frames.map(frame=>frame.copies)),endScrollTop:scroll.frames.at(-1).scrollTop}
    writeFileSync(join(screenshotDirectory,'scroll-summary.json'),JSON.stringify({...summary,samples:scroll.frames},null,2));console.log(JSON.stringify(summary))
    assert.equal(summary.emptyVisibleFrames,0,'continuous scrolling never exposes a card without content');assert.deepEqual(errors,[])
  }finally{await browser.close()}
  process.exit(0)
}
try {
  for(const count of ${JSON.stringify((process.env.SPMUSIC_PERF_COUNTS || '3,100,500').split(',').map(Number))}){
    const {page,errors}=await open(1280,900,'shell','no-preference')
    await importSource(page,'perf',{count})
    await page.locator('.media-library-category[data-category-id="playlists"]').click()
    await settled(page,'.playlist-management')
    for(const readGeometry of ${JSON.stringify(process.env.SPMUSIC_PERF_GEOMETRY_OFF === '1' ? [false] : process.env.SPMUSIC_PERF_GEOMETRY_ONLY === '1' ? [true] : [true,false])})for(let iteration=0;iteration<${Number(process.env.SPMUSIC_PERF_ITERATIONS || 3)};iteration++){
      await record(page,count,'grow',readGeometry,iteration);await settled(page,'.playlist-panel')
      if(${process.env.SPMUSIC_PERF_ASSERT_FAR_ROW === '1'}){
        const far=await page.evaluate(async()=>{
          const panel=document.querySelector('.playlist-panel'),cards=[...document.querySelectorAll('.playlist-card')],before=panel.scrollHeight
          const target=cards.at(-2),targetTop=target.offsetTop
          panel.scrollTop=targetTop
          await new Promise(requestAnimationFrame)
          const first={scrollHeight:panel.scrollHeight,scrollTop:panel.scrollTop,title:target.querySelector('.playlist-card-title')?.textContent,format:target.querySelector('.playlist-card-format')?.textContent,height:target.getBoundingClientRect().height,visible:target.checkVisibility({contentVisibilityAuto:true})}
          await new Promise(requestAnimationFrame)
          return {before,first,after:panel.scrollHeight,tailHeights:cards.slice(-4).map(card=>card.getBoundingClientRect().height)}
        })
        console.log('FAR_ROW',JSON.stringify(far))
        assert.equal(far.first.scrollHeight,far.before,'scrolling to far row preserves total scroll height')
        assert.equal(far.after,far.before,'far row layout remains stable after next paint')
        assert(far.first.visible&&far.first.title?.trim(),'far row title visible on first paint')
        assert.equal(far.first.format,undefined,'default tile layout intentionally omits extended metadata')
        await page.keyboard.down('Control')
        for(let level=1;level<=3;level++){
          await page.waitForTimeout(175)
          await page.locator('.playlist-grid').evaluate(grid=>grid.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120})))
          await page.waitForFunction(level=>document.querySelector('.playlist-grid')?.dataset.layoutLevel===String(level),level)
        }
        await page.keyboard.up('Control')
        const row=await page.evaluate(async()=>{
          const panel=document.querySelector('.playlist-panel'),cards=[...document.querySelectorAll('.playlist-card')],target=cards.at(-2),before=panel.scrollHeight
          panel.scrollTop=target.offsetTop
          await new Promise(requestAnimationFrame)
          return {before,after:panel.scrollHeight,scrollTop:panel.scrollTop,title:target.querySelector('.playlist-card-title')?.textContent,format:target.querySelector('.playlist-card-format')?.textContent,visible:target.checkVisibility({contentVisibilityAuto:true}),durationSeconds:window.viewModel.playlist.tracks.at(-2)?.durationSeconds}
        })
        console.log('FAR_ROW_EXTENDED',JSON.stringify(row))
        assert(row.visible&&row.title?.trim(),'row title visible on first paint')
        assert(row.format?.includes('3:00'),'row duration visible on first paint')
        assert.equal(row.after,row.before,'row far jump preserves scroll height')
      }
      if(${process.env.SPMUSIC_PERF_ASSERT_WARMUP === '1'}){
        await page.waitForFunction(()=>window.calls.some(call=>call.command==='audio_load_track_thumbnail'&&Number.parseInt(call.input?.sourcePath?.split('/').at(-1)??'',10)>=20),undefined,{timeout:10000})
        const warmup=await page.evaluate(()=>({probeCount:window.calls.filter(call=>call.command==='audio_load_track_thumbnail').length,furthestIndex:Math.max(...window.calls.filter(call=>call.command==='audio_load_track_thumbnail').map(call=>Number.parseInt(call.input?.sourcePath?.split('/').at(-1)??'',10)))}))
        console.log('WARMUP',JSON.stringify(warmup))
      }
      assert.equal(await page.locator('.playlist-card').count(),count,'fixture actually renders requested track count')
      if(${process.env.SPMUSIC_PERF_GROW_ONLY === '1'})await page.locator('.playlist-hero-category').click()
      else await record(page,count,'shrink',readGeometry,iteration)
      await settled(page,'.playlist-management')
    }
    assert.deepEqual(errors,[]);await page.close()
  }
  writeFileSync(join(screenshotDirectory,'performance-summary.json'),JSON.stringify({browser:browser.version(),report},null,2))
}finally{await browser.close()}
`
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
