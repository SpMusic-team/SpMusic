// Independent acceptance: actual PlayerShell, simulated existing native transport.
// Requires Vite at SPMUSIC_TEST_ORIGIN (default http://127.0.0.1:5173).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'

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
import {PlayerSurface as RealSurface} from '/__insets_real_surface.js';
export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;let viewModel=new URLSearchParams(location.search).has('indexLocal')?{...props.viewModel,search:undefined}:props.viewModel;if(new URLSearchParams(location.search).has('playlistReference'))viewModel={...viewModel,playlist:{...viewModel.playlist,tracks:(viewModel.playlist.library.allSongs??[]).map(item=>item.track),metadataStatus:'ready',library:{...viewModel.playlist.library,isOpen:false,route:{view:'category',categoryId:'songs'}}}};return React.createElement(RealSurface,{...props,viewModel})}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.scanGate=new URLSearchParams(location.search).has('scanGate');window.summaryGate=new URLSearchParams(location.search).has('summaryGate');window.pendingScans=[];window.pendingSummaries=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const roots=['/music','/music/Mixed','/external','/empty','/hidden'];
const rows=[
 ['mixed-a','/music/Mixed/a.flac','Mixed','Ensemble','Rock;Pop'],
 ['mixed-b','/music/Mixed/b.flac','Mixed','Ensemble','Jazz'],
 ['mixed-c','/external/Mixed/c.flac','Mixed','Ensemble','Rock//Electronic'],
 ['solo','/music/Solo/solo.flac','Solo','Solo','Electronic'],
 ['modern','/music/Modern/modern.flac','Modern','Modern','J-Pop'],
 ['older','/music/Older/older.flac','Older','Older','Pop/Rock'],
 ['unknown','/music/Unknown/unknown.flac','Unknown','Unknown',null],
 ['invalid','/music/Invalid/invalid.flac','Invalid','Invalid',' '],
 ['bad','/music/Bad/bad.flac','Bad','Bad','Absent'],
 ['hidden','/hidden/hidden.flac','Hidden','Hidden','Hidden']
];
const largeCount=Number(new URLSearchParams(location.search).get('count'));if(largeCount)rows.splice(0,rows.length,...Array.from({length:largeCount},(_,i)=>['track-'+i,'/music/Mixed/Track-'+String(i).padStart(3,'0')+'.flac','Mixed','Ensemble','Rock']));rows.forEach(row=>{row[2]='Mixed';row[3]='Ensemble';row[4]='Rock'});if(new URLSearchParams(location.search).has('collectionVirtual'))rows.forEach((row,i)=>{row[2]='Album '+String(i).padStart(3,'0');row[4]=new URLSearchParams(location.search).get('collectionVirtual')==='root'?'Genre '+String(i).padStart(3,'0'):'Rock'});const mixedArtists=false;window.summaryGenres=Object.fromEntries(rows.map(row=>[row[0],row[4]]));
const descriptor=([id,sourcePath])=>({id,sourcePath,fileName:sourcePath.split('/').at(-1),available:true});
const descriptors=rows.map(descriptor),all=new Map(descriptors.map(row=>[row.sourcePath,row]));
const folder=path=>({directoryPath:path,directoryName:path.split('/').at(-1),sourceKind:'folder',sourcePath:path,sourceName:path.split('/').at(-1),selectedIndex:0,directoryPaths:[path],tracks:descriptors.filter(row=>row.sourcePath.startsWith(path+'/'))});
const track=path=>{const row=all.get(path),tags=rows.find(value=>value[1]===path);if(!row)throw Error('Unknown path '+path);return {...row,durationMs:180000,metadata:{title:tags[5]??'Title '+row.id,artist:mixedArtists?tags[3]:'Singer '+tags[3],album:tags[2],albumArtist:mixedArtists?null:tags[3],genre:'Hydrated Wrong',year:1999,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
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
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:180000,positionMs:0};
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
  return input.paths.map(sourcePath=>{const item=track(sourcePath);return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:item.metadata.albumArtist,genre:window.summaryGenres[item.id],year:2022,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__insets_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: Number(process.env.SPMUSIC_TEST_WIDTH) || 640, height: 1440 }, reducedMotion: process.env.SPMUSIC_TEST_MOTION ? 'no-preference' : 'reduce' })
page.setDefaultTimeout(15000)
const errors = [], consoleErrors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__insets_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__insets_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__insets_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => {
  localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
  localStorage.removeItem('spmusic.player.session.v1')
  const level = new URLSearchParams(location.search).get('level') ?? '3'
  for (const key of ['playlist', 'genre-songs', 'genre-album-tracks', 'year-songs', 'year-album-tracks', 'genre-root', 'genre-albums']) localStorage.setItem('spmusic.' + key + '.layout-level.v1', level)
})
const output = 'D:/spmusic-artifacts/genre-collection-insets'
mkdirSync(output,{recursive:true})
const results=[]
const active=()=>page.locator('.album-library-content:not([inert])')
const near=(a,b)=>assert(Math.abs(a-b)<.16, `${a} must equal ${b}`)
const measure=async(kind,width,level,shot=false)=>{
 const panel=kind==='playlist'?page.locator('.playlist-panel:not([inert])').first():active()
 await panel.waitFor()
 await panel.locator(kind==='playlist'?'.playlist-card':'.album-card').first().waitFor()
 const value=await panel.evaluate((node,kind)=>{
  const r=el=>{const x=el.getBoundingClientRect();return {left:x.left,right:x.right,width:x.width}}
  const pane=r(node),style=getComputedStyle(node),gutter=pane.width-node.clientWidth
  if(kind==='playlist')return {pane,left:parseFloat(style.paddingLeft),right:parseFloat(style.paddingRight)+gutter,gutter}
  const space=node.querySelector('.genre-collection-space'),list=node.querySelector('.album-list'),card=list.querySelector('.album-card'),rect=r(space),cr=r(card),cover=card.querySelector('.folder-cover'),copy=card.querySelector('.folder-copy'),shortcut=node.querySelector('.genre-all-songs')
  const s=getComputedStyle(list)
  return {pane,left:rect.left-pane.left,right:pane.right-rect.right,gutter,grid:r(list),flow:list.dataset.folderFlow,level:Number(list.dataset.folderLevel),padding:[parseFloat(s.paddingLeft),parseFloat(s.paddingRight)],cardLeft:cr.left-pane.left,cardRight:pane.right-cr.right,cover:cover?r(cover):null,copy:r(copy),shortcut:shortcut?{left:r(shortcut).left-pane.left,right:pane.right-r(shortcut).right}:null,position:s.position,rendered:list.querySelectorAll('.album-card').length}
 },kind)
 if(shot){await page.evaluate(()=>document.activeElement?.blur());await panel.locator('.album-card').first().hover();await page.screenshot({path:`${output}/${kind}-${width}-${level}.png`})}
 results.push({kind,width,level,...value});return value
}
const load=async(width,level,query='')=>{
 await page.setViewportSize({width,height:1100})
 await page.goto(origin+'/__insets_test?level='+level+query)
 await page.waitForFunction(count=>window.vm?.playlist.library.allSongs.length===count,query.includes('count=')?130:9)
}
const showRoot=async()=>{await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('genre'));await active().locator('.genre-card').first().waitFor()}
const showOverview=async()=>{await showRoot();await active().locator('.genre-card').first().click();await page.waitForFunction(()=>document.querySelector('.album-library-content:not([inert])')?.dataset.genreView==='albums')}
try{
 for(const width of [456,640,1440])for(let level=0;level<10;level++){
  await load(width,level,'&playlistReference=1');await page.evaluate(()=>window.vm.playlist.onOpenChange(true));const ref=await measure('playlist',width,level)
  await load(width,level);await showRoot()
  const root=await measure('root',width,level,level===3)
  await active().locator('.genre-card').first().click();await page.waitForFunction(()=>document.querySelector('.album-library-content:not([inert])')?.dataset.genreView==='albums')
  const overview=await measure('overview',width,level,level===3)
  for(const v of [root,overview]){
   near(v.left,ref.left);near(v.right,ref.right);assert.deepEqual(v.padding,[0,0]);assert.equal(v.level,level)
   if(v.flow==='row'||(v.flow==='text'&&level!==9)){near(v.cardLeft,ref.left);near(v.cardRight,ref.right)}
  }
  near(overview.shortcut.left,ref.left);near(overview.shortcut.right,ref.right)
  if(level===3){near(root.cover.width,165*Math.min(width/640,1));near(root.copy.left-root.cover.right,48*Math.min(width/640,1))}
  console.log('COLLECTION_INSETS',width,level,JSON.stringify({root:[root.left,root.right],overview:[overview.left,overview.right],shortcut:overview.shortcut}))
 }
 for(const width of [456,1440])for(const kind of ['root','overview']){
  await load(width,3,'&count=130&collectionVirtual='+kind)
  if(kind==='root')await showRoot();else await showOverview()
  const before=await measure(kind,width,3);assert.equal(before.position,'absolute');assert(before.rendered<130)
  const first=await active().locator('.album-card').first().getAttribute('data-album-key')
  await active().evaluate(node=>{node.scrollTop=9000})
  await page.waitForFunction(first=>document.querySelector('.album-library-content:not([inert]) .album-card')?.getAttribute('data-album-key')!==first,first)
  const after=await measure(kind,width,3)
  near(after.left,before.left);near(after.right,before.right);near(after.grid.width,before.grid.width);near(after.cardLeft,before.cardLeft);near(after.cardRight,before.cardRight)
  assert(after.rendered<130)
 }
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
 writeFileSync(output+'/geometry.json',JSON.stringify({results,errors,consoleErrors},null,2))
 console.log('PASS: 60 collection-page comparisons, shortcut alignment, preserved root geometry, 4 virtual scroll scenarios.')
}catch(e){writeFileSync(output+'/failure.json',JSON.stringify({results,errors,consoleErrors},null,2));await page.screenshot({path:output+'/failure.png'});throw e}
finally{await browser.close()}