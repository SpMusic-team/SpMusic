// Independent acceptance: real PlayerShell and PlayerSurface, only native transport replaced.
// Vite must be running at SPMUSIC_TEST_ORIGIN (default http://127.0.0.1:5173).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

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
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__most_played_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;return React.createElement(RealSurface,props)}`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.summaryGate=new URLSearchParams(location.search).has('summaryGate');window.pendingSummaries=[];window.scanGate=false;window.pendingScans=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const roots=['/music','/hidden'];
window.pulse=(positionMs,phase=state.phase)=>{state={...state,positionMs,phase};window.listeners?.audio_state_changed?.({payload:{...state}})};
window.nativeState=()=>({...state});
const rows=[
 ['a','Shared','Singer A','Album Group','Writer One'],
 ['b','Shared','Singer B','Album Group','Writer Two'],
 ['duet','Shared','Singer A/Singer B','Album Group/Guest/Album Group','Writer One/Writer Two/Writer One'],
 ['missing','Missing','Performer Only',null,null],
 ['literal','Literal','Literal Performer','未知专辑艺术家','未知作曲家'],
 ['other','Other','Singer X','Another Album Credit','Writer Three'],
 ['collab','Other','Singer C','Album Group','Writer One'],
 ['band','Rock','Band Singer','AC/DC','AC/DC'],
 ['hidden','Hidden','Hidden Singer','Hidden Album Credit','Hidden Writer']
];
const descriptors=rows.map(([id])=>({id,sourcePath:(id==='hidden'?'/hidden/':'/music/')+id+'.flac',fileName:id+'.flac',available:true}));
const track=path=>{const descriptor=descriptors.find(row=>row.sourcePath===path);if(!descriptor)throw Error('Unknown path '+path);const row=rows.find(row=>row[0]===descriptor.id);return {...descriptor,durationMs:4000,metadata:{title:'Song '+row[0]+(row[0]==='a'?' long title repeated for clipping '.repeat(12):''),artist:row[2]+(row[0]==='a'?' long artist repeated for clipping '.repeat(12):''),album:row[1],albumArtist:row[3],composer:row[4],genre:null,year:2023,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_playlists')return [];
 if(command==='library_get_folders')return {revision:0,roots:roots.map(path=>({path,selected:path!=='/hidden',directoryRules:[]}))};
 if(command==='library_clear_folders'){roots.length=0;return null}
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='library_scan_folder'){if(window.scanGate)await new Promise(resolve=>window.pendingScans.push(resolve));const path=args.path;return {directoryPath:path,directoryName:path.split('/').at(-1),sourceKind:'folder',sourcePath:path,sourceName:path.split('/').at(-1),selectedIndex:0,directoryPaths:[path],tracks:descriptors.filter(row=>row.sourcePath.startsWith(path+'/'))}}
 if(command==='library_warm_cover_thumbnails')return {requested:input.paths.length,processed:input.paths.length,written:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:4000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:null}}
 if(['audio_load_track_thumbnail','audio_load_playlist_cover_pixels','audio_load_folder_thumbnail'].includes(command))return new Uint8Array(0);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:4000,error:null}));
 if(command==='audio_probe_playlist_track_summaries'){
  if(window.summaryGate)await new Promise(resolve=>window.pendingSummaries.push(resolve));
  return input.paths.map(sourcePath=>{const item=track(sourcePath);return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:item.metadata.albumArtist,composer:item.metadata.composer,year:2023,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(['audio_transition_playback','audio_play','audio_pause'].includes(command)){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__most_played_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: process.env.SPMUSIC_TEST_MOTION ? 'no-preference' : 'reduce', hasTouch: true })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__most_played_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__most_played_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__most_played_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => { localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'); localStorage.removeItem('spmusic.player.session.v1') })
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if (evidence) mkdirSync(evidence, { recursive: true })
const screenshot = async name => { if (evidence) await page.screenshot({ path: evidence + '/' + name + '.png' }) }

const selectCategory = async category => {
  await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
  await page.waitForFunction(category => window.vm.playlist.library.route.categoryId === category, category)
}
const active = () => page.locator('.playlist-management-content:not([inert])')
const songs = () => active().locator('.all-songs-list [data-song-key]')
const songIds = () => songs().evaluateAll(nodes => nodes.map(node => node.dataset.songKey.split('/').at(-1).replace('.flac', '')))
const queueIds = () => page.evaluate(() => window.vm.queue.tracks.map(track => track.id))
const ready = () => page.waitForFunction(() => !window.vm.playback.isSelectionPending)
const backFromPlayer = async () => { await page.evaluate(() => window.vm.playlist.onOpenChange(false)); await page.waitForFunction(() => !window.vm.playlist.isOpen); await page.evaluate(() => window.vm.playlist.onOpenChange(true)); await page.waitForFunction(() => window.vm.playlist.isOpen) }
const pulseFor = async (start, count, phase='playing') => page.evaluate(async ({start,count,phase})=>{
  window.pulse(start,phase)
  for(let i=1;i<=count;i++){await new Promise(resolve=>setTimeout(resolve,110));window.pulse(start+i*100,phase)}
}, {start,count,phase})
const play = async id => { await songs().filter({hasText:'Song '+id}).first().click(); await ready() }
const persisted = () => page.evaluate(()=>JSON.parse(localStorage.getItem('spmusic.recently-played.v1')||'{"entries":[]}').entries)
const mostPersisted = () => page.evaluate(()=>JSON.parse(localStorage.getItem('spmusic.most-played.v1')||'{"entries":[]}').entries)
try {
  await page.goto(origin + '/__most_played_test?normal=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 8 && !window.vm.playlist.library.isImportPending)
  await selectCategory('most-played')
  await page.getByText('暂无最常播放', {exact:true}).waitFor()
  assert.equal(await page.locator('.playlist-management:not([inert]) .playlist-management-quick-index').count(),0)
  assert(await page.getByRole('button',{name:'播放最常播放',exact:true}).isDisabled())
  await screenshot('most-played-empty')
  await selectCategory('songs'); await songs().first().waitFor()
  const geometry=await songs().first().evaluate(node=>({coverRadius:getComputedStyle(node.querySelector('.playlist-card-cover')).borderRadius}))
  await play('a'); await pulseFor(0,15)
  assert.equal((await mostPersisted()).length,0,'less than 50% does not count')
  await pulseFor(1500,8)
  assert.equal((await mostPersisted())[0].playCount,1)
  await pulseFor(2300,5)
  assert.equal((await mostPersisted())[0].playCount,1,'one round counts once')
  await backFromPlayer(); await selectCategory('songs'); await play('missing')
  await page.evaluate(()=>window.vm.timeline.onCommit(3)); await page.waitForFunction(()=>window.vm.timeline.interaction==='following')
  await pulseFor(3000,5)
  assert.equal((await mostPersisted()).length,1,'seek jump cannot count')
  await backFromPlayer(); await selectCategory('songs'); await play('b'); await pulseFor(0,23)
  await backFromPlayer(); await selectCategory('songs'); await play('a'); await pulseFor(0,23)
  const stats=await mostPersisted()
  assert.equal(stats.find(x=>x.sourcePath==='/music/a.flac').playCount,2,'second round adds one')
  assert.equal(stats.find(x=>x.sourcePath==='/music/b.flac').playCount,1)
  await backFromPlayer(); await selectCategory('most-played'); await songs().first().waitFor()
  assert.deepEqual(await songIds(),['a','b'])
  assert.deepEqual(await songs().first().evaluate(node=>({coverRadius:getComputedStyle(node.querySelector('.playlist-card-cover')).borderRadius})),geometry)
  assert.equal(await page.locator('.playlist-management:not([inert]) .playlist-management-quick-index').count(),0)
  assert.equal(await page.locator('.playlist-playback-dock:not([data-dock-superseded])').count(),1)
  assert.equal(await songs().first().locator('.playlist-card-format .playlist-card-play-count').innerText(),'2')
  await screenshot('most-played-list')
  const listColor = await songs().first().locator('.playlist-card-format .playlist-card-play-count').evaluate(node=>{
    const probe=document.createElement('span');probe.style.color='var(--player-inverse-primary)';node.append(probe)
    const result={actual:getComputedStyle(node).color,expected:getComputedStyle(probe).color};probe.remove();return result
  })
  assert.equal(listColor.actual,listColor.expected,'list counter uses computed inverse-primary token')
  const changeLayout=async target=>{
    await page.keyboard.down('Control')
    try {
      for(let attempt=0;attempt<12;attempt++){
        const level=Number(await active().locator('.all-songs-list').getAttribute('data-layout-level'))
        if(level===target)return
        await active().locator('.all-songs-list').dispatchEvent('wheel',{ctrlKey:true,deltaY:target<level?-60:60})
        await page.waitForTimeout(180)
      }
      assert.fail('layout did not reach '+target)
    } finally {await page.keyboard.up('Control')}
  }
  for(const level of [0,1,2]){
    await changeLayout(level)
    const card=songs().first()
    assert.equal(await card.locator('.playlist-card-cover-play-count').count(),1,'one tile cover counter')
    assert.equal(await card.locator('.playlist-card-format .playlist-card-play-count:visible').count(),0,'no bottom duplicate tile counter')
    assert.equal(await card.locator('.playlist-card-cover-play-count').innerText(),'2')
    await active().getByRole('button',{name:'选择',exact:true}).click()
    const placement=await card.evaluate(node=>{
      const cover=node.querySelector('.playlist-card-cover').getBoundingClientRect(),badge=node.querySelector('.playlist-card-cover-play-count').getBoundingClientRect(),box=node.querySelector('.playlist-card-checkbox').getBoundingClientRect()
      return {cover:cover.toJSON(),badge:badge.toJSON(),box:box.toJSON(),badgeVisible:getComputedStyle(node.querySelector('.playlist-card-cover-play-count')).display}
    })
    assert.notEqual(placement.badgeVisible,'none')
    assert(placement.badge.width>=29,'tile counter min-width remains at least 29px')
    assert(placement.badge.left>=placement.cover.left+placement.cover.width/2,'tile counter belongs at top right')
    assert(placement.badge.top>=placement.cover.top&&placement.badge.bottom<=placement.cover.bottom,'tile counter within cover')
    assert(Math.abs(placement.badge.top-placement.box.top)<1,'tile count and selection checkbox align at top')
    assert(Math.abs((placement.cover.right-placement.badge.right)-(placement.box.left-placement.cover.left))<1,'left selection and right count are symmetric')
    assert(placement.box.right<=placement.badge.left,'tile count never overlaps selection checkbox')
    await screenshot('most-played-tile-'+level+'-selection')
    await page.getByRole('button',{name:'退出选择',exact:true}).click()
  }
  for(const level of [5,6]){
    await changeLayout(level)
    for(const selecting of [false,true]){
      if(selecting) await active().getByRole('button',{name:'选择',exact:true}).click()
      const placement=await songs().first().evaluate(node=>{
        const rect=selector=>node.querySelector(selector)?.getBoundingClientRect().toJSON()
        const title=node.querySelector('.playlist-card-title'),artist=node.querySelector('.playlist-card-artist'),count=node.querySelector('.playlist-card-compact-play-count'),format=node.querySelector('.playlist-card-format')
        return {title:rect('.playlist-card-title'),artist:rect('.playlist-card-artist'),count:rect('.playlist-card-compact-play-count'),format:rect('.playlist-card-format'),checkbox:rect('.playlist-card-selection-actions .playlist-card-checkbox'),card:node.getBoundingClientRect().toJSON(),titleClip:title.scrollWidth>title.clientWidth,artistClip:artist.scrollWidth>artist.clientWidth,titleOverflow:getComputedStyle(title).textOverflow,artistOverflow:getComputedStyle(artist).textOverflow,countDisplay:getComputedStyle(count).display,formatDisplay:getComputedStyle(format).display}
      })
      assert.notEqual(placement.countDisplay,'none','compact row has visible standalone count')
      assert.notEqual(placement.formatDisplay,'none','compact row has visible format')
      assert(placement.count.bottom<=placement.format.top+1,'count sits on top and format underneath')
      assert(Math.abs(placement.count.right-placement.format.right)<1,'right column is right aligned')
      assert(Math.abs((placement.count.top+placement.count.height/2)-(placement.title.top+placement.title.height/2))<2,'count aligns to title line')
      assert(Math.abs((placement.format.top+placement.format.height/2)-(placement.artist.top+placement.artist.height/2))<2,'duration aligns to artist line')
      assert(placement.title.right<=placement.count.left&&placement.artist.right<=placement.format.left,'long left text reserves right column')
      assert(placement.titleClip&&placement.artistClip,'fixture exercises clipping in both left lines')
      assert.equal(placement.titleOverflow,'ellipsis');assert.equal(placement.artistOverflow,'ellipsis')
      assert.equal(await songs().first().locator('.playlist-card-format .playlist-card-play-count:visible').count(),0,'compact format has no duplicate count')
      if(selecting&&level===6) assert(placement.count.right<=placement.checkbox.left&&placement.format.right<=placement.checkbox.left,'text right column avoids selection checkbox')
      assert(placement.format.right<=placement.card.right,'right column stays within card')
      await screenshot('most-played-compact-'+level+(selecting?'-selection':'')+'-long-text')
      if(selecting) await page.getByRole('button',{name:'退出选择',exact:true}).click()
    }
  }
  await changeLayout(4)
  await play('b'); assert.deepEqual(await queueIds(),['a','b'])
  const queueBefore=await queueIds(); await pulseFor(0,23)
  assert.deepEqual(await queueIds(),queueBefore,'new count cannot replace playback snapshot')
  await backFromPlayer(); await selectCategory('most-played')
  await page.reload(); await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===8&&!window.vm.playlist.library.isImportPending)
  await selectCategory('most-played'); await songs().first().waitFor()
  assert.equal((await mostPersisted()).find(x=>x.sourcePath==='/music/a.flac').playCount,2,'reload keeps counters')
  await page.getByRole('button',{name:'随机播放最常播放',exact:true}).click(); await ready()
  assert.deepEqual((await queueIds()).sort(),['a','b'])
  await backFromPlayer(); await selectCategory('most-played')
  await page.getByRole('button',{name:'更多列表操作',exact:true}).click()
  await page.getByRole('button',{name:'列表选项',exact:true}).click()
  await page.getByRole('dialog',{name:'最常播放 · 列表选项'}).waitFor()
  await page.getByLabel('最多歌曲数',{exact:true}).fill('2')
  await page.getByRole('button',{name:'降序（最多在前）',exact:true}).click()
  await page.getByRole('button',{name:'保存',exact:true}).click()
  await page.waitForFunction(()=>window.vm.playlist.library.mostPlayedOptions.direction==='asc')
  assert.equal(await page.evaluate(()=>window.vm.playlist.library.mostPlayedOptions.limit),2)
  await page.getByRole('dialog').waitFor({state:'hidden'})
  const snapshot=await queueIds(), recentsBefore=await persisted()
  await page.getByRole('button',{name:'更多列表操作',exact:true}).click()
  await page.getByRole('button',{name:'清空',exact:true}).click()
  await page.getByRole('dialog',{name:'清空最常播放？'}).waitFor()
  await page.getByRole('button',{name:'清空',exact:true}).click()
  await page.waitForFunction(()=>window.vm.playlist.library.mostPlayedSongs.length===0)
  assert.deepEqual(await queueIds(),snapshot,'clearing stats preserves active playback snapshot')
  assert.deepEqual(await persisted(),recentsBefore,'clearing stats preserves recent history')
  await pulseFor(0,23)
  await pulseFor(2300,5)
  assert.equal((await mostPersisted()).length,1,'uncounted current round may qualify once after clear')
  await page.reload(); await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===8&&!window.vm.playlist.library.isImportPending)
  assert.equal(await page.evaluate(()=>window.vm.playlist.library.mostPlayedOptions.direction),'asc','direction persists')
  assert.equal(await page.evaluate(()=>window.vm.playlist.library.mostPlayedOptions.limit),2,'limit persists')
  assert.deepEqual(errors,[])
  console.log('most played independent browser: empty/full page, shared card/controller, no index, 50% listening, seek exclusion, once-per-round counter, repeat increments, stable scoped queue, shuffle and reload passed')
} catch(error) {
  await screenshot('most-played-failure')
  console.error(await page.evaluate(()=>({route:window.vm?.playlist.library.route,text:document.querySelector('.playlist-management-content:not([inert])')?.innerText,keys:Object.keys(window.vm?.playlist.library??{}),state:window.nativeState?.()})),errors)
  throw error
} finally {await browser.close()}