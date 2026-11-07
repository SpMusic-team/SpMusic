// Independent acceptance: actual PlayerShell/PlayerSurface; native transport alone is controlled.
// Real network decoding is separately exercised by audio/network_tests.rs.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const main = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = main.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve Vite dependency ${name}`)
  return match[1]
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__streams_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.failAdd=false;window.failRead=false;
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const initial=[
 {id:'alpha',sourceKind:'stream',sourcePath:'https://example.test/Radio?Token=UPPER',fileName:'Alpha Radio',title:'Alpha Radio',createdAtMs:100,available:true},
 {id:'beta',sourceKind:'stream',sourcePath:'https://example.test/radio?Token=lower',fileName:'Beta Radio',title:'Beta Radio',createdAtMs:300,available:true},
 {id:'gamma',sourceKind:'stream',sourcePath:'https://example.test/Gamma',fileName:'Gamma Radio',title:'Gamma Radio',createdAtMs:200,available:true}
];
const local={id:'local',sourceKind:'file',sourcePath:'/music/local.wav',fileName:'local.wav',fileCreatedAtMs:10,available:true};
if(!localStorage.getItem('streams.acceptance.registry'))localStorage.setItem('streams.acceptance.registry',JSON.stringify(initial));
const streams=()=>JSON.parse(localStorage.getItem('streams.acceptance.registry'));
const save=rows=>localStorage.setItem('streams.acceptance.registry',JSON.stringify(rows));
const snapshot=()=>({directoryPath:'',directoryName:'流',sourceKind:'streams',sourcePath:'streams:library',sourceName:'流',selectedIndex:0,tracks:streams()});
const imported=()=>JSON.parse(localStorage.getItem('streams.acceptance.imported')||'[]');
const fullTrack=path=>{
 const descriptor=[local,...streams(),...imported().flatMap(item=>item.tracks)].find(row=>row.sourcePath===path);
 if(!descriptor)throw Error('Unknown path '+path);
 return {...descriptor,durationMs:descriptor.sourceKind==='stream'?null:60000,metadata:{title:descriptor.title||'Local song',artist:descriptor.sourceKind==='stream'?null:'Local artist',album:descriptor.sourceKind==='stream'?null:'Local album',albumArtist:null,composer:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}};
};
window.pulse=(positionMs,phase=state.phase)=>{state={...state,positionMs,phase};window.listeners?.audio_state_changed?.({payload:{...state}})};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_streams'){if(window.failRead)throw {code:'STORAGE',message:'fixture registry unavailable'};return snapshot()}
 if(command==='library_add_stream'){
  if(window.failAdd)throw {code:'STORAGE',message:'fixture save failure'};
  const url=new URL(input.url);url.hash='';const rows=streams();const old=rows.find(row=>row.sourcePath===url.href);
  if(old){if(input.title){old.title=input.title;old.fileName=input.title}}else rows.push({id:'added-'+rows.length,sourceKind:'stream',sourcePath:url.href,title:input.title||url.href,fileName:input.title||url.href,available:true,createdAtMs:500});
  save(rows);return snapshot();
 }
 if(command==='library_remove_streams'){save(streams().filter(row=>!input.ids.includes(row.id)));return snapshot()}
 if(command==='library_get_playlists')return imported();
 if(command==='library_get_folders')return {revision:0,roots:[{path:'/music',selected:true,directoryRules:[]}]};
 if(command==='library_scan_folder')return {directoryPath:'/music',directoryName:'music',sourceKind:'folder',sourcePath:'/music',sourceName:'music',selectedIndex:0,directoryPaths:['/music'],tracks:[local]};
 if(command==='audio_import_playlist'){
  const added={id:'imported',sourceKind:'stream',sourcePath:'https://example.test/Imported?X=Y',title:'Imported Radio',fileName:'Imported Radio',createdAtMs:600,available:true};
  if(!streams().some(row=>row.id===added.id))save([...streams(),added]);
  const playlist={directoryPath:'/lists',directoryName:'Mixed',sourceKind:'m3u8',sourcePath:'/lists/mixed.m3u8',sourceName:'Mixed',selectedIndex:0,tracks:[local,added]};
  localStorage.setItem('streams.acceptance.imported',JSON.stringify([playlist]));return playlist;
 }
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='library_warm_cover_thumbnails')return {requested:input.paths.length,processed:0,written:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  const result=fullTrack(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:result.durationMs,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return fullTrack(input.path);
 if(command==='audio_probe_playlist_cover')return {id:fullTrack(input.path).id,sourcePath:input.path,coverArt:null};
 if(['audio_load_track_thumbnail','audio_load_playlist_cover_pixels','audio_load_folder_thumbnail'].includes(command))return new Uint8Array(0);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:fullTrack(sourcePath).durationMs,error:null}));
 if(command==='audio_probe_playlist_track_summaries')return input.paths.map(sourcePath=>{const row=fullTrack(sourcePath);return {sourcePath,summary:{title:row.metadata.title,artist:row.metadata.artist,album:row.metadata.album,albumArtist:null,composer:null,genre:null,year:null,bitDepth:null,sampleRateHz:null,bitrateKbps:null,codec:null},error:null}});
 if(['audio_transition_playback','audio_play','audio_pause'].includes(command)){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_stop'){state={...state,phase:'stopped',positionMs:0};return {...state}}
 if(command==='audio_seek')throw Error('network seek must never be requested');
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__streams_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
// Keep independent acceptance stable while other agents edit unrelated files;
// every explicit navigation still fetches the current production modules.
await page.routeWebSocket('ws://127.0.0.1:5173/**', socket=>socket.close())
page.setDefaultTimeout(15000)
page.setDefaultNavigationTimeout(30000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__streams_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__streams_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__streams_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => {
  localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
  if(!localStorage.getItem('streams.acceptance.seeded')){
    localStorage.setItem('streams.acceptance.seeded','1')
    localStorage.removeItem('spmusic.player.session.v1')
    localStorage.setItem('spmusic.most-played.v1',JSON.stringify({version:1,entries:[{sourcePath:'https://example.test/Gamma',playCount:5,lastPlayedAt:200},{sourcePath:'https://example.test/radio?Token=lower',playCount:2,lastPlayedAt:300}]}))
    localStorage.setItem('spmusic.recently-played.v1',JSON.stringify({version:1,entries:[{sourcePath:'https://example.test/Radio?Token=UPPER',lastPlayedAt:1000},{sourcePath:'https://example.test/Gamma',lastPlayedAt:500}]}))
  }
})
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if(evidence)mkdirSync(evidence,{recursive:true})
const screenshot = async name => { if(evidence)await page.screenshot({path:evidence+'/'+name+'.png'}) }
const active = () => page.locator('.playlist-management-content:not([inert])')
const songs = () => active().locator('.all-songs-list [data-song-key]')
const titles = () => page.evaluate(()=>window.vm.playlist.library.streamSongs.map(row=>row.track.title))
const selectCategory = async category => {
  await page.evaluate(category=>window.vm.playlist.library.onSelectCategory(category),category)
  await page.waitForFunction(category=>window.vm.playlist.library.route.categoryId===category,category)
}
const ready = () => page.waitForFunction(()=>!window.vm.playback.isSelectionPending)
const returnToLibrary = async()=>{
  await page.evaluate(()=>window.vm.playlist.onOpenChange(false))
  await page.waitForFunction(()=>!window.vm.playlist.isOpen)
  await page.evaluate(()=>window.vm.playlist.onOpenChange(true))
  await page.waitForFunction(()=>window.vm.playlist.isOpen)
}
const menu = async label => { await page.getByRole('button',{name:'更多列表操作',exact:true}).click();await page.getByRole('button',{name:label,exact:true}).click() }
const sort = async label => {
  await menu('列表选项')
  await page.getByRole('dialog',{name:'流 · 列表选项'}).getByRole('combobox').click()
  await page.getByRole('option',{name:label,exact:true}).click()
  await page.getByRole('button',{name:'完成',exact:true}).click()
  await page.getByRole('dialog').waitFor({state:'hidden'})
}
const add = async (url) => {
  await menu('添加地址')
  await page.getByLabel('地址',{exact:true}).fill(url)
  await page.getByRole('button',{name:'添加',exact:true}).click()
}

try {
  await page.goto(origin+'/__streams_test?case=main')
  await page.waitForFunction(()=>window.vm?.playlist.library.streamSongs?.length===3&&!window.vm.playlist.library.streamsLoading)
  await selectCategory('streams')
  await songs().first().waitFor()
  assert.equal(await songs().count(),3)
  assert.deepEqual(await titles(),['Alpha Radio','Beta Radio','Gamma Radio'])
  assert(await page.getByRole('button',{name:'播放流',exact:true}).isEnabled())
  assert(await page.getByRole('button',{name:'随机播放流',exact:true}).isEnabled())
  assert.equal(await page.evaluate(()=>window.vm.playlist.library.allSongs.length),1,'streams excluded from local library')
  const sharedStructure=await songs().first().evaluate(node=>({tag:node.tagName,card:node.classList.contains('playlist-card'),cover:Boolean(node.querySelector('.playlist-card-cover')),title:Boolean(node.querySelector('.playlist-card-title'))}))
  await screenshot('streams-root')
  await page.setViewportSize({width:640,height:1024})
  await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})
  const visualEvidence=await active().evaluate(root=>{
    const box=node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,y:r.y}}
    const glyph=root.querySelector('.playlist-management-category .media-library-category-glyph')
    const list=root.querySelector('.all-songs-list')
    return {viewport:{width:innerWidth,height:innerHeight},category:box(root.querySelector('.playlist-management-category')),titleSize:getComputedStyle(root.querySelector('.playlist-management-heading h2')).fontSize,glyph:{...box(glyph),maskPresent:getComputedStyle(glyph).maskImage!=='none'},layout:{level:list.dataset.layoutLevel,columns:list.dataset.layoutColumns},cover:box(list.querySelector('.playlist-card-cover')),assets:[...root.querySelectorAll('.playlist-management-parent img,.playlist-management-toolbar img')].map((img,index)=>({slot:['parent','shuffle','play','search','more'][index],bundledLocal:img.src.startsWith('data:')||new URL(img.src).origin===location.origin,loaded:img.complete&&img.naturalWidth>0,...box(img)}))}
  })
  assert.equal(visualEvidence.layout.columns,'2','fresh stream view uses the two-column shared layout')
  assert.equal(visualEvidence.glyph.width,48)
  assert.equal(visualEvidence.glyph.height,48)
  assert(visualEvidence.assets.every(asset=>asset.loaded&&asset.width>0&&asset.height>0))
  visualEvidence.localAssets=[
    ['../../../assets/media-library/streams-root.svg',48],['../../../assets/playlist-library/2d425.svg',48],
    ['../../../assets/playlist-library/ce103.svg',32],['../../../assets/playlist-library/a31d0.svg',32],
    ['../../../assets/playlist-library/514fd.svg',32],['../../../assets/year-library/1e93b.svg',48],
  ].map(([relative,expected])=>{
    const file=new URL(relative,import.meta.url)
    const bytes=statSync(file).size
    const root=readFileSync(file,'utf8').match(/<svg\b[^>]*>/)?.[0]||''
    const width=Number(root.match(/\bwidth=['"]([0-9.]+)['"]/)?.[1])
    const height=Number(root.match(/\bheight=['"]([0-9.]+)['"]/)?.[1])
    assert(bytes>0&&width===expected&&height===expected,'local static SVG exists with its design root dimensions: '+relative)
    return {path:file.pathname,bytes,width,height}
  })
  await screenshot('streams-root-640')
  if(evidence)writeFileSync(evidence+'/streams-visual-evidence.json',JSON.stringify(visualEvidence,null,2))
  await page.setViewportSize({width:1280,height:900})
  await selectCategory('songs');await songs().first().waitFor()
  assert.deepEqual(await songs().first().evaluate(node=>({tag:node.tagName,card:node.classList.contains('playlist-card'),cover:Boolean(node.querySelector('.playlist-card-cover')),title:Boolean(node.querySelector('.playlist-card-title'))})),sharedStructure,'same PlaylistCard structure as local songs, with independently saved layout variants')
  await songs().first().click();await ready()
  assert.equal(await page.evaluate(()=>window.calls.filter(row=>row.command==='audio_load_and_play').at(-1).input.path),'/music/local.wav','local all-songs playback keeps the local transport path')
  assert.deepEqual(await page.evaluate(()=>window.vm.queue.tracks.map(row=>row.id)),['local'])
  await returnToLibrary()
  await page.waitForFunction(()=>window.vm.playlist.library.route.categoryId==='songs')
  await selectCategory('streams')
  await page.getByRole('button',{name:'搜索流',exact:true}).click()
  await page.getByRole('searchbox',{name:'搜索流名称或地址'}).fill('Token=UPPER')
  await page.waitForFunction(()=>document.querySelectorAll('.playlist-management-content:not([inert]) .all-songs-list [data-song-key]').length===1)
  assert((await songs().first().innerText()).includes('Alpha Radio'))
  await page.getByRole('searchbox',{name:'搜索流名称或地址'}).press('Escape')
  await sort('播放次数');assert.equal((await titles())[0],'Gamma Radio')
  await sort('最近播放');assert.equal((await titles())[0],'Alpha Radio','recent order uses recent record rather than play-count record')
  await sort('添加时间');assert.equal((await titles())[0],'Beta Radio')
  await sort('随机');const shuffled=await titles();await page.evaluate(()=>window.vm.playlist.library.onRefreshStreams());await page.waitForFunction(()=>!window.vm.playlist.library.streamsLoading)
  assert.deepEqual(await titles(),shuffled,'ordinary refresh preserves shuffled sequence')
  await sort('评分');assert.equal((await titles()).length,3)
  await sort('名称')
  await add('ftp://example.test/radio')
  assert.equal(await page.getByRole('dialog',{name:'添加地址',exact:true}).count(),1)
  assert.equal(await page.evaluate(()=>window.calls.filter(row=>row.command==='library_add_stream').length),0,'invalid scheme rejected before native command')
  await page.getByRole('button',{name:'取消',exact:true}).click();await page.keyboard.press('Escape')
  await add('https://example.test/Radio?Token=UPPER')
  await page.getByRole('dialog').waitFor({state:'hidden'})
  assert.equal((await titles()).length,3,'duplicate URL upserts rather than duplicates')
  await page.evaluate(()=>{window.failAdd=true})
  await add('https://example.test/Added?Token=ABC')
  await page.getByText('添加失败，请检查地址并重试。',{exact:true}).waitFor()
  assert.equal((await titles()).length,3,'failed save does not erase existing stream rows')
  await page.evaluate(()=>{window.failAdd=false})
  await page.getByRole('button',{name:'添加',exact:true}).click()
  await page.getByRole('dialog').waitFor({state:'hidden'})
  assert.equal((await titles()).length,4)
  await menu('导入播放列表')
  await page.waitForFunction(()=>window.vm.playlist.library.streamSongs.length===5&&!window.vm.playlist.library.isImportPending)
  assert.deepEqual(await page.evaluate(()=>window.vm.playlist.library.allSongs.map(row=>row.sourcePath)),['/music/local.wav'],'mixed playlist keeps the existing local song deduplicated and excludes streams')
  assert.equal(await page.evaluate(()=>window.vm.playlist.library.items.some(item=>item.sourceKind==='streams')),false)
  await screenshot('streams-after-add-import')
  await songs().filter({hasText:'https://example.test/Added?Token=ABC'}).first().click();await ready()
  assert.equal(await page.evaluate(()=>window.vm.queue.tracks.length),5)
  assert.equal(await page.evaluate(()=>window.calls.filter(row=>row.command==='audio_load_and_play').at(-1).input.path),'https://example.test/Added?Token=ABC')
  assert.equal(await page.evaluate(()=>window.vm.timeline.durationSeconds),0)
  assert.equal(await page.evaluate(()=>window.calls.filter(row=>row.command==='audio_seek').length),0)
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.vm?.playlist.library.streamSongs?.length===5&&!window.vm.playlist.library.streamsLoading,undefined,{timeout:30000})
  await selectCategory('streams')
  assert.equal(await songs().count(),5,'persisted registry restored')
  assert.equal(await page.evaluate(()=>window.vm.playlist.library.items.filter(item=>item.sourceKind==='m3u8').length),1,'mixed imported playlist remains registered after reload')
  assert.deepEqual(await page.evaluate(()=>window.vm.playlist.library.allSongs.map(row=>row.sourcePath)),['/music/local.wav'],'restored mixed source stays isolated from local all-songs')
  assert.equal(await page.evaluate(()=>window.calls.filter(row=>row.command==='audio_seek').length),0,'stream restore never seeks')
  await page.evaluate(()=>{window.failRead=true;window.vm.playlist.library.onRefreshStreams()})
  await page.getByText('无法读取流列表',{exact:true}).waitFor()
  await page.evaluate(()=>{window.failRead=false})
  await page.getByRole('button',{name:'重试',exact:true}).click()
  await songs().first().waitFor()
  await page.getByRole('button',{name:'选择',exact:true}).click()
  await songs().first().click()
  await page.getByRole('button',{name:'删除',exact:true}).click()
  const deleteDialog=page.getByRole('dialog',{name:'确定删除多个条目？'})
  await deleteDialog.waitFor()
  assert(await deleteDialog.getByRole('button',{name:'删除文件',exact:true}).isDisabled(),'stream cannot delete physical files')
  await deleteDialog.getByRole('button',{name:'删除',exact:true}).click()
  await deleteDialog.waitFor({state:'hidden'})
  assert.equal((await titles()).length,4)
  assert.equal(await page.evaluate(()=>window.calls.filter(row=>/delete.*file|trash/i.test(row.command)).length),0)
  const remoteProbes=await page.evaluate(()=>window.calls.filter(row=>['audio_probe_playlist_durations','audio_probe_playlist_track_summaries','library_warm_cover_thumbnails'].includes(row.command)).flatMap(row=>row.input?.paths||[]).filter(path=>/^https?:/i.test(path)))
  assert.deepEqual(remoteProbes,[],'lists do not probe network metadata, duration or artwork')
  assert.deepEqual(errors,[])
  console.log('streams acceptance passed: shared cards, local isolation, six sorts, URL search/add/upsert/import, queue/restore, registry error/retry, safe deletion and no network list probes')
} catch(error) {
  await screenshot('streams-failure')
  console.error(await page.evaluate(()=>({route:window.vm?.playlist.library.route,text:document.querySelector('.playlist-management-content:not([inert])')?.innerText,dialogs:[...document.querySelectorAll('[role=dialog]')].map(node=>node.innerText),calls:window.calls?.slice(-12)})).catch(()=>({diagnostic:'navigation interrupted diagnostics'})),errors)
  throw error
} finally {await browser.close()}
