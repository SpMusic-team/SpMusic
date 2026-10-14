// Independent browser acceptance test. Start Vite, then provide an existing
// Playwright package with SPMUSIC_PLAYWRIGHT. No project dependency is installed.
// Real PlayerShell, useAudioPlayer, PlayerSurface and command parsers are used;
// only the native command/event transport is replaced with deterministic input.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>delete window.listeners[name];};')
assert(service.includes('window.backendInvoke'), 'retain real audio command parser')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `
import React from '${dependency('react.js')}';
import {PlayerSurface as RealSurface} from '/__management_real_surface.js';
export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import {useAudioPlayer} from '/src/features/player/hooks/useAudioPlayer.ts';
import '/src/index.css';
window.calls=[];window.config={scope:'a',count:3,sourceKind:'m3u8',sourcePath:null,failPath:null,gate:false,cancel:false};window.pending=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const descriptor=(scope,i)=>({id:scope+'-'+i,sourcePath:'/audio/'+scope+'/'+i+'.flac',fileName:i+'.flac',available:true});
const playlist=()=>({directoryPath:'/audio/'+window.config.scope,directoryName:'Folder '+window.config.scope,sourceKind:window.config.sourceKind,sourcePath:window.config.sourcePath??'/lists/'+window.config.scope+'.m3u8',sourceName:'Playlist '+window.config.scope,selectedIndex:0,tracks:Array.from({length:window.config.count},(_,i)=>descriptor(window.config.scope,i))});
const track=path=>{const parts=path.replaceAll('\\\\','/').split('/'),scope=parts.at(-2),i=Number(parts.at(-1).split('.')[0]);return {...descriptor(scope,i),durationMs:180000,metadata:{title:'Song '+scope+' '+i,artist:'Artist '+scope,album:'Album '+scope,albumArtist:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,time:performance.now()});
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_open_source'){if(window.config.cancel)throw {code:'USER_CANCELLED',message:'cancelled',recoverable:true};return {kind:'playlist',playlist:playlist()}}
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  if(window.config.gate)await new Promise(resolve=>window.pending.push(resolve));
  if(input.path===window.config.failPath)throw {code:'UNREADABLE_FILE',message:'injected unreadable file',recoverable:true};
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:180000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation:response.generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_load_playlist_cover_pixels')throw {code:'NO_COVER_ART',message:'fixture has no artwork',recoverable:false};
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 throw new Error('Unexpected native command '+command);
};
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();
function HookFixture(){window.playerApi=useAudioPlayer();return React.createElement('output',null,window.playerApi.track?.id??'empty')}
root.render(React.createElement(AppearanceProvider,null,React.createElement(new URLSearchParams(location.search).get('kind')==='hook'?HookFixture:PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__management_fixture.js"')
const browser = await chromium.launch({ headless:true, channel:'msedge' })
const screenshotDirectory = process.env.SPMUSIC_SCREENSHOT_DIR || join(tmpdir(), 'spmusic-playlist-management')
mkdirSync(screenshotDirectory, {recursive:true})
const report = []
async function open(width=2560,height=1440,kind='shell') {
  const page = await browser.newPage({viewport:{width,height},reducedMotion:'reduce'})
  const errors = []
  page.on('pageerror',error=>{errors.push(error.message);console.error('PAGEERROR',error.message)})
  page.on('console',message=>{if(message.type()==='error')console.error('CONSOLE',message.text())})
  await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}))
  await page.route('**/__management_real_surface.js',route=>route.fulfill({contentType:'text/javascript',body:realSurface}))
  await page.route('**/__management_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__management_test?*',route=>route.fulfill({contentType:'text/html',body:html}))
  await page.goto(origin+'/__management_test?kind='+kind)
  await page.waitForFunction(kind=>Boolean(kind==='hook'?window.playerApi:window.viewModel),kind)
  return {page,errors}
}
async function importSource(page,scope,patch={}) {
  await page.evaluate(({scope,patch})=>{Object.assign(window.config,{scope,count:3,sourcePath:null,...patch});(window.playerApi?.openAudio??window.viewModel.playback.onOpenAudio)()},{scope,patch})
  await page.waitForFunction(()=>window.playerApi?!window.playerApi.audioBusy&&!window.playerApi.selectionPending:!window.viewModel.playback.isAudioBusy&&!window.viewModel.playback.isSelectionPending)
}
const playbackSnapshot = page => page.evaluate(()=>{const p=window.playerApi;return p?{track:p.track?.id,queue:p.queueTracks.map(t=>t.id),phase:p.playing}:{track:window.viewModel.playback.track?.id,queue:window.viewModel.queue.tracks.map(t=>t.id),phase:window.viewModel.playback.isPlaying}})

try {
  const {page,errors}=await open(1280,900,'hook')
  await importSource(page,'a')
  await importSource(page,'b')
  assert.equal(await page.evaluate(()=>window.playerApi.sessionPlaylists.length),2,'imports retain multiple source lists')
  assert.deepEqual((await playbackSnapshot(page)).queue,['b-0','b-1','b-2'])
  await importSource(page,'a',{count:4})
  assert.equal(await page.evaluate(()=>window.playerApi.sessionPlaylists.length),2,'reimport replaces same source without duplicating it')
  await importSource(page,'b')
  await page.evaluate(()=>window.playerApi.selectQueueTrack('b-1'))
  await page.waitForFunction(()=>window.playerApi.track?.id==='b-1'&&!window.playerApi.selectionPending)
  const scopeA = await page.evaluate(()=>window.playerApi.sessionPlaylists.find(p=>p.sourceName==='Playlist a').sourceKind+'\u0000'+window.playerApi.sessionPlaylists.find(p=>p.sourceName==='Playlist a').sourcePath)
  const before = await playbackSnapshot(page)
  await page.evaluate(scope=>{window.config.gate=true;window.selectionResult=null;window.playerApi.selectSessionPlaylistTrack(scope,'a-2').then(result=>window.selectionResult=result)},scopeA)
  await page.waitForFunction(()=>window.pending.length===1)
  assert.deepEqual((await playbackSnapshot(page)).queue,before.queue,'pending cross-list selection retains previous active queue')
  const commandCount = await page.evaluate(()=>window.calls.filter(c=>c.command==='audio_load_and_play').length)
  assert.equal(await page.evaluate(scope=>window.playerApi.selectSessionPlaylistTrack(scope,'a-1'),scopeA),false,'repeated selection is rejected while load is pending')
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='audio_load_and_play').length),commandCount,'repeated selection cannot launch another replacement')
  await page.evaluate(()=>{window.config.failPath='/audio/a/2.flac';window.config.gate=false;window.pending.splice(0).forEach(resolve=>resolve())})
  await page.waitForFunction(()=>window.selectionResult!==null&&!window.playerApi.audioBusy&&!window.playerApi.selectionPending)
  assert.equal(await page.evaluate(()=>window.selectionResult),false)
  assert.deepEqual(await playbackSnapshot(page),before,'failed cross-list load retains playback and active queue')
  await page.evaluate(scope=>{window.config.failPath=null;window.selectionResult=null;window.playerApi.selectSessionPlaylistTrack(scope,'a-2').then(result=>window.selectionResult=result)},scopeA)
  await page.waitForFunction(()=>window.selectionResult===true&&!window.playerApi.selectionPending)
  assert.deepEqual(await playbackSnapshot(page),{track:'a-2',queue:['a-0','a-1','a-2','a-3'],phase:true},'successful load commits chosen list')
  const established = await playbackSnapshot(page)
  await importSource(page,'cancel',{cancel:true})
  assert.deepEqual(await playbackSnapshot(page),established,'cancel leaves queue and playback intact')
  assert.equal(await page.evaluate(()=>window.playerApi.sessionPlaylists.length),2)
  await page.evaluate(()=>window.config.cancel=false)
  await importSource(page,'empty',{count:0})
  assert.deepEqual(await playbackSnapshot(page),established,'empty source cannot replace established playback')
  assert.equal(await page.evaluate(()=>window.playerApi.sessionPlaylists.length),2,'failed empty import cannot add a misleading library entry')
  assert.equal(await page.evaluate(()=>window.playerApi.selectSessionPlaylistTrack('missing','missing')),false,'unknown source is rejected')
  assert.equal(await page.evaluate(scope=>window.playerApi.selectSessionPlaylistTrack(scope,'missing'),scopeA),false,'unknown track is rejected')
  await page.evaluate(()=>window.unmountFixture())
  assert.equal(await page.evaluate(()=>Object.keys(window.listeners).length),0,'unmount removes audio event listeners')
  assert.deepEqual(errors,[])
  report.push('native transport fixture: multi-source retention, source dedupe, delayed failure rollback, successful queue commit, cancel and unmount pass')
  await page.close()
  const ui = await open()
  await ui.page.getByRole('button',{name:'播放列表',exact:true}).click()
  await ui.page.locator('.playlist-panel').waitFor()
  await ui.page.locator('.playlist-close').click()
  await ui.page.getByRole('region',{name:'播放列表管理'}).waitFor()
  await ui.page.getByText('暂无播放列表', {exact:true}).last().waitFor()
  assert.equal(await ui.page.getByRole('button',{name:'媒体库暂未开放',exact:true}).isDisabled(),true,'unimplemented parent library cannot shortcut to player')
  async function importThroughMenu(scope) {
    await ui.page.evaluate(scope=>Object.assign(window.config,{scope,count:3,cancel:false,sourcePath:null}),scope)
    await ui.page.getByRole('button',{name:'更多列表操作',exact:true}).click()
    await ui.page.getByRole('menuitem',{name:'导入音频或播放列表',exact:true}).click()
    await ui.page.waitForFunction(scope=>window.viewModel.playback.track?.id===scope+'-0'&&!window.viewModel.playback.isAudioBusy&&!window.viewModel.playback.isSelectionPending,scope)
  }
  await importThroughMenu('a')
  for (let index=0;index<6;index++) await importThroughMenu('extra-'+index)
  await importThroughMenu('b')
  await ui.page.getByRole('button',{name:'打开播放列表 Playlist a',exact:true}).waitFor()
  assert.equal(await ui.page.locator('.playlist-management-card').count(),8,'management is populated by real imported sources')
  await ui.page.getByRole('button',{name:'搜索播放列表',exact:true}).click()
  await ui.page.getByRole('searchbox',{name:'搜索播放列表名称'}).fill('Playlist b')
  await ui.page.getByRole('button',{name:'播放列表中的歌曲',exact:true}).click()
  await ui.page.waitForFunction(()=>window.viewModel.playback.isPlaying&&!window.viewModel.playback.isSelectionPending)
  await ui.page.getByRole('searchbox',{name:'搜索播放列表名称'}).press('Escape')
  await ui.page.getByRole('searchbox',{name:'搜索播放列表名称'}).waitFor({state:'hidden'})
  const playingB = await playbackSnapshot(ui.page)
  const geometry = await ui.page.locator('.playlist-management-cover').first().boundingBox()
  assert.equal(geometry.width,240)
  assert.equal(geometry.height,165)
  assert.equal((await ui.page.locator('.playlist-management > .playlist-library-sidebar').boundingBox()).width,320)
  assert.equal(await ui.page.locator('.playlist-playback-dock').count(),0,'management follows fullscreen design without detail playback dock')
  await ui.page.screenshot({path:join(screenshotDirectory,'management-fullscreen.png')})
  await ui.page.getByRole('button',{name:'打开播放列表 Playlist a',exact:true}).click()
  await ui.page.locator('.playlist-panel').waitFor()
  assert.deepEqual(await playbackSnapshot(ui.page),playingB,'browsing A does not interrupt playback B')
  assert.equal(await ui.page.evaluate(()=>window.viewModel.playlist.playlistName),'Playlist a')
  await ui.page.evaluate(()=>window.config.failPath='/audio/a/1.flac')
  await ui.page.locator('[data-playlist-track-id="a-1"]').click()
  await ui.page.waitForFunction(()=>!window.viewModel.playback.isAudioBusy&&!window.viewModel.playback.isSelectionPending)
  assert.deepEqual(await playbackSnapshot(ui.page),playingB,'real detail song selection failure restores B')
  await ui.page.evaluate(()=>window.config.failPath=null)
  await ui.page.locator('[data-playlist-track-id="a-1"]').click()
  await ui.page.waitForFunction(()=>window.viewModel.playback.track?.id==='a-1'&&!window.viewModel.playback.isSelectionPending)
  assert.deepEqual((await playbackSnapshot(ui.page)).queue,['a-0','a-1','a-2'],'real detail successful selection commits A')
  await ui.page.locator('.playlist-playback-dock').getByRole('button',{name:'返回播放界面',exact:true}).click()
  await ui.page.locator('.player-stage').waitFor()
  await ui.page.getByRole('button',{name:'播放列表',exact:true}).click()
  await ui.page.locator('.playlist-panel').waitFor()
  assert.equal(await ui.page.locator('.playlist-hero-title').textContent(),'Playlist a','player parent returns to browsed list detail')
  await ui.page.locator('.playlist-hero-category').click()
  await ui.page.getByRole('region',{name:'播放列表管理'}).waitFor()
  await ui.page.getByRole('button',{name:'搜索播放列表',exact:true}).click()
  await ui.page.getByRole('searchbox',{name:'搜索播放列表名称'}).fill('Playlist a')
  assert.equal(await ui.page.locator('.playlist-management-card').count(),1)
  await ui.page.getByRole('searchbox',{name:'搜索播放列表名称'}).fill('nonmatching list')
  await ui.page.getByText('没有匹配的播放列表',{exact:true}).waitFor()
  assert.equal(await ui.page.locator('.playlist-management-card').count(),0)
  await ui.page.getByRole('button',{name:'清空搜索',exact:true}).click()
  assert.equal(await ui.page.locator('.playlist-management-card').count(),8)
  await ui.page.getByRole('searchbox',{name:'搜索播放列表名称'}).press('Escape')
  await ui.page.getByRole('searchbox',{name:'搜索播放列表名称'}).waitFor({state:'hidden'})
  await ui.page.keyboard.press('Control+f')
  await ui.page.getByRole('searchbox',{name:'搜索播放列表名称'}).waitFor()
  await ui.page.getByRole('searchbox',{name:'搜索播放列表名称'}).press('Escape')
  await ui.page.getByRole('searchbox',{name:'搜索播放列表名称'}).waitFor({state:'hidden'})
  await ui.page.getByRole('button',{name:'选择',exact:true}).click()
  await ui.page.getByRole('button',{name:'选择 Playlist a',exact:true}).focus()
  await ui.page.keyboard.press('Space')
  assert.equal(await ui.page.getByRole('button',{name:'选择 Playlist a',exact:true}).getAttribute('aria-pressed'),'true')
  await ui.page.getByRole('status').getByText('已选择 1 项',{exact:true}).waitFor()
  await ui.page.getByRole('button',{name:'取消选择',exact:true}).click()
  await ui.page.getByRole('button',{name:'打开播放列表 Playlist b',exact:true}).focus()
  await ui.page.keyboard.press('Enter')
  await ui.page.locator('.playlist-panel').waitFor()
  assert.equal(await ui.page.locator('.playlist-hero-title').textContent(),'Playlist b','keyboard opens selected source')
  assert.deepEqual((await playbackSnapshot(ui.page)).queue,['a-0','a-1','a-2'],'keyboard browsing keeps active A queue')
  await ui.page.locator('.playlist-close').click()
  await ui.page.getByRole('region',{name:'播放列表管理'}).waitFor()
  await ui.page.setViewportSize({width:480,height:800})
  await ui.page.getByRole('button',{name:'打开媒体库',exact:true}).click()
  await ui.page.getByRole('dialog',{name:'媒体库',exact:true}).waitFor()
  await ui.page.keyboard.press('Escape')
  await ui.page.getByRole('dialog',{name:'媒体库',exact:true}).waitFor({state:'hidden'})
  await ui.page.screenshot({path:join(screenshotDirectory,'management-narrow.png')})
  assert(await ui.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'narrow page has no horizontal overflow')
  assert.equal(await ui.page.getByRole('button',{name:'媒体库暂未开放',exact:true}).isDisabled(),true)
  await ui.page.getByRole('button',{name:'更多列表操作',exact:true}).click()
  assert.equal(await ui.page.getByRole('menuitem',{name:'返回播放界面',exact:true}).count(),0,'management menu preserves parent hierarchy')
  await ui.page.keyboard.press('Escape')
  assert.deepEqual(ui.errors,[])
  report.push('real UI: actual button hierarchy management/detail/player/detail/management, fullscreen geometry, real dynamic lists, independent browsing, failure rollback and commit, search empty state, Ctrl+F/Escape, keyboard selection/open, narrow overlay and layout pass')
  await ui.page.close()
  console.log(JSON.stringify({browser:browser.version(),report,screenshots:screenshotDirectory}))
} finally {await browser.close()}
