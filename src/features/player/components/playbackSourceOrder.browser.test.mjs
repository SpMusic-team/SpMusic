// Vite + an existing Playwright installation; native transport is deterministic.
// Real UI, PlayerShell, useAudioPlayer, command parser and ended polling choose
// each actual native load path. Visible queue order alone is never the oracle.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__source_order_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(Surface,props)}`
const fixture = `
import React from '${dependency('react.js')}';import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';import '/src/index.css';
window.calls=[];window.pendingSummaries=[];let generation=0,current=null,state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null};
const fileIndex=(group,i)=>new URLSearchParams(location.search).has('reverseFiles')&&group!=='c'?29-i:i;
const descriptor=(group,i)=>({id:group+'-'+i,sourcePath:'/audio/'+group+'/'+String(fileIndex(group,i)).padStart(2,'0')+'.flac',fileName:String(fileIndex(group,i)).padStart(2,'0')+'.flac',available:true});
const lists=Object.fromEntries(['a','b','c'].map(group=>[group,{directoryPath:'/audio/'+group,directoryName:'List '+group,sourceKind:group==='c'?'m3u8':'folder',sourcePath:group==='c'?'/lists/c.m3u8':'/audio/'+group,sourceName:'List '+group,selectedIndex:0,tracks:Array.from({length:group==='c'?4:30},(_,i)=>descriptor(group,(group==='c'?3:29)-i))}]));
const byPath=new Map(Object.values(lists).flatMap(list=>list.tracks).map(track=>[track.sourcePath,track]));
const title=d=>d.id.startsWith('c-')?'Playlist '+d.id.slice(2):'Track '+String(Number(d.id.slice(2))*2+(d.id.startsWith('b-')?1:0)).padStart(3,'0');
const track=path=>{const d=byPath.get(path);if(!d)throw Error('Unknown path '+path);return {...d,durationMs:180000,metadata:{title:title(d),artist:'Artist',album:d.id[0],albumArtist:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.finish=()=>{state={...state,phase:'ended',positionMs:180000};window.endedAt=performance.now()};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args,time:performance.now()});
 if(command==='library_get_playlists')return [lists.c];
 if(command==='library_get_folders')return {folders:['/audio/a','/audio/b']};
 if(command==='library_scan_folder')return lists[args.path.split('/').at(-1)];
 if(command==='library_warm_cover_thumbnails')return {attempted:input.paths.length,computed:0,persisted:0,warmed:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return current;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  if(window.failGroup && input.path.startsWith('/audio/'+window.failGroup+'/'))throw {code:'AUDIO_LOAD_FAILED',message:'Controlled load failure',recoverable:true};
  current=track(input.path);state={...state,phase:command==='audio_load_file'?'ready':'playing',generation:++generation,currentTrackId:current.id,durationMs:180000,positionMs:0};
  if(command==='audio_load_file')return current;
  const result={requestId:input.requestId,generation,trackId:current.id,fileName:current.fileName,state:{...state}},details=current;
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation:result.generation,track:details}}),0);return result;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_probe_playlist_track_summaries'){if(window.summaryGate)await new Promise(resolve=>window.pendingSummaries.push(resolve));return input.paths.map(sourcePath=>{const t=track(sourcePath);return {sourcePath,summary:{title:t.metadata.title,artist:t.metadata.artist,album:t.metadata.album,albumArtist:null,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}})}
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_cover'){const d=byPath.get(input.path);return {id:d.id,sourcePath:d.sourcePath,coverArt:null}}
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 if(command==='audio_list_folder_tracks')return lists[input.selectedPath.split('/')[2]];
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__source_order_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
let passed = 0
const failures = []
async function check(name, run, repeat = 'list-loop', shuffle = 'none', reverseFiles = false) {
  if (process.env.SPMUSIC_TEST_FILTER && !name.includes(process.env.SPMUSIC_TEST_FILTER)) return
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(({ repeat, shuffle }) => {
    localStorage.setItem('spmusic.player.repeat-mode.v1', repeat)
    localStorage.setItem('spmusic.player.shuffle-mode.v1', shuffle)
    localStorage.setItem('spmusic.all-songs.layout-level.v1', '7')
    localStorage.setItem('spmusic.playlist.layout-level.v1', '7')
  }, { repeat, shuffle })
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__source_order_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__source_order_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__source_order_test*', route => route.fulfill({ contentType: 'text/html', body: html }))
  try {
    await page.goto(origin + '/__source_order_test' + (reverseFiles ? '?reverseFiles=1' : ''))
    await page.waitForFunction(() => window.vm?.playlist.library.items.length === 3)
    await run(page)
    assert.deepEqual(errors, [])
    console.log('PASS', name)
    passed++
  } catch (error) {
    console.log('FAIL', name, error.message, 'LOADS', JSON.stringify(await loads(page)))
    failures.push(name + ': ' + error.message)
  } finally { await page.close() }
}
const loads = page => page.evaluate(() => window.calls.filter(call => ['audio_load_and_play', 'audio_load_file'].includes(call.command)).map(call => call.input.path))
const settled = page => page.waitForFunction(() => window.vm?.playback.isPlaying && !window.vm.playback.isAudioBusy && !window.vm.playback.isSelectionPending && !window.vm.playback.detailsPending)
async function songs(page) {
  await page.evaluate(() => window.vm.playlist.library.onSelectCategory('songs'))
  await page.locator('.all-songs-list .playlist-card').first().waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.all-songs-list .playlist-card').length === 60)
}
async function playlist(page) {
  await page.evaluate(() => { const item=window.vm.playlist.library.items.find(item=>item.sourceKind==='m3u8');window.vm.playlist.library.onSelect(item.scope) })
  await page.locator('.playlist-grid:not(.all-songs-list) .playlist-card').first().waitFor()
}
async function activate(page, index, all = true) {
  const before = (await loads(page)).length
  await page.locator(all ? '.all-songs-list .playlist-card' : '.playlist-grid:not(.all-songs-list) .playlist-card').nth(index).click()
  await page.waitForFunction(before => window.calls.filter(call => ['audio_load_and_play', 'audio_load_file'].includes(call.command)).length > before, before)
  await settled(page)
}
async function next(page, automatic = false) {
  const before = (await loads(page)).length
  await page.evaluate(automatic => automatic ? window.finish() : window.vm.playback.onNext(), automatic)
  await page.waitForFunction(before => window.calls.filter(call => ['audio_load_and_play', 'audio_load_file'].includes(call.command)).length > before, before)
  await settled(page)
}
const path = (group, index) => '/audio/' + group + '/' + String(index).padStart(2, '0') + '.flac'
try {
  await check('all songs ascending UI chooses actual native next across folders and automatic ended', async page => {
    await songs(page)
    const titles = await page.locator('.all-songs-list .playlist-card-title').allTextContents()
    assert.equal(titles[0], 'Track 000')
    await activate(page, 0);await next(page);await next(page, true)
    assert.deepEqual(await loads(page), [path('a', 0), path('b', 0), path('a', 1)])
  })
  await check('all songs outside artwork window retains full source and wraps', async page => {
    await songs(page);await activate(page, 39);await next(page)
    assert.deepEqual(await loads(page), [path('b', 19), path('a', 20)])
    await activate(page, 59);await next(page, true)
    assert.deepEqual((await loads(page)).slice(-2), [path('b', 29), path('a', 0)])
  })
  await check('descending playlist native order survives switching from and back to all songs', async page => {
    await songs(page);await activate(page, 0)
    await playlist(page);await activate(page, 1, false);await next(page, true)
    assert.deepEqual((await loads(page)).slice(-2), [path('c', 2), path('c', 1)])
    await songs(page);await activate(page, 2);await next(page)
    assert.deepEqual((await loads(page)).slice(-2), [path('a', 1), path('b', 1)])
  })
  await check('filtered all songs freezes complete clicked result despite later search changes', async page => {
    await songs(page)
    await page.getByRole('button', { name: '搜索所有歌曲', exact: true }).click()
    const search = page.getByRole('searchbox', { name: '搜索歌曲标题、艺术家或专辑' })
    await search.fill('Track 01')
    await page.waitForFunction(() => document.querySelectorAll('.all-songs-list .playlist-card').length === 10)
    await activate(page, 0)
    await search.fill('Track 02')
    await next(page);await next(page, true)
    assert.deepEqual(await loads(page), [path('a', 5), path('b', 5), path('a', 6)])
    await page.evaluate(() => window.vm.playback.onPrevious())
    await page.waitForFunction(expected => window.calls.filter(call=>call.command==='audio_load_and_play').at(-1)?.input.path===expected, path('b', 5))
    assert.equal((await loads(page)).at(-1), path('b', 5))
  })
  await check('failed different-source selection preserves previous source navigation', async page => {
    await songs(page);await activate(page, 2)
    await playlist(page)
    await page.evaluate(() => { window.failGroup='c' })
    const before = (await loads(page)).length
    await page.locator('.playlist-grid:not(.all-songs-list) .playlist-card').first().click()
    await page.waitForFunction(before => window.calls.filter(call=>['audio_load_and_play','audio_load_file'].includes(call.command)).length>before&&!window.vm.playback.isAudioBusy&&!window.vm.playback.isSelectionPending, before)
    await page.evaluate(() => { window.failGroup=null })
    await next(page)
    assert.equal((await loads(page)).at(-1), path('b', 1), 'failed playlist never replaces the committed all-songs order')
  })
  await check('restored queue preserves native source order without adding a visible playlist', async page => {
    await songs(page);await activate(page, 2)
    await page.waitForFunction(() => Boolean(localStorage.getItem('spmusic.player.session.v1')))
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('spmusic.player.session.v1')))
    assert.equal(saved.playlist.customPlaylist?.tracks.length, 60, 'saved source is complete, including offscreen tracks')
    await page.reload()
    await page.waitForFunction(() => window.vm?.playback.track?.id==='a-1'&&!window.vm.playback.isAudioBusy&&!window.vm.playback.isSelectionPending&&window.vm.playlist.library.items.length===3)
    assert.equal(await page.evaluate(() => window.vm.playlist.library.items.length), 3, 'restored queue stays outside actual library source list')
    await page.evaluate(() => window.vm.playback.onNext())
    await page.waitForFunction(expected => window.calls.filter(call=>['audio_load_and_play','audio_load_file'].includes(call.command)).at(-1)?.input.path===expected, path('b', 1))
    assert.equal((await loads(page)).at(-1), path('b', 1))
  })
  await check('custom playlist survives filtered snapshot restore with its complete source and working native reselect', async page => {
    await songs(page)
    await page.evaluate(() => {
      const ids=['a-0','a-5','a-10','a-15']
      const keys=ids.map(id=>window.vm.playlist.library.allSongs.find(song=>song.trackId===id).key)
      window.originalCustomScope=window.vm.playlist.library.onCreatePlaylist('Custom source',keys)
      window.vm.playlist.library.onSelect(window.originalCustomScope)
    })
    const cards = page.locator('.playlist-grid:not(.all-songs-list) .playlist-card')
    await cards.first().waitFor()
    assert.equal(await cards.count(), 4)
    await page.locator('.playlist-search-button:visible').first().click()
    await page.locator('.playlist-filter-input').fill('Track 01')
    await page.waitForFunction(() => document.querySelectorAll('.playlist-grid:not(.all-songs-list) .playlist-card').length===1)
    await activate(page, 0, false)
    assert.equal((await loads(page)).at(-1), path('a', 5))
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('spmusic.player.session.v1')??'null')?.playlist.customPlaylist?.playbackQueue?.kind==='playlist')
    await page.reload()
    await page.waitForFunction(() => window.vm?.playback.track?.id==='a-5'&&!window.vm.playback.isAudioBusy&&!window.vm.playback.isSelectionPending)
    await page.waitForFunction(() => window.vm.playlist.library.items.some(item=>item.name==='Custom source'))
    assert.equal(await page.evaluate(() => window.vm.playlist.library.items.filter(item=>item.name==='Custom source').length), 1)
    assert.deepEqual(await page.evaluate(() => window.vm.queue.tracks.map(track=>track.id)), ['a-5'], 'restored playback keeps its filtered snapshot while the real source remains complete')
    await page.evaluate(() => { const item=window.vm.playlist.library.items.find(item=>item.name==='Custom source');window.vm.playlist.library.onSelect(item.scope) })
    await cards.first().waitFor()
    assert.equal(await cards.count(), 4, 'restored source keeps all original songs, not the one-song playback filter')
    await activate(page, 2, false)
    assert.equal((await loads(page)).at(-1), path('a', 10), 'reselect resolves through the restored real source descriptor')
  })
  await check('pending snapshot summaries preserve displayed tag order and native next', async page => {
    await songs(page)
    const expected = await page.locator('.all-songs-list .playlist-card').evaluateAll(cards=>cards.map(card=>card.dataset.playlistTrackId))
    await page.evaluate(() => {
      window.summaryGate=true;window.orderFrames=[];window.captureOrder=true
      const sample=()=>{if(!window.captureOrder)return;window.orderFrames.push([...document.querySelectorAll('.all-songs-list .playlist-card')].map(card=>card.dataset.playlistTrackId));requestAnimationFrame(sample)}
      requestAnimationFrame(sample)
    })
    await activate(page, 0)
    await next(page)
    await page.evaluate(async()=>{for(let i=0;i<8;i++)await new Promise(requestAnimationFrame);window.captureOrder=false})
    const frames = await page.evaluate(()=>window.orderFrames)
    assert(frames.length>3)
    assert(frames.every(frame=>JSON.stringify(frame)===JSON.stringify(expected)), 'known source metadata must never be replaced with filename order while the snapshot summary lane waits')
    assert.deepEqual(await loads(page), [path('a', 29), path('b', 29)])
    await page.evaluate(()=>{window.summaryGate=false;window.pendingSummaries.splice(0).forEach(resolve=>resolve())})
  }, 'list-loop', 'none', true)
  await check('repeat one reloads same native path on ended and manual next still advances', async page => {
    await songs(page);await activate(page, 2);await next(page, true)
    assert.deepEqual((await loads(page)).slice(-2), [path('a', 1), path('a', 1)])
    await next(page)
    assert.equal((await loads(page)).at(-1), path('b', 1))
  }, 'repeat-one')
  for (const repeat of ['sequential', 'all-categories-until-stop']) await check(repeat + ' source end stops without loading another folder or wrapping', async page => {
    await songs(page);await activate(page, 59)
    await page.evaluate(() => window.finish())
    await page.waitForFunction(() => !window.vm.playback.isPlaying)
    const count = (await loads(page)).length
    // Observe two real 500 ms state polling opportunities after ended processing.
    await page.waitForTimeout(1100)
    assert.equal((await loads(page)).length, count)
    assert.deepEqual(await loads(page), [path('b', 29)])
  }, repeat)
  await check('shuffle all remains enabled and selects from originating all songs source', async page => {
    await songs(page);await activate(page, 0)
    await page.evaluate(() => { Math.random = () => .75 })
    await next(page)
    assert.equal(await page.evaluate(() => window.vm.playback.shuffleMode), 'shuffle-all')
    assert.equal((await loads(page)).at(-1), path('b', 22))
  }, 'list-loop', 'shuffle-all')
  console.log('PLAYBACK_SOURCE_ORDER_RESULT', passed, 'passed;', failures.length, 'failed')
  assert.deepEqual(failures, [])
} finally { await browser.close() }
