// Independent acceptance: actual PlayerShell, simulated existing native transport.
// Requires Vite at SPMUSIC_TEST_ORIGIN (default http://127.0.0.1:5173).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, statSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `
import React from '${dependency('react.js')}';
import {PlayerSurface as RealSurface} from '/__year_real_surface.js';
export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;let viewModel=new URLSearchParams(location.search).has('indexLocal')?{...props.viewModel,search:undefined}:props.viewModel;if(new URLSearchParams(location.search).has('playlistReference'))viewModel={...viewModel,playlist:{...viewModel.playlist,tracks:(viewModel.playlist.library.allSongs??[]).slice(0,3).map(item=>item.track),metadataStatus:'ready',library:{...viewModel.playlist.library,isOpen:false}}};return React.createElement(RealSurface,{...props,viewModel})}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.scanGate=new URLSearchParams(location.search).has('scanGate');window.summaryGate=new URLSearchParams(location.search).has('summaryGate');window.pendingScans=[];window.pendingSummaries=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
window.changePhase=phase=>{state={...state,phase};window.listeners?.audio_state_changed?.({payload:{...state}});return {...state}};window.finishTrack=()=>{state={...state,phase:'ended',positionMs:180000};window.listeners?.audio_state_changed?.({payload:{...state}});return {...state}};
const roots=['/music','/music/Mixed','/external','/empty','/hidden'];
const rows=[
 ['mixed-a','/music/Mixed/a.flac','Mixed','Ensemble',2018],
 ['mixed-b','/music/Mixed/b.flac','Mixed','Ensemble',2019],
 ['mixed-c','/external/Mixed/c.flac','Mixed','Ensemble',null],
 ['solo','/music/Solo/solo.flac','Solo','Solo',2018],
 ['modern','/music/Modern/modern.flac','Modern','Modern',2026],
 ['older','/music/Older/older.flac','Older','Older',2017],
 ['unknown','/music/Unknown/unknown.flac','Unknown','Unknown',null],
 ['invalid','/music/Invalid/invalid.flac','Invalid','Invalid',0],
 ['bad','/music/Bad/bad.flac','Bad','Bad',2025],
 ['hidden','/hidden/hidden.flac','Hidden','Hidden',2027]
];
const mixedArtists=new URLSearchParams(location.search).has('mixedArtists');
if(mixedArtists)rows.splice(0,rows.length,
 ['martyr','/music/Mentalmeisters - 殉道者.flac','《明日方舟》游戏原声OST','Mentalmeisters',2022],
 ['nightfall','/music/塞壬唱片-MSR - 夜幕.mp3','《明日方舟》游戏原声OST','塞壬唱片-MSR',null]);
const indexSize=Number(new URLSearchParams(location.search).get('indexSize'));
if(indexSize)rows.splice(0,rows.length,...Array.from({length:indexSize},(_,i)=>['index-'+i,'/music/Index/'+i+'.flac','Index Album','Ensemble',2022,i===0?'0 Number':i===indexSize-1?'中文尾曲':(i<indexSize/3?'Alpha ':i<indexSize*2/3?'Middle ':'Zulu ')+String(i).padStart(3,'0')]));
if(new URLSearchParams(location.search).has('inheritOnly'))rows.splice(0,rows.length,...rows.filter(row=>['mixed-a','mixed-c'].includes(row[0])));
window.summaryYears=Object.fromEntries(rows.map(row=>[row[0],row[4]]));
if(new URLSearchParams(location.search).has('inheritOnly'))window.summaryYears['mixed-a']=null;
const descriptor=([id,sourcePath])=>({id,sourcePath,fileName:sourcePath.split('/').at(-1),available:true});
const descriptors=rows.map(descriptor),all=new Map(descriptors.map(row=>[row.sourcePath,row]));
const folder=path=>({directoryPath:path,directoryName:path.split('/').at(-1),sourceKind:'folder',sourcePath:path,sourceName:path.split('/').at(-1),selectedIndex:0,directoryPaths:[path],tracks:descriptors.filter(row=>row.sourcePath.startsWith(path+'/'))});
const track=path=>{const row=all.get(path),tags=rows.find(value=>value[1]===path);if(!row)throw Error('Unknown path '+path);return {...row,durationMs:180000,metadata:{title:tags[5]??'Title '+row.id,artist:mixedArtists?tags[3]:'Singer '+tags[3],album:tags[2],albumArtist:mixedArtists?null:tags[3],composer:row.id.startsWith('mixed-')?'Composer':null,genre:null,year:1999,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_playlists')return [];
 if(command==='library_get_folders')return {revision:0,roots:roots.map(path=>({path,selected:path!=='/hidden',directoryRules:[]}))};
 if(command==='library_clear_folders'){roots.length=0;return null}
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='library_scan_folder'){if(window.scanGate)await new Promise(resolve=>window.pendingScans.push(resolve));return folder(args.path)}
 if(command==='library_warm_cover_thumbnails')return {requested:input.paths.length,processed:input.paths.length,written:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  if(window.failPath===input.path)throw Error('simulated decode failure'); const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:180000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:null}}
 if(command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels'||command==='audio_load_folder_thumbnail')return new Uint8Array(0);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_probe_playlist_track_summaries'){
  if(window.summaryGate)await new Promise(resolve=>window.pendingSummaries.push(resolve));
  return input.paths.map(sourcePath=>{const item=track(sourcePath);if(item.id==='bad')return {sourcePath,summary:null,error:{code:'DECODE_FAILED',message:'Unreadable tags',recoverable:true}};return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:item.metadata.albumArtist,composer:item.id.startsWith('mixed-')?'Composer':null,year:window.summaryYears[item.id],bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__year_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: Number(process.env.SPMUSIC_TEST_WIDTH) || 640, height: 1440 }, reducedMotion: process.env.SPMUSIC_TEST_MOTION ? 'no-preference' : 'reduce' })
page.setDefaultTimeout(15000)
const errors = [], consoleErrors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__year_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__year_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__year_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => {
  localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
  localStorage.removeItem('spmusic.player.session.v1')
  if (new URLSearchParams(location.search).has('indexSize')) localStorage.setItem('spmusic.year-songs.sort.v1', JSON.stringify({ field: 'title', direction: 'asc' }))
  if (new URLSearchParams(location.search).has('entryHover')) {
    for (const scope of ['year-albums', 'artist-albums', 'album-artist-albums', 'composer-albums']) localStorage.setItem('spmusic.' + scope + '.layout-level.v1', new URLSearchParams(location.search).get('entryLevel') ?? '5')
  }
  if (new URLSearchParams(location.search).has('playlistReference')) localStorage.setItem('spmusic.playlist.layout-level.v1', '4')
})
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if (evidence) mkdirSync(evidence, { recursive: true })
const screenshot = async name => { if (evidence) await page.screenshot({ path: evidence + '/' + name + '.png' }) }
const selectCategory = async category => {
  await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
  await page.waitForFunction(category => window.vm.playlist.library.route.categoryId === category, category)
}
const active = () => page.locator('.playlist-library-content:not([inert])')
const songs = () => active().locator('.album-songs .playlist-card[data-song-key]')
const songNames = () => songs().evaluateAll(nodes => nodes.map(node => node.dataset.songKey.split('/').at(-1)).sort())
const queueIds = () => page.evaluate(() => window.vm.queue.tracks.map(track => track.id).sort())
const ready = () => page.waitForFunction(() => !window.vm.playback.isSelectionPending)
const backFromPlayer = async () => {
  await page.evaluate(() => window.vm.playlist.onOpenChange(false)); await page.waitForFunction(() => !window.vm.playlist.isOpen)
  await page.evaluate(() => window.vm.playlist.onOpenChange(true)); await page.waitForFunction(() => window.vm.playlist.isOpen)
}
const up = async () => {
  await active().locator('.playlist-hero-category').click()
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content:not([inert])').length === 1)
}

try {
 await page.goto(origin+'/__year_test?queue');
 await page.waitForFunction(()=>window.vm?.playlist.library.allSongs?.length>0);
 await selectCategory('queue');
 const panel=page.locator('.playlist-library-panel').last();
 await page.locator('.library-queue-count').waitFor();
 assert.equal(await page.locator('.library-queue-count').textContent(),'空');
 assert.equal(await page.getByRole('button',{name:'搜索',exact:true}).count(),0);
 await screenshot('queue-empty-'+page.viewportSize().width);
 const picked=await page.evaluate(()=>window.vm.playlist.library.allSongs.slice(0,3).map(e=>e.key));
 assert(await page.evaluate(keys=>window.vm.playlist.library.onAddToQueue({scope:null,songKeys:keys}),picked));
 await page.waitForFunction(()=>window.vm.playlist.library.queueSongs?.length===3);
 assert.equal(await page.locator('.library-queue-count').textContent(),'0/3'); assert.equal(await page.locator('.playlist-card-queue-mark:visible').count(),3,'one pending icon per card');
 assert(await page.evaluate(keys=>window.vm.playlist.library.onAddToQueue({scope:null,songKeys:[keys[0]]}),picked));
 await page.waitForFunction(()=>window.vm.playlist.library.queueSongs?.length===4);
 const queue=await page.evaluate(()=>window.vm.playlist.library.queueSongs.map(e=>({key:e.key,id:e.trackId,path:e.sourcePath})));
 assert.equal(new Set(queue.map(e=>e.key)).size,4);
 assert.equal(queue[0].id,queue[3].id);
 assert.equal(await page.getByRole('button',{name:'搜索',exact:true}).count(),0);
 await screenshot('queue-populated-'+page.viewportSize().width);

 for(let level=0;level<10;level++) {
  await page.evaluate(level=>localStorage.setItem('spmusic.all-songs.layout-level.v1',String(level)),level);
  await page.reload();await page.waitForFunction(()=>window.vm?.playlist.library.allSongs?.length>0);await selectCategory('queue');
  await page.locator('.library-queue-count').waitFor();
  assert.equal(await page.locator('.playlist-card-queue-mark:visible').count(),level<3?0:4,'queue marker list-only level '+level);
  if(level===0||level===4) await screenshot('queue-level-'+level+'-'+page.viewportSize().width);
 }
 await selectCategory('songs');assert.equal(await page.locator('.playlist-card-queue-mark:visible').count(),0,'all songs has no queue markers');
 await page.evaluate(()=>localStorage.setItem('spmusic.all-songs.layout-level.v1','4'));await page.reload();await page.waitForFunction(()=>window.vm?.playlist.library.allSongs?.length>0);await selectCategory('queue');
 const geometry=await page.locator('.library-queue-count').evaluate(el=>{let r=el.getBoundingClientRect();const more=document.querySelector('.playlist-management-selection-more .playlist-hero-more-button');let m=more.getBoundingClientRect();return {countCenter:r.x+r.width/2,iconCenter:m.x+m.width/2}});
 assert(Math.abs(geometry.countCenter-geometry.iconCenter)<1,JSON.stringify(geometry));


 await page.evaluate(id=>window.vm.playlist.library.onPlayQueueEntry(id),queue[0].key); await ready();
 await page.waitForFunction(()=>window.vm.playlist.library.queuePlayedCount===2);
 assert.equal(await page.locator('.library-queue-count').textContent(),'2/4','denominator is total, not unplayed');
 assert.equal(await page.evaluate(()=>window.vm.playlist.library.queueSongs.length),4,'playing retains records');
 await page.evaluate(()=>window.changePhase('paused'));
 assert.equal(await page.locator('.library-queue-count').textContent(),'2/4','pause retains records and denominator');
 await page.evaluate(()=>window.changePhase('playing'));
 assert.equal(await page.locator('.library-queue-count').textContent(),'2/4','resume is idempotent');
 assert(await page.evaluate(key=>window.vm.playlist.library.onAddToQueue({scope:null,songKeys:[key]}),picked[0]));
 const newEntry=await page.evaluate(()=>window.vm.playlist.library.queueSongs.at(-1).key);
 assert.equal(await page.locator('.library-queue-count').textContent(),'2/5');
 const allEntryIds=[...queue.map(e=>e.key),newEntry];
 await page.evaluate(id=>window.listeners.audio_state_changed({payload:{phase:'ended',generation:0,currentTrackId:id,positionMs:180000,durationMs:180000,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null}}),queue[0].id);
 assert.deepEqual(await page.evaluate(()=>window.vm.playlist.library.queueSongs.map(e=>e.key)),allEntryIds,'stale ended retains records');
 const oldEnd=await page.evaluate(()=>window.finishTrack());await ready();
 await page.waitForFunction(()=>window.vm.playlist.library.queuePlayedCount===3);
 assert.equal(await page.locator('.library-queue-count').textContent(),'3/5','ended and next playback retain total');
 assert.deepEqual(await page.evaluate(()=>window.vm.playlist.library.queueSongs.map(e=>e.key)),allEntryIds);
 await page.evaluate(payload=>window.listeners.audio_state_changed({payload}),oldEnd);
 assert.equal(await page.locator('.library-queue-count').textContent(),'3/5','duplicate/stale ended cannot change records');
 for(const [played,loads] of [[4,3],[5,4],[5,5]]) {await page.evaluate(()=>window.finishTrack());await page.waitForFunction(n=>window.calls.filter(e=>e.command==='audio_load_and_play').length===n,loads);await ready();await page.waitForFunction(n=>window.vm.playlist.library.queuePlayedCount===n,played)}
 const loadedPaths=await page.evaluate(()=>window.calls.filter(e=>e.command==='audio_load_and_play').map(e=>e.input.path));
 assert.deepEqual(loadedPaths,[...queue.map(e=>e.path),queue[0].path],'all duplicate occurrences remain navigable');
 await page.evaluate(()=>window.finishTrack());await ready();
 assert.equal(await page.locator('.library-queue-count').textContent(),'5/5','all completed records remain');
 assert.deepEqual(await page.evaluate(()=>window.vm.playlist.library.queueSongs.map(e=>e.key)),allEntryIds);
 await screenshot('queue-all-played-'+page.viewportSize().width);
 await page.reload();await page.waitForFunction(()=>window.vm?.playlist.library.allSongs?.length>0);await selectCategory('queue');
 assert.equal(await page.locator('.library-queue-count').textContent(),'5/5','restart retains played and total');
 await page.evaluate(id=>window.vm.playlist.library.onPlayQueueEntry(id),queue[0].key);await ready();
 assert.equal(await page.locator('.library-queue-count').textContent(),'5/5','replaying already played record does not increment count');
 const loadsBeforeClear=await page.evaluate(()=>window.calls.filter(e=>e.command==='audio_load_and_play').length);
 const clearMenu=async()=>{await page.locator('.playlist-management-selection-more .playlist-hero-more-button').click();await page.getByRole('button',{name:'清空队列',exact:true}).click()};

 await page.evaluate(()=>{window.originalQueueSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='spmusic.library-queue.v1')throw Error('simulated full storage');return window.originalQueueSetItem.call(this,key,value)}});
 await clearMenu();
 assert.equal(await page.locator('.library-queue-count').textContent(),'5/5','failed clear preserves records');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('spmusic.library-queue.v1')).entries.length),5,'failed clear preserves storage');
 await page.evaluate(()=>Storage.prototype.setItem=window.originalQueueSetItem);
 await page.getByRole('button',{name:'清空队列',exact:true}).click();
 await page.waitForFunction(()=>window.vm.playlist.library.queueSongs.length===0);
 assert.equal(await page.locator('.library-queue-count').textContent(),'空');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('spmusic.library-queue.v1')).entries.length),0,'manual clear persists');
 assert.equal(await page.evaluate(()=>window.calls.some(e=>/delete|audio_stop/.test(e.command))),false,'clear does not delete sources or stop audio');
 await page.evaluate(()=>window.vm.playback.onNext());await ready();
 await page.evaluate(()=>window.finishTrack());await ready();
 assert.equal(await page.evaluate(()=>window.calls.filter(e=>e.command==='audio_load_and_play').length),loadsBeforeClear,'clear prevents navigation to old snapshot');
 await screenshot('queue-manually-cleared-'+page.viewportSize().width);
 await page.reload();await page.waitForFunction(()=>window.vm?.playlist.library.allSongs?.length>0);await selectCategory('queue');
 assert.equal(await page.locator('.library-queue-count').textContent(),'空','clear survives restart');
 assert(await page.evaluate(key=>window.vm.playlist.library.onAddToQueue({scope:null,songKeys:[key]}),picked[2]));
 const failed=await page.evaluate(()=>window.vm.playlist.library.queueSongs[0]);
 await page.evaluate(path=>window.failPath=path,failed.sourcePath);
 await page.evaluate(id=>window.vm.playlist.library.onPlayQueueEntry(id),failed.key);await ready();
 assert.equal(await page.locator('.library-queue-count').textContent(),'0/1','failed record remains unplayed');
 await page.reload();await page.waitForFunction(()=>window.vm?.playlist.library.allSongs?.length>0);await selectCategory('queue');
 assert.equal(await page.locator('.library-queue-count').textContent(),'0/1','failed record persists');
 await page.evaluate(()=>localStorage.removeItem('spmusic.library-queue.v1')); await page.reload();
 await page.waitForFunction(()=>window.vm?.playlist.library.allSongs?.length>0); await selectCategory('album');
 const albumPanel=page.locator('.album-library-content:not([inert])');
 await albumPanel.locator('.album-card').first().waitFor();
 await albumPanel.getByRole('button',{name:'选择',exact:true}).click();
 const mixed=albumPanel.locator('.album-card').filter({has:page.locator('.folder-name',{hasText:/^Mixed$/})});
 await mixed.click();
 await page.locator('button[title="添加到队列"]').click();
 await page.waitForFunction(()=>window.vm.playlist.library.queueSongs?.length===3);
 assert.deepEqual((await page.evaluate(()=>window.vm.playlist.library.queueSongs.map(e=>e.trackId))).sort(),['mixed-a','mixed-b','mixed-c']);

 await page.reload(); await page.waitForFunction(()=>window.vm?.playlist.library.allSongs?.length>0); await selectCategory('composer'); const composerPanel=page.locator('.album-library-content:not([inert])');
 await composerPanel.locator('.album-card').first().waitFor();
 await composerPanel.getByRole('button',{name:'选择',exact:true}).click();
 await composerPanel.locator('.album-card').filter({has:page.locator('.folder-name',{hasText:/^Composer$/})}).click();
 await page.locator('button[title="添加到队列"]').click();
 await page.waitForFunction(()=>window.vm.playlist.library.queueSongs?.length===6);
 assert.deepEqual((await page.evaluate(()=>window.vm.playlist.library.queueSongs.slice(-3).map(e=>e.trackId))).sort(),['mixed-a','mixed-b','mixed-c']);

 await page.reload(); await page.waitForFunction(()=>window.vm?.playlist.library.allSongs?.length>0); await selectCategory('folders');
 const folderPanel=page.locator('.folder-hierarchy-content:not([inert])');
 await folderPanel.locator('[data-folder-path="/music"]').waitFor();
 const expectedFolder=await page.evaluate(()=>window.vm.playlist.library.allSongs.filter(e=>e.sourcePath.startsWith('/music/')).map(e=>e.trackId).sort());
 await folderPanel.getByRole('button',{name:'选择',exact:true}).click();
 await folderPanel.locator('[data-folder-path="/music"]').click();
 await page.locator('button[title="添加到队列"]').click();
 await page.waitForFunction(n=>window.vm.playlist.library.queueSongs.length===6+n,expectedFolder.length);
 assert.deepEqual((await page.evaluate(()=>window.vm.playlist.library.queueSongs.slice(6).map(e=>e.trackId))).sort(),expectedFolder);

 await page.evaluate(()=>localStorage.removeItem('spmusic.library-queue.v1'));await page.reload();await page.waitForFunction(()=>window.vm?.playlist.library.allSongs?.length>0);await selectCategory('songs');
 const ordinary=await page.evaluate(()=>window.vm.playlist.library.allSongs[0]);
 await page.evaluate(e=>window.vm.playlist.library.onPlaySong(e.scope,e.trackId),ordinary);await ready();
 await page.waitForFunction(()=>window.vm.playback.phase==='playing'||window.calls.some(e=>e.command==='audio_load_and_play'));
 assert(await page.evaluate(key=>window.vm.playlist.library.onAddToQueue({scope:null,songKeys:[key]}),ordinary.key));
 const lateId=await page.evaluate(()=>window.vm.playlist.library.queueSongs[0].key);
 await page.evaluate(()=>window.finishTrack());await ready();
 assert.deepEqual(await page.evaluate(()=>window.vm.playlist.library.queueSongs.map(e=>e.key)),[lateId],'ordinary playback cannot consume item added after playback start');
 console.log('QUEUE_PASS',JSON.stringify({width:page.viewportSize().width,geometry,queue,loadedPaths,errors,consoleErrors}));
 assert.deepEqual(errors,[]);
} catch(error) {console.log('QUEUE_FAILURE',await page.locator('body').innerText(),await page.evaluate(()=>({route:window.vm?.playlist.library.route,composers:window.vm?.playlist.library.allSongs?.map(e=>[e.trackId,e.track.libraryComposerName])})));await screenshot('queue-failure-'+page.viewportSize().width);throw error} finally {await browser.close()}
