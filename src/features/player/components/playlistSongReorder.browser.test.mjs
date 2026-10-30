// Vite + SPMUSIC_PLAYWRIGHT. Real React parents and drag hook; only native IO is
// deterministic. Rust registry tests independently exercise atomic persistence.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const evidenceDirectory = join(tmpdir(), 'spmusic-song-reorder-verification')
mkdirSync(evidenceDirectory, { recursive: true })
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const dependency = name => {
  const match = (entry + realSurface).match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const shared = readFileSync(new URL('./allSongs.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal)
let fixture = runInNewContext(literal[1], { dependency })
fixture = fixture.replace('length:50', 'length:(window.seedCount??20)')
fixture = fixture.replace('const title=id=>names[id]??', "const title=id=>id.startsWith('many-')?(window.alternatingTitles?(Number(id.slice(5))%2?'match ':'other '):'Song ')+id.slice(5).padStart(4,'0'):names[id]??")
fixture = fixture.replace('coverArt:null}}};', "coverArt:row.sourcePath.startsWith('/audio/many/')?{mimeType:'image/png',filePath:'/covers/'+row.id+'.png',dataUrl:null,byteLen:64}:null}}};")
fixture = fixture.replace("command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels'", "command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels'||command==='audio_load_cover_pixels'")
fixture = fixture.replace("if(command==='audio_load_playlist_cover_pixels'&&!input.filePath.startsWith('/covers/many-'))", "if((command==='audio_load_playlist_cover_pixels'||command==='audio_load_cover_pixels')&&!input.filePath.startsWith('/covers/many-'))")
fixture = fixture.replace('React.createElement(PlayerShell)', 'React.createElement(ThemeProbe)')
fixture += `
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
function ThemeProbe(){const theme=useAppearance();window.themeApi=theme;return React.createElement(PlayerShell)}
`
const marker = "ReactDOM.createRoot(document.getElementById('root')).render("
assert(fixture.includes(marker))
fixture = fixture.replace(marker, `
window.choice='many';window.playlistImport=true;
window.persistedPlaylists=window.seedRegistered?[playlist()]:[];
window.choice='many';window.playlistImport=false;
window.savedLibraryFolders=window.seedFolders??[];
window.folderSettings={revision:0,roots:window.savedLibraryFolders.map(path=>({path,selected:true,directoryRules:[]}))};
window.reorderRecords=[];window.reorderFail=null;window.reorderGate=false;window.reorderResolvers=[];
window.replaceRegistryOrder=ids=>{window.persistedPlaylists=window.persistedPlaylists.map(list=>({...list,tracks:ids.map(id=>list.tracks.find(track=>track.id===id))}))};
const originalInvoke=window.backendInvoke;
window.backendInvoke=async(command,args)=>{
 if(command==='library_get_playlists')return window.persistedPlaylists;
 if(command==='library_get_folders')return structuredClone(window.folderSettings);
 if(command==='library_replace_folders'){
  if(args.input.expectedRevision!==window.folderSettings.revision)throw {code:'LIBRARY_SETTINGS_CONFLICT',message:'fixture revision conflict'};
  window.folderSettings={revision:window.folderSettings.revision+1,roots:structuredClone(args.input.roots)};
  return structuredClone(window.folderSettings);
 }
 if(command!=='library_reorder_playlist_tracks')return originalInvoke(command,args);
 const input=args.input;window.reorderRecords.push(structuredClone(input));
 if(window.reorderGate)await new Promise(resolve=>window.reorderResolvers.push(resolve));
 if(window.reorderFail)throw {code:window.reorderFail,message:'fixture reorder failed'};
 const target=window.persistedPlaylists.find(item=>item.sourcePath===input.sourcePath);
 if(!target)throw {code:'LIBRARY_INVALID_INPUT',message:'fixture target missing'};
 const actual=target.tracks.map(item=>item.sourcePath);
 if(JSON.stringify(actual)!==JSON.stringify(input.expectedTrackPaths))throw {code:'PLAYLIST_ORDER_CHANGED',message:'列表已更改，请重新拖动排序'};
 if(input.orderedTrackPaths.length!==actual.length||new Set(input.orderedTrackPaths).size!==actual.length||input.orderedTrackPaths.some(path=>!actual.includes(path)))throw {code:'LIBRARY_INVALID_INPUT',message:'fixture invalid order'};
 const byPath=new Map(target.tracks.map(item=>[item.sourcePath,item]));
 const next={...target,tracks:input.orderedTrackPaths.map(path=>byPath.get(path)),selectedIndex:0};
 window.persistedPlaylists=window.persistedPlaylists.map(item=>item===target?next:item);
 return next;
};
${marker}`)
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const surface = `
import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__song_reorder_surface.js';
window.reorderRenderMeters={surface:0,playlist:0,songs:0,card:0};window.artworkMeter={retains:0,releases:0};const stores=new WeakSet();
function observe(source){const store=source?.store;if(!store||stores.has(store))return;stores.add(store);const retain=store.retain;store.retain=(...args)=>{window.artworkMeter.retains++;const release=retain(...args);return()=>{window.artworkMeter.releases++;release()}};}
export function PlayerSurface(props){window.reorderRenderMeters.surface++;window.viewModel=props.viewModel;observe(props.viewModel.playlist.artworkSource);observe(props.viewModel.playlist.fallbackArtworkSource);return React.createElement(Surface,props)}
`
const counted = async (path, name, counter) => {
  const source = await (await fetch(origin + path)).text()
  const pattern = new RegExp('(function ' + name + '\\([^\\n]+\\) \\{)')
  const result = source.replace(pattern, '$1 window.reorderRenderMeters.' + counter + '++;')
  assert.notEqual(result, source, 'instrument real ' + name)
  return result
}
const countedPanel = await counted('/src/features/player/components/PlaylistPanel.tsx', 'PlaylistPanel', 'playlist')
const countedSongs = await counted('/src/features/player/components/PlaylistLibraryPanel.tsx', 'PlaylistLibraryPanel', 'songs')
const countedCard = await counted('/src/features/player/components/PlaylistCard.tsx', 'PlaylistCard', 'card')
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__song_reorder_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
let passed = 0

async function open({ kind='playlist', level=4, registered=true, reducedMotion='reduce', alternating=false, seedManual, seededFolders=false, count=20, query }={}) {
  const page=await browser.newPage({viewport:{width:1280,height:1000},hasTouch:true,reducedMotion})
  page.setDefaultTimeout(8000)
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(({level,registered,alternating,seedManual,seededFolders,count})=>{
    window.seedRegistered=registered;window.seedCount=count;window.alternatingTitles=alternating;window.seedFolders=seededFolders?['/audio/many']:[]
    localStorage.setItem('spmusic.playlist.layout-level.v1',String(level));localStorage.setItem('spmusic.all-songs.layout-level.v1',String(level))
    if(seedManual!==undefined)localStorage.setItem('spmusic.song-manual-order.v1',seedManual)
    const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(window.manualStorageFailure&&key==='spmusic.song-manual-order.v1')throw new DOMException('fixture quota','QuotaExceededError');return set.call(this,key,value)}
  },{level,registered,alternating,seedManual,seededFolders,count})
  await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}))
  await page.route('**/src/features/player/components/PlaylistPanel.tsx*',route=>route.fulfill({contentType:'text/javascript',body:countedPanel}))
  await page.route('**/src/features/player/components/PlaylistLibraryPanel.tsx*',route=>route.fulfill({contentType:'text/javascript',body:countedSongs}))
  await page.route('**/src/features/player/components/PlaylistCard.tsx*',route=>route.fulfill({contentType:'text/javascript',body:countedCard}))
  await page.route('**/__song_reorder_surface.js',route=>route.fulfill({contentType:'text/javascript',body:realSurface}))
  await page.route('**/__song_reorder_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__song_reorder_test',route=>route.fulfill({contentType:'text/html',body:html}))
  await page.goto(origin+'/__song_reorder_test')
  await page.waitForFunction(()=>Boolean(window.viewModel?.folderSelection?.committed&&window.themeApi)&&!window.viewModel.playlist.library.isPlaylistRestorePending&&!window.viewModel.playlist.library.isFolderRestorePending)
  if(!registered||kind==='songs'){
    await page.evaluate(async()=>{const editor=window.viewModel.folderSelection;const current=editor.committed;
      if(!current.roots.some(root=>root.path==='/audio/many'))await editor.onSave({expectedRevision:current.revision,
        roots:[...current.roots,{path:'/audio/many',selected:true,directoryRules:[]}]})})
    await page.waitForFunction(()=>!window.viewModel.playlist.library.isImportPending)
  }
  await page.evaluate(({kind,registered})=>{
    if(kind==='songs')window.viewModel.playlist.library.onSelectCategory('songs')
    else window.viewModel.playlist.library.onSelect(window.viewModel.playlist.library.items.find(item=>registered?item.sourceKind==='m3u8':item.sourceKind==='folder').scope)
  },{kind,registered})
  const grid=page.locator(kind==='songs'?'.all-songs-list':'.playlist-grid:not(.all-songs-list)')
  const panel=page.locator(kind==='songs'?'.playlist-management-content':'.playlist-panel')
  await grid.locator('.playlist-card').first().waitFor()
  if(query){await page.locator('.playlist-search-button').first().click();await page.getByRole('textbox',{name:'搜索歌名或歌手',exact:true}).fill(query);await page.waitForFunction(()=>document.querySelectorAll('.playlist-grid .playlist-card').length===10)}
  await page.getByRole('button',{name:'选择',exact:true}).first().click()
  await grid.locator('.playlist-card[data-select-mode="true"]').first().waitFor()
  await panel.evaluate(element=>element.scrollTop+=Math.max(0,element.querySelector('.playlist-card').getBoundingClientRect().top-element.getBoundingClientRect().top-24))
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  return {page,grid,panel,errors,kind,registered}
}
const cards=context=>context.grid.locator('.playlist-card')
const overlay=page=>page.locator('.playlist-reorder-overlay')
const keys=context=>context.page.evaluate(kind=>kind==='songs'?window.viewModel.playlist.library.allSongs.map(item=>item.key):window.viewModel.playlist.tracks.map(item=>item.id),context.kind)
async function point(locator){const box=await locator.boundingBox();assert(box);return{x:box.x+box.width/2,y:box.y+box.height/2}}
async function start(context,index=0){const handle=cards(context).nth(index).locator('[data-reorder-handle]:visible').first();const p=await point(handle);await context.page.mouse.move(p.x,p.y);await context.page.mouse.down();await context.page.mouse.move(p.x+6,p.y+2);try{await overlay(context.page).waitFor()}catch(error){console.error('START_DIAGNOSTIC',await context.page.evaluate(p=>({hit:document.elementFromPoint(p.x,p.y)?.outerHTML,grids:[...document.querySelectorAll('.playlist-grid')].map(x=>({html:x.outerHTML.slice(0,600),phase:x.dataset.reorderPhase})),busy:window.viewModel.playlist.isDeletePending,disabled:window.viewModel.playlist.isOpenAudioDisabled,errors:window.testErrors}),p),context.errors);await context.page.screenshot({path:join(evidenceDirectory,'failed-start.png')});throw error}return p}
async function finish(context){await context.page.mouse.up();await overlay(context.page).waitFor({state:'hidden'});await context.page.waitForFunction(()=>!document.querySelector('[data-reordering="true"]'))}
async function moveTo(context,index){const p=await point(cards(context).nth(index));await context.page.mouse.move(p.x,p.y,{steps:8});await context.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function check(name,options,run){if(process.env.SPMUSIC_REORDER_FILTER&&!name.includes(process.env.SPMUSIC_REORDER_FILTER))return;const context=await open(options);try{await run(context);assert.deepEqual(context.errors,[]);passed++;console.log('PASS',name)}finally{await context.page.close()}}

try {
  for(const level of [0,1,2,3,4,5,6,7,8,9])await check('playlist layout '+level+' commits a single held song and keeps selection', {level}, async context=>{
    await cards(context).nth(1).click();await cards(context).nth(3).click()
    await context.page.waitForFunction(()=>document.querySelectorAll('.playlist-card[data-selected="true"]').length===2)
    const before=await keys(context);const selected=await cards(context).filter({has:context.page.locator('[data-reorder-handle]')}).evaluateAll(rows=>rows.filter(row=>row.dataset.selected==='true').map(row=>row.dataset.playlistTrackId))
    await start(context);await moveTo(context,2);await finish(context)
    const after=await keys(context)
    assert.deepEqual(after.slice(0,3),[before[1],before[2],before[0]])
    assert.deepEqual(after.slice(3),before.slice(3))
    const records=await context.page.evaluate(()=>window.reorderRecords)
    assert.equal(records.length,1)
    assert.deepEqual(records[0].expectedTrackPaths.slice(0,3),['/audio/many/0.flac','/audio/many/1.flac','/audio/many/2.flac'])
    const selectedAfter=await cards(context).evaluateAll(rows=>rows.filter(row=>row.dataset.selected==='true').map(row=>row.dataset.playlistTrackId))
    assert.deepEqual(new Set(selectedAfter),new Set(selected))
    assert.equal(await context.page.evaluate(()=>window.calls.filter(call=>call.command==='audio_load_and_play').length),0)
  })
  for(const level of [0,1,4,7,9])await check('group layout '+level+' collapses one slot and expands in source order', {level}, async context=>{
    const before=await keys(context)
    await context.grid.evaluate(grid=>{for(const i of [4,0,2])grid.querySelectorAll('.playlist-card')[i].click()})
    await start(context,2)
    await context.page.waitForFunction(()=>document.querySelector('.playlist-grid').querySelectorAll('.playlist-card').length===18)
    assert.equal(await overlay(context.page).count(),1)
    assert.equal(await overlay(context.page).locator('.playlist-reorder-count').textContent(),'项目：3')
    await moveTo(context,3)
    await context.page.screenshot({path:join(evidenceDirectory,`group-${level}-dragging.png`)})
    await finish(context)
    const after=await keys(context), moved=[before[0],before[2],before[4]], rest=before.filter(key=>!moved.includes(key))
    assert.deepEqual(after,[...rest.slice(0,3),...moved,...rest.slice(3)])
    assert.deepEqual(await cards(context).evaluateAll(rows=>rows.filter(row=>row.dataset.selected==='true').map(row=>row.dataset.playlistTrackId)),moved)
    assert.equal((await context.page.evaluate(()=>window.reorderRecords)).length,1)
  })
  for(const reason of ['Escape','blur','resize','pointercancel'])await check('cancel '+reason+' restores order and selection without writing',{},async context=>{
    const before=await keys(context)
    await start(context);await moveTo(context,2)
    if(reason==='Escape')await context.page.keyboard.press('Escape')
    else if(reason==='resize')await context.page.setViewportSize({width:1200,height:1000})
    else await context.page.evaluate(reason=>window.dispatchEvent(reason==='pointercancel'?new PointerEvent('pointercancel',{pointerId:1}):new Event(reason)),reason)
    await context.page.mouse.up();await overlay(context.page).waitFor({state:'hidden'})
    assert.deepEqual(await keys(context),before)
    assert.equal((await context.page.evaluate(()=>window.reorderRecords)).length,0)
    await cards(context).first().click()
    assert.equal(await cards(context).first().getAttribute('data-selected'),'true','next ordinary pointer click still toggles selection')
  })
  await check('native touch handle drag does not scroll or toggle a card',{},async context=>{
    await context.page.evaluate(()=>{window.touchTrace=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','touchstart','touchmove'])window.addEventListener(type,event=>window.touchTrace.push({type,id:event.pointerId,x:event.clientX,y:event.clientY,target:event.target?.className?.baseVal??event.target?.className,phase:document.querySelector('.playlist-grid')?.dataset.reorderPhase}),true)})
    const before=await keys(context),from=await point(cards(context).first().locator('[data-reorder-handle]:visible').first()),to=await point(cards(context).nth(2))
    const touch=await context.page.context().newCDPSession(context.page)
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x,y:from.y}]})
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+8,y:from.y}]})
    await overlay(context.page).waitFor()
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:to.x,y:to.y}]})
    await context.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await overlay(context.page).waitFor({state:'hidden'})
    const after=await keys(context)
    if(after[0]===before[0])console.error('TOUCH_DIAGNOSTIC',await context.page.evaluate(()=>({trace:window.touchTrace,records:window.reorderRecords})))
    assert.deepEqual(after.slice(0,3),[before[1],before[2],before[0]])
    assert.equal(await cards(context).filter({has:context.page.locator('[data-reorder-handle]')}).evaluateAll(rows=>rows.filter(row=>row.dataset.selected==='true').length),0)
    await touch.detach()
  })
  await check('filtered drag preserves every hidden source slot',{alternating:true,query:'match'},async context=>{
    const before=await keys(context)
    await start(context);await moveTo(context,2);await finish(context)
    const after=await keys(context)
    assert.deepEqual(after.filter((_,i)=>i%2===0),before.filter((_,i)=>i%2===0))
    assert.deepEqual(after.filter((_,i)=>i%2===1).slice(0,3),[before[3],before[5],before[1]])
  })
  await check('registered conflict refreshes authoritative order and permits a fresh retry',{},async context=>{
    const before=await keys(context)
    await context.page.evaluate(ids=>{window.replaceRegistryOrder([...ids].reverse());window.reorderFail='PLAYLIST_ORDER_CHANGED'},before)
    await start(context);await moveTo(context,2);await finish(context)
    assert.deepEqual(await keys(context),[...before].reverse())
    assert.equal((await context.page.evaluate(()=>window.reorderRecords)).length,1)
    await context.page.evaluate(()=>window.reorderFail=null)
    await start(context);await moveTo(context,2);await finish(context)
    assert.deepEqual((await keys(context)).slice(0,3),[before.at(-2),before.at(-3),before.at(-1)])
    assert.equal((await context.page.evaluate(()=>window.reorderRecords)).length,2)
  })
  await check('folder storage failure rolls back without changing persisted order',{registered:false},async context=>{
    const before=await keys(context)
    await context.page.evaluate(()=>window.manualStorageFailure=true)
    await start(context);await moveTo(context,2);await finish(context)
    assert.deepEqual(await keys(context),before)
    assert.equal(await context.page.evaluate(()=>localStorage.getItem('spmusic.song-manual-order.v1')),null)
    assert.equal((await context.page.evaluate(()=>window.reorderRecords)).length,0)
  })
  await check('folder manual order survives a real page reload and rescan',{registered:false,seededFolders:true},async context=>{
    const before=await keys(context)
    await start(context);await moveTo(context,2);await finish(context)
    const expected=[before[1],before[2],before[0],...before.slice(3)]
    assert.deepEqual(await keys(context),expected)
    await context.page.reload()
    await context.page.waitForFunction(()=>window.viewModel?.playlist.library.items.some(item=>item.sourceKind==='folder')&&!window.viewModel.playlist.library.isImportPending)
    await context.page.evaluate(()=>window.viewModel.playlist.library.onSelect(window.viewModel.playlist.library.items.find(item=>item.sourceKind==='folder').scope))
    await context.grid.locator('.playlist-card').first().waitFor()
    assert.deepEqual(await keys(context),expected)
  })
  await check('virtual all songs group autoscroll keeps one decoded overlay and bounded work',{kind:'songs',registered:false,count:1000},async context=>{
    const before=await keys(context)
    await context.grid.evaluate(grid=>{for(const i of [0,2,4])grid.querySelectorAll('.playlist-card')[i].click()})
    await start(context,2)
    const image=overlay(context.page).locator('img').first()
    await image.evaluate(image=>image.decode())
    const source=await image.getAttribute('src')
    assert(source?.startsWith('blob:'))
    const top=await context.panel.evaluate(panel=>panel.scrollTop)
    const dock=await context.page.locator('.playlist-selection-panel').boundingBox()
    await context.page.mouse.move(1200,dock.y-2)
    await context.page.waitForFunction(top=>document.querySelector('.playlist-management-content').scrollTop>top+20,top)
    await context.page.mouse.wheel(0,12000)
    await context.page.waitForFunction(()=>Number(document.querySelector('.all-songs-list .playlist-card').dataset.songKey.match(/(\d+)\.flac$/)[1])>20)
    assert(await cards(context).count()<80,'virtual group preview keeps a bounded DOM')
    assert.equal(await overlay(context.page).count(),1)
    assert.equal(await image.getAttribute('src'),source)
    const pixel=await image.evaluate(image=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.drawImage(image,0,0,1,1);return [...x.getImageData(0,0,1,1).data]})
    assert.deepEqual(pixel,[255,0,0,255])
    const renders=await context.page.evaluate(()=>({...window.reorderRenderMeters}))
    await context.page.mouse.move(1200,400)
    await context.page.waitForTimeout(100)
    const stationary=await context.page.evaluate(()=>({...window.reorderRenderMeters}))
    assert(stationary.surface-renders.surface<5,'stationary pointer RAF does not render the whole player')
    await finish(context)
    const after=await keys(context),group=[before[0],before[2],before[4]],index=after.indexOf(group[0])
    assert.deepEqual(after.slice(index,index+3),group)
    assert.deepEqual(after.filter(key=>!group.includes(key)),before.filter(key=>!group.includes(key)))
    assert.equal((await context.page.evaluate(()=>JSON.parse(localStorage.getItem('spmusic.song-manual-order.v1')).orders.find(x=>x.scope===null).paths.length)),1000)
  })
  await check('reorder leaves the independent playing queue and audio generation intact',{},async context=>{
    await context.page.evaluate(()=>window.viewModel.playlist.library.onPlay(window.viewModel.playlist.library.items[0].scope))
    await context.page.waitForFunction(()=>window.viewModel.playback.track?.id==='many-0'&&!window.viewModel.playback.isSelectionPending&&!window.viewModel.playback.isAudioBusy)
    const before=await context.page.evaluate(()=>({track:window.viewModel.playback.track.id,queue:window.viewModel.queue.tracks.map(x=>x.id),loads:window.calls.filter(x=>x.command==='audio_load_and_play').length}))
    await start(context);await moveTo(context,2);await finish(context)
    const after=await context.page.evaluate(()=>({track:window.viewModel.playback.track.id,queue:window.viewModel.queue.tracks.map(x=>x.id),loads:window.calls.filter(x=>x.command==='audio_load_and_play').length}))
    assert.deepEqual(after,before)
  })
  await check('turning motion off after lift snaps the active ghost immediately',{reducedMotion:'no-preference'},async context=>{
    await start(context)
    await context.page.waitForTimeout(180)
    assert((await overlay(context.page).locator('.playlist-card').evaluate(card=>new DOMMatrix(getComputedStyle(card).transform).a))>1.04)
    await context.page.evaluate(()=>{const theme=structuredClone(window.themeApi.appearance);theme.motion.level='off';window.themeApi.previewAppearance(theme)})
    await context.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    assert.equal(await overlay(context.page).locator('.playlist-card').evaluate(card=>new DOMMatrix(getComputedStyle(card).transform).a),1)
    await context.page.keyboard.press('Escape');await context.page.mouse.up();await overlay(context.page).waitFor({state:'hidden'})
  })
  await check('group release keeps neighbor unfolding animated and settles the grabbed member offset',{reducedMotion:'no-preference'},async context=>{
    await context.page.evaluate(()=>{window.phaseTrace=[];new MutationObserver(()=>window.phaseTrace.push(document.querySelector('.playlist-grid')?.dataset.reorderPhase)).observe(document.querySelector('.playlist-grid'),{attributes:true,attributeFilter:['data-reorder-phase']})})
    await context.grid.evaluate(grid=>{for(const i of [0,2,4])grid.querySelectorAll('.playlist-card')[i].click()})
    await start(context,2);await moveTo(context,3)
    await context.page.mouse.up()
    try{await context.page.waitForFunction(()=>document.querySelector('.playlist-grid')?.dataset.reorderPhase==='settling')}catch(error){console.error('SETTLE_DIAGNOSTIC',await context.page.evaluate(()=>({phases:window.phaseTrace,reason:document.querySelector('.playlist-grid')?.dataset.reorderCancelReason,records:window.reorderRecords,keys:window.viewModel.playlist.tracks.map(x=>x.id),motion:document.querySelector('.spmusic-app')?.dataset.motion,overlays:document.querySelectorAll('.playlist-reorder-overlay').length})));throw error}
    await context.page.waitForTimeout(35)
    const unfolding=await context.grid.evaluate(grid=>[...grid.querySelectorAll('.playlist-card')].flatMap(card=>card.getAnimations()).filter(animation=>animation.playState==='running'&&animation.effect.getKeyframes().some(frame=>'translate'in frame)).length)
    assert(unfolding>0,'release does not cancel the neighbor FLIP after its first frame')
    await overlay(context.page).waitFor({state:'hidden'})
    const after=await keys(context),first=after.indexOf('many-0')
    assert.deepEqual(after.slice(first,first+3),['many-0','many-2','many-4'])
  })
  await check('dark group badge uses the captured app theme and geometry changes cancel',{},async context=>{
    await context.page.evaluate(()=>{window.themeApi.setColorSchemePreference('dark');const theme=structuredClone(window.themeApi.appearance);theme.colorSchemes.dark.playerDock='#123456';window.themeApi.previewAppearance(theme)})
    await context.grid.evaluate(grid=>{for(const i of [0,2,4])grid.querySelectorAll('.playlist-card')[i].click()})
    await start(context,2)
    assert.equal(await overlay(context.page).locator('.playlist-reorder-count').evaluate(pill=>getComputedStyle(pill).backgroundColor),'rgb(18, 52, 86)')
    await context.page.evaluate(()=>{const theme=structuredClone(window.themeApi.appearance);theme.typography.fontScale=1.2;window.themeApi.previewAppearance(theme)})
    await overlay(context.page).waitFor({state:'hidden'});await context.page.mouse.up()
    assert.equal((await context.page.evaluate(()=>window.reorderRecords)).length,0)
  })
  await check('all songs manual order survives restart instead of being alphabetically reset',{kind:'songs',registered:false,seededFolders:true},async context=>{
    const before=await keys(context)
    await start(context);await moveTo(context,2);await finish(context)
    const expected=[before[1],before[2],before[0],...before.slice(3)]
    assert.deepEqual(await keys(context),expected)
    await context.page.reload()
    await context.page.waitForFunction(()=>window.viewModel?.playlist.library.allSongs?.length===20&&!window.viewModel.playlist.library.isImportPending)
    await context.page.evaluate(()=>window.viewModel.playlist.library.onSelectCategory('songs'))
    await context.grid.locator('.playlist-card').first().waitFor()
    assert.deepEqual(await keys(context),expected)
    assert.equal(await cards(context).first().getAttribute('data-song-key'),expected[0])
  })
  console.log('SONG_REORDER_REGRESSION_PASS',passed)
  writeFileSync(join(evidenceDirectory,process.env.SPMUSIC_REORDER_FILTER?'result-filter.json':'result.json'),JSON.stringify({passed,filter:process.env.SPMUSIC_REORDER_FILTER??null},null,2))
} finally {await browser.close()}
