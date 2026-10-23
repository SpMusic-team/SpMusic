// Start Vite and set SPMUSIC_PLAYWRIGHT to an installed Playwright package.
// Native commands are controlled; the real PlayerShell and storage run in Edge.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve Vite dependency ${name}`)
  return match[1]
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,
    'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/,
    'const listen=async()=>()=>{};')
assert(service.includes('window.backendInvoke'))
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `
import React from '${dependency('react.js')}';
import {PlayerSurface as RealSurface} from '/__playback_session_real_surface.js';
export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];
window.visibleFrames=[];
const root=document.getElementById('root');
const observeVisible=()=>{
 const surface=root.querySelector('main.player-shell');
 if(!surface || getComputedStyle(surface).visibility!=='visible')return;
 const frame={track:window.vm?.playback.track?.id??null, position:window.vm?.timeline.positionSeconds??null,
   phase:window.vm?.playback.isPlaying?'playing':window.vm?.playback.contentState,
   content:surface.dataset.contentState, queueOpen:window.vm?.queue.isOpen??null};
 if(JSON.stringify(frame)!==JSON.stringify(window.visibleFrames.at(-1)))window.visibleFrames.push(frame);
};
new MutationObserver(observeVisible).observe(root,{subtree:true,childList:true,attributes:true,characterData:true});
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null};
const path=new URLSearchParams(location.search).has('subdir')?'/music/sub/song.flac':'/music/song.flac';
const selectAllSongs=new URLSearchParams(location.search).has('selectAllSongs');
const descriptor={id:'song',sourcePath:path,fileName:'song.flac',available:true};
const secondDescriptor={id:'second',sourcePath:'/music/second.flac',fileName:'second.flac',available:true};
const playlist={directoryPath:'/music',directoryName:'Music',sourceKind:'folder',sourcePath:'/music',sourceName:'Music',selectedIndex:0,tracks:[descriptor]};
const track={...descriptor,durationMs:180000,metadata:{title:'Song',artist:'Artist',album:'Album',albumArtist:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}};
const invalidTrack=new URLSearchParams(location.search).has('invalid');
const seekError=new URLSearchParams(location.search).has('seekError');
const hangLoad=new URLSearchParams(location.search).has('hangLoad');
const hangSummary=new URLSearchParams(location.search).has('hangSummary');
const hangDuration=new URLSearchParams(location.search).has('hangDuration');
window.backendInvoke=async(command,args)=>{
 window.calls.push(command);
 if(command==='library_get_playlists')return [];
 if(command==='library_get_folders')return {folders:selectAllSongs?['/music']:[]};
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return state.currentTrackId?track:null;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_list_folder_tracks'){
  if(args.input.selectedPath==='/music')throw Error('INVALID_PATH: expected an audio file');
  await new Promise(resolve=>setTimeout(resolve,30));
  return invalidTrack?{...playlist,tracks:[{...descriptor,available:false}]}:hangDuration?{...playlist,tracks:[descriptor,secondDescriptor]}:playlist;
 }
 if(command==='library_scan_folder'){
  if(args.path!=='/music')throw Error('INVALID_PATH: expected the library root');
  await new Promise(resolve=>setTimeout(resolve,30));
  return invalidTrack?{...playlist,tracks:[{...descriptor,available:false}]}:hangDuration?{...playlist,tracks:[descriptor,secondDescriptor]}:playlist;
 }
 if(command==='audio_load_file'){if(hangLoad)return new Promise(()=>{});await new Promise(resolve=>setTimeout(resolve,30));state={...state,phase:'ready',generation:1,currentTrackId:'song',durationMs:180000,positionMs:0};return track}
 if(command==='audio_load_and_play'){state={...state,phase:'playing',generation:1,currentTrackId:'song',durationMs:180000,positionMs:0};return {requestId:args.input.requestId,generation:1,trackId:'song',fileName:'song.flac',state:{...state}}}
 if(command==='audio_seek'){await new Promise(resolve=>setTimeout(resolve,30));if(seekError)throw Error('seek failed');state={...state,positionMs:args.input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:args.input.volume};return {...state}}
 if(command==='audio_play'){state={...state,phase:'playing'};return {...state}}
 if(command==='audio_pause'){await new Promise(resolve=>setTimeout(resolve,30));state={...state,phase:'paused'};return {...state}}
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_cover')return {id:'song',sourcePath:path,coverArt:null};
 if(command==='audio_probe_playlist_durations'){if(hangDuration)return new Promise(()=>{});return args.input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));}
 if(command==='audio_probe_playlist_track_summaries'){if(hangSummary)return new Promise(()=>{});return args.input.paths.map(sourcePath=>({sourcePath,summary:{title:'Song',artist:'Artist',album:'Album',albumArtist:null,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}));}
 if(command==='audio_hydrate_track')return args.input.path===secondDescriptor.sourcePath?{...track,...secondDescriptor}:track;
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(root).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__playback_session_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  {
    const page = await browser.newPage()
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
    await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
    await page.route('**/__playback_session_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
    await page.route('**/__playback_session_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
    await page.route('**/__playback_session_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto(origin + '/__playback_session_test?selectAllSongs=1&subdir=1')
    await page.waitForFunction(() => window.vm?.playlist.library.allSongs.some(row => row.trackId === 'song'))
    await page.evaluate(() => window.vm.playlist.library.onSelectCategory('songs'))
    await page.locator('.all-songs-list .playlist-card').first().click()
    await page.waitForFunction(() => window.vm?.playback.track?.id === 'song'
      && window.vm?.playback.isPlaying
      && JSON.parse(localStorage.getItem('spmusic.player.session.v1') ?? 'null')?.playlist.folderMode === 'library')
    await page.evaluate(() => { window.vm.timeline.onPreviewStart(); window.vm.timeline.onCommit(42.5) })
    await page.waitForFunction(() => window.calls.includes('audio_seek')
      && JSON.parse(localStorage.getItem('spmusic.player.session.v1') ?? 'null')?.positionMs >= 42_500)
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('spmusic.player.session.v1')))
    assert.equal(saved.sourcePath, '/music/sub/song.flac')
    assert.deepEqual(saved.playlist, { sourceKind: 'folder', sourcePath: '/music', folderMode: 'library' })
    assert.equal(saved.wasPlaying, true)
    await page.reload()
    await page.waitForFunction(() => window.visibleFrames?.length > 0)
    const frames = await page.evaluate(() => window.visibleFrames)
    assert.equal(frames[0].track, 'song')
    assert(frames[0].position >= 42.5)
    assert(frames.every(frame => frame.phase !== 'playing'))
    assert(!(await page.evaluate(() => window.calls)).includes('audio_list_folder_tracks'))
    assert.equal(await page.evaluate(() => window.vm.playback.isPlaying), false)
    assert.deepEqual(errors, [])
    await page.close()
  }
  for (const [wasPlaying, wasPaused, sourcePath, folderMode, registeredLibrary, expectedScan] of [
    [true, false, '/music/song.flac', undefined, true, 'library_scan_folder'],
    [false, true, '/music/song.flac', undefined, false, 'audio_list_folder_tracks'],
    [false, true, '/music/song.flac', 'library', false, 'library_scan_folder'],
    [true, false, '/music/sub/song.flac', 'library', false, 'library_scan_folder'],
    [false, true, '/music/song.flac', 'file', false, 'audio_list_folder_tracks'],
  ]) {
    const page = await browser.newPage()
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
    await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
    await page.route('**/__playback_session_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
    await page.route('**/__playback_session_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
    await page.route('**/__playback_session_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.addInitScript(snapshot => localStorage.setItem('spmusic.player.session.v1', JSON.stringify(snapshot)), {
      version: 1, sourcePath,
      playlist: { sourceKind: 'folder', sourcePath: '/music', ...(folderMode ? { folderMode } : {}) },
      positionMs: 42_500, wasPlaying, wasPaused, queueOpen: true, volume: 67,
    })
    await page.goto(origin + '/__playback_session_test?run=' + Math.random()
      + (sourcePath.includes('/sub/') ? '&subdir=1' : '')
      + (registeredLibrary ? '&selectAllSongs=1' : ''))
    try {
      await page.waitForFunction(() => window.vm?.playback.track?.id === 'song'
        && window.vm.timeline.positionSeconds >= 42.5
        && window.calls.includes('audio_seek') && window.calls.includes('audio_set_volume')
        && window.calls.includes('audio_pause') && window.visibleFrames.length > 0)
    } catch (error) {
      console.error(await page.evaluate(() => ({ calls: window.calls, track: window.vm?.playback.track,
        position: window.vm?.timeline.positionSeconds, errors: window.vm?.playback.statusText })))
      console.error(errors)
      throw error
    }
    const calls = await page.evaluate(() => window.calls)
    assert(calls.includes(expectedScan))
    assert(!calls.includes(expectedScan === 'audio_list_folder_tracks' ? 'library_scan_folder' : 'audio_list_folder_tracks'))
    assert(calls.indexOf('audio_load_file') < calls.indexOf('audio_seek'))
    assert(calls.indexOf('audio_seek') < calls.indexOf('audio_pause'))
    assert(!calls.includes('audio_play'))
    const frames = await page.evaluate(() => window.visibleFrames)
    assert.equal(frames[0].track, 'song')
    assert(frames[0].position >= 42.5)
    assert.equal(frames[0].content, 'track')
    assert.equal(frames[0].queueOpen, true)
    assert(frames.every(frame => frame.track === 'song' && frame.content === 'track' && frame.phase !== 'playing'))
    assert.equal(await page.evaluate(() => window.vm.playback.isPlaying), false)
    assert.deepEqual(errors, [])
    await page.close()
  }
  const page = await browser.newPage()
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__playback_session_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__playback_session_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__playback_session_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.addInitScript(() => localStorage.setItem('spmusic.player.session.v1', JSON.stringify({
    version: 1, sourcePath: '/music/song.flac', playlist: { sourceKind: 'folder', sourcePath: '/music' },
    positionMs: 42_500, wasPlaying: true, wasPaused: false, queueOpen: true, volume: 67,
  })))
  await page.goto(origin + '/__playback_session_test?invalid=1')
  await page.waitForFunction(() => window.visibleFrames?.length > 0)
  assert.equal(await page.evaluate(() => localStorage.getItem('spmusic.player.session.v1')), null)
  assert.equal((await page.evaluate(() => window.visibleFrames))[0].track, null)
  await page.close()
  const emptyPage = await browser.newPage()
  await emptyPage.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await emptyPage.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await emptyPage.route('**/__playback_session_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await emptyPage.route('**/__playback_session_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await emptyPage.route('**/__playback_session_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await emptyPage.goto(origin + '/__playback_session_test?empty=1')
  await emptyPage.waitForFunction(() => window.visibleFrames?.length > 0)
  assert.equal((await emptyPage.evaluate(() => window.visibleFrames))[0].content, 'empty')
  await emptyPage.close()
  const failedSeekPage = await browser.newPage()
  await failedSeekPage.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await failedSeekPage.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await failedSeekPage.route('**/__playback_session_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await failedSeekPage.route('**/__playback_session_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await failedSeekPage.route('**/__playback_session_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await failedSeekPage.addInitScript(() => localStorage.setItem('spmusic.player.session.v1', JSON.stringify({
    version: 1, sourcePath: '/music/song.flac', playlist: { sourceKind: 'folder', sourcePath: '/music' },
    positionMs: 42_500, wasPlaying: true, wasPaused: false, queueOpen: true, volume: 67,
  })))
  await failedSeekPage.goto(origin + '/__playback_session_test?seekError=1')
  await failedSeekPage.waitForFunction(() => window.visibleFrames?.length > 0)
  const failedFrames = await failedSeekPage.evaluate(() => window.visibleFrames)
  assert(failedFrames.every(frame => frame.content !== 'loading' && frame.phase !== 'playing'))
  assert.equal(await failedSeekPage.evaluate(() => window.vm.playback.isPlaying), false)
  await failedSeekPage.close()
  const hungPage = await browser.newPage()
  hungPage.setDefaultTimeout(20_000)
  await hungPage.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await hungPage.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await hungPage.route('**/__playback_session_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await hungPage.route('**/__playback_session_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await hungPage.route('**/__playback_session_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await hungPage.addInitScript(() => localStorage.setItem('spmusic.player.session.v1', JSON.stringify({
    version: 1, sourcePath: '/music/song.flac', playlist: { sourceKind: 'folder', sourcePath: '/music' },
    positionMs: 42_500, wasPlaying: true, wasPaused: false, queueOpen: true, volume: 67,
  })))
  await hungPage.goto(origin + '/__playback_session_test?hangLoad=1')
  await hungPage.waitForFunction(() => window.visibleFrames?.length > 0)
  assert.equal((await hungPage.evaluate(() => window.visibleFrames))[0].content, 'error')
  assert.equal(await hungPage.evaluate(() => localStorage.getItem('spmusic.player.session.v1')), null)
  await hungPage.close()
  for (const stalledProbe of ['hangSummary', 'hangDuration']) {
    const probePage = await browser.newPage()
    probePage.setDefaultTimeout(22_000)
    await probePage.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
    await probePage.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
    await probePage.route('**/__playback_session_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
    await probePage.route('**/__playback_session_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
    await probePage.route('**/__playback_session_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
    await probePage.addInitScript(() => localStorage.setItem('spmusic.player.session.v1', JSON.stringify({
      version: 1, sourcePath: '/music/song.flac', playlist: { sourceKind: 'folder', sourcePath: '/music' },
      positionMs: 42_500, wasPlaying: true, wasPaused: false, queueOpen: true, volume: 67,
    })))
    await probePage.goto(origin + '/__playback_session_test?' + stalledProbe + '=1')
    try {
      await probePage.getByText('播放列表加载失败').waitFor()
    } catch (error) {
      console.error(stalledProbe, await probePage.evaluate(() => ({ calls: window.calls, frames: window.visibleFrames,
        track: window.vm?.playback.track?.id, queueOpen: window.vm?.queue.isOpen,
        text: document.body.innerText.slice(0, 300), startupReady: document.querySelector('main')?.dataset.startupReady })))
      throw error
    }
    assert.deepEqual(await probePage.evaluate(() => window.visibleFrames), [])
    assert.equal(await probePage.locator('main.player-shell').count(), 0)
    assert((await probePage.evaluate(() => window.calls)).includes(stalledProbe === 'hangSummary'
      ? 'audio_probe_playlist_track_summaries' : 'audio_probe_playlist_durations'))
    await probePage.close()
  }
  console.log('playback session: all-songs save/restore, paused first frame, and failure paths passed')
} finally {
  await browser.close()
}
