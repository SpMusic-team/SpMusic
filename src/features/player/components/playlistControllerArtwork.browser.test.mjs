// Start Vite; point SPMUSIC_PLAYWRIGHT to an existing Playwright installation.
// Real PlaylistPanel/dock/cover readiness. Only parent preview/thumbnail delivery
// is deterministic; full artwork is decoded before preview and thumbnails use
// the real decodePlaylistCover pipeline before publication.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match,'resolve '+name);return match[1]}
const fixture=`
import React from '${dependency('react.js')}';import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
import {PlaylistPanel} from '/src/features/player/components/PlaylistPanel.tsx';
import {TooltipProvider} from '/src/components/ui/tooltip.tsx';
import {decodePlaylistCover} from '/src/features/player/model/playlistCoverReadiness.ts';
import '/src/index.css';import '/src/features/player/styles/player.css';
const params=new URLSearchParams(location.search),noop=()=>{},initial=Number(params.get('initial')||0),emptyTarget=Number(params.get('empty')??-1),badPrimary=params.has('fallback');
const tracks=Array.from({length:84},(_,i)=>({id:'song-'+i,title:'Song '+i,artist:'Artist '+i,album:'Album',durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:i!==emptyTarget,lyrics:[],coverFilePath:i===emptyTarget?undefined:'C:/fixture/cover-'+i+'.jpg',coverImage:i===emptyTarget?undefined:'/__dock_art/'+(badPrimary&&i===83?'bad':'full')+'-'+i+'.svg',coverImageFallback:badPrimary&&i===83?'/__dock_art/full-83.svg':undefined}));
const artwork=i=>({id:tracks[i].id,resourceKey:'fixture-'+i,coverTone:'lagoon',coverFilePath:tracks[i].coverFilePath,coverImage:tracks[i].coverImage,coverImageFallback:tracks[i].coverImageFallback});
const thumbnails=new Map();
async function thumbnail(i){const image={src:'/__dock_art/thumb-'+i+'.svg',width:64,height:64,encodedBytes:300};await decodePlaylistCover(image);thumbnails.set(i,image);return image}
// The real artwork demand pins the first cover even when the cursor starts far
// down the list. Keep that asymmetry: reverse wrap is a useful control case.
await thumbnail(0);if(initial!==0)await thumbnail(initial);
window.config={thumbnailDelay:260,freezeThumbnail:false,deferPreview:false};window.calls=[];window.previewResolvers=[];let index=initial,nextToken=0,pending=null;
function Fixture(){
 const appearance=useAppearance();window.setMotionOff=()=>appearance.previewAppearance({...appearance.appearance,motion:{...appearance.appearance.motion,level:'off'}});
 const [state,setState]=React.useState({index:initial,sequence:0,intent:null,revision:0});index=state.index;
 window.externalSelect=async i=>{await thumbnail(i);setState(s=>({...s,index:i,sequence:s.sequence+1,intent:null,revision:s.revision+1}))};
 window.publishThumbnail=async i=>{await thumbnail(i);window.calls.push({type:'thumbnail',target:i,time:performance.now()});setState(s=>({...s,revision:s.revision+1}))};
 const prepare=React.useCallback(async direction=>{
   const target=(index+direction+tracks.length)%tracks.length,token={id:++nextToken,originTrackId:tracks[index].id,targetTrackId:tracks[target].id,direction,track:tracks[target],artwork:artwork(target)};
   if(token.artwork.coverImage){const image=new Image();image.src=token.artwork.coverImage;try{await image.decode()}catch(error){if(!token.artwork.coverImageFallback)throw error;image.src=token.artwork.coverImageFallback;await image.decode()}}
   window.calls.push({type:'prepared',id:token.id,target,time:performance.now()});
   const resolve=()=>{pending=token;return token};
   if(window.config.deferPreview)return new Promise(done=>window.previewResolvers.push(()=>done(resolve())));
   return resolve();
 },[]);
 const commit=React.useCallback(id=>{
   if(!pending||pending.id!==id)throw Error('single prepared token mismatch');const token=pending;pending=null;const target=tracks.findIndex(t=>t.id===token.targetTrackId);
   window.calls.push({type:'commit',id,target,time:performance.now()});
   setState(s=>({...s,index:target,sequence:s.sequence+1,intent:{requestId:s.sequence+1,sequence:s.sequence+1,targetTrackId:token.targetTrackId,direction:token.direction,source:token.direction<0?'previous':'next',previewTokenId:id}}));
   if(!window.config.freezeThumbnail)setTimeout(()=>window.publishThumbnail(target),window.config.thumbnailDelay);
   return true;
 },[]);
 const playback={track:tracks[state.index],artwork:artwork(state.index),selectionActivitySequence:state.sequence,selectionVisualIntent:state.intent,isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPrepareTrackPreview:prepare,onCommitTrackPreview:commit,onDiscardTrackPreview:id=>{window.calls.push({type:'discard',id,time:performance.now()});if(pending?.id===id)pending=null},onPlayToggle:async r=>({requestId:r.requestId,completed:true}),onShuffleCycle:noop,onRepeatCycle:noop};
 const playlistTracks=tracks.map((track,i)=>({...track,coverThumbnail:thumbnails.get(i)}));
 const timeline={positionSeconds:0,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop};
 return React.createElement('main',{className:'player-shell'},React.createElement(PlaylistPanel,{controllerMode:'fixed',tracks:playlistTracks,playlistName:'Local artwork handoff',currentTrackId:tracks[state.index].id,shuffleMode:'none',onShuffleCycle:noop,onOpenAudio:noop,onTrackSelect:noop,playback,timeline,visualIsPlaying:false,playbackTransitionPending:false,onPlayToggle:noop,onClose:noop}));
}
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();
root.render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(TooltipProvider,null,React.createElement(Fixture)))));
`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__dock_art_fixture.js"')
const browser=await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL||'msedge'})
const directory=join(tmpdir(),'spmusic-controller-artwork'),label=(process.env.SPMUSIC_ARTWORK_LABEL||'current').replaceAll(/[^a-z0-9-]/gi,'-')
mkdirSync(directory,{recursive:true})
const current='.playlist-playback-track[data-swipe-plane="current"]'
let passed=0
async function frames(page,count=2){await page.evaluate(async n=>{for(let i=0;i<n;i++)await new Promise(requestAnimationFrame)},count)}
async function open({initial=0,reduced=false,empty=-1,fallback=false}={}){
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:reduced?'reduce':'no-preference'}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(()=>localStorage.setItem('spmusic.playlist.layout-level.v1','7'))
 await page.route('**/__dock_art/*.svg',route=>{if(route.request().url().includes('/bad-'))return route.fulfill({status:404,body:'missing primary artwork'});const i=Number(route.request().url().match(/-(\d+)\.svg/)?.[1]||0),color=['#c53b51','#269477','#395ed1','#ba7a20'][i%4];return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="'+color+'"/><circle cx="64" cy="64" r="35" fill="#ffffff" opacity=".5"/><text x="30" y="75" font-size="32">'+i+'</text></svg>'})})
 await page.route('**/__dock_art_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
 await page.route('**/__dock_art_test*',route=>route.fulfill({contentType:'text/html',body:html}))
 await page.goto(origin+'/__dock_art_test?initial='+initial+'&empty='+empty+(fallback?'&fallback=1':''))
 await page.locator(current+' img').waitFor()
 await page.waitForFunction(()=>{const image=document.querySelector('.playlist-playback-track[data-swipe-plane="current"] img');return image?.complete&&image.naturalWidth>0&&getComputedStyle(document.querySelector('.playlist-panel')).transform==='none'})
 await frames(page,4)
 return {page,errors}
}
async function check(name,run,options){
 if(process.env.SPMUSIC_TEST_FILTER&&!name.includes(process.env.SPMUSIC_TEST_FILTER))return
 const {page,errors}=await open(options)
 try{await run(page);assert.deepEqual(errors,[]);passed++;console.log('PASS',name)}
 catch(error){await page.screenshot({path:join(directory,label+'-failure.png')});throw error}
 finally{await page.close()}
}
async function trace(page){await page.evaluate(()=>{
 window.coverSamples=[];window.samplingCover=true;const ids=new WeakMap();let nextId=0
 function sample(time){
  const planes=[...document.querySelectorAll('.playlist-playback-track')].map(plane=>{
   const images=[...plane.querySelectorAll('.playlist-playback-cover img')].map(image=>{
    let opacity=1,hidden=false;for(let el=image;el;el=el.parentElement){const s=getComputedStyle(el);opacity*=Number(s.opacity);if(s.visibility==='hidden'||s.display==='none')hidden=true}
    if(!ids.has(image))ids.set(image,++nextId)
    return {id:ids.get(image),src:image.getAttribute('src'),opacity,hidden,visibility:getComputedStyle(image).visibility,display:getComputedStyle(image).display,naturalWidth:image.naturalWidth,complete:image.complete,loaded:image.dataset.loaded}
   });return {plane:plane.dataset.swipePlane,state:plane.dataset.coverState,text:plane.textContent,images}
  });window.coverSamples.push({time,planes});if(window.samplingCover)requestAnimationFrame(sample)
 }requestAnimationFrame(sample)
})}
async function startDrag(page,direction,expectImage=true){const box=await page.locator(current).boundingBox(),x=box.x+box.width*(direction>0?.75:.25),y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-direction*box.width*.42,y,{steps:5});await page.waitForFunction(expectImage=>{const plane=document.querySelector('.playlist-playback-track[data-swipe-plane="neighbor"]'),image=plane?.querySelector('img');return expectImage?image?.complete&&image.naturalWidth>0:plane?.dataset.coverState==='empty'},expectImage);return {x,y,width:box.width}}
async function settled(page,target){await page.waitForFunction(target=>{const el=document.querySelector('.playlist-playback-track[data-swipe-plane="current"]');return el?.textContent.includes('Song '+target)&&Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)<.5},target);await frames(page,3)}
async function continuity(page,{from,target,direction,freeze=false}){
 await page.evaluate(freeze=>window.config.freezeThumbnail=freeze,freeze)
 await trace(page);await startDrag(page,direction)
 await page.screenshot({path:join(directory,label+'-'+from+'-to-'+target+'-preview.png')})
 await page.mouse.up();await settled(page,target)
 await page.screenshot({path:join(directory,label+'-'+from+'-to-'+target+'-handoff.png')})
 if(!freeze)await page.waitForFunction(target=>window.calls.some(c=>c.type==='thumbnail'&&c.target===target),target)
 await page.waitForTimeout(320)
 const samples=await page.evaluate(()=>{window.samplingCover=false;return window.coverSamples})
 const targetFrames=samples.flatMap(frame=>frame.planes.filter(p=>p.plane==='current'&&p.text.includes('Song '+target)).map(plane=>({time:frame.time,...plane})))
 const preview=samples.flatMap(s=>s.planes).filter(p=>p.plane==='neighbor'&&p.text.includes('Song '+target))
 const coverage=frame=>frame.images.filter(image=>image.complete&&image.naturalWidth>0&&!image.hidden).reduce((sum,image)=>sum+image.opacity,0)
 const metrics={from,target,freeze,frames:targetFrames.length,previewDecoded:preview.some(p=>coverage(p)>.99),loadingFrames:targetFrames.filter(f=>f.state!=='ready').length,missingFrames:targetFrames.filter(f=>coverage(f)<.99).length,minCoverage:Math.min(...targetFrames.map(coverage)),sources:[...new Set(targetFrames.flatMap(f=>f.images.map(i=>i.src)))],imageIds:[...new Set(targetFrames.flatMap(f=>f.images.map(i=>i.id)))],minImageOpacity:Math.min(...targetFrames.flatMap(f=>f.images.map(i=>i.opacity)))}
 console.log('CONTROLLER_ARTWORK_SAMPLE',JSON.stringify(metrics))
 writeFileSync(join(directory,label+'-'+from+'-to-'+target+'-trace.json'),JSON.stringify({metrics,samples},null,2))
 assert(metrics.previewDecoded,'target token artwork really decoded in preview')
 assert(targetFrames.length>5,'sample target before and after thumbnail delivery')
 assert.equal(metrics.loadingFrames,0,'painted preview never regresses to local artwork placeholder')
 assert.equal(metrics.missingFrames,0,'every committed frame has decoded opaque correct artwork')
 assert(targetFrames.every(f=>f.images.filter(i=>i.opacity>.01).every(i=>i.src?.includes('-'+target+'.svg'))),'no other track artwork is painted during handoff')
 await page.screenshot({path:join(directory,label+'-'+from+'-to-'+target+'-ready.png')})
}
try{
 await check('first to last wrap retains decoded artwork through delayed local thumbnail',async page=>{
  const last=page.locator('[data-playlist-track-id="song-83"]');assert(await last.evaluate(el=>el.getBoundingClientRect().top>innerHeight),'last song starts outside visible window')
  await continuity(page,{from:0,target:83,direction:-1})
 })
 await check('last to first wrap retains the already pinned first thumbnail',page=>continuity(page,{from:83,target:0,direction:1}),{initial:83})
 await check('ordinary next retains artwork with delayed thumbnail',page=>continuity(page,{from:0,target:1,direction:1}))
 await check('frozen thumbnail isolates decoded playback source from projection',page=>continuity(page,{from:0,target:83,direction:-1,freeze:true}))
 await check('motion off preserves first to last local artwork handoff',async page=>{await page.evaluate(()=>window.setMotionOff());await frames(page);await continuity(page,{from:0,target:83,direction:-1})})
 await check('decoded fallback survives wrap commit without retrying the failed primary',page=>continuity(page,{from:0,target:83,direction:-1}),{fallback:true})
 await check('genuine empty artwork does not inherit the previous decoded cover',async page=>{
  await page.evaluate(()=>window.config.freezeThumbnail=true);await trace(page);await startDrag(page,1,false);await page.mouse.up();await settled(page,1);await frames(page,5)
  const samples=await page.evaluate(()=>{window.samplingCover=false;return window.coverSamples}),target=samples.flatMap(s=>s.planes).filter(p=>p.plane==='current'&&p.text.includes('Song 1'))
  assert(target.length>0&&target.every(p=>p.state==='empty'&&p.images.length===0),'empty track has no inherited decoded image in any target frame')
  assert.equal(await page.locator(current+' .playlist-playback-cover-mark').count(),1,'real empty placeholder remains available')
 },{empty:1})
 await check('external selection cancels pending preview without restoring wrong cover',async page=>{
  await page.evaluate(()=>window.config.deferPreview=true)
  const box=await page.locator(current).boundingBox(),x=box.x+box.width*.25,y=box.y+box.height/2
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+box.width*.4,y,{steps:5})
  await page.waitForFunction(()=>window.previewResolvers.length===1)
  await page.evaluate(()=>window.externalSelect(2));await settled(page,2)
  await page.evaluate(()=>window.previewResolvers.shift()());await page.evaluate(()=>window.publishThumbnail(83));await frames(page,4);await page.mouse.up()
  assert.equal(await page.locator('.playlist-playback-track[data-swipe-plane="neighbor"]').count(),0)
  assert(!(await page.evaluate(()=>window.calls)).some(c=>c.type==='commit'))
  const image=page.locator(current+' img');assert((await image.getAttribute('src')).includes('-2.svg'));assert(await image.evaluate(el=>el.complete&&el.naturalWidth>0))
 })
 console.log('PLAYLIST_CONTROLLER_ARTWORK_RESULT',passed,'passed; artifacts:',directory)
}finally{await browser.close()}
