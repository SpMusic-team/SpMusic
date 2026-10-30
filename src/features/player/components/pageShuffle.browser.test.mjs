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
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__page_shuffle_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(Surface,props)}`
const fixture = `
import React from '${dependency('react.js')}';import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';import '/src/index.css';
import {Toaster} from '/src/components/ui/sonner.tsx';
window.calls=[];window.pendingSummaries=[];window.pendingLoads=[];const scenario=new URLSearchParams(location.search).get('scenario');let generation=0,current=null,state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null};
const fileIndex=(group,i)=>new URLSearchParams(location.search).has('reverseFiles')&&group!=='c'?29-i:i;
const descriptor=(group,i)=>({id:group+'-'+i,sourcePath:'/audio/'+group+'/'+String(fileIndex(group,i)).padStart(2,'0')+'.flac',fileName:String(fileIndex(group,i)).padStart(2,'0')+'.flac',available:group!=='c'||(scenario==='unavailable'?false:scenario==='single'?i===31:scenario==='mixed'?i!==31:true)});
const lists=Object.fromEntries(['a','b','c'].map(group=>[group,{directoryPath:'/audio/'+group,directoryName:'List '+group,sourceKind:group==='c'?'m3u8':'folder',sourcePath:group==='c'?'/lists/c.m3u8':'/audio/'+group,sourceName:'List '+group,selectedIndex:0,tracks:Array.from({length:group==='c'?(scenario==='small'?3:32):30},(_,i)=>descriptor(group,(group==='c'?(scenario==='small'?2:31):29)-i))}]));
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
  if(window.loadGate)await new Promise(resolve=>window.pendingLoads.push(resolve));
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
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell),React.createElement(Toaster)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__page_shuffle_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
let passed = 0
const failures = []
async function check(name, run, repeat = 'list-loop', shuffle = 'none', reverseFiles = false, scenario = '') {
  if (process.env.SPMUSIC_TEST_FILTER && !name.includes(process.env.SPMUSIC_TEST_FILTER)) return
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(({ repeat, shuffle }) => {
    if(localStorage.getItem('spmusic.player.repeat-mode.v1')===null)localStorage.setItem('spmusic.player.repeat-mode.v1', repeat)
    if(localStorage.getItem('spmusic.player.shuffle-mode.v1')===null)localStorage.setItem('spmusic.player.shuffle-mode.v1', shuffle)
    localStorage.setItem('spmusic.all-songs.layout-level.v1', '7')
    localStorage.setItem('spmusic.playlist.layout-level.v1', '7')
  }, { repeat, shuffle })
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__page_shuffle_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__page_shuffle_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__page_shuffle_test*', route => route.fulfill({ contentType: 'text/html', body: html }))
  try {
    await page.goto(origin + '/__page_shuffle_test?' + new URLSearchParams({scenario,...(reverseFiles?{reverseFiles:'1'}:{})}))
    await page.waitForFunction(() => window.vm?.playlist.library.items.length === 3)
    await run(page)
    assert.deepEqual(errors, [])
    console.log('PASS', name)
    passed++
  } catch (error) {
    console.log('FAIL', name, error.message, 'ERRORS', JSON.stringify(errors), 'LOADS', JSON.stringify(await loads(page)))
    failures.push(name + ': ' + error.message)
  } finally { await page.close() }
}
const loads = page => page.evaluate(() => (window.calls??[]).filter(call => ['audio_load_and_play', 'audio_load_file'].includes(call.command)).map(call => call.input.path))
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
const allTop = '.playlist-management:not([inert]) .playlist-management-actions button'
const detailTop = '.playlist-panel:not([inert]) .playlist-hero-copy .playlist-hero-shuffle-button'
const floating = '.playlist-controller-actions[data-actions-visible="true"] .playlist-hero-shuffle-button'
async function shuffle(page, selector) {
  const before = (await loads(page)).length
  const previous = (await loads(page)).at(-1)
  await page.evaluate(() => { window.previousShuffleToast = [...document.querySelectorAll('[data-sonner-toast]:not([data-removed="true"])')].find(toast => toast.textContent.includes('随机歌曲/分类')) })
  await page.locator(selector).first().click()
  await page.waitForFunction(before => window.calls.filter(call => call.command==='audio_load_and_play').length>before,before)
  await settled(page)
  await page.waitForFunction(()=>window.vm.playback.shuffleMode==='shuffle-all'&&window.vm.playback.repeatMode==='all-categories-until-stop')
  assert.equal(await page.locator(selector).first().getAttribute('aria-pressed'), null, 'page action has no toggle state')
  assert.equal(await page.locator(selector).first().getAttribute('data-selected'), null, 'page action has no selected state')
  await page.waitForFunction(() => {
    const toasts = [...document.querySelectorAll('[data-sonner-toast]:not([data-removed="true"])')]
    return toasts.some(toast => toast !== window.previousShuffleToast && toast.textContent.includes('随机歌曲/分类'))
  })
  if(await page.evaluate(()=>window.vm.queue.tracks.length>1))assert.notEqual((await loads(page)).at(-1),previous,'each page action excludes the playing song')
}
async function exhausted(page) {
  const before=(await loads(page)).length
  await page.evaluate(()=>window.finish())
  await page.waitForFunction(()=>!window.vm.playback.isPlaying)
  await page.waitForTimeout(1100) // Two real 500 ms state-polling opportunities after ended processing.
  assert.equal((await loads(page)).length,before,'exhausted traversal must not load or wrap')
}
async function cycleTo(page,kind,target) {
  for(let attempt=0;attempt<4;attempt++){
    const previous=await page.evaluate(kind=>window.vm.playback[kind],kind)
    if(previous===target)return
    await page.evaluate(kind=>window.vm.playback[kind==='shuffleMode'?'onShuffleCycle':'onRepeatCycle'](),kind)
    await page.waitForFunction(({kind,previous})=>window.vm.playback[kind]!==previous,{kind,previous})
  }
  assert.equal(await page.evaluate(kind=>window.vm.playback[kind],kind),target)
}
async function scrollDetail(page) {
  await page.locator('.playlist-panel:not([inert])').evaluate(node=>{node.scrollTop=node.scrollHeight})
  await page.locator(floating).waitFor()
}
try {
  await check('page random action exits repeat one before automatic continuation',async page=>{
    await songs(page);await activate(page,0)
    await page.evaluate(()=>{Math.random=()=>0});await shuffle(page,allTop)
    assert.equal(await page.evaluate(()=>window.vm.playback.repeatMode),'all-categories-until-stop','page random must replace the prior repeat-one mode')
    const previous=(await loads(page)).at(-1)
    await next(page,true)
    assert.notEqual((await loads(page)).at(-1),previous)
  },'repeat-one')
  await check('all sixteen original mode combinations converge to page random and play all categories',async page=>{
    await playlist(page);await activate(page,0,false)
    for(const repeat of ['list-loop','repeat-one','sequential','all-categories-until-stop']){
      for(const mode of ['none','shuffle-all','shuffle-category-order','shuffle-category-random']){
        await cycleTo(page,'repeatMode',repeat);await cycleTo(page,'shuffleMode',mode)
        await shuffle(page,detailTop)
        assert.equal(await page.evaluate(()=>window.vm.playback.repeatMode),'all-categories-until-stop')
        assert.equal(await page.evaluate(()=>localStorage.getItem('spmusic.player.repeat-mode.v1')),'all-categories-until-stop')
        assert.equal(await page.evaluate(()=>localStorage.getItem('spmusic.player.shuffle-mode.v1')),'shuffle-all')
      }
    }
  })
  await check('mode pair remains unchanged during native loading then commits together on success',async page=>{
    await songs(page);await activate(page,0);await playlist(page)
    await page.evaluate(()=>{
      window.loadGate=true;window.modeFrames=[];window.captureModes=true
      const sample=()=>{if(!window.captureModes)return;window.modeFrames.push([window.vm.playback.shuffleMode,window.vm.playback.repeatMode]);requestAnimationFrame(sample)}
      requestAnimationFrame(sample)
    })
    await page.locator(detailTop).click();await page.waitForFunction(()=>window.pendingLoads.length===1)
    assert.deepEqual(await page.evaluate(()=>[window.vm.playback.shuffleMode,window.vm.playback.repeatMode]),['shuffle-category-random','sequential'])
    await page.evaluate(()=>{window.loadGate=false;window.pendingLoads.splice(0).forEach(resolve=>resolve())})
    await settled(page)
    await page.waitForFunction(()=>window.vm.playback.repeatMode==='all-categories-until-stop')
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    const frames=await page.evaluate(()=>{window.captureModes=false;return window.modeFrames})
    assert(frames.length>1)
    assert(frames.every(pair=>JSON.stringify(pair)===JSON.stringify(['shuffle-category-random','sequential'])||JSON.stringify(pair)===JSON.stringify(['shuffle-all','all-categories-until-stop'])),'no frame exposes a partially committed mode pair')
  },'sequential','shuffle-category-random')
  await check('original source tail continues and the complete randomized page stops without a wrap',async page=>{
    await songs(page);await activate(page,0);await playlist(page)
    await page.evaluate(()=>{const values=[0,.999];Math.random=()=>values.shift()??.5})
    await shuffle(page,detailTop)
    assert.equal((await loads(page)).at(-1),path('c',0),'first random choice is the original source tail')
    const start=(await loads(page)).length-1
    const preview=await page.evaluate(async()=>{const token=await window.vm.playback.onPrepareTrackPreview(1);if(token)window.vm.playback.onDiscardTrackPreview(token.id);return token?{id:token.id,target:token.targetTrackId}:null})
    assert(preview,'original source tail still offers the next randomized preview')
    await next(page,true)
    assert.equal(await page.evaluate(()=>window.vm.playback.track.id),preview.target,'preview and automatic continuation agree on the planned next song')
    await next(page,true)
    const traversal=(await loads(page)).slice(start)
    assert.equal(new Set(traversal).size,3,'every page song is visited exactly once')
    assert.deepEqual([...traversal].sort(),[path('c',0),path('c',1),path('c',2)])
    assert.equal(await page.evaluate(()=>window.vm.playback.onPrepareTrackPreview(1)),null,'exhausted traversal has no wrapping preview')
    await exhausted(page)
    await shuffle(page,detailTop)
    const restarted=(await loads(page)).length-1
    await next(page,true);await next(page,true);await exhausted(page)
    assert.equal(new Set((await loads(page)).slice(restarted)).size,3,'repeated action creates a complete fresh traversal')
  },'repeat-one','none',false,'small')
  await check('failed restart preserves both modes and the partially consumed traversal',async page=>{
    await songs(page);await activate(page,0);await playlist(page)
    await page.evaluate(()=>{const values=[0,.999];Math.random=()=>values.shift()??.5})
    await shuffle(page,detailTop);await next(page,true)
    await page.evaluate(()=>{window.failGroup='c'})
    const before=(await loads(page)).length
    await page.locator(detailTop).click()
    await page.waitForFunction(before=>window.calls.filter(call=>call.command==='audio_load_and_play').length>before&&!window.vm.playback.isAudioBusy&&!window.vm.playback.isSelectionPending,before)
    assert.deepEqual(await page.evaluate(()=>[window.vm.playback.shuffleMode,window.vm.playback.repeatMode]),['shuffle-all','all-categories-until-stop'])
    await page.evaluate(()=>{window.failGroup=null})
    await next(page,true);await exhausted(page)
    assert.equal((await loads(page)).length,before+2,'one failed attempt and the sole remaining original song')
  },'repeat-one','shuffle-category-order',false,'small')
  await check('failed first page action preserves an arbitrary original mode pair and source',async page=>{
    await songs(page);await activate(page,0);await playlist(page)
    const beforeIds=await page.evaluate(()=>window.vm.queue.tracks.map(track=>track.id))
    const previous=await page.evaluate(()=>window.vm.playback.track.id)
    await page.evaluate(()=>{window.failGroup='c'})
    const before=(await loads(page)).length
    await page.locator(detailTop).click()
    await page.waitForFunction(before=>window.calls.filter(call=>call.command==='audio_load_and_play').length>before&&!window.vm.playback.isAudioBusy&&!window.vm.playback.isSelectionPending,before)
    assert.deepEqual(await page.evaluate(()=>[window.vm.playback.shuffleMode,window.vm.playback.repeatMode]),['shuffle-category-random','repeat-one'])
    assert.deepEqual(await page.evaluate(()=>window.vm.queue.tracks.map(track=>track.id)),beforeIds)
    assert.equal(await page.evaluate(()=>window.vm.playback.track.id),previous)
    assert.equal(await page.locator('.playback-mode-toast').count(),0,'failed action must not announce successful modes')
  },'repeat-one','shuffle-category-random')
  await check('successful page modes persist and the real controller presents the restored labels and icons',async page=>{
    await playlist(page);await activate(page,0,false);await shuffle(page,detailTop)
    const current=await page.evaluate(()=>window.vm.playback.track.id)
    await page.waitForFunction(()=>Boolean(localStorage.getItem('spmusic.player.session.v1')))
    await page.reload()
    await page.waitForFunction(current=>window.vm?.playback.track?.id===current&&!window.vm.playback.isAudioBusy&&!window.vm.playback.isSelectionPending,current)
    assert.deepEqual(await page.evaluate(()=>[window.vm.playback.shuffleMode,window.vm.playback.repeatMode]),['shuffle-all','all-categories-until-stop'])
    await page.evaluate(()=>window.vm.playlist.onOpenChange(false))
    for(const label of ['随机歌曲/分类','播放所有分类']){
      const button=page.getByRole('button',{name:label,exact:true}).first()
      await button.waitFor()
      assert.equal(await button.getAttribute('aria-pressed'),'true')
      assert.equal(await button.locator('svg').count(),1)
    }
  },'repeat-one','shuffle-category-random')
  await check('repeated detail action always loads another song',async page=>{
    await playlist(page);await activate(page,0,false)
    await page.evaluate(()=>{Math.random=()=>0});await shuffle(page,detailTop)
    await shuffle(page,detailTop)
    assert.equal((await loads(page)).length,3)
    assert.match((await loads(page)).at(-1),/^\/audio\/c\//)
    assert.equal(await page.evaluate(()=>window.vm.playback.shuffleMode),'shuffle-all')
  })
  await check('all songs action replaces unrelated playing queue, immediately plays, and continues randomly',async page=>{
    await playlist(page);await activate(page,0,false);await songs(page)
    await page.evaluate(()=>{Math.random=()=>0})
    await shuffle(page,allTop)
    assert.match((await loads(page)).at(-1),/^\/audio\/[ab]\//)
    assert.equal(await page.evaluate(()=>window.vm.queue.tracks.length),60)
    await shuffle(page,allTop)
    assert.match((await loads(page)).at(-1),/^\/audio\/[ab]\//)
    await page.evaluate(()=>{Math.random=()=>.75});await next(page)
    assert.match((await loads(page)).at(-1),/^\/audio\/[ab]\//)
  })
  await check('random queue B cannot make page A button exit instead of starting A',async page=>{
    await playlist(page);await activate(page,0,false);await songs(page)
    assert.equal(await page.locator(allTop).first().getAttribute('aria-pressed'),null,'page action has no toggle state')
    await page.evaluate(()=>{Math.random=()=>0});await shuffle(page,allTop)
    assert.match((await loads(page)).at(-1),/^\/audio\/[ab]\//)
    assert.equal(await page.evaluate(()=>window.vm.queue.tracks.length),60)
  },'list-loop','shuffle-all')
  await check('detail toolbar and repeated floating action each load another page song',async page=>{
    await songs(page);await activate(page,0);await playlist(page)
    await page.evaluate(()=>{Math.random=()=>0});await shuffle(page,detailTop)
    assert.match((await loads(page)).at(-1),/^\/audio\/c\//)
    assert.equal(await page.evaluate(()=>window.vm.queue.tracks.length),32)
    await scrollDetail(page)
    await shuffle(page,floating)
    assert.match((await loads(page)).at(-1),/^\/audio\/c\//)
    await shuffle(page,floating)
    assert.match((await loads(page)).at(-1),/^\/audio\/c\//)
  })
  await check('current song excluded and filtered page freezes complete matching order',async page=>{
    await songs(page);await activate(page,10)
    await page.getByRole('button',{name:'搜索所有歌曲',exact:true}).click()
    const search=page.getByRole('searchbox',{name:'搜索歌曲标题、艺术家或专辑'})
    await search.fill('Track 01')
    await page.waitForFunction(()=>document.querySelectorAll('.all-songs-list .playlist-card').length===10)
    await page.evaluate(()=>{Math.random=()=>0});await shuffle(page,allTop)
    assert.notEqual((await loads(page)).at(-1),path('a',5),'current a-5 must not be reselected')
    assert((await loads(page)).at(-1).match(/\/0[5-9]\.flac$/),'selection stays inside the filtered range')
    assert.equal(await page.evaluate(()=>window.vm.queue.tracks.length),10)
    await search.fill('Track 02');await next(page)
    assert((await loads(page)).at(-1).match(/\/0[5-9]\.flac$/),'continuation retains the original filter')
    assert.equal(await page.locator(allTop).first().getAttribute('aria-pressed'),null,'filtered page still has no toggle state')
    await shuffle(page,allTop)
    assert((await loads(page)).at(-1).match(/\/1[0-4]\.flac$/),'new action captures the changed filter')
    assert.equal(await page.evaluate(()=>window.vm.queue.tracks.length),10)
  })
  await check('all songs repeated floating action always loads another song and shows another toast',async page=>{
    await playlist(page);await activate(page,0,false);await songs(page)
    await page.locator('.playlist-management:not([inert]) .playlist-management-content').evaluate(node=>{node.scrollTop=500})
    await page.locator(floating).waitFor()
    await page.evaluate(()=>{Math.random=()=>0});await shuffle(page,floating)
    assert.match((await loads(page)).at(-1),/^\/audio\/[ab]\//)
    const before=(await loads(page)).length
    await shuffle(page,floating)
    assert.equal((await loads(page)).length,before+1)
    assert.match((await loads(page)).at(-1),/^\/audio\/[ab]\//)
    await shuffle(page,floating)
    assert.match((await loads(page)).at(-1),/^\/audio\/[ab]\//)
  })
  await check('unavailable page has no random candidate and preserves playing source',async page=>{
    await songs(page);await activate(page,0);await playlist(page)
    assert.equal(await page.locator(detailTop).isDisabled(),true)
    const before=await loads(page)
    await page.locator(detailTop).evaluate(button=>button.click())
    assert.deepEqual(await loads(page),before)
    assert.equal(await page.evaluate(()=>window.vm.playback.shuffleMode),'none')
  },'list-loop','none',false,'unavailable')
  await check('single playable current song remains a valid random candidate',async page=>{
    await playlist(page);await activate(page,0,false)
    await shuffle(page,detailTop)
    assert.equal((await loads(page)).at(-1),path('c',31))
    assert.equal(await page.evaluate(()=>window.vm.queue.tracks.length),1)
  },'list-loop','none',false,'single')
  await check('unavailable first entry cannot be chosen as the immediate random target',async page=>{
    await songs(page);await activate(page,0);await playlist(page)
    await page.evaluate(()=>{Math.random=()=>0});await shuffle(page,detailTop)
    assert.notEqual((await loads(page)).at(-1),path('c',31))
    assert.match((await loads(page)).at(-1),/^\/audio\/c\//)
    assert.equal(await page.evaluate(()=>window.vm.queue.tracks.length),31)
  },'list-loop','none',false,'mixed')
  await check('empty filtered result disables random and retains queue and mode',async page=>{
    await songs(page);await activate(page,0)
    await page.getByRole('button',{name:'搜索所有歌曲',exact:true}).click()
    await page.getByRole('searchbox',{name:'搜索歌曲标题、艺术家或专辑'}).fill('no matching song')
    await page.waitForFunction(()=>document.querySelectorAll('.all-songs-list .playlist-card').length===0)
    assert.equal(await page.locator(allTop).first().isDisabled(),true)
    const before=await loads(page)
    await page.locator(allTop).first().evaluate(button=>button.click())
    assert.deepEqual(await loads(page),before)
    assert.equal(await page.evaluate(()=>window.vm.playback.shuffleMode),'none')
    assert.equal(await page.evaluate(()=>window.vm.queue.tracks.length),60)
  })
  await check('failed page shuffle preserves old queue and mode and permits recovery',async page=>{
    await songs(page);await activate(page,0);await playlist(page)
    await page.evaluate(()=>{Math.random=()=>0;window.failGroup='c'})
    const before=(await loads(page)).length
    await page.locator(detailTop).click()
    await page.waitForFunction(before=>window.calls.filter(call=>call.command==='audio_load_and_play').length>before&&!window.vm.playback.isAudioBusy&&!window.vm.playback.isSelectionPending,before)
    assert.equal(await page.evaluate(()=>window.vm.playback.shuffleMode),'none')
    assert.equal(await page.evaluate(()=>window.vm.queue.tracks.length),60)
    await page.evaluate(()=>{window.failGroup=null});await next(page)
    assert.equal((await loads(page)).at(-1),path('b',0))
    await shuffle(page,detailTop);assert.match((await loads(page)).at(-1),/^\/audio\/c\//)
  })
  await check('same tick repeated random request yields one native load and locks both toolbars',async page=>{
    await songs(page);await activate(page,0);await playlist(page)
    await page.evaluate(()=>{Math.random=()=>0;window.loadGate=true})
    const before=(await loads(page)).length
    await page.locator(detailTop).evaluate(button=>{button.click();button.click()})
    await page.waitForFunction(()=>window.pendingLoads.length===1)
    assert.equal((await loads(page)).length,before+1)
    assert.equal(await page.locator(detailTop).isDisabled(),true)
    await scrollDetail(page);assert.equal(await page.locator(floating).isDisabled(),true)
    await page.locator(floating).evaluate(button=>button.click())
    assert.equal((await loads(page)).length,before+1)
    await page.evaluate(()=>{window.loadGate=false;window.pendingLoads.splice(0).forEach(resolve=>resolve())})
    await settled(page)
    assert.equal(await page.evaluate(()=>window.vm.playback.shuffleMode),'shuffle-all')
  })
  await check('navigation during native load cannot retarget the captured page selection',async page=>{
    await songs(page);await activate(page,0);await playlist(page)
    await page.evaluate(()=>{Math.random=()=>0;window.loadGate=true})
    await page.locator(detailTop).click()
    await page.waitForFunction(()=>window.pendingLoads.length===1)
    await songs(page)
    await page.evaluate(()=>{window.loadGate=false;window.pendingLoads.splice(0).forEach(resolve=>resolve())})
    await settled(page)
    assert.match((await loads(page)).at(-1),/^\/audio\/c\//)
    assert.equal(await page.evaluate(()=>window.vm.queue.tracks.length),32)
    assert.equal(await page.locator(allTop).first().getAttribute('aria-pressed'),null)
    await next(page)
    assert.match((await loads(page)).at(-1),/^\/audio\/c\//)
  })
  await check('overview and unloaded categories never expose floating page actions',async page=>{
    await songs(page)
    for(const category of ['artist','album-artist','genre','composer','folders']){
      await page.evaluate(category=>window.vm.playlist.library.onSelectCategory(category),category)
      await page.waitForFunction(category=>window.vm.playlist.library.route.categoryId===category,category)
      assert.equal(await page.locator('.playlist-management:not([inert]) .playlist-management-actions').count(),0,category)
      assert.equal(await page.locator('.playlist-management:not([inert]) .playlist-controller-actions').count(),0,category)
    }
    await page.evaluate(()=>window.vm.playlist.library.onOpenOverview())
    await page.locator('.media-library-overview').waitFor()
    assert.equal(await page.locator('.playlist-controller-actions').count(),0)
  })
  await check('bottom transport retains four modes and does not trigger page selection',async page=>{
    await songs(page);await activate(page,0)
    const before=await loads(page)
    for(const mode of ['shuffle-all','shuffle-category-order','shuffle-category-random','none']){
      await page.evaluate(()=>window.vm.playback.onShuffleCycle())
      await page.waitForFunction(mode=>window.vm.playback.shuffleMode===mode,mode)
      assert.deepEqual(await loads(page),before)
    }
  })
  console.log('PAGE_SHUFFLE_RESULT',passed,'passed;',failures.length,'failed')
  assert.deepEqual(failures,[])
}finally{await browser.close()}
