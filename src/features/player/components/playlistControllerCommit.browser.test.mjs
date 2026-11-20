// Real PlayerSurface (including the hidden full-size cover effects), dock,
// pointer handlers and Motion. Parent callbacks implement the same single
// prepared slot / origin validation / negative discard contract as useAudioPlayer.
// No callback injects an arbitrary rejection or external discard.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{const m=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(m,'resolve '+name);return m[1]}
const fixture=`
import React from '${dependency('react.js')}';import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
import {PlayerSurface} from '/src/features/player/components/PlayerSurface.tsx';import '/src/index.css';
const noop=()=>{},tracks=Array.from({length:6},(_,i)=>({id:'song-'+i,title:'Song '+i,artist:'Artist',album:'Album',durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:false,lyrics:[],coverImage:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="'+['#c53b51','#269477','#395ed1','#ba7a20','#a15acb','#268fa0'][i]+'"/><text x="25" y="85" font-size="50">'+i+'</text></svg>')}));
const artworks=tracks.map(t=>({id:t.id,resourceKey:t.id,coverTone:t.coverTone,coverImage:t.coverImage}));
window.calls=[];window.config={defer:false};window.resolvers=[];let currentIndex=0,nextId=0,prepared=null,prepareRevision=0;
const event=(type,values={})=>window.calls.push({type,...values,time:performance.now()});
function Fixture(){
 const appearance=useAppearance();window.setMotionOff=()=>appearance.previewAppearance({...appearance.appearance,motion:{...appearance.appearance.motion,level:'off'}});
 const [state,setState]=React.useState({index:0,sequence:0,intent:null,open:false,busy:false,revision:0,mounted:true});currentIndex=state.index;window.currentTrackId=tracks[state.index].id;
 window.updateFixture=patch=>setState(s=>({...s,...patch}));window.openPlaylist=()=>setState(s=>({...s,open:true}));
 const select=(target,token)=>setState(s=>({...s,index:target,sequence:s.sequence+1,intent:token?{requestId:s.sequence+1,sequence:s.sequence+1,targetTrackId:token.targetTrackId,direction:token.direction,source:token.direction<0?'previous':'next',previewTokenId:token.id}:null}));
 const prepare=React.useCallback(direction=>{
  const target=(currentIndex+direction+tracks.length)%tracks.length,revision=++prepareRevision,token={id:++nextId,originTrackId:tracks[currentIndex].id,targetTrackId:tracks[target].id,direction,track:tracks[target],artwork:artworks[target]};prepared=null;event('prepare',{id:token.id,target,origin:token.originTrackId});
  const resolve=()=>{if(revision!==prepareRevision){event('stale-null',{id:token.id});return null}prepared=token;event('prepared',{id:token.id,target});return token};
  if(window.config.defer)return new Promise(done=>window.resolvers.push(()=>done(resolve())));
  return Promise.resolve(resolve());
 },[state.revision]);
 const discard=React.useCallback(id=>{event('discard',{id,slot:prepared?.id??null,caller:new Error().stack});if(id<0){prepareRevision++;prepared=null}else if(prepared?.id===id)prepared=null},[state.revision]);
 const commit=React.useCallback(id=>{
  const token=prepared,accepted=Boolean(token&&token.id===id&&token.originTrackId===tracks[currentIndex].id);event('commit',{id,slot:token?.id??null,accepted,origin:tracks[currentIndex].id,target:token?.targetTrackId??null});prepared=null;
  if(!accepted)return false;select(tracks.findIndex(t=>t.id===token.targetTrackId),token);return true;
 },[state.revision]);
 const playback={track:tracks[state.index],artwork:artworks[state.index],selectionActivitySequence:state.sequence,selectionVisualIntent:state.intent,isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:state.busy,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:()=>select((currentIndex+5)%6),onNext:()=>select((currentIndex+1)%6),onPrepareTrackPreview:prepare,onPrimeTrackArtwork:noop,onCommitTrackPreview:commit,onDiscardTrackPreview:discard,onPlayToggle:async r=>({requestId:r.requestId,completed:true}),onShuffleCycle:noop,onRepeatCycle:noop};
 const viewModel={playback,timeline:{positionSeconds:0,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop},volume:{valuePercent:50,isBusy:false,isDisabled:false,onChange:noop},queue:{tracks,isOpen:false,onToggle:noop},playlist:{isOpen:state.open,onOpenChange:open=>setState(s=>({...s,open})),tracks,playlistName:'Controller commit ownership',currentTrackId:tracks[state.index].id,shuffleMode:'none',onShuffleCycle:noop,onOpenAudio:noop,onTrackSelect:id=>select(tracks.findIndex(t=>t.id===id))},feedback:{onToggle:noop}};
 window.viewModel=viewModel;return state.mounted&&React.createElement(PlayerSurface,{viewModel});
}
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();root.render(React.createElement(AppearanceProvider,null,React.createElement(Fixture)));
`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__controller_commit_fixture.js"')
const browser=await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL||'msedge'})
const directory=join(tmpdir(),'spmusic-controller-commit'),label=(process.env.SPMUSIC_COMMIT_LABEL||'current').replaceAll(/[^a-z0-9-]/gi,'-')
mkdirSync(directory,{recursive:true})
const current='.playlist-playback-track[data-swipe-plane="current"]'
let passed=0
async function frames(page,n=2){await page.evaluate(async n=>{for(let i=0;i<n;i++)await new Promise(requestAnimationFrame)},n)}
async function open({playlist=true}={}){
 const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>localStorage.setItem('spmusic.playlist.layout-level.v1','7'))
 await page.route('**/__controller_commit_fixture.js',r=>r.fulfill({contentType:'text/javascript',body:fixture}))
 await page.route('**/__controller_commit_test',r=>r.fulfill({contentType:'text/html',body:html}))
 await page.goto(origin+'/__controller_commit_test')
 await page.locator('.cover-frame').first().waitFor();await frames(page,5)
 if(playlist){await page.evaluate(()=>window.openPlaylist());await page.locator(current).waitFor();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.playlist-panel')).transform==='none')}
 await page.waitForFunction(()=>!document.querySelector('.track-card-plane[data-track-card-phase="incoming"],.track-card-plane[data-track-card-phase="exiting"]'))
 await frames(page,3)
 await page.evaluate(()=>{window.calls=[];window.trace=[];window.sampling=true;function sample(time){const plane=document.querySelector('.playlist-playback-track[data-swipe-plane="current"]'),viewport=document.querySelector('.playlist-controller-swipe-viewport');window.trace.push({time,id:window.currentTrackId,text:plane?.textContent,x:plane?new DOMMatrixReadOnly(getComputedStyle(plane).transform).m41:null,phase:viewport?.dataset.swipePhase,fullPhases:[...document.querySelectorAll('.track-card-plane')].map(el=>el.dataset.trackCardPhase)});if(window.sampling)requestAnimationFrame(sample)}requestAnimationFrame(sample)})
 return {page,errors}
}
async function check(name,run,options){
 if(process.env.SPMUSIC_TEST_FILTER&&!name.includes(process.env.SPMUSIC_TEST_FILTER))return
 const {page,errors}=await open(options)
 try{await run(page);assert.deepEqual(errors,[]);passed++;console.log('PASS',name)}
 catch(error){await page.screenshot({path:join(directory,label+'-failure.png')});throw error}
 finally{await page.close()}
}
async function drag(page,direction=1,release=true,expectPreview=true){
 const box=await page.locator(current).boundingBox(),x=box.x+box.width*(direction>0?.75:.25),y=box.y+box.height/2
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-direction*box.width*.42,y,{steps:5})
 if(expectPreview)await page.locator('.playlist-playback-track[data-swipe-plane="neighbor"]').waitFor()
 if(release)await page.mouse.up()
}
async function rest(page,id){await page.waitForFunction(id=>{const el=document.querySelector('.playlist-playback-track[data-swipe-plane="current"]');return window.currentTrackId===id&&el&&Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)<.5},id);await frames(page)}
async function evidence(page,name){const data=await page.evaluate(()=>({calls:window.calls,trace:window.trace}));writeFileSync(join(directory,label+'-'+name+'.json'),JSON.stringify(data,null,2));console.log('COMMIT_OWNERSHIP_TRACE',JSON.stringify({name,commits:data.calls.filter(c=>c.type==='commit'),discards:data.calls.filter(c=>c.type==='discard').map(({type,id,slot,time})=>({type,id,slot,time})),current:data.trace.at(-1),minX:Math.min(...data.trace.filter(f=>typeof f.x==='number').map(f=>f.x))}));return data}
try{
 await check('consecutive dock drags are not rejected by hidden player session cleanup',async page=>{
  await drag(page);await rest(page,'song-1')
  await drag(page);await page.waitForTimeout(700)
  const data=await evidence(page,'consecutive')
  const commits=data.calls.filter(c=>c.type==='commit')
  assert.equal(commits.length,2,'each crossed-threshold drag commits once')
  assert(commits.every(c=>c.accepted),'hidden full-size player never clears another view prepared slot')
  assert.equal(await page.evaluate(()=>window.currentTrackId),'song-2','second completed drag stays on its target')
 })
 await check('ordinary parent render and callback identity refresh preserve released dock commit',async page=>{
  await drag(page);await page.waitForFunction(()=>document.querySelector('.playlist-controller-swipe-viewport').dataset.swipePhase==='settling')
  await page.evaluate(()=>window.updateFixture({revision:1}));await page.waitForTimeout(650)
  const data=await evidence(page,'callback-refresh'),commits=data.calls.filter(c=>c.type==='commit')
  assert.equal(commits.length,1);assert(commits[0].accepted);assert.equal(await page.evaluate(()=>window.currentTrackId),'song-1')
 })
 for(const boundary of ['blur','unmount'])await check('dock late prepare after '+boundary+' releases only its eventual owned token',async page=>{
  await page.evaluate(()=>window.config.defer=true);await drag(page,1,false,false)
  await page.waitForFunction(()=>window.resolvers.length===1)
  await page.evaluate(boundary=>{if(boundary==='blur')window.dispatchEvent(new Event('blur'));else window.unmountFixture()},boundary)
  await page.evaluate(()=>window.resolvers.shift()());await frames(page,5);await page.mouse.up()
  const data=await evidence(page,'late-'+boundary),prepared=data.calls.find(c=>c.type==='prepared')
  assert(prepared,'cancelled prepare still returns its allocated token to exercise late cleanup')
  assert(data.calls.some(c=>c.type==='discard'&&c.id===prepared.id),'late result releases its own returned token')
  assert(!data.calls.some(c=>c.type==='discard'&&c.id<0),'cancel never clears another view shared slot')
  assert(!data.calls.some(c=>c.type==='commit'))
 })
 await check('dock reversal releases original token and commits the newly prepared opposite target',async page=>{
  await drag(page,1,false)
  const box=await page.locator(current).evaluate(el=>{const viewport=el.parentElement.getBoundingClientRect();return {x:viewport.x,width:viewport.width,y:viewport.y+viewport.height/2}})
  await page.evaluate(()=>window.config.defer=true)
  await page.mouse.move(box.x+box.width*.98,box.y,{steps:5})
  await page.waitForFunction(()=>window.resolvers.length===1)
  await page.evaluate(()=>window.resolvers.shift()());await frames(page,3);await page.mouse.up();await page.waitForTimeout(650)
  const data=await evidence(page,'reverse'),prepares=data.calls.filter(c=>c.type==='prepare'),commits=data.calls.filter(c=>c.type==='commit')
  assert.equal(prepares.length,2);assert.equal(commits.length,1);assert(commits[0].accepted)
  assert.equal(commits[0].id,prepares[1].id);assert.equal(await page.evaluate(()=>window.currentTrackId),'song-5')
  assert(data.calls.some(c=>c.type==='discard'&&c.id===prepares[0].id),'direction change releases the previous owned preview')
 })
 for(const boundary of ['blur','unmount'])await check('full player late prepare after '+boundary+' releases only its returned token',async page=>{
  await page.evaluate(()=>window.config.defer=true)
  const cover=page.locator('.track-card-plane[data-track-card-phase="active"] .cover-frame').first(),box=await cover.boundingBox(),x=box.x+box.width*.95,y=box.y+box.height*.35
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-box.width*.5,y,{steps:6})
  await page.waitForFunction(()=>window.resolvers.length===1)
  await page.evaluate(boundary=>{if(boundary==='blur')window.dispatchEvent(new Event('blur'));else window.unmountFixture()},boundary);await page.evaluate(()=>window.resolvers.shift()());await frames(page,5);await page.mouse.up()
  const data=await evidence(page,'full-late-'+boundary),prepared=data.calls.find(c=>c.type==='prepared')
  assert(prepared);assert(data.calls.some(c=>c.type==='discard'&&c.id===prepared.id),'full player still cleans stale successful prepare')
  assert(!data.calls.some(c=>c.type==='discard'&&c.id<0),'full player no longer requests global cancellation without a token')
  assert(!data.calls.some(c=>c.type==='commit'))
 },{playlist:false})
 await check('full player reversed pending prepares cannot commit the stale direction',async page=>{
  await page.evaluate(()=>window.config.defer=true)
  const box=await page.locator('.track-card-plane[data-track-card-phase="active"] .cover-frame').first().boundingBox(),x=box.x+box.width*.5,y=box.y+box.height*.35
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-box.width*.35,y,{steps:6})
  await page.waitForFunction(()=>window.resolvers.length===1)
  await page.mouse.move(x+box.width*.35,y,{steps:6});await page.waitForFunction(()=>window.resolvers.length===2)
  await page.evaluate(()=>{window.resolvers[1]();window.resolvers[0]();window.resolvers=[]})
  await page.waitForFunction(()=>document.querySelector('.track-card-plane[data-track-card-phase="preview"]')?.textContent.includes('Song 5'))
  await frames(page,5);await page.mouse.up();await page.waitForTimeout(700)
  const data=await evidence(page,'full-reverse'),prepares=data.calls.filter(c=>c.type==='prepare'),commits=data.calls.filter(c=>c.type==='commit')
  assert.equal(prepares.length,2);assert.equal(commits.length,1);assert(commits[0].accepted);assert.equal(commits[0].id,prepares[1].id)
  assert.equal(await page.evaluate(()=>window.currentTrackId),'song-5')
  assert(!data.calls.some(c=>c.type==='discard'&&c.id<0),'reverse pending preparation does not clear the shared slot globally')
 },{playlist:false})
 console.log('PLAYLIST_CONTROLLER_COMMIT_RESULT',passed,'passed; artifacts:',directory)
}finally{await browser.close()}
