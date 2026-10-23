// Start Vite and point SPMUSIC_PLAYWRIGHT at an existing Playwright package.
// Real React, PlayerShell, useAudioPlayer and all UI interactions are retained;
// only native audio transport is mocked. Optional BASELINE_REF routes the shell
// from Git without changing the checkout and must fail the same assertions.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const baselineRef = process.env.SPMUSIC_RETURN_BASELINE_REF
const shellPath = '/src/features/player/components/PlayerShell.tsx'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const transformedShell = await (await fetch(origin + shellPath)).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
const existing = readFileSync(new URL('./allSongs.browser.test.mjs', import.meta.url), 'utf8')
const literal = existing.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal, 'reuse the native fixture without executing its test runner')
const baseFixture = runInNewContext(literal[1], { dependency })
// Preserve the original transport for existing cases. A reload represents a
// fresh native player process while its registered library sources survive.
const fixture = baseFixture.replace("c:[['c-0','/audio/c/0.flac']],", "c:new URLSearchParams(location.search).has('multiPlaylist')?[['c-0','/audio/c/0.flac'],['c-1','/audio/c/1.flac'],['c-2','/audio/c/2.flac']]:[['c-0','/audio/c/0.flac']],")
 .replace("ReactDOM.createRoot(document.getElementById('root'))", `
const nativeInvoke=window.backendInvoke;
window.restoreLoadGate=sessionStorage.getItem('spmusic.return-test.restore-gate')==='1';
window.backendInvoke=async(command,args)=>{
 if(command==='library_get_folders'){
  window.savedLibraryFolders=JSON.parse(localStorage.getItem('spmusic.return-test.native-folders')??'[]');return {folders:window.savedLibraryFolders};
 }
 if(command==='library_get_playlists'){
  if(sessionStorage.getItem('spmusic.return-test.registry-gate')==='1')await new Promise(resolve=>window.releasePlaylistRegistry=resolve);
  return JSON.parse(localStorage.getItem('spmusic.return-test.native-playlists')??'[]');
 }
 if(command==='audio_load_file'&&window.restoreLoadGate){window.restoreLoadGate=false;await new Promise(resolve=>window.releaseRestoreLoad=resolve)}
 if(command==='audio_set_volume'){state={...state,volume:args.input.volume};return {...state}}
 const result=await nativeInvoke(command,args);
 if(command==='library_add_folder')localStorage.setItem('spmusic.return-test.native-folders',JSON.stringify(result.folders));
 if(command==='audio_import_playlist')localStorage.setItem('spmusic.return-test.native-playlists',JSON.stringify([result]));
 return result;
};
ReactDOM.createRoot(document.getElementById('root'))`)
assert.notEqual(fixture, baseFixture, 'add restart capabilities without changing production services')
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'), 'keep real audio command parsers')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__return_real_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__return_fixture.js"')
let baselineShell
if (baselineRef) {
  const source = execFileSync('git', ['show', baselineRef + ':' + shellPath.slice(1)], { encoding: 'utf8' })
  baselineShell = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText
    .replace(/import \{([^}]+)\} from ['"]react['"];?/, (_, names) => `import React from '${dependency('react.js')}';const {${names}}=React;`)
    .replace(/from ['"](@\/[^'"]+)['"]/g, (_, name) => {
      const path = '/src/' + name.slice(2)
      const match = transformedShell.match(new RegExp('["\u0027](' + path + '[^"\u0027]*)["\u0027]'))
      assert(match, 'resolve baseline import ' + name)
      return 'from ' + JSON.stringify(match[1])
    })
}
if(process.env.SPMUSIC_RETURN_PRE_FIX_INITIALIZER==='1') {
  baselineShell=transformedShell.replace(/const \[libraryRoute, setLibraryRoute\] = useState\(\(\) => \{[\s\S]*?\n\t\}\);/, 'const [libraryRoute, setLibraryRoute] = useState(() => readStartupPage() === "media-library" ? { view: "overview" } : { view: "tracks" });')
  assert.notEqual(baselineShell,transformedShell,'reproduce the previous initializer without reverting current shell behavior')
}
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const categories = ['songs', 'folder', 'folders', 'album', 'artist', 'album-artist', 'genre', 'year', 'composer', 'playlists', 'streams', 'queue', 'bookmarks', 'most-played', 'highest-rated', 'lowest-rated', 'recent-played', 'recent-added', 'long-tracks']
const report = []

async function open(startup = 'media-library', width = 1440, { reduced = true, multiPlaylist = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(startup => localStorage.setItem('spmusic.player.startup-page.v1', startup), startup)
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  if (baselineShell) await page.route('**/src/features/player/components/PlayerShell.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: baselineShell }))
  await page.route('**/__return_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__return_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__return_test*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__return_test' + (multiPlaylist ? '?multiPlaylist=1' : ''))
  await page.waitForFunction(() => Boolean(window.viewModel))
  return { page, errors }
}

async function importChoice(page, choice) {
  await page.evaluate(choice => {
    window.choice = choice
    if (choice === 'c') window.viewModel.playlist.library.onImportPlaylist()
    else window.viewModel.playlist.library.onSelectFolders()
  }, choice)
  await page.waitForFunction(() => !window.viewModel.playlist.library.isImportPending && !window.viewModel.playback.isAudioBusy && !window.viewModel.playback.isSelectionPending)
}

const routeSnapshot = page => page.evaluate(() => ({
  route: window.viewModel.playlist.library.route,
  scope: window.viewModel.playlist.library.currentScope,
  ids: window.viewModel.playlist.tracks.map(track => track.id),
  current: window.viewModel.playback.track?.id,
  queue: window.viewModel.queue.tracks.map(track => track.id),
  entry: window.viewModel.playlist.entryPosition.requestId,
}))

async function category(page, id) {
  await page.evaluate(() => window.viewModel.playlist.library.onOpenOverview())
  await page.locator(`.media-library-category[data-category-id="${id}"]`).click()
  await page.waitForFunction(id => window.viewModel.playlist.library.route.view === 'category' && window.viewModel.playlist.library.route.categoryId === id, id)
}

async function roundTrip(page, label) {
  const before = await routeSnapshot(page)
  const source=await page.evaluate(()=>JSON.parse(localStorage.getItem('spmusic.player.session.v1')??'null')?.playlist.customPlaylist?.playbackQueue??null)
  const loadCount = await page.evaluate(() => window.calls.filter(call => ['audio_load_file', 'audio_load_and_play'].includes(call.command)).length)
  await page.locator('.playlist-playback-dock .playlist-playback-track-button').click()
  await page.waitForFunction(() => !window.viewModel.playlist.isOpen)
  await page.locator('.cover-collapse-button').first().click()
  await page.waitForFunction(() => window.viewModel.playlist.isOpen)
  const after = await routeSnapshot(page)
  const expectedRoute=source?.kind==='all-songs'?{view:'category',categoryId:'songs'}:{view:'tracks'}
  assert.deepEqual(after.route,expectedRoute,label+': explicit player cover opens its actual playback source')
  if(source?.kind==='playlist')assert.equal(after.scope,source.sourceScope,label+': real playlist source replaces unrelated browsed scope')
  assert.equal(after.current, before.current, label + ': navigation does not change the song')
  assert.deepEqual(after.queue, before.queue, label + ': navigation does not replace the queue')
  assert.equal(await page.evaluate(() => window.calls.filter(call => ['audio_load_file', 'audio_load_and_play'].includes(call.command)).length), loadCount, label + ': no audio reload')
  assert.equal(after.entry, before.entry + Number(expectedRoute.view === 'tracks'), label + ': only source track lists request current-track positioning')
  if (expectedRoute.view === 'tracks') await page.locator('.playlist-panel').waitFor({ state: 'visible' })
  else await page.locator('.playlist-management').waitFor({ state: 'visible' })
  report.push(label)
  console.log('PASS', label)
}

async function prepareRestartSource(page, kind) {
  await importChoice(page, 'a')
  await importChoice(page, 'b')
  if (kind === 'all-songs') {
    await category(page, 'songs')
    await page.locator('[data-song-key="/audio/a/0.flac"]').click()
  } else {
    await importChoice(page, 'c')
    await category(page, 'playlists')
    await page.getByRole('button', { name: '打开播放列表 List c', exact: true }).click()
    await page.locator('.playlist-grid:not(.all-songs-list) [data-playlist-track-id="c-0"]').click()
  }
  const id=kind==='all-songs'?'a-0':'c-0'
  await page.waitForFunction(id=>window.viewModel.playback.track?.id===id&&!window.viewModel.playback.isSelectionPending&&!window.viewModel.playback.isAudioBusy,id)
  await page.waitForFunction(kind=>{
    const saved=JSON.parse(localStorage.getItem('spmusic.player.session.v1')??'null')
    return saved?.playlist.customPlaylist?.playbackQueue?.kind===kind
  },kind)
  await page.locator('.playlist-playback-dock .playlist-playback-track-button').click()
  await page.waitForFunction(()=>!window.viewModel.playlist.isOpen)
}

async function restartReady(page,id,playerVisible=true) {
  await page.waitForFunction(id=>window.viewModel?.playback.track?.id===id&&!window.viewModel.playback.isSelectionPending&&!window.viewModel.playback.isAudioBusy,id)
  if(playerVisible)await page.locator('.cover-collapse-button').first().waitFor({state:'visible'})
}

async function restartChecks() {
  for(const kind of ['all-songs','playlist']) {
    const {page,errors}=await open('player')
    try {
      await prepareRestartSource(page,kind)
      await page.reload()
      await restartReady(page,kind==='all-songs'?'a-0':'c-0')
      const before=await routeSnapshot(page)
      const loadCount=await page.evaluate(()=>window.calls.filter(call=>['audio_load_file','audio_load_and_play'].includes(call.command)).length)
      await page.locator('.cover-collapse-button').first().click()
      await page.waitForFunction(()=>window.viewModel.playlist.isOpen)
      const after=await routeSnapshot(page)
      console.log('RESTART_RETURN',JSON.stringify({kind,route:after.route,current:after.current,queue:after.queue}))
      assert.deepEqual(after.route,kind==='all-songs'?{view:'category',categoryId:'songs'}:{view:'tracks'},kind+': restored cover return follows the saved playback source')
      await page.locator(kind==='all-songs'?'.all-songs-list':'.playlist-panel').waitFor({state:'visible'})
      assert.equal(after.current,before.current)
      assert.deepEqual(after.queue,before.queue)
      assert.equal(await page.evaluate(()=>window.calls.filter(call=>['audio_load_file','audio_load_and_play'].includes(call.command)).length),loadCount,'cover navigation does not reload audio')
      assert.deepEqual(errors,[])
      report.push('restart '+kind+' source cover return')
    } finally {await page.close()}
  }
  {
    const {page,errors}=await open('media-library')
    try {
      await prepareRestartSource(page,'all-songs')
      await page.reload()
      await restartReady(page,'a-0',false)
      assert.deepEqual((await routeSnapshot(page)).route,{view:'overview'},'explicit media-library startup remains the overview')
      await roundTrip(page,'media-library startup remains overview after source restoration')
      assert.deepEqual(errors,[])
    } finally {await page.close()}
  }
  {
    const {page,errors}=await open('player')
    try {
      await prepareRestartSource(page,'all-songs')
      await page.evaluate(()=>sessionStorage.setItem('spmusic.return-test.restore-gate','1'))
      await page.reload()
      await page.waitForFunction(()=>typeof window.releaseRestoreLoad==='function'&&Boolean(window.viewModel))
      // Invoke the real navigation callback while native restoration is blocked;
      // the startup loading surface prevents a literal click at this boundary.
      await page.evaluate(()=>window.viewModel.playlist.library.onSelectCategory('artist'))
      assert.deepEqual((await routeSnapshot(page)).route,{view:'category',categoryId:'artist'})
      await page.evaluate(()=>window.releaseRestoreLoad())
      await restartReady(page,'a-0',false)
      assert.deepEqual((await routeSnapshot(page)).route,{view:'category',categoryId:'artist'},'late restoration cannot replace explicit navigation')
      await roundTrip(page,'explicit artist navigation survives delayed source restoration')
      assert.deepEqual(errors,[])
    } finally {await page.close()}
  }
}

const startupNavigationState = page => page.evaluate(() => {
  const dock=document.querySelector('.control-dock'),next=dock?.querySelector('.next-button'),previous=dock?.querySelector('.previous-button')
  const playback=window.viewModel.playback
  return {route:window.viewModel.playlist.library.route,sourceOpen:window.viewModel.playlist.isOpen,current:playback.track?.id,queue:window.viewModel.queue.tracks.map(track=>track.id),playlistRegistryPending:window.viewModel.playlist.library.isPlaylistRestorePending,audioBusy:playback.isAudioBusy,transportBusy:playback.isTransportBusy,selectionPending:playback.isSelectionPending,detailsPending:playback.detailsPending,interaction:window.viewModel.timeline.interaction,isPlaying:playback.isPlaying,nextDisabled:next?.disabled,previousDisabled:previous?.disabled,dockData:dock?{...dock.dataset}:null,motion:document.documentElement.dataset.motion,systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,loads:window.calls.filter(call=>['audio_load_file','audio_load_and_play'].includes(call.command)).map(call=>({command:call.command,path:call.input.path}))}
})

async function startupNavigationChecks() {
  const registryRace=process.env.SPMUSIC_RETURN_REGISTRY_RACE==='1'
  for(const kind of ['all-songs','playlist']) {
    if(process.env.SPMUSIC_RETURN_NAVIGATION_KIND&&process.env.SPMUSIC_RETURN_NAVIGATION_KIND!==kind)continue
    const {page,errors}=await open('player',1440,{reduced:false,multiPlaylist:true})
    try {
      await prepareRestartSource(page,kind)
      if(registryRace)await page.evaluate(()=>{
        sessionStorage.setItem('spmusic.return-test.registry-gate','1')
        sessionStorage.setItem('spmusic.return-test.restore-gate','1')
      })
      await page.reload()
      if(registryRace) {
        await page.waitForFunction(()=>typeof window.releasePlaylistRegistry==='function')
        await page.evaluate(()=>new Promise(requestAnimationFrame))
        console.log('STARTUP_REGISTRY_SEQUENCE',JSON.stringify({kind,loadStartedBeforeRegistry:await page.evaluate(()=>typeof window.releaseRestoreLoad==='function')}))
        await page.evaluate(()=>window.releasePlaylistRegistry())
        await page.waitForFunction(()=>!window.viewModel.playlist.library.isPlaylistRestorePending)
        await page.waitForFunction(()=>typeof window.releaseRestoreLoad==='function')
        await page.evaluate(()=>window.releaseRestoreLoad())
      }
      await restartReady(page,kind==='all-songs'?'a-0':'c-0')
      const initial=await startupNavigationState(page)
      console.log('STARTUP_NAVIGATION_INITIAL',JSON.stringify({kind,...initial}))
      assert.equal(initial.sourceOpen,false,'source has not been opened after restart')
      assert.equal(initial.systemReduced,false,'exercise default system motion')
      assert.equal(initial.nextDisabled,false,'restored player next button is enabled before opening its source')
      assert.equal(initial.previousDisabled,false,'restored player previous button is enabled before opening its source')
      const nextPath=kind==='all-songs'?'/audio/b/0.flac':'/audio/c/1.flac'
      const previousPath=kind==='all-songs'?'/audio/a/0.flac':'/audio/c/0.flac'
      const before=initial.loads.length
      const previewOnly=process.env.SPMUSIC_RETURN_PREVIEW_ONLY==='1'
      if(previewOnly) {
        const token=await page.evaluate(()=>window.viewModel.playback.onPrepareTrackPreview(1))
        assert(token,'cold restored queue can prepare its adjacent preview')
        assert.equal(token.originTrackId,initial.current)
        assert.equal(token.targetTrackId,kind==='all-songs'?'b-0':'c-1')
        assert.equal(await page.evaluate(id=>window.viewModel.playback.onCommitTrackPreview(id),token.id),true,'cold preview token commits without opening a source')
      } else await page.locator('.control-dock .next-button').click()
      await page.waitForFunction(({before,path})=>window.calls.filter(call=>['audio_load_file','audio_load_and_play'].includes(call.command)).length>before&&window.calls.filter(call=>['audio_load_file','audio_load_and_play'].includes(call.command)).at(-1)?.input.path===path,{before,path:nextPath},{timeout:1500})
      await page.waitForFunction(id=>window.viewModel.playback.track?.id===id&&!window.viewModel.playback.isSelectionPending&&!window.viewModel.playback.isAudioBusy,kind==='all-songs'?'b-0':'c-1')
      if(!previewOnly) {
        await page.locator('.control-dock .previous-button').click()
        await page.waitForFunction(path=>window.calls.filter(call=>['audio_load_file','audio_load_and_play'].includes(call.command)).at(-1)?.input.path===path,previousPath)
        await page.waitForFunction(id=>window.viewModel.playback.track?.id===id&&!window.viewModel.playback.isSelectionPending&&!window.viewModel.playback.isAudioBusy,kind==='all-songs'?'a-0':'c-0')
      }
      assert.equal((await startupNavigationState(page)).sourceOpen,false,'native navigation completed entirely within the restored player')
      await page.locator('.cover-collapse-button').first().click()
      await page.waitForFunction(()=>window.viewModel.playlist.isOpen)
      assert.deepEqual((await routeSnapshot(page)).route,kind==='all-songs'?{view:'category',categoryId:'songs'}:{view:'tracks'})
      assert.deepEqual(errors,[])
      const label='default motion restart '+kind+(previewOnly?' cold preview prepare/commit':' direct next/previous')+' native navigation and source return'
      report.push(label)
      console.log('PASS',label)
    } catch(error) {
      console.log('STARTUP_NAVIGATION_FAILURE',JSON.stringify({kind,...await startupNavigationState(page)}))
      throw error
    } finally {await page.close()}
  }
}

try {
  if(process.env.SPMUSIC_RETURN_STARTUP_NAVIGATION_ONLY==='1')await startupNavigationChecks()
  else {
  if(process.env.SPMUSIC_RETURN_RESTART_ONLY!=='1') {
  const { page, errors } = await open()
  await importChoice(page, 'a')
  await importChoice(page, 'b')
  await importChoice(page, 'c')
  await category(page, 'songs')
  await page.locator('[data-song-key="/audio/a/0.flac"]').click()
  await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isSelectionPending)
  await roundTrip(page, 'all songs after starting playback')
  for (const id of categories) {
    await category(page, id)
    await roundTrip(page, 'category ' + id)
  }
  await page.evaluate(() => window.viewModel.playlist.library.onOpenOverview())
  await roundTrip(page, 'media library overview')
  // The active queue belongs to folder A, while this detail belongs to B.
  await category(page, 'folder')
  await page.getByRole('button', { name: '打开文件夹 Folder b', exact: true }).click()
  await page.waitForFunction(() => window.viewModel.playlist.library.route.view === 'tracks' && window.viewModel.playlist.tracks.some(track => track.id === 'b-0'))
  await roundTrip(page, 'inactive folder detail B while playing A')
  await roundTrip(page, 'same folder detail repeated entry')
  await category(page, 'playlists')
  await page.getByRole('button', { name: '打开播放列表 List c', exact: true }).click()
  await page.waitForFunction(() => window.viewModel.playlist.library.route.view === 'tracks' && window.viewModel.playlist.tracks.some(track => track.id === 'c-0'))
  await roundTrip(page, 'inactive playlist detail C while playing A')
  await category(page, 'album')
  await roundTrip(page, 'category after detail refreshes return destination')
  // The dock's explicit list shortcut has its own active-list meaning.
  // All Songs has no owning folder; establish a real folder source first.
  await page.evaluate(() => window.viewModel.playlist.library.onPlay(window.viewModel.playlist.library.items.find(item=>item.scope.includes('/audio/a')).scope))
  await page.waitForFunction(()=>window.viewModel.playback.track?.id==='a-0'&&!window.viewModel.playback.isSelectionPending&&!window.viewModel.playback.isAudioBusy)
  await page.locator('.playlist-playback-dock .playlist-playback-nav-button').first().click()
  await page.waitForFunction(() => window.viewModel.playlist.library.route.view === 'tracks')
  assert((await routeSnapshot(page)).ids.includes('a-0'), 'explicit playlist shortcut opens active A rather than old browsed C')
  assert.deepEqual(errors, [], 'no React/browser runtime errors')
  await page.close()

  const startup = await open('player')
  await startup.page.evaluate(() => window.viewModel.playback.onOpenAudio())
  await startup.page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isSelectionPending)
  await startup.page.locator('.cover-collapse-button').first().click()
  await startup.page.waitForFunction(() => window.viewModel.playlist.isOpen)
  assert.equal((await routeSnapshot(startup.page)).route.view, 'tracks', 'direct player startup falls back to active list')
  assert((await routeSnapshot(startup.page)).ids.includes('a-0'))
  assert.deepEqual(startup.errors, [])
  report.push('direct player startup falls back to active list; explicit list shortcut opens active list')
  await startup.page.close()

  const compact = await open('media-library', 640)
  await importChoice(compact.page, 'a')
  await compact.page.evaluate(() => {
    const song = window.viewModel.playlist.library.allSongs.find(item => item.trackId === 'a-0')
    window.viewModel.playlist.library.onPlaySong(song.scope, song.trackId)
  })
  await compact.page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isSelectionPending)
  await category(compact.page, 'songs')
  await roundTrip(compact.page, 'compact all songs')
  await category(compact.page, 'artist')
  await roundTrip(compact.page, 'compact artist')
  assert.deepEqual(compact.errors, [])
  await compact.page.close()
  }
  await restartChecks()
  }
  console.log(JSON.stringify({ passed: true, baselineRef: baselineRef ?? null, browser: browser.version(), report }, null, 2))
} finally {
  await browser.close()
}
