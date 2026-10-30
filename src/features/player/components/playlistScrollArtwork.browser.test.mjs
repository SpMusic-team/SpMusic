// Real shell comparison during continuous scrollbar movement, followed by rest.
// SPMUSIC_SCROLL_BASELINE_DIR holds Vite modules saved from the working tree
// before this round (not Git HEAD, which predates the first performance fix).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const pixelsPerSecond=Number(process.env.SPMUSIC_SCROLL_PIXELS_PER_SECOND||0)
const modes=(process.env.SPMUSIC_SCROLL_MODES||'all-songs,playlist-active,playlist-readonly').split(',')
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const baselineFiles = ['components/PlayerShell.tsx', 'components/PlaylistPanel.tsx', 'hooks/useAudioPlayer.ts',
  'hooks/useLibraryArtwork.ts', 'hooks/usePlaylistContentWindow.ts', 'hooks/useAllSongsWindow.ts', 'services/playlistCoverScheduler.ts']
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>delete window.listeners[name];};')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__scroll_surface.js';export function PlayerSurface(props){window.surfaceRenders=(window.surfaceRenders??0)+1;window.vm=props.viewModel;return React.createElement(Surface,props)}`
function instrumentScheduler(source) {
  const result = source.replace('return scheduleCoverPixels(input, true, options);', `
    window.coverTrace.push({type:'schedule',path:input.sourcePath,priority:options.priority,time:performance.now()});
    return scheduleCoverPixels(input,true,options).then(value=>{window.coverTrace.push({type:value?'resolved':'discarded',path:input.sourcePath,time:performance.now()});return value});`)
  assert.notEqual(result, source, 'observe scheduler admission and discarded consumers without changing ordering')
  return result
}
const currentScheduler = await (await fetch(origin + '/src/features/player/services/playlistCoverScheduler.ts')).text()
const fixture = `
import React from '${dependency('react.js')}';import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';import '/src/index.css';
window.calls=[];window.coverTrace=[];window.phase='initial';window.samples=[];
window.rectMetrics={production:0,instrumentation:0};window.maxSampledRows=0;
const cardRect=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){if(this.hasAttribute('data-playlist-track-id'))window.rectMetrics[window.samplingGeometry?'instrumentation':'production']++;return cardRect.call(this)};
window.revokedUrls=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.revokedUrls.push(url);revoke(url)};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const descriptor=i=>({id:'a-'+i,sourcePath:'/audio/a/'+String(i).padStart(4,'0')+'.flac',fileName:String(i).padStart(4,'0')+'.flac',available:true});
const tracks=Array.from({length:600},(_,i)=>descriptor(i));
const folder={directoryPath:'/audio/a',directoryName:'Same music',sourceKind:'folder',sourcePath:'/audio/a',sourceName:'Same music',selectedIndex:0,tracks};
const list={...folder,sourceKind:'m3u8',sourcePath:'/lists/a.m3u8',sourceName:'Same music playlist'};
const track=path=>{const i=Number(path.split('/').at(-1).split('.')[0]);return {...descriptor(i),durationMs:180000,metadata:{title:'Song '+String(i).padStart(4,'0'),artist:'Artist',album:'Album',albumArtist:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:{mimeType:'image/png',filePath:'/covers/'+i+'.png',dataUrl:null,byteLen:100}}}};
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,current=null;
let hostDispatch=Promise.resolve();
function pixels(){const bytes=new Uint8Array(44),view=new DataView(bytes.buffer);bytes.set([83,80,88,82]);view.setUint16(4,1,true);view.setUint16(6,40,true);for(const [offset,value]of [[8,1],[12,1],[16,4],[20,1],[24,4],[32,1],[36,1]])view.setUint32(offset,value,true);bytes.set([60,120,180,255],40);return bytes}
window.backendInvoke=async(command,args)=>{
 const input=args?.input,path=input?.sourcePath??input?.path;const event={command,input,path,phase:window.phase,time:performance.now()};window.calls.push(event);
 // The real Tauri hydrate command is synchronous on host IPC dispatch. Its
 // duration holds dispatch; thumbnail workers release dispatch before decoding.
 // This models command admission, without blocking the browser/UI thread.
 const previousDispatch=hostDispatch;let releaseDispatch;hostDispatch=new Promise(resolve=>{releaseDispatch=resolve});await previousDispatch;
 event.dispatched=performance.now();if(command!=='audio_hydrate_track')releaseDispatch();
 if(command==='audio_load_track_thumbnail')event.visibleAtDispatch=[...(window.visibleElements??[])].some(node=>node.dataset.playlistTrackId===track(input.sourcePath).id);
 if(command==='library_get_playlists')return [list];
 if(command==='library_get_folders')return {folders:['/audio/a']};
 if(command==='library_scan_folder')return folder;
 if(command==='library_warm_cover_thumbnails')return {attempted:input.paths.length,computed:0,persisted:0,warmed:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return current;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_open_source')return {kind:'playlist',playlist:list};
 if(command==='audio_load_file'||command==='audio_load_and_play'){current=track(input.path);state={...state,phase:'ready',generation:++generation,currentTrackId:current.id,durationMs:180000};return current}
 if(command==='audio_hydrate_track'){await wait(40);event.finished=performance.now();releaseDispatch();return track(input.path)}
 if(command==='audio_probe_playlist_track_summaries'){await wait(8);return input.paths.map(sourcePath=>{const t=track(sourcePath);return {sourcePath,summary:{title:t.metadata.title,artist:t.metadata.artist,album:t.metadata.album,albumArtist:null,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}})}
 if(command==='audio_probe_playlist_durations'){await wait(8);return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}))}
 if(command==='audio_probe_playlist_cover'){await wait(40);const t=track(input.path);return {id:t.id,sourcePath:t.sourcePath,coverArt:t.metadata.coverArt}}
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels'||command==='audio_load_cover_pixels'){await wait(15);event.finished=performance.now();return pixels()}
 throw Error('Unexpected native command '+command);
};
window.startVisibilityObserver=()=>{
 const grid=document.querySelector('.all-songs-list')??document.querySelector('.playlist-grid');if(!grid)return [];
 const panel=grid.closest('.playlist-panel')??grid.closest('.playlist-management-content');if(!panel)return [];
 const bounds=panel.getBoundingClientRect(),dock=document.querySelector('.playlist-playback-dock')?.getBoundingClientRect();
 window.visibleElements=new Set();const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)window.visibleElements.add(entry.target);else window.visibleElements.delete(entry.target)}},{root:panel,rootMargin:'0px 0px -'+Math.max(0,bounds.bottom-Math.min(bounds.bottom,dock?.top??bounds.bottom)+5)+'px 0px',threshold:0});
 const cards=node=>node instanceof Element?[...(node.matches('[data-playlist-track-id]')?[node]:[]),...node.querySelectorAll('[data-playlist-track-id]')]:[];
 for(const card of grid.querySelectorAll('[data-playlist-track-id]'))observer.observe(card);
 const mutations=new MutationObserver(records=>{for(const record of records){for(const node of record.addedNodes)for(const card of cards(node))observer.observe(card);for(const node of record.removedNodes)for(const card of cards(node)){observer.unobserve(card);window.visibleElements.delete(card)}}});
 mutations.observe(grid,{subtree:true,childList:true});window.stopVisibilityObserver=()=>{observer.disconnect();mutations.disconnect();window.visibleElements.clear()};
};
window.visibleSnapshot=()=>{const rows=[...(window.visibleElements??[])].filter(node=>node.isConnected);window.maxSampledRows=Math.max(window.maxSampledRows,rows.length);return rows.map(node=>({id:node.dataset.playlistTrackId,painted:!!(node.querySelector('img')?.complete&&node.querySelector('img')?.naturalWidth>0)}))};
window.sample=()=>{const rows=window.visibleSnapshot();window.samples.push({time:performance.now(),phase:window.phase,visible:rows.length,painted:rows.filter(row=>row.painted).length,ids:rows.map(row=>row.id)})};
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountScrollFixture=()=>root.unmount();
root.render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(PlayerShell))));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__scroll_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
async function measure(mode, baseline) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
    localStorage.setItem('spmusic.playlist.layout-level.v1', '2')
    localStorage.setItem('spmusic.all-songs.layout-level.v1', '2')
  })
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__scroll_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__scroll_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__scroll_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  if (baseline) for (const path of baselineFiles) {
    let body = readFileSync(join(process.env.SPMUSIC_SCROLL_BASELINE_DIR, path.replaceAll('/', '_') + '.js'), 'utf8')
    if (path.endsWith('playlistCoverScheduler.ts')) body = instrumentScheduler(body)
    await page.route(`**/src/features/player/${path}*`, route => route.fulfill({ contentType: 'text/javascript', body }))
  }
  else await page.route('**/src/features/player/services/playlistCoverScheduler.ts*', route => route.fulfill({ contentType: 'text/javascript', body: instrumentScheduler(currentScheduler) }))
  try {
    await page.goto(origin + '/__scroll_test')
    await page.waitForFunction(() => window.vm?.playlist.library.items.length === 2)
    if (mode === 'all-songs') await page.evaluate(() => window.vm.playlist.library.onSelectCategory('songs'))
    else if (mode === 'playlist-active') {
      await page.evaluate(() => window.vm.playback.onOpenAudio())
      await page.waitForFunction(() => window.vm.queue.tracks.length === 600 && !window.vm.playback.isSelectionPending)
      await page.evaluate(() => window.vm.playlist.library.onSelect(window.vm.playlist.library.items.find(item => item.sourceKind === 'm3u8').scope))
    } else await page.evaluate(() => window.vm.playlist.library.onSelect(window.vm.playlist.library.items.find(item => item.sourceKind === 'm3u8').scope))
    await page.waitForFunction(() => document.querySelectorAll('.playlist-grid [data-playlist-track-id]').length > 0)
    await page.evaluate(()=>window.startVisibilityObserver())
    await page.waitForFunction(() => {const rows=window.visibleSnapshot();return rows.length>0&&rows.every(row=>row.painted)})
    // Both views begin with settled first-screen cache, then enter untouched
    // middle rows. No native persisted-cache advantage is assigned to either.
    await page.evaluate(() => {
      window.calls=[];window.coverTrace=[];window.samples=[];window.surfaceRenders=0;window.rectMetrics={production:0,instrumentation:0};window.maxSampledRows=0;window.phase='drag';window.dragStart=performance.now()
      window.initialVisibleIds=new Set(window.visibleSnapshot().map(row=>row.id))
      const grid=document.querySelector('.all-songs-list')??document.querySelector('.playlist-grid')
      const panel=grid.closest('.playlist-panel')??grid.closest('.playlist-management-content')
      window.scrollPanel=panel;panel.scrollTop=panel.scrollHeight*.25
    })
    if(pixelsPerSecond) {
      await page.waitForFunction(() => {const rows=window.visibleSnapshot();return rows.length>0&&rows.every(row=>row.painted&&!window.initialVisibleIds.has(row.id))})
      await page.evaluate(()=>{window.calls=[];window.coverTrace=[];window.samples=[];window.surfaceRenders=0;window.rectMetrics={production:0,instrumentation:0};window.maxSampledRows=0;window.dragStart=performance.now()})
    }
    await page.evaluate(async speed => {
      window.startScrollTop=window.scrollPanel.scrollTop
      if(speed) {
        const start=performance.now(),top=window.scrollPanel.scrollTop
        while(performance.now()-start<3000) {
          await new Promise(requestAnimationFrame)
          window.scrollPanel.scrollTop=top+(performance.now()-start)*speed/1000
          window.sample()
        }
      } else for(let step=0;step<48;step++) {
          window.scrollPanel.scrollTop+=window.scrollPanel.clientHeight*.07
          window.sample()
          await new Promise(resolve=>setTimeout(resolve,32))
      }
      window.phase='rest';window.stopTime=performance.now();window.sample()
    },pixelsPerSecond)
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.waitForFunction(() => {window.sample();const rows=window.visibleSnapshot();return rows.length>0&&rows.every(row=>row.painted)})
    const result = await page.evaluate(() => {
      const calls=window.calls,thumbs=calls.filter(call=>call.command==='audio_load_track_thumbnail'),drag=window.samples.filter(s=>s.phase==='drag'),rest=window.samples.filter(s=>s.phase==='rest')
      const count=command=>calls.filter(call=>call.command===command).length
      const seenPaths=new Set(),repeated=thumbs.filter(call=>{if(seenPaths.has(call.path))return true;seenPaths.add(call.path);return false})
      const pathCounts=new Map();for(const call of thumbs)pathCounts.set(call.path,(pathCounts.get(call.path)??0)+1)
      const firstThumb=thumbs[0]?.dispatched??null,firstPaint=drag.find(s=>s.painted>0)?.time??rest.find(s=>s.painted>0)?.time??null
      const scheduled=window.coverTrace.filter(e=>e.type==='schedule'),discarded=window.coverTrace.filter(e=>e.type==='discarded')
      return {mode:null,surfaceRenders:window.surfaceRenders,queueOpen:window.vm.queue.isOpen,rectMetrics:window.rectMetrics,maxSampledRows:window.maxSampledRows,scrollDistancePx:window.scrollPanel.scrollTop-window.startScrollTop,dragMs:window.stopTime-window.dragStart,firstRequestMs:firstThumb===null?null:firstThumb-window.dragStart,
        firstPaintMs:firstPaint===null?null:firstPaint-window.dragStart,afterStopMs:performance.now()-window.stopTime,
        dragVisibleFrames:drag.length,dragPaintedFraction:drag.reduce((n,s)=>n+s.painted,0)/drag.reduce((n,s)=>n+s.visible,0),
        final:rest.at(-1),thumbnails:thumbs.length,uniqueThumbnails:new Set(thumbs.map(c=>c.path)).size,
        optionalRereads:repeated.filter(call=>!call.visibleAtDispatch).length,visibleRereads:repeated.filter(call=>call.visibleAtDispatch).length,maxReadsPerPath:Math.max(0,...pathCounts.values()),
        fullHydrations:count('audio_hydrate_track'),coverProbes:count('audio_probe_playlist_cover'),summaries:count('audio_probe_playlist_track_summaries'),durations:count('audio_probe_playlist_durations'),
        scheduled:scheduled.length,discarded:discarded.length,
        commands:calls.filter(c=>!['audio_get_state','audio_get_current_track'].includes(c.command)).map(c=>({command:c.command,path:c.path,visibleAtDispatch:c.visibleAtDispatch,time:c.time-window.dragStart,dispatched:c.dispatched?c.dispatched-window.dragStart:undefined,finished:c.finished?c.finished-window.dragStart:undefined})),
        coverEvents:window.coverTrace.map(e=>({...e,time:e.time-window.dragStart}))}
    })
    result.mode = mode
    result.pixelsPerSecond=pixelsPerSecond||'fast-window-traverse'
    if(process.env.SPMUSIC_SCROLL_TRACE) {
      const {writeFileSync}=await import('node:fs')
      writeFileSync(join(process.env.SPMUSIC_SCROLL_TRACE,`${baseline?'before':'after'}-${mode}.json`),JSON.stringify(result,null,2))
    }
    assert(result.final.visible > 0 && result.final.painted === result.final.visible, mode + ' settles every visible cover')
    assert.equal(result.rectMetrics.instrumentation,0,'visibility instrumentation never scans card geometry')
    assert(result.maxSampledRows<70,'IntersectionObserver limits image sampling to the actual viewport')
    assert.equal(result.visibleRereads,0,mode+' never reloads a still-visible decoded cover')
    assert(result.maxReadsPerPath<=2,mode+' bounds optional prefetch rereads after offscreen cache eviction')
    if (!baseline && mode === 'playlist-active') {
      assert.equal(result.fullHydrations, 0, 'playlist scrolling never reads full player metadata')
      assert.equal(result.queueOpen, true, 'the hidden queue remains logically open to exercise its publication regression')
      assert(result.surfaceRenders<10, 'hidden queue and ordinary cover arrivals must not rerender the shell per thumbnail')
    }
    if (!baseline && mode !== 'all-songs') {
      const cleanup = await page.evaluate(() => {
        const source=window.vm.playlist.artworkSource
        const entry=[...source.keyByTrackId].find(([,key])=>source.store.getSnapshot(key)?.coverThumbnail)
        if(!entry)return {registered:false}
        const key=entry[1],url=source.store.getSnapshot(key).coverThumbnail.src,notices=[]
        const unsubscribe=source.store.subscribe(key,()=>notices.push(source.store.getSnapshot(key)))
        window.unmountScrollFixture()
        const snapshot=source.store.getSnapshot(key)
        unsubscribe()
        return {registered:true,notified:notices.length>0,lastCleared:notices.at(-1)===undefined,
          snapshotCleared:snapshot===undefined,urlRevoked:window.revokedUrls.includes(url)}
      })
      assert.deepEqual(cleanup,{registered:true,notified:true,lastCleared:true,snapshotCleared:true,urlRevoked:true},mode+' cleanup notifies external subscribers before a revoked URL can survive StrictMode lifecycle')
      result.cleanup=cleanup
    }
    assert.deepEqual(errors, [])
    return result
  } finally { await page.close() }
}
try {
  const results = []
  for (const baseline of process.env.SPMUSIC_SCROLL_BASELINE_DIR&&!process.env.SPMUSIC_SCROLL_CURRENT_ONLY ? [true, false] : [false]) {
    for (const mode of modes) {
      const result=await measure(mode,baseline)
      results.push({baseline,...result})
      const {commands,coverEvents,...summary}=result
      console.log('SCROLL_ARTWORK',JSON.stringify({baseline,...summary}))
      if(process.env.SPMUSIC_SCROLL_TRACE) {
        const {writeFileSync}=await import('node:fs')
        writeFileSync(join(process.env.SPMUSIC_SCROLL_TRACE,`${baseline?'before':'after'}-${mode}.json`),JSON.stringify(result,null,2))
      }
    }
  }
  assert(results.length >= modes.length)
  const activeBefore=results.find(result=>result.baseline&&result.mode==='playlist-active')
  const activeAfter=results.find(result=>!result.baseline&&result.mode==='playlist-active')
  if(activeBefore) {
    assert(activeBefore.fullHydrations>0,'saved round-two baseline reproduces viewport-triggered full metadata reads')
    assert.equal(activeAfter.fullHydrations,0,'the same continuous drag eliminates those full file reads')
  }
  if(pixelsPerSecond) {
    const songs=results.find(result=>!result.baseline&&result.mode==='all-songs')
    if(songs) for(const playlist of results.filter(result=>!result.baseline&&result.mode!=='all-songs')) {
      assert(playlist.dragPaintedFraction>=songs.dragPaintedFraction-0.1,'playlist visible cover completion stays within ten percentage points of All Songs at the same pixel speed')
    }
  }
} finally { await browser.close() }
