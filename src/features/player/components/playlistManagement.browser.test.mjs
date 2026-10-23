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
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'), 'retain real audio command parser')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `
import React from '${dependency('react.js')}';
import {PlayerSurface as RealSurface} from '/__management_real_surface.js';
export function PlayerSurface(props){window.viewModel=props.viewModel;${process.env.SPMUSIC_SCROLL_BASELINE === '1' ? 'props={...props,viewModel:{...props.viewModel,playlist:{...props.viewModel.playlist,entryPosition:undefined}}};' : ''}return React.createElement(RealSurface,props)}
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
const playlist=()=>({directoryPath:'/audio/'+window.config.scope,directoryName:'Folder '+window.config.scope,sourceKind:window.config.sourceKind,sourcePath:window.config.sourcePath??'/lists/'+window.config.scope+'.m3u8',sourceName:'Playlist '+window.config.scope,selectedIndex:window.config.selectedIndex??0,tracks:Array.from({length:window.config.count},(_,i)=>descriptor(window.config.scope,i))});
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
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:result.metadata.coverArt}}
 if(command==='audio_load_track_thumbnail')return new Uint8Array(0);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_probe_playlist_track_summaries')return input.paths.map(sourcePath=>{const parts=sourcePath.replaceAll('\\\\','/').split('/'),scope=parts.at(-2),i=Number(parts.at(-1).split('.')[0]);return {sourcePath,summary:{title:'Song '+scope+' '+i,artist:'Artist '+scope,album:'Album '+scope,albumArtist:null,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 if(command==='audio_load_playlist_cover_pixels')throw {code:'NO_COVER_ART',message:'fixture has no artwork',recoverable:false};
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 throw new Error('Unexpected native command '+command);
};
window.emitPosition=positionMs=>{state={...state,positionMs};window.listeners?.audio_state_changed?.({payload:{...state}})};
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();
function HookFixture(){window.playerApi=useAudioPlayer();return React.createElement('output',null,window.playerApi.track?.id??'empty')}
root.render(React.createElement(AppearanceProvider,null,React.createElement(new URLSearchParams(location.search).get('kind')==='hook'?HookFixture:PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__management_fixture.js"')
const browser = await chromium.launch({ headless:true, channel:'msedge' })
const screenshotDirectory = process.env.SPMUSIC_SCREENSHOT_DIR || join(tmpdir(), 'spmusic-playlist-management')
mkdirSync(screenshotDirectory, {recursive:true})
const report = []
async function open(width=2560,height=1440,kind='shell',reducedMotion='reduce') {
  const page = await browser.newPage({viewport:{width,height},reducedMotion})
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror',error=>{errors.push(error.message);console.error('PAGEERROR',error.message)})
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
  if (process.env.SPMUSIC_SCROLL_ONLY !== '1') {
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
  await ui.page.getByRole('region',{name:'媒体库总览'}).waitFor()
  assert.equal(await ui.page.locator('.media-library-category').count(),19)
  const overviewGeometry = await ui.page.evaluate(() => {
    const windowBar = document.querySelector('.window-bar')
    const bar = windowBar.getBoundingClientRect()
    const entries = [...document.querySelectorAll('.media-library-category')].map(item => {
      const rect = item.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width }
    })
    return { bar: { x: bar.x, width: bar.width, drag: windowBar.hasAttribute('data-tauri-drag-region') }, entries }
  })
  assert.deepEqual(overviewGeometry.bar,{x:0,width:2560,drag:true},'overview window bar covers the entire draggable top edge')
  for (let index=0;index<3;index++) {
    assert.equal(overviewGeometry.entries[16+index].x,overviewGeometry.entries[index].x,'incomplete last row aligns to the established columns')
    assert.equal(overviewGeometry.entries[16+index].width,overviewGeometry.entries[index].width,'last row does not grow to fill unused columns')
  }
  await ui.page.setViewportSize({width:3840,height:1440})
  assert.equal((await ui.page.locator('.media-library-category').first().boundingBox()).x,overviewGeometry.entries[0].x,'ultrawide overview stays anchored to the left edge')
  await ui.page.setViewportSize({width:2560,height:1440})
  const themeCheck = await ui.page.evaluate(async () => {
    const codec = await import('/src/features/appearance/model/appearanceThemeCodec.ts')
    const { defaultAppearance } = await import('/src/features/appearance/model/defaultAppearance.ts')
    const { createAppearanceCssVars } = await import('/src/features/appearance/model/appearanceCss.ts')
    const theme = codec.cloneAppearance(defaultAppearance)
    theme.colorSchemes.light.librarySongs = '#123456'
    const imported = codec.deserializeAppearanceTheme(codec.serializeAppearanceTheme(theme))
    const oldDocument = JSON.parse(codec.serializeAppearanceTheme(defaultAppearance))
    for (const scheme of Object.values(oldDocument.theme.colorSchemes)) for (const key of Object.keys(scheme)) if (key.startsWith('library')) delete scheme[key]
    const migrated = codec.deserializeAppearanceTheme(JSON.stringify(oldDocument))
    return { ok: imported.ok, color: createAppearanceCssVars(imported.appearance, 'light')['--playlist-category-songs'], fallback: migrated.appearance.colorSchemes.light.librarySongs }
  })
  assert.deepEqual(themeCheck,{ok:true,color:'#123456',fallback:'#728ace'},'category palette survives theme export/import and old themes receive defaults')
  assert.equal(await ui.page.locator('.playlist-playback-dock').count(),0,'overview has no playback dock')
  await ui.page.screenshot({path:join(screenshotDirectory,'media-library-overview.png')})
  await ui.page.locator('.media-library-category[data-category-id="playlists"]').click()
  await ui.page.getByRole('region',{name:'播放列表管理'}).waitFor()
  await ui.page.getByText('暂无播放列表', {exact:true}).last().waitFor()
  await ui.page.locator('.playlist-playback-dock').waitFor()
  assert.equal(await ui.page.locator('.playlist-playback-toggle').isDisabled(),true,'empty management playback is disabled')
  assert.equal(await ui.page.locator('.playlist-playback-progress input').isDisabled(),true,'empty management progress is disabled')
  assert.equal(await ui.page.getByRole('button',{name:'打开当前播放列表',exact:true}).isDisabled(),true,'empty management cannot open an absent active playlist')
  await ui.page.screenshot({path:join(screenshotDirectory,'management-empty-dock.png')})
  await ui.page.locator('.playlist-playback-nav').getByRole('button',{name:'打开播放界面',exact:true}).click()
  await ui.page.locator('.player-stage').waitFor()
  await ui.page.locator('.window-bar').getByRole('button',{name:'播放列表',exact:true}).click()
  await ui.page.locator('.playlist-hero-category').click()
  await ui.page.getByRole('region',{name:'播放列表管理'}).waitFor()
  await ui.page.getByRole('button',{name:'返回媒体库',exact:true}).click()
  await ui.page.getByRole('region',{name:'媒体库总览'}).waitFor()
  for (const id of ['album','artist','queue']) {
    await ui.page.locator('.media-library-category[data-category-id="'+id+'"]').click()
    await ui.page.getByText(/尚未接入数据$/, {exact:false}).last().waitFor()
    assert.equal(await ui.page.locator('.playlist-management-card').count(),0,'unconnected categories never show playlist results')
    await ui.page.getByRole('button',{name:'返回媒体库',exact:true}).click()
  }
  await ui.page.locator('.media-library-category[data-category-id="playlists"]').click()
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
  assert.equal(await ui.page.locator('.playlist-playback-dock').count(),1,'management reuses existing playback dock')
  await ui.page.locator('.playlist-playback-dock').getByRole('button',{name:'暂停',exact:true}).click()
  await ui.page.waitForFunction(()=>!window.viewModel.playback.isPlaying&&!window.viewModel.playback.isTransportBusy)
  assert.equal((await playbackSnapshot(ui.page)).track,'b-0','management pause retains active track')
  await ui.page.locator('.playlist-playback-dock').getByRole('button',{name:'播放',exact:true}).click()
  await ui.page.waitForFunction(()=>window.viewModel.playback.isPlaying&&!window.viewModel.playback.isTransportBusy)
  assert.equal(await ui.page.evaluate(()=>window.calls.filter(c=>c.command==='audio_transition_playback').length),2,'management toggles use real transport transitions')
  await ui.page.evaluate(()=>window.emitPosition(60000))
  await ui.page.waitForFunction(()=>Number(document.querySelector('.playlist-playback-progress input')?.value)>=60)
  const progress = ui.page.locator('.playlist-playback-progress input')
  await progress.focus()
  await ui.page.keyboard.press('ArrowRight')
  await ui.page.waitForFunction(()=>window.calls.some(c=>c.command==='audio_seek'))
  assert(await ui.page.evaluate(()=>window.calls.findLast(c=>c.command==='audio_seek').input.positionMs>=60000),'management keyboard progress sends seek for current audio')
  await ui.page.waitForFunction(()=>window.viewModel.timeline.interaction==='following'&&!document.querySelector('.playlist-playback-toggle').disabled)
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
  await ui.page.locator('.playlist-playback-dock').getByRole('button',{name:'打开播放界面',exact:true}).click()
  await ui.page.locator('.player-stage').waitFor()
  await ui.page.locator('.window-bar').getByRole('button',{name:'播放列表',exact:true}).click()
  await ui.page.locator('.playlist-panel').waitFor()
  assert.equal(await ui.page.locator('.playlist-hero-title').textContent(),'Playlist a','player parent returns to browsed list detail')
  await ui.page.locator('.playlist-hero-category').click()
  await ui.page.getByRole('region',{name:'播放列表管理'}).waitFor()
  await ui.page.locator('.playlist-playback-dock').getByRole('button',{name:'搜索',exact:true}).click()
  await ui.page.getByRole('searchbox',{name:'搜索播放列表名称'}).waitFor()
  assert.equal(await ui.page.locator('.playlist-filter-input').count(),0,'management dock search does not mount detail search')
  await ui.page.getByRole('searchbox',{name:'搜索播放列表名称'}).press('Escape')
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
  await ui.page.locator('.playlist-hero-category').click()
  await ui.page.getByRole('region',{name:'播放列表管理'}).waitFor()
  await ui.page.getByRole('button',{name:'打开当前播放列表',exact:true}).click()
  await ui.page.locator('.playlist-panel').waitFor()
  assert.equal(await ui.page.locator('.playlist-hero-title').textContent(),'Playlist a','management dock list action opens active A while B was browsed')
  await ui.page.locator('.playlist-hero-category').click()
  await ui.page.getByRole('region',{name:'播放列表管理'}).waitFor()
  await ui.page.locator('.playlist-playback-nav').getByRole('button',{name:'打开播放界面',exact:true}).click()
  await ui.page.locator('.player-stage').waitFor()
  await ui.page.locator('.window-bar').getByRole('button',{name:'播放列表',exact:true}).click()
  await ui.page.locator('.playlist-panel').waitFor()
  assert.equal(await ui.page.locator('.playlist-hero-title').textContent(),'Playlist a','management dock expansion returns through detail hierarchy')
  await ui.page.locator('.playlist-hero-category').click()
  await ui.page.getByRole('region',{name:'播放列表管理'}).waitFor()
  await ui.page.setViewportSize({width:480,height:800})
  await ui.page.getByRole('button',{name:'打开媒体库',exact:true}).click()
  await ui.page.getByRole('dialog',{name:'媒体库',exact:true}).waitFor()
  await ui.page.keyboard.press('Escape')
  await ui.page.getByRole('dialog',{name:'媒体库',exact:true}).waitFor({state:'hidden'})
  await ui.page.locator('.playlist-management-content').evaluate(element=>element.scrollTop=element.scrollHeight)
  const lastCard = await ui.page.locator('.playlist-management-card').last().boundingBox()
  const narrowDock = await ui.page.locator('.playlist-playback-dock').boundingBox()
  assert(lastCard.y+lastCard.height<=narrowDock.y,'last list card can scroll entirely above the narrow dock')
  report.push({viewport:{width:480,height:800},lastCardBottom:lastCard.y+lastCard.height,dockTop:narrowDock.y})
  await ui.page.locator('.playlist-management-card-button').last().focus()
  await ui.page.screenshot({path:join(screenshotDirectory,'management-narrow.png')})
  assert(await ui.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'narrow page has no horizontal overflow')
  const beforeOverview = await playbackSnapshot(ui.page)
  await ui.page.getByRole('button',{name:'返回媒体库',exact:true}).click()
  await ui.page.getByRole('region',{name:'媒体库总览'}).waitFor()
  assert(await ui.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'narrow overview has no horizontal overflow')
  await ui.page.screenshot({path:join(screenshotDirectory,'media-library-overview-narrow.png')})
  assert.deepEqual(await playbackSnapshot(ui.page),beforeOverview,'navigation preserves current playback and queue')
  await ui.page.locator('.media-library-category[data-category-id="folder"]').click()
  assert.equal(await ui.page.locator('.playlist-management-card').count(),0,'M3U8 playlists are excluded from folder category')
  await ui.page.getByRole('button',{name:'返回媒体库',exact:true}).click()
  await ui.page.locator('.media-library-category[data-category-id="playlists"]').click()
  await ui.page.getByRole('button',{name:'更多列表操作',exact:true}).click()
  assert.equal(await ui.page.getByRole('menuitem',{name:'返回播放界面',exact:true}).count(),0,'management menu preserves parent hierarchy')
  await ui.page.keyboard.press('Escape')
  assert.deepEqual(ui.errors,[])
  report.push('real UI: actual button hierarchy management/detail/player/detail/management, fullscreen geometry, real dynamic lists, independent browsing, failure rollback and commit, search empty state, Ctrl+F/Escape, keyboard selection/open, reused management dock pause/play/seek and active-list navigation, empty dock disabled, narrow overlay and last-card clearance pass')
  await ui.page.close()
  const moving = await open(1280,900,'shell','no-preference')
  await importSource(moving.page,'motion')
  await moving.page.locator('.media-library-category[data-category-id="playlists"]').click()
  await moving.page.getByRole('region',{name:'播放列表管理'}).waitFor()
  const docks = await moving.page.evaluate(async()=>{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    return [...document.querySelectorAll('.playlist-playback-dock')].map(element=>({inert:element.inert,hidden:element.getAttribute('aria-hidden')==='true'}))
  })
  assert.equal(docks.filter(dock=>!dock.inert&&!dock.hidden).length,1,'animated detail/management handoff exposes one interactive dock')
  assert(docks.every(dock=>dock.inert===dock.hidden),'exiting docks agree on keyboard and accessibility exclusion')
  await moving.page.locator('.playlist-playback-dock:not([aria-hidden="true"]) .playlist-playback-nav').getByRole('button',{name:'打开播放界面',exact:true}).click()
  await moving.page.waitForFunction(()=>!document.querySelector('.playlist-management')&&!document.querySelector('.playlist-panel')&&!document.querySelector('.player-shell').hasAttribute('data-controller-background-present'))
  assert.deepEqual(moving.errors,[])
  report.push('normal motion: one interactive dock during handoff; exiting dock inert/aria-hidden; shared dock background owner released on player entry')
  await moving.page.close()
  }
  async function verifyDetailEntryScroll(width,height,motion) {
    const {page,errors}=await open(width,height,'shell',motion)
    const evidence={width,height,motion,managementEntries:[]}
    await importSource(page,'scroll',{count:80,selectedIndex:75})
    await page.waitForFunction(()=>window.viewModel.playback.track?.id==='scroll-75')
    await page.locator('.media-library-category[data-category-id="playlists"]').click()
    await page.getByRole('button',{name:'打开播放列表 Playlist scroll',exact:true}).click()
    await page.locator('.playlist-panel').waitFor()
    const top=()=>page.locator('.playlist-panel').last().evaluate(async panel=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
      return {top:panel.scrollTop,scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight}
    })
    const first=await top()
    evidence.managementEntries.push(first)
    assert(first.scrollHeight>first.clientHeight+1000,'long current-track fixture has substantial overflow')
    assert.equal(first.top,0,'management card entry starts at the list top with current song near the end')
    await page.locator('.playlist-panel').last().evaluate(panel=>{panel.scrollTop=panel.scrollHeight;panel.dispatchEvent(new Event('scroll'))})
    assert((await top()).top>1000,'fixture was explicitly scrolled before reentry')
    // Use the persistent sidebar category because the hero is intentionally
    // above the scrolled viewport; this is an actual user navigation action.
    if(width<=1024){
      await page.getByRole('button',{name:'打开媒体库',exact:true}).click()
      await page.getByRole('dialog',{name:'媒体库',exact:true}).getByRole('button',{name:'播放列表',exact:true}).click()
    }else{
      await page.locator('.playlist-library-sidebar:not(.playlist-management .playlist-library-sidebar) .playlist-library-category[aria-current="page"]').click()
    }
    await page.getByRole('region',{name:'播放列表管理'}).waitFor()
    await page.getByRole('button',{name:'打开播放列表 Playlist scroll',exact:true}).click()
    const second=await top()
    evidence.managementEntries.push(second)
    assert.equal(second.top,0,'same-scope management reentry resets a previously scrolled list')
    await page.locator('.playlist-playback-nav').last().getByRole('button',{name:'打开播放界面',exact:true}).click()
    await page.locator('.player-stage').waitFor()
    await page.locator('.window-bar').getByRole('button',{name:'播放列表',exact:true}).click()
    await page.waitForFunction(()=>[...document.querySelectorAll('.playlist-panel')].some(panel=>panel.scrollTop>1000))
    const returned=await page.locator('.playlist-panel').last().evaluate(panel=>{
      const panelRect=panel.getBoundingClientRect(),card=panel.querySelector('[data-playlist-track-id="scroll-75"]'),rect=card.getBoundingClientRect()
      return {top:panel.scrollTop,cardTop:rect.top,cardBottom:rect.bottom,panelTop:panelRect.top,panelBottom:panelRect.bottom}
    })
    evidence.playerReturn=returned
    assert(returned.cardBottom>returned.panelTop&&returned.cardTop<returned.panelBottom,'player return reveals the actual current song')
    await page.locator('.player-stage').waitFor({state:'hidden'})
    await page.screenshot({path:join(screenshotDirectory,'detail-current-position-'+width+'.png')})
    // Return through management once more so an old current-song scroll effect
    // retained during AnimatePresence cannot reposition the new detail page.
    if(width<=1024){
      await page.getByRole('button',{name:'打开媒体库',exact:true}).click()
      await page.getByRole('dialog',{name:'媒体库',exact:true}).getByRole('button',{name:'播放列表',exact:true}).click()
    }else{
      await page.locator('.playlist-library-sidebar:not(.playlist-management .playlist-library-sidebar) .playlist-library-category[aria-current="page"]').click()
    }
    await page.getByRole('button',{name:'打开播放列表 Playlist scroll',exact:true}).click()
    const final=await top()
    evidence.managementEntries.push(final)
    assert.equal(final.top,0,'current-song return does not leak positioning into a later management entry')
    await page.locator('.playlist-management').waitFor({state:'hidden'})
    assert.equal((await top()).top,0,'management entry remains at top after the outgoing page animation completes')
    await page.screenshot({path:join(screenshotDirectory,'detail-management-top-'+width+'.png')})
    assert.deepEqual(errors,[])
    report.push({detailEntryScroll:evidence})
    await page.close()
  }
  await verifyDetailEntryScroll(1280,900,'no-preference')
  await verifyDetailEntryScroll(480,800,'reduce')
  console.log(JSON.stringify({browser:browser.version(),report,screenshots:screenshotDirectory}))
} catch (error) {
  for (const [index,page] of browser.contexts().flatMap(context=>context.pages()).entries()) {
    await page.screenshot({path:join(screenshotDirectory,'management-failure-'+index+'.png')}).catch(()=>{})
  }
  throw error
} finally {await browser.close()}
