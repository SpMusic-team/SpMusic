// Real shell/owners/scheduler with deterministic native responses. The before
// route restores only dock-top clipping in the current working-tree Panel;
// current fade and directional ordering remain present in both versions.
// SPMUSIC_DOCK_BASELINE_DIR optionally supplies the saved pre-budget owner as
// well; without it, the before/after comparison isolates viewport geometry.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {runInNewContext} from 'node:vm'

const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const ts=createRequire(import.meta.url)('typescript')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const count=1200
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{
  const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'))
  assert(match,'resolve '+name);return match[1]
}
const shared=readFileSync(new URL('./playlistScrollArtwork.browser.test.mjs',import.meta.url),'utf8')
const literal=shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal,'reuse the real two-source shell fixture')
const fixture=runInNewContext(literal[1],{dependency}).replace('length:600','length:'+count)
  .replace('const root=ReactDOM.createRoot',`
window.coverDemands=[];window.scheduledThumbs=[];window.nativeActive=0;window.maxNativeActive=0;
const originalBackend=window.backendInvoke;window.backendInvoke=async(command,args)=>{
 const cover=command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels';
 if(cover){window.nativeActive++;window.maxNativeActive=Math.max(window.maxNativeActive,window.nativeActive)}
 try{return await originalBackend(command,args)}finally{if(cover)window.nativeActive--}
};
const root=ReactDOM.createRoot`)
assert(fixture.includes('length:'+count)&&fixture.includes('window.maxNativeActive'))
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>delete window.listeners[name];};')
const realSurface=await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()
const surface=`import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__dock_window_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;const original=props.viewModel.playlist.onVisibleTrackIdsChange;const observe=React.useCallback((ids,keep,artwork,demand)=>{if(demand)window.coverDemands.push({ids,...demand,top:document.querySelector('.playlist-panel')?.scrollTop});return original?.(ids,keep,artwork,demand)},[original]);return React.createElement(Surface,{...props,viewModel:{...props.viewModel,playlist:{...props.viewModel.playlist,onVisibleTrackIdsChange:observe}}})}`
const currentPanel=await(await fetch(origin+'/src/features/player/components/PlaylistPanel.tsx')).text()
const beforePanel=currentPanel.replace('const viewportBottom = panelRect.bottom;',`const dock = panel.parentElement?.querySelector('.playlist-playback-dock');const dockTop = dock?.getBoundingClientRect().top ?? panelRect.bottom;const viewportBottom = Math.min(panelRect.bottom,dockTop);`)
assert.notEqual(beforePanel,currentPanel,'before restores only the superseded dock boundary, never Git HEAD')
const oldOwner=process.env.SPMUSIC_DOCK_BASELINE_DIR
  ? ts.transpileModule(readFileSync(join(process.env.SPMUSIC_DOCK_BASELINE_DIR,'src/features/player/hooks/useLibraryArtwork.ts'),'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext},
  }).outputText
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"]react['"];?/,(_match,names)=>`import React from '${dependency('react.js')}';const {${names}}=React;`)
    .replace(/from\s*['"](@\/[^'"]+)['"]/g,(_match,path)=>`from '/src/${path.slice(2)}.ts'`)
  : null
const scheduler=(await(await fetch(origin+'/src/features/player/services/playlistCoverScheduler.ts')).text())
  .replace('return scheduleCoverPixels(input, true, options);',`window.scheduledThumbs.push({path:input.sourcePath,priority:options.priority,time:performance.now()});return scheduleCoverPixels(input,true,options);`)
assert(scheduler.includes('window.scheduledThumbs.push'),'observe admission priority without changing scheduling')
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__dock_window_fixture.js"')
const browser=await chromium.launch({headless:true,channel:'msedge'})
async function geometry(page){
  return page.evaluate(()=>{
    const panel=document.querySelector('.playlist-panel'),dock=document.querySelector('.playlist-playback-dock'),bounds=panel.getBoundingClientRect(),dockRect=dock.getBoundingClientRect()
    const demand=window.coverDemands.at(-1)
    const rows=[...panel.querySelectorAll('[data-playlist-track-id]')].map(node=>{
      const rect=node.getBoundingClientRect();return {id:node.dataset.playlistTrackId,top:rect.top,bottom:rect.bottom,height:rect.height,
        ready:!!(node.querySelector('img')?.complete&&node.querySelector('img')?.naturalWidth>0),url:node.querySelector('img')?.src}
    }).filter(row=>row.bottom>bounds.top&&row.top<bounds.bottom)
    return {top:panel.scrollTop,panelTop:bounds.top,panelBottom:bounds.bottom,dockTop:dockRect.top,rows,demand}
  })
}
async function settleNative(page){
  await page.waitForFunction(()=>{
    const now=performance.now(),size=window.calls.filter(call=>call.command==='audio_load_track_thumbnail'||call.command==='audio_load_playlist_cover_pixels').length
    if(window.nativeActive||window.quietSize!==size){window.quietSize=size;window.quietAt=now;return false}
    return now-(window.quietAt??now)>80
  })
}
async function move(page,fraction){
  const top=await page.evaluate(fraction=>{const panel=document.querySelector('.playlist-panel');panel.scrollTop=(panel.scrollHeight-panel.clientHeight)*fraction;return panel.scrollTop},fraction)
  await page.waitForFunction(top=>Math.abs((window.coverDemands.at(-1)?.top??-1)-top)<.5,top)
}
async function run(mode,before){
  const page=await browser.newPage({viewport:{width:2200,height:1100},deviceScaleFactor:2,reducedMotion:'reduce'})
  page.setDefaultTimeout(12000)
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(()=>{localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.setItem('spmusic.playlist.layout-level.v1','2')})
  await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
  await page.route('**/src/features/player/services/playlistCoverScheduler.ts*',route=>route.fulfill({contentType:'text/javascript',body:scheduler}))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}))
  await page.route('**/__dock_window_surface.js',route=>route.fulfill({contentType:'text/javascript',body:realSurface}))
  await page.route('**/__dock_window_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__dock_window_test',route=>route.fulfill({contentType:'text/html',body:html}))
  if(before)await page.route('**/src/features/player/components/PlaylistPanel.tsx*',route=>route.fulfill({contentType:'text/javascript',body:beforePanel}))
  if(before&&oldOwner)await page.route('**/src/features/player/hooks/useLibraryArtwork.ts*',route=>route.fulfill({contentType:'text/javascript',body:oldOwner}))
  try{
    await page.goto(origin+'/__dock_window_test')
    await page.waitForFunction(()=>window.vm?.playlist.library.items.length===2)
    if(mode==='active'){
      await page.evaluate(()=>window.vm.playback.onOpenAudio())
      await page.waitForFunction(count=>window.vm.queue.tracks.length===count&&!window.vm.playback.isSelectionPending,count)
    }
    await page.evaluate(()=>window.vm.playlist.library.onSelect(window.vm.playlist.library.items.find(item=>item.sourceKind==='m3u8').scope))
    await page.waitForFunction(count=>document.querySelectorAll('.playlist-grid [data-playlist-track-id]').length===count,count)
    await move(page,.82)
    // Jump to an untouched earlier window: backward overscan consumes the old
    // optional forty-row allowance above the screen, excluding the dock strip.
    await page.evaluate(()=>{window.postJumpCallsIndex=window.calls.length})
    await move(page,.31)
    const cold=await geometry(page)
    const covered=cold.rows.filter(row=>row.top>=cold.dockTop&&row.top<cold.panelBottom)
    assert(covered.length>0,'fixture has actual cards behind the translucent dock')
    assert(cold.rows.length>40,'dense physical viewport exceeds the optional prefetch allowance')
    if(before){
      assert(covered.every(row=>!cold.demand.visibleIds.includes(row.id)),'before reproduces dock-covered physical rows being demoted from visible demand')
      assert(covered.every(row=>cold.demand.prefetchIds.indexOf(row.id)>=40),'backward nearby demand exhausts the optional allowance before the dock strip')
      const uncoveredIds=cold.rows.filter(row=>row.top<cold.dockTop).map(row=>row.id)
      await page.waitForFunction(ids=>ids.every(id=>{const node=[...document.querySelectorAll('[data-playlist-track-id]')].find(node=>node.dataset.playlistTrackId===id);const image=node?.querySelector('img');return image?.complete&&image.naturalWidth>0}),uncoveredIds)
      const stalled=await geometry(page)
      const coveredIds=new Set(covered.map(row=>row.id))
      const missing=stalled.rows.filter(row=>coveredIds.has(row.id)&&!row.ready)
      assert(missing.length>0,'read-only optional allowance leaves real dock-covered images unrequested')
      const paths=missing.map(row=>'/audio/a/'+String(Number(row.id.slice(2))).padStart(4,'0')+'.flac')
      assert.equal(await page.evaluate(paths=>window.calls.filter(call=>call.command==='audio_load_track_thumbnail'&&paths.includes(call.input.sourcePath)).length,paths),0,'missing images have no native thumbnail request')
      if(oldOwner)await page.waitForFunction(()=>{
        const reads=window.calls.slice(window.postJumpCallsIndex).filter(call=>call.command==='audio_load_track_thumbnail').map(call=>call.input.sourcePath)
        return reads.length>new Set(reads).size
      })
      console.log('BASELINE_DOCK_STRIP_MISSING',JSON.stringify({physicalVisible:cold.rows.length,covered:covered.length,unrequested:missing.length,owner:oldOwner?'saved-before-budget-fix':'current-budget-owner',optionalThrashReproduced:!!oldOwner}))
      return
    }
    assert(covered.every(row=>cold.demand.visibleIds.includes(row.id)),'every dock-covered physical row is required viewport demand')
    const ids=covered.map(row=>row.id)
    await page.waitForFunction(ids=>ids.every(id=>{const node=[...document.querySelectorAll('[data-playlist-track-id]')].find(node=>node.dataset.playlistTrackId===id);const image=node?.querySelector('img');return image?.complete&&image.naturalWidth>0}),ids)
    const prepared=await geometry(page)
    const urls=Object.fromEntries(prepared.rows.filter(row=>ids.includes(row.id)).map(row=>[row.id,row.url]))
    const paths=ids.map(id=>'/audio/a/'+String(Number(id.slice(2))).padStart(4,'0')+'.flac')
    assert(await page.evaluate(paths=>paths.every(path=>window.scheduledThumbs.some(job=>job.path===path&&job.priority===1)),paths),'dock-covered cards enter native work at visible priority')
    const oldCalls=await page.evaluate(paths=>window.calls.filter(call=>call.command==='audio_load_track_thumbnail'&&paths.includes(call.input.sourcePath)).length,paths)
    // Move the prepared cards out from under the controller; they keep their
    // loaded URLs instead of beginning their first request only at exposure.
    await page.evaluate(height=>{const panel=document.querySelector('.playlist-panel');panel.scrollTop+=height},Math.max(...covered.map(row=>row.height)))
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    const exposed=await geometry(page)
    const emerging=exposed.rows.filter(row=>ids.includes(row.id)&&row.top<exposed.dockTop)
    assert(emerging.length>0)
    assert(emerging.every(row=>row.ready&&row.url===urls[row.id]),'cards emerge already decoded with the same retained cover')
    assert.equal(await page.evaluate(paths=>window.calls.filter(call=>call.command==='audio_load_track_thumbnail'&&paths.includes(call.input.sourcePath)).length,paths),oldCalls,'exposure does not reload prepared controller-strip covers')
    await page.setViewportSize({width:1600,height:900})
    await page.waitForFunction(()=>{const p=document.querySelector('.playlist-panel'),r=p.getBoundingClientRect();const ids=window.coverDemands.at(-1)?.visibleIds??[];return [...p.querySelectorAll('[data-playlist-track-id]')].filter(n=>{const b=n.getBoundingClientRect();return b.bottom>r.top&&b.top<r.bottom}).every(n=>ids.includes(n.dataset.playlistTrackId))})
    await settleNative(page)
    const stats=await page.evaluate(()=>({maxNative:window.maxNativeActive,requests:window.calls.filter(call=>call.command==='audio_load_track_thumbnail').length,edges:window.calls.filter(call=>call.command==='audio_load_track_thumbnail').map(call=>call.input.maxEdge),windowCount:window.coverDemands.at(-1).ids.length,fullHydrates:window.calls.slice(window.postJumpCallsIndex).filter(call=>call.command==='audio_hydrate_track').length}))
    // The shared scheduler is bounded, not serialised: up to MAX_CONCURRENT
    // (four, matching the Rust decode permits) native cover requests may be in
    // flight at once. What this test protects is that the dock window never
    // becomes unbounded, so the ceiling — not a bare `1` — is asserted.
    assert(stats.maxNative <= 4, 'native cover work stays within the admission ceiling')
    assert(stats.requests<count/2,'bounded nearby demand does not read the complete source')
    assert(stats.windowCount<count/2,'physical visibility keeps a bounded nearby window instead of preloading the entire source')
    assert.equal(stats.fullHydrates,0,'cover visibility never introduces complete player metadata reads')
    assert(stats.edges.every(edge=>edge===256),'high-DPR list artwork stays on the persisted thumbnail lane')
    assert.deepEqual(errors,[])
    console.log('PASS','dock-covered physical viewport',JSON.stringify({mode,visible:prepared.rows.length,covered:ids.length,emerging:emerging.length,requests:stats.requests,maxNative:stats.maxNative,dpr:2}))
  }catch(error){
    console.error('DOCK_WINDOW_FAILURE',JSON.stringify({mode,before,errors,...await page.evaluate(()=>({active:window.nativeActive,maxActive:window.maxNativeActive,coverCalls:window.calls.filter(call=>call.command==='audio_load_track_thumbnail').length,lastPaths:window.calls.filter(call=>call.command==='audio_load_track_thumbnail').slice(-8).map(call=>call.input.sourcePath)}))}))
    throw error
  }finally{await page.close()}
}
try{
  await run('readonly',true)
  await run('readonly',false)
  await run('active',false)
}finally{await browser.close()}
