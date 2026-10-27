// Real PlayerShell / menu / hook; only the native command transport is controlled.
// Run with Vite at SPMUSIC_TEST_ORIGIN (default http://127.0.0.1:5173).
import assert from 'node:assert/strict'
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'

const require=createRequire(import.meta.url),{chromium}=require(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match);return match[1]}
const shared=readFileSync(new URL('./folderHierarchy.browser.test.mjs',import.meta.url),'utf8')
const literal=shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/);assert(literal)
let fixture=runInNewContext(literal[1],{dependency})
fixture=fixture.replace("ReactDOM.createRoot(document.getElementById('root')).render(",`
const query=new URLSearchParams(location.search);
roots.splice(0,roots.length,...(query.has('empty')?[]:query.has('mixedRoots')?['/music','/empty','/missing','/music-else']:['/music','/music-else']));
window.scanGate=false;window.holdScans=query.has('restoreGate');window.testPendingScans=[];window.holdPicker=false;window.pendingPickers=[];
window.requests=[];window.scanFailures=[];window.descriptorVersion=0;window.summaryLabel='Initial';window.completedScans=0;
const invokeOriginal=window.backendInvoke;
window.backendInvoke=async(command,args)=>{
 window.requests.push({command,args});
 if(command==='library_select_folders')return window.holdPicker?await new Promise(resolve=>window.pendingPickers.push(resolve)):window.folderSelection??null;
 if(command==='library_add_folder'){if(!roots.includes(args.path))roots.push(args.path);return {folders:[...roots]};}
 if(command==='library_clear_folders'&&window.clearFailure)throw {code:'LIBRARY_STORAGE_ERROR',message:'Controlled clear failure',recoverable:true};
 if(command==='audio_import_playlist')return null;
 if(command==='library_scan_folder'){
  const version=window.descriptorVersion,fail=window.scanFailures.includes(args.path);
  if(window.holdScans)await new Promise(resolve=>window.testPendingScans.push({path:args.path,resolve}));
  if(fail)throw {code:'FILE_NOT_FOUND',message:'Controlled rescan failure '+args.path,recoverable:true};
  const result=await invokeOriginal(command,args);
  if(version&&args.path==='/music'){
   const added=descriptor(['new','/music/new.flac']);all.set(added.sourcePath,added);
   result.tracks=[...result.tracks.filter(row=>row.id!=='root2'),added];
  }
  window.completedScans++;return result;
 }
 const result=await invokeOriginal(command,args);
 if(command==='audio_probe_playlist_track_summaries')return result.map(row=>({...row,summary:{...row.summary,title:window.summaryLabel+' '+row.summary.title}}));
 return result;
};
window.testRoot=ReactDOM.createRoot(document.getElementById('root'));window.testRoot.render(`)
assert(fixture.includes('window.testRoot.render'))
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text())
 .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
 .replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const realSurface=await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()
const surface=`import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface}from '/__folder_root_menu_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;return React.createElement(RealSurface,props)}`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__folder_root_menu_fixture.js"')
const directory=process.env.SPMUSIC_TEST_SCREENSHOTS||'C:/Users/winkeses/.codex/tmp/folder-root-menu-independent'
mkdirSync(directory,{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'}),errors=[],evidence=[]
async function open(query='',width=1280,height=900){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.setDefaultTimeout(12000)
 page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem('folder-root-test-initialized')){localStorage.clear();localStorage.setItem('spmusic.player.startup-page.v1','media-library');sessionStorage.setItem('folder-root-test-initialized','1')}
  if(new URLSearchParams(location.search).has('storageWriteFail')){const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='spmusic.library.sidebar.folders-pinned.v1')throw new Error('Controlled quota failure');return original.call(this,key,value)}}
 })
 await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
 await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}))
 await page.route('**/__folder_root_menu_surface.js',route=>route.fulfill({contentType:'text/javascript',body:realSurface}))
 await page.route('**/__folder_root_menu_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
 await page.route('**/__folder_root_menu_test*',route=>route.fulfill({contentType:'text/html',body:html}))
 await page.goto(origin+'/__folder_root_menu_test'+query)
 await page.waitForFunction(()=>window.vm?.playlist.library)
 return page
}
const settle=page=>page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})
const ready=page=>page.waitForFunction(()=>!window.vm.playlist.library.isFolderRestorePending&&!window.vm.playlist.library.isImportPending)
const rescanDone=page=>page.waitForFunction(()=>!window.vm.playlist.library.isFolderRescanPending)
const requests=page=>page.evaluate(()=>window.requests)
const count=(calls,command)=>calls.filter(call=>call.command===command).length
const songIds=page=>page.evaluate(()=>window.vm.playlist.library.allSongs.map(row=>row.trackId))
const queueIds=page=>page.evaluate(()=>window.vm.queue.tracks.map(row=>row.id))
const selectFoldersPage=async page=>{await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('folders'));await page.getByRole('button',{name:'更多文件夹操作',exact:true}).waitFor()}
async function releaseScans(page){
 await page.evaluate(()=>{window.holdScans=false;window.testPendingScans.splice(0).forEach(job=>job.resolve())});await settle(page)
}
function assertNoPlaybackOrRegistry(calls){
 for(const command of ['library_select_folders','library_add_folder','audio_open_source','audio_load_file','audio_load_and_play','audio_hydrate_track'])assert.equal(count(calls,command),0,`rescan never invokes ${command}`)
}

try{
 // Rescan the exact selected roots, not a new picker or playback source.
 const page=await open();await ready(page)
 await page.waitForFunction(()=>window.requests.filter(call=>call.command==='library_warm_cover_thumbnails').length===2)
 await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('songs'))
 await page.waitForFunction(()=>window.vm.playlist.library.allSongsMetadataStatus==='ready')
 const initialQueueEntries=await page.evaluate(()=>window.vm.playlist.library.allSongs.filter(row=>row.sourcePath.startsWith('/music/')).map(({scope,trackId})=>({scope,trackId})))
 await page.evaluate(entries=>window.vm.playlist.library.onPlaySong(entries[0].scope,entries[0].trackId,entries),initialQueueEntries)
 await page.waitForFunction(()=>window.vm.playback.track?.id==='root'&&!window.vm.playback.isAudioBusy)
 await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('songs'))
 const queueBefore=await queueIds(page)
 await page.evaluate(()=>{window.requests=[];window.holdScans=true;window.summaryLabel='Updated';window.vm.playlist.library.onRescanFolders();window.vm.playlist.library.onRescanFolders();window.vm.playlist.library.onSelectFolders();window.vm.playlist.library.onImportPlaylist()})
 await page.waitForFunction(()=>window.vm.playlist.library.isFolderRescanPending&&window.testPendingScans.length>0)
 assertNoPlaybackOrRegistry(await requests(page))
 await releaseScans(page);await rescanDone(page)
 await page.waitForFunction(()=>window.vm.playlist.library.allSongs.some(row=>row.track.title==='Updated Title other'))
 let calls=await requests(page)
 assert.deepEqual(calls.filter(call=>call.command==='library_scan_folder').map(call=>call.args.path).sort(),['/music','/music-else'])
 assertNoPlaybackOrRegistry(calls)
 assert.deepEqual(await queueIds(page),queueBefore,'same-descriptor rescan preserves the playback snapshot')
 await page.waitForFunction(()=>window.requests.filter(call=>call.command==='library_warm_cover_thumbnails').length===2)
 // A changed library descriptor set must not change an already selected queue.
 await page.evaluate(()=>{window.requests=[];window.descriptorVersion=1;window.vm.playlist.library.onRescanFolders()})
 await rescanDone(page)
 await page.waitForFunction(()=>window.vm.playlist.library.allSongs.some(row=>row.trackId==='new'))
 assert(!(await songIds(page)).includes('root2'))
 assert.deepEqual(await queueIds(page),queueBefore,'added/deleted library songs do not rebuild the active queue')
 assertNoPlaybackOrRegistry(await requests(page))
 assert.equal(await page.evaluate(()=>window.vm.playback.track.id),'root')
 await page.waitForFunction(()=>window.requests.filter(call=>call.command==='library_warm_cover_thumbnails').length===2)
 evidence.push({scenario:'singleflight-refresh-and-queue',queueBefore,libraryAfter:await songIds(page)})
 // One failing selected root cannot prevent another root from refreshing.
 await page.evaluate(()=>{window.requests=[];window.scanFailures=['/music'];window.summaryLabel='Partial';window.vm.playlist.library.onRescanFolders()})
 await rescanDone(page)
 await page.waitForFunction(()=>Boolean(window.settings.errors['/music']))
 await page.waitForFunction(()=>window.vm.playlist.library.allSongs.some(row=>row.track.title==='Partial Title other'))
 assert.deepEqual((await requests(page)).filter(call=>call.command==='library_scan_folder').map(call=>call.args.path).sort(),['/music','/music-else'])
 assert((await songIds(page)).includes('root'),'failed rescan retains the prior successful source')
 assertNoPlaybackOrRegistry(await requests(page))
 await page.waitForFunction(()=>window.requests.filter(call=>call.command==='library_warm_cover_thumbnails').length===1)
 // Import and rescan are mutually exclusive even through direct VM callbacks.
 await page.evaluate(()=>{window.requests=[];window.holdPicker=true;window.savedRescan=window.vm.playlist.library.onRescanFolders;window.vm.playlist.library.onSelectFolders()})
 await page.waitForFunction(()=>window.pendingPickers.length===1)
 await page.evaluate(()=>window.savedRescan());await settle(page)
 assert.equal(count(await requests(page),'library_scan_folder'),0)
 await page.evaluate(()=>window.pendingPickers.splice(0).forEach(resolve=>resolve(null)));await ready(page)
 // Clear changes the library epoch; old success and old errors stay discarded.
 await page.evaluate(()=>{window.requests=[];window.holdScans=true;window.vm.playlist.library.onRescanFolders()})
 await page.waitForFunction(()=>window.testPendingScans.length>0)
 await page.evaluate(()=>window.settings.onClear())
 await page.waitForFunction(()=>window.vm.playlist.library.folderRoots.length===0)
 await releaseScans(page);await rescanDone(page)
 assert.deepEqual(await songIds(page),[])
 assert.deepEqual(await page.evaluate(()=>window.settings.errors),{})
 assert.deepEqual(await queueIds(page),queueBefore,'clearing library while rescanning leaves the playback snapshot intact')
 assert.equal(await page.evaluate(()=>window.vm.playback.track.id),'root')
 assert.equal(count(await requests(page),'library_warm_cover_thumbnails'),0,'late rescan results cannot enqueue warmup after clear')
 evidence.push({scenario:'partial-failure-import-clear',passed:true})
 await page.close()

 const restore=await open('?restoreGate=1')
 await restore.waitForFunction(()=>window.testPendingScans.length===2)
 await restore.evaluate(()=>{window.requests=[];window.vm.playlist.library.onRescanFolders?.();window.vm.playlist.library.onSelectFolders()});await settle(restore)
 assert.equal(count(await requests(restore),'library_scan_folder'),0,'restore excludes rescan')
 assert.equal(count(await requests(restore),'library_select_folders'),0,'restore excludes folder import')
 await releaseScans(restore);await ready(restore)
 await restore.waitForFunction(()=>window.requests.filter(call=>call.command==='library_warm_cover_thumbnails').length===2)
 await restore.evaluate(()=>{window.requests=[];window.holdScans=true;window.vm.playlist.library.onRescanFolders()})
 await restore.waitForFunction(()=>window.testPendingScans.length>0)
 await restore.evaluate(()=>window.testRoot.unmount());await releaseScans(restore)
 assert.equal(await restore.locator('#root').innerHTML(),'')
 assert.equal(count(await requests(restore),'library_warm_cover_thumbnails'),0,'unmounted rescan cannot publish work')
 assertNoPlaybackOrRegistry(await requests(restore))
 evidence.push({scenario:'restore-and-unmount',passed:true});await restore.close()

 const empty=await open('?empty=1');await ready(empty)
 await empty.evaluate(()=>{window.requests=[];window.vm.playlist.library.onRescanFolders?.()});await settle(empty)
 assert.equal(count(await requests(empty),'library_scan_folder'),0,'zero roots is a no-op')
 assert.equal(await empty.evaluate(()=>window.vm.playlist.library.isFolderRescanPending),false)
 evidence.push({scenario:'zero-roots',passed:true});await empty.close()

 const mixed=await open('?mixedRoots=1');await ready(mixed)
 assert(await mixed.evaluate(()=>Boolean(window.settings.errors['/missing'])))
 await mixed.evaluate(()=>{window.requests=[];window.vm.playlist.library.onRescanFolders()});await rescanDone(mixed)
 assert.deepEqual((await requests(mixed)).filter(call=>call.command==='library_scan_folder').map(call=>call.args.path).sort(),['/empty','/missing','/music','/music-else'])
 assertNoPlaybackOrRegistry(await requests(mixed))
 evidence.push({scenario:'empty-and-failed-selected-roots-retried',passed:true});await mixed.close()

 // A pending tag pass invalidated by clear cannot strand the same descriptors.
 for(const failure of (process.env.SPMUSIC_MENU_VISUAL_ONLY?[]:[false,true])){
  const tags=await open('?summaryGate=1');await ready(tags)
  await tags.evaluate(()=>window.vm.playlist.library.onSelectCategory('songs'))
  await tags.waitForFunction(()=>window.pendingSummaries.length>0)
  await tags.evaluate(async failure=>{window.clearFailure=failure;await window.settings.onClear()},failure)
  await tags.waitForFunction(failure=>window.settings.status===(failure?'error':'ready')&&!window.vm.playlist.library.isImportPending,failure)
  if(!failure)await tags.waitForFunction(()=>window.vm.playlist.library.folderRoots.length===0)
  else await tags.waitForFunction(()=>Boolean(window.settings.errors['']))
  await tags.evaluate(()=>{window.summaryGate=false;window.pendingSummaries.splice(0).forEach(resolve=>resolve())})
  if(!failure){
   await tags.evaluate(()=>{window.folderSelection=['/music']})
   await tags.locator('.playlist-management-empty').getByRole('button',{name:'选择文件夹',exact:true}).click();await ready(tags)
  }
  console.log('Checking cleared summary recovery',failure)
  try{await tags.waitForFunction(()=>window.vm.playlist.library.allSongsMetadataStatus==='ready'&&window.vm.playlist.library.allSongs.some(row=>row.track.title==='Initial Title root'))}
  catch(error){console.log('Summary recovery state',await tags.evaluate(()=>({failure:window.clearFailure,status:window.vm.playlist.library.allSongsMetadataStatus,songs:window.vm.playlist.library.allSongs.map(row=>({id:row.trackId,title:row.track.title})),roots:window.vm.playlist.library.folderRoots,requests:window.requests,pending:window.pendingSummaries.length,importing:window.vm.playlist.library.isImportPending})));throw error}
  evidence.push({scenario:failure?'failed-clear-pending-summary-recovers':'clear-pending-summary-reimport-same-root',passed:true});await tags.close()
 }

 const ui=await open();await ready(ui)
 const overview=ui.locator('.media-library-category')
 const overviewAppearance=()=>overview.evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.categoryId,color:getComputedStyle(node.querySelector('.media-library-category-disc')).backgroundColor})))
 const overviewBefore=await overviewAppearance()
 await selectFoldersPage(ui)
 const trigger=ui.getByRole('button',{name:'更多文件夹操作',exact:true})
 const dialog=ui.getByRole('dialog',{name:'文件夹层次结构',exact:true})
 await trigger.click();await dialog.waitFor()
 assert.equal(await dialog.getByRole('button').count(),4)
 assert.equal(await dialog.getByRole('button',{name:'列表选项，暂不可用'}).isDisabled(),true)
 await ui.waitForFunction(()=>document.activeElement?.textContent==='选择文件夹')
 await ui.keyboard.press('Shift+Tab')
 await ui.waitForFunction(()=>document.activeElement?.textContent==='在侧栏置顶')
 assert.equal(await ui.evaluate(()=>document.activeElement?.textContent),'在侧栏置顶','focus wraps past disabled list options')
 await ui.keyboard.press('Tab')
 await ui.waitForFunction(()=>document.activeElement?.textContent==='选择文件夹')
 assert.equal(await ui.evaluate(()=>document.activeElement?.textContent),'选择文件夹')
 const metrics=await dialog.evaluate(node=>{
  const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
  const style=getComputedStyle(node),header=node.querySelector('.folder-root-menu-header'),title=node.querySelector('.folder-root-menu-title'),actions=node.querySelector('.folder-root-menu-actions'),divider=node.querySelector('.folder-root-menu-divider')
  return {rect:rect(node),radius:style.borderRadius,color:style.color,background:style.backgroundColor,header:rect(header),category:rect(node.querySelector('.folder-root-menu-category')),title:{font:getComputedStyle(title).fontSize,line:getComputedStyle(title).lineHeight},divider:rect(divider),actions:{gap:getComputedStyle(actions).gap,padding:getComputedStyle(actions).padding},rows:[...node.querySelectorAll('.folder-root-menu-action')].map(row=>({rect:rect(row),font:getComputedStyle(row).fontSize,line:getComputedStyle(row).lineHeight,gap:getComputedStyle(row).gap,icon:rect(row.querySelector('img'))})),settingsTransform:getComputedStyle(node.querySelector('.folder-root-menu-settings')).transform,assets:[...node.querySelectorAll('img')].map(img=>new URL(img.src).pathname)}
 })
 assert.equal(metrics.rect.width,564);assert.equal(metrics.rect.height,505.5)
 assert.equal(metrics.radius,'30px');assert.equal(metrics.color,'rgb(39, 99, 137)');assert.equal(metrics.background,'rgb(247, 249, 255)')
 assert.deepEqual([metrics.category.width,metrics.category.height],[84,84]);assert.deepEqual(metrics.title,{font:'32px',line:'40px'})
 assert.equal(metrics.divider.height,1.5);assert.equal(metrics.divider.x-metrics.rect.x,27);assert.equal(metrics.divider.width,510)
 assert.deepEqual(metrics.actions,{gap:'42px',padding:'42px 27px 24px'})
 assert(metrics.rows.every(row=>row.rect.height===48&&row.icon.width===48&&row.icon.height===48&&row.font==='22px'&&row.line==='28px'&&row.gap==='18px'))
 assert.equal(metrics.settingsTransform,'matrix(1, 0, 0, -1, 0, 0)')
 const expectedAssets=['playlist-library/cbd63.svg',...['9b161','9b2af','b969c','e41ce'].map(name=>'folder-root-menu/'+name+'.svg')]
 const normalizeSvg=source=>source.replaceAll('"',"'").replace(/\s+/g,' ').replace(/>\s+</g,'><').trim()
 for(const [index,name] of expectedAssets.entries()){
  const actual=metrics.assets[index].startsWith('image/svg+xml,')?decodeURIComponent(metrics.assets[index].slice('image/svg+xml,'.length)):await(await fetch(origin+metrics.assets[index])).text()
  assert.equal(normalizeSvg(actual),normalizeSvg(readFileSync(new URL('../../../assets/'+name,import.meta.url),'utf8')),`exact SVG content ${name}`)
 }
 metrics.assets=expectedAssets
 await dialog.screenshot({path:directory+'/menu-desktop.png'})
 await ui.keyboard.press('Escape');await dialog.waitFor({state:'hidden'})
 assert.equal(await trigger.evaluate(node=>node===document.activeElement),true,'Escape returns focus to trigger')
 await trigger.click();await ui.mouse.click(8,8);await dialog.waitFor({state:'hidden'})
 assert.equal(await trigger.evaluate(node=>node===document.activeElement),true,'backdrop returns focus to trigger')
 await trigger.click();await dialog.getByRole('button',{name:'选择文件夹',exact:true}).click();await dialog.waitFor({state:'hidden'});await ready(ui)
 assert.equal(count(await requests(ui),'library_select_folders'),1,'select action invokes the existing picker')
 await trigger.click();await dialog.getByRole('button',{name:'重新扫描',exact:true}).click();await dialog.waitFor({state:'hidden'});await rescanDone(ui)
 assert.equal(count(await requests(ui),'library_scan_folder'),4,'UI rescan retries two roots in addition to restore')
 const sidebar=ui.locator('.folder-hierarchy .playlist-library-sidebar:not([data-overlay]) .playlist-library-category-label')
 const sidebarAppearance=()=>ui.locator('.folder-hierarchy .playlist-library-sidebar:not([data-overlay]) .playlist-library-category').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.dataset.categoryId,getComputedStyle(node.querySelector('.playlist-library-category-icon')).backgroundColor])))
 const defaultOrder=await sidebar.allTextContents()
 const defaultColors=await sidebarAppearance()
 await trigger.click();await dialog.getByRole('button',{name:'在侧栏置顶',exact:true}).click();await dialog.waitFor({state:'hidden'})
 assert.deepEqual(await sidebar.allTextContents(),['文件夹层次结构',...defaultOrder.filter(label=>label!=='文件夹层次结构')])
 assert.deepEqual(await sidebarAppearance(),defaultColors,'pin preserves every category identity color')
 assert.equal(await ui.evaluate(()=>localStorage.getItem('spmusic.library.sidebar.folders-pinned.v1')),'1')
 await ui.reload();await ready(ui);await selectFoldersPage(ui)
 assert.equal(await ui.evaluate(()=>window.vm.playlist.library.foldersPinnedInSidebar),true)
 assert.equal((await sidebar.allTextContents())[0],'文件夹层次结构')
 assert.deepEqual(await sidebarAppearance(),defaultColors,'restored pin preserves category colors')
 await ui.evaluate(()=>window.vm.playlist.library.onOpenOverview())
 await overview.first().waitFor()
 assert.deepEqual(await overviewAppearance(),overviewBefore,'pin never reorders or recolors overview categories')
 await selectFoldersPage(ui)
 await trigger.click();await dialog.getByRole('button',{name:'取消侧栏置顶',exact:true}).click();await dialog.waitFor({state:'hidden'})
 assert.deepEqual(await sidebar.allTextContents(),defaultOrder)
 assert.deepEqual(await sidebarAppearance(),defaultColors,'unpin preserves category colors')
 assert.equal(await ui.evaluate(()=>localStorage.getItem('spmusic.library.sidebar.folders-pinned.v1')),'0')
 evidence.push({scenario:'menu-visual-focus-actions-pin-persistence',metrics,passed:true});await ui.close()

 // A real decoded folder thumbnail must stay inside the detail header, not cover the dialog.
 const detail=await open('?cover=1');await ready(detail);await selectFoldersPage(detail)
 await detail.evaluate(()=>window.vm.playlist.library.onFolderLocationChange({rootPath:'/music',directoryPath:'/music'}))
 await detail.waitForFunction(()=>document.querySelector('.folder-hierarchy-content > .playlist-hero img.playlist-hero-image')?.naturalWidth>0)
 await detail.locator('.folder-hierarchy-content .playlist-hero-actions').getByRole('button',{name:'更多文件夹操作'}).click()
 const detailDialog=detail.getByRole('dialog',{name:'music',exact:true});await detailDialog.waitFor()
 await detailDialog.locator('.folder-detail-menu-artwork img').evaluate(img=>img.decode())
 const detailGeometry=await detailDialog.evaluate(node=>{const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}},img=node.querySelector('.folder-detail-menu-artwork img');const measure=()=>({dialog:rect(node),artwork:rect(node.querySelector('.folder-detail-menu-artwork')),image:rect(img),title:rect(node.querySelector('.folder-root-menu-title')),position:getComputedStyle(img).position,offsetParent:img.offsetParent?.className});const frame=node.querySelector('.folder-detail-menu-artwork');frame.style.position='static';img.className='playlist-hero-image';const before=measure();img.className='';frame.style.position='';return {...measure(),before}})
 assert.deepEqual([detailGeometry.artwork.width,detailGeometry.artwork.height],[160,160])
 assert.deepEqual(detailGeometry.image,detailGeometry.artwork,'decoded image is contained by artwork frame')
 assert.equal(detailGeometry.position,'static');assert(detailGeometry.title.x>=detailGeometry.artwork.x+detailGeometry.artwork.width)
 await detailDialog.screenshot({path:directory+'/detail-cover.png'})
 evidence.push({scenario:'detail-cover-geometry',detailGeometry,passed:true});await detail.close()

 const storage=await open('?storageWriteFail=1');await ready(storage);await selectFoldersPage(storage)
 await storage.getByRole('button',{name:'更多文件夹操作',exact:true}).click()
 await storage.getByRole('dialog',{name:'文件夹层次结构',exact:true}).getByRole('button',{name:'在侧栏置顶',exact:true}).click()
 await storage.waitForFunction(()=>window.vm.playlist.library.foldersPinnedInSidebar===true)
 assert.equal(await storage.evaluate(()=>localStorage.getItem('spmusic.library.sidebar.folders-pinned.v1')),null)
 assert.equal(await storage.locator('.folder-hierarchy .playlist-library-sidebar:not([data-overlay]) .playlist-library-category-label').first().textContent(),'文件夹层次结构')
 evidence.push({scenario:'pin-storage-write-failure-keeps-session',passed:true});await storage.close()

 const narrow=await open('',360,480);await ready(narrow);await selectFoldersPage(narrow)
 await narrow.getByRole('button',{name:'更多文件夹操作',exact:true}).click()
 const narrowDialog=narrow.getByRole('dialog',{name:'文件夹层次结构',exact:true});await narrowDialog.waitFor()
 const narrowBox=await narrowDialog.boundingBox();assert(narrowBox.x>=16&&narrowBox.y>=16&&narrowBox.x+narrowBox.width<=344&&narrowBox.y+narrowBox.height<=464)
 await narrowDialog.getByRole('button',{name:'列表选项，暂不可用'}).scrollIntoViewIfNeeded()
 assert.equal(await narrowDialog.evaluate(node=>node.scrollWidth<=node.clientWidth),true,'narrow menu has no horizontal clipping')
 await narrowDialog.screenshot({path:directory+'/menu-narrow.png'})
 await narrow.keyboard.press('Escape');await narrowDialog.waitFor({state:'hidden'})
 evidence.push({scenario:'narrow-scroll-and-dismiss',box:narrowBox,passed:true});await narrow.close()
 assert.deepEqual(errors,[],'no uncaught browser runtime errors')
 writeFileSync(directory+'/evidence.json',JSON.stringify({evidence,errors},null,2))
 console.log(JSON.stringify({pass:true,evidence,directory}))
}finally{await browser.close()}
