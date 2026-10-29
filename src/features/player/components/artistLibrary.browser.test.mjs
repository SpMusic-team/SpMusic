// Independent acceptance test: actual PlayerShell and filesystem transport fixture.
// Run with Vite at SPMUSIC_TEST_ORIGIN (default http://127.0.0.1:5173).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, statSync } from 'node:fs'

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
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `
import React from '${dependency('react.js')}';
import {PlayerSurface as RealSurface} from '/__album_library_real_surface.js';
export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;return React.createElement(RealSurface,props)}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.scanGate=new URLSearchParams(location.search).has('scanGate');window.summaryGate=new URLSearchParams(location.search).has('summaryGate');window.pendingScans=[];window.pendingSummaries=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const large=new URLSearchParams(location.search).has('large');
const covers=new URLSearchParams(location.search).has('cover');
const yearScenario=new URLSearchParams(location.search).get('years');
window.summaryYears=yearScenario?{'mix-a':2023,duet:2023,'mix-b':yearScenario==='conflict'?2024:yearScenario==='invalid'?0:null}:{};
const roots=['/music','/music/Box','/external','/empty','/missing','/hidden'];
const rows=[
 ['echo-a','/music/A/one.flac','Echo','Ann','Ann'],
 ['echo-b','/external/B/two.flac','Echo','Bob','Bob'],
 ['disc1','/music/Box/Disc1/a.flac','Box','Singer A','Ensemble'],
 ['disc2','/music/Box/Disc2/b.flac','Box','Singer B','Ensemble'],
 ['mix-a','/music/Compilation/a.flac','Mixed','Singer A',null],
 ['mix-b','/music/Compilation/b.flac','Mixed','Singer B',null],
 ['home-a','/music/Fallback/a.flac','Home','Solo A',null],
 ['home-b','/external/Fallback/b.flac','Home','Solo B',null],
 ['unknown-a','/music/U/a.flac',null,null,null],
 ['unknown-b','/external/U/b.flac',null,null,null],
 ['literal','/music/Literal/a.flac','本地音频','Literal','Literal'],
 ['bad','/music/Bad/a.flac',null,null,null],
 ['duet','/music/Compilation/duet.flac','Mixed','Singer A/Singer B/Singer A',null],
 ['ac','/music/AC/ac.flac','Rock','AC/DC',null],
 ['plus','/music/Plus/plus.flac','Plus','+/-',null],
 ['blank','/music/Blank/blank.flac','Blank',null,'Ensemble'],
 ['literal-unknown','/music/LiteralUnknown/u.flac','Unknown','未知艺术家',null],
 ['unknown-album','/music/NoAlbum/u.flac',null,'Singer A',null],
 ['hidden','/hidden/hidden.flac','Hidden','Hidden','Hidden'],
 ...Array.from({length:32},(_,i)=>['zed-'+i,'/music/Zed'+String(i).padStart(2,'0')+'/song.flac','Zed '+String(i).padStart(2,'0'),'Zed Artist','Zed Artist'])
];
if(large)rows.push(...Array.from({length:180},(_,i)=>['large-'+i,'/music/Large/'+i+'.flac','Large','Large Singer','Large Artist']));
const descriptor=([id,sourcePath])=>({id,sourcePath,fileName:sourcePath.split('/').at(-1),available:true});
const descriptors=rows.map(descriptor);
const all=new Map(descriptors.map(row=>[row.sourcePath,row]));
const folder=path=>({directoryPath:path,directoryName:path.split('/').at(-1),sourceKind:'folder',sourcePath:path,sourceName:path.split('/').at(-1),selectedIndex:0,
 directoryPaths:path==='/legacy'?undefined:path==='/branch'?['/branch','/branch/child']:path==='/music'?['/music','/music/Album','/music/Album/Disc','/music/Silent']:path==='/music/Album'?['/music/Album','/music/Album/Disc']:[path],
 tracks:descriptors.filter(row=>row.sourcePath.startsWith(path+'/'))});
const track=path=>{const row=all.get(path),tags=rows.find(value=>value[1]===path);if(!row)throw Error('Unknown path '+path);return {...row,durationMs:180000,metadata:{title:(row.id.startsWith('zed-')?'Zed song ':'Title ')+row.id,artist:tags[3],album:tags[2],albumArtist:tags[4],genre:null,year:yearScenario?1999:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_playlists')return [];
 if(command==='library_get_folders')return {revision:0,roots:roots.map(path=>({path,selected:path!=='/hidden',directoryRules:[]}))};
 if(command==='library_clear_folders'){roots.length=0;return null}
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='library_scan_folder'){
  if(window.scanGate)await new Promise(resolve=>window.pendingScans.push(resolve));
  if(args.path==='/missing')throw {code:'FILE_NOT_FOUND',message:'Folder is missing',recoverable:true};
  return folder(args.path);
 }
 if(command==='library_warm_cover_thumbnails')return {requested:input.paths.length,processed:input.paths.length,written:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:180000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:null}}
 if(command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels'||command==='audio_load_folder_thumbnail'){
  if(!covers)return new Uint8Array(0);
  const bytes=new Uint8Array(44),view=new DataView(bytes.buffer);bytes.set([83,80,88,82]);view.setUint16(4,1,true);view.setUint16(6,40,true);view.setUint32(8,1,true);view.setUint32(12,1,true);view.setUint32(16,4,true);view.setUint32(20,1,true);view.setUint32(24,4,true);view.setUint32(32,1,true);view.setUint32(36,1,true);bytes.set([255,0,0,255],40);return bytes;
 }
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_probe_playlist_track_summaries'){
  if(window.summaryGate)await new Promise(resolve=>window.pendingSummaries.push(resolve));
  return input.paths.map(sourcePath=>{const item=track(sourcePath);if(item.id==='bad')return {sourcePath,summary:null,error:{code:'DECODE_FAILED',message:'Unreadable tags',recoverable:true}};return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:item.metadata.albumArtist,...(Object.hasOwn(window.summaryYears,item.id)?{year:window.summaryYears[item.id]}:{}),bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__album_library_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: Number(process.env.SPMUSIC_TEST_WIDTH) || 640, height: 1440 }, reducedMotion: process.env.SPMUSIC_TEST_MOTION ? 'no-preference' : 'reduce', hasTouch: true })
page.setDefaultTimeout(15000)
const errors = []
const consoleErrors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') { consoleErrors.push(message.text()); console.error('BROWSER_CONSOLE', message.text()) } })
page.on('requestfailed', request => console.error('BROWSER_REQUEST_FAILED', request.url(), request.failure()?.errorText))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__album_library_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__album_library_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__album_library_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => {
  localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
  localStorage.removeItem('spmusic.player.session.v1')
})


const evidence=process.env.SPMUSIC_TEST_SCREENSHOTS
if(evidence)mkdirSync(evidence,{recursive:true})
const screenshot=async name=>{if(evidence)await page.screenshot({path:evidence+'/'+name+'.png'})}
const selectCategory=async category=>{await page.evaluate(category=>window.vm.playlist.library.onSelectCategory(category),category);await page.waitForFunction(category=>window.vm.playlist.library.route.categoryId===category,category)}
const artists=()=>page.locator('.artist-card')
const allArtistSongs=()=>page.locator('.album-library-content:not([inert]) .artist-all-songs')
const artist=name=>artists().filter({has:page.locator('.folder-name',{hasText:new RegExp('^'+name+'$')})}).first()
const albums=()=>page.locator('.album-library-content button[data-album-key]:not(.artist-card)')
const songs=()=>page.locator('.album-songs .playlist-card[data-song-key]')
const songIds=()=>songs().evaluateAll(nodes=>nodes.map(n=>n.dataset.songKey.split('/').at(-1)).sort())
const queueIds=()=>page.evaluate(()=>window.vm.queue.tracks.map(t=>t.id).sort())
const ready=()=>page.waitForFunction(()=>!window.vm.playback.isSelectionPending)
const backFromPlayer=async()=>{await page.evaluate(()=>window.vm.playlist.onOpenChange(false));await page.waitForFunction(()=>!window.vm.playlist.isOpen);await page.evaluate(()=>window.vm.playlist.onOpenChange(true));await page.waitForFunction(()=>window.vm.playlist.isOpen)}
const up=async()=>{await page.locator('.playlist-hero-category').click();await page.waitForFunction(()=>document.querySelectorAll('.album-library-content:not([inert])').length===1)}
const verifyArtistHeroMenu=async()=>{
 const trigger=()=>page.locator('.album-library-content:not([inert]) > .playlist-hero .playlist-hero-more-button')
 const menu=()=>page.getByRole('dialog',{name:'艺术家更多操作',exact:true})
 const queueBefore=await queueIds(),pinsBefore=await page.evaluate(()=>window.vm.playlist.library.pinnedCategoryIds)
 const triggerGeometry=await trigger().evaluate(node=>{const r=node.getBoundingClientRect(),style=getComputedStyle(node);return {width:r.width,height:r.height,border:style.borderWidth,background:style.backgroundColor}})
 assert.deepEqual([triggerGeometry.width,triggerGeometry.height,triggerGeometry.border],[42,42,'0px'],'artist hero reuses the filled detail more trigger')
 assert(!['transparent','rgba(0, 0, 0, 0)'].includes(triggerGeometry.background))
 const initialPin=pinsBefore.includes('artist')
 const pinLabel=pinned=>pinned?'取消侧栏置顶':'在侧栏置顶'
 await trigger().click();await menu().waitFor()
 assert.deepEqual(await menu().locator('.playlist-hero-more-action span').allTextContents(),['选择文件夹','重新扫描','封面',pinLabel(initialPin),'列表选项'])
 assert.equal(await menu().locator('.playlist-hero-more-info h2').textContent(),'Singer A')
 assert.match(await menu().locator('.playlist-hero-more-info p').textContent(),/4\s*\|\s*12:00/)
 const fit=await menu().evaluate(node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,full:node.scrollHeight,height:node.clientHeight,rows:[...node.querySelectorAll('.playlist-hero-more-action')].map(row=>{const r=row.getBoundingClientRect();return {top:r.top,bottom:r.bottom}})}})
 assert(fit.full<=fit.height+1&&fit.rows.every(row=>row.top>=fit.top&&row.bottom<=fit.bottom),'normal artist menu naturally exposes all five actions without scrolling')
 const cover=menu().locator('.playlist-hero-more-artwork .folder-cover-image');await cover.waitFor();await cover.evaluate(image=>image.decode())
 assert.equal(await page.locator('.library-root-menu').count(),0,'detail menu does not mount the category root menu')
 assert.equal(await menu().getByRole('button',{name:'删除重复项',exact:true}).count(),0)
 await screenshot('artist-detail-more')
 await page.keyboard.press('Escape');await menu().waitFor({state:'hidden'});assert(await trigger().evaluate(node=>node===document.activeElement),'Escape restores artist opener focus')
 for(const label of ['封面','列表选项']){
  await trigger().click();await menu().getByRole('button',{name:label,exact:true}).click()
  const notice=page.getByRole('dialog',{name:label,exact:true});await notice.waitFor();assert.equal(await page.getByRole('dialog').count(),1)
  assert.match(await notice.innerText(),/尚未接入/);assert(!/当前播放列表/.test(await notice.innerText()),'artist notice does not use playlist scope copy')
  await notice.getByRole('button',{name:'返回更多操作',exact:true}).click();await menu().waitFor();await page.keyboard.press('Escape');await menu().waitFor({state:'hidden'})
  assert(await trigger().evaluate(node=>node===document.activeElement))
 }
 await trigger().click();await menu().getByRole('button',{name:pinLabel(initialPin),exact:true}).click();await menu().waitFor({state:'hidden'})
 const pinsAfter=await page.evaluate(()=>window.vm.playlist.library.pinnedCategoryIds)
 assert.equal(pinsAfter.includes('artist'),!initialPin);assert.deepEqual(pinsAfter.filter(id=>id!=='artist'),pinsBefore.filter(id=>id!=='artist'),'artist action changes only the approved artist category pin')
 await trigger().click();assert.equal(await menu().getByRole('button',{name:pinLabel(!initialPin),exact:true}).getAttribute('aria-pressed'),String(!initialPin))
 await menu().getByRole('button',{name:pinLabel(!initialPin),exact:true}).click();await menu().waitFor({state:'hidden'})
 assert.deepEqual(await page.evaluate(()=>window.vm.playlist.library.pinnedCategoryIds),pinsBefore,'pin toggle restores initial category set')
 await trigger().click();await menu().getByRole('button',{name:'选择文件夹',exact:true}).click()
 const folderDialog=page.getByRole('dialog',{name:'文件夹选择',exact:true});await folderDialog.waitFor();assert.equal(await page.getByRole('dialog').count(),1,'folder action transfers to one existing folder editor trap')
 await page.keyboard.press('Escape');await folderDialog.waitFor({state:'hidden'})
 const scansBefore=await page.evaluate(()=>window.calls.filter(call=>call.command==='library_scan_folder').length)
 await trigger().click();await page.evaluate(()=>window.scanGate=true);await menu().getByRole('button',{name:'重新扫描',exact:true}).click();await menu().waitFor({state:'hidden'})
 await page.waitForFunction(()=>window.pendingScans.length>0)
 await trigger().click();await menu().waitFor();assert(await menu().getByRole('button',{name:'重新扫描',exact:true}).isDisabled());assert(await menu().getByRole('button',{name:'选择文件夹',exact:true}).isDisabled())
 await page.keyboard.press('Escape');await menu().waitFor({state:'hidden'})
 await page.evaluate(()=>{window.scanGate=false;window.pendingScans.splice(0).forEach(resolve=>resolve())})
 await page.waitForFunction(()=>!window.vm.playlist.library.isFolderRescanPending&&window.vm.playlist.library.allSongsMetadataStatus==='ready')
 assert(await page.evaluate(before=>window.calls.filter(call=>call.command==='library_scan_folder').length>before,scansBefore),'artist rescan invokes the existing selected-library callback')
 assert.deepEqual(await queueIds(),queueBefore,'menu actions do not replace the playback queue')
 assert.deepEqual(await page.evaluate(()=>window.vm.playlist.library.artistLocation),{artistKey:JSON.stringify(['artist','Singer A']),view:'albums'})
 console.log('artist detail more: filled trigger, real header, five scoped actions, focus, folder transfer, busy rescan and pin isolation passed')
}
const verifyArtistMenuContext=async(name,noCover=false)=>{
 const trigger=page.locator('.album-library-content:not([inert]) > .playlist-hero .playlist-hero-more-button')
 await trigger.focus();await page.keyboard.press('Enter')
 const menu=page.getByRole('dialog',{name:'艺术家更多操作',exact:true});await menu.waitFor()
 assert.equal(await menu.locator('.playlist-hero-more-info h2').textContent(),'Singer A')
 assert.match(await menu.locator('.playlist-hero-more-info p').textContent(),/4\s*\|\s*12:00/,'artist header retains complete artist scope inside album/song details')
 const artwork=menu.locator('.artist-menu-cover[data-cover-key]')
 assert.equal(await artwork.getAttribute('data-cover-key'),JSON.stringify(['collection-cover','artist',JSON.stringify(['artist','Singer A'])]),'portal retains full artist artwork resource rather than current album resource')
 if(noCover){await artwork.locator('.album-cover-placeholder').waitFor();assert.equal(await artwork.locator('img').count(),0)}
 else{await artwork.locator('img').waitFor();await artwork.locator('img').evaluate(image=>image.decode())}
 const geometry=await artwork.evaluate(node=>{const r=node.getBoundingClientRect();return [r.width,r.height]});assert.deepEqual(geometry,[160,160])
 await screenshot(name);await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});assert(await trigger.evaluate(node=>node===document.activeElement))
}
const verifyArtistEntryDesign=async()=>{
 await page.goto(origin+'/__album_library_test?cover=1')
 await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50&&!window.vm.playlist.library.isImportPending)
 await selectCategory('artist');await artist('Singer A').waitFor();await screenshot('artist-design-root')
 await artist('Singer A').click();await allArtistSongs().waitFor()
 await allArtistSongs().locator('img').evaluate(image=>image.decode())
 const geometry=await allArtistSongs().evaluate(button=>{
  const css=node=>getComputedStyle(node),rect=node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom}}
  const cover=button.querySelector('.artist-all-songs-cover'),copy=button.querySelector('.artist-all-songs-copy'),title=button.querySelector('.artist-all-songs-title'),count=button.querySelector('.artist-song-count'),music=button.querySelector('.artist-all-songs-music')
  const panel=button.closest('.album-library-content'),card=panel.querySelector('.album-card'),grid=card.closest('.album-list'),hero=panel.querySelector('.playlist-hero')
  const probe=document.createElement('span');probe.style.color='var(--player-inverse-primary)';count.append(probe);const expectedColor=css(probe).color;probe.remove()
  const heroTitle=hero.querySelector('.playlist-hero-title'),heroMeta=hero.querySelector('.playlist-hero-meta')
  return {row:rect(button),cover:rect(cover),copy:rect(copy),title:{...rect(title),font:css(title).fontSize,line:css(title).lineHeight,text:title.textContent},count:{...rect(count),font:css(count).fontSize,line:css(count).lineHeight,gap:css(count).gap,color:css(count).color,text:count.textContent},music:{...rect(music),mask:css(music).maskImage},padding:css(button).padding,gap:css(button).gap,copyGap:css(copy).gap,radius:css(cover).borderRadius,expectedColor,album:{cover:rect(card.querySelector('.folder-cover')),nameFont:css(card.querySelector('.folder-name')).fontSize,nameLine:css(card.querySelector('.folder-name')).lineHeight,artistFont:css(card.querySelector('.folder-parent-name')).fontSize,artistLine:css(card.querySelector('.folder-parent-name')).lineHeight,gap:css(grid).gap},panel:rect(panel),hero:rect(hero),heroTitle:rect(heroTitle),heroMeta:{...rect(heroMeta),text:heroMeta.textContent},order:Boolean(button.compareDocumentPosition(grid)&Node.DOCUMENT_POSITION_FOLLOWING)}
 })
 assert.deepEqual([geometry.cover.width,geometry.cover.height,geometry.radius],[125,125,'999px'],'design entry uses a 125px circular cover')
 assert.deepEqual([geometry.padding,geometry.gap,geometry.copyGap],['15px 40px','15px','4px'])
 assert.equal(geometry.row.height,155,'entry height is cover plus vertical padding without inherited border')
 assert.equal(geometry.row.top,geometry.hero.bottom,'entry immediately follows the artist hero')
 assert.equal(geometry.cover.top-geometry.row.top,15)
 assert.equal(geometry.cover.left-geometry.row.left,40)
 assert.deepEqual([geometry.title.text,geometry.title.font,geometry.title.line],['所有艺术家歌曲','28px','36px'])
 assert.deepEqual([geometry.count.text,geometry.count.font,geometry.count.line,geometry.count.gap],['4 首歌曲','24px','32px','16px'],'real artist membership replaces design sample count')
 assert.equal(geometry.count.color,geometry.expectedColor,'metadata consumes the theme inverse-primary color')
 assert.equal(geometry.copy.left-geometry.cover.right,15)
 assert.equal(geometry.count.top-geometry.title.bottom,4)
 assert.deepEqual([geometry.music.width,geometry.music.height],[24,24])
 const musicAsset=await page.evaluate(async()=>(await import('/src/assets/artist-library/24b9a.svg?import')).default)
 assert(geometry.music.mask.includes(musicAsset),'entry uses exact design music24 asset')
 assert(statSync(new URL('../../../assets/artist-library/24b9a.svg',import.meta.url)).size>0)
 assert.deepEqual([geometry.album.cover.width,geometry.album.cover.height,geometry.album.gap],[240,240,'22px 48px'])
 assert.equal(geometry.album.cover.top-geometry.row.bottom,15,'album cover follows entry with only card padding')
 assert.equal(geometry.hero.height,320);assert.equal(geometry.hero.left-geometry.panel.left,25);assert.equal(geometry.panel.right-geometry.hero.right,25);assert(geometry.order)
 assert.equal(geometry.heroMeta.left,geometry.heroTitle.left,'artist count and duration align with the title')
 assert.equal(geometry.heroMeta.top-geometry.heroTitle.bottom,5,'artist count and duration immediately follow title')
 assert.match(geometry.heroMeta.text,/4\s*\|\s*12:00/,'hero uses real artist song count and compact summed duration')
 const heroIndex=page.locator('.artist-library .playlist-management-quick-index')
 await heroIndex.evaluate(node=>node.style.display='none')
 const heroWithoutIndex=await page.locator('.album-library-content:not([inert]) > .playlist-hero').evaluate(node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom}})
 assert.deepEqual(heroWithoutIndex,geometry.hero,'index overlay does not change artist hero geometry')
 await heroIndex.evaluate(node=>node.style.display='')
 console.log('ARTIST_ENTRY_DESIGN_GEOMETRY',JSON.stringify({...geometry,music:{...geometry.music,mask:'verified exact local music24 asset'}}));await screenshot('artist-design-entry')
 await verifyArtistHeroMenu()
 await allArtistSongs().click();await songs().first().waitFor();assert.equal(await songs().count(),4);await screenshot('artist-design-songs')
 await up();await allArtistSongs().focus();await page.keyboard.press('Enter');await songs().first().waitFor();assert.equal(await songs().count(),4,'keyboard entry preserves members')
 await up();await up();await artist('Singer B').click();await allArtistSongs().waitFor();assert.equal(await allArtistSongs().locator('.artist-song-count').textContent(),'3 首歌曲','entry count follows selected artist')
 await selectCategory('album');await page.waitForFunction(()=>document.querySelectorAll('.album-library-content:not([inert]) .album-card').length>0)
 const globalAlbum=await albums().first().evaluate(card=>({nameFont:getComputedStyle(card.querySelector('.folder-name')).fontSize,nameLine:getComputedStyle(card.querySelector('.folder-name')).lineHeight,artistFont:getComputedStyle(card.querySelector('.folder-parent-name')).fontSize,artistLine:getComputedStyle(card.querySelector('.folder-parent-name')).lineHeight}))
 assert.deepEqual({nameFont:geometry.album.nameFont,nameLine:geometry.album.nameLine,artistFont:geometry.album.artistFont,artistLine:geometry.album.artistLine},globalAlbum,'artist albums use the same typography as global albums at the same layout level')
 await page.goto(origin+'/__album_library_test?noCover=1');await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50);await selectCategory('artist');await artist('Singer A').click();await allArtistSongs().waitFor()
 const fallback=allArtistSongs().locator('.album-cover-placeholder');await fallback.waitFor()
 const fallbackGeometry=await fallback.evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,mask:getComputedStyle(node).maskImage}))
 const artistAsset=await page.evaluate(async()=>(await import('/src/assets/media-library/feb56.svg?import')).default)
 assert(fallbackGeometry.width>0&&fallbackGeometry.height>0&&fallbackGeometry.mask.includes(artistAsset));assert.equal(await allArtistSongs().locator('img').count(),0)
 assert.equal(await allArtistSongs().locator('.artist-song-count').textContent(),'4 首歌曲');await screenshot('artist-design-no-cover')
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
 console.log('artist entry design: geometry, assets, dynamic count, click, keyboard, global album isolation and fallback passed')
}
const verifyArtistSongsPage=async()=>{
 await page.goto(origin+'/__album_library_test?cover=1');await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50&&!window.vm.playlist.library.isImportPending)
 await selectCategory('artist');await artist('Singer A').click();await allArtistSongs().waitFor()
 const referenceTypography=await page.locator('.album-library-content:not([inert]) .playlist-hero-title').evaluate(node=>{const style=getComputedStyle(node);return [style.fontSize,style.lineHeight]})
 await allArtistSongs().click();await songs().first().waitFor()
 const hero=page.locator('.album-library-content:not([inert]) > .playlist-hero')
 const measure=()=>hero.evaluate(node=>{
  const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}
  const title=node.querySelector('.playlist-hero-title'),meta=node.querySelector('.playlist-hero-meta'),back=node.querySelector('.playlist-hero-category'),actions=node.querySelector('.playlist-hero-actions'),more=actions.querySelector('.playlist-hero-more-button'),icon=meta.querySelector('.artist-songs-meta-icon'),style=getComputedStyle(title)
  return {hero:rect(node),panel:rect(node.closest('.album-library-content')),title:{...rect(title),text:title.textContent,font:style.fontSize,line:style.lineHeight,weight:style.fontWeight,padding:style.padding},meta:{...rect(meta),text:meta.textContent},back:{...rect(back),text:back.textContent,aria:back.getAttribute('aria-label'),icon:rect(back.querySelector('svg'))},music:rect(icon),musicMask:getComputedStyle(icon).maskImage,actions:rect(actions),more:rect(more),leftControls:[...actions.querySelectorAll('.playlist-hero-shuffle-button,.playlist-hero-play-button,.playlist-search-button,.playlist-select-toggle')].map(rect)}
 })
 const geometry=await measure()
 assert.equal(geometry.title.text,'所有艺术家歌曲');assert.deepEqual([geometry.title.font,geometry.title.line],referenceTypography,'songs title matches the artist overview hero title at the same viewport');assert.deepEqual([geometry.title.weight,geometry.title.padding],['500','2px 15px'])
 assert.equal(geometry.meta.text,'4 首歌曲');assert.equal(geometry.hero.height,320);assert.equal(geometry.hero.left-geometry.panel.left,25);assert.equal(geometry.panel.right-geometry.hero.right,25)
 assert.equal(geometry.meta.top-geometry.title.bottom,5);assert.equal(geometry.actions.top-geometry.meta.bottom,5)
 assert.equal(geometry.back.text,'Singer A');assert.equal(geometry.back.aria,'返回Singer A');assert.deepEqual([geometry.back.icon.width,geometry.back.icon.height],[28,28]);assert.deepEqual([geometry.music.width,geometry.music.height],[16,16])
 const music=await page.evaluate(async()=>(await import('/src/assets/playlist-library/77262.svg?import')).default);assert(geometry.musicMask.includes(music))
 assert.deepEqual([geometry.more.width,geometry.more.height],[42,42]);assert.equal(geometry.hero.right-geometry.more.right,10);assert.equal(geometry.leftControls.length,4);assert(geometry.leftControls.every(control=>control.right<geometry.more.left))
 await screenshot('artist-songs-page');console.log('ARTIST_SONGS_PAGE',JSON.stringify({...geometry,musicMask:'verified original music16 asset'}))
 await hero.locator('.playlist-hero-play-button').click();await ready();assert.deepEqual(await queueIds(),['disc1','duet','mix-a','unknown-album']);await backFromPlayer()
 await hero.locator('.playlist-search-button').click();await page.getByRole('searchbox').fill('duet');await page.waitForFunction(()=>document.querySelectorAll('.album-songs .playlist-card[data-song-key]').length===1)
 assert.equal(await hero.locator('.playlist-hero-meta').textContent(),'4 首歌曲','search does not replace full artist membership count')
 await hero.locator('.playlist-select-toggle').click();await songs().first().click();await hero.locator('.playlist-hero-play-button').click();await ready();assert.deepEqual(await queueIds(),['duet']);await backFromPlayer()
 await hero.locator('.playlist-hero-category').focus();await page.keyboard.press('Enter');await allArtistSongs().waitFor();assert.equal(await page.evaluate(()=>window.vm.playlist.library.artistLocation.view),'albums')
 await up();await artist('Singer B').click();await allArtistSongs().click();await songs().first().waitFor();assert.equal(await hero.locator('h1').textContent(),'所有艺术家歌曲');assert.equal(await hero.locator('.playlist-hero-category').textContent(),'Singer B');assert.equal(await hero.locator('.playlist-hero-meta').textContent(),'3 首歌曲')
 await hero.locator('.playlist-hero-more-button').click();const menu=page.getByRole('dialog',{name:'艺术家更多操作',exact:true});await menu.waitFor();assert.equal(await menu.locator('.playlist-hero-more-info h2').textContent(),'Singer B');assert.match(await menu.locator('.playlist-hero-more-info p').textContent(),/3\s*\|\s*9:00/);await page.keyboard.press('Escape')
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);console.log('artist songs page fixed title, count-only hero, layout, two artists, play/search/selection, return and real menu context passed')
}
const verifyAlbumDetailDesign=async()=>{
 await page.goto(origin+'/__album_library_test?cover=1');await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50&&!window.vm.playlist.library.isImportPending)
 const hero=()=>page.locator('.album-library-content:not([inert])[data-album-detail] > .playlist-hero')
 const openMixed=async scoped=>{await selectCategory(scoped?'artist':'album');if(scoped)await artist('Singer A').click();await albums().filter({has:page.locator('.folder-name',{hasText:/^Mixed$/})}).click();await songs().first().waitFor()}
 for(const scoped of [false,true]){
  await openMixed(scoped)
  const geometry=await hero().evaluate(node=>{
   const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}},text=node.querySelector('.playlist-hero-title'),author=node.querySelector('.collection-hero-parent-meta'),meta=node.querySelector('.playlist-hero-meta:not(.collection-hero-parent-meta)'),actions=node.querySelector('.playlist-hero-actions'),music=meta.querySelector('.album-detail-meta-icon'),grid=node.closest('.album-library-content').querySelector('.album-songs'),card=grid.querySelector('.playlist-card')
   const style=el=>({font:getComputedStyle(el).fontSize,line:getComputedStyle(el).lineHeight,padding:getComputedStyle(el).padding,text:el.textContent})
   return {hero:rect(node),panel:rect(node.closest('.album-library-content')),title:{...rect(text),...style(text)},author:{...rect(author),...style(author)},meta:{...rect(meta),...style(meta)},music:rect(music),actions:rect(actions),more:rect(actions.querySelector('.playlist-hero-more-button')),cover:rect(card.querySelector('.playlist-card-cover')),coverSize:getComputedStyle(grid).getPropertyValue('--playlist-cover-size').trim(),rowTitle:style(card.querySelector('.playlist-card-title')),rowArtist:style(card.querySelector('.playlist-card-artist')),rowMeta:style(card.querySelector('.playlist-card-format'))}
  })
  assert.equal(geometry.hero.height,320);assert.equal(geometry.hero.left-geometry.panel.left,25);assert.equal(geometry.panel.right-geometry.hero.right,25)
  assert.equal(geometry.title.text,'Mixed');assert.equal(geometry.author.text,'Singer A/Singer B');assert.equal(geometry.meta.text,scoped?'2 | 6:00':'3 | 9:00')
  assert.deepEqual([geometry.title.font,geometry.title.line,geometry.title.padding],Number(process.env.SPMUSIC_TEST_WIDTH)>1024?['22px','28px','2px 15px']:['24px','32px','2px 15px'])
  for(const item of [geometry.author,geometry.meta])assert.deepEqual([item.font,item.line,item.padding],['16px','24px','2px 15px'])
  assert.equal(geometry.author.top-geometry.title.bottom,5);assert.equal(geometry.meta.top-geometry.author.bottom,5);assert.equal(geometry.actions.top-geometry.meta.bottom,5);assert.deepEqual([geometry.music.width,geometry.music.height],[16,16]);assert.deepEqual([geometry.more.width,geometry.more.height],[42,42])
  assert(!await hero().textContent().then(text=>text.includes('2023')),'missing year is not invented');assert.equal(geometry.coverSize,'135px');assert(Math.abs(geometry.cover.width-geometry.cover.height)<1)
  assert.deepEqual([geometry.rowTitle.font,geometry.rowTitle.line,geometry.rowArtist.font,geometry.rowArtist.line,geometry.rowMeta.font,geometry.rowMeta.line],['28px','36px','22px','28px','16px','24px'])
  const before=await songIds();assert.deepEqual(before,scoped?['a.flac','duet.flac']:['a.flac','b.flac','duet.flac'])
  await screenshot(scoped?'artist-album-detail':'global-album-detail');console.log('ALBUM_DETAIL_DESIGN',JSON.stringify({scoped,...geometry}))
  await hero().locator('.playlist-hero-more-button').click();const menu=page.getByRole('dialog',{name:scoped?'艺术家更多操作':'专辑更多操作',exact:true});await menu.waitFor()
  assert.equal(await menu.locator('.playlist-hero-more-info h2').textContent(),scoped?'Singer A':'Mixed');assert.match(await menu.locator('.playlist-hero-more-info p').textContent(),scoped?/4\s*\|\s*12:00/:/3\s*\|\s*9:00/);assert.equal(await page.locator('.library-root-menu').count(),0)
  const menuCoverKey=await menu.locator('.artist-menu-cover[data-cover-key]').getAttribute('data-cover-key')
  if(scoped)assert.equal(menuCoverKey,JSON.stringify(['collection-cover','artist',await page.evaluate(()=>window.vm.playlist.library.artistLocation.artistKey)]),'artist menu cover retains complete artist identity inside album')
  else assert.equal(menuCoverKey,await hero().getAttribute('data-cover-key'),'global album menu owns current album cover identity')
  const cover=menu.locator('.playlist-hero-more-artwork img');await cover.waitFor();await cover.evaluate(image=>image.decode());await screenshot(scoped?'artist-album-detail-more':'global-album-detail-more');await page.keyboard.press('Escape');assert.equal(await hero().locator('.playlist-hero-more-button').evaluate(button=>button===document.activeElement),true)
  await hero().locator('.playlist-hero-play-button').click();await ready();assert.deepEqual(await queueIds(),scoped?['duet','mix-a']:['duet','mix-a','mix-b']);await backFromPlayer()
  await hero().locator('.playlist-select-toggle').click();await songs().filter({hasText:'Title duet'}).click();await hero().locator('.playlist-hero-play-button').click();await ready();assert.deepEqual(await queueIds(),['duet']);await backFromPlayer()
  await hero().locator('.playlist-hero-category').focus();await page.keyboard.press('Enter')
  if(scoped){await allArtistSongs().waitFor();assert.equal(await page.evaluate(()=>window.vm.playlist.library.artistLocation.view),'albums')}
  else{await page.waitForFunction(()=>window.vm.playlist.library.albumLocation===null);await page.getByRole('heading',{name:'专辑',exact:true}).waitFor()}
 }
 await page.evaluate(()=>{localStorage.setItem('spmusic.album-tracks.layout-level.v1','5');localStorage.setItem('spmusic.artist-tracks.layout-level.v1','5')})
 await page.reload();await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50)
 for(const scoped of [false,true]){await openMixed(scoped);assert.equal(await page.locator('.album-songs').getAttribute('data-layout-level'),'5','saved layout is not reset to the design default')}
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);console.log('album detail global/artist design, real menu scope, members, play/select, return and saved layout passed')
}
const verifyAlbumYearPage=async()=>{
 const currentHero=()=>page.locator('.album-library-content:not([inert])[data-album-detail] > .playlist-hero')
 const meta=()=>currentHero().locator('.playlist-hero-meta:not(.collection-hero-parent-meta)')
 const openMixed=async scoped=>{await selectCategory(scoped?'artist':'album');if(scoped)await artist('Singer A').click();await albums().filter({has:page.locator('.folder-name',{hasText:/^Mixed$/})}).click();await songs().first().waitFor()}
 let albumIdentity
 for(const scenario of ['unique','conflict','legacy']){
  await page.goto(origin+'/__album_library_test?cover=1'+(scenario==='legacy'?'':'&years='+scenario));await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50);await selectCategory('album');await page.waitForFunction(()=>window.vm.playlist.library.allSongs.find(item=>item.trackId==='mix-a')?.track.libraryYear!==undefined)
  await openMixed(false)
  assert.equal(await meta().textContent(),scenario==='unique'?'3 | 9:00 | 2023':'3 | 9:00')
  const key=await page.evaluate(()=>window.vm.playlist.library.albumLocation);if(albumIdentity)assert.equal(key,albumIdentity,'year-only tag changes do not change group key');albumIdentity=key
  const title=await currentHero().locator('.playlist-hero-title').evaluate(node=>[getComputedStyle(node).fontSize,getComputedStyle(node).lineHeight]);assert.deepEqual(title,Number(process.env.SPMUSIC_TEST_WIDTH)>1024?['22px','28px']:['24px','32px'])
  assert(!/年份未知|年份不一|\|\s*$/.test(await meta().textContent()))
  await screenshot('album-year-'+scenario)
  if(scenario==='unique'){
   await currentHero().locator('.playlist-hero-play-button').click();await ready();assert.deepEqual(await queueIds(),['duet','mix-a','mix-b']);await backFromPlayer()
   assert.equal(await meta().textContent(),'3 | 9:00 | 2023','hydration year 1999 cannot replace raw summary year 2023')
   assert.equal(await page.evaluate(()=>window.vm.playlist.library.allSongs.find(item=>item.trackId==='duet').track.libraryYear),2023)
  }
  if(scenario==='conflict'){
   await up();await openMixed(true);assert.equal(await meta().textContent(),'2 | 6:00 | 2023','artist scope excludes conflicting Singer B year');await screenshot('artist-album-year-scoped')
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);console.log('album year: actual summary parser/VM/Shell, unique/conflict/legacy omission, artist members, stable identity, hydration isolation and standard title passed')
}
try{
 if(process.env.SPMUSIC_TEST_ALBUM_YEAR_ONLY){await verifyAlbumYearPage()}
 else if(process.env.SPMUSIC_TEST_ALBUM_DETAIL_ONLY){await verifyAlbumDetailDesign()}
 else if(process.env.SPMUSIC_TEST_ARTIST_SONGS_ONLY){await verifyArtistSongsPage()}
 else if(process.env.SPMUSIC_TEST_ARTIST_MENU_CONTEXT_ONLY){
  await page.goto(origin+'/__album_library_test?cover=1');await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50);await selectCategory('artist');await artist('Singer A').click();await allArtistSongs().waitFor()
  await albums().filter({hasText:'Mixed'}).click();await songs().first().waitFor();assert.equal(await songs().count(),2)
  await verifyArtistMenuContext('artist-album-more-context');await up();await allArtistSongs().click();await songs().first().waitFor();await verifyArtistMenuContext('artist-songs-more-context')
  await page.goto(origin+'/__album_library_test?noCover=1');await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50);await selectCategory('artist');await artist('Singer A').click();await allArtistSongs().waitFor();await verifyArtistMenuContext('artist-no-cover-more',true)
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);console.log('artist more context: album subset, all songs, full artist artwork scope, fallback and keyboard passed')
 }else if(process.env.SPMUSIC_TEST_ARTIST_DESIGN_ONLY){await verifyArtistEntryDesign()}else{
 await page.goto(origin+'/__album_library_test?cover=1')
 await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50&&!window.vm.playlist.library.isImportPending)
 await selectCategory('artist');await page.getByRole('heading',{name:'艺术家',exact:true}).waitFor()
 await page.waitForFunction(()=>window.vm.playlist.library.allSongsMetadataStatus==='ready')
 await artist('Singer A').waitFor();assert.equal(await artist('Ensemble').count(),0,'album artist display fallback never forms artist entity')
 assert.equal(await artist('AC/DC').count(),1);assert.equal(await artist('Singer A/Singer B/Singer A').count(),0)
 assert.equal(await artists().filter({hasText:'未知艺术家'}).count(),2,'missing and literal unknown are distinct')
 await page.waitForFunction(()=>{const c=document.querySelector('.artist-card .folder-cover');return c&&Math.abs(c.getBoundingClientRect().width-c.offsetWidth)<1})
 const geometry=await artists().first().evaluate(node=>{const c=node.querySelector('.folder-cover'),r=c.getBoundingClientRect();return {width:r.width,height:r.height,radius:getComputedStyle(c).borderRadius,gap:getComputedStyle(node).gap}})
 assert(Math.abs(geometry.width-geometry.height)<1,'artist artwork is square before circular clipping');assert.equal(geometry.radius,'999px')
 console.log('ARTIST_GEOMETRY',geometry);await screenshot('artist-root')
 const rail=page.getByRole('navigation',{name:'艺术家快速查找'})
 await rail.getByRole('button',{name:'查找 Z 开头的艺术家',exact:true}).focus();await page.keyboard.press('Enter')
 await page.waitForFunction(()=>document.querySelector('.album-library-content:not([inert])').scrollTop>100)
 await rail.getByRole('button',{name:'返回列表顶部',exact:true}).focus();await page.keyboard.press('Enter')
 await page.waitForFunction(()=>document.querySelector('.album-library-content:not([inert])').scrollTop===0)
 await artist('Singer A').click();await page.waitForFunction(()=>window.vm.playlist.library.artistLocation?.view==='albums')
 await allArtistSongs().waitFor();assert.equal(await songs().count(),0,'default artist page is album view')
 assert.equal(await page.locator('.album-library-content:not([inert]) .collection-hero-parent-meta').count(),0,'artist overview has no empty author badge')
 const order=await allArtistSongs().evaluate(node=>Boolean(node.compareDocumentPosition(document.querySelector('.album-library-content:not([inert]) .album-list'))&Node.DOCUMENT_POSITION_FOLLOWING))
 assert(order,'all songs entry precedes artist albums in the rendered document')
 await screenshot('artist-albums')
 await albums().filter({hasText:'Mixed'}).click();await page.waitForFunction(()=>window.vm.playlist.library.artistLocation?.view==='album');await songs().first().waitFor()
 assert.deepEqual(await songIds(),['a.flac','duet.flac'],'compilation excludes another artist solo')
 await page.locator('.album-library-content > .playlist-hero .playlist-hero-play-button').click();await ready();assert.deepEqual(await queueIds(),['duet','mix-a'])
 await backFromPlayer();assert.equal(await page.evaluate(()=>window.vm.playlist.library.artistLocation.view),'album')
 await up();await allArtistSongs().focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.vm.playlist.library.artistLocation?.view==='songs');await songs().first().waitFor()
 assert.equal(await songs().count(),4,'all songs includes album-less music and collaborations')
 assert.equal(await page.locator('.album-library-content:not([inert]) .collection-hero-parent-meta').count(),0,'artist all songs has no empty author badge')
 await screenshot('artist-all-songs')
 await page.locator('.album-library-content > .playlist-hero .playlist-search-button').click();await page.getByRole('searchbox').fill('duet')
 await page.waitForFunction(()=>document.querySelectorAll('.album-songs .playlist-card[data-song-key]').length===1)
 assert.deepEqual(await songIds(),['duet.flac'],'song search is restricted to current artist')
 await page.locator('.album-library-content > .playlist-hero .playlist-hero-shuffle-button').click();await ready();assert.deepEqual(await queueIds(),['duet'],'shuffle uses filtered current artist candidates')
 await backFromPlayer();assert.equal(await page.evaluate(()=>window.vm.playlist.library.artistLocation.view),'songs','filtered playback preserves artist song location')
 if(await page.getByRole('searchbox').count()){await page.getByRole('searchbox').fill('');await page.getByRole('searchbox').press('Escape')}
 await page.waitForFunction(()=>document.querySelectorAll('.album-songs .playlist-card[data-song-key]').length===4)
 await page.locator('.album-library-content > .playlist-hero .playlist-hero-play-button').click();await ready();assert.deepEqual(await queueIds(),['disc1','duet','mix-a','unknown-album'])
 await backFromPlayer();await up();await up();await artist('Singer A').waitFor()
 await page.getByRole('button',{name:'搜索艺术家和歌曲',exact:true}).click();await page.getByRole('searchbox').fill('Singer ')
 await page.waitForFunction(()=>document.querySelectorAll('.artist-card').length===2)
 await page.locator('.playlist-management-toolbar').getByRole('button',{name:'选择',exact:true}).click();await artist('Singer A').click();await artist('Singer B').click()
 await page.getByRole('button',{name:'播放艺术家歌曲',exact:true}).click();await ready();assert.deepEqual(await queueIds(),['disc1','disc2','duet','mix-a','mix-b','unknown-album'],'selected artist union deduplicates shared collaboration')
 await backFromPlayer();await selectCategory('artist')
 const cancelSelection=page.locator('.playlist-management-toolbar').getByRole('button',{name:'取消选择',exact:true})
 if(await cancelSelection.count())await cancelSelection.click()
 await artist('Singer A').click();await allArtistSongs().waitFor()
 await page.evaluate(()=>window.settings.onClear());await page.waitForFunction(()=>window.vm.playlist.library.folderRoots.length===0&&window.vm.playlist.library.artistLocation===null)
 assert.equal(await artists().count(),0)
 await page.getByText('暂无艺术家',{exact:true}).waitFor();await screenshot('artist-empty')
 await page.goto(origin+'/__album_library_test?summaryGate=1');await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50);await selectCategory('artist')
 await page.waitForFunction(()=>window.pendingSummaries.length>0);assert.equal(await artists().count(),0,'pending does not fabricate unknown artists')
 await page.evaluate(()=>{window.summaryGate=false;window.pendingSummaries.splice(0).forEach(resolve=>resolve())});await artist('Singer A').waitFor()
 await page.goto(origin+'/__album_library_test?summaryGate=1');await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50);await selectCategory('artist');await page.waitForFunction(()=>window.pendingSummaries.length>0)
 await page.evaluate(()=>window.settings.onClear());await page.waitForFunction(()=>window.vm.playlist.library.folderRoots.length===0);await page.evaluate(()=>{window.summaryGate=false;window.pendingSummaries.splice(0).forEach(resolve=>resolve())});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
 assert.equal(await artists().count(),0,'late metadata cannot resurrect cleared artists')
 await page.goto(origin+'/__album_library_test?noCover=1');await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50);await selectCategory('artist');await artist('Singer A').waitFor()
 await page.waitForFunction(()=>document.querySelectorAll('.artist-card .album-cover-placeholder').length>0)
 assert.equal(await page.locator('.artist-card .folder-cover-image').count(),0,'absent embedded covers keep a local icon fallback')
 const placeholder=await artists().first().locator('.album-cover-placeholder').evaluate(node=>({mask:getComputedStyle(node).maskImage,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}))
 const artistAsset=await page.evaluate(async()=>(await import('/src/assets/media-library/feb56.svg?import')).default)
 assert(placeholder.mask.includes(artistAsset)&&placeholder.width>0&&placeholder.height>0,'artist placeholder uses the exact nonempty local artist asset')
 await screenshot('artist-no-cover')
 await artist('Singer A').click();await allArtistSongs().waitFor()
 const retained=await page.evaluate(()=>window.vm.playlist.library.artistLocation)
 await page.evaluate(()=>{window.scanGate=true;window.vm.playlist.library.onRescanFolders()});await page.waitForFunction(()=>window.pendingScans.length>0)
 assert.deepEqual(await page.evaluate(()=>window.vm.playlist.library.artistLocation),retained,'active artist survives a temporarily empty rescan projection')
 await page.evaluate(()=>{window.scanGate=false;window.pendingScans.splice(0).forEach(resolve=>resolve())});await page.waitForFunction(()=>!window.vm.playlist.library.isFolderRescanPending)
 await allArtistSongs().waitFor();assert.deepEqual(await page.evaluate(()=>window.vm.playlist.library.artistLocation),retained)
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
 console.log('artist library: raw artist, exception split, album boundary, all songs, playback return, selected union, pending and late completion passed')
 }
}catch(error){await screenshot('artist-failure');console.error(await page.evaluate(()=>({location:window.vm?.playlist.library.artistLocation,route:window.vm?.playlist.library.route,text:document.querySelector('.album-library-content')?.innerText})),errors);throw error}finally{await browser.close()}
