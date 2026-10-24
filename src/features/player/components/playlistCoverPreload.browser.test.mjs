// Real hook + SPXR parser + BMP browser decode regression. Start Vite and set
// SPMUSIC_PLAYWRIGHT to an existing Playwright package; no dependency is added.
// SPMUSIC_PRELOAD_BASELINE=1 records the old cold-entry behavior before edits.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const servicePath = '/src/features/player/services/audioCommands.ts'
const hookPath = '/src/features/player/hooks/useAudioPlayer.ts'
let baselineHook
if (process.env.SPMUSIC_PRELOAD_BASELINE === '1') {
  const ts = require('typescript')
  const original = execFileSync('git', ['show', 'HEAD:' + hookPath.slice(1)], { encoding: 'utf8' })
  const transformedHook = await (await fetch(origin + hookPath)).text()
  baselineHook = ts.transpileModule(original, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/import \{([^}]+)\} from ["']react["'];/, (_line, names) => `import baselineReact from '${dependency('react.js')}';const {${names}}=baselineReact;`)
    .replace(/from ["']([^"']+)["']/g, (line, id) => {
      if (id.startsWith('@/')) {
        const path = '/src/' + id.slice(2)
        const ext = ['.ts', '.tsx'].find(ext => existsSync(path.slice(1) + ext))
        assert(ext, 'resolve baseline ' + id)
        return `from '${path}${ext}'`
      }
      if (id === 'sonner') {
        const match = transformedHook.match(/"([^"\n]*\/sonner\.js[^"\n]*)"/)
        assert(match)
        return `from '${match[1]}'`
      }
      return line
    })
}
const service = (await (await fetch(origin + servicePath)).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke = (...args) => window.backendInvoke(...args); const convertFileSrc = path => path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen = async () => () => {};')
assert(service.includes('window.backendInvoke'), 'only the desktop transport is replaced')
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import { useAudioPlayer } from '/src/features/player/hooks/useAudioPlayer.ts';
import { PlaylistCoverImage } from '/src/features/player/components/PlaylistCoverImage.tsx';
import { isPlaylistCoverDecoded } from '/src/features/player/model/playlistCoverReadiness.ts';
window.trace=[];window.config={count:12,scope:'a',pixelGate:false,decodeGate:false,failures:0,decodeFailures:0,noCover:[],unavailable:[],hydrationGate:false,sourceGate:false,sourceFailures:0,dataUrlOnly:[],sourceMismatch:false};
window.calls=[];window.pendingPixels=[];window.pendingDecodes=[];window.pendingHydrations=[];window.pendingSources=[];window.created=[];window.revoked=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null};
let generation=0,windowGeneration=0,active=0;
window.maxActive=0;window.liveListeners=0;
const originalCreate=URL.createObjectURL.bind(URL),originalRevoke=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=originalCreate(blob);window.created.push(url);return url};
URL.revokeObjectURL=url=>{window.revoked.push(url);originalRevoke(url)};
const originalDecode=HTMLImageElement.prototype.decode;
HTMLImageElement.prototype.decode=function(){const element=this;window.trace.push({type:'decode-start',src:element.src,time:performance.now()});return Promise.resolve().then(()=>window.config.decodeGate?new Promise(resolve=>window.pendingDecodes.push({src:element.src,resolve})):null).then(()=>{if(window.config.decodeFailures>0){window.config.decodeFailures--;throw new Error('injected decode failure')}return originalDecode.call(element)}).then(()=>window.trace.push({type:'decode-end',src:element.src,time:performance.now()}))};
const descriptor=(scope,i)=>({id:scope+'-'+i,sourcePath:'/audio/'+scope+'/'+i+'.flac',fileName:i+'.flac',available:!window.config.unavailable.includes(i)});
const playlist=()=>({directoryPath:'/audio/'+window.config.scope,directoryName:window.config.scope,sourceKind:'m3u8',sourcePath:'/lists/'+window.config.scope+'.m3u8',sourceName:window.config.scope,selectedIndex:0,tracks:Array.from({length:window.config.count},(_,i)=>descriptor(window.config.scope,i))});
const track=path=>{const parts=path.split('/');const scope=parts.at(-2),i=Number(parts.at(-1).split('.')[0]);return {...descriptor(scope,i),durationMs:180000,metadata:{title:'Song '+i,artist:'Artist',album:'Album',albumArtist:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:window.config.noCover.includes(i)?null:{mimeType:'image/png',filePath:'/covers/'+scope+'/'+i+'.png',dataUrl:null,byteLen:100}}}};
function spxr(edge){const bytes=new Uint8Array(40+edge*edge*4),view=new DataView(bytes.buffer);bytes.set([83,80,88,82]);view.setUint16(4,1,true);view.setUint16(6,40,true);for(const [offset,value]of [[8,edge],[12,edge],[16,edge*4],[20,1],[24,edge*edge*4],[28,0],[32,512],[36,512]])view.setUint32(offset,value,true);for(let i=40;i<bytes.length;i+=4)bytes.set([60,120,180,255],i);return bytes}
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,time:performance.now()});
 if(command==='library_get_playlists')return [];
 if(command==='library_get_folders')return {folders:[]};
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='audio_get_state')return state;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_get_current_track')return state.currentTrackId?track('/audio/'+state.currentTrackId.replace('-','/')+'.flac'):null;
 if(command==='audio_open_source')return {kind:'playlist',playlist:playlist()};
 if(command==='audio_load_file'){const result=track(input.path);state={...state,phase:'ready',generation:++generation,currentTrackId:result.id,durationMs:result.durationMs};return result}
 if(command==='audio_hydrate_track'){if(window.config.hydrationGate)await new Promise(resolve=>window.pendingHydrations.push(resolve));return track(input.path)}
 if(command==='audio_probe_playlist_cover'){
  if(window.config.sourceGate)await new Promise(resolve=>window.pendingSources.push(resolve));
  if(window.config.sourceFailures>0){window.config.sourceFailures--;throw {code:'INTERNAL_ERROR',message:'injected source capacity failure',recoverable:true}}
  const result=track(input.path),index=Number(input.path.split('/').at(-1).split('.')[0]);
  if(result.metadata.coverArt&&window.config.dataUrlOnly.includes(index))result.metadata.coverArt={...result.metadata.coverArt,filePath:null,dataUrl:'data:image/png;base64,AA=='};
  return {id:window.config.sourceMismatch?'wrong-source-id':result.id,sourcePath:result.sourcePath,coverArt:result.metadata.coverArt};
 }
 if(command==='audio_probe_playlist_track_summaries')return input.paths.map(sourcePath=>{const parts=sourcePath.replaceAll('\\\\','/').split('/'),i=Number(parts.at(-1).split('.')[0]);return {sourcePath,summary:{title:'Song '+i,artist:'Artist',album:'Album',albumArtist:null,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 if(command==='audio_begin_playlist_cover_window')return ++windowGeneration;
 if(command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels'){
  if(command==='audio_load_track_thumbnail'){
   const index=Number(input.sourcePath.split('/').at(-1).split('.')[0]);
   if(window.config.noCover.includes(index)||window.config.dataUrlOnly.includes(index))return new Uint8Array();
   if(window.config.sourceGate)await new Promise(resolve=>window.pendingSources.push(resolve));
   if(window.config.sourceFailures>0){window.config.sourceFailures--;throw {code:'INTERNAL_ERROR',message:'injected source capacity failure',recoverable:true}}
  }
  active++;window.maxActive=Math.max(active,window.maxActive);window.trace.push({type:'pixels-start',input,time:performance.now()});
  try{if(window.config.pixelGate)await new Promise(resolve=>window.pendingPixels.push(resolve));if(window.config.failures>0){window.config.failures--;throw {code:'WORKER_FAILED',message:'injected',recoverable:true}}return spxr(input.maxEdge)}finally{active--}
 }
 throw new Error('Unexpected command '+command);
};
const root=ReactDOM.createRoot(document.getElementById('root'));
window.unmountFixture=()=>root.unmount();
function Fixture(){
 const [open,setOpen]=React.useState(false);const player=useAudioPlayer(open);
 window.player=player;window.showFixture=()=>setOpen(true);window.hideFixture=()=>setOpen(false);
 window.readFixture=()=>({ids:player.queueTracks.map(t=>t.id),visualIds:Object.keys(player.playlistTrackVisuals),ready:Object.entries(player.playlistTrackVisuals).filter(([,v])=>v.coverThumbnail&&isPlaylistCoverDecoded(v.coverThumbnail)).map(([id])=>id),metadata:Object.keys(player.playlistTrackMetadata)});
 React.useLayoutEffect(()=>{if(open)window.trace.push({type:'paint',images:[...document.querySelectorAll('img')].map(e=>({src:e.src,loaded:e.dataset.loaded})),placeholders:document.querySelectorAll('[data-placeholder]').length,time:performance.now()})});
 return React.createElement('main',{'data-view':open?'playlist':'player'},open&&player.queueTracks.map(t=>{const image=player.playlistTrackVisuals[t.id]?.coverThumbnail;return image?React.createElement(PlaylistCoverImage,{key:t.id,image}):React.createElement('span',{key:t.id,'data-placeholder':t.id},t.title)}));
}
root.render(React.createElement(Fixture));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__preload_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
console.log('BROWSER', browser.version())
async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  if (baselineHook) await page.route('**/src/features/player/hooks/useAudioPlayer.ts*', route => route.fulfill({contentType:'text/javascript',body:baselineHook}))
  await page.route('**/__preload_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__preload_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__preload_test')
  await page.waitForFunction(() => Boolean(window.player))
  return { page, errors }
}
async function select(page, patch = {}) {
  await page.evaluate(async patch => { Object.assign(window.config, patch); await window.player.openAudio() }, patch)
  await page.waitForFunction(() => window.readFixture().ids.length === window.config.count)
}
async function waitReady(page, count) {
  await page.waitForFunction(count => window.readFixture().ready.length === count, count)
}
const report = []
try {
  const { page, errors } = await open()
  await select(page)
  if (process.env.SPMUSIC_PRELOAD_BASELINE === '1') {
    await page.waitForTimeout(300)
    const closed = await page.evaluate(() => ({ ...window.readFixture(), pixels:window.calls.filter(c=>c.command==='audio_load_playlist_cover_pixels').length }))
    assert.equal(closed.pixels, 0)
    await page.evaluate(() => { window.showFixture();window.player.setVisiblePlaylistTrackIds(window.readFixture().ids,true,true,{visibleIds:window.readFixture().ids,prefetchIds:[],coverCssPixels:128,dpr:1}) })
    await page.waitForFunction(() => document.querySelectorAll('img').length === 12)
    const paints = await page.evaluate(() => window.trace.filter(e=>e.type==='paint'))
    assert(paints.some(p=>p.images.some(i=>i.loaded==='false')))
    console.log('BASELINE', JSON.stringify({ closed, firstColdImages:paints.find(p=>p.images.length)?.images.length }))
  } else {
    await waitReady(page, 12)
    const before = await page.evaluate(() => ({...window.readFixture(),requests:window.calls.filter(c=>['audio_load_playlist_cover_pixels','audio_load_track_thumbnail'].includes(c.command)).length,maxActive:window.maxActive}))
    assert.equal(before.maxActive, 1, 'shared thumbnail scheduler serializes native pixel loads')
    assert.equal(before.requests, 13, 'first-track persisted thumbnail is upgraded for the hero after the list')
    assert.equal(await page.locator('img').count(), 0, 'preload does not mount playlist DOM')
    await page.evaluate(() => window.showFixture())
    await page.waitForFunction(() => document.querySelectorAll('img').length === 12)
    const paints = await page.evaluate(() => window.trace.filter(e=>e.type==='paint'))
    assert(paints[0].images.every(i=>i.loaded==='true'), 'all first-entry consumers are ready in their first commit')
    assert.equal(paints[0].placeholders, 0)
    await page.evaluate(() => {window.hideFixture();window.showFixture();window.player.setVisiblePlaylistTrackIds(window.readFixture().ids,true,true,{visibleIds:window.readFixture().ids,prefetchIds:[],coverCssPixels:128,dpr:1})})
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => window.calls.filter(c=>['audio_load_playlist_cover_pixels','audio_load_track_thumbnail'].includes(c.command)).length), 13, 'same-quality entry reuses URLs')
    report.push({case:'closed preload and first commit',...before})
  }
  assert.deepEqual(errors, [])
  await page.close()
  if (process.env.SPMUSIC_PRELOAD_BASELINE !== '1') {
    const {page: metadataBlocked,errors:metadataBlockedErrors}=await open()
    await select(metadataBlocked,{hydrationGate:true})
    await metadataBlocked.evaluate(()=>window.player.setVisiblePlaylistTrackIds(window.readFixture().ids,true,true,{visibleIds:window.readFixture().ids,prefetchIds:[],coverCssPixels:128,dpr:1}))
    await metadataBlocked.waitForFunction(()=>window.pendingHydrations.length>0)
    await waitReady(metadataBlocked,12)
    assert((await metadataBlocked.evaluate(()=>window.readFixture().metadata.length))<12,'cover completion does not wait for metadata')
    const visualFields=await metadataBlocked.evaluate(()=>Object.keys(window.player.playlistTrackVisuals['a-1']).sort())
    assert.deepEqual(visualFields,['coverThumbnail','coverTone','hasLocalArtwork','id'],'visual results cannot overwrite text or duration')
    await metadataBlocked.evaluate(()=>{window.config.hydrationGate=false;window.pendingHydrations.splice(0).forEach(resolve=>resolve())})
    await metadataBlocked.waitForFunction(()=>window.readFixture().metadata.length===12)
    assert.deepEqual(metadataBlockedErrors,[])
    report.push({case:'visual completion is independent of blocked metadata',ready:12,visualFields})
    await metadataBlocked.close()

    const {page: sourceBlocked,errors:sourceBlockedErrors}=await open()
    await select(sourceBlocked,{sourceGate:true})
    await sourceBlocked.waitForFunction(()=>window.pendingSources.length===1)
    await sourceBlocked.evaluate(()=>window.player.setVisiblePlaylistTrackIds(window.readFixture().ids,true,true,{visibleIds:window.readFixture().ids,prefetchIds:[],coverCssPixels:128,dpr:1}))
    assert.equal(await sourceBlocked.evaluate(()=>window.pendingSources.length),1,'shared native lane waits behind the gated thumbnail')
    await sourceBlocked.waitForFunction(()=>window.readFixture().metadata.length===12)
    assert.equal(await sourceBlocked.evaluate(()=>window.readFixture().ready.length),0,'metadata completion does not wait for cover source')
    await sourceBlocked.evaluate(()=>{window.config.sourceGate=false;window.pendingSources.splice(0).forEach(resolve=>resolve())})
    await waitReady(sourceBlocked,12)
    assert.deepEqual(sourceBlockedErrors,[])
    report.push({case:'metadata completion is independent of blocked source',metadata:12})
    await sourceBlocked.close()

    const {page: sourceRetry,errors:sourceRetryErrors}=await open()
    await select(sourceRetry,{sourceFailures:2})
    await waitReady(sourceRetry,12)
    const sourceRequests=await sourceRetry.evaluate(()=>window.calls.filter(call=>['audio_probe_playlist_cover','audio_load_track_thumbnail'].includes(call.command)).length)
    assert.equal(sourceRequests,15,'source capacity errors use the bounded retry budget and hero upgrade')
    assert.deepEqual(sourceRetryErrors,[])
    report.push({case:'recoverable source errors',requests:sourceRequests})
    await sourceRetry.close()

    const {page: fallbackOnly,errors:fallbackOnlyErrors}=await open()
    await select(fallbackOnly,{dataUrlOnly:[1]})
    await waitReady(fallbackOnly,11)
    await fallbackOnly.waitForFunction(()=>window.player.playlistTrackVisuals['a-1']?.hasLocalArtwork===false)
    await fallbackOnly.evaluate(()=>window.player.setVisiblePlaylistTrackIds(['a-1'],true,true,{visibleIds:['a-1'],prefetchIds:[],coverCssPixels:256,dpr:1}))
    await fallbackOnly.waitForTimeout(100)
    const fallbackResult=await fallbackOnly.evaluate(()=>({thumbnail:window.player.playlistTrackVisuals['a-1'].coverThumbnail??null,calls:window.calls.filter(call=>call.command==='audio_load_track_thumbnail'&&call.input.sourcePath==='/audio/a/1.flac').length,decoded:window.trace.filter(event=>event.type==='decode-start'&&event.src.startsWith('data:')).length}))
    assert.deepEqual(fallbackResult,{thumbnail:null,calls:1,decoded:0},'confirmed missing thumbnails stay quiet')
    assert.deepEqual(fallbackOnlyErrors,[])
    report.push({case:'confirmed missing thumbnail preserves placeholder',...fallbackResult})
    await fallbackOnly.close()

    const {page: fallbackUpgrade,errors:fallbackUpgradeErrors}=await open()
    await select(fallbackUpgrade)
    await waitReady(fallbackUpgrade,12)
    const priorFallback=await fallbackUpgrade.evaluate(()=>window.player.playlistTrackVisuals['a-1'].coverThumbnail.src)
    await fallbackUpgrade.evaluate(()=>window.player.setVisiblePlaylistTrackIds(['a-1'],true,true,{visibleIds:['a-1'],prefetchIds:[],coverCssPixels:512,dpr:2}))
    await fallbackUpgrade.waitForTimeout(100)
    assert.equal(await fallbackUpgrade.evaluate(()=>window.player.playlistTrackVisuals['a-1'].coverThumbnail.src),priorFallback,'high-DPR list cards reuse the persisted thumbnail URL')
    assert.equal(await fallbackUpgrade.evaluate(()=>window.calls.filter(call=>call.command==='audio_probe_playlist_cover'&&call.input.path==='/audio/a/1.flac').length),0,'high-DPR cards skip original-cover probing')
    assert.deepEqual(fallbackUpgradeErrors,[])
    report.push({case:'high-DPR list card reuses persisted thumbnail',retained:true})
    await fallbackUpgrade.close()

    const {page: mismatched,errors:mismatchedErrors}=await open()
    await select(mismatched,{sourceMismatch:true})
    await waitReady(mismatched,11)
    assert.equal(await mismatched.evaluate(()=>window.created.length),12,'mismatched 512px hero identity retains the verified persisted thumbnail')
    assert.deepEqual(mismatchedErrors,[])
    report.push({case:'source identity mismatch is discarded',created:0})
    await mismatched.close()

    const { page: fast, errors: fastErrors } = await open()
    await select(fast, {pixelGate:true})
    await fast.waitForFunction(() => window.pendingPixels.length===1)
    await fast.evaluate(() => window.showFixture())
    await fast.waitForFunction(() => document.querySelectorAll('[data-placeholder]').length===12)
    assert.equal(await fast.locator('main').getAttribute('data-view'), 'playlist', 'early entry remains immediate')
    await fast.evaluate(() => window.player.setVisiblePlaylistTrackIds(window.readFixture().ids,true,true,{visibleIds:window.readFixture().ids,prefetchIds:[],coverCssPixels:128,dpr:1}))
    await fast.evaluate(() => {window.config.pixelGate=false;window.pendingPixels.splice(0).forEach(resolve=>resolve())})
    await waitReady(fast, 12)
    await fast.waitForFunction(() => document.querySelectorAll('img[data-loaded="true"]').length===12)
    assert.deepEqual(fastErrors, [])
    report.push({case:'immediate entry before preload completes',ready:12})
    await fast.close()

    const {page: stale, errors: staleErrors} = await open()
    await select(stale,{decodeGate:true})
    await stale.evaluate(()=>window.player.setVisiblePlaylistTrackIds(window.readFixture().ids,true,true,{visibleIds:window.readFixture().ids,prefetchIds:[],coverCssPixels:128,dpr:1}))
    await stale.waitForFunction(() => window.pendingDecodes.length===2)
    const oldUrls=await stale.evaluate(() => [...window.created])
    assert.equal(oldUrls.length,2,'decode work is inside the bounded worker slots')
    await select(stale,{scope:'b',decodeGate:false})
    await stale.evaluate(() => window.pendingDecodes.splice(0).forEach(p=>p.resolve()))
    await waitReady(stale,12)
    const replacement=await stale.evaluate(() => ({...window.readFixture(),revoked:window.revoked}))
    assert(replacement.visualIds.every(id=>id.startsWith('b-')))
    assert(oldUrls.every(src=>replacement.revoked.includes(src)))
    await select(stale,{scope:'c',decodeGate:true})
    await stale.evaluate(()=>window.player.setVisiblePlaylistTrackIds(window.readFixture().ids,true,true,{visibleIds:window.readFixture().ids,prefetchIds:[],coverCssPixels:128,dpr:1}))
    await stale.waitForFunction(()=>window.pendingDecodes.length===2)
    await stale.evaluate(() => {window.unmountFixture();window.pendingDecodes.splice(0).forEach(p=>p.resolve())})
    await stale.waitForFunction(()=>window.created.every(src=>window.revoked.includes(src)))
    const released=await stale.evaluate(() => window.created.every(src=>window.revoked.includes(src)))
    assert(released,'all owned URLs released on disposal')
    assert.deepEqual(staleErrors,[])
    report.push({case:'replacement during decode and disposal',staleUrls:oldUrls.length})
    await stale.close()

    const {page: retry,errors:retryErrors}=await open()
    await select(retry,{failures:2})
    await waitReady(retry,12)
    const retries=await retry.evaluate(()=>({requests:window.calls.filter(c=>['audio_load_playlist_cover_pixels','audio_load_track_thumbnail'].includes(c.command)).length,maxActive:window.maxActive}))
    assert.equal(retries.requests,15)
    assert.equal(retries.maxActive, 1)
    assert.deepEqual(retryErrors,[])
    report.push({case:'recoverable pixel errors',...retries})
    await retry.close()

    const {page: bounded,errors:boundedErrors}=await open()
    await select(bounded,{count:1000})
    await bounded.waitForFunction(()=>{
      const count=window.readFixture().ready.length;
      if(window.observedCount!==count){window.observedCount=count;window.observedAt=performance.now()}
      return count>100&&performance.now()-window.observedAt>250;
    })
    const budget=await bounded.evaluate(()=>({ready:window.readFixture().ready.length,bytes:Object.values(window.player.playlistTrackVisuals).reduce((sum,v)=>sum+(v.coverThumbnail?v.coverThumbnail.encodedBytes+v.coverThumbnail.width*v.coverThumbnail.height*4:0),0),maxActive:window.maxActive}))
    assert(budget.ready>100&&budget.ready<1000,'all-list eligibility is limited by bytes rather than a small fixed count')
    assert(budget.bytes+2*512*512*4<=96*1024*1024,'resident images leave existing inflight reservation')
    assert.equal(budget.maxActive, 1)
    assert.deepEqual(boundedErrors,[])
    report.push({case:'large-list byte admission',...budget})
    await bounded.close()

    const {page: text,errors:textErrors}=await open()
    await select(text,{noCover:[3],unavailable:[4]})
    await waitReady(text,10)
    const retained=await text.evaluate(()=>Object.fromEntries(Object.entries(window.player.playlistTrackVisuals).filter(([,v])=>v.coverThumbnail).map(([id,v])=>[id,v.coverThumbnail.src])))
    await text.evaluate(()=>window.player.setVisiblePlaylistTrackIds([],false,false))
    await text.waitForTimeout(5100)
    const afterText=await text.evaluate(()=>({ready:window.readFixture().ready,images:Object.fromEntries(Object.entries(window.player.playlistTrackVisuals).filter(([,v])=>v.coverThumbnail).map(([id,v])=>[id,v.coverThumbnail.src])),pixelPaths:window.calls.filter(c=>c.command==='audio_load_track_thumbnail').map(c=>c.input.sourcePath)}))
    assert.deepEqual(afterText.images,retained,'background thumbnails survive beyond inactive view grace')
    assert.equal(afterText.ready.length,10)
    assert(afterText.pixelPaths.includes('/audio/a/3.flac'),'missing artwork is confirmed once by the thumbnail command')
    assert(!afterText.pixelPaths.includes('/audio/a/4.flac'))
    assert.deepEqual(textErrors,[])
    report.push({case:'text layout retention, no artwork and unavailable track',ready:10,retainedAfterMs:5100})
    await text.close()
  }
  console.log('REGRESSION',JSON.stringify(report))
} finally { await browser.close() }
